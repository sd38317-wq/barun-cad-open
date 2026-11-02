import {alignRasterView} from './gpu-render-protocol.js';

// A drawing tab keeps its built GPU scene while another tab is shown: switching
// back to a 7,800-object plan (1M primitives) rebuilt it for 6-8 s. One scene is
// kept aside, and only while both scenes together stay within this budget.
export const PARKED_SCENE_ITEM_BUDGET=1500000;
// A smaller scene is not kept aside: the tab switch keeps the current renderer
// and its selection overlay, as before. A fresh renderer has no frame snapshot
// and dropping the overlay clears the current one, so opening a drawing from a
// small (or the empty start) tab repainted everything: 6.0.18 A/B on the 2.5 MB
// a2119 drawing, first frame 0.49 s -> 0.74 s; kept renderer 0.45 s (2026-10-08).
export const PARK_MIN_SCENE_ITEMS=50000;
/** Switching to tab `key`: take back its kept scene, keep the current renderer, or start a fresh one. */
export const sceneSwitchPlan=({kept,previousItems})=>kept?'restore':previousItems<PARK_MIN_SCENE_ITEMS?'keep':'fresh';
export function createGpuController({onChange=()=>{}}={}) {
  const workerMode=new URLSearchParams(location.search).get('renderer')==='gpu-worker';
  let instance=null,loading=null,failedKey=null,reason='',enabled=workerMode||new URLSearchParams(location.search).get('renderer')==='gpu';
  let selectionOverlay=null,Renderer=null,sceneKey=null;const parked=new Map();
  const control=document.createElement('button');control.id='gpu-renderer-toggle';control.type='button';
  const update=()=>{control.textContent=enabled?(reason?'GPU 호환 대기':'GPU 화면'):'기존 화면';control.title=reason||'MLightCAD GPU 화면 / 기존 화면 비교';};
  const ensure=()=>loading??=(Promise.all(workerMode?[import('./gpu-render-client.js')]:[import('./gpu-renderer.js'),import('./gpu-selection-overlay.js')]).then(([module,selection])=>{Renderer=workerMode?null:module.CadGpuRenderer;instance=workerMode?new module.GpuRenderClient({onChange}):new module.CadGpuRenderer({onChange});selectionOverlay=selection?.createGpuSelectionOverlay();reason='';update();onChange();}).catch(error=>{reason=String(error.message);update();onChange();}));
  const release=renderer=>{try{renderer.dispose();renderer.gl?.forceContextLoss?.();}catch{}};
  const releaseParked=()=>{for(const renderer of parked.values())release(renderer);parked.clear();};
  const items=renderer=>Number(renderer?.stats?.items)||0;
  // Shows the scene of drawing tab `key`: the current one is kept aside (if
  // small enough) and a kept scene of `key` is taken back unchanged.
  const selectScene=key=>{
    if(workerMode||!Renderer||key==null||key===sceneKey)return;
    if(sceneKey==null){sceneKey=key;return;}
    const previous=instance,previousKey=sceneKey;
    if(sceneSwitchPlan({kept:parked.has(key),previousItems:items(previous)})==='keep'){sceneKey=key;return;}
    instance=parked.get(key)||null;parked.delete(key);
    if(instance)instance.restoredScene=true;else instance=new Renderer({onChange});
    sceneKey=key;selectionOverlay?.dispose();
    releaseParked();
    if(previous&&!previous.failed&&!previous.buildTask&&!previous.editTask&&previous.doc&&items(previous)+items(instance)<=PARKED_SCENE_ITEM_BUDGET){previous.releaseSurface?.();parked.set(previousKey,previous);}
    else if(previous)release(previous);
  };
  control.onclick=()=>{enabled=!enabled;if(!enabled){selectionOverlay?.dispose();releaseParked();}reason='';failedKey=null;if(enabled)ensure();update();onChange();};
  (document.querySelector('.canvas-view-tools')||document.querySelector('.canvas-toolbar')).append(control);update();if(enabled)ensure();
  const fontChanged=()=>{selectionOverlay?.dispose();instance?.clearScene();releaseParked();failedKey=null;onChange();};
  document.fonts?.addEventListener('loadingdone',fontChanged);
  return {
    get key(){return `${enabled}:${!!instance}:${reason}:${workerMode?instance?.stats.frames:0}`;},
    get displayedDoc(){return workerMode?instance?.displayedDoc:null;},
    get buildPending(){return enabled&&!reason&&!!instance?.buildTask;},
    get stats(){return {enabled,active:enabled&&!!instance&&!reason,reason,...(workerMode&&!instance?{backend:'MLightCAD Worker',workerPending:true,viewPending:true}:{}),...instance?.stats,selection:selectionOverlay?.stats};},
    draw(ctx,options){
      if(!enabled)return false;
      options=alignRasterView(options);
      if(!instance){if(workerMode&&!reason){ctx.save();ctx.font='14px sans-serif';ctx.fillStyle='#a8b8c5';ctx.fillText('GPU 화면 준비 중',20,30);ctx.restore();return true;}return false;}
      selectScene(options.sceneKey);
      // The active scene grew: a kept scene no longer fits beside it.
      if(parked.size&&[...parked.values()].reduce((n,r)=>n+items(r),items(instance))>PARKED_SCENE_ITEM_BUDGET)releaseParked();
      const key=[options.doc,options.revision];
      if(failedKey?.[0]===key[0]&&failedKey?.[1]===key[1])return false;
      try{if(workerMode){const {completeDisplay,...workerOptions}=options;instance.draw(ctx,workerOptions);reason='';update();return true;}const canvas=instance.render(options);if(!instance.buildTask)ctx.drawImage(selectionOverlay.base(instance,canvas),0,0,options.width,options.height);reason='';update();return true;}
      catch(error){failedKey=key;reason=String(error.message);selectionOverlay?.dispose();instance.clearScene();update();console.warn('GPU renderer fallback:',reason);return false;}
    },
    drawSelection(ctx,entities,selected,highlights,scale,width,height){return enabled&&!workerMode&&!reason&&instance&&!instance.buildTask?selectionOverlay.draw(ctx,entities,selected,highlights,scale,width,height):new Set();},
    setEnabled(value){enabled=!!value;if(!enabled){selectionOverlay?.dispose();releaseParked();}failedKey=null;reason='';if(enabled)ensure();update();onChange();},
    get parkedScenes(){return parked.size;},
    // Hidden tab: keep built scenes, drop the window-sized drawing buffers.
    releaseSurfaces(){selectionOverlay?.dispose();instance?.releaseSurface?.();for(const renderer of parked.values())renderer.releaseSurface?.();},
    // Scenes of closed drawing tabs are released at once.
    retainScenes(keys){const open=new Set(keys);for(const [key,renderer] of parked)if(!open.has(key)){parked.delete(key);release(renderer);}},
    dispose(){document.fonts?.removeEventListener('loadingdone',fontChanged);selectionOverlay?.dispose();releaseParked();instance?.dispose();control.remove();}
  };
}
