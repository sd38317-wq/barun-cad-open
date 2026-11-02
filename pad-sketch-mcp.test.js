import test from 'node:test';
import assert from 'node:assert/strict';
import {createPadSketchRequestHandler,connectBridge,PAD_SKETCH_ACTION} from './bridge-client.js';
import {userErrorMessage} from './user-error.js';

const target={revision:7};
const request=(args={})=>({id:'11111111-1111-4111-8111-111111111111',action:PAD_SKETCH_ACTION,expires_at:Date.now()+10000,args:{target,...args}});
const entries=()=>[{id:'sketch-2',mode:'mark',strokes:[[{x:-100,y:300},{x:500,y:0}],[{x:30,y:50}]]},{id:'sketch-1',mode:'draw',strokes:[[{x:0,y:0},{x:10,y:10}]]}];
const binding={assert:t=>assert.deepEqual(t,target),current:()=>target};

test('pad reader lists bounds without canvas/document access; empty, missing and stale requests stay read-only',async()=>{
 const context={getPadSketches:entries,get engine(){throw Error('large drawing must not be read');}};
 const read=createPadSketchRequestHandler(context,binding);
 const list=await read(request({include_image:false}));assert.equal(list.result.applied,false);assert.equal(list.result.sketch_id,'sketch-2');
 assert.deepEqual(list.result.sketches[0].bounds,{minX:-100,minY:0,maxX:500,maxY:300});assert.equal(list.result.sketches[0].strokeCount,2);
 assert.ok(!('image' in list.result));assert.ok(!('strokes' in list.result.sketches[0]));
 assert.match((await read(request({sketch_id:'missing'}))).error,/없거나/);
 const empty=await createPadSketchRequestHandler({},binding)(request());assert.deepEqual(empty.result.sketches,[]);assert.equal(empty.result.sketch_id,null);
 assert.equal((await read({...request(),expires_at:0})).error,userErrorMessage(new Error('CAD request is invalid or expired')));
 let queried=false;const stale=createPadSketchRequestHandler({getPadSketches:()=>{queried=true;}},{assert(){throw Error('target changed');}});
 assert.equal((await stale(request())).error,userErrorMessage(new Error('target changed')));assert.equal(queried,false);
});

test('pad PNG uses the requested raw group, maps y-up coordinates, paints dots and keeps revision unchanged',async()=>{
 const original=globalThis.document,calls=[];let canvas;
 const c={fillRect:(...args)=>calls.push(['white',...args]),beginPath(){},moveTo:(...args)=>calls.push(['move',...args]),lineTo:(...args)=>calls.push(['line',...args]),stroke:()=>calls.push(['stroke']),arc:(...args)=>calls.push(['dot',...args]),fill(){}};
 globalThis.document={createElement:type=>{assert.equal(type,'canvas');canvas={getContext:()=>c,toDataURL:type=>{assert.equal(type,'image/png');return 'data:image/png;base64,UE5H';}};return canvas;}};
 try{
  const read=createPadSketchRequestHandler({getPadSketches:entries},binding);
  const {result:r}=await read(request({size:512}));assert.deepEqual(r.image,{mimeType:'image/png',data:'UE5H'});
  assert.equal(canvas.width,r.width);assert.equal(r.width,512);assert.equal(r.before_revision,7);assert.equal(r.after_revision,7);assert.equal(r.applied,false);
  const start=calls.find(c=>c[0]==='move'),end=calls.find(c=>c[0]==='line');assert.ok(start[2]<end[2]);assert.equal(calls.filter(c=>c[0]==='dot').length,1);
  assert.ok(Math.abs(r.window.minX+start[1]*r.mmPerPixel+100)<1e-9);
  assert.ok(Math.abs(r.window.maxY-start[2]*r.mmPerPixel-300)<1e-9);
  const other=await read(request({sketch_id:'sketch-1'}));assert.equal(other.result.sketch_id,'sketch-1');assert.equal(other.result.bounds.maxX,10);
 }finally{if(original===undefined)delete globalThis.document;else globalThis.document=original;}
});

test('bridge polling routes sketch reads and avoids forcing a fresh whole-document snapshot',async()=>{
 const original={window:globalThis.window,document:globalThis.document,setTimeout:globalThis.setTimeout},timers=[],payloads=[];
 globalThis.window={addEventListener(){}};globalThis.document={hasFocus:()=>true};globalThis.setTimeout=fn=>timers.push(fn);
 try{
  connectBridge({context:{engine:{doc:{entities:[{id:'one'}]},onChange(){}},getDrawingId:()=> 'tab-1',selected:()=>new Set(),getCommandSettings:()=>({}),getPadSketches:entries},getFolder:()=>'',api:async(name,payload)=>{
   if(name==='chat')return {authorized:true};
   payloads.push(payload);const backend='22222222-2222-4222-8222-222222222222',bound={protocol_version:1,backend_generation:backend,editor_session:payload.client,document_generation:payload.document_generation,snapshot_id:'33333333-3333-4333-8333-333333333333',revision:payload.revision};
   return {protocol_version:1,backend_generation:backend,target:bound,requests:payloads.length===1?[request({include_image:false,target:bound})]:[]};
  }});
  await new Promise(r=>original.setTimeout(r,0));await timers.shift()();
  assert.equal(payloads[0].document.entities.length,1);assert.ok(!('document' in payloads[1]));
  assert.equal(payloads[1].results[0].result.sketch_id,'sketch-2');assert.equal(payloads[1].results[0].result.applied,false);
 }finally{Object.assign(globalThis,original);}
});
