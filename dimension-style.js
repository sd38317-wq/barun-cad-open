// Pure helpers for dimension-style management.  The drawing/UI layers can
// compose these helpers without having to know how styles are persisted.

export const DIM_STYLE_DEFAULTS = Object.freeze({
  textHeight: 150,
  precision: 2,
  arrowSize: 150,
  extensionOffset: 50,
  extensionOvershoot: 50,
  dimensionLineOffset: 0,
  textGap: 30,
  textColor: null,
  lineColor: null,
  arrowType: 'closed-filled',
  unit: 'decimal',
  scale: 1,
});

const NUMBER_FIELDS = new Set(Object.keys(DIM_STYLE_DEFAULTS).filter((key) =>
  !['textColor', 'lineColor', 'arrowType', 'unit'].includes(key)));
const STRING_FIELDS = new Set(['textColor', 'lineColor', 'arrowType', 'unit']);

function clone(value) {
  return structuredClone(value);
}

function assertName(name) {
  if (typeof name !== 'string' || !name.trim()) throw new TypeError('Dimension style name must be a non-empty string');
  return name.trim();
}

function assertStyleValues(values) {
  if (values == null || typeof values !== 'object' || Array.isArray(values)) throw new TypeError('Dimension style must be an object');
  for (const [key, value] of Object.entries(values)) {
    if (!NUMBER_FIELDS.has(key) && !STRING_FIELDS.has(key)) continue;
    if (NUMBER_FIELDS.has(key) && (!Number.isFinite(value) || value < 0)) throw new TypeError(`${key} must be a non-negative finite number`);
    if (STRING_FIELDS.has(key) && value !== null && typeof value !== 'string') throw new TypeError(`${key} must be a string or null`);
  }
}

export function normalizeDimStyle(name, values = {}) {
  const styleName = assertName(name);
  assertStyleValues(values);
  assertDimStyleExtras(values);
  return { name: styleName, ...DIM_STYLE_DEFAULTS, ...clone(values) };
}

export function normalizeDimStyles(document = {}) {
  if (document == null || typeof document !== 'object' || Array.isArray(document)) throw new TypeError('Drawing document must be an object');
  const source = document.dimStyles;
  const entries = Array.isArray(source)
    ? source.map((style) => [style?.name, style])
    : Object.entries(source && typeof source === 'object' ? source : {});
  const styles = {};
  for (const [key, value] of entries) {
    const name = value?.name ?? key;
    if (typeof name !== 'string' || !name.trim()) continue;
    styles[name.trim()] = normalizeDimStyle(name, value || {});
  }
  if (!styles.STANDARD) styles.STANDARD = normalizeDimStyle('STANDARD');
  const current = typeof document.currentDimStyle === 'string' && styles[document.currentDimStyle]
    ? document.currentDimStyle : 'STANDARD';
  return { dimStyles: styles, currentDimStyle: current };
}

export function createDimStyle(document, name, values = {}) {
  const normalized = normalizeDimStyles(document);
  const styleName = assertName(name);
  if (normalized.dimStyles[styleName]) throw new Error(`Dimension style already exists: ${styleName}`);
  return { ...clone(document), dimStyles: { ...normalized.dimStyles, [styleName]: normalizeDimStyle(styleName, values) }, currentDimStyle: normalized.currentDimStyle };
}

export function updateDimStyle(document, name, values = {}) {
  const normalized = normalizeDimStyles(document);
  const styleName = assertName(name);
  if (!normalized.dimStyles[styleName]) throw new Error(`Unknown dimension style: ${styleName}`);
  assertStyleValues(values);
  return { ...clone(document), dimStyles: { ...normalized.dimStyles, [styleName]: normalizeDimStyle(styleName, { ...normalized.dimStyles[styleName], ...values }) }, currentDimStyle: normalized.currentDimStyle };
}

export function deleteDimStyle(document, name) {
  const normalized = normalizeDimStyles(document);
  const styleName = assertName(name);
  if (styleName === 'STANDARD') throw new Error('The STANDARD dimension style cannot be deleted');
  if (!normalized.dimStyles[styleName]) throw new Error(`Unknown dimension style: ${styleName}`);
  const styles = { ...normalized.dimStyles };
  delete styles[styleName];
  return { ...clone(document), dimStyles: styles, currentDimStyle: normalized.currentDimStyle === styleName ? 'STANDARD' : normalized.currentDimStyle };
}

export function setCurrentDimStyle(document, name) {
  const normalized = normalizeDimStyles(document);
  const styleName = assertName(name);
  if (!normalized.dimStyles[styleName]) throw new Error(`Unknown dimension style: ${styleName}`);
  return { ...clone(document), dimStyles: normalized.dimStyles, currentDimStyle: styleName };
}

export function getDimStyle(document, name = undefined) {
  const normalized = normalizeDimStyles(document);
  const styleName = name === undefined ? normalized.currentDimStyle : assertName(name);
  return normalized.dimStyles[styleName] ? clone(normalized.dimStyles[styleName]) : null;
}

// Applies style values to one dimension without overwriting explicit per-object
// overrides. Returns a new entity and never mutates either input.
export function applyDimStyle(dimension, style, { overwrite = false } = {}) {
  if (dimension == null || typeof dimension !== 'object' || Array.isArray(dimension)) throw new TypeError('Dimension must be an object');
  const normalized = typeof style === 'string' ? normalizeDimStyle(style) : normalizeDimStyle(style?.name || 'STANDARD', style || {});
  const result = clone(dimension);
  for (const key of Object.keys(DIM_STYLE_DEFAULTS)) {
    if (overwrite || result[key] === undefined) result[key] = normalized[key];
  }
  // 515: 스타일이 정한 새 값(문자 위치·소수점·0 생략 등)만 채운다. 정하지 않은 스타일의 치수 모양은 그대로다.
  for (const key of EXTRA_KEYS) {
    if (normalized[key] !== undefined && (overwrite || result[key] === undefined)) result[key] = clone(normalized[key]);
  }
  result.dimStyle = normalized.name;
  return result;
}

// 용도별 치수 프리셋(훈민캐드 대조 기반 H52 · 훈민 DD1/DD2). 값은 "용지 mm" 이라 축척을 곱해 도면 단위로 바꾼다.
export const DIM_PRESETS = Object.freeze({
  general: Object.freeze({ label: '일반도 (평면·입면·단면)', textHeight: 2.5, arrowSize: 1.25, extensionOffset: 1, extensionOvershoot: 1.25, textGap: 0.6, precision: 0, arrowType: 'tick' }),
  structure: Object.freeze({ label: '구조도 (작은 글씨·촘촘한 치수)', textHeight: 2, arrowSize: 1, extensionOffset: 0.6, extensionOvershoot: 1, textGap: 0.5, precision: 0, arrowType: 'tick' }),
  detail: Object.freeze({ label: '상세도 (큰 글씨·화살표)', textHeight: 3, arrowSize: 2, extensionOffset: 1, extensionOvershoot: 1.5, textGap: 0.8, precision: 0, arrowType: 'tick' }),
});

/** 프리셋 × 축척 → 치수 스타일 값. */
export function dimPresetValues(preset, scale = 100) {
  const base = DIM_PRESETS[preset];
  if (!base) throw new Error(`Unknown dimension preset: ${preset}`);
  if (!(Number(scale) > 0)) throw new TypeError('scale must be positive');
  const s = Number(scale), round = (v) => Math.round(v * s * 1000) / 1000;
  return { textHeight: round(base.textHeight), arrowSize: round(base.arrowSize), extensionOffset: round(base.extensionOffset), extensionOvershoot: round(base.extensionOvershoot), textGap: round(base.textGap), precision: base.precision, arrowType: base.arrowType, scale: 1 };
}

/* ── ACAD200 515: AutoCAD 치수 변수 대응·재정의 분리·하위 스타일 ──
   AutoCAD 는 치수에 스타일 이름만 두고, 객체별 차이는 재정의(DSTYLE xdata)로 따로 둔다. 그래서 스타일을 고치면 재정의가 없는
   값은 모든 치수에 퍼진다. 우리 치수는 그릴 때·내보낼 때 쓰는 값을 객체에 바로 들고 있다(geometry.js·exchange 가 그 값을 읽는다).
   그 구조는 그대로 두고, 어떤 값이 "사용자가 이 치수만 바꾼 값"인지를 dim.overrides 에 따로 적는다.
   resolveDimStyle 이 스타일(+하위 스타일)+재정의를 합치고, restyleDimension 이 그 결과를 객체 값에 다시 써 준다
   → 스타일을 바꾸면 재정의하지 않은 값만 따라 바뀐다. 예전 치수(overrides 없음)는 migrateDimOverrides 가 스타일과 다른 값만 재정의로 옮긴다. */

/** AutoCAD 치수 변수 → 우리 스타일 키(DXF 왕복용). */
export const DIMVAR_MAP = Object.freeze({
  DIMTXT: 'textHeight', DIMASZ: 'arrowSize', DIMEXO: 'extensionOffset', DIMEXE: 'extensionOvershoot', DIMDLI: 'baselineSpacing',
  DIMGAP: 'textGap', DIMTAD: 'textVertical', DIMTIH: 'textInsideHorizontal', DIMTOH: 'textOutsideHorizontal', DIMDEC: 'precision',
  DIMDSEP: 'decimalSeparator', DIMZIN: 'zeroSuppress', DIMRND: 'round', DIMPOST: 'textTemplate', DIMSCALE: 'scale', DIMTFILL: 'textFill',
  DIMLFAC: 'measurementScale', DIMCLRT: 'textColor', DIMCLRD: 'lineColor', DIMBLK: 'arrowType', DIMLUNIT: 'unit',
});
/** 새로 다루는 값의 기본(지금 그리는 모양과 같다: 문자 위, 소수점 '.', 끝 0 생략, 반올림 없음). ISO-25 의 DIMDLI/DIMTXT=1.5 비율. */
export const DIM_STYLE_EXTRA_DEFAULTS = Object.freeze({
  baselineSpacing: 225, textVertical: 1, textInsideHorizontal: 0, textOutsideHorizontal: 0,
  decimalSeparator: '.', zeroSuppress: 8, round: 0, textTemplate: '', textFill: 0, measurementScale: 1,
});
export const DIM_STYLE_DEFAULTS_ISO = Object.freeze({ ...DIM_STYLE_DEFAULTS, ...DIM_STYLE_EXTRA_DEFAULTS });
const EXTRA_KEYS = Object.keys(DIM_STYLE_EXTRA_DEFAULTS);
export const DIM_STYLE_KEYS = Object.freeze(Object.keys(DIM_STYLE_DEFAULTS_ISO));

const EXTRA_RULES = {
  baselineSpacing: (v) => Number.isFinite(v) && v >= 0,
  textVertical: (v) => [0, 1, 2, 3, 4].includes(v),
  textInsideHorizontal: (v) => v === 0 || v === 1,
  textOutsideHorizontal: (v) => v === 0 || v === 1,
  decimalSeparator: (v) => typeof v === 'string' && v.length === 1,
  zeroSuppress: (v) => Number.isInteger(v) && v >= 0 && v <= 15,
  round: (v) => Number.isFinite(v) && v >= 0,
  textTemplate: (v) => typeof v === 'string',
  textFill: (v) => v === 0 || v === 1 || v === 2,
  measurementScale: (v) => Number.isFinite(v) && v > 0,
};
/** 새 값 검사. 틀린 값이 있으면 무엇이 틀렸는지 알린다. */
export function assertDimStyleExtras(values) {
  for (const key of EXTRA_KEYS) {
    if (values?.[key] === undefined) continue;
    if (!EXTRA_RULES[key](values[key])) throw new TypeError(`치수 스타일 값이 올바르지 않습니다: ${key}=${JSON.stringify(values[key])}`);
  }
}

/** 하위 스타일 접미사(AutoCAD: 이름$2 각도, $3 지름, $4 반지름, $6 좌표). */
const CHILD_SUFFIX = Object.freeze({ angular: '$2', diameter: '$3', radius: '$4', ordinateX: '$6', ordinateY: '$6' });
export function childStyleName(name, mode) {
  return CHILD_SUFFIX[mode] ? `${name}${CHILD_SUFFIX[mode]}` : null;
}
const stylesOf = (document) => normalizeDimStyles(document && typeof document === 'object' ? document : {}).dimStyles;
const baseName = (name) => String(name || '').replace(/\$\d$/, '');
const parentOf = (document, styles, dim) => {
  const name = baseName(dim.dimStyle) || (typeof document?.currentDimStyle === 'string' ? document.currentDimStyle : 'STANDARD');
  const base = styles[name] || styles.STANDARD;
  return { base, child: styles[childStyleName(base.name, dim.mode)] || {} };
};

/**
 * 치수 하나에 실제로 쓸 값: 기본 ← 스타일 ← 하위 스타일(종류별) ← 재정의.
 * 재정의 키의 값은 객체에 있는 값을 쓴다(축척·대칭 같은 변환이 객체 값을 같이 바꾸므로). 객체에 없으면 overrides 의 값.
 */
export function resolveDimStyle(document, dim = {}) {
  const { base, child } = parentOf(document, stylesOf(document), dim);
  const resolved = { ...DIM_STYLE_DEFAULTS_ISO, ...base, ...child };
  delete resolved.name;
  for (const [key, value] of Object.entries(dim.overrides || {})) {
    if (!(key in DIM_STYLE_DEFAULTS_ISO)) continue;
    resolved[key] = dim[key] !== undefined ? dim[key] : value;
  }
  return { ...resolved, dimStyle: base.name };
}

/** 예전 치수(overrides 없음): 스타일과 다른 값만 재정의로 적는다. 객체의 값은 그대로 둔다(그리기·내보내기가 읽는다). */
export function migrateDimOverrides(dim, style) {
  if (dim?.overrides && typeof dim.overrides === 'object') return dim;
  const reference = { ...DIM_STYLE_DEFAULTS_ISO, ...(style || {}) }, overrides = {};
  for (const key of DIM_STYLE_KEYS) {
    if (dim[key] === undefined) continue;
    if (JSON.stringify(dim[key]) !== JSON.stringify(reference[key])) overrides[key] = structuredClone(dim[key]);
  }
  return { ...dim, overrides };
}

/** 이 치수만의 값으로 정한다(DIMOVERRIDE). 스타일 값으로 되돌리려면 clearDimOverrides. */
export function setDimOverrides(dim, values) {
  assertStyleValues(values); assertDimStyleExtras(values);
  const overrides = { ...(dim.overrides || {}) };
  for (const [key, value] of Object.entries(values)) if (key in DIM_STYLE_DEFAULTS_ISO) overrides[key] = structuredClone(value);
  return { ...dim, ...structuredClone(values), overrides };
}
export function clearDimOverrides(dim, keys = null) {
  const overrides = { ...(dim.overrides || {}) };
  for (const key of keys || Object.keys(overrides)) delete overrides[key];
  return { ...dim, overrides };
}

/**
 * 스타일을 고친 뒤 치수에 다시 써 줄 값(update changes). 재정의한 값은 건드리지 않는다.
 * 새 값(문자 위치·소수점 등)은 스타일이 정했거나 치수가 이미 가진 것만 쓴다 — 그 밖의 예전 치수 모양은 바뀌지 않는다.
 * previous: 스타일을 고치기 전 도면. 예전 치수(overrides 없음)는 고치기 전 스타일과 견줘야 재정의를 바르게 가린다.
 */
export function restyleDimension(document, dim, previous = document) {
  const { base, child } = parentOf(document, stylesOf(document), dim);
  const old = parentOf(previous, stylesOf(previous), dim);
  const migrated = migrateDimOverrides(dim, { ...old.base, ...old.child });
  const resolved = resolveDimStyle(document, migrated), changes = {};
  for (const key of DIM_STYLE_KEYS) {
    if (key in migrated.overrides) continue;
    const explicit = !EXTRA_KEYS.includes(key) || base[key] !== undefined || child[key] !== undefined || dim[key] !== undefined;
    if (explicit && JSON.stringify(dim[key]) !== JSON.stringify(resolved[key])) changes[key] = structuredClone(resolved[key]);
  }
  if (!dim.overrides) changes.overrides = migrated.overrides;
  if (dim.dimStyle !== resolved.dimStyle) changes.dimStyle = resolved.dimStyle;
  return changes;
}
/** 스타일 이름이 같은 치수 전부에 restyleDimension. 바뀌는 것만 돌려준다(엔진 updateMany 그대로). */
export function restyleDimensions(document, entities, styleName = null, previous = document) {
  const updates = [];
  for (const e of entities || []) {
    if (e?.type !== 'dimension') continue;
    if (styleName && baseName(e.dimStyle || 'STANDARD') !== styleName) continue;
    const changes = restyleDimension(document, e, previous);
    if (Object.keys(changes).length) updates.push({ id: e.id, changes });
  }
  return updates;
}

/* DXF 왕복: 화살표 이름과 변수 값 바꾸기(exchange 가 쓰도록 순수 함수로 둔다). */
const ARROW_BLOCKS = Object.freeze({ 'closed-filled': '', closed: 'CLOSEDBLANK', open: 'OPEN', dot: 'DOT', tick: 'ARCHTICK', oblique: 'OBLIQUE' });
const UNIT_CODES = Object.freeze({ scientific: 1, decimal: 2, engineering: 3, architectural: 4, fractional: 5 });
export function dimVarsToStyle(vars = {}) {
  const out = {};
  for (const [name, key] of Object.entries(DIMVAR_MAP)) {
    if (vars[name] === undefined || vars[name] === null) continue;
    let value = vars[name];
    if (key === 'arrowType') { const block = String(value).replace(/^_/, '').toUpperCase(); value = Object.keys(ARROW_BLOCKS).find((k) => ARROW_BLOCKS[k] === block) || 'closed-filled'; }
    else if (key === 'unit') value = Object.keys(UNIT_CODES).find((k) => UNIT_CODES[k] === Number(value)) || 'decimal';
    else if (key === 'decimalSeparator') value = typeof value === 'number' ? String.fromCharCode(value) : String(value);
    else if (!['textTemplate', 'textColor', 'lineColor'].includes(key)) value = Number(value);
    out[key] = value;
  }
  return out;
}
export function styleToDimVars(style = {}) {
  const out = {};
  for (const [name, key] of Object.entries(DIMVAR_MAP)) {
    if (style[key] === undefined || style[key] === null) continue;
    let value = style[key];
    if (key === 'arrowType') value = ARROW_BLOCKS[value === 'architectural-tick' ? 'tick' : value] ?? '';
    else if (key === 'unit') value = UNIT_CODES[value] ?? 2;
    out[name] = value;
  }
  return out;
}
