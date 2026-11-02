// ACAD200 영역 6 — 속성·수량·추출·반복 도형·팔레트·그룹·정리·단위·분해·비교(611~616, 220, 621~625) 시험.
import test from 'node:test';
import assert from 'node:assert/strict';
import {DrawingEngine} from './engine.js';
import * as G from './geometry.js';
import {attsyncValues,attsyncPlan,promptAttributes,attributeEditChanges} from './block-tools.js';
import {createCountMaintainer} from './block-count-live.js';
import {runExtraction,staleExtractionTables,extractionCsv} from './data-extraction.js';
import {planBlockSpot,blockSpotCommand,clusterSignature,findClusters,similarDefinitions} from './block-spot.js';
import {pushRecent,insertNameList,createSideDocPool,importSideBlock,definitionThumbnail} from './side-docs.js';
import {groupMemberIds,expandByGroups,promptlessAttributes,sharedDefinitionForInsert} from './block-data-tools.js';
import {planPurge,purgeCommand,planPurgeAll,refsOf,wblockDocument,usedSharedKeys} from './drawing-cleanup.js';
import {unitConversion,unitCode,unitHint} from './units.js';
import {compareDocs,revisionCloud,entityHash} from './drawing-compare.js';

const P=(x,y)=>({x,y});
const line=(a,b,layer='default')=>({type:'line',layer,points:[a,b]});
const layers=[{id:'default',name:'0',color:'#ffffff',visible:true},{id:'L2',name:'가구',color:'#ff0000',visible:true}];
const doc=(entities,sharedBlocks)=>({version:sharedBlocks?3:2,units:'mm',layers:structuredClone(layers),blocks:[],entities,...(sharedBlocks?{sharedBlocks}:{})});
const ref=(id,key,x,y,extra={})=>({id,type:'block',name:key,sharedBlock:key,layer:'default',position:P(x,y),scale:1,rotation:0,entities:[],...extra});
const texts=d=>G.visibleEntities(d).flatMap(G.primitives).filter(p=>p.type==='text').map(p=>p.text).sort();

test('611 속성 정의: 그릴 때 참조 값으로 문자, 상수·숨김 규칙, 삽입 때 묻기 규칙', async()=>{
  const tag=(name,extra={})=>({type:'text',layer:'default',position:P(0,0),height:100,text:name,attdef:{tag:name,prompt:name+'?',default:'기본',...extra}});
  const defs={room:{origin:P(0,0),entities:[line(P(0,0),P(10,0)),tag('NO'),tag('USE',{constant:true,default:'거실'}),tag('MEMO',{invisible:true}),tag('AREA',{preset:true,default:'0'})]}};
  assert.deepEqual(texts(doc([ref('a','room',0,0,{attributes:{no:'101',MEMO:'비밀'}}),ref('b','room',500,0)],defs)),['0','0','101','거실','거실','기본']);
  // 값을 바꾸면 화면 문자도 같이(저장은 값 하나)
  const engine=new DrawingEngine();engine.execute({type:'load',document:doc([ref('a','room',0,0,{attributes:{NO:'101'}})],defs)});
  engine.execute({type:'update',ids:['a'],changes:attributeEditChanges(engine.doc.entities[0],{NO:'202'})});
  assert.ok(texts(engine.doc).includes('202'));
  const asked=[];const values=await promptAttributes(defs.room.entities,async(label,value)=>{asked.push(label);return label==='NO?'?'7':value;});
  assert.deepEqual(asked,['NO?','MEMO?']);assert.deepEqual(values,{NO:'7',MEMO:'기본',AREA:'0'});
  assert.deepEqual(promptlessAttributes(defs.room.entities),{AREA:'0'});
  await assert.rejects(promptAttributes([tag('V',{verify:true})],async(label)=>label.includes('확인')?'다름':'값'),/확인 값/);
  assert.throws(()=>engine.validate({...engine.doc,entities:[{id:'x',...tag('띄 어')}]}),/태그/);
  // 가져온 ATTRIB 문자(attributeTag)는 참조 값을 따른다
  const imported={...ref('i','room',0,0,{attributes:{NO:'새값'}}),entities:[{type:'text',layer:'default',position:P(0,0),height:100,text:'옛값',attributeTag:'NO'}]};
  assert.ok(texts(doc([imported],defs)).includes('새값'));
  // INSERT 견본 → 정의 찾기
  assert.equal(sharedDefinitionForInsert({blocks:[{name:'방',sharedBlock:'room'}],sharedBlocks:defs},'방'),defs.room);
});

test('612 ATTSYNC: 태그 대소문자 무시·같은 태그 순번으로 짝짓고 값 보존, 새 태그 기본값, 없는 태그 삭제', ()=>{
  const def=(t,extra={})=>({type:'text',layer:'default',position:P(0,0),height:1,text:t,attdef:{tag:t,default:'d-'+t,...extra}});
  assert.deepEqual(attsyncValues([def('NO'),def('NEW'),def('C',{constant:true})],{no:'101',OLD:'x'}),{NO:'101',NEW:'d-NEW'});
  const defs={k:{origin:P(0,0),entities:[def('NO')]},plain:{origin:P(0,0),entities:[line(P(0,0),P(1,0))]}};
  const d=doc([ref('a','k',0,0,{attributes:{NO:'1'}}),ref('b','k',0,0,{attributes:{no:'2',GONE:'z'}}),ref('c','k',0,0)],defs);
  assert.deepEqual(attsyncPlan(d,'k').updates,[{id:'b',changes:{attributes:{NO:'2'}}},{id:'c',changes:{attributes:{NO:'d-NO'}}}]);
  assert.throws(()=>attsyncPlan(d,'plain'),/속성 정의/);
});

test('613 COUNT: 한 번 센 객체는 기억, 바뀐 객체만 다시 센다(중첩 포함)', ()=>{
  const defs={leaf:{entities:[line(P(0,0),P(1,0))]},room:{entities:[{type:'block',name:'의자',sharedBlock:'leaf',layer:'default',position:P(0,0),entities:[]},{type:'block',name:'의자',sharedBlock:'leaf',layer:'default',position:P(5,0),entities:[]}]}};
  const engine=new DrawingEngine();engine.execute({type:'load',document:doc(Array.from({length:50},(_,i)=>ref('r'+i,'room',i*10,0,{name:'방'})),defs)});
  const counter=createCountMaintainer();
  assert.deepEqual(counter.read(engine.doc),[{name:'방',count:50},{name:'의자',count:100}]);
  assert.equal(counter.lastStats().recounted,50);
  engine.execute({type:'move',ids:['r3'],dx:1,dy:0});
  engine.execute({type:'delete',ids:['r4']});
  assert.deepEqual(counter.read(engine.doc),[{name:'방',count:49},{name:'의자',count:98}]);
  assert.deepEqual(counter.lastStats(),{recounted:1,reused:48},'옮긴 하나만 다시 셈');
  assert.equal(counter.read(engine.doc),counter.read(engine.doc),'안 바뀌면 그대로');
});

test('614 데이터 추출: 이름·레이어·속성으로 묶고 중첩까지, 표는 원본이 바뀌면 갱신 대상', ()=>{
  const defs={leaf:{entities:[line(P(0,0),P(1,0))]},room:{entities:[{type:'block',name:'의자',sharedBlock:'leaf',layer:'L2',position:P(0,0),entities:[],attributes:{TYPE:'A'}},{type:'block',name:'의자',sharedBlock:'leaf',layer:'L2',position:P(5,0),entities:[],attributes:{type:'B'}}]}};
  const d=doc([ref('1','room',0,0,{name:'방'}),ref('2','room',10,0,{name:'방'}),ref('3','leaf',0,0,{name:'의자',layer:'L2',attributes:{TYPE:'A'}})],defs);
  assert.deepEqual(runExtraction(d,{groupBy:['name','attr:TYPE'],nested:true}),[['블록 이름','TYPE','수량'],['방','',2],['의자','A',3],['의자','B',2]]);
  assert.deepEqual(runExtraction(d,{groupBy:['name','layer'],filter:{layers:'가구'}}),[['블록 이름','레이어','수량'],['의자','가구',1]]);
  const table={id:'t',type:'block',name:'데이터 추출',layer:'default',entities:[line(P(0,0),P(1,0))],table:{rows:[['블록 이름','수량'],['방',2]],height:100},extraction:{groupBy:['name'],nested:false}};
  assert.equal(staleExtractionTables(doc([...d.entities,table],defs)).length,1,'의자 1개가 새로 생겨 표가 낡음');
  assert.equal(extractionCsv([['a','b,c'],[1,'"q"']]),'﻿a,"b,c"\r\n1,"""q"""');
});

test('615 BLOCKSPOT: 이동·회전·대칭된 반복 묶음을 찾아 정의 하나 + 참조로, 모양은 그대로', ()=>{
  const shape=[{type:'polyline',layer:'default',closed:true,points:[P(0,0),P(100,0),P(100,40),P(0,40)]},line(P(0,0),P(100,40)),{type:'circle',layer:'default',center:P(30,20),radius:8},{type:'arc',layer:'default',center:P(70,20),radius:10,startAngle:0,endAngle:120}];
  const placed=(dx,dy,angle,mirror)=>shape.map(e=>{let x=structuredClone(e);if(mirror)x=G.mirror(x,P(0,0),P(0,1));x=G.rotate(x,P(0,0),angle);return G.translate(x,dx,dy);});
  const all=[...placed(0,0,0),...placed(1000,0,90),...placed(0,1000,0,true),...placed(2000,2000,33),line(P(5000,5000),P(5100,5000))].map((e,i)=>({...e,id:'e'+i}));
  assert.equal(findClusters(all,{gap:1}).length,5);
  assert.equal(clusterSignature(all.slice(0,4)),clusterSignature(all.slice(4,8)));
  const plan=planBlockSpot(all,{gap:1});
  assert.equal(plan.groups.length,1);assert.equal(plan.converted,4);assert.equal(plan.removed,16);
  const engine=new DrawingEngine();engine.execute({type:'load',document:doc(all)});
  const before=G.visibleEntities(engine.doc).flatMap(G.primitives).filter(p=>p.center).map(p=>[Math.round(p.center.x*1000)/1000,Math.round(p.center.y*1000)/1000]).sort();
  engine.execute(blockSpotCommand(plan,null));
  assert.equal(engine.doc.entities.length,5);
  const after=G.visibleEntities(engine.doc).flatMap(G.primitives).filter(p=>p.center).map(p=>[Math.round(p.center.x*1000)/1000,Math.round(p.center.y*1000)/1000]).sort();
  assert.deepEqual(after,before);
  assert.equal(planBlockSpot([...placed(0,0,0),...placed(500,0,0).map((e,i)=>i===1?line(P(500,0),P(590,40)):e)].map((e,i)=>({...e,id:'x'+i})),{gap:1}).groups.length,0,'서명이 달라 묶지 않는다');
});

test('616 팔레트: 최근 50개, INSERT 안내는 최근 순, 곁 문서 LRU, 다른 도면 블록 가져오기', async()=>{
  let list=[];for(let i=0;i<60;i++)list=pushRecent(list,'B'+i);list=pushRecent(list,'B10');
  assert.equal(list.length,50);assert.equal(list[0],'B10');
  assert.equal(insertNameList([{name:'가'},{name:'나'},{name:'다'}],['다']),'다, 가, 나');
  let loads=0,clock=0;const pool=createSideDocPool(async path=>{loads++;return {sharedBlocks:{[path]:{entities:[]}}};},2,()=>++clock);
  await pool.get('a');await pool.get('b');await pool.get('a');await pool.get('c');
  assert.equal(loads,3);assert.ok(pool.has('a')&&pool.has('c')&&!pool.has('b'),'가장 오래 안 쓴 b 를 내보냄');
  const side={layers:[{id:'x',name:'가구',color:'#00ff00',visible:true},{id:'y',name:'새',color:'#0000ff',visible:true}],sharedBlocks:{sofa:{name:'소파',entities:[{type:'block',name:'쿠션',sharedBlock:'cushion',layer:'x',position:P(0,0),entities:[]}]},cushion:{entities:[line(P(0,0),P(1,0),'y')]}}};
  const target=doc([], {sofa:{entities:[]}});
  const result=importSideBlock(side,'sofa',target);
  assert.equal(result.key,'sofa_1');assert.deepEqual(Object.keys(result.definitions).sort(),['cushion','sofa_1']);
  assert.equal(result.definitions.sofa_1.entities[0].layer,'L2','같은 이름 레이어는 이 도면 것');
  assert.equal(result.layers.length,1);assert.equal(result.definitions.cushion.entities[0].layer,result.layers[0].id);
  assert.match(definitionThumbnail({a:{entities:[line(P(0,0),P(10,10))]}},'a'),/<svg[^>]+><path d="M/);
  const defs={a:{entities:[line(P(0,0),P(10,0)),line(P(0,0),P(0,10))]},b:{entities:[line(P(0,0),P(20,0)),line(P(0,0),P(0,20))]},c:{entities:[{type:'circle',layer:'default',center:P(0,0),radius:3}]}};
  assert.equal(similarDefinitions(defs,'a')[0].key,'b');
});

test('621 그룹 선택: 그룹 이름이 있는 객체만 동료를 찾고, 색인은 배열마다 한 번', ()=>{
  const entities=[{id:'1',group:'창'},{id:'2',group:'창'},{id:'3'},{id:'4',group:' 창 '}];
  assert.deepEqual(groupMemberIds(entities,'창'),['1','2','4']);
  const byId=id=>entities.find(e=>e.id===id);
  assert.deepEqual(expandByGroups(entities,['1'],byId).sort(),['1','2','4']);
  assert.deepEqual(expandByGroups(entities,['3'],byId),['3']);
});

test('622·220 PURGE: 안 쓰는 공유 정의(중첩까지)와 그 정의만 쓰던 레이어, 참조 걷기는 후보가 비면 멈춘다', ()=>{
  const defs={used:{entities:[{type:'block',name:'n',sharedBlock:'nested',layer:'default',position:P(0,0),entities:[]}]},nested:{entities:[line(P(0,0),P(1,0))]},orphan:{entities:[{type:'block',name:'o',sharedBlock:'orphanChild',layer:'default',position:P(0,0),entities:[]}]},orphanChild:{entities:[line(P(0,0),P(1,0),'L2')]}};
  const d=doc([ref('r','used',0,0)],defs);
  const plan=planPurge(d,{currentLayer:'default'});
  assert.deepEqual(plan.sharedKeys.sort(),['orphan','orphanChild']);
  assert.deepEqual(plan.layers.map(l=>l.name),['가구'],'정의 안에서만 쓰이던 레이어도');
  const engine=new DrawingEngine();engine.execute({type:'load',document:d});engine.execute(purgeCommand(plan));
  assert.deepEqual(Object.keys(engine.doc.sharedBlocks).sort(),['nested','used']);assert.equal(engine.doc.layers.length,1);
  const candidates=new Map([['layer',new Set(['default'])]]);let visited=0;
  planPurgeAll({entities:new Proxy(Array.from({length:1000},()=>line(P(0,0),P(1,0))),{get(t,k){if(typeof k==='string'&&/^\d+$/.test(k))visited++;return t[k];}})},candidates);
  assert.ok(visited<5,'첫 객체에서 후보가 비어 멈춤');
  const seen=[];refsOf({type:'block',name:'B',layer:'L2',sharedBlock:'used',dimStyle:'S',entities:[]},(kind,name)=>seen.push(kind+':'+name),defs);
  assert.deepEqual(seen,['layer:L2','dimStyle:S','block:B','sharedBlock:used','layer:default','block:n','sharedBlock:nested','layer:default']);
  const w=wblockDocument(d,[ref('r','used',100,0)],P(100,0),G.translate);
  assert.deepEqual(Object.keys(w.sharedBlocks).sort(),['nested','used']);assert.deepEqual(w.entities[0].position,P(0,0));assert.deepEqual(w.layers.map(l=>l.name),['0']);
  assert.deepEqual([...usedSharedKeys(d)].sort(),['nested','used']);
});

test('623 단위 환산: 코드·이름, 단위 없음은 기본 원본 단위, 작은 도면 안내', ()=>{
  assert.equal(unitConversion(6,4),1000);assert.equal(unitConversion(1),25.4);assert.equal(unitConversion(0,4,{defaultSource:5}),10);
  assert.equal(unitCode('m'),6);assert.equal(unitCode('99'),0);
  assert.throws(()=>unitConversion(4,99,{defaultTarget:99}),/지원/);
  assert.match(unitHint({minX:0,minY:0,maxX:12,maxY:8},0),/m 로/);assert.equal(unitHint({minX:0,minY:0,maxX:12000,maxY:8},0),null);
});

test('624 EXPLODE: 조각은 원래 자리(그리기 순서), 레이어 0 표시 자식은 0 으로, 선가중치 BYBLOCK 은 부모를 따른다', ()=>{
  const engine=new DrawingEngine();
  engine.execute({type:'layer.add',id:'L2',name:'가구',color:'#ff0000'});
  engine.execute({type:'addMany',entities:[line(P(0,0),P(1,0)),{type:'block',name:'b',layer:'L2',lineweight:.7,entities:[{...line(P(0,0),P(0,1),'L2'),inheritLayer:true},{...line(P(0,0),P(2,2),'L2'),lineweightMode:'byblock'}]},line(P(5,0),P(6,0))]});
  const [first,block,last]=engine.doc.entities;
  const shown=G.visibleEntities(engine.doc).find(e=>e.id===block.id).entities;
  assert.equal(shown[1].lineweight,.7,'BYBLOCK 선가중치 = 블록 선가중치');
  engine.execute({type:'explode',ids:[block.id]});
  assert.equal(engine.doc.entities[0].id,first.id);assert.equal(engine.doc.entities.at(-1).id,last.id,'조각은 가운데(원래 자리)');
  assert.equal(engine.doc.entities[1].layer,'default');assert.equal(engine.doc.entities[1].inheritLayer,undefined);
  assert.equal(engine.doc.entities[2].layer,'L2');
});

test('625 DWG 비교: 같은 것은 건너뛰고(공유 블록은 펼치지 않음), 폴리선↔선 묶음은 같은 모양, 차이는 구름', ()=>{
  const defs={k:{entities:[line(P(0,0),P(10,0))]}};
  const a=doc([ref('1','k',0,0),{id:'p',type:'polyline',layer:'default',points:[P(0,0),P(10,0),P(10,10)]},line(P(100,100),P(200,100))],defs);
  const b=doc([ref('9','k',0,0),{id:'l1',...line(P(0,0),P(10,0))},{id:'l2',...line(P(10,10),P(10,0))},line(P(100,100),P(300,100))],structuredClone(defs));
  const result=compareDocs(a,b);
  assert.equal(result.onlyA.length,1);assert.equal(result.onlyB.length,1);assert.ok(result.same>=2);
  assert.deepEqual(result.clouds.map(c=>c.side).sort(),['a','b']);
  assert.equal(compareDocs(a,structuredClone(a)).clouds.length,0);
  assert.equal(entityHash(defs,ref('x','k',0,0)),entityHash(defs,ref('y','k',0,0)),'id 는 비교하지 않는다');
  const cloud=revisionCloud({minX:0,minY:0,maxX:1000,maxY:500});
  assert.ok(cloud.closed&&cloud.points.length>8);const box=G.bounds([cloud]);assert.ok(box.minX<-200&&box.maxY>700);
});
