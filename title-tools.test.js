import test from 'node:test';
import assert from 'node:assert/strict';
import {DrawingEngine} from './engine.js';
import * as G from './geometry.js';
import {estimateTextWidth, scaleLabel, sheetAt, titleScaleAt, titleBlock, titleResizeStep, resizeTitleCommands, cursorPreview, installTitleTools, TITLE_BLOCK_NAME} from './title-tools.js';

const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-6, `${msg || ''} ${a} ≠ ${b}`);
const role = (block, r) => block.entities.find(e => e.titleRole === r);

test('문자 폭 어림: 한글 1.0×h, 영문·숫자 0.6×h, 여러 줄은 가장 긴 줄', () => {
 near(estimateTextWidth('평면도', 10), 30);
 near(estimateTextWidth('SCALE', 10), 30);
 near(estimateTextWidth('1층 평면도', 10), 52);
 near(estimateTextWidth('AB\n가나다', 10), 30);
 near(estimateTextWidth('900×300', 10), 46, '× 는 한글 글꼴에서 전각');
 assert.equal(estimateTextWidth('', 10), 0);
});

test('축척 부제 형식', () => {
 assert.equal(scaleLabel('scale', 100), 'SCALE 1:100');
 assert.equal(scaleLabel('slash', 50), 'S : 1/50');
 assert.equal(scaleLabel('none', 50), '');
 assert.equal(scaleLabel('scale', 1.5), 'SCALE 1:1.5');
 assert.throws(() => scaleLabel('scale', 0));
 assert.throws(() => scaleLabel('bad', 100));
});

test('제목 블록 1:100: 제목 용지 5mm·축척 3mm, 축척 문자는 제목 길이 바로 뒤, 이중 밑줄', () => {
 const b = titleBlock({title: '1층 평면도', scale: 100, position: {x: 1000, y: 2000}});
 assert.equal(b.type, 'block');
 assert.equal(b.name, TITLE_BLOCK_NAME);
 assert.deepEqual(b.attributes, {title: '1층 평면도', scale: 100, paperHeight: 5, style: 'scale', number: ''});
 assert.deepEqual(b.position, {x: 1000, y: 2000});
 const title = role(b, 'title'), sub = role(b, 'scale');
 assert.equal(title.height, 500);
 assert.equal(sub.height, 300);
 assert.equal(sub.text, 'SCALE 1:100');
 assert.equal(title.position.x, 1000);
 assert.equal(title.position.y, sub.position.y, '같은 기준선');
 near(title.position.y, 2000 + 180, '밑줄 위 1.8mm × 100');
 near(sub.position.x, 1000 + estimateTextWidth('1층 평면도', 500) + 400, '제목 폭 + 4mm');
 const thick = role(b, 'underline'), thin = role(b, 'underline2');
 assert.equal(thick.type, 'polyline');
 near(thick.constantWidth, 60);
 assert.deepEqual(thick.points[0], {x: 1000, y: 2000});
 near(thin.points[0].y, 2000 - 120);
 const end = sub.position.x + estimateTextWidth('SCALE 1:100', 300);
 assert.ok(thick.points[1].x > end, '밑줄이 축척 문자 끝까지');
 near(thick.points[1].x, thin.points[1].x);
 // 실제 엔진 검사 통과
 const engine = new DrawingEngine();
 engine.execute({type: 'add', entity: b});
 assert.equal(engine.doc.entities[0].entities.length, 4);
});

test('제목 블록 1:50 · S : 1/50 · 도면 번호 원 기호', () => {
 const b = titleBlock({title: 'A-A 단면도', scale: 50, style: 'slash', number: '1/A-101'});
 assert.equal(role(b, 'title').height, 250);
 assert.equal(role(b, 'scale').height, 150);
 assert.equal(role(b, 'scale').text, 'S : 1/50');
 const circle = b.entities.find(e => e.type === 'circle');
 near(circle.radius, 300, '지름 12mm × 1:50');
 assert.ok(circle.center.x < 0, '원은 삽입점 왼쪽');
 assert.equal(role(b, 'number').text, '1');
 assert.equal(role(b, 'sheet').text, 'A-101');
 const single = titleBlock({title: '배치도', scale: 200, style: 'none', number: '3'});
 assert.equal(role(single, 'scale'), undefined, '축척 문자 없음');
 assert.equal(role(single, 'number').height, 800);
 // 용지 높이 6mm 로 넣으면 모든 크기가 6/5 배
 const big = titleBlock({title: '배치도', scale: 100, paperHeight: 6});
 assert.equal(role(big, 'title').height, 600);
 near(role(big, 'scale').height, 360);
 const engine = new DrawingEngine();
 engine.execute({type: 'addMany', entities: [b, single, big]});
 assert.equal(engine.doc.entities.length, 3);
});

test('제목 블록: 잘못된 입력 거부', () => {
 assert.throws(() => titleBlock({title: '  ', scale: 100}), /제목/);
 assert.throws(() => titleBlock({title: '평면도', scale: 0}), /축척/);
 assert.throws(() => titleBlock({title: '평면도', scale: 100, paperHeight: 0.1}), /높이/);
 assert.throws(() => titleBlock({title: '평면도', scale: 100, style: 'x'}), /형식/);
 assert.throws(() => titleBlock({title: '평면도', scale: 100, position: {x: NaN, y: 0}}), /위치/);
});

test('축척 기본값: 점이 든 도곽 축척(겹치면 작은 도곽), 도곽 밖이면 기본 축척', () => {
 const doc = {sheets: [
  {id: 'A', denominator: 100, bounds: {minX: 0, minY: 0, maxX: 42000, maxY: 29700}},
  {id: 'B', denominator: 50, bounds: {minX: 1000, minY: 1000, maxX: 5000, maxY: 5000}},
 ]};
 assert.equal(titleScaleAt(doc, {x: 20000, y: 20000}, 200), 100);
 assert.equal(titleScaleAt(doc, {x: 2000, y: 2000}, 200), 50);
 assert.equal(sheetAt(doc.sheets, {x: 2000, y: 2000}).id, 'B');
 assert.equal(titleScaleAt(doc, {x: -5, y: 0}, 200), 200);
 assert.equal(titleScaleAt({}, {x: 0, y: 0}, 0), 100);
 assert.equal(sheetAt(doc.sheets, null), null);
});

test('크기 조정 단계: 처음 크기 기준 ±, 처음으로, 한계', () => {
 assert.equal(titleResizeStep(5, 5, 'up', 10), 5.5);
 assert.equal(titleResizeStep(5.5, 5, 'down', 10), 5);
 assert.equal(titleResizeStep(7, 5, 'reset'), 5);
 assert.equal(titleResizeStep(5, 5, 'up', 20), 6);
 assert.throws(() => titleResizeStep(0.5, 5, 'down', 10), /작게/);
 assert.throws(() => titleResizeStep(5, 5, 'up', 0));
 assert.throws(() => titleResizeStep(5, 5, 'sideways', 10));
});

test('크기 조정: 실제 엔진에서 삽입점 기준으로 커지고 되돌리기로 원래대로', () => {
 const engine = new DrawingEngine();
 engine.execute({type: 'add', entity: titleBlock({title: '1층 평면도', scale: 100, position: {x: 1000, y: 2000}})});
 const placed = () => engine.doc.entities[0];
 const before = structuredClone(placed());
 engine.execute({type: 'batch', commands: resizeTitleCommands(placed(), 5.5)});
 const b = placed();
 assert.equal(b.id, before.id);
 near(role(b, 'title').height, 550);
 near(role(b, 'scale').height, 330);
 near(role(b, 'underline').constantWidth, 66);
 assert.deepEqual(b.position, {x: 1000, y: 2000}, '삽입점 제자리');
 assert.equal(b.attributes.paperHeight, 5.5);
 assert.equal(b.attributes.title, '1층 평면도');
 near(role(b, 'scale').position.x - 1000, (role(before, 'scale').position.x - 1000) * 1.1, '제목 뒤 축척 문자도 비례');
 engine.execute({type: 'undo'});
 assert.equal(placed().attributes.paperHeight, 5);
 near(role(placed(), 'title').height, 500);
 assert.throws(() => resizeTitleCommands(null, 5));
});

/* 앱의 카드 문맥을 흉내 낸다: 폼 [적용]은 되돌리기 묶음(transaction)으로 감싸고(app.js cardFormApply 와 같은 순서),
   Esc 는 묶음을 닫고 onCancel 을 부른다. */
function harness(engine, {picks = [], settings = {denominator: 100}} = {}) {
 const forms = [], toasts = [], store = new Map(), h = {forms, toasts, previews: []};
 const wrap = (onApply) => (values) => {
  engine.beginTransaction();
  let result;
  try { result = onApply(values); } catch (e) { engine.endTransaction(); throw e; }
  if (!(result && typeof result.then === 'function')) { engine.endTransaction(); return result; }
  return result.then(v => { engine.endTransaction(); return v; }, e => { engine.endTransaction(); throw e; });
 };
 const ensureLayer = (name, color) => { const f = engine.doc.layers.find(l => l.name === name); if (f) return f.id; engine.execute({type: 'layer.add', name, color}); return engine.doc.layers.find(l => l.name === name).id; };
 h.ctx = {
  storage: {getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, v)},
  doc: () => engine.doc, entities: () => engine.doc.entities, layers: () => engine.doc.layers, ensureLayer,
  getSettings: () => settings, toast: m => toasts.push(m), refresh() {},
  execute: c => engine.execute(c),
  commit: ({entities}) => engine.execute({type: 'batch', commands: [{type: 'addMany', entities: entities.map(e => ({...e, layer: e.layer || 'default'}))}]}),
  pickPoint: async (opts) => { h.previews.push(opts?.preview); return picks.shift() ?? null; },
  form: (title, fields, onApply, onCancel) => {
   const apply = wrap(onApply);
   forms.push({title, fields, apply: (v = {}) => apply({...Object.fromEntries(fields.map(f => [f.name, f.value])), ...v}), cancel: () => { if (engine.inTransaction()) engine.closeTransaction(); onCancel?.(); }});
   return fields;
  },
 };
 return h;
}
const until = async (cond) => { for (let i = 0; i < 100 && !cond(); i++) await new Promise(r => setImmediate(r)); assert.ok(cond(), '기다린 상태가 오지 않음'); };

test('TITLE: 도곽 축척 자동, 넣기 + 크기 조정 여러 번이 되돌리기 한 번', async () => {
 const engine = new DrawingEngine();
 engine.execute({type: 'document.update', changes: {sheets: [{id: 'S1', number: 'A-101', title: '평면', paper: 'A3', denominator: 50, bounds: {minX: 0, minY: 0, maxX: 21000, maxY: 14850}}]}});
 const h = harness(engine, {picks: [{x: 3000, y: 1000}]});
 installTitleTools(h.ctx).TITLE();
 const undoBefore = engine.undoStack.length;
 const placing = h.forms[0].apply({title: '1층 평면도'});
 await until(() => h.forms.length === 2);
 // 미리보기도 찍는 자리의 도곽 축척을 따른다
 const preview = h.previews[0];
 assert.equal(preview([], {x: 3000, y: 1000}).find(e => e.titleRole === 'title').height, 250, '도곽 안 1:50');
 assert.equal(preview({x: -99999, y: 0}).find(e => e.titleRole === 'title').height, 500, '도곽 밖 기본 1:100');
 const block = () => engine.doc.entities.find(e => e.name === TITLE_BLOCK_NAME);
 assert.equal(block().attributes.scale, 50);
 assert.equal(role(block(), 'title').height, 250);
 assert.equal(role(block(), 'scale').text, 'SCALE 1:50');
 h.forms[1].apply({action: 'up', step: 10});
 h.forms[2].apply({action: 'up'});
 h.forms[3].apply({action: 'down'});
 assert.equal(h.forms.length, 5);
 assert.match(h.forms[4].title, /5\.5 mm/);
 h.forms[4].apply({action: 'done'});
 await placing;
 assert.equal(block().attributes.paperHeight, 5.5);
 near(role(block(), 'title').height, 275);
 assert.deepEqual(block().position, {x: 3000, y: 1000});
 assert.equal(engine.inTransaction(), false);
 assert.equal(engine.undoStack.length, undoBefore + 1, '넣기와 크기 조정 전체가 한 단계');
 assert.ok(engine.doc.layers.some(l => l.name === 'A-SYM'));
 assert.equal(block().layer, engine.doc.layers.find(l => l.name === 'A-SYM').id);
 engine.execute({type: 'undo'});
 assert.equal(engine.doc.entities.length, 0);
 assert.ok(!engine.doc.layers.some(l => l.name === 'A-SYM'), '같은 단계에서 만든 레이어도 함께');
});

test('TITLE: 직접 입력한 축척이 도곽 축척보다 우선, Esc 로 크기 조정을 닫아도 한 단계', async () => {
 const engine = new DrawingEngine();
 engine.execute({type: 'document.update', changes: {sheets: [{id: 'S1', denominator: 50, bounds: {minX: 0, minY: 0, maxX: 21000, maxY: 14850}}]}});
 const h = harness(engine, {picks: [{x: 3000, y: 1000}]});
 installTitleTools(h.ctx).TITLE();
 const undoBefore = engine.undoStack.length;
 const placing = h.forms[0].apply({title: '배치도', scale: 200, style: 'slash', number: '2'});
 await until(() => h.forms.length === 2);
 h.forms[1].apply({action: 'down', step: 20});
 h.forms[2].cancel();
 await placing;
 const b = engine.doc.entities[0];
 assert.equal(b.attributes.scale, 200);
 assert.equal(b.attributes.paperHeight, 4);
 near(role(b, 'title').height, 800);
 assert.equal(role(b, 'scale').text, 'S : 1/200');
 assert.equal(engine.undoStack.length, undoBefore + 1);
 engine.execute({type: 'undo'});
 assert.equal(engine.doc.entities.length, 0);
});

test('TITLE: 크기 조정 끄기, 점 취소, 잘못된 입력', async () => {
 const engine = new DrawingEngine();
 const h = harness(engine, {picks: [{x: 0, y: 0}, null]});
 const cmds = installTitleTools(h.ctx);
 cmds.TITLE();
 await h.forms[0].apply({title: '지붕 평면도', resize: false});
 assert.equal(h.forms.length, 1, '크기 조정 창 없음');
 assert.equal(engine.doc.entities.length, 1);
 assert.equal(engine.doc.entities[0].attributes.scale, 100, '도곽이 없으면 기본 축척');
 cmds.TITLE();
 assert.equal(h.forms[1].fields.find(f => f.name === 'title').value, '지붕 평면도', '마지막 제목 기억');
 await h.forms[1].apply({title: '입면도'});
 assert.equal(engine.doc.entities.length, 1, 'Esc 로 점을 취소하면 아무것도 넣지 않음');
 cmds.TITLE();
 await assert.rejects(() => h.forms[2].apply({title: ''}), /제목/);
 await assert.rejects(() => h.forms[2].apply({title: '입면도', scale: -1}), /축척/);
 await assert.rejects(() => h.forms[2].apply({title: '입면도', paperHeight: 0}), /높이/);
 assert.equal(engine.inTransaction(), false);
});

test('미리보기 콜백: 앱 (점 목록, 커서) · 시험 (커서) 둘 다', () => {
 const fn = cursorPreview(c => [{type: 'point', position: c}]);
 assert.deepEqual(fn([], {x: 1, y: 2})[0].position, {x: 1, y: 2});
 assert.deepEqual(fn({x: 3, y: 4})[0].position, {x: 3, y: 4});
 assert.deepEqual(fn([], null), []);
 assert.deepEqual(cursorPreview(() => { throw Error('x'); })({x: 0, y: 0}), []);
 const b = titleBlock({title: '평면도', scale: 100});
 assert.ok(G.bounds([b]).maxX > 0);
});
