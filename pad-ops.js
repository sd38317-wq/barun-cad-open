// 패드 원격 수정(1단계) 작업 묶음 규약 — 패드와 바른 CAD 가 같은 파일을 쓴다.
// 패드가 보내는 것은 아래 6가지 작업뿐이다(파일·LISP·설정·레이어 명령 없음). 바른 CAD 는 받은 작업을
// 지금 도면에 맞춰 엔진 명령으로 바꾸고(없는 객체·잠긴 레이어·충돌 확인), 고른 것만 batch 한 번(되돌리기 한 단계)으로 반영한다.
//   {type:'mark',id,points,note?}      펜 표시(+메모) → 패드 표시 레이어의 폴리선(+문자)
//   {type:'line',id,points}            선(점 2개)·폴리선(3개 이상)
//   {type:'delete',ids}                지우기
//   {type:'move',ids,dx,dy}            이동
//   {type:'copy',ids,dx,dy,newIds}     복사(새 ID 는 패드가 정해 이후 작업이 가리킬 수 있게 한다)
//   {type:'text',id,text}              문자 고치기
//   {type:'memo',id,at,text,height?}   그 자리 메모(구름+글자) — 7.0 현장 패드는 mark·memo 만 보낸다(도면은 못 고침)
// 사무실 받음 알림(바른 CAD → 패드, 같은 암호): {v:1,ack:{received,at}} — 작업 묶음이 아니다.
// 묶음: {v:1,seq,baseRevision,ops:[...]}
import * as G from './geometry.js';
import {entitiesById} from './entity-index.js';

export const PAD_PROTOCOL_VERSION=1;
export const PAD_MARK_LAYER_NAME='PAD-표시';
// 레이어 ID 를 고정해 두면 표시 레이어 만들기와 표시 넣기를 같은 batch(되돌리기 한 단계)에 담을 수 있다.
export const PAD_MARK_LAYER_ID='barun-pad-markup';
/** 이 판의 CAD 가 받아 넣을 수 있는 새 작업 — 패드 스냅샷에 실어 보내면 패드가 핀·실측을 그대로 보낸다(아니면 메모·펜 표시로 바꿔 보낸다). */
export const PAD_CAPABILITIES=Object.freeze(['pin','measure','photo']);
export const PAD_PIN_KINDS=Object.freeze(['하자','작업 지시','질문','메모']),PAD_PIN_STATES=Object.freeze(['미해결','진행 중','확인 요청','해결']),PAD_PIN_PRIOS=Object.freeze(['긴급','높음','보통','낮음']);
const LIMITS=Object.freeze({ops:200,ids:5000,points:5000,note:500,text:2000,coordinate:1e9});
const ID=/^[A-Za-z0-9_.:-]{1,80}$/;

const fail=message=>{throw Error(message);};
const finite=(value,name)=>{const n=Number(value);if(!Number.isFinite(n)||Math.abs(n)>LIMITS.coordinate)fail(`${name} 값이 올바르지 않습니다.`);return n;};
const ids=(value,name='ids')=>{if(!Array.isArray(value)||!value.length||value.length>LIMITS.ids)fail(`${name} 목록이 올바르지 않습니다.`);return value.map(id=>{if(typeof id!=='string'||!ID.test(id))fail('객체 ID 가 올바르지 않습니다.');return id;});};
const oneId=value=>ids([value],'id')[0];
const points=(value,min)=>{if(!Array.isArray(value)||value.length<min||value.length>LIMITS.points)fail('점 목록이 올바르지 않습니다.');return value.map(p=>({x:finite(p?.x,'x'),y:finite(p?.y,'y')}));};
// 핀 사진: 창고에 올린 잠근 바이트의 자리(id, 22자)와 지문(sha256). 핀 하나에 10장까지.
const photos=list=>{if(list.length>10)fail('사진은 핀 하나에 10장까지입니다.');return list.map(p=>{if(typeof p?.id!=='string'||!/^[A-Za-z0-9_-]{22}$/.test(p.id)||typeof p.sha256!=='string'||!/^[0-9a-f]{64}$/.test(p.sha256))fail('사진 정보가 올바르지 않습니다.');return {id:p.id,sha256:p.sha256};});};
const text=(value,max,name)=>{if(typeof value!=='string'||value.length>max)fail(`${name}이(가) 너무 깁니다.`);return value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g,'');};

/** 받은 묶음을 화이트리스트대로 다시 만든다. 모르는 작업·속성은 버리지 않고 거절한다(조용히 바뀌면 안 된다). */
export function normalizePadOp(op){
 if(!op||typeof op!=='object')fail('작업 형식이 올바르지 않습니다.');
 switch(op.type){
  case 'mark':return {type:'mark',id:oneId(op.id),points:points(op.points,2),...(op.note?{note:text(op.note,LIMITS.note,'메모')}:{})};
  case 'line':return {type:'line',id:oneId(op.id),points:points(op.points,2)};
  case 'delete':return {type:'delete',ids:ids(op.ids)};
  case 'move':return {type:'move',ids:ids(op.ids),dx:finite(op.dx,'dx'),dy:finite(op.dy,'dy')};
  case 'copy':{const source=ids(op.ids),created=ids(op.newIds,'newIds');if(created.length!==source.length)fail('복사 ID 수가 맞지 않습니다.');return {type:'copy',ids:source,dx:finite(op.dx,'dx'),dy:finite(op.dy,'dy'),newIds:created};}
  case 'text':return {type:'text',id:oneId(op.id),text:text(op.text,LIMITS.text,'문자')};
  case 'memo':{const body=text(op.text,LIMITS.note,'메모').trim();if(!body)fail('메모가 비었습니다.');const height=op.height==null?null:finite(op.height,'height');if(height!==null&&height<=0)fail('글자 높이가 올바르지 않습니다.');return {type:'memo',id:oneId(op.id),at:points([op.at],1)[0],text:body,...(height?{height}:{})};}
  case 'pin':{
   const pick=(value,list,name)=>{if(!list.includes(value))fail(`${name} 값이 올바르지 않습니다.`);return value;};
   const short=(value,max,name)=>value==null||value===''?'':text(String(value),max,name).trim();
   return {type:'pin',id:oneId(op.id),at:points([op.at],1)[0],no:Math.max(0,Math.min(99999,Math.floor(finite(op.no??0,'no')))),
    title:short(op.title,200,'제목'),kind:pick(op.kind,PAD_PIN_KINDS,'유형'),status:pick(op.status,PAD_PIN_STATES,'상태'),prio:pick(op.prio,PAD_PIN_PRIOS,'급한 정도'),
    assignee:short(op.assignee,80,'담당'),due:short(op.due,20,'기한'),note:short(op.note,LIMITS.note,'설명'),
    ...(Array.isArray(op.photos)&&op.photos.length?{photos:photos(op.photos)}:{})};
  }
  case 'measure':{
   const [a,b]=points([op.a,op.b],2),drawn=finite(op.drawn,'drawn');
   const actual=op.actual==null?null:finite(op.actual,'actual'),tolerance=op.tolerance==null?null:finite(op.tolerance,'tolerance');
   return {type:'measure',id:oneId(op.id),a,b,drawn,...(actual===null?{}:{actual}),...(tolerance===null?{}:{tolerance})};
  }
  default:fail('지원하지 않는 패드 작업입니다: '+String(op.type).slice(0,20));
 }
}
/** 사무실 답(CAD → 패드): 핀 상태 바꾸기·답 글. 같은 ops 길로 잠가 보낸다(서버 변경 없음). 예전 패드는 묶음이 아니라 무시한다. */
export const padReply=items=>({v:PAD_PROTOCOL_VERSION,reply:{at:new Date().toISOString(),items:items.map(normalizeReplyItem)}});
export const isPadReply=value=>!!value&&typeof value==='object'&&value.v===PAD_PROTOCOL_VERSION&&Array.isArray(value.reply?.items);
export function normalizeReplyItem(item){
 const status=item?.status==null||item.status===''?null:PAD_PIN_STATES.includes(item.status)?item.status:fail('상태 값이 올바르지 않습니다.');
 const body=item?.text==null?'':text(String(item.text),LIMITS.note,'답').trim();
 return {id:oneId(item?.id),...(status?{status}:{}),...(body?{text:body}:{}),at:String(item?.at||new Date().toISOString()).slice(0,40)};
}
export const padAck=received=>({v:PAD_PROTOCOL_VERSION,ack:{received:Math.max(0,Math.floor(finite(received,'received'))),at:new Date().toISOString()}});
export const isPadAck=value=>!!value&&typeof value==='object'&&value.v===PAD_PROTOCOL_VERSION&&!!value.ack&&Number.isFinite(value.ack.received);
// 메모 구름: 글자 둘레 네모를 따라 바깥으로 볼록한 반원을 잇는다(폴리선 점).
export function cloudRing(min,max,bump){
 const corners=[min,{x:max.x,y:min.y},max,{x:min.x,y:max.y}],out=[];
 for(let i=0;i<4;i++){const a=corners[i],b=corners[(i+1)%4],len=G.dist(a,b),n=Math.max(1,Math.round(len/bump)),u=G.unit(G.sub(b,a)),outward={x:u.y,y:-u.x};
  for(let k=0;k<n;k++){const c=G.add(a,G.mul(u,len*(k+.5)/n)),r=len/n/2;for(let s=0;s<=6;s++){const t=Math.PI*s/6;out.push(G.add(c,G.add(G.mul(u,-r*Math.cos(t)),G.mul(outward,r*Math.sin(t)*.7))));}}}
 return out;
}
const fmtMm=n=>Math.round(n).toLocaleString('ko-KR');
/** 실측 글: "실측 4,000 · 도면 4,050 · −50" (실측이 없으면 "치수 4,050"). */
export function measureText(op){
 if(op.actual==null)return `치수 ${fmtMm(op.drawn)}`;
 const diff=op.actual-op.drawn,sign=diff>0?'+':diff<0?'−':'';
 return `실측 ${fmtMm(op.actual)} · 도면 ${fmtMm(op.drawn)} · ${sign}${fmtMm(Math.abs(diff))}`;
}
/** 실측: 치수선(양 끝 짧은 수직선) + 가운데 글. 허용 오차를 넘으면 주황. */
export function measureEntities(op,layer){
 const len=Math.max(1e-9,G.dist(op.a,op.b)),u=G.unit(G.sub(op.b,op.a)),n={x:-u.y,y:u.x},tick=Math.max(40,len/40),height=Math.max(60,Math.min(400,len/18));
 const over=op.actual!=null&&Math.abs(op.actual-op.drawn)>(op.tolerance??20),color=over?'#f08a3e':'#9dcbe0';
 const mid=G.mul(G.add(op.a,op.b),0.5),angle=Math.atan2(u.y,u.x),readable=angle>Math.PI/2||angle<-Math.PI/2?angle+Math.PI:angle;
 return [
  {type:'polyline',id:op.id,layer,color,points:[op.a,op.b],closed:false},
  {type:'polyline',id:op.id+'-a',layer,color,points:[G.add(op.a,G.mul(n,-tick)),G.add(op.a,G.mul(n,tick))],closed:false},
  {type:'polyline',id:op.id+'-b',layer,color,points:[G.add(op.b,G.mul(n,-tick)),G.add(op.b,G.mul(n,tick))],closed:false},
  {type:'text',id:op.id+'-t',layer,color,position:G.add(mid,G.mul(n,height*0.6)),text:measureText(op),height,rotation:readable*180/Math.PI,align:'center'},
 ];
}
const PIN_COLORS={'미해결':'#f08a3e','진행 중':'#9dcbe0','확인 요청':'#e6c35a','해결':'#7fcf95'};
/** 핀: 둥근 표시(번호) + 옆 글 "[유형·상태·급함] 제목 / 담당·기한". */
export function pinEntities(op,layer,size=250){
 const color=PIN_COLORS[op.status]||'#f08a3e',r=size*0.6,c={x:op.at.x,y:op.at.y+r*1.8};
 const lines=[`[${op.kind}·${op.status}·${op.prio}] ${op.no?op.no+'. ':''}${op.title}`.trim(),[op.note,op.assignee&&`담당 ${op.assignee}`,op.due&&`기한 ${op.due}`].filter(Boolean).join(' / ')].filter(Boolean);
 const ring=Array.from({length:25},(_,i)=>({x:c.x+r*Math.cos(i/24*Math.PI*2),y:c.y+r*Math.sin(i/24*Math.PI*2)}));
 return [
  {type:'polyline',id:op.id,layer,color,points:ring,closed:true},
  {type:'polyline',id:op.id+'-tip',layer,color,points:[{x:c.x-r*0.45,y:c.y-r*0.9},op.at,{x:c.x+r*0.45,y:c.y-r*0.9}],closed:false},
  {type:'text',id:op.id+'-no',layer,color,position:{x:c.x,y:c.y-size*0.35},text:String(op.no||'•'),height:size*0.7,rotation:0,align:'center'},
  ...lines.map((line,i)=>({type:'text',id:op.id+'-t'+i,layer,color,position:{x:c.x+r*1.6,y:c.y+size*0.2-i*size*1.3},text:line,height:size*(i?0.8:1),rotation:0})),
 ];
}
export function memoEntities(op,layer){
 const height=op.height||250,width=Math.max(height*3,height*op.text.length*.95),pad=height*.6;
 const min={x:op.at.x-pad,y:op.at.y-pad},max={x:op.at.x+width+pad,y:op.at.y+height+pad};
 return [{type:'text',id:op.id,layer,position:{...op.at},text:op.text,height,rotation:0},{type:'polyline',id:op.id+'-cloud',layer,points:cloudRing(min,max,height*1.4),closed:true}];
}
export function normalizePadBatch(batch){
 if(!batch||typeof batch!=='object'||batch.v!==PAD_PROTOCOL_VERSION)fail('작업 묶음 판이 맞지 않습니다.');
 if(!Array.isArray(batch.ops)||!batch.ops.length||batch.ops.length>LIMITS.ops)fail('작업 묶음이 비었거나 너무 큽니다.');
 return {v:PAD_PROTOCOL_VERSION,seq:Math.max(0,Math.floor(finite(batch.seq,'seq'))),baseRevision:String(batch.baseRevision??'').slice(0,80),ops:batch.ops.map(normalizePadOp)};
}

/* 충돌 확인용 지문: 패드에 보낼 때의 객체와 지금 객체가 같은지만 본다(내부 캐시 _ 속성 제외, 32비트 FNV-1a). */
export function entityFingerprint(entity){
 const json=JSON.stringify(entity,(key,value)=>key.startsWith('_')?undefined:value);let hash=0x811c9dc5;
 for(let i=0;i<json.length;i++){hash^=json.charCodeAt(i);hash=Math.imul(hash,0x01000193)>>>0;}
 return hash;
}
const overlaps=(a,b)=>a&&Number.isFinite(a.minX)&&a.minX<=b.maxX&&a.maxX>=b.minX&&a.minY<=b.maxY&&a.maxY>=b.minY;

/** 패드로 보낼 도면 묶음과 충돌 기준(지문). box 를 주면 그 범위에 걸친 객체만 보낸다. 숨긴·얼린 레이어 객체는 보내지 않는다. */
export function buildPadSnapshot(doc,{box=null,name='',revision=''}={}){
 const hidden=new Set((doc.layers||[]).filter(layer=>layer.visible===false||layer.frozen).map(layer=>layer.id));
 const entities=(doc.entities||[]).filter(entity=>entity.managedBy!=='live_check'&&!hidden.has(entity.layer)&&(!box||overlaps(entity.sharedBlock&&entity._renderBounds?entity._renderBounds:G.bounds([entity]),box)));
 const baseline=new Map(entities.map(entity=>[entity.id,entityFingerprint(entity)]));
 const snapshot={v:PAD_PROTOCOL_VERSION,name:String(name||'도면'),revision:String(revision),units:doc.units,createdAt:new Date().toISOString(),
  layers:(doc.layers||[]).filter(layer=>!hidden.has(layer.id)).map(({id,name,color,locked,linetype,lineweight})=>({id,name,color,locked:!!locked,linetype,lineweight})),
  entities:JSON.parse(JSON.stringify(entities)),...(doc.sharedBlocks?{sharedBlocks:doc.sharedBlocks}:{}),...(box?{box}:{})};
 return {snapshot,baseline};
}

const MOVE_TYPES=new Set(['move','copy']);
/**
 * 받은 작업을 지금 도면에 맞춰 엔진 명령으로 바꾼다. entries 는 [{seq,index,op}] (적용 순서대로).
 * 앞 작업이 만든 객체(선·복사·표시)를 뒤 작업이 가리킬 수 있어 가상 상태를 차례로 따라간다.
 * 반환: [{...entry,status:'ready'|'conflict'|'missing'|'locked'|'invalid',reason,commands,preview}]
 *   force 에 든 키(`seq:index`)는 충돌이어도 패드 쪽으로 덮는다.
 *   chosen 을 주면 그 키의 작업만 계획한다. 반영할 것만 계획해야 표시 레이어 만들기가 고른 작업에 붙는다
 *   (전체를 계획하면 첫 펜 표시에만 붙어, 그 표시를 빼고 반영하면 "객체의 레이어가 없습니다"로 실패했다).
 */
export function planPadOps(doc,entries,{baseline=new Map(),force=new Set(),chosen=null}={}){
 if(chosen)entries=entries.filter(entry=>chosen.has(`${entry.seq}:${entry.index}`));
 const locked=new Set((doc.layers||[]).filter(layer=>layer.locked).map(layer=>layer.id));
 const markLayer=(doc.layers||[]).find(layer=>layer.id===PAD_MARK_LAYER_ID||layer.name===PAD_MARK_LAYER_NAME);
 let markLayerReady=!!markLayer;const markLayerId=markLayer?.id||PAD_MARK_LAYER_ID;
 const fallbackLayer=(doc.layers||[]).find(layer=>!layer.locked&&layer.visible!==false&&!layer.frozen)?.id||doc.layers?.[0]?.id||'default';
 const wanted=new Set(entries.flatMap(({op})=>op.ids||(op.type==='text'?[op.id]:[])));
 const current=new Map(entitiesById(doc.entities||[],wanted).map(entity=>[entity.id,entity]));
 const virtual=new Map(),gone=new Set(),created=new Set();
 const lookup=id=>gone.has(id)?null:virtual.get(id)||current.get(id)||null;
 return entries.map(entry=>{
  const {op}=entry,key=`${entry.seq}:${entry.index}`,result={...entry,key,status:'ready',reason:'',commands:[],preview:[]};
  try{
   if(op.type==='memo'){
    if(lookup(op.id)||gone.has(op.id))fail('같은 ID 의 객체가 이미 있습니다.');
    if(!markLayerReady){result.commands.push({type:'layer.add',id:PAD_MARK_LAYER_ID,name:PAD_MARK_LAYER_NAME,color:'#ff4d4d'});markLayerReady=true;}
    const added=memoEntities(op,markLayerId);for(const item of added){result.commands.push({type:'add',entity:item});virtual.set(item.id,item);created.add(item.id);}
    result.preview=added;return result;
   }
   if(op.type==='pin'||op.type==='measure'){
    if(lookup(op.id)||gone.has(op.id))fail('같은 ID 의 객체가 이미 있습니다.');
    if(!markLayerReady){result.commands.push({type:'layer.add',id:PAD_MARK_LAYER_ID,name:PAD_MARK_LAYER_NAME,color:'#ff4d4d'});markLayerReady=true;}
    const added=op.type==='pin'?pinEntities(op,markLayerId):measureEntities(op,markLayerId);
    for(const item of added){result.commands.push({type:'add',entity:item});virtual.set(item.id,item);created.add(item.id);}
    result.preview=added;return result;
   }
   if(op.type==='mark'||op.type==='line'){
    if(lookup(op.id)||gone.has(op.id))fail('같은 ID 의 객체가 이미 있습니다.');
    const layer=op.type==='mark'?markLayerId:fallbackLayer;
    if(op.type==='mark'&&!markLayerReady){result.commands.push({type:'layer.add',id:PAD_MARK_LAYER_ID,name:PAD_MARK_LAYER_NAME,color:'#ff4d4d'});markLayerReady=true;}
    const entity=op.points.length===2&&op.type==='line'?{type:'line',id:op.id,layer,points:op.points}:{type:'polyline',id:op.id,layer,points:op.points,closed:false,...(op.type==='mark'?{lineweight:0.5}:{})};
    const added=[entity];
    if(op.type==='mark'&&op.note){const end=op.points[op.points.length-1];added.push({type:'text',id:op.id+'-note',layer,position:{x:end.x,y:end.y},text:op.note,height:Math.max(50,G.bounds([entity]).maxY-G.bounds([entity]).minY)/6,rotation:0});}
    for(const item of added){result.commands.push({type:'add',entity:item});virtual.set(item.id,item);created.add(item.id);}
    result.preview=added;return result;
   }
   const targetIds=op.type==='text'?[op.id]:op.ids,targets=targetIds.map(lookup);
   if(targets.some(target=>!target)){result.status='missing';result.reason='사무실 도면에 없는 객체입니다(이미 지웠거나 다른 범위).';return result;}
   if(targets.some(target=>locked.has(target.layer))){result.status='locked';result.reason='잠긴 레이어의 객체입니다.';return result;}
   const changed=targetIds.filter(id=>!created.has(id)&&baseline.has(id)&&!virtual.has(id)&&entityFingerprint(current.get(id))!==baseline.get(id));
   if(changed.length&&!force.has(key)){result.status='conflict';result.reason=`보낸 뒤 사무실에서 고친 객체 ${changed.length}개와 겹칩니다.`;}
   if(op.type==='delete'){result.commands.push({type:'delete',ids:targetIds});for(const id of targetIds){gone.add(id);virtual.delete(id);}result.preview=targets;return result;}
   if(op.type==='text'){
    const [target]=targets;if(target.type!=='text')fail('문자 객체만 고칠 수 있습니다.');
    result.commands.push({type:'update',ids:[op.id],changes:{text:op.text}});const next={...target,text:op.text};virtual.set(op.id,next);result.preview=[next];return result;
   }
   if(MOVE_TYPES.has(op.type)){
    const moved=targets.map(target=>G.translate(structuredClone(target),op.dx,op.dy));
    if(op.type==='move'){result.commands.push({type:'move',ids:targetIds,dx:op.dx,dy:op.dy});moved.forEach((entity,i)=>virtual.set(targetIds[i],entity));}
    else{
     if(op.newIds.some(id=>lookup(id)))fail('복사 ID 가 이미 있습니다.');
     const copies=moved.map((entity,i)=>({...entity,id:op.newIds[i]}));
     // addMany 는 새 ID 를 다시 매기므로(fresh) 패드가 정한 ID 를 지키려면 add 를 하나씩 쓴다.
     for(const copy of copies)result.commands.push({type:'add',entity:copy});for(const copy of copies){virtual.set(copy.id,copy);created.add(copy.id);}
     result.preview=copies;return result;
    }
    result.preview=moved;return result;
   }
   fail('지원하지 않는 작업입니다.');
  }catch(error){result.status='invalid';result.reason=error.message;result.commands=[];result.preview=[];}
  return result;
 });
}
export const PAD_OP_LABELS=Object.freeze({memo:'메모',mark:'펜 표시',line:'선 그리기',delete:'지우기',move:'이동',copy:'복사',text:'문자 고치기',pin:'핀',measure:'실측'});
export function describePadOp(op){
 const count=op.ids?.length||1,label=PAD_OP_LABELS[op.type]||op.type;
  if(op.type==='memo')return `${label} · "${op.text.slice(0,30)}"`;
 if(op.type==='pin')return `${label} ${op.no||''} · [${op.kind}·${op.status}·${op.prio}] ${op.title.slice(0,30)}`;
 if(op.type==='measure')return `${label} · ${measureText(op)}`;
 if(op.type==='mark')return op.note?`${label} · "${op.note.slice(0,30)}"`:label;
 if(op.type==='text')return `${label} → "${op.text.slice(0,30)}"`;
 return count>1?`${label} ${count}개`:label;
}
