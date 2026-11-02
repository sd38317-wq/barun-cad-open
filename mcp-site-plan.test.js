import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DrawingEngine} from './engine.js';
import {createBoundRequestHandler,createBridgeBinding} from './bridge-client.js';
const read=name=>JSON.parse(readFileSync(new URL('./test-fixtures/site-plan-v053/'+name,import.meta.url),'utf8'));
const payload=()=>({request:read('demo_site.json'),result:{entities:read('DEMO-CORNER-01_entities.json'),report:read('DEMO-CORNER-01_report.json')}});
function fixture(){
 const engine=new DrawingEngine();engine.execute({type:'add',entity:{id:'original',type:'line',layer:engine.doc.layers[0].id,points:[{x:0,y:0},{x:100,y:100}]}});
 const before=structuredClone(engine.doc),undoCount=engine.undoStack.length,executions=[],toasts=[];
 const context={engine,execute:c=>{executions.push(c);return engine.execute(c);},selected:()=>new Set(),refresh(){},toast:m=>toasts.push(m),getDrawingId:()=> 'drawing'};
 const binding=createBridgeBinding(context),target={...binding.current(),backend_generation:crypto.randomUUID(),snapshot_id:crypto.randomUUID()};
 binding.receive({protocol_version:1,backend_generation:target.backend_generation,target});
 const handler=createBoundRequestHandler(context,binding),request=(args={})=>({id:crypto.randomUUID(),expires_at:Date.now()+10000,action:'cad_insert_layout',args:{target,...payload(),...args}});
 return {engine,before,undoCount,executions,toasts,binding,target,handler,request};
}
test('MCP layout uses one load, reports binding revisions and undoes in one step',()=>{
 const f=fixture(),req=f.request({title:'검토안',offset:{x:1234,y:-2000}}),out=f.handler(req);
 assert.equal(out.error,undefined);assert.equal(f.executions.length,1);assert.equal(f.executions[0].type,'load');
 const r=out.result;assert.equal(r.applied,true);assert.equal(r.added,f.engine.doc.entities.length-f.before.entities.length);assert.ok(r.added>0);
 assert.equal(r.removed,0);assert.equal(r.changed,0);assert.equal(r.after.count,f.engine.doc.entities.length);assert.equal(r.site_plan_id,f.engine.doc.sitePlan.id);
 assert.equal(r.before_revision,f.target.revision);assert.equal(r.after_revision,f.target.revision+1);assert.equal(r.revision,r.after_revision);assert.deepEqual(r.target,f.target);assert.deepEqual(out.target,f.target);
 assert.notEqual(f.binding.current().document_generation,f.target.document_generation);assert.match(r.message,/cad_get_document/);
 assert.equal(f.engine.doc.sitePlan.alternativeTitle,'검토안');assert.deepEqual(f.engine.doc.sitePlan.offset,{x:1234,y:-2000});
 assert.deepEqual(f.engine.doc.entities[0],f.before.entities[0]);assert.deepEqual(f.toasts,['AI/MCP 배치안 넣기 완료 · 실행 취소 가능']);
 assert.equal(f.engine.undoStack.length,f.undoCount+1);f.engine.execute({type:'undo'});assert.deepEqual(f.engine.doc,f.before);
});
test('MCP layout keeps the existing default placement and AI title',()=>{
 const f=fixture(),out=f.handler(f.request());assert.equal(out.error,undefined);
 assert.equal(f.engine.doc.sitePlan.alternativeTitle,'AI 배치');assert.deepEqual(f.engine.doc.sitePlan.offset,{x:30100,y:0});
});
test('MCP layout replay is applied once and an old target cannot edit again',()=>{
 const f=fixture(),req=f.request(),out=f.handler(req);assert.equal(out.error,undefined);
 assert.deepEqual(f.handler(req),out);assert.equal(f.executions.length,1);
 const before=structuredClone(f.engine.doc),next=f.handler(f.request());assert.ok(next.error);assert.throws(()=>f.binding.assert(f.target),/target changed/);assert.deepEqual(f.engine.doc,before);assert.equal(f.executions.length,1);
});
test('MCP layout rejects malformed results without changing the drawing',()=>{
 for(const result of [null,{report:{geometry:{}},entities:[]},{report:{},entities:{entities:[]}}]){
  const f=fixture(),out=f.handler(f.request({result}));assert.ok(out.error);assert.equal(f.executions.length,0);
  assert.deepEqual(f.engine.doc,f.before);assert.equal(f.engine.undoStack.length,f.undoCount);assert.deepEqual(f.toasts,[]);
 }
});
test('MCP layout attach failure preserves all original entities and layers',()=>{
 const f=fixture(),p=payload();p.result.entities.entities.push({type:'UNKNOWN',layer:'A-BLDG-L1'});
 const out=f.handler(f.request(p));assert.match(out.error,/지원하지 않는 배치/);assert.equal(f.executions.length,0);
 assert.deepEqual(f.engine.doc,f.before);assert.equal(f.engine.undoStack.length,f.undoCount);
});
test('MCP layout validates the finished document before executing',()=>{
 const f=fixture();f.engine.validate=()=>{throw Error('검증 실패');};const out=f.handler(f.request());
 assert.match(out.error,/검증 실패/);assert.equal(f.executions.length,0);assert.deepEqual(f.engine.doc,f.before);
});
test('MCP layout refuses invalid offset coordinates without executing',()=>{
 for(const offset of [null,{x:'10',y:20},{x:Infinity,y:0},{x:10}]){
  const f=fixture(),out=f.handler(f.request({offset}));assert.match(out.error,/offset/);assert.equal(f.executions.length,0);assert.deepEqual(f.engine.doc,f.before);
 }
});
