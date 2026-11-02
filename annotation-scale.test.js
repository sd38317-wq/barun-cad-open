import test from 'node:test';
import assert from 'node:assert/strict';
import {DrawingEngine} from './engine.js';
import {annotationScaleCommands, entitiesInBounds, annotationAnchor, installAnnotationScale, isAnnotationBlock, resolveAnnotative, annotativeChanges, makeAnnotative, isMultiScale, currentScaleUpdates, multiScaleEntities} from './annotation-scale.js';

const leader = (x, y) => ({id: 'L1', type: 'block', name: '지시선', layer: 'default', entities: [
 {id: 'l1', type: 'line', layer: 'default', points: [{x, y}, {x: x + 500, y: y + 500}]},
 {id: 't1', type: 'text', layer: 'default', position: {x: x + 520, y: y + 500}, text: '마감', height: 250},
]});

function setup() {
 const engine = new DrawingEngine();
 engine.execute({type: 'batch', commands: [
  {type: 'add', entity: {id: 'T', type: 'text', layer: 'default', position: {x: 100, y: 100}, text: '거실', height: 250}},
  {type: 'add', entity: {id: 'D', type: 'dimension', layer: 'default', points: [{x: 0, y: 0}, {x: 1000, y: 0}, {x: 500, y: 300}], textHeight: 250, arrowSize: 100}},
  {type: 'add', entity: leader(2000, 2000)},
  {type: 'add', entity: {id: 'W', type: 'line', layer: 'default', points: [{x: 0, y: 0}, {x: 3000, y: 0}]}},
  {type: 'add', entity: {id: 'FAR', type: 'text', layer: 'default', position: {x: 90000, y: 90000}, text: '밖', height: 250}},
 ]});
 engine.execute({type: 'document.update', changes: {sheets: [{id: 'S1', number: 'A-001', title: '평면', paper: 'A3', denominator: 50, bounds: {minX: -1000, minY: -1000, maxX: 10000, maxY: 10000}}]}});
 return engine;
}

test('주석 축척: 문자·치수·지시선 블록 크기를 비율로, 선 객체는 그대로', () => {
 const engine = setup();
 const {commands, counts} = annotationScaleCommands(entitiesInBounds(engine.doc.entities, engine.doc.sheets[0].bounds), 0.5);
 assert.deepEqual(counts, {text: 1, dimension: 1, symbol: 1, hatch: 0});
 engine.execute({type: 'batch', commands});
 const by = (id) => engine.doc.entities.find(e => e.id === id);
 assert.equal(by('T').height, 125);
 assert.deepEqual(by('T').position, {x: 100, y: 100});
 assert.equal(by('D').textHeight, 125);
 assert.equal(by('D').arrowSize, 50);
 assert.deepEqual(by('D').points[0], {x: 0, y: 0});
 const leaderText = by('L1').entities.find(e => e.type === 'text');
 assert.equal(leaderText.height, 125);
 assert.deepEqual(by('L1').entities[0].points[0], {x: 2000, y: 2000}, '화살표 끝은 제자리');
 assert.deepEqual(by('W').points[1], {x: 3000, y: 0});
 assert.equal(by('FAR').height, 250, '도곽 밖은 그대로');
 engine.execute({type: 'undo'});
 assert.equal(engine.doc.entities.find(e => e.id === 'T').height, 250);
});

test('주석 축척: 같은 축척이면 명령 없음, 잘못된 비율은 거부', () => {
 assert.equal(annotationScaleCommands([{id: 'a', type: 'text', height: 1}], 1).commands.length, 0);
 assert.throws(() => annotationScaleCommands([], 0));
 assert.throws(() => annotationScaleCommands([], NaN));
 assert.deepEqual(annotationAnchor({type: 'block', position: {x: 5, y: 6}, entities: []}), {x: 5, y: 6});
});

function ctxFor(engine, selectedIds = []) {
 const toasts = [];let pending = null;
 return {
  toasts, apply: (values) => pending(values),
  ctx: {doc: () => engine.doc, entities: () => engine.doc.entities, layers: () => engine.doc.layers, selected: () => engine.doc.entities.filter(e => selectedIds.includes(e.id)),
   execute: (c) => engine.execute(c), toast: (m) => toasts.push(m), getSettings: () => ({denominator: 100}),
   form: (title, fields, onApply) => { pending = (values) => onApply({...Object.fromEntries(fields.map(f => [f.name, f.value])), ...values}); return fields; }},
 };
}

test('ANNOSCALE: 도곽 축척으로 맞추고 기억해 다시 적용해도 두 번 줄지 않음', () => {
 const engine = setup();
 const h = ctxFor(engine);
 const cmds = installAnnotationScale(h.ctx);
 cmds.ANNOSCALE();
 h.apply({});
 assert.equal(engine.doc.entities.find(e => e.id === 'T').height, 125);
 assert.equal(engine.doc.sheets[0].annotationScale, 50);
 cmds.ANNOSCALE();
 h.apply({});
 assert.equal(engine.doc.entities.find(e => e.id === 'T').height, 125, '같은 축척 재적용은 변화 없음');
 assert.match(h.toasts.at(-1), /바꿀 주석이 없습니다/);
});

test('ANNOSCALE: 잠긴 레이어는 건드리지 않음', () => {
 const engine = setup();
 engine.execute({type: 'layer.add', name: '잠금'});
 const lock = engine.doc.layers.find(l => l.name === '잠금');
 engine.execute({type: 'add', entity: {id: 'LT', type: 'text', layer: lock.id, position: {x: 10, y: 10}, text: '잠김', height: 250}});
 engine.execute({type: 'layer.update', id: lock.id, changes: {locked: true}});
 const h = ctxFor(engine);
 installAnnotationScale(h.ctx).ANNOSCALE();
 h.apply({});
 assert.equal(engine.doc.entities.find(e => e.id === 'LT').height, 250);
});

test('SCALETEXT: 용지 높이 × 축척 / 배수', () => {
 const engine = setup();
 const h = ctxFor(engine, ['T', 'FAR']);
 const cmds = installAnnotationScale(h.ctx);
 cmds.SCALETEXT();
 h.apply({mode: 'paper', paper: 3, scale: 50});
 assert.equal(engine.doc.entities.find(e => e.id === 'T').height, 150);
 assert.equal(engine.doc.entities.find(e => e.id === 'FAR').height, 150);
 cmds.SCALETEXT();
 h.apply({mode: 'factor', factor: 2});
 assert.equal(engine.doc.entities.find(e => e.id === 'T').height, 300);
 assert.throws(() => { cmds.SCALETEXT(); h.apply({mode: 'model', model: -1}); });
});

test('ANNOSCALE: 도곽 틀·기둥처럼 문자가 든 실제 크기 블록은 키우지 않음 (검토 1)', () => {
 const engine = setup();
 engine.execute({type: 'batch', commands: [
  {type: 'add', entity: {id: 'FRAME', type: 'block', name: 'A3 도곽', layer: 'default', entities: [
   {type: 'rectangle', layer: 'default', points: [{x: 0, y: 0}, {x: 8000, y: 0}, {x: 8000, y: 5000}, {x: 0, y: 5000}]},
   {type: 'text', layer: 'default', position: {x: 7000, y: 200}, text: '도면명', height: 250}]}},
  {type: 'add', entity: {id: 'COLB', type: 'block', name: '기둥', layer: 'default', parameters: {kind: 'COLUMN', width: 600}, entities: [
   {type: 'rectangle', layer: 'default', points: [{x: 3000, y: 3000}, {x: 3600, y: 3000}, {x: 3600, y: 3600}, {x: 3000, y: 3600}]},
   {type: 'text', layer: 'default', position: {x: 3100, y: 3100}, text: 'C1', height: 250}]}},
 ]});
 const h = ctxFor(engine);
 installAnnotationScale(h.ctx).ANNOSCALE();
 h.apply({});
 const by = (id) => engine.doc.entities.find(e => e.id === id);
 assert.equal(by('FRAME').entities[0].points[1].x, 8000);
 assert.equal(by('COLB').entities[0].points[1].x, 3600);
 assert.equal(by('L1').entities.find(e => e.type === 'text').height, 125, '지시선은 주석');
 assert.equal(isAnnotationBlock({type: 'block', name: '지시선', sharedBlock: 'x'}), false);
 assert.equal(isAnnotationBlock({type: 'block', libraryCommand: 'WST'}), true);
});

test('ANNOSCALE: 도곽마다 자기 축척 기본값, 선택 후 도곽 재적용에도 두 번 줄지 않음 (검토 2·3)', () => {
 const engine = setup();
 engine.execute({type: 'batch', commands: [
  {type: 'add', entity: {id: 'T2', type: 'text', layer: 'default', position: {x: 50100, y: 100}, text: '2층', height: 250}},
  {type: 'document.update', changes: {sheets: [...engine.doc.sheets.map(s => ({...s, annotationScale: 50})), {id: 'S2', number: 'A-002', paper: 'A3', denominator: 50, bounds: {minX: 49000, minY: -1000, maxX: 60000, maxY: 10000}}]}},
 ]});
 const h = ctxFor(engine);
 const cmds = installAnnotationScale(h.ctx);
 cmds.ANNOSCALE();
 h.apply({scope: 'S2'});
 assert.equal(engine.doc.entities.find(e => e.id === 'T2').height, 125, '도곽 2 는 1:100(기본) → 1:50');
 assert.equal(engine.doc.sheets.find(s => s.id === 'S2').annotationScale, 50);
 // 선택으로 먼저 맞춘 뒤 도곽 전체를 다시 맞춰도 그 객체는 다시 줄지 않는다.
 const h2 = ctxFor(engine, ['T']);
 const cmds2 = installAnnotationScale(h2.ctx);
 cmds2.ANNOSCALE();
 h2.apply({scope: '__selection__', from: 100, to: 50});
 assert.equal(engine.doc.entities.find(e => e.id === 'T').height, 125);
 const h3 = ctxFor(engine);
 installAnnotationScale(h3.ctx).ANNOSCALE();
 h3.apply({scope: 'S1', from: 100});
 assert.equal(engine.doc.entities.find(e => e.id === 'T').height, 125, '이미 1:50 에 맞춘 문자는 그대로');
 assert.equal(engine.doc.entities.find(e => e.id === 'D').textHeight, 125, '아직 안 맞춘 치수만 맞춤');
});

test('ANNOSCALE: 동결 레이어·다른 도곽 소속(sheetId) 객체는 건드리지 않음', () => {
 const engine = setup();
 engine.execute({type: 'layer.add', name: '동결'});
 const frozen = engine.doc.layers.find(l => l.name === '동결');
 engine.execute({type: 'batch', commands: [
  {type: 'add', entity: {id: 'FZ', type: 'text', layer: frozen.id, position: {x: 10, y: 10}, text: 'f', height: 250}},
  {type: 'add', entity: {id: 'OTHER', type: 'text', layer: 'default', sheetId: 'ELSE', position: {x: 20, y: 20}, text: 'o', height: 250}},
  {type: 'layer.update', id: frozen.id, changes: {frozen: true}},
 ]});
 const h = ctxFor(engine);
 installAnnotationScale(h.ctx).ANNOSCALE();
 h.apply({});
 assert.equal(engine.doc.entities.find(e => e.id === 'FZ').height, 250);
 assert.equal(engine.doc.entities.find(e => e.id === 'OTHER').height, 250);
});

test('비율 모드(도곽 복사 보정): 기억한 주석 축척도 같은 비율로 옮김', () => {
 const {commands} = annotationScaleCommands([{id: 'a', type: 'text', height: 250, annoScale: 100}, {id: 'b', type: 'text', height: 250}], 0.5);
 assert.deepEqual(commands[0].updates.map(u => u.changes), [{height: 125, annoScale: 50}, {height: 125}]);
});

// ── 510 한 객체에 여러 축척 표현 ──────────────────────────────────────────────

const byId = (engine, id) => engine.doc.entities.find(e => e.id === id);
function multiHarness(engine, selectedIds = []) {
 const toasts = [];let pending = null;
 const ctx = {doc: () => engine.doc, entities: () => engine.doc.entities, layers: () => engine.doc.layers, selected: () => engine.doc.entities.filter(e => selectedIds.includes(e.id)),
  execute: (c) => engine.execute(c), toast: (m) => toasts.push(m), getSettings: () => ({denominator: 100}),
  form: (title, fields, onApply) => { pending = (values) => onApply({...Object.fromEntries(fields.map(f => [f.name, f.value])), ...values});return fields; }};
 return {toasts, cmds: installAnnotationScale(ctx), apply: (v) => pending(v)};
}

test('510 resolveAnnotative: 표현이 있으면 높이 = 용지 높이 × 분모, 위치는 표현별 offset', () => {
 const t = {id: 't', type: 'text', layer: 'default', position: {x: 0, y: 0}, text: 'A', height: 250, annotative: true, paperHeight: 2.5, annoScale: 100, scales: {'1:100': {}, '1:50': {offset: {x: 10, y: -5}}}};
 const at50 = resolveAnnotative(t, 50);
 assert.equal(at50.height, 125);assert.deepEqual(at50.position, {x: 10, y: -5});assert.equal(at50.annoScale, 50);
 const back = resolveAnnotative(at50, 100);
 assert.equal(back.height, 250);assert.deepEqual(back.position, {x: 0, y: 0}, '돌아오면 제자리');
 const missing = resolveAnnotative(t, 200);
 assert.equal(missing._annoMissing, true);assert.equal(missing.height, 250, '표현이 없으면 마지막 크기로 보임(ANNOALLVISIBLE=1)');
 assert.equal(resolveAnnotative(t, 200, {allVisible: false}), null, 'ANNOALLVISIBLE=0 이면 숨김');
 const plain = {id: 'p', type: 'text', height: 250};
 assert.equal(resolveAnnotative(plain, 50), plain, '주석이 아니면 같은 객체 그대로');
 assert.equal(isMultiScale({type: 'block', annotative: true}), false, '예전 주석 블록(그리드·제목)은 여러 축척 주석이 아님');
});

test('510 치수·지시선 블록도 표현대로: 치수 크기 값, 블록은 기준점 기준 축척', () => {
 const d = {id: 'd', type: 'dimension', layer: 'default', points: [{x: 0, y: 0}, {x: 1000, y: 0}, {x: 500, y: 300}], textHeight: 250, arrowSize: 100, ...makeAnnotative({type: 'dimension', textHeight: 250, arrowSize: 100}, 100)};
 d.scales['1:50'] = {offset: {x: 0, y: -100}};
 const d50 = resolveAnnotative(d, 50);
 assert.equal(d50.textHeight, 125);assert.equal(d50.arrowSize, 50);
 assert.deepEqual(d50.points[0], {x: 0, y: 0}, '잰 점은 그대로');assert.deepEqual(d50.points[2], {x: 500, y: 200}, '치수선 위치만 표현별로');
 const L = {...leader(2000, 2000), mleader: true};
 Object.assign(L, makeAnnotative(L, 100));L.scales['1:50'] = {};
 const L50 = resolveAnnotative(L, 50);
 assert.equal(L50.entities.find(c => c.type === 'text').height, 125);
 assert.deepEqual(L50.entities[0].points[0], {x: 2000, y: 2000}, '화살표 끝은 제자리');
 assert.equal(resolveAnnotative(L50, 100).entities.find(c => c.type === 'text').height, 250);
});

test('510 OBJECTSCALE 더하기 → CANNOSCALE 로 축척을 바꾸면 그 표현 크기로, 없는 객체는 그대로(흐림 표시)', () => {
 const engine = setup();
 engine.execute({type: 'add', entity: {id: 'T3', type: 'text', layer: 'default', position: {x: 200000, y: 0}, text: '1:100 만', height: 250}});
 const h = multiHarness(engine, ['T', 'D', 'L1']);
 h.cmds.OBJECTSCALE();h.apply({action: 'add', scales: '1:100, 1:50'});
 assert.ok(isMultiScale(byId(engine, 'T')));assert.equal(byId(engine, 'T').paperHeight, 2.5);
 assert.deepEqual(Object.keys(byId(engine, 'T').scales).sort(), ['1:100', '1:50']);
 assert.equal(byId(engine, 'T').height, 250, '현재 축척(1:100) 크기 그대로');
 const h2 = multiHarness(engine, ['T3']);h2.cmds.OBJECTSCALE();h2.apply({action: 'add', scales: '1:100'});
 const before = engine.doc.entities;
 h.cmds.CANNOSCALE();h.apply({scale: '1:50'});
 assert.equal(engine.doc.currentAnnoScale, 50);
 assert.equal(byId(engine, 'T').height, 125);assert.equal(byId(engine, 'D').textHeight, 125);
 assert.equal(byId(engine, 'L1').entities.find(c => c.type === 'text').height, 125);
 assert.equal(byId(engine, 'T3').height, 250, '1:50 표현이 없는 문자는 크기 그대로');
 assert.equal(byId(engine, 'T3').annoMissing, true);
 assert.deepEqual(byId(engine, 'W'), before.find(e => e.id === 'W'), '주석이 아닌 객체는 안 바뀜');
 assert.match(h.toasts.at(-1), /주석 3개 크기 맞춤 · 표현 없음 1개/);
 h.cmds.CANNOSCALE();h.apply({scale: '1:100'});
 assert.equal(byId(engine, 'T').height, 250);assert.equal(byId(engine, 'T3').annoMissing, undefined);
 engine.execute({type: 'undo'});
 assert.equal(byId(engine, 'T').height, 125, '한 번에 되돌림');assert.equal(engine.doc.currentAnnoScale, 50);
});

test('510 ANNOALLVISIBLE 끔: 표현 없는 주석은 숨기고, 켜면 우리가 숨긴 것만 다시 보임', () => {
 const engine = setup();
 engine.execute({type: 'add', entity: {id: 'U', type: 'text', layer: 'default', position: {x: 200000, y: 0}, text: '사용자 숨김', height: 250, hidden: true}});
 const h = multiHarness(engine, ['T', 'U']);
 h.cmds.OBJECTSCALE();h.apply({action: 'add', scales: '1:100'});
 h.cmds.CANNOSCALE();h.apply({scale: '1:50', allVisible: false});
 assert.equal(byId(engine, 'T').hidden, true);assert.equal(byId(engine, 'T').annoHidden, true);
 assert.equal(byId(engine, 'U').annoHidden, undefined, '원래 숨긴 객체는 우리 표시를 달지 않음');
 h.cmds.ANNOALLVISIBLE();
 assert.equal(engine.doc.annoAllVisible, true);
 assert.equal(byId(engine, 'T').hidden, undefined);assert.equal(byId(engine, 'T').annoMissing, true);
 assert.equal(byId(engine, 'U').hidden, true, '사용자가 숨긴 것은 그대로');
 assert.equal(JSON.stringify(byId(engine, 'T')).includes('hidden'), false, '저장하면 지운 값은 빠짐');
});

test('510 ANNOAUTOSCALE: 기본 꺼짐, 켜면 이전 축척을 가진 주석에만 새 표현을 더함', () => {
 const engine = setup();
 const h = multiHarness(engine, ['T', 'D']);
 h.cmds.OBJECTSCALE();h.apply({action: 'add', scales: '1:100'});
 assert.equal(engine.doc.annoAutoScale, undefined);
 h.cmds.ANNOAUTOSCALE();assert.equal(engine.doc.annoAutoScale, true);
 h.cmds.CANNOSCALE();h.apply({scale: '1:200'});
 assert.deepEqual(Object.keys(byId(engine, 'T').scales).sort(), ['1:100', '1:200']);
 assert.equal(byId(engine, 'T').height, 500);
 h.cmds.CANNOSCALE();h.apply({scale: '1:30', auto: false});
 assert.equal(byId(engine, 'T').scales['1:30'], undefined, '끄면 더하지 않음');
 assert.equal(byId(engine, 'T').height, 500);
 h.cmds.CANNOSCALE();h.apply({scale: '1:100', custom: '1:250'});
 assert.equal(engine.doc.currentAnnoScale, 250);assert.ok(engine.doc.scaleList.some(s => s.name === '1:250'), '목록에 없던 축척은 목록에 더함');
});

test('510 표현별 위치 옮기기·위치 맞추기·빼기·주석 끄기', () => {
 const engine = setup();
 const h = multiHarness(engine, ['T']);
 h.cmds.OBJECTSCALE();h.apply({action: 'add', scales: '1:100, 1:50'});
 h.cmds.OBJECTSCALE();h.apply({action: 'offset', dx: 0, dy: 300});
 assert.deepEqual(byId(engine, 'T').position, {x: 100, y: 400});
 h.cmds.CANNOSCALE();h.apply({scale: '1:50'});
 assert.deepEqual(byId(engine, 'T').position, {x: 100, y: 100}, '1:50 은 원래 위치');
 engine.execute({type: 'move', ids: ['T'], dx: 1000, dy: 0});
 h.cmds.CANNOSCALE();h.apply({scale: '1:100'});
 assert.deepEqual(byId(engine, 'T').position, {x: 1100, y: 400}, 'MOVE 는 모든 표현이 같이 움직임');
 h.cmds.OBJECTSCALE();h.apply({action: 'sync'});
 h.cmds.CANNOSCALE();h.apply({scale: '1:50'});
 assert.deepEqual(byId(engine, 'T').position, {x: 1100, y: 400}, '맞춘 뒤에는 모든 축척이 같은 위치');
 h.cmds.OBJECTSCALE();h.apply({action: 'remove', scales: '1:50'});
 assert.deepEqual(Object.keys(byId(engine, 'T').scales), ['1:100']);
 assert.equal(byId(engine, 'T').height, 250, '지금 표현을 빼면 남은 표현 크기로');assert.equal(byId(engine, 'T').annoMissing, true);
 h.cmds.OBJECTSCALE();h.apply({action: 'remove', scales: '1:100'});
 assert.match(h.toasts.at(-1), /바꿀 수 있는 객체가 없습니다/, '마지막 표현은 뺄 수 없음');
 h.cmds.OBJECTSCALE();h.apply({action: 'off'});
 assert.equal(isMultiScale(byId(engine, 'T')), false);assert.equal(byId(engine, 'T').annoScale, 100, '단일 축척 기억은 남아 ANNOSCALE 이 이어서 씀');
});

test('510 사용자가 지금 축척에서 바꾼 높이는 다른 축척에도 이어짐(용지 높이로 거꾸로 기억)', () => {
 const engine = setup();
 const h = multiHarness(engine, ['T']);
 h.cmds.OBJECTSCALE();h.apply({action: 'add', scales: '1:100, 1:50'});
 engine.execute({type: 'update', ids: ['T'], changes: {height: 300}});
 h.cmds.CANNOSCALE();h.apply({scale: '1:50'});
 assert.equal(byId(engine, 'T').height, 150);assert.equal(byId(engine, 'T').paperHeight, 3);
});

test('510 ANNOSCALE·도곽 복사 보정은 여러 축척 주석을 표현으로 풀고 한 번 곱하기를 하지 않음', () => {
 const engine = setup();
 const h = multiHarness(engine, ['T']);
 h.cmds.OBJECTSCALE();h.apply({action: 'add', scales: '1:100'});
 const {commands, counts} = annotationScaleCommands([byId(engine, 'T')], {from: 100, to: 50});
 assert.equal(counts.text, 1);
 const changes = commands[0].updates[0].changes;
 assert.equal(changes.height, 125);assert.deepEqual(Object.keys(changes.scales).sort(), ['1:100', '1:50'], 'ANNOSCALE 은 목표 축척 표현을 더함');
 engine.execute({type: 'batch', commands});
 assert.equal(annotationScaleCommands([byId(engine, 'T')], {from: 100, to: 50}).commands.length, 0, '두 번 줄지 않음');
 const ratio = annotationScaleCommands([byId(engine, 'T')], 4).commands[0].updates[0].changes;
 assert.equal(ratio.height, 500);assert.equal(ratio.annoScale, 200);
});

test('510 축척 바꾸기는 여러 축척 주석만 훑고, 없는 도면은 바꿀 것 0', () => {
 const entities = Array.from({length: 1000}, (_, i) => ({id: 'l' + i, type: 'line', layer: 'default', points: [{x: i, y: 0}, {x: i + 1, y: 0}]}));
 const doc = {layers: [{id: 'default'}], entities};
 assert.equal(multiScaleEntities(entities).length, 0);
 assert.equal(multiScaleEntities(entities), multiScaleEntities(entities), '같은 배열은 한 번만 훑음');
 assert.deepEqual(currentScaleUpdates(doc, 50).updates, []);
 const t = {id: 't', type: 'text', layer: 'default', position: {x: 0, y: 0}, text: 'A', height: 250, annotative: true, paperHeight: 2.5, annoScale: 100, scales: {'1:100': {}, '1:50': {}}};
 assert.equal(annotativeChanges(t, 100), null, '같은 축척이면 바꿀 것 없음');
 const withSheet = {layers: [{id: 'default'}], sheets: [{id: 'S', denominator: 100, annotationScale: 100, bounds: {minX: -10, minY: -10, maxX: 10, maxY: 10}}], entities: [...entities, {...t, sheetId: 'S'}]};
 assert.deepEqual(currentScaleUpdates(withSheet, 50).updates, [], '도곽 주석 축척을 따르는 객체는 현재 축척과 무관');
 const locked = currentScaleUpdates({layers: [], entities: [t]}, 50, {locked: new Set(['default'])});
 assert.equal(locked.updates.length, 0);assert.equal(locked.counts.locked, 1);
});
