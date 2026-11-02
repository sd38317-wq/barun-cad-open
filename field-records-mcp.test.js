import test from 'node:test';
import assert from 'node:assert/strict';
import {createFieldRecordsLocateHandler,connectBridge} from './bridge-client.js';

const target={revision:7};
const record={id:'p1',link_id:'link1',no:3,at:{x:1200,y:3400}};
const request=(extra={})=>({id:'11111111-1111-4111-8111-111111111111',action:'cad_field_records_locate',expires_at:Date.now()+10000,args:{target,record,...extra}});
const binding={assert:t=>assert.deepEqual(t,target),current:()=>target};

test('locate focuses the saved pin with unchanged drawing revision and no geometry access',async()=>{
 const focused=[];
 const handler=createFieldRecordsLocateHandler({focusFieldRecord:r=>focused.push(r),get engine(){throw Error('must not read drawing geometry');}},binding);
 const {result}=await handler(request());
 assert.deepEqual(focused,[record]);assert.equal(result.located,true);assert.equal(result.applied,false);
 assert.equal(result.before_revision,7);assert.equal(result.after_revision,7);assert.equal(result.record.no,3);
});

test('expired, invalid, stale, cancelled and unauthorized locate requests never move the screen',async()=>{
 let moved=0;const focusFieldRecord=()=>moved++;
 for(const req of [{...request(),expires_at:0},{...request(),id:'bad'},request({record:{...record,at:{x:NaN,y:0}}}),request({record:null})]){
  assert.ok((await createFieldRecordsLocateHandler({focusFieldRecord},binding)(req)).error);
 }
 for(const context of [{focusFieldRecord,assertAIRequest(){throw Error('cancelled');}},{focusFieldRecord,authorizeAIRequest:async()=>{throw Error('login required');}}]){
  assert.ok((await createFieldRecordsLocateHandler(context,binding)(request())).error);
 }
 assert.ok((await createFieldRecordsLocateHandler({focusFieldRecord},{assert(){throw Error('changed');}})(request())).error);
 assert.equal(moved,0);
});

test('locate rechecks target and deadline after asynchronous login check',async()=>{
 let moved=false,expired=request();
 const context={focusFieldRecord:()=>moved=true,authorizeAIRequest:async()=>{expired.expires_at=0;}};
 assert.ok((await createFieldRecordsLocateHandler(context,binding)(expired)).error);assert.equal(moved,false);
});

test('bridge routes locate results without forcing a drawing snapshot and sends the draft key',async()=>{
 const original={window:globalThis.window,document:globalThis.document,setTimeout:globalThis.setTimeout};
 const timers=[],payloads=[],focused=[];
 globalThis.window={addEventListener(){}};globalThis.document={hasFocus:()=>true};globalThis.setTimeout=fn=>timers.push(fn);
 try{
  connectBridge({context:{engine:{doc:{entities:[{id:'one'}]},onChange(){}},getDrawingId:()=> 'draft-tab',selected:()=>new Set(),getCommandSettings:()=>({}),focusFieldRecord:r=>focused.push(r)},getFolder:()=>'',api:async(name,payload)=>{
   if(name==='chat')return {authorized:true};
   payloads.push(payload);
   const bound={protocol_version:1,backend_generation:'22222222-2222-4222-8222-222222222222',editor_session:payload.client,document_generation:payload.document_generation,snapshot_id:'33333333-3333-4333-8333-333333333333',revision:payload.revision};
   return {protocol_version:1,backend_generation:bound.backend_generation,target:bound,requests:payloads.length===1?[{...request(),args:{record,target:bound}}]:[]};
  }});
  await new Promise(r=>original.setTimeout(r,0));await timers.shift()();
  assert.equal(payloads[0].draftKey,'draft-tab');assert.deepEqual(focused,[record]);
  assert.equal(payloads[1].results[0].result.located,true);assert.equal(payloads[1].results[0].result.applied,false);
  assert.ok(!('document' in payloads[1]));
 }finally{Object.assign(globalThis,original);}
});

test('actual app focus callback preserves active drawing input and keeps the pad preview separate',async()=>{
 const {readFile}=await import('node:fs/promises'),{runInNewContext}=await import('node:vm');
 const source=await readFile(new URL('./app.js',import.meta.url),'utf8');
 const callback=source.slice(source.indexOf('studio.context.focusFieldRecord=record=>{')).split(/\r?\n};/)[0]+'\n};';
 const state={studio:{context:{}},fieldRecordHighlight:null,padOverlay:[{id:'pad-preview'}],mode:'PLINE',points:[{x:0,y:0}],params:{onCancel:()=>{throw Error('input cancelled');}},fitBox:box=>state.box=box,render(){},endView(){state.points=[];state.mode='SELECT';}};
 runInNewContext(callback,state);
 state.studio.context.focusFieldRecord(record);
 assert.equal(state.mode,'PLINE');assert.equal(state.points.length,1);assert.equal(state.padOverlay[0].id,'pad-preview');
 assert.equal(state.fieldRecordHighlight.no,3);assert.equal(state.box.minX,-1300);assert.equal(state.box.maxY,5400);
});


test('장부 변경 승인은 도면 본문 없이 로그인·대상·만료를 다시 검사한다',async()=>{
 const {createFieldRecordsAuthorizeHandler}=await import('./bridge-client.js');let authorized=0;
 const req={...request(),action:'cad_field_records_authorize',args:{target}};
 const context={get engine(){throw Error('도면 본문 접근');},authorizeAIRequest:async()=>authorized++};
 const result=await createFieldRecordsAuthorizeHandler(context,binding)(req);assert.equal(result.result.authorized,true);assert.equal(result.result.applied,false);assert.equal(authorized,1);
 for(const failing of [{authorizeAIRequest:async()=>{throw Error('로그인 필요');}},{authorizeAIRequest:async()=>{req.expires_at=0;}}])assert.ok((await createFieldRecordsAuthorizeHandler(failing,binding)(req)).error);
});
