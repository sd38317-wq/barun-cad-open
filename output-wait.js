import {mountWaitStage} from './wait-stage.js';

const STYLE_ID='barun-output-wait-style';
function style(document){
 if(document.getElementById(STYLE_ID))return;
 const node=document.createElement('style');node.id=STYLE_ID;
 node.textContent=`.barun-output-stage{font-size:12px;pointer-events:none}.barun-output-stage .barun-wait-stage__detail,.barun-output-stage .barun-wait-stage__note,.barun-output-stage[data-compact=true]{font-size:12px}.barun-output-stage .barun-wait-stage__note{top:calc(100% + 30px)}.barun-output-facts{position:absolute;left:20px;bottom:var(--barun-output-bottom,56px);padding:7px 10px;border:1px solid #586c77;border-radius:3px;background:#18222a;color:#e9f0f3;font:12px/1.5 sans-serif;font-variant-numeric:tabular-nums}.barun-output-stage .barun-wait-stage__detail{color:#e9f0f3;background:#18222a;padding:3px 7px;border-radius:3px}.barun-output-visual{position:absolute;inset:0;z-index:16;overflow:hidden;pointer-events:none}.barun-output-sweep{position:absolute;inset:0 auto 0 0;width:3px;background:#9dcbe0;opacity:.65}.barun-output-pages{position:absolute;right:24px;bottom:var(--barun-output-bottom,56px);display:grid;gap:8px;width:min(280px,calc(100% - 48px));font:12px/1.5 sans-serif;font-variant-numeric:tabular-nums;color:#e9f0f3}.barun-output-page{padding:14px 18px;border:1px solid #9dcbe0;border-radius:3px;background:#18222a;overflow-wrap:anywhere}.barun-output-page[data-completed=true]{border-color:#586c77;color:#c3cdd1}.barun-output-page small{display:block;font-size:12px;color:#9dcbe0}.barun-output-visual[data-compact=true] .barun-output-facts{right:20px}.barun-output-visual[data-compact=true] .barun-output-pages{left:20px;right:20px;width:auto;bottom:calc(var(--barun-output-bottom,56px) + 48px)}.barun-output-stage[data-compact=true]{flex-wrap:wrap;justify-content:center}.barun-output-stage[data-compact=true] .barun-wait-stage__progress{display:block}.barun-output-page-enter{animation:barun-output-page-in 180ms ease-out}@keyframes barun-output-page-in{from{transform:translateY(-14px);opacity:0}to{transform:translateY(0);opacity:1}}@media(prefers-reduced-motion:reduce){.barun-output-page-enter{animation:none}}`;
 (document.head||document.documentElement).append(node);
}

// The drawing already on screen is the backdrop. No canvas readback, scene walk or redraw.
export function mountOutputWait(viewport,{kind='export',format='dxf',objects=0,name='',onDestroy}={}){
 if(!viewport?.ownerDocument)return null;
 const document=viewport.ownerDocument;style(document);
 let finished=false,destroyed=false,animation=null,position=0,phase='',layoutObserver=null,seen=new Set(),lastPage=0;
 const visual=document.createElement('div');visual.className='barun-output-visual';visual.setAttribute('aria-hidden','true');
 const sweep=document.createElement('div');sweep.className='barun-output-sweep';visual.append(sweep);
 const pages=document.createElement('div');pages.className='barun-output-pages';visual.append(pages);
 const facts=document.createElement('div');facts.className='barun-output-facts';facts.textContent=objects?objects.toLocaleString()+'개 객체':'전송 준비';visual.append(facts);viewport.append(visual);
 const stage=mountWaitStage(viewport,{kind,wallClock:true,onDestroy:()=>{destroyed=true;animation?.cancel();observer?.disconnect();layoutObserver?.disconnect();document.removeEventListener('visibilitychange',visibility);visual.remove();onDestroy?.();}});
 stage.element.classList.add('barun-output-stage');
 stage.element.querySelector('.barun-wait-stage__skip').hidden=true;
 const note=stage.element.querySelector('.barun-wait-stage__note');note.textContent=kind==='pdf'?'종이 움직임은 연출 · 이름·순번은 실제':'빛줄 움직임은 연출 · 바이트·객체 수는 실제';
 const phases=kind==='pdf'?[{key:'upload',label:'보내기'},{key:'render',label:'시트 출력'},{key:'record',label:'기록'}]:[{key:'upload',label:'보내기'},{key:'dxf',label:format==='bcad'?'도면 쓰기':'DXF 쓰기'},...(format==='dwg'?[{key:'convert',label:'DWG 변환'}]:[]),{key:'record',label:'기록'}];
 stage.setPhases(phases);
 const title=()=>{stage.element.querySelector('.barun-wait-stage__title').textContent=finished?'완료':kind==='pdf'?'PDF 출력 중':'저장 중';};
 const reduced=()=>document.defaultView?.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
 let inView=true;
 function visibility(){
  const hidden=document.hidden||!inView;visual.hidden=hidden;stage.element.hidden=hidden;
  if(animation){if(hidden||reduced())animation.pause();else animation.play();}
 }
 const observer=typeof IntersectionObserver==='function'?new IntersectionObserver(entries=>{inView=entries[0]?.isIntersecting!==false;visibility();}):null;observer?.observe(viewport);
 document.addEventListener('visibilitychange',visibility);
 function layout(){const box=viewport.getBoundingClientRect(),dock=document.querySelector('.input-dock')?.getBoundingClientRect();visual.style.setProperty('--barun-output-bottom',Math.max(56,dock&&dock.top<box.bottom?box.bottom-dock.top+16:0)+'px');visual.dataset.compact=String(viewport.clientWidth<720);}
 if(typeof ResizeObserver==='function'){layoutObserver=new ResizeObserver(layout);layoutObserver.observe(viewport);const dock=document.querySelector('.input-dock');if(dock)layoutObserver.observe(dock);}layout();
 function setPhase(next,detail){
  if(destroyed||finished)return;phase=next;stage.push({phase:next,detail,source:'engine'});title();
  if(next!=='upload'&&next!=='render')stage.setProgress(0,null);
  if(next==='convert'&&!animation&&!reduced())animation=sweep.animate?.([{transform:'translateX(0)'},{transform:'translateX('+Math.max(0,viewport.clientWidth-3)+'px)'}],{duration:2400,iterations:Infinity,direction:'alternate',easing:'linear'});
  if(next!=='convert'){animation?.cancel();animation=null;sweep.style.transform='translateX('+position+'px)';}
  sweep.hidden=kind==='pdf'||next==='record';visibility();
 }
 function page(event){
  if(!event.current||!event.total)return;
  const key=event.current+':'+Boolean(event.completed);if(seen.has(key))return;seen.add(key);
  // A slow status response must not turn the current card back to an earlier sheet.
  if(event.current<lastPage)return;lastPage=event.current;
  let node=[...pages.children].find(n=>n.dataset.index===String(event.current));
  if(!node){node=document.createElement('div');node.className='barun-output-page'+(!document.hidden?' barun-output-page-enter':'');node.dataset.index=String(event.current);pages.append(node);while(pages.children.length>3)pages.firstElementChild.remove();}
  node.dataset.completed=String(Boolean(event.completed));node.replaceChildren(document.createTextNode(event.name||'시트 '+event.current));
  const label=document.createElement('small');label.textContent=event.current+' / '+event.total+'장 · '+(event.completed?'출력 완료':'출력 중');node.append(label);
  stage.setProgress(event.completed?event.current:event.current-1,event.total);
 }
 const api={
  upload(loaded,total){if(finished||destroyed)return;facts.textContent=(objects?objects.toLocaleString()+'개 객체 · ':'')+loaded.toLocaleString()+(total?' / '+total.toLocaleString():'')+'바이트 전송';position=total>0?Math.max(0,Math.min(1,loaded/total))*(viewport.clientWidth-3):0;setPhase('upload',(objects?objects.toLocaleString()+'개 객체 · ':'')+loaded.toLocaleString()+(total?' / '+total.toLocaleString():'')+'바이트 전송');stage.setProgress(loaded,total>0?total:null);},
  progress(snapshot){if(finished||destroyed)return;for(const e of snapshot.events||[])if(e.phase==='render')page(e);const e=snapshot.progress||snapshot;if(e.phase){setPhase(e.phase,e.name||e.label||({'dxf':'DXF를 쓰고 있습니다','convert':'DWG로 변환 중 · 경과 시간 확인','record':'결과를 기록하고 있습니다','render':'시트를 출력하고 있습니다'}[e.phase])||e.phase);if(e.phase==='render')page(e);}},
  ready(){setPhase('record','저장 위치를 확인하고 있습니다');},
  finish(path){if(destroyed||finished)return;finished=true;animation?.cancel();animation=null;sweep.hidden=true;stage.setProgress(0,null);stage.finish({label:path?'저장 완료 · '+path:'완료'});if(!destroyed){stage.element.querySelector('.barun-wait-stage__title').textContent='저장 완료';stage.element.querySelector('.barun-wait-stage__detail').title=path||'';}},
  fail(error){if(destroyed||finished)return;finished=true;animation?.cancel();sweep.hidden=true;stage.setProgress(0,null);stage.finish({label:'결과를 확인하지 못했습니다 · '+(error?.message||String(error))});if(!destroyed){stage.element.querySelector('.barun-wait-stage__title').textContent='확인 필요';const current=phases.findIndex(p=>p.key===phase);[...stage.element.querySelector('.barun-wait-stage__phases').children].forEach((node,index)=>{node.dataset.state=index<current?'done':index===current?'current':'';});}},
  destroy(){stage.destroy();},
  get destroyed(){return destroyed;}
 };
 setPhase('upload',name||((objects?objects.toLocaleString()+'개 객체 · ':'')+'전송 준비'));visibility();return api;
}
