// Runs on a disposable clone. No user drawing or installed-window state changes.
(async()=>{
 const api=__cadGpuTest,canvas=document.getElementById('canvas');
 const paint=()=>__reg.paint();
 const rect=canvas.getBoundingClientRect();
 const key=(target,k)=>target.dispatchEvent(new KeyboardEvent('keydown',{key:k,bubbles:true,cancelable:true}));
 const pointer=(x,y)=>canvas.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,pointerId:1,pointerType:'mouse',button:0,buttons:0,clientX:rect.left+x,clientY:rect.top+y}));
 const samples=[],assert=(value,message)=>{if(!value)throw Error(message);};
 const measure=async(name,action)=>{const start=performance.now();const value=action();const syncMs=performance.now()-start;await paint();const state=api.state();const record={name,syncMs,paintMs:performance.now()-start,builds:state.stats.builds,incremental:state.stats.incrementalBuilds||0,gpu:state.stats.active,reason:state.stats.reason};samples.push(record);assert(record.gpu,name+': GPU inactive '+record.reason);return value;};
 await paint();key(canvas,'Escape');await paint();
 await measure('alias L + Enter',()=>{key(canvas,'l');key(document.getElementById('coordinate'),'Enter');});
 assert(api.state().mode==='LINE','alias L did not enter LINE');
 for(let i=0;i<30;i++)await measure('LINE snap pointer',()=>pointer(rect.width*(.3+i*.008),rect.height*.5));
 key(canvas,'Escape');await paint();
 const view=api.state(),cx=rect.width/2,cy=rect.height/2;
 const center={x:(cx-view.origin.x)/view.scale,y:(view.origin.y-cy)/view.scale};
 for(const s of [.01,.05,.5,1.47])await measure('zoom '+s,()=>api.setView(s,{x:cx-center.x*s,y:cy+center.y*s}));
 for(let i=0;i<15;i++)await measure('pan',()=>{const v=api.state();api.setView(v.scale,{x:v.origin.x+8,y:v.origin.y});});
 api.setView(view.scale,view.origin);await paint();
 for(const type of ['line','block','text','hatch']){
  const id=__reg.first(type);if(!id)continue;
  let ids;
  ids=await measure(type+' MOVE',()=>__reg.edit({type:'move',ids:[id],dx:10,dy:20}));
  await measure(type+' MOVE undo',()=>__reg.edit({type:'undo'}));
  await measure(type+' MOVE redo',()=>__reg.edit({type:'redo'}));
  await measure(type+' MOVE undo restore',()=>__reg.edit({type:'undo'}));
  ids=await measure(type+' COPY',()=>__reg.edit({type:'copy',ids:[id],dx:30,dy:20}));
  assert(ids.length===1,type+' COPY missing result');
  await measure(type+' COPY undo',()=>__reg.edit({type:'undo'}));
  await measure(type+' COPY redo',()=>__reg.edit({type:'redo'}));
  await measure(type+' COPY undo restore',()=>__reg.edit({type:'undo'}));
  await measure(type+' ERASE',()=>__reg.edit({type:'delete',ids:[id]}));
  await measure(type+' ERASE undo',()=>__reg.edit({type:'undo'}));
  await measure(type+' after-command pointer',()=>pointer(cx+30,cy+20));
 }
 const stableBuilds=api.state().stats.builds,rapidId=__reg.first('line');
 await measure('rapid MOVE + undo same frame',()=>{__reg.edit({type:'move',ids:[rapidId],dx:15,dy:20});__reg.edit({type:'undo'});});
 await measure('rapid MOVE twice same frame',()=>{__reg.edit({type:'move',ids:[rapidId],dx:15,dy:20});__reg.edit({type:'move',ids:[rapidId],dx:5,dy:2});});
 await measure('rapid undo twice same frame',()=>{__reg.edit({type:'undo'});__reg.edit({type:'undo'});});
 assert(api.state().stats.builds===stableBuilds,'rapid commands rebuilt the entire GPU scene');
 key(canvas,'Escape');await paint();key(canvas,'m');key(document.getElementById('coordinate'),'Enter');await paint();
 assert(api.state().mode==='MOVE','MOVE alias failed');
 const blank=[];for(let y=30;y<rect.height-30;y+=60)for(let x=30;x<rect.width-30;x+=60)if(!__reg.pickScreen(x,y))blank.push({x,y});
 assert(blank.length>=2,'no empty selection corners');
 const click=p=>{for(const type of ['pointerdown','pointerup'])canvas.dispatchEvent(new PointerEvent(type,{bubbles:true,pointerId:1,pointerType:'mouse',button:0,buttons:type==='pointerdown'?1:0,clientX:rect.left+p.x,clientY:rect.top+p.y}));};
 await measure('MOVE first corner click release',()=>click(blank[0]));
 assert(api.state().selectionWindow?.awaitingCorner,'first click did not retain selection window');
 await measure('MOVE selection follows released pointer',()=>pointer(blank[1].x,blank[1].y));
 assert(api.state().selectionWindow?.awaitingCorner,'released pointer lost selection window');
 await measure('MOVE second click selection',()=>click(blank[1]));
 assert(!api.state().selectionWindow,'second click did not commit selection');
 key(canvas,'Escape');await paint();
 const values=samples.map(s=>s.paintMs).sort((a,b)=>a-b);
 // Local hardware regression gate: command completion must not regress to
 // the former 600–1000 ms scene rebuilds. This is not an OS latency claim.
 assert(values[Math.floor(values.length*.95)]<100,'local p95 interaction budget exceeded');
 assert(values.at(-1)<250,'local maximum interaction budget exceeded');
 return {samples,summary:{count:samples.length,p95:values[Math.floor(values.length*.95)],max:values.at(-1)},final:api.state(),limitations:['Synthetic events and internal edit dispatch on a cloned real drawing; not OS input-to-display latency.']};
})()
