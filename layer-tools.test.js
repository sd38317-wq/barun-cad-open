// layer-tools.js 시험. node --test 로 돈다. DOM 없이 export 된 순수 함수만 부른다(규칙서 8절).
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {
 normalizeHex, parseColorList, parseNameList, parseLayerMapping, sanitizeLayerName,
 effectiveColor, effectiveLinetype, colorMatchIds, layersMatchingColor, linetypesMatchingName,
 isolateLayerChanges, toggleVisibilityChanges, turnOnChanges, offOrFrozenLayers,
 layersToErase, entitiesToErase, colorMergeMatches, linetypeMergeMatches,
 computeLayerCounts, sortRows, buildLayerListRows, stackTextRows, nearestTextInBox,
 installLayerTools,
} from './layer-tools.js';

/* ── 색·이름 파싱 ── */
test('normalizeHex: 6자리/3자리/# 유무/대소문자, 잘못된 값', () => {
 assert.equal(normalizeHex('#FF0000'), '#ff0000');
 assert.equal(normalizeHex('ff0000'), '#ff0000');
 assert.equal(normalizeHex('#f00'), '#ff0000');
 assert.equal(normalizeHex('f00'), '#ff0000');
 assert.equal(normalizeHex(''), null);
 assert.equal(normalizeHex('gggggg'), null);
 assert.equal(normalizeHex(undefined), null);
});

test('parseColorList: 콤마·공백 구분, all/전체, 빈 값, 중복 제거', () => {
 assert.deepEqual(parseColorList('#ff0000, #00ff00 #0000ff'), {all: false, colors: ['#ff0000', '#00ff00', '#0000ff']});
 assert.deepEqual(parseColorList('all'), {all: true, colors: []});
 assert.deepEqual(parseColorList('전체'), {all: true, colors: []});
 assert.deepEqual(parseColorList(''), {all: false, colors: []});
 assert.deepEqual(parseColorList('#f00,#f00,#F00'), {all: false, colors: ['#ff0000']});
});

test('parseNameList: 콤마/줄바꿈 구분, 트림, 중복 제거', () => {
 assert.deepEqual(parseNameList('CENTER, HIDDEN\nPHANTOM,, CENTER'), ['CENTER', 'HIDDEN', 'PHANTOM']);
 assert.deepEqual(parseNameList(''), []);
});

test('parseLayerMapping: 여러 구분자, 잘못된 줄 무시, 중복 색은 나중 줄이 이김', () => {
 const rows = parseLayerMapping('#ff0000:A-DOOR\n00ff00=A-GLAZ\n#0000ff, A-WALL\nnot-a-line\n\n#ff0000:A-DOOR-2');
 assert.deepEqual(rows, [
  {color: '#ff0000', layer: 'A-DOOR-2'},
  {color: '#00ff00', layer: 'A-GLAZ'},
  {color: '#0000ff', layer: 'A-WALL'},
 ]);
});

test('sanitizeLayerName(TTL): 금지문자 제거, 다 지워지면 null', () => {
 assert.equal(sanitizeLayerName('거실'), '거실');
 assert.equal(sanitizeLayerName('주차장(지하)'), '주차장지하');
 assert.equal(sanitizeLayerName('A*B/C&D^E%F!G@H'), 'ABCDEFGH');
 assert.equal(sanitizeLayerName('()'), null);
 assert.equal(sanitizeLayerName('   '), null);
});

/* ── 실제 색·선모양(ByLayer 포함) ── */
const layers = [
 {id: 'L1', name: 'A-WALL', color: '#ffd479', visible: true, locked: false, frozen: false, linetype: 'CONTINUOUS'},
 {id: 'L2', name: 'A-DOOR', color: '#ff0000', visible: false, locked: false, frozen: false, linetype: 'CENTER'},
 {id: 'L3', name: 'A-GLAZ', color: '#ff0000', visible: true, locked: true, frozen: true, linetype: 'CONTINUOUS'},
 {id: '0', name: '0', color: '#ffffff', visible: true, locked: false, frozen: false, linetype: 'CONTINUOUS'},
];
const layerById = new Map(layers.map(l => [l.id, l]));

test('effectiveColor/effectiveLinetype: 강제값 우선, 없으면 켜 값', () => {
 assert.equal(effectiveColor({layer: 'L1'}, layerById), '#ffd479');
 assert.equal(effectiveColor({layer: 'L1', color: '#00ff00'}, layerById), '#00ff00');
 assert.equal(effectiveLinetype({layer: 'L2'}, layerById), 'CENTER');
 assert.equal(effectiveLinetype({layer: 'L2', linetype: 'BYLAYER'}, layerById), 'CENTER');
 assert.equal(effectiveLinetype({layer: 'L1', linetype: 'HIDDEN'}, layerById), 'HIDDEN');
});

test('colorMatchIds/layersMatchingColor/linetypesMatchingName', () => {
 const entities = [
  {id: 'e1', layer: 'L1'}, // #ffd479
  {id: 'e2', layer: 'L1', color: '#ff0000'},
  {id: 'e3', layer: 'L2'}, // #ff0000 by layer
 ];
 assert.deepEqual(colorMatchIds(entities, layerById, '#ff0000'), ['e2', 'e3']);
 assert.deepEqual(layersMatchingColor(layers, '#ff0000').sort(), ['L2', 'L3']);
 assert.deepEqual(linetypesMatchingName(layers, 'continuous').sort(), ['0', 'L1', 'L3']);
});

/* ── 켜 상태 일괄 변경 ── */
test('isolateLayerChanges: 선택한 켜만 good, 나머지 bad, protectId 는 빠짐', () => {
 const changes = isolateLayerChanges(layers, new Set(['L1']), 'frozen', false, true, {protectId: 'L3'});
 assert.deepEqual(changes.sort((a, b) => a.id.localeCompare(b.id)), [
  {id: '0', frozen: true},
  {id: 'L1', frozen: false},
  {id: 'L2', frozen: true},
 ]);
});

test('toggleVisibilityChanges: 현재 켜는 반전 대상에서 빠짐', () => {
 const changes = toggleVisibilityChanges(layers, 'L1');
 assert.deepEqual(changes.find(c => c.id === 'L1'), undefined);
 assert.deepEqual(changes.find(c => c.id === 'L2'), {id: 'L2', visible: true});
 assert.deepEqual(changes.find(c => c.id === 'L3'), {id: 'L3', visible: false});
});

test('turnOnChanges: 켜짐+동결풀기', () => {
 assert.deepEqual(turnOnChanges(['L2', 'L3']), [
  {id: 'L2', visible: true, frozen: false},
  {id: 'L3', visible: true, frozen: false},
 ]);
});

test('offOrFrozenLayers: 꺼졌거나 얼린 켜만, 현재 켜는 제외', () => {
 assert.deepEqual(offOrFrozenLayers(layers, null).map(l => l.id).sort(), ['L2', 'L3']);
 assert.deepEqual(offOrFrozenLayers(layers, 'L3').map(l => l.id), ['L2']);
});

/* ── ELY ── */
test('layersToErase: off/frozen/list 모드와 반전', () => {
 assert.deepEqual(layersToErase(layers, 'off', [], false), ['L2']);
 assert.deepEqual(layersToErase(layers, 'frozen', [], false), ['L3']);
 assert.deepEqual(layersToErase(layers, 'list', ['L1'], false), ['L1']);
 assert.deepEqual(layersToErase(layers, 'off', [], true).sort(), ['0', 'L1', 'L3']);
});

test('entitiesToErase: 대상 켜의 객체만, 잠긴 켜는 항상 제외', () => {
 const entities = [{id: 'a', layer: 'L2'}, {id: 'b', layer: 'L3'}, {id: 'c', layer: 'L1'}];
 assert.deepEqual(entitiesToErase(entities, ['L2', 'L3'], ['L3']), ['a']);
});

/* ── LCM/LTM 대상 계산 ── */
test('colorMergeMatches: scope all/forced/bylayer', () => {
 const entities = [
  {id: 'a', layer: 'L2'},           // ByLayer #ff0000
  {id: 'b', layer: 'L1', color: '#ff0000'}, // 강제 #ff0000
  {id: 'c', layer: 'L1'},           // ByLayer #ffd479 (불일치)
 ];
 assert.deepEqual(colorMergeMatches(entities, layerById, ['#ff0000'], 'all').sort(), ['a', 'b']);
 assert.deepEqual(colorMergeMatches(entities, layerById, ['#ff0000'], 'forced'), ['b']);
 assert.deepEqual(colorMergeMatches(entities, layerById, ['#ff0000'], 'bylayer'), ['a']);
});

test('linetypeMergeMatches: scope all/forced/bylayer', () => {
 const entities = [
  {id: 'a', layer: 'L2'},                 // ByLayer CENTER
  {id: 'b', layer: 'L1', linetype: 'CENTER'}, // 강제 CENTER
  {id: 'c', layer: 'L1'},                 // ByLayer CONTINUOUS(불일치)
 ];
 assert.deepEqual(linetypeMergeMatches(entities, layerById, ['center'], 'all').sort(), ['a', 'b']);
 assert.deepEqual(linetypeMergeMatches(entities, layerById, ['CENTER'], 'forced'), ['b']);
 assert.deepEqual(linetypeMergeMatches(entities, layerById, ['CENTER'], 'bylayer'), ['a']);
});

/* ── LQT/LST ── */
test('computeLayerCounts: 켜별 개수, 종류 필터', () => {
 const entities = [{id: 'a', layer: 'L1', type: 'line'}, {id: 'b', layer: 'L1', type: 'text'}, {id: 'c', layer: 'L2', type: 'line'}];
 const all = computeLayerCounts(entities, layers);
 assert.equal(all.find(r => r.id === 'L1').count, 2);
 assert.equal(all.find(r => r.id === 'L3').count, 0);
 const onlyLine = computeLayerCounts(entities, layers, {types: ['line']});
 assert.equal(onlyLine.find(r => r.id === 'L1').count, 1);
});

test('sortRows: 이름순/갯수순, 오름/내림', () => {
 const rows = [{name: 'B', count: 1}, {name: 'A', count: 5}];
 assert.deepEqual(sortRows(rows, 'name', 'asc').map(r => r.name), ['A', 'B']);
 assert.deepEqual(sortRows(rows, 'count', 'desc').map(r => r.name), ['A', 'B']);
 assert.deepEqual(sortRows(rows, 'count', 'asc').map(r => r.name), ['B', 'A']);
});

test('buildLayerListRows: 이름순 정렬, 꺼짐/동결/잠김 표시', () => {
 const rows = buildLayerListRows(layers);
 assert.equal(rows[0], '0\t#ffffff\tCONTINUOUS');
 assert.ok(rows.find(r => r.startsWith('A-DOOR')).includes('[꺼짐]'));
 assert.ok(rows.find(r => r.startsWith('A-GLAZ')).includes('[동결]') && rows.find(r => r.startsWith('A-GLAZ')).includes('[잠김]'));
});

test('stackTextRows: 세로로 쌓기, 높이*줄간격만큼 y 감소', () => {
 const rows = stackTextRows({x: 10, y: 100}, ['a', 'b', 'c'], {height: 100, lineGap: 2});
 assert.deepEqual(rows.map(r => r.position), [{x: 10, y: 100}, {x: 10, y: -100}, {x: 10, y: -300}]);
 assert.deepEqual(rows.map(r => r.text), ['a', 'b', 'c']);
});

/* ── TLL ── */
test('nearestTextInBox: 정사각형 안에서 가장 가까운 문자, 밖은 무시', () => {
 const line = {points: [{x: 0, y: 0}, {x: 100, y: 0}]}; // 길이 100, 중심(50,0), half=50
 const texts = [
  {id: 't1', layer: 'L1', position: {x: 200, y: 0}}, // 밖
  {id: 't2', layer: 'L2', position: {x: 60, y: 10}},  // 안, 가까움
  {id: 't3', layer: 'L3', position: {x: 40, y: -20}}, // 안, 더 멂
 ];
 assert.equal(nearestTextInBox(line, texts).id, 't2');
 assert.equal(nearestTextInBox(line, []), null);
 assert.equal(nearestTextInBox({points: [{x: 0, y: 0}, {x: 400, y: 0}]}, [{id: 't3', layer: 'L3', position: {x: 40, y: -20}}]).id, 't3');
});

/* ── installLayerTools: 명령 21개가 모두 등록되고, "없음" 카드는 정직하게 토스트만 띄운다 ── */
const TARGET_COMMANDS = ['LFF', 'LFK', 'LTG', 'LOS', 'LLC', 'LFC', 'ECO', 'ECF', 'ESO', 'ELY', 'LCD', 'LCM', 'LTM', 'LQT', 'LST', 'SLC', 'TLL', 'TTL'];

function makeCtx(overrides = {}) {
 const toasts = [];
 return {
  toasts,
  storage: {getItem: () => null, setItem: () => {}},
  entities: () => [],
  layers: () => [],
  ensureLayer: (name) => name,
  selected: () => [],
  selectedIds: () => [],
  setSelected: () => {},
  execute: () => [],
  pickEntity: async () => null,
  pickPoint: async () => null,
  form: () => {},
  activeLayer: () => null,
  toast: (msg, isError) => toasts.push({msg, isError}),
  log: () => {},
  refresh: () => {},
  num: (key, def) => def,
  ...overrides,
 };
}

test('installLayerTools: 맡은 21개 명령 이름이 모두 키로 존재', () => {
 const cmds = installLayerTools(makeCtx());
 for (const name of TARGET_COMMANDS) assert.ok(typeof cmds[name] === 'function', `${name} 이 없습니다`);
 assert.equal(Object.keys(cmds).length, TARGET_COMMANDS.length);
});

test('구현 불가로 삭제한 카드(LFG/LFD/DOL)는 없다', () => {
 const cmds = installLayerTools(makeCtx());
 for (const n of ['LFG', 'LFD', 'DOL']) assert.ok(!(n in cmds), n);
});

test('LFF: 선택 없이 부르면 에러', () => {
 const ctx = makeCtx();
 const cmds = installLayerTools(ctx);
 assert.throws(() => cmds.LFF(), /선택/);
});

test('LFF: 선택된 객체의 켜만 남기고 나머지를 얼린다(현재 켜는 제외)', () => {
 const calls = [];
 const ctx = makeCtx({
  layers: () => layers,
  selected: () => [{id: 'e1', layer: 'L1'}],
  activeLayer: () => '0',
  execute: (c) => {calls.push(c); return [];},
 });
 const cmds = installLayerTools(ctx);
 cmds.LFF();
 assert.equal(calls.length, 1);
 assert.equal(calls[0].type, 'batch');
 const byId = Object.fromEntries(calls[0].commands.map(c => [c.id, c.changes.frozen]));
 assert.equal(byId.L1, false);
 assert.equal(byId.L2, true);
 assert.equal(byId.L3, true);
 assert.equal(byId['0'], undefined); // 현재 켜는 빠짐
 assert.equal(ctx.toasts.length, 1);
});

test('ESO: 선택 없이 부르면 에러, 선택 있으면 batch visibility 두 단계', () => {
 const ctx1 = makeCtx();
 assert.throws(() => installLayerTools(ctx1).ESO(), /선택/);
 const calls = [];
 const ctx2 = makeCtx({selectedIds: () => ['a', 'b'], execute: (c) => {calls.push(c); return [];}});
 installLayerTools(ctx2).ESO();
 assert.deepEqual(calls, [{type: 'batch', commands: [{type: 'visibility', hidden: true}, {type: 'visibility', hidden: false, ids: ['a', 'b']}]}]);
});
