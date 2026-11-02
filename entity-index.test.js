import test from 'node:test';
import assert from 'node:assert/strict';
import {entityIndex,entitiesById,changedById,pointerDelta,resetEntityIndex,commitEntities,warmEntityIndex} from './entity-index.js';

let seed=5;const rnd=()=>(seed=(seed*1103515245+12345)%2147483648)/2147483648,pick=n=>Math.floor(rnd()*n);
let serial=0;
const make=()=>{const k=pick(20);return {id:'e'+(serial++),type:k===0?'block':'line',...(k===1?{hostWall:'w1'}:{}),...(k===2?{roomBoundary:'r1'}:{}),...(k===3?{scheduleKind:'blocks'}:{}),...(k===4?{parcelRole:'site'}:{}),...(k===0&&rnd()<.5?{parcelGroup:true}:{})};};
const expected=entities=>{const map=new Map(entities.map(e=>[e.id,e]));const f={hostWall:0,roomBoundary:0,blockSchedule:0,roomSchedule:0,parcel:0};for(const e of entities){if(e.hostWall)f.hostWall++;if(e.roomBoundary)f.roomBoundary++;if(e.scheduleKind==='blocks')f.blockSchedule++;if(e.roomSchedule)f.roomSchedule++;if(e.parcelRole||e.type==='block'&&e.parcelGroup)f.parcel++;}return {map,f};};
const edit=list=>{
  const next=[...list],kind=pick(6);
  if(kind===0)next.push(...Array.from({length:1+pick(5)},make));                                   // append (COPY, LINE)
  else if(kind===1&&next.length){const i=pick(next.length);next[i]={...next[i],moved:rnd()};}       // replace in place (MOVE)
  else if(kind===2&&next.length)next.splice(pick(next.length),1+pick(3));                            // delete
  else if(kind===3)next.splice(pick(next.length+1),0,make());                                        // interior insert (undo of delete)
  else if(kind===4&&next.length>2){const i=pick(next.length),j=pick(next.length);[next[i],next[j]]=[next[j],next[i]];} // reorder
  else next.push(make());
  return next;
};

test('the index always equals a fresh index of the requested array, across edits and history jumps',()=>{
  resetEntityIndex();serial=0;
  const history=[Array.from({length:3000},make)];
  for(let step=0;step<1500;step++){
    const target=rnd()<.8?edit(history.at(-1)):history[pick(history.length)];   // edit forward or jump (undo/redo)
    if(target!==history.at(-1))history.push(target);
    commitEntities(target);
    const got=entityIndex(target),want=expected(target);
    assert.equal(got.map.size,want.map.size);
    for(const [id,e] of want.map)assert.equal(got.map.get(id),e);
    assert.deepEqual(got.features,want.f);
  }
});

test('entitiesById returns exactly what filter returns, in document order',()=>{
  resetEntityIndex();serial=0;
  const list=Array.from({length:2000},make);commitEntities(list);
  for(let round=0;round<500;round++){
    const ids=new Set(Array.from({length:1+pick(20)},()=>rnd()<.9?list[pick(list.length)].id:'missing'+round));
    assert.deepEqual(entitiesById(list,ids),list.filter(e=>ids.has(e.id)));
  }
});

test('pointer delta reports every changed object for small order-preserving edits',()=>{
  const a=Array.from({length:500},(_,i)=>({id:'a'+i})),b=[...a];b.splice(10,2);b.splice(200,0,{id:'x'});b[300]={id:b[300].id};b.push({id:'y'});
  const d=pointerDelta(a,b),inB=new Set(b),inA=new Set(a);
  assert.deepEqual(new Set(d.removed),new Set(a.filter(e=>!inB.has(e))));
  assert.deepEqual(new Set(d.added),new Set(b.filter(e=>!inA.has(e))));
});

test('arrays the engine has not committed are never indexed, and a grown committed array is re-indexed',()=>{
  resetEntityIndex();serial=0;
  const working=Array.from({length:50},make);
  assert.equal(entityIndex(working),null);
  assert.deepEqual(entitiesById(working,[working[3].id]),[working[3]]);
  commitEntities(working);entityIndex(working);
  const late=make();working.push(late);          // defensive: a length change is detected
  assert.equal(entityIndex(working).map.get(late.id),late);
});

test('changedById equals filter on a working array derived from a committed base',()=>{
  resetEntityIndex();serial=0;
  const base=Array.from({length:3000},make);commitEntities(base);
  for(let round=0;round<600;round++){
    const after=edit(base),pool=[...after,...base];
    const ids=new Set(Array.from({length:1+pick(8)},()=>pool[pick(pool.length)].id));
    assert.deepEqual(changedById(base,after,ids),after.filter(e=>ids.has(e.id)));
  }
});

test('a sliced warm-up installs the same index, and never one for an array the user has left',async()=>{
  resetEntityIndex();
  const list=Array.from({length:1234},make);commitEntities(list);
  let yields=0;
  assert.equal(await warmEntityIndex(list,{slice:100,yieldFn:async()=>{yields++;}}),true);
  assert.equal(yields,13);
  const index=entityIndex(list),want=expected(list);
  assert.deepEqual([...index.map],[...want.map]);
  assert.deepEqual(index.features,want.f);
  // A later array (an edit) became current while warming: the warmed index is dropped.
  resetEntityIndex();
  const next=[...list,make()];commitEntities(next);let current=list;
  const warming=warmEntityIndex(list,{slice:100,isCurrent:()=>current===list,yieldFn:async()=>{current=next;}});
  assert.equal(await warming,false);
  assert.equal(entityIndex(next).map.size,next.length);
  // An uncommitted (working) array is never indexed.
  assert.equal(await warmEntityIndex([...list],{slice:100,yieldFn:async()=>{}}),false);
});