import { compileGpuJob } from './gpu-compile-job.js';

// A whole-drawing result holds a million compiled items. Received as one
// message, the main thread deserialized it in a single 1-2 s task; parts of
// PART_ITEMS items arrive as separate short tasks, then the closing message.
const PART_ITEMS=20000;
self.onmessage=({data})=>{
  try {
    const result=compileGpuJob(data.job),items=result.compiled.items;
    if(items.length<=PART_ITEMS){self.postMessage({id:data.id,result});return;}
    for(let i=0;i<items.length;i+=PART_ITEMS)self.postMessage({id:data.id,part:items.slice(i,i+PART_ITEMS)});
    self.postMessage({id:data.id,parts:true,result:{...result,compiled:{...result.compiled,items:null}}});
  }
  catch(error) { self.postMessage({id:data.id,error:String(error?.message||error)}); }
};
