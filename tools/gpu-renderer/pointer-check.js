// Executed in an isolated Electron test window, never in the user's document.
(async()=>{
 const api=__cadGpuTest, wait=()=>new Promise(r=>setTimeout(r,100));
 const {blankDocument}=await import('/engine.js');
 const doc=blankDocument();
 doc.entities=[{id:'pointer-line',type:'line',layer:'default',points:[{x:0,y:0},{x:100,y:0}]}];
 api.load(doc); await wait(); api.setView(2,{x:180,y:240}); await wait();
 for(const id of ['osnap','snap','ortho'])document.getElementById(id).checked=false;
 const canvas=document.getElementById('canvas');
 const event=(type,x,y,buttons)=>{const r=canvas.getBoundingClientRect();canvas.dispatchEvent(new PointerEvent(type,{bubbles:true,pointerId:1,pointerType:'mouse',button:0,buttons,clientX:r.left+x,clientY:r.top+y}));};
 const read=()=>window.cad.getDocument().entities.find(e=>e.id==='pointer-line').points;
 const checks=[];
 for(const command of ['MOVE','COPY','ERASE']){
  api.load(doc);await wait();api.runCommand(command);await wait();api.setView(2,{x:180,y:240});await wait();
  event('pointerdown',150,200,1);event('pointerup',151,200,0);await wait();
  const released=api.state();
  if(!released.selectionWindow?.awaitingCorner)throw Error(command+' lost first corner');
  event('pointermove',410,270,0);await wait();
  const following=api.state();
  if(following.selectionWindow?.current?.x!==410)throw Error(command+' window did not follow released mouse');
  event('pointerdown',410,270,1);event('pointerup',410,270,0);await wait();
  const selected=api.state();
  if(!selected.selected.includes('pointer-line')||selected.selectionWindow)throw Error(command+' second click did not select '+JSON.stringify({released,following,selected,doc:window.cad.getDocument()}));
  checks.push({command,released,following,selected});
  canvas.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));await wait();
 }
 if(!api.state().stats.active)throw Error('GPU inactive');
 return {checks,stats:api.state().stats};
})()
