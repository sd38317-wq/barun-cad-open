import test from 'node:test';
import assert from 'node:assert/strict';
import * as G from './geometry.js';
import {DrawingEngine} from './engine.js';
import {expandArray, islandFilter, centerMarkParts, parseRelative, touchedIds} from './assoc-edit.js';
import {entityIndex} from './entity-index.js';

const p = (x, y) => ({x, y});
const rect = (x0, y0, x1, y1) => [p(x0, y0), p(x1, y0), p(x1, y1), p(x0, y1)];
const fresh = () => { const e = new DrawingEngine(); return {e, add: (list) => e.execute({type: 'addMany', entities: list.map((x) => ({layer: 'default', ...x}))})}; };
const byId = (e, id) => e.doc.entities.find((x) => x.id === id);

test('405 연관 배열: 블록 하나로 만들고 array.edit 로 간격·개수만 바꾼다(되돌리기 한 번씩)', () => {
 const {e, add} = fresh();
 const [src] = add([{type: 'circle', center: p(0, 0), radius: 10}]);
 const [arr] = e.execute({type: 'array', ids: [src], rows: 2, columns: 3, dx: 100, dy: 50, associative: true});
 assert.equal(e.doc.entities.length, 1, '원본은 배열 안으로 들어간다');
 const block = byId(e, arr);
 assert.equal(block.type, 'block'); assert.equal(block.entities.length, 6); assert.equal(block.assocArray.kind, 'rect');
 e.execute({type: 'array.edit', id: arr, params: {columns: 5}});
 assert.equal(byId(e, arr).entities.length, 10);
 e.execute({type: 'undo'}); assert.equal(byId(e, arr).entities.length, 6);
 e.execute({type: 'redo'});
 // 옮긴 뒤 고쳐도 옮긴 자리에서 다시 펼친다(원본·간격 벡터도 같이 변환).
 e.execute({type: 'rotate', ids: [arr], base: p(0, 0), angle: 90});
 e.execute({type: 'array.edit', id: arr, params: {rows: 1}});
 const centers = byId(e, arr).entities.map((c) => c.center);
 assert.ok(centers.every((c) => Math.abs(c.x) < 1e-6), '90° 돌린 배열은 세로로 다시 펼쳐진다');
 assert.deepEqual(centers.map((c) => Math.round(c.y)).sort((a, b) => a - b), [0, 100, 200, 300, 400]);
 // EXPLODE 로 낱개.
 e.execute({type: 'explode', ids: [arr]});
 assert.equal(e.doc.entities.filter((x) => x.type === 'circle').length, 5);
 // 기본(associative 없음)은 예전처럼 낱개 사본.
 const {e: e2, add: add2} = fresh();
 const [s2] = add2([{type: 'line', points: [p(0, 0), p(10, 0)]}]);
 e2.execute({type: 'array', ids: [s2], rows: 1, columns: 3, dx: 20, dy: 0});
 assert.equal(e2.doc.entities.length, 3);
 assert.throws(() => e.execute({type: 'array.edit', id: e.doc.entities[0].id, params: {}}), /연관 배열/);
});

test('405 원형·경로 배열 펼치기와 한도', () => {
 const items = [{type: 'line', layer: 'default', points: [p(100, 0), p(120, 0)]}];
 const polar = expandArray(items, 'polar', {center: p(0, 0), count: 4, fill: 360});
 assert.equal(polar.length, 4); assert.ok(Math.abs(polar[1].points[0].y - 100) < 1e-6);
 const path = expandArray(items, 'path', {path: [p(0, 0), p(300, 0), p(300, 300)], count: 3, base: p(100, 0)});
 assert.equal(path.length, 3);
 assert.ok(Math.abs(path[2].points[0].x - 300) < 1e-6 && Math.abs(path[2].points[0].y - 300) < 1e-6);
 const {e, add} = fresh();
 const [s] = add([{type: 'point', position: p(0, 0)}]);
 assert.throws(() => e.execute({type: 'array', ids: [s], rows: 200, columns: 200, dx: 1, dy: 1, associative: true}), /최대/);
});

test('413 연관 해치: 경계를 옮기면 같은 명령 안에서 해치가 따라오고, 경계를 지우면 연결만 끊긴다', () => {
 const {e, add} = fresh();
 const [outer, hole] = add([{type: 'polyline', closed: true, points: rect(0, 0, 100, 100)}, {type: 'circle', center: p(50, 50), radius: 10}]);
 const sel = G.hatchSelectionBoundary(e.selected([outer, hole]));
 const [h] = add([{type: 'hatch', solid: true, ...sel.boundary, boundaryIds: [outer, hole], islandMode: 'normal'}]);
 assert.equal(entityIndex(e.doc.entities).assocObjects.size, 1, '색인이 연관 객체를 센다');
 const undoBefore = e.undoStack.length;
 const ids = e.execute({type: 'move', ids: [outer, hole], dx: 1000, dy: 0});
 assert.ok(ids.includes(h), '다시 계산한 해치 id 도 결과에 든다(화면 갱신)');
 assert.equal(e.lastExecution.linked[0], h);
 assert.ok(G.bounds([byId(e, h)]).minX >= 1000 - 1e-6, '해치가 경계를 따라 옮겨졌다');
 assert.equal(e.undoStack.length, undoBefore + 1, '되돌리기 한 단계');
 e.execute({type: 'undo'}); assert.ok(G.bounds([byId(e, h)]).maxX <= 100 + 1e-6);
 e.execute({type: 'redo'});
 // 경계 하나를 고치면(update) 다시 계산 — 꼭짓점을 늘림.
 const moved = byId(e, outer);
 e.execute({type: 'update', ids: [outer], changes: {points: rect(1000, 0, 1200, 100)}});
 assert.ok(Math.abs(G.bounds([byId(e, h)]).maxX - 1200) < 1e-6);
 e.execute({type: 'delete', ids: [hole]});
 const after = byId(e, h);
 assert.equal(after.boundaryIds, undefined); assert.equal(after.assocBroken, true);
 assert.equal(after.loops.length, 1, '모양은 마지막 그대로');
 assert.ok(moved);
});

test('413 섬 검출 방식: 일반 · 바깥만 · 무시', () => {
 const b = {points: rect(0, 0, 100, 100), loops: [rect(10, 10, 90, 90), rect(20, 20, 80, 80), rect(30, 30, 70, 70)]};
 assert.equal(islandFilter(b, 'normal').loops.length, 3);
 assert.equal(islandFilter(b, 'outer').loops.length, 1);
 assert.equal(islandFilter(b, 'ignore').loops.length, 0);
});

test('423 연관 중심 표시·중심선: 원본을 옮기면 따라가고 지우면 마지막 모양으로 남는다', () => {
 assert.equal(parseRelative('0.1x', 50), 5); assert.equal(parseRelative('7', 50), 7);
 assert.equal(centerMarkParts({center: p(0, 0), radius: 50}).length, 6);
 const {e, add} = fresh();
 const [c, a, b] = add([{type: 'circle', center: p(0, 0), radius: 50}, {type: 'line', points: [p(0, 0), p(100, 0)]}, {type: 'line', points: [p(0, 40), p(100, 40)]}]);
 const [mark] = e.execute({type: 'center.add', kind: 'mark', refs: [c], layer: 'default'});
 const [axis] = e.execute({type: 'center.add', kind: 'line', refs: [a, b], layer: 'default', options: {ext: 5}});
 const line = byId(e, axis).entities[0];
 assert.deepEqual(line.points.map((q) => [q.x, q.y]), [[-5, 20], [105, 20]]); assert.equal(line.linetype, 'CENTER');
 e.execute({type: 'move', ids: [c], dx: 300, dy: 0});
 const crossing = byId(e, mark).entities[0].points;
 assert.ok(Math.abs((crossing[0].x + crossing[1].x) / 2 - 300) < 1e-6, '중심 표시가 원을 따라감');
 e.execute({type: 'update', ids: [b], changes: {points: [p(0, 80), p(100, 80)]}});
 assert.ok(Math.abs(byId(e, axis).entities[0].points[0].y - 40) < 1e-6, '중심선이 두 선 가운데로');
 e.execute({type: 'delete', ids: [c]});
 assert.equal(byId(e, mark).assocRefs, undefined); assert.equal(byId(e, mark).entities.length, 6);
 assert.deepEqual([...touchedIds({type: 'stretch', targets: [{id: 'x'}]}, ['y'])].sort(), ['x', 'y']);
});
