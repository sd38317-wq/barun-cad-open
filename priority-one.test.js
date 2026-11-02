import test from 'node:test';import assert from 'node:assert/strict';import {DrawingEngine} from './engine.js';import {architecture,wallOpening,rebuildArchitecture,architectureSolids} from './architecture.js';import * as G from './geometry.js';import {tableBlock} from './studio.js';
const p=(x,y)=>({x,y});

test('line and circle grips edit geometry with undo',()=>{
 const e=new DrawingEngine();const [id]=e.execute({type:'add',entity:{type:'line',layer:'default',points:[p(0,0),p(100,0)]}});
 const line=e.doc.entities[0];e.execute(G.gripCommand(line,G.editingGrips(line)[1],p(100,80)));
 assert.deepEqual(e.doc.entities[0].points,[p(0,0),p(100,80)]);e.execute({type:'undo'});assert.deepEqual(e.doc.entities[0].points,[p(0,0),p(100,0)]);
 const [cid]=e.execute({type:'add',entity:{type:'circle',layer:'default',center:p(0,0),radius:20}});const circle=e.doc.entities.find(x=>x.id===cid);e.execute(G.gripCommand(circle,G.editingGrips(circle)[1],p(0,50)));assert.equal(e.doc.entities.find(x=>x.id===cid).radius,50);
});

test('opening width grip and wall stretch keep opening linked and undoable',()=>{
 const e=new DrawingEngine();e.execute({type:'add',entity:{type:'wall',layer:'default',points:[p(0,0),p(5000,0)],thickness:200,openings:[]}});const wall=e.doc.entities[0];e.execute({type:'add',entity:wallOpening('WINDOW',{width:1000,height:1200},wall,p(1000,0))});const opening=e.doc.entities[1];
 e.execute(G.gripCommand(opening,G.editingGrips(opening)[2],p(2500,700)));assert.equal(e.doc.entities[1].openingWidth,1500);assert.deepEqual(e.doc.entities[0].openingLinks[opening.id],[.2,.5]);
 e.execute({type:'stretch',targets:[{id:wall.id,indices:[1]}],dx:-5000,dy:5000});assert.ok(G.dist(e.doc.entities[1].position,p(0,1000))<1e-6);assert.equal(e.doc.entities[1].parameters.rotation,90);
 e.execute({type:'undo'});assert.deepEqual(e.doc.entities[1].position,p(1000,0));assert.equal(e.doc.entities[1].openingWidth,1500);
});

test('spatial index preserves original order and includes long crossing entities',()=>{
 const entities=Array.from({length:10000},(_,i)=>({id:String(i),type:'line',points:[p(i*10,0),p(i*10,100)]}));entities.push({id:'cross',type:'line',points:[p(-100000,50),p(100000,50)]});
 const found=G.spatialIndex(entities).query({minX:45,minY:40,maxX:65,maxY:60});assert.deepEqual(found.map(e=>e.id),['5','6','cross']);
});
test('window style/size edit rebuilds wall opening, preserves rotation and updates schedule atomically',()=>{
 const e=new DrawingEngine();e.execute({type:'add',entity:{type:'wall',layer:'default',points:[p(0,0),p(0,5000)],thickness:240,openings:[]}});const wall=e.doc.entities[0];e.execute({type:'add',entity:wallOpening('WINDOW',{width:1200,height:1500},wall,p(0,1000))});const id=e.doc.entities[1].id;e.execute({type:'add',entity:{...tableBlock([['test']]),scheduleKind:'blocks'}});
 e.execute({type:'architecture.update',ids:[id],changes:{width:1600,height:1800,style:'sliding'}});const window=e.doc.entities[1];assert.equal(window.parameters.rotation,90);assert.deepEqual(e.doc.entities[0].openingLinks[id],[.2,.52]);assert.equal(e.doc.entities[2].table.rows[1][3],1600);assert.equal(window.attributes.height,1800);e.execute({type:'undo'});assert.equal(e.doc.entities[1].attributes.width,1200);
});
test('parametric regeneration after move rotate mirror and scale preserves local frame',()=>{
 let e=architecture('DOOR',{width:900,depth:200,height:2100,style:'double'});e=G.translate(G.rotate(G.resize(e,p(0,0),2),p(0,0),35),300,400);e=G.mirror(e,p(0,0),p(0,1));const rebuilt=rebuildArchitecture(e,{});assert.equal(e.attributes.width,1800);const a=G.vertices(e),b=G.vertices(rebuilt);assert.equal(a.length,b.length);for(let i=0;i<a.length;i++)assert.ok(G.dist(a[i],b[i])<1e-6);assert.throws(()=>rebuildArchitecture(e,{width:0}));
});
test('floor height drives straight L and U stairs and matching 3D risers',()=>{
 for(const layout of ['straight','l','u']){const e=architecture('STAIR',{width:1200,floorHeight:3200,targetRiser:170,landing:1200,run:280,layout});assert.equal(e.parameters.count,19);assert.ok(Math.abs(e.parameters.count*e.parameters.riser-3200)<1e-8);assert.ok(architectureSolids(e).length>=18);const changed=rebuildArchitecture(e,{floorHeight:4000});assert.equal(changed.parameters.count,24);assert.ok(architectureSolids(changed).length>architectureSolids(e).length);}
});
test('angular dimensions recalculate after stretch and remain angular after mirror',()=>{
 const dim={id:'d',type:'dimension',mode:'angular',layer:'default',textHeight:100,points:[p(0,0),p(1000,0),p(0,1000),p(500,500)]};assert.equal(G.dimensionParts(dim).at(-1).text,'90°');assert.equal(G.dimensionParts(G.mirror(dim,p(0,0),p(0,1))).at(-1).text,'90°');const result=G.stretchEntities([dim,{id:'l',type:'line',points:[p(0,1000),p(0,2000)]}],[{id:'l',indices:[0]}],p(1000,0));assert.equal(G.dimensionParts(result.find(e=>e.id==='d')).at(-1).text,'45°');
});
test('stairs can follow global floor height and Undo restores the entire change',()=>{
 const e=new DrawingEngine();const [id]=e.execute({type:'add',entity:architecture('STAIR',{width:1200,floorHeight:3000,targetRiser:170,run:280,landing:1200,floorSource:'global'})});e.execute({type:'review.settings',settings:{floorHeight:3600}});assert.equal(e.doc.entities[0].parameters.count,22);e.execute({type:'undo'});assert.equal(e.doc.entities[0].parameters.floorHeight,3000);
});
