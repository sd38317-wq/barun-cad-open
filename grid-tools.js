// 그리드(통심선)·번호 기호(훈민캐드 대조 기반 5: H95 · 훈민 GT/GTV/GTP, ACA Column Grid + Grid Bubble).
//  GRIDLINE    기준점 + X·Y 간격 목록(3000,3600*2,…)으로 간격이 다른 축선을 한 번에. 원+번호 기호, 축 사이 치수(선택).
//  GRIDBUBBLE  이미 그린 축선(선택한 선)의 끝에 원+번호 기호를 붙인다. 번호는 위치 순서대로.
// 기호 지름·문자 높이는 "용지 mm × 축척" 으로 정해 어느 축척에서도 출력 크기가 같다.
import {isChecked} from './card-input.js';

const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';   // I·O 는 1·0 과 헷갈려 쓰지 않는다(건축 도면 관례).

/** "3000, 3600*2, 3000" → [3000,3600,3600,3000]. min: 이보다 작은 간격은 천 단위 쉼표(3,600)로 잘못 쓴 것으로 보고 막는다. */
export function parseSpacingList(text, {min = 0} = {}) {
 const out = [];
 for (const raw of String(text ?? '').split(/[,\s]+/).filter(Boolean)) {
  const m = raw.match(/^(\d+(?:\.\d+)?)(?:[*xX×](\d+))?$/);
  if (!m) throw Error(`간격 "${raw}" 을(를) 읽을 수 없습니다. 예: 3000,3600*2,3000`);
  const value = Number(m[1]), count = m[2] ? Number(m[2]) : 1;
  if (!(value > 0) || !(count >= 1) || count > 100) throw Error(`간격 "${raw}" 은(는) 0보다 크고 반복은 1~100 이어야 합니다.`);
  if (value < min) throw Error(`간격 ${value} 은(는) 너무 작습니다(${min} 이상). 천 단위 쉼표 없이 3600 처럼 쓰세요 — 쉼표는 간격 구분입니다.`);
  for (let i = 0; i < count; i++) out.push(value);
 }
 if (out.length > 60) throw Error('축 간격은 방향마다 60개까지입니다.');
 return out;
}

/** i 번째 축 번호. style: number(1,2…) · letter(A,B…) · X / Y 접두(X1…). */
export function gridLabel(i, style, start = 1) {
 const n = i + Math.max(1, Math.floor(Number(start) || 1));
 if (style === 'letter') { let s = '', k = n; while (k > 0) { k--; s = LETTERS[k % LETTERS.length] + s; k = Math.floor(k / LETTERS.length); } return s; }
 if (style === 'X' || style === 'Y') return style + n;
 return String(n);
}

/** 원+번호 기호 하나 = 주석 블록 하나(ANNOSCALE 이 중심을 기준으로 함께 키운다). */
function bubble(center, label, diameter, textHeight) {
 return {type: 'block', name: '그리드 기호', annotative: true, gridBubble: label, position: center, entities: [
  {type: 'circle', center, radius: diameter / 2},
  {type: 'text', position: {x: center.x, y: center.y - textHeight * 0.42}, text: label, height: textHeight, align: 'center'},
 ]};
}
/** 블록 안까지 레이어 지정. */
export const onLayer = (e, layer) => ({...e, layer, ...(e.entities ? {entities: e.entities.map(c => onLayer(c, layer))} : {})});

/** 축선·기호·치수 객체 목록(레이어 없음). */
export function gridEntities({base = {x: 0, y: 0}, xs = [], ys = [], scale = 100, bubblePaper = 8, textPaper = 3.5, overhang = null, ends = 'both', xStyle = 'number', yStyle = 'letter', xStart = 1, yStart = 1, dimensions = true} = {}) {
 if (!(scale > 0)) throw Error('축척은 0보다 커야 합니다.');
 const xPos = [base.x], yPos = [base.y];
 for (const d of xs) xPos.push(xPos.at(-1) + d);
 for (const d of ys) yPos.push(yPos.at(-1) + d);
 if (xPos.length < 2 && yPos.length < 2) throw Error('X 또는 Y 간격을 하나 이상 입력하세요.');
 const dia = bubblePaper * scale, th = textPaper * scale;
 const ext = Number.isFinite(overhang) && overhang >= 0 ? overhang : Math.max(dia, 10 * scale);
 const minX = xPos[0], maxX = xPos.at(-1), minY = yPos[0], maxY = yPos.at(-1);
 if (!(ext > 0) && (xPos.length < 2 || yPos.length < 2)) throw Error('한 방향 축만 그릴 때는 축선 연장 길이가 0보다 커야 합니다(비우면 기호 지름).');
 const lines = [], marks = [], dims = [];
 const atStart = ends === 'both' || ends === 'start', atEnd = ends === 'both' || ends === 'end';
 xPos.forEach((x, i) => {
  const a = {x, y: minY - ext}, b = {x, y: maxY + ext}, label = gridLabel(i, xStyle, xStart);
  lines.push({type: 'line', points: [a, b], gridAxis: {dir: 'x', label}});
  if (atStart) marks.push(bubble({x, y: a.y - dia / 2}, label, dia, th));
  if (atEnd) marks.push(bubble({x, y: b.y + dia / 2}, label, dia, th));
 });
 if (yPos.length > 1 || xPos.length === 1) yPos.forEach((y, i) => {
  const a = {x: minX - ext, y}, b = {x: maxX + ext, y}, label = gridLabel(i, yStyle, yStart);
  lines.push({type: 'line', points: [a, b], gridAxis: {dir: 'y', label}});
  if (atStart) marks.push(bubble({x: a.x - dia / 2, y}, label, dia, th));
  if (atEnd) marks.push(bubble({x: b.x + dia / 2, y}, label, dia, th));
 });
 if (dimensions) {
  const gap = 4 * scale, yDim = maxY + ext + (atEnd ? dia : 0) + gap, xDim = minX - ext - (atStart ? dia : 0) - gap;
  const dim = (mode, a, b, at) => ({type: 'dimension', mode, points: [a, b, at], textHeight: 2.5 * scale, arrowSize: scale});
  if (xPos.length > 1) {
   for (let i = 1; i < xPos.length; i++) dims.push(dim('horizontal', {x: xPos[i - 1], y: maxY}, {x: xPos[i], y: maxY}, {x: xPos[i - 1], y: yDim}));
   if (xPos.length > 2) dims.push(dim('horizontal', {x: minX, y: maxY}, {x: maxX, y: maxY}, {x: minX, y: yDim + 2 * gap}));
  }
  if (yPos.length > 1) {
   for (let i = 1; i < yPos.length; i++) dims.push(dim('vertical', {x: minX, y: yPos[i - 1]}, {x: minX, y: yPos[i]}, {x: xDim, y: yPos[i - 1]}));
   if (yPos.length > 2) dims.push(dim('vertical', {x: minX, y: minY}, {x: minX, y: maxY}, {x: xDim - 2 * gap, y: minY}));
  }
 }
 return {lines, marks, dims, xPos, yPos};
}

/** 선택한 선들에 기호 붙이기: 세로선(X 축)은 x 순, 가로선(Y 축)은 y 순으로 번호. */
export function bubblesForLines(lines, {scale = 100, bubblePaper = 8, textPaper = 3.5, ends = 'both', xStyle = 'number', yStyle = 'letter', xStart = 1, yStart = 1} = {}) {
 const dia = bubblePaper * scale, th = textPaper * scale;
 const axes = lines.filter(e => e.type === 'line' && e.points?.length === 2).map(e => {
  const [p, q] = e.points, dx = q.x - p.x, dy = q.y - p.y, len = Math.hypot(dx, dy);
  return len > 1e-9 ? {e, p, q, ux: dx / len, uy: dy / len, vertical: Math.abs(dy) >= Math.abs(dx)} : null;
 }).filter(Boolean);
 const vert = axes.filter(a => a.vertical).sort((a, b) => (a.p.x + a.q.x) - (b.p.x + b.q.x));
 const horiz = axes.filter(a => !a.vertical).sort((a, b) => (a.p.y + a.q.y) - (b.p.y + b.q.y));
 const out = [];
 const place = (a, label) => {
  // 아래/왼쪽 끝이 "시작"
  const [s, t] = a.vertical ? (a.p.y <= a.q.y ? [a.p, a.q] : [a.q, a.p]) : (a.p.x <= a.q.x ? [a.p, a.q] : [a.q, a.p]);
  const len = Math.hypot(t.x - s.x, t.y - s.y), ux = (t.x - s.x) / len, uy = (t.y - s.y) / len;
  if (ends === 'both' || ends === 'start') out.push(bubble({x: s.x - ux * dia / 2, y: s.y - uy * dia / 2}, label, dia, th));
  if (ends === 'both' || ends === 'end') out.push(bubble({x: t.x + ux * dia / 2, y: t.y + uy * dia / 2}, label, dia, th));
 };
 vert.forEach((a, i) => place(a, gridLabel(i, xStyle, xStart)));
 horiz.forEach((a, i) => place(a, gridLabel(i, yStyle, yStart)));
 return {marks: out, count: vert.length + horiz.length};
}

const STYLE_OPTIONS = [['number', '1, 2, 3 …'], ['letter', 'A, B, C … (I·O 제외)'], ['X', 'X1, X2 …'], ['Y', 'Y1, Y2 …']];
const END_OPTIONS = [['both', '양쪽 끝'], ['start', '아래·왼쪽 끝만'], ['end', '위·오른쪽 끝만'], ['none', '기호 없음']];

export function installGridTools(ctx) {
 const defaultScale = () => Number(ctx.getSettings?.()?.denominator) || 100;
 // 쓰는 레이어만: 먼저 이미 있는 레이어가 잠김·숨김·동결인지 보고(아무것도 만들기 전), 통과하면 없는 것만 만든다.
 const LAYER_SPECS = {axis: ['그리드', '#ff5f5f'], mark: ['그리드-기호', '#ffffff'], dim: ['치수', '#00c8ff']};
 const gridLayers = (roles) => {
  for (const role of roles) {
   const [name] = LAYER_SPECS[role], l = ctx.layers().find(x => x.name === name);
   if (l && (l.locked || l.frozen || l.visible === false)) throw Error(`"${name}" 레이어가 잠김/숨김/동결이라 그릴 수 없습니다.`);
  }
  return Object.fromEntries(roles.map(role => [role, ctx.ensureLayer(...LAYER_SPECS[role])]));
 };
 const setCenterLinetype = (id) => {
  const layer = ctx.layers().find(l => l.id === id);
  if (layer && (!layer.linetype || layer.linetype === 'CONTINUOUS')) ctx.execute({type: 'layer.update', id, changes: {linetype: 'CENTER'}});
 };
 const common = () => [
  {name: 'scale', label: '축척 1:', type: 'number', value: defaultScale()},
  {name: 'bubble', label: '기호 지름 (용지 mm)', type: 'number', value: 8},
  {name: 'textPaper', label: '번호 문자 높이 (용지 mm)', type: 'number', value: 3.5},
  {name: 'ends', label: '기호 위치', options: END_OPTIONS, value: 'both'},
  {name: 'xStyle', label: '세로 축(X 방향) 번호', options: STYLE_OPTIONS, value: 'number'},
  {name: 'xStart', label: '세로 축 시작 번호', type: 'number', value: 1},
  {name: 'yStyle', label: '가로 축(Y 방향) 번호', options: STYLE_OPTIONS, value: 'letter'},
  {name: 'yStart', label: '가로 축 시작 번호', type: 'number', value: 1},
 ];
 const read = (v) => {
  const scale = Number(v.scale), bubblePaper = Number(v.bubble), textPaper = Number(v.textPaper);
  if (!(scale > 0) || !(bubblePaper > 0) || !(textPaper > 0)) throw Error('축척·기호 지름·문자 높이는 0보다 커야 합니다.');
  return {scale, bubblePaper, textPaper, ends: v.ends, xStyle: v.xStyle, yStyle: v.yStyle, xStart: Number(v.xStart) || 1, yStart: Number(v.yStart) || 1};
 };
 return {
  GRIDLINE() {
   return ctx.form('그리드(통심선) · 간격이 달라도 한 번에', [
    {name: 'xs', label: 'X 간격 목록 (좌→우) 예: 3000,3600*2,3000', value: '6000*3'},
    {name: 'ys', label: 'Y 간격 목록 (아래→위) 예: 6000,2100,6000', value: '6000*2'},
    {name: 'overhang', label: '축선 연장 길이 (비우면 기호 지름)', value: ''},
    {name: 'dimensions', label: '축 사이 치수와 전체 치수', type: 'checkbox', value: true},
    ...common(),
   ], async (v) => {
    const overhangText = String(v.overhang ?? '').trim();
    const opts = {...read(v), xs: parseSpacingList(v.xs, {min: 100}), ys: parseSpacingList(v.ys, {min: 100}), overhang: overhangText === '' ? null : Number(overhangText), dimensions: isChecked(v.dimensions)};
    if (opts.overhang !== null && !(opts.overhang >= 0)) throw Error('축선 연장 길이는 0 이상입니다.');
    gridEntities({...opts, base: {x: 0, y: 0}});   // 점을 찍기 전에 입력부터 검사
    const base = await ctx.pickPoint('GRIDLINE · 왼쪽 아래 첫 축의 교점(기준점)을 지정하세요');
    if (!base) return;
    const {lines, marks, dims, xPos, yPos} = gridEntities({...opts, base});
    const useMarks = opts.ends !== 'none' && marks.length, useDims = dims.length > 0;
    const layers = gridLayers(['axis', ...(useMarks ? ['mark'] : []), ...(useDims ? ['dim'] : [])]);
    setCenterLinetype(layers.axis);
    const list = [...lines.map(e => onLayer(e, layers.axis)), ...(useMarks ? marks.map(e => onLayer(e, layers.mark)) : []), ...(useDims ? dims.map(e => onLayer(e, layers.dim)) : [])];
    ctx.execute({type: 'addMany', entities: list});
    ctx.toast(`그리드 X ${xPos.length}축 × Y ${yPos.length}축 · 전체 ${(xPos.at(-1) - xPos[0]).toLocaleString('ko-KR')} × ${(yPos.at(-1) - yPos[0]).toLocaleString('ko-KR')} mm. Ctrl+Z 로 되돌립니다.`);
   });
  },

  GRIDBUBBLE() {
   const lines = ctx.selected().filter(e => e.type === 'line');
   if (!lines.length) throw Error('GRIDBUBBLE: 기호를 붙일 축선(선)을 선택하세요.');
   return ctx.form(`축선 ${lines.length}개에 번호 기호`, common(), (v) => {
    const opts = read(v);
    if (opts.ends === 'none') return ctx.toast('기호 위치가 "없음"이라 아무것도 하지 않았습니다.');
    const {marks, count} = bubblesForLines(lines, opts);
    const layer = gridLayers(['mark']).mark;
    ctx.execute({type: 'addMany', entities: marks.map(e => onLayer(e, layer))});
    ctx.toast(`축선 ${count}개에 번호 기호를 붙였습니다.`);
   });
  },
 };
}
