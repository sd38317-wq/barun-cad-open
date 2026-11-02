import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {nativeDraftingEdits,nativeLength,ARCH_LIBRARY,architecturalDetail,detailDefaults,parallelWallPair,wallLineOpening,architecturalCounts} from './architectural-library.js';import {DrawingEngine} from './engine.js';import * as G from './geometry.js';import {plotSVG} from './plot.js';
const p=(x,y)=>({x,y});
for(const name of Object.keys(ARCH_LIBRARY))test(name+' creates valid editable geometry, survives rotation, BCAD serialization and Undo',()=>{
 const engine=new DrawingEngine(),entity=architecturalDetail(name,{x:1000,y:2000,rotation:30});const [id]=engine.execute({type:'add',entity});assert.ok(G.vertices(entity).length>1);const before=structuredClone(engine.doc);engine.execute({type:'move',ids:[id],dx:400,dy:-100});const moved=engine.doc.entities[0],rebuilt=architecturalDetail(name,moved.parameters);const a=G.vertices(moved),b=G.vertices(rebuilt);assert.equal(a.length,b.length);for(let i=0;i<a.length;i++)assert.ok(G.dist(a[i],b[i])<1e-6,name+' vertex '+i);
 const loaded=new DrawingEngine();loaded.execute({type:'load',document:JSON.parse(JSON.stringify(engine.doc))});assert.deepEqual(loaded.doc,engine.doc);assert.match(plotSVG(engine.doc,{fit:true}),/<svg/);engine.execute({type:'undo'});assert.deepEqual(engine.doc,before);
});
test('stair section risers reach exact floor height; deck terminates at requested length',()=>{
 const stair=architecturalDetail('STSD',{floorHeight:3210,count:19});const outline=stair.entities[0].points;assert.equal(Math.max(...outline.map(p=>p.y)),3210);
 const deck=architecturalDetail('DECK',{length:3111});assert.equal(Math.max(...G.vertices(deck).map(p=>p.x)),3111);
 assert.throws(()=>architecturalDetail('DECK',{pitch:100}));assert.throws(()=>architecturalDetail('SLD',{length:1000,transition:500}));
});
test('angled parking clear width measured perpendicular to stall side remains specified',()=>{
 const e=architecturalDetail('PKD',{parkingAngle:60,count:2,width:2500}),q=e.entities[0].points;assert.ok(Math.abs(G.distanceToSegment(q[1],q[0],q[3])-2500)<1e-6);
});
test('parallel wall opening changes only requested interval and supports reversed line direction',()=>{
 const lines=[{type:'line',layer:'default',points:[p(0,0),p(4000,0)]},{type:'line',layer:'default',points:[p(4000,200),p(0,200)]}];assert.deepEqual(parallelWallPair(lines).center,[p(0,100),p(4000,100)]);const out=wallLineOpening(lines,1000,900);assert.equal(out.length,6);assert.equal(out.reduce((sum,e)=>sum+G.dist(...e.points),0),6600);assert.throws(()=>wallLineOpening(lines,3500,900));
});
test('symbol counts retain W1/W11 and count enclosed foreign text without loose notes',()=>{
 const entities=[{type:'circle',center:p(0,0),radius:100},{type:'circle',center:p(500,0),radius:100},{type:'text',position:p(0,0),text:'W1'},{type:'text',position:p(500,0),text:'W11'},{type:'text',position:p(1000,0),text:'note'}];assert.deepEqual(architecturalCounts(entities,'WLIST').slice(1),[['W1',1],['W11',1]]);
});
test('ordinary wall door binding stores actual ids and copy cannot edit original wall parts',()=>{
 const engine=new DrawingEngine(),sources=[{type:'line',layer:'default',points:[p(0,0),p(4000,0)]},{type:'line',layer:'default',points:[p(0,200),p(4000,200)]}],ids=engine.execute({type:'addMany',entities:sources}),parts=wallLineOpening(sources,1000,1200);const [id]=engine.execute({type:'linewall.place',ids,sources,parts,entity:architecturalDetail('DOD',{x:1000,y:100})});const door=engine.doc.entities.find(e=>e.id===id);assert.ok(door.lineWallHost.parts.every(part=>engine.doc.entities.some(e=>e.id===part.id)));
 const [copied]=engine.execute({type:'copy',ids:[id],dx:1000,dy:1000});assert.equal(engine.doc.entities.find(e=>e.id===copied).lineWallHost,undefined);engine.execute({type:'undo'});engine.execute({type:'undo'});assert.equal(engine.doc.entities.length,2);
});
test('export fixtures cover every library entry',()=>{const documents={};for(const name of Object.keys(ARCH_LIBRARY)){const e=new DrawingEngine();e.execute({type:'add',entity:architecturalDetail(name,detailDefaults(name))});documents[name]=e.doc;}const out=path.join(os.tmpdir(),'barun-cad-tests','architecture-full');fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'fixtures.json'),JSON.stringify(documents));});


test('TALIGN preserves text style and non-targets; invalid edits leave document intact',()=>{
 const engine=new DrawingEngine();engine.execute({type:'addMany',entities:[{type:'text',layer:'default',text:'가',height:120,rotation:30,position:p(10,20)},{type:'line',layer:'default',points:[p(0,0),p(100,0)]}]});
 const before=structuredClone(engine.doc),commands=nativeDraftingEdits('TALIGN',engine.doc.entities,{axis:'X',value:99});engine.execute({type:'batch',commands});assert.deepEqual(engine.doc.entities[0],{...before.entities[0],position:p(99,20)});assert.deepEqual(engine.doc.entities[1],before.entities[1]);engine.execute({type:'undo'});assert.deepEqual(engine.doc,before);
 assert.throws(()=>nativeDraftingEdits('TALIGN',engine.doc.entities,{axis:'Z',value:0}));
 assert.throws(()=>nativeDraftingEdits('PC',[{type:'polyline',points:[p(0,0),p(1,0)]}]));
 engine.doc.layers[0].locked=true;assert.throws(()=>engine.execute({type:'batch',commands}));assert.equal(engine.doc.entities[0].position.x,10);
});
test('DIMCLEAN preserves measurement anchors and handles rotated/reversed, separated and radial dimensions',()=>{
 const dim=(id,offset,shift=0)=>({id,type:'dimension',mode:'aligned',points:[p(shift,shift),p(shift+1000,shift+1000),p(500-offset,500+offset)],height:100});
 const es=[dim('a',100),dim('b',110),dim('c',120,5000),{id:'r',type:'dimension',mode:'radius',points:[p(0,0),p(100,0),p(200,0)]}];[es[1].points[0],es[1].points[1]]=[es[1].points[1],es[1].points[0]];
 const before=structuredClone(es),edits=nativeDraftingEdits('DIMCLEAN',es,{gap:150});assert.equal(edits.length,1);assert.equal(edits[0].ids[0],'b');assert.deepEqual(edits[0].changes.points.slice(0,2),es[1].points.slice(0,2));assert.ok(Math.abs(G.dot(G.sub(edits[0].changes.points[2],es[0].points[2]),G.unit(p(-1,1)))-150)<1e-6);assert.deepEqual(es,before);assert.throws(()=>nativeDraftingEdits('DIMCLEAN',es,{gap:-1}));assert.doesNotThrow(()=>nativeDraftingEdits('DIMCLEAN',es,{gap:0}),'ACAD200 517: 0 = 자동 고르게');
});
test('LEN adds true arc and closed path lengths and reports excluded objects without mutation',()=>{
 const es=[{type:'line',points:[p(0,0),p(300,400)]},{type:'polyline',points:[p(0,0),p(300,0),p(300,400)],closed:true},{type:'arc',center:p(0,0),radius:100,startAngle:350,endAngle:10},{type:'circle',center:p(0,0),radius:50},{type:'text',text:'ignore'}];const before=structuredClone(es),r=nativeLength(es);assert.ok(Math.abs(r.length-(500+1200+100*20*Math.PI/180+100*Math.PI))<1e-8);assert.equal(r.count,4);assert.equal(r.ignored,1);assert.deepEqual(es,before);
});
