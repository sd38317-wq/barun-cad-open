// 4차 병렬 작업(2026-09-21): 표·도곽 11개(부분 매핑을 원문대로 다시 만든다) — C2E E2C RDT TB TBM TBT BMT DBS MDL TN TOB.
// 근거: docs/izzarder-reference-20260921/references/04-hatch-table.md(C2E/306, E2C/208, RDT/588, TB/295, TBM/151, TBT/296),
//       09-titleblock.md(BMT/474, DBS/532, MDL/158, TN/91, TOB/521) — 각 함수 주석에 원문 번호(/NNN)를 적었다.
// 대체하는 기존 명령: EXCEL(C2E·E2C) TABLESPACING(RDT) TABLE(TB) TABLECELLMERGE(TBM) TABLEEDIT(TBT)
//                      SHEETCOPY(BMT) SHEETALIGN(DBS) SHEETLIST(MDL) SHEETNUMBER(TN) BLOCKREPLACE(TOB)
// 바른 CAD 의 "표"는 studio.js tableBlock() 이 만드는 {type:'block',entities,table:{rows,height,widths,rowHeight,align,merges}}
// 형태뿐이고(ACAD_TABLE 이 아니다) — studio.js/workflows.js/engine.js/app.js 는 읽기만 하고 import 하지 않으므로(공유 파일·
// DOM·엔진 전역 상태 의존 금지) 아래 buildTableBlock() 은 그 계산을 그대로 옮겨 적은 것이다.
// "도곽"은 engine.doc.sheets 사전등록 레코드([SHEET/PLOTBOX] 명령)이거나 화면의 블록/폐폴리선인데, 카드 문맥(ctx, app.js
// 4635행)에는 engine.doc.sheets 가 없다. 그래서 BMT/DBS/MDL/TN/TOB 는 바른 CAD 리습 원문처럼 "화면에서 선택한 객체를 직접
// 인식"해서 동작한다(사전등록 없이) — 2차 검증이 지적한 "구조적 차이"를 바른 CAD 리습 쪽으로 좁히는 선택이다.
// 엑셀 파일 입출력(COM)은 없어 C2E/E2C 는 클립보드(탭 구분 텍스트)로 대신한다.
import * as G from './geometry.js';
import {clipboardWrite, clipboardRead} from './card-input.js';

/* ══════════ 공용 수·표 유틸(시험용, DOM 없이 동작) ══════════ */
const num = (v, label = '값') => { const n = Number(v); if (!Number.isFinite(n)) throw Error(label + '에 숫자를 입력하세요.'); return n; };
const positive = (v, label) => { const n = num(v, label); if (n <= 0) throw Error(label + '은 0보다 커야 합니다.'); return n; };

/* buildTableBlock — studio.js tableBlock()(27~46행)을 그대로 옮겨 적었다. TB/E2C/MDL 이 표를 새로 그릴 때,
   TBM/TBT/RDT 가 표를 다시 그릴 때 공통으로 쓴다. */
/* 520 셀 스타일: 표에 제목·머리글·데이터 세 가지 칸 모양(cellStyles)을 두고, 칸마다 {style, align, format} 을 덧붙일 수 있다.
   AutoCAD 는 표 스타일 객체(ACAD_TABLESTYLE)를 따로 두지만, 우리는 표 블록 table 안에 값으로 들고 다녀 복사·붙여넣기·
   다른 도면으로 옮겨도 모양이 따라간다. 값(rows)은 그대로 두고 그릴 때만 서식(format)을 입혀 원래 숫자를 잃지 않는다.
   cellStyles·cells·titleRows·headerRows 가 하나도 없으면 예전과 똑같이 그린다. */
export const CELL_STYLE_NAMES = Object.freeze([['title', '제목'], ['header', '머리글'], ['data', '데이터']]);
export const DEFAULT_CELL_STYLES = Object.freeze({ title: Object.freeze({ heightScale: 1.3, align: 'center' }), header: Object.freeze({ heightScale: 1, align: 'center' }), data: Object.freeze({}) });
export const CELL_FORMATS = Object.freeze([['general', '그대로'], ['number:0', '천 단위 쉼표 · 소수 없음'], ['number:1', '천 단위 쉼표 · 소수 1자리'], ['number:2', '천 단위 쉼표 · 소수 2자리'], ['fixed:2', '소수 2자리(쉼표 없음)'], ['percent:1', '백분율 · 소수 1자리'], ['text', '글자 그대로(숫자로 바꾸지 않음)']]);
const cellKey = (r, c) => r + ':' + c;
export function cellStyleOf(table, r, c) {
  const own = table?.cells?.[cellKey(r, c)]?.style;
  if (own) return own;
  const titleRows = Number(table?.titleRows) || 0, headerRows = Number(table?.headerRows) || 0;
  return r < titleRows ? 'title' : r < titleRows + headerRows ? 'header' : 'data';
}
/** 칸 값 → 보이는 글. 숫자 서식은 숫자(또는 숫자 글)에만 입히고, 아니면 그대로 둔다. */
export function formatCellValue(value, format) {
  const s = String(value ?? '');
  if (!format || format === 'general' || format === 'text') return s;
  const m = /^(number|fixed|percent):([0-6])$/.exec(String(format));
  if (!m) throw Error(`칸 서식 "${format}" 을(를) 알 수 없습니다.`);
  const n = typeof value === 'number' ? value : (s.trim() !== '' ? Number(s.replace(/,/g, '')) : NaN);
  if (!Number.isFinite(n)) return s;
  const d = Number(m[2]);
  if (m[1] === 'fixed') return n.toFixed(d);
  if (m[1] === 'percent') return (n * 100).toFixed(d) + '%';
  return n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
}
const ALIGNS = ['left', 'center', 'right'];
function normalizedCells(cells, rowCount, columns) {
  if (!cells || typeof cells !== 'object') return null;
  const out = {};
  for (const [key, cell] of Object.entries(cells)) {
    const m = /^(\d+):(\d+)$/.exec(key);
    if (!m || Number(m[1]) >= rowCount || Number(m[2]) >= columns || !cell || typeof cell !== 'object') continue;   // 표가 줄면 칸 설정도 같이 줄인다
    const next = {};
    if (cell.style) { if (!CELL_STYLE_NAMES.some(([k]) => k === cell.style)) throw Error(`칸 모양 "${cell.style}" 을(를) 알 수 없습니다.`); next.style = cell.style; }
    if (cell.align) { if (!ALIGNS.includes(cell.align)) throw Error('칸 문자 정렬 오류'); next.align = cell.align; }
    if (cell.format && cell.format !== 'general') { formatCellValue(1, cell.format); next.format = cell.format; }
    if (Object.keys(next).length) out[key] = next;
  }
  return Object.keys(out).length ? out : null;
}

export function buildTableBlock(rows, { x = 0, y = 0, height = 150, widths = null, rowHeight = null, align = 'left', merges = [], name = '표', layer, cellStyles = null, cells = null, titleRows = 0, headerRows = 0, link = null } = {}) {
  if (!Array.isArray(rows) || !rows.length) throw Error('표에 행이 없습니다.');
  const columns = Math.max(...rows.map(r => Array.isArray(r) ? r.length : 0));
  if (!columns) throw Error('표에 열이 없습니다.');
  rowHeight = rowHeight ?? height * 2.2;
  if (!(Number.isFinite(height) && height > 0 && Number.isFinite(rowHeight) && rowHeight >= height * 1.2)) throw Error('표 문자 높이와 행 높이를 확인하세요.');
  widths = widths ? widths.map(Number) : Array.from({ length: columns }, (_, i) => Math.max(4.8, ...rows.map(r => G.textUnits({}, String(r[i] ?? '')))) * height + height * 2)  // 508: 실제 글자 폭(한글이 칸을 넘지 않게);
  if (widths.length !== columns || widths.some(w => !Number.isFinite(w) || w < height * 2)) throw Error('표 열 너비를 확인하세요.');
  if (!['left', 'center', 'right'].includes(align)) throw Error('표 문자 정렬 오류');
  const occupied = new Set(), normalizedMerges = (merges || []).map(m => ({ r1: Number(m.r1), c1: Number(m.c1), r2: Number(m.r2), c2: Number(m.c2) }));
  for (const m of normalizedMerges) {
    if (![m.r1, m.c1, m.r2, m.c2].every(Number.isInteger) || m.r1 < 0 || m.c1 < 0 || m.r2 < m.r1 || m.c2 < m.c1 || m.r2 >= rows.length || m.c2 >= columns || (m.r1 === m.r2 && m.c1 === m.c2)) throw Error('병합 셀 범위를 확인하세요.');
    for (let r = m.r1; r <= m.r2; r++) for (let c = m.c1; c <= m.c2; c++) { const key = r + ':' + c; if (occupied.has(key)) throw Error('병합 셀 범위가 겹칩니다.'); occupied.add(key); }
  }
  const xs = [x]; for (const w of widths) xs.push(xs.at(-1) + w);
  const total = xs.at(-1) - x, entities = [];
  const hBlocked = (r, c) => normalizedMerges.some(m => m.r1 < r && m.r2 >= r && c >= m.c1 && c <= m.c2);
  const vBlocked = (r, c) => normalizedMerges.some(m => m.c1 < c && m.c2 >= c && r >= m.r1 && r <= m.r2);
  for (let r = 0; r <= rows.length; r++) {
    const yy = y - r * rowHeight;
    if (r === 0 || r === rows.length) entities.push({ type: 'line', layer, points: [{ x, y: yy }, { x: x + total, y: yy }] });
    else for (let c = 0; c < columns; c++) if (!hBlocked(r, c)) entities.push({ type: 'line', layer, points: [{ x: xs[c], y: yy }, { x: xs[c + 1], y: yy }] });
  }
  for (let c = 0; c <= columns; c++) {
    if (c === 0 || c === columns) entities.push({ type: 'line', layer, points: [{ x: xs[c], y }, { x: xs[c], y: y - rows.length * rowHeight }] });
    else for (let r = 0; r < rows.length; r++) if (!vBlocked(r, c)) entities.push({ type: 'line', layer, points: [{ x: xs[c], y: y - r * rowHeight }, { x: xs[c], y: y - (r + 1) * rowHeight }] });
  }
  const covering = (r, c) => normalizedMerges.find(m => r >= m.r1 && r <= m.r2 && c >= m.c1 && c <= m.c2);
  titleRows = Math.max(0, Math.trunc(Number(titleRows) || 0)); headerRows = Math.max(0, Math.trunc(Number(headerRows) || 0));
  const styles = cellStyles && typeof cellStyles === 'object' ? cellStyles : null;
  if (styles) for (const [key, st] of Object.entries(styles)) {
    if (!CELL_STYLE_NAMES.some(([k]) => k === key)) throw Error(`칸 모양 "${key}" 을(를) 알 수 없습니다.`);
    if (st?.align && !ALIGNS.includes(st.align)) throw Error('칸 모양 문자 정렬 오류');
    if (st?.heightScale !== undefined && !(Number(st.heightScale) > 0 && Number(st.heightScale) <= 3)) throw Error('칸 모양 문자 크기 배율은 0~3 입니다.');
    if (st?.format && st.format !== 'general') formatCellValue(1, st.format);
  }
  const cellMap = normalizedCells(cells, rows.length, columns);
  const meta = { cells: cellMap, titleRows, headerRows };
  for (let r = 0; r < rows.length; r++) for (let c = 0; c < columns; c++) {
    const merge = covering(r, c); if (merge && (r !== merge.r1 || c !== merge.c1)) continue;
    const c2 = merge?.c2 ?? c, r2 = merge?.r2 ?? r, left = xs[c], right = xs[c2 + 1];
    const st = styles?.[cellStyleOf(meta, r, c)] || {}, own = cellMap?.[cellKey(r, c)] || {};
    const a = own.align || st.align || align, h = Math.min(height * (Number(st.heightScale) > 0 ? Number(st.heightScale) : 1), rowHeight / 1.2);
    const position = { x: a === 'left' ? left + height * .5 : a === 'right' ? right - height * .5 : (left + right) / 2, y: y - (r + r2 + 1) * rowHeight / 2 - h * .35 };
    entities.push({ type: 'text', layer, position, height: h, rotation: 0, text: formatCellValue(rows[r][c], own.format || st.format), align: a, tableCell: { row: r, column: c } });
  }
  const table = { rows: structuredClone(rows), height, widths, rowHeight, align, merges: normalizedMerges };
  if (styles) table.cellStyles = structuredClone(styles);
  if (cellMap) table.cells = cellMap;
  if (titleRows) table.titleRows = titleRows;
  if (headerRows) table.headerRows = headerRows;
  if (link) table.link = structuredClone(link);
  return { type: 'block', layer, name, entities, table };
}

// 캐드 표 블록의 셀 좌표. 표가 회전 없이(TB 가 만드는 그대로) 놓여 있다고 본다 — 한계는 보고서 참고.
export function tableBounds(entity) {
  const b = G.bounds(entity.entities || []);
  if (!b) throw Error('표 범위를 계산할 수 없습니다.');
  return b;
}
export function cellAt(entity, point) {
  const t = entity.table; if (!t) throw Error('바른 CAD 표 블록이 아닙니다(TB 로 만든 캐드 표만 대상).');
  const b = tableBounds(entity);
  const xs = [b.minX]; for (const w of t.widths) xs.push(xs.at(-1) + w);
  let col = -1;
  for (let i = 0; i < xs.length - 1; i++) if (point.x >= xs[i] - 1e-6 && point.x <= xs[i + 1] + 1e-6) { col = i; break; }
  if (col < 0) col = point.x < b.minX ? 0 : t.widths.length - 1;
  let row = Math.floor((b.maxY - point.y) / t.rowHeight);
  row = Math.max(0, Math.min(t.rows.length - 1, row));
  col = Math.max(0, Math.min(t.widths.length - 1, col));
  return { row, col };
}
// TBM(/151) 셀 합치기: workflows.js tableTools()의 merge 로직(99행)을 그대로 옮겨 적었다.
export function mergeCells(table, r1, c1, r2, c2) {
  if (![r1, c1, r2, c2].every(Number.isInteger)) throw Error('셀 번호는 정수입니다.');
  if (r2 < r1) [r1, r2] = [r2, r1];
  if (c2 < c1) [c1, c2] = [c2, c1];
  const rows = structuredClone(table.rows), merges = structuredClone(table.merges || []);
  const columns = Math.max(...rows.map(r => r.length));
  if (r1 < 0 || c1 < 0 || r2 >= rows.length || c2 >= columns) throw Error('셀 범위가 표를 벗어났습니다.');
  if (r1 === r2 && c1 === c2) throw Error('두 셀 이상을 지정하세요.');
  if (merges.some(m => !(r2 < m.r1 || r1 > m.r2 || c2 < m.c1 || c1 > m.c2))) throw Error('기존 병합 범위와 겹칩니다. 먼저 병합을 해제하세요.');
  const values = [];
  for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) {
    const v = rows[r]?.[c];
    if (v !== undefined && String(v).trim()) values.push(String(v));
    if (r !== r1 || c !== c1) { rows[r] ??= []; rows[r][c] = ''; }
  }
  rows[r1][c1] = values.join(' ');
  merges.push({ r1, c1, r2, c2 });
  return { ...table, rows, merges };
}
// TBM(/151) 복구(R): 지정한 셀이 속한 병합을 해제한다.
export function unmergeAt(table, r, c) {
  const merges = structuredClone(table.merges || []);
  const kept = merges.filter(m => !(r >= m.r1 && r <= m.r2 && c >= m.c1 && c <= m.c2));
  if (kept.length === merges.length) throw Error('지정한 셀은 병합되어 있지 않습니다.');
  return { ...table, merges: kept };
}
// TBT(/296) 셀 문자 넣기.
export function setCellText(table, r, c, text) {
  if (r < 0 || c < 0 || r >= table.rows.length) throw Error('셀 위치가 표를 벗어났습니다.');
  const rows = structuredClone(table.rows);
  rows[r] ??= [];
  rows[r][c] = text;
  return { ...table, rows };
}
// TBM/TBT/RDT 공용: 기존 표 블록의 왼쪽 위 모서리를 유지한 채 표 내용만 바꿔 다시 그린다.
export function rebuildTableEntity(entity, table) {
  const b = tableBounds(entity);
  return buildTableBlock(table.rows, { x: b.minX, y: b.maxY, height: table.height, widths: table.widths, rowHeight: table.rowHeight, align: table.align, merges: table.merges, layer: entity.layer, name: entity.name,
    cellStyles: table.cellStyles, cells: table.cells, titleRows: table.titleRows, headerRows: table.headerRows, link: table.link });
}

/* 520 엑셀 데이터 링크: table.link = {path, range, mtime, options}. AutoCAD IsUpdateRequired 처럼 경로·범위·원본 시각·옵션 중
   하나라도 다를 때만 다시 읽는다(바뀐 것만). source 에 없는 항목(range·options)은 링크 값과 같다고 본다. */
const samePath = (a, b) => String(a ?? '').replace(/\\/g, '/').toLowerCase() === String(b ?? '').replace(/\\/g, '/').toLowerCase();
export function isLinkUpdateRequired(link, source) {
  if (!link?.path || !source) return false;
  if (!samePath(link.path, source.path ?? link.path)) return true;
  if (String(link.range ?? '').toUpperCase() !== String(source.range ?? link.range ?? '').toUpperCase()) return true;
  if (Number(link.mtime) !== Number(source.mtime)) return true;
  return JSON.stringify(link.options ?? {}) !== JSON.stringify(source.options ?? link.options ?? {});
}
/** 연결된 표를 새 값(rows)으로 다시 그린 변경. 열 수가 같으면 열 너비를 지키고, 벗어난 병합은 버린다. 왼쪽 위 모서리는 그대로. */
export function linkedTableChanges(entity, rows, { mtime } = {}) {
  const t = entity?.table;
  if (!t?.link) throw Error('엑셀에 연결된 표가 아닙니다.');
  if (!Array.isArray(rows) || !rows.length || !rows.some(r => Array.isArray(r) && r.length)) throw Error('엑셀 범위가 비어 있습니다. 범위를 확인하세요.');
  const columns = Math.max(...rows.map(r => r.length)), oldColumns = Math.max(...t.rows.map(r => r.length));
  const merges = (t.merges || []).filter(m => m.r2 < rows.length && m.c2 < columns);
  const next = { ...t, rows, merges, widths: columns === oldColumns ? t.widths : null, link: { ...t.link, ...(mtime !== undefined ? { mtime } : {}) } };
  const rebuilt = rebuildTableEntity(entity, next);
  return { entities: rebuilt.entities, table: rebuilt.table };
}
/** 표 하나 갱신: 원본 시각만 먼저 보고(stat), 바뀌었을 때만 범위를 다시 읽는다. 바뀐 게 없으면 null. */
export async function refreshLinkedTable(entity, api, { force = false } = {}) {
  const link = entity?.table?.link;
  if (!link?.path) return null;
  const stat = await api('excel', { action: 'stat', path: link.path });
  if (!force && !isLinkUpdateRequired(link, { ...link, mtime: stat.mtime })) return null;
  const r = await api('excel', { action: 'range', path: link.path, range: link.range || '' });
  return { id: entity.id, changes: linkedTableChanges(entity, r.rows, { mtime: r.mtime ?? stat.mtime }) };
}

// C2E/E2C 공용: 탭 구분 텍스트 ↔ 표 행. 원문은 실제 엑셀(COM)이지만 카드 문맥에 파일 입출력이 없어 클립보드로 대신한다.
// 2026-10-06(봇 점검 C2E·E2C): 엑셀 클립보드 규칙을 따른다 — 줄바꿈·탭·따옴표가 든 칸은 "…"로 싸이고 안의 " 는 "" 로 적힌다.
// 예전에는 줄을 그냥 잘라 칸 안 줄바꿈이 다른 행으로 흩어졌고, "0101"(호수)·"1e3"·"0x10" 같은 글자가 숫자로 바뀌어
// 앞자리 0 이 사라졌다. 이제 "10"·"12.5"·"-3" 처럼 숫자로 다시 적어도 같은 글자만 숫자로 읽는다. 가운데 빈 행은 남긴다.
function splitTsv(text) {
  const s = String(text || ''), rows = [];
  let row = [], cell = '', i = 0, quoted = false, started = true;
  const endCell = () => { row.push(cell); cell = ''; started = true; };
  const endRow = () => { endCell(); rows.push(row); row = []; };
  while (i < s.length) {
    const ch = s[i];
    if (quoted) {
      if (ch === '"' && s[i + 1] === '"') { cell += '"'; i += 2; continue; }
      if (ch === '"' && (i + 1 === s.length || s[i + 1] === '\t' || s[i + 1] === '\n' || s[i + 1] === '\r')) { quoted = false; i++; continue; }
      cell += ch; i++; continue;
    }
    if (started && ch === '"' && s.indexOf('"', i + 1) > i) { quoted = true; started = false; i++; continue; }
    started = false;
    if (ch === '\t') { endCell(); i++; continue; }
    if (ch === '\r' && s[i + 1] === '\n') { endRow(); i += 2; continue; }
    if (ch === '\n' || ch === '\r') { endRow(); i++; continue; }
    cell += ch; i++;
  }
  if (cell !== '' || row.length) endRow();
  return rows;
}
const tsvValue = v => { const s = v.trim(); return s !== '' && Number.isFinite(Number(s)) && String(Number(s)) === s ? Number(s) : s; };
export function tsvToRows(text) {
  const rows = splitTsv(text).map(r => r.map(tsvValue));
  const blank = r => r.every(v => v === '');
  while (rows.length && blank(rows[0])) rows.shift();
  while (rows.length && blank(rows[rows.length - 1])) rows.pop();
  if (!rows.length) throw Error('표 내용이 없습니다.');
  return rows;
}
const tsvCell = v => { const s = String(v ?? ''); return /[\t\r\n]|^"/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
export function rowsToTsv(rows) {
  if (!Array.isArray(rows) || !rows.length) throw Error('내보낼 표 내용이 없습니다.');
  return rows.map(r => r.map(tsvCell).join('\t')).join('\n');
}
// C2E(/306): 임의의 "선+문자" 표(우리 앱의 table 블록이 아닌 것)도 인식하도록, 선택된 문자들의 좌표를 행/열로
// 묶는다(workflows.js TABLE 'read' 액션 297행의 문자-그리드 인식 로직을 옮겨 적었다).
export function textGridToRows(texts, tolerance) {
  if (!texts.length) throw Error('표로 인식할 문자 객체가 없습니다.');
  const tol = tolerance > 0 ? tolerance : Math.min(...texts.map(t => t.height || 100)) * .5;
  const xs = [], ys = [];
  for (const t of texts) {
    if (!xs.some(x => Math.abs(x - t.position.x) < tol)) xs.push(t.position.x);
    if (!ys.some(y => Math.abs(y - t.position.y) < tol)) ys.push(t.position.y);
  }
  xs.sort((a, b) => a - b); ys.sort((a, b) => b - a);
  const rows = ys.map(() => xs.map(() => ''));
  for (const t of texts) {
    const col = xs.findIndex(x => Math.abs(x - t.position.x) < tol), row = ys.findIndex(y => Math.abs(y - t.position.y) < tol);
    rows[row][col] += (rows[row][col] ? ' ' : '') + t.text;
  }
  return rows;
}

// RDT(/588) 표 간격 변경: 3단계 점 지정(기준점 → 변경 길이 → 기준 칸) 중 처음 둘로 영역과 축·배율을 정하고,
// 그 영역 안의 선·문자를 기준점에서부터 한 축으로만 비례 재배치한다(회전된 표는 지원하지 않는다).
export function boxFromCorners(p0, p1) {
  return { minX: Math.min(p0.x, p1.x), minY: Math.min(p0.y, p1.y), maxX: Math.max(p0.x, p1.x), maxY: Math.max(p0.y, p1.y) };
}
export function rdtAxis(p0, p2) {
  return Math.abs(p2.x - p0.x) >= Math.abs(p2.y - p0.y) ? 'x' : 'y';
}
export function rescalePoint(point, axis, anchor, scale) {
  return axis === 'x' ? { x: anchor + (point.x - anchor) * scale, y: point.y } : { x: point.x, y: anchor + (point.y - anchor) * scale };
}
export function withinBox(point, box, tol = 1e-6) {
  return point.x >= box.minX - tol && point.x <= box.maxX + tol && point.y >= box.minY - tol && point.y <= box.maxY + tol;
}
export function redivideUpdates(entities, box, axis, anchor, scale) {
  const updates = [];
  for (const e of entities || []) {
    if ((e.type === 'line' || e.type === 'polyline' || e.type === 'rectangle') && Array.isArray(e.points)) {
      if (!e.points.some(p => withinBox(p, box))) continue;
      updates.push({ id: e.id, changes: { points: e.points.map(p => rescalePoint(p, axis, anchor, scale)) } });
    } else if (e.type === 'text' && e.position && withinBox(e.position, box)) {
      updates.push({ id: e.id, changes: { position: rescalePoint(e.position, axis, anchor, scale) } });
    }
  }
  return updates;
}

// TN(/91) 도면번호 분할: "AE-013" → prefix "AE-" · number "013" · suffix "" (92-lisp-foundation.md 로직을 JS 로 옮겼다).
export function splitPrefixNumberSuffix(str) {
  const s = String(str ?? '');
  const m = /^(\D*?)(\d+)(\D*)$/.exec(s);
  if (!m) throw Error('문자열에서 숫자를 찾지 못했습니다: ' + s);
  return { prefix: m[1], number: m[2], suffix: m[3], digits: m[2].length };
}
export function formatNumbered(prefix, n, digits, suffix) {
  const s = String(Math.trunc(n));
  const neg = s.startsWith('-'), body = neg ? s.slice(1) : s;
  return (neg ? '-' : '') + prefix + (body.length < digits ? body.padStart(digits, '0') : body) + suffix;
}
export function anchorOf(entity) {
  const b = G.bounds([entity]);
  if (!b) throw Error('객체의 범위를 계산할 수 없습니다.');
  return { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 };
}
export function relativeOffset(anchor, point) { return { dx: point.x - anchor.x, dy: point.y - anchor.y }; }
export function applyOffset(anchor, offset) { return { x: anchor.x + offset.dx, y: anchor.y + offset.dy }; }
export function nearestTextAt(texts, point, tolerance) {
  let best = null, bd = tolerance;
  for (const t of texts || []) {
    const d = Math.hypot(t.position.x - point.x, t.position.y - point.y);
    if (d < bd) { bd = d; best = t; }
  }
  return best;
}

// TN/MDL/DBS 공용 "정렬기준점 및 순서" 8방향(09-titleblock.md 공통패턴): 시작 모서리(t/b·l/r) + 진행 방향(줄/열).
export const ORDER_MODES = [
  ['tl-row', '① 좌상→우측 (윗줄부터, 왼쪽→오른쪽)'],
  ['tl-col', '② 좌상→아래 (왼쪽줄부터, 위→아래)'],
  ['tr-row', '③ 우상→좌측 (윗줄부터, 오른쪽→왼쪽)'],
  ['tr-col', '④ 우상→아래 (오른쪽줄부터, 위→아래)'],
  ['bl-row', '⑤ 좌하→우측 (아랫줄부터, 왼쪽→오른쪽)'],
  ['bl-col', '⑥ 좌하→위 (왼쪽줄부터, 아래→위)'],
  ['br-row', '⑦ 우하→좌측 (아랫줄부터, 오른쪽→왼쪽)'],
  ['br-col', '⑧ 우하→위 (오른쪽줄부터, 아래→위)'],
];
export function orderItems(items, mode, tol = 10) {
  const [corner, primary] = String(mode).split('-');
  const topFirst = corner[0] === 't', leftFirst = corner[1] === 'l';
  const groupBy = (key) => {
    const groups = [];
    for (const it of items) {
      let g = groups.find(g => Math.abs(g.key - key(it)) <= tol);
      if (!g) { g = { key: key(it), items: [] }; groups.push(g); }
      g.items.push(it);
    }
    return groups;
  };
  if (primary === 'row') {
    const groups = groupBy(it => it.y);
    groups.sort((a, b) => topFirst ? b.key - a.key : a.key - b.key);
    return groups.flatMap(g => g.items.slice().sort((a, b) => leftFirst ? a.x - b.x : b.x - a.x));
  }
  const groups = groupBy(it => it.x);
  groups.sort((a, b) => leftFirst ? a.key - b.key : b.key - a.key);
  return groups.flatMap(g => g.items.slice().sort((a, b) => topFirst ? b.y - a.y : a.y - b.y));
}

// DBS(/532) 격자 배치: 순서가 정해진 뒤, 한 줄 갯수·가로/세로 간격으로 각 칸의 왼쪽위 목표 좌표를 계산한다.
export function gridPositions(n, perRow, cellW, cellH, gapX, gapY, origin = { x: 0, y: 0 }) {
  if (!(n > 0)) throw Error('배열할 객체가 없습니다.');
  if (!(perRow >= 1)) throw Error('한 줄 갯수는 1 이상이어야 합니다.');
  const out = [];
  for (let i = 0; i < n; i++) {
    const row = Math.floor(i / perRow), col = i % perRow;
    out.push({ x: origin.x + col * (cellW + gapX), y: origin.y - row * (cellH + gapY) });
  }
  return out;
}

// MDL(/158) 속성블럭 방식: 선택된 블록들의 attributes 키 목록과, 사용자가 고른 매핑으로 표 행을 만든다.
export function attributeKeysOf(entities) {
  const keys = new Set();
  for (const e of entities || []) if (e.attributes) for (const k of Object.keys(e.attributes)) keys.add(k);
  return [...keys];
}
export function buildDwgListRows(items, mapping) {
  const cols = [['number', '도면번호'], ['name', '도면명'], ['scale', '축척'], ['revision', '수정번호']].filter(([k]) => mapping[k]);
  if (!mapping.number || !mapping.name) throw Error('도면번호·도면명 속성은 필수입니다.');
  const header = cols.map(([, label]) => label);
  const rows = items.map(e => cols.map(([k]) => String(e.attributes?.[mapping[k]] ?? '')));
  return [header, ...rows];
}

// TOB(/521) 일반객체→블럭: 기준 블록의 자기 길이(가로 폭)를 1 로 보고, 대상 객체의 길이(선이면 두 끝점 거리,
// 그 외는 가로 폭)에 맞춰 크기를 비례(상대크기)시키고, 회전을 각도 차만큼 더해 옮긴다(block-tools.js
// replaceBlock() 의 이동·회전·크기 수식을 일반 객체 대상으로 넓혔다 — 절대크기 모드·동적블럭은 지원하지 않는다).
export function objectLengthAngle(entity) {
  if (entity.type === 'line' && entity.points?.length >= 2) {
    const [a, b] = entity.points;
    return { anchor: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, length: Math.hypot(b.x - a.x, b.y - a.y), angle: Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI };
  }
  const b = G.bounds([entity]);
  if (!b) throw Error('객체 범위를 계산할 수 없습니다.');
  return { anchor: { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 }, length: Math.max(b.maxX - b.minX, 1e-6), angle: 0 };
}
export function genericToBlock(template, target) {
  if (template?.type !== 'block') throw Error('기준 객체는 블록이어야 합니다.');
  const src = objectLengthAngle(template), dst = objectLengthAngle(target);
  const scale = dst.length / (src.length || 1), rotation = dst.angle - src.angle;
  const cloneIds = e => { const c = structuredClone(e); delete c.id; if (c.entities) c.entities = c.entities.map(cloneIds); return c; };
  const entities = (template.entities || []).map(child => G.translate(G.rotate(G.resize(cloneIds(child), src.anchor, scale), src.anchor, rotation), dst.anchor.x - src.anchor.x, dst.anchor.y - src.anchor.y));
  return { type: 'block', layer: target.layer, name: template.name, entities };
}

/* ══════════ 화면 명령(install 안에서만 pick/dialog 를 쓴다) ══════════ */
export function installTableSheetTools4(ctx) {
  const guard = (fn) => (...args) => {
    try {
      const r = fn(...args);
      if (r && typeof r.catch === 'function') r.catch((e) => { console.error('[card]', e); ctx.toast(ctx.userErrorMessage(e), true); });
    } catch (e) { console.error('[card]', e); ctx.toast(ctx.userErrorMessage(e), true); }
  };
  const afterClose = (job) => setTimeout(() => { (async () => {
    try { await job(); } catch (e) { console.error('[card]', e); ctx.toast(ctx.userErrorMessage(e), true); }
  })(); }, 0);
  const flag = v => v === 'on' || v === true;
  const store = (key, fallback) => { try { return JSON.parse(ctx.storage.getItem('table-sheet-tools-4:' + key) || 'null') ?? fallback; } catch { return fallback; } };
  const save = (key, value) => { try { ctx.storage.setItem('table-sheet-tools-4:' + key, JSON.stringify(value)); } catch {} };

  /* TB — 표 그리기(/295). "열(---)의 갯수/높이"=가로줄 구획(행), "행(|||)의 갯수/너비"=세로줄 구획(열) — 원문 용어 그대로. */
  function TB() {
    ctx.form('표 그리기 (TB)', [
      { name: 'kind', label: '표 종류', value: 'cad', options: [['cad', '캐드 표(TBT/TBM 대상)'], ['general', '일반 표(선만)']] },
      { name: 'method', label: '작성 방법', value: 'divide', options: [['divide', '간격등분 그리기(두 점)'], ['input', '간격입력 그리기(한 점)']] },
      { name: 'dashCount', label: '열(---)의 갯수', type: 'number', value: 5 },
      { name: 'barCount', label: '행(|||)의 갯수', type: 'number', value: 3 },
      { name: 'dashHeight', label: '열(---)의 높이 mm', type: 'number', value: 600 },
      { name: 'barWidth', label: '행(|||)의 너비 mm', type: 'number', value: 1200 },
      { name: 'approx', label: '상기 치수와 가장 근사치로 등분(간격등분 전용)', type: 'checkbox', value: false },
    ], values => {
      const dashCount = Math.max(1, Math.round(num(values.dashCount, '열의 갯수'))), barCount = Math.max(1, Math.round(num(values.barCount, '행의 갯수')));
      const dashHeight = positive(values.dashHeight, '열의 높이'), barWidth = positive(values.barWidth, '행의 너비');
      afterClose(async () => {
        let rows, x, y, widths, rowHeight;
        if (values.method === 'divide') {
          const path = await ctx.pickPath({ prompt: 'TB · 표가 들어갈 두 모서리를 지정하세요 · Esc 취소', minPoints: 2, maxPoints: 2 });
          if (!path) return;
          const box = boxFromCorners(path.points[0], path.points[1]);
          let rCount = dashCount, cCount = barCount;
          if (flag(values.approx)) { rCount = Math.max(1, Math.round((box.maxY - box.minY) / dashHeight)); cCount = Math.max(1, Math.round((box.maxX - box.minX) / barWidth)); }
          rowHeight = (box.maxY - box.minY) / rCount;
          widths = Array.from({ length: cCount }, () => (box.maxX - box.minX) / cCount);
          x = box.minX; y = box.maxY;
          rows = Array.from({ length: rCount }, () => Array.from({ length: cCount }, () => ''));
        } else {
          const p = await ctx.pickPoint('TB · 표의 왼쪽 위 모서리를 지정하세요 · Esc 취소');
          if (!p) return;
          rowHeight = dashHeight; widths = Array.from({ length: barCount }, () => barWidth);
          x = p.x; y = p.y;
          rows = Array.from({ length: dashCount }, () => Array.from({ length: barCount }, () => ''));
        }
        const height = Math.max(30, Math.min(rowHeight / 2.5, ...widths.map(w => w / 3)));
        const layer = ctx.ensureLayer('A-TEXT', '#ffffff'); // 0 레이어(현재 레이어)가 아니라 표준 문자 레이어에(2026-10-27 설명서 시험)
        const block = buildTableBlock(rows, { x, y, widths, rowHeight, height, align: 'center', layer, name: values.kind === 'cad' ? '캐드표' : '표' });
        ctx.commit({ entities: values.kind === 'cad' ? [block] : block.entities.filter(e => e.type === 'line') });
        ctx.toast(`TB · ${rows.length}행 ${rows[0].length}열 ${values.kind === 'cad' ? '캐드 표' : '일반 표'}를 그렸습니다.`);
      });
    });
  }

  /* TBM — 캐드표 셀 합치기(/151). 대화상자 없음(원문) → 동작만 작은 폼으로 고르고 나머지는 클릭. */
  function TBM() {
    ctx.form('캐드표 셀 합치기 (TBM)', [
      { name: 'mode', label: '동작', value: 'merge', options: [['merge', '합치기'], ['unmerge', '복구(R) · 합쳐진 셀 되돌리기']] },
    ], values => {
      afterClose(async () => {
        const table = await ctx.pickEntity({ prompt: 'TBM · 캐드 표 블록을 선택하세요 · Esc 취소', types: ['block'] });
        if (!table) return;
        if (!table.table) throw Error('TBM · 바른 CAD 표 블록(TB 로 만든 캐드 표)만 대상입니다.');
        if (values.mode === 'merge') {
          const p1 = await ctx.pickPoint('TBM · 합칠 셀 영역의 한 모서리를 지정하세요 · Esc 취소');
          if (!p1) return;
          const p2 = await ctx.pickPoint('TBM · 합칠 셀 영역의 반대 모서리를 지정하세요 · Esc 취소');
          if (!p2) return;
          const c1 = cellAt(table, p1), c2 = cellAt(table, p2);
          const rebuilt = rebuildTableEntity(table, mergeCells(table.table, c1.row, c1.col, c2.row, c2.col));
          ctx.commit({ removeIds: [table.id], entities: [rebuilt] });
          ctx.toast('TBM · 셀을 합쳤습니다.');
        } else {
          const p = await ctx.pickPoint('TBM · 복구(R) · 합쳐진 셀 영역 안의 점을 지정하세요 · Esc 취소');
          if (!p) return;
          const c = cellAt(table, p);
          const rebuilt = rebuildTableEntity(table, unmergeAt(table.table, c.row, c.col));
          ctx.commit({ removeIds: [table.id], entities: [rebuilt] });
          ctx.toast('TBM · 병합을 해제했습니다.');
        }
      });
    });
  }

  /* TBT — 캐드 표 안에 문자넣기(/296). 셀을 반복 클릭하며 같은 문자를 계속 넣는다(원문의 "이어서 넣기"). */
  function TBT() {
    const history = store('tbt-history', []);
    ctx.form('캐드 표 안에 문자넣기 (TBT)', [
      { name: 'mode', label: '입력 방식', value: 'type', options: [['type', '직접 입력'], ['history', '저장된 문자 목록에서 선택']] },
      { name: 'text', label: '넣을 문자(직접 입력)', type: 'text', value: '' },
      { name: 'pick', label: '저장된 문자(목록에서 선택)', value: history[0] || '', options: history.length ? history.map(v => [v, v]) : [['', '(저장된 문자 없음)']] },
    ], values => {
      const text = values.mode === 'history' ? values.pick : values.text;
      if (!String(text || '').trim()) throw Error('TBT · 넣을 문자를 입력하세요.');
      afterClose(async () => {
        let count = 0;
        for (;;) {
          const table = await ctx.pickEntity({ prompt: `TBT · 문자를 넣을 캐드 표를 클릭하세요(지금까지 ${count}곳) · Esc 로 마침`, types: ['block'] });
          if (!table) break;
          if (!table.table) { ctx.toast('TBT · 바른 CAD 표 블록만 대상입니다.', true); continue; }
          const p = await ctx.pickPoint('TBT · 그 표 안에서 문자를 넣을 셀의 점을 클릭하세요 · Esc 로 마침');
          if (!p) break;
          const c = cellAt(table, p);
          const rebuilt = rebuildTableEntity(table, setCellText(table.table, c.row, c.col, text));
          ctx.commit({ removeIds: [table.id], entities: [rebuilt] });
          count++;
        }
        if (count) { save('tbt-history', [text, ...history.filter(v => v !== text)].slice(0, 20)); ctx.toast(`TBT · 셀 ${count}곳에 "${text}" 을(를) 넣었습니다.`); }
      });
    });
  }

  /* RDT — 표 간격 변경(/588). 대화상자 없음(원문) → 점 4번(기준점·대각·변경길이·기준칸)만으로 비례 재분배한다. */
  async function RDT() {
    const p0 = await ctx.pickPoint('RDT · 기준점(움직이지 않는 모서리)을 지정하세요 · Esc 취소');
    if (!p0) return;
    const p1 = await ctx.pickPoint('RDT · 표 영역의 반대쪽 모서리를 지정하세요 · Esc 취소');
    if (!p1) return;
    const p2 = await ctx.pickPoint('RDT · 변경될 길이의 목표점을 지정하세요(수평/수직) · Esc 취소');
    if (!p2) return;
    const p3 = await ctx.pickPoint('RDT · 표 안의 기준 칸(아무 칸)을 지정하세요(정보용) · Esc 취소');
    if (!p3) return;
    const box = boxFromCorners(p0, p1), axis = rdtAxis(p0, p2), anchor = axis === 'x' ? p0.x : p0.y;
    const oldLength = axis === 'x' ? box.maxX - box.minX : box.maxY - box.minY;
    const newLength = axis === 'x' ? Math.abs(p2.x - p0.x) : Math.abs(p2.y - p0.y);
    if (!(oldLength > 1e-6)) throw Error('RDT · 표 영역의 폭/높이가 0보다 커야 합니다.');
    if (!(newLength > 1e-6)) throw Error('RDT · 변경될 길이는 0보다 커야 합니다.');
    const scale = newLength / oldLength;
    const pool = ctx.entities().filter(e => ['line', 'polyline', 'rectangle', 'text'].includes(e.type));
    const updates = redivideUpdates(pool, box, axis, anchor, scale);
    if (!updates.length) throw Error('RDT · 지정한 영역 안에 선/문자가 없습니다.');
    ctx.execute({ type: 'batch', commands: updates.map(u => ({ type: 'update', ids: [u.id], changes: u.changes })) });
    ctx.refresh();
    ctx.toast(`RDT · 표 ${axis === 'x' ? '가로' : '세로'} 길이를 ${oldLength.toFixed(0)} → ${newLength.toFixed(0)}mm 로 비례 재분배했습니다(대상 ${updates.length}개) · Ctrl+Z 로 되돌리기 · 회전된 표는 지원하지 않습니다.`);
  }

  /* C2E — 일반표를 엑셀로 보내기(/306). 캐드 표 블록이면 그 rows 를, 아니면 선택한 문자들의 위치로 표를 인식해
     클립보드에 탭 구분 텍스트로 복사한다(실제 엑셀 실행·COM 은 없다). */
  async function C2E() {
    const es = ctx.selected();
    if (!es.length) throw Error('C2E · 표로 보낼 객체(캐드 표 블록 또는 문자들)를 먼저 선택하세요.');
    const tableBlock = es.find(e => e.type === 'block' && e.table);
    let rows;
    if (tableBlock) rows = tableBlock.table.rows;
    else {
      const texts = es.flatMap(e => e.type === 'text' ? [e] : (e.entities || []).filter(c => c.type === 'text'));
      if (!texts.length) throw Error('C2E · 캐드 표 블록이나 문자 객체를 선택하세요.');
      rows = textGridToRows(texts, 0);
    }
    const tsv = rowsToTsv(rows);
    try { await clipboardWrite(tsv); } catch { throw Error('C2E · 클립보드에 쓸 수 없습니다. 브라우저/OS 클립보드 권한을 확인하세요.'); }
    ctx.toast(`C2E · 표(${rows.length}행)를 클립보드에 탭 구분 텍스트로 복사했습니다 · 엑셀에서 Ctrl+V 로 붙여넣으세요 · 실제 엑셀 실행/COM 연동은 지원하지 않습니다.`);
  }

  /* E2C — 엑셀표를 캐드로 가져오기(/208). 클립보드의 탭 구분 텍스트를 읽어 표로 그린다. */
  async function E2C() {
    let text;
    try { text = await clipboardRead(); } catch { throw Error('E2C · 클립보드를 읽을 수 없습니다. 엑셀에서 표 범위를 복사(Ctrl+C)한 뒤 다시 실행하세요.'); }
    if (!text || !text.trim()) throw Error('E2C · 클립보드가 비어 있습니다. 먼저 엑셀에서 표 범위를 복사하세요.');
    const rows = tsvToRows(text);
    ctx.form('엑셀표를 캐드로 가져오기 (E2C)', [
      { name: 'mode', label: '표 생성 방식', value: 'block', options: [['block', '블럭(캐드 표로 묶기 · TBT/TBM 대상)'], ['plain', '그냥(선+문자, 개별 객체)']] },
      { name: 'drawLines', label: '선 그리기(끄면 문자만)', type: 'checkbox', value: true },
      { name: 'textHeight', label: '기본 문자높이 mm', type: 'number', value: ctx.num('text-height', 150) },
    ], values => {
      const height = positive(values.textHeight, '문자높이');
      afterClose(async () => {
        const p = await ctx.pickPoint('E2C · 표의 왼쪽 위 모서리를 지정하세요 · Esc 취소');
        if (!p) return;
        const layer = ctx.activeLayer();
        const block = buildTableBlock(rows, { x: p.x, y: p.y, height, layer, name: '가져온 표' });
        const entities = flag(values.drawLines) ? block.entities : block.entities.filter(e => e.type === 'text');
        if (values.mode === 'block') ctx.commit({ entities: [{ ...block, entities }] });
        else ctx.commit({ entities });
        ctx.toast(`E2C · 클립보드 표(${rows.length}행)를 표로 만들었습니다 · 셀 배경색·문자색·페이지설정 가져오기는 지원하지 않습니다(클립보드 텍스트엔 색 정보가 없습니다).`);
      });
    });
  }

  /* BMT — 평면간 복사이동(/474). 대화상자 없음(원문, 명령행 옵션만) → 설정(거리·방향)을 저장해 재사용한다. */
  function BMT() {
    const saved = store('bmt-settings', { action: 'copy', axis: 'x', distance: 6000 });
    ctx.form('평면간 복사·이동 (BMT)', [
      { name: 'action', label: '작업', value: saved.action, options: [['copy', '복사'], ['move', '이동'], ['copyPan', '복사+화면이동(뷰 이동 없음)'], ['movePan', '이동+화면이동(뷰 이동 없음)']] },
      { name: 'axis', label: '방향', value: saved.axis, options: [['x', '가로(옆 도면)'], ['y', '세로(옆 도면)']] },
      { name: 'distance', label: '도곽 간 거리 mm', type: 'number', value: saved.distance },
    ], values => {
      const ids = ctx.selectedIds();
      if (!ids.length) throw Error('BMT · 옆 도면으로 복사·이동할 객체를 먼저 선택하세요.');
      const distance = positive(values.distance, '도곽 간 거리');
      const dx = values.axis === 'x' ? distance : 0, dy = values.axis === 'x' ? 0 : distance;
      const isCopy = values.action === 'copy' || values.action === 'copyPan';
      ctx.execute({ type: isCopy ? 'copy' : 'move', ids, dx, dy });
      ctx.refresh();
      save('bmt-settings', { action: values.action, axis: values.axis, distance });
      ctx.toast(`BMT · 옆 도면으로 ${isCopy ? '복사' : '이동'}했습니다(거리 ${distance}mm) · 화면이동(P) 옵션은 이 카드에 뷰 제어 기능이 없어 지원하지 않습니다.`);
    });
  }

  /* DBS — 도곽 정렬(/532). 선택한 도곽(블록/폐폴리선) 여러 개를 8방향 순서로 격자 배치한다. */
  function DBS() {
    const items = ctx.selected();
    if (items.length < 2) throw Error('DBS · 정렬할 도곽(블록/폐폴리선) 2개 이상을 선택하세요.');
    ctx.form('도곽 정렬 (DBS)', [
      { name: 'order', label: '배열순서', value: 'selection', options: [['selection', '선택 순'], ['number', '도면번호 순(attributes.number/이름)']] },
      { name: 'anchor', label: '정렬기준점 및 순서', value: 'tl-row', options: ORDER_MODES },
      { name: 'perRow', label: '한 줄 갯수', type: 'number', value: 4 },
      { name: 'gapX', label: '가로간격 mm', type: 'number', value: 1000 },
      { name: 'gapY', label: '세로간격 mm', type: 'number', value: 1000 },
    ], values => {
      const perRow = Math.max(1, Math.round(num(values.perRow, '한 줄 갯수'))), gapX = num(values.gapX, '가로간격'), gapY = num(values.gapY, '세로간격');
      const withBounds = items.map(e => { const b = G.bounds([e]); if (!b) throw Error('DBS · 객체 범위를 계산할 수 없습니다.'); return { e, b, x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2, w: b.maxX - b.minX, h: b.maxY - b.minY }; });
      const ordered = values.order === 'number'
        ? withBounds.slice().sort((a, b) => String(a.e.attributes?.number ?? a.e.name ?? '').localeCompare(String(b.e.attributes?.number ?? b.e.name ?? ''), 'ko', { numeric: true }))
        : orderItems(withBounds, values.anchor, Math.max(1, ctx.tolerance() * 4));
      const cellW = Math.max(...ordered.map(o => o.w)), cellH = Math.max(...ordered.map(o => o.h));
      const origin = { x: Math.min(...withBounds.map(o => o.b.minX)), y: Math.max(...withBounds.map(o => o.b.maxY)) };
      const positions = gridPositions(ordered.length, perRow, cellW, cellH, gapX, gapY, origin);
      const commands = ordered.map((o, i) => ({ type: 'move', ids: [o.e.id], dx: positions[i].x - o.b.minX, dy: positions[i].y - o.b.maxY }));
      ctx.execute({ type: 'batch', commands });
      ctx.refresh();
      ctx.toast(`DBS · 도곽 ${ordered.length}개를 ${perRow}개씩 격자로 정렬했습니다 · Ctrl+Z 로 되돌리기 · 첫줄 폭 맞춤·선택범위 확장은 지원하지 않습니다.`);
    });
  }

  /* MDL — 도면 목록표 만들기(/158). "속성블럭" 방식만 지원한다(여러 파일 ObjectDBX 는 불가능 — 보고서 참고). */
  function MDL() {
    const items = ctx.selected().filter(e => e.type === 'block' && e.attributes && Object.keys(e.attributes).length);
    if (!items.length) throw Error('MDL · 도면명·번호 등 attributes 가 있는 블록을 선택하세요(속성블럭 방식만 지원합니다).');
    const keys = attributeKeysOf(items), opts = [['', '(없음)'], ...keys.map(k => [k, k])];
    ctx.form('도면 목록표 만들기 (MDL)', [
      { name: 'number', label: '도면번호 속성', value: keys.includes('number') ? 'number' : (keys[0] || ''), options: opts },
      { name: 'name', label: '도면명 속성', value: keys.includes('name') ? 'name' : (keys[1] || keys[0] || ''), options: opts },
      { name: 'scale', label: '축척 속성(없으면 생략)', value: '', options: opts },
      { name: 'revision', label: '수정번호 속성(없으면 생략)', value: '', options: opts },
      { name: 'anchor', label: '정렬기준점 및 순서', value: 'tl-row', options: ORDER_MODES },
      { name: 'textHeight', label: '문자 높이 mm', type: 'number', value: ctx.num('text-height', 150) },
    ], values => {
      const mapping = { number: values.number || null, name: values.name || null, scale: values.scale || null, revision: values.revision || null };
      const height = positive(values.textHeight, '문자 높이');
      afterClose(async () => {
        const p = await ctx.pickPoint('MDL · 목록표를 넣을 왼쪽 위 모서리를 지정하세요 · Esc 취소');
        if (!p) return;
        const ordered = orderItems(items.map(e => { const b = G.bounds([e]); return { e, x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 }; }), values.anchor, Math.max(1, ctx.tolerance() * 4)).map(o => o.e);
        const rows = buildDwgListRows(ordered, mapping);
        const layer = ctx.ensureLayer('A-TITLE', '#ffffff');
        const block = buildTableBlock(rows, { x: p.x, y: p.y, height, layer, name: '도면목록표' });
        ctx.commit({ entities: [block] });
        ctx.toast(`MDL · 선택한 도곽 ${ordered.length}개로 도면목록표(${rows.length - 1}행)를 만들었습니다.`);
      });
    });
  }

  /* TN — 도곽블럭에 자동 도면번호 넣기(/91). 기준 도곽+기준 번호 문자를 고르면, 그 상대 위치를 그대로
     다음 도곽들에 적용해 이어지는 번호를 채운다(선택 순 · 8방향 자동정렬은 생략 — 보고서 참고). */
  async function TN() {
    const ref = await ctx.pickEntity({ prompt: 'TN · 기준 도곽(블록/폐폴리선)을 선택하세요 · Esc 취소' });
    if (!ref) return;
    const refText = await ctx.pickEntity({ prompt: 'TN · 그 안의 기준 도면번호 문자를 선택하세요 · Esc 취소', types: ['text'] });
    if (!refText) return;
    const parsed = splitPrefixNumberSuffix(refText.text);
    const offset = relativeOffset(anchorOf(ref), refText.position);
    ctx.form('도곽블럭에 자동 도면번호 넣기 (TN)', [
      { name: 'prefix', label: '접두어', type: 'text', value: parsed.prefix },
      { name: 'suffix', label: '접미어', type: 'text', value: parsed.suffix },
      { name: 'start', label: '시작 숫자(기준 도면번호)', type: 'number', value: Number(parsed.number) },
      { name: 'digits', label: '자릿수', type: 'number', value: parsed.digits },
      { name: 'step', label: '숫자 증가간격', type: 'number', value: 1 },
    ], values => {
      const prefix = values.prefix, suffix = values.suffix, digits = Math.max(1, Math.round(num(values.digits, '자릿수'))), step = num(values.step, '증가간격') || 1;
      let n = num(values.start, '시작 숫자');
      afterClose(async () => {
        const tol = Math.max(10, ctx.tolerance() * 8);
        let count = 0;
        for (;;) {
          const target = await ctx.pickEntity({ prompt: `TN · 번호를 넣을 다음 도곽을 선택하세요(지금까지 ${count}개) · Esc 로 마침` });
          if (!target) break;
          n += step;
          const point = applyOffset(anchorOf(target), offset);
          const near = nearestTextAt(ctx.entities().filter(e => e.type === 'text' && e.id !== refText.id), point, tol);
          const value = formatNumbered(prefix, n, digits, suffix);
          if (near) ctx.execute({ type: 'update', ids: [near.id], changes: { text: value } });
          else ctx.commit({ entities: [{ type: 'text', position: point, text: value, height: refText.height, rotation: refText.rotation || 0, align: refText.align || 'left', layer: refText.layer }] });
          ctx.refresh(); count++;
        }
        if (count) ctx.toast(`TN · 도곽 ${count}개에 도면번호를 이어서 채번했습니다(${formatNumbered(prefix, num(values.start, '시작 숫자') + step, digits, suffix)} ~ ${formatNumbered(prefix, n, digits, suffix)}).`);
      });
    });
  }

  /* TOB — 객체를 블럭으로 교체(/521). "여러블럭→단일"은 바른 CAD 의 BLOCKREPLACE 와 동작이 같아 그대로 재사용하고,
     "일반객체→블럭"만 새로 만든다(Plot_Box 인식·동적블럭은 지원하지 않는다 — 보고서 참고). */
  function TOB() {
    ctx.form('객체를 블럭으로 교체 (TOB)', [
      { name: 'mode', label: '변경 방식', value: 'unify', options: [['unify', '여러블럭→단일(같은 도곽을 하나로 통일)'], ['generic', '일반객체→블럭(선택한 객체를 기준 블록으로 교체)']] },
    ], values => {
      afterClose(async () => {
        if (values.mode === 'unify') {
          ctx.toast('TOB · 여러블럭→단일은 바른 CAD 의 BLOCKREPLACE 와 같은 동작이라 그대로 실행합니다.');
          ctx.run('BLOCKREPLACE');
          return;
        }
        const template = await ctx.pickEntity({ prompt: 'TOB · 기준 블록(교체할 블록)을 선택하세요 · Esc 취소', types: ['block'] });
        if (!template) return;
        let count = 0;
        for (;;) {
          const target = await ctx.pickEntity({ prompt: `TOB · 블록으로 바꿀 일반 객체를 선택하세요(지금까지 ${count}개) · Esc 로 마침` });
          if (!target) break;
          if (target.type === 'block') { ctx.toast('TOB · 이미 블록입니다. 일반 객체만 선택하세요.', true); continue; }
          const replacement = genericToBlock(template, target);
          ctx.commit({ removeIds: [target.id], entities: [replacement] });
          count++;
        }
        if (count) ctx.toast(`TOB · 일반 객체 ${count}개를 "${template.name || '블록'}" 로 교체했습니다(길이·각도에 맞춰 상대크기로 연동) · 절대크기 모드·동적블럭·Plot_Box 자동인식은 지원하지 않습니다.`);
      });
    });
  }

  return {
    TB: guard(TB), TBM: guard(TBM), TBT: guard(TBT), RDT: guard(RDT),
    C2E: guard(C2E), E2C: guard(E2C),
    BMT: guard(BMT), DBS: guard(DBS), MDL: guard(MDL), TN: guard(TN), TOB: guard(TOB),
  };
}
