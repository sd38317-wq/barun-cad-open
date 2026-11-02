import test from 'node:test';
import assert from 'node:assert/strict';
import {
 layerWildcardMatch, matchingBlockIds, blockAnchor, flattenBlockChildren, describeChildRow,
 extractChildAtPath, removeChildrenAtPaths, restyleBlockInterior, renameBlockName, buildSerialNames,
 blockNameMarkTexts, sharedBlockEntities, entityWithinClip, xclipExtractPlan, currentValueFromEntity,
 standardLayerPreset, installBlockEditTools,
} from './block-edit-tools.js';

/* ── layerWildcardMatch ── */
test('layerWildcardMatch: 와일드카드·콤마·대소문자 무시', () => {
 assert.equal(layerWildcardMatch('A-WALL', 'A-WALL'), true);
 assert.equal(layerWildcardMatch('A-WALL', 'a-wall'), true);
 assert.equal(layerWildcardMatch('A-*', 'A-DOOR'), true);
 assert.equal(layerWildcardMatch('A-*', 'X-COLS'), false);
 assert.equal(layerWildcardMatch('A-DOOR,A-GLAZ', 'A-GLAZ'), true);
 assert.equal(layerWildcardMatch('', 'A-WALL'), false);
});

/* ── matchingBlockIds ── */
test('matchingBlockIds: 같은 이름 블록만, 표·외부참조는 제외', () => {
 const entities = [
  { id: 'a', type: 'block', name: 'CHAIR', entities: [] },
  { id: 'b', type: 'block', name: 'CHAIR', entities: [] },
  { id: 'c', type: 'block', name: 'DESK', entities: [] },
  { id: 'd', type: 'block', name: 'CHAIR', table: true, entities: [] },
  { id: 'e', type: 'block', name: 'CHAIR', xref: { folder: '.', name: 'x.dxf' }, entities: [] },
 ];
 assert.deepEqual(matchingBlockIds(entities, 'CHAIR').sort(), ['a', 'b']);
 assert.throws(() => matchingBlockIds(entities, ''), /이름이 없습니다/);
});

/* ── blockAnchor ── */
test('blockAnchor: position 우선, 없으면 범위 중심, 블록 아니면 오류', () => {
 assert.deepEqual(blockAnchor({ type: 'block', position: { x: 10, y: 20 }, entities: [] }), { x: 10, y: 20 });
 const noPos = { type: 'block', entities: [{ type: 'line', points: [{ x: 0, y: 0 }, { x: 10, y: 10 }] }] };
 assert.deepEqual(blockAnchor(noPos), { x: 5, y: 5 });
 assert.throws(() => blockAnchor({ type: 'line' }), /블록만/);
 assert.throws(() => blockAnchor({ type: 'block', entities: [] }), /범위를 계산할 수 없습니다/);
});

/* ── flattenBlockChildren · describeChildRow (BCO·BRM 목록) ── */
function nestedBlock() {
 return {
  id: 'b1', type: 'block', name: 'GROUP', layer: 'l1',
  entities: [
   { type: 'line', layer: 'l1', points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] },
   { type: 'block', name: 'INNER', layer: 'l1', entities: [{ type: 'text', layer: 'l1', text: 'hi', position: { x: 0, y: 0 } }] },
  ],
 };
}
test('flattenBlockChildren: 재귀적으로 번호 매긴 평평한 목록을 만든다', () => {
 const rows = flattenBlockChildren(nestedBlock());
 assert.equal(rows.length, 3);
 assert.deepEqual(rows[0].path, [0]);
 assert.deepEqual(rows[1].path, [1]);
 assert.deepEqual(rows[2].path, [1, 0]);
 assert.equal(rows[2].depth, 1);
 assert.match(describeChildRow(rows[1]), /block "INNER"/);
 assert.match(describeChildRow(rows[2]), /text "hi"/);
 assert.throws(() => flattenBlockChildren({ type: 'line' }), /블록을 선택하세요/);
});

/* ── extractChildAtPath (BCO) ── */
test('extractChildAtPath: 절대좌표 그대로 복제하고 id는 지운다', () => {
 const block = nestedBlock();
 const top = extractChildAtPath(block, [0]);
 assert.equal(top.type, 'line');
 assert.equal(top.id, undefined);
 assert.deepEqual(top.points, [{ x: 0, y: 0 }, { x: 1, y: 1 }]);
 const nested = extractChildAtPath(block, [1, 0]);
 assert.equal(nested.text, 'hi');
 assert.throws(() => extractChildAtPath(block, [9]), /찾을 수 없습니다/);
 assert.throws(() => extractChildAtPath({ type: 'line' }, [0]), /블록을 선택하세요/);
});

/* ── removeChildrenAtPaths (BRM) ── */
test('removeChildrenAtPaths: 경로 집합으로 지우고, 순서와 무관하게 정확하다', () => {
 const block = nestedBlock();
 const removed = removeChildrenAtPaths(block, [[0]]);
 assert.equal(removed.entities.length, 1);
 assert.equal(removed.entities[0].name, 'INNER');
 const removedNested = removeChildrenAtPaths(block, [[1, 0]]);
 assert.equal(removedNested.entities[1].entities.length, 0);
 assert.equal(removedNested.entities[0].type, 'line'); // 형제는 그대로
 assert.throws(() => removeChildrenAtPaths(block, [[0], [1]]), /하나 이상은 남겨야 합니다/);
 assert.throws(() => removeChildrenAtPaths(block, []), /지울 항목을 선택하세요/);
});

/* ── restyleBlockInterior (BCC) ── */
function layers() {
 return [
  { id: 'l1', name: 'A-WALL', color: '#111', visible: true, frozen: false },
  { id: 'l2', name: 'A-HIDDEN', color: '#222', visible: false, frozen: false },
  { id: 'l3', name: 'A-EXCL', color: '#333', visible: true, frozen: false },
 ];
}
test('restyleBlockInterior: 켜·색을 재귀적으로 바꾼다', () => {
 const block = nestedBlock();
 const layerById = new Map(layers().map(l => [l.id, l]));
 const updated = restyleBlockInterior(block, layerById, { layer: 'l3', color: '#ff0000' });
 assert.equal(updated.entities[0].layer, 'l3');
 assert.equal(updated.entities[0].color, '#ff0000');
 assert.equal(updated.entities[1].entities[0].layer, 'l3'); // 재귀
 assert.throws(() => restyleBlockInterior(block, layerById, {}), /하나 이상 선택/);
 assert.throws(() => restyleBlockInterior(block, layerById, { color: 'red' }), /#RRGGBB/);
 assert.throws(() => restyleBlockInterior({ ...block, xref: { folder: '.', name: 'a' } }, layerById, { color: '#ff0000' }), /외부참조/);
});
test('restyleBlockInterior: 내부의 블럭 객체만 적용', () => {
 const block = nestedBlock();
 const layerById = new Map(layers().map(l => [l.id, l]));
 const updated = restyleBlockInterior(block, layerById, { layer: 'l3', innerBlocksOnly: true });
 assert.equal(updated.entities[0].layer, 'l1'); // line은 건너뜀
 assert.equal(updated.entities[1].layer, 'l3'); // 중첩 블록은 적용
});
test('restyleBlockInterior: 제외 켜 와일드카드·꺼짐 제외', () => {
 const block = { type: 'block', entities: [{ type: 'line', layer: 'l1' }, { type: 'line', layer: 'l2' }, { type: 'line', layer: 'l3' }] };
 const layerById = new Map(layers().map(l => [l.id, l]));
 const updated = restyleBlockInterior(block, layerById, { color: '#00ff00', excludeLayers: 'A-EXCL', excludeHidden: true });
 assert.equal(updated.entities[0].color, '#00ff00');
 assert.equal(updated.entities[1].color, undefined); // 꺼진 켜 제외
 assert.equal(updated.entities[2].color, undefined); // 와일드카드 제외
});

/* ── renameBlockName · buildSerialNames (BRN) ── */
test('renameBlockName: 새 이름으로 바꾸고 빈 이름은 거부', () => {
 const block = { type: 'block', name: 'OLD', entities: [] };
 assert.equal(renameBlockName(block, ' NEW ').name, 'NEW');
 assert.throws(() => renameBlockName(block, '  '), /새 이름을 입력하세요/);
 assert.throws(() => renameBlockName({ type: 'line' }, 'X'), /블록만/);
});
test('buildSerialNames: 접두/접미/일련번호 자리수', () => {
 const names = buildSerialNames('CHAIR', { prefix: 'A-', suffix: '-01', numbered: true, start: 1, digits: 3 }, 3);
 assert.deepEqual(names, ['A-CHAIR001-01', 'A-CHAIR002-01', 'A-CHAIR003-01']);
 const same = buildSerialNames('CHAIR', {}, 2);
 assert.deepEqual(same, ['CHAIR', 'CHAIR']);
 assert.throws(() => buildSerialNames('', {}, 1), /바탕 이름/);
});

/* ── blockNameMarkTexts (BNM) ── */
test('blockNameMarkTexts: 삽입점 위/아래로 오프셋된 텍스트를 만든다', () => {
 const list = [{ type: 'block', name: 'TREE', position: { x: 0, y: 0 }, entities: [] }];
 const below = blockNameMarkTexts(list, { layer: 'l1', size: 3, gap: 5, position: 'below' });
 assert.equal(below[0].position.y, -5);
 assert.equal(below[0].text, 'TREE');
 const above = blockNameMarkTexts(list, { layer: 'l1', size: 3, gap: 5, position: 'above' });
 assert.equal(above[0].position.y, 5);
 assert.throws(() => blockNameMarkTexts([], { layer: 'l1' }), /블록을 선택하세요/);
 assert.throws(() => blockNameMarkTexts(list, {}), /켜를 지정하세요/);
});

/* ── sharedBlockEntities (M2B) ── */
test('sharedBlockEntities: 압축 공유 블록만 골라낸다', () => {
 const list = [{ type: 'block', sharedBlock: 'k1' }, { type: 'block' }, { type: 'line', sharedBlock: 'k2' }];
 assert.equal(sharedBlockEntities(list).length, 1);
});

/* ── entityWithinClip · xclipExtractPlan (XCX) ── */
function squareClip(inverted = false) {
 return { points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }], enabled: true, inverted };
}
test('entityWithinClip: window은 완전히 안쪽, crossing은 걸치기만 해도 포함', () => {
 const inside = { type: 'line', points: [{ x: 2, y: 2 }, { x: 8, y: 8 }] };
 const crossing = { type: 'line', points: [{ x: 5, y: 5 }, { x: 20, y: 20 }] };
 const outside = { type: 'line', points: [{ x: 20, y: 20 }, { x: 30, y: 30 }] };
 assert.equal(entityWithinClip(inside, squareClip(), 'window'), true);
 assert.equal(entityWithinClip(crossing, squareClip(), 'window'), false);
 assert.equal(entityWithinClip(crossing, squareClip(), 'crossing'), true);
 assert.equal(entityWithinClip(outside, squareClip(), 'crossing'), false);
});
test('xclipExtractPlan: 경계 밖 객체는 버리고 안쪽만 남긴다', () => {
 const block = {
  type: 'block', layer: 'l1', clip: squareClip(),
  entities: [
   { id: 'x', type: 'line', layer: 'l1', points: [{ x: 2, y: 2 }, { x: 8, y: 8 }] },
   { id: 'y', type: 'line', layer: 'l1', points: [{ x: 20, y: 20 }, { x: 30, y: 30 }] },
  ],
 };
 const plan = xclipExtractPlan(block, 'window');
 assert.equal(plan.kept.length, 1);
 assert.equal(plan.kept[0].id, undefined);
 assert.equal(plan.droppedCount, 1);
 assert.throws(() => xclipExtractPlan({ type: 'block', entities: [] }, 'window'), /XCLIP으로 자른 블록이 아닙니다/);
});
test('xclipExtractPlan: inverted 클립은 반대로 남긴다', () => {
 const block = {
  type: 'block', layer: 'l1', clip: squareClip(true),
  entities: [
   { id: 'x', type: 'line', layer: 'l1', points: [{ x: 2, y: 2 }, { x: 8, y: 8 }] },
   { id: 'y', type: 'line', layer: 'l1', points: [{ x: 20, y: 20 }, { x: 30, y: 30 }] },
  ],
 };
 const plan = xclipExtractPlan(block, 'window');
 assert.equal(plan.kept.length, 1);
 assert.deepEqual(plan.kept[0].points, [{ x: 20, y: 20 }, { x: 30, y: 30 }]);
});

/* ── currentValueFromEntity (CV) ── */
test('currentValueFromEntity: 타입별 반영/미반영 항목', () => {
 assert.deepEqual(currentValueFromEntity({ type: 'text', layer: 'l1' }), { layer: 'l1', unsupported: ['TextStyle', 'TextSize'] });
 assert.deepEqual(currentValueFromEntity({ type: 'dimension', layer: 'l1' }).unsupported, ['DimStyle', 'TextStyle']);
 assert.deepEqual(currentValueFromEntity({ type: 'circle', layer: 'l1' }).unsupported, ['FilletRad']);
 assert.deepEqual(currentValueFromEntity({ type: 'polyline', layer: 'l1' }).unsupported, ['Thickness']);
 const hatch = currentValueFromEntity({ type: 'hatch', layer: 'l1' });
 assert.equal(hatch.layer, null);
 assert.deepEqual(hatch.unsupported, ['HPName', 'HPScale']);
 assert.throws(() => currentValueFromEntity(null), /참조할 객체를 선택하세요/);
});

/* ── standardLayerPreset (STT) ── */
test('standardLayerPreset: 표준 켜 5개, 중심선은 CENTER 선종류', () => {
 const preset = standardLayerPreset();
 assert.equal(preset.length, 5);
 assert.ok(preset.every(p => /^[A-Z][A-Z0-9-]+$/.test(p.name)));
 assert.equal(preset.find(p => p.name === 'A-WALL-C').linetype, 'CENTER');
});

/* ── installBlockEditTools: 명령 15개 등록, 없음 카드 5개, 실행 흐름 ── */
function fakeCtx(overrides = {}) {
 const doc = { entities: [], layers: [{ id: 'l1', name: 'A-WALL', color: '#fff', visible: true, frozen: false }] };
 const toasts = [], logs = [], executed = []; let activeLayer = null;
 return {
  toasts, logs, executed, getActiveLayer: () => activeLayer,
  entities: () => doc.entities,
  layers: () => doc.layers,
  selected: () => doc.entities.filter(e => e.__sel),
  setSelected: () => {},
  execute: c => { executed.push(c); return []; },
  ensureLayer: () => 'l1',
  pickEntity: async () => null,
  form: (title, fields, onApply) => { fakeCtx.lastForm = { title, fields, onApply }; },
  toast: (msg, isError) => toasts.push({ msg, isError }),
  log: msg => logs.push(msg),
  userErrorMessage: e => e.message,
  refresh: () => {},
  setActiveLayer: id => { activeLayer = id; },
  ...overrides,
 };
}
test('installBlockEditTools: 명령 10개가 함수로 등록된다', () => {
 const ctx = fakeCtx();
 const cmds = installBlockEditTools(ctx);
 const names = ['BCC', 'BCO', 'BNM', 'BRM', 'BRN', 'EAR', 'M2B', 'XCX', 'CV', 'STT'];
 assert.equal(Object.keys(cmds).length, names.length);
 for (const n of names) assert.equal(typeof cmds[n], 'function', n + ' 명령이 없습니다');
});
/* ── STT (2026-09-24 F13 실제 동작): 축척 → 선축척·치수모양, 표준 켜, 도곽은 SHEET 로 잇기 ── */
test('STT: 축척 1/200 이면 선축척 200 · 치수모양 문자높이 300 · 표준 켜 생성 · 도곽 선택 시 SHEET 실행', async () => {
 const make = (overrides) => {
  const layers = [{ id: 'l0', name: '0', color: '#fff' }], executed = [], runs = [], toasts = [];
  const ctx = {
   layers: () => layers, entities: () => [], selected: () => [], refresh: () => {}, run: async n => { runs.push(n); },
   toast: (m, isError) => toasts.push({ m, isError }), userErrorMessage: e => e.message,
   execute: c => { executed.push(c); if (c.type === 'batch') for (const x of c.commands) if (x.type === 'layer.add') layers.push({ id: 'id-' + x.name, name: x.name, color: x.color }); return []; },
   form: (title, fields, onApply) => { const v = Object.fromEntries(fields.map(f => [f.name, f.value])); return onApply({ ...v, ...overrides }); },
  };
  return { ctx, executed, runs, toasts };
 };
 const a = make({ denominator: '200', sheet: 'none', lineScale: 'on', dimScale: 'on' });
 await installBlockEditTools(a.ctx).STT();
 const doc = a.executed.find(c => c.type === 'document.update');
 assert.equal(doc.changes.linetypeScale, 200);
 // 검토자 지적 2: 값(문자높이 150)은 그대로 두고 scale 만 2 → geometry 가 150×2=300 으로 그린다(제곱 방지)
 assert.equal(doc.changes.dimStyles.STANDARD.textHeight, 150);
 assert.equal(doc.changes.dimStyles.STANDARD.scale, 2);
 assert.ok(a.ctx.layers().some(l => l.name === 'A-WALL-C'));
 assert.ok(a.executed.some(c => c.type === 'batch' && c.commands.some(x => x.type === 'layer.update' && x.changes.linetype === 'CENTER')));
 assert.deepEqual(a.runs, []);
 assert.match(a.toasts[0].m, /선축척 1 → 200/);
 // 검토자 지적 3: 축척 반영 체크는 기본 끔 → 기본값으로 적용하면 document.update 가 없다
 const d = make({ denominator: '200', sheet: 'none' });
 await installBlockEditTools(d.ctx).STT();
 assert.ok(!d.executed.some(c => c.type === 'document.update'));
 const b = make({ denominator: '100', sheet: 'sheet', layers: '' });
 await installBlockEditTools(b.ctx).STT();
 assert.deepEqual(b.runs, ['SHEET']);
 assert.ok(!b.executed.some(c => c.type === 'document.update'));
 // 검토자 지적 12: STL 과 SHEET 를 둘 다 고르면 STL 만 열고 SHEET 는 안내만
 const e = make({ denominator: '100', sheet: 'sheet', steal: 'on', layers: '' });
 await installBlockEditTools(e.ctx).STT();
 assert.deepEqual(e.runs, ['STL']);
 assert.match(e.toasts[0].m, /SHEET 를 직접 실행/);
 const c = make({ denominator: '0' });
 await installBlockEditTools(c.ctx).STT();
 assert.match(c.toasts[0].m, /축척 분모/);
 assert.equal(c.toasts[0].isError, true);
});
test('구현 불가로 삭제한 카드(Q1·QWB·IB·OL·BRSETUP)는 없다', () => {
 const cmds = installBlockEditTools(fakeCtx());
 for (const n of ['Q1', 'QWB', 'IB', 'OL', 'BRSETUP']) assert.ok(!(n in cmds), n);
});
test('BCC: 폼 적용시 update 하나로 켜·색을 바꾼다', async () => {
 const block = { id: 'b1', type: 'block', name: 'CHAIR', layer: 'l1', entities: [{ type: 'line', layer: 'l1' }], __sel: true };
 const ctx = fakeCtx();
 ctx.entities().push(block);
 const cmds = installBlockEditTools(ctx);
 await cmds.BCC();
 assert.ok(fakeCtx.lastForm.title.startsWith('BCC'));
 fakeCtx.lastForm.onApply({ layerOn: 'on', layer: 'l1', includeOuter: '', colorOn: 'on', color: '#00ff00', innerBlocksOnly: '', excludeHidden: '', excludeLayers: '' });
 const upd = ctx.executed.find(c => c.type === 'update');
 assert.equal(upd.changes.entities[0].color, '#00ff00');
});
test('BCO: 명령창에 번호 목록을 남기고, 번호를 고르면 addMany로 복사한다', async () => {
 const block = { id: 'b1', type: 'block', name: 'GROUP', layer: 'l1', entities: [{ type: 'line', layer: 'l1', points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] }], __sel: true };
 const ctx = fakeCtx();
 ctx.entities().push(block);
 const cmds = installBlockEditTools(ctx);
 await cmds.BCO();
 assert.equal(ctx.logs.length, 1);
 fakeCtx.lastForm.onApply({ index: 1 });
 const add = ctx.executed.find(c => c.type === 'addMany');
 assert.equal(add.entities.length, 1);
 assert.equal(add.entities[0].type, 'line');
});
test('BNM: 선택 블록마다 이름표 텍스트를 addMany로 만든다', () => {
 const block = { id: 'b1', type: 'block', name: 'TREE', layer: 'l1', position: { x: 0, y: 0 }, entities: [], __sel: true };
 const ctx = fakeCtx();
 ctx.entities().push(block);
 const cmds = installBlockEditTools(ctx);
 cmds.BNM();
 fakeCtx.lastForm.onApply({ position: 'below', size: 3, gap: 5 });
 const add = ctx.executed.find(c => c.type === 'addMany');
 assert.equal(add.entities[0].text, 'TREE');
});
test('BRM: 번호로 지정한 내부 객체를 batch update로 지운다', async () => {
 const block = { id: 'b1', type: 'block', name: 'DESK', layer: 'l1', entities: [{ type: 'line', layer: 'l1' }, { type: 'line', layer: 'l1' }], __sel: true };
 const ctx = fakeCtx();
 ctx.entities().push(block);
 const cmds = installBlockEditTools(ctx);
 await cmds.BRM();
 fakeCtx.lastForm.onApply({ indexes: '1', scope: 'one' });
 const batch = ctx.executed.find(c => c.type === 'batch');
 assert.equal(batch.commands[0].changes.entities.length, 1);
});
test('BRN: 간편모드로 이름을 바꾼다', async () => {
 const block = { id: 'b1', type: 'block', name: 'OLD', layer: 'l1', entities: [], __sel: true };
 const ctx = fakeCtx();
 ctx.entities().push(block);
 const cmds = installBlockEditTools(ctx);
 await cmds.BRN();
 fakeCtx.lastForm.onApply({ mode: 'simple', name: 'NEW', scope: 'one' });
 const batch = ctx.executed.find(c => c.type === 'batch');
 assert.equal(batch.commands[0].changes.name, 'NEW');
});
test('EAR: 블록을 explode 실행으로 폭파한다', async () => {
 const block = { id: 'b1', type: 'block', name: 'ATTR', layer: 'l1', entities: [], __sel: true };
 const ctx = fakeCtx();
 ctx.entities().push(block);
 const cmds = installBlockEditTools(ctx);
 await cmds.EAR();
 assert.equal(ctx.executed[0].type, 'explode');
 assert.deepEqual(ctx.executed[0].ids, ['b1']);
});
test('M2B: 압축 공유 블록만 shared.materialize, 없으면 정직한 토스트', () => {
 const shared = { id: 's1', type: 'block', sharedBlock: 'k1', entities: [], __sel: true };
 const normal = { id: 'n1', type: 'block', name: 'X', entities: [], __sel: true };
 const ctx = fakeCtx();
 ctx.entities().push(shared);
 const cmds = installBlockEditTools(ctx);
 cmds.M2B();
 assert.equal(ctx.executed[0].type, 'shared.materialize');
 assert.deepEqual(ctx.executed[0].ids, ['s1']);

 const ctx2 = fakeCtx();
 ctx2.entities().push(normal);
 const cmds2 = installBlockEditTools(ctx2);
 cmds2.M2B();
 assert.equal(ctx2.executed.length, 0);
 assert.match(ctx2.toasts.at(-1).msg, /이미 독립된 일반 블록/);
});
test('XCX: 클립된 블록을 delete+addMany 배치로 정리한다', async () => {
 const block = {
  id: 'b1', type: 'block', name: 'REF', layer: 'l1',
  clip: { points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }], enabled: true, inverted: false },
  entities: [{ id: 'c1', type: 'line', layer: 'l1', points: [{ x: 2, y: 2 }, { x: 8, y: 8 }] }],
  __sel: true,
 };
 const ctx = fakeCtx();
 ctx.entities().push(block);
 const cmds = installBlockEditTools(ctx);
 await cmds.XCX();
 fakeCtx.lastForm.onApply({ mode: 'window' });
 const batch = ctx.executed.find(c => c.type === 'batch');
 const kinds = batch.commands.map(c => c.type).sort();
 assert.deepEqual(kinds, ['addMany', 'delete']);
});
test('CV: 켜가 있는 객체는 setActiveLayer, 해치는 켜를 바꾸지 않는다', async () => {
 const text = { type: 'text', layer: 'l1', text: 'hi' };
 const ctx = fakeCtx({ pickEntity: async () => text });
 const cmds = installBlockEditTools(ctx);
 await cmds.CV();
 assert.equal(ctx.getActiveLayer(), 'l1');
 assert.match(ctx.toasts.at(-1).msg, /현재 켜를/);

 const hatch = { type: 'hatch', layer: 'l1' };
 const ctx2 = fakeCtx({ pickEntity: async () => hatch });
 const cmds2 = installBlockEditTools(ctx2);
 await cmds2.CV();
 assert.equal(ctx2.getActiveLayer(), null);
 assert.match(ctx2.toasts.at(-1).msg, /켜가 반영 대상이 아니라/);
});
test('STT: 없는 표준 켜만 만들고, 이미 있으면 정직한 토스트만 낸다', async () => {
 // 2026-09-24: STT 가 대화상자(축척·켜·도곽)를 먼저 묻는다. 켜 생성만 켜고 축척 반영은 끈 채 적용한다.
 const apply = () => { const f = fakeCtx.lastForm; const values = Object.fromEntries(f.fields.map(x => [x.name, x.value])); return f.onApply({ ...values, lineScale: '', dimScale: '', layers: 'on', sheet: 'none' }); };
 const ctx = fakeCtx();
 ctx.refresh = () => {};
 const cmds = installBlockEditTools(ctx);
 const p = cmds.STT(); await apply(); await p;
 const adds = ctx.executed.filter(c => c.type === 'batch').flatMap(c => c.commands).filter(c => c.type === 'layer.add');
 assert.equal(adds.length, 5);

 const ctx2 = fakeCtx({ layers: () => standardLayerPreset().map((p, i) => ({ id: 'x' + i, name: p.name, color: p.color, visible: true, frozen: false })) });
 ctx2.refresh = () => {};
 const cmds2 = installBlockEditTools(ctx2);
 const p2 = cmds2.STT(); await apply(); await p2;
 assert.equal(ctx2.executed.length, 0);
 assert.match(ctx2.toasts.at(-1).msg, /이미 모두 있음/);
});
