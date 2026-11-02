import test from 'node:test';
import assert from 'node:assert/strict';
import {DrawingEngine} from './engine.js';
import * as G from './geometry.js';
import {entityIndex} from './entity-index.js';
import {assocPoint,assocRefAt,assocFromPicks,refreshAssocDimension,syncAssociativeDimensions,reassociatePoint,lostAssocSummary,installDimAssoc,radialAssoc,definingCount} from './dim-assoc.js';

const P=(x,y)=>({x,y});
const snapPick=(p,id)=>{const q={...p};Object.defineProperty(q,'snapEntityId',{value:id,enumerable:false});return q;};
// 엔진은 새 객체에 id 를 새로 매긴다: 시험에서는 이름(L·X·D·C·R)으로 실제 id 를 찾는다.
function named(engine){const ids={};return {ids,add(name,entity){const [id]=engine.execute({type:'add',entity});ids[name]=id;return id;}};}
function setup(){
 const engine=new DrawingEngine(),layer=engine.doc.layers[0].id,n=named(engine);
 const L=n.add('L',{type:'line',layer,points:[P(0,0),P(1000,0)]});n.add('X',{type:'line',layer,points:[P(0,500),P(1000,500)]});
 n.add('D',{type:'dimension',mode:'horizontal',textHeight:150,layer,points:[P(0,0),P(1000,0),P(500,-300)],assoc:[{id:L,ref:'vertex',index:0},{id:L,ref:'vertex',index:1}]});
 const id=name=>n.ids[name]||name;
 return {engine,layer,id,get:name=>engine.doc.entities.find(e=>e.id===id(name)),dim:()=>engine.doc.entities.find(e=>e.id===n.ids.D)};
}

test('특징점 찾기: 꼭짓점·중점·중심·사분점·호 끝, 스냅과 같은 계산',()=>{
 const pl={id:'p',type:'polyline',closed:true,points:[P(0,0),P(100,0),P(100,50),P(0,50)]};
 assert.deepEqual(assocRefAt(pl,P(100,50)),{id:'p',ref:'vertex',index:2});
 assert.deepEqual(assocRefAt(pl,P(0,25)),{id:'p',ref:'mid',index:3},'닫힌 구간의 가운데');
 const c={id:'c',type:'circle',center:P(10,10),radius:5};
 assert.deepEqual(assocRefAt(c,P(10,10)),{id:'c',ref:'center'});
 assert.deepEqual(assocRefAt(c,G.add(P(10,10),G.polar(5,90))),{id:'c',ref:'quadrant',index:1});
 const a={id:'a',type:'arc',center:P(0,0),radius:10,startAngle:0,endAngle:90};
 assert.equal(assocRefAt(a,G.add(P(0,0),G.polar(10,90))).ref,'end');
 assert.equal(assocRefAt(pl,P(37,12)),null,'특징점이 아니면 연관하지 않는다');
 assert.equal(assocRefAt({id:'b',type:'polyline',points:[P(0,0),P(10,0)],bulges:[0.5]},P(5,0)),null,'곡선 구간의 현 가운데는 중점이 아니다');
 const picks=[snapPick(P(0,0),'p'),P(5,5)];assert.deepEqual(assocFromPicks(picks,id=>id==='p'?pl:null),[{id:'p',ref:'vertex',index:0},null]);
 assert.equal(JSON.stringify(picks[0]),'{"x":0,"y":0}','숨은 속성이라 저장 파일에 새지 않는다');
});

test('원본을 늘리면 치수 값이 따라가고, 원본을 통째로 옮기면 치수선도 같이 온다(모양 유지)',()=>{
 const {engine,dim,id,get}=setup();
 engine.execute({type:'update',ids:[id('L')],changes:{points:[P(0,0),P(1500,0)]}});
 assert.deepEqual(dim().points[1],P(1500,0));assert.deepEqual(dim().points[2],P(500,-300),'모양이 바뀌면 치수선 위치는 그대로');
 engine.execute({type:'move',ids:[id('L')],dx:100,dy:200});
 assert.deepEqual(dim().points,[P(100,200),P(1600,200),P(600,-100)]);
 engine.execute({type:'undo'});
 assert.deepEqual(dim().points,[P(0,0),P(1500,0),P(500,-300)],'되돌리기 한 번에 원본과 치수가 함께 돌아간다');
 assert.deepEqual(get('L').points,[P(0,0),P(1500,0)]);
});

test('원본을 지우면 끊긴 치수로 표시하고, 다시 연관하면 따라간다',()=>{
 const {engine,dim,id,get}=setup();
 engine.execute({type:'delete',ids:[id('L')]});
 assert.equal(dim().assocLost,true);assert.equal(dim().assoc,null);assert.equal(engine.lastExecution.assocLost,1);
 assert.equal(entityIndex(engine.doc.entities).assoc.lost,1);
 const summary=lostAssocSummary(engine.doc.entities,engine.doc.layers);assert.equal(summary.count,1);assert.deepEqual(summary.ids,[id('D')]);
 const x=get('X'),d=dim();
 let next=reassociatePoint(d,0,x,P(0,500));next=reassociatePoint({...d,...next},1,x,P(1000,500));
 engine.execute({type:'update',ids:[id('D')],changes:{...next,assocLost:false}});
 assert.equal(entityIndex(engine.doc.entities).assoc.lost,0);
 engine.execute({type:'move',ids:[id('X')],dx:0,dy:50});
 assert.deepEqual(dim().points.slice(0,2),[P(0,550),P(1000,550)]);
});

test('치수만 옮기면 연관을 풀어, 나중에 원본을 고쳐도 치수가 튀어 돌아가지 않는다',()=>{
 const {engine,dim,id,get}=setup();
 engine.execute({type:'move',ids:[id('D')],dx:0,dy:2000});
 assert.equal(engine.lastExecution.lightweight,true,'치수만 옮기기는 가벼운 경로 그대로');
 assert.equal(dim().assoc,null);
 engine.execute({type:'move',ids:[id('L')],dx:10,dy:0});
 assert.deepEqual(dim().points[0],P(0,2000));
});

test('원본을 고쳐도 가벼운 경로에 남고, 역색인으로 그 원본의 치수만 다시 계산한다',()=>{
 const {engine,id,dim}=setup();
 engine.execute({type:'move',ids:[id('X')],dx:5,dy:0});assert.equal(engine.lastExecution.lightweight,true,'원본이 아닌 선');
 engine.assocScan=null;
 engine.execute({type:'move',ids:[id('L')],dx:5,dy:0});assert.equal(engine.lastExecution.lightweight,true,'원본인 선');
 assert.equal(engine.assocScan,'scoped','도면 전체를 훑지 않는다');
 assert.deepEqual(dim().points,[P(5,0),P(1005,0),P(505,-300)]);
 engine.execute({type:'undo'});assert.deepEqual(dim().points,[P(0,0),P(1000,0),P(500,-300)],'되돌리기 한 번');
 engine.execute({type:'copy',ids:[id('L')],dx:0,dy:3000});assert.equal(engine.lastExecution.lightweight,true,'복사는 원본을 바꾸지 않는다');
});

test('복사한 치수는 원본 점 위에 있지 않으면 연관을 버린다',()=>{
 const {engine,id,get}=setup();
 const ids=engine.execute({type:'copy',ids:[id('D')],dx:0,dy:900});
 const copy=engine.doc.entities.find(e=>e.id===ids[0]);assert.equal(copy.assoc,null);
 const both=engine.execute({type:'copy',ids:[id('D'),id('L')],dx:0,dy:900});
 const dimCopy=engine.doc.entities.find(e=>both.includes(e.id)&&e.type==='dimension');
 assert.equal(dimCopy.assoc,null,'원본과 함께 복사해도 옛 원본에 잘못 매달리지 않는다(복사본끼리 다시 잇기는 남은 일)');
});

test('원·호: 중심과 원 위 점(radial) 연관, 반지름을 바꾸면 따라간다',()=>{
 const engine=new DrawingEngine(),layer=engine.doc.layers[0].id;
 const [cid]=engine.execute({type:'add',entity:{type:'circle',layer,center:P(0,0),radius:100}});
 const circle=engine.doc.entities.find(e=>e.id===cid),d={type:'dimension',mode:'radius',textHeight:20,points:[P(0,0),P(100,0),P(200,0)]};
 const [rid]=engine.execute({type:'add',entity:{layer,...d,assoc:radialAssoc(circle,d)}});
 engine.execute({type:'update',ids:[cid],changes:{radius:150}});
 const r=engine.doc.entities.find(e=>e.id===rid);assert.deepEqual(r.points[1],P(150,0));
 assert.equal(G.dimensionParts(r).find(p=>p.dimensionLabel).text,'R 150');
});

test('정의점 수: 선형 2, 각도·호 길이 3',()=>{
 assert.equal(definingCount({mode:'horizontal',points:[1,2,3]}),2);assert.equal(definingCount({mode:'angular',points:[1,2,3,4]}),3);
});

test('DIMREASSOCIATE: 정의점마다 스냅 점을 받고 Enter 는 건너뛴다',async()=>{
 const {engine,id,get}=setup();engine.execute({type:'delete',ids:[id('L')]});
 const picks=[snapPick(P(0,500),id('X')),{option:''}],toasts=[];
 const ctx={entities:()=>engine.doc.entities,layers:()=>engine.doc.layers,selected:()=>[],execute:c=>engine.execute(c),toast:m=>toasts.push(m),tolerance:()=>10,
  pickEntity:async o=>{assert.equal(o.allowNone,'lost');return {option:'lost'};},pickPoint:async()=>picks.shift()};
 await installDimAssoc(ctx).DIMREASSOCIATE();
 const d=get('D');
 assert.deepEqual(d.assoc,[{id:id('X'),ref:'vertex',index:0},null]);assert.equal(d.assocLost,false);assert.deepEqual(d.points[0],P(0,500));
});

test('원본을 지워도 명령 결과(선택)에 연관 치수가 섞이지 않는다',()=>{
 const {engine,id}=setup();
 assert.deepEqual(engine.execute({type:'delete',ids:[id('L')]}),[]);
 assert.ok(engine.lastExecution.linked?.includes(id('D')),'화면 갱신은 linked 로');
});
test('원본을 옮겨 두 측정점이 겹치면 명령은 성공하고 그 치수만 연관이 끊긴다',()=>{
 const {engine,layer,id,dim}=setup();
 const [M]=engine.execute({type:'add',entity:{type:'line',layer,points:[P(2000,0),P(3000,0)]}});
 const [D2]=engine.execute({type:'add',entity:{type:'dimension',mode:'horizontal',textHeight:150,layer,points:[P(1000,0),P(2000,0),P(1500,-300)],assoc:[{id:id('L'),ref:'vertex',index:1},{id:M,ref:'vertex',index:0}]}});
 engine.execute({type:'move',ids:[M],dx:-1000,dy:0});
 const d2=engine.doc.entities.find(e=>e.id===D2);
 assert.equal(d2.assocLost,true);assert.deepEqual(d2.points.slice(0,2),[P(1000,0),P(2000,0)],'모양은 그대로');
 assert.deepEqual(dim().points[1],P(1000,0),'다른 치수는 영향 없음');
});
