// 519 다중 지시선 스타일·정렬(MLEADERALIGN)·모으기(MLEADERCOLLECT).
import test from 'node:test';
import assert from 'node:assert/strict';
import {DrawingEngine} from './engine.js';
import * as G from './geometry.js';
import {buildMultiLeader, readMultiLeader, alignMultiLeaders, collectMultiLeaders, restyleMultiLeader, mleaderStyleTable, currentMleaderStyle, resolveMleaderStyle,
 mleaderOverrides, validateMleaderStyle, installMleaderTools, BUILTIN_MLEADER_STYLES, DEFAULT_MLEADER_STYLE, OPTIONS_KEY, LINE_SPACING} from './mleader-tools.js';

const P = (x, y) => ({x, y});
const close = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-6, `${msg || ''} ${a} ≠ ${b}`);
const tag = (e, id) => ({...e, ...(id ? {id} : {}), layer: 'default', ...(e.entities ? {entities: e.entities.map(c => tag(c))} : {})});
const leader = (id, pts, lines, opts = {}) => tag(buildMultiLeader(pts, lines, {scale: 100, ...opts}), id);

test('스타일 표: 기본 Standard·건축 재료, 도면에 저장한 값이 덮음, 현재 스타일', () => {
 assert.deepEqual(Object.keys(mleaderStyleTable(null)), ['Standard', DEFAULT_MLEADER_STYLE]);
 assert.equal(currentMleaderStyle(null), DEFAULT_MLEADER_STYLE);
 const doc = {projectSettings: {mleaderStyles: {Standard: {arrow: 'dot'}, '상세': {arrow: 'open', arrowPaper: 2, textPaper: 3, landingPaper: 0, attach: 'middle'}}, currentMleaderStyle: '상세'}};
 const t = mleaderStyleTable(doc);
 assert.equal(t.Standard.arrow, 'dot');
 assert.equal(t.Standard.attach, 'middle', '나머지는 기본값');
 assert.equal(t['상세'].textPaper, 3);
 assert.equal(currentMleaderStyle(doc), '상세');
 assert.equal(currentMleaderStyle({projectSettings: {currentMleaderStyle: '없음'}}), DEFAULT_MLEADER_STYLE);
 assert.equal(resolveMleaderStyle(BUILTIN_MLEADER_STYLES[DEFAULT_MLEADER_STYLE], 3).textPaper, 3, '문자 높이 없음 = 도면 설정');
 assert.deepEqual(mleaderOverrides(resolveMleaderStyle(null, 2.5), {textPaper: 2.5, arrowPaper: 2.5, landingPaper: 6, arrow: 'filled', attach: 'above'}), {landingPaper: 6});
 assert.throws(() => validateMleaderStyle({arrow: 'star', attach: 'above', arrowPaper: 1, textPaper: null, landingPaper: 1}), /화살표/);
 assert.throws(() => validateMleaderStyle({arrow: 'dot', attach: 'above', arrowPaper: 1, textPaper: -1, landingPaper: 1}), /문자 높이/);
});

test('buildMultiLeader: 스타일 이름과 재정의만 블록에, 기하는 예전과 같음', () => {
 const plain = buildMultiLeader([P(0, 0), P(100, 100)], ['a'], {scale: 100});
 const styled = buildMultiLeader([P(0, 0), P(100, 100)], ['a'], {scale: 100, style: '건축 재료', overrides: {landingPaper: 6}});
 assert.equal(plain.mleaderStyle, undefined);
 assert.equal(styled.mleaderStyle, '건축 재료');
 assert.deepEqual(styled.mleaderOverrides, {landingPaper: 6});
 assert.deepEqual(styled.entities, plain.entities);
 assert.equal(buildMultiLeader([P(0, 0), P(1, 1)], ['a'], {style: 'S', overrides: {}}).mleaderOverrides, undefined);
});

test('readMultiLeader: 착지선·착지점·문자 붙임 방식', () => {
 const above = readMultiLeader(leader('a', [P(0, 0), P(1000, 1000)], ['x', 'y']));
 assert.equal(above.shoulder, true);
 assert.deepEqual(above.landing, P(1000, 1000));
 assert.equal(above.attach, 'above');
 assert.deepEqual(above.lines, ['x', 'y']);
 const middle = readMultiLeader(leader('b', [P(0, 0), P(-1000, 1000)], ['x', 'y', 'z'], {attach: 'middle', landingPaper: 0}));
 assert.equal(middle.shoulder, false);
 assert.equal(middle.attach, 'middle');
 assert.equal(middle.side, -1);
 assert.equal(readMultiLeader({type: 'block', name: '표', entities: []}), null);
 assert.equal(readMultiLeader({type: 'text'}), null);
});

test('MLEADERALIGN 간격: 기준 지시선은 제자리, 나머지 착지점이 한 줄로 · 화살 끝은 그대로 · 화살촉은 새 방향으로', () => {
 const a = leader('a', [P(0, 0), P(1000, 3000)], ['A']), b = leader('b', [P(500, 0), P(1800, 2600)], ['B']), c = leader('c', [P(900, 0), P(1500, 1200)], ['C']);
 const updates = alignMultiLeaders([a, b, c], {mode: 'spacing', origin: P(1000, 3000), direction: P(0, -1), spacing: 600, reference: 'a'});
 assert.deepEqual(updates.map(u => u.id), ['b', 'c']);
 const pts = id => updates.find(u => u.id === id).changes.entities[0].points;
 assert.deepEqual(pts('b')[0], P(500, 0), '화살 끝 그대로');
 assert.deepEqual(pts('b')[1], P(1000, 2400));
 assert.deepEqual(pts('c')[1], P(1000, 1800));
 const bText = updates.find(u => u.id === 'b').changes.entities.at(-1);
 close(bText.position.x, b.entities.at(-1).position.x - 800);
 const head = updates.find(u => u.id === 'b').changes.entities[1];
 const dir = G.unit(G.sub(pts('b')[1], pts('b')[0])), apex = head.points[0], mid = G.mul(G.add(head.points[1], head.points[2]), 0.5);
 const hd = G.unit(G.sub(mid, apex));
 close(hd.x, dir.x, '화살촉 방향'); close(hd.y, dir.y);
 assert.deepEqual(apex, P(500, 0));
});

test('MLEADERALIGN 두 점 사이 고르게 · 평행 · 자동 간격', () => {
 const a = leader('a', [P(0, 0), P(1000, 3000)], ['A']), b = leader('b', [P(0, -500), P(1100, 100)], ['B']), c = leader('c', [P(0, -900), P(700, 1500)], ['C']);
 const d = alignMultiLeaders([a, b, c], {mode: 'distribute', origin: P(2000, 0), end: P(2000, 3000)});
 const land = id => readMultiLeader({...[a, b, c].find(l => l.id === id), entities: d.find(u => u.id === id).changes.entities}).landing;
 assert.deepEqual([land('b'), land('c'), land('a')], [P(2000, 0), P(2000, 1500), P(2000, 3000)], '착지점 높이 순서대로');
 const par = alignMultiLeaders([a, b, c], {mode: 'parallel', reference: 'a'});
 for (const u of par) {
  const p = u.changes.entities[0].points, v = G.unit(G.sub(p[1], p[0]));
  close(v.x, 1 / Math.sqrt(10)); close(v.y, 3 / Math.sqrt(10));
 }
 assert.equal(par.find(u => u.id === 'b').changes.entities[0].points[1].y, 100, '착지점 높이는 그대로');
 const auto = alignMultiLeaders([a, b], {mode: 'spacing', direction: P(0, -1)});
 assert.equal(auto.length, 1);
 assert.throws(() => alignMultiLeaders([a], {}), /2개 이상/);
 assert.throws(() => alignMultiLeaders([a, b], {mode: 'distribute', origin: P(0, 0), end: P(0, 0)}), /같습니다/);
});

test('MLEADERCOLLECT: 재료 줄을 위로 쌓고(중복 한 번), 착지선은 넓은 쪽으로, 나머지는 지움', () => {
 const base = leader('a', [P(0, 0), P(1000, 1000)], ['THK24 복층유리']);
 const other = leader('b', [P(0, -500), P(1000, 500)], ['THK12 석고보드 2겹', 'THK24 복층유리']);
 const r = collectMultiLeaders(base, [other, base]);
 assert.deepEqual(r.lines, ['THK24 복층유리', 'THK12 석고보드 2겹']);
 assert.deepEqual(r.remove, ['b']);
 const t = r.update.changes.entities.at(-1), info = readMultiLeader(base);
 assert.equal(t.text, 'THK24 복층유리\nTHK12 석고보드 2겹');
 close(t.position.y, 1000 + 250 * 0.4 + LINE_SPACING * 250, '두 줄이면 한 줄 간격 위로');
 assert.ok(r.update.changes.entities[0].points.at(-1).x >= info.end.x);
 assert.deepEqual(r.update.changes.entities[0].points[0], P(0, 0));
 const mid = leader('m', [P(0, 0), P(1000, 1000)], ['x'], {attach: 'middle'});
 const rm = collectMultiLeaders(mid, [leader('n', [P(0, 0), P(10, 10)], ['y'])]);
 close(rm.update.changes.entities.at(-1).position.y, 1000 - 125 + LINE_SPACING * 125, '가운데 붙임은 묶음 가운데');
 assert.throws(() => collectMultiLeaders(base, []), /2개 이상/);
 const many = leader('z', [P(0, 0), P(10, 10)], Array.from({length: 12}, (_, i) => 'm' + i));
 assert.throws(() => collectMultiLeaders(base, [many]), /12줄까지/);
});

test('restyleMultiLeader: 같은 축척·점·재료로 새 스타일 값에 맞춰 다시 그림', () => {
 const old = BUILTIN_MLEADER_STYLES[DEFAULT_MLEADER_STYLE];
 const l = leader('a', [P(0, 0), P(1000, 1000)], ['x'], {scale: 50, style: DEFAULT_MLEADER_STYLE});
 const u = restyleMultiLeader(l, old, {...old, arrow: 'dot', landingPaper: 20}, 2.5);
 assert.equal(u.changes.entities[1].type, 'circle');
 assert.equal(u.changes.entities.at(-1).height, 125, '축척 1:50 유지');
 assert.ok(u.changes.entities.every(e => e.layer === 'default'));
 assert.deepEqual(u.changes.entities[0].points.at(-1), P(1000 + 20 * 50, 1000));
});

function harness(storageInit = {}) {
 const engine = new DrawingEngine(), toasts = [], storage = new Map(Object.entries(storageInit));
 let selected = [], responses = [], picks = [];
 const ctx = {engine, doc: () => engine.doc, storage: {getItem: k => storage.has(k) ? storage.get(k) : null, setItem: (k, v) => storage.set(k, String(v))},
  entities: () => engine.doc.entities, selected: () => engine.doc.entities.filter(e => selected.includes(e.id)), selectedIds: () => selected, layers: () => engine.doc.layers,
  execute: c => engine.execute(c), setSelected: ids => { selected = ids; }, toast: m => toasts.push(m), getSettings: () => ({denominator: 100, paperTextHeight: 2.5}),
  activeLayer: () => 'default', ensureLayer: () => 'default', pickPoint: async () => picks.shift() ?? null, pickPath: async () => ({points: [P(0, 0), P(1000, 1000)]}),
  form: (title, fields, onApply) => onApply({...Object.fromEntries(fields.map(f => [f.name, f.value])), ...(responses.shift() || {})})};
 return {engine, ctx, toasts, storage, select: ids => { selected = ids; }, respond: (...r) => { responses = r; }, pick: (...p) => { picks = p; }};
}

test('MLEADERALIGN·MLEADERCOLLECT 명령: 고른 순서가 기준, 잠긴 레이어 제외, 되돌리기 한 번', async () => {
 const h = harness();
 const ids = h.engine.execute({type: 'addMany', entities: [leader(undefined, [P(0, 0), P(1000, 3000)], ['A']), leader(undefined, [P(500, 0), P(1800, 2600)], ['B']), leader(undefined, [P(900, 0), P(1500, 1200)], ['C'])]});
 const cmds = installMleaderTools(h.ctx);
 h.select(ids);
 h.respond({mode: 'spacing', spacing: 600});
 h.pick(P(1000, 0));
 await cmds.MLEADERALIGN();
 const lands = h.engine.doc.entities.map(e => readMultiLeader(e).landing);
 assert.deepEqual(lands, [P(1000, 3000), P(1000, 2400), P(1000, 1800)]);
 h.engine.validate(h.engine.doc);
 h.engine.execute({type: 'undo'});
 assert.deepEqual(readMultiLeader(h.engine.doc.entities[1]).landing, P(1800, 2600));
 assert.throws(() => { h.select([ids[0]]); cmds.MLEADERALIGN(); }, /2개 이상/);
 h.select([ids[2], ids[0], ids[1]]);
 const r = cmds.MLEADERCOLLECT();
 assert.deepEqual(r.lines, ['C', 'A', 'B']);
 assert.equal(h.engine.doc.entities.length, 1);
 assert.equal(h.engine.doc.entities[0].id, ids[2]);
 h.engine.execute({type: 'undo'});
 assert.equal(h.engine.doc.entities.length, 3);
 h.engine.execute({type: 'layer.update', id: 'default', changes: {locked: true}});
 h.select(ids);
 assert.throws(() => cmds.MLEADERCOLLECT(), /잠긴 레이어 3개 제외/);
});

test('MLEADERSTYLE → MLEADER: 새 스타일 저장·현재로, 그 스타일 지시선 다시 그림, 다음 MLEADER 는 그 값, 블록엔 이름만', async () => {
 const h = harness();
 const [old] = h.engine.execute({type: 'addMany', entities: [leader(undefined, [P(0, 0), P(1000, 1000)], ['x'], {style: DEFAULT_MLEADER_STYLE})]});
 const cmds = installMleaderTools(h.ctx);
 h.respond({action: 'save', arrow: 'dot', landingPaper: 10, textPaper: 0});
 cmds.MLEADERSTYLE();
 assert.equal(h.engine.doc.projectSettings.currentMleaderStyle, DEFAULT_MLEADER_STYLE);
 assert.equal(h.engine.doc.projectSettings.mleaderStyles[DEFAULT_MLEADER_STYLE].arrow, 'dot');
 assert.equal(h.engine.doc.projectSettings.mleaderStyles[DEFAULT_MLEADER_STYLE].textPaper, null);
 assert.equal(h.engine.doc.entities.find(e => e.id === old).entities[1].type, 'circle', '다시 그림');
 h.engine.execute({type: 'undo'});
 assert.equal(h.engine.doc.projectSettings?.mleaderStyles, undefined, '되돌리기 한 번에 스타일·지시선 모두');
 h.respond({name: '__new__', newName: '상세 지시', action: 'save', arrow: 'open', arrowPaper: 2, textPaper: 3, landingPaper: 0, attach: 'middle'});
 cmds.MLEADERSTYLE();
 assert.equal(currentMleaderStyle(h.engine.doc), '상세 지시');
 h.respond({m1: 'THK24 복층유리'});
 h.pick(P(1000, 1000));
 await cmds.MLEADER();
 const block = h.engine.doc.entities.at(-1);
 assert.equal(block.mleaderStyle, '상세 지시');
 assert.equal(block.mleaderOverrides, undefined, '스타일 값 그대로면 재정의 없음');
 assert.equal(block.entities.at(-1).height, 300, '문자 3mm × 1:100');
 assert.equal(block.entities[1].closed, false, '열린 화살표');
 assert.equal(JSON.parse(h.storage.get(OPTIONS_KEY)).style, '상세 지시');
});
