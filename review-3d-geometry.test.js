import test from 'node:test';
import assert from 'node:assert/strict';
import {floorName,floorHeight,floorElevation,floorFootprints} from './review-3d-geometry.js';
import * as G from './geometry.js';
const rect=(x,y,w,h)=>[{x,y},{x:x+w,y},{x:x+w,y:y+h},{x,y:y+h}];
test('floor names and cumulative sparse heights',()=>{
  assert.equal(floorName('A 2F walls'),'2F'); assert.equal(floorName('roof'),null);
  assert.equal(floorHeight('2F',{ '1F':4500 }),3000); assert.equal(floorElevation('3F',3000,{'1F':4500,'2F':3200}),7700);
  assert.equal(floorElevation('3F'),6000);
  assert.equal(floorName('0F'),null);assert.equal(floorName('12floor'),null);
  assert.equal(floorElevation('1000000000F',4000,{'1F':4500}),3999999996500);
  assert.equal(floorElevation('WALL_3F',4000),8000);
});
test('concave outlines, holes, hidden layers and disconnected footprints',()=>{
  const layers=[{id:'a',name:'1F',visible:true},{id:'b',name:'2F',visible:true},{id:'h',name:'3F',visible:false}];
  const conc=[{x:0,y:0},{x:5000,y:0},{x:5000,y:1000},{x:1000,y:1000},{x:1000,y:4000},{x:0,y:4000}];
  const doc={layers,entities:[{type:'polyline',closed:true,points:conc,layer:'a',loops:[rect(100,100,200,200)]},{type:'rectangle',points:rect(10000,0,2000,2000),layer:'a'},{type:'rectangle',points:rect(0,0,10,10),layer:'h'}]};
  const out=floorFootprints(doc); assert.equal(out.length,2); assert.equal(out[0].floor,'1F'); assert.equal(out.reduce((n,r)=>n+r.holes.length,0),1);assert.equal(out.reduce((n,r)=>n+G.polygonArea(r.points),0),12000000);
});
const wall=(a,b,layer='a')=>({type:'wall',layer,points:[{x:a[0],y:a[1]},{x:b[0],y:b[1]}],thickness:200,openings:[]});
test('four wall union fills enclosed room, preserves disjoint buildings and door spans',()=>{
 const doc={layers:[{id:'a',name:'1F',visible:true}],entities:[wall([0,0],[4000,0]),wall([4000,0],[4000,4000]),wall([4000,4000],[0,4000]),wall([0,4000],[0,0]),wall([10000,0],[14000,0])]};
 doc.entities[0].openings=[[.3,.7]];const before=JSON.stringify(doc),out=floorFootprints(doc);
 assert.equal(out.length,2);assert.ok(out.every(r=>r.holes.length===0));assert.ok(out.some(r=>G.inside({x:2000,y:2000},r.points)));assert.equal(JSON.stringify(doc),before);
});
test('wall union follows L concavity instead of a convex hull and includes inferred walls',()=>{
 const doc={layers:[{id:'a',name:'1F',visible:true}],entities:[wall([0,0],[4000,0]),wall([0,0],[0,4000])]};
 const out=floorFootprints(doc,{inferLayerWalls:()=>[rect(10000,0,4000,200)]});assert.equal(out.length,2);
 assert.ok(out.some(r=>G.inside({x:2000,y:0},r.points)));assert.ok(!out.some(r=>G.inside({x:2000,y:2000},r.points)));
});
test('closed outline wins over walls, drops nested room contours, traverses blocks and visibility',()=>{
 const doc={layers:[{id:'a',name:'WALL_1F',visible:true},{id:'b',name:'2F',visible:true,frozen:true},{id:'c',name:'notes',visible:true}],entities:[wall([-500,0],[6000,0]),{type:'rectangle',layer:'a',points:rect(0,0,5000,5000)},{type:'rectangle',layer:'a',points:rect(1000,1000,2000,2000)},{type:'block',layer:'c',entities:[{type:'rectangle',layer:'a',points:rect(10000,0,2000,2000)}]},{type:'rectangle',layer:'b',points:rect(0,0,5000,5000)},{type:'rectangle',layer:'a',hidden:true,points:rect(20000,0,2000,2000)}]};
 const out=floorFootprints(doc);assert.equal(out.length,2);assert.ok(out.every(r=>r.floor==='1F'));assert.equal(out.reduce((sum,r)=>sum+G.polygonArea(r.points),0),29000000);
});
test('walls are fallback full outlines and doors do not split them',()=>{
  const doc={layers:[{id:'a',name:'1F'}],entities:[{type:'wall',layer:'a',points:[{x:0,y:0},{x:4000,y:0}],thickness:200,openings:[[.3,.7]]}]};
  const out=floorFootprints(doc); assert.equal(out.length,1); assert.equal(out[0].points.length,4);
});
test('room contour does not replace the building external wall outline',()=>{
 const doc={layers:[{id:'a',name:'1F',visible:true}],entities:[wall([0,0],[10000,0]),wall([10000,0],[10000,10000]),wall([10000,10000],[0,10000]),wall([0,10000],[0,0]),{type:'rectangle',layer:'a',points:rect(3000,3000,4000,4000)}]};
 const out=floorFootprints(doc);assert.equal(out.length,1);assert.ok(G.inside({x:1000,y:1000},out[0].points));assert.ok(G.polygonArea(out[0].points)>100000000);
});
test('inferred external wall ring is still calculated when a closed room exists',()=>{
 const doc={layers:[{id:'a',name:'1F',visible:true}],entities:[{type:'rectangle',layer:'a',points:rect(3000,3000,4000,4000)}]};let calls=0;
 const out=floorFootprints(doc,{inferLayerWalls:()=>{calls++;return [rect(-100,-100,10200,200),rect(-100,9900,10200,200),rect(-100,-100,200,10200),rect(9900,-100,200,10200)];}});
 assert.equal(calls,1);assert.equal(out.length,1);assert.equal(G.polygonArea(out[0].points),104040000);
});
