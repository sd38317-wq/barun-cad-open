// 도면 인식 ②~⑤ — 배치도 읽기·층 평면 정리·검산·확인 필요 목록(2026-10-27 대표 승인, 시안 docs/시안-도면인식-단계-2026-10-27, 결정 docs/adr/0001).
// 층 평면 자체는 바른 서버의 "남의 도면 읽기"(compute plan.foreignRead)가 읽는다. 여기서는 그 결과를 줄이고, 배치도·치수·면적을 맞춰 보고,
// 못 읽었거나 맞지 않는 것을 한 목록으로 모은다. 추측해 채우지 않는다: 모르면 null 과 이유.
// 결과는 reviewSettings.drawingRecognition 한 곳(건축개요는 building-overview.js 의 buildingOverview).
import * as G from './geometry.js';
import {collectTexts,storedOverview,applyOverviewEdits,overviewSettings,overviewLabel} from './building-overview.js';

/** 검산 허용 차이(대표 2026-10-27 "그걸로"): 치수 ±10 mm · 면적 ±1%. */
export const RECOGNITION_TOLERANCE=Object.freeze({mm:10,ratio:0.01});

const SITE_TITLE=/^[\s\d.\-]*(대지\s*)?배\s*치\s*도(?![가-힣])/;
const SITE_LAYER=/SITE|대지|경계|BND|BOUND|부지/i;
const BUILDING_LAYER=/WALL|벽|BLDG|건물|BUILD|외곽|OUTLINE/i;
const NORTH_BLOCK=/north|방위|^n$|북/i;
const m2=a=>Math.round(a/1e4)/100;
const inside=(b,o)=>b.minX>=o.minX&&b.maxX<=o.maxX&&b.minY>=o.minY&&b.maxY<=o.maxY;
const grow=(b,k)=>{const d=Math.max(b.maxX-b.minX,b.maxY-b.minY)*k;return {minX:b.minX-d,minY:b.minY-d,maxX:b.maxX+d,maxY:b.maxY+d};};
const boxOf=([a,b])=>({minX:Math.min(a.x,b.x),minY:Math.min(a.y,b.y),maxX:Math.max(a.x,b.x),maxY:Math.max(a.y,b.y)});

// shortcut: 맨 위 닫힌 폴리선·사각형만 본다(블록 안 대지선·호 섞인 선은 못 읽음 → 확인 필요). 그런 도면이 나오면 블록 펼치기를 더한다.
function closedShapes(doc){
 const names=new Map((doc?.layers||[]).map(l=>[l.id,l.name]));
 return (doc?.entities||[]).filter(e=>(e.type==='rectangle'||(e.type==='polyline'&&e.closed))&&e.points?.length>=3)
  .map(e=>({id:e.id,layer:names.get(e.layer)||String(e.layer??''),area:G.polygonArea(e.type==='rectangle'&&e.points.length===2?[e.points[0],{x:e.points[1].x,y:e.points[0].y},e.points[1],{x:e.points[0].x,y:e.points[1].y}]:e.points),box:G.bounds([e])})).filter(s=>s.box);
}

/** ② 배치도: "배치도" 제목 위 그림(또는 윈도우 두 점 안)에서 대지 경계·건물 윤곽·정북. 면적은 ㎡. */
export function readSitePlan(doc,{window=null}={}){
 const shapes=closedShapes(doc),confirm=[];let status,region,title=null;
 if(window){status='window';region=boxOf(window);}
 else{
  const titles=collectTexts(doc?.entities).filter(t=>t.text.length<=20&&SITE_TITLE.test(t.text)&&!/구적|범례/.test(t.text));
  const uniq=titles.filter((t,i)=>!titles.slice(0,i).some(o=>Math.hypot(o.x-t.x,o.y-t.y)<o.h*10));
  if(!uniq.length)return {status:'none',title:null,lot:null,building:null,north:null,region:null,confirm:[{key:'site',reason:'"배치도" 제목을 찾지 못함 — [윈도우로 감싸 읽기]로 배치도를 감싸 주세요'}]};
  if(uniq.length>1)return {status:'many',title:null,lot:null,building:null,north:null,region:null,confirm:[{key:'site',reason:`"배치도" 제목이 ${uniq.length}개 — [윈도우로 감싸 읽기]로 하나를 감싸 주세요`}]};
  title=uniq[0];status='title';
  // 제목은 그림 아래: 제목 위로 붙어 있고 제목을 품지 않는(도곽 아님) 닫힌 선
  const near=shapes.filter(s=>{const w=s.box.maxX-s.box.minX,h=s.box.maxY-s.box.minY;
   return s.area>=2e7&&s.box.minY>=title.y-title.h&&s.box.minY-title.y<=Math.max(title.h*40,h*0.6)&&title.x>=s.box.minX-w*0.5&&title.x<=s.box.maxX+w*0.5;});
  const lot0=near.filter(s=>SITE_LAYER.test(s.layer)).sort((a,b)=>b.area-a.area)[0]||near.sort((a,b)=>b.area-a.area)[0];
  region=lot0?grow(lot0.box,0.02):null;
 }
 const inRegion=region?shapes.filter(s=>inside(s.box,region)):[];
 const lotShape=inRegion.filter(s=>s.area>=2e7&&SITE_LAYER.test(s.layer)).sort((a,b)=>b.area-a.area)[0]||inRegion.filter(s=>s.area>=2e7).sort((a,b)=>b.area-a.area)[0]||null;
 const lot=lotShape?{area:m2(lotShape.area),layer:lotShape.layer,id:lotShape.id,bounds:lotShape.box,evidence:`배치도 · ${SITE_LAYER.test(lotShape.layer)?'대지 레이어':'가장 큰'} 닫힌 선(레이어 ${lotShape.layer||'없음'})`}:null;
 if(!lot)confirm.push({key:'lot',reason:'대지 경계(닫힌 선)를 찾지 못함 — 대지선이 닫힌 폴리선인지 보거나 윈도우로 다시 감싸 주세요'});
 let building=null;
 if(lotShape){
  const cand=inRegion.filter(s=>s!==lotShape&&s.area>=1e7&&s.area<lotShape.area*0.95&&inside(s.box,lotShape.box)),hinted=cand.filter(s=>BUILDING_LAYER.test(s.layer)).sort((a,b)=>b.area-a.area);
  const pick=hinted[0]||(cand.length===1?cand[0]:null);
  if(pick)building={area:m2(pick.area),layer:pick.layer,id:pick.id,bounds:pick.box,evidence:`배치도 · 대지 안 닫힌 선(레이어 ${pick.layer||'없음'})`};
  else confirm.push({key:'building',reason:cand.length?`대지 안 닫힌 선 ${cand.length}개 중 건물 윤곽을 모름(벽·건물 레이어 아님)`:'대지 안에 건물 윤곽(닫힌 선)이 없음'});
 }
 // 정북: 방위 블록(이름 north·방위)의 회전. 0° = 위쪽이 북(블록을 위가 북으로 그렸다고 본다). 블록 회전은 도(°), 반시계가 +
 const area=lotShape?grow(lotShape.box,0.3):region,arrow=area&&(doc?.entities||[]).find(e=>e.type==='block'&&NORTH_BLOCK.test(e.name||'')&&e.position&&e.position.x>=area.minX&&e.position.x<=area.maxX&&e.position.y>=area.minY&&e.position.y<=area.maxY);
 let north=null;
 if(arrow){const deg=Math.round(((-(Number(arrow.rotation)||0))%360+540)%360-180);north={degrees:deg,text:deg===0?'위쪽이 북':`위쪽에서 ${Math.abs(deg)}° ${deg>0?'시계':'반시계'} 방향`,evidence:`배치도 · 방위 블록 ${arrow.name}`};}
 return {status,title:title?.text||null,lot,building,north,region,confirm};
}

// ── 치수 ──
function dimInfo(e){
 if(e?.type!=='dimension'||!Array.isArray(e.points)||e.points.length<2)return null;
 const [a,b]=e.points,dx=Math.abs(b.x-a.x),dy=Math.abs(b.y-a.y);
 const horizontal=e.mode==='horizontal'||(e.mode==='aligned'&&dx>=dy),vertical=e.mode==='vertical'||(e.mode==='aligned'&&dy>dx);
 if(!horizontal&&!vertical)return null;
 // 고친 글자(예: "3,600")가 있으면 그 숫자가 원 도면 설계자의 값이다
 const t=String(e.text??'').replace(/\\[A-Za-z][^;]*;/g,'').trim(),m=t&&!t.includes('<>')?/(\d[\d,]*(?:\.\d+)?)/.exec(t):null;
 const value=m?Number(m[1].replace(/,/g,'')):(horizontal?dx:dy)*(Number(e.measurementScale)||1);
 const line=e.points[2]||a;
 return {horizontal,value,lo:horizontal?Math.min(a.x,b.x):Math.min(a.y,b.y),hi:horizontal?Math.max(a.x,b.x):Math.max(a.y,b.y),line:horizontal?line.y:line.x};
}
/** 한 층 평면 범위의 네 면: 가장 바깥 줄 하나짜리 치수(전체) = 같은 길이를 덮는 안쪽 연속치수 합? */
export function dimensionChecks(doc,box,tol=RECOGNITION_TOLERANCE){
 const dims=(doc?.entities||[]).filter(e=>e.type==='dimension'&&e.points?.slice(0,2).every(p=>p.x>=box.minX&&p.x<=box.maxX&&p.y>=box.minY&&p.y<=box.maxY)).map(dimInfo).filter(Boolean);
 const cx=(box.minX+box.maxX)/2,cy=(box.minY+box.maxY)/2,out=[];
 for(const [side,horizontal,outer] of [['위',true,1],['아래',true,-1],['오른쪽',false,1],['왼쪽',false,-1]]){
  const mid=horizontal?cy:cx,mine=dims.filter(d=>d.horizontal===horizontal&&(d.line-mid)*outer>0).sort((a,b)=>(b.line-a.line)*outer),rows=[];
  for(const d of mine){const r=rows.at(-1);if(r&&Math.abs(r[0].line-d.line)<=50)r.push(d);else rows.push([d]);}
  const overall=rows[0]?.length===1?rows[0][0]:null;if(!overall)continue;
  const span=overall.hi-overall.lo,near=v=>Math.abs(v)<=span*tol.ratio;
  const chain=rows.slice(1).find(r=>r.length>=2&&near(Math.min(...r.map(d=>d.lo))-overall.lo)&&near(Math.max(...r.map(d=>d.hi))-overall.hi));
  if(!chain)continue;
  const sum=Math.round(chain.reduce((s,d)=>s+d.value,0)),total=Math.round(overall.value);
  out.push({side,sum,total,ok:Math.abs(sum-total)<=tol.mm});
 }
 return out;
}

// ── ③ 층 평면 ──
/** 남의 도면 읽기 결과(compute foreignRead) + 층고(officeFloors) → 저장할 층 목록(좌표 없이 면적·실 수·범위만). */
export function floorRows(foreign,office=[],doc=null){
 const heights=new Map((office||[]).map(o=>[o.title,o.height]));
 return (foreign?.floors||[]).map((f,i)=>{
  const roomArea=(f.rooms||[]).reduce((s,r)=>s+Math.abs(r.area||0),0),outdoor=(f.outline?.outdoorCandidates||[]).length;
  const label=f.label||f.title||`평면 ${i+1}`;
  // id 는 층 이름 + 도곽 순번: 다시 읽어도 같은 층이면 같은 id 라 지난 답이 남는다
  return {id:`${label}@${f.sheet??'w'}`,label,floors:f.floors||[],roof:!!f.roof,title:f.title||'',sheet:f.sheet??null,box:f.box||null,wallLayer:f.wallLayer||null,
   area:f.outline?m2(f.outline.area):null,rooms:(f.rooms||[]).length,roomArea:roomArea?m2(roomArea):null,height:heights.get(f.title)??null,
   outdoor,unresolved:(f.unresolved||[]).map(u=>u.reason||String(u)),dims:doc&&f.box?dimensionChecks(doc,f.box):[]};
 });
}
/** 연면적에 넣는 층인가: 지붕·옥탑은 설계자가 "층으로 셈"이라고 답했을 때만. */
export const countsAsFloor=(f,answers={})=>f.roof?answers[`roof:${f.id}`]?.value==='floor':true;
const repeat=f=>Math.max(1,f.floors.length);

/** 층 평면 → 인허가 도서 "③ 층 평면 정리"(energyPlanRegions 의 층)와 같이 쓰는 범위. 설계자가 손으로 고른 층 범위는 덮지 않는다. */
export function floorRegions(existing,floors){
 const keep=(existing||[]).filter(r=>!(r.kind==='floor'&&r.source==='도면 인식')),taken=new Set(keep.filter(r=>r.kind==='floor').map(r=>r.floor)),add=[];
 for(const f of floors)if(f.box&&!f.roof)for(const n of f.floors)if(Number.isInteger(n)&&n!==0&&!taken.has(n)){taken.add(n);
  add.push({kind:'floor',floor:n,bounds:{minX:f.box.minX,minY:f.box.minY,maxX:f.box.maxX,maxY:f.box.maxY},key:'floor:'+n,label:n<0?`지하${-n}층`:`${n}층`,source:'도면 인식'});}
 return [...keep,...add];
}

// ── ④ 검산 ──
const areaOk=(a,b,tol)=>Math.abs(a-b)<=Math.abs(b)*tol.ratio;
/** 맞춰 볼 것 다섯 줄. state: ok·fail·skip(한쪽 값이 없어 못 맞춤). */
export function recognitionChecks({overview={},site=null,floors=[],answers={}},tol=RECOGNITION_TOLERANCE){
 const out=[],v=overview.values||{};
 const sides=floors.flatMap(f=>(f.dims||[]).map(d=>({...d,floor:f})));
 const bad=sides.filter(d=>!d.ok);
 out.push({id:'dims',label:'연속치수 합 = 전체치수',state:!sides.length?'skip':bad.length?'fail':'ok',
  detail:!sides.length?'층 평면에서 전체치수와 연속치수 짝을 찾지 못함':bad.length?bad.map(d=>`${d.floor.label} ${d.side}: 합 ${d.sum.toLocaleString()} ≠ 전체 ${d.total.toLocaleString()}`).join(' · '):`${new Set(sides.map(d=>d.floor.id)).size}개 층 ${sides.length}면 모두 맞음`,
  where:bad[0]?.floor.box||null});
 const rooms=floors.filter(f=>f.area&&f.roomArea!=null),roomBad=rooms.filter(f=>!areaOk(f.roomArea,f.area,tol));
 out.push({id:'rooms',label:'실 면적 합 = 층 바닥면적',state:!rooms.length?'skip':roomBad.length?'fail':'ok',
  detail:!rooms.length?'실이나 바닥면적을 읽은 층이 없음':roomBad.length?roomBad.map(f=>`${f.label} 실 합 ${f.roomArea} ㎡ / 바닥 ${f.area} ㎡ (${(f.roomArea-f.area).toFixed(1)})`).join(' · '):`${rooms.length}개 층 모두 차이 1% 안`,
  where:roomBad[0]?.box||null});
 const counted=floors.filter(f=>countsAsFloor(f,answers)),sum=counted.every(f=>f.area!=null)&&counted.length?Math.round(counted.reduce((s,f)=>s+f.area*repeat(f),0)*100)/100:null;
 const pair=(id,label,left,right,leftText,rightText)=>out.push({id,label,state:left==null||right==null||right===''?'skip':areaOk(left,Number(right),tol)?'ok':'fail',
  detail:left==null?`${leftText} 없음`:right==null||right===''?`개요표 ${rightText} 없음`:`${leftText} ${left} ㎡ / 개요표 ${rightText} ${right} ㎡ (차이 ${(Math.abs(left-right)/Math.abs(right)*100).toFixed(1)}%)`,where:null});
 pair('gfa','층 바닥면적 합 = 개요 연면적',sum,v.gfa,'층 합','연면적');
 pair('site','배치 대지 = 개요 대지면적',site?.lot?.area??null,v.siteArea,'배치 대지','대지면적');
 pair('building','배치 건물 윤곽 = 개요 건축면적',site?.building?.area??null,v.buildingArea,'배치 건물 윤곽','건축면적');
 return out;
}

// ── ⑤ 확인 필요 ──
/** ①~④에서 사람이 볼 것 한 목록. 답(answers[id])이 있으면 빠진다. choices 가 없으면 [이대로 둠]만. */
export function recognitionNeeds({overview={},site=null,floors=[],checks=[],floorError=null,answers={}}){
 const out=[];
 for(const c of overview.confirm||[])out.push({id:`ov:${c.key}`,step:1,title:c.key==='floors'?'층수':overviewLabel(c.key),text:c.reason,go:1});
 for(const c of overview.conflicts||[])out.push({id:`ovc:${c.key}`,step:1,title:overviewLabel(c.key),text:`이미 넣은 값 ${c.mine} · 다시 읽은 값 ${c.read}`,conflict:c});
 for(const c of site?.confirm||[])out.push({id:`site:${c.key}`,step:2,title:'배치도',text:c.reason,go:2,where:site?.region||null});
 if(floorError)out.push({id:'floors:error',step:3,title:'층 평면',text:floorError,go:3});
 else if(!floors.length)out.push({id:'floors:none',step:3,title:'층 평면',text:'도곽 이름·그림 제목("1층 평면도")으로 층 평면을 찾지 못함 — [층 하나 더 감싸기]로 층마다 감싸 주세요',go:3});
 for(const f of floors){
  if(f.roof&&f.rooms)out.push({id:`roof:${f.id}`,step:3,title:f.label,text:`제목 "${f.title}" — 층 평면(연면적에 넣음)인지 지붕·옥탑(뺌)인지`,choices:[['floor','층으로 셈'],['roof','지붕·옥탑']],where:f.box});
  f.unresolved.forEach((r,i)=>out.push({id:`fl:${f.id}:${i}`,step:3,title:f.label,text:r,where:f.box}));
  if(f.outdoor)out.push({id:`out:${f.id}`,step:3,title:f.label,text:`실 밖 열린 공간 ${f.outdoor}곳(바깥 발코니·테라스 후보)을 바닥면적에 넣어 둠 — 빼야 하면 그 층을 다시 감싸거나 개요에서 고치세요`,where:f.box});
 }
 for(const c of checks)if(c.state==='fail')out.push({id:`chk:${c.id}`,step:4,title:c.label,text:c.detail,where:c.where,note:true});
 return out.filter(n=>!answers[n.id]);
}

// ── 저장·한 벌 결과(창과 AI 도구가 같이 씀) ──
/** 저장된 ②~⑤ 결과. 없으면 빈 것. */
export function storedRecognition(doc){
 const s=doc?.reviewSettings?.drawingRecognition;
 return structuredClone({readAt:null,site:null,floors:[],floorError:null,answers:{},...(s||{})});
}
/** 개요(①)와 ②~④를 합쳐 검산·확인 필요까지 붙인 한 벌. */
export function recognitionResult(doc,overview){
 const rec=storedRecognition(doc),checks=recognitionChecks({overview,site:rec.site,floors:rec.floors,answers:rec.answers});
 return {...rec,checks,needs:recognitionNeeds({overview,site:rec.site,floors:rec.floors,checks,floorError:rec.floorError,answers:rec.answers})};
}
/** 다시 읽은 ②·③ → 저장할 값. 지난 답은 같은 줄(id)이 남아 있으면 그대로 둔다. floors 를 안 주면(서버 못 씀) 지난 층 목록을 지운다. */
export function recognitionSettings(doc,{site,floors=[],floorError=null,now=new Date().toISOString()}){
 const prev=storedRecognition(doc);
 return {drawingRecognition:{readAt:now,site,floors,floorError,answers:prev.answers},
  energyPlanRegions:floorRegions(doc?.reviewSettings?.energyPlanRegions,floors)};
}
/** 층 평면 읽기는 바른 서버(로그인). 실패하면 {floorError} — 쉬운 말 이유. window 를 주면 그 범위만(한 층 다시 감싸기). */
export async function readFloorsFromServer(doc,{window=null,label=''}={}){
 let reading=null;try{const r=await fetch('/drawing-knowledge.json',{cache:'no-store'});if(r.ok)reading=(await r.json()).standard?.planReading||null;}catch{}
 const C=await import('./compute-client.js');
 try{
  if(window){
   // shortcut: 감싼 범위와 겹치는 객체만 보내 한 장으로 읽고 첫 층만 쓴다. 범위 안에 평면이 둘이면 실이 많은 쪽 — 그때는 더 좁게 감싸게 안내.
   const box=boxOf(window),rect={type:'rectangle',points:[{x:box.minX,y:box.minY},{x:box.maxX,y:box.maxY}]};
   const r=await C.foreignRead(C.boxDocument(doc,[rect]),reading,{fileName:label});
   const f=r.floors[0];if(!f)return {floorError:'감싼 범위에서 벽으로 닫힌 평면을 찾지 못했습니다.'};
   return {foreign:{floors:[{...f,box}]},office:[]};
  }
  const [foreign,office]=await Promise.all([C.foreignRead(doc,reading),C.officeFloors(doc,reading).catch(()=>[])]);
  return {foreign,office};
 }catch(e){return {floorError:e?.code==='not_logged_in'?C.COMPUTE_LOGIN_GUIDE:(e?.message||'층 평면을 읽지 못했습니다.')};}
}

// ── AI 도구(cad_recognize_drawing · cad_get_recognition) ──
/** AI 에게 줄 결과(좌표 없이). */
export function recognitionForAI(doc){
 const overview=storedOverview(doc),r=recognitionResult(doc,overview);
 return {readAt:r.readAt||overview.readAt||null,
  overview:{values:overview.values,evidence:overview.evidence},
  site:r.site&&{status:r.site.status,lotArea:r.site.lot?.area??null,lotEvidence:r.site.lot?.evidence??null,buildingArea:r.site.building?.area??null,buildingEvidence:r.site.building?.evidence??null,north:r.site.north?.text??null},
  floors:r.floors.map(({id,label,floors,roof,title,area,rooms,roomArea,height,unresolved,outdoor})=>({id,label,floors,roof,title,area,rooms,roomArea,height,unresolved,outdoor})),floorError:r.floorError,
  checks:r.checks.map(({id,label,state,detail})=>({id,label,state,detail})),
  needs:r.needs.map(n=>({id:n.id,step:n.step,title:n.title,text:n.text,
   ...(n.conflict?{choices:[['mine',`지금 값 ${n.conflict.mine}`],['read',`다시 읽은 값 ${n.conflict.read}`]]}:n.choices?{choices:n.choices}:n.id.startsWith('ov:')?{answer:'그 칸 값'}:{answer:'keep + note(이유)'})}))};
}
/** 확인 필요 한 줄에 답 → 저장할 review.settings. 없는 id·맞지 않는 값은 쉬운 말 Error. */
export function recognitionAnswerSettings(doc,{id,value,note=''}){
 const overview=storedOverview(doc),need=recognitionResult(doc,overview).needs.find(n=>n.id===id);
 if(!need)throw Error(`확인 필요 목록에 '${id}' 가 없습니다. cad_get_recognition 의 needs[].id 를 쓰세요.`);
 if(need.conflict){if(value!=='mine'&&value!=='read')throw Error("이 줄의 value 는 'mine'(지금 값) 또는 'read'(다시 읽은 값)입니다.");const c=need.conflict,read=value==='read';
  return overviewSettings(doc,applyOverviewEdits(overview,{[c.key]:read?c.read:c.mine},read?c.readEvidence:(c.mineEvidence||'설계자 입력')));}
 if(id.startsWith('ov:')){const key=id.slice(3)==='floors'?'floorsAbove':id.slice(3);if(value==null||value==='')throw Error(`'${overviewLabel(key)}' 값을 value 로 주세요.`);
  return overviewSettings(doc,applyOverviewEdits(overview,{[key]:value},'설계자 입력(AI 대화)'));}
 if(need.choices&&!need.choices.some(([v])=>v===value))throw Error(`이 줄의 value 는 ${need.choices.map(([v,l])=>`'${v}'(${l})`).join(' 또는 ')}입니다.`);
 if(!need.choices&&value!=='keep')throw Error("이 줄은 value 'keep' 과 note(이대로 두는 이유)로 답합니다.");
 const rec=storedRecognition(doc);rec.answers={...rec.answers,[id]:{value,note:String(note||''),at:new Date().toISOString()}};
 return {drawingRecognition:rec};
}
