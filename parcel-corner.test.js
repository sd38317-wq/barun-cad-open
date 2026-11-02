import test from 'node:test';
import assert from 'node:assert/strict';
import {detectCornerCuts,statutoryCornerDistance,applyApprovedCornerCuts} from './parcel-corner.js';

const poly=(id,role,points)=>({id,type:'polyline',closed:true,points,parcelRole:role,attributes:{ring:'outer',pnu:id,jibun:id}});
test('statutory table returns 2, 3 and 4 metre cases',()=>{
 assert.equal(statutoryCornerDistance(6,6,89).distanceM,4);
 assert.equal(statutoryCornerDistance(6,5,89).distanceM,3);
 assert.equal(statutoryCornerDistance(5,5,89).distanceM,2);
 assert.equal(statutoryCornerDistance(6,6,100).distanceM,3);
 assert.equal(statutoryCornerDistance(8,5,80).distanceM,null);
 assert.equal(statutoryCornerDistance(6,6,120).distanceM,null);
});
test('detects two-road corner and applies only explicit approval',()=>{
 const site=poly('site','site',[{x:0,y:0},{x:10000,y:0},{x:10000,y:10000},{x:0,y:10000}]);
 const south=poly('south','road',[{x:-1000,y:-5000},{x:11000,y:-5000},{x:11000,y:0},{x:-1000,y:0}]);
 const west=poly('west','road',[{x:-5000,y:-1000},{x:0,y:-1000},{x:0,y:11000},{x:-5000,y:11000}]);
 const found=detectCornerCuts([site,south,west]);assert.equal(found.length,1);assert.equal(found[0].index,0);
 const untouched=applyApprovedCornerCuts([site,south,west],[{...found[0],distanceM:2,approved:false}]);assert.equal(untouched.applied,0);
 const done=applyApprovedCornerCuts([site,south,west],[{...found[0],distanceM:2,widths:[5,5],approved:true}]);
 assert.equal(done.applied,1);assert.equal(done.entities.find(e=>e.parcelRole==='site').points.length,5);
 assert.equal(done.entities.filter(e=>e.parcelRole==='corner-cut').length,2);assert.equal(done.entities.find(e=>e.parcelRole==='corner-cut'&&e.type==='hatch').angle,45);assert.ok(done.areaM2>0);
});
