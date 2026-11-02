import test from 'node:test';import assert from 'node:assert/strict';
import {connectBridge,createSessionRequestHandler} from './bridge-client.js';

const request=(action,args={})=>({id:crypto.randomUUID(),action,args:{...args,target:null},expires_at:Date.now()+20000});

test('cad_open_file asks the desktop for a new drawing window without waiting for it',async()=>{
 const opened=[];let finish;
 const handler=createSessionRequestHandler({},()=>({openInNewWindows:paths=>{opened.push(paths);return new Promise(r=>finish=r);}}));
 const r=request('cad_open_file',{path:'D:\\도면\\a.dxf'});
 const {response,after}=await handler(r);
 assert.deepEqual(opened,[['D:\\도면\\a.dxf']]);assert.deepEqual(response,{id:r.id,target:null,result:{requested:true}});assert.equal(after,undefined);finish();
 const plain=await createSessionRequestHandler({},()=>undefined)(request('cad_open_file',{path:'D:\\a.dxf'}));
 assert.match(plain.response.error,/데스크톱/);
});

test('cad_close_document returns the editor refusal or a close that runs after delivery',async()=>{
 const after=()=>{},ok={closeDrawingForBridge:()=>({result:{closed:true,session_closed:true,drawingPath:'',drawingName:'a'},after})};
 const closed=await createSessionRequestHandler(ok)(request('cad_close_document'));
 assert.equal(closed.response.result.closed,true);assert.equal(closed.after,after);
 const dirty=await createSessionRequestHandler({closeDrawingForBridge:()=>{throw Error('저장되지 않은 변경이 있어 닫지 않았습니다.');}})(request('cad_close_document'));
 assert.match(dirty.response.error,/저장되지 않은/);assert.equal(dirty.after,undefined);
 const expired=await createSessionRequestHandler(ok)({...request('cad_close_document'),expires_at:Date.now()-1});
 assert.ok(expired.response.error);assert.equal(expired.after,undefined);
});

test('the window closes only after the engine has received the close result',async()=>{
 const original={window:globalThis.window,document:globalThis.document,setTimeout:globalThis.setTimeout};const timers=[],sent=[],events=[];
 globalThis.window={addEventListener(){}};globalThis.document={hasFocus:()=>true};globalThis.setTimeout=fn=>timers.push(fn);
 const close=request('cad_close_document');let failNext=false;
 try{
  connectBridge({context:{engine:{doc:{entities:[]},onChange(){}},selected:()=>new Set(),getCommandSettings:()=>({}),
   closeDrawingForBridge:()=>({result:{closed:true,session_closed:true},after:()=>events.push('closed')})},
   getFolder:()=>'',api:async(name,payload)=>{if(name!=='bridge')return {};sent.push(payload.results);if(failNext){failNext=false;throw Error('offline');}return {requests:sent.length===1?[close]:[]};}});
  await new Promise(r=>original.setTimeout(r,0));
  assert.deepEqual(events,[],'not closed while the result is still undelivered');
  failNext=true;await timers.shift()();
  assert.deepEqual(events,[],'a failed delivery keeps the window open');
  await timers.shift()();
  assert.equal(sent.at(-1)[0].id,close.id);assert.deepEqual(events,['closed']);
 }finally{Object.assign(globalThis,original);}
});
