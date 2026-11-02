import * as G from './geometry.js';
import { compileGpuScene } from './gpu-scene.js';

// Pure CPU preparation shared by the module worker and its synchronous fallback.
// No DOM, Three objects, or editable document references cross back to the UI.
export function compileGpuJob({doc, scale, origin}) {
  const start=performance.now();
  const entities=G.visibleEntities(doc,{inPlace:true,lodScale:0,viewBox:null});
  if(!origin){const b=G.bounds(entities);origin=b?{x:(b.minX+b.maxX)/2,y:(b.minY+b.maxY)/2}:{x:0,y:0};}
  return {compiled:compileGpuScene(entities,{scale,origin}),origin,scale,compileMs:performance.now()-start};
}

// Stop at the threshold: deciding to offload must not itself traverse a huge
// drawing. Small local edits stay synchronous to avoid worker round-trip cost.
export function isHeavyGpuJob(entities,limit=1000) {
  let cost=0;
  const visit=e=>{
    cost+=1+Math.ceil((e.points?.length||0)/16);
    if(e.sharedBlock)return true;
    if(cost>=limit)return true;
    for(const child of e.entities||[])if(visit(child))return true;
    return false;
  };
  for(const entity of entities||[])if(visit(entity))return true;
  return false;
}

export function gpuJobDocument(doc,entities=doc.entities) {
  let sharedBlocks=doc.sharedBlocks;
  if(sharedBlocks){
    // postMessage clones the complete job synchronously. A local edit must
    // not also copy every unrelated shared definition from the drawing.
    // Keep original definition objects and all reachable nested references;
    // visibility, transforms and missing-reference errors remain compiler-owned.
    const definitions=sharedBlocks,needed=new Map(),visited=new Set(),seen=new WeakSet(),pending=[...entities];
    while(pending.length){
      const entity=pending.pop();if(!entity||seen.has(entity))continue;seen.add(entity);
      if(entity.sharedBlock&&!visited.has(entity.sharedBlock)){
        const name=entity.sharedBlock;visited.add(name);
        const definition=definitions[name];
        if(definition!==undefined){needed.set(name,definition);for(const child of definition?.entities||[])pending.push(child);}
      }
      for(const child of entity.entities||[])pending.push(child);
    }
    sharedBlocks=Object.fromEntries(needed);
  }
  return {entities,layers:doc.layers,linetypeScale:doc.linetypeScale,sharedBlocks};
}
