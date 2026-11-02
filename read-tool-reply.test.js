import test from 'node:test';
import assert from 'node:assert/strict';
import {DrawingEngine} from './engine.js';
import {setComputeTransport} from './compute-client.js';

// 다리(bridge.pulse)는 실패가 아닌 답에 target·판 번호·applied 영수증이 없으면 말없이 버린다.
// 평면 읽기 성공 답에 영수증이 빠져 미리가 10분을 기다렸다(2026-10-30 괴정 시험) — 다리가 보는 칸을 그대로 확인한다.
const accepted=(target,value)=>value&&value.target&&value.target.revision===target.revision&&value.before_revision===target.revision&&
 value.after_revision===target.revision&&value.revision===value.after_revision&&value.applied===false;

test('평면 읽기 성공 답에 읽기 영수증이 있어 다리가 받는다',async()=>{
 const {createCommandRequestHandler}=await import('./bridge-client.js');
 const engine=new DrawingEngine(),target={revision:0};
 const previousFetch=globalThis.fetch;globalThis.fetch=async()=>({ok:true,json:async()=>({standard:{planReading:{}}})});
 const previous=setComputeTransport(async action=>{assert.equal(action,'plan.foreignRead');return {data:{floors:[{label:'1F',walls:[],outline:null,rooms:[]}]},floors:[{label:'1F',wallLayer:'A-WALL',layerScores:[]}]};});
 try{
  const handler=createCommandRequestHandler({authorizeAIRequest:async()=>{},engine,execute:()=>assert.fail('읽기만')},{assert:()=>{},current:()=>({revision:0})});
  const reply=await handler({id:'33333333-3333-4333-8333-333333333333',expires_at:Date.now()+30000,action:'cad_read_foreign_plan',args:{target}});
  assert.equal(reply.error,undefined);assert.ok(accepted(target,reply.result),JSON.stringify(reply.result));assert.equal(reply.result.floors.length,1);
 }finally{setComputeTransport(previous);globalThis.fetch=previousFetch;}
});
