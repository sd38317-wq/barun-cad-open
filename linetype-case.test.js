import test from 'node:test';
import assert from 'node:assert/strict';
import * as G from './geometry.js';

// The DWG engine writes 'ByLayer'/'ByBlock' in mixed case. Before, an imported
// line on a DASHED layer kept the name 'ByLayer' and was drawn solid.
test('ByLayer and ByBlock are followed whatever their case', () => {
  const doc = {layers: [{id: 'L', name: 'dash', visible: true, color: '#ffffff', linetype: 'DASHED'}], blocks: [], linetypeScale: 1, entities: [
    {id: 'a', type: 'line', layer: 'L', linetype: 'ByLayer', points: [{x: 0, y: 0}, {x: 1, y: 0}]},
    {id: 'b', type: 'line', layer: 'L', linetype: 'bylayer', points: [{x: 0, y: 1}, {x: 1, y: 1}]},
    {id: 'c', type: 'line', layer: 'L', linetype: 'HIDDEN', points: [{x: 0, y: 2}, {x: 1, y: 2}]},
    {id: 'd', type: 'block', layer: 'L', linetype: 'CENTER', name: 'B', entities: [
      {id: 'd1', type: 'line', layer: 'L', linetype: 'ByBlock', points: [{x: 0, y: 3}, {x: 1, y: 3}]},
      {id: 'd2', type: 'line', layer: 'L', linetype: 'ByLayer', points: [{x: 0, y: 4}, {x: 1, y: 4}]}]},
  ]};
  const drawn = new Map();
  const walk = list => { for (const e of list) { if (e.entities) walk(e.entities); else drawn.set(e.id, e.linetype); } };
  walk(G.visibleEntities(doc, {}));
  assert.deepEqual(Object.fromEntries(drawn), {a: 'DASHED', b: 'DASHED', c: 'HIDDEN', d1: 'CENTER', d2: 'DASHED'});
});
