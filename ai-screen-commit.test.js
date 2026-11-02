import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {createAppAIRequestHandler} from './app-ai-tools.js';
import {commitAIChange} from './ai-commit.js';
import {saveLargeDocument} from './studio.js';
import {createRequire} from 'node:module';
const {assertAIFileWrite}=createRequire(import.meta.url)('./desktop-files.cjs');
const appSource=await fs.readFile(new URL('./app.js',import.meta.url),'utf8');
const desktopSource=await fs.readFile(new URL('./desktop.cjs',import.meta.url),'utf8');
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};

function screenFixture({runWorker=async()=>({document:{entities:[]},added:[],removed:[]}),save}={}){
 let generation=1;const actions=[],order=[],controller=new AbortController();
 const context={getAIRequestEpoch:()=>4,getBridgeSession:()=> 'editor',getAIRequestSignal:()=>controller.signal,isAIRequestCancelled:()=>false,
  authorizeAIRequest:async()=>{order.push('authorize');if(generation!==1)throw Error('stale login epoch');}};
 const engine={doc:{entities:[],layers:[]}},studio={context,handlers:{},saveLargeDocument:save};
 const runner={run:async(...args)=>{order.push('worker');return runWorker(...args);},stop:()=>order.push('stop')};
 const globals={studio,engine,busy:false,restoringTabs:false,settings:{},resolveCommand:name=>name,run:name=>{order.push('run');actions.push(name);},commitAIChange,window:{},console,
  selected:new Set(),activeLayer:'layer',loadCommandRunner:async()=>({createCommandClient:()=>runner,scriptedCommandNames:()=>['PLANSET']}),
  execute:action=>{order.push('apply');actions.push(action);engine.doc=action.document;},setSelected(){},refresh(){},saveFormat:'dxf',fileName:'drawing',filePath:'D:/drawing.dxf',dirty:true,
  dwgVersion:'2018',dxfVersion:'2018',$:()=>({textContent:''}),documents:{checkpoint(){}},renderDrawingTabs(){},scheduleDrawingRecovery(){}};
 const start=appSource.indexOf('studio.context.runAICommand='),end=appSource.indexOf('studio.context.refreshLispLibrary=',start);
 // Only the module loading boundary is replaced. Run the actual production function body.
 vm.runInNewContext(appSource.slice(start,end).replace("await import('./command-runner.js')",'await loadCommandRunner()'),globals);
 const request={id:randomUUID(),action:'cad_ui_command',expires_at:Date.now()+30_000,args:{_app_epoch:4,_app_origin:'editor',_login_epoch:1,target:{editor_session:'editor'}}};
 return {context,studio,engine,globals,request,actions,order,expire(){generation=2;}};
}

test('actual screen UNDO rechecks original login generation after handler awaits',async()=>{
 const fixture=screenFixture(),handler=createAppAIRequestHandler(fixture.context,{assert(){}},{api:async()=>{fixture.expire();return {authorized:true};}});
 const response=await handler({...fixture.request,args:{...fixture.request.args,command:'UNDO'}});
 assert.match(response.error,/stale login epoch/);assert.deepEqual(fixture.actions,[]);
});

test('actual PLANSET Worker completion cannot commit after logout and relogin',async()=>{
 const gate=deferred(),entered=deferred(),fixture=screenFixture({runWorker:async()=>{entered.resolve();return gate.promise;}});
 const pending=fixture.context.runAICommand('PLANSET',{request:fixture.request});
 await entered.promise;fixture.expire();gate.resolve({document:{entities:[{id:'new'}]},added:['new'],removed:[]});
 await assert.rejects(pending,/stale login epoch/);assert.deepEqual(fixture.actions,[]);assert.equal(fixture.order.at(-1),'stop');
});

test('actual PLANSET applies only its completed copy through final authorization',async()=>{
 const result={document:{entities:[{id:'new'}]},added:['new'],removed:[]},fixture=screenFixture({runWorker:async()=>result});
 const response=await fixture.context.runAICommand('PLANSET',{request:fixture.request});
 assert.equal(response.applied,true);assert.equal(fixture.actions.length,1);assert.equal(fixture.actions[0].type,'lisp.apply');
 assert.deepEqual(fixture.order,['worker','authorize','apply','stop']);
});

test('screen SAVE waits for final export and preserves AI identity through studio pick and export',async()=>{
 const gate=deferred(),entered=deferred(),pick=[],exports=[];
 const saveOptions={aiRequestId:'request-id',aiRequestEpoch:4,aiRecipient:'editor',aiExpiresAt:Date.now()+30000};
 const fixture=screenFixture({save:(document,name,format,options)=>saveLargeDocument({document,name,format,...options,
  desktop:{pickSaveTarget:async payload=>{pick.push(payload);return {saveToken:'token',path:'D:/drawing.dxf'};}},
  api:async(route,payload)=>{exports.push(payload);entered.resolve();return gate.promise;}})});
 let completed=false;const pending=fixture.context.runAICommand('SAVE',{request:fixture.request,saveOptions}).then(result=>{completed=true;return result;});
 await entered.promise;assert.equal(completed,false);assert.equal(fixture.globals.dirty,true);
 for(const [key,value] of Object.entries(saveOptions)){assert.equal(pick[0][key],value);assert.equal(exports[0][key],value);}
 gate.resolve({path:'D:/drawing.dxf',warnings:[]});const result=await pending;
 assert.equal(result.saved,true);assert.equal(fixture.globals.dirty,false);assert.equal(exports.length,1);
});

function desktopFixture({kind='pick',confirm=true}={}){
 const handlers=new Map(),calls=[],writes=[],events=[],original='D:/old.dxf',target='D:/existing.dxf';
 const identity={aiRequestId:'pending-ai',aiRequestEpoch:4,aiRecipient:'editor',aiExpiresAt:Date.now()+30000};
 const identityLine=desktopSource.split('\n').find(line=>line.trim().startsWith('const aiSaveIdentity='));
 const globals={ipcMain:{handle:(name,fn)=>handlers.set(name,fn)},trusted:()=>true,path,supervisor:{worker:{}},inPlaceTarget:()=>original,
  savePreflight:file=>file===original?{ok:false,reason:'blocked'}:{ok:true},
  dialog:{showSaveDialog:async()=>({filePath:target}),showMessageBox:async()=>{events.push('confirm');return {response:confirm?1:0};}},window:{},preferredSaveFolder:()=> 'D:/',
  approveSavePath(){},holdDrawingLock(){},localSavePathProblem:()=>null,assertAIFileWrite,aiRequestStates:new Map([[1,{epoch:4,cancelled:false}]]),
  saveTargetCall:async body=>{calls.push(body);events.push(body.action||'register');return {saveToken:'token',path:target,existed:true,tempPath:target+'.token.tmp'};},
  url:'http://local',currentEngineToken:async()=> 'token',requestJson:async()=>({ok:true,value:{authorized:true}}),
  fs:{open:async(file,flags)=>{writes.push({file,flags});return {writeFile:async bytes=>writes.push(bytes),sync:async()=>{},close:async()=>{}};},rm:async()=>{}},Buffer,Uint8Array,ArrayBuffer,Date};
 const prefix=kind==='pick'?"ipcMain.handle('cad:pick-save-target'":"ipcMain.handle('cad:save-file'";
 const start=desktopSource.indexOf(prefix),end=desktopSource.indexOf(kind==='pick'?"ipcMain.handle('cad:open-folder'":"/* N1/1:",start);
 vm.runInNewContext(identityLine+'\n'+desktopSource.slice(start,end),globals);
 return {run:()=>handlers.get(kind==='pick'?'cad:pick-save-target':'cad:save-file')({sender:{id:1}},{name:'old.dxf',format:'dxf',data:Buffer.from('new DXF').toString('base64'),...identity}),identity,calls,writes,events};
}

for(const kind of ['pick','file']){
 test('desktop '+kind+' fallback confirms the chosen existing file while preserving AI identity',async()=>{
  const fixture=desktopFixture({kind}),result=await fixture.run();
  assert.equal(result.path,'D:/existing.dxf');assert.equal(fixture.events.filter(e=>e==='confirm').length,1);
  assert.ok(fixture.events.indexOf('register')<fixture.events.indexOf('confirm'));
  for(const [key,value] of Object.entries(fixture.identity))assert.equal(fixture.calls[0][key],value);
  if(kind==='file'){
   assert.deepEqual(fixture.events,['register','confirm','commit','cancel']);
   assert.equal(fixture.calls.find(call=>call.action==='commit').tempPath,'D:/existing.dxf.token.tmp');
   assert.equal(fixture.writes[0].flags,'wx');
  }
 });
 test('desktop '+kind+' overwrite cancellation releases its reservation and never commits',async()=>{
  const fixture=desktopFixture({kind,confirm:false}),result=await fixture.run();
  assert.ok(result.canceled===true||result.saved===false);assert.deepEqual(fixture.events,['register','confirm','cancel']);assert.equal(fixture.writes.length,0);
 });
}

const studioSource=await fs.readFile(new URL('./studio.js',import.meta.url),'utf8');
function studioFormFixture(fixture,{api=async()=>({data:'cGRm'})}={}){
 const forms=[],outputs=[],changes=[],opened=deferred();
 const globals={engine:fixture.engine,crypto:{randomUUID},structuredClone,G:{bounds:()=>null},chosen:()=>[],paperField:()=>({name:'paper'}),
  field:(name,label,value)=>({name,label,value}),getSettings:()=>({denominator:100,projectName:'drawing',colorMode:'mono'}),
  form:(title,fields,apply,cancel)=>{forms.push({title,fields,apply,cancel});opened.resolve();},
  positive:value=>{if(!(Number(value)>0))throw Error('positive required');return Number(value);},num:Number,
  sheetJob:(document,sheets,settings)=>({document,sheets,settings}),api,
  output:async(...args)=>outputs.push(args),toast(){},change:value=>{changes.push(value);Object.assign(fixture.engine.doc,value);},
 };
 const start=studioSource.indexOf('    PDF(ai='),end=studioSource.indexOf('    SHEETNUMBER()',start);
 assert.ok(start>=0&&end>start,'production PDF/SHEET handler boundaries');
 const helperStart=studioSource.indexOf('  const aiForm='),helperEnd=studioSource.indexOf('  const handlers=',helperStart);
 assert.ok(helperStart>=0&&helperEnd>helperStart,'production aiForm boundaries');
 fixture.studio.handlers=vm.runInNewContext('(()=>{'+studioSource.slice(helperStart,helperEnd)+'return ({'+studioSource.slice(start,end)+'});})()',globals);
 return {forms,outputs,changes,opened,submit:value=>forms.at(-1).apply(value)};
}
const pdfValues={scope:'all',paper:'A3',denominator:100,title:'drawing',colorMode:'mono'};
const sheetValues={number:'A-001',title:'plan',paper:'A3',denominator:100,minX:0,minY:0,maxX:10000,maxY:7000};

test('actual studio PDF delayed conversion cannot output after login generation changes',async()=>{
 const gate=deferred(),entered=deferred(),fixture=screenFixture();
 const form=studioFormFixture(fixture,{api:async()=>{entered.resolve();return gate.promise;}});
 const workflow=fixture.studio.handlers.PDF({commit:apply=>commitAIChange(fixture.context,fixture.request,()=>{},apply),saveOptions:{aiRequestId:'original'}}),rejected=assert.rejects(workflow,/stale login epoch/);
 const pending=form.submit(pdfValues);await entered.promise;fixture.expire();gate.resolve({data:'cGRm'});
 await assert.rejects(pending,/stale login epoch/);await rejected;assert.equal(form.outputs.length,0);
});

test('actual studio PDF callback carries original AI save identity to output',async()=>{
 const fixture=screenFixture(),form=studioFormFixture(fixture),saveOptions={aiRequestId:'original',aiRecipient:'editor',aiRequestEpoch:4,aiExpiresAt:Date.now()+30000};
 const workflow=fixture.studio.handlers.PDF({commit:apply=>commitAIChange(fixture.context,fixture.request,()=>{},apply),saveOptions});
 await form.submit(pdfValues);assert.equal((await workflow).completed,true);assert.equal(form.outputs.length,1);
 assert.equal(form.outputs[0][1],'drawing.pdf');assert.equal(form.outputs[0][4],saveOptions);
 assert.deepEqual(fixture.order,['authorize']);
});

test('actual studio SHEET delayed form cannot mutate after logout and relogin',async()=>{
 const fixture=screenFixture(),form=studioFormFixture(fixture);
 const workflow=fixture.studio.handlers.SHEET({commit:apply=>commitAIChange(fixture.context,fixture.request,()=>{},apply)});
 const rejected=assert.rejects(workflow,/stale login epoch/);fixture.expire();await assert.rejects(form.submit(sheetValues),/stale login epoch/);await rejected;
 assert.equal(form.changes.length,0);assert.equal(fixture.engine.doc.sheets,undefined);
});

test('actual studio SHEET callback applies exactly once after final authorization',async()=>{
 const fixture=screenFixture(),form=studioFormFixture(fixture);
 const workflow=fixture.studio.handlers.SHEET({commit:apply=>commitAIChange(fixture.context,fixture.request,()=>{},apply)});
 await form.submit(sheetValues);assert.equal((await workflow).completed,true);assert.equal(form.changes.length,1);assert.equal(fixture.engine.doc.sheets[0].number,'A-001');
 assert.deepEqual(fixture.order,['authorize']);
});

for(const command of ['PDF','PLOT'])test('screen '+command+' retains tool lifetime until the actual studio callback completes',async()=>{
 const fixture=screenFixture(),form=studioFormFixture(fixture),saveOptions={aiRequestId:'original',aiRecipient:'editor',aiRequestEpoch:4,aiExpiresAt:Date.now()+30000};
 let settled=false;const pending=fixture.context.runAICommand(command,{request:fixture.request,saveOptions}).finally(()=>{settled=true;});
 await form.opened.promise;await Promise.resolve();assert.equal(settled,false,'opening a form must not complete/remove the pending tool authorization');
 await form.submit(pdfValues);const result=await pending;
 assert.equal(result.completed,true);assert.equal(result.saved,true);assert.equal(form.outputs[0][4],saveOptions);
});

test('screen SHEET retains original authorization until delayed user submission',async()=>{
 const fixture=screenFixture(),form=studioFormFixture(fixture);let toolPending=true;
 const authorize=fixture.context.authorizeAIRequest;
 fixture.context.authorizeAIRequest=async request=>{assert.equal(toolPending,true,'bridge removes authorization after the tool response');return authorize(request);};
 const pending=fixture.context.runAICommand('SHEET',{request:fixture.request}).finally(()=>{toolPending=false;});
 await form.opened.promise;assert.equal(toolPending,true);
 await form.submit(sheetValues);const result=await pending;
 assert.equal(result.completed,true);assert.equal(form.changes.length,1);assert.equal(toolPending,false);
});

test('AI form cancellation completes its pending tool without changes or output',async()=>{
 const fixture=screenFixture(),form=studioFormFixture(fixture);
 const pending=fixture.context.runAICommand('PDF',{request:fixture.request});await form.opened.promise;form.forms[0].cancel();
 const result=await pending;assert.equal(result.cancelled,true);assert.equal(result.started,false);assert.equal(form.outputs.length,0);
});

test('one AI PDF form shares an in-flight submission and outputs only once',async()=>{
 const gate=deferred(),fixture=screenFixture(),form=studioFormFixture(fixture,{api:()=>gate.promise});
 const workflow=fixture.studio.handlers.PDF({commit:apply=>commitAIChange(fixture.context,fixture.request,()=>{},apply),saveOptions:{aiRequestId:'one-request'}});
 const first=form.submit(pdfValues),second=form.submit(pdfValues);gate.resolve({data:'cGRm'});
 await Promise.all([first,second,workflow]);assert.equal(form.outputs.length,1,'double submit must not repeat the PDF file write');
});

test('cancelling an AI PDF form during conversion prevents its late output callback',async()=>{
 const gate=deferred(),entered=deferred(),fixture=screenFixture(),form=studioFormFixture(fixture,{api:async()=>{entered.resolve();return gate.promise;}});
 const workflow=fixture.studio.handlers.PDF({commit:apply=>commitAIChange(fixture.context,fixture.request,()=>{},apply),saveOptions:{aiRequestId:'one-request'}});
 const submission=form.submit(pdfValues);await entered.promise;form.forms[0].cancel();assert.equal((await workflow).cancelled,true);
 gate.resolve({data:'cGRm'});await assert.rejects(submission,/닫히거나 완료된/);assert.equal(form.outputs.length,0);
});
