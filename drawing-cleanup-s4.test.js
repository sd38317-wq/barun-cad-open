import test from 'node:test';
import assert from 'node:assert/strict';
import {planOverkill, overkillCommand, planGeometryCleanup, geometryCleanupCommand} from './drawing-cleanup.js';
import {DrawingEngine} from './engine.js';

const p = (x, y) => ({x, y});
const doc = (entities) => ({entities: entities.map((e) => ({layer: 'A', ...e}))});

test('419 OVERKILL 공차 경계: 0.0049 와 0.0051(공차 0.01)도 같은 것으로 본다', () => {
 const plan = planOverkill(doc([
  {id: 'c1', type: 'circle', center: p(0.0049, 0), radius: 5},
  {id: 'c2', type: 'circle', center: p(0.0051, 0), radius: 5},
  {id: 't1', type: 'text', position: p(10.0049, 0), text: 'A', height: 100},
  {id: 't2', type: 'text', position: p(10.0051, 0), text: 'A', height: 100},
  {id: 'pl1', type: 'polyline', points: [p(0, 0.0049), p(100, 0.0049)]},
  {id: 'pl2', type: 'polyline', points: [p(100, 0.0051), p(0, 0.0051)]},
  {id: 'far', type: 'circle', center: p(0.03, 0), radius: 5},
 ]), {tolerance: 0.01});
 assert.deepEqual(new Set(plan.deleteIds), new Set(['c2', 't2', 'pl2']));
});

test('419 OVERKILL 호: 같은 원 위 겹친 호는 하나로, 한 바퀴를 덮으면 원으로', () => {
 const arcs = [
  {id: 'a1', type: 'arc', center: p(0, 0), radius: 50, startAngle: 0, endAngle: 120},
  {id: 'a2', type: 'arc', center: p(0, 0), radius: 50, startAngle: 90, endAngle: 200},
  {id: 'a3', type: 'arc', center: p(0, 0), radius: 50, startAngle: 30, endAngle: 60},
  {id: 'b1', type: 'arc', center: p(500, 0), radius: 50, startAngle: 350, endAngle: 190},
  {id: 'b2', type: 'arc', center: p(500, 0), radius: 50, startAngle: 180, endAngle: 0},
  {id: 'touch1', type: 'arc', center: p(900, 0), radius: 50, startAngle: 0, endAngle: 90},
  {id: 'touch2', type: 'arc', center: p(900, 0), radius: 50, startAngle: 90, endAngle: 180},
 ];
 const plan = planOverkill(doc(arcs), {tolerance: 0.01});
 assert.ok(plan.deleteIds.includes('a3') && plan.deleteIds.includes('a2'));
 const keep = plan.updates.find((u) => u.id === 'a1');
 assert.deepEqual([keep.changes.startAngle, keep.changes.endAngle].map((v) => Math.round(v)), [0, 200]);
 assert.equal(plan.adds.length, 1); assert.equal(plan.adds[0].type, 'circle'); assert.deepEqual(plan.adds[0].center, p(500, 0));
 assert.ok(!plan.deleteIds.includes('touch2'), '끝끼리 닿기만 한 호는 기본으로 두고');
 assert.ok(planOverkill(doc(arcs), {tolerance: 0.01, endToEnd: true}).deleteIds.includes('touch2'), 'endToEnd 면 잇는다');
 // 엔진에 그대로 적용 가능한 batch(지우기·고치기·원 더하기).
 const e = new DrawingEngine();
 e.execute({type: 'layer.add', name: 'A', color: '#ffffff'});
 const layer = e.doc.layers.at(-1).id;
 for (const a of arcs) e.execute({type: 'add', entity: {...a, layer}});
 e.execute(overkillCommand(planOverkill(e.doc, {tolerance: 0.01})));
 assert.equal(e.doc.entities.filter((x) => x.type === 'circle').length, 1);
});

test('424 GEOMETRYCLEANUP: 틈·넘침·모자람·각도 오류를 찾고 고른 종류만 한 번에 고친다', () => {
 const lines = [
  {id: 'h', type: 'line', points: p(0, 0) && [p(0, 0), p(1000, 0)]},
  {id: 'gap', type: 'line', points: [p(1000.6, 0), p(1000.6, 500)]},
  {id: 'over', type: 'line', points: [p(500, -100), p(500, 3)]},
  {id: 'under', type: 'line', points: [p(300, -100), p(300, -4)]},
  {id: 'tilt', type: 'line', points: [p(0, 2000), p(1000, 2003)]},
  {id: 'ok', type: 'line', points: [p(5000, 0), p(5000, 900)]},
 ];
 const plan = planGeometryCleanup(doc(lines), {gap: 1, shoot: 5, angle: 0.5});
 assert.deepEqual(plan.counts, {gap: 1, overshoot: 1, undershoot: 1, angle: 1});
 const e = new DrawingEngine();
 e.execute({type: 'layer.add', name: 'A', color: '#ffffff'});
 const layer = e.doc.layers.at(-1).id;
 for (const l of lines) e.execute({type: 'add', entity: {...l, layer}});
 const cmd = geometryCleanupCommand(plan, e.doc, ['overshoot', 'undershoot', 'angle']);
 e.execute(cmd);
 const at = (id) => e.doc.entities.find((x) => x.id === id).points;
 assert.deepEqual(at('over')[1], p(500, 0)); assert.deepEqual(at('under')[1], p(300, 0));
 assert.equal(at('tilt')[0].y, at('tilt')[1].y, '수평으로');
 assert.deepEqual(at('gap')[0], p(1000.6, 0), '틈은 고르지 않아 그대로');
 assert.equal(geometryCleanupCommand({issues: []}, e.doc), null);
 assert.throws(() => planGeometryCleanup(doc(lines), {gap: -1}), /공차/);
});
