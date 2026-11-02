import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {createLowMemoryMonitor,lowMemCheck,heapRatio,LOW_MEMORY_MESSAGES,HEAVY_COMMANDS} from './low-memory.js';
import {largeRecoveryPlan,LOW_MEMORY_RECOVERY_INTERVAL_MS} from './bridge-client.js';

test('206 · 85%에서 켜고 75% 아래에서 끄는 두 문턱(되튐 없음)',()=>{
  let r=0.5;const m=createLowMemoryMonitor({read:()=>r});
  assert.equal(m.check().low,false);
  r=0.86;assert.deepEqual(m.check(),{low:true,ratio:0.86,changed:true});
  r=0.8;assert.equal(m.check().low,true,'80% 는 아직 저메모리');
  r=0.74;const c=m.check();assert.equal(c.low,false);assert.equal(c.changed,true);
  assert.equal(m.transitions,2);
  assert.equal(heapRatio({usedJSHeapSize:3,jsHeapSizeLimit:4}),0.75);assert.equal(heapRatio(undefined),0);
});

test('206 · 명령 시작 검사: 무거운 명령만 막고, 복구본을 먼저 남기고, 끌 수 있다',()=>{
  let r=0.9,flushed=0;const toasts=[];const m=createLowMemoryMonitor({read:()=>r});
  const deps={toast:(t,e)=>toasts.push([t,e]),flushRecovery:()=>{flushed++;return Promise.resolve();},monitor:m,now:1000};
  assert.equal(lowMemCheck('LINE',deps),true,'가벼운 명령은 계속');
  assert.equal(flushed,1);assert.equal(toasts[0][0],LOW_MEMORY_MESSAGES.warn);
  assert.equal(lowMemCheck('ARRAY',{...deps,now:2000}),false,'무거운 명령은 막는다');
  assert.equal(flushed,1,'1분 안에는 복구본을 다시 쓰지 않는다');
  assert.equal(toasts.at(-1)[0],LOW_MEMORY_MESSAGES.blocked);
  assert.equal(lowMemCheck('ARRAY',{...deps,now:70000}),false);assert.equal(flushed,2);
  assert.equal(lowMemCheck('ARRAY',{...deps,enabled:false}),true,'설정으로 끈다');
  r=0.5;assert.equal(lowMemCheck('ARRAY',{...deps,now:80000}),true);assert.equal(toasts.at(-1)[0],LOW_MEMORY_MESSAGES.recovered);
  assert.ok(HEAVY_COMMANDS.has('EXPLODE')&&!HEAVY_COMMANDS.has('LINE'));
});

test('207 · 저메모리면 대용량 복구본을 2분 기다리지 않고 30초 간격으로 남긴다',()=>{
  const base={count:200000,revision:5,sentRevision:4,lastSentAt:0,dirty:true};
  assert.equal(largeRecoveryPlan({...base,now:40000}).send,false,'평소에는 2분');
  assert.deepEqual(largeRecoveryPlan({...base,now:40000,lowMem:true}),{send:true,reason:'low-memory'});
  assert.equal(largeRecoveryPlan({...base,now:LOW_MEMORY_RECOVERY_INTERVAL_MS-1,lowMem:true}).send,false,'보내는 일도 메모리를 쓰니 매번은 아님');
  assert.equal(largeRecoveryPlan({...base,now:40000,lowMem:true,revision:4}).send,false,'바뀐 것이 없으면 안 보낸다');
});

test('207 · 화면이 죽었을 때 문구는 미리 만들어 두고, 메모리 부족이면 할 일까지 알린다',()=>{
  const source=readFileSync(new URL('./desktop.cjs',import.meta.url),'utf8');
  const start=source.indexOf('const CRASH_NOTICES'),end=source.indexOf('\n',source.indexOf('function crashNotice'));
  const context={};vm.runInNewContext(source.slice(start,end)+'\nthis.crashNotice=crashNotice;',context);
  const oom=context.crashNotice({reason:'oom'});
  assert.match(oom.message,/메모리가 부족/);assert.match(oom.detail,/복구본/);assert.match(oom.detail,/탭을 닫아/);
  assert.match(context.crashNotice({reason:'launch-failed'}).message,/\(launch-failed\)\.$/);
  assert.match(source,/const notice=crashNotice\(details\);/);
});
