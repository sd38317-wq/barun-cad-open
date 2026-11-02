(async()=>{
 const {CadGpuRenderer:Before}=await import('/gpu-renderer-before-spatial.js');
 const {gpu,doc,width,height,scale,origin}=compare;
 const before=new Before();
 const views=[];
 const read=renderer=>{const gl=renderer.gl.getContext(),pixels=new Uint8Array(width*height*4);gl.readPixels(0,0,width,height,gl.RGBA,gl.UNSIGNED_BYTE,pixels);return pixels;};
 const params=(factor,x,y)=>({doc,revision:1,width,height,scale:scale*factor,origin:{x:width/2-(x-origin.x)/scale*scale*factor,y:height/2-(y-origin.y)/scale*scale*factor}});
 const sample=renderer=>{const times=[];for(let i=0;i<12;i++){const t=performance.now();renderer.render(current);times.push(performance.now()-t);}times.sort((a,b)=>a-b);return {p50:times[6],p95:times[11]};};
 let current;
 for(const [name,factor,x,y] of [['overview',1,width/2,height/2],['centre',8,width/2,height/2],['left',8,width*.45,height*.5],['right',8,width*.55,height*.5],['edge',16,width*.55,height*.6]]){
  current=params(factor,x,y);for(let warm=0;warm<4;warm++)gpu.render(current);const pixels=read(gpu),stats={...gpu.stats},culledImage=gpu.canvas.toDataURL();
  // Same compiled geometry with all spatial roots attached provides a strict
  // no-missing-pixels reference, without conflating batching and culling.
  const saved=gpu.updateViewport;
  if(typeof saved!=='function')throw Error('Expected renderer.updateViewport hook');
  gpu.updateViewport=function(){for(const object of this.spatialObjects.keys())this.scene.add(object);this.activeObjects=new Set(this.spatialObjects.keys());};
  gpu.render(current);const full=read(gpu),fullImage=gpu.canvas.toDataURL();gpu.render(current);const repeat=read(gpu);gpu.updateViewport=saved;
  let differentPixels=0;for(let i=0;i<pixels.length;i+=4)if(pixels[i]!==full[i]||pixels[i+1]!==full[i+1]||pixels[i+2]!==full[i+2]||pixels[i+3]!==full[i+3])differentPixels++;
  const diagnostic={repeatDiff:0,maxDelta:0,over10:0};
  for(let i=0;i<pixels.length;i+=4){const delta=Math.max(...[0,1,2,3].map(c=>Math.abs(pixels[i+c]-full[i+c])));diagnostic.maxDelta=Math.max(diagnostic.maxDelta,delta);if(delta>10)diagnostic.over10++;if([0,1,2,3].some(c=>repeat[i+c]!==full[i+c]))diagnostic.repeatDiff++;}
  if(differentPixels){
   const lines=new Set([...gpu.lineBatches.values()].flatMap(b=>b.objects));
   for(const kind of ['line','text','hatch']){
    gpu.updateViewport=function(box,s){saved.call(this,box,s);for(const object of this.spatialObjects.keys()){const category=lines.has(object)?'line':object.isMesh?'text':'hatch';if(category===kind){this.scene.add(object);this.activeObjects.add(object);}}};
    gpu.render(current);const check=read(gpu);let diff=0;for(let i=0;i<full.length;i+=4)if(check[i]!==full[i]||check[i+1]!==full[i+1]||check[i+2]!==full[i+2]||check[i+3]!==full[i+3])diff++;diagnostic[kind]=diff;
   }
   gpu.updateViewport=saved;
  }
  // Restore attachment tracking after the test-only override.
  gpu.render(current);before.render(current);
  const baseline=sample(before),baselinePrimitives={...before.gl.info.render},spatial=sample(gpu),spatialPrimitives={...gpu.gl.info.render};
  views.push({name,differentPixels,diagnostic,baseline,spatial,baselinePrimitives,spatialPrimitives,stats,...(differentPixels?{culledImage,fullImage}:{})});
 }
 before.dispose();return {note:'CPU render-call durations, hidden isolated window; not input latency or display FPS.',views};
})()
