import test from 'node:test';
import assert from 'node:assert/strict';
import {GpuRenderClient} from './gpu-render-client.js';
import {planDocument,applyDocument,renderRegion,cropRegion} from './gpu-render-protocol.js';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
const view={width:400,height:300,scale:1,origin:{x:200,y:150},pixelRatio:1,hiddenTextId:null};
const doc={layers:[],entities:[{id:'a'},{id:'b'}]};
const setup=()=>{const sent=[],worker={postMessage:m=>sent.push(m),terminate(){this.terminated=true;}};return {sent,worker,c:new GpuRenderClient({createWorker:()=>worker,timeoutMs:5000})};};
const reply=(job)=>({id:job.id,epoch:job.epoch,token:job.token,revision:job.revision,view:job.view,region:renderRegion(job.view,job.overscan),stats:{frames:1},bitmap:{width:656,height:556,closed:false,close(){this.closed=true;}}});
test('worker coalesces mouse moves and sends document only once',()=>{
 const {c,sent}=setup();try{c.request({...view,doc,revision:1});for(let i=1;i<=50;i++)c.request({...view,origin:{x:200+i,y:150},doc,revision:1});assert.equal(sent.length,1);
 c.receive(reply(sent[0]));assert.equal(sent.length,2);assert.equal(sent[1].view.origin.x,250);assert.equal(sent[1].update,null);assert.ok(c.frame);c.receive(reply(sent[1]));assert.equal(sent.length,2);
 }finally{c.dispose();}
});

test('build progress requests the next slice without presenting an unfinished revision',()=>{
 const {c,sent}=setup();try{
  c.request({...view,doc,revision:1});
  for(let i=0;i<3;i++){
   const job=sent.at(-1);
   c.receive({id:job.id,epoch:job.epoch,token:job.token,revision:job.revision,building:true,stats:{buildProgress:{phase:'items',done:i*512}}});
   assert.equal(c.frame,null);assert.equal(c.stats.workerPending,true);assert.ok(c.pending);
   assert.equal(sent.at(-1).update,null,'resume without copying the document again');
  }
  assert.equal(sent.length,4);c.receive(reply(sent.at(-1)));assert.ok(c.frame);assert.equal(c.stats.workerPending,false);
 }finally{c.dispose();}
});

test('a superseded build progress response dispatches only the latest document',()=>{
 const {c,sent}=setup();try{
  c.request({...view,doc,revision:1});const job=sent[0],next={...doc};
  c.request({...view,doc:next,revision:2});
  c.receive({id:job.id,epoch:job.epoch,token:job.token,revision:1,building:true,stats:{items:9999}});
  assert.equal(c.frame,null);assert.equal(c.stats.items,undefined);assert.equal(sent.length,2);assert.equal(sent[1].revision,2);
  c.receive(reply(sent[1]));assert.equal(c.frame.revision,2);
 }finally{c.dispose();}
});

test('the render worker yields build progress before taking a bitmap and resumes without a document update',async()=>{
 const source=readFileSync(new URL('./gpu-render-worker.js',import.meta.url),'utf8')
  .replace(/^import .*;\r?$/gm,'').replaceAll('import.meta.url',"'http://localhost/gpu-render-worker.js'");
 const posted=[],calls=[];let options,bitmaps=0,renderer;
 const self={fonts:{add(){}},postMessage(message){posted.push(message);}};
 class FakeRenderer{
  constructor(o){options=o;renderer=this;this.stats={};}
  render(o){calls.push(o);this.buildTask=calls.length===1?{}:null;return {};}
 }
 runInNewContext(source,{self,CadGpuRenderer:FakeRenderer,applyDocument,renderRegion,URL,performance,
  FontFace:class{async load(){return this;}},OffscreenCanvas:class{},
  createImageBitmap:async()=>{bitmaps++;return {close(){}};}});
 const first={type:'render',id:1,epoch:1,token:1,revision:1,view,overscan:128,update:{kind:'full',doc}};
 await self.onmessage({data:first});
 assert.equal(options.buildBudgetMs,30);assert.equal(options.compileWorker,false);assert.ok(renderer.buildTask);
 assert.equal(posted[0].building,true);assert.equal(posted[0].bitmap,undefined);assert.equal(bitmaps,0);
 await self.onmessage({data:{...first,id:2,update:null}});
 assert.equal(renderer.buildTask,null);assert.equal(calls[1].doc,calls[0].doc);assert.equal(calls[1].revision,1);
 assert.equal(bitmaps,1);assert.ok(posted[1].bitmap);assert.equal(posted[1].building,undefined);
});
test('tab/revision supersession closes bitmap and never shows old document',()=>{
 const {c,sent}=setup();try{c.request({...view,doc,revision:1});const old=reply(sent[0]);c.request({...view,doc:{...doc},revision:2});c.receive(old);assert.equal(old.bitmap.closed,true);assert.equal(c.frame,null);assert.equal(sent.length,2);c.receive(reply(sent[1]));assert.equal(c.frame.revision,2);
 const shown=c.frame.bitmap;c.clearScene();assert.equal(shown.closed,true);const stale=reply(sent[1]);c.receive(stale);assert.equal(stale.bitmap.closed,true);
 }finally{c.dispose();}
});
test('replacement, error and disposal release all frame resources',()=>{
 const {c,sent,worker}=setup();c.request({...view,doc,revision:1});c.receive(reply(sent[0]));const first=c.frame.bitmap;
 c.request({...view,origin:{x:201,y:150},doc,revision:1});c.receive(reply(sent[1]));assert.equal(first.closed,true);const last=c.frame.bitmap;c.fail('context lost');assert.equal(last.closed,true);assert.equal(worker.terminated,true);assert.throws(()=>c.request({...view,doc,revision:1}),/context lost/);c.dispose();
});
test('font invalidation terminates epoch and requests full document again',()=>{
 const {c,sent}=setup();try{c.request({...view,doc,revision:1});const old=reply(sent[0]);c.clearScene();c.request({...view,doc,revision:1});assert.equal(sent[1].update.kind,'full');c.receive(old);assert.equal(old.bitmap.closed,true);assert.ok(c.pending);}finally{c.dispose();}
});
test('old worker queued errors cannot terminate a replacement worker',()=>{
 const workers=[],c=new GpuRenderClient({createWorker:()=>{const w={postMessage(){},terminate(){}};workers.push(w);return w;}});
 try{c.request({...view,doc,revision:1});c.clearScene();c.request({...view,doc,revision:1});workers[0].onerror({message:'obsolete failure'});workers[0].onmessageerror();assert.equal(c.failed,null);assert.equal(c.worker,workers[1]);}finally{c.dispose();}
});
test('delta preserves painter order and unchanged references, style changes use full',()=>{
 const added={id:'a',value:2},next={...doc,entities:[added,doc.entities[1],{id:'c'}]},edit={lightweight:true,previousDoc:doc,previousRevision:1,removed:[doc.entities[0]],added:[added,next.entities[2]]};
 const update=planDocument(doc,1,{doc:next,revision:2,edit});assert.equal(update.kind,'delta');const applied=applyDocument(doc,1,update);assert.deepEqual(applied.doc,next);assert.equal(applied.doc.entities[1],doc.entities[1]);assert.equal(applied.edit.removed[0],doc.entities[0]);
 assert.equal(planDocument(doc,1,{doc:{...next,layers:[]},revision:2,edit}).kind,'full');
});
test('overscan crop is exact physical translation; fractional and stale zoom rejected',()=>{
 const base={...view,pixelRatio:1.25},frame={view:base,region:renderRegion(base),bitmap:{width:820,height:695}};
 assert.deepEqual(cropRegion(frame,{...base,origin:{x:200.8,y:150}}),{x:159,y:160,w:500,h:375});
 assert.equal(cropRegion(frame,{...base,origin:{x:201,y:150}}),null);assert.equal(cropRegion(frame,{...base,scale:2}),null);
 assert.equal(renderRegion({...base,width:401}).margin,0);
});
