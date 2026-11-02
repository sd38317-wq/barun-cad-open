// AI 가 쓰는 3D·검토 도구(재료·납품 점검·PDF 작업) — 실제 앱과 같은 처리 경로(createBoundRequestHandler)로 시험.
import test from 'node:test';
import assert from 'node:assert/strict';
import {DrawingEngine} from './engine.js';
import {createBridgeBinding,createBoundRequestHandler,REVIEW_ACTIONS} from './bridge-client.js';
import {MATERIAL_PRESETS,MATERIAL_KINDS,resolveMaterial,validateMaterialMap,materialCatalogText} from './material-presets.js';

function setup(){
 const engine=new DrawingEngine();
 const context={engine,execute:c=>engine.execute(c),getDrawingId:()=>'one',getDrawingName:()=>'시험',selected:()=>new Set(),refresh(){}};
 const binding=createBridgeBinding(context),target={...binding.current(),backend_generation:crypto.randomUUID(),snapshot_id:crypto.randomUUID()};
 binding.receive({protocol_version:1,backend_generation:target.backend_generation,target});
 const handler=createBoundRequestHandler(context,binding);
 // AI 는 편집 전에 cad_get_document 로 도면을 다시 읽는다(target 갱신) — 시험도 부를 때마다 지금 도면을 받는다.
 const call=(action,args={})=>{const now={...binding.current(),backend_generation:target.backend_generation,snapshot_id:crypto.randomUUID()};binding.receive({protocol_version:1,backend_generation:target.backend_generation,target:now});return handler({id:crypto.randomUUID(),expires_at:Date.now()+25000,action,args:{target:now,...args}});};
 return {engine,call,revision:()=>binding.current().revision};
}
const wall=(L,a,b,c,d)=>({type:'wall',layer:L,points:[{x:a,y:b},{x:c,y:d}],thickness:200,openings:[]});

test('재료 목록: 종류마다 기본 재료가 있고, 맞지 않는 조합은 막는다', ()=>{
 for(const kind of MATERIAL_KINDS)assert.ok(resolveMaterial(kind).kinds.includes(kind),kind);
 assert.equal(new Set(MATERIAL_PRESETS.map(m=>m.id)).size,MATERIAL_PRESETS.length,'ID 중복 없음');
 assert.throws(()=>validateMaterialMap({glass:'brick-red'}),/유리/);
 assert.throws(()=>validateMaterialMap({door:'door-oak'}),/없는 부재 종류/);
 assert.equal(resolveMaterial('wall',{wall:'brick-red'},'stone-granite').id,'stone-granite','객체 재료가 먼저');
 assert.equal(resolveMaterial('wall',{wall:'brick-red'}).id,'brick-red');
 assert.equal(resolveMaterial('wall',{},'glass-clear').id,'plaster-white','종류에 안 맞는 객체 재료는 무시');
 assert.match(materialCatalogText(),/brick-red=적벽돌/);
});

test('cad_get_materials → cad_set_materials: 종류 전체·부재별, 되돌리기 한 번', ()=>{
 const {engine,call,revision}=setup();const L=engine.doc.layers[0].id;
 engine.execute({type:'addMany',entities:[wall(L,0,0,10000,0),wall(L,10000,0,10000,8000)]});
 const listed=call('cad_get_materials');assert.ok(!listed.error,listed.error);
 assert.ok(listed.result.presets.some(p=>p.id==='roof-zinc'&&p.kinds.includes('roof')));
 assert.equal(listed.result.kinds.find(k=>k.kind==='wall').current,'plaster-white');
 const [w1]=engine.doc.entities;
 const before=engine.undoStack.length;
 const set=call('cad_set_materials',{expectedRevision:revision(),materials:{wall:'brick-red',roof:'roof-zinc'},ids:[w1.id],material:'stone-granite'});
 assert.ok(!set.error,set.error);assert.equal(set.result.applied,true);
 assert.equal(engine.doc.model3d.materials.wall,'brick-red');assert.equal(engine.doc.entities[0].model3d.material,'stone-granite');
 assert.equal(engine.undoStack.length,before+1,'되돌리기 한 번');
 const bad=call('cad_set_materials',{expectedRevision:revision(),materials:{glass:'brick-red'}});assert.match(bad.error,/유리/);
 const stale=call('cad_set_materials',{expectedRevision:revision()+5,materials:{wall:null}});assert.ok(stale.error,'판 번호가 다르면 막는다');
 engine.execute({type:'undo'});assert.equal(engine.doc.model3d?.materials?.wall,undefined);
});

test('cad_delivery_check → cad_delivery_fix: 고칠 수 있는 것만 고치고 남은 것을 알린다', ()=>{
 const {engine,call,revision}=setup();const L=engine.doc.layers[0].id;
 const line=(a,b,c,d)=>({type:'line',layer:L,points:[{x:a,y:b},{x:c,y:d}]});
 engine.execute({type:'addMany',entities:[line(0,0,1000,0),line(0,0,1000,0),line(0,500,3000,505)]});
 const check=call('cad_delivery_check',{denominator:100});assert.ok(!check.error,check.error);
 const by=k=>check.result.items.find(i=>i.key===k);
 assert.equal(by('overkill').count,1);assert.equal(by('angle').count,1);assert.equal(by('overkill').fixable,true);assert.equal(by('far').fixable,false);
 const fix=call('cad_delivery_fix',{expectedRevision:revision(),keys:['overkill','angle']});assert.ok(!fix.error,fix.error);
 assert.deepEqual(fix.result.fixed.map(f=>f.key),['overkill','angle']);
 assert.ok(!fix.result.remaining.some(i=>i.key==='overkill'||i.key==='angle'));
 assert.equal(engine.doc.entities.length,2);
});

test('cad_plot_pdf: 출력 작업(job)을 만들고 나눠 찍기 옵션을 붙인다(그리기는 서버)', ()=>{
 const {engine,call}=setup();const L=engine.doc.layers[0].id;
 engine.execute({type:'addMany',entities:[wall(L,0,0,60000,0),wall(L,60000,0,60000,40000)]});
 const r=call('cad_plot_pdf',{paper:'A1',scale:100,tile:{paper:'A4',overlap:10}});assert.ok(!r.error,r.error);
 assert.equal(r.result.job.action,'plot');assert.deepEqual(r.result.job.size,[841,594]);assert.equal(r.result.job.denominator,100);
 assert.deepEqual(r.result.job.tile,{paper:'A4',overlap:10});assert.equal(r.result.applied,false);
});

test('물어보며 진행: 축척·용지를 안 줘도 도면에서 채우거나 가정을 쉬운 말로 알린다', ()=>{
 const {engine,call}=setup();const L=engine.doc.layers[0].id;
 engine.execute({type:'addMany',entities:[wall(L,0,0,60000,0)]});
 const guessed=call('cad_delivery_check');assert.ok(!guessed.error,guessed.error);
 assert.equal(guessed.result.denominator,100);assert.match(guessed.result.assumed[0].say,/1:100/);
 engine.doc.currentAnnoScale=50;
 const read=call('cad_delivery_check');assert.equal(read.result.denominator,50);assert.equal(read.result.autoFilled.denominator.from,'도면 주석 축척');
 assert.equal(call('cad_delivery_check',{denominator:200}).result.assumed,undefined,'직접 주면 가정 없음');
 const pdf=call('cad_plot_pdf');assert.match(pdf.result.assumed[0].say,/A3 용지 · 용지에 맞춘 축척/);
 assert.equal(call('cad_plot_pdf',{paper:'A1',scale:100}).result.assumed,undefined);
});

test('그림 도구(일조·내부 투시도)는 3D 모듈로 간다', ()=>{
 assert.ok(REVIEW_ACTIONS.has('cad_sun_study'));assert.ok(REVIEW_ACTIONS.has('cad_view_interior'));
});

test('Codex 검토: 잘못된 keys 는 실행하지 않고, 객체 재료는 부재 종류에 맞아야 한다', ()=>{
 const {engine,call,revision}=setup();const L=engine.doc.layers[0].id;
 const line=(a,b,c,d)=>({type:'line',layer:L,points:[{x:a,y:b},{x:c,y:d}]});
 engine.execute({type:'addMany',entities:[line(0,0,1000,0),line(0,0,1000,0),wall(L,0,1000,5000,1000)]});
 const bad=call('cad_delivery_fix',{expectedRevision:revision(),keys:'do-not-overkill'});assert.ok(bad.error);assert.equal(engine.doc.entities.length,3,'아무것도 지우지 않음');
 const w=engine.doc.entities.find(e=>e.type==='wall');
 assert.throws(()=>engine.execute({type:'model3d.set',ids:[w.id],changes:{material:'glass-clear'}}),/쓸 수 없습니다/);
 engine.execute({type:'model3d.set',ids:[w.id],changes:{material:'brick-red'}});assert.equal(engine.doc.entities.find(e=>e.id===w.id).model3d.material,'brick-red');
});

test('앱 안 AI 실행 모드: materials_set · delivery_fix 행동', async ()=>{
 const {parseActions,stageActions,actionContext}=await import('./ai-actions.js');
 const engine=new DrawingEngine();const L=engine.doc.layers[0].id;
 engine.execute({type:'addMany',entities:[wall(L,0,0,5000,0),{type:'line',layer:L,points:[{x:0,y:900},{x:900,y:900}]},{type:'line',layer:L,points:[{x:0,y:900},{x:900,y:900}]}]});
 const ctx=actionContext(engine.doc,new Set(),L,[]);assert.ok(ctx.materials3d.kinds.find(k=>k.kind==='wall').choices.includes('brick-red=적벽돌'));
 const plan=parseActions(JSON.stringify({actions:[{cmd:'materials_set',args:{materials:{wall:'brick-red',roof:'roof-zinc'}}},{cmd:'delivery_fix',args:{keys:['overkill']}}],ask:null,note:null}));
 const staged=stageActions(engine,plan,{activeLayer:L});
 assert.equal(staged.document.model3d.materials.wall,'brick-red');assert.equal(staged.document.entities.length,2,'중복 선 하나 지움');
 assert.throws(()=>stageActions(engine,parseActions(JSON.stringify({actions:[{cmd:'materials_set',args:{materials:{glass:'brick-red'}}}],ask:null,note:null})),{activeLayer:L}),/유리/);
});

test('비스듬한 벽도 무늬가 실제 크기(UV = 벽 방향 거리 m)', async ()=>{
 const {buildReviewModel}=await import('./review-3d.js');
 const engine=new DrawingEngine();const L=engine.doc.layers[0].id;
 engine.execute({type:'addMany',entities:[wall(L,0,0,10000,10000)]});
 const model=buildReviewModel(engine.doc,{floor:3000,autoSlabs:false,autoRoof:false});
 let maxU=0;model.group.traverse(o=>{if(o.isMesh&&o.userData.kind==='wall'){const uv=o.geometry.getAttribute('uv');for(let i=0;i<uv.count;i++)maxU=Math.max(maxU,Math.abs(uv.getX(i)));}});
 assert.ok(maxU>14&&maxU<14.5,'벽 길이 14.14 m 만큼: '+maxU);
});
