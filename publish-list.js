// ACAD200 724 PUBLISH 일괄 출력과 시트 묶음.
// AutoCAD: 도면의 배치 사전을 돌며 시트 목록(DSD)을 만들고, PUBLISHCOLLATE 이고 페이지 설정·원본이 모두 같으면 한 작업으로 묶는다.
// 바른 CAD 가 더 나은 점(1단계):
//  - 열려 있는 모든 도면 탭의 시트(doc.sheets)·배치를 한 목록으로 모아 한 PDF 로 만든다(파일을 다시 열지 않음).
//  - 묶음 규칙은 같다(페이지 설정 이름 대소문자 무시). 다르면 시트마다 따로 만들어 이어 붙인다.
//  - 목록은 .bpub(JSON)로 저장·불러오기 → 다음에 같은 묶음을 한 번에 다시 출력한다. 빠진 시트는 이름을 알려 주고 나머지만 출력하지 않고 멈춘다(빈 쪽 없음).
//  - 시트별 "도면이 바뀌었는지" 를 지문(객체 수·범위)으로 표시한다(AutoCAD IsOutOfDateLayout 대응).

export const PUBLISH_VERSION = 1;

export function makePublishList(entries) {
  return entries.map((e, i) => {
    if (!e?.sheetId) throw Error(`${i + 1}번째 항목에 시트가 없습니다.`);
    return {order: i + 1, file: String(e.file || ''), tab: e.tab ?? null, sheetId: String(e.sheetId), pageSetup: String(e.pageSetup || 'default'), title: String(e.title || ''), number: String(e.number || ''), fingerprint: e.fingerprint || null};
  });
}

/** 열린 탭들의 시트 → 목록 항목. tabs: [{id, name, doc}] */
export function collectSheets(tabs, {pageSetup = 'default'} = {}) {
  const out = [];
  for (const tab of tabs || []) {
    for (const sheet of tab.doc?.sheets || []) if (sheet?.bounds) out.push({file: tab.name || '', tab: tab.id ?? null, sheetId: sheet.id || sheet.number, pageSetup: sheet.pageSetup || pageSetup, title: sheet.title || '', number: sheet.number || '', fingerprint: sheetFingerprint(tab.doc, sheet)});
  }
  return makePublishList(out);
}

/** 시트 지문: 시트 범위 안(상자 기준) 객체 수와 시트 설정. 같은 도면이면 같은 값. */
export function sheetFingerprint(doc, sheet) {
  const b = sheet.bounds;
  let n = 0;
  for (const e of doc.entities || []) { const r = e._renderBounds; if (!r || !(r.maxX < b.minX || r.minX > b.maxX || r.maxY < b.minY || r.minY > b.maxY)) n++; }
  return [n, sheet.paper || 'A3', sheet.denominator || 100, b.minX, b.minY, b.maxX, b.maxY].join('|');
}
export function outOfDate(item, doc) {
  const sheet = (doc?.sheets || []).find((s) => (s.id || s.number) === item.sheetId);
  if (!sheet) return true;
  return !!item.fingerprint && item.fingerprint !== sheetFingerprint(doc, sheet);
}

export function groupForCollate(list, collate = true) {   // AutoCAD SetHomogeneity
  if (!collate || list.length < 2) return list.map((x) => [x]);
  const key = (x) => String(x.pageSetup).toLowerCase();
  return list.every((x) => key(x) === key(list[0])) ? [list] : list.map((x) => [x]);
}

/** 실행: resolve(item) → {doc, sheet}, plotPages(pages) → 결과 하나, merge(results) → 최종. 빠진 시트가 있으면 시작 전에 멈춘다. */
export async function runPublish(list, {resolve, plotPages, merge, onProgress, collate = true}) {
  const resolved = [], missing = [];
  for (const item of list) { const r = await resolve(item); if (r?.sheet) resolved.push({item, ...r}); else missing.push(`${item.file || '도면'} · ${item.number || item.sheetId}`); }
  if (missing.length) throw Error('찾지 못한 시트가 있어 출력하지 않았습니다: ' + missing.join(', '));
  const outputs = []; let n = 0;
  const byItem = new Map(resolved.map((r) => [r.item, r]));
  for (const group of groupForCollate(list, collate)) {
    const pages = group.map((item) => { const r = byItem.get(item); onProgress?.(++n, list.length); return {doc: r.doc, sheet: r.sheet, pageSetup: item.pageSetup, item}; });
    outputs.push(await plotPages(pages));
  }
  return merge(outputs);
}

export function serializePublishList(list) {
  return JSON.stringify({app: 'barun-cad', kind: 'publish-list', version: PUBLISH_VERSION, savedAt: new Date().toISOString(), items: list}, null, 1);
}
export function parsePublishList(text) {
  let data; try { data = JSON.parse(String(text)); } catch { throw Error('출력 목록 파일(.bpub)을 읽지 못했습니다.'); }
  if (data?.app !== 'barun-cad' || data.kind !== 'publish-list' || !Array.isArray(data.items)) throw Error('바른 CAD 출력 목록 파일이 아닙니다.');
  return makePublishList(data.items);
}
