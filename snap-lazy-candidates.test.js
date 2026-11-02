import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as G from './geometry.js';
import {snapIntersections} from './snap-intersections.js';
const source=fs.readFileSync(new URL('./app.js',import.meta.url),'utf8');
const snap=source.slice(source.indexOf('function snap('),source.indexOf('// 직교(F8)'));
const nearby=source.slice(source.indexOf('function nearby('),source.indexOf('/* 집기 색인을'));
const p=(x,y)=>({x,y}),line=(x,y)=>({type:'line',points:[p(x,y),p(x+1,y)]});
function runner(entities,filtered,options=null){
 const visits=[];const geometry={...G,snapBlockMayContain:filtered?G.snapBlockMayContain:()=>true,querySnapPrimitives:(e,b)=>{visits.push(e.id);return G.querySnapPrimitives(e,b);}};
 const ctx={G:geometry,engine:{doc:{entities}},scale:1,points:[p(-5,10)],mode:'LINE',orthogonalInput:q=>q,num:()=>16,sceneRevision:1,visibleGeneration:1,visible:()=>entities,snapIntersections,$:id=>({checked:id==='osnap'||(options?options.includes(id):id.startsWith('snap-'))})};
 vm.createContext(ctx);vm.runInContext(snap+'\n'+nearby,ctx);ctx.nearby.objects=G.spatialIndex(entities);ctx.nearby.objectsRevision=1;ctx.nearby.objectsGeneration=1;
 return {snap:q=>JSON.parse(JSON.stringify(ctx.snap(q))),visits};
}
test('lazy block candidates preserve exact results while avoiding distant block expansion',()=>{
 const entities=[{...line(.1,0),id:'anchor'},...Array.from({length:80},(_,i)=>({id:'far'+i,type:'block',entities:[line(3+i%8,3+i%7),{type:'text',position:p(5,5),height:1,text:'a'}]})),
  {id:'curve',type:'block',entities:[{type:'circle',center:p(10,0),radius:10}]},
  {id:'per',type:'block',entities:[{type:'line',points:[p(0,0),p(1e10,0)]}]}];
 const fast=runner(entities,true),reference=runner(entities,false);
 assert.deepEqual(fast.snap(p(0,0)),reference.snap(p(0,0)));
 assert.ok(fast.visits.length<reference.visits.length/4);assert.ok(fast.visits.includes('curve'));
 for(let i=0;i<60;i++){const cursor=p((i*7)%16-6,(i*3)%13-5);assert.deepEqual(fast.snap(cursor),reference.snap(cursor));}
});
test('block support includes nested PER extent and invalidates replaced children',()=>{
 const e={type:'block',entities:[{type:'block',entities:[{type:'line',points:[p(0,0),p(1e10,0)]}]}]};
 assert.equal(G.snapBlockMayContain(e,p(-5,0),.1),true);
 e.entities=[line(100,100)];assert.equal(G.snapBlockMayContain(e,p(-5,0),.1),false);
 e.entities=[{type:'dimension',points:[p(100,100),p(110,110)]}];assert.equal(G.snapBlockMayContain(e,p(-5,0),.1),true);
 const child=line(100,100);assert.equal(G.snapBlockMayContain({type:'block',entities:[child]},p(0,0),1),false);
 child.points.push(p(NaN,0));assert.equal(G.snapBlockMayContain({type:'block',entities:[child]},p(0,0),1),true,'unknown geometry cannot reuse a shorter stale support');
});

test('shared instance support uses source bounds without materializing instance children',()=>{
 const make=(id,x)=>({id,type:'block',layer:'0',sharedBlock:'s',position:p(x,0),scale:1,rotation:0,entities:[]});
 const doc={layers:[{id:'0',visible:true,color:'#fff'}],sharedBlocks:{s:{origin:p(0,0),entities:Array.from({length:128},(_,i)=>({...line(i,0),layer:'0'}))}},entities:[make('a',0),make('b',100)]};
 G.prepareSharedDrawingReferences(doc);
 const first=G.visibleEntities(doc,{entities:[doc.entities[0]],inPlace:true})[0];
 const second=G.visibleEntities(doc,{entities:[doc.entities[1]],inPlace:true,reuseDisplays:[first]})[0];
 assert.ok(G.getDisplayInstance(second));const getter=Object.getOwnPropertyDescriptor(second,'entities').get;
 assert.equal(typeof getter,'function');assert.equal(G.snapBlockMayContain(second,p(0,0),1),false);
 assert.equal(G.snapBlockMayContain(second,p(100,0),1),true);
 assert.equal(Object.getOwnPropertyDescriptor(second,'entities').get,getter);
});

test('curve block gate preserves reference results and final intersection padding',()=>{
 for(const offset of [0,1e9]){
  const entities=[{...line(offset+.1,offset),id:'anchor'},...Array.from({length:30},(_,i)=>({id:'arc'+i,type:'block',entities:[{type:i%2?'arc':'circle',center:p(offset+i*.4,offset+i*.3),radius:i%4+.01,startAngle:10,endAngle:260}]})),
   {id:'short',type:'block',entities:[{type:'line',points:[p(offset-.0001,offset+1),p(offset+.0001,offset+1)]},{type:'circle',center:p(offset,offset),radius:1}]}];
  const fast=runner(entities,true),reference=runner(entities,false);
  for(let i=0;i<75;i++){const cursor=p(offset+(i*13)%17-4,offset+(i*7)%11-3);assert.deepEqual(fast.snap(cursor),reference.snap(cursor));}
 }
 const curve={type:'block',entities:[{type:'circle',center:p(2+G.EPS*4,0),radius:1}]};
 assert.equal(G.snapBlockMayContain(curve,p(0,0),1),true,'retain curve boxes in the padded border');
 assert.equal(G.snapBlockMayContain(curve,p(-10,0),1),false);
 const giant={id:'giant',type:'block',entities:[{type:'circle',center:p(1e16,0),radius:1e16}]};
 assert.equal(G.snapBlockMayContain(giant,p(-.25,0),.1),true,'relative-coordinate cancellation must remain conservative');
 const entities=[{id:'anchor',type:'line',points:[p(-1.25,.1),p(.75,.1)]},giant,{id:'cross',type:'line',points:[p(-.25,0),p(-.25,1)]}],options=['snap-mid','snap-intersection'];
 const actual=runner(entities,true,options).snap(p(-.25,0)),expected=runner(entities,false,options).snap(p(-.25,0));
 assert.equal(expected.label,'곡선 교차점');assert.equal(expected.x,-.25);assert.equal(expected.y,0);assert.deepEqual(actual,expected);
});

test('translated shared curve support keeps source-coordinate roundoff',()=>{
 const make=(id,x)=>({id,type:'block',layer:'0',sharedBlock:'s',position:p(x,0),scale:1,rotation:0,entities:[]});
 const doc={layers:[{id:'0',visible:true,color:'#fff'}],sharedBlocks:{s:{origin:p(0,0),entities:Array.from({length:128},()=>({type:'circle',layer:'0',center:p(1e16,0),radius:1}))}},entities:[make('a',0),make('b',-1e16)]};
 G.prepareSharedDrawingReferences(doc);const first=G.visibleEntities(doc,{entities:[doc.entities[0]],inPlace:true})[0];
 const second=G.visibleEntities(doc,{entities:[doc.entities[1]],inPlace:true,reuseDisplays:[first]})[0];
 assert.ok(G.getDisplayInstance(second));
 assert.equal(G.snapBlockMayContain(second,p(-1,0),.01),true,'translated radius survives source bounds cancellation');
});

test('rotated clipped ellipse blocks match unfiltered snapping at every option',()=>{
 for(const ratio of [.2,1,-2])for(const clipping of ['normal','inverted','nested']){
  const ellipse={type:'ellipse',center:p(4,3),majorAxis:p(4,2),ratio,startParam:.2,endParam:5.4};
  const inner={id:'ellipse',type:'block',entities:[ellipse],clip:{enabled:true,inverted:clipping==='inverted',points:[p(0,0),p(8,0),p(8,6),p(0,6)]}};
  const block=clipping==='nested'?{id:'outer',type:'block',entities:[inner],clip:{enabled:true,points:[p(1,-2),p(7,-2),p(7,8),p(1,8)]}}:inner;
  const entities=[{...line(.1,0),id:'anchor'},block,{id:'cross',type:'line',points:[p(-10,2),p(20,2)]}];
  const fast=runner(entities,true),reference=runner(entities,false);
  for(let i=0;i<100;i++){const cursor=p((i*7)%19-5,(i*11)%13-3);assert.deepEqual(fast.snap(cursor),reference.snap(cursor));}
  for(const point of G.ellipsePoints(ellipse,256))assert.equal(G.snapBlockMayContain(block,point,.00001),true);
  assert.equal(G.snapBlockMayContain(block,p(100,100),1),false);
 }
});
