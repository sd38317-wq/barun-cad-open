// ACAD200 영역 3 — 스냅·추적 보조(311~316). app.js 의 snap()·polarInput() 이 부르는 작은 순수 함수 묶음.
// 모두 "커서 한 번에 상수 또는 후보 몇 개" 만 본다. 도면 전체를 훑는 코드는 없다.

const dist=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
const norm=a=>((a%360)+360)%360;
// 0·90·180·270° 는 정확한 단위 벡터(cos 90° = 6e-17 같은 찌꺼기로 99.99999999999999 가 찍히지 않게).
const EXACT={0:[1,0],90:[0,1],180:[-1,0],270:[0,-1]};
const direction=a=>{const n=norm(a),k=Math.round(n*1e9)/1e9;if(EXACT[k])return EXACT[k];const r=n*Math.PI/180;return [Math.cos(r),Math.sin(r)];};

// 311. 스냅 조리개(APERTURE). AutoCAD 는 마우스·펜·터치 모두 같은 화소 크기(10px, DPI 배율)다.
// 바른 CAD 는 사용자가 정한 크기(기본 16px)를 마우스에 그대로 쓰고, 펜은 25% 넓게, 손가락은 최소 24px 로 넓힌다
// — 손가락이 덮는 넓이보다 작은 조리개로는 끝점을 맞출 수 없다.
export function apertureRadiusPx(base=16,pointerType='mouse'){
  const value=Math.max(4,Math.min(40,Number(base)||16));
  if(pointerType==='touch')return Math.max(value,24);
  if(pointerType==='pen')return Math.min(48,value*1.25);
  return value;
}

// 314. 스냅에서 뺄 것(AutoCAD OSOPTIONS 비트 1 = 해치, 2 = 치수 보조선). 기본 3.
// 한 번만 쓰는 임시 스냅(END·MID… 를 치거나 Shift+우클릭으로 고른 것)은 해치도 허용한다(AutoCAD 와 같음).
export function snapIgnores(osnapOptions=3,once=null){
  const o=Number(osnapOptions)|0;
  return {hatch:!once&&!!(o&1),extension:!!(o&2)};
}
const LINEAR_DIM_MODES=new Set([undefined,'','horizontal','vertical','aligned','rotated','linear']);
/** 치수 객체 parent 의 선분 [a,b] 가 보조선(정의점에서 치수선까지)인가. 정의점 하나를 지나는 직선이면 보조선이다. */
export function isDimensionExtension(parent,segment){
  if(parent?.type!=='dimension'||!LINEAR_DIM_MODES.has(parent.mode))return false;
  const [s,t]=segment||[];if(!s||!t)return false;
  const dx=t.x-s.x,dy=t.y-s.y,length=Math.hypot(dx,dy);if(!(length>0))return false;
  for(const q of (parent.points||[]).slice(0,2)){
    if(!q)continue;
    const off=Math.abs(dx*(q.y-s.y)-dy*(q.x-s.x))/length;          // q 에서 이 선(무한 직선)까지
    if(off<=Math.max(1e-6,length*1e-6))return true;
  }
  return false;
}

// 312. 끌고 있는 객체는 스냅 후보에서 뺀다. 객체 이동은 옮기는 객체 전부, 그립 신축은 그 객체.
// AutoCAD 와 달리, 꼭짓점이 셋 이상인 폴리선을 그립으로 늘릴 때는 움직이지 않는 꼭짓점을 끝점 후보로 남긴다
// (같은 폴리선의 다른 모서리에 맞춰 늘리는 일이 흔하다).
export function dragSnapExclusion(drag,source=null){
  if(!drag)return null;
  if(drag.kind==='object-move')return {ids:new Set(drag.ids||[drag.id]),keep:[]};
  if(drag.kind==='entity-grip'||drag.kind==='grip-mode'){
    const keep=[];
    const moving=new Set(drag.movingIndices||(drag.grip?.kind==='vertex'?[drag.grip.index]:[]));
    // 꼭짓점이 아주 많은 폴리선(등고선 등)은 AutoCAD 처럼 통째로 뺀다 — 끄는 동안 매번 수만 점을 보지 않게.
    if(source&&Array.isArray(source.points)&&source.points.length>2&&source.points.length<=2000&&['polyline','rectangle'].includes(source.type))
      source.points.forEach((point,index)=>{if(!moving.has(index))keep.push(point);});
    return {ids:new Set([drag.id]),keep,source};
  }
  return null;
}

// 313. Tab 으로 스냅 후보 돌리기. 조리개 안 후보를 가까운 순으로 모아 두고, 커서가 그 자리(조리개 안)에 있는 동안
// Tab 마다 다음 후보를 고른다. 커서가 조리개 밖으로 나가면 순환을 잊는다.
export class SnapCycle {
  constructor(){this.clear();}
  clear(){this.anchor=null;this.radius=0;this.list=[];this.index=0;}
  get active(){return !!this.anchor&&this.list.length>1;}
  start(anchor,list,radius){
    const seen=new Set(),unique=[];
    for(const c of [...list].sort((a,b)=>a.d-b.d)){const key=c.x.toFixed(9)+','+c.y.toFixed(9);/* 같은 자리(끝점=교차점)는 한 번만 */if(seen.has(key))continue;seen.add(key);unique.push(c);}
    this.anchor={x:anchor.x,y:anchor.y};this.radius=radius;this.list=unique;this.index=0;return unique.length;
  }
  next(){if(!this.list.length)return null;this.index=(this.index+1)%this.list.length;return this.list[this.index];}
  /** p 가 순환 자리 안이면 지금 고른 후보, 밖이면 순환을 끝내고 null. */
  current(p){
    if(!this.anchor)return null;
    if(!p||dist(p,this.anchor)>this.radius){this.clear();return null;}
    return this.index>0?this.list[this.index]:null;   // 0 번은 보통 스냅 결과와 같다 — 그때는 평소 계산을 쓴다
  }
}

// 316. 극좌표 각도 목록 = 증분 각의 배수 ∪ 추가 각도(POLARADDANG). 상대 각(POLARMODE 1)은 직전 선분 방향을 0도로.
export function polarAngleList(step=90,addAngles=''){
  const s=Number(step)>0?Number(step):90,list=[];
  for(let a=0;a<360-1e-9;a+=s)list.push(a);
  for(const raw of String(addAngles||'').split(/[;,\s]+/)){if(raw==='')continue;const a=Number(raw);if(Number.isFinite(a))list.push(norm(a));}
  return [...new Set(list.map(a=>Math.round(a*1e9)/1e9))];
}
/** base 에서 raw 쪽으로, 각도 목록 중 커서에서 tol 안에 있는 가장 가까운 선으로 붙인다. 없으면 null.
 *  distanceUnit>0 이면 길이를 그 배수로(POLARDIST). 결과 {x,y,angle,length}. */
export function polarTrack(base,raw,{angles=[0,90,180,270],tol=1,relative=0,distanceUnit=0}={}){
  const dx=raw.x-base.x,dy=raw.y-base.y;if(Math.hypot(dx,dy)<=1e-12)return null;
  let best=null;
  for(const a of angles){
    const angle=a+relative,[ux,uy]=direction(angle),t=dx*ux+dy*uy;
    if(t<=0)continue;
    const miss=Math.abs(dx*uy-dy*ux);
    if(miss<=tol&&(!best||miss<best.miss-1e-12))best={angle,t,miss,ux,uy};
  }
  if(!best)return null;
  const unit=Number(distanceUnit)||0,t=unit>0?Math.max(unit,Math.round(best.t/unit)*unit):best.t;
  return {x:base.x+best.ux*t,y:base.y+best.uy*t,angle:norm(best.angle),length:t};
}

// 315. 객체 스냅 추적(OTRACK). 스냅점 위에 잠깐(기본 0.1초) 머물면 추적점으로 얻고, 다시 머물면 뺀다.
// 커서가 추적점을 지나는 가로·세로(극좌표가 켜졌으면 그 각도들) 선 근처면 그 선 위로, 두 선이 함께 걸리면 교차점으로 붙인다.
// AutoCAD 보다 나은 점: 극좌표 추적선(직전 점 기준)과 객체 추적선의 교차도 같은 규칙으로 잡고(extraLines),
// 추적점 수는 7개로 묶어 매 이동 계산이 "추적점 × 각도" 상수로 끝난다.
export class ObjectTracking {
  constructor({pauseMs=100,max=7,setTimer=(fn,ms)=>setTimeout(fn,ms),clearTimer=id=>clearTimeout(id)}={}){
    this.pauseMs=pauseMs;this.max=max;this.setTimer=setTimer;this.clearTimer=clearTimer;this.points=[];this.key='';this.timer=0;
  }
  clear(){this.points=[];this.key='';if(this.timer)this.clearTimer(this.timer);this.timer=0;}
  toggle(point){
    const i=this.points.findIndex(t=>dist(t,point)<=1e-9);
    if(i>=0)this.points.splice(i,1);else this.points=[...this.points,{x:point.x,y:point.y,label:point.label||''}].slice(-this.max);
    return i<0;
  }
  /** 커서 스냅 결과가 나올 때마다 부른다. 같은 스냅점 위에 pauseMs 머물면 얻기/빼기. */
  hover(snapped,onChange){
    const key=snapped?.snapped&&Number.isFinite(snapped.x)?`${snapped.x},${snapped.y}`:'';
    if(key===this.key)return;
    this.key=key;if(this.timer)this.clearTimer(this.timer);this.timer=0;
    if(!key)return;
    const point={x:snapped.x,y:snapped.y,label:snapped.label};
    this.timer=this.setTimer(()=>{this.timer=0;this.toggle(point);onChange?.();},this.pauseMs);
  }
  /** p 를 추적선에 맞춘다. 결과 {x,y,tracking:[{base,angle}]} 또는 null. */
  align(p,tol,{angles=[0,90],extraLines=[]}={}){
    const lines=[];
    for(const t of this.points)for(const a of angles)lines.push({base:t,angle:norm(a)});
    for(const l of extraLines)lines.push({base:l.base,angle:norm(l.angle),polar:true});
    const near=[];
    for(const l of lines){
      const [ux,uy]=direction(l.angle),dx=p.x-l.base.x,dy=p.y-l.base.y;
      const miss=Math.abs(dx*uy-dy*ux);if(miss>tol)continue;
      const t=dx*ux+dy*uy;if(l.angle%180!==0&&l.angle%180!==90&&t<0&&!l.polar)continue;   // 기울어진 추적선은 추적점에서 앞쪽만
      if(l.polar&&t<=0)continue;
      near.push({...l,miss,ux,uy,t});
    }
    if(!near.length)return null;
    near.sort((a,b)=>a.miss-b.miss);
    const first=near[0];
    for(const second of near.slice(1)){
      const det=first.ux*second.uy-first.uy*second.ux;if(Math.abs(det)<1e-9)continue;
      const wx=second.base.x-first.base.x,wy=second.base.y-first.base.y,s=(wx*second.uy-wy*second.ux)/det;
      const q={x:first.base.x+first.ux*s,y:first.base.y+first.uy*s};
      if(dist(q,p)<=tol*1.5)return {x:q.x,y:q.y,tracking:[{base:{...first.base},angle:first.angle},{base:{...second.base},angle:second.angle}]};
    }
    return {x:first.base.x+first.ux*first.t,y:first.base.y+first.uy*first.t,tracking:[{base:{...first.base},angle:first.angle}]};
  }
}
/** 추적점(+)과 추적선(점선)을 그린다. screen: 도면→화면. */
export function drawObjectTracking(ctx,screen,{points=[],tracking=null,cursor=null,color='#9dcbe0'}={}){
  if(!points.length&&!tracking)return;
  ctx.save();ctx.strokeStyle=color;ctx.lineWidth=1;
  for(const t of points){const s=screen(t);ctx.beginPath();ctx.moveTo(s.x-4,s.y);ctx.lineTo(s.x+4,s.y);ctx.moveTo(s.x,s.y-4);ctx.lineTo(s.x,s.y+4);ctx.stroke();}
  if(tracking&&cursor){
    const c=screen(cursor);ctx.setLineDash([3,3]);
    for(const line of tracking){const b=screen(line.base);ctx.beginPath();ctx.moveTo(b.x,b.y);ctx.lineTo(c.x,c.y);ctx.stroke();}
    ctx.setLineDash([]);
    ctx.beginPath();ctx.moveTo(c.x-5,c.y-5);ctx.lineTo(c.x+5,c.y+5);ctx.moveTo(c.x+5,c.y-5);ctx.lineTo(c.x-5,c.y+5);ctx.stroke();
  }
  ctx.restore();
}
