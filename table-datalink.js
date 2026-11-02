// 520 표 셀 스타일·엑셀 데이터 링크 명령.
//  DATALINK        엑셀 파일의 범위를 읽어 연결된 표로 그린다(table.link = {path, range, mtime, options}).
//  DATALINKUPDATE  연결된 표를 원본에서 다시 읽는다. 고른 표는 무조건, 안 고르면 원본이 바뀐 표만.
//  DATALINKNOTIFY  도면을 열 때 "원본이 바뀐 표" 알림 켜기/끄기(AutoCAD DATALINKNOTIFY=1 과 같은 기본: 켬).
//  TABLESTYLE      표의 제목·머리글·데이터 칸 모양과 칸 하나의 모양·정렬·서식.
// AutoCAD 는 데이터 링크 관리자에서 링크를 따로 관리하고 열 때마다 링크 전체를 확인한다. 우리는 링크를 표 안에 두고,
// 열 때 원본 "시각"만(파일마다 한 번) 비교해 바뀐 표만 한 번 알린다 — 내용은 사용자가 갱신을 고를 때만 읽는다.
// 표가 없는 도면은 아무것도 묻지 않는다(열기 직후 최상위 객체 한 번만 훑음, 매 명령 훑기 없음).
import {buildTableBlock, rebuildTableEntity, refreshLinkedTable, isLinkUpdateRequired, CELL_FORMATS, DEFAULT_CELL_STYLES,CELL_STYLE_NAMES} from './table-sheet-tools-4.js';
import {registerManualLabels} from './commands.js';

export const DATALINK_NOTIFY_KEY = 'barun-datalink-notify';
export const DATALINK_PATH_KEY = 'barun-datalink-last';

export function dataLinkNotifyEnabled(storage) {
 try { return storage?.getItem?.(DATALINK_NOTIFY_KEY) !== '0'; } catch { return true; }
}
const pathKey = p => String(p ?? '').replace(/\\/g, '/').toLowerCase();
const fileStem = p => String(p ?? '').split(/[\\/]/).pop().replace(/\.[^.]+$/, '') || '엑셀 표';
const sheetRange = (sheet, range) => sheet ? `${/^[\p{L}\p{N}_]+$/u.test(sheet) ? sheet : `'${sheet.replace(/'/g, "''")}'`}!${range}` : range;

/** 이 도면의 연결된 표(최상위 표 블록만). */
export function linkedTables(entities) {
 const out = [];
 for (const e of entities || []) if (e?.type === 'block' && e.table?.link?.path) out.push(e);
 return out;
}

/**
 * 도면을 연 뒤 한 번: 연결된 표가 있으면 원본 시각만 파일마다 한 번 묻고, 바뀌었거나 없어진 표를 한 번에 알린다.
 * 표가 없으면 api 를 부르지 않는다. 엔진이 아직 준비되지 않아 묻지 못하면 조용히 넘어간다(열기를 방해하지 않음).
 */
export async function notifyLinkedTables(doc, api, notify, {storage = globalThis.localStorage} = {}) {
 if (!dataLinkNotifyEnabled(storage)) return {tables: 0, changed: 0, missing: 0, skipped: true};
 const tables = linkedTables(doc?.entities);
 if (!tables.length) return {tables: 0, changed: 0, missing: 0};
 const groups = new Map();
 for (const t of tables) { const k = pathKey(t.table.link.path); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(t); }
 let changed = 0, missing = 0;
 const names = new Set();
 for (const list of groups.values()) {
  let stat;
  try { stat = await api('excel', {action: 'stat', path: list[0].table.link.path}); } catch { continue; }
  if (!stat?.exists) { missing += list.length; names.add(fileStem(list[0].table.link.path)); continue; }
  for (const t of list) if (isLinkUpdateRequired(t.table.link, {...t.table.link, mtime: stat.mtime})) { changed++; names.add(fileStem(t.table.link.path)); }
 }
 if (changed || missing) {
  const parts = [];
  if (changed) parts.push(`원본이 바뀐 엑셀 연결 표 ${changed}개`);
  if (missing) parts.push(`원본 엑셀을 찾을 수 없는 표 ${missing}개`);
  notify(`${parts.join(' · ')} (${[...names].slice(0, 3).join(', ')}${names.size > 3 ? ' 외' : ''}). DATALINKUPDATE 로 다시 읽습니다. 알림 끄기: DATALINKNOTIFY`);
 }
 return {tables: tables.length, changed, missing};
}

/** 파일 고르기 창으로 엑셀 파일의 실제 경로 얻기(데스크톱 앱에서만). 못 얻으면 null. */
export function browseExcelPath(doc = globalThis.document, desk = globalThis.window?.cadDesktop) {
 if (!doc?.createElement || typeof desk?.filePath !== 'function') return Promise.resolve(null);
 return new Promise(resolve => {
  const input = doc.createElement('input');
  input.type = 'file'; input.accept = '.xlsx,.xlsm'; input.hidden = true;
  const done = v => { input.remove?.(); resolve(v); };
  input.onchange = () => { const f = input.files?.[0]; let p = null; try { p = f ? desk.filePath(f) : null; } catch {} done(p || null); };
  input.oncancel = () => done(null);
  doc.body?.append?.(input);
  input.click();
 });
}

const ALIGN_CHOICES = [['', '표 전체 정렬 따름'], ['left', '왼쪽'], ['center', '가운데'], ['right', '오른쪽']];
/** TABLESTYLE 폼 값 → 새 table(값은 그대로, 모양만). */
export function styledTable(table, v) {
 const count = (value, label) => { const n = Number(value); if (!Number.isInteger(n) || n < 0 || n > table.rows.length) throw Error(`${label}은(는) 0~${table.rows.length} 사이 정수입니다.`); return n; };
 const titleRows = count(v.titleRows ?? 0, '제목 행 수'), headerRows = count(v.headerRows ?? 0, '머리글 행 수');
 if (titleRows + headerRows > table.rows.length) throw Error('제목·머리글 행 수가 표 행 수보다 많습니다.');
 const scale = Number(v.titleScale ?? 1.3);
 if (!(scale > 0 && scale <= 3)) throw Error('제목 문자 크기 배율은 0보다 크고 3 이하입니다.');
 const style = (align, extra = {}) => ({...(align ? {align} : {}), ...extra});
 const cellStyles = {
  title: style(v.titleAlign, {heightScale: scale}),
  header: style(v.headerAlign, v.headerFormat && v.headerFormat !== 'general' ? {format: v.headerFormat} : {}),
  data: style(v.dataAlign, v.dataFormat && v.dataFormat !== 'general' ? {format: v.dataFormat} : {}),
 };
 const cells = {...(table.cells || {})};
 const at = String(v.cellAt ?? '').trim();
 if (at) {
  const m = /^(\d+)\s*[,.\s]\s*(\d+)$/.exec(at);
  if (!m) throw Error('칸 지정은 "행,열" 입니다(예: 3,2 = 3행 2열).');
  const r = Number(m[1]) - 1, c = Number(m[2]) - 1, columns = Math.max(...table.rows.map(row => row.length));
  if (r < 0 || c < 0 || r >= table.rows.length || c >= columns) throw Error(`칸 ${at} 이(가) 표(${table.rows.length}행 ${columns}열) 밖입니다.`);
  const cell = {};
  if (v.cellStyle) cell.style = v.cellStyle;
  if (v.cellAlign) cell.align = v.cellAlign;
  if (v.cellFormat && v.cellFormat !== 'general') cell.format = v.cellFormat;
  if (Object.keys(cell).length) cells[`${r}:${c}`] = cell; else delete cells[`${r}:${c}`];
 }
 return {...table, titleRows, headerRows, cellStyles, cells};
}

export function installTableDataLink(ctx) {
 registerManualLabels([['데이터링크', 'DATALINK'], ['엑셀연결', 'DATALINK'], ['엑셀연결표', 'DATALINK'], ['DATALINK', 'DATALINK'], ['DATALINKUPDATE', 'DATALINKUPDATE'], ['엑셀갱신', 'DATALINKUPDATE'], ['데이터링크갱신', 'DATALINKUPDATE'], ['DATALINKNOTIFY', 'DATALINKNOTIFY'], ['TABLESTYLE', 'TABLESTYLE'], ['표스타일', 'TABLESTYLE'], ['칸모양', 'TABLESTYLE']]);
 const api = (...a) => { if (typeof ctx.api !== 'function') throw Error('로컬 처리 엔진에 연결되어 있지 않아 엑셀을 읽을 수 없습니다.'); return ctx.api(...a); };
 const storage = () => ctx.storage ?? globalThis.localStorage;
 const remember = (value) => { try { storage()?.setItem(DATALINK_PATH_KEY, JSON.stringify(value)); } catch {} };
 const last = () => { try { return JSON.parse(storage()?.getItem(DATALINK_PATH_KEY) || 'null') || {}; } catch { return {}; } };
 const lockedLayer = (e) => ctx.layers?.().find(l => l.id === e.layer)?.locked;
 const tablesIn = (list) => (list || []).filter(e => e?.type === 'block' && e.table);

 async function DATALINK() {
  const prev = last();
  return ctx.form('엑셀 범위를 연결된 표로 (DATALINK)', [
   {name: 'path', label: '엑셀 파일 경로 (.xlsx · 탐색기에서 "경로로 복사" 후 붙여넣기)', value: prev.path || ''},
   {name: 'browse', label: '파일 고르기 창으로 찾기 (데스크톱 앱)', type: 'checkbox', value: !prev.path},
   {name: 'range', label: '범위 (예: 면적표!A1:F20 · 비우면 첫 시트 전체)', value: prev.range || ''},
   {name: 'headerRows', label: '머리글 행 수 (가운데 정렬로 그림)', type: 'number', value: prev.headerRows ?? 1},
   {name: 'textHeight', label: '문자 높이 mm', type: 'number', value: Number(ctx.num?.('text-height', 150)) || 150},
  ], async v => {
   let path = String(v.path || '').trim();
   if (v.browse === 'on' || v.browse === true) path = (await (ctx.browseExcelPath || browseExcelPath)()) || path;
   if (!path) throw Error('연결할 엑셀 파일 경로를 넣거나 [파일 고르기 창으로 찾기]를 켜세요.');
   const height = Number(v.textHeight), headerRows = Math.max(0, Math.trunc(Number(v.headerRows) || 0));
   if (!(height > 0)) throw Error('문자 높이는 0보다 커야 합니다.');
   const stat = await api('excel', {action: 'stat', path});
   if (!stat?.exists) throw Error(`엑셀 파일을 찾을 수 없습니다: ${path}`);
   const r = await api('excel', {action: 'range', path, range: String(v.range || '').trim()});
   if (!r?.rows?.length) throw Error('엑셀 범위가 비어 있습니다. 범위를 확인하세요.');
   if (headerRows > r.rows.length) throw Error('머리글 행 수가 표 행 수보다 많습니다.');
   const point = await ctx.pickPoint({prompt: `DATALINK · ${r.rows.length}행 표의 왼쪽 위 모서리 · Esc 취소`});
   if (!point) return;
   const link = {path: stat.path || path, range: sheetRange(r.sheet, r.range), mtime: r.mtime ?? stat.mtime, options: {}};
   const block = buildTableBlock(r.rows, {x: point.x, y: point.y, height, layer: ctx.activeLayer?.(), name: fileStem(path), headerRows,
    cellStyles: headerRows ? structuredClone(DEFAULT_CELL_STYLES) : null, link});
   ctx.commit({entities: [block]});
   remember({path: link.path, range: String(v.range || '').trim(), headerRows});
   ctx.toast(`DATALINK · ${fileStem(path)} ${link.range} (${r.rows.length}행)을 연결된 표로 그렸습니다. 원본이 바뀌면 DATALINKUPDATE 로 다시 읽습니다.`);
  });
 }

 async function DATALINKUPDATE() {
  const chosen = tablesIn(ctx.selected?.()).filter(e => e.table.link?.path);
  const force = chosen.length > 0;
  const tables = force ? chosen : linkedTables(ctx.entities?.());
  if (!tables.length) throw Error('엑셀에 연결된 표가 없습니다. DATALINK 로 연결된 표를 만드세요.');
  const updates = [], failed = [];
  let locked = 0, same = 0;
  for (const t of tables) {
   if (lockedLayer(t)) { locked++; continue; }
   try { const u = await refreshLinkedTable(t, api, {force}); if (u) updates.push(u); else same++; }
   catch (e) { failed.push(`${t.name || '표'}: ${e.message}`); }
  }
  if (updates.length) ctx.execute({type: 'updateMany', updates});
  ctx.refresh?.();
  const parts = [`표 ${updates.length}개를 원본에서 다시 읽었습니다`];
  if (same) parts.push(`바뀌지 않은 표 ${same}개`);
  if (locked) parts.push(`잠긴 레이어 표 ${locked}개는 건너뜀`);
  if (failed.length) parts.push(`읽지 못함 ${failed.length}개 — ${failed.slice(0, 2).join(' / ')}`);
  ctx.toast(`DATALINKUPDATE · ${parts.join(' · ')}${updates.length ? ' · Ctrl+Z 로 되돌리기' : ''}`, !!failed.length && !updates.length);
  return {updated: updates.length, same, locked, failed: failed.length};
 }

 function DATALINKNOTIFY() {
  return ctx.form('도면을 열 때 엑셀 연결 표 확인 (DATALINKNOTIFY)', [
   {name: 'notify', label: '원본이 바뀐 표 알리기', value: dataLinkNotifyEnabled(storage()) ? '1' : '0', options: [['1', '알림 (기본 · 원본 시각만 확인)'], ['0', '끔 (열 때 확인하지 않음)']]},
  ], v => {
   try { storage()?.setItem(DATALINK_NOTIFY_KEY, v.notify === '0' ? '0' : '1'); } catch { throw Error('설정을 저장하지 못했습니다(저장소를 쓸 수 없음).'); }
   ctx.toast(v.notify === '0' ? 'DATALINKNOTIFY · 도면을 열 때 엑셀 연결 표를 확인하지 않습니다.' : 'DATALINKNOTIFY · 도면을 열 때 원본이 바뀐 표를 알립니다.');
  });
 }

 function TABLESTYLE() {
  const tables = tablesIn(ctx.selected?.());
  if (!tables.length) throw Error('칸 모양을 바꿀 표 블록을 먼저 선택하세요.');
  const t = tables[0].table, st = t.cellStyles || {};
  const styleChoices = [['', '그대로'], ...CELL_STYLE_NAMES];
  return ctx.form(`표 칸 모양 (TABLESTYLE) · 표 ${tables.length}개`, [
   {name: 'titleRows', label: '제목 행 수 (맨 위)', type: 'number', value: t.titleRows || 0},
   {name: 'headerRows', label: '머리글 행 수 (제목 아래)', type: 'number', value: t.headerRows || 0},
   {name: 'titleAlign', label: '제목 정렬', value: st.title?.align ?? 'center', options: ALIGN_CHOICES},
   {name: 'titleScale', label: '제목 문자 크기 배율', type: 'number', value: st.title?.heightScale ?? 1.3},
   {name: 'headerAlign', label: '머리글 정렬', value: st.header?.align ?? 'center', options: ALIGN_CHOICES},
   {name: 'headerFormat', label: '머리글 서식', value: st.header?.format || 'general', options: CELL_FORMATS},
   {name: 'dataAlign', label: '데이터 정렬', value: st.data?.align ?? '', options: ALIGN_CHOICES},
   {name: 'dataFormat', label: '데이터 서식 (숫자 칸에만 적용 · 값은 그대로)', value: st.data?.format || 'general', options: CELL_FORMATS},
   {name: 'cellAt', label: '칸 하나만 (행,열 · 예: 3,2 · 비우면 안 바꿈)', value: ''},
   {name: 'cellStyle', label: '그 칸의 모양', value: '', options: styleChoices},
   {name: 'cellAlign', label: '그 칸의 정렬', value: '', options: ALIGN_CHOICES},
   {name: 'cellFormat', label: '그 칸의 서식', value: 'general', options: CELL_FORMATS},
  ], v => {
   const updates = [];
   let locked = 0;
   for (const e of tables) {
    if (lockedLayer(e)) { locked++; continue; }
    const rebuilt = rebuildTableEntity(e, styledTable(e.table, v));
    updates.push({id: e.id, changes: {entities: rebuilt.entities, table: rebuilt.table}});
   }
   if (!updates.length) throw Error('선택한 표가 모두 잠긴 레이어에 있습니다.');
   ctx.execute({type: 'updateMany', updates});
   ctx.refresh?.();
   ctx.toast(`TABLESTYLE · 표 ${updates.length}개의 칸 모양을 바꿨습니다${locked ? ` · 잠긴 레이어 ${locked}개는 건너뜀` : ''} · 값은 그대로 · Ctrl+Z 로 되돌리기`);
  });
 }

 return {DATALINK, DATALINKUPDATE, DATALINKNOTIFY, TABLESTYLE};
}

