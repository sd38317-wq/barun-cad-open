// ACAD200 711 이름 있는 뷰(VIEW)와 뷰에 붙는 레이어 상태.
// AutoCAD: 뷰를 저장할 때 "ACAD_VIEWS_<이름>" 레이어 상태를 함께 저장하고, 이름이 겹치면 번호를 붙여 빈 이름을 찾는다.
// 바른 CAD 가 더 나은 점:
//  - 뷰는 화면 중심과 보이는 높이(도면 mm)로 저장한다 → 창 크기·화면 배율이 달라도 같은 범위가 보인다(픽셀 배율 저장 아님).
//  - 레이어 상태는 703 형식(마스크: 켜기·동결·잠금)으로 붙고, 되살릴 때 "레이어도" 를 고를 수 있다. 바뀌는 레이어만 고친다.
//  - 뷰를 지우면 그 뷰가 만든 숨은 레이어 상태도 함께 지운다(고아 상태 없음).
import {saveLayerState, layerStateCommands} from './layer-states.js';

export const VIEW_STATE_PREFIX = '*VIEW:';
export const VIEW_LAYER_MASK = Object.freeze(['visible', 'frozen', 'locked']);

/** 화면 상태({scale, origin, width, height}) → 저장할 뷰 범위(도면 좌표). */
export function viewFromScreen({scale, origin, width, height}) {
  if (!(scale > 0) || !(width > 0) || !(height > 0)) throw Error('화면 크기를 알 수 없습니다.');
  const cx = (width / 2 - origin.x) / scale, cy = (origin.y - height / 2) / scale;
  return {center: {x: cx, y: cy}, width: width / scale, height: height / scale};
}
/** 저장한 뷰 → 지금 창 크기에서의 {scale, origin}. 저장한 범위가 모두 보이게 맞춘다. */
export function screenFromView(view, {width, height}) {
  if (!(view?.width > 0) || !(view?.height > 0)) throw Error('뷰 범위가 올바르지 않습니다.');
  const scale = Math.min(width / view.width, height / view.height);
  return {scale, origin: {x: width / 2 - view.center.x * scale, y: height / 2 + view.center.y * scale}};
}

export function saveNamedView(doc, name, screen, {withLayers = true, savedAt = Date.now()} = {}) {
  const key = String(name ?? '').trim();
  if (!key) throw Error('뷰 이름을 넣으세요.');
  if (key.length > 60) throw Error('뷰 이름은 60자까지입니다.');
  const old = (doc.namedViews || []).find((v) => v.name === key);
  let layerStates = doc.layerStates || {};
  if (old?.layerState && layerStates[old.layerState]) { layerStates = {...layerStates}; delete layerStates[old.layerState]; }   // AutoCAD 처럼 예전 상태를 지우고 다시 저장
  let stateName = null;
  if (withLayers) {
    stateName = VIEW_STATE_PREFIX + key;
    for (let n = 2; layerStates[stateName] && n < 1000; n++) stateName = `${VIEW_STATE_PREFIX}${key}(${n})`;
    layerStates = saveLayerState({...doc, layerStates}, stateName, {description: `뷰 ${key}`, mask: VIEW_LAYER_MASK, savedAt});
  }
  const view = {name: key, ...viewFromScreen(screen), layerState: stateName, savedAt};
  const namedViews = [...(doc.namedViews || []).filter((v) => v.name !== key), view];
  return {namedViews, layerStates};
}

export function restoreNamedView(doc, name, screen, {layers = true} = {}) {
  const v = (doc.namedViews || []).find((x) => x.name === name);
  if (!v) throw Error('그런 뷰가 없습니다: ' + name);
  const state = layers && v.layerState ? doc.layerStates?.[v.layerState] : null;
  return {view: screenFromView(v, screen), commands: state ? layerStateCommands(doc, state) : []};
}

export function deleteNamedView(doc, name) {
  const v = (doc.namedViews || []).find((x) => x.name === name);
  if (!v) throw Error('그런 뷰가 없습니다: ' + name);
  const layerStates = {...(doc.layerStates || {})};
  if (v.layerState) delete layerStates[v.layerState];
  return {namedViews: doc.namedViews.filter((x) => x !== v), layerStates};
}
