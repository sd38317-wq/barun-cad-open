import test from 'node:test';
import assert from 'node:assert/strict';
import {DrawingEngine} from './engine.js';
import {displayFor,setStatusCommand,setViewCommand,statusCounts} from './renovation.js';
import {ifcPayload} from './bim-envelope.js';

const line=(id,extra={})=>({id,type:'line',layer:'default',points:[{x:0,y:0},{x:1000,y:0}],...extra});
function drawing(){
 const e=new DrawingEngine();
 for(const entity of [line('old'),line('gone',{color:'#00ff00'}),line('fresh'),line('plain')])e.execute({type:'add',entity});
 e.execute(setStatusCommand(e.doc,['old'],'existing'));e.execute(setStatusCommand(e.doc,['gone'],'demolish'));e.execute(setStatusCommand(e.doc,['fresh'],'new'));
 return e;
}
const get=(e,id)=>e.doc.entities.find(x=>x.id===id);

test('보기마다 보일 것: 현황도는 신설을, 계획도는 철거를 숨긴다',()=>{
 const base={color:null,linetype:null,hidden:false};
 assert.equal(displayFor('new','survey',base).hidden,true);
 assert.equal(displayFor('new','demolition',base).hidden,true);
 assert.equal(displayFor('demolish','plan',base).hidden,true);
 assert.deepEqual(displayFor('demolish','all',base),{color:'#ff5c5c',linetype:'DASHED',hidden:false});
 assert.deepEqual(displayFor('existing','survey',base),base);
});

test('상태를 붙이면 전체 보기에서 기존은 회색, 신설은 파랑, 철거는 빨간 점선, 상태 없는 객체는 그대로',()=>{
 const e=drawing();
 assert.equal(get(e,'old').color,'#9aa4aa');
 assert.deepEqual([get(e,'gone').color,get(e,'gone').linetype],['#ff5c5c','DASHED']);
 assert.equal(get(e,'fresh').color,'#7fb0ff');
 assert.equal(get(e,'plain').renovation,undefined);
 assert.deepEqual(statusCounts(e.doc),{existing:1,demolish:1,new:1});
});

test('계획도로 바꾸면 철거만 숨고, 되돌리기 한 번에 전체 보기로 돌아온다',()=>{
 const e=drawing();
 e.execute(setViewCommand(e.doc,'plan'));
 assert.equal(get(e,'gone').hidden,true);assert.equal(get(e,'fresh').hidden,undefined);assert.equal(e.doc.reviewSettings.renovationView,'plan');
 e.execute({type:'undo'});
 assert.equal(get(e,'gone').hidden,undefined);assert.equal(e.doc.reviewSettings?.renovationView??'all','all');
});

test('표시를 떼면 원래 색으로 돌아온다',()=>{
 const e=drawing();
 e.execute(setStatusCommand(e.doc,['gone'],null));
 assert.deepEqual([get(e,'gone').color,get(e,'gone').linetype,get(e,'gone').renovation],['#00ff00',undefined,undefined]);
});

test('보기 적용 뒤 사용자가 바꾼 색은 새 원래 색이 된다',()=>{
 const e=drawing();
 // 신설은 전체 보기에서 늘 파랑으로 덮이므로(2026-10-26) 원래 색이 그대로 보이는 현황도의 철거 객체로 본다.
 e.execute({type:'update',ids:['gone'],changes:{color:'#0000ff'}});
 e.execute(setViewCommand(e.doc,'survey'));
 assert.equal(get(e,'gone').color,'#0000ff');
});

test('IFC 에서는 철거할 벽을 뺀다',()=>{
 const e=new DrawingEngine();
 e.execute({type:'add',entity:{id:'w1',type:'wall',layer:'default',points:[{x:0,y:0},{x:4000,y:0}],thickness:200}});
 e.execute({type:'add',entity:{id:'w2',type:'wall',layer:'default',points:[{x:0,y:3000},{x:4000,y:3000}],thickness:200}});
 e.execute(setStatusCommand(e.doc,['w2'],'demolish'));
 assert.deepEqual(ifcPayload(e.doc).walls.map(w=>w.id),['w1']);
});
