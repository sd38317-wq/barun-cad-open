import test from 'node:test';
import assert from 'node:assert/strict';
import {DrawingEngine} from './engine.js';
import * as G from './geometry.js';
import {autoDimensionBreaks,withAutoBreaks,buildBreakIndex,dimensionBreakCandidates,needsBreakRefresh,refreshAutoBreaks,installDimensionExtra} from './dimension-extra.js';

const P=(x,y)=>({x,y});
const dimension=()=>({type:'dimension',mode:'horizontal',textHeight:10,points:[P(0,0),P(1000,0),P(500,-300)]});
const cutter=(x,id)=>({...(id?{id}:{}),type:'line',points:[P(x,-500),P(x,-100)]});
const near=(a,b,eps=1e-9)=>assert.ok(Math.abs(a-b)<=eps,`${a} ≈ ${b}`);

test('자동 끊기: 실제로 끊은 객체만 breakBy 에 남기고, 손 끊김은 다시 계산해도 그대로',()=>{
 const dim={...dimension(),id:'d',breaks:[{partIndex:0,start:.1,end:.15}]};
 const r=autoDimensionBreaks(dim,[cutter(500,'a'),{id:'far',type:'line',points:[P(5000,0),P(5000,10)]}]);
 assert.deepEqual(r.breakBy,['a']);assert.equal(r.breaks.length,1);assert.equal(r.breaks[0].auto,true);
 const changes=withAutoBreaks(dim,r);
 assert.equal(changes.breakMode,'auto');assert.equal(changes.breaks.length,2);assert.deepEqual(changes.breaks[0],{partIndex:0,start:.1,end:.15});
 const again=withAutoBreaks({...dim,...changes},r);assert.equal(again.breaks.length,2,'자동 끊김이 겹쳐 쌓이지 않는다');
 assert.equal(needsBreakRefresh({...dim,...changes},new Set(['a'])),true);assert.equal(needsBreakRefresh({...dim,...changes},new Set(['x'])),false);
});

test('공간 색인은 치수 상자에 걸치는 객체만 후보로 준다(20000 객체 중 몇 개)',()=>{
 const entities=[];for(let i=0;i<20000;i++)entities.push({id:'n'+i,type:'line',points:[P(10000+i*10,0),P(10000+i*10,50)]});
 entities.push({id:'hit',...cutter(400)});
 const dim={...dimension(),id:'d'},index=buildBreakIndex(entities);
 assert.equal(buildBreakIndex(entities),index,'같은 도면 배열이면 색인을 다시 쓴다');
 const candidates=dimensionBreakCandidates(dim,index);
 assert.deepEqual(candidates.map(e=>e.id),['hit']);
 const r=autoDimensionBreaks(dim,candidates);assert.deepEqual(r.breakBy,['hit']);
});

test('끊는 객체를 옮기면 엔진 동기화가 그 치수의 끊김만 다시 계산한다(되돌리기 한 번에 같이)',()=>{
 const engine=new DrawingEngine(),layer=engine.doc.layers[0].id;
 const [cid]=engine.execute({type:'add',entity:{...cutter(500),layer}});
 const [did]=engine.execute({type:'add',entity:{...dimension(),layer}});
 const [other]=engine.execute({type:'add',entity:{type:'line',layer,points:[P(0,3000),P(10,3000)]}});
 const dim=()=>engine.doc.entities.find(e=>e.id===did);
 const r=autoDimensionBreaks(dim(),[engine.doc.entities.find(e=>e.id===cid)]);
 engine.execute({type:'update',ids:[did],changes:withAutoBreaks(dim(),r)});
 const t=b=>(b.start+b.end)/2;
 near(t(dim().breaks[0]),.5);
 engine.execute({type:'move',ids:[other],dx:1,dy:0});assert.equal(engine.lastExecution.lightweight,true,'관계없는 객체는 가벼운 경로');
 engine.execute({type:'move',ids:[cid],dx:200,dy:0});assert.equal(engine.lastExecution.lightweight,true,'끊는 객체를 옮겨도 가벼운 경로(역색인)');
 near(t(dim().breaks[0]),.7);
 engine.execute({type:'move',ids:[cid],dx:5000,dy:0});
 assert.equal(dim().breaks.length,0,'멀어지면 끊김이 사라진다');assert.deepEqual(dim().breakBy,[cid],'다시 겹치면 돌아오도록 참조는 남긴다');
 engine.execute({type:'undo'});near(t(dim().breaks[0]),.7);
 engine.execute({type:'move',ids:[did],dx:100,dy:0});assert.equal(engine.lastExecution.lightweight,true,'치수만 옮기기는 가벼운 경로');
 near(t(dim().breaks[0]),.6,1e-9);
 engine.execute({type:'delete',ids:[cid]});assert.equal(dim().breaks.length,0);assert.deepEqual(dim().breakBy,[]);
});

test('refreshAutoBreaks: breakBy 객체만 보고 지워진 객체는 뺀다',()=>{
 const dim={...dimension(),id:'d',breakMode:'auto',breakBy:['a','gone'],breaks:[]};
 const r=refreshAutoBreaks(dim,id=>id==='a'?cutter(250,'a'):null);
 assert.deepEqual(r.breakBy,['a']);near((r.breaks[0].start+r.breaks[0].end)/2,.25);
 assert.equal(refreshAutoBreaks({...dim,breakMode:undefined},()=>null),null);
});

test('DIMBREAK 자동: 결과에 breakMode·breakBy 를 저장한다',async()=>{
 const engine=new DrawingEngine(),layer=engine.doc.layers[0].id;
 const [cid]=engine.execute({type:'add',entity:{...cutter(500),layer}});
 const [did]=engine.execute({type:'add',entity:{...dimension(),layer}});
 const ctx={entities:()=>engine.doc.entities,layers:()=>engine.doc.layers,doc:()=>engine.doc,selected:()=>engine.doc.entities.filter(e=>e.id===did),execute:c=>engine.execute(c),
  pickPoint:async()=>({option:'A'}),confirmDimensionBreak:async()=>true};
 await installDimensionExtra(ctx).DIMBREAK();
 const d=engine.doc.entities.find(e=>e.id===did);
 assert.equal(d.breakMode,'auto');assert.deepEqual(d.breakBy,[cid]);assert.equal(d.breaks.length,1);
 engine.execute({type:'move',ids:[cid],dx:-300,dy:0});
 const moved=engine.doc.entities.find(e=>e.id===did);near((moved.breaks[0].start+moved.breaks[0].end)/2,.2);
 assert.ok(G.dimensionParts(moved).length>G.dimensionBaseParts(moved).length,'그릴 때 끊긴 자리가 빠진다');
});
