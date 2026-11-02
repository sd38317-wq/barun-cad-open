// 521 블록 속성: 속성 글자(attributeTag 가 붙은 블록 안 문자)와 값 지도(attributes)를 함께 다룬다.
// AutoCAD: 블록 정의의 ATTDEF(태그·기본값·위치)와 삽입본의 ATTRIB(값)로 나뉘고, ATTSYNC 는 정의 쪽으로 위치를 다시 맞춘다
// (정의에 없는 태그는 지운다). 바른 CAD: 기준으로 고른 삽입본을 정의처럼 써서 같은 이름 블록의 속성 배치를 맞추고,
// 값은 그대로 두며, 기준에 없는 태그도 지우지 않는다(데이터 손실 없음). 값과 보이는 글자가 늘 같게 한 번에 고친다.
import * as G from './geometry.js';

/** 블록의 속성 글자들(블록 바로 안). */
export const attributeTexts = block => (block?.entities || []).filter(c => c?.type === 'text' && c.attributeTag != null);

/** 속성 값 하나 바꾸기 → {attributes, entities}(보이는 글자도 같이). 없는 태그면 값만 더한다. */
export function setAttributeValue(block, tag, value) {
 const text = String(value ?? '');
 const attributes = {...(block.attributes || {}), [tag]: text};
 let touched = false;
 const entities = (block.entities || []).map(c => { if (c?.type === 'text' && c.attributeTag === tag && c.text !== text) { touched = true; return {...c, text}; } return c; });
 return touched ? {attributes, entities} : {attributes};
}

/** 값 지도와 속성 글자가 어긋난 곳(글자를 값으로 맞출 바꾸기, 없으면 null). */
export function syncAttributeTexts(block) {
 const values = block?.attributes || {};
 let touched = false;
 const entities = (block?.entities || []).map(c => {
  if (c?.type !== 'text' || c.attributeTag == null || !Object.hasOwn(values, c.attributeTag)) return c;
  const v = String(values[c.attributeTag] ?? '');
  if (c.text === v) return c;
  touched = true; return {...c, text: v};
 });
 return touched ? {entities} : null;
}

const frameOf = b => b?.position && Number.isFinite(b.position.x) ? {p: b.position, r: Number(b.rotation) || 0, s: Number(b.scale?.x ?? b.scale) || 1, m: !!b.mirror} : null;
/** 기준 삽입본의 글자를 다른 삽입본 자리로 옮긴다(위치·회전·축척 차이). 대칭이 다르면 null. */
function carry(child, from, to) {
 if (from.m !== to.m) return null;
 const k = to.s / from.s;
 let out = G.translate(child, -from.p.x, -from.p.y);
 out = G.rotate(out, {x: 0, y: 0}, to.r - from.r);
 if (Math.abs(k - 1) > 1e-12) out = G.resize(out, {x: 0, y: 0}, k);
 return G.translate(out, to.p.x, to.p.y);
}

/**
 * ATTSYNC 계획: 기준 삽입본과 같은 이름의 블록들 속성 글자 배치(위치·높이·각도·보임)를 기준에 맞춘다.
 * 값은 그대로, 기준에만 있는 태그는 기준 값을 기본값으로 더한다. 기준에 없는 태그는 그대로 둔다(지우지 않는다).
 * @returns {{updates, synced, skipped, extraTags}}
 */
export function attsyncPlan(reference, blocks) {
 const from = frameOf(reference), template = attributeTexts(reference);
 if (!from || !template.length) throw Error('기준 블록에 속성 글자와 삽입점이 있어야 합니다.');
 const updates = [], extraTags = new Set(); let skipped = 0;
 for (const b of blocks) {
  if (b === reference || b.id === reference.id || b.type !== 'block' || b.name !== reference.name) continue;
  const to = frameOf(b); if (!to) { skipped++; continue; }
  const values = {...(b.attributes || {})}, own = new Map(attributeTexts(b).map(c => [c.attributeTag, c]));
  const placed = [];
  let ok = true;
  for (const t of template) {
   const moved = carry(t, from, to); if (!moved) { ok = false; break; }
   const old = own.get(t.attributeTag);
   const value = Object.hasOwn(values, t.attributeTag) ? String(values[t.attributeTag]) : old ? old.text : String(reference.attributes?.[t.attributeTag] ?? t.text ?? '');
   values[t.attributeTag] = value;
   placed.push({...moved, id: old?.id ?? undefined, layer: old?.layer ?? moved.layer, text: value});
  }
  if (!ok) { skipped++; continue; }
  for (const tag of own.keys()) if (!template.some(t => t.attributeTag === tag)) extraTags.add(tag);
  const keep = (b.entities || []).filter(c => !(c?.type === 'text' && c.attributeTag != null && template.some(t => t.attributeTag === c.attributeTag)));
  updates.push({id: b.id, changes: {attributes: values, entities: [...keep, ...placed.map(c => { const {id, ...rest} = c; return id === undefined ? rest : c; })]}});
 }
 return {updates, synced: updates.length, skipped, extraTags: [...extraTags]};
}
