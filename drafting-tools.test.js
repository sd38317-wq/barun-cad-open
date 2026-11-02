// 훈민캐드 대조 작도 보조: QSELECT·ALIGN·LAYMCUR·ADDSELECTED·LAYRENAME·ENDMATCH·DENSITY.
import test from 'node:test';
import assert from 'node:assert/strict';
import {DrawingEngine} from './engine.js';
import {installDraftingTools, quickSelect, quickSelectWhere, alignTransform, matchEndpoints} from './drafting-tools.js';
import {hatchPatternFields} from './hatch-patterns.js';

const layers = () => [
 {id: 'L0', name: '0', color: '#ffffff', visible: true, locked: false},
 {id: 'LW', name: 'A-WALL', color: '#ffff00', visible: true, locked: false},
 {id: 'LH', name: 'HIDDEN', color: '#ff0000', visible: false, locked: false},
 {id: 'LK', name: 'LOCK', color: '#00ff00', visible: true, locked: true},
];
const line = (id, layer, a, b, extra = {}) => ({id, type: 'line', layer, points: [a, b], ...extra});
const drawing = () => ({version: 2, units: 'mm', layers: layers(), blocks: [], entities: [
 line('a', 'LW', {x: 0, y: 0}, {x: 100, y: 0}),
 line('b', 'LW', {x: 100.8, y: 0.4}, {x: 200, y: 0}, {color: '#ff0000', aci: 1, colorMode: 'aci'}),
 line('c', 'L0', {x: 0, y: 50}, {x: 100, y: 50}),
 line('d', 'LH', {x: 0, y: 90}, {x: 100, y: 90}),
 {id: 't1', type: 'text', layer: 'L0', position: {x: 0, y: 0}, text: '거실', height: 250, textStyle: 'Standard'},
 {id: 't2', type: 'text', layer: 'L0', position: {x: 0, y: 300}, text: '침실', height: 250, textStyle: 'ROMANS'},
 {id: 'h', type: 'hatch', layer: 'L0', points: [{x: 0, y: 0}, {x: 100, y: 0}, {x: 100, y: 100}], ...hatchPatternFields('ANSI31', {scale: 10})},
]});

test('QSELECT: 고른 조건이 모두 같은 객체만, 숨긴 레이어는 빼고 고른다', () => {
 const doc = drawing();
 const [a] = doc.entities;
 assert.deepEqual(quickSelect(doc.entities, doc.layers, a, ['type']).map(e => e.id), ['a', 'b', 'c']);
 assert.deepEqual(quickSelect(doc.entities, doc.layers, a, ['type', 'layer']).map(e => e.id), ['a', 'b']);
 assert.deepEqual(quickSelect(doc.entities, doc.layers, a, ['type', 'layer', 'color']).map(e => e.id), ['a']);
 const t1 = doc.entities.find(e => e.id === 't1');
 assert.deepEqual(quickSelect(doc.entities, doc.layers, t1, ['textStyle']).map(e => e.id), ['t1']);
 assert.deepEqual(quickSelect(doc.entities, doc.layers, t1, ['height']).map(e => e.id), ['t1', 't2']);
 assert.deepEqual(quickSelect(doc.entities, doc.layers, a, ['type'], new Set(['a', 'c', 't1'])).map(e => e.id), ['a', 'c']);
 assert.throws(() => quickSelect(doc.entities, doc.layers, a, []), /하나 이상/);
});

test('ALIGN 변환: 이동·회전·축척을 두 쌍에서 계산한다', () => {
 const t = alignTransform({x: 0, y: 0}, {x: 10, y: 10}, {x: 100, y: 0}, {x: 10, y: 210}, true);
 assert.equal(t.dx, 10);assert.equal(t.dy, 10);assert.ok(Math.abs(t.angle - 90) < 1e-9);assert.ok(Math.abs(t.factor - 2) < 1e-12);
 assert.throws(() => alignTransform({x: 0, y: 0}, {x: 0, y: 0}, {x: 0, y: 0}, {x: 1, y: 1}), /떨어져/);
});

test('ENDMATCH: 허용 거리 안의 끝점만 평균점으로 모은다', () => {
 const doc = drawing();
 const {changes, joined} = matchEndpoints(doc.entities.filter(e => ['a', 'b'].includes(e.id)), 1);
 assert.equal(joined, 1);
 const a = changes.find(c => c.id === 'a').points[1], b = changes.find(c => c.id === 'b').points[0];
 assert.deepEqual(a, b);assert.ok(Math.abs(a.x - 100.4) < 1e-9 && Math.abs(a.y - 0.2) < 1e-9);
 assert.equal(matchEndpoints(doc.entities.filter(e => ['a', 'b'].includes(e.id)), 0.5).joined, 0);
});

function harness({selected = [], answers = {}, picks = [], points = []} = {}) {
 const engine = new DrawingEngine();engine.doc = drawing();
 let active = 'L0', current = {color: null, linetype: null, linetypeScale: null, lineweight: null}, chosen = selected.slice();
 const toasts = [], runs = [];
 const ctx = {
  selected: () => engine.doc.entities.filter(e => chosen.includes(e.id)), selectedIds: () => chosen.slice(),
  setSelected: ids => { chosen = ids.slice(); }, entities: () => engine.doc.entities, layers: () => engine.doc.layers, doc: () => engine.doc,
  execute: c => engine.execute(c), toast: m => toasts.push(m), run: name => runs.push(name),
  form: (title, fields, onApply) => onApply({...Object.fromEntries(fields.map(f => [f.name, f.value])), ...answers}),
  pickEntity: async () => { const id = picks.shift(); return id ? engine.doc.entities.find(e => e.id === id) : null; },
  pickPoint: async () => points.shift() || null,
  activeLayer: () => active, setActiveLayer: id => { active = id; },
  getCurrentProperties: () => current, setCurrentProperties: v => { current = v; },
  afterCommand: fn => hooks.push(fn),
 };
 const hooks = [];
 return {engine, tools: installDraftingTools(ctx), toasts, runs, active: () => active, current: () => current, chosen: () => chosen, endCommand: () => hooks.splice(0).forEach(fn => fn())};
}

test('QSELECT 명령: 한 개 고른 객체를 기준으로 도면 전체에서 고른다', async () => {
 const h = harness({selected: ['a'], answers: {type: 'on', layer: 'on'}});
 await h.tools.QSELECT();
 assert.deepEqual(h.chosen(), ['a', 'b']);
});

test('ALIGN 명령: 네 점으로 옮기고 돌리며, 복사 옵션은 원본을 남기고 Ctrl+Z 한 번에 돌아간다', async () => {
 const h = harness({selected: ['c'], points: [{x: 0, y: 50}, {x: 500, y: 500}, {x: 100, y: 50}, {x: 500, y: 600}], answers: {copy: 'on'}});
 await h.tools.ALIGN();
 const c = h.engine.doc.entities.find(e => e.id === 'c');
 assert.deepEqual(c.points[0], {x: 0, y: 50}, '원본 그대로');
 const copy = h.engine.doc.entities.find(e => e.id === h.chosen()[0]);
 assert.ok(Math.abs(copy.points[0].x - 500) < 1e-9 && Math.abs(copy.points[0].y - 500) < 1e-9);
 assert.ok(Math.abs(copy.points[1].x - 500) < 1e-9 && Math.abs(copy.points[1].y - 600) < 1e-9);
});

test('LAYMCUR: 새 레이어를 색·선종류와 함께 만들어 현재로 삼고, 동결 레이어는 현재로 삼지 않는다', async () => {
 const h = harness({answers: {mode: 'new', name: 'A-FURN', color: '6', linetype: 'HIDDEN', lineweight: 0.18}});
 await h.tools.LAYMCUR();
 const layer = h.engine.doc.layers.find(l => l.name === 'A-FURN');
 assert.equal(layer.linetype, 'HIDDEN');assert.equal(layer.color, '#ff00ff');assert.equal(layer.aci, 6);assert.equal(layer.lineweight, 0.18);
 assert.equal(h.active(), layer.id);
 // AutoCAD 처럼 잠긴 레이어도 현재로 둘 수 있다(경고만). 동결 레이어는 막는다.
 const g = harness({answers: {mode: 'name', layer: 'LK'}});
 await g.tools.LAYMCUR();
 assert.equal(g.active(), 'LK');
 const f = harness({answers: {mode: 'name', layer: 'LK'}});
 f.engine.execute({type: 'layer.update', id: 'LK', changes: {frozen: true}});
 await assert.rejects(f.tools.LAYMCUR(), /동결/);
 const dup = harness({answers: {mode: 'new', name: 'a-wall'}});
 await assert.rejects(dup.tools.LAYMCUR(), /이미 있습니다/);
});

test('LAYRENAME·ADDSELECTED: 객체로 레이어 이름을 바꾸고, 같은 형식 작도를 준비한다', async () => {
 const h = harness({picks: ['a'], answers: {name: 'A-WALL-NEW'}});
 await h.tools.LAYRENAME();
 assert.ok(h.engine.doc.layers.some(l => l.name === 'A-WALL-NEW'));
 const g = harness({selected: ['b']});
 await g.tools.ADDSELECTED();
 assert.deepEqual(g.runs, ['LINE']);assert.equal(g.active(), 'LW');assert.equal(g.current().color.aci, 1);
 g.endCommand();   // 명령이 끝나면 원래 현재 레이어·특성으로 (검토 11)
 assert.equal(g.active(), 'L0');assert.equal(g.current().color, null);
});

test('DENSITY: 선종류 축척과 해치 밀도를 배수로 함께 바꾼다', async () => {
 const h = harness({selected: ['a', 'h'], answers: {mode: 'multiply', factor: 2}});
 await h.tools.DENSITY();
 assert.equal(h.engine.doc.entities.find(e => e.id === 'a').linetypeScale, 2);
 assert.equal(h.engine.doc.entities.find(e => e.id === 'h').patternScale, 20);
 h.engine.execute({type: 'undo'});
 assert.equal(h.engine.doc.entities.find(e => e.id === 'h').patternScale, 10);
});

test('ENDMATCH: 짧은 선은 점으로 줄지 않고, 줄줄이 이어진 끝점이 허용 거리 넘게 끌려가지 않음 (검토 8)', () => {
 const line = (id, a, b) => ({id, type: 'line', layer: 'default', points: [a, b]});
 // 2mm 선의 양 끝이 각각 다른 선 끝과 가깝다 → 짧은 선은 남고 이웃 끝과만 모인다
 const r1 = matchEndpoints([line('L', {x: -1000, y: 0}, {x: 0, y: 0}), line('S', {x: 1, y: 0}, {x: 3, y: 0}), line('R', {x: 4, y: 0}, {x: 1000, y: 0})], 5);
 for (const c of r1.changes) assert.ok(Math.hypot(c.points[1].x - c.points[0].x, c.points[1].y - c.points[0].y) > 0.5, c.id);
 // 0·4·8·12 줄: 한 점으로 모이면 6mm 이동 — 무리 지름이 허용 거리를 넘지 않게
 const chain = [0, 4, 8, 12].map((x, i) => line('c' + i, {x, y: 0}, {x, y: 1000 + i}));
 const {changes} = matchEndpoints(chain, 5);
 for (const c of changes) {
  const before = chain.find(e => e.id === c.id).points[0];
  assert.ok(Math.hypot(c.points[0].x - before.x, c.points[0].y - before.y) <= 2.5 + 1e-9, `${c.id} 이동 ${c.points[0].x - before.x}`);
 }
});

test('QSELECT 조건식: 높이 크기 비교·레이어 와일드카드·색 번호·제외·더하기 (검토 12)', async () => {
 const doc = drawing();
 const ids = (list) => list.map(e => e.id).sort();
 doc.entities.find(e => e.id === 't2').height = 400;
 assert.deepEqual(ids(quickSelectWhere(doc.entities, doc.layers, {key: 'height', operator: '>', value: '300'})), ['t2']);
 assert.deepEqual(ids(quickSelectWhere(doc.entities, doc.layers, {key: 'layer', operator: 'like', value: 'a-*'})), ['a', 'b']);
 assert.deepEqual(ids(quickSelectWhere(doc.entities, doc.layers, {key: 'color', operator: '=', value: '1'})), ['b']);
 assert.ok(!ids(quickSelectWhere(doc.entities, doc.layers, {key: 'type', operator: '=', value: 'line'}, {mode: 'exclude'})).includes('a'));
 assert.deepEqual(ids(quickSelectWhere(doc.entities, doc.layers, {key: 'height', operator: '>=', value: '400'}, {mode: 'append', current: ['a']})), ['a', 't2']);
 assert.ok(!ids(quickSelectWhere(doc.entities, doc.layers, {key: 'type', operator: '=', value: 'line'})).includes('d'), '숨긴 레이어 제외');
 assert.throws(() => quickSelectWhere(doc.entities, doc.layers, {key: 'layer', operator: '>', value: 'A'}), /문자 높이에만/);
 const h = harness({answers: {how: 'where', whereKey: 'textStyle', whereOp: '=', whereValue: 'romans'}});
 await h.tools.QSELECT();
 assert.deepEqual(h.chosen(), ['t2']);
});
