import test from 'node:test';
import assert from 'node:assert/strict';
import {replaceBlock,cleanBlockDefinitions,blockCounts} from './block-tools.js';

const layer='default';
const source={id:'source',type:'block',name:'문',layer,position:{x:0,y:0},entities:[{id:'line',type:'line',layer,points:[{x:-10,y:0},{x:10,y:0}]}]};
test('블록 교체는 대상 위치와 ID를 유지하고 원본 모양을 복사한다',()=>{
 const target={id:'target',type:'block',name:'창',layer,position:{x:100,y:200},rotation:90,entities:[{id:'old',type:'circle',layer,center:{x:100,y:200},radius:5}]};
 const result=replaceBlock(source,target);assert.equal(result.id,'target');assert.equal(result.name,'문');assert.deepEqual(result.position,{x:100,y:200});assert.equal(result.entities[0].id,undefined);assert.deepEqual(result.entities[0].points,[{x:100,y:190},{x:100,y:210}]);
});

test('사용하지 않는 블록 정의만 정리한다',()=>{
 const doc={entities:[source],blocks:[{name:'문',entities:[]},{name:'안씀',entities:[]}]};const result=cleanBlockDefinitions(doc);
 assert.deepEqual(result.blocks.map(block=>block.name),['문']);assert.deepEqual(result.removed,['안씀']);
});

test('중첩 블록 이름별 수량을 집계한다',()=>{
 const entities=[source,{...source,id:'two',entities:[{type:'block',name:'손잡이',layer,entities:[]}]}];
 assert.deepEqual(blockCounts(entities),[{name:'문',count:2},{name:'손잡이',count:1}]);
});
