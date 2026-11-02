import test from 'node:test';
import assert from 'node:assert/strict';
import {DrawingEngine} from './engine.js';
import {parseSpacingList, gridLabel, gridEntities, bubblesForLines, installGridTools} from './grid-tools.js';

test('간격 목록: 반복 표기와 잘못된 입력', () => {
 assert.deepEqual(parseSpacingList('3000, 3600*2 3000'), [3000, 3600, 3600, 3000]);
 assert.deepEqual(parseSpacingList('2100x3'), [2100, 2100, 2100]);
 assert.deepEqual(parseSpacingList(''), []);
 assert.throws(() => parseSpacingList('3000,abc'));
 assert.throws(() => parseSpacingList('0'));
 assert.throws(() => parseSpacingList('100*101'));
});

test('축 번호: 숫자·영문(I·O 제외)·접두', () => {
 assert.equal(gridLabel(0, 'number'), '1');
 assert.equal(gridLabel(7, 'letter'), 'H');
 assert.equal(gridLabel(8, 'letter'), 'J', 'I 는 건너뜀');
 assert.equal(gridLabel(23, 'letter'), 'Z');
 assert.equal(gridLabel(24, 'letter'), 'AA');
 assert.equal(gridLabel(0, 'X', 3), 'X3');
});

test('그리드: 간격이 다른 축선·양끝 기호·치수', () => {
 const g = gridEntities({base: {x: 1000, y: 2000}, xs: [3000, 3600], ys: [6000], scale: 100});
 assert.deepEqual(g.xPos, [1000, 4000, 7600]);
 assert.deepEqual(g.yPos, [2000, 8000]);
 assert.equal(g.lines.length, 5);
 const x2 = g.lines.find(l => l.gridAxis.dir === 'x' && l.gridAxis.label === '2');
 assert.equal(x2.points[0].x, 4000);
 assert.equal(x2.points[0].y, 2000 - 1000, '연장 = 10mm×100');
 assert.equal(g.marks.length, 10);
 assert.ok(g.marks.every(m => m.type === 'block' && m.annotative === true), '기호는 주석 블록');
 const c = g.marks[0].entities.find(e => e.type === 'circle');
 assert.equal(c.radius, 400, '지름 8mm × 1:100');
 assert.deepEqual(g.marks[0].position, c.center);
 assert.equal(g.marks[0].entities.find(e => e.type === 'text').height, 350);
 assert.deepEqual(g.marks.map(m => m.gridBubble).sort(), ['1', '1', '2', '2', '3', '3', 'A', 'A', 'B', 'B']);
 // 축 사이 2 + 전체 1 (X), 축 사이 1 (Y)
 assert.equal(g.dims.filter(d => d.mode === 'horizontal').length, 3);
 assert.equal(g.dims.filter(d => d.mode === 'vertical').length, 1);
 const none = gridEntities({xs: [3000], ys: [], ends: 'start', dimensions: false});
 assert.equal(none.dims.length, 0);
 assert.equal(none.marks.length, 2);
 assert.throws(() => gridEntities({xs: [], ys: []}));
});

test('GRIDBUBBLE: 선 위치 순서대로 번호, 끝 밖으로 기호', () => {
 const lines = [
  {type: 'line', points: [{x: 5000, y: 0}, {x: 5000, y: 9000}]},
  {type: 'line', points: [{x: 0, y: 9000}, {x: 0, y: 0}]},
  {type: 'line', points: [{x: -500, y: 3000}, {x: 5500, y: 3000}]},
 ];
 const {marks, count} = bubblesForLines(lines, {scale: 50, ends: 'start'});
 assert.equal(count, 3);
 const texts = marks.map(m => m.entities.find(e => e.type === 'text'));
 const circles = marks.map(m => m.entities.find(e => e.type === 'circle'));
 assert.equal(texts.find(t => t.text === '1').position.x, 0);
 assert.equal(texts.find(t => t.text === '2').position.x, 5000);
 assert.deepEqual(circles[0].center, {x: 0, y: -200}, '아래 끝 밖으로 반지름만큼');
 assert.deepEqual(circles[2].center, {x: -700, y: 3000});
});

test('GRIDLINE 명령: 그리드·기호 레이어로 그리고 되돌리기 한 번', async () => {
 const engine = new DrawingEngine();
 const ensureLayer = (name) => { const f = engine.doc.layers.find(l => l.name === name); if (f) return f.id; engine.execute({type: 'layer.add', name}); return engine.doc.layers.find(l => l.name === name).id; };
 let pending;const toasts = [];
 const cmds = installGridTools({layers: () => engine.doc.layers, ensureLayer, execute: (c) => engine.execute(c), toast: (m) => toasts.push(m), selected: () => [],
  getSettings: () => ({denominator: 100}), pickPoint: async () => ({x: 0, y: 0}),
  form: (t, fields, apply) => { pending = (v) => apply({...Object.fromEntries(fields.map(f => [f.name, f.value])), ...v}); }});
 cmds.GRIDLINE();
 engine.beginTransaction();   // app.js cardFormApply 처럼 한 번의 적용 = 한 묶음
 await pending({xs: '3000,3600', ys: '6000'});
 engine.endTransaction();
 const axis = engine.doc.layers.find(l => l.name === '그리드');
 assert.equal(axis.linetype, 'CENTER');
 const count = engine.doc.entities.length;
 assert.equal(engine.doc.entities.filter(e => e.layer === axis.id).length, 5);
 assert.equal(count, 19, '축 5 + 기호 블록 10 + 치수 4');
 engine.execute({type: 'undo'});
 assert.equal(engine.doc.entities.length, 0);
 assert.ok(!engine.doc.layers.some(l => ['그리드', '그리드-기호', '치수'].includes(l.name)), '되돌리기 한 번에 새 레이어까지 사라짐');
 assert.throws(() => cmds.GRIDBUBBLE());
});

test('GRIDLINE: 쓰지 않는 레이어는 만들지도 검사하지도 않음, 잠긴 레이어면 아무것도 남기지 않음 (검토 9)', async () => {
 const engine = new DrawingEngine();
 engine.execute({type: 'layer.add', name: '치수'});
 const dimLayer = engine.doc.layers.find(l => l.name === '치수');
 engine.execute({type: 'layer.update', id: dimLayer.id, changes: {locked: true}});
 const ensureLayer = (name) => { const f = engine.doc.layers.find(l => l.name === name); if (f) return f.id; engine.execute({type: 'layer.add', name}); return engine.doc.layers.find(l => l.name === name).id; };
 let pending;
 const cmds = installGridTools({layers: () => engine.doc.layers, ensureLayer, execute: (c) => engine.execute(c), toast: () => {}, selected: () => [],
  getSettings: () => ({denominator: 100}), pickPoint: async () => ({x: 0, y: 0}),
  form: (t, fields, apply) => { pending = (v) => apply({...Object.fromEntries(fields.map(f => [f.name, f.value])), ...v}); }});
 cmds.GRIDLINE();
 await pending({xs: '3000', ys: '', dimensions: false, ends: 'none'});
 assert.equal(engine.doc.entities.length, 2, '치수 끔 → 잠긴 치수 레이어와 상관없이 그려짐');
 assert.ok(!engine.doc.layers.some(l => l.name === '그리드-기호'), '기호 없음 → 기호 레이어 안 만듦');
 const layerCount = engine.doc.layers.length;
 cmds.GRIDLINE();
 await assert.rejects(() => pending({xs: '3000', ys: '6000', dimensions: true}), /치수.*잠김/);
 assert.equal(engine.doc.layers.length, layerCount, '실패하면 새 레이어가 남지 않음');
 await assert.rejects(() => { cmds.GRIDLINE(); return pending({xs: '3,600'}); }, /천 단위 쉼표/);
});
