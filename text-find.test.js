// 522 찾기·바꾸기 공급자(text-find.js)와 그것을 쓰는 FINDREPLACE(workflows.js)·CTX·FAR(text-edit-tools-4.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import {DrawingEngine} from './engine.js';
import {findMatcher, matchOptions, textSlots, findAll, planSlotEdits, slotChanges, lockedBy, literalReplacer, slotBounds, slotLabel} from './text-find.js';
import {buildTableBlock} from './table-sheet-tools-4.js';
import {installTextEditTools4} from './text-edit-tools-4.js';
import {installWorkflows} from './workflows.js';
import {defaults} from './studio.js';

const P = (x, y) => ({x, y});
const text = (id, t, over = {}) => ({id, type: 'text', layer: 'default', position: P(0, 0), height: 100, text: t, ...over});

test('findMatcher: 대소문자·단어 단위·와일드카드, 정규식 기호는 글자로', () => {
 const hit = (re, s) => { re.lastIndex = 0; return (s.match(re) || []); };
 assert.deepEqual(hit(findMatcher('Wall'), 'wall WALL Wall'), ['wall', 'WALL', 'Wall']);
 assert.deepEqual(hit(findMatcher('Wall', {matchCase: true}), 'wall WALL Wall'), ['Wall']);
 assert.deepEqual(hit(findMatcher('벽', {wholeWord: true}), '벽 벽체 내벽 벽'), ['벽', '벽']);
 assert.deepEqual(hit(findMatcher('A*B', {wildcard: true}), 'A1B A22B'), ['A1B', 'A22B'], '* 는 게으르게(따로따로)');
 assert.deepEqual(hit(findMatcher('THK?', {wildcard: true}), 'THK9 THK24'), ['THK9', 'THK2']);
 assert.deepEqual(hit(findMatcher('EL*', {wildcard: true}), 'EL+3,000'), ['EL+3,000'], '끝의 * 는 줄 끝까지');
 assert.deepEqual(hit(findMatcher('a.b(c)*?'), 'xa.b(c)*?y aXb'), ['a.b(c)*?'], '와일드카드가 아니면 * ? . ( ) 는 글자 그대로');
 assert.throws(() => findMatcher(''), /찾을 문자열/);
 assert.throws(() => findMatcher('*', {wildcard: true}), /빈 문자열/);
 assert.deepEqual(matchOptions('word'), {matchCase: true, wholeWord: true});
 assert.deepEqual(matchOptions('case'), {matchCase: true});
});

const leader = () => ({id: 'L', type: 'block', name: '지시선', layer: 'default', mleader: true, entities: [
 {type: 'polyline', layer: 'default', points: [P(0, 0), P(100, 100)]}, {type: 'text', layer: 'default', position: P(100, 100), height: 10, text: '몰타르 마감'}]});
const attrBlock = () => ({id: 'B', type: 'block', name: '도곽', layer: 'default', attributes: {NAME: '1층 평면도', NO: 3}, entities: [
 {type: 'line', layer: 'default', points: [P(0, 0), P(10, 0)]},
 {type: 'text', layer: 'default', position: P(0, 0), height: 5, text: '1층 평면도', attributeTag: 'NAME'},
 {type: 'block', name: '안쪽', layer: 'default', entities: [{type: 'text', layer: 'default', position: P(1, 1), height: 5, text: '안쪽 1층'}]}]});

test('textSlots: 문자·치수(text/textTemplate)·속성·표 칸·블록 안(경로) — 속성 표시 문자와 표 그림 문자는 두 번 세지 않음', () => {
 const dim = {id: 'D', type: 'dimension', layer: 'default', text: '', textTemplate: '<> 1층', points: [P(0, 0), P(1, 0), P(0, 1)]};
 const table = {id: 'T', layer: 'default', ...buildTableBlock([['실', '면적'], ['1층 거실', 24.5]], {height: 100})};
 const slots = [text('A', '1층'), dim, attrBlock(), table, leader()].flatMap(e => [...textSlots(e)]);
 const kinds = slots.map(s => `${s.id}:${s.kind}:${s.key}:${s.path.join('/')}`);
 assert.deepEqual(kinds, [
  'A:text:text:', 'D:dimension:textTemplate:', 'B:attribute:attributes.NAME:', 'B:attribute:attributes.NO:', 'B:blockText:text:2/0',
  'T:cell:table.rows.0.0:', 'T:cell:table.rows.0.1:', 'T:cell:table.rows.1.0:', 'T:cell:table.rows.1.1:', 'L:blockText:text:1']);
 assert.equal(slots.find(s => s.key === 'attributes.NO').value, '3');
 const shared = {id: 'S', type: 'block', name: 'X', sharedBlock: 'k', layer: 'default', attributes: {A: '1층'}, entities: [text('c', '1층')]};
 assert.deepEqual([...textSlots(shared)].map(s => s.kind), ['attribute'], '공유 블록 정의 안은 들어가지 않음');
});

test('findAll: 개수·범위(문자만)·빈 값 건너뜀', () => {
 const es = [text('A', '1층 1층'), attrBlock(), text('E', '')];
 const hits = findAll(es, findMatcher('1층'));
 assert.deepEqual(hits.map(h => [h.id, h.kind, h.count]), [['A', 'text', 2], ['B', 'attribute', 1], ['B', 'blockText', 1]]);
 assert.deepEqual(findAll(es, findMatcher('1층'), {scope: 'text'}).map(h => h.id), ['A']);
 assert.match(slotLabel(hits[1], 1), /^2\. 블록 속성 NAME · "1층 평면도"/);
});

test('slotChanges/planSlotEdits: 경로 따라 블록 안·속성(보이는 문자 함께)·표 칸(다시 그림)을 고치고 원본은 그대로', () => {
 const b = attrBlock(), before = JSON.stringify(b);
 const re = findMatcher('1층'), swap = literalReplacer(re, '2층$&');
 const plan = planSlotEdits([b], s => swap(s.value));
 assert.equal(JSON.stringify(b), before, '원본 불변');
 assert.equal(plan.updates.length, 1);
 const ch = plan.updates[0].changes;
 assert.equal(ch.attributes.NAME, '2층$& 평면도', '$& 같은 치환 기호는 글자 그대로');
 assert.equal(ch.attributes.NO, 3, '숫자 속성은 그대로');
 assert.equal(ch.entities[1].text, '2층$& 평면도', '속성을 보여 주는 문자도 같이');
 assert.equal(ch.entities[2].entities[0].text, '안쪽 2층$&');
 assert.equal(ch.entities[0], b.entities[0], '안 바뀐 자식은 같은 객체(복사 안 함)');
 assert.equal(plan.edits.length, 2);

 const table = {id: 'T', layer: 'default', ...buildTableBlock([['실', '면적'], ['거실', 24.5]], {height: 100})};
 const t = planSlotEdits([table], s => s.value === '24.5' ? '30' : s.value === '거실' ? '안방' : null).updates[0].changes;
 assert.deepEqual(t.table.rows, [['실', '면적'], ['안방', 30]], '숫자 칸은 숫자로 남음');
 assert.ok(t.entities.some(e => e.type === 'text' && e.text === '안방' && e.tableCell.row === 1), '표 다시 그림');
 assert.deepEqual(table.table.rows[1], ['거실', 24.5]);
});

test('planSlotEdits: 잠긴 레이어는 건너뛰고 세며, 치수 측정값 자리 <> 를 지우는 바꾸기는 막음', () => {
 const dim = {id: 'D', type: 'dimension', layer: 'lk', textTemplate: '<> mm', points: [P(0, 0), P(1, 0), P(0, 1)]};
 const dim2 = {...dim, id: 'D2', layer: 'default'};
 const locked = lockedBy([{id: 'lk', locked: true}, {id: 'default'}]);
 const a = planSlotEdits([dim, text('A', 'mm', {layer: 'lk'}), text('B', 'mm')], s => s.value.replace('mm', 'M'), {locked});
 assert.equal(a.skippedLocked, 2);
 assert.deepEqual(a.updates, [{id: 'B', changes: {text: 'M'}}]);
 const g = planSlotEdits([dim2], s => s.value.replace('<>', ''), {locked});
 assert.equal(g.guarded, 1);
 assert.equal(g.updates.length, 0);
 assert.deepEqual(planSlotEdits([dim2], s => s.value.replace('mm', 'M')).updates[0].changes, {textTemplate: '<> M'});
});

test('slotBounds: 표 칸·속성은 그 글자 둘레, 넉넉한 여백', () => {
 const table = {id: 'T', layer: 'default', ...buildTableBlock([['a', 'b'], ['c', 'd']], {x: 0, y: 0, height: 100, widths: [1000, 1000], rowHeight: 300})};
 const cell = findAll([table], findMatcher('d'))[0];
 const b = slotBounds(table, cell);
 assert.ok(b.minX >= 800 && b.minX < 1100 && b.maxY < 0, JSON.stringify(b));
 assert.equal(slotBounds(null, cell), null);
});

// ── FINDREPLACE (workflows.js) ──
function wf() {
 const engine = new DrawingEngine(), selection = new Set();
 let fields, apply;
 const zooms = [], toasts = [];
 const context = {engine, execute: c => engine.execute(c), chosen: () => engine.doc.entities.filter(e => selection.has(e.id)), selected: () => selection, activeLayer: () => 'default', refresh() {}, toast: m => toasts.push(m), getSettings: () => defaults,
  field: (name, label, value, type, options) => ({name, label, value, type, options}), pointFields: () => [{name: 'x', value: 0}, {name: 'y', value: 0}],
  form: (title, f, a) => { fields = f; apply = a; }, add: es => engine.execute({type: 'addMany', entities: es}), change: changes => engine.execute({type: 'document.update', changes}), zoomToBounds: b => zooms.push(b)};
 const studio = installWorkflows({context, handlers: {}});
 return {engine, selection, zooms, toasts, fields: () => fields, open: name => studio.handlers[name](), run: async (values = {}) => apply({...Object.fromEntries(fields.map(f => [f.name, String(f.value ?? '')])), ...values})};
}

test('FINDREPLACE: 치수·속성·표·블록 안까지 한 번에 바꾸고 되돌리기 한 번, 문자만 고르면 예전처럼', async () => {
 const t = wf();
 const table = buildTableBlock([['층', '면적'], ['1층', 100]], {height: 100, layer: 'default'});
 t.engine.execute({type: 'addMany', entities: [text(undefined, '1층 평면도'), {type: 'dimension', layer: 'default', mode: 'horizontal', textTemplate: '<> (1층)', textHeight: 100, points: [P(0, 0), P(1000, 0), P(0, 500)]},
  {...attrBlock(), id: undefined}, {...table, layer: 'default'}, {...leader(), id: undefined}]});
 const before = JSON.stringify(t.engine.doc.entities);
 t.open('FINDREPLACE');
 assert.equal(t.fields().find(f => f.name === 'scope').value, 'all');
 await t.run({find: '1층', replace: '2층'});
 const es = t.engine.doc.entities;
 assert.equal(es[0].text, '2층 평면도');
 assert.equal(es[1].textTemplate, '<> (2층)');
 assert.equal(es[2].attributes.NAME, '2층 평면도');
 assert.equal(es[2].entities[2].entities[0].text, '안쪽 2층');
 assert.equal(es[3].table.rows[1][0], '2층');
 t.engine.validate(t.engine.doc);
 t.engine.execute({type: 'undo'});
 assert.equal(JSON.stringify(t.engine.doc.entities), before, '되돌리기 한 번에 전부');
 t.open('FINDREPLACE');
 await t.run({find: '1층', replace: '3층', scope: 'text'});
 assert.equal(t.engine.doc.entities[0].text, '3층 평면도');
 assert.equal(t.engine.doc.entities[2].attributes.NAME, '1층 평면도', '문자만이면 속성은 그대로');
});

test('FINDREPLACE: 잠긴 레이어는 건너뛰고 알림, 찾기만은 결과 목록 → 고르면 선택·확대', async () => {
 const t = wf();
 t.engine.execute({type: 'layer.add', name: '잠김', color: '#ffffff'});
 const lk = t.engine.doc.layers.find(l => l.name === '잠김').id;
 const [a, b] = t.engine.execute({type: 'addMany', entities: [text(undefined, 'WALL'), text(undefined, 'wall', {layer: lk, position: P(5000, 5000)})]});
 t.engine.execute({type: 'layer.update', id: lk, changes: {locked: true}});
 t.open('FINDREPLACE');
 await t.run({find: 'wall', replace: '벽', match: 'nocase'});
 assert.equal(t.engine.doc.entities.find(e => e.id === a).text, '벽');
 assert.equal(t.engine.doc.entities.find(e => e.id === b).text, 'wall');
 assert.match(t.toasts.at(-1), /잠긴 레이어 1곳/);
 t.open('FINDREPLACE');
 await t.run({action: 'find', find: 'wall', match: 'nocase'});
 const hit = t.fields().find(f => f.name === 'hit');
 assert.equal(hit.options.length, 1);
 assert.match(hit.options[0][1], /잠김/);
 await t.run({hit: '0', after: 'close'});
 assert.deepEqual([...t.selection], [b]);
 assert.equal(t.zooms.length, 1);
 assert.ok(t.zooms[0].minX < 5000 && t.zooms[0].maxX > 5000);
});

test('FINDREPLACE: 문자 없이 블록 속성만 있어도 열리고, 번호 매기기 같은 다른 작업은 문자가 필요', async () => {
 const t = wf();
 const [id] = t.engine.execute({type: 'addMany', entities: [{type: 'block', name: '도곽', layer: 'default', attributes: {NO: 'A-1'}, entities: [{type: 'line', layer: 'default', points: [P(0, 0), P(1, 1)]}]}]});
 t.selection.add(id);
 t.open('FINDREPLACE');
 await t.run({find: 'A-', replace: 'B-'});
 assert.equal(t.engine.doc.entities[0].attributes.NO, 'B-1');
 t.open('FINDREPLACE');
 await assert.rejects(async () => t.run({action: 'number'}), /문자가 없습니다/);
 assert.throws(() => t.open('TEXTNUMBER'), /문자가 없습니다/);
});

// ── CTX·FAR 를 실제 엔진으로 ──
function cardCtx(engine, responses = []) {
 const toasts = [], forms = [], zooms = [];
 const ctx = {entities: () => engine.doc.entities, selected: () => [], selectedIds: () => [], layers: () => engine.doc.layers, execute: c => engine.execute(c), toast: m => toasts.push(m), userErrorMessage: e => e.message,
  ensureLayer: n => n, setSelected: ids => { ctx.sel = ids; }, zoomToBounds: b => zooms.push(b),
  form: (title, fields, onApply) => { forms.push(title); const values = {...Object.fromEntries(fields.map(f => [f.name, f.value])), ...(responses.shift() || {})}; return onApply(values); }};
 return {ctx, toasts, forms, zooms};
}

test('CTX: 블록 속성·표 칸도 하나씩 보여 주며 바꾸고, 그 위치로 확대', () => {
 const engine = new DrawingEngine();
 engine.execute({type: 'addMany', entities: [{...attrBlock(), id: undefined}, buildTableBlock([['1층']], {height: 100, layer: 'default'})]});
 const {ctx, forms, zooms} = cardCtx(engine, [{find: '1층', replace: '2층'}, {action: 'replace'}, {action: 'skip'}, {action: 'replace'}]);
 installTextEditTools4(ctx).CTX();
 assert.equal(forms.length, 4, '찾기 1 + 결과 3');
 assert.match(forms[1], /블록 속성/);
 assert.match(forms[3], /표 칸/);
 const [b, t] = engine.doc.entities;
 assert.equal(b.attributes.NAME, '2층 평면도');
 assert.equal(b.entities[1].text, '2층 평면도');
 assert.equal(b.entities[2].entities[0].text, '안쪽 1층', '건너뛴 곳은 그대로');
 assert.deepEqual(t.table.rows, [['2층']]);
 assert.equal(zooms.length, 3);
 engine.validate(engine.doc);
});

test('FAR: 여러 쌍을 표 칸·치수에도, 정렬·폭 옵션은 문자 객체에만', () => {
 const engine = new DrawingEngine();
 engine.execute({type: 'addMany', entities: [text(undefined, '거실', {align: 'left'}), buildTableBlock([['거실', '침실']], {height: 100, layer: 'default'}), {type: 'dimension', layer: 'default', mode: 'horizontal', text: '침실 폭', textHeight: 100, points: [P(0, 0), P(1000, 0), P(0, 500)]}]});
 const {ctx, toasts} = cardCtx(engine, [{pairs: '거실\t방1\n침실\t방2', align: 'center', autoWidth: 'on'}]);
 installTextEditTools4(ctx).FAR();
 const [t, table, dim] = engine.doc.entities;
 assert.equal(t.text, '방1');
 assert.equal(t.align, 'center');
 assert.deepEqual(table.table.rows, [['방1', '방2']]);
 assert.equal(dim.text, '방2 폭');
 assert.match(toasts.at(-1), /3개 객체 4곳/);
});
