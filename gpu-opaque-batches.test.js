import test from 'node:test';
import assert from 'node:assert/strict';
import {THREE} from './vendor/mlightcad.js';
import {OpaqueBatchRegistry} from './gpu-opaque-batches.js';

function fixture(){
 const scene=new THREE.Scene(),camera=new THREE.OrthographicCamera(-100,100,100,-100,.1,100);camera.position.z=10;camera.updateMatrixWorld();
 const cad={scene,camera,spatialObjects:new Map(),clipMaterials:new WeakMap(),gl:{sortObjects:true,setOpaqueSort(fn){this.comparator=fn;}}};
 const registry=new OpaqueBatchRegistry(cad);return {cad,registry};
}
function line(cad,material,x=0){
 const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute([0,0,0,1,1,0,2,0,0,3,1,0],3));g.setIndex([3,2,1,0]);
 const o=new THREE.LineSegments(g,material);o.position.x=x;o.frustumCulled=false;cad.scene.add(o);cad.spatialObjects.set(o,{});return o;
}
test('retained visibility submits only active source index ranges before draw',()=>{
 const {cad,registry}=fixture(),m=new THREE.LineBasicMaterial(),a=line(cad,m),b=line(cad,m,20);
 assert.equal(registry.sync({retainedToken:[1]}),true);const batch=registry.batches[0];assert.equal(registry.stats.savedSubmissions,1);
 assert.deepEqual(Array.from(batch.geometry.index.array),[3,2,1,0,7,6,5,4]);assert.equal(batch.geometry.drawRange.count,8);
 registry.suspend();cad.scene.remove(a);registry.sync({retainedToken:[1]});assert.equal(registry.batches[0],batch);assert.equal(batch.geometry.drawRange.count,4);assert.deepEqual(Array.from(batch.geometry.index.array.slice(0,4)),[7,6,5,4]);
 registry.suspend();cad.scene.remove(b);registry.sync({retainedToken:[1]});assert.equal(registry.stats.active,false);assert.equal(batch.geometry.drawRange.count,0);assert.equal(batch.mesh.parent,null);assert.equal(cad.gl.comparator,null);
 cad.scene.add(a);a.position.x=50;a.updateWorldMatrix(true,true);registry.sync({retainedToken:[1]});batch.mesh.onBeforeRender(null,null,cad.camera);assert.equal(batch.data[12],50);assert.equal(batch.geometry.drawRange.count,4);
 registry.clear();assert.equal(a.visible,true);assert.equal(b.visible,true);assert.equal(cad.gl.comparator,null);
});
test('unknown draw states are ordering barriers and group layers match vendor inheritance',()=>{
 const {cad,registry}=fixture(),m=new THREE.LineBasicMaterial(),a=line(cad,m),barrier=line(cad,new THREE.LineBasicMaterial()),b=line(cad,m);
 a.renderOrder=0;barrier.renderOrder=1;b.renderOrder=2;registry.sync();assert.equal(registry.batches.length,0);
 const group=new THREE.Group();group.renderOrder=100;group.layers.set(1);cad.scene.add(group);group.add(a);b.renderOrder=0;barrier.renderOrder=0;
 const list=registry.collect();assert.equal(list.find(r=>r.object===a).groupOrder,0);
 group.layers.set(0);assert.equal(registry.collect().find(r=>r.object===a).groupOrder,100);
 group.visible=false;assert.equal(registry.collect().some(r=>r.object===a),false);registry.clear();
});
test('geometry changes rebuild affected cohort; batch disposal preserves source resources',()=>{
 const {cad,registry}=fixture(),m=new THREE.LineBasicMaterial(),a=line(cad,m),b=line(cad,m),events=[];
 m.addEventListener('dispose',()=>events.push('material'));a.geometry.addEventListener('dispose',()=>events.push('geometry'));
 registry.sync({retainedToken:[1]});const first=registry.batches[0];registry.suspend();a.geometry.attributes.position.array[0]=10;a.geometry.attributes.position.needsUpdate=true;
 registry.sync({retainedToken:[2]});assert.notEqual(registry.batches[0],first);assert.equal(first.disposed,true);assert.equal(registry.batches[0].geometry.attributes.position.array[0],10);
 assert.equal(first.baseIndices,null);assert.equal(first.data,null);assert.equal(first.geometry.index,null);assert.equal(first.geometry.attributes.position,undefined);assert.equal(first.matrices.image.data,null);
 registry.clear();assert.deepEqual(events,[]);assert.equal(a.visible,true);assert.equal(b.visible,true);
});
test('known clip asset shares a cohort without transferring resource ownership',()=>{
 const {cad,registry}=fixture(),base=new THREE.LineBasicMaterial(),texture=new THREE.DataTexture(new Float32Array(4),1,1),asset={texture},events=[];
 texture.addEventListener('dispose',()=>events.push('clip'));const make=()=>{const m=base.clone();m.onBeforeCompile=()=>{};cad.clipMaterials.set(m,{asset,baseMaterialId:base.id,baseDefault:true});return m;};
 const a=line(cad,make()),b=line(cad,make());a.userData.barunClipMasks=[{}];b.userData.barunClipMasks=[{}];
 registry.sync();assert.equal(registry.batches.length,1);registry.dispose();assert.deepEqual(events,[]);assert.equal(a.visible,true);assert.equal(b.visible,true);
});
test('parent drawable never hides an unmerged child and total allocation stays bounded',()=>{
 const {cad,registry}=fixture(),m=new THREE.LineBasicMaterial(),a=line(cad,m),b=line(cad,m);
 const child=new THREE.Points(new THREE.BufferGeometry().setAttribute('position',new THREE.Float32BufferAttribute([0,0,0],3)),new THREE.PointsMaterial());a.add(child);
 registry.sync();assert.equal(registry.batches.length,0);assert.equal(a.visible,true);assert.equal(child.visible,true);registry.clear();a.remove(child);
 const bounded=new OpaqueBatchRegistry(cad,{maxBytes:1});bounded.sync();assert.equal(bounded.batches.length,0);assert.ok(bounded.stats.budgetSkips>0);assert.equal(a.visible,true);assert.equal(b.visible,true);bounded.clear();
});
test('memory prioritizes many small draws over one expensive merge',()=>{
 const {cad}=fixture(),large=new THREE.LineBasicMaterial(),small=new THREE.LineBasicMaterial();
 for(let i=0;i<2;i++){const o=line(cad,large);o.geometry.setAttribute('position',new THREE.BufferAttribute(new Float32Array(3000),3));o.geometry.setIndex(new THREE.BufferAttribute(Uint32Array.from({length:1000},(_,i)=>i),1));}
 for(let i=0;i<40;i++)line(cad,small);
 const registry=new OpaqueBatchRegistry(cad,{maxBytes:100000});registry.sync();assert.equal(registry.batches.length,1);assert.equal(registry.batches[0].records.length,40);assert.equal(registry.stats.savedSubmissions,39);assert.ok(registry.stats.peakBytes<=100000);registry.clear();
});
test('a batch first entering the view remains unvalidated until actually drawn',()=>{
 const {cad,registry}=fixture(),m=new THREE.LineBasicMaterial(),a=line(cad,m),b=line(cad,m);
 cad.scene.remove(a);cad.scene.remove(b);registry.sync({retainedToken:[1]});assert.equal(registry.stats.pendingValidation,0);registry.validateActive();assert.equal(registry.batches[0].validated,false);
 cad.scene.add(a,b);registry.sync({retainedToken:[1]});assert.equal(registry.stats.pendingValidation,1);registry.validateActive();assert.equal(registry.batches[0].validated,true);registry.clear();
});
