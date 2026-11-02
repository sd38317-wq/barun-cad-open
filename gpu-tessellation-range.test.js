// ACAD200 114·115: VIEWRES 허용치와 곡선 분할의 축소 쪽 범위.
import test from 'node:test';
import assert from 'node:assert/strict';
import {needsCoarserCurve,curvePixelTolerance,toleranceScale} from './gpu-tessellation-range.js';
import {gpuCurveSegments} from './gpu-scene.js';
import {CadGpuRenderer} from './gpu-renderer.js';
import {THREE} from './vendor/mlightcad.js';

const circle={type:'circle',center:{x:0,y:0},radius:1000};
function renderer(){
  const r=Object.create(CadGpuRenderer.prototype);
  Object.assign(r,{scene:new THREE.Scene(),stats:{builds:0,frames:0},renderer:{subEntityTraits:{},lineSegments(values,size,indices){
    const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.BufferAttribute(values,size));g.setIndex(new THREE.BufferAttribute(indices,1));
    const child=new THREE.LineSegments(g,new THREE.LineBasicMaterial());const group=new THREE.Group();group.add(child);return group;
  }}});
  return r;
}
const doc=(entities,extra={})=>({layers:[{id:'0',name:'0',visible:true,color:'#ffffff',lineweight:.25}],entities,blocks:[],linetypeScale:1,...extra});
const box={minX:-2000,maxX:2000,minY:-2000,maxY:2000};

test('114: VIEWRES 1000 keeps the 0.25 px tolerance; lower VIEWRES and pressure coarsen it',()=>{
  assert.equal(curvePixelTolerance(1000),.25);assert.equal(curvePixelTolerance(),.25);assert.equal(curvePixelTolerance(100),2.5);
  assert.equal(curvePixelTolerance(1000,1),1,'full pressure: 4x');assert.equal(curvePixelTolerance('x'),.25);
  assert.equal(toleranceScale(8,.25),8);assert.equal(toleranceScale(8,2.5),.8);
  assert.ok(gpuCurveSegments(circle,toleranceScale(1,curvePixelTolerance(100)))<gpuCurveSegments(circle,1));
});

test('114: a drawing with VIEWRES 100 builds coarser curves than the default',()=>{
  const fine=renderer();fine.setDocument(doc([{id:'c',...circle,layer:'0'}]),1,1);
  const coarse=renderer();coarse.setDocument(doc([{id:'c',...circle,layer:'0'}],{viewres:100}),1,1);
  const count=r=>[...r.lineBatches.values()].flatMap(b=>b.records).reduce((n,x)=>n+x.points.length/6,0);
  assert.ok(count(coarse)<count(fine),`${count(coarse)} < ${count(fine)}`);assert.equal(fine.viewresFactor,1);
});

test('115: a curve split for a deep zoom is coarsened when zoomed far out',()=>{
  const detail={item:{curve:circle},builtScale:64,scale:64};
  assert.equal(needsCoarserCurve(detail,32),false,'inside the range: nothing to do');
  assert.equal(needsCoarserCurve(detail,1),true,'1/64 of the built scale');
  assert.equal(needsCoarserCurve({item:{curve:{...circle,radius:.001}},builtScale:64},1),false,'few segments: not worth it');
  const r=renderer();r.setDocument(doc([{id:'c',...circle,layer:'0'}]),1,.001);
  r.refineViewport(box,4,1);   // deep zoom refines the circle finely
  const segments=()=>[...r.lineBatches.values()].flatMap(b=>b.records).reduce((n,x)=>n+x.points.length/6,0);
  const fine=segments();assert.ok(r.curveBuiltScales.size>0);
  r.refineViewport(box,.004,1);   // far out: the vertices come back
  assert.ok(segments()<fine/4,`${segments()} < ${fine}/4`);
  r.refineViewport(box,.004,1);assert.equal(r.stats.detailQuerySkips>0,true,'then the range check skips the query');
});

test('124: near the GPU memory budget a zoom does not refine curves finer',()=>{
  const r=renderer();r.setDocument(doc([{id:'c',...circle,layer:'0'}]),1,.001);
  const segments=()=>[...r.lineBatches.values()].flatMap(b=>b.records).reduce((n,x)=>n+x.points.length/6,0),coarse=segments();
  r.memory.budget=1;   // every byte counts as pressure 1
  assert.equal(r.memory.pressure,1);r.refineViewport(box,4,1);assert.equal(segments(),coarse,'no finer split');
  r.memory.budget=1e12;r.refineViewport(box,4.5,1);assert.ok(segments()>coarse,'with room again it refines');
});
