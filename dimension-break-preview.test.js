import test from 'node:test';
import assert from 'node:assert/strict';
import {DrawingEngine} from './engine.js';
import {dimensionParts} from './geometry.js';
import {dimensionBreakPreviewScene,renderDimensionBreakPreview} from './dimension-break-preview.js';
const P=(x,y)=>({x,y});
function fixture(){const engine=new DrawingEngine();engine.execute({type:'addMany',entities:[{id:'dim',layer:'default',type:'dimension',mode:'horizontal',points:[P(0,0),P(100,0),P(0,20)],textHeight:3,arrowSize:1},{id:'cross',layer:'default',type:'line',points:[P(50,0),P(50,40)]},{id:'far',layer:'default',type:'line',points:[P(1000,0),P(1000,100)]}]});engine.doc.entities.forEach((e,i)=>e.id=['dim','cross','far'][i]);return engine.doc;}
test('result preview removes original target and paints real split geometry alongside crossing objects',()=>{
 const doc=fixture(),before=JSON.stringify(doc),changes=[{...doc.entities[0],breaks:[{partIndex:0,start:.45,end:.55}]}];
 const scene=dimensionBreakPreviewScene(doc,changes);
 assert.equal(scene.changes,changes);assert.equal(scene.surrounding.some(e=>e.id==='dim'),false);assert.deepEqual(scene.surrounding.map(e=>e.id),['cross']);
 const primary=dimensionParts(scene.changes[0]).filter(e=>e.type==='line'&&e.dimensionBreakable&&e.points.every(p=>p.y===20));
 assert.deepEqual(primary.map(e=>e.points.map(p=>Number(p.x.toFixed(6)))),[[0,45],[55,100]]);assert.equal(JSON.stringify(doc),before);
});
test('result canvas uses one replacement, highlight color, cursor-centred zoom, pan and fit reset',()=>{
 const doc=fixture(),changes=[{...doc.entities[0],breaks:[]}],events=new Map(),calls=[],ctx={clearRect(){},fillRect(){}};
 const canvas={width:720,height:420,getContext:()=>ctx,getBoundingClientRect:()=>({left:0,top:0,width:720,height:420}),addEventListener:(name,fn)=>events.set(name,fn)};
 const result=renderDimensionBreakPreview(canvas,doc,changes,{paint:(ctx,e,screen,scale,color,width,dashed,forced)=>calls.push({id:e.id,color,forced})});
 assert.equal(calls.filter(c=>c.id==='dim').length,1);assert.deepEqual(calls.at(-1),{id:'dim',color:'#9dcbe0',forced:true});
 const initial={...result.view};events.get('wheel')({preventDefault(){},clientX:360,clientY:210,deltaY:-1});assert.ok(result.view.scale>initial.scale);assert.equal(result.view.x,initial.x);assert.equal(result.view.y,initial.y);
 events.get('pointerdown')({button:0,pointerId:1,clientX:100,clientY:100});events.get('pointermove')({pointerId:1,clientX:120,clientY:120});assert.notEqual(result.view.x,initial.x);events.get('pointerup')({pointerId:1});result.reset();assert.deepEqual(result.view,initial);
});
test('result preview honours hidden layers and resolves shared block intersections',()=>{
 const doc=fixture();doc.layers.push({id:'hidden',name:'hidden',visible:false});doc.entities.push({id:'hidden-line',type:'line',layer:'hidden',points:[P(40,0),P(40,40)]});doc.sharedBlocks={B:{origin:P(0,0),entities:[{id:'child',type:'line',layer:'default',points:[P(60,0),P(60,40)]}]}};doc.entities.push({id:'insert',type:'block',layer:'default',sharedBlock:'B',entities:[],position:P(0,0),rotation:0,scale:1});
 const scene=dimensionBreakPreviewScene(doc,[{...doc.entities[0],breaks:[]}]);assert.ok(scene.surrounding.some(e=>e.id==='insert'));assert.ok(!scene.surrounding.some(e=>e.id==='hidden-line'));assert.equal(doc.entities.at(-1).entities.length,0);
});
