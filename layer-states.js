// ACAD200 703·704 레이어 상태(LAYSTATE)와 LAYISO/LAYUNISO.
// AutoCAD: 상태를 비트 마스크로 저장·복원한다. LAYISO 는 숨은 이름의 상태로 저장해 LAYUNISO 가 파일을 저장한 뒤에도 되돌린다.
// 바른 CAD 가 더 나은 점:
//  - 마스크를 키 이름 목록으로 저장해 사람이 읽을 수 있고, 복원 때 "이 키만" 을 다시 고를 수 있다.
//  - 레이어 id 가 다른 도면(복사해 온 상태)에서도 이름으로 맞춰 본다.
//  - 바뀌는 레이어만 layer.update 로 보낸다(값이 같은 레이어는 건너뜀) → 되돌리기 한 번, 다시 그리기는 바뀐 레이어의 객체만.
//  - 예전 형식(레이어 표 배열)도 그대로 읽는다.

export const LAYER_STATE_KEYS = Object.freeze(['visible', 'frozen', 'locked', 'plot', 'color', 'linetype', 'lineweight', 'transparency']);
export const LAYER_STATE_LABELS = Object.freeze({visible: '켜기/끄기', frozen: '동결', locked: '잠금', plot: '인쇄', color: '색', linetype: '선종류', lineweight: '굵기', transparency: '투명도'});
/* LAYISO 가 저장하는 표시 키(AutoCAD 마스크 0x217 과 같은 뜻: 켜기·동결·잠금). */
export const ISO_STATE_NAME = '*LAYISO';
export const ISO_MASK = Object.freeze(['visible', 'frozen', 'locked']);
export const LAYISO_MODES = Object.freeze({off: '다른 레이어 끄기', lock: '다른 레이어 잠그고 흐리게'});

const DEFAULTS = {visible: true, frozen: false, locked: false, plot: true, transparency: 0};
const valueOf = (layer, key) => layer[key] ?? DEFAULTS[key] ?? null;

export function normalizeLayerState(state, name = '') {
  if (Array.isArray(state)) return {name, description: '예전 형식', mask: [...LAYER_STATE_KEYS], layers: state, legacy: true};
  if (!state || typeof state !== 'object' || !Array.isArray(state.layers)) throw Error('레이어 상태 형식이 올바르지 않습니다.');
  const mask = (Array.isArray(state.mask) ? state.mask : LAYER_STATE_KEYS).filter((k) => LAYER_STATE_KEYS.includes(k));
  return {...state, name: state.name || name, mask};
}

/** 지금 레이어 표를 상태로 저장한 새 layerStates 묶음을 돌려준다(document.update 로 넣는다). */
export function saveLayerState(doc, name, {description = '', mask = LAYER_STATE_KEYS, savedAt = Date.now()} = {}) {
  const key = String(name ?? '').trim();
  if (!key) throw Error('레이어 상태 이름을 넣으세요.');
  const keys = [...new Set(mask)].filter((k) => LAYER_STATE_KEYS.includes(k));
  if (!keys.length) throw Error('저장할 속성을 하나 이상 고르세요.');
  const layers = doc.layers.map((l) => {
    const row = {id: l.id, name: l.name};
    for (const k of keys) row[k] = valueOf(l, k);
    return row;
  });
  return {...(doc.layerStates || {}), [key]: {name: key, description: String(description || ''), mask: keys, layers, savedAt}};
}

/** 상태를 되살리는 layer.update 목록. onlyKeys 로 마스크 안의 일부만 고를 수 있다. 값이 같은 레이어는 빼고, 현재 레이어는 동결하지 않는다. */
export function layerStateCommands(doc, state, {onlyKeys = null, currentLayer = null} = {}) {
  const s = normalizeLayerState(state);
  const keys = (onlyKeys || s.mask).filter((k) => s.mask.includes(k));
  const byId = new Map(doc.layers.map((l) => [l.id, l])), byName = new Map(doc.layers.map((l) => [l.name, l]));
  const commands = [], seen = new Set();
  for (const saved of s.layers) {
    const layer = byId.get(saved.id) || byName.get(saved.name);
    if (!layer || seen.has(layer.id)) continue;
    seen.add(layer.id);
    const changes = {};
    for (const k of keys) {
      if (saved[k] === undefined) continue;
      let v = saved[k];
      if (k === 'frozen' && v && layer.id === currentLayer) continue;
      if (v === null && k !== 'transparency') continue;
      if (k === 'transparency' && v === null) v = 0;
      if (valueOf(layer, k) !== v) changes[k] = v;
    }
    if (Object.keys(changes).length) commands.push({type: 'layer.update', id: layer.id, changes});
  }
  return commands;
}

export function deleteLayerState(doc, name) {
  if (!doc.layerStates?.[name]) throw Error('그런 레이어 상태가 없습니다.');
  const next = {...doc.layerStates};
  delete next[name];
  return next;
}

/** 사용자에게 보일 상태 목록(숨은 * 이름은 뒤로). */
export function listLayerStates(doc) {
  return Object.entries(doc.layerStates || {}).map(([name, raw]) => {
    let s; try { s = normalizeLayerState(raw, name); } catch { return null; }
    return {name, description: s.description || '', mask: s.mask, count: s.layers.length, hidden: name.startsWith('*'), savedAt: s.savedAt || null};
  }).filter(Boolean).sort((a, b) => Number(a.hidden) - Number(b.hidden) || a.name.localeCompare(b.name, 'ko'));
}

/* ── LAYISO(704) ──
   mode 'off': 고른 레이어만 켜고 나머지를 끈다(예전 동작).
   mode 'lock': 고른 레이어는 풀고 나머지를 잠근다 → 705 흐리게 보이기로 보이되 편집은 안 된다.
   분리 전 상태는 doc.layerStates['*LAYISO'] 에 저장돼 파일과 함께 남는다. 이미 분리 중이면 처음 상태를 지킨다. */
export function isolateLayerCommands(doc, layerIds, {mode = 'off'} = {}) {
  const ids = new Set(layerIds);
  if (!ids.size) throw Error('객체를 먼저 선택하세요.');
  if (!LAYISO_MODES[mode]) throw Error('LAYISO 방식은 off 또는 lock 입니다.');
  const already = doc.layerStates?.[ISO_STATE_NAME];
  const states = already ? doc.layerStates : saveLayerState(doc, ISO_STATE_NAME, {description: 'LAYISO 자동 저장', mask: ISO_MASK});
  const commands = [];
  if (!already) commands.push({type: 'document.update', changes: {layerStates: states}});
  for (const l of doc.layers) {
    const keep = ids.has(l.id);
    const changes = keep
      ? {visible: true, frozen: false, ...(mode === 'lock' ? {locked: false} : {})}
      : mode === 'lock' ? {locked: true} : {visible: false};
    const diff = Object.fromEntries(Object.entries(changes).filter(([k, v]) => valueOf(l, k) !== v));
    if (Object.keys(diff).length) commands.push({type: 'layer.update', id: l.id, changes: diff});
  }
  return {commands, isolated: ids.size, mode};
}

/** LAYUNISO: *LAYISO 상태로 되돌리고 상태를 지운다. 예전 탭 메모리 형식(isolatedLayerState 배열)도 받는다. */
export function unisolateLayerCommands(doc, legacy = null) {
  const saved = doc.layerStates?.[ISO_STATE_NAME];
  if (!saved && !legacy) throw Error('LAYISO 로 분리한 상태가 없습니다.');
  const state = saved || {mask: ['visible', 'frozen'], layers: legacy.map((l) => ({id: l.id, visible: l.visible, frozen: !!l.frozen}))};
  const commands = layerStateCommands(doc, state);
  if (saved) {
    const next = {...doc.layerStates};
    delete next[ISO_STATE_NAME];
    commands.unshift({type: 'document.update', changes: {layerStates: next}});
  }
  return commands;
}
