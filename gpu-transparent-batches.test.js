import test from 'node:test';
import assert from 'node:assert/strict';
import {THREE} from './vendor/mlightcad.js';
import {TransparentBatchRegistry} from './gpu-transparent-batches.js';

function fixture(count=6,options={maxObjects:2}){
  const scene=new THREE.Scene(),camera=new THREE.OrthographicCamera(-10,10,10,-10,.1,100);
  camera.position.z=10;camera.updateMatrixWorld();
  const cad={scene,camera,gl:{sortObjects:true},sourceHatches:new Map(),textMeshes:[],spatialObjects:new Map()};
  const objects=[];
  function add(z,id=String(z)){
    const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute([0,0,0,1,0,0,0,1,0],3));
    const material=new THREE.MeshBasicMaterial({transparent:true,opacity:.22,depthWrite:false});
    const mesh=new THREE.Mesh(geometry,material);mesh.position.z=z;mesh.renderOrder=z*1e6;scene.add(mesh);objects.push(mesh);
    cad.sourceHatches.set(id,new Set([mesh]));cad.spatialObjects.set(mesh,{});return mesh;
  }
  for(let i=0;i<count;i++)add(i*.1);
  const registry=new TransparentBatchRegistry(cad,options);
  function remove(o){registry.suspend();scene.remove(o);cad.spatialObjects.delete(o);for(const [id,roots]of cad.sourceHatches)if(roots.has(o))cad.sourceHatches.delete(id);o.geometry.dispose();}
  return {cad,objects,registry,add,remove};
}

test('atlas-only clear retains stable depth scans but revalidates new meshes and mutations',()=>{
  const {cad,objects,registry:r,add}=fixture(2);
  assert.equal(r.sync({retainedToken:[1]}),true);
  const proof=r.stats.proofVertices;
  r.clear({preserveDepthCache:true});
  assert.equal(r.retained,null);assert.ok(objects.every(o=>o.visible));
  add(.2);
  assert.equal(r.sync({retainedToken:[1]}),true);
  assert.equal(r.stats.proofVertices-proof,3);
  r.clear({preserveDepthCache:true});
  objects[0].geometry.attributes.position.setZ(0,.5);
  objects[0].geometry.attributes.position.needsUpdate=true;
  assert.equal(r.sync(),false);assert.match(r.stats.reason,/nonplanar/);
  objects[0].geometry.attributes.position.setZ(0,0);
  objects[0].geometry.attributes.position.needsUpdate=true;
  assert.equal(r.sync(),true);
  r.clear({preserveDepthCache:true});objects[0].material.depthFunc=THREE.AlwaysDepth;
  assert.equal(r.sync(),false);assert.ok(objects.every(o=>o.visible));
  objects[0].material.depthFunc=THREE.LessEqualDepth;
  r.clear({preserveDepthCache:true});objects[0].position.z=.3;
  assert.equal(r.sync(),false);assert.match(r.stats.reason,/depth intervals/);
  objects[0].position.z=0;r.clear();
  const before=r.stats.proofVertices;assert.equal(r.sync(),true);
  assert.equal(r.stats.proofVertices-before,9);r.dispose();
});

test('retains original buffers, reuses all chunks and cached depth certificates on camera pan',()=>{
  const {cad,objects,registry:r}=fixture();assert.equal(r.sync(),true);assert.equal(r.batches.length,3);
  const chunks=[...r.batches],uploads=r.stats.verticesUploaded,proof=r.stats.proofVertices;
  for(const o of objects)assert.equal(o.visible,false);
  r.suspend();for(const o of objects)assert.equal(o.visible,true);
  cad.camera.left-=.3;cad.camera.right-=.3;cad.camera.updateProjectionMatrix();
  assert.equal(r.sync(),true);assert.deepEqual(r.batches,chunks);assert.equal(r.stats.verticesUploaded,uploads);assert.equal(r.stats.proofVertices,proof);
  r.dispose();
});

test('append, insertion and removal preserve unaffected contiguous chunks',()=>{
  const {registry:r,objects,add,remove}=fixture();r.sync();const old=[...r.batches];r.suspend();add(.7);add(.8);
  r.sync();assert.deepEqual(r.batches.slice(0,3),old);const appended=r.batches[3];
  r.suspend();add(-.1);r.sync();assert.ok(old.every(b=>r.batches.includes(b)));assert.ok(r.batches.includes(appended));
  remove(objects[0]);r.sync();assert.ok(r.batches.includes(old[1]));assert.ok(r.batches.includes(old[2]));assert.ok(r.batches.includes(appended));r.dispose();
});

test('geometry versions and attribute replacement rebuild only affected chunks',()=>{
  const {registry:r,objects}=fixture();r.sync();const old=[...r.batches];r.suspend();
  const p=objects[0].geometry.attributes.position;p.setX(0,.25);p.needsUpdate=true;r.sync();
  assert.notEqual(r.batches[0],old[0]);assert.equal(r.batches[1],old[1]);assert.equal(r.batches[2],old[2]);
  const first=r.batches[0];r.suspend();objects[4].geometry.setAttribute('position',new THREE.Float32BufferAttribute([0,0,0,2,0,0,0,2,0],3));r.sync();assert.equal(r.batches[0],first);assert.notEqual(r.batches[2],old[2]);r.dispose();
});

test('MOVE changes matrix texture without geometry upload; culled roots remain ordered and collapse',()=>{
  const {cad,registry:r,objects}=fixture(2);r.sync();const b=r.batches[0],uploads=r.stats.verticesUploaded,proof=r.stats.proofVertices;
  r.suspend();objects[0].position.x+=.375;cad.scene.remove(objects[1]);r.sync();
  assert.equal(r.batches[0],b);assert.equal(r.stats.verticesUploaded,uploads);assert.equal(r.stats.proofVertices,proof);
  b.drawMesh.onBeforeRender(null,null,cad.camera);assert.equal(b.matrixData[12],.375);assert.deepEqual([...b.matrixData.slice(16)],[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1]);
  r.suspend();cad.scene.add(objects[1]);r.sync();assert.equal(r.batches[0],b);b.drawMesh.onBeforeRender(null,null,cad.camera);assert.notEqual(b.matrixData[16],0);r.dispose();
});

test('mixed text/solid shader and resources keep original ownership through toggle and clear',()=>{
  const {cad,registry:r,objects}=fixture(1,{maxObjects:256});
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute([0,0,.2,1,0,.2,0,1,.2],3));g.setAttribute('uv',new THREE.Float32BufferAttribute([0,0,1,0,0,1],2));
  const texture=new THREE.Texture(),m=new THREE.MeshBasicMaterial({transparent:true,map:texture,alphaTest:.01,depthWrite:true,side:THREE.DoubleSide});m.forceSinglePass=true;
  const text=new THREE.Mesh(g,m);text.renderOrder=200000;cad.scene.add(text);cad.textMeshes.push({mesh:text});cad.spatialObjects.set(text,{});
  let disposed=0;for(const resource of [objects[0].geometry,objects[0].material,g,m,texture])resource.addEventListener('dispose',()=>disposed++);
  r.sync();assert.equal(r.batches.length,1);const b=r.batches[0],shader={uniforms:{},vertexShader:THREE.ShaderLib.basic.vertexShader,fragmentShader:THREE.ShaderLib.basic.fragmentShader};b.material.onBeforeCompile(shader);assert.match(shader.vertexShader,/originalModelView/);assert.match(shader.fragmentShader,/gl_FrontFacing/);
  r.enabled=false;r.sync();assert.equal(text.visible,true);assert.equal(objects[0].visible,true);assert.equal(b.mesh.parent,null);
  r.enabled=true;r.sync();assert.equal(r.batches[0],b);const builds=r.stats.builds;r.clear();assert.equal(disposed,0);assert.equal(r.stats.builds,builds);assert.equal(text.renderOrder,200000);assert.equal(r.batches.length,0);r.dispose();
});

test('interleaved position identity and layout changes invalidate cached depth proof',()=>{
  const {cad,registry:r}=fixture(1);r.sync();const proof=r.stats.proofVertices;
  r.suspend();
  const g=new THREE.BufferGeometry();const data=new THREE.InterleavedBuffer(new Float32Array([0,0,.5,9,1,0,.5,9,0,1,.5,9]),4);g.setAttribute('position',new THREE.InterleavedBufferAttribute(data,3,0,false));
  const m=new THREE.MeshBasicMaterial({transparent:true});const alien=new THREE.Mesh(g,m);alien.renderOrder=-1;alien.position.z=-1;cad.scene.add(alien);
  assert.equal(r.sync(),true);assert.ok(r.stats.proofVertices>proof);
  r.suspend();data.array[2]=.6;data.version++;const before=r.stats.proofVertices;assert.equal(r.sync(),false);assert.ok(r.stats.proofVertices>before);assert.match(r.stats.reason,/nonplanar/);r.dispose();
});

test('same text atlas texture pixel update reuses the transparent batch',()=>{
  const {cad,registry:r,objects}=fixture(1,{maxObjects:256});const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute([0,0,.2,1,0,.2,0,1,.2],3));g.setAttribute('uv',new THREE.Float32BufferAttribute([0,0,1,0,0,1],2));const texture=new THREE.Texture();const m=new THREE.MeshBasicMaterial({transparent:true,map:texture,alphaTest:.01,depthWrite:true,side:THREE.DoubleSide});m.forceSinglePass=true;const text=new THREE.Mesh(g,m);cad.scene.add(text);cad.textMeshes.push({mesh:text});cad.spatialObjects.set(text,{});r.sync();const b=r.batches[0];r.suspend();texture.needsUpdate=true;assert.equal(r.sync(),true);assert.equal(r.batches[0],b);r.dispose();
});

test('unknown scene transparent draw participates in global depth proof and fails closed',()=>{
  const {cad,registry:r,objects}=fixture(2);r.sync();r.suspend();
  const alien=new THREE.Mesh(objects[0].geometry,new THREE.MeshBasicMaterial({transparent:true}));alien.renderOrder=50000;alien.position.z=.5;cad.scene.add(alien);
  assert.equal(r.sync(),false);assert.match(r.stats.reason,/depth intervals/);for(const o of objects)assert.equal(o.visible,true);assert.equal(r.batches[0].mesh.parent,null);
  cad.scene.remove(alien);assert.equal(r.sync(),true);r.dispose();
});

test('rejects descending triangles, changed depth state and reflected solids without hiding originals',()=>{
  const {registry:r,objects}=fixture(2);r.sync();r.suspend();
  objects[0].geometry.setAttribute('position',new THREE.Float32BufferAttribute([0,0,.05,1,0,.05,0,1,.05,0,0,0,1,0,0,0,1,0],3));
  assert.equal(r.sync(),false);assert.match(r.stats.reason,/nonmonotonic/);assert.ok(objects.every(o=>o.visible));
  objects[0].geometry.setAttribute('position',new THREE.Float32BufferAttribute([0,0,0,1,0,0,0,1,0],3));objects[0].material.depthFunc=THREE.AlwaysDepth;assert.equal(r.sync(),false);
  objects[0].material.depthFunc=THREE.LessEqualDepth;objects[0].scale.x=-1;assert.equal(r.sync(),true);assert.equal(r.batches.length,0);assert.ok(objects.every(o=>o.visible));r.dispose();
});

test('equal painter keys retain object id order and restore original orders after suspension',()=>{
  const {registry:r,objects}=fixture(2);for(const o of objects){o.position.z=0;o.renderOrder=7;}
  r.sync();assert.deepEqual(r.batches[0].records.map(v=>v.object),objects);assert.deepEqual(objects.map(o=>o.renderOrder),[0,1]);r.suspend();assert.deepEqual(objects.map(o=>o.renderOrder),[7,7]);r.dispose();
});


test('owner token reuses validated cohort across culling and invalidates on edit epoch',()=>{
 const {cad,objects,registry:r}=fixture();let collects=0;const collect=r.collect.bind(r);r.collect=()=>{collects++;return collect();};
 assert.equal(r.sync({retainedToken:[1]}),true);const builds=r.stats.builds,proof=r.stats.proofVertices;
 r.suspend();cad.scene.remove(objects[0]);assert.equal(r.sync({retainedToken:[1]}),true);
 assert.equal(collects,1);assert.equal(r.stats.builds,builds);assert.equal(r.stats.proofVertices,proof);assert.equal(r.batches[0].records[0].active,false);
 r.suspend();cad.scene.add(objects[0]);assert.equal(r.sync({retainedToken:[1]}),true);assert.equal(r.batches[0].records[0].active,true);
 r.suspend();objects[0].geometry.attributes.position.setZ(0,.5);objects[0].geometry.attributes.position.needsUpdate=true;
 assert.equal(r.sync({retainedToken:[2]}),false);assert.equal(collects,2);assert.ok(objects.every(o=>o.visible));r.dispose();
});
