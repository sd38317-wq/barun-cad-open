import test from 'node:test';
import assert from 'node:assert/strict';
import {CadGpuRenderer,fastGpuEditMembership} from './gpu-renderer.js';
import {THREE} from './vendor/mlightcad.js';
import {DrawingEngine,blankDocument} from './engine.js';
import {retainVisibleEntities} from './viewport-visibility.js';
import * as G from './geometry.js';

// Ordinary edits of a large drawing (annotation layer creation, layer on/off,
// property changes, INSERT/EXPLODE/BLOCK/ARRAY/STRETCH and their undo) keep
// the engine's copy-on-write path, so every display cache follows a delta.
const p=(x,y)=>({x,y});
const line=(id,x,layer='0')=>({id,type:'line',layer,points:[p(x,0),p(x+10,10)]});
const layer=(id,name,extra={})=>({id,name,color:'#ffffff',visible:true,locked:false,lineweight:.25,linetype:'CONTINUOUS',...extra});
function drawing(){
  return {version:2,units:'mm',layers:[layer('0','0'),layer('dim','DIM'),layer('wall','WALL')],blocks:[{name:'B',entities:[line('b1',0,'dim'),line('b2',5,'0')]}],
    entities:[line('a',0,'wall'),line('b',20,'dim'),{id:'blk',type:'block',name:'B',layer:'wall',entities:[line('c1',40,'dim'),line('c2',50,'wall')]},line('d',60,'0')]};
}
function engineWith(doc){const engine=new DrawingEngine();engine.doc=doc;engine.validate(engine.doc);return engine;}
const snapshot=doc=>JSON.stringify(doc);

test('layer on/off, freeze and colour are layer-only edits that keep every object and undo exactly',()=>{
  const engine=engineWith(drawing()),before=engine.doc,frozen=snapshot(before);
  engine.execute({type:'layer.update',id:'dim',changes:{visible:false}});
  assert.equal(engine.lastExecution.layerOnly,true);assert.equal(engine.lastExecution.lightweight,true);
  assert.ok(engine.doc.entities.every((e,i)=>e===before.entities[i]),'objects are shared with history');
  assert.equal(engine.doc.layers.find(l=>l.id==='dim').visible,false);
  assert.equal(snapshot(before),frozen,'the history snapshot is untouched');
  engine.execute({type:'undo'});assert.equal(engine.doc,before);assert.equal(snapshot(engine.doc),frozen);
  assert.throws(()=>engine.execute({type:'layer.update',id:'dim',changes:{color:'red'}}),/레이어/);
  assert.equal(engine.doc,before,'an invalid layer table is rejected and the document kept');
});

test('property changes are copy-on-write: history keeps the old objects, undo restores them',()=>{
  const engine=engineWith(drawing()),before=engine.doc,frozen=snapshot(before);
  engine.execute({type:'update',ids:['b','blk'],changes:{color:'#ff0000'}});
  assert.equal(engine.lastExecution.scopedEdit,true);
  assert.equal(snapshot(before),frozen);
  const changed=engine.doc.entities.filter((e,i)=>e!==before.entities[i]).map(e=>e.id);
  assert.deepEqual(changed,['b','blk']);
  assert.equal(engine.doc.entities[2].entities,before.entities[2].entities,'unchanged children stay shared');
  engine.execute({type:'updateMany',updates:[{id:'a',changes:{layer:'dim'}},{id:'a',changes:{linetypeScale:2}}]});
  assert.equal(engine.doc.entities[0].layer,'dim');assert.equal(engine.doc.entities[0].linetypeScale,2);
  engine.execute({type:'undo'});engine.execute({type:'undo'});
  assert.equal(engine.doc,before);assert.equal(snapshot(engine.doc),frozen);
  // Linking changes keep the full synchronization path.
  engine.execute({type:'update',ids:['b'],changes:{hostWall:'x'}});assert.equal(engine.lastExecution.lightweight,false);
});

test('INSERT, EXPLODE, BLOCK, ARRAY and STRETCH take the scoped path without a block schedule and undo exactly',()=>{
  const engine=engineWith(drawing()),frozen=snapshot(engine.doc);const docs=[engine.doc];
  for(const command of [
    {type:'block.insert',name:'B',layer:'0',position:p(100,0)},
    {type:'explode',ids:['blk']},
    {type:'block.create',ids:['a','b'],name:'NEW',base:p(0,0)},
    {type:'array',ids:['d'],rows:2,columns:2,dx:100,dy:100},
    {type:'stretch',targets:[{id:'d',indices:[1]}],dx:5,dy:0},
  ]){
    const previous=engine.doc,old=snapshot(previous);
    engine.execute(command);
    assert.equal(engine.lastExecution.lightweight,true,command.type);
    assert.equal(snapshot(previous),old,command.type+' leaves history untouched');
    docs.push(engine.doc);
  }
  assert.ok(engine.doc.blocks.some(b=>b.name==='NEW'));assert.ok(!docs[0].blocks.some(b=>b.name==='NEW'));
  for(let i=docs.length-1;i>0;i--){engine.execute({type:'undo'});assert.equal(engine.doc,docs[i-1]);}
  assert.equal(snapshot(engine.doc),frozen);
  // A block schedule reads block references: those commands synchronize fully.
  const scheduled=engineWith({...drawing(),entities:[...drawing().entities,{id:'t',type:'block',name:'SCHEDULE',layer:'0',scheduleKind:'blocks',table:{rows:[['a']],height:10},entities:[line('t1',0)]}]});
  scheduled.execute({type:'block.insert',name:'B',layer:'0',position:p(100,0)});assert.equal(scheduled.lastExecution.lightweight,false);
});

test('MIRROR keeping its source leaves a shared reference shared and mirrors a materialized copy',()=>{
  const base=blankDocument();
  const doc={...base,version:3,sharedBlocks:{S:{origin:p(0,0),entities:[line('a',0,'default'),{id:'t',type:'text',layer:'default',text:'A',position:p(1,1),height:2}]}},entities:[{id:'r',type:'block',name:'S',sharedBlock:'S',layer:'default',position:p(10,0),scale:1,rotation:0,entities:[]}]};
  G.prepareSharedDrawingReferences(doc);const engine=engineWith(doc),before=engine.doc;
  engine.execute({type:'mirror',ids:['r'],a:p(0,0),b:p(0,10)});
  assert.equal(engine.lastExecution.lightweight,true);
  assert.equal(engine.doc.entities[0],before.entities[0],'the source reference is kept as it was');
  const copy=engine.doc.entities[1];assert.ok(!copy.sharedBlock);assert.equal(copy.entities.length,2);
  const legacy=G.mirror(G.materializeSharedDrawingReference(before,before.entities[0]),p(0,0),p(0,10));
  assert.deepEqual(copy.entities.map(e=>e.points||e.position),legacy.entities.map(e=>e.points||e.position));
  engine.execute({type:'undo'});assert.equal(engine.doc,before);
});

test('display layer changes and the objects reading them (children and shared definitions included)',()=>{
  const doc=drawing();
  const changed=G.changedDisplayLayers(doc.layers,doc.layers.map(l=>l.id==='dim'?{...l,visible:false}:l));
  assert.deepEqual([...changed],['dim']);
  // ACAD200 705: 잠금은 이제 화면에 보인다(LAYLOCKFADECTL 흐리게) → 그 레이어만 바뀐 것으로 본다(도면 전체가 아니라 그 레이어 객체만 다시 그림).
  assert.deepEqual([...G.changedDisplayLayers(doc.layers,doc.layers.map(l=>l.id==='wall'?{...l,locked:true}:l))],['wall'],'a lock re-displays only its own layer');
  assert.deepEqual(G.entitiesUsingLayers(doc,changed).map(e=>e.id),['b','blk']);
  assert.deepEqual([...G.changedDisplayLayers(doc.layers,[...doc.layers,layer('new','NEW')])],['new']);
  const shared={...doc,version:3,sharedBlocks:{S:{origin:p(0,0),entities:[{id:'n',type:'block',sharedBlock:'T',entities:[],layer:'0'}]},T:{origin:p(0,0),entities:[line('t',0,'dim')]}}};
  assert.equal(G.entityUsesLayers(shared.sharedBlocks,{id:'r',type:'block',sharedBlock:'S',layer:'wall',entities:[]},new Set(['dim'])),true,'nested definitions are followed');
  assert.equal(G.entityUsesLayers(shared.sharedBlocks,{id:'r',type:'block',sharedBlock:'S',layer:'wall',entities:[]},new Set(['new'])),false);
});

test('a retained shared display survives an unrelated layer change and is rebuilt for a layer it reads',()=>{
  const base=blankDocument();
  const children=Array.from({length:130},(_,i)=>line('s'+i,i,i%2?'dim':'default'));
  const doc={...base,version:3,layers:[...base.layers,layer('dim','DIM')],sharedBlocks:{S:{origin:p(0,0),entities:children}},entities:[{id:'r',type:'block',name:'S',sharedBlock:'S',layer:'default',position:p(0,0),scale:1,rotation:0,entities:[]}]};
  G.prepareSharedDrawingReferences(doc);
  const first=G.visibleEntities(doc,{inPlace:true})[0];
  const added={...doc,layers:[...doc.layers,layer('annotation','ANNOTATION')]};
  assert.equal(G.visibleEntities(added,{inPlace:true})[0],first,'an added unrelated layer keeps the expanded tree');
  const off={...doc,layers:doc.layers.map(l=>l.id==='dim'?{...l,visible:false}:l)};
  const hidden=G.visibleEntities(off,{inPlace:true})[0];
  assert.notEqual(hidden,first);assert.equal(hidden.entities.length,65);
});

function sharedPlan(){
  const base=blankDocument();
  const children=[...Array.from({length:130},(_,i)=>line('s'+i,i,i%3?'default':'dim')),
    {...line('byblock',1,'default'),colorMode:'byblock',linetype:'BYBLOCK'},{...line('own',2,'dim'),color:'#00ff00',linetypeScale:3},
    {id:'nested',type:'block',name:'N',layer:'default',entities:[line('n1',3,'default'),line('n2',4,'off')]},
    {id:'nestedShared',type:'block',name:'T',sharedBlock:'T',layer:'default',position:p(5,5),scale:1,rotation:0,entities:[]}];
  return {...base,version:3,layers:[...base.layers,layer('dim','DIM',{color:'#123456'}),layer('off','OFF',{visible:false}),layer('red','RED',{color:'#ff0000',linetype:'DASHED'})],
    sharedBlocks:{S:{origin:p(0,0),entities:children},T:{origin:p(0,0),entities:[line('t1',0,'default'),{...line('t2',1,'default'),colorMode:'byblock'}]}},
    entities:[{id:'r',type:'block',name:'S',sharedBlock:'S',layer:'default',position:p(100,50),scale:2,rotation:30,entities:[]}]};
}
const shapeOf=nodes=>nodes.map(n=>({type:n.type,layer:n.layer,color:n._displayColor,linetype:n._displayLinetype,weight:n._displayLineweight,scale:n._displayLinetypeScale,points:n.points,position:n.position,bounds:n._renderBounds,children:n.type==='block'?shapeOf(n._visibleEntities||n.entities||[]):undefined}));

test('CHPROP and MOVE of a shared reference reuse its displayed tree and match a full expansion',()=>{
  for(const changes of [{color:'#ff00ff'},{layer:'red'},{colorMode:'byblock',color:'#00ffff',linetypeScale:2},{position:p(300,-20)}]){
    const doc=sharedPlan();G.prepareSharedDrawingReferences(doc);G.ensureSharedDrawingReferenceBounds(doc);
    const first=G.visibleEntities(doc,{inPlace:true})[0];
    const next={...doc,entities:[{...doc.entities[0],...structuredClone(changes)}]},probe={...doc,entities:[{...next.entities[0]}]};G.ensureSharedDrawingReferenceBounds(next);G.ensureSharedDrawingReferenceBounds(probe);
    const full=G.visibleEntities(probe,{inPlace:true})[0];
    const reused=G.visibleEntities(next,{inPlace:true,entities:next.entities,reuseDisplays:[first]})[0];
    assert.notEqual(reused,full);assert.ok(Object.getOwnPropertyDescriptor(reused,'entities').get,'children are resolved lazily from the displayed tree');
    assert.deepEqual(shapeOf([reused])[0].children.length,shapeOf([full])[0].children.length,JSON.stringify(changes));
    const normal=value=>JSON.parse(JSON.stringify(value,(k,v)=>typeof v==='number'?Math.round(v*1e6)/1e6:v));
    assert.deepEqual(normal(shapeOf([reused])),normal(shapeOf([full])),JSON.stringify(changes));
    assert.equal(G.visibleEntities(next,{inPlace:true})[0],reused,'a later full pass finds the reused tree');
  }
});

test('COPY/ARRAY of a rotated, scaled shared reference translates its displayed tree',()=>{
  const doc=sharedPlan();G.prepareSharedDrawingReferences(doc);G.ensureSharedDrawingReferenceBounds(doc);
  const first=G.visibleEntities(doc,{inPlace:true})[0];
  const copy={...structuredClone(doc.entities[0]),id:'copy',position:p(900,400)},next={...doc,entities:[doc.entities[0],copy]};
  const probe={...doc,entities:[{...copy,id:'copy'}]};G.ensureSharedDrawingReferenceBounds(next);G.ensureSharedDrawingReferenceBounds(probe);
  const full=G.visibleEntities(probe,{inPlace:true})[0];
  const reused=G.visibleEntities(next,{inPlace:true,entities:[copy],reuseDisplays:[first]})[0];
  assert.ok(Object.getOwnPropertyDescriptor(reused,'entities').get,'lazy translated copy');
  const normal=value=>JSON.parse(JSON.stringify(value,(k,v)=>typeof v==='number'?Math.round(v*1e6)/1e6:v));
  assert.deepEqual(normal(shapeOf([reused])),normal(shapeOf([full])));
});

test('a small shared reference, registered on demand, lends its tree to its ARRAY copies',()=>{
  const base=blankDocument();
  const doc={...base,version:3,sharedBlocks:{S:{origin:p(0,0),entities:[line('a',0,'default'),line('b',5,'default')]}},entities:[{id:'r',type:'block',name:'S',sharedBlock:'S',layer:'default',position:p(10,10),scale:1,rotation:15,entities:[]}]};
  G.prepareSharedDrawingReferences(doc);G.ensureSharedDrawingReferenceBounds(doc);
  const shown=G.visibleEntities(doc,{inPlace:true})[0];
  const copy={...structuredClone(doc.entities[0]),id:'c',position:p(110,10)},next={...doc,entities:[doc.entities[0],copy]};G.ensureSharedDrawingReferenceBounds(next);
  assert.ok(!Object.getOwnPropertyDescriptor(G.visibleEntities(next,{inPlace:true,entities:[copy],reuseDisplays:[shown]})[0],'entities').get,'unregistered: expanded again');
  assert.equal(G.registerSharedDisplay(doc,doc.entities[0],shown),true);assert.equal(G.registerSharedDisplay(doc,doc.entities[0],shown),false);
  const copy2={...copy,id:'c2'},next2={...doc,entities:[doc.entities[0],copy2]};G.ensureSharedDrawingReferenceBounds(next2);
  const reused=G.visibleEntities(next2,{inPlace:true,entities:[copy2],reuseDisplays:[shown]})[0];
  assert.ok(Object.getOwnPropertyDescriptor(reused,'entities').get,'registered: a lazy translated copy');
  const full=G.visibleEntities({...doc,entities:[{...copy2}]},{inPlace:true})[0];
  const round=value=>JSON.parse(JSON.stringify(value,(k,v)=>typeof v==='number'?Math.round(v*1e6)/1e6:v));
  assert.deepEqual(round(reused.entities.map(e=>e.points)),round(full.entities.map(e=>e.points)));
});

test('the visible cache follows an annotation layer addition and a layer toggle by delta',()=>{
  const doc=drawing(),cached=G.visibleEntities(doc,{inPlace:true});
  const tools={changedLayers:G.changedDisplayLayers,usesLayers:G.entityUsesLayers};
  const hatch={id:'h',type:'hatch',layer:'new',points:G.rectangle(p(0,0),p(5,5))};
  const withLayer={...doc,layers:[...doc.layers,layer('new','해치')],entities:[...doc.entities,hatch]};
  const resolve=d=>es=>G.visibleEntities(d,{inPlace:true,entities:es});
  const appended=retainVisibleEntities(doc,withLayer,cached,[],[hatch],resolve(withLayer),tools);
  assert.deepEqual(appended.map(e=>e.id),['a','b','blk','d','h']);
  const off={...doc,layers:doc.layers.map(l=>l.id==='dim'?{...l,visible:false}:l)};
  assert.equal(retainVisibleEntities(doc,off,cached,[],[],resolve(off),tools),null,'objects reading the layer must be part of the delta');
  const affected=G.entitiesUsingLayers(off,G.changedDisplayLayers(doc.layers,off.layers));
  const toggled=retainVisibleEntities(doc,off,cached,affected,affected,resolve(off),tools);
  const full=G.visibleEntities(off,{inPlace:true});
  assert.deepEqual(toggled.map(e=>[e.id,(e._visibleEntities||[]).length]),full.map(e=>[e.id,(e._visibleEntities||[]).length]));
});

function renderer(){
  const r=Object.create(CadGpuRenderer.prototype);
  Object.assign(r,{scene:new THREE.Scene(),stats:{builds:0,frames:0},canvasFactory:()=>({width:0,height:0,getContext:()=>({font:'',save(){},restore(){},beginPath(){},rect(){},clip(){},fillText(){},measureText(text){return {width:String(text).length*parseFloat(this.font)*.6};}})}),renderer:{subEntityTraits:{fillType:{}},
    lineSegments(values,size,indices){const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.BufferAttribute(values,size));geometry.setIndex(new THREE.BufferAttribute(indices,1));const group=new THREE.Group();group.add(new THREE.LineSegments(geometry,new THREE.LineBasicMaterial()));return group;},
    area(){const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute([0,0,0,10,0,0,10,10,0],3));const group=new THREE.Group();group.add(new THREE.Mesh(geometry,new THREE.MeshBasicMaterial()));return group;},
  }});return r;
}
const depthsOf=r=>Object.fromEntries([...r.sourceZ.keys()].sort().map(id=>[id,[...r.sourcePrimitiveDepths.get(id)]]));
const recordsOf=r=>[...r.lineBatches.values()].flatMap(batch=>batch.records.map(record=>record.sourceId+':'+record.points.length)).sort();

test('GPU: layer off/on and a new annotation layer are incremental edits with full-build order',()=>{
  const r=renderer(),engine=engineWith(drawing());
  try{
    r.setDocument(engine.doc,1,.02);const builds=r.stats.builds,depths=depthsOf(r),records=recordsOf(r);
    const redisplay=(before,after)=>{const changed=G.changedDisplayLayers(before.layers,after.layers),affected=G.entitiesUsingLayers(after,changed);return {removed:affected,added:affected};};
    let before=engine.doc;engine.execute({type:'layer.update',id:'dim',changes:{visible:false}});
    r.setDocument(engine.doc,2,.02,{previousDoc:before,previousRevision:1,lightweight:true,...redisplay(before,engine.doc)});
    assert.equal(r.stats.builds,builds,'no complete build');assert.equal(r.revision,2);
    assert.ok(!r.sourceZ.has('b'));assert.deepEqual(r.sourcePrimitiveDepths.get('blk'),depths.blk,'a partly hidden block keeps its slots');
    assert.ok(!recordsOf(r).some(x=>x.startsWith('b:')));
    before=engine.doc;engine.execute({type:'layer.update',id:'dim',changes:{visible:true}});
    r.setDocument(engine.doc,3,.02,{previousDoc:before,previousRevision:2,lightweight:true,...redisplay(before,engine.doc)});
    assert.equal(r.stats.builds,builds);assert.deepEqual(depthsOf(r),depths,'every primitive returns to its painter slot');
    assert.deepEqual(recordsOf(r),records);
    // A hatch on a newly created annotation layer.
    before=engine.doc;engine.execute({type:'add.classified',entities:[{type:'hatch',layer:'0',points:G.rectangle(p(0,0),p(5,5)),spacing:1,angle:45,solid:false}]});
    assert.equal(engine.lastExecution.appendOnly,true);assert.ok(engine.doc.layers.length>before.layers.length,'fixture creates the hatch layer');
    const hatch=engine.doc.entities.at(-1);
    r.setDocument(engine.doc,4,.02,{previousDoc:before,previousRevision:3,lightweight:true,removed:[],added:[hatch]});
    assert.equal(r.stats.builds,builds,'the new layer does not rebuild the drawing');assert.ok(r.sourceZ.get(hatch.id)>Math.max(...Object.values(depths).flat()));
  }finally{r.clearScene();}
});

test('GPU: a scene kept for a drawing tab returns for its document without a rebuild',()=>{
  const r=renderer(),doc=drawing();
  try{
    r.setDocument(doc,1,.02);const builds=r.stats.builds;
    r.restoredScene=true;r.setDocument(doc,7,.02);
    assert.equal(r.stats.builds,builds);assert.equal(r.revision,7);assert.equal(r.stats.restoredScenes,1);
    r.restoredScene=true;r.setDocument({...doc,entities:[...doc.entities]},8,.02);
    assert.equal(r.stats.builds,builds+1,'another document object is built');
  }finally{r.clearScene();}
});

test('a large worker result arrives in parts and is assembled in order',async()=>{
  const {GpuCompileClient}=await import('./gpu-compile-client.js');
  let worker;const posted=[];
  const client=new GpuCompileClient({onReady(){},createWorker:()=>worker={postMessage(message){posted.push(message);},terminate(){}}});
  let built=0;const doc={};
  assert.deepEqual(client.request(doc,1,'full',()=>{built++;return {job:true};}),{pending:true});
  assert.equal(built,1);assert.deepEqual(posted[0].job,{job:true});
  assert.deepEqual(client.request(doc,1,'full',()=>{built++;return {};}),{pending:true});assert.equal(built,1,'a pending job is not rebuilt');
  const id=posted[0].id;
  worker.onmessage({data:{id,part:[1,2]}});worker.onmessage({data:{id,part:[3]}});
  assert.equal(client.pending.result,null);
  worker.onmessage({data:{id,parts:true,result:{compiled:{items:null,unsupported:[]},origin:{x:0,y:0}}}});
  assert.deepEqual(client.pending.result.compiled.items,[1,2,3]);client.dispose();
});

test('GPU proof: an object removed and added by one edit is displayed again in place',()=>{
  const a=line('a',0),b=line('b',10),c=line('c',20),before=[a,b,c],index=new Map(before.map(e=>[e.id,e]));
  const proof=fastGpuEditMembership(before,[a,b,c],[b],[b],index);
  assert.ok(proof);assert.deepEqual([...proof.removedIds],['b']);
});
