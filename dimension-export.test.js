import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareDimensionExport} from './dimension-export.js';
import {dimensionParts} from './geometry.js';
import {createEngineApi} from './studio.js';
const P=(x,y)=>({x,y});
const dim=(mode='horizontal')=>({type:'dimension',mode,textHeight:20,scale:2,arrowSize:10,points:[P(0,0),P(1000,0),P(0,300)]});

test('ordinary documents retain their objects on export',()=>{
 const document={entities:[dim()],blocks:[]};assert.equal(prepareDimensionExport(document),document);
});
test('broken display geometry is recomputed for each save without mutating the live drawing',()=>{
 const e={...dim(),breaks:[{partIndex:2,start:.4,end:.6}],dimensionDisplayParts:[{type:'line',points:[P(-1,-1),P(-2,-2)]}]};
 const document={entities:[e],blocks:[]},before=structuredClone(document);
 const exported=prepareDimensionExport(document);assert.deepEqual(document,before);assert.notEqual(exported,document);
 assert.deepEqual(exported.entities[0].dimensionDisplayParts,dimensionParts(e));
 e.points[2]=P(0,600);const next=prepareDimensionExport(document);
 assert.notDeepEqual(next.entities[0].dimensionDisplayParts,exported.entities[0].dimensionDisplayParts);
 e.breaks=[];assert.equal('dimensionDisplayParts' in prepareDimensionExport(document).entities[0],false);
});
test('nested and shared definitions get native display geometry with untouched ordinary siblings',()=>{
 const e={...dim('ordinateX'),points:[P(0,0),P(300,400),P(500,1200)]},ordinary={type:'line',points:[P(0,0),P(10,10)]};
 const block={type:'block',entities:[e,ordinary]},document={entities:[block],blocks:[block],sharedBlocks:{a:{origin:P(0,0),entities:[e]}}};
 const result=prepareDimensionExport(document);assert.deepEqual(result.entities[0].entities[0].dimensionDisplayParts,dimensionParts(e));
 assert.equal(result.entities[0].entities[1],ordinary);assert.ok(result.blocks[0].entities[0].dimensionDisplayParts.length);
 assert.ok(result.sharedBlocks.a.entities[0].dimensionDisplayParts.length);assert.equal(document.entities[0].entities[0].dimensionDisplayParts,undefined);
});
test('engine API exports prepare dimension geometry, BCAD leaves parametric document intact',async()=>{
 const payloads=[],e=dim('ordinateY'),document={entities:[e],blocks:[]};
 const api=createEngineApi({fetch:async(url,options)=>{if(url==='/api/status')return {ok:true,json:async()=>({token:'token',dxf:true})};payloads.push(JSON.parse(options.body));return {ok:true,status:200,json:async()=>({data:''})};}});
 await api.api('export',{document});assert.deepEqual(payloads[0].document.entities[0].dimensionDisplayParts,dimensionParts(e));
 await api.api('export',{document,format:'bcad'});assert.equal(payloads[1].document.entities[0].dimensionDisplayParts,undefined);
 assert.equal(document.entities[0].dimensionDisplayParts,undefined);
});
