// 객체 사이 id 참조(벽에 걸린 문·창, 실 이름표의 경계, 면적표의 원본 실, 블록 수량표의 대상)를
// 한 곳에서 정의한다. AutoCAD 는 객체마다 dwgOut 으로 참조를 흘려 보내 PURGE·복제·감사가 같은 길을 쓴다.
// 바른 CAD 는 참조 필드 목록 하나(ID_REFS)로 같은 일을 한다: 새 참조 필드가 생기면 여기 한 줄만 고친다.
//  - 221: 역참조 색인(entity-index.js)이 이 목록으로 "누가 나를 보는가"를 유지한다.
//  - 222: cloneWithIdMap 이 이 목록으로 복사본의 참조를 새 id 로 옮긴다.

/** 단일 id 필드. */
export const ID_REF_KEYS=Object.freeze(['hostWall','roomBoundary']);

/** e 가 가리키는 다른 객체 id 를 모두 emit(id, kind) 로 내보낸다(하위 객체는 보지 않는다). */
export function forEachIdRef(e,emit){
  if(!e||typeof e!=='object')return;
  for(const key of ID_REF_KEYS){const id=e[key];if(typeof id==='string'&&id)emit(id,key);}
  const sources=e.roomSchedule?.sourceIds;
  if(Array.isArray(sources))for(const id of sources)if(typeof id==='string'&&id)emit(id,'roomSchedule');
  if(Array.isArray(e.scheduleIds))for(const id of e.scheduleIds)if(typeof id==='string'&&id)emit(id,'scheduleIds');
}

/** 참조가 하나라도 있는가(색인을 지을 때 대부분의 객체를 빨리 건너뛰기 위한 검사). */
export const hasIdRefs=e=>!!e&&typeof e==='object'&&!!(e.hostWall||e.roomBoundary||e.roomSchedule||e.scheduleIds);

/** 참조 필드를 map(옛 id → 새 id)으로 옮긴다. 표에 없는 참조는 keepOutside 면 그대로, 아니면 끊는다. 바꾼 개수를 돌려준다. */
export function translateIdRefs(e,map,{keepOutside=true}={}){
  let changed=0;
  for(const key of ID_REF_KEYS){
    const id=e[key];if(typeof id!=='string'||!id)continue;
    const next=map.get(id);
    if(next){e[key]=next;changed++;}else if(!keepOutside){delete e[key];changed++;}
  }
  const remapList=list=>{const out=[];for(const id of list){const next=map.get(id);if(next){out.push(next);changed++;}else if(keepOutside)out.push(id);else changed++;}return out;};
  if(Array.isArray(e.roomSchedule?.sourceIds))e.roomSchedule={...e.roomSchedule,sourceIds:remapList(e.roomSchedule.sourceIds)};
  if(Array.isArray(e.scheduleIds))e.scheduleIds=remapList(e.scheduleIds);
  return changed;
}

/* 두 단계 깊은 복제(AutoCAD AcDbIdMapping 과 같은 생각).
   1단계: 최상위 객체마다 새 id 를 주며 "옛 id → 새 id" 표를 만든다.
   2단계: 복사본의 참조를 표로 옮긴다. 복제 범위 밖을 가리키는 참조는 그대로 둔다(keepOutside, 기본) —
   예: 문만 복사하면 복사한 문은 원래 벽에 그대로 걸린다(예전 복사와 같은 동작).
   하위 객체(블록 안)는 지금처럼 id 를 유지한다. 블록 안 id 는 블록 정의 범위에서만 쓰이고
   화면 캐시·공유 블록이 그 id 로 자식을 찾기 때문이다. */
export function cloneWithIdMap(entities,{newId=()=>crypto.randomUUID(),keepOutside=true,clone=e=>structuredClone(e)}={}){
  const map=new Map(),copies=new Array(entities.length);
  for(let i=0;i<entities.length;i++){
    const e=entities[i],copy={...clone(e),id:newId()};
    delete copy.lineWallHost;
    if(e.id)map.set(e.id,copy.id);
    copies[i]=copy;
  }
  for(const copy of copies)translateIdRefs(copy,map,{keepOutside});
  return {copies,map};
}
