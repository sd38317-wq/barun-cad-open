import './test-fixtures/compute-fake-server.js';   // 서버 계산(compute/)은 가짜 바른 서버로
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DrawingEngine,newDrawingDocument} from './engine.js';
import {standardLayerForName} from './layer-standards.js';
import {STRUCTURE_LAYERS,structureDrawingEntities,applyStructureSet} from './structure-drawing.js';
import {COMMAND_ACTIONS,VIEW_MAX_PX,createBridgeBinding,createBoundRequestHandler,createCommandRequestHandler,viewWindow,prepareComputeRequest} from './bridge-client.js';

const fixtures=JSON.parse(readFileSync(new URL('./tests/fixtures/structure-server-responses.json',import.meta.url),'utf8'));
const record=(system='rc',changes={})=>({id:'structure-1',system,...structuredClone(fixtures[system]),drawn:{origin:{x:23000,y:-7000},sheets:['plan','foundation']},...changes});
const rectangle=(changes={})=>({id:'outline',type:'rectangle',layer:'default',points:[{x:-100,y:200},{x:9900,y:200},{x:9900,y:9200},{x:-100,y:9200}],...changes});
function document(){
 const doc=newDrawingDocument();
 doc.layers=doc.layers.filter(l=>!l.name.startsWith('S-'));
 doc.entities=[rectangle(),{id:'keep',type:'text',layer:'default',position:{x:-900000,y:900000},height:250,text:'기존 객체 보존'}];
 return doc;
}
function setup(doc=document()){
 const engine=new DrawingEngine();engine.execute({type:'load',document:doc});
 const calls={commands:[],selected:[],refresh:0,toasts:[]};
 const context={engine,getDrawingId:()=> 'drawing',execute:c=>{calls.commands.push(c);return engine.execute(c);},
  setSelectedIds:ids=>calls.selected.push(ids),refresh:()=>calls.refresh++,toast:message=>calls.toasts.push(message)};
 const binding=createBridgeBinding(context);
 const ack=()=>{const target={...binding.current(),backend_generation:crypto.randomUUID(),snapshot_id:crypto.randomUUID()};binding.receive({protocol_version:1,backend_generation:target.backend_generation,target});return target;};
 const target=ack(),request=(action,args={})=>({id:crypto.randomUUID(),expires_at:Date.now()+25000,action,args:{target,...args}});
 return {engine,context,binding,target,ack,request,calls};
}
function unchanged(f){
 const doc=f.engine.doc,json=JSON.stringify(doc),undo=f.engine.undoStack.slice(),redo=f.engine.redoStack.slice(),revision=f.binding.current().revision;
 return ()=>{assert.equal(f.engine.doc,doc);assert.equal(JSON.stringify(f.engine.doc),json);assert.deepEqual(f.engine.undoStack,undo);assert.deepEqual(f.engine.redoStack,redo);assert.equal(f.binding.current().revision,revision);assert.equal(f.calls.commands.length,0);assert.equal(f.calls.selected.length,0);assert.equal(f.calls.refresh,0);assert.equal(f.calls.toasts.length,0);};
}

for(const system of ['rc','steel','wood','rcBig'])test(system+' 표본: 시트 제목·축선·층별 기둥·구조 레이어·묶음 꼬리표',()=>{
 const input=record(system),{entities,sheets}=structureDrawingEntities(input.model,{...input.drawn,setId:input.id});
 assert.deepEqual(sheets.map(s=>s.title),['기초평면도','1층 구조평면도(2층 바닥)','2층 구조평면도(지붕)']);
 assert.equal(STRUCTURE_LAYERS.length,8);
 assert.ok(entities.length>0);
 assert.ok(entities.every(e=>STRUCTURE_LAYERS.includes(e.layer)&&e.structureSet?.id===input.id));
 let start=0;
 for(const sheet of sheets){
  const end=entities.findIndex((e,i)=>i>=start&&e.type==='text'&&e.text===sheet.title);
  assert.ok(end>=start);
  const rows=entities.slice(start,end+1);start=end+1;
  assert.equal(rows.filter(e=>e.type==='line'&&e.layer==='S-GRID').length,input.model.gx.length+input.model.gy.length);
  const columns=rows.filter(e=>e.layer==='S-COLS'&&e.type==='polyline');
  const members=input.model.members.filter(m=>m.kind==='column'&&m.level===(sheet.level??1));
  assert.equal(columns.length,members.length);
  assert.deepEqual(columns.map(e=>e.structureSet.member).sort(),members.map(m=>m.id).sort());
  for(const column of columns){
   assert.equal(column.closed,true);assert.equal(column.points.length,4);
   const m=members.find(m=>m.id===column.structureSet.member),xs=column.points.map(p=>p.x),ys=column.points.map(p=>p.y);
   assert.equal(Math.max(...xs)-Math.min(...xs),m.b);assert.equal(Math.max(...ys)-Math.min(...ys),m.h);
   assert.equal((Math.min(...xs)+Math.max(...xs))/2,sheet.origin.x+m.x*1000);
   assert.equal((Math.min(...ys)+Math.max(...ys))/2,sheet.origin.y+m.y*1000);
  }
 }
 assert.equal(start,entities.length);
});

test('applyStructureSet: 다른 객체·묶음 보존, 새 객체 ID와 표준 레이어 색',()=>{
 const doc=document(),before=structuredClone(doc),input=record();
 doc.structureSets={other:{id:'other'}};doc.entities[1].structureSet={id:'other',member:null};
 const saved=structuredClone(doc),r=applyStructureSet(doc,input);
 assert.deepEqual(doc,saved);assert.deepEqual(r.document.entities.slice(0,2),doc.entities);
 assert.equal(r.removed,0);assert.ok(r.added.length>0);assert.equal(new Set(r.added).size,r.added.length);
 assert.deepEqual(r.document.structureSets.other,doc.structureSets.other);assert.deepEqual(r.document.structureSets[input.id],input);
 assert.deepEqual(r.sheets.map(s=>s.title),['기초평면도','1층 구조평면도(2층 바닥)','2층 구조평면도(지붕)']);
 const created=r.document.layers.filter(l=>!before.layers.some(old=>old.id===l.id));assert.ok(created.length>0);
 for(const layer of created){assert.ok(STRUCTURE_LAYERS.includes(layer.name));assert.equal(layer.color,standardLayerForName(layer.name).color);assert.equal(layer.locked,false);assert.equal(layer.visible,true);}
 assert.ok(r.document.entities.every(e=>r.document.layers.some(l=>l.id===e.layer)));
});

test('applyStructureSet: 같은 묶음 재적용은 옛 객체를 전부 지우고 새 ID로 교체',()=>{
 const first=applyStructureSet(document(),record()),before=structuredClone(first.document);
 const input=record('steel'),next=applyStructureSet(first.document,input),oldIds=new Set(first.added);
 assert.equal(next.removed,first.added.length);assert.ok(next.added.length>0);
 assert.ok(next.added.every(id=>!oldIds.has(id)));assert.ok(next.document.entities.every(e=>!oldIds.has(e.id)));
 assert.deepEqual(next.document.entities.slice(0,2),first.document.entities.slice(0,2));assert.deepEqual(first.document,before);
 assert.deepEqual(next.document.structureSets[input.id],input);
});

test('applyStructureSet: 자료 부족 초안은 장마다 검토 초안 도장(대표 2026-10-30 로그인이면 초안으로 그림)',()=>{
 const input=record();input.drawn.draft='검토 초안 · 구조계산 전 · 가정값 포함';
 const r=applyStructureSet(document(),input),stamps=r.document.entities.filter(e=>e.type==='text'&&e.text===input.drawn.draft);
 assert.equal(stamps.length,r.sheets.length);assert.ok(stamps.length>0);
 const plain=applyStructureSet(document(),record());assert.ok(!plain.document.entities.some(e=>e.structureSet?.member==='draft'),'적합 묶음은 도장 없음');
});
test('applyStructureSet: drawn 없는 기록은 객체 생성 없이 저장',()=>{
 const doc=document(),input=record('rc',{drawn:undefined}),r=applyStructureSet(doc,input);
 assert.deepEqual(r.added,[]);assert.equal(r.removed,0);assert.equal(r.sheets,null);
 assert.deepEqual(r.document.entities,doc.entities);assert.deepEqual(r.document.structureSets[input.id],input);
});

for(const flag of ['locked','frozen']){
 test('applyStructureSet: 새 객체 대상 S- 레이어 '+flag+' 거절·원본 보존',()=>{
  const doc=document();doc.layers.push({...standardLayerForName('S-COLS'),id:'locked-cols',visible:true,[flag]:true});
  const before=structuredClone(doc);assert.throws(()=>applyStructureSet(doc,record()),/잠겨 있거나 얼어/);assert.deepEqual(doc,before);
 });
 test('applyStructureSet: 옛 객체가 있는 '+flag+' 레이어도 삭제 전에 거절',()=>{
  const first=applyStructureSet(document(),record()),doc=first.document;
  doc.layers.find(l=>l.name==='S-FNDN')[flag]=true;
  const before=structuredClone(doc);
  for(const drawn of [undefined,{origin:{x:0,y:0},sheets:['plan']}])assert.throws(()=>applyStructureSet(doc,record('rc',{drawn})),/잠겨 있거나 얼어/);
  assert.deepEqual(doc,before);
 });
}

test('applyStructureSet: id·model·부재 목록 없는 기록 거절',()=>{
 for(const input of [null,{},record('rc',{id:null}),record('rc',{model:null}),record('rc',{model:{}})])assert.throws(()=>applyStructureSet(document(),input));
});

test('cad_structure_read: 기록 그대로 반환·없는 기록 null·setId 우선·동기·수정 없음',()=>{
 const doc=document(),input=record();doc.structureSets={[input.id]:input};
 const f=setup(doc),check=unchanged(f),handle=createBoundRequestHandler(f.context,f.binding);
 const out=handle(f.request('cad_structure_read',{setId:input.id,entityId:'missing'}));
 assert.equal(out.error,undefined);assert.equal(typeof out.then,'undefined');assert.equal(out.result.record,f.engine.doc.structureSets[input.id]);
 assert.equal(out.result.applied,false);assert.equal(out.result.before_revision,f.target.revision);assert.equal(out.result.revision,f.target.revision);
 assert.equal(handle(f.request('cad_structure_read',{setId:'missing'})).result.record,null);check();
 const empty=setup();assert.equal(createBoundRequestHandler(empty.context,empty.binding)(empty.request('cad_structure_read',{setId:'missing'})).result.record,null);
});

test('cad_structure_read: rectangle·닫힌 polyline·역방향·1 mm 오차의 축 정렬 윤곽',()=>{
 for(const entity of [rectangle(),rectangle({type:'polyline',closed:true}),rectangle({points:rectangle().points.toReversed()}),rectangle({points:[{x:-100,y:200},{x:9900,y:201},{x:9900,y:9200},{x:-100,y:9200}]})]){
  const doc=document();doc.entities[0]=entity;const f=setup(doc),check=unchanged(f);
  const out=createBoundRequestHandler(f.context,f.binding)(f.request('cad_structure_read',{entityId:'outline'}));
  assert.equal(out.error,undefined);assert.deepEqual(out.result.outline,{x:-100,y:200,width:10000,depth:9000});check();
 }
});

test('cad_structure_read: 회전·꺾임·교차·열림·잘못된 꼭짓점은 쉬운 오류로 거절',()=>{
 const cases=[rectangle({points:[{x:0,y:0},{x:100,y:100},{x:0,y:200},{x:-100,y:100}]}),
  rectangle({points:[{x:0,y:0},{x:100,y:0},{x:80,y:100},{x:0,y:100}]}),
  rectangle({points:[{x:0,y:0},{x:100,y:100},{x:100,y:0},{x:0,y:100}]}),
  rectangle({type:'polyline',closed:false}),rectangle({type:'line',points:rectangle().points.slice(0,2)}),rectangle({type:'polyline',closed:true,points:rectangle().points.slice(0,3)}),
  rectangle({points:[{x:0,y:0},{x:100,y:0},{x:0,y:100},{x:0,y:100}]}),
  rectangle({points:[{x:0,y:0},{x:100,y:0},{x:100,y:0},{x:0,y:0}]}),
  rectangle({points:[{x:0,y:0},{x:100,y:1.01},{x:100,y:100},{x:0,y:100}]})];
 for(const entity of cases){const doc=document();doc.entities[0]=entity;const f=setup(doc),check=unchanged(f),out=createBoundRequestHandler(f.context,f.binding)(f.request('cad_structure_read',{entityId:'outline'}));assert.equal(out.error,'직사각형 닫힌 윤곽만 됩니다(회전·꺾인 모양은 다음 단계)');check();}
 const f=setup(),handle=createBoundRequestHandler(f.context,f.binding),check=unchanged(f);
 assert.match(handle(f.request('cad_structure_read')).error,/setId.*entityId/);assert.match(handle(f.request('cad_structure_read',{entityId:'missing'})).error,/직사각형 닫힌 윤곽/);check();
});

for(const system of ['rc','steel','wood'])test('cad_structure_apply '+system+': 한 번 적용·선택·응답 재사용·한 번 실행 취소',async()=>{
 const f=setup(),before=structuredClone(f.engine.doc),undo=f.engine.undoStack.length,handle=createCommandRequestHandler(f.context,f.binding);
 const req=f.request('cad_structure_apply',{record:record(system),expectedRevision:f.target.revision}),out=await handle(req);
 assert.equal(out.error,undefined);assert.equal(out.result.applied,true);assert.equal(out.result.setId,'structure-1');assert.equal(out.result.removed,0);
 assert.equal(out.result.added,f.engine.doc.entities.length-before.entities.length);assert.deepEqual(out.result.sheets.map(s=>s.title),['기초평면도','1층 구조평면도(2층 바닥)','2층 구조평면도(지붕)']);
 assert.equal(out.result.after.count,f.engine.doc.entities.length);assert.equal(out.result.before_revision,f.target.revision);assert.equal(out.result.after_revision,f.target.revision+1);assert.equal(out.result.revision,out.result.after_revision);
 assert.equal(f.calls.commands.length,1);assert.equal(f.calls.commands[0].type,'lisp.apply');assert.equal(f.engine.undoStack.length,undo+1);
 const ids=f.engine.doc.entities.filter(e=>e.structureSet?.id==='structure-1').map(e=>e.id);assert.deepEqual(f.calls.selected,[ids]);assert.equal(f.calls.refresh,1);assert.match(f.calls.toasts[0],/AI\/MCP 구조.*실행 취소 가능/);
 assert.deepEqual(await handle(req),out);assert.equal(f.calls.commands.length,1);assert.equal(f.engine.undoStack.length,undo+1);
 assert.match((await handle({...req,args:{...req.args,record:record(system,{id:'changed'})}})).error,/reused/);
 assert.ok((await handle(f.request('cad_structure_apply',{record:record(system),expectedRevision:f.target.revision}))).error);
 f.engine.execute({type:'undo'});assert.deepEqual(f.engine.doc,before);assert.equal(f.engine.undoStack.length,undo);
});

test('cad_structure_apply: 재적용 removed 개수·다른 객체 보존·한 번 되돌리기',async()=>{
 const first=applyStructureSet(document(),record()),f=setup(first.document),before=structuredClone(f.engine.doc),handle=createCommandRequestHandler(f.context,f.binding);
 const out=await handle(f.request('cad_structure_apply',{record:record('steel'),expectedRevision:f.target.revision}));
 assert.equal(out.error,undefined);assert.equal(out.result.removed,first.added.length);assert.deepEqual(f.engine.doc.entities.slice(0,2),before.entities.slice(0,2));
 f.engine.execute({type:'undo'});assert.deepEqual(f.engine.doc,before);
});

test('cad_structure_apply: expectedRevision 필수·불일치·잘못된 기록·잠금은 원자적으로 거절',async()=>{
 for(const args of [{record:record()},{record:record(),expectedRevision:1},{record:null,expectedRevision:0},{record:record('rc',{model:null}),expectedRevision:0}]){
  const f=setup(),check=unchanged(f),out=await createCommandRequestHandler(f.context,f.binding)(f.request('cad_structure_apply',args));assert.ok(out.error);check();
 }
 const doc=document();doc.layers.push({...standardLayerForName('S-COLS'),id:'locked-cols',visible:true,locked:true});
 const f=setup(doc),check=unchanged(f);assert.match((await createCommandRequestHandler(f.context,f.binding)(f.request('cad_structure_apply',{record:record(),expectedRevision:f.target.revision}))).error,/잠겨 있거나 얼어/);check();
});

for(const system of ['rc','steel','wood'])test('cad_structure_preview '+system+': 새 구조만 SVG→PNG·기본 크기·도면과 양쪽 실행 취소 기록 보존',async()=>{
 const first=applyStructureSet(document(),record('rc',{id:'other'})),f=setup(first.document);
 f.engine.execute({type:'add',entity:{type:'line',layer:'default',points:[{x:0,y:0},{x:100,y:100}]}});f.engine.execute({type:'undo'});
 const target=f.ack(),check=unchanged(f),input=record(system),expected=structureDrawingEntities(input.model,{...input.drawn,setId:input.id});let renders=0;
 const handle=createCommandRequestHandler(f.context,f.binding,undefined,{rasterize:async(svg,win,size)=>{
  renders++;assert.match(svg,/<svg/);for(const sheet of expected.sheets)assert.ok(svg.includes(sheet.title));assert.ok(!svg.includes('기존 객체 보존'));
  assert.equal(size,1200);assert.deepEqual(win,viewWindow({entities:expected.entities}));
  assert.ok(win.minX>0,'기존 도면과 다른 묶음은 미리보기 영역에서 제외');
  return {data:'cG5n',width:1200,height:450};
 }});
 const req=f.request('cad_structure_preview',{target,record:input}),out=await handle(req);
 assert.equal(out.error,undefined);assert.deepEqual(out.result.image,{mimeType:'image/png',data:'cG5n'});assert.equal(out.result.width,1200);assert.equal(out.result.height,450);
 assert.equal(out.result.count,expected.entities.length);assert.equal(out.result.applied,false);assert.deepEqual(out.result.sheets,expected.sheets);
 assert.equal(out.result.before_revision,target.revision);assert.equal(out.result.after_revision,target.revision);assert.equal(out.result.revision,target.revision);
 assert.deepEqual(await handle(req),out);assert.equal(renders,1);check();
});

test('cad_structure_preview: 크기 상한·렌더 실패·drawn 없는 기록 거절',async()=>{
 const f=setup(),check=unchanged(f);let rendered=0;
 const handle=createCommandRequestHandler(f.context,f.binding,undefined,{rasterize:async(svg,win,size)=>{rendered++;assert.equal(size,VIEW_MAX_PX);return {data:'png',width:size,height:800};}});
 assert.equal((await handle(f.request('cad_structure_preview',{record:record(),size:99999}))).error,undefined);
 assert.match((await handle(f.request('cad_structure_preview',{record:record('rc',{drawn:undefined})}))).error,/drawn/);assert.equal(rendered,1);check();
 const broken=createCommandRequestHandler(f.context,f.binding,undefined,{rasterize:async()=>{throw Error('PNG 렌더 실패');}});
 assert.match((await broken(f.request('cad_structure_preview',{record:record()}))).error,/PNG 렌더 실패/);check();
});

test('cad_structure_preview: 비동기 렌더 중 수정·도면 교체·만료된 응답 거절',async()=>{
 for(const phase of ['edit','replace','expire']){
  const f=setup(),req=f.request('cad_structure_preview',{record:record()});
  const handle=createCommandRequestHandler(f.context,f.binding,undefined,{rasterize:async()=>{
   if(phase==='edit')f.engine.execute({type:'new'});
   if(phase==='replace')f.engine.doc=structuredClone(f.engine.doc);
   if(phase==='expire')req.expires_at=Date.now()-1;
   return {data:'stale',width:1200,height:500};
  }});
  const out=await handle(req);assert.ok(out.error);assert.equal(out.result,undefined);assert.equal(f.calls.commands.length,0);
 }
});

test('구조 명령 라우팅·만료 요청·오래된 target은 실행과 렌더 전에 거절',async()=>{
 assert.ok(COMMAND_ACTIONS.has('cad_structure_apply'));assert.ok(COMMAND_ACTIONS.has('cad_structure_preview'));assert.ok(!COMMAND_ACTIONS.has('cad_structure_read'));
 for(const action of ['cad_structure_read','cad_structure_apply','cad_structure_preview']){
  const f=setup();let renders=0;const bound=createBoundRequestHandler(f.context,f.binding),command=createCommandRequestHandler(f.context,f.binding,undefined,{rasterize:async()=>{renders++;throw Error('렌더하면 안 됨');}});
  const handle=action==='cad_structure_read'?bound:command,req=f.request(action,{setId:'missing',record:record(),expectedRevision:f.target.revision});
  const check=unchanged(f);assert.ok((await handle({...req,id:crypto.randomUUID(),expires_at:Date.now()-1})).error);check();
  f.engine.execute({type:'new'});const after=unchanged(f);assert.ok((await handle(req)).error);assert.equal(renders,0);after();
 }
});

function assertAllNumbersFinite(value) {
 if (typeof value === 'number') assert.ok(Number.isFinite(value), '유한한 출력 숫자');
 else if (value && typeof value === 'object') Object.values(value).forEach(assertAllNumbersFinite);
}

test('사선 벽·줄기초·가새: 끝점 띠와 X자, 부재 대응, 모든 출력 숫자가 유한수',()=>{
 const model={system:'rc',p:{stories:1},gx:[0,6],gy:[0,4],members:[
  {id:'c',kind:'column',code:'C1',level:1,x:0,y:0,b:400,h:400},
  {id:'w',kind:'wall',code:'W1',level:1,dir:'d',x0:0,y0:0,x1:6,y1:4,t:200},
  {id:'sw',kind:'stairWall',code:'SW1',level:1,dir:'d',x0:6,y0:4,x1:3,y1:0,t:200},
  {id:'f',kind:'strip',code:'F1',dir:'d',x0:0,y0:0,x1:6,y1:4,w:1000,D:400},
  {id:'br',kind:'brace',code:'BR1',level:1,dir:'d',x0:0,y0:0,x1:6,y1:4},
 ]};
 const r=structureDrawingEntities(model,{setId:'diagonal',origin:{x:123,y:-456}});
 assertAllNumbersFinite(r);
 const wall=r.entities.find(e=>e.structureSet.member==='w'&&e.type==='polyline');
 const strip=r.entities.find(e=>e.structureSet.member==='f'&&e.type==='polyline');
 for(const [entity,width] of [[wall,200],[strip,1000]]){
  assert.ok(entity); assert.equal(entity.points.length,4);
  const [a,b,c,d]=entity.points;
  assert.ok(Math.abs(Math.hypot(a.x-d.x,a.y-d.y)-width)<.01);
  assert.ok(Math.abs((b.y-a.y)/(b.x-a.x)-4/6)<1e-5);
 }
 const braces=r.entities.filter(e=>e.structureSet.member==='br'&&e.type==='line');
 assert.equal(braces.length,2);
 for(const id of ['w','sw','br'])assert.ok(r.entities.some(e=>e.structureSet.member===id&&e.type==='text'));
 assert.deepEqual(r.sheets.map(s=>s.title),['기초평면도','1층 구조평면도(지붕)']);
});

test('사선 손상·NaN·Infinity는 문서 변경 전에 거절',()=>{
 const input=record(); input.model.members.push({id:'bad',code:'W9',kind:'wall',level:1,dir:'d',x0:0,y0:0,x1:Infinity,y1:4,t:200});
 const doc=document(),before=structuredClone(doc);
 assert.throws(()=>applyStructureSet(doc,input),/유한수/); assert.deepEqual(doc,before);
 for(const v of [NaN,Infinity,-Infinity])assert.throws(()=>structureDrawingEntities(record().model,{setId:'bad',origin:{x:v,y:0}}),/유한/);
 const zero=record(); zero.model.members.push({id:'zero',kind:'wall',level:1,dir:'d',x0:1,y0:1,x1:1,y1:1,t:200});
 assert.throws(()=>structureDrawingEntities(zero.model,{setId:'zero'}),/끝점/);
});

test('재생성은 수정한 부호 위치·사용자 주석·구버전 객체를 보존하고 대체 객체 중복을 피함',()=>{
 const first=applyStructureSet(document(),record()),doc=first.document;
 const changed=doc.entities.find(e=>e.structureSet?.id==='structure-1'&&e.type==='text'&&e.structureSet.member);
 changed.position.x+=777; changed.text='사용자 수정 부호';
 const comment={id:'comment',type:'text',layer:changed.layer,position:{x:1,y:2},height:180,text:'사용자 주석',structureSet:{id:'structure-1',member:null,user:true}};
 const legacy={...structuredClone(comment),id:'legacy',structureSet:{id:'structure-1',member:'old'}};
 doc.entities.push(comment,legacy);
 const snapshot=structuredClone(doc),next=applyStructureSet(doc,record());
 assert.deepEqual(doc,snapshot);
 assert.deepEqual(new Set(next.preserved),new Set([changed.id,comment.id,legacy.id]));
 assert.equal(next.removed,first.added.length-1);
 for(const id of next.preserved)assert.deepEqual(next.document.entities.find(e=>e.id===id),doc.entities.find(e=>e.id===id));
 assert.equal(next.document.entities.filter(e=>e.structureSet?.key===changed.structureSet.key).length,1);
 assert.match(next.warnings[0],/3개.*보존/);
 const again=applyStructureSet(next.document,record());
 assert.deepEqual(new Set(again.preserved),new Set(next.preserved));
});

test('실제 박스 읽기→인식 API: 두 층 좌표·높이와 명시 mode를 서버 계산 경로로 전달',async()=>{
 const doc=document();
 doc.layers=doc.layers.filter(l=>l.name!=='A-WALL-CONC');
 doc.layers.push({id:'walls',name:'A-WALL-CONC',color:'#ffffff',visible:true,locked:false});
 const ring=[[0,0],[8000,0],[8000,6000],[0,6000]],points=r=>r.map(([x,y])=>({x,y}));
 const boxes=[0,20000].map((dx,i)=>({id:'box'+i,type:'rectangle',layer:'default',points:points([[dx-1000,-1000],[dx+9000,-1000],[dx+9000,7000],[dx-1000,7000]])}));
 const walls=[0,20000].flatMap((dx,f)=>ring.map((p,i)=>({id:'wall'+f+'-'+i,type:'line',layer:'walls',points:points([[p[0]+dx,p[1]],[ring[(i+1)%4][0]+dx,ring[(i+1)%4][1]]])})));
 doc.entities=[...boxes,...walls];
 const f=setup(doc),before=structuredClone(f.engine.doc),sync=createBoundRequestHandler(f.context,f.binding),handle=async request=>sync(request,await prepareComputeRequest(f.context,f.binding,request));
 const out=await handle(f.request('cad_structure_read',{boxes:['box0','box1'],options:{heights:[3300,3200],datums:[{x:0,y:0},{x:20000,y:0}]},overrides:{system:'rc',mode:'check'}}));
 assert.equal(out.error,undefined);
 assert.equal(out.result.input.mode,'check'); assert.equal(out.result.input.floors.length,2);
 assert.deepEqual(out.result.input.floors.map(q=>q.H),[3.3,3.2]);
 assert.deepEqual(out.result.input.floors[0].outline,out.result.input.floors[1].outline);
 assert.ok(out.result.input.floors.every(q=>q.walls.length===4));
 assert.ok(Array.isArray(out.result.findings)); assert.deepEqual(f.engine.doc,before);
 assert.match((await handle(f.request('cad_structure_read',{boxes:['gone']}))).error,/박스/);
});

test('브라우저 재생성 응답과 알림에 보존된 수정 객체를 표시',async()=>{
 const first=applyStructureSet(document(),record()),doc=first.document;
 const changed=doc.entities.find(e=>e.structureSet?.id==='structure-1'&&e.type==='text');
 changed.text='수동으로 바꾼 제목';
 const f=setup(doc),out=await createCommandRequestHandler(f.context,f.binding)(f.request('cad_structure_apply',{record:record(),expectedRevision:f.target.revision}));
 assert.equal(out.error,undefined); assert.ok(out.result.preserved.includes(changed.id)); assert.match(out.result.warnings[0],/보존/);
 assert.ok(f.calls.toasts.some(t=>t.includes('보존'))); assert.equal(f.engine.doc.entities.find(e=>e.id===changed.id).text,changed.text);
});

test('시트 선택을 바꿔도 보존 대상과 새 객체를 층·시트별로 구분',()=>{
 const input=record(),first=applyStructureSet(document(),input),doc=first.document;
 const member=input.model.members.find(m=>m.kind==='column'&&m.level===1);
 const column=doc.entities.find(e=>e.structureSet?.member===member.id&&e.layer===doc.layers.find(l=>l.name==='S-COLS').id);
 column.points[0].x+=80;
 const changed=record('rc',{drawn:{origin:{x:50000,y:0},sheets:['plan']}});
 const r=applyStructureSet(doc,changed);
 assert.ok(r.preserved.includes(column.id));
 const columns=r.document.entities.filter(e=>e.structureSet?.member===member.id&&e.type==='polyline');
 assert.equal(columns.length,2,'수정한 기초 표시를 보존해도 1층 시트 기둥을 생략하지 않음');
 assert.equal(columns.filter(e=>r.added.includes(e.id)).length,1);
});


import {createHash} from 'node:crypto';
import {bounds as drawingBounds} from './geometry.js';
import {structureLevels,structureSheets} from './structure-drawing.js';
import {CORE as drawingCORE} from './test-fixtures/structure-calc-report.js';
import {midriseDrawingModel} from './test-fixtures/structure-drawing.js';
const hashDrawing = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const legacyPlanHashes = {
 rc:'3cff1acbb0665d8140031edfbf69e338b8f6e1c895d04da0d862038a2cd28a65',
 steel:'5a5b0f36363588d20eb5303be9f417ad40719abae5ca88d47c1cb0db602c9ece',
 wood:'2b51c27a2e67772161b7819aa9c8c67e5613f43c9998d56cd167b4bbbef87ff6',
 rcBig:'20e2237cc24941c45a0a1bde505777492978a774f846b37c5b389d6ce82453d4',
};
test('기존 KDS 42 평면·기초 JSON 바이트 회귀',()=>{
 for(const [system,hash] of Object.entries(legacyPlanHashes))assert.equal(hashDrawing(structureDrawingEntities(record(system).model,{setId:'baseline',sheets:['foundation','plan']})),hash,system);
});
const inSheet = (b,s) => b.minX>=s.bounds.minX-1e-6 && b.minY>=s.bounds.minY-1e-6 && b.maxX<=s.bounds.maxX+1e-6 && b.maxY<=s.bounds.maxY+1e-6;
for(const [kind,n] of [['C',3],['A',5],['B',4]])test(n+'층 개략: 층당 평면 한 장·기초·A3·S 레이어·필로티·실제 위치',()=>{
 const m=midriseDrawingModel(kind),before=JSON.stringify(m),r=structureDrawingEntities(m,{setId:'midrise',origin:{x:123,y:-456}});
 assert.equal(JSON.stringify(m),before);assert.deepEqual(structureLevels(m),Array.from({length:n},(_,i)=>i+1));
 assert.deepEqual(structureSheets(m),['foundation',...structureLevels(m)]);assert.equal(r.sheets.length,n+1);
 assert.deepEqual(r.sheets.filter(s=>s.sheet==='plan').map(s=>s.level),structureLevels(m));
 for(const [i,s] of r.sheets.entries()){
  assert.equal(s.paper,'A3');assert.deepEqual(s.paperSize,{width:420,height:297});
  assert.equal(s.bounds.maxX-s.bounds.minX,420*s.scale);assert.equal(s.bounds.maxY-s.bounds.minY,297*s.scale);
  if(i)assert.ok(r.sheets[i-1].bounds.maxX<s.bounds.minX);
  const es=r.entities.filter((e,j)=>r.entitySheets[j]===(s.sheet==='foundation'?'foundation':s.level));
  for(const e of es){assert.ok(STRUCTURE_LAYERS.includes(e.layer));assert.ok(inSheet(drawingBounds([e]),s),e.text||e.type);
   assert.equal(e.structureSet.id,'midrise');if(e.type==='text')assert.ok(e.height/s.scale>=2.5);}
  if(s.sheet==='plan'){
   for(const [id,layer] of [['C1','S-COLS'],['W1','S-WALL'],['B1','S-BEAM']]){
    assert.ok(es.some(e=>e.structureSet.member===id&&e.layer===layer&&e.type==='polyline'));
    assert.ok(es.some(e=>e.structureSet.member===id&&e.text===id));
   }
   const c=es.find(e=>e.layer==='S-COLS'&&e.type==='polyline'),b=drawingBounds([c]);
   assert.equal(b.maxX-b.minX,400+(s.level-1)*50);assert.equal(b.maxY-b.minY,450+(s.level-1)*50);
   assert.equal(s.pilotis,kind==='B'&&s.level===1);
   if(s.pilotis)assert.ok(es.some(e=>e.text==='1층 필로티 층'));
   const outline=es.find(e=>e.layer==='S-SLAB'&&e.linetype==='DASHED'),ob=drawingBounds([outline]);
   assert.ok((ob.maxY-ob.minY)/(s.draw.maxY-s.draw.minY)>.74,'A3 높이를 채우는 축척');
  }else{
   const footing=es.find(e=>e.layer==='S-FNDN'&&e.type==='polyline'),b=drawingBounds([footing]);
   assert.equal(b.maxX-b.minX,2400);assert.equal(b.maxY-b.minY,2600,'직사각형 L을 B로 대체하지 않음');
  }
 }
 assertAllNumbersFinite(r);
});
test('3~5층 단면 미제공은 위치기호·중심선, 제안은 부호와 시트 머리에 표시',()=>{
 const blank=midriseDrawingModel('A',{sections:false});
 blank.members=[]; // 층별 geometry에 단면이 없어도 층 수만큼 시트를 유지한다.
 const r=structureDrawingEntities(blank,{setId:'blank'});
 assert.equal(r.sheets.filter(s=>s.sheet==='plan').length,5);
 assert.ok(!r.entities.some(e=>e.layer==='S-COLS'&&e.type==='polyline'));
 assert.ok(r.entities.some(e=>e.layer==='S-COLS'&&e.type==='line'&&e.structureSet.member==='C1'));
 const proposal=midriseDrawingModel('C',{proposal:true}),p=structureDrawingEntities(proposal,{setId:'proposal'});
 assert.ok(p.entities.some(e=>e.text==='C1 (제안)'));
 assert.ok(p.entities.some(e=>e.text==='F1 (제안)'));
 for(const s of p.sheets)assert.ok(p.entities.some(e=>e.text==='제안 단면 포함 — 확인 전 시공 금지'&&inSheet(drawingBounds([e]),s)));
});
test('층마다 다른 축선·윤곽, 위치 미상 보를 임의 경간에 만들지 않음',()=>{
 const m=midriseDrawingModel('C');m.floors[1].gx=[-2,4,12];m.floors[1].gy=[-1,10,23];
 m.floors[1].outline=[[-2,-1],[12,-1],[12,23],[-2,23]];
 delete m.floors[1].beams[0].x0;
 const r=structureDrawingEntities(m,{setId:'floor-grid',sheets:['plan']});
 const es=r.entities.filter((e,i)=>r.entitySheets[i]===2);
 assert.ok(es.some(e=>e.text==='8000'));assert.ok(es.some(e=>e.text==='13000'));
 assert.ok(!es.some(e=>e.layer==='S-BEAM'&&e.structureSet.member==='B1'));
 assert.ok(es.some(e=>e.text==='위치 미제공 부재 1개 · 일람표 참조'));
 assertAllNumbersFinite(r);
});
test('3층 전체 시트 적용·재생성은 시트별 꼬리표와 사용자 수정 보존',()=>{
 const m=midriseDrawingModel('C'),input={id:'midrise-set',model:m,drawn:{origin:{x:0,y:0},sheets:['plan','foundation','schedule','notes']}};
 const first=applyStructureSet(document(),input),changed=first.document.entities.find(e=>e.structureSet?.member==='C1'&&e.type==='text');
 changed.position.x+=77;changed.text='수정한 C1';
 const next=applyStructureSet(first.document,input);
 assert.ok(next.preserved.includes(changed.id));assert.equal(next.document.entities.filter(e=>e.structureSet?.key===changed.structureSet.key).length,1);
 assert.equal(next.sheets.filter(s=>s.sheet==='plan').length,3);
});

test('1층 RC·철골·목조 전체 도면 JSON 바이트 회귀',()=>{
 const input={X:10,Y:9,stories:1,H:3.3,target:6,roof:'flat',pitch:0,stairs:'none',stairW:1,use:'house',snow:'normal',wind:'normal',slope:0,Fe:150,soilOk:true,species:'다',grade:2,openH:2.1};
 const hashes={rc:'00abca1e158cc9815b308ede5bdb37821eba47eaaab3bfabf9d240556bfae3e5',steel:'690aa5f0d4d667a02568fd4a6ae7271f3099be6577b8a80d9b3ac3841b26adc8',wood:'91907fda791cab67ef5fa82382f83ce9cff1b8fac81bbfba63ee1f1498778271'};
 for(const [system,hash] of Object.entries(hashes))assert.equal(hashDrawing(structureDrawingEntities(drawingCORE.generate({...input,system}),{setId:'baseline',sheets:['foundation','plan','schedule','notes']})),hash,system);
});

test('ID 없는 기둥은 CORE가 부여한 부호에 연결하고 같은 위치 기호를 중복 생성하지 않음',()=>{
 const p=midriseDrawingModel('C',{sections:false}).p;p.floors.forEach(f=>f.columns.forEach(c=>delete c.id));
 const m=drawingCORE.generate(p),r=structureDrawingEntities(m,{setId:'generated-id',sheets:['plan','schedule']});
 for(const level of [1,2,3]){
  const es=r.entities.filter((e,i)=>r.entitySheets[i]===level);
  assert.equal(es.filter(e=>e.layer==='S-COLS'&&e.type==='line').length,2);
  assert.equal(es.filter(e=>e.text==='C1').length,1);
 }
 const rows=r.sheets.filter(s=>s.sheet==='schedule').flatMap(s=>s.tables.flatMap(t=>t.rows));
 assert.equal(rows.length,3);assert.ok(rows.every(row=>row.code==='C1'));
});

test('직사각 기초 B/L은 엔진 momentAxis에 맞춰 x/y 배치, 정방형은 동일',()=>{
 for(const axis of ['x','y'])for(const square of [false,true]){
  const p=midriseDrawingModel('C').p;p.foundation.momentAxis=axis;p.foundation.L=square?2400:2600;
  delete p.foundation.columnB;delete p.foundation.columnL;
  const m=drawingCORE.generate(p),r=structureDrawingEntities(m,{setId:'axis-'+axis,sheets:['foundation']}),f=r.entities.find(e=>e.layer==='S-FNDN'&&e.type==='polyline'),b=drawingBounds([f]);
  assert.equal(b.maxX-b.minX,axis==='x'?p.foundation.L:p.foundation.B);
  assert.equal(b.maxY-b.minY,axis==='x'?p.foundation.B:p.foundation.L);
  const q=m.preliminary.footingResults[0].data.input;assert.equal(q.columnB,axis==='x'?450:400);
  assert.ok(inSheet(b,r.sheets[0]));assertAllNumbersFinite(r);
 }
});
// 2026-10-27 사장님 "구조 도면 양식 시안 추천대로 sheet-templates.json 에 고정": 구조 장도 평면도와 같은 A3 도곽·표제란·표제 기호·상세 칸 2개, S- 번호.
const TEMPLATES=JSON.parse(readFileSync(new URL('./rules/knowledge/sheet-templates.json',import.meta.url),'utf8'));
test('템플릿을 주면 구조 장마다 평면도와 같은 도곽에 S- 번호·축척·상세 칸, 내용은 도곽 안',()=>{
 const input={X:10,Y:9,stories:1,H:3.3,target:6,roof:'flat',pitch:0,stairs:'none',stairW:1,use:'house',snow:'normal',wind:'normal',slope:0,Fe:150,soilOk:true,species:'다',grade:2,openH:2.1};
 const r=structureDrawingEntities(drawingCORE.generate({...input,system:'steel'}),{setId:'s',sheets:['foundation','plan','schedule','notes'],templates:TEMPLATES});
 assert.deepEqual(r.sheets.map(s=>s.number),['S-101','S-102','S-201','S-001']);
 for(const s of r.sheets){assert.ok(s.bounds&&s.scale>0,s.number);
  const mine=r.entities.filter((e,i)=>r.entitySheets[i]===s.level);
  for(const e of mine)for(const p of [...(e.points||[]),e.position,e.center].filter(Boolean))assert.ok(p.x>=s.bounds.minX-1&&p.x<=s.bounds.maxX+1&&p.y>=s.bounds.minY-1&&p.y<=s.bounds.maxY+1,s.number+' 밖: '+JSON.stringify(p));
  const texts=mine.filter(e=>e.type==='text'||e.type==='attrib').map(e=>e.text);
  assert.ok(texts.includes(s.number),s.number+' 표제란 번호');}
 const plan=r.sheets.find(s=>s.number==='S-102');assert.ok(TEMPLATES.sheets.plan.scales.includes(plan.scale),'건축 평면 축척 목록 '+plan.scale);
 const planTexts=r.entities.filter((e,i)=>r.entitySheets[i]===plan.level&&e.type==='text').map(e=>e.text);
 assert.ok(planTexts.some(t=>/작은보-큰보 접합/.test(t))&&planTexts.some(t=>/기둥-보 접합/.test(t)),'상세 칸 이름');
 assert.equal(r.sheets.find(s=>s.number==='S-201').scale,50);
});
test('상세 칸 이름은 구조 형식마다 — 목조에 철골 접합 이름이 붙지 않는다',()=>{
 const input={X:10,Y:9,stories:1,H:3,target:6,roof:'gable',pitch:25,stairs:'none',stairW:1,use:'house',snow:'normal',wind:'normal',slope:0,Fe:150,soilOk:true,species:'다',grade:2,openH:2.1};
 for(const tpl of [TEMPLATES,null]){const r=structureDrawingEntities(drawingCORE.generate({...input,system:'wood'}),{setId:'s',sheets:['foundation','plan'],templates:tpl||{...TEMPLATES,sheets:{plan:TEMPLATES.sheets.plan}}});
  const names=r.entities.filter(e=>e.detailSlot).map(e=>e.detailSlot.name);
  assert.deepEqual(names,['기초 단면','토대 앵커 상세','장선 걸이 상세','서까래-벽 접합']);}
});
test('상세가 들어가지 않는 칸(RC·목조, 철골 기초 단면)은 \'상세 넣는 자리\'',()=>{
 const input={X:10,Y:9,stories:1,H:3,target:6,roof:'flat',pitch:0,stairs:'none',stairW:1,use:'house',snow:'normal',wind:'normal',slope:0,Fe:150,soilOk:true,species:'다',grade:2,openH:2.1};
 const notes=system=>structureDrawingEntities(drawingCORE.generate({...input,system}),{setId:'s',sheets:['foundation','plan'],templates:TEMPLATES}).entities.filter(e=>e.type==='text'&&/· 치수는/.test(e.text)).map(e=>e.text.split(' · ')[0]);
 assert.deepEqual(notes('rc'),['상세 넣는 자리','상세 넣는 자리','상세 넣는 자리','상세 넣는 자리']);
 assert.deepEqual(notes('wood'),['상세 넣는 자리','상세 넣는 자리','상세 넣는 자리','상세 넣는 자리']);
 assert.deepEqual(notes('steel'),['바른 표준 상세','상세 넣는 자리','바른 표준 상세','바른 표준 상세']);
});
test('외곽만 시안(gridPrefix S)은 축선 이름 앞에 S',()=>{
 const input={X:10,Y:9,stories:1,H:3.3,target:6,roof:'flat',pitch:0,stairs:'none',stairW:1,use:'house',snow:'normal',wind:'normal',slope:0,Fe:150,soilOk:true,species:'다',grade:2,openH:2.1};
 const r=structureDrawingEntities(drawingCORE.generate({...input,system:'rc'}),{setId:'s',sheets:['plan'],templates:TEMPLATES,gridPrefix:'S'});
 const t=r.entities.filter(e=>e.type==='text').map(e=>e.text);
 assert.ok(t.includes('SX1')&&t.includes('SY1')&&!t.includes('X1'));
});
test('건축 평면 축척(planScale)이 있으면 구조 평면도 같은 축척',()=>{
 const input={X:10,Y:9,stories:1,H:3.3,target:6,roof:'flat',pitch:0,stairs:'none',stairW:1,use:'house',snow:'normal',wind:'normal',slope:0,Fe:150,soilOk:true,species:'다',grade:2,openH:2.1};
 const r=structureDrawingEntities(drawingCORE.generate({...input,system:'steel'}),{setId:'s',sheets:['foundation','plan'],templates:TEMPLATES,planScale:120});
 assert.deepEqual(r.sheets.map(s=>s.scale),[120,120]);
});
