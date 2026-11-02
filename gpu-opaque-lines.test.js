import test from 'node:test';
import assert from 'node:assert/strict';
import {THREE} from './vendor/mlightcad.js';
import {opaqueLineEligible,OpaqueLineBatch,OpaqueMergedLineBatch} from './gpu-opaque-lines.js';

function line({count=2,index=false,material,object='segments'}={}){const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(Array.from({length:count*3},(_,i)=>i),3));if(index)g.setIndex(new THREE.BufferAttribute(Uint16Array.from({length:count},(_,i)=>i),1));const m=material||new THREE.LineBasicMaterial();const o=object==='mesh'?new THREE.Mesh(g,m):object==='line'?new THREE.Line(g,m):new THREE.LineSegments(g,m);return {g,m,o};}
test('eligibility rejects odd GL_LINES counts and preserves indexed counts',()=>{assert.equal(opaqueLineEligible(line({count:3}).o),false);const x=line({count:4,index:true});assert.equal(opaqueLineEligible(x.o),true);assert.equal(x.o.geometry.index.count,4);});
test('eligibility rejects clipping, custom hooks, wrong object types and batched meshes',()=>{const clipped=line();clipped.o.userData.barunClipMasks=[{}];assert.equal(opaqueLineEligible(clipped.o),false);const hooked=line();hooked.o.onBeforeRender=()=>{};assert.equal(opaqueLineEligible(hooked.o),false);assert.equal(opaqueLineEligible(line({object:'mesh'}).o),false);assert.equal(opaqueLineEligible(line({object:'line'}).o),false);const batched=line();batched.o.isBatchedMesh=true;assert.equal(opaqueLineEligible(batched.o),false);});
test('different materials are incompatible and dispose does not dispose originals',()=>{const a=line(),b=line();assert.throws(()=>new OpaqueLineBatch([{object:a.o},{object:b.o}]),/incompatible/);const material=a.m,geometry=a.g,events=[];material.addEventListener('dispose',()=>events.push('material'));geometry.addEventListener('dispose',()=>events.push('geometry'));const c=line({material});const batch=new OpaqueLineBatch([{object:a.o,active:true},{object:c.o,active:false}]);batch.dispose();batch.dispose();assert.deepEqual(events,[]);assert.equal(batch.disposed,true);});

test('native line ranges preserve indices and exclude inactive instances',()=>{
 const material=new THREE.LineBasicMaterial(),a=line({count:4,index:true,material}),b=line({count:2,material});
 a.g.index.array.set([3,2,1,0]);
 const records=[{object:a.o,active:true},{object:b.o,active:false}],batch=new OpaqueLineBatch(records),camera=new THREE.OrthographicCamera();
 try{
  assert.equal(batch.isMesh,false);assert.equal(batch.isLine,true);assert.equal(batch.isLineSegments,true);assert.equal(batch.isBatchedMesh,true);
  assert.deepEqual(Array.from(batch.geometry.index.array),[3,2,1,0,4,5]);
  const prepare=()=>batch.onBeforeRender({},new THREE.Scene(),camera,batch.geometry,batch.material,null);
  prepare();assert.equal(batch._multiDrawCount,1);assert.equal(batch._multiDrawCounts[0],4);assert.equal(batch._indirectTexture.image.data[0],0);
  records[0].active=false;records[1].active=true;prepare();assert.equal(batch._multiDrawCount,1);assert.equal(batch._multiDrawCounts[0],2);assert.equal(batch._indirectTexture.image.data[0],1);
  records[1].active=false;prepare();assert.equal(batch._multiDrawCount,0);
  records[0].active=true;records[1].active=true;prepare();assert.equal(batch._multiDrawCount,2);assert.deepEqual(Array.from(batch._multiDrawCounts).slice(0,2),[4,2]);
 }finally{batch.dispose();}
});

test('matrix upload is the original CPU model-view rounded once to Float32',()=>{
 const material=new THREE.LineBasicMaterial(),a=line({material}),b=line({material}),camera=new THREE.OrthographicCamera();
 a.o.position.set(50621477.21706608,-5647102.489609634,.001);a.o.scale.set(1.125,.75,1);a.o.updateMatrixWorld(true);
 camera.position.set(50621400.0123456,-5647000.1234567,100);camera.updateMatrixWorld(true);
 const batch=new OpaqueLineBatch([{object:a.o,active:true},{object:b.o,active:false}]);
 try{
  batch.onBeforeRender({},new THREE.Scene(),camera,batch.geometry,batch.material,null);
  const expected=new Float32Array(new THREE.Matrix4().multiplyMatrices(camera.matrixWorldInverse,a.o.matrixWorld).elements),actual=batch.getMatrixAt(batch.instanceSlots[0],new THREE.Matrix4());
  assert.deepEqual(actual.elements,Array.from(expected));
 }finally{batch.dispose();}
});

test('merged indices submit active sources in original order and upload only changed membership',()=>{
 const material=new THREE.LineBasicMaterial(),a=line({count:4,index:true,material}),b=line({count:2,material});a.g.index.array.set([3,2,1,0]);
 const records=[{object:a.o,active:true},{object:b.o,active:false}],batch=new OpaqueMergedLineBatch(records);
 try{
  assert.equal(batch.geometry.drawRange.count,4);assert.deepEqual(Array.from(batch.geometry.index.array).slice(0,4),[3,2,1,0]);
  const version=batch.geometry.index.version;assert.equal(batch.updateVisibility(),false);assert.equal(batch.geometry.index.version,version);
  records[0].active=false;records[1].active=true;assert.equal(batch.updateVisibility(),true);assert.equal(batch.geometry.drawRange.count,2);assert.deepEqual(Array.from(batch.geometry.index.array).slice(0,2),[4,5]);
  assert.deepEqual(batch.geometry.index.updateRanges,[{start:0,count:2}]);
  records[1].active=false;batch.updateVisibility();assert.equal(batch.geometry.drawRange.count,0);
  records[0].active=true;records[1].active=true;batch.updateVisibility();assert.equal(batch.geometry.drawRange.count,6);assert.deepEqual(Array.from(batch.geometry.index.array),[3,2,1,0,4,5]);
 }finally{batch.dispose();}
});

test('merged matrix texture matches CPU model-view and disposal preserves source resources',()=>{
 const material=new THREE.LineBasicMaterial(),a=line({material}),b=line({material}),camera=new THREE.OrthographicCamera(),disposed=[];
 a.o.position.set(50621477.21706608,-5647102.489609634,.001);a.o.updateMatrixWorld(true);camera.position.set(50621400.0123456,-5647000.1234567,100);camera.updateMatrixWorld(true);
 for(const resource of [material,a.g,b.g])resource.addEventListener('dispose',()=>disposed.push(resource));
 const batch=new OpaqueMergedLineBatch([{object:a.o,active:true},{object:b.o,active:false}]);
 batch.onBeforeRender({},new THREE.Scene(),camera);
 const expected=new Float32Array(new THREE.Matrix4().multiplyMatrices(camera.matrixWorldInverse,a.o.matrixWorld).elements);
 assert.deepEqual(batch.matrixData.slice(0,16),expected);
 batch.dispose();batch.dispose();assert.deepEqual(disposed,[]);
});
