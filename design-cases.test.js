import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {DrawingEngine} from './engine.js';

test('editable case has unlocked category layers, supports edits and undo',()=>{
 const source=JSON.parse(fs.readFileSync('data/aihub-71465/full-catalog/engine-test-editable.json','utf8'));
 const engine=new DrawingEngine();const before=structuredClone(engine.doc);
 const ids=engine.execute({type:'design.import',reference:true,documents:[source]});
 assert.equal(ids.length,source.entities.length);
 assert.equal(engine.doc.designCaseImports[0].sourceCase,source.metadata.sourceCase);
 assert.equal(engine.doc.designCaseImports[0].scaleVerified,source.metadata.scaleVerified);
 assert.ok(engine.doc.layers.every(l=>!l.locked));
 assert.ok(engine.doc.entities.every(e=>e.referenceOnly===false));
 const placed=structuredClone(engine.doc);
 engine.execute({type:'move',ids:[ids[0]],dx:500,dy:200});
 assert.notDeepEqual(engine.doc.entities[0],placed.entities[0]);
 engine.execute({type:'undo'});assert.deepEqual(engine.doc,placed);
 engine.validate(engine.doc);engine.execute({type:'undo'});assert.deepEqual(engine.doc,before);
});
test('reference insertion preserves existing geometry and can be undone',()=>{
 const source=JSON.parse(fs.readFileSync('data/aihub-71465/full-catalog/engine-test-reference.json','utf8'));
 const engine=new DrawingEngine();engine.execute({type:'add',entity:{id:'existing',type:'line',layer:'default',points:[{x:0,y:0},{x:100,y:0}]}});
 const before=structuredClone(engine.doc);const ids=engine.execute({type:'design.import',reference:true,documents:[source]});
 assert.equal(ids.length,source.entities.length);assert.deepEqual(engine.doc.entities.find(e=>e.id==='existing'),before.entities[0]);
 assert.ok(engine.doc.layers.some(l=>l.name.startsWith('설계사례_')));
 assert.ok(engine.doc.entities.filter(e=>e.id!=='existing').every(e=>e.referenceOnly));
 engine.validate(engine.doc);engine.execute({type:'undo'});assert.deepEqual(engine.doc,before);
});
