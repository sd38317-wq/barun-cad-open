// ACAD200 119: 도면 LTSCALE 바꾸기는 점선 무늬 유니폼만 바꾼다(장면 재구성 없음).
import test from 'node:test';
import assert from 'node:assert/strict';
import {dashRescale,scalePatternUniforms,linetypeScaleGpuEdit} from './gpu-linetype-scale.js';
import {linetypeDashPattern} from './view.js';
import {CadGpuRenderer} from './gpu-renderer.js';
import {THREE} from './vendor/mlightcad.js';
import {DrawingEngine} from './engine.js';

// The stub hands out one shared "style manager" shader material per dash name, like MLightCAD.
function renderer(){
  const r=Object.create(CadGpuRenderer.prototype),shared=new Map();
  Object.assign(r,{shared,scene:new THREE.Scene(),stats:{builds:0,frames:0},renderer:{subEntityTraits:{},lineSegments(values,size,indices){
    const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.BufferAttribute(values,size));g.setIndex(new THREE.BufferAttribute(indices,1));
    const pattern=r.renderer.subEntityTraits.lineType.pattern.map(p=>Math.abs(p.elementLength)),name=r.renderer.subEntityTraits.lineType.name;
    let m=shared.get(name);if(!m){m=pattern.length?new THREE.ShaderMaterial({uniforms:{pattern:{value:pattern},patternLength:{value:pattern.reduce((a,b)=>a+b,0)},u_viewportScale:{value:1}}}):new THREE.LineBasicMaterial();shared.set(name,m);}
    const child=new THREE.LineSegments(g,m);const group=new THREE.Group();group.add(child);return group;
  }}});
  return r;
}
const dashed=(id,x,extra={})=>({id,type:'line',layer:'0',color:'#ff0000',linetype:'DASHED',points:[{x,y:0},{x:x+100,y:0}],...extra});
const doc=(entities,linetypeScale=1)=>({layers:[{id:'0',name:'0',visible:true,color:'#ffffff',lineweight:.25}],entities,blocks:[],linetypeScale});

test('pure: proportional patterns rescale, clamped ones refuse',()=>{
  const batch={dash:linetypeDashPattern('DASHED',2),linetype:'DASHED',linetypeScale:2};
  assert.deepEqual(dashRescale(batch,3),{ratio:3,dash:linetypeDashPattern('DASHED',6)});
  assert.equal(dashRescale({dash:linetypeDashPattern('DASHED',100),linetype:'DASHED',linetypeScale:100},2).ratio,1,'clamped at 100: a rebuild would draw the same pattern');
  assert.equal(dashRescale({dash:[7,6],linetype:'DASHED',linetypeScale:1},2),null,'not proportional: rebuild');
  assert.equal(dashRescale({dash:[7,5]},2),null,'unknown origin');
  const m={uniforms:{pattern:{value:[7,5]},patternLength:{value:12}}};assert.equal(scalePatternUniforms(m,2),true);assert.deepEqual(m.uniforms.pattern.value,[14,10]);assert.equal(m.uniforms.patternLength.value,24);
});

test('renderer: LTSCALE change rescales dash uniforms on private clones; nothing is rebuilt',()=>{
  const r=renderer(),entities=[dashed('a',0),dashed('b',200,{linetypeScale:2}),{id:'c',type:'line',layer:'0',color:'#ff0000',points:[{x:0,y:50},{x:100,y:50}]}],first=doc(entities);
  r.setDocument(first,1,1);const objects=new Set(r.scene.children),before=[...r.shared.values()].map(m=>m.uniforms?.pattern?.value.slice());
  const next={...first,linetypeScale:3,entities:[...entities]};
  r.setDocument(next,2,1,{previousDoc:first,previousRevision:1,lightweight:true,removed:[],added:[]});
  assert.equal(r.stats.builds,1);assert.equal(r.stats.linetypeScaleRescales,1);assert.equal(r.doc,next);
  for(const o of r.scene.children)assert.ok(objects.has(o),'same GPU objects');
  assert.deepEqual([...r.shared.values()].map(m=>m.uniforms?.pattern?.value.slice()),before,'shared style materials untouched');
  const patternOf=id=>{let v;for(const b of r.sourceBatchesOf(id))b.objects[0].traverse(c=>{if(c.material?.uniforms?.pattern)v=c.material.uniforms.pattern.value;});return v;};
  assert.deepEqual(patternOf('a'),linetypeDashPattern('DASHED',3));assert.deepEqual(patternOf('b'),linetypeDashPattern('DASHED',6));
  // A new dashed line with the new LTSCALE draws like the rescaled ones.
  const d=dashed('d',400);const third={...next,entities:[...next.entities,d]};
  r.setDocument(third,3,1,{previousDoc:next,previousRevision:2,lightweight:true,removed:[],added:[{...d,_displayLinetypeScale:3}]});
  void third;
});

test('engine + app helper: LTSCALE alone is a lightweight edit and undo stays lightweight too',()=>{
  const engine=new DrawingEngine();engine.doc={version:2,units:'mm',...doc([dashed('a',0)])};
  const before=engine.doc;engine.execute({type:'document.update',changes:{linetypeScale:5}});
  assert.equal(engine.lastExecution.lightweight,true);assert.equal(engine.doc.entities[0],before.entities[0],'objects shared');assert.equal(engine.doc.linetypeScale,5);
  const lt=linetypeScaleGpuEdit({before:before.entities,after:engine.doc.entities,beforeDoc:before,afterDoc:engine.doc,previousDoc:before,previousRevision:1});
  assert.deepEqual(lt.gpuEdit,{previousDoc:before,previousRevision:1,lightweight:true,removed:[],added:[]});
  assert.equal(linetypeScaleGpuEdit({before:before.entities,after:engine.doc.entities,beforeDoc:before,afterDoc:engine.doc,pending:{lightweight:true}}).gpuEdit,null);
  assert.equal(linetypeScaleGpuEdit({before:before.entities,after:before.entities,beforeDoc:before,afterDoc:before}),null,'no change');
  const after=engine.doc;engine.execute({type:'undo'});assert.equal(engine.doc,before);
  assert.ok(linetypeScaleGpuEdit({before:after.entities,after:engine.doc.entities,beforeDoc:after,afterDoc:engine.doc}).gpuEdit);
  engine.execute({type:'document.update',changes:{linetypeScale:2,limits:{enabled:false}}});assert.equal(engine.lastExecution.lightweight,false,'mixed changes keep the full path');
});
