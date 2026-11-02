// ACAD200 702 레이어 필터(속성 필터·그룹 필터·자동 필터).
// AutoCAD: 자동 필터(모두·사용 중·미조정·외부참조)는 지우거나 이름을 바꿀 수 없고, 속성 필터는 조건식, 그룹 필터는 손으로 넣은 목록이다.
// 바른 CAD 가 더 나은 점:
//  - 자동 필터는 저장하지 않고 열 때 한 번 계산한다(도면이 바뀌어도 늘 맞다). "사용 중" 은 블록 정의 안까지 센 객체 수를 쓴다.
//  - "안 쓰는 레이어" 자동 필터가 있어 지울 수 있는 레이어가 바로 모인다(AutoCAD 는 PURGE 를 따로 열어야 한다).
//  - 속성 필터의 이름 조건은 와일드카드(*, ?, #)를 쓰고, 여러 패턴을 쉼표로 이어 쓸 수 있다. 앞에 ~ 를 붙이면 제외.
//  - 레이어가 없어진 그룹 필터는 남은 레이어만 보여 준다(오류 없음).
import {wildcardToRegExp} from './layer-tools-4.js';

export const AUTO_FILTERS = Object.freeze([
  {id: 'all', name: '모든 레이어', test: () => true},
  {id: 'used', name: '사용 중', test: (l, ctx) => (ctx.counts?.get(l.id) || 0) > 0},
  {id: 'unused', name: '안 쓰는 레이어(지울 수 있음)', test: (l, ctx) => !(ctx.counts?.get(l.id) || 0) && l.name !== '0'},
  {id: 'unreconciled', name: '새 레이어(확인 전)', test: (l) => l.reconciled === false},
  {id: 'xref', name: '외부참조', test: (l) => String(l.name).includes('|')},
  {id: 'locked', name: '잠긴 레이어', test: (l) => !!l.locked},
  {id: 'off', name: '꺼지거나 동결된 레이어', test: (l) => l.visible === false || !!l.frozen},
]);
export const RULE_KEYS = Object.freeze(['color', 'linetype', 'lineweight', 'visible', 'frozen', 'locked', 'plot', 'transparency']);

/** "벽*,A-*,~*임시*" → 이름 하나를 받아 맞는지 돌려주는 함수. 빈 패턴이면 모두 맞음. */
export function namePatternTest(pattern) {
  const parts = String(pattern ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!parts.length) return () => true;
  const include = [], exclude = [];
  for (const part of parts) {
    const negate = part.startsWith('~');
    (negate ? exclude : include).push(wildcardToRegExp(negate ? part.slice(1) : part));
  }
  return (name) => (!include.length || include.some((re) => re.test(name))) && !exclude.some((re) => re.test(name));
}

const sameValue = (key, layerValue, ruleValue) => {
  if (key === 'linetype') return String(layerValue ?? 'CONTINUOUS').toUpperCase() === String(ruleValue).toUpperCase();
  if (key === 'color') return String(layerValue ?? '').toLowerCase() === String(ruleValue).toLowerCase();
  if (key === 'lineweight' || key === 'transparency') return Math.abs(Number(layerValue ?? (key === 'lineweight' ? .25 : 0)) - Number(ruleValue)) < 1e-9;
  const defaults = {visible: true, frozen: false, locked: false, plot: true};
  return (layerValue ?? defaults[key] ?? null) === ruleValue;
};

export function layerMatchesRule(layer, rule = {}) {
  if (rule.name && !namePatternTest(rule.name)(layer.name)) return false;
  for (const key of RULE_KEYS) if (rule[key] !== undefined && rule[key] !== null && rule[key] !== '' && !sameValue(key, layer[key], rule[key])) return false;
  return true;
}

export function validateLayerFilter(filter) {
  if (!filter || typeof filter !== 'object') throw Error('레이어 필터 형식 오류');
  if (!String(filter.name || '').trim()) throw Error('필터 이름을 넣으세요.');
  if (AUTO_FILTERS.some((f) => f.id === filter.id || f.name === filter.name)) throw Error('자동 필터와 같은 이름은 쓸 수 없습니다.');
  if (filter.kind === 'group') { if (!Array.isArray(filter.ids)) throw Error('그룹 필터에는 레이어 목록이 필요합니다.'); }
  else if (filter.kind === 'property') { if (!filter.rule || typeof filter.rule !== 'object') throw Error('속성 필터 조건이 없습니다.'); }
  else throw Error('필터 종류는 property 또는 group 입니다.');
  return filter;
}

/** 필터를 더하거나(같은 이름이면 바꾼다) 새 목록을 돌려준다. document.update({layerFilters}) 로 넣는다. */
export function upsertLayerFilter(doc, filter, idFactory = () => 'lf-' + Math.random().toString(36).slice(2, 10)) {
  const list = Array.isArray(doc.layerFilters) ? doc.layerFilters : [];
  const existing = list.find((f) => f.name === filter.name);
  const next = validateLayerFilter({...filter, id: existing?.id || filter.id || idFactory()});
  return existing ? list.map((f) => (f === existing ? next : f)) : [...list, next];
}
export function removeLayerFilter(doc, id) {
  if (AUTO_FILTERS.some((f) => f.id === id)) throw Error('자동 필터는 지울 수 없습니다.');
  return (doc.layerFilters || []).filter((f) => f.id !== id);
}

export function filterLayers(doc, filterId, ctx = {}) {
  const auto = AUTO_FILTERS.find((f) => f.id === filterId);
  if (auto) return doc.layers.filter((l) => auto.test(l, ctx));
  const f = (doc.layerFilters || []).find((x) => x.id === filterId);
  if (!f) return doc.layers;
  if (f.kind === 'group') { const ids = new Set(f.ids); return doc.layers.filter((l) => ids.has(l.id)); }
  return doc.layers.filter((l) => layerMatchesRule(l, f.rule));
}

/** 관리자 왼쪽 목록: 자동 필터 + 저장한 필터, 각각 개수. */
export function layerFilterList(doc, ctx = {}) {
  return [
    ...AUTO_FILTERS.map((f) => ({id: f.id, name: f.name, auto: true, count: doc.layers.filter((l) => f.test(l, ctx)).length})),
    ...(doc.layerFilters || []).map((f) => ({id: f.id, name: f.name, auto: false, kind: f.kind, count: filterLayers(doc, f.id, ctx).length})),
  ];
}

/** 객체 수: 최상위 + 중첩(블록 참조 안) + 블록 정의 안. 한 번 훑는다. */
export function layerUsageCounts(doc) {
  const m = new Map();
  const add = (e) => { m.set(e.layer, (m.get(e.layer) || 0) + 1); const children = e.entities; if (children) for (const c of children) add(c); };
  for (const e of doc.entities || []) add(e);
  for (const b of doc.blocks || []) for (const e of b.entities || []) add(e);
  for (const def of Object.values(doc.sharedBlocks || {})) for (const e of def?.entities || []) add(e);
  return m;
}
