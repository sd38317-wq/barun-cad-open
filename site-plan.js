import {wrappedTable} from './parcel-info.js';
import * as G from './geometry.js';
import {sitePlanLayer} from './architecture.js';
import {planCheck} from './livecheck-auto.js';
import {generateSitePlan} from './site-plan-jobs.js';
import {contractCandidates,contractReport} from './site-plan-results.js';
import {isContract10,contractPlan,drawContractPlan,drawContractAnnotations,parkingStall,contractOverviewRows} from './site-contract.js';

// 출처는 원격 SPEC 요청에 섞지 않고 도면 sitePlan 에 함께 보관한다.
const valueSources=new WeakMap();
export const planValueSources=request=>valueSources.get(request)||{};
export function setPlanValueSources(request,sources){valueSources.set(request,structuredClone(sources||{}));return request;}
export function recordPlanValues(request,patch,source='default',note='계획안 자동 조건'){
 const sources={...planValueSources(request)};
 const visit=(value,key)=>{if(value&&typeof value==='object'&&!Array.isArray(value)){for(const [k,v]of Object.entries(value))visit(v,key+'.'+k);}else sources[key]={value,source:typeof source==='object'?source[key]||'default':source,note};};
 visit(patch,'program');return setPlanValueSources(request,sources);
}
const clone=v=>{const copy=structuredClone(v);if(v&&typeof v==='object'&&valueSources.has(v))setPlanValueSources(copy,planValueSources(v));return copy;};
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const contractDrawingSnapshot=doc=>doc.entities.filter(e=>e.sitePlanId===doc.sitePlan.id&&!e.buildingOverview&&!e.sunlightDrawing).map(e=>({id:e.id,type:e.type,points:e.points,position:e.position,center:e.center,radius:e.radius,closed:e.closed,entities:e.entities,text:e.text}));
function ring(ps){if(!Array.isArray(ps)||ps.length<3||ps.some(p=>!Array.isArray(p)||p.length!==2||!p.every(Number.isFinite)))throw Error('대지 CRS 다각형을 확인하세요.');return ps;}
const at=(o,path)=>path.reduce((v,k)=>v[k],o);
const put=(o,path,v)=>{const p=path.slice(0,-1).reduce((v,k)=>v[k],o);p[path.at(-1)]=v;};
function paths(g){return [['footprint'],...(g.floors||[]).map((_,i)=>['floors',i]),...(g.stalls||[]).map((_,i)=>['stalls',i,'rect']),...(g.walkways||[]).map((_,i)=>['walkways',i]),...(g.rooftop_box?.length?[['rooftop_box']]:[]),...(g.landscape||[]).map((_,i)=>['landscape',i])];}

/** options.offset: 계획안 원점을 놓을 도면 좌표(마우스로 고른 자리). 없으면 도면 오른쪽 옆. */
export function attachSitePlan(current,request,result,options={}){
 const uuid=options.idFactory||(()=>crypto.randomUUID());
 // 계약 1.0(엔진 수신 명세 2026-10-11)이 오면 그 도형으로 그린다. 재검증은 아직 엔진의 옛 report.geometry(m) 형식이라 그 칸에 역할로 잇는다.
 const contract=isContract10(result)?result.contract:null,plan=contract?contractPlan(contract,options.planId):null;
 const selected=!contract||plan.plan_id===contract.selected_plan?.plan_id;
 const source=result.entities||(contract?{units:'m',crs:'EPSG:5187',layers:{},entities:[]}:null),report=contract&&!selected?contractReport(result,plan):result.report,g=report?.geometry;
 if(source?.units!=='m'||source.crs!=='EPSG:5187'||request.site?.crs!=='EPSG:5187'||!g||g.units&&g.units!=='m'||g.crs&&g.crs!=='EPSG:5187')throw Error('v0.5.3 배치 결과와 원본 입력이 필요합니다.');
 const parcel=ring(request.site.parcel),origin=contract?{x:contract.origin_mm[0]/1000,y:contract.origin_mm[1]/1000}:parcel.reduce((o,p)=>({x:o.x+p[0]/parcel.length,y:o.y+p[1]/parcel.length}),{x:0,y:0});
 const doc=clone(current);
 if(options.replaceSitePlanId){if(current.sitePlan?.id!==options.replaceSitePlanId)throw Error('교체할 계획 묶음이 현재 도면과 다릅니다.');doc.entities=doc.entities.filter(e=>e.sitePlanId!==options.replaceSitePlanId);}
 const bounds=G.bounds(doc.entities),offset=Number.isFinite(options.offset?.x)&&Number.isFinite(options.offset?.y)?{x:options.offset.x,y:options.offset.y}:{x:bounds?bounds.maxX+30000:0,y:bounds?bounds.minY:0},id=options.replaceSitePlanId||uuid();
 const point=p=>{if(!Array.isArray(p)||p.length!==2||!p.every(Number.isFinite))throw Error('배치 좌표 오류');return {x:(p[0]-origin.x)*1000+offset.x,y:(p[1]-origin.y)*1000+offset.y};};
 const layerMap={},colors=['#000000','#ff5555','#ffff00','#55dd77','#55dddd','#6688ff','#dd66dd','#eeeeee','#888888'];
 // 엔진 레이어는 대지·계획 표준 이름으로 들어온다(A-DIM→A-DIM 등). 같은 이름이 있으면 그 레이어를 다시 쓴다(잠긴 레이어만 새로 만든다).
 const makeLayer=(name,l={})=>{
  const standard=sitePlanLayer(name),existing=doc.layers.find(x=>x.name===standard.name&&!x.locked);
  if(existing)return layerMap[name]=existing.id;
  const layer={id:uuid(),name:doc.layers.some(x=>x.name===standard.name)?standard.name+'_'+id.slice(0,6):standard.name,...(standard.label?{label:standard.label}:{}),color:standard.color||colors[l.color]||'#eeeeee',linetype:l.linetype??standard.linetype,lineweight:standard.lineweight??(l.lineweight??25)/100,visible:true,locked:false};
  doc.layers.push(layer);return layerMap[name]=layer.id;
 };
 for(const [name,l] of Object.entries(source.layers))makeLayer(name,l);
 const layerOf=name=>layerMap[name]||(contract?makeLayer(name):undefined);
 const added=[];
 const add=(e,layer)=>{const entity={id:uuid(),...e,layer:layerOf(layer),sitePlanId:id};if(!entity.layer)throw Error('배치 레이어가 없습니다: '+layer);doc.entities.push(entity);added.push(entity);return entity;};
 let legacyOverview=false,drawn=null;
 const pointMm=p=>contract?{x:p[0]-contract.origin_mm[0]+offset.x,y:p[1]-contract.origin_mm[1]+offset.y}:point([p[0]/1000,p[1]/1000]);
 if(contract){drawn=drawContractPlan(plan,{pointMm,add,layerId:layerOf,textHeight:300});
  const drawing=plan.drawing_data||(selected?contract.drawing_data:null)||{};
  drawContractAnnotations({plan,drawing_data:drawing,originMm:contract.origin_mm},{pointMm,add,existingEntities:added,textHeight:300});
 }
 else for(const e of source.entities){let shape;
  if(e.type==='TEXT'&&e.text.replace(/\s/g,'')==='면적표'){legacyOverview=true;continue;}
  if(legacyOverview&&e.type==='TEXT'&&e.text.startsWith('배치도'))legacyOverview=false;
  if(legacyOverview&&e.type==='TEXT')continue;
  switch(e.type){
   case 'LWPOLYLINE':shape={type:'polyline',closed:!!e.closed,points:e.points.map(point)};break;
   case 'LINE':shape={type:'line',points:[point(e.start),point(e.end)]};break;
   case 'TEXT':shape={type:'text',text:e.text,position:point(e.position),height:e.height*1000,rotation:e.rotation??e.rot??0,align:e.align?.includes('CENTER')?'center':'left',font:'malgun'};break;
   case 'CIRCLE':shape={type:'circle',center:point(e.center??e.cen),radius:e.radius*1000};break;
   case 'HATCH':shape={type:'hatch',points:ring(e.paths[0]).map(point),loops:e.paths.slice(1).map(ps=>ring(ps).map(point)),solid:e.pattern==='SOLID',angle:45,spacing:(e.scale||.3)*1000};break;
   case 'DIM_ALIGNED':{const a=point(e.p1),b=point(e.p2),len=G.dist(a,b);if(!len)throw Error('길이 없는 치수입니다.');shape={type:'dimension',mode:'aligned',points:[a,b,{x:a.x-(b.y-a.y)/len*e.offset*1000,y:a.y+(b.x-a.x)/len*e.offset*1000}],text:e.text||'',textHeight:400};break;}
   case 'ARROW':{const a=point(e.start),b=point(e.end),len=G.dist(a,b);if(!len)throw Error('길이 없는 화살표입니다.');const u={x:(b.x-a.x)/len,y:(b.y-a.y)/len},h=Math.min(len*.2,400);shape={type:'block',name:'화살표',entities:[[a,b],[b,{x:b.x-u.x*h-u.y*h*.4,y:b.y-u.y*h+u.x*h*.4}],[b,{x:b.x-u.x*h+u.y*h*.4,y:b.y-u.y*h-u.x*h*.4}]].map(points=>({type:'line',layer:layerMap[e.layer],points}))};break;}
   // 면적표 데이터: 표 글자는 TEXT 로 따로 오고 엔진의 DXF 출력도 그리지 않는다.
   case 'PANEL_TABLE':continue;
   // 검토 정보 문단(엔진 v0.5.x): 줄바꿈을 살린 여러 줄 글자로 받는다.
   case 'MTEXT':shape={type:'text',text:String(e.text??''),position:point(e.position),height:e.height*1000,rotation:e.rotation??0,align:'left',font:'malgun'};break;
   default:throw Error('지원하지 않는 배치 엔티티: '+e.type);
  }
  if(e.layer==='A-ENV-SUN'&&shape.type==='polyline')Object.assign(shape,{constantWidth:50,color:'#ff0000',linetype:'DASHED',sunlightLimit:true});
  add(shape,e.layer);
 }
 const used=new Set(),bindings=[],pre=contract&&plan.plan_id===contract.selected_plan?.plan_id?contractBindings(g,drawn,point):new Map();
 for(const path of selected?paths(g):[]){
  const bound=pre.get(path.join('.'));
  if(bound){const {entity,stall,shift}=bound;entity.sitePlanRoles=[...(entity.sitePlanRoles||[]),path.join('.')];bindings.push({path,entityId:entity.id,...(stall!=null?{stall,shift}:{}),originalPoints:clone(stall!=null?stallRing(entity,stall,shift):entity.points)});continue;}
  const ps=ring(at(g,path)),points=ps.map(point),kind=path[0],name=kind==='footprint'||kind==='floors'&&path[1]===0?'A-BLDG-L1':kind==='floors'||kind==='rooftop_box'?'A-BLDG-UP':kind==='landscape'?'A-LAND':'A-PARK';
  let entity=kind==='floors'&&path[1]===0&&equal(ps,g.footprint)?doc.entities.find(e=>e.id===bindings[0]?.entityId):null;
  entity ||= added.find(e=>!used.has(e.id)&&e.layer===layerMap[name]&&['polyline','hatch'].includes(e.type)&&equal(e.points,points));
  const generated=!entity&&!(kind==='floors'&&added.some(e=>['polyline','hatch'].includes(e.type)&&[layerMap['A-BLDG-L1'],layerMap['A-BLDG-UP']].includes(e.layer)&&equal(e.points,points)));entity ||= add({type:'polyline',closed:true,points},name);
  used.add(entity.id);entity.sitePlanRoles=[...(entity.sitePlanRoles||[]),path.join('.')];bindings.push({path,entityId:entity.id,originalPoints:clone(points),...(generated?{generated:true}:{})});
 }
 if(!added.some(e=>e.type==='text'&&e.text.includes('지적측량 성과 아님')))add({type:'text',text:'검토용 — 연속지적도 기반, 지적측량 성과 아님',position:{x:offset.x,y:offset.y-25000},height:400},'A-TEXT');
 const contextGeometry=added.filter(e=>[layerMap['A-SITE'],layerMap['A-SITE-BND'],layerMap['A-SITE-ROAD']].includes(e.layer)&&e.points).map(e=>({entityId:e.id,points:clone(e.points)}));
 doc.sitePlan={version:'0.5.3',id,request:clone(request),report:clone(report),geometry:clone(g),origin,offset,bindings,contextGeometry,validatedOverrides:clone(g),scale:source.scale||200,valueSources:clone(planValueSources(request)),
  ...(contract?{contract:{version:contract.contract_version,planId:plan.plan_id,planLabel:plan.label_ko,...(plan.sameAs?{sameAs:plan.sameAs}:{}),selectedPlanId:contract.selected_plan?.plan_id,revalidate:pre.size>0,originMm:clone(contract.origin_mm),frameVerified:!!contract.frame_verified,sheets:clone(result.sheets||[]),bundle:clone({contract:result.contract,report:result.report,sheets:result.sheets||[]})}}:{})};
 const sourceLayers=new Map(current.layers.map(l=>[l.id,l.name]));
 const sourceBoundaries=[...G.parcelEntities(current.entities).filter(e=>e.parcelRole),...current.entities.filter(e=>!e.sitePlanId&&['polyline','rectangle'].includes(e.type)&&['A-SITE','A-SITE-BND','A-SITE-BNDY','A-ROAD','A-SITE-ROAD'].includes(sourceLayers.get(e.layer)||e.layer))];
 doc.sitePlan.sourceParcelGeometry=[...new Map(sourceBoundaries.map(e=>[e.id,e])).values()].map(e=>({entityId:e.id,points:clone(e.points)}));
 const overviewLayer={id:uuid(),name:doc.layers.some(l=>l.name==='건축개요')?'건축개요_'+id.slice(0,6):'건축개요',color:'#ffffff',visible:true,locked:false};doc.layers.push(overviewLayer);
 const overview=contract?overviewTable(contractOverviewRows(plan.overview||[]),G.bounds(added),overviewLayer.id,contractSections(plan.overview||[]),`${plan.label_ko||plan.plan_id} · 설계엔진 계약 ${contract.contract_version}`):buildingOverview(request,report,G.bounds(added),overviewLayer.id);
 doc.entities.push(...overview.map(e=>({...e,id:uuid(),sitePlanId:id,buildingOverview:true})));
 // 일조 검토도: 계약이면 그 안의 일조 한계선(mm)으로 — 옛 entities 는 곧 빠진다
 const sunSource=contract?{entities:plan.objects.filter(o=>o.role==='sunlight'&&o.geometry?.ring).map(o=>({layer:'A-ENV-SUN',type:'LWPOLYLINE',closed:true,points:o.geometry.ring.map(p=>[p[0]/1000,p[1]/1000])}))}:source;
 if(selected)addSunlightDrawing(doc,sunSource,point,uuid);
 else doc.sitePlan.sunlightDrawing={applies:false,entityIds:[],unverified:true};
 if(contract)doc.sitePlan.contract.drawingSnapshot=clone(contractDrawingSnapshot(doc));
 return doc;
}

function addSunlightDrawing(doc,source,point,uuid=()=>crypto.randomUUID()){
 const state=doc.sitePlan,sun=state.report.sunlight;
 if(!sun||typeof sun.applies!=='boolean')throw Error('일조 적용 여부가 없어 검토도를 생성하지 못했습니다. 검토 결과를 다시 받아야 합니다.');
 if(!sun.applies){state.sunlightDrawing={applies:false,entityIds:[],sunlight:clone(sun)};return;}
 const limits=source.entities.filter(e=>e.layer==='A-ENV-SUN'&&e.type==='LWPOLYLINE');
 if(sun.applies&&(!sun.by_floor?.length||sun.by_floor.some(f=>f.north_setback_from_parcel>0)&&!limits.length))throw Error('일조 한계선이 없어 검토도를 생성하지 못했습니다. 검토 완료로 처리하지 않았습니다.');
 const layer={id:uuid(),name:'일조검토도_'+state.id.slice(0,6),color:'#73c9cf',visible:true,locked:false};doc.layers.push(layer);
 const b=G.bounds(doc.entities),sitePoints=state.request.site.parcel.map(point),sb=G.bounds([{type:'polyline',points:sitePoints}]),dx=b.maxX+5000-sb.minX,dy=b.maxY-sb.maxY-2500;
 const move=p=>({x:p.x+dx,y:p.y+dy}),ids=[];
 const add=e=>{const obj={...e,id:uuid(),layer:layer.id,sitePlanId:state.id,sunlightDrawing:true};doc.entities.push(obj);ids.push(obj.id);};
 add({type:'polyline',closed:true,points:sitePoints.map(move),color:'#dba4d0'});
 for(const e of limits)add({type:'polyline',closed:!!e.closed,points:e.points.map(p=>move(point(p))),linetype:'DASHED',color:'#ff0000',constantWidth:50,sunlightLimit:true});
 for(const binding of state.bindings.filter(b=>b.path[0]==='floors')){const e=doc.entities.find(e=>e.id===binding.entityId);add({type:'polyline',closed:true,points:e.points.map(move),color:'#ffff80',sunlightSourceId:e.id});}
 const x=sb.minX+dx,top=sb.maxY+dy;
 const label=(text,y,height=300,color,extra={})=>add({type:'text',text,position:{x,y},height,...(color?{color}:{}),...extra});
 label('정북 일조 검토도',top+1500,550,'#a5e1d5');label('대지경계 · 일조 한계선 · 층별 건물 외곽',top+800);
 let y=sb.minY+dy-1100;
 const rows=[sun.applies?'엔진 판정: 정북 일조 제한 적용':'엔진 판정: 정북 일조 제한 비적용 · 적용 근거 확인 필요',
 '분홍: 대지 / 붉은 점선 PL 폭 50mm: 일조선 / 노랑: 계획 외곽',
 '방향: 원본 EPSG:5187 도북 기준 · 실제 정북 확인 필요',
 ...(sun.by_floor||[]).map(f=>`${f.floor}층 · 높이 ${f.top_h}m · 경계 기준 이격 ${f.north_setback_from_parcel}m`),
 '정북 사선 검토 자료 · 시간대별 일조시간 분석 아님'];
 for(const row of rows){label(row,y);y-=650;}
 for(const c of (state.report.checks||[]).filter(c=>/일조|정북|건축가능/.test(c.rule))){label(`${c.ok?'통과':'확인 필요'} · ${c.rule}${c.provisional?' (잠정)':''}`,y,300,c.ok?'#a5e1d5':'#ff8585',{sunlightCheckRule:c.rule});y-=650;}
 state.sunlightDrawing={entityIds:ids,layer:layer.id,dx,dy,applies:sun.applies,limits:clone(limits),sunlight:clone(sun)};
 appendSunlightSection(doc,uuid);
}

export function sunlightSection(site,geometry,sun){
 if(!sun?.applies)return null;
 const ps=site.parcel,ox=ps[0][0],oy=ps[0][1];let area=0,cx=0;
 for(let i=0;i<ps.length;i++){const a=ps[i],b=ps[(i+1)%ps.length],cross=(a[0]-ox)*(b[1]-oy)-(b[0]-ox)*(a[1]-oy);area+=cross;cx+=(a[0]+b[0]-2*ox)*cross;}
 if(!area)throw Error('단면 검토용 대지 면적이 없습니다.');const cutX=ox+cx/(3*area);
 const crosses=ring=>ring.flatMap((a,i)=>{const b=ring[(i+1)%ring.length];return (a[0]<=cutX&&cutX<b[0]||b[0]<=cutX&&cutX<a[0])?[a[1]+(cutX-a[0])*(b[1]-a[1])/(b[0]-a[0])]:[];}).sort((a,b)=>a-b);
 const ys=crosses(ps);if(!ys.length)throw Error('대지를 관통하는 단면선을 만들 수 없습니다.');
 const boundaryY=ys.at(-1),credit=sun.boundary_credit_m||0,floors=[];let low=0;
 for(const [i,ring] of (geometry.floors||[]).entries()){
  const f=sun.by_floor.find(f=>f.floor===i+1);if(!f)throw Error('층별 일조 높이 자료가 없습니다.');const hits=crosses(ring);
  for(let j=0;j+1<hits.length;j+=2){const near=boundaryY+credit-hits[j+1],far=boundaryY+credit-hits[j];floors.push({floor:i+1,low,high:f.top_h,near,far,required:f.north_setback,ok:near+.02>=f.north_setback});}low=f.top_h;
 }
 return {cutX,boundaryY,credit,floors,height:Math.max(12,...sun.by_floor.map(f=>f.top_h))+2};
}

function appendSunlightSection(doc,uuid=()=>crypto.randomUUID()){
 const s=doc.sitePlan,sheet=s.sunlightDrawing;
 const geometry=validationPayload(doc).overrides,section=sunlightSection(s.request.site,geometry,sheet.sunlight);sheet.section=section;
 const b=G.bounds(doc.entities),anchor=sheet.sectionAnchor||{x:b.maxX+6000,y:b.maxY-section.height*1000-2000};sheet.sectionAnchor=anchor;
 const p=(d,h)=>({x:anchor.x+d*1000,y:anchor.y+h*1000});
 const add=e=>{e={...e,id:uuid(),layer:sheet.layer,sitePlanId:s.id,sunlightDrawing:true,sunlightSection:true};doc.entities.push(e);sheet.entityIds.push(e.id);};
 const line=(a,b,color='#73c9cf')=>add({type:'line',points:[p(...a),p(...b)],color});
 const label=(text,d,h)=>add({type:'text',text,position:p(d,h),height:300,color:'#d6e7ea'});
 const width=Math.max(15,...section.floors.map(f=>f.far))+2,H=section.height;
 line([0,0],[width,0],'#aaaaaa');line([0,0],[0,H],'#dba4d0');if(section.credit)line([section.credit,0],[section.credit,H],'#dba4d0');
 add({type:'polyline',closed:false,points:[[1.5,0],[1.5,10],[5,10],[H/2,H]].map(v=>p(...v)),color:'#ff0000',linetype:'DASHED',constantWidth:50,sunlightLimit:true});
 label('A–A 정북 일조 단면검토',0,H+1.2);label('10m 이하: 1.5m / 10m 초과: H/2 (수평:높이 = 1:2)',0,-1.5);
 label('10m',-2,10);label('일조 기준 경계',0,-.7);label('같은 지반고 가정 · 구조단면 아님 · 실제 정북·지반고 확인',0,-2.3);
 label(`도로·공원 공제 ${section.credit.toFixed(2)}m · 대지 중심 A–A`,0,-3.1);
 for(const f of section.floors){add({type:'polyline',closed:true,points:[[f.near,f.low],[f.far,f.low],[f.far,f.high],[f.near,f.high]].map(v=>p(...v)),color:f.ok?'#ffff80':'#ff8585'});label(`${f.floor}F H=${f.high.toFixed(2)}m · 이격 ${f.near.toFixed(2)} / 기준 ${f.required.toFixed(2)}m`,width+1,(f.low+f.high)/2);}
 // Link the section to the actual plan with a visible north/south cutting line.
 const absolute=(x,y)=>({x:(x-s.origin.x)*1000+s.offset.x+sheet.dx,y:(y-s.origin.y)*1000+s.offset.y+sheet.dy});
 const ys=s.request.site.parcel.map(p=>p[1]);add({type:'line',points:[absolute(section.cutX,Math.min(...ys)-1),absolute(section.cutX,Math.max(...ys)+1)],linetype:'DASHED',color:'#e5b57f',sunlightCut:true});
 add({type:'text',text:'A–A · 도북',position:absolute(section.cutX,Math.max(...ys)+1.5),height:320,color:'#e5b57f',sunlightCut:true});
}

export function refreshSunlightDrawing(doc){
 const state=doc.sitePlan,sheet=state.sunlightDrawing;
 if(sheet?.applies===false)return doc;
 if(!sheet||!sheet.entityIds.every(id=>doc.entities.some(e=>e.id===id)))throw Error('일조 검토도가 없거나 삭제됐습니다. 계획을 다시 생성하세요.');
 for(const e of doc.entities.filter(e=>e.sitePlanId===state.id&&e.sunlightSourceId)){
  const original=doc.entities.find(p=>p.id===e.sunlightSourceId);if(!original)throw Error('일조 검토 대상 외곽이 없습니다.');
  e.points=original.points.map(p=>({x:p.x+sheet.dx,y:p.y+sheet.dy}));
 }
 for(const e of doc.entities.filter(e=>e.sitePlanId===state.id&&e.sunlightCheckRule)){const c=state.report.checks.find(c=>c.rule===e.sunlightCheckRule);e.text=c?`${c.ok?'통과':'확인 필요'} · ${c.rule}${c.provisional?' (잠정)':''}`:`미확인 · ${e.sunlightCheckRule}`;e.color=c?.ok?'#a5e1d5':'#ff8585';}
 const removed=doc.entities.filter(e=>e.sitePlanId===state.id&&e.sunlightSection).map(e=>e.id);doc.entities=doc.entities.filter(e=>!removed.includes(e.id));sheet.entityIds=sheet.entityIds.filter(id=>!removed.includes(id));appendSunlightSection(doc);
 return doc;
}

// 계약 1.0: 엔진 칸 이름(label_ko)에 묶음 머리글을 단다
const CONTRACT_SECTIONS={site_address:'01  대지 · 용도',building_area:'02  계획 규모',floor_areas:'03  층별 면적',parking:'04  주차 · 조경',structure:'05  구조 · 일조'};
const contractSections=rows=>Object.fromEntries(rows.filter(r=>CONTRACT_SECTIONS[r.key]).map(r=>[r.label_ko||r.key,CONTRACT_SECTIONS[r.key]]));
// 계약 1.0 재검증 잇기: 층 외곽 = 그 층을 덮는 building_outline, 칸 = 가장 가까운 PKD 칸, 조경 = 가장 가까운 조경
const stallRing=(block,k,shift=0)=>{const r=parkingStall(block,k);return r&&r.map((_,j)=>r[(j+shift)%r.length]);};
function contractBindings(g,drawn,point){
 const out=new Map(),mid=ps=>({x:ps.reduce((n,p)=>n+p.x,0)/ps.length,y:ps.reduce((n,p)=>n+p.y,0)/ps.length}),near=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
 const outline=floor=>drawn.outlines.find(o=>o.floors.includes(floor))?.entity;
 if(outline(1))out.set('footprint',{entity:outline(1)});
 (g.floors||[]).forEach((_,i)=>{const e=outline(i+1);if(e)out.set('floors.'+i,{entity:e});});
 const stalls=drawn.parking.flatMap(({block})=>block.entities.filter(e=>e.type==='polyline'&&e.closed).map((e,k)=>({block,k,c:mid(e.points)})));
 (g.stalls||[]).forEach((s,i)=>{const c=mid(s.rect.map(point)),best=stalls.filter(x=>!x.used).sort((a,b)=>near(a.c,c)-near(b.c,c))[0];if(best&&near(best.c,c)<1000){best.used=true;
  // 엔진 칸 사각형의 꼭짓점 순서(시작 모서리)를 지켜 돌려보낸다 — PKD 는 진입 변 시작점부터
  const ring=parkingStall(best.block,best.k),first=point(s.rect[0]),shift=ring.map((p,k)=>[near(p,first),k]).sort((a,b)=>a[0]-b[0])[0][1];
  out.set(`stalls.${i}.rect`,{entity:best.block,stall:best.k,shift});}});
 const lands=[...drawn.objects.values()].filter(e=>e.contractRole==='landscape').map(e=>({e,c:mid(e.points)}));
 (g.landscape||[]).forEach((ring,i)=>{const c=mid(ring.map(point)),best=lands.filter(x=>!x.used).sort((a,b)=>near(a.c,c)-near(b.c,c))[0];if(best&&near(best.c,c)<1000){best.used=true;out.set('landscape.'+i,{entity:best.e});}});
 return out;
}
export function buildingOverview(request,report,b,layer){
 const n=report.numbers||{},fmt=(v,u='')=>Number.isFinite(v)?`${v.toLocaleString('ko-KR',{maximumFractionDigits:2})}${u}`:'미확인';
 const rows=[['대지 위치',request.site.address||request.site.id],['주 용도',request.program?.use||'미확인'],
 ['대지면적 · 지적도',fmt(n.site_area_gross,' ㎡')],['산정 대지면적',fmt(n.site_area,' ㎡')],['후퇴·가각 제외 면적',fmt(n.deducted_area,' ㎡')],
 ['건축면적',fmt(n.building_area,' ㎡')],['연면적',fmt(n.gfa,' ㎡')],['건폐율 · 계획 / 검토상한',`${fmt(n.bcr,' %')} / ${fmt(n.bcr_max,' %')}`],['용적률 · 계획 / 검토상한',`${fmt(n.far,' %')} / ${fmt(n.far_max,' %')}`],
 ['규모',`지상 ${fmt(n.floors)}층 · 높이 ${fmt(n.height,' m')}`],
 ...(n.floor_areas||[]).map((a,i)=>[`${i+1}층 바닥면적`,fmt(a,' ㎡')]),
 ['주차 · 계획 / 검토기준',`${fmt(n.parking_placed,' 대')} / ${fmt(n.parking_required,' 대')}`],['조경 · 계획 / 검토기준',`${fmt(n.landscape_provided,' ㎡')} / ${fmt(n.landscape_required,' ㎡')}`],
 ['구조 · 지하층','미정 · 별도 설계 필요'],['검토 결과',(report.checks||[]).filter(c=>!planCheck(c).ok).map(c=>(c.severity==='info'?'목표 미달: ':'확인 필요: ')+c.rule).join(' / ')||'현재 검토 항목 통과 · 상세 확인 필요'],['자료 기준','생성 시점 계획값 · 도면 수정 시 다시 생성'],['검토 범위','개략 계획 · 상세 법규 및 인허가 확인 필요']];
 return overviewTable(rows,b,layer,{'대지 위치':'01  대지 · 용도','건축면적':'02  계획 규모','1층 바닥면적':'03  층별 면적','주차 · 계획 / 검토기준':'04  주차 · 조경','구조 · 지하층':'05  검토 · 자료 기준'},'ARCHITECTURAL SUMMARY  /  개략 계획');
}
export function overviewTable(rows,b,layer,sections,subtitle){
 const x=b.maxX+3000,top=b.maxY,w=23000,h=850,split=8500,out=[];
 const line=(x1,y1,x2,y2,color='#3b5964')=>out.push({type:'line',layer,color,points:[{x:x1,y:y1},{x:x2,y:y2}]});
 const text=(value,tx,ty,height=310,color)=>out.push({type:'text',layer,...(color?{color}:{}),text:String(value),position:{x:tx,y:ty},height,font:'malgun'});
 text('건축개요',x+600,top-850,530,'#a5e1d5');text(subtitle,x+600,top-1450,230,'#91adb7');line(x,top,x+w,top,'#a5e1d5');
 let y=top-1900;
 for(const [label,value] of rows){
  if(sections[label]){y-=350;text(sections[label],x+500,y-480,310,'#a5e1d5');y-=800;line(x+450,y,x+w-450,y,'#688a93');}
  const block=wrappedTable([[label,value]],{height:310,widths:[split,w-split-900],rowHeight:h,layer});for(const e of block.entities)if(e.type==='text')out.push({...e,position:{x:e.position.x+x+450,y:e.position.y+y}});const next=y-block.table.rowHeights[0];line(x+450,next,x+w-450,next);y=next;
 }
 y-=450;line(x,top,x,y);line(x+w,top,x+w,y);line(x,y,x+w,y);return out;
}

export function validationPayload(doc){
 const s=doc.sitePlan;if(!s)throw Error('v0.5.3 배치 결과를 먼저 가져오세요.');
 const sourceParcels=G.parcelEntities(doc.entities);
 for(const c of s.sourceParcelGeometry||[])if(!equal(sourceParcels.find(e=>e.id===c.entityId)?.points,c.points))throw Error('원본 대지·도로 경계가 바뀌었습니다. 변경한 대지로 계획을 다시 생성하세요.');
 for(const c of s.contextGeometry||[])if(!equal(doc.entities.find(e=>e.id===c.entityId)?.points,c.points))throw Error('대지·주변 필지가 바뀌었습니다. 새 대지 입력으로 다시 생성하세요.');
 if(doc.entities.some(e=>e.sitePlanId===s.id&&e.sitePlanRoles?.length&&!s.bindings.some(b=>b.entityId===e.id)))throw Error('복사된 배치 다각형이 있습니다. 복사를 취소하거나 새 조건으로 다시 생성하세요.');
 const overrides=clone(s.geometry);
 for(const b of s.bindings){
  const e=doc.entities.find(e=>e.id===b.entityId),points=b.stall!=null&&e?.type==='block'?stallRing(e,b.stall,b.shift):e?.points;
  if(!e||!points||b.stall==null&&(!['polyline','rectangle','hatch'].includes(e.type)||e.type==='polyline'&&!e.closed))throw Error('배치 경계가 삭제되거나 열렸습니다. 닫힌 다각형으로 복원하세요.');
  if(!equal(points,b.originalPoints))put(overrides,b.path,ring(points.map(p=>[(p.x-s.offset.x)/1000+s.origin.x,(p.y-s.offset.y)/1000+s.origin.y])));
 }
 const {site,zoning,program}=s.request;return {site:clone(site),zoning:clone(zoning),program:clone(program),overrides};
}
export function sitePlanStatus(doc){
 if(!doc.sitePlan)return {stale:false,label:'다각형 편집 후 재검증 지원'};
 if(doc.sitePlan.contract?.drawingSnapshot&&!equal(contractDrawingSnapshot(doc),doc.sitePlan.contract.drawingSnapshot))return {stale:true,label:'수정 전 결과 · 재검증 필요'};
 try{return {stale:!equal(validationPayload(doc).overrides,doc.sitePlan.validatedOverrides),label:equal(validationPayload(doc).overrides,doc.sitePlan.validatedOverrides)?'검증 결과':'수정 전 결과 · 재검증 필요'};}catch(e){return {stale:true,label:'수정 전 결과 · '+e.message};}
}
export async function revalidateSitePlan(doc,api){
 if(doc.sitePlan?.contract?.revalidate===false)throw Error('이 안은 편집 후 재검증을 엔진에서 아직 지원하지 않습니다. 다시 생성해 확인하세요.');
 const payload=validationPayload(doc),report=await api('site-plan/validate',payload);
 if(report.mode!=='validate'||!Array.isArray(report.checks)||!report.geometry)throw Error('재검증 응답 형식을 확인하세요.');
 const state={...clone(doc.sitePlan),report:clone(report),validatedOverrides:clone(payload.overrides)};
 if(state.contract){state.contract.revalidated=true;if(state.contract.drawingSnapshot)state.contract.drawingSnapshot=clone(contractDrawingSnapshot(doc));}
 return state;
}
export function planSummary(report){const n=report.numbers||{},ng=(report.checks||[]).filter(c=>!planCheck(c).ok).map(c=>c.rule+(c.provisional?' [잠정]':''));return `건축 ${n.building_area??'—'}㎡ · 연면적 ${n.gfa??'—'}㎡ · NG ${ng.length}건${ng.length?': '+ng.join(', '):''}`;}

/** 상세 계획: 조건 조합(variants: [{title,patch}])마다 설계엔진 계획안을 받는다. 같은 배치로 수렴한 안은 표시만 한다. */
export async function generatePlanVariants(request,api,variants,{onProgress=()=>{},onPlan=()=>{},signal,onJob,onFallback=onProgress}={}){
 const base=clone(request),plans=[];
 const progress=onJob?event=>onJob({...event,planIndex:plans.length+1,planTotal:variants.length}):undefined;
 for(const {title,patch,valueSources:sources,unsupported} of variants){
  onProgress(`${title} 생성 중 (${plans.length+1}/${variants.length})`);
  const req={...clone(base),program:{...clone(base.program),...patch,parking:{...clone(base.program?.parking||{}),...(patch.parking||{})}}};
  setPlanValueSources(req,planValueSources(base));recordPlanValues(req,patch,sources||'default','상세 계획 조건');
  onJob&&progress({status:'submitting',program:req.program});
  if(unsupported){plans.push({title,request:req,failed:true,unsupported:true,error:unsupported});onPlan(plans.at(-1),plans.length-1);continue;}
  let result;
  // 한 안을 엔진이 거부해도(아직 지원하지 않는 조건 등) 나머지 안은 계속 만든다.
  try{result=await generateSitePlan(req,api,{onProgress,onFallback,signal,onJob:onJob?progress:undefined});}catch(error){if(error.name==='AbortError')throw error;plans.push({title,request:req,failed:true,error:String(error?.message||error)});onPlan(plans.at(-1),plans.length-1);continue;}
  const duplicate=plans.find(p=>!p.failed&&equal(p.result.report.geometry,result.report.geometry));
  plans.push({title,note:duplicate?`${duplicate.title}과 같은 배치로 수렴`:'',request:req,result,duplicate:!!duplicate});
  // 한 안이 끝날 때마다 알린다(상세 계획 창이 카드를 하나씩 채운다).
  onPlan(plans.at(-1),plans.length-1);
 }
 return plans;
}
export async function generateAlternativePlans(request,api,{fixedFloors=false,onProgress=()=>{},signal,onJob,onFallback=onProgress}={}){
 const base=clone(request),z=base.zoning||{},ps=base.site.parcel;
 const area=Math.abs(ps.reduce((s,p,i)=>{const q=ps[(i+1)%ps.length];return s+(p[0]-ps[0][0])*(q[1]-ps[0][1])-(q[0]-ps[0][0])*(p[1]-ps[0][1]);},0))/2;
 if(!(z.far>0&&z.bcr>0)){const result=await generateSitePlan(base,api,{onProgress,onFallback,signal,onJob});if(isContract10(result))return contractCandidates(base,result);throw Error('3안 비교에는 확인된 용적률·건폐율 기준이 필요합니다. 토지정보를 다시 조회하세요.');}
 const ceiling=area*z.far/100,requested=base.program.floors||3;
 // A search range, not a legal storey limit. Every result is checked by the provider.
 const searchTop=fixedFloors?requested:Math.max(requested,Math.ceil(z.far/Math.max(1,z.bcr-1)));
 if(searchTop>30)throw Error('30층을 넘는 계획은 층수 조건을 지정한 뒤 비교하세요.');
 const specs=[['1안 · 용적률 확보형',{floors:searchTop,floors_search:!fixedFloors,target_gfa:ceiling,massing:'max1f'}],
 ['2안 · 건축면적 우선형',{floors:requested,floors_search:false,target_gfa:ceiling,massing:'max1f'}],
 ['3안 · 주차·동선 우선형',{floors:requested,floors_search:false,target_gfa:ceiling,massing:'uniform',parking:{...base.program.parking,mode:'front',layout:'single'}}]];
 const plans=[];
 const progress=onJob?event=>onJob({...event,planIndex:plans.length+1,planTotal:specs.length}):undefined;
 for(const [title,patch] of specs){
  onProgress(title+' 생성 중');let req={...clone(base),program:{...clone(base.program),...patch}};
  setPlanValueSources(req,planValueSources(base));
  const automatic={floors_search:patch.floors_search,target_gfa:patch.target_gfa,massing:patch.massing,...(patch.parking?{parking:{mode:patch.parking.mode,layout:patch.parking.layout}}:{})};
  if(!fixedFloors&&plans.length===0)automatic.floors=patch.floors;
  recordPlanValues(req,automatic);
  onJob&&progress({status:'submitting',program:req.program});
  let result=await generateSitePlan(req,api,{onProgress,onFallback,signal,onJob:onJob?progress:undefined});
  if(isContract10(result))return contractCandidates(req,result);
  if(plans.length===0){
   const candidates=(result.report.alternatives||[]).filter(c=>c.all_ok&&Number.isFinite(c.gfa)).sort((a,b)=>b.gfa-a.gfa);
   const best=candidates[0];
   if(best&&!best.chosen){
    const chosen={floors:best.floors,floors_search:false,shape:best.shape,massing:best.massing,parking:{mode:best.mode,layout:best.layout}},previous=planValueSources(req);
    req.program={...req.program,...chosen,parking:{...req.program.parking,...chosen.parking}};
    recordPlanValues(req,chosen,'confirmed','엔진 탐색 후보 선택값');
    const updated=planValueSources(req);for(const [key,record]of Object.entries(previous))if(equal(record.value,updated[key]?.value))updated[key]=record;
    setPlanValueSources(req,updated);result=await generateSitePlan(req,api,{onProgress,onFallback,signal,onJob:onJob?progress:undefined});
    if(isContract10(result))return contractCandidates(req,result);
   }
  }
  if(req.program.floors_search===false&&result.report.numbers.floors!==req.program.floors)throw Error(title+'의 층수가 요청과 다릅니다. 결과를 넣지 않았습니다.');
  const duplicate=plans.find(p=>equal(p.result.report.geometry,result.report.geometry));
  const note=duplicate?`${duplicate.title}과 동일한 배치로 수렴 · 별도 대안 확보 못함`:plans.length===0?'탐색 후보 중 연면적 우선 · 법정 최대 달성 보장 아님':plans.length===1?'1층 면적 확보 우선':'전면 단열 주차·동일 층형상 우선 · 동선 검토 필요';
  plans.push({title,note,request:req,result});
 }
 return plans;
}

export function attachAlternativePlans(current,plans){
 if(plans[0]?.result?.contract?.contract_version==='1.0'){const p=plans.find(p=>!p.failed);if(!p)throw Error('성립하는 계획안이 없습니다.');return attachSitePlan(current,p.request,p.result,{planId:p.planId});}
 let doc=clone(current);const states=[];
 for(const plan of plans){
  doc=attachSitePlan(doc,plan.request,plan.result);doc.sitePlan.alternativeTitle=plan.title;doc.sitePlan.alternativeNote=plan.note;
  const header=doc.entities.find(e=>e.sitePlanId===doc.sitePlan.id&&e.buildingOverview&&e.text==='건축개요');header.text=plan.title+' · 건축개요';
  states.push(clone(doc.sitePlan));
 }
 doc.sitePlanAlternatives=states;doc.sitePlan=clone(states[0]);
 return doc;
}
