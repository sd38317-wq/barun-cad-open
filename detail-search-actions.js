import * as G from './geometry.js';
import {prepareDetailInsertion} from './bridge-client.js';
import {sceneLabel} from './cad-asset-preview.js';

export function currentDetailModel(document, selected = []) {
  const sets = document.drawingSets || {};
  const picked = selected.map(e => e.drawingSet?.id).find(id => sets[id]?.model);
  return sets[picked]?.model || Object.values(sets).find(s => s.kind === 'set')?.model ||
    Object.values(sets).find(s => s.model && s.kind !== 'details')?.model || {stories: [], elements: []};
}

// Explicit insertion only: physical geometry stays 1:1, annotation follows drawing scale.
// detailDenominator(넣을 축척 1/x, 10-25 시안 ⑰)를 주면 도면 축척으로 뽑았을 때 1/x 로 보이게 키우고(도면 분모 ÷ x), 제목 밑에 SCALE 1/x.
export function prepareLibraryDetail(document, item, response, position, denominator = 100, detailDenominator = null, hiddenLayers = [], onlyScene = null) {
  if (response.status !== 'ok' || response.review_required || response.detail?.insertion_allowed === false ||
      response.detail?.assignment?.requires_review) throw Error(response.message || '실제 크기·상세 번호 검토가 필요한 자료입니다.');
  const original = response.geometry || response.detail?.geometry;
  const expanded = original?.sharedBlocks ? G.expandSharedDrawingBlocks(original) : original;
  // 미리보기에서 끈 레이어(10-27 대표: 끄고 넣으면 빠진 채로 들어가야 한다)는 블록 안까지 뺀다.
  const drop = new Set(hiddenLayers || []);
  const layerName = new Map((expanded?.layers || []).map(l => [l.id, l.name]));   // 미리보기 레이어 줄은 이름, 객체는 id 일 수 있다
  const off = e => drop.has(e?.layer || '0') || drop.has(layerName.get(e?.layer));
  const strip = list => list.filter(e => !off(e)).map(e => Array.isArray(e?.entities) ? {...e, entities: strip(e.entities)} : e);
  const layered = drop.size && Array.isArray(expanded?.entities) ? {...expanded, entities: strip(expanded.entities)} : expanded;
  // 큰 창에서 장면 하나를 크게 보고 넣으면 그 장면만(10-27 대표 지시). 장면 범위 안에 가운데가 든 객체만 남긴다.
  const scenes = response.detail?.scenes || [];
  const chosen = onlyScene == null ? null : scenes.find(s => String(s?.n) === String(onlyScene));
  if (onlyScene != null && !(Array.isArray(chosen?.bounds) && chosen.bounds.length === 4 && chosen.bounds.every(Number.isFinite))) throw Error('고른 장면의 범위를 찾지 못했습니다. 장면 [전체]로 넣으세요.');
  const inScene = e => {const b = G.bounds([e]); if (!Number.isFinite(b?.minX)) return false; const cx = (b.minX + b.maxX) / 2, cy = (b.minY + b.maxY) / 2, [x0, y0, x1, y1] = chosen.bounds; return cx >= x0 && cx <= x1 && cy >= y0 && cy <= y1;};
  const geometry = chosen && Array.isArray(layered?.entities) ? {...layered, entities: layered.entities.filter(inScene)} : layered;
  if ((drop.size || chosen) && !geometry?.entities?.length) throw Error(chosen ? '고른 장면에 넣을 객체가 없습니다(끈 레이어를 확인하세요).' : '켜 둔 레이어가 없습니다. 넣을 레이어를 하나 이상 켜세요.');
  const detail = {...response.detail, geometry};
  if (item.source === 'library') detail.source_name = item.raw?.source_name || 'kor';
  if (chosen) detail.bounds = {minX: chosen.bounds[0], minY: chosen.bounds[1], maxX: chosen.bounds[2], maxY: chosen.bounds[3]};
  else if (drop.size) detail.bounds = G.bounds(geometry.entities); else detail.bounds ||= G.bounds(geometry?.entities || []);
  const n = Number(denominator), x = detailDenominator == null ? null : Number(detailDenominator);
  if (!Number.isFinite(n) || n <= 0) throw Error('도면 축척을 확인하세요.');
  if (x != null && (!Number.isFinite(x) || x <= 0)) throw Error('넣을 축척을 확인하세요.');
  const staged = prepareDetailInsertion(document, {id: item.id, detail, position, scale: x ? n / x : 1});
  staged.block.detail.searchKey = item.key;
  if (x) staged.block.detail.insertScale = x;
  const height = n * 2.5, factor = x ? n / x : 1, origin = detail.bounds;
  // 장면 제목(10-25): 자산에서 빠진 '번호 · 제목 · SCALE' 을 장면마다 그 아래에 다시 쓴다. SCALE 은 이 도면에서 실제로 뽑히는 축척.
  // 글자는 종이 2.5mm 가 기본이지만, 실제 크기로 넣은 작은 장면에서는 제목이 장면 폭을 넘어 서로 겹친다(개발판 확인 10-25) → 장면 폭에 맞춰 줄인다.
  const fit = (text, width) => Math.min(height, Math.max(1, width / (Math.max(1, [...text].length) * 0.95)));
  const sceneTitles = (chosen ? [chosen] : scenes).filter(s => Array.isArray(s?.bounds) && s.bounds.length === 4 && s.bounds.every(Number.isFinite) && origin)
    .map(s => {const text = sceneLabel({...s, scale: +(n / factor).toFixed(2)}), h = fit(text, (s.bounds[2] - s.bounds[0]) * factor);
      return {id: crypto.randomUUID(), type: 'text', layer: staged.block.layer,
        position: {x: position.x + (s.bounds[0] - origin.minX) * factor, y: position.y + (s.bounds[1] - origin.minY) * factor - h * 1.6}, text, height: h,
        detailRole: 'library-scene-title', detail: {id: item.id, source: detail.source, searchKey: item.key, annotation: true, scene: s.n}};});
  staged.document.entities.push(...sceneTitles);
  const lowest = Math.min(position.y, ...sceneTitles.map(t => t.position.y));
  const nameHeight = sceneTitles.length ? fit(item.name, (origin.maxX - origin.minX) * factor) : height;
  const title = {id: crypto.randomUUID(), type: 'text', layer: staged.block.layer,
    position: {x: position.x, y: lowest - nameHeight * 1.5}, text: item.name, height: nameHeight,
    detailRole: 'library-title', detail: {id: item.id, source: detail.source, searchKey: item.key, annotation: true}};
  staged.document.entities.push(title);
  if (!x || sceneTitles.length) return {...staged, added: [staged.block.id, ...sceneTitles.map(t => t.id), title.id]};
  const scaleText = {...title, id: crypto.randomUUID(), position: {x: position.x, y: title.position.y - height * 1.2}, text: 'SCALE 1/' + x, height: height * .7, detailRole: 'library-scale'};
  staged.document.entities.push(scaleText);
  return {...staged, added: [staged.block.id, title.id, scaleText.id]};
}

export function detailSheetOrigin(document) {
  const detailEntities = document.entities.filter(e =>
    (e.drawingSet && document.drawingSets?.[e.drawingSet.id]?.kind === 'details') || e.detail?.sheet);
  const b = G.bounds(detailEntities.length ? detailEntities : document.entities);
  return Number.isFinite(b?.maxX) ? {x: b.maxX + 2000, y: b.maxY} : {x: 0, y: 0};
}

export function assertDetailTarget(context, snapshot, drawingId) {
  if (context.engine.doc !== snapshot || (context.getDrawingId && context.getDrawingId() !== drawingId))
    throw Error('도면이 변경되었습니다. 현재 도면에서 다시 넣으세요.');
  if (context.isDetailBusy?.()) throw Error('그리기를 마친 뒤 상세를 넣으세요.');
}

export async function insertSearchDetail(context, item, {position, sheet = false, loadKnowledge, generate, loadDetail, detailDenominator = null, hiddenLayers = [], onlyScene = null} = {}) {
  const snapshot = context.engine.doc, drawingId = context.getDrawingId?.();
  assertDetailTarget(context, snapshot, drawingId);
  const origin = sheet ? detailSheetOrigin(snapshot) : position;
  if (!origin || !Number.isFinite(origin.x) || !Number.isFinite(origin.y)) throw Error('상세를 넣을 위치를 지정하세요.');
  let document, added, result;
  if (item.source === 'ours') {
    const knowledge = await loadKnowledge();
    const model = currentDetailModel(snapshot, context.chosen?.() || []);
    result = await generate(snapshot, {...knowledge, kind: 'details', ids: [item.id], model, origin});
    document = result.document; added = result.added;
    const record = document.drawingSets?.[result.setId];
    if (record) record.detailSearch = {keys: [item.key], sheet};
  } else {
    result = prepareLibraryDetail(snapshot, item, await loadDetail(item), origin, context.getDetailDenominator?.() || 100, detailDenominator, hiddenLayers, onlyScene);
    document = result.document; added = result.added;
    result.block.detail.sheet = sheet;
  }
  assertDetailTarget(context, snapshot, drawingId);
  context.engine.validate(document);
  context.execute({type: 'lisp.apply', document});
  context.selectEntities?.(added);
  context.refresh?.();
  context.toast?.(({jutong: '주동을', unit: '단위세대를'}[item.group] || '상세를') + ' 넣었습니다 · 실행 취소 한 번으로 복구');
  return {...result, document, added};
}
