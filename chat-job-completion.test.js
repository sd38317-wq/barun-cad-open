import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {parseActions} from './ai-actions.js';
import {cadToolApplied,normalizeCADToolResult,completedCADPlan,aiBusy,AI_BUSY_TEXT} from './chat.js';
import {describeToolEvent} from './ai-work-band.js';

// Execute the real poll body with API/UI boundaries stubbed: no Electron or running app.
async function pollOnce(result,text='작도했습니다.',source=null,toolParams={},studioContext={}){
 const chat=source??await fs.readFile(new URL('./chat.js',import.meta.url),'utf8');
 const start=chat.indexOf(' async function poll(){'),end=chat.indexOf(' async function refreshStatus()',start);
 const calls=[],applied=[],records=[],progress=[],nodes=new Map();
 const context={cadToolApplied,normalizeCADToolResult,completedCADPlan,parseActions,aiBusy,AI_BUSY_TEXT,busyRetried:false,
  studio:{api:async(name,payload)=>{calls.push(payload);return {cursor:1,requestAuthorization:{requestId:'auth-request',recipient:'editor'},events:[{method:'cad/tool',params:{tool:'cad_get_job',result,...toolParams}},{method:'item/completed',params:{item:{type:'agentMessage',text}}},{method:'turn/completed',params:{turn:{status:'completed'}}}]};},context:{aiWorkBand:{consume:events=>progress.push(...events)},applyActions:async(...args)=>{applied.push(args);return 'applied';},...studioContext}},
  cursor:0,threadId:'thread',requestStartedAt:0,executionMode:true,toolApplied:false,toolRan:false,actionText:'',stopRequested:false,
  requestEpoch:1,requestController:new AbortController(),AbortController,requestAuthorization:null,voiceReply:'',running:true,
  actionSnapshot:'before',repairRequest:false,parcelContinued:false,completionLabel:'',conversationThreads:{},lastRequest:{message:'문 그려줘'},retry:0,
  callModel:async payload=>{calls.push({action:'send',...payload});return {threadId:'again',cursor:0};},waitForMiri:async p=>p,
  record:(...args)=>records.push(args),finishReview(){},syncRun(){},turnImages:[],attachTurnImages(){},userErrorMessage:e=>e.message,
  $:()=>({textContent:''}),dialog:{dispatchEvent(){}},CustomEvent:class{},Event:class{},nodes,
  window:{},Date,setTimeout:()=>1,clearTimeout(){},interrupt:async()=>{},
 };
 await vm.runInNewContext(chat.slice(start,end)+';poll()',context);
 return {calls,applied,records,progress,context};
}

test('completed job unwraps actual applied result and does not resend original request',async()=>{
 const result={job_id:'generation:job',status:'completed',result:{applied:true,added:1}};
 assert.equal(normalizeCADToolResult(result).applied,true);assert.equal(cadToolApplied(result),true);
 const run=await pollOnce(result);
 assert.equal(run.context.toolApplied,true);assert.equal(run.calls.filter(p=>p.action==='send').length,0);
 assert.equal(run.applied.length,0,'tool execution must not be repeated through legacy JSON');
 assert.equal(run.context.completionLabel,'CAD 도구 작업 완료');
});

test('a completed job reported as JSON text also counts as applied (long drawing-set / structure jobs)',async()=>{
 const text=JSON.stringify({job_id:'generation:job',status:'completed',result:{applied:true,added:7367}});
 assert.equal(cadToolApplied(text),true);assert.equal(cadToolApplied('not json'),false);assert.equal(cadToolApplied(JSON.stringify({status:'running'})),false);
 const run=await pollOnce(text,'실시도면 한 벌을 만들었습니다.');
 assert.equal(run.context.toolApplied,true);assert.equal(run.applied.length,0,'stale snapshot must not turn a finished tool job into a failure');
 assert.equal(run.context.completionLabel,'CAD 도구 작업 완료');
});

test('a tool without an applied flag that changed the drawing counts as applied (structure drawings)',async()=>{
 const changed=await pollOnce({status:'completed',result:{added:278}},'구조 도면을 그렸습니다.',null,{tool:'cad_structure'},{actionSnapshot:()=>'after'});
 assert.equal(changed.context.toolApplied,true);assert.equal(changed.applied.length,0,'no replay of an empty plan against the old snapshot');
 assert.equal(changed.context.completionLabel,'CAD 도구 작업 완료');
 const readOnly=await pollOnce({entities:39},JSON.stringify({actions:[],ask:null,note:'봤습니다'}),null,{tool:'cad_get_document'},{actionSnapshot:()=>'before'});
 assert.equal(readOnly.context.toolApplied,false,'same drawing: a read-only tool is not an application');
});

test('malformed final answer without observed application also never resends a mutation',async()=>{
 const run=await pollOnce({status:'running',job_id:'generation:job'});
 assert.equal(run.calls.filter(p=>p.action==='send').length,0);assert.equal(run.applied.length,0);
 assert.ok(run.records.some(([,text])=>text.includes('자동 재실행하지 않았습니다')));
});

test('completed job cannot also apply a legacy JSON action',async()=>{
 const run=await pollOnce({status:'completed',result:{applied:true}},JSON.stringify({actions:[{cmd:'line',args:{points:[[0,0],[1,1]]}}],ask:null,note:'done'}));
 assert.equal(run.calls.filter(p=>p.action==='send').length,0);assert.equal(run.applied.length,0);
 assert.ok(run.records.some(([,text])=>text.includes('추가 JSON 명령')));
});

test('running, preview and failed jobs are never reported as applied',()=>{
 for(const result of [{status:'running',applied:true},{status:'completed',error:'failed',result:{applied:true}},{status:'running',result:{applied:true}},{status:'completed',result:{applied:false}},{status:'completed',result:{error:'failed',applied:true}}])assert.equal(cadToolApplied(result),false);
 for(const key of ['saved','opened','closed','started'])assert.equal(cadToolApplied({status:'completed',result:{[key]:true}}),true);
});

test('legacy actions receive authorization returned by poll',async()=>{
 const source=await fs.readFile(new URL('./chat.js',import.meta.url),'utf8');
 const result=await pollOnce({applied:false},JSON.stringify({actions:[],ask:null,note:'done'}),source);
 assert.equal(result.applied.length,1);assert.equal(result.applied[0][2].authorization.requestId,'auth-request');assert.equal(result.applied[0][2].authorization.recipient,'editor');
});

test('stop interrupts initial managed send before a thread id exists and keeps its original epoch',async()=>{
 const source=await fs.readFile(new URL('./chat.js',import.meta.url),'utf8');
 const declaration=source.split('\n').find(line=>line.trim().startsWith('const interrupt='));
 const stop=source.split('\n').find(line=>line.trim().startsWith("$('ai-stop').onclick="));
 const calls=[],elements=new Map(),controller=new AbortController();
 const context={studio:{api:async(name,payload)=>calls.push(payload),context:{getBridgeSession:()=> 'editor'}},lastRequest:{aiRequestEpoch:7,editorSession:'editor'},threadId:null,
  requestEpoch:7,requestController:controller,AbortController,running:true,stopRequested:false,window:{},syncRun(){},
  $:id=>{if(!elements.has(id))elements.set(id,{});return elements.get(id);}};
 await vm.runInNewContext(declaration+'\n'+stop+"\n$('ai-stop').onclick()",context);
 assert.equal(controller.signal.aborted,true);assert.equal(context.requestEpoch,8);assert.equal(calls.length,1);
 assert.equal(calls[0].action,'interrupt');assert.equal(calls[0].threadId,null);assert.equal(calls[0].editorSession,'editor');assert.equal(calls[0].aiRequestEpoch,7);
});

test('renderer signal belongs only to its original request generation',async()=>{
 const source=await fs.readFile(new URL('./chat.js',import.meta.url),'utf8');
 const statement=source.split('\n').find(line=>line.trim().startsWith('studio.context.getAIRequestSignal='));
 const controller=new AbortController(),context={studio:{context:{getBridgeSession:()=> 'editor'}},requestEpoch:7,requestController:controller,stopRequested:false,AbortSignal};
 vm.runInNewContext(statement,context);const signal=context.studio.context.getAIRequestSignal;
 assert.equal(signal({args:{_app_epoch:7,_app_origin:'editor'}}),controller.signal);
 assert.equal(signal({args:{_app_epoch:6,_app_origin:'editor'}}).aborted,true);
 assert.equal(signal({args:{_app_epoch:7,_app_origin:'other'}}),undefined);assert.equal(signal({args:{}}),undefined);
});

test('pre-dispatch errors still reach the shared band as safe failure text',async()=>{
 const result=await pollOnce({},JSON.stringify({actions:[],ask:null,note:'done'}),null,{tool:'cad_execute',error:'C:/private/token-secret',progress_via_bridge:true});
 assert.equal(result.progress.length,1);assert.equal(result.progress[0].phase,'failed');
 assert.doesNotMatch(describeToolEvent(result.progress[0]).text,/private|token-secret/);
});

// AI 서버 붐빔('at capacity')은 영어 그대로 보이지 않고, 쉬운 말과 함께 한 번 이어서 한다(2026-10-30)
test('AI 서버 붐빔은 쉬운 말로 알리고 한 번 다시 잇는다',()=>{
 assert.ok(aiBusy({message:'Selected model is at capacity. Please try a different model.'}));assert.ok(aiBusy({codexErrorInfo:'server_overloaded'}));
 assert.ok(!aiBusy({message:'도면이 바뀌었습니다'}));assert.match(AI_BUSY_TEXT,/붐빕니다/);
});
