import test from 'node:test';import assert from 'node:assert/strict';import {DrawingEngine} from './engine.js';
const parcel=()=>({type:'polyline',closed:true,parcelRole:'site',points:[{x:0,y:0},{x:10000,y:0},{x:10000,y:10000}],attributes:{pnu:'2611010100100010001',ring:'outer'}});
test('new parcels are independently editable and follow role layer colors',()=>{
 const e=new DrawingEngine();const ids=e.execute({type:'parcel.import',entities:[parcel(),{...parcel(),parcelRole:'road',color:'#123456'}]});
 assert.equal(ids.length,2);assert.ok(e.doc.entities.every(x=>x.type==='polyline'&&!x.color));
 assert.equal(e.doc.layers.find(l=>l.id===e.doc.entities[0].layer).name,'A-SITE-BND');
 assert.equal(e.doc.layers.find(l=>l.id===e.doc.entities[1].layer).name,'A-SITE-ROAD');
 const road=structuredClone(e.doc.entities[1]);
 e.execute({type:'update',ids:[ids[0]],changes:{points:[{x:0,y:0},{x:9000,y:0},{x:10000,y:10000}],layer:e.doc.layers[0].id}});
 assert.equal(e.doc.entities[0].points[1].x,9000);assert.equal(e.doc.entities[0].parcelRole,'site');assert.deepEqual(e.doc.entities[1],road);
 e.execute({type:'undo'});assert.equal(e.doc.entities[0].points[1].x,10000);
});
test('parcel import creates editable layer atomically, edits and undo preserve original',()=>{const e=new DrawingEngine();const ids=e.execute({type:'parcel.import',block:true,entities:[parcel()]});assert.equal(e.doc.layers.length,2);assert.equal(e.doc.layers[1].locked,false);e.execute({type:'move',ids,dx:500,dy:0});assert.equal(e.doc.entities[0].entities[0].points[0].x,500);e.execute({type:'undo'});assert.equal(e.doc.entities[0].entities[0].points[0].x,0);e.execute({type:'undo'});assert.equal(e.doc.entities.length,0);assert.equal(e.doc.layers.length,1);});
test('invalid parcel batch leaves no partial layers or entities',()=>{const e=new DrawingEngine();assert.throws(()=>e.execute({type:'parcel.import',entities:[parcel(),{...parcel(),parcelRole:'bad'}]}));assert.equal(e.doc.layers.length,1);assert.equal(e.doc.entities.length,0);});


test('parcel block carries site and road together; planning reads moved boundaries without exploding',async()=>{
 const {preparePlanSite}=await import('./plan-input.js');const e=new DrawingEngine();const road={...parcel(),parcelRole:'road',points:[{x:0,y:-5000},{x:10000,y:-5000},{x:10000,y:0}]};
 const ids=e.execute({type:'parcel.import',block:true,entities:[parcel(),road]});assert.equal(ids.length,1);assert.equal(e.doc.entities[0].type,'block');assert.equal(e.doc.entities[0].entities.length,2);
 const before=preparePlanSite(e.doc.entities);e.execute({type:'move',ids,dx:5000,dy:2000});const after=preparePlanSite(e.doc.entities);
 assert.deepEqual(after.rings[0].points,before.rings[0].points);assert.equal(after.roadGeometry.length,1);assert.equal(e.doc.entities[0].entities[1].points[0].x,5000);
 e.execute({type:'undo'});assert.equal(e.doc.entities[0].entities[1].points[0].x,0);
});
