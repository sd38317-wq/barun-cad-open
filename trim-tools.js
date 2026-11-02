// 자르기 및 끌기 분류의 마지막 미연결 7개: CUT(413) FE(489) BAT(487) BB(412) BRO(415) DIB(312) DTP(501).
// 정리본 docs/izzarder-reference-20260921/references/05-trim-stretch.md 와 원문(izzarder.com/<번호>)을 근거로 옮김.
import * as G from './geometry.js';
import { STD_LAYERS, openCardDialog, entitiesSvg, readableAngle } from './card-kit.js';

/* ── 공통 경로(선·폴리선) 도구. 선택된 객체를 하나의 매개변수 경로로 보고, 임의 위치에서 자르거나
   구간을 들어낸다. line·polyline·rectangle 에 공통으로 쓴다. ── */
function stripEntity(e) {
  const { id, points, closed, type, center, radius, startAngle, endAngle, ...rest } = e;
  return rest;
}
function pathSegs(e) {
  const closed = e.type === 'rectangle' || !!e.closed;
  const pts = e.points.map((p) => ({ x: p.x, y: p.y }));
  const chain = closed ? [...pts, pts[0]] : pts;
  const segs = [];
  let total = 0;
  for (let i = 0; i < chain.length - 1; i++) {
    const a = chain[i], b = chain[i + 1], len = G.dist(a, b);
    segs.push({ a, b, start: total, len });
    total += len;
  }
  return { segs, total, closed, pts };
}
function projectAlong(p, segs) {
  let best = null;
  for (const s of segs) {
    if (s.len < G.EPS) {
      const d = G.dist(p, s.a);
      if (!best || d < best.dist) best = { along: s.start, dist: d, foot: s.a };
      continue;
    }
    const v = G.sub(s.b, s.a),
      t = Math.max(0, Math.min(1, G.dot(G.sub(p, s.a), v) / (s.len * s.len))),
      foot = G.add(s.a, G.mul(v, t)),
      d = G.dist(p, foot),
      along = s.start + t * s.len;
    if (!best || d < best.dist) best = { along, dist: d, foot };
  }
  if (!best) throw Error('빈 경로입니다.');
  return best;
}
function pointAtAlong(segs, total, along) {
  along = Math.max(0, Math.min(total, along));
  for (const s of segs) if (along <= s.start + s.len + 1e-7) return s.len < G.EPS ? s.a : G.add(s.a, G.mul(G.sub(s.b, s.a), (along - s.start) / s.len));
  return segs.length ? segs.at(-1).b : null;
}
function buildRun(segs, total, from, to) {
  const pts = [pointAtAlong(segs, total, from)];
  for (const s of segs) if (s.start > from + 1e-7 && s.start < to - 1e-7) pts.push(s.a);
  pts.push(pointAtAlong(segs, total, to));
  return pts;
}
function directionAtAlong(segs, along) {
  for (const s of segs) if (along <= s.start + s.len + 1e-7) return s.len < G.EPS ? { x: 1, y: 0 } : G.unit(G.sub(s.b, s.a));
  return segs.length ? G.unit(G.sub(segs.at(-1).b, segs.at(-1).a)) : { x: 1, y: 0 };
}
const asPiece = (rest, pts) => (pts.length === 2 ? { ...rest, type: 'line', points: pts } : { ...rest, type: 'polyline', closed: false, points: pts });

/* ── FE · 길이 남기고 모따기 (xiFilletExtend, izzarder.com/489) ──
   "남길 길이"를 지정한 뒤 두 선을 고르면 그 길이만큼 남기고 모따기한다.
   geometry.js 의 corner(a,b,size,chamfer=true) 가 이미 "교차점에서 size 만큼 남기고 모따기"를 하므로 그대로 쓴다. */
export function filletExtend(lineA, lineB, keep) {
  if (lineA?.type !== 'line' || lineB?.type !== 'line') throw Error('FE는 개별 직선 두 개를 선택하세요.');
  if (!Number.isFinite(keep) || keep < 0) throw Error('남길 길이는 0 이상이어야 합니다.');
  return G.corner(lineA, lineB, keep, true);
}

/* ── DTP · 곡선을 직선 조합으로 분할 (xiDivideToPoly, izzarder.com/501) ──
   원·호·타원을 지정한 해상도(분할 개수)만큼 샘플링해 직선 폴리선으로 바꾼다.
   바른 CAD 폴리선은 불지(호 구간)를 지원하지 않아 이미 직선인 폴리선·사각형은 그대로 옮긴다. */
export function divideToPolyline(e, n) {
  if (!Number.isInteger(n) || n < 3) throw Error('직선 해상도(분할 개수)는 3 이상의 정수여야 합니다.');
  if (e.type === 'circle') {
    const pts = Array.from({ length: n }, (_, i) => G.add(e.center, G.polar(e.radius, (i * 360) / n)));
    return { ...stripEntity(e), type: 'polyline', closed: true, points: pts };
  }
  if (e.type === 'arc') {
    const sweep = G.normalizeAngle(e.endAngle - e.startAngle) || 360;
    const pts = Array.from({ length: n + 1 }, (_, i) => G.add(e.center, G.polar(e.radius, e.startAngle + (sweep * i) / n)));
    return { ...stripEntity(e), type: 'polyline', closed: false, points: pts };
  }
  if (e.type === 'ellipse') {
    const closed = Math.abs(((e.endParam ?? Math.PI * 2) - (e.startParam || 0)) - Math.PI * 2) < 1e-6;
    const pts = G.ellipsePoints(e, n);
    return { ...stripEntity(e), type: 'polyline', closed, points: closed ? pts.slice(0, -1) : pts };
  }
  if (['polyline', 'rectangle'].includes(e.type)) {
    return { ...stripEntity(e), type: 'polyline', closed: e.type === 'rectangle' || !!e.closed, points: e.points.map((p) => ({ x: p.x, y: p.y })) };
  }
  throw Error('DTP는 폴리선·호·원·타원에 적용됩니다.');
}

/* ── BB · 자르고 현재 켜로 넣기 (xiBreakToCurrent, izzarder.com/412) ──
   BREAK처럼 두 점으로 자르되, 잘려나간 조각을 지우지 않고 현재 켜로 다시 넣는다.
   지원 객체(이 버전): LINE·POLYLINE(열린 선)·CIRCLE. ARC·ELLIPSE는 원문에 있으나 시간 제약으로 다음으로 미룬다.
   anchor: 원문의 "처음 선택 커서 위치" 역할(원(닫힌 도형)에서 두 자르는 점이 만드는 두 호 중 어느 쪽이
   "잘려나간 쪽"인지 정하는 기준점). 직선류는 두 점 사이가 항상 그 구간 하나뿐이라 anchor 를 쓰지 않는다. */
export function breakToCurrentLine(e, p1, p2, anchor) {
  if (e.type === 'circle') {
    const a1 = G.normalizeAngle(G.angle(G.sub(p1, e.center))),
      a2 = G.normalizeAngle(G.angle(G.sub(p2, e.center))),
      aa = G.normalizeAngle(G.angle(G.sub(anchor, e.center)));
    const mk = (s, en) => ({ ...stripEntity(e), type: 'arc', center: { x: e.center.x, y: e.center.y }, radius: e.radius, startAngle: s, endAngle: en });
    return G.angleOnArc(aa, a1, a2) ? { cut: mk(a1, a2), keep: [mk(a2, a1)] } : { cut: mk(a2, a1), keep: [mk(a1, a2)] };
  }
  if (!['line', 'polyline'].includes(e.type)) throw Error('BB는 선·폴리선(열린 선)·원에 지원됩니다(호·타원은 이 버전에서 지원하지 않습니다).');
  if (e.closed) throw Error('BB는 열린 선·폴리선에 지원됩니다.');
  const { segs, total } = pathSegs(e);
  const A = projectAlong(p1, segs), B = projectAlong(p2, segs);
  const lo = Math.min(A.along, B.along), hi = Math.max(A.along, B.along);
  if (hi - lo < G.EPS) throw Error('절단할 구간의 두 점을 서로 다르게 지정하세요.');
  const rest = stripEntity(e);
  const before = lo > 1e-7 ? asPiece(rest, buildRun(segs, total, 0, lo)) : null;
  const after = hi < total - 1e-7 ? asPiece(rest, buildRun(segs, total, hi, total)) : null;
  return { cut: asPiece(rest, buildRun(segs, total, lo, hi)), keep: [before, after].filter(Boolean) };
}

/* ── BRO · 객체 위의 객체 끊기 (xiBreakO, izzarder.com/415) ──
   기준 객체 여러 개와 자를 대상 여러 개를 각각 고르면, 기준과 만나는 위치마다 대상을 끊는다(삭제 없음). */
export function breakAtIntersections(target, bases) {
  if (!['line', 'polyline', 'rectangle'].includes(target.type)) throw Error('BRO의 자를 대상은 선·폴리선만 지원합니다.');
  const { segs, total } = pathSegs(target);
  const alongs = [];
  for (const base of bases || []) {
    if (base === target || (target.id != null && base.id === target.id)) continue;
    let pts = [];
    try { pts = G.intersections(target, base); } catch { pts = []; }
    for (const p of pts) {
      const proj = projectAlong(p, segs);
      if (proj.dist < 1e-3) alongs.push(proj.along);
    }
  }
  const marks = [...new Set(alongs.map((a) => Math.round(a * 1e4) / 1e4))]
    .filter((a) => a > 1e-6 && a < total - 1e-6)
    .sort((a, b) => a - b);
  if (!marks.length) return null;
  const bounds = [0, ...marks, total];
  const rest = stripEntity(target);
  const pieces = [];
  for (let i = 0; i < bounds.length - 1; i++) {
    if (bounds[i + 1] - bounds[i] < 1e-6) continue;
    pieces.push(asPiece(rest, buildRun(segs, total, bounds[i], bounds[i + 1])));
  }
  return pieces;
}

/* ── DIB · 다이아그램 만들기 (xiDiagramBox, izzarder.com/312) ──
   닫힌 폴리선 여러 개가 변을 공유하는 도형에서, 전체 이격 거리를 입력하면 외곽선은 그대로 두고
   서로 접한 안쪽 변만 절반씩 떨어진다. "전체를 오프셋한 뒤 외곽 변만 되돌리는" 원문의 제작 방법대로,
   공유 변만 안쪽으로 half 만큼 밀고 나머지 변은 그대로 둔 뒤 인접한 변끼리 다시 교차시켜 새 꼭짓점을 만든다. */
export function diagramBoxes(polygons, gapTotal) {
  if (!Number.isFinite(gapTotal) || gapTotal <= 0) throw Error('이격 거리는 양수여야 합니다.');
  const half = gapTotal / 2;
  const key = (p) => Math.round(p.x * 100) + ',' + Math.round(p.y * 100);
  const edgeKey = (a, b) => { const ka = key(a), kb = key(b); return ka < kb ? ka + '|' + kb : kb + '|' + ka; };
  const count = new Map();
  for (const poly of polygons) {
    const n = poly.length;
    for (let i = 0; i < n; i++) { const k = edgeKey(poly[i], poly[(i + 1) % n]); count.set(k, (count.get(k) || 0) + 1); }
  }
  let sharedTotal = 0;
  const out = polygons.map((points) => {
    const n = points.length;
    const centroid = points.reduce((s, p) => G.add(s, p), { x: 0, y: 0 });
    centroid.x /= n; centroid.y /= n;
    const shifted = [];
    for (let i = 0; i < n; i++) {
      const a = points[i], b = points[(i + 1) % n];
      const shared = (count.get(edgeKey(a, b)) || 0) >= 2;
      if (shared) sharedTotal++;
      if (!shared || G.dist(a, b) < G.EPS) { shifted.push([a, b]); continue; }
      const u = G.unit(G.sub(b, a)), nrm = G.normal(u);
      const sign = G.cross(u, G.sub(centroid, a)) >= 0 ? 1 : -1;
      const off = G.mul(nrm, half * sign);
      shifted.push([G.add(a, off), G.add(b, off)]);
    }
    const result = [];
    for (let i = 0; i < n; i++) {
      const prev = shifted[(i - 1 + n) % n], next = shifted[i];
      const hit = G.lineIntersection(prev[0], prev[1], next[0], next[1]);
      result.push(hit ? hit.point : next[0]);
    }
    return result;
  });
  if (!sharedTotal) throw Error('서로 접한 변이 없습니다. 닫힌 폴리선들이 변을 공유해야 합니다.');
  return out;
}

/* ── CUT · 경계 만들고 자르기 (xiCutter, izzarder.com/413) ──
   폐곡선을 경계로, 점을 클릭한 쪽(원문: 내부 클릭 시 내부가 삭제)에 걸리는 객체를 경계에서 자르고
   그 쪽 조각을 지운다. "여러 객체"(multi) 모드는 여러 경계 전부의 내부를 지운다(바깥은 못 자름).
   대상은 이 버전에서 line·polyline·rectangle(자름) · circle·arc(통째 삭제 판정) · hatch(해치 폭파 켠 경우만,
   블록(블럭 폭파 켠 경우만, 공유블록 제외)이다. */
export function boundaryPolygon(e) {
  if (['polyline', 'rectangle'].includes(e.type)) {
    if (!(e.type === 'rectangle' || e.closed)) throw Error('경계는 닫힌 폴리선이어야 합니다.');
    return e.points.map((p) => ({ x: p.x, y: p.y }));
  }
  if (e.type === 'circle') return Array.from({ length: 128 }, (_, i) => G.add(e.center, G.polar(e.radius, (i * 360) / 128)));
  throw Error('경계는 닫힌 폴리선·사각형·원만 지원합니다.');
}
const insideAnyPolygon = (p, polys) => polys.some((poly) => G.inside(p, poly));
function boundaryEdgesOf(polys) { return polys.flatMap((poly) => G.segments({ points: poly, closed: true })); }
function splitPathByPredicate(e, edges, deletesAt) {
  const { segs, total } = pathSegs(e);
  if (!segs.length) return null;
  const cuts = [];
  for (const s of segs)
    for (const [c, d] of edges) {
      const h = G.lineIntersection(s.a, s.b, c, d);
      if (h && h.t > G.EPS && h.t < 1 - G.EPS && h.u >= -G.EPS && h.u <= 1 + G.EPS) cuts.push(s.start + h.t * s.len);
    }
  const marks = [...new Set(cuts.map((a) => Math.round(a * 1e4) / 1e4))].filter((a) => a > 1e-6 && a < total - 1e-6).sort((a, b) => a - b);
  const bounds = [0, ...marks, total];
  const runs = [];
  for (let i = 0; i < bounds.length - 1; i++) if (bounds[i + 1] - bounds[i] > 1e-6) runs.push([bounds[i], bounds[i + 1]]);
  if (!runs.length) return null;
  let anyDeleted = false;
  const kept = [];
  for (const [lo, hi] of runs) {
    const mid = pointAtAlong(segs, total, (lo + hi) / 2);
    if (deletesAt(mid)) anyDeleted = true;
    else kept.push(buildRun(segs, total, lo, hi));
  }
  return anyDeleted ? kept : null;
}
function polygonCentroid(points) { const c = points.reduce((s, p) => G.add(s, p), { x: 0, y: 0 }); return { x: c.x / points.length, y: c.y / points.length }; }
/** Sutherland–Hodgman: subject 를 볼록 다각형 clip 안쪽으로 잘라 교집합을 만든다(해치 '바깥쪽 삭제'용). */
function sutherlandHodgman(subject, clip) {
  const cx = polygonCentroid(clip);
  let output = subject.slice();
  for (let i = 0; i < clip.length && output.length; i++) {
    const a = clip[i], b = clip[(i + 1) % clip.length], edge = G.sub(b, a);
    const refSign = Math.sign(G.cross(edge, G.sub(cx, a))) || 1;
    const inside = (p) => G.cross(edge, G.sub(p, a)) * refSign >= -1e-7;
    const input = output;
    output = [];
    for (let k = 0; k < input.length; k++) {
      const cur = input[k], prev = input[(k - 1 + input.length) % input.length];
      const curIn = inside(cur), prevIn = inside(prev);
      if (curIn) { if (!prevIn) { const h = G.lineIntersection(prev, cur, a, b); if (h) output.push(h.point); } output.push(cur); }
      else if (prevIn) { const h = G.lineIntersection(prev, cur, a, b); if (h) output.push(h.point); }
    }
  }
  return output;
}
function clipHatch(e, polys, deleteSide, multi) {
  if (multi || deleteSide) {
    const loops = [...(e.loops || []), ...polys.map((p) => p.map((q) => ({ x: q.x, y: q.y })))];
    return [{ ...stripEntity(e), type: 'hatch', points: e.points, loops }];
  }
  // 모든 경계 루프(여러 영역·구멍)를 같은 창으로 자른다 — 짝홀 채움은 루프마다 자른 뒤에도 그대로 맞는다.
  const rings = G.hatchRings(e).map((ring) => sutherlandHodgman(ring, polys[0])).filter((ring) => ring.length >= 3);
  if (!rings.length) return null;
  return [{ ...stripEntity(e), type: 'hatch', points: rings[0], loops: rings.slice(1) }];
}
function applyHatchReplace(entity, opts) {
  if (!opts?.replaceSolidHatch || !entity.solid) return entity;
  return { ...entity, solid: false, pattern: opts.hatchName || 'ANSI31', spacing: Number(opts.hatchScale) || 3, angle: Number(opts.hatchAngle) || 0 };
}
function cutOne(e, polys, deletesAt, edges, hatchOpts, opts) {
  if (e.type === 'hatch') {
    if (!opts.hatchExplode) return { skip: 'hatch' };
    const clipped = clipHatch(e, polys, opts.deleteSide, opts.multi);
    return clipped ? { remove: true, add: clipped.map((h) => applyHatchReplace(h, hatchOpts)) } : null;
  }
  if (e.type === 'block') {
    if (!opts.blockExplode || e.sharedBlock) {
      // 폭파하지 않는 블록은 통째로만 다룬다: 범위 전체가 삭제 쪽이면 지우고, 걸쳐 있으면 그대로(건너뛴 수로 안내). 검토자 지적 11.
      // 도곽처럼 경계를 통째로 감싸는 블록(경계 점이 블록 범위 안)은 네 모서리가 모두 바깥이어도 지우지 않는다(검토자 재지적 ①).
      let b = null; try { b = G.bounds([e]); } catch { b = null; }
      if (b && polys.some((poly) => poly.some((p) => p.x >= b.minX - G.EPS && p.x <= b.maxX + G.EPS && p.y >= b.minY - G.EPS && p.y <= b.maxY + G.EPS))) return { skip: 'block' };
      const corners = b ? [{ x: b.minX, y: b.minY }, { x: b.maxX, y: b.minY }, { x: b.maxX, y: b.maxY }, { x: b.minX, y: b.maxY }] : [cutAnchorOf(e)].filter(Boolean);
      if (corners.length && corners.every(deletesAt)) return { remove: true, add: [] };
      return corners.some(deletesAt) ? { skip: 'block' } : null;
    }
    const prims = G.primitives(e).filter((p) => ['line', 'polyline', 'rectangle', 'circle', 'arc', 'hatch'].includes(p.type));
    const add = [];
    for (const prim of prims) {
      const r = cutOne(prim, polys, deletesAt, edges, hatchOpts, opts);
      if (!r || r.skip) { add.push(prim); continue; }
      if (r.add) add.push(...r.add);
    }
    return { remove: true, add };
  }
  if (['circle', 'arc'].includes(e.type)) return deletesAt(e.center) ? { remove: true, add: [] } : null;
  if (['line', 'polyline', 'rectangle'].includes(e.type)) {
    const kept = splitPathByPredicate(e, edges, deletesAt);
    return kept === null ? null : { remove: true, add: kept.map((pts) => asPiece(stripEntity(e), pts)) };
  }
  // 문자·치수·점·타원·(폭파하지 않는) 블록·기타: 자를 수 없는 객체는 기준점(삽입점/중심)이 삭제 쪽이면 통째로 지운다.
  // 한글명 "닫힌 객체 안의 모든 객체 삭제"에 맞춘다(2026-09-24 검토 F1).
  const anchor = cutAnchorOf(e);
  return anchor && deletesAt(anchor) ? { remove: true, add: [] } : null;
}
/** 자를 수 없는 객체의 대표점. 문자·점은 위치, 타원은 중심, 치수·기타는 경계상자 중심. */
export function cutAnchorOf(e) {
  if (e.type === 'text' || e.type === 'point') return e.position ? { x: e.position.x, y: e.position.y } : null;
  if (e.type === 'ellipse' && e.center) return { x: e.center.x, y: e.center.y };
  if (e.type === 'dimension' && Array.isArray(e.points) && e.points.length >= 2) {
    // 치수는 치수선 위치(세 번째 점)가 있으면 그 점, 없으면 두 측정점의 가운데를 대표점으로 본다.
    const p = e.points[2] || e.points[0], q = e.points[2] ? e.points[2] : e.points[1];
    return { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 };
  }
  let b = null;
  try { b = G.bounds([e]); } catch { b = null; }
  return b ? { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 } : null;
}
export function cutTargetsByBoundary({ entities, boundaries, pick, multi = false, includeLocked = false, blockExplode = false, hatchExplode = false, hatchOpts = {}, layers = [] }) {
  if (!boundaries?.length) throw Error('경계 객체를 먼저 선택하세요.');
  const polys = boundaries.map(boundaryPolygon);
  if (!multi && !pick) throw Error('내부/외부를 지정할 점을 클릭하세요.');
  const deleteSide = multi ? true : insideAnyPolygon(pick, polys);
  const deletesAt = (p) => { const inside = insideAnyPolygon(p, polys); return multi ? inside : inside === deleteSide; };
  const edges = boundaryEdgesOf(polys);
  const boundaryIds = new Set(boundaries.map((b) => b.id));
  const unionBox = polys.reduce((box, poly) => {
    const bb = G.bounds([{ type: 'polyline', points: poly, closed: true }]);
    return box ? { minX: Math.min(box.minX, bb.minX), minY: Math.min(box.minY, bb.minY), maxX: Math.max(box.maxX, bb.maxX), maxY: Math.max(box.maxY, bb.maxY) } : bb;
  }, null);
  const overlaps = (e) => { let b = null; try { b = G.bounds([e]); } catch { return true; } return !b || (unionBox && b.minX <= unionBox.maxX && b.maxX >= unionBox.minX && b.minY <= unionBox.maxY && b.maxY >= unionBox.minY); };
  const lockedLayers = new Set((layers || []).filter((l) => l.locked).map((l) => l.id));
  // 꺼진(visible=false)·동결(frozen) 켜의 객체는 화면에 없으므로 어느 쪽에서도 지우지 않는다(검토자 지적 5).
  const hiddenLayers = new Set((layers || []).filter((l) => l.visible === false || l.frozen).map((l) => l.id));
  const opts = { multi, blockExplode, hatchExplode, deleteSide };
  const removeIds = [], add = [], removedBlockNames = [], skippedBlockNames = [];
  let touched = 0, skippedLocked = 0, skippedHatch = 0, skippedBlock = 0, skippedHidden = 0;
  for (const e of entities || []) {
    if (boundaryIds.has(e.id) || e.hidden) continue;
    if (hiddenLayers.has(e.layer)) { skippedHidden++; continue; }
    if (!includeLocked && lockedLayers.has(e.layer)) { skippedLocked++; continue; }
    // 안쪽을 지울 때만 경계 상자와 겹치지 않는 객체를 건너뛴다. 바깥쪽을 지울 때는 멀리 있는 객체도 삭제 대상이다.
    if (deleteSide && !overlaps(e)) continue;
    const r = cutOne(e, polys, deletesAt, edges, hatchOpts, opts);
    if (!r) continue;
    if (r.skip === 'hatch') { skippedHatch++; continue; }
    if (r.skip === 'block') { skippedBlock++; skippedBlockNames.push(e.name || '(이름 없음)'); continue; }
    if (e.type === 'block' && !(r.add || []).length) removedBlockNames.push(e.name || '(이름 없음)');
    removeIds.push(e.id); touched++; add.push(...(r.add || []));
  }
  return { removeIds, add, touched, skippedLocked, skippedHatch, skippedBlock, skippedHidden, deleteSide, removedBlockNames, skippedBlockNames };
}
const nameSummary = (names, max = 6) => { const c = new Map(); for (const n of names) c.set(n, (c.get(n) || 0) + 1); const list = [...c].map(([n, k]) => k > 1 ? `${n}×${k}` : n); return list.slice(0, max).join(', ') + (list.length > max ? ` 외 ${list.length - max}종` : ''); };

/* ── BAT · 선 자르고 문자넣기 (xiBreakAndText, izzarder.com/487) ──
   방식 4종(위치지정/일정거리 반복/중간 점/임의 한 점) 중 하나로 자를 위치를 정하고, 그 자리를
   "자르는 거리"만큼 비운 뒤 가운데에 문자를 넣는다. */
export const BAT_MAX_REPEAT = 200;
/** BAT 저장값 v1 → v2 이전(검토자 재지적 · 경미): v2 가 없고 v1 이 있으면 종이 mm 기준 옛 기본값(문자간 20·자르는 5·크기 2.5)만 버리고
 *  나머지 저장값(문자·각도·켜·칸 이름 등)은 그대로 옮긴다. v1 은 지우지 않는다. 이전했으면 true. */
export const BAT_V1_DEFAULTS = Object.freeze({ gap: 20, cutLen: 5, height: 2.5 });
export function migrateBatStorage(storage, fromKey = 'trim-bat-v1', toKey = 'trim-bat-v2') {
  if (!storage?.getItem) return false;
  if (storage.getItem(toKey)) return false;
  let raw = null; try { raw = JSON.parse(storage.getItem(fromKey) || 'null'); } catch { raw = null; }
  if (!raw || typeof raw !== 'object') return false;
  const presets = Array.isArray(raw.presets) ? raw.presets.map((p) => {
    if (!p || typeof p !== 'object') return p;
    const next = { ...p };
    for (const [key, oldDefault] of Object.entries(BAT_V1_DEFAULTS)) if (Number(next[key]) === oldDefault) delete next[key];
    return next;
  }) : [];
  storage.setItem(toKey, JSON.stringify({ presets, shared: raw.shared || {}, selected: raw.selected || 0 }));
  return true;
}
export function repeatPositions(total, gap, halfFirst, maxCount = BAT_MAX_REPEAT) {
  if (!Number.isFinite(gap) || gap <= 0) throw Error('문자간 거리는 양수여야 합니다.');
  const start = halfFirst ? gap / 2 : gap;
  const expected = Math.floor((total - 1e-6 - start) / gap) + 1;
  if (expected > maxCount) throw Error(`문자간 거리 ${gap}mm 로는 문자가 ${expected}개 생깁니다(최대 ${maxCount}개). 문자간 거리를 늘리세요.`);
  const list = [];
  for (let a = start; a < total - 1e-6; a += gap) list.push(a);
  if (!list.length) throw Error('선이 문자간 거리보다 짧습니다.');
  return list;
}
export function breakWindowsAndText(e, alongs, cutLen, textOf) {
  if (!Number.isFinite(cutLen) || cutLen <= 0) throw Error('자르는 거리는 양수여야 합니다.');
  if (!alongs?.length) throw Error('문자를 넣을 위치가 없습니다.');
  const { segs, total } = pathSegs(e);
  const half = cutLen / 2;
  const windows = alongs.map((a) => [Math.max(0, a - half), Math.min(total, a + half)]).sort((x, y) => x[0] - y[0]);
  const merged = [];
  for (const w of windows) { const last = merged.at(-1); if (last && w[0] <= last[1] + 1e-6) last[1] = Math.max(last[1], w[1]); else merged.push([...w]); }
  const marks = [0];
  for (const [lo, hi] of merged) marks.push(lo, hi);
  marks.push(total);
  const rest = stripEntity(e);
  const pieces = [];
  for (let i = 0; i < marks.length - 1; i += 2) if (marks[i + 1] - marks[i] > 1e-6) pieces.push(asPiece(rest, buildRun(segs, total, marks[i], marks[i + 1])));
  const texts = alongs.map((a) => textOf(pointAtAlong(segs, total, a), directionAtAlong(segs, a)));
  return { pieces, texts };
}

/** BAT 위치지정: 고른 (선, 점) 들을 선별로 모아 한 번에 자른다. 2026-10-06(봇 점검): 예전에는 같은 선을 두 번 고르면
 *  원래 선을 두 번 지우고 한 곳씩 자른 조각을 두 벌 넣어, 겹친 선이 남고 첫 번째 틈이 메워졌다. */
export function batPositionPlan(picks, cutLen, textOf) {
  const byId = new Map();
  for (const { entity, point } of picks || []) {
    const { segs } = pathSegs(entity);
    const along = projectAlong(point, segs).along;
    const slot = byId.get(entity.id) || byId.set(entity.id, { entity, alongs: [] }).get(entity.id);
    slot.alongs.push(along);
  }
  const removeIds = [], add = [];
  for (const { entity, alongs } of byId.values()) {
    const { pieces, texts } = breakWindowsAndText(entity, alongs, cutLen, textOf);
    removeIds.push(entity.id); add.push(...pieces, ...texts);
  }
  return { removeIds, add, done: byId.size };
}

/* ── 카드 진입점 ── */
export function installTrimTools(ctx) {
  const fail = (e) => { console.error('[card]', e); ctx.toast(ctx.userErrorMessage(e), true); };
  async function pickMany(prompt, types) {
    const list = [];
    for (;;) {
      const e = await ctx.pickEntity({ prompt: `${prompt} · Esc: 선택 마침${list.length ? ' · 지금까지 ' + list.length + '개' : ''}`, types });
      if (!e) break;
      /* 2026-10-06(봇 점검): 같은 객체를 두 번 고르면 BRO·DTP 가 같은 대상을 두 번 지우고 조각을 두 벌 넣었다.
         trim-shape-tools-4.js pickMany 처럼 이미 고른 객체는 다시 넣지 않는다. */
      if (!list.some((x) => x.id === e.id)) list.push(e);
    }
    return list;
  }

  /* CUT */
  const CUT_STORAGE = 'trim-cut-v1';
  const CUT_FIELDS = [
    { key: 'includeLocked', label: '잠긴 객체 포함', type: 'check', def: false, group: '설정' },
    { key: 'multi', label: '선택 영역 모든 객체 삭제(여러 객체)', type: 'check', def: false, group: '설정' },
    { key: 'blockExplode', label: '블럭 폭파', type: 'check', def: false, group: '설정', when: (v) => !v.multi },
    { key: 'hatchExplode', label: '해치 폭파', type: 'check', def: false, group: '설정', when: (v) => !v.multi },
    { key: 'replaceSolidHatch', label: '솔리드를 다른 해치로 변경', type: 'check', def: false, group: '해치 폭파 하위 옵션', when: (v) => !v.multi && v.hatchExplode },
    { key: 'hatchName', label: '해치이름', type: 'text', def: 'ANSI31', group: '해치 폭파 하위 옵션', when: (v) => !v.multi && v.hatchExplode },
    { key: 'hatchScale', label: '해치축척', type: 'number', def: 3, group: '해치 폭파 하위 옵션', when: (v) => !v.multi && v.hatchExplode },
    { key: 'hatchAngle', label: '해치각도', type: 'number', def: 0, group: '해치 폭파 하위 옵션', when: (v) => !v.multi && v.hatchExplode },
  ];
  function cutPreviewSvg(v, shared, { width, height, compact }) {
    const boundary = { type: 'polyline', closed: true, points: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }] };
    const cross = { type: 'line', points: [{ x: -30, y: 30 }, { x: 130, y: 30 }], previewColor: '#ff9f68' };
    const note = { type: 'text', position: { x: 50, y: -18 }, text: v.multi ? '여러 경계 내부 자동 삭제' : '점을 클릭한 쪽을 삭제', height: 10, rotation: 0, align: 'center' };
    return entitiesSvg([boundary, cross, note], { width, height, compact, label: 'CUT · 경계와 자를 방향' });
  }
  async function runCUT() {
    try {
      openCardDialog({
        ctx, title: 'CUT · 경계 만들고 자르기', storageKey: CUT_STORAGE, fields: CUT_FIELDS, slots: 1, fixedNames: ['설정'],
        preview: cutPreviewSvg, goLabel: '경계·점 지정 시작',
        note: '경계를 먼저 지정하고, 여러 객체 모드가 아니면 삭제할 쪽의 점을 한 번 클릭합니다.',
        onGo: async (v) => {
          const boundaries = v.multi ? await pickMany('CUT · 경계(닫힌 폴리선/사각형/원)를 선택하세요', ['polyline', 'rectangle', 'circle']) : [];
          if (!v.multi) {
            const b = await ctx.pickEntity({ prompt: 'CUT · 경계(닫힌 폴리선/사각형/원)를 선택하세요 · Esc 취소', types: ['polyline', 'rectangle', 'circle'] });
            if (!b) return;
            boundaries.push(b);
          }
          if (!boundaries.length) { ctx.toast('경계를 선택하지 않았습니다.'); return; }
          let pick = null;
          if (!v.multi) { pick = await ctx.pickPoint('CUT · 삭제할 쪽의 점을 클릭하세요 · Esc 취소'); if (!pick) return; }
          const r = cutTargetsByBoundary({ entities: ctx.entities(), boundaries, pick, multi: v.multi, includeLocked: v.includeLocked, blockExplode: v.blockExplode, hatchExplode: v.hatchExplode, hatchOpts: v, layers: ctx.layers() });
          if (!r.touched) { ctx.toast('경계 안팎에서 자를 객체를 찾지 못했습니다.', true); return; }
          const notes = [];
          if (r.skippedHatch) notes.push(`해치 ${r.skippedHatch}개는 "해치 폭파"를 켜지 않아 그대로 두었습니다`);
          if (r.skippedBlock) notes.push(`경계에 걸친 블록 ${r.skippedBlock}개는 "블럭 폭파"를 켜지 않았거나 공유 블록이라 그대로 두었습니다`);
          if (r.skippedLocked) notes.push(`잠긴 켜의 객체 ${r.skippedLocked}개는 제외했습니다`);
          if (r.skippedHidden) notes.push(`꺼진·동결 켜의 객체 ${r.skippedHidden}개는 제외했습니다`);
          const finish = () => {
            ctx.commit({ removeIds: r.removeIds, entities: r.add });
            ctx.toast(`CUT · ${r.touched}개 정리${notes.length ? ' · ' + notes.join(' · ') : ''} · Ctrl+Z 로 되돌리기`);
          };
          if (!v.multi && !r.deleteSide) {
            // 바깥쪽 삭제는 도면 전체가 대상이라 개수·블록 이름을 보여 주고 한 번 더 확인한다(검토자 지적 5·재지적 ①).
            const fullyRemoved = r.removeIds.length - r.add.length;
            const blockNote = r.removedBlockNames.length ? ` · 삭제될 블록: ${nameSummary(r.removedBlockNames)}` : ' · 삭제될 블록 없음';
            const keepNote = r.skippedBlockNames.length ? ` · 경계를 감싸거나 걸친 블록은 보존: ${nameSummary(r.skippedBlockNames)}` : '';
            ctx.form(`CUT · 경계 바깥을 지웁니다 · 객체 ${r.touched}개 영향(통째로 삭제 약 ${Math.max(0, fullyRemoved)}개, 나머지는 경계에서 잘림)${blockNote}${keepNote}`, [
              { name: 'confirm', label: '경계 바깥의 객체를 모두 지웁니다(Ctrl+Z 로 되돌릴 수 있음). 확인', type: 'checkbox', value: '' },
            ], (values) => { if (values.confirm !== 'on') throw Error('확인 체크박스를 선택해야 지웁니다.'); finish(); });
            return;
          }
          finish();
        },
      });
    } catch (e) { fail(e); }
  }

  /* FE */
  async function runFE() {
    try {
      ctx.askNumber({ title: 'FE · 길이 남기고 모따기', label: '남길 길이 (mm, 0=끝점까지)', value: 0, min: 0, allowZero: true }, async (keep) => {
        const a = await ctx.pickEntity({ prompt: 'FE · 첫째 직선을 선택하세요 · Esc 취소', types: ['line'] });
        if (!a) return;
        const b = await ctx.pickEntity({ prompt: 'FE · 둘째 직선을 선택하세요 · Esc 취소', types: ['line'] });
        if (!b) return;
        if (b.id === a.id) { ctx.toast('FE · 같은 직선을 두 번 골랐습니다. 서로 다른 두 직선을 선택하세요.', true); return; }
        const entities = filletExtend(a, b, keep);
        ctx.commit({ removeIds: [a.id, b.id], entities });
        ctx.toast('FE · 남기고 모따기했습니다 · Ctrl+Z 로 되돌리기');
      });
    } catch (e) { fail(e); }
  }

  /* DTP */
  async function runDTP() {
    try {
      const picked = await pickMany('DTP · 직선으로 나눌 폴리선/호/원/타원을 선택하세요', ['polyline', 'rectangle', 'circle', 'arc', 'ellipse']);
      if (!picked.length) { ctx.toast('선택한 객체가 없습니다.'); return; }
      ctx.askNumber({ title: 'DTP · 곡선을 직선 조합으로 분할', label: '직선 해상도(분할 개수)', value: 16 }, async (n) => {
        const entities = picked.map((e) => divideToPolyline(e, Math.round(n)));
        ctx.commit({ removeIds: picked.map((e) => e.id), entities });
        ctx.toast(`DTP · ${picked.length}개를 직선 폴리선으로 바꿨습니다 · Ctrl+Z 로 되돌리기`);
      });
    } catch (e) { fail(e); }
  }

  /* BB */
  async function runBB() {
    try {
      const e = await ctx.pickEntity({ prompt: 'BB · 자르고 현재 켜로 넣을 객체(선·폴리선·원)를 선택하세요 · Esc 취소', types: ['line', 'polyline', 'circle'] });
      if (!e) return;
      const path = await ctx.pickPath({ prompt: 'BB · 자를 두 점을 지정하세요 · Esc 취소', minPoints: 2, maxPoints: 2 });
      if (!path) return;
      const [p1, p2] = path.points;
      const r = breakToCurrentLine(e, p1, p2, p1);
      const layer = ctx.activeLayer();
      ctx.commit({ removeIds: [e.id], entities: [...r.keep, { ...r.cut, layer }] });
      ctx.toast('BB · 잘린 자리를 현재 켜로 다시 넣었습니다 · Ctrl+Z 로 되돌리기');
    } catch (e) { fail(e); }
  }

  /* BRO */
  async function runBRO() {
    try {
      const bases = await pickMany('BRO · 기준 객체를 선택하세요', ['line', 'polyline', 'rectangle', 'circle', 'arc']);
      if (!bases.length) { ctx.toast('기준 객체를 선택하지 않았습니다.'); return; }
      const targets = await pickMany('BRO · 끊을 대상(선·폴리선)을 선택하세요', ['line', 'polyline', 'rectangle']);
      if (!targets.length) { ctx.toast('끊을 대상을 선택하지 않았습니다.'); return; }
      const removeIds = [], add = [];
      let touched = 0;
      for (const t of targets) {
        const pieces = breakAtIntersections(t, bases);
        if (!pieces) continue;
        removeIds.push(t.id); add.push(...pieces); touched++;
      }
      if (!touched) { ctx.toast('기준 객체와 만나는 대상이 없습니다.', true); return; }
      ctx.commit({ removeIds, entities: add });
      ctx.toast(`BRO · ${touched}개를 끊었습니다 · Ctrl+Z 로 되돌리기`);
    } catch (e) { fail(e); }
  }

  /* DIB */
  async function runDIB() {
    try {
      const picked = await pickMany('DIB · 다이아그램을 이룰 닫힌 폴리선들을 선택하세요', ['polyline', 'rectangle']);
      if (picked.length < 2) { ctx.toast('변을 공유하는 닫힌 폴리선을 2개 이상 선택하세요.', true); return; }
      ctx.askNumber({ title: 'DIB · 다이아그램 만들기', label: '전체 이격 거리 (mm)', value: 600 }, async (gap) => {
        const results = diagramBoxes(picked.map((e) => e.points), gap);
        const commands = picked.map((e, i) => ({ type: 'update', ids: [e.id], changes: { points: results[i] } }));
        ctx.execute({ type: 'batch', commands });
        ctx.setSelected(picked.map((e) => e.id)); ctx.refresh();
        ctx.toast(`DIB · ${picked.length}개 면을 ${gap}mm 벌렸습니다 · Ctrl+Z 로 되돌리기`);
      });
    } catch (e) { fail(e); }
  }

  /* BAT */
  /* 2026-09-24 검토 F16: 원문 기본값(문자간 20·크기 2.5)은 종이 mm 기준이라 mm 도면에서는 6m 벽선 하나에 문자 240개가 생겼다.
     기본 문자 크기는 도면의 문자 높이 설정(text-height)을 따르고, 문자간 거리는 그 8배, 자르는 거리는 문자 폭 정도로 둔다.
     저장 키를 v2 로 올려 예전 기본값(2.5mm·20mm)이 그대로 남지 않게 하고(검토자 지적 9 · v1 저장값은 지우지 않음),
     기본값은 실행할 때마다 현재 문자 높이 설정으로 다시 계산한다. */
  const BAT_STORAGE = 'trim-bat-v2';
  const batTextHeight = () => { const h = Number(ctx.num?.('text-height', 150)); return Number.isFinite(h) && h > 0 ? h : 150; };
  const migrateBat = () => { try { migrateBatStorage(ctx.storage); } catch (e) { console.error('[card] BAT 저장값 이전 실패', e); } };
  const batFields = () => {
    const h = batTextHeight();
    return [
      { key: 'gap', label: '문자간 거리 (mm) · 일정거리 반복 방식', type: 'number', def: Math.round(h * 8), min: 1, group: '배치' },
      { key: 'cutLen', label: '자르는 거리 (mm)', type: 'number', def: Math.round(h * 1.5), min: 0.1, group: '배치' },
      { key: 'halfFirst', label: '첫문자는 문자 간격의 절반', type: 'check', def: true, group: '배치' },
      { key: 'angleMode', label: '문자 각도', type: 'select', def: 'parallel', group: '문자', options: [['0', '0도'], ['parallel', '선과 평행'], ['perp', '선과 직각']] },
      { key: 'text', label: '문자', type: 'text', def: 'F', group: '문자' },
      { key: 'height', label: '크기 (mm)', type: 'number', def: h, min: 0.1, group: '문자' },
      { key: 'layer', label: '켜', type: 'layer', def: STD_LAYERS.text, group: '문자' },
    ];
  };
  const batRotation = (angleMode, dir) => readableAngle(angleMode === '0' ? 0 : angleMode === 'perp' ? G.angle(dir) + 90 : G.angle(dir));
  function batTextOf(v, layerId) {
    return (p, dir) => ({ type: 'text', position: p, text: v.text || 'F', height: Math.max(0.1, v.height), rotation: batRotation(v.angleMode, dir), align: 'center', layer: layerId });
  }
  function batPreviewSvg(v, shared, { width, height, compact }) {
    const total = 180, sample = { type: 'line', points: [{ x: 0, y: 0 }, { x: total, y: 0 }] };
    let alongs;
    try { alongs = repeatPositions(total, Math.max(1, v.gap), v.halfFirst).slice(0, 6); } catch { alongs = [total / 2]; }
    try {
      const { pieces, texts } = breakWindowsAndText(sample, alongs, Math.max(0.1, v.cutLen), batTextOf(v, null));
      return entitiesSvg([...pieces, ...texts], { width, height, compact, label: 'BAT 미리보기(일정거리 반복 기준)' });
    } catch (e) { return entitiesSvg([sample], { width, height, compact, label: e.message }); }
  }
  async function runBAT() {
    try {
      migrateBat();
      openCardDialog({
        ctx, title: 'BAT · 선 자르고 문자넣기', storageKey: BAT_STORAGE, fields: batFields(), slots: 1, fixedNames: ['설정'],
        preview: batPreviewSvg, goLabel: '대상 선택 시작',
        methods: { legend: '방식', def: 'position', options: [
          ['position', '위치지정', '여러 선에 각각 한 점씩(선만) · 기본'],
          ['repeat', '일정거리 반복', `문자간 거리마다 반복(선 하나에 최대 ${BAT_MAX_REPEAT}개)`],
          ['mid', '중간 점', '선의 가운데 한 곳'],
          ['random', '임의 한 점', '클릭한 한 점'],
        ] },
        validate: (v) => { if (!v.text.trim()) throw Error('문자를 입력하세요.'); },
        onGo: async (v, shared, method) => {
          const layerId = ctx.ensureLayer(v.layer || STD_LAYERS.text, '#ffffff');
          const textOf = batTextOf(v, layerId);
          const removeIds = [], add = [];
          let done = 0;
          if (method === 'position') {
            const picks = [];
            for (;;) {
              const e = await ctx.pickEntity({ prompt: `BAT · 위치지정 · 선을 선택하세요(문자를 넣을 위치를 이어서 클릭) · Esc 로 끝내기${picks.length ? ' · 지금까지 ' + picks.length + '곳' : ''}`, types: ['line'] });
              if (!e) break;
              const p = await ctx.pickPoint('BAT · 문자를 넣을 위치를 클릭하세요 · Esc 취소');
              if (!p) continue;
              picks.push({ entity: e, point: p });
            }
            const plan = batPositionPlan(picks, v.cutLen, textOf);
            removeIds.push(...plan.removeIds); add.push(...plan.add); done = plan.done;
          } else {
            const e = await ctx.pickEntity({ prompt: 'BAT · 자를 선/폴리선을 선택하세요 · Esc 취소', types: ['line', 'polyline'] });
            if (e) {
              const { segs, total } = pathSegs(e);
              let alongs;
              if (method === 'repeat') alongs = repeatPositions(total, v.gap, v.halfFirst);
              else if (method === 'mid') alongs = [total / 2];
              else {
                const p = await ctx.pickPoint('BAT · 문자를 넣을 위치를 클릭하세요 · Esc 취소');
                if (!p) return;
                alongs = [projectAlong(p, segs).along];
              }
              const { pieces, texts } = breakWindowsAndText(e, alongs, v.cutLen, textOf);
              removeIds.push(e.id); add.push(...pieces, ...texts); done++;
            }
          }
          if (!done) { ctx.toast('선택한 대상이 없습니다.'); return; }
          ctx.commit({ removeIds, entities: add });
          ctx.toast(`BAT · ${done}개 선에 문자를 넣었습니다 · Ctrl+Z 로 되돌리기`);
        },
      });
    } catch (e) { fail(e); }
  }

  return { CUT: runCUT, FE: runFE, BAT: runBAT, BB: runBB, BRO: runBRO, DIB: runDIB, DTP: runDTP };
}
