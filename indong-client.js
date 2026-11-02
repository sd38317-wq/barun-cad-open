/* 인동거리 검토 — CAD 쪽은 규칙·면 구분·거리 계산을 갖지 않는다(설계 엔진 서버에서 계산, 로그인 필요).
   여기는 도면에 놓인 주동 블록마다 볼록 외곽 점을 모아 보내고, 서버가 돌려준 표시를 A-INDG-CHCK 에 그린다. */
import {standardLayerForName} from './layer-standards.js';

export const INDONG_CHECK_LAYER = 'A-INDG-CHCK';

/** 앤드루 단조 사슬 볼록 외곽(0.1mm 반올림). 서버도 원본 선으로 같은 방법을 써서 놓인 위치·회전을 맞춘다. */
export function convexHull(points) {
 const key = new Set(), pts = [];
 for (const p of points) {
  const q = [Math.round(p.x * 10) / 10, Math.round(p.y * 10) / 10], k = q[0] + ',' + q[1];
  if (!key.has(k)) { key.add(k); pts.push(q); }
 }
 pts.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
 if (pts.length <= 2) return pts;
 const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
 const lower = [], upper = [];
 for (const p of pts) { while (lower.length >= 2 && cross(lower.at(-2), lower.at(-1), p) <= 0) lower.pop(); lower.push(p); }
 for (const p of [...pts].reverse()) { while (upper.length >= 2 && cross(upper.at(-2), upper.at(-1), p) <= 0) upper.pop(); upper.push(p); }
 return lower.slice(0, -1).concat(upper.slice(0, -1));
}

const childPoints = (entities, out = []) => {
 for (const e of entities || []) { if (Array.isArray(e.points)) out.push(...e.points); childPoints(e.entities, out); }
 return out;
};

/** 서버로 보낼 요청: 놓인 주동(JUTONG_ID 가 있는 블록)마다 외곽 점과 층수만. */
export function indongRequest(doc, {floors, floorHeight}) {
 const buildings = [];
 for (const e of doc.entities || []) {
  const id = e.type === 'block' && (e.attributes?.JUTONG_ID || e.jutong?.id);
  if (!id) continue;
  const f = Number(e.attributes?.FLOORS);
  buildings.push({ref: e.id, jutong_id: id, floors: Number.isFinite(f) && f > 0 ? f : null, hull: convexHull(childPoints(e.entities))});
 }
 return {version: 1, floors_default: floors, floor_height_m: floorHeight, buildings};
}

/** 서버 결과 표시를 그린 새 도면(이전 A-INDG-CHCK 표시는 지움). */
export function applyIndongMarks(doc, result) {
 const layers = doc.layers.slice();
 let check = layers.find(l => l.name === INDONG_CHECK_LAYER);
 if (!check) { check = {...standardLayerForName(INDONG_CHECK_LAYER), id: crypto.randomUUID(), visible: true, locked: false, frozen: false}; layers.push(check); }
 const pt = p => ({x: Number(p[0]), y: Number(p[1])});
 const marks = [];
 for (const m of result?.marks || []) {
  const color = m.ok ? '#22a447' : '#e5484d';
  if (m.type === 'line') marks.push({id: crypto.randomUUID(), type: 'line', layer: check.id, color, points: [pt(m.from), pt(m.to)]});
  else if (m.type === 'text') marks.push({id: crypto.randomUUID(), type: 'text', layer: check.id, color, text: String(m.text), height: 900, rotation: 0, position: pt(m.at)});
 }
 if (marks.some(m => [m.points?.[0], m.points?.[1], m.position].some(p => p && !(Number.isFinite(p.x) && Number.isFinite(p.y))))) throw Error('서버 표시 좌표가 올바르지 않습니다.');
 return {document: {...doc, layers, entities: doc.entities.filter(e => e.layer !== check.id).concat(marks)}, added: marks.map(m => m.id)};
}
