// The receiver hands over only the latest array reference and its length.
// All inspection, layer labels and paint work runs in a bounded idle/rAF slice.
export const PREVIEW_INTERVAL_MS=100, PREVIEW_BUDGET_MS=2, MAX_FRAME_ENTITIES=300;
const MAX_SAMPLES=1536, PHASES=['파일 확인','변환','읽기','블록','화면 준비'];
const STYLE_ID='drawing-open-preview-style';
export function sampleImportEntity(entity){
 if(!entity||typeof entity!=='object')return null;
 const points=[],add=p=>{if(Number.isFinite(p?.x)&&Number.isFinite(p?.y))points.push([p.x,p.y]);};
 const b=entity._renderBounds;
 if(b&&[b.minX,b.minY,b.maxX,b.maxY].every(Number.isFinite)){
  add({x:b.minX,y:b.minY});add({x:b.maxX,y:b.maxY});
 }else if(Array.isArray(entity.points)){
  const n=entity.points.length;
  for(let i=0;i<Math.min(n,6);i++)add(entity.points[Math.floor(i*(n-1)/Math.max(1,Math.min(n,6)-1))]);
 }else if(entity.center&&Number.isFinite(entity.radius)){
  const r=Math.abs(entity.radius);add({x:entity.center.x-r,y:entity.center.y-r});add({x:entity.center.x+r,y:entity.center.y+r});
 }else add(entity.position||entity.center||entity.start);
 return points.length?{layer:String(entity.layer||'0'),points}:null;
}
export function createImportPreview({now=()=>performance.now()}={}){
 const samples=[],layers=new Map();
 let pending=null,length=0,offset=0,cursor=0,version=0,bounds=null;
 return {
  offer(items,size=items?.length||0){pending=items;length=size;offset=0;},
  collect(deadline){
   const count=Math.min(length,MAX_FRAME_ENTITIES);let inspected=0;
   while(pending&&offset<count&&inspected<MAX_FRAME_ENTITIES&&now()<deadline){
    const index=Math.floor(offset++*(length-1)/Math.max(1,count-1));inspected++;
    const sample=sampleImportEntity(pending[index]);if(!sample)continue;
    if(!layers.has(sample.layer)&&layers.size>=48)sample.layer='다른 레이어';
    if(!layers.has(sample.layer))layers.set(sample.layer,layers.size);
    sample.alpha=.35+(layers.get(sample.layer)%4)*.2;
    if(samples.length<MAX_SAMPLES)samples.push(sample);else samples[cursor++%MAX_SAMPLES]=sample;
    for(const [x,y] of sample.points){
     if(!bounds)bounds={minX:x,minY:y,maxX:x,maxY:y};
     else {bounds.minX=Math.min(bounds.minX,x);bounds.minY=Math.min(bounds.minY,y);bounds.maxX=Math.max(bounds.maxX,x);bounds.maxY=Math.max(bounds.maxY,y);}
    }
    version++;
   }
   if(offset>=count){pending=null;length=0;}
   return inspected;
  },
  clearPending(){pending=null;length=0;offset=0;},
  get samples(){return samples;},get pending(){return length;},
  get bounds(){return bounds;},get version(){return version;},get layers(){return layers;}
 };
}
/** One scheduled slice at most every 100 ms. No forced idle timeout during import. */
export function createPreviewScheduler({view,visible,work,now=()=>performance.now()}){
 let timer=0,idle=0,frame=0,active=false,last=-Infinity;
 const cancel=()=>{if(timer)view.clearTimeout(timer);if(idle)view.cancelIdleCallback(idle);if(frame)view.cancelAnimationFrame(frame);timer=idle=frame=0;};
 function schedule(){
  if(!active||!visible()||timer||idle||frame)return;
  timer=view.setTimeout(()=>{timer=0;if(!active||!visible())return;
   if(view.requestIdleCallback)idle=view.requestIdleCallback(tick);
   else frame=view.requestAnimationFrame(()=>tick());
  },Math.max(0,PREVIEW_INTERVAL_MS-(now()-last)));
 }
 function tick(idleDeadline){
  idle=frame=0;if(!active||!visible())return;
  const started=now();
  if(started-last<PREVIEW_INTERVAL_MS||idleDeadline&&idleDeadline.timeRemaining()<PREVIEW_BUDGET_MS){schedule();return;}
  const gap=started-last;last=started;
  // Reserve time for the callback bookkeeping and one indivisible canvas call.
  work(started,started+PREVIEW_BUDGET_MS-.5,gap);
  schedule();
 }
 return {start(){active=true;schedule();},pause(){active=false;cancel();},destroy(){active=false;cancel();}};
}
function installStyle(document){
 if(document.getElementById(STYLE_ID))return;
 const style=document.createElement('style');style.id=STYLE_ID;
 style.textContent='.drawing-load-overlay[data-drawing-open]{backdrop-filter:none;background:rgba(6,12,17,.88)}'+
 '.drawing-load-overlay[data-drawing-open] .drawing-load-card{width:min(720px,calc(100% - 32px));border-radius:6px;padding:20px;background:#20272e;font-size:13px}'+
 '.drawing-open-phases{display:flex;flex-wrap:wrap;gap:6px;margin:14px 0}.drawing-open-phases span{padding:5px 8px;border:1px solid #56636d;border-radius:3px;font-size:12px;color:#bdc8d0}.drawing-open-phases [aria-current=step]{color:#edf2f5;border-color:#9dcbe0}.drawing-open-phases [data-done=true]{color:#9dcbe0}'+
 '.drawing-open-preview{margin:14px 0}.drawing-open-preview canvas{display:block;width:100%;height:200px;background:#151c22;border:1px solid #45525b;border-radius:3px;box-sizing:border-box}.drawing-open-preview figcaption{margin-top:7px;color:#aeb9c1;font-size:12px;line-height:1.5}'+
 '.drawing-open-count{font-size:16px;color:#9dcbe0;font-variant-numeric:tabular-nums;margin:8px 0}.drawing-open-toggle{display:block;background:transparent;border:1px solid #63717b;border-radius:3px;color:#dbe5eb;padding:5px 9px;font:inherit;font-size:12px;margin:10px 0}'+
 '.drawing-load-overlay[data-drawing-open] small{font-size:12px;font-variant-numeric:tabular-nums}.drawing-load-overlay[data-drawing-open] [hidden]{display:none!important}';
 document.head.append(style);
}
export function mountDrawingOpenWait(overlay){
 if(!overlay)return null;
 const document=overlay.ownerDocument,view=document.defaultView,card=overlay.querySelector('.drawing-load-card');
 if(!card)return null;
 installStyle(document);overlay.dataset.drawingOpen='true';
 const phases=document.createElement('div');phases.className='drawing-open-phases';phases.setAttribute('aria-label','도면 열기 단계');
 const phaseNodes=PHASES.map(label=>{const node=document.createElement('span');node.textContent=label;phases.append(node);return node;});
 const figure=document.createElement('figure');figure.className='drawing-open-preview';
 const canvas=document.createElement('canvas');canvas.width=640;canvas.height=200;canvas.setAttribute('aria-label','이미 받은 객체의 레이어별 점과 경계 표본');
 const caption=document.createElement('figcaption');caption.textContent='실제 수신 객체의 점·경계 표본 · 레이어 구분과 쌓이는 모습은 연출';
 figure.append(canvas,caption);
 const count=document.createElement('div');count.className='drawing-open-count';count.textContent='받은 객체 0개';
 const toggle=document.createElement('button');toggle.type='button';toggle.className='drawing-open-toggle';
 // Large drawings take priority: preview is opt-in after the performance gate.
 let enabled=false;try{enabled=view.localStorage.getItem('barun.drawingWaitPreview')==='1';}catch{}
 card.querySelector('strong').after(phases);phases.after(figure,count,toggle);
 const progress=card.querySelector('progress'),detail=card.querySelector('#drawing-load-detail'),stageLabel=card.querySelector('#drawing-load-stage');
 let lastUiPaint=-Infinity,lastLabel=null,lastPercent=undefined,lastExtra=null,lastCount=null;
 let model=null,ctx=null,destroyed=false,finished=false,dirty=false,paintCursor=0,paintVersion=-1,phase=0,paintedPhase=-1,entities=0;
 const stats={frames:0,maxFrameMs:0,samples:0,minFrameGapMs:null,maxInspected:0,maxPainted:0};
 const layerNames=new Map();let layerSource=null,layerCursor=0,expected=null;
 const visible=()=>!document.hidden&&!overlay.hidden&&overlay.isConnected;
 function updateCount(){const key=entities+'/'+expected;if(key===lastCount)return;lastCount=key;count.textContent='받은 객체 '+entities.toLocaleString()+'개'+(Number.isFinite(expected)?' / '+expected.toLocaleString()+'개':'');}
 function tick(started,deadline,gap){
  if(!model||!enabled||finished||destroyed)return;
  if(Number.isFinite(gap))stats.minFrameGapMs=Math.min(stats.minFrameGapMs??Infinity,gap);
  const inspected=model.collect(Math.min(deadline,started+.5));
  while(layerSource&&layerCursor<Math.min(64,layerSource.length)&&performance.now()<started+.7){
   const layer=layerSource[layerCursor++];if(layer?.id&&layer.name)layerNames.set(String(layer.id),String(layer.name));
  }
  if(!ctx)ctx=canvas.getContext('2d');
  if(!ctx){enabled=false;syncEnabled();return;}
  if(model.version!==paintVersion&&performance.now()<deadline){
   paintVersion=model.version;dirty=true;paintCursor=0;ctx.clearRect(0,0,640,200);
   const names=[];for(const name of model.layers.keys()){names.push(layerNames.get(name)||name);if(names.length===3)break;}
   caption.textContent='실제 수신 객체의 점·경계 표본 · 표본 레이어 '+model.layers.size+'개 ('+names.join(', ')+(model.layers.size>3?' 외':'')+') · 쌓이는 모습은 연출';
  }
  const b=model.bounds,samples=model.samples;let painted=0;
  if(b&&dirty){
   const scale=Math.min(608/Math.max(1,b.maxX-b.minX),168/Math.max(1,b.maxY-b.minY));
   const x0=320-(b.minX+b.maxX)/2*scale,y0=100+(b.minY+b.maxY)/2*scale;
   while(paintCursor<samples.length&&painted<MAX_FRAME_ENTITIES&&performance.now()<deadline){
    const sample=samples[paintCursor++];painted++;ctx.globalAlpha=sample.alpha;ctx.fillStyle='#9dcbe0';
    for(const [x,y] of sample.points)ctx.fillRect(x0+x*scale,y0-y*scale,2,2);
   }
   dirty=paintCursor<samples.length;
  }
  stats.frames++;stats.samples=samples.length;stats.maxInspected=Math.max(stats.maxInspected,inspected);stats.maxPainted=Math.max(stats.maxPainted,painted);stats.maxFrameMs=Math.max(stats.maxFrameMs,performance.now()-started);
 }
 const scheduler=createPreviewScheduler({view,visible,work:tick});
 // Stable optional hooks: no getter allocation, sampling, DOM access or scheduling in the receiving loop.
 const offer=(items,total,size)=>{entities=total;model?.offer(items,size);};
 const setLayers=doc=>{layerSource=doc.layers;layerCursor=0;};
 const streamOptions={onProgress:p=>api.streamProgress(p)};
 function syncEnabled(){
  figure.hidden=!enabled;toggle.textContent=enabled?'미리보기 끄기':'미리보기 켜기';toggle.setAttribute('aria-pressed',String(enabled));
  scheduler.pause();model=null;ctx=null;layerSource=null;layerCursor=0;layerNames.clear();
  streamOptions.onEntities=undefined;streamOptions.onHeader=undefined;
  if(!enabled||finished||destroyed)return;
  model=createImportPreview();paintVersion=-1;paintCursor=0;dirty=false;
  streamOptions.onEntities=offer;streamOptions.onHeader=setLayers;scheduler.start();
 }
 const onToggle=()=>{enabled=!enabled;try{view.localStorage.setItem('barun.drawingWaitPreview',enabled?'1':'0');}catch{}syncEnabled();};
 const onVisibility=()=>{if(!visible()){scheduler.pause();model?.clearPending();}else if(enabled&&!finished&&!destroyed)scheduler.start();};
 toggle.addEventListener('click',onToggle);document.addEventListener('visibilitychange',onVisibility);
 const api={
  stats,streamOptions,
  get onEntities(){return streamOptions.onEntities;},
  setLayers(layers){if(enabled){layerSource=layers;layerCursor=0;}},
  streamProgress(p){
   if(destroyed||finished)return;
   entities=Number.isFinite(p.entities)?p.entities:entities;expected=p.expected;updateCount();
   // Receiving ends before block/display preparation; keep the final batch available until finish().
   api.update(p.stage,p.percent==null?null:p.percent*100,'','read');
  },
  update(label,percent=null,extra='',key){
   if(destroyed)return;
   // Repeated preparation counts need at most one DOM update per 100ms; phase changes stay immediate.
   const t=performance.now();if(key==null&&t-lastUiPaint<100)return;lastUiPaint=t;
   const next={check:0,convert:1,read:2,blocks:3,screen:4}[key];if(next!=null)phase=next;
   if(paintedPhase!==phase){paintedPhase=phase;phaseNodes.forEach((node,i)=>{if(i===phase)node.setAttribute('aria-current','step');else node.removeAttribute('aria-current');node.dataset.done=String(i<phase);});}
   if(lastPercent!==percent){lastPercent=percent;if(Number.isFinite(percent)){progress.hidden=false;progress.value=Math.max(0,Math.min(100,percent));}else {progress.hidden=true;progress.removeAttribute('value');}}
   if(Number.isFinite(percent))progress.setAttribute('aria-label',PHASES[phase]+' 진행');
   if(lastExtra!==extra){lastExtra=extra;detail.textContent=extra;}
   if(lastLabel!==label){lastLabel=label;stageLabel.textContent=label;}
   if(enabled&&!finished)scheduler.start();
  },
  finish(){finished=true;scheduler.pause();model?.clearPending();layerSource=null;streamOptions.onEntities=streamOptions.onHeader=undefined;},
  destroy(){if(destroyed)return;destroyed=true;scheduler.destroy();model=null;layerSource=null;streamOptions.onEntities=streamOptions.onHeader=undefined;toggle.removeEventListener('click',onToggle);document.removeEventListener('visibilitychange',onVisibility);phases.remove();figure.remove();count.remove();toggle.remove();delete overlay.dataset.drawingOpen;progress.hidden=false;progress.removeAttribute('aria-label');}
 };
 syncEnabled();return api;
}
