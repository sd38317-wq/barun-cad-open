import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {CadGpuRenderer} from './gpu-renderer.js';
import {createGpuSelectionOverlay} from './gpu-selection-overlay.js';
import {alignRasterView} from './gpu-render-protocol.js';
import {THREE} from './vendor/mlightcad.js';
import {DrawingEngine,blankDocument} from './engine.js';
import * as G from './geometry.js';
import {screenLineweightPx} from './view.js';   // ACAD200 718: app.js 그리기가 선 굵기 픽셀을 이 함수로 정한다

const app=fs.readFileSync(new URL('./app.js',import.meta.url),'utf8');
const controller=fs.readFileSync(new URL('./gpu-controller.js',import.meta.url),'utf8');
const noop=()=>{};
const context2d=()=>Object.fromEntries(['drawImage','clearRect','save','restore','setTransform','beginPath','moveTo','lineTo','stroke','fillText','fillRect','strokeRect'].map(k=>[k,noop]));
const canvas=()=>({width:800,height:600,getContext:()=>context2d()});

// Exercise the real controller, overlay and app painting path with a CPU-only
// WebGL facade. Installation is stepped deterministically, with no timing A/B.
async function fixture(){
 const originalDocument=globalThis.document,originalTimeout=globalThis.setTimeout,timers=[];
 const document={createElement:type=>type==='canvas'?canvas():{},querySelector:()=>({append:noop}),fonts:{addEventListener:noop,removeEventListener:noop}};
 globalThis.document=document;globalThis.setTimeout=fn=>{timers.push(fn);return timers.length;};
 const r=Object.create(CadGpuRenderer.prototype),counts={items:0,batches:0,uploadObjects:0};
 Object.assign(r,{canvas:canvas(),scene:new THREE.Scene(),stats:{builds:0,frames:0},buildBudgetMs:0,camera:new THREE.OrthographicCamera(),gl:{
  clear:noop,autoClear:true,compile:()=>new Set(),setScissorTest:noop,setScissor:noop,
  getRenderTarget:()=>null,getClearColor:color=>color,getClearAlpha:()=>0,setRenderTarget:noop,setClearColor:noop,
  render(scene){counts.uploadObjects+=scene.children.length;}
 },renderer:{subEntityTraits:{},lineSegments(values,size,indices){
  const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.BufferAttribute(values,size));geometry.setIndex(new THREE.BufferAttribute(indices,1));
  const group=new THREE.Group();group.add(new THREE.LineSegments(geometry,new THREE.LineBasicMaterial()));return group;
 }}});
 const register=r.registerDetail.bind(r),build=r.buildLineBatch.bind(r);
 r.registerDetail=(...args)=>{counts.items++;return register(...args);};
 r.buildLineBatch=(...args)=>{counts.batches++;return build(...args);};
 // Keep actual setDocument/buildTask and actual selection geometry. Raster
 // submission is mocked, and a stable completed frame has a stable snapshot.
 r.render=options=>{
  r.setDocument(options.doc,options.revision,options.scale,options.edit);
  if(r.buildTask){r.renderSnapshot=null;return r.canvas;}
  if(r.renderSnapshot?.doc!==r.doc||r.renderSnapshot?.revision!==r.revision)r.renderSnapshot={doc:r.doc,revision:r.revision};
  return r.canvas;
 };
 let overlay;
 const engine=new DrawingEngine();engine.doc={...blankDocument(),layers:[
  {id:'default',name:'0',visible:true,locked:false,color:'#ff0000',lineweight:.25,linetype:'CONTINUOUS'},
  {id:'target',name:'Target',visible:true,locked:false,color:'#0000ff',lineweight:.25,linetype:'CONTINUOUS'}
 ],entities:Array.from({length:6000},(_,i)=>({id:'l'+i,type:'line',layer:'default',points:[{x:i%100,y:Math.floor(i/100)},{x:i%100+1,y:Math.floor(i/100)+1}]}))};
 engine.validate(engine.doc);
 const selected=new Set(engine.doc.entities.slice(0,5500).map(e=>e.id));
 let key=null,invalidations=0,visibleCalls=0,gripCalls=0,cacheWrites=0;
 const c={document,location:{search:'?renderer=gpu'},URLSearchParams,alignRasterView,console,engine,selected,
  sceneRevision:1,selectionRevision:1,sceneHighlights:null,gpuEdit:null,inlineTextEntityId:null,
  width:800,height:600,scale:.05,origin:{x:0,y:0},canvas:canvas(),ctx:context2d(),sceneCanvas:canvas(),sceneCtx:context2d(),
  getCanvasPalette:()=>({}),paintBasemap:noop,createImageRenderer:()=>({draw:noop}),placeInlineText:noop,$:()=>({checked:false}),num:()=>100,
  waitingForGpuView:()=>false,completeGpuDisplay:()=>null,viewMoving:false,drag:null,documents:{activeId:'drawing'},
  liveCheck:null,render:noop,tabletPad:null,wallDetectionOverlay:null,draft:()=>[],cursor:null,
  screen:p=>p,drawEntity:noop,screenLineweightPx,ucsIconOn:()=>false,layerMap:()=>new Map(engine.doc.layers.map(l=>[l.id,l])),
  visible(){visibleCalls++;assert.equal(!!r.buildTask,false,'selection extraction waits for installation');return G.visibleEntities(engine.doc,{inPlace:true,lodScale:0});},
  chosen(){gripCalls++;assert.equal(!!r.buildTask,false,'grips wait for installation');return [];},
  viewportDrawingEntities(){assert.fail('GPU must remain active');},
  loadModule:async name=>name==='./gpu-renderer.js'?{CadGpuRenderer:class {constructor({onChange}){r.onChange=onChange;return r;}}}:{createGpuSelectionOverlay:()=>overlay=createGpuSelectionOverlay()}
 };
 Object.defineProperty(c,'sceneKey',{get:()=>key,set:value=>{if(value===null)invalidations++;key=value;}});
 c.sceneCtx.drawImage=()=>cacheWrites++;
 vm.createContext(c);
 vm.runInContext(controller.replace(/^import[^\n]*\n/,'').replace(/export /g,'').replace(/import\(/g,'loadModule('),c);
 const start=app.indexOf('const gpuView=createGpuController('),end=app.indexOf('\n',start);
 vm.runInContext(app.slice(start,end)+'\nglobalThis.gpuView=gpuView;',c);
 await new Promise(setImmediate);
 const begin=app.indexOf('function paintFrame()'),finish=app.indexOf('  const hintPoint=',begin);
 vm.runInContext(app.slice(begin,finish)+'\n}',c);
 const frame=()=>{
  counts.items=counts.batches=counts.uploadObjects=0;c.paintFrame();
  return {...counts};
 };
 const drain=()=>{while(timers.length)timers.shift()();};
 return {r,c,engine,selected,frame,drain,get overlay(){return overlay;},
  get counters(){return {invalidations,visibleCalls,gripCalls,cacheWrites};},
  close(){r.clearScene();overlay.dispose();globalThis.document=originalDocument;globalThis.setTimeout=originalTimeout;}
 };
}

test('large selection, layer change and undo prepare selection once per completed installation',async()=>{
 const f=await fixture(),original=f.engine.doc,ids=[...f.selected],results=[];
 try{
  for(const stage of ['select','layer','undo']){
   if(stage==='layer'){
    f.engine.execute({type:'update',ids,changes:{layer:'target'}});
    // 100개 넘는 레이어 바꾸기는 엔진이 lightweight=false 로 알리므로 app.js 는 gpuEdit 를 만들지 않는다(onChange 가 null 로 둔다).
    // ACAD200 210: 엔진이 바뀌지 않은 객체를 공유해도(복사 후 쓰기) 화면은 이 길로 전체를 조각 설치한다.
    assert.equal(f.engine.lastExecution.lightweight,false);
    f.c.gpuEdit=null;f.c.sceneRevision++;
   }else if(stage==='undo'){f.engine.execute({type:'undo'});f.c.gpuEdit=null;f.c.sceneRevision++;assert.equal(f.engine.doc,original);}
   const before=f.counters,prepares=f.overlay.stats.prepares||0;
   let frames=0,pendingFrames=0,maxItems=0,maxBatches=0,maxUploadObjects=0;
   do{
    const work=f.frame();frames++;maxItems=Math.max(maxItems,work.items);maxBatches=Math.max(maxBatches,work.batches);
    if(f.r.buildTask){pendingFrames++;maxUploadObjects=Math.max(maxUploadObjects,work.uploadObjects);assert.equal(f.overlay.stats.prepares||0,prepares);}
    f.drain();
   }while(f.r.buildTask&&frames<10000);
   assert.equal(f.r.buildTask,null);assert.ok(pendingFrames>20);
   assert.equal(f.overlay.stats.prepares,prepares+1,'one selection regeneration on completion');
   assert.equal(f.counters.invalidations-before.invalidations,1,'progress preserves pixels, completion invalidates once');
   assert.equal(f.counters.visibleCalls-before.visibleCalls,1,'extract selected display once');
   assert.equal(f.counters.gripCalls-before.gripCalls,1);
   assert.equal(f.counters.cacheWrites-before.cacheWrites,2,'one pending placeholder and one completed frame');
   assert.equal(maxItems,512);assert.equal(maxBatches,1);assert.ok(maxUploadObjects<=256);
   assert.deepEqual(f.overlay.state.ids,ids);assert.deepEqual([...f.overlay.state.handled],ids);assert.deepEqual([...f.selected],ids);
   assert.ok(f.overlay.state.parts.every(item=>item.counts.records===1));
   for(const entity of f.engine.doc.entities){
    const expected=stage==='layer'&&f.selected.has(entity.id)?'#0000ff':'#ff0000';
    const batches=[...f.r.sourceBatchesOf(entity.id)];assert.ok(batches.length);
    for(const batch of batches)assert.equal(batch.color,expected);
   }
   f.frame();f.drain();assert.equal(f.overlay.stats.prepares,prepares+1,'unchanged completed frame reuses selection');
   results.push({stage,frames,pendingFrames,selectionPrepares:1,cacheInvalidations:1,maxItems,maxBatches,maxUploadObjects});
  }
  console.log('Large selection installation work counts:',results);
 }finally{f.close();}
});

test('selection changes and a newer document during installation use only the latest result',async()=>{
 const f=await fixture();
 try{
  f.frame();f.drain();assert.ok(f.r.buildTask);
  f.selected.clear();f.selected.add('l42');f.c.selectionRevision++;
  f.engine.execute({type:'update',ids:['l42','l43'],changes:{layer:'target'}});f.c.sceneRevision++;
  f.frame();f.drain();assert.ok(f.r.buildTask);assert.equal(f.overlay.stats.prepares||0,0);
  let frames=0;do{f.frame();f.drain();frames++;}while(f.r.buildTask&&frames<10000);
  assert.equal(f.r.doc,f.engine.doc);assert.equal(f.overlay.stats.prepares,1,JSON.stringify(f.overlay.stats));
  assert.deepEqual(f.overlay.state.ids,['l42']);assert.deepEqual([...f.selected],['l42']);
  assert.equal([...f.r.sourceBatchesOf('l42')][0].color,'#0000ff');
  f.selected.clear();f.c.selectionRevision++;f.frame();f.drain();
  assert.equal(f.overlay.state.handled.size,0);assert.equal(f.overlay.state.parts.length,0);
 }finally{f.close();}
});

test('highlights retained through installation use the current fallback painter colors',async()=>{
 const f=await fixture(),drawn=[];
 try{
  f.selected.clear();f.selected.add('l42');f.c.selectionRevision++;
  f.c.liveCheck={highlights:new Set(['l43'])};
  f.c.drawEntity=(_ctx,e,_screen,_scale,color,width)=>drawn.push([e.id,color,width]);
  let frames=0;do{
   f.frame();f.drain();frames++;
   if(f.r.buildTask)assert.equal(drawn.length,0);
  }while(f.r.buildTask&&frames<10000);
  assert.equal(f.r.buildTask,null);
  assert.deepEqual(drawn,[['l42','#ff0000',2.3],['l43','#ff4545',1]]);
  assert.deepEqual([...f.selected],['l42']);assert.equal(f.overlay.stats.error,undefined);
 }finally{f.close();}
});

test('installation failure releases the pending state and paints the CPU fallback',async()=>{
 const f=await fixture(),drawn=[];
 try{
  f.frame();f.drain();assert.ok(f.r.buildTask);
  const ids=[...f.selected];
  f.c.console={...console,warn:noop};
  f.r.render=()=>{throw Error('installation failed');};
  f.c.viewportDrawingEntities=()=>f.engine.doc.entities.slice(0,1);
  f.c.drawEntity=(_ctx,e)=>drawn.push(e.id);
  f.frame();f.drain();
  assert.equal(f.r.buildTask,null);assert.equal(f.c.gpuView.buildPending,false);
  assert.equal(f.c.gpuView.stats.reason,'installation failed');
  assert.deepEqual(drawn,['l0']);assert.deepEqual([...f.selected],ids);
 }finally{f.close();}
});
