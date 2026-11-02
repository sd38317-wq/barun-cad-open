import test from 'node:test';
import assert from 'node:assert/strict';
import * as G from './geometry.js';
import * as C from './curve-edit.js';

const p = (x, y) => ({x, y});
const close = (a, b, tol = 1e-6) => assert.ok(Math.abs(a - b) <= tol, `${a} != ${b}`);
const closeP = (a, b, tol = 1e-6) => { close(a.x, b.x, tol); close(a.y, b.y, tol); };

test('408 bulge 정점 → 점 목록 + arcRuns, 다시 bulge 하나로 압축', () => {
 const made = C.fromBulgeVertices([{...p(0, 0), bulge: 1}, {...p(200, 0), bulge: 0}, {...p(200, -100), bulge: 0}]);
 assert.equal(made.arcRuns.length, 1);
 assert.ok(made.points.length > 4);
 const e = {type: 'polyline', layer: '0', closed: false, ...made};
 const path = C.toBPath(e);
 assert.equal(path.v.length, 3, '호 구간이 정점 하나로 줄어든다');
 close(path.v[0].bulge, 1, 1e-9);
 const arc = C.pathParts(e)[0];
 assert.equal(arc.kind, 'arc'); close(arc.radius, 100); closeP(arc.center, p(100, 0));
 close(C.pathLength(e), Math.PI * 100 + 100, 1e-6);
});

test('408 이동·회전·대칭 뒤에도 호 표시가 유지되고, 점 하나 옮기면 직선으로 본다', () => {
 const e = {type: 'polyline', layer: '0', ...C.fromBulgeVertices([{...p(0, 0), bulge: 0.4142135623730951}, {...p(100, 100), bulge: 0}])};
 assert.equal(C.verifiedArcRuns(G.rotate(G.translate(e, 50, 70), p(0, 0), 33)).length, 1);
 const m = G.mirror(e, p(0, 0), p(0, 1));
 const v = C.toBPath(m).v;
 assert.ok(v[0].bulge < 0, '대칭은 bulge 부호를 뒤집는다');
 const broken = structuredClone(e); broken.points[2] = {x: broken.points[2].x + 5, y: broken.points[2].y};
 assert.equal(C.verifiedArcRuns(broken).length, 0);
});

test('402 열린 폴리선 TRIM: 찍은 구간만 지우고 나머지는 폴리선으로', () => {
 const pl = {id: 'a', type: 'polyline', layer: '0', points: [p(0, 0), p(100, 0), p(100, 100)]};
 const cut = {id: 'b', type: 'line', layer: '0', points: [p(50, -10), p(50, 10)]};
 const out = C.cutPath(pl, [cut], p(20, 0));
 assert.equal(out.length, 1);
 assert.deepEqual(out[0].points.map((q) => [q.x, q.y]), [[50, 0], [100, 0], [100, 100]]);
 assert.equal(out[0].id, undefined);
 const mid = C.cutPath(pl, [cut, {type: 'line', layer: '0', points: [p(90, 50), p(110, 50)]}], p(100, 20));
 assert.equal(mid.length, 2);
 assert.deepEqual(mid[1].points.map((q) => [q.x, q.y]), [[100, 50], [100, 100]]);
 assert.throws(() => C.cutPath(pl, [{type: 'line', layer: '0', points: [p(500, 0), p(500, 9)]}], p(20, 0)), /교차점이 없습니다/);
});

test('402 닫힌 폴리선·호 구간 TRIM: 호는 정확한 원 교차로 자르고 호로 남긴다', () => {
 const sq = {type: 'rectangle', layer: '0', points: [p(0, 0), p(100, 0), p(100, 100), p(0, 100)]};
 const v = {type: 'line', layer: '0', points: [p(50, -10), p(50, 110)]};
 const out = C.cutPath(sq, [v], p(80, 0));
 assert.equal(out.length, 1); assert.equal(out[0].type, 'polyline'); assert.equal(out[0].closed, false);
 assert.deepEqual(out[0].points.map((q) => [q.x, q.y]), [[50, 100], [0, 100], [0, 0], [50, 0]]);
 // 반원(중심 100,0 반지름 100) 폴리선을 x=100 세로선으로 자르면 꼭대기(100,100)에서 정확히 잘린다.
 const arcPl = {type: 'polyline', layer: '0', ...C.fromBulgeVertices([{...p(0, 0), bulge: -1}, {...p(200, 0), bulge: 0}])};
 const pieces = C.cutPath(arcPl, [{type: 'line', layer: '0', points: [p(100, -500), p(100, 500)]}], C.pathParts(arcPl)[0].a.x < 1 ? p(171, 71) : p(29, 71));
 assert.equal(pieces.length, 1);
 const parts = C.pathParts(pieces[0]);
 assert.equal(parts.length, 1); assert.equal(parts[0].kind, 'arc');
 close(Math.abs(parts[0].sweepDeg), 90, 1e-6);
});

test('402 EXTEND 열린 폴리선 끝 구간, 타원 TRIM', () => {
 const pl = {type: 'polyline', layer: '0', points: [p(0, 100), p(0, 0), p(50, 0)]};
 const wall = {type: 'line', layer: '0', points: [p(200, -50), p(200, 50)]};
 const [ext] = C.extendPath(pl, [wall], p(45, 0));
 closeP(ext.points.at(-1), p(200, 0));
 const el = {type: 'ellipse', layer: '0', center: p(0, 0), majorAxis: p(100, 0), ratio: 0.5};
 const pieces = C.cutPath(el, [{type: 'line', layer: '0', points: [p(0, -100), p(0, 100)]}], p(100, 0));
 assert.equal(pieces.length, 1);
 const kept = pieces[0];
 closeP(G.ellipsePoints(kept, 4)[0], p(0, 50), 1e-6);
 closeP(G.ellipsePoints(kept, 4).at(-1), p(0, -50), 1e-6);
});

test('406 BREAK: 호·원·폴리선·타원을 같은 함수로, 같은 점이면 둘로 나눔', () => {
 const arc = {type: 'arc', layer: '0', center: p(0, 0), radius: 10, startAngle: 0, endAngle: 180};
 const at = G.add(arc.center, G.polar(10, 90));
 const two = C.breakPath(arc, at, at);
 assert.equal(two.length, 2); close(two[0].endAngle, 90); close(two[1].startAngle, 90);
 const circle = {type: 'circle', layer: '0', center: p(0, 0), radius: 10};
 const [rest] = C.breakPath(circle, p(10, 0), p(0, 10));
 close(rest.startAngle, 90); close(rest.endAngle, 0);
 const pl = {type: 'polyline', layer: '0', points: [p(0, 0), p(100, 0), p(100, 100)]};
 const halves = C.breakPath(pl, p(100, 40), p(100, 40));
 assert.equal(halves.length, 2);
 assert.equal(halves[0].points.length, 3); closeP(halves[0].points[2], p(100, 40)); closeP(halves[1].points[0], p(100, 40));
 const gap = C.breakPath(pl, p(30, 0), p(100, 30));
 assert.deepEqual(gap.map((e) => e.points.length), [2, 2]);
 const el = {type: 'ellipse', layer: '0', center: p(0, 0), majorAxis: p(100, 0), ratio: 0.5, startParam: 0, endParam: Math.PI};
 const parts = C.breakPath(el, p(0, 50), p(0, 50));
 assert.equal(parts.length, 2); close(parts[0].endParam, Math.PI / 2, 1e-9);
});

test('407 JOIN 자동 판단: 같은 원 호 → 원, 한 직선 위 선 → 선(틈 허용), 섞이면 호 구간을 가진 폴리선', () => {
 const arcs = [0, 120, 240].map((s, i) => ({id: 'a' + i, type: 'arc', layer: '0', center: p(0, 0), radius: 50, startAngle: s, endAngle: s + 120}));
 const r1 = C.joinAuto(arcs);
 assert.equal(r1.made[0].type, 'circle'); assert.equal(r1.used.length, 3);
 const r2 = C.joinAuto([{id: 'l1', type: 'line', layer: '0', points: [p(0, 0), p(10, 0)]}, {id: 'l2', type: 'line', layer: '0', points: [p(15, 0), p(30, 0)]}]);
 assert.equal(r2.made[0].type, 'line'); assert.deepEqual(r2.made[0].points, [p(0, 0), p(30, 0)]);
 const mixed = C.joinAuto([
  {id: 'l', type: 'line', layer: '0', points: [p(-100, 0), p(0, 0)]},
  {id: 'a', type: 'arc', layer: '0', center: p(0, 50), radius: 50, startAngle: 270, endAngle: 90},
  {id: 'x', type: 'line', layer: '0', points: [p(500, 500), p(600, 500)]},
 ], 0.01);
 assert.equal(mixed.made.length, 1); assert.equal(mixed.left, 1);
 const kinds = C.pathParts(mixed.made[0]).map((s) => s.kind);
 assert.deepEqual(kinds, ['line', 'arc']);
 // 허용 거리: 0.5 떨어진 끝도 허용 1 이면 잇는다.
 const fuzzy = C.joinAuto([{id: 'a', type: 'line', layer: '0', points: [p(0, 0), p(10, 0)]}, {id: 'b', type: 'line', layer: '0', points: [p(10.5, 0.2), p(10.5, 20)]}], 1);
 assert.equal(fuzzy.made.length, 1); assert.equal(fuzzy.made[0].points.length, 3);
});

test('403 평행선 모깎기는 간격의 반원, 선-호 모깎기는 접하는 호, 두 폴리선은 하나로', () => {
 const a = {type: 'line', layer: '0', points: [p(0, 0), p(100, 0)]}, b = {type: 'line', layer: '0', points: [p(0, 40), p(80, 40)]};
 const out = C.cornerAny(a, b, 5, false, [p(90, 0), p(70, 40)]);
 const arc = out.find((e) => e.type === 'arc');
 close(arc.radius, 20); closeP(arc.center, p(100, 20));
 closeP(out[1].points[1], p(100, 40));
 const line = {type: 'line', layer: '0', points: [p(-100, 0), p(100, 0)]};
 const circleArc = {type: 'arc', layer: '0', center: p(0, 100), radius: 50, startAngle: 180, endAngle: 360};
 const fil = C.cornerAny(line, circleArc, 30, false, [p(80, 0), p(45, 80)]);
 const f = fil.find((e) => e.type === 'arc' && e.radius === 30);
 close(G.dist(f.center, circleArc.center), 80, 1e-6); close(f.center.y, 30, 1e-6); assert.ok(f.center.x > 0, '찍은 쪽(오른쪽) 답');
 close(fil[0].points[0].x, f.center.x, 1e-6);
 assert.throws(() => C.cornerAny(line, circleArc, 10, true, []), /모따기/);
 const pa = {type: 'polyline', layer: '0', points: [p(0, 100), p(0, 0), p(50, 0)]};
 const pb = {type: 'polyline', layer: '0', points: [p(100, 50), p(100, 100), p(200, 100)]};
 const [joined] = C.cornerAny(pa, pb, 10, false, [p(40, 0), p(100, 60)]);
 assert.equal(joined.type, 'polyline');
 assert.equal(C.pathParts(joined).filter((s) => s.kind === 'arc').length, 1);
 closeP(joined.points[0], p(0, 100)); closeP(joined.points.at(-1), p(200, 100));
});

test('404 OFFSET 모서리 채우기 0 연장 · 1 호 · 2 모따기, 호 구간은 호로 띄움', () => {
 const sq = {type: 'polyline', closed: true, layer: '0', points: [p(0, 0), p(100, 0), p(100, 100), p(0, 100)]};
 const g0 = C.offsetAny(sq, 10, p(200, 50), {gapType: 0});
 assert.equal(g0.points.length, 4);
 const g1 = C.offsetAny(sq, 10, p(200, 50), {gapType: 1});
 const arcs = C.pathParts(g1).filter((s) => s.kind === 'arc');
 assert.equal(arcs.length, 4); arcs.forEach((s) => { close(s.radius, 10); close(Math.abs(s.sweepDeg), 90); });
 const g2 = C.offsetAny(sq, 10, p(200, 50), {gapType: 2});
 assert.equal(C.toBPath(g2).v.length, 8);
 const inner = C.offsetAny(sq, 10, p(50, 50), {gapType: 1});
 assert.equal(inner.points.length, 4, '안쪽(오목하지 않은 쪽) 모서리는 채우지 않는다');
 const round = {type: 'polyline', layer: '0', ...C.fromBulgeVertices([{...p(0, 0), bulge: 0}, {...p(100, 0), bulge: 1}, {...p(100, 100), bulge: 0}, {...p(0, 100), bulge: 0}])};
 const o = C.offsetAny(round, 10, p(300, 50));
 const oa = C.pathParts(o).find((s) => s.kind === 'arc');
 close(oa.radius, 60, 1e-6); closeP(oa.center, p(100, 50), 1e-6);
});

test('404 안쪽 모서리에서 뒤집힌 짧은 구간은 오류·고리 대신 빼고 잇는다', () => {
 // V 홈(폭 10, 깊이 10)이 있는 선을 위로 20 띄우면 홈 양쪽 구간이 뒤집힌다 → 곧은 선 하나.
 const v = {type: 'polyline', layer: '0', points: [p(0, 0), p(100, 0), p(105, -10), p(110, 0), p(200, 0)]};
 const out = C.offsetAny(v, 20, p(50, 50));
 assert.ok(out.points.every((q) => Math.abs(q.y - 20) < 1e-6), '모든 점이 y=20 위');
 // 진짜 안쪽 고리(갈고리 안 주머니)는 그대로 둔다(AutoCAD 와 같음).
 const hook = {type: 'polyline', layer: '0', points: [p(0, 0), p(100, 0), p(100, 50), p(40, 50), p(40, -20)]};
 assert.throws(() => G.offsetEntity(hook, 15, p(50, 50)), /자기 교차/);
 const kept = C.offsetAny(hook, 15, p(50, 30));
 assert.equal(kept.points.length, 5);
 assert.deepEqual(C.dropSelfLoops([p(0, 0), p(10, 0), p(10, 10), p(5, -5), p(0, -10)]).length, 4);
});

test('415 LENGTHEN 계산 · 416 ALIGN 행렬 · 418 경로 점', () => {
 close(C.lengthenDelta('P', 150, 200), 100); close(C.lengthenDelta('T', 50, 200), -150); close(C.lengthenDelta('DE', -5, 200), -5);
 assert.throws(() => C.lengthenDelta('X', 1, 1));
 const m = C.alignMatrix(p(0, 0), p(10, 10), p(1, 0), p(10, 12), true);
 const parts = C.matrixParts(m);
 closeP(parts.fn(p(1, 0)), p(10, 12)); close(parts.scale, 2); close(parts.rotation, 90); assert.equal(parts.mirror, false);
 assert.throws(() => C.matrixParts([2, 0, 0, 1, 0, 0]), /축척/);
 const walk = C.walkPoints({type: 'ellipse', center: p(0, 0), majorAxis: p(10, 0), ratio: 1});
 const along = C.pointsAlongWithAngle(walk, [Math.PI * 5]);
 closeP(along[0].point, p(0, 10), 1e-3); close(G.normalizeAngle(along[0].angle + 1), 181, 1);
 const t = C.endTangent({type: 'line', points: [p(0, 0), p(10, 0)]}, 'end');
 closeP(t.dir, p(1, 0));
});
