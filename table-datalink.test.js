// 520 표 칸 모양·엑셀 데이터 링크(table-sheet-tools-4.js 확장 + table-datalink.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import {DrawingEngine} from './engine.js';
import {buildTableBlock, rebuildTableEntity, isLinkUpdateRequired, linkedTableChanges, refreshLinkedTable, formatCellValue, cellStyleOf, DEFAULT_CELL_STYLES} from './table-sheet-tools-4.js';
import {notifyLinkedTables, linkedTables, installTableDataLink, styledTable, dataLinkNotifyEnabled, DATALINK_NOTIFY_KEY} from './table-datalink.js';

const memory = (init = {}) => { const m = new Map(Object.entries(init)); return {map: m, getItem: k => m.has(k) ? m.get(k) : null, setItem: (k, v) => m.set(k, String(v))}; };
const texts = b => b.entities.filter(e => e.type === 'text');

test('칸 모양이 없으면 예전과 같은 그림(키도 늘지 않음)', () => {
 const b = buildTableBlock([['a', 1], ['b', 2]], {height: 100, widths: [1000, 1000], rowHeight: 300, align: 'left'});
 assert.deepEqual(Object.keys(b.table).sort(), ['align', 'height', 'merges', 'rowHeight', 'rows', 'widths']);
 assert.ok(texts(b).every(t => t.height === 100 && t.align === 'left'));
 assert.deepEqual(texts(b)[0].position, {x: 50, y: -150 - 35});
 assert.equal(texts(b)[3].text, '2');
});

test('제목·머리글·데이터 칸 모양과 칸 하나 설정: 정렬·크기·서식은 그림에만, 값은 그대로', () => {
 const rows = [['면적표', ''], ['실', '면적'], ['거실', 24.5], ['합계', 1234.5]];
 const b = buildTableBlock(rows, {height: 100, widths: [1000, 1000], rowHeight: 300, titleRows: 1, headerRows: 1, merges: [{r1: 0, c1: 0, r2: 0, c2: 1}],
  cellStyles: {...DEFAULT_CELL_STYLES, data: {format: 'number:2'}}, cells: {'3:0': {align: 'right'}, '9:9': {align: 'left'}}});
 const t = texts(b), at = (r, c) => t.find(x => x.tableCell.row === r && x.tableCell.column === c);
 assert.equal(at(0, 0).height, 130, '제목 1.3배');
 assert.equal(at(0, 0).align, 'center');
 assert.equal(at(1, 1).align, 'center', '머리글 가운데');
 assert.equal(at(2, 1).text, '24.50');
 assert.equal(at(3, 1).text, '1,234.50');
 assert.equal(at(2, 0).text, '거실', '글자 칸은 서식 없이');
 assert.equal(at(3, 0).align, 'right');
 assert.deepEqual(b.table.rows, rows, '값은 그대로');
 assert.deepEqual(b.table.cells, {'3:0': {align: 'right'}}, '표 밖 칸 설정은 버림');
 assert.equal(cellStyleOf(b.table, 0, 1), 'title');
 assert.equal(cellStyleOf(b.table, 1, 0), 'header');
 assert.equal(cellStyleOf(b.table, 3, 0), 'data');
 assert.throws(() => buildTableBlock(rows, {cellStyles: {big: {}}}), /칸 모양/);
 assert.throws(() => buildTableBlock(rows, {cells: {'0:0': {format: 'money'}}}), /서식/);
 const engine = new DrawingEngine();
 engine.execute({type: 'addMany', entities: [{...b, layer: 'default', entities: b.entities.map(e => ({...e, layer: 'default'}))}]});
 engine.validate(engine.doc);
});

test('formatCellValue', () => {
 assert.equal(formatCellValue(0.125, 'percent:1'), '12.5%');
 assert.equal(formatCellValue('1,200', 'number:0'), '1,200');
 assert.equal(formatCellValue(3, 'fixed:2'), '3.00');
 assert.equal(formatCellValue('0101', 'text'), '0101');
 assert.equal(formatCellValue('가', 'number:2'), '가');
 assert.equal(formatCellValue(null, 'general'), '');
});

const linked = (over = {}) => ({id: 'T', layer: 'default', ...buildTableBlock([['실', '면적'], ['거실', 20]], {x: 100, y: 500, height: 100, widths: [800, 900], merges: [{r1: 1, c1: 0, r2: 1, c2: 1}],
 link: {path: 'D:\\자료\\면적.xlsx', range: '면적!A1:B2', mtime: 1000, options: {}}, headerRows: 1, cellStyles: DEFAULT_CELL_STYLES, layer: 'default', ...over})});

test('rebuildTableEntity 는 링크·칸 모양을 지킨다', () => {
 const t = linked(), r = rebuildTableEntity(t, t.table);
 assert.deepEqual(r.table.link, t.table.link);
 assert.equal(r.table.headerRows, 1);
 assert.deepEqual(r.table.cellStyles, t.table.cellStyles);
});

test('isLinkUpdateRequired: 경로(대소문자·빗금 무시)·범위·시각·옵션 중 하나라도 다를 때만', () => {
 const link = {path: 'D:\\a\\B.xlsx', range: 'S!A1:B2', mtime: 5, options: {x: 1}};
 assert.equal(isLinkUpdateRequired(link, {path: 'd:/a/b.XLSX', mtime: 5}), false);
 assert.equal(isLinkUpdateRequired(link, {...link, mtime: 6}), true);
 assert.equal(isLinkUpdateRequired(link, {...link, range: 's!a1:b3'}), true);
 assert.equal(isLinkUpdateRequired(link, {...link, range: 's!a1:b2'}), false);
 assert.equal(isLinkUpdateRequired(link, {...link, options: {x: 2}}), true);
 assert.equal(isLinkUpdateRequired(link, {...link, path: 'D:\\a\\C.xlsx'}), true);
 assert.equal(isLinkUpdateRequired(null, link), false);
 assert.equal(isLinkUpdateRequired(link, null), false);
});

test('linkedTableChanges: 같은 열 수면 너비 유지, 범위를 벗어난 병합은 버림, 왼쪽 위 그대로', () => {
 const t = linked();
 const same = linkedTableChanges(t, [['실', '면적'], ['안방', 15], ['합계', 35]], {mtime: 2000});
 assert.deepEqual(same.table.widths, [800, 900]);
 assert.equal(same.table.link.mtime, 2000);
 assert.deepEqual(same.table.merges, [{r1: 1, c1: 0, r2: 1, c2: 1}]);
 const lines = same.entities.filter(e => e.type === 'line');
 assert.equal(Math.min(...lines.flatMap(l => l.points.map(p => p.x))), 100);
 assert.equal(Math.max(...lines.flatMap(l => l.points.map(p => p.y))), 500);
 const narrow = linkedTableChanges(t, [['하나']], {mtime: 3});
 assert.deepEqual(narrow.table.merges, []);
 assert.equal(narrow.table.widths.length, 1);
 assert.throws(() => linkedTableChanges(t, []), /비어/);
 assert.throws(() => linkedTableChanges({table: {rows: [[1]]}}, [[1]]), /연결된 표가 아닙니다/);
});

function fakeApi({mtime = 1000, exists = true, rows = [['실', '면적'], ['거실', 25]]} = {}) {
 const calls = [];
 const api = async (route, body) => { calls.push(body.action + ':' + (body.range ?? body.path)); if (body.action === 'stat') return {path: body.path, exists, mtime: exists ? mtime : null, size: 10};
  if (body.action === 'range') return {rows, sheet: '면적', range: 'A1:B2', mtime}; throw Error('?'); };
 return {api, calls};
}

test('refreshLinkedTable: 시각이 같으면 범위를 읽지 않고 null, 다르면 다시 읽음, force 는 늘 다시 읽음', async () => {
 const t = linked();
 let f = fakeApi({mtime: 1000});
 assert.equal(await refreshLinkedTable(t, f.api), null);
 assert.deepEqual(f.calls, ['stat:D:\\자료\\면적.xlsx']);
 f = fakeApi({mtime: 1500});
 const u = await refreshLinkedTable(t, f.api);
 assert.equal(u.id, 'T');
 assert.deepEqual(u.changes.table.rows, [['실', '면적'], ['거실', 25]]);
 assert.equal(u.changes.table.link.mtime, 1500);
 assert.equal(f.calls.length, 2);
 f = fakeApi({mtime: 1000});
 assert.ok(await refreshLinkedTable(t, f.api, {force: true}));
});

test('notifyLinkedTables: 표 없는 도면은 엔진에 묻지 않고, 파일마다 시각 한 번, 바뀐·없는 표만 한 번 알림, 끄기 가능', async () => {
 const msgs = [];
 let f = fakeApi();
 assert.deepEqual(await notifyLinkedTables({entities: [{id: 'x', type: 'line'}]}, f.api, m => msgs.push(m), {storage: memory()}), {tables: 0, changed: 0, missing: 0});
 assert.equal(f.calls.length, 0);
 const doc = {entities: [linked({}), {...linked(), id: 'T2'}, {...linked({link: {path: 'D:/다른.xlsx', range: '', mtime: 1, options: {}}}), id: 'T3'}]};
 f = fakeApi({mtime: 1000});
 const r = await notifyLinkedTables(doc, async (route, body) => body.path.includes('다른') ? {exists: false} : f.api(route, body), m => msgs.push(m), {storage: memory()});
 assert.deepEqual(r, {tables: 3, changed: 0, missing: 1});
 assert.equal(f.calls.length, 1, '같은 파일은 한 번');
 assert.equal(msgs.length, 1);
 assert.match(msgs[0], /찾을 수 없는 표 1개.*DATALINKUPDATE/);
 f = fakeApi({mtime: 9999});
 await notifyLinkedTables(doc, async (route, body) => body.path.includes('다른') ? {exists: true, mtime: 1} : f.api(route, body), m => msgs.push(m), {storage: memory()});
 assert.match(msgs.at(-1), /원본이 바뀐 엑셀 연결 표 2개 \(면적\)/);
 const off = memory({[DATALINK_NOTIFY_KEY]: '0'});
 assert.equal(dataLinkNotifyEnabled(off), false);
 assert.equal((await notifyLinkedTables(doc, f.api, m => msgs.push(m), {storage: off})).skipped, true);
 const broken = await notifyLinkedTables(doc, async () => { throw Error('엔진 없음'); }, m => msgs.push(m), {storage: memory()});
 assert.equal(broken.changed, 0, '엔진이 없으면 조용히');
 assert.deepEqual(linkedTables(doc.entities).map(t => t.id), ['T', 'T2', 'T3']);
});

function harness(api, responses = []) {
 const engine = new DrawingEngine(), toasts = [], storage = memory();
 let selected = [];
 const ctx = {storage, api, entities: () => engine.doc.entities, selected: () => engine.doc.entities.filter(e => selected.includes(e.id)), layers: () => engine.doc.layers,
  execute: c => engine.execute(c), commit: ({entities}) => engine.execute({type: 'addMany', entities}), activeLayer: () => 'default', num: (k, d) => d, toast: (m, e) => toasts.push(m),
  pickPoint: async () => ({x: 0, y: 0}), refresh() {},
  form: (title, fields, onApply) => onApply({...Object.fromEntries(fields.map(f => [f.name, f.value])), ...(responses.shift() || {})})};
 return {engine, ctx, toasts, storage, select: ids => { selected = ids; }};
}

test('DATALINK → 원본 바뀜 → DATALINKUPDATE(바뀐 것만) → 되돌리기 한 번', async () => {
 let mtime = 1000, rows = [['실', '면적'], ['거실', 20]];
 const api = async (route, b) => b.action === 'stat' ? {path: b.path, exists: true, mtime} : {rows, sheet: '실 면적', range: 'A1:B2', mtime};
 const h = harness(api, [{path: 'D:/자료/면적.xlsx', browse: undefined, range: '', headerRows: 1}]);
 const cmds = installTableDataLink(h.ctx);
 await cmds.DATALINK();
 const t = h.engine.doc.entities[0];
 assert.equal(t.name, '면적');
 assert.deepEqual(t.table.link, {path: 'D:/자료/면적.xlsx', range: "'실 면적'!A1:B2", mtime: 1000, options: {}});
 assert.equal(t.table.headerRows, 1);
 assert.equal(t.layer, 'default');
 h.engine.validate(h.engine.doc);
 let r = await cmds.DATALINKUPDATE();
 assert.deepEqual(r, {updated: 0, same: 1, locked: 0, failed: 0});
 mtime = 2000; rows = [['실', '면적'], ['거실', 20], ['안방', 12]];
 r = await cmds.DATALINKUPDATE();
 assert.equal(r.updated, 1);
 const next = h.engine.doc.entities[0];
 assert.deepEqual(next.table.rows, rows);
 assert.equal(next.table.link.mtime, 2000);
 assert.equal(next.id, t.id);
 h.engine.validate(h.engine.doc);
 h.engine.execute({type: 'undo'});
 assert.deepEqual(h.engine.doc.entities[0].table.rows, [['실', '면적'], ['거실', 20]]);
});

test('DATALINK: 파일 없음·빈 범위·경로 없음은 한국어 오류, DATALINKUPDATE 는 잠긴 표 건너뜀', async () => {
 const h = harness(async (r, b) => b.action === 'stat' ? {exists: false} : {rows: []}, [{path: 'D:/없음.xlsx'}, {path: ''}]);
 const cmds = installTableDataLink(h.ctx);
 await assert.rejects(cmds.DATALINK(), /찾을 수 없습니다/);
 await assert.rejects(cmds.DATALINK(), /경로/);
 await assert.rejects(cmds.DATALINKUPDATE(), /연결된 표가 없습니다/);
 const g = harness(async (r, b) => ({path: b.path, exists: true, mtime: 5, rows: [['a']], range: 'A1:A1', sheet: ''}));
 g.engine.execute({type: 'addMany', entities: [linked()]});
 g.engine.execute({type: 'layer.update', id: 'default', changes: {locked: true}});
 const r = await installTableDataLink(g.ctx).DATALINKUPDATE();
 assert.equal(r.locked, 1);
 assert.equal(r.updated, 0);
});

test('TABLESTYLE: 칸 모양 바꾸기(값 그대로·링크 유지), 칸 지정 오류', () => {
 const h = harness(null, [{titleRows: 0, headerRows: 1, dataFormat: 'number:1', cellAt: '2,1', cellAlign: 'right'}, {cellAt: '9,9'}]);
 h.engine.execute({type: 'addMany', entities: [linked()]});
 h.select([h.engine.doc.entities[0].id]);
 const cmds = installTableDataLink(h.ctx);
 cmds.TABLESTYLE();
 const t = h.engine.doc.entities[0];
 assert.deepEqual(t.table.rows, [['실', '면적'], ['거실', 20]]);
 assert.equal(t.table.cellStyles.data.format, 'number:1');
 assert.deepEqual(t.table.cells, {'1:0': {align: 'right'}});
 assert.equal(t.table.link.path, 'D:\\자료\\면적.xlsx');
 assert.ok(t.entities.some(e => e.type === 'text' && e.text === '거실' && e.align === 'right'), '병합 칸의 정렬');
 assert.throws(() => cmds.TABLESTYLE(), /표\(2행 2열\) 밖/);
 assert.throws(() => styledTable({rows: [[1]]}, {titleRows: 2}), /0~1/);
 assert.throws(() => installTableDataLink(harness(null).ctx).TABLESTYLE(), /표 블록을 먼저 선택/);
});
