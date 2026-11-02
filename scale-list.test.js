import test from 'node:test';
import assert from 'node:assert/strict';
import {DrawingEngine} from './engine.js';
import {KOREAN_ARCH_SCALES, scaleKey, parseScale, defaultScaleList, normalizeScaleList, addScaleToList, purgeUnusedScales, removeScalesFromList, resetScaleList, usedScaleKeys, scaleFromDxf, scaleListToDxf} from './scale-list.js';
import {installAnnotationScale} from './annotation-scale.js';

test('511 기본 목록: 한국 건축 축척 15개, 비율 순', () => {
 const list = defaultScaleList();
 assert.deepEqual(list.map(s => s.name), KOREAN_ARCH_SCALES.map(d => `1:${d}`));
 for (const name of ['1:1', '1:60', '1:200', '1:300', '1:500', '1:600', '1:1200']) assert.ok(list.some(s => s.name === name), name);
 assert.deepEqual(normalizeScaleList({}), list, '목록이 없는 도면은 기본 목록');
 assert.deepEqual(normalizeScaleList({scaleList: []}), list);
});

test('511 축척 키·읽기: 1:100 · 2:1 · 1/50 · 숫자', () => {
 assert.equal(scaleKey(100), '1:100');assert.equal(scaleKey(0.5), '2:1');assert.equal(scaleKey(0), null);
 assert.equal(parseScale('1:100'), 100);assert.equal(parseScale('1/50'), 50);assert.equal(parseScale('2:1'), 0.5);assert.equal(parseScale(' 250 '), 250);
 assert.equal(parseScale('abc'), null);assert.equal(parseScale('0:1'), null);assert.equal(parseScale(''), null);
});

test('511 정리: 잘못된 값·이름 중복·비율 중복을 지우고 정렬', () => {
 const list = normalizeScaleList([
  {name: '1:100', paper: 1, drawing: 100}, {name: '1:50', paper: 1, drawing: 50}, {name: 'x', paper: 0, drawing: 5},
  {name: '1:100', paper: 1, drawing: 200}, {name: '백분의 일', paper: 2, drawing: 200}, {name: '', paper: 2, drawing: 1}, {name: 'NaN', paper: 'a', drawing: 1},
 ]);
 assert.deepEqual(list.map(s => s.name), ['2:1', '1:50', '1:100']);
});

test('511 더하기·지우기·안 쓰는 축척 지우기·초기화: 쓰는 축척은 지킨다', () => {
 const doc = {scaleList: defaultScaleList(), currentAnnoScale: 30, sheets: [{id: 'S', denominator: 200, annotationScale: 150}],
  entities: [{id: 't', type: 'text', annotative: true, scales: {'1:60': {}, '1:600': {}}, annoScale: 60}]};
 const added = addScaleToList(doc, 250, '1:250 배치');
 assert.ok(added.some(s => s.name === '1:250 배치' && s.drawing === 250));
 assert.equal(addScaleToList(doc, 100).length, 15, '이미 있는 비율은 그대로');
 assert.throws(() => addScaleToList(doc, -1));
 assert.deepEqual([...usedScaleKeys(doc)].sort(), ['1:1', '1:150', '1:200', '1:30', '1:60', '1:600'].sort());
 const removed = removeScalesFromList(doc, [5, 60]);
 assert.deepEqual(removed.removed.map(s => s.name), ['1:5']);assert.deepEqual(removed.blocked.map(s => s.name), ['1:60']);
 const purged = purgeUnusedScales(doc);
 assert.deepEqual(purged.list.map(s => s.name), ['1:1', '1:30', '1:60', '1:150', '1:200', '1:600']);
 const custom = {...doc, scaleList: [{name: '1:250', paper: 1, drawing: 250}, {name: '1:30', paper: 1, drawing: 30}], currentAnnoScale: 250};
 const reset = resetScaleList(custom);
 assert.equal(reset.length, 16, '기본 15개 + 쓰는 중인 1:250');assert.ok(reset.some(s => s.name === '1:250'));
});

test('511 DXF ACAD_SCALELIST 변환: 읽기·쓰기 왕복, 단위 축척 플래그 보존', () => {
 const entries = [{300: '1:1', 140: '1.0', 141: '1.0', 290: '1'}, {300: '1:100', 140: 1, 141: 100, 290: 0}, {300: '2:1', 140: 2, 141: 1}, {300: '잘못', 140: 0, 141: 1}, {300: '1:100', 140: 1, 141: 100}];
 const list = scaleFromDxf(entries);
 assert.deepEqual(list, [{name: '2:1', paper: 2, drawing: 1}, {name: '1:1', paper: 1, drawing: 1, unit: true}, {name: '1:100', paper: 1, drawing: 100}]);
 const out = scaleListToDxf(list);
 assert.deepEqual(out[0], {key: 'A0', 300: '2:1', 140: 2, 141: 1, 290: 0});
 assert.equal(out[1][290], 1);
 assert.deepEqual(scaleFromDxf(out), list, '왕복');
 assert.deepEqual(scaleFromDxf([]), []);
 assert.equal(scaleListToDxf(defaultScaleList())[10].key, 'B0');
});

test('511 도면에 저장: document.update 로 넣고 되돌리기·저장(JSON)·다시 열기에도 남는다', () => {
 const engine = new DrawingEngine();
 const list = addScaleToList(engine.doc, 250);
 engine.execute({type: 'document.update', changes: {scaleList: list, currentAnnoScale: 250}});
 assert.equal(engine.doc.scaleList.length, 16);assert.equal(engine.doc.currentAnnoScale, 250);
 const saved = JSON.parse(JSON.stringify(engine.doc));
 const reopened = new DrawingEngine();reopened.execute({type: 'load', document: saved});
 assert.deepEqual(reopened.doc.scaleList, list);assert.equal(reopened.doc.currentAnnoScale, 250);
 reopened.execute({type: 'add', entity: {id: 'x', type: 'line', layer: 'default', points: [{x: 0, y: 0}, {x: 1, y: 0}]}});
 assert.deepEqual(reopened.doc.scaleList, list, '다른 편집 뒤에도 그대로');
 engine.execute({type: 'undo'});
 assert.equal(engine.doc.scaleList, undefined);
});

function harness(engine) {
 const toasts = [];let pending = null, fields = null;
 const ctx = {doc: () => engine.doc, entities: () => engine.doc.entities, layers: () => engine.doc.layers, selected: () => [], execute: (c) => engine.execute(c), toast: (m) => toasts.push(m), getSettings: () => ({denominator: 100}),
  form: (title, f, onApply) => { fields = f;pending = (values) => onApply({...Object.fromEntries(f.map(x => [x.name, x.value])), ...values});return f; }};
 return {toasts, cmds: installAnnotationScale(ctx), apply: (v) => pending(v), fields: () => fields};
}

test('511 SCALELISTEDIT: 더하기·지우기·안 쓰는 것 지우기·초기화', () => {
 const engine = new DrawingEngine(), h = harness(engine);
 h.cmds.SCALELISTEDIT();
 assert.match(h.fields().find(f => f.name === 'list').value, /1:1200/);
 h.apply({action: 'add', scale: '1:250', name: ''});
 assert.ok(engine.doc.scaleList.some(s => s.name === '1:250'));
 h.cmds.SCALELISTEDIT();h.apply({action: 'remove', scale: '1:250, 1:5'});
 assert.ok(!engine.doc.scaleList.some(s => s.name === '1:250' || s.name === '1:5'));
 h.cmds.SCALELISTEDIT();assert.throws(() => h.apply({action: 'remove', scale: '1:1'}), /쓰고 있어/);
 h.cmds.SCALELISTEDIT();h.apply({action: 'purge'});
 assert.deepEqual(engine.doc.scaleList.map(s => s.name), ['1:1']);
 h.cmds.SCALELISTEDIT();h.apply({action: 'reset'});
 assert.equal(engine.doc.scaleList.length, 15);
 engine.execute({type: 'undo'});assert.deepEqual(engine.doc.scaleList.map(s => s.name), ['1:1']);
});
