import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateChecklist, loadDrawingRecipes } from './drawing-recipes.js';

const recipe = checklist => ({ checklist });

test('loads the protected recipe knowledge through the shared loader', async () => {
  const data = await loadDrawingRecipes();
  assert.equal(data.recipes.find(item => item.id === 'plan').sheetNo, '22~25');
});

test('evaluates plan facts with explicit boolean and applicability states', () => {
  const input = recipe(['axes', 'walls', 'windows', 'note', 'title'].map(id => ({id, auto: `planCheck:${id}`})));
  const result = evaluateChecklist(input, {facts: {axes: true, walls: false, windows: null, note: undefined, title: true}});
  assert.deepEqual(result.map(item => item.status), ['done', 'missing', 'na', 'manual', 'done']);
});

test('evaluates layers, entity types, model kinds, and text regex', () => {
  const result = evaluateChecklist(recipe([
    { id: 'layer', auto: 'hasLayer:A-GRID' },
    { id: 'type', auto: 'hasEntityType:dimension' },
    { id: 'stair', auto: 'modelHas:stair' },
    { id: 'title', auto: 'hasText:^1F$' },
  ]), {
    model: { elements: [{ kind: 'stair' }] },
    document: { layers: [{name:'A-GRID'}], entities: [{ type: 'dimension' }, { text: '1F' }] },
  });
  assert.deepEqual(result.map(item => item.status), ['done', 'done', 'done', 'done']);
});

test('distinguishes missing, known-model na, and unavailable manual checks', () => {
  const result = evaluateChecklist(recipe([
    { id: 'layer', auto: 'hasLayer:NOPE' },
    { id: 'wall', auto: 'modelHas:wall' },
    { id: 'unknown', auto: 'modelHas:wall' },
    { id: 'manual', auto: null },
  ]), { model: { entities: [] }, document: {} });
  assert.equal(result[0].status, 'missing');
  assert.equal(result[1].status, 'na');
  assert.equal(result[2].status, 'na');
  assert.equal(result[3].status, 'manual');
  assert.equal(evaluateChecklist(recipe([{ id: 'x', auto: 'modelHas:wall' }]), {}).at(0).status, 'manual');
  assert.equal(evaluateChecklist(recipe([{ id: 'x', auto: 'hasLayer:X' }]), {}).at(0).status, 'manual');
  assert.equal(evaluateChecklist(recipe([{ id: 'x', auto: 'hasText:[' }]), { document: {} }).at(0).status, 'manual');
});

test('applies model and story conditions', () => {
  const result = evaluateChecklist(recipe([
    { id: 'stair-only', when: { model: ['stair'] }, auto: 'modelHas:stair' },
    { id: 'roof', when: { story: 'roof' }, auto: null },
    { id: 'conditional', when: 'if-applicable', auto: null },
  ]), { model: { elements: [{ kind: 'wall' }] }, story: { id: '1F', roof: false } });
  assert.equal(result[0].status, 'na');
  assert.equal(result[1].status, 'na');
  assert.equal(result[2].status, 'manual');
});

test('does not mutate recipe or context inputs', () => {
  const input = { checklist: [{ id: 'x', auto: 'modelHas:wall' }] };
  const before = JSON.stringify(input);
  evaluateChecklist(input, { model: { elements: [{ kind: 'wall' }] } });
  assert.equal(JSON.stringify(input), before);
});

test('unknown classification differs from explicit false, and classifications may overlap', () => {
  const checks = recipe(['roof', 'lowest', 'parking'].map(story => ({ id: story, when: { story }, auto: 'modelHas:wall' })));
  const model = { elements: [{ kind: 'wall', story: 'B1' }] };
  assert.deepEqual(evaluateChecklist(checks, { model, story: { id: 'B1' } }).map(r => r.status), ['manual', 'manual', 'manual']);
  assert.deepEqual(evaluateChecklist(checks, { model, story: 'B1' }).map(r => r.status), ['manual', 'manual', 'manual']);
  assert.deepEqual(evaluateChecklist(checks, { model, story: '1F' }).map(r => r.status), ['manual', 'manual', 'manual']);
  assert.deepEqual(evaluateChecklist(checks, { model, story: { id: 'B1', roof: false, lowest: true, parking: true } }).map(r => r.status), ['na', 'done', 'done']);
  assert.equal(evaluateChecklist(recipe([{ id: 'first', when: { story: '1F' }, auto: null }]), { story: { id: 'ground', index: 1 } })[0].status, 'manual');
});

test('finds nested and referenced block contents without counting unused definitions or looping', () => {
  const document = { entities: [{ type: 'block', entities: [{ type: 'text', text: '구분' }] }, { type: 'block', sharedBlock: 'used' }], sharedBlocks: {
    used: { entities: [{ type: 'dimension' }, { type: 'block', sharedBlock: 'cycle' }] },
    cycle: { entities: [{ type: 'block', sharedBlock: 'used' }] },
    unused: { entities: [{ type: 'text', text: 'UNUSED' }] },
  } };
  const result = evaluateChecklist(recipe([
    { id: 'text', auto: 'hasText:^구분$' },
    { id: 'dimension', auto: 'hasEntityType:dimension' },
    { id: 'unused', auto: 'hasText:UNUSED' },
  ]), { document });
  assert.deepEqual(result.map(r => r.status), ['done', 'done', 'missing']);
});

test('model kind checks respect floors including door/window host references', () => {
  const model = { elements: [
    { id: 'w1', kind: 'wall', story: '1F' },
    { id: 'w2', kind: 'wall', story: '2F' },
    { id: 'd2', kind: 'door', host: 'w2' },
    { id: 's2', kind: 'stair', story: '2F' },
  ] };
  const input = recipe([
    { id: 'door', when: { model: ['door'] }, auto: null },
    { id: 'stair', auto: 'modelHas:stair' },
    { id: 'wall', auto: 'modelHas:wall' },
  ]);
  assert.deepEqual(evaluateChecklist(input, { model, story: { id: '1F' } }).map(r => r.status), ['na', 'na', 'done']);
  assert.deepEqual(evaluateChecklist(input, { model, story: { id: '2F' } }).map(r => r.status), ['manual', 'done', 'done']);
});

test('malformed model is unknown rather than an empty known model', () => {
  const input = recipe([{ id: 'stair', when: { model: ['stair'] }, auto: 'modelHas:stair' }]);
  for (const model of [{}, { elements: 'bad' }, { elements: [{}] }, { kinds: [] }]) {
    assert.equal(evaluateChecklist(input, { model })[0].status, 'manual');
  }
  assert.equal(evaluateChecklist(input, { model: { elements: [] } })[0].status, 'na');
});

test('supports actual CAD text/entities and layer arrays without mutating context', () => {
  const context = { document: { layers: ['A-GRID'], entities: [{ type: 'text', text: '축선 X1' }, { type: 'dimension' }] } };
  const before = structuredClone(context);
  const result = evaluateChecklist(recipe([
    { id: 'layer', auto: 'hasLayer:A-GRID' },
    { id: 'text', auto: 'hasText:^축선 X[0-9]+$' },
    { id: 'dim', auto: 'hasEntityType:dimension' },
    { id: 'bad', auto: 'hasText:[' },
    { id: 'unsupported', auto: 'future:wall' },
  ]), context);
  assert.deepEqual(result.map(r => r.status), ['done', 'done', 'done', 'manual', 'manual']);
  assert.deepEqual(context, before);
});
