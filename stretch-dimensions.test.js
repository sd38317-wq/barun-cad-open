import test from 'node:test';
import assert from 'node:assert/strict';
import {DrawingEngine} from './engine.js';
import * as G from './geometry.js';
const p=(x,y)=>({x,y});
function drawing(){const engine=new DrawingEngine();const ids=engine.execute({type:'addMany',entities:[
 {type:'line',layer:'default',points:[p(0,0),p(1000,0)]},
 {type:'dimension',layer:'default',points:[p(0,0),p(1000,0),p(0,200)],mode:'horizontal',textHeight:100},
 {type:'dimension',layer:'default',points:[p(1000,0),p(2000,0),p(0,400)],mode:'horizontal',textHeight:100},
 {type:'dimension',layer:'default',points:[p(0,100),p(1000,100),p(0,600)],mode:'horizontal',textHeight:100}
]});return {engine,ids};}
const label=e=>G.dimensionParts(e).at(-1).text;
test('STRETCH updates connected chain dimensions outside crossing window and matches preview',()=>{
 const {engine,ids}=drawing(),targets=[{id:ids[0],indices:[1]}],before=structuredClone(engine.doc);
 const preview=G.stretchEntities(engine.doc.entities,targets,p(100,0));
 engine.execute({type:'stretch',targets,dx:100,dy:0});
 assert.equal(label(engine.doc.entities[1]),'1100');assert.equal(label(engine.doc.entities[2]),'900');assert.equal(label(engine.doc.entities[3]),'1000');
 for(const e of preview)assert.deepEqual(engine.doc.entities.find(a=>a.id===e.id),e);
 engine.execute({type:'undo'});assert.deepEqual(engine.doc,before);engine.execute({type:'redo'});assert.equal(label(engine.doc.entities[1]),'1100');
});
test('explicit dimension selection does not move an associated endpoint twice',()=>{
 const {engine,ids}=drawing();engine.execute({type:'stretch',targets:[{id:ids[0],indices:[1]},{id:ids[1],indices:[1]}],dx:100,dy:0});
 assert.equal(engine.doc.entities[1].points[1].x,1100);
});
test('stretching both ends carries dimension line placement once, preserving length',()=>{
 const {engine,ids}=drawing();engine.execute({type:'stretch',targets:[{id:ids[0],indices:[0,1]}],dx:100,dy:50});
 assert.deepEqual(engine.doc.entities[1].points,[p(100,50),p(1100,50),p(100,250)]);assert.equal(label(engine.doc.entities[1]),'1000');
});
test('locked attached dimensions reject whole stretch without modifying source',()=>{
 const {engine,ids}=drawing();engine.doc.layers.push({id:'locked',name:'잠김',color:'#ffffff',visible:true,locked:true});engine.doc.entities[1].layer='locked';const before=structuredClone(engine.doc);
 assert.throws(()=>engine.execute({type:'stretch',targets:[{id:ids[0],indices:[1]}],dx:100,dy:0}),/잠긴/);assert.deepEqual(engine.doc,before);
});
test('imported dimension scale and automatic text templates update, explicit labels remain explicit',()=>{
 const {engine,ids}=drawing();Object.assign(engine.doc.entities[1],{measurementScale:0.001,precision:3,textTemplate:'<> m'});
 engine.execute({type:'stretch',targets:[{id:ids[0],indices:[1]}],dx:100,dy:0});assert.equal(label(engine.doc.entities[1]),'1.1 m');
 engine.doc.entities[1].text='현장 확인';assert.equal(label(engine.doc.entities[1]),'현장 확인');
});
