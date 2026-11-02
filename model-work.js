// Object work shared by synchronous exports and cooperative viewport/export requests.
const completedCosts=new WeakMap();
export function drainModelWork(iterator) {
 let step;do {step=iterator.next();} while(!step.done);return step.value;
}
export function modelWorkAbort(signal) {
 if(signal?.aborted){const error=new Error('작업을 취소했습니다.');error.name='AbortError';throw error;}
}
export function modelWorkYield(signal) {
 const doc=globalThis.document;
 // No timer clamping in hidden documents or workers. They have no frame to draw.
 if(signal?.aborted||doc?.hidden||typeof requestAnimationFrame!=='function')return Promise.resolve();
 // Yield to runnable input/rendering without waiting for the next display refresh.
 if(typeof globalThis.scheduler?.yield==='function')return globalThis.scheduler.yield();
 return new Promise(resolve=>{
  let frame;
  const finish=()=>{if(frame!=null)cancelAnimationFrame(frame);doc?.removeEventListener('visibilitychange',hidden);signal?.removeEventListener('abort',finish);resolve();};
  const hidden=()=>{if(doc.hidden)finish();};
  signal?.addEventListener('abort',finish,{once:true});doc?.addEventListener('visibilitychange',hidden);frame=requestAnimationFrame(finish);
 });
}
export async function runModelWork(iterator,{onProgress,signal,yieldFrame=modelWorkYield,budgetMs=12,batchSize=Infinity,fastTaskMs=50}={}) {
 const customYield=yieldFrame!==modelWorkYield;
 try {
  modelWorkAbort(signal);
  // With presentation off, keep the original synchronous cost and result.
  if(!onProgress&&!customYield)return drainModelWork(iterator);
  const now=()=>globalThis.performance?.now?.()??Date.now();let start=now(),count=0,latest,yielded=false,workMs=0,key,priorMs,visibleRun=!globalThis.document?.hidden;
  const identity=Object.getPrototypeOf(iterator)||iterator,learn=!customYield&&batchSize===Infinity&&typeof requestAnimationFrame==='function';
  for(;;){
   const step=iterator.next();modelWorkAbort(signal);
   if(step.done){
    const cost=workMs+now()-start;if(latest)onProgress?.(latest);
    if(learn&&visibleRun&&!signal?.aborted&&!globalThis.document?.hidden&&key!==undefined){const costs=completedCosts.get(identity)||new Map();if(!costs.has(key)&&costs.size>=32)costs.delete(costs.keys().next().value);costs.set(key,cost);completedCosts.set(identity,costs);}
    return step.value;
   }
   if(step.value){latest=step.value;if(learn&&key===undefined&&Number.isFinite(latest.total)){key=(latest.phase||latest.kind||'')+':'+latest.total;priorMs=completedCosts.get(identity)?.get(key);}}
   // Hidden work finishes in this task; no rAF, scheduler or 4ms setTimeout chain.
   if(globalThis.document?.hidden){visibleRun=false;continue;}
   if(!customYield&&typeof requestAnimationFrame!=='function')continue;
   const elapsed=now()-start,batched=++count>=batchSize;
   if(!batched&&elapsed<budgetMs)continue;
   // Estimate only from real completed/total work, with a hard 50ms first-task cap.
   const short=!yielded&&!batched&&(priorMs<fastTaskMs||(latest?.done>0&&latest.total>=latest.done&&elapsed*latest.total/latest.done<fastTaskMs));
   if(short&&elapsed<fastTaskMs)continue;
   workMs+=elapsed;if(latest)onProgress?.(latest);modelWorkAbort(signal);await yieldFrame(signal);modelWorkAbort(signal);start=now();count=0;yielded=true;
  }
 } finally {iterator.return?.();}
}
