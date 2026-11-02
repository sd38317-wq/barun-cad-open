// 편의시설 도서용 건물 모델 — 층마다 앱이 인식한 시설 후보를 한 모델로 합친다. 앱(인허가 도서 창)과 개발용 다리(tools/access_plan/bridge.mjs)가 같이 쓴다.
// 잠금 코드(도면 생성기·상세 규칙·판정)는 부르지 않는다: 인식 결과는 밖에서 받고, 여기서는 문(편의시설 검토)·계단 레이어·④ 실측값만 더한다.
import {bounds} from './geometry.js';
import {accessReview} from './access-review.js';

/** 도면을 층 범위 [x0,y0,x1,y1] 로 자른 사본(그 안에 다 들어가는 객체만). */
export function cropDocument(doc, r) {
  return {...doc, entities:(doc.entities || []).filter(e => { const b = bounds([e]); return b && b.minX >= r[0] && b.maxX <= r[2] && b.minY >= r[1] && b.maxY <= r[3]; })};
}

/**
 * 층마다 인식한 요소 → 건물 모델. floors: [{id, name, doc, elements}] (elements = 앱 recognizeAccessModel 결과 그 층분).
 * 문: 편의시설 검토(검토창 편의시설 탭)와 같은 accessReview 결과 — 문 번호(D-xx)·도면 유효폭. 어느 문이 주출입구인지는 모르므로
 *     유효폭은 판정에 넣지 않고(drawingClearWidth) 특이사항에만 쓴다.
 * 계단: 앱 인식은 닫힌 윤곽·블록·글만 본다. 계단 레이어(A-STRS) 선만 있으면 그 범위를 계단 후보 하나로.
 * ④ 실측값: accessibility.facilities[항목].values 를 그 항목(itemKinds) 시설 후보에 얹는다(elementIds 가 있으면 그것만).
 */
export function buildAccessModel({floors, accessibility = {}, itemKinds = {}, date}) {
  const model = {stories:[], elements:[], accessibility:{complete:false}, source:{kind:'drawing-recognition'}};
  floors.forEach((f, i) => {
    model.stories.push({id:f.id, name:f.name, elevation:i * 3000, height:3000});
    const own = f.elements || [];
    for (const e of own) model.elements.push({...e, id:f.id + ':' + String(e.id).replace(/^[^:]+:/, ''), story:f.id, location:f.name + ' ' + (e.location || '')});
    const doc = f.doc || {entities:[], layers:[]}, layerName = new Map((doc.layers || []).map(l => [l.id, l.name])), byId = new Map(doc.entities.map(e => [e.id, e]));
    if (!own.some(e => e.kind === 'door')) for (const it of accessReview({entities:doc.entities}).items.filter(x => /^access:D-\d+:width$/.test(x.id))) {
      const parts = it.objectIds.map(id => byId.get(id)).filter(Boolean), b = parts.length && bounds(parts);
      if (!b) continue;
      model.elements.push({id:f.id + ':' + it.reviewObjectIds[0], kind:'door', story:f.id, position:[(b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2], recognized:true,
        drawingClearWidth:it.current.value, location:f.name + ' ' + it.reviewObjectIds[0]});
    }
    const stairs = doc.entities.filter(e => layerName.get(e.layer) === 'A-STRS');
    if (!own.some(e => e.kind === 'stair') && stairs.length) { const b = bounds(stairs);
      model.elements.push({id:f.id + ':stair', kind:'stair', story:f.id, position:[(b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2],
        outline:[[b.minX, b.minY], [b.maxX, b.minY], [b.maxX, b.maxY], [b.minX, b.maxY]], recognized:true, location:f.name + ' 계단(A-STRS)'}); }
  });
  const facilities = {...accessibility.facilities};
  for (const [id, d] of Object.entries(facilities)) {
    if (!d?.values || typeof d.values !== 'object') continue;
    const kinds = itemKinds[id] || [];
    model.elements = model.elements.map(e => kinds.includes(e.kind) && (!d.elementIds || d.elementIds.includes(e.id)) ? {...e, ...d.values} : e);
  }
  return {...model, drawingDate:date, accessibility:{...model.accessibility, ...accessibility, facilities}};
}

/** 건물 전체를 한 번에 판정하려고 층을 하나로 합친 모델(앱 계획도 함수는 한 층씩만 판정한다). */
export function flattenStories(model) {
  return {...model, stories:[{id:'ALL', name:'전체', elevation:0, height:3000}], elements:model.elements.map(e => ({...e, story:'ALL', host:undefined}))};
}

/** 계획도 결과에서 오른쪽 범례·참고 상세 기호·검토표를 뗀다(도서에서는 검토서·상세 시트가 맡음). 범례 시작 x = 표 상자 왼쪽, 참고 기호는 그보다 글자 10개 왼쪽. */
export function planMarks(result, before, textHeight = 120) {
  const doc = result.document, box = result.plan.tableBox, cut = box.minX - textHeight * 12;
  return {units:'mm', layers:doc.layers, entities:doc.entities.filter(e => { if (before.has(e.id)) return false; const b = bounds([e]); return !b || b.maxX < cut; })};
}
