// 511 축척 목록(AutoCAD ACAD_SCALELIST 에 대응). 도면 필드: doc.scaleList = [{name, paper, drawing, unit?}]
//  name     표시 이름('1:100'). 사용자가 '1:100 평면' 처럼 바꿔도 된다.
//  paper    용지 단위(140). drawing 도면 단위(141). 비율(분모) = drawing / paper.
//  unit     DXF 290(단위 축척) 이 켜져 있던 항목만 true 로 남겨 다시 쓸 때 그대로 돌려준다.
// AutoCAD 는 1:1~1:100·2:1… 17개가 기본이고 1:200·1:300·1:500·1:600·1:1200 이 없다.
// 우리는 한국 건축 도면에 쓰는 축척을 기본으로 두고, 목록이 없는 도면은 저장하지 않은 채 기본값을 보여 준다(열기만 해서 도면이 바뀌지 않게).
// 같은 비율이 두 번 있으면 하나만 남긴다: 510 주석 표현은 비율 키('1:100')로 찾으므로 비율마다 한 항목이어야 헷갈리지 않는다.

export const KOREAN_ARCH_SCALES = Object.freeze([1, 5, 10, 20, 30, 50, 60, 100, 150, 200, 300, 500, 600, 1000, 1200]);

const round = (n) => Math.round(n * 1e6) / 1e6;

/** 비율(분모: 도면 단위 / 용지 단위)을 표현 키로. 100 → '1:100', 0.5 → '2:1'. */
export function scaleKey(ratio) {
 const k = Number(ratio);
 if (!(k > 0) || !Number.isFinite(k)) return null;
 return k >= 1 ? `1:${round(k)}` : `${round(1 / k)}:1`;
}

/** 축척 항목의 비율. 잘못된 항목은 null. */
export function scaleRatio(entry) {
 const paper = Number(entry?.paper), drawing = Number(entry?.drawing);
 return paper > 0 && drawing > 0 && Number.isFinite(paper) && Number.isFinite(drawing) ? drawing / paper : null;
}

/** 사용자가 친 축척을 비율로: 100, '100', '1:100', '1/100', '2:1', '1 : 50'. 못 읽으면 null. */
export function parseScale(value) {
 if (typeof value === 'number') return value > 0 && Number.isFinite(value) ? value : null;
 const text = String(value ?? '').trim().replace(/\s+/g, '');
 if (!text) return null;
 const pair = text.match(/^(\d+(?:\.\d+)?)[:/](\d+(?:\.\d+)?)$/);
 if (pair) { const paper = Number(pair[1]), drawing = Number(pair[2]); return paper > 0 && drawing > 0 ? drawing / paper : null; }
 const n = Number(text);
 return n > 0 && Number.isFinite(n) ? n : null;
}

/** 비율 하나를 축척 항목으로(1:k 는 paper 1, k:1 은 drawing 1). */
export function scaleEntry(ratio, name = null) {
 const k = Number(ratio);
 if (!(k > 0) || !Number.isFinite(k)) return null;
 return k >= 1 ? {name: name || scaleKey(k), paper: 1, drawing: round(k)} : {name: name || scaleKey(k), paper: round(1 / k), drawing: 1};
}

export function defaultScaleList() {
 return KOREAN_ARCH_SCALES.map(d => ({name: `1:${d}`, paper: 1, drawing: d}));
}

/**
 * 잘못된 값·이름 중복·비율 중복을 지우고 비율 순으로 정렬한 새 목록.
 * 인자는 문서(doc.scaleList 를 읽음) 또는 목록. 목록이 없거나 비면 기본 목록.
 */
export function normalizeScaleList(source) {
 const raw = Array.isArray(source) ? source : source?.scaleList;
 const list = Array.isArray(raw) && raw.length ? raw : defaultScaleList();
 const names = new Set(), ratios = new Set(), out = [];
 for (const item of list) {
  const ratio = scaleRatio(item);
  if (ratio === null) continue;
  const key = scaleKey(ratio), name = String(item.name ?? '').trim() || key;
  if (names.has(name.toUpperCase()) || ratios.has(key)) continue;
  names.add(name.toUpperCase());ratios.add(key);
  out.push({name, paper: Number(item.paper), drawing: Number(item.drawing), ...(item.unit ? {unit: true} : {})});
 }
 return out.sort((a, b) => scaleRatio(a) - scaleRatio(b));
}

/** 목록에서 비율로 찾기. */
export function findScale(list, ratio) {
 const key = scaleKey(ratio);
 return key ? normalizeScaleList(list).find(s => scaleKey(scaleRatio(s)) === key) || null : null;
}

/** 축척 더하기(이미 같은 비율이 있으면 그대로). 새 목록을 돌려준다. */
export function addScaleToList(source, ratio, name = null) {
 const list = normalizeScaleList(source), entry = scaleEntry(ratio, name && String(name).trim());
 if (!entry) throw Error('축척은 0보다 큰 수입니다. 예: 100 또는 1:100');
 if (list.some(s => scaleKey(scaleRatio(s)) === scaleKey(ratio))) return list;
 if (list.some(s => s.name.toUpperCase() === entry.name.toUpperCase())) throw Error(`이름 ${entry.name} 은(는) 이미 다른 축척이 쓰고 있습니다.`);
 return normalizeScaleList([...list, entry]);
}

/** 쓰고 있는 축척 키 모음. 현재 주석 축척·도곽(축척·주석 축척)·객체의 주석 표현·기억한 annoScale. 1:1 은 항상 지킨다(AutoCAD 와 같이). */
export function usedScaleKeys(doc, {entities = doc?.entities || [], extra = []} = {}) {
 const used = new Set(['1:1']);
 const add = (ratio) => { const key = scaleKey(ratio); if (key) used.add(key); };
 add(doc?.currentAnnoScale);
 for (const sheet of doc?.sheets || []) { add(sheet.denominator); add(sheet.annotationScale); }
 for (const e of entities) if (e && e.scales && typeof e.scales === 'object') { for (const key of Object.keys(e.scales)) { const r = parseScale(key); if (r) add(r); } add(e.annoScale); }
 for (const ratio of extra) add(ratio);
 return used;
}

/** 안 쓰는 축척 지우기. {list, removed} — 쓰는 축척(usedScaleKeys)은 남긴다. */
export function purgeUnusedScales(doc, options = {}) {
 const used = usedScaleKeys(doc, options), list = normalizeScaleList(doc), removed = [];
 const kept = list.filter(s => { const keep = used.has(scaleKey(scaleRatio(s))); if (!keep) removed.push(s); return keep; });
 return {list: kept, removed};
}

/** 지우기. 쓰고 있는 축척은 지우지 않고 이유를 돌려준다. {list, removed, blocked} */
export function removeScalesFromList(doc, ratios, options = {}) {
 const want = new Set(ratios.map(scaleKey).filter(Boolean)), used = usedScaleKeys(doc, options), list = normalizeScaleList(doc);
 const removed = [], blocked = [];
 const kept = list.filter(s => {
  const key = scaleKey(scaleRatio(s));
  if (!want.has(key)) return true;
  if (used.has(key)) { blocked.push(s); return true; }
  removed.push(s); return false;
 });
 return {list: kept, removed, blocked};
}

/** 기본 목록으로 되돌리기. 쓰고 있는 축척은 기본 목록에 없어도 남긴다(AutoCAD 초기화는 지워 버려 객체 표현이 목록에서 사라진다). */
export function resetScaleList(doc, options = {}) {
 const used = usedScaleKeys(doc, options), base = defaultScaleList(), have = new Set(base.map(s => scaleKey(scaleRatio(s))));
 const keep = normalizeScaleList(doc).filter(s => used.has(scaleKey(scaleRatio(s))) && !have.has(scaleKey(scaleRatio(s))));
 return normalizeScaleList([...base, ...keep]);
}

const truthy = (v) => v === true || v === 1 || String(v).trim() === '1';

/**
 * DXF ACAD_SCALELIST 항목([{300:이름, 140:용지, 141:도면, 290:단위 축척}], 값은 문자열이어도 된다) → doc.scaleList.
 * 잘못된 항목은 버리고 정리한다. 항목이 하나도 없으면 빈 배열(그 도면은 기본 목록을 쓰게).
 */
export function scaleFromDxf(entries) {
 if (!Array.isArray(entries) || !entries.length) return [];
 const list = entries.map(x => ({name: String(x?.[300] ?? x?.['300'] ?? '').trim(), paper: Number(x?.[140]), drawing: Number(x?.[141]), ...(truthy(x?.[290]) ? {unit: true} : {})}))
  .filter(s => scaleRatio(s) !== null);
 return list.length ? normalizeScaleList(list) : [];
}

/** doc.scaleList → DXF ACAD_SCALELIST 항목. key 는 AutoCAD 사전 키 규칙(A0~A9, B0~…). */
export function scaleListToDxf(list) {
 return normalizeScaleList(list).map((s, i) => ({key: `${String.fromCharCode(65 + Math.floor(i / 10))}${i % 10}`, 300: s.name, 140: s.paper, 141: s.drawing, 290: s.unit ? 1 : 0}));
}
