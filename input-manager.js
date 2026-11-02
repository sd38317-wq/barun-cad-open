const copyPoint=point=>point&&Number.isFinite(point.x)&&Number.isFinite(point.y)?{x:point.x,y:point.y}:null;

/**
 * Owns the interaction generation independently from rendering.  A pointer
 * gesture belongs to exactly one generation, so a late pointerup from a
 * cancelled command can never finish a newly-started command.
 */
export class InteractionEpoch {
  constructor(){this.value=0;this.reason='startup';}
  next(reason='command-transition'){this.reason=reason;return ++this.value;}
  tag(value={}){return {...value,interactionEpoch:this.value};}
  accepts(value){return !!value&&value.interactionEpoch===this.value;}
}

/** Development-only bounded input trace.  It deliberately stores plain data
 * so the trace can be copied from DevTools without retaining DOM events. */
export class InputDiagnostics {
  constructor({enabled=false,limit=1000,clock=()=>performance.now()}={}){
    this.enabled=enabled;this.limit=limit;this.clock=clock;this.origin=clock();this.entries=[];
  }
  setEnabled(value){this.enabled=!!value;return this.enabled;}
  clear(){this.entries.length=0;this.origin=this.clock();}
  record(event,data={}){
    if(!this.enabled)return null;
    const entry={
      timestampMs:Number((this.clock()-this.origin).toFixed(3)),
      event,
      eventTimestamp:Number.isFinite(data.eventTimestamp)?data.eventTimestamp:null,
      command:data.command||'SELECT',
      previousState:data.previousState||'',
      nextState:data.nextState||data.previousState||'',
      screen:copyPoint(data.screen),world:copyPoint(data.world),
      accepted:data.accepted!==false,
      reason:data.reason||'',
      processingMs:Number((data.processingMs||0).toFixed(3)),
    };
    this.entries.push(entry);if(this.entries.length>this.limit)this.entries.splice(0,this.entries.length-this.limit);
    return entry;
  }
  recent(count=200){return this.entries.slice(-Math.max(0,count)).map(entry=>structuredClone(entry));}
}


/* ── ACAD200 영역 3: 클릭·끌기 판정, 입력점 파이프라인, 바쁠 때 입력 줄, 오른쪽 단추 ── */

// 301. 클릭·끌기 판정 하나(그립·객체 이동·선택창 공통).
// AutoCAD LassoState 는 "0.2초 전엔 무조건 클릭, 0.5초 넘으면 떨림(4px)만 넘어도 끌기, 그 사이엔 16px" 이다.
// 바른 CAD 는 더 단순하고 덜 놓친다:
//  · 떨림 문턱(jitter) 안의 움직임은 언제나 클릭(0.7px 손떨림에 그립이 늘어나지 않는다).
//  · 짧게 누른 동안(quickMs)은 크게(distance) 움직여야 끌기 — 빠른 "탁" 클릭이 몇 px 밀려도 클릭.
//  · 그 뒤로는 떨림 문턱만 넘으면 끌기 — AutoCAD 의 0.2~0.5초 구간처럼 10px 끈 것을 클릭으로 잃지 않는다.
//  · 펜·터치는 접촉 떨림이 커서 문턱이 크다(AutoCAD 의 acedIsPointerInContact 갈래).
export const PRESS_PROFILES=Object.freeze({
  mouse:Object.freeze({quickMs:200,jitter:3,distance:16}),
  pen:Object.freeze({quickMs:200,jitter:4,distance:16}),
  touch:Object.freeze({quickMs:220,jitter:6,distance:24}),
});
export class PressClassifier {
  constructor(profile=PRESS_PROFILES.mouse){this.quickMs=profile.quickMs;this.jitter=profile.jitter;this.distance=profile.distance;this.t0=0;this.p0={x:0,y:0};this.dragging=false;}
  static forEvent(e,p){const c=new PressClassifier(PRESS_PROFILES[e?.pointerType]||PRESS_PROFILES.mouse);c.begin(e?.timeStamp,p);return c;}
  begin(time,p){this.t0=Number(time);this.p0={x:p.x,y:p.y};this.dragging=false;return this;}
  /** pointermove 마다 부른다. 한 번 끌기가 되면 끝까지 끌기다. */
  update(time,p){
    if(this.dragging)return true;
    const d=Math.hypot(p.x-this.p0.x,p.y-this.p0.y);
    if(!(d>=this.jitter))return false;
    const dt=Number(time)-this.t0;
    if(!(dt>=this.quickMs)&&d<this.distance)return false;
    return this.dragging=true;
  }
  /** pointerup 에서: 끌기가 아니었으면 클릭. */
  isClick(time,p){return !this.update(time,p);}
}

// 318. 입력점 묶음: 원점 → 객체 스냅 → 계산점. 필터 하나(점을 바꿀 수 있음) + 모니터 여럿(읽기·툴팁·스냅 제외 투표).
// AutoCAD AcEdInputPointManager 와 같은 나눔이지만, 아무것도 등록되지 않았으면 snap() 결과를 그대로 돌려준다(비용 0).
export class InputPointManager {
  constructor(){this.filter=null;this.monitors=new Set();this.last=null;}
  get active(){return !!this.filter||this.monitors.size>0;}
  registerFilter(f){if(typeof f!=='function')throw TypeError('입력점 필터는 함수여야 합니다.');if(this.filter&&this.filter!==f)throw Error('입력점 필터는 하나만 둘 수 있습니다. 먼저 등록한 필터를 내려 주세요.');this.filter=f;return ()=>this.revokeFilter(f);}
  revokeFilter(f){if(this.filter===f)this.filter=null;}
  addMonitor(m){this.monitors.add(m);return ()=>this.monitors.delete(m);}
  /** 312: 모니터 하나라도 "이 객체는 스냅에서 빼자"고 하면 뺀다(AutoCAD excludeCurrentEntityFromOsnap 투표). */
  excludedIds(context={}){
    let out=null;
    for(const m of this.monitors){const ids=m.excludeEntities?.(context);if(ids)for(const id of ids)(out??=new Set()).add(id);}
    return out;
  }
  /** raw: 커서 원점, result: snap() 이 낸 점. 필터·모니터를 거친 묶음을 돌려준다. */
  compute(raw,result,context={}){
    const ip={raw:{x:raw.x,y:raw.y},osnapped:result?.snapped?{...result}:null,computed:result?{...result}:{x:raw.x,y:raw.y},tooltip:'',context};
    if(this.filter){
      let r=null;try{r=this.filter(ip);}catch(error){ip.error=error;}
      if(r?.point&&Number.isFinite(r.point.x)&&Number.isFinite(r.point.y))ip.computed={...ip.computed,...r.point,filtered:true};
      if(r?.tooltip)ip.tooltip=String(r.tooltip);
    }
    for(const m of this.monitors){let t='';try{t=m.monitor?.(ip)||'';}catch{}if(t)ip.tooltip+=(ip.tooltip?' · ':'')+t;}
    if(ip.tooltip)ip.computed.tooltip=ip.tooltip;
    this.last=ip;return ip;
  }
}

// 319. 바쁜 동안(서버 해치 경계 찾기 등) 누른 클릭·Enter 를 버리지 않고 줄 세웠다가 끝나면 차례로 처리한다.
// 이동은 줄 세우지 않는다(마지막 위치만 의미). Esc 는 줄을 비운다. 오래된 입력(기본 3초)·다른 도면의 입력은 버린다.
export class InputQueue {
  constructor({limit=32,maxAgeMs=3000,clock=()=>performance.now()}={}){this.items=[];this.limit=limit;this.maxAgeMs=maxAgeMs;this.clock=clock;this.timer=0;}
  get size(){return this.items.length;}
  clear(){this.items.length=0;}
  push(item){
    if(!item||item.type==='pointermove')return false;
    if(item.key==='Escape'){this.clear();return false;}
    if(this.items.length>=this.limit)this.items.shift();
    this.items.push({...item,queuedAt:this.clock()});return true;
  }
  /** 지금 줄에 있는 것 중 쓸 수 있는 것만 차례로 dispatch 한다. dispatch 가 false(다시 바빠짐)를 돌려주면
   *  남은 것은 줄 앞에 되돌려 다음 한가할 때 잇는다. */
  drain(dispatch,{isCurrent=()=>true}={}){
    const now=this.clock(),list=this.items.splice(0);let replayed=0;
    for(let i=0;i<list.length;i++){
      const item=list[i];
      if(now-item.queuedAt>this.maxAgeMs||!isCurrent(item))continue;
      replayed++;
      if(dispatch(item)===false){this.items.unshift(...list.slice(i+1));break;}
    }
    return replayed;
  }
  /** 바쁨이 풀리면 줄을 비운다. 줄이 있는 동안만 짧게 확인한다(평소 비용 없음). */
  whenIdle(isBusy,dispatch,options={},{interval=30,setTimer=(fn,ms)=>setTimeout(fn,ms)}={}){
    if(this.timer)return;
    const tick=()=>{this.timer=0;if(!this.items.length)return;if(!isBusy())this.drain(dispatch,options);if(this.items.length)this.timer=setTimer(tick,interval);};
    this.timer=setTimer(tick,interval);
  }
}

// 320. 오른쪽 단추: 짧게 떼면 Enter, 오래 누르면 지금 명령의 옵션 메뉴(AutoCAD SHORTCUTMENU 16 + DURATION).
// 0 이면 시간 감지 끔(언제나 Enter, 예전 동작).
export function classifyRightClick(heldMs,menuMs=300){
  const limit=Number(menuMs);
  if(!(limit>0)||!Number.isFinite(heldMs))return 'enter';
  return heldMs>=limit?'menu':'enter';
}
/** 프롬프트의 "[기준점(B)/복사(C)/종료(X)]" 묶음들을 메뉴 항목 {label,key} 로. 같은 키는 한 번만. */
export function promptOptions(prompt){
  const out=[],seen=new Set();
  for(const group of String(prompt||'').matchAll(/\[([^\]]+)\]/g))
    for(const part of group[1].split('/')){
      const m=part.match(/^\s*(.*?)\s*\(([A-Z0-9]+)\)\s*$/);
      if(!m||seen.has(m[2]))continue;seen.add(m[2]);
      out.push({label:m[1]||m[2],key:m[2]});
    }
  return out;
}
