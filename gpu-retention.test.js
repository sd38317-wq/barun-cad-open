import test from 'node:test';
import assert from 'node:assert/strict';
import { CadGpuRenderer, validateGpuEditMembership } from './gpu-renderer.js';
import { THREE } from './vendor/mlightcad.js';
import { DrawingEngine } from './engine.js';
import {compileGpuJob} from './gpu-compile-job.js';

const line=(id,color='#ff0000')=>({id,type:'line',layer:'0',color,points:[{x:0,y:0},{x:10,y:10}]});
const doc=(entities)=>({layers:[{id:'0',name:'0',visible:true,color:'#ffffff',lineweight:.25}],entities,blocks:[],linetypeScale:1});
test('membership proof retains original order indices and rejects undeclared changes',()=>{
  const a=line('a'),b=line('b'),c=line('c'),replacement={...b,color:'#00ff00'};
  const check=(after,removed=[],added=[])=>validateGpuEditMembership([a,b,c],after,removed,added);
  assert.deepEqual([...check([a,replacement,c],[b],[replacement]).orderIndices],[0,1,2]);
  assert.deepEqual([...check([c,a],[b],[]).orderIndices],[2,0]);
  const added=line('d');assert.deepEqual([...check([a,c,added],[b],[added]).orderIndices],[0,2,-1]);
  assert.equal(check([a,replacement,c]),null);
  assert.equal(check([a,a,c],[b],[]),null);
  assert.equal(check([a,b,c,added],[],[]),null);
  assert.equal(check([a,c],[{...b}],[]),null);
  assert.equal(validateGpuEditMembership([a,a],[a],[],[]),null);
});
function renderer(){
  const r=Object.create(CadGpuRenderer.prototype);
  Object.assign(r,{scene:new THREE.Scene(),stats:{builds:0,frames:0},renderer:{subEntityTraits:{},lineSegments(values,size,indices){
    const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.BufferAttribute(values,size));g.setIndex(new THREE.BufferAttribute(indices,1));
    const child=new THREE.LineSegments(g,new THREE.LineBasicMaterial());const group=new THREE.Group();group.add(child);return group;
  }}});
  return r;
}
function update(r,next,removed,added){
  const previousDoc=r.doc,previousRevision=r.revision;
  r.setDocument(next,previousRevision+1,1,{previousDoc,previousRevision,lightweight:true,removed,added});
}
const copy=(previous,entities)=>({...previous,layers:previous.layers.map(l=>({...l})),entities});
const records=r=>[...r.lineBatches.values()].flatMap(b=>b.records);

test('order index survives worker pending retry and full topology fallback without stale membership',()=>{
 const r=renderer(),a=line('cache-a'),b=line('cache-b'),first=doc([a,b]);r.setDocument(first,1,1);
 let pending=true,requests=0;
 r.compileClient={select(){},cancel(){},consume(){},request(_doc,_revision,_kind,job){requests++;if(pending){pending=false;return {pending:true};}return {result:compileGpuJob(job)};}};
 const additions=Array.from({length:1000},(_,i)=>line('pending-'+i)),next=copy(first,[a,b,...additions]);
 const edit={previousDoc:first,previousRevision:1,lightweight:true,removed:[],added:additions};
 r.setDocument(next,2,1,edit);assert.equal(r.doc,first);assert.equal(r.stats.workerPending,true);assert.equal(r.sourceZ.size,2);
 r.setDocument(next,2,1,edit);assert.equal(r.doc,next);assert.equal(r.stats.workerPending,false);assert.equal(r.stats.builds,1);assert.equal(requests,2);
 const block={id:a.id,type:'block',layer:'0',entities:[line('child-a'),line('child-b')]},fallback=copy(next,[block,b,...additions]);
 update(r,fallback,[a],[block]);assert.equal(r.stats.builds,2,'changed primitive count requires full rebuild after membership proof');
 assert.equal(r.sourcePrimitiveDepths.get(a.id).length,2);
 const extra=line('after-fallback');update(r,copy(fallback,[...fallback.entities,extra]),[],[extra]);
 assert.equal(r.stats.builds,2);assert.ok(r.sourceZ.get(extra.id)>r.sourceZ.get(additions.at(-1).id));assert.equal(r.sourceZ.size,1003);
 r.clearScene();assert.equal(r.doc,null);assert.equal(r.sourceZ.size,0);
});

test('real engine small move, undo and redo retain unrelated GPU buffers',()=>{
  const engine=new DrawingEngine();
  engine.doc={version:2,units:'mm',...doc([line('a'),line('b','#00ff00')])};
  const r=renderer();r.setDocument(engine.doc,1,1);
  const retained=[...r.lineBatches.values()].find(b=>b.records[0].sourceId==='b').objects[0];
  for(const command of [{type:'move',ids:['a'],dx:20,dy:0},{type:'undo'},{type:'redo'}]){
    const before=engine.doc;
    engine.execute(command);
    const oldSet=new Set(before.entities),newSet=new Set(engine.doc.entities);
    update(r,engine.doc,before.entities.filter(e=>!newSet.has(e)),engine.doc.entities.filter(e=>!oldSet.has(e)));
    assert.equal(r.stats.builds,1,command.type+' must not rebuild the scene');
    assert.ok(r.scene.children.includes(retained));
    assert.equal(records(r).find(record=>record.sourceId==='a').points[0],(command.type==='undo'?0:20)-r.shift.x);
  }
  assert.equal(r.stats.incrementalBuilds,3);
});

test('primitive append retains existing GPU buffers even when style matches',()=>{
  const r=renderer(),a=line('a'),first=doc([a]);r.setDocument(first,1,1);
  const retained=r.scene.children[0],b=line('b');update(r,copy(first,[a,b]),[],[b]);
  assert.equal(r.stats.builds,1);assert.equal(r.stats.incrementalBuilds,1);
  assert.ok(r.scene.children.includes(retained));assert.equal(r.stats.items,2);
  assert.ok(r.sourceZ.get('b')>r.sourceZ.get('a'));
});

test('move and delete update affected buffers, preserve unrelated styles and source depth',()=>{
  const r=renderer(),a=line('a'),b=line('b','#00ff00'),first=doc([a,b]);r.setDocument(first,1,1);
  const retained=[...r.lineBatches.values()].find(batch=>batch.records[0].sourceId==='b').objects[0],z=r.sourceZ.get('a');
  const moved={...a,points:[{x:20,y:0},{x:30,y:10}]};update(r,copy(first,[moved,b]),[a],[moved]);
  assert.equal(r.stats.builds,1);assert.equal(r.stats.items,2);assert.equal(r.sourceZ.get('a'),z);
  assert.ok(r.scene.children.includes(retained));assert.equal(records(r).filter(x=>x.sourceId==='a').length,1);
  assert.equal(records(r).find(x=>x.sourceId==='a').points[0],20-r.shift.x);
  update(r,copy(r.doc,[b]),[moved],[]);
  assert.equal(r.stats.items,1);assert.ok(!r.sourceZ.has('a'));assert.ok(!records(r).some(x=>x.sourceId==='a'));
  assert.ok(r.scene.children.includes(retained));
});

test('hidden replacements remove visible source metadata and can become visible again',()=>{
  const r=renderer(),a=line('a'),first=doc([a]);r.setDocument(first,1,1);
  const hidden={...a,hidden:true};update(r,copy(first,[hidden]),[a],[hidden]);
  assert.equal(r.stats.items,0);assert.ok(!r.sourceZ.has('a'));assert.equal(records(r).length,0);
  const visible={...hidden,hidden:false};update(r,copy(r.doc,[visible]),[hidden],[visible]);
  assert.equal(r.stats.items,1);assert.equal(records(r).length,1);
});

test('missing revisions, unsupported edits, changed styles and reordering use complete rebuild',()=>{
  const r=renderer(),a=line('a'),b=line('b'),first=doc([a,b]);r.setDocument(first,1,1);
  const next=copy(first,[a,b,line('c')]);
  const edit={previousDoc:first,previousRevision:0,lightweight:true,removed:[],added:[next.entities[2]]};
  assert.equal(r.tryEdit(next,2,1,edit),false);
  edit.previousRevision=1;next.layers[0].color='#ffff00';assert.equal(r.tryEdit(next,2,1,edit),false);
  next.layers[0].color=first.layers[0].color;next.entities=[b,a,next.entities[2]];assert.equal(r.tryEdit(next,2,1,edit),false);
  next.entities=[a,b,{id:'c',type:'text'}];edit.added=[next.entities[2]];assert.equal(r.tryEdit(next,2,1,edit),false);
  assert.equal(r.stats.builds,1);assert.equal(r.stats.items,2);
});

test('repeated appends batch new objects and deletions leave no stale source records',()=>{
  const r=renderer(),a=line('a'),first=doc([a]);r.setDocument(first,1,1);
  const retained=r.scene.children[0];
  for(let i=0;i<20;i++){const b=line('new'+i);update(r,copy(r.doc,[...r.doc.entities,b]),[],[b]);}
  assert.equal(r.stats.builds,1);assert.equal(r.lineBatches.size,2);assert.equal(r.stats.items,21);
  assert.ok(r.scene.children.includes(retained));
  const removed=r.doc.entities.slice(1);update(r,copy(r.doc,[a]),removed,[]);
  assert.equal(r.stats.items,1);assert.equal(r.lineBatches.size,1);assert.equal(records(r).length,1);
});
