import test from 'node:test';
import assert from 'node:assert/strict';
import {DrawingEngine} from './engine.js';
import {autoConstrain, constraintsTouching} from './constraints.js';

const p = (x, y) => ({x, y});
const L = (id, a, b) => ({id, type: 'line', layer: 'default', points: [a, b]});

test('420 AUTOCONSTRAIN: 공차 안 끝점 일치·거의 수평/수직을 찾고, 공차보다 짧은 선은 건너뛴다', () => {
 const lines = [L('a', p(0, 0), p(1000, 0.5)), L('b', p(1000.4, 0.2), p(1000, 800)), L('c', p(0, 0), p(1, 1))];
 const {constraints} = autoConstrain(lines, {tol: 1, angTol: 1});
 const kinds = constraints.map((c) => c.kind).sort();
 assert.deepEqual(kinds, ['coincident', 'horizontal', 'vertical']);
 const again = autoConstrain(lines, {tol: 1, angTol: 1, existing: constraints});
 assert.equal(again.constraints.length, 0, '이미 있는 구속은 다시 만들지 않는다');
 assert.throws(() => autoConstrain(lines, {tol: -1}));
});

test('420 구속 풀이: 한 선을 옮기면 일치로 이어진 선이 따라오고 수평이 유지된다(되돌리기 한 번)', () => {
 const e = new DrawingEngine();
 for (const x of [L('a', p(0, 0), p(1000, 0)), L('b', p(1000, 0), p(1000, 800)), L('far', p(5000, 5000), p(6000, 5000))]) e.execute({type: 'add', entity: x});
 const {constraints} = autoConstrain(e.selected(['a', 'b']), {tol: 1, angTol: 1});
 e.execute({type: 'constraints.set', constraints});
 assert.equal(e.lastExecution.layerOnly, true, '구속 목록만 바꾸는 명령은 가벼운 길');
 assert.equal(e.doc.constraints.length, 3);
 const depth = e.undoStack.length;
 // b 의 아래 끝을 옮기면 a 의 오른쪽 끝이 따라오고, a 는 수평이라 왼쪽 끝 y 도 맞춘다.
 const ids = e.execute({type: 'update', ids: ['b'], changes: {points: [p(1200, 100), p(1200, 800)]}});
 const a = e.doc.entities.find((x) => x.id === 'a');
 assert.deepEqual(a.points[1], {x: 1200, y: 100});
 assert.equal(a.points[0].y, 100, '수평 구속: 왼쪽 끝도 같은 높이');
 assert.ok(ids.includes('a'));
 assert.equal(e.undoStack.length, depth + 1);
 assert.equal(constraintsTouching(e.doc.constraints, {type: 'move', ids: ['far']}, []), false, '구속 없는 객체 편집은 풀이를 건너뛴다');
 e.execute({type: 'delete', ids: ['b']});
 assert.equal(e.doc.constraints.filter((c) => c.kind === 'coincident').length, 0, '지운 객체의 구속은 정리된다');
 e.execute({type: 'constraints.set', mode: 'replace', constraints: []});
 assert.equal(e.doc.constraints.length, 0);
 assert.throws(() => e.execute({type: 'constraints.set', constraints: [{kind: 'tangent'}]}), /구속 종류/);
});

test('420 AUTOCONSTRAIN solve: 구속을 걸면서 공차 안 틈을 바로 맞춘다', () => {
 const e = new DrawingEngine();
 for (const x of [L('a', p(0, 0), p(1000, 0.4)), L('b', p(1000.5, 0), p(1000, 800))]) e.execute({type: 'add', entity: x});
 const {constraints} = autoConstrain(e.selected(['a', 'b']), {tol: 1, angTol: 1});
 e.execute({type: 'constraints.set', constraints, solve: true, solveIds: ['a', 'b']});
 const a = e.doc.entities.find((x) => x.id === 'a'), b = e.doc.entities.find((x) => x.id === 'b');
 assert.equal(a.points[1].y, a.points[0].y, '수평으로 맞춤');
 assert.deepEqual(b.points[0], a.points[1], '끝점 일치');
});
