// ACAD200 101·116: 우선순위 큐(화면 안 → 근처 → 나머지, 칸 안은 중심 거리순)와 정제 단위 순서.
import test from 'node:test';
import assert from 'node:assert/strict';
import {GpuRegenQueue,regenPriority,orderRefineUnits} from './gpu-regen-queue.js';

const box=(x,y,s=1)=>({minX:x,maxX:x+s,minY:y,maxY:y+s});
test('101: visible jobs run before near and rest; same key keeps only the latest',()=>{
  const ran=[],q=new GpuRegenQueue({run:job=>ran.push(job.name)});
  q.enqueue({name:'rest'},'rest');q.enqueue({name:'near'},'near');q.enqueue({name:'v-far',distance:9},'visible');q.enqueue({name:'v-close',distance:1},'visible');
  q.enqueue({name:'old',key:'k'},'rest');q.enqueue({name:'new',key:'k'},'near');
  assert.equal(q.size,5);assert.equal(q.stats.replaced,1);
  q.pump();assert.deepEqual(ran,['v-close','v-far','near','new','rest']);
  q.enqueue({name:'save'},'rest',true);assert.equal(ran.at(-1),'save','sync request runs at once');assert.equal(q.size,0);
});
test('101: a bounded pump runs at least one job and leaves the rest queued',()=>{
  let t=0;const q=new GpuRegenQueue({run:()=>{t+=10;},now:()=>t});
  for(let i=0;i<5;i++)q.enqueue({},'visible');
  assert.equal(q.pump(5),1);assert.equal(q.size,4);assert.equal(q.pump(25),3);assert.equal(q.pump(Infinity),1);
});
test('regenPriority classifies against the view and its margin',()=>{
  const view={minX:0,maxX:100,minY:0,maxY:100};
  assert.equal(regenPriority(box(10,10),view),'visible');assert.equal(regenPriority(box(130,10),view),'near');assert.equal(regenPriority(box(400,10),view),'rest');
  assert.equal(regenPriority(null,view),'rest');
});
test('116: refinement units nearest the view centre come first',()=>{
  const view={minX:0,maxX:100,minY:0,maxY:100},unit=(name,...bounds)=>({name,details:bounds.map(b=>({bounds:b}))});
  const units=[unit('edge',box(0,0)),unit('outside',box(300,300)),unit('centre',box(49,49)),unit('mixed',box(500,500),box(60,60))];
  assert.deepEqual(orderRefineUnits(units,view).map(u=>u.name),['centre','mixed','edge','outside']);
  assert.equal(orderRefineUnits([units[0]],view)[0],units[0]);
});
