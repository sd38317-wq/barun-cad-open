// 도곽편집(훈민캐드 대조 기반 H75 · 훈민 CCV·MMV·SSV·EEV, AutoCAD 배치(layout) 기준 COPY·MOVE·STRETCH·ERASE).
//  SHEETEDIT(도곽편집)  작업(C 복사 · M 이동 · S 늘리기 · E 영역 지우기)을 고른 뒤 아래 명령과 똑같이 진행한다.
//  CCV  원본 도곽 안을 한 번 클릭 → 대상 도곽 안을 한 번 클릭 → 도곽 기준 상대 위치로 복사(축척 보정 선택).
//  MMV  같은 방식으로 이동(객체 ID 유지).
//  SSV  원본 도곽 클릭 → 도곽 안 걸침 창 두 점 → 이동량(대상 도곽까지의 거리 / 두 점 / 숫자)만큼 AutoCAD STRETCH.
//  EEV  도곽 클릭 → 도곽·표제란을 뺀 안쪽 객체를 개수 확인 뒤 한 번에 지운다.
// 도곽 인식(한 번 클릭): 등록 도곽(doc.sheets · SHEET/PLOTBOX)을 먼저 보고(점을 담는 가장 작은 것), 없으면 클릭점을 둘러싼
// 가장 작은 "용지 비율(√2)" 닫힌 사각형·폴리선·블록을 도곽으로 본다. 도곽 크기로 용지(A0~A4)와 축척(1:N)을 추정한다.
// 축척 보정은 DBC(sheet-plot-tools.js copyBetweenBoxes)와 같은 뜻이다: 원본 도곽 좌하귀 → 대상 도곽 좌하귀, 배율 = 대상/원본
// 도곽 크기. 같은 용지에서 1:100 → 1:50 이면 대상 도곽이 모형 공간에서 절반 크기라 도형도 ×0.5(용지에서는 같은 크기)다.
// "용지에서 두 배로 크게(실제 크기 유지)"는 'real' 방식 — 도형은 ×1, 문자·치수·기호만 ANNOSCALE 과 같은 비율(×0.5)로 맞춘다.
// 잠긴 레이어·꺼진/동결 레이어·숨긴 객체는 건드리지 않는다. 한 번의 적용은 batch 하나(Ctrl+Z 한 번)다.
import * as G from './geometry.js';
import {isChecked} from './card-input.js';
import {entitiesForSheet} from './sheet-tools.js';
import {PAPER_MM, boxFromCorners, entitiesFullyInside, isAxisAlignedQuad} from './sheet-plot-tools.js';
import {annotationScaleCommands} from './annotation-scale.js';

/* ══════════ 용지·축척 추정 ══════════ */
/** A1·A3·A4 는 sheet-plot-tools PAPER_MM 을 그대로 쓰고, plot.js 출력 용지표의 A0·A2 를 더했다(가로 × 세로 mm). */
export const PAPER_SIZES = Object.freeze({A0: Object.freeze([1189, 841]), A1: PAPER_MM.A1, A2: Object.freeze([594, 420]), A3: PAPER_MM.A3, A4: PAPER_MM.A4});
/** 표준 축척 분모(sheet-plot-tools PB·PPP 의 NICE_SCALES 와 같은 목록). */
export const STANDARD_SCALES = Object.freeze([1, 2, 5, 10, 20, 25, 30, 40, 50, 60, 75, 100, 120, 150, 200, 250, 300, 400, 500, 600, 750, 1000, 1200, 1500, 2000, 2500, 3000, 4000, 5000, 6000, 7500, 10000]);
/** 도곽·표제란으로 보는 레이어·블록 이름(CALS A-TITLE, PB 의 PLOT_BOX 포함). */
export const FRAME_NAME_RE = /도곽|표제|TITLE|TTLB|FRAME|BORDER|PLOT_?BOX|A-PLOT/i;

/** 도곽 크기(모형 mm) → 용지·축척. 가로:세로가 √2 에서 aspectTolerance 넘게 벗어나면 null.
 *  용지마다 "그 용지에 들어가는 가장 작은 표준 축척"을 구하고, 가장 꽉 차는(fit 이 1 에 가까운) 용지를 고른다.
 *  모형 공간 크기만으로는 A3 1:100(42000×29700)과 A1 1:50(42050×29700)을 가릴 수 없으므로 거의 같으면 preferPaper 를 따른다. */
export function inferPaperScale(width, height, {preferPaper = 'A3', aspectTolerance = 0.03, fitTolerance = 0.08} = {}) {
 const w = Math.abs(Number(width)), h = Math.abs(Number(height));
 if (!(w > G.EPS && h > G.EPS)) return null;
 const long = Math.max(w, h), short = Math.min(w, h), aspectError = Math.abs(long / short / Math.SQRT2 - 1);
 if (aspectError > aspectTolerance) return null;
 const candidates = [];
 for (const [paper, [pl, ps]] of Object.entries(PAPER_SIZES)) {
  const need = Math.max(long / pl, short / ps), denominator = STANDARD_SCALES.find(s => s >= need * (1 - 1e-6));
  if (denominator) candidates.push({paper, denominator, error: Math.max(0, 1 - need / denominator)});
 }
 if (!candidates.length) return null;
 candidates.sort((a, b) => a.error - b.error);
 const best = candidates[0], pick = candidates.find(c => c.paper === preferPaper && c.error <= best.error + 0.005) || best;
 return {paper: pick.paper, denominator: pick.denominator, orientation: w >= h ? 'landscape' : 'portrait', fit: 1 - pick.error, standard: pick.error <= fitTolerance, aspectError};
}

/* ══════════ 도곽 인식 ══════════ */
const area = (b) => (b.maxX - b.minX) * (b.maxY - b.minY);
const containsPoint = (b, p, tol = 0) => p.x >= b.minX - tol && p.x <= b.maxX + tol && p.y >= b.minY - tol && p.y <= b.maxY + tol;
const overlaps = (a, b) => a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;
const layerIndex = (layers) => new Map((layers || []).map(l => [l.id, l]));
const layerHidden = (layer) => !!layer && (layer.visible === false || !!layer.frozen);
const isDefaultLayer = (layer) => !layer || layer.id === 'default' || layer.name === '0';

/** 이름(레이어·블록)이나 PB 표식으로 보아 도곽·표제란인 객체. */
export function isFrameLike(entity, layers) {
 const lm = layers instanceof Map ? layers : layerIndex(layers);
 return !!entity && (!!entity.plotBox || FRAME_NAME_RE.test(lm.get(entity.layer)?.name || '') || (entity.type === 'block' && FRAME_NAME_RE.test(entity.name || '')));
}

/** 도곽이 될 수 있는 닫힌 사각형: rectangle, 또는 꼭짓점이 더 있어도 면적이 외곽 사각형과 거의 같은(98%) 닫힌 폴리선. */
export function isRectLikeFrame(entity) {
 if (entity?.type === 'rectangle') return Array.isArray(entity.points) && entity.points.length >= 4;
 if (entity?.type !== 'polyline' || !Array.isArray(entity.points) || entity.points.length < 4) return false;
 const pts = entity.points;
 if (!entity.closed && G.dist(pts[0], pts.at(-1)) > 1e-6) return false;
 if (isAxisAlignedQuad({...entity, closed: true})) return true;
 const b = G.bounds([entity]);
 return !!b && area(b) > G.EPS && G.polygonArea(pts) >= area(b) * 0.98;
}

/** 그린 도곽 후보(보이는 레이어의 사각형·닫힌 폴리선·블록 중 용지 비율인 것). 이름이 도곽 같지 않으면 긴 변 minSize 이상,
 *  표준 축척에 8% 안으로 맞아야 한다(문·가구 블록을 도곽으로 잘못 잡지 않도록). */
export function drawnFrameCandidates(entities, layers, {preferPaper = 'A3', minSize = 1000, aspectTolerance = 0.03} = {}) {
 const lm = layerIndex(layers), out = [];
 for (const e of entities || []) {
  if (e.hidden || e.sheetDecoration) continue;
  if (e.type === 'block' ? e.table : !isRectLikeFrame(e)) continue;
  if (layerHidden(lm.get(e.layer))) continue;
  const b = G.bounds([e]);
  if (!b) continue;
  const w = b.maxX - b.minX, h = b.maxY - b.minY, named = isFrameLike(e, lm);
  if (!named && Math.max(w, h) < minSize) continue;
  const spec = inferPaperScale(w, h, {preferPaper, aspectTolerance});
  if (!spec || (!spec.standard && !named)) continue;
  out.push({entity: e, bounds: b, spec, named});
 }
 return out;
}

function registeredFrame(sheet, entities, preferPaper) {
 const b = {minX: sheet.bounds.minX, minY: sheet.bounds.minY, maxX: sheet.bounds.maxX, maxY: sheet.bounds.maxY};
 const w = b.maxX - b.minX, h = b.maxY - b.minY, spec = inferPaperScale(w, h, {preferPaper: sheet.paper || preferPaper, aspectTolerance: 10});
 const denominator = Number(sheet.denominator) > 0 ? Number(sheet.denominator) : spec?.denominator ?? null;
 return {kind: 'registered', id: sheet.id, sheet, number: sheet.number || '', title: sheet.title || '', paper: sheet.paper || spec?.paper || '', denominator,
  orientation: w >= h ? 'landscape' : 'portrait', standard: true, bounds: b,
  frameIds: (entities || []).filter(e => e.sheetId === sheet.id && e.sheetDecoration).map(e => e.id), frameLayers: []};
}
function drawnFrame(candidate, layers) {
 const e = candidate.entity, layer = layerIndex(layers).get(e.layer);
 return {kind: 'drawn', id: e.id, entityId: e.id, number: '', title: e.type === 'block' ? (e.name || '') : '', paper: candidate.spec.paper, denominator: candidate.spec.denominator,
  orientation: candidate.spec.orientation, standard: candidate.spec.standard, bounds: {...candidate.bounds}, frameIds: [e.id], frameLayers: isDefaultLayer(layer) ? [] : [e.layer]};
}

/** 한 번 클릭으로 도곽 찾기. 등록 도곽(점을 담는 가장 작은 것) → 없으면 그린 도곽(이름이 도곽 같은 것 우선, 그 안에서 가장 작은 것).
 *  돌려주는 값: {kind:'registered'|'drawn', id, number, title, paper, denominator, orientation, bounds, frameIds, frameLayers} 또는 null. */
export function sheetAtPoint(point, {sheets = [], entities = [], layers = [], preferPaper = 'A3', tolerance = 0, minSize = 1000} = {}) {
 if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return null;
 const registered = (sheets || []).filter(s => s?.bounds && containsPoint(s.bounds, point, tolerance)).sort((a, b) => area(a.bounds) - area(b.bounds));
 if (registered.length) return registeredFrame(registered[0], entities, preferPaper);
 const candidates = drawnFrameCandidates(entities, layers, {preferPaper, minSize}).filter(c => containsPoint(c.bounds, point, tolerance));
 if (!candidates.length) return null;
 candidates.sort((a, b) => (b.named - a.named) || (area(a.bounds) - area(b.bounds)));
 return drawnFrame(candidates[0], layers);
}

const fmt = (v) => Number(Number(v).toFixed(4)).toLocaleString('ko-KR', {maximumFractionDigits: 4});
/** 도곽 이름표(안내·토스트용). */
export function frameLabel(frame) {
 const scale = frame?.denominator ? `1:${fmt(frame.denominator)}` : '축척 미상';
 if (frame?.kind === 'registered') return `도곽 ${[frame.number, frame.title].filter(Boolean).join(' ') || '(이름 없음)'} (${frame.paper || '용지 미상'} ${scale})`;
 return `그린 도곽${frame?.title ? ` "${frame.title}"` : ''} (${frame?.paper || '용지 미상'} ${scale}${frame?.standard === false ? ' 추정' : ''})`;
}
export const sameFrame = (a, b) => !!a && !!b && a.kind === b.kind && a.id === b.id;
export function noFrameMessage(point) {
 const at = point && Number.isFinite(point.x) ? `(X ${Math.round(point.x).toLocaleString('ko-KR')}, Y ${Math.round(point.y).toLocaleString('ko-KR')})` : '';
 return `클릭한 점${at}을 둘러싼 도곽을 찾지 못했습니다. 등록한 도곽(SHEET·PLOTBOX) 안, 또는 용지 비율(A0~A4 가로:세로 ≈ 1.414)로 그린 닫힌 사각형·폴리선·블록 도곽 안을 클릭하세요.`;
}

/* ══════════ 도곽 안 객체 ══════════ */
/** 도곽에 속한 객체를 나눈다. 등록 도곽은 sheet-tools entitiesForSheet(도곽 연결값 또는 완전 포함), 그린 도곽은 완전 포함.
 *  items: 편집할 것 · frame: 도곽·표제란(남김) · locked/hidden: 잠긴·숨긴 레이어(건드리지 않음) · linked: 짝(벽·실 경계)이 도곽 밖이라 뺀
 *  개구부·실 이름 · crossing: 도곽 경계에 걸쳐 빠진 개수 · unselected: 선택 범위 밖이라 뺀 개수. */
export function sheetContent(frame, {entities = [], layers = [], keepFrame = true, selectionIds = null} = {}) {
 const lm = layerIndex(layers), frameIds = new Set(frame.frameIds || []), frameLayers = new Set(frame.frameLayers || []);
 const members = frame.kind === 'registered' && frame.sheet ? entitiesForSheet({entities}, frame.sheet) : entitiesFullyInside(entities, frame.bounds);
 const selection = selectionIds ? new Set(selectionIds) : null, memberIds = new Set(members.map(e => e.id));
 const out = {items: [], frame: [], locked: [], hidden: [], linked: [], crossing: 0, unselected: 0};
 for (const e of members) {
  if (frameIds.has(e.id) || e.sheetDecoration) { out.frame.push(e); continue; }
  if (keepFrame && (frameLayers.has(e.layer) || isFrameLike(e, lm))) { out.frame.push(e); continue; }
  if (selection && !selection.has(e.id)) { out.unselected++; continue; }
  const layer = lm.get(e.layer);
  if (layer?.locked) { out.locked.push(e); continue; }
  if (layerHidden(layer) || e.hidden) { out.hidden.push(e); continue; }
  out.items.push(e);
 }
 // 벽의 개구부·실 경계의 실 이름처럼 짝을 가리키는 객체는 짝과 함께일 때만 옮긴다(짝 없이 옮기면 엔진이 원래 벽에 다시 붙인다).
 const all = new Set((entities || []).map(e => e.id)), picked = new Set(out.items.map(e => e.id));
 out.items = out.items.filter(e => {
  const orphan = (e.hostWall && all.has(e.hostWall) && !picked.has(e.hostWall)) || (e.roomBoundary && all.has(e.roomBoundary) && !picked.has(e.roomBoundary));
  if (orphan) out.linked.push(e);
  return !orphan;
 });
 const fb = frame.bounds;
 for (const e of entities || []) {
  if (memberIds.has(e.id) || frameIds.has(e.id) || e.sheetDecoration) continue;
  const b = G.bounds([e]);
  // 도곽을 통째로 감싸는 것(바깥 도곽 등)은 "걸친" 객체가 아니다.
  if (b && overlaps(b, fb) && !(b.minX <= fb.minX && b.minY <= fb.minY && b.maxX >= fb.maxX && b.maxY >= fb.maxY)) out.crossing++;
 }
 return out;
}

/* ══════════ 도곽 → 도곽 대응 ══════════ */
export const SCALE_MODES = Object.freeze(['paper', 'real', 'none']);
/** 원본 도곽 → 대상 도곽 변환. 기준은 두 도곽의 좌하귀.
 *  paper: 배율 = 대상/원본 도곽 크기(가로·세로 중 작은 쪽, 비율이 같으면 DBC 의 가로 비율과 같다) — 용지에서 같은 크기.
 *  real : 배율 1(실제 크기), 문자·치수·기호만 대상/원본 축척 분모 비율(annotationRatio)로 — 용지에서 축척만큼 크거나 작게.
 *  none : 배율 1, 주석도 그대로 — 위치만 도곽 기준으로 옮긴다. */
export function sheetMapping(source, target, mode = 'paper') {
 const sb = source?.bounds || source, tb = target?.bounds || target;
 const sw = sb.maxX - sb.minX, sh = sb.maxY - sb.minY, tw = tb.maxX - tb.minX, th = tb.maxY - tb.minY;
 if (!(sw > G.EPS && sh > G.EPS)) throw Error('원본 도곽 영역이 올바르지 않습니다.');
 if (!(tw > G.EPS && th > G.EPS)) throw Error('대상 도곽 영역이 올바르지 않습니다.');
 if (!SCALE_MODES.includes(mode)) throw Error('축척 보정 방식은 paper·real·none 중 하나입니다.');
 const factor = mode === 'paper' ? Math.min(tw / sw, th / sh) : 1;
 const sd = Number(source?.denominator), td = Number(target?.denominator);
 const annotationRatio = mode === 'real' && sd > 0 && td > 0 ? td / sd : 1;
 const base = {x: sb.minX, y: sb.minY}, dx = tb.minX - sb.minX, dy = tb.minY - sb.minY;
 return {mode, factor, base, dx, dy, annotationRatio, map: (p) => ({x: tb.minX + (p.x - sb.minX) * factor, y: tb.minY + (p.y - sb.minY) * factor})};
}

/** 한 객체를 대응에 따라 옮긴 사본(ID 는 그대로). DBC copyBetweenBoxes 와 같은 순서: 원본 좌하귀 기준 축척 → 평행 이동. */
export function transformForSheet(entity, mapping) {
 const scaled = Math.abs(mapping.factor - 1) > 1e-12 ? G.resize(entity, mapping.base, mapping.factor) : entity;
 return G.translate(scaled, mapping.dx, mapping.dy);
}
/** 축척 보정 뒤에도 치수 값이 실제 길이를 가리키도록 측정 배율(DIMLFAC)을 1/배율로. 각도 치수는 그대로. */
export function dimensionValueChanges(entity, factor) {
 if (entity?.type !== 'dimension' || entity.mode === 'angular' || !(factor > 0) || Math.abs(factor - 1) < 1e-12) return null;
 return {measurementScale: (Number(entity.measurementScale) || 1) / factor};
}
const newId = () => globalThis.crypto?.randomUUID?.() || ('sheet-edit-' + Date.now().toString(36) + Math.random().toString(36).slice(2));
function remapChildIds(entity, idFactory) {
 if (Array.isArray(entity.entities)) for (const child of entity.entities) { if (child.id !== undefined) child.id = idFactory(); remapChildIds(child, idFactory); }
 return entity;
}

/** CCV: 대상 도곽에 들어갈 사본 목록(새 ID, 벽-개구부·실 경계 연결도 사본끼리 다시 잇는다). */
export function copyForSheet(items, mapping, {keepDimensionValue = true, targetSheetId = null, idFactory = newId} = {}) {
 const ids = new Map(items.map(e => [e.id, idFactory()]));
 return items.map(e => {
  const c = remapChildIds(transformForSheet(e, mapping), idFactory);
  c.id = ids.get(e.id);
  delete c.lineWallHost;
  if (c.hostWall && ids.has(c.hostWall)) c.hostWall = ids.get(c.hostWall);
  if (c.roomBoundary && ids.has(c.roomBoundary)) c.roomBoundary = ids.get(c.roomBoundary);
  if (c.sheetId !== undefined) { if (targetSheetId) c.sheetId = targetSheetId; else delete c.sheetId; }
  if (keepDimensionValue) Object.assign(c, dimensionValueChanges(e, mapping.factor) || {});
  return c;
 });
}
/** CCV 엔진 명령(batch 에 넣을 목록). */
export function copyCommands(items, mapping, options = {}) {
 const copies = copyForSheet(items, mapping, options);
 const commands = copies.map(entity => ({type: 'add', entity}));
 if (mapping.annotationRatio !== 1) commands.push(...annotationScaleCommands(copies, mapping.annotationRatio).commands);
 return {commands, ids: copies.map(c => c.id), copies};
}
/** MMV 엔진 명령. 엔진 scale·move 를 그대로 써서 ID·그리는 순서·벽-개구부 연동을 지킨다. */
export function moveCommands(items, mapping, {keepDimensionValue = true, sourceSheetId = null, targetSheetId = null} = {}) {
 const ids = items.map(e => e.id), commands = [];
 if (!ids.length) return {commands, ids};
 if (Math.abs(mapping.factor - 1) > 1e-12) commands.push({type: 'scale', ids, base: mapping.base, factor: mapping.factor});
 if (mapping.dx || mapping.dy) commands.push({type: 'move', ids, dx: mapping.dx, dy: mapping.dy});
 if (keepDimensionValue) for (const e of items) { const changes = dimensionValueChanges(e, mapping.factor); if (changes) commands.push({type: 'update', ids: [e.id], changes}); }
 const rebind = sourceSheetId ? items.filter(e => e.sheetId === sourceSheetId && !e.sheetDecoration).map(e => e.id) : [];
 if (rebind.length) commands.push({type: 'update', ids: rebind, changes: {sheetId: targetSheetId ?? null}});
 if (mapping.annotationRatio !== 1) commands.push(...annotationScaleCommands(items.map(e => transformForSheet(e, mapping)), mapping.annotationRatio).commands);
 return {commands, ids};
}

/* ══════════ SSV · 걸침 창 늘리기(AutoCAD STRETCH) ══════════ */
export const STRETCH_VERTEX_TYPES = Object.freeze(['line', 'polyline', 'rectangle', 'dimension', 'hatch']);
const ANCHOR_TYPES = new Set(['text', 'point', 'block', 'circle', 'arc', 'ellipse']);
export const pointInBox = (p, box, eps = 1e-9) => !!p && Number.isFinite(p.x) && Number.isFinite(p.y) && p.x >= box.minX - eps && p.x <= box.maxX + eps && p.y >= box.minY - eps && p.y <= box.maxY + eps;
/** 창 안에 든 꼭짓점 번호(선·폴리선·사각형·치수 정의점·해치 외곽). 다른 형식은 빈 목록. */
export function stretchVertexIndices(entity, box) {
 if (!STRETCH_VERTEX_TYPES.includes(entity?.type) || !Array.isArray(entity.points)) return [];
 return entity.points.map((p, i) => (pointInBox(p, box) ? i : -1)).filter(i => i >= 0);
}
/** 문자·블록·원·호의 기준점(삽입점·중심). 없으면 외곽 중심. */
export function stretchAnchor(entity) {
 if (entity?.position && Number.isFinite(entity.position.x)) return entity.position;
 if (entity?.center && Number.isFinite(entity.center.x)) return entity.center;
 const b = G.bounds([entity]);
 return b ? {x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2} : null;
}
/** 걸침 창 분류(AutoCAD STRETCH): 창 안에 통째로 든 객체와 꼭짓점이 모두 든 객체는 이동(moveIds), 걸친 선·폴리선·사각형·치수·해치는
 *  창 안 꼭짓점만(targets), 문자·블록·원·호는 기준점이 창 안이면 이동. 걸친 벽·구멍 있는 해치는 skipped, 잠긴·숨긴 레이어는 locked/hidden. */
export function stretchPlan(entities, box, {layers = [], excludeIds = [], frameLayers = [], keepFrame = true} = {}) {
 const lm = layerIndex(layers), exclude = new Set(excludeIds), fl = new Set(frameLayers);
 const plan = {moveIds: [], targets: [], locked: [], hidden: [], skipped: []};
 for (const e of entities || []) {
  if (exclude.has(e.id) || e.sheetDecoration) continue;
  const b = G.bounds([e]);
  if (!b || !overlaps(b, box)) continue;
  if (keepFrame && (fl.has(e.layer) || isFrameLike(e, lm))) continue;
  const layer = lm.get(e.layer);
  if (layer?.locked) { plan.locked.push(e.id); continue; }
  if (layerHidden(layer) || e.hidden) { plan.hidden.push(e.id); continue; }
  if (pointInBox({x: b.minX, y: b.minY}, box) && pointInBox({x: b.maxX, y: b.maxY}, box)) { plan.moveIds.push(e.id); continue; }
  if (STRETCH_VERTEX_TYPES.includes(e.type)) {
   if (e.type === 'hatch' && (e.loops || []).some(loop => loop.some(p => pointInBox(p, box)))) { plan.skipped.push({id: e.id, reason: '구멍 있는 해치'}); continue; }
   const indices = stretchVertexIndices(e, box);
   if (!indices.length) continue;
   if (indices.length === e.points.length) plan.moveIds.push(e.id); else plan.targets.push({id: e.id, indices});
  } else if (e.type === 'wall') {
   if ((e.points || []).some(p => pointInBox(p, box))) plan.skipped.push({id: e.id, reason: '벽'});
  } else if (ANCHOR_TYPES.has(e.type)) {
   if (pointInBox(stretchAnchor(e), box)) plan.moveIds.push(e.id);
  }
 }
 return plan;
}
/** 늘린 결과 객체(미리보기·명령 공용). 엔진 stretch 와 같은 G.stretchEntities 를 쓰되 연동 치수는 이번에 늘리는 객체 안에서만 찾는다
 *  (잠긴 레이어 치수가 끌려가지 않도록). */
export function stretchedEntities(entities, plan, delta) {
 const byId = new Map((entities || []).map(e => [e.id, e]));
 const pool = plan.targets.map(t => byId.get(t.id)).filter(Boolean);
 return pool.length ? G.stretchEntities(pool, plan.targets, delta) : [];
}
/** SSV 엔진 명령: 통째 이동은 엔진 move, 꼭짓점 늘리기는 update(점 목록). 사각형은 늘린 뒤에도 축에 나란하면 사각형으로 두고,
 *  찌그러지면 같은 ID 의 닫힌 폴리선으로 바꾼다(엔진 stretch 와 같은 결과). */
export function stretchCommands(entities, plan, delta) {
 const dx = Number(delta?.x), dy = Number(delta?.y);
 if (!Number.isFinite(dx) || !Number.isFinite(dy)) throw Error('늘리기 이동량이 올바르지 않습니다.');
 if (Math.hypot(dx, dy) < G.EPS) throw Error('늘리기 이동량이 0입니다. 다른 점이나 값을 지정하세요.');
 const commands = [], byId = new Map((entities || []).map(e => [e.id, e]));
 if (plan.moveIds.length) commands.push({type: 'move', ids: [...plan.moveIds], dx, dy});
 for (const c of stretchedEntities(entities, plan, {x: dx, y: dy})) {
  const source = byId.get(c.id);
  if (c.type === source.type || isAxisAlignedQuad({...c, type: 'rectangle'})) commands.push({type: 'update', ids: [c.id], changes: {points: c.points}});
  else commands.push({type: 'delete', ids: [c.id]}, {type: 'add', entity: c});
 }
 return commands;
}

/* ══════════ 화면 명령 ══════════ */
const OPS = Object.freeze({
 copy: {code: 'CCV', verb: '복사', letter: 'C'},
 move: {code: 'MMV', verb: '이동', letter: 'M'},
 stretch: {code: 'SSV', verb: '늘리기', letter: 'S'},
 erase: {code: 'EEV', verb: '영역 지우기', letter: 'E'},
});
export function normalizeSheetEditOp(value) {
 const v = String(value ?? '').trim();
 const hit = Object.entries(OPS).find(([key, op]) => key === v.toLowerCase() || op.letter === v.toUpperCase() || op.code === v.toUpperCase());
 if (!hit) throw Error('작업은 C(복사)·M(이동)·S(늘리기)·E(영역 지우기) 중 하나입니다.');
 return hit[0];
}
function excludedNote(c) {
 const parts = [];
 if (c.locked?.length) parts.push(`잠긴 레이어 ${c.locked.length}개`);
 if (c.hidden?.length) parts.push(`숨긴 레이어·객체 ${c.hidden.length}개`);
 if (c.linked?.length) parts.push(`짝(벽·실 경계)이 도곽 밖인 개구부·실 이름 ${c.linked.length}개`);
 if (c.crossing) parts.push(`도곽 경계에 걸친 ${c.crossing}개`);
 if (c.skipped?.length) parts.push(`걸친 벽·구멍 있는 해치 ${c.skipped.length}개`);
 return parts.length ? ` · 제외: ${parts.join(', ')}` : '';
}

export function installSheetEditTools(ctx) {
 const sheets = () => ctx.doc?.()?.sheets || [];
 const preferPaper = () => ctx.getSettings?.()?.paper || 'A3';
 const captureSelection = () => { try { return ctx.selected?.() || []; } catch { return []; } };
 const content = (frame, options) => sheetContent(frame, {entities: ctx.entities(), layers: ctx.layers(), ...options});
 const finish = (ids) => { ctx.setSelected?.(ids); ctx.refresh?.(); };

 async function pickSheet(prompt) {
  const p = await ctx.pickPoint(prompt);
  if (!p) return null;
  const frame = sheetAtPoint(p, {sheets: sheets(), entities: ctx.entities(), layers: ctx.layers(), preferPaper: preferPaper()});
  if (!frame) throw Error(noFrameMessage(p));
  return frame;
 }

 async function pickWindow(frame, code) {
  const prompt = `${code} · ${frameLabel(frame)} 안에서 늘릴 걸침 창의 두 모서리를 지정하세요 · Esc 취소`;
  let a, b;
  if (typeof ctx.pickPath === 'function') {
   const picked = await ctx.pickPath({prompt, minPoints: 2, maxPoints: 2, preview: (pts, cursor) => {
    const all = cursor ? [...pts, cursor] : pts;
    if (all.length < 2) return [];
    const box = boxFromCorners(all[0], all[1]);
    return [{type: 'polyline', closed: true, points: G.rectangle({x: box.minX, y: box.minY}, {x: box.maxX, y: box.maxY}), previewColor: '#5fd35f'}];
   }});
   if (!picked?.points || picked.points.length < 2) return null;
   [a, b] = picked.points;
  } else {
   a = await ctx.pickPoint(prompt);
   if (!a) return null;
   b = await ctx.pickPoint(`${code} · 걸침 창의 반대쪽 모서리를 지정하세요 · Esc 취소`);
   if (!b) return null;
  }
  const raw = boxFromCorners(a, b), fb = frame.bounds;
  const box = {minX: Math.max(raw.minX, fb.minX), minY: Math.max(raw.minY, fb.minY), maxX: Math.min(raw.maxX, fb.maxX), maxY: Math.min(raw.maxY, fb.maxY)};
  if (!(box.maxX - box.minX > G.EPS && box.maxY - box.minY > G.EPS)) throw Error(`${code} · 늘리기 창이 원본 도곽과 겹치지 않거나 폭·높이가 0입니다. 도곽 안에서 두 모서리를 다시 지정하세요.`);
  return box;
 }

 /* CCV · MMV — 도곽 기준 복사·이동 */
 async function copyMove(op, preselected) {
  const {code, verb} = OPS[op];
  const src = await pickSheet(`${code} · ${verb}할 원본 도곽 안을 한 번 클릭하세요 · Esc 취소`);
  if (!src) return;
  const dst = await pickSheet(`${code} · 대상 도곽 안을 한 번 클릭하세요 · 원본 ${frameLabel(src)} · Esc 취소`);
  if (!dst) return;
  if (sameFrame(src, dst)) throw Error(`${code} · 원본과 대상이 같은 도곽(${frameLabel(src)})입니다. 다른 도곽 안을 클릭하세요.`);
  const selIds = preselected.map(e => e.id), all = content(src, {keepFrame: true});
  const sel = selIds.length ? content(src, {keepFrame: true, selectionIds: selIds}) : null;
  if (!all.items.length) throw Error(`${code} · ${frameLabel(src)} 안에 ${verb}할 객체가 없습니다${excludedNote(all)}.`);
  const paper = sheetMapping(src, dst, 'paper'), ratio = src.denominator && dst.denominator ? dst.denominator / src.denominator : null;
  const fields = [];
  if (sel?.items.length) fields.push({name: 'scope', label: '대상', options: [['selection', `선택한 객체 ${sel.items.length}개`], ['all', `도곽 안 전체 ${all.items.length}개`]], value: 'selection'});
  fields.push(
   {name: 'scaleMode', label: '축척 보정', value: 'paper', options: [
    ['paper', `도곽 크기 비율 ×${fmt(paper.factor)} (DBC 방식 · 용지에서 같은 크기)`],
    ['real', `실제 크기 유지 · 문자·치수·기호만 ${ratio ? '×' + fmt(ratio) : '그대로(축척 미상)'} (1:${fmt(src.denominator || 0)} → 1:${fmt(dst.denominator || 0)})`],
    ['none', '크기 그대로 · 도곽 좌하귀 기준 위치만'],
   ]},
   {name: 'keepDimensionValue', label: '치수 값 유지 (도곽 비율 보정 뒤에도 실제 길이를 표기 · 측정 배율)', type: 'checkbox', value: true},
   {name: 'keepFrame', label: '도곽·표제란(도곽·TITLE·TTLB 이름의 레이어·블록)은 제외', type: 'checkbox', value: true},
  );
  return ctx.form(`도곽 ${verb} (${code}) · ${frameLabel(src)} → ${frameLabel(dst)} · 객체 ${(sel?.items.length ? sel : all).items.length}개${excludedNote(sel?.items.length ? sel : all)}`, fields, (values) => {
   const useSelection = values.scope === 'selection' && sel?.items.length;
   const c = content(src, {keepFrame: isChecked(values.keepFrame), selectionIds: useSelection ? selIds : null});
   if (!c.items.length) throw Error(`${code} · ${verb}할 객체가 없습니다${excludedNote(c)}.`);
   const mapping = sheetMapping(src, dst, values.scaleMode || 'paper');
   const options = {keepDimensionValue: isChecked(values.keepDimensionValue), sourceSheetId: src.kind === 'registered' ? src.id : null, targetSheetId: dst.kind === 'registered' ? dst.id : null};
   const plan = op === 'copy' ? copyCommands(c.items, mapping, options) : moveCommands(c.items, mapping, options);
   ctx.execute({type: 'batch', commands: plan.commands});
   finish(plan.ids);
   const how = mapping.mode === 'paper' ? `배율 ×${fmt(mapping.factor)}(도곽 비율)` : mapping.mode === 'real' ? `실제 크기 · 주석 ×${fmt(mapping.annotationRatio)}` : '크기 그대로';
   ctx.toast(`${code} · ${frameLabel(src)} → ${frameLabel(dst)} · 객체 ${c.items.length}개 ${verb} · ${how}${excludedNote(c)} · Ctrl+Z 로 되돌리기`);
  });
 }

 /* SSV — 도곽 안 걸침 창 늘리기 */
 async function stretch() {
  const {code} = OPS.stretch;
  const src = await pickSheet(`${code} · 늘릴 원본 도곽 안을 한 번 클릭하세요 · Esc 취소`);
  if (!src) return;
  const box = await pickWindow(src, code);
  if (!box) return;
  const planFor = (keepFrame) => stretchPlan(ctx.entities(), box, {layers: ctx.layers(), excludeIds: src.frameIds, frameLayers: src.frameLayers, keepFrame});
  const plan = planFor(true);
  if (!plan.moveIds.length && !plan.targets.length) throw Error(`${code} · 창 안에 옮기거나 늘릴 객체가 없습니다${excludedNote(plan)}.`);
  return ctx.form(`도곽 늘리기 (${code}) · ${frameLabel(src)} · 통째 이동 ${plan.moveIds.length}개 · 꼭짓점 늘리기 ${plan.targets.length}개${excludedNote(plan)}`, [
   {name: 'how', label: '이동량', value: 'sheet', options: [['sheet', '대상 도곽 클릭 · 두 도곽 사이 거리만큼'], ['points', '기준점 → 두 번째 점'], ['value', '숫자 입력 (아래 X·Y)']]},
   {name: 'dx', label: 'X 이동 mm (숫자 입력일 때)', type: 'number', value: 0},
   {name: 'dy', label: 'Y 이동 mm (숫자 입력일 때)', type: 'number', value: 0},
   {name: 'keepFrame', label: '도곽·표제란(도곽·TITLE·TTLB 이름의 레이어·블록)은 제외', type: 'checkbox', value: true},
  ], async (values) => {
   const current = planFor(isChecked(values.keepFrame));
   let delta, note = '';
   if (values.how === 'value') {
    delta = {x: Number(values.dx), y: Number(values.dy)};
    if (!Number.isFinite(delta.x) || !Number.isFinite(delta.y)) throw Error(`${code} · X·Y 이동량에 숫자를 입력하세요.`);
   } else if (values.how === 'points') {
    const a = await ctx.pickPoint(`${code} · 기준점을 지정하세요 · Esc 취소`);
    if (!a) return;
    // 미리보기는 커서가 움직일 때마다 불리므로 대상 목록은 한 번만 고른다(통째 이동은 500개까지만 그린다).
    const previewIds = new Set(current.moveIds.slice(0, 500)), movedSources = ctx.entities().filter(e => previewIds.has(e.id));
    const targetIds = new Set(current.targets.map(t => t.id)), stretchSources = ctx.entities().filter(e => targetIds.has(e.id));
    const b = await ctx.pickPoint({prompt: `${code} · 두 번째 점을 지정하세요 · Esc 취소`, preview: (pts, cursor) => {
     if (!cursor) return [];
     const d = {x: cursor.x - a.x, y: cursor.y - a.y};
     return [...movedSources.map(e => G.translate(e, d.x, d.y)), ...stretchedEntities(stretchSources, current, d)].map(e => ({...e, previewColor: '#5fd35f'}));
    }});
    if (!b) return;
    delta = {x: b.x - a.x, y: b.y - a.y};
   } else {
    const dst = await pickSheet(`${code} · 대상 도곽 안을 한 번 클릭하세요 · 원본 ${frameLabel(src)} · Esc 취소`);
    if (!dst) return;
    if (sameFrame(src, dst)) throw Error(`${code} · 원본과 대상이 같은 도곽입니다. 다른 도곽 안을 클릭하세요.`);
    delta = {x: dst.bounds.minX - src.bounds.minX, y: dst.bounds.minY - src.bounds.minY};
    if (src.denominator && dst.denominator && src.denominator !== dst.denominator) note = ' · 축척이 달라도 늘리기는 평행 이동량만 씁니다(축척 보정 없음)';
   }
   const commands = stretchCommands(ctx.entities(), current, delta);
   ctx.execute({type: 'batch', commands});
   finish([...current.moveIds, ...current.targets.map(t => t.id)]);
   ctx.toast(`${code} · 통째 이동 ${current.moveIds.length}개 · 꼭짓점 늘리기 ${current.targets.length}개 · 이동량 X ${fmt(delta.x)}, Y ${fmt(delta.y)}${note}${excludedNote(current)} · Ctrl+Z 로 되돌리기`);
  });
 }

 /* EEV — 도곽 영역 지우기(도곽·표제란 제외, 개수 확인) */
 async function erase() {
  const {code} = OPS.erase;
  const frame = await pickSheet(`${code} · 비울 도곽 안을 한 번 클릭하세요 · Esc 취소`);
  if (!frame) return;
  const kept = content(frame, {keepFrame: true}), loose = content(frame, {keepFrame: false});
  if (!kept.items.length && !loose.items.length) throw Error(`${code} · ${frameLabel(frame)} 안에 지울 객체가 없습니다${excludedNote(kept)}.`);
  return ctx.form(`도곽 영역 지우기 (${code}) · ${frameLabel(frame)} · 지울 객체 ${kept.items.length}개 · 남기는 도곽·표제란 ${kept.frame.length}개${excludedNote(kept)}`, [
   {name: 'keepFrame', label: `도곽·표제란(도곽·TITLE·TTLB 이름의 레이어·블록)은 남김 · 끄면 ${loose.items.length}개를 지웁니다`, type: 'checkbox', value: true},
   {name: 'confirm', label: `도곽 안 객체 ${kept.items.length}개를 지웁니다(Ctrl+Z 로 되돌릴 수 있음). 확인`, type: 'checkbox', value: false},
  ], (values) => {
   if (!isChecked(values.confirm)) throw Error(`${code} · 확인 칸을 체크해야 지웁니다.`);
   const c = content(frame, {keepFrame: isChecked(values.keepFrame)});
   if (!c.items.length) return ctx.toast(`${code} · 지울 객체가 없습니다.`);
   ctx.execute({type: 'batch', commands: [{type: 'delete', ids: c.items.map(e => e.id)}]});
   finish([]);
   ctx.toast(`${code} · ${frameLabel(frame)} 안 객체 ${c.items.length}개를 지웠습니다(도곽·표제란 ${c.frame.length}개 남김)${excludedNote(c)} · Ctrl+Z 로 되돌리기`);
  });
 }

 const run = (op, preselected) => (op === 'copy' || op === 'move' ? copyMove(op, preselected) : op === 'stretch' ? stretch() : erase());
 return {
  SHEETEDIT() {
   const preselected = captureSelection();
   return ctx.form('도곽편집 · 도곽 안을 한 번 클릭해 복사·이동·늘리기·지우기', [
    {name: 'op', label: '작업', value: 'copy', options: Object.entries(OPS).map(([key, op]) => [key, `${op.letter} · ${op.verb} (${op.code})`])},
   ], (values) => run(normalizeSheetEditOp(values.op), preselected));
  },
  CCV() { return copyMove('copy', captureSelection()); },
  MMV() { return copyMove('move', captureSelection()); },
  SSV() { return stretch(); },
  EEV() { return erase(); },
 };
}
