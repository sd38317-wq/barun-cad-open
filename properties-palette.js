// 객체 속성 편집 창의 항목을 고른다(AutoCAD 특성 팔레트 모양).
// 고른 객체 종류에 맞는 항목만 보여 주고, 실제로 화면·DXF 에 반영되는 값만 고칠 수 있게 한다.
// 여러 종류/여러 값을 고르면 모두에게 해당하는 항목만 보이고, 값이 서로 다르면 칸을 비운다("여러 값").
// 칸을 고치지 않은 항목은 아무것도 바꾸지 않는다.
import {parseColor, colorChanges} from './cad-properties.js';
import {hatchPatternFields, canonicalPatternName,COMMON_HATCH_PATTERNS} from './hatch-patterns.js';
import * as G from './geometry.js';

const round = (n, d) => String(Math.round(n * 10 ** d) / 10 ** d);
const MIXED = '여러 값 (그대로 유지)';
export const NUMBER_DECIMALS = 3;
export const COORD_DECIMALS = 2;

const num = (text, label) => {
 const s = String(text ?? '').trim();
 const n = Number(s);
 if (!s || !Number.isFinite(n)) throw Error(`${label}: 유효한 숫자를 입력하세요.`);
 return n;
};
const positive = (text, label, max = 1e9) => { const n = num(text, label); if (!(n > 0) || n > max) throw Error(`${label}은(는) 0보다 크고 ${max.toLocaleString('en-US')} 이하여야 합니다.`); return n; };
const deg = (rad) => rad * 180 / Math.PI;
const rad = (d) => d * Math.PI / 180;

const pathLength = (points, closed) => { let s = 0; for (let i = 1; i < points.length; i++) s += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y); if (closed && points.length > 2) s += Math.hypot(points[0].x - points.at(-1).x, points[0].y - points.at(-1).y); return s; };
const sweepDegrees = (e) => (((Number(e.endAngle) - Number(e.startAngle)) % 360) + 360) % 360 || 360;
const lineVector = (e) => ({dx: e.points[1].x - e.points[0].x, dy: e.points[1].y - e.points[0].y});
const hatchName = (e) => (e.solid ? 'solid' : e.patternName ? canonicalPatternName(e.patternName) || e.patternName : String(e.pattern || 'lines').toLowerCase());
const hatchScale = (e) => Number(e.patternScale ?? e.hatchScale ?? (Number(e.spacing) > 0 ? Number(e.spacing) / 100 : 1)) || 1;

/** 여러 종류에서도 쓰는 공통 항목 정의는 buildPropertyPalette 안에서 만든다. */
export const PALETTE_TYPES = Object.freeze(['line', 'polyline', 'circle', 'arc', 'text', 'hatch', 'dimension', 'block']);

/**
 * @param es       고른 객체들
 * @param ctx      {layers(잠기지 않은 레이어), linetypes([[값,이름]…]), colorText(e), layerColorOf(e)}
 * @returns {fields, apply(values) → 명령 목록, hasPalette}
 */
export function buildPropertyPalette(es, ctx) {
 const defs = [];
 const single = es.length === 1;
 const kinds = new Set(es.map((e) => e.type));
 const types = (...list) => es.every((e) => list.includes(e.type));
 const add = (def) => { if (def.when === undefined || def.when) defs.push(def); };
 const heading = (text) => defs.push({heading: text});

 /* ── 공통 ── */
 heading('일반');
 add({name: 'color', label: '색', text: (e) => ctx.colorText(e), color: true,
  set: (e, v) => colorChanges(parseColor(v))});
 add({name: 'layer', label: '레이어', options: ctx.layers, text: (e) => e.layer, set: (e, v) => ({layer: v})});
 add({name: 'linetype', label: '선종류', options: ctx.linetypes, text: (e) => (e.linetype ? String(e.linetype).toUpperCase() : 'BYLAYER'),
  set: (e, v) => ({linetype: v === 'BYLAYER' ? null : v})});
 add({name: 'linetypeScale', label: '선종류 축척', number: true, text: (e) => round(e.linetypeScale ?? 1, NUMBER_DECIMALS),
  set: (e, v, x) => ({linetypeScale: positive(v, '선종류 축척', 10000)})});
 add({name: 'lineweight', label: '선굵기 (mm)', number: true, blankOk: true, placeholder: '레이어 따름', text: (e) => (e.lineweight == null ? '' : round(e.lineweight, NUMBER_DECIMALS)),
  set: (e, v) => { if (String(v).trim() === '') return {lineweight: null}; const n = num(v, '선굵기'); if (n < 0 || n > 2.11) throw Error('선굵기는 0~2.11 mm입니다.'); return {lineweight: n}; }});
 // 투명도는 도면에 값이 있을 때만(가져온 DXF 의 440 코드 등). 0~90, 비우면 레이어 따름.
 add({name: 'transparency', label: '투명도', number: true, blankOk: true, placeholder: '레이어 따름', when: es.some((e) => e.transparency != null),
  text: (e) => (e.transparency == null ? '' : round(e.transparency, 0)),
  set: (e, v) => { if (String(v).trim() === '') return {transparency: null}; const n = num(v, '투명도'); if (n < 0 || n > 90) throw Error('투명도는 0~90 입니다.'); return {transparency: n}; }});

 /* ── 해치 ── */
 if (types('hatch')) {
  heading('해치');
  const known = new Set(['solid', 'lines', 'cross', ...COMMON_HATCH_PATTERNS.map(([n]) => n)]);
  const options = [['solid', '단색 채움 · SOLID'], ['lines', '평행선 · 바른 기본'], ['cross', '십자선 · 바른 기본'], ...COMMON_HATCH_PATTERNS.map(([n, t]) => [n, `${t} · ${n}`])];
  for (const e of es) { const n = hatchName(e); if (!known.has(n)) { known.add(n); options.push([n, n]); } }
  const rebuild = (e, _v, x) => {
   const name = x.eff('hatchPattern', e);
   return hatchPatternFields(name, {scale: x.eff('hatchScale', e, true), angle: x.eff('hatchAngle', e, true), origin: e.origin || null});
  };
  add({name: 'hatchPattern', label: '무늬', options, text: hatchName, set: rebuild});
  add({name: 'hatchScale', label: '무늬 축척', number: true, text: (e) => round(hatchScale(e), NUMBER_DECIMALS), disabledFor: (e) => e.solid, set: rebuild, num: (v) => positive(v, '무늬 축척', 100000)});
  add({name: 'hatchAngle', label: '무늬 각도 (도)', number: true, text: (e) => round(Number(e.angle) || 0, NUMBER_DECIMALS), set: rebuild, num: (v) => num(v, '무늬 각도')});
  add({name: 'hatchArea', label: '면적 (㎡)', readonly: true, text: (e) => (Array.isArray(e.points) && e.points.length > 2 && !e.holes && !e.loops ? round(G.polygonArea(e.points) / 1e6, 3) : '')});
  add({name: 'hatchPerimeter', label: '둘레 (mm)', readonly: true, text: (e) => (Array.isArray(e.points) && e.points.length > 2 ? round(pathLength(e.points, true), 1) : '')});
 }

 /* ── 문자 ── */
 if (types('text')) {
  heading('문자');
  if (single) add({name: 'text', label: '내용', textarea: true, text: (e) => e.text ?? '', set: (e, v) => ({text: v})});
  add({name: 'height', label: '높이 (mm)', number: true, text: (e) => round(e.height, NUMBER_DECIMALS), set: (e, v) => ({height: positive(v, '문자 높이')})});
  add({name: 'rotation', label: '회전 (도)', number: true, text: (e) => round(Number(e.rotation) || 0, NUMBER_DECIMALS), set: (e, v) => ({rotation: num(v, '회전')})});
  add({name: 'align', label: '정렬', options: [['left', '왼쪽'], ['center', '가운데'], ['right', '오른쪽']], text: (e) => e.align || 'left', set: (e, v) => ({align: v})});
  add({name: 'widthFactor', label: '폭 비율', number: true, text: (e) => round(e.widthFactor ?? 1, NUMBER_DECIMALS), set: (e, v) => ({widthFactor: positive(v, '폭 비율', 10)})});
  if (single && es[0].textStyle) add({name: 'textStyle', label: '글꼴 스타일', readonly: true, text: (e) => e.textStyle});
 }

 /* ── 선 ── */
 if (types('line') && es.every((e) => e.points?.length >= 2)) {
  heading('선');
  const rebuild = (e, _v, x) => {
   const len = x.eff('lineLength', e, true), ang = x.eff('lineAngle', e, true), a = e.points[0];
   if (!(len > 0)) throw Error('선 길이는 0보다 커야 합니다.');
   return {points: [{...a}, {x: a.x + len * Math.cos(rad(ang)), y: a.y + len * Math.sin(rad(ang))}]};
  };
  add({name: 'lineLength', label: '길이 (mm)', number: true, text: (e) => round(Math.hypot(lineVector(e).dx, lineVector(e).dy), NUMBER_DECIMALS), set: rebuild, num: (v) => positive(v, '선 길이')});
  add({name: 'lineAngle', label: '각도 (도)', number: true, text: (e) => round(deg(Math.atan2(lineVector(e).dy, lineVector(e).dx)), NUMBER_DECIMALS), set: rebuild, num: (v) => num(v, '선 각도')});
 }

 /* ── 폴리선 ── */
 if (types('polyline') && es.every((e) => e.points?.length >= 2)) {
  heading('폴리선');
  add({name: 'closed', label: '닫힘', options: [['no', '열림'], ['yes', '닫힘']], text: (e) => (e.closed ? 'yes' : 'no'), set: (e, v) => ({closed: v === 'yes'})});
  add({name: 'constantWidth', label: '전체 폭 (mm)', number: true, blankOk: true, placeholder: '0 = 가는 선', text: (e) => round(e.constantWidth || 0, NUMBER_DECIMALS), set: (e, v) => { const n = num(v, '전체 폭'); if (n < 0) throw Error('전체 폭은 0 이상이어야 합니다.'); return {constantWidth: n}; }});
  add({name: 'vertexCount', label: '정점 수', readonly: true, text: (e) => String(e.points.length)});
  add({name: 'polyLength', label: '길이 (mm)', readonly: true, text: (e) => round(pathLength(e.points, e.closed), 1)});
  add({name: 'polyArea', label: '면적 (㎡)', readonly: true, text: (e) => (e.closed && e.points.length > 2 ? round(G.polygonArea(e.points) / 1e6, 3) : '')});
 }

 /* ── 원 · 호 ── */
 if (types('circle', 'arc') && es.every((e) => Number(e.radius) > 0)) {
  heading(types('circle') ? '원' : types('arc') ? '호' : '원·호');
  add({name: 'radius', label: '반지름 (mm)', number: true, text: (e) => round(e.radius, NUMBER_DECIMALS), set: (e, v) => ({radius: positive(v, '반지름')})});
  add({name: 'diameter', label: '지름 (mm)', readonly: true, text: (e) => round(e.radius * 2, NUMBER_DECIMALS)});
  if (types('arc')) {
   add({name: 'startAngle', label: '시작 각도 (도)', number: true, text: (e) => round(e.startAngle, NUMBER_DECIMALS), set: (e, v) => ({startAngle: num(v, '시작 각도')})});
   add({name: 'endAngle', label: '끝 각도 (도)', number: true, text: (e) => round(e.endAngle, NUMBER_DECIMALS), set: (e, v) => ({endAngle: num(v, '끝 각도')})});
   add({name: 'arcLength', label: '호 길이 (mm)', readonly: true, text: (e) => round(e.radius * rad(sweepDegrees(e)), 1)});
  } else {
   add({name: 'circumference', label: '둘레 (mm)', readonly: true, text: (e) => round(2 * Math.PI * e.radius, 1)});
   add({name: 'circleArea', label: '면적 (㎡)', readonly: true, text: (e) => round(Math.PI * e.radius ** 2 / 1e6, 3)});
  }
 }

 /* ── 치수 ── */
 if (types('dimension')) {
  heading('치수');
  const measure = (e) => {
   const [a, b] = e.points || [];
   if (!a || !b) return '';
   const mode = e.mode || 'aligned';
   if (mode === 'horizontal') return round(Math.abs(b.x - a.x), 1);
   if (mode === 'vertical') return round(Math.abs(b.y - a.y), 1);
   if (mode === 'radius') return round(Math.hypot(b.x - a.x, b.y - a.y), 1);
   if (mode === 'diameter') return round(2 * Math.hypot(b.x - a.x, b.y - a.y), 1);
   if (mode === 'aligned') return round(Math.hypot(b.x - a.x, b.y - a.y), 1);
   return '';
  };
  add({name: 'measure', label: '측정값', readonly: true, text: measure});
  add({name: 'dimText', label: '문자 재지정', placeholder: '비우면 자동', blankOk: true, text: (e) => e.text || '', set: (e, v) => ({text: v})});
  add({name: 'textHeight', label: '문자 높이 (mm)', number: true, text: (e) => round(e.textHeight ?? 150, NUMBER_DECIMALS), set: (e, v) => ({textHeight: positive(v, '치수 문자 높이')})});
  add({name: 'arrowSize', label: '화살표 크기 (mm)', number: true, blankOk: true, placeholder: '문자 높이 따름', text: (e) => (e.arrowSize ? round(e.arrowSize, NUMBER_DECIMALS) : ''),
   set: (e, v) => (String(v).trim() === '' ? {arrowSize: null} : {arrowSize: positive(v, '화살표 크기')})});
 }

 /* ── 블록 ── */
 if (types('block')) {
  heading('블록');
  add({name: 'blockName', label: '블록 이름', readonly: true, text: (e) => e.sharedBlock || e.name || ''});
  if (es.every((e) => e.sharedBlock)) {
   add({name: 'blockScale', label: '배율', number: true, text: (e) => round(Number(e.scale) || 1, NUMBER_DECIMALS), set: (e, v) => ({scale: positive(v, '블록 배율', 100000)})});
   add({name: 'blockRotation', label: '회전 (도)', number: true, text: (e) => round(Number(e.rotation) || 0, NUMBER_DECIMALS), set: (e, v) => ({rotation: num(v, '블록 회전')})});
  } else {
   // 공유 정의가 아닌(풀어 넣은) 블록은 배율·회전이 모양에 이미 들어가 있어 보기만 한다.
   add({name: 'blockScale', label: '배율', readonly: true, text: (e) => round(Number(e.scale) || 1, NUMBER_DECIMALS)});
   add({name: 'blockRotation', label: '회전 (도)', readonly: true, text: (e) => round(Number(e.rotation) || 0, NUMBER_DECIMALS)});
  }
 }

 /* ── 다른 종류(벽·타원·점 …): 예전 숫자 항목 그대로 ── */
 if (!types(...PALETTE_TYPES)) {
  const legacy = [['radius', '반지름'], ['height', '높이'], ['thickness', '벽 두께'], ['spacing', '간격']];
  const extra = legacy.filter(([k]) => es.every((e) => e[k] !== undefined));
  if (extra.length) heading('기타');
  for (const [k, label] of extra) add({name: k, label, number: true, text: (e) => round(e[k], NUMBER_DECIMALS), set: (e, v) => ({[k]: positive(v, label)})});
 }

 /* ── 고급: 좌표(둥글게 보여 주고, 고치지 않으면 손대지 않는다) ── */
 const hasAdvanced = single;
 const e0 = es[0];
 if (hasAdvanced) {
  if (e0.type === 'line' && e0.points?.length >= 2) {
   heading('고급 · 위치');
   for (const [i, word] of [[0, '시작'], [1, '끝']]) for (const axis of ['x', 'y']) {
    add({name: `pt${i}${axis}`, label: `${word}점 ${axis.toUpperCase()}`, number: true, decimals: COORD_DECIMALS, text: (e) => round(e.points[i][axis], COORD_DECIMALS),
     set: (e, v, x) => ({points: e.points.map((p, k) => (k === i ? {...p, [axis]: num(v, `${word}점 ${axis.toUpperCase()}`)} : {...p}))})});
   }
  } else {
   const p = e0.center || e0.position || e0.points?.[0];
   if (p) {
    heading('고급 · 위치');
    add({name: 'x', label: e0.center ? '중심 X' : '기준점 X', number: true, position: 'x', text: () => round(p.x, COORD_DECIMALS)});
    add({name: 'y', label: e0.center ? '중심 Y' : '기준점 Y', number: true, position: 'y', text: () => round(p.y, COORD_DECIMALS)});
   }
  }
 }
 // 고급 항목은 "고급" 접이식 묶음으로 보낸다(제목부터).
 let inAdvanced = false;
 for (const d of defs) { if (d.heading?.startsWith('고급')) inAdvanced = true; if (inAdvanced) d.advanced = true; }

 /* ── 창에 줄 항목 만들기 ── */
 const fields = [], meta = new Map();
 for (const d of defs) {
  if (d.heading) { fields.push({heading: d.heading.replace(/^고급 · /, ''), advanced: d.advanced, name: undefined}); continue; }
  const texts = es.map((e) => d.text(e));
  const mixed = texts.some((t) => t !== texts[0]);
  const field = {name: d.name, label: d.label, advanced: d.advanced, readonly: d.readonly, value: mixed ? '' : texts[0], mixed};
  if (d.options) {
   field.options = mixed ? [['', MIXED], ...d.options] : [...d.options];
   if (!mixed && !field.options.some(([v]) => v === texts[0])) field.options.push([texts[0], d.name === 'layer' ? (ctx.layerName?.(texts[0]) || texts[0]) : texts[0]]);
  }
  if (d.textarea) field.type = 'textarea'; else if (d.number && !d.options) field.type = 'number';
  if (mixed) field.placeholder = MIXED; else if (d.placeholder) field.placeholder = d.placeholder;
  if (d.readonly && mixed) field.value = '';
  fields.push(field);
  meta.set(d.name, {def: d, initial: field.value, mixed, texts});
 }

 /** 창 값 → 명령. 고친 항목만 바꾸고, 전체가 한 번의 batch(되돌리기 한 번)다. */
 function commands(values) {
  const changed = new Map();
  for (const [name, m] of meta) {
   if (m.def.readonly) continue;
   const raw = values[name];
   if (raw === undefined) continue;
   const now = m.def.textarea ? String(raw) : String(raw).trim();
   if (m.mixed && now === '') continue;
   if (now === m.initial) continue;
   changed.set(name, now);
  }
  const eff = (name, e, numeric = false) => {
   const m = meta.get(name);
   const raw = changed.has(name) ? changed.get(name) : m.def.text(e);
   if (!numeric) return raw;
   return changed.has(name) ? m.def.num(raw) : Number(raw);
  };
  const x = {eff, changed};
  const out = [], updates = [];
  for (const e of es) {
   const changes = {};
   for (const [name, raw] of changed) {
    const d = meta.get(name).def;
    if (d.position) continue;
    if (d.disabledFor?.(e)) continue;
    // 무늬 축척·각도가 단색 해치에서는 뜻이 없으니 건너뛴다(무늬 이름 바꿈은 아래에서 다시 만든다).
    Object.assign(changes, d.set(e, raw, x));
   }
   if (Object.keys(changes).length) updates.push({id: e.id, changes});
  }
  if (updates.length) out.push({type: 'updateMany', updates});
  if (single && (changed.has('x') || changed.has('y'))) {
   const p = e0.center || e0.position || e0.points[0];
   out.push({type: 'move', ids: [e0.id], dx: changed.has('x') ? num(changed.get('x'), '기준점 X') - p.x : 0, dy: changed.has('y') ? num(changed.get('y'), '기준점 Y') - p.y : 0});
  }
  return out;
 }

 return {fields, commands, meta};
}
