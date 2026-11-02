// AutoCAD 특성 패널(훈민캐드 대조 기반 1): 현재 색·선종류, CHPROP, SETBYLAYER, LINETYPE, 표준 선종류.
import test from 'node:test';
import assert from 'node:assert/strict';
import {DrawingEngine} from './engine.js';
import {parseColor, colorChanges, applyCurrentProperties, describeColor, colorOfEntity, parseLinetype, linetypeChoices, STANDARD_LINETYPES, byLayerChanges, parseLineweight} from './cad-properties.js';
import {installPropertyTools} from './property-tools.js';
import {linetypeDashPattern} from './view.js';
import {COMMANDS} from './commands.js';
import {MENU_CATALOG} from './menu-catalog.js';

const drawing = () => ({version: 2, units: 'mm', layers: [
 {id: 'L0', name: '0', color: '#ffffff', visible: true, locked: false, linetype: 'CONTINUOUS'},
 {id: 'LK', name: 'LOCKED', color: '#00ff00', visible: true, locked: true},
 {id: 'LH', name: 'A-HIDDEN', color: '#ffff00', visible: true, locked: false, linetype: 'HIDDEN'},
], blocks: [], entities: [
 {id: 'a', type: 'line', layer: 'L0', points: [{x: 0, y: 0}, {x: 10, y: 0}]},
 {id: 'b', type: 'line', layer: 'L0', points: [{x: 0, y: 5}, {x: 10, y: 5}], color: '#ff0000', aci: 1, colorMode: 'aci', linetype: 'DASHED', lineweight: 0.5},
 {id: 'c', type: 'line', layer: 'LK', points: [{x: 0, y: 9}, {x: 10, y: 9}]},
]});

test('색 입력: ByLayer·ByBlock·번호·#RRGGBB·R,G,B 를 읽고 틀린 값은 이유를 말한다', () => {
 assert.deepEqual(parseColor(''), {mode: 'bylayer'});
 assert.deepEqual(parseColor('bylayer'), {mode: 'bylayer'});
 assert.deepEqual(parseColor('BYBLOCK'), {mode: 'byblock'});
 assert.deepEqual(parseColor('1'), {mode: 'aci', aci: 1, color: '#ff0000'});
 assert.equal(parseColor('7').color, '#d8d8d8');
 assert.deepEqual(parseColor('#00FF00'), {mode: 'truecolor', color: '#00ff00'});
 assert.deepEqual(parseColor('255, 128, 0'), {mode: 'truecolor', color: '#ff8000'});
 assert.throws(() => parseColor('300'), /1~255/);
 assert.throws(() => parseColor('빨강빨강'), /읽지 못했습니다/);
 assert.throws(() => parseColor('1,2,999'), /0~255/);
 assert.equal(describeColor(parseColor('3')), '3 초록');
 assert.equal(describeColor(null), 'ByLayer');
});

test('객체 색 변경분은 엔진 검증을 통과하고 ByLayer 는 객체 색을 비운다', () => {
 const engine = new DrawingEngine();engine.doc = drawing();
 engine.execute({type: 'update', ids: ['a'], changes: colorChanges(parseColor('5'))});
 assert.equal(engine.doc.entities[0].color, '#0000ff');
 assert.equal(engine.doc.entities[0].aci, 5);
 engine.execute({type: 'update', ids: ['b'], changes: colorChanges(parseColor('BYLAYER'))});
 assert.equal(engine.doc.entities[1].color, null);
 assert.deepEqual(colorOfEntity(engine.doc.entities[1]), {mode: 'bylayer'});
 engine.execute({type: 'update', ids: ['a'], changes: colorChanges(parseColor('BYBLOCK'))});
 assert.deepEqual(colorOfEntity(engine.doc.entities[0]), {mode: 'byblock'});
});

test('현재 특성은 새 객체의 빈 값만 채우고, 카드가 정한 색·선종류는 덮지 않는다', () => {
 const current = {color: parseColor('1'), linetype: 'HIDDEN', linetypeScale: 2, lineweight: 0.35};
 const [plain, colored] = applyCurrentProperties([
  {type: 'line', layer: 'L0', points: []},
  {type: 'line', layer: 'L0', points: [], color: '#00ff00', colorMode: 'truecolor', linetype: 'CENTER'},
 ], current);
 assert.equal(plain.color, '#ff0000');assert.equal(plain.aci, 1);assert.equal(plain.linetype, 'HIDDEN');
 assert.equal(plain.linetypeScale, 2);assert.equal(plain.lineweight, 0.35);
 assert.equal(colored.color, '#00ff00');assert.equal(colored.linetype, 'CENTER');
 // 기본(ByLayer)이면 배열을 그대로 돌려준다(복사 비용 없음).
 const list = [{type: 'line'}];
 assert.equal(applyCurrentProperties(list, {color: null, linetype: null, linetypeScale: null, lineweight: null}), list);
});

test('선종류: 표준 acadiso 25종과 도면에 쓰인 다른 이름을 고를 수 있고, 없는 이름은 거절한다', () => {
 assert.equal(STANDARD_LINETYPES.length, 25);
 const doc = drawing();doc.entities.push({id: 'x', type: 'line', layer: 'L0', points: [{x: 0, y: 0}, {x: 1, y: 0}], linetype: 'ACAD_ISO02W100'});
 const names = linetypeChoices(doc).map(([v]) => v);
 for (const name of ['BYLAYER', 'HIDDEN', 'HIDDEN2', 'CENTERX2', 'DASHDOT', 'BORDER', 'ACAD_ISO02W100']) assert.ok(names.includes(name), name);
 assert.equal(parseLinetype('hidden', doc), 'HIDDEN');
 assert.equal(parseLinetype('BYLAYER', doc), null);
 assert.throws(() => parseLinetype('NOPE', doc), /없습니다/);
 assert.equal(parseLineweight(''), null);assert.equal(parseLineweight('0.3'), 0.3);assert.throws(() => parseLineweight('5'), /0~2\.11/);
});

test('화면 무늬: 2 는 절반, X2 는 두 배, 일점쇄선은 점선이 아니다. 예전 이름의 무늬는 그대로다', () => {
 assert.deepEqual(linetypeDashPattern('HIDDEN'), [7, 5]);
 assert.deepEqual(linetypeDashPattern('HIDDEN2'), [3.5, 2.5]);
 assert.deepEqual(linetypeDashPattern('CENTERX2'), [24, 6, 4, 6]);
 assert.deepEqual(linetypeDashPattern('DASHDOT'), [7, 4, 1, 4]);
 assert.deepEqual(linetypeDashPattern('DOT'), [1, 4]);
 assert.deepEqual(linetypeDashPattern('ACAD_ISO02W100'), [7, 5]);
 assert.deepEqual(linetypeDashPattern('CONTINUOUS'), []);
});

/** 카드 문맥 흉내: form 은 바로 onApply 를 부른다. */
function harness({selected = [], answers = {}, pick = null} = {}) {
 const engine = new DrawingEngine();engine.doc = drawing();
 let current = {color: null, linetype: null, linetypeScale: null, lineweight: null};const toasts = [];
 const ctx = {
  selected: () => engine.doc.entities.filter(e => selected.includes(e.id)),
  layers: () => engine.doc.layers, doc: () => engine.doc,
  execute: c => engine.execute(c), toast: m => toasts.push(m),
  form: (title, fields, onApply) => onApply({...Object.fromEntries(fields.map(f => [f.name, f.value])), ...answers}),
  pickEntity: async () => pick ? engine.doc.entities.find(e => e.id === pick) : null,
  getCurrentProperties: () => current, setCurrentProperties: v => { current = v; },
 };
 return {engine, tools: installPropertyTools(ctx), toasts, current: () => current};
}

test('CHPROP: 고른 특성만 바꾸고 잠긴 레이어 객체는 건너뛰며 되돌리기 한 번으로 돌아간다', () => {
 const h = harness({selected: ['a', 'b', 'c'], answers: {color: '3', linetype: 'CENTER', lineweight: '0.35'}});
 h.tools.CHPROP();
 const [a, b, c] = h.engine.doc.entities;
 assert.equal(a.color, '#00ff00');assert.equal(a.linetype, 'CENTER');assert.equal(a.lineweight, 0.35);
 assert.equal(b.color, '#00ff00');assert.equal(b.layer, 'L0');
 assert.equal(c.color, undefined, '잠긴 레이어 객체는 그대로');
 assert.match(h.toasts.at(-1), /2개를 바꿨습니다.*1개는 건너뛰었습니다/);
 h.engine.execute({type: 'undo'});
 assert.equal(h.engine.doc.entities[1].color, '#ff0000');
 assert.equal(h.engine.doc.entities[1].linetype, 'DASHED');
});

test('CHPROP: 아무것도 고르지 않으면 바꾸지 않고, 선택이 없으면 이유를 말한다', () => {
 const h = harness({selected: ['a']});
 h.tools.CHPROP();
 assert.equal(h.engine.undoStack.length, 0);
 assert.match(h.toasts.at(-1), /하나 이상/);
 assert.throws(() => harness().tools.CHPROP(), /먼저 객체를 선택/);
});

test('SETBYLAYER: 선택 객체의 색·선종류·선굵기만 레이어 따름으로 되돌린다', () => {
 const h = harness({selected: ['b']});
 h.tools.SETBYLAYER();
 const b = h.engine.doc.entities[1];
 assert.equal(b.color, null);assert.equal(b.linetype, null);assert.equal(b.lineweight, null);
 assert.equal(h.engine.doc.entities[0].color, undefined);
 assert.deepEqual(byLayerChanges({color: false, linetype: true, lineweight: false}), {linetype: null});
});

test('CECOLOR·CELTYPE: 현재 특성을 정하고 객체에서 가져올 수 있다', async () => {
 const h = harness({answers: {color: '5'}});
 await h.tools.CECOLOR();
 assert.deepEqual(h.current().color, {mode: 'aci', aci: 5, color: '#0000ff'});
 const g = harness({answers: {fromObject: 'on'}, pick: 'b'});
 await g.tools.CECOLOR();await g.tools.CELTYPE();
 assert.equal(g.current().color.aci, 1);assert.equal(g.current().linetype, 'DASHED');
 const byLayer = harness({answers: {color: 'BYLAYER'}});
 await byLayer.tools.CECOLOR();
 assert.equal(byLayer.current().color, null);
});

test('LINETYPE: 현재 선종류와 도면 선종류 축척(LTSCALE)을 정한다', () => {
 const h = harness({answers: {current: 'PHANTOM', ltscale: '50'}});
 h.tools.LINETYPE();
 assert.equal(h.current().linetype, 'PHANTOM');
 assert.equal(h.engine.doc.linetypeScale, 50);
});

test('특성 명령은 명령 목록과 작업 탭 특성 구역에 한 번씩 있다', () => {
 const names = ['CHPROP', 'SETBYLAYER', 'CECOLOR', 'CELTYPE', 'LINETYPE', 'DENSITY', 'LUPREC'];
 for (const name of names) assert.equal(COMMANDS.filter(c => c.name === name).length, 1, name);
 const section = MENU_CATALOG.work.sections.find(s => s.label === '특성');
 assert.deepEqual(section.commands, names);
});

test('LUPREC: 표시 자리수를 0~8 에서 고른다', () => {
 let digits = 2;const toasts = [];
 const tools = installPropertyTools({getCurrentProperties: () => null, setCurrentProperties() {}, getDisplayPrecision: () => digits, setDisplayPrecision: v => (digits = v), toast: m => toasts.push(m),
  form: (title, fields, onApply) => onApply({digits: '4'})});
 tools.LUPREC();
 assert.equal(digits, 4);assert.match(toasts[0], /4자리/);
});

test('STYLE: 스타일 글꼴을 바꾸면 그 스타일 문자 전부가, 선택 방식이면 고른 문자만 바뀐다', () => {
 const engine = new DrawingEngine();engine.doc = drawing();
 engine.doc.entities.push(
  {id: 't1', type: 'text', layer: 'L0', position: {x: 0, y: 0}, text: '거실', height: 250, textStyle: 'KOR', sourceFont: 'gulim.ttc'},
  {id: 't2', type: 'text', layer: 'L0', position: {x: 0, y: 500}, text: '침실', height: 250, textStyle: 'KOR', sourceFont: 'gulim.ttc'},
  {id: 't3', type: 'text', layer: 'L0', position: {x: 0, y: 900}, text: 'ROOM', height: 250, textStyle: 'Standard', sourceFont: 'txt.shx'});
 let chosen = [];const toasts = [];let answers = {};
 const tools = installPropertyTools({getCurrentProperties: () => null, setCurrentProperties() {}, doc: () => engine.doc, layers: () => engine.doc.layers,
  selected: () => engine.doc.entities.filter(e => chosen.includes(e.id)), execute: c => engine.execute(c), toast: m => toasts.push(m),
  form: (title, fields, onApply) => onApply({...Object.fromEntries(fields.map(f => [f.name, f.value])), ...answers})});
 answers = {style: 'KOR', font: 'batang.ttc', scope: 'style'};tools.STYLE();
 assert.deepEqual(engine.doc.entities.filter(e => e.textStyle === 'KOR').map(e => e.sourceFont), ['batang.ttc', 'batang.ttc']);
 chosen = ['t3'];answers = {style: '__new__', name: 'TITLE', font: 'romans.shx', scope: 'selection'};tools.STYLE();
 const t3 = engine.doc.entities.find(e => e.id === 't3');
 assert.equal(t3.textStyle, 'TITLE');assert.equal(t3.sourceFont, 'romans.shx');assert.equal(t3.sourceBigFont, 'whgtxt.shx');
 answers = {style: '__new__', name: 'A/B', font: 'arial.ttf', scope: 'selection'};
 assert.throws(() => tools.STYLE(), /쓸 수 없습니다/);
});

test('STYLE: 블록 안 문자도, 한글 선 글꼴은 큰 글꼴로, 글꼴 그대로면 스타일의 지금 글꼴을 따름 (검토 6)', () => {
 const engine = new DrawingEngine();engine.doc = drawing();
 engine.doc.entities.push(
  {id: 'b1', type: 'block', name: 'TAG', layer: 'L0', entities: [{id: 'n1', type: 'text', layer: 'L0', position: {x: 0, y: 0}, text: '안', height: 250, textStyle: 'OLD', sourceFont: 'romans.shx'}]},
  {id: 't1', type: 'text', layer: 'L0', position: {x: 0, y: 500}, text: '밖', height: 250, textStyle: 'OLD', sourceFont: 'romans.shx'},
  {id: 't2', type: 'text', layer: 'L0', position: {x: 0, y: 900}, text: '새', height: 250, sourceFont: 'malgun.ttf'});
 let chosen = [];let answers = {};
 const tools = installPropertyTools({getCurrentProperties: () => null, setCurrentProperties() {}, doc: () => engine.doc, layers: () => engine.doc.layers,
  selected: () => engine.doc.entities.filter(e => chosen.includes(e.id)), execute: c => engine.execute(c), toast: () => {},
  form: (title, fields, onApply) => onApply({...Object.fromEntries(fields.map(f => [f.name, f.value])), ...answers})});
 answers = {style: 'OLD', font: 'whgtxt.shx', scope: 'style'};tools.STYLE();
 const by = (id) => engine.doc.entities.find(e => e.id === id);
 assert.equal(by('b1').entities[0].sourceFont, 'romans.shx');assert.equal(by('b1').entities[0].sourceBigFont, 'whgtxt.shx', '블록 안 문자도');
 assert.equal(by('t1').sourceFont, 'romans.shx');assert.equal(by('t1').sourceBigFont, 'whgtxt.shx');
 chosen = ['t2'];answers = {style: 'OLD', font: '__keep__', scope: 'selection'};tools.STYLE();
 assert.equal(by('t2').textStyle, 'OLD');assert.equal(by('t2').sourceFont, 'romans.shx', '스타일의 글꼴을 따라 한 스타일에 글꼴이 섞이지 않음');
 engine.execute({type: 'undo'});
 assert.equal(by('t2').sourceFont, 'malgun.ttf');
});

test('CHPROP 출력 농도(H24): 60% 지정 → 출력 투명도 0.6, 100 은 기본(블록 농도 따름)으로', async () => {
 const {plotOpacity} = await import('./plot.js');
 const h = harness({selected: ['a', 'b'], answers: {plotDensity: '60'}});
 h.tools.CHPROP();
 const [a] = h.engine.doc.entities;
 assert.equal(a.plotDensity, 60);
 assert.equal(plotOpacity(null, a, {}), 0.6);
 assert.equal(plotOpacity({screen: 50}, a, {}), 0.3, 'CTB 스크리닝과 곱');
 assert.equal(plotOpacity(null, {}, {plotDensity: 40}), 0.4, '블록 안 객체는 블록 농도');
 assert.equal(plotOpacity(null, {plotDensity: 'x'}, {}), 1);
 const h2 = harness({selected: ['a'], answers: {plotDensity: '100'}});
 h2.engine.execute({type: 'update', ids: ['a'], changes: {plotDensity: 60}});
 h2.tools.CHPROP();
 assert.equal(h2.engine.doc.entities[0].plotDensity, null);
 assert.throws(() => { const h3 = harness({selected: ['a'], answers: {plotDensity: '55'}}); h3.tools.CHPROP(); }, /출력 농도/);
});

test('현재 색(CECOLOR): 자동 분류된 문자도 현재 색은 남고, 다른 색은 레이어 색으로 (검토 7)', () => {
 const engine = new DrawingEngine();
 const red = colorChanges(parseColor('1'));
 engine.execute({type: 'add.classified', keepColor: red, entities: [
  {type: 'text', layer: 'default', position: {x: 0, y: 0}, text: '거실', height: 250, ...red},
  {type: 'text', layer: 'default', position: {x: 0, y: 500}, text: '침실', height: 250, color: '#00ff00', colorMode: 'truecolor'},
 ]});
 const [a, b] = engine.doc.entities;
 assert.notEqual(a.layer, 'default', '주석 레이어로 분류됨');
 assert.equal(a.color, red.color, '현재 색은 남음');
 assert.equal(b.color, undefined, '현재 색이 아닌 색은 예전처럼 지움');
});

test('SETBYLAYER: 블록 안 객체까지 레이어 따름으로 (AutoCAD 기본, 검토 10)', () => {
 const h = harness({selected: ['blk'], answers: {}});
 h.engine.doc.entities.push({id: 'blk', type: 'block', name: 'B', layer: 'L0', color: '#ff0000', entities: [{id: 'in', type: 'line', layer: 'L0', color: '#ff0000', linetype: 'HIDDEN', points: [{x: 0, y: 0}, {x: 1, y: 0}]}]});
 h.tools.SETBYLAYER();
 const blk = h.engine.doc.entities.find(e => e.id === 'blk');
 assert.equal(blk.color ?? null, null);
 assert.equal(blk.entities[0].color ?? null, null);assert.equal(blk.entities[0].linetype ?? null, null);
 const h2 = harness({selected: ['blk'], answers: {blocks: false}});
 h2.engine.doc.entities.push({id: 'blk', type: 'block', name: 'B', layer: 'L0', entities: [{id: 'in', type: 'line', layer: 'L0', color: '#ff0000', points: [{x: 0, y: 0}, {x: 1, y: 0}]}]});
 h2.tools.SETBYLAYER();
 assert.equal(h2.engine.doc.entities.find(e => e.id === 'blk').entities[0].color, '#ff0000');
});
