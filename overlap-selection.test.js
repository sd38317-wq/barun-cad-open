import test from 'node:test';
import assert from 'node:assert/strict';
import {OverlapSelection} from './overlap-selection.js';
const candidates=[{id:'wall',layer:'same'},{id:'dim',layer:'same'},{id:'text',layer:'another'}];
test('Shift cycles every entity including the same layer and replaces only the active candidate',()=>{
 const s=new OverlapSelection();let selected=new Set(['other']);
 for(const id of ['wall','dim','text','wall']){
  const hit=s.pick(candidates,{x:10,y:10},1,selected,true);assert.equal(hit.id,id);
  selected=s.select(hit.id);assert.deepEqual([...selected],['other',id]);
 }
});
test('Shift after an ordinary single selection advances to the next candidate',()=>{
 const s=new OverlapSelection();const hit=s.pick(candidates,{x:10,y:10},1,new Set(['other','wall']),true);
 assert.equal(hit.id,'dim');assert.deepEqual([...s.select(hit.id)],['other','dim']);
});
test('list selection and context change reset stale candidates',()=>{
 const s=new OverlapSelection();s.pick(candidates,{x:0,y:0},1,new Set());
 assert.deepEqual([...s.select('text')],['text']);assert.equal(s.select('deleted'),null);
 assert.equal(s.pick(candidates,{x:0,y:0},2,new Set(),true).id,'wall');
 s.clear();assert.equal(s.select('wall'),null);
});
test('small cursor jitter does not reset cycling when distance ordering changes',()=>{
 const s=new OverlapSelection();s.pick(candidates,{x:10,y:10},1,new Set());
 assert.equal(s.pick([...candidates].reverse(),{x:11,y:10},1,new Set(['wall']),true).id,'dim');
});
