import test from 'node:test';
import assert from 'node:assert/strict';
import {gpuRecordUploads} from './gpu-record-upload.js';
test('bounded uploads preserve exact coordinates and dash distances across record boundaries',()=>{
  const records=Array.from({length:53},(_,i)=>({points:Float64Array.from({length:6*(1+i%32)},(_,j)=>50000000+i+j/7),distances:Float64Array.from({length:2*(1+i%32)},(_,j)=>i+j/9)}));
  for(const limit of [6,30,192,180000]){
    const chunks=[...gpuRecordUploads(records,true,limit)];
    assert.deepEqual(chunks.flatMap(c=>Array.from(c.values)),records.flatMap(r=>Array.from(r.points)));
    assert.deepEqual(chunks.flatMap(c=>Array.from(c.distances)),records.flatMap(r=>Array.from(r.distances)));
    for(const c of chunks){assert.ok(c.values.length<=limit);assert.equal(c.values.length%6,0);assert.equal(c.distances.length,c.values.length/3);}
  }
});
test('uploads accept legacy arrays, skip empty records and omit continuous distances',()=>{
 const chunks=[...gpuRecordUploads([{points:[],distances:[]},{points:[1,2,3,4,5,6],distances:[]}],false)];
 assert.equal(chunks.length,1);assert.deepEqual([...chunks[0].values],[1,2,3,4,5,6]);assert.equal(chunks[0].distances,null);
 assert.deepEqual([...gpuRecordUploads([],false)],[]);
 assert.throws(()=>[...gpuRecordUploads([],false,7)],RangeError);
});
