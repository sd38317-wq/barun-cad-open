import test from 'node:test';
import assert from 'node:assert/strict';
import {DrawingEngine} from './engine.js';
import {annotationScaleCommands, annotationAnchor} from './annotation-scale.js';
import {DEFAULT_MATERIALS, MATERIALS_KEY, OPTIONS_KEY, MAX_LEADER_POINTS, MAX_NOTE_LINES, LINE_SPACING,
 parseMaterialText, loadMaterials, saveMaterials, addMaterials, estimateTextWidth, leaderSide, arrowHead, buildMultiLeader, installMleaderTools} from './mleader-tools.js';

const memory = (init = {}) => { const m = new Map(Object.entries(init)); return {map: m, getItem: (k) => m.has(k) ? m.get(k) : null, setItem: (k, v) => m.set(k, String(v))}; };
const P = (x, y) => ({x, y});
const close = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-6, `${msg || ''} ${a} ≠ ${b}`);

test('기본 재료 목록: 15~20개, 요청한 마감 포함, 중복 없음', () => {
 assert.ok(DEFAULT_MATERIALS.length >= 15 && DEFAULT_MATERIALS.length <= 20);
 for (const m of ['THK24 복층유리', 'THK12 석고보드 2겹', '비드법 단열재 가등급 THK100', 'THK200 콘크리트', 'THK10 타일 붙이기', 'THK24 방수몰탈', 'THK9.5 석고보드 위 수성페인트']) assert.ok(DEFAULT_MATERIALS.includes(m), m);
 assert.equal(new Set(DEFAULT_MATERIALS).size, DEFAULT_MATERIALS.length);
 assert.ok(Object.isFrozen(DEFAULT_MATERIALS));
});

test('재료 글 읽기: 공백 정리·빈 줄·중복 제거, 너무 길거나 많으면 거부', () => {
 assert.deepEqual(parseMaterialText('  THK24   복층유리 \r\n\n THK200 콘크리트\nTHK24 복층유리'), ['THK24 복층유리', 'THK200 콘크리트']);
 assert.deepEqual(parseMaterialText(''), []);
 assert.deepEqual(parseMaterialText(undefined), []);
 assert.throws(() => parseMaterialText('가'.repeat(81)), /80자/);
 assert.throws(() => parseMaterialText(Array.from({length: 101}, (_, i) => '재료' + i).join('\n')), /100개/);
 assert.deepEqual(addMaterials(['A', 'B'], ['B', ' C ', '']), ['A', 'B', 'C']);
});

test('목록 저장·불러오기: 없음/깨짐/빈 목록은 기본값, 저장 실패는 한국어 오류', () => {
 const s = memory();
 assert.deepEqual(loadMaterials(s), [...DEFAULT_MATERIALS]);
 assert.deepEqual(loadMaterials(null), [...DEFAULT_MATERIALS]);
 assert.deepEqual(saveMaterials(s, ['THK30 화강석 물갈기', ' THK24 복층유리 ', 'THK30 화강석 물갈기']), ['THK30 화강석 물갈기', 'THK24 복층유리']);
 assert.deepEqual(JSON.parse(s.map.get(MATERIALS_KEY)), ['THK30 화강석 물갈기', 'THK24 복층유리']);
 assert.deepEqual(loadMaterials(s), ['THK30 화강석 물갈기', 'THK24 복층유리']);
 assert.deepEqual(loadMaterials(memory({[MATERIALS_KEY]: '{깨짐'})), [...DEFAULT_MATERIALS]);
 assert.deepEqual(loadMaterials(memory({[MATERIALS_KEY]: '[]'})), [...DEFAULT_MATERIALS]);
 assert.deepEqual(loadMaterials(memory({[MATERIALS_KEY]: JSON.stringify([3, null, ' 타일 ', '타일'])})), ['타일']);
 assert.throws(() => saveMaterials(s, ['  ', '']), /하나 이상/);
 assert.deepEqual(loadMaterials(s), ['THK30 화강석 물갈기', 'THK24 복층유리'], '실패한 저장은 기존 목록을 건드리지 않음');
 assert.throws(() => saveMaterials({getItem: () => null, setItem: () => { throw Error('quota'); }}, ['A']), /저장하지 못했습니다/);
 assert.throws(() => saveMaterials(undefined, ['A']), /저장하지 못했습니다/);
 const blocked = {getItem: () => { throw Error('denied'); }};
 assert.deepEqual(loadMaterials(blocked), [...DEFAULT_MATERIALS]);
});

test('문자 폭 추정: 한글은 넓게, 여러 줄은 가장 긴 줄', () => {
 close(estimateTextWidth('AB', 100), 130);
 close(estimateTextWidth('가나', 100), 220);
 close(estimateTextWidth('A\n가나다', 10), 33);
 assert.ok(estimateTextWidth('THK24 복층유리', 1) > estimateTextWidth('THK24 ABCD', 1));
 assert.equal(estimateTextWidth('', 10), 0);
});

test('문자 쪽: 마지막 선 방향, 수직이면 앞 점을 봄', () => {
 assert.equal(leaderSide([P(0, 0), P(1000, 1000)]), 1);
 assert.equal(leaderSide([P(0, 0), P(-1000, 500)]), -1);
 assert.equal(leaderSide([P(0, 0), P(-500, 0), P(-500, 800)]), -1);
 assert.equal(leaderSide([P(0, 0), P(0, 800)]), 1);
});

test('화살표 머리: 채움·빈·열림·점·없음, 크기와 방향', () => {
 const filled = arrowHead(P(0, 0), P(1000, 0), 250, 'filled');
 assert.equal(filled.length, 2);
 assert.equal(filled[0].type, 'polyline');
 assert.equal(filled[0].closed, true);
 assert.deepEqual(filled[0].points[0], P(0, 0), '삼각형 꼭짓점이 화살표 끝');
 close(filled[0].points[1].x, 250);
 close(Math.abs(filled[0].points[1].y - filled[0].points[2].y), 250 / 3, '폭 = 길이/3');
 assert.equal(filled[1].type, 'hatch');
 assert.equal(filled[1].solid, true);
 assert.deepEqual(filled[1].points, filled[0].points);
 assert.notEqual(filled[1].points, filled[0].points, '점 배열은 따로');
 const closed = arrowHead(P(0, 0), P(0, 500), 100, 'closed');
 assert.equal(closed.length, 1);
 close(closed[0].points[1].y, 100, '위쪽으로 향함');
 const open = arrowHead(P(0, 0), P(1000, 0), 100, 'open');
 assert.equal(open[0].closed, false);
 assert.deepEqual(open[0].points[1], P(0, 0));
 const dot = arrowHead(P(5, 5), P(1000, 0), 200, 'dot');
 assert.equal(dot[0].type, 'circle');
 assert.equal(dot[0].radius, 50);
 assert.equal(dot[1].points.length, 24);
 assert.deepEqual(arrowHead(P(0, 0), P(1, 0), NaN, 'none'), []);
 assert.throws(() => arrowHead(P(0, 0), P(1, 0), 100, 'star'), /알 수 없습니다/);
 assert.throws(() => arrowHead(P(0, 0), P(1, 0), 0, 'filled'), /0보다/);
 assert.throws(() => arrowHead(P(0, 0), P(1, 0), -5, 'dot'));
 assert.throws(() => arrowHead(P(0, 0), P(1, 0), Infinity, 'open'));
});

test('다중 지시선 기하: 여러 꺾임 + 오른쪽 밑줄형 착지선 + 여러 줄 위로 쌓기', () => {
 const pts = [P(0, 0), P(1000, 1500), P(1500, 1500), P(2500, 2500)];
 const lines = ['THK24 복층유리', 'THK12 석고보드 2겹'];
 const b = buildMultiLeader(pts, lines, {scale: 100, textPaper: 2.5, arrow: 'filled', arrowPaper: 2.5, landingPaper: 4, attach: 'above'});
 assert.equal(b.type, 'block');
 assert.equal(b.name, '지시선');
 assert.equal(b.mleader, true);
 const [path, headLine, headFill, text] = b.entities;
 assert.equal(b.entities.length, 4);
 assert.equal(path.type, 'polyline');
 assert.equal(path.closed, false);
 assert.deepEqual(path.points.slice(0, 4), pts, '찍은 점 그대로');
 const th = 250, gap = th * 0.4, width = estimateTextWidth(lines.join('\n'), th);
 assert.deepEqual(path.points[4], P(2500 + width + 2 * gap, 2500), '착지선은 문자 폭만큼 오른쪽 수평');
 assert.equal(headLine.closed, true);
 assert.equal(headFill.solid, true);
 assert.deepEqual(headLine.points[0], P(0, 0));
 assert.equal(text.type, 'text');
 assert.equal(text.text, 'THK24 복층유리\nTHK12 석고보드 2겹');
 assert.equal(text.height, 250);
 assert.equal(text.align, 'left');
 assert.equal(text.leader, true);
 close(text.position.x, 2500 + gap);
 close(text.position.y, 2500 + gap + LINE_SPACING * th, '두 줄이면 첫 줄이 한 줄 간격 위');
 assert.deepEqual(annotationAnchor(b), P(0, 0), 'ANNOSCALE 기준점 = 화살표 끝');
});

test('다중 지시선 기하: 왼쪽 · 가운데 맞춤 · 착지선 길이 · 착지선 없음 · 축척', () => {
 const b = buildMultiLeader([P(0, 0), P(-1000, 1000)], ['THK200 콘크리트'], {scale: 50, textPaper: 3, landingPaper: 6, attach: 'middle', arrow: 'open'});
 const [path, head, text] = b.entities;
 assert.deepEqual(path.points.at(-1), P(-1000 - 300, 1000), '착지선 6mm × 1:50 왼쪽');
 assert.equal(head.closed, false);
 assert.equal(text.align, 'right');
 assert.equal(text.height, 150);
 close(text.position.x, -1300 - 60);
 close(text.position.y, 1000 - 75, '한 줄은 가운데가 착지선 높이');
 const three = buildMultiLeader([P(0, 0), P(100, 100)], ['a', 'b', 'c'], {scale: 100, textPaper: 2, attach: 'middle', landingPaper: 0, arrow: 'none'});
 assert.equal(three.entities.length, 2, '화살표 없음');
 assert.equal(three.entities[0].points.length, 2, '착지선 0 이면 점 추가 없음');
 close(three.entities[1].position.x, 100 + 80);
 close(three.entities[1].position.y, 100 - 100 + LINE_SPACING * 200, '세 줄 묶음 가운데');
 const longLanding = buildMultiLeader([P(0, 0), P(100, 100)], ['a'], {scale: 100, textPaper: 2.5, landingPaper: 20, attach: 'above'});
 assert.deepEqual(longLanding.entities[0].points.at(-1), P(2100, 100), '착지선 최소 길이가 문자 폭보다 길면 그 길이');
 const dup = buildMultiLeader([P(0, 0), P(0, 0), P(100, 100), P(100, 100)], [' 타일 ', '', '  '], {});
 assert.equal(dup.entities[0].points.length, 3, '겹친 점은 하나로');
 assert.equal(dup.entities.at(-1).text, '타일');
});

test('다중 지시선 기하: 잘못된 입력은 거부', () => {
 const ok = [P(0, 0), P(100, 100)];
 assert.throws(() => buildMultiLeader([P(0, 0)], ['a']), /두 점/);
 assert.throws(() => buildMultiLeader([P(0, 0), P(0, 0)], ['a']), /두 점/);
 assert.throws(() => buildMultiLeader(null, ['a']), /두 점/);
 assert.throws(() => buildMultiLeader([P(0, 0), P(NaN, 1)], ['a']), /좌표/);
 assert.throws(() => buildMultiLeader([P(0, 0), null], ['a']), /좌표/);
 assert.throws(() => buildMultiLeader(Array.from({length: MAX_LEADER_POINTS + 1}, (_, i) => P(i * 10, i % 2)), ['a']), /까지/);
 assert.throws(() => buildMultiLeader(ok, []), /재료/);
 assert.throws(() => buildMultiLeader(ok, ['  ']), /재료/);
 assert.throws(() => buildMultiLeader(ok, Array.from({length: MAX_NOTE_LINES + 1}, (_, i) => 'm' + i)), /줄까지/);
 for (const scale of [0, -100, NaN, Infinity]) assert.throws(() => buildMultiLeader(ok, ['a'], {scale}), /축척/);
 for (const textPaper of [0, -1, NaN]) assert.throws(() => buildMultiLeader(ok, ['a'], {textPaper}), /문자 높이/);
 for (const landingPaper of [-1, NaN]) assert.throws(() => buildMultiLeader(ok, ['a'], {landingPaper}), /착지선/);
 assert.throws(() => buildMultiLeader(ok, ['a'], {arrowPaper: 0}), /화살표 크기/);
 assert.throws(() => buildMultiLeader(ok, ['a'], {arrow: 'star'}), /화살표/);
 assert.throws(() => buildMultiLeader(ok, ['a'], {attach: 'below'}), /문자 위치/);
});

test('엔진 검사 통과 + ANNOSCALE 로 줄여도 화살표 끝은 제자리', () => {
 const engine = new DrawingEngine();
 const block = buildMultiLeader([P(1000, 1000), P(2000, 2000), P(3000, 2000)], ['THK24 방수몰탈', 'THK200 콘크리트'], {arrow: 'dot'});
 const tag = (e) => ({...e, layer: 'default', ...(e.entities ? {entities: e.entities.map(tag)} : {})});
 const [id] = engine.execute({type: 'addMany', entities: [tag(block)]});
 const saved = engine.doc.entities.find(e => e.id === id);
 const {commands, counts} = annotationScaleCommands([saved], 0.5);
 assert.equal(counts.symbol, 1);
 engine.execute({type: 'batch', commands});
 const scaled = engine.doc.entities.find(e => e.id === id);
 assert.deepEqual(scaled.entities[0].points[0], P(1000, 1000));
 assert.equal(scaled.entities.find(e => e.type === 'text').height, 125);
});

// 가짜 문맥: 실제 엔진 + app.js cardFormApply 처럼 [적용] 한 번을 되돌리기 한 단계로 묶는다.
function harness({points = [P(0, 0), P(1000, 1000), P(2000, 1000)], storage = memory(), active = 'default'} = {}) {
 const engine = new DrawingEngine();
 const toasts = [], forms = [], picks = [];let pending = null, selectedIds = [];
 const ensureLayer = (name, color) => { const f = engine.doc.layers.find(l => l.name === name); if (f) return f.id; engine.execute({type: 'layer.add', name, color}); return engine.doc.layers.find(l => l.name === name).id; };
 const ctx = {storage, layers: () => engine.doc.layers, ensureLayer, activeLayer: () => active, execute: (c) => engine.execute(c), setSelected: (ids) => { selectedIds = ids; },
  toast: (m) => toasts.push(m), getSettings: () => ({denominator: 100, paperTextHeight: 2.5}),
  pickPath: async (opts) => { picks.push(opts); return points ? {points, closed: false} : null; },
  form: (title, fields, onApply) => { forms.push({title, fields}); pending = (values) => { engine.beginTransaction(); try { return onApply({...Object.fromEntries(fields.map(f => [f.name, f.value])), ...values}); } finally { engine.endTransaction(); } }; }};
 return {engine, ctx, toasts, forms, picks, storage, apply: (v = {}) => pending(v), field: (name) => forms.at(-1).fields.find(f => f.name === name), selected: () => selectedIds};
}

test('MLEADER: 점 → 목록 2개 + 직접 입력 → 블록 하나, 목록 추가·설정 기억, 되돌리기 한 번', async () => {
 const h = harness();
 const cmds = installMleaderTools(h.ctx);
 await cmds.MLEADER();
 assert.equal(h.picks[0].minPoints, 2);
 assert.equal(h.picks[0].maxPoints, MAX_LEADER_POINTS);
 const preview = h.picks[0].preview([P(0, 0), P(500, 500)], P(900, 500));
 assert.ok(preview.some(e => e.type === 'text' && e.text === DEFAULT_MATERIALS[0]), '미리보기에 첫 재료');
 assert.deepEqual(h.picks[0].preview([P(0, 0)], null), []);
 assert.equal(h.field('m1').value, DEFAULT_MATERIALS[0], '처음엔 목록 첫 재료');
 assert.equal(h.field('m2').value, '');
 assert.equal(h.field('scale').value, 100);
 assert.ok(h.field('m1').options.some(([v]) => v === 'THK24 방수몰탈'));
 h.apply({m1: 'THK24 복층유리', m2: 'THK12 석고보드 2겹', custom: '  THK50 알루미늄 루버 \n\nTHK24 복층유리', remember: 'on'});
 assert.equal(h.engine.doc.entities.length, 1);
 const block = h.engine.doc.entities[0];
 assert.equal(block.name, '지시선');
 assert.equal(block.layer, 'default');
 assert.ok(block.entities.every(e => e.layer === 'default'), '내부 객체도 레이어');
 const text = block.entities.find(e => e.type === 'text');
 assert.equal(text.text, 'THK24 복층유리\nTHK12 석고보드 2겹\nTHK50 알루미늄 루버', '중복은 한 번');
 assert.equal(text.height, 250);
 assert.deepEqual(block.entities[0].points[0], P(0, 0));
 assert.deepEqual(h.selected(), [block.id]);
 assert.ok(loadMaterials(h.storage).includes('THK50 알루미늄 루버'), '직접 입력을 목록 끝에 추가');
 assert.equal(loadMaterials(h.storage).at(-1), 'THK50 알루미늄 루버');
 const opts = JSON.parse(h.storage.map.get(OPTIONS_KEY));
 assert.deepEqual(opts.picks, ['THK24 복층유리', 'THK12 석고보드 2겹', '', '']);
 assert.match(h.toasts.at(-1), /재료 3줄/);
 h.engine.execute({type: 'undo'});
 assert.equal(h.engine.doc.entities.length, 0);
 // 다시 열면 지난번 고른 재료가 기본값
 await cmds.MLEADER();
 assert.equal(h.field('m1').value, 'THK24 복층유리');
 assert.equal(h.field('m2').value, 'THK12 석고보드 2겹');
});

test('MLEADER: Esc 로 점 입력을 취소하면 아무것도 하지 않음', async () => {
 const h = harness({points: null});
 await installMleaderTools(h.ctx).MLEADER();
 assert.equal(h.forms.length, 0);
 assert.equal(h.engine.doc.entities.length, 0);
});

test('MLEADER: 잘못된 숫자·재료 없음·잠긴/숨긴 레이어는 막고 아무것도 남기지 않음', async () => {
 const h = harness();
 const cmds = installMleaderTools(h.ctx);
 await cmds.MLEADER();
 const before = h.storage.map.get(OPTIONS_KEY);
 for (const bad of [{scale: 0}, {scale: -50}, {scale: 'abc'}, {scale: ''}, {textPaper: 0}, {textPaper: NaN}, {landingPaper: -1}, {arrowPaper: 0}, {arrowPaper: -2}])
  await assert.rejects(() => h.apply(bad), /입력|0보다|이상/, JSON.stringify(bad));
 await assert.rejects(() => h.apply({m1: '', custom: '   '}), /재료/);
 await assert.rejects(() => h.apply({custom: '가'.repeat(90)}), /80자/);
 assert.equal(h.engine.doc.entities.length, 0);
 assert.equal(h.storage.map.get(OPTIONS_KEY), before, '실패하면 설정도 그대로');
 // 화살표 없음이면 화살표 크기는 보지 않음
 h.apply({arrow: 'none', arrowPaper: 0});
 assert.equal(h.engine.doc.entities[0].entities.length, 2);
 h.engine.execute({type: 'undo'});
 // 잠긴 현재 레이어
 h.engine.execute({type: 'layer.update', id: 'default', changes: {locked: true}});
 await assert.rejects(() => h.apply({}), /잠김\/숨김/);
 h.engine.execute({type: 'layer.update', id: 'default', changes: {locked: false, visible: false}});
 await assert.rejects(() => h.apply({}), /잠김\/숨김/);
 assert.equal(h.engine.doc.entities.length, 0);
});

test('MLEADER: 주석 문자 레이어를 고르면 만들어 넣고, 되돌리면 레이어까지 한 번에', async () => {
 const h = harness();
 const cmds = installMleaderTools(h.ctx);
 await cmds.MLEADER();
 const layerCount = h.engine.doc.layers.length;
 h.apply({layer: 'A-TEXT', attach: 'middle', arrow: 'closed', scale: 50, textPaper: 3});
 const layer = h.engine.doc.layers.find(l => l.name === 'A-TEXT');
 assert.ok(layer);
 const block = h.engine.doc.entities[0];
 assert.equal(block.layer, layer.id);
 assert.ok(block.entities.every(e => e.layer === layer.id));
 assert.equal(block.entities.find(e => e.type === 'text').height, 150);
 h.engine.execute({type: 'undo'});
 assert.equal(h.engine.doc.entities.length, 0);
 assert.equal(h.engine.doc.layers.length, layerCount);
 // 이미 있는 주석 레이어가 잠겨 있으면 거부
 await cmds.MLEADER();
 h.apply({layer: 'A-TEXT'});
 h.engine.execute({type: 'layer.update', id: h.engine.doc.layers.find(l => l.name === 'A-TEXT').id, changes: {locked: true}});
 assert.rejects(() => h.apply({layer: 'A-TEXT'}), /A-TEXT/);
 assert.equal(h.engine.doc.entities.length, 1);
 // 설정 기억: 다음 창의 레이어 기본값
 await cmds.MLEADER();
 assert.equal(h.field('layer').value, 'A-TEXT');
});

test('MLEADER 안에서 목록 편집 → 저장 → 같은 점으로 재료 창에 돌아와 그림', async () => {
 const h = harness();
 await installMleaderTools(h.ctx).MLEADER();
 h.apply({editList: 'on'});
 assert.equal(h.engine.doc.entities.length, 0, '편집만 하고 그리지 않음');
 assert.match(h.forms.at(-1).title, /재료 목록/);
 assert.equal(h.field('items').type, 'textarea');
 assert.equal(h.field('items').value, DEFAULT_MATERIALS.join('\n'));
 h.apply({items: 'THK30 화강석 물갈기\nTHK24 복층유리\n\nTHK12 석고보드 2겹'});
 assert.deepEqual(loadMaterials(h.storage), ['THK30 화강석 물갈기', 'THK24 복층유리', 'THK12 석고보드 2겹']);
 assert.match(h.forms.at(-1).title, /점 3개/);
 assert.deepEqual(h.field('m1').options.map(([v]) => v), ['', 'THK30 화강석 물갈기', 'THK24 복층유리', 'THK12 석고보드 2겹']);
 h.apply({m1: 'THK30 화강석 물갈기'});
 assert.equal(h.engine.doc.entities.length, 1);
 assert.deepEqual(h.engine.doc.entities[0].entities[0].points.slice(0, 3), [P(0, 0), P(1000, 1000), P(2000, 1000)]);
});

test('MLEADERLIST: 저장·정렬·기본값 되돌리기, 비우면 거부', async () => {
 const h = harness();
 const cmds = installMleaderTools(h.ctx);
 cmds.MLEADERLIST();
 h.apply({items: '타일\n석고보드\n콘크리트', action: 'sort'});
 assert.deepEqual(loadMaterials(h.storage), ['석고보드', '콘크리트', '타일']);
 cmds.MLEADERLIST();
 assert.equal(h.field('items').value, '석고보드\n콘크리트\n타일');
 await assert.rejects(Promise.resolve().then(() => h.apply({items: '\n  \n'})), /하나 이상/);
 assert.deepEqual(loadMaterials(h.storage), ['석고보드', '콘크리트', '타일']);
 h.apply({action: 'reset', items: ''});
 assert.deepEqual(loadMaterials(h.storage), [...DEFAULT_MATERIALS]);
 assert.match(h.toasts.at(-1), /기본/);
 assert.equal(h.engine.doc.entities.length, 0, '목록 편집은 도면을 바꾸지 않음');
});

test('LSE: 다중 지시선도 화살표만 바꾸고 꺾임 경로·여러 줄 문자는 그대로', async () => {
 const {restyleLeaderBlock} = await import('./dim-symbol-tools.js');
 const {buildMultiLeader} = await import('./mleader-tools.js');
 const built = buildMultiLeader([{x: 0, y: 0}, {x: 1000, y: 1000}, {x: 2000, y: 1000}], ['THK24 복층유리', 'THK12 석고보드'], {scale: 100});
 const block = {type: 'block', name: '지시선', mleader: true, entities: built.entities || built};
 const out = restyleLeaderBlock(block, {shape: 'circle', arrowScale: 1});
 const path = block.entities.find(e => e.type === 'polyline' && !e.closed);
 assert.deepEqual(out.entities[0].points, path.points);
 assert.equal(out.entities[1].type, 'circle');
 assert.equal(out.entities.filter(e => e.type === 'text').length, block.entities.filter(e => e.type === 'text').length);
});
