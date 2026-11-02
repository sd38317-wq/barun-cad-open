import test from 'node:test';
import assert from 'node:assert/strict';
import { compileGpuScene, gpuCurveSegments, gpuCurveNextScale } from './gpu-scene.js';

test('arc sweep and circle tessellation respect screen tolerance', () => {
  const { items } = compileGpuScene([{ id: 'a', type: 'arc', center: { x: 0, y: 0 }, radius: 100, startAngle: 0, endAngle: 90 }], { scale: 10 });
  assert.equal(items[0].type, 'polyline'); assert.equal(items[0].closed, false); assert.ok(items[0].points.length > 2);
  const circle = compileGpuScene([{ id: 'c', type: 'circle', center: { x: 0, y: 0 }, radius: 100 }], { scale: 1 });
  assert.ok(circle.items[0].points.length < 200, 'circle tessellation remains bounded');
  const zero = compileGpuScene([{ id: 'z', type: 'arc', center: { x: 0, y: 0 }, radius: 100, startAngle: 20, endAngle: 20 }]);
  assert.equal(zero.items[0].points[0].x, zero.items[0].points.at(-1).x);
});

test('huge curves cap their segment count and degenerate clips skip only their object instead of throwing', () => {
  const big = compileGpuScene([{ id: 'c', type: 'circle', center: { x: 0, y: 0 }, radius: 1e9 }, { id: 'e', type: 'ellipse', center: { x: 0, y: 0 }, majorAxis: { x: 1e9, y: 0 }, ratio: 0.5 }], { scale: 1e6 });
  assert.equal(big.items.length, 2);
  assert.ok(big.items.every(item => item.points.length <= 16385));
  const line = { id: 'l', type: 'line', points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] };
  const clip = points => ({ id: 'b', type: 'block', entities: [line], clip: { enabled: true, points } });
  const bad = compileGpuScene([clip([{ x: 0, y: 0 }, { x: 1, y: 0 }]), { id: 'u', type: 'mystery' }, line]);
  assert.equal(bad.items.length, 1); assert.deepEqual(bad.unsupported.map(x => x.reason).sort(), ['invalid clip', 'unknown']);
  const many = Array.from({ length: 9000 }, (_, i) => ({ x: Math.cos(i / 9000 * 6.28) * 10, y: Math.sin(i / 9000 * 6.28) * 10 }));
  const long = compileGpuScene([clip(many)]);
  assert.equal(long.unsupported.length, 0); assert.equal(long.items[0].clipMasks[0].points.length, 4);
});

test('curve segment count and next-scale stop at the tessellation cap so extreme zoom settles', () => {
  const circle = { type: 'circle', center: { x: 0, y: 0 }, radius: 1e9 };
  assert.equal(gpuCurveSegments(circle, 1e6), 16384);
  assert.equal(gpuCurveNextScale(circle, 16384), Infinity);
  const ellipse = { type: 'ellipse', center: { x: 0, y: 0 }, majorAxis: { x: 1e9, y: 0 }, ratio: 0.5 };
  assert.equal(gpuCurveSegments(ellipse, 1e6), 16384);
  assert.ok(Number.isFinite(gpuCurveNextScale({ type: 'circle', center: { x: 0, y: 0 }, radius: 100 }, 64)));
});
test('nested block keeps top-level selection id and resolved style', () => {
  const { items } = compileGpuScene([{ id: 'b', type: 'block', layer: '0', entities: [{ type: 'line', points: [{ x: 1, y: 2 }, { x: 3, y: 4 }], _displayColor: '#abc' }] }]);
  assert.equal(items[0].sourceId, 'b'); assert.equal(items[0].color, '#abc');
});
test('dimension primitive keeps its own resolved style over block style', () => {
  const { items } = compileGpuScene([{ id: 'b', type: 'block', _displayColor: 'blue', entities: [{ type: 'dimension', mode: 'horizontal', points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 2 }], _displayColor: 'red', _displayLinetype: 'DASHED', _displayLinetypeScale: 0.5 }] }]);
  assert.equal(items[0].color, 'red'); assert.equal(items[0].linetype, 'DASHED'); assert.equal(items[0].linetypeScale, 0.5);
});
test('unknown entities and malformed clip masks are reported', () => {
  const { unsupported } = compileGpuScene([{ id: 'u', type: 'spline' }, { id: 'c', type: 'block', clip: { enabled: true }, entities: [] }]);
  assert.deepEqual(unsupported.map(x => x.reason), ['unknown', 'invalid clip']);
});
test('resolved block visibility never restores hidden children',()=>{
  const visible={type:'line',points:[{x:0,y:0},{x:1,y:1}]};
  const hidden={type:'line',points:[{x:2,y:2},{x:3,y:3}]};
  const result=compileGpuScene([{id:'b',type:'block',entities:[visible,hidden],_visibleEntities:[visible]}]);
  assert.equal(result.items.length,1);
});
test('coordinates stay as JS numbers until renderer upload', () => {
  const { items } = compileGpuScene([{ id: 'l', type: 'line', points: [{ x: 16777217, y: 1 }, { x: 16777219, y: 2 }] }]);
  assert.equal(items[0].points[0].x, 16777217);
});


test('nested XCLIP masks preserve all geometry kinds, inversion, precision and source identity',()=>{
 const rect=(x,y,w,h)=>[{x,y},{x:x+w,y},{x:x+w,y:y+h},{x,y:y+h}];
 const outer={enabled:true,points:rect(10000001,10,20,20)};
 const inner={enabled:true,inverted:true,points:rect(10000005,15,5,5)};
 const entities=[{id:'root',type:'block',clip:outer,entities:[{type:'block',clip:inner,entities:[
 {type:'line',points:[{x:10000000,y:18},{x:10000030,y:18}]},
 {type:'text',position:{x:10000002,y:12},height:2,text:'Clip'},
 {type:'hatch',points:rect(10000000,0,40,40),solid:true},
 {type:'circle',center:{x:10000011,y:20},radius:20}
 ]}]}];
 const before=structuredClone(entities);
 const result=compileGpuScene(entities,{origin:{x:10000000,y:0}});
 assert.equal(result.unsupported.length,0);assert.equal(result.items.length,4);
 for(const item of result.items){assert.equal(item.sourceId,'root');assert.equal(item.clipMasks.length,2);assert.equal(item.clipMasks[1].inverted,true);assert.equal(item.clipMasks[0].points[0].x,1);assert.ok(item.clipKey);}
 assert.deepEqual(entities,before,'renderer must never rewrite source clipping/geometry');
});

test('zero-length LINE compiles as a point while preserving source id at every scale',()=>{
 for(const scale of [.25,1,4,32]){
  const result=compileGpuScene([{id:'zero',type:'line',points:[{x:7,y:9},{x:7,y:9}]}],{scale});
  assert.equal(result.unsupported.length,0);assert.equal(result.items.length,1);
  assert.equal(result.items[0].type,'point');assert.equal(result.items[0].sourceId,'zero');
  assert.deepEqual(result.items[0].position,{x:7,y:9});
 }
});
