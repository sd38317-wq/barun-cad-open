(async()=>{
const api=__cadGpuTest,paint=()=>new Promise(r=>requestAnimationFrame(()=>setTimeout(r,0))),canvas=document.getElementById('canvas'),rect=canvas.getBoundingClientRect();
const pointer=(x,y)=>canvas.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,pointerId:1,pointerType:'mouse',button:0,buttons:0,clientX:rect.left+x,clientY:rect.top+y}));
api.runCommand('LINE');await paint();const initial=api.state(),samples=[];__audit.reset();
for(let pass=0;pass<2;pass++)for(let i=0;i<30;i++){const t=performance.now();pointer(rect.width*(.3+i*.008),rect.height*.5);const syncMs=performance.now()-t;await paint();samples.push({pass,i,syncMs,paintMs:performance.now()-t});}
return {initial,samples,totals:__audit.totals(),state:api.state()};
})()
