// AI 도면 다시 만들기(AIREDRAW): 도면에 기억한 설계 JSON(drawingSets)으로 그 묶음만 지우고 다시 그린다. 실행 취소 한 단계.
// 인터넷이 없어도 된다 — 설계 JSON 은 도면 안에, 도면 기준은 이 PC 의 열쇠 묶음에. 생성기는 Worker 에서(ctx.regenerateDrawingSet).
import {pendingEdits, prepareWallGrip, wallEditingGrips} from './drawing-sync.js';

// AIREDRAW와 3D 편집은 같은 손 편집 확인을 사용한다. 닫기/Esc도 취소로 돌려준다.
export function confirmDrawingSetEdits(ctx, source, setId, apply, cancel = () => undefined) {
  const {lost} = pendingEdits(source, setId);
  if (!lost) return apply();
  ctx.form('AI 도면 다시 만들기', [{name: 'go', label: `설계로 옮길 수 없는 손 편집 ${lost}개(벽 윤곽·단면·입면·치수 등)는 다시 만들면 사라집니다`, value: 'no', options: [['no', '그만두기'], ['yes', '사라져도 다시 만들기']]}], (v) => v.go === 'yes' ? apply() : cancel(), cancel);
}

/** 설계 변경과 같은 묶음 재생성 결과를 한 번에 적용한다. 중간 모델은 도면에 넣지 않는다. */
export async function pushPullDrawingSet(ctx, {setId, target, distance, expectedDocument, alreadySnapped = false} = {}) {
  const source = expectedDocument || ctx.doc();
  const assertCurrent = () => {
    ctx.assertCurrent?.();
    if (ctx.doc() !== source) throw Error('도면이 변경되었습니다. 3D를 다시 열고 밀고 당기기를 실행하세요.');
  };
  assertCurrent();
  if (!ctx.regenerateDrawingSet) throw Error('도면 다시 만들기를 사용할 수 없습니다.');
  const pending = pendingEdits(source, setId);
  const {pushPullDesignModel} = await import('./design-model3d.js');
  const model = pushPullDesignModel(pending.model, target, distance, alreadySnapped ? {snap: 0} : {});
  const accepted = await new Promise((resolve) => confirmDrawingSetEdits(ctx, source, setId, () => resolve(true), () => resolve(false)));
  if (!accepted) return {cancelled: true, setId};
  assertCurrent();
  const r = await ctx.regenerateDrawingSet(source, setId, {model, discardEdits: true});
  assertCurrent();
  ctx.execute({type: 'lisp.apply', document: r.document});
  // 적용 뒤 화면 알림 실패가 성공한 편집을 실패로 보고하게 만들지 않는다.
  try {ctx.setSelected?.(r.added);ctx.refresh?.();ctx.toast?.(`3D 밀고 당기기 · ${setId} 다시 만들기 · 실행 취소 가능`);} catch {}
  return {...r, synced: pending.changes};
}

const KIND_NAMES = {'access-plan': '장애인시설 계획도', details: '건축 상세', set: '도면 한 벌', plan: '평면', 'wall-section-detail': '벽체 단면 상세'};
export const drawingSetLabel = (id, record) => `${id} · ${KIND_NAMES[record.kind] || record.kind}${record.model?.source?.name ? ' · ' + record.model.source.name : ''} · ${record.revision || 1}번째`;

export function installDrawingSet(ctx) {
  return {AIREDRAW: async () => {
    const source = ctx.doc(), sets = source.drawingSets || {}, ids = Object.keys(sets);
    if (!ids.length) throw Error('이 도면에는 AI 가 만든 도면 묶음이 없습니다.');
    if (!ctx.regenerateDrawingSet) throw Error('AIREDRAW 는 CAD 화면에서 실행합니다. AI 는 cad_generate_drawing 에 setId 를 주세요.');
    const regenerate = async (setId) => {
      const r = await ctx.regenerateDrawingSet(source, setId);
      if (ctx.doc() !== source) throw Error('도면이 변경되었습니다. 다시 만들기를 다시 실행하세요.');
      ctx.execute({type: 'lisp.apply', document: r.document});ctx.setSelected(r.added);ctx.refresh();
      const synced = r.synced?.length ? ` · 손 편집 설계에 반영: ${r.synced.map((c) => c.text).join(', ')}` : '';
      const warnings = r.warnings?.length ? ' · ' + r.warnings.map((w) => w.text).join(' ') : '';
      ctx.toast?.(`AI 도면 ${setId} 다시 만들기: ${r.removed}개 → ${r.added.length}개${synced} · 실행 취소 가능${warnings}`, !!warnings);
      return r;
    };
    // 설계로 되돌릴 수 없는 손 편집(벽 윤곽·단면·입면·치수 등)이 있으면 사라진다고 먼저 묻는다
    const run = (setId) => confirmDrawingSetEdits(ctx, source, setId, () => regenerate(setId));
    // 고른 객체가 속한 묶음 → 그 묶음, 묶음이 하나면 그것, 여럿이면 고르기
    const picked = ctx.selected().map((e) => e.drawingSet?.id).find((id) => sets[id]);
    if (picked || ids.length === 1) return run(picked || ids[0]);
    ctx.form('AI 도면 다시 만들기', [{name: 'setId', label: '도면 묶음', value: ids[0], options: ids.map((id) => [id, drawingSetLabel(id, sets[id])])}], (v) => run(v.setId));
  }};
}

// 생성이 성공하고 원본 도면이 그대로일 때만 한 번 적용한다(undo 한 단계).
export async function commitWallGrip(ctx, grip, point) {
  const source = ctx.doc(), edit = prepareWallGrip(source, grip, point);
  const result = await ctx.regenerateDrawingSet(source, grip.setId, {model: edit.model, discardEdits: true});
  if (ctx.doc() !== source) throw Error('도면이 변경되었습니다. 벽 손잡이를 다시 편집하세요.');
  ctx.execute({type: 'lisp.apply', document: result.document});
  // 전체 묶음을 선택하면 무관한 창·치수의 그립까지 수천 개가 나온다.
  const entity = result.document.entities.find((e) => e.drawingSet?.id === grip.setId && result.document.drawingSets[grip.setId].baseline[e.id]?.[4]?.wallIds.includes(grip.wallId));
  ctx.setSelected(entity ? [entity.id] : []);ctx.refresh();
  ctx.toast?.('벽 ' + grip.wallId + ' 설계 반영 · 실행 취소 가능' + (edit.warnings.length ? ' · ' + edit.warnings.map((w) => w.text).join(' ') : ''), !!edit.warnings.length);
  return {...result, warnings: edit.warnings};
}
// 선택 시 계산한 그립은 같은 도면·객체에서 재사용(드래그·화면 루프에서 모델 검색 없음).
export function createWallGripCache() {
  let document = null;const cache = new Map();
  return (doc, e) => {
    if (!e.drawingSet) return null;
    if (doc !== document) {document = doc;cache.clear();}
    if (!cache.has(e.id)) cache.set(e.id, wallEditingGrips(doc, e));
    return cache.get(e.id);
  };
}

// line 옵션에서만 생성한다. 동일 drawingSets에서는 참조 확인 한 번으로 끝난다.
export function createWallCenterlineCache() {
  let last = null, lines = [];
  return (sets) => {
    if (sets === last) return lines;
    last = sets;lines = [];
    for (const rec of Object.values(sets || {})) if (rec.wallCenterline === 'line') {
      const walls = new Map(rec.model.elements.filter((w) => w.kind === 'wall').map((w) => [w.id, w]));
      for (const view of rec.wallViews || []) for (const id of view.wallIds) {
        const w = walls.get(id);if (w) lines.push(w.path.map(([x, y]) => ({x: x + view.origin[0], y: y + view.origin[1]})));
      }
    }
    return lines;
  };
}
