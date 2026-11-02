import './test-fixtures/compute-fake-server.js';   // 서버 계산(compute/)은 가짜 바른 서버로
import test from 'node:test';
import assert from 'node:assert/strict';
import {DrawingEngine,newDrawingDocument} from './engine.js';
import {createBridgeBinding,createBoundRequestHandler,prepareComputeRequest} from './bridge-client.js';
import {CORE,input} from './test-fixtures/structure-calc-report.js';
import fs from 'node:fs';

test('bridge: 서버 3~5층 응답은 계산서, 확인서는 거절; 도면·revision 보존',async()=>{
 for(const count of [3,4,5]){
  const model=CORE.generate({...input('A'),stories:count}),review=CORE.review(model);
  const engine=new DrawingEngine();engine.execute({type:'load',document:newDrawingDocument()});
  const context={engine,getDrawingId:()=> 'drawing',execute:()=>assert.fail('도면 변경 금지')},binding=createBridgeBinding(context);
  const target={...binding.current(),backend_generation:crypto.randomUUID(),snapshot_id:crypto.randomUUID()};
  binding.receive({protocol_version:1,backend_generation:target.backend_generation,target});
  const before=JSON.stringify(engine.doc),sync=createBoundRequestHandler(context,binding),handler=async request=>sync(request,await prepareComputeRequest(context,binding,request));
  const request=action=>({id:crypto.randomUUID(),expires_at:Date.now()+25000,action,args:{target,record:{model,review}}});
  const report=(await handler(request('cad_structure_calc_report')));
  assert.equal(report.error,undefined);assert.equal(report.result.ok,true);assert.equal(report.result.applied,false);
  assert.ok(report.result.html.includes('구조계산서'));assert.equal(report.result.sections.length,9);
  const certificate=(await handler(request('cad_structure_certificate')));
  assert.equal(certificate.result.ok,false);assert.equal(certificate.result.html,undefined);
  assert.equal(JSON.stringify(engine.doc),before);assert.equal(binding.current().revision,target.revision);
 }
});

test('bridge: floors가 3층이면 오래된 stories=1로 확인서를 우회하지 못한다',()=>{
 const fixture=JSON.parse(fs.readFileSync(new URL('./tests/fixtures/structure-server-responses.json',import.meta.url))).rc;
 const engine=new DrawingEngine();engine.execute({type:'load',document:newDrawingDocument()});
 const context={engine,getDrawingId:()=> 'drawing'},binding=createBridgeBinding(context);
 const target={...binding.current(),backend_generation:crypto.randomUUID(),snapshot_id:crypto.randomUUID()};binding.receive({protocol_version:1,backend_generation:target.backend_generation,target});
 fixture.model.p.stories=1;fixture.model.p.floors=[{},{},{}];
 const out=createBoundRequestHandler(context,binding)({id:crypto.randomUUID(),expires_at:Date.now()+25000,action:'cad_structure_certificate',args:{target,record:fixture}});
 assert.equal(out.result.ok,false);
});

