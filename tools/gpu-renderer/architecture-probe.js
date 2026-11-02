// Read-only architectural diagnosis on a disposable drawing clone.
// Direct synchronous paint measures application work, not OS/presentation latency.
(async()=>{
 const api=__cadGpuTest;
 await document.fonts.ready;api.draw();
 const samples=[];
 const step=(name,command)=>{
  const before=api.state(),start=performance.now();__reg.edit(command);const commandMs=performance.now()-start;
  api.draw();const totalMs=performance.now()-start,state=api.state();
  samples.push({name,commandMs,totalMs,fullBuilds:state.stats.builds-before.stats.builds,incremental:state.stats.incrementalBuilds||0,drawCalls:state.stats.drawCalls,visibleChunks:state.stats.visibleChunks,gpu:state.stats.active,reason:state.stats.reason});
  if(!state.stats.active||!state.stats.drawCalls)throw Error('Invalid visible GPU comparison: '+name);
 };
 for(const type of ['line','block','text','hatch']){
  const id=__reg.first(type);if(!id)continue;
  for(const [name,command] of [
   ['MOVE',{type:'move',ids:[id],dx:10,dy:20}],
   ['ROTATE',{type:'rotate',ids:[id],base:{x:0,y:0},angle:5}],
   ['SCALE',{type:'scale',ids:[id],base:{x:0,y:0},factor:1.01}]
  ]){step(type+' '+name,command);step(type+' '+name+' UNDO',{type:'undo'});}
 }
 return {samples,scope:'One real drawing clone, visible fit view, synchronous command plus forced application paint. No OS input/presentation latency. No alternative CAD speed measurement.'};
})()
