import {CadGpuRenderer} from './gpu-renderer.js';
import {applyDocument,renderRegion} from './gpu-render-protocol.js';
let renderer,doc,revision;
const fontsReady=(async()=>{
 const face=new FontFace('Barun Drawing Korean',`url(${new URL('./fonts/NanumGothic-Regular.ttf',import.meta.url)})`,{weight:'400',style:'normal'});
 await face.load();self.fonts.add(face);
})();
self.onmessage=async({data:m})=>{
 if(m.type!=='render')return;
 let bitmap;
 try{
  await fontsReady;
  // A worker has no document global: the renderer's synchronous-test default
  // would otherwise install a rejected large edit in one unbounded task.
  renderer??=new CadGpuRenderer({compileWorker:false,buildBudgetMs:30,canvasFactory:()=>{const c=new OffscreenCanvas(1,1);c.style={};return c;}});
  const start=performance.now();let edit=null;
  if(m.update){const applied=applyDocument(doc,revision,m.update);doc=applied.doc;edit=applied.edit;revision=m.revision;}
  if(!doc||revision!==m.revision)throw Error('GPU worker revision mismatch');
  const region=renderRegion(m.view,m.overscan);
  const canvas=renderer.render({...region,doc,revision,edit});
  // The next render request resumes the existing build on another event-loop
  // turn. Never label the old/half-built canvas as a completed new revision.
  if(renderer.buildTask){
   self.postMessage({id:m.id,epoch:m.epoch,token:m.token,revision,building:true,stats:{...renderer.stats,workerRenderMs:performance.now()-start}});return;
  }
  // createImageBitmap preserves the WebGL drawing buffer for unchanged views.
  bitmap=await createImageBitmap(canvas);
  self.postMessage({id:m.id,epoch:m.epoch,token:m.token,revision,view:m.view,region,bitmap,stats:{...renderer.stats,workerRenderMs:performance.now()-start}},[bitmap]);bitmap=null;
 }catch(error){bitmap?.close();self.postMessage({id:m.id,epoch:m.epoch,error:String(error?.stack||error)});}
};
