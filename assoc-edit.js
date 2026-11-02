/* 연관 객체(ACAD200 영역 4): 연관 배열(405) · 연관 해치(413) · 연관 중심선/중심 표시(423).

   AutoCAD 는 반응기(ACAD_REACTORS)·연관 동작(AcDbAssocAction) 그물로 "원본이 바뀌면 따라 바뀜"을 만든다.
   바른 CAD 는 그 그물 대신 한 가지 규칙만 둔다:
     · 연관 객체는 보통 블록(type:'block')이다 — 화면·선택·스냅·DXF 저장·EXPLODE 가 이미 블록을 알아서 새 코드가 필요 없다.
     · 원본 id 는 `boundaryIds`(해치) 또는 `assocRefs`(중심선·중심 표시)에 적어 둔다.
     · 엔진은 명령이 끝날 때 "이번에 바뀐 id" 와 겹치는 연관 객체만 다시 계산한다(같은 되돌리기 한 단계).
       연관 객체 목록은 entity-index 가 들고 있어 도면 전체를 훑지 않는다.
     · 원본이 지워지면 마지막 모양을 그대로 두고 연결만 끊는다(데이터 손실 없음). */
import * as G from './geometry.js';
import {pointsAlongWithAngle} from './curve-edit.js';

/* ══════════ 405 · 연관 배열 ══════════ */
export const ARRAY_LIMIT = 10000;
/** 배열 사본 수(원본 포함). */
export function arrayCount(kind, p) {
 if (kind === 'rect') return p.rows * p.columns;
 if (kind === 'polar' || kind === 'path') return p.count;
 return 0;
}
/** 매개변수 확인 — 잘못된 값으로 사본 수만 개를 만들지 않게. */
export function checkArrayParams(kind, p, itemCount = 1) {
 const finiteP = (q) => q && Number.isFinite(q.x) && Number.isFinite(q.y);
 if (kind === 'rect') {
  if (!Number.isInteger(p.rows) || !Number.isInteger(p.columns) || p.rows < 1 || p.columns < 1 || !finiteP(p.u) || !finiteP(p.v)) throw Error('배열은 양의 정수 행·열과 간격을 지정하세요.');
 } else if (kind === 'polar') {
  if (!Number.isInteger(p.count) || p.count < 2 || !finiteP(p.center) || !Number.isFinite(p.fill) || Math.abs(p.fill) < 1e-9 || Math.abs(p.fill) > 360) throw Error('원형 배열은 개수 2 이상, 채울 각도 0~360° 로 지정하세요.');
 } else if (kind === 'path') {
  if (!Number.isInteger(p.count) || p.count < 2 || !Array.isArray(p.path) || p.path.length < 2 || !p.path.every(finiteP) || !finiteP(p.base)) throw Error('경로 배열은 경로와 개수 2 이상을 지정하세요.');
 } else throw Error('배열 종류는 직사각(rect)·원형(polar)·경로(path)입니다.');
 if (arrayCount(kind, p) * Math.max(1, itemCount) > ARRAY_LIMIT) throw Error(`배열 객체는 최대 ${ARRAY_LIMIT.toLocaleString('ko-KR')}개입니다.`);
}
/** 매개변수 → 펼친 사본(원본 자리 포함). 화면·스냅·저장은 블록 안 객체로 이 결과를 쓴다. */
export function expandArray(items, kind, p) {
 const out = [];
 if (kind === 'rect') {
  for (let r = 0; r < p.rows; r++) for (let c = 0; c < p.columns; c++) {
   const dx = c * p.u.x + r * p.v.x, dy = c * p.u.y + r * p.v.y;
   for (const e of items) out.push(dx || dy ? G.translate(e, dx, dy) : structuredClone(e));
  }
 } else if (kind === 'polar') {
  const step = Math.abs(p.fill) >= 360 - 1e-9 ? p.fill / p.count : p.fill / (p.count - 1);
  for (let i = 0; i < p.count; i++) for (const e of items) {
   if (!i) { out.push(structuredClone(e)); continue; }
   const turned = G.rotate(e, p.center, step * i);
   // 사본을 돌리지 않기(ROT=N): 회전한 자리로 옮기기만 한다.
   if (p.rotateItems === false) { const b0 = G.bounds([e]), b1 = G.bounds([turned]); out.push(G.translate(e, (b1.minX + b1.maxX - b0.minX - b0.maxX) / 2, (b1.minY + b1.maxY - b0.minY - b0.maxY) / 2)); }
   else out.push(turned);
  }
 } else if (kind === 'path') {
  const path = p.path, total = path.slice(1).reduce((s, q, i) => s + G.dist(path[i], q), 0);
  const along = pointsAlongWithAngle(path, Array.from({length: p.count}, (_, i) => total * i / (p.count - 1)));
  const a0 = along[0]?.angle || 0;
  along.forEach((at) => { for (const e of items) { const turned = p.align === false ? e : G.rotate(e, p.base, at.angle - a0); out.push(G.translate(turned, at.point.x - p.base.x, at.point.y - p.base.y)); } });
 }
 return out;
}
/** 고른 객체를 연관 배열 블록 하나로. items 는 원본 그대로(세계 좌표). */
export function makeAssocArray(items, kind, params, layer) {
 checkArrayParams(kind, params, items.length);
 const clean = items.map(({id, ...rest}) => structuredClone(rest));
 return {type: 'block', name: `*배열(${{rect: '직사각', polar: '원형', path: '경로'}[kind]})`, layer: layer ?? clean[0]?.layer, assocArray: {kind, params: structuredClone(params), items: clean}, entities: expandArray(clean, kind, params)};
}
/** 매개변수만 바꿔 다시 펼친다(사본을 지우고 다시 만들지 않음). */
export function editAssocArray(e, changes) {
 if (!e?.assocArray) throw Error('연관 배열이 아닙니다.');
 const {kind, items} = e.assocArray, params = {...e.assocArray.params, ...changes};
 checkArrayParams(kind, params, items.length);
 return {...e, assocArray: {...e.assocArray, params}, entities: expandArray(items, kind, params)};
}
/** 사람이 읽는 요약(속성 창·프롬프트). */
export function describeAssocArray(e) {
 const {kind, params: p} = e.assocArray || {};
 if (kind === 'rect') return `직사각 배열 · ${p.rows}행 × ${p.columns}열 · 열 간격 ${+G.len(p.u).toFixed(3)} · 행 간격 ${+G.len(p.v).toFixed(3)}`;
 if (kind === 'polar') return `원형 배열 · ${p.count}개 · 채울 각도 ${p.fill}°`;
 if (kind === 'path') return `경로 배열 · ${p.count}개${p.align === false ? '' : ' · 경로 방향 정렬'}`;
 return '';
}

/* ══════════ 413 · 연관 해치 ══════════ */
const ringDepths = (rings) => rings.map((r, i) => rings.reduce((n, other, j) => n + (j !== i && Math.abs(G.polygonArea(other)) > Math.abs(G.polygonArea(r)) && G.inside(r[0], other) ? 1 : 0), 0));
/** 섬 검출 방식(HPISLANDDETECTION): normal 짝홀 그대로 · outer 바깥 영역만(첫 섬까지만 구멍) · ignore 섬 무시. */
export function islandFilter(boundary, mode = 'normal') {
 if (!boundary) return boundary;
 const rings = [boundary.points, ...(boundary.loops || [])];
 if (mode === 'ignore' || mode === 'outer') {
  const depth = ringDepths(rings), outer = rings.filter((_, i) => depth[i] === 0);
  const keep = mode === 'ignore' ? outer : rings.filter((_, i) => depth[i] <= 1);
  return {points: keep[0], loops: keep.slice(1)};
 }
 return {points: boundary.points, loops: boundary.loops || []};
}
/** 원본 경계가 바뀐 해치의 새 모양. 원본이 모두 있고 닫혀 있으면 {points,loops}, 아니면 null(연결 끊기). */
export function assocHatchChanges(hatch, sources) {
 if (sources.length !== hatch.boundaryIds.length || sources.some((s) => !s)) return null;
 const {boundary, rejected} = G.hatchSelectionBoundary(sources);
 if (!boundary || rejected.length) return null;
 return islandFilter(boundary, hatch.islandMode || 'normal');
}

/* ══════════ 423 · 연관 중심선 · 중심 표시 ══════════ */
/** "0.1x" = 반지름의 0.1 배, 그냥 숫자 = 그 길이(AutoCAD CENTERCROSSSIZE 와 같은 형식). */
export const parseRelative = (v, r) => (String(v).trim().toLowerCase().endsWith('x') ? Number(String(v).trim().slice(0, -1)) * r : Number(v));
export const CENTER_DEFAULTS = Object.freeze({size: '0.1x', gap: '0.05x', markExt: 1, lineExt: 3.5});
/** 원·호 중심 표시: 가운데 십자 + 틈 + 원 밖으로 조금 나간 중심선 4개. */
export function centerMarkParts(c, opts = {}) {
 if (!c?.center || !(c.radius > 0)) return null;
 const size = parseRelative(opts.size ?? CENTER_DEFAULTS.size, c.radius), gap = parseRelative(opts.gap ?? CENTER_DEFAULTS.gap, c.radius), ext = Number(opts.ext ?? CENTER_DEFAULTS.markExt);
 if (!(size > 0) || !(gap >= 0) || !(ext >= 0)) throw Error('중심 표시 크기·틈·연장 값을 확인하세요.');
 const o = c.center, line = (a, b, linetype) => ({type: 'line', points: [G.add(o, a), G.add(o, b)], ...(linetype ? {linetype} : {})});
 const out = [];
 for (const [dx, dy] of [[1, 0], [0, 1]]) {
  out.push(line({x: -size * dx, y: -size * dy}, {x: size * dx, y: size * dy}));
  if (c.radius + ext > size + gap) for (const s of [1, -1]) out.push(line({x: s * (size + gap) * dx, y: s * (size + gap) * dy}, {x: s * (c.radius + ext) * dx, y: s * (c.radius + ext) * dy}, 'CENTER'));
 }
 return out;
}
/** 두 선(평행 또는 기울어진) 사이 중심선: 두 선의 같은 방향 끝점 가운데를 잇고 양끝을 ext 만큼 늘린다. */
export function centerLineParts(A, B, opts = {}) {
 if (!A?.points || !B?.points || A.points.length < 2 || B.points.length < 2) return null;
 const [a0, a1] = [A.points[0], A.points.at(-1)];
 let [b0, b1] = [B.points[0], B.points.at(-1)];
 if (G.dot(G.sub(a1, a0), G.sub(b1, b0)) < 0) [b0, b1] = [b1, b0];
 const s = G.mul(G.add(a0, b0), .5), t = G.mul(G.add(a1, b1), .5);
 if (G.dist(s, t) < 1e-9) return null;
 const u = G.unit(G.sub(t, s)), x = Number(opts.ext ?? CENTER_DEFAULTS.lineExt);
 return [{type: 'line', linetype: 'CENTER', points: [G.sub(s, G.mul(u, x)), G.add(t, G.mul(u, x))]}];
}
/** 중심 표시/중심선 블록 하나. refs 는 원본 id, sources 는 원본 객체. */
export function makeCenterObject(kind, sources, layer, opts = {}) {
 const parts = kind === 'mark' ? centerMarkParts(sources[0], opts) : centerLineParts(sources[0], sources[1], opts);
 if (!parts?.length) throw Error(kind === 'mark' ? '원이나 호를 고르세요.' : '서로 떨어진 두 선을 고르세요.');
 const centerOpts = kind === 'mark' ? {size: opts.size ?? CENTER_DEFAULTS.size, gap: opts.gap ?? CENTER_DEFAULTS.gap, ext: Number(opts.ext ?? CENTER_DEFAULTS.markExt)} : {ext: Number(opts.ext ?? CENTER_DEFAULTS.lineExt)};
 return {type: 'block', name: kind === 'mark' ? '*중심표시' : '*중심선', layer, assocRefs: sources.map((s) => s.id), centerKind: kind, centerOptions: centerOpts, entities: parts.map((p) => ({...p, layer}))};
}
function centerChanges(e, sources) {
 if (sources.some((s) => !s)) return null;
 const parts = e.centerKind === 'mark' ? centerMarkParts(sources[0], e.centerOptions) : centerLineParts(sources[0], sources[1], e.centerOptions);
 return parts?.length ? {entities: parts.map((p) => ({...p, layer: e.layer}))} : null;
}

/* ══════════ 공통 · 명령 뒤 다시 계산 ══════════ */
/** 연관 객체인가(entity-index 가 목록을 들고 있는 기준). */
export const isAssociative = (e) => !!(e && ((e.type === 'hatch' && Array.isArray(e.boundaryIds) && e.boundaryIds.length) || (Array.isArray(e.assocRefs) && e.assocRefs.length)));
const refsOf = (e) => (e.type === 'hatch' ? e.boundaryIds : e.assocRefs);
/** 이번 명령이 건드린 id(바뀐 것 + 지운 것). */
export function touchedIds(command, result) {
 const ids = new Set(result || []);
 for (const id of command?.ids || []) ids.add(id);
 if (command?.id) ids.add(command.id);
 for (const t of command?.targets || []) if (t?.id) ids.add(t.id);
 for (const u of command?.updates || []) if (u?.id) ids.add(u.id);
 if (command?.type === 'batch') for (const sub of command.commands || []) for (const id of touchedIds(sub, [])) ids.add(id);
 return ids;
}
/**
 * 명령이 끝난 문서에서 원본이 바뀐 연관 객체만 다시 만든다.
 * @param doc 작업 문서(이 명령의 사본) · @param candidates 이전 문서의 연관 객체 목록(색인) · @returns 다시 만든 객체 id
 * 훑는 양: 연관 객체 수 + (영향받은 것이 있을 때만) 도면 한 번.
 */
export function refreshAssociations(doc, candidates, command, result) {
 if (!candidates?.length) return [];
 const touched = touchedIds(command, result);
 const affected = candidates.filter((a) => !touched.has(a.id) && refsOf(a).some((id) => touched.has(id)));
 if (!affected.length) return [];
 const want = new Set([...affected.map((a) => a.id), ...affected.flatMap(refsOf)]), byId = new Map();
 for (const e of doc.entities) if (want.has(e.id)) byId.set(e.id, e);
 const replaced = new Map();
 for (const old of affected) {
  const current = byId.get(old.id);
  if (!current || !isAssociative(current)) continue; // 연관 객체 자신이 지워졌거나 이미 연결이 끊김
  const sources = refsOf(current).map((id) => byId.get(id));
  const changes = current.type === 'hatch' ? assocHatchChanges(current, sources) : centerChanges(current, sources);
  // 원본이 없어지거나 닫히지 않으면 모양은 두고 연결만 끊는다.
  const next = changes ? {...current, ...changes} : {...current, ...(current.type === 'hatch' ? {boundaryIds: undefined} : {assocRefs: undefined})};
  if (!changes) { delete next.boundaryIds; delete next.assocRefs; next.assocBroken = true; }
  for (const key of ['_renderBounds', '_visibleEntities', '_lodCollapsed']) delete next[key];
  replaced.set(current.id, next);
 }
 if (!replaced.size) return [];
 doc.entities = doc.entities.map((e) => replaced.get(e.id) || e);
 return [...replaced.keys()];
}
