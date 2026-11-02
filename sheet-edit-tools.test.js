import test from 'node:test';
import assert from 'node:assert/strict';
import * as G from './geometry.js';
import {DrawingEngine} from './engine.js';
import {copyBetweenBoxes} from './sheet-plot-tools.js';
import {
 PAPER_SIZES, inferPaperScale, sheetAtPoint, sheetMapping, sheetContent, transformForSheet, copyForSheet, stretchVertexIndices, stretchPlan,
 stretchCommands, normalizeSheetEditOp, isRectLikeFrame, frameLabel, installSheetEditTools,
} from './sheet-edit-tools.js';

const P = (x, y) => ({x, y});
const S1 = {id: 'S1', number: 'A-001', title: '평면도', paper: 'A3', denominator: 100, bounds: {minX: 0, minY: 0, maxX: 42000, maxY: 29700}};
const S2 = {id: 'S2', number: 'A-002', title: '확대 평면도', paper: 'A3', denominator: 50, bounds: {minX: 50000, minY: 0, maxX: 71000, maxY: 14850}};

/** 도곽 두 장(A3 1:100 · A3 1:50)과 안쪽 객체. 잠긴 레이어(선·치수)·숨긴 레이어·표제란(A-TITLE)·도곽 밖 객체를 섞었다. */
function setup() {
 const engine = new DrawingEngine();
 for (const name of ['A-WALL', '잠금', '숨김', 'A-TITLE']) engine.execute({type: 'layer.add', name});
 const L = (name) => engine.doc.layers.find(l => l.name === name).id;
 const wall = L('A-WALL'), lock = L('잠금'), hide = L('숨김'), ttl = L('A-TITLE');
 const add = (entity) => ({type: 'add', entity});
 engine.execute({type: 'batch', commands: [
  add({id: 'F1', type: 'rectangle', layer: 'default', points: G.rectangle(P(0, 0), P(42000, 29700)), sheetId: 'S1', sheetDecoration: true}),
  add({id: 'F2', type: 'rectangle', layer: 'default', points: G.rectangle(P(50000, 0), P(71000, 14850)), sheetId: 'S2', sheetDecoration: true}),
  add({id: 'L1', type: 'line', layer: wall, points: [P(1000, 1000), P(5000, 1000)]}),
  add({id: 'PL', type: 'polyline', layer: wall, closed: false, points: [P(1000, 3000), P(5000, 3000), P(5000, 6000)]}),
  add({id: 'R1', type: 'rectangle', layer: wall, points: G.rectangle(P(2000, 8000), P(5000, 10000))}),
  add({id: 'T1', type: 'text', layer: 'default', position: P(2000, 2000), text: '거실', height: 250}),
  add({id: 'T2', type: 'text', layer: 'default', position: P(4500, 4500), text: '창', height: 250}),
  add({id: 'L2', type: 'line', layer: wall, points: [P(4200, 7000), P(5800, 7000)]}),
  add({id: 'D1', type: 'dimension', mode: 'horizontal', layer: 'default', points: [P(1000, 1000), P(5000, 1000), P(3000, 500)], textHeight: 250, arrowSize: 100}),
  add({id: 'C1', type: 'circle', layer: 'default', center: P(10000, 10000), radius: 500}),
  add({id: 'N1', type: 'text', layer: 'default', position: P(20000, 20000), text: '도곽 연결', height: 250, sheetId: 'S1'}),
  add({id: 'TB', type: 'text', layer: ttl, position: P(38000, 1000), text: 'A-001 평면도', height: 300}),
  add({id: 'LK', type: 'line', layer: lock, points: [P(1000, 12000), P(5000, 12000)]}),
  add({id: 'DL', type: 'dimension', mode: 'horizontal', layer: lock, points: [P(3000, 1000), P(5000, 1000), P(4000, 1500)], textHeight: 250}),
  add({id: 'HD', type: 'line', layer: hide, points: [P(1000, 14000), P(5000, 14000)]}),
  add({id: 'OUT', type: 'line', layer: wall, points: [P(-5000, -5000), P(-1000, -1000)]}),
 ]});
 engine.execute({type: 'layer.update', id: lock, changes: {locked: true}});
 engine.execute({type: 'layer.update', id: hide, changes: {visible: false}});
 engine.execute({type: 'document.update', changes: {sheets: [S1, S2]}});
 return {engine, layers: {wall, lock, hide, ttl}};
}
const byId = (engine, id) => engine.doc.entities.find(e => e.id === id);
const snapshot = (engine) => structuredClone(engine.doc.entities);
const CONTENT = ['L1', 'PL', 'R1', 'T1', 'T2', 'L2', 'D1', 'C1', 'N1'];
const UNTOUCHED = ['F1', 'F2', 'TB', 'LK', 'DL', 'HD', 'OUT'];

/** 가짜 카드 문맥: 점 찍기는 대기열, 폼은 기본값 + 넘긴 값으로 적용한다(app.js 폼처럼 체크박스는 'on'). */
function harness(engine, {selected = [], settings = {paper: 'A3', denominator: 100}} = {}) {
 const queue = [], forms = [], toasts = [];
 const ctx = {
  doc: () => engine.doc, entities: () => engine.doc.entities, layers: () => engine.doc.layers,
  selected: () => engine.doc.entities.filter(e => selected.includes(e.id)),
  execute: (c) => engine.execute(c), toast: (m) => toasts.push(m), getSettings: () => settings, tolerance: () => 1,
  pickPoint: async () => queue.shift() ?? null,
  pickEntity: async () => null,
  form: (title, fields, onApply) => { forms.push({title, fields, apply: (v = {}) => onApply({...Object.fromEntries(fields.map(f => [f.name, f.value])), ...v})}); return fields; },
 };
 return {ctx, forms, toasts, cmds: installSheetEditTools(ctx), click: (...points) => queue.push(...points), form: () => forms.at(-1)};
}

/* ── 순수 함수 ── */
test('용지·축척 추정: 42000×29700 은 A3 1:100, 같은 크기라도 기본 용지가 A1 이면 A1 1:50', () => {
 assert.deepEqual(PAPER_SIZES.A3, [420, 297]);
 const a3 = inferPaperScale(42000, 29700);
 assert.equal(a3.paper, 'A3');assert.equal(a3.denominator, 100);assert.equal(a3.orientation, 'landscape');assert.equal(a3.standard, true);
 const a1 = inferPaperScale(42000, 29700, {preferPaper: 'A1'});
 assert.equal(a1.paper, 'A1');assert.equal(a1.denominator, 50);
 const big = inferPaperScale(84100, 59400);
 assert.deepEqual([big.paper, big.denominator], ['A1', 100]);
 const portrait = inferPaperScale(29700, 42000);
 assert.deepEqual([portrait.paper, portrait.denominator, portrait.orientation], ['A3', 100, 'portrait']);
 assert.deepEqual([inferPaperScale(1189 * 200, 841 * 200).paper, inferPaperScale(1189 * 200, 841 * 200).denominator], ['A0', 200]);
 assert.deepEqual([inferPaperScale(594 * 30, 420 * 30).paper, inferPaperScale(594 * 30, 420 * 30).denominator], ['A2', 30]);
 const inner = inferPaperScale(40000, 27700);   // 여백 안쪽 테두리(√2 에서 2% 벗어남)도 1:100 으로
 assert.deepEqual([inner.paper, inner.denominator], ['A3', 100]);
 assert.equal(inferPaperScale(10000, 10000), null, '정사각형은 도곽이 아니다');
 assert.equal(inferPaperScale(0, 100), null);
});

test('도곽 인식: 등록 도곽은 점을 담는 가장 작은 것, 없으면 null', () => {
 const nested = {id: 'IN', number: 'A-009', title: '부분', paper: 'A4', denominator: 20, bounds: {minX: 1000, minY: 1000, maxX: 6940, maxY: 5200}};
 const hit = sheetAtPoint(P(2000, 2000), {sheets: [S1, nested], entities: []});
 assert.equal(hit.kind, 'registered');assert.equal(hit.id, 'IN');assert.equal(hit.denominator, 20);
 assert.equal(sheetAtPoint(P(30000, 20000), {sheets: [S1, nested]}).id, 'S1');
 assert.equal(sheetAtPoint(P(-10, -10), {sheets: [S1, nested]}), null);
 assert.match(frameLabel(hit), /A-009 부분 \(A4 1:20\)/);
});

test('도곽 인식: 그린 도곽(사각형·닫힌 폴리선·블록)에서 가장 작은 것, 용지 비율이 아니면 제외', () => {
 const layers = [{id: 'default', name: '0', visible: true}, {id: 'FR', name: '도곽', visible: true}, {id: 'OFF', name: '꺼짐', visible: false}];
 const outer = {id: 'OUTER', type: 'rectangle', layer: 'default', points: G.rectangle(P(0, 0), P(84100, 59400))};
 const inner = {id: 'INNER', type: 'polyline', closed: true, layer: 'FR', points: [P(1000, 1000), P(22000, 1000), P(43000, 1000), P(43000, 30700), P(1000, 30700)]};
 const room = {id: 'ROOM', type: 'polyline', closed: true, layer: 'default', points: G.rectangle(P(2000, 2000), P(12000, 12000))};
 const chair = {id: 'CHAIR', type: 'rectangle', layer: 'default', points: G.rectangle(P(2100, 2100), P(2800, 2595))};
 const hidden = {id: 'HID', type: 'rectangle', layer: 'OFF', points: G.rectangle(P(1500, 1500), P(22500, 16350))};
 assert.equal(isRectLikeFrame(inner), true, '꼭짓점이 더 있어도 사각형이면 도곽 후보');
 const frame = sheetAtPoint(P(3000, 3000), {entities: [outer, inner, room, chair, hidden], layers});
 assert.equal(frame.kind, 'drawn');assert.equal(frame.id, 'INNER');
 assert.deepEqual([frame.paper, frame.denominator], ['A3', 100]);
 assert.deepEqual(frame.frameLayers, ['FR'], '도곽 전용 레이어는 도곽·표제란 레이어로 본다');
 const big = sheetAtPoint(P(60000, 40000), {entities: [outer, inner], layers});
 assert.deepEqual([big.id, big.paper, big.denominator, big.frameLayers.length], ['OUTER', 'A1', 100, 0]);
 const block = {id: 'BLK', type: 'block', name: '도곽A3', layer: 'default', entities: [
  {id: 'b1', type: 'rectangle', layer: 'default', points: G.rectangle(P(100000, 0), P(121000, 14850))},
  {id: 'b2', type: 'line', layer: 'default', points: [P(115000, 0), P(115000, 3000)]},
 ]};
 const byBlock = sheetAtPoint(P(101000, 1000), {entities: [block], layers});
 assert.deepEqual([byBlock.id, byBlock.title, byBlock.paper, byBlock.denominator], ['BLK', '도곽A3', 'A3', 50]);
 assert.equal(sheetAtPoint(P(5000, 5000), {entities: [room], layers}), null, '정사각형 방은 도곽이 아니다');
 assert.equal(sheetAtPoint(P(2200, 2200), {entities: [chair], layers}), null, '작은 용지비율 가구는 도곽이 아니다');
});

test('도곽 대응: 도곽 비율(DBC 와 같은 결과)·실제 크기·크기 그대로', () => {
 const paper = sheetMapping(S1, S2, 'paper');
 assert.equal(paper.factor, 0.5);
 assert.deepEqual(paper.map(P(1000, 1000)), P(50500, 500));
 assert.deepEqual(paper.map(P(42000, 29700)), P(71000, 14850));
 const line = {id: 'x', type: 'line', layer: 'default', points: [P(1000, 1000), P(5000, 3000)]};
 assert.deepEqual(transformForSheet(line, paper).points, copyBetweenBoxes([line], S1.bounds, S2.bounds)[0].points, 'DBC copyBetweenBoxes 와 같은 도형');
 const real = sheetMapping(S1, S2, 'real');
 assert.deepEqual([real.factor, real.annotationRatio, real.dx, real.dy], [1, 0.5, 50000, 0]);
 const none = sheetMapping(S1, S2, 'none');
 assert.deepEqual([none.factor, none.annotationRatio], [1, 1]);
 assert.throws(() => sheetMapping(S1, S2, 'bogus'), /축척 보정 방식/);
 assert.throws(() => sheetMapping({bounds: {minX: 0, minY: 0, maxX: 0, maxY: 10}}, S2), /원본 도곽/);
 const dim = {id: 'd', type: 'dimension', mode: 'horizontal', layer: 'default', points: [P(0, 0), P(4000, 0), P(0, 500)], textHeight: 250};
 const [copy] = copyForSheet([dim], paper, {idFactory: () => 'new-d'});
 assert.equal(copy.id, 'new-d');assert.equal(copy.measurementScale, 2);assert.equal(copy.textHeight, 125);
 assert.equal(G.dimensionParts(copy).find(p => p.type === 'text').text, '4000', '축척 보정 뒤에도 실제 길이');
 assert.equal(copyForSheet([dim], paper, {keepDimensionValue: false})[0].measurementScale, undefined);
});

test('늘리기 꼭짓점: 선·폴리선·사각형·치수 정의점 중 창 안의 것만', () => {
 const box = {minX: 4000, minY: 0, maxX: 6000, maxY: 15000};
 assert.deepEqual(stretchVertexIndices({type: 'line', points: [P(1000, 1000), P(5000, 1000)]}, box), [1]);
 assert.deepEqual(stretchVertexIndices({type: 'polyline', points: [P(1000, 3000), P(5000, 3000), P(5000, 6000), P(7000, 6000)]}, box), [1, 2]);
 assert.deepEqual(stretchVertexIndices({type: 'rectangle', points: G.rectangle(P(2000, 8000), P(5000, 10000))}, box), [1, 2]);
 assert.deepEqual(stretchVertexIndices({type: 'dimension', points: [P(1000, 1000), P(5000, 1000), P(3000, 500)]}, box), [1]);
 assert.deepEqual(stretchVertexIndices({type: 'text', position: P(4500, 100)}, box), [], '문자는 꼭짓점 늘리기 대상이 아니다');
 assert.deepEqual(stretchVertexIndices({type: 'line', points: [P(4000, 0), P(3000, 0)]}, box), [0], '창 경계 위 점은 안으로 본다');
 const layers = [{id: 'default', name: '0', visible: true}, {id: 'LK', name: '잠금', visible: true, locked: true}];
 const plan = stretchPlan([
  {id: 'a', type: 'line', layer: 'default', points: [P(1000, 1000), P(5000, 1000)]},
  {id: 'b', type: 'line', layer: 'default', points: [P(4200, 7000), P(5800, 7000)]},
  {id: 'c', type: 'text', layer: 'default', position: P(5000, 9000), text: 'x', height: 5000},
  {id: 'd', type: 'circle', layer: 'default', center: P(3000, 5000), radius: 1500},
  {id: 'e', type: 'line', layer: 'LK', points: [P(1000, 12000), P(5000, 12000)]},
  {id: 'f', type: 'line', layer: 'default', points: [P(3000, 14000), P(7000, 14000)]},
  {id: 'g', type: 'wall', layer: 'default', points: [P(1000, 11000), P(5000, 11000)], thickness: 200},
 ], box, {layers});
 assert.deepEqual(plan.moveIds, ['b', 'c'], '통째로 든 선, 삽입점이 든 문자');
 assert.deepEqual(plan.targets, [{id: 'a', indices: [1]}]);
 assert.deepEqual(plan.locked, ['e']);
 assert.deepEqual(plan.skipped.map(s => s.id), ['g'], '걸친 벽은 건너뜀');
});

test('늘린 사각형: 축에 나란하면 사각형 그대로, 찌그러지면 같은 ID 의 닫힌 폴리선', () => {
 const engine = new DrawingEngine();
 engine.execute({type: 'batch', commands: [
  {type: 'add', entity: {id: 'R', type: 'rectangle', layer: 'default', points: G.rectangle(P(0, 0), P(1000, 1000))}},
  {type: 'add', entity: {id: 'Q', type: 'rectangle', layer: 'default', points: G.rectangle(P(0, 2000), P(1000, 3000))}},
 ]});
 const layers = engine.doc.layers;
 let plan = stretchPlan(engine.doc.entities, {minX: 900, minY: -10, maxX: 1100, maxY: 1100}, {layers});
 engine.execute({type: 'batch', commands: stretchCommands(engine.doc.entities, plan, P(500, 0))});
 assert.equal(byId(engine, 'R').type, 'rectangle');
 assert.deepEqual(byId(engine, 'R').points, G.rectangle(P(0, 0), P(1500, 1000)));
 plan = stretchPlan(engine.doc.entities, {minX: 900, minY: 2900, maxX: 1100, maxY: 3100}, {layers});
 engine.execute({type: 'batch', commands: stretchCommands(engine.doc.entities, plan, P(500, 0))});
 assert.equal(byId(engine, 'Q').type, 'polyline');assert.equal(byId(engine, 'Q').closed, true);
 assert.deepEqual(byId(engine, 'Q').points[2], P(1500, 3000));
 assert.throws(() => stretchCommands(engine.doc.entities, plan, P(0, 0)), /이동량이 0/);
 assert.equal(normalizeSheetEditOp('s'), 'stretch');assert.equal(normalizeSheetEditOp('EEV'), 'erase');assert.equal(normalizeSheetEditOp('copy'), 'copy');
 assert.throws(() => normalizeSheetEditOp('x'), /C\(복사\)/);
});

test('도곽 안 객체: 도곽·표제란은 남기고 잠긴·숨긴 레이어는 따로 센다', () => {
 const {engine} = setup();
 const frame = sheetAtPoint(P(100, 100), {sheets: engine.doc.sheets, entities: engine.doc.entities, layers: engine.doc.layers});
 assert.deepEqual(frame.frameIds, ['F1']);
 const c = sheetContent(frame, {entities: engine.doc.entities, layers: engine.doc.layers});
 assert.deepEqual(c.items.map(e => e.id).sort(), [...CONTENT].sort());
 assert.deepEqual(c.frame.map(e => e.id).sort(), ['F1', 'TB']);
 assert.deepEqual(c.locked.map(e => e.id).sort(), ['DL', 'LK']);
 assert.deepEqual(c.hidden.map(e => e.id), ['HD']);
 assert.ok(!c.items.some(e => e.id === 'OUT'));
 const loose = sheetContent(frame, {entities: engine.doc.entities, layers: engine.doc.layers, keepFrame: false});
 assert.ok(loose.items.some(e => e.id === 'TB'), '끄면 표제란 문자도 대상');
});

/* ── 명령(실제 엔진) ── */
test('CCV: 1:100 도곽 → 1:50 도곽 복사, 도곽 비율 ×0.5 · 치수 값 유지 · 잠긴·숨긴 레이어 제외 · 되돌리기 한 번', async () => {
 const {engine} = setup();
 const before = snapshot(engine), h = harness(engine);
 h.click(P(100, 100), P(51000, 100));
 await h.cmds.CCV();
 assert.match(h.form().title, /A-001 평면도 \(A3 1:100\) → 도곽 A-002 확대 평면도 \(A3 1:50\) · 객체 9개/);
 assert.match(h.form().title, /잠긴 레이어 2개/);
 h.form().apply({});
 const added = engine.doc.entities.slice(before.length);
 assert.equal(added.length, CONTENT.length);
 for (const e of before) assert.deepEqual(byId(engine, e.id), e, `원본 ${e.id} 그대로`);
 const line = added.find(e => e.type === 'line' && e.points[0].y === 500);
 assert.deepEqual(line.points, [P(50500, 500), P(52500, 500)]);
 const text = added.find(e => e.text === '거실');
 assert.equal(text.height, 125);assert.deepEqual(text.position, P(51000, 1000));
 const dim = added.find(e => e.type === 'dimension');
 assert.equal(dim.measurementScale, 2);
 assert.equal(G.dimensionParts(dim).find(p => p.type === 'text').text, '4000');
 assert.equal(added.find(e => e.type === 'circle').radius, 250);
 assert.equal(added.find(e => e.text === '도곽 연결').sheetId, 'S2', '도곽 연결값은 대상 도곽으로');
 assert.ok(!added.some(e => e.text === 'A-001 평면도'), '표제란은 복사하지 않는다');
 assert.ok(!added.some(e => e.layer === engine.doc.layers.find(l => l.name === '잠금').id));
 assert.equal(new Set(added.map(e => e.id)).size, added.length);
 assert.ok(added.every(e => !before.some(b => b.id === e.id)), '새 ID');
 assert.match(h.toasts.at(-1), /객체 9개 복사 · 배율 ×0.5/);
 engine.execute({type: 'undo'});
 assert.deepEqual(engine.doc.entities, before, '되돌리기 한 번에 원래대로');
});

test('CCV: 먼저 고른 객체만 복사할 수 있다(도곽 밖 선택은 무시)', async () => {
 const {engine} = setup();
 const h = harness(engine, {selected: ['L1', 'T1', 'OUT', 'LK']});
 const count = engine.doc.entities.length;
 h.click(P(100, 100), P(51000, 100));
 await h.cmds.CCV();
 const scope = h.form().fields.find(f => f.name === 'scope');
 assert.equal(scope.value, 'selection');
 assert.match(scope.options[0][1], /선택한 객체 2개/);
 h.form().apply({scaleMode: 'none'});
 assert.equal(engine.doc.entities.length, count + 2);
 assert.deepEqual(engine.doc.entities.at(-2).points, [P(51000, 1000), P(55000, 1000)], '크기 그대로 · 좌하귀 기준 위치');
});

test('MMV: 실제 크기 유지로 이동하면 도형은 ×1, 문자·치수만 1:100→1:50 비율로 · ID 유지 · 되돌리기', async () => {
 const {engine} = setup();
 const before = snapshot(engine), h = harness(engine);
 h.click(P(100, 100), P(60000, 10000));
 await h.cmds.MMV();
 h.form().apply({scaleMode: 'real'});
 assert.equal(engine.doc.entities.length, before.length, '이동은 개수 그대로');
 assert.deepEqual(byId(engine, 'L1').points, [P(51000, 1000), P(55000, 1000)]);
 assert.equal(byId(engine, 'T1').height, 125);assert.deepEqual(byId(engine, 'T1').position, P(52000, 2000));
 assert.equal(byId(engine, 'D1').textHeight, 125);
 assert.equal(G.dimensionParts(byId(engine, 'D1')).find(p => p.type === 'text').text, '4000');
 assert.equal(byId(engine, 'N1').sheetId, 'S2');
 for (const id of UNTOUCHED) assert.deepEqual(byId(engine, id), before.find(e => e.id === id), `${id} 그대로`);
 engine.execute({type: 'undo'});
 assert.deepEqual(engine.doc.entities, before);
});

test('MMV: 도곽 비율 이동은 엔진 scale+move · 치수 측정 배율 보정', async () => {
 const {engine} = setup();
 const h = harness(engine);
 h.click(P(100, 100), P(60000, 10000));
 await h.cmds.MMV();
 h.form().apply({});
 assert.deepEqual(byId(engine, 'L1').points, [P(50500, 500), P(52500, 500)]);
 assert.equal(byId(engine, 'D1').measurementScale, 2);
 assert.deepEqual(byId(engine, 'LK').points, [P(1000, 12000), P(5000, 12000)], '잠긴 레이어는 제자리');
});

test('SSV: 걸침 창 · 창 안 꼭짓점만 늘리고 통째로 든 것은 이동 · 잠긴 치수는 끌려가지 않음 · 되돌리기', async () => {
 const {engine} = setup();
 const before = snapshot(engine), h = harness(engine);
 h.click(P(100, 100), P(4000, -500), P(6000, 15000));   // 창은 도곽 밖으로 삐져도 도곽 안으로 잘린다
 await h.cmds.SSV();
 assert.match(h.form().title, /통째 이동 2개 · 꼭짓점 늘리기 4개 · 제외: 잠긴 레이어 2개, 숨긴 레이어·객체 1개/);
 await h.form().apply({how: 'value', dx: 1000, dy: 0});
 assert.deepEqual(byId(engine, 'L1').points, [P(1000, 1000), P(6000, 1000)]);
 assert.deepEqual(byId(engine, 'PL').points, [P(1000, 3000), P(6000, 3000), P(6000, 6000)]);
 assert.equal(byId(engine, 'R1').type, 'rectangle');
 assert.deepEqual(byId(engine, 'R1').points, G.rectangle(P(2000, 8000), P(6000, 10000)));
 assert.deepEqual(byId(engine, 'D1').points, [P(1000, 1000), P(6000, 1000), P(3000, 500)]);
 assert.equal(G.dimensionParts(byId(engine, 'D1')).find(p => p.type === 'text').text, '5000');
 assert.deepEqual(byId(engine, 'T2').position, P(5500, 4500));
 assert.deepEqual(byId(engine, 'L2').points, [P(5200, 7000), P(6800, 7000)]);
 for (const id of ['T1', 'C1', 'LK', 'DL', 'HD', 'F1', 'TB', 'OUT']) assert.deepEqual(byId(engine, id), before.find(e => e.id === id), `${id} 그대로`);
 engine.execute({type: 'undo'});
 assert.deepEqual(engine.doc.entities, before);
});

test('SSV: 이동량 = 두 도곽 사이 거리(대상 도곽 한 번 클릭), 두 점 지정', async () => {
 let {engine} = setup();
 let h = harness(engine);
 h.click(P(100, 100), P(4000, 0), P(6000, 11000));
 await h.cmds.SSV();
 h.click(P(60000, 5000));
 await h.form().apply({how: 'sheet'});
 assert.deepEqual(byId(engine, 'L1').points[1], P(55000, 1000));
 assert.deepEqual(byId(engine, 'L2').points[0], P(54200, 7000));
 assert.match(h.toasts.at(-1), /축척이 달라도 늘리기는 평행 이동량만/);
 ({engine} = setup());
 h = harness(engine);
 h.click(P(100, 100), P(4000, 0), P(6000, 11000));
 await h.cmds.SSV();
 h.click(P(0, 0), P(0, 2000));
 await h.form().apply({how: 'points'});
 assert.deepEqual(byId(engine, 'L1').points[1], P(5000, 3000));
});

test('EEV: 도곽·표제란은 남기고 안쪽만, 확인 칸이 있어야 지움 · 잠긴 레이어 보존 · 되돌리기', async () => {
 const {engine} = setup();
 const before = snapshot(engine), h = harness(engine);
 h.click(P(30000, 20000));
 await h.cmds.EEV();
 assert.match(h.form().title, /지울 객체 9개 · 남기는 도곽·표제란 2개/);
 assert.throws(() => h.form().apply({}), /확인 칸을 체크/);
 assert.equal(engine.doc.entities.length, before.length);
 h.form().apply({confirm: 'on'});
 assert.deepEqual(engine.doc.entities.map(e => e.id).sort(), [...UNTOUCHED].sort());
 engine.execute({type: 'undo'});
 assert.deepEqual(engine.doc.entities, before);
});

test('SHEETEDIT(도곽편집): 작업 글자(E)로 고르고 같은 흐름 · 도곽 밖 클릭은 한국어 오류', async () => {
 const {engine} = setup();
 const h = harness(engine);
 h.cmds.SHEETEDIT();
 assert.deepEqual(h.form().fields[0].options.map(o => o[0]), ['copy', 'move', 'stretch', 'erase']);
 h.click(P(100, 100));
 await h.form().apply({op: 'E'});
 assert.match(h.form().title, /도곽 영역 지우기 \(EEV\) · 도곽 A-001 평면도 \(A3 1:100\) · 지울 객체 9개/);
 assert.throws(() => h.forms[0].apply({op: 'x'}), /C\(복사\)·M\(이동\)/);
 const blank = harness(engine);
 blank.click(P(60000, 5000));
 await assert.rejects(blank.cmds.EEV(), /도곽 A-002 확대 평면도 \(A3 1:50\) 안에 지울 객체가 없습니다/);
 const outside = harness(engine);
 outside.click(P(-90000, -90000));
 await assert.rejects(outside.cmds.CCV(), /클릭한 점\(X -90,000, Y -90,000\)을 둘러싼 도곽을 찾지 못했습니다/);
 const same = harness(engine);
 same.click(P(100, 100), P(200, 200));
 await assert.rejects(same.cmds.MMV(), /원본과 대상이 같은 도곽/);
 const empty = harness(engine);
 empty.click(P(100, 100), P(1, 1), P(2, 2));
 await assert.rejects(empty.cmds.SSV(), /창 안에 옮기거나 늘릴 객체가 없습니다/);
 const esc = harness(engine);
 assert.equal(await esc.cmds.CCV(), undefined, 'Esc(점 없음)는 조용히 끝');
});

test('그린 도곽끼리(등록 없음): 한 번 클릭 인식 · 1:100 → 1:50 복사 · 도곽 레이어는 제외', async () => {
 const engine = new DrawingEngine();
 engine.execute({type: 'layer.add', name: '도곽'});
 const fr = engine.doc.layers.find(l => l.name === '도곽').id;
 engine.execute({type: 'batch', commands: [
  {type: 'add', entity: {id: 'FA', type: 'polyline', closed: true, layer: fr, points: G.rectangle(P(0, 0), P(42000, 29700))}},
  {type: 'add', entity: {id: 'TA', type: 'line', layer: fr, points: [P(30000, 0), P(30000, 5000)]}},
  {type: 'add', entity: {id: 'FB', type: 'polyline', closed: true, layer: fr, points: G.rectangle(P(60000, 0), P(81000, 14850))}},
  {type: 'add', entity: {id: 'W', type: 'line', layer: 'default', points: [P(2000, 2000), P(8000, 2000)]}},
 ]});
 const before = snapshot(engine), h = harness(engine);
 h.click(P(1000, 1000), P(61000, 1000));
 await h.cmds.CCV();
 assert.match(h.form().title, /그린 도곽 \(A3 1:100\) → 그린 도곽 \(A3 1:50\) · 객체 1개/);
 h.form().apply({});
 assert.equal(engine.doc.entities.length, before.length + 1);
 assert.deepEqual(engine.doc.entities.at(-1).points, [P(61000, 1000), P(64000, 1000)]);
 engine.execute({type: 'undo'});
 assert.deepEqual(engine.doc.entities, before);
});
