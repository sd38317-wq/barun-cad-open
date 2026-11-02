import { buildOcctBuilding, exportOcctStep } from './occt-building.js';
import { occtPlan, occtVerticalSection, occtElevation } from './occt-section.js';
import { loadOcct, getOcctLoadMetrics, occtMemorySnapshot } from './occt-loader.js';
const node = typeof WorkerGlobalScope === 'undefined' && typeof process !== 'undefined' && !!process.versions?.node;
let port;
if(node) port = (await import('node:worker_threads')).parentPort;
const send = (message,transfer=[]) => node?port.postMessage(message,transfer):globalThis.postMessage(message,transfer);
const buildings=new Map();
let loadedOc;
let serial=1,queue=Promise.resolve();
async function dispatch({method,payload={}},onProgress) {
  if(method==='load') { const oc=loadedOc=await loadOcct(); return {load:getOcctLoadMetrics(),memory:await occtMemorySnapshot(oc)}; }
  if(method==='build') {
    const building=await buildOcctBuilding(payload.model,{onProgress}),handle=String(serial++);
    loadedOc=building.oc;
    buildings.set(handle,building);
    return {handle,stories:building.stories,bounds:building.bounds,ignored:building.ignored,
      records:building.records.map(({shape,...record})=>record),load:getOcctLoadMetrics(),
      memory:await occtMemorySnapshot(building.oc)};
  }
  if(method==='metrics')return {load:getOcctLoadMetrics(),
    memory:await occtMemorySnapshot(loadedOc),models:buildings.size};
  const building=buildings.get(payload.handle);
  if(!building)throw new Error('Unknown OCCT worker model handle');
  if(method==='plan')return occtPlan(building,payload.options);
  if(method==='section')return occtVerticalSection(building,payload.options);
  if(method==='elevation')return occtElevation(building,payload.options);
  if(method==='step')return exportOcctStep(building,payload.options);
  if(method==='dispose') {building.dispose();buildings.delete(payload.handle);return true;}
  throw new Error('Unknown OCCT operation '+method);
}
const receive=message=>{
  // Serialize operations: OCCT and its virtual FS are not reentrant.
  queue=queue.then(async()=>{
    try {
      const result=await dispatch(message,message.progress?progress=>send({id:message.id,progress}):undefined);
      send({id:message.id,result},result instanceof Uint8Array?[result.buffer]:[]);
    }catch(error){send({id:message.id,error:{message:error.message,code:error.code??'OCCT_OPERATION_FAILED'}});}
  });
};
if(node)port.on('message',receive);
else globalThis.addEventListener('message',event=>receive(event.data));
