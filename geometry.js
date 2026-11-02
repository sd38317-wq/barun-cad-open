// Millimetres, positive Y up. Pure functions shared by UI and command engine.
import {getDisplayInstance,getRetainedDisplayArtifact,registerDisplayArtifact,createDisplayInstance,restyleDisplayInstance,hasDisplayArtifact,indexDisplayCandidates} from './display-instance.js';
import {createPackedBoundsIndex} from './packed-bounds-index.js';
import {entityIndex} from './entity-index.js';
export {getDisplayInstance} from './display-instance.js';
export const EPS = 1e-8;
const blockHitIndexes=new WeakMap();
const blockLocalHitIndexes=new WeakMap();
const blockChildIndexes=new WeakMap();
const blockSpatialBounds=new WeakMap();
// 공간 색인과 같은 (캐시된) 경계 상자의 사본. 블록을 펼치지 않는다 — 호버·창 미리보기 강조(ACAD200 303·304)용.
export function entitySpatialBounds(e){const b=e?spatialBounds(e):null;return b?{minX:b.minX,minY:b.minY,maxX:b.maxX,maxY:b.maxY}:null;}
function spatialBounds(e){
  const instance=getDisplayInstance(e);
  if(instance){const b=spatialBounds(instance.source);return b?{minX:b.minX+instance.dx,minY:b.minY+instance.dy,maxX:b.maxX+instance.dx,maxY:b.maxY+instance.dy}:null;}
  const clip=e.clip,renderBounds=e._renderBounds;
  // Canonical child bounds are a conservative superset of every visible-layer
  // subset. Pan/zoom refreshes replace _visibleEntities without editing them.
  // Prepared shared-reference bounds already cover their immutable definitions.
  const source=e.type==='block'&&!(e.sharedBlock&&renderBounds)?(e.entities?.length?e.entities:e._visibleEntities||e.entities):null;
  const cached=source&&blockSpatialBounds.get(e);
  // Engine geometry is immutable between edits. Replacing a source array,
  // clipping data, or invalidating its existing render-bounds cache
  // invalidates this conservative companion cache as well.
  if(cached&&cached.source===source&&cached.length===source.length&&cached.entities===e.entities&&
    cached.renderBounds===renderBounds&&cached.minX===renderBounds?.minX&&cached.minY===renderBounds?.minY&&cached.maxX===renderBounds?.maxX&&cached.maxY===renderBounds?.maxY&&
    cached.clip===clip&&cached.clipPoints===clip?.points&&cached.clipLength===clip?.points?.length&&cached.enabled===clip?.enabled&&cached.inverted===clip?.inverted)
    return cached.bounds?{...cached.bounds}:null;
  // Clipped ellipse chords retain source metadata such as center. Their line
  // bounds must use chord points, not infer a circle from that metadata.
  let b=bounds([e.type==='line'&&e.points?{type:'line',points:e.points}:e]);
  if(b&&!Object.values(b).every(Number.isFinite))b=null;
  // Crossing uses finer ellipse chords than vertices(). Keep the broad phase
  // conservative for either tessellation, including rotated/partial ellipses.
  if(b&&e.type==='ellipse'){
    const a=e.majorAxis,r=e.ratio,dx=Math.hypot(a.x,a.y*r),dy=Math.hypot(a.y,a.x*r);
    b.minX=Math.min(b.minX,e.center.x-dx);b.maxX=Math.max(b.maxX,e.center.x+dx);
    b.minY=Math.min(b.minY,e.center.y-dy);b.maxY=Math.max(b.maxY,e.center.y+dy);
  }
  // 내용 있는 블록의 삽입점은 넣지 않는다: DWG 블록은 기준점이 원점처럼 멀리 있어 상자가 도면 전체로 커지고 스냅 조회가 수십 배 느려졌다(7.0.25 A/B).
  const anchors=e.type==='dimension'?e.points||[]:e.position&&(e.type!=='block'||!e.sharedBlock&&!e.entities?.length&&!e._visibleEntities?.length)?[e.position]:[];   // 내용 없는 블록 = 스냅 기준점 조각
  for(const q of anchors){
    if(!Number.isFinite(q?.x)||!Number.isFinite(q?.y))continue;
    if(!b)b={minX:q.x,minY:q.y,maxX:q.x,maxY:q.y};
    else{b.minX=Math.min(b.minX,q.x);b.minY=Math.min(b.minY,q.y);b.maxX=Math.max(b.maxX,q.x);b.maxY=Math.max(b.maxY,q.y);}
  }
  if(e.type==='block'){
    // A top-level query must be as conservative as the primitive query that
    // follows it. Cached display bounds may use coarser ellipse tessellation.
    for(const child of source||[]){
      const next=spatialBounds(child);if(!next)continue;
      if(!b)b={...next};
      else{b.minX=Math.min(b.minX,next.minX);b.minY=Math.min(b.minY,next.minY);b.maxX=Math.max(b.maxX,next.maxX);b.maxY=Math.max(b.maxY,next.maxY);}
    }
    if(b&&e.clip?.enabled&&!e.clip.inverted){
      const mask=bounds([{type:'polyline',points:e.clip.points}]);
      if(mask){b.minX=Math.max(b.minX,mask.minX);b.minY=Math.max(b.minY,mask.minY);b.maxX=Math.min(b.maxX,mask.maxX);b.maxY=Math.min(b.maxY,mask.maxY);}
    }
    if(source){const current=e._renderBounds;blockSpatialBounds.set(e,{source,length:source.length,entities:e.entities,renderBounds:current,
      minX:current?.minX,minY:current?.minY,maxX:current?.maxX,maxY:current?.maxY,
      clip,clipPoints:clip?.points,clipLength:clip?.points?.length,enabled:clip?.enabled,inverted:clip?.inverted,bounds:b?{...b}:null});}
  }
  return b;
}
function indexBounds(e){
 const b=spatialBounds(e);
 // 호·원의 '중심' 스냅 후보는 경계상자 밖에 있을 수 있다. 질의용 상자에만 중심을 포함한다.
 if(b&&e.center&&Number.isFinite(e.center.x)&&Number.isFinite(e.center.y)){
  b.minX=Math.min(b.minX,e.center.x);b.minY=Math.min(b.minY,e.center.y);
  b.maxX=Math.max(b.maxX,e.center.x);b.maxY=Math.max(b.maxY,e.center.y);
 }
 return b;
}
// Balanced bounding-box tree, rebuilt only when the drawing changes.
// The drawing-sized base lives in typed arrays (packed-bounds-index.js): per
// object one reference, instead of an entry, a bounds object and tree slices.
// On a 1.9M-object plan the object form held ~0.4 GB and millions of small
// objects in two such indexes, and every major GC walked them (0.3-0.9 s).
// Objects appended after the build keep the small object-based delta trees.
export const SPATIAL_COMPACT_MIN=20000;
export function spatialIndex(entities){
 const items=Array.from(entities||[]);
 const base=createPackedBoundsIndex(items.length,i=>indexBounds(items[i]));
 const inBase=e=>{const b=indexBounds(e);if(!b)return false;for(const i of base.query(b))if(items[i]===e)return true;return false;};
 const union=xs=>{const b={minX:Infinity,minY:Infinity,maxX:-Infinity,maxY:-Infinity};for(const x of xs){b.minX=Math.min(b.minX,x.b.minX);b.minY=Math.min(b.minY,x.b.minY);b.maxX=Math.max(b.maxX,x.b.maxX);b.maxY=Math.max(b.maxY,x.b.maxY);}return b;};
 // Median split by quickselect: each level is linear, so a 200k-object tree
 // builds in O(n log n) instead of re-sorting every level. query() returns
 // results in insertion order, so the split order never reaches callers.
 const centre=(x,axis)=>axis?x.b.minY+x.b.maxY:x.b.minX+x.b.maxX;
 function select(xs,k,axis){let lo=0,hi=xs.length-1;while(hi>lo){const pivot=centre(xs[(lo+hi)>>1],axis);let i=lo,j=hi;while(i<=j){while(centre(xs[i],axis)<pivot)i++;while(centre(xs[j],axis)>pivot)j--;if(i<=j){const t=xs[i];xs[i]=xs[j];xs[j]=t;i++;j--;}}if(k<=j)hi=j;else if(k>=i)lo=i;else return;}}
 function build(xs){if(!xs.length)return null;const b=union(xs);if(xs.length<=12)return {b,entries:xs};const axis=b.maxX-b.minX>=b.maxY-b.minY?0:1;const middle=xs.length>>1;select(xs,middle,axis);return {b,left:build(xs.slice(0,middle)),right:build(xs.slice(middle))};}
 let pending=[],deltaRoots=[],removed=new WeakSet(),delta=new WeakSet(),nextOrder=items.length;
 // 223: 차이 부분의 크기(지운 표시 수·덧붙인 항목 수). 바탕의 25%를 넘으면 쉴 때 다시 짓는다(needsCompaction).
 let removedCount=0,deltaCount=0;
 const overlap=(a,b)=>a.minX<=b.maxX&&a.maxX>=b.minX&&a.minY<=b.maxY&&a.maxY>=b.minY;
 const entry=(e,order)=>{const b=indexBounds(e);return b?{e,order,b}:null;};
 // Base positions overlapping `box`, ascending (= insertion order). The packed
 // tree takes finite, ordered boxes; infinite sides are clamped, and the rare
 // inverted box keeps the object tree's literal overlap test by a scan.
 const baseQuery=box=>{
  if(!box||[box.minX,box.minY,box.maxX,box.maxY].some(Number.isNaN))return [];
  const clamp=v=>v===Infinity?Number.MAX_VALUE:v===-Infinity?-Number.MAX_VALUE:v;
  const b={minX:clamp(box.minX),minY:clamp(box.minY),maxX:clamp(box.maxX),maxY:clamp(box.maxY)};
  if(b.minX<=b.maxX&&b.minY<=b.maxY)return base.query(b);
  const out=[];for(let i=0;i<items.length;i++){const x=indexBounds(items[i]);if(x&&overlap(x,box))out.push(i);}return out;
 };
 return {
  query(box){
   const found=[];for(const i of baseQuery(box)){const e=items[i];if(!removed.has(e))found.push(e);}
   if(!deltaRoots.length&&!pending.length)return found;
   const extra=[];function visit(node){if(!node||!overlap(node.b,box))return;if(node.entries){for(const x of node.entries)if(!removed.has(x.e)&&overlap(x.b,box))extra.push(x);}else{visit(node.left);visit(node.right);}}
   for(const deltaRoot of deltaRoots)visit(deltaRoot);for(const x of pending)if(!removed.has(x.e)&&overlap(x.b,box))extra.push(x);
   for(const x of extra.sort((a,b)=>a.order-b.order))found.push(x.e);
   return found;
  },
  // Appending a primitive must not rebuild a 100k-object tree in the next
  // pointer event.  Small deltas remain a linear tail; occasional batches are
  // folded into small independent trees. Never rebuild the complete drawing
  // on an input stack: a 100k-object rebuild can exceed 500 ms. Querying a
  // handful of delta roots is cheap and a later scene rebuild naturally
  // compacts them.
  // 되돌리기로 돌아온 객체는 예전 항목을 그대로 되살린다(객체는 이력 안에서 바뀌지 않는다). 새 항목을 또 넣으면 두 번 잡힌다.
  insert(added){for(const e of added||[]){if(removed.delete(e))removedCount--;if(delta.has(e)||inBase(e))continue;const next=entry(e,nextOrder++);if(next){pending.push(next);delta.add(e);deltaCount++;}}while(pending.length>=512){const chunk=pending.splice(0,512);deltaRoots.push(build(chunk));}return this;},
  remove(items){for(const e of items||[]){if(e&&typeof e==='object'&&!removed.has(e)){removed.add(e);removedCount++;}}return this;},
  stats(){return {base:items.length,removed:removedCount,delta:deltaCount,roots:deltaRoots.length,pending:pending.length};},
  // 큰 도면에서 차이 부분이 바탕의 25%를 넘거나 작은 트리가 64개를 넘으면 다시 지을 때다. 작은 도면은 장면을 다시 그릴 때 저절로 새로 짓는다.
  needsCompaction(){return items.length>=SPATIAL_COMPACT_MIN&&(removedCount+deltaCount>items.length*0.25||deltaRoots.length>64);},
 };
}
export function staticSpatialIndex(entities){
 // Local primitive regions are immutable; they do not need insertion/removal
 // bookkeeping or a tree of sliced object arrays. Keep original object order.
 const source=entities||[];let boxes=[],fallback,packed;
 const all=[],extent={minX:Infinity,minY:Infinity,maxX:-Infinity,maxY:-Infinity};
 const legacy=()=>fallback||(fallback=spatialIndex(source));
 for(const e of source){
  let b=spatialBounds(e);
  if(!b){boxes.push(null);continue;}
  if(e.center&&Number.isFinite(e.center.x)&&Number.isFinite(e.center.y)){
   b={minX:Math.min(b.minX,e.center.x),minY:Math.min(b.minY,e.center.y),maxX:Math.max(b.maxX,e.center.x),maxY:Math.max(b.maxY,e.center.y)};
  }
  if(![b.minX,b.minY,b.maxX,b.maxY].every(Number.isFinite)||b.minX>b.maxX||b.minY>b.maxY)return legacy();
  boxes.push(b);
  all.push(e);extent.minX=Math.min(extent.minX,b.minX);extent.minY=Math.min(extent.minY,b.minY);extent.maxX=Math.max(extent.maxX,b.maxX);extent.maxY=Math.max(extent.maxY,b.maxY);
 }
 return {query(box){
  if(!box||![box.minX,box.minY,box.maxX,box.maxY].every(Number.isFinite)||box.minX>box.maxX||box.minY>box.maxY)return legacy().query(box);
  // Overview apertures often cover a complete small block. Preserve source
  // order directly; build the tree only when a partial query can benefit.
  if(!all.length||box.minX<=extent.minX&&box.minY<=extent.minY&&box.maxX>=extent.maxX&&box.maxY>=extent.maxY)return all.slice();
  if(!packed){packed=createPackedBoundsIndex(source.length,i=>boxes[i]);boxes=null;}
  return packed.query(box).map(i=>source[i]);
 }};
}
// Use the same stretch result for preview and commit, including attached dimensions.
/* STRETCH(ACAD200-414): 예전에는 대상마다 entities.find(O(대상×도면)), 치수마다 늘린 점 전체와 거리 비교(O(치수×점))였다.
   이제 id→객체 Map 한 번, 늘린 꼭짓점은 1e-6 격자 칸 Map 으로 찾아 O(도면 + 대상 + 치수). 호는 끝점 하나만 창 안이면
   그 끝만 옮기고 현 높이(처짐)를 지켜 새 호를 만든다(AutoCAD 의 호 늘림점과 같은 결과). */
export function stretchEntities(entities, targets, delta) {
  const edits=new Map(),anchorCells=new Map(),cell=1e-6,cellKey=(x,y)=>x+','+y;
  const list=targets||[],byId=list.length?new Map():null;
  if(byId){const wanted=new Set(list.map(t=>t?.id));for(const e of entities)if(wanted.has(e.id))byId.set(e.id,e);}
  for(const target of list){
    const source=byId.get(target.id);
    if(!source)throw Error('늘릴 객체를 찾을 수 없습니다.');
    let edit=edits.get(source.id);
    if(!edit){edit={source,indices:new Set(),center:false,position:false,arcEnds:new Set()};edits.set(source.id,edit);}
    for(const i of target.indices||[]){if(!source.points?.[i])throw Error('꼭짓점 번호 오류');edit.indices.add(i);}
    for(const end of target.arcEnds||[])if(end==='start'||end==='end')edit.arcEnds.add(end);
    edit.center ||= !!target.center;edit.position ||= !!target.position;
  }
  let anchorCount=0;
  for(const edit of edits.values()){
    if(edit.source.type==='dimension')continue;
    for(const i of edit.indices){const p=edit.source.points[i],k=cellKey(Math.floor(p.x/cell),Math.floor(p.y/cell));let at=anchorCells.get(k);if(!at){at=[];anchorCells.set(k,at);}at.push(p);anchorCount++;}
  }
  const anchored=p=>{const cx=Math.floor(p.x/cell),cy=Math.floor(p.y/cell);for(let dx=-1;dx<=1;dx++)for(let dy=-1;dy<=1;dy++)for(const q of anchorCells.get(cellKey(cx+dx,cy+dy))||[])if(dist(p,q)<=1e-6)return true;return false;};
  if(anchorCount)for(const dim of entities){
    if(dim.type!=='dimension'||!dim.points)continue;
    const defining=dim.mode==='angular'?[0,1,2]:[0,1],linked=defining.filter(i=>dim.points[i]&&anchored(dim.points[i]));
    if(!linked.length)continue;
    let edit=edits.get(dim.id);
    if(!edit){edit={source:dim,indices:new Set(),center:false,position:false,arcEnds:new Set()};edits.set(dim.id,edit);}
    linked.forEach(i=>edit.indices.add(i));
    if(defining.every(i=>edit.indices.has(i)))edit.indices.add(dim.mode==='angular'?3:2);
  }
  return [...edits.values()].map(({source,indices,center,position,arcEnds})=>{
    if(source.type==='arc'&&!center&&arcEnds.size){
      if(arcEnds.size===2)return translate(source,delta.x,delta.y);
      return stretchArcEnd(source,arcEnds.has('start')?'start':'end',delta);
    }
    const e=structuredClone(source);
    for(const i of indices)e.points[i]=add(e.points[i],delta);
    if(indices.size&&e.type==='rectangle'){e.type='polyline';e.closed=true;}
    if(center&&e.center)e.center=add(e.center,delta);
    if(position&&e.position)e.position=add(e.position,delta);
    return e;
  });
}
/** 호 한쪽 끝만 옮기고 현 높이(처짐)는 그대로: 옮긴 끝·남은 끝·같은 높이의 가운데 점을 지나는 호. */
function stretchArcEnd(source,end,delta){
  const p=a=>add(source.center,polar(source.radius,a)),sweep=normalizeAngle(source.endAngle-source.startAngle)||360;
  const a=p(source.startAngle),b=p(source.endAngle),m=p(source.startAngle+sweep/2),chord=sub(b,a);
  if(len(chord)<EPS)return structuredClone(source);
  const sag=cross(unit(chord),sub(m,a));
  const a2=end==='start'?add(a,delta):a,b2=end==='end'?add(b,delta):b,c2=sub(b2,a2);
  if(len(c2)<EPS)throw Error('호의 두 끝이 겹치게 됩니다.');
  const m2=add(mul(add(a2,b2),.5),mul(normal(unit(c2)),sag));
  const arc=arcThrough(a2,m2,b2);
  return {...structuredClone(source),center:arc.center,radius:arc.radius,startAngle:arc.startAngle,endAngle:arc.endAngle};
}
export const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y }),
  sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y }),
  mul = (p, s) => ({ x: p.x * s, y: p.y * s });
export const dot = (a, b) => a.x * b.x + a.y * b.y,
  cross = (a, b) => a.x * b.y - a.y * b.x,
  len = (p) => Math.hypot(p.x, p.y),
  dist = (a, b) => len(sub(a, b)),
  unit = (p) => {
    const n = len(p);
    if (n < EPS) throw Error("서로 다른 두 점이 필요합니다.");
    return mul(p, 1 / n);
  };
export const normal = (p) => ({ x: -p.y, y: p.x }),
  angle = (p) => (Math.atan2(p.y, p.x) * 180) / Math.PI,
  polar = (r, a) => ({
    x: r * Math.cos((a * Math.PI) / 180),
    y: r * Math.sin((a * Math.PI) / 180),
  });
export const normalizeAngle = (a) => ((a % 360) + 360) % 360;
export function angleOnArc(a, start, end) {
  return normalizeAngle(a - start) <= normalizeAngle(end - start) + 1e-7;
}
export function lineIntersection(a, b, c, d) {
  const v = sub(b, a),
    w = sub(d, c),
    den = cross(v, w);
  if (Math.abs(den) < EPS) return null;
  const t = cross(sub(c, a), w) / den,
    u = cross(sub(c, a), v) / den;
  return { point: add(a, mul(v, t)), t, u };
}
export function distanceToSegment(p, a, b) {
  const v = sub(b, a),
    t = Math.max(0, Math.min(1, dot(sub(p, a), v) / (dot(v, v) || 1)));
  return dist(p, add(a, mul(v, t)));
}
/** 꺾은선 길이의 절반 지점(곡선 근사 폴리선의 중간점 스냅). */
export function halfwayPoint(points) {
  let total = 0;
  for (let i = 1; i < points.length; i++) total += dist(points[i - 1], points[i]);
  let left = total / 2;
  for (let i = 1; i < points.length; i++) {
    const d = dist(points[i - 1], points[i]);
    if (d >= left && d > 0) return add(points[i - 1], mul(sub(points[i], points[i - 1]), left / d));
    left -= d;
  }
  return points.at(-1);
}
export function rectangle(a, b) {
  return [a, { x: b.x, y: a.y }, b, { x: a.x, y: b.y }];
}
export function polygonArea(points) {
  return (
    Math.abs(
      points.reduce(
        (s, p, i) => s + cross(p, points[(i + 1) % points.length]),
        0,
      ),
    ) / 2
  );
}
export function inside(p, ps) {
  let yes = false;
  for (let i = 0, j = ps.length - 1; i < ps.length; j = i++) {
    const a = ps[i],
      b = ps[j];
    if (
      a.y > p.y !== b.y > p.y &&
      p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x
    )
      yes = !yes;
  }
  return yes;
}
/* ── 해치 여러 영역(AutoCAD 한 HATCH 안의 여러 경계 루프) ──
   해치는 points(첫 루프) + loops(나머지 루프)를 모두 같은 짝홀(even-odd) 규칙으로 채운다(화면·GPU·출력·PDF·DXF 가 같다).
   그래서 한 해치 안에 떨어진 영역·붙은 칸(표 칸 여러 개)·구멍·섬을 함께 담을 수 있다. 어느 루프가 바깥 경계이고
   어느 루프가 구멍인지는 저장하지 않고, 다른 루프 몇 개 안에 들어 있는지(깊이)의 짝홀로 정한다(가져온 DXF 해치도 같은 규칙). */
export function hatchRings(e) {
  return [e?.points, ...(Array.isArray(e?.loops) ? e.loops : [])].filter(ring => Array.isArray(ring) && ring.length >= 3);
}
function signedRingArea(ring) {
  let s = 0;
  for (let i = 0; i < ring.length; i++) s += cross(ring[i], ring[(i + 1) % ring.length]);
  return s / 2;
}
function ringBox(ring) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of ring) { minX = Math.min(minX, p.x); minY = Math.min(minY, p.y); maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y); }
  return {minX, minY, maxX, maxY};
}
// 루프 안쪽에 확실히 있는 점 하나: 긴 변의 가운데에서 안쪽으로 아주 조금 들어간 점(붙은 칸의 공유 변 위에 놓이지 않게).
function ringSample(ring) {
  const s = signedRingArea(ring);
  if (!(Math.abs(s) > EPS)) return null;
  const edges = ring.map((a, i) => [a, ring[(i + 1) % ring.length]]).map(([a, b]) => ({a, b, l: dist(a, b)})).filter(e => e.l > EPS).sort((x, y) => y.l - x.l).slice(0, 4);
  for (const {a, b, l} of edges) {
    const d = {x: (b.x - a.x) / l, y: (b.y - a.y) / l}, n = s > 0 ? {x: -d.y, y: d.x} : {x: d.y, y: -d.x}, m = {x: (a.x + b.x) / 2, y: (a.y + b.y) / 2};
    for (const k of [1e-4, 1e-6, 1e-3, 1e-2, 0.1]) { const q = {x: m.x + n.x * l * k, y: m.y + n.y * l * k}; if (inside(q, ring)) return q; }
  }
  return null;
}
function ringDepths(rings) {
  const boxes = rings.map(ringBox), samples = rings.map(ringSample);
  return rings.map((ring, i) => {
    const q = samples[i];
    if (!q) return 0;
    let depth = 0;
    for (let j = 0; j < rings.length; j++) {
      if (j === i) continue;
      const b = boxes[j];
      if (q.x < b.minX || q.x > b.maxX || q.y < b.minY || q.y > b.maxY) continue;
      if (inside(q, rings[j])) depth++;
    }
    return depth;
  });
}
/** 짝홀 규칙으로 채워지는 영역(바깥 경계 + 그 안의 구멍)들. 칸 4개를 한 번에 찍은 해치면 영역 4개. */
export function hatchRegions(e) {
  const rings = hatchRings(e);
  if (rings.length <= 1) return rings.map(outer => ({outer, holes: []}));
  const depth = ringDepths(rings), samples = rings.map(ringSample), regions = [], outerOf = new Map();
  rings.forEach((ring, i) => { if (depth[i] % 2 === 0) { outerOf.set(i, regions.length); regions.push({outer: ring, holes: []}); } });
  rings.forEach((ring, i) => {
    if (depth[i] % 2 === 0) return;
    const q = samples[i];
    let best = -1, bestArea = Infinity;
    for (const [j] of outerOf) {
      const area = polygonArea(rings[j]);
      if (q && area < bestArea && inside(q, rings[j])) { best = j; bestArea = area; }
    }
    if (best >= 0) regions[outerOf.get(best)].holes.push(ring);
    else regions.push({outer: ring, holes: []});
  });
  return regions;
}
/** 해치가 실제로 채우는 면적(구멍 빼고, 여러 영역 합). */
export function hatchArea(e) {
  const rings = hatchRings(e);
  if (rings.length <= 1) return rings.length ? polygonArea(rings[0]) : 0;
  const depth = ringDepths(rings);
  return Math.max(0, rings.reduce((s, ring, i) => s + (depth[i] % 2 ? -1 : 1) * polygonArea(ring), 0));
}
/** 점이 해치의 채워진 부분(어느 영역이든, 구멍 밖) 안에 있는가. */
export function hatchContains(e, p) {
  let filled = false;
  for (const ring of hatchRings(e)) if (inside(p, ring)) filled = !filled;
  return filled;
}
function ringKey(ring) {
  const ps = ring.map(p => `${Math.round(p.x * 1000)},${Math.round(p.y * 1000)}`);
  if (ps.length > 1 && ps[0] === ps.at(-1)) ps.pop();
  let start = 0;
  for (let i = 1; i < ps.length; i++) if (ps[i] < ps[start]) start = i;
  const forward = ps.slice(start).concat(ps.slice(0, start)), backward = [forward[0], ...forward.slice(1).reverse()];
  const a = forward.join(';'), b = backward.join(';');
  return a < b ? a : b;
}
/** 한 HATCH 명령에서 찍은 영역을 같은 해치에 루프로 더한다(AutoCAD "개별 해치 작성" 끔과 같다).
    이미 있는 루프와 똑같은 루프는 짝홀 규칙상 서로 지워지므로 둘 다 뺀다(안쪽 칸을 먼저 찍고 바깥 테두리 영역을 찍으면 통째로 채움). */
export function mergeHatchBoundary(hatch, boundary) {
  const rings = hatchRings(hatch).map(ring => ring.map(p => ({x: p.x, y: p.y})));
  const keys = rings.map(ringKey);
  for (const ring of hatchRings(boundary)) {
    const key = ringKey(ring), at = keys.indexOf(key);
    if (at >= 0) { rings.splice(at, 1); keys.splice(at, 1); }
    else { rings.push(ring.map(p => ({x: p.x, y: p.y}))); keys.push(key); }
  }
  if (!rings.length) throw Error('해치 영역이 모두 지워졌습니다. 다른 영역을 클릭하세요.');
  return {points: rings[0], loops: rings.slice(1)};
}
const HATCH_CURVE_STEPS = 180; // 원·타원 경계는 2° 간격 꺾은선(해치 경계는 꺾은선 루프로 저장·DXF 출력된다)
/** 해치 객체 선택(S)에서 객체 하나의 닫힌 경계 루프들. 닫히지 않은 객체는 {reason}. */
export function hatchSelectionRings(e) {
  const strip = ps => ps.length > 1 && dist(ps[0], ps.at(-1)) <= EPS ? ps.slice(0, -1) : ps;
  const ok = rings => {
    rings = rings.map(r => strip(r.map(p => ({x: p.x, y: p.y})))).filter(r => r.length >= 3 && polygonArea(r) > EPS);
    return rings.length ? {rings} : {reason: '면적이 없는 경계'};
  };
  if (!e) return {reason: '없는 객체'};
  if (e.type === 'rectangle') return ok([e.points || []]);
  if (e.type === 'hatch') return ok(hatchRings(e));
  if (e.type === 'wall') return ok(wallPolygons(e));
  if (e.type === 'circle') {
    if (!(e.radius > EPS)) return {reason: '반지름 0'};
    return ok([Array.from({length: HATCH_CURVE_STEPS}, (_, i) => add(e.center, polar(e.radius, i * 360 / HATCH_CURVE_STEPS)))]);
  }
  if (e.type === 'ellipse') {
    const sweep = (e.endParam ?? Math.PI * 2) - (e.startParam || 0);
    if (Math.abs(Math.abs(sweep) - Math.PI * 2) > 1e-6 && Math.abs(sweep) > 1e-9) return {reason: '닫히지 않은 타원 호'};
    return ok([ellipsePoints({...e, startParam: 0, endParam: Math.PI * 2}, HATCH_CURVE_STEPS)]);
  }
  if (e.type === 'polyline') {
    const ps = e.points || [];
    if (e.closed || (ps.length >= 4 && dist(ps[0], ps.at(-1)) <= EPS)) return ok([ps]);
    return {reason: '열린 폴리선'};
  }
  return {reason: ({line: '선', arc: '호', text: '문자', mtext: '문자', dimension: '치수', block: '블록'})[e.type] || e.type || '알 수 없는 객체'};
}
/** 가벼운 판정(안내 문구용): 해치 경계로 쓸 수 있는 닫힌 객체인가. */
export function hatchSelectable(e) {
  if (!e) return false;
  if (['rectangle', 'hatch', 'wall'].includes(e.type)) return true;
  if (e.type === 'circle') return e.radius > EPS;
  if (e.type === 'ellipse') { const sweep = Math.abs((e.endParam ?? Math.PI * 2) - (e.startParam || 0)); return sweep < 1e-9 || Math.abs(sweep - Math.PI * 2) <= 1e-6; }
  if (e.type === 'polyline') { const ps = e.points || []; return !!e.closed || (ps.length >= 4 && dist(ps[0], ps.at(-1)) <= EPS); }
  return false;
}
/** 해치 객체 선택(S): 고른 객체들의 닫힌 경계를 해치 하나의 루프로. 안에 든 경계는 짝홀 규칙으로 섬(구멍)·섬 안 섬이 된다(AutoCAD 일반 섬 탐지). */
export function hatchSelectionBoundary(entities) {
  const accepted = [], rejected = [], rings = [], keys = new Set();
  for (const e of entities || []) {
    const r = hatchSelectionRings(e);
    if (!r.rings) { rejected.push({id: e?.id, type: e?.type, reason: r.reason}); continue; }
    accepted.push(e.id);
    // 똑같은 경계가 겹쳐 그려져 있으면 한 번만 넣는다(짝홀 규칙상 둘이 서로 지워져 비지 않게).
    for (const ring of r.rings) { const key = ringKey(ring); if (!keys.has(key)) { keys.add(key); rings.push(ring); } }
  }
  return {boundary: rings.length ? {points: rings[0], loops: rings.slice(1)} : null, accepted, rejected};
}
export function transformEntity(
  source,
  fn,
  { scale = 1, rotation = 0, mirror = false } = {},
) {
  return transformEntityNode(source,fn,{scale,rotation,mirror});
}
const simpleDisplayLineFields=new Set(['id','type','layer','aci','color','colorMode','linetype','lineweight','linetypeScale','hidden','sourceHandle','sourceFingerprint']);
function transformEntityNode(source,fn,{scale=1,rotation=0,mirror=false}={},display=false){
  // Plain imported lines need only fresh transformed points. Any additional
  // geometry or owned metadata retains the complete transform below.
  if(display&&source.type==='line'&&source.points?.length===2&&Object.keys(source).every(key=>key==='points'||simpleDisplayLineFields.has(key)&&(source[key]===null||typeof source[key]!=='object'))){
    return {...source,points:source.points.map(fn)};
  }
  // Clone each node once. Cloning the whole subtree here and then recursively
  // cloning each child multiplied the cost of every nested INSERT transform.
  const { entities: sourceChildren, ...sourceData } = source;
  let e;
  if(display){
    // The private INSERT display transform is pure and creates fresh points.
    // Avoid copying every coordinate only to replace it immediately. Metadata
    // retains deep ownership; editable/public transforms keep their old clone.
    const {points,loops,...metadata}=sourceData;
    const scalarOnly=Object.values(metadata).every(value=>value===null||typeof value!=='object');
    e=scalarOnly?metadata:structuredClone(metadata);
    if('points' in sourceData)e.points=points;
    if('loops' in sourceData)e.loops=loops;
  }else e=structuredClone(sourceData);
  if (e.points) e.points = e.points.map(fn);
  if(e.clip?.points)e.clip.points=e.clip.points.map(fn);
  // 검토 치수·활동공간도 도형과 같은 변환을 따른다.
  if(e.reviewInput){const v=e.reviewInput;
    for(const key of Object.keys(v))if(key.endsWith('Mm')&&Number.isFinite(v[key]))v[key]*=Math.abs(scale);
    for(const key of ['turnCenter','toiletAnchor'])if(v[key])v[key]=fn(v[key]);
    for(const key of ['toiletSideSpace','toiletFrontSpace'])if(v[key]?.points)v[key].points=v[key].points.map(fn);
    if(Array.isArray(v.swing))v.swing=v.swing.map(a=>transformEntityNode({...a,type:'arc'},fn,{scale,rotation,mirror}));
    if(Number.isFinite(v.toiletRotation)){if(mirror)v.toiletReflected=!v.toiletReflected;const base=source.reviewInput.toiletAnchor||{x:0,y:0};v.toiletRotation=angle(sub(fn(add(base,polar(1,v.toiletRotation))),fn(base)));}
  }
  if(e.cardOpening){
    if(mirror)e.cardOpening.face=-e.cardOpening.face;
    if(scale!==1)for(const key of ['width','offset','frameWidth','gap','leafThickness','finishThickness','steelPlate','steelDepth','protrude','doubleFrom','fixedWidth','depth','protrudeOut','fixedOpenWidth'])if(Number.isFinite(e.cardOpening.values[key]))e.cardOpening.values[key]*=Math.abs(scale);
  }
  if(e.parameters?.kind==='INSULATION'&&e.parameters.path){e.parameters.path=e.parameters.path.map(fn);if(mirror){e.parameters.side={left:'right',right:'left',center:'center'}[e.parameters.side||'center'];e.parameters.waveSign=-(e.parameters.waveSign||1);}}
  if (e.center) e.center = fn(e.center);
  if (e.majorAxis) {
    e.majorAxis = sub(fn(add(source.center, source.majorAxis)), e.center);
    if (mirror) {
      e.startParam = -(source.endParam ?? Math.PI * 2);
      e.endParam = -(source.startParam || 0);
    }
  }
  if (e.position) e.position = fn(e.position);
  if (source.type === 'image') {
    e.width = Math.abs(source.width * scale);
    e.height = Math.abs(source.height * scale);
    e.rotation = (mirror ? -(source.rotation || 0) : (source.rotation || 0)) + rotation;
    e.position = fn(source.position);
  }
  // 504 맞춤 문자: 맞춤점·두 번째 끝점도 같이 옮겨야 높이를 바꿔도 제자리에 남는다.
  if (e.alignPoint) e.alignPoint = fn(e.alignPoint);
  if (e.fitTo) e.fitTo = fn(e.fitTo);
  if (e.textPosition) e.textPosition = fn(e.textPosition);
  if (source.type==='dimension'&&source.dimensionAnchors) e.dimensionAnchors=source.dimensionAnchors.map(p=>fn(p));
  if (source.type==='dimension'&&Number.isFinite(source.dimensionBase)&&source.points?.length) {const hz=source.mode==='horizontal',base=fn(hz?{x:source.points[0].x,y:source.dimensionBase}:{x:source.dimensionBase,y:source.points[0].y});e.dimensionBase=base[hz?'y':'x'];}
  if (e.quadrantPoint) e.quadrantPoint = fn(e.quadrantPoint);
  if (e.leaderPoint) e.leaderPoint = fn(e.leaderPoint);
  if (e.type === "dimension" && e.mode === "arcLength" && mirror) [e.points[1], e.points[2]] = [e.points[2], e.points[1]];
  if(e.type==='dimension'&&Number.isFinite(source.textRotation)){
    const base=source.points[0];
    e.textRotation=angle(sub(fn(add(base,polar(1,source.textRotation))),fn(base)));
  }
  if(e.parameters?.kind&&source.position){
    const o=e.parameters,r=source.parameters.rotation||0,u=polar(1,r),v=polar(source.parameters.reflected?-1:1,r+90),base=fn(source.position),a=sub(fn(add(source.position,u)),base),b=sub(fn(add(source.position,v)),base);
    o.x=base.x;o.y=base.y;o.rotation=angle(a);o.reflected=cross(a,b)<0;if(o.kind==='EED'&&scale!==1)for(const key of ['positions','levels'])o[key]=String(o[key]).split(/[,/]/).map(v=>Number(v)*Math.abs(scale)).join(',');
    for(const k of ['width','depth','height','sill','frameWidth','run','floorHeight','targetRiser','landing','radius','gap','nosing','railWidth','leafThickness','length','pitch','top','bottom','thickness','waist','railHeight','diameter','wall','spacingX','spacingY','span','slab','rise','transition','textHeight','carWidth','carDepth','doorWidth'])if(Number.isFinite(o[k]))o[k]*=Math.abs(scale);
  }
  if (sourceChildren)
    e.entities = sourceChildren.map((child) =>
      transformEntityNode(child, fn, { scale, rotation, mirror },display),
    );
  if (e.loops) e.loops = e.loops.map((loop) => loop.map(fn));
  if (e.type === "dimension" && ["horizontal", "vertical","ordinateX","ordinateY"].includes(e.mode)) {
    const direction = polar(
      1,
      source.axisAngle ?? (["horizontal","ordinateX"].includes(source.mode) ? 0 : 90),
    );
    e.axisAngle = angle(
      sub(fn(add(source.points[0], direction)), fn(source.points[0])),
    );
  }
  // constantWidth(폴리선 실폭)는 모형 단위 길이이므로 축척 대상에 포함한다
  for (const k of ["radius", "height", "textHeight", "thickness", "spacing","openingWidth","constantWidth","arrowSize","extensionOffset","extensionOvershoot","textGap","maskPadding"])
    if (e[k] !== undefined) e[k] *= Math.abs(scale);
  if(e.attributes)for(const k of ['width','depth','height','sill'])if(typeof e.attributes[k]==='number')e.attributes[k]*=Math.abs(scale);
  if(e.model3d)for(const k of ['height','elevation','roofRise'])if(Number.isFinite(e.model3d[k]))e.model3d[k]*=Math.abs(scale);
  if(e.table){e.table.height*=Math.abs(scale);if(e.table.rowHeight)e.table.rowHeight*=Math.abs(scale);if(e.table.widths)e.table.widths=e.table.widths.map(v=>v*Math.abs(scale));}
  if(e.xref){
    const r=(source.xref.rotation||0)*Math.PI/180,s=source.xref.scale||1;
    const [a,b,c,d,x,y]=source.xref.matrix||[Math.cos(r)*s,Math.sin(r)*s,-Math.sin(r)*s,Math.cos(r)*s,source.xref.x,source.xref.y];
    const anchor=fn({x,y}),u=sub(fn({x:x+a,y:y+b}),anchor),v=sub(fn({x:x+c,y:y+d}),anchor);
    e.xref.matrix=[u.x,u.y,v.x,v.y,anchor.x,anchor.y];e.xref.x=anchor.x;e.xref.y=anchor.y;e.xref.scale*=Math.abs(scale);e.xref.rotation=(mirror?-(source.xref.rotation||0):(source.xref.rotation||0))+rotation;
  }
  // A changed dynamic block (dynamic-block.js) keeps its placement like a shared reference so it can be recomputed.
  if(e.type==='block'&&(e.category||e.sharedBlock||e.dynamic))e.rotation=(mirror?-(source.rotation||0):(source.rotation||0))+rotation;
  if(e.sharedBlock||e.type==='block'&&e.dynamic){e.scale=(Number(source.scale)||1)*Math.abs(scale);for(const k of ['scaleX','scaleY'])if(Number.isFinite(Number(source[k]))&&source[k]!==undefined)e[k]=Math.abs(Number(source[k]))*Math.abs(scale);}
  if (e.type === "text") {
    e.rotation = (mirror ? -(e.rotation || 0) : e.rotation || 0) + rotation;
    // 대칭한 맞춤 문자는 위·아래가 뒤집혀 맞춤 규칙과 어긋난다: 보이는 위치를 그대로 두고 맞춤 정보만 내려놓는다(504).
    if (mirror && e.justify) { delete e.justify; delete e.alignPoint; delete e.fitTo; }
  }
  if (e.type === "arc") {
    const a = angle(
        sub(
          fn(add(source.center, polar(source.radius, source.startAngle))),
          e.center,
        ),
      ),
      b = angle(
        sub(
          fn(add(source.center, polar(source.radius, source.endAngle))),
          e.center,
        ),
      );
    e.startAngle = mirror ? b : a;
    e.endAngle = mirror ? a : b;
  }
  if (e.type === "hatch") {
    e.angle = (mirror ? -(e.angle || 0) : e.angle || 0) + rotation;
    // 무늬 기준점과 무늬 줄도 해치와 함께 움직인다(AutoCAD 와 같게). 줄은 기준점·방향·간격을 같은 변환에 통과시켜
    // 이동·회전·축척·대칭을 한 번에 처리한다. 대시 길이는 축척만 받는다.
    if (e.origin && Number.isFinite(e.origin.x) && Number.isFinite(e.origin.y)) e.origin = fn(source.origin);
    // 예전 형식(사선·교차선) 해치: 기준점이 없으면 원점에 붙어 있었다 — 함께 움직이도록 원점을 변환해 기준점으로 둔다. 무늬 배율도 함께.
    else if (!source.solid && !Array.isArray(source.patternLines)) e.origin = fn({x: 0, y: 0});
    if (!Array.isArray(source.patternLines) && Number.isFinite(source.hatchScale)) e.hatchScale = source.hatchScale * Math.abs(scale);
    if (Array.isArray(source.patternLines)) {
      e.patternLines = source.patternLines.map((line) => {
        const base = fn(line.base), dir = polar(1, line.angle || 0);
        return { angle: angle(sub(fn(add(line.base, dir)), base)), base, offset: sub(fn(add(line.base, line.offset)), base), dashes: (line.dashes || []).map((d) => d * Math.abs(scale)) };
      });
      if (Number.isFinite(e.patternScale)) e.patternScale *= Math.abs(scale);
    }
  }
  // Reflection reverses the CCW arc and exchanges its radial extensions.
  // Resolve line indices geometrically because zero-length extensions are omitted.
  // 연관 배열(assoc-edit.js): 원본 사본·간격 벡터·중심·경로도 같은 변환을 받아야 다음 편집이 제자리에서 다시 펼쳐진다.
  if (!display && source.assocArray) e.assocArray = transformArrayDefinition(source.assocArray, fn, { scale, rotation, mirror });
  if (!display && Array.isArray(source.spline?.fitPoints)) e.spline = { ...e.spline, fitPoints: source.spline.fitPoints.map(fn) };
  if (e.type === 'dimension' && e.mode === 'arcLength' && mirror && source.breaks?.length) {
    const oldParts = dimensionBaseParts(source), newParts = dimensionBaseParts(e);
    e.breaks = source.breaks.flatMap(cut => {
      const original = oldParts[cut.partIndex];
      if (!original?.dimensionBreakable) return [];
      if (original.type === 'arc') return [{...cut, partIndex: 0, start: 1 - cut.end, end: 1 - cut.start}];
      if (original.type !== 'line') return [];
      const [a, b] = original.points.map(fn), tolerance = Math.max(1e-6, dist(a, b) * 1e-8);
      for (let i = 0; i < newParts.length; i++) {
        const part = newParts[i]; if (part.type !== 'line' || !part.dimensionBreakable) continue;
        if (dist(a, part.points[0]) <= tolerance && dist(b, part.points[1]) <= tolerance) return [{...cut, partIndex: i}];
        if (dist(a, part.points[1]) <= tolerance && dist(b, part.points[0]) <= tolerance) return [{...cut, partIndex: i, start: 1 - cut.end, end: 1 - cut.start}];
      }
      return [];
    });
  }
  if (source.type === 'image') e.height = Math.abs(source.height * scale);
  return e;
}

let sharedExpansionRun=0;
/* 참조의 X·Y 축척(크기). scaleX/scaleY 가 있으면 그것을, 없으면 scale 하나를 두 축에 쓴다(예전 균일 참조와 같음).
   대칭은 mirror 로 따로 둔다. */
export function referenceScales(ref){
  const scale=Math.abs(Number(ref?.scale))||1;
  return [Math.abs(Number(ref?.scaleX))||scale,Math.abs(Number(ref?.scaleY))||scale];
}
// 가시성 상태(states)·속성 정의(attdef 문자)가 있는 정의 자식 — 이런 정의만 참조마다 자식을 다시 고른다.
const dynamicDefinitionChild=child=>Array.isArray(child?.states)||!!child?.attdef;
export const inVisibilityState=(child,state)=>!state||!Array.isArray(child?.states)||child.states.includes(state);
/* 속성 정의(ATTDEF)는 정의 안의 문자(attdef 표시)다. 그릴 때 참조의 attributes[태그] 값을 넣은 문자로 바꾼다(값은 저장하지 않음).
   상수(constant)는 정의의 기본값, 숨김(invisible)은 그리지 않는다. 값이 비면 문자를 만들지 않는다. */
export function attributeText(child,values){
  const d=child.attdef;if(!d)return child;if(d.invisible)return null;
  const tag=String(d.tag||'');const value=d.constant?(d.default??''):(values?.[tag]??findTagValue(values,tag)??d.default??'');
  if(String(value)==='')return null;
  const {attdef,states,...text}=child;return {...text,text:String(value),attributeTag:tag};
}
const findTagValue=(values,tag)=>{if(!values)return undefined;const upper=tag.toUpperCase();for(const [key,value] of Object.entries(values))if(key.toUpperCase()===upper)return value;return undefined;};
function referenceChildren(local,ref){
  const out=[];
  for(const child of local){if(!inVisibilityState(child,ref.visibility))continue;const shown=child.attdef?attributeText(child,ref.attributes):child;if(shown){if(shown.states){const {states,...rest}=shown;out.push(rest);}else out.push(shown);}}
  return out;
}
// 비균일 축척 아래에서 원·호·타원은 모양이 바뀐다 — 폴리선(64분할)으로 바꿔 그대로 늘린다(표시·분해용).
function nonUniformLocal(child){
  if(child.type==='circle'||child.type==='arc'){
    const start=child.type==='arc'?child.startAngle:0,sweepRaw=child.type==='arc'?((child.endAngle-child.startAngle)%360+360)%360||360:360,steps=Math.max(8,Math.ceil(64*sweepRaw/360));
    const points=Array.from({length:steps+(child.type==='arc'?1:0)},(_,i)=>add(child.center,polar(child.radius,start+sweepRaw*i/steps)));
    const {center,radius,startAngle,endAngle,...rest}=child;return {...rest,type:'polyline',points,closed:child.type==='circle'};
  }
  if(child.type==='ellipse'){const {center,majorAxis,ratio,startParam,endParam,...rest}=child,full=(endParam??Math.PI*2)-(startParam||0)>=Math.PI*2-1e-9;const points=ellipsePoints(child,64);if(full)points.pop();return {...rest,type:'polyline',points,closed:full};}
  if(child.type==='block'&&child.entities&&!child.sharedBlock)return {...child,entities:child.entities.map(nonUniformLocal)};
  return child;
}
function sharedDrawingExpander(definitions,display=false) {
  let serial=0;
  const idPrefix=`fast-${Date.now().toString(36)}-${(++sharedExpansionRun).toString(36)}`;
  const prepared=new Map(),dynamicKeys=new Set();
  const assignIds=entity=>{
    entity.id=`${idPrefix}-${(++serial).toString(36)}`;
    for(const child of entity.entities||[])assignIds(child);
    return entity;
  };
  const expand=(source,stack=[])=>{
    const entity={...source};
    const attached=(source.entities||[]).map(child=>expand(child,stack)).filter(nonempty);
    if(!source.sharedBlock){if(source.entities)entity.entities=attached;return entity;}
    const key=source.sharedBlock,definition=definitions[key];
    if(!definition||stack.includes(key))throw Error('블록 정의를 빠르게 여는 중 순환 또는 누락을 발견했습니다.');
    // Nested definition preparation is shared; each INSERT still receives its
    // own editable geometry and identifiers. Nothing aliases source definitions.
    if(!prepared.has(key)){const local=definition.entities.map(child=>expand(child,[...stack,key])).filter(nonempty);prepared.set(key,local);if(local.some(dynamicDefinitionChild))dynamicKeys.add(key);}
    const origin=definition.origin||{x:0,y:0},[scaleX,scale]=referenceScales(source),uniform=Math.abs(scaleX-scale)<=1e-12*Math.max(1,scale),
      rotation=Number(source.rotation)||0,radians=rotation*Math.PI/180,
      cosine=Math.cos(radians),sine=Math.sin(radians),insert=source.position||{x:0,y:0},mirror=source.mirror===true;
    const transform=point=>{
      const x=(point.x-origin.x)*scaleX*(mirror?-1:1),y=(point.y-origin.y)*scale;
      return {x:insert.x+x*cosine-y*sine,y:insert.y+x*sine+y*cosine};
    };
    // 가시성 상태·속성 정의(ATTDEF)가 든 정의만 참조마다 자식을 고른다(나머지는 그대로).
    let local=prepared.get(key);
    if(dynamicKeys.has(key)){const tags=new Set(attached.filter(c=>c.attributeTag!==undefined).map(c=>String(c.attributeTag).toUpperCase()));local=referenceChildren(local.filter(c=>!c.attdef||!tags.has(String(c.attdef.tag).toUpperCase())),source);}
    // 비균일 축척(AutoCAD 의 x≠y INSERT): 원·호·타원은 폴리선으로, 문자는 폭 비율로 늘린다.
    if(!uniform)local=local.map(child=>nonUniformLocal(child));
    // A mirrored child turns the other way: transformEntityNode reflects text/arc angles, and
    // reflecting local X then rotating by r equals its reflection formula at r+180.
    const placed=local.map(child=>assignIds(transformEntityNode(child,transform,mirror?{scale,rotation:rotation+180,mirror}:{scale,rotation},display)));
    if(!uniform){const widen=node=>{if(node.type==='text')node.widthFactor=(Number(node.widthFactor)||1)*scaleX/scale;for(const child of node.entities||[])widen(child);};placed.forEach(widen);}
    // Text in a mirrored INSERT stays readable over the same extent, as the
    // expanded import did (exchange.py -Z text): turn it 180° and swap left/right.
    if(mirror){const readable=node=>{if(node.type==='text'){node.rotation=((node.rotation||0)+180)%360;node.align={left:'right',right:'left'}[node.align]||node.align;}for(const child of node.entities||[])readable(child);};placed.forEach(readable);}
    // 가져온 ATTRIB 문자(attributeTag)는 참조의 attributes 값을 따른다 — 값과 화면 문자가 따로 놀지 않게.
    if(source.attributes)for(let i=0;i<attached.length;i++){const tag=attached[i].attributeTag;if(tag!==undefined&&attached[i].type==='text'){const value=source.attributes[tag];if(value!==undefined&&String(value)!==attached[i].text)attached[i]={...attached[i],text:String(value)};}}
    entity.entities=placed.concat(attached);
    delete entity.mirror;
    // Full expansion removes the reference marker because finishSharedDrawingExpansion
    // also removes the shared definition table. Keeping the marker would leave a
    // dangling v3 reference inside an editable v2-style block.
    delete entity.sharedBlock;
    return entity;
  };
  return expand;
}
const nonempty=entity=>entity.type!=='block'||entity.entities?.length;

// v3 drawings keep imported INSERT entities as references to immutable shared
// definitions.  Only references that actually need detail are expanded into a
// bounded display cache; the canonical document stays compact.
// Keep INSERT/definition anchors out of render bounds (fit and zoom extents).
const sharedBoundsCaches=new WeakMap(),sharedDisplayCaches=new WeakMap(),sharedReferenceExpanders=new WeakMap(),ownedSharedDisplayTrees=new WeakSet();
const mergeBounds=(a,b)=>!a?b:!b?a:{minX:Math.min(a.minX,b.minX),minY:Math.min(a.minY,b.minY),maxX:Math.max(a.maxX,b.maxX),maxY:Math.max(a.maxY,b.maxY)};
// mirror flips local X before the rotation (an INSERT with a negative X scale).
const transformBounds=(b,origin,insert,scale,rotation,mirror=false,scaleY=scale)=>{
 if(!b)return null;const r=rotation*Math.PI/180,c=Math.cos(r),s=Math.sin(r),map=p=>{const x=(p.x-origin.x)*scale*(mirror?-1:1),y=(p.y-origin.y)*scaleY;return{x:insert.x+x*c-y*s,y:insert.y+x*s+y*c};};
 const ps=[{x:b.minX,y:b.minY},{x:b.minX,y:b.maxY},{x:b.maxX,y:b.minY},{x:b.maxX,y:b.maxY}].map(map);
 return {minX:Math.min(...ps.map(p=>p.x)),minY:Math.min(...ps.map(p=>p.y)),maxX:Math.max(...ps.map(p=>p.x)),maxY:Math.max(...ps.map(p=>p.y))};
};
function sharedDefinitionBounds(definitions,key,stack=[]){
 let cache=sharedBoundsCaches.get(definitions);if(!cache){cache=new Map();sharedBoundsCaches.set(definitions,cache);}if(cache.has(key))return cache.get(key);
 if(stack.includes(key))throw Error('공유 블록 정의가 순환합니다.');const definition=definitions[key];if(!definition)throw Error('공유 블록 정의가 누락되었습니다: '+key);
 let result=null;for(const entity of definition.entities||[])result=mergeBounds(result,sharedEntityBounds(definitions,entity,[...stack,key]));cache.set(key,result);return result;
}
function sharedEntityBounds(definitions,entity,stack=[]){
 if(entity?.sharedBlock){const definition=definitions[entity.sharedBlock];if(!definition)throw Error('공유 블록 정의가 누락되었습니다: '+entity.sharedBlock);const local=sharedDefinitionBounds(definitions,entity.sharedBlock,stack),[sx,sy]=referenceScales(entity),placed=transformBounds(local,definition.origin||{x:0,y:0},entity.position||{x:0,y:0},sx,Number(entity.rotation)||0,entity.mirror===true,sy);return (entity.entities||[]).reduce((b,child)=>mergeBounds(b,sharedEntityBounds(definitions,child,stack)),placed);}
 if(entity?.type==='block')return (entity.entities||[]).reduce((b,child)=>mergeBounds(b,sharedEntityBounds(definitions,child,stack)),null);
 return entity.type==='ellipse'?spatialBounds(entity):bounds([entity]);
}
export function prepareSharedDrawingReferences(doc){
 const definitions=doc?.sharedBlocks;if(!definitions)return doc;doc.version=3;
 for(const entity of doc.entities||[])if(entity.sharedBlock){const b=sharedEntityBounds(definitions,entity);if(b)Object.defineProperty(entity,'_renderBounds',{value:b,writable:true,configurable:true,enumerable:false});}
 return doc;
}
/* 화면 범위 캐시(_renderBounds)는 열거되지 않는 속성이라 structuredClone·펼침 복사에서 빠진다.
   공유 참조는 자기 entities 가 비어 있어 캐시 없이는 범위가 null 이 되고, 5만 개 넘는 도면에서는
   화면 색인에서 빠져 보이지도 잡히지도 않는다(세탁기를 옮기면 옆 문이 사라지던 원인).
   편집·되돌리기·탭 전환 뒤 캐시가 없는 참조만 정의 범위로 다시 채운다. 정의 범위는 정의 목록마다 캐시된다. */
// `entities` narrows the pass to new objects (a lightweight edit); others
// already carry their bounds from when they were first placed.
export function ensureSharedDrawingReferenceBounds(doc,entities=doc?.entities){
 const definitions=doc?.sharedBlocks;if(!definitions)return doc;
 for(const entity of entities||[])if(entity?.sharedBlock&&!entity._renderBounds){const b=sharedEntityBounds(definitions,entity);if(b)Object.defineProperty(entity,'_renderBounds',{value:b,writable:true,configurable:true,enumerable:false});}
 return doc;
}
export function resolveSharedDrawingReference(doc,entity){
 if(!entity?.sharedBlock)return entity;const definitions=doc?.sharedBlocks;if(!definitions)throw Error('공유 블록 정의 목록이 없습니다.');
 let cache=sharedDisplayCaches.get(doc);if(!cache){cache=new Map();sharedDisplayCaches.set(doc,cache);}const key=entity.id||entity;
 if(cache.has(key)){const hit=cache.get(key);cache.delete(key);if(!ownedSharedDisplayTrees.has(hit)){cache.set(key,hit);return hit;}}
 // Definitions are immutable across edit snapshots. Reuse their prepared local
 // geometry instead of re-expanding every nested definition for each INSERT.
 // The expander still clones/transforms each instance and assigns unique IDs.
 let expand=sharedReferenceExpanders.get(definitions);
 if(!expand){expand=sharedDrawingExpander(definitions,true);sharedReferenceExpanders.set(definitions,expand);}
 const resolved=expand(entity);delete resolved.sharedBlock;
 cache.set(key,resolved);while(cache.size>96)cache.delete(cache.keys().next().value);return resolved;
}
export function materializeSharedDrawingReference(doc,entity){
 if(!entity?.sharedBlock)return entity;const resolved=sharedDrawingExpander(doc.sharedBlocks)(entity);delete resolved.sharedBlock;return resolved;
}
export function materializeSharedDrawingReferences(doc,ids){
 const targets=new Set(ids||[]);doc.entities=doc.entities.map(entity=>targets.has(entity.id)&&entity.sharedBlock?materializeSharedDrawingReference(doc,entity):entity);return doc;
}
function finishSharedDrawingExpansion(doc,entities){
  doc.entities=entities;doc.blocks=[];const seen=new Set();
  for(const entity of entities)if(entity.type==='block'&&entity.entities?.length&&!seen.has(entity.name)){
    seen.add(entity.name);doc.blocks.push({name:entity.name,entities:entity.entities});
  }
  delete doc.sharedBlocks;return doc;
}
/** Expand compact shared DWG block definitions into the existing editable model. */
export function expandSharedDrawingBlocks(doc) {
  const definitions = doc?.sharedBlocks;
  if (!definitions) return doc;
  const expand=sharedDrawingExpander(definitions);
  return finishSharedDrawingExpansion(doc,doc.entities.map(entity=>expand(entity)).filter(nonempty));
}
/** Yield between top-level batches so a large DWG keeps progress and elapsed time repainting. */
export async function expandSharedDrawingBlocksAsync(doc,{chunkSize=250,onProgress,pause}={}){
 const definitions=doc?.sharedBlocks;if(!definitions)return doc;
 const source=doc.entities||[],expanded=[],expand=sharedDrawingExpander(definitions);
 for(let start=0;start<source.length;start+=chunkSize){
  for(let i=start;i<Math.min(source.length,start+chunkSize);i++){const entity=expand(source[i]);if(nonempty(entity))expanded.push(entity);}
  onProgress?.(Math.min(source.length,start+chunkSize),source.length);
  await (pause?pause():new Promise(resolve=>(typeof requestAnimationFrame==='function'?requestAnimationFrame(()=>resolve()):setTimeout(resolve,0))));
 }
 return finishSharedDrawingExpansion(doc,expanded);
}
export const translate = (e, dx, dy) =>
  transformEntity(e, (p) => ({ x: p.x + dx, y: p.y + dy }));
export function imageCorners(e) {
  if (e?.type !== 'image' || !e.position || !(e.width > EPS) || !(e.height > EPS)) return [];
  const a=(Number(e.rotation)||0)*Math.PI/180,c=Math.cos(a),s=Math.sin(a);
  const p=(x,y)=>({x:e.position.x+x*c-y*s,y:e.position.y+x*s+y*c});
  return [p(0,0),p(e.width,0),p(e.width,e.height),p(0,e.height)];
}
export function rotate(e, base, degrees) {
  const a = (degrees * Math.PI) / 180,
    c = Math.cos(a),
    s = Math.sin(a);
  return transformEntity(
    e,
    (p) => {
      const v = sub(p, base);
      return add(base, { x: v.x * c - v.y * s, y: v.x * s + v.y * c });
    },
    { rotation: degrees },
  );
}
export function resize(e, base, factor) {
  if (!Number.isFinite(factor) || factor <= EPS)
    throw Error("축척 비율은 0보다 커야 합니다.");
  return transformEntity(e, (p) => add(base, mul(sub(p, base), factor)), {
    scale: factor,
  });
}
function transformArrayDefinition(def, fn, options) {
  const vec = (v) => sub(fn(v), fn({ x: 0, y: 0 })), p = { ...def.params };
  if (p.u) p.u = vec(p.u);
  if (p.v) p.v = vec(p.v);
  if (p.center) p.center = fn(p.center);
  if (p.base) p.base = fn(p.base);
  if (Array.isArray(p.path)) p.path = p.path.map(fn);
  if (options.mirror && Number.isFinite(p.fill)) p.fill = -p.fill;
  return { ...def, params: p, items: (def.items || []).map((item) => transformEntity(item, fn, options)) };
}
/* options.mirrText: true(=AutoCAD MIRRTEXT 1) 글자도 거울처럼 뒤집는다(예전 동작·기본).
   false(MIRRTEXT 0) 이면 맨 위 문자는 읽히는 방향으로 다시 놓는다 — 엔진 MIRROR 의 기본값. */
export function mirror(e, a, b, options = {}) {
  const u = unit(sub(b, a));
  const out = transformEntity(
    e,
    (p) => {
      const v = sub(p, a);
      return add(a, sub(mul(u, 2 * dot(v, u)), v));
    },
    { rotation: angle(u) * 2, mirror: true },
  );
  return e.type === "text" && options.mirrText === false ? readableMirroredText(e, out, a, u) : out;
}
/* MIRRTEXT=0: 원래 글자 상자의 왼쪽 끝 L·오른쪽 끝 R 을 대칭한 L'·R' 중 읽히는 방향(-90°~90°)을 새 기준선으로.
   세로축 대칭이면 R' 에서 시작해 회전 0 — AutoCAD 실측("AB" 높이 100, 축 x=10 → 삽입점 x≈-158.7, 회전 0)과 같은 자리.
   정렬점(왼쪽·가운데·오른쪽)은 바뀐 기준선에서 같은 뜻의 점으로 다시 잡는다. */
function readableMirroredText(source, mirrored, a, u) {
  const refl = (p) => { const v = sub(p, a); return add(a, sub(mul(u, 2 * dot(v, u)), v)); };
  const lines = String(source.text ?? '').split(/\r?\n/);
  const width = Math.max(...lines.map(textLineUnits)) * (source.height || 1) * (source.widthFactor || 1);
  const r = source.rotation || 0, dir = polar(1, r), align = source.align || 'left';
  const L = align === 'right' ? sub(source.position, mul(dir, width)) : align === 'center' ? sub(source.position, mul(dir, width / 2)) : source.position;
  const R = add(L, mul(dir, width)), L2 = refl(L), R2 = refl(R);
  let rotation = normalizeAngle(angle(sub(R2, L2))), start = L2, end = R2;
  if (rotation > 90 + 1e-9 && rotation <= 270 + 1e-9) { rotation = normalizeAngle(rotation + 180); start = R2; end = L2; }
  const position = align === 'right' ? end : align === 'center' ? mul(add(start, end), 0.5) : start;
  return { ...mirrored, position, rotation: rotation > 180 ? rotation - 360 : rotation };
}
export function wallPolygons(e) {
  const [a, b] = e.points,
    u = unit(sub(b, a)),
    n = mul(normal(u), e.thickness / 2),
    length = dist(a, b),
    gaps = [...(e.openings || []),...Object.values(e.openingLinks||{})].sort((a, b) => a[0] - b[0]);
  let start = 0;
  const ranges = [];
  for (const [lo, hi] of gaps) {
    if (lo > start) ranges.push([start, lo]);
    start = Math.max(start, hi);
  }
  if (start < 1) ranges.push([start, 1]);
  return ranges.map(([s, t]) => {
    const p = add(a, mul(u, length * s)),
      q = add(a, mul(u, length * t));
    return [s===0&&e.joins?.start?e.joins.start[0]:add(p,n),t===1&&e.joins?.end?e.joins.end[0]:add(q,n),t===1&&e.joins?.end?e.joins.end[1]:sub(q,n),s===0&&e.joins?.start?e.joins.start[1]:sub(p,n)];
  });
}
function dimensionArrowParts(q,u,side,arrow,type = "tick") {
  const parts=[],n=normal(u),line=(a,b)=>parts.push({type:"line",points:[a,b]});
    if (type === "tick" || type === "architectural-tick" || type === "oblique") {
      const tick = mul(add(u, n), arrow * 0.28);
      line(sub(q, tick), add(q, tick));
      return parts;
    }
    const back = add(q, mul(u, side * arrow)), half = mul(n, arrow / 6);
    if (type === "open") { line(q, add(back, half)); line(q, sub(back, half)); }
    else if (type === "dot") {
      const r = arrow / 4, ring = Array.from({ length: 16 }, (_, i) => add(q, polar(r, i * 22.5)));
      parts.push({ type: "hatch", solid: true, points: ring });
    }
    else if (type === "closed") parts.push({ type: "polyline", closed: true, points: [q, add(back, half), sub(back, half)] });
    else parts.push({ type: "hatch", solid: true, points: [q, add(back, half), sub(back, half)] });
  return parts;
}
// Stable, unbroken primitive indices are used by DIMBREAK and DXF metadata.
export function dimensionBaseParts(e) {
  if (e.mode === 'arcLength' || e.mode === 'jogged' || e.mode === 'ordinateX' || e.mode === 'ordinateY') return extraDimensionParts(e);
  return legacyDimensionParts(e);
}
export function dimensionParts(e) {
  const parts = dimensionBaseParts(e);
  if (!e.breaks?.length) return parts;
  return parts.flatMap((part, index) => {
    if (!part.dimensionBreakable || !['line', 'arc'].includes(part.type)) return [part];
    const ranges = e.breaks.filter(b => b.partIndex === index && Number.isFinite(b.start) && Number.isFinite(b.end))
      .map(b => [Math.max(0, Math.min(b.start, b.end)), Math.min(1, Math.max(b.start, b.end))])
      .filter(b => b[1] > b[0]).sort((a, b) => a[0] - b[0]);
    if (!ranges.length) return [part];
    const merged = []; for (const r of ranges) { const last = merged.at(-1); if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]); else merged.push([...r]); }
    const visible = []; let at = 0; for (const [start, end] of merged) { if (start > at + EPS) visible.push([at, start]); at = Math.max(at, end); } if (at < 1 - EPS) visible.push([at, 1]);
    return visible.map(([start, end]) => part.type === 'line'
      ? {...part, points: [add(part.points[0], mul(sub(part.points[1], part.points[0]), start)), add(part.points[0], mul(sub(part.points[1], part.points[0]), end))]}
      : {...part, startAngle: part.startAngle + normalizeAngle(part.endAngle - part.startAngle) * start, endAngle: part.startAngle + normalizeAngle(part.endAngle - part.startAngle) * end});
  });
}
function extraDimensionParts(e) {
  const scale = e.scale || 1, th = (e.textHeight || 150) * scale, arrow = (e.arrowSize || e.textHeight || 150) * scale;
  const gap = (e.textGap ?? th / scale * .3) * scale, offset = (e.extensionOffset ?? 0) * scale, overshoot = (e.extensionOvershoot ?? th / scale * .4) * scale;
  const parts = [], line = (a, b) => { if (dist(a, b) > EPS) parts.push({type: 'line', points: [a, b], dimensionBreakable: true}); };
  const text = (value, position, rotation = 0, prefix = '') => {
    const number = formatDimNumber(value * (e.measurementScale ?? 1), e);
    const template = e.text || e.textTemplate || '<>', measured = prefix + number;
    parts.push({type: 'text', dimensionLabel: true, position: e.textPosition || position, text: template.includes('<>') ? template.replaceAll('<>', measured) : template, height: th, rotation: e.textRotation ?? rotation, align: e.textAlign || 'center'});
  };
  if (e.mode === 'arcLength') {
    const [center, a, b, label] = e.points, radius = dist(center, a), start = angle(sub(a, center)), sweep = normalizeAngle(angle(sub(b, center)) - start), dimRadius = dist(center, label);
    const end = start + sweep, mid = start + sweep / 2;
    parts.push({type: 'arc', center, radius: dimRadius, startAngle: start, endAngle: end, dimensionBreakable: true});
    for (const at of [start, end]) {
      const side = dimRadius >= radius ? 1 : -1;
      line(add(center, polar(Math.max(0, radius + side * offset), at)), add(center, polar(Math.max(0, dimRadius + side * overshoot), at)));
    }
    for (const [at, side] of [[start, 1], [end, -1]]) parts.push(...dimensionArrowParts(add(center, polar(dimRadius, at)), polar(1, at + 90), side, arrow, e.arrowType));
    if (e.arcLeader && e.leaderPoint) line(e.leaderPoint, add(center, polar(dimRadius, mid)));
    text(radius * sweep * Math.PI / 180, add(center, polar(dimRadius + gap, mid)), 0, e.arcSymbol === false ? '' : '⌒ ');
  } else if (e.mode === 'jogged') {
    const [center, chord, label, override, jog] = e.points, d = sub(chord, override), u = len(d) > EPS ? unit(d) : {x: 1, y: 0}, n = normal(u);
    const size = Math.min(Math.max(arrow, th * .5), Math.max(dist(override, chord) * .15, EPS));
    const before = sub(jog, add(mul(u, size * .5), mul(n, size * .5))), after = add(jog, add(mul(u, size * .5), mul(n, size * .5)));
    line(override, before); line(before, after); line(after, chord); line(chord, label);
    parts.push(...dimensionArrowParts(chord, len(sub(label, chord)) > EPS ? unit(sub(label, chord)) : mul(u, -1), 1, arrow, e.arrowType));
    text(dist(center, chord), add(label, mul(n, gap)), 0, 'R ');
  } else {
    const [origin, feature, label] = e.points, u = polar(1, e.axisAngle ?? (e.mode === 'ordinateX' ? 0 : 90)), n = normal(u), delta = sub(label, feature);
    const sign = dot(delta, n) < 0 ? -1 : 1, landing = Math.min(Math.abs(dot(delta, n)), Math.max(arrow * 2, th));
    const knee = sub(label, mul(n, landing * sign));
    const start = add(feature, mul(len(delta) > EPS ? unit(delta) : n, Math.min(offset, len(delta))));
    line(start, knee); line(knee, label);
    text(dot(sub(feature, origin), u), add(label, mul(n, gap * sign)), 0);
  }
  if (e.textColor || e.lineColor) for (const part of parts) { const color = part.dimensionLabel ? e.textColor : e.lineColor; if (color) part.color = color; }
  return parts;
}
/* 치수 값 문자(ACAD200 515). 스타일 새 값(반올림 DIMRND · 0 생략 DIMZIN · 소수점 DIMDSEP)이 객체에 있을 때만 그 규칙을 쓴다.
   없으면 예전과 똑같이(소수 자릿수에서 끝 0 생략) — 기존 치수는 글자 하나 바뀌지 않는다. */
export function formatDimNumber(value,e={}){
 const precision=e.precision??2;
 if(e.round===undefined&&e.zeroSuppress===undefined&&e.decimalSeparator===undefined)return Number(value.toFixed(precision)).toString();
 let v=value;if(e.round>0)v=Math.round(v/e.round)*e.round;
 let text=v.toFixed(precision);if(Number(text)===0)text=text.replace('-','');
 const zin=e.zeroSuppress??8;
 if(zin&8&&text.includes('.'))text=text.replace(/\.?0+$/,'');
 if(zin&4)text=text.replace(/^(-?)0\./,'$1.');
 if(e.decimalSeparator&&e.decimalSeparator!=='.')text=text.replace('.',e.decimalSeparator);
 return text;
}
/* 선형 치수 문자를 치수선에서 띄우는 거리(DIMTAD). 값이 없거나 1(위)이면 예전 그대로. 0 = 치수선 가운데, 4 = 아래. */
function dimTextLift(e,gap,height){
 if(e.textVertical===undefined||e.textVertical===1||e.textVertical===2||e.textVertical===3)return gap;
 return e.textVertical===0?-height/2:-(gap+height);
}
function legacyDimensionParts(e) {
  if(['ordinateX','ordinateY'].includes(e.mode)){const [origin,feature,label]=e.points,th=e.textHeight||150,u=polar(1,e.axisAngle??(e.mode==='ordinateX'?0:90)),value=dot(sub(feature,origin),u)*(e.measurementScale??1),text=formatDimNumber(value,e),template=e.text||e.textTemplate||'<>';return [{type:'line',points:[feature,label]},{type:'text',dimensionLabel:true,position:e.textPosition||add(label,{x:th*.3,y:th*.3}),text:template.includes('<>')?template.replaceAll('<>',text):template,height:th,rotation:0}];}
  if(e.mode==='angular'){
    const [center,a,b,label]=e.points,styleScale=e.scale||1,th=(e.textHeight||150)*styleScale,radius=dist(center,label);
    let start=angle(sub(a,center)),end=angle(sub(b,center));
    if(!angleOnArc(angle(sub(e.quadrantPoint||label,center)),start,end))[start,end]=[end,start];
    const value=normalizeAngle(end-start),text=formatDimNumber(value,e)+'°',template=e.text||e.textTemplate||'<>',mid=start+value/2;
    const overshoot=e.extensionOvershoot!=null?e.extensionOvershoot*styleScale:th*.4,gap=e.textGap!=null?e.textGap*styleScale:th*.3;
    const parts=[{type:'arc',center,radius,startAngle:start,endAngle:end,dimensionBreakable:true},{type:'line',points:[center,add(center,polar(radius+overshoot,start))],dimensionBreakable:true},{type:'line',points:[center,add(center,polar(radius+overshoot,end))],dimensionBreakable:true}];
    for(const [at,side] of [[start,1],[end,-1]])parts.push(...dimensionArrowParts(add(center,polar(radius,at)),polar(1,at+90),side,e.arrowSize?e.arrowSize*styleScale:th,e.arrowType));
    parts.push({type:'text',dimensionLabel:true,position:e.textPosition||add(center,polar(radius+gap,mid)),text:template.includes('<>')?template.replaceAll('<>',text):template,height:th,rotation:e.textRotation??0,align:'center'});
    if(e.textColor||e.lineColor)for(const part of parts){const color=part.dimensionLabel?e.textColor:e.lineColor;if(color)part.color=color;}
    return parts;
  }
  const [a, b, p] = e.points,
    styleScale=e.scale||1,
    th = (e.textHeight || 150)*styleScale,
    // 값이 없으면 문자 높이(이미 styleScale 을 곱한 th)에서 정한다 — 다시 곱하면 축척 100 에서 눈금이 100배로 커졌다.
    arrow=e.arrowSize?e.arrowSize*styleScale:th,
    extensionOffset=(e.extensionOffset??0)*styleScale,
    extensionOvershoot=e.extensionOvershoot!=null?e.extensionOvershoot*styleScale:th*.4,
    textGap=e.textGap!=null?e.textGap*styleScale:th*.3;
  let u, n, aa, bb, value;
  // 미리보기 중에는 두 점이 겹치거나(첫 점 위에 커서) 문자점이 치수선 위에 놓일 수 있다. 그때 unit() 이 던지지 않도록 기본 방향으로 대신한다.
  const safeUnit = (v, fallback) => (len(v) < EPS ? fallback : unit(v));
  if (e.mode === "radius" || e.mode === "diameter") {
    u = safeUnit(sub(b, a), { x: 1, y: 0 });
    aa = e.mode==='diameter'?sub(a,sub(b,a)):a;
    bb = b;
    n = normal(u);
    value = dist(a, b) * (e.mode === "diameter" ? 2 : 1);
  } else {
    u = ["horizontal", "vertical"].includes(e.mode)
      ? polar(1, e.axisAngle ?? (e.mode === "horizontal" ? 0 : 90))
      : safeUnit(sub(b, a), { x: 1, y: 0 });
    n = normal(u);
    aa = add(a, mul(n, dot(sub(p, a), n)));
    bb = add(b, mul(n, dot(sub(p, b), n)));
    if(Number.isFinite(e.obliqueAngle)&&e.obliqueAngle!==0){const direction=polar(1,e.obliqueAngle),normalDistance=dot(direction,n);if(Math.abs(normalDistance)>EPS){aa=add(a,mul(direction,dot(sub(p,a),n)/normalDistance));bb=add(b,mul(direction,dot(sub(p,b),n)/normalDistance));}}
    value = Math.abs(dot(sub(b, a), u));
  }
  const parts = [],
    line = (a, b) => parts.push({ type: "line", points: [a, b], dimensionBreakable: true });
  line(aa, bb);
  if(["radius","diameter"].includes(e.mode)&&dist(b,p)>EPS)line(b,p);
  if (!["radius", "diameter"].includes(e.mode)) {
    const extension=(source,target)=>{const v=sub(target,source);if(len(v)<EPS)return;const direction=unit(v),start=add(source,mul(direction,Math.min(extensionOffset,dist(source,target)))),end=add(target,mul(direction,extensionOvershoot));line(start,end);};
    extension(a,aa);extension(b,bb);
  }
  // 치수 끝 모양은 치수 스타일(arrowType)대로. 설정이 없는 치수(옛 도면·가져온 치수)는 건축용 사선(틱).
  // 반지름 치수는 호 쪽 끝 하나만(오토캐드), 나머지는 양 끝. 화살표 길이 = arrowSize, 폭 = 길이의 1/3.
  const type = e.arrowType || "tick", ends = e.mode === "radius" ? [[bb, -1]] : [[aa, 1], [bb, -1]];
  for (const [q, side] of ends)parts.push(...dimensionArrowParts(q,u,side,arrow,type));
  const prefix = e.mode === "radius" ? "R " : e.mode === "diameter" ? "Ø " : "";
  let rotation = angle(u);
  if (rotation > 90 || rotation < -90) rotation += 180;
  const measured=prefix+formatDimNumber(value*(e.measurementScale??1),e);
  const label=e.text||e.textTemplate||'<>';
  parts.push({
    type: "text",
    dimensionLabel: true,
    position: e.textPosition||add(["radius","diameter"].includes(e.mode)?p:mul(add(aa, bb), 0.5), mul(n, dimTextLift(e,textGap,th))),
    text: label.includes('<>')?label.replaceAll('<>',measured):label,
    height: th,
    rotation: e.textRotation??rotation,
    align: e.textAlign||"center",
  });
  if(e.textColor||e.lineColor)for(const part of parts){const color=part.dimensionLabel?e.textColor:e.lineColor;if(color)part.color=color;}
    return parts;
}
export function primitives(e) {
  if (e.type === "block")
    return e.entities
      .flatMap(primitives)
      .map((p) => ({ ...p, layer: p.layer || e.layer }));
  if (e.type === "dimension")
    return dimensionParts(e).map((p) => ({ ...p, layer: e.layer }));
  if (e.type === "wall")
    return wallPolygons(e).flatMap(points=>points.map((p,i)=>({type:'line',points:[p,points[(i+1)%4]],layer:e.layer})).filter((line,i)=>!(i===1&&e.joins?.end&&dist(points[1],e.joins.end[0])<EPS)&&!(i===3&&e.joins?.start&&dist(points[0],e.joins.start[0])<EPS)));
  return [e];
}
export function simpleClipPolygon(points){
 for(let i=0;i<points.length;i++){
  if(dist(points[i],points[(i+1)%points.length])<EPS)return false;
  for(let j=i+1;j<points.length;j++){
   if(j===i+1||i===0&&j===points.length-1)continue;
   const a=points[i],b=points[(i+1)%points.length],c=points[j],d=points[(j+1)%points.length],h=lineIntersection(a,b,c,d);
   if(h&&h.t>=0&&h.t<=1&&h.u>=0&&h.u<=1||[distanceToSegment(a,c,d),distanceToSegment(b,c,d),distanceToSegment(c,a,b),distanceToSegment(d,a,b)].some(v=>v<EPS))return false;
  }
 }return true;
}
export function clipContains(clip,p){const polygon=Array.isArray(clip)?clip:clip.points;if(segments({points:polygon,closed:true}).some(s=>distanceToSegment(p,...s)<EPS))return true;return inside(p,polygon)!==!!clip.inverted;}
// Interaction geometry only: the saved block and its curves remain intact.
export function visiblePrimitives(e) {
  if(e.type!=='block')return primitives(e);
  let parts=(e._visibleEntities||e.entities).flatMap(visiblePrimitives).map(p=>({...p,layer:p.layer||e.layer}));
  if(!e.clip?.enabled)return parts;
  const polygon=e.clip.points,edges=segments({points:polygon,closed:true});
  const contains=p=>clipContains(e.clip,p);
  const lineParts=p=>segments(p).flatMap(([a,b])=>{
    const ts=[0,1];for(const edge of edges){const h=lineIntersection(a,b,...edge);if(h&&h.t>0&&h.t<1&&h.u>=0&&h.u<=1)ts.push(h.t);}
    ts.sort((a,b)=>a-b);const out=[];
    for(let i=1;i<ts.length;i++)if(ts[i]-ts[i-1]>EPS&&contains(add(a,mul(sub(b,a),(ts[i]+ts[i-1])/2))))out.push({...p,type:'line',closed:false,points:[add(a,mul(sub(b,a),ts[i-1])),add(a,mul(sub(b,a),ts[i]))]});
    return out;
  });
  return parts.flatMap(p=>{
    p={...p,clipMasks:[...(p.clipMasks||[]),e.clip]};
    if(['circle','arc'].includes(p.type)){
      const start=p.type==='circle'?0:p.startAngle,sweep=p.type==='circle'?360:normalizeAngle(p.endAngle-start),angles=[0,sweep];
      for(const edge of edges)for(const v of intersections(p,{type:'line',points:edge})){const a=normalizeAngle(angle(sub(v,p.center))-start);if(a>EPS&&a<sweep-EPS)angles.push(a);}
      if(angles.length===2&&p.type==='circle')return contains(add(p.center,polar(p.radius,0)))?[p]:[];
      angles.sort((a,b)=>a-b);const out=[];
      for(let i=1;i<angles.length;i++)if(angles[i]-angles[i-1]>EPS&&contains(add(p.center,polar(p.radius,start+(angles[i]+angles[i-1])/2))))out.push({...p,type:'arc',startAngle:start+angles[i-1],endAngle:start+angles[i]});
      return out;
    }
    if(p.type==='ellipse')return lineParts({...p,type:'polyline',points:ellipsePoints(p,256)});
    if(['text','hatch'].includes(p.type))return [p];
    if(p.points)return lineParts(p);
    return contains(p.position)?[p]:[];
  });
}
export function visiblePoint(e,p){return (e.clipMasks||[]).every(mask=>clipContains(mask,p));}
// A retained shared display tree is shared by every later visibleEntities() pass,
// so its root, child list and child records are frozen. Only those: deep-freezing
// every point object of a 850k-primitive plan cost 4.7 s of the open (the retained
// check only needs the frozen root, and children are never edited in place).
function freezeDisplayTree(children){
 if(!Array.isArray(children))return;
 for(const child of children){
  if(!child||typeof child!=='object')continue;
  if(child._visibleEntities&&child._visibleEntities!==child.entities)Object.freeze(child._visibleEntities);
  if(Array.isArray(child.entities))Object.freeze(child.entities);
  Object.freeze(child);
 }
 Object.freeze(children);
}
function translateDisplayPart(part,dx,dy,id){
 const translated=translate(part,dx,dy);translated.id=id;
 const repair=(source,result,root=false)=>{
  if(!root)result.id=id+'/'+source.id;
  // Translation must preserve arc sweep endpoints, including a literal 360°.
  if(source.type==='arc'){result.startAngle=source.startAngle;result.endAngle=source.endAngle;}
  if(source._renderBounds)result._renderBounds={minX:source._renderBounds.minX+dx,maxX:source._renderBounds.maxX+dx,minY:source._renderBounds.minY+dy,maxY:source._renderBounds.maxY+dy};
  if(source.clipMasks)result.clipMasks=source.clipMasks.map(mask=>({...mask,points:mask.points.map(p=>({x:p.x+dx,y:p.y+dy}))}));
  for(let i=0;i<(source.entities?.length||0);i++)repair(source.entities[i],result.entities[i]);
  if(source._visibleEntities){const mapped=new Map((source.entities||[]).map((child,i)=>[child,result.entities[i]]));result._visibleEntities=source._visibleEntities.map(child=>mapped.get(child)).filter(Boolean);}
 };
 repair(part,translated,true);return translated;
}
const materializeDisplayInstance=(source,dx,dy,id)=>translateDisplayPart(source,dx,dy,id).entities;
// The layer properties visibleEntities() reads. A change of anything else (a
// description, a transparency the renderer does not draw yet) never alters what is displayed.
// ACAD200 705: a lock fades the layer's objects (LAYLOCKFADECTL), so a lock change re-displays
// only the objects reading that layer — never the whole drawing.
const LAYER_DISPLAY_KEYS=['name','color','linetype','lineweight','visible','frozen','plot','locked'];
/* LAYLOCKFADECTL: 잠긴 레이어 색을 배경 쪽으로 percent(0~90)만큼 섞는다. 화면에만(출력은 그대로). */
export const DEFAULT_LOCK_FADE=50;
let lockFadeBackground='#101820';
export function setLockFadeBackground(hex){if(/^#[0-9a-f]{6}$/i.test(hex||''))lockFadeBackground=hex.toLowerCase();return lockFadeBackground;}
export const lockFadePercent=doc=>{const v=doc?.lockFade;return v===undefined||v===null?DEFAULT_LOCK_FADE:Math.max(0,Math.min(90,Number(v)||0));};
export function fadeColor(hex,percent,bg=lockFadeBackground){
 const p=Math.max(0,Math.min(90,Number(percent)||0))/100;if(!p||!/^#[0-9a-f]{6}$/i.test(hex||'')||!/^#[0-9a-f]{6}$/i.test(bg||''))return hex;
 let out='#';for(const i of [1,3,5]){const v=parseInt(hex.slice(i,i+2),16),b=parseInt(bg.slice(i,i+2),16);out+=Math.round(v+(b-v)*p).toString(16).padStart(2,'0');}
 return out;
}
// 한 번의 visibleEntities 안에서 같은 색은 한 번만 섞는다(잠긴 레이어 객체가 수십만 개여도 색 종류만큼만 계산).
const lockFader=(doc,plot)=>{
 const percent=plot?0:lockFadePercent(doc);if(!percent)return null;
 const cache=new Map(),bg=lockFadeBackground;
 return color=>{let out=cache.get(color);if(out===undefined){out=fadeColor(color,percent,bg);cache.set(color,out);}return out;};
};
export const layerDisplayKey=layer=>layer?JSON.stringify(LAYER_DISPLAY_KEYS.map(key=>layer[key]??null)):'null';
// Layer ids whose displayed properties differ between two layer tables
// (added and removed layers included).
export function changedDisplayLayers(before=[],after=[]){
 const changed=new Set();if(before===after)return changed;
 const old=new Map(before.map(layer=>[layer.id,layer]));
 for(const layer of after){const prior=old.get(layer.id);old.delete(layer.id);if(!prior||prior!==layer&&layerDisplayKey(prior)!==layerDisplayKey(layer))changed.add(layer.id);}
 for(const id of old.keys())changed.add(id);
 return changed;
}
// Layer ids an object's display reads: its own, its children's and those of
// the shared definitions it references. Definitions and committed objects are
// immutable, so composite results are cached by identity.
const definitionLayerCache=new WeakMap(),compositeLayerCache=new WeakMap();
function definitionLayers(definitions,name,stack){
 let byName=definitionLayerCache.get(definitions);if(!byName){byName=new Map();definitionLayerCache.set(definitions,byName);}
 let set=byName.get(name);if(set)return set;
 set=new Set();const definition=definitions[name];
 if(definition&&!stack.includes(name)){const next=[...stack,name];for(const child of definition.entities||[])collectLayerRefs(definitions,child,set,next);}
 byName.set(name,set);return set;
}
function collectLayerRefs(definitions,entity,set,stack){
 if(!entity||typeof entity!=='object')return;
 set.add(entity.layer);
 if(entity.sharedBlock&&definitions)for(const id of definitionLayers(definitions,entity.sharedBlock,stack))set.add(id);
 for(const child of entity.entities||[])collectLayerRefs(definitions,child,set,stack);
}
export function entityLayerRefs(definitions,entity){
 if(!entity.sharedBlock&&!entity.entities?.length)return new Set([entity.layer]);
 let cached=compositeLayerCache.get(entity);
 if(!cached||cached.definitions!==definitions||cached.children!==entity.entities||cached.layer!==entity.layer||cached.sharedBlock!==entity.sharedBlock){
  const set=new Set();collectLayerRefs(definitions,entity,set,[]);
  cached={definitions,children:entity.entities,layer:entity.layer,sharedBlock:entity.sharedBlock,set};compositeLayerCache.set(entity,cached);
 }
 return cached.set;
}
export function entityUsesLayers(definitions,entity,ids){
 if(!ids?.size||!entity)return false;
 if(ids.has(entity.layer))return true;
 if(!entity.sharedBlock&&!entity.entities?.length)return false;
 const refs=entityLayerRefs(definitions,entity);
 if(refs.size<ids.size){for(const id of refs)if(ids.has(id))return true;}
 else for(const id of ids)if(refs.has(id))return true;
 return false;
}
// Objects of `doc` whose display reads one of the given layers (skipping `except`).
export function entitiesUsingLayers(doc,ids,except=null){
 const out=[];if(!ids?.size)return out;
 for(const entity of doc.entities)if(!except?.has(entity)&&entityUsesLayers(doc.sharedBlocks,entity,ids))out.push(entity);
 return out;
}
// The style inputs of a shared reference's displayed tree: plot mode, the
// drawing linetype scale and the layers the reference and its definition read.
function sharedStyleKey(doc,entity,layers,plot=false){
 const refs=[...entityLayerRefs(doc.sharedBlocks,entity)].map(id=>[String(id),layerDisplayKey(layers.get(id))]).sort((a,b)=>a[0]<b[0]?-1:a[0]>b[0]?1:0);
 return JSON.stringify([plot,doc.linetypeScale,refs,plot?0:lockFadePercent(doc)]);
}
// COPY/ARRAY of a small shared reference (under 128 children, not retained):
// its current display lends its tree to the copies once registered here,
// instead of every copy expanding the definition again.
export function registerSharedDisplay(doc,canonical,display){
 if(!doc?.sharedBlocks||!canonical?.sharedBlock||!display||display.id!==canonical.id||display.sharedBlock!==canonical.sharedBlock||hasDisplayArtifact(display))return false;
 return registerDisplayArtifact(display,canonical,{definitions:doc.sharedBlocks,styleKey:sharedStyleKey(doc,canonical,new Map(doc.layers.map(l=>[l.id,l])))});
}
/* 블록 자식 중 그릴 것: 일반 블록의 가시성 상태(공유 참조는 펼칠 때 이미 골랐다)와 XCLIP 범위 먼저 거르기.
   XCLIP(반전 아님)이 켜진 참조만, 자식 범위가 경계 상자 밖이면 방문하지 않는다(AutoCAD clipVolumeIntersectsExtents 와 같은 역할).
   클립 없는 블록은 원래 배열을 그대로 돌려준다 — 추가 비용 없음. */
function blockDisplayChildren(e,source){
 let list=source.entities||[];
 if(!e.sharedBlock&&e.visibility&&list.some(child=>Array.isArray(child?.states)))list=list.filter(child=>inVisibilityState(child,e.visibility));
 if(e.clip&&e.clip.enabled!==false&&!e.clip.inverted&&list.length)list=clipPrefilter(e.clip,list);
 return list;
}
const clipBoxes=new WeakMap();
export function clipPrefilter(clip,children){
 if(!clip||clip.enabled===false||clip.inverted||!Array.isArray(clip.points)||clip.points.length<3)return children;
 let box=clipBoxes.get(clip);
 if(!box){box={minX:Infinity,minY:Infinity,maxX:-Infinity,maxY:-Infinity};for(const p of clip.points){if(p.x<box.minX)box.minX=p.x;if(p.x>box.maxX)box.maxX=p.x;if(p.y<box.minY)box.minY=p.y;if(p.y>box.maxY)box.maxY=p.y;}try{clipBoxes.set(clip,box);}catch{}}
 let out=null;
 for(let i=0;i<children.length;i++){
  const child=children[i];let b=child?._renderBounds;
  if(b===undefined){b=bounds([child]);try{Object.defineProperty(child,'_renderBounds',{value:b,writable:true,configurable:true,enumerable:false});}catch{}}
  const keep=!b||!(b.maxX<box.minX||b.minX>box.maxX||b.maxY<box.minY||b.minY>box.maxY);
  if(!keep&&!out)out=children.slice(0,i);else if(keep&&out)out.push(child);
 }
 return out||children;
}
export function visibleEntities(doc,{plot=false,inPlace=false,lodScale=0,lodPixels=0,viewBox=null,entities=doc.entities,reuseDisplays=[]}={}){
 const layers=new Map(doc.layers.map(l=>[l.id,l])),fadeLocked=doc.layers.some(l=>l.locked)?lockFader(doc,plot):null;
 // A retained shared display depends only on the layers its reference and
 // definition read: adding an annotation layer or switching an unrelated layer
 // must not re-expand every shared block of the drawing (seconds on a plan).
 const instanceContexts=new Map();
 let reuseIndex=null;const reuse=()=>reuseIndex??=indexDisplayCandidates(reuseDisplays);
 const getContext=e=>{
  const key=e.entities?.length?null:e.sharedBlock+'\u0000'+e.layer;let context=key!==null&&instanceContexts.get(key);
  if(!context){context={definitions:doc.sharedBlocks,styleKey:sharedStyleKey(doc,e,layers,plot)};if(key!==null)instanceContexts.set(key,context);}
  return context;
 };
 const outsideView=e=>{
  if(!viewBox)return false;
  let b=e._renderBounds;
  if(!b){b=bounds([e]);try{Object.defineProperty(e,'_renderBounds',{value:b,writable:true,configurable:true,enumerable:false});}catch{}}
  return b&&(b.maxX<viewBox.minX||b.minX>viewBox.maxX||b.maxY<viewBox.minY||b.minY>viewBox.maxY);
 };
 // An expanded display child under a restyled reference: a copy with the
 // style visit() would give it (displayCopy rules), children likewise. Only
 // style inputs changed, so the set of visible children is the same.
 const restyleDisplayNode=(node,parentLayer,parentStyle)=>{
  const own=layers.get(node.layer),layer=own?.name==='0'&&parentLayer?parentLayer:own;
  if(node.hidden||!layer?.visible||layer.frozen||(plot&&(layer.plot===false||String(layer.name||'').toLowerCase()==='defpoints')))return null;
  const ownLinetype=typeof node.linetype==='string'?node.linetype.toUpperCase():'';
  const style={color:node.colorMode==='byblock'?(parentStyle?.color||layer.color):(node.color||layer.color),linetype:ownLinetype==='BYBLOCK'?(parentStyle?.linetype||layer.linetype):(ownLinetype&&ownLinetype!=='BYLAYER'?node.linetype:layer.linetype),lineweight:node.lineweightMode==='byblock'?(parentStyle?.lineweight??layer.lineweight):(node.lineweight??layer.lineweight),linetypeScale:(Number(node.linetypeScale)||1)*(parentStyle?.linetypeScale||(Number(doc.linetypeScale)||1))};
  if(fadeLocked&&layer.locked&&node.colorMode!=='byblock')style.color=fadeLocked(style.color);
  const copy={...node,_displayColor:style.color,_displayLinetype:style.linetype,_displayLineweight:style.lineweight,_displayLinetypeScale:style.linetypeScale};
  for(const key of ['_renderBounds','_lodCollapsed'])if(!Object.prototype.propertyIsEnumerable.call(node,key)&&node[key]!==undefined)Object.defineProperty(copy,key,{value:node[key],writable:true,configurable:true,enumerable:false});
  if(node.type==='block'){
   const shown=node._visibleEntities;
   if(shown&&shown!==node.entities){
    const mapped=new Map(),next=[];
    for(const child of shown){const restyled=restyleDisplayNode(child,layer,style);if(restyled){mapped.set(child,restyled);next.push(restyled);}}
    copy.entities=(node.entities||[]).map(child=>mapped.get(child)||child);
    Object.defineProperty(copy,'_visibleEntities',{value:next,writable:true,configurable:true,enumerable:false});
   }else{
    copy.entities=(node.entities||[]).map(child=>restyleDisplayNode(child,layer,style)).filter(Boolean);
    if(shown)Object.defineProperty(copy,'_visibleEntities',{value:copy.entities,writable:true,configurable:true,enumerable:false});
   }
  }
  return copy;
 };
 const visit=(e,parentLayer=null,parentStyle=null,displayCopy=false)=>{
  const own=layers.get(e.layer),layer=own?.name==='0'&&parentLayer?parentLayer:own;
  if(e.hidden||!layer?.visible||layer.frozen||(plot&&(layer.plot===false||String(layer.name||'').toLowerCase()==='defpoints'))||outsideView(e))return null;
   // DWG imports carry 'ByLayer'/'ByBlock' as written by the engine: compare
   // without case, or a line on a DASHED layer is drawn solid.
   const ownLinetype=typeof e.linetype==='string'?e.linetype.toUpperCase():'';
   const style={color:e.colorMode==='byblock'?(parentStyle?.color||layer.color):(e.color||layer.color),linetype:ownLinetype==='BYBLOCK'?(parentStyle?.linetype||layer.linetype):(ownLinetype&&ownLinetype!=='BYLAYER'?e.linetype:layer.linetype),lineweight:e.lineweightMode==='byblock'?(parentStyle?.lineweight??layer.lineweight):(e.lineweight??layer.lineweight),linetypeScale:(Number(e.linetypeScale)||1)*(parentStyle?.linetypeScale||(Number(doc.linetypeScale)||1))};
   if(fadeLocked&&layer.locked&&e.colorMode!=='byblock')style.color=fadeLocked(style.color);
   if(inPlace){
    // Expanded shared-reference descendants are detached display objects.
    // Avoid descriptor creation per primitive; canonical/save objects below
    // still receive nonenumerable annotations, and editable expansion is separate.
    if(displayCopy){e._displayColor=style.color;e._displayLinetype=style.linetype;e._displayLineweight=style.lineweight;e._displayLinetypeScale=style.linetypeScale;}
    else for(const [key,value] of [['_displayColor',style.color],['_displayLinetype',style.linetype],['_displayLineweight',style.lineweight],['_displayLinetypeScale',style.linetypeScale]]){
     if(Object.prototype.hasOwnProperty.call(e,key))e[key]=value;
     else Object.defineProperty(e,key,{value,writable:true,configurable:true,enumerable:false});
    }
    if(e.type==='block'){
     const blockBounds=e._renderBounds||bounds(e.entities||[]);
     if(blockBounds&&!e._renderBounds)try{Object.defineProperty(e,'_renderBounds',{value:blockBounds,writable:true,configurable:true,enumerable:false});}catch{}
     const collapsed=!!(lodScale>0&&lodPixels>0&&blockBounds&&Math.max(blockBounds.maxX-blockBounds.minX,blockBounds.maxY-blockBounds.minY)*lodScale<lodPixels);
     if(Object.prototype.hasOwnProperty.call(e,'_lodCollapsed'))e._lodCollapsed=collapsed;
     else Object.defineProperty(e,'_lodCollapsed',{value:collapsed,writable:true,configurable:true,enumerable:false});
     if(collapsed)return e;
     const retainShared=e.sharedBlock&&!displayCopy&&parentLayer===null&&parentStyle===null&&!viewBox&&lodScale===0;
     if(retainShared){const retained=getRetainedDisplayArtifact(e,getContext(e));if(retained)return retained;}
     if(retainShared&&reuseDisplays.length){
      const instance=createDisplayInstance(e,getContext(e),reuse(),{materialize:materializeDisplayInstance});
      if(instance)return instance;
      const restyled=restyleDisplayInstance(e,getContext(e),reuse(),{style,restyle:display=>(display.entities||[]).map(child=>restyleDisplayNode(child,layer,style)).filter(Boolean)});
      if(restyled)return restyled;
     }
     const source=e.sharedBlock?resolveSharedDrawingReference(doc,e):e;
     const children=blockDisplayChildren(e,source).map(child=>visit(child,layer,style,displayCopy||!!e.sharedBlock)).filter(Boolean);
     if(e.sharedBlock){
      const result={...e,position:e.position?{...e.position}:e.position,entities:children,_displayColor:style.color,_displayLinetype:style.linetype,_displayLineweight:style.lineweight,_displayLinetypeScale:style.linetypeScale,_renderBounds:blockBounds?{...blockBounds}:blockBounds};
      if(retainShared&&children.length>=128&&registerDisplayArtifact(result,e,getContext(e))){
       freezeDisplayTree(children);if(result.position)Object.freeze(result.position);if(result._renderBounds)Object.freeze(result._renderBounds);Object.freeze(result);ownedSharedDisplayTrees.add(source);
       warmBlockChildIndexes(result);
      }
      return result;
     }
     if(Object.prototype.hasOwnProperty.call(e,'_visibleEntities'))e._visibleEntities=children;
     else Object.defineProperty(e,'_visibleEntities',{value:children,writable:true,configurable:true,enumerable:false});
     return children.length?e:null;
    }
    return e;
  }
  const result={...e,...style};
  delete result._displayColor;delete result._displayLinetype;delete result._displayLineweight;delete result._displayLinetypeScale;
  if(e.type!=='block')return result;
  const source=e.sharedBlock?resolveSharedDrawingReference(doc,e):e;
  result.entities=blockDisplayChildren(e,source).map(child=>visit(child,layer,style)).filter(Boolean);return result.entities.length?result:null;
 };
 return entities.map(e=>visit(e)).filter(Boolean);
}
// 문자 폭(높이 배수) 어림: 한글·한자·전각 글자는 화면 글꼴에서 높이만큼 넓다(약 1.0). 나머지는 0.65.
// 예전처럼 모두 0.65 로 잡으면 긴 한글 문자의 뒤쪽이 클릭·창 선택 범위 밖으로 빠졌다.
const WIDE_TEXT=/[\u1100-\u11ff\u2e80-\u9fff\uac00-\ud7a3\uf900-\ufaff\ufe30-\ufe4f\uff00-\uff60\uffe0-\uffe6]/u;
export function textLineUnits(line){let units=0;for(const ch of String(line))units+=WIDE_TEXT.test(ch)?1:0.65;return units;}
// 508 문자 폭: 화면(브라우저)에서는 text-measure.js 가 실제로 그리는 글꼴로 잰 값(글꼴·글자별 캐시)을 꽂는다.
// 꽂지 않은 곳(node 시험·서버)은 위 어림값. 선택 상자·마스크·표 칸·맞춤이 모두 이 한 값을 쓴다.
let measuredLineUnits=null;
export function setTextLineMeasurer(fn){measuredLineUnits=typeof fn==='function'?fn:null;}
export function textUnits(e,line){return measuredLineUnits?measuredLineUnits(e,line):textLineUnits(line);}
/** 문자 객체의 가장 긴 줄 폭(도면 단위, 폭 비율 포함). */
export function textBoxWidth(e){let units=0.65;for(const line of String(e?.text??'').split('\n'))units=Math.max(units,textUnits(e,line));return units*(e?.height||0)*(e?.widthFactor||1);}
export function vertices(e) {
  if(e.type==='block'&&e.clip?.enabled&&!e.clip.inverted){const raw=e._renderBounds||bounds(e.entities||[]),mask=bounds([{type:'polyline',points:e.clip.points}]);if(!raw||!mask)return [];const a={x:Math.max(raw.minX,mask.minX),y:Math.max(raw.minY,mask.minY)},b={x:Math.min(raw.maxX,mask.maxX),y:Math.min(raw.maxY,mask.maxY)};return a.x<=b.x&&a.y<=b.y?rectangle(a,b):[];}

  if (e.type === "point") return [e.position];
  if (e.type === 'image') return imageCorners(e);
  if (e.type === "ellipse") return ellipsePoints(e, 128);
  if(e.type==='block'){
    let cached=e._renderBounds;
    if(!cached){cached=bounds(e.entities||[]);try{Object.defineProperty(e,'_renderBounds',{value:cached,writable:true,configurable:true,enumerable:false});}catch{}}
    return cached?rectangle({x:cached.minX,y:cached.minY},{x:cached.maxX,y:cached.maxY}):[];
  }
  if (["dimension", "wall"].includes(e.type))
    return primitives(e).flatMap(vertices);
  if (e.type === "text") {
    const width = textBoxWidth(e),
      height = e.height,
      bottom = -e.height * (e.text.split("\n").length - 1) * 1.35,
      offset = e.align === "center" ? -width / 2 : e.align === "right" ? -width : 0,
      padding=e.backgroundMask?(e.maskPadding??e.height*.25):0;
    return rectangle(
      { x: offset-padding, y: bottom-padding },
      { x: offset + width+padding, y: height+padding },
    ).map((p) => add(e.position, polar(len(p), angle(p) + (e.rotation || 0))));
  }
  if (e.center) {
    let as =
      e.type === "arc"
        ? [
            e.startAngle,
            e.endAngle,
            ...[0, 90, 180, 270].filter((a) =>
              angleOnArc(a, e.startAngle, e.endAngle),
            ),
          ]
        : [0, 90, 180, 270];
    return as.map((a) => add(e.center, polar(e.radius, a)));
  }
  // 여러 영역 해치: 첫 루프 밖에 있는 다른 영역도 범위·선택·화면 걸러내기에 들어가야 한다.
  if (e.type === "hatch" && Array.isArray(e.loops) && e.loops.length) return hatchRings(e).flat();
  return e.points || [];
}
export function bounds(entities) {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const e of entities)
    for (const p of vertices(e)) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }
  return minX === Infinity ? null : { minX, minY, maxX, maxY };
}
export function segments(e) {
  if (e?.type === 'image') { const ps=imageCorners(e); return ps.length ? ps.map((p,i)=>[p,ps[(i+1)%ps.length]]) : []; }
  const ps = e.points || [],
    ss = [];
  for (let i = 1; i < ps.length; i++) ss.push([ps[i - 1], ps[i]]);
  if (e.closed || ["rectangle", "hatch"].includes(e.type))
    ss.push([ps.at(-1), ps[0]]);
  if (e.type === "hatch" && Array.isArray(e.loops))
    for (const loop of e.loops) if (Array.isArray(loop) && loop.length >= 2)
      for (let i = 0; i < loop.length; i++) ss.push([loop[i], loop[(i + 1) % loop.length]]);
  return ss;
}
const snapGeometryIndexes=new WeakMap();
const snapSupportBounds=new WeakMap();
// Conservative support for straight point geometry. Include PER's permitted
// endpoint extension. Curves and other generated geometry use the exact path.
export function snapGeometryMayContain(e,p,radius){
 const ps=e.points;
 if(e.type==='hatch'&&e.loops?.length)return true;
 if(e.center||!ps?.length||!Number.isFinite(radius)||!Number.isFinite(p.x)||!Number.isFinite(p.y)||radius<0||!['line','polyline','rectangle','hatch'].includes(e.type))return true;
 let cached=snapSupportBounds.get(ps);
 if(!cached||cached.length!==ps.length){
  let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
  for(const q of ps){if(!q||!Number.isFinite(q.x)||!Number.isFinite(q.y))return true;minX=Math.min(minX,q.x);minY=Math.min(minY,q.y);maxX=Math.max(maxX,q.x);maxY=Math.max(maxY,q.y);}
  const dx=(maxX-minX)*1e-9,dy=(maxY-minY)*1e-9;
  if(!Number.isFinite(dx)||!Number.isFinite(dy))return true;
  cached={length:ps.length,minX:minX-dx,minY:minY-dy,maxX:maxX+dx,maxY:maxY+dy};snapSupportBounds.set(ps,cached);
 }
 return cached.minX<=p.x+radius&&cached.maxX>=p.x-radius&&cached.minY<=p.y+radius&&cached.maxY>=p.y-radius;
}
const blockSnapSupport=new WeakMap();
function blockSnapBounds(e){
 const instance=getDisplayInstance(e);
 if(instance){const b=blockSnapBounds(instance.source);return b?{minX:b.minX+instance.dx,minY:b.minY+instance.dy,maxX:b.maxX+instance.dx,maxY:b.maxY+instance.dy,hasCurve:b.hasCurve,roundoff:(b.roundoff||0)+Math.max(Math.abs(instance.dx),Math.abs(instance.dy),Math.abs(b.minX),Math.abs(b.maxX),Math.abs(b.minY),Math.abs(b.maxY))*Number.EPSILON*64}:null;}
 if(e.type!=='block'){
  if(e.type==='ellipse'&&!e.points?.length&&[e.center?.x,e.center?.y,e.majorAxis?.x,e.majorAxis?.y,e.ratio,e.startParam??0,e.endParam??Math.PI*2].every(Number.isFinite)){
   // Enclose every sampled chord without sampling. L1 axis extents bound
   // a*cos(t)+normal(a)*ratio*sin(t), including rotated/partial ellipses.
   const x=Math.abs(e.majorAxis.x)+Math.abs(e.majorAxis.y*e.ratio),y=Math.abs(e.majorAxis.y)+Math.abs(e.majorAxis.x*e.ratio);
   const dx=x*(1+2e-9),dy=y*(1+2e-9);
   const b={minX:e.center.x-dx,minY:e.center.y-dy,maxX:e.center.x+dx,maxY:e.center.y+dy,hasCurve:true,roundoff:Math.max(Math.abs(e.center.x),Math.abs(e.center.y),dx,dy)*Number.EPSILON*64};
   return [b.minX,b.minY,b.maxX,b.maxY,b.roundoff].every(Number.isFinite)?b:null;
  }
  if(['circle','arc'].includes(e.type)&&!e.points?.length&&Number.isFinite(e.center?.x)&&Number.isFinite(e.center?.y)&&Number.isFinite(e.radius)&&e.radius>=0){
   const b={minX:e.center.x-e.radius,minY:e.center.y-e.radius,maxX:e.center.x+e.radius,maxY:e.center.y+e.radius,hasCurve:true,roundoff:Math.max(Math.abs(e.center.x),Math.abs(e.center.y),e.radius)*Number.EPSILON*64};
   return [b.minX,b.minY,b.maxX,b.maxY].every(Number.isFinite)?b:null;
  }
  // Clipped lines carrying center metadata and unsupported generated geometry
  // keep the legacy path. Curve blocks use the intersection padding below.
  if(e.center)return null;
  if(e.type==='hatch'&&e.loops?.length){const ps=[...(e.points||[]),...e.loops.flat()];return ps.length&&ps.every(q=>Number.isFinite(q?.x)&&Number.isFinite(q?.y))?{minX:Math.min(...ps.map(q=>q.x)),minY:Math.min(...ps.map(q=>q.y)),maxX:Math.max(...ps.map(q=>q.x)),maxY:Math.max(...ps.map(q=>q.y))}:null;}   // 모든 고리를 덮는 상자 — null 이면 블록 가지치기가 꺼진다
  if(['text','mtext'].includes(e.type)&&!e.points)return e.position?{minX:e.position.x,minY:e.position.y,maxX:e.position.x,maxY:e.position.y}:null;
  if(!e.points?.length||!['line','polyline','rectangle','hatch'].includes(e.type))return null;
  snapGeometryMayContain(e,{x:0,y:0},0);
  const support=snapSupportBounds.get(e.points);
  return support?.length===e.points.length?support:null;
 }
 const cached=blockSnapSupport.get(e);
 if(sameBlockInteraction(cached?.state,e))return cached.bounds;
 // 블록 삽입점은 넣지 않는다(DWG 기준점이 멀어 상자가 커지면 가지치기가 안 돼 큰 선택 이동 스냅이 느려졌다, 7.0.25). 고른 블록 삽입점은 nearby() 가 따로 찾는다.
 const b={minX:Infinity,minY:Infinity,maxX:-Infinity,maxY:-Infinity};let complete=true;
 for(const child of e._visibleEntities||e.entities||[]){
  const part=blockSnapBounds(child);if(!part){complete=false;break;}
  b.minX=Math.min(b.minX,part.minX);b.minY=Math.min(b.minY,part.minY);b.maxX=Math.max(b.maxX,part.maxX);b.maxY=Math.max(b.maxY,part.maxY);
  if(part.hasCurve)b.hasCurve=true;
  if(part.roundoff)b.roundoff=Math.max(b.roundoff||0,part.roundoff);
 }
 const result=complete?b:null;blockSnapSupport.set(e,{state:blockInteractionState(e),bounds:result});return result;
}
export function snapBlockMayContain(e,p,radius){
 if(!Number.isFinite(radius)||radius<0||!Number.isFinite(p.x)||!Number.isFinite(p.y))return true;
 if(e.type!=='block')return snapGeometryMayContain(e,p,radius);
 const b=blockSnapBounds(e);
 // snapIntersections expands both its aperture and each curve box by pad.
 // Preserve that exact conservative contract, including very large coordinates.
 if(b?.hasCurve)radius+=(b.roundoff||0)+2*Math.max(EPS*4,radius*1e-10,Math.max(1,Math.abs(p.x),Math.abs(p.y),radius)*Number.EPSILON*32);
 if(!Number.isFinite(radius)||b&&[b.minX,b.minY,b.maxX,b.maxY].some(Number.isNaN))return true;
 return !b||b.minX<=p.x+radius&&b.maxX>=p.x-radius&&b.minY<=p.y+radius&&b.maxY>=p.y-radius;
}
// Engine edits replace entities/point arrays (including MOVE and UNDO). Keep
// exact source vertices here: display LOD must never change OSNAP coordinates.
function snapGeometryIndex(e){
 const ps=e.points;
 if(!ps||ps.length<256||!['polyline','line','rectangle','hatch'].includes(e.type))return null;
 const closed=!!(e.closed||['rectangle','hatch'].includes(e.type)),variants=snapGeometryIndexes.get(ps),cached=variants?.[Number(closed)];
 if(cached?.length===ps.length)return cached;
 const chunks=[],count=ps.length-1+(closed?1:0);
 for(let start=0;start<count;start+=64){
  const end=Math.min(count,start+64);let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
  for(let i=start;i<=end;i++){const p=ps[i%ps.length];minX=Math.min(minX,p.x);minY=Math.min(minY,p.y);maxX=Math.max(maxX,p.x);maxY=Math.max(maxY,p.y);}
  // PER historically permits a foot up to 1e-9 beyond either endpoint.
  // Expand only broad-phase boxes to preserve that existing predicate.
  const padX=(maxX-minX)*1e-9,padY=(maxY-minY)*1e-9;
  chunks.push({type:'line',start,end,points:[{x:minX-padX,y:minY-padY},{x:maxX+padX,y:maxY+padY}]});
 }
 const value={points:ps,length:ps.length,closed,index:spatialIndex(chunks),bounds:bounds(chunks)};
 const next=variants||[];next[Number(closed)]=value;snapGeometryIndexes.set(ps,next);return value;
}
// Restrict per-vertex/per-segment snap work to the cursor aperture. Segment
// bounding boxes are conservative: midpoints, perpendicular feet, crossings
// and nearest points within the aperture cannot be lost by this broad phase.
export function snapGeometry(e,p,tolerance){
 if(e?.type==='image'){
  const corners=imageCorners(e),box={minX:p.x-tolerance,minY:p.y-tolerance,maxX:p.x+tolerance,maxY:p.y+tolerance};
  const points=corners.filter(q=>q.x>=box.minX&&q.x<=box.maxX&&q.y>=box.minY&&q.y<=box.maxY);
  const segments=corners.map((q,i)=>[q,corners[(i+1)%corners.length]]).filter(([a,b])=>Math.min(a.x,b.x)<=box.maxX&&Math.max(a.x,b.x)>=box.minX&&Math.min(a.y,b.y)<=box.maxY&&Math.max(a.y,b.y)>=box.minY);
  return {points,segments};
 }
 if(e.type==='hatch'&&e.loops?.length){
  const parts=hatchRings(e).map(points=>snapGeometry({type:'polyline',points,closed:true},p,tolerance));
  return {points:parts.flatMap(part=>part.points),segments:parts.flatMap(part=>part.segments)};
 }
 const box={minX:p.x-tolerance,minY:p.y-tolerance,maxX:p.x+tolerance,maxY:p.y+tolerance};
 const contains=a=>a.x>=box.minX&&a.x<=box.maxX&&a.y>=box.minY&&a.y<=box.maxY;
 const overlaps=(a,b)=>{const dx=Math.abs(a.x-b.x)*1e-9,dy=Math.abs(a.y-b.y)*1e-9;return Math.min(a.x,b.x)-dx<=box.maxX&&Math.max(a.x,b.x)+dx>=box.minX&&Math.min(a.y,b.y)-dy<=box.maxY&&Math.max(a.y,b.y)+dy>=box.minY;};
 const cached=snapGeometryIndex(e),ps=e.points||[];
 if(!cached){
  // Allocate pairs only for surviving segments; dense overview queries often
  // discard most pairs after another candidate has reduced the snap radius.
  const ss=[];
  for(let i=1;i<ps.length;i++){const a=ps[i-1],b=ps[i];if(a&&b&&overlaps(a,b))ss.push([a,b]);}
  if(e.closed||e.type==='rectangle'||e.type==='hatch'){
   const a=ps.at(-1),b=ps[0];if(a&&b&&overlaps(a,b))ss.push([a,b]);
  }
  return {points:ps.filter(contains),segments:e.snapDefinitionPoints?[]:ss};
 }
 const indices=new Set(),ss=[];
 for(const chunk of cached.index.query(box))for(let i=chunk.start;i<chunk.end;i++){
  const j=(i+1)%ps.length,a=ps[i],b=ps[j];
  if(contains(a))indices.add(i);if(contains(b))indices.add(j);
  if(overlaps(a,b))ss.push([a,b]);
 }
 return {points:[...indices].sort((a,b)=>a-b).map(i=>ps[i]),segments:ss};
}
function blockInteractionState(e){
 const source=e._visibleEntities||e.entities,clip=e.clip,b=e._renderBounds;
 return {source,length:source?.length,entities:e.entities,layer:e.layer,clip,clipPoints:clip?.points,
  clipLength:clip?.points?.length,enabled:clip?.enabled,inverted:clip?.inverted,renderBounds:b,
  minX:b?.minX,minY:b?.minY,maxX:b?.maxX,maxY:b?.maxY};
}
function sameBlockInteraction(state,e){
 if(!state)return false;const next=blockInteractionState(e);
 return Object.keys(next).every(key=>state[key]===next[key]);
}
// Build the broad phase while an immutable display artifact is prepared, not
// on the first click. Keep blocks/dimensions in the fallback list because their
// descendants' snap centers can lie beyond their ordinary drawing bounds.
function warmBlockChildIndexes(e){
 if(e?.type!=='block')return;
 const children=e._visibleEntities||e.entities||[];
 for(const child of children)if(child.type==='block')warmBlockChildIndexes(child);
 if(children.length<128)return;
 const always=[],drawAlways=[];
 const index=createPackedBoundsIndex(children.length,order=>{
  const child=children[order];
  // Only simple straight strokes have a reliable drawing footprint here.
  // Text, thick polylines, nested clipping and generated geometry stay intact.
  if(!(child.type==='line'&&!child.center&&!child.closed&&child.points?.length===2))drawAlways.push(order);
  if(child.type==='block'||child.type==='dimension'){always.push(order);return null;}
  const b=spatialBounds(child);
  if(!b){always.push(order);return null;}
  if(child.center&&Number.isFinite(child.center.x)&&Number.isFinite(child.center.y)){
   b.minX=Math.min(b.minX,child.center.x);b.maxX=Math.max(b.maxX,child.center.x);
   b.minY=Math.min(b.minY,child.center.y);b.maxY=Math.max(b.maxY,child.center.y);
  }
  return b;
 });
 blockChildIndexes.set(e,{state:blockInteractionState(e),index,always,drawAlways,children});
}
export function queryDrawingChildren(e,box){
 const children=e._visibleEntities||e.entities||[],cached=blockChildIndexes.get(e);
 if(!box||!['minX','minY','maxX','maxY'].every(key=>Number.isFinite(box[key]))||box.minX>box.maxX||box.minY>box.maxY||!sameBlockInteraction(cached?.state,e))return children;
 const b=e._renderBounds;
 if(b&&box.minX<=b.minX&&box.minY<=b.minY&&box.maxX>=b.maxX&&box.maxY>=b.maxY)return children;
 const orders=new Set(cached.index.query(box));
 for(const order of cached.always)orders.add(order);
 for(const order of cached.drawAlways)orders.add(order);
 return [...orders].sort((a,b)=>a-b).map(order=>children[order]);
}
function localBlockChildren(e,box){
 const cached=blockChildIndexes.get(e);
 if(!sameBlockInteraction(cached?.state,e))return e._visibleEntities||e.entities||[];
 return cached.index.query(box).concat(cached.always).sort((a,b)=>a-b).map(order=>cached.children[order]);
}
export function prepareEntityDistanceIndex(e){
 const instance=getDisplayInstance(e);if(instance){prepareEntityDistanceIndex(instance.source);return {query:box=>queryEntityPrimitives(e,box)};}
 if(e?.type!=='block')return null;
 const cached=blockHitIndexes.get(e);
 if(sameBlockInteraction(cached?.state,e))return cached.index;
 const index=staticSpatialIndex(visiblePrimitives(e));blockHitIndexes.set(e,{state:blockInteractionState(e),index});blockLocalHitIndexes.delete(e);return index;
}
const boundsOverlap=(a,b)=>a&&b&&a.minX<=b.maxX&&a.maxX>=b.minX&&a.minY<=b.maxY&&a.maxY>=b.minY;
const boundsContain=(outer,inner)=>outer&&inner&&outer.minX<=inner.minX&&outer.minY<=inner.minY&&outer.maxX>=inner.maxX&&outer.maxY>=inner.maxY;
function localInteractionTree(e,box){
 const b=spatialBounds(e);
 if(e.type!=='block'){
  // Match spatialIndex's center-snap extent, even for arcs whose entire curve
  // is outside the aperture. Dimensions may generate such arcs as primitives.
  if(e.type==='dimension'||!b)return e;
  if(e.center&&Number.isFinite(e.center.x)&&Number.isFinite(e.center.y)){
   b.minX=Math.min(b.minX,e.center.x);b.minY=Math.min(b.minY,e.center.y);
   b.maxX=Math.max(b.maxX,e.center.x);b.maxY=Math.max(b.maxY,e.center.y);
  }
  return boundsOverlap(b,box)?e:null;
 }
 if(boundsContain(box,b))return e;
 // A block's display bounds omit descendant arc centers. Traverse children
 // even outside those bounds so local queries retain the full index's snaps.
 const children=[];
 for(const child of localBlockChildren(e,box)){const local=localInteractionTree(child,box);if(local)children.push(local);}
 // Existing primitive expansion owns clip intersections and inherited layers.
 // Trim only whole out-of-region children, leaving those exact rules intact.
 return children.length?{...e,entities:children,_visibleEntities:children}:null;
}
function localBlockPrimitives(e,box){
 const full=blockHitIndexes.get(e);
 if(sameBlockInteraction(full?.state,e))return full.index.query(box);
 let local=blockLocalHitIndexes.get(e);
 if(!sameBlockInteraction(local?.state,e))local={regions:[]};
 const found=local.regions.findIndex(region=>boundsContain(region.box,box));
 if(found>=0){const [region]=local.regions.splice(found,1);local.regions.push(region);return region.index.query(box);}
 // Cover four times the requested width/height so nearby cursor queries reuse
 // the same primitive identities without flattening the complete block first.
 const dx=(box.maxX-box.minX)*1.5,dy=(box.maxY-box.minY)*1.5;
 const padded={minX:box.minX-dx,maxX:box.maxX+dx,minY:box.minY-dy,maxY:box.maxY+dy};
 if(boundsContain(padded,spatialBounds(e)))return prepareEntityDistanceIndex(e).query(box);
 const tree=localInteractionTree(e,padded),index=staticSpatialIndex(tree?visiblePrimitives(tree):[]);
 local.regions.push({box:padded,index});if(local.regions.length>4)local.regions.shift();
 local.state=blockInteractionState(e);blockLocalHitIndexes.set(e,local);
 return index.query(box);
}
// Boolean interaction queries can stop at the first actual hit. Building a
// complete primitive index first defeats that early exit for large blocks.
export function someEntityPrimitive(e,box,predicate){
 const instance=getDisplayInstance(e);
 if(instance){
  const {source,dx,dy,primitiveCache}=instance;
  const local={minX:box.minX-dx,maxX:box.maxX-dx,minY:box.minY-dy,maxY:box.maxY-dy};
  return someEntityPrimitive(source,local,part=>{let moved=primitiveCache.get(part);if(!moved){moved=translateDisplayPart(part,dx,dy,e.id+'/'+part.id);primitiveCache.set(part,moved);}return predicate(moved);});
 }
 if(e.type==='block'&&!e.clip?.enabled&&Object.isFrozen(e)){
  for(const child of localBlockChildren(e,box))if(someEntityPrimitive(child,box,part=>predicate(part.layer||!e.layer?part:{...part,layer:e.layer})))return true;
  return false;
 }
 // Keep the existing exact clipping expansion for clipped subtrees.
 for(const part of e.type==='block'?queryEntityPrimitives(e,box):visiblePrimitives(e))if(predicate(part))return true;
 return false;
}
// Snap-only anchors never enter rendering or entity-distance picking.
const snapAnchorTrees=new WeakMap(),snapAnchorIndexes=new WeakMap();
function snapAnchors(e){
 const instance=getDisplayInstance(e);
 if(instance){
  const cached=snapAnchorTrees.get(e);if(cached)return cached.anchors;
  const anchors=snapAnchors(instance.source).map(part=>translateDisplayPart(part,instance.dx,instance.dy,e.id+'/'+part.id));
  snapAnchorTrees.set(e,{anchors});return anchors;
 }
 if(!['block','dimension'].includes(e.type))return [];
 const cached=snapAnchorTrees.get(e);
 if(sameBlockInteraction(cached?.state,e)&&cached.points===e.points&&cached.position===e.position)return cached.anchors;
 let anchors=e.type==='dimension'?[{id:e.id,type:'snap-points',snapDefinitionPoints:true,points:e.points||[],layer:e.layer}]:e.position?[{id:e.id,type:'block',position:e.position,layer:e.layer}]:[];
 if(e.type==='block'){
  for(const child of e._visibleEntities||e.entities||[])if(['block','dimension'].includes(child.type))anchors.push(...snapAnchors(child));
  if(e.clip?.enabled)anchors=anchors.map(part=>({...part,clipMasks:[...(part.clipMasks||[]),e.clip]}));
 }
 snapAnchorTrees.set(e,{state:blockInteractionState(e),points:e.points,position:e.position,anchors});return anchors;
}
export function querySnapPrimitives(e,box){
 const instance=getDisplayInstance(e);
 if(instance){
  const {source,dx,dy,primitiveCache}=instance,local={minX:box.minX-dx,maxX:box.maxX-dx,minY:box.minY-dy,maxY:box.maxY-dy};
  return querySnapPrimitives(source,local).map(part=>{let moved=primitiveCache.get(part);if(!moved){moved=translateDisplayPart(part,dx,dy,e.id+'/'+part.id);primitiveCache.set(part,moved);}return moved;});
 }
 const all=snapAnchors(e);
 if(all.length>=128){
  let index=snapAnchorIndexes.get(all);if(!index){index=staticSpatialIndex(all);snapAnchorIndexes.set(all,index);}
  return index.query(box).concat(queryEntityPrimitives(e,box));
 }
 const anchors=all.filter(part=>{
  const b=indexBounds(part);return b&&boundsOverlap(b,box);
 });
 return anchors.concat(queryEntityPrimitives(e,box));
}
export function queryEntityPrimitives(e,box){
 const instance=getDisplayInstance(e);
 if(instance){
  const {source,dx,dy,primitiveCache}=instance,local={minX:box.minX-dx,maxX:box.maxX-dx,minY:box.minY-dy,maxY:box.maxY-dy};
  return queryEntityPrimitives(source,local).map(part=>{let moved=primitiveCache.get(part);if(!moved){moved=translateDisplayPart(part,dx,dy,e.id+'/'+part.id);primitiveCache.set(part,moved);}return moved;});
 }
 // The first small pick must not flatten/index every primitive of a DWG block.
 // Reuse complete indexes when prepared, otherwise retain bounded local ones.
 if(e?.type==='block')return localBlockPrimitives(e,box);
 const overlaps=b=>b&&b.minX<=box.maxX&&b.maxX>=box.minX&&b.minY<=box.maxY&&b.maxY>=box.minY;
 return visiblePrimitives(e).filter(part=>overlaps(part.type==='hatch'&&part.loops?.length?indexBounds(part):snapGeometryIndex(part)?.bounds||indexBounds(part)));
}
// Resolve display-collapsed block detail without changing the rendering copy,
// canonical document, layer visibility, or stored shared-block definitions.
export function preciseSnapBlock(doc,e){
 if(getDisplayInstance(e))return e;
 const collapsed=entity=>entity?.type==='block'&&(entity._lodCollapsed||(entity._visibleEntities||entity.entities||[]).some(collapsed));
 return collapsed(e)?visibleEntities(doc,{entities:[e]})[0]||null:e;
}
export function entityDistance(e, p, tolerance=Infinity) {
 const instance=getDisplayInstance(e);if(instance)return entityDistance(instance.source,{x:p.x-instance.dx,y:p.y-instance.dy},tolerance);
  if(!visiblePoint(e,p))return Infinity;
  if(e.clip?.enabled&&!clipContains(e.clip,p))return Infinity;

  if (e.type === "point") return dist(e.position, p);
  if (e.type === 'image') return Math.min(...segments(e).map(s=>distanceToSegment(p,...s)));
  if (e.type === "ellipse")
    return Math.min(
      ...segments({ points: ellipsePoints(e, 128) }).map((s) =>
        distanceToSegment(p, ...s),
      ),
    );
  if (["block", "dimension", "wall"].includes(e.type)) {
    let parts;
    if(e.type==='block'&&Number.isFinite(tolerance)){
      const box={minX:p.x-tolerance,minY:p.y-tolerance,maxX:p.x+tolerance,maxY:p.y+tolerance};
      parts=queryEntityPrimitives(e,box);
    }else parts=visiblePrimitives(e);
    let nearest=Infinity;
    for(const primitive of parts)nearest=Math.min(nearest,entityDistance(primitive,p,tolerance));
    return nearest;
  }
  if (e.type === "circle") return Math.abs(dist(p, e.center) - e.radius);
  if (e.type === "arc") {
    const a = angle(sub(p, e.center));
    return angleOnArc(a, e.startAngle, e.endAngle)
      ? Math.abs(dist(p, e.center) - e.radius)
      : Math.min(
          ...vertices(e)
            .slice(0, 2)
            .map((v) => dist(v, p)),
        );
  }
  if (e.type === "text") {
    const vs = vertices(e);
    if (inside(p, vs)) return 0;
    return Math.min(
      ...segments({ points: vs, closed: true }).map(([a, b]) =>
        distanceToSegment(p, a, b),
      ),
    );
  }
  if (e.type === "hatch") {
    // Match the even-odd fill used by the drawing/plot paths: holes are empty,
    // nested islands are filled, and every loop boundary remains pickable.
    const loops = [e.points, ...(Array.isArray(e.loops) ? e.loops : [])].filter(loop => Array.isArray(loop) && loop.length >= 3);
    let filled=false;
    for(const loop of loops)if(inside(p,loop))filled=!filled;
    if(filled)return 0;
    let nearest=Infinity;
    for(const loop of loops)for(let i=0;i<loop.length;i++)nearest=Math.min(nearest,distanceToSegment(p,loop[i],loop[(i+1)%loop.length]));
    return nearest;
  }
  // 폭 있는 폴리선(PW·PEDIT 폭)은 칠해진 띠 전체가 고르는 자리다 — 중심선까지 거리에서 반폭을 뺀다.
  const half=Math.max(0,Number(e.constantWidth)||0,Number(e.startWidth)||0,Number(e.endWidth)||0,...(Array.isArray(e.points)?e.points:[]).map(v=>Math.max(Number(v?.startWidth)||0,Number(v?.endWidth)||0)))/2;
  let nearest=Infinity;
  const local=Number.isFinite(tolerance)&&tolerance>=0?snapGeometry(e,p,tolerance+half).segments:segments(e);
  for(const [a,b] of local)nearest=Math.min(nearest,distanceToSegment(p,a,b));
  return Math.max(0,nearest-half);
}
export function offsetEntity(e, d, side) {
  if (!Number.isFinite(d) || d <= 0)
    throw Error("오프셋 거리는 양수여야 합니다.");
  if (["circle", "arc"].includes(e.type)) {
    const radius = e.radius + (dist(side, e.center) >= e.radius ? d : -d);
    if (radius <= EPS) throw Error("안쪽 오프셋이 반지름보다 큽니다.");
    return { ...structuredClone(e), radius };
  }
  if (!["line", "polyline", "rectangle"].includes(e.type))
    throw Error("OFFSET은 선·직선 폴리선·원·호에 지원됩니다.");
  const ss = segments(e);
  let nearest = ss[0],
    best = Infinity;
  for (const s of ss) {
    const n = distanceToSegment(side, ...s);
    if (n < best) {
      best = n;
      nearest = s;
    }
  }
  const sign =
      cross(sub(nearest[1], nearest[0]), sub(side, nearest[0])) >= 0 ? 1 : -1,
    shifted = ss.map(([a, b]) => {
      const n = mul(normal(unit(sub(b, a))), d * sign);
      return [add(a, n), add(b, n)];
    }),
    closed = e.type === "rectangle" || e.closed,
    points = [];
  for (let i = 0; i < e.points.length; i++) {
    if (!closed && i === 0) {
      points.push(shifted[0][0]);
      continue;
    }
    if (!closed && i === e.points.length - 1) {
      points.push(shifted.at(-1)[1]);
      continue;
    }
    const prev = shifted[(i - 1 + shifted.length) % shifted.length],
      next = shifted[i % shifted.length],
      hit = lineIntersection(...prev, ...next);
    if (!hit) {
      if (dot(sub(prev[1], prev[0]), sub(next[1], next[0])) <= 0)
        throw Error("되돌아가는 폴리선은 오프셋할 수 없습니다.");
      points.push(next[0]);
    } else {
      if (dist(hit.point, e.points[i]) > d * 50)
        throw Error("모서리가 너무 예리합니다. 선을 나누어 오프셋하세요.");
      points.push(hit.point);
    }
  }
  if (closed) {
    const signed = (ps) =>
      ps.reduce((s, p, i) => s + cross(p, ps[(i + 1) % ps.length]), 0);
    if (signed(e.points) * signed(points) <= 0 || polygonArea(points) < EPS)
      throw Error("오프셋 결과가 소멸하거나 뒤집힙니다.");
    for (let i = 0; i < points.length; i++) {
      const original = sub(e.points[(i + 1) % points.length], e.points[i]),
        shift = sub(points[(i + 1) % points.length], points[i]);
      if (dot(original, shift) <= 0)
        throw Error("오프셋 거리가 형상보다 큽니다.");
    }
  }
  const out = { ...structuredClone(e), points };
  const edges = segments(out);
  for (let i = 0; i < edges.length; i++)
    for (let j = i + 2; j < edges.length; j++) {
      if (closed && i === 0 && j === edges.length - 1) continue;
      const h = lineIntersection(...edges[i], ...edges[j]);
      if (h && h.t > EPS && h.t < 1 - EPS && h.u > EPS && h.u < 1 - EPS)
        throw Error("오프셋이 자기 교차합니다. 거리를 줄이세요.");
    }
  return out;
}
export function cutLine(target, boundaries, pick, extend = false) {
  if (target.type !== "line")
    throw Error(
      "TRIM/EXTEND 대상은 개별 직선입니다. 폴리선은 EXPLODE 후 편집하세요.",
    );
  const [a, b] = target.points,
    v = sub(b, a),
    hits = [];
  for (const boundary of boundaries)
    for (const part of primitives(boundary)) {
      for (const [c, d] of segments(part)) {
        const h = lineIntersection(a, b, c, d);
        if (h && h.u >= -EPS && h.u <= 1 + EPS) hits.push(h.t);
      }
      if (["circle", "arc"].includes(part.type)) {
        const q = sub(a, part.center),
          A = dot(v, v),
          B = 2 * dot(q, v),
          C = dot(q, q) - part.radius ** 2,
          disc = B * B - 4 * A * C;
        if (disc >= 0)
          for (const t of [
            (-B - Math.sqrt(disc)) / (2 * A),
            (-B + Math.sqrt(disc)) / (2 * A),
          ]) {
            const hit = add(a, mul(v, t));
            if (
              part.type === "circle" ||
              angleOnArc(
                angle(sub(hit, part.center)),
                part.startAngle,
                part.endAngle,
              )
            )
              hits.push(t);
          }
      }
    }
  const t = dot(sub(pick, a), v) / dot(v, v),
    unique = [...new Set(hits.map((t) => Math.round(t * 1e10) / 1e10))].sort(
      (a, b) => a - b,
    );
  if (extend) {
    const start = t < 0.5,
      candidates = unique.filter((x) => (start ? x < -EPS : x > 1 + EPS));
    if (!candidates.length)
      throw Error("연장 방향에서 경계를 찾지 못했습니다.");
    const h = start ? candidates.at(-1) : candidates[0];
    return [
      {
        ...target,
        points: start ? [add(a, mul(v, h)), b] : [a, add(a, mul(v, h))],
      },
    ];
  }
  const interior = unique.filter((x) => x > EPS && x < 1 - EPS);
  if (!interior.length) throw Error("대상 선 내부에 경계 교차점이 없습니다.");
  const marks = [0, ...interior, 1];
  let i = marks.findIndex(
    (x, i) => i < marks.length - 1 && t >= x - EPS && t <= marks[i + 1] + EPS,
  );
  if (i < 0) i = t < 0 ? 0 : marks.length - 2;
  const parts = [];
  if (marks[i] > EPS)
    parts.push({ ...target, points: [a, add(a, mul(v, marks[i]))] });
  if (marks[i + 1] < 1 - EPS)
    parts.push({ ...target, points: [add(a, mul(v, marks[i + 1])), b] });
  return parts;
}
export function arcThrough(a, m, b) {
  const c1 = mul(add(a, m), 0.5),
    c2 = mul(add(m, b), 0.5),
    h = lineIntersection(
      c1,
      add(c1, normal(sub(m, a))),
      c2,
      add(c2, normal(sub(b, m))),
    );
  if (!h) throw Error("일직선인 세 점으로 호를 만들 수 없습니다.");
  const center = h.point,
    start = angle(sub(a, center)),
    end = angle(sub(b, center)),
    mid = angle(sub(m, center));
  return {
    type: "arc",
    center,
    radius: dist(a, center),
    startAngle: angleOnArc(mid, start, end) ? start : end,
    endAngle: angleOnArc(mid, start, end) ? end : start,
  };
}
/* options: size2(모따기 둘째 거리), chamferAngle(첫 거리+각도 방식, 도), trim=false(원래 선은 두고 호·모따기선만). */
export function corner(first, second, size, chamfer = false, picks = [], options = {}) {
  if (first.type !== "line" || second.type !== "line")
    throw Error("두 개의 개별 직선을 선택하세요.");
  if (!Number.isFinite(size) || size < 0)
    throw Error("반지름/거리는 0 이상이어야 합니다.");
  const hit = lineIntersection(...first.points, ...second.points);
  if (!hit) throw Error("평행선은 모서리를 만들 수 없습니다.");
  const i = hit.point,
    far = (e, pick) => {
      if(pick&&Number.isFinite(pick.x)&&Number.isFinite(pick.y)&&dist(pick,i)>EPS){
        const direction=sub(pick,i);
        return dot(sub(e.points[0],i),direction)>=dot(sub(e.points[1],i),direction)?e.points[0]:e.points[1];
      }
      return dist(e.points[0],i)>=dist(e.points[1],i)?e.points[0]:e.points[1];
    },
    a = far(first,picks[0]),
    b = far(second,picks[1]),
    u = unit(sub(a, i)),
    v = unit(sub(b, i)),
    theta = Math.acos(Math.max(-1, Math.min(1, dot(u, v))));
  if (theta < EPS || Math.abs(theta - Math.PI) < EPS)
    throw Error("모서리 각도가 유효하지 않습니다.");
  const d = chamfer ? size : size / Math.tan(theta / 2);
  let d2 = d;
  if (chamfer && Number.isFinite(options.chamferAngle)) {
    const alpha = options.chamferAngle * Math.PI / 180, rest = Math.PI - theta - alpha;
    if (!(alpha > EPS) || rest <= EPS) throw Error("모따기 각도가 모서리 각도에 맞지 않습니다.");
    d2 = size * Math.sin(alpha) / Math.sin(rest);
  } else if (chamfer && Number.isFinite(options.size2)) d2 = options.size2;
  if (!Number.isFinite(d2) || d2 < 0) throw Error("모따기 거리는 0 이상이어야 합니다.");
  if (d > dist(i, a) || d2 > dist(i, b))
    throw Error("모서리 크기가 남길 선보다 큽니다.");
  const t1 = add(i, mul(u, d)),
    t2 = add(i, mul(v, d2)),
    entities = options.trim === false ? [] : [
      { ...first, points: [a, t1] },
      { ...second, points: [t2, b] },
    ];
  if (size > EPS || d2 > EPS) {
    if (chamfer)
      entities.push({ type: "line", layer: first.layer, points: [t1, t2] });
    else {
      const center = add(i, mul(unit(add(u, v)), size / Math.sin(theta / 2))),
        s = angle(sub(t1, center)),
        e = angle(sub(t2, center));
      entities.push({
        type: "arc",
        layer: first.layer,
        center,
        radius: size,
        startAngle: normalizeAngle(e - s) <= 180 ? s : e,
        endAngle: normalizeAngle(e - s) <= 180 ? e : s,
      });
    }
  }
  return entities;
}

/* 폴리선 꼭짓점 모깎기·모따기(FILLET/CHAMFER P, 같은 폴리선의 이웃한 두 구간). indices 가 없으면 모든 꼭짓점.
   호는 폴리선 점으로 나눠 넣는다(바른 CAD 폴리선은 곧은 구간만 저장). 구간보다 큰 모서리는 건너뛴다. */
export function polylineCorners(e, size, chamfer = false, options = {}, indices = null) {
  const ps = e.points || [], n = ps.length, closed = !!(e.closed || e.type === "rectangle");
  if (n < 3) throw Error("꼭짓점이 3개 이상인 폴리선을 선택하세요.");
  const want = indices ? new Set(indices) : null, out = [];
  let done = 0, skipped = 0;
  for (let k = 0; k < n; k++) {
    const v = ps[k];
    if ((!closed && (k === 0 || k === n - 1)) || (want && !want.has(k))) { out.push({ ...v }); continue; }
    const prev = ps[(k - 1 + n) % n], next = ps[(k + 1) % n], u = unit(sub(prev, v)), w = unit(sub(next, v));
    const theta = Math.acos(Math.max(-1, Math.min(1, dot(u, w))));
    if (theta < 1e-6 || Math.abs(theta - Math.PI) < 1e-6) { out.push({ ...v }); continue; }
    let d1 = chamfer ? size : size / Math.tan(theta / 2), d2 = d1;
    if (chamfer && Number.isFinite(options.chamferAngle)) { const a = options.chamferAngle * Math.PI / 180, rest = Math.PI - theta - a; d2 = rest > EPS ? size * Math.sin(a) / Math.sin(rest) : Infinity; }
    else if (chamfer && Number.isFinite(options.size2)) d2 = options.size2;
    const room = (p) => dist(p, v) / (want ? 1 : 2);
    if (!(size > EPS) || d1 > room(prev) + EPS || d2 > room(next) + EPS) { out.push({ ...v }); if (size > EPS) skipped++; continue; }
    const t1 = add(v, mul(u, d1)), t2 = add(v, mul(w, d2));
    out.push(t1);
    if (!chamfer) {
      const center = add(v, mul(unit(add(u, w)), size / Math.sin(theta / 2))), a1 = angle(sub(t1, center)), a2 = angle(sub(t2, center));
      let sweep = normalizeAngle(a2 - a1); if (sweep > 180) sweep -= 360;
      const steps = Math.max(2, Math.ceil(Math.abs(sweep) / 10));
      for (let s = 1; s < steps; s++) out.push(add(center, polar(size, a1 + sweep * s / steps)));
    }
    out.push(t2); done++;
  }
  return { entity: { ...e, points: out }, done, skipped };
}

/* 스플라인 맞춤점(ACAD200-409): 맞춤점을 지나는 Catmull-Rom 곡선을 구간마다 16 조각으로(예전 SPLINE 명령과 같은 모양).
   폴리선 `spline:{degree,method:'fit',fitPoints,closed}` 표시는 점 목록이 이 함수 결과와 맞을 때만 쓴다(splineMatches). */
export function splineFitPoints(list, closed = false) {
  if (list.length < 3) return list.map((p) => ({ x: p.x, y: p.y }));
  const pts = closed ? [list.at(-1), ...list, list[0], list[1]] : [list[0], ...list, list.at(-1)], out = [];
  for (let i = 1; i < pts.length - 2; i++) {
    const [p0, p1, p2, p3] = [pts[i - 1], pts[i], pts[i + 1], pts[i + 2]];
    for (let s = 0; s < 16; s++) {
      const t = s / 16, t2 = t * t, t3 = t2 * t;
      out.push({ x: .5 * ((2 * p1.x) + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3), y: .5 * ((2 * p1.y) + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3) });
    }
  }
  if (!closed) out.push({ x: list.at(-1).x, y: list.at(-1).y });
  return out;
}
/** 폴리선의 스플라인 표시가 아직 점 목록과 맞는가(다른 편집으로 점이 바뀌면 맞춤점 그립을 쓰지 않는다). */
export function splineMatches(e) {
  const fit = e?.spline?.fitPoints, ps = e?.points;
  if (!Array.isArray(fit) || fit.length < 2 || !Array.isArray(ps)) return false;
  const closed = !!e.spline.closed, expected = fit.length < 3 ? fit.length : closed ? fit.length * 16 : (fit.length - 1) * 16 + 1;
  if (ps.length !== expected) return false;
  const tol = 1e-6 * Math.max(1, Math.abs(fit[0].x) + Math.abs(fit[0].y));
  return dist(ps[0], fit[0]) <= tol && (closed || dist(ps.at(-1), fit.at(-1)) <= tol);
}
export function ellipsePoints(e, steps = 128) {
  const a = e.majorAxis,
    b = mul(normal(a), e.ratio),
    start = e.startParam || 0,
    end = e.endParam ?? Math.PI * 2,
    sweep =
      (((end - start) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2) ||
      Math.PI * 2;
  return Array.from({ length: steps + 1 }, (_, i) => {
    const t = start + (sweep * i) / steps;
    return add(e.center, add(mul(a, Math.cos(t)), mul(b, Math.sin(t))));
  });
}

// Analytic line/circle/arc intersections; polyline boundaries are decomposed.
export function intersections(a,b){
  const circle=e=>['circle','arc'].includes(e.type),on=(e,p)=>e.type!=='arc'||angleOnArc(angle(sub(p,e.center)),e.startAngle,e.endAngle);
  let points=[];
  if(circle(a)&&circle(b)){
    const v=sub(b.center,a.center),d=len(v);if(d<EPS||d>a.radius+b.radius+EPS||d<Math.abs(a.radius-b.radius)-EPS)return [];
    const x=(a.radius**2-b.radius**2+d*d)/(2*d),h=Math.sqrt(Math.max(0,a.radius**2-x*x)),u=unit(v),base=add(a.center,mul(u,x));points=[add(base,mul(normal(u),h)),sub(base,mul(normal(u),h))];
  }else if(circle(a)||circle(b)){
    const c=circle(a)?a:b,other=circle(a)?b:a;
    for(const [p,q]of segments(other)){const v=sub(q,p),z=sub(p,c.center),A=dot(v,v),B=2*dot(z,v),C=dot(z,z)-c.radius**2,disc=B*B-4*A*C;if(disc<-EPS||A<EPS)continue;for(const t of [(-B-Math.sqrt(Math.max(0,disc)))/(2*A),(-B+Math.sqrt(Math.max(0,disc)))/(2*A)])if(t>=-EPS&&t<=1+EPS)points.push(add(p,mul(v,t)));}
  }else for(const [p,q]of segments(a))for(const [r,s]of segments(b)){const h=lineIntersection(p,q,r,s);if(h&&h.t>=-EPS&&h.t<=1+EPS&&h.u>=-EPS&&h.u<=1+EPS)points.push(h.point);}
  return points.filter((p,i)=>on(a,p)&&on(b,p)&&!points.slice(0,i).some(q=>dist(p,q)<1e-6));
}
export function cutEntity(target,boundaries,pick,extend=false){
 if(target.type==='line')return cutLine(target,boundaries,pick,extend);
 if(!['circle','arc'].includes(target.type))throw Error('선·원·호를 선택하세요. 폴리선은 분해 후 편집할 수 있습니다.');
 const full={...target,type:'circle'},angles=boundaries.flatMap(primitives).flatMap(e=>intersections(full,e)).map(p=>normalizeAngle(angle(sub(p,target.center)))).sort((a,b)=>a-b).filter((a,i,list)=>!i||Math.abs(a-list[i-1])>1e-6);
 const picked=normalizeAngle(angle(sub(pick,target.center))),make=(a,b)=>({...target,type:'arc',startAngle:normalizeAngle(a),endAngle:normalizeAngle(b)});
 if(target.type==='circle'){
  if(extend)throw Error('닫힌 원은 연장할 수 없습니다.');if(angles.length<2)throw Error('원을 자를 교차점이 두 개 필요합니다.');
  for(let i=0;i<angles.length;i++){const a=angles[i],b=angles[(i+1)%angles.length];if(angleOnArc(picked,a,b))return [make(b,a)];}
 }
 const start=target.startAngle,sweep=normalizeAngle(target.endAngle-start),t=normalizeAngle(picked-start);
 if(extend){
  const isStart=dist(pick,add(target.center,polar(target.radius,start)))<dist(pick,add(target.center,polar(target.radius,target.endAngle)));
  const outside=angles.filter(a=>!angleOnArc(a,start,target.endAngle));if(!outside.length)throw Error('연장할 교차점이 없습니다.');
  outside.sort((a,b)=>isStart?normalizeAngle(start-a)-normalizeAngle(start-b):normalizeAngle(a-target.endAngle)-normalizeAngle(b-target.endAngle));return [isStart?make(outside[0],target.endAngle):make(start,outside[0])];
 }
 const cuts=[0,...angles.map(a=>normalizeAngle(a-start)).filter(a=>a>EPS&&a<sweep-EPS),sweep].sort((a,b)=>a-b);
 if(cuts.length===2)throw Error('호 안에 자를 교차점이 없습니다.');
 for(let i=0;i<cuts.length-1;i++)if(t>=cuts[i]-EPS&&t<=cuts[i+1]+EPS)return [...(cuts[i]>EPS?[make(start,start+cuts[i])]:[]),...(cuts[i+1]<sweep-EPS?[make(start+cuts[i+1],start+sweep)]:[])];
 throw Error('호 위의 삭제 구간을 선택하세요.');
}
export function clipToBounds(e,b){
 if(e.type==='block'&&e.clip?.enabled)return [{type:'block',name:e.name,layer:e.layer,entities:[e],clip:{enabled:true,points:rectangle({x:b.minX,y:b.minY},{x:b.maxX,y:b.maxY})}}];
 const inside=p=>p.x>=b.minX-EPS&&p.x<=b.maxX+EPS&&p.y>=b.minY-EPS&&p.y<=b.maxY+EPS;
 const boundary={type:'rectangle',points:rectangle({x:b.minX,y:b.minY},{x:b.maxX,y:b.maxY})};
 const box=bounds([e]);if(!box||box.maxX<b.minX||box.minX>b.maxX||box.maxY<b.minY||box.minY>b.maxY)return [];
 if(box.minX>=b.minX&&box.maxX<=b.maxX&&box.minY>=b.minY&&box.maxY<=b.maxY)return [structuredClone(e)];
 if(e.type==='text'||e.type==='point')return inside(e.position)?[structuredClone(e)]:[];
 if(['block','dimension','wall'].includes(e.type))return primitives(e).flatMap(p=>clipToBounds(p,b));
 if(['circle','arc'].includes(e.type)){
  const start=e.type==='circle'?0:e.startAngle,sweep=e.type==='circle'?360:normalizeAngle(e.endAngle-start),cuts=[0,...intersections(e,boundary).map(p=>normalizeAngle(angle(sub(p,e.center))-start)).filter(a=>a>EPS&&a<sweep-EPS),sweep].sort((a,b)=>a-b),out=[];
  for(let i=1;i<cuts.length;i++){if(inside(add(e.center,polar(e.radius,start+(cuts[i]+cuts[i-1])/2))))out.push({...e,type:'arc',startAngle:normalizeAngle(start+cuts[i-1]),endAngle:normalizeAngle(start+cuts[i])});}return out;
 }
 if(e.type==='hatch'){
  const clip=points=>{for(const [axis,value,sign]of [['x',b.minX,1],['x',b.maxX,-1],['y',b.minY,1],['y',b.maxY,-1]]){const next=[];for(let i=0;i<points.length;i++){const a=points[i],z=points[(i+1)%points.length],ai=(a[axis]-value)*sign>=0,zi=(z[axis]-value)*sign>=0;if(ai)next.push(a);if(ai!==zi){const t=(value-a[axis])/(z[axis]-a[axis]);next.push(add(a,mul(sub(z,a),t)));}}points=next;}return points;};
  const points=clip(e.points);return points.length>=3?[{...e,points,loops:(e.loops||[]).map(clip).filter(p=>p.length>=3)}]:[];
 }
 const edges=e.type==='ellipse'?segments({type:'polyline',points:ellipsePoints(e,512),closed:false}):segments(e),out=[];
 for(const [a,z]of edges){const v=sub(z,a),cuts=[0,1];for(const [c,d]of segments(boundary)){const h=lineIntersection(a,z,c,d);if(h&&h.t>EPS&&h.t<1-EPS&&h.u>=-EPS&&h.u<=1+EPS)cuts.push(h.t);}cuts.sort((a,b)=>a-b);for(let i=1;i<cuts.length;i++)if(inside(add(a,mul(v,(cuts[i]+cuts[i-1])/2))))out.push({...e,type:'line',points:[add(a,mul(v,cuts[i-1])),add(a,mul(v,cuts[i]))]});}
 return out;
}

// Selection handles are world positions; the view paints them at a fixed pixel size.
export function selectionGrips(e){
 let points=[];
 if(e.type==='line'&&e.points?.length===2)points=[e.points[0],mul(add(e.points[0],e.points[1]),.5),e.points[1]];
 else if(e.type==='circle')points=[e.center,...[0,90,180,270].map(a=>add(e.center,polar(e.radius,a)))];
 else if(e.type==='arc'){const sweep=normalizeAngle(e.endAngle-e.startAngle)||360;points=[e.center,...[e.startAngle,e.startAngle+sweep/2,e.endAngle].map(a=>add(e.center,polar(e.radius,a)))];}
 else if(e.type==='ellipse')points=[e.center,...ellipsePoints(e,4)];
 else if(e.type==='block'&&e.clip?.enabled)points=e.clip.points;
 else if(e.type==='block'){const b=bounds([e]);points=e.position?[e.position]:b?[{x:b.minX,y:b.minY}]:[];}
 else if(e.position)points=[e.position];
 else points=e.points||[];
 const seen=new Set();return points.filter(p=>{const key=p.x.toFixed(6)+','+p.y.toFixed(6);if(seen.has(key))return false;seen.add(key);return true;});
}

export function editingGrips(e){
 const move=point=>({kind:'move',point});
 if(e.lineWallHost)return []; // These openings also own split source lines.
 if(e.hostWall&&e.position&&e.openingWidth){const u=polar(1,e.parameters?.rotation||0);return [{kind:'opening-start',point:e.position},move(add(e.position,mul(u,e.openingWidth/2))),{kind:'opening-end',point:add(e.position,mul(u,e.openingWidth))}];}
 if(e.type==='line')return [{kind:'vertex',index:0,point:e.points[0]},{kind:'vertex',index:1,point:e.points[1]}];
 if(e.type==='circle')return [move(e.center),...[0,90,180,270].map(a=>({kind:'radius',point:add(e.center,polar(e.radius,a))}))];
 if(e.type==='arc')return [move(e.center),{kind:'startAngle',point:add(e.center,polar(e.radius,e.startAngle))},{kind:'endAngle',point:add(e.center,polar(e.radius,e.endAngle))}];
 if(e.type==='ellipse')return [move(e.center)];
 if(e.type==='polyline'&&e.spline&&splineMatches(e))return e.spline.fitPoints.map((point,index)=>({kind:'fit',index,point}));
 if(e.type==='dimension'){const pts=(e.points||[]).map((point,index)=>({kind:'vertex',index,point}));const label=dimensionParts(e).find(p=>p.dimensionLabel);if(label)pts.push({kind:'dimension-text',point:label.position});return pts;}
 if(e.type==='block')return e.clip?.enabled?[]:[move(e.position||vertices(e)[0])].filter(g=>g.point);
 if(e.position)return [move(e.position)];
 return (e.points||[]).map((point,index)=>({kind:'vertex',index,point}));
}
export function gripCommand(e,grip,point){
 if(!point||!Number.isFinite(point.x)||!Number.isFinite(point.y))throw Error('그립 좌표를 확인하세요.');
 if(grip.kind==='dimension-text')return {type:'update',ids:[e.id],changes:{textPosition:{x:point.x,y:point.y}}};
 if(grip.kind==='move')return {type:'move',ids:[e.id],dx:point.x-grip.point.x,dy:point.y-grip.point.y};
 if(grip.kind.startsWith('opening-'))return {type:'opening.grip',ids:[e.id],end:grip.kind,point};
 if(grip.kind==='vertex')return {type:'stretch',targets:[{id:e.id,indices:[grip.index]}],dx:point.x-grip.point.x,dy:point.y-grip.point.y};
 // 스플라인 맞춤점 그립: 맞춤점 하나를 옮기고 곡선을 다시 만든다(SPLINEDIT 없이 바로 고침).
 if(grip.kind==='fit'){const fitPoints=e.spline.fitPoints.map((p,i)=>i===grip.index?{x:point.x,y:point.y}:{x:p.x,y:p.y});return {type:'update',ids:[e.id],changes:{points:splineFitPoints(fitPoints,!!e.spline.closed),spline:{...e.spline,fitPoints}}};}
 const changes=grip.kind==='radius'?{radius:dist(point,e.center)}:{[grip.kind]:angle(sub(point,e.center))};
 return {type:'update',ids:[e.id],changes};
}

// First parcelEntities() item passing `test`, without building the list.
// Change listeners ask this on every commit; flattening a 200k-object drawing
// into a new array each time cost ~10 ms per edit. Top-level entities are
// tested as themselves; parcel-group children as the same renamed copies.
// `role`, when given, is a parcelRole the test requires; other entities are
// skipped before the test (and before any renamed copy) is made.
export function findParcelEntity(entities,test,role=null){
 // Parcel candidates are counted by the engine's entity index; a drawing with
 // none (most imported plans) needs no scan at all.
 if(role!==null&&entityIndex(entities)?.features.parcel===0)return null;
 const visit=(e,owner)=>{
  if(e.type==='block'&&e.parcelGroup){for(const child of e.entities||[]){const hit=visit(child,e.id);if(hit)return hit;}return null;}
  if(role!==null&&e.parcelRole!==role)return null;
  const item=owner?{...e,id:owner+':'+e.id,parcelBlockId:owner}:e;return test(item)?item:null;
 };
 for(const e of entities){if(role!==null&&e.parcelRole!==role&&!(e.type==='block'&&e.parcelGroup))continue;const hit=visit(e);if(hit)return hit;}
 return null;
}
// Parcel blocks store world coordinates; readers can use their boundaries without exploding them.
export function parcelEntities(entities){
 const result=[];
 const visit=(e,owner)=>{if(e.type==='block'&&e.parcelGroup){for(const child of e.entities||[])visit(child,e.id);}else result.push(owner?{...e,id:owner+':'+e.id,parcelBlockId:owner}:e);};
 for(const e of entities)visit(e);return result;
}

/** 닫힌 다각형을 원(c, r) 안으로 자른다(원 = 128각형, Sutherland–Hodgman). 다 밖이면 []. 대지분석 원판을 경계선으로(2026-10-27). */
export function clipRingToCircle(points,c,r,n=128){
 let out=points.map(p=>({x:p.x,y:p.y}));
 for(let k=0;k<n&&out.length;k++){
  const a=2*Math.PI*k/n,b=2*Math.PI*(k+1)/n,ax=c.x+r*Math.cos(a),ay=c.y+r*Math.sin(a),ex=Math.cos(b)*r-Math.cos(a)*r,ey=Math.sin(b)*r-Math.sin(a)*r;
  const side=p=>ex*(p.y-ay)-ey*(p.x-ax)>=0,input=out;out=[];
  for(let i=0;i<input.length;i++){const p=input[i],q=input[(i+1)%input.length],pi=side(p),qi=side(q);
   if(pi)out.push(p);
   if(pi!==qi){const dp=ex*(p.y-ay)-ey*(p.x-ax),dq=ex*(q.y-ay)-ey*(q.x-ax),t=dp/(dp-dq);out.push({x:p.x+(q.x-p.x)*t,y:p.y+(q.y-p.y)*t});}}
 }
 return out.length>=3?out:[];
}
/** 열린 선을 원(c, r) 안 토막들로 자른다 — 원 둘레와 만나는 점에서 정확히 끊는다(둘레 위 점은 거기서 시작·끝). */
export function clipLineToCircle(points,c,r){
 const inside=p=>(p.x-c.x)**2+(p.y-c.y)**2<=r*r,runs=[];let run=null;
 const cross=(p,q)=>{const dx=q.x-p.x,dy=q.y-p.y,fx=p.x-c.x,fy=p.y-c.y,A=dx*dx+dy*dy,B=2*(fx*dx+fy*dy),C=fx*fx+fy*fy-r*r,D=B*B-4*A*C;if(A===0||D<0)return [];const s=Math.sqrt(D);return [(-B-s)/(2*A),(-B+s)/(2*A)].filter(t=>t>0&&t<1).map(t=>({x:p.x+dx*t,y:p.y+dy*t}));};
 for(let i=0;i<points.length;i++){const p=points[i];
  if(i===0){if(inside(p))run=[{x:p.x,y:p.y}];continue;}
  const prev=points[i-1],hits=cross(prev,p);
  if(run){if(inside(p))run.push({x:p.x,y:p.y});else{if(hits[0])run.push(hits[0]);runs.push(run);run=null;}}
  else if(inside(p)){run=hits.length?[hits.at(-1),{x:p.x,y:p.y}]:[{x:p.x,y:p.y}];}
  else if(hits.length===2)runs.push(hits);
 }
 if(run)runs.push(run);
 return runs.filter(rn=>rn.length>=2);
}
