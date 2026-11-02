import test from 'node:test';
import assert from 'node:assert/strict';
import * as G from './geometry.js';

function fixture(extra=[]){
 const children=Array.from({length:1024},(_,i)=>({id:'line-'+i,type:'line',layer:'0',points:[{x:i*20,y:0},{x:i*20,y:10}]})).concat(extra);
 const root={id:'root',type:'block',sharedBlock:'unit',layer:'0',position:{x:0,y:0},scale:1,rotation:0,entities:[]};
 const doc={version:3,layers:[{id:'0',name:'0',visible:true,color:'#fff'}],sharedBlocks:{unit:{origin:{x:0,y:0},entities:children}},entities:[root]};
 G.prepareSharedDrawingReferences(doc);
 return {doc,display:G.visibleEntities(doc,{inPlace:true})[0]};
}
const ids=parts=>parts.map(part=>part.id);

test('first and separated aperture queries avoid traversing the immutable root child array',()=>{
 const {display}=fixture();assert.equal(Object.isFrozen(display),true);
 const boxes=[{minX:19,minY:1,maxX:21,maxY:3},{minX:15999,minY:2,maxX:16001,maxY:4}];
 const reference=G.spatialIndex(G.visiblePrimitives(display));
 const expected=boxes.map(box=>ids(reference.query(box)));
 const original=Array.prototype[Symbol.iterator];let fullChildIterations=0;
 Array.prototype[Symbol.iterator]=function(){if(this===display.entities)fullChildIterations++;return original.call(this);};
 let actual;
 try{actual=boxes.map(box=>ids(G.queryEntityPrimitives(display,box)));}finally{Array.prototype[Symbol.iterator]=original;}
 assert.deepEqual(actual,expected);assert.equal(fullChildIterations,0);
});

test('child broad phase retains nested arc centers, dimensions, clip and painter order',()=>{
 const extras=[
  {id:'arc',type:'arc',layer:'0',center:{x:-50,y:50},radius:40,startAngle:0,endAngle:20},
  {id:'nested',type:'block',layer:'0',entities:[{id:'nested-arc',type:'arc',layer:'0',center:{x:-500,y:500},radius:400,startAngle:0,endAngle:15}]},
  {id:'dim',type:'dimension',layer:'0',kind:'horizontal',points:[{x:100,y:100},{x:300,y:100},{x:100,y:180}],textHeight:3},
  {id:'clip',type:'block',layer:'0',entities:[{id:'cross',type:'line',layer:'0',points:[{x:-5,y:5},{x:15,y:5}]}],clip:{enabled:true,points:[{x:0,y:0},{x:10,y:0},{x:10,y:10},{x:0,y:10}]}},
 ];
 const {display}=fixture(extras),reference=G.spatialIndex(G.visiblePrimitives(display));
 for(const box of [{minX:-51,minY:49,maxX:-49,maxY:51},{minX:-501,minY:499,maxX:-499,maxY:501},{minX:90,minY:90,maxX:310,maxY:200},{minX:4,minY:4,maxX:6,maxY:6}]){
  assert.deepEqual(G.queryEntityPrimitives(display,box),reference.query(box));
 }
});

test('a replacement shared definition uses new child geometry',()=>{
 const {doc,display}=fixture();
 const changed={...doc,sharedBlocks:{unit:{...doc.sharedBlocks.unit,entities:doc.sharedBlocks.unit.entities.map(e=>G.translate(e,0,100))}},entities:doc.entities.map(e=>({...e}))};
 G.prepareSharedDrawingReferences(changed);const fresh=G.visibleEntities(changed,{inPlace:true,reuseDisplays:[display]})[0];
 const oldBox={minX:19,minY:1,maxX:21,maxY:3},newBox={minX:19,minY:101,maxX:21,maxY:103};
 assert.equal(G.queryEntityPrimitives(fresh,oldBox).length,0);
 assert.equal(G.queryEntityPrimitives(fresh,newBox).length,1);
 assert.equal(G.queryEntityPrimitives(display,oldBox).length,1);
});

test('drawing query removes only offscreen simple lines and preserves nonline painter order',()=>{
 const extra=[{id:'text',type:'text',layer:'0',position:{x:1e7,y:1e7},height:20,text:'TEXT'},{id:'wide',type:'polyline',layer:'0',constantWidth:100,points:[{x:2e7,y:0},{x:2e7,y:10}]}];
 const {display}=fixture(extra),box={minX:19,minY:1,maxX:21,maxY:3};
 const expected=display.entities.filter(e=>e===display.entities[1]||e.type!=='line');
 assert.deepEqual(G.queryDrawingChildren(display,box),expected);
 assert.equal(G.queryDrawingChildren(display,null),display.entities);
 const b=display._renderBounds;assert.equal(G.queryDrawingChildren(display,{minX:b.minX-1,minY:b.minY-1,maxX:b.maxX+1,maxY:b.maxY+1}),display.entities);
 const boundary=G.queryDrawingChildren(display,{minX:20,minY:0,maxX:20,maxY:0});assert.ok(boundary.some(e=>e===display.entities[1]));
});
