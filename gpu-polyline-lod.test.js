import test from 'node:test';
import assert from 'node:assert/strict';
import {canSimplifyGpuPolyline,simplifyGpuPolyline,gpuPolylineBounds} from './gpu-polyline-lod.js';
import {compileGpuScene} from './gpu-scene.js';
import {CadGpuRenderer} from './gpu-renderer.js';
import {THREE} from './vendor/mlightcad.js';
const points=()=>Array.from({length:2000},(_,i)=>({x:i/20,y:10*Math.sin(i/150)}));
const poly=()=>({id:'p',type:'polyline',layer:'0',points:points()});
const drawing=entities=>({entities,layers:[{id:'0',name:'0',visible:true,color:'#fff',linetype:'CONTINUOUS'}]});
const distance=(p,a,b)=>{const dx=b.x-a.x,dy=b.y-a.y,l=dx*dx+dy*dy,t=l?Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/l)):0;return Math.hypot(p.x-a.x-t*dx,p.y-a.y-t*dy);};
function renderer(){
 const r=Object.create(CadGpuRenderer.prototype);
 Object.assign(r,{scene:new THREE.Scene(),stats:{builds:0,frames:0},renderer:{subEntityTraits:{},lineSegments(values,size,indices){const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.BufferAttribute(values,size));geometry.setIndex(new THREE.BufferAttribute(indices,1));const group=new THREE.Group();group.add(new THREE.LineSegments(geometry,new THREE.LineBasicMaterial()));return group;}}});return r;
}
const segmentCount=r=>[...r.lineBatches.values()].reduce((n,b)=>n+b.records.reduce((sum,e)=>sum+e.points.length/6,0),0);
test('display LOD retains endpoints, source data and bounded error at every DPR',()=>{
 const p=points(),before=structuredClone(p);
 for(const dpr of [1,1.25,1.5,2,2.5]){
  const q=simplifyGpuPolyline(p,2*dpr);assert.ok(q.length<p.length/10);assert.equal(q[0],p[0]);assert.equal(q.at(-1),p.at(-1));
  let j=1;for(const point of p){while(j<q.length-1&&point.x>q[j].x)j++;assert.ok(distance(point,q[j-1],q[j])*2*dpr<=.25000001);}
 }
 assert.deepEqual(p,before);
});
test('closed, dashed, clipped, wide and bulged polylines remain exact',()=>{
 const e=poly();assert.equal(canSimplifyGpuPolyline(e),true);
 for(const [entity,style,clips]of [[{...e,closed:true},{},[]],[e,{linetype:'DASHED'},[]],[e,{},[{points:[]}]], [{...e,constantWidth:2},{},[]],[{...e,points:e.points.map((p,i)=>({...p,bulge:i===20?.4:0}))},{},[]]])assert.equal(canSimplifyGpuPolyline(entity,style,clips),false);
 const closed=compileGpuScene([{...e,closed:true}],{scale:.1}).items[0];assert.equal(closed.points.length,e.points.length);assert.equal(closed.lodPoints,undefined);
});
test('compiler stores rebased exact display source separately and resolves parent linetype',()=>{
 const e=poly(),before=structuredClone(e),a=compileGpuScene([e],{scale:1,origin:{x:10000000,y:2}}).items[0];
 assert.equal(a.lodPoints.length,e.points.length);assert.ok(a.points.length<e.points.length);assert.equal(a.lodPoints[0].x,-10000000);assert.deepEqual(e,before);
 const block=compileGpuScene([{id:'b',type:'block',linetype:'DASHED',entities:[e]}]).items[0];assert.equal(block.lodPoints,undefined);assert.equal(block.points.length,e.points.length);
});
test('zoom refinement restores screen precision and zoom-out releases fine geometry',()=>{
 const r=renderer(),doc=drawing([poly()]);r.setDocument(doc,1,.01);const initial=segmentCount(r),b={minX:-1000,minY:-1000,maxX:1000,maxY:1000};
 r.refineViewport(b,100,2.5);const fine=segmentCount(r);assert.ok(fine>initial*5);
 r.refineViewport(b,.01,2.5);assert.ok(segmentCount(r)<fine/5);assert.equal(r.stats.builds,1);assert.deepEqual(doc.entities[0].points,points());
});
test('same-quality PAN skips detail search but newly exposed under-detailed curves refine',()=>{
 const r=renderer(),a=poly(),b={...poly(),id:'q',points:points().map(p=>({x:p.x+10000,y:p.y}))};r.setDocument(drawing([a,b]),1,.01);
 r.refineViewport({minX:-1e6,minY:-1e6,maxX:1e6,maxY:1e6},.01);assert.equal(r.stats.detailCandidates,0);assert.ok(r.stats.detailQuerySkips>0);
 const left={minX:-r.shift.x-1,minY:-100,maxX:101-r.shift.x,maxY:100};r.refineViewport(left,100);assert.equal(r.stats.refinedCurves,1);
 r.refineViewport({...left,minX:left.minX+10000,maxX:left.maxX+10000},100);assert.equal(r.stats.refinedCurves,1);
});
test('MOVE then zoom uses translated exact LOD points and ERASE clears quality tracking',()=>{
 const r=renderer(),p=poly(),doc=drawing([p]);r.setDocument(doc,1,.01);const old=structuredClone(p),shift={x:r.shift.x,y:r.shift.y};
 const moved={...p,points:p.points.map(q=>({x:q.x+123,y:q.y-47}))},next={...doc,entities:[moved]};
 r.setDocument(next,2,.01,{previousDoc:doc,previousRevision:1,lightweight:true,removed:[p],added:[moved]});
 const detail=[...r.details.values()][0];assert.equal(detail.item.lodPoints[0].x,p.points[0].x-shift.x+123);assert.equal(detail.item.lodPoints[0].y,p.points[0].y-shift.y-47);
 r.refineViewport({minX:-1e5,minY:-1e5,maxX:1e5,maxY:1e5},100);assert.ok(segmentCount(r)>100);assert.deepEqual(p,old);
 const erased={...next,entities:[]};r.setDocument(erased,3,100,{previousDoc:next,previousRevision:2,lightweight:true,removed:[moved],added:[]});
 assert.equal(r.details.size,0);assert.equal(r.detailQualityScales.size,0);assert.equal(r.polylineDetailScales.size,0);
 r.setDocument(next,4,100,{previousDoc:erased,previousRevision:3,lightweight:true,removed:[],added:[moved]});
 assert.equal(r.details.size,1);assert.ok(segmentCount(r)>100);assert.deepEqual([...r.details.values()][0].item.lodPoints[0],{x:moved.points[0].x-shift.x,y:moved.points[0].y-shift.y});
});
test('adversarial input has bounded work and conservative full bounds',()=>{
 const p=Array.from({length:20000},(_,i)=>({x:i,y:i%2?100:0}));const out=simplifyGpuPolyline(p,100);assert.equal(out,p);assert.deepEqual(gpuPolylineBounds(p),{minX:0,minY:0,maxX:19999,maxY:100});
});
test('bulk zoom-out restores initial batch budget instead of fragmenting into 512-segment leaves',()=>{
 const r=renderer(),entities=Array.from({length:100},(_,i)=>({...poly(),id:'p'+i,points:points().map(p=>({x:p.x+i*120,y:p.y}))}));
 r.setDocument(drawing(entities),1,10);const initial={segments:segmentCount(r),batches:r.lineBatches.size},box={minX:-1e6,minY:-1e6,maxX:1e6,maxY:1e6};
 r.refineViewport(box,100);assert.ok(segmentCount(r)>initial.segments);
 r.refineViewport(box,10);assert.equal(segmentCount(r),initial.segments);assert.equal(r.lineBatches.size,initial.batches);
});
