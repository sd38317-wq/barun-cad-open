import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spatialIndex,SPATIAL_COMPACT_MIN} from './geometry.js';

const line=(i,dx=0)=>({id:'l'+i,type:'line',layer:'0',points:[{x:i*10+dx,y:0},{x:i*10+dx+5,y:5}]});

test('223 · 공간 색인은 바뀐 것만 고치고, 차이가 바탕의 25%를 넘을 때만 다시 지을 때라고 알린다',()=>{
  const items=Array.from({length:SPATIAL_COMPACT_MIN},(_,i)=>line(i)),index=spatialIndex(items);
  assert.equal(index.needsCompaction(),false);
  const moved=items.slice(0,4000).map(e=>line(Number(e.id.slice(1)),3));
  index.remove(items.slice(0,4000));index.insert(moved);
  assert.deepEqual(index.stats(),{base:SPATIAL_COMPACT_MIN,removed:4000,delta:4000,roots:7,pending:416});
  assert.equal(index.needsCompaction(),true,'8000 > 20000×25%');
  // 되돌리기: 옛 객체가 돌아오면 지운 표시가 풀린다(항목을 두 번 넣지 않는다).
  index.remove(moved);index.insert(items.slice(0,4000));
  assert.equal(index.stats().removed,4000,'되돌린 바탕 객체 4000개는 다시 살아나고, 옮긴 4000개가 지운 표시');
  const hit=index.query({minX:0,minY:0,maxX:6,maxY:6});
  assert.deepEqual(hit,[items[0]],'질의 결과는 그대로 정확하다');
});

test('223 · 작은 도면은 다시 짓기를 요청하지 않는다(장면을 다시 그릴 때 저절로 새로)',()=>{
  const items=Array.from({length:100},(_,i)=>line(i)),index=spatialIndex(items);
  index.remove(items);index.insert(items.map(e=>line(Number(e.id.slice(1)),1)));
  assert.equal(index.needsCompaction(),false);
});

test('223 · app.js 는 쉴 때만(입력·작업 중이 아닐 때) 다시 짓는다',()=>{
  const app=readFileSync(new URL('./app.js',import.meta.url),'utf8');
  const start=app.indexOf('function scheduleSpatialCompaction(){'),body=app.slice(start,app.indexOf('\nfunction execute(',start));
  assert.match(body,/requestIdleCallback/);assert.match(body,/recoveryInputActive\(\)/);assert.match(body,/busy/);
  assert.match(app,/renderSpatial\.needsCompaction\?\.\(\)&&typeof scheduleSpatialCompaction==='function'/);
});
