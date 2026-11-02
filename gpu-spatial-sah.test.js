// ACAD200 106·107: 칸 용량 설정과 비용(SAH) 기반 칸 나누기.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createViewportIndex,createViewportIndexSteps,splitSah,gpuCellCapacity,unionBounds} from './gpu-spatial.js';
import {initialGpuChunks} from './gpu-renderer.js';

// 촘촘한 평면(작은 상자 2000개) 옆으로 아주 긴 대지선 40개가 지나가는 배치도.
function siteDrawing(){
  let seed=7;const rnd=()=>(seed=(seed*16807)%2147483647)/2147483647;
  const entries=[];
  for(let i=0;i<2000;i++){const x=rnd()*1000,y=rnd()*1000;entries.push({id:'p'+i,bounds:{minX:x,maxX:x+5,minY:y,maxY:y+5}});}
  for(let i=0;i<40;i++){const y=rnd()*1000;entries.push({id:'site'+i,bounds:{minX:-50000,maxX:50000+i,minY:y,maxY:y+1}});}
  for(let i=0;i<200;i++){const x=20000+rnd()*20000,y=rnd()*1000;entries.push({id:'far'+i,bounds:{minX:x,maxX:x+5,minY:y,maxY:y+5}});}
  return entries;
}
const visited=(index,queries)=>queries.reduce((n,q)=>{const s={};index.query(q,1,s);return n+(s.entries||0);},0);

test('107: SAH index returns the same answers and visits fewer entries on a skewed site plan',()=>{
  const entries=siteDrawing(),median=createViewportIndex(entries),sah=createViewportIndex(entries,{sah:true});
  const queries=[];for(let i=0;i<20;i++)queries.push({minX:i*45,maxX:i*45+40,minY:i*40,maxY:i*40+40});
  queries.push({minX:25000,maxX:26000,minY:0,maxY:1000},{minX:-40000,maxX:-30000,minY:0,maxY:1000});
  for(const q of queries)assert.deepEqual(sah.query(q,1).map(e=>e.id).sort(),median.query(q,1).map(e=>e.id).sort());
  const m=visited(median,queries),s=visited(sah,queries);
  assert.ok(s<=m,`SAH ${s} <= median ${m}`);
  // Sliced construction builds the same tree.
  const steps=createViewportIndexSteps(entries,64,{sah:true});let step;do step=steps.next();while(!step.done);
  assert.equal(visited(step.value,queries),s);
  // Mutations keep working on the SAH tree.
  sah.remove(entries[0]);assert.ok(!sah.query(entries[0].bounds,1).includes(entries[0]));sah.insert(entries[0]);assert.ok(sah.query(entries[0].bounds,1).includes(entries[0]));
});

test('107: SAH falls back to the median for small or degenerate nodes',()=>{
  const few=Array.from({length:10},(_,i)=>({bounds:{minX:i,maxX:i+1,minY:0,maxY:1}}));
  const [a,b]=splitSah(few,unionBounds(few));assert.equal(a.length+b.length,10);assert.ok(a.length&&b.length);
  const same=Array.from({length:100},()=>({bounds:{minX:0,maxX:1,minY:0,maxY:1}}));
  const [c,d]=splitSah(same,unionBounds(same));assert.equal(c.length,50);assert.equal(d.length,50);
  const broken=[...same,{bounds:{minX:-Infinity,maxX:Infinity,minY:-Infinity,maxY:Infinity}}];
  const [e,f]=splitSah(broken,unionBounds(broken));assert.equal(e.length+f.length,101);
});

test('106: the cell capacity defaults to the former 512/4096 leaves and is configurable',()=>{
  assert.equal(gpuCellCapacity(),512);
  const records=n=>Array.from({length:n},(_,i)=>({points:new Float64Array(6),bounds:{minX:i,maxX:i+1,minY:0,maxY:1}}));
  assert.equal(initialGpuChunks(records(1024)).length,2,'512 segments per leaf');
  globalThis.BARUN_GPU_CELL_CAPACITY=1024;
  try{assert.equal(gpuCellCapacity(),1024);assert.equal(initialGpuChunks(records(1024)).length,1);}
  finally{delete globalThis.BARUN_GPU_CELL_CAPACITY;}
  globalThis.BARUN_GPU_CELL_CAPACITY=3;try{assert.equal(gpuCellCapacity(),512,'nonsense ignored');}finally{delete globalThis.BARUN_GPU_CELL_CAPACITY;}
});

test('107: the renderer opens with the median index and swaps in an SAH copy when idle',async()=>{
  const {CadGpuRenderer}=await import('./gpu-renderer.js');
  const r=Object.create(CadGpuRenderer.prototype),entries=siteDrawing().map(e=>({...e,object:{id:e.id},pixelMargin:0,worldMargin:0}));
  Object.assign(r,{stats:{},spatialObjects:new Map(entries.map(e=>[e.object,e])),spatialDirty:false,batchSceneEpoch:1});
  r.viewportIndex=createViewportIndex(entries);const before=r.viewportIndex;
  assert.equal(r.improveCullIndex(Infinity),false);assert.equal(r.cullIndexImproved,true);assert.notEqual(r.viewportIndex,before);
  const q={minX:100,maxX:300,minY:100,maxY:300};assert.deepEqual(r.viewportIndex.query(q,1).map(e=>e.id).sort(),before.query(q,1).map(e=>e.id).sort());
  // A scene change during the idle build abandons the copy.
  const s=Object.create(CadGpuRenderer.prototype);Object.assign(s,{stats:{},spatialObjects:r.spatialObjects,spatialDirty:false,batchSceneEpoch:1,viewportIndex:before});
  assert.equal(s.improveCullIndex(0),true);s.batchSceneEpoch=2;assert.equal(s.improveCullIndex(0),true);assert.equal(s.cullIndexTask.epoch,2,'restarted for the new scene');
});
