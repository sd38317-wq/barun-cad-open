import test from 'node:test';
import assert from 'node:assert/strict';
import {DrawingEngine} from './engine.js';
const p=(x,y)=>({x,y});
test('fillet keeps clicked short sides and undo restores crossing lines',()=>{
 const e=new DrawingEngine();const ids=e.execute({type:'addMany',entities:[{type:'line',layer:'default',points:[p(-10,0),p(100,0)]},{type:'line',layer:'default',points:[p(0,-10),p(0,100)]}]});const before=structuredClone(e.doc.entities);
 e.execute({type:'fillet',ids,size:0,pickPoints:{[ids[0]]:p(-5,0),[ids[1]]:p(0,-5)}});
 assert.deepEqual(e.doc.entities.map(x=>x.points),[[p(-10,0),p(0,0)],[p(0,0),p(0,-10)]]);e.execute({type:'undo'});assert.deepEqual(e.doc.entities,before);
});

