import test from 'node:test';
import assert from 'node:assert/strict';
import {DrawingEngine,blankDocument} from './engine.js';
import {visibleEntities,visiblePrimitives} from './geometry.js';
import {DrawingTabs} from './drawing-tabs.js';
import {prepareLegacyLayerMigration,migrateDrawingTabLayers,legacyStandardName,layerMigrationNotice} from './layer-migration.js';
import {STANDARD_LAYERS} from './layer-standards.js';
const old=label=>['바른',label].join('_');
const layer=(id,name,color='#ff0000',extra={})=>({id,name,color,visible:true,locked:false,linetype:'DASHED',lineweight:.5,plot:true,...extra});
const line=(id,layer,extra={})=>({id,type:'line',layer,points:[{x:0,y:0},{x:100,y:20}],...extra});
const drawing=()=>({...blankDocument(),layers:[layer('zero','0','#ffffff'),layer('old',old('벽체')),layer('target','A-WALL','#0000ff',{linetype:'CONTINUOUS',lineweight:.13})],entities:[line('old-line','old'),line('target-line','target')]});
const style=e=>[e._displayColor,e._displayLinetype,e._displayLineweight];
const appearance=doc=>visibleEntities(doc).flatMap(e=>visiblePrimitives(e).map(style));
test('every legacy class maps to the source A layer, including aliases',()=>{
 for(const l of STANDARD_LAYERS)for(const label of [l.label,...(l.labelAliases||[])])assert.equal(legacyStandardName(old(label)),l.name,label);
 assert.equal(legacyStandardName(old('위생기구')),'A-SANI');assert.equal(legacyStandardName(old('단열')),'A-WALL-INSL');assert.equal(legacyStandardName(old('해치')),'A-HATCH');assert.equal(legacyStandardName(old('조적')),'A-WALL-MASN');assert.equal(legacyStandardName('사용자_벽'),null);
});
test('rename preserves every layer property and does not copy unrelated objects',()=>{
 const d=drawing();d.layers=d.layers.filter(l=>l.id!=='target');d.entities=d.entities.slice(0,1);const before=structuredClone(d),r=prepareLegacyLayerMigration(d);
 assert.equal(r.changed,1);assert.equal(r.merged,0);assert.deepEqual(d,before);assert.deepEqual(r.doc.layers[1],{...before.layers[1],name:'A-WALL'});assert.equal(r.doc.entities,d.entities);assert.equal(r.before,d);assert.ok(layerMigrationNotice(r).includes('Ctrl+Z'));
});
test('existing target merges without numbered layers and preserves explicit and inherited appearance',()=>{
 const d=drawing();d.entities.push(line('explicit','old',{color:'#abcdef',linetype:'CENTER',lineweight:.2}),line('byblock','old',{colorMode:'byblock',linetype:'BYBLOCK'}));const before=structuredClone(d),styles=appearance(d),r=prepareLegacyLayerMigration(d);
 assert.equal(r.merged,1);assert.deepEqual(r.doc.layers.map(l=>l.name),['0','A-WALL']);assert.equal(r.doc.entities[0].layer,'target');assert.deepEqual(appearance(r.doc),styles);assert.equal(r.doc.entities[1],d.entities[1]);assert.deepEqual(r.doc.layers[1].mergedLayerSources,[d.layers[1]]);assert.deepEqual(d,before);new DrawingEngine().validate(r.doc);
});
test('multiple legacy sources merge with one canonical target and archive each source',()=>{
 const d=drawing();d.layers.push(layer('b','B_Wall','#00ff00'));d.entities.push(line('b-line','b'));const styles=appearance(d),r=prepareLegacyLayerMigration(d);assert.equal(r.changed,2);assert.equal(r.merged,2);assert.equal(r.doc.layers.length,2);assert.equal(r.doc.layers[1].mergedLayerSources.length,2);assert.deepEqual(appearance(r.doc),styles);
});
test('conflicting layer states are kept conservatively and original properties remain archived',()=>{
 const d=drawing();Object.assign(d.layers[1],{visible:false,frozen:true,locked:true,plot:false,custom:{office:'test'}});const r=prepareLegacyLayerMigration(d),target=r.doc.layers[1];assert.equal(r.stateConflicts,1);for(const k of ['visible','frozen','locked','plot'])assert.equal(target[k],d.layers[1][k]);assert.deepEqual(target.mergedLayerSources[0],d.layers[1]);assert.equal(visibleEntities(r.doc).length,0);const alternate=prepareLegacyLayerMigration(d,{mergePolicy:'target'});assert.equal(alternate.doc.layers[1].visible,true);
});
test('nested blocks, catalogs and saved wall parts move without changing geometry',()=>{
 const d=drawing(),child=line('child','zero');d.entities=[{id:'block',type:'block',layer:'old',position:{x:0,y:0},entities:[child,line('byblock-child','zero',{colorMode:'byblock',linetype:'BYBLOCK'})],lineWallHost:{parts:[line('saved','old')],sources:[line('source','old')]}}];d.blocks=[{name:'catalog',entities:[line('catalog-line','old')]}];const styles=appearance(d),r=prepareLegacyLayerMigration(d);assert.deepEqual(appearance(r.doc),styles);assert.equal(r.doc.blocks[0].entities[0].layer,'target');assert.equal(r.doc.entities[0].lineWallHost.parts[0].layer,'target');assert.deepEqual(r.doc.entities[0].entities[0].points,child.points);assert.equal(r.doc.entities[0].entities[1].colorMode,'byblock');
});
test('shared definitions vary by inherited layer without recoloring other references',()=>{
 const d=drawing();d.version=3;const ref=(id,l)=>({id,type:'block',layer:l,name:'unit',sharedBlock:'unit',position:{x:0,y:0},scale:1,rotation:0,entities:[]});d.sharedBlocks={unit:{origin:{x:0,y:0},entities:[line('part','zero'),line('own','old'),line('inherited','zero',{colorMode:'byblock',linetype:'BYBLOCK'})]}};d.entities=[ref('legacy','old'),ref('a','target'),ref('legacy2','old')];const before=structuredClone(d),styles=appearance(d),r=prepareLegacyLayerMigration(d);assert.deepEqual(d,before);assert.deepEqual(appearance(r.doc),styles);assert.equal(r.doc.entities[0].sharedBlock,r.doc.entities[2].sharedBlock);assert.notEqual(r.doc.entities[0].sharedBlock,r.doc.entities[1].sharedBlock);assert.ok(Object.values(r.doc.sharedBlocks).every(def=>def.entities.every(e=>e.layer!=='old')));new DrawingEngine().validate(r.doc);
});
test('ordinary documents skip entity traversal and reuse all arrays',()=>{
 const d=drawing();d.layers[1].name='자유 레이어';Object.defineProperty(d,'entities',{get(){throw Error('must not traverse');}});const r=prepareLegacyLayerMigration(d);assert.equal(r.doc,d);assert.equal(r.changed,0);assert.equal(r.before,null);
});
test('opening tab records exactly one undo and undo remains undone across tab switches and recovery',()=>{
 const e=new DrawingEngine(),d=drawing(),before=structuredClone(d);let dirty=false;const tabs=new DrawingTabs({capture:()=>({doc:e.doc,undoStack:e.undoStack,redoStack:e.redoStack,dirty}),apply:tab=>{migrateDrawingTabLayers(tab);e.doc=tab.doc;e.undoStack=tab.undoStack||[];e.redoStack=tab.redoStack||[];dirty=!!tab.dirty;}});const first=tabs.open({name:'old',doc:d,undoStack:[],redoStack:[],view:{activeLayer:'old'}});assert.equal(e.undoStack.length,1);assert.equal(first.view.activeLayer,'target');e.execute({type:'undo'});assert.deepEqual(e.doc,before);tabs.open({name:'new',doc:blankDocument(),undoStack:[],redoStack:[],legacyLayersChecked:true});tabs.select(first.id);assert.deepEqual(e.doc,before);assert.equal(e.undoStack.length,0);const snapshot=tabs.snapshot();tabs.restore(snapshot,doc=>e.validate(doc));assert.deepEqual(e.doc,before);e.execute({type:'redo'}); // recovery deliberately omits redo; undo remains original
 assert.deepEqual(e.doc,before);
});
test('one undo and redo exactly restore migrated and original documents',()=>{
 const e=new DrawingEngine(),d=drawing(),tab={doc:d,undoStack:[]};migrateDrawingTabLayers(tab);e.doc=tab.doc;e.undoStack=tab.undoStack;const migrated=structuredClone(e.doc);e.execute({type:'undo'});assert.equal(e.doc,d);e.execute({type:'redo'});assert.deepEqual(e.doc,migrated);
});

const viewportSafety=(sourceColor=3,targetColor=7)=>({viewportStyles:{
 [old('벽체').toLowerCase()]:{base:[7,null,'CONTINUOUS',-3],views:{vp:{override:true,values:[sourceColor,null,'CONTINUOUS',-3,0]}}},
 'a-wall':{base:[7,null,'CONTINUOUS',-3],views:{vp:{override:false,values:[targetColor,null,'CONTINUOUS',-3,0]}}}
},uncopyableLayers:[]});
test('viewport conflicts retain the old layer and its objects while other layers migrate',()=>{
 const d=drawing();d.legacyLayerSafety=viewportSafety();d.layers.push(layer('door','B_Door'));d.entities.push(line('door-line','door'));
 const r=prepareLegacyLayerMigration(d);
 assert.equal(r.changed,1);assert.equal(r.merged,0);assert.equal(r.doc.layers.find(l=>l.id==='old'),d.layers[1]);assert.equal(r.doc.layers.find(l=>l.id==='target'),d.layers[2]);
 assert.equal(r.doc.entities,d.entities);assert.deepEqual(r.doc.layerNameMigrations,[{from:'B_Door',to:'A-DOOR'}]);
 assert.ok(layerMigrationNotice(r).includes(old('벽체')+' 레이어는 뷰포트 속성이 달라 그대로 두었습니다'));
});
test('skipped-only migrations report the reason without changing the document or undo history',()=>{
 const d=drawing();d.legacyLayerSafety=viewportSafety();const tab={doc:d,undoStack:[],view:{activeLayer:'old'}},r=migrateDrawingTabLayers(tab);
 assert.equal(r.changed,0);assert.equal(r.before,null);assert.equal(r.doc,d);assert.equal(tab.doc,d);assert.equal(tab.dirty,undefined);assert.deepEqual(tab.undoStack,[]);assert.equal(tab.view.activeLayer,'old');
 assert.equal(layerMigrationNotice(r),old('벽체')+' 레이어는 뷰포트 속성이 달라 그대로 두었습니다');assert.equal(migrateDrawingTabLayers(tab).changed,0);
});
test('matching viewport styles still merge',()=>{
 const d=drawing();d.legacyLayerSafety=viewportSafety(3,3);const r=prepareLegacyLayerMigration(d);
 assert.equal(r.changed,1);assert.equal(r.merged,1);assert.deepEqual(r.skipped,[]);assert.equal(r.doc.entities[0].layer,'target');
});
test('uncopyable block hazards retain their layer and shared objects',()=>{
 const d=drawing();d.legacyLayerSafety={uncopyableLayers:[old('벽체').toLowerCase()]};d.sharedBlocks={unit:{entities:[line('child','old')]}};
 const r=prepareLegacyLayerMigration(d);assert.equal(r.changed,0);assert.equal(r.doc,d);assert.equal(r.doc.sharedBlocks,d.sharedBlocks);assert.ok(layerMigrationNotice(r).includes('블록을 복제할 수 없어 그대로 두었습니다'));
});
test('a skipped first source does not reserve the destination for other legacy sources',()=>{
 const d=drawing();d.layers=d.layers.filter(l=>l.id!=='target');d.layers.push(layer('b','B_Wall'));d.entities.push(line('b-line','b'));d.legacyLayerSafety={uncopyableLayers:[old('벽체').toLowerCase()]};
 const r=prepareLegacyLayerMigration(d);assert.equal(r.changed,1);assert.equal(r.merged,0);assert.equal(r.doc.layers.find(l=>l.id==='old').name,old('벽체'));assert.equal(r.doc.layers.find(l=>l.id==='b').name,'A-WALL');assert.equal(r.doc.entities,d.entities);
});

test('unreleased layer names remain untouched',()=>{
 const d={...blankDocument(),layers:['A-SECT-SOIL','A-ELEV-BACK','A-ANNO-LEVL','A-ANNO-KEYP','A-BLDG-BELO'].map((name,i)=>layer(String(i),name)),entities:[]};
 for(const l of d.layers)assert.equal(legacyStandardName(l.name),null);
 const r=prepareLegacyLayerMigration(d);assert.equal(r.changed,0);assert.equal(r.doc,d);
});

test('three A-REF photos survive BCAD reopen, migration and one-step undo/redo unchanged',async()=>{
 const {encodeFull,decodeBcad,fileBytes}=await import('./bcad-store.js');
 const d={...blankDocument(),layers:[layer('photos','A-REF','#9a9a9a',{linetype:'CONTINUOUS',lineweight:.13,plot:false}),layer('below','B_Wall')],entities:[]};
 const photos=Array.from({length:3},(_,i)=>({id:'photo-'+i,type:'image',layer:'photos',path:'reference-'+i+'.png',data:'data:image/png;base64,AAAA',pixelWidth:200,pixelHeight:100,position:{x:i*400,y:20},width:400,height:200,rotation:i*10,fade:50}));
 d.entities.push(...photos,line('below-line','below'));
 const reopened=decodeBcad(fileBytes(encodeFull(d))).doc;
 const tab={doc:reopened,dirty:false,undoStack:[],redoStack:[],view:{activeLayer:'photos'}};
 const r=migrateDrawingTabLayers(tab);assert.equal(r.changed,1);
 assert.deepEqual(tab.doc.entities.slice(0,3),photos);assert.deepEqual(tab.doc.layers.find(l=>l.id==='photos'),d.layers[0]);
 assert.equal(tab.view.activeLayer,'photos');assert.equal(tab.undoStack.length,1);
 const engine=new DrawingEngine();engine.doc=tab.doc;engine.undoStack=tab.undoStack;engine.redoStack=[];
 const migrated=structuredClone(engine.doc);engine.execute({type:'undo'});assert.deepEqual(engine.doc,reopened);
 engine.execute({type:'redo'});assert.deepEqual(engine.doc,migrated);
 assert.deepEqual(decodeBcad(fileBytes(encodeFull(engine.doc))).doc,migrated);
 assert.equal(migrateDrawingTabLayers(tab).changed,0);
 assert.equal(prepareLegacyLayerMigration(migrated).changed,0);
});
