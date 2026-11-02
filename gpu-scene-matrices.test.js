import test from 'node:test';
import assert from 'node:assert/strict';
import {THREE} from './vendor/mlightcad.js';
import {SceneMatrixCache} from './gpu-scene-matrices.js';

test('unchanged scene reuses matrices while camera projection remains live',()=>{
 const scene=new THREE.Scene(),root=new THREE.Group(),line=new THREE.Object3D(),camera=new THREE.OrthographicCamera(),cache=new SceneMatrixCache();
 root.position.set(10,20,0);line.position.x=7;root.add(line);scene.add(root);let updates=0;
 const original=scene.updateMatrixWorld;scene.updateMatrixWorld=function(...args){updates++;return original.apply(this,args);};
 const seen=[],renderer={render(s,c){if(s.matrixWorldAutoUpdate)s.updateMatrixWorld();seen.push([line.matrixWorld.elements[12],c.projectionMatrix.elements[0]]);}};
 cache.render(renderer,scene,camera,[1]);camera.left=-20;camera.right=20;camera.updateProjectionMatrix();cache.render(renderer,scene,camera,[1]);
 assert.equal(updates,1);assert.equal(cache.reuses,1);assert.equal(seen[0][0],17);assert.equal(seen[1][0],17);assert.notEqual(seen[0][1],seen[1][1]);assert.equal(scene.matrixWorldAutoUpdate,true);
 root.position.x=50;cache.render(renderer,scene,camera,[2]);assert.equal(seen.at(-1)[0],57);assert.equal(updates,2);
});

test('newly visible roots receive current matrices without rescanning unchanged scene',()=>{
 const scene=new THREE.Scene(),root=new THREE.Group(),child=new THREE.Object3D(),camera=new THREE.OrthographicCamera(),cache=new SceneMatrixCache();root.position.x=100;child.position.x=9;root.add(child);
 const renderer={render(s){if(s.matrixWorldAutoUpdate)s.updateMatrixWorld();}};cache.render(renderer,scene,camera,[1]);
 scene.add(root);root.updateWorldMatrix(true,true);cache.render(renderer,scene,camera,[1]);assert.equal(child.matrixWorld.elements[12],109);assert.equal(cache.refreshes,1);
 scene.remove(root);root.position.x=200;cache.render(renderer,scene,camera,[2]);scene.add(root);root.updateWorldMatrix(true,true);cache.render(renderer,scene,camera,[2]);assert.equal(child.matrixWorld.elements[12],209);
});

test('clear, scene transform and render failure invalidate cache and restore flags',()=>{
 const scene=new THREE.Scene(),camera=new THREE.OrthographicCamera(),cache=new SceneMatrixCache(),renderer={render(){}};
 cache.render(renderer,scene,camera,[1]);scene.position.x=5;cache.render(renderer,scene,camera,[1]);assert.equal(scene.matrixWorld.elements[12],5);assert.equal(cache.refreshes,2);
 assert.throws(()=>cache.render({render(){throw Error('draw failed');}},scene,camera,[1]),/draw failed/);assert.equal(scene.matrixWorldAutoUpdate,true);assert.equal(cache.token,null);
 cache.render(renderer,scene,camera,[1]);assert.equal(cache.refreshes,3);cache.clear();cache.render(renderer,scene,camera,[1]);assert.equal(cache.refreshes,4);
 scene.matrixWorldAutoUpdate=false;cache.render(renderer,scene,camera,[2]);assert.equal(scene.matrixWorldAutoUpdate,false);assert.equal(cache.refreshes,4);
});
