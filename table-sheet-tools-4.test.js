// table-sheet-tools-4.js 순수 함수 시험. DOM 없이 node --test 로 돈다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildTableBlock, tableBounds, cellAt, mergeCells, unmergeAt, setCellText, rebuildTableEntity,
  tsvToRows, rowsToTsv, textGridToRows,
  boxFromCorners, rdtAxis, rescalePoint, withinBox, redivideUpdates,
  splitPrefixNumberSuffix, formatNumbered, anchorOf, relativeOffset, applyOffset, nearestTextAt,
  ORDER_MODES, orderItems, gridPositions,
  attributeKeysOf, buildDwgListRows,
  objectLengthAngle, genericToBlock,
  installTableSheetTools4,
} from './table-sheet-tools-4.js';

/* ── buildTableBlock / cellAt (TB·TBM·TBT·RDT 공용 표 모형) ── */
test('buildTableBlock: 2행 2열 표를 만들고 병합 없이 8줄(외곽4+내부0, 실제로는 구획선) + 4문자를 만든다', () => {
  const block = buildTableBlock([['a', 'b'], ['c', 'd']], { x: 0, y: 0, height: 100, widths: [500, 500], rowHeight: 300, layer: 'L1' });
  assert.equal(block.type, 'block');
  assert.equal(block.entities.filter(e => e.type === 'text').length, 4);
  assert.equal(block.table.rows[0][0], 'a');
  const b = tableBounds(block);
  assert.equal(b.minX, 0); assert.equal(b.maxX, 1000); assert.equal(b.maxY, 0); assert.equal(b.minY, -600);
});
test('buildTableBlock: 행/열이 없거나 너비가 문자높이보다 작으면 거부한다', () => {
  assert.throws(() => buildTableBlock([], {}));
  assert.throws(() => buildTableBlock([['a']], { height: 100, widths: [50] }));
});
test('cellAt: 표의 왼쪽 위 근처 점은 (0,0) 셀, 오른쪽 아래 근처 점은 마지막 셀로 판정한다', () => {
  const block = buildTableBlock([['a', 'b', 'c'], ['d', 'e', 'f']], { x: 0, y: 0, height: 50, widths: [200, 200, 200], rowHeight: 150, layer: 'L' });
  assert.deepEqual(cellAt(block, { x: 10, y: -10 }), { row: 0, col: 0 });
  assert.deepEqual(cellAt(block, { x: 250, y: -10 }), { row: 0, col: 1 });
  assert.deepEqual(cellAt(block, { x: 590, y: -290 }), { row: 1, col: 2 });
});

/* ── TBM: 셀 합치기·복구 ── */
test('mergeCells: 두 셀을 합치면 값이 이어붙고 병합 범위가 등록된다', () => {
  const table = { rows: [['1', '2'], ['3', '4']], merges: [] };
  const merged = mergeCells(table, 0, 0, 0, 1);
  assert.equal(merged.rows[0][0], '1 2');
  assert.equal(merged.rows[0][1], '');
  assert.deepEqual(merged.merges, [{ r1: 0, c1: 0, r2: 0, c2: 1 }]);
});
test('mergeCells: 겹치는 범위를 다시 합치려 하면 거부한다', () => {
  const table = { rows: [['1', '2'], ['3', '4']], merges: [{ r1: 0, c1: 0, r2: 0, c2: 1 }] };
  assert.throws(() => mergeCells(table, 0, 1, 1, 1));
});
test('unmergeAt: 병합 영역 안의 셀 좌표로 병합을 해제한다', () => {
  const table = { rows: [['1 2', ''], ['3', '4']], merges: [{ r1: 0, c1: 0, r2: 0, c2: 1 }] };
  const back = unmergeAt(table, 0, 1);
  assert.equal(back.merges.length, 0);
});
test('unmergeAt: 병합되지 않은 셀은 거부한다', () => {
  assert.throws(() => unmergeAt({ rows: [['1']], merges: [] }, 0, 0));
});
test('setCellText: 지정한 셀만 바뀐다', () => {
  const table = { rows: [['a', 'b']] };
  const next = setCellText(table, 0, 1, '창1');
  assert.equal(next.rows[0][1], '창1');
  assert.equal(next.rows[0][0], 'a');
});
test('rebuildTableEntity: 기존 표의 왼쪽 위 모서리를 유지한 채 다시 그린다', () => {
  const block = buildTableBlock([['a', 'b']], { x: 100, y: -50, height: 50, widths: [200, 200], rowHeight: 150, layer: 'L' });
  const rebuilt = rebuildTableEntity(block, setCellText(block.table, 0, 0, 'X'));
  const b2 = tableBounds(rebuilt);
  assert.equal(b2.minX, 100); assert.equal(b2.maxY, -50);
  assert.equal(rebuilt.table.rows[0][0], 'X');
});

/* ── C2E / E2C: 클립보드 탭 구분 텍스트 ── */
test('tsvToRows/rowsToTsv: 왕복 변환되고 숫자 칸은 숫자로 복원된다', () => {
  const rows = tsvToRows('번호\t항목\t수량\n1\t벽체\t10');
  assert.deepEqual(rows, [['번호', '항목', '수량'], [1, '벽체', 10]]);
  assert.equal(rowsToTsv([[1, 'a'], [2, 'b']]), '1\ta\n2\tb');
});
test('tsvToRows: 빈 텍스트는 거부한다', () => {
  assert.throws(() => tsvToRows('   '));
});
test('tsvToRows: 엑셀이 따옴표로 싼 칸(칸 안 줄바꿈·탭·"")을 한 칸으로 읽고, 앞자리 0 같은 글자는 숫자로 바꾸지 않는다', () => {
  // 엑셀에서 Ctrl+C 한 모양: 칸 안 줄바꿈이 있는 칸은 "…" 로 싸이고 끝에 줄바꿈(\r\n)이 붙는다.
  const rows = tsvToRows('호수\t비고\t면적\r\n0101\t"창고\r\n(지하)"\t12.5\r\n\t\t\r\n0102\t"5"" 배관"\t-3\r\n');
  assert.deepEqual(rows, [['호수', '비고', '면적'], ['0101', '창고\r\n(지하)', 12.5], ['', '', ''], ['0102', '5" 배관', -3]]);
  assert.deepEqual(tsvToRows('1e3\t0x10\t1,000\t5" 관'), [['1e3', '0x10', '1,000', '5" 관']]);
});
test('rowsToTsv: 줄바꿈·탭·따옴표로 시작하는 칸은 엑셀처럼 싸서 내보내고 tsvToRows 로 그대로 돌아온다', () => {
  const rows = [['이름', '설명'], ['A', '첫 줄\n둘째 줄'], ['B', '탭\t포함'], ['C', '"인용"']];
  const tsv = rowsToTsv(rows);
  assert.equal(tsv, '이름\t설명\nA\t"첫 줄\n둘째 줄"\nB\t"탭\t포함"\nC\t"""인용"""');
  assert.deepEqual(tsvToRows(tsv), rows);
});

/* C2E·E2C 화면 흐름: 클립보드를 흉내 낸다(실제 엑셀·OS 클립보드 권한은 데스크톱에서만 확인할 수 있다). */
async function withClipboard(clipboard, fn) {
  const saved = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', { value: { clipboard }, configurable: true, writable: true });
  try { return await fn(); } finally { Object.defineProperty(globalThis, 'navigator', saved); }
}
const settle = () => new Promise(r => setTimeout(r, 20));
function clipCtx(over = {}) {
  const rec = { toasts: [], commits: [] };
  const ctx = {
    storage: { getItem: () => null, setItem: () => {} }, toast: (m, e) => rec.toasts.push({ m, e: !!e }), userErrorMessage: e => e.message,
    entities: () => [], selected: () => [], selectedIds: () => [], layers: () => [], activeLayer: () => 'L', ensureLayer: () => 'L', num: (k, d) => d, tolerance: () => 5,
    form: (title, fields, onApply) => onApply(Object.fromEntries(fields.map(f => [f.name, f.type === 'checkbox' ? (f.value ? 'on' : '') : String(f.value ?? '')]))),
    pickPoint: async () => ({ x: 100, y: 200 }), commit: (c) => { rec.commits.push(c); return []; }, ...over,
  };
  return { ctx, rec, cmds: installTableSheetTools4(ctx) };
}
test('C2E: 선택한 캐드 표를 엑셀 붙여넣기 형식으로 클립보드에 쓴다 · 권한이 없으면 오류로 알린다', async () => {
  const table = buildTableBlock([['호수', '비고'], ['0101', '창고\n(지하)']], { x: 0, y: 0, height: 100, widths: [500, 500], rowHeight: 300, layer: 'L' });
  let written = null;
  await withClipboard({ writeText: async t => { written = t; } }, async () => {
    const { rec, cmds } = clipCtx({ selected: () => [table] });
    cmds.C2E(); await settle();
    assert.equal(written, '호수\t비고\n0101\t"창고\n(지하)"');
    assert.equal(rec.toasts.at(-1).e, false);
    assert.match(rec.toasts.at(-1).m, /2행/);
  });
  await withClipboard({ writeText: async () => { throw Error('denied'); } }, async () => {
    const { rec, cmds } = clipCtx({ selected: () => [table] });
    cmds.C2E(); await settle();
    assert.equal(rec.toasts.at(-1).e, true);
    assert.match(rec.toasts.at(-1).m, /클립보드에 쓸 수 없습니다/);
  });
});
test('E2C: 클립보드의 엑셀 표를 지정한 점에 캐드 표로 만든다 · 비었거나 읽을 수 없으면 오류로 알린다', async () => {
  await withClipboard({ readText: async () => '호수\t면적\r\n0101\t12.5\r\n' }, async () => {
    const { rec, cmds } = clipCtx();
    cmds.E2C(); await settle();
    assert.equal(rec.commits.length, 1);
    const block = rec.commits[0].entities[0];
    assert.equal(block.type, 'block');
    assert.deepEqual(block.table.rows, [['호수', '면적'], ['0101', 12.5]]);
    assert.equal(tableBounds(block).minX, 100); assert.equal(tableBounds(block).maxY, 200);
    assert.equal(rec.toasts.at(-1).e, false);
  });
  for (const clipboard of [{ readText: async () => '  \r\n' }, { readText: async () => { throw Error('denied'); } }, undefined]) {
    await withClipboard(clipboard, async () => {
      const { rec, cmds } = clipCtx();
      cmds.E2C(); await settle();
      assert.equal(rec.commits.length, 0);
      assert.equal(rec.toasts.at(-1)?.e, true, JSON.stringify(rec.toasts));
    });
  }
});
test('textGridToRows: 좌표가 흩어진 문자들을 행/열 그리드로 인식한다(C2E, 임의의 선+문자 표)', () => {
  const texts = [
    { position: { x: 0, y: 100 }, text: 'A', height: 10 }, { position: { x: 100, y: 100 }, text: 'B', height: 10 },
    { position: { x: 0, y: 0 }, text: 'C', height: 10 }, { position: { x: 100, y: 0 }, text: 'D', height: 10 },
  ];
  const rows = textGridToRows(texts, 5);
  assert.deepEqual(rows, [['A', 'B'], ['C', 'D']]);
});

/* ── RDT: 표 간격 변경(비례 재분배) ── */
test('boxFromCorners/rdtAxis: 두 점으로 영역을, 세번째 점으로 축을 정한다', () => {
  const box = boxFromCorners({ x: 0, y: 0 }, { x: 4000, y: 2000 });
  assert.deepEqual(box, { minX: 0, minY: 0, maxX: 4000, maxY: 2000 });
  assert.equal(rdtAxis({ x: 0, y: 0 }, { x: 6000, y: 100 }), 'x');
  assert.equal(rdtAxis({ x: 0, y: 0 }, { x: 100, y: 6000 }), 'y');
});
test('rescalePoint: 기준점에서부터 축 방향으로만 비례 이동한다', () => {
  assert.deepEqual(rescalePoint({ x: 2000, y: 500 }, 'x', 0, 1.5), { x: 3000, y: 500 });
  assert.deepEqual(rescalePoint({ x: 500, y: 2000 }, 'y', 0, 1.5), { x: 500, y: 3000 });
});
test('redivideUpdates: 영역 안 세로선·문자만 x축으로 비례 재배치된다(영역 밖 객체는 제외)', () => {
  const box = boxFromCorners({ x: 0, y: 0 }, { x: 4000, y: 2000 });
  const entities = [
    { id: 'v1', type: 'line', points: [{ x: 2000, y: 0 }, { x: 2000, y: 2000 }] },
    { id: 't1', type: 'text', position: { x: 2000, y: 1000 } },
    { id: 'outside', type: 'line', points: [{ x: 9000, y: 0 }, { x: 9000, y: 2000 }] },
  ];
  const updates = redivideUpdates(entities, box, 'x', 0, 1.5);
  assert.equal(updates.length, 2);
  const v1 = updates.find(u => u.id === 'v1');
  assert.equal(v1.changes.points[0].x, 3000);
  const t1 = updates.find(u => u.id === 't1');
  assert.equal(t1.changes.position.x, 3000);
});
test('withinBox: 경계 위의 점도 포함한다', () => {
  const box = { minX: 0, minY: 0, maxX: 10, maxY: 10 };
  assert.ok(withinBox({ x: 0, y: 10 }, box));
  assert.ok(!withinBox({ x: 11, y: 5 }, box));
});

/* ── TN: 도면번호 채번 ── */
test('splitPrefixNumberSuffix: "AE-013" → 접두어/숫자/접미어로 나뉜다', () => {
  assert.deepEqual(splitPrefixNumberSuffix('AE-013'), { prefix: 'AE-', number: '013', suffix: '', digits: 3 });
});
test('splitPrefixNumberSuffix: 숫자가 없으면 거부한다', () => {
  assert.throws(() => splitPrefixNumberSuffix('도면'));
});
test('formatNumbered: 자릿수만큼 0을 채우고, 늘어나면 그대로 늘어난다', () => {
  assert.equal(formatNumbered('AE-', 14, 3, ''), 'AE-014');
  assert.equal(formatNumbered('AE-', 1234, 3, ''), 'AE-1234');
});
test('anchorOf/relativeOffset/applyOffset: 기준 객체 중심에서의 상대 위치를 다른 객체에 그대로 옮긴다', () => {
  const ref = { type: 'rectangle', points: [{ x: 0, y: 0 }, { x: 1000, y: 0 }, { x: 1000, y: 500 }, { x: 0, y: 500 }] };
  const anchor = anchorOf(ref);
  assert.deepEqual(anchor, { x: 500, y: 250 });
  const offset = relativeOffset(anchor, { x: 900, y: 480 });
  const target = { type: 'rectangle', points: [{ x: 2000, y: 2000 }, { x: 3000, y: 2000 }, { x: 3000, y: 2500 }, { x: 2000, y: 2500 }] };
  const point = applyOffset(anchorOf(target), offset);
  assert.deepEqual(point, { x: 2900, y: 2480 });
});
test('nearestTextAt: 허용범위 안 가장 가까운 문자만 찾는다', () => {
  const texts = [{ position: { x: 0, y: 0 } }, { position: { x: 100, y: 0 } }];
  assert.equal(nearestTextAt(texts, { x: 5, y: 0 }, 20), texts[0]);
  assert.equal(nearestTextAt(texts, { x: 5, y: 0 }, 2), null);
});

/* ── TN/MDL/DBS 공용 8방향 정렬 ── */
test('orderItems: 좌상→우(tl-row)는 윗줄부터 왼쪽에서 오른쪽으로 정렬한다', () => {
  const items = [{ id: 'BR', x: 100, y: 0 }, { id: 'TL', x: 0, y: 100 }, { id: 'TR', x: 100, y: 100 }, { id: 'BL', x: 0, y: 0 }];
  const order = orderItems(items, 'tl-row', 10).map(i => i.id);
  assert.deepEqual(order, ['TL', 'TR', 'BL', 'BR']);
});
test('orderItems: 우하→위(br-col)는 오른쪽줄부터 아래에서 위로 정렬한다', () => {
  const items = [{ id: 'TL', x: 0, y: 100 }, { id: 'TR', x: 100, y: 100 }, { id: 'BL', x: 0, y: 0 }, { id: 'BR', x: 100, y: 0 }];
  const order = orderItems(items, 'br-col', 10).map(i => i.id);
  assert.deepEqual(order, ['BR', 'TR', 'BL', 'TL']);
});
test('ORDER_MODES: 8개 옵션이 모두 있다', () => {
  assert.equal(ORDER_MODES.length, 8);
});

/* ── DBS: 격자 배치 좌표 ── */
test('gridPositions: 한 줄 갯수만큼 채우고 다음 줄로 넘어간다(왼쪽위 기준 아래로 자란다)', () => {
  const pos = gridPositions(5, 2, 1000, 500, 100, 200, { x: 0, y: 0 });
  assert.deepEqual(pos[0], { x: 0, y: 0 });
  assert.deepEqual(pos[1], { x: 1100, y: 0 });
  assert.deepEqual(pos[2], { x: 0, y: -700 });
  assert.deepEqual(pos[4], { x: 0, y: -1400 });
});
test('gridPositions: 한 줄 갯수가 0이면 거부한다', () => {
  assert.throws(() => gridPositions(3, 0, 100, 100, 10, 10));
});

/* ── MDL: 속성블럭 → 표 행 ── */
test('attributeKeysOf/buildDwgListRows: attributes 키를 모으고 매핑대로 표를 만든다', () => {
  const items = [
    { attributes: { number: 'A-101', name: '1층 평면도', scale: '1/100' } },
    { attributes: { number: 'A-102', name: '2층 평면도' } },
  ];
  const keys = attributeKeysOf(items);
  assert.ok(keys.includes('number') && keys.includes('name') && keys.includes('scale'));
  const rows = buildDwgListRows(items, { number: 'number', name: 'name', scale: 'scale', revision: null });
  assert.deepEqual(rows[0], ['도면번호', '도면명', '축척']);
  assert.deepEqual(rows[1], ['A-101', '1층 평면도', '1/100']);
  assert.deepEqual(rows[2], ['A-102', '2층 평면도', '']);
});
test('buildDwgListRows: 도면번호·도면명 매핑이 없으면 거부한다', () => {
  assert.throws(() => buildDwgListRows([{ attributes: {} }], { number: null, name: 'name' }));
});

/* ── TOB: 일반객체 → 블럭(상대크기·회전 연동) ── */
test('objectLengthAngle: 선은 두 끝점 거리/각도, 그 외는 가로 폭/각도 0', () => {
  const line = objectLengthAngle({ type: 'line', points: [{ x: 0, y: 0 }, { x: 300, y: 400 }] });
  assert.equal(line.length, 500);
  assert.deepEqual(line.anchor, { x: 150, y: 200 });
  const rect = objectLengthAngle({ type: 'rectangle', points: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 50 }, { x: 0, y: 50 }] });
  assert.equal(rect.length, 100);
  assert.equal(rect.angle, 0);
});
test('genericToBlock: 대상 객체 길이에 맞춰 템플릿 블록을 상대크기로 복제한다', () => {
  const template = { type: 'block', name: '문', layer: 'A-DOOR', entities: [{ type: 'line', points: [{ x: 0, y: 0 }, { x: 1000, y: 0 }] }] };
  const target = { type: 'line', layer: 'A-WALL', points: [{ x: 0, y: 0 }, { x: 2000, y: 0 }] };
  const block = genericToBlock(template, target);
  assert.equal(block.type, 'block');
  assert.equal(block.layer, 'A-WALL');
  const line = block.entities[0];
  const length = Math.hypot(line.points[1].x - line.points[0].x, line.points[1].y - line.points[0].y);
  assert.ok(Math.abs(length - 2000) < 1e-6);
});
test('genericToBlock: 기준이 블록이 아니면 거부한다', () => {
  assert.throws(() => genericToBlock({ type: 'line', points: [{ x: 0, y: 0 }, { x: 1, y: 0 }] }, { type: 'line', points: [{ x: 0, y: 0 }, { x: 1, y: 0 }] }));
});

/* ── installTableSheetTools4: 명령 11개가 모두 등록된다 ── */
test('installTableSheetTools4: 명령 11개를 돌려준다', () => {
  const ctx = { storage: { getItem: () => null, setItem: () => {} }, toast: () => {}, userErrorMessage: e => e.message, entities: () => [], selected: () => [], selectedIds: () => [], layers: () => [], activeLayer: () => 'L', ensureLayer: () => 'L', num: (k, d) => d, tolerance: () => 5 };
  const cmds = installTableSheetTools4(ctx);
  for (const name of ['TB', 'TBM', 'TBT', 'RDT', 'C2E', 'E2C', 'BMT', 'DBS', 'MDL', 'TN', 'TOB']) assert.equal(typeof cmds[name], 'function');
});
test('installTableSheetTools4: 선택 없이 BMT 를 실행하면(폼이 즉시 제출된다고 볼 때) 토스트로 오류를 알린다(throw 하지 않는다)', () => {
  let toasted = null;
  const ctx = {
    storage: { getItem: () => null, setItem: () => {} },
    toast: (msg, isError) => { toasted = { msg, isError }; },
    userErrorMessage: e => e.message,
    entities: () => [], selected: () => [], selectedIds: () => [], layers: () => [], activeLayer: () => 'L', ensureLayer: () => 'L', num: (k, d) => d, tolerance: () => 5,
    form: (title, fields, onApply) => { onApply(Object.fromEntries(fields.map(f => [f.name, String(f.value ?? '')]))); },
  };
  const cmds = installTableSheetTools4(ctx);
  assert.doesNotThrow(() => cmds.BMT());
  assert.ok(toasted && toasted.isError);
});
