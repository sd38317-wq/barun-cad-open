import test from 'node:test';
import assert from 'node:assert/strict';
import {validateGpuEditMembership} from './gpu-renderer.js';
function originalProof(before,after,removed,added,c){
 const m=validateGpuEditMembership(before,after,removed,added);if(!m)return false;
 let oldIndex=-1,appended=false,priorDepth=-Infinity;
 for(let i=0;i<after.length;i++){
  const e=after[i],index=m.orderIndices[i];
  if(index===-1){
   if(c.retiredSourceDepths.has(e)){if(appended)return false;const depths=c.retiredSourceDepths.get(e),depth=depths?.[0];if(depth!==undefined){if(depth<=priorDepth)return false;priorDepth=depths.at(-1);}continue;}
   appended=true;continue;
  }
  if(appended||index<=oldIndex)return false;oldIndex=index;
  const depth=c.sourceZ.get(e.id);if(depth!==undefined){if(depth<=priorDepth)return false;priorDepth=c.sourcePrimitiveDepths.get(e.id)?.at(-1)??depth;}
 }
 return true;
}
test('fused proof agrees with separate membership and original painter-depth proof',()=>{
 let seed=73,accepted=0,rejected=0;const rand=()=>((seed=Math.imul(seed,1664525)+1013904223>>>0)/4294967296);
 for(let trial=0;trial<4000;trial++){
  const before=Array.from({length:6},(_,i)=>({id:'e'+i})),removed=[],added=[],after=[];
  const c={sourceZ:new Map(),sourcePrimitiveDepths:new Map(),retiredSourceDepths:new WeakMap()};
  before.forEach((e,i)=>{if(rand()<.8){const z=rand()<.1?rand()*8:i+1;c.sourceZ.set(e.id,z);c.sourcePrimitiveDepths.set(e.id,[z,z+.1]);}});
  for(const e of before){const n=rand();if(n<.2)removed.push(e);else if(n<.35){const replacement={...e};removed.push(e);added.push(replacement);after.push(replacement);}else after.push(e);}
  if(rand()<.6){const e={id:'new'},at=rand()<.5?after.length:Math.floor(rand()*(after.length+1));added.push(e);after.splice(at,0,e);if(rand()<.5)c.retiredSourceDepths.set(e,rand()<.2?[]:[at+.5,at+.6]);}
  switch(Math.floor(rand()*8)){
   case 0:after.reverse();break;
   case 1:if(after.length)after.push(after[0]);break;
   case 2:if(after.length)after.pop();break;
   case 3:if(removed.length)removed[0]={...removed[0]};break;
   case 4:if(added.length)added.push(added[0]);break;
   case 5:if(after.length)after[0]={...after[0]};break;
  }
  if(rand()<.05)before.push(before[0]);
  const expected=originalProof(before,after,removed,added,c),actual=validateGpuEditMembership(before,after,removed,added,c);
  assert.equal(!!actual,expected,'trial '+trial);if(expected)accepted++;else rejected++;
  if(actual){assert.equal(actual.orderIndices,null);assert.deepEqual([...actual.removedIds],removed.map(e=>e.id));}
 }
  assert.ok(accepted>100);assert.ok(rejected>100);
});

test('successive cached edits retain full membership and painter-depth rejection semantics',()=>{
 let seed=917,accepted=0,rejected=0;const rand=()=>((seed=Math.imul(seed,1664525)+1013904223>>>0)/4294967296);
 for(let sequence=0;sequence<100;sequence++){
  let before=Array.from({length:12},(_,i)=>({id:'s'+sequence+'e'+i}));
  const c={sourceZ:new Map(),sourcePrimitiveDepths:new Map(),retiredSourceDepths:new WeakMap()};
  for(let step=0;step<80;step++){
   c.sourceZ=new Map(before.map((e,i)=>[e.id,i+1]));c.sourcePrimitiveDepths=new Map(before.map((e,i)=>[e.id,[i+1,i+1.1]]));
   const after=before.slice(),removed=[],added=[],at=Math.floor(rand()*before.length),kind=Math.floor(rand()*8);
   if(kind===0&&before.length){removed.push(before[at]);added.push({...before[at]});after[at]=added[0];}
   else if(kind<=2){added.push({id:'s'+sequence+'new'+step});after.push(added[0]);}
   else if(kind===3&&before.length){removed.push(before[at]);after.splice(at,1);}
   else if(kind===4)after.reverse();
   else if(kind===5&&before.length)after.push(before[at]);
   else if(kind===6&&before.length)after[at]={...before[at]};
   else if(before.length){added.push({id:before[at].id});after.push(added[0]);}
   if(step%17===0&&before.length)c.sourceZ.set(before.at(-1).id,-1);
   const expected=originalProof(before,after,removed,added,c),actual=validateGpuEditMembership(before,after,removed,added,c);
   assert.equal(!!actual,expected,`sequence ${sequence}, step ${step}`);
   if(actual){for(let i=0;i<before.length;i++)assert.equal(actual.oldOrder.get(before[i].id),i);before=after;accepted++;}else rejected++;
  }
 }
 assert.ok(accepted>1000);assert.ok(rejected>1000);
});
