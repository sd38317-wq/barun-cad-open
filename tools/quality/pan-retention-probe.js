(async () => {
  // Internal, synthetic-document probes. No live document or file dialogs are used.
  const checks = [];
  const api = globalThis.__cadGpuTest, qa = globalThis.__barunQuality;
  const assert = (value, message) => { if (!value) throw Error(message); };
  assert(api && qa, 'Packaged quality bridge is unavailable');
  const canvas = document.querySelector('#canvas');
  const input = document.querySelector('#coordinate');
  const doc = {version:2, units:'mm', layers:[{id:'default',name:'0',color:'#ffffff',visible:true}],entities:[]};
  const line = (id, x1, y1, x2, y2) => ({id,type:'line',layer:'default',points:[{x:x1,y:y1},{x:x2,y:y2}]});
  const load = entities => { qa.reset(); api.load({...doc, entities}); api.setView(1,{x:0,y:400}); };
  const pointer = (type,x,y,buttons) => {
    const r=canvas.getBoundingClientRect();
    canvas.dispatchEvent(new PointerEvent(type,{bubbles:true,clientX:r.left+x,clientY:r.top+y,button:0,buttons,pointerId:1,pointerType:'mouse'}));
  };
  const click = (x,y) => {pointer('pointerdown',x,y,1);pointer('pointerup',x,y,0);};
  const submit = text => {input.value=text;qa.submit();};
  const check = async (id, action) => {
    const start=performance.now();
    try { await action(); checks.push({id,status:'passed',durationMs:performance.now()-start}); }
    catch(error) {checks.push({id,status:'failed',durationMs:performance.now()-start,detail:String(error.message||error)});}
    finally {qa.reset(); for(const dialog of document.querySelectorAll('dialog[open]'))dialog.close();}
  };
  await check('GPU_PAN_PIXEL_RETENTION',()=>{
    load([line('pan-line',20,40,450,220),{id:'pan-fill',type:'hatch',layer:'default',solid:true,points:[{x:40,y:40},{x:220,y:40},{x:220,y:220},{x:40,y:220}]},{id:'pan-text',type:'text',layer:'default',text:'PAN 검증',height:30,position:{x:100,y:120}}]);
    api.draw();const before=api.state().stats,ctx=canvas.getContext('2d'),pixels=ctx.getImageData(0,0,canvas.width,canvas.height).data;
    const step=1/devicePixelRatio;
    for(let i=1;i<=10;i++)api.setView(1,{x:i*step,y:400+i*step});
    for(let i=9;i>=0;i--)api.setView(1,{x:i*step,y:400+i*step});
    api.draw();const after=api.state().stats,restored=ctx.getImageData(0,0,canvas.width,canvas.height).data;
    assert(after.active&&!after.reason,'Pan disabled GPU');
    assert(after.panReusedFrames>=(before.panReusedFrames||0)+20,'Micro pan did not reuse rendered pixels');
    assert(after.fullFrames===before.fullFrames,'Integer pixel pan redrew the full drawing');
    let differences=0,maxDifference=0,firstDifference=-1;for(let i=0;i<pixels.length;i++)if(pixels[i]!==restored[i]){differences++;maxDifference=Math.max(maxDifference,Math.abs(pixels[i]-restored[i]));if(firstDifference<0)firstDifference=i;}
    assert(pixels.length===restored.length&&!differences,'Pan round trip changed drawing pixels: '+differences+' channels; max '+maxDifference+'; first '+Math.floor(firstDifference/4)%canvas.width+','+Math.floor(firstDifference/4/canvas.width));
  });
  return {checks};
})();
