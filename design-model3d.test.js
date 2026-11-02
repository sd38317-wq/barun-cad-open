import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from './three.module.js';
import {buildDesignModel3D, pushPullDesignModel} from './design-model3d.js';

const outline = [[0, 0], [6000, 0], [6000, 4000], [0, 4000]];
function fixture() {
 return {format: 'barun-building-model', version: '0.1.2', units: 'mm', props: {keep: true}, stories: [
  {id: 's1', name: '1F', elevation: 0, height: 3000},
  {id: 's2', name: '2F', elevation: 3000, height: 3000},
  {id: 'rf', name: 'RF', elevation: 6000, height: 1000},
 ], elements: [
  {id: 'front', kind: 'wall', story: 's1', path: [[0, 0], [6000, 0]], thickness: 200, height: null, exterior: true, outwardNormal: [0, -1]},
  {id: 'right', kind: 'wall', story: 's1', path: [[6000, 0], [6000, 4000]], thickness: 200, exterior: true},
  {id: 'back', kind: 'wall', story: 's1', path: [[6000, 4000], [0, 4000]], thickness: 200, exterior: true},
  {id: 'left', kind: 'wall', story: 's1', path: [[0, 4000], [0, 0]], thickness: 200, exterior: true},
  {id: 'window', kind: 'window', host: 'front', offset: 2000, width: 1500, height: 1200, sill: 900},
  {id: 'door', kind: 'door', host: 'front', offset: 500, width: 900, height: 2100},
  {id: 'floor1', kind: 'slab', story: 's1', role: 'floor', thickness: 200, outline},
  {id: 'floor2', kind: 'slab', story: 's2', role: 'floor', thickness: 220, outline},
  {id: 'roof', kind: 'slab', story: 'rf', role: 'roof', thickness: 250, outline, props: {parapet: 'rc200-h1000'}},
  {id: 'room', kind: 'space', story: 's1', unit: '101', outline: [[200, 200], [1800, 200], [1800, 1800], [200, 1800]]},
  {id: 'stair', kind: 'stair', story: 's1', outline: [[3500, 1000], [5000, 1000], [5000, 3000], [3500, 3000]]},
 ]};
}
const close = (actual, expected, epsilon = 0.01) => assert.ok(Math.abs(actual - expected) < epsilon, actual + ' != ' + expected);
function dispose(result) {result.group.traverse(o => {o.geometry?.dispose();o.material?.dispose();});}
function cast(meshes, x, z) {
 const ray = new THREE.Raycaster(new THREE.Vector3(x / 1000, z / 1000, 1), new THREE.Vector3(0, 0, -1), 0, 2);
 return ray.intersectObjects(meshes, false);
}

test('common JSON produces actual THREE shapes, correct mm dimensions and unchanged input', () => {
 const model = fixture(), before = structuredClone(model), built = buildDesignModel3D(model, {setId: 'set-a'});
 assert.ok(built.group.isGroup);assert.ok(built.box.isBox3);assert.equal(built.wallCount, 4);
 assert.deepEqual(built.floors, ['1F', '2F', 'RF']);assert.deepEqual(built.siteEdges, []);
 assert.equal(built.group.children.length, 18);assert.equal(built.solids.length, 18);
 close(built.box.min.x * 1000, -100);close(built.box.max.x * 1000, 6100);
 close(built.box.min.y * 1000, -200);close(built.box.max.y * 1000, 7000);
 close(built.box.min.z * 1000, -4100);close(built.box.max.z * 1000, 100);
 assert.deepEqual(model, before);dispose(built);
});

test('door and window are real empty openings with sill and header remaining', () => {
 const built = buildDesignModel3D(fixture()), walls = built.group.children.filter(m => m.userData.objectId === 'front');
 assert.equal(walls.length, 6);
 assert.equal(cast(walls, 2500, 1500).length, 0);assert.equal(cast(walls, 1000, 1000).length, 0);
 assert.ok(cast(walls, 2500, 400).length);assert.ok(cast(walls, 2500, 2600).length);assert.ok(cast(walls, 1000, 2600).length);
 const parts = built.solids.filter(s => s.id === 'front');
 const volume = parts.reduce((sum, p) => sum + Math.hypot(p.outline[1].x - p.outline[0].x, p.outline[1].y - p.outline[0].y) * 200 * p.height, 0);
 close(volume, (6000 * 3000 - 1500 * 1200 - 900 * 2100) * 200);
 dispose(built);
});

test('overlapping openings subtract their union without filling or duplicating concrete', () => {
 const model = fixture();model.elements.push({id: 'overlap', kind: 'window', host: 'front', offset: 2500, width: 2000, sill: 1500, height: 1200});
 const built = buildDesignModel3D(model), walls = built.group.children.filter(m => m.userData.objectId === 'front');
 assert.equal(cast(walls, 3000, 2300).length, 0);assert.equal(cast(walls, 4000, 1800).length, 0);assert.ok(cast(walls, 4000, 1000).length);
 const volume = built.solids.filter(s => s.id === 'front').reduce((sum, p) => sum + length2(p.outline[0], p.outline[1]) * 200 * p.height, 0);
 close(volume, (6000 * 3000 - (1500 * 1200 + 2000 * 1200 - 1000 * 600) - 900 * 2100) * 200);dispose(built);
});
const length2 = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

test('floor selection preserves elevations and surface metadata targets the supporting storey', () => {
 const built = buildDesignModel3D(fixture(), {setId: 'set-a', floors: ['2F', 'RF']});
 assert.equal(built.wallCount, 0);assert.deepEqual(built.floors, ['2F', 'RF']);close(built.box.min.y * 1000, 2780);
 assert.equal(built.group.children.find(m => m.name === 'floor2').userData.pushPull.target.id, 's1');
 assert.equal(built.group.children.find(m => m.name === 'roof').userData.pushPull.target.id, 's2');dispose(built);
});

test('wall metadata includes only exterior targets and outward normals in design coordinates', () => {
 const model = fixture();model.elements.push({id: 'inner', kind: 'wall', story: 's1', path: [[3000, 0], [3000, 4000]], thickness: 100, exterior: false});
 const built = buildDesignModel3D(model, {setId: 'set-a'}), wall = built.group.children.find(m => m.name === 'front');
 assert.deepEqual(wall.userData.pushPull, {setId: 'set-a', target: {type: 'wall', id: 'front'}, normal: {x: 0, y: -1}});
 assert.equal(built.group.children.find(m => m.name === 'inner').userData.pushPull, undefined);dispose(built);
});

test('left-face reference, wall base offset and explicit height use the model dimensions', () => {
 const model = fixture();model.elements = [{id: 'wall', kind: 'wall', story: 's1', path: [[0, 0], [6000, 0]], reference: 'left-face', thickness: 200, baseOffset: 500, height: 1800}];
 const built = buildDesignModel3D(model);
 close(built.box.min.z * 1000, 0);close(built.box.max.z * 1000, 200);close(built.box.min.y * 1000, 500);close(built.box.max.y * 1000, 2300);dispose(built);
});

test('slab hole remains open and roof parapet has specified height and thickness', () => {
 const model = fixture();model.elements = [{id: 'slab', kind: 'slab', story: 's1', outline, thickness: 250, holes: [[[1000, 1000], [2000, 1000], [2000, 2000], [1000, 2000]]]}];
 const built = buildDesignModel3D(model), ray = new THREE.Raycaster(new THREE.Vector3(1.5, 1, -1.5), new THREE.Vector3(0, -1, 0));
 assert.equal(ray.intersectObjects(built.group.children).length, 0);ray.ray.origin.x = 3;assert.ok(ray.intersectObjects(built.group.children).length);dispose(built);
 const roof = buildDesignModel3D(fixture());assert.equal(roof.solids.filter(s => s.kind === 'parapet').length, 4);
 assert.ok(roof.solids.filter(s => s.kind === 'parapet').every(s => s.z === 6000 && s.height === 1000));dispose(roof);
});

test('spaces are floor colors while stair/core/mass are simple volumes', () => {
 const model = fixture();model.elements.push({id: 'ev', kind: 'elevator', story: 's1', outline: [[5000, 1000], [5800, 1000], [5800, 3000], [5000, 3000]]}, {id: 'core', kind: 'core', members: ['stair', 'ev']}, {id: 'mass', kind: 'mass', story: 's2', outline});
 const built = buildDesignModel3D(model);
 assert.equal(built.solids.find(s => s.id === 'room').height, 1);assert.equal(built.solids.find(s => s.id === 'core').height, 3000);
 assert.equal(built.solids.filter(s => ['stair', 'ev'].includes(s.id)).length, 0);
 assert.equal(built.solids.find(s => s.id === 'mass').pushPull.target.id, 's2');dispose(built);
});

test('height edit snaps to 10mm, follows elevation order, preserves stories and original', () => {
 const model = fixture();model.stories = [model.stories[2], model.stories[0], model.stories[1]];
 const before = structuredClone(model), edited = pushPullDesignModel(model, {type: 'story', id: 's1'}, 246);
 assert.equal(edited.stories.find(s => s.id === 's1').height, 3250);assert.equal(edited.stories.find(s => s.id === 's2').elevation, 3250);assert.equal(edited.stories.find(s => s.id === 'rf').elevation, 6250);
 assert.equal(edited.stories.length, 3);assert.deepEqual(model, before);assert.deepEqual(edited.props, model.props);
 const built = buildDesignModel3D(edited);close(built.solids.find(s => s.id === 'front').height, 3250);close(built.solids.find(s => s.id === 'roof').z, 6000);dispose(built);
});

test('explicit storey-height walls and top-offset roofs track height; custom heights remain', () => {
 const model = fixture();model.elements.find(e => e.id === 'front').height = 3000;model.elements.find(e => e.id === 'right').height = 1800;
 model.elements.push({id: 'own-roof', kind: 'slab', role: 'roof', story: 's1', outline, thickness: 200, topOffset: 3000});
 const edited = pushPullDesignModel(model, {type: 'story', id: 's1'}, -503, {snap: 0});
 assert.equal(edited.stories[0].height, 2497);assert.equal(edited.elements.find(e => e.id === 'front').height, 2497);
 assert.equal(edited.elements.find(e => e.id === 'right').height, 1800);assert.equal(edited.elements.find(e => e.id === 'own-roof').topOffset, 2497);
});

test('moving an exterior wall follows adjacent endpoints and T junctions, preserves offsets and other storeys', () => {
 const model = fixture();model.elements.push({id: 'T', kind: 'wall', story: 's1', path: [[3000, 0], [3000, 2000]], thickness: 100, exterior: false}, {id: 'upper', kind: 'wall', story: 's2', path: [[0, 0], [6000, 0]], thickness: 200, exterior: true});
 const before = structuredClone(model), edited = pushPullDesignModel(model, {type: 'wall', id: 'front'}, 253), get = id => edited.elements.find(e => e.id === id);
 assert.deepEqual(get('front').path, [[0, -250], [6000, -250]]);assert.deepEqual(get('right').path[0], [6000, -250]);assert.deepEqual(get('left').path[1], [0, -250]);assert.deepEqual(get('T').path, [[3000, -250], [3000, 2000]]);
 assert.deepEqual(get('upper').path, [[0, 0], [6000, 0]]);assert.equal(get('window').offset, 2000);assert.equal(get('door').offset, 500);assert.deepEqual(model, before);
});

test('outward direction inferred from floor boundary is independent of wall path direction', () => {
 const model = fixture(), front = model.elements[0];delete front.outwardNormal;front.path.reverse();
 const edited = pushPullDesignModel(model, {type: 'wall', id: 'front'}, 100);
 assert.deepEqual(edited.elements[0].path, [[6000, -100], [0, -100]]);
});

test('invalid targets, distances, nonpositive heights and interior wall operations throw without mutation', () => {
 const model = fixture();model.elements[0].exterior = false;const before = structuredClone(model);
 for (const value of [NaN, Infinity, '100', null]) assert.throws(() => pushPullDesignModel(model, {type: 'story', id: 's1'}, value));
 for (const target of [{type: 'story', id: 'missing'}, {type: 'roof', id: 's1'}, {type: 'wall', id: 'missing'}, {type: 'wall', id: 'front'}, null]) assert.throws(() => pushPullDesignModel(model, target, 100));
 assert.throws(() => pushPullDesignModel(model, {type: 'story', id: 's1'}, -3000));assert.throws(() => pushPullDesignModel(model, {type: 'story', id: 's1'}, 100, {snap: -1}));assert.deepEqual(model, before);
});

test('wall move rejects collapsed neighbor or stranded openings atomically', () => {
 const model = fixture(), before = structuredClone(model);
 assert.throws(() => pushPullDesignModel(model, {type: 'wall', id: 'front'}, -4000));
 model.elements.push({id: 'right-window', kind: 'window', host: 'right', offset: 2000, width: 1000, height: 1000, sill: 900});
 assert.throws(() => pushPullDesignModel(model, {type: 'wall', id: 'front'}, -1500));
 assert.deepEqual(model.elements.slice(0, -1), before.elements);
});

test('inverse push pull restores original model values for height and wall endpoint movement', () => {
 const model = fixture();
 for (const target of [{type: 'story', id: 's1'}, {type: 'wall', id: 'front'}]) assert.deepEqual(pushPullDesignModel(pushPullDesignModel(model, target, 300), target, -300), model);
});


test('only slab and mass tops that move with storey height can be selected', () => {
 const model = fixture();model.elements.push(
  {id: 'fixed-slab', kind: 'slab', story: 's1', outline, topOffset: 500, thickness: 100},
  {id: 'fixed-mass', kind: 'mass', story: 's1', outline, height: 1200},
  {id: 'upper-room', kind: 'space', story: 's2', outline},
  {id: 'own-roof', kind: 'slab', story: 's1', role: 'roof', outline, topOffset: 3000, thickness: 200});
 const built = buildDesignModel3D(model), mesh = id => built.group.children.find(m => m.name === id);
 for (const id of ['floor1', 'room', 'fixed-slab', 'fixed-mass']) assert.equal(mesh(id).userData.pushPull, undefined, id);
 assert.equal(mesh('upper-room').userData.pushPull.target.id, 's1');assert.equal(mesh('own-roof').userData.pushPull.target.id, 's1');dispose(built);
});

test('connected diagonal wall rotates explicit outward normal while preserving its side', () => {
 for (const props of [false, true]) {
  const model = fixture();model.elements = [
   {id: 'front', kind: 'wall', story: 's1', path: [[0, 0], [4000, 0]], thickness: 200, exterior: true, outwardNormal: [0, -1]},
   {id: 'diagonal', kind: 'wall', story: 's1', path: [[4000, 0], [6000, 2000]], thickness: 200, exterior: true,
    ...(props ? {props: {outwardNormal: {x: Math.SQRT1_2, y: -Math.SQRT1_2}, keep: true}} : {outwardNormal: [Math.SQRT1_2, -Math.SQRT1_2]})}];
  const before = structuredClone(model), edited = pushPullDesignModel(model, {type: 'wall', id: 'front'}, 1000), diagonal = edited.elements[1];
  assert.deepEqual(diagonal.path, [[4000, -1000], [6000, 2000]]);
  const normal = diagonal.outwardNormal || diagonal.props.outwardNormal, nx = normal.x ?? normal[0], ny = normal.y ?? normal[1];
  close(nx * 2000 + ny * 3000, 0);assert.ok(nx > 0 && ny < 0);close(Math.hypot(nx, ny), 1);
  const built = buildDesignModel3D(edited);assert.equal(built.wallCount, 2);dispose(built);assert.deepEqual(model, before);
 }
});

test('storey-driven stair rise and surface tops follow height even without an explicit stair height', () => {
 const model = fixture(), stair = model.elements.find(e => e.id === 'stair');
 stair.rise = 150;stair.risers = 20;stair.treads = [{top: 150, outline}];stair.landings = [{top: 1500, outline}];
 const edited = pushPullDesignModel(model, {type: 'story', id: 's1'}, 300), changed = edited.elements.find(e => e.id === 'stair');
 close(changed.rise, 165);close(changed.treads[0].top, 165);close(changed.landings[0].top, 1650);assert.equal(changed.height, undefined);assert.equal(stair.rise, 150);
});
