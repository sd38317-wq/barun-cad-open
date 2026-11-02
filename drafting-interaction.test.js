import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as G from './geometry.js';
import {snapIntersections} from './snap-intersections.js';
import {crossing,drawEntity} from './view.js';
const source=fs.readFileSync('app.js','utf8');

test('기본 대기는 십자선과 선택 상자, 객체 선택 단계는 선택 상자, 점 지정 단계는 십자선을 쓴다',()=>{
 const begin=source.indexOf('const OBJECT_PICK_PHASES='),end=source.indexOf('function orthogonalInput',begin);
 const c={mode:'LINE',phase:'point'};vm.createContext(c);vm.runInContext(source.slice(begin,end),c);
 for(const phase of ['select','window','pick','offset-object','insulation-select','wall-center-pick'])assert.equal(c.objectPickCursor('WALL',phase),true,phase);
 for(const mode of ['SELECT','MATCHPROP'])assert.equal(c.objectPickCursor(mode,'idle'),true,mode);
 assert.equal(c.idleSelectionCrosshair('SELECT','idle'),true);
 assert.equal(c.idleSelectionCrosshair('SELECT','select'),false);
 assert.equal(c.idleSelectionCrosshair('LINE','point'),false);
 for(const phase of ['point','hatch-inside','area-label','zoom-window'])assert.equal(c.objectPickCursor('LINE',phase),false,phase);
 assert.match(source,/if\(!pickBox\|\|idleSelectionCrosshair\(\)\)/);
 assert.doesNotMatch(source,/id=['"]cursor-style['"]|\$\(['"]cursor-style['"]\)/);
});
function snapping(){
 const elements=new Map();const c={G,snapIntersections,scale:1,mode:'STRETCH',phase:'point',points:[{x:0,y:0}],entities:[],num:(id,f)=>f,$:id=>{if(!elements.has(id))elements.set(id,{checked:false});return elements.get(id);}};
 c.visible=()=>c.entities;vm.createContext(c);vm.runInContext(source.slice(source.indexOf('function snap(p)'),source.indexOf('function pick(')),c);return c;
}
test('grid snap toggles independently of ortho',()=>{
 const c=snapping();c.$('ortho').checked=false;
 assert.deepEqual({...c.snap({x:100,y:30})},{x:100,y:30});
 c.$('snap').checked=true;assert.deepEqual({...c.snap({x:133,y:67})},{x:100,y:100});
 c.$('snap').checked=false;assert.deepEqual({...c.snap({x:133,y:67})},{x:133,y:67});
});

test('ortho locks every point-picking command to the axis nearer the cursor, AutoCAD style',()=>{
 const c=snapping();c.$('ortho').checked=true;
 // 가까운 축에 투영한다. 길이는 그 축 성분이지 커서까지의 거리가 아니다.
 for(const mode of ['LINE','PLINE','WALL','INSULATION','MOVE','COPY','STRETCH','CIRCLE','MIRROR','ROTATE','DOOR','WINDOW','STAIR']){
  c.mode=mode;
  assert.deepEqual({...c.snap({x:100,y:30})},{x:100,y:0},mode);
  assert.deepEqual({...c.snap({x:-100,y:30})},{x:-100,y:0},mode);
  assert.deepEqual({...c.snap({x:30,y:100})},{x:0,y:100},mode);
  assert.deepEqual({...c.snap({x:30,y:-100})},{x:0,y:-100},mode);
 }
 // 이어 그리는 선은 직전 점이 기준이다.
 c.mode='LINE';c.points=[{x:0,y:0},{x:1000,y:0}];
 assert.deepEqual({...c.snap({x:1200,y:900})},{x:1000,y:900});
 c.points=[{x:0,y:0}];
 // 객체 선택·영역 창·화면 이동에는 걸지 않는다.
 // RECTANGLE 은 두 모서리가 같은 축에 놀이면 그려지지 않으므로 같이 빼 둔다.
 for(const mode of ['SELECT','PAN','ZOOM','PLOTWINDOW','RECTANGLE']){c.mode=mode;assert.deepEqual({...c.snap({x:100,y:30})},{x:100,y:30},mode);}
 c.mode='LINE';c.phase='select';assert.deepEqual({...c.snap({x:100,y:30})},{x:100,y:30});c.phase='point';
 // 기준점이 아직 없으면 자유롭게 움직인다.
 c.points=[];assert.deepEqual({...c.snap({x:100,y:30})},{x:100,y:30});c.points=[{x:0,y:0}];
 c.$('ortho').checked=false;assert.deepEqual({...c.snap({x:100,y:30})},{x:100,y:30});
});

test('object snaps override ortho while keeping exact anchor coordinates',()=>{
 const c=snapping();c.mode='LINE';c.$('ortho').checked=true;c.$('osnap').checked=true;c.$('snap-end').checked=true;
 c.entities=[{type:'line',points:[{x:100,y:30},{x:300,y:300}]}];
 const p=c.snap({x:100,y:30});
 assert.deepEqual({x:p.x,y:p.y},{x:100,y:30});assert.equal(p.snapped,true);
 c.entities=[{type:'line',points:[{x:104,y:0},{x:300,y:300}]}];
 const aligned=c.snap({x:100,y:5});assert.deepEqual({x:aligned.x,y:aligned.y},{x:104,y:0});assert.equal(aligned.snapped,true);
});
test('PLINE uses the same endpoint and midpoint object snaps as LINE',()=>{
 const c=snapping();c.mode='PLINE';c.points=[{x:-100,y:-100}];c.$('osnap').checked=true;c.$('snap-end').checked=true;c.$('snap-mid').checked=true;
 c.entities=[{type:'line',points:[{x:0,y:0},{x:100,y:0}]}];
 const endpoint=c.snap({x:3,y:4});assert.deepEqual({x:endpoint.x,y:endpoint.y,label:endpoint.label},{x:0,y:0,label:'끝점'});
 const midpoint=c.snap({x:52,y:3});assert.deepEqual({x:midpoint.x,y:midpoint.y,label:midpoint.label},{x:50,y:0,label:'중점'});
});
test('centerline dash pattern follows entity linetype scale',()=>{
 let pattern=null;const ctx={save(){},restore(){},setLineDash(v){pattern=v},beginPath(){},moveTo(){},lineTo(){},stroke(){},set strokeStyle(v){},set fillStyle(v){},set lineWidth(v){}};
 drawEntity(ctx,{type:'line',linetype:'CENTER',linetypeScale:2,points:[{x:0,y:0},{x:100,y:0}]},p=>p,1,'#fff');
 // 1 px/mm 확대: 도면 길이(무늬 × 선종류 축척 2 ÷ 화면 비율 0.6)가 화면 최소 무늬보다 길다.
 assert.deepEqual(pattern.map(v=>Math.round(v*1000)/1000),[24,6,4,6].map(v=>Math.round(v/.6*1000)/1000));
});
test('resolved layer centerline is drawn even when the entity is BYLAYER',()=>{
 let pattern=null;const ctx={save(){},restore(){},setLineDash(v){pattern=v},beginPath(){},moveTo(){},lineTo(){},stroke(){},set strokeStyle(v){},set fillStyle(v){},set lineWidth(v){}};
 drawEntity(ctx,{type:'line',_displayLinetype:'CENTER',_displayLinetypeScale:.5,points:[{x:0,y:0},{x:100,y:0}]},p=>p,1,'#fff');
 assert.deepEqual(pattern,[12,3,2,3],'축척 0.5 의 도면 길이가 화면 최소 무늬(축척 1)보다 짧으면 최소 무늬');
});
test('nearest snap projects to line and circle; endpoints win near a named anchor; F3 off removes capture',()=>{
 const c=snapping();c.$('osnap').checked=true;c.$('snap-nearest').checked=true;
 c.entities=[{type:'line',points:[{x:0,y:0},{x:100,y:0}]}];
 assert.equal(c.snap({x:40,y:8}).x,40);assert.equal(c.snap({x:40,y:8}).y,0);assert.equal(c.snap({x:40,y:8}).label,'근처점');
 c.$('snap-end').checked=true;assert.equal(c.snap({x:4,y:8}).x,0);assert.equal(c.snap({x:4,y:8}).label,'끝점');
 c.$('osnap').checked=false;assert.equal(c.snap({x:4,y:8}).y,8);
 c.$('osnap').checked=true;c.$('snap-end').checked=false;c.entities=[{type:'circle',center:{x:0,y:0},radius:100}];
 const p=c.snap({x:70,y:70});assert.ok(Math.abs(Math.hypot(p.x,p.y)-100)<1e-8);
});
test('STR two-corner selection accumulates endpoints and Shift excludes without advancing phase',()=>{
 const entities=[{id:'a',type:'line',points:[{x:0,y:0},{x:100,y:0}]}];
 const c={G,crossing,performance,safe:Object.assign(fn=>fn(),{lastError:null}),interaction:{accepts:()=>true},inputState:()=>'',traceInput(){},scheduleEngineUiRefresh(){},mode:'STRETCH',phase:'window',params:{targets:[]},selected:new Set(),previousSelection:[],localPoint:e=>e,world:p=>p,editable:()=>entities,pick:()=>null,render(){},refresh(){},toast(){},drag:null};
 c.canvas={addEventListener:(event,fn)=>c.up=fn,hasPointerCapture:()=>false,releasePointerCapture(){}};vm.createContext(c);
 vm.runInContext(source.slice(source.indexOf('canvas.addEventListener("pointerup",'),source.indexOf('canvas.addEventListener("pointercancel",')),c);
 const box=(a,b,shift=false)=>{c.drag={kind:'selection',start:a,shift,secondCorner:true};c.up(b);};
 box({x:110,y:10},{x:90,y:-10});assert.equal(c.phase,'window');assert.deepEqual([...c.params.targets[0].indices],[1]);
 box({x:10,y:10},{x:-10,y:-10});assert.deepEqual([...c.params.targets[0].indices],[1,0]);
 box({x:10,y:10},{x:-10,y:-10},true);assert.deepEqual([...c.params.targets[0].indices],[1]);
});
test('drafting function keys operate from coordinate input and ignore held-key repeats',()=>{
 const begin=source.indexOf("  const assistKey={F3:"),end=source.indexOf('  if ((e.ctrlKey',begin);let changes=0;
 const element={checked:false};const c={e:{key:'F8',preventDefault(){}},document:{querySelector:()=>null},$:()=>element,draftingChanged:()=>changes++};vm.createContext(c);
 vm.runInContext('(function(){'+source.slice(begin,end)+'})()',c);assert.equal(element.checked,true);assert.equal(changes,1);
 c.e.repeat=true;vm.runInContext('(function(){'+source.slice(begin,end)+'})()',c);assert.equal(element.checked,true);assert.equal(changes,1);
});


test('enabling ortho immediately recalculates the active line preview',()=>{
 const c=snapping();c.mode='LINE';c.rawCursor={x:80,y:25};c.cursor={...c.rawCursor};c.$('ortho').checked=true;
 c.localStorage={setItem(){}};c.syncDraftingButtons=()=>{};c.render=()=>{};
 vm.runInContext(source.slice(source.indexOf('function draftingChanged()'),source.indexOf('function syncDraftingButtons()')),c);
 c.draftingChanged();assert.equal(c.cursor.y,0);assert.equal(c.cursor.x,80);
 c.$('ortho').checked=false;c.draftingChanged();assert.equal(c.cursor.y,25);
});

test('arc anchors are exact and quadrant is independent of endpoint',()=>{
 const c=snapping();c.$('osnap').checked=true;c.$('snap-end').checked=true;
 c.entities=[{type:'circle',center:{x:0,y:0},radius:100}];
 assert.equal(c.snap({x:100,y:0}).snapped,undefined);
 c.$('snap-quadrant').checked=true;assert.equal(c.snap({x:100,y:1}).label,'사분점');
 c.$('snap-quadrant').checked=false;c.entities=[{type:'arc',center:{x:0,y:0},radius:100,startAngle:300,endAngle:60}];
 assert.equal(c.snap(G.polar(100,300)).label,'끝점');
 c.$('snap-mid').checked=true;const p=c.snap({x:100,y:1});assert.equal(p.label,'중점');assert.ok(Math.abs(p.x-100)<1e-8);assert.ok(Math.abs(p.y)<1e-8);
 c.$('snap-mid').checked=false;assert.equal(c.snap({x:100,y:1}).snapped,undefined);
});


test('PLINE crossing stays acquired on both sides of ortho axis decision boundary',()=>{
 const c=snapping();c.mode='PLINE';c.$('ortho').checked=true;c.$('osnap').checked=true;c.$('snap-intersection').checked=true;
 c.entities=[{type:'line',points:[{x:80,y:100},{x:120,y:100}]},{type:'line',points:[{x:100,y:80},{x:100,y:120}]}];
 for(const [x,y] of [[99,100],[100,99],[101,100],[100,101],[100,100]]){
  const q=c.snap({x,y});assert.equal(q.snapped,true);assert.equal(q.label,'교차점');assert.equal(q.x,100);assert.equal(q.y,100);
 }
 c.$('osnap').checked=false;const q=c.snap({x:101,y:100});assert.equal(q.snapped,undefined);assert.equal(q.y,0);
});


test('aligned crossing does not flicker when cursor switches ortho direction',()=>{
 const c=snapping();c.mode='PLINE';c.$('ortho').checked=true;c.$('osnap').checked=true;c.$('snap-intersection').checked=true;
 c.entities=[{type:'line',points:[{x:-20,y:0},{x:20,y:0}]},{type:'line',points:[{x:5,y:-20},{x:5,y:20}]}];
 for(const scale of [.5,1,2]){c.scale=scale;for(const y of [4.9,5.1,4.9,5.1]){
  const q=c.snap({x:5,y});assert.equal(q.snapped,true);assert.equal(q.x,5);assert.equal(q.y,0);
 }}
});
