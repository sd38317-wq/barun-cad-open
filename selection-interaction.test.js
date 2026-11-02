import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import * as G from './geometry.js';
import {crossing} from './view.js';
import {visibilityCacheKeys} from './viewport-visibility.js';
const source=fs.readFileSync(new URL('./app.js',import.meta.url),'utf8');
function selection(){
 const entities=[{id:'a',type:'line',points:[{x:10,y:10},{x:20,y:20}]},{id:'b',type:'line',points:[{x:50,y:50},{x:60,y:60}]}];
 const context={selected:new Set(),phase:'select',mode:'ERASE',G,crossing,performance,safe:Object.assign(fn=>fn(),{lastError:null}),interaction:{accepts:()=>true},inputState:()=>'',traceInput(){},scheduleEngineUiRefresh(){},localPoint:e=>e,world:p=>p,editable:()=>entities,pick:p=>entities.find(e=>G.entityDistance(e,p)<2),refresh(){},render(){},drag:null};
 vm.createContext(context);
 const begin=source.indexOf('canvas.addEventListener("pointerup", (e) => {');
 const end=source.indexOf('canvas.addEventListener("pointercancel"',begin);
 context.canvas={addEventListener:(event,fn)=>context.up=fn,hasPointerCapture:()=>false,releasePointerCapture(){}};vm.runInContext(source.slice(begin,end),context);
 context.box=(start,end,shift=false)=>{context.drag={kind:'selection',start,shift};context.up(end);};return context;
}
test('ERASE accumulates separate windows, empty windows preserve selection, Shift removes',()=>{
 const c=selection();c.box({x:0,y:0},{x:30,y:30});c.box({x:40,y:40},{x:70,y:70});assert.deepEqual([...c.selected],['a','b']);c.box({x:80,y:80},{x:90,y:90});assert.equal(c.selected.size,2);c.box({x:0,y:0},{x:30,y:30},true);assert.deepEqual([...c.selected],['b']);
});
test('right-to-left crossing selects intersected objects',()=>{const c=selection();c.box({x:17,y:0},{x:13,y:30});assert.deepEqual([...c.selected],['a']);});
test('명령 선택의 첫 클릭은 1px 흔들려도 두 번째 모서리를 기다린다',()=>{
 const c=selection();
 c.drag={kind:'selection',start:{x:0,y:0},threshold:.5};
 c.up({x:1,y:0});
 assert.equal(c.drag?.awaitingCorner,true);
 assert.equal(c.selected.size,0);
 c.drag.secondCorner=true;
 c.up({x:30,y:30});
 assert.deepEqual([...c.selected],['a']);
 assert.equal(c.drag,null);
});
test('narrow crossing window selects through the middle of text',()=>{
 const text={type:'text',text:'ABCD',position:{x:0,y:0},height:100};
 assert.equal(crossing(text,{minX:120,maxX:130,minY:-10,maxY:110}),true);
});
test('Space confirms active command without activating pan; repeated key is ignored',()=>{
 const begin=source.indexOf('  if (key === " ") {',source.indexOf('document.addEventListener("keydown"'));
 const end=source.indexOf('  if (key === "ENTER")',begin);let calls=0;const c={key:' ',mode:'ERASE',space:false,e:{repeat:false,preventDefault(){}},safe:fn=>fn(),finish:()=>calls++};vm.createContext(c);const run=()=>vm.runInContext('(function(){'+source.slice(begin,end)+'})()',c);run();assert.equal(calls,1);assert.equal(c.space,false);c.e.repeat=true;run();assert.equal(calls,1);
});

test('empty click keeps window until second corner and then selects',()=>{const c=selection();c.box({x:30,y:0},{x:30,y:0});assert.equal(c.drag.awaitingCorner,true);c.drag.secondCorner=true;c.up({x:0,y:30});assert.deepEqual([...c.selected],['a']);assert.equal(c.drag,null);});
test('Escape cancellation clears selection and pending window without editing document',()=>{
 const begin=source.indexOf('function reset() {'),end=source.indexOf('function requireSelection()',begin);
 const c={clearOverlapSelection(){},run(){},selected:new Set(['a','b']),drag:{kind:'selection',awaitingCorner:true},space:true,mode:'ERASE',phase:'select',points:[{x:1,y:2}],params:{},$:()=>({value:'E'}),updatePrompt(){},render(){},refresh(){}};
 vm.createContext(c);vm.runInContext(source.slice(begin,end)+';cancelSelection();',c);
 assert.equal(c.selected.size,0);assert.equal(c.drag,null);assert.equal(c.space,false);assert.equal(c.mode,'SELECT');assert.equal(c.phase,'idle');assert.equal(c.points.length,0);
});
test('3D mass includes wall thickness only and excludes ordinary drawing objects',()=>{
 const begin=source.indexOf('function massFootprints('),end=source.indexOf('function installMassView',begin);const c={G};vm.createContext(c);vm.runInContext(source.slice(begin,end),c);
 const wall={type:'wall',points:[{x:0,y:0},{x:5000,y:0}],thickness:200,openings:[]};const other={type:'rectangle',points:G.rectangle({x:0,y:0},{x:10000,y:10000})};
 const result=c.massFootprints([wall,other,{type:'circle',center:{x:0,y:0},radius:100}]);assert.equal(result.length,1);assert.equal(Math.abs(G.polygonArea(result[0])),1000000);assert.equal(c.massFootprints([other]).length,0);
});
test('DXF inference pairs parallel wall edges but excludes broad room outline and other layers',()=>{
 const begin=source.indexOf('function inferLayerWalls('),end=source.indexOf('function installMassView',begin);const c={G};vm.createContext(c);vm.runInContext(source.slice(begin,end),c);
 const line=(y,layer='wall')=>({type:'line',layer,points:[{x:0,y},{x:5000,y}]});
 const entities=[line(0),line(200),line(400,'dimension'),{type:'rectangle',layer:'wall',points:G.rectangle({x:0,y:0},{x:5000,y:5000})}];
 const result=c.inferLayerWalls(entities,new Set(['wall']));assert.equal(result.length,1);assert.equal(Math.abs(G.polygonArea(result[0])),1000000);
 assert.equal(c.inferLayerWalls(entities,new Set()).length,0);
});
test('콘크리트 벽을 해치로 그린 도면: 얇은 해치 경계는 벽, 넓은 실 채움은 벽이 아니다',()=>{
 const begin=source.indexOf('function inferLayerWalls('),end=source.indexOf('function installMassView',begin);const c={G};vm.createContext(c);vm.runInContext(source.slice(begin,end),c);
 const wall={type:'hatch',layer:'con',solid:true,points:G.rectangle({x:0,y:0},{x:6000,y:200}),loops:[G.rectangle({x:0,y:1000},{x:200,y:4000})]};
 const room={type:'hatch',layer:'con',solid:true,points:G.rectangle({x:0,y:0},{x:5000,y:5000})};
 const result=c.inferLayerWalls([wall,room],new Set(['con']));
 assert.equal(result.length,2);assert.deepEqual(Array.from(result,r=>Math.abs(G.polygonArea(r))).sort((a,b)=>a-b),[600000,1200000]);
});
test('automatic layer selection recognizes CON and unnamed wall patterns, excludes furniture and leaders',()=>{
 const begin=source.indexOf('function classifyWallLayer('),end=source.indexOf('function installMassView',begin);const c={G};vm.createContext(c);vm.runInContext(source.slice(begin,end),c);
 const polygons=[0,1000,2000].map(y=>G.rectangle({x:0,y},{x:5000,y:y+200})),es=Array.from({length:6},()=>({type:'line'}));
 assert.equal(c.classifyWallLayer('CON',es,polygons).auto,true);assert.equal(c.classifyWallLayer('PLAN-3',es,polygons).auto,true);
 for(const name of ['LEADER','FUR-1','TEXT','단열재'])assert.equal(c.classifyWallLayer(name,es,polygons).auto,false);
 assert.equal(c.classifyWallLayer('PLAN',es,polygons.slice(0,1)).auto,false);assert.equal(c.classifyWallLayer('CON',es,[]).auto,false);
});
test('rapid render requests coalesce into one frame and later updates still paint',()=>{
 const begin=source.indexOf('let renderPending = false;'),end=source.indexOf('function paintFrame()',begin);const queue=[];let frames=0;const c={requestAnimationFrame:fn=>queue.push(fn),paintFrame:()=>frames++};vm.createContext(c);vm.runInContext(source.slice(begin,end),c);for(let i=0;i<100;i++)c.render();assert.equal(queue.length,1);queue.shift()();assert.equal(frames,1);c.render();queue.shift()();assert.equal(frames,2);
});

test('direct canvas selection revisions notify review rows once and resolve persistent IDs',()=>{
 const begin=source.indexOf('let renderPending = false;'),end=source.indexOf('function paintFrame()',begin),queue=[],calls=[],entities=[];
 const c={requestAnimationFrame:fn=>queue.push(fn),paintFrame(){},liveCheck:{selectionChanged:(ids,reviewIds)=>calls.push({ids,reviewIds})},selectionRevision:1,selected:new Set(['o']),engine:{doc:{entities}},entitiesById:(es,ids)=>{assert.equal(es,entities);return [...ids].map(id=>({id,reviewObjectId:'D-01'}));}};vm.createContext(c);vm.runInContext(source.slice(begin,end),c);
 c.render();c.render();assert.equal(calls.length,1);assert.deepEqual([...calls[0].ids],['o']);assert.deepEqual([...calls[0].reviewIds],['D-01']);c.selected.clear();c.selectionRevision++;c.render();assert.equal(calls.length,2);assert.equal(calls[1].ids.length,0);
});
test('heavy drawing visibility cache refreshes at every zoom and within padded pan distance',()=>{
 const base={heavy:true,scale:.125,viewMoving:false,a:{x:0,y:0},b:{x:8000,y:6000},width:1000,height:750};
 const first=visibilityCacheKeys(base);
 assert.notEqual(visibilityCacheKeys({...base,scale:.126}).scaleKey,first.scaleKey,'nearby zoom levels must not share collapsed block detail');
 const panStep=40/base.scale;
 assert.notEqual(visibilityCacheKeys({...base,a:{x:base.a.x+panStep,y:0},b:{x:base.b.x+panStep,y:6000}}).viewportKey,first.viewportKey,'pan cache must refresh before the 80px query padding is exhausted');
 assert.deepEqual(visibilityCacheKeys({...base,heavy:false}),{scaleKey:0,viewportKey:''});
});

test('대형 도면 pan 뒤에는 이전 화면 pick 인덱스를 승격하지 않고 새 화면 후보를 만든다',()=>{
 const a={id:'A',type:'line',layer:'default',points:[{x:100,y:-100},{x:200,y:-100}]},b={id:'B',type:'line',layer:'default',points:[{x:10000,y:-100},{x:10100,y:-100}]};
 const fillers=Array.from({length:49999},(_,i)=>({id:`F${i}`,type:'line',layer:'default',points:[{x:20000+i*2,y:-100},{x:20001+i*2,y:-100}]}));
 const c={G,visibilityCacheKeys,engine:{doc:{entities:[a,b,...fillers],layers:[{id:'default',visible:true}]}},scale:1,origin:{x:0,y:0},width:1000,height:800,viewMoving:false,sceneRevision:1,nearby(){},world(p){return {x:(p.x-c.origin.x)/c.scale,y:(c.origin.y-p.y)/c.scale};},num(_id,fallback){return fallback;},$(){return {}}};
 vm.createContext(c);
 const visibleBegin=source.indexOf('let visibleRevision='),visibleEnd=source.indexOf('const num =',visibleBegin);
 vm.runInContext(source.slice(visibleBegin,visibleEnd),c);
 const nearBegin=source.indexOf('function nearby('),nearEnd=source.indexOf('function warmNearbyIndex',nearBegin);
 assert.ok(nearBegin>=0&&nearEnd>nearBegin,'load the actual nearby implementation');
 vm.runInContext(source.slice(nearBegin,nearEnd),c);
 assert.deepEqual(vm.runInContext('nearby({x:150,y:-100},100).map(e=>e.id)',c),['A']);
 c.origin.x=-9500;
 assert.deepEqual(vm.runInContext('nearby({x:10050,y:-100},100).map(e=>e.id)',c),['B']);
});

test('a command window keeps its first corner on the drawing while the view moves to finish it',()=>{
 const c=selection();
 // First corner clicked at drawing (0,0); the user pans 100px before the second click.
 c.drag={kind:'selection',start:{x:0,y:0},startWorld:{x:0,y:0},awaitingCorner:true,secondCorner:true,threshold:.5};
 c.world=p=>({x:p.x+100,y:p.y});c.screen=q=>({x:q.x-100,y:q.y});
 c.up({x:-70,y:30});
 assert.deepEqual([...c.selected],['a']);assert.equal(c.drag,null);
});
test('pressing on an object in a command selects it only when released in place; moving turns it into a window',()=>{
 let c=selection();
 c.drag={kind:'selection',start:{x:15,y:15},threshold:.5,pendingHit:'a'};c.up({x:15,y:15});
 assert.deepEqual([...c.selected],['a']);assert.equal(c.drag,null);
 c=selection();
 c.drag={kind:'selection',start:{x:15,y:15},threshold:.5,pendingHit:'a'};c.up({x:70,y:70});
 assert.deepEqual([...c.selected],['b']);
});
test('명령 직후 빠르게 친 클릭은 손이 몇 px 밀려도 선택창이 따라온다; 길게 끈 것은 끌기 선택',()=>{
 const c=selection();
 c.drag={kind:'selection',start:{x:0,y:0},threshold:.5,pressedAt:1000};
 c.up({x:12,y:6,timeStamp:1080});
 assert.equal(c.drag?.awaitingCorner,true);
 const d=selection();
 d.drag={kind:'selection',start:{x:0,y:0},threshold:.5,pressedAt:1000};
 d.up({x:30,y:30,timeStamp:1400});
 assert.deepEqual([...d.selected],['a']);assert.equal(d.drag,null);
});
