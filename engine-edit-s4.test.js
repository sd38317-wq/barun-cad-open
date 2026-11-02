import test from 'node:test';
import assert from 'node:assert/strict';
import * as G from './geometry.js';
import * as C from './curve-edit.js';
import {DrawingEngine} from './engine.js';

const p = (x, y) => ({x, y});
const engineWith = (entities) => { const e = new DrawingEngine(); for (const x of entities) e.execute({type: 'add', entity: {layer: 'default', ...x}}); return e; };
const kinds = (e) => e.doc.entities.map((x) => x.type).sort();

test('402 엔진 TRIM/EXTEND: 폴리선·타원도 자르고(되돌리기 한 번), 열린 폴리선 끝을 늘린다', () => {
 const e = engineWith([{id: 'pl', type: 'polyline', points: [p(0, 0), p(100, 0), p(100, 100)]}, {id: 'cut', type: 'line', points: [p(50, -10), p(50, 10)]}]);
 e.execute({type: 'trim', id: 'pl', boundaryIds: ['cut'], pick: p(20, 0)});
 const kept = e.doc.entities.find((x) => x.type === 'polyline');
 assert.deepEqual(kept.points[0], p(50, 0));
 e.execute({type: 'undo'}); assert.equal(e.doc.entities.find((x) => x.id === 'pl').points.length, 3);
 const x = engineWith([{id: 'pl', type: 'polyline', points: [p(0, 100), p(0, 0), p(50, 0)]}, {id: 'wall', type: 'line', points: [p(200, -50), p(200, 50)]}]);
 x.execute({type: 'extend', id: 'pl', boundaryIds: ['wall'], pick: p(45, 0)});
 assert.deepEqual(x.doc.entities.find((q) => q.type === 'polyline').points.at(-1), p(200, 0));
 const el = engineWith([{id: 'el', type: 'ellipse', center: p(0, 0), majorAxis: p(100, 0), ratio: 0.5}, {id: 'v', type: 'line', points: [p(0, -100), p(0, 100)]}]);
 el.execute({type: 'trim', id: 'el', boundaryIds: ['v'], pick: p(100, 0)});
 assert.equal(el.doc.entities.filter((q) => q.type === 'ellipse').length, 1);
});

test('403 엔진 FILLET: 선-호, 평행선 반원, 두 폴리선 하나로(짝 표)', () => {
 const e = engineWith([{id: 'a', type: 'line', points: [p(0, 0), p(100, 0)]}, {id: 'b', type: 'line', points: [p(0, 40), p(80, 40)]}]);
 e.execute({type: 'fillet', ids: ['a', 'b'], size: 5, pickPoints: {a: p(90, 0), b: p(70, 40)}});
 const arc = e.doc.entities.find((x) => x.type === 'arc'); assert.ok(arc && Math.abs(arc.radius - 20) < 1e-9);
 const f = engineWith([{id: 'l', type: 'line', points: [p(-100, 0), p(100, 0)]}, {id: 'c', type: 'arc', center: p(0, 100), radius: 50, startAngle: 180, endAngle: 360}]);
 f.execute({type: 'fillet', ids: ['l', 'c'], size: 30, pickPoints: {l: p(80, 0), c: p(45, 80)}});
 assert.deepEqual(kinds(f), ['arc', 'arc', 'line']);
 const j = engineWith([{id: 'pa', type: 'polyline', points: [p(0, 100), p(0, 0), p(50, 0)]}, {id: 'pb', type: 'polyline', points: [p(100, 50), p(100, 100), p(200, 100)]}]);
 j.execute({type: 'fillet', ids: ['pa', 'pb'], size: 10, pickPoints: {pa: p(40, 0), pb: p(100, 60)}});
 assert.equal(j.doc.entities.length, 1); assert.equal(j.doc.entities[0].type, 'polyline');
 assert.throws(() => engineWith([{id: 'a', type: 'line', points: [p(0, 0), p(1, 0)]}, {id: 'b', type: 'line', points: [p(0, 4), p(1, 4)]}]).execute({type: 'chamfer', ids: ['a', 'b'], size: 1}), /평행선/);
});

test('404 엔진 OFFSET gapType: 1 은 바깥 모서리를 호로(DXF 에는 bulge), 호 구간 폴리선은 호로 띄운다', () => {
 const e = engineWith([{id: 'sq', type: 'polyline', closed: true, points: G.rectangle(p(0, 0), p(100, 100))}]);
 const [id] = e.execute({type: 'offset', ids: ['sq'], distance: 10, side: p(300, 50), gapType: 1});
 const out = e.doc.entities.find((x) => x.id === id);
 assert.equal(C.pathParts(out).filter((s) => s.kind === 'arc').length, 4);
 const [plain] = e.execute({type: 'offset', ids: ['sq'], distance: 10, side: p(300, 50)});
 assert.equal(e.doc.entities.find((x) => x.id === plain).points.length, 4, '기본(0)은 예전과 같다');
});

test('406 엔진 BREAK: 원·호·폴리선, BREAKATPOINT(같은 점)', () => {
 const e = engineWith([{id: 'c', type: 'circle', center: p(0, 0), radius: 10}, {id: 'pl', type: 'polyline', points: [p(0, 100), p(100, 100), p(100, 200)]}]);
 e.execute({type: 'break', id: 'c', a: p(10, 0), b: p(0, 10)});
 const arc = e.doc.entities.find((x) => x.type === 'arc'); assert.ok(arc && Math.abs(arc.startAngle - 90) < 1e-9);
 e.execute({type: 'break', id: 'pl', a: p(100, 150), b: p(100, 150)});
 assert.equal(e.doc.entities.filter((x) => x.type === 'polyline').length, 2);
 assert.throws(() => e.execute({type: 'break', id: e.doc.entities.find((x) => x.type === 'arc').id, a: arc.center && G.add(arc.center, G.polar(10, 90)), b: G.add(arc.center, G.polar(10, 90))}), /끝점/);
});

test('407 엔진 JOIN: 허용 거리, 결과 종류, 못 이은 개수 보고', () => {
 const e = engineWith([{id: 'a', type: 'line', points: [p(0, 0), p(10, 0)]}, {id: 'b', type: 'line', points: [p(10.4, 0.3), p(10.4, 20)]}, {id: 'far', type: 'line', points: [p(500, 0), p(600, 50)]}]);
 assert.throws(() => e.execute({type: 'join', ids: ['a', 'b']}), /이어지는/);
 e.execute({type: 'join', ids: ['a', 'b', 'far'], tolerance: 1});
 assert.deepEqual(e.lastJoinReport, {joined: 2, left: 1, made: 1, kind: 'polyline'});
 const arcs = engineWith([0, 180].map((s, i) => ({id: 'r' + i, type: 'arc', center: p(0, 0), radius: 5, startAngle: s, endAngle: s + 180})));
 arcs.execute({type: 'join', ids: ['r0', 'r1']});
 assert.deepEqual(kinds(arcs), ['circle']);
});

test('414 STRETCH: 호 한쪽 끝만 늘리면 현 높이 유지, 치수 연결은 격자 색인으로(결과는 예전과 같다)', () => {
 const arc = {id: 'arc', type: 'arc', layer: 'default', center: p(0, 0), radius: 100, startAngle: 0, endAngle: 180};
 const [out] = G.stretchEntities([arc], [{id: 'arc', arcEnds: ['start']}], p(50, 0));
 const start = G.add(out.center, G.polar(out.radius, out.startAngle)), end = G.add(out.center, G.polar(out.radius, out.endAngle));
 assert.ok(G.dist(start, p(150, 0)) < 1e-6 && G.dist(end, p(-100, 0)) < 1e-6, '옮긴 끝·남은 끝');
 const top = G.add(out.center, G.polar(out.radius, out.startAngle + G.normalizeAngle(out.endAngle - out.startAngle) / 2));
 assert.ok(Math.abs(top.y - 100) < 1e-6, '현 높이(처짐) 100 유지');
 // 큰 도면: 대상 200개 · 치수 2,000개 · 선 2만 개에서 연결된 치수만 따라온다.
 const lines = Array.from({length: 20000}, (_, i) => ({id: 'l' + i, type: 'line', layer: 'default', points: [p(i * 10, 0), p(i * 10, 100)]}));
 const dims = Array.from({length: 2000}, (_, i) => ({id: 'd' + i, type: 'dimension', layer: 'default', mode: 'aligned', textHeight: 10, points: [p(i * 10, 100), p(i * 10 + 10, 100), p(i * 10, 150)]}));
 const targets = Array.from({length: 200}, (_, i) => ({id: 'l' + i, indices: [1]}));
 const t0 = performance.now(), changed = G.stretchEntities([...lines, ...dims], targets, p(0, 5)), ms = performance.now() - t0;
 assert.equal(changed.length, 200 + 200, '200개 선 + 그 끝에 붙은 치수 200개');
 assert.ok(ms < 2000, `늘림 계산 ${ms.toFixed(0)}ms`);
});

test('416 엔진 transform: ALIGN 이동·회전·축척을 명령 한 번(되돌리기 한 번)으로', () => {
 const e = engineWith([{id: 'a', type: 'line', points: [p(0, 0), p(10, 0)]}, {id: 't', type: 'text', text: 'A', height: 5, position: p(0, 0), rotation: 0}]);
 const depth = e.undoStack.length;
 e.execute({type: 'transform', ids: ['a', 't'], matrix: C.alignMatrix(p(0, 0), p(100, 100), p(10, 0), p(100, 120), true)});
 assert.equal(e.undoStack.length, depth + 1);
 const a = e.doc.entities.find((x) => x.id === 'a'), t = e.doc.entities.find((x) => x.id === 't');
 assert.ok(G.dist(a.points[1], p(100, 120)) < 1e-9); assert.ok(Math.abs(t.height - 10) < 1e-9); assert.ok(Math.abs(t.rotation - 90) < 1e-9);
 assert.equal(e.lastExecution.lightweight, true, '바뀐 객체만 갈아 끼우는 가벼운 길');
 const [copy] = e.execute({type: 'transform.copy', ids: ['a'], matrix: C.rotateScaleMatrix(p(0, 0), 180, 1)});
 assert.equal(e.doc.entities.length, 3); assert.ok(copy);
 assert.throws(() => e.execute({type: 'transform', ids: ['a'], matrix: [2, 0, 0, 1, 0, 0]}), /축척/);
});

test('큰 붙여넣기·COPY: 15만 개도 push(...) 스택 넘침 없이 들어간다', () => {
 const e = new DrawingEngine(), n = 150000;
 e.execute({type: 'addMany', entities: Array.from({length: n}, (_, i) => ({id: 'l' + i, type: 'line', layer: 'default', points: [p(i, 0), p(i, 1)]}))});
 assert.equal(e.doc.entities.length, n);
 const ids = e.execute({type: 'copy', ids: e.doc.entities.map((x) => x.id), dx: 0, dy: 100000});
 assert.equal(ids.length, n); assert.equal(e.doc.entities.length, 2 * n);
});

test('COPY 사본은 원본과 속 객체를 같이 쓰지 않는다(블록 자식·점·검토 값)', () => {
 const e = engineWith([{id: 'b', type: 'block', name: 'B', position: p(0, 0), entities: [{id: 'c', type: 'line', layer: 'default', points: [p(0, 0), p(1, 0)]}]},
  {id: 'l', type: 'line', points: [p(0, 5), p(3, 5)], reviewInput: {turnCenter: p(1, 1)}}]);
 const [cb, cl] = e.execute({type: 'copy', ids: ['b', 'l'], dx: 10, dy: 0}).map((id) => e.doc.entities.find((x) => x.id === id));
 const b = e.doc.entities.find((x) => x.id === 'b'), l = e.doc.entities.find((x) => x.id === 'l');
 assert.notEqual(cb.entities, b.entities); assert.notEqual(cb.entities[0].points, b.entities[0].points); assert.notEqual(cl.points, l.points); assert.notEqual(cl.reviewInput, l.reviewInput);
 cb.entities[0].points[0].x = 99; cl.reviewInput.turnCenter.x = 99;
 assert.equal(b.entities[0].points[0].x, 0); assert.equal(l.reviewInput.turnCenter.x, 1); assert.equal(cl.points[0].x, 10);
});
