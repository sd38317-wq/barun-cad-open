import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import * as THREE from './three.module.js';
import {GLTFLoader} from './GLTFLoader.js';
import {calculateCameraFit, detailNodeName, disposeGltfResources} from './detail-3d-viewer.js';
import {hasDetailGlb, detailGlbBuffer, isSafeDetailGlbPath} from './detail-3d-utils.js';

const box = (min, max) => ({min: Object.fromEntries(['x','y','z'].map((k,i) => [k,min[i]])), max: Object.fromEntries(['x','y','z'].map((k,i) => [k,max[i]]))});

test('camera fits every corner and depth in wide and narrow panes at different model scales', () => {
  for (const aspect of [0.15, 1, 4]) for (const scale of [0.00001, 1, 10000]) {
    const bounds = box([20*scale,-5*scale,7*scale], [80*scale,2*scale,12*scale]);
    const fit = calculateCameraFit(bounds, aspect);
    const camera = new THREE.PerspectiveCamera(40, aspect, fit.near, fit.far);
    camera.position.set(fit.position.x, fit.position.y, fit.position.z);
    camera.lookAt(new THREE.Vector3(fit.target.x, fit.target.y, fit.target.z)); camera.updateMatrixWorld();
    for (const x of [bounds.min.x,bounds.max.x]) for (const y of [bounds.min.y,bounds.max.y]) for (const z of [bounds.min.z,bounds.max.z]) {
      const projected = new THREE.Vector3(x,y,z).project(camera);
      assert.ok(Math.abs(projected.x) < 1 && Math.abs(projected.y) < 1 && Math.abs(projected.z) < 1, JSON.stringify({aspect,scale,projected}));
    }
    assert.ok(fit.near > 0 && fit.far > fit.distance * 10 + fit.radius);
    const direction = camera.position.clone().sub(new THREE.Vector3(fit.target.x,fit.target.y,fit.target.z)).normalize();
    camera.position.set(fit.target.x,fit.target.y,fit.target.z).addScaledVector(direction,fit.distance*10); camera.updateMatrixWorld();
    assert.ok(Math.abs(new THREE.Vector3(bounds.max.x,bounds.max.y,bounds.max.z).project(camera).z)<1, 'maximum zoom-out stays inside the far plane');
  }
});

test('camera handles a point and refuses invalid bounds and viewports', () => {
  const fit = calculateCameraFit(box([3,4,5],[3,4,5]), 1);
  assert.deepEqual(fit.target, {x:3,y:4,z:5}); assert.ok(Number.isFinite(fit.distance));
  for (const bounds of [box([1,0,0],[0,1,1]), box([NaN,0,0],[1,1,1]), null]) assert.throws(() => calculateCameraFit(bounds));
  for (const aspect of [0,-1,NaN,Infinity]) assert.throws(() => calculateCameraFit(box([0,0,0],[1,1,1]), aspect));
});

test('GLB relative paths accept Unicode folders and reject traversal and absolute paths', () => {
  for (const value of ['온돌 바닥 상세 세트.glb','바닥/온돌.GLB','바닥\\온돌.glb']) assert.ok(isSafeDetailGlbPath(value), value);
  for (const value of ['../a.glb','폴더/../../a.glb','..\\a.glb','/a.glb','\\a.glb','C:a.glb','C:/a.glb','//host/a.glb','a.png','a.glb?x=1','a.glb#x','a\u0000.glb',{},null,'']) assert.equal(isSafeDetailGlbPath(value),false,String(value));
});

test('GLB availability comes only from server catalog metadata',()=>{
 const item={source:'library',kind:'detail',id:'FLOOR-072',has_glb:true};
 assert.equal(hasDetailGlb(item),true);
 for(const value of [{...item,source:'ours'},{...item,has_glb:false},{...item,kind:'unit'},{...item,id:''},{source:'library',id:'old',glb:'local.glb'}]) assert.equal(hasDetailGlb(value),false);
});

test('tooltip preserves the original GLB node name on primitive children', () => {
  const parent = new THREE.Group(); parent.name = 'sanitized'; parent.userData.name = '단열재 [THK 100]';
  const child = new THREE.Mesh(); child.name = 'primitive_0'; parent.add(child);
  assert.equal(detailNodeName(child),'단열재 [THK 100]');
  parent.userData = {}; assert.equal(detailNodeName(child),'primitive_0');
});

test('dispose frees shared geometries, materials, textures and bitmaps only once', () => {
  let geometryCount=0, materialCount=0, textureCount=0, closeCount=0;
  const geometry = new THREE.BoxGeometry(), image = {close: () => closeCount++};
  const map = new THREE.Texture(image), normalMap = new THREE.Texture(image);
  const material = new THREE.MeshStandardMaterial({map,normalMap});
  geometry.addEventListener('dispose',()=>geometryCount++); material.addEventListener('dispose',()=>materialCount++);
  for (const texture of [map,normalMap]) texture.addEventListener('dispose',()=>textureCount++);
  const scene = new THREE.Scene(); scene.add(new THREE.Mesh(geometry,material), new THREE.Mesh(geometry,material));
  const second = new THREE.Scene(); second.add(new THREE.Mesh(geometry,material));
  disposeGltfResources([scene,second]);
  assert.deepEqual([geometryCount,materialCount,textureCount,closeCount],[1,1,2,1]);
});

function triangleGlb() {
  const json = {asset:{version:'2.0'},scene:0,scenes:[{nodes:[0]}],nodes:[{name:'부재 [원래 이름]',mesh:0}],meshes:[{primitives:[{attributes:{POSITION:0}}]}],buffers:[{byteLength:36}],bufferViews:[{buffer:0,byteOffset:0,byteLength:36}],accessors:[{bufferView:0,componentType:5126,count:3,type:'VEC3',min:[0,0,0],max:[1,1,0]}]};
  const raw = Buffer.from(JSON.stringify(json)), jsonLength = Math.ceil(raw.length/4)*4;
  const bytes = Buffer.alloc(12+8+jsonLength+8+36); bytes.writeUInt32LE(0x46546c67,0);bytes.writeUInt32LE(2,4);bytes.writeUInt32LE(bytes.length,8);
  bytes.writeUInt32LE(jsonLength,12);bytes.writeUInt32LE(0x4e4f534a,16);bytes.fill(0x20,20,20+jsonLength);raw.copy(bytes,20);
  bytes.writeUInt32LE(36,20+jsonLength);bytes.writeUInt32LE(0x004e4942,24+jsonLength);
  [0,0,0,1,0,0,0,1,0].forEach((value,i)=>bytes.writeFloatLE(value,28+jsonLength+i*4));
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset+bytes.byteLength);
}

test('root r186 loader parses an embedded GLB using local dependencies', async () => {
  assert.equal(THREE.REVISION, '186');
  const gltf = await new GLTFLoader().parseAsync(triangleGlb(), '');
  let count = 0; gltf.scene.traverse(node => {if (node.isMesh) {count++; assert.equal(detailNodeName(node),'부재 [원래 이름]');}});
  assert.equal(count,1); disposeGltfResources(gltf.scenes);
});

test('Blender 온돌 바닥 sample parses every member with the new loader', async t => {
  const sample = process.env.BARUN_DETAIL_GLB_SAMPLE || 'D:/어플/캐드/tmp/details-v2/온돌 바닥 상세 세트.glb';
  let bytes;
  try {bytes = await fs.readFile(sample);} catch (error) {if (error.code === 'ENOENT') {t.skip('Local Blender sample not present'); return;} throw error;}
  const gltf = await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength), '');
  const names = []; gltf.scene.traverse(node => {if (node.isMesh) names.push(detailNodeName(node));});
  assert.ok(names.length >= 5); assert.equal(new Set(names).size,names.length);   // 시료는 다시 렌더될 때마다 부재 수가 바뀔 수 있다(10/13 7개)
  assert.ok(!new THREE.Box3().setFromObject(gltf.scene).isEmpty()); disposeGltfResources(gltf.scenes);
});

test('authenticated server GLB decodes to RAM buffer and refuses malformed binary',()=>{
 const bytes=Buffer.alloc(20);bytes.write('glTF');bytes.writeUInt32LE(2,4);bytes.writeUInt32LE(20,8);
 const asset={format:'barun-asset/1',kind:'detail',glb:bytes.toString('base64')};
 assert.deepEqual(Buffer.from(detailGlbBuffer(asset)),bytes);
 for(const bad of [{...asset,kind:'unit'},{...asset,glb:'!!'},{...asset,glb:Buffer.from('plain text').toString('base64')},{...asset,glb:null}]) assert.throws(()=>detailGlbBuffer(bad));
 const invalid=Buffer.from(bytes);invalid.writeUInt32LE(999,8);assert.throws(()=>detailGlbBuffer({...asset,glb:invalid.toString('base64')}));
});
