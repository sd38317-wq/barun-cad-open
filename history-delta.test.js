import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {composeDelta,invertDelta,createHistoryLog,deltaFits} from './history-delta.js';
import {DrawingEngine} from './engine.js';
import {pointerDelta} from './entity-index.js';

const line=(id,x)=>({id,type:'line',layer:'default',points:[{x,y:0},{x:x+10,y:0}]});
// app.js 와 같은 방식으로 화면 쪽 차이를 계산해 엔진에 알려 주는 작은 실행기.
function run(engine,command){
  const before=engine.doc;engine.execute(command);
  if(engine.lastExecution?.lightweight)engine.noteStepDelta(before,engine.doc,pointerDelta(before.entities,engine.doc.entities,1e9));
}

test('209 · 차이 합성: 같은 객체를 여러 번 바꿔도 처음 본 이전 객체만 남는다',()=>{
  const a0={id:'a'},a1={id:'a'},a2={id:'a'},b={id:'b'},c={id:'c'};
  const step1={removed:[a0],added:[a1,c]},step2={removed:[a1,c],added:[a2]};
  assert.deepEqual(composeDelta(step1,step2),{removed:[a0],added:[a2]});
  assert.deepEqual(composeDelta({removed:[b],added:[]},{removed:[],added:[b]}),{removed:[],added:[]},'뺐다 다시 넣으면 차이 없음');
  assert.equal(composeDelta(step1,null),null);
  assert.deepEqual(invertDelta(step1),{removed:[a1,c],added:[a0]});
  assert.equal(deltaFits([1,2],[1,3,4],{removed:[2],added:[3,4]}),true);
  assert.equal(deltaFits([1,2],[1,3],{removed:[],added:[3]}),false);
});

test('209 · 기록은 문서를 약하게 가리키고, 되돌리기·다시 실행 방향을 모두 찾는다',()=>{
  const log=createHistoryLog({limit:2}),A={},B={},C={};
  const d={removed:[1],added:[2]};
  log.record(A,B,d);
  assert.deepEqual(log.between(B,A),{delta:{removed:[2],added:[1]},rebuild:false,direction:'undo'});
  assert.deepEqual(log.between(A,B),{delta:d,rebuild:false,direction:'redo'});
  assert.equal(log.between(C,A),null);
  assert.equal(log.record(B,C,{removed:[1,2],added:[3]}),false,'한도를 넘는 차이는 남기지 않는다');
  assert.equal(log.between(C,B).delta,null);
});

test('211 · 되돌리기·다시 실행은 실행 때 남긴 차이를 싣는다(두 배열 비교 없음)',()=>{
  const e=new DrawingEngine();
  for(let i=0;i<30;i++)run(e,{type:'add',entity:line('l'+i,i*20)});
  const before=e.doc;
  run(e,{type:'move',ids:['l3'],dx:5,dy:0});
  const moved=e.doc.entities.find(x=>x.id==='l3'),old=before.entities.find(x=>x.id==='l3');
  e.execute({type:'undo'});
  assert.equal(e.lastExecution.history,true);
  assert.deepEqual(e.lastExecution.delta,{removed:[moved],added:[old]});
  e.execute({type:'redo'});
  assert.deepEqual(e.lastExecution.delta,{removed:[old],added:[moved]});
  assert.equal(e.lastExecution.lightweight,undefined,'되돌리기는 가벼운 편집으로 보이지 않는다');
});

test('213 · 묶음 안 여러 명령의 차이를 합쳐 되돌리기 한 단계에 남긴다',()=>{
  const e=new DrawingEngine();
  run(e,{type:'add',entity:line('a',0)});run(e,{type:'add',entity:line('b',100)});
  const base=e.doc,a0=base.entities[0];
  e.beginTransaction();
  run(e,{type:'move',ids:['a'],dx:1,dy:0});
  run(e,{type:'move',ids:['a'],dx:1,dy:0});
  run(e,{type:'add',entity:line('c',200)});
  e.endTransaction();
  const final=e.doc,a2=final.entities.find(x=>x.id==='a'),c=final.entities.find(x=>x.id==='c');
  e.execute({type:'undo'});
  assert.equal(e.doc,base);
  assert.deepEqual(e.lastExecution.delta,{removed:[a2,c],added:[a0]},'중간의 a 는 차이에 없다');
});

test('213 · 묶음 안에 전체 동기화 명령이 끼면 차이를 모름으로 두어 예전 비교로 돌아간다',()=>{
  const e=new DrawingEngine();
  run(e,{type:'add',entity:line('a',0)});
  e.beginTransaction();
  run(e,{type:'move',ids:['a'],dx:1,dy:0});
  run(e,{type:'add',entity:{id:'w',type:'wall',layer:'default',points:[{x:0,y:500},{x:900,y:500}],thickness:100}});
  e.endTransaction();
  e.execute({type:'undo'});
  assert.equal(e.lastExecution.delta,null);
});

test('213·214 · 묶음 알림은 바깥 끝에서 한 번, 억제 중 알림은 풀 때 한 번',()=>{
  const e=new DrawingEngine(),plain=[],batched=[];
  e.onChange((doc,notice)=>plain.push(notice.kind));
  e.onChange((doc,notice)=>batched.push(notice.kind),{batched:true});
  e.beginTransaction();e.beginTransaction();
  e.execute({type:'add',entity:line('a',0)});e.execute({type:'add',entity:line('b',0)});
  e.endTransaction();assert.deepEqual(batched,[],'안쪽 끝에서는 알리지 않는다');
  e.endTransaction();
  assert.deepEqual(plain,['edit','edit']);assert.deepEqual(batched,['transaction']);
  e.suppressNotification();e.suppressNotification();
  e.execute({type:'add',entity:line('c',0)});e.execute({type:'add',entity:line('d',0)});
  assert.equal(e.resumeNotification(),false,'겹친 억제는 바깥에서 풀린다');
  assert.equal(e.resumeNotification(),true);
  assert.deepEqual(plain.slice(2),['replace']);
  assert.equal(e.resumeNotification(),false,'억제하지 않았으면 아무 일 없음');
  e.withoutNotification(()=>{});assert.equal(plain.length,3,'바뀐 것이 없으면 알리지 않는다');
  e.execute({type:'undo'});assert.equal(plain.at(-1),'history');
});

test('211 · app.js 는 남긴 차이를 쓰고, 셈이 안 맞거나 큰 스타일 편집이면 포인터 비교로 간다',()=>{
  const source=readFileSync(new URL('./app.js',import.meta.url),'utf8');
  const start=source.indexOf('const HISTORY_DELTA_LIMIT='),end=source.indexOf('\nfunction withLayerDelta(',start);
  const context={pointerDelta};vm.runInNewContext(source.slice(start,end)+'\nthis.recordedHistoryDelta=recordedHistoryDelta;',context);
  const a={},b={},c={},recorded={removed:[b],added:[c]};
  assert.equal(context.recordedHistoryDelta({delta:recorded},[a,b],[a,c]),recorded,'기록을 그대로');
  // 큰 스타일 편집 되돌리기도 바뀐 것만 고친다(전체 다시 그리기는 되돌리기 멈춤 0.05→1.2초, 2026-10-16 A/B).
  assert.deepEqual(context.recordedHistoryDelta({rebuild:true,delta:null},[a,b],[a,c]),{removed:[b],added:[c]},'큰 스타일 편집은 포인터 비교');
  const fallback=context.recordedHistoryDelta({delta:{removed:[],added:[c]}},[a,b],[a,c]);
  assert.deepEqual(fallback,{removed:[b],added:[c]},'셈이 틀린 기록은 버리고 비교');
  assert.match(source,/engine\.noteStepDelta\(previousDoc,engine\.doc,delta\)/);
});
