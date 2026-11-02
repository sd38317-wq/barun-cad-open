import test from 'node:test';
import assert from 'node:assert/strict';
import {DrawingEngine} from './engine.js';
import {prepareSharedDrawingReferences,visibleEntities,materializeSharedDrawingReference,materializeSharedDrawingReferences,vertices,spatialIndex,resolveSharedDrawingReference,transformEntity} from './geometry.js';

test('display transforms match independent editable expansion for nested geometry and metadata',()=>{
 const points=[{x:1,y:2},{x:5,y:3},{x:2,y:7}];
 const primitives=[
  {type:'polyline',points,closed:true,constantWidth:2,metadata:{tags:['original']}},
  {type:'ellipse',center:{x:3,y:4},majorAxis:{x:5,y:2},ratio:.3,startParam:.2,endParam:4},
  {type:'arc',center:{x:2,y:4},radius:5,startAngle:15,endAngle:180},
  {type:'hatch',loops:[points],patternLines:[{base:{x:1,y:2},angle:45,offset:{x:0,y:3},dashes:[2,-1]}],patternScale:2},
  {type:'text',position:{x:2,y:3},height:4,rotation:12,text:'검수',attributes:{width:2},model3d:{height:3}},
  {type:'dimension',points,mode:'horizontal',textPosition:{x:4,y:8},textHeight:2},
  {type:'block',position:{x:1,y:2},entities:[{type:'line',points:[{x:0,y:0},{x:2,y:2}]}],parameters:{kind:'INSULATION',path:points,width:3,rotation:20},clip:{enabled:true,points},table:{height:5,widths:[1,2],rows:[['A']]},xref:{x:1,y:2,scale:1,rotation:10}},
  {type:'line',points:points.slice(0,2),aci:8,color:'#808080',colorMode:'aci',sourceHandle:'443B',linetype:'DASHED',lineweight:.25,linetypeScale:2},
  {type:'line',points:points.slice(0,2),metadata:{tags:['line']},center:{x:2,y:3},radius:4,clip:{enabled:true,points},height:2},
 ].map((e,i)=>({...e,id:'primitive-'+i,layer:'default'}));
 const definitions={inner:{origin:{x:1,y:1},entities:primitives},outer:{origin:{x:2,y:-3},entities:[{id:'nested',type:'block',sharedBlock:'inner',position:{x:10,y:20},rotation:37,scale:-2,entities:[]}]}};
 const before=structuredClone(definitions),strip=value=>Array.isArray(value)?value.map(strip):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).filter(([key])=>key!=='id').map(([key,v])=>[key,strip(v)])):value;
 for(const scale of [1,2,-3]){
  const source={id:'ref',type:'block',sharedBlock:'outer',position:{x:100,y:200},rotation:63,scale,entities:[]},doc={sharedBlocks:definitions};
  const display=resolveSharedDrawingReference(doc,source),editable=materializeSharedDrawingReference(doc,source);
  assert.deepEqual(strip(display),strip(editable));
  const leaves=display.entities[0].entities;
  leaves[0].points[0].x=999;leaves[0].metadata.tags[0]='changed';
  leaves[3].loops[0][0].x=999;leaves[3].patternLines[0].dashes[0]=999;
  leaves[4].attributes.width=999;leaves[4].model3d.height=999;
  leaves[7].points[0].x=999;
  assert.deepEqual(definitions,before,'display mutations must never alter shared source data');
  const next=resolveSharedDrawingReference({sharedBlocks:definitions},{...source,id:'next'});
  assert.deepEqual(strip(next),strip(editable),'one instance must not contaminate subsequent expansion');
 }
});

test('public transforms still isolate source coordinates from a mutating callback',()=>{
 const entity={type:'polyline',points:[{x:1,y:2}],metadata:{tags:['source']}};
 const moved=transformEntity(entity,p=>{p.x+=10;return p;});
 assert.equal(entity.points[0].x,1);assert.equal(moved.points[0].x,11);
 moved.metadata.tags[0]='changed';assert.equal(entity.metadata.tags[0],'source');
});

test('edit snapshots reuse nested definition preparation while instances keep independent geometry and IDs',()=>{
 let reads=0;
 const definitions={inner:{origin:{x:0,y:0},entities:[{id:'line',type:'line',layer:'default',points:[{get x(){reads++;return 0;},y:0},{get x(){reads++;return 10;},y:0}]}]},unit:{origin:{x:0,y:0},entities:[{id:'nested',type:'block',name:'inner',sharedBlock:'inner',layer:'default',position:{x:0,y:0},scale:1,rotation:0,entities:[]}]}};
 const ref=(id,x)=>({id,type:'block',name:'unit',sharedBlock:'unit',layer:'default',position:{x,y:0},scale:1,rotation:0,entities:[]});
 const a=ref('a',0),b=ref('b',100),doc={sharedBlocks:definitions};
 const first=resolveSharedDrawingReference(doc,a);assert.ok(reads>0);reads=0;
 const second=resolveSharedDrawingReference({...doc},b);
 assert.equal(reads,0,'unchanged nested definitions must not be transformed again');
 const x=first.entities[0].entities[0],y=second.entities[0].entities[0];
 assert.notEqual(x.id,y.id);assert.notEqual(x.points,y.points);
 assert.deepEqual(y.points,[{x:100,y:0},{x:110,y:0}]);
 x.points[0].x=999;assert.equal(y.points[0].x,100);
 const changed=structuredClone(definitions);changed.inner.entities[0].points[0].x=5;
 const third=resolveSharedDrawingReference({sharedBlocks:changed},ref('c',200));
 assert.equal(third.entities[0].entities[0].points[0].x,205);
});

const layer={id:'default',name:'0',color:'#79d4ff',visible:true,locked:false,frozen:false,plot:true,lineweight:.25,linetype:'CONTINUOUS'};
const reference=(id,x=0)=>({id,type:'block',name:'UNIT',sharedBlock:'unit',layer:'default',position:{x,y:20},scale:2,rotation:90,entities:[]});
const drawing=()=>({version:3,units:'mm',linetypeScale:1,layers:[layer],blocks:[],entities:[reference('a',0),reference('b',100)],sharedBlocks:{unit:{origin:{x:1,y:2},entities:[{id:'definition-line',type:'line',layer:'default',points:[{x:1,y:2},{x:4,y:2}]}]}}});

test('imported shared block catalog inserts independent geometry with the legacy first-instance transform',()=>{
 const doc=drawing(),template=reference('catalog',10);
 template.entities=[{id:'attribute',type:'text',layer:'default',position:{x:10,y:22},height:1,text:'A'}];
 doc.blocks=[{...template}];delete doc.blocks[0].id;delete doc.blocks[0].type;delete doc.blocks[0].layer;
 const engine=new DrawingEngine();engine.execute({type:'load',document:doc});
 const [id]=engine.execute({type:'block.insert',name:'UNIT',layer:'default',position:{x:100,y:200},factor:3,angle:90});
 const inserted=engine.doc.entities.find(e=>e.id===id);
 assert.equal(inserted.sharedBlock,'unit');assert.equal(inserted.scale,6);assert.equal(inserted.rotation,180);
 assert.ok(Math.abs(inserted.position.x-40)<1e-9);assert.ok(Math.abs(inserted.position.y-230)<1e-9);
 materializeSharedDrawingReferences(engine.doc,[id]);
 const line=engine.doc.entities.find(e=>e.id===id).entities.find(e=>e.type==='line');
 assert.ok(Math.abs(line.points[0].x-40)<1e-9);assert.ok(Math.abs(line.points[1].x-22)<1e-9);
 assert.equal(engine.doc.entities[0].sharedBlock,'unit');assert.equal(engine.doc.blocks[0].entities[0].position.x,10);
 engine.execute({type:'undo'});assert.equal(engine.doc.entities.length,2);
});

test('compact shared references retain canonical form and receive transformed bounds',()=>{
  const doc=drawing();prepareSharedDrawingReferences(doc);
  assert.equal(doc.entities[0].sharedBlock,'unit');
  assert.deepEqual(doc.entities[0].entities,[]);
  const grip=vertices(doc.entities[0]);assert.ok(grip.every(p=>Math.abs(p.x)<1e-9));assert.deepEqual([...new Set(grip.map(p=>p.y))],[20,26]);
  assert.equal(JSON.stringify(doc).includes('_renderBounds'),false);
});

test('render resolution is temporary and does not expand the canonical document',()=>{
  const doc=drawing();prepareSharedDrawingReferences(doc);
  const shown=visibleEntities(doc,{inPlace:true,lodScale:10,lodPixels:1});
  assert.equal(shown[0].entities[0].type,'line');
  assert.equal(shown[0].sharedBlock,'unit');
  assert.equal(doc.entities[0].entities.length,0);
  assert.equal(doc.entities[1].entities.length,0);
});

test('materializing one reference leaves all other instances compact and independent',()=>{
  const doc=drawing();prepareSharedDrawingReferences(doc);materializeSharedDrawingReferences(doc,['a']);
  assert.equal(doc.entities[0].sharedBlock,undefined);
  assert.equal(doc.entities[0].entities[0].points[1].y,26);
  assert.equal(doc.entities[1].sharedBlock,'unit');
  assert.equal(doc.entities[1].entities.length,0);
  doc.entities[0].entities[0].points[0].x=999;
  assert.equal(doc.sharedBlocks.unit.entities[0].points[0].x,1);
});

test('v3 validation rejects missing, cyclic and zero-scale references',()=>{
  const engine=new DrawingEngine(),valid=drawing();engine.validate(valid);
  const missing=drawing();missing.entities[0].sharedBlock='missing';assert.throws(()=>engine.validate(missing),/공유 블록 참조 오류/);
  const cycle=drawing();cycle.sharedBlocks.unit.entities=[{id:'nested',type:'block',name:'UNIT',sharedBlock:'unit',layer:'default',position:{x:0,y:0},scale:1,rotation:0,entities:[]}];assert.throws(()=>engine.validate(cycle),/순환/);
  const zero=drawing();zero.entities[0].scale=0;assert.throws(()=>engine.validate(zero),/공유 블록 참조 오류/);
});

test('explicit editing materializes only its target and undo restores compact reference',()=>{
  const engine=new DrawingEngine();engine.execute({type:'load',document:drawing()});
  engine.execute({type:'shared.materialize',ids:['a']});
  assert.equal(engine.doc.entities[0].sharedBlock,undefined);
  assert.equal(engine.doc.entities[1].sharedBlock,'unit');
  engine.execute({type:'undo'});
  assert.equal(engine.doc.entities[0].sharedBlock,'unit');
  assert.equal(engine.doc.entities[0].entities.length,0);
  assert.equal(engine.doc.sharedBlocks.unit.entities[0].points[1].x,4);
});

// 세탁기를 옮기면 옆 문이 사라지던 결함: 편집 뒤 복사된 문서의 공유 참조가 화면 범위를 잃어 대형 도면 색인에서 빠졌다.
test('shared references keep their screen bounds after scoped and full-copy edits and undo',()=>{
  const engine=new DrawingEngine(),doc=drawing();prepareSharedDrawingReferences(doc);engine.validate(doc);engine.doc=doc;
  const boxes=()=>engine.doc.entities.map(e=>spatialIndex([e]).query({minX:-1e9,minY:-1e9,maxX:1e9,maxY:1e9}).length);
  engine.execute({type:'move',ids:['a'],dx:50,dy:0});
  assert.equal(engine.lastExecution.lightweight,true,'plain block move takes the scoped path');
  assert.deepEqual(boxes(),[1,1]);
  engine.execute({type:'review.settings',settings:{}});
  assert.equal(engine.lastExecution.lightweight,false);
  assert.deepEqual(boxes(),[1,1],'full copy restores bounds of every shared reference');
  engine.execute({type:'undo'});engine.execute({type:'undo'});
  assert.deepEqual(boxes(),[1,1]);
  assert.equal(JSON.stringify(engine.doc).includes('_renderBounds'),false);
});

test('block moves stay on the full path while a block schedule table exists',()=>{
  const engine=new DrawingEngine(),doc=drawing();
  doc.entities.push({id:'schedule',type:'block',name:'SCHEDULE',scheduleKind:'blocks',layer:'default',table:{rows:[['분류']],height:100},entities:[{id:'schedule-line',type:'line',layer:'default',points:[{x:0,y:0},{x:1,y:0}]}]});
  prepareSharedDrawingReferences(doc);engine.validate(doc);engine.doc=doc;
  engine.execute({type:'move',ids:['a'],dx:50,dy:0});
  assert.equal(engine.lastExecution.lightweight,false);
});

test('spatial index revives an entity restored by undo instead of indexing it twice',()=>{
  const a={id:'a',type:'line',layer:'default',points:[{x:0,y:0},{x:1,y:0}]},moved={...a,points:[{x:5,y:0},{x:6,y:0}]};
  const index=spatialIndex([a]),all={minX:-10,minY:-10,maxX:10,maxY:10};
  index.remove([a]).insert([moved]);assert.deepEqual(index.query(all).map(e=>e.points[0].x),[5]);
  index.remove([moved]).insert([a]);assert.deepEqual(index.query(all).map(e=>e.points[0].x),[0]);
});
