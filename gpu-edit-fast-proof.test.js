import test from 'node:test';
import assert from 'node:assert/strict';
import {fastGpuEditMembership,validateGpuEditMembership} from './gpu-renderer.js';

let seed=11;const rnd=()=>(seed=(seed*1103515245+12345)%2147483648)/2147483648,pick=n=>Math.floor(rnd()*n);
const entity=id=>({id,type:'line',points:[{x:0,y:0},{x:1,y:1}]});
const doc=n=>Array.from({length:n},(_,i)=>entity('e'+i));
const index=list=>new Map(list.map(e=>[e.id,e]));
const sameSets=(a,b)=>a.size===b.size&&[...a].every(x=>b.has(x));

// Valid commit shapes the engine produces for lightweight edits.
function append(before,k){const added=Array.from({length:k},(_,i)=>entity('n'+i+'-'+rnd()));return {after:[...before,...added],removed:[],added};}
function replace(before,k){const at=new Set();while(at.size<k)at.add(pick(before.length));const removed=[],added=[];const after=before.map((e,i)=>{if(!at.has(i))return e;const next={...e,points:[{x:9,y:9},{x:8,y:8}]};removed.push(e);added.push(next);return next;});return {after,removed,added};}
function erase(before,k){const at=new Set();while(at.size<k)at.add(pick(before.length));const removed=before.filter((_,i)=>at.has(i));return {after:before.filter((_,i)=>!at.has(i)),removed,added:[]};}
function mixed(before){const r=replace(before,1+pick(3)),a=append(r.after,1+pick(3));return {after:a.after,removed:r.removed,added:[...r.added,...a.added]};}

test('fast proof accepts the common commit shapes with the complete proof\'s result',()=>{
  const before=doc(5000),ids=index(before);
  for(let round=0;round<400;round++){
    const shape=[()=>append(before,1+pick(4)),()=>replace(before,1+pick(4)),()=>erase(before,1+pick(4)),()=>mixed(before)][round%4]();
    const fast=fastGpuEditMembership(before,shape.after,shape.removed,shape.added,ids),full=validateGpuEditMembership(before,shape.after,shape.removed,shape.added);
    assert.ok(fast,'shape '+round%4+' must take the fast path');assert.ok(full);
    assert.ok(sameSets(fast.removedIds,full.removedIds));
    assert.deepEqual([...fast.newById.keys()].sort(),[...full.newById.keys()].sort());
    for(const e of shape.added)assert.equal(fast.oldOrder.has(e.id),full.oldOrder.has(e.id));
  }
});

test('fast proof never accepts an edit the complete proof rejects',()=>{
  const before=doc(400),ids=index(before);let rejected=0,fastAccepted=0;
  const corrupt=[
    s=>{const a=[...s.after];const i=pick(a.length),j=pick(a.length);[a[i],a[j]]=[a[j],a[i]];return {...s,after:a};},           // reorder
    s=>({...s,after:s.after.filter((_,i)=>i!==pick(s.after.length))}),                                                          // undeclared removal
    s=>({...s,after:[...s.after,before[pick(before.length)]]}),                                                                  // duplicate retained object
    s=>({...s,added:[...s.added,entity('e'+pick(before.length))],after:[...s.after,entity('x')]}),                            // added id collides
    s=>({...s,removed:[...s.removed,before[pick(before.length)]]}),                                                             // declared but kept
    s=>{const a=[...s.after];a.splice(pick(a.length),0,entity('mid'+rnd()));return {...s,after:a,added:[...s.added,a.find(e=>String(e.id).startsWith('mid'))]};}, // interior new insert
    s=>({...s,removed:[...s.removed,{...before[pick(before.length)]}]}),                                                        // removed object is a stale copy
    s=>s,                                                                                                                        // unchanged valid shape
  ];
  for(let round=0;round<4000;round++){
    const base=[()=>append(before,1+pick(3)),()=>replace(before,1+pick(3)),()=>erase(before,1+pick(3)),()=>mixed(before)][pick(4)]();
    const s=corrupt[pick(corrupt.length)](base);
    const fast=fastGpuEditMembership(before,s.after,s.removed,s.added,ids),full=validateGpuEditMembership(before,s.after,s.removed,s.added);
    if(!full){rejected++;assert.equal(fast,null,'fast path accepted an edit the complete proof rejects (round '+round+')');}
    if(fast){fastAccepted++;assert.ok(full);assert.ok(sameSets(fast.removedIds,full.removedIds));}
  }
  assert.ok(rejected>500&&fastAccepted>500,'the fuzz exercised both outcomes');
});

test('restorations follow the complete proof, including painter-depth rejections',()=>{
  // Depth context as the renderer keeps it: every live source has monotone slots.
  const full=doc(300),z=new Map(full.map((e,i)=>[e.id,i/300]));
  const ctx=(live,retiredPairs)=>({sourceZ:new Map(live.map(e=>[e.id,z.get(e.id)])),sourcePrimitiveDepths:new Map(live.map(e=>[e.id,[z.get(e.id)]])),retiredSourceDepths:new WeakMap(retiredPairs)});
  let checked=0,fastRejected=0;
  for(let round=0;round<3000;round++){
    const gone=new Set();while(gone.size<1+pick(3))gone.add(full[pick(full.length)]);
    const before=full.filter(e=>!gone.has(e)),ids=index(before),restored=[...gone];
    // Correct slots, or a slot shifted so it collides with a neighbour.
    const slots=restored.map(e=>round%3===0?[z.get(e.id)+(rnd()<.5?.02:-.02)]:[z.get(e.id)]);
    const context=ctx(before,restored.map((e,i)=>[e,slots[i]]));
    const shapes=[full,[...before,...restored]];   // back in place (undo of ERASE) or at the tail
    const after=shapes[round%2];
    const fast=fastGpuEditMembership(before,after,[],restored,ids,context),legacy=validateGpuEditMembership(before,after,[],restored,context);
    if(!legacy)assert.equal(fast,null,'fast path accepted a restoration the complete proof rejects (round '+round+')');
    if(fast){checked++;assert.ok(legacy);assert.deepEqual([...fast.newById.keys()].sort(),[...legacy.newById.keys()].sort());}
    else fastRejected++;
  }
  assert.ok(checked>500,'restorations take the fast path');
});
