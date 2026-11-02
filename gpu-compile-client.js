// At most one revision is in flight. Superseding it terminates the worker so
// old expensive jobs cannot queue up behind the current command/undo operation.
export class GpuCompileClient {
  constructor({onReady=()=>{},createWorker=()=>new Worker(new URL('./gpu-compile-worker.js',import.meta.url),{type:'module'}),timeoutMs=15000}={}) {
    Object.assign(this,{onReady,createWorker,timeoutMs,serial:0,disabled:false,pending:null,worker:null});
  }
  select(doc,revision) {
    if(this.pending&&(this.pending.doc!==doc||this.pending.revision!==revision))this.cancel();
  }
  cancel() {
    clearTimeout(this.pending?.timer);this.pending=null;
    this.worker?.terminate();this.worker=null;
  }
  request(doc,revision,kind,job) {
    if(this.disabled)return null;
    this.select(doc,revision);
    if(this.pending&&this.pending.kind!==kind)this.cancel();
    if(this.pending)return this.pending.result?{result:this.pending.result}:{pending:true};
    const pending={doc,revision,kind,id:++this.serial,result:null};this.pending=pending;
    const fail=()=>{
      if(this.pending!==pending)return;
      this.disabled=true;this.cancel();this.onReady();
    };
    try {
      this.worker??=this.createWorker();
      this.worker.onmessage=({data})=>{
        if(this.pending!==pending||data.id!==pending.id)return;
        clearTimeout(pending.timer);
        if(data.error){fail();return;}
        // A large result arrives in parts (gpu-compile-worker.js), each one a
        // short task of its own; the worker is alive while they arrive.
        if(data.part){(pending.parts??=[]).push(data.part);pending.timer=setTimeout(fail,this.timeoutMs);return;}
        if(data.parts){const items=[];for(const part of pending.parts||[])for(const item of part)items.push(item);pending.parts=null;data.result.compiled.items=items;}
        pending.result=data.result;this.onReady();
      };
      this.worker.onerror=fail;this.worker.onmessageerror=fail;
      pending.timer=setTimeout(fail,this.timeoutMs);
      // A job factory is built only when it is posted: the renderer asks again
      // every frame while the job is pending (a whole-drawing job took 30-600 ms).
      this.worker.postMessage({id:pending.id,job:typeof job==='function'?job():job});
      return {pending:true};
    }catch{fail();return null;}
  }
  consume() {clearTimeout(this.pending?.timer);this.pending=null;}
  dispose() {this.cancel();this.disabled=true;}
}
