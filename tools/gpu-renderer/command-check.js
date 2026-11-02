(async()=>{
 const api=__cadGpuTest,wait=ms=>new Promise(r=>setTimeout(r,ms));
 api.load(await(await fetch('/tools/gpu-renderer/hospital.json')).json());
 await wait(1500);api.draw();
 const canvas=document.getElementById('canvas'),rect=canvas.getBoundingClientRect(),results=[];
 for(const command of ['SELECT','MOVE','COPY','LINE','PLINE']){
  canvas.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));await wait(100);
  const started=performance.now();api.runCommand(command);const commandMs=performance.now()-started;
  const moves=[];
  for(let i=0;i<20;i++){
   const t=performance.now();canvas.dispatchEvent(new PointerEvent('pointermove',{pointerId:1,pointerType:'mouse',buttons:0,clientX:rect.left+rect.width*(.3+i*.015),clientY:rect.top+rect.height*.5}));moves.push(performance.now()-t);await wait(16);
  }
  results.push({command,commandMs,maxMoveMs:Math.max(...moves),averageMoveMs:moves.reduce((a,b)=>a+b)/moves.length,stats:api.state().stats});
 }
 return results;
})()
