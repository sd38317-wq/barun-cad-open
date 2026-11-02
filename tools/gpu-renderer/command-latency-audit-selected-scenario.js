(async()=>{
const api=__cadGpuTest,wait=ms=>new Promise(r=>setTimeout(r,ms)),paint=()=>new Promise(r=>requestAnimationFrame(()=>setTimeout(r,0))),canvas=document.getElementById('canvas'),rect=canvas.getBoundingClientRect();
const pointer=(type,x,y,buttons=0)=>canvas.dispatchEvent(new PointerEvent(type,{bubbles:true,pointerId:1,pointerType:'mouse',button:0,buttons,clientX:rect.left+x,clientY:rect.top+y}));
const click=(x,y)=>{pointer('pointerdown',x,y,1);pointer('pointerup',x,y);};const esc=()=>canvas.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})),enter=()=>canvas.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));
const summaries=[],measure=async(name,fn)=>{__audit.reset();const t=performance.now();await fn();await paint();summaries.push({name,ms:performance.now()-t,totals:__audit.totals(),state:api.state()});};
const initial=api.state();
for(const id of ['osnap','snap','ortho'])document.getElementById(id).checked=false;
api.runCommand('LINE');click(70,70);click(180,70);esc();await paint();
let mx=125,my=70;
for(const command of ['MOVE','COPY','ERASE']){
 esc();await paint();await measure(command+' activate+select',async()=>{api.runCommand(command);click(mx,my);});
 if(api.state().selected.length!==1)throw Error('fixture selection failed '+JSON.stringify(api.state()));
 await measure(command+' accept selection',async()=>enter());
 if(command==='ERASE')continue;
 click(mx,my);await paint();await measure(command+' preview 30frames',async()=>{for(let i=0;i<30;i++){pointer('pointermove',mx+20+i,my+20);await paint();}});
 await measure(command+' commit+Esc+pointer',async()=>{click(mx+50,my+20);esc();pointer('pointermove',mx+60,my+30);});mx+=50;my+=20;
}
await measure('UNDO ERASE',async()=>api.runCommand('UNDO'));await measure('REDO ERASE',async()=>api.runCommand('REDO'));
for(const s of [0.05,0.5,1.47]){
 esc();await paint();const wx=(rect.width/2-initial.origin.x)/initial.scale,wy=(initial.origin.y-rect.height/2)/initial.scale;
 await measure('setView '+s,async()=>api.setView(s,{x:rect.width/2-wx*s,y:rect.height/2+wy*s}));
 await measure('alias l+Enter '+s,async()=>{canvas.focus();canvas.dispatchEvent(new KeyboardEvent('keydown',{key:'l',bubbles:true}));document.getElementById('coordinate').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));});
 await measure('first pointer '+s,async()=>pointer('pointermove',rect.width/2,rect.height/2));
}
return {initial,summaries};
})()
