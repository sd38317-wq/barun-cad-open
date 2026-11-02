import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {DrawingEngine} from './engine.js';
import {prepareJutongInsertion} from './jutong-insertion.js';
import {convexHull, indongRequest, applyIndongMarks, INDONG_CHECK_LAYER} from './indong-client.js';

function detail() {
 return {id: 'JT-indong', name: '시험 판상', scale_verified: true,
  geometry: {units: 'mm', layers: [{id: 'src', name: 'A-BLDG-L1', color: '#ffffff', visible: true, plot: true}],
   entities: [{id: 'o', type: 'polyline', layer: 'src', closed: true, points: [{x: 0, y: 0}, {x: 30000, y: 0}, {x: 30000, y: 12000}, {x: 0, y: 12000}]},
    {id: 'i', type: 'line', layer: 'src', points: [{x: 5000, y: 1500}, {x: 25000, y: 1500}]}]}};
}

test('CAD 쪽에는 인동 규칙·면 구분이 없다(설계 엔진 서버 계산)', () => {
 for (const f of ['indong-client.js', 'jutong-insertion.js']) {
  const src = fs.readFileSync(new URL('./' + f, import.meta.url), 'utf8');
  assert.ok(!/indong_facades|0\.5\s*\*|측벽↔측벽|A-INDG-(LITE|SIDE|NONE)/.test(src), f);
 }
 assert.ok(!fs.existsSync(new URL('./indong-check.js', import.meta.url)));
});

test('놓인 주동마다 JUTONG_ID·층수·볼록 외곽(회전 반영)만 보낸다', () => {
 let doc = new DrawingEngine().doc;
 doc = prepareJutongInsertion(doc, {detail: detail(), position: {x: 1000, y: 2000}, rotation: 90}).document;
 doc.entities[0].attributes.FLOORS = 25;
 doc = {...doc, entities: [...doc.entities, {id: 'x', type: 'line', layer: doc.layers[0].id, points: [{x: 0, y: 0}, {x: 1, y: 1}]}]};
 const r = indongRequest(doc, {floors: 20, floorHeight: 2.9});
 assert.deepEqual(Object.keys(r).sort(), ['buildings', 'floor_height_m', 'floors_default', 'version']);
 assert.equal(r.buildings.length, 1);
 const b = r.buildings[0];
 assert.equal(b.jutong_id, 'JT-indong'); assert.equal(b.floors, 25);
 const xs = b.hull.map(p => p[0]), ys = b.hull.map(p => p[1]);
 assert.deepEqual([Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)], [1000 - 12000, 1000, 2000, 2000 + 30000]);
 assert.equal(b.hull.length, 4);
});

test('볼록 외곽은 안쪽 점을 버린다', () => {
 assert.deepEqual(convexHull([{x: 0, y: 0}, {x: 10, y: 0}, {x: 10, y: 10}, {x: 0, y: 10}, {x: 5, y: 5}]).length, 4);
});

test('서버 표시를 A-INDG-CHCK 에 그리고, 다시 하면 바꾸고, 되돌리기 한 번', () => {
 const e = new DrawingEngine();
 e.execute({type: 'load', document: prepareJutongInsertion(e.doc, {detail: detail(), position: {x: 0, y: 0}, rotation: 0}).document});
 const result = {status: 'ok', buildings: 2, rows: [{}], short: 1, marks: [
  {type: 'line', from: [0, 12000], to: [0, 32000], ok: false},
  {type: 'text', at: [0, 18000], text: '채광면 H×0.5 필요 29.0m · 실제 20.0m 부족', ok: false}]};
 const first = applyIndongMarks(e.doc, result);
 e.execute({type: 'lisp.apply', document: first.document}); e.validate(e.doc);
 assert.equal(e.doc.layers.find(l => l.name === INDONG_CHECK_LAYER).plot, false);
 assert.equal(e.doc.entities.length, 3);
 const again = applyIndongMarks(e.doc, result);
 assert.equal(again.document.entities.length, 3);
 e.execute({type: 'undo'}); assert.equal(e.doc.entities.length, 1);
 assert.throws(() => applyIndongMarks(e.doc, {marks: [{type: 'line', from: ['a', 0], to: [1, 1]}]}));
});
