import test from 'node:test';
import assert from 'node:assert/strict';
import {layoutCandidates} from './architecture.js';
import {DrawingEngine} from './engine.js';
test('alternative insertion and undo preserve the original drawing',()=>{
 const engine=new DrawingEngine(),before=structuredClone(engine.doc);
 engine.execute({type:'design.add',name:'A안',points:[{x:0,y:0},{x:10,y:0},{x:10,y:10},{x:0,y:10}]});
 assert.equal(engine.doc.layers.find(l=>l.id===engine.doc.entities[0].layer).name,'배치_A안');
 engine.execute({type:'undo'});assert.deepEqual(engine.doc,before);
});
test('layer organization keeps design alternative layers separate',()=>{
 const engine=new DrawingEngine();
 for(const name of ['A안','B안'])engine.execute({type:'design.add',name,points:[{x:0,y:0},{x:10,y:0},{x:10,y:10},{x:0,y:10}]});
 const layers=engine.doc.entities.map(e=>e.layer);
 engine.execute({type:'layer.organize'});
 assert.deepEqual(engine.doc.entities.map(e=>e.layer),layers);
 assert.notEqual(layers[0],layers[1]);
});
test('two distinct footprints preserve boundary clearance',()=>{
 const site=[{x:0,y:0},{x:20000,y:0},{x:20000,y:20000},{x:0,y:20000}];
 const plans=layoutCandidates(site,{width:5000,depth:6000,clearance:1000});
 assert.equal(plans.length,2);assert.equal(plans[0].area,30);
 for(const p of plans)for(const v of p.points)assert.ok(v.x>=1000&&v.y>=1000&&v.x<=19000&&v.y<=19000);
});
test('oversized building is rejected',()=>{
 assert.throws(()=>layoutCandidates([{x:0,y:0},{x:100,y:0},{x:100,y:100},{x:0,y:100}],{width:200,depth:200}));
});
test('concave notch cannot be covered even when outer corners are inside',()=>{
 const site=[{x:0,y:0},{x:100,y:0},{x:100,y:100},{x:60,y:100},{x:60,y:40},{x:40,y:40},{x:40,y:100},{x:0,y:100}];
 assert.throws(()=>layoutCandidates(site,{width:100,depth:100,clearance:0}));
 const plans=layoutCandidates(site,{width:20,depth:20,clearance:0});
 for(const plan of plans){const [p]=plan.points;assert.ok(p.x+20<=40||p.x>=60||p.y+20<=40);}
});
