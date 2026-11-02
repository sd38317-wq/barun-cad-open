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

test('compact shared COPY reuses compiled curves, LOD and hatches with fallback-equivalent geometry',()=>{
  const r=renderer(),doc=drawing();
  try{
    r.setDocument(doc,1,.02);
    const copy={...G.translate(doc.entities[0],100,25),id:'copy'},next={...doc,entities:[...doc.entities,copy]};
    const reused=r.reuseCompiledCopies(next,[],[copy]);assert.ok(reused);
    assert.ok(reused.compiled.items.some(item=>item.curve));
    assert.ok(reused.compiled.items.some(item=>item.lodPoints));
    assert.equal(reused.compiled.items.filter(item=>item.type==='hatch').length,2);
    const full=compileGpuJob({doc:gpuJobDocument(next,[copy]),scale:reused.scale,origin:r.shift});
    nearDeep(clean(reused.compiled),clean(full.compiled));
    assert.equal(reused.reusedSources,1);
  }finally{r.clearScene();}
});

test('COPY, refinement, MOVE, ERASE and undo preserve unrelated buffers and owned copy geometry',()=>{
  const r=renderer(),engine=new DrawingEngine();engine.doc=drawing();
  try{
    r.setDocument(engine.doc,1,.02);r.updateViewport(view,.02);
    const original=engine.doc.entities[0],sourceRecords=records(r,'target').map(record=>({record,points:[...record.points],distances:[...record.distances]}));
    assert.ok([...r.sourceBatchesOf('target')].some(batch=>batch.records.some(record=>record.sourceId==='other')),'fixture has a mixed-source batch');
    const otherObject=[...r.sourceBatchesOf('other')][0].objects[0];
    const originalHatches=[...r.sourceHatches.get('target')];let disposed=0;
    for(const object of originalHatches)object.traverse(child=>child.geometry?.addEventListener('dispose',()=>disposed++));
    r.compileClient={select(){},consume(){},cancel(){},request(){throw Error('COPY unexpectedly requested worker compilation');}};
    const run=command=>{
      const before=engine.doc,revision=r.revision;const ids=engine.execute(command);
      const old=new Set(before.entities),fresh=new Set(engine.doc.entities),removed=before.entities.filter(e=>!fresh.has(e)),added=engine.doc.entities.filter(e=>!old.has(e));
      r.setDocument(engine.doc,revision+1,.02,{previousDoc:before,previousRevision:revision,lightweight:true,removed,added});
      r.updateViewport(view,.02);assert.equal(r.stats.builds,1,'must retain complete scene');return ids;
    };
    const [copyId]=run({type:'copy',ids:['target'],dx:100,dy:25});
    assert.equal(r.stats.reusedCopySources,1);
    assert.ok(r.scene.children.includes(otherObject));assert.equal(disposed,0);
    for(const {record,points,distances} of sourceRecords){assert.deepEqual(Array.from(record.points),points);assert.deepEqual(Array.from(record.distances),distances);}
    const depths=r.sourcePrimitiveDepths.get(copyId);assert.equal(depths.length,r.sourcePrimitiveDepths.get('target').length);
    assert.ok(depths.every((z,i)=>!i||z>depths[i-1]));assert.ok(depths[0]>r.sourcePrimitiveDepths.get('target').at(-1));
    const copyHatches=[...r.sourceHatches.get(copyId)];assert.equal(copyHatches.length,2);
    for(let i=0;i<copyHatches.length;i++){
      assert.notEqual(copyHatches[i],originalHatches[i]);
      assert.notEqual(copyHatches[i].children[0].geometry,originalHatches[i].children[0].geometry);
    }
    r.refineViewport(view,20);assert.ok(r.stats.refinedCurves>0);
    assert.ok([...r.sourceDetails.get(copyId)].every(id=>r.details.get(id).scale===40));
    run({type:'move',ids:[copyId],dx:50,dy:10});run({type:'undo'});
    const copyEntity=engine.doc.entities.find(e=>e.id===copyId),copyDepths=[...r.sourcePrimitiveDepths.get(copyId)];
    run({type:'delete',ids:[copyId]});assert.equal(disposed,0,'deleting copy cannot dispose source hatches');
    assert.ok(!r.sourceBatches.has(copyId));assert.ok(!r.sourceDetails.has(copyId));assert.ok(!r.sourceHatches.has(copyId));
    run({type:'undo'});assert.equal(engine.doc.entities.find(e=>e.id===copyId),copyEntity);
    assert.deepEqual(r.sourcePrimitiveDepths.get(copyId),copyDepths,'undo restores primitive painter slots');
    assert.ok(r.stats.reusedCopySources>=2);assert.ok(r.scene.children.includes(otherObject));
    run({type:'delete',ids:['target']});assert.ok(disposed>0);assert.ok(r.sourceHatches.has(copyId));
    run({type:'undo'});assert.equal(engine.doc.entities[0],original);assert.ok(r.sourceHatches.has('target'));
  }finally{r.clearScene();}
});

test('reuse excludes changed styles, definitions, clip/text sources and noncompact geometry',()=>{
  const r=renderer(),doc=drawing();
  try{
    r.setDocument(doc,1,.02);const copy={...G.translate(doc.entities[0],10,0),id:'copy'};
    assert.equal(r.reuseCompiledCopies({...doc,sharedBlocks:{...doc.sharedBlocks}},[],[copy]),null);
    assert.equal(r.reuseCompiledCopies(doc,[],[{...copy,color:'#ff0000'}]),null);
    assert.equal(r.reuseCompiledCopies(doc,[],[{...copy,clip:{enabled:true,points:G.rectangle(p(0,0),p(10,10))}}]),null);
    assert.equal(r.reuseCompiledCopies(doc,[],[{...copy,entities:[line('extra',10)]}]),null);
    for(const item of [{type:'text',sourceId:'target',entity:{text:'text'}},{type:'polyline',sourceId:'target',points:[p(0,0),p(1,0)],clipKey:'clip'}]){
      r.compiledSourceCache.clear();r.rememberCompiledSources(doc,[item],1,true);
      assert.equal(r.reuseCompiledCopies(doc,[],[copy]),null);
    }
  }finally{r.clearScene();}
});

test('compiled source cache is bounded by source count, primitive count and coordinate count',()=>{
  const r=renderer();r.clearScene();
  try{
    const doc={entities:Array.from({length:8},(_,i)=>ref('s'+i)),sharedBlocks:{shape:{entities:[]}}};
    const items=doc.entities.map(e=>({type:'polyline',sourceId:e.id,points:[p(0,0),p(1,0)]}));
    r.rememberCompiledSources(doc,items,1,true);assert.equal(r.compiledSourceCache.size,4);
    const used=()=>[...r.compiledSourceCache.values()].reduce((n,c)=>n+c.points,0);
    r.rememberCompiledSources(doc,[{type:'polyline',sourceId:'s7',points:Array(500001).fill(p(0,0))}],1);
    assert.ok(used()<=500000);assert.ok(!r.compiledSourceCache.has(doc.entities[7]));
    r.rememberCompiledSources(doc,Array.from({length:100001},()=>items[7]),1);
    assert.ok([...r.compiledSourceCache.values()].reduce((n,c)=>n+c.items.length,0)<=100000);
  }finally{r.clearScene();}
});

test('bulk COPY keeps 4096-segment chunks while a later small append retains 512-segment isolation',()=>{
  const r=renderer(),doc=drawing();doc.sharedBlocks.shape.entities=Array.from({length:10000},(_,i)=>line('inner-'+i,i*10));
  try{
    r.setDocument(doc,1,.02);
    const initialUploads=r.uploads;
    const copy={...G.translate(doc.entities[0],100,0),id:'copy'},next={...doc,entities:[...doc.entities,copy]};
    r.setDocument(next,2,.02,{previousDoc:doc,previousRevision:1,lightweight:true,removed:[],added:[copy]});
    assert.equal(r.stats.templateCopySources,1);assert.equal(r.uploads,initialUploads,'first static COPY must upload no new line buffers');
    const bulk=[...r.sourceBatchesOf(copy.id)];assert.ok(bulk.length<=4,`bulk copy fragmented into ${bulk.length} batches`);
    assert.ok(bulk.every(batch=>batch.maxWeight===4096));
    assert.equal(records(r,copy.id).reduce((n,record)=>n+record.points.length/6,0),10000,'partitioning cannot lose segments');
    const objects=bulk.flatMap(batch=>batch.objects),fresh=line('small',101),last={...next,entities:[...next.entities,fresh]};
    r.setDocument(last,3,.02,{previousDoc:next,previousRevision:2,lightweight:true,removed:[],added:[fresh]});
    assert.equal(r.stats.updatedBatches,1);
    assert.deepEqual([...r.sourceBatchesOf(copy.id)].flatMap(batch=>batch.objects),objects,'small append must not re-upload bulk copy');
    const small=[...r.sourceBatchesOf(fresh.id)];assert.equal(small.length,1);assert.equal(small[0].maxWeight,512);
    assert.ok(small[0].records.every(record=>record.sourceId===fresh.id));
  }finally{r.clearScene();}
});

test('five large COPY/UNDO cycles reclaim the append tail without rebuilding or moving retained depth slots',()=>{
  const r=renderer(),doc=drawing();doc.sharedBlocks.shape.entities=Array.from({length:35754},(_,i)=>line('inner-'+i,i));
  try{
    let revision=1;r.setDocument(doc,revision,.02);
    const originalDepths=[...r.sourcePrimitiveDepths.get('target')];
    for(let i=0;i<5;i++){
      const copy={...G.translate(doc.entities[0],100,0),id:'copy-'+i},next={...doc,entities:[...doc.entities,copy]};
      r.setDocument(next,++revision,.02,{previousDoc:doc,previousRevision:revision-1,lightweight:true,removed:[],added:[copy]});
      assert.equal(r.stats.builds,1,`COPY ${i+1} must not exhaust depth space`);
      assert.ok(r.nextTopZ>1&&r.nextTopZ<1.36);
      r.setDocument(doc,++revision,.02,{previousDoc:next,previousRevision:revision-1,lightweight:true,removed:[copy],added:[]});
      assert.equal(r.nextTopZ,1,'undo reclaims the unused append tail');
      assert.equal(r.stats.builds,1);assert.deepEqual(r.sourcePrimitiveDepths.get('target'),originalDepths);
    }
    assert.equal(r.stats.reusedCopySources,5);
    assert.equal(r.stats.templateCopySources,5);
  }finally{r.clearScene();}
});

test('static templates share initial buffers through COPY/MOVE, refinement, original deletion and undo',()=>{
  const r=renderer(),engine=new DrawingEngine();engine.doc=drawing();
  const children=engine.doc.sharedBlocks.shape.entities;
  children.splice(0,2,...Array.from({length:256},(_,i)=>line('static-'+i,i*10)));
  // Interleave a curve among static leaves: its ordinal must remain a depth gap.
  children.splice(64,0,children.splice(256,1)[0]);
  let cleared=false;
  try{
    r.setDocument(engine.doc,1,.02);r.updateViewport(view,.02);
    const template=[...r.sourceTemplates.values()][0];assert.ok(template);assert.equal(r.stats.templateStaticItems,256);
    const initialBatches=[...r.sourceBatchesOf('target')].filter(batch=>batch.template),geometry=new Set(),originalPositions=new Map(),disposals=new Map();
    for(const batch of initialBatches)for(const object of batch.objects)object.traverse(child=>{if(child.geometry){geometry.add(child.geometry);originalPositions.set(child.geometry,[...child.geometry.attributes.position.array]);disposals.set(child.geometry,0);child.geometry.addEventListener('dispose',()=>disposals.set(child.geometry,disposals.get(child.geometry)+1));}});
    const run=command=>{
      const before=engine.doc,revision=r.revision,ids=engine.execute(command),old=new Set(before.entities),fresh=new Set(engine.doc.entities);
      r.setDocument(engine.doc,revision+1,.02,{previousDoc:before,previousRevision:revision,lightweight:true,removed:before.entities.filter(e=>!fresh.has(e)),added:engine.doc.entities.filter(e=>!old.has(e))});
      r.updateViewport(view,.02);assert.equal(r.stats.builds,1);return ids;
    };
    const [copyId]=run({type:'copy',ids:['target'],dx:100,dy:25});
    const copyBatches=[...r.sourceBatchesOf(copyId)].filter(batch=>batch.template);
    assert.equal(copyBatches.length,initialBatches.length);assert.equal(r.stats.templateCopySources,1);
    for(const batch of copyBatches)for(const object of batch.objects){
      object.traverse(child=>{if(child.geometry)assert.ok(geometry.has(child.geometry),'first COPY shares the original GPU buffers');});
      const sourceDepths=template.depths,targetDepths=r.sourcePrimitiveDepths.get(copyId);
      for(let i=0;i<sourceDepths.length;i++)assert.ok(Math.abs(sourceDepths[i]*object.scale.z+object.position.z-targetDepths[i])<1e-9,'affine depths include curve and hatch ordinals');
      const entry=r.spatialObjects.get(object),original=template.chunks[copyBatches.indexOf(batch)].roots[0];
      assert.equal(entry.bounds.minX,original.bounds.minX+100);assert.equal(entry.bounds.minY,original.bounds.minY+25);
    }
    const copyObjects=copyBatches.flatMap(batch=>batch.objects);r.refineViewport(view,20);
    assert.deepEqual(copyBatches.flatMap(batch=>batch.objects),copyObjects,'curve refinement retains static instance objects');
    assert.ok([...r.sourceDetails.get(copyId)].every(id=>r.details.get(id).scale===40));
    run({type:'move',ids:['target'],dx:50,dy:10});
    const [movedCopy]=run({type:'copy',ids:['target'],dx:100,dy:25});
    const movedObject=[...r.sourceBatchesOf(movedCopy)].find(batch=>batch.template).objects[0];
    assert.equal(movedObject.position.x,150);assert.equal(movedObject.position.y,35,'copy of moved source uses immutable initial anchor');
    const [copyOfCopy]=run({type:'copy',ids:[copyId],dx:20,dy:30});
    const copyOfCopyObject=[...r.sourceBatchesOf(copyOfCopy)].find(batch=>batch.template).objects[0];
    assert.equal(copyOfCopyObject.position.x,120);assert.equal(copyOfCopyObject.position.y,55);
    run({type:'move',ids:[copyId],dx:7,dy:9});assert.equal(copyObjects[0].position.x,107);assert.equal(copyObjects[0].position.y,34);
    run({type:'undo'});assert.equal(copyObjects[0].position.x,100);
    // Deletion also works when the source roots are culled out of THREE.Scene.
    r.updateViewport({minX:1e8,minY:1e8,maxX:1e8+1,maxY:1e8+1},.02);
    run({type:'delete',ids:['target']});assert.ok([...disposals.values()].every(n=>n===0));
    run({type:'undo'});assert.ok([...r.sourceBatchesOf('target')].some(batch=>batch.template));
    for(const [buffer,values] of originalPositions)assert.deepEqual([...buffer.attributes.position.array],values,'MOVE never mutates shared arrays');
    assert.equal(template.refs,[...r.lineBatches.values()].filter(batch=>batch.template===template).length);
    run({type:'delete',ids:['target',copyId,movedCopy,copyOfCopy]});assert.equal(template.refs,0);
    assert.ok([...disposals.values()].every(n=>n===0),'bounded template cache retains geometry for undo after the last instance is removed');
    r.clearScene();cleared=true;assert.ok([...disposals.values()].every(n=>n===1),'cached and shared resources are disposed exactly once');
  }finally{if(!cleared)r.clearScene();}
});

test('template preflight rejects an incompatible later restored depth interval without partial scene mutation',()=>{
  const r=renderer(),doc=drawing();doc.sharedBlocks.shape.entities=Array.from({length:128},(_,i)=>line('static-'+i,i));
  try{
    r.setDocument(doc,1,.02);
    const a={...G.translate(doc.entities[0],100,0),id:'a'},b={...G.translate(doc.entities[0],200,0),id:'b'};
    const aDepths=Array.from({length:128},(_,i)=>1.00001+i*1e-5),bDepths=Array.from({length:128},(_,i)=>1.01+i*1e-5);bDepths[64]+=2e-6;
    r.retiredSourceDepths.set(a,aDepths);r.retiredSourceDepths.set(b,bDepths);
    const batches=[...r.lineBatches.values()],objects=[...r.spatialObjects.keys()],uploads=r.uploads,refs=[...r.sourceTemplates.values()][0].refs;
    const next={...doc,entities:[...doc.entities,a,b]};
    assert.equal(r.tryEdit(next,2,.02,{previousDoc:doc,previousRevision:1,lightweight:true,removed:[],added:[a,b]}),false);
    assert.equal(r.doc,doc);assert.equal(r.uploads,uploads);assert.deepEqual([...r.lineBatches.values()],batches);assert.deepEqual([...r.spatialObjects.keys()],objects);
    assert.equal([...r.sourceTemplates.values()][0].refs,refs);assert.ok(!r.sourceZ.has('a'));
    assert.equal(r.reuseTemplateCopies({...doc,sharedBlocks:{...doc.sharedBlocks}},[],[a]),null);
    assert.equal(r.reuseTemplateCopies(doc,[],[{...a,color:'#ff0000'}]),null);
  }finally{r.clearScene();}
});

test('restoring retired slots that overlap a newer source falls back before corrupting painter order',()=>{
  const r=renderer(),doc=drawing();doc.sharedBlocks.shape.entities=[line('a',0),line('b',20),line('c',40)];
  try{
    r.setDocument(doc,1,.02);
    const a={...G.translate(doc.entities[0],100,0),id:'a'},withA={...doc,entities:[...doc.entities,a]};
    r.setDocument(withA,2,.02,{previousDoc:doc,previousRevision:1,lightweight:true,removed:[],added:[a]});
    const retired=[...r.sourcePrimitiveDepths.get('a')];
    r.setDocument(doc,3,.02,{previousDoc:withA,previousRevision:2,lightweight:true,removed:[a],added:[]});
    const b={...G.translate(doc.entities[0],200,0),id:'b'},withB={...doc,entities:[...doc.entities,b]};
    r.setDocument(withB,4,.02,{previousDoc:doc,previousRevision:3,lightweight:true,removed:[],added:[b]});
    assert.deepEqual(r.sourcePrimitiveDepths.get('b'),retired,'new append reused retired tail');
    const restored={...withB,entities:[...doc.entities,a,b]},edit={previousDoc:withB,previousRevision:4,lightweight:true,removed:[],added:[a]};
    assert.equal(r.tryEdit(restored,5,.02,edit),false,'overlapping retired interval must reject incremental restoration');
    assert.equal(r.doc,withB);assert.ok(!r.sourceZ.has('a'));
    r.setDocument(restored,5,.02,edit);assert.equal(r.stats.builds,2);
    assert.ok(r.sourcePrimitiveDepths.get('a').at(-1)<r.sourcePrimitiveDepths.get('b')[0]);
  }finally{r.clearScene();}
});

test('mixed restoration and fresh append reserve retired depth intervals before allocating new slots',()=>{
  const r=renderer(),doc=drawing();doc.sharedBlocks.shape.entities=[line('a',0),line('b',20)];
  try{
    r.setDocument(doc,1,.02);
    const retired={...G.translate(doc.entities[0],100,0),id:'retired'},withRetired={...doc,entities:[...doc.entities,retired]};
    r.setDocument(withRetired,2,.02,{previousDoc:doc,previousRevision:1,lightweight:true,removed:[],added:[retired]});
    const depths=[...r.sourcePrimitiveDepths.get(retired.id)];
    r.setDocument(doc,3,.02,{previousDoc:withRetired,previousRevision:2,lightweight:true,removed:[retired],added:[]});
    const fresh={...G.translate(doc.entities[0],200,0),id:'fresh'},edit={previousDoc:doc,previousRevision:3,lightweight:true,removed:[],added:[retired,fresh]};
    assert.equal(r.tryEdit({...doc,entities:[...doc.entities,fresh,retired]},4,.02,edit),false,'fresh append cannot precede an older retired interval');
    const next={...doc,entities:[...doc.entities,retired,fresh]};r.setDocument(next,4,.02,edit);
    assert.equal(r.stats.builds,1);assert.deepEqual(r.sourcePrimitiveDepths.get(retired.id),depths);
    assert.ok(r.sourcePrimitiveDepths.get(fresh.id)[0]>depths.at(-1));
    assert.equal(r.nextTopZ,r.sourcePrimitiveDepths.get(fresh.id).at(-1));
  }finally{r.clearScene();}
});


test('COW membership validation rejects omitted, duplicate and mismatched delta members',()=>{
  const a=line('a',0),b=line('b',20),copy=line('copy',40),moved={...a,points:[p(5,0),p(15,10)]};
  for(const [after,removed,added] of [
    [[a,b,copy],[],[copy]],[[moved,b],[a],[moved]],[[b],[a],[]],[[a,b],[],[]],
    [[a,b],[a],[a]],[[a,b,copy],[a],[a,copy]],
  ])assert.ok(validateGpuEditMembership([a,b],after,removed,added));
  for(const [after,removed,added] of [
    [[a,b,copy],[],[]],[[b],[],[]],[[moved,b],[],[moved]],
    [[moved,b],[a],[]],[[a,b],[a],[]],[[a,b],[],[copy]],
    [[a,b,copy],[],[copy,copy]],[[b],[a,a],[]],[[a,b,b],[],[]],
    [[a,b,copy,copy],[],[copy]],[[moved,moved,b],[a],[moved]],
    [[a,moved,b],[a],[moved]],[[a,a,b],[a],[a]],
    [[moved,b],[{...a}],[moved]],[[a,b,copy],[],[{...copy}]],
  ])assert.equal(validateGpuEditMembership([a,b],after,removed,added),null);
  assert.equal(validateGpuEditMembership([a,a],[a],[a],[]),null);
});

test('COW membership indexes actual additions and retains order positions across randomized exact deltas',()=>{
  let seed=1907;const random=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;};
  for(let round=0;round<250;round++){
    const before=Array.from({length:100},(_,i)=>line(String(i),i));const removed=[],added=[],after=[];
    for(const entity of before){const chance=random();if(chance<.2){removed.push(entity);if(chance<.1){const replacement={...entity,points:[p(1,2),p(3,4)]};added.push(replacement);after.push(replacement);}}else after.push(entity);}
    const copy=line('copy',200);added.push(copy);after.push(copy);
    const result=validateGpuEditMembership(before,after,removed,added);assert.ok(result);
    assert.equal(result.newById.size,added.length);
    before.forEach((entity,index)=>assert.equal(result.oldOrder.get(entity.id),index));
    for(const entity of added)assert.equal(result.newById.get(entity.id),entity);
    assert.equal(validateGpuEditMembership(before,after,removed,added.slice(1)),null);
  }
});
