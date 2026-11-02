// ACAD200 113 (1단계): 블록 정의 한 벌 + 참조마다 행렬 칸, 바뀐 풀은 flush 때 한 번만 올린다.
import test from 'node:test';
import assert from 'node:assert/strict';
import {GpuInstancePools,referenceAffine} from './gpu-instance-pools.js';

const square=new Float32Array([0,0,0,1,0,0, 1,0,0,1,1,0, 1,1,0,0,1,0, 0,1,0,0,0,0]);
test('references share one definition buffer and differ only by their slot matrix',()=>{
  const pools=new GpuInstancePools();
  for(let i=0;i<100;i++)pools.add('door',{id:'d'+i,position:{x:i*10,y:0},rotation:i%2?90:0},square,'#ff0000');
  const pool=pools.pools.get('door');assert.equal(pools.stats.pools,1);assert.equal(pool.geometry.getAttribute('position').array,square,'definition stored once');
  assert.equal(pools.flush(),1);assert.equal(pool.geometry.instanceCount,100);assert.equal(pool.geometry.getAttribute('instanceRow0').count,100);
  assert.equal(pools.flush(),0,'nothing changed: no upload');
  const p=pools.transformed('door','d1',{x:1,y:0});assert.ok(Math.abs(p.x-10)<1e-6&&Math.abs(p.y-1)<1e-6,'rotated 90 about its insertion point');
});
test('removing frees a slot that the next reference reuses; changes upload once per flush',()=>{
  const pools=new GpuInstancePools();for(let i=0;i<3;i++)pools.add('w',{id:'w'+i,position:{x:i,y:0}},square);pools.flush();
  pools.remove('w','w1');pools.add('w',{id:'n',position:{x:9,y:9}},square);
  const pool=pools.pools.get('w');assert.equal(pool.count,3,'slot reused, no growth');assert.equal(pool.byId.get('n'),1);
  assert.equal(pools.flush(),1);assert.equal(pools.stats.uploads,2);
  assert.equal(pools.remove('w','missing'),false);
  const many=new GpuInstancePools();for(let i=0;i<40;i++)many.add('k',{id:'k'+i,position:{x:i,y:0},scale:2},square);many.flush();
  assert.equal(many.pools.get('k').geometry.instanceCount,40,'slot storage grows');assert.deepEqual(referenceAffine({position:{x:1,y:2},scale:2}),[2,0,-0,2,1,2]);
  pools.dispose();many.dispose();
});
