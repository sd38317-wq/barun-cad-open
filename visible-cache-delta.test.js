import test from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {retainVisibleEntities} from './viewport-visibility.js';
import * as G from './geometry.js';
import {blankDocument,DrawingEngine} from './engine.js';

const line=(id,x=0)=>({id,type:'line',layer:'default',points:[{x,y:0},{x:x+10,y:10}]});
const resolve=doc=>entities=>G.visibleEntities(doc,{inPlace:true,lodScale:0,viewBox:null,entities});


test('GPU display hint accepts only the current complete cache without resolving geometry',()=>{
 const doc={...blankDocument(),entities:[line('a')]},cached=resolve(doc)(doc.entities);
 const baseline={engine:{doc},sceneRevision:2,visibleRevision:2,visibleDoc:doc,visibleCache:cached,visibleScaleBucket:0,visibleViewportKey:''};
 const source=fs.readFileSync(new URL('./app.js',import.meta.url),'utf8');
 const body=source.slice(source.indexOf('function completeGpuDisplay()'),source.indexOf('function paintFrame()'));
 const check=overrides=>{const context=vm.createContext({...baseline,...overrides});vm.runInContext(body+';globalThis.hint=completeGpuDisplay();',context);return context.hint;};
 const hint=check({});assert.equal(hint.doc,doc);assert.equal(hint.entities,cached);assert.equal(hint.revision,2);
 for(const overrides of [{visibleRevision:1},{visibleDoc:{...doc}},{visibleScaleBucket:null},{visibleScaleBucket:'0.1:0'},{visibleViewportKey:'cropped'}])assert.equal(check(overrides),null);
 const heavy={...doc,entities:Array(50001)};assert.equal(check({engine:{doc:heavy},visibleDoc:heavy}),null);
});
test('small delta resolves only changes and retains display copies in document order',()=>{
 const base=blankDocument(),a=line('a'),b=line('b'),displayB={...b,_displayColor:'existing'};
 const previous={...base,entities:[a,b]},moved=line('a',20),added=line('c',40);
 const next={...previous,layers:previous.layers.map(l=>({...l})),entities:[moved,b,added]};
 let resolved;
 const result=retainVisibleEntities(previous,next,[a,displayB],[a],[moved,added],es=>(resolved=es,resolve(next)(es)));
 assert.deepEqual(resolved,[moved,added]);assert.deepEqual(result.map(e=>e.id),['a','b','c']);
 assert.equal(result[1],displayB);assert.equal(result[0].points[0].x,20);
});
test('hidden replacement, deletion and history restoration match full resolution',()=>{
 const previous={...blankDocument(),entities:[line('a'),line('b')]};
 const cached=resolve(previous)(previous.entities),hidden={...previous.entities[0],hidden:true};
 const next={...previous,entities:[hidden]};
 const retained=retainVisibleEntities(previous,next,cached,previous.entities,[hidden],resolve(next));
 assert.deepEqual(retained,resolve(next)(next.entities));
 const restored=retainVisibleEntities(next,previous,retained,[hidden],previous.entities,resolve(previous));
 assert.deepEqual(restored,resolve(previous)(previous.entities));
});
test('display metadata changes, changed shared definitions and heavy view caches are rejected',()=>{
 const previous={...blankDocument(),entities:[line('a')]};
 const layerChanged={...previous,layers:previous.layers.map(l=>({...l,color:'#f00'}))};
 assert.equal(retainVisibleEntities(previous,layerChanged,[],[],[],()=>[]),null);
 assert.equal(retainVisibleEntities(previous,{...previous,sharedBlocks:{}},[],[],[],()=>[]),null);
 assert.equal(retainVisibleEntities(previous,{...previous,entities:Array(50001)},[],[],[],()=>[]),null);
});

test('shared INSERT move and undo keep other resolved copies and child visibility',()=>{
 const engine=new DrawingEngine(),base=blankDocument();
 const reference=(id,x)=>({id,type:'block',name:'UNIT',sharedBlock:'unit',layer:'default',position:{x,y:20},scale:2,rotation:90,entities:[]});
 engine.doc={...base,version:3,layers:[...base.layers,{...base.layers[0],id:'hidden',name:'hidden',visible:false}],entities:[reference('a',0),reference('b',100)],sharedBlocks:{unit:{origin:{x:0,y:0},entities:[line('definition'),{...line('hidden-child'),layer:'hidden'}]}}};
 G.prepareSharedDrawingReferences(engine.doc);
 let cached=resolve(engine.doc)(engine.doc.entities);
 const retainedB=cached[1];
 for(const command of [{type:'move',ids:['a'],dx:50,dy:0},{type:'undo'}]){
  const previous=engine.doc;engine.execute(command);
  const removed=previous.entities.filter(e=>!engine.doc.entities.includes(e)),added=engine.doc.entities.filter(e=>!previous.entities.includes(e));
  cached=retainVisibleEntities(previous,engine.doc,cached,removed,added,resolve(engine.doc));
  assert.ok(cached);assert.equal(cached[1],retainedB);
  const shape=items=>items.map(e=>({id:e.id,position:e.position,bounds:e._renderBounds,color:e._displayColor,
    children:e.entities.map(child=>({type:child.type,layer:child.layer,points:child.points}))}));
  assert.deepEqual(shape(cached),shape(resolve(engine.doc)(engine.doc.entities)));
  assert.ok(cached.every(e=>e.entities.every(child=>child.layer!=='hidden')));
 }
});


test('actual app execute shares one resolved INSERT between display and pick caches through MOVE and undo',()=>{
 const engine=new DrawingEngine(),base=blankDocument();
 engine.doc={...base,version:3,entities:[{id:'ref',type:'block',name:'UNIT',sharedBlock:'unit',layer:'default',position:{x:0,y:0},scale:1,rotation:0,entities:[]}],sharedBlocks:{unit:{origin:{x:0,y:0},entities:[line('part')]}}};
 G.prepareSharedDrawingReferences(engine.doc);
 const cached=G.visibleEntities(engine.doc,{inPlace:true}),index=G.spatialIndex(cached);let resolutions=0;
 const context=vm.createContext({engine,G:{...G,visibleEntities(...args){resolutions++;return G.visibleEntities(...args);}},retainVisibleEntities,
   withCurrentProperties:c=>c,withJustifiedAnchors:c=>c,incrementalAppendCommand:()=>false,sceneRevision:1,visibleRevision:1,visibleDoc:engine.doc,visibleGeneration:1,visibleCache:cached,
   gpuEdit:null,renderSpatialRevision:-1,renderSpatial:null,entityLookupRevision:-1,entityLookup:null,
   nearby:{objectsRevision:1,objectsGeneration:1,objects:index,sharedCopies:new Map([['ref',cached[0]]])}});
 engine.onChange(()=>context.sceneRevision++);
 const source=fs.readFileSync(new URL('./app.js',import.meta.url),'utf8'),start=source.indexOf('const HISTORY_DELTA_LIMIT='),end=source.indexOf('/* 화면 어딘가에는',start);
 vm.runInContext(source.slice(start,end)+';globalThis.run=execute;',context);
 for(const command of [{type:'move',ids:['ref'],dx:100,dy:0},{type:'undo'}]){
   const stale=context.visibleCache[0];resolutions=0;context.run(command);
   assert.equal(resolutions,1,'only one full child style resolution per edit');
   assert.equal(context.visibleDoc,engine.doc,'cache completeness is tied to the current immutable document');
   const fresh=context.visibleCache[0];assert.notEqual(fresh,stale);
   assert.equal(context.nearby.sharedCopies.get('ref'),fresh,'pick and display caches share the wrapper');
   const b=G.bounds([fresh]);const hits=context.nearby.objects.query(b);
   assert.ok(hits.includes(fresh));assert.ok(!hits.includes(stale));
   const old=G.bounds([stale]);assert.ok(!context.nearby.objects.query(old).some(e=>e.id==='ref'),'old location no longer picks the moved object');
 }
});
