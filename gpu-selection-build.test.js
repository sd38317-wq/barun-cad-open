import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {CadGpuRenderer} from './gpu-renderer.js';
import {createGpuSelectionOverlay} from './gpu-selection-overlay.js';
import {alignRasterView} from './gpu-render-protocol.js';
import {DrawingEngine} from './engine.js';
import {THREE} from './vendor/mlightcad.js';

// Run the actual controller and the app's cached-scene paint path. Only DOM,
// WebGL submission and module loading are replaced; builds and selection
// geometry still use the production renderer/overlay and real engine history.
async function fixture(){
 const counts={cacheWrites:0,visible:0,items:0,uploads:0};
 const ctx=new Proxy({}, {get:(_,key)=>key==='drawImage'?()=>{}:()=>{}});
 const canvas=()=>({width:800,height:600,getContext:()=>ctx});
 const document={createElement:type=>type==='canvas'?canvas():{remove(){}},querySelector:()=>({append(){}})};
 const previousDocument=globalThis.document;globalThis.document=document;
 const overlay=createGpuSelectionOverlay();
 let renderer;
 function Renderer({onChange}){
  const r=renderer=Object.create(CadGpuRenderer.prototype);
  Object.assign(r,{scene:new THREE.Scene(),stats:{backend:'MLightCAD',builds:0,frames:0},onChange,buildBudgetMs:0,canvas:canvas(),width:800,height:600,
   camera:new THREE.OrthographicCamera(-1,1,1,-1,.1,100),
   gl:{clear(){},dispose(){},getRenderTarget(){return null;},getClearColor(c){return c.set(0);},getClearAlpha(){return 0;},setRenderTarget(){},setClearColor(){},render(){}},
   renderer:{subEntityTraits:{},dispose(){},lineSegments(values,size,indices){
    const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.BufferAttribute(values,size));g.setIndex(new THREE.BufferAttribute(indices,1));
    const child=new THREE.LineSegments(g,new THREE.LineBasicMaterial()),group=new THREE.Group();group.add(child);return group;
   }},
   render(options){this.setDocument(options.doc,options.revision,options.scale,options.edit,options.completeDisplay);if(!this.buildTask)this.renderSnapshot??={};return this.canvas;}
  });
  const register=r.registerDetail.bind(r),build=r.buildLineBatch.bind(r);
  r.registerDetail=(...args)=>{counts.items++;return register(...args);};
  r.buildLineBatch=(...args)=>{counts.uploads++;return build(...args);};
  return r;
 }
 const context=vm.createContext({document,URLSearchParams,location:{search:'?renderer=gpu'},alignRasterView,FixtureRenderer:Renderer,overlay,console,Set,
  performance,setTimeout:()=>0,counts,ctx,engine:new DrawingEngine(),canvas:canvas(),width:800,height:600,scale:.05,origin:{x:0,y:0},
  sceneCtx:{clearRect(){},drawImage(){counts.cacheWrites++;}},sceneCanvas:canvas(),liveCheck:null,inlineTextEntityId:null,
  getCanvasPalette:()=>({}),$:()=>({checked:false}),num:()=>100,paintBasemap(){},placeInlineText:null,tabSwitchCover:false,
  waitingForGpuView:()=>false,documents:{activeId:'drawing'},viewMoving:false,drag:null,completeGpuDisplay:()=>null,
  viewportDrawingEntities(){throw Error('unexpected CPU fallback');},drawEntity(){},ucsIconOn:()=>false,screen:p=>p,blockEditOutside:null,
  visible(){counts.visible++;return context.engine.doc.entities;}
 });
 const controller=fs.readFileSync(new URL('./gpu-controller.js',import.meta.url),'utf8')
  .replace(/^import .*\n/,'').replaceAll('export ','')
  .replace("import('./gpu-renderer.js')",'Promise.resolve({CadGpuRenderer:FixtureRenderer})')
  .replace("import('./gpu-selection-overlay.js')",'Promise.resolve({createGpuSelectionOverlay:()=>overlay})');
 const app=fs.readFileSync(new URL('./app.js',import.meta.url),'utf8');
 const start=app.indexOf('function paintFrame() {'),end=app.indexOf('  tabletPad?.paint',start);
 assert.ok(start>=0&&end>start,'extract the cached-scene paint path');
 const callback=app.match(/const gpuView=createGpuController\([^\n]+/)[0];
 vm.runInContext(controller+'\nfunction createImageRenderer(){return {draw(){}};}\nlet sceneKey=null,sceneHighlights=null,sceneRevision=1,selectionRevision=1,gpuEdit=null,selected=new Set();let notifications=0;function render(){notifications++;}\n'+callback+'\n'+app.slice(start,end)+'}\n'+
  'globalThis.paint=paintFrame;globalThis.gpuView=gpuView;globalThis.update=(revision,edit)=>{sceneRevision=revision;gpuEdit=edit;};globalThis.select=values=>{selected=new Set(values);selectionRevision++;};globalThis.key=()=>sceneKey;',context);
 await new Promise(resolve=>setImmediate(resolve));
 assert.ok(context.gpuView.stats.active,JSON.stringify(context.gpuView.stats));
 return {context,counts,overlay,get renderer(){return renderer;},
  frame(){counts.items=counts.uploads=0;context.paint();},
  notify(){renderer.onChange();},dispose(){try{context.gpuView.dispose();}finally{if(previousDocument===undefined)delete globalThis.document;else globalThis.document=previousDocument;}}};
}

function drawing(){
 return {version:2,units:'mm',blocks:[],linetypeScale:1,
  layers:[{id:'0',name:'0',visible:true,color:'#ffffff',lineweight:.25},{id:'changed',name:'changed',visible:true,color:'#ff0000',lineweight:.5}],
  entities:Array.from({length:6000},(_,i)=>({id:'p'+i,type:'block',name:'B',layer:'0',entities:Array.from({length:10},(_,j)=>({id:'c'+j,type:'line',layer:'0',points:[{x:i%100*30+j,y:Math.floor(i/100)*30},{x:i%100*30+j+1,y:Math.floor(i/100)*30+1}]}))}))};
}

test('large selected layer change and undo prepare selection once after each sliced install',async()=>{
 const f=await fixture(),{context:c,counts}=f,doc=drawing();c.engine.doc=doc;
 c.select(doc.entities.map(e=>e.id));
 const drain=()=>{
  let frames=0,maxItems=0,maxUploads=0;
  do{f.frame();frames++;maxItems=Math.max(maxItems,counts.items);maxUploads=Math.max(maxUploads,counts.uploads);if(f.renderer.buildTask)f.notify();}while(f.renderer.buildTask&&frames<10000);
  assert.ok(frames<10000,'cache hits must keep advancing the build');
  return {frames,maxItems,maxUploads};
 };
 try{
  drain();assert.equal(f.overlay.stats.sources,6000);assert.equal(f.overlay.stats.error,undefined);
  const selected=[...f.overlay.state.ids];
  for(const command of [{type:'update',ids:selected,changes:{layer:'changed'}},{type:'undo'}]){
   const before=c.engine.doc,revision=command.type==='undo'?3:2;
   c.engine.execute(command);
   const after=c.engine.doc,removed=before.entities.filter((e,i)=>after.entities[i]!==e),added=after.entities.filter((e,i)=>before.entities[i]!==e);
   c.update(revision,{lightweight:true,previousDoc:before,previousRevision:revision-1,removed,added});
   const prepares=f.overlay.stats.prepares,writes=counts.cacheWrites,visible=counts.visible;
   f.frame();assert.ok(f.renderer.buildTask);assert.equal(f.overlay.stats.prepares,prepares);assert.equal(counts.visible,visible,'no selected display resolution while building');
   const pendingKey=c.key();f.notify();assert.equal(c.key(),pendingKey,'slice notifications retain cached pixels');
   // Controller callers also cannot prepare a partial scene's selection.
   c.gpuView.drawSelection(c.ctx,after.entities,new Set(selected),null,.05,800,600);
   assert.equal(f.overlay.stats.prepares,prepares);
   const work=drain();assert.equal(f.renderer.stats.editReject,'mass');
   assert.equal(f.overlay.stats.prepares-prepares,1);
   assert.equal(counts.visible-visible,1);
   assert.equal(counts.cacheWrites-writes,2,'one pending frame and one completed frame, independent of slice count');
   assert.equal(work.maxItems,512);assert.equal(work.maxUploads,1);assert.ok(work.frames>10);
   assert.deepEqual(f.overlay.state.ids,selected);assert.equal(f.overlay.state.handled.size,selected.length);
   const color=command.type==='undo'?'#ffffff':'#ff0000';
   assert.ok([...f.renderer.lineBatches.values()].every(b=>b.color===color),'completed scene uses the current layer style');
   f.frame();assert.equal(f.overlay.stats.prepares-prepares,1,'unchanged frame reuses selection');
   console.log('selected layer change/undo work counts:',{command:command.type,selectionPrepares:1,cacheWrites:2,...work});
  }
  assert.equal(c.engine.doc,doc,'undo restores the original document');
 }finally{f.dispose();}
});

test('selection and highlights changed during installation resolve from the latest state',async()=>{
 const f=await fixture(),c=f.context;c.engine.doc=drawing();c.select(['p0','p1']);
 try{
  f.frame();assert.ok(f.renderer.buildTask);c.select(['p2']);c.liveCheck={highlights:new Set(['p3'])};
  f.frame();assert.equal(f.counts.visible,0);assert.equal(f.overlay.stats.prepares??0,0);
  c.liveCheck=null;
  let frames=0;do{f.notify();f.frame();}while(f.renderer.buildTask&&++frames<10000);
  assert.equal(f.renderer.buildTask,null);assert.deepEqual(f.overlay.state.ids,['p2']);assert.deepEqual([...f.overlay.state.handled],['p2']);
  assert.equal(f.overlay.stats.prepares,1);
 }finally{f.dispose();}
});
