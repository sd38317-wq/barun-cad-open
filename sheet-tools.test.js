import test from 'node:test';
import assert from 'node:assert/strict';
import {renumberSheets,setSheetScale,alignSheetPlan,duplicateSheet,applyDrawingBatchEdit} from './sheet-tools.js';

const sheets=[
 {id:'b',number:'A-2',title:'둘',paper:'A3',denominator:100,bounds:{minX:200,minY:10,maxX:300,maxY:80}},
 {id:'a',number:'A-1',title:'하나',paper:'A3',denominator:100,bounds:{minX:20,minY:20,maxX:120,maxY:90}},
];
const doc={layers:[{id:'l',name:'기존',color:'#ffffff',lineweight:.25}],blocks:[],entities:[
 {id:'e1',type:'text',layer:'l',position:{x:30,y:30},height:10,text:'기존 평면'},
 {id:'e2',type:'line',layer:'l',sheetId:'b',points:[{x:210,y:20},{x:220,y:20}]},
]};

test('도곽 번호와 축척을 일괄 변경한다',()=>{
 const numbered=renumberSheets(sheets,{prefix:'A-',start:10,step:2,digits:3});
 assert.deepEqual(numbered.map(sheet=>sheet.number),['A-012','A-010']);
 const scaled=setSheetScale(numbered,{id:'a',denominator:200,paper:'A1'});
 assert.equal(scaled[1].denominator,200);assert.equal(scaled[1].paper,'A1');assert.equal(scaled[0].denominator,100);
});

test('도곽 정렬은 객체 이동과 새 경계를 함께 만든다',()=>{
 const plan=alignSheetPlan(doc,sheets,{direction:'horizontal',gap:50});
 assert.deepEqual(plan.sheets.find(sheet=>sheet.id==='a').bounds,{minX:0,minY:0,maxX:100,maxY:70});
 assert.deepEqual(plan.sheets.find(sheet=>sheet.id==='b').bounds,{minX:150,minY:0,maxX:250,maxY:70});
 assert.equal(plan.moves.length,2);
});

test('도곽 복사는 포함 객체와 도곽 연결값을 새로 만든다',()=>{
 let sequence=0;const result=duplicateSheet(doc,sheets[1],{number:'A-3',title:'복사',dx:200,dy:0,idFactory:()=>`new${++sequence}`});
 assert.equal(result.sheet.id,'new1');assert.equal(result.sheet.bounds.minX,220);assert.equal(result.entities.length,1);
 assert.equal(result.entities[0].sheetId,'new1');assert.equal(result.entities[0].position.x,230);
});

test('다중 도면 편집은 문자 블록 레이어 사본을 수정한다',()=>{
 const source={...doc,blocks:[{name:'문',entities:[]}],entities:[...doc.entities,{id:'b1',type:'block',layer:'l',name:'문',entities:[]}]};
 const text=applyDrawingBatchEdit(source,{action:'text',find:'기존',replace:'변경'});assert.equal(text.document.entities[0].text,'변경 평면');
 const block=applyDrawingBatchEdit(source,{action:'block',from:'문',to:'창'});assert.equal(block.document.entities[2].name,'창');
 const layer=applyDrawingBatchEdit(source,{action:'layer',from:'기존',to:'수정',color:'#112233',lineweight:.5});assert.equal(layer.document.layers[0].name,'수정');assert.equal(layer.document.layers[0].color,'#112233');
 assert.equal(source.entities[0].text,'기존 평면');
});
