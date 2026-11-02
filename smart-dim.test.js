import test from 'node:test';
import assert from 'node:assert/strict';
import {DrawingEngine} from './engine.js';
import {applyDimStyle, getDimStyle} from './dimension-style.js';
import * as G from './geometry.js';
import {
 classifyPick, buildSmartDimension, linearMode, angularSpec, twoPointSpec, dimensionText,
 findPickTarget, smartDimCandidates, createTargetFinder, secondLineAt, installSmartDim, SMART_DIM_TYPES,
} from './smart-dim.js';

const P = (x, y) => ({x, y});
const near = (a, b, msg, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${msg ?? ''} ${a} ≈ ${b}`);
const nearPoint = (p, q, msg) => { near(p.x, q.x, msg); near(p.y, q.y, msg); };
const label = (spec, at) => dimensionText(buildSmartDimension(spec, at));

const SLANT = {id: 's', type: 'line', points: [P(0, 0), P(4000, 3000)]};
const L1 = {id: 'l1', type: 'line', points: [P(0, 0), P(3000, 0)]};
const L2 = {id: 'l2', type: 'line', points: [P(0, 0), P(1000, 1000 * Math.sqrt(3))]}; // 60°

test('선형 종류: 커서 위치로 수평·수직·정렬 (DIMLINEAR 규칙 + 기울어진 선의 정렬)', () => {
 const [a, b] = SLANT.points;
 assert.equal(linearMode(a, b, P(2000, 5000)), 'horizontal', '위로만 벗어남');
 assert.equal(linearMode(a, b, P(2000, -800)), 'horizontal', '아래로만 벗어남');
 assert.equal(linearMode(a, b, P(6000, 1500)), 'vertical', '오른쪽으로만 벗어남');
 assert.equal(linearMode(a, b, P(-500, 1500)), 'vertical', '왼쪽으로만 벗어남');
 assert.equal(linearMode(a, b, P(1000, 2000)), 'aligned', '경계 상자 안 = 선에 수직으로 뗌');
 assert.equal(linearMode(a, b, P(-1000, 4000)), 'aligned', '모서리 밖이지만 선 길이 범위(수직 띠) 안');
 assert.equal(linearMode(a, b, P(6000, 8000)), 'horizontal', '끝 너머 모서리: 위로 더 벗어남');
 assert.equal(linearMode(a, b, P(9000, 3500)), 'vertical', '끝 너머 모서리: 옆으로 더 벗어남');
 // 축에 나란한 선은 그 축 그대로
 assert.equal(linearMode(P(0, 0), P(3000, 0), P(5000, 100)), 'horizontal');
 assert.equal(linearMode(P(0, 0), P(0, 3000), P(100, 5000)), 'vertical');
});

test('선 → 선형: 종류별 측정값이 dimensionParts 문자와 맞음', () => {
 const spec = classifyPick(SLANT, P(1000, 753));
 assert.equal(spec.kind, 'linear');
 assert.equal(spec.straight, true);
 assert.equal(spec.entityId, 's');
 const h = buildSmartDimension(spec, P(2000, 5000));
 assert.equal(h.mode, 'horizontal');
 assert.deepEqual(h.points, [P(0, 0), P(4000, 3000), P(2000, 5000)], '선 끝점 그대로 = STRETCH 연동');
 assert.equal(dimensionText(h), '4000');
 assert.equal(label(spec, P(6000, 1500)), '3000');
 const al = buildSmartDimension(spec, P(1000, 2000));
 assert.equal(al.mode, 'aligned');
 assert.equal(dimensionText(al), '5000');
 // 치수선이 실제로 누른 쪽에 선에 나란히 놓임
 const dimLine = G.dimensionParts(al)[0].points;
 near(G.cross(G.sub(dimLine[1], dimLine[0]), G.sub(P(4000, 3000), P(0, 0))), 0, '평행');
 assert.ok(G.cross(G.sub(P(4000, 3000), P(0, 0)), G.sub(dimLine[0], P(0, 0))) > 0, '왼쪽(위쪽)으로 떨어짐');
});

test('원 → 지름, 호 → 반지름(호 범위 안으로)', () => {
 const circle = {id: 'c', type: 'circle', center: P(100, 200), radius: 1000};
 const d = classifyPick(circle, P(1100, 203));
 assert.deepEqual(d, {kind: 'diameter', center: P(100, 200), radius: 1000, entityId: 'c'});
 const dim = buildSmartDimension(d, P(2100, 2200));
 assert.equal(dim.mode, 'diameter');
 assert.equal(dimensionText(dim), 'Ø 2000');
 nearPoint(dim.points[1], G.add(P(100, 200), G.polar(1000, 45)), '방향 45°');
 const centerPlaced = buildSmartDimension(d, P(100, 200));
 assert.deepEqual(centerPlaced.points[2], centerPlaced.points[1], '중심을 누르면 0° 방향 원 위 점');

 const arc = {id: 'a', type: 'arc', center: P(0, 0), radius: 1500, startAngle: 0, endAngle: 90};
 const r = classifyPick(arc, P(1060, 1060));
 assert.equal(r.kind, 'radius');
 const inside = buildSmartDimension(r, P(1000, 1000));
 assert.equal(inside.mode, 'radius');
 assert.equal(dimensionText(inside), 'R 1500');
 nearPoint(inside.points[1], G.polar(1500, 45));
 nearPoint(buildSmartDimension(r, P(-1000, -10)).points[1], P(0, 1500), '바깥 방향은 가까운 호 끝(90°)');
 nearPoint(buildSmartDimension(r, P(100, -1000)).points[1], P(1500, 0), '바깥 방향은 가까운 호 끝(0°)');
 // 180° 를 넘는 호(270°→90°, 왼쪽 반원이 빠진 호)
 const wide = classifyPick({type: 'arc', center: P(0, 0), radius: 500, startAngle: 270, endAngle: 90}, P(500, 0));
 nearPoint(buildSmartDimension(wide, P(900, 100)).points[1], G.polar(500, G.angle(P(900, 100))), '호 범위 안(0° 부근)은 그대로');
});

test('폴리선·사각형 → 누른 구간(닫는 구간 포함)', () => {
 const pl = {id: 'p', type: 'polyline', closed: true, points: [P(0, 0), P(6000, 0), P(6000, 4000), P(0, 4000)]};
 const right = classifyPick(pl, P(6003, 1500));
 assert.equal(right.segment, 1);
 assert.equal(buildSmartDimension(right, P(7000, 2000)).mode, 'vertical');
 assert.equal(label(right, P(7000, 2000)), '4000');
 const top = classifyPick(pl, P(2500, 3998));
 assert.equal(top.segment, 2);
 assert.equal(label(top, P(2500, 5000)), '6000');
 const closing = classifyPick(pl, P(2, 1200));
 assert.equal(closing.segment, 3);
 assert.deepEqual([closing.a, closing.b], [P(0, 4000), P(0, 0)]);
 const rect = {id: 'r', type: 'rectangle', points: [P(0, 0), P(2000, 0), P(2000, 1000), P(0, 1000)]};
 assert.equal(label(classifyPick(rect, P(-3, 500)), P(-800, 500)), '1000');
 const bent = {id: 'b', type: 'polyline', points: [P(0, 0), P(3000, 0), P(6000, 4000)]};
 assert.equal(label(classifyPick(bent, P(4500, 2003)), P(3000, 4000)), '5000', '기울어진 구간은 정렬');
 // 길이 0 구간은 건너뛰고 옆 구간을 고름
 const dup = {id: 'd', type: 'polyline', points: [P(0, 0), P(0, 0), P(0, 2500)]};
 assert.equal(classifyPick(dup, P(0, 5)).segment, 1);
});

test('두 선 → 각도: 마지막 점이 든 사분면의 각', () => {
 const s1 = classifyPick(L1, P(1500, 3)), s2 = classifyPick(L2, P(300, 520));
 const ang = angularSpec(s1, s2);
 nearPoint(ang.center, P(0, 0));
 const cases = [[P(1000, 300), '60°'], [P(-1000, 300), '120°'], [P(-1000, -300), '60°'], [P(1000, -300), '120°']];
 for (const [at, text] of cases) {
  const dim = buildSmartDimension(ang, at);
  assert.equal(dim.mode, 'angular');
  assert.equal(dim.points.length, 4);
  assert.equal(dimensionText(dim), text, `${at.x},${at.y}`);
 }
 const q1 = buildSmartDimension(ang, P(1000, 300));
 assert.deepEqual(q1.points[1], P(3000, 0), '실제 선 끝점을 씀');
 nearPoint(q1.points[2], P(1000, 1000 * Math.sqrt(3)));
 const q2 = buildSmartDimension(ang, P(-1000, 300));
 nearPoint(q2.points[1], P(-G.len(P(-1000, 300)), 0), '선이 없는 쪽 반직선은 호 반지름 거리의 임시 점');
 // 닿지 않는 두 선: 연장 교점 기준
 const far = angularSpec(s1, classifyPick({id: 'f', type: 'line', points: [P(4000, 1000), P(5000, 2000)]}, P(4500, 1500)));
 nearPoint(far.center, P(3000, 0));
 assert.equal(label(far, P(4000, 500)), '45°');
 assert.equal(label(far, P(2000, 500)), '135°');
 // 엔진 검증을 통과하는 모양
 const engine = new DrawingEngine();
 engine.execute({type: 'add', entity: {...buildSmartDimension(ang, P(-1000, -300)), textHeight: 150, layer: 'default'}});
 assert.equal(engine.doc.entities.length, 1);
});

test('두 점 선형과 잘못된 입력', () => {
 const two = twoPointSpec(P(0, 0), P(3000, 4000));
 assert.equal(two.straight, false);
 assert.equal(label(two, P(1000, 3000)), '5000');
 assert.equal(label(two, P(1500, 6000)), '3000');
 assert.throws(() => twoPointSpec(P(1, 1), P(1, 1)), /같습니다/);
 assert.throws(() => twoPointSpec(P(1, 1), {x: NaN, y: 0}));
 assert.throws(() => classifyPick(null, P(0, 0)));
 assert.throws(() => classifyPick(L1, null));
 assert.throws(() => classifyPick({type: 'text', position: P(0, 0), text: 'A'}, P(0, 0)), /선·폴리선/);
 assert.throws(() => classifyPick({type: 'line', points: [P(5, 5), P(5, 5)]}, P(5, 5)), /길이가 0/);
 assert.throws(() => classifyPick({type: 'circle', center: P(0, 0), radius: 0}, P(0, 0)));
 assert.throws(() => classifyPick({type: 'arc', center: P(0, 0), radius: 10, startAngle: NaN, endAngle: 90}, P(10, 0)));
 assert.throws(() => buildSmartDimension(two, {x: Infinity, y: 0}));
 assert.throws(() => buildSmartDimension({kind: 'nope'}, P(0, 0)), /알 수 없는/);
 assert.throws(() => buildSmartDimension(null, P(0, 0)));
 assert.throws(() => buildSmartDimension({kind: 'linear', a: P(0, 0), b: P(0, 0)}, P(1, 1)));
 const s1 = classifyPick(L1, P(10, 1));
 assert.throws(() => angularSpec(s1, classifyPick({id: 'x', type: 'line', points: [P(0, 500), P(3000, 500)]}, P(10, 500))), /평행/);
 assert.throws(() => angularSpec(s1, s1), /같은 선/);
 assert.throws(() => angularSpec(s1, two), /곧은 선/);
 assert.throws(() => buildSmartDimension(angularSpec(s1, classifyPick(L2, P(300, 520))), P(0, 0)), /교점/);
 assert.throws(() => findPickTarget([L1], {x: NaN, y: 0}, {tolerance: 10}));
});

test('누른 점 해석: 객체 / 빈 곳 / 스냅 점(끝점·중간점·교차점·사분점)', () => {
 const layers = [{id: 'default', visible: true}, {id: 'off', visible: false}, {id: 'ice', visible: true, frozen: true}];
 const circle = {id: 'c', type: 'circle', center: P(10000, 0), radius: 1000, layer: 'default'};
 const all = [
  {...L1, layer: 'default'}, {...L2, layer: 'default'}, circle,
  {id: 'cross', type: 'line', points: [P(1500, -1000), P(1500, 1000)], layer: 'default'},
  {id: 'hid', type: 'line', points: [P(0, 5000), P(3000, 5000)], layer: 'off'},
  {id: 'frz', type: 'line', points: [P(0, 6000), P(3000, 6000)], layer: 'ice'},
  {id: 'own', type: 'line', points: [P(0, 7000), P(3000, 7000)], layer: 'default', hidden: true},
  {id: 't', type: 'text', position: P(0, 8000), text: 'A', height: 100, layer: 'default'},
 ];
 const pool = smartDimCandidates(all, layers);
 assert.deepEqual(pool.map(e => e.id), ['l1', 'l2', 'c', 'cross']);
 assert.deepEqual(SMART_DIM_TYPES, ['line', 'polyline', 'rectangle', 'circle', 'arc']);
 const at = (p) => findPickTarget(pool, p, {tolerance: 20});
 assert.equal(at(P(700, 8)).entity.id, 'l1');
 assert.equal(at(P(700, 8)).spec.kind, 'linear');
 assert.deepEqual(at(P(700, 5000)), {kind: 'point', reason: 'empty'}, '숨김 레이어 선은 빈 곳');
 assert.deepEqual(at(P(700, 6000)), {kind: 'point', reason: 'empty'}, '동결 레이어');
 assert.deepEqual(at(P(3000, 0)), {kind: 'point', reason: 'snap'}, '끝점 스냅');
 assert.deepEqual(at(P(750, 0)).kind, 'object', '근처점 스냅(끝·중간이 아님)은 객체');
 assert.deepEqual(at(P(1500, 0)), {kind: 'point', reason: 'snap'}, '교차점 = 두 객체 위');
 assert.deepEqual(at(P(1500, 300)).entity.id, 'cross');
 assert.deepEqual(at(P(10000, 1000)), {kind: 'point', reason: 'snap'}, '사분점');
 assert.equal(at(P(10000, 1012)).spec.kind, 'diameter');
 assert.equal(at(P(0, 0)).kind, 'point', '두 선이 만나는 끝점');
 // 둘 다 허용 거리 안이면 더 가까운 쪽
 assert.equal(findPickTarget(pool, P(1488, 30), {tolerance: 50}).entity.id, 'cross');
 // 큰 도면: 공간 색인으로 같은 결과
 const many = Array.from({length: 300}, (_, i) => ({id: 'm' + i, type: 'line', points: [P(i * 100, 20000), P(i * 100 + 50, 20000)], layer: 'default'}));
 const long = {id: 'long', type: 'line', points: [P(-2000, 25000), P(31000, 25000)], layer: 'default'};
 const ring = {id: 'ring', type: 'circle', center: P(15000, 15000), radius: 3000, layer: 'default'};
 const find = createTargetFinder([...all, ...many, long, ring], layers);
 assert.equal(find(P(12520, 20004), 10).entity.id, 'm125');
 assert.equal(find(P(700, 8), 20).entity.id, 'l1');
 assert.equal(find(P(12580, 20004), 10).kind, 'point');
 assert.equal(find(P(14321, 25006), 10).entity.id, 'long', '여러 칸에 걸친 긴 선');
 assert.equal(find(P(15000, 18005), 10).spec.kind, 'diameter');
 assert.equal(find(P(-90000, -90000), 10).kind, 'point', '도면 밖');
 assert.throws(() => find({x: 0, y: NaN}, 10));
 // 둘째 선(각도용): 같은 선·평행선·빈 곳은 아님
 const first = at(P(700, 8)).spec;
 assert.equal(secondLineAt(find, first, P(300, 522), 20).entityId, 'l2');
 assert.equal(secondLineAt(find, first, P(2000, 5), 20), null, '같은 선');
 assert.equal(secondLineAt(find, first, P(5000, 5000), 20), null, '빈 곳');
 assert.equal(secondLineAt(find, twoPointSpec(P(0, 0), P(1, 0)), P(300, 522), 20), null, '두 점 치수는 각도로 안 바뀜');
});

// ── 명령 흐름: 가짜 ctx + 실제 엔진 ──
function setup(entities, {tolerance = 20} = {}) {
 const engine = new DrawingEngine();
 if (entities.length) engine.execute({type: 'addMany', entities: entities.map(e => ({layer: 'default', ...e}))});
 const clicks = [], prompts = [], previews = [], toasts = [];
 const ctx = {
  entities: () => engine.doc.entities, layers: () => engine.doc.layers, tolerance: () => tolerance,
  styledDimension: d => applyDimStyle(d, getDimStyle(engine.doc)),
  pickPoint: async (o) => { prompts.push(o.prompt); previews.push(o.preview); return clicks.length ? clicks.shift() : null; },
  commit: ({removeIds = [], entities: list = []}) => engine.execute({type: 'batch', commands: [...(removeIds.length ? [{type: 'delete', ids: removeIds}] : []), {type: 'addMany', entities: list.map(e => ({...e, layer: e.layer || 'default'}))}]}),
  toast: m => toasts.push(m),
 };
 return {engine, clicks, prompts, previews, toasts, cmds: installSmartDim(ctx)};
}
const dims = engine => engine.doc.entities.filter(e => e.type === 'dimension');

test('DIMSMART 명령: 선 → 수평 치수, 미리보기, 되돌리기 한 번', async () => {
 const t = setup([SLANT]);
 t.clicks.push(P(1000, 753), P(2000, 5000));
 await t.cmds.DIMSMART();
 const [dim] = dims(t.engine);
 assert.equal(dim.mode, 'horizontal');
 assert.equal(dim.layer, 'default');
 assert.equal(dim.dimStyle, 'STANDARD');
 assert.equal(dim.textHeight, 150);
 assert.equal(dimensionText(dim), '4000');
 assert.match(t.toasts[0], /수평 치수 4000/);
 assert.equal(t.prompts.length, 2);
 // 첫 단계 미리보기: 고를 선을 강조, 빈 곳은 없음. app.js 는 (점 목록, 커서) 로 부른다.
 assert.deepEqual(t.previews[0]([], P(1000, 753)), [{type: 'line', points: [P(0, 0), P(4000, 3000)]}]);
 assert.deepEqual(t.previews[0]([], P(9000, 9000)), []);
 assert.deepEqual(t.previews[0]([], null), []);
 // 치수선 단계 미리보기: 커서에 따라 종류가 바뀜
 assert.equal(t.previews[1]([], P(6000, 1500))[0].mode, 'vertical');
 assert.equal(t.previews[1]([], P(1000, 2000))[0].mode, 'aligned');
 assert.equal(t.previews[1](P(2000, 5000))[0].mode, 'horizontal', '커서만 넘겨도 동작');
 t.engine.execute({type: 'undo'});
 assert.equal(t.engine.doc.entities.length, 1);
 assert.equal(dims(t.engine).length, 0);
});

test('DIMSMART 명령: 원 → 지름, 호 → 반지름, 폴리선 구간', async () => {
 const t = setup([
  {id: 'c', type: 'circle', center: P(0, 0), radius: 1000},
  {id: 'a', type: 'arc', center: P(5000, 0), radius: 1500, startAngle: 0, endAngle: 90},
  {id: 'p', type: 'polyline', closed: true, points: [P(10000, 0), P(16000, 0), P(16000, 4000), P(10000, 4000)]},
 ]);
 t.clicks.push(P(3, 1004), P(2000, 2000));
 await t.cmds.DIMSMART();
 t.clicks.push(P(6060, 1060), P(3000, -500));
 await t.cmds.DIMSMART();
 t.clicks.push(P(16004, 1000), P(17000, 2000));
 await t.cmds.DIMSMART();
 const [d, r, v] = dims(t.engine);
 assert.equal(d.mode, 'diameter');
 assert.equal(dimensionText(d), 'Ø 2000');
 assert.equal(r.mode, 'radius');
 assert.equal(dimensionText(r), 'R 1500');
 nearPoint(r.points[1], P(5000, 1500), '호 밖(왼쪽 아래)을 누르면 가까운 호 끝 90°');
 assert.equal(v.mode, 'vertical');
 assert.equal(dimensionText(v), '4000');
 assert.match(t.prompts[1], /지름/);
 assert.equal(t.previews[1]([], P(0, 2000))[0].mode, 'diameter');
 for (let i = 0; i < 3; i++) t.engine.execute({type: 'undo'});
 assert.equal(dims(t.engine).length, 0, '치수마다 되돌리기 한 번');
});

test('DIMSMART 명령: 선 → 다른 선 → 각도(사분면 선택)', async () => {
 const t = setup([L1, L2]);
 t.clicks.push(P(1500, 3), P(300, 522), P(-1000, -300));
 await t.cmds.DIMSMART();
 const [dim] = dims(t.engine);
 assert.equal(dim.mode, 'angular');
 assert.equal(dimensionText(dim), '60°');
 assert.match(t.toasts[0], /각도 치수 60°/);
 assert.equal(t.prompts.length, 3);
 assert.match(t.prompts[2], /사분면/);
 // 치수선 단계에서 다른 선 위에 커서가 오면 각도 미리보기, 아니면 선형
 assert.equal(t.previews[1]([], P(300, 522))[0].mode, 'angular');
 assert.equal(t.previews[1]([], P(1500, -900))[0].mode, 'horizontal');
 assert.equal(dimensionText(t.previews[2]([], P(-1000, 300))[0]), '120°');
 assert.deepEqual(t.previews[2]([], P(0, 0)), [], '교점 위 커서는 미리보기 없음(오류 삼킴)');
 t.engine.execute({type: 'undo'});
 assert.equal(dims(t.engine).length, 0);
});

test('DIMSMART 명령: 빈 곳·스냅 점 → 두 점 선형, 숨김 레이어 무시', async () => {
 const t = setup([SLANT]);
 t.clicks.push(P(10000, 10000), P(13000, 14000), P(11000, 12500));
 await t.cmds.DIMSMART();
 t.clicks.push(P(4000, 3000), P(8000, 3000), P(6000, 3600)); // 선 끝점에 스냅 = 점
 await t.cmds.DIMSMART();
 const [aligned, horizontal] = dims(t.engine);
 assert.equal(aligned.mode, 'aligned');
 assert.equal(dimensionText(aligned), '5000');
 assert.equal(horizontal.mode, 'horizontal');
 assert.equal(dimensionText(horizontal), '4000');
 assert.deepEqual(horizontal.points[0], P(4000, 3000));
 assert.match(t.prompts[1], /두 번째 치수점/);
 assert.deepEqual(t.previews[1]([], P(12000, 12000)), [{type: 'line', points: [P(10000, 10000), P(12000, 12000)]}]);
 assert.equal(t.previews[2]([], P(300, 522)).length, 1, '두 점 치수는 선 위 커서도 선형 미리보기');
 assert.equal(t.previews[2]([], P(300, 522))[0].mode !== 'angular', true);

 const hl = setup([]);
 hl.engine.execute({type: 'layer.add', name: '숨김'});
 const hid = hl.engine.doc.layers.find(l => l.name === '숨김');
 hl.engine.execute({type: 'addMany', entities: [{type: 'line', points: [P(0, 0), P(3000, 0)], layer: hid.id}]});
 hl.engine.execute({type: 'layer.update', id: hid.id, changes: {visible: false}});
 hl.clicks.push(P(1500, 4), null);
 await hl.cmds.DIMSMART();
 assert.match(hl.prompts[1], /두 번째 치수점/, '숨김 레이어의 선은 고르지 않음');
 assert.equal(dims(hl.engine).length, 0);
});

test('DIMSMART 명령: 단계마다 Esc 는 아무것도 남기지 않음, 잘못된 위치는 거절', async () => {
 for (const clicks of [[], [P(1500, 3)], [P(1500, 3), P(300, 522)], [P(9000, 9000)], [P(9000, 9000), P(9500, 9000)]]) {
  const t = setup([L1, L2]);
  const before = t.engine.undoStack.length;
  t.clicks.push(...clicks);
  assert.equal(await t.cmds.DIMSMART(), null);
  assert.equal(dims(t.engine).length, 0);
  assert.equal(t.engine.undoStack.length, before);
  assert.equal(t.toasts.length, 0);
 }
 const same = setup([]);
 same.clicks.push(P(5, 5), P(5, 5));
 await assert.rejects(() => same.cmds.DIMSMART(), /같습니다/);
 const center = setup([L1, L2]);
 center.clicks.push(P(1500, 3), P(300, 522), P(0, 0));
 await assert.rejects(() => center.cmds.DIMSMART(), /교점/);
 assert.equal(dims(center.engine).length, 0);
 // 스타일 함수가 없는 문맥에서도 엔진 검증(문자 높이)을 통과
 const engine = new DrawingEngine();
 engine.execute({type: 'add', entity: {...L1, layer: 'default'}});
 const clicks = [P(1500, 3), P(1500, 900)];
 const bare = installSmartDim({entities: () => engine.doc.entities, layers: () => engine.doc.layers, tolerance: () => 20, pickPoint: async () => clicks.shift(),
  commit: ({entities}) => engine.execute({type: 'addMany', entities: entities.map(e => ({...e, layer: 'default'}))})});
 const made = await bare.DIMSMART();
 assert.equal(made.textHeight, 150);
 assert.equal(dims(engine).length, 1);
});

test('DIMANGULAR selects two lines or a semicircle, previews a complete styled angle and cancels cleanly',async()=>{
 for(const entities of [[L1,L2],[{id:'arc',type:'arc',center:P(0,0),radius:1000,startAngle:0,endAngle:180}]]){
  const engine=new DrawingEngine(),queue=[...entities];let calls=0,preview;
  const ctx={pickEntity:async()=>queue.shift(),pickPoint:async spec=>{calls++;preview=spec.preview([],P(400,400))[0];return P(400,400);},styledDimension:d=>applyDimStyle(d,getDimStyle(engine.doc)),commit:({entities})=>engine.execute({type:'addMany',entities:entities.map(e=>({...e,layer:'default'}))})};
  const dim=await installSmartDim(ctx).DIMANGULAR();assert.equal(calls,1);assert.equal(dim.mode,'angular');assert.deepEqual(dim.points,preview.points);assert.equal(G.dimensionParts(preview).filter(p=>p.type==='hatch').length,2);engine.validate(engine.doc);
 }
 let commits=0;await installSmartDim({pickEntity:async()=>null,commit:()=>commits++}).DIMANGULAR();assert.equal(commits,0);
 assert.throws(()=>angularSpec(classifyPick(L1,P(500,0)),classifyPick({...L1,id:'other'},P(500,0))),/평행/);
});
