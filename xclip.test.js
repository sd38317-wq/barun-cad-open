import test from 'node:test';import assert from 'node:assert/strict';import {DrawingEngine} from './engine.js';import * as G from './geometry.js';import {plotSVG} from './plot.js';
import {crossing} from './view.js';
import {sheetJob} from './studio.js';
test('XCLIP preserves block geometry, follows moves, limits picking and plotting, and undo restores',()=>{
 const engine=new DrawingEngine();const [id]=engine.execute({type:'addMany',entities:[{type:'block',name:'test',layer:'default',entities:[{type:'line',layer:'default',points:[{x:0,y:0},{x:1000,y:0}]}]}]});const original=structuredClone(engine.doc.entities[0].entities);
 engine.execute({type:'xclip',ids:[id],points:G.rectangle({x:100,y:-100},{x:500,y:100})});assert.deepEqual(engine.doc.entities[0].entities,original);assert.equal(G.entityDistance(engine.doc.entities[0],{x:800,y:0}),Infinity);assert.equal(G.bounds(engine.doc.entities).maxX,500);assert.match(plotSVG(engine.doc,{fit:true}),/clip-path/);
 engine.execute({type:'move',ids:[id],dx:100,dy:200});assert.equal(engine.doc.entities[0].clip.points[0].x,200);engine.execute({type:'undo'});assert.equal(engine.doc.entities[0].clip.points[0].x,100);
 engine.execute({type:'xclip',ids:[id],operation:'off'});assert.equal(G.bounds(engine.doc.entities).maxX,1000);engine.execute({type:'xclip',ids:[id],operation:'delete'});assert.equal(engine.doc.entities[0].clip,undefined);
});
test('clipped interaction follows rotated and nested masks without hidden snap segments',()=>{
 const e={type:'block',clip:{enabled:true,points:G.rectangle({x:100,y:-100},{x:500,y:100})},entities:[{type:'line',points:[{x:0,y:0},{x:1000,y:0}]}]};
 assert.deepEqual(G.visiblePrimitives(e)[0].points,[{x:100,y:0},{x:500,y:0}]);
 assert.equal(crossing(e,{minX:700,maxX:900,minY:-10,maxY:10}),false);
 assert.equal(crossing(e,{minX:300,maxX:350,minY:-10,maxY:10}),true);
 const rotated=G.rotate(e,{x:0,y:0},90);assert.equal(crossing(rotated,{minX:-10,maxX:10,minY:700,maxY:900}),false);
 const nested={type:'block',entities:[e]};assert.equal(G.entityDistance(nested,{x:800,y:0}),Infinity);
 const curve={...e,entities:[{type:'circle',center:{x:0,y:0},radius:300}]};const arc=G.visiblePrimitives(curve)[0];assert.equal(arc.type,'arc');assert.equal(G.visiblePoint(arc,arc.center),false);
 const full={...e,clip:{enabled:true,points:G.rectangle({x:-400,y:-400},{x:400,y:400})},entities:curve.entities};assert.equal(G.visiblePrimitives(full)[0].type,'circle');
});
test('invalid mask is rejected without changing drawing or undo history',()=>{
 const engine=new DrawingEngine();const before=JSON.stringify(engine.doc);assert.throws(()=>engine.execute({type:'add',entity:{type:'block',name:'bad',layer:'default',clip:{enabled:true,points:[{x:0,y:0}]},entities:[{type:'line',layer:'default',points:[{x:0,y:0},{x:1,y:1}]}]}}));assert.equal(JSON.stringify(engine.doc),before);
});
test('sheet PDF job and per-sheet DXF preserve nested clipping and original text',()=>{
 const engine=new DrawingEngine();engine.execute({type:'add',entity:{type:'block',name:'clip',layer:'default',clip:{enabled:true,points:G.rectangle({x:100,y:0},{x:500,y:100})},entities:[{type:'text',layer:'default',position:{x:0,y:50},text:'ABCDEFG',height:100}]}});
 const job=sheetJob(engine.doc,[{number:'A-1',title:'clip'}]);assert.equal(job.sheets[0].entities[0].clip.enabled,true);assert.equal(job.sheets[0].entities[0].entities[0].text,'ABCDEFG');
 const clipped=G.clipToBounds(job.sheets[0].entities[0],{minX:200,minY:0,maxX:300,maxY:100})[0];assert.equal(clipped.entities[0].clip.enabled,true);assert.equal(clipped.clip.points[0].x,200);
});

