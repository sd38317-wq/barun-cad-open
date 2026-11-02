import test from 'node:test';
import assert from 'node:assert/strict';
import {expandSharedDrawingBlocks,expandSharedDrawingBlocksAsync,transformEntity,entityDistance,prepareEntityDistanceIndex,queryEntityPrimitives} from './geometry.js';

const line=()=>({id:'line',type:'line',layer:'default',points:[{x:1,y:2},{x:3,y:2}],metadata:{label:'original'}});
const fixture=()=>({entities:[0,1,2].map(i=>({id:`insert-${i}`,type:'block',name:'outer',sharedBlock:'outer',position:{x:i*100,y:20},scale:2,rotation:90})),sharedBlocks:{
  inner:{origin:{x:1,y:2},entities:[line()]},
  outer:{origin:{x:0,y:0},entities:[{id:'nested',type:'block',name:'inner',sharedBlock:'inner',position:{x:10,y:0},scale:3,rotation:0}]}
}});
test('shared nested definitions keep transforms, unique IDs and independent editing',()=>{
  const doc=fixture(),original=structuredClone(doc.sharedBlocks);
  expandSharedDrawingBlocks(doc);
  assert.equal(doc.sharedBlocks,undefined);
  const ids=new Set();
  for(const [i,insert] of doc.entities.entries()){
    const nested=insert.entities[0],child=nested.entities[0];
    for(const e of [insert,nested,child]){assert.ok(!ids.has(e.id));ids.add(e.id);}
    assert.ok(Math.abs(child.points[0].x-i*100)<1e-9);
    assert.equal(child.points[0].y,40);
    assert.equal(child.points[1].y,52);
  }
  doc.entities[0].entities[0].entities[0].points[0].x=999;
  doc.entities[0].entities[0].entities[0].metadata.label='edited';
  assert.equal(doc.entities[1].entities[0].entities[0].metadata.label,'original');
  assert.equal(original.inner.entities[0].points[0].x,1);
});
test('async shared expansion reuses preparation across batches with independent IDs',async()=>{
  const doc=fixture(),progress=[];
  await expandSharedDrawingBlocksAsync(doc,{chunkSize:1,onProgress:n=>progress.push(n)});
  assert.deepEqual(progress,[1,2,3]);
  assert.equal(doc.entities.length,3);
  assert.equal(new Set(doc.entities.map(e=>e.entities[0].entities[0].id)).size,3);
});
test('cyclic and missing shared definitions are rejected',()=>{
  const doc=fixture();doc.sharedBlocks.inner.entities=[{type:'block',sharedBlock:'outer'}];
  assert.throws(()=>expandSharedDrawingBlocks(doc),/순환 또는 누락/);
  const missing=fixture();delete missing.sharedBlocks.inner;
  assert.throws(()=>expandSharedDrawingBlocks(missing),/순환 또는 누락/);
});
test('nested transform clones each entity without changing source metadata',()=>{
  const source={type:'block',entities:[{type:'block',entities:[line()]}]},before=structuredClone(source);
  const result=transformEntity(source,p=>({x:p.x+10,y:p.y+20}));
  assert.deepEqual(source,before);
  assert.deepEqual(result.entities[0].entities[0].points,[{x:11,y:22},{x:13,y:22}]);
  result.entities[0].entities[0].metadata.label='edited';
  assert.equal(source.entities[0].entities[0].metadata.label,'original');
});
test('large imported blocks can be picked without exceeding function argument limits',()=>{
  const entity={type:'block',entities:Array.from({length:150000},(_,i)=>({type:'point',position:{x:i,y:10}}))};
  assert.equal(entityDistance(entity,{x:75000,y:0}),10);
});
test('large imported block pick reuses a local spatial index for finite pick tolerance',()=>{
  const entity={type:'block',entities:Array.from({length:150000},(_,i)=>({type:'point',position:{x:i,y:10}}))};
  const prepared=prepareEntityDistanceIndex(entity);assert.equal(prepareEntityDistanceIndex(entity),prepared);
  assert.equal(entityDistance(entity,{x:75000,y:0},12),10);
  assert.equal(entityDistance(entity,{x:75000,y:0},2),Infinity);
  assert.equal(entityDistance(entity,{x:149999,y:10},2),0);
});
test('primitive snap query filters a block to the small nearby subset',()=>{
  const entity={type:'block',entities:Array.from({length:5000},(_,i)=>({type:'point',position:{x:i,y:10}}))};
  const nearby=queryEntityPrimitives(entity,{minX:2498,minY:8,maxX:2502,maxY:12});
  assert.equal(nearby.length,5);
  assert.deepEqual(nearby.map(item=>item.position.x),[2498,2499,2500,2501,2502]);
});
