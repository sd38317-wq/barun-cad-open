import {viewOf,sameView,planDocument,cropRegion} from './gpu-render-protocol.js';

// One render in flight, one latest desired view. Never queue mousemove frames.
export class GpuRenderClient {
 constructor({onChange=()=>{},createWorker=()=>new Worker(new URL('./gpu-render-worker.js',import.meta.url),{type:'module'}),overscan=128,timeoutMs=120000}={}){
  Object.assign(this,{onChange,createWorker,overscan,timeoutMs,epoch:1,serial:0,token:0,frame:null,pending:null,desired:null,worker:null,disposed:false,failed:null,stats:{backend:'MLightCAD Worker',workerPending:true,frames:0,staleFrames:0}});
 }
 fail(error){this.failed=String(error?.message||error);this.clearScene();this.onChange();}
 clearScene(){clearTimeout(this.timer);this.worker?.terminate();this.worker=null;this.frame?.bitmap.close();this.frame=null;this.pending=null;this.desired=null;this.sentDoc=null;this.sentRevision=null;this.displayedDoc=null;this.epoch++;Object.assign(this.stats,{workerPending:true,viewPending:true,displayedView:null,displayedRevision:null});}
 request(options){
  if(this.disposed)throw Error('GPU worker disposed');if(this.failed)throw Error(this.failed);
  const view=viewOf(options),changed=!this.desired||this.desired.doc!==options.doc||this.desired.revision!==options.revision;
  if(changed)this.token++;
  this.desired={...options,view,token:this.token};
  if(this.frame&&(this.frame.token!==this.token||this.frame.revision!==options.revision)){this.frame.bitmap.close();this.frame=null;}
  const crop=this.frame&&cropRegion(this.frame,view);
  if(!crop||!sameView(this.frame.view,view))this.dispatch();
  this.stats.workerPending=!!this.pending||!crop;
  this.stats.viewPending=!crop;
  this.stats.displayedView=crop?view:this.frame?.view||null;
  this.displayedDoc=this.frame?options.doc:null;this.stats.displayedRevision=this.frame?options.revision:null;
  if(crop)return {bitmap:this.frame.bitmap,crop,view};
  if(this.frame){const previousCrop=cropRegion(this.frame,this.frame.view);if(previousCrop)return {bitmap:this.frame.bitmap,crop:previousCrop,view:this.frame.view};}
  return null;
 }
 dispatch(){
  if(this.pending||!this.desired||this.disposed||this.failed)return;
  const target=this.desired;
  if(this.frame&&this.frame.token===target.token&&sameView(this.frame.view,target.view))return;
  const before=performance.now(),update=planDocument(this.sentDoc,this.sentRevision,target);
  try{
   if(!this.worker){
    const worker=this.createWorker(),epoch=this.epoch;this.worker=worker;worker.onmessage=e=>this.receive(e.data);
    const fail=message=>{if(this.worker===worker&&this.epoch===epoch)this.fail(message);};
    worker.onerror=e=>fail(e.message||'GPU worker failed');worker.onmessageerror=()=>fail('GPU worker message failed');
   }
   const job={id:++this.serial,epoch:this.epoch,token:target.token,revision:target.revision,view:target.view,update,overscan:this.overscan};
   this.pending={...job,started:performance.now()};
   this.timer=setTimeout(()=>this.fail('GPU worker timed out'),this.timeoutMs);
   this.worker.postMessage({...job,type:'render'});
   this.sentDoc=target.doc;this.sentRevision=target.revision;
   this.stats.workerPending=true;this.stats.submitMs=performance.now()-before;
   if(update)this.stats.documentMessages=(this.stats.documentMessages||0)+1;
   this.stats.viewMessages=(this.stats.viewMessages||0)+1;
  }catch(error){this.fail(error);}
 }
 receive(message){
  if(this.disposed||message.epoch!==this.epoch||message.id!==this.pending?.id){message.bitmap?.close();return;}
  clearTimeout(this.timer);const job=this.pending;this.pending=null;
  if(message.error){message.bitmap?.close();this.fail(message.error);return;}
  const target=this.desired;
  if(message.building){
   message.bitmap?.close();
   if(target&&message.token===target.token&&message.revision===target.revision)Object.assign(this.stats,message.stats,{backend:'MLightCAD Worker'});
   this.stats.workerPending=true;
   this.dispatch();this.onChange();return;
  }
  // A completed overscan frame can serve a newer view only through an exact
  // integer-pixel crop; no stale zoom, different document, or fractional warp.
  const compatible=target&&message.token===target.token&&message.revision===target.revision&&cropRegion(message,target.view);
  if(compatible){this.frame?.bitmap.close();this.frame=message;Object.assign(this.stats,message.stats,{backend:'MLightCAD Worker',workerRoundtripMs:performance.now()-job.started});}
  else{message.bitmap?.close();this.stats.staleFrames++;}
  this.stats.workerPending=false;
  this.dispatch();this.onChange();
 }
 draw(ctx,options){
  const ready=this.request(options);
  if(ready){const {bitmap,crop:c,view}=ready;ctx.drawImage(bitmap,c.x,c.y,c.w,c.h,0,0,view.width,view.height);}
  else{ctx.save();ctx.font='14px sans-serif';ctx.fillStyle='#a8b8c5';ctx.fillText('GPU 화면 준비 중',20,30);ctx.restore();}
  return true;
 }
 dispose(){this.disposed=true;this.clearScene();}
}
