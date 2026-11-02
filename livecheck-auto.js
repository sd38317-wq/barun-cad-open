// 실시간 법규 검사 기준을 손으로 넣지 않고 도면의 대지 정보로 채운다.
// 대지 = [대지 가져오기]로 그린 대지선(parcelRole 'site') 또는 A-SITE 레이어의 닫힌 선.
// 상한 = 토지정보(미리보다) 조회값 → 없으면 용도지역의 국토계획법 시행령 상한(조례로 더 낮을 수 있음).
// 정북 = 대지선 중 북쪽을 향한 변, 건축법 시행령 제86조(높이 10m 이하 1.5m, 초과 높이의 1/2) 개략.
// 수치 판정은 계획안 기준 ±3% 허용오차를 둔다(사용자 원칙). 결과는 개략 검토이며 인허가 판정이 아니다.
import * as G from './geometry.js';
// 화면 stale 판정과 검사기는 같은 건물 대상 규칙을 쓴다.
export const isLiveCheckTarget=(e,l)=>l&&!/^(?:A-SITE(?:-|$)|SITE(?:-|$)|CHECK-VIOLATION$)/i.test(l.name)&&!['text','dimension'].includes(e.type)&&(e.type==='wall'||e.type==='mass'||(e.type==='rectangle'||e.type==='polyline'&&e.closed)&&(l.building===true||/^A-BLDG-(?:L\d+|UP)$|(?:^|[ _-])\d+F(?:$|[ _-])|벽|건물|슬래브|매스|WALL|BUILDING|SLAB|MASS/i.test(l.name)));

// 국토의 계획 및 이용에 관한 법률 시행령 제84조(건폐율)·제85조(용적률)의 상한 [건폐율 %, 용적률 %].
export const STATUTORY_LIMITS={
 '제1종전용주거지역':[50,100],'제2종전용주거지역':[50,150],'제1종일반주거지역':[60,200],'제2종일반주거지역':[60,250],'제3종일반주거지역':[50,300],'준주거지역':[70,500],
 '중심상업지역':[90,1500],'일반상업지역':[80,1300],'근린상업지역':[70,900],'유통상업지역':[80,1100],
 '전용공업지역':[70,300],'일반공업지역':[70,350],'준공업지역':[70,400],
 '보전녹지지역':[20,80],'생산녹지지역':[20,100],'자연녹지지역':[20,100],
 '보전관리지역':[20,80],'생산관리지역':[20,80],'계획관리지역':[40,100],'농림지역':[20,80],'자연환경보전지역':[20,80],
};
export const NORTH_SETBACKS=[{height:0,distance:1500},{height:10000,distance:1500},{height:10001,distance:5000.5},{height:300000,distance:150000}];
export const AUTO_TOLERANCE_PCT=3;
// 계획 보고서의 방향이 명확한 연속 수치만 ±3%. 대수·기하 위반은 원래 판정을 쓴다.
export function planCheck(check){
 const {rule='',value,limit}=check,t=AUTO_TOLERANCE_PCT/100;
 const max=/^(건폐율|용적률)$/.test(rule),min=/^(이격 변|차로 너비|출입구 너비|보행 통로|조경면적)/.test(rule),target=rule==='1층 건폐율 목표';
 const numeric=Number.isFinite(value)&&Number.isFinite(limit)&&limit>0;
 const tolerated=numeric&&(max&&value>limit&&value<=limit*(1+t)+1e-8||min&&value<limit&&value>=limit*(1-t)-1e-8||target&&Math.abs(value-limit)<=limit*t+1e-8&&check.ok!==true);
 return {ok:check.ok===true||tolerated,tolerated};
}

const normalize=name=>String(name||'').replace(/\s+/g,'');
export function zoneOf(info){
 const names=[info?.massing?.zoneName,...(info?.zones||[]).map(z=>z?.name)].map(normalize).filter(Boolean);
 return names.find(n=>Object.hasOwn(STATUTORY_LIMITS,n))||null;
}
const sunlightZone=zone=>/전용주거|일반주거/.test(zone||'');   // 건축법 제61조 제1항

function siteEntities(doc){
 const parcels=G.parcelEntities(doc.entities).filter(e=>e.parcelRole==='site'&&e.type==='polyline'&&e.closed&&e.points?.length>=3);
 if(parcels.length)return {sites:parcels,from:'대지 가져오기 대지선'};
 const layer=doc.layers.find(l=>/^A-SITE$/i.test(l.name));
 const drawn=layer?doc.entities.filter(e=>e.layer===layer.id&&(e.type==='rectangle'||e.type==='polyline'&&e.closed)&&e.points?.length>=3):[];
 if(drawn.length)return {sites:drawn,from:'A-SITE 레이어 대지선'};
 return {sites:[],from:null};
}

// 패널을 열거나 자동 기준을 적용할 때만 조회한다. 도면 변경 경로에서는 호출하지 않는다.
export function autoSiteContext(doc){
 const {sites,from}=siteEntities(doc);
 const outers=sites.filter(e=>e.attributes?.ring!=='hole'),holes=sites.filter(e=>e.attributes?.ring==='hole');
 const info=outers.find(e=>e.attributes?.landInfo)?.attributes.landInfo||null,zone=zoneOf(info);
 const coverageLimit=Number(info?.limits?.bcr),farLimit=Number(info?.limits?.far);
 const hasLimits=Number.isFinite(coverageLimit)&&Number.isFinite(farLimit)&&coverageLimit>0&&farLimit>0;
 return {sites,from,outers,holes,info,zone,hasLimits,needsManualZone:!hasLimits&&!zone};
}

// 북쪽을 향한 대지 변(바깥 법선과 북쪽 방향의 내적 ≥ 0.35, parcel-info.js 정북 검토 방향과 같은 기준).
export function northEdges(outers,north){
 const m=Math.hypot(north[0],north[1])||1,n={x:north[0]/m,y:north[1]/m},segments=[];
 for(const ps of outers){
  const turn=G.polygonArea(ps);
  for(let i=0;i<ps.length;i++){
   const a=ps[i],b=ps[(i+1)%ps.length],dx=b.x-a.x,dy=b.y-a.y,len=Math.hypot(dx,dy);if(!len)continue;
   const nx=(turn>0?dy:-dy)/len,ny=(turn>0?-dx:dx)/len;
   if(nx*n.x+ny*n.y>=.35)segments.push([{x:a.x,y:a.y},{x:b.x,y:b.y}]);
  }
 }
 return segments;
}

// 계획 결과는 명시적으로 검사할 때만 읽는다. 희망 입력 층수로 결과를 대신하지 않는다.
export function planFloorSettings(doc){
 const state=doc.sitePlan,objects=new Map(),layers=[],basis=[],unverifiedRoofIds=new Set();
 const contract=state?.contract?.bundle?.contract,planId=state?.contract?.planId;
 let plan=contract&&(planId===contract.selected_plan?.plan_id?contract.selected_plan:contract.plans?.find(p=>p.plan_id===planId));
 if(plan?.shared_with?.length&&!plan.objects?.length)plan=contract.plans?.find(p=>plan.shared_with.includes(p.plan_id)&&p.objects?.length);
 const outlines=new Map((plan?.objects||[]).filter(o=>o.role==='building_outline').map(o=>[o.object_id,o]));
 const report=state?.report,total=plan?.metrics?.floor_count??report?.numbers?.floors;
 const height=Number(report?.numbers?.floor_h)*1000;
 const tops=new Map((!contract||planId===contract.selected_plan?.plan_id?report?.sunlight?.by_floor||[]:[]).map(f=>[f.floor,f.top_h*1000]));
 const valid=fs=>Array.isArray(fs)&&fs.length&&fs.every(f=>Number.isInteger(f)&&f>0);
 for(const e of doc.entities){
  if(!state||e.sitePlanId!==state.id||!['polyline','rectangle','mass'].includes(e.type)||e.type==='polyline'&&!e.closed)continue;
  const layer=doc.layers.find(l=>l.id===e.layer),outline=outlines.get(e.contractObjectId);
  const bindings=(state.bindings||[]).filter(b=>b.entityId===e.id),bound=bindings.filter(b=>b.path[0]==='floors').map(b=>b.path[1]+1);
  if(e.sitePlanRoles?.includes('rooftop_box')||bindings.some(b=>b.path[0]==='rooftop_box')){unverifiedRoofIds.add(e.id);continue;}
  if(!layer||!outline&&!bound.length&&!/^A-BLDG-(L\d+|UP)$/i.test(layer.name))continue;
  let floors=outline?(outline.floors||[outline.floor??outline.level]):null;
  if(!contract&&bound.length)floors=bound;
  if(!valid(floors)&&!contract&&/^A-BLDG-UP$/i.test(layer.name)&&Number.isInteger(total)&&total>=2){const first=Number.isInteger(layer.floor)&&layer.floor>=2?layer.floor:2;floors=Array.from({length:Math.max(0,total-first+1)},(_,i)=>first+i);}
  if(!valid(floors)&&!contract){const numbered=layer.name.match(/^A-BLDG-L(\d+)$/i);if(numbered)floors=[Number(numbered[1])];}
  if(!valid(floors))continue;
  floors=[...new Set(floors)].sort((a,b)=>a-b);
  const first=floors[0],last=floors.at(-1),h=Number.isFinite(height)&&height>0?height:null;
  const elevation=tops.get(first-1)??(first===1?0:h==null?null:(first-1)*h),top=tops.get(last)??(h==null?null:last*h);
  const levels=floors.map(f=>({floor:f,z0:tops.get(f-1)??(f===1?0:h==null?null:(f-1)*h),top:tops.get(f)??(h==null?null:f*h)}));
  objects.set(e.id,{floorNumbers:floors,levels,building:true,floor:first,upperFloors:floors.length,...(h==null?{}:{height:h}),...(elevation==null?{}:{elevation}),...(top==null?{}:{top})});
 }
 for(const layer of doc.layers){
  const values=doc.entities.filter(e=>e.layer===layer.id&&objects.has(e.id)).map(e=>objects.get(e.id));if(!values.length)continue;
  const one=values[0],same=values.every(v=>JSON.stringify(v)===JSON.stringify(one))&&doc.entities.filter(e=>e.layer===layer.id&&(e.type==='wall'||e.type==='mass'||e.type==='rectangle'||e.type==='polyline'&&e.closed)&&!unverifiedRoofIds.has(e.id)).every(e=>objects.has(e.id));
  if(same){const {floorNumbers,levels,elevation,top,...changes}=one;layers.push({id:layer.id,changes});}
  basis.push(layer.name);
 }
 if(basis.length)basis.splice(0,basis.length,'계획안에서 가져옴 · 층 묶음과 층고를 검사에 연결');
 if(doc.layers.some(l=>/^A-BLDG-UP$/i.test(l.name)&&!layers.some(x=>x.id===l.id)&&!doc.entities.some(e=>e.layer===l.id&&objects.has(e.id))))basis.push('상층 층수 확인 필요 · 건물 층·높이·면적 설정에서 입력하세요.');
 return {objects,layers,basis,unverifiedRoofIds};
}

export function autoSiteAnalysis(doc,{now=()=>new Date().toISOString(),manualZone=''}={}){
 const {sites,from,outers,holes,info,zone:queriedZone,hasLimits,needsManualZone}=autoSiteContext(doc);
 if(!sites.length)throw Error('도면에 대지선이 없습니다. [대지 가져오기]로 대지를 불러오거나 A-SITE 레이어에 대지 경계를 닫힌 선으로 그리세요.');
 const siteArea=(outers.reduce((s,e)=>s+Math.abs(G.polygonArea(e.points)),0)-holes.reduce((s,e)=>s+Math.abs(G.polygonArea(e.points)),0))/1e6;
 if(!(siteArea>0))throw Error('대지면적을 계산할 수 없습니다. 대지선을 확인하세요.');
 const selectedZone=normalize(manualZone);
 if(needsManualZone&&selectedZone&&!Object.hasOwn(STATUTORY_LIMITS,selectedZone))throw Error('용도지역 직접 선택 목록에서 올바른 용도지역을 선택하세요.');
 const direct=needsManualZone&&!!selectedZone,zone=queriedZone||(direct?selectedZone:null);
 const source=direct?'직접 선택(조례 미확인 — 시행령 상한)':'자동 기준';
 const basis=[`대지: ${from} ${outers.length}개 · ${siteArea.toFixed(2)}㎡`];
 let coverageLimit=Number(info?.limits?.bcr),farLimit=Number(info?.limits?.far);
 if(hasLimits)basis.push(`상한: 토지정보 조회값 건폐율 ${coverageLimit}% · 용적률 ${farLimit}%${zone?` (${zone})`:''}`);
 else if(zone){[coverageLimit,farLimit]=STATUTORY_LIMITS[zone];basis.push(`상한: ${direct?source+' · ':''}${zone} 국토계획법 시행령 상한 건폐율 ${coverageLimit}% · 용적률 ${farLimit}% — 조례로 더 낮을 수 있으니 확인 필요`);}
 else throw Error('용도지역을 알 수 없어 상한을 정할 수 없습니다. 법규 검사 패널의 [용도지역 직접 선택]에서 선택하거나 [토지정보]를 먼저 받으세요.');
 // 건축선: A-SITE-BLINE 에 닫힌 선이 있으면 그것, 없으면 대지 경계를 그대로 쓴다.
 const bline=doc.layers.find(l=>/^A-SITE-BLINE$/i.test(l.name));
 const lines=bline?doc.entities.filter(e=>e.layer===bline.id&&(e.type==='rectangle'||e.type==='polyline'&&e.closed)&&e.points?.length>=3):[];
 const buildable=lines.length?lines.map(e=>({outer:structuredClone(e.points),holes:structuredClone(e.loops||[])})):outers.map(e=>({outer:structuredClone(e.points),holes:holes.map(h=>structuredClone(h.points))}));
 basis.push(lines.length?`건축선: A-SITE-BLINE ${lines.length}개`:'건축선: 따로 그린 것이 없어 대지 경계로 검사');
 const analysis={version:1,units:'mm',areaUnits:'m2',siteArea,coverageLimit,farLimit,tolerancePct:AUTO_TOLERANCE_PCT,auto:true,
  ruleId:`${source} · ${zone||'토지정보'} · 건폐율 ${coverageLimit}% · 용적률 ${farLimit}%`,buildable,confirmedAt:now()};
 if(direct)analysis.manualZone=zone;
 const applies=info?.sunlightApplies??(zone?sunlightZone(zone):null);
 if(applies){
  const rotation=(doc.drawingGeo?.rotationDeg||0)*Math.PI/180,north=outers.find(e=>e.attributes?.northVector)?.attributes.northVector||[-Math.sin(rotation),Math.cos(rotation)];
  const segments=northEdges(outers.map(e=>e.points),north);
  if(segments.length){analysis.northProfile={segments,northVector:[...north],setbacks:structuredClone(NORTH_SETBACKS)};basis.push(`정북 사선: 북쪽 대지 경계 ${segments.length}변 · 높이 10m 이하 1.5m, 초과 높이의 1/2 (건축법 시행령 제86조, 개략)`);}
  else basis.push('정북 사선: 북쪽을 향한 대지 경계를 찾지 못해 검사하지 않음');
 }else basis.push(applies===false||zone?'정북 사선: 이 용도지역에는 적용하지 않음':'정북 사선: 적용 여부를 몰라 검사하지 않음');
 basis.push(`허용오차: 계획안 기준 ±${AUTO_TOLERANCE_PCT}% (넘으면 위반, 안이면 적합으로 표시)`);
 // 대지선이 바뀌면 다시 확인하게 원본 좌표를 남긴다(블록 안 지적선은 맨 위 객체가 아니라 비교에서 뺀다).
 const top=outers.filter(e=>!e.parcelBlockId);
 if(top.length){analysis.sourceIds={site:top[0].id,buildable:lines[0]?.id||null,north:null};analysis.sourceGeometry=[...top,...lines].map(e=>({id:e.id,points:structuredClone(e.points),loops:structuredClone(e.loops||[])}));}
 basis.push(...planFloorSettings(doc).basis);
 analysis.basis=basis;
 return {analysis,basis};
}

// 평면 절단축과 단면 가로축을 평행하게 놓고 직각 방향으로만 옮긴다. 투영 거리와 축척은 1:1.
export function sunSectionEntities(section,bounds,{gap=12000}={}){
 if(!section?.entries?.length)throw Error('일조 단면에 그릴 건물이 없습니다.');
 if(!section.frame)throw Error('단면 기준점이 없습니다. 지금 검사를 다시 실행하세요.');
 const {origin,south:u}=section.frame,v={x:-u.y,y:u.x},rotation=Math.atan2(u.y,u.x)*180/Math.PI;
 const corners=bounds?[{x:bounds.minX,y:bounds.minY},{x:bounds.maxX,y:bounds.minY},{x:bounds.maxX,y:bounds.maxY},{x:bounds.minX,y:bounds.maxY}]:[origin];
 const offset=Math.max(...corners.map(p=>(p.x-origin.x)*v.x+(p.y-origin.y)*v.y))+gap;
 const point=(s,z=0)=>({x:origin.x+u.x*s+v.x*(offset+z),y:origin.y+u.y*s+v.y*(offset+z)}),plan=s=>({x:origin.x+u.x*s,y:origin.y+u.y*s}),P=p=>point(p.x,p.y);
 const maxS=Math.max(...section.entries.map(e=>e.rect[1].x),...section.envelope.map(p=>p.x))+4000,maxZ=Math.max(...section.entries.map(e=>e.top))+3000;
 const out=[],red='#ff4545',cyan='#73aebd';
 const line=(a,b,extra={})=>out.push({type:'line',points:[a,b],color:cyan,...extra});
 const text=(s,z,value,height=650,extra={})=>out.push({type:'text',position:point(s,z),text:value,height,rotation,align:'left',color:cyan,...extra});
 text(-6000,maxZ+1800,'정북 일조 단면 가-가 · 북 ← → 남 · 축척 1:1 (개략)',900);
 line(point(-6000,0),point(maxS,0));text(maxS-1200,-900,'지면');
 line(point(0,-1500),point(0,maxZ),{linetype:'DASHED',sectionRole:'site-boundary'});text(-7600,maxZ-800,'북측 대지경계');
 for(const z of [10000,20000,30000].filter(z=>z<maxZ)){line(point(-700,z),point(0,z));text(-3200,z-250,z/1000+'m',550);}
 if(section.envelope.length){out.push({type:'polyline',closed:false,points:section.envelope.map(P),color:red,linetype:'DASHED',sectionRole:'setback'});const top=section.envelope.at(-1);text(top.x+700,top.y-400,'정북 일조 사선 한계',650,{color:red});}
 for(const e of section.entries){
  out.push({type:'polyline',closed:true,points:e.rect.map(P),color:'#ffffff',sectionRole:'building',sectionEntry:e.id});
  text(e.rect[0].x+600,e.rect[2].y-1000,e.label+' · 윗면 '+(e.top/1000).toFixed(1)+'m',600,{color:'#ffffff'});
  if(e.violation?.length){
   for(const h of e.violation)out.push({type:'hatch',points:h.outer.map(P),loops:(h.holes||[]).map(r=>r.map(P)),spacing:300,angle:45+rotation,solid:false,color:red});
   if(e.required!=null)text(e.rect[0].x+500,e.rect[2].y+500,'넘는 부분 · 필요 최단거리 '+(e.required/1000).toFixed(2)+'m / 단면 거리 '+(e.rect[0].x/1000).toFixed(2)+'m',600,{color:red});
  }
 }
 // 같은 절단선 위의 대지 경계·외벽·이격선을 직각 투영선으로 단면 지면에 잇는다.
 const last=Math.max(...section.entries.map(e=>e.rect[1].x))+2000;
 line(plan(-2000),plan(last),{linetype:'DASHED',sectionRole:'plan-cut'});
 for(const s of [-2000,last]){const p=plan(s);line({x:p.x-v.x*800,y:p.y-v.y*800},{x:p.x+v.x*800,y:p.y+v.y*800},{sectionRole:'cut-symbol'});out.push({type:'text',position:{x:p.x+v.x*1200,y:p.y+v.y*1200},text:'가',height:800,rotation,align:'center',color:cyan,sectionRole:'cut-symbol'});}
 const distances=[0,...section.entries.flatMap(e=>[e.rect[0].x,e.rect[1].x]),...section.envelope.map(p=>p.x)];
 for(const s of [...new Set(distances.map(s=>Math.round(s*1000)/1000))])line(plan(s),point(s,0),{linetype:'DASHED',color:'#507680',sectionRole:'projection'});
 text(-6000,-2800,'건축법 시행령 제86조 기준 개략 검토 · 절단선 위 거리로 펼침 · 인허가 판정 아님',500);
 return out;
}
