import test from 'node:test';
import assert from 'node:assert/strict';
import {CadGpuRenderer} from './gpu-renderer.js';

function records(linetype,closed=false){
 const r=Object.create(CadGpuRenderer.prototype);r.staticTemplateSources=new Set();
 const batches=new Map(),points=Array.from({length:70},(_,i)=>({x:i*3,y:i*4}));
 r.addSegments(batches,{sourceId:'source',linetype,color:'#ffffff'},points,closed,.25,1);
 return {batches:[...batches.values()],points};
}
test('continuous line records retain identical positions without unused path distances',()=>{
 const {batches,points}=records('CONTINUOUS',true),batch=batches[0];
 assert.equal(batch.dash.length,0);assert.ok(batch.records.length>1);
 assert.equal(batch.records.flatMap(r=>Array.from(r.distances)).length,0);
 const expected=[];for(let i=1;i<=points.length;i++){const a=points[i-1],b=points[i%points.length];expected.push(a.x,a.y,.25,b.x,b.y,.25);}
 assert.deepEqual(batch.records.flatMap(r=>Array.from(r.points)),expected);
});
test('dashed path distances remain continuous across chunks and the closing segment',()=>{
 const {batches,points}=records('DASHED',true),batch=batches[0];assert.ok(batch.dash.length);
 const distances=batch.records.flatMap(r=>Array.from(r.distances)),expected=[];let distance=0;
 for(let i=1;i<=points.length;i++){const a=points[i-1],b=points[i%points.length],next=distance+Math.hypot(b.x-a.x,b.y-a.y);expected.push(distance,next);distance=next;}
 assert.deepEqual(distances,expected);assert.equal(distances.length,batch.records.flatMap(r=>Array.from(r.points)).length/3);
});
