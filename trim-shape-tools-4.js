// 4차 "부분" 매핑 되만들기 — 자르기·끌기 FM(470) STR(132) XT(259) B(411) 와 도형·선 DRL(506) PVL(90).
// 정리본 05-trim-stretch.md·06-multitool.md·14-shape-line.md 와 각 원문(izzarder.com/번호)을 근거로 조작 순서를 그대로 옮겼다.
// 기존 매핑 MULTIFILLET·STRETCH·TRIMEXTEND·BREAKMULTI·PLINEEDIT·COORDINATES 를 대신한다(기존 명령은 손대지 않는다).
// 중복 확인(규칙 12절): FM 은 3차 edit-calc-tools.js 의 FR 카드와 겹친다 — 이 카드가 상위집합(기존 호 재정리·C300 문자 입력이 더 있다)이니
// 통합 때 FR 도 이 카드로 잇고 한쪽만 남긴다(보고서 2절 참고). 나머지 다섯은 1~3차에 같은 카드가 없다.
import * as G from './geometry.js';
import { STD_LAYERS, openCardDialog, entitiesSvg, resolveLayers } from './card-kit.js';
import { isChecked } from './card-input.js';

const CENTER_RE = /CNTR|GRID|CENTER|중심|(?:^|-)WALL-C(?:$|-)/i;
const TOL = 1e-3;

/* ── 공통 경로 도구(선·폴리선·사각형을 하나의 매개변수 경로로 본다). 3차 trim-tools.js 와 같은 방식이며
   공유 파일을 고치지 않기 위해 이 모듈에 따로 적는다. ── */
function stripEntity(e) {
  const { id, points, closed, type, center, radius, startAngle, endAngle, ...rest } = e;
  return rest;
}
export function pathSegs(e) {
  if (!Array.isArray(e?.points) || e.points.length < 2) throw Error('점이 두 개 이상인 선·폴리선이어야 합니다.');
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
export function projectAlong(p, segs) {
  let best = null;
  for (const s of segs) {
    if (s.len < G.EPS) { const d = G.dist(p, s.a); if (!best || d < best.dist) best = { along: s.start, dist: d, foot: s.a }; continue; }
    const v = G.sub(s.b, s.a),
      t = Math.max(0, Math.min(1, G.dot(G.sub(p, s.a), v) / (s.len * s.len))),
      foot = G.add(s.a, G.mul(v, t)),
      d = G.dist(p, foot);
    if (!best || d < best.dist) best = { along: s.start + t * s.len, dist: d, foot };
  }
  if (!best) throw Error('빈 경로입니다.');
  return best;
}
export function pointAtAlong(segs, total, along) {
  along = Math.max(0, Math.min(total, along));
  for (const s of segs) if (along <= s.start + s.len + 1e-7) return s.len < G.EPS ? s.a : G.add(s.a, G.mul(G.sub(s.b, s.a), (along - s.start) / s.len));
  return segs.length ? segs.at(-1).b : null;
}
export function buildRun(segs, total, from, to) {
  const pts = [pointAtAlong(segs, total, from)];
  for (const s of segs) if (s.start > from + 1e-7 && s.start < to - 1e-7) pts.push(s.a);
  pts.push(pointAtAlong(segs, total, to));
  return pts;
}
const asPiece = (rest, pts) => (pts.length === 2 ? { ...rest, type: 'line', points: pts } : { ...rest, type: 'polyline', closed: false, points: pts });
export const isCenterlineEntity = (e, layers = []) =>
  CENTER_RE.test(String(e?.linetype || '')) || (layers || []).some((l) => l.id === e?.layer && (CENTER_RE.test(l.name) || CENTER_RE.test(String(l.linetype || ''))));

/* ════════ FM · 여러선 필렛 (xiFilletMulti, izzarder.com/470) ════════
   원문: "반지름 값을 문자로 입력", 숫자 앞에 C 를 붙이면(C300) 챔퍼. 여러 선 또는 폴리선을 한번에.
   이미 필렛된 모서리는 기존 호를 지우고 새 반경으로 재정리. */
export function parseFilletInput(text) {
  const s = String(text ?? '').trim();
  if (!s) throw Error('반지름을 입력하세요. 숫자 앞에 C 를 붙이면 모따기(챔퍼)입니다. 예: 300, C300');
  const chamfer = /^c/i.test(s);
  const n = Number(chamfer ? s.slice(1) : s);
  if (!Number.isFinite(n) || n < 0) throw Error('반지름/모따기 거리는 0 이상의 숫자여야 합니다. 예: 300, C300');
  return { chamfer, size: n };
}
/** 끝점이 p 에 닿는 선을 찾는다. */
function findLineEnd(lines, p, tol) {
  for (const line of lines) for (let i = 0; i < 2; i++) if (G.dist(line.points[i], p) < tol) return { line, index: i };
  return null;
}
/** 기존 호 재정리: 선택 안의 호 가운데 두 선의 끝점에 맞닿은 것(=이전 필렛 결과)을 지우고 두 선을 원래 교차점까지 되돌린다. */
export function absorbFilletArcs(lines, arcs, tol = 0.5) {
  const out = lines.map((l) => ({ ...l, points: l.points.map((p) => ({ x: p.x, y: p.y })) }));
  const used = [];
  for (const arc of arcs || []) {
    if (arc.type !== 'arc') continue;
    const a = G.add(arc.center, G.polar(arc.radius, arc.startAngle)), b = G.add(arc.center, G.polar(arc.radius, arc.endAngle));
    const hitA = findLineEnd(out, a, tol), hitB = findLineEnd(out, b, tol);
    if (!hitA || !hitB || hitA.line === hitB.line) continue;
    const h = G.lineIntersection(...hitA.line.points, ...hitB.line.points);
    if (!h) continue;
    hitA.line.points[hitA.index] = { x: h.point.x, y: h.point.y };
    hitB.line.points[hitB.index] = { x: h.point.x, y: h.point.y };
    used.push(arc);
  }
  return { lines: out, arcs: used };
}
/** 끝점이 이어진 열린 선 묶음을 순서대로 세운다(workflows.js MULTIFILLET 의 계산을 옮겨 적었다). */
export function chainLines(lines, tol = TOL) {
  if (!Array.isArray(lines) || lines.length < 2) throw Error('끝점이 이어진 직선 두 개 이상을 선택하세요.');
  const near = (a, b) => G.dist(a, b) < tol, adj = lines.map(() => []);
  for (let i = 0; i < lines.length; i++) for (let j = i + 1; j < lines.length; j++)
    if (lines[i].points.some((a) => lines[j].points.some((b) => near(a, b)))) { adj[i].push(j); adj[j].push(i); }
  if (adj.some((a) => a.length > 2) || !adj.some((a) => a.length === 1)) throw Error('갈라지지 않은 열린 선 묶음만 연속 필렛할 수 있습니다.');
  const order = [], start = adj.findIndex((a) => a.length === 1);
  let previous = -1, current = start;
  while (current >= 0 && !order.includes(current)) { order.push(current); const next = adj[current].find((i) => i !== previous); previous = current; current = next ?? -1; }
  if (order.length !== lines.length) throw Error('모든 선의 끝점이 하나의 열린 경로로 이어져야 합니다.');
  const oriented = [];
  for (let k = 0; k < order.length; k++) {
    const source = { ...lines[order[k]], points: lines[order[k]].points.map((p) => ({ x: p.x, y: p.y })) }, ps = source.points;
    if (!k) { const next = lines[order[1]]; source.points = next.points.some((q) => near(ps[0], q)) ? [ps[1], ps[0]] : ps; }
    else source.points = near(ps[0], oriented[k - 1].points[1]) ? ps : [ps[1], ps[0]];
    oriented.push(source);
  }
  return oriented;
}
/** 폴리선의 모든 모서리를 한번에 필렛/챔퍼한다. 챔퍼는 폴리선 그대로, 필렛은 호가 필요해 선+호로 나뉜다. */
export function filletPolyline(e, size, chamfer) {
  const closed = e.type === 'rectangle' || !!e.closed;
  const pts = (e.points || []).map((p) => ({ x: p.x, y: p.y }));
  if (pts.length < 3) throw Error('정점 세 개 이상인 폴리선을 선택하세요.');
  const n = pts.length, rest = stripEntity(e), nodes = [], arcs = [];
  let skipped = 0;
  for (let i = 0; i < n; i++) {
    const corner = closed || (i > 0 && i < n - 1);
    if (!corner || size < G.EPS) { nodes.push([pts[i]]); continue; }
    const prev = pts[(i - 1 + n) % n], v = pts[i], next = pts[(i + 1) % n];
    let made = null;
    try { made = G.corner({ type: 'line', layer: e.layer, points: [prev, v] }, { type: 'line', layer: e.layer, points: [v, next] }, size, chamfer); }
    catch { skipped++; nodes.push([pts[i]]); continue; }
    const t1 = made[0].points[1], t2 = made[1].points[0];
    nodes.push([t1, t2]);
    if (!chamfer && made[2]) arcs.push({ ...rest, type: 'arc', center: made[2].center, radius: made[2].radius, startAngle: made[2].startAngle, endAngle: made[2].endAngle });
  }
  if (chamfer || !arcs.length) return { entities: [{ ...rest, type: 'polyline', closed, points: nodes.flat() }], skipped };
  const entities = [...arcs];
  const last = closed ? n : n - 1;
  for (let i = 0; i < last; i++) {
    const a = nodes[i].at(-1), b = nodes[(i + 1) % n][0];
    if (G.dist(a, b) > 1e-7) entities.push({ ...rest, type: 'line', points: [a, b] });
  }
  return { entities, skipped };
}
/** FM 본체. 선택 묶음(선·호·폴리선)을 받아 지울 것과 새로 넣을 것을 돌려준다. */
export function multiFillet(selection, { size, chamfer }) {
  if (!Number.isFinite(size) || size < 0) throw Error('반지름/모따기 거리는 0 이상이어야 합니다.');
  const lines = (selection || []).filter((e) => e.type === 'line'),
    arcs = (selection || []).filter((e) => e.type === 'arc'),
    polys = (selection || []).filter((e) => ['polyline', 'rectangle'].includes(e.type));
  if (!lines.length && !polys.length) throw Error('직선 두 개 이상 또는 폴리선을 선택하세요.');
  const removeIds = [], entities = [];
  let corners = 0, skipped = 0, reusedArcs = 0;
  for (const poly of polys) {
    const r = filletPolyline(poly, size, chamfer);
    removeIds.push(poly.id); entities.push(...r.entities);
    corners += (poly.points.length - (poly.type === 'rectangle' || poly.closed ? 0 : 2)) - r.skipped;
    skipped += r.skipped;
  }
  if (lines.length) {
    if (lines.length < 2) throw Error('직선은 두 개 이상 선택해야 연속 필렛이 됩니다(폴리선은 한 개도 됩니다).');
    const absorbed = absorbFilletArcs(lines, arcs);
    reusedArcs = absorbed.arcs.length;
    const oriented = chainLines(absorbed.lines);
    const starts = oriented.map((e) => e.points[0]), ends = oriented.map((e) => e.points[1]);
    for (let i = 0; i < oriented.length - 1; i++) {
      const made = G.corner({ ...oriented[i], points: [starts[i], ends[i]] }, { ...oriented[i + 1], points: [starts[i + 1], ends[i + 1]] }, size, chamfer);
      ends[i] = made[0].points[1]; starts[i + 1] = made[1].points[0];
      if (made[2]) entities.push({ ...stripEntity(oriented[i]), ...(made[2].type === 'arc' ? { type: 'arc', center: made[2].center, radius: made[2].radius, startAngle: made[2].startAngle, endAngle: made[2].endAngle } : { type: 'line', points: made[2].points }) });
      corners++;
    }
    for (let i = 0; i < oriented.length; i++) entities.push({ ...stripEntity(oriented[i]), type: 'line', points: [starts[i], ends[i]] });
    removeIds.push(...lines.map((e) => e.id), ...absorbed.arcs.map((a) => a.id));
  }
  return { removeIds, entities, corners, skipped, reusedArcs };
}

/* ════════ STR · 연속 잡아끌기 (xiStretch, izzarder.com/132) ════════
   설정 대화상자: [입력 방식] 거리·각도 따로 입력(기본) / 거리·각도 동시 입력, [빼기 기능] 상수 차감. */
/** 크로싱 상자 안의 정점만 골라 엔진 stretch 대상 목록을 만든다(app.js 2737행의 계산을 옮겨 적었다). */
export function crossingTargets(entities, a, b) {
  const inside = (v) => v.x >= Math.min(a.x, b.x) && v.x <= Math.max(a.x, b.x) && v.y >= Math.min(a.y, b.y) && v.y <= Math.max(a.y, b.y);
  const targets = [];
  for (const e of entities || []) {
    if (e.hidden) continue;
    const indices = (e.points || []).map((v, i) => (inside(v) ? i : -1)).filter((i) => i >= 0);
    const center = !!(e.center && inside(e.center)), position = !!(e.position && inside(e.position));
    if (indices.length || center || position) targets.push({ id: e.id, indices, center, position });
  }
  return targets;
}
/** 거리·각도(도)와 빼기 상수로 변위를 만든다. */
export function stretchDelta({ distance, angle, subtract = false, subtractBy = 0 }) {
  if (!Number.isFinite(distance)) throw Error('거리를 숫자로 입력하세요.');
  if (!Number.isFinite(angle)) throw Error('각도를 숫자로 입력하세요.');
  const by = subtract ? Number(subtractBy) || 0 : 0;
  const d = distance - by;
  if (Math.abs(d) < G.EPS) throw Error('빼고 남은 거리가 0 입니다. 거리 또는 뺄 거리를 고치세요.');
  const v = G.polar(d, angle);
  return { x: v.x, y: v.y, distance: d, subtracted: by };
}
/** 두 점으로 거리·각도를 한번에 얻는다(동시 입력). */
export function twoPointDelta(p1, p2) {
  const d = G.dist(p1, p2);
  if (d < G.EPS) throw Error('서로 다른 두 점을 지정하세요.');
  return { distance: d, angle: G.normalizeAngle(G.angle(G.sub(p2, p1))) };
}

/* ════════ XT · 자름과 연장을 동시에 (xiXT, izzarder.com/259) ════════
   남길 길이(기본 0) → 기준선 1회 → 대상 여러 선 → 방향 1회. 길면 자르고 짧으면 연장(같은 계산 한 번). */
function baseSegmentOf(base, ref) {
  if (!base) throw Error('기준선을 지정하세요.');
  if (base.type === 'line') return base.points;
  let best = null;
  for (const [a, b] of G.segments(base)) { const d = G.distanceToSegment(ref, a, b); if (!best || d < best.d) best = { d, seg: [a, b] }; }
  if (!best) throw Error('기준선에서 구간을 찾지 못했습니다.');
  return best.seg;
}
/** 대상 직선 하나를 기준선까지 자르거나 늘린다. pick 은 사용자가 클릭한 방향(좌/우) 점. */
export function trimExtendToBase(target, base, pick, keep = 0) {
  if (target?.type !== 'line') throw Error('XT 대상은 개별 직선입니다.');
  if (!Number.isFinite(keep) || keep < 0) throw Error('남길 길이는 0 이상이어야 합니다.');
  const mid = G.mul(G.add(target.points[0], target.points[1]), 0.5);
  const [ba, bb] = baseSegmentOf(base, mid);
  const h = G.lineIntersection(target.points[0], target.points[1], ba, bb);
  if (!h) throw Error('기준선과 평행한 선은 정리할 수 없습니다.');
  const nrm = G.normal(G.unit(G.sub(bb, ba)));
  const sign = Math.sign(G.dot(G.sub(pick, ba), nrm)) || 1;
  const ns = G.mul(nrm, sign);
  const d0 = G.dot(G.sub(target.points[0], ba), ns), d1 = G.dot(G.sub(target.points[1], ba), ns);
  const index = d0 >= d1 ? 0 : 1, was = index === 0 ? d0 : d1;
  const points = target.points.map((p) => ({ x: p.x, y: p.y }));
  points[index] = G.add(h.point, G.mul(ns, keep));
  if (G.dist(points[0], points[1]) < G.EPS) throw Error('정리하면 길이가 0 이 됩니다.');
  return { points, action: was > keep ? 'trim' : 'extend' };
}

/* ════════ B · 다중 끊기 (xiBreakMulti, izzarder.com/411) ════════
   여러 선형 객체를 고른 뒤 두 점 지정(그 구간을 들어냄) / 한 점+엔터(그 점에서 끊음) / 여러점 M(점마다 끊음). */
function breakCurve(e, points, mode) {
  const full = e.type === 'circle';
  const start = full ? 0 : e.startAngle, sweep = full ? 360 : G.normalizeAngle(e.endAngle - e.startAngle) || 360;
  const rest = stripEntity(e);
  const mk = (t0, t1) => ({ ...rest, type: 'arc', center: { x: e.center.x, y: e.center.y }, radius: e.radius, startAngle: G.normalizeAngle(start + t0), endAngle: G.normalizeAngle(start + t1) });
  const ts = points.map((p) => G.normalizeAngle(G.angle(G.sub(p, e.center)) - start)).map((t) => (full ? t : Math.max(0, Math.min(sweep, t)))).sort((a, b) => a - b);
  if (mode === 'gap') {
    if (ts.length !== 2) throw Error('두 점을 지정하세요.');
    if (ts[1] - ts[0] < 1e-7) throw Error('서로 다른 두 점을 지정하세요.');
    return full ? [mk(ts[1], ts[0] + 360)] : [...(ts[0] > 1e-7 ? [mk(0, ts[0])] : []), ...(ts[1] < sweep - 1e-7 ? [mk(ts[1], sweep)] : [])];
  }
  const marks = full ? [...ts, ts[0] + 360] : [0, ...ts.filter((t) => t > 1e-7 && t < sweep - 1e-7), sweep];
  const out = [];
  for (let i = 0; i < marks.length - 1; i++) if (marks[i + 1] - marks[i] > 1e-7) out.push(mk(marks[i], marks[i + 1]));
  return out;
}
/** 객체 하나를 지정한 점들에서 끊는다. mode 'gap'(두 점 사이 들어내기) | 'split'(점마다 끊기). null 이면 끊을 곳이 없다. */
export function breakMultiEntity(e, points, mode = 'gap') {
  if (!points?.length) throw Error('끊을 점을 지정하세요.');
  if (['circle', 'arc'].includes(e.type)) { const pieces = breakCurve(e, points, mode); return pieces.length ? { removeId: e.id, pieces } : null; }
  if (!['line', 'polyline', 'rectangle'].includes(e.type)) throw Error('B 는 선·폴리선·사각형·원·호에 적용됩니다.');
  const { segs, total, closed } = pathSegs(e);
  const rest = stripEntity(e);
  const alongs = points.map((p) => projectAlong(p, segs).along).sort((a, b) => a - b);
  if (mode === 'gap') {
    if (alongs.length !== 2) throw Error('두 점을 지정하세요.');
    const [lo, hi] = alongs;
    if (hi - lo < 1e-7) throw Error('서로 다른 두 점을 지정하세요.');
    if (closed) return { removeId: e.id, pieces: [asPiece(rest, [...buildRun(segs, total, hi, total), ...buildRun(segs, total, 0, lo).slice(1)])] };
    const before = lo > 1e-7 ? asPiece(rest, buildRun(segs, total, 0, lo)) : null;
    const after = hi < total - 1e-7 ? asPiece(rest, buildRun(segs, total, hi, total)) : null;
    const pieces = [before, after].filter(Boolean);
    return pieces.length ? { removeId: e.id, pieces } : null;
  }
  const marks = closed ? [...alongs, alongs[0] + total] : [0, ...alongs.filter((a) => a > 1e-7 && a < total - 1e-7), total];
  const pieces = [];
  for (let i = 0; i < marks.length - 1; i++) {
    const from = marks[i], to = marks[i + 1];
    if (to - from < 1e-7) continue;
    pieces.push(asPiece(rest, to > total ? [...buildRun(segs, total, from, total), ...buildRun(segs, total, 0, to - total).slice(1)] : buildRun(segs, total, from, to)));
  }
  return pieces.length > 1 || (closed && pieces.length) ? { removeId: e.id, pieces } : null;
}

/* ════════ DRL · 폴리선 방향 확인 (xi:DirectionLine, izzarder.com/506) ════════
   폴리선 또는 선의 진행 방향을 임시 화살표로 보여주고, 옵션으로 즉시 역전한다. */
/** 닫힌 폴리선의 진행 방향. 'ccw' | 'cw' | null(열린 선). */
export function pathDirection(e) {
  const closed = e?.type === 'rectangle' || !!e?.closed;
  if (!closed || !Array.isArray(e.points) || e.points.length < 3) return null;
  const s = e.points.reduce((sum, p, i) => sum + G.cross(p, e.points[(i + 1) % e.points.length]), 0);
  return s > 0 ? 'ccw' : 'cw';
}
/** 진행 방향 화살표(임시선). 구간마다 중점에 화살촉을 두고 시작점에 작은 원을 둔다. */
export function directionArrows(e, size) {
  const { segs, total } = pathSegs(e);
  const head = Number.isFinite(size) && size > 0 ? size : Math.max(total / 40, G.EPS);
  const out = [{ type: 'circle', center: segs[0].a, radius: head * 0.4 }];
  for (const s of segs) {
    if (s.len < G.EPS) continue;
    const u = G.unit(G.sub(s.b, s.a)), tip = G.add(s.a, G.mul(u, s.len / 2 + head / 2));
    for (const a of [150, -150]) out.push({ type: 'line', points: [tip, G.add(tip, G.mul(G.polar(1, G.angle(u) + a), head))] });
  }
  return out;
}
/** 방향 역전. 선은 두 점을 바꾸고 폴리선·사각형은 정점 순서를 뒤집는다. */
export function reversedPoints(e) {
  if (!Array.isArray(e?.points) || e.points.length < 2) throw Error('선 또는 폴리선을 선택하세요.');
  return e.points.map((p) => ({ x: p.x, y: p.y })).reverse();
}

/* ════════ PVL · 폴리선 정점 리스트 표만들기 (xiPlineVertListTable, izzarder.com/90) ════════
   대화상자 6그룹: 구분 / Z 좌표 포함 / 높이값 있는 2D 폴리선 / 동작 / 정렬기준점 및 순서 / 기타. */
export const PVL_KINDS = Object.freeze([['polyline', '폴리선'], ['point', '포인트'], ['circle', '원'], ['block', '블럭'], ['text', '문자']]);
export const PVL_PATTERNS = Object.freeze([['TL', '좌상 → 우하(가로 진행)'], ['TR', '우상 → 좌하(가로 진행)'], ['BL', '좌하 → 우상(가로 진행)'], ['BR', '우하 → 좌상(가로 진행)']]);
const numText = (n) => {
  const v = Math.round(Number(n) * 1000) / 1000;
  return Object.is(v, -0) ? '0' : String(v);
};
/** 구분에 맞는 좌표를 모은다. Z 는 바른 CAD 에 3D 좌표가 없어 0 으로 채운다(보고서 참고). */
export function collectCoordinates(entities, kind) {
  const out = [];
  for (const e of entities || []) {
    if (kind === 'polyline') {
      if (!['polyline', 'rectangle'].includes(e.type)) continue;
      (e.points || []).forEach((p, i) => out.push({ x: p.x, y: p.y, z: 0, sourceId: e.id, vertex: i }));
    } else if (kind === 'point' && e.type === 'point') out.push({ x: e.position.x, y: e.position.y, z: 0, sourceId: e.id, vertex: 0 });
    else if (kind === 'circle' && e.type === 'circle') out.push({ x: e.center.x, y: e.center.y, z: 0, sourceId: e.id, vertex: 0 });
    else if (kind === 'block' && e.type === 'block') out.push({ x: e.position.x, y: e.position.y, z: 0, sourceId: e.id, vertex: 0 });
    else if (kind === 'text' && e.type === 'text') out.push({ x: e.position.x, y: e.position.y, z: 0, sourceId: e.id, vertex: 0 });
  }
  return out;
}
/** 정렬기준점 및 순서. 오차(mm) 안의 점을 같은 줄로 묶어 진행 방향 패턴대로 번호를 매긴다. */
export function orderCoordinates(list, { pattern = 'TL', tolerance = 10, pickOrder = false } = {}) {
  const items = (list || []).map((p) => ({ ...p }));
  if (pickOrder) return items;
  const tol = Number.isFinite(tolerance) && tolerance >= 0 ? tolerance : 10;
  const topFirst = pattern === 'TL' || pattern === 'TR', leftFirst = pattern === 'TL' || pattern === 'BL';
  const sorted = items.slice().sort((a, b) => (topFirst ? b.y - a.y : a.y - b.y));
  const rows = [];
  for (const p of sorted) {
    const row = rows.at(-1);
    if (row && Math.abs(row.y - p.y) <= tol) row.items.push(p);
    else rows.push({ y: p.y, items: [p] });
  }
  return rows.flatMap((r) => r.items.sort((a, b) => (leftFirst ? a.x - b.x : b.x - a.x)));
}
/** 좌표 표(머리글 + 행). */
export function coordinateRows(list, { includeZ = false } = {}) {
  const head = ['번호', 'X', 'Y', ...(includeZ ? ['Z'] : [])];
  return [head, ...(list || []).map((p, i) => [String(i + 1), numText(p.x), numText(p.y), ...(includeZ ? [numText(p.z ?? 0)] : [])])];
}
export const rowsToTsv = (rows) => (rows || []).map((r) => r.join('\t')).join('\n');
/** 붙여넣은 표(탭·쉼표·공백 구분)를 좌표로 되읽는다. 번호 열이 있으면 자동으로 뗀다. */
export function parseCoordinateRows(text, { includeZ = false } = {}) {
  const want = includeZ ? 3 : 2;
  const points = [];
  for (const raw of String(text ?? '').split(/\r?\n/)) {
    const cells = raw.split(/[\t,;]|\s+/).map((s) => s.trim()).filter(Boolean);
    if (!cells.length) continue;
    const nums = cells.map(Number);
    if (nums.some((n) => !Number.isFinite(n))) continue;
    const use = nums.length > want ? nums.slice(nums.length - want) : nums;
    if (use.length < 2) continue;
    points.push({ x: use[0], y: use[1], z: includeZ ? use[2] ?? 0 : 0 });
  }
  if (points.length < 2) throw Error('좌표 두 줄 이상이 필요합니다. 숫자만 있는 행을 붙여넣으세요.');
  return points;
}
/** 좌표 표를 캐드 객체(칸선 + 문자)로 만든다. */
export function tableEntities(rows, { origin, height = 2.5, layerName = STD_LAYERS.text } = {}) {
  if (!rows?.length) throw Error('표로 만들 행이 없습니다.');
  const cols = rows[0].length, cw = rows[0].map((_, c) => Math.max(...rows.map((r) => String(r[c]).length)) * height * 0.75 + height * 1.2);
  const rh = height * 2, x0 = origin?.x ?? 0, y0 = origin?.y ?? 0;
  const xs = [x0];
  for (const w of cw) xs.push(xs.at(-1) + w);
  const out = [];
  for (let r = 0; r <= rows.length; r++) out.push({ type: 'line', points: [{ x: xs[0], y: y0 - r * rh }, { x: xs[cols], y: y0 - r * rh }], cardLayer: layerName });
  for (let c = 0; c <= cols; c++) out.push({ type: 'line', points: [{ x: xs[c], y: y0 }, { x: xs[c], y: y0 - rows.length * rh }], cardLayer: layerName });
  rows.forEach((row, r) => row.forEach((cell, c) => out.push({ type: 'text', position: { x: (xs[c] + xs[c + 1]) / 2, y: y0 - r * rh - rh / 2 }, text: String(cell), height, rotation: 0, align: 'center', cardLayer: layerName })));
  return out;
}
/** 정점에 번호 넣기. */
export function vertexNumberTexts(list, { height = 2, layerName = STD_LAYERS.text } = {}) {
  return (list || []).map((p, i) => ({ type: 'text', position: { x: p.x + height * 0.6, y: p.y + height * 0.6 }, text: String(i + 1), height, rotation: 0, align: 'left', cardLayer: layerName }));
}

/* ════════ 카드 진입점 ════════ */
export function installTrimShapeTools4(ctx) {
  const fail = (e) => { console.error('[card]', e); ctx.toast(ctx.userErrorMessage(e), true); };
  const askForm = (title, fields) => new Promise((resolve) => { ctx.form(title, fields, (values) => { setTimeout(() => resolve(values), 0); }); });
  const numOf = (v, def = 0) => { const n = Number(v); return Number.isFinite(n) ? n : def; };
  async function pickMany(prompt, types) {
    const list = [];
    for (;;) {
      const e = await ctx.pickEntity({ prompt: `${prompt} · Esc: 선택 마침${list.length ? ' · 지금까지 ' + list.length + '개' : ''}`, types });
      if (!e) break;
      if (!list.some((x) => x.id === e.id)) list.push(e);
    }
    return list;
  }
  const selectedOr = async (prompt, types) => {
    const chosen = (ctx.selected() || []).filter((e) => types.includes(e.type));
    return chosen.length ? chosen : await pickMany(prompt, types);
  };
  async function toClipboard(text, title) {
    try { await navigator.clipboard.writeText(text); return true; }
    catch { await askForm(title, [{ name: 'rows', label: '표 내용(복사해서 엑셀에 붙여넣으세요)', type: 'textarea', value: text }]); return false; }
  }

  /* ── FM · 여러선 필렛 ── */
  async function runFM() {
    try {
      const picked = await selectedOr('FM · 필렛할 선·호·폴리선을 선택하세요', ['line', 'arc', 'polyline', 'rectangle']);
      if (!picked.length) { ctx.toast('선택한 객체가 없습니다.'); return; }
      const v = await askForm('FM · 여러선 필렛', [{ name: 'radius', label: '반지름 (숫자 앞에 C 를 붙이면 모따기. 예: 300, C300)', type: 'text', value: String(ctx.storage?.getItem('trim4-fm-radius') || '300') }]);
      const { chamfer, size } = parseFilletInput(v.radius);
      try { ctx.storage?.setItem('trim4-fm-radius', String(v.radius).trim()); } catch {}
      const r = multiFillet(picked, { size, chamfer });
      if (!r.entities.length) { ctx.toast('정리할 모서리를 찾지 못했습니다.', true); return; }
      ctx.commit({ removeIds: r.removeIds, entities: r.entities });
      const notes = [];
      if (r.reusedArcs) notes.push(`기존 호 ${r.reusedArcs}개를 지우고 새 반경으로 재정리`);
      if (r.skipped) notes.push(`${r.skipped}개 모서리는 크기가 선보다 커 건너뜀`);
      ctx.toast(`FM · ${chamfer ? '모따기' : '필렛'} ${size}${notes.length ? ' · ' + notes.join(' · ') : ''} · Ctrl+Z 로 되돌리기`);
    } catch (e) { fail(e); }
  }

  /* ── STR · 연속 잡아끌기 ── */
  const STR_STORAGE = 'trim4-str-v1';
  const STR_FIELDS = [
    { key: 'mode', label: '방식', type: 'select', def: 'separate', group: '입력 방식', options: [['separate', '거리, 각도 따로 입력'], ['both', '거리, 각도 동시 입력']] },
    { key: 'onScreen', label: '거리·각도를 화면에서 지정', type: 'check', def: false, group: '입력 방식', when: (v) => v.mode === 'separate', hint: '끄면 아래 숫자를 그대로 씁니다' },
    { key: 'distance', label: '거리 (mm)', type: 'number', def: 1500, group: '입력 방식', when: (v) => v.mode === 'separate' && !v.onScreen },
    { key: 'angle', label: '각도 (도)', type: 'number', def: 0, group: '입력 방식', when: (v) => v.mode === 'separate' && !v.onScreen },
    { key: 'subtract', label: '빼기 기능', type: 'check', def: false, group: '빼기 기능' },
    { key: 'subtractBy', label: '뺄 거리 (mm)', type: 'number', def: 2, group: '빼기 기능', when: (v) => v.subtract, hint: '1500 을 넣어도 실제로는 1498 만큼 늘립니다' },
  ];
  function strPreviewSvg(v, shared, { width, height, compact }) {
    const d = v.mode === 'both' ? 120 : Math.max(10, Math.min(160, v.distance / 12)) - (v.subtract ? Math.min(20, v.subtractBy) : 0);
    const a = v.mode === 'both' ? 20 : v.angle;
    const wall = { type: 'polyline', points: [{ x: 0, y: 0 }, { x: 120, y: 0 }, { x: 120, y: 60 }, { x: 0, y: 60 }], closed: false };
    const box = { type: 'polyline', closed: true, points: [{ x: 90, y: -15 }, { x: 150, y: -15 }, { x: 150, y: 75 }, { x: 90, y: 75 }], linetype: 'DASHED' };
    const arrow = { type: 'line', points: [{ x: 120, y: 30 }, G.add({ x: 120, y: 30 }, G.polar(d, a))], previewColor: '#ff9f68' };
    return entitiesSvg([wall, box, arrow], { width, height, compact, label: 'STR · 크로싱 상자와 변위' });
  }
  async function runSTR() {
    try {
      openCardDialog({
        ctx, title: 'STR · 연속 잡아끌기', storageKey: STR_STORAGE, fields: STR_FIELDS, slots: 1,
        preview: strPreviewSvg, goLabel: '영역 지정 시작', note: '크로싱 상자 두 점으로 늘릴 정점을 고른 뒤 거리·각도를 받습니다.',
        onGo: async (v) => {
          const box = await ctx.pickPath({ prompt: 'STR · 늘릴 정점이 들어가도록 크로싱 상자 두 점을 지정하세요 · Esc 취소', minPoints: 2, maxPoints: 2, preview: (points, cursor) => (points.length && cursor ? [{ type: 'rectangle', points: G.rectangle(points[0], cursor) }] : []) });
          if (!box) return;
          const targets = crossingTargets(ctx.entities(), box.points[0], box.points[1]);
          if (!targets.length) { ctx.toast('상자 안에 늘릴 정점이 없습니다.', true); return; }
          let distance = v.distance, angle = v.angle;
          if (v.mode === 'both') {
            const path = await ctx.pickPath({ prompt: 'STR · 거리·각도를 정할 두 점을 지정하세요 · Esc 취소', minPoints: 2, maxPoints: 2 });
            if (!path) return;
            ({ distance, angle } = twoPointDelta(path.points[0], path.points[1]));
          } else if (v.onScreen) {
            const dp = await ctx.pickPath({ prompt: 'STR · 거리를 잴 두 점을 지정하세요 · Esc 취소', minPoints: 2, maxPoints: 2 });
            if (!dp) return;
            distance = twoPointDelta(dp.points[0], dp.points[1]).distance;
            const ap = await ctx.pickPath({ prompt: 'STR · 각도를 정할 두 점을 지정하세요 · Esc 취소', minPoints: 2, maxPoints: 2 });
            if (!ap) return;
            angle = twoPointDelta(ap.points[0], ap.points[1]).angle;
          }
          const delta = stretchDelta({ distance, angle, subtract: v.subtract, subtractBy: v.subtractBy });
          ctx.execute({ type: 'stretch', targets, dx: delta.x, dy: delta.y });
          ctx.refresh();
          ctx.toast(`STR · ${Math.round(delta.distance * 1000) / 1000}mm · ${Math.round(angle * 100) / 100}도${delta.subtracted ? ` (빼기 ${delta.subtracted})` : ''} · Ctrl+Z 로 되돌리기`);
        },
      });
    } catch (e) { fail(e); }
  }

  /* ── XT · 자름과 연장을 동시에 ── */
  async function runXT() {
    try {
      const v = await askForm('XT · 자르고 늘리기', [
        { name: 'keep', label: '남길 길이 (mm)', type: 'number', value: 0 },
        { name: 'center', label: '중심선 정리(C) · 대상 가운데 중심선만 정리', type: 'checkbox' },
      ]);
      const keep = numOf(v.keep, 0), centerOnly = v.center === 'on';
      const base = await ctx.pickEntity({ prompt: 'XT · 기준선(가장 긴 선)을 지정하세요 · Esc 취소', types: ['line', 'polyline', 'rectangle'] });
      if (!base) return;
      const targets = (await pickMany('XT · 자르거나 연장할 선들을 선택하세요', ['line'])).filter((e) => e.id !== base.id);
      if (!targets.length) { ctx.toast('대상 선을 선택하지 않았습니다.'); return; }
      const pick = await ctx.pickPoint('XT · 정리할 쪽(좌/우) 한 점을 클릭하세요 · Esc 취소');
      if (!pick) return;
      const layers = ctx.layers();
      const use = centerOnly ? targets.filter((e) => isCenterlineEntity(e, layers)) : targets;
      if (!use.length) { ctx.toast('중심선으로 볼 대상이 없습니다(선종류 CENTER 또는 중심선·축선 켜).', true); return; }
      const commands = [];
      let trimmed = 0, extended = 0, failed = 0;
      for (const t of use) {
        try { const r = trimExtendToBase(t, base, pick, keep); commands.push({ type: 'update', ids: [t.id], changes: { points: r.points } }); r.action === 'trim' ? trimmed++ : extended++; }
        catch { failed++; }
      }
      if (!commands.length) { ctx.toast('기준선과 만나는 대상이 없습니다.', true); return; }
      ctx.execute({ type: 'batch', commands });
      ctx.setSelected(use.map((e) => e.id)); ctx.refresh();
      ctx.toast(`XT · 자름 ${trimmed}개 · 연장 ${extended}개${failed ? ` · 건너뜀 ${failed}개(평행)` : ''}${keep ? ` · 남길 길이 ${keep}` : ''} · Ctrl+Z 로 되돌리기`);
    } catch (e) { fail(e); }
  }

  /* ── B · 다중 끊기 ── */
  async function runB() {
    try {
      const v = await askForm('B · 다중 끊기', [{ name: 'mode', label: '방식', type: 'text', value: 'gap', options: [['gap', '두 점 사이를 끊어 들어내기'], ['one', '한 점에서 끊기'], ['multi', '여러점(M) · 점마다 끊기']] }]);
      const mode = ['gap', 'one', 'multi'].includes(v.mode) ? v.mode : 'gap';
      const picked = await selectedOr('B · 끊을 선형 객체를 선택하세요', ['line', 'polyline', 'rectangle', 'circle', 'arc']);
      if (!picked.length) { ctx.toast('선택한 객체가 없습니다.'); return; }
      const prompt = mode === 'gap' ? 'B · 끊을 두 점을 지정하세요 · Esc 취소' : mode === 'one' ? 'B · 끊을 한 점을 지정하세요 · Esc 취소' : 'B · 끊을 점들을 이어 찍고 Enter · Esc 취소';
      const path = await ctx.pickPath({ prompt, minPoints: 1, maxPoints: mode === 'gap' ? 2 : mode === 'one' ? 1 : 0 });
      if (!path || !path.points.length) return;
      if (mode === 'gap' && path.points.length < 2) { ctx.toast('두 점을 지정하세요.', true); return; }
      const removeIds = [], entities = [];
      let done = 0;
      for (const e of picked) {
        try {
          const r = breakMultiEntity(e, path.points, mode === 'gap' ? 'gap' : 'split');
          if (!r) continue;
          removeIds.push(r.removeId); entities.push(...r.pieces); done++;
        } catch { /* 이 객체에서는 끊을 곳이 없다 */ }
      }
      if (!done) { ctx.toast('지정한 점에서 끊을 수 있는 객체가 없습니다.', true); return; }
      ctx.commit({ removeIds, entities });
      ctx.toast(`B · ${done}개를 ${mode === 'gap' ? '두 점 사이에서 들어냈습니다' : '점마다 끊었습니다'} · Ctrl+Z 로 되돌리기`);
    } catch (e) { fail(e); }
  }

  /* ── DRL · 폴리선 방향 확인 ── */
  async function runDRL() {
    try {
      const e = await ctx.pickEntity({ prompt: 'DRL · 방향을 확인할 폴리선 또는 선을 지정하세요 · Esc 취소', types: ['line', 'polyline', 'rectangle'] });
      if (!e) return;
      const { total } = pathSegs(e);
      const arrows = directionArrows(e, Math.max(total / 25, ctx.tolerance() * 2));
      const turn = pathDirection(e);
      const label = turn === 'ccw' ? '반시계방향' : turn === 'cw' ? '시계방향' : '열린 선(시작점 → 끝점)';
      const clicked = await ctx.pickPath({ prompt: `DRL · 진행 방향 ${label} · 화살표는 임시선입니다 · 클릭하면 역전 여부를 묻습니다 · Esc 로 마침`, minPoints: 1, maxPoints: 1, preview: () => arrows });
      if (!clicked) { ctx.toast(`DRL · 진행 방향: ${label}`); return; }
      const v = await askForm('DRL · 방향 역전', [{ name: 'reverse', label: `진행 방향(${label})을 역전할까요?`, type: 'checkbox' }]);
      if (!isChecked(v.reverse)) { ctx.toast(`DRL · 진행 방향: ${label} (그대로 둡니다)`); return; }
      ctx.execute({ type: 'update', ids: [e.id], changes: { points: reversedPoints(e) } });
      ctx.refresh();
      ctx.toast('DRL · 진행 방향을 역전했습니다 · Ctrl+Z 로 되돌리기');
    } catch (e) { fail(e); }
  }

  /* ── PVL · 정점 리스트 표만들기 ── */
  const PVL_STORAGE = 'trim4-pvl-v1';
  const PVL_FIELDS = [
    { key: 'kind', label: '좌표를 읽을 객체', type: 'select', def: 'polyline', group: '① 구분', options: PVL_KINDS },
    { key: 'includeZ', label: 'Z 좌표도 포함', type: 'check', def: false, group: '② Z 좌표', hint: '바른 CAD 좌표는 2차원이라 Z 는 0 으로 나갑니다' },
    { key: 'action', label: '동작', type: 'select', def: 'cad', group: '③ 동작', options: [['cad', '좌표를 캐드표로'], ['sheet', '좌표를 엑셀표로(탭 구분 복사)'], ['import', '엑셀 좌표를 캐드로(붙여넣기)']] },
    { key: 'pattern', label: '순서 패턴', type: 'select', def: 'TL', group: '④ 정렬기준점 및 순서', options: PVL_PATTERNS, when: (v) => !v.pickOrder },
    { key: 'tolerance', label: '오차 (mm)', type: 'number', def: 10, min: 0, group: '④ 정렬기준점 및 순서', when: (v) => !v.pickOrder },
    { key: 'pickOrder', label: '선택순', type: 'check', def: false, group: '④ 정렬기준점 및 순서', hint: '켜면 고른 순서대로 번호를 매깁니다' },
    { key: 'closePolyline', label: '폴리선 닫기', type: 'check', def: true, group: '⑤ 기타' },
    { key: 'numberVertex', label: '정점에 번호 넣기', type: 'check', def: true, group: '⑤ 기타' },
    { key: 'numberHeight', label: '번호 크기 (mm)', type: 'number', def: 2, min: 0.1, group: '⑤ 기타', when: (v) => v.numberVertex },
    { key: 'numberLayer', label: '번호 켜', type: 'layer', def: STD_LAYERS.text, group: '⑤ 기타', when: (v) => v.numberVertex },
  ];
  function pvlPreviewSvg(v, shared, { width, height, compact }) {
    const pts = [{ x: 0, y: 0 }, { x: 80, y: 10 }, { x: 95, y: 60 }, { x: 20, y: 70 }];
    const poly = { type: 'polyline', closed: !!v.closePolyline, points: pts };
    const ordered = orderCoordinates(pts.map((p) => ({ ...p, z: 0 })), { pattern: v.pattern, tolerance: v.tolerance, pickOrder: v.pickOrder });
    const labels = v.numberVertex ? vertexNumberTexts(ordered, { height: 8 }) : [];
    return entitiesSvg([poly, ...labels], { width, height, compact, label: 'PVL · 정점 번호 순서' });
  }
  async function runPVL() {
    try {
      openCardDialog({
        ctx, title: 'PVL · 정점 리스트 표만들기', storageKey: PVL_STORAGE, fields: PVL_FIELDS, slots: 1,
        preview: pvlPreviewSvg, goLabel: '대상 선택 시작',
        note: '엑셀 파일 입출력이 없어 "엑셀표"는 탭 구분 복사, "엑셀 좌표를 캐드로"는 붙여넣기로 대신합니다.',
        onGo: async (v) => {
          const layerName = v.numberLayer || STD_LAYERS.text;
          if (v.action === 'import') {
            const typed = await askForm('PVL · 엑셀 좌표를 캐드로', [{ name: 'rows', label: '좌표를 붙여넣으세요(한 줄 한 점, 탭·쉼표·공백 구분)', type: 'textarea', value: '' }]);
            const pts = parseCoordinateRows(typed.rows, { includeZ: v.includeZ });
            const entities = [{ type: 'polyline', closed: !!v.closePolyline, points: pts.map((p) => ({ x: p.x, y: p.y })), cardLayer: STD_LAYERS.wall }];
            if (v.numberVertex) entities.push(...vertexNumberTexts(pts, { height: v.numberHeight, layerName }));
            ctx.commit({ entities: resolveLayers(ctx, entities) });
            ctx.toast(`PVL · 좌표 ${pts.length}개로 폴리선을 그렸습니다${v.includeZ ? ' (Z 는 2차원 도면이라 버립니다)' : ''} · Ctrl+Z 로 되돌리기`);
            return;
          }
          const types = v.kind === 'polyline' ? ['polyline', 'rectangle'] : [v.kind];
          const picked = await selectedOr(`PVL · 좌표를 읽을 ${PVL_KINDS.find(([k]) => k === v.kind)[1]}을(를) 선택하세요`, types);
          if (!picked.length) { ctx.toast('선택한 객체가 없습니다.'); return; }
          const raw = collectCoordinates(picked, v.kind);
          if (!raw.length) { ctx.toast('좌표를 읽을 수 없습니다.', true); return; }
          const list = orderCoordinates(raw, { pattern: v.pattern, tolerance: v.tolerance, pickOrder: v.pickOrder });
          const rows = coordinateRows(list, { includeZ: v.includeZ });
          if (v.action === 'sheet') {
            const ok = await toClipboard(rowsToTsv(rows), 'PVL · 엑셀에 붙여넣을 표');
            ctx.toast(`PVL · 좌표 ${list.length}개를 탭 구분 표로 ${ok ? '복사했습니다(엑셀에 붙여넣기)' : '보여드렸습니다'}`);
            return;
          }
          const origin = await ctx.pickPoint('PVL · 표를 놓을 왼쪽 위 점을 클릭하세요 · Esc 취소');
          if (!origin) return;
          const height = Math.max(0.1, v.numberHeight || 2.5);
          const entities = tableEntities(rows, { origin, height, layerName });
          if (v.numberVertex) entities.push(...vertexNumberTexts(list, { height, layerName }));
          ctx.commit({ entities: resolveLayers(ctx, entities) });
          ctx.toast(`PVL · 좌표 ${list.length}개를 캐드표로 만들었습니다 · Ctrl+Z 로 되돌리기`);
        },
      });
    } catch (e) { fail(e); }
  }

  return { FM: runFM, STR: runSTR, XT: runXT, B: runB, DRL: runDRL, PVL: runPVL };
}
