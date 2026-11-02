import test from 'node:test';
import assert from 'node:assert/strict';
import * as G from './geometry.js';
import {drawEntity} from './view.js';
import {compileGpuScene} from './gpu-scene.js';
import { applyDimStyle, createDimStyle, deleteDimStyle, getDimStyle, normalizeDimStyles, setCurrentDimStyle, updateDimStyle } from './dimension-style.js';

test('normalizes missing style data to STANDARD', () => {
  const result = normalizeDimStyles({ entities: [] });
  assert.equal(result.currentDimStyle, 'STANDARD');
  assert.equal(result.dimStyles.STANDARD.textHeight, 150);
});

test('creates, updates, selects and deletes styles without mutating document', () => {
  const source = { entities: [], dimStyles: { STANDARD: { textHeight: 3 } } };
  const created = createDimStyle(source, 'ARCH', { precision: 0, arrowSize: 3 });
  assert.equal(source.dimStyles.ARCH, undefined);
  const updated = updateDimStyle(created, 'ARCH', { textHeight: 4 });
  const selected = setCurrentDimStyle(updated, 'ARCH');
  assert.equal(getDimStyle(selected).textHeight, 4);
  const deleted = deleteDimStyle(selected, 'ARCH');
  assert.equal(deleted.currentDimStyle, 'STANDARD');
  assert.throws(() => deleteDimStyle(deleted, 'STANDARD'), /cannot be deleted/);
});

test('applies style defaults while preserving explicit dimension overrides', () => {
  const dimension = { type: 'dimension', textHeight: 10 };
  const result = applyDimStyle(dimension, { name: 'ARCH', precision: 0, arrowSize: 4 });
  assert.equal(result.textHeight, 10);
  assert.equal(result.precision, 0);
  assert.equal(result.arrowSize, 4);
  assert.equal(result.dimStyle, 'ARCH');
  assert.equal(dimension.arrowSize, undefined);
  const overwritten = applyDimStyle(dimension, { name: 'ARCH', textHeight: 2 }, { overwrite: true });
  assert.equal(overwritten.textHeight, 2);
});

test('rejects invalid names and numeric values', () => {
  assert.throws(() => createDimStyle({}, '', {}), /non-empty/);
  assert.throws(() => createDimStyle({}, 'BAD', { precision: -1 }), /non-negative/);
  assert.throws(() => setCurrentDimStyle({}, 'NOPE'), /Unknown/);
});

test('dimension style lengths scale with a transformed dimension', () => {
  const source={type:'dimension',mode:'horizontal',points:[{x:0,y:0},{x:1000,y:0},{x:0,y:300}],textHeight:150,arrowSize:120,extensionOffset:40,extensionOvershoot:60,textGap:30};
  const scaled=G.resize(source,{x:0,y:0},2);
  assert.equal(scaled.textHeight,300);assert.equal(scaled.arrowSize,240);assert.equal(scaled.extensionOffset,80);assert.equal(scaled.extensionOvershoot,120);assert.equal(scaled.textGap,60);
});

test('dimensions with style scale retain text, arrows and lines in Canvas and GPU draw lists',()=>{
 for(const mode of ['horizontal','vertical','aligned','radius','diameter','angular']){
  const points=mode==='angular'?[{x:0,y:0},{x:1000,y:0},{x:0,y:1000},{x:500,y:500}]:[{x:0,y:0},{x:1000,y:800},{x:1800,y:1200}];
  const dim=applyDimStyle({type:'dimension',mode,points},{name:'PAPER',textHeight:2.5,arrowSize:1.25,scale:100});
  const parts=G.dimensionParts(dim);assert.equal(parts.find(p=>p.dimensionLabel).height,250);assert.equal(parts.filter(p=>p.type==='hatch').length,mode==='radius'?1:2);
  const calls=[],ctx=new Proxy({},{get:(o,k)=>o[k]??((...args)=>calls.push([k,...args])),set:(o,k,v)=>(o[k]=v,true)});
  drawEntity(ctx,dim,p=>({x:p.x*.1,y:-p.y*.1}),.1,'#9dcbe0');assert.ok(calls.some(c=>c[0]==='stroke'));assert.ok(calls.some(c=>c[0]==='fillText'));assert.ok(calls.some(c=>c[0]==='fill'));
  const scene=compileGpuScene([{...dim,id:'dim',color:'#9dcbe0'}]);assert.equal(scene.unsupported.length,0);assert.ok(scene.items.some(i=>i.kind==='text'||i.type==='text'),JSON.stringify(scene.items.map(i=>Object.keys(i))));assert.ok(scene.items.length>=4);
 }
});
test('diameter draws across the full circle and radial labels follow placement',()=>{
 const dim={type:'dimension',mode:'diameter',points:[{x:0,y:0},{x:500,y:0},{x:900,y:0}],textHeight:20,arrowType:'closed-filled'};
 const parts=G.dimensionParts(dim);assert.deepEqual(parts[0].points,[{x:-500,y:0},{x:500,y:0}]);assert.equal(parts.find(p=>p.dimensionLabel).text,'Ø 1000');assert.equal(parts.find(p=>p.dimensionLabel).position.x,900);
 const radial=G.dimensionParts({...dim,mode:'radius'});assert.equal(radial.find(p=>p.dimensionLabel).text,'R 500');assert.equal(radial.filter(p=>p.type==='hatch').length,1);
});

test('explicit dimension text angle follows rotation and reflection without changing its size',()=>{
 const dim=applyDimStyle({type:'dimension',mode:'horizontal',textRotation:30,points:[{x:0,y:0},{x:1000,y:0},{x:0,y:300}]},{name:'STANDARD'});
 assert.ok(Math.abs(G.rotate(dim,{x:0,y:0},90).textRotation-120)<1e-6);
 const reflected=G.mirror(dim,{x:0,y:0},{x:100,y:100});assert.ok(Math.abs(reflected.textRotation-60)<1e-6);assert.equal(reflected.textHeight,dim.textHeight);
});
