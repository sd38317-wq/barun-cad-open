import test from 'node:test';
import assert from 'node:assert/strict';
import {preparePlanSite,planPointToCad} from './plan-input.js';
const parcel = (id='a',dx=0) => ({id,type:'polyline',closed:true,parcelRole:'site',points:[{x:1000+dx,y:2000},{x:11000+dx,y:2000},{x:11000+dx,y:12000},{x:1000+dx,y:12000}]});
const edge = {ringIdx:0,index:2,confirmedWidthM:6,legalStatus:'confirmed'};
test('metres, north direction, ring order and reverse coordinates preserve CAD source',()=>{
 const entities=[parcel(),parcel('b',10000)];const before=JSON.stringify(entities);
 const result=preparePlanSite(entities,{roadEdges:[edge,{...edge,ringIdx:1,index:0}]});
 assert.deepEqual(result.blockers,[]);assert.deepEqual(result.site.ring[2],{x:10,z:10});
 assert.equal(result.site.extraRings[0][0].x,10);assert.equal(result.site.roadEdges[1].ringIdx,1);
 assert.deepEqual(planPointToCad(result.site.ring[2],result.transform),entities[0].points[2]);
 assert.equal(JSON.stringify(entities),before);
});
test('measured width never silently becomes confirmed width',()=>{
 const r=preparePlanSite([parcel()],{roadEdges:[{ringIdx:0,index:0,measuredWidthM:7}]});
 assert.equal(r.site,null);assert.equal(r.roadEvidence[0].confirmedWidthM,null);assert.equal(r.blockers.length,1);
});
test('holes survive conversion and block legacy payload',()=>{
 const hole={...parcel('hole'),attributes:{ring:'hole',polygon:0}};
 const r=preparePlanSite([parcel(),hole],{roadEdges:[edge]});
 assert.equal(r.holes.length,1);assert.equal(r.rings.length,1);assert.equal(r.site,null);
});
test('no road and extra-ring-only access do not default to primary edge zero',()=>{
 assert.equal(preparePlanSite([parcel()]).site,null);
 assert.equal(preparePlanSite([parcel(),parcel('b',10000)],{roadEdges:[{...edge,ringIdx:1}]}).site,null);
});
test('bad widths, duplicate edges and bad geometry fail explicitly',()=>{
 for(const confirmedWidthM of [0,-1,NaN,Infinity]) assert.throws(()=>preparePlanSite([parcel()],{roadEdges:[{...edge,confirmedWidthM}]}));
 assert.throws(()=>preparePlanSite([parcel()],{roadEdges:[edge,edge]}));
 assert.throws(()=>preparePlanSite([parcel()],{roadEdges:[{...edge,index:4}]}));
 assert.throws(()=>preparePlanSite([{...parcel(),closed:false}]));
});

test('direct width input preserves unknown legal evidence and explicit status still blocks',()=>{
 const input={ringIdx:0,index:0,confirmedWidthM:6},before=structuredClone(input);
 const direct=preparePlanSite([parcel()],{roadEdges:[input]});
 assert.ok(direct.site);assert.deepEqual(direct.blockers,[]);assert.equal(direct.roadEvidence[0].legalStatus,'unknown');assert.deepEqual(input,before);
 for(const legalStatus of ['unknown','not-road']){const r=preparePlanSite([parcel()],{roadEdges:[{...input,legalStatus}]});assert.equal(r.site,null);assert.equal(r.roadEvidence[0].legalStatus,legalStatus);assert.equal(r.blockers.length,1);}
});
