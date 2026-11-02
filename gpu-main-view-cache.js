import {alignRasterView,viewOf,renderRegion,cropRegion} from './gpu-render-protocol.js';

// Opt-in synchronous presentation cache. The controller decides whether to
// install it; constructing this module does not change renderer behavior.
export class GpuMainViewCache {
 constructor({overscan=128,maxPixels=16777216}={}){
  this.overscan=overscan;this.maxPixels=maxPixels;this.frame=null;
  this.stats={hits:0,misses:0,directFrames:0};
 }
 clear(){this.frame=null;}
 applied(renderer,options){
  return !renderer.failed&&!renderer.stats?.workerPending&&!renderer.compileClient?.pending&&
   renderer.doc===options.doc&&renderer.revision===options.revision&&renderer.stats?.appliedRevision===options.revision&&!!renderer.renderSnapshot;
 }
 crop(renderer,options,view){
  const frame=this.frame;
  if(!frame||frame.renderer!==renderer||frame.doc!==options.doc||frame.revision!==options.revision||!this.applied(renderer,options)||
   frame.snapshot!==renderer.renderSnapshot||frame.bitmap!==renderer.canvas||frame.width!==renderer.canvas.width||frame.height!==renderer.canvas.height)return null;
  return cropRegion(frame,view);
 }
 region(renderer,view){
  const d=view.pixelRatio,w=view.width*d,h=view.height*d;
  if(!(d>0&&w>0&&h>0)||![d,w,h].every(Number.isFinite)||Math.abs(w-Math.round(w))>1e-7||Math.abs(h-Math.round(h))>1e-7)return null;
  let limit=renderer.gl?.capabilities?.maxTextureSize||Infinity;
  const context=renderer.gl?.getContext?.();
  if(context?.MAX_RENDERBUFFER_SIZE!==undefined){const n=context.getParameter(context.MAX_RENDERBUFFER_SIZE);if(n>0)limit=Math.min(limit,n);}
  const W=Math.round(w),H=Math.round(h);
  let margin=Math.min(Math.round(Math.max(0,this.overscan)*d),Math.floor((limit-W)/2),Math.floor((limit-H)/2));
  if(Number.isFinite(this.maxPixels))margin=Math.min(margin,Math.floor((Math.sqrt((W-H)**2+4*Math.max(0,this.maxPixels))-W-H)/4));
  if(!(margin>0&&Number.isFinite(margin)))return null;
  return renderRegion(view,margin/d);
 }
 draw(ctx,renderer,input){
  const options=alignRasterView(input),view=viewOf(options),crop=this.crop(renderer,options,view);
  if(crop){
   const {bitmap}=this.frame;ctx.drawImage(bitmap,crop.x,crop.y,crop.w,crop.h,0,0,view.width,view.height);
   this.stats.hits++;return {hit:true,overscan:true};
  }
  // Do not retain the previous document or snapshot while a miss allocates a
  // replacement scene. No bitmap or second canvas is owned by this cache.
  this.clear();this.stats.misses++;
  const direct=()=>{
   const canvas=renderer.render({...options,...view});
   ctx.drawImage(canvas,0,0,view.width,view.height);this.stats.directFrames++;
   return {hit:false,overscan:false};
  };
  const region=this.region(renderer,view);if(!region)return direct();
  const canvas=renderer.render({...options,...region});
  if(canvas!==renderer.canvas||canvas.width!==Math.floor(region.width*view.pixelRatio)||canvas.height!==Math.floor(region.height*view.pixelRatio))return direct();
  const frame={renderer,doc:options.doc,revision:options.revision,view,region,bitmap:canvas,snapshot:renderer.renderSnapshot,width:canvas.width,height:canvas.height};
  const nextCrop=cropRegion(frame,view);if(!nextCrop)return direct();
  ctx.drawImage(canvas,nextCrop.x,nextCrop.y,nextCrop.w,nextCrop.h,0,0,view.width,view.height);
  if(this.applied(renderer,options))this.frame=frame;
  return {hit:false,overscan:true};
 }
}
