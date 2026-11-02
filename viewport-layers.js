// ACAD200 708 뷰포트별 레이어 재지정(VP 동결·색·선종류·굵기·투명도).
// AutoCAD: 레이어 레코드 안에 뷰포트 id 별 재지정 표(AcLayerPropertyOverrides)를 두고, VPLAYEROVERRIDESMODE 로 켜고 끈다.
// 바른 CAD 가 더 나은 점:
//  - 재지정은 뷰포트 쪽({layerOverrides:{[layerId]:{...}}})에 모아 둔다 → 뷰포트를 지우면 재지정도 함께 사라져 고아 자료가 없다.
//  - 그리는 쪽은 "그 뷰포트용 레이어 표" 를 만들어 지금 렌더러(G.visibleEntities)를 그대로 쓴다. 재지정이 없는 레이어는 같은 객체를 쓴다.
//  - DXF 로 읽어 보존만 하던 viewportStyles 를 이 형식으로 옮긴다(이름으로 맞춤).

export const OVERRIDE_KEYS = Object.freeze(['frozen', 'color', 'linetype', 'lineweight', 'transparency']);

export function validateOverride(key, value) {
  if (!OVERRIDE_KEYS.includes(key)) throw Error('뷰포트 재지정 속성은 동결·색·선종류·굵기·투명도입니다.');
  if (value == null) return value;
  if (key === 'frozen' && typeof value !== 'boolean') throw Error('뷰포트 동결은 켜기/끄기입니다.');
  if (key === 'color' && !/^#[0-9a-f]{6}$/i.test(value)) throw Error('뷰포트 색은 #RRGGBB 입니다.');
  if (key === 'linetype' && (typeof value !== 'string' || !value.trim())) throw Error('뷰포트 선종류 이름을 넣으세요.');
  if (key === 'lineweight' && !(Number.isFinite(value) && value >= 0 && value <= 2.11)) throw Error('뷰포트 굵기는 0~2.11 mm 입니다.');
  if (key === 'transparency' && !(Number.isFinite(value) && value >= 0 && value <= 90)) throw Error('뷰포트 투명도는 0~90 입니다.');
  return key === 'linetype' ? value.trim().toUpperCase() : value;
}

/** 그 뷰포트에서 쓸 레이어 표. 재지정 없는 레이어는 원래 객체 그대로(복사하지 않음). */
export function layersForViewport(doc, vp) {
  const ov = vp?.layerOverrides || {};
  if (!Object.keys(ov).length) return doc.layers;
  return doc.layers.map((l) => {
    const o = ov[l.id];
    if (!o) return l;
    const next = {...l};
    if (o.frozen) next.frozen = true;
    for (const k of ['color', 'linetype', 'lineweight', 'transparency']) if (o[k] != null) next[k] = o[k];
    return next;
  });
}

/** 재지정 하나를 넣거나(값) 빼고(null) 새 layerOverrides 를 돌려준다. */
export function setViewportOverride(vp, layerId, key, value) {
  const checked = validateOverride(key, value);
  const ov = {...(vp?.layerOverrides || {})}, cur = {...(ov[layerId] || {})};
  if (checked == null || (key === 'frozen' && checked === false)) delete cur[key]; else cur[key] = checked;
  if (Object.keys(cur).length) ov[layerId] = cur; else delete ov[layerId];
  return ov;
}

/** removeVPOverrides: 한 속성/모든 속성 × 한 레이어/모든 레이어. */
export function clearViewportOverrides(vp, {layerId = null, key = null} = {}) {
  const ov = {};
  for (const [id, o] of Object.entries(vp?.layerOverrides || {})) {
    if (layerId && id !== layerId) { ov[id] = o; continue; }
    if (!key) continue;
    const rest = {...o}; delete rest[key];
    if (Object.keys(rest).length) ov[id] = rest;
  }
  return ov;
}

export const viewportFrozenLayers = (vp) => Object.entries(vp?.layerOverrides || {}).filter(([, o]) => o.frozen).map(([id]) => id);

/** DXF 보존 자료(exchange.py viewportStyles: {레이어 이름: {color, linetype, lineweight, frozen, ...}})를 재지정으로. 모르는 키·없는 레이어는 건너뛴다. */
export function overridesFromViewportStyles(doc, styles = {}) {
  const byName = new Map(doc.layers.map((l) => [l.name, l]));
  const ov = {};
  for (const [name, style] of Object.entries(styles || {})) {
    const layer = byName.get(name);
    if (!layer || !style || typeof style !== 'object') continue;
    const o = {};
    for (const k of OVERRIDE_KEYS) { try { const v = validateOverride(k, style[k]); if (v != null && v !== false) o[k] = v; } catch {} }
    if (Object.keys(o).length) ov[layer.id] = o;
  }
  return ov;
}
