import test from 'node:test';
import assert from 'node:assert/strict';
import {createUndoLog,UNDO_PAGE_BYTES} from './undo-log.js';

const memoryBackend=()=>{const m=new Map();return {m,put:async(k,v)=>{m.set(k,v);},get:async k=>m.get(k),delete:async k=>{m.delete(k);}};};
const record=i=>({op:'update',ids:['e'+i],before:{layer:'L'+i,text:'가'.repeat(200)}});

test('208 · 32KB 페이지에 쌓고, 예산을 넘으면 오래된 페이지부터 저장소로 내린다',async()=>{
  const backend=memoryBackend(),log=createUndoLog({backend,memoryBudget:UNDO_PAGE_BYTES*2});
  for(let i=0;i<400;i++)log.append(record(i));
  await log.flush();
  const st=log.stats();
  assert.ok(st.pages>3,'여러 페이지');assert.ok(st.onDisk>=1,'오래된 페이지는 저장소로');
  assert.ok(st.memUsed<=UNDO_PAGE_BYTES*3,'메모리는 예산 근처');
  assert.equal(st.records,400);assert.ok(backend.m.size>=1);
});

test('208 · 되돌리기는 뒤에서 앞으로, 내린 페이지도 다시 읽는다',async()=>{
  const backend=memoryBackend(),log=createUndoLog({backend,memoryBudget:UNDO_PAGE_BYTES});
  for(let i=0;i<300;i++)log.append(record(i));
  await log.flush();
  const seen=[];for await(const r of log.reverse())seen.push(Number(r.ids[0].slice(1)));
  assert.deepEqual(seen,Array.from({length:300},(_,i)=>299-i));
  for(let i=299;i>=0;i--){const r=await log.pop();assert.equal(r.ids[0],'e'+i);}
  assert.equal(await log.pop(),undefined);assert.equal(backend.m.size,0,'다 읽은 페이지는 저장소에서도 지운다');
});

test('208 · 저장소에서 페이지가 사라져도 남은 기록은 쓰고, 잃은 단계 수를 알려 준다',async()=>{
  const backend=memoryBackend(),log=createUndoLog({backend,memoryBudget:UNDO_PAGE_BYTES});
  for(let i=0;i<300;i++)log.append(record(i));
  await log.flush();backend.m.clear();
  let count=0;while(await log.pop())count++;
  assert.ok(count>0&&count<300);assert.equal(log.stats().lost,300-count);
});

test('208 · 저장소가 없으면 예산을 지키려 가장 오래된 기록을 버리고 그 수를 센다',async()=>{
  const log=createUndoLog({memoryBudget:UNDO_PAGE_BYTES});
  for(let i=0;i<300;i++)log.append(record(i));
  await log.flush();
  assert.ok(log.stats().lost>0);assert.equal((await log.pop()).ids[0],'e299');
});
