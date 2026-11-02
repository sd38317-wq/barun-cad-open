/** Lazy worker facade. Creating a client has no imports, workers or OCCT memory cost. */
export function createOcctClient({timeoutMs=120000}={}) {
  let worker,starting,closed=false,serial=1;
  const pending=new Map();
  const rejectAll=error=>{
    for(const entry of pending.values()){clearTimeout(entry.timer);entry.reject(error);}
    pending.clear();
  };
  const closeWithError=error=>{closed=true;rejectAll(error);worker?.terminate();};
  const start=()=>{
    if(closed)return Promise.reject(new Error('OCCT client is closed'));
    if(starting)return starting;
    starting=(async()=>{
      const node=typeof window==='undefined'&&typeof WorkerGlobalScope==='undefined'&&
        typeof process!=='undefined'&&!!process.versions?.node;
      const Ctor=node?(await import('node:worker_threads')).Worker:globalThis.Worker;
      if(!Ctor)throw new Error('Web Workers are not available');
      if(closed)throw new Error('OCCT client is closed');
      worker=new Ctor(new URL('./occt-worker.js',import.meta.url),{type:'module',...(node?{execArgv:[]}:{})});
      const receive=message=>{
        const entry=pending.get(message.id);if(!entry)return;
        if(message.progress){try{entry.onProgress?.(message.progress);}catch{}return;}
        pending.delete(message.id);clearTimeout(entry.timer);
        if(message.error){
          const error=new Error(message.error.message);error.code=message.error.code;entry.reject(error);
        }else entry.resolve(message.result);
      };
      if(node) {
        worker.on('message',receive);
        worker.on('error',closeWithError);
        worker.on('exit',code=>{if(!closed)closeWithError(new Error('OCCT worker exited '+code));});
      }else{
        worker.addEventListener('message',event=>receive(event.data));
        worker.addEventListener('error',event=>closeWithError(new Error(event.message||'OCCT worker failed')));
      }
      return worker;
    })().catch(error=>{starting=undefined;throw error;});
    return starting;
  };
  const request=async(method,payload,onProgress)=>{
    const target=await start();
    if(closed)throw new Error('OCCT client is closed');
    return new Promise((resolve,reject)=>{
      const id=serial++;
      const timer=setTimeout(()=>closeWithError(new Error('OCCT worker timed out during '+method)),timeoutMs);
      pending.set(id,{resolve,reject,timer,onProgress});
      try{target.postMessage({id,method,payload,...(onProgress?{progress:true}:{})});}catch(error){
        pending.delete(id);clearTimeout(timer);reject(error);
      }
    });
  };
  return {
    load: onProgress=>request('load',undefined,onProgress),
    build: (model,onProgress)=>request('build',{model},onProgress),
    plan: (handle,options)=>request('plan',{handle,options}),
    section: (handle,options)=>request('section',{handle,options}),
    elevation: (handle,options)=>request('elevation',{handle,options}),
    step: (handle,options)=>request('step',{handle,options}),
    dispose: handle=>request('dispose',{handle}),
    metrics: ()=>request('metrics'),
    async terminate() {
      if(closed)return;
      closed=true;rejectAll(new Error('OCCT client terminated'));
      if(starting)await starting.catch(()=>{});
      if(worker)await worker.terminate(); // destroys the complete WASM heap
    },
  };
}
