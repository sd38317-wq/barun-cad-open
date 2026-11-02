import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as G from './geometry.js';
const source=fs.readFileSync(new URL('./app.js',import.meta.url),'utf8');
const body=source.slice(source.indexOf('function boxCandidates('),source.indexOf('function pick(',source.indexOf('function boxCandidates(')));
function query(entities,box,layers=new Map()){
 const index=G.spatialIndex(entities),nearby=(p,t)=>index.query({minX:p.x-t,minY:p.y-t,maxX:p.x+t,maxY:p.y+t});nearby.objects=index;
 const context=vm.createContext({nearby,prepareNearbyIndexNow(){},layerMap:()=>layers});vm.runInContext(body,context);return [...context.boxCandidates(box)].map(e=>e.id).sort();
}
test('broadphase retains dimension whose stretch origin lies below rendered extension lines',()=>{
 const entity={id:'dim',type:'dimension',kind:'horizontal',points:[{x:0,y:0},{x:100,y:0},{x:0,y:100}],textHeight:2,extensionOffset:20};
 assert.deepEqual(query([entity],{minX:-1,maxX:50,minY:-1,maxY:1}),['dim']);
});
test('selection broadphase keeps boundary touches and excludes locked layers',()=>{
 const entities=[{id:'edge',layer:'open',type:'line',points:[{x:10,y:0},{x:10,y:5}]},{id:'locked',layer:'locked',type:'line',points:[{x:5,y:0},{x:5,y:5}]},{id:'outside',layer:'open',type:'line',points:[{x:11,y:0},{x:11,y:5}]}];
 assert.deepEqual(query(entities,{minX:0,maxX:10,minY:0,maxY:5},new Map([['locked',{locked:true}]])),['edge']);
});
