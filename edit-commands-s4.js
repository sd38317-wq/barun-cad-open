/* ACAD200 영역 4(그리기·편집 명령) 화면 쪽 연결.
   · 순수 계산(시험 가능)과 카드 명령(installEditCommandsS4)을 한곳에 두고, app.js 에는 연결 몇 줄만 둔다.
   · AutoCAD 시스템 변수 이름 그대로 설정을 기억한다(MIRRTEXT·OFFSETGAPTYPE …). 명령창에 이름을 치면 바꿀 수 있고,
     기본값이 바뀐 것(빠른 TRIM·연관 배열·읽히는 대칭 문자)은 여기서 예전 동작으로 되돌릴 수 있다. */
import * as G from './geometry.js';
import * as CE from './curve-edit.js';
import {describeAssocArray, CENTER_DEFAULTS} from './assoc-edit.js';
export {islandFilter} from './assoc-edit.js';
import {autoConstrain} from './constraints.js';
import {planGeometryCleanup, geometryCleanupCommand} from './drawing-cleanup.js';
import {extendEndChanges, nearerEnd} from './multi-tools-4.js';
// app.js 가 이미 정적으로 불러오는 모듈: 동적 import 는 설치판에서 허용 목록 밖 조각(view-*.js)을 만든다.
import {drawEntity} from './view.js';

/* ══════════ 설정(시스템 변수) ══════════ */
export const EDIT_VARS = Object.freeze({
 MIRRTEXT: {label: '대칭 때 문자', def: 0, options: [[0, '0 · 읽히는 방향 유지(AutoCAD 기본)'], [1, '1 · 문자도 거울처럼 뒤집기(예전 바른 CAD)']]},
 OFFSETGAPTYPE: {label: '간격띄우기 바깥 모서리', def: 0, options: [[0, '0 · 선을 늘려 만나게(기본)'], [1, '1 · 둥글게(호)'], [2, '2 · 모따기']]},
 ARRAYASSOCIATIVITY: {label: '배열 결과', def: 1, options: [[1, '1 · 연관 배열 하나(간격·개수를 나중에 고침, AutoCAD 기본)'], [0, '0 · 낱개 사본(예전 바른 CAD)']]},
 HPASSOC: {label: '해치 연관', def: 1, options: [[1, '1 · 경계를 고치면 해치도 따라감(객체 선택으로 만든 해치)'], [0, '0 · 따라가지 않음']]},
 HPISLANDDETECTION: {label: '해치 섬 검출', def: 0, options: [[0, '0 · 일반(섬 안 섬은 다시 채움)'], [1, '1 · 바깥만(첫 섬까지만 비움)'], [2, '2 · 섬 무시(전부 채움)']]},
 WIPEOUTFRAME: {label: '가리기 테두리', def: 1, options: [[1, '1 · 보이고 출력'], [2, '2 · 화면에만 보임'], [0, '0 · 숨김']]},
 JOINFUZZ: {label: 'JOIN 허용 거리(mm)', def: 0.001, number: true},
});
const STORE_KEY = 'barun-cad-edit-vars';
let store = null, memory = {};
export function useEditVarStore(storage) { store = storage || null; try { memory = JSON.parse(store?.getItem(STORE_KEY) || '{}') || {}; } catch { memory = {}; } }
export function editVar(name) { const spec = EDIT_VARS[name]; if (!spec) return undefined; const v = memory[name]; return v === undefined ? spec.def : v; }
export function setEditVar(name, value) {
 const spec = EDIT_VARS[name]; if (!spec) throw Error(`모르는 설정입니다: ${name}`);
 const v = Number(value);
 if (spec.number ? !(v >= 0 && Number.isFinite(v)) : !spec.options.some(([k]) => k === v)) throw Error(`${name} 값은 ${spec.number ? '0 이상 숫자' : spec.options.map(([k]) => k).join('·')} 중 하나입니다.`);
 memory = {...memory, [name]: v};
 try { store?.setItem(STORE_KEY, JSON.stringify(memory)); } catch { /* 저장 못 해도 이번 실행에는 쓴다 */ }
 return v;
}
export const islandModeOf = (v = editVar('HPISLANDDETECTION')) => ({0: 'normal', 1: 'outer', 2: 'ignore'})[v] || 'normal';

/* ══════════ 401 · 빠른 TRIM 경계 후보 ══════════ */
/** 대상 객체 상자(연장이면 화면까지 늘린 상자). 이 상자와 겹치는 객체만 경계 후보 — 도면 전체 id 를 넘기지 않는다. */
export function quickBoundaryBox(target, op, view) {
 const b = G.bounds([target]); if (!b) return null;
 if (op !== 'extend' || !view) return b;
 return {minX: Math.min(b.minX, view.minX), minY: Math.min(b.minY, view.minY), maxX: Math.max(b.maxX, view.maxX), maxY: Math.max(b.maxY, view.maxY)};
}
/** 색인 질의 결과에서 경계 id 만(대상 자신·꺼진 레이어 제외). */
export function quickBoundaryIds(candidates, target, hiddenLayers = new Set()) {
 const out = [];
 for (const e of candidates || []) if (e && e.id !== target.id && !hiddenLayers.has(e.layer) && !e.hidden) out.push(e.id);
 return out;
}

/* ══════════ 409 · 타원 호(A) · 스플라인 맞춤점 ══════════ */
/** 장축 기준 각도(도) → 타원 매개변수(라디안). AutoCAD 처럼 각도는 점의 방향 각이다. */
export const ellipseParamOfAngle = (e, deg) => { const th = deg * Math.PI / 180; return Math.atan2(Math.sin(th) / e.ratio, Math.cos(th)); };
/** 점이 장축에서 몇 도인지(타원 중심 기준). */
export function ellipseAngleOfPoint(e, p) { const v = G.sub(p, e.center); return G.normalizeAngle(G.angle(v) - G.angle(e.majorAxis)); }
export function ellipseArc(e, startDeg, endDeg) {
 if (![startDeg, endDeg].every(Number.isFinite)) throw Error('각도는 숫자로 입력하세요.');
 const s = ellipseParamOfAngle(e, startDeg); let t = ellipseParamOfAngle(e, endDeg);
 while (t <= s + 1e-12) t += Math.PI * 2;
 return {...e, startParam: s, endParam: t};
}
/** SPLINE 결과: 맞춤점을 남긴 폴리선(맞춤점 그립으로 고침, DXF 로는 진짜 SPLINE). */
export function splineEntity(fitPoints, closed = false, degree = 3) {
 const fit = fitPoints.map((p) => ({x: p.x, y: p.y}));
 if (fit.length < 2) throw Error('맞춤점이 두 개 이상 필요합니다.');
 return {type: 'polyline', closed, points: G.splineFitPoints(fit, closed), spline: {degree, method: 'fit', fitPoints: fit, closed}};
}

/* ══════════ 410 · REVCLOUD 호 구간(bulge) ══════════ */
const CLOUD_SWEEP = 110; // 한 호의 중심각(도)
/** 기본 호 길이: 도면 크기의 1/40(작은 도면 10~큰 도면 수천 mm). 지정하지 않아도 알맞은 크기. */
export function defaultCloudArc(bounds) {
 if (!bounds) return 500;
 const span = Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY);
 if (!(span > 0)) return 500;
 const raw = span / 40, step = 10 ** Math.floor(Math.log10(raw));
 return Math.max(1, Math.round(raw / step) * step);
}
/** 닫힌 고리 → 바깥으로 볼록한 호(현마다 bulge 하나)로 된 구름 폴리선. revcloud 표시로 호 길이를 남긴다. */
export function cloudFromRing(ring, arc, {style = 'normal'} = {}) {
 if (!(arc > 0)) throw Error('호 길이는 0보다 커야 합니다.');
 const pts = G.polygonArea(ring) < 0 ? ring.slice().reverse() : ring.slice(), verts = [];
 const k = CE.bulgeOf(CLOUD_SWEEP); // 반시계 고리: 양(+)의 bulge 호는 진행 방향 오른쪽 = 바깥으로 볼록
 for (let i = 0; i < pts.length; i++) {
  const a = pts[i], b = pts[(i + 1) % pts.length], len = G.dist(a, b); if (len <= G.EPS) continue;
  const n = Math.max(1, Math.round(len / arc));
  for (let j = 0; j < n; j++) verts.push({...G.add(a, G.mul(G.sub(b, a), j / n)), bulge: style === 'calligraphy' && j % 2 ? k * 0.6 : k});
 }
 if (verts.length < 2) throw Error('구름을 만들 경계가 너무 작습니다.');
 return {type: 'polyline', closed: true, ...CE.fromBulgeVertices(verts, true), revcloud: {arc, style}};
}
/** 프리핸드(F): 커서가 마지막 점에서 호 길이만큼 멀어질 때마다 점을 더하고, 첫 점 가까이 오면 닫는다. */
export function freehandStep(points, p, arc) {
 const last = points.at(-1);
 if (!last) return {points: [p], closed: false};
 if (G.dist(last, p) < arc) return {points, closed: false};
 const next = [...points, p];
 return {points: next, closed: next.length > 3 && G.dist(next[0], p) < arc};
}

/* ══════════ 411 · WIPEOUT ══════════ */
/** 가리기 = 배경색으로 칠한 닫힌 영역(해치 한 종류로 저장 → 화면·선택·저장 경로를 그대로 씀). frame: 0 숨김 · 1 보이고 출력 · 2 화면만. */
export function wipeoutEntity(points, layer, frame = editVar('WIPEOUTFRAME')) {
 const ring = points.map((p) => ({x: p.x, y: p.y}));
 if (ring.length > 1 && G.dist(ring[0], ring.at(-1)) <= G.EPS) ring.pop();
 if (ring.length < 3 || Math.abs(G.polygonArea(ring)) <= G.EPS) throw Error('면적이 있는 세 점 이상의 경계가 필요합니다.');
 return {type: 'hatch', solid: true, wipeout: true, frame: Number(frame) || 0, points: ring, spacing: 100, angle: 0, ...(layer ? {layer} : {})};
}

/* ══════════ 412 · BOUNDARY/HATCH 경계 집합을 선분으로 ══════════ */
/** 서버에 도면(DXF) 대신 보낼 꺾은선 목록. 곡선은 0.5mm 처짐으로 편다(서버 ezdxf flattening(.5) 와 같은 기준). */
export function boundaryPaths(entities, {hiddenLayers = new Set(), limit = 400000} = {}) {
 const out = []; let count = 0;
 const flat = (e) => {
  if (!e || e.hidden || hiddenLayers.has(e.layer)) return;
  if (['text', 'mtext', 'point', 'hatch', 'dimension'].includes(e.type)) return;
  if (e.type === 'block' || e.type === 'wall') { for (const p of G.visiblePrimitives(e)) flat(p); return; }
  let pts = null;
  if (e.type === 'circle' || e.type === 'arc') {
   const sweep = e.type === 'circle' ? 360 : (G.normalizeAngle(e.endAngle - e.startAngle) || 360), r = e.radius;
   const step = 2 * Math.acos(Math.max(-1, Math.min(1, 1 - 0.5 / Math.max(r, 0.5)))) * 180 / Math.PI, n = Math.min(4096, Math.max(8, Math.ceil(sweep / Math.max(step, 1e-3))));
   const start = e.type === 'circle' ? 0 : e.startAngle;
   pts = Array.from({length: n + 1}, (_, i) => G.add(e.center, G.polar(r, start + sweep * i / n)));
  } else if (e.type === 'ellipse') pts = G.ellipsePoints(e, 256);
  else if (Array.isArray(e.points) && e.points.length >= 2) { pts = e.points.slice(); if (e.closed || e.type === 'rectangle') pts.push(pts[0]); }
  if (!pts) return;
  count += pts.length; if (count > limit) throw Error('경계 후보가 너무 많습니다. 화면을 확대하고 다시 클릭하세요.');
  out.push(pts.map((p) => [p.x, p.y]));
 };
 for (const e of entities || []) flat(e);
 return out;
}
/** 찾은 경계가 질의 상자 안에 다 들어오면 믿고, 걸치면 화면을 넓혀 다시 찾는다(밖의 선이 더 작게 나눌 수 있으므로). */
export function boundaryInside(boundary, box) {
 const b = G.bounds([{points: boundary.points}]);
 return !!b && b.minX >= box.minX && b.maxX <= box.maxX && b.minY >= box.minY && b.maxY <= box.maxY;
}
export const growBox = (box, k) => { const w = (box.maxX - box.minX) * (k - 1) / 2, h = (box.maxY - box.minY) * (k - 1) / 2; return {minX: box.minX - w, minY: box.minY - h, maxX: box.maxX + w, maxY: box.maxY + h}; };

/* ══════════ 418 · DIVIDE/MEASURE 계획 ══════════ */
/** 점(또는 블록) 자리와 그 점의 진행 방향. 타원·호 폴리선도 따라 걷는다. */
export function divideMeasurePlan(target, mode, value) {
 const path = CE.walkPoints(target), total = path.slice(1).reduce((s, p, i) => s + G.dist(path[i], p), 0), n = Number(String(value).replace(/,/g, ''));
 let distances;
 if (mode === 'DIVIDE') { if (!Number.isInteger(n) || n < 2 || n > 32767) throw Error('등분 수는 2~32767 정수입니다.'); distances = Array.from({length: n - 1}, (_, i) => total * (i + 1) / n); }
 else { if (!(n > 0)) throw Error('길이는 0보다 커야 합니다.'); const count = Math.floor(total / n + 1e-9); if (count > 32767) throw Error('점이 너무 많습니다.'); distances = Array.from({length: count}, (_, i) => n * (i + 1)).filter((d) => d < total - 1e-9); }
 const found = CE.pointsAlongWithAngle(path, distances);
 if (!found.length) throw Error('찍을 점이 없습니다(길이가 객체보다 깁니다).');
 return found;
}
/** B 옵션: 각 자리에 블록 삽입(정렬이면 진행 방향으로 돌림). 엔진 명령 batch 하나 = 되돌리기 한 번. */
export function divideBlockCommand(plan, name, align, layer) {
 return {type: 'batch', commands: plan.map(({point, angle}) => ({type: 'block.insert', name, position: point, angle: align ? angle : 0, factor: 1, layer}))};
}

/* ══════════ 421 · MATCHPROP 설정(S) ══════════ */
export const MATCH_FLAGS = Object.freeze({
 color: {label: '색', keys: ['color', 'aci', 'colorMode']}, layer: {label: '레이어', keys: ['layer']}, linetype: {label: '선종류', keys: ['linetype']},
 ltscale: {label: '선종류 축척', keys: ['linetypeScale']}, lineweight: {label: '선 굵기', keys: ['lineweight']}, transparency: {label: '투명도', keys: ['transparency']},
 text: {label: '문자', keys: ['height', 'style', 'fontFamily', 'widthFactor', 'oblique'], typed: ['text', 'mtext']},
 dimension: {label: '치수', keys: ['textHeight', 'arrowSize', 'arrowType', 'extOffset', 'extExtend', 'textGap', 'dimScale', 'precision', 'style'], typed: ['dimension']},
 hatch: {label: '해치', keys: ['pattern', 'patternScale', 'patternAngle', 'scale', 'angle', 'solid', 'patternName', 'patternLines'], typed: ['hatch']},
 polyline: {label: '폴리선 폭', keys: ['constantWidth'], typed: ['polyline', 'rectangle']},
});
export const ALL_MATCH_FLAGS = Object.keys(MATCH_FLAGS);
/** 켜진 항목만 옮긴다. 문자는 한 줄·여러 줄 문자끼리도 옮긴다(AutoCAD 와 같음). 원본에 없는 값은 지운다(ByLayer 로). */
export function matchChangesFor(src, target, flags = ALL_MATCH_FLAGS) {
 const changes = {}, on = new Set(flags);
 for (const flag of ALL_MATCH_FLAGS) {
  if (!on.has(flag)) continue;
  const spec = MATCH_FLAGS[flag];
  if (spec.typed) { if (!spec.typed.includes(src.type) || !spec.typed.includes(target.type)) continue; for (const k of spec.keys) if (src[k] !== undefined) changes[k] = structuredClone(src[k]); continue; }
  for (const k of spec.keys) changes[k] = src[k] ?? null;
 }
 if (on.has('layer')) changes.layer = src.layer;
 return changes;
}
export const matchSettingsLine = (flags = ALL_MATCH_FLAGS) => '현재 설정: ' + ALL_MATCH_FLAGS.filter((f) => flags.includes(f)).map((f) => MATCH_FLAGS[f].label).join(' ');

/* ══════════ 422 · 운영체제 클립보드 ══════════ */
export const CAD_MIME = 'web application/x-barun-cad+json';
/** 쓰는 레이어만 같이 담는다(예전에는 도면의 레이어 전체를 복사). */
export function usedLayers(entities, layers) {
 const used = new Set(), visit = (e) => { if (e?.layer) used.add(e.layer); for (const c of e?.entities || []) visit(c); };
 for (const e of entities) visit(e);
 return layers.filter((l) => used.has(l.id)).map((l) => structuredClone(l));
}
/** 문서·메신저에 붙일 글: 객체 종류별 개수와 범위. */
export function clipboardText(payload) {
 const counts = new Map(); for (const e of payload.entities) counts.set(e.type, (counts.get(e.type) || 0) + 1);
 const b = G.bounds(payload.entities), f = (v) => Number(v.toFixed(3));
 return `바른 CAD 객체 ${payload.entities.length}개 (${[...counts].map(([t, n]) => `${t} ${n}`).join(', ')})` + (b ? `\n범위 ${f(b.minX)},${f(b.minY)} ~ ${f(b.maxX)},${f(b.maxY)} mm` : '');
}
/** OS 클립보드에 바른 CAD 형식 + 글(+그림)로 쓴다. 안 되면 false(호출 쪽은 예전 앱 안 클립보드를 그대로 쓴다). */
export async function writeSystemClipboard(payload, {png = null} = {}) {
 const nav = globalThis.navigator, Item = globalThis.ClipboardItem;
 if (!nav?.clipboard?.write || !Item) return false;
 const json = JSON.stringify({version: 1, ...payload});
 const parts = {[CAD_MIME]: new Blob([json], {type: CAD_MIME}), 'text/plain': new Blob([clipboardText(payload)], {type: 'text/plain'})};
 if (png) parts['image/png'] = png;
 try { await nav.clipboard.write([new Item(parts)]); return true; }
 catch { try { await nav.clipboard.write([new Item({[CAD_MIME]: parts[CAD_MIME], 'text/plain': parts['text/plain']})]); return true; } catch { return false; } }
}
/** 문서 붙여넣기용 그림: 흰 바탕에 검은 선(출력과 같은 느낌). 화면이 없는 곳(시험·작업자)에서는 null. 큰 선택은 그리지 않는다. */
export async function selectionPng(entities, {size = 1200, limit = 20000} = {}) {
 const doc = globalThis.document; if (!doc?.createElement || !entities?.length || entities.length > limit) return null;
 const b = G.bounds(entities); if (!b) return null;
 const w = Math.max(b.maxX - b.minX, 1e-6), h = Math.max(b.maxY - b.minY, 1e-6), k = (size - 40) / Math.max(w, h);
 const canvas = doc.createElement('canvas'); canvas.width = Math.ceil(w * k) + 40; canvas.height = Math.ceil(h * k) + 40;
 const ctx = canvas.getContext?.('2d'); if (!ctx) return null;
 ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
 const screen = (p) => ({x: 20 + (p.x - b.minX) * k, y: canvas.height - 20 - (p.y - b.minY) * k});
 for (const e of entities) { try { drawEntity(ctx, e, screen, k, '#000000', 1.2, false, true); } catch { /* 그릴 수 없는 객체는 건너뜀 */ } }
 return new Promise((resolve) => canvas.toBlob ? canvas.toBlob((blob) => resolve(blob), 'image/png') : resolve(null));
}
/** OS 클립보드에서 무엇을 붙일 수 있는지와 그 내용. */
export async function readSystemClipboard() {
 const nav = globalThis.navigator; const out = {cad: null, text: '', image: null};
 if (!nav?.clipboard?.read) { try { out.text = await nav?.clipboard?.readText?.() || ''; } catch { /* 권한 없음 */ } return out; }
 let items = []; try { items = await nav.clipboard.read({unsanitized: [CAD_MIME]}); } catch { try { items = await nav.clipboard.read(); } catch { items = []; } }
 for (const item of items) {
  if (item.types.includes(CAD_MIME)) { try { const parsed = JSON.parse(await (await item.getType(CAD_MIME)).text()); if (Array.isArray(parsed?.entities) && parsed.base) out.cad = parsed; } catch { /* 깨진 자료는 무시 */ } }
  if (item.types.includes('text/plain')) { try { out.text = await (await item.getType('text/plain')).text(); } catch { /* 무시 */ } }
  if (item.types.includes('image/png')) { try { out.image = await item.getType('image/png'); } catch { /* 무시 */ } }
 }
 return out;
}
export function pasteSpecialChoices(clip) {
 return [clip.cad && ['cad', '바른 CAD 객체(레이어·색 그대로)'], clip.cad && ['block', '블록 하나로'], clip.text && ['text', '문자로'], clip.image && ['image', '그림(아직 도면에 넣을 수 없음 · 안내만)']].filter(Boolean);
}

/* ══════════ 425 · FLATTEN 보고 ══════════ */
/** 열기 보고서(변환 기록)에서 높이를 눌러 없앤 객체 수. */
export function flattenSummary(report) {
 const converted = report?.converted || report || {};
 const rows = Object.entries(converted).filter(([k, n]) => /높이|XY 평면|XY 투영|3D/.test(k) && Number(n) > 0);
 return {total: rows.reduce((s, [, n]) => s + Number(n), 0), rows};
}
export function flattenMessage(report) {
 const {total, rows} = flattenSummary(report);
 return total
  ? `FLATTEN: 열 때 이미 ${total.toLocaleString('ko-KR')}개 객체의 높이를 XY 평면으로 눌렀습니다(${rows.map(([k, n]) => `${k} ${n}`).join(' · ')}). 바른 CAD 도면은 2D 라 더 할 일이 없습니다.`
  : 'FLATTEN: 바른 CAD 도면은 2D 라 누를 높이가 없습니다. 이 도면은 열 때 높이가 있던 객체도 없었습니다.';
}

/* ══════════ 카드 명령 ══════════ */
const appHooks = {importReport: null, setClipboard: null};
/** app.js 가 한 번 부른다: 열기 보고서·앱 안 클립보드 연결. */
export function connectEditHooks(hooks) { Object.assign(appHooks, hooks || {}); }
export function rememberImportReport(report) { appHooks.importReport = report || null; }

export function installEditCommandsS4(ctx) {
 useEditVarStore(ctx.storage);
 const ask = (title, fields) => new Promise((resolve) => ctx.form(title, fields, (v) => resolve(v), () => resolve(null)));
 const unlockedSel = () => { const locked = new Set(ctx.layers().filter((l) => l.locked).map((l) => l.id)); return ctx.selected().filter((e) => !locked.has(e.layer)); };
 const varCard = (name) => async () => {
  const spec = EDIT_VARS[name];
  const v = await ask(`${name} · ${spec.label}`, spec.number ? [{name: 'value', label: `${spec.label} (현재 ${editVar(name)})`, type: 'number', value: editVar(name)}] : [{name: 'value', label: `${spec.label} (현재 ${editVar(name)})`, options: spec.options.map(([k, t]) => [String(k), t]), value: String(editVar(name))}]);
  if (!v) return;
  ctx.toast(`${name} = ${setEditVar(name, v.value)}`);
 };
 const commands = {};
 for (const name of Object.keys(EDIT_VARS)) commands[name] = varCard(name);

 /* 415 · LENGTHEN: 모드(DE·P·T·DY)를 고른 뒤 찍을 때마다 찍은 쪽 끝을 바꾼다. Enter 로 끝. */
 commands.LENGTHEN = async () => {
  let mode = 'DE', value = 0, done = 0;
  const label = () => mode === 'DE' ? `증분 ${value}` : mode === 'P' ? `퍼센트 ${value}%` : mode === 'T' ? `전체 ${value}` : '동적';
  for (;;) {
   const r = await ctx.pickEntity({prompt: `길이를 바꿀 객체를 바꿀 쪽 끝 가까이 클릭 · [증분(DE)/퍼센트(P)/전체(T)/동적(DY)] · 지금 ${label()} · Enter 끝`, withPoint: true, allowNone: 'DONE', options: ['DE', 'DELTA', 'P', 'PERCENT', 'T', 'TOTAL', 'DY', 'DYNAMIC']});
   if (!r || r.option === 'DONE') break;
   if (r.option) {
    mode = {DE: 'DE', DELTA: 'DE', P: 'P', PERCENT: 'P', T: 'T', TOTAL: 'T', DY: 'DY', DYNAMIC: 'DY'}[r.option];
    if (mode !== 'DY') { const v = await ask('LENGTHEN · ' + {DE: '증분 길이(음수면 줄임)', P: '퍼센트(100 = 그대로)', T: '전체 길이'}[mode], [{name: 'value', label: {DE: '증분', P: '퍼센트', T: '전체 길이'}[mode], type: 'number', value: mode === 'P' ? 100 : 0}]); if (!v) continue; value = Number(v.value); }
    continue;
   }
   const e = r.entity, p = r.point;
   if (!['line', 'arc', 'polyline'].includes(e.type)) { ctx.toast('선·호·열린 폴리선을 고르세요.', true); continue; }
   const end = nearerEnd(e, p), L = CE.pathLength(e);
   let dyn = 0;
   if (mode === 'DY') { const q = await ctx.pickPoint({prompt: '새 끝점 위치를 찍으세요(끝 방향으로 투영)'}); if (!q) continue; const t = CE.endTangent(e, end); dyn = G.dot(G.sub(q, t.point), t.dir); }
   const delta = CE.lengthenDelta(mode, value, L, dyn);
   if (L + delta <= G.EPS) { ctx.toast('길이가 0 이하가 됩니다.', true); continue; }
   if (Math.abs(delta) < G.EPS) continue;
   ctx.execute({type: 'update', ids: [e.id], changes: extendEndChanges(e, end, delta)});
   done++;
  }
  if (done) ctx.toast(`LENGTHEN · ${done}번 바꿨습니다. Ctrl+Z 한 번으로 모두 되돌립니다.`);
 };

 /* 411 · WIPEOUT: 점을 찍거나 닫힌 폴리선(P)에서. 테두리(F)는 도면의 모든 가리기에 적용. */
 commands.WIPEOUT = async () => {
  const r = await ctx.pickPath({prompt: '가릴 영역의 점을 차례로 찍으세요 · Enter 로 닫기 · [폴리선(P)/테두리(F)]', options: ['P', 'POLYLINE', 'F', 'FRAMES'], minPoints: 3});
  if (!r) return;
  if (r.option === 'F' || r.option === 'FRAMES') {
   const v = await ask('WIPEOUT · 테두리', [{name: 'value', label: '가리기 테두리', options: EDIT_VARS.WIPEOUTFRAME.options.map(([k, t]) => [String(k), t]), value: String(editVar('WIPEOUTFRAME'))}]);
   if (!v) return;
   const frame = setEditVar('WIPEOUTFRAME', v.value), all = ctx.entities().filter((e) => e.wipeout && e.frame !== frame);
   if (all.length) ctx.execute({type: 'updateMany', updates: all.map((e) => ({id: e.id, changes: {frame}}))});
   ctx.toast(`가리기 테두리: ${EDIT_VARS.WIPEOUTFRAME.options.find(([k]) => k === frame)[1]} · ${all.length}개 바꿈`);
   return;
  }
  if (r.option) {
   const e = await ctx.pickEntity({prompt: '닫힌 폴리선·사각형을 고르세요 · Esc 취소', types: ['polyline', 'rectangle']});
   if (!e) return;
   if (!(e.type === 'rectangle' || e.closed)) throw Error('닫힌 폴리선을 고르세요.');
   const v = await ask('WIPEOUT · 원래 폴리선', [{name: 'erase', label: '원래 폴리선 지우기', type: 'checkbox', value: false}]);
   if (!v) return;
   const ids = ctx.execute({type: 'add', entity: wipeoutEntity(e.points, e.layer)});
   if (v.erase === true || v.erase === 'true' || v.erase === 'on') ctx.execute({type: 'delete', ids: [e.id]});
   ctx.setSelected(ids); ctx.toast('가리기를 만들었습니다. 뒤에 있는 객체가 가려집니다(그리기 순서 = DRAWORDER).');
   return;
  }
  const ids = ctx.execute({type: 'add', entity: wipeoutEntity(r.points, ctx.activeLayer())});
  ctx.setSelected(ids); ctx.toast('가리기를 만들었습니다. 테두리는 WIPEOUT → F 로 끄고 켭니다.');
 };

 /* 423 · CENTERMARK·CENTERLINE: 원본과 연결(원본을 옮기면 따라옴, 지우면 마지막 모양으로 남음). */
 commands.CENTERMARK = async () => {
  let n = 0;
  for (;;) {
   const e = await ctx.pickEntity({prompt: `중심 표시를 넣을 원·호를 고르세요 · Enter 끝${n ? ` · ${n}개 넣음` : ''}`, types: ['circle', 'arc'], allowNone: 'DONE'});
   if (!e || e.option === 'DONE') break;
   ctx.execute({type: 'center.add', kind: 'mark', refs: [e.id], layer: ctx.activeLayer(), options: {size: CENTER_DEFAULTS.size, gap: CENTER_DEFAULTS.gap, ext: CENTER_DEFAULTS.markExt}});
   n++;
  }
 };
 commands.CENTERLINE = async () => {
  const a = await ctx.pickEntity({prompt: '첫 번째 선을 고르세요', types: ['line', 'polyline']});
  if (!a) return;
  const b = await ctx.pickEntity({prompt: '두 번째 선을 고르세요', types: ['line', 'polyline']});
  if (!b) return;
  if (a.id === b.id) throw Error('서로 다른 두 선을 고르세요.');
  const ids = ctx.execute({type: 'center.add', kind: 'line', refs: [a.id, b.id], layer: ctx.activeLayer(), options: {ext: CENTER_DEFAULTS.lineExt}});
  ctx.setSelected(ids); ctx.toast('중심선을 넣었습니다. 두 선을 옮기면 중심선이 따라갑니다.');
 };

 /* 405 · ARRAYEDIT: 연관 배열의 간격·개수만 고친다(사본을 지우고 다시 만들지 않음). */
 commands.ARRAYEDIT = async () => {
  let e = ctx.selected().find((x) => x.assocArray);
  if (!e) { e = await ctx.pickEntity({prompt: '고칠 연관 배열을 고르세요', types: ['block']}); if (!e) return; }
  if (!e.assocArray) throw Error('연관 배열이 아닙니다(ARRAYASSOCIATIVITY=1 로 만든 배열만 고칠 수 있습니다).');
  const {kind, params: p} = e.assocArray;
  const fields = kind === 'rect'
   ? [{name: 'rows', label: '행 수', type: 'number', value: p.rows}, {name: 'columns', label: '열 수', type: 'number', value: p.columns}, {name: 'dx', label: '열 간격', type: 'number', value: +G.len(p.u).toFixed(6)}, {name: 'dy', label: '행 간격', type: 'number', value: +G.len(p.v).toFixed(6)}]
   : kind === 'polar' ? [{name: 'count', label: '개수', type: 'number', value: p.count}, {name: 'fill', label: '채울 각도(도)', type: 'number', value: p.fill}, {name: 'rotateItems', label: '사본도 돌리기', type: 'checkbox', value: p.rotateItems !== false}]
    : [{name: 'count', label: '개수', type: 'number', value: p.count}, {name: 'align', label: '경로 방향으로 돌리기', type: 'checkbox', value: p.align !== false}];
  const v = await ask(`ARRAYEDIT · ${describeAssocArray(e)}`, fields);
  if (!v) return;
  const on = (x) => x === true || x === 'true' || x === 'on';
  const scaleVec = (vec, length) => { const L = G.len(vec); return L > G.EPS ? G.mul(vec, length / L) : {x: length, y: 0}; };
  const params = kind === 'rect' ? {rows: Number(v.rows), columns: Number(v.columns), u: scaleVec(p.u, Number(v.dx)), v: G.len(p.v) > G.EPS ? scaleVec(p.v, Number(v.dy)) : {x: 0, y: Number(v.dy)}}
   : kind === 'polar' ? {count: Number(v.count), fill: Number(v.fill), rotateItems: on(v.rotateItems)} : {count: Number(v.count), align: on(v.align)};
  ctx.execute({type: 'array.edit', id: e.id, params});
  ctx.toast('연관 배열을 고쳤습니다. EXPLODE 하면 낱개 객체가 됩니다.');
 };

 /* 420 · AUTOCONSTRAIN·DELCONSTRAINT */
 commands.AUTOCONSTRAIN = async () => {
  const targets = unlockedSel().filter((e) => e.type === 'line' || e.type === 'polyline');
  if (!targets.length) throw Error('AUTOCONSTRAIN: 구속할 선·폴리선을 먼저 선택하세요.');
  const v = await ask('AUTOCONSTRAIN · 자동 구속', [{name: 'tol', label: '끝점 일치 공차(mm)', type: 'number', value: 1}, {name: 'angTol', label: '수평·수직 각도 공차(도)', type: 'number', value: 1}]);
  if (!v) return;
  const {constraints} = autoConstrain(targets, {tol: Number(v.tol), angTol: Number(v.angTol), existing: ctx.doc?.().constraints || []});
  if (!constraints.length) { ctx.toast('새로 걸 구속이 없습니다.'); return; }
  ctx.execute({type: 'constraints.set', constraints, solve: true, solveIds: targets.map((e) => e.id)});
  const count = (k) => constraints.filter((c) => c.kind === k).length;
  ctx.toast(`구속 ${constraints.length}개 · 일치 ${count('coincident')} · 수평 ${count('horizontal')} · 수직 ${count('vertical')}. 이제 한 선을 고치면 이어진 선이 따라옵니다.`);
 };
 commands.DELCONSTRAINT = () => {
  const ids = new Set(ctx.selectedIds()), all = ctx.doc?.().constraints || [];
  const keep = ids.size ? all.filter((c) => !(c.kind === 'coincident' ? c.refs.some((r) => ids.has(r[0])) : c.ids.some((id) => ids.has(id)))) : [];
  ctx.execute({type: 'constraints.set', mode: 'replace', constraints: keep});
  ctx.toast(`구속 ${all.length - keep.length}개를 지웠습니다${ids.size ? '' : '(선택이 없어 전부)'}.`);
 };

 /* 424 · GEOMETRYCLEANUP: 틈·넘침·모자람·각도 오류를 찾아 보여 주고 고른 종류만 고친다. */
 commands.GEOMETRYCLEANUP = async () => {
  const sel = ctx.selectedIds();
  const v = await ask('GEOMETRYCLEANUP · 작도 오류 검사', [{name: 'gap', label: '끝점 틈 공차(mm)', type: 'number', value: 1}, {name: 'shoot', label: '넘침·모자람 공차(mm)', type: 'number', value: 5}, {name: 'angle', label: '수평·수직 각도 공차(도)', type: 'number', value: 0.5}]);
  if (!v) return;
  const locked = new Set(ctx.layers().filter((l) => l.locked || l.visible === false || l.frozen).map((l) => l.id));
  const doc = {entities: ctx.entities()}, plan = planGeometryCleanup(doc, {gap: Number(v.gap), shoot: Number(v.shoot), angle: Number(v.angle), ids: sel.length ? sel : null, lockedLayers: locked});
  if (!plan.total) { ctx.toast(`작도 오류가 없습니다(${sel.length ? '선택한 ' + sel.length + '개' : '도면 전체'} 선 검사).`); return; }
  const c = plan.counts;
  const pick = await ask(`GEOMETRYCLEANUP · ${plan.total}건 찾음`, [
   {name: 'gap', label: `끝점 틈 ${c.gap}건 → 가운데로 붙이기`, type: 'checkbox', value: c.gap > 0},
   {name: 'overshoot', label: `넘친 끝 ${c.overshoot}건 → 만나는 점까지 자르기`, type: 'checkbox', value: c.overshoot > 0},
   {name: 'undershoot', label: `모자란 끝 ${c.undershoot}건 → 만나는 점까지 늘리기`, type: 'checkbox', value: c.undershoot > 0},
   {name: 'angle', label: `조금 기운 선 ${c.angle}건 → 정확히 수평·수직으로`, type: 'checkbox', value: c.angle > 0},
   {name: 'selectOnly', label: '고치지 말고 문제 객체만 선택', type: 'checkbox', value: false},
  ]);
  if (!pick) return;
  const on = (x) => x === true || x === 'true' || x === 'on';
  if (on(pick.selectOnly)) { ctx.setSelected([...new Set(plan.issues.flatMap((x) => x.ids))]); ctx.toast(`문제 객체 ${plan.issues.length}건을 선택했습니다.`); return; }
  const kinds = ['gap', 'overshoot', 'undershoot', 'angle'].filter((k) => on(pick[k]));
  const command = geometryCleanupCommand(plan, doc, kinds);
  if (!command) { ctx.toast('고칠 항목을 고르지 않았습니다.'); return; }
  ctx.execute(command);
  ctx.toast(`작도 오류 ${command.updates.length}개 객체를 고쳤습니다. Ctrl+Z 한 번으로 되돌립니다.`);
 };

 /* 425 · FLATTEN */
 commands.FLATTEN = () => { ctx.log?.(flattenMessage(appHooks.importReport)); ctx.toast(flattenMessage(appHooks.importReport)); };

 /* 422 · PASTESPEC: OS 클립보드에 있는 것 중 고르기 */
 commands.PASTESPEC = async () => {
  const clip = await readSystemClipboard(), choices = pasteSpecialChoices(clip);
  if (!choices.length) throw Error('클립보드에 붙일 것이 없습니다. 다른 바른 CAD 창이나 문서에서 먼저 복사하세요.');
  const v = await ask('PASTESPEC · 선택하여 붙여넣기', [{name: 'as', label: '붙일 형식', options: choices, value: choices[0][0]}]);
  if (!v) return;
  if (v.as === 'cad' || v.as === 'block') { appHooks.setClipboard?.(clip.cad); ctx.run(v.as === 'block' ? 'PASTEBLOCK' : 'PASTECLIP'); return; }
  if (v.as === 'text') {
   const p = await ctx.pickPoint({prompt: '문자를 놓을 점을 찍으세요'}); if (!p) return;
   const text = clip.text.replace(/\r\n?/g, '\n').slice(0, 20000);
   ctx.setSelected(ctx.execute({type: 'add', entity: {type: 'text', position: p, text, height: ctx.getTextHeight?.() || 250, rotation: 0, layer: ctx.activeLayer()}}));
   return;
  }
  ctx.toast('그림 붙여넣기는 아직 도면 객체가 없습니다. 그림은 PDF 가져오기·이미지 참조로 넣어 주세요.', true);
 };
 return commands;
}
