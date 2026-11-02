import {mountWaitStage} from './wait-stage.js';

export const MODEL_PHASES = [
  ['engine','엔진 준비'],['stories','층 모델'],['solids','벽·슬래브'],
  ['plan','평면'],['section','단면'],['elevation','입면'],['details','상세']
].map(([key,label])=>({key,label}));
const NONE = Object.freeze({push(){},finish(){},destroy(){}});

/** Short work never allocates a waiting view. Activation never delays calculation. */
export function startModelWait(viewport,options={}) {
  if(options.enabled===false||!viewport)return NONE;
  const started=performance.now(),pending=new Map();let view,closed=false,scheduled=false,frame;
  const activate=()=>{
    scheduled=false;frame=undefined;
    if(closed||globalThis.document?.hidden)return;
    view=createModelWait(viewport,options);
    for(const event of pending.values())view.push(event);
    pending.clear();
  };
  const destroy=()=>{if(closed)return;closed=true;if(frame!=null)globalThis.cancelAnimationFrame?.(frame);view?.destroy();pending.clear();};
  return {
    push(event={}){
      if(closed)return;
      if(!view){
        pending.set(event.phase,event);
        if(scheduled||performance.now()-started<(options.delayMs??50)||globalThis.document?.hidden)return;
        // Completion can arrive before the next paint; finish then cancels this mount.
        scheduled=true;
        if(typeof requestAnimationFrame==='function')frame=requestAnimationFrame(activate);
        else queueMicrotask(activate);
        return;
      }
      view.push(event);
    },
    finish:destroy,destroy
  };
}

/** Event-driven view of real work. No timers/DOM when disabled, no replay or synthetic progress. */
function createModelWait(viewport,{title='건물 도면 만들기',phases=MODEL_PHASES,enabled=true}={}) {
  if(!enabled || !viewport)return NONE;
  const document=viewport.ownerDocument,completed=new Set();
  let closed=false,latest=null,folded=false;
  const gallery=document.createElement('div');
  gallery.className='barun-model-wait';
  gallery.style.cssText='position:absolute;left:20px;right:20px;top:108px;z-index:17;display:flex;flex-wrap:wrap;justify-content:center;gap:12px;pointer-events:none;font-size:12px;color:#e9f0f3';
  viewport.appendChild(gallery);
  const stage=mountWaitStage(viewport,{title,compactWidth:1100,note:'실제 계산 진행 · 미리보기는 완료한 도면',skipLabel:'미리보기 접기',hideSkip:true,onSkip:()=>{
    folded=!folded;gallery.style.display=folded?'none':'flex';
    stage.element.querySelector('.barun-wait-stage__skip').textContent=folded?'미리보기 펼치기':'미리보기 접기';
  }});
  stage.setPhases(phases);
  const cards=new Map();
  const render=event=>{
    if(closed || document.hidden)return;
    const count=Number.isFinite(event.done)?' · '+event.done.toLocaleString()+(Number.isFinite(event.total)?' / '+event.total.toLocaleString():'')+(event.unit||'개'):'';
    stage.push({...event,source:'engine',detail:(event.label||'계산 중')+count,completed:[...completed]});
    stage.setProgress(event.done,event.total);
    if(!event.preview?.length)return;
    const key=event.previewKey||event.label||event.phase;
    let card=cards.get(key);
    if(!card){
      if(cards.size>=6){const [oldKey,oldCard]=cards.entries().next().value;oldCard.remove();cards.delete(oldKey);}
      card=document.createElement('div');card.style.cssText='width:min(240px,100%);padding:10px;border:1px solid #526875;border-radius:4px;background:#18222a';cards.set(key,card);gallery.appendChild(card);
    }
    card.replaceChildren();
    const caption=document.createElement('div');caption.textContent=event.previewLabel||event.label||'완료한 도면';card.appendChild(caption);
    const canvas=document.createElement('canvas');canvas.width=440;canvas.height=240;canvas.style.cssText='width:100%;height:auto;display:block;margin-top:8px';card.appendChild(canvas);
    const ctx=canvas.getContext('2d');
    const paths=event.preview.map(e=>e.points||[]).filter(p=>p.length>1);
    let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
    for(const path of paths)for(const p of path){minX=Math.min(minX,p.x);minY=Math.min(minY,p.y);maxX=Math.max(maxX,p.x);maxY=Math.max(maxY,p.y);}
    if(Number.isFinite(minX)){
      const scale=Math.min(416/Math.max(1,maxX-minX),216/Math.max(1,maxY-minY));
      const ox=(440-(maxX-minX)*scale)/2,oy=(240-(maxY-minY)*scale)/2;
      ctx.strokeStyle='#9dcbe0';ctx.lineWidth=1.2;ctx.beginPath();
      for(const path of paths){path.forEach((p,i)=>ctx[i?'lineTo':'moveTo'](ox+(p.x-minX)*scale,240-oy-(p.y-minY)*scale));}ctx.stroke();
    }
    const note=document.createElement('div');note.textContent='실제 형상 · 배치 전 미리보기';note.style.color='#aebbc1';card.appendChild(note);
    stage.element.querySelector('.barun-wait-stage__skip').hidden=false;
  };
  const resume=()=>{if(!document.hidden&&latest)render(latest);};
  document.addEventListener('visibilitychange',resume);
  const destroy=()=>{if(closed)return;closed=true;document.removeEventListener('visibilitychange',resume);stage.destroy();gallery.remove();cards.clear();latest=null;};
  return {
    push(event={}){if(closed)return;if(event.total!=null&&event.done>=event.total)completed.add(event.phase);else completed.delete(event.phase);latest=event;render(event);},
    finish(){destroy();},destroy
  };
}
