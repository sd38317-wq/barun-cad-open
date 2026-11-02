// ACAD200 120: DRAWORDER 맨 앞/맨 뒤는 깊이만 바꾼다(장면 재구성 없음).
import test from 'node:test';
import assert from 'node:assert/strict';
import {proveDrawOrderMove,detectDrawOrderMove,drawOrderOffsets,drawOrderGpuEdit} from './gpu-draw-order.js';
import {CadGpuRenderer} from './gpu-renderer.js';
import {THREE} from './vendor/mlightcad.js';
import {DrawingEngine} from './engine.js';
import {pointerDelta} from './entity-index.js';
import {recordVertexStarts} from './gpu-batch-edit.js';
import {planDocument} from './gpu-render-protocol.js';

const line=(id,x=0,color='#ff0000')=>({id,type:'line',layer:'0',color,points:[{x,y:0},{x:x+10,y:10}]});
const hatch=id=>({id,type:'hatch',layer:'0',color:'#0000ff',solid:true,points:[{x:0,y:0},{x:50,y:0},{x:50,y:50},{x:0,y:50}]});
const doc=entities=>({layers:[{id:'0',name:'0',visible:true,color:'#ffffff',lineweight:.25}],entities,blocks:[],linetypeScale:1});
function renderer(){
  const r=Object.create(CadGpuRenderer.prototype);
  Object.assign(r,{scene:new THREE.Scene(),stats:{builds:0,frames:0},renderer:{subEntityTraits:{fillType:{}},lineSegments(values,size,indices){
    const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.BufferAttribute(values,size));g.setIndex(new THREE.BufferAttribute(indices,1));
    const child=new THREE.LineSegments(g,new THREE.LineBasicMaterial());const group=new THREE.Group();group.add(child);return group;
  },area(){const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute([0,0,0,10,0,0,10,10,0],3));const group=new THREE.Group();group.add(new THREE.Mesh(geometry,new THREE.MeshBasicMaterial()));return group;}}});
  return r;
}
const worldZ=(r,id)=>{const out=[];for(const batch of r.sourceBatchesOf(id)){const i=batch.records.findIndex(x=>x.sourceId===id),v=recordVertexStarts(batch)[i];out.push(batch.records[i].points[2]);const o=batch.objects[0];o.updateMatrixWorld(true);o.traverse(c=>{if(c.geometry?.index){const p=c.geometry.getAttribute('position');out.push(p.getZ(v)+c.matrixWorld.elements[14]);}});}return out;};

test('proof and detection: front/back moves of the same objects only',()=>{
  const [a,b,c,d]=['a','b','c','d'].map(id=>line(id));
  assert.equal(proveDrawOrderMove([a,b,c,d],[a,c,d,b],new Set(['b']),'front'),true);
  assert.equal(proveDrawOrderMove([a,b,c,d],[b,a,c,d],new Set(['b']),'back'),true);
  assert.equal(proveDrawOrderMove([a,b,c,d],[a,c,b,d],new Set(['b']),'front'),false);
  assert.equal(proveDrawOrderMove([a,b,c,d],[a,c,d,{...b}],new Set(['b']),'front'),false,'pointer identity required');
  assert.deepEqual(detectDrawOrderMove([a,b,c,d],[a,c,d,b]).move,{ids:['b'],position:'front'});
  assert.deepEqual(detectDrawOrderMove([a,b,c,d],[c,a,b,d]).move,{ids:['c'],position:'back'},'smallest explanation wins');
  assert.deepEqual(detectDrawOrderMove([a,b,c,d],[a,c,b,d]).move,{ids:['b','d'],position:'front'});
  assert.deepEqual(detectDrawOrderMove([a,b,c,d],[d,c,b,a]),{reordered:true,move:null},'a general permutation is not front/back');
  assert.equal(detectDrawOrderMove([a,b,c,d],[a,b,c,d]).reordered,false);
  const offsets=drawOrderOffsets([{id:'x',first:.2,last:.3},{id:'y',first:.5,last:.5}],'front',{top:1});
  assert.ok(Math.abs(offsets.offsets.get('x')+.2-1.00001)<1e-12);assert.ok(offsets.top>1.1);
  const back=drawOrderOffsets([{id:'x',first:.2,last:.3}],'back',{bottom:0});assert.ok(.3+back.offsets.get('x')<0);assert.ok(back.bottom<0);
});

test('renderer: DRAWORDER front/back of lines and a hatch changes depths in place',()=>{
  const r=renderer(),lines=Array.from({length:12},(_,i)=>line('l'+i,i*20)),h=hatch('h'),first=doc([h,...lines]);r.setDocument(first,1,1);
  const objects=new Set(r.scene.children);
  const nextEntities=[...first.entities.filter(e=>e.id!=='l2'),lines[2]],next={...first,entities:nextEntities};
  r.setDocument(next,2,1,{previousDoc:first,previousRevision:1,lightweight:true,removed:[],added:[],drawOrder:{ids:['l2'],position:'front'}});
  assert.equal(r.stats.builds,1,'no rebuild');assert.equal(r.doc,next);assert.equal(r.stats.drawOrderSources,1);
  for(const o of r.scene.children)assert.ok(objects.has(o),'same GPU objects');
  const top=Math.max(...[...r.sourcePrimitiveDepths.values()].flat());assert.equal(r.sourceZ.get('l2'),top);
  for(const z of worldZ(r,'l2'))assert.ok(Math.abs(z-top)<1e-6,'record and vertex z follow');
  // Hatch to the back: below every other source.
  const back={...next,entities:[h,...nextEntities.filter(e=>e!==h)]};
  // (already first) move a line to the back instead.
  const third={...next,entities:[lines[7],...nextEntities.filter(e=>e!==lines[7])]};
  r.setDocument(third,3,1,{previousDoc:next,previousRevision:2,lightweight:true,removed:[],added:[],drawOrder:{ids:['l7'],position:'back'}});
  assert.equal(r.stats.builds,1);const low=Math.min(...[...r.sourcePrimitiveDepths.values()].flat());assert.equal(r.sourceZ.get('l7'),low);assert.ok(low<0);
  // The hatch to the front: its mesh order follows its new depth.
  const fourth={...third,entities:[...third.entities.filter(e=>e!==h),h]};
  r.setDocument(fourth,4,1,{previousDoc:third,previousRevision:3,lightweight:true,removed:[],added:[],drawOrder:{ids:['h'],position:'front'}});
  assert.equal(r.stats.builds,1);const mesh=[...r.sourceHatches.get('h')][0];assert.ok(mesh.position.z>r.sourceZ.get('l2'));
  mesh.traverse(c=>{if(c.material)assert.equal(c.renderOrder,mesh.position.z*1e6);});
  // A later ordinary edit still passes the painter-order proof.
  const extra=line('x',999);r.setDocument({...fourth,entities:[...fourth.entities,extra]},5,1,{previousDoc:fourth,previousRevision:4,lightweight:true,removed:[],added:[extra]});
  assert.equal(r.stats.builds,1);assert.ok(r.sourceZ.get('x')>r.sourceZ.get('h'));
  void back;
});

test('renderer: an unproven reorder takes the complete rebuild',()=>{
  const r=renderer(),lines=Array.from({length:4},(_,i)=>line('l'+i,i*20)),first=doc(lines);r.setDocument(first,1,1);
  const next={...first,entities:[lines[0],lines[2],lines[1],lines[3]]};
  r.setDocument(next,2,1,{previousDoc:first,previousRevision:1,lightweight:true,removed:[],added:[],drawOrder:{ids:['l1'],position:'front'}});
  assert.equal(r.stats.builds,2);assert.equal(r.stats.editReject,'draworder');
});

test('engine: DRAWORDER front/back keeps objects shared; app helper turns it into a depth-only GPU edit',()=>{
  const engine=new DrawingEngine();engine.doc={version:2,units:'mm',...doc([line('a'),line('b',20),line('c',40)])};
  const before=engine.doc.entities;
  engine.execute({type:'draworder',ids:['a'],position:'front'});
  assert.equal(engine.lastExecution.lightweight,true);
  assert.deepEqual(engine.doc.entities.map(e=>e.id),['b','c','a']);for(const e of engine.doc.entities)assert.ok(before.includes(e),'same objects');
  const delta=pointerDelta(before,engine.doc.entities)||{removed:[],added:[]};
  const order=drawOrderGpuEdit({before,after:engine.doc.entities,delta,previousDoc:{},previousRevision:1});
  assert.deepEqual(order.gpuEdit.drawOrder,{ids:['a'],position:'front'});
  assert.equal(drawOrderGpuEdit({before,after:engine.doc.entities,delta,pending:{lightweight:true}}).gpuEdit,null,'an undrawn edit forces the old path');
  engine.execute({type:'undo'});assert.deepEqual(engine.doc.entities.map(e=>e.id),['a','b','c']);
  const ordinary={removed:[before[0]],added:[{...before[0]}]};
  assert.equal(drawOrderGpuEdit({before,after:[...before.slice(1),ordinary.added[0]],delta:ordinary}),null,'a real replacement is not a reorder');
});

test('worker renderer protocol sends the full order for a DRAWORDER edit',()=>{
  const a=line('a'),b=line('b'),first=doc([a,b]),next={...first,entities:[b,a]};
  assert.equal(planDocument(first,1,{doc:next,revision:2,edit:{lightweight:true,previousDoc:first,previousRevision:1,removed:[],added:[],drawOrder:{ids:['b'],position:'back'}}}).kind,'full');
  assert.equal(planDocument(first,1,{doc:{...first,entities:[a,b,line('c')]},revision:2,edit:{lightweight:true,previousDoc:first,previousRevision:1,removed:[],added:[]}}).kind,'delta','ordinary deltas unchanged');
});
