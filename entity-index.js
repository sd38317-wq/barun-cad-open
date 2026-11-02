// id -> entity lookup for the engine's copy-on-write entity arrays.
//
// Hashing every id of a 200k-object drawing costs ~10 ms, and every commit
// produces a new array. One index therefore follows whichever committed array
// was asked for last: moving between arrays that differ by a few objects (a
// commit, an undo) takes a pointer-only diff and updates just those ids.
// Arrays that differ by reordering or by many objects are simply re-indexed.
//
// Only arrays the engine has committed are indexed. A committed array is the
// document of a finished command: history keeps it immutable. A command's
// working array is still being pushed into, so readers of it fall back to a
// plain scan (or to changedById, which diffs it against the committed base).
//
// The index also counts the rare entities that force whole-drawing checks
// (linked walls/rooms, block schedules, parcel sites), so callers can skip
// those scans when the drawing has none.
//
// 221: it also keeps the reverse references ("who points at me", AutoCAD's
// persistent reactors): target id -> ids of the objects whose hostWall,
// roomBoundary, roomSchedule.sourceIds or scheduleIds name it. It follows the
// same pointer deltas as the id map, so an edit touching k objects updates it
// in O(k) and dependentsOf() answers without scanning the drawing.

import {forEachIdRef,hasIdRefs} from './entity-refs.js';

const DIFF_LIMIT=4096,WINDOW=64;
const committed=new WeakSet();
let current=null;   // {entities,length,map,features}

export function commitEntities(entities){if(Array.isArray(entities))committed.add(entities);}

const featureKeys=['hostWall','roomBoundary','blockSchedule','roomSchedule','parcel'];
function featuresOf(entity){
  return {
    hostWall:entity.hostWall?1:0,
    roomBoundary:entity.roomBoundary?1:0,
    blockSchedule:entity.scheduleKind==='blocks'?1:0,
    roomSchedule:entity.roomSchedule?1:0,
    parcel:entity.parcelRole||entity.type==='block'&&entity.parcelGroup?1:0,
  };
}

// 연관 치수(ACAD200 513·518): 원본 객체를 따라가는 치수(assoc)와 자동 끊기 치수(breakMode 'auto').
// 색인이 그런 치수 개수·끊긴 치수 개수·원본 id 역색인(원본 id → 그 원본을 쓰는 치수 수)을 함께 센다.
// 연관 치수가 0개인 도면은 엔진이 아무것도 훑지 않는다.
export const isAssocDimension=entity=>entity?.type==='dimension'&&(Array.isArray(entity.assoc)&&entity.assoc.some(Boolean)||entity.breakMode==='auto');
export function assocSourceIds(entity){
  const ids=[];
  if(Array.isArray(entity?.assoc))for(const a of entity.assoc)if(a&&a.id!=null)ids.push(a.id);
  if(entity?.breakMode==='auto'&&Array.isArray(entity.breakBy))for(const id of entity.breakBy)if(id!=null)ids.push(id);
  return ids;
}
const newAssocStats=()=>({dims:0,lost:0,sources:new Map()});
function accountAssoc(stats,entity,sign){
  if(entity.type!=='dimension')return;
  if(entity.assocLost)stats.lost+=sign;
  if(!isAssocDimension(entity))return;
  stats.dims+=sign;
  // sources: 원본 id -> Map(그 원본을 쓰는 치수 id -> 횟수). 원본을 고친 명령이 의존 치수만 찾는 역색인(AutoCAD 반응자).
  for(const id of assocSourceIds(entity)){
    let users=stats.sources.get(id);
    if(sign>0){if(!users)stats.sources.set(id,users=new Map());users.set(entity.id,(users.get(entity.id)||0)+1);}
    else if(users){const n=(users.get(entity.id)||0)-1;if(n>0)users.set(entity.id,n);else{users.delete(entity.id);if(!users.size)stats.sources.delete(id);}}
  }
}
// 원본 ids 를 쓰는 연관 치수 id. 색인이 없으면(확정 전 작업 배열) null — 부르는 쪽이 예전처럼 훑는다.
export function assocDependentsOf(entities,ids){
  const index=entityIndex(entities);if(!index?.assoc)return null;
  const out=new Set();if(!index.assoc.dims)return out;
  for(const id of ids){const users=index.assoc.sources.get(id);if(users)for(const dim of users.keys())out.add(dim);}
  return out;
}
function account(features,entity,sign,assoc){const f=featuresOf(entity);for(const key of featureKeys)features[key]+=sign*f[key];if(assoc)accountAssoc(assoc,entity,sign);}
// refs: target id -> Map(dependent id -> count). A count, because one object
// may name the same target twice (a schedule listing a room twice).
function addRefs(refs,entity,sign){
  if(!hasIdRefs(entity))return;
  const source=entity.id;
  forEachIdRef(entity,target=>{
    let set=refs.get(target);
    if(sign>0){if(!set)refs.set(target,set=new Map());set.set(source,(set.get(source)||0)+1);}
    else if(set){const n=(set.get(source)||0)-1;if(n>0)set.set(source,n);else{set.delete(source);if(!set.size)refs.delete(target);}}
  });
}

// 연관 객체(연관 해치·중심선·중심 표시, assoc-edit.js): 원본이 바뀌면 다시 계산할 목록. 보통 0~수십 개라 명령마다 도면을 훑지 않고 이 목록만 본다.
const associative=entity=>!!(entity&&((entity.type==='hatch'&&entity.boundaryIds?.length)||entity.assocRefs?.length));
function trackAssoc(index,entity,sign){if(associative(entity)){if(sign>0)index.add(entity);else index.delete(entity);}}

function rebuild(entities){
  const map=new Map(),features={hostWall:0,roomBoundary:0,blockSchedule:0,roomSchedule:0,parcel:0},refs=new Map(),assoc=newAssocStats(),assocObjects=new Set();
  for(const entity of entities){map.set(entity.id,entity);account(features,entity,1,assoc);addRefs(refs,entity,1);trackAssoc(assocObjects,entity,1);}
  return {entities,length:entities.length,map,features,refs,assoc,assocObjects};
}

// Removed/added objects between two arrays that keep the retained objects in
// the same relative order. Pointer comparisons only; null when the arrays are
// not such a small order-preserving edit of each other. Every object of
// `after` absent from `before` is reported as added and vice versa, so an
// index updated from it is exact even when the alignment is not minimal.
export function pointerDelta(before,after,limit=DIFF_LIMIT){
  const removed=[],added=[];let i=0,j=0;
  while(i<before.length||j<after.length){
    if(i<before.length&&j<after.length&&before[i]===after[j]){i++;j++;continue;}
    if(i>=before.length){for(;j<after.length;j++)added.push(after[j]);break;}
    if(j>=after.length){for(;i<before.length;i++)removed.push(before[i]);break;}
    let step=0;
    for(let k=1;k<=WINDOW&&!step;k++){
      if(after[j+k]===before[i]){for(let t=0;t<k;t++)added.push(after[j+t]);j+=k;step=k;}
      else if(before[i+k]===after[j]){for(let t=0;t<k;t++)removed.push(before[i+t]);i+=k;step=k;}
      else if(i+k<=before.length&&j+k<=after.length&&(before[i+k]===after[j+k]||i+k===before.length&&j+k===after.length)){for(let t=0;t<k;t++){removed.push(before[i+t]);added.push(after[j+t]);}i+=k;j+=k;step=k;}
    }
    if(!step)return null;
    if(removed.length+added.length>limit)return null;
  }
  return {removed,added};
}

// The index of a committed array, or null for arrays that may still change.
export function entityIndex(entities){
  if(!committed.has(entities))return null;
  if(current?.entities===entities&&current.length===entities.length)return current;
  const delta=current&&current.length===current.entities.length&&pointerDelta(current.entities,entities);
  if(!delta){current=rebuild(entities);return current;}
  const {map,features,refs,assoc,assocObjects}=current;
  for(const entity of delta.removed)if(map.get(entity.id)===entity){map.delete(entity.id);account(features,entity,-1,assoc);addRefs(refs,entity,-1);trackAssoc(assocObjects,entity,-1);}
  for(const entity of delta.added){const old=map.get(entity.id);if(old){account(features,old,-1,assoc);addRefs(refs,old,-1);trackAssoc(assocObjects,old,-1);}map.set(entity.id,entity);account(features,entity,1,assoc);addRefs(refs,entity,1);trackAssoc(assocObjects,entity,1);}
  current.entities=entities;current.length=entities.length;
  return current;
}

// Builds the index of a committed array a slice at a time, so indexing a drawing
// of millions of objects when it opens never holds input for a whole build
// (~0.2 s for 1.9M objects). Installed only while isCurrent() still holds; a
// synchronous entityIndex() call meanwhile simply wins.
export async function warmEntityIndex(entities,{isCurrent=()=>true,slice=50000,yieldFn=()=>new Promise(resolve=>setTimeout(resolve,0))}={}){
  if(!committed.has(entities)||current?.entities===entities&&current.length===entities.length)return false;
  const map=new Map(),features={hostWall:0,roomBoundary:0,blockSchedule:0,roomSchedule:0,parcel:0},refs=new Map(),assoc=newAssocStats(),assocObjects=new Set();
  for(let start=0;start<entities.length;start+=slice){
    const end=Math.min(entities.length,start+slice);
    for(let i=start;i<end;i++){const entity=entities[i];map.set(entity.id,entity);account(features,entity,1,assoc);addRefs(refs,entity,1);trackAssoc(assocObjects,entity,1);}
    await yieldFn();
    if(!isCurrent()||current?.entities===entities)return false;
  }
  current={entities,length:entities.length,map,features,refs,assoc,assocObjects};
  return true;
}

const byPosition=(entities,found)=>{if(found.length>1){const at=new Map(found.map(entity=>[entity,entities.indexOf(entity)]));found.sort((a,b)=>at.get(a)-at.get(b));}return found;};

// Entities with the given ids, in document order (exactly entities.filter).
// Small id sets on committed arrays use the index plus pointer positions.
export function entitiesById(entities,ids){
  const wanted=ids instanceof Set?ids:new Set(ids||[]);
  const index=wanted.size<=16&&entityIndex(entities);
  if(!index)return entities.filter(entity=>wanted.has(entity.id));
  const found=[];
  for(const id of wanted){const entity=index.map.get(id);if(entity)found.push(entity);}
  return byPosition(entities,found);
}

// entitiesById(after, ids) for a working array derived from the committed
// `before` by a small edit: new objects come from a pointer diff, retained
// ones from before's index. Falls back to the plain scan otherwise.
export function changedById(before,after,ids){
  const wanted=ids instanceof Set?ids:new Set(ids||[]);
  const index=wanted.size<=16&&entityIndex(before),delta=index&&pointerDelta(before,after);
  if(!delta)return after.filter(entity=>wanted.has(entity.id));
  const found=new Map(),removed=new Set(delta.removed);
  for(const entity of delta.added)if(wanted.has(entity.id))found.set(entity.id,entity);
  for(const id of wanted)if(!found.has(id)){const entity=index.map.get(id);if(entity&&!removed.has(entity))found.set(id,entity);}
  return byPosition(after,[...found.values()]);
}

// 221: ids of the objects that reference any of `ids` (doors/windows on a wall,
// room tags of a boundary, schedules reading a room or block). null when the
// array is not committed: callers then keep their old scan.
export function dependentsOf(entities,ids){
  const index=entityIndex(entities);if(!index?.refs)return null;
  const out=new Set();
  for(const id of ids){const set=index.refs.get(id);if(set)for(const dependent of set.keys())out.add(dependent);}
  return out;
}

export function resetEntityIndex(){current=null;}
