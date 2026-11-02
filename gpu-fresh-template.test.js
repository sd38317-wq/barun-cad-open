import test from 'node:test';
import assert from 'node:assert/strict';
import {CadGpuRenderer,validateGpuEditMembership} from './gpu-renderer.js';
import {THREE} from './vendor/mlightcad.js';
import {compileGpuJob,gpuJobDocument} from './gpu-compile-job.js';
import {DrawingEngine} from './engine.js';
import * as G from './geometry.js';

const p=(x,y)=>({x,y});
const line=(id,x)=>({id,type:'line',layer:'0',points:[p(x,0),p(x+10,10)]});
const ref=(id,name='shape')=>({id,type:'block',name,sharedBlock:name,layer:'0',position:p(0,0),scale:1,rotation:0,entities:[]});
function renderer(){
  const r=Object.create(CadGpuRenderer.prototype);
  Object.assign(r,{scene:new THREE.Scene(),stats:{builds:0,frames:0},uploads:0,renderer:{subEntityTraits:{fillType:{}},
    lineSegments(values,size,indices){r.uploads++;const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.BufferAttribute(values,size));geometry.setIndex(new THREE.BufferAttribute(indices,1));const group=new THREE.Group();group.add(new THREE.LineSegments(geometry,new THREE.LineBasicMaterial()));group.fastDeepClone=function(){const copy=this.clone(true);copy.fastDeepClone=this.fastDeepClone;return copy;};return group;},
    area(){const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute([0,0,0,10,0,0,10,10,0],3));const group=new THREE.Group();group.add(new THREE.Mesh(geometry,new THREE.MeshBasicMaterial()));return group;},
  }});return r;
}
function drawing(){
  return {version:3,units:'mm',layers:[{id:'0',name:'0',visible:true,color:'#ffffff',locked:false}],entities:[ref('target'),line('other',1)],blocks:[],sharedBlocks:{
    shape:{origin:p(0,0),entities:[line('inner-line',0),{type:'polyline',layer:'0',points:Array.from({length:500},(_,i)=>p(i,Math.sin(i/30)))},
      {type:'circle',layer:'0',center:p(20,20),radius:10},{type:'arc',layer:'0',center:p(30,40),radius:20,startAngle:20,endAngle:230},
      {type:'hatch',layer:'0',solid:true,points:G.rectangle(p(0,0),p(10,10))},
      {type:'hatch',layer:'0',pattern:'ANSI31',solid:false,spacing:3,angle:45,origin:p(0,0),points:G.rectangle(p(20,0),p(30,10))}]},
  }};
}
const clean=value=>JSON.parse(JSON.stringify(value,(key,v)=>['id','detailId'].includes(key)?undefined:v));
function nearDeep(a,b,path=''){
  if(typeof a==='number'&&typeof b==='number'){assert.ok(Math.abs(a-b)<=1e-9*Math.max(1,Math.abs(a),Math.abs(b)),path);return;}
  if(a&&b&&typeof a==='object'&&typeof b==='object'){assert.deepEqual(Object.keys(a),Object.keys(b),path);for(const key of Object.keys(a))nearDeep(a[key],b[key],path+'.'+key);return;}
  assert.equal(a,b,path);
}
const view={minX:-1e6,maxX:1e6,minY:-1e6,maxY:1e6};
const records=(r,id)=>[...r.sourceBatchesOf(id)||[]].flatMap(b=>b.records.filter(record=>record.sourceId===id));

function mixedDrawing(){
 const doc=drawing(),children=doc.sharedBlocks.shape.entities;
 children.splice(0,2,...Array.from({length:256},(_,i)=>line('static-'+i,i*10)));
 children.splice(64,0,children.splice(256,1)[0]);
 children.splice(128,0,children.splice(257,1)[0]);
 return doc;
}
function compareState(r,ids){
 return {
  depths:ids.map(id=>[...r.sourcePrimitiveDepths.get(id)||[]]),
  sourceZ:ids.map(id=>r.sourceZ.get(id)),nextTopZ:r.nextTopZ,items:r.stats.items,
  details:ids.map(id=>[...r.sourceDetails.get(id)||[]].map(key=>{const d=r.details.get(key);return {z:d.z,item:clean(d.item)};})),
  hatches:ids.map(id=>[...r.sourceHatches.get(id)||[]].map(object=>{object.updateMatrixWorld(true);const positions=[];object.traverse(o=>{if(o.geometry?.attributes.position)positions.push([...o.geometry.attributes.position.array]);});return {matrix:[...object.matrixWorld.elements],positions};})),
  records:ids.map(id=>records(r,id).map(record=>({points:[...record.points],distances:[...record.distances]}))),
 };
}
test('fresh compact mixed copies preserve every depth, dynamic detail and hatch against the original path',()=>{
 const doc=mixedDrawing(),a=renderer(),b=renderer();
 const old=b.reuseTemplateCopies.bind(b);b.reuseTemplateCopies=(doc,removed,added)=>old(doc,removed,added,false);
 try{
  for(const r of [a,b])r.setDocument(doc,1,.02);
  const added=[{...G.translate(doc.entities[0],123.456,-98.765),id:'a'},{...G.translate(doc.entities[0],765.432,10.25),id:'b'}],next={...doc,entities:[...doc.entities,...added]};
  for(const r of [a,b])r.setDocument(next,2,.02,{previousDoc:doc,previousRevision:1,lightweight:true,removed:[],added});
  assert.equal(a.stats.compactTemplateCopies,2);assert.equal(b.stats.compactTemplateCopies,undefined);
  assert.deepEqual(compareState(a,['a','b']),compareState(b,['a','b']));
  for(const r of [a,b])r.setDocument(doc,3,.02,{previousDoc:next,previousRevision:2,lightweight:true,removed:added,added:[]});
  for(const r of [a,b])r.setDocument(next,4,.02,{previousDoc:doc,previousRevision:3,lightweight:true,removed:[],added});
  assert.equal(a.stats.compactTemplateCopies,2,'retired restoration must use the original path');
  assert.deepEqual(compareState(a,['a','b']),compareState(b,['a','b']));
 }finally{a.clearScene();b.clearScene();}
});
test('all-static compact copies keep full primitive counts across five COPY and undo cycles',()=>{
 const doc=drawing();doc.sharedBlocks.shape.entities=Array.from({length:256},(_,i)=>line('s'+i,i));const r=renderer();
 try{
  r.setDocument(doc,1,.02);const initialItems=r.stats.items;let revision=1;
  for(let i=0;i<5;i++){
   const copy={...G.translate(doc.entities[0],i+.125,-.75),id:'copy-'+i},next={...doc,entities:[...doc.entities,copy]};
   const plan=r.reuseTemplateCopies(next,[],[copy],true);
   assert.equal(plan.compiled.items.length,0);assert.equal(plan.primitiveCount,256);
   r.setDocument(next,++revision,.02,{previousDoc:doc,previousRevision:revision-1,lightweight:true,removed:[],added:[copy]});
   assert.equal(r.stats.compactTemplateCopies,i+1);assert.equal(r.stats.items,initialItems+256);
   assert.equal(r.sourcePrimitiveDepths.get(copy.id).length,256);
   r.setDocument(doc,++revision,.02,{previousDoc:next,previousRevision:revision-1,lightweight:true,removed:[copy],added:[]});
   assert.equal(r.stats.items,initialItems);assert.equal(r.nextTopZ,1);assert.equal(r.stats.builds,1);
  }
 }finally{r.clearScene();}
});
test('a failing second fresh template preflight preserves retained scene resources and depth slots',()=>{
 const doc=drawing();doc.sharedBlocks.shape.entities=Array.from({length:128},(_,i)=>line('s'+i,i));
 doc.sharedBlocks.second={origin:p(0,0),entities:Array.from({length:128},(_,i)=>line('t'+i,i*20))};doc.entities.push(ref('second','second'));
 const r=renderer();
 try{
  r.setDocument(doc,1,.02);const second=[...r.sourceTemplates.values()].find(t=>t.entity.id==='second');assert.ok(second);
  second.depths[64]+=2e-6; // Simulate a non-affine retained template interval.
  const added=[{...G.translate(doc.entities[0],100,0),id:'a'},{...G.translate(doc.entities[2],200,0),id:'b'}],next={...doc,entities:[...doc.entities,...added]};
  const snapshot={objects:[...r.spatialObjects.keys()],batches:[...r.lineBatches.values()],depths:[...r.sourcePrimitiveDepths].map(([id,depths])=>[id,[...depths]]),sourceZ:[...r.sourceZ],refs:[...r.sourceTemplates.values()].map(t=>t.refs),top:r.nextTopZ,uploads:r.uploads};
  assert.equal(r.tryEdit(next,2,.02,{previousDoc:doc,previousRevision:1,lightweight:true,removed:[],added}),false);
  assert.equal(r.doc,doc);assert.deepEqual([...r.spatialObjects.keys()],snapshot.objects);assert.deepEqual([...r.lineBatches.values()],snapshot.batches);
  assert.deepEqual([...r.sourcePrimitiveDepths],snapshot.depths);assert.deepEqual([...r.sourceZ],snapshot.sourceZ);assert.equal(r.revision,1);assert.deepEqual([...r.sourceTemplates.values()].map(t=>t.refs),snapshot.refs);
  assert.equal(r.nextTopZ,snapshot.top);assert.equal(r.uploads,snapshot.uploads);assert.ok(!r.sourceZ.has('a'));
 }finally{r.clearScene();}
});
test('reversed incoming tail and exhausted depth capacity cannot enter compact installation',()=>{
 const doc=mixedDrawing(),r=renderer();
 try{
  r.setDocument(doc,1,.02);
  const added=[{...G.translate(doc.entities[0],100,0),id:'a'},{...G.translate(doc.entities[0],200,0),id:'b'}],next={...doc,entities:[...doc.entities,...added]};
  let requested;const original=r.reuseTemplateCopies.bind(r);r.reuseTemplateCopies=(d,removed,entries,compact)=>{requested=compact;return original(d,removed,entries,compact);};
  r.tryEdit(next,2,.02,{previousDoc:doc,previousRevision:1,lightweight:true,removed:[],added:added.toReversed()});
  assert.equal(requested,false);assert.equal(r.stats.compactTemplateCopies,undefined);
  r.clearScene();r.setDocument(doc,1,.02);r.nextTopZ=1.999;
  assert.equal(r.tryEdit(next,2,.02,{previousDoc:doc,previousRevision:1,lightweight:true,removed:[],added}),false);
  assert.equal(r.doc,doc);assert.ok(!r.sourceZ.has('a'));assert.equal(r.stats.compactTemplateCopies,undefined);
 }finally{r.clearScene();}
});

