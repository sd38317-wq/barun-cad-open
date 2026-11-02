import test from 'node:test';
import assert from 'node:assert/strict';
import {DrawingEngine} from './engine.js';
import {migrateLegacyLayerNames,standardLayers} from './architecture.js';
test('standard layer names are short English names',()=>{
 const names=standardLayers().map(layer=>layer.name);
 assert.ok(names.includes('A-WALL'));assert.ok(names.includes('A-DIM'));
 assert.ok(names.every(name=>/^[AS]-[A-Z0-9-]+$/.test(name)),'모든 표준 레이어는 AutoCAD 방식 이름이다');
});
test('old standard layer names merge into a single A layer',()=>{
 const doc={layers:[{id:'a',name:'A-WALL'},{id:'b',name:['바른','벽체'].join('_')},{id:'c',name:'B_Dim'}]};
 assert.equal(migrateLegacyLayerNames(doc),2);
 assert.deepEqual(doc.layers.map(layer=>layer.name),['A-WALL','A-DIM']);
});
test('standardization preserves geometry and can undo all layer changes together',()=>{
 const e=new DrawingEngine();
 e.doc.layers.push({...e.doc.layers[0],id:'walls',name:'WALL_OLD',color:'#ffffff'});  // 표준 이름이 아닌 옛 벽 레이어
 e.doc.entities.push({id:'a',type:'line',layer:'walls',points:[{x:0,y:0},{x:100,y:0}]},{id:'b',type:'line',layer:'default',points:[{x:0,y:5},{x:100,y:5}]});
 const before=structuredClone(e.doc);
 const result=e.execute({type:'layer.organize'});
 assert.equal(result.changed,2);assert.equal(result.review,1);
 assert.equal(e.doc.layers.find(l=>l.id===e.doc.entities[0].layer).name,'A-WALL');
 assert.deepEqual(e.doc.entities[0].points,before.entities[0].points);
 e.execute({type:'undo'});assert.deepEqual(e.doc,before);
});
test('locked source remains intact',()=>{
 const e=new DrawingEngine();e.doc.layers[0].locked=true;
 e.doc.entities.push({id:'a',type:'line',layer:'default',points:[{x:0,y:0},{x:100,y:0}]});
 assert.equal(e.execute({type:'layer.organize'}).skipped,1);
 assert.equal(e.doc.entities[0].layer,'default');
});

