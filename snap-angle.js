// 작업 각도(SNAPANG) — A0·A1 보조명령과 직교(F8) 입력이 함께 쓴다(2026-09-24, 5.0.4 검토 D 영역).
// 바른 CAD 의 직교는 원래 도면 X·Y 축만 따랐다. A1 로 각도를 정하면 직교가 그 각도로 돌아간 두 축을 따르고,
// A0 로 0°(직각)로 되돌린다.
// 비평 3 반영: 원문 SNAPANG 은 도면 변수다. 값은 "열린 도면 탭별·이번 실행 동안만" 기억하고(localStorage 에 남기지
// 않는다), 탭을 바꾸면 그 탭의 값(처음이면 0°)으로 바뀐다. 값이 바뀌면 'barun-snap-angle-changed' 이벤트를 보내
// 상태표시줄 직교 단추에 각도를 함께 표시하게 한다(app.js syncDraftingButtons).
export const SNAP_ANGLE_KEY = 'barun-snap-angle'; // 5.0.4 초판이 쓰던 영구 저장 키 — 읽지 않고 지운다
export const SNAP_ANGLE_EVENT = 'barun-snap-angle-changed';
const anglesByDrawing = new Map();
let scope = 'default';
let legacyCleared = false;

/** 직교 축은 90° 마다 같으므로 [0, 90) 으로 맞춘다. */
export function normalizeSnapAngle(degrees) {
  const n = Number(degrees);
  if (!Number.isFinite(n)) throw Error('작업 각도는 숫자여야 합니다.');
  const v = ((n % 90) + 90) % 90;
  return Math.abs(v) < 1e-9 || Math.abs(v - 90) < 1e-9 ? 0 : Number(v.toFixed(9));
}

function clearLegacy(storage) {
  if (legacyCleared) return;
  legacyCleared = true;
  try { storage?.removeItem?.(SNAP_ANGLE_KEY); } catch {}
}
function notify(value) {
  try {
    const target = globalThis.window;
    if (typeof target?.dispatchEvent === 'function' && typeof globalThis.CustomEvent === 'function') target.dispatchEvent(new CustomEvent(SNAP_ANGLE_EVENT, {detail: {angle: value, drawing: scope}}));
  } catch {}
}

export function getSnapAngle(storage = globalThis.localStorage) {
  clearLegacy(storage);
  return anglesByDrawing.get(scope) || 0;
}

export function setSnapAngle(degrees, storage = globalThis.localStorage) {
  clearLegacy(storage);
  const value = normalizeSnapAngle(degrees);
  if (value) anglesByDrawing.set(scope, value); else anglesByDrawing.delete(scope);
  notify(value);
  return value;
}

/** 도면 탭이 바뀔 때 부른다. 탭마다 따로 기억한 각도로 바뀐다(처음 여는 탭은 0°). */
export function setSnapAngleDrawing(drawingId) {
  scope = String(drawingId ?? 'default');
  notify(getSnapAngle());
  return getSnapAngle();
}

/** 시험용: 기억한 값을 모두 비운다. */
export function resetSnapAngleCache() { anglesByDrawing.clear(); scope = 'default'; legacyCleared = false; }

// app.js 는 탭을 바꾼 뒤 'cad-document-switched'(detail.id) 를 보낸다 — 여기서 받아 탭별 값으로 바꾼다.
try {
  if (typeof globalThis.window?.addEventListener === 'function') globalThis.window.addEventListener('cad-document-switched', (event) => setSnapAngleDrawing(event?.detail?.id));
} catch {}

/** 직교 입력: base 에서 point 로 가는 벡터를 작업 각도 축 중 가까운 쪽(direction 기준)으로 투영한다.
 *  각도가 0 이면 기존 동작(수평이면 y 고정, 수직이면 x 고정)과 똑같다. */
export function orthoSnap(base, point, direction = point, angle = 0) {
  const dx = direction.x - base.x, dy = direction.y - base.y;
  if (!angle) return Math.abs(dx) >= Math.abs(dy) ? {...point, x: point.x, y: base.y} : {...point, x: base.x, y: point.y};
  const r = angle * Math.PI / 180, c = Math.cos(r), s = Math.sin(r);
  const du = dx * c + dy * s, dv = -dx * s + dy * c;
  const px = point.x - base.x, py = point.y - base.y;
  if (Math.abs(du) >= Math.abs(dv)) { const t = px * c + py * s; return {...point, x: base.x + t * c, y: base.y + t * s}; }
  const t = -px * s + py * c;
  return {...point, x: base.x - t * s, y: base.y + t * c};
}

/** 상태표시줄 표시용: 0°면 빈 문자열. */
export function snapAngleLabel(angle = getSnapAngle()) {
  return angle ? ` · ${Number(angle.toFixed(2))}°` : '';
}

/** 경사도(%) → 각도(도). 원문 A1: (atan 퍼센트/100). */
export function slopePercentToAngle(percent) {
  const p = Number(percent);
  if (!Number.isFinite(p)) throw Error('경사도(%)는 숫자여야 합니다.');
  return Math.atan(p / 100) * 180 / Math.PI;
}
