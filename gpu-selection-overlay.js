import {THREE,AcCmColor} from './vendor/mlightcad.js';
import {createSourceSelection} from './gpu-selection-source.js';
function clearSelection(s){for(const item of s.parts)item.dispose();s.parts=[];s.ids=[];s.handled=new Set();s.selectionScene=null;}
function renderOverlay(r,scene){
 const gl=r.gl,target=gl.getRenderTarget(),color=gl.getClearColor(new THREE.Color()),alpha=gl.getClearAlpha(),auto=gl.autoClear;
 try{gl.setRenderTarget(null);gl.setClearColor(0,0);gl.autoClear=false;gl.clear(true,true,true);gl.render(scene,r.camera);}
 finally{gl.setRenderTarget(target);gl.setClearColor(color,alpha);gl.autoClear=auto;}
}
function warm(r){
 const old=r.renderer.forceShowLineWeight;r.renderer.forceShowLineWeight=true;
 r.renderer.subEntityTraits.color=new AcCmColor().setRGBFromCss('#ffffff');r.renderer.subEntityTraits.lineWeight=92;r.renderer.subEntityTraits.lineType={name:'Continuous',type:'Standard',pattern:[]};
 let object;try{object=r.renderer.lineSegments(new Float32Array([0,0,0,1,0,0]),3,new Uint16Array([0,1]));}finally{r.renderer.forceShowLineWeight=old;}
 object.traverse(c=>{c.frustumCulled=false;if(c.material)c.material=c.material.clone();});const scene=new THREE.Scene();scene.add(object);
 try{renderOverlay(r,scene);return object;}catch(error){object.traverse(c=>{c.geometry?.dispose();c.material?.dispose();});throw error;}
}
export function createGpuSelectionOverlay(){
 let state;
 const selectionBridge={stats:{},
 dispose(){if(!state)return;clearSelection(state);state.warm?.traverse(c=>{c.geometry?.dispose();c.material?.dispose();});state.r.renderSnapshot=null;state.base.width=state.base.height=0;state=null;},
 base(r,canvas){
  if(!state||state.r!==r){this.dispose();state={r,base:document.createElement('canvas'),snapshot:null,parts:[],ids:[],handled:new Set()};}
  const s=state;
  if(s.snapshot!==r.renderSnapshot||s.base.width!==canvas.width||s.base.height!==canvas.height){
   clearSelection(s);s.base.width=canvas.width;s.base.height=canvas.height;s.base.getContext('2d').drawImage(canvas,0,0);s.snapshot=r.renderSnapshot;
   if(!s.warm){const t=performance.now();s.warm=warm(r);this.stats.warmMs=performance.now()-t;}
  }
  return s.base;
 },
 draw(ctx,entities,selected,highlights,scale,width,height){
  const s=state;if(!s)return new Set();
  // Preserve the original painter order until ordered mixed passes are implemented.
  if(entities.some(e=>highlights?.has(e.id))){clearSelection(s);return new Set();}
  try{
  const ids=entities.filter(e=>selected.has(e.id)&&!highlights?.has(e.id)).map(e=>e.id);
  if(ids.length!==s.ids.length||ids.some((id,i)=>id!==s.ids[i])){
   const previous=new Map(s.ids.map((id,i)=>[id,s.parts[i]])),wanted=new Set(ids),start=performance.now();
   for(const [id,item]of previous)if(!wanted.has(id))item.dispose();
   s.selectionScene?.clear();s.parts=[...previous].filter(([id])=>wanted.has(id)).map(([,item])=>item);s.handled=new Set();s.selectionScene=new THREE.Scene();let reused=0;const ordered=[];
   for(const id of ids){
    let item=previous.get(id);if(item)reused++;else{item=createSourceSelection(s.r,id,scale);item.drawables=[...item.scene.children];s.parts.push(item);}
    ordered.push(item);
    if(item.counts.records||item.counts.hatches||item.counts.textRecords||item.counts.points){s.handled.add(id);for(const child of item.drawables)s.selectionScene.add(child);}
   }
   s.parts=ordered;s.ids=ids;this.stats.prepares=(this.stats.prepares||0)+1;this.stats.prepareMs=performance.now()-start;this.stats.sources=ids.length;this.stats.reusedSources=reused;
  }
  if(s.handled.size!==ids.length){clearSelection(s);return new Set();}
  if(s.handled.size){const start=performance.now();renderOverlay(s.r,s.selectionScene);ctx.drawImage(s.r.canvas,0,0,width,height);this.stats.drawSubmitMs=performance.now()-start;}
  return s.handled;
  }catch(error){clearSelection(s);s.r.renderSnapshot=null;this.stats.error=String(error.message);return new Set();}
 },
 get state(){return state;}
};
 return selectionBridge;
}
