(async()=>{
const api=__cadGpuTest,paint=()=>new Promise(r=>requestAnimationFrame(()=>setTimeout(r,0))),canvas=document.getElementById('canvas'),rect=canvas.getBoundingClientRect();
const pointer=(type,x,y,buttons=0)=>canvas.dispatchEvent(new PointerEvent(type,{bubbles:true,pointerId:1,pointerType:'mouse',button:0,buttons,clientX:rect.left+x,clientY:rect.top+y}));
const click=(x,y)=>{pointer('pointerdown',x,y,1);pointer('pointerup',x,y);};const esc=()=>canvas.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
const summaries=[],measure=async(name,fn)=>{__audit.reset();const t=performance.now();await fn();await paint();summaries.push({name,ms:performance.now()-t,totals:__audit.totals(),state:api.state()});};
const initial=api.state();for(const id of ['osnap','snap','ortho'])document.getElementById(id).checked=false;
for(const type of ['block','text','hatch']){
 esc();await paint();const fixture=__audit.selectFirst(type);await paint();summaries.push({name:'fixture '+type,fixture});
 await measure('MOVE '+type+' command',async()=>api.runCommand('MOVE'));click(120,120);await paint();
 await measure('MOVE '+type+' preview',async()=>pointer('pointermove',140,140));
 await measure('MOVE '+type+' commit+Esc+pointer',async()=>{click(140,140);esc();pointer('pointermove',150,150);});
 await measure('UNDO '+type,async()=>api.runCommand('UNDO'));
}
return {initial,summaries};
})()
