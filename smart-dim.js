// 스마트 치수(훈민캐드 대조 기반 H106 · AutoCAD DIM). 가리킨 것에 맞는 치수를 한 명령으로 넣는다.
//  선            → 선형. 치수선 위치가 선의 위/아래면 수평, 왼/오른쪽이면 수직(DIMLINEAR 과 같은 규칙),
//                  기울어진 선에서 선에 수직으로 떼면(선의 경계 상자 안, 또는 선 길이 범위 안의 바깥 모서리) 정렬.
//  폴리선·사각형 → 누른 구간을 선과 같이 선형으로.
//  원            → 지름.      호 → 반지름(방향은 호 범위 안으로).
//  선을 고른 뒤 치수선 위치 대신 평행하지 않은 다른 선(또는 폴리선 구간)을 누르면 → 각도. 마지막 점이 든 사분면의 각을 잰다.
//  빈 곳, 또는 끝점·중간점·교차점 같은 스냅 점 → 두 점 선형(첫 치수점 → 둘째 치수점 → 치수선 위치). AutoCAD DIM 도 스냅이
//                  잡히면 객체 대신 점으로 받는다.
// 카드 문맥의 pickEntity 는 누른 위치를 돌려주지 않고, 빈 곳을 누르면 다시 묻는다. 그래서 pickPoint 로 점을 받고
// 그 점에서 tolerance() 안의 가장 가까운 객체를 고른다(미리보기에 고를 객체를 점선으로 보여 준다).
// 폴리선의 bulges(곡선 표시)는 이 프로그램이 화면·히트·내보내기 모두 직선으로 다루므로 곧은 구간으로 잰다.
// 치수 객체 모양은 geometry.js dimensionParts 기준: 선형 [a,b,치수선 점], 반지름·지름 [중심, 원 위 점, 방향 점](DIMRADIUS·DIMDIAMETER 와 같음),
// 각도 [교점, 첫 선 위 점, 둘째 선 위 점, 호 위치].
import * as G from './geometry.js';
import {dimensionPreview,pickDimensionPlacement} from './dimension-preview.js';
import {assocFromSpec,assocFromPicks,lookupIn} from './dim-assoc.js';

export const SMART_DIM_TYPES = Object.freeze(['line', 'polyline', 'rectangle', 'circle', 'arc']);
export const SMART_DIM_MODE_LABELS = Object.freeze({horizontal: '수평 치수', vertical: '수직 치수', aligned: '정렬 치수', radius: '반지름 치수', diameter: '지름 치수', angular: '각도 치수'});
// 0.001° 보다 덜 벌어진 두 선은 평행으로 본다(교점이 도면 좌표 한도를 넘어간다).
const PARALLEL_SIN = Math.sin(0.001 * Math.PI / 180);

const finitePoint = p => !!p && typeof p === 'object' && Number.isFinite(p.x) && Number.isFinite(p.y);
const pt = p => ({x: p.x, y: p.y});
const mid = (a, b) => ({x: (a.x + b.x) / 2, y: (a.y + b.y) / 2});

/** 선·폴리선·사각형의 곧은 구간 목록. 원·호는 빈 목록. */
export function straightSegments(e) {
 if (!e || !Array.isArray(e.points)) return [];
 if (e.type === 'line') return e.points.length >= 2 ? [[e.points[0], e.points[1]]] : [];
 if (e.type === 'polyline' || e.type === 'rectangle') return G.segments(e);
 return [];
}
const arcEnds = e => [G.add(e.center, G.polar(e.radius, e.startAngle)), G.add(e.center, G.polar(e.radius, e.endAngle))];
const arcMidAngle = e => e.startAngle + G.normalizeAngle(e.endAngle - e.startAngle) / 2;

/** 점에서 객체까지 거리. 곧은 객체는 가장 가까운 구간 번호도 준다. */
export function hitEntity(e, p) {
 if (e.type === 'circle') return {distance: Math.abs(G.dist(p, e.center) - e.radius), segment: -1};
 if (e.type === 'arc') {
  const on = G.angleOnArc(G.angle(G.sub(p, e.center)), e.startAngle, e.endAngle);
  return {distance: on ? Math.abs(G.dist(p, e.center) - e.radius) : Math.min(...arcEnds(e).map(q => G.dist(p, q))), segment: -1};
 }
 let best = {distance: Infinity, segment: -1};
 straightSegments(e).forEach(([a, b], i) => {
  if (!finitePoint(a) || !finitePoint(b) || G.dist(a, b) < G.EPS) return;
  const d = G.distanceToSegment(p, a, b);
  if (d < best.distance) best = {distance: d, segment: i};
 });
 return best;
}

/** 스냅이 잡는 점(끝점·중간점·꼭짓점·사분점·중심). 누른 점이 여기와 같으면 객체 대신 점으로 받는다. */
export function snapKeyPoints(e) {
 if (e.type === 'circle') return [e.center, ...[0, 90, 180, 270].map(a => G.add(e.center, G.polar(e.radius, a)))];
 if (e.type === 'arc') return [e.center, ...arcEnds(e), G.add(e.center, G.polar(e.radius, arcMidAngle(e)))];
 const segs = straightSegments(e);
 return [...(e.points || []), ...segs.map(([a, b]) => mid(a, b))].filter(finitePoint);
}

/**
 * 순수 분류: 객체 + 누른 점 → 치수 사양.
 *  {kind:'linear', a, b, straight:true, entityId, segment} | {kind:'diameter', center, radius, entityId} |
 *  {kind:'radius', center, radius, startAngle, endAngle, entityId}
 */
export function classifyPick(entity, point) {
 if (!entity || typeof entity !== 'object') throw Error('치수를 낼 객체가 없습니다.');
 if (!finitePoint(point)) throw Error('누른 점의 좌표가 올바르지 않습니다.');
 const id = entity.id ?? null;
 if (entity.type === 'circle' || entity.type === 'arc') {
  if (!finitePoint(entity.center) || !(entity.radius > 0) || !Number.isFinite(entity.radius)) throw Error('원·호의 중심 또는 반지름이 올바르지 않습니다.');
  if (entity.type === 'circle') return {kind: 'diameter', center: pt(entity.center), radius: entity.radius, entityId: id};
  if (!Number.isFinite(entity.startAngle) || !Number.isFinite(entity.endAngle)) throw Error('호의 각도가 올바르지 않습니다.');
  return {kind: 'radius', center: pt(entity.center), radius: entity.radius, startAngle: entity.startAngle, endAngle: entity.endAngle, entityId: id};
 }
 if (!['line', 'polyline', 'rectangle'].includes(entity.type)) throw Error(`스마트 치수는 선·폴리선·사각형·원·호를 고릅니다(${entity.type || '알 수 없는 객체'}).`);
 const {segment} = hitEntity(entity, point);
 if (segment < 0) throw Error(entity.type === 'line' ? '길이가 0인 선은 치수를 낼 수 없습니다.' : '길이가 있는 구간이 없는 폴리선입니다.');
 const [a, b] = straightSegments(entity)[segment];
 return {kind: 'linear', a: pt(a), b: pt(b), straight: true, entityId: id, segment};
}

/** 빈 곳에서 시작한 두 점 선형 사양. 각도 치수의 선으로는 쓰지 않는다. */
export function twoPointSpec(a, b) {
 if (!finitePoint(a) || !finitePoint(b)) throw Error('치수점 좌표가 올바르지 않습니다.');
 if (G.dist(a, b) < G.EPS) throw Error('두 치수점이 같습니다. 서로 다른 점을 지정하세요.');
 return {kind: 'linear', a: pt(a), b: pt(b), straight: false, entityId: null, segment: -1};
}

/**
 * 선형 치수 종류(AutoCAD DIM/DIMLINEAR 커서 규칙 + 기울어진 선의 정렬).
 *  축에 나란한 선은 그 축 그대로. 기울어진 선은 경계 상자 기준으로 위·아래로만 벗어나면 수평, 왼·오른쪽으로만 벗어나면 수직,
 *  상자 안(선에 수직으로 조금 뗀 곳)이면 정렬. 두 방향 모두 벗어난 모서리는 선 길이 범위(수직 띠) 안이면 정렬, 밖이면 더 많이 벗어난 쪽.
 *  AutoCAD 판정 순서(수직 띠를 먼저 봄)와 다른 곳과 그대로 둔 이유는 smart-dim-acad.test.js 머리말(ACAD200 516).
 */
export function linearMode(a, b, p) {
 const dx = b.x - a.x, dy = b.y - a.y, length = Math.hypot(dx, dy), flat = Math.max(length * 1e-9, G.EPS);
 if (Math.abs(dx) <= flat) return 'vertical';
 if (Math.abs(dy) <= flat) return 'horizontal';
 const loX = Math.min(a.x, b.x), hiX = Math.max(a.x, b.x), loY = Math.min(a.y, b.y), hiY = Math.max(a.y, b.y);
 const ex = p.x < loX ? loX - p.x : p.x > hiX ? p.x - hiX : 0, ey = p.y < loY ? loY - p.y : p.y > hiY ? p.y - hiY : 0;
 if (ey > 0 && !ex) return 'horizontal';
 if (ex > 0 && !ey) return 'vertical';
 if (!ex && !ey) return 'aligned';
 const t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / (length * length);
 if (t >= 0 && t <= 1) return 'aligned';
 return ey >= ex ? 'horizontal' : 'vertical';
}

/** 두 곧은 선 사양 → 각도 사양. 평행이면 거절. */
export function angularSpec(first, second) {
 if (first?.kind !== 'linear' || second?.kind !== 'linear' || !first.straight || !second.straight) throw Error('각도 치수는 곧은 선(또는 폴리선 구간) 두 개로 잽니다.');
 if (first.entityId != null && first.entityId === second.entityId && first.segment === second.segment) throw Error('같은 선을 두 번 골랐습니다. 다른 선을 고르세요.');
 const u1 = G.unit(G.sub(first.b, first.a)), u2 = G.unit(G.sub(second.b, second.a));
 if (Math.abs(G.cross(u1, u2)) < PARALLEL_SIN) throw Error('두 선이 평행해서 각도를 잴 수 없습니다.');
 const hit = G.lineIntersection(first.a, first.b, second.a, second.b);
 if (!hit || !finitePoint(hit.point)) throw Error('두 선의 교점을 구할 수 없습니다.');
 return {kind: 'angular', center: pt(hit.point), u1, u2, ends1: [pt(first.a), pt(first.b)], ends2: [pt(second.a), pt(second.b)], entityIds: [first.entityId, second.entityId]};
}

// 교점에서 dir 쪽으로 가장 먼 선 끝점. 없으면(교점이 선 밖) dir 방향의 임시 점. 실제 끝점을 쓰면 STRETCH 때 치수가 따라온다.
function rayPoint(center, ends, dir, fallback) {
 let best = null, far = 0;
 for (const e of ends) { const d = G.dot(G.sub(e, center), dir); if (d > far + G.EPS) { far = d; best = e; } }
 return best ? pt(best) : G.add(center, G.mul(dir, fallback));
}

/** 순수 생성: 사양 + 치수선(또는 호·방향) 위치 → 치수 객체(레이어·스타일 없음). */
export function buildSmartDimension(spec, placement) {
 if (!finitePoint(placement)) throw Error('치수선 위치 좌표가 올바르지 않습니다.');
 const p = pt(placement);
 switch (spec?.kind) {
  case 'linear': {
   const {a, b} = spec;
   if (!finitePoint(a) || !finitePoint(b) || G.dist(a, b) < G.EPS) throw Error('길이가 0인 구간은 치수를 낼 수 없습니다.');
   return {type: 'dimension', mode: spec.mode || linearMode(a, b, p), points: [pt(a), pt(b), p]};
  }
  case 'radius':
  case 'diameter': {
   const {center, radius} = spec;
   if (!finitePoint(center) || !(radius > 0)) throw Error('원·호의 중심 또는 반지름이 올바르지 않습니다.');
   const away = G.dist(p, center) > G.EPS;
   let direction = away ? G.angle(G.sub(p, center)) : spec.kind === 'radius' && Number.isFinite(spec.startAngle) ? arcMidAngle(spec) : 0;
   if (spec.kind === 'radius' && Number.isFinite(spec.startAngle) && Number.isFinite(spec.endAngle) && !G.angleOnArc(direction, spec.startAngle, spec.endAngle)) {
    // 호 바깥 방향이면 가까운 호 끝으로 붙인다(화살표가 호 위에 있도록).
    direction = G.normalizeAngle(spec.startAngle - direction) <= G.normalizeAngle(direction - spec.endAngle) ? spec.startAngle : spec.endAngle;
   }
   const onCurve = G.add(center, G.polar(radius, direction));
   return {type: 'dimension', mode: spec.kind, points: [pt(center), onCurve, away ? p : onCurve]};
  }
  case 'angular': {
   const {center, u1, u2} = spec, d = G.sub(p, center), reach = G.len(d);
   if (reach < G.EPS) throw Error('각도 치수 위치가 두 선의 교점과 같습니다. 재려는 사분면 쪽을 지정하세요.');
   const det = G.cross(u1, u2);
   if (Math.abs(det) < PARALLEL_SIN) throw Error('두 선이 평행해서 각도를 잴 수 없습니다.');
   // p = α·u1 + β·u2. α·β 의 부호가 p 를 감싸는 두 반직선(= 사분면)을 정한다.
   const alpha = G.cross(d, u2) / det, beta = G.cross(u1, d) / det;
   const r1 = G.mul(u1, alpha >= 0 ? 1 : -1), r2 = G.mul(u2, beta >= 0 ? 1 : -1);
   return {type: 'dimension', mode: 'angular', points: [pt(center), rayPoint(center, spec.ends1 || [], r1, reach), rayPoint(center, spec.ends2 || [], r2, reach), p]};
  }
  default: throw Error('알 수 없는 치수 사양입니다.');
 }
}

/** 치수에 찍힐 문자(geometry.js dimensionParts 그대로). */
export function dimensionText(dim) {
 return G.dimensionParts(dim).find(part => part.dimensionLabel)?.text ?? '';
}

/** 화면에 보이는(숨김·동결 레이어 제외) 치수 대상 객체. 잠긴 레이어의 객체도 잴 수는 있다. */
export function smartDimCandidates(entities, layers) {
 const map = Array.isArray(layers) ? new Map(layers.map(l => [l.id, l])) : null;
 const shown = e => { const l = map?.get(e.layer); return !l || (l.visible !== false && !l.frozen); };
 return (entities || []).filter(e => e && SMART_DIM_TYPES.includes(e.type) && !e.hidden && shown(e));
}

/**
 * 누른 점 → {kind:'object', entity, spec} | {kind:'point', reason:'empty'|'snap'}.
 * 객체 위(허용 거리 안)면 가장 가까운 것을 고른다. 단 점이 두 객체 위에 정확히 놓였거나(교차점·공유 끝점)
 * 객체의 끝점·중간점·사분점과 같으면 스냅으로 잡은 점이라 보고 점으로 돌려준다.
 */
export function findPickTarget(candidates, point, {tolerance = 0} = {}) {
 if (!finitePoint(point)) throw Error('누른 점의 좌표가 올바르지 않습니다.');
 const tol = Number.isFinite(tolerance) && tolerance > 0 ? tolerance : 0, exact = Math.max(tol * 1e-3, 1e-9);
 const hits = [];
 for (const entity of candidates || []) { const h = hitEntity(entity, point); if (h.distance <= tol) hits.push({entity, ...h}); }
 if (!hits.length) return {kind: 'point', reason: 'empty'};
 hits.sort((a, b) => a.distance - b.distance);
 const on = hits.filter(h => h.distance <= exact);
 if (on.length >= 2 || (on.length === 1 && snapKeyPoints(on[0].entity).some(k => G.dist(k, point) <= exact))) return {kind: 'point', reason: 'snap'};
 const best = hits[0];
 return {kind: 'object', entity: best.entity, spec: classifyPick(best.entity, point)};
}

function entityBox(e) {
 if (e.type === 'circle' || e.type === 'arc') return finitePoint(e.center) && Number.isFinite(e.radius) ? {minX: e.center.x - e.radius, minY: e.center.y - e.radius, maxX: e.center.x + e.radius, maxY: e.center.y + e.radius} : null;
 let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
 for (const p of e.points || []) if (finitePoint(p)) { if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x; if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y; }
 return minX === Infinity ? null : {minX, minY, maxX, maxY};
}
// 균일 격자 색인. geometry.js spatialIndex 는 20만 객체에서 만드는 데 수 초가 걸려(명령 시작이 멈춤) 이 명령에는 가벼운 격자를 쓴다.
// 여러 칸(64칸 초과)에 걸치는 긴 객체는 따로 두고 매번 본다.
function gridIndex(items) {
 let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
 for (const it of items) { minX = Math.min(minX, it.b.minX); minY = Math.min(minY, it.b.minY); maxX = Math.max(maxX, it.b.maxX); maxY = Math.max(maxY, it.b.maxY); }
 const perAxis = Math.max(1, Math.min(2048, Math.ceil(Math.sqrt(items.length)))), size = Math.max((maxX - minX) / perAxis, (maxY - minY) / perAxis, G.EPS);
 const cellX = x => Math.max(0, Math.min(perAxis, Math.floor((x - minX) / size))), cellY = y => Math.max(0, Math.min(perAxis, Math.floor((y - minY) / size)));
 const cells = new Map(), wide = [];
 for (const it of items) {
  const x0 = cellX(it.b.minX), x1 = cellX(it.b.maxX), y0 = cellY(it.b.minY), y1 = cellY(it.b.maxY);
  if ((x1 - x0 + 1) * (y1 - y0 + 1) > 64) { wide.push(it.e); continue; }
  for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) { const key = x * 4099 + y, list = cells.get(key); if (list) list.push(it.e); else cells.set(key, [it.e]); }
 }
 return box => {
  if (box.maxX < minX || box.minX > maxX || box.maxY < minY || box.minY > maxY) return wide;
  const found = new Set(wide), x0 = cellX(box.minX), x1 = cellX(box.maxX), y0 = cellY(box.minY), y1 = cellY(box.maxY);
  if ((x1 - x0 + 1) * (y1 - y0 + 1) > 4096) return items.map(it => it.e);   // 허용 거리가 도면만큼 크면 전부
  for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) for (const e of cells.get(x * 4099 + y) || []) found.add(e);
  return [...found];
 };
}

/** 명령 한 번 동안 쓰는 찾기. 큰 도면은 격자 색인으로 누른 점 주변만 본다(첫 질의 때 만든다). */
export function createTargetFinder(entities, layers) {
 const candidates = smartDimCandidates(entities, layers);
 let query = null;
 return (point, tolerance) => {
  if (!finitePoint(point)) throw Error('누른 점의 좌표가 올바르지 않습니다.');
  if (candidates.length > 256 && !query) query = gridIndex(candidates.map(e => ({e, b: entityBox(e)})).filter(it => it.b));
  const pool = query ? query({minX: point.x - tolerance, minY: point.y - tolerance, maxX: point.x + tolerance, maxY: point.y + tolerance}) : candidates;
  return findPickTarget(pool, point, {tolerance});
 };
}

/** 선형 사양의 치수선 위치를 누른 곳에 평행하지 않은 다른 곧은 선이 있으면 그 선의 사양(각도 치수용). */
export function secondLineAt(find, first, point, tolerance) {
 if (first?.kind !== 'linear' || !first.straight) return null;
 const target = find(point, tolerance);
 if (target.kind !== 'object' || target.spec.kind !== 'linear') return null;
 const spec = target.spec;
 if (spec.entityId != null && spec.entityId === first.entityId && spec.segment === first.segment) return null;
 const u1 = G.unit(G.sub(first.b, first.a)), u2 = G.unit(G.sub(spec.b, spec.a));
 return Math.abs(G.cross(u1, u2)) < PARALLEL_SIN ? null : spec;
}

// 미리보기용 강조: 고를 구간·원·호만 점선으로.
function highlight(target) {
 if (target.kind !== 'object') return [];
 const {spec, entity} = target;
 if (spec.kind === 'linear') return [{type: 'line', points: [spec.a, spec.b]}];
 if (entity.type === 'circle') return [{type: 'circle', center: pt(entity.center), radius: entity.radius}];
 return [{type: 'arc', center: pt(entity.center), radius: entity.radius, startAngle: entity.startAngle, endAngle: entity.endAngle}];
}

export function installSmartDim(ctx) {
 const tolerance = () => { const t = Number(ctx.tolerance?.()); return Number.isFinite(t) && t > 0 ? t : 1; };
 const styled = d => (ctx.styledDimension ? ctx.styledDimension(d) : {textHeight: 150, ...d});
 const preview = dimensionPreview;
 return {
  async DIMANGULAR() {
   const picked=await ctx.pickEntity({prompt:'호, 원, 선 선택 또는 <정점 지정>',types:['line','arc','circle','polyline'],allowNone:'vertex',withPoint:true});
   if(!picked)return null;
   const first=picked.entity||picked;
   let spec,make,lock=null;
   if(picked.option==='vertex'){
    const center=await ctx.pickPoint({prompt:'각도 정점 지정'});if(!center)return null;
    const a=await ctx.pickPoint({prompt:'첫 번째 각도 끝점 지정',preview:preview(c=>[{type:'line',points:[center,c]}])});if(!a)return null;
    const b=await ctx.pickPoint({prompt:'두 번째 각도 끝점 지정',preview:preview(c=>styled({type:'dimension',mode:'angular',points:[center,a,c,c]}))});if(!b)return null;
    spec={center};make=c=>({type:'dimension',mode:'angular',points:[pt(center),pt(a),pt(b),pt(c)]});
   }else if(first.type==='arc'){
    spec={center:pt(first.center)};make=c=>({type:'dimension',mode:'angular',points:[pt(first.center),...arcEnds(first),pt(c)]});
   }else if(first.type==='circle'){
    const center=pt(first.center),click=picked.point||G.add(center,{x:first.radius,y:0});
    if(G.dist(center,click)<=G.EPS)throw Error('원 위를 선택하세요.');
    const a=G.add(center,G.polar(first.radius,G.angle(G.sub(click,center))));
    const b=await ctx.pickPoint({prompt:'두 번째 각도 끝점 지정',preview:preview(c=>styled({type:'dimension',mode:'angular',points:[center,a,c,c]}))});if(!b)return null;
    spec={center};make=c=>({type:'dimension',mode:'angular',points:[center,a,pt(b),pt(c)]});
   }else{
    const secondPick=await ctx.pickEntity({prompt:'두 번째 선 선택',types:['line','polyline'],withPoint:true});if(!secondPick)return null;
    const second=secondPick.entity||secondPick;
    spec=angularSpec(classifyPick(first,picked.point||mid(...first.points.slice(0,2))),classifyPick(second,secondPick.point||mid(...second.points.slice(0,2))));
    make=c=>{const d=buildSmartDimension(spec,lock||c);d.points[3]=pt(c);return d;};
   }
   const entity=await pickDimensionPlacement(ctx,c=>{if(G.dist(spec.center,c)<=G.EPS)throw Error('치수 호 위치를 중심 밖에 지정하세요.');return styled({...make(c),...(lock?{quadrantPoint:pt(lock)}:{})});},{prompt:'치수 호의 위치 지정 또는 [여러 줄 문자(M)/문자(T)/각도(A)/사분점(Q)]',quadrant:p=>{lock=pt(p);}});
   if(!entity)return null;
   ctx.commit({entities:[entity]});return entity;
  },
  async DIMSMART() {
   const find = createTargetFinder(ctx.entities?.() || [], ctx.layers?.());
   const first = await ctx.pickPoint({
    prompt: 'DIMSMART · 치수 낼 선·폴리선·원·호 클릭, 또는 빈 곳·스냅 점을 첫 치수점으로 · Esc 취소',
    preview: preview(c => highlight(find(c, tolerance()))),
   });
   if (!first) return null;
   const target = find(first, tolerance());
   let spec, picks = null;
   if (target.kind === 'object') spec = target.spec;
   else {
    const second = await ctx.pickPoint({prompt: 'DIMSMART · 두 번째 치수점 · Esc 취소', preview: preview(c => [{type: 'line', points: [pt(first), c]}])});
    if (!second) return null;
    spec = twoPointSpec(first, second);picks = [first, second];
   }
   let dim;
   if (spec.kind === 'linear') {
    const other = c => (spec.straight ? secondLineAt(find, spec, c, tolerance()) : null);
    const placed = await pickDimensionPlacement(ctx,c=>{const line=other(c);return styled(buildSmartDimension(line?angularSpec(spec,line):spec,c));},{linear:true,prompt:'치수선 위치 지정 또는 [여러 줄 문자(M)/문자(T)/각도(A)/수평(H)/수직(V)/회전(R)]'});
    const place=placed?.points.at(-1);
    if (!place) return null;
    const line = other(place);
    if (line) {
     const angular = angularSpec(spec, line);
     const entity = await pickDimensionPlacement(ctx,c=>styled(buildSmartDimension(angular,c)),{prompt:'치수 호의 위치(재려는 사분면) 지정 또는 [여러 줄 문자(M)/문자(T)/각도(A)]'});
     if (!entity) return null;
     dim = entity;
    } else dim = placed;
   } else {
    dim=await pickDimensionPlacement(ctx,c=>styled(buildSmartDimension(spec,c)),{prompt:`${spec.kind==='diameter'?'지름':'반지름'} 치수선 위치 지정 또는 [여러 줄 문자(M)/문자(T)/각도(A)]`});
    if(!dim)return null;
   }
   let entity = styled(dim);
   // 연관 치수(ACAD200 513): 고른 선·원의 끝점·중심, 또는 스냅으로 집은 두 점이 객체의 특징점이면 그 객체를 따라가게 한다.
   if (entity.mode !== 'angular') {
    const all = ctx.entities?.() || [];
    const assoc = picks ? assocFromPicks(picks, lookupIn(all)) : assocFromSpec(spec, entity, all);
    if (assoc) entity = {...entity, assoc};
   }
   ctx.commit({entities: [entity]});
   ctx.toast?.(`${SMART_DIM_MODE_LABELS[entity.mode] || '치수'} ${dimensionText(entity)} · Ctrl+Z 로 되돌립니다. Space/Enter 로 다음 치수.`);
   return entity;
  },
 };
}
