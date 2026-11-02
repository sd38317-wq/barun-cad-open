import test from 'node:test';
import assert from 'node:assert/strict';
import {DrawingEngine} from './engine.js';
import * as G from './geometry.js';
test('connected wall corners meet and omit internal end caps; undo restores end',()=>{
 const e=new DrawingEngine();const add=(a,b)=>e.execute({type:'addMany',entities:[{type:'wall',layer:'default',points:[a,b],thickness:200,openings:[]}]});
 add({x:0,y:0},{x:1000,y:0});add({x:1000,y:0},{x:1000,y:1000});
 const [a,b]=e.doc.entities;assert.deepEqual(a.joins.end,b.joins.start);
 assert.deepEqual(a.joins.end,[{x:900,y:100},{x:1100,y:-100}]);
 assert.equal(G.primitives(a).length,3);assert.equal(G.primitives(b).length,3);
 assert.equal(e.doc.layers.find(l=>l.id===a.layer).color,'#ffff00');
 e.execute({type:'undo'});assert.equal(G.primitives(e.doc.entities[0]).length,4);
});
