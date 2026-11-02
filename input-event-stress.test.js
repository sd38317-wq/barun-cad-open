import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as G from './geometry.js';
import { crossing } from './view.js';
import {DrawingEngine,blankDocument} from './engine.js';
import {tableBlock} from './studio.js';
import {InputDiagnostics,InteractionEpoch} from './input-manager.js';
import {hangulToQwerty} from './commands.js';
import {calculatorShortcut} from './calculator-shortcut.js';
import {historyShortcutAction} from './command-history-shortcut.js';

// The canvas handler is synchronous by design: a confirmed pointer event must
// be consumed before rendering/refresh work is scheduled.  This harness feeds
// the real selection pointerup path at the same intervals used by the UI
// stress check, rather than sleeping (which would make the test flaky).
const source = fs.readFileSync(new URL('./app.js', import.meta.url), 'utf8');

function selectionHarness() {
  const entities = Array.from({ length: 8 }, (_, i) => ({
    id: `line-${i}`,
    type: 'line',
    points: [{ x: i * 100, y: 0 }, { x: i * 100 + 80, y: 0 }],
  }));
  const accepted = [];
  const context = {
    G,
    crossing,
    performance,
    interaction: { accepts: () => true },
    inputState: () => '',
    traceInput() {},
    scheduleEngineUiRefresh() { accepted.push(context.selected.size); },
    mode: 'SELECT',
    phase: 'idle',
    params: {},
    selected: new Set(),
    previousSelection: [],
    drag: null,
    localPoint: event => event,
    world: point => point,
    editable: () => entities,
    pick: () => null,
    render() {},
    refresh() {},
    toast() {},
    safe:Object.assign(fn=>{try{return fn();}catch(error){context.safe.lastError=error;return null;}},{lastError:null}),
  };
  vm.createContext(context);
  const begin = source.indexOf('canvas.addEventListener("pointerup", (e) => {');
  const end = source.indexOf('canvas.addEventListener("pointercancel"', begin);
  context.canvas = { addEventListener: (event, handler) => { context.pointerup = handler; }, hasPointerCapture:()=>false, releasePointerCapture(){} };
  vm.runInContext(source.slice(begin, end), context);
  return { context, accepted };
}

function feedRapidSelection(context, startTime, interval) {
  const a = { x: -10, y: -10 };
  const b = { x: 850, y: 10 };
  context.drag = { kind: 'selection', start: a, shift: false, secondCorner: true };
  context.pointerup({ ...b, timeStamp: startTime });
  return startTime + interval;
}

for (const interval of [500, 250, 100, 50]) {
  test(`확정 선택 입력은 ${interval}ms 간격에서도 누락되지 않는다`, () => {
    const { context, accepted } = selectionHarness();
    let timestamp = 0;
    const count = 24;
    for (let i = 0; i < count; i++) timestamp = feedRapidSelection(context, timestamp, interval);
    assert.equal(accepted.length, count, `refresh count at ${interval}ms`);
    assert.equal(accepted.filter(size => size === 8).length, count, `selected objects at ${interval}ms`);
    assert.equal(context.selected.size, 8);
  });
}

test('연속 선택 입력은 처리 중 상태가 남아도 다음 확정 이벤트를 받는다', () => {
  const { context, accepted } = selectionHarness();
  for (let i = 0; i < 12; i++) {
    context.drag = { kind: 'selection', start: { x: -10, y: -10 }, shift: false, secondCorner: true };
    context.pointerup({ x: 850, y: 10, timeStamp: i * 50 });
  }
  assert.equal(accepted.length, 12);
  assert.equal(context.drag, null);
});

function realInputHarness(){
  const engine=new DrawingEngine(),listeners={keydown:[],keyup:[]},traces=[];
  const interaction=new InteractionEpoch();
  const context={
    G,performance,crypto,structuredClone,console,hangulToQwerty,calculatorShortcut,historyShortcutAction,
    mode:'LINE',phase:'point',params:{},points:[],cursor:null,rawCursor:null,drag:null,busy:false,
    selected:new Set(),previousSelection:[],lastSelectDown:null,selectDoubleClickEpoch:-1,lastCanvasPointerId:null,
    interaction,activeLayer:'default',space:false,spaceDragged:false,lastCommand:null,
    localPoint:event=>({x:event.clientX,y:event.clientY}),world:p=>p,snap:p=>p,
    inputState(){return `${context.mode}.${context.phase}`;},
    traceInput(event,data){traces.push({event,...data});},
    render(){},updatePrompt(){},scheduleEngineUiRefresh(){},syncCurrentLayerChooser(){},toast(){},
    objectPickCursor(){return false;},chosen(){return [];},layerMap(){return new Map()},
    pick(){return null;},num(_id,fallback){return fallback;},
    execute(command){return engine.execute(command)||[];},
    addEntities(entities){return engine.execute({type:'addMany',entities:entities.map(entity=>({...entity,layer:entity.layer||context.activeLayer}))})||[];},
    setSelected(ids){context.selected=new Set(ids||[]);},
    safe(fn){context.safe.lastError=null;try{return fn();}catch(error){context.safe.lastError=error;return null;}},
    reset(){context.drag=null;interaction.next('reset');context.mode='SELECT';context.phase='idle';context.points=[];context.params={};},
    cancelSelection(){context.reset();context.selected.clear();},
    keyChord(){return '';},calculatorOperatorFromInput(){return null;},normalizeAssistHotkey(v){return v;},
    settings:{hotkeys:{}},architectureAssistState:{hotkeys:{}},architectureReferenceCommands:[],studio:{numberCalculator:{open(){}}},
    document:{
      querySelector(){return null;},
      addEventListener(type,handler,options){(listeners[type]??=[]).push({handler,capture:options===true});},
    },
    $(){return {checked:false,focus(){},value:'',matches(){return false;}};},draftingChanged(){},
    window:{addEventListener(){}},run(){},editable(){return []},keyInputStarts:new WeakMap(),
  };
  context.safe.lastError=null;
  context.canvas={
    addEventListener(type,handler){context[type]=handler;},focus(){},setPointerCapture(){},hasPointerCapture(){return false;},releasePointerCapture(){},
  };
  vm.createContext(context);
  const acceptBegin=source.indexOf('function accept(p) {'),acceptEnd=source.indexOf('function calculatorOperatorFromInput',acceptBegin);
  vm.runInContext(source.slice(acceptBegin,acceptEnd),context);
  const downBegin=source.indexOf('canvas.addEventListener("pointerdown"'),downEnd=source.indexOf('canvas.addEventListener("pointermove"',downBegin);
  vm.runInContext(source.slice(downBegin,downEnd),context);
  const upBegin=source.indexOf('canvas.addEventListener("pointerup"'),upEnd=source.indexOf('canvas.addEventListener("pointercancel"',upBegin);
  vm.runInContext(source.slice(upBegin,upEnd),context);
  const keyBegin=source.indexOf('const keyInputStarts=new WeakMap()'),keyEnd=source.indexOf('window.addEventListener("blur"',keyBegin);
  vm.runInContext(source.slice(keyBegin,keyEnd),context);
  const pointer=(type,x,y,timeStamp)=>context[type]({button:0,pointerId:1,clientX:x,clientY:y,timeStamp,shiftKey:false,preventDefault(){}});
  const key=(value,timeStamp)=>{
    const event={key:value,timeStamp,isComposing:false,ctrlKey:false,metaKey:false,altKey:false,repeat:false,defaultPrevented:false,target:{matches(){return false;}},preventDefault(){this.defaultPrevented=true;}};
    for(const item of listeners.keydown.filter(item=>item.capture))item.handler(event);
    for(const item of listeners.keydown.filter(item=>!item.capture))item.handler(event);
  };
  return {context,engine,traces,pointer,key};
}

const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
for(const interval of [500,250,100,50]){
  test(`${interval}ms 실제 스케줄러에서 LINE down/up/down/up/Enter/ESC 누락 0건`,async()=>{
    const {context,engine,traces,pointer,key}=realInputHarness();
    let timeStamp=performance.now();
    pointer('pointerdown',0,0,timeStamp);pointer('pointerup',0,0,timeStamp+1);await wait(interval);
    timeStamp=performance.now();pointer('pointerdown',100,50,timeStamp);pointer('pointerup',100,50,timeStamp+1);await wait(interval);
    key('Enter',performance.now());await wait(interval);key('Escape',performance.now());
    assert.equal(engine.doc.entities.length,1,JSON.stringify({traces,error:context.safe.lastError?.message,state:context.inputState(),points:context.points}));
    assert.deepEqual(engine.doc.entities[0].points,[{x:0,y:0},{x:100,y:50}]);
    assert.equal(context.mode,'SELECT');
    assert.equal(traces.filter(entry=>entry.accepted===false).length,0,JSON.stringify(traces));
    assert.equal(traces.filter(entry=>entry.event==='pointerdown').length,2);
    assert.equal(traces.filter(entry=>entry.event==='pointerup').length,2);
    assert.equal(traces.filter(entry=>entry.event==='keydown').length,2);
    const maxProcessing=Math.max(...traces.map(entry=>entry.processingMs||0));
    assert.ok(maxProcessing<50,JSON.stringify(traces));
    console.log(`# input-stress interval=${interval}ms confirmed=6 rejected=0 maxProcessingMs=${maxProcessing.toFixed(3)}`);
  });
}

test('명령 전환 generation은 이전 선택 pointerup을 거부한다',()=>{
  const epoch=new InteractionEpoch(),oldDrag=epoch.tag({kind:'selection'});
  epoch.next('LINE');
  assert.equal(epoch.accepts(oldDrag),false);
  assert.equal(epoch.accepts(epoch.tag({kind:'selection'})),true);
});

test('append history는 이후 편집과 undo/redo에서 오염되지 않는다',()=>{
  const engine=new DrawingEngine();
  const [first]=engine.execute({type:'add',entity:{type:'line',layer:'default',points:[{x:0,y:0},{x:10,y:0}]}});
  engine.execute({type:'add',entity:{type:'circle',layer:'default',center:{x:20,y:20},radius:5}});
  engine.execute({type:'move',ids:[first],dx:100,dy:0});
  engine.execute({type:'undo'});
  assert.deepEqual(engine.doc.entities[0].points[0],{x:0,y:0});
  engine.execute({type:'undo'});assert.equal(engine.doc.entities.length,1);
  engine.execute({type:'redo'});assert.equal(engine.doc.entities.length,2);
});

test('대형 도면 append는 전체 history 객체를 복제하지 않는다',()=>{
  const engine=new DrawingEngine(),doc=blankDocument();
  doc.entities=Array.from({length:10000},(_,i)=>({id:`base-${i}`,type:'line',layer:'default',points:[{x:i,y:0},{x:i+1,y:1}]}));
  engine.doc=doc;const oldFirst=doc.entities[0];
  engine.execute({type:'add',entity:{type:'line',layer:'default',points:[{x:0,y:2},{x:1,y:3}]}});
  assert.equal(engine.undoStack[0],doc);
  assert.equal(engine.doc.entities[0],oldFirst);
  assert.notEqual(engine.doc.entities,doc.entities);
});

test('공간 인덱스 insert는 재구축 없이 다음 확정 pick에 새 객체를 제공한다',()=>{
  const base={id:'base',type:'line',points:[{x:0,y:0},{x:10,y:0}]},added={id:'added',type:'line',points:[{x:100,y:0},{x:110,y:0}]};
  const index=G.spatialIndex([base]);index.insert([added]);
  assert.deepEqual(index.query({minX:95,minY:-5,maxX:115,maxY:5}).map(entity=>entity.id),['added']);
  assert.deepEqual(index.query({minX:-5,minY:-5,maxX:115,maxY:5}).map(entity=>entity.id),['base','added']);
});

test('10만 객체 인덱스의 512번째 insert도 전체 트리를 동기 재구축하지 않는다',()=>{
  const base=Array.from({length:100000},(_,i)=>({id:`base-${i}`,type:'line',points:[{x:i*2,y:0},{x:i*2+1,y:1}]}));
  const index=G.spatialIndex(base);let worst=0;
  for(let i=0;i<512;i++){
    const started=performance.now();
    index.insert([{id:`delta-${i}`,type:'line',points:[{x:i*2,y:10},{x:i*2+1,y:11}]}]);
    worst=Math.max(worst,performance.now()-started);
  }
  assert.ok(worst<50,`worst insert ${worst.toFixed(3)}ms`);
  assert.equal(index.query({minX:0,minY:9,maxX:1024,maxY:12}).length,512);
});

test('블록 추가는 전체 연동 경로를 거쳐 기존 블록 수량표를 즉시 갱신한다',()=>{
  const engine=new DrawingEngine();
  const block={type:'block',name:'문',category:'DOOR',layer:'default',entities:[{type:'line',layer:'default',points:[{x:0,y:0},{x:10,y:0}]}]};
  engine.execute({type:'add',entity:block});
  engine.execute({type:'add',entity:{...tableBlock([['분류','번호/이름','종류','폭','높이','수량'],['문','문','','','','1']]),scheduleKind:'blocks'}});
  engine.execute({type:'add',entity:{...block,position:{x:100,y:0}}});
  const schedule=engine.doc.entities.find(entity=>entity.scheduleKind==='blocks');
  assert.equal(schedule.table.rows[1].at(-1),2);
  assert.equal(engine.lastExecution.lightweight,false);
});

test('엔진 전체 연동 명령은 부분 렌더 캐시 revision을 잘못 승격하지 않는다',()=>{
  let cacheCalls=0;
  const context={
    sceneRevision:1,gpuEdit:null,
    engine:{doc:{entities:[{id:'wall',type:'wall',layer:'default'}],layers:[{id:'default',visible:true}]},lastExecution:null,execute(){context.sceneRevision++;this.lastExecution={lightweight:false};this.doc={...this.doc,entities:[]};return []; }},
    renderSpatialRevision:1,renderSpatial:{remove(){cacheCalls++},insert(){cacheCalls++}},
    nearby:Object.assign(function(){},{objectsRevision:1,objects:{remove(){cacheCalls++},insert(){cacheCalls++}}}),
    entityLookupRevision:1,entityLookup:new Map([['wall',{}]]),
    withCurrentProperties:c=>c,   // 현재 특성 채우기는 이 검사의 관심사가 아니다
  };
  vm.createContext(context);
  const begin=source.indexOf('function incrementalAppendCommand(c)'),end=source.indexOf('window.cad =',begin);
  vm.runInContext(source.slice(begin,end),context);
  vm.runInContext("execute({type:'delete',ids:['wall']})",context);
  assert.equal(cacheCalls,0);
  assert.equal(context.renderSpatialRevision,1);
  assert.equal(context.nearby.objectsRevision,1);
  assert.equal(context.entityLookupRevision,1);
});
