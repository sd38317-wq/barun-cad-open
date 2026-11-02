// ACAD200 영역 7 — 레이어 항목(701~708) 시험. 로직이 깨지면 실패하도록 작게.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {DrawingEngine, layerDeletePlan, countLayerDelete} from './engine.js';
import * as G from './geometry.js';
import {layerUsageCounts, filterLayers, layerMatchesRule, namePatternTest, upsertLayerFilter, removeLayerFilter, layerFilterList} from './layer-filters.js';
import {saveLayerState, layerStateCommands, normalizeLayerState, isolateLayerCommands, unisolateLayerCommands, ISO_STATE_NAME, deleteLayerState, listLayerStates} from './layer-states.js';
import {checkBeforeAction, reconcileCommands, notifyMaskFromFlags, flagsFromNotifyMask, NOTIFY} from './layer-reconcile.js';
import {layersForViewport, setViewportOverride, clearViewportOverrides, overridesFromViewportStyles, validateOverride} from './viewport-layers.js';
import {LAYER_MANAGER_COLUMNS, layerUpdateBatch, visibleManagerLayers, clampTransparency} from './layer-manager.js';

const L = (id, name, extra = {}) => ({id, name, color: '#ffffff', visible: true, locked: false, lineweight: .25, linetype: 'CONTINUOUS', ...extra});
const line = (layer, x = 0) => ({type: 'line', layer, points: [{x, y: 0}, {x: x + 10, y: 0}]});
function engineWith(layers, entities = [], blocks = []) {
  const e = new DrawingEngine();
  e.execute({type: 'load', document: {version: 2, units: 'mm', linetypeScale: 1, layers, blocks, entities: entities.map((x, i) => ({id: 'e' + i, ...x}))}});
  return e;
}

/* 701 */
test('701 객체 수는 블록 참조 안·블록 정의 안까지 센다', () => {
  const doc = {layers: [L('a', 'A'), L('b', 'B')], entities: [line('a'), {type: 'block', name: 'K', layer: 'a', entities: [line('b'), line('b')]}], blocks: [{name: 'X', entities: [line('b')]}]};
  const m = layerUsageCounts(doc);
  assert.equal(m.get('a'), 2);
  assert.equal(m.get('b'), 3);
});
test('701 관리자 열 12개(투명도·설명 포함) · 투명도 0~90 · 여러 줄 한 batch', () => {
  assert.deepEqual(LAYER_MANAGER_COLUMNS, ['현재', '이름', '켜기', '동결', '잠금', '색', '선종류', '굵기', '투명도', '인쇄', '설명', '객체']);
  assert.equal(clampTransparency(120), 90); assert.equal(clampTransparency(-3), 0); assert.equal(clampTransparency('33'), 33);
  const doc = {layers: [L('a', 'A'), L('b', 'B')]};
  const cmd = layerUpdateBatch(doc, new Set(['a', 'b', 'zz']), {transparency: 95}, 'x');
  assert.equal(cmd.type, 'batch'); assert.equal(cmd.commands.length, 2); assert.equal(cmd.commands[0].changes.transparency, 90);
  assert.throws(() => layerUpdateBatch(doc, new Set(['a']), {frozen: true}, 'a'), /현재 레이어는 동결/);
});
test('701 엔진: 레이어 투명도·설명 저장, 범위 밖 거절', () => {
  const e = engineWith([L('a', '0'), L('b', 'B')]);
  e.execute({type: 'layer.update', id: 'b', changes: {transparency: 40, description: '벽체'}});
  assert.equal(e.doc.layers[1].transparency, 40); assert.equal(e.doc.layers[1].description, '벽체');
  assert.throws(() => e.execute({type: 'layer.update', id: 'b', changes: {transparency: 95}}), /레이어 정보/);
  assert.equal(e.doc.layers[1].transparency, 40);
});
test('701 관리자 검색은 이름과 설명을 함께 찾는다', () => {
  const doc = {layers: [L('a', 'A-WALL', {description: '콘크리트 벽'}), L('b', 'A-DOOR')]};
  assert.deepEqual(visibleManagerLayers(doc, {search: '콘크리트'}).map((l) => l.id), ['a']);
});

/* 702 */
test('702 이름 패턴: 와일드카드·쉼표·~ 제외', () => {
  const t = namePatternTest('A-*,~*TEMP*');
  assert.equal(t('A-WALL'), true); assert.equal(t('A-TEMP-1'), false); assert.equal(t('S-COL'), false);
  assert.equal(namePatternTest('')('아무거나'), true);
});
test('702 속성 필터·그룹 필터·자동 필터', () => {
  const doc = {layers: [L('a', 'A-WALL', {color: '#FF0000'}), L('b', 'A-DOOR', {locked: true}), L('c', 'X|BASE'), L('d', 'NEW', {reconciled: false})], layerFilters: []};
  assert.equal(layerMatchesRule(doc.layers[0], {name: 'A-*', color: '#ff0000'}), true);
  assert.equal(layerMatchesRule(doc.layers[1], {name: 'A-*', color: '#ff0000'}), false);
  doc.layerFilters = upsertLayerFilter(doc, {name: '건축', kind: 'property', rule: {name: 'A-*'}});
  doc.layerFilters = upsertLayerFilter(doc, {name: '고른 것', kind: 'group', ids: ['c', 'gone']});
  const [prop, group] = doc.layerFilters;
  assert.deepEqual(filterLayers(doc, prop.id).map((l) => l.id), ['a', 'b']);
  assert.deepEqual(filterLayers(doc, group.id).map((l) => l.id), ['c']);
  assert.deepEqual(filterLayers(doc, 'xref').map((l) => l.id), ['c']);
  assert.deepEqual(filterLayers(doc, 'unreconciled').map((l) => l.id), ['d']);
  assert.deepEqual(filterLayers(doc, 'locked').map((l) => l.id), ['b']);
  const counts = new Map([['a', 3]]);
  assert.deepEqual(filterLayers(doc, 'used', {counts}).map((l) => l.id), ['a']);
  assert.deepEqual(filterLayers(doc, 'unused', {counts}).map((l) => l.id), ['b', 'c', 'd']);
  assert.throws(() => removeLayerFilter(doc, 'all'), /자동 필터/);
  assert.equal(removeLayerFilter(doc, prop.id).length, 1);
  assert.ok(layerFilterList(doc, {counts}).find((f) => f.id === 'used').count === 1);
  // 같은 이름은 바꾼다(늘어나지 않음)
  assert.equal(upsertLayerFilter(doc, {name: '건축', kind: 'property', rule: {name: 'B*'}}).length, 2);
});
test('702 엔진: 필터 저장은 document.update 로 도면에 남는다', () => {
  const e = engineWith([L('a', '0')]);
  e.execute({type: 'document.update', changes: {layerFilters: [{id: 'f1', name: 'x', kind: 'group', ids: ['a']}]}});
  assert.equal(e.doc.layerFilters[0].name, 'x');
  assert.throws(() => e.execute({type: 'document.update', changes: {layerFilters: 'bad'}}), /목록 형식/);
});

/* 703 */
test('703 상태 저장은 마스크 키만, 복원은 바뀐 레이어·고른 키만', () => {
  const doc = {layers: [L('a', 'A', {color: '#111111'}), L('b', 'B')]};
  const states = saveLayerState(doc, '평면', {mask: ['visible', 'color'], description: '설명', savedAt: 1});
  assert.deepEqual(states['평면'].mask, ['visible', 'color']);
  assert.deepEqual(Object.keys(states['평면'].layers[0]).sort(), ['color', 'id', 'name', 'visible']);
  const changed = {layers: [L('a', 'A', {color: '#222222', visible: false}), L('b', 'B')]};
  const all = layerStateCommands(changed, states['평면']);
  assert.deepEqual(all, [{type: 'layer.update', id: 'a', changes: {visible: true, color: '#111111'}}]);
  assert.deepEqual(layerStateCommands(changed, states['평면'], {onlyKeys: ['visible']}), [{type: 'layer.update', id: 'a', changes: {visible: true}}]);
  assert.throws(() => saveLayerState(doc, ' '), /이름/);
});
test('703 예전 형식(레이어 표 배열)과 이름으로 맞추기', () => {
  const legacy = [{id: 'old-a', name: 'A', visible: false, locked: false, frozen: false, color: '#ffffff', lineweight: .25, linetype: 'CONTINUOUS'}];
  assert.equal(normalizeLayerState(legacy).legacy, true);
  const doc = {layers: [L('new-a', 'A')]};
  assert.deepEqual(layerStateCommands(doc, legacy), [{type: 'layer.update', id: 'new-a', changes: {visible: false}}]);
  assert.equal(listLayerStates({layerStates: {'*LAYISO': {layers: [], mask: ['visible']}, 'x': legacy}})[1].hidden, true);
  assert.deepEqual(Object.keys(deleteLayerState({layerStates: {x: legacy, y: legacy}}, 'x')), ['y']);
});
test('703 현재 레이어는 상태 복원으로 동결하지 않는다', () => {
  const state = {mask: ['frozen'], layers: [{id: 'a', name: 'A', frozen: true}]};
  assert.deepEqual(layerStateCommands({layers: [L('a', 'A')]}, state, {currentLayer: 'a'}), []);
});

/* 704 */
test('704 LAYISO 끄기/잠금, 상태는 도면(*LAYISO)에, LAYUNISO 로 원래대로 · 되돌리기 한 번', () => {
  const e = engineWith([L('z', '0'), L('a', 'A'), L('b', 'B', {locked: true}), L('c', 'C', {visible: false})], [line('a')]);
  const lock = isolateLayerCommands(e.doc, new Set(['a']), {mode: 'lock'});
  e.execute({type: 'batch', commands: lock.commands});
  assert.ok(e.lastExecution.layerOnly, '레이어만 바뀌는 batch 는 도면 전체를 다시 만들지 않는다');
  assert.ok(e.doc.layerStates[ISO_STATE_NAME]);
  assert.deepEqual(e.doc.layers.map((l) => !!l.locked), [true, false, true, true]);
  assert.equal(e.doc.layers.find((l) => l.id === 'c').visible, false, '잠금 방식은 켜기/끄기를 건드리지 않는다');
  e.execute({type: 'batch', commands: unisolateLayerCommands(e.doc)});
  assert.deepEqual(e.doc.layers.map((l) => !!l.locked), [false, false, true, false]);
  assert.equal(e.doc.layerStates[ISO_STATE_NAME], undefined);
  e.execute({type: 'undo'});
  assert.ok(e.doc.layerStates[ISO_STATE_NAME], '되돌리기 한 번에 분리 상태로');
  const off = isolateLayerCommands({layers: [L('a', 'A'), L('b', 'B')]}, ['a'], {mode: 'off'});
  assert.deepEqual(off.commands.filter((c) => c.type === 'layer.update'), [{type: 'layer.update', id: 'b', changes: {visible: false}}]);
  assert.throws(() => isolateLayerCommands({layers: []}, [], {}), /객체를 먼저/);
  assert.throws(() => unisolateLayerCommands({layers: [], layerStates: {}}), /분리한 상태가 없습니다/);
});
test('704 이미 분리 중이면 처음 상태를 지킨다', () => {
  const doc = {layers: [L('a', 'A'), L('b', 'B', {visible: false})], layerStates: {[ISO_STATE_NAME]: {mask: ['visible'], layers: [{id: 'b', name: 'B', visible: true}]}}};
  const r = isolateLayerCommands(doc, ['a'], {mode: 'off'});
  assert.equal(r.commands.some((c) => c.type === 'document.update'), false);
});

/* 705 */
test('705 잠긴 레이어는 화면에서 배경 쪽으로 흐리게(기본 50%), 출력은 그대로, 0 이면 끔', () => {
  G.setLockFadeBackground('#000000');
  const doc = {layers: [L('a', 'A', {color: '#ff0000', locked: true}), L('b', 'B', {color: '#00ff00'})], entities: [{id: 1, ...line('a')}, {id: 2, ...line('b')}], linetypeScale: 1};
  const [faded, normal] = G.visibleEntities(doc);
  assert.equal(faded.color, '#800000'); assert.equal(normal.color, '#00ff00');
  assert.equal(G.visibleEntities(doc, {plot: true})[0].color, '#ff0000', '출력은 섞지 않는다');
  assert.equal(G.visibleEntities({...doc, lockFade: 0})[0].color, '#ff0000');
  assert.equal(G.visibleEntities({...doc, lockFade: 90})[0].color, '#1a0000');
  assert.equal(G.fadeColor('#ffffff', 50, '#000000'), '#808080');
  assert.equal(G.fadeColor('nope', 50), 'nope');
  G.setLockFadeBackground('#101820');
});
test('705 잠금만 바꾸면 그 레이어 객체만 다시 그린다(LAYER_DISPLAY_KEYS 에 locked)', () => {
  const before = [L('a', 'A'), L('b', 'B')], after = [L('a', 'A', {locked: true}), before[1]];
  assert.deepEqual([...G.changedDisplayLayers(before, after)], ['a']);
});
test('705 LAYLOCKFADECTL 은 0~90 정수만', () => {
  const e = engineWith([L('a', '0')]);
  e.execute({type: 'document.update', changes: {lockFade: 30}});
  assert.equal(e.doc.lockFade, 30);
  assert.throws(() => e.execute({type: 'document.update', changes: {lockFade: 95}}), /0~90/);
});

/* 706 */
test('706 LAYDEL: 레이어와 객체(블록 안·정의 안)를 한 번에 지우고 되돌리기 한 번', () => {
  const block = {type: 'block', name: 'B1', layer: 'a', entities: [line('b'), line('a')]};
  const e = engineWith([L('z', '0'), L('a', 'A'), L('b', 'B')], [line('a'), line('b'), block], [{name: 'D', entities: [line('b'), line('a')]}]);
  assert.deepEqual(countLayerDelete(e.doc, new Set(['b'])), {top: 1, nested: 2, blocks: 1});
  const undoDepth = e.undoStack.length;
  e.execute({type: 'layer.deleteWithEntities', ids: ['b']});
  assert.equal(e.doc.layers.some((l) => l.id === 'b'), false);
  assert.equal(e.doc.entities.length, 2);
  assert.equal(e.doc.entities[1].entities.length, 1, '블록 참조 안 B 객체도 지움');
  assert.equal(e.doc.blocks[0].entities.length, 1);
  assert.equal(e.undoStack.length, undoDepth + 1);
  e.execute({type: 'undo'});
  assert.equal(e.doc.entities.length, 3); assert.ok(e.doc.layers.some((l) => l.id === 'b'));
});
test('706 LAYDEL 거절: 0번·잠긴·마지막 레이어', () => {
  const e = engineWith([L('z', '0'), L('a', 'A', {locked: true}), L('b', 'B')]);
  assert.throws(() => e.execute({type: 'layer.deleteWithEntities', ids: ['z']}), /0번/);
  assert.throws(() => e.execute({type: 'layer.deleteWithEntities', ids: ['a']}), /잠긴/);
  assert.throws(() => e.execute({type: 'layer.deleteWithEntities', ids: ['nope']}), /지울 레이어가 없습니다/);
  const plan = layerDeletePlan({entities: [line('b'), {type: 'block', name: 'E', layer: 'z', entities: [line('b')]}], blocks: []}, new Set(['b']));
  assert.equal(plan.removed, 2, '속이 모두 지워진 블록 참조도 지운다'); assert.equal(plan.blocks, null);
});

/* 707 */
test('707 LAYEREVAL: 붙여넣기로 생긴 새 레이어만 확인 전 표시(사용자가 만든·표준 레이어 제외)', () => {
  const e = engineWith([L('z', '0')]);
  e.execute({type: 'document.update', changes: {layerEval: true}});
  e.execute({type: 'layer.add', name: '내가 만든'});
  assert.equal(e.doc.layers.at(-1).reconciled, undefined);
  e.execute({type: 'batch', commands: [{type: 'layer.add', id: 'p1', name: 'PASTED'}, {type: 'addMany', entities: [line('p1')]}]});
  assert.equal(e.doc.layers.find((l) => l.id === 'p1').reconciled, false);
  e.execute({type: 'document.update', changes: {layerNotify: notifyMaskFromFlags({save: true})}});
  const n = checkBeforeAction(e.doc, 'save');
  assert.equal(n.count, 1); assert.deepEqual(n.names, ['PASTED']);
  assert.equal(checkBeforeAction(e.doc, 'plot'), null, '출력 비트는 꺼져 있다');
  e.execute({type: 'batch', commands: reconcileCommands(e.doc)});
  assert.equal(checkBeforeAction(e.doc, 'save'), null);
  e.execute({type: 'undo'});
  assert.equal(checkBeforeAction(e.doc, 'save').count, 1);
});
test('707 LAYERNOTIFY 비트와 끈 상태', () => {
  assert.equal(notifyMaskFromFlags({plot: true, save: true, insert: true}), 1 + 16 + 32);
  assert.deepEqual(flagsFromNotifyMask(17), {plot: true, open: false, xref: false, restore: false, save: true, insert: false});
  assert.equal(NOTIFY.open, 2);
  const e = engineWith([L('z', '0')]);
  e.execute({type: 'batch', commands: [{type: 'layer.add', id: 'p', name: 'P'}]});
  assert.equal(e.doc.layers.at(-1).reconciled, undefined, 'LAYEREVAL 이 꺼져 있으면 표시하지 않는다(AutoCAD 기본과 같음)');
  assert.throws(() => e.execute({type: 'document.update', changes: {layerNotify: 99}}), /0~63/);
});

/* 708 */
test('708 뷰포트용 레이어 표: 재지정 없는 레이어는 같은 객체, VP 동결·색 재지정', () => {
  const doc = {layers: [L('a', 'A'), L('b', 'B')]};
  let vp = {layerOverrides: {}};
  assert.equal(layersForViewport(doc, vp), doc.layers);
  vp = {layerOverrides: setViewportOverride(vp, 'a', 'frozen', true)};
  vp = {layerOverrides: setViewportOverride(vp, 'b', 'color', '#123456')};
  const ls = layersForViewport(doc, vp);
  assert.equal(ls[0].frozen, true); assert.equal(ls[1].color, '#123456'); assert.equal(doc.layers[1].color, '#ffffff');
  assert.deepEqual(clearViewportOverrides(vp, {layerId: 'a'}), {b: {color: '#123456'}});
  assert.deepEqual(clearViewportOverrides(vp, {key: 'color'}), {a: {frozen: true}});
  assert.deepEqual(setViewportOverride(vp, 'a', 'frozen', false), {b: {color: '#123456'}});
  assert.throws(() => validateOverride('color', 'red'), /#RRGGBB/);
  assert.deepEqual(overridesFromViewportStyles(doc, {A: {color: '#abcdef', bogus: 1}, NOPE: {color: '#000000'}}), {a: {color: '#abcdef'}});
});

/* 성능: 레이어만 바꾸는 batch 는 도면 전체를 복사·검사하지 않는다 */
test('레이어 batch 는 가벼운 경로(객체 배열 공유, 도면 전체 검사 없음)', () => {
  const entities = Array.from({length: 2000}, (_, i) => line(i % 2 ? 'a' : 'b', i));
  const e = engineWith([L('z', '0'), L('a', 'A'), L('b', 'B')], entities);
  const before = e.doc.entities[0];
  e.execute({type: 'batch', commands: [{type: 'layer.update', id: 'a', changes: {visible: false}}, {type: 'layer.update', id: 'b', changes: {color: '#123456'}}]});
  assert.equal(e.lastExecution.layerOnly, true);
  assert.equal(e.doc.entities[0], before, '객체는 복사하지 않는다');
  e.execute({type: 'batch', commands: [{type: 'layer.update', id: 'a', changes: {visible: true}}, {type: 'delete', ids: [e.doc.entities[0].id]}]});
  assert.equal(e.lastExecution.layerOnly, false, '객체를 바꾸는 명령이 섞이면 예전 경로');
});
test('레이어 관리자 표 머리는 layer-manager.js 가 만든다(app.js 는 연결만)', () => {
  const src = fs.readFileSync('app.js', 'utf8');
  assert.match(src, /function openLayerManager\(\)\{\r?\n[^\n]*\r?\n layerManagerDialog=openLayerManagerDialog\(/);
});
