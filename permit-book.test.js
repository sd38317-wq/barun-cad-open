import test from 'node:test';
import assert from 'node:assert/strict';
import {DrawingEngine} from './engine.js';
import {createBoundRequestHandler,createBridgeBinding,prepareComputeRequest} from './bridge-client.js';
import {facilityDeclaration,sheetGroups,permitFloors,permitSettings,energyPlanForAI} from './permit-book.js';

const door={id:'door',checks:[{name:'통과유효폭',field:'clearWidth',op:'>=',limit:900,unit:'mm'},{name:'문턱',field:'step',op:'<=',limit:20,unit:'mm'}]};
test('④ 시설 확인: 설치·실측값만 넘기고 빈 칸은 넣지 않는다',()=>{
 assert.deepEqual(facilityDeclaration(door,{installed:'',values:{clearWidth:'',step:''}}),{});
 assert.deepEqual(facilityDeclaration(door,{installed:'yes',values:{clearWidth:'950',step:''}}),{installed:true,values:{clearWidth:950},verified:true});
 assert.deepEqual(facilityDeclaration(door,{installed:'no',values:{}}),{installed:false});
 // 실측 칸이 있는 시설은 '설치함'만으로 확인(verified)으로 보지 않는다 — 적정은 실측값이 있어야
 assert.equal(facilityDeclaration(door,{installed:'yes',values:{}}).verified,undefined);
 assert.equal(facilityDeclaration({id:'guidance',checks:[]},{installed:'yes'}).verified,true);
});
test('④ 기울기는 1/□ 분모로 받고(0 = 평지), 조건 체크는 실측값과 함께 넣는다',()=>{
 const route={id:'route',checks:[{name:'유효폭',field:'width',op:'>=',limit:1200,unit:'mm'},{name:'기울기',field:'slope',op:'<=',limit:1/18,alternative:{when:{terrainDifficult:true}}}]};
 assert.deepEqual(facilityDeclaration(route,{installed:'yes',values:{width:'1500',slope:'24'},flags:{terrainDifficult:true}}),{installed:true,values:{width:1500,slope:1/24,terrainDifficult:true},verified:true});
 assert.equal(facilityDeclaration(route,{values:{width:'',slope:'0'}}).values.slope,0);
 assert.deepEqual(facilityDeclaration(route,{values:{width:'',slope:'-3'},flags:{terrainDifficult:true}}),{});
});
test('⑦ 도서 목록: 같은 이름이 이어지는 상세 시트는 한 줄',()=>{
 assert.deepEqual(sheetGroups([{number:'AC-002',title:'설치 검토서'},{number:'AC-301',title:'편의시설 상세도'},{number:'AC-302',title:'편의시설 상세도'},{number:'AC-303',title:'편의시설 상세도'}]),
  [['AC-002','설치 검토서'],['AC-301~303','편의시설 상세도 3장']]);
});
test('③ 층 범위는 에너지 영역의 층을 같이 쓴다(아래층부터, 다른 영역은 뺌)',()=>{
 const b=(x)=>({minX:x,minY:0,maxX:x+10,maxY:10});
 const doc={reviewSettings:{energyPlanRegions:[{kind:'floor',floor:2,label:'2층',key:'floor:2',bounds:b(30)},{kind:'overview',label:'개요',key:'overview',bounds:b(0)},{kind:'floor',floor:1,label:'1층',key:'floor:1',bounds:b(0)}],permitBook:{overview:{name:'가'}}}};
 assert.deepEqual(permitFloors(doc).map(f=>f.name),['1층','2층']);
 const s=permitSettings(doc);s.overview.name='나';assert.equal(doc.reviewSettings.permitBook.overview.name,'가');   // 복사본
});

test('AI 도구 cad_energy_plan: ⑥ 확정 전에는 만들지 않고 창에서 할 일을 묻는다, 확정 뒤 build 면 창과 같은 요청을 보낸다',async()=>{
 const calls=[],api=async(route,data)=>{calls.push([route,data.action,data.drawingPath]);return {dxf:'a.dxf',pdf:'a.pdf',sheets:15};};
 const before=await energyPlanForAI({entities:[],layers:[]},{api,build:true,autofill:false});
 assert.equal(before.built,false);assert.equal(before.needs[0].key,'confirm');assert.ok(before.missing.length>0);assert.equal(calls.length,0);
 const doc={entities:[],layers:[],reviewSettings:{permitBook:{energy:{confirmedAt:'2026-10-27T05:00:00Z'}}}};
 assert.equal((await energyPlanForAI(doc,{api})).built,false);assert.equal(calls.length,0);
 const r=await energyPlanForAI(doc,{api,build:true,drawingPath:'/x/집.dxf'});
 assert.equal(r.built,true);assert.equal(r.sheets,15);assert.deepEqual(calls,[['permit-book','energy-build','/x/집.dxf']]);
});

test('AI 다리: cad_energy_plan 요청이 에너지 도서로 이어지고 도면·되돌리기는 그대로',async()=>{
 const engine=new DrawingEngine();engine.execute({type:'review.settings',settings:{permitBook:{energy:{confirmedAt:'2026-10-27T05:00:00Z'}}}});
 const calls=[],context={engine,execute:c=>engine.execute(c),getDrawingId:()=>'drawing',selected:()=>new Set(),refresh(){},getDrawingPath:()=>'/x/집.dxf',api:async(route,data)=>{calls.push([route,data.action,data.drawingPath]);return {pdf:'a.pdf',sheets:15};}};
 const binding=createBridgeBinding(context),target={...binding.current(),backend_generation:crypto.randomUUID(),snapshot_id:crypto.randomUUID()};
 binding.receive({protocol_version:1,backend_generation:target.backend_generation,target});
 const sync=createBoundRequestHandler(context,binding),call=async args=>{const r={id:crypto.randomUUID(),expires_at:Date.now()+10000,action:'cad_energy_plan',args:{target,...args}};return sync(r,await prepareComputeRequest(context,binding,r));};
 const before=structuredClone(engine.doc),undo=engine.undoStack.length;
 const check=await call({autofill:false});assert.equal(check.error,undefined);assert.equal(check.result.built,false);assert.equal(calls.length,0);
 const out=await call({build:true});assert.equal(out.error,undefined);assert.equal(out.result.built,true);assert.equal(out.result.sheets,15);
 assert.deepEqual(calls,[['permit-book','energy-build','/x/집.dxf']]);assert.deepEqual(engine.doc,before);assert.equal(engine.undoStack.length,undo);
});

// 2026-10-30 대표 "필요한 도면은 자기가 찾아 넣어야": 확정 전이면 미리가 도면(건축개요 글자·한 벌 평면/창호도 장·기본 형별)에서 채워 초안으로 저장하고, build 는 초안 도서
const T=(text,x,y,h=250)=>({id:crypto.randomUUID(),type:'text',text,position:{x,y},height:h,layer:'0'});
const box=(minX,minY,maxX,maxY)=>({minX,minY,maxX,maxY});
function generatedSet(){
 const model={stories:[{id:'s1',name:'1F',elevation:0,height:3000},{id:'s2',name:'2F',elevation:3000,height:3200},{id:'rf',name:'옥상층',elevation:6200,height:1000}],elements:[]};
 return {entities:[T('건 축 개 요',0,10000,400),T('공 사 명',0,9000),T('괴정동 근린생활시설',4000,9000),T('대지위치',0,8500),T('부산광역시 사하구 괴정동 213-17',4000,8500)],layers:[{id:'0',name:'0'}],
  drawingSets:{'ds-1':{kind:'set',model}},
  sheets:[{id:'ds-1-sheet-A-101',kind:'plan',stories:['s1'],bounds:box(50000,0,92000,29700),drawingSet:'ds-1'},{id:'ds-1-sheet-A-102',kind:'plan',stories:['s2'],bounds:box(100000,0,142000,29700),drawingSet:'ds-1'},
   {id:'ds-1-sheet-A-103',kind:'plan',stories:['rf'],bounds:box(150000,0,192000,29700),drawingSet:'ds-1'},{id:'ds-1-sheet-A-601',kind:'schedule',bounds:box(50000,-40000,92000,-10300),drawingSet:'ds-1'}]};
}
const energyApi=calls=>async(route,data)=>{calls.push(data.action);
 if(data.action==='energy-region')return {region:/부산/.test(data.overview?.address)?'south':null,label:'남부'};
 if(data.action==='energy-defaults')return {assemblies:{W1:{layers:[['콘크리트',200,1.6]]},R1:{layers:[['콘크리트',200,1.6]]},F1:{layers:[['콘크리트',200,1.6]]},openings:{G1:{U:1.5},D1:{U:1.8}}},details:['std:A'],section:{}};
 if(data.action==='energy-build')return {dxf:'a_초안.dxf',pdf:'a_초안.pdf',sheets:15,draft:data.draft===true};
 throw Error('모르는 요청 '+data.action);};
test('AI 도구 cad_energy_plan: 확정 전이면 도면에서 ①~⑤를 스스로 채워 초안(가정)으로, build 는 초안 도서',async()=>{
 const calls=[],doc=generatedSet(),r=await energyPlanForAI(doc,{api:energyApi(calls)});
 assert.equal(r.confirmed,false);assert.equal(r.draft,true);assert.deepEqual(r.missing,[]);assert.equal(r.needs,undefined);assert.equal(r.built,false);
 assert.ok(r.assumed.length>=5&&r.assumed.every(x=>typeof x==='string'));assert.ok(r.assumed.some(x=>/남부/.test(x)));
 const s=r.settings,e=s.permitBook.energy;
 assert.equal(s.permitBook.overview.name,'괴정동 근린생활시설');assert.equal(s.permitBook.overview.address,'부산광역시 사하구 괴정동 213-17');
 assert.equal(e.region,'south');assert.equal(e.confirmedAt,undefined);assert.ok(e.draftAt);assert.ok(e.assemblies.W1);
 assert.deepEqual(s.energyPlanRegions.filter(x=>x.kind==='floor').map(x=>[x.label,x.bounds.minX]),[['1층',50000],['2층',100000]]);   // 옥상층은 뺌
 assert.deepEqual(s.energyPlanRegions.filter(x=>x.kind==='window_schedule').map(x=>x.bounds.minY),[-40000]);
 assert.deepEqual([e.floors['1층'].height,e.floors['2층'].height],[3,3.2]);
 assert.equal(doc.reviewSettings,undefined);   // 받은 도면은 그대로(저장은 다리가 review.settings 한 번)
 const b=await energyPlanForAI(doc,{api:energyApi(calls),build:true});
 assert.equal(b.built,true);assert.equal(b.draft,true);assert.equal(b.confirmed,false);assert.match(b.pdf,/초안/);assert.ok(calls.includes('energy-build'));
 // 설계자가 이미 넣은 값·고른 영역은 덮지 않는다
 const mine=generatedSet();mine.reviewSettings={permitBook:{energy:{region:'central2'}},energyPlanRegions:[{kind:'floor',floor:1,key:'floor:1',label:'1층',bounds:box(0,0,10,10)}]};
 const m=(await energyPlanForAI(mine,{api:energyApi([])})).settings;
 assert.equal(m.permitBook.energy.region,'central2');assert.deepEqual(m.energyPlanRegions.filter(x=>x.kind==='floor').map(x=>x.bounds.maxX),[10]);
});
test('AI 도구 cad_energy_plan 초안: 연면적·주용도도 도면에서 채운다 — 비면 도서 만들기가 연면적 없음으로 깨졌다(2026-11-02)',async()=>{
 const doc=generatedSet();doc.entities.push(T('연 면 적',0,8000),T('101.63㎡',4000,8000),T('용도',0,7500),T('단독주택',4000,7500));
 const ov=(await energyPlanForAI(doc,{api:energyApi([])})).settings.permitBook.overview;
 assert.equal(Number(ov.gfa),101.63);assert.equal(ov.mainUse,'단독주택');
 const fromSet=generatedSet();fromSet.drawingSets['ds-1'].model.building={use:'단독주택'};
 assert.equal((await energyPlanForAI(fromSet,{api:energyApi([])})).settings.permitBook.overview.mainUse,'단독주택');
});
test('AI 도구 cad_energy_plan 초안: 지운 옛 한 벌의 주소·이름은 쓰지 않는다 — 단층 주택에 괴정(부산) 지역이 들어갔다(2026-11-02)',async()=>{
 const doc=generatedSet();doc.entities=doc.entities.filter(t=>!/대지위치|부산|공 사 명|괴정/.test(t.text));
 doc.drawingSets={'ds-0':{kind:'set',model:{...doc.drawingSets['ds-1'].model,building:{name:'괴정동 사리로 상가주택',address:'부산 사하구 사리로 64-1'}}},'ds-1':{...doc.drawingSets['ds-1'],model:{...doc.drawingSets['ds-1'].model,building:{name:'단층 단독주택'}}}};
 doc.sheets.push({id:'ds-0-sheet-A-101',kind:'plan',stories:['s1'],bounds:box(0,0,1,1),drawingSet:'ds-0'});
 const r=await energyPlanForAI(doc,{api:energyApi([])});
 assert.equal(r.settings.permitBook.overview.name,'단층 단독주택');assert.equal(r.settings.permitBook.energy.region,undefined);
 assert.ok(!r.assumed.some(x=>/부산|괴정/.test(x)),r.assumed.join(' / '));
});
test('AI 다리: 확정 전 cad_energy_plan 은 채운 초안을 도면에 한 번 저장(되돌리기 됨), 창에서 보고 고쳐 확정할 수 있다',async()=>{
 const engine=new DrawingEngine();const g=generatedSet();engine.doc={...engine.doc,drawingSets:g.drawingSets,sheets:g.sheets,entities:g.entities.map(t=>({...t,layer:engine.doc.layers[0].id}))};
 const calls=[],context={engine,execute:c=>engine.execute(c),getDrawingId:()=>'drawing',selected:()=>new Set(),refresh(){},getDrawingPath:()=>'/x/집.dxf',api:energyApi(calls)};
 const binding=createBridgeBinding(context),target={...binding.current(),backend_generation:crypto.randomUUID(),snapshot_id:crypto.randomUUID()};
 binding.receive({protocol_version:1,backend_generation:target.backend_generation,target});
 const sync=createBoundRequestHandler(context,binding),r={id:crypto.randomUUID(),expires_at:Date.now()+10000,action:'cad_energy_plan',args:{target}};
 const out=sync(r,await prepareComputeRequest(context,binding,r)),undo=engine.undoStack.length;
 assert.equal(out.error,undefined);assert.equal(out.result.draft,true);assert.equal(out.result.settings,undefined);assert.equal(out.result.saved,true);assert.equal(out.result.applied,false);
 const e=permitSettings(engine.doc).energy;assert.equal(e.region,'south');assert.ok(e.draftAt);assert.equal(e.confirmedAt,undefined);
 assert.equal(engine.doc.reviewSettings.energyPlanRegions.filter(x=>x.kind==='floor').length,2);
 engine.execute({type:'undo'});assert.equal(permitSettings(engine.doc).energy,undefined);assert.ok(engine.undoStack.length<undo);
});

test('개요 대지위치에 시·도가 없으면 불러온 지적 주소로 지역을 정한다(괴정 시험 2026-10-30)',async()=>{
 const doc=generatedSet();doc.entities=doc.entities.map(t=>t.text==='부산광역시 사하구 괴정동 213-17'?{...t,text:'괴정동 213-17·213-18 / 사리로 64-1'}:t);
 doc.entities.push({id:'site',type:'polyline',closed:true,points:[],layer:'0',parcelRole:'site',attributes:{landInfo:{address:'부산광역시 사하구 괴정동 213-17'}}});
 const r=await energyPlanForAI(doc,{api:energyApi([])});
 assert.equal(r.settings.permitBook.energy.region,'south');assert.equal(r.needs,undefined);assert.ok(r.assumed.some(x=>/남부/.test(x)&&/부산광역시/.test(x)));
});
