import * as G from './geometry.js';
import {APPLICABILITY,PROGRESS,reviewValue,makeReviewItem,compareCriterion,nextReviewObjectId,appendReviewHistory} from './review-model.js';
// 모두 mm. 법령 대조 전 기본값은 충족 판정을 내리지 않는다.
export const ACCESS_DEFAULTS=Object.freeze({doorClearMinMm:900,rampSlopeMax:1/12,rampWidthMinMm:1200,rampLandingMinMm:1500,turnDiameterMm:1400,toiletSideMinMm:750,toiletFrontMinMm:600,pathWidthMinMm:1200,pathStepMaxMm:0});
const finite=n=>typeof n==='number'&&Number.isFinite(n);
const read=(value,unit='mm',sourceKind='auto_read')=>reviewValue({value:finite(value)?value:null,unit,sourceKind,confirmation:finite(value)?'confirmed':'unconfirmed'});
export const doorClearWidth=(opening,frame,leaf)=>[opening,frame,leaf].every(finite)&&opening>=0&&frame>=0&&leaf>=0?Math.max(0,opening-2*frame-leaf):null;
// 받은 자료만 검사한다. 목록에는 실폭 정보가 없으므로 미검사는 null.
export function assetDoorReview(asset){
 const scenes=asset?.geometry?[asset.geometry]:Array.isArray(asset?.entities)?[asset]:asset?.scenes||[];let count=0,known=0,min=null;
 const flatten=e=>e.entities&&!e.cardOpening&&!e.reviewInput&&!['DOOR','door'].includes(e.category||e.type)?e.entities.flatMap(flatten):[e];
 for(const scene of scenes){const drawing=scene.sharedBlocks?G.expandSharedDrawingBlocks(scene):scene;const result=accessReview({entities:(drawing.entities||[]).flatMap(flatten)});for(const i of result.items)if(i.reviewObjectIds.some(id=>/^D-/.test(id))&&i.id.endsWith(':width')){count++;if(i.current.value!==null){known++;min=min===null?i.current.value:Math.min(min,i.current.value);}}}
 const missing=!count||known!==count,current=read(missing?null:min),criterion={value:900,unit:'mm',operator:'>='},compared=compareCriterion(current,criterion);
 return makeReviewItem({id:'access:asset-door-width',field:'access',name:'자료 문 실폭',current,criterion,...compared,...(missing?{status:min!==null&&min<900?'revise':'need_input',reason:min!==null&&min<900?'확인된 문 실폭 900 mm 미만':'문 실폭 입력 필요'}:{}),unknowns:missing?['확인하지 못한 문 실폭']:[],applicability:APPLICABILITY.applicable,progress:asset?PROGRESS.done:PROGRESS.not_run});
}
export const doorReviewBadge=item=>item.status==='revise'?'■ 미만':item.status==='satisfied'?'● 900 이상':'▲ 입력 필요';
const sweep=a=>G.normalizeAngle(a.endAngle-a.startAngle)||360;
// 호 끝점과 힌지가 맞는 문짝선만 읽는다. 끝점 공간 버킷 사용.
export function readExternalDoors(entities){
 const buckets=new Map(),key=(p,len,layer)=>Math.floor(p.x/4)+','+Math.floor(p.y/4)+','+Math.round(len/4)+','+layer;
 for(const e of entities){if(Object.hasOwn(e.reviewInput||{},'openingWidthMm'))continue;let a,b,thickness=0;
  if(e.type==='line'&&e.points?.length===2)[a,b]=e.points;
  else if(['polyline','rectangle'].includes(e.type)&&e.points?.length===4&&(e.closed||e.type==='rectangle')){const p=e.points,l=p.map((a,i)=>G.dist(a,p[(i+1)%4])),j=l[0]<l[1]?0:1;if(l[j]>100||l[(j+1)%4]<300||Math.abs(l[j]-l[(j+2)%4])>2)continue;a=G.mul(G.add(p[j],p[(j+1)%4]),.5);b=G.mul(G.add(p[(j+2)%4],p[(j+3)%4]),.5);thickness=l[j];}
  if(!a||!b)continue;const len=G.dist(a,b);for(const p of [a,b]){const k=key(p,len,e.layer);if(!buckets.has(k))buckets.set(k,[]);buckets.get(k).push({entity:e,a,b,thickness});}
 }
 const doors=[];
 for(const arc of entities){if(arc.type!=='arc'||Object.hasOwn(arc.reviewInput||{},'openingWidthMm')||!arc.center||!finite(arc.radius)||arc.radius<300||arc.radius>3000||Math.abs(sweep(arc)-90)>1)continue;
  const c=arc.center,tips=[arc.startAngle,arc.endAngle].map(a=>G.add(c,G.polar(arc.radius,a)));let leaf;
  for(let x=-1;x<=1&&!leaf;x++)for(let y=-1;y<=1&&!leaf;y++)for(let z=-1;z<=1&&!leaf;z++)leaf=(buckets.get(key({x:c.x+x*4,y:c.y+y*4},arc.radius+z*4,arc.layer))||[]).find(e=>[e.a,e.b].some(p=>G.dist(p,c)<=2)&&[e.a,e.b].some(p=>tips.some(t=>G.dist(p,t)<=2)));
  if(leaf)doors.push({entity:arc,parts:[arc,leaf.entity],input:{...arc.reviewInput,openingWidthMm:null,frameWidthMm:null,leafThicknessMm:leaf.thickness,clearWidthMm:arc.radius-leaf.thickness,swing:[arc],external:true}});
 }
 return doors;
}
// 회전 부채꼴과 원·사각형의 겹침. 열림 중 지나가는 면도 검사.
export function swingInvades(s,space){
 const c=s.center;if(!c||!finite(s.radius))return false;
 const inside=p=>{const angle=G.normalizeAngle(Math.atan2(p.y-c.y,p.x-c.x)*180/Math.PI-s.startAngle);return G.dist(c,p)<=s.radius&&angle<=sweep(s);};
 const ends=[s.startAngle,s.endAngle].map(a=>G.add(c,G.polar(s.radius,a)));
 if(space.center&&finite(space.radius)){const p=space.center,d=G.dist(c,p),a=G.normalizeAngle(Math.atan2(p.y-c.y,p.x-c.x)*180/Math.PI-s.startAngle),radial=a<=sweep(s)?Math.max(0,d-s.radius):Infinity;return Math.min(radial,...ends.map(t=>G.distanceToSegment(p,c,t)))<space.radius;}
 const pts=space.points;if(!pts?.length)return false;if(pts.some(inside)||G.inside(c,pts)||ends.some(p=>G.inside(p,pts)))return true;
 for(let i=0;i<pts.length;i++){const a=pts[i],b=pts[(i+1)%pts.length],v=G.sub(b,a),len=G.dot(v,v);if(!len)continue;const u=G.sub(a,c),B=2*G.dot(u,v),C=G.dot(u,u)-s.radius*s.radius,disc=B*B-4*len*C;if(disc>=0)for(const t of [(-B-Math.sqrt(disc))/(2*len),(-B+Math.sqrt(disc))/(2*len)])if(t>=0&&t<=1&&inside(G.add(a,G.mul(v,t))))return true;for(const end of ends){const h=G.lineIntersection(a,b,c,end);if(h&&h.t>=0&&h.t<=1&&h.u>=0&&h.u<=1)return true;}}
 return false;
}
export function accessReview(doc,at=new Date().toISOString()){
 const settings={...ACCESS_DEFAULTS,...doc.reviewSettings?.access},seq={reviewObjectSeq:{...doc.reviewObjectSeq}},updates=[],items=[],groups=new Map(),ramps=[],toilets=[],parks=[],paths=[];
 const entities=doc.entities||[];
 // 기존 번호 충돌 방지. 전체 순회는 명시적 재검토 때만.
 for(const e of entities){const m=/^(D|R|WC|P)-(\d+)$/.exec(e.reviewObjectId||'');if(m){const kind={D:'door',R:'ramp',WC:'toilet',P:'parking'}[m[1]];seq.reviewObjectSeq[kind]=Math.max(seq.reviewObjectSeq[kind]||0,Number(m[2]));}}
 const identify=(e,kind,parts=[e])=>{const id=e.reviewObjectId||nextReviewObjectId(seq,kind);for(const p of parts)if(p.id&&p.reviewObjectId!==id)updates.push({id:p.id,changes:{reviewObjectId:id}});return id;};
 for(const e of entities){const input={...e.reviewInput,...(e.cardOpening?e.entities?.find(p=>p.reviewInput)?.reviewInput:{})};if(Object.hasOwn(input,'openingWidthMm')||input.swing||input.door){const key=e.reviewObjectId||e.reviewInput;if(!groups.has(key))groups.set(key,{entity:e,parts:[],input});groups.get(key).parts.push(e);}else if(e.category==='DOOR'||e.type==='door')groups.set(e.reviewObjectId||e.id,{entity:e,parts:[e],input});
  if(e.category==='RAMP'||input.ramp)ramps.push(e);if(input.disabledToilet||e.category==='DISABLED_TOILET'||/장애인.*화장실/.test(e.name||e.attributes?.name||''))toilets.push(e);if(input.disabledParking||['disabled33','disabled35'].includes(e.parameters?.type))parks.push(e);if(input.walkway)paths.push(e);
 }
 for(const d of readExternalDoors(entities))groups.set(d.entity.reviewObjectId||d.entity.id,d);
 const doors=[...groups.values()].map(d=>{const parts=d.parts.flatMap(e=>e.cardOpening?e.entities.filter(p=>p.reviewInput):[e]),arcs=d.parts.flatMap(e=>e.type==='arc'?[e]:(e.entities||[]).filter(p=>p.type==='arc')),incomplete=d.input.partCount&&(parts.length!==d.input.partCount||parts.some(p=>p.reviewInput&&p.reviewInput.clearWidthMm!==d.input.clearWidthMm));return {...d,id:identify(d.entity,'door',d.parts),input:{...d.input,clearWidthMm:incomplete?null:d.input.clearWidthMm,swing:arcs.length?arcs:d.input.swing||[]}};});
 const row=(id,name,objects,reviewIds,current,criterion,extra={})=>{const result=compareCriterion(current,criterion);const pending=extra.pending&&result.status==='satisfied';items.push(makeReviewItem({id:'access:'+id,field:'access',name,objectIds:objects.filter(Boolean),reviewObjectIds:reviewIds,current,criterion,applicability:APPLICABILITY.applicable,progress:PROGRESS.done,evaluatedAt:at,...result,...(pending?{status:'check_detail',reason:'기준 대조 전'}:{}),nextAction:'입력값·도면·상세와 기준을 확인하세요.',...extra}));};
 for(const d of doors){const excluded=settings.excludedDoors?.includes(d.id)||d.input.excluded===true;row(d.id+':width',d.id+' 문 실폭',d.parts.map(e=>e.id),[d.id],read(d.input.clearWidthMm,'mm',excluded?'designer':'auto_read'),{value:settings.doorClearMinMm,unit:'mm',operator:'>=',name:'실폭'},excluded?{applicability:APPLICABILITY.not_applicable,status:'check_detail',reason:'설계자 제외'}:{});}
 for(const e of ramps){const id=identify(e,'ramp'),v=e.reviewInput||{},p=e.parameters||{},rise=finite(v.riseMm)?v.riseMm:finite(v.startLevelMm)&&finite(v.endLevelMm)?Math.abs(v.endLevelMm-v.startLevelMm):null,run=v.runMm??p.depth,meta={statuteRef:'장애인등편의법 시행규칙 별표1(대조 전)',pending:true};
  row(id+':slope',id+' 경사로 기울기',[e.id],[id],read(rise!==null&&finite(run)&&run>0?Math.abs(rise)/run:null,''),{value:settings.rampSlopeMax,unit:'',operator:'<=',name:'기울기'},rise===null?{...meta,status:'need_input',reason:id+' 상·하부 레벨 미입력'}:{...meta,evidence:rise>0&&finite(run)&&run>0?['기울기 1/'+Number((run/rise).toFixed(3))]:[]});
  for(const [key,name,n,min] of [['width','유효폭',v.clearWidthMm??p.width,settings.rampWidthMinMm],['landing','참',v.landingMm,settings.rampLandingMinMm]])row(id+':'+key,id+' '+name,[e.id],[id],read(n),{value:min,unit:'mm',operator:'>=',name},meta);
 }
 for(const e of toilets){const id=identify(e,'toilet'),v=e.reviewInput||{},spaces=[];if(v.turnCenter)spaces.push({center:v.turnCenter,radius:settings.turnDiameterMm/2});if(v.toiletSideSpace)spaces.push(v.toiletSideSpace);if(v.toiletFrontSpace)spaces.push(v.toiletFrontSpace);
  if(v.toiletAnchor&&v.toiletWidthMm>0&&v.toiletDepthMm>0&&finite(v.toiletRotation)){const rect=(a,b)=>({points:G.rectangle(a,b).map(p=>G.add(v.toiletAnchor,G.polar(G.len(p),G.angle(v.toiletReflected?{x:p.x,y:-p.y}:p)+v.toiletRotation)))});if(!v.toiletSideSpace)spaces.push(rect({x:-settings.toiletSideMinMm,y:0},{x:0,y:v.toiletDepthMm}));if(!v.toiletFrontSpace)spaces.push(rect({x:0,y:-settings.toiletFrontMinMm},{x:v.toiletWidthMm,y:0}));}
  const linked=doors.filter(d=>v.doorIds?.includes(d.id)||d.input.toiletId===id||e.points?.length&&d.input.swing?.some(s=>G.inside(s.center,e.points))),hit=linked.some(d=>(d.input.swing||[]).some(s=>spaces.some(p=>swingInvades(s,p))));
  row(id+':swing',id+' 활동공간', [e.id,...linked.flatMap(d=>d.parts.map(p=>p.id))],[id,...linked.map(d=>d.id)],read(null),{}, {status:hit?'revise':spaces.length===3?'check_detail':'need_input',reason:hit?'문 열림이 활동공간 침범':'활동공간 위치·치수 및 문 연결 확인',statuteRef:'장애인등편의법 시행규칙 별표1(대조 전)'});
  for(const [key,name,n,min] of [['side','변기 옆',v.sideClearMm,settings.toiletSideMinMm],['front','변기 앞',v.frontClearMm,settings.toiletFrontMinMm]])row(id+':'+key,id+' '+name,[e.id],[id],read(n),{value:min,unit:'mm',operator:'>=',name},{pending:true,statuteRef:'장애인등편의법 시행규칙 별표1(대조 전)'});
  row(id+':detail',id+' 손잡이·세면대 하부',[e.id],[id],read(null),{},{status:'check_detail',reason:'평면으로 확인 불가 · 상세 확인'});
 }
 for(const e of parks){const id=identify(e,'parking'),main=doors.filter(d=>d.input.mainEntrance),path=paths.find(p=>p.reviewInput.parkingId===id&&main.some(d=>d.id===p.reviewInput.doorId)),v=path?.reviewInput||{},ids=[id,...(path?[v.doorId]:main.map(d=>d.id))];
  const missing=!path||!finite(v.clearWidthMm)||!finite(v.stepMm);row(id+':path',id+' 주출입구 접근로',[e.id,path?.id,...main.flatMap(d=>d.parts.map(p=>p.id))],ids,read(v.clearWidthMm),{value:settings.pathWidthMinMm,unit:'mm',operator:'>=',name:'통과폭'},missing?{status:'need_input',reason:path?'접근로 통과폭·단차 입력 필요':'보행 접근로 미지정'}:{status:v.clearWidthMm<settings.pathWidthMinMm||Math.abs(v.stepMm)>settings.pathStepMaxMm?'revise':'check_detail',reason:v.clearWidthMm<settings.pathWidthMinMm||Math.abs(v.stepMm)>settings.pathStepMaxMm?'접근로 통과폭·단차 기준 미달':'접근로 연결·기준 상세 확인'});
 }
 row('bf','BF 인증 — 별도 확인',[],[],read(null),{},{status:'check_detail',reason:'BF 인증 — 별도 확인 (판정 안 함)'});
 return {items,updates,reviewObjectSeq:seq.reviewObjectSeq};
}
export function setAccessSettings(doc,changes,at=new Date().toISOString()){
 const prev=doc.reviewSettings?.access||{},next={...prev,...changes};for(const [key,n] of Object.entries(changes))if(Object.hasOwn(ACCESS_DEFAULTS,key)&&(!finite(n)||n<0))throw Error('기준값은 0 이상의 숫자여야 합니다.');
 doc.reviewSettings={...doc.reviewSettings,access:next};appendReviewHistory(doc,{at,targetId:'access:settings',field:'access',prev,next,actor:'designer'});return doc;
}
// 선택 객체에 검토 입력만 기록한다. 빈 숫자는 null, 도형은 그대로 보존.
export function editAccessInput({engine,form,ids,onDone=()=>{}}){
 const entity=engine.selected(ids.slice(0,1))[0];if(!entity)throw Error('검토할 문·경사로·화장실 경계·접근로를 하나 선택하세요.');
 const doc=engine.doc,v=entity.reviewInput||{},initial=entity.category==='RAMP'?'ramp':v.disabledToilet?'toilet':v.walkway?'path':'door';
 form('편의시설 입력 · 선택 객체',[{name:'kind',label:'검토 대상',value:initial,options:[['door','문'],['ramp','경사로'],['toilet','장애인 화장실'],['path','보행 접근로']]}],({kind})=>{
  const definitions={door:[['mainEntrance','주출입구 (1 = 지정, 0 = 해제)']],ramp:[['riseMm','높이 차 (mm, 없으면 레벨 사용)'],['startLevelMm','하부 레벨 (mm)'],['endLevelMm','상부 레벨 (mm)'],['runMm','수평 길이 (mm)'],['clearWidthMm','유효폭 (mm)'],['landingMm','참 길이 (mm)']],toilet:[['turnX','회전원 중심 X (mm)'],['turnY','회전원 중심 Y (mm)'],['toiletX','변기 왼쪽 앞 모서리 X (mm)'],['toiletY','변기 왼쪽 앞 모서리 Y (mm)'],['toiletWidthMm','변기 폭 (mm)'],['toiletDepthMm','변기 깊이 (mm)'],['toiletRotation','변기 방향 (도)'],['sideClearMm','변기 옆 확보폭 (mm)'],['frontClearMm','변기 앞 확보폭 (mm)']],path:[['clearWidthMm','접근로 통과폭 (mm)'],['stepMm','최대 단차 (mm)']]},texts=kind==='toilet'?[['doorIds','연결 문 번호 (쉼표 구분)']]:kind==='path'?[['parkingId','출발 장애인 주차 번호 (P-xx)'],['doorId','도착 주출입구 번호 (D-xx)']]:[];
  if(!definitions[kind])throw Error('검토 대상을 확인하세요.');
  const current={...v,mainEntrance:v.mainEntrance==null?null:Number(v.mainEntrance),turnX:v.turnCenter?.x,turnY:v.turnCenter?.y,toiletX:v.toiletAnchor?.x,toiletY:v.toiletAnchor?.y,doorIds:v.doorIds?.join(',')};
  form('편의시설 입력 · 빈칸은 미확인',[...definitions[kind].map(([name,label])=>({name,label,type:'number',value:current[name]??''})),...texts.map(([name,label])=>({name,label,value:current[name]||''}))],values=>{
   if(engine.doc!==doc)throw Error('도면이 변경되었습니다. 입력을 다시 여세요.');
   const next={...v};for(const [key] of definitions[kind]){const raw=values[key];next[key]=raw==null||String(raw).trim()===''?null:Number(raw);if(next[key]!==null&&!finite(next[key]))throw Error('숫자를 확인하세요.');}
   if(kind==='door'){if(next.mainEntrance!==null&&![0,1].includes(next.mainEntrance))throw Error('주출입구는 0 또는 1로 입력하세요.');next.mainEntrance=next.mainEntrance===1;next.door=true;}
   if(kind==='ramp')next.ramp=true;
   if(kind==='toilet'){next.disabledToilet=true;next.turnCenter=finite(next.turnX)&&finite(next.turnY)?{x:next.turnX,y:next.turnY}:null;next.toiletAnchor=finite(next.toiletX)&&finite(next.toiletY)?{x:next.toiletX,y:next.toiletY}:null;next.doorIds=String(values.doorIds||'').split(',').map(s=>s.trim()).filter(Boolean);for(const key of ['turnX','turnY','toiletX','toiletY'])delete next[key];}
   if(kind==='path'){next.walkway=true;next.parkingId=String(values.parkingId||'').trim();next.doorId=String(values.doorId||'').trim();}
   const targets=entity.reviewObjectId?engine.selected(ids).filter(e=>e.reviewObjectId===entity.reviewObjectId):[entity];engine.execute({type:'updateMany',updates:targets.map(e=>({id:e.id,changes:{reviewInput:{...e.reviewInput,...next}}}))});onDone();
  });
 });
}
