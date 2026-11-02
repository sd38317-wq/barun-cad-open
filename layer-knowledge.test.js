import {layerNameLabel} from './layer-knowledge.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import Ajv from 'ajv';
import {DrawingEngine} from './engine.js';
import {classifyByLayerKnowledge,LAYER_KNOWLEDGE} from './layer-knowledge.js';
import {stageActions} from './ai-actions.js';
const line=id=>({id,type:'line',layer:'default',points:[{x:0,y:0},{x:1000,y:0}]});

test('whole catalog coverage and JSON schema',()=>{
 const schema=JSON.parse(fs.readFileSync('rules/knowledge/layer-knowledge.schema.json','utf8'));
 const validate=new Ajv({strict:false}).compile(schema);
 assert.ok(validate(LAYER_KNOWLEDGE),JSON.stringify(validate.errors));
 assert.equal(LAYER_KNOWLEDGE.coverage.catalogRows,43219);
 assert.equal(LAYER_KNOWLEDGE.classRules.reduce((n,r)=>n+r.objects,0),2709827);
 assert.ok(LAYER_KNOWLEDGE.classRules.every(r=>r.target));
});
test('all annotated classes map with provenance, preserving space meaning',()=>{
 for(const r of LAYER_KNOWLEDGE.classRules){
  const e={...line(r.id),type:r.className==='OCR'?'text':'polyline',name:r.className,sourceCase:r.sourceExamples[0],sourceAnnotation:1};
  const result=classifyByLayerKnowledge(e,{name:'기본'});
  // 위생기구는 표준 '위생'(A-SANI)으로 모은다(2026-10-10). 나머지는 자료의 분류 그대로.
  assert.equal(result.label,r.target==='위생기구'?'위생':r.target);assert.equal(result.accepted,true);
 }
 assert.equal(LAYER_KNOWLEDGE.classRules.find(r=>r.className==='공간_계단실').target,'공간_계단실');
});
test('unfamiliar layer names and substrings do not force classification',()=>{
 for(const name of ['WINDOWSILLDETAILS','WALLPAPER','DIMMER','RED','0'])assert.equal(classifyByLayerKnowledge(line('x'),{name}),null);
 const result=classifyByLayerKnowledge(line('x'),{name:'A-WALL'});
 assert.equal(result.label,'벽체');assert.equal(result.accepted,false);
 const unverified=classifyByLayerKnowledge({...line('x'),name:'구조_벽체'},{name:'0'});
 assert.equal(unverified.accepted,false);
});
test('contradictory evidence abstains instead of highest-score winner',()=>{
 const result=classifyByLayerKnowledge({...line('x'),type:'text'},{name:'A-WALL'});
 assert.equal(result.evidenceKind,'conflict');assert.equal(result.accepted,false);assert.equal(result.label,null);
 const native=classifyByLayerKnowledge({...line('x'),type:'wall',category:'WINDOW'},{name:'0'});
 assert.equal(native.evidenceKind,'conflict');
});
test('automatic operation preserves uncertain protected objects and exact undo',()=>{
 const engine=new DrawingEngine();engine.doc.entities=[
  {...line('wall'),name:'구조_벽체',sourceCase:'case',sourceAnnotation:1},
  line('unknown'),{...line('reference'),type:'text',text:'A',position:{x:0,y:0},height:10,referenceOnly:true},
  {...line('hidden'),type:'text',text:'B',position:{x:0,y:0},height:10,hidden:true}];
 const before=structuredClone(engine.doc);
 const result=engine.execute({type:'layer.auto'});
 assert.equal(result.changed,1);assert.equal(result.review,1);assert.equal(result.excluded,2);
 assert.deepEqual(engine.doc.entities[0].points,before.entities[0].points);
 assert.deepEqual(engine.doc.entities.slice(1),before.entities.slice(1));
 engine.execute({type:'undo'});assert.deepEqual(engine.doc,before);
});
test('locked destination rolls back whole transaction',()=>{
 const engine=new DrawingEngine();engine.doc.layers.push({id:'lock',name:'A-TEXT',locked:true,visible:true});
 engine.doc.entities=[{...line('wall'),type:'door'},{...line('text'),type:'text',text:'A',position:{x:0,y:0},height:10}];
 const before=structuredClone(engine.doc);
 assert.throws(()=>engine.execute({type:'layer.auto'}));assert.deepEqual(engine.doc,before);
});
test('AI action stages changes without changing source',()=>{
 const engine=new DrawingEngine();engine.doc.entities=[{...line('text'),type:'text',text:'A',position:{x:0,y:0},height:10},line('unknown')];
 const before=structuredClone(engine.doc);
 const result=stageActions(engine,{ask:null,actions:[{cmd:'layer_auto',args:{}}]});
 assert.deepEqual(engine.doc,before);assert.match(result.summary,/정리 1개 · 검토 1개/);
 assert.notEqual(result.document.entities[0].layer,'default');
});

test('canonical material, hatch, grid and learned layer names keep their exact source meaning',()=>{
 for(const [name,label] of [['A-WALL-MASN','조적'],['A-WALL-CONC','콘크리트벽'],['A-COL','기둥'],['A-HATCH','해치'],['A-GRID','축선'],['A-AREA-ENTRY','공간_현관']]){assert.equal(layerNameLabel({name}),label);assert.equal(classifyByLayerKnowledge(line('canonical'),{name}).label,label);}
 const engine=new DrawingEngine();engine.doc.layers.push({id:'material',name:'A-WALL-MASN',color:'#ff7f00',visible:true,locked:false});engine.doc.entities=[{...line('material-line'),layer:'material'}];engine.execute({type:'layer.auto'});assert.equal(engine.doc.layers.find(l=>l.id===engine.doc.entities[0].layer).name,'A-WALL-MASN');
});
