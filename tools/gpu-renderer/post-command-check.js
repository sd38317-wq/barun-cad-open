(async()=>{
 const api=__cadGpuTest,wait=ms=>new Promise(r=>setTimeout(r,ms));
 api.load(await(await fetch('/tools/gpu-renderer/hospital.json')).json());await wait(2200);api.draw();
 const canvas=document.getElementById('canvas'),rect=canvas.getBoundingClientRect(),results=[];
 const event=(type,x,y,buttons)=>canvas.dispatchEvent(new PointerEvent(type,{bubbles:true,pointerId:1,pointerType:'mouse',button:0,buttons,clientX:rect.left+x,clientY:rect.top+y}));
 const click=(x,y)=>{event('pointerdown',x,y,1);event('pointerup',x,y,0);};
 const escape=()=>canvas.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
 for(const id of ['osnap','snap','ortho'])document.getElementById(id).checked=false;
 for(let i=0;i<3;i++){
  escape();api.runCommand('LINE');click(60,60+i*20);
  const before=api.state(),started=performance.now();click(160,80+i*20);escape();
  const commandReturnMs=performance.now()-started;
  const move=performance.now();event('pointermove',180,100+i*20,0);const pointerMs=performance.now()-move;
  await new Promise(r=>requestAnimationFrame(()=>setTimeout(r,0)));const firstPaintMs=performance.now()-started;
  const after=api.state();results.push({commandReturnMs,pointerMs,firstPaintMs,before,after});await wait(1200);
 }
 return results;
})()
