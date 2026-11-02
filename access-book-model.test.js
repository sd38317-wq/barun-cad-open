import test from 'node:test';
import assert from 'node:assert/strict';
import {cropDocument,buildAccessModel,flattenStories,planMarks} from './access-book-model.js';
import {accessFacility} from './permit-book.js';

const layers=[{id:'w',name:'A-WALL'},{id:'s',name:'A-STRS'}];
const line=(id,layer,a,b)=>({id,type:'line',layer,points:[{x:a[0],y:a[1]},{x:b[0],y:b[1]}]});
test('층 범위로 자르기: 범위 안에 다 들어간 객체만',()=>{
 const doc={units:'mm',layers,entities:[line('a','w',[0,0],[10,0]),line('b','w',[0,0],[50,0])]};
 assert.deepEqual(cropDocument(doc,[-1,-1,20,20]).entities.map(e=>e.id),['a']);
});
test('건물 모델: 층 id 를 붙이고, 계단 레이어만 있으면 계단 후보 하나, ④ 실측값은 그 항목 후보에만',()=>{
 const f1={id:'1층',name:'1층',doc:{layers,entities:[line('s1','s',[0,0],[1000,0]),line('s2','s',[0,500],[1000,500])]},elements:[{id:'recognize-x',kind:'accessible_wc',position:[5,5]}]};
 const m=buildAccessModel({floors:[f1],accessibility:{facilities:{toilet:{values:{width:1600},verified:true}}},itemKinds:{toilet:['accessible_wc'],stairsOrElevator:['stair']},date:'2026-10-25'});
 assert.deepEqual(m.elements.map(e=>[e.id,e.kind,e.story]),[['1층:recognize-x','accessible_wc','1층'],['1층:stair','stair','1층']]);
 assert.equal(m.elements[0].width,1600);assert.equal(m.elements[1].width,undefined);
 assert.equal(m.drawingDate,'2026-10-25');assert.equal(m.accessibility.facilities.toilet.verified,true);
 assert.deepEqual(flattenStories(m).elements.map(e=>e.story),['ALL','ALL']);
});
test('계획도 기호: 새로 생긴 것 중 오른쪽 범례·표(표 상자 왼쪽 - 글자 12개)보다 왼쪽만',()=>{
 const r={document:{layers,entities:[line('old','w',[0,0],[1,0]),line('mark','w',[100,0],[200,0]),line('legend','w',[9000,0],[9500,0])]},plan:{tableBox:{minX:10000}}};
 assert.deepEqual(planMarks(r,new Set(['old']),120).entities.map(e=>e.id),['mark']);
});
test('② 조건 정리: 숫자·공사 종류·기준일',()=>{
 assert.deepEqual(accessFacility({use:'office',areaM2:'1000',work:'x',parkingSpaces:'20.7',parkingRatio:0.03},{date:'2026-10-25'}),{use:'office',areaM2:1000,work:'new',date:'2026-10-25',parkingSpaces:20,parkingRatio:0.03});
 assert.equal(accessFacility({areaM2:''}).areaM2,null);
});
