// ACAD200 707 새 레이어 알림(LAYERNOTIFY·LAYEREVAL).
// AutoCAD: 레이어마다 "확인됨" Xrecord 를 붙이고, LAYEREVAL 이 켜져 있으면 새로 생긴 레이어를 미조정으로 본다.
//          LAYERNOTIFY 비트(1 출력·2 열기·4 외부참조·8 상태 복원·16 저장·32 삽입)로 알릴 때를 고른다. 기본값은 둘 다 0(끔).
// 바른 CAD 가 더 나은 점:
//  - 표시는 레이어의 reconciled:false 하나뿐이다(확장 사전 없음). 엔진이 레이어 수가 늘어난 실행에서만 레이어 표를 본다(O(레이어)).
//  - 바른 표준 레이어 이름과 사용자가 직접 만든 레이어는 자동으로 확인된 것으로 본다 → 알림이 꼭 필요한 외부 레이어만 남는다.
//  - 알림에서 바로 "표준 레이어로 정리" 창(layerReviewDialog)으로 이어진다.

export const NOTIFY = Object.freeze({plot: 1, open: 2, xref: 4, restore: 8, save: 16, insert: 32});
export const NOTIFY_LABELS = Object.freeze({plot: '출력할 때', open: '열 때', xref: '외부참조를 불러올 때', restore: '레이어 상태를 되살릴 때', save: '저장할 때', insert: '삽입할 때'});

export const unreconciledLayers = (doc) => (doc?.layers || []).filter((l) => l.reconciled === false);

export function normalizeNotifyMask(value) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0 || n > 63) throw Error('LAYERNOTIFY 는 0~63 정수입니다.');
  return n;
}
export function notifyMaskFromFlags(flags = {}) {
  let mask = 0;
  for (const [key, bit] of Object.entries(NOTIFY)) if (flags[key]) mask |= bit;
  return mask;
}
export const flagsFromNotifyMask = (mask) => Object.fromEntries(Object.entries(NOTIFY).map(([key, bit]) => [key, !!(mask & bit)]));

/** 알릴 것이 있으면 {count, names, reconcile} 을, 없으면 null. action: plot|open|xref|restore|save|insert */
export function checkBeforeAction(doc, action) {
  const mask = Number(doc?.layerNotify) || 0, bit = NOTIFY[action];
  if (!bit || !(mask & bit)) return null;
  const list = unreconciledLayers(doc);
  if (!list.length) return null;
  return {count: list.length, names: list.slice(0, 10).map((l) => l.name), more: Math.max(0, list.length - 10), reconcile: () => reconcileCommands(doc, list.map((l) => l.id))};
}

/** 고른 레이어(없으면 모두)를 확인됨으로. 한 batch(되돌리기 한 번). */
export function reconcileCommands(doc, ids = null) {
  const wanted = ids ? new Set(ids) : null;
  return unreconciledLayers(doc).filter((l) => !wanted || wanted.has(l.id)).map((l) => ({type: 'layer.update', id: l.id, changes: {reconciled: true}}));
}

export function notifyMessage(result, action) {
  if (!result) return '';
  const names = result.names.join(', ') + (result.more ? ` 외 ${result.more}개` : '');
  return `확인하지 않은 새 레이어 ${result.count}개(${names})가 있습니다. ${NOTIFY_LABELS[action] || ''} 알리도록 설정되어 있습니다.`;
}
