// 509 문자 스타일 표(doc.textStyles) — AutoCAD STYLE 기록처럼 글꼴·빅폰트·고정 높이·폭 비율·기울기를 스타일에 둔다.
// AutoCAD: 문자는 스타일 이름만 갖고 글꼴은 늘 스타일에서 온다(폭 비율·기울기는 만들 때 복사).
// 바른 CAD: 표를 기준으로 삼되, 그리기는 지금처럼 문자 객체의 값(sourceFont 등)을 그대로 읽는다(그리기 비용 0).
// 스타일을 바꾸면 "그 스타일 값을 따르던 문자"만 고치고, 사용자가 따로 바꾼 값(재정의)은 지킨다.
// 바꾸기는 표 + 문자를 한 명령(batch)으로 해서 Ctrl+Z 한 번에 같이 돌아온다. DXF 로 쓸 때 표가 STYLE 기록이 된다.

export const STANDARD_STYLE = Object.freeze({font: 'malgun.ttf', bigFont: '', height: 0, widthFactor: 1, oblique: 0});
const KEYS = ['font', 'bigFont', 'height', 'widthFactor', 'oblique'];
/** 스타일 값 ↔ 문자 객체 값. 높이(0 = 고정 안 함)는 문자 높이와 이름이 같다. */
const FIELD = {font: 'sourceFont', bigFont: 'sourceBigFont', height: 'height', widthFactor: 'widthFactor', oblique: 'oblique'};
const DEFAULT_OF = {font: '', bigFont: '', height: 0, widthFactor: 1, oblique: 0};

export const styleNameOf = e => e?.textStyle || 'Standard';
const visitTexts = (entities, fn) => {
 for (const e of entities || []) {
  if (e?.type === 'text') fn(e);
  else if (e?.type === 'block' && !e.sharedBlock && !e.xref) visitTexts(e.entities, fn);
 }
};

/** 한 스타일 값 정리(잘못된 수는 기본값). */
export function cleanStyle(s = {}) {
 const n = (v, d, lo, hi) => { const x = Number(v); return Number.isFinite(x) && x >= lo && x <= hi ? x : d; };
 return {font: String(s.font ?? STANDARD_STYLE.font).trim(), bigFont: String(s.bigFont ?? '').trim(), height: n(s.height, 0, 0, 1e9),
  widthFactor: n(s.widthFactor, 1, 0.01, 100), oblique: n(s.oblique, 0, -85, 85)};
}

/**
 * 도면의 스타일 표. doc.textStyles 가 있으면 그것을, 없는 이름은 그 스타일 문자들 중 가장 많이 쓴 글꼴로 만든다(예전 도면 이전).
 * 도면을 한 번 훑는다 — 열 때·STYLE 명령 때만 부른다(매 프레임 금지).
 */
export function normalizeTextStyles(doc) {
 const styles = {};
 for (const [name, s] of Object.entries(doc?.textStyles || {})) if (name) styles[name] = cleanStyle(s);
 const votes = new Map();
 visitTexts(doc?.entities, e => {
  const name = styleNameOf(e); if (styles[name]) return;
  const key = JSON.stringify([e.sourceFont || '', e.sourceBigFont || '', e.widthFactor ?? 1, e.oblique ?? 0]);
  const m = votes.get(name) || new Map(); m.set(key, (m.get(key) || 0) + 1); votes.set(name, m);
 });
 for (const [name, m] of votes) {
  const [font, bigFont, widthFactor, oblique] = JSON.parse([...m].sort((a, b) => b[1] - a[1])[0][0]);
  styles[name] = cleanStyle({font: font || STANDARD_STYLE.font, bigFont, widthFactor, oblique});
 }
 styles.Standard ??= {...STANDARD_STYLE};
 return styles;
}

/** 문자 하나에 실제로 쓰는 값(객체 값 = 재정의, 없으면 스타일). */
export function resolveTextStyle(styles, e) {
 const s = styles?.[styleNameOf(e)] || STANDARD_STYLE;
 return {font: e?.sourceFont || s.font, bigFont: e?.sourceBigFont ?? s.bigFont, widthFactor: e?.widthFactor ?? s.widthFactor,
  oblique: e?.oblique ?? s.oblique, height: e?.height || s.height || 2.5};
}

const same = (a, b) => typeof a === 'number' || typeof b === 'number' ? Math.abs((Number(a) || 0) - (Number(b) || 0)) < 1e-9 : String(a ?? '') === String(b ?? '');
/** 문자 값이 옛 스타일 값을 그대로 따르고 있었는지(값이 없으면 따른 것으로 본다). */
const follows = (e, key, old) => {
 const field = FIELD[key], v = e[field];
 if (key === 'height') return !old.height || same(v, old.height);   // 고정 높이가 없던 스타일은 높이를 강요하지 않는다
 if (v === undefined || v === null || v === '') return same(DEFAULT_OF[key], old[key]) || key === 'font';
 return same(v, old[key]);
};

/**
 * 스타일 바꾸기 계획. 글꼴은 AutoCAD 처럼 그 스타일 문자 전부(글꼴은 스타일의 것), 폭 비율·기울기·고정 높이는
 * 옛 스타일 값을 따르던 문자만 바꾼다. 잠긴 레이어 문자는 건너뛴다.
 * @returns {{command, count, skipped, styles}} command 는 engine.execute 에 바로 넣는다(batch: 표 + 문자).
 */
export function planTextStyleUpdate(doc, name, changes, {writable = () => true} = {}) {
 if (!name || /[<>/\\":;?*|=]/.test(name)) throw Error('스타일 이름에 < > / \\ " : ; ? * | = 는 쓸 수 없습니다.');
 const styles = normalizeTextStyles(doc), old = styles[name] || {...STANDARD_STYLE};
 const next = cleanStyle({...old, ...changes});
 const changedKeys = KEYS.filter(k => !same(old[k], next[k]));
 const textChanges = e => {
  const out = {};
  for (const k of changedKeys) if (k === 'font' || k === 'bigFont' || follows(e, k, old)) out[FIELD[k]] = next[k];
  if (out.height === 0) delete out.height;   // 고정 높이를 풀면 문자 높이는 그대로
  return out;
 };
 const updates = []; let count = 0, skipped = 0;
 const restyle = e => {
  if (e.type === 'text') {
   if (styleNameOf(e) !== name) return e;
   if (!writable(e)) { skipped++; return e; }
   const c = textChanges(e); if (!Object.keys(c).length) return e;
   count++; return {...e, ...c};
  }
  if (e.type !== 'block' || e.sharedBlock || e.xref || !e.entities) return e;
  let changed = false;
  const entities = e.entities.map(child => { const n = restyle(child); if (n !== child) changed = true; return n; });
  return changed ? {...e, entities} : e;
 };
 if (changedKeys.length) for (const e of doc?.entities || []) {
  if (e.type === 'block' && !writable(e)) continue;
  const n = restyle(e); if (n === e) continue;
  updates.push({id: e.id, changes: e.type === 'text' ? textChanges(e) : {entities: n.entities}});
 }
 const table = {...styles, [name]: next};
 const commands = [{type: 'document.update', changes: {textStyles: table}}];
 if (updates.length) commands.push({type: 'updateMany', updates});
 return {command: commands.length === 1 ? commands[0] : {type: 'batch', commands}, count, skipped, styles: table, changedKeys};
}

/** 고른 문자에 스타일 입히기: 스타일 값(글꼴·폭 비율·기울기)을 복사한다(AutoCAD 도 만들 때 복사). */
export function planApplyTextStyle(doc, name, texts) {
 const styles = normalizeTextStyles(doc), s = styles[name] || {...STANDARD_STYLE};
 const changes = {textStyle: name, sourceFont: s.font, sourceBigFont: s.bigFont || '', widthFactor: s.widthFactor, ...(s.oblique ? {oblique: s.oblique} : {}), ...(s.height ? {height: s.height} : {})};
 const commands = [{type: 'document.update', changes: {textStyles: {...styles, [name]: s}}}];
 if (texts.length) commands.push({type: 'updateMany', updates: texts.map(e => ({id: e.id, changes}))});
 return {command: commands.length === 1 ? commands[0] : {type: 'batch', commands}, count: texts.length, styles};
}
