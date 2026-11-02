import test from 'node:test';import assert from 'node:assert/strict';
import {DrawingEngine} from './engine.js';import {parseActions,stageActions,actionContext,importParcelAction,directParcelRequest,libraryFirstRequest,assertLibraryFirst} from './ai-actions.js';
const plan=actions=>parseActions(JSON.stringify({actions,ask:null,note:null}));
test('room request action fixture creates four walls with thickness 200',()=>{
 const e=new DrawingEngine(),before=JSON.stringify(e.doc);const ps=[{x:0,y:0},{x:10000,y:0},{x:10000,y:6000},{x:0,y:6000},{x:0,y:0}];
 const result=stageActions(e,plan([{cmd:'wall',args:{pts:ps,thickness:200}}]));
 assert.equal(result.document.entities.length,4);assert.ok(result.document.entities.every(e=>e.thickness===200));assert.equal(result.summary,'실행: 벽 4개');assert.equal(JSON.stringify(e.doc),before);
 e.execute({type:'load',document:result.document});e.execute({type:'undo'});assert.equal(JSON.stringify(e.doc),before);
});
test('selected copy goes right 3000; error and ask leave source untouched',()=>{
 const e=new DrawingEngine();const ids=e.execute({type:'addMany',entities:[{type:'line',layer:'default',points:[{x:0,y:0},{x:100,y:0}]}]});const before=JSON.stringify(e.doc),undo=e.undoStack.length;
 const result=stageActions(e,plan([{cmd:'copy',args:{dx:3000,dy:0}}]),{selected:ids});assert.equal(result.document.entities[1].points[0].x,3000);
 assert.throws(()=>stageActions(e,plan([{cmd:'copy',args:{dx:3000,dy:0}},{cmd:'circle',args:{center:{x:0,y:0},radius:-1}}]),{selected:ids}));
 assert.deepEqual(stageActions(e,{actions:[{cmd:'delete',args:{}}],ask:'DXF 저장/축척 변경/블록 분해 중 무엇?',note:null}),{ask:'DXF 저장/축척 변경/블록 분해 중 무엇?'});
 assert.equal(JSON.stringify(e.doc),before);assert.equal(e.undoStack.length,undo);
 const c=actionContext(e.doc,new Set(ids),'default',['1','2','3','4','5','6']);assert.equal(c.selection.count,1);assert.equal(c.recentCommands.length,5);
});
test('strict JSON contract rejects prose and unknown commands',()=>{assert.throws(()=>parseActions('```json\n{}\n```'));assert.throws(()=>parseActions('{}'));assert.throws(()=>plan([{cmd:'shell',args:{}}]));});

test('standalone parcel requests route to real lookup; questions and compound design remain with AI',()=>{
 assert.equal(directParcelRequest('대지 가져와').actions[0].args.query,'');
 assert.equal(directParcelRequest('부산 사리로 64-1 대지 가져와').actions[0].args.query,'부산 사리로 64-1');
 assert.equal(directParcelRequest('왜 대지 가져오기가 안돼?'),null);
 assert.equal(directParcelRequest('부산 대지 가져와 그리고 설계해'),null);
 assert.equal(directParcelRequest('대지 가져오지 마'),null);
 assert.equal(plan([{cmd:'parcel_import',args:{query:'주소'}}]).actions[0].cmd,'parcel_import');
});
test('parcel import uses resolved PNU and returned geometry exactly once',async()=>{
 const entities=[{type:'polyline',points:[{x:0,y:0},{x:10,y:0},{x:0,y:10}],closed:true,parcelRole:'site'}];const calls=[];let committed;
 const result=await importParcelAction({query:'테스트 주소'},{api:async(_,a)=>{calls.push(a);return a.action==='status'?{connected:true}:a.action==='search'?{results:[{pnu:'1234567890123456789',jibunAddress:'테스트 주소'}]}:{entities};},unchanged:()=>true,open:()=>assert.fail('unexpected prompt'),commit:es=>committed=es});
 assert.equal(calls[2].pnu,'1234567890123456789');assert.equal(committed,entities);assert.match(result,/추가했습니다/);
});
test('missing address, login, ambiguous address, stale document never import',async()=>{
 for(const scenario of ['empty','login','ambiguous','stale']){
  let opened=false,commits=0;
  const options={api:async(_,a)=>a.action==='status'?{connected:scenario!=='login'}:a.action==='search'?{results:(scenario==='ambiguous'?['1234567890123456789','2234567890123456789']:['1234567890123456789']).map(pnu=>({pnu}))}:{entities:[{}]},unchanged:()=>scenario!=='stale',open:()=>{opened=true;},commit:()=>commits++};
  if(scenario==='stale')await assert.rejects(()=>importParcelAction({query:'주소'},options),/도면이 변경/);
  else await importParcelAction({query:scenario==='empty'?'':'주소'},options);
  assert.equal(commits,0);assert.equal(opened,scenario!=='stale');
 }
});

test('AI가 실 이름 문자를 도면에 넣을 수 있다',()=>{
 // 회귀: text 명령이 없던 동안 AI는 평면을 그리고도 실명을 통째로 빼고 "지원 명령에 없어 제외했다"고 답했다.
 const e=new DrawingEngine();
 const result=stageActions(e,plan([{cmd:'text',args:{position:{x:2000,y:1500},text:'거실',height:250,align:'center'}}]));
 const made=result.document.entities.at(-1);
 assert.equal(made.type,'text');assert.equal(made.text,'거실');assert.equal(made.height,250);
 assert.equal(made.align,'center');assert.deepEqual(made.position,{x:2000,y:1500});
 assert.throws(()=>stageActions(e,plan([{cmd:'text',args:{position:{x:0,y:0},text:'  ',height:250}}])));
 assert.throws(()=>stageActions(e,plan([{cmd:'text',args:{position:{x:0,y:0},text:'거실',height:0}}])));
});

test('A30: AI 대지 가져오기도 계획 탭과 같은 EPSG:5187 로 받고, 도면 원점(drawingGeo)을 함께 넣는다',async()=>{
 const entities=[{type:'polyline',points:[{x:0,y:0},{x:10,y:0},{x:0,y:10}],closed:true,parcelRole:'site'}],drawingGeo={crs:'EPSG:5187',originM:[1,2],unit:'mm',rotationDeg:0};const calls=[];let committed;
 const api=async(_,a)=>{calls.push(a);return a.action==='status'?{connected:true}:a.action==='search'?{results:[{pnu:'1234567890123456789',jibunAddress:'주소'}]}:{entities,drawingGeo};};
 await importParcelAction({query:'주소'},{api,unchanged:()=>true,open:()=>assert.fail('unexpected prompt'),commit:(es,geo)=>committed={es,geo}});
 assert.equal(calls[2].crs,'EPSG:5187');assert.equal(calls[2].originM,undefined,'도면에 원점이 없으면 새로 잡는다');assert.deepEqual(committed.geo,drawingGeo);
 await importParcelAction({query:'주소'},{api,unchanged:()=>true,open:()=>assert.fail('unexpected prompt'),commit:()=>{},geo:{crs:'EPSG:5187',originM:[5,6]}});
 assert.deepEqual(calls.at(-1).originM,[5,6],'이미 지적이 있는 도면은 같은 원점으로 받아 겹친다');
});

test('library first: old actions send drawn shape kinds and layer names to the engine table',async()=>{
 const e=new DrawingEngine();e.execute({type:'layer.add',name:'A-DOOR',color:'#ffff00'});const door=e.doc.layers.at(-1).id,zero=e.doc.layers[0].id;
 // test_library_first.py test_app_old_actions_use_same_table_and_evidence 와 같은 모양
 const p=plan([{cmd:'wall',args:{pts:[{x:0,y:0},{x:3000,y:0}],thickness:200}},{cmd:'layer_set',args:{layer:door}},{cmd:'line',args:{pts:[{x:0,y:0},{x:900,y:0}]}},
  {cmd:'rect',args:{origin:{x:0,y:0},width:1,height:1,layer:zero,library_check:{command:'WALDRAW',reason:'곡선 벽이라 직선 벽 명령으로 못 그림'}}},{cmd:'move',args:{dx:1,dy:0}}]);
 assert.deepEqual(libraryFirstRequest(e.doc,p,{activeLayer:zero}),{entities:[{type:'wall',layer:'0'},{type:'line',layer:'A-DOOR'},{type:'rectangle',layer:'0'}],library_check:[{command:'WALDRAW',reason:'곡선 벽이라 직선 벽 명령으로 못 그림'}]});
 assert.equal(libraryFirstRequest(e.doc,plan([{cmd:'move',args:{dx:1,dy:0}},{cmd:'architecture',args:{command:'DOD',options:{x:0,y:0}}}])),null);
 const calls=[],blocked=[{intent:'door',label:'문',candidates:[{command:'D1'},{command:'DOOR2'}]}];
 await assert.rejects(assertLibraryFirst(async(...a)=>{calls.push(a);return {blocked,message:'리습 먼저: 문: D1'};},e.doc,p,{activeLayer:zero}),error=>error.code==='library_first'&&error.blocked===blocked&&/D1/.test(error.message));
 assert.equal(calls[0][0],'chat');assert.equal(calls[0][1].action,'libraryFirst');assert.equal(calls[0][1].entities.length,3);
 await assertLibraryFirst(async()=>({blocked:[]}),e.doc,p,{activeLayer:zero});
 let asked=false;await assertLibraryFirst(async()=>{asked=true;},e.doc,plan([{cmd:'delete',args:{}}]));assert.equal(asked,false);  // 그리지 않으면 묻지도 않는다
 // 통과해도 library_check 는 도형에 섞이지 않는다
 assert.equal(stageActions(e,p,{activeLayer:zero}).document.entities.some(x=>'library_check' in x),false);
});
