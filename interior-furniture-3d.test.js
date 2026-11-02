import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from './three.module.js';
import {buildReviewModel,disposeReviewModel,exportReviewGLB} from './review-3d.js';
import {furnitureSpec,furnitureSolids} from './architecture.js';
import {libraryBlock} from './block-library.js';
import {DrawingEngine} from './engine.js';

// 인테리어 1단계: 평면 가구 블록 → 같은 ID 의 3D 상자(보기·실내·GLB 같은 길), 도면 묶음이 있어도 빠지지 않는다.
const bed=(width=1400,{rotation=0,id='bed'}={})=>({...libraryBlock('bed-double',{width,length:2000},{position:{x:1000,y:1000},rotation,layer:'furn'}),id});
function fixture(extra=[],sets){
 const engine=new DrawingEngine(),doc=structuredClone(engine.doc);
 doc.layers.push({...doc.layers[0],id:'furn',name:'A-FURN'});
 doc.entities=[bed(),...extra];if(sets)doc.drawingSets=sets;
 engine.execute({type:'load',document:doc});return engine;
}
const meshBox=(model,id)=>{const box=new THREE.Box3();let hit=0;model.group.traverse(o=>{if(o.isMesh&&o.userData.objectId===id){box.union(new THREE.Box3().setFromObject(o));hit++;}});return hit?box:null;};
const near=(a,b,msg)=>assert.ok(Math.abs(a-b)<1e-3,`${msg}: ${a} != ${b}`);
const designSets=()=>({A:{model:{stories:[{id:'s1',name:'1F',elevation:0,height:3000},{id:'s2',name:'2F',elevation:3000,height:3000}],elements:[{id:'w1',kind:'wall',story:'s1',path:[[0,0],[5000,0]],thickness:200,exterior:true,outwardNormal:[0,-1]}]}}});

test('library bed becomes one box with plan footprint, catalog height and mm→m Y-up',()=>{
 const model=buildReviewModel(fixture().doc,{autoSlabs:false,autoRoof:false});
 try{const box=meshBox(model,'bed');assert.ok(box,'bed mesh exists');
  near(box.max.x-box.min.x,1.4,'width');near(box.max.z-box.min.z,2.0,'length on -y');near(box.min.y,0,'floor');near(box.max.y,.45,'bed height');near(box.min.x,1.0,'x');assert.ok(box.max.z<=-1+1e-3,'plan +y maps to -z');}
 finally{disposeReviewModel(model.group);}
});
test('rotated bed stays a rotated box, not a widened bounding box',()=>{
 const e=bed(1400,{rotation:90}),[part]=furnitureSolids(e,e,'A-FURN');
 const xs=part.points.map(p=>p.x),ys=part.points.map(p=>p.y);
 near(Math.max(...xs)-Math.min(...xs),2000,'rotated x span');near(Math.max(...ys)-Math.min(...ys),1400,'rotated y span');
});
test('doors, windows and stairs are not furniture; plain blocks on A-FURN are',()=>{
 assert.equal(furnitureSpec({type:'block',parameters:{kind:'DOOR'},category:'LIBRARY',attributes:{libraryId:'bed-double'}},'A-FURN'),null);
 assert.equal(furnitureSpec({type:'block',category:'LIBRARY',attributes:{libraryId:'car-small'}},'A-PARK'),null);
 assert.equal(furnitureSpec({type:'block',entities:[]},'A-FURN').height,750);
 assert.equal(furnitureSpec({type:'line'},'A-FURN'),null);
});
test('drawingSet model still shows plan furniture once; unnamed-floor furniture sits on 1F so a 2F filter hides it',()=>{
 const engine=fixture([],designSets());
 const all=buildReviewModel(engine.doc),upper=buildReviewModel(engine.doc,{floors:['2F']});
 try{assert.equal(all.wallCount,1);const box=meshBox(all,'bed');assert.ok(box,'bed in design model');near(box.max.y,.45,'height');
  let count=0;all.group.traverse(o=>{if(o.isMesh&&o.userData.objectId==='bed')count++;});assert.equal(count,1,'no duplicate');
  assert.ok(all.box.containsBox(box),'model box covers furniture');assert.equal(meshBox(upper,'bed'),null,'1F furniture hidden on 2F filter');}
 finally{disposeReviewModel(all.group);disposeReviewModel(upper.group);}
});
test('cad_set_model3d edits furniture height/elevation/color in one undo step; shape kinds rejected',()=>{
 const engine=fixture(),count=engine.undoStack.length;
 engine.execute({type:'model3d.set',ids:['bed'],changes:{height:600,elevation:100,color:'#abcdef'}});assert.equal(engine.undoStack.length,count+1);
 const model=buildReviewModel(engine.doc,{autoSlabs:false,autoRoof:false});
 try{const box=meshBox(model,'bed');near(box.min.y,.1,'elevation');near(box.max.y,.7,'height');let color;model.group.traverse(o=>{if(o.isMesh&&o.userData.objectId==='bed')color=o.material.color.getHexString();});assert.equal(color,'abcdef');}
 finally{disposeReviewModel(model.group);}
 for(const changes of [{kind:'slab'},{roofRise:100}]){const snapshot=engine.doc;assert.throws(()=>engine.execute({type:'model3d.set',ids:['bed'],changes}),/가구 3D/);assert.equal(engine.doc,snapshot);}
 engine.execute({type:'undo'});assert.equal(engine.doc.entities[0].model3d,undefined);
});
test('width change, JSON save/reload: plan, view and GLB agree on size and id',async()=>{
 const engine=fixture();engine.execute({type:'model3d.set',ids:['bed'],changes:{height:500}});
 const doc=structuredClone(engine.doc);doc.entities[0]={...bed(1600),model3d:engine.doc.entities[0].model3d};
 const reopened=new DrawingEngine();reopened.execute({type:'load',document:JSON.parse(JSON.stringify(doc))});
 const model=buildReviewModel(reopened.doc,{autoSlabs:false,autoRoof:false});
 try{const box=meshBox(model,'bed');near(box.max.x-box.min.x,1.6,'new width');near(box.max.y,.5,'kept height');}finally{disposeReviewModel(model.group);}
 const old=globalThis.FileReader;globalThis.FileReader=class{readAsArrayBuffer(blob){blob.arrayBuffer().then(result=>{this.result=result;this.onloadend?.();});}};
 try{const bytes=new Uint8Array(await exportReviewGLB(reopened.doc,{autoSlabs:false,autoRoof:false})),view=new DataView(bytes.buffer),n=view.getUint32(12,true);
  const json=JSON.parse(new TextDecoder().decode(bytes.subarray(20,20+n)));
  const node=json.nodes.find(x=>x.extras?.objectId==='bed');assert.ok(node,'GLB node carries the plan id');
  const prim=json.meshes[node.mesh].primitives[0],acc=json.accessors[prim.attributes.POSITION];near(acc.max[0]-acc.min[0],1.6,'GLB width');near(acc.max[1]-acc.min[1],.5,'GLB height');}
 finally{globalThis.FileReader=old;}
});
test('foreign A-FURN outline with a 3D height also shows on the drawingSet model; without model3d it stays 2D',()=>{
 const sofa={id:'sofa',type:'polyline',closed:true,layer:'furn',points:[{x:4000,y:500},{x:6000,y:500},{x:6000,y:1400},{x:4000,y:1400}]};
 const engine=fixture([{...sofa,model3d:{height:800}},{...sofa,id:'flat',points:sofa.points.map(p=>({x:p.x,y:p.y+2000}))}],designSets());
 const model=buildReviewModel(engine.doc);
 try{const box=meshBox(model,'sofa');assert.ok(box);near(box.max.y,.8,'outline height');near(box.max.x-box.min.x,2,'outline width');assert.equal(meshBox(model,'flat'),null);}finally{disposeReviewModel(model.group);}
});
test('plan view frames: furniture follows the frame origin and its story elevation; outside every frame is ignored and reported',()=>{
 const sets={A:{model:{stories:[{id:'s1',name:'1F',elevation:0,height:4500},{id:'s2',name:'2F',elevation:4500,height:3000}],elements:[
  {id:'w1',kind:'wall',story:'s1',path:[[0,0],[5000,0],[5000,4000]],thickness:200},{id:'w2',kind:'wall',story:'s2',path:[[0,0],[5000,0],[5000,4000]],thickness:200}]},
  wallViews:[{origin:[0,0],wallIds:['w1']},{origin:[20000,0],wallIds:['w2']}]}};
 const upstairs={...libraryBlock('bed-double',{width:1400,length:2000},{position:{x:21000,y:1000},layer:'furn'}),id:'bed2'},far={...libraryBlock('desk',{width:1200,depth:600},{position:{x:90000,y:90000},layer:'furn'}),id:'far'};
 const model=buildReviewModel(fixture([upstairs,far],sets).doc);
 try{const one=meshBox(model,'bed'),two=meshBox(model,'bed2');near(one.min.x,1,'1F bed x');near(one.min.y,0,'1F floor');
  near(two.min.x,1,'2F bed shifted back by frame origin');near(two.min.y,4.5,'2F bed on model story elevation, not 3000 default');
  assert.equal(meshBox(model,'far'),null);assert.deepEqual(model.group.userData.ignoredFurniture,['far']);}
 finally{disposeReviewModel(model.group);}
});
test('ellipse toilets and rotated round furniture keep their real footprint',()=>{
 const toilet=libraryBlock('toilet-floor',{},{position:{x:0,y:0},layer:'furn'}),[t]=furnitureSolids(toilet,toilet,'A-SANI'),ys=t.points.map(p=>p.y);
 near(Math.max(...ys)-Math.min(...ys),740,'toilet depth');
 const round={type:'block',position:{x:0,y:0},rotation:45,entities:[{type:'circle',center:{x:0,y:0},radius:1000}]},[r]=furnitureSolids(round,round,'A-FURN');
 const side=Math.hypot(r.points[1].x-r.points[0].x,r.points[1].y-r.points[0].y);near(side,2000,'rotated circle box side');
});
test('furniture on the original plan (model coordinates) still shows when the drawing set is drawn beside it',()=>{
 const sets={A:{model:{stories:[{id:'s1',name:'1F',elevation:0,height:3000}],elements:[{id:'w1',kind:'wall',story:'s1',path:[[0,0],[5000,0],[5000,4000]],thickness:200}]},wallViews:[{origin:[20000,0],wallIds:['w1']}]}};
 const model=buildReviewModel(fixture([],sets).doc);
 try{const box=meshBox(model,'bed');assert.ok(box,'bed on the source plan');near(box.min.x,1,'no frame shift');assert.equal(model.group.userData.ignoredFurniture,undefined);}finally{disposeReviewModel(model.group);}
});
