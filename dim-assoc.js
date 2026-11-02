// 연관 치수(ACAD200 513·514·518). 치수의 정의점이 객체의 꼭짓점·중점·중심 등을 가리키면 그 객체를 고칠 때 치수가 따라간다.
//
// AutoCAD(DIMASSOC=2)는 치수에 반응자(reactor)를 붙여 두고 원본이 바뀌면 명령 끝에 몰아서 다시 계산한다.
// 우리는 치수에 assoc:[{id,ref,index}] 만 저장한다(정의점 순서와 같은 배열, 연관 없는 점은 null).
//  - 엔진이 명령 끝(전체 동기화 단계)에 한 번만 다시 계산한다. 연관 치수가 없는 도면은 아무것도 훑지 않는다
//    (entity-index.js 가 연관 치수 수와 원본 id 역색인을 센다).
//  - AutoCAD 보다 낫게: 원본이 통째로 같은 만큼 움직이면 치수선 위치·문자 위치도 같이 옮겨 모양을 지킨다.
//    원본이 지워지면 assocLost:true 로 표시하고(데이터는 그대로), DIMREASSOCIATE 로 다시 잇는다.
//  - 사용자가 치수만 옮겨 정의점이 원본에서 떨어지면, 다음에 원본을 고칠 때 치수가 튀어 돌아가지 않도록 그 점의 연관을 푼다.
// ref: vertex(points[index]) · mid(index 번째 곧은 구간 가운데) · center · position(문자·블록·점의 삽입점)
//      start·end·arcMid(호) · quadrant(원·호의 index*90°) · radial(중심에서 angle 방향 원 위 점)
import * as G from './geometry.js';
import {isAssocDimension,assocSourceIds,entitiesById,entityIndex} from './entity-index.js';
import {refreshAutoBreaks} from './dimension-extra.js';

export {isAssocDimension,assocSourceIds};

const finite=p=>!!p&&Number.isFinite(p.x)&&Number.isFinite(p.y);
const xy=p=>({x:p.x,y:p.y});
const tolOf=(p,q)=>Math.max(1e-6,1e-10*Math.max(Math.abs(p.x),Math.abs(p.y),Math.abs(q.x),Math.abs(q.y)));
export const samePoint=(p,q)=>finite(p)&&finite(q)&&Math.abs(p.x-q.x)<=tolOf(p,q)&&Math.abs(p.y-q.y)<=tolOf(p,q);
const closedPath=e=>!!e.closed||e.type==='rectangle'||e.type==='hatch';
const bulgeAt=(e,i)=>Number(e.bulges?.[i]??e.points?.[i]?.bulge??0);
const isCurve=e=>(e.type==='circle'||e.type==='arc')&&finite(e.center)&&e.radius>0;

/** 정의점 중 치수 모양을 정하는 점의 수(나머지는 치수선·문자 위치). */
const DEFINING={angular:3,arcLength:3};
export const definingCount=dim=>Math.min(DEFINING[dim?.mode]??2,dim?.points?.length??0);

/** 연관 정보 a 가 가리키는 원본 e 위의 점. 가리킬 수 없으면 null. */
export function assocPoint(e,a){
 if(!e||!a)return null;
 switch(a.ref){
  case 'vertex':{const p=e.points?.[a.index];return finite(p)?xy(p):null;}
  case 'mid':{
   const ps=e.points,n=ps?.length||0,i=a.index;
   if(!(Number.isInteger(i)&&i>=0&&(i+1<n||closedPath(e)&&n>2&&i<n)))return null;
   if(bulgeAt(e,i))return null;
   const p=ps[i],q=ps[(i+1)%n];return finite(p)&&finite(q)?G.mul(G.add(p,q),.5):null;
  }
  case 'center':return finite(e.center)?xy(e.center):null;
  case 'position':return finite(e.position)?xy(e.position):null;
  case 'start':case 'end':return e.type==='arc'&&isCurve(e)?G.add(e.center,G.polar(e.radius,a.ref==='start'?e.startAngle:e.endAngle)):null;
  case 'arcMid':{if(e.type!=='arc'||!isCurve(e))return null;const sweep=((e.endAngle-e.startAngle)%360+360)%360;return G.add(e.center,G.polar(e.radius,e.startAngle+sweep/2));}
  case 'quadrant':return isCurve(e)&&Number.isInteger(a.index)?G.add(e.center,G.polar(e.radius,a.index*90)):null;
  case 'radial':return isCurve(e)&&Number.isFinite(a.angle)?G.add(e.center,G.polar(e.radius,a.angle)):null;
  default:return null;
 }
}

/** 점 p 가 객체 e 의 어느 특징점인가(객체 스냅이 잡는 점과 같은 계산). 아니면 null. */
export function assocRefAt(e,p){
 if(!e||e.id==null||!finite(p)||e.type==='dimension')return null;
 const ref=(r,extra={})=>({id:e.id,ref:r,...extra});
 const ps=Array.isArray(e.points)?e.points:null;
 if(ps&&e.type!=='text'){
  for(let i=0;i<ps.length;i++)if(samePoint(ps[i],p))return ref('vertex',{index:i});
  const count=closedPath(e)&&ps.length>2?ps.length:ps.length-1;
  for(let i=0;i<count;i++){const m=assocPoint(e,{ref:'mid',index:i});if(m&&samePoint(m,p))return ref('mid',{index:i});}
 }
 if(finite(e.center)&&samePoint(e.center,p))return ref('center');
 if(finite(e.position)&&samePoint(e.position,p))return ref('position');
 if(e.type==='arc')for(const r of ['start','end','arcMid']){const q=assocPoint(e,{ref:r});if(q&&samePoint(q,p))return ref(r);}
 if(isCurve(e))for(let k=0;k<4;k++){const q=assocPoint(e,{ref:'quadrant',index:k});if(q&&samePoint(q,p))return ref('quadrant',{index:k});}
 return null;
}

/** 객체 스냅이 잡은 점에 그 객체 id 를 숨은 속성(열거 안 됨 · 저장 파일·복사에 안 들어감)으로 붙인다. app.js snap() 이 O(1) 로 부른다. */
export function snapSource(point,source){const id=source&&typeof source==='object'?source.id:source;if(id!=null)Object.defineProperty(point,'snapEntityId',{value:id,enumerable:false,configurable:true,writable:true});return point;}
/** 객체 스냅으로 집은 점들(app.js snap 이 snapEntityId 를 숨은 속성으로 붙인다) → 정의점별 연관. 하나도 없으면 null. */
export function assocFromPicks(picks,lookup){
 const assoc=(picks||[]).map(p=>{const id=p?.snapEntityId;if(id==null)return null;const e=lookup(id);return e?assocRefAt(e,p):null;});
 return assoc.some(Boolean)?assoc:null;
}
/** id → 객체. 확정된 도면 배열이면 색인(O(1)), 아니면 한 번 훑는다. */
export const lookupIn=entities=>id=>entityIndex(entities)?.map.get(id)??entitiesById(entities,[id])[0];
/** 새 치수에 연관을 붙인다. picks[k] 는 정의점 k 를 집을 때의 스냅 점. */
export function withDimAssoc(dim,picks,entities){
 const assoc=assocFromPicks(picks,lookupIn(entities));
 return assoc?{...dim,assoc}:dim;
}
/** DIMSMART 처럼 객체를 직접 골라 잰 치수: 선·폴리선 구간 양 끝 / 원·호 중심과 원 위 점. */
export function assocFromSpec(spec,dim,entities){
 if(spec?.entityId==null||!dim?.points)return null;
 const e=lookupIn(entities)(spec.entityId);if(!e)return null;
 if(spec.kind==='linear'&&Number.isInteger(spec.segment)&&spec.segment>=0){
  const assoc=[assocRefAt(e,dim.points[0]),assocRefAt(e,dim.points[1])];
  return assoc.some(Boolean)?assoc:null;
 }
 if((spec.kind==='radius'||spec.kind==='diameter')&&isCurve(e)&&samePoint(e.center,dim.points[0]))
  return [{id:e.id,ref:'center'},{id:e.id,ref:'radial',angle:G.angle(G.sub(dim.points[1],e.center))}];
 return null;
}
/** DIMRADIUS·DIMDIAMETER: [중심, 원 위 점, 치수선 점]. */
export function radialAssoc(circle,dim){
 if(circle?.id==null||!isCurve(circle)||!samePoint(circle.center,dim?.points?.[0]))return null;
 return [{id:circle.id,ref:'center'},{id:circle.id,ref:'radial',angle:G.angle(G.sub(dim.points[1],circle.center))}];
}

const shift=(p,d)=>finite(p)?{...p,x:p.x+d.x,y:p.y+d.y}:p;
const pointsEqual=(a,b)=>a===b||Array.isArray(a)&&Array.isArray(b)&&a.length===b.length&&a.every((p,i)=>samePoint(p,b[i]));
const GEOMETRY_KEYS=['points','center','radius','startAngle','endAngle','position','rotation','scale','scaleX','scaleY','closed','bulges','majorAxis','ratio','height','text','hidden','entities','sharedBlock'];
const sameGeometry=(a,b)=>a===b||!!a&&!!b&&GEOMETRY_KEYS.every(k=>a[k]===b[k]||JSON.stringify(a[k])===JSON.stringify(b[k]));

/**
 * 치수 하나를 원본에 맞춰 다시 계산한다. 바뀐 것이 없으면 null.
 * dim: 지금(명령 뒤) 치수 · prev: 명령 전 치수(새 치수면 undefined) · nowOf/beforeOf: id → 명령 뒤/앞 객체.
 */
export function refreshAssocDimension(dim,prev,nowOf,beforeOf,{primitivesOf}={}){
 if(dim?.type!=='dimension'||!Array.isArray(dim.points))return null;
 const source=Array.isArray(dim.assoc)?dim.assoc:[],assoc=source.slice(),points=dim.points.slice();
 let changed=false,lost=false,deltas=[];
 for(let k=0;k<assoc.length;k++){
  const a=assoc[k];if(!a)continue;
  const src=nowOf(a.id),p=src&&assocPoint(src,a),cur=points[k];
  if(!prev){
   // 새로 생긴 치수(복사·붙여넣기 포함): 정의점이 원본 점 위에 있을 때만 연관을 남긴다.
   if(!p||!samePoint(p,cur)){assoc[k]=null;changed=true;}
   continue;
  }
  if(!p){assoc[k]=null;lost=true;changed=true;continue;}
  if(samePoint(p,cur))continue;
  const before=beforeOf(a.id),q=before&&assocPoint(before,a);
  if(q&&samePoint(q,p)){assoc[k]=null;changed=true;continue;}   // 원본은 그대로 · 치수 점만 옮김 → 연관 풀기
  points[k]=xy(p);deltas.push({k,d:G.sub(p,cur)});changed=true;
 }
 // 원본이 움직여 두 측정점이 겹치면(길이 0 치수) 그 치수는 그리지 못한다: 명령 전체를 실패시키지 않고 모양은 두고 연관만 끊는다.
 if(deltas.length&&!['ordinateX','ordinateY'].includes(dim.mode)&&points.length>1&&G.dist(points[0],points[1])<G.EPS)return {...dim,assoc:null,assocLost:true};
 // 정의점이 모두 같은 벡터로 움직였으면(원본이 통째로 이동) 치수선·문자 위치도 같이 옮긴다.
 const extra={},defining=definingCount(dim),dimMoved=prev&&!pointsEqual(prev.points,dim.points);
 if(deltas.length&&!dimMoved&&deltas.length===defining&&deltas.every(x=>x.k<defining)&&deltas.every(x=>samePoint(x.d,deltas[0].d))){
  const d=deltas[0].d;
  for(let k=defining;k<points.length;k++)points[k]=shift(points[k],d);
  for(const key of ['textPosition','quadrantPoint','leaderPoint'])if(finite(dim[key]))extra[key]=shift(dim[key],d);
 }
 const next=changed?{...dim,points,...extra,assoc:assoc.some(Boolean)?assoc:null,...(lost?{assocLost:true}:{})}:null;
 // 자동 끊기: 치수가 바뀌었거나 끊는 객체가 바뀌었을 때만 다시 계산한다.
 if(dim.breakMode==='auto'&&prev){
  const base=next||dim;
  const stale=!!next||dimMoved||(dim.breakBy||[]).some(id=>!sameGeometry(nowOf(id),beforeOf(id)));
  if(stale){const r=refreshAutoBreaks(base,nowOf,primitivesOf?{primitivesOf}:{});if(r)return {...base,...r};}
 }
 return next;
}

/**
 * 전체 동기화 경로(엔진 execute): entities 는 명령이 만든 분리된 작업 배열(제자리에서 고쳐도 된다).
 * beforeOf: id → 명령 전 객체. 연관 치수와 그 원본만 본다. 돌려주는 lost 는 이번에 새로 끊긴 치수 수.
 */
export function syncAssociativeDimensions(entities,beforeOf,{primitivesOf}={}){
 const dims=[],need=new Set();
 for(let i=0;i<entities.length;i++){const e=entities[i];if(e&&isAssocDimension(e)){dims.push(i);for(const id of assocSourceIds(e))need.add(id);}}
 if(!dims.length)return {checked:0,updated:0,lost:0};
 const now=new Map();for(const e of entities)if(e&&need.has(e.id))now.set(e.id,e);
 let updated=0,lost=0;
 for(const i of dims){
  const d=entities[i],prev=beforeOf(d.id),next=refreshAssocDimension(d,prev,id=>now.get(id),beforeOf,{primitivesOf});
  if(!next)continue;entities[i]=next;updated++;if(next.assocLost&&!prev?.assocLost)lost++;
 }
 return {checked:dims.length,updated,lost};
}

/**
 * 가벼운 경로(바뀐 객체만 갈아 끼우는 편집): changed 는 이번 명령이 새로 만든 객체들이다(이력과 공유하지 않음).
 * 원본을 고치는 명령은 엔진이 전체 동기화로 보내므로, 여기서는 치수 자신이 바뀐 경우(이동·복사·끊기 등)만 다룬다.
 */
export function syncChangedAssocDimensions(changed,beforeOf,{primitivesOf}={}){
 const byId=new Map(changed.map(e=>[e.id,e])),lookup=id=>byId.get(id)??beforeOf(id);
 let updated=0;
 for(const e of changed){
  if(!isAssocDimension(e))continue;
  const prev=beforeOf(e.id);if(prev===e)continue;
  const next=refreshAssocDimension(e,prev,lookup,beforeOf,{primitivesOf});
  if(next){Object.assign(e,next);updated++;}
 }
 return updated;
}

/* ── 514 끊긴 치수: 개수·레이어별 개수·다시 연관 ── */
/** 끊긴 치수 목록과 레이어별 개수. 명령을 실행할 때만 부른다(매 화면 그리기에서 부르지 않는다). */
export function lostAssocSummary(entities,layers=[]){
 const index=entityIndex(entities);
 if(index&&!index.assoc?.lost)return {count:0,ids:[],byLayer:[]};
 const names=new Map((layers||[]).map(l=>[l.id,l.name||l.id])),counts=new Map(),ids=[];
 for(const e of entities||[])if(e?.type==='dimension'&&e.assocLost){ids.push(e.id);const name=names.get(e.layer)||e.layer||'0';counts.set(name,(counts.get(name)||0)+1);}
 return {count:ids.length,ids,byLayer:[...counts].sort((a,b)=>b[1]-a[1])};
}
export const lostAssocMessage=summary=>summary.count?`끊긴 치수 ${summary.count}개 (${summary.byLayer.slice(0,4).map(([n,c])=>`${n} ${c}`).join(', ')}${summary.byLayer.length>4?' …':''})`:'끊긴 치수가 없습니다.';

/** 정의점 index 를 객체 e 의 점 p 에 다시 잇는다. p 가 특징점이 아니면 null. */
export function reassociatePoint(dim,index,e,p){
 const ref=assocRefAt(e,p);if(!ref)return null;
 const assoc=Array.from({length:definingCount(dim)},(_,k)=>dim.assoc?.[k]||null);assoc[index]=ref;
 const points=dim.points.slice();points[index]=xy(assocPoint(e,ref));
 return {assoc,points};
}
/** 치수 정의점 표시(X). 미리보기 전용 — 출력·저장에는 들어가지 않는다. */
function markerAt(p,size,active){
 const s=size*(active?1:.6);
 return [{type:'line',points:[{x:p.x-s,y:p.y-s},{x:p.x+s,y:p.y+s}],color:active?'#d9534f':'#9dcbe0'},{type:'line',points:[{x:p.x-s,y:p.y+s},{x:p.x+s,y:p.y-s}],color:active?'#d9534f':'#9dcbe0'}];
}

export function installDimAssoc(ctx){
 const entities=()=>ctx.entities?.()||[];
 const lookup=id=>lookupIn(entities())(id);
 const pickedDims=()=>(ctx.selected?.()||[]).filter(e=>e.type==='dimension');
 return {
  /* DIMREASSOCIATE(DRE): 정의점마다 X 를 보여 주고, 객체 스냅으로 새 원본 점을 집는다. Enter 는 그 점을 건너뛴다. */
  async DIMREASSOCIATE(){
   let dims=pickedDims();
   if(!dims.length){
    const summary=lostAssocSummary(entities(),ctx.layers?.());
    if(summary.count)ctx.toast?.(lostAssocMessage(summary)+' · Enter 를 누르면 모두 고릅니다.');
    const picked=await ctx.pickEntity({prompt:'DIMREASSOCIATE · 다시 연관할 치수 선택'+(summary.count?` · Enter = 끊긴 치수 ${summary.count}개 모두`:''),types:['dimension'],...(summary.count?{allowNone:'lost'}:{})});
    if(!picked)return null;
    if(picked.option==='lost'){const ids=new Set(summary.ids);dims=entities().filter(e=>ids.has(e.id));}
    else dims=[picked.entity||picked];
   }
   dims=dims.filter(e=>e?.type==='dimension'&&Array.isArray(e.points));
   if(!dims.length)throw Error('치수를 선택하세요.');
   const size=Math.max(1e-6,(ctx.tolerance?.()||1)*.8),updates=[];
   for(const original of dims){
    let dim=original;
    for(let k=0;k<definingCount(dim);k++){
     while(true){
      const preview=()=>[{...dim},...dim.points.slice(0,definingCount(dim)).flatMap((p,i)=>markerAt(p,size,i===k))];
      const p=await ctx.pickPoint({prompt:`DIMREASSOCIATE · ${k+1}번째 정의점(빨간 X)의 새 원본 점을 객체 스냅으로 지정 · Enter 다음 점`,options:[''],preview});
      if(!p){if(updates.length)ctx.toast?.('취소했습니다. 바꾼 것이 없습니다.');return null;}
      if(p.option!==undefined)break;
      const e=p.snapEntityId!=null?lookup(p.snapEntityId):null;
      const next=e&&reassociatePoint(dim,k,e,p);
      if(!next){ctx.toast?.('객체의 끝점·중점·중심 같은 스냅 점을 집으세요(교차점·근처점은 연관할 수 없습니다).',true);continue;}
      dim={...dim,...next};break;
     }
    }
    if(dim!==original)updates.push({id:dim.id,changes:{assoc:dim.assoc,points:dim.points,assocLost:false}});
   }
   if(!updates.length){ctx.toast?.('바꾼 연관이 없습니다.');return null;}
   ctx.execute({type:'updateMany',updates});
   ctx.toast?.(`치수 ${updates.length}개를 다시 연관했습니다. 원본을 고치면 치수가 따라갑니다.`);
   return updates;
  },
  /* DIMDISASSOCIATE(DDA): 고른 치수의 연관을 푼다(원본을 고쳐도 치수가 그대로). */
  async DIMDISASSOCIATE(){
   let dims=pickedDims();
   if(!dims.length){const picked=await ctx.pickEntity({prompt:'DIMDISASSOCIATE · 연관을 풀 치수 선택',types:['dimension']});if(!picked)return null;dims=[picked.entity||picked];}
   const targets=dims.filter(e=>e.type==='dimension'&&(e.assoc||e.assocLost));
   if(!targets.length){ctx.toast?.('연관된 치수가 없습니다.');return null;}
   ctx.execute({type:'updateMany',updates:targets.map(e=>({id:e.id,changes:{assoc:null,assocLost:false}}))});
   ctx.toast?.(`치수 ${targets.length}개의 연관을 풀었습니다.`);
   return targets.map(e=>e.id);
  },
 };
}
