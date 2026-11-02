import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from './three.module.js';
import {installDesignPushPull} from './design-push-pull-ui.js';

function setup(initialSet='A'){
 let setId=initialSet;
 const old=globalThis.document,fields=Object.fromEntries(['.pp-mode','.pp-target','.pp-distance','.pp-apply','.pp-error'].map(k=>[k,{value:'0',checked:true}]));
 const fieldset={querySelector:k=>fields[k]};globalThis.document={createElement:()=>fieldset};
 const handlers={},canvas={focus(){},getBoundingClientRect:()=>({left:0,top:0,width:100,height:100}),setPointerCapture(){},addEventListener:(type,fn)=>{handlers[type]=fn;}};
 const engine={doc:{drawingSets:{A:{model:{stories:[{id:'s',name:'1F',elevation:0,height:3000}],elements:[]}}}}};
 const mesh=new THREE.Mesh(new THREE.BoxGeometry(2,.2,2),new THREE.MeshBasicMaterial());mesh.position.y=1;mesh.userData.pushPull={setId:'A',target:{type:'story',id:'s'}};
 const group=new THREE.Group();group.add(mesh);group.updateMatrixWorld(true);
 const camera=new THREE.PerspectiveCamera(45,1,.1,100);camera.position.set(0,5,4);camera.lookAt(0,1,0);camera.updateMatrixWorld(true);
 const orbit={enabled:true},previews=[],commits=[];let restores=0;
 const api=installDesignPushPull({canvas,controls:{append(){}},engine,getGroup:()=>group,getCamera:()=>camera,getOrbit:()=>orbit,getSetId:()=>setId,preview:m=>previews.push(m),restore:()=>{if(!engine.doc.drawingSets.A)throw Error('stale drawing set');restores++;},commit:async args=>commits.push(args)});
 const event=(x=50,y=50)=>({clientX:x,clientY:y,pointerId:1,button:0,preventDefault(){},stopImmediatePropagation(){}});
 return {fieldset,setSet:id=>{setId=id;},fields,handlers,engine,orbit,previews,commits,api,event,restores:()=>restores,cleanup:()=>{globalThis.document=old;mesh.geometry.dispose();mesh.material.dispose();}};
}
test('drag previews without changing document and commits once on pointer release',async()=>{
 const s=setup();try{
  const before=s.engine.doc;s.handlers.pointerdown(s.event());assert.equal(s.orbit.enabled,false);
  s.handlers.pointermove(s.event(50,40));assert.equal(s.previews.length,1);assert.equal(s.engine.doc,before);assert.equal(s.commits.length,0);
  s.handlers.pointerup(s.event(50,40));await new Promise(resolve=>setImmediate(resolve));
  assert.equal(s.commits.length,1);assert.equal(s.commits[0].setId,'A');assert.deepEqual(s.commits[0].target,{type:'story',id:'s'});assert.equal(s.commits[0].expectedDocument,before);assert.equal(s.orbit.enabled,true);
 }finally{s.cleanup();}
});
test('cancel and document replacement during dragging never commit',()=>{
 const s=setup();try{
  s.handlers.pointerdown(s.event());s.handlers.pointermove(s.event(50,40));s.handlers.pointercancel(s.event());assert.equal(s.commits.length,0);assert.equal(s.orbit.enabled,true);assert.ok(s.restores()>0);
  s.handlers.pointerdown(s.event());s.engine.doc=structuredClone(s.engine.doc);s.handlers.pointermove(s.event(50,40));s.handlers.pointerup(s.event(50,40));assert.equal(s.commits.length,0);
 }finally{s.cleanup();}
});
test('face selection supports numeric distance with 10mm snap',async()=>{
 const s=setup();try{
  s.handlers.pointerdown(s.event());s.handlers.pointerup(s.event());s.fields['.pp-distance'].value='126';s.fields['.pp-apply'].onclick();await new Promise(resolve=>setImmediate(resolve));assert.equal(s.commits.length,1);assert.equal(s.commits[0].distance,130);
 }finally{s.cleanup();}
});

test('first opening exposes controls after the drawing set selector is populated',()=>{const s=setup('');try{assert.equal(s.fieldset.hidden,true);s.setSet('A');s.api.syncVisibility();assert.equal(s.fieldset.hidden,false);s.setSet('');s.api.syncVisibility();assert.equal(s.fieldset.hidden,true);}finally{s.cleanup();}});

test('document changes can discard a drag without rebuilding the deleted drawing set',()=>{const s=setup();try{s.handlers.pointerdown(s.event());s.engine.doc={drawingSets:{}};assert.doesNotThrow(()=>s.api.invalidate({restore:false}));assert.equal(s.orbit.enabled,true);assert.equal(s.commits.length,0);s.handlers.pointerup(s.event());assert.equal(s.commits.length,0);}finally{s.cleanup();}});
