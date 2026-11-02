import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {DrawingEngine} from './engine.js';
import {createBridgeBinding,createBoundRequestHandler} from './bridge-client.js';
import {standardLayerForName} from './layer-standards.js';

function harness(){
 const engine=new DrawingEngine();let active=engine.doc.layers[0].id;
 const context={engine,getDrawingId:()=> 'drawing',getActiveLayer:()=>active,execute:c=>engine.execute(c),selected:()=>new Set(),refresh(){}};
 const binding=createBridgeBinding(context),backend=crypto.randomUUID(),handler=createBoundRequestHandler(context,binding);
 const call=(action,args={})=>{const target={...binding.current(),backend_generation:backend,snapshot_id:crypto.randomUUID()};binding.receive({protocol_version:1,backend_generation:backend,target});return handler({id:crypto.randomUUID(),expires_at:Date.now()+20000,action,args:{...args,target,expectedRevision:target.revision}});};
 return {engine,context,call,active:()=>active,setActive:id=>active=id};
}
const line=()=>({type:'add',entity:{type:'line',points:[{x:0,y:0},{x:1000,y:0}]}});
const layerName=(doc,e)=>doc.layers.find(l=>l.id===e.layer)?.name;

test('레이어 미지정 기본 도형은 0/기본 레이어를 보존하고 경고·건축 명령 안내를 반환한다',()=>{
 for(const name of ['0','기본']){
  const h=harness();h.engine.doc.layers[0].name=name;
  const preview=h.call('cad_preview',{command:line()});assert.equal(preview.error,undefined,JSON.stringify(preview));
  assert.equal(h.engine.doc.entities.length,0);assert.match(preview.result.warnings.join(' '),/레이어 미지정/);assert.match(preview.result.warnings.join(' '),/WALDRAW/);
  const result=h.call('cad_execute',{command:preview.result.normalized_command});assert.equal(result.error,undefined,JSON.stringify(result));
  assert.equal(layerName(h.engine.doc,h.engine.doc.entities[0]),name);assert.equal(h.active(),h.engine.doc.layers[0].id);
  assert.match(result.result.warnings.join(' '),/cad_get_layer_usage/);
 }
});
test('layer 이름·한글 용도·ID와 purpose는 원하는 표준 레이어를 고른다',()=>{
 for(const args of [{layer:'A-DOOR'},{layer:'문'},{purpose:'door'},{purpose:'기둥'},{purpose:'실'},{purpose:'치수'}]){
  const h=harness(),out=h.call('cad_execute',{command:line(),...args});assert.equal(out.error,undefined,JSON.stringify(out));
  const expected=args.purpose==='기둥'?'A-COL':args.purpose==='실'?'A-AREA':args.purpose==='치수'?'A-DIM':'A-DOOR';
  assert.equal(layerName(h.engine.doc,h.engine.doc.entities[0]),expected);assert.ok(!out.result.warnings.some(w=>w.includes('세트 밖')));
 }
 const h=harness();h.engine.execute({type:'layer.add',name:'A-GLAZ'});const id=h.engine.doc.layers.find(l=>l.name==='A-GLAZ').id;
 assert.equal(h.call('cad_execute',{command:line(),layer:id}).error,undefined);assert.equal(h.engine.doc.entities[0].layer,id);
});
test('없는 on-demand 표준 레이어는 preview로 계획하고 생성·도형을 한 번에 되돌린다',()=>{
 const h=harness(),name='A-DETL',standard=standardLayerForName(name);
 h.engine.doc.layers=h.engine.doc.layers.filter(l=>l.name!==name);const before=structuredClone(h.engine.doc);
 const preview=h.call('cad_preview',{command:line(),layer:name});assert.equal(preview.error,undefined,JSON.stringify(preview));assert.deepEqual(h.engine.doc,before);
 const command=preview.result.normalized_command,layer=preview.result.after_document.layers.find(l=>l.name===name);
 for(const k of ['color','linetype','label','description','lineweight'])assert.deepEqual(layer[k],standard[k],k);
 const done=h.call('cad_execute',{command,layer:name});assert.equal(done.error,undefined,JSON.stringify(done));
 assert.equal(h.engine.doc.layers.find(l=>l.name===name).id,layer.id);assert.equal(h.engine.doc.entities[0].layer,layer.id);
 h.engine.execute({type:'undo'});assert.deepEqual(h.engine.doc,before);
});
test('명시적 객체 layer와 중첩 객체·batch를 보존하고 사용자 레이어는 조용히 바꾸지 않는다',()=>{
 const h=harness(),custom={...h.engine.doc.layers[0],id:'custom',name:'사용자벽'};h.engine.doc.layers.push(custom);
 const command={type:'batch',commands:[line(),{type:'add',entity:{type:'block',name:'test',entities:[line().entity],layer:custom.id}}]};
 const out=h.call('cad_execute',{command,layer:'A-DOOR'});assert.equal(out.error,undefined,JSON.stringify(out));
 assert.equal(h.engine.doc.entities[0].layer,h.engine.doc.layers.find(l=>l.name==='A-DOOR').id);assert.equal(h.engine.doc.entities[1].layer,custom.id);
 assert.equal(layerName(h.engine.doc,h.engine.doc.entities[1].entities[0]),'A-DOOR');assert.equal(h.engine.doc.layers.find(l=>l.id===custom.id).name,custom.name);
});
test('addMany 벽도 미지정 현재 레이어를 자동 분류하지 않고 경고한다',()=>{
 const h=harness(),out=h.call('cad_execute',{command:{type:'addMany',entities:[{type:'wall',points:[{x:0,y:0},{x:1000,y:0}],thickness:200,openings:[]}]}});
 assert.equal(out.error,undefined,JSON.stringify(out));assert.equal(h.engine.doc.entities[0].layer,h.active());assert.match(out.result.warnings.join(' '),/세트 밖/);
});
test('알 수 없는 레이어·잠긴 레이어는 변경 없이 거절한다',()=>{
 const h=harness(),before=structuredClone(h.engine.doc);
 for(const args of [{layer:'A-FAKE'},{purpose:'nonsense'},{layer:''},{layer:123}])assert.ok(h.call('cad_execute',{command:line(),...args}).error);
 assert.deepEqual(h.engine.doc,before);
 h.engine.execute({type:'layer.add',name:'A-DOOR'});const layer=h.engine.doc.layers.find(l=>l.name==='A-DOOR');layer.locked=true;assert.match(h.call('cad_execute',{command:line(),layer:layer.name}).error,/잠겨/);assert.equal(h.engine.doc.entities.length,0);
});
test('AI 레이어 모듈은 개발 서버 허용 목록과 묶음 빌드 입구에 등록된다',()=>{
 assert.match(fs.readFileSync(new URL('./server.py',import.meta.url),'utf8'),/['"]\/ai-layer-policy\.js['"]/);
 const source=fs.readFileSync(new URL('./build_desktop.py',import.meta.url),'utf8');assert.equal(source.match(/'ai-layer-policy\.js'/g).length,2);
});

test('AI 기록 재현: update·updateMany 의 레이어 이름과 블록 넣기 레이어도 ID 로 바꾼다(객체의 레이어가 없습니다)',async()=>{
 const {prepareAICommand}=await import('./ai-layer-policy.js');
 const e=new DrawingEngine(),doc=e.doc,keep=doc.layers[0].id;
 const out=prepareAICommand(doc,{type:'batch',commands:[{type:'update',ids:['x'],changes:{layer:'A-WALL'}},{type:'updateMany',updates:[{id:'y',changes:{layer:'벽체'}},{id:'z',changes:{layer:keep}}]},{type:'block.insert',name:'B'}]},{},keep);
 const added=out.commands.filter(c=>c.type==='layer.add'),ids=new Set([...doc.layers.map(l=>l.id),...added.map(l=>l.id)]);
 const body=out.commands.at(-1).commands;
 assert.ok(ids.has(body[0].changes.layer)&&ids.has(body[1].updates[0].changes.layer));
 assert.equal(body[1].updates[1].changes.layer,keep);
 assert.equal(body[2].layer,keep);
});
