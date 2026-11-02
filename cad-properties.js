// AutoCAD 식 객체 특성(색·선종류·선종류 축척·선굵기).
//  - 현재 특성(CECOLOR·CELTYPE·CELTSCALE·CELWEIGHT): 비어 있으면 ByLayer. 새로 만드는 객체에 채운다.
//  - 표준 선종류 표: acadiso.lin 의 이름과 무늬(mm). DXF 저장 때 없는 정의를 채우는 데도 쓴다.
//  - 색 입력 해석: ByLayer · ByBlock · ACI 번호(1~255) · #RRGGBB · "255,0,0".
// 화면에서 무늬 길이는 확대와 상관없이 보이도록 view.js linetypeDashPattern 이 픽셀로 따로 정한다.
import {aciColor, aciOf} from './lisp-host.js';

/** acadiso.lin 표준 선종류. pattern 은 [선, -빈칸, 0(점) …] mm. */
export const STANDARD_LINETYPES = Object.freeze([
 ['CONTINUOUS', '실선', []],
 ['HIDDEN', '숨은선 __ __ __', [6.35, -3.175]],
 ['HIDDEN2', '숨은선 (.5x) _ _ _', [3.175, -1.5875]],
 ['HIDDENX2', '숨은선 (2x) ____ ____', [12.7, -6.35]],
 ['DASHED', '파선 __ __ __', [12.7, -6.35]],
 ['DASHED2', '파선 (.5x) _ _ _', [6.35, -3.175]],
 ['DASHEDX2', '파선 (2x) ____ ____', [25.4, -12.7]],
 ['CENTER', '중심선 ____ _ ____', [31.75, -6.35, 6.35, -6.35]],
 ['CENTER2', '중심선 (.5x) ___ _ ___', [19.05, -3.175, 3.175, -3.175]],
 ['CENTERX2', '중심선 (2x) ________ __', [63.5, -12.7, 12.7, -12.7]],
 ['PHANTOM', '가상선 ____ _ _ ____', [31.75, -6.35, 6.35, -6.35, 6.35, -6.35]],
 ['PHANTOM2', '가상선 (.5x) ___ _ _ ___', [15.875, -3.175, 3.175, -3.175, 3.175, -3.175]],
 ['PHANTOMX2', '가상선 (2x) ________ __ __', [63.5, -12.7, 12.7, -12.7, 12.7, -12.7]],
 ['DOT', '점선 . . . .', [0, -6.35]],
 ['DOT2', '점선 (.5x) ........', [0, -3.175]],
 ['DOTX2', '점선 (2x) .  .  .', [0, -12.7]],
 ['DASHDOT', '일점쇄선 __ . __ .', [12.7, -6.35, 0, -6.35]],
 ['DASHDOT2', '일점쇄선 (.5x) _._._', [6.35, -3.175, 0, -3.175]],
 ['DASHDOTX2', '일점쇄선 (2x) ____  .  ____', [25.4, -12.7, 0, -12.7]],
 ['DIVIDE', '이점쇄선 __ . . __', [12.7, -6.35, 0, -6.35, 0, -6.35]],
 ['DIVIDE2', '이점쇄선 (.5x) _.._.._', [6.35, -3.175, 0, -3.175, 0, -3.175]],
 ['DIVIDEX2', '이점쇄선 (2x) ____  . .  ____', [25.4, -12.7, 0, -12.7, 0, -12.7]],
 ['BORDER', '경계선 __ __ . __ __ .', [12.7, -6.35, 12.7, -6.35, 0, -6.35]],
 ['BORDER2', '경계선 (.5x) _._._.', [6.35, -3.175, 6.35, -3.175, 0, -3.175]],
 ['BORDERX2', '경계선 (2x) ____ ____  .', [25.4, -12.7, 25.4, -12.7, 0, -12.7]],
].map(([name, description, pattern]) => Object.freeze({name, description, pattern: Object.freeze(pattern)})));
const STANDARD_BY_NAME = new Map(STANDARD_LINETYPES.map(l => [l.name, l]));
export const standardLinetype = (name) => STANDARD_BY_NAME.get(String(name || '').toUpperCase()) || null;

const LINETYPE_FAMILY_LABELS = Object.freeze({CONTINUOUS: '실선', HIDDEN: '숨은선', DASHED: '파선', CENTER: '중심선', PHANTOM: '가상선', DOT: '점선', DOTTED: '점선', DASHDOT: '일점쇄선', DIVIDE: '이점쇄선', BORDER: '경계선', BYLAYER: '레이어 따름', BYBLOCK: '블록 따름'});
/** 선종류 한글 이름. 레이어 창의 레이어 선종류와 객체 선종류가 같이 쓴다. 2 = 절반, X2 = 두 배. 모르는 이름은 그대로. */
export function linetypeLabel(value = 'CONTINUOUS') {
 const raw = String(value || 'CONTINUOUS').trim(), key = raw.toUpperCase();
 if (LINETYPE_FAMILY_LABELS[key]) return LINETYPE_FAMILY_LABELS[key];
 const family = key.replace(/(X2|2)$/, ''), label = LINETYPE_FAMILY_LABELS[family];
 if (!label || family === key) return raw;
 return label + (key.endsWith('X2') ? ' (두 배)' : ' (절반)');
}
/** 선종류 모양 글자 견본(목록용). */
export function linetypeSample(value = 'CONTINUOUS') {
 const key = String(value || 'CONTINUOUS').toUpperCase().replace(/(X2|2)$/, '');
 return ({CENTER: '━ · ━', PHANTOM: '━ ·· ━', DOT: '· · ·', DASHDOT: '━ · ━ ·', DIVIDE: '━ ·· ━ ··', BORDER: '━ ━ ·', DASHED: '━  ━  ━', HIDDEN: '━ ━ ━'})[key] || (key.includes('DASH') || key.includes('HIDDEN') ? '━  ━  ━' : '━━━━');
}

/** 선택 목록에 보일 선종류: ByLayer · 표준 · 도면에 이미 쓰인 다른 이름(가져온 DWG). */
export function linetypeChoices(doc) {
 const used = new Set();
 for (const layer of doc?.layers || []) if (layer.linetype) used.add(String(layer.linetype).toUpperCase());
 for (const entity of doc?.entities || []) if (entity.linetype) used.add(String(entity.linetype).toUpperCase());
 const extra = [...used].filter(name => !STANDARD_BY_NAME.has(name) && name !== 'BYLAYER' && name !== 'BYBLOCK').sort();
 return [['BYLAYER', 'ByLayer (레이어 따름)'], ...STANDARD_LINETYPES.map(l => [l.name, `${linetypeLabel(l.name)} · ${l.name}`]), ...extra.map(name => [name, `${name} · 도면 정의`])];
}

export const COLOR_NAMES = Object.freeze({1: '빨강', 2: '노랑', 3: '초록', 4: '하늘', 5: '파랑', 6: '자홍', 7: '흰색/검정', 8: '진회색', 9: '연회색'});

/** 사람이 적은 색을 해석한다. 결과: {mode:'bylayer'} | {mode:'byblock'} | {mode:'aci', aci, color} | {mode:'truecolor', color}. */
export function parseColor(input) {
 const text = String(input ?? '').trim();
 const upper = text.toUpperCase().replace(/\s+/g, '');
 if (!text || ['BYLAYER', 'BL', '레이어', '256'].includes(upper)) return {mode: 'bylayer'};
 if (['BYBLOCK', 'BB', '블록', '0'].includes(upper)) return {mode: 'byblock'};
 if (/^\d{1,3}$/.test(upper)) {
  const aci = Number(upper);
  if (aci < 1 || aci > 255) throw Error('색 번호는 1~255 입니다. ByLayer 는 BYLAYER, ByBlock 은 BYBLOCK 으로 적으세요.');
  return {mode: 'aci', aci, color: aciColor(aci)};
 }
 const hex = text.match(/^#?([0-9a-f]{6})$/i);
 if (hex) return {mode: 'truecolor', color: '#' + hex[1].toLowerCase()};
 const rgb = text.match(/^(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})$/);
 if (rgb) {
  const parts = rgb.slice(1).map(Number);
  if (parts.some(v => v > 255)) throw Error('RGB 값은 0~255 입니다.');
  return {mode: 'truecolor', color: '#' + parts.map(v => v.toString(16).padStart(2, '0')).join('')};
 }
 throw Error(`색을 읽지 못했습니다: "${text}". 번호(1~255), BYLAYER, BYBLOCK, #RRGGBB, R,G,B 중 하나로 적으세요.`);
}

/** 객체에 넣을 색 변경분. ByLayer·ByBlock 은 객체 색을 비운다(엔진 update 는 null 을 '없음'으로 본다). */
export function colorChanges(spec) {
 if (!spec || spec.mode === 'bylayer') return {color: null, aci: null, colorMode: null};
 if (spec.mode === 'byblock') return {color: null, aci: null, colorMode: 'byblock'};
 if (spec.mode === 'aci') return {color: spec.color, aci: spec.aci, colorMode: 'aci'};
 return {color: spec.color, aci: null, colorMode: 'truecolor'};
}

/** 객체 또는 현재 특성의 색을 사람이 읽는 말로. */
export function describeColor(value) {
 if (!value) return 'ByLayer';
 if (value.mode === 'bylayer') return 'ByLayer';
 if (value.mode === 'byblock' || value.colorMode === 'byblock') return 'ByBlock';
 const aci = value.aci ?? (value.colorMode === 'aci' ? aciOf(value.color) : null);
 if (aci) return `${aci}${COLOR_NAMES[aci] ? ' ' + COLOR_NAMES[aci] : ''}`;
 if (value.color) return value.color;
 return 'ByLayer';
}

/** 객체에서 현재 색을 뽑는다(CECOLOR 객체에서 가져오기). */
export function colorOfEntity(entity) {
 if (!entity) return {mode: 'bylayer'};
 if (entity.colorMode === 'byblock') return {mode: 'byblock'};
 if (!entity.color) return {mode: 'bylayer'};
 if (entity.colorMode === 'aci' && entity.aci) return {mode: 'aci', aci: entity.aci, color: entity.color};
 return {mode: 'truecolor', color: entity.color};
}

/** 선종류 입력 해석. 표준이 아니어도 도면에 정의된 이름이면 받는다. */
export function parseLinetype(input, doc) {
 const name = String(input ?? '').trim().toUpperCase();
 if (!name || name === 'BYLAYER' || name === 'BL') return null;
 if (name === 'BYBLOCK') return 'BYBLOCK';
 if (STANDARD_BY_NAME.has(name)) return name;
 if (linetypeChoices(doc).some(([value]) => value === name)) return name;
 throw Error(`선종류 "${input}" 이(가) 없습니다. LINETYPE 목록의 이름을 적으세요.`);
}

export const emptyCurrentProperties = () => ({color: null, linetype: null, linetypeScale: null, lineweight: null});

/** 현재 특성이 모두 ByLayer(기본)인가. */
export const isDefaultCurrent = (current) => !current || (!current.color && !current.linetype && current.linetypeScale == null && current.lineweight == null);

/** 새 객체에 현재 특성을 채운다. 객체가 이미 정한 값(카드가 지정한 색 등)은 덮지 않는다. 새 배열을 돌려준다. */
export function applyCurrentProperties(entities, current) {
 if (isDefaultCurrent(current) || !Array.isArray(entities)) return entities;
 return entities.map(entity => {
  if (!entity || typeof entity !== 'object') return entity;
  const next = {...entity};
  if (current.color && current.color.mode !== 'bylayer' && !next.color && !next.colorMode) Object.assign(next, colorChanges(current.color));
  if (current.linetype && !next.linetype) next.linetype = current.linetype;
  if (current.linetypeScale != null && next.linetypeScale == null) next.linetypeScale = current.linetypeScale;
  if (current.lineweight != null && next.lineweight == null) next.lineweight = current.lineweight;
  for (const key of ['color', 'aci', 'colorMode']) if (next[key] === null) delete next[key];
  return next;
 });
}

/** 선택 객체를 레이어 따름으로 되돌리는 변경분(SETBYLAYER). */
export function byLayerChanges({color = true, linetype = true, lineweight = true, linetypeScale = false} = {}) {
 const changes = {};
 if (color) Object.assign(changes, colorChanges({mode: 'bylayer'}));
 if (linetype) changes.linetype = null;
 if (lineweight) changes.lineweight = null;
 if (linetypeScale) changes.linetypeScale = 1;
 return changes;
}

export const LINEWEIGHTS = Object.freeze([0.05, 0.09, 0.13, 0.15, 0.18, 0.2, 0.25, 0.3, 0.35, 0.4, 0.5, 0.53, 0.6, 0.7, 0.8, 0.9, 1, 1.06, 1.2, 1.4, 1.58, 2, 2.11]);
/** 선굵기 입력: 빈칸·BYLAYER → null, 숫자(mm) → 가장 가까운 표준 값 검사. */
export function parseLineweight(input) {
 const text = String(input ?? '').trim().toUpperCase();
 if (!text || text === 'BYLAYER') return null;
 const n = Number(text);
 if (!Number.isFinite(n) || n < 0 || n > 2.11) throw Error('선굵기는 0~2.11 mm 입니다. 빈칸은 ByLayer.');
 return n;
}
