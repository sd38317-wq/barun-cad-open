import test from 'node:test';
import assert from 'node:assert/strict';
import * as G from './geometry.js';
import * as V from './view.js';
import fs from 'node:fs';
const shape=value=>JSON.parse(JSON.stringify(value,(key,value)=>key==='id'||key.startsWith('_')?undefined:value));
test('native diagnostic loading prepares shared bounds before render, as file import does',()=>{
 const raw={version:3,layers:[{id:'0',name:'0',visible:true}],sharedBlocks:{unit:{origin:{x:0,y:0},entities:[{id:'line',type:'line',layer:'0',points:[{x:0,y:0},{x:10,y:20}]}]}},entities:[{id:'root',type:'block',layer:'0',sharedBlock:'unit',position:{x:100,y:200},scale:1,rotation:0,entities:[]}]};
 const expected={minX:100,minY:200,maxX:110,maxY:220};let renders=0;
 const engine={emit(){assert.deepEqual(G.bounds(this.doc.entities),expected);renders++;}};
 const source=fs.readFileSync(new URL('./app.js',import.meta.url),'utf8');
 const hook=source.slice(source.indexOf("globalThis.__cadGpuTest={")).match(/load\(doc\)\{([^\n]+)\},/)[1];
 new Function('doc','engine','G','selected','fit','paintFrame',hook)(raw,engine,G,new Set(),()=>{},()=>{});
 assert.equal(renders,1);assert.notEqual(engine.doc,raw);assert.equal(raw.entities[0]._renderBounds,undefined);
});
function fixture(){
 const layers=[{id:'0',name:'0',visible:true,color:'#fff',linetype:'CONTINUOUS',lineweight:.25},{id:'wall',name:'wall',visible:true,color:'#ff0',linetype:'CONTINUOUS',lineweight:.25},{id:'off',name:'off',visible:false,color:'#f00'}];
 const entities=Array.from({length:128},(_,i)=>({id:'l'+i,type:'line',layer:'0',points:[{x:i,y:0},{x:i,y:8}]}));
 entities.push({id:'nested',type:'block',layer:'0',entities:[{id:'hidden',type:'line',layer:'off',points:[{x:0,y:0},{x:100,y:100}]},{id:'circle',type:'circle',layer:'0',center:{x:3,y:4},radius:2}],clip:{enabled:true,points:[{x:0,y:0},{x:6,y:0},{x:6,y:6},{x:0,y:6}]}});
 const canonical={id:'source',type:'block',name:'unit',layer:'wall',sharedBlock:'unit',position:{x:100,y:200},scale:1,rotation:0,entities:[]};
 const doc={version:3,layers,entities:[canonical],sharedBlocks:{unit:{origin:{x:0,y:0},entities}}};G.prepareSharedDrawingReferences(doc);
 const display=G.visibleEntities(doc,{inPlace:true})[0];return {doc,canonical,display};
}
function moved(f,dx=50,dy=-30,reuse=f.display){
 const canonical={...f.canonical,id:'copy',position:{x:f.canonical.position.x+dx,y:f.canonical.position.y+dy},entities:[]};
 const doc={...f.doc,entities:[canonical]};G.prepareSharedDrawingReferences(doc);
 return {doc,canonical,display:G.visibleEntities(doc,{inPlace:true,reuseDisplays:[reuse]})[0]};
}
test('shared instance draws, picks and queries without expanding its children',()=>{
 const f=fixture(),copy=moved(f),descriptor=G.getDisplayInstance(copy.display);assert.ok(descriptor);
 assert.equal(Object.isFrozen(f.display.entities),true);assert.equal(Object.isFrozen(f.display.entities[0]),true);
 assert.notEqual(f.display.position,f.canonical.position);
 assert.notEqual(f.display._renderBounds,f.canonical._renderBounds);
 assert.equal(Object.isFrozen(f.display.entities.at(-1)._visibleEntities),true);
 assert.equal(G.preciseSnapBlock(copy.doc,copy.display),copy.display);
 const sourceBounds=G.bounds([f.display]);
 assert.deepEqual(G.bounds([copy.display]),{minX:sourceBounds.minX+50,minY:sourceBounds.minY-30,maxX:sourceBounds.maxX+50,maxY:sourceBounds.maxY-30});
 const point={x:150,y:174},box={minX:149,minY:171,maxX:153,maxY:175};
 assert.equal(G.entityDistance(copy.display,point,1),0);
 const parts=G.queryEntityPrimitives(copy.display,box);assert.ok(parts.length>0);assert.ok(parts.every(p=>p.id.startsWith('copy/')));
 const eager=G.visibleEntities(copy.doc,{inPlace:true})[0];
 assert.deepEqual(shape(parts),shape(G.queryEntityPrimitives(eager,box)));
 assert.equal(V.crossing(copy.display,box),V.crossing(eager,box));
 const paint=e=>{const calls=[],ctx=new Proxy({measureText:()=>({width:1})},{get:(o,k)=>k in o?o[k]:(...args)=>calls.push([k,...args]),set:(o,k,v)=>{calls.push(['set',k,v]);o[k]=v;return true;}});V.drawEntity(ctx,e,p=>p,1,'#fff',1.5,false,true);return calls;};
 assert.deepEqual(paint(copy.display),paint(eager));
 assert.equal(typeof Object.getOwnPropertyDescriptor(copy.display,'entities').get,'function');
 assert.deepEqual(shape(G.visiblePrimitives(copy.display)),shape(G.visiblePrimitives(eager)));
 const sourceIds=new Set(G.visiblePrimitives(f.display).map(e=>e.id));
 assert.ok(G.visiblePrimitives(copy.display).every(e=>!sourceIds.has(e.id)));
 assert.equal(Object.getOwnPropertyDescriptor(copy.display,'entities').get,undefined);
});
test('later layer resolution cannot mutate the owned artifact or an earlier instance',()=>{
 const f=fixture(),copy=moved(f),before=shape(G.queryEntityPrimitives(copy.display,{minX:149,minY:169,maxX:160,maxY:179}));
 f.doc.layers[1].color='#0f0';assert.doesNotThrow(()=>G.visibleEntities(f.doc,{inPlace:true}));
 assert.equal(f.display.entities[0]._displayColor,'#ff0');
 assert.deepEqual(shape(G.queryEntityPrimitives(copy.display,{minX:149,minY:169,maxX:160,maxY:179})),before);
 const changed=moved(f);assert.equal(G.getDisplayInstance(changed.display),null);
});

test('history restoration reuses frozen display only with matching canonical and style context',()=>{
 const f=fixture(),deleted={...f.doc,entities:[]};
 assert.deepEqual(G.visibleEntities(deleted,{inPlace:true}),[]);
 assert.equal(G.visibleEntities(f.doc,{inPlace:true})[0],f.display);
 const changedLayers={...f.doc,layers:f.doc.layers.map(l=>l.id==='wall'?{...l,color:'#0f0'}:l)};
 const changed=G.visibleEntities(changedLayers,{inPlace:true})[0];
 assert.notEqual(changed,f.display);assert.equal(changed.entities[0]._displayColor,'#0f0');
 assert.equal(f.display.entities[0]._displayColor,'#ff0');
 const restored=G.visibleEntities(f.doc,{inPlace:true})[0];
 assert.notEqual(restored,changed);assert.equal(restored.entities[0]._displayColor,'#ff0');
 const movedCanonical={...f.canonical,position:{x:500,y:600}};
 const movedDoc={...f.doc,entities:[movedCanonical]};G.prepareSharedDrawingReferences(movedDoc);
 assert.notEqual(G.visibleEntities(movedDoc,{inPlace:true})[0],restored);
 const definitions={...f.doc.sharedBlocks,unit:{...f.doc.sharedBlocks.unit,entities:f.doc.sharedBlocks.unit.entities.slice(0,128).map(e=>({...e,points:e.points.map(p=>({x:p.x+1000,y:p.y}))}))}};
 const redefined={...f.doc,sharedBlocks:definitions};G.prepareSharedDrawingReferences(redefined);
 assert.notEqual(G.visibleEntities(redefined,{inPlace:true})[0],restored);
});

test('drawing viewport follows translated instances and retains boundary-crossing lines',()=>{
 const f=fixture(),copy=moved(f),descriptor=G.getDisplayInstance(copy.display);assert.ok(descriptor);
 const box={minX:148,minY:167,maxX:156,maxY:180};
 const local={minX:box.minX-descriptor.dx,maxX:box.maxX-descriptor.dx,minY:box.minY-descriptor.dy,maxY:box.maxY-descriptor.dy};
 const paint=(e,screen,b)=>{const calls=[],ctx=new Proxy({measureText:()=>({width:1})},{get:(o,k)=>k in o?o[k]:(...args)=>calls.push([k,...args]),set:(o,k,v)=>{calls.push(['set',k,v]);o[k]=v;return true;}});V.drawEntity(ctx,e,screen,1,'#fff',2.3,true,false,b);return calls;};
 assert.deepEqual(paint(copy.display,p=>p,box),paint(f.display,p=>({x:p.x+descriptor.dx,y:p.y+descriptor.dy}),local));
 assert.equal(typeof Object.getOwnPropertyDescriptor(copy.display,'entities').get,'function');
 const crossing={type:'line',points:[{x:-100,y:-100},{x:100,y:100}]};
 const children=Array.from({length:128},(_,i)=>({...crossing,id:'x'+i,layer:'0'}));
 const doc={...f.doc,sharedBlocks:{diag:{origin:{x:0,y:0},entities:children}},entities:[{id:'diagonal',type:'block',sharedBlock:'diag',layer:'wall',scale:1,rotation:0,position:{x:0,y:0},entities:[]}]};G.prepareSharedDrawingReferences(doc);
 const display=G.visibleEntities(doc,{inPlace:true})[0];
 assert.equal(G.queryDrawingChildren(display,{minX:-4,minY:-4,maxX:4,maxY:4}).length,128);
 assert.equal(G.queryDrawingChildren(display,{minX:NaN,minY:0,maxX:1,maxY:1}),display.entities);
});
test('COPY of many shared references: every copy reuses its source display through the candidate index',()=>{
 // 10/30 주동딱지: 12,205개 복사본마다 후보 12,205개를 전부 훑었다(1.5억 번). 색인은 visibleEntities 호출마다 한 번.
 const f=fixture(),n=600,sources=Array.from({length:n},(_,i)=>({...f.canonical,id:'s'+i,position:{x:i*20,y:0},entities:[]}));
 const doc={...f.doc,entities:sources};G.prepareSharedDrawingReferences(doc);
 const displays=G.visibleEntities(doc,{inPlace:true});assert.equal(displays.length,n);
 const copies=sources.map((s,i)=>({...s,id:'c'+i,position:{x:s.position.x,y:500},entities:[]})),next={...doc,entities:[...sources,...copies]};G.prepareSharedDrawingReferences(next);
 const shown=G.visibleEntities(next,{inPlace:true,entities:copies,reuseDisplays:displays});
 assert.equal(shown.length,n);assert.ok(shown.every(d=>G.getDisplayInstance(d)));
 assert.deepEqual(shape(shown[7].entities),shape(G.visibleEntities({...next,entities:[{...copies[7]}]},{inPlace:true})[0].entities));
});
