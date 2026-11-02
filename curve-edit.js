/* 곡선 편집 공용(ACAD200 영역 4): 폴리선 호 구간(bulge)·경로 매개변수·자르기/연장/끊기/잇기/모깎기/간격띄우기.

   AutoCAD 는 폴리선 호를 정점의 bulge 하나로 저장하고 AcDbCurve 공통 함수(매개변수·쪼개기)로 모든 편집을 처리한다.
   바른 CAD 는 화면·스냅·출력이 이미 "점 목록" 위에서 빠르게 돌고 있으므로 그 길은 그대로 두고,
   폴리선에 `arcRuns:[[i,j],…]`(points[i]~points[j] 가 한 호를 잘게 나눈 점이라는 표시)만 덧붙인다.
     · 화면·선택·스냅: 지금처럼 점 목록(속도 그대로, 렌더러 손대지 않음).
     · 편집·DXF 저장: 표시가 맞는지(모든 점이 한 원 위·한 방향)를 확인한 뒤 정확한 호로 다룬다.
     · 누가 점을 하나 옮겨 표시가 틀어지면 그 구간은 조용히 직선 구간으로 본다 — 모양은 화면 그대로라 잃는 것이 없다.
   이동·회전·축척·대칭은 원을 원으로 보내므로 표시가 저절로 유지된다(변환 코드 수정 불필요).

   경로 매개변수 s = 구간 번호 + 구간 안 비율(직선은 길이 비율, 호는 각도 비율). 자르기·끊기·연장이 모두 이 s 하나로 동작한다. */
import * as G from './geometry.js';

const EPS = 1e-9, TAU = Math.PI * 2;
const pt = (p) => ({x: p.x, y: p.y});
const lerp = (a, b, t) => ({x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t});
const near = (a, b, tol = 1e-9) => Math.hypot(a.x - b.x, a.y - b.y) <= tol;
const rad = (deg) => deg * Math.PI / 180, deg = (r) => r * 180 / Math.PI;
const atan2 = (v) => Math.atan2(v.y, v.x);
/** a→b 방향으로 잰 각도 차(라디안)를 (-π, π] 로. */
const wrapPi = (x) => { x = ((x + Math.PI) % TAU + TAU) % TAU - Math.PI; return x <= -Math.PI ? x + TAU : x; };

/* ══════════ 408 · bulge(호 구간) ══════════ */
/** 중심각(도, 부호 = 반시계 +) → bulge. FILLET·OFFSET·REVCLOUD·JOIN 공용. */
export const bulgeOf = (sweepDeg) => Math.tan(sweepDeg * Math.PI / 720);
/** a→b 현과 bulge 로 호 정보(라디안). */
export function arcFromBulge(a, b, k) {
 const theta = 4 * Math.atan(k), chord = Math.hypot(b.x - a.x, b.y - a.y);
 if (chord < EPS || Math.abs(k) < 1e-12) return null;
 const n = {x: -(b.y - a.y) / chord, y: (b.x - a.x) / chord}, h = chord / 2 * (1 - k * k) / (2 * k);
 const center = {x: (a.x + b.x) / 2 + n.x * h, y: (a.y + b.y) / 2 + n.y * h};
 return {center, radius: chord / 2 * (1 + k * k) / (2 * Math.abs(k)), start: atan2({x: a.x - center.x, y: a.y - center.y}), sweep: theta};
}
/** 호를 나눌 조각 수: 5°마다 한 조각(2~72). 지금 FILLET 폴리선(10°)보다 곱다. */
const arcSteps = (sweep) => Math.max(2, Math.min(72, Math.ceil(Math.abs(deg(sweep)) / 5)));
const onCircle = (c, r, a) => ({x: c.x + r * Math.cos(a), y: c.y + r * Math.sin(a)});

/** bulge 정점 목록 → 화면용 점 목록 + arcRuns 표시. closed 면 마지막→처음 구간도 bulge 를 쓴다. */
export function fromBulgeVertices(vertices, closed = false) {
 const vs = vertices.filter((v, i) => i === 0 || !near(v, vertices[i - 1], 1e-9));
 if (closed && vs.length > 1 && near(vs[0], vs.at(-1), 1e-9)) vs.pop();
 const points = [], arcRuns = [], n = vs.length, count = closed ? n : n - 1;
 for (let i = 0; i < n; i++) {
  const v = vs[i]; points.push(pt(v));
  if (i >= count) continue;
  const b = vs[(i + 1) % n], arc = arcFromBulge(v, b, Number(v.bulge) || 0);
  if (!arc) continue;
  const steps = arcSteps(arc.sweep), start = points.length - 1;
  for (let s = 1; s < steps; s++) points.push(onCircle(arc.center, arc.radius, arc.start + arc.sweep * s / steps));
  arcRuns.push([start, points.length]); // 마지막 닫는 구간은 points.length = 0번 점(돌아감)
 }
 return arcRuns.length ? {points, arcRuns} : {points};
}

/** arcRuns 한 구간이 아직 정확한 호인지 확인하고 호 정보(라디안)를 돌려준다. 틀어졌으면 null. */
function verifyRun(points, i, j, closed) {
 const n = points.length, at = (k) => points[closed ? k % n : k];
 if (!(Number.isInteger(i) && Number.isInteger(j)) || i < 0 || j <= i + 1 || j > (closed ? n : n - 1)) return null;
 const a = at(i), m = at(Math.floor((i + j) / 2)), b = at(j);
 let arc; try { arc = G.arcThrough(a, m, b); } catch { return null; }
 const c = arc.center, r = arc.radius, tol = 1e-7 * Math.max(1, r);
 if (!(r > EPS) || !Number.isFinite(r)) return null;
 let sweep = 0, sign = 0;
 for (let k = i; k < j; k++) {
  const p = at(k), q = at(k + 1);
  if (Math.abs(Math.hypot(q.x - c.x, q.y - c.y) - r) > tol) return null;
  const d = wrapPi(atan2({x: q.x - c.x, y: q.y - c.y}) - atan2({x: p.x - c.x, y: p.y - c.y}));
  if (Math.abs(d) < 1e-12) return null;
  const s = Math.sign(d); if (sign && s !== sign) return null; sign = s; sweep += d;
 }
 if (Math.abs(sweep) >= TAU - 1e-9) return null;
 return {center: c, radius: r, start: atan2({x: a.x - c.x, y: a.y - c.y}), sweep};
}
/** 확인된 호 구간 목록 [{i,j,arc}] (서로 겹치지 않게 앞에서부터). */
export function verifiedArcRuns(e) {
 const ps = e?.points || [], closed = !!(e?.closed || e?.type === 'rectangle'), out = [];
 if (!Array.isArray(e?.arcRuns) || ps.length < 3) return out;
 let last = -1;
 for (const run of [...e.arcRuns].sort((x, y) => x[0] - y[0])) {
  const [i, j] = run || [];
  if (i < last) continue;
  const arc = verifyRun(ps, i, j, closed);
  if (arc) { out.push({i, j, arc}); last = j; }
 }
 return out;
}
/** 폴리선 → bulge 정점 경로 {v:[{x,y,bulge}], closed}. 선은 두 정점, 사각형은 닫힌 경로. */
export function toBPath(e) {
 if (e.type === 'line') return {v: e.points.map((p) => ({...pt(p), bulge: 0})), closed: false};
 if (!['polyline', 'rectangle'].includes(e.type)) throw Error('선·폴리선만 경로로 다룰 수 있습니다.');
 const ps = e.points || [], closed = !!(e.closed || e.type === 'rectangle'), n = ps.length;
 const runs = new Map(verifiedArcRuns(e).map((r) => [r.i, r])), v = [];
 for (let k = 0; k < n;) {
  const run = runs.get(k);
  if (run) { v.push({...pt(ps[k]), bulge: Math.tan(run.arc.sweep / 4)}); k = run.j; if (closed && k === n) break; continue; }
  v.push({...pt(ps[k]), bulge: 0}); k++;
 }
 return {v, closed};
}
/** 경로 구간 목록. 각 구간 {kind:'line'|'arc', a, b, center?, radius?, start?, sweep?}. */
export function bsegs(path) {
 const {v, closed} = path, n = v.length, out = [];
 for (let i = 0; i < (closed ? n : n - 1); i++) {
  const a = v[i], b = v[(i + 1) % n], arc = arcFromBulge(a, b, Number(a.bulge) || 0);
  out.push(arc ? {kind: 'arc', a: pt(a), b: pt(b), ...arc} : {kind: 'line', a: pt(a), b: pt(b)});
 }
 return out;
}
/** 408: bulge 를 아는 경로 조각(선·호) — 스펙의 pathParts. */
export function pathParts(e) { return bsegs(toBPath(e)).map((s) => s.kind === 'arc' ? {...s, startAngle: deg(s.start), sweepDeg: deg(s.sweep)} : s); }
/** DXF·PEDIT 용: 폴리선의 정점+bulge (호 구간은 정점 하나로 줄어든다). */
export function polylineBulges(e) { return toBPath(e); }

/* ══════════ 경로 매개변수 ══════════ */
const segPoint = (s, f) => s.kind === 'arc' ? onCircle(s.center, s.radius, s.start + s.sweep * f) : lerp(s.a, s.b, f);
const segLength = (s) => s.kind === 'arc' ? Math.abs(s.sweep) * s.radius : Math.hypot(s.b.x - s.a.x, s.b.y - s.a.y);
/** 호 위 점의 각도 비율(호 방향으로 잰 값; 0~1 밖이면 호 바깥). */
function arcFraction(s, p) {
 const d = atan2({x: p.x - s.center.x, y: p.y - s.center.y}) - s.start;
 let f = (s.sweep > 0 ? ((d % TAU) + TAU) % TAU : -((((-d) % TAU) + TAU) % TAU)) / s.sweep;
 if (f > 1 + 1e-9) { const back = f - TAU / Math.abs(s.sweep); if (Math.abs(back) < f - 1) f = back; }
 return f;
}
function segNearest(s, p) {
 if (s.kind === 'line') {
  const v = {x: s.b.x - s.a.x, y: s.b.y - s.a.y}, L = v.x * v.x + v.y * v.y;
  const f = L < EPS ? 0 : Math.max(0, Math.min(1, ((p.x - s.a.x) * v.x + (p.y - s.a.y) * v.y) / L));
  return {f, d: Math.hypot(p.x - s.a.x - v.x * f, p.y - s.a.y - v.y * f)};
 }
 let f = arcFraction(s, p);
 if (f < 0 || f > 1) f = Math.hypot(p.x - s.a.x, p.y - s.a.y) <= Math.hypot(p.x - s.b.x, p.y - s.b.y) ? 0 : 1;
 const q = segPoint(s, f);
 return {f, d: Math.hypot(p.x - q.x, p.y - q.y)};
}
export function pathParam(segs, p) {
 let best = 0, bestD = Infinity;
 segs.forEach((s, i) => { const r = segNearest(s, p); if (r.d < bestD - 1e-12) { bestD = r.d; best = i + r.f; } });
 return best;
}
export function pathPoint(segs, s) {
 const n = segs.length, i = Math.min(Math.max(0, Math.floor(s)), n - 1);
 return segPoint(segs[i], s - i);
}
export function pathLength(e) {
 if (e.type === 'arc') return e.radius * rad(G.normalizeAngle(e.endAngle - e.startAngle) || 360);
 if (e.type === 'circle') return TAU * e.radius;
 if (e.type === 'ellipse') { const ps = G.ellipsePoints(e, 512); let L = 0; for (let i = 1; i < ps.length; i++) L += G.dist(ps[i - 1], ps[i]); return L; }
 return bsegs(toBPath(e)).reduce((sum, s) => sum + segLength(s), 0);
}

/* ══════════ 경계 원소와 교차 ══════════ */
/** 경계 객체 → 원소 {kind:'line',a,b} | {kind:'arc',center,radius,start,sweep}. 타원은 256 조각 선(1단계). */
export function boundaryPrims(e, out = []) {
 if (!e) return out;
 if (['block', 'dimension', 'wall'].includes(e.type)) { for (const p of G.primitives(e)) boundaryPrims(p, out); return out; }
 if (e.type === 'circle') { out.push({kind: 'arc', center: e.center, radius: e.radius, start: 0, sweep: TAU}); return out; }
 if (e.type === 'arc') { out.push({kind: 'arc', center: e.center, radius: e.radius, start: rad(e.startAngle), sweep: rad(G.normalizeAngle(e.endAngle - e.startAngle) || 360)}); return out; }
 if (e.type === 'ellipse') { const ps = G.ellipsePoints(e, 256); for (let i = 1; i < ps.length; i++) out.push({kind: 'line', a: ps[i - 1], b: ps[i]}); return out; }
 if ((e.type === 'polyline' || e.type === 'rectangle') && Array.isArray(e.arcRuns)) { for (const s of bsegs(toBPath(e))) out.push(s); return out; }
 for (const [a, b] of G.segments(e)) out.push({kind: 'line', a, b});
 return out;
}
const primBox = (p) => p.kind === 'line'
 ? {minX: Math.min(p.a.x, p.b.x), minY: Math.min(p.a.y, p.b.y), maxX: Math.max(p.a.x, p.b.x), maxY: Math.max(p.a.y, p.b.y)}
 : {minX: p.center.x - p.radius, minY: p.center.y - p.radius, maxX: p.center.x + p.radius, maxY: p.center.y + p.radius};
const boxesMeet = (a, b, pad = 0) => a.minX <= b.maxX + pad && b.minX <= a.maxX + pad && a.minY <= b.maxY + pad && b.minY <= a.maxY + pad;
/** 원 위 점의 각도 비율(전체 원은 항상 0~1). */
const primFraction = (p, q) => p.kind === 'line' ? null : Math.abs(p.sweep) >= TAU - 1e-12 ? 0.5 : arcFraction(p, q);
const inUnit = (f, tol = 1e-9) => f >= -tol && f <= 1 + tol;
/** 원소 P(편집 대상 구간)와 Q(경계)의 교차: [{f(P 위 비율, 선은 무한 연장 값 포함), point}] — Q 위에 있는 것만. */
export function primHits(P, Q) {
 const out = [];
 const onQ = (q) => Q.kind === 'line' ? true : inUnit(primFraction(Q, q), 1e-9);
 if (P.kind === 'line' && Q.kind === 'line') {
  const h = G.lineIntersection(P.a, P.b, Q.a, Q.b);
  if (h && h.u >= -1e-9 && h.u <= 1 + 1e-9) out.push({f: h.t, point: h.point});
  return out;
 }
 if (P.kind === 'line') {
  const v = {x: P.b.x - P.a.x, y: P.b.y - P.a.y}, z = {x: P.a.x - Q.center.x, y: P.a.y - Q.center.y};
  const A = v.x * v.x + v.y * v.y, B = 2 * (z.x * v.x + z.y * v.y), C = z.x * z.x + z.y * z.y - Q.radius ** 2, disc = B * B - 4 * A * C;
  if (A < EPS || disc < -1e-9 * A * Q.radius ** 2) return out;
  for (const t of disc <= 0 ? [-B / (2 * A)] : [(-B - Math.sqrt(disc)) / (2 * A), (-B + Math.sqrt(disc)) / (2 * A)]) { const q = lerp(P.a, P.b, t); if (onQ(q)) out.push({f: t, point: q}); }
  return out;
 }
 // P 는 호: Q 와 만나는 점을 구한 뒤 P 위 각도 비율로.
 let points = [];
 if (Q.kind === 'line') { for (const h of primHits(Q, {...P, sweep: TAU, start: 0})) if (inUnit(h.f)) points.push(h.point); }
 else {
  const v = {x: Q.center.x - P.center.x, y: Q.center.y - P.center.y}, d = Math.hypot(v.x, v.y);
  if (d < EPS || d > P.radius + Q.radius + 1e-9 || d < Math.abs(P.radius - Q.radius) - 1e-9) return out;
  const x = (P.radius ** 2 - Q.radius ** 2 + d * d) / (2 * d), h = Math.sqrt(Math.max(0, P.radius ** 2 - x * x)), u = {x: v.x / d, y: v.y / d};
  const base = {x: P.center.x + u.x * x, y: P.center.y + u.y * x};
  points = h < 1e-12 ? [base] : [{x: base.x - u.y * h, y: base.y + u.x * h}, {x: base.x + u.y * h, y: base.y - u.x * h}];
  points = points.filter(onQ);
 }
 for (const q of points) out.push({f: arcFraction(P, q), point: q});
 return out;
}
const dedupe = (values, tol = 1e-9) => { const sorted = [...values].sort((a, b) => a - b), out = []; for (const v of sorted) if (!out.length || v - out.at(-1) > tol) out.push(v); return out; };
/** 경로 위 경계 교차점의 s 목록(구간 안쪽만). */
function pathHits(segs, prims) {
 const hits = [];
 segs.forEach((s, i) => {
  const box = primBox(s);
  for (const q of prims) {
   if (!boxesMeet(box, primBox(q), 1e-6)) continue;
   for (const h of primHits(s, q)) if (inUnit(h.f)) hits.push(i + Math.max(0, Math.min(1, h.f)));
  }
 });
 return dedupe(hits);
}

/* ══════════ 경로 조각 만들기 ══════════ */
/** 경로 s0~s1 (닫힌 경로는 s1 이 s0 보다 작으면 한 바퀴 돌아서) 의 bulge 정점 목록. */
function subPath(segs, s0, s1, closed) {
 const n = segs.length;
 if (closed && s1 <= s0 + 1e-12) s1 += n;
 const verts = [];
 let k = Math.floor(s0), f = s0 - k;
 if (k >= n && !closed) { k = n - 1; f = 1; }
 for (let guard = 0; guard <= 2 * n + 2; guard++) {
  const seg = segs[((k % n) + n) % n], end = Math.min(1, s1 - k);
  if (end - f > 1e-12) verts.push({...segPoint(seg, f), bulge: seg.kind === 'arc' ? Math.tan(seg.sweep * (end - f) / 4) : 0});
  if (s1 - k <= 1 + 1e-12) { verts.push({...segPoint(seg, end), bulge: 0}); break; }
  k++; f = 0;
 }
 return verts.length >= 2 ? verts : [];
}
/** 원본의 레이어·색·선종류는 두고, 모양과 호 표시만 새로. 스플라인 맞춤점은 조각에 맞지 않으므로 버린다. */
function pathEntity(target, verts, closed = false) {
 const {id, arcRuns, spline, type, points, ...rest} = target;
 const made = fromBulgeVertices(verts, closed);
 if (made.points.length === 2 && !made.arcRuns && !closed && type === 'line') return {...rest, type: 'line', points: made.points};
 return {...rest, type: 'polyline', closed, ...made};
}

/* ══════════ 402 · TRIM/EXTEND 모든 곡선 ══════════ */
/** 경계 객체 목록을 원소로 펴서 cutEntity·cutLine 이 받는 객체로(타원·호 폴리선 포함). */
function boundaryEntities(boundaries) {
 return boundaries.flatMap((b) => b.type === 'ellipse' ? [{type: 'polyline', points: G.ellipsePoints(b, 256), layer: b.layer}] : [b]);
}
/** TRIM: 선·원·호(기존 정확 계산) + 폴리선·사각형·타원(경로 매개변수). 결과 조각 0~2개. */
export function cutPath(target, boundaries, pick) {
 if (target.type === 'line' || target.type === 'circle' || target.type === 'arc') return G.cutEntity(target, boundaryEntities(boundaries), pick, false);
 if (target.type === 'ellipse') return cutEllipse(target, boundaries, pick);
 if (!['polyline', 'rectangle'].includes(target.type)) throw Error('선·폴리선·원·호·타원을 선택하세요.');
 const path = toBPath(target), segs = bsegs(path), n = segs.length;
 const prims = boundaries.flatMap((b) => boundaryPrims(b));
 const raw = pathHits(segs, prims), s = pathParam(segs, pick);
 if (!path.closed) {
  const hits = raw.filter((x) => x > 1e-9 && x < n - 1e-9), lo = hits.filter((x) => x < s - 1e-12).at(-1), hi = hits.find((x) => x > s + 1e-12);
  if (lo === undefined && hi === undefined) throw Error('대상 폴리선 위에 경계 교차점이 없습니다.');
  const out = [];
  if (lo !== undefined) out.push(pathEntity(target, subPath(segs, 0, lo, false)));
  if (hi !== undefined) out.push(pathEntity(target, subPath(segs, hi, n, false)));
  return out.filter((e) => e.points.length >= 2);
 }
 const hits = dedupe(raw.map((x) => (x % n + n) % n).map((x) => (n - x < 1e-9 ? 0 : x)));
 if (!hits.length) throw Error('닫힌 폴리선 위에 경계 교차점이 없습니다.');
 if (hits.length < 2) throw Error('닫힌 폴리선을 자르려면 경계와 두 번 이상 만나야 합니다.');
 const lo = hits.filter((x) => x < s).at(-1) ?? hits.at(-1), hi = hits.find((x) => x > s) ?? hits[0];
 return [pathEntity(target, subPath(segs, hi, lo, true))];
}
/** EXTEND: 선·호(기존) + 열린 폴리선의 첫/끝 직선 구간. */
export function extendPath(target, boundaries, pick) {
 if (target.type === 'line' || target.type === 'arc') return G.cutEntity(target, boundaryEntities(boundaries), pick, true);
 if (target.type !== 'polyline' || target.closed) throw Error('연장은 선·호·열린 폴리선에 됩니다.');
 const path = toBPath(target), segs = bsegs(path), n = segs.length;
 const atStart = G.dist(pick, segs[0].a) < G.dist(pick, segs[n - 1].b);
 const seg = atStart ? segs[0] : segs[n - 1];
 if (seg.kind !== 'line') throw Error('호로 끝나는 폴리선 끝은 아직 연장할 수 없습니다. 끝 구간을 직선으로 바꾸세요.');
 const prims = boundaries.flatMap((b) => boundaryPrims(b));
 let best = null;
 for (const q of prims) for (const h of primHits(seg, q)) {
  const beyond = atStart ? -h.f : h.f - 1;
  if (beyond > 1e-9 && (!best || beyond < best.beyond)) best = {beyond, point: h.point};
 }
 if (!best) throw Error('연장 방향에서 경계를 찾지 못했습니다.');
 const v = path.v.map((x) => ({...x}));
 if (atStart) v[0] = {...v[0], ...pt(best.point)}; else v[v.length - 1] = {...v.at(-1), ...pt(best.point)};
 return [pathEntity(target, v, false)];
}

/* ── 타원: 점 목록으로 교차를 찾고 실제 타원 위에서 이분법으로 다듬는다 ── */
const ellipseAt = (e, t) => { const a = e.majorAxis, b = G.mul(G.normal(a), e.ratio); return G.add(e.center, G.add(G.mul(a, Math.cos(t)), G.mul(b, Math.sin(t)))); };
export function ellipseParam(e, p) {
 const L = G.len(e.majorAxis), u = G.mul(e.majorAxis, 1 / L), v = G.sub(p, e.center);
 return Math.atan2(G.cross(u, v) / (L * e.ratio), G.dot(v, u) / L);
}
function ellipseRange(e) { const s = e.startParam || 0, end = e.endParam ?? TAU; let sweep = ((end - s) % TAU + TAU) % TAU; if (sweep < 1e-12) sweep = TAU; return {s, sweep}; }
const ellipseFrac = (e, t) => { const {s, sweep} = ellipseRange(e); return (((t - s) % TAU + TAU) % TAU) / sweep; };
function ellipseHits(e, prims) {
 const {s, sweep} = ellipseRange(e), N = 512, out = [];
 const g = (q, t) => { const p = ellipseAt(e, t); return q.kind === 'line' ? G.cross(G.sub(q.b, q.a), G.sub(p, q.a)) : Math.hypot(p.x - q.center.x, p.y - q.center.y) - q.radius; };
 for (const q of prims) for (let k = 0; k < N; k++) {
  let t0 = s + sweep * k / N, t1 = s + sweep * (k + 1) / N, g0 = g(q, t0), g1 = g(q, t1);
  if (g0 === 0) { if (onPrim(q, ellipseAt(e, t0))) out.push(t0); continue; }
  if (g0 * g1 > 0) continue;
  for (let it = 0; it < 60; it++) { const tm = (t0 + t1) / 2, gm = g(q, tm); if (g0 * gm <= 0) { t1 = tm; g1 = gm; } else { t0 = tm; g0 = gm; } }
  const t = (t0 + t1) / 2; if (onPrim(q, ellipseAt(e, t))) out.push(t);
 }
 return dedupe(out.map((t) => ellipseFrac(e, t)).filter((f) => f >= -1e-12 && f <= 1 + 1e-12), 1e-9);
}
function onPrim(q, p) {
 if (q.kind === 'line') { const v = G.sub(q.b, q.a), L = G.dot(v, v); const u = L < EPS ? 0 : G.dot(G.sub(p, q.a), v) / L; return u >= -1e-9 && u <= 1 + 1e-9; }
 return inUnit(primFraction(q, p));
}
function cutEllipse(target, boundaries, pick) {
 const {s, sweep} = ellipseRange(target), full = sweep >= TAU - 1e-12;
 const prims = boundaries.flatMap((b) => boundaryPrims(b)), fs = ellipseHits(target, prims), fp = ellipseFrac(target, ellipseParam(target, pick));
 const make = (f0, f1) => ({...target, startParam: s + sweep * f0, endParam: s + sweep * f1});
 const strip = ({id, ...rest}) => rest;
 if (full) {
  const hits = dedupe(fs.map((f) => f % 1));
  if (!hits.length) throw Error('타원 위에 경계 교차점이 없습니다.');
  if (hits.length < 2) throw Error('닫힌 타원을 자르려면 경계와 두 번 이상 만나야 합니다.');
  const lo = hits.filter((f) => f < fp).at(-1) ?? hits.at(-1), hi = hits.find((f) => f > fp) ?? hits[0];
  return [strip(make(hi, hi < lo ? lo : lo + 1))];
 }
 const inner = fs.filter((f) => f > 1e-9 && f < 1 - 1e-9), lo = inner.filter((f) => f < fp).at(-1), hi = inner.find((f) => f > fp);
 if (lo === undefined && hi === undefined) throw Error('타원 호 위에 경계 교차점이 없습니다.');
 return [...(lo !== undefined ? [strip(make(0, lo))] : []), ...(hi !== undefined ? [strip(make(hi, 1))] : [])];
}

/* ══════════ 406 · BREAK / BREAKATPOINT 모든 곡선 ══════════ */
/** a==b(가까움)이면 한 점에서 둘로 나눈다. 원은 a→b 반시계 구간을 지운다(AutoCAD). 결과 조각 목록. */
export function breakPath(e, a, b) {
 const same = G.dist(a, b) < 1e-9;
 if (e.type === 'circle' || e.type === 'arc') {
  const ang = (p) => G.normalizeAngle(G.angle(G.sub(p, e.center))), A = ang(a), B = ang(b);
  if (e.type === 'circle') {
   if (same) throw Error('원은 한 점에서 끊을 수 없습니다. 두 점을 지정하세요.');
   return [{...e, type: 'arc', startAngle: B, endAngle: A}];
  }
  const start = e.startAngle, sweep = G.normalizeAngle(e.endAngle - start) || 360;
  const rel = (x) => { const r = G.normalizeAngle(x - start); return r <= sweep + 1e-9 ? Math.min(r, sweep) : (r - sweep < 360 - r ? sweep : 0); };
  const [r0, r1] = [rel(A), rel(B)].sort((x, y) => x - y), out = [];
  if (same) { if (r0 <= 1e-9 || r0 >= sweep - 1e-9) throw Error('호의 끝점에서는 나눌 수 없습니다.'); return [{...e, endAngle: G.normalizeAngle(start + r0)}, {...e, startAngle: G.normalizeAngle(start + r0)}]; }
  if (r0 > 1e-9) out.push({...e, endAngle: G.normalizeAngle(start + r0)});
  if (r1 < sweep - 1e-9) out.push({...e, startAngle: G.normalizeAngle(start + r1)});
  return out;
 }
 if (e.type === 'ellipse') {
  const {s, sweep} = ellipseRange(e), full = sweep >= TAU - 1e-12, fa = ellipseFrac(e, ellipseParam(e, a)), fb = ellipseFrac(e, ellipseParam(e, b));
  const make = (f0, f1) => ({...e, startParam: s + sweep * f0, endParam: s + sweep * f1});
  if (full) { if (same) throw Error('닫힌 타원은 한 점에서 끊을 수 없습니다. 두 점을 지정하세요.'); return [make(fb, fb < fa ? fa : fa + 1)]; }
  const [f0, f1] = [Math.min(1, fa), Math.min(1, fb)].sort((x, y) => x - y), out = [];
  if (same) { if (f0 <= 1e-9 || f0 >= 1 - 1e-9) throw Error('타원 호의 끝점에서는 나눌 수 없습니다.'); return [make(0, f0), make(f0, 1)]; }
  if (f0 > 1e-9) out.push(make(0, f0)); if (f1 < 1 - 1e-9) out.push(make(f1, 1));
  return out;
 }
 if (!['line', 'polyline', 'rectangle'].includes(e.type)) throw Error('선·폴리선·원·호·타원을 선택하세요.');
 const path = toBPath(e), segs = bsegs(path), n = segs.length;
 const sa = pathParam(segs, a), sb = pathParam(segs, b);
 if (path.closed) {
  if (same) return [pathEntity(e, subPath(segs, sa, sa + n, false), false)];
  return [pathEntity(e, subPath(segs, sb, sa, true), false)];
 }
 const [s0, s1] = [sa, sb].sort((x, y) => x - y);
 if (same) {
  if (s0 <= 1e-9 || s0 >= n - 1e-9) throw Error('끝점에서는 나눌 수 없습니다.');
  return [pathEntity(e, subPath(segs, 0, s0, false)), pathEntity(e, subPath(segs, s0, n, false))];
 }
 const out = [];
 if (s0 > 1e-9) out.push(pathEntity(e, subPath(segs, 0, s0, false)));
 if (s1 < n - 1e-9) out.push(pathEntity(e, subPath(segs, s1, n, false)));
 return out;
}

/** 원 위 각도 구간 [{s,w}](도)을 겹친 것끼리 묶는다(OVERKILL 호 합치기·JOIN 호 공용). touch 면 끝끼리 닿은 것도 잇는다.
    0° 를 건너는 묶음은 하나로 합친다. 돌려주는 값 [{from,to,items}] — to-from ≥ 360 이면 한 바퀴. */
export function mergeCircularSpans(spans, {gap = 1e-9, touch = false} = {}) {
 const joins = (next, hi) => (touch ? next <= hi + gap : next < hi - gap), groups = [];
 for (const x of [...spans].sort((a, b) => a.s - b.s)) {
  const g = groups.at(-1);
  if (g && joins(x.s, g.to)) { g.items.push(x); g.to = Math.max(g.to, x.s + x.w); }
  else groups.push({from: x.s, to: x.s + x.w, items: [x]});
 }
 if (groups.length > 1) {
  const first = groups[0], last = groups.at(-1);
  if (joins(first.from + 360, last.to)) { first.items = [...last.items, ...first.items]; first.to = Math.max(first.to, last.to - 360); first.from = last.from - 360; groups.pop(); }
 }
 return groups;
}
/* ══════════ 407 · JOIN 결과 종류 자동 판단 + 허용 거리 ══════════ */
const reversePath = (v) => { const n = v.length; return v.map((_, j) => ({...pt(v[n - 1 - j]), bulge: j < n - 1 ? -(Number(v[n - 2 - j].bulge) || 0) : 0})); };
function asPath(e) {
 if (e.type === 'arc') {
  const sweep = G.normalizeAngle(e.endAngle - e.startAngle) || 360;
  return {v: [{...G.add(e.center, G.polar(e.radius, e.startAngle)), bulge: bulgeOf(sweep)}, {...G.add(e.center, G.polar(e.radius, e.endAngle)), bulge: 0}], closed: false};
 }
 if (e.type === 'line' || (e.type === 'polyline' && !e.closed)) return toBPath(e);
 return null;
}
/**
 * AutoCAD joinEntitiesAutomatically 순서: 같은 원 위 호 → 호/원, 한 직선 위 선 → 선, 그 밖 → 폴리선(호는 bulge 구간 그대로).
 * 끝점 격자 색인으로 사슬을 찾아 O(n). 허용 거리 안이면 두 끝의 가운데에서 잇는다.
 * @returns {made:[객체], used:[id], left:number, reason?}
 */
export function joinAuto(targets, tol = 0.001) {
 const t = Math.max(1e-9, Number(tol) || 0.001);
 if (targets.length >= 2 && targets.every((e) => e.type === 'arc')) {
  const c = targets[0].center, r = targets[0].radius;
  if (targets.every((e) => G.dist(e.center, c) <= t && Math.abs(e.radius - r) <= t)) {
   const gap = deg(t / r) + 1e-9, groups = mergeCircularSpans(targets.map((e) => ({s: G.normalizeAngle(e.startAngle), w: G.normalizeAngle(e.endAngle - e.startAngle) || 360})), {gap, touch: true});
   if (groups.length === 1) {
    const g = groups[0], {id, ...base} = targets[0], {startAngle, endAngle, ...plain} = base;
    const made = g.to - g.from >= 360 - gap ? {...plain, type: 'circle'} : {...base, startAngle: G.normalizeAngle(g.from), endAngle: G.normalizeAngle(g.to)};
    return {made: [made], used: targets.map((e) => e.id), left: 0, kind: made.type};
   }
  }
 }
 if (targets.length >= 2 && targets.every((e) => e.type === 'line')) {
  const [a0, a1] = targets[0].points, u = G.unit(G.sub(a1, a0));
  const off = (p) => Math.abs(G.cross(u, G.sub(p, a0)));
  if (targets.every((e) => e.points.every((p) => off(p) <= t))) {
   const ts = targets.flatMap((e) => e.points.map((p) => G.dot(G.sub(p, a0), u)));
   const {id, ...base} = targets[0];
   return {made: [{...base, points: [G.add(a0, G.mul(u, Math.min(...ts))), G.add(a0, G.mul(u, Math.max(...ts)))]}], used: targets.map((e) => e.id), left: 0, kind: 'line'};
  }
 }
 const items = targets.map((e) => ({e, path: asPath(e)})).filter((x) => x.path && x.path.v.length >= 2);
 const cell = Math.max(t, 1e-6), grid = new Map(), key = (p) => `${Math.floor(p.x / cell)}|${Math.floor(p.y / cell)}`;
 items.forEach((x, i) => { for (const end of [0, 1]) { const p = end ? x.path.v.at(-1) : x.path.v[0], k = key(p); (grid.get(k) || grid.set(k, []).get(k)).push({i, end}); } });
 const findNear = (p, used) => {
  const cx = Math.floor(p.x / cell), cy = Math.floor(p.y / cell);
  let best = null;
  for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (const h of grid.get(`${cx + dx}|${cy + dy}`) || []) {
   if (used.has(h.i)) continue;
   const q = h.end ? items[h.i].path.v.at(-1) : items[h.i].path.v[0], d = G.dist(p, q);
   if (d <= t && (!best || d < best.d)) best = {...h, d};
  }
  return best;
 };
 const used = new Set(), made = [], usedIds = [];
 for (let i = 0; i < items.length; i++) {
  if (used.has(i)) continue;
  used.add(i);
  let v = items[i].path.v.map((x) => ({...x})), members = [i];
  for (let grow = true; grow;) {
   grow = false;
   const tail = findNear(v.at(-1), used);
   if (tail) { used.add(tail.i); members.push(tail.i); let w = items[tail.i].path.v; if (tail.end === 1) w = reversePath(w); const joint = lerp(v.at(-1), w[0], .5); v[v.length - 1] = {...v.at(-1), ...joint, bulge: w[0].bulge}; v.push(...w.slice(1).map((x) => ({...x}))); grow = true; continue; }
   const head = findNear(v[0], used);
   if (head) { used.add(head.i); members.push(head.i); let w = items[head.i].path.v; if (head.end === 0) w = reversePath(w); const joint = lerp(w.at(-1), v[0], .5); v = [...w.slice(0, -1).map((x) => ({...x})), {...v[0], ...joint}, ...v.slice(1)]; grow = true; }
  }
  if (members.length < 2) continue;
  let closed = false;
  if (v.length > 2 && G.dist(v[0], v.at(-1)) <= t) { const joint = lerp(v[0], v.at(-1), .5); v[0] = {...v[0], ...joint}; v.pop(); closed = true; }
  const first = items[members[0]].e, {id, arcRuns, spline, points, startAngle, endAngle, center, radius, ...base} = first;
  made.push({...base, type: 'polyline', closed, ...fromBulgeVertices(v, closed)});
  for (const m of members) usedIds.push(items[m].e.id);
 }
 return {made, used: usedIds, left: targets.length - usedIds.length, kind: 'polyline'};
}

/** 무한 직선·온 원으로 본 두 원소의 교점(모깎기·간격띄우기 모서리 계산용). */
function curveHits(X, Y) {
 const unb = (Z) => (Z.kind === 'line' ? Z : {...Z, start: 0, sweep: TAU});
 if (X.kind === 'line' && Y.kind === 'line') { const h = G.lineIntersection(X.a, X.b, Y.a, Y.b); return h ? [h.point] : []; }
 if (X.kind === 'line') return primHits(X, unb(Y)).map((h) => h.point);
 if (Y.kind === 'line') return primHits(Y, unb(X)).map((h) => h.point);
 return primHits(unb(X), unb(Y)).map((h) => h.point);
}
/* ══════════ 403 · FILLET/CHAMFER 객체 짝 표 ══════════ */
const isParallel = (a, b) => Math.abs(G.cross(G.unit(G.sub(a.points[1], a.points[0])), G.unit(G.sub(b.points[1], b.points[0])))) < 1e-9;
/** AutoCAD 처럼 평행한 두 선은 반지름과 상관없이 간격의 반원으로 잇는다. 둘째 선 끝은 첫째 선 끝 높이로 맞춘다. */
export function filletParallel(a, b, picks = []) {
 const u = G.unit(G.sub(a.points[1], a.points[0]));
 const offsetAB = G.cross(u, G.sub(b.points[0], a.points[0]));
 if (Math.abs(offsetAB) < 1e-9) throw Error('한 직선 위의 두 선은 모깎을 수 없습니다.');
 const endOf = (e, p) => (p && G.dist(e.points[0], p) < G.dist(e.points[1], p) ? 0 : 1);
 // 첫째 선의 "찍은 쪽" 끝 — 찍은 점이 없으면 둘째 선과 같은 방향의 끝.
 const ia = picks[0] ? endOf(a, picks[0]) : 1, pa = a.points[ia];
 const tb = G.dot(G.sub(pa, b.points[0]), u), pb = G.add(b.points[0], G.mul(u, tb));
 const bEnd = picks[1] ? endOf(b, picks[1]) : (G.dist(b.points[0], pb) < G.dist(b.points[1], pb) ? 0 : 1);
 const nb = {...b, points: b.points.map((p, i) => (i === bEnd ? pb : p))};
 if (G.dist(nb.points[0], nb.points[1]) < 1e-9) throw Error('둘째 선이 없어지게 됩니다. 다른 끝을 고르세요.');
 const center = G.mul(G.add(pa, pb), .5), r = G.dist(pa, pb) / 2;
 const outward = G.unit(G.sub(pa, a.points[1 - ia])), mid = G.add(center, G.mul(outward, r));
 const s = G.angle(G.sub(pa, center)), e = G.angle(G.sub(pb, center)), m = G.angle(G.sub(mid, center));
 const [startAngle, endAngle] = G.angleOnArc(m, s, e) ? [s, e] : [e, s];
 return [{...a}, nb, {type: 'arc', layer: a.layer, center, radius: r, startAngle: G.normalizeAngle(startAngle), endAngle: G.normalizeAngle(endAngle)}];
}
const curveOf = (e) => e.type === 'line' ? {kind: 'line', a: e.points[0], b: e.points[1]} : {kind: 'arc', center: e.center, radius: e.radius, start: 0, sweep: TAU};
/** 선 끝을 T 로 자르거나 늘린다: 찍은 쪽을 남긴다. */
function trimLineTo(line, T, pick) {
 const [p0, p1] = line.points, v = G.sub(p1, p0), L = G.dot(v, v), at = (p) => G.dot(G.sub(p, p0), v) / L, tT = at(T);
 let keep;
 if (tT > 1e-9 && tT < 1 - 1e-9) keep = pick && at(pick) < tT ? p0 : p1;
 else keep = Math.abs(tT) < Math.abs(tT - 1) ? p1 : p0;
 if (G.dist(keep, T) < 1e-9) throw Error('모서리 크기가 남길 선보다 큽니다.');
 return {...line, points: keep === p0 ? [p0, T] : [T, p1]};
}
/** 호 끝을 T 로 자르거나 늘린다(찍은 쪽을 남김). 원은 그대로. */
function trimArcTo(arc, T, pick) {
 if (arc.type === 'circle') return arc;
 const tau = G.normalizeAngle(G.angle(G.sub(T, arc.center))), s = arc.startAngle, e = arc.endAngle;
 if (G.angleOnArc(tau, s, e)) {
  const pk = pick ? G.normalizeAngle(G.angle(G.sub(pick, arc.center))) : null;
  return pk !== null && G.angleOnArc(pk, s, tau) ? {...arc, endAngle: tau} : {...arc, startAngle: tau};
 }
 return G.normalizeAngle(s - tau) < G.normalizeAngle(tau - e) ? {...arc, startAngle: tau} : {...arc, endAngle: tau};
}
/** 선-호·호-호·원 모깎기: 두 곡선을 반지름 R 만큼 띄운 곡선의 교점이 모깎기 중심(찍은 점에 가장 가까운 답). */
export function filletCurves(first, second, R, picks = [], options = {}) {
 if (!Number.isFinite(R) || R < 0) throw Error('반지름은 0 이상이어야 합니다.');
 const A = curveOf(first), B = curveOf(second), cands = [];
 const offsetLines = (L) => { if (R < 1e-12) return [L]; const n = G.mul(G.normal(G.unit(G.sub(L.b, L.a))), R); return [{kind: 'line', a: G.add(L.a, n), b: G.add(L.b, n)}, {kind: 'line', a: G.sub(L.a, n), b: G.sub(L.b, n)}]; };
 const offsetCircles = (C) => (R < 1e-12 ? [C] : [C.radius + R, Math.abs(C.radius - R)].filter((r) => r > 1e-9).map((r) => ({...C, radius: r})));
 const offs = (X) => (X.kind === 'line' ? offsetLines(X) : offsetCircles(X));
 for (const P of offs(A)) for (const Q of offs(B)) {
  if (P.kind === 'line' && Q.kind === 'line') continue;
  cands.push(...curveHits(P, Q));
 }
 const foot = (X, C) => {
  if (X.kind === 'line') { const v = G.sub(X.b, X.a); return G.add(X.a, G.mul(v, G.dot(G.sub(C, X.a), v) / G.dot(v, v))); }
  const d = G.dist(C, X.center); return d < 1e-12 ? null : G.add(X.center, G.mul(G.sub(C, X.center), X.radius / d));
 };
 let best = null;
 for (const C of cands) {
  const T1 = foot(A, C), T2 = foot(B, C);
  if (!T1 || !T2 || Math.abs(G.dist(C, T1) - R) > 1e-6 * Math.max(1, R) || Math.abs(G.dist(C, T2) - R) > 1e-6 * Math.max(1, R)) continue;
  const score = (picks[0] ? G.dist(T1, picks[0]) : 0) + (picks[1] ? G.dist(T2, picks[1]) : 0);
  if (!best || score < best.score - 1e-9) best = {C, T1, T2, score};
 }
 if (!best) throw Error('이 반지름으로는 두 객체를 모깎을 수 없습니다.');
 const trim = (e, T, p) => (e.type === 'line' ? trimLineTo(e, T, p) : trimArcTo(e, T, p));
 const out = options.trim === false ? [] : [trim(first, best.T1, picks[0]), trim(second, best.T2, picks[1])];
 if (R > 1e-12) {
  const s = G.angle(G.sub(best.T1, best.C)), e = G.angle(G.sub(best.T2, best.C)), small = G.normalizeAngle(e - s) <= 180;
  out.push({type: 'arc', layer: first.layer, center: best.C, radius: R, startAngle: G.normalizeAngle(small ? s : e), endAngle: G.normalizeAngle(small ? e : s)});
 }
 return out;
}
/** 서로 다른 두 열린 폴리선(또는 선+폴리선)의 끝 구간을 모깎고 하나의 폴리선으로 잇는다(AutoCAD joinLwPolys). */
export function filletJoinPaths(first, second, size, chamfer = false, picks = [], options = {}) {
 const prepare = (e, pick, other) => {
  if (e.type === 'polyline' && e.closed) throw Error('닫힌 폴리선은 다른 객체와 이어 모깎을 수 없습니다.');
  const path = toBPath(e), segs = bsegs(path), n = segs.length;
  let k = pick ? Math.floor(Math.min(pathParam(segs, pick), n - 1e-9)) : -1;
  let atEnd;
  if (n === 1 || k < 0) { const o = toBPath(other).v, ends = [o[0], o.at(-1)], d = (p) => Math.min(...ends.map((q) => G.dist(p, q))); atEnd = d(path.v.at(-1)) <= d(path.v[0]); }
  else if (k === 0) atEnd = false; else if (k === n - 1) atEnd = true; else throw Error('폴리선의 끝 구간을 고르세요.');
  const v = atEnd ? path.v : reversePath(path.v), last = bsegs({v, closed: false}).at(-1);
  if (last.kind !== 'line') throw Error('끝 구간이 호인 폴리선은 아직 이어 모깎을 수 없습니다.');
  return {v, line: {type: 'line', layer: e.layer, points: [last.a, last.b]}};
 };
 const A = prepare(first, picks[0], second), B = prepare(second, picks[1], first);
 // G.corner 는 두 선의 "먼 끝"을 남긴다: A 는 [시작, 모서리], B 는 [모서리, 끝] 순으로 넣는다.
 const parts = G.corner(A.line, {...B.line, points: [B.line.points[1], B.line.points[0]]}, size, chamfer, picks, {...options, trim: true});
 const t1 = parts[0].points[1], t2 = parts[1].points[0], mid = parts[2];
 const head = A.v.slice(0, -1).map((x) => ({...x})), tail = reversePath(B.v).slice(1).map((x) => ({...x}));
 let joint = [{...t1, bulge: 0}];
 if (mid?.type === 'arc') {
  const ccw = G.dist(G.add(mid.center, G.polar(mid.radius, mid.startAngle)), t1) < 1e-6 * Math.max(1, mid.radius);
  joint = [{...t1, bulge: (ccw ? 1 : -1) * bulgeOf(G.normalizeAngle(mid.endAngle - mid.startAngle))}, {...t2, bulge: 0}];
 } else if (mid) joint = [{...t1, bulge: 0}, {...t2, bulge: 0}];
 const v = [...head, ...joint, ...tail];
 const {id, arcRuns, spline, points, ...base} = first;
 return [{...base, type: 'polyline', closed: false, ...fromBulgeVertices(v, false)}];
}
/**
 * FILLET/CHAMFER 짝 표(AutoCAD computeFilletOrChamfer 와 같은 생각): 객체 종류 짝으로 계산 함수를 고른다.
 * @returns {entities, replaceIds?} — entities 는 원래 두 객체를 지운 자리에 넣을 것.
 */
export function cornerAny(first, second, size, chamfer = false, picks = [], options = {}) {
 const key = `${first.type}|${second.type}`, curve = (t) => ['arc', 'circle'].includes(t), path = (e) => e.type === 'line' || (e.type === 'polyline' && !e.closed);
 if (key === 'line|line') {
  if (isParallel(first, second)) {
   if (chamfer) throw Error('평행선은 모따기할 수 없습니다.');
   return options.trim === false ? filletParallel(first, second, picks).slice(2) : filletParallel(first, second, picks);
  }
  return G.corner(first, second, size, chamfer, picks, options);
 }
 if ((curve(first.type) && (second.type === 'line' || curve(second.type))) || (first.type === 'line' && curve(second.type))) {
  if (chamfer) throw Error('호·원은 모따기할 수 없습니다(AutoCAD 와 같음). 선·폴리선을 고르세요.');
  return filletCurves(first, second, size, picks, options);
 }
 if (path(first) && path(second) && (first.type === 'polyline' || second.type === 'polyline')) {
  if (options.trim === false) throw Error('자르지 않기(N)에서는 두 폴리선을 이어 모깎을 수 없습니다.');
  return filletJoinPaths(first, second, size, chamfer, picks, options);
 }
 throw Error(`이 객체 짝(${first.type}·${second.type})은 아직 ${chamfer ? '모따기' : '모깎기'}할 수 없습니다.`);
}

/* ══════════ 404 · OFFSET 모서리 채우기(OFFSETGAPTYPE)와 호 보존 ══════════ */
/** 점 목록의 자기 교차 고리를 잘라 낸다(타원 간격띄우기처럼 구간 정보가 없는 점 목록용). */
export function dropSelfLoops(points, closed = false) {
 let ps = points.slice();
 for (let guard = 0; guard < 1000; guard++) {
  let cut = null;
  const n = ps.length, m = closed ? n : n - 1;
  outer: for (let i = 0; i < m; i++) for (let j = i + 2; j < m; j++) {
   if (closed && i === 0 && j === n - 1) continue;
   const h = G.lineIntersection(ps[i], ps[(i + 1) % n], ps[j], ps[(j + 1) % n]);
   if (h && h.t > 1e-9 && h.t < 1 - 1e-9 && h.u > 1e-9 && h.u < 1 - 1e-9) { cut = {i, j, p: h.point}; break outer; }
  }
  if (!cut) return ps;
  const inner = cut.j - cut.i, outerCount = n - inner;
  // 닫힌 경로는 더 큰 쪽(바깥)을, 열린 경로는 고리(가운데)를 버린다.
  ps = closed && inner > outerCount ? [cut.p, ...ps.slice(cut.i + 1, cut.j + 1)] : [...ps.slice(0, cut.i + 1), cut.p, ...ps.slice(cut.j + 1)];
 }
 return ps;
}
const segTangent = (s, f) => { if (s.kind === 'line') return G.sub(s.b, s.a); const a = s.start + s.sweep * f, g = Math.sign(s.sweep); return {x: -Math.sin(a) * g, y: Math.cos(a) * g}; };
const signedArea = (ps) => { let s = 0; for (let i = 0; i < ps.length; i++) { const a = ps[i], b = ps[(i + 1) % ps.length]; s += a.x * b.y - b.x * a.y; } return s / 2; };
/**
 * 폴리선 간격띄우기: 구간(선·호)마다 띄우고 모서리를 gapType 으로 잇는다(0 연장 · 1 호 · 2 모따기).
 * 호 구간은 호로 띄운다(점 나눔이 아니라 반지름만 바뀜). 안쪽 모서리에서 뒤집힌 짧은 구간은 오류 대신 빼고 잇는다.
 */
export function offsetPath(e, d, side, {gapType = 0} = {}) {
 if (!Number.isFinite(d) || d <= 0) throw Error('오프셋 거리는 양수여야 합니다.');
 const path = toBPath(e), segs = bsegs(path), n = segs.length, closed = path.closed;
 if (!n) throw Error('간격띄우기할 구간이 없습니다.');
 const k0 = Math.min(Math.floor(pathParam(segs, side)), n - 1), s0 = segs[k0], f0 = segNearest(s0, side).f;
 const sign = G.cross(segTangent(s0, f0), G.sub(side, segPoint(s0, f0))) >= 0 ? 1 : -1;
 const off = segs.map((s) => {
  if (s.kind === 'line') { const nv = G.mul(G.normal(G.unit(G.sub(s.b, s.a))), d * sign); return {kind: 'line', a: G.add(s.a, nv), b: G.add(s.b, nv), src: s}; }
  const r = s.radius - d * sign * Math.sign(s.sweep);
  if (r <= 1e-9) throw Error('호 반지름보다 큰 거리로는 안쪽 간격띄우기를 할 수 없습니다.');
  return {kind: 'arc', center: s.center, radius: r, start: s.start, sweep: s.sweep, a: onCircle(s.center, r, s.start), b: onCircle(s.center, r, s.start + s.sweep), src: s};
 });
 // 모서리마다 끝점·다음 시작점·채움(호)을 정한다. 원래 꼭짓점 V 는 지운 구간이 없을 때만 채움 호의 중심으로 쓴다.
 const solve = (list) => {
  const m = list.length, joins = closed ? m : m - 1, starts = list.map((o) => o.a), ends = list.map((o) => o.b), fills = list.map(() => null);
  for (let k = 0; k < joins; k++) {
   const P = list[k], Q = list[(k + 1) % m], adjacent = G.dist(P.V1, Q.V0) < 1e-12, ref = adjacent ? P.V1 : lerp(P.b, Q.a, .5);
   if (G.dist(P.b, Q.a) < 1e-9 * Math.max(1, d)) continue;
   const hits = curveHits(P, Q).sort((x, y) => G.dist(x, ref) - G.dist(y, ref));
   // 바깥(볼록) 모서리 = 띄우는 쪽이 꺾이는 방향의 반대편. 안쪽 모서리는 두 원소가 겹치므로 교점에서 자른다.
   const convex = adjacent && G.cross(P.t1, Q.t0) * sign < 0;
   if (!convex || gapType === 0) {
    if (hits.length && G.dist(hits[0], ref) <= d * 50) { ends[k] = hits[0]; starts[(k + 1) % m] = hits[0]; continue; }
    if (!convex) continue;
    if (P.kind === 'line' && Q.kind === 'line') throw Error('모서리가 너무 예리합니다. 모서리 채우기를 호(1)나 모따기(2)로 바꾸거나 선을 나누어 오프셋하세요.');
   }
   if (gapType === 2) continue; // 끝과 다음 시작을 곧은 선으로(모따기)
   fills[k] = {at: P.b, bulge: Math.tan(wrapPi(atan2(G.sub(Q.a, ref)) - atan2(G.sub(P.b, ref))) / 4)};
  }
  return {starts, ends, fills, joins};
 };
 // 안쪽 모서리에서 짧은 구간이 뒤집히면(띄운 방향이 원래와 반대) 그 구간을 빼고 이웃끼리 다시 잇는다 — 고리 대신 깨끗한 선.
 let list = off.map((o, k) => ({...o, V0: segs[k].a, V1: segs[k].b, t0: segTangent(segs[k], 0), t1: segTangent(segs[k], 1)})), solved;
 for (let guard = 0; ; guard++) {
  solved = solve(list);
  const bad = list.findIndex((o, k) => o.kind === 'line' && G.dot(G.sub(solved.ends[k], solved.starts[k]), G.sub(o.src.b, o.src.a)) <= 1e-12);
  if (bad < 0 || guard > n) break;
  if (list.length <= (closed ? 3 : 1)) throw Error('오프셋 거리가 형상보다 큽니다.');
  list = list.filter((_, k) => k !== bad);
 }
 const {starts, ends, fills, joins} = solved, m = list.length, verts = [];
 for (let k = 0; k < m; k++) {
  const o = list[k], from = starts[k], to = ends[k];
  if (o.kind === 'line') verts.push({...from, bulge: 0});
  else {
   let sw = atan2(G.sub(to, o.center)) - atan2(G.sub(from, o.center));
   sw = o.sweep > 0 ? ((sw % TAU) + TAU) % TAU : -((((-sw) % TAU) + TAU) % TAU);
   if (Math.abs(sw) > Math.abs(o.sweep) + Math.PI) sw = o.sweep; // 거의 한 바퀴로 튀면 원래 각
   verts.push({...from, bulge: Math.tan(sw / 4)});
  }
  if (fills[k]) verts.push({...fills[k].at, bulge: fills[k].bulge});
  else if (k < joins && G.dist(to, starts[(k + 1) % m]) > 1e-9) verts.push({...to, bulge: 0});
 }
 if (!closed) verts.push({...ends[m - 1], bulge: 0});
 const made = fromBulgeVertices(verts, closed);
 if (closed) {
  const before = signedArea(e.points), after = signedArea(made.points);
  if (Math.abs(after) < 1e-9 || before * after <= 0) throw Error('오프셋 결과가 소멸하거나 뒤집힙니다.');
 }
 const {id, arcRuns, spline, points, ...base} = e;
 return {...base, type: 'polyline', closed, ...made};
}
/** 타원 간격띄우기(1단계): 512 조각 점을 법선 방향으로 띄운 폴리선(AutoCAD 도 결과는 스플라인 근사). */
export function offsetEllipse(e, d, side) {
 const ps = G.ellipsePoints(e, 512), {sweep} = ellipseRange(e), closed = sweep >= TAU - 1e-12;
 const normalAt = (i) => { const a = ps[Math.max(0, i - 1)], b = ps[Math.min(ps.length - 1, i + 1)], nrm = G.unit(G.normal(G.sub(b, a))); return G.dot(nrm, G.sub(ps[i], e.center)) >= 0 ? nrm : G.mul(nrm, -1); };
 let k = 0; ps.forEach((p, i) => { if (G.dist(p, side) < G.dist(ps[k], side)) k = i; });
 const sgn = G.dot(G.sub(side, ps[k]), normalAt(k)) >= 0 ? 1 : -1;
 const moved = ps.map((p, i) => G.add(p, G.mul(normalAt(i), d * sgn)));
 if (closed) moved.pop();
 const {id, center, majorAxis, ratio, startParam, endParam, ...base} = e;
 return {...base, type: 'polyline', closed, points: dropSelfLoops(moved, closed)};
}
/** OFFSET 공용 입구: gapType 0 이고 직선 폴리선이면 기존 계산(G.offsetEntity) 그대로, 그 밖은 offsetPath. */
export function offsetAny(e, d, side, {gapType = 0} = {}) {
 if (e.type === 'ellipse') return offsetEllipse(e, d, side);
 if (['circle', 'arc'].includes(e.type) || e.type === 'line') return G.offsetEntity(e, d, side);
 const hasArcs = verifiedArcRuns(e).length > 0;
 if (!hasArcs && !gapType) {
  try {
   const out = G.offsetEntity(e, d, side), src = e.points, ps = out.points, m = (e.closed || e.type === 'rectangle') ? src.length : src.length - 1;
   // 기존 계산이 안쪽 모서리에서 구간을 뒤집어 고리를 남겼는지 O(n) 으로만 확인한다.
   let flipped = false;
   for (let i = 0; i < m && !flipped; i++) { const j = (i + 1) % src.length; flipped = G.dot(G.sub(ps[j], ps[i]), G.sub(src[j], src[i])) < 0; }
   if (!flipped) return out;
  } catch (error) { if (!/자기 교차|예리/.test(error?.message || '')) throw error; }
 }
 return offsetPath(e, d, side, {gapType});
}

/* ══════════ 415 · LENGTHEN 계산 ══════════ */
/** 모드(DE 증분 · P 퍼센트 · T 전체 · DY 동적)에서 길이 변화량. */
export function lengthenDelta(mode, value, length, dynamicDistance = 0) {
 const v = Number(value);
 if (mode === 'DE') return v;
 if (mode === 'P') { if (!(v > 0)) throw Error('퍼센트는 0보다 커야 합니다.'); return length * (v / 100 - 1); }
 if (mode === 'T') { if (!(v > 0)) throw Error('전체 길이는 0보다 커야 합니다.'); return v - length; }
 if (mode === 'DY') return dynamicDistance;
 throw Error('길이 모드는 DE·P·T·DY 중 하나입니다.');
}
/** 끝점과 그 끝에서 바깥으로 향하는 방향(동적 모드에서 커서 투영용). */
export function endTangent(e, end) {
 if (e.type === 'arc') {
  const a = end === 'start' ? e.startAngle : e.endAngle, p = G.add(e.center, G.polar(e.radius, a));
  const t = G.polar(1, a + 90); return {point: p, dir: end === 'start' ? G.mul(t, -1) : t};
 }
 const ps = e.points, [p, q] = end === 'start' ? [ps[0], ps[1]] : [ps.at(-1), ps.at(-2)];
 return {point: p, dir: G.unit(G.sub(p, q))};
}

/* ══════════ 416 · 변환 행렬 한 번 ══════════ */
/** [a,b,c,d,tx,ty]: x' = a x + c y + tx, y' = b x + d y + ty. 닮음 변환(이동·회전·같은 축척·대칭)만 받는다. */
export function matrixParts(m) {
 const [a, b, c, d] = m;
 if (!m || m.length !== 6 || !m.every(Number.isFinite)) throw Error('변환 행렬 오류');
 const det = a * d - b * c, sx = Math.hypot(a, b), sy = Math.hypot(c, d);
 if (Math.abs(det) < 1e-12) throw Error('납작해지는 변환은 쓸 수 없습니다.');
 if (Math.abs(sx - sy) > 1e-9 * Math.max(1, sx) || Math.abs(a * c + b * d) > 1e-9 * Math.max(1, sx * sy)) throw Error('가로·세로 축척이 다른 변환은 아직 지원하지 않습니다.');
 return {scale: sx, rotation: G.angle({x: a, y: b}), mirror: det < 0, fn: (p) => ({x: a * p.x + c * p.y + m[4], y: b * p.x + d * p.y + m[5]})};
}
/** ALIGN: s1→d1, s1s2 방향 → d1d2, (scale) 길이 비율까지 한 행렬로. */
export function alignMatrix(s1, d1, s2, d2, scale = false) {
 const from = G.sub(s2, s1), to = G.sub(d2, d1), lf = G.len(from), lt = G.len(to);
 if (lf < 1e-9 || lt < 1e-9) throw Error('원본 두 점과 대상 두 점은 서로 떨어져 있어야 합니다.');
 const r = rad(G.angle(to) - G.angle(from)), k = scale ? lt / lf : 1, a = k * Math.cos(r), b = k * Math.sin(r), c = -b, d = a;
 return [a, b, c, d, d1.x - (a * s1.x + c * s1.y), d1.y - (b * s1.x + d * s1.y)];
}
/** 참조 회전·축척을 행렬로: base 를 중심으로 angle(도)·factor. */
export function rotateScaleMatrix(base, angleDeg = 0, factor = 1) {
 const r = rad(angleDeg), a = factor * Math.cos(r), b = factor * Math.sin(r), c = -b, d = a;
 return [a, b, c, d, base.x - (a * base.x + c * base.y), base.y - (b * base.x + d * base.y)];
}

/* ══════════ 418 · 경로 점(타원·호 폴리선 포함) ══════════ */
/** DIVIDE/MEASURE 가 걷는 점 목록. 원 361점(기존)과 달리 호·타원은 곡률에 맞게. */
export function walkPoints(e) {
 if (e.type === 'ellipse') return G.ellipsePoints(e, 512);
 if (e.type === 'circle') return Array.from({length: 361}, (_, i) => G.add(e.center, G.polar(e.radius, i)));
 if (e.type === 'arc') { const sweep = G.normalizeAngle(e.endAngle - e.startAngle) || 360, n = Math.max(8, Math.ceil(sweep)); return Array.from({length: n + 1}, (_, i) => G.add(e.center, G.polar(e.radius, e.startAngle + sweep * i / n))); }
 if (['line', 'polyline', 'rectangle'].includes(e.type)) { const ps = e.points.map(pt); if (e.closed || e.type === 'rectangle') ps.push(pt(ps[0])); return ps; }
 throw Error('선·폴리선·원·호·타원을 선택하세요.');
}
/** 점 목록을 따라 거리 목록의 점과 진행 방향(도). */
export function pointsAlongWithAngle(path, distances) {
 const out = []; let seg = 0, walked = 0;
 for (const target of distances) {
  while (seg < path.length - 1) {
   const L = G.dist(path[seg], path[seg + 1]);
   if (walked + L >= target - 1e-12 || seg === path.length - 2) {
    const f = L < 1e-12 ? 0 : Math.max(0, Math.min(1, (target - walked) / L));
    out.push({point: lerp(path[seg], path[seg + 1], f), angle: G.angle(G.sub(path[seg + 1], path[seg]))});
    break;
   }
   walked += L; seg++;
  }
 }
 return out;
}
