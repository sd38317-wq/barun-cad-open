import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import Ajv from 'ajv';
import {rankLayerCandidates,LAYER_RANKING} from './layer-ranking.js';
import {DrawingEngine} from './engine.js';
import {analyzeRankedDrawingLayers,layerDictionaryFromDecisions} from './architecture.js';
const line=(id,y=0)=>({id,type:'line',layer:'default',points:[{x:0,y},{x:3000,y}]});
test('config and decision conform to schemas, score sums to one',()=>{
 const ajv=new Ajv({strict:false});
 const read=p=>JSON.parse(fs.readFileSync('rules/knowledge/'+p,'utf8'));
 assert.ok(ajv.validate(read('layer-ranking.schema.json'),LAYER_RANKING));
 const result=rankLayerCandidates(line('x'),{name:'A-WALL'});
 assert.ok(ajv.validate(read('layer-decision.schema.json'),result),JSON.stringify(ajv.errors));
 assert.ok(Math.abs(result.candidates.reduce((n,c)=>n+c.score,0)-1)<1e-12);
 assert.ok(Math.abs(Object.values(LAYER_RANKING.priors).reduce((a,b)=>a+b,0)-1)<1e-12);
});
test('unfamiliar drawing name and supporting geometry choose highest candidate',()=>{
 const a=rankLayerCandidates(line('x'),{name:'OFFICE-A-WALL'});
 const b=rankLayerCandidates(line('x'),{name:'OFFICE-A-WALL'},[{label:'벽체',confidence:.72,reason:'parallel wall pair'}],true);
 assert.equal(a.label,'벽체');assert.ok(a.accepted);
 assert.equal(b.label,'벽체');assert.ok(b.accepted);assert.ok(b.modelScore>a.modelScore);
});
test('large wall prior alone never moves unknown lines',()=>{
 const r=rankLayerCandidates(line('x'),{name:'0'});
 assert.equal(r.label,null);assert.equal(r.accepted,false);
});
test('close rivals retain original; contradictory native evidence retains original',()=>{
 const r=rankLayerCandidates(line('x'),{name:'WALL-DOOR'});
 assert.ok(r.label);assert.equal(r.accepted,false);assert.ok(r.margin<LAYER_RANKING.minimumMargin);
 const strong=rankLayerCandidates({...line('x'),type:'wall',category:'WINDOW'},{name:'0'});
 assert.equal(strong.accepted,false);assert.match(strong.reason,/충돌/);
});
test('duplicate geometry does not manufacture independent evidence',()=>{
 const g={label:'벽체',confidence:.72,reason:'pair'};
 const a=rankLayerCandidates(line('x'),{name:'0'},[g],true);
 const b=rankLayerCandidates(line('x'),{name:'0'},Array(20).fill(g),true);
 assert.equal(a.modelScore,b.modelScore);
});
// 2026-10-09 사용자 결정: 모양만으로는 벽·문·창을 옮기지 않는다(실제 사무소 평면도에서 모양 규칙 정확도 9~25%).
test('shape alone (door arc + leaf) no longer moves objects; nothing changes and undo stays exact',()=>{
 const e=new DrawingEngine();e.doc.entities=[{id:'arc',type:'arc',layer:'default',center:{x:0,y:0},radius:900,startAngle:0,endAngle:90},
  {id:'leaf',type:'line',layer:'default',points:[{x:0,y:0},{x:0,y:900}]}];
 const before=structuredClone(e.doc),r=e.execute({type:'layer.auto'});
 assert.equal(r.changed,0);assert.ok(r.decisions.every(d=>!d.accepted&&!d.geometryEvaluated));
 e.execute({type:'undo'});assert.deepEqual(e.doc,before);
});
test('wall-like line pair stays as it is (no shape guessing); every alternative is still ranked',()=>{
 const e=new DrawingEngine();e.doc.entities=[line('a'),line('b',200)];
 const results=analyzeRankedDrawingLayers(e.doc);
 assert.ok(results.every(r=>!r.accepted));
 assert.ok(results.every(r=>r.candidates.length===Object.keys(LAYER_RANKING.priors).length+1));
});

test('layer unit: a DIM layer moves whole (its text stays with dimensions); a mixed layer only gives up text/dimension/hatch',()=>{
 const doc={units:'mm',layers:[{id:'dim',name:'DIM',visible:true},{id:'zero',name:'0',visible:true}],entities:[
  {id:'t1',type:'text',layer:'dim',text:'3000',position:{x:0,y:0},height:200},{id:'l1',type:'line',layer:'dim',points:[{x:0,y:0},{x:1,y:0}]},
  {id:'t2',type:'text',layer:'zero',text:'거실',position:{x:0,y:0},height:200},{id:'l2',type:'line',layer:'zero',points:[{x:0,y:0},{x:1000,y:0}]}]};
 const by=new Map(analyzeRankedDrawingLayers(doc).map(d=>[d.id,d]));
 assert.equal(by.get('t1').label,'치수');assert.ok(by.get('t1').accepted&&by.get('l1').accepted&&by.get('l1').label==='치수');
 assert.equal(by.get('t2').label,'문자');assert.ok(by.get('t2').accepted);
 assert.ok(!by.get('l2').accepted,'unknown line on layer 0 stays');
});

test('office dictionary: a layer name decided once is used next time (xref-bound names too) and learned back',()=>{
 const doc={units:'mm',layers:[{id:'g',name:'평면도$0$GUN',visible:true}],entities:[{id:'a',type:'line',layer:'g',points:[{x:0,y:0},{x:1000,y:0}]}]};
 assert.ok(!analyzeRankedDrawingLayers(doc)[0].accepted);
 const decisions=analyzeRankedDrawingLayers(doc,{dictionary:{GUN:'벽체'}});
 assert.equal(decisions[0].label,'벽체');assert.ok(decisions[0].accepted);
 assert.deepEqual(layerDictionaryFromDecisions(doc,decisions),{GUN:'벽체'});
});
