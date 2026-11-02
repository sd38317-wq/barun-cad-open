// 보조명령 카드: 멀티도구 13개(CIN CNL CR CTL DDE MLC OE OI OO OT RDC SB WR).
// 근거: docs/izzarder-reference-20260921/references/06-multitool.md 및 각 절 끝 원문(izzarder.com/NNN, 2026-09-21 WebFetch 로 재확인).
// 기하·판정 함수는 순수 함수로 export 해 node --test 로 DOM 없이 시험한다. 화면 흐름(pick·form)은 installMultiTools(ctx) 안에만 둔다.
import * as G from './geometry.js';
import {nearestSegment} from './card-kit.js';

const EPS4 = 1e-4;
const near = (a, b, eps = EPS4) => Math.abs(a - b) < eps;
const samePoint = (a, b, eps = EPS4) => near(a.x, b.x, eps) && near(a.y, b.y, eps);
const box2 = (c1, c2) => ({ minX: Math.min(c1.x, c2.x), minY: Math.min(c1.y, c2.y), maxX: Math.max(c1.x, c2.x), maxY: Math.max(c1.y, c2.y) });
const inBox = (p, b) => p.x >= b.minX - 1e-6 && p.x <= b.maxX + 1e-6 && p.y >= b.minY - 1e-6 && p.y <= b.maxY + 1e-6;
const CENTER_RE = /CNTR|GRID|CENTER|중심|(?:^|-)WALL-C(?:$|-)/i;
const stripId = e => { const c = structuredClone(e); delete c.id; return c; };

/* ══════════════════════════ CIN · 교차점에 객체복사 (izzarder.com/551) ══════════════════════════
   원문: 복사할 객체(여러 개)와 교차점을 만들 선(선·폴리선·원·호)을 선택하면 모든 교차점에 객체가 복사된다.
   "회전 각도에 0을 입력하면 회전 없이 복사만 한다" — 이 문장을 그대로 따라 회전각 하나만 받는다(참조/한점 4방향 서브다이얼로그는 만들지 않음, 한계로 기록). */
export function computeIntersectionPoints(curves, eps = 1e-6) {
  const pts = [];
  for (let i = 0; i < curves.length; i++)
    for (let j = i + 1; j < curves.length; j++)
      for (const p of G.intersections(curves[i], curves[j]))
        if (!pts.some(q => G.dist(p, q) < eps)) pts.push(p);
  return pts;
}
export function copyToPoints(entities, basePoint, points, angleDeg = 0) {
  const out = [];
  for (const p of points) {
    const dx = p.x - basePoint.x, dy = p.y - basePoint.y;
    for (const e of entities) {
      let c = G.translate(e, dx, dy);
      if (angleDeg) c = G.rotate(c, p, angleDeg);
      out.push(stripId(c));
    }
  }
  return out;
}

/* ══════════════════════════ CR(CV) · 복사 후 회전 (izzarder.com/528) ══════════════════════════
   원문: 복사 기준점·목표점을 지정해 복사한 뒤, 이어서 회전각을 입력하면 복사본이 바로 회전한다.
   실제 단축 명령은 CV 로 안내되어 있어 CR·CV 두 이름 모두로 등록한다(주의사항으로 기록). */
export function copyThenRotate(entities, base, target, angleDeg = 0) {
  const dx = target.x - base.x, dy = target.y - base.y;
  return entities.map(e => {
    let c = G.translate(e, dx, dy);
    if (angleDeg) c = G.rotate(c, target, angleDeg);
    return stripId(c);
  });
}

/* ══════════════════════════ CTL · 현재 켜로 복사 (izzarder.com/323), CNL · 새 켜로 복사 (izzarder.com/466) ══════════════════════════
   원문 CTL: 객체를 선택하면 같은 위치에 현재 켜로 바뀐 복사본이 생긴다. MOVE -P 옵션/명령창 옵션으로 원본을 남기거나 이동만 할 수도 있다.
   원문 CNL: 객체를 선택하면 새 켜 이름을 입력하는 대화상자가 뜨고, 이름을 지정하면 그 켜로 복사본이 생긴다. */
export function copyToLayer(entities, layerId) {
  return entities.map(e => { const c = stripId(e); if (layerId) c.layer = layerId; else delete c.layer; return c; });
}

/* ══════════════════════════ DDE · 겹친 객체 삭제 (izzarder.com/554) ══════════════════════════
   원문 비교기준: 문자(내용+위치+높이, 켜·글꼴 무시) / 블럭(이름+위치+축척+회전, 켜 무시) / 원(위치+반지름, 켜 무시) /
   폴리선(정점 좌표만, 켜·원호 무시) / 선은 "전체가 겹친 선"(완전 일치) · "일부가 겹친 선"(공선+구간 겹침) · "모두". 오차는 소수점 네 자리(1e-4).
   "삭제 기준": 가장 상위 객체 남기기(DrawOrder, 여기서는 배열 순서=뒤가 위) / 가장 긴 객체 남기기. */
function entityLength(e) {
  if (e.type === 'circle') return 2 * Math.PI * e.radius;
  if (e.type === 'arc') return (e.radius * Math.PI / 180) * G.normalizeAngle(e.endAngle - e.startAngle);
  if (e.points) return G.segments({ ...e }).reduce((s, [a, b]) => s + G.dist(a, b), 0);
  return 0;
}
function sameLineFull(a, b) {
  return (samePoint(a.points[0], b.points[0]) && samePoint(a.points[1], b.points[1])) ||
    (samePoint(a.points[0], b.points[1]) && samePoint(a.points[1], b.points[0]));
}
function collinearOverlap(a, b) {
  let u; try { u = G.unit(G.sub(a.points[1], a.points[0])); } catch { return false; }
  if (Math.abs(G.cross(u, G.sub(b.points[1], b.points[0]))) > 1e-3) return false;
  if (Math.abs(G.cross(u, G.sub(b.points[0], a.points[0]))) > EPS4) return false;
  const ta1 = G.dot(G.sub(a.points[1], a.points[0]), u);
  const tb0 = G.dot(G.sub(b.points[0], a.points[0]), u), tb1 = G.dot(G.sub(b.points[1], a.points[0]), u);
  const aLo = 0, aHi = ta1, bLo = Math.min(tb0, tb1), bHi = Math.max(tb0, tb1);
  return aHi > bLo + EPS4 && bHi > aLo + EPS4;
}
function samePolyline(a, b) {
  if (!a.points || !b.points || a.points.length !== b.points.length) return false;
  const fwd = a.points.every((p, i) => samePoint(p, b.points[i]));
  const rev = a.points.every((p, i) => samePoint(p, b.points[b.points.length - 1 - i]));
  return fwd || rev;
}
function sameCircle(a, b) { return samePoint(a.center, b.center) && near(a.radius, b.radius); }
function sameText(a, b) { return a.text === b.text && samePoint(a.position, b.position) && near(a.height, b.height); }
function sameBlock(a, b) { return a.name === b.name && samePoint(a.position, b.position) && near(a.scale ?? 1, b.scale ?? 1) && near(a.rotation ?? 0, b.rotation ?? 0); }
/** scope: 'full'|'partial'|'both'(선에만 의미가 있다), keep: 'top'|'longest'. entities 는 배열 순서를 DrawOrder(뒤=위)로 본다. */
export function findDuplicateEntities(entities, { scope = 'full', keep = 'top' } = {}) {
  const groups = { line: [], polyline: [], circle: [], text: [], block: [] };
  entities.forEach((e, i) => {
    if (e.type === 'rectangle') groups.polyline.push({ e: { ...e, closed: true }, i });
    else if (groups[e.type]) groups[e.type].push({ e, i });
  });
  const removeIds = new Set(), decided = new Set();
  const keepBetween = (x, y) => {
    if (keep === 'longest') {
      const lx = entityLength(x.e), ly = entityLength(y.e);
      if (Math.abs(lx - ly) > 1e-6) return lx >= ly ? [x, y] : [y, x];
    }
    return x.i > y.i ? [x, y] : [y, x];
  };
  for (const type of Object.keys(groups)) {
    const list = groups[type];
    for (let i = 0; i < list.length; i++) {
      if (decided.has(list[i].e.id)) continue;
      for (let j = i + 1; j < list.length; j++) {
        if (decided.has(list[j].e.id)) continue;
        let dup = false;
        if (type === 'line') {
          const full = sameLineFull(list[i].e, list[j].e), partial = !full && collinearOverlap(list[i].e, list[j].e);
          dup = scope === 'full' ? full : scope === 'partial' ? partial : (full || partial);
        } else if (type === 'polyline') dup = samePolyline(list[i].e, list[j].e);
        else if (type === 'circle') dup = sameCircle(list[i].e, list[j].e);
        else if (type === 'text') dup = sameText(list[i].e, list[j].e);
        else if (type === 'block') dup = sameBlock(list[i].e, list[j].e);
        if (!dup) continue;
        const [, removeItem] = keepBetween(list[i], list[j]);
        removeIds.add(removeItem.e.id); decided.add(removeItem.e.id);
      }
    }
  }
  return { removeIds: [...removeIds] };
}

/* ══════════════════════════ OE · 간격띄우고 원본삭제 (izzarder.com/359) ══════════════════════════
   원문: "특이 사항은 없습니다" — OFFSET 뒤 원본을 지우는 것이 전부다. geometry.js 의 offsetEntity 를 그대로 쓴다. */
export function offsetAndDrop(entities, distance, side) {
  const add = [], removeIds = [], failed = [];
  for (const e of entities) {
    try { add.push(G.offsetEntity(e, distance, side)); removeIds.push(e.id); }
    catch (err) { failed.push({ id: e.id, message: err.message }); }
  }
  return { add, removeIds, failed };
}

/* ══════════════════════════ OO · 현재 켜로 간격띄우기 (izzarder.com/358) ══════════════════════════
   원문: 일반 OFFSET과 달리 결과가 현재 켜로 생성된다. 문자는 테두리를 옵셋, 지시선은 폴리선으로, 치수선은 선으로, 블럭 내부도 포함.
   한계: 문자(바운딩박스 옵셋)와 선·폴리선·사각형·원·호만 구현했다. 리더·치수선 추출, 블럭 내부 순회는 만들지 않았다(정직한 한계, 보고서 참고). */
export function offsetSource(e) {
  if (e.type === 'text') { const pts = G.vertices(e); return { type: 'polyline', closed: true, points: pts, layer: e.layer }; }
  return e;
}
export function offsetToLayer(entities, distance, side, layerId) {
  const add = [], failed = [];
  for (const e of entities) {
    try { const out = G.offsetEntity(offsetSource(e), distance, side); out.layer = layerId; delete out.cardLayer; add.push(out); }
    catch (err) { failed.push({ id: e.id, message: err.message }); }
  }
  return { add, failed };
}

/* ══════════════════════════ OT · 허용공차선 띄우기 (izzarder.com/383) ══════════════════════════
   원문: 두 벽체 선 선택 → 평행이면 무조건 바깥쪽, 아니면 첫 클릭점 X좌표로 안/밖 판단(왼쪽 클릭=바깥쪽). 설정에 필렛 처리 체크가 있다(캡처 손상으로 컨트롤 종류만 "있다"는 사실만 확정, 여기서는 체크박스로 만들었다). */
export function offsetTolerance(a, b, firstClick, distance, { fillet = false } = {}) {
  if (a.type !== 'line' || b.type !== 'line') throw Error('OT 는 직선 두 개를 선택하세요.');
  const ua = G.unit(G.sub(a.points[1], a.points[0])), ub = G.unit(G.sub(b.points[1], b.points[0]));
  const parallel = Math.abs(G.cross(ua, ub)) < 1e-3;
  const midA = G.mul(G.add(a.points[0], a.points[1]), 0.5), midB = G.mul(G.add(b.points[0], b.points[1]), 0.5);
  let outward;
  if (parallel) outward = true;
  else {
    const hit = G.lineIntersection(a.points[0], a.points[1], b.points[0], b.points[1]);
    const refX = hit ? hit.point.x : (midA.x + midB.x) / 2;
    outward = firstClick.x < refX;
  }
  const sideFor = (mid, otherMid) => outward ? G.add(mid, G.sub(mid, otherMid)) : otherMid;
  const oa = G.offsetEntity(a, distance, sideFor(midA, midB));
  const ob = G.offsetEntity(b, distance, sideFor(midB, midA));
  if (!fillet) return [oa, ob];
  try { return G.corner(oa, ob, 0); } catch { return [oa, ob]; }
}

/* ══════════════════════════ OI · 연관선 함께 간격띄우기 (izzarder.com/416) ══════════════════════════
   원문: OFFSET과 같으나 기준선에 붙어 있는(맞닿은) 다른 선까지 함께 옵셋된다. 폴리선에도 적용된다.
   구현: 선택한 시작 선분부터 끝점이 맞닿은 선분을 양끝으로 계속 이어붙여(위상 탐색) 하나의 열린 폴리선으로 만들고, geometry.js offsetEntity 의
   폴리선 모서리 처리(교차점 재계산)를 그대로 빌려 옵셋한 뒤 원래 선분 수만큼 다시 잘라 개별 선으로 돌려준다. 한 점에 선이 3개 이상 모이는
   분기(교차)는 위상 탐색으로 한 줄기를 고를 수 없어 오류로 안내한다(한계, 보고서 참고). */
export function collectSegments(entities) {
  const out = [];
  for (const e of entities) {
    if (!['line', 'polyline', 'rectangle'].includes(e.type) || e.hidden || e.bulges?.some(Boolean)) continue;
    for (const [a, b] of G.segments(e)) out.push({ a, b, layer: e.layer, color: e.color, linetype: e.linetype, sourceId: e.id });
  }
  return out;
}
export function buildChain(segments, seed, tolerance) {
  const nearP = (p, q) => G.dist(p, q) <= tolerance;
  const used = new Set();
  const startIdx = segments.findIndex((s, i) => !used.has(i) &&
    ((nearP(s.a, seed.a) && nearP(s.b, seed.b)) || (nearP(s.a, seed.b) && nearP(s.b, seed.a))));
  if (startIdx < 0) throw Error('연관선 시작 선을 찾지 못했습니다.');
  used.add(startIdx);
  let chain = [segments[startIdx]];
  const grow = atHead => {
    for (;;) {
      const endPoint = atHead ? chain[0].a : chain.at(-1).b;
      const cands = [];
      segments.forEach((s, i) => { if (!used.has(i) && (nearP(s.a, endPoint) || nearP(s.b, endPoint))) cands.push(i); });
      if (!cands.length) return;
      if (cands.length > 1) throw Error('가지가 갈라지는(3개 이상 만나는) 지점이 있어 OI 로 한 번에 처리할 수 없습니다. 구간을 나눠 선택하세요.');
      const i = cands[0], s = segments[i]; used.add(i);
      if (atHead) { const seg = nearP(s.b, endPoint) ? s : { ...s, a: s.b, b: s.a }; chain = [seg, ...chain]; }
      else { const seg = nearP(s.a, endPoint) ? s : { ...s, a: s.b, b: s.a }; chain = [...chain, seg]; }
    }
  };
  grow(false); grow(true);
  return chain;
}
export function offsetChain(chain, distance, side) {
  if (!chain.length) throw Error('연관선이 비어 있습니다.');
  const points = [chain[0].a, ...chain.map(s => s.b)];
  const offset = G.offsetEntity({ type: 'polyline', closed: false, points }, distance, side);
  const segs = G.segments(offset);
  if (segs.length !== chain.length) throw Error('옵셋 결과 구간 수가 원본과 달라 OI 를 적용할 수 없습니다.');
  return segs.map(([a, b], i) => ({
    type: 'line', points: [a, b], layer: chain[i].layer,
    ...(chain[i].color ? { color: chain[i].color } : {}),
    ...(chain[i].linetype ? { linetype: chain[i].linetype } : {}),
  }));
}

/* ══════════════════════════ RDC · 무작위 복사하기 (izzarder.com/126) ══════════════════════════
   원문 기본값: 객체 종류 "(여러)일반 객체", 기준점 "임의 지정", 생성방식 "점 지정". 매개변수 크기배율·회전각도에 최소/최대 범위가 있다.
   한계: "선을 따라"·"영역내부" 생성방식, "블럭삽입점"/"선택객체중심" 기준점, "선과이격", "블럭으로 변환"은 만들지 않았다(정직한 한계).
   기본 생성방식(점 지정)·기본 기준점(임의 지정)·매개변수 범위(크기배율/회전각도)만 원문 그대로 구현했다. */
export function randomCopyOnce(entities, base, target, { scaleMin = 1, scaleMax = 1, rotMin = 0, rotMax = 0 } = {}, rng = Math.random) {
  const dx = target.x - base.x, dy = target.y - base.y;
  const scale = scaleMin + (scaleMax - scaleMin) * rng();
  const rot = rotMin + (rotMax - rotMin) * rng();
  return entities.map(e => {
    let c = G.translate(e, dx, dy);
    if (Math.abs(scale - 1) > 1e-9) c = G.resize(c, target, scale);
    if (rot) c = G.rotate(c, target, rot);
    return stripId(c);
  });
}

/* ══════════════════════════ WR · 선 복구하기 (xiWallRecover, izzarder.com/465) ══════════════════════════
   원문: 복구할 영역을 지정하면 그 안의 연속된 선/호/원 형상을 인식해 하나로 복구하고, 영역 안의 다른 모든 객체는 삭제된다.
   구현: 영역과 겹치는 객체를 바운딩박스 기준으로 모아(중심선 켜·선종류는 제외), 선은 공선(같은 직선 위)끼리, 원·호는 같은 중심·반지름끼리
   묶어 하나로 재생성한다. 그 외 객체(문자·치수 등)는 원문대로 재작도 없이 삭제만 한다. */
export function collectRecoverArea(entities, corner1, corner2, layers = []) {
  const box = box2(corner1, corner2);
  const center = new Set((layers || []).filter(l => CENTER_RE.test(l.name) || l.linetype === 'CENTER').map(l => l.id));
  const touched = [];
  for (const e of entities || []) {
    if (e.hidden || center.has(e.layer) || String(e.linetype || '').toUpperCase().includes('CENTER')) continue;
    const b = G.bounds([e]);
    if (!b || b.maxX < box.minX || b.minX > box.maxX || b.maxY < box.minY || b.minY > box.maxY) continue;
    touched.push(e);
  }
  return { box, touched };
}
const isLine = e => e.type === 'line' && Array.isArray(e.points) && e.points.length === 2;
function mergeLineGroup(lines) {
  const u = G.unit(G.sub(lines[0].points[1], lines[0].points[0])), a0 = lines[0].points[0];
  let lo = Infinity, hi = -Infinity;
  for (const l of lines) for (const p of l.points) { const t = G.dot(G.sub(p, a0), u); lo = Math.min(lo, t); hi = Math.max(hi, t); }
  return { ...lines[0], points: [G.add(a0, G.mul(u, lo)), G.add(a0, G.mul(u, hi))] };
}
export function mergeCollinearLines(lines, tol = 0.5) {
  const remaining = [...lines], groups = [];
  while (remaining.length) {
    const base = remaining.shift(), group = [base];
    const u = G.unit(G.sub(base.points[1], base.points[0]));
    for (let i = remaining.length - 1; i >= 0; i--) {
      const l = remaining[i];
      let v; try { v = G.unit(G.sub(l.points[1], l.points[0])); } catch { continue; }
      const parallel = Math.abs(G.cross(u, v)) < 1e-3;
      const collinear = parallel && Math.abs(G.cross(u, G.sub(l.points[0], base.points[0]))) < tol;
      if (collinear) { group.push(l); remaining.splice(i, 1); }
    }
    groups.push(group);
  }
  return groups.map(mergeLineGroup);
}
export function mergeCircles(circles, tol = 0.5) {
  const out = [];
  for (const c of circles) if (!out.some(o => G.dist(o.center, c.center) < tol && Math.abs(o.radius - c.radius) < tol)) out.push(c);
  return out;
}
function mergeArcGroup(arcs) {
  const base = arcs[0];
  const spans = arcs.map(a => {
    const s = G.normalizeAngle(a.startAngle - base.startAngle);
    let e = G.normalizeAngle(a.endAngle - base.startAngle); if (e < s) e += 360;
    return [s, e];
  }).sort((x, y) => x[0] - y[0]);
  const merged = [spans[0].slice()];
  for (const [s, e] of spans.slice(1)) { const last = merged.at(-1); if (s <= last[1] + 0.5) last[1] = Math.max(last[1], e); else merged.push([s, e]); }
  return merged.map(([s, e]) => {
    if (e - s >= 359.9) return { type: 'circle', layer: base.layer, color: base.color, center: base.center, radius: base.radius };
    return { ...base, startAngle: G.normalizeAngle(base.startAngle + s), endAngle: G.normalizeAngle(base.startAngle + e) };
  });
}
export function mergeArcs(arcs, tol = 0.5) {
  const remaining = [...arcs], groups = [];
  while (remaining.length) {
    const base = remaining.shift(), group = [base];
    for (let i = remaining.length - 1; i >= 0; i--) {
      const a = remaining[i];
      if (G.dist(a.center, base.center) < tol && Math.abs(a.radius - base.radius) < tol) { group.push(a); remaining.splice(i, 1); }
    }
    groups.push(group);
  }
  return groups.flatMap(mergeArcGroup);
}
export function wallRecoverOnce(entities, layers, corner1, corner2, tol = 0.5) {
  const { touched } = collectRecoverArea(entities, corner1, corner2, layers);
  if (!touched.length) throw Error('영역 안에 정리할 객체가 없습니다.');
  // 상자 안에 통째로 든 원·호(문 열림 호 등)는 '중간 객체'라 지운다. 상자 경계에 걸쳐 끊긴 원·호만 이어 되살린다(2026-10-27 설명서 시험).
  const minX = Math.min(corner1.x, corner2.x), maxX = Math.max(corner1.x, corner2.x), minY = Math.min(corner1.y, corner2.y), maxY = Math.max(corner1.y, corner2.y);
  const inside = e => { const b = G.bounds([e]); return b && b.minX >= minX && b.maxX <= maxX && b.minY >= minY && b.maxY <= maxY; };
  const lines = touched.filter(isLine), circles = touched.filter(e => e.type === 'circle' && !inside(e)), arcs = touched.filter(e => e.type === 'arc' && !inside(e));
  const add = [
    ...(lines.length ? mergeCollinearLines(lines, tol) : []),
    ...(circles.length ? mergeCircles(circles, tol) : []),
    ...(arcs.length ? mergeArcs(arcs, tol) : []),
  ];
  return { removeIds: touched.map(e => e.id), add, touchedCount: touched.length, recoveredCount: add.length };
}

/* ══════════════════════════ 화면 흐름 ══════════════════════════ */
async function pickLineAt(ctx, prompt) {
  const p = await ctx.pickPoint(prompt);
  if (!p) return null;
  const hit = nearestSegment(ctx.entities(), p, ctx.tolerance(), { layers: ctx.layers() });
  if (!hit) throw Error('그 근처에 선이 없습니다. 선 가까이에서 다시 클릭하세요.');
  return { point: p, line: { type: 'line', points: [hit.a, hit.b], layer: hit.entity.layer, color: hit.entity.color, linetype: hit.entity.linetype } };
}
/** check(values) 가 던지면 폼이 열린 채 그 문구를 보여 주고(폼이 잡는다), 통과하면 값을 돌려준다. */
function askForm(ctx, title, fields, check = null) {
  return new Promise((resolve) => {
    ctx.form(title, fields, async values => { if (check) check(values); resolve(values); });
  });
}
async function guarded(ctx, fn) {
  try { await fn(); } catch (e) { console.error('[card]', e); ctx.toast(ctx.userErrorMessage(e), true); }
}
const needSelection = ctx => { const es = ctx.selected(); if (!es.length) throw Error('먼저 도면에서 대상 객체를 선택한 뒤 실행하세요.'); return es; };
/* 2026-09-24 검토 F8: 각도·배율 입력 검증. 비숫자("거실")·거대값(1e15)·배율 0 을 조용히 넘기지 않는다. */
export const ANGLE_LIMIT = 360;
export function parseAngleInput(raw, label = '회전 각도') {
  const s = String(raw ?? '').trim();
  if (s === '') return 0;
  const n = Number(s);
  if (!Number.isFinite(n)) throw Error(`${label}는 숫자로 입력하세요(예: 90, -45).`);
  if (Math.abs(n) > ANGLE_LIMIT) throw Error(`${label}는 -${ANGLE_LIMIT}~${ANGLE_LIMIT}도 사이로 입력하세요.`);
  return n;
}
export const SCALE_LIMIT = 1000;
export function parseScaleInput(raw, label = '크기배율') {
  const n = Number(String(raw ?? '').trim());
  if (!Number.isFinite(n)) throw Error(`${label} 값은 숫자로 입력하세요.`);
  if (n <= 0) throw Error(`${label} 값은 0보다 커야 합니다.`);
  if (n > SCALE_LIMIT || n < 1 / SCALE_LIMIT) throw Error(`${label} 값은 ${1 / SCALE_LIMIT}~${SCALE_LIMIT} 사이로 입력하세요.`);
  return n;
}

export function installMultiTools(ctx) {
  async function runCIN() {
    const objs = needSelection(ctx);
    const curves = [];
    for (;;) {
      const e = await ctx.pickEntity({ prompt: `CIN · 교차점을 만들 선 선택(선·폴리선·원·호) · 지금까지 ${curves.length}개 · 그만하려면 Esc`, types: ['line', 'polyline', 'rectangle', 'circle', 'arc'] });
      if (!e) break;
      curves.push(e);
    }
    if (curves.length < 2) throw Error('교차점을 만들 선을 2개 이상 선택하세요.');
    const base = await ctx.pickPoint('CIN · 복사 기준점을 지정하세요 · Esc 취소');
    if (!base) return;
    const points = computeIntersectionPoints(curves);
    if (!points.length) throw Error('선택한 선들 사이에 교차점이 없습니다.');
    const values = await askForm(ctx, 'CIN · 교차점에 객체복사', [{ name: 'angle', label: '복사 후 회전 각도(도) · 0 = 회전 없음', type: 'number', value: 0 }], v => parseAngleInput(v.angle));
    const angle = parseAngleInput(values.angle);
    const entities = copyToPoints(objs, base, points, angle);
    ctx.commit({ entities });
    ctx.toast(`CIN · 교차점 ${points.length}곳에 객체 ${objs.length}개씩 복사했습니다.`);
  }

  async function runCR() {
    const objs = needSelection(ctx);
    const base = await ctx.pickPoint('CR · 복사 기준점을 지정하세요 · Esc 취소');
    if (!base) return;
    const target = await ctx.pickPoint('CR · 복사할 목표점을 지정하세요 · Esc 취소');
    if (!target) return;
    const values = await askForm(ctx, 'CR · 복사 후 회전', [{ name: 'angle', label: '회전 각도(도) · 0 = 회전 없이 복사만', type: 'number', value: 0 }], v => parseAngleInput(v.angle));
    const angle = parseAngleInput(values.angle);
    ctx.commit({ entities: copyThenRotate(objs, base, target, angle) });
    ctx.toast('CR · 복사 후 회전했습니다.');
  }

  async function runCTL() {
    const objs = needSelection(ctx);
    const values = await askForm(ctx, 'CTL · 현재 켜로 복사', [{ name: 'move', label: '원본 삭제(복사 대신 이동만)', type: 'checkbox', value: '' }]);
    if (values.move === 'on') {
      ctx.execute({ type: 'update', ids: ctx.selectedIds(), changes: { layer: ctx.activeLayer() } });
      ctx.toast('CTL · 선택 객체를 현재 켜로 이동했습니다.');
    } else {
      ctx.commit({ entities: copyToLayer(objs, null) });
      ctx.toast('CTL · 현재 켜로 복사했습니다.');
    }
  }

  async function runCNL() {
    const objs = needSelection(ctx);
    const values = await askForm(ctx, 'CNL · 새 켜로 복사하기', [{ name: 'name', label: '새 켜 이름', type: 'text', value: '' }]);
    const name = String(values.name || '').trim();
    if (!name) throw Error('새 켜 이름을 입력하세요.');
    const layerId = ctx.ensureLayer(name, '#ffd479');
    ctx.commit({ entities: copyToLayer(objs, layerId) });
    ctx.toast(`CNL · "${name}" 켜로 복사했습니다.`);
  }

  async function runDDE() {
    const objs = needSelection(ctx);
    const values = await askForm(ctx, 'DDE · 겹친 객체 삭제', [
      { name: 'selectOnly', label: '삭제 없이 선택만', type: 'checkbox', value: '' },
      { name: 'scope', label: '검색 기준(선)', type: 'text', value: '전체', options: [['전체', '전체가 겹친 선'], ['일부', '일부가 겹친 선'], ['모두', '모두']] },
      { name: 'keep', label: '삭제 기준', type: 'text', value: '상위', options: [['상위', '가장 상위 객체 남기기'], ['최장', '가장 긴 객체 남기기']] },
    ]);
    const scope = values.scope === '일부' ? 'partial' : values.scope === '모두' ? 'both' : 'full';
    const keep = values.keep === '최장' ? 'longest' : 'top';
    const { removeIds } = findDuplicateEntities(objs, { scope, keep });
    if (!removeIds.length) { ctx.toast('DDE · 겹친 객체를 찾지 못했습니다.'); return; }
    if (values.selectOnly === 'on') { ctx.setSelected(removeIds); ctx.toast(`DDE · 중복 ${removeIds.length}개를 선택했습니다(삭제 안 함).`); }
    else { ctx.execute({ type: 'delete', ids: removeIds }); ctx.toast(`DDE · 중복 ${removeIds.length}개를 지웠습니다.`); }
  }

  async function runOE() {
    const objs = needSelection(ctx);
    let distance; await new Promise(resolve => ctx.askNumber({ title: 'OE · 간격띄우고 원본삭제', label: '간격 거리(mm)', value: ctx.num('multi-oe-distance', 100) }, v => { distance = v; resolve(); }));
    const side = await ctx.pickPoint('OE · 옵셋할 방향의 점을 지정하세요 · Esc 취소');
    if (!side) return;
    const { add, removeIds, failed } = offsetAndDrop(objs, distance, side);
    if (!add.length) throw Error('간격띄우기를 할 수 있는 객체가 없습니다.');
    ctx.commit({ removeIds, entities: add });
    ctx.toast(`OE · ${add.length}개 옵셋 후 원본을 지웠습니다.${failed.length ? ' · ' + failed.length + '개는 건너뜀' : ''}`);
  }

  async function runOO() {
    const objs = needSelection(ctx);
    let distance; await new Promise(resolve => ctx.askNumber({ title: 'OO · 현재 켜로 간격띄우기', label: '간격 거리(mm)', value: ctx.num('multi-oo-distance', 100) }, v => { distance = v; resolve(); }));
    const side = await ctx.pickPoint('OO · 옵셋할 방향의 점을 지정하세요 · Esc 취소');
    if (!side) return;
    const { add, failed } = offsetToLayer(objs, distance, side, ctx.activeLayer());
    if (!add.length) throw Error('간격띄우기를 할 수 있는 객체가 없습니다(문자·선·폴리선·원·호만 지원합니다).');
    ctx.commit({ entities: add });
    ctx.toast(`OO · 현재 켜로 ${add.length}개 옵셋했습니다.${failed.length ? ' · ' + failed.length + '개는 건너뜀' : ''}`);
  }

  async function runOT() {
    const first = await pickLineAt(ctx, 'OT · 첫째 벽체 선을 클릭하세요 · Esc 취소');
    if (!first) return;
    const second = await pickLineAt(ctx, 'OT · 둘째 벽체 선을 클릭하세요 · Esc 취소');
    if (!second) return;
    const values = await askForm(ctx, 'OT · 허용공차선 띄우기', [
      { name: 'distance', label: '공차 거리(mm)', type: 'number', value: ctx.num('multi-ot-distance', 5) },
      { name: 'fillet', label: '모서리 필렛 처리', type: 'checkbox', value: '' },
    ]);
    const distance = Number(values.distance);
    if (!Number.isFinite(distance) || distance <= 0) throw Error('공차 거리는 양수여야 합니다.');
    const entities = offsetTolerance(first.line, second.line, first.point, distance, { fillet: values.fillet === 'on' });
    ctx.commit({ entities });
    ctx.toast('OT · 허용공차선을 그렸습니다.');
  }

  async function runOI() {
    const seed = await pickLineAt(ctx, 'OI · 옵셋 기준 선을 클릭하세요(붙은 선까지 함께 옵셋) · Esc 취소');
    if (!seed) return;
    let distance; await new Promise(resolve => ctx.askNumber({ title: 'OI · 연관선 함께 간격띄우기', label: '간격 거리(mm)', value: ctx.num('multi-oi-distance', 100) }, v => { distance = v; resolve(); }));
    const side = await ctx.pickPoint('OI · 옵셋할 방향의 점을 지정하세요 · Esc 취소');
    if (!side) return;
    const segments = collectSegments(ctx.entities());
    const chain = buildChain(segments, { a: seed.line.points[0], b: seed.line.points[1] }, ctx.tolerance());
    const entities = offsetChain(chain, distance, side);
    ctx.commit({ entities });
    ctx.toast(`OI · 연관선 ${chain.length}개를 함께 옵셋했습니다.`);
  }

  async function runRDC() {
    const objs = needSelection(ctx);
    const readParams = v => {
      const p = { scaleMin: parseScaleInput(v.scaleMin, '크기배율(최소)'), scaleMax: parseScaleInput(v.scaleMax, '크기배율(최대)'), rotMin: parseAngleInput(v.rotMin, '회전각도(최소)'), rotMax: parseAngleInput(v.rotMax, '회전각도(최대)') };
      if (p.scaleMax < p.scaleMin || p.rotMax < p.rotMin) throw Error('최대값은 최소값보다 크거나 같아야 합니다.');
      return p;
    };
    const values = await askForm(ctx, 'RDC · 무작위 복사하기(점 지정 · 임의 지정 기준점)', [
      { name: 'scaleMin', label: '크기배율 최소', type: 'number', value: 1 },
      { name: 'scaleMax', label: '크기배율 최대', type: 'number', value: 1 },
      { name: 'rotMin', label: '회전각도 최소(도)', type: 'number', value: 0 },
      { name: 'rotMax', label: '회전각도 최대(도)', type: 'number', value: 360 },
    ], readParams);
    const params = readParams(values);
    const base = await ctx.pickPoint('RDC · 복사 기준점을 지정하세요 · Esc 취소');
    if (!base) return;
    let count = 0;
    for (;;) {
      const target = await ctx.pickPoint(`RDC · 무작위로 복사할 점을 클릭하세요 · 지금까지 ${count}개 · 끝내려면 Esc`);
      if (!target) break;
      ctx.commit({ entities: randomCopyOnce(objs, base, target, params) });
      count++;
    }
    if (count) ctx.toast(`RDC · ${count}곳에 무작위 복사했습니다 · Ctrl+Z 로 한 곳씩 되돌리기`);
  }

  async function runWR() {
    let done = 0;
    for (;;) {
      const preview = (points, cursor) => points.length && cursor ? [{ type: 'polyline', closed: true, points: G.rectangle(points[0], cursor), previewColor: '#ff9f68' }] : [];
      const path = await ctx.pickPath({ prompt: `WR · 선 복구 영역 두 점(영역 안 다른 객체는 삭제됨) · 지금까지 ${done}곳 · Esc 끝내기`, preview, minPoints: 2, maxPoints: 2 });
      if (!path) break;
      try {
        const r = wallRecoverOnce(ctx.entities(), ctx.layers(), path.points[0], path.points[1], ctx.tolerance());
        ctx.commit({ removeIds: r.removeIds, entities: r.add });
        ctx.toast(`WR · 객체 ${r.touchedCount}개를 ${r.recoveredCount}개로 복구 · 계속 지정하거나 Esc`);
        done++;
      } catch (e) { console.error('[card]', e); ctx.toast(ctx.userErrorMessage(e), true); }
    }
    if (done) ctx.toast(`WR 끝 · ${done}곳 · Ctrl+Z 로 한 곳씩 되돌리기`);
  }

  return {
    CIN: () => guarded(ctx, runCIN),
    CR: () => guarded(ctx, runCR),
    CV: () => guarded(ctx, runCR),
    CTL: () => guarded(ctx, runCTL),
    CNL: () => guarded(ctx, runCNL),
    DDE: () => guarded(ctx, runDDE),
    OE: () => guarded(ctx, runOE),
    OO: () => guarded(ctx, runOO),
    OT: () => guarded(ctx, runOT),
    OI: () => guarded(ctx, runOI),
    RDC: () => guarded(ctx, runRDC),
    WR: () => guarded(ctx, runWR),
  };
}
