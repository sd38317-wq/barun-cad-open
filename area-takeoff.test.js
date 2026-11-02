import test from 'node:test';
import assert from 'node:assert/strict';
import {areaTakeoffEntities,takeoffBoundary,triangulatePolygon} from './area-takeoff.js';
import {areaConversionChanges,convertAreaText} from './area-conversion.js';

test('rectangle takeoff splits into two triangles and preserves exact area',()=>{
 const points=[{x:0,y:0},{x:4000,y:0},{x:4000,y:3000},{x:0,y:3000}],triangles=triangulatePolygon(points);
 assert.equal(triangles.length,2);
 const result=areaTakeoffEntities(points,{layer:'area',textHeight:100,precision:3});
 assert.equal(result.areaM2,12);assert.equal(result.py,3.63);assert.match(result.rows.at(-1),/합계\s+12\.000 ㎡\s+\/\s+3\.630 평/);assert.ok(result.entities.some(e=>e.areaTakeoffSummary));
});

test('concave closed boundary produces n minus two triangles and matching total',()=>{
 const points=[{x:0,y:0},{x:4000,y:0},{x:4000,y:2000},{x:2000,y:2000},{x:2000,y:4000},{x:0,y:4000}];
 const result=areaTakeoffEntities(points);assert.equal(result.triangles.length,4);assert.equal(result.areaM2,12);
});

test('takeoff object selection accepts only a simple closed boundary',()=>{
 assert.equal(takeoffBoundary({type:'polyline',closed:true,points:[{x:0,y:0},{x:100,y:0},{x:0,y:100}]}).length,3);
 assert.throws(()=>takeoffBoundary({type:'polyline',closed:false,points:[{x:0,y:0},{x:100,y:0}]}),/닫힌/);
 assert.throws(()=>triangulatePolygon([{x:0,y:0},{x:100,y:100},{x:0,y:100},{x:100,y:0}]),/교차/);
});

test('area conversion changes only text value while keeping object appearance',()=>{
 assert.equal(convertAreaText('10 평','py-to-m2'),'33.0579 ㎡');assert.equal(convertAreaText('33.0579 ㎡','m2-to-py'),'10 평');
 assert.deepEqual(areaConversionChanges({type:'text',text:'2.5',height:200,rotation:30,layer:'a'},'py-to-m2'),{text:'8.2645'});
});
