import test from 'node:test';
import assert from 'node:assert/strict';
import * as Bridge from './bridge-client.js';
import {DrawingEngine} from './engine.js';
import {connectBridge,createBridgeBinding,createBoundRequestHandler} from './bridge-client.js';
const backend=crypto.randomUUID(),snapshot=crypto.randomUUID();
const targetFor=p=>({protocol_version:1,backend_generation:backend,editor_session:p.client,document_generation:p.document_generation,snapshot_id:snapshot,revision:p.revision});
const tick=()=>new Promise(r=>originalTimer(r,0));
const originalTimer=globalThis.setTimeout;

test('block-frame generation survives intervening pulses and completes a real Python MCP job',{timeout:15000},async()=>{
 const {generateTracked}=await import('./drawing-generator.js');
 await import('./test-fixtures/compute-fake-server.js');
 const {readFileSync}=await import('node:fs'),{spawnSync}=await import('node:child_process');
 const standard=JSON.parse(readFileSync('rules/knowledge/drawing-standard.json','utf8'));
 standard.sheetTemplates = JSON.parse(readFileSync('rules/knowledge/sheet-templates.json','utf8'));   // 한 벌 템플릿은 도면 기준에 붙어 온다(vault_gate, 2026-10-25)
 const model=JSON.parse(readFileSync('test-fixtures/drawing/daeyeon-2an.json','utf8'));
 const original={window:globalThis.window,document:globalThis.document,setTimeout:globalThis.setTimeout,Worker:globalThis.Worker};
 const timers=[],pulses=[],engine=new DrawingEngine();let request,workerMessage,calls=0,applies=0;
 let finishWorker,failWorker;const workerReady=new Promise((resolve,reject)=>{finishWorker=resolve;failWorker=reject;});
 class GenerationWorker{
  postMessage(message){
   calls++;workerMessage=message;
   generateTracked(message.document,message.inputs).then(result=>finishWorker(()=>this.onmessage({data:{id:message.id,result}})),failWorker);
  }
  terminate(){}
 }
 globalThis.window={addEventListener(){}};globalThis.document={hasFocus:()=>true};globalThis.Worker=GenerationWorker;
 globalThis.setTimeout=(fn,ms,...args)=>ms===300?(timers.push(fn),undefined):originalTimer(fn,ms,...args);
 try{
  connectBridge({context:{engine,getDrawingId:()=> 'generated',startedFresh:()=>true,selected:()=>new Set(),getCommandSettings:()=>({}),execute:c=>{applies++;return engine.execute(c);},refresh(){}},getFolder:()=>'',api:async(name,p)=>{
   if(name==='chat')return {authorized:true};
   pulses.push(JSON.parse(JSON.stringify(p)));const target=targetFor(p);
   request??={id:crypto.randomUUID(),action:'cad_generate_drawing',expires_at:Date.now()+60000,args:{target,request:{kind:'plan',story:model.stories[0].id,model,standard,origin:{x:0,y:-80000},title:'Plan'}}};
   return {protocol_version:1,backend_generation:backend,target,requests:p.results.length?[]:[request]};
  }});
  const finish=await workerReady;
  assert.equal(workerMessage.op,'generate');
  for(let i=0;i<3;i++){assert.equal(timers.length,1);await timers.shift()();await tick();}
  assert.equal(applies,0);assert.equal(calls,1);
  finish();await tick();await timers.shift()();await tick();
  assert.equal(applies,1);assert.equal(calls,1);assert.ok(engine.doc.blocks.length);
  const delivered=pulses.filter(p=>p.results.some(r=>r.id===request.id));
  assert.equal(delivered.length,1,'completion must enter the current outbound queue');
  assert.equal(delivered[0].results[0].error,undefined);
  assert.equal(delivered[0].results[0].result.applied,true);
  assert.equal(delivered[0].document_revision,delivered[0].results[0].result.after_revision);
  assert.ok(delivered[0].document.entities.some(e=>e.sheetFrame&&e.sharedBlock));
  const replay=spawnSync('python',['test-fixtures/bridge-generation-backend.py'],{input:JSON.stringify({pulses,request}),encoding:'utf8',env:{...process.env,PYTHONPATH:process.cwd(),PYTHONUTF8:'1'},timeout:15000,maxBuffer:1024*1024});
  assert.equal(replay.status,0,replay.stderr||replay.stdout);
  const completed=JSON.parse(replay.stdout);assert.equal(completed.status,'completed');assert.deepEqual(completed.rejected_results,[]);
  assert.equal(completed.added,engine.doc.entities.length);
 }finally{Object.assign(globalThis,original);}
});

test('app AI completion enters the current queue after intervening pulses',async()=>{
 const original={window:globalThis.window,document:globalThis.document,setTimeout:globalThis.setTimeout},timers=[],pulses=[];
 const engine=new DrawingEngine();let release,calls=0,request;
 const pending=new Promise(resolve=>release=resolve);
 globalThis.window={addEventListener(){}};globalThis.document={hasFocus:()=>true};globalThis.setTimeout=fn=>timers.push(fn);
 try{
  connectBridge({context:{engine,startedFresh:()=>true,getDrawingId:()=> 'app',selected:()=>new Set(),getCommandSettings:()=>({}),runAICommand:()=>{calls++;return pending;}},getFolder:()=>'',api:async(name,p)=>{
   if(name==='chat')return {authorized:true};
   pulses.push(JSON.parse(JSON.stringify(p)));
   request??={id:crypto.randomUUID(),action:'cad_ui_command',expires_at:Date.now()+60000,args:{target:null,command:'ZOOM'}};
   return {protocol_version:1,backend_generation:backend,target:targetFor(p),requests:p.results.length?[]:[request]};
  }});
  await tick();assert.equal(calls,1);
  for(let i=0;i<2;i++){await timers.shift()();await tick();}
  release({done:true});await tick();await timers.shift()();await tick();
  assert.equal(calls,1);
  const delivered=pulses.flatMap(p=>p.results);assert.equal(delivered.length,1);
  assert.equal(delivered[0].id,request.id);assert.deepEqual(delivered[0].result,{done:true});
 }finally{release({done:true});Object.assign(globalThis,original);}
});

test('pulse keeps running while a command waits and repeated delivery executes it once',async()=>{
 const original={window:globalThis.window,document:globalThis.document,setTimeout:globalThis.setTimeout},timers=[],payloads=[];
 const engine=new DrawingEngine();engine.execute({type:'add',entity:{type:'line',layer:engine.doc.layers[0].id,points:[{x:0,y:0},{x:10,y:0}]}});
 let release,calls=0,request;const pending=new Promise(r=>release=r);
 globalThis.window={addEventListener(){}};globalThis.document={hasFocus:()=>true};globalThis.setTimeout=fn=>timers.push(fn);
 try{
  connectBridge({context:{engine,getDrawingId:()=> 'drawing-one',selected:()=>new Set(),getCommandSettings:()=>({}),suggestDetails:()=>{calls++;return pending;}},getFolder:()=>'',api:async(name,p)=>{
   if(name==='chat')return {authorized:true};
   // Capture wire bytes: retaining p hides pushes into an already-sent array.
   payloads.push(JSON.parse(JSON.stringify(p)));const target=targetFor(p);request??={id:crypto.randomUUID(),action:'cad_suggest_details',expires_at:Date.now()+600_000,args:{target}};
   return {protocol_version:1,backend_generation:backend,target,requests:p.results.length?[]:[request]};
  }});
  await tick();assert.equal(calls,1);assert.equal(timers.length,1);
  await timers.shift()();await tick();assert.equal(payloads.length,2);assert.equal(calls,1);assert.equal(payloads[1].results.length,0);
  release([]);await tick();await timers.shift()();await tick();
  assert.ok(payloads.some(p=>p.results.some(r=>r.id===request.id)),JSON.stringify(payloads.map(p=>({results:p.results,revision:p.revision}))));assert.equal(calls,1);
 }finally{release?.([]);Object.assign(globalThis,original);}
});

// 실제 전송은 보낼 때 JSON 으로 굳는다. 느린 명령(도면 세트: 상세 자료 수백 개를 받는 동안 펄스가 여러 번 지나감)의
// 결과를 이미 보낸 배열에 넣으면 영영 안 가서 다리가 10분 뒤 '응답 시간 초과'를 냈다(10-23 맥 개발판).
test('slow command result is delivered on a later pulse when payloads are serialized like HTTP',async()=>{
 const original={window:globalThis.window,document:globalThis.document,setTimeout:globalThis.setTimeout},timers=[],payloads=[];
 const engine=new DrawingEngine();engine.execute({type:'add',entity:{type:'line',layer:engine.doc.layers[0].id,points:[{x:0,y:0},{x:10,y:0}]}});
 let release,request;const pending=new Promise(r=>release=r);
 globalThis.window={addEventListener(){}};globalThis.document={hasFocus:()=>true};globalThis.setTimeout=fn=>timers.push(fn);
 try{
  connectBridge({context:{engine,getDrawingId:()=> 'drawing-one',selected:()=>new Set(),getCommandSettings:()=>({}),suggestDetails:()=>pending},getFolder:()=>'',api:async(name,p)=>{
   if(name==='chat')return {authorized:true};
   payloads.push(JSON.parse(JSON.stringify(p)));const target=targetFor(p);request??={id:crypto.randomUUID(),action:'cad_suggest_details',expires_at:Date.now()+600_000,args:{target}};
   return {protocol_version:1,backend_generation:backend,target,requests:[request]};
  }});
  await tick();
  for(let i=0;i<3;i++){await timers.shift()();await tick();}   // 명령이 끝나기 전에 펄스가 여러 번 지나간다
  release([]);await tick();
  for(let i=0;i<2;i++){await timers.shift()();await tick();}
  assert.ok(payloads.some(p=>p.results.some(r=>r.id===request.id)),'느린 결과가 다음 펄스에 실려야 한다');
 }finally{release?.([]);Object.assign(globalThis,original);}
});

test('saved folder and clean status are reported on the next pulse',async()=>{
 const original={window:globalThis.window,document:globalThis.document,setTimeout:globalThis.setTimeout},sent=[];
 const engine=new DrawingEngine();globalThis.window={addEventListener(){}};globalThis.document={hasFocus:()=>true};globalThis.setTimeout=()=>{};
 try{
  connectBridge({context:{engine,getDrawingId:()=> 'saved',selected:()=>new Set(),getCommandSettings:()=>({}),getDrawingFolder:()=> 'C:/saved',isDrawingDirty:()=>false,hasDrawingWorkspace:()=>true},getFolder:()=>'',api:async(name,p)=>{sent.push(p);return {protocol_version:1,backend_generation:backend,target:targetFor(p),requests:[]};}});
  await tick();const pulse=sent.find(p=>p.client);assert.equal(pulse.folder,'C:/saved');assert.equal(pulse.dirty,false);
 }finally{Object.assign(globalThis,original);}
});

test('engine loss forces a fresh document pulse and reports reconnecting once',async()=>{
 const original={window:globalThis.window,document:globalThis.document,setTimeout:globalThis.setTimeout},timers=[],sent=[],messages=[];let fail=2;
 const engine=new DrawingEngine();engine.execute({type:'add',entity:{type:'line',layer:engine.doc.layers[0].id,points:[{x:0,y:0},{x:10,y:0}]}});
 globalThis.window={addEventListener(){}};globalThis.document={hasFocus:()=>true};globalThis.setTimeout=fn=>timers.push(fn);
 try{
  connectBridge({context:{engine,getDrawingId:()=> 'same-drawing',selected:()=>new Set(),getCommandSettings:()=>({}),toast:m=>messages.push(m)},getFolder:()=>'',api:async(name,p)=>{
   sent.push(p);if(fail-->0)throw new TypeError('Failed to fetch');return {protocol_version:1,backend_generation:backend,target:targetFor(p),requests:[]};
  }});
  await tick();await timers.shift()();await tick();await timers.shift()();await tick();
  assert.equal(messages.filter(x=>x.includes('다시 연결 중')).length,1);assert.ok(messages.some(x=>x.includes('복구')));
  assert.ok(sent[2].document);assert.equal(sent[0].client,sent[2].client);
 }finally{Object.assign(globalThis,original);}
});

test('redo and save completion use the bound renderer and preserve changed documents',()=>{
 const engine=new DrawingEngine();let path='';const context={engine,getDrawingId:()=> 'one',execute:c=>engine.execute(c),selected:()=>new Set(),completeBridgeSave:p=>{path=p;return {saved:true,folder:'C:/saved',dirty:false};}};
 const binding=createBridgeBinding(context),handle=createBoundRequestHandler(context,binding);
 const bind=()=>{const target={...binding.current(),backend_generation:backend,snapshot_id:crypto.randomUUID()};binding.receive({protocol_version:1,backend_generation:backend,target});return target;};
 const invoke=(action,args={})=>handle({id:crypto.randomUUID(),expires_at:Date.now()+600_000,action,args:{target:bind(),...args}});
 engine.execute({type:'add',entity:{type:'line',layer:engine.doc.layers[0].id,points:[{x:0,y:0},{x:10,y:0}]}});
 assert.equal(invoke('cad_undo').result.count,0);assert.equal(invoke('cad_redo').result.count,1);
 assert.equal(invoke('cad_save_complete',{path:'C:/saved/a.dxf'}).result.dirty,false);assert.equal(path,'C:/saved/a.dxf');
 const stale=bind();engine.execute({type:'undo'});const rejected=handle({id:crypto.randomUUID(),action:'cad_save_complete',expires_at:Date.now()+600_000,args:{target:stale,path:'wrong'}});
 assert.ok(rejected.error);assert.equal(path,'C:/saved/a.dxf');
});

// 대형 도면 조회는 전체 복사·블록 펼침 없이 화면 원본에서 계산한다.
const largeDrawing=()=>{
 const engine=new DrawingEngine(),layer=engine.doc.layers[0].id;
 const line=(id,x,y=0)=>({id,type:'line',layer,points:[{x,y},{x:x+2,y:y+2}]});
 engine.doc.entities=[line('one',0),line('two',10),line('outside',30)];
 engine.doc.blocks=[{name:'heavy',entities:Array.from({length:50001},(_,i)=>line('definition-'+i,1000))}];
 return {engine,layer,line};
};
const queryHarness=engine=>{
 const context={engine,getDrawingId:()=> 'large',selected:()=>new Set(['two'])},binding=createBridgeBinding(context);
 const target={...binding.current(),backend_generation:backend,snapshot_id:crypto.randomUUID()};binding.receive({protocol_version:1,backend_generation:backend,target});
 return {context,binding,target,query:(args={})=>Bridge.createDocumentRequestHandler(context,binding)({id:crypto.randomUUID(),action:'cad_get_document',expires_at:Date.now()+60000,args:{target,...args}})};
};
test('large document summary counts layers types extents definitions and selection without cloning',()=>{
 const {engine,layer}=largeDrawing(),{query}=queryHarness(engine),original=globalThis.structuredClone;
 globalThis.structuredClone=()=>{throw Error('query must not clone');};
 try{
  const out=query().result;assert.equal(out.mode,'summary');assert.equal(out.summary.entityCount,3);assert.equal(out.summary.blockDefinitionCount,1);assert.equal(out.summary.selectedCount,1);
  assert.deepEqual(out.summary.types,{line:3});assert.deepEqual(out.summary.extents,{minX:0,minY:0,maxX:32,maxY:2});assert.equal(out.summary.layers.find(l=>l.id===layer).count,3);
  assert.match(out.message,/mode=window/);assert.ok(JSON.stringify(out).length<2000);
 }finally{globalThis.structuredClone=original;}
});
test('large document window returns only contained objects with a hard limit and truncation',()=>{
 const {engine}=largeDrawing(),{query}=queryHarness(engine);
 const out=query({mode:'window',window:{x0:0,y0:0,x1:20,y1:20},limit:1}).result;
 assert.deepEqual(out.document.entities.map(e=>e.id),['one']);assert.equal(out.matched_count,2);assert.equal(out.truncated,true);assert.equal(out.limit,1);
 assert.deepEqual(query({mode:'window',window:{x0:1,y0:0,x1:20,y1:20}}).result.document.entities.map(e=>e.id),['two']);
});
test('large document selection reads current selection or exact ids and reports missing ids',()=>{
 const {engine}=largeDrawing(),{query}=queryHarness(engine);
 assert.deepEqual(query({mode:'selection'}).result.document.entities.map(e=>e.id),['two']);
 const explicit=query({mode:'selection',ids:['one','outside','missing'],limit:1}).result;
 assert.deepEqual(explicit.document.entities.map(e=>e.id),['one']);assert.deepEqual(explicit.missing_ids,['missing']);assert.equal(explicit.truncated,true);
 assert.deepEqual(query({mode:'selection',ids:[]}).result.document.entities,[]);
});
test('partial queries bound nested blocks and oversized entity data without expanding or cloning',()=>{
 const {engine,layer,line}=largeDrawing();engine.doc.entities.push({id:'block',type:'block',name:'heavy',layer,entities:engine.doc.blocks[0].entities});
 engine.doc.sharedBlocks={shared:{name:'shared',origin:{x:0,y:0},entities:[line('child',0)]}};
 engine.doc.entities.push({id:'shared',type:'block',name:'shared',sharedBlock:'shared',layer,position:{x:100,y:50},entities:[]});
 engine.doc.entities.push({...line('giant',0),payload:'x'.repeat(300000)});
 const {query}=queryHarness(engine),original=globalThis.structuredClone;globalThis.structuredClone=()=>{throw Error('query must not clone');};
 try{
  const out=query({mode:'selection',ids:['block','shared','giant']}).result;
  assert.equal(out.document.entities.length,3);assert.ok(out.document.entities.every(e=>!e.entities));assert.equal(out.document.entities[0].detailsOmitted,true);
  assert.equal(out.document.entities[2].detailsOmitted,true);assert.ok(JSON.stringify(out).length<5000);assert.equal(out.truncated,true);
  assert.deepEqual(query({mode:'window',window:{x0:99,y0:49,x1:103,y1:53}}).result.document.entities.map(e=>e.id),['shared']);
  assert.deepEqual(query().result.summary.extents,{minX:0,minY:0,maxX:1002,maxY:52});
 }finally{globalThis.structuredClone=original;}
});
test('document queries reject stale targets and malformed or unbounded arguments',()=>{
 const {engine}=largeDrawing(),{query}=queryHarness(engine);
 for(const args of [{mode:'bad'},{mode:'window'},{mode:'selection',ids:'one'},{mode:'selection',ids:Array(1001).fill('one')},{mode:'summary',limit:1001},{mode:'window',window:{x0:0,y0:0,x1:NaN,y1:2}}])assert.ok(query(args).error,JSON.stringify(args));
 engine.execute({type:'add',entity:{type:'point',position:{x:0,y:0},layer:engine.doc.layers[0].id}});const stale=query();assert.ok(stale.error);assert.equal(stale.result,undefined);
});
test('large query is delivered through pulses with no full document serialization',async()=>{
 const original={window:globalThis.window,document:globalThis.document,setTimeout:globalThis.setTimeout,structuredClone:globalThis.structuredClone},timers=[],sent=[];
 const {engine}=largeDrawing();let request;
 globalThis.window={addEventListener(){}};globalThis.document={hasFocus:()=>true};globalThis.setTimeout=fn=>timers.push(fn);
 globalThis.structuredClone=value=>{assert.notEqual(value,engine.doc);assert.notEqual(value,engine.doc.blocks);return original.structuredClone(value);};
 try{
  connectBridge({context:{engine,getDrawingId:()=> 'large',selected:()=>new Set(['one']),getCommandSettings:()=>({}),isDrawingDirty:()=>false,hasDrawingWorkspace:()=>true},getFolder:()=>'',api:async(name,p)=>{
   if(name==='chat')return {authorized:true};sent.push(p);assert.equal(p.document,undefined);assert.ok(JSON.stringify(p).length<6000);
   request??={id:crypto.randomUUID(),action:'cad_get_document',expires_at:Date.now()+60000,args:{target:targetFor(p),mode:'summary'}};
   return {protocol_version:1,backend_generation:backend,target:targetFor(p),requests:p.results.length?[]:[request]};
  }});
  await tick();assert.equal(sent[0].documentOmitted,true);assert.equal(sent[0].document_revision,sent[0].revision);
  await timers.shift()();await tick();const response=sent.flatMap(p=>p.results).find(r=>r.id===request.id);assert.equal(response?.error,undefined);assert.equal(response?.result?.summary?.entityCount,3);
 }finally{Object.assign(globalThis,original);}
});

test('46525 top-level objects plus definitions stay readable without document JSON or clone',()=>{
 const {engine,line}=largeDrawing();engine.doc.entities=Array.from({length:46525},(_,i)=>line('top-'+i,i));
 const {query}=queryHarness(engine),original=globalThis.structuredClone;
 engine.doc.toJSON=()=>{throw Error('full document JSON');};globalThis.structuredClone=()=>{throw Error('full clone');};
 try{
  const summary=query().result;assert.equal(summary.summary.entityCount,46525);assert.equal(summary.summary.types.line,46525);assert.ok(JSON.stringify(summary).length<2000);
  const window=query({mode:'window',window:{x0:100,y0:0,x1:110,y1:2},limit:3}).result;assert.equal(window.matched_count,9);assert.equal(window.count,3);assert.equal(window.truncated,true);
  assert.deepEqual(query({mode:'selection',ids:['top-46524']}).result.document.entities.map(e=>e.id),['top-46524']);
 }finally{globalThis.structuredClone=original;}
});

test('document query modes include command settings only on explicit request',()=>{
 for(const large of [false,true]){
  const engine=large?largeDrawing().engine:new DrawingEngine(),{query,context}=queryHarness(engine),settings={aliases:{C:'CIRCLE'}};let reads=0;
  context.getCommandSettings=()=>{reads++;return settings;};
  for(const args of [{mode:'summary'},{mode:'selection',ids:[]},{mode:'window',window:{x0:0,y0:0,x1:20,y1:20}}]){
   assert.equal(query(args).result.commandSettings,undefined);assert.equal(reads,0);
   assert.deepEqual(query({...args,include_command_settings:true}).result.commandSettings,settings);reads=0;
  }
 }
});
test('one selected block omits children without truncating matched objects',()=>{
 const {engine,layer,line}=largeDrawing();engine.doc.entities=[{id:'block',type:'block',layer,entities:[line('child',0)]}];
 const {query}=queryHarness(engine),out=query({mode:'selection',ids:['block']}).result;
 assert.equal(out.matched_count,1);assert.equal(out.count,1);assert.equal(out.truncated,false);
 assert.equal(out.document.entities[0].detailsOmitted,true);assert.equal(out.document.entities[0].childCount,1);
 assert.equal(out.document.entities[0].entities,undefined);
});
