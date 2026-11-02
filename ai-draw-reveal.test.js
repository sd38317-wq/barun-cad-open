import test from 'node:test';
import assert from 'node:assert/strict';
import {planReveal, partialEntity} from './ai-draw-reveal.js';
import * as G from './geometry.js';
import {buildDetail} from './detail-library.js';

const point = (x, y = 0) => ({x, y});
const line = (x = 0, y = 0, extra = {}) => ({type: 'line', points: [point(x, y), point(x + 1, y)], ...extra});
const block = (entity, sourceId = 'detail') => ({...entity, sourceType: 'block', sourceId});
const keys = entities => planReveal(entities.map(entity => block(entity))).clusters[0].stages.map(stage => stage.key);
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-8, actual + ' != ' + expected);

test('real buildDetail INSERT reveals structural layers through title in exact stage order', () => {
  const built = buildDetail('wall-rc-ext');
  assert.deepEqual(keys(built.entities), ['structure', 'layers', 'hatch', 'dims', 'leaders', 'text', 'title']);
});

test('annotation dashed geometry stays out of base; grid and center geometry enter base', () => {
  const entities = [line(0, 0, {layerName: 'A-DIM', _displayLinetype: 'DASHED'}),
    line(1, 0, {layerName: 'A-GRID-MAIN'}), line(2, 0, {_displayLinetype: 'CENTER2'}),
    line(3, 0, {layerName: 'A-CNTR-MAIN'}), line(4, 0, {layerName: 'A-TEXT'})];
  const stages = planReveal(entities.map(e => block(e))).clusters[0].stages;
  assert.deepEqual(stages.map(stage => stage.key), ['base', 'layers']);
  assert.deepEqual(stages[0].items.map(e => e.points[0].x).sort(), [1, 2, 3]);
  assert.equal(stages[1].items.length, 2);
});

test('semantic dot and title roles override hatch/text primitives', () => {
  assert.deepEqual(keys([{type: 'hatch', detailRole: 'dot'}, {type: 'text', detailRole: 'title'}]), ['leaders', 'title']);
});

test('explicit dimension roles override the primitive used to display them', () => {
  assert.deepEqual(keys([{type: 'text', detailRole: 'layer'}, {type: 'hatch', detailRole: 'extra'}]), ['dims']);
});

test('material labels and repository material IDs classify as structure', () => {
  for (const detailMaterial of ['콘크리트', 'RC', '철골', 'concrete', 'lean', 'brick', {name: '철근'}]) {
    assert.deepEqual(keys([line(0, 0, {detailMaterial})]), ['structure']);
  }
});

test('4001 display entities are immediate; 4000 remain eligible', () => {
  const entities = Array.from({length: 4001}, () => block(line()));
  assert.equal(planReveal(entities).immediate, true);
  const allowed = planReveal(entities.slice(0, 4000));
  assert.equal(allowed.immediate, false);
  assert.equal(allowed.total, 4000);
});

test('documents over 200000 objects are immediate', () => {
  assert.equal(planReveal([line()], {totalEntities: 200001}).immediate, true);
  assert.equal(planReveal([line()], {totalEntities: 200000}).immediate, false);
});

test('two INSERTs retain two clusters even at identical positions', () => {
  const plan = planReveal([block(line(), 'a'), block(line(), 'b'), block(line(), 'a')]);
  assert.equal(plan.clusters.length, 2);
  assert.deepEqual(plan.clusters.map(c => c.stages[0].items.length), [2, 1]);
});

test('thirteen INSERT clusters are immediate instead of merging block identities', () => {
  assert.equal(planReveal(Array.from({length: 13}, (_, i) => block(line(), i))).immediate, true);
});

test('spatial neighbors on grid borders group together and distant groups remain separate', () => {
  const plan = planReveal([line(0), line(32.9), line(33.4), line(100)]);
  assert.equal(plan.clusters.length, 3);
  assert.ok(plan.clusters.some(c => c.stages[0].items.length === 2));
});

test('spatial cluster count respects the maximum of twelve', () => {
  const entities = [];
  for (let x = 0; x <= 100; x += 25) for (let y = 0; y <= 100; y += 25) entities.push(line(x, y));
  const plan = planReveal(entities);
  assert.ok(plan.clusters.length <= 12);
  assert.equal(plan.clusters.flatMap(c => c.stages.flatMap(s => s.items)).length, entities.length);
});

test('cluster reading order is upper left to lower right in positive-Y-up CAD coordinates', () => {
  const plan = planReveal([block(line(100, -100), 'bottom'), block(line(100, 100), 'right'), block(line(0, 100), 'left')]);
  assert.deepEqual(plan.clusters.map(c => c.stages[0].items[0].sourceId), ['left', 'right', 'bottom']);
});

test('duration is between 1200 and 18000 ms and normal cluster target is 3200 ms', () => {
  assert.equal(planReveal([line()]).durationMs, 3200);
  assert.equal(planReveal([line()], {clusterMs: 10}).durationMs, 1200);
  assert.equal(planReveal(Array.from({length: 4000}, () => block(line()))).durationMs, 18000);
  assert.equal(planReveal([]).durationMs, 0);
});

test('greedy ordering follows actual end to actual start, not bounding corners', () => {
  const a = {id: 'a', type: 'line', points: [point(0), point(100)]};
  const b = {id: 'b', type: 'line', points: [point(101), point(-100)]};
  const c = {id: 'c', type: 'line', points: [point(2), point(3)]};
  const items = planReveal([a, c, b].map(e => block(e))).clusters[0].stages[0].items;
  assert.deepEqual(items.map(e => e.id), ['a', 'b', 'c']);
});

test('more than 600 stage items use actual starting x then y sort', () => {
  const entities = Array.from({length: 601}, (_, i) => block({id: i, type: 'line', points: [point(600 - i, i % 2), point(-i - 1)]}));
  const items = planReveal(entities).clusters[0].stages[0].items;
  assert.equal(items[0].id, 600);
  assert.equal(items.at(-1).id, 0);
});

test('missing geometry never crashes planning', () => {
  const plan = planReveal([{type: 'unknown'}, {type: 'text', text: 'A'}]);
  assert.equal(plan.total, 2);
});

test('line halfway endpoint and input immutability', () => {
  const entity = {type: 'line', points: [point(0), point(10)]};
  const original = structuredClone(entity);
  const partial = partialEntity(entity, .5);
  assert.deepEqual(partial.pen, point(5));
  assert.deepEqual(partial.entity.points, [point(0), point(5)]);
  assert.deepEqual(entity, original);
});

test('unequal polyline segments use path length', () => {
  const entity = {type: 'lwpolyline', points: [point(0), point(100), point(100, 1)]};
  assert.deepEqual(partialEntity(entity, .5).pen, point(50.5));
});

test('closed polyline includes the closing segment and finishes at its start', () => {
  const entity = {type: 'polyline', closed: true, points: [point(0), point(10), point(10, 10), point(0, 10)]};
  const partial = partialEntity(entity, .875);
  assert.deepEqual(partial.pen, point(0, 5));
  assert.equal(partial.entity.closed, false);
  assert.deepEqual(partialEntity(entity, 1).pen, point(0));
});

test('positive and negative bulges follow curved length and emit visible curved points', () => {
  for (const bulge of [1, -1]) {
    const entity = {type: 'polyline', points: [point(0), point(10)], bulges: [bulge]};
    const partial = partialEntity(entity, .5);
    close(partial.pen.x, 5); close(partial.pen.y, -5 * bulge);
    assert.ok(partial.entity.points.length > 2);
    assert.equal(partial.entity.bulges, undefined);
    assert.deepEqual(entity.bulges, [bulge]);
  }
});

test('bulged and straight polyline segments allocate by their true lengths', () => {
  const entity = {type: 'polyline', points: [point(0), point(10), point(20)], bulges: [1, 0]};
  const fraction = (5 * Math.PI) / (5 * Math.PI + 10);
  const partial = partialEntity(entity, fraction);
  close(partial.pen.x, 10); close(partial.pen.y, 0);
});

test('wrapped arc uses CCW sweep and returns angles in degrees', () => {
  const entity = {type: 'arc', center: point(0), radius: 10, startAngle: 350, endAngle: 10};
  const partial = partialEntity(entity, .5);
  close(partial.pen.x, 10); close(partial.pen.y, 0);
  assert.equal(partial.entity.startAngle, 350);
  assert.equal(partial.entity.endAngle, 360);
});

test('arc sweeps over 180 degrees follow the full CCW arc', () => {
  const entity = {type: 'arc', center: point(0), radius: 10, startAngle: 10, endAngle: 350};
  const partial = partialEntity(entity, .5);
  assert.equal(partial.entity.endAngle, 180);
  close(partial.pen.x, -10); close(partial.pen.y, 0);
  close(partialEntity(entity, 1).pen.x, 10 * Math.cos(350 * Math.PI / 180));
});

test('circle starts on circumference and partial arcs stay in degrees', () => {
  const entity = {type: 'circle', center: point(10, 20), radius: 5};
  const partial = partialEntity(entity, .25);
  assert.equal(partial.entity.type, 'arc');
  assert.equal(partial.entity.startAngle, 0); assert.equal(partial.entity.endAngle, 90);
  close(partial.pen.x, 10); close(partial.pen.y, 25);
  assert.deepEqual(partialEntity(entity, 1).pen, point(15, 20));
  assert.equal(partialEntity(entity, 0).entity, null);
});

test('text and dimensions appear as whole objects only at completion', () => {
  for (const type of ['text', 'mtext', 'dimension', 'hatch']) {
    const entity = {type, position: point(0)};
    assert.equal(partialEntity(entity, .99).entity, null);
    assert.equal(partialEntity(entity, 1).entity, entity);
  }
});

test('plan preserves frozen input entities and arrays', () => {
  const entity = Object.freeze(block(Object.freeze(line())));
  const entities = Object.freeze([entity]);
  assert.equal(planReveal(entities).clusters[0].stages[0].items[0], entity);
});

test('cluster boundaries use shared geometry for ellipse, dimension text, mleader and rectangle',()=>{
 const entities=[
  {type:'ellipse',center:point(100,200),majorAxis:point(30,10),ratio:.4},
  {type:'dimension',mode:'horizontal',points:[point(100,100),point(200,100),point(100,120)],offset:20,textPosition:point(500,500),height:10,textHeight:10},
  {type:'mleader',points:[point(700,700),point(800,900)],textPosition:point(900,900)},
  {type:'rectangle',points:[point(1000,1000),point(1100,1000),point(1100,1200),point(1000,1200)]}
 ];
 for(const entity of entities)assert.deepEqual(planReveal([block(entity)]).clusters[0].bounds,G.bounds([entity]),entity.type);
});
test('invalid boundaries do not add an origin or poison valid cluster bounds',()=>{
 const good=line(1000,2000),bad={type:'line',points:[point(NaN),point(Infinity)]};
 const plan=planReveal([good,bad,{type:'unknown'}].map(e=>block(e)));
 assert.deepEqual(plan.clusters[0].bounds,G.bounds([good]));
 assert.equal(planReveal([bad,{type:'unknown'}].map(e=>block(e))).clusters[0].bounds,null);
});
test('rectangle partial traces all four edges as an open vertex path',()=>{
 const rectangle={type:'rectangle',points:[point(0,0),point(10,0),point(10,10),point(0,10)]};
 const before=structuredClone(rectangle),partial=partialEntity(rectangle,.875);
 assert.equal(partial.entity.type,'polyline');assert.equal(partial.entity.closed,false);
 assert.deepEqual(partial.pen,point(0,5));assert.deepEqual(partial.entity.points,[...rectangle.points,point(0,5)]);
 assert.deepEqual(partialEntity(rectangle,1).pen,point(0,0));assert.deepEqual(rectangle,before);
});

test('a loose single detail stays one cluster: its title strip is not a separate camera stop', () => {
 const built=buildDetail('wall-rc-ext',{}, {scale:20}),plan=planReveal(built.entities.map((entity,i)=>({...entity,id:'w'+i})));
 assert.equal(plan.clusters.length,1);
 assert.equal(plan.clusters[0].stages.at(-1).key,'title');
});
