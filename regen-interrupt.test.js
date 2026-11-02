// ACAD200 117: 무거운 반복은 64번마다, 그리고 100ms 에 한 번만 새 입력을 확인한다.
import test from 'node:test';
import assert from 'node:assert/strict';
import {RegenInterrupt,regenInterrupt} from './regen-interrupt.js';
import {CadGpuRenderer} from './gpu-renderer.js';
import {THREE} from './vendor/mlightcad.js';

test('checks every 64th call and at most once per 100 ms',()=>{
  let now=0;const r=new RegenInterrupt({now:()=>now});
  r.noteInput();
  for(let i=1;i<64;i++)assert.equal(r.shouldYield(),false,'not on call '+i);
  assert.equal(r.shouldYield(),true,'64th call sees the input');
  r.noteInput();for(let i=0;i<64;i++)r.shouldYield();assert.equal(r.yields,1,'within 100 ms the flag is not read again');
  now=150;for(let i=0;i<63;i++)assert.equal(r.shouldYield(),false);assert.equal(r.shouldYield(),true);
  now=400;assert.equal(r.inputPending(),false,'no new input');r.noteInput();now=600;assert.equal(r.inputPending(),true);
});

test('attach counts canvas input events with passive capture listeners',()=>{
  const added=[],target={addEventListener(type,fn,options){added.push([type,options]);this.fn=fn;},removeEventListener(type){added.splice(added.findIndex(a=>a[0]===type),1);}};
  const r=new RegenInterrupt(),detach=r.attach(target);
  assert.deepEqual(added.map(a=>a[0]),['pointerdown','pointermove','wheel','keydown']);assert.ok(added.every(a=>a[1].passive&&a[1].capture));
  target.fn();assert.equal(r.inputSeq,1);detach();assert.equal(added.length,0);
});

test('a sliced scene build ends its slice early when input arrives',()=>{
  const r=Object.create(CadGpuRenderer.prototype);r.stats={};r.onChange=()=>{};
  let steps=0;r.buildTask={doc:{},revision:1,progress:{},gen:(function*(){for(;;){steps++;yield;}})()};
  regenInterrupt.lastCheck=-Infinity;regenInterrupt.noteInput();
  const timers=[];const original=globalThis.setTimeout;globalThis.setTimeout=fn=>{timers.push(fn);return 0;};
  try{assert.equal(r.stepBuildTask(10000),false);}finally{globalThis.setTimeout=original;}
  assert.equal(steps,1,'one step, then the pending input ends the slice');assert.equal(timers.length,1,'the build continues next frame');
  void THREE;
});

test('117: 스크립트가 보낸 이벤트(isTrusted:false)는 입력으로 세지 않는다',()=>{
 const listeners={};const target={addEventListener:(type,fn)=>{listeners[type]=fn;},removeEventListener(){}};
 const r=new RegenInterrupt({now:()=>1000,every:1,intervalMs:0});r.attach(target);
 listeners.pointermove({isTrusted:false});assert.equal(r.inputPending(),false);
 listeners.pointermove({isTrusted:true});assert.equal(r.inputPending(),true);
});
