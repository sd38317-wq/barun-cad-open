import test from 'node:test';
import assert from 'node:assert/strict';
import { createPackedBoundsIndex } from './packed-bounds-index.js';

const overlap = (a, b) => !(a.minX > b.maxX || a.maxX < b.minX || a.minY > b.maxY || a.maxY < b.minY);
test('organ-pipe input exercises bounded fallback and preserves exact results',()=>{
 const boxes=Array.from({length:1024},(_,i)=>{const x=Math.min(i,1023-i);return {minX:x,minY:0,maxX:x,maxY:0};});
 const original=Uint32Array.prototype.sort;let calls=0,index;
 try{
  Uint32Array.prototype.sort=function(...args){calls++;return original.apply(this,args);};
  index=createPackedBoundsIndex(boxes.length,i=>boxes[i]);
 }finally{Uint32Array.prototype.sort=original;}
 assert.ok(calls>0,'the actual default-budget fallback must run');
 for(let x=0;x<512;x+=7){const box={minX:x,minY:0,maxX:x+3,maxY:0};assert.deepEqual(index.query(box),boxes.flatMap((b,i)=>overlap(b,box)?[i]:[]));}
});
test('branched tree supports equal centers and near-limit finite coordinates',()=>{
 for(const equal of [true,false]){
  const boxes=Array.from({length:127},(_,i)=>{const x=equal?0:(i%2?1:-1)*Number.MAX_VALUE*(.5+i/512);return {minX:x,minY:0,maxX:x,maxY:0};});
  const index=createPackedBoundsIndex(boxes.length,i=>boxes[i]);
  for(const box of [{minX:-Number.MAX_VALUE,minY:0,maxX:Number.MAX_VALUE,maxY:0},{minX:0,minY:0,maxX:0,maxY:0},{minX:0,minY:0,maxX:Number.MAX_VALUE,maxY:0}])assert.deepEqual(index.query(box),boxes.flatMap((b,i)=>overlap(b,box)?[i]:[]));
 }
});
test('matches brute force, preserves source independence and sorted original ids', () => {
  const source = Array.from({length: 200}, (_, i) => i % 17 === 0 ? null : {minX: i - 100, minY: -i, maxX: i - 99, maxY: -i + 2});
  source.push({minX: 5, minY: 5, maxX: 5, maxY: 5}, {minX: 9, minY: 3, maxX: 1, maxY: 4}, {minX: Infinity, minY: 0, maxX: 1, maxY: 1});
  let calls = 0; const index = createPackedBoundsIndex(source.length, i => { calls++; return source[i]; });
  assert.equal(calls, source.length); const snapshot = structuredClone(source); source[1].minX = 10000;
  for (const box of [{minX:-20,minY:-100,maxX:20,maxY:0},{minX:5,minY:5,maxX:5,maxY:5},{minX:-1e9,minY:-1e9,maxX:1e9,maxY:1e9}]) {
    const expected = snapshot.map((b, i) => b && b.minX <= b.maxX && b.minY <= b.maxY && Number.isFinite(b.minX) && Number.isFinite(b.minY) && Number.isFinite(b.maxX) && Number.isFinite(b.maxY) && overlap(b, box) ? i : -1).filter(i => i >= 0);
    assert.deepEqual(index.query(box), expected);
  }
  assert.equal(createPackedBoundsIndex(3, () => null).byteLength, 3 * 4 * Float64Array.BYTES_PER_ELEMENT);
  assert.equal(calls, source.length);
});
test('adversarial sorted reversed equal organ-pipe large and leaf-boundary inputs match brute force',()=>{
 const make=xs=>xs.map((x,i)=>({minX:x,minY:-i,maxX:x+1,maxY:-i+1}));
 const cases=[Array.from({length:25},(_,i)=>i),Array.from({length:25},(_,i)=>24-i),Array(25).fill(7),[0,1,2,3,4,5,4,3,2,1,0].concat(Array.from({length:14},(_,i)=>i)),[-1e150,1e150,0,1e120,-1e120],Array.from({length:12},(_,i)=>i),Array.from({length:13},(_,i)=>i)];
 for(const values of cases){const items=make(values),index=createPackedBoundsIndex(items.length,i=>items[i]);for(const box of [{minX:-1e151,minY:-100,maxX:1e151,maxY:100},{minX:0,minY:-10,maxX:8,maxY:10},{minX:7,minY:-30,maxX:7,maxY:30}]){const expected=items.map((b,i)=>b.minX<=box.maxX&&b.maxX>=box.minX&&b.minY<=box.maxY&&b.maxY>=box.minY?i:-1).filter(i=>i>=0);assert.deepEqual(index.query(box),expected);}}
});
test('handles empty and invalid query boxes', () => { const index = createPackedBoundsIndex(3, () => null); assert.deepEqual(index.query({minX:0,minY:0,maxX:1,maxY:1}), []); assert.deepEqual(index.query(null), []); });

test('seeded random queries match brute force and storage counts are exact', () => {
  let seed=17; const random=()=>((seed=Math.imul(seed,1664525)+1013904223>>>0)/4294967296);
  const nodeCount=n=>n===0?0:n<=12?1:1+nodeCount(Math.floor(n/2))+nodeCount(Math.ceil(n/2));
  for(const size of [0,1,12,13,24,25,100,1024,11014]){
    const boxes=Array.from({length:size},()=>{const x=(random()-.5)*1e8,y=(random()-.5)*1e8;return {minX:x,minY:y,maxX:x+random()*1e6,maxY:y+random()*1e6};});
    let calls=0;const index=createPackedBoundsIndex(size,i=>{calls++;return boxes[i];});
    assert.equal(index.byteLength,size*36+nodeCount(size)*48);
    for(let j=0;j<40;j++){
      const x=(random()-.5)*1e8,y=(random()-.5)*1e8,b={minX:x,minY:y,maxX:x+random()*3e7,maxY:y+random()*3e7};
      assert.deepEqual(index.query(b),boxes.flatMap((a,i)=>overlap(a,b)?[i]:[]));
    }
    assert.equal(calls,size);
  }
});
