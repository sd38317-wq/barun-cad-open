(async()=>{
 const api=window.__cadGpuTest,checks=[],errors=[];
 const wait=ms=>new Promise(r=>setTimeout(r,ms));
 const classify=e=>['TypeError','RangeError','ReferenceError','SyntaxError'].includes(e?.name)?e.name:'Error';
 const onError=e=>{if(e.error)errors.push({code:'JAVASCRIPT_EXCEPTION',type:classify(e.error)});};
 const onReject=e=>errors.push({code:'UNHANDLED_REJECTION',type:classify(e.reason)});
 window.addEventListener('error',onError);window.addEventListener('unhandledrejection',onReject);
 let stage='setup',fixtureFailed=false;
 const execute=(command,phase='command')=>{stage=phase;return window.cad.execute(command);};
 const assert=(ok,code)=>{stage='assert';if(!ok)throw Error(code);};
 const safeError=error=>{
  const codes=new Map([['원/호의 중심 또는 반지름 오류','INVALID_ARC_OR_CIRCLE'],['레이어 정보 또는 이름 중복 오류','INVALID_LAYERS'],['객체의 레이어가 없습니다.','MISSING_LAYER'],['문자 속성 오류','INVALID_TEXT'],['길이가 0인 선입니다.','ZERO_LENGTH'],['객체 좌표 오류','INVALID_COORDINATES'],['블록 오류','INVALID_BLOCK'],['해치 속성 오류','INVALID_HATCH'],['객체 ID 중복 또는 오류','INVALID_ENTITY_ID']]);
  const locations=[...String(error?.stack||'').matchAll(/\/(engine|app|geometry|gpu-renderer|gpu-scene)\.js:(\d+):(\d+)/g)].slice(0,5).map(m=>({file:m[1]+'.js',line:Number(m[2]),column:Number(m[3])}));
  return {code:knownCodes.has(error.message)?error.message:codes.get(error.message)||'COMMAND_OR_CHECK_FAILED',type:classify(error),locations};
 };
 const knownCodes=new Set(['COUNT_CHANGED','BAD_GEOMETRY','SELECTION_FAILED','PAN_UNCHANGED','ZOOM_UNCHANGED','LOAD_FAILED']);
 const metrics=()=>{const s=api.state().stats;return Object.fromEntries(['active','builds','incrementalBuilds','buildMs','renderMs','drawCalls','spatialChunks','visibleChunks','culledChunks','cullMs'].filter(k=>typeof s[k]==='number'||typeof s[k]==='boolean').map(k=>[k,s[k]]));};
 const run=async(name,fn)=>{
  const publish=check=>console.info('CAD_QUALITY_PROGRESS '+JSON.stringify(check));
  publish({name,status:'running'});
  if(fixtureFailed&&!['SNAP_POINTER_SMOKE','FINAL_COUNT'].includes(name)){checks.push({name,status:'skipped',code:'FIXTURE_CREATION_FAILED'});return;}
  stage='input';const started=performance.now();
  try{await fn();stage='draw';api.draw();checks.push({name,status:'passed',scenarioMs:performance.now()-started,timingIncludesVerification:true,gpu:metrics()});}
  catch(error){if(name==='LINE_API')fixtureFailed=true;checks.push({name,status:'failed',stage,...safeError(error),...(error.qualityCleanup?{cleanupError:error.qualityCleanup}:{}),priorFailures:checks.filter(c=>c.status==='failed').map(c=>c.name),elapsedMs:performance.now()-started});}
  publish(checks.at(-1));
 };
 const loaded=await(await fetch('/inspection-document.json')).json();
 const baseCount=loaded.entities.length;
 await run('OPEN',()=>{api.load(loaded);assert(api.state().count===baseCount,'LOAD_FAILED');});
 await wait(500);api.draw();
 const initial=api.state();
 const canvas=document.getElementById('canvas');
 const pointer=(type,x,y,buttons=0,button=0)=>{const rect=canvas.getBoundingClientRect();canvas.dispatchEvent(new PointerEvent(type,{bubbles:true,pointerId:1,pointerType:'mouse',button,buttons,clientX:rect.left+x,clientY:rect.top+y}));};
 const escape=()=>canvas.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
 await run('PAN',()=>{const before=api.state();pointer('pointerdown',300,200,4,1);pointer('pointermove',320,210,4,1);pointer('pointerup',320,210,0,1);const after=api.state();assert(after.origin.x!==before.origin.x||after.origin.y!==before.origin.y,'PAN_UNCHANGED');});
 await run('ZOOM',()=>{const before=api.state().scale,rect=canvas.getBoundingClientRect();canvas.dispatchEvent(new WheelEvent('wheel',{bubbles:true,cancelable:true,deltaY:-100,clientX:rect.left+300,clientY:rect.top+200}));assert(api.state().scale!==before,'ZOOM_UNCHANGED');});
 api.setView(initial.scale,initial.origin);
 for(const id of ['osnap','snap','ortho'])document.getElementById(id).checked=false;
 // Place a disposable fixture just outside the original fitted viewport.
 const s=Math.max(initial.scale,1e-12),p={x:(-200-initial.origin.x)/s,y:(initial.origin.y+200)/s},unit=100/s;
 const layer=loaded.layers.find(l=>l.visible!==false&&!l.locked)?.id;
 if(!layer){checks.push({name:'EDIT_SCENARIOS',status:'blocked',code:'NO_EDITABLE_LAYER'});return {checks,errors,count:baseCount,coverage:'open-pan-zoom-only',gpu:metrics()};}
 let ids=[],copied=[],offset=[];
 const point=(x,y)=>({x:p.x+x*unit,y:p.y+y*unit});
 const get=id=>window.cad.getDocument().entities.find(e=>e.id===id);
 const near=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y)<Math.max(1e-5,unit*1e-6);
 await run('LINE_API',()=>{ids=execute({type:'add',entity:{type:'line',layer,points:[point(0,0),point(1,0)]}});assert(ids.length===1&&api.state().count===baseCount+1,'COUNT_CHANGED');});
 await run('SELECT_POINTER',()=>{escape();api.setView(s,{x:180-p.x*s,y:240+p.y*s});pointer('pointerdown',230,240,1);pointer('pointerup',230,240);assert(api.state().selected.includes(ids[0]),'SELECTION_FAILED');escape();});
 await run('SNAP_POINTER_SMOKE',()=>{document.getElementById('osnap').checked=true;api.runCommand('LINE');for(let i=0;i<8;i++)pointer('pointermove',180+i,240);escape();document.getElementById('osnap').checked=false;});
 await run('MOVE_API',()=>{execute({type:'move',ids,dx:unit,dy:unit});assert(near(get(ids[0]).points[0],point(1,1)),'BAD_GEOMETRY');});
 await run('COPY_API',()=>{copied=execute({type:'copy',ids,dx:unit,dy:0});assert(copied.length===1&&api.state().count===baseCount+2,'COUNT_CHANGED');});
 await run('ROTATE_API',()=>{execute({type:'rotate',ids,base:point(1,1),angle:90});assert(near(get(ids[0]).points[1],point(1,2)),'BAD_GEOMETRY');});
 await run('SCALE_API',()=>{execute({type:'scale',ids,base:point(1,1),factor:2});assert(near(get(ids[0]).points[1],point(1,3)),'BAD_GEOMETRY');});
 await run('OFFSET_API',()=>{offset=execute({type:'offset',ids,distance:unit*.2,side:point(0,1)});assert(offset.length===1&&api.state().count===baseCount+3,'COUNT_CHANGED');});
 for(const type of ['trim','extend'])await run(type.toUpperCase()+'_API',()=>{
  const temporary=new Set(),addLine=(a,b)=>{const added=execute({type:'add',entity:{type:'line',layer,points:[a,b]}});added.forEach(id=>temporary.add(id));return added[0];};
  let failure=null;
  try{
   const y=type==='trim'?0:2,boundaryX=type==='trim'?10.5:11.5;
   const target=addLine(point(10,y),point(11,y)),boundary=addLine(point(boundaryX,y-1),point(boundaryX,y+1));
   const changed=execute({type,id:target,boundaryIds:[boundary],pick:point(10.9,y)});changed.forEach(id=>temporary.add(id));
   assert(changed.length===1,'COUNT_CHANGED');
   assert(get(changed[0]).points.some(q=>near(q,point(boundaryX,y))),'BAD_GEOMETRY');
  }catch(error){failure={error,stage};}
  try{stage='cleanup';const live=new Set(window.cad.getDocument().entities.map(e=>e.id));const cleanup=[...temporary].filter(id=>live.has(id));if(cleanup.length)execute({type:'delete',ids:cleanup},'cleanup');}
  catch(error){if(failure)failure.error.qualityCleanup=safeError(error);else failure={error,stage};}
  if(failure){stage=failure.stage;throw failure.error;}
 });
 await run('ERASE_API',()=>{execute({type:'delete',ids:[...ids,...copied,...offset]});assert(api.state().count===baseCount,'COUNT_CHANGED');});
 await run('UNDO_API',()=>{execute({type:'undo'});assert(api.state().count===baseCount+3,'COUNT_CHANGED');});
 await run('REDO_API',()=>{execute({type:'redo'});assert(api.state().count===baseCount,'COUNT_CHANGED');});
 checks.push({name:'VISUAL_FIDELITY',status:'unverified',code:'NO_REFERENCE_IMAGE'});
 await run('FINAL_COUNT',()=>assert(api.state().count===baseCount,'COUNT_CHANGED'));
 await wait(100);window.removeEventListener('error',onError);window.removeEventListener('unhandledrejection',onReject);
 return {checks,errors,count:baseCount,gpu:metrics(),gpuFallback:!api.state().stats.active,limits:['hidden app: timings are not displayed FPS or end-to-end input latency','edit commands use app API; PAN/ZOOM/SELECT use synthetic DOM events','SNAP only smoke-tested, not geometric snap correctness','original entities were not edited; fixture interactions do not cover every original entity type']};
})()
