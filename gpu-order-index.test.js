import test from 'node:test';
import assert from 'node:assert/strict';
import {GpuOrderIndexCache} from './gpu-order-index.js';
test('ordinal reuse preserves previous lookup through replacements and bounded append chains',()=>{
 const cache=new GpuOrderIndexCache();let before=[{id:'a'},{id:'b'}],index=cache.get(before);
 const first=index;
 for(let k=0;k<24;k++){
   const after=before.map(e=>({...e}));after.push({id:'n'+k});cache.rememberAfter(before,after,index);
   assert.equal(index.has('n'+k),false,'previous proof index stays immutable');
   index=cache.get(after);for(let i=0;i<after.length;i++)assert.equal(index.get(after[i].id),i);
   assert.ok(cache.entry.depth<=8);before=after;
 }
 assert.equal(first.size,2);assert.equal(first.has('n0'),false);
});
test('mutated IDs, reorder, deletion and duplicate IDs cannot reuse stale ordinals',()=>{
 const cache=new GpuOrderIndexCache(),before=[{id:'a'},{id:'b'}];let index=cache.get(before);
 before[0].id='c';index=cache.get(before);assert.equal(index.has('a'),false);assert.equal(index.get('c'),0);
 before.reverse();index=cache.get(before);assert.equal(index.get('b'),0);
 const after=[before[1]];cache.rememberAfter(before,after,index);assert.equal(cache.entry,null);assert.equal(cache.get(after).get('c'),0);
 after.push({id:'c'});assert.equal(cache.get(after),null);
 cache.clear();assert.equal(cache.entry,null);
});
