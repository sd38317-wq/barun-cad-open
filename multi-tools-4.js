// 보조명령 카드 9개(4차 · 멀티도구 "부분" 매핑 다시 만들기): DVC EXL JL MC OA OB OM RM SM.
// 근거 원문(izzarder.com, 2026-09-21 WebFetch 로 직접 확인): DVC /282, EXL /578, JL /146, MC /606,
//   OA /451, OB /362, OM /357, RM /418, SM /419. 2차 검증 A 보고서 "6. 멀티도구" 절의 "부분" 행이 지적한
//   빠진 옵션(등폭·최소/최대간격, 호 길이조절, ByLayer 통일 물음, 0 종료 반복, 3x3 기준점·복사, 현재 켜 이동,
//   개별 제자리 회전·축척)을 채운다.
// 대체하는 기존 명령: DVC·MC→DIVIDECOPY, EXL→LENGTHADJUST, JL→JOIN, OA→OBJECTALIGN, OB→DOUBLEOFFSET,
//   OM→MULTIOFFSET, RM→ROTATE, SM→SCALE (기존 명령은 고치지 않았다. 순수 계산은 읽고 옮겨 적었다).
// 중복 확인(규칙 12절): 새 카드끼리 겹치는 것은 없다. 1~3차와 겹치는 곳은 3차 edit-calc-tools.js 의 OAA 하나뿐이며
//   RM 의 [참조]·[선택]이 같은 일을 한다 — 원문 RM 은 여섯 방식이 한 대화상자라 떼어 낼 수 없어 두 방식을 한 함수로 합쳤다.
// 순수 계산은 export 된 함수로 두어 node --test 가 DOM 없이 돈다. 화면 흐름(pick·form·대화상자)은 installMultiTools4(ctx) 안에만 둔다.
import * as G from './geometry.js';
import {openCardDialog} from './card-kit.js';

const P=(x,y)=>({x,y});
const stripId=e=>{const c=structuredClone(e);delete c.id;return c;};
const changesOf=e=>{const {id,type,...rest}=e;return rest;};

/* ══════════════ 공통 · 3x3 기준점 (RM /418 · SM /419 · OA /451 가 같은 서브 대화상자를 쓴다) ══════════════ */
export const ANCHOR_OPTIONS=[['TL','좌상'],['TC','중상'],['TR','우상'],['ML','좌중'],['MC','중심'],['MR','우중'],
 ['BL','좌하'],['BC','중하'],['BR','우하'],['INS','삽입점 또는 시작점']];
/** 블럭·문자는 삽입점, 선·치수 등은 시작점. */
export function insertionPoint(e){
 if(!e)throw Error('객체가 없습니다.');
 if(e.position)return P(e.position.x,e.position.y);
 if(Array.isArray(e.points)&&e.points.length)return P(e.points[0].x,e.points[0].y);
 if(e.center)return P(e.center.x,e.center.y);
 const b=G.bounds([e]);
 if(!b)throw Error('기준점을 읽을 수 없는 객체입니다.');
 return P(b.minX,b.minY);
}
/** 3x3 격자(또는 삽입점)로 객체 하나의 기준점을 구한다. */
export function anchorPoint(e,anchor='MC'){
 if(anchor==='INS')return insertionPoint(e);
 const b=G.bounds([e]);
 if(!b)throw Error('기준점을 읽을 수 없는 객체입니다.');
 const key=String(anchor||'MC').toUpperCase();
 const v=key[0]==='T'?b.maxY:key[0]==='B'?b.minY:(b.minY+b.maxY)/2;
 const h=key[1]==='L'?b.minX:key[1]==='R'?b.maxX:(b.minX+b.maxX)/2;
 return P(h,v);
}
/** 여러 객체를 한 묶음으로 볼 때의 기준점. */
export function groupAnchorPoint(list,anchor='MC'){
 const b=G.bounds(list);
 if(!b)throw Error('기준점을 읽을 수 없는 묶음입니다.');
 if(anchor==='INS')return insertionPoint(list[0]);
 const key=String(anchor||'MC').toUpperCase();
 return P(key[1]==='L'?b.minX:key[1]==='R'?b.maxX:(b.minX+b.maxX)/2,
  key[0]==='T'?b.maxY:key[0]==='B'?b.minY:(b.minY+b.maxY)/2);
}
/** 객체의 "방향" 각도(도). 문자·블럭은 회전각, 선·폴리선은 첫 구간, 호는 현(弦). */
export function facingAngle(e){
 if(!e)throw Error('객체가 없습니다.');
 if(['text','block','dimension'].includes(e.type))return G.normalizeAngle(e.rotation||0);
 if(e.type==='arc')return G.normalizeAngle(G.angle(G.sub(G.add(e.center,G.polar(e.radius,e.endAngle)),G.add(e.center,G.polar(e.radius,e.startAngle)))));
 const ss=G.segments(e);
 if(ss.length&&G.dist(ss[0][0],ss[0][1])>G.EPS)return G.normalizeAngle(G.angle(G.sub(ss[0][1],ss[0][0])));
 return 0;
}
export const FACING_OFFSET={up:90,right:0,down:270,left:180};
/** -180 < a <= 180 으로 줄인다. */
export const shortAngle=a=>{const r=G.normalizeAngle(a);return r>180?r-360:r;};
/** [한점] · 객체의 지정한 쪽이 목표점을 바라보게 하는 회전각. */
export function faceRotation(current,facing,base,target){
 const want=G.angle(G.sub(target,base));
 if(!Number.isFinite(want))throw Error('바라볼 점이 기준점과 같습니다.');
 return shortAngle(want-(current+(FACING_OFFSET[facing]??90)));
}

/* ══════════════ DVC · 등분 복사하기 (원문 /282) ══════════════
   원문: 복사기준점(생략 가능) → 두 점 → 등분 갯수. 명령행 옵션 등폭(In)/등폭(Out)/최소간격(M)/최대간격(X).
   기존 DIVIDECOPY(workflows.js:274)는 step=(b-a)/(count-1) 평행이동 복사만 한다 — 네 옵션을 여기서 채운다. */
/**
 * @param {{a,b,mode:'divide'|'in'|'out'|'min'|'max',count?:number,gap?:number,width?:number}} cfg
 * @returns {{offsets:number[],spacing:number,count:number,angle:number,length:number}}
 *   offsets 는 a 에서 b 방향으로의 거리 목록(객체 중심이 놓일 자리).
 */
export function divideCopyPlan({a,b,mode='divide',count=2,gap=0,width=0}){
 const length=G.dist(a,b);
 if(!(length>G.EPS))throw Error('등분할 두 점은 서로 달라야 합니다.');
 const angle=G.angle(G.sub(b,a));
 if(mode==='min'||mode==='max'){
  const d=Number(gap);
  if(!(d>G.EPS))throw Error('간격은 0보다 커야 합니다.');
  const n=mode==='min'?Math.floor(length/d):Math.ceil(length/d);
  if(!(n>=1))throw Error('두 점 사이 거리가 최소간격보다 짧습니다.');
  const spacing=length/n,offsets=[];
  for(let i=0;i<=n;i++)offsets.push(spacing*i);
  return {offsets,spacing,count:n,angle,length};
 }
 const n=Math.round(Number(count));
 if(!Number.isInteger(n)||n<1||n>1000)throw Error('등분 갯수는 1~1000의 정수입니다.');
 if(mode==='divide'){
  const spacing=length/n,offsets=[];
  for(let i=0;i<=n;i++)offsets.push(spacing*i);
  return {offsets,spacing,count:n,angle,length};
 }
 const w=Number(width);
 if(!(w>G.EPS))throw Error('등폭 배치는 객체 폭을 정하는 두 점이 필요합니다.');
 if(mode==='out'&&n<2)throw Error('등폭(Out)은 객체가 두 개 이상이어야 합니다.');
 const free=length-w*n;
 if(!(free>=-G.EPS))throw Error(`객체 폭 ${w} × ${n}개가 두 점 사이 거리 ${length} 보다 큽니다.`);
 const g=mode==='in'?free/(n+1):free/(n-1),offsets=[];
 for(let i=0;i<n;i++)offsets.push(mode==='in'?g*(i+1)+w*(i+0.5):w/2+i*(w+g));
 return {offsets,spacing:mode==='in'?g+w:w+g,count:n,angle,length};
}

/* ══════════════ EXL · 선 길이 조절 (원문 /578) ══════════════
   원문: 선, 호, 폴리선을 선택하고 늘리거나 줄일 방향과 길이를 지정하면 그 끝점이 그만큼 이동한다.
   기존 LENGTHADJUST(workflows.js:263)는 line/polyline 만 다뤄 호가 빠져 있었다. */
/** 클릭한 점에 가까운 쪽 끝이 어느 쪽인지 고른다. 'start' | 'end' */
export function nearerEnd(e,p){
 if(e.type==='arc'){
  const s=G.add(e.center,G.polar(e.radius,e.startAngle)),t=G.add(e.center,G.polar(e.radius,e.endAngle));
  return G.dist(p,s)<=G.dist(p,t)?'start':'end';
 }
 const ps=e.points||[];
 if(ps.length<2)throw Error('선·호·폴리선을 선택하세요.');
 return G.dist(p,ps[0])<=G.dist(p,ps.at(-1))?'start':'end';
}
/** 선택한 끝을 길이 delta(양수 늘림 / 음수 줄임)만큼 옮긴 결과의 변경값. */
export function extendEndChanges(e,end,delta){
 const d=Number(delta);
 if(!Number.isFinite(d)||Math.abs(d)<G.EPS)throw Error('늘리거나 줄일 길이를 입력하세요.');
 if(e.type==='arc'){
  if(!(e.radius>G.EPS))throw Error('반지름이 0인 호입니다.');
  const sweep=G.normalizeAngle(e.endAngle-e.startAngle)||360,step=(d/e.radius)*180/Math.PI;
  const next=sweep+step;
  if(next<=1e-6)throw Error('호를 0보다 짧게 줄일 수 없습니다.');
  if(next>=360)throw Error('호를 한 바퀴 넘게 늘릴 수 없습니다.');
  return end==='start'
   ?{startAngle:G.normalizeAngle(e.startAngle-step)}
   :{endAngle:G.normalizeAngle(e.startAngle+next)};
 }
 if(!['line','polyline','rectangle'].includes(e.type)||e.closed||e.type==='rectangle')
  throw Error('열린 선·폴리선·호만 길이를 조절할 수 있습니다.');
 const points=structuredClone(e.points),i=end==='start'?0:points.length-1,j=end==='start'?1:points.length-2;
 const segment=G.dist(points[i],points[j]);
 if(!(segment>G.EPS))throw Error('길이가 0인 구간입니다. 정점을 먼저 정리하세요.');
 if(segment+d<=G.EPS)throw Error('한 구간을 넘어 줄일 수 없습니다. 정점을 먼저 정리하세요.');
 points[i]=G.add(points[i],G.mul(G.unit(G.sub(points[i],points[j])),d));
 return {points};
}

/* ══════════════ JL · 선 잇기 (원문 /146) ══════════════
   원문: 대화상자 없음. 강제색/선모양을 유지할지 모두 ByLayer 로 할지만 묻고, 그 답은 캐드를 다시 시작할 때까지 유지.
   정점이 2개(직선 형태)인 폴리선은 일반 선과도 이어진다. 원·호가 섞인 벽체는 WR 을 쓴다.
   기존 JOIN(engine.js:446)은 ByLayer 물음이 없고 허용오차가 0.001mm 로 고정이다. */
const flatLine=e=>e.type==='line'||(e.points||[]).length===2;
const joinable=(a,b)=>a.type===b.type||(flatLine(a)&&flatLine(b));
/** 끝점이 허용오차 안에서 닿는 것끼리 사슬로 묶는다. 이어진 것이 없는 객체는 빠진다. */
export function joinGroups(entities,tolerance=0.001){
 const items=(entities||[]).filter(e=>['line','polyline'].includes(e.type)&&!e.closed&&Array.isArray(e.points)&&e.points.length>=2);
 const near=(a,b)=>G.dist(a,b)<=tolerance;
 const used=new Set(),out=[];
 for(const seed of items){
  if(used.has(seed.id))continue;
  used.add(seed.id);
  let points=structuredClone(seed.points),head=seed,tail=seed;
  const ids=[seed.id];
  for(;;){
   let joined=false;
   for(const cand of items){
    if(used.has(cand.id))continue;
    const ps=cand.points;
    if(joinable(cand,tail)&&near(points.at(-1),ps[0])){points.push(...ps.slice(1));tail=cand;}
    else if(joinable(cand,tail)&&near(points.at(-1),ps.at(-1))){points.push(...ps.toReversed().slice(1));tail=cand;}
    else if(joinable(cand,head)&&near(points[0],ps.at(-1))){points.unshift(...ps.slice(0,-1));head=cand;}
    else if(joinable(cand,head)&&near(points[0],ps[0])){points.unshift(...ps.toReversed().slice(0,-1));head=cand;}
    else continue;
    used.add(cand.id);ids.push(cand.id);joined=true;break;
   }
   if(!joined)break;
  }
  if(ids.length<2)continue;
  let closed=false;
  if(points.length>2&&near(points[0],points.at(-1))){points.pop();closed=true;}
  points=dropCollinearVertices(points,closed);
  out.push({ids,points,closed,layer:seed.layer,color:seed.color,linetype:seed.linetype});
 }
 return out;
}
/** 일직선 위에 놓인 중간 정점을 뺀다(2026-09-24 검토 F12: 일직선 두 선을 이으면 3점 폴리선이 남던 문제). */
export function dropCollinearVertices(points,closed=false,eps=1e-6){
 if(!Array.isArray(points)||points.length<3)return points;
 const isMid=(a,b,c)=>{const u=G.sub(b,a),v=G.sub(c,b);const lu=G.len(u),lv=G.len(v);if(lu<G.EPS||lv<G.EPS)return true;return Math.abs(G.cross(u,v))/(lu*lv)<eps&&G.dot(u,v)>0;};
 const out=[];
 const n=points.length;
 for(let i=0;i<n;i++){
  const prev=points[(i-1+n)%n],cur=points[i],next=points[(i+1)%n];
  const interior=closed||(i>0&&i<n-1);
  if(interior&&isMid(prev,cur,next))continue;
  out.push(cur);
 }
 return out.length>=2?out:points;
}
/** 사슬 하나를 폴리선 객체로 만든다. 일직선(정점 2개·열림)이면 선 객체로, byLayer 면 강제색·강제 선모양을 떼어 ByLayer 로 돌린다. */
export function joinedEntity(group,byLayer){
 const straight=!group.closed&&group.points.length===2;
 const e=straight?{type:'line',points:group.points,layer:group.layer}:{type:'polyline',points:group.points,closed:group.closed,layer:group.layer};
 if(!byLayer){
  if(group.color)e.color=group.color;
  if(group.linetype)e.linetype=group.linetype;
 }
 return e;
}

/* ══════════════ MC · 등간격 연속복사 (원문 /606) ══════════════
   원문: 객체와 방향, 간격을 지정하면 그 간격만큼 연속 복사(또는 이동), 숫자 0 을 누르면 종료. 이동은 옵션.
   기존 DIVIDECOPY 는 끝점·개수를 미리 다 알아야 한다 — 여기서는 0 종료 반복으로 만든다. */
/** 방향 단위벡터와 누적 거리로 한 칸 옮길 변위. */
export function stepDelta(direction,distance){
 const u=G.unit(direction);
 return P(u.x*distance,u.y*distance);
}

/* ══════════════ OA · 객체 정렬 (원문 /451) ══════════════
   원문 대화상자: [실행방식] 명령창/대화상자, [목표] 점 지정/객체선택/두점중간/두점중심, [객체 각도에 맞추어 회전],
   [이동방식] 수평이동/수평 등간격/수직이동/수직 등간격, [기준점] 3x3+삽입점, [복사].
   기존 OBJECTALIGN(workflows.js:268)은 첫 객체 기준 6방향 맞춤 + 양끝 고정 등간격만 있었다. */
/** 양 끝 객체를 그대로 두고 바운딩박스 사이 간격을 고르게 한다. axis:'x'|'y' */
export function evenSpacingPlan(entities,axis='x'){
 if((entities||[]).length<3)throw Error('등간격은 객체 세 개 이상이 필요합니다.');
 const lo=axis==='x'?'minX':'minY',hi=axis==='x'?'maxX':'maxY';
 const boxed=entities.map(e=>{const b=G.bounds([e]);if(!b)throw Error('크기를 읽을 수 없는 객체가 있습니다.');return {e,b};})
  .toSorted((p,q)=>p.b[lo]-q.b[lo]);
 const span=boxed.at(-1).b[hi]-boxed[0].b[lo];
 const widths=boxed.map(({b})=>b[hi]-b[lo]),total=widths.reduce((s,w)=>s+w,0);
 const gap=(span-total)/(boxed.length-1);
 if(!(gap>=-1e-6))throw Error('객체들의 폭 합이 양 끝 사이 거리보다 큽니다.');
 const plan=[];let cursor=boxed[0].b[lo];
 boxed.forEach(({e,b},i)=>{
  const d=cursor-b[lo];
  plan.push({id:e.id,dx:axis==='x'?d:0,dy:axis==='y'?d:0,angle:0});
  cursor+=widths[i]+gap;
 });
 return plan;
}
/** 목표 객체 위에서 기준점과 같은 높이(수평이동)/같은 가로위치(수직이동)의 점과 그 자리 각도. */
export function targetOnEntity(target,from,axis='x'){
 const ss=G.segments(target);
 if(!ss.length)throw Error('목표는 선·폴리선·호여야 합니다.');
 let best=null;
 for(const [a,b] of ss){
  const v=G.sub(b,a),denom=axis==='x'?v.y:v.x,base=axis==='x'?from.y-a.y:from.x-a.x;
  if(Math.abs(denom)>G.EPS){
   const t=base/denom;
   if(t>=-1e-9&&t<=1+1e-9){
    const hit=G.add(a,G.mul(v,t)),d=Math.abs(axis==='x'?hit.x-from.x:hit.y-from.y);
    if(!best||d<best.distance)best={point:hit,angle:G.normalizeAngle(G.angle(v)),distance:d};
   }
  }
 }
 if(best)return best;
 for(const [a,b] of ss){
  const v=G.sub(b,a),t=Math.max(0,Math.min(1,G.dot(G.sub(from,a),v)/Math.max(G.dot(v,v),G.EPS)));
  const hit=G.add(a,G.mul(v,t)),d=G.dist(hit,from);
  if(!best||d<best.distance)best={point:hit,angle:G.normalizeAngle(G.angle(v)),distance:d};
 }
 return best;
}
/**
 * @param {object[]} entities 정렬할 객체
 * @param {{target:'point'|'object'|'mid2'|'center2',move:'h'|'hEven'|'v'|'vEven',anchor:string,rotate:boolean}} cfg
 * @param {{point?:object,entity?:object,p1?:object,p2?:object}} aim
 * @returns {{id,dx,dy,angle,base}[]}
 */
export function alignPlan(entities,cfg,aim={}){
 const list=entities||[];
 if(!list.length)throw Error('정렬할 객체를 선택하세요.');
 const axis=cfg.move==='v'||cfg.move==='vEven'?'y':'x';
 if(cfg.move==='hEven'||cfg.move==='vEven'){
  /* 원문: 수평 등간격의 정렬 기준점은 항상 좌하귀, 수직 등간격은 항상 좌상귀(설정의 기준점을 쓰지 않는다). */
  return evenSpacingPlan(list,axis).map(p=>({...p,base:null}));
 }
 if(cfg.target==='mid2'||cfg.target==='center2'){
  const mid=P((aim.p1.x+aim.p2.x)/2,(aim.p1.y+aim.p2.y)/2);
  if(cfg.target==='mid2'){
   const base=groupAnchorPoint(list,cfg.anchor);
   return list.map(e=>({id:e.id,dx:mid.x-base.x,dy:mid.y-base.y,angle:0,base:anchorPoint(e,cfg.anchor)}));
  }
  return list.map(e=>{const base=anchorPoint(e,cfg.anchor);return {id:e.id,dx:mid.x-base.x,dy:mid.y-base.y,angle:0,base};});
 }
 return list.map(e=>{
  const base=anchorPoint(e,cfg.anchor);
  let point,angle=0;
  if(cfg.target==='point')point=aim.point;
  else{
   const hit=targetOnEntity(aim.entity,base,axis);
   point=hit.point;
   if(cfg.rotate)angle=shortAngle(hit.angle-facingAngle(e));
  }
  return {id:e.id,dx:axis==='x'?point.x-base.x:0,dy:axis==='y'?point.y-base.y:0,angle,base};
 });
}

/* ══════════════ OB · 양쪽 등간격띄우기 (원문 /362) ══════════════
   원문: 객체(여러 개 가능)를 선택하고 거리를 입력하면 양방향으로 동시에 옵셋된 두 선이 생기고, 결과는 현재 켜로 바뀐다.
   기존 DOUBLEOFFSET(workflows.js:276)은 방향점을 손으로 찍어야 하고 원본 켜를 그대로 물려받는다. */
/** 원본 한 개에서 좌우 두 쪽 결과를 만든다. 켜는 붙이지 않는다(현재 켜로 들어간다). */
export function doubleOffsetPair(e,distance){
 const d=Number(distance);
 if(!(d>G.EPS))throw Error('거리는 0보다 커야 합니다.');
 if(['circle','arc'].includes(e.type)){
  if(e.radius-d<=G.EPS)throw Error('안쪽 옵셋이 반지름보다 큽니다.');
  const outer=G.offsetEntity(e,d,G.add(e.center,P(e.radius+d+1,0))),inner=G.offsetEntity(e,d,e.center);
  return [outer,inner].map(x=>{const c=stripId(x);delete c.layer;return c;});
 }
 if(!['line','polyline','rectangle'].includes(e.type))throw Error('선·폴리선·원·호만 양쪽 옵셋할 수 있습니다.');
 const ss=G.segments(e).filter(([a,b])=>G.dist(a,b)>G.EPS);
 if(!ss.length)throw Error('길이가 0인 객체입니다.');
 const [a,b]=ss[0],mid=P((a.x+b.x)/2,(a.y+b.y)/2),n=G.normal(G.unit(G.sub(b,a)));
 const near=G.add(mid,G.mul(n,d+1)),far=G.add(mid,G.mul(n,-(d+1)));
 return [G.offsetEntity(e,d,near),G.offsetEntity(e,d,far)].map(x=>{const c=stripId(x);delete c.layer;return c;});
}

/* ══════════════ OM · 연속 간격띄우기 (원문 /357) ══════════════
   원문: 한 번 숫자를 입력하면 계속 같은 간격으로, 또는 매번 다른 간격으로 띄울 수 있다. 방향점을 지정한다. 0 으로 종료.
   기존 MULTIOFFSET(workflows.js:229)은 거리 목록을 쉼표로 한 번에 받고 방향점도 하나뿐이다. */
export function offsetOnce(e,distance,side){
 const d=Number(distance);
 if(!(d>G.EPS))throw Error('간격은 0보다 커야 합니다.');
 return stripId(G.offsetEntity(e,d,side));
}

/* ══════════════ RM · 자기 자리에서 회전/미러 (원문 /418) ══════════════
   원문 실행방식: [기본] 각자 제자리 회전 / [참조] 다른 객체 각도 참조 / [선택] 블럭·문자 각도 맞춤 /
   [한점] 지정한 점 바라보기(방향 4-라디오) / [묶음] 상대 위치 유지 일괄 회전 / [미러] 제자리 미러.
   [설정]: "기준점 설정" 3x3 라디오(기본 중심) + "삽입점 또는 시작점", "한 점으로 회전할 때의 객체 방향" 상측(기본)/우측/하측/좌측.
   기존 ROTATE(engine.js:328)는 선택한 모두가 하나의 공용 축으로 돈다. */
/** 각 객체가 자기 기준점을 축으로 도는 변경 목록. */
export function rotateEachPlan(entities,anchor,angle){
 const a=Number(angle);
 if(!Number.isFinite(a))throw Error('회전 각도를 숫자로 입력하세요.');
 return (entities||[]).map(e=>({id:e.id,changes:changesOf(G.rotate(e,anchorPoint(e,anchor),a))}));
}
/** 묶음 전체가 한 축으로 도는 변경 목록(상대 위치 유지). */
export function rotateGroupPlan(entities,pivot,angle){
 const a=Number(angle);
 if(!Number.isFinite(a))throw Error('회전 각도를 숫자로 입력하세요.');
 return (entities||[]).map(e=>({id:e.id,changes:changesOf(G.rotate(e,pivot,a))}));
}
/** 기준 묶음의 회전점이 바운딩박스 안에서 차지하던 비율. 다른 묶음에 같은 자리를 잡아준다. */
export function pivotRatio(entities,pivot){
 const b=G.bounds(entities);
 if(!b)throw Error('묶음의 크기를 읽을 수 없습니다.');
 const w=b.maxX-b.minX,h=b.maxY-b.minY;
 return {fx:w>G.EPS?(pivot.x-b.minX)/w:0.5,fy:h>G.EPS?(pivot.y-b.minY)/h:0.5};
}
export function pivotFromRatio(entities,ratio){
 const b=G.bounds(entities);
 if(!b)throw Error('묶음의 크기를 읽을 수 없습니다.');
 return P(b.minX+(b.maxX-b.minX)*ratio.fx,b.minY+(b.maxY-b.minY)*ratio.fy);
}
/** 제자리 미러. axis:'v' 세로축(좌우 뒤집기) | 'h' 가로축(위아래 뒤집기) */
export function mirrorEachPlan(entities,anchor,axis='v'){
 return (entities||[]).map(e=>{
  const base=anchorPoint(e,anchor),other=axis==='h'?P(base.x+1,base.y):P(base.x,base.y+1);
  return {id:e.id,changes:changesOf(G.mirror(e,base,other))};
 });
}

/* ══════════════ SM · 자기 자리에서 크기변경 (원문 /419) ══════════════
   원문: [자기자리에서 크기변경] 각자 제자리 축척 / [기준 객체와 크기를 통일] (가) 도곽·폴리선 안 객체까지 (나) 선택 전체 통일 /
   [묶음] 기준 묶음의 기준점을 따로 지정해 전체 적용(이때 설정의 기준점은 무시).
   [설정] "기준점 설정" 3x3 라디오(기본 좌하) + "삽입점 또는 시작점".
   기존 SCALE(engine.js:328)은 공용 base·공용 factor 를 모두에게 똑같이 적용한다. */
export function scaleEachPlan(entities,anchor,factor){
 const f=Number(factor);
 if(!(f>G.EPS))throw Error('축척 비율은 0보다 커야 합니다.');
 return (entities||[]).map(e=>({id:e.id,changes:changesOf(G.resize(e,anchorPoint(e,anchor),f))}));
}
export function scaleGroupPlan(entities,pivot,factor){
 const f=Number(factor);
 if(!(f>G.EPS))throw Error('축척 비율은 0보다 커야 합니다.');
 return (entities||[]).map(e=>({id:e.id,changes:changesOf(G.resize(e,pivot,f))}));
}
/** 크기 재기. metric:'diag'|'width'|'height' */
export function entitySize(e,metric='diag'){
 const b=G.bounds([e]);
 if(!b)throw Error('크기를 읽을 수 없는 객체입니다.');
 const w=b.maxX-b.minX,h=b.maxY-b.minY;
 return metric==='width'?w:metric==='height'?h:Math.hypot(w,h);
}
/** [기준 객체와 크기를 통일] · 각 객체가 기준 크기와 같아지는 배율. */
export function unifyFactors(entities,reference,metric='diag'){
 const target=entitySize(reference,metric);
 if(!(target>G.EPS))throw Error('기준 객체의 크기가 0 입니다.');
 return (entities||[]).map(e=>{
  const size=entitySize(e,metric);
  if(!(size>G.EPS))throw Error('크기가 0인 객체가 섞여 있습니다.');
  return {id:e.id,factor:target/size};
 });
}
/** 도곽 블럭·닫힌 폴리선 테두리 안에 들어간 객체를 고른다(정점이 모두 안쪽일 때). */
export function entitiesInsideBoundary(entities,boundary){
 const polygon=boundary.type==='block'
  ?(()=>{const b=G.bounds([boundary]);if(!b)throw Error('도곽의 크기를 읽을 수 없습니다.');return [P(b.minX,b.minY),P(b.maxX,b.minY),P(b.maxX,b.maxY),P(b.minX,b.maxY)];})()
  :boundary.points;
 if(!polygon||polygon.length<3)throw Error('닫힌 폴리선·사각형·도곽 블럭을 테두리로 고르세요.');
 return (entities||[]).filter(e=>{
  if(e.id===boundary.id)return false;
  const vs=G.vertices(e);
  return vs.length>0&&vs.every(p=>G.inside(p,polygon));
 });
}

/* ══════════════ 3x3 기준점 미리보기 SVG ══════════════ */
const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
export function anchorGridSvg(anchor='MC',{width=480,height=130,compact=false,caption=''}={}){
 const key=String(anchor||'MC').toUpperCase();
 const cell=compact?Math.max(6,Math.floor(Math.min(width,height)/4)):Math.max(14,Math.floor((height-24)/3));
 const size=cell*3,x0=compact?Math.max(2,(width-size)/2):12,y0=(height-size)/2;
 const rows=['T','M','B'],cols=['L','C','R'];
 let svg=`<svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg"><rect width="${width}" height="${height}" fill="#101820"/>`;
 svg+=`<rect x="${x0}" y="${y0}" width="${size}" height="${size}" fill="none" stroke="#7fd1e0" stroke-width="1.2"/>`;
 for(let r=0;r<3;r++)for(let c=0;c<3;c++){
  const cellKey=rows[r]+cols[c],on=cellKey===key;
  svg+=`<rect x="${x0+c*cell}" y="${y0+r*cell}" width="${cell}" height="${cell}" fill="${on?'#ffd479':'none'}" stroke="#3b4a56" stroke-width="0.6"/>`;
  svg+=`<circle cx="${x0+c*cell+cell/2}" cy="${y0+r*cell+cell/2}" r="${compact?1.2:2.4}" fill="${on?'#101820':'#7f8c99'}"/>`;
 }
 if(compact)return svg+'</svg>';
 const tx=x0+size+18,ins=key==='INS';
 svg+=`<circle cx="${tx+6}" cy="${y0+8}" r="6" fill="${ins?'#ffd479':'none'}" stroke="#7fd1e0" stroke-width="1.2"/>`;
 svg+=`<text x="${tx+20}" y="${y0+13}" fill="#c9d1d9" font-size="13">삽입점 또는 시작점</text>`;
 const label=(ANCHOR_OPTIONS.find(([k])=>k===key)||['','중심'])[1];
 svg+=`<text x="${tx}" y="${y0+size/2+6}" fill="#ffd479" font-size="14">기준점: ${esc(label)}</text>`;
 if(caption)svg+=`<text x="${tx}" y="${y0+size}" fill="#8a97a3" font-size="12">${esc(caption)}</text>`;
 return svg+'</svg>';
}

/* ══════════════════════════════ 화면 흐름 ══════════════════════════════ */
export function installMultiTools4(ctx){
 const fail=e=>{console.error('[card]',e);ctx.toast(ctx.userErrorMessage(e),true);};
 const guard=fn=>async(...a)=>{try{await fn(...a);}catch(e){fail(e);}};
 const tol=()=>{try{const t=ctx.tolerance();return Number.isFinite(t)&&t>0?t:1;}catch{return 1;}};
 /** check(values) 가 던지면 폼이 열린 채 그 문구를 보여 준다(폼이 잡는다). */
 const askForm=(title,fields,check=null)=>new Promise(resolve=>{ctx.form(title,fields,values=>{if(check)check(values);resolve(values);});});
 const settings=(key,def)=>{try{return {...def,...JSON.parse(ctx.storage?.getItem(key)??'{}')};}catch{return {...def};}};
 const saveSettings=(key,value)=>{try{ctx.storage?.setItem(key,JSON.stringify(value));}catch{}};
 const numberOf=(raw,label)=>{const n=Number(String(raw??'').trim());if(!Number.isFinite(n))throw Error(`${label}를 숫자로 입력하세요.`);return n;};
 /** 선택된 객체를 쓰거나, 없으면 Esc 까지 반복해 클릭으로 모은다. */
 async function collect(prompt,{types=null,filter=null,usePre=true}={}){
  const ok=e=>(!types||types.includes(e.type))&&(!filter||filter(e));
  if(usePre){const pre=ctx.selected().filter(ok);if(pre.length)return pre;}
  const list=[];
  for(;;){
   const e=await ctx.pickEntity({prompt:`${prompt} · Esc: 선택 마침${list.length?` · 지금까지 ${list.length}개`:''}`,...(types?{types}:{})});
   if(!e)break;
   if(!ok(e)){ctx.toast('이 명령이 다룰 수 있는 객체가 아닙니다.',true);continue;}
   if(!list.some(x=>x.id===e.id))list.push(e);
  }
  if(!list.length)throw Error('선택한 객체가 없습니다.');
  return list;
 }
 const applyChanges=(plan,message)=>{
  if(!plan.length)throw Error('바꿀 객체가 없습니다.');
  ctx.execute({type:'batch',commands:plan.map(p=>({type:'update',ids:[p.id],changes:p.changes}))});
  ctx.refresh();ctx.toast(message);
 };
 const moveOrCopy=(plan,entities,copy,message)=>{
  const byId=new Map(entities.map(e=>[e.id,e]));
  if(copy){
   const made=plan.map(p=>{
    const e=byId.get(p.id);
    let out=G.translate(e,p.dx,p.dy);
    if(p.angle)out=G.rotate(out,G.add(p.base||anchorPoint(e,'MC'),P(p.dx,p.dy)),p.angle);
    return stripId(out);
   });
   ctx.commit({entities:made});
  }else{
   ctx.execute({type:'batch',commands:plan.map(p=>{
    const e=byId.get(p.id);
    let out=G.translate(e,p.dx,p.dy);
    if(p.angle)out=G.rotate(out,G.add(p.base||anchorPoint(e,'MC'),P(p.dx,p.dy)),p.angle);
    return {type:'update',ids:[e.id],changes:changesOf(out)};
   })});
   ctx.refresh();
  }
  ctx.toast(message);
 };

 /* ── DVC · 등분 복사하기 (/282) ── */
 const DVC_MODES=[['divide','등분(기본)'],['in','등폭(In) · 간격이 바깥, 객체가 안쪽'],['out','등폭(Out) · 객체가 바깥, 간격이 안쪽'],
  ['min','최소간격(M) · 개수 자동'],['max','최대간격(X) · 개수 자동']];
 const dvc=async()=>{
  const targets=await collect('DVC · 복사할 객체를 선택');
  const base=await ctx.pickPoint('DVC · 복사 기준점을 지정하세요 · Esc: 생략(자기 자리에서 등분된 거리만큼 복사)');
  const a=await ctx.pickPoint('DVC · 등분할 거리의 첫 점 · Esc 취소');
  if(!a)return;
  const b=await ctx.pickPoint('DVC · 등분할 거리의 둘째 점 · Esc 취소');
  if(!b)return;
  const saved=settings('barun.card.DVC',{mode:'divide',count:4,gap:800});
  const v=await askForm(`DVC · 등분 복사하기 · 두 점 거리 ${G.dist(a,b).toFixed(1)} mm`,[
   {name:'mode',label:'방식 · 원문 명령행 키워드를 칸으로 옮겼습니다',type:'select',value:saved.mode,options:DVC_MODES},
   {name:'count',label:'등분 갯수 (등분·등폭에서 씀)',type:'number',value:saved.count},
   {name:'gap',label:'간격 mm (최소간격 M · 최대간격 X 에서 씀)',type:'number',value:saved.gap}]);
  const mode=v.mode,count=numberOf(v.count,'등분 갯수'),gap=numberOf(v.gap,'간격');
  saveSettings('barun.card.DVC',{mode,count,gap});
  let width=0,widthAngle=0,origin=base;
  if(mode==='in'||mode==='out'){
   const w1=await ctx.pickPoint('DVC · 객체 폭을 정하는 첫 점 · 이 두 점의 중간이 복사 기준점이 됩니다 · Esc 취소');
   if(!w1)return;
   const w2=await ctx.pickPoint('DVC · 객체 폭을 정하는 둘째 점 · Esc 취소');
   if(!w2)return;
   width=G.dist(w1,w2);widthAngle=G.angle(G.sub(w2,w1));
   origin=P((w1.x+w2.x)/2,(w1.y+w2.y)/2);
  }
  const plan=divideCopyPlan({a,b,mode,count,gap,width});
  const u=G.unit(G.sub(b,a)),turn=(mode==='in'||mode==='out')?shortAngle(plan.angle-widthAngle):0;
  const made=[];
  const offsets=origin?plan.offsets:plan.offsets.slice(1);
  for(const s of offsets){
   const at=G.add(a,G.mul(u,s));
   for(const e of targets){
    let out=origin?G.translate(e,at.x-origin.x,at.y-origin.y):G.translate(e,u.x*s,u.y*s);
    if(turn)out=G.rotate(out,origin?at:anchorPoint(out,'MC'),turn);
    made.push(stripId(out));
   }
  }
  if(!made.length)throw Error('복사할 자리가 없습니다.');
  ctx.commit({entities:made});
  ctx.toast(`DVC · ${DVC_MODES.find(([k])=>k===mode)[1]} · ${plan.count}등분 · 실제 간격 ${plan.spacing.toFixed(1)} mm · ${made.length}개 복사 · Ctrl+Z 로 되돌리기`);
 };

 /* ── EXL · 선 길이 조절 (/578) ── */
 const exl=async()=>{
  const saved=settings('barun.card.EXL',{length:300});
  let last=saved.length,done=0;
  for(;;){
   const e=await ctx.pickEntity({prompt:`EXL · 길이를 조절할 선·호·폴리선을 선택${done?` · 지금까지 ${done}개`:''} · Esc 종료`,types:['line','polyline','arc']});
   if(!e)break;
   const dir=await ctx.pickPoint('EXL · 늘리거나 줄일 방향(끝) 쪽을 클릭하세요 · Esc: 이 객체 건너뛰기');
   if(!dir)continue;
   const end=nearerEnd(e,dir);
   const v=await askForm(`EXL · 선 길이 조절 · ${end==='start'?'시작점':'끝점'} 쪽`,[
    {name:'length',label:'길이 mm · 양수는 늘리기, 음수는 줄이기',type:'number',value:last}]);
   const delta=numberOf(v.length,'길이');
   last=delta;saveSettings('barun.card.EXL',{length:delta});
   applyChanges([{id:e.id,changes:extendEndChanges(e,end,delta)}],
    `EXL · ${e.type==='arc'?'호':'선'}의 ${end==='start'?'시작점':'끝점'}을 ${delta>0?'+':''}${delta} mm 옮겼습니다 · Ctrl+Z 로 되돌리기`);
   done++;
  }
  if(!done)ctx.toast('EXL · 조절한 객체가 없습니다.');
 };

 /* ── JL · 선 잇기 (/146) ──
    원문: 강제색/선모양 유지 여부를 한 번만 묻고, 그 답은 캐드를 다시 시작할 때까지 유지한다.
    브라우저·Electron 창을 다시 열면 이 변수가 사라지므로 "캐드 재시작까지 유지"와 같은 범위다. */
 let jlByLayer=null;
 const jl=async()=>{
  if(jlByLayer===null){
   const v=await askForm('JL · 선 잇기',[{name:'byLayer',label:'강제색·강제 선모양을 모두 ByLayer 로 통일 (끄면 원래 속성을 유지) · 이 답은 캐드를 다시 켤 때까지 유지됩니다',type:'checkbox',value:''}]);
   jlByLayer=v.byLayer==='on';
  }
  const targets=await collect('JL · 이을 선·폴리선을 선택',{types:['line','polyline'],filter:e=>!e.closed});
  if(targets.length<2)throw Error('이을 선을 두 개 이상 선택하세요.');
  const groups=joinGroups(targets,Math.max(tol(),0.001));
  if(!groups.length)throw Error('끝점이 맞닿은 선이 없습니다. 원·호가 섞인 벽체는 WR 을 쓰세요.');
  ctx.commit({removeIds:groups.flatMap(g=>g.ids),entities:groups.map(g=>joinedEntity(g,jlByLayer))});
  ctx.toast(`JL · 선 ${groups.reduce((s,g)=>s+g.ids.length,0)}개를 ${groups.length}개로 이었습니다${jlByLayer?' · 색·선모양 ByLayer 통일':' · 원래 색·선모양 유지'} · Ctrl+Z 로 되돌리기`);
 };

 /* ── MC · 등간격 연속복사 (/606) ── */
 const mc=async()=>{
  const targets=await collect('MC · 연속 복사할 객체를 선택');
  const v=await askForm('MC · 등간격 연속복사',[
   {name:'action',label:'작업',type:'select',value:'copy',options:[['copy','복사'],['move','이동']]}]);
  const move=v.action==='move';
  const a=await ctx.pickPoint('MC · 기준점을 지정하세요 · Esc 취소');
  if(!a)return;
  const b=await ctx.pickPoint('MC · 방향과 간격을 정할 점을 지정하세요 · Esc 취소');
  if(!b)return;
  let spacing=G.dist(a,b);
  if(!(spacing>G.EPS))throw Error('기준점과 다른 점을 지정하세요.');
  const u=G.unit(G.sub(b,a));
  let ids=targets.map(e=>e.id),steps=0,total=0;
  for(;;){
   const d=stepDelta(u,spacing);
   if(move){
    ctx.execute({type:'batch',commands:ids.map(id=>({type:'move',ids:[id],dx:d.x,dy:d.y}))});
    ctx.refresh();
   }else{
    const source=ctx.entities().filter(e=>ids.includes(e.id));
    const made=source.map(e=>stripId(G.translate(e,d.x,d.y)));
    ids=ctx.commit({entities:made})||ids;
   }
   steps++;total+=spacing;
   if(ctx.scripted&&ctx.scripted.remainingForms?.()===0)break; // AI 연결: 보낸 간격을 다 쓰면 끝(빈 칸을 직전 간격으로 채워 끝없이 복사하지 않게)
   const next=await askForm(`MC · ${steps}칸째 ${move?'이동':'복사'} 완료 · 누적 ${total.toFixed(1)} mm`,[
    {name:'gap',label:'다음 간격 mm · 0 을 넣으면 종료합니다',type:'number',value:spacing}]);
   const gap=numberOf(next.gap,'간격');
   if(gap===0)break;
   if(gap<0)throw Error('간격은 0 이상이어야 합니다.');
   spacing=gap;
  }
  ctx.toast(`MC · ${steps}칸 ${move?'이동':'연속 복사'}했습니다 · 되돌리기는 한 칸씩(Ctrl+Z ${steps}번)`);
 };

 /* ── OA · 객체 정렬 (/451) ── */
 const OA_KEY='barun.card.OA.v1';
 const OA_FIELDS=[
  {key:'runMode',label:'실행방식',type:'select',def:'dialog',group:'실행방식',
   options:[['dialog','대화상자(모든 기능)'],['command','명령창(두점중간·두점중심만)']],
   hint:'원문의 [명령창]은 대화상자를 건너뛰고 두 가지 키워드만 쓰는 방식입니다.'},
  {key:'target',label:'목표',type:'select',def:'point',group:'목표',
   options:[['point','점 지정'],['object','객체선택(폴리선·선·호)'],['mid2','두점중간(전체를 한 덩어리로)'],['center2','두점중심(각 객체 개별)']]},
  {key:'rotate',label:'객체 각도에 맞추어 회전',type:'check',def:false,group:'목표',
   when:v=>v.target==='object',hint:'목표 객체를 골랐을 때만 씁니다.'},
  {key:'move',label:'이동방식',type:'select',def:'h',group:'이동방식',
   options:[['h','수평이동'],['hEven','수평 등간격'],['v','수직이동'],['vEven','수직 등간격']],
   hint:'등간격은 양 끝 객체를 그대로 두고 사이 간격만 고르게 합니다(수평은 좌하귀, 수직은 좌상귀 기준).'},
  {key:'anchor',label:'기준점',type:'select',def:'MC',options:ANCHOR_OPTIONS,group:'기준점'},
  {key:'copy',label:'복사',type:'check',def:false,group:'기준점',hint:'등간격 두 방식은 원문대로 이 칸과 무관하게 이동만 합니다.'}];
 const runOA=async v=>{
  const cfg={target:v.target,move:v.move,anchor:v.anchor,rotate:!!v.rotate,copy:!!v.copy};
  if(v.runMode==='command'&&!['mid2','center2'].includes(cfg.target))
   cfg.target=(await askForm('OA · 명령창 방식',[{name:'kw',label:'방식',type:'select',value:'mid2',options:[['mid2','두점중간(MP)'],['center2','두점중심(MC)']]}])).kw;
  const targets=await collect('OA · 정렬할 객체를 선택');
  const aim={};
  if(cfg.target==='point'){
   aim.point=await ctx.pickPoint('OA · 정렬할 목표 점을 지정하세요 · Esc 취소');
   if(!aim.point)return;
  }else if(cfg.target==='object'){
   aim.entity=await ctx.pickEntity({prompt:'OA · 목표 객체(폴리선·선·호)를 선택하세요 · Esc 취소',types:['line','polyline','rectangle','arc']});
   if(!aim.entity)return;
  }else{
   aim.p1=await ctx.pickPoint('OA · 첫 점을 지정하세요 · Esc 취소');
   if(!aim.p1)return;
   aim.p2=await ctx.pickPoint('OA · 둘째 점을 지정하세요 · Esc 취소');
   if(!aim.p2)return;
  }
  const even=cfg.move==='hEven'||cfg.move==='vEven';
  const plan=alignPlan(targets,cfg,aim);
  moveOrCopy(plan,targets,cfg.copy&&!even,
   `OA · ${targets.length}개를 정렬했습니다${even?' · 등간격은 원문대로 이동만 합니다':cfg.copy?' · 복사':''} · Ctrl+Z 로 되돌리기`);
 };
 const oa=()=>openCardDialog({ctx,title:'객체 정렬 · OA',storageKey:OA_KEY,fields:OA_FIELDS,slots:1,
  goLabel:'정렬 시작',preview:(v,s,o)=>anchorGridSvg(v.anchor,o),
  onGo:v=>runOA(v).catch(fail),
  note:'[정렬 시작] → 객체 선택(Esc 로 선택 끝) → 목표(점·객체·두 점) 순서입니다.'});

 /* ── OB · 양쪽 등간격띄우기 (/362) ── */
 const ob=async()=>{
  const targets=await collect('OB · 양쪽으로 띄울 객체를 선택',{types:['line','polyline','rectangle','circle','arc']});
  const saved=settings('barun.card.OB',{distance:100});
  const v=await askForm('OB · 양쪽 등간격띄우기',[{name:'distance',label:'거리 mm · 결과는 현재 켜로 들어갑니다',type:'number',value:saved.distance}]);
  const distance=numberOf(v.distance,'거리');
  saveSettings('barun.card.OB',{distance});
  const made=targets.flatMap(e=>doubleOffsetPair(e,distance));
  ctx.commit({entities:made});
  ctx.toast(`OB · ${targets.length}개를 양쪽 ${distance} mm 로 띄워 ${made.length}개를 현재 켜에 만들었습니다 · 이어서 FL·FT·FX 로 정리하세요 · Ctrl+Z 로 되돌리기`);
 };

 /* ── OM · 연속 간격띄우기 (/357) ── */
 const om=async()=>{
  const saved=settings('barun.card.OM',{distance:100,each:false});
  const v=await askForm('OM · 연속 간격띄우기',[
   {name:'distance',label:'첫 간격 mm',type:'number',value:saved.distance},
   {name:'each',label:'매번 다른 간격을 묻기 (끄면 같은 간격으로 계속)',type:'checkbox',value:saved.each?'on':''}]);
  let distance=numberOf(v.distance,'간격');
  const each=v.each==='on';
  saveSettings('barun.card.OM',{distance,each});
  let done=0;
  for(;;){
   if(each&&done){
    const next=await askForm(`OM · ${done}번째까지 띄웠습니다`,[{name:'distance',label:'다음 간격 mm · 0 을 넣으면 종료합니다',type:'number',value:distance}]);
    const d=numberOf(next.distance,'간격');
    if(d===0)break;
    if(d<0)throw Error('간격은 0 이상이어야 합니다.');
    distance=d;
   }
   const e=await ctx.pickEntity({prompt:`OM · 간격 ${distance} mm 로 띄울 객체를 선택${done?` · 지금까지 ${done}개`:''} · Esc 종료`,types:['line','polyline','rectangle','circle','arc']});
   if(!e)break;
   const side=await ctx.pickPoint('OM · 띄울 방향 쪽을 클릭하세요 · Esc: 이 객체 건너뛰기');
   if(!side)continue;
   ctx.commit({entities:[offsetOnce(e,distance,side)]});
   done++;
  }
  ctx.toast(done?`OM · 연속으로 ${done}개를 띄웠습니다 · 되돌리기는 한 개씩(Ctrl+Z ${done}번)`:'OM · 띄운 객체가 없습니다.');
 };

 /* ── RM · 자기 자리에서 회전/미러 (/418) ── */
 const RM_KEY='barun.card.RM.v1';
 const RM_FIELDS=[
  {key:'anchor',label:'기준점 설정',type:'select',def:'MC',options:ANCHOR_OPTIONS,group:'기준점 설정'},
  {key:'angle',label:'기본 회전 각도 (도)',type:'number',def:90,step:'any',group:'기준점 설정',
   hint:'실행할 때 이 값을 기본으로 다시 묻습니다(원문은 명령행에서 묻습니다).'},
  {key:'facing',label:'한 점으로 회전할 때의 객체 방향',type:'select',def:'up',group:'한 점으로 회전할 때의 객체 방향',
   options:[['up','상측'],['right','우측'],['down','하측'],['left','좌측']]},
  {key:'mirrorAxis',label:'[미러] 축',type:'select',def:'v',group:'한 점으로 회전할 때의 객체 방향',
   options:[['v','세로축(좌우 뒤집기)'],['h','가로축(위아래 뒤집기)']],
   hint:'원문에 [미러] 예시 그림이 없어 축을 고르게 두었습니다.'}];
 const readAngle=v=>{const a=numberOf(v.angle,'회전 각도');if(Math.abs(a)>360)throw Error('회전 각도는 -360~360도 사이로 입력하세요.');return a;};
 const askAngle=async(title,def)=>readAngle(await askForm(title,[{name:'angle',label:'회전 각도 (도) · 반시계가 +',type:'number',value:def}],readAngle));
 const runRM=async(v,method)=>{
  if(method==='mirror'){
   const targets=await collect('RM[미러] · 제자리에서 뒤집을 객체를 선택');
   applyChanges(mirrorEachPlan(targets,v.anchor,v.mirrorAxis),
    `RM[미러] · ${targets.length}개를 각자 제자리에서 ${v.mirrorAxis==='h'?'위아래':'좌우'}로 뒤집었습니다 · Ctrl+Z 로 되돌리기`);
   return;
  }
  if(method==='group'){
   const first=await collect('RM[묶음] · 기준 묶음의 객체를 선택');
   const pivot=await ctx.pickPoint('RM[묶음] · 기준 묶음의 회전점을 지정하세요 · Esc 취소');
   if(!pivot)return;
   const angle=await askAngle('RM[묶음] · 회전 각도',v.angle);
   const ratio=pivotRatio(first,pivot);
   applyChanges(rotateGroupPlan(first,pivot,angle),`RM[묶음] · 기준 묶음 ${first.length}개를 ${angle}도 돌렸습니다 · Ctrl+Z 로 되돌리기`);
   let more=0;
   for(;;){
    const next=await collect(`RM[묶음] · 같은 패턴의 다음 묶음을 선택${more?` · 지금까지 ${more}묶음`:''}`,{usePre:false}).catch(()=>null);
    if(!next)break;
    applyChanges(rotateGroupPlan(next,pivotFromRatio(next,ratio),angle),`RM[묶음] · ${more+1}번째 묶음(${next.length}개)을 같은 자리·같은 각도로 돌렸습니다 · Ctrl+Z 로 되돌리기`);
    more++;
   }
   ctx.toast(`RM[묶음] · 기준 묶음 + 추가 ${more}묶음을 ${angle}도 돌렸습니다.`);
   return;
  }
  if(method==='point'){
   const targets=await collect('RM[한점] · 회전할 객체를 선택');
   const aim=await ctx.pickPoint('RM[한점] · 바라볼 점을 지정하세요 · Esc 취소');
   if(!aim)return;
   const plan=targets.map(e=>{
    const base=anchorPoint(e,v.anchor);
    return {id:e.id,changes:changesOf(G.rotate(e,base,faceRotation(facingAngle(e),v.facing,base,aim)))};
   });
   applyChanges(plan,`RM[한점] · ${targets.length}개의 ${{up:'상측',right:'우측',down:'하측',left:'좌측'}[v.facing]}이 지정한 점을 바라보게 돌렸습니다 · Ctrl+Z 로 되돌리기`);
   return;
  }
  if(method==='reference'||method==='select'){
   const types=method==='select'?['block','text']:['line','polyline','rectangle','arc','text','block','dimension'];
   const ref=await ctx.pickEntity({prompt:`RM[${method==='select'?'선택':'참조'}] · 각도를 가져올 ${method==='select'?'블럭·문자':'객체'}를 선택하세요 · Esc 취소`,types});
   if(!ref)return;
   const refAngle=facingAngle(ref);
   const targets=await collect(`RM[${method==='select'?'선택':'참조'}] · 그 각도에 맞출 객체를 선택`,method==='select'?{types:['block','text'],usePre:false}:{usePre:false});
   const plan=targets.map(e=>({id:e.id,changes:changesOf(G.rotate(e,anchorPoint(e,v.anchor),shortAngle(refAngle-facingAngle(e))))}));
   applyChanges(plan,`RM[${method==='select'?'선택':'참조'}] · ${targets.length}개를 기준 각도 ${refAngle.toFixed(2)}도에 맞췄습니다 · Ctrl+Z 로 되돌리기`);
   return;
  }
  const targets=await collect('RM[기본] · 각자 제자리에서 돌릴 객체를 선택');
  const angle=await askAngle('RM[기본] · 회전 각도',v.angle);
  applyChanges(rotateEachPlan(targets,v.anchor,angle),
   `RM[기본] · ${targets.length}개를 각자 자기 기준점에서 ${angle}도 돌렸습니다 · Ctrl+Z 로 되돌리기`);
 };
 const rm=()=>openCardDialog({ctx,title:'자기 자리에서 회전 · RM',storageKey:RM_KEY,fields:RM_FIELDS,slots:1,
  goLabel:'회전 시작',preview:(v,s,o)=>anchorGridSvg(v.anchor,{...o,caption:`한 점 방향: ${{up:'상측',right:'우측',down:'하측',left:'좌측'}[v.facing]||'상측'}`}),
  methods:{legend:'실행방식',def:'basic',options:[
   ['basic','기본','삽입점·시작점(또는 고른 기준점)을 축으로 각자 제자리 회전'],
   ['reference','참조','화면의 다른 객체 각도를 참조해 그 각도에 맞춤'],
   ['select','선택','블럭·문자만 · 다른 블럭·문자의 각도에 맞춤'],
   ['point','한점','지정한 한 점을 바라보도록 회전(방향은 설정의 4-라디오)'],
   ['group','묶음','묶음을 한 단위로 회전 · 다음 묶음들도 같은 자리에서 같은 각도로'],
   ['mirror','미러','자기 자리에서 미러']]},
  onGo:(v,s,method)=>runRM(v,method).catch(fail),
  note:'[회전 시작] → 객체 선택(Esc 로 선택 끝) → 방식에 따라 참조 객체·바라볼 점·회전점 순서입니다.'});

 /* ── SM · 자기 자리에서 크기변경 (/419) ── */
 const SM_KEY='barun.card.SM.v1';
 const SM_FIELDS=[
  {key:'anchor',label:'기준점 설정',type:'select',def:'BL',options:ANCHOR_OPTIONS,group:'기준점 설정'},
  {key:'factor',label:'기본 축척값',type:'number',def:0.5,step:'any',min:0.0001,group:'기준점 설정',
   hint:'실행할 때 이 값을 기본으로 다시 묻습니다.'},
  {key:'metric',label:'[통일] 크기 재는 법',type:'select',def:'diag',group:'기준 객체와 크기를 통일',
   options:[['diag','바운딩박스 대각선'],['width','가로폭'],['height','세로높이']]},
  {key:'inside',label:'[통일] 도곽·폴리선 테두리 안 객체까지 함께',type:'check',def:true,group:'기준 객체와 크기를 통일'}];
 const askFactor=async(title,def)=>{
  const f=numberOf((await askForm(title,[{name:'factor',label:'축척값 · 1 보다 작으면 축소',type:'number',value:def}])).factor,'축척값');
  if(!(f>0))throw Error('축척값은 0보다 커야 합니다.');
  return f;
 };
 const runSM=async(v,method)=>{
  if(method==='group'){
   const first=await collect('SM[묶음] · 기준 묶음의 객체를 선택');
   const pivot=await ctx.pickPoint('SM[묶음] · 기준 묶음의 크기변경 기준점을 지정하세요 · Esc 취소 · 이때 설정의 기준점은 무시됩니다');
   if(!pivot)return;
   const factor=await askFactor('SM[묶음] · 축척값',v.factor);
   const ratio=pivotRatio(first,pivot);
   applyChanges(scaleGroupPlan(first,pivot,factor),`SM[묶음] · 기준 묶음 ${first.length}개를 ${factor}배 했습니다 · Ctrl+Z 로 되돌리기`);
   let more=0;
   for(;;){
    const next=await collect(`SM[묶음] · 다음 묶음을 선택${more?` · 지금까지 ${more}묶음`:''}`,{usePre:false}).catch(()=>null);
    if(!next)break;
    applyChanges(scaleGroupPlan(next,pivotFromRatio(next,ratio),factor),`SM[묶음] · ${more+1}번째 묶음(${next.length}개)을 같은 자리에서 ${factor}배 했습니다 · Ctrl+Z 로 되돌리기`);
    more++;
   }
   ctx.toast(`SM[묶음] · 기준 묶음 + 추가 ${more}묶음을 ${factor}배 했습니다.`);
   return;
  }
  if(method==='unify'){
   const ref=await ctx.pickEntity({prompt:'SM[통일] · 크기 기준이 될 객체를 선택하세요 · Esc 취소'});
   if(!ref)return;
   let targets=await collect('SM[통일] · 그 크기로 맞출 객체를 선택',{usePre:false,filter:e=>e.id!==ref.id});
   if(v.inside){
    const extra=[];
    for(const e of targets)
     if(e.type==='block'||((e.type==='polyline'&&e.closed)||e.type==='rectangle'))
      for(const inner of entitiesInsideBoundary(ctx.entities(),e))
       if(inner.id!==ref.id&&!targets.some(t=>t.id===inner.id)&&!extra.some(t=>t.id===inner.id))extra.push(inner);
    if(extra.length){
     const borders=new Map(targets.map(e=>[e.id,e]));
     const factors=new Map(unifyFactors(targets,ref,v.metric).map(f=>[f.id,f.factor]));
     const plan=[];
     for(const e of targets)plan.push({id:e.id,changes:changesOf(G.resize(e,anchorPoint(e,v.anchor),factors.get(e.id)))});
     for(const inner of extra){
      const host=targets.find(t=>borders.has(t.id)&&entitiesInsideBoundary([inner],t).length);
      if(!host)continue;
      plan.push({id:inner.id,changes:changesOf(G.resize(inner,anchorPoint(host,v.anchor),factors.get(host.id)))});
     }
     applyChanges(plan,`SM[통일] · 테두리 ${targets.length}개와 그 안 객체 ${extra.length}개를 기준 크기에 맞췄습니다 · Ctrl+Z 로 되돌리기`);
     return;
    }
   }
   const factors=unifyFactors(targets,ref,v.metric);
   const byId=new Map(targets.map(e=>[e.id,e]));
   applyChanges(factors.map(f=>({id:f.id,changes:changesOf(G.resize(byId.get(f.id),anchorPoint(byId.get(f.id),v.anchor),f.factor))})),
    `SM[통일] · ${factors.length}개를 기준 객체 크기로 통일했습니다 · Ctrl+Z 로 되돌리기`);
   return;
  }
  const targets=await collect('SM[자기자리] · 제자리에서 크기를 바꿀 객체를 선택');
  const factor=await askFactor('SM[자기자리] · 축척값',v.factor);
  applyChanges(scaleEachPlan(targets,v.anchor,factor),
   `SM[자기자리] · ${targets.length}개를 각자 자기 기준점에서 ${factor}배 했습니다 · Ctrl+Z 로 되돌리기`);
 };
 const sm=()=>openCardDialog({ctx,title:'자기 자리에서 크기변경 · SM',storageKey:SM_KEY,fields:SM_FIELDS,slots:1,
  goLabel:'크기변경 시작',preview:(v,s,o)=>anchorGridSvg(v.anchor,{...o,caption:'원문 기본값은 좌하입니다'}),
  methods:{legend:'실행방식',def:'each',options:[
   ['each','자기자리에서 크기변경','고른 기준점을 축으로 각자 제자리에서 축척'],
   ['unify','기준 객체와 크기를 통일','기준 객체 크기에 맞춰 각자 배율을 따로 계산 · 테두리 안 객체까지'],
   ['group','묶음','묶음의 기준점을 따로 지정해 전체 적용(설정의 기준점 무시)']]},
  onGo:(v,s,method)=>runSM(v,method).catch(fail),
  note:'[크기변경 시작] → 방식에 따라 기준 객체·객체 선택·축척값 순서입니다.'});

 return {DVC:guard(dvc),EXL:guard(exl),JL:guard(jl),MC:guard(mc),OA:guard(oa),OB:guard(ob),OM:guard(om),RM:guard(rm),SM:guard(sm)};
}
