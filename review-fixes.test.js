// 최대 검토(2026-09-26)에서 확인된 결함의 회귀 시험: 엔진·기하·리습 핵심 경로.
import test from 'node:test';
import assert from 'node:assert/strict';
import {DrawingEngine} from './engine.js';
import * as G from './geometry.js';

const line = (id, a, b, extra = {}) => ({id, type: 'line', layer: 'default', points: [a, b], ...extra});

test('카드 도중 실패: 바깥 묶음은 시작 전으로 되돌리고, 안쪽 묶음은 바깥 작업을 지우지 않는다', () => {
 const engine = new DrawingEngine();
 engine.execute({type: 'add', entity: line('keep', {x: 0, y: 0}, {x: 1, y: 0})});
 engine.beginTransaction();
 engine.execute({type: 'add', entity: line('partial', {x: 0, y: 1}, {x: 1, y: 1})});
 assert.equal(engine.rollbackTransaction().rolledBack, true);
 assert.deepEqual(engine.doc.entities.map(e => e.id), ['keep']);
 engine.execute({type: 'undo'});
 assert.equal(engine.doc.entities.length, 0, '실패한 카드는 되돌리기 단계도 남기지 않음');
 engine.beginTransaction();
 engine.execute({type: 'add', entity: line('outer', {x: 0, y: 2}, {x: 1, y: 2})});
 engine.beginTransaction();
 assert.equal(engine.rollbackTransaction().nested, true);
 engine.endTransaction();
 assert.ok(engine.doc.entities.some(e => e.id === 'outer'));
});

test('updateMany: 객체마다 다른 값을 한 번에, 되돌리기 한 번, id·형식 변경은 거절', () => {
 const engine = new DrawingEngine();
 engine.execute({type: 'addMany', entities: [line('a', {x: 0, y: 0}, {x: 1, y: 0}), line('b', {x: 0, y: 1}, {x: 1, y: 1})]});
 const [a, b] = engine.doc.entities.map(e => e.id);
 engine.execute({type: 'updateMany', updates: [{id: a, changes: {lineweight: 0.3}}, {id: b, changes: {lineweight: 0.5}}]});
 assert.deepEqual(engine.doc.entities.map(e => e.lineweight), [0.3, 0.5]);
 engine.execute({type: 'undo'});
 assert.deepEqual(engine.doc.entities.map(e => e.lineweight), [undefined, undefined]);
 assert.throws(() => engine.execute({type: 'updateMany', updates: [{id: a, changes: {type: 'circle'}}]}), /변경할 수 없습니다/);
 assert.throws(() => engine.execute({type: 'updateMany', updates: []}), /없습니다/);
});

test('선택 검사는 큰 도면에서 선형 시간(4만 객체 중 1만 개 고치기)', () => {
 const engine = new DrawingEngine();
 const many = Array.from({length: 40000}, (_, i) => line('e' + i, {x: i, y: 0}, {x: i, y: 1}));
 engine.execute({type: 'addMany', entities: many});
 const ids = engine.doc.entities.slice(0, 10000).map(e => e.id);
 const started = performance.now();
 engine.execute({type: 'update', ids, changes: {lineweight: 0.3}});
 engine.execute({type: 'updateMany', updates: ids.map((id, i) => ({id, changes: {linetypeScale: 1 + i % 3}}))});
 assert.ok(performance.now() - started < 3000, `${Math.round(performance.now() - started)} ms`);
});

test('현재 선종류 CENTER 로 그린 선은 중심선 레이어로 옮기지 않음 (명령이 준 CENTER 는 예전처럼)', () => {
 const engine = new DrawingEngine();
 engine.execute({type: 'addMany', currentLinetype: 'CENTER', entities: [line('cur', {x: 0, y: 0}, {x: 1, y: 0}, {linetype: 'CENTER'})]});
 assert.equal(engine.doc.entities[0].layer, 'default');
 engine.execute({type: 'addMany', entities: [line('cmd', {x: 0, y: 1}, {x: 1, y: 1}, {linetype: 'CENTER'})]});
 assert.notEqual(engine.doc.entities[1].layer, 'default');
});

test('공유 블록 대칭은 180° 회전이 아니라 진짜 대칭', () => {
 const engine = new DrawingEngine();
 const doc = structuredClone(engine.doc);
 doc.version = 3;
 doc.sharedBlocks = {L: {name: 'L', origin: {x: 0, y: 0}, entities: [{type: 'line', layer: 'default', points: [{x: 0, y: 0}, {x: 100, y: 0}]}, {type: 'line', layer: 'default', points: [{x: 0, y: 0}, {x: 0, y: 30}]}]}};
 doc.entities = [{id: 'r', type: 'block', name: 'L', layer: 'default', sharedBlock: 'L', position: {x: 0, y: 0}, rotation: 0, scale: 1, entities: []}];
 engine.execute({type: 'load', document: doc});
 engine.execute({type: 'mirror', ids: ['r'], a: {x: 0, y: -1}, b: {x: 0, y: 1}, eraseSource: true});
 const mirrored = engine.doc.entities.find(e => e.type === 'block');
 const pts = G.visibleEntities(engine.doc, {entities: [mirrored]})[0].entities.map(e => e.points.map(p => [Math.round(p.x), Math.round(p.y)]));
 assert.deepEqual(pts.sort(), [[[0, 0], [-100, 0]], [[0, 0], [0, 30]]].sort());
});

test('공간 색인: 지운 표시가 남은 객체를 다시 넣으면 다시 찾힘', () => {
 const a = line('a', {x: 0, y: 0}, {x: 10, y: 0}), b = line('b', {x: 0, y: 5}, {x: 10, y: 5});
 const index = G.spatialIndex([a]);
 index.remove([b]);index.insert([b]);
 assert.deepEqual(index.query({minX: -1, minY: -1, maxX: 11, maxY: 6}).map(e => e.id).sort(), ['a', 'b']);
});

test('예전 해치: 축척하면 무늬 배율도, 옮기면 무늬 기준점도 함께', () => {
 const hatch = {id: 'h', type: 'hatch', layer: 'default', points: [{x: 0, y: 0}, {x: 100, y: 0}, {x: 100, y: 100}], pattern: 'lines', spacing: 100, hatchScale: 1, angle: 0};
 const scaled = G.resize(hatch, {x: 0, y: 0}, 2);
 assert.equal(scaled.spacing, 200);assert.equal(scaled.hatchScale, 2);
 const moved = G.translate(hatch, 30, 40);
 assert.deepEqual(moved.origin, {x: 30, y: 40});
});

