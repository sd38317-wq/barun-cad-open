import test from 'node:test';
import assert from 'node:assert/strict';
import { CadGpuRenderer } from './gpu-renderer.js';
import { THREE } from './vendor/mlightcad.js';
import { DrawingEngine } from './engine.js';
import { GpuCompileClient } from './gpu-compile-client.js';
import { compileGpuJob } from './gpu-compile-job.js';

const p=(x,y)=>({x,y});
function renderer(){
  const r=Object.create(CadGpuRenderer.prototype);
  Object.assign(r,{scene:new THREE.Scene(),stats:{builds:0,frames:0},renderer:{subEntityTraits:{fillType:{}},
    lineSegments(values,size,indices){const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.BufferAttribute(values,size));g.setIndex(new THREE.BufferAttribute(indices,1));const group=new THREE.Group();group.add(new THREE.LineSegments(g,new THREE.LineBasicMaterial()));return group;},
    area(){const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute([0,0,0,10,0,0,10,10,0],3));const group=new THREE.Group();group.add(new THREE.Mesh(g,new THREE.MeshBasicMaterial()));return group;},
  }});return r;
}
function mockCanvas(){const prior=globalThis.document;globalThis.document={createElement(){return {getContext(){return {font:'',measureText(text){return {width:text.length*8};},fillText(){},save(){},restore(){},beginPath(){},rect(){},clip(){}};}};}};return ()=>{globalThis.document=prior;};}
const fixtures=[
  {id:'target',type:'text',layer:'0',position:p(3,7),height:5,text:'fixture'},
  {id:'target',type:'hatch',layer:'0',points:[p(0,0),p(20,0),p(20,20),p(0,20)],solid:true},
  {id:'target',type:'block',layer:'0',name:'fixture',position:p(0,0),entities:[{id:'innerLine',type:'line',layer:'0',points:[p(0,0),p(10,10)]},{id:'innerText',type:'text',layer:'0',position:p(3,7),height:5,text:'fixture'},{id:'innerCurve',type:'circle',layer:'0',center:p(10,10),radius:5}]},
];
for(const fixture of fixtures)test(`${fixture.type} MOVE/COPY/ERASE and undo/redo retain scene and atlas`,()=>{
  const restore=mockCanvas(),r=renderer(),engine=new DrawingEngine();
  try{
    const other={id:'other',type:'line',layer:'0',color:'#ab1234',points:[p(100,0),p(110,10)]};
    engine.doc={version:2,units:'mm',layers:[{id:'0',name:'0',visible:true,color:'#ffffff',locked:false}],entities:[structuredClone(fixture),other],blocks:[]};
    r.setDocument(engine.doc,1,1);const view={minX:-1e6,maxX:1e6,minY:-1e6,maxY:1e6};r.refineViewport(view,1);r.updateViewport(view,1);
    const spatial=r.viewportIndex,detail=r.detailIndex,textures=[...r.textures],otherObject=[...r.sourceBatchesOf('other')][0].objects[0],initialItems=r.stats.items;
    let copyId;
    const run=command=>{
      const before=engine.doc,previousRevision=r.revision;engine.execute(command);
      const oldSet=new Set(before.entities),newSet=new Set(engine.doc.entities),removed=before.entities.filter(e=>!newSet.has(e)),added=engine.doc.entities.filter(e=>!oldSet.has(e));
      r.setDocument(engine.doc,previousRevision+1,1,{lightweight:true,previousDoc:before,previousRevision,removed,added});
      r.refineViewport(view,1);r.updateViewport(view,1);assert.equal(r.viewportIndex,spatial,'whole spatial index rebuilt');assert.equal(r.detailIndex,detail,'whole curve index rebuilt');
      assert.equal(r.stats.builds,1,command.type+' rebuilt whole scene');assert.deepEqual(r.textures.slice(0,textures.length),textures,command.type+' rebuilt atlas');
      assert.ok(r.scene.children.includes(otherObject),command.type+' rebuilt unrelated buffer');
      if(command.type==='copy')copyId=added[0].id;
    };
    run({type:'move',ids:['target'],dx:50,dy:25});run({type:'undo'});run({type:'redo'});run({type:'undo'});
    const depths=[...r.sourcePrimitiveDepths.get('target')];
    for(const command of [{type:'rotate',ids:['target'],base:p(0,0),angle:35},{type:'scale',ids:['target'],base:p(0,0),factor:1.5}]){
      run(command);assert.deepEqual(r.sourcePrimitiveDepths.get('target'),depths,'composite primitive order must survive edit');
      run({type:'undo'});run({type:'redo'});run({type:'undo'});
      assert.deepEqual(r.sourcePrimitiveDepths.get('target'),depths);assert.equal(r.stats.items,initialItems);
    }
    run({type:'copy',ids:['target'],dx:50,dy:25});assert.ok(r.sourceZ.has(copyId));assert.ok(r.stats.items>initialItems);
    run({type:'undo'});assert.ok(!r.sourceZ.has(copyId));assert.equal(r.stats.items,initialItems);
    run({type:'redo'});assert.ok(r.sourceZ.has(copyId));run({type:'undo'});
    run({type:'delete',ids:['target']});assert.ok(!r.sourceZ.has('target'));
    assert.ok(!r.sourceBatches.has('target'));assert.ok(!r.sourceTextMeshes.has('target'));assert.ok(!r.sourceHatches.has('target'));assert.ok(!r.sourceDetails.has('target'));
    run({type:'undo'});assert.ok(r.sourceZ.has('target'));assert.equal(r.stats.items,initialItems);
    run({type:'redo'});run({type:'undo'});assert.equal(r.stats.items,initialItems);
    assert.ok([...r.detailBatches.values()].every(set=>set.size>0));
  }finally{r.clearScene();restore();}
});

test('large composite replacement applies worker results only to requested revision and retains unrelated geometry',()=>{
  const r=renderer(),engine=new DrawingEngine();let worker;
  const fixture={id:'target',type:'block',name:'worker-fixture',position:p(0,0),layer:'0',entities:Array.from({length:1100},(_,i)=>({id:'i'+i,type:'line',layer:'0',points:[p(i,0),p(i,10)]}))};
  fixture.entities.push({id:'curve',type:'circle',layer:'0',center:p(20,20),radius:30});
  engine.doc={version:2,units:'mm',layers:[{id:'0',name:'0',visible:true,color:'#ffffff',locked:false}],entities:[fixture,{id:'other',type:'line',layer:'0',color:'#ab1234',points:[p(10000,0),p(10010,10)]}],blocks:[]};
  r.setDocument(engine.doc,1,1);const initial=engine.doc,other=[...r.sourceBatchesOf('other')][0].objects[0];
  r.compileClient=new GpuCompileClient({createWorker:()=>worker={postMessage(m){this.message=structuredClone(m);},terminate(){this.terminated=true;}}});
  try {
    engine.execute({type:'rotate',ids:['target'],base:p(0,0),angle:30});
    const rotated=engine.doc,edit={lightweight:true,previousDoc:initial,previousRevision:1,removed:[fixture],added:[rotated.entities[0]]};
    r.setDocument(rotated,2,1,edit);assert.equal(r.stats.workerPending,true);assert.equal(r.doc,initial);assert.equal(r.stats.builds,1);
    const message=worker.message;worker.onmessage({data:{id:message.id,result:structuredClone(compileGpuJob(message.job))}});
    r.setDocument(rotated,2,20,edit);assert.equal(r.stats.workerPending,false);assert.equal(r.doc,rotated);assert.equal(r.stats.workerBuilds,1);assert.equal(r.stats.builds,1);
    assert.ok([...r.details.values()].every(d=>d.scale===2),'zoom during worker must not claim old tessellation has new resolution');
    r.refineViewport({minX:-1e6,maxX:1e6,minY:-1e6,maxY:1e6},20);assert.ok([...r.details.values()].every(d=>d.scale===40));
    assert.ok(r.scene.children.includes(other));assert.equal(r.sourcePrimitiveDepths.get('target').length,1101);
    assert.ok(r.lineBatches.size<20,'composite replacement must batch primitives instead of one draw per child');
    const records=[...r.lineBatches.values()].flatMap(b=>b.records).filter(x=>x.sourceId==='target');
    assert.ok(records.some(x=>Math.abs(x.points[3]-(-5-r.shift.x))<1e-6),'rotated endpoint must be uploaded');
  }finally{r.clearScene();r.compileClient.dispose();}
});

test('topology-changing composite completes worker full fallback without resubmitting edit indefinitely',()=>{
  const r=renderer();let worker;
  const fixture={id:'target',type:'block',layer:'0',entities:Array.from({length:1100},(_,i)=>({id:'i'+i,type:'line',layer:'0',points:[p(i,0),p(i,10)]}))};
  const initial={layers:[{id:'0',name:'0',visible:true,color:'#fff'}],entities:[fixture]};r.setDocument(initial,1,1);
  const nextEntity={...fixture,entities:[...fixture.entities,{id:'more',type:'line',layer:'0',points:[p(0,0),p(10,0)]}]},next={...initial,entities:[nextEntity]};
  const edit={lightweight:true,previousDoc:initial,previousRevision:1,removed:[fixture],added:[nextEntity]};
  r.compileClient=new GpuCompileClient({createWorker:()=>worker={postMessage(m){this.message=structuredClone(m);},terminate(){}}});
  const finish=()=>{const m=worker.message;worker.onmessage({data:{id:m.id,result:structuredClone(compileGpuJob(m.job))}});};
  try {
    r.setDocument(next,2,1,edit);finish();r.setDocument(next,2,1,edit);
    assert.equal(r.compileClient.pending.kind,'full');finish();r.setDocument(next,2,1,edit);
    assert.equal(r.doc,next);assert.equal(r.stats.builds,2);assert.equal(r.stats.items,1101);assert.equal(r.compileClient.pending,null);
  }finally{r.clearScene();r.compileClient.dispose();}
});

