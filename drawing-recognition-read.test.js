import test from 'node:test';
import assert from 'node:assert/strict';
import {readSitePlan,dimensionChecks,floorRows,floorRegions,recognitionChecks,recognitionNeeds,countsAsFloor} from './drawing-recognition-read.js';

const T=(text,x,y,h=250)=>({type:'text',text,position:{x,y},height:h});
const R=(id,layer,x0,y0,x1,y1)=>({id,type:'polyline',closed:true,layer,points:[{x:x0,y:y0},{x:x1,y:y0},{x:x1,y:y1},{x:x0,y:y1}]});
const layers=[{id:'s',name:'A-SITE'},{id:'w',name:'WALL'},{id:'f',name:'도곽'}];
// 배치도: 대지 20 x 20.625 m(412.5㎡), 건물 15 x 11.02 m, 방위 블록 12° 시계, 제목은 그림 아래. 도곽(제목을 품음)은 대지로 보지 않는다.
const site={layers,entities:[R('frame','f',-50000,-50000,80000,60000),R('lot','s',0,0,20000,20625),R('bld','w',2000,2000,17000,13020),
 {type:'block',name:'NORTH',position:{x:19000,y:19000},rotation:-12,entities:[{type:'line',layer:'default',points:[{x:0,y:0},{x:0,y:500}]}]},T('배 치 도',8000,-1500,500),T('1/300',11000,-1500,300)]};

test('배치도 제목 위 그림에서 대지·건물·정북을 읽는다', ()=>{
 const r=readSitePlan(site);
 assert.equal(r.status,'title');
 assert.equal(r.lot.area,412.5);assert.equal(r.lot.id,'lot');
 assert.equal(r.building.area,165.3);
 assert.equal(r.north.degrees,12);assert.match(r.north.text,/12° 시계/);
 assert.deepEqual(r.confirm,[]);
});
test('배치도 제목이 없거나 여럿이면 추측하지 않고 윈도우로 감싸게 한다', ()=>{
 assert.equal(readSitePlan({layers,entities:[R('lot','s',0,0,20000,20000)]}).status,'none');
 const many=readSitePlan({layers,entities:[...site.entities,T('배치도',90000,0,500)]});
 assert.equal(many.status,'many');assert.equal(many.lot,null);
 const w=readSitePlan({layers,entities:[R('lot','s',0,0,20000,20625)]},{window:[{x:-100,y:-100},{x:20100,y:20800}]});
 assert.equal(w.status,'window');assert.equal(w.lot.area,412.5);assert.match(w.confirm[0].reason,/건물 윤곽/);
});

const D=(x0,x1,y,text)=>({type:'dimension',mode:'horizontal',points:[{x:x0,y:0},{x:x1,y:0},{x:x0,y}],...(text?{text}:{})});
test('연속치수 합과 전체치수를 맞춰 본다(고친 치수 글자를 따른다)', ()=>{
 const box={minX:-1000,minY:-5000,maxX:20000,maxY:5000};
 const ok={entities:[D(0,18000,-3000),D(0,6000,-2000),D(6000,18000,-2000)]};
 assert.deepEqual(dimensionChecks(ok,box),[{side:'아래',sum:18000,total:18000,ok:true}]);
 const bad={entities:[D(0,18000,-3000),D(0,6000,-2000,'6,000'),D(6000,18000,-2000,'12,100')]};
 assert.equal(dimensionChecks(bad,box)[0].ok,false);assert.equal(dimensionChecks(bad,box)[0].sum,18100);
 assert.deepEqual(dimensionChecks({entities:[D(0,6000,-2000)]},box),[],'전체치수 없으면 맞춰 보지 않음');
});

const foreign={floors:[
 {label:'1층',floors:[1],title:'1층 평면도',sheet:0,box:{minX:0,minY:0,maxX:1,maxY:1},outline:{area:165.3e6,outdoorCandidates:[]},rooms:[{area:100e6},{area:65.3e6}],unresolved:[]},
 {label:'2~4층',floors:[2,3,4],title:'기준층 평면도',sheet:1,box:{minX:2,minY:0,maxX:3,maxY:1},outline:{area:150e6,outdoorCandidates:[{}]},rooms:[{area:120e6}],unresolved:[{reason:'같은 층 평면이 2장'}]},
 {label:'지붕',floors:[],roof:true,title:'옥탑층 평면도',sheet:2,box:{minX:4,minY:0,maxX:5,maxY:1},outline:{area:20e6},rooms:[{area:20e6}],unresolved:[]}]};
test('층 목록·검산·확인 필요가 이어진다', ()=>{
 const floors=floorRows(foreign,[{title:'1층 평면도',height:3000}]);
 assert.equal(floors[0].area,165.3);assert.equal(floors[0].roomArea,165.3);assert.equal(floors[0].height,3000);assert.equal(floors[1].height,null);
 assert.equal(countsAsFloor(floors[2]),false);assert.equal(countsAsFloor(floors[2],{'roof:지붕@2':{value:'floor'}}),true);
 const overview={values:{gfa:615.3,siteArea:412.5,buildingArea:165.3},confirm:[],conflicts:[]};
 const checks=recognitionChecks({overview,site:readSitePlan(site),floors});
 const by=Object.fromEntries(checks.map(c=>[c.id,c.state]));
 assert.deepEqual(by,{dims:'skip',rooms:'fail',gfa:'ok',site:'ok',building:'ok'});   // 165.3 + 150×3 = 615.3
 const needs=recognitionNeeds({overview,site:readSitePlan(site),floors,checks});
 assert.deepEqual(needs.map(n=>n.id),['fl:2~4층@1:0','out:2~4층@1','roof:지붕@2','chk:rooms']);
 assert.equal(recognitionNeeds({overview,floors,checks,answers:{'chk:rooms':{value:'keep'}}}).some(n=>n.id==='chk:rooms'),false);
 assert.equal(recognitionNeeds({floors:[],floorError:'로그인 필요'})[0].text,'로그인 필요');
});
test('층 범위는 인허가 도서 층 영역과 같이 쓰되 손으로 고른 층은 덮지 않는다', ()=>{
 const floors=floorRows(foreign);
 const mine={kind:'floor',floor:1,bounds:{minX:9,minY:9,maxX:10,maxY:10},key:'floor:1',label:'1층'},old={kind:'floor',floor:5,key:'floor:5',source:'도면 인식'};
 const r=floorRegions([mine,old,{kind:'overview',key:'overview'}],floors);
 assert.deepEqual(r.filter(x=>x.kind==='floor').map(x=>[x.floor,x.source||'손']),[[1,'손'],[2,'도면 인식'],[3,'도면 인식'],[4,'도면 인식']]);
 assert.ok(r.some(x=>x.kind==='overview'));
});

import {DrawingEngine} from './engine.js';
import {createBridgeBinding,createBoundRequestHandler,prepareComputeRequest} from './bridge-client.js';
import {setComputeTransport} from './compute-client.js';
test('AI 도구: cad_recognize_drawing read → cad_get_recognition → answer, 한 번씩 되돌릴 수 있다', async()=>{
 const engine=new DrawingEngine(),context={engine,execute:c=>engine.execute(c),getDrawingId:()=>'one',getDrawingName:()=>'시험',selected:()=>new Set(),refresh(){}};
 const binding=createBridgeBinding(context),gen=crypto.randomUUID(),handler=createBoundRequestHandler(context,binding);
 const target=()=>{const now={...binding.current(),backend_generation:gen,snapshot_id:crypto.randomUUID()};binding.receive({protocol_version:1,backend_generation:gen,target:now});return now;};
 const request=(action,args={})=>({id:crypto.randomUUID(),expires_at:Date.now()+25000,action,args:{target:target(),...args}});
 const call=async(action,args)=>{const r=request(action,args);return handler(r,await prepareComputeRequest(context,binding,r));};
 binding.receive({protocol_version:1,backend_generation:gen,target:{...binding.current(),backend_generation:gen,snapshot_id:crypto.randomUUID()}});
 engine.doc.layers.push(...layers.map(l=>({...l,color:'#ffffff',visible:true,locked:false,lineweight:0.25,linetype:'CONTINUOUS'})));
 for(const e of site.entities)engine.execute({type:'add',entity:{layer:'default',...structuredClone(e)}});
 const before=setComputeTransport(async action=>action==='plan.foreignRead'?{floors:foreign.floors,sheets:3}:[]);
 try{
  assert.equal((await call('cad_get_recognition')).result.readAt,null);
  const read=await call('cad_recognize_drawing',{action:'read'});assert.ok(!read.error,read.error);
  assert.equal(read.result.applied,true);assert.equal(read.result.site.lotArea,412.5);assert.equal(read.result.floors.length,3);
  assert.match(read.result.message,/층 평면 3개/);
  const roof=read.result.needs.find(n=>n.id==='roof:지붕@2');assert.deepEqual(roof.choices.map(c=>c[0]),['floor','roof']);
  assert.match((await call('cad_recognize_drawing',{action:'answer',id:roof.id,value:'모름'})).error,/'floor'/);
  const steps=engine.undoStack.length;
  const ans=await call('cad_recognize_drawing',{action:'answer',id:roof.id,value:'roof'});assert.ok(!ans.error,ans.error);
  assert.equal(ans.result.needs.some(n=>n.id===roof.id),false);
  assert.ok(engine.doc.reviewSettings.energyPlanRegions.some(r=>r.floor===3&&r.source==='도면 인식'),'층 범위가 인허가 도서 층 영역에 들어감');
  assert.equal(engine.undoStack.length,steps+1,'답 하나 = 되돌리기 한 번');
 }finally{setComputeTransport(before);}
});
