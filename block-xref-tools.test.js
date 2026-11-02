import test from 'node:test';
import assert from 'node:assert/strict';
import {
 layerWildcardMatch, xrefRestylePlan, xrefRows, describeEntity, matchingBlockIds,
 recolorBlockInterior, blockCenter, blockAnchor, scaleBlockEntity, orderAnchors,
 connectorPolyline, mergeEntitiesIntoBlock, installBlockXrefTools,
} from './block-xref-tools.js';

/* ── layerWildcardMatch ── */
test('layerWildcardMatch: 와일드카드 · 콤마 목록 · 대소문자 무시', () => {
 assert.equal(layerWildcardMatch('A-WALL', 'A-WALL'), true);
 assert.equal(layerWildcardMatch('A-WALL', 'a-wall'), true);
 assert.equal(layerWildcardMatch('A-*', 'A-DOOR'), true);
 assert.equal(layerWildcardMatch('A-*', 'X-COLS'), false);
 assert.equal(layerWildcardMatch('A-DOOR,A-GLAZ', 'A-GLAZ'), true);
 assert.equal(layerWildcardMatch('', 'A-WALL'), false);
});

/* ── xrefRestylePlan (XRC) ── */
function layers() {
 return [
  { id: 'l1', name: 'A-WALL', color: '#111111', visible: true, frozen: false },
  { id: 'l2', name: 'A-HIDDEN', color: '#222222', visible: false, frozen: false },
  { id: 'l3', name: 'A-EXCL', color: '#333333', visible: true, frozen: false },
 ];
}
function xrefEntity(id, layer, children = []) {
 return { id, type: 'block', name: 'REF', layer, xref: { folder: '../x', name: 'a.dxf', scale: 1 }, entities: children };
}
test('xrefRestylePlan: 색을 재귀적으로 바꾸고 잘못된 색은 거부', () => {
 const child = { id: 'c1', type: 'line', layer: 'l1', points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] };
 const entities = [xrefEntity('a', 'l1', [child])];
 const layerById = new Map(layers().map(l => [l.id, l]));
 const plan = xrefRestylePlan(entities, layerById, { color: '#ff0000' });
 assert.equal(plan.length, 1);
 assert.equal(plan[0].changes.color, '#ff0000');
 assert.equal(plan[0].changes.entities[0].color, '#ff0000');
 assert.throws(() => xrefRestylePlan(entities, layerById, { color: 'red' }), /#RRGGBB/);
 assert.throws(() => xrefRestylePlan([{ type: 'line' }], layerById, { color: '#ff0000' }), /외부참조가 없습니다/);
});
test('xrefRestylePlan: 꺼지거나 얼려진 켜 제외', () => {
 const entities = [xrefEntity('a', 'l2', [])];
 const layerById = new Map(layers().map(l => [l.id, l]));
 const plan = xrefRestylePlan(entities, layerById, { color: '#ff0000', excludeHidden: true });
 assert.equal(plan[0].changes.color, undefined);
});
test('xrefRestylePlan: 적용 켜 · 제외 켜 와일드카드', () => {
 const entities = [xrefEntity('a', 'l1', []), xrefEntity('b', 'l3', [])];
 const layerById = new Map(layers().map(l => [l.id, l]));
 const included = xrefRestylePlan(entities, layerById, { color: '#00ff00', includeLayers: 'A-WALL' });
 assert.equal(included.find(p => p.id === 'a').changes.color, '#00ff00');
 assert.equal(included.find(p => p.id === 'b').changes.color, undefined);
 const excluded = xrefRestylePlan(entities, layerById, { color: '#00ff00', excludeLayers: 'A-EXCL' });
 assert.equal(excluded.find(p => p.id === 'a').changes.color, '#00ff00');
 assert.equal(excluded.find(p => p.id === 'b').changes.color, undefined);
});

/* ── xrefRows (XRL) ── */
test('xrefRows: 외부참조만 뽑아 이름/경로/상태로 정리', () => {
 const rows = xrefRows([
  xrefEntity('a', 'l1'),
  { ...xrefEntity('b', 'l1'), hidden: true, xref: { folder: '../y', name: 'b.dxf', relative: true } },
  { id: 'c', type: 'line', layer: 'l1' },
 ]);
 assert.equal(rows.length, 2);
 assert.equal(rows[0].status, '표시');
 assert.equal(rows[1].status, '숨김');
 assert.equal(rows[1].relative, true);
 assert.equal(rows[1].folder + '/' + rows[1].file, '../y/b.dxf');
});

/* ── describeEntity (LII) ── */
test('describeEntity: 일반 객체·블록·외부참조 정보', () => {
 assert.throws(() => describeEntity(null, []), /선택하세요/);
 const ls = [{ id: 'l1', name: 'A-WALL', color: '#abcabc', linetype: 'CONTINUOUS' }];
 const line = { type: 'line', layer: 'l1', points: [{ x: 0, y: 0 }, { x: 10, y: 20 }] };
 const infoLine = describeEntity(line, ls);
 assert.equal(infoLine.layerName, 'A-WALL');
 assert.equal(infoLine.color, 'ByLayer');
 assert.deepEqual(infoLine.start, { x: 0, y: 0 });
 assert.deepEqual(infoLine.end, { x: 10, y: 20 });
 const block = xrefEntity('a', 'l1', [{ type: 'line', layer: 'l1', points: [{ x: 0, y: 0 }, { x: 1, y: 0 }] }, { type: 'circle', layer: 'l1', center: { x: 0, y: 0 }, radius: 5 }]);
 const infoBlock = describeEntity(block, ls);
 assert.equal(infoBlock.blockName, 'REF');
 assert.equal(infoBlock.innerCount, 2);
 assert.equal(infoBlock.xrefPath, '../x/a.dxf');
 const circle = { type: 'circle', layer: 'l1', center: { x: 3, y: 4 }, radius: 5 };
 assert.deepEqual(describeEntity(circle, ls).center, { x: 3, y: 4 });
});

test('describeEntity: 선가중치(ByLayer·레이어 값·객체 값)와 출력 농도 (H19)', () => {
 const ls = [{ id: 'l1', name: 'A-WALL', color: '#ffffff', linetype: 'CONTINUOUS', lineweight: 0.3 }];
 const byLayer = describeEntity({ type: 'line', layer: 'l1', points: [{ x: 0, y: 0 }, { x: 1, y: 0 }] }, ls);
 assert.equal(byLayer.lineweight, 'ByLayer');
 assert.equal(byLayer.layerLineweight, 0.3);
 const own = describeEntity({ type: 'line', layer: 'l1', lineweight: 0.5, plotDensity: 40, points: [{ x: 0, y: 0 }, { x: 1, y: 0 }] }, ls);
 assert.equal(own.lineweight, 0.5);
 assert.equal(own.plotDensity, 40);
});

/* ── matchingBlockIds (BLA · MFB) ── */
test('matchingBlockIds: 같은 이름만, 외부참조·표는 제외', () => {
 const entities = [
  { id: '1', type: 'block', name: 'CHAIR' },
  { id: '2', type: 'block', name: 'CHAIR' },
  { id: '3', type: 'block', name: 'CHAIR', xref: { folder: '.', name: 'x' } },
  { id: '4', type: 'block', name: 'CHAIR', table: true },
  { id: '5', type: 'block', name: 'DESK' },
 ];
 assert.deepEqual(matchingBlockIds(entities, 'CHAIR'), ['1', '2']);
 assert.throws(() => matchingBlockIds(entities, ''), /이름이 없습니다/);
});

/* ── recolorBlockInterior (BLA) ── */
test('recolorBlockInterior: 자식만 재귀적으로 바뀌고 컨테이너 켜는 그대로', () => {
 const block = { id: 'b1', type: 'block', name: 'CHAIR', layer: 'l0', entities: [
  { type: 'line', layer: 'l1', points: [] },
  { type: 'block', layer: 'l1', entities: [{ type: 'circle', layer: 'l1', center: { x: 0, y: 0 }, radius: 1 }] },
 ] };
 const result = recolorBlockInterior(block, 'l9');
 assert.equal(result.layer, 'l0');
 assert.equal(result.entities[0].layer, 'l9');
 assert.equal(result.entities[1].layer, 'l9');
 assert.equal(result.entities[1].entities[0].layer, 'l9');
 assert.throws(() => recolorBlockInterior({ type: 'line' }, 'l9'), /블록만/);
 assert.throws(() => recolorBlockInterior({ type: 'block', xref: {} }, 'l9'), /외부참조/);
 assert.throws(() => recolorBlockInterior(block, ''), /바꿀 켜/);
});

/* ── blockCenter/blockAnchor · scaleBlockEntity (BBL · MFB) ── */
test('blockCenter: position 우선, 없으면 범위 중심', () => {
 assert.deepEqual(blockCenter({ type: 'block', position: { x: 5, y: 6 } }), { x: 5, y: 6 });
 const block = { type: 'block', entities: [{ type: 'line', layer: 'l1', points: [{ x: 0, y: 0 }, { x: 10, y: 10 }] }] };
 assert.deepEqual(blockCenter(block), { x: 5, y: 5 });
 assert.equal(blockAnchor, blockCenter);
 assert.throws(() => blockCenter({ type: 'block', entities: [] }), /범위를 계산할 수 없습니다/);
 assert.throws(() => blockCenter({ type: 'line' }), /블록만/);
});
test('scaleBlockEntity: 기준점 중심 확대(자식 좌표도 함께 늘어남)', () => {
 const block = { type: 'block', position: { x: 100, y: 100 }, entities: [{ type: 'line', layer: 'l1', points: [{ x: 100, y: 100 }, { x: 110, y: 100 }] }] };
 const scaled = scaleBlockEntity(block, 2);
 assert.deepEqual(scaled.entities[0].points[1], { x: 120, y: 100 });
 assert.throws(() => scaleBlockEntity({ type: 'line' }, 2), /블록만/);
});

/* ── orderAnchors · connectorPolyline (BBL) ── */
test('orderAnchors: x·y 정렬과 자동(최근접) 경로', () => {
 const pts = [{ x: 100, y: 0 }, { x: 0, y: 0 }, { x: 50, y: 0 }];
 assert.deepEqual(orderAnchors(pts, 'x'), [{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 100, y: 0 }]);
 const auto = orderAnchors(pts, 'auto');
 assert.deepEqual(auto[0], { x: 0, y: 0 });
 assert.deepEqual(auto[1], { x: 50, y: 0 });
 assert.deepEqual(auto[2], { x: 100, y: 0 });
 assert.throws(() => orderAnchors([{ x: 0, y: 0 }], 'auto'), /2개 이상/);
 assert.throws(() => orderAnchors(pts, 'zigzag'), /알 수 없는/);
});
test('connectorPolyline: 열린 폴리선 생성', () => {
 const poly = connectorPolyline([{ x: 0, y: 0 }, { x: 1, y: 1 }], 'lyr');
 assert.equal(poly.type, 'polyline');
 assert.equal(poly.closed, false);
 assert.equal(poly.layer, 'lyr');
 assert.throws(() => connectorPolyline([{ x: 0, y: 0 }], 'lyr'), /2개 이상/);
});

/* ── mergeEntitiesIntoBlock (BAD) ── */
test('mergeEntitiesIntoBlock: 절대좌표 그대로 붙이고 id는 벗겨낸다', () => {
 const block = { id: 'b1', type: 'block', name: 'N', layer: 'l1', entities: [{ id: 'x', type: 'line', layer: 'l1', points: [] }] };
 const extra = { id: 'e1', type: 'line', layer: 'l1', points: [{ x: 5, y: 5 }, { x: 6, y: 6 }] };
 const merged = mergeEntitiesIntoBlock(block, [extra]);
 assert.equal(merged.entities.length, 2);
 assert.equal(merged.entities[1].id, undefined);
 assert.deepEqual(merged.entities[1].points, extra.points);
 assert.throws(() => mergeEntitiesIntoBlock({ type: 'block', xref: {} }, [extra]), /외부참조는 원본 보호/);
 assert.throws(() => mergeEntitiesIntoBlock(block, []), /먼저 선택/);
 assert.throws(() => mergeEntitiesIntoBlock({ type: 'line' }, [extra]), /블록 하나를/);
 assert.throws(() => mergeEntitiesIntoBlock(block, [block]), /대상 블록 자신/);
});

/* ── installBlockXrefTools: 13개 명령이 모두 등록되고, "없음" 카드는 정직하게 토스트만 낸다 ── */
function fakeCtx(overrides = {}) {
 const doc = { entities: [], layers: [{ id: 'l1', name: 'A-WALL', color: '#fff', visible: true, frozen: false }] };
 const toasts = [], logs = [], executed = [];
 return {
  toasts, logs, executed,
  entities: () => doc.entities,
  layers: () => doc.layers,
  selected: () => doc.entities.filter(e => e.__sel),
  setSelected: () => {},
  execute: c => { executed.push(c); return []; },
  commit: () => {},
  ensureLayer: () => 'l1',
  pickEntity: async () => null,
  form: (title, fields, onApply) => { fakeCtx.lastForm = { title, fields, onApply }; },
  toast: (msg, isError) => toasts.push({ msg, isError }),
  log: msg => logs.push(msg),
  userErrorMessage: e => e.message,
  refresh: () => {},
  run: () => {},
  ...overrides,
 };
}
test('installBlockXrefTools: 명령 13개가 함수로 등록된다', () => {
 const ctx = fakeCtx();
 const cmds = installBlockXrefTools(ctx);
 const names = ['LII', 'REX', 'XRL', 'XRC', 'XRR', 'BAD', 'BBL', 'BLA', 'MFB'];
 assert.equal(Object.keys(cmds).length, names.length);
 for (const n of names) assert.equal(typeof cmds[n], 'function', n + ' 명령이 없습니다');
});
test('구현 불가로 삭제한 카드(MFX·RBP·B2X·CX)는 없다', () => {
 const cmds = installBlockXrefTools(fakeCtx());
 for (const n of ['MFX', 'RBP', 'B2X', 'CX']) assert.ok(!(n in cmds), n);
});
test('REX·XRR: 외부참조가 없으면 오류 토스트, 있으면 run(XREF)에 위임', async () => {
 const ctx = fakeCtx();
 const cmds = installBlockXrefTools(ctx);
 await cmds.REX();
 assert.match(ctx.toasts.at(-1).msg, /외부참조가 없습니다/);
 ctx.entities().push({ id: 'a', type: 'block', name: 'REF', layer: 'l1', xref: { folder: '.', name: 'a.dxf' }, entities: [] });
 let ran = null;
 const ctx2 = fakeCtx({ run: name => { ran = name; }, entities: ctx.entities });
 const cmds2 = installBlockXrefTools(ctx2);
 await cmds2.REX();
 assert.equal(ran, 'XREF');
 assert.match(ctx2.toasts.at(-1).msg, /외부참조 관리자/);
});
test('LII: 선택한 객체 정보를 명령창(log)에 남긴다', async () => {
 const entity = { type: 'line', layer: 'l1', points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] };
 const ctx = fakeCtx({ pickEntity: async () => entity });
 const cmds = installBlockXrefTools(ctx);
 await cmds.LII();
 assert.equal(ctx.logs.length, 1);
 assert.match(ctx.logs[0], /^LII ·/);
 assert.equal(ctx.toasts.length, 1);
});
test('BAD: 선택 중인 블록+객체를 하나의 batch(update+delete)로 합친다', async () => {
 const block = { id: 'b1', type: 'block', name: 'N', layer: 'l1', entities: [], __sel: true };
 const extra = { id: 'e1', type: 'line', layer: 'l1', points: [{ x: 0, y: 0 }, { x: 1, y: 1 }], __sel: true };
 const ctx = fakeCtx();
 ctx.entities().push(block, extra);
 const cmds = installBlockXrefTools(ctx);
 await cmds.BAD();
 assert.equal(ctx.executed.length, 1);
 assert.equal(ctx.executed[0].type, 'batch');
 const kinds = ctx.executed[0].commands.map(c => c.type).sort();
 assert.deepEqual(kinds, ['delete', 'update']);
 assert.match(ctx.toasts.at(-1).msg, /BAD · 객체 1개를/);
});
test('BLA: 폼을 열고 적용하면 같은 이름 블록 전체를 batch update한다', async () => {
 const a = { id: 'a', type: 'block', name: 'CHAIR', layer: 'l1', entities: [{ type: 'line', layer: 'l1', points: [] }], __sel: true };
 const b = { id: 'b', type: 'block', name: 'CHAIR', layer: 'l1', entities: [{ type: 'line', layer: 'l1', points: [] }] };
 const ctx = fakeCtx();
 ctx.entities().push(a, b);
 const cmds = installBlockXrefTools(ctx);
 cmds.BLA();
 assert.ok(fakeCtx.lastForm.title.startsWith('BLA'));
 fakeCtx.lastForm.onApply({ layer: 'l1', scope: 'all' });
 const batch = ctx.executed.find(c => c.type === 'batch');
 assert.equal(batch.commands.length, 2);
});
test('BBL: 폼을 열고 적용하면 연결선을 커밋한다', async () => {
 const committed = [];
 const a = { id: 'a', type: 'block', name: 'TREE', layer: 'l1', position: { x: 0, y: 0 }, entities: [], __sel: true };
 const b = { id: 'b', type: 'block', name: 'TREE', layer: 'l1', position: { x: 100, y: 0 }, entities: [], __sel: true };
 const ctx = fakeCtx({ commit: ({ entities }) => committed.push(...entities) });
 ctx.entities().push(a, b);
 const cmds = installBlockXrefTools(ctx);
 await cmds.BBL();
 fakeCtx.lastForm.onApply({ mode: 'auto' });
 assert.equal(committed.length, 1);
 assert.equal(committed[0].type, 'polyline');
 assert.equal(committed[0].points.length, 2);
});
test('MFB: 삭제 작업은 즉시 delete를 실행한다', async () => {
 const a = { id: 'a', type: 'block', name: 'DESK', layer: 'l1', entities: [], __sel: true };
 const b = { id: 'b', type: 'block', name: 'DESK', layer: 'l1', entities: [] };
 const ctx = fakeCtx();
 ctx.entities().push(a, b);
 const cmds = installBlockXrefTools(ctx);
 cmds.MFB();
 fakeCtx.lastForm.onApply({ action: 'delete' });
 const del = ctx.executed.find(c => c.type === 'delete');
 assert.deepEqual(del.ids.sort(), ['a', 'b']);
});
test('XRC: 폼을 적용하면 batch(update)로 색을 바꾼다', async () => {
 const ref = { id: 'r1', type: 'block', name: 'REF', layer: 'l1', xref: { folder: '.', name: 'a.dxf' }, entities: [] };
 const ctx = fakeCtx();
 ctx.entities().push(ref);
 const cmds = installBlockXrefTools(ctx);
 cmds.XRC();
 fakeCtx.lastForm.onApply({ scope: 'all', color: '#123456', excludeHidden: 'include', includeLayers: '', excludeLayers: '' });
 const batch = ctx.executed.find(c => c.type === 'batch');
 assert.equal(batch.commands[0].changes.color, '#123456');
});
