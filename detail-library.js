// 표준 상세도 라이브러리(훈민캐드 대조 기반 H87 · 훈민 상세도, AutoCAD 상세 부품 라이브러리).
//  DETAIL  분류(벽체·지붕·기초·창호·방수) → 상세 → 치수(단열 두께·벽 두께 …) → 축척 → 삽입점(경계 상자 미리보기).
//          결과는 상세 하나당 블록 하나(한 덩어리로 움직임): 실제 크기(mm) 재료층 + 재료 해치(콘크리트 AR-CONC,
//          단열 INSUL·글라스울 지그재그, 흙 EARTH, 잡석 GRAVEL, 몰탈 AR-SAND, 벽돌 ANSI31, 방수층 채움) +
//          층 두께 연속치수와 전체 치수 + 재료 표기 지시선(위→아래 또는 외부→내부 순서, 예: THK10 타일) +
//          제목 "(벽체) RC 200 외단열" + "SCALE 1:20"(TITLE 과 같은 제목 블록 모양).
//  기하는 실제 크기, 문자·치수·지시선은 "용지 mm × 상세 축척(기본 1:20)".
// 기존 부분 상세(PZ 부분 확대 · DOD 문 · WID 창 · STSD 계단 단면 · SBD 보·슬래브 · DECK 데크 · JAD/GRD/COND 재료 표현)는
// 평면 창호·계단·구조 단면용이라 겹치지 않는다. 여기서는 "재료층 단면 상세"만 만든다.
import * as G from './geometry.js';
import {hatchPatternFields} from './hatch-patterns.js';
import {titleBlock, estimateTextWidth, cursorPreview} from './title-tools.js';

export const DETAIL_CATEGORIES = Object.freeze([['wall', '벽체'], ['roof', '지붕'], ['foundation', '기초'], ['opening', '창호'], ['waterproof', '방수']]);
/** 주석 크기(용지 mm). 도면 크기 = 값 × 상세 축척. */
export const DETAIL_PAPER = Object.freeze({text: 2.5, label: 3, dimText: 2.5, dimArrow: 2.5, dimOffset: 10, dimRow: 7, noteLift: 8, noteLine: 4.5, dot: 1.2, titleGap: 12, fanGap: 12});
export const DETAIL_LAYER_NAMES = Object.freeze({outline: ['A-DETL', '#ffffff'], hatch: ['A-DETL-PATT', '#808080'], dims: ['A-DIM', '#ffffff'], text: ['A-TEXT', '#ffffff'], title: ['A-SYM', '#ffffff']});
export const DETAIL_SCALE_LIMITS = Object.freeze({min: 1, max: 200});

/** 재료 → 해치 무늬. k × 상세 축척 = 무늬 축척(용지에서 비슷한 촘촘함이 되도록). */
export const DETAIL_MATERIALS = Object.freeze({
 concrete: {label: '콘크리트', pattern: 'AR-CONC', k: 0.04},
 lean: {label: '버림 콘크리트', pattern: 'AR-CONC', k: 0.025},
 mortar: {label: '몰탈', pattern: 'AR-SAND', k: 0.025},
 insulation: {label: '단열재(보드)', pattern: 'INSUL', k: 0.15},
 brick: {label: '벽돌', pattern: 'ANSI31', k: 0.4},
 stone: {label: '석재', pattern: 'ANSI31', k: 0.2},
 earth: {label: '흙', pattern: 'EARTH', k: 0.4},
 gravel: {label: '잡석', pattern: 'GRAVEL', k: 0.12},
 membrane: {label: '방수층', solid: true},
 metal: {label: '금속판', solid: true},
 board: {label: '판재'},
 air: {label: '공기층'},
 batt: {label: '글라스울', zigzag: true},
 stud: {label: '스터드+글라스울', zigzag: true, studs: true},
});

const fmt = (n) => String(Number(Number(n).toFixed(2)));
const thkNote = (l) => l.note ?? `THK${fmt(l.thk)} ${l.name}`;
const num = (name, label, value, min, max, unit = 'mm') => ({name, label: `${label} (${unit})`, type: 'number', value, min, max, unit});
const pick = (name, label, value, options) => ({name, label, value, options});
const extent = (value, min = 300) => num('extent', '표현 길이', value, min, 6000);
const MEMBRANE = {coat: '우레탄 도막방수', sheet: '개량 아스팔트 시트방수'};

/* ══════════════════════════ 작도 도우미 ══════════════════════════ */
/** 1차원 문자 겹침 풀기: 이상 위치 c·폭 w 목록(c 오름차순)을 순서를 지키며 겹치지 않게 벌린다(무리 지어 평균 위치 유지). */
export function spreadLabels(items, gap = 0) {
 const clusters = items.map((_, i) => ({members: [i]}));
 const layout = (cl) => {
  const offs = [0];
  for (let j = 1; j < cl.members.length; j++) offs.push(offs[j - 1] + (items[cl.members[j - 1]].w + items[cl.members[j]].w) / 2 + gap);
  cl.first = cl.members.reduce((s, m, j) => s + items[m].c - offs[j], 0) / cl.members.length;
  cl.offs = offs;
  cl.lo = cl.first - items[cl.members[0]].w / 2;
  cl.hi = cl.first + offs.at(-1) + items[cl.members.at(-1)].w / 2;
 };
 clusters.forEach(layout);
 for (let merged = true; merged;) {
  merged = false;
  for (let i = 0; i + 1 < clusters.length; i++) {
   if (clusters[i].hi + gap > clusters[i + 1].lo + 1e-9) {
    clusters[i].members.push(...clusters[i + 1].members);clusters.splice(i + 1, 1);layout(clusters[i]);merged = true;break;
   }
  }
 }
 const out = new Array(items.length);
 for (const cl of clusters) cl.members.forEach((m, j) => { out[m] = cl.first + cl.offs[j]; });
 return out;
}

function draft(s, L) {
 const P = (mm) => mm * s;
 const d = {s, L, P, entities: [], stack: [], extras: [], notes: [], total: 0};
 const copy = (p) => ({x: p.x, y: p.y});
 d.push = (e) => { d.entities.push(e); return e; };
 d.poly = (points, closed = true, layer = L.outline, extra = {}) => d.push({type: 'polyline', layer, points: points.map(copy), closed, ...extra});
 d.line = (a, b, layer = L.outline, extra = {}) => d.push({type: 'line', layer, points: [copy(a), copy(b)], ...extra});
 d.text = (position, text, {height = P(DETAIL_PAPER.text), align = 'left', role = 'note', rotation = 0, layer = L.text} = {}) =>
  d.push({type: 'text', layer, position: copy(position), text: String(text), height, align, rotation, detailRole: role});
 d.hatch = (points, mat, {angle = 0} = {}) => {
  const m = DETAIL_MATERIALS[mat];
  if (!m || (!m.pattern && !m.solid)) return null;
  const origin = copy(points[0]);
  const fields = m.solid ? hatchPatternFields('solid') : hatchPatternFields(m.pattern, {scale: m.k * s, angle, origin});
  return d.push({type: 'hatch', layer: L.hatch, points: points.map(copy), origin, ...fields, detailMaterial: mat});
 };
 d.dot = (c) => {
  const r = P(DETAIL_PAPER.dot) / 2, ring = Array.from({length: 12}, (_, i) => G.add(c, G.polar(r, i * 30)));
  return d.push({type: 'hatch', layer: L.text, points: ring, ...hatchPatternFields('solid'), detailRole: 'dot'});
 };
 /** 사각 재료층 하나: 외곽선 + 해치(또는 지그재그·스터드). vertical = 세로로 긴 띠(벽). */
 d.material = (x0, y0, x1, y1, mat, {vertical = false, outline = true, studSpacing = 450} = {}) => {
  const pts = G.rectangle({x: x0, y: y0}, {x: x1, y: y1}), m = DETAIL_MATERIALS[mat] || {};
  if (outline) d.poly(pts, true, L.outline, {detailMaterial: mat});
  if (m.pattern || m.solid) d.hatch(pts, mat, {angle: vertical && mat === 'insulation' ? 90 : 0});
  if (m.zigzag) d.zigzag(x0, y0, x1, y1, vertical);
  if (m.studs && vertical) d.studs(x0, y0, x1, y1, studSpacing);
 };
 d.zigzag = (x0, y0, x1, y1, vertical) => {
  const across = vertical ? x1 - x0 : y1 - y0, along = vertical ? y1 - y0 : x1 - x0;
  if (!(across > 0) || !(along > 0)) return;
  const margin = across * 0.12, n = Math.min(800, Math.max(2, Math.ceil(along / Math.max(across * 0.5, 1e-6))));
  const pts = Array.from({length: n + 1}, (_, i) => { const t = along * i / n, a = i % 2 ? across - margin : margin; return vertical ? {x: x0 + a, y: y0 + t} : {x: x0 + t, y: y0 + a}; });
  d.poly(pts, false, L.hatch, {detailMaterial: 'batt'});
 };
 d.studs = (x0, y0, x1, y1, spacing) => {
  const inset = Math.min(1, (x1 - x0) * 0.02), flange = Math.min(45, spacing * 0.3);
  for (let y = y0 + spacing / 2, k = 0; y + flange < y1 && k < 200; y += spacing, k++)
   d.poly([{x: x0 + inset, y: y + flange}, {x: x0 + inset, y}, {x: x1 - inset, y}, {x: x1 - inset, y: y + flange}], false, L.outline, {detailMaterial: 'stud'});
 };
 d.dim = (mode, a, b, p, role, extra = {}) => d.push({type: 'dimension', layer: L.dims, mode, points: [copy(a), copy(b), copy(p)], textHeight: P(DETAIL_PAPER.dimText), arrowSize: P(DETAIL_PAPER.dimArrow), precision: 1, detailRole: role, ...extra});
 /** 연속치수 한 줄 + 전체 치수. feet 는 측정점(치수 방향 좌표 오름차순). 좁은 칸의 숫자는 겹치지 않게 옆으로 민다. */
 d.chain = ({mode, feet, line, totalLine = null, role = 'layer', totalRole = 'total'}) => {
  const vertical = mode === 'vertical', along = (q) => vertical ? q.y : q.x, at = (q, where) => vertical ? {x: where, y: q.y} : {x: q.x, y: where};
  const th = P(DETAIL_PAPER.dimText), gap = th * 0.3, dims = [];
  for (let i = 0; i + 1 < feet.length; i++) if (Math.abs(along(feet[i + 1]) - along(feet[i])) > 1e-9) dims.push(d.dim(mode, feet[i], feet[i + 1], at(feet[i], line), role));
  const items = dims.map(e => { const v = Math.abs(along(e.points[1]) - along(e.points[0])); return {c: (along(e.points[0]) + along(e.points[1])) / 2, w: fmt(Number(v.toFixed(1))).length * 0.65 * th}; });
  const order = items.map((_, i) => i).sort((i, j) => items[i].c - items[j].c), placed = spreadLabels(order.map(i => items[i]), th * 0.5);
  order.forEach((i, k) => { if (Math.abs(placed[k] - items[i].c) > 1e-6) dims[i].textPosition = vertical ? {x: line - gap, y: placed[k]} : {x: placed[k], y: line + gap}; });
  if (totalLine != null && dims.length > 1) d.dim(mode, feet[0], feet.at(-1), at(feet[0], totalLine), totalRole);
  return dims;
 };
 /** 재료 표기(한 줄 지시선): 점마다 재료를 찍고 선 끝 선반 위에 위→아래(외부→내부) 순서로 적는다. side: +1 오른쪽, −1 왼쪽. */
 d.leaderNotes = ({anchors, texts, from, to, side = 1}) => {
  const th = P(DETAIL_PAPER.text), sp = P(DETAIL_PAPER.noteLine);
  const w = Math.max(...texts.map(t => estimateTextWidth(t, th))) + P(2), end = {x: to.x + side * w, y: to.y};
  d.poly([from, to, end], false, L.text, {detailRole: 'leader'});
  anchors.forEach(q => d.dot(q));
  const x = (side > 0 ? to.x : end.x) + P(1);
  texts.forEach((t, k) => d.text({x, y: to.y + P(1.2) + (texts.length - 1 - k) * sp}, t));
  d.notes.push(...texts);
 };
 /** 재료 표기(부채꼴 지시선): 항목마다 따로 선을 긋고, 문자 줄은 제자리 높이 근처에 겹치지 않게 벌린다(창호 상세). */
 d.fanNotes = (items, x) => {
  const th = P(DETAIL_PAPER.text), sp = P(DETAIL_PAPER.noteLine);
  const sorted = [...items].sort((a, b) => a.p.y - b.p.y);
  const ys = spreadLabels(sorted.map(it => ({c: it.p.y, w: sp})), 0);
  sorted.forEach((it, k) => {
   const y = ys[k], w = estimateTextWidth(it.text, th) + P(2);
   d.poly([it.p, {x, y}, {x: x + w, y}], false, L.text, {detailRole: 'leader'});
   d.dot(it.p);
   d.text({x: x + P(1), y: y + P(1.2)}, it.text);
  });
  d.notes.push(...[...sorted].reverse().map(it => it.text));
 };
 return d;
}

/* ══════════════════════════ 단면 형식별 작도 ══════════════════════════ */
/** 벽(세로 띠): 외부(왼쪽) → 내부(오른쪽). 연속치수는 아래, 재료 표기는 가로 지시선으로 오른쪽. */
function wallSection(d, layers, {height, substrate = null}) {
 const {P} = d;let x = 0;const feet = [{x: 0, y: 0}];
 for (const l of layers) { d.material(x, 0, x + l.thk, height, l.mat, {vertical: true, studSpacing: l.studSpacing}); x += l.thk; feet.push({x, y: 0}); }
 const W = x, x0 = substrate ? -substrate.depth : 0;
 if (substrate) d.material(x0, 0, 0, height, substrate.mat, {vertical: true, outline: false});
 d.chain({mode: 'horizontal', feet, line: -P(DETAIL_PAPER.dimOffset), totalLine: -P(DETAIL_PAPER.dimOffset + DETAIL_PAPER.dimRow)});
 const yL = height * 0.7;
 const anchors = [...(substrate ? [{x: x0 / 2, y: yL}] : []), ...layers.map((_, i) => ({x: (feet[i].x + feet[i + 1].x) / 2, y: yL}))];
 d.leaderNotes({anchors, texts: [...(substrate ? [substrate.note] : []), ...layers.map(thkNote)], from: anchors[0], to: {x: W + P(4), y: yL}});
 d.text({x: x0 - P(3), y: height / 2}, '외부', {align: 'right', role: 'label', height: P(DETAIL_PAPER.label)});
 d.text({x: W + P(3), y: height * 0.15}, '내부', {role: 'label', height: P(DETAIL_PAPER.label)});
 d.stack.push(...layers);if (substrate) d.extras.push(substrate);d.total = W;
 return {W};
}

/** 바닥·지붕(가로 띠): 위 → 아래. 연속치수는 왼쪽, 재료 표기는 세로 지시선으로 위. wall = 오른쪽 벽과 방수 치켜올림. */
function floorSection(d, layers, {length, substrate = null, wall = null, notes = true, noteAt = 0.3}) {
 const {P} = d, T = layers.reduce((s, l) => s + l.thk, 0);
 const membrane = wall ? layers.findIndex(l => l.mat === 'membrane') : -1, mt = membrane >= 0 ? layers[membrane].thk : 0;
 let y = T;const bands = [];
 layers.forEach((l, i) => { d.material(0, y - l.thk, membrane >= 0 && i < membrane ? length - mt : length, y, l.mat); bands.push({y0: y - l.thk, y1: y}); y -= l.thk; });
 if (wall) {
  d.material(length, 0, length + wall.thk, T + wall.upturn + wall.above, 'concrete', {vertical: true});
  if (membrane >= 0) {
   d.material(length - mt, bands[membrane].y1, length, T + wall.upturn, 'membrane');
   d.dim('vertical', {x: length - mt, y: T}, {x: length - mt, y: T + wall.upturn}, {x: length - mt - P(DETAIL_PAPER.dimOffset), y: T}, 'extra', {textTemplate: 'H<>'});
  }
 }
 if (substrate) d.material(0, -substrate.depth, length, 0, substrate.mat, {outline: false});
 const feet = [{x: 0, y: 0}, ...[...bands].reverse().map(b => ({x: 0, y: b.y1}))];
 d.chain({mode: 'vertical', feet, line: -P(DETAIL_PAPER.dimOffset), totalLine: -P(DETAIL_PAPER.dimOffset + DETAIL_PAPER.dimRow)});
 const xL = length * noteAt;
 const anchors = [...bands.map(b => ({x: xL, y: (b.y0 + b.y1) / 2})), ...(substrate ? [{x: xL, y: -substrate.depth / 2}] : [])];
 const texts = [...layers.map(thkNote), ...(substrate ? [substrate.note] : [])];
 if (notes) d.leaderNotes({anchors, texts, from: anchors.at(-1), to: {x: xL, y: T + P(DETAIL_PAPER.noteLift)}});
 d.stack.push(...layers);if (substrate) d.extras.push(substrate);d.total = T;
 return {T, anchors, texts, xL};
}

/** 경사 지붕: 가로 띠를 물매 각도로 돌린다(해치 무늬·치수 방향도 함께). 재료 표기는 돌린 뒤 왼쪽 위로. */
function slopeSection(d, layers, {length, rise}) {
 const {P} = d, angle = Math.atan2(rise, 10) * 180 / Math.PI, start = d.entities.length, origin = {x: 0, y: 0};
 const {T, anchors, texts, xL} = floorSection(d, layers, {length, notes: false, noteAt: 0.55});
 for (let i = start; i < d.entities.length; i++) d.entities[i] = G.rotate(d.entities[i], origin, angle);
 const rot = (q) => G.rotate({type: 'point', position: q}, origin, angle).position;
 d.leaderNotes({anchors: anchors.map(rot), texts, from: rot(anchors.at(-1)), to: rot({x: xL, y: T + P(DETAIL_PAPER.noteLift)}), side: -1});
 d.text(rot({x: length * 0.78, y: T + P(2)}), `물매 ${fmt(rise)}/10`, {rotation: angle, role: 'label', height: P(DETAIL_PAPER.label)});
}

/** 줄기초·독립기초: 잡석 → 버림 → 기초판 → 기초벽(기둥) 단면. 독립기초는 오른쪽에 평면을 곁들인다. */
function footingSection(d, p, kind) {
 const {P} = d, strip = kind === 'strip';
 const B = p.width, T = p.footing, c = strip ? p.wall : p.column, hs = strip ? p.stem : p.pedestal, lean = p.lean, g = p.gravel, X = B / 2 + p.ext, earth = 200;
 const y1 = g, y2 = g + lean, y3 = y2 + T, y4 = y3 + hs;
 d.material(-X, -earth, X, 0, 'earth', {outline: false});
 if (g > 0) d.material(-X, 0, X, y1, 'gravel');
 d.material(-X, y1, X, y2, 'lean');
 const body = hs > 0
  ? [{x: -B / 2, y: y2}, {x: B / 2, y: y2}, {x: B / 2, y: y3}, {x: c / 2, y: y3}, {x: c / 2, y: y4}, {x: -c / 2, y: y4}, {x: -c / 2, y: y3}, {x: -B / 2, y: y3}]
  : G.rectangle({x: -B / 2, y: y2}, {x: B / 2, y: y3});
 d.poly(body, true, d.L.outline, {detailMaterial: 'concrete'});d.hatch(body, 'concrete');
 const layers = [
  ...(hs > 0 ? [{name: strip ? '기초벽' : '기둥 주각', thk: hs, mat: 'concrete', note: strip ? `기초벽 RC THK${fmt(c)} (H${fmt(hs)})` : `기둥 주각 RC ${fmt(c)}×${fmt(c)} (H${fmt(hs)})`}] : []),
  {name: '기초판', thk: T, mat: 'concrete', note: strip ? `기초판 RC ${fmt(B)}×${fmt(T)}` : `기초판 RC ${fmt(B)}×${fmt(B)}×${fmt(T)}`},
  {name: '버림 콘크리트', thk: lean, mat: 'lean'},
  ...(g > 0 ? [{name: '잡석 다짐', thk: g, mat: 'gravel'}] : []),
 ];
 const substrate = {name: '원지반 다짐', note: '원지반 다짐', mat: 'earth', depth: earth};
 const feet = [{x: -X, y: 0}, ...(g > 0 ? [{x: -X, y: y1}] : []), {x: -X, y: y2}, {x: -B / 2, y: y3}, ...(hs > 0 ? [{x: -c / 2, y: y4}] : [])];
 d.chain({mode: 'vertical', feet, line: -X - P(DETAIL_PAPER.dimOffset), totalLine: -X - P(DETAIL_PAPER.dimOffset + DETAIL_PAPER.dimRow)});
 d.dim('horizontal', {x: -B / 2, y: y2}, {x: B / 2, y: y2}, {x: -B / 2, y: -earth - P(8)}, 'extra');
 const xL = c / 4, mids = [...(hs > 0 ? [(y3 + y4) / 2] : []), (y2 + y3) / 2, (y1 + y2) / 2, ...(g > 0 ? [y1 / 2] : []), -earth / 2];
 d.leaderNotes({anchors: mids.map(y => ({x: xL, y})), texts: [...layers.map(thkNote), substrate.note], from: {x: xL, y: -earth / 2}, to: {x: xL, y: Math.max(y4, y3) + P(DETAIL_PAPER.noteLift)}});
 if (!strip) {
  const cx = X + P(20) + B / 2, cy = Math.max(y4, y3) - B / 2;
  d.poly(G.rectangle({x: cx - B / 2, y: cy - B / 2}, {x: cx + B / 2, y: cy + B / 2}), true, d.L.outline, {detailMaterial: 'concrete'});
  const col = G.rectangle({x: cx - c / 2, y: cy - c / 2}, {x: cx + c / 2, y: cy + c / 2});
  d.poly(col, true, d.L.outline, {detailMaterial: 'concrete'});d.hatch(col, 'concrete');
  d.dim('horizontal', {x: cx - B / 2, y: cy - B / 2}, {x: cx + B / 2, y: cy - B / 2}, {x: cx - B / 2, y: cy - B / 2 - P(8)}, 'extra');
  d.text({x: cx, y: cy - B / 2 - P(18)}, '평면', {align: 'center', role: 'label', height: P(DETAIL_PAPER.label)});
  d.text({x: 0, y: -earth - P(18)}, '단면', {align: 'center', role: 'label', height: P(DETAIL_PAPER.label)});
 }
 d.stack.push(...layers);d.extras.push(substrate);d.total = y4;
}

/** 창대·인방 개요(세로 단면): 하부 벽 → 창호(창틀·복층유리, 외부 창대석·내부 창대) → 인방. */
function windowSection(d, p) {
 const {P} = d, tw = p.wall, sh = p.sill, oh = p.opening, ld = p.lintel, fd = p.frame, inset = p.inset, ss = p.stone;
 const proj = ss > 0 ? 40 : 0, top = sh + oh + ld, fx0 = inset, fx1 = inset + fd, fw = Math.min(60, oh / 4), board = 20, over = 20;
 d.material(0, 0, tw, sh, 'concrete', {vertical: true});
 d.material(0, sh + oh, tw, top, 'concrete');
 if (ss > 0) { const stone = [{x: -proj, y: sh}, {x: fx0, y: sh}, {x: fx0, y: sh + ss}, {x: -proj, y: sh + ss * 0.6}]; d.poly(stone, true, d.L.outline, {detailMaterial: 'stone'}); d.hatch(stone, 'stone'); }
 d.poly(G.rectangle({x: fx0, y: sh}, {x: fx1, y: sh + oh}), true, d.L.outline, {detailMaterial: 'frame'});
 d.line({x: fx0, y: sh + fw}, {x: fx1, y: sh + fw});d.line({x: fx0, y: sh + oh - fw}, {x: fx1, y: sh + oh - fw});
 const gx = (fx0 + fx1) / 2, half = Math.min(12, fd * 0.2);
 d.line({x: gx - half, y: sh + fw}, {x: gx - half, y: sh + oh - fw});d.line({x: gx + half, y: sh + fw}, {x: gx + half, y: sh + oh - fw});
 const inner = Math.max(fx1, 0);
 if (tw + over - inner > 1) d.poly(G.rectangle({x: inner, y: sh}, {x: tw + over, y: sh + board}), true, d.L.outline, {detailMaterial: 'board'});
 const layers = [
  {name: '인방', thk: ld, mat: 'concrete', note: `인방 RC ${fmt(tw)}×${fmt(ld)}`},
  {name: '창호 개구부', thk: oh, mat: 'air', note: `창호 개구부 H${fmt(oh)} · 창틀 ${fmt(fd)}`},
  {name: '하부 벽체', thk: sh, mat: 'concrete', note: `하부 벽체 RC THK${fmt(tw)} (창대 높이 ${fmt(sh)})`},
 ];
 d.chain({mode: 'vertical', feet: [{x: 0, y: 0}, {x: 0, y: sh}, {x: 0, y: sh + oh}, {x: 0, y: top}], line: -proj - P(DETAIL_PAPER.dimOffset), totalLine: -proj - P(DETAIL_PAPER.dimOffset + DETAIL_PAPER.dimRow)});
 d.chain({mode: 'horizontal', feet: [{x: 0, y: 0}, {x: fx0, y: 0}, {x: fx1, y: 0}, {x: tw, y: 0}].filter((q, i, all) => i === 0 || q.x > all[i - 1].x + 1e-9), line: -P(DETAIL_PAPER.dimOffset), totalLine: -P(DETAIL_PAPER.dimOffset + DETAIL_PAPER.dimRow), role: 'extra', totalRole: 'extra'});
 const items = [
  {p: {x: tw / 2, y: sh + oh + ld / 2}, text: layers[0].note},
  {p: {x: fx0 + fd * 0.25, y: sh + oh - fw / 2}, text: layers[1].note},
  {p: {x: gx, y: sh + oh * 0.55}, text: 'THK24 복층유리 (5+14+5)'},
  ...(tw + over - inner > 1 ? [{p: {x: (inner + tw + over) / 2, y: sh + board / 2}, text: `THK${board} 내부 창대 (인조대리석)`}] : []),
  ...(ss > 0 ? [{p: {x: (fx0 - proj) / 2, y: sh + ss * 0.4}, text: `THK${fmt(ss)} 화강석 창대 (물흘림 경사)`}] : []),
  {p: {x: tw / 2, y: sh / 2}, text: layers[2].note},
 ];
 d.fanNotes(items, Math.max(tw + over, fx1) + P(DETAIL_PAPER.fanGap));
 d.text({x: -proj - P(3), y: top + P(3)}, '외부', {align: 'right', role: 'label', height: P(DETAIL_PAPER.label)});
 d.text({x: tw + P(3), y: top + P(3)}, '내부', {role: 'label', height: P(DETAIL_PAPER.label)});
 d.stack.push(...layers);d.total = top;
}

/* ══════════════════════════ 상세 목록 ══════════════════════════ */
export const DETAILS = Object.freeze({
 'wall-rc-ext': {category: 'wall', label: 'RC 200 외단열 (콘크리트 + 비드법 + 마감)',
  fields: [num('concrete', '콘크리트 벽 두께', 200, 100, 600), num('insulation', '비드법 단열재 두께', 100, 10, 400), num('finish', '외부 미장 마감 두께', 10, 3, 50), num('board', '내부 석고보드 두께', 9.5, 6, 30), extent(1000)],
  title: p => `RC ${fmt(p.concrete)} 외단열`,
  build: (d, p) => wallSection(d, [
   {name: '외단열 미장 마감', thk: p.finish, mat: 'mortar'},
   {name: '비드법 보온판 2종1호', thk: p.insulation, mat: 'insulation'},
   {name: '철근콘크리트 벽', thk: p.concrete, mat: 'concrete'},
   {name: '석고보드 위 도배', thk: p.board, mat: 'board'},
  ], {height: p.extent})},
 'wall-rc-int': {category: 'wall', label: 'RC 200 내단열',
  fields: [num('concrete', '콘크리트 벽 두께', 200, 100, 600), num('insulation', '압출법 단열재 두께', 100, 10, 400), num('plaster', '외부 몰탈 미장 두께', 20, 5, 50), num('board', '석고보드 한 겹 두께', 9.5, 6, 30), extent(1000)],
  title: p => `RC ${fmt(p.concrete)} 내단열`,
  build: (d, p) => wallSection(d, [
   {name: '외부 시멘트 몰탈 미장', thk: p.plaster, mat: 'mortar'},
   {name: '철근콘크리트 벽', thk: p.concrete, mat: 'concrete'},
   {name: '압출법 보온판 특호', thk: p.insulation, mat: 'insulation'},
   {name: '석고보드 1겹', thk: p.board, mat: 'board'},
   {name: '석고보드 2겹 위 도배', thk: p.board, mat: 'board'},
  ], {height: p.extent})},
 'wall-cavity': {category: 'wall', label: '조적 1.0B 중공벽',
  fields: [num('brick', '벽돌 0.5B 두께', 90, 57, 190), num('air', '공기층 (0 = 없음)', 50, 0, 200), num('insulation', '중공 단열재 두께', 100, 10, 300), num('plaster', '내부 미장 두께 (0 = 없음)', 18, 0, 50), extent(1000)],
  title: () => '조적 1.0B 중공벽',
  build: (d, p) => wallSection(d, [
   {name: '치장벽돌 0.5B', thk: p.brick, mat: 'brick'},
   {name: '공기층', thk: p.air, mat: 'air'},
   {name: '비드법 보온판 2종1호', thk: p.insulation, mat: 'insulation'},
   {name: '시멘트벽돌 0.5B', thk: p.brick, mat: 'brick'},
   {name: '시멘트 몰탈 미장', thk: p.plaster, mat: 'mortar'},
  ].filter(l => l.thk > 0), {height: p.extent})},
 'wall-light': {category: 'wall', label: '경량벽 (스터드 + 석고보드 2겹)',
  fields: [num('stud', 'C형 스터드 폭', 65, 40, 200), num('board', '석고보드 한 겹 두께', 9.5, 6, 25), num('spacing', '스터드 간격 @', 450, 200, 1200), extent(1000)],
  title: p => `경량벽 C-${fmt(p.stud)} + 석고보드 2겹`,
  build: (d, p) => wallSection(d, [
   {name: '석고보드 (바깥)', thk: p.board, mat: 'board'},
   {name: '석고보드 (안)', thk: p.board, mat: 'board'},
   {name: `C형 스틸 스터드 @${fmt(p.spacing)} + 글라스울`, thk: p.stud, mat: 'stud', studSpacing: p.spacing},
   {name: '석고보드 (안)', thk: p.board, mat: 'board'},
   {name: '석고보드 (바깥)', thk: p.board, mat: 'board'},
  ], {height: p.extent})},
 'roof-flat': {category: 'roof', label: '평지붕 (슬래브 + 방수 + 단열 + 보호몰탈)',
  fields: [num('slab', '슬래브 두께', 150, 100, 500), pick('membrane', '방수층', 'coat', [['coat', MEMBRANE.coat], ['sheet', MEMBRANE.sheet]]), num('insulation', '압출법 단열재 두께', 200, 20, 400), num('protect', '보호 몰탈 두께', 40, 20, 150), extent(1500, 500)],
  title: p => `평지붕 (${MEMBRANE[p.membrane]})`,
  build: (d, p) => floorSection(d, [
   {name: '보호 몰탈', thk: p.protect, mat: 'mortar'},
   {name: '압출법 보온판 특호', thk: p.insulation, mat: 'insulation'},
   {name: MEMBRANE[p.membrane], thk: 3, mat: 'membrane'},
   {name: '철근콘크리트 슬래브', thk: p.slab, mat: 'concrete'},
  ], {length: p.extent})},
 'roof-slope': {category: 'roof', label: '경사지붕 (징크 / 아스팔트 싱글)',
  fields: [pick('finish', '지붕 마감', 'zinc', [['zinc', '징크 (티타늄아연판)'], ['shingle', '아스팔트 싱글']]), num('rise', '물매 (10 에 대한 높이)', 4, 1, 12, '/10'), num('insulation', '단열재 두께', 200, 20, 400), num('slab', '경사 슬래브 두께', 150, 100, 400), extent(1500, 500)],
  title: p => `경사지붕 · ${p.finish === 'zinc' ? '징크' : '아스팔트 싱글'} (물매 ${fmt(p.rise)}/10)`,
  build: (d, p) => slopeSection(d, [
   ...(p.finish === 'zinc'
    ? [{name: '징크 (티타늄아연판) 거멀접기', thk: 0.7, mat: 'metal'}, {name: '투습 방수시트', thk: 2, mat: 'membrane'}, {name: '구조용 합판', thk: 12, mat: 'board'}]
    : [{name: '아스팔트 싱글', thk: 5, mat: 'metal'}, {name: '아스팔트 루핑', thk: 1, mat: 'membrane'}, {name: 'OSB 합판', thk: 11, mat: 'board'}]),
   {name: '경질 우레탄폼 단열재', thk: p.insulation, mat: 'insulation'},
   {name: '철근콘크리트 경사 슬래브', thk: p.slab, mat: 'concrete'},
  ], {length: p.extent, rise: p.rise})},
 'fdn-strip': {category: 'foundation', label: '줄기초',
  fields: [num('width', '기초판 폭', 900, 300, 5000), num('footing', '기초판 두께', 300, 150, 2000), num('wall', '기초벽 두께', 200, 100, 1000), num('stem', '기초벽 높이 (0 = 없음)', 600, 0, 3000), num('lean', '버림 콘크리트 두께', 60, 30, 200), num('gravel', '잡석 두께 (0 = 없음)', 200, 0, 600), num('ext', '버림·잡석 내밀기', 100, 0, 500)],
  check: p => { if (p.wall >= p.width) throw Error('기초벽 두께는 기초판 폭보다 작아야 합니다.'); },
  title: p => `줄기초 ${fmt(p.width)}×${fmt(p.footing)}`,
  build: (d, p) => footingSection(d, p, 'strip')},
 'fdn-isolated': {category: 'foundation', label: '독립기초',
  fields: [num('width', '기초판 한 변', 2000, 500, 8000), num('footing', '기초판 두께', 500, 200, 3000), num('column', '기둥 한 변', 500, 200, 2000), num('pedestal', '기둥 주각 높이 (0 = 없음)', 600, 0, 3000), num('lean', '버림 콘크리트 두께', 60, 30, 200), num('gravel', '잡석 두께 (0 = 없음)', 200, 0, 600), num('ext', '버림·잡석 내밀기', 100, 0, 500)],
  check: p => { if (p.column >= p.width) throw Error('기둥 한 변은 기초판 한 변보다 작아야 합니다.'); },
  title: p => `독립기초 ${fmt(p.width)}×${fmt(p.width)}×${fmt(p.footing)}`,
  build: (d, p) => footingSection(d, p, 'isolated')},
 'fdn-mat': {category: 'foundation', label: '매트기초 (잡석·버림 콘크리트)',
  fields: [num('mat', '매트 두께', 800, 300, 4000), num('lean', '버림 콘크리트 두께', 60, 30, 200), num('gravel', '잡석 두께 (0 = 없음)', 200, 0, 600), extent(2000, 500)],
  title: p => `매트기초 THK${fmt(p.mat)}`,
  build: (d, p) => floorSection(d, [
   {name: '매트 기초 (철근콘크리트)', thk: p.mat, mat: 'concrete'},
   {name: '버림 콘크리트', thk: p.lean, mat: 'lean'},
   ...(p.gravel > 0 ? [{name: '잡석 다짐', thk: p.gravel, mat: 'gravel'}] : []),
  ], {length: p.extent, substrate: {name: '원지반 다짐', note: '원지반 다짐', mat: 'earth', depth: 200}})},
 'win-sill-lintel': {category: 'opening', label: '창대·인방 개요',
  fields: [num('wall', '벽 두께', 200, 100, 600), num('sill', '창대 높이 (바닥에서)', 900, 100, 2000), num('opening', '창호 개구부 높이', 1500, 300, 4000), num('lintel', '인방 춤', 300, 100, 1500), num('frame', '창틀 두께', 100, 40, 300), num('inset', '외부면에서 창틀까지', 50, 0, 300), num('stone', '외부 창대석 두께 (0 = 없음)', 30, 0, 100)],
  check: p => { if (p.inset + p.frame > p.wall) throw Error('창틀 위치(외부면에서 거리 + 창틀 두께)가 벽 두께 안에 있어야 합니다.'); },
  title: () => '창대·인방 개요',
  build: (d, p) => windowSection(d, p)},
 'wp-bath': {category: 'waterproof', label: '욕실 바닥 방수',
  fields: [num('slab', '슬래브 두께', 150, 100, 400), pick('membrane', '방수층', 'coat', [['coat', '폴리머 시멘트 도막방수'], ['sheet', '개량 아스팔트 시트방수']]), num('mortar', '보호·구배 몰탈 두께', 40, 20, 150), num('bed', '타일 붙임 몰탈 두께', 20, 5, 50), num('tile', '바닥 타일 두께', 10, 5, 30), num('upturn', '방수 치켜올림 높이', 300, 100, 2000), extent(1500, 800)],
  title: p => `욕실 바닥 방수 (치켜올림 H${fmt(p.upturn)})`,
  build: (d, p) => floorSection(d, [
   {name: '바닥 타일', thk: p.tile, mat: 'board'},
   {name: '타일 붙임 몰탈', thk: p.bed, mat: 'mortar'},
   {name: '보호·구배 몰탈', thk: p.mortar, mat: 'mortar'},
   {name: p.membrane === 'coat' ? '폴리머 시멘트 도막방수' : '개량 아스팔트 시트방수', thk: 3, mat: 'membrane'},
   {name: '철근콘크리트 슬래브', thk: p.slab, mat: 'concrete'},
  ], {length: p.extent, wall: {thk: 150, upturn: p.upturn, above: 200}, noteAt: 0.1})},
 'wp-basement': {category: 'waterproof', label: '지하 외벽 방수',
  fields: [num('wall', '지하 외벽 두께', 300, 150, 1200), pick('membrane', '방수층', 'sheet', [['sheet', '자착식 개량 아스팔트 시트방수'], ['coat', '우레탄 도막방수']]), num('protection', '방수 보호판 두께', 20, 5, 100), num('plaster', '내부 몰탈 미장 두께 (0 = 없음)', 18, 0, 50), extent(1000)],
  title: p => `지하 외벽 방수 (${p.membrane === 'sheet' ? '시트방수' : '도막방수'})`,
  build: (d, p) => wallSection(d, [
   {name: '방수 보호판', thk: p.protection, mat: 'board'},
   {name: p.membrane === 'sheet' ? '자착식 개량 아스팔트 시트방수' : '우레탄 도막방수', thk: 3, mat: 'membrane'},
   {name: '철근콘크리트 지하 외벽', thk: p.wall, mat: 'concrete'},
   {name: '내부 몰탈 미장', thk: p.plaster, mat: 'mortar'},
  ].filter(l => l.thk > 0), {height: p.extent, substrate: {name: '되메우기 흙 (다짐)', note: '되메우기 흙 (다짐)', mat: 'earth', depth: 300}})},
});

export const categoryLabel = (key) => DETAIL_CATEGORIES.find(([k]) => k === key)?.[1] || key;
/** 분류 안의 상세 목록 [[id, 라벨]]. */
export const detailsIn = (category) => Object.entries(DETAILS).filter(([, spec]) => spec.category === category).map(([id, spec]) => [id, spec.label]);

/** 입력값을 검사해 숫자·선택값으로 바꾼다. 범위를 벗어나거나 서로 맞지 않으면 한국어 오류. */
export function detailParameters(id, values = {}) {
 const spec = DETAILS[id];
 if (!spec) throw Error('상세 종류를 확인하세요.');
 const out = {};
 for (const f of spec.fields) {
  const raw = values[f.name] ?? f.value;
  if (f.options) {
   const v = String(raw);
   if (!f.options.some(([k]) => k === v)) throw Error(`${f.label}: 목록에서 고르세요.`);
   out[f.name] = v;continue;
  }
  const n = typeof raw === 'number' ? raw : Number(String(raw ?? '').trim());
  if (String(raw ?? '').trim() === '' || !Number.isFinite(n)) throw Error(`${f.label}에는 숫자를 입력하세요.`);
  if (n < f.min || n > f.max) throw Error(`${f.label}은(는) ${fmt(f.min)}~${fmt(f.max)} 사이로 입력하세요.`);
  out[f.name] = n;
 }
 spec.check?.(out);
 return out;
}

/**
 * 상세 하나를 로컬 좌표(원점 근처)로 작도한다(순수 함수).
 * 반환: {id, category, title, scale, parameters, entities, layers(치수 잰 재료층), extras(흙 등), notes(재료 표기 줄), total, bounds}
 */
export function buildDetail(id, values = {}, {scale = 20, layers = {}} = {}) {
 const spec = DETAILS[id];
 if (!spec) throw Error('상세 종류를 확인하세요.');
 const s = Number(scale);
 if (!(s >= DETAIL_SCALE_LIMITS.min) || s > DETAIL_SCALE_LIMITS.max) throw Error(`상세 축척은 1:${DETAIL_SCALE_LIMITS.min} ~ 1:${DETAIL_SCALE_LIMITS.max} 입니다.`);
 const p = detailParameters(id, values);
 const L = {outline: 'default', hatch: 'default', dims: 'default', text: 'default', title: 'default', ...layers};
 const d = draft(s, L);
 spec.build(d, p);
 const title = `(${categoryLabel(spec.category)}) ${spec.title(p)}`;
 const b = G.bounds(d.entities);
 const heading = titleBlock({title, scale: s, paperHeight: 5, style: 'scale', position: {x: b.minX, y: b.minY - d.P(DETAIL_PAPER.titleGap)}, layer: L.title});
 const entities = [...d.entities, ...heading.entities.map(e => ({...e, detailRole: 'title'}))];
 return {id, category: spec.category, label: spec.label, title, scale: s, parameters: p, entities, layers: d.stack.map(l => ({...l})), extras: d.extras.map(l => ({...l})), notes: [...d.notes], total: d.total, bounds: G.bounds(entities)};
}

/** 상세 블록: 경계 상자 왼쪽 아래가 position 에 오도록 옮겨 한 덩어리로 묶는다. */
export function detailBlock(id, values = {}, {scale = 20, layers = {}, position = {x: 0, y: 0}} = {}) {
 if (!position || !Number.isFinite(position.x) || !Number.isFinite(position.y)) throw Error('삽입점이 올바르지 않습니다.');
 const built = buildDetail(id, values, {scale, layers});
 const dx = position.x - built.bounds.minX, dy = position.y - built.bounds.minY;
 return {
  type: 'block', name: `상세 ${built.title}`, layer: layers.outline || 'default', position: {x: position.x, y: position.y},
  attributes: {title: built.title, scale: built.scale},
  detail: {id, category: built.category, parameters: built.parameters, scale: built.scale},
  entities: built.entities.map(e => G.translate(e, dx, dy)),
 };
}

/** 삽입 미리보기: 경계 상자와 재료층 외곽선만(해치·문자 없이 가볍게). */
export function detailPreview(built, cursor) {
 const b = built.bounds, dx = cursor.x - b.minX, dy = cursor.y - b.minY;
 const outlines = built.entities.filter(e => e.type === 'polyline' && e.closed && e.detailMaterial).map(e => G.translate(e, dx, dy));
 return [{type: 'polyline', closed: true, points: G.rectangle({x: cursor.x, y: cursor.y}, {x: cursor.x + b.maxX - b.minX, y: cursor.y + b.maxY - b.minY})}, ...outlines];
}

const STORE_KEY = 'barun-detail-library';

/** DETAIL 명령: 분류 → 상세 → 치수·축척 → 삽입점. 앞의 두 창은 고르기만 하고, 마지막 [적용]의 넣기가 되돌리기 한 단계다. */
export function installDetailLibrary(ctx) {
 const load = () => { try { return JSON.parse(ctx.storage?.getItem(STORE_KEY) || '{}') || {}; } catch { return {}; } };
 const save = (v) => { try { ctx.storage?.setItem(STORE_KEY, JSON.stringify(v)); } catch {} };
 const layerIds = () => {
  const out = {};
  for (const [key, [name, color]] of Object.entries(DETAIL_LAYER_NAMES)) {
   const id = ctx.ensureLayer(name, color), layer = ctx.layers?.().find(l => l.id === id);
   if (layer?.locked || layer?.visible === false) throw Error(`"${layer.name}" 레이어가 잠김/숨김이라 상세도를 넣을 수 없습니다.`);
   out[key] = id;
  }
  return out;
 };
 function chooseCategory() {
  const last = load();
  return ctx.form('표준 상세도 (DETAIL) · 1/3 분류', [
   {name: 'category', label: '분류', options: DETAIL_CATEGORIES.map(([k, v]) => [k, `${v} · ${detailsIn(k).length}종`]), value: last.category || 'wall'},
  ], (v) => chooseDetail(v.category));
 }
 function chooseDetail(category) {
  const list = detailsIn(category);
  if (!list.length) throw Error('분류를 목록에서 고르세요.');
  if (list.length === 1) return chooseParameters(list[0][0]);
  const last = load();
  return ctx.form(`표준 상세도 · 2/3 ${categoryLabel(category)} 상세`, [
   {name: 'detail', label: '상세', options: list, value: list.some(([id]) => id === last.detail) ? last.detail : list[0][0]},
  ], (v) => chooseParameters(v.detail));
 }
 function chooseParameters(id) {
  const spec = DETAILS[id];
  if (!spec) throw Error('상세를 목록에서 고르세요.');
  const last = load(), saved = last.values?.[id] || {};
  const fields = [...spec.fields.map(f => ({...f, value: saved[f.name] ?? f.value})), {name: 'scale', label: '상세 축척 1: (문자·치수 크기 = 용지 mm × 축척)', type: 'number', value: last.scale ?? 20}];
  return ctx.form(`표준 상세도 · 3/3 (${categoryLabel(spec.category)}) ${spec.label} · 치수와 축척`, fields, async (v) => {
   const scale = Number(v.scale), built = buildDetail(id, v, {scale});      // 점을 찍기 전에 입력부터 검사
   save({...last, category: spec.category, detail: id, scale, values: {...(last.values || {}), [id]: built.parameters}});
   const w = built.bounds.maxX - built.bounds.minX, h = built.bounds.maxY - built.bounds.minY;
   const at = await ctx.pickPoint({prompt: `DETAIL · 상세도 왼쪽 아래 모서리를 지정하세요 (크기 ${fmt(w)} × ${fmt(h)} mm) · Esc 취소`, preview: cursorPreview(c => detailPreview(built, c))});
   if (!at) return;
   const block = detailBlock(id, built.parameters, {scale, layers: layerIds(), position: at});
   ctx.commit({entities: [block]});
   ctx.toast(`${built.title} · SCALE 1:${fmt(scale)} · 재료층 ${built.layers.length}개 · 전체 ${fmt(built.total)} mm. 한 블록으로 넣었습니다(Ctrl+Z 로 되돌리기).`);
  });
 }
 return {DETAIL: () => chooseCategory()};
}
