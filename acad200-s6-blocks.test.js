// ACAD200 영역 6 — 블록 구조(601~610) 시험.
import test from 'node:test';
import assert from 'node:assert/strict';
import {DrawingEngine} from './engine.js';
import * as G from './geometry.js';
import {buildSharedRefIndex,referencesOf,sharedDefinitionStats,referenceMatrix,applyMatrix,arrayReferences,migratePlainBlocks,parametricReference,parametricKey,withSharedDefinitions,sharedDerivation,invertMatrix,composeMatrix,pathMatrix} from './shared-blocks.js';
import {blockCounts} from './block-tools.js';
import {nestedPaths,openWorkSet,closeWorkSet,beditTarget,editableDefinitions} from './block-workset.js';
import {libraryReference,BLOCK_ITEMS,itemDefaults} from './block-library.js';

const P=(x,y)=>({x,y});
const line=(a,b,layer='default')=>({type:'line',layer,points:[a,b]});
const near=(a,b,eps=1e-6)=>Math.abs(a-b)<=eps;
const shownLines=doc=>G.visibleEntities(doc).flatMap(e=>G.primitives(e)).filter(p=>p.type==='line').map(p=>p.points.map(q=>[Math.round(q.x*1e6)/1e6,Math.round(q.y*1e6)/1e6]));
const sharedDoc=(definitions,entities)=>({version:3,units:'mm',layers:[{id:'default',name:'0',color:'#ffffff',visible:true}],blocks:[],sharedBlocks:definitions,entities});

test('601 BLOCK(공유): 정의 하나 + 참조, 화면은 원래 자리, INSERT 도 참조만', ()=>{
  const engine=new DrawingEngine();
  engine.execute({type:'addMany',entities:[line(P(100,100),P(200,100)),{type:'circle',layer:'default',center:P(150,150),radius:10}]});
  const ids=engine.doc.entities.map(e=>e.id);
  const [refId]=engine.execute({type:'block.create',ids,name:'의자',base:P(100,100),shared:true});
  const ref=engine.doc.entities.find(e=>e.id===refId);
  assert.equal(engine.doc.entities.length,1);
  assert.deepEqual([ref.sharedBlock,ref.position,ref.entities],['의자',P(100,100),[]]);
  assert.deepEqual(engine.doc.sharedBlocks['의자'].entities[0].points,[P(0,0),P(100,0)]);
  assert.ok(engine.doc.blocks.some(b=>b.name==='의자'&&b.sharedBlock==='의자'));
  assert.deepEqual(shownLines(engine.doc),[[[100,100],[200,100]]]);
  const [second]=engine.execute({type:'block.insert',name:'의자',position:P(1000,0),layer:'default',factor:2,angle:90});
  const inserted=engine.doc.entities.find(e=>e.id===second);
  assert.equal(inserted.sharedBlock,'의자');assert.deepEqual(inserted.entities,[]);
  assert.deepEqual(shownLines(engine.doc).sort(),[[[100,100],[200,100]],[[1000,0],[1000,200]]].sort());
});

test('607 재정의 = 정의 교체 한 번: 모든 삽입본(중첩 포함)이 새 모양, 되돌리기 한 번', ()=>{
  const engine=new DrawingEngine();
  engine.execute({type:'add',entity:line(P(0,0),P(10,0))});
  engine.execute({type:'block.create',ids:[engine.doc.entities[0].id],name:'A',base:P(0,0),shared:true});
  engine.execute({type:'block.insert',name:'A',position:P(100,0),layer:'default'});
  // A 를 품은 바깥 블록 B
  const aRef=engine.doc.entities[1].id;
  engine.execute({type:'block.create',ids:[aRef],name:'B',base:P(0,0),shared:true});
  engine.execute({type:'block.insert',name:'B',position:P(0,500),layer:'default'});
  const before=engine.doc;
  engine.execute({type:'add',entity:line(P(0,0),P(0,20))});
  const result=engine.execute({type:'block.create',ids:[engine.doc.entities.at(-1).id],name:'A',base:P(0,0),shared:true,redefine:true,mode:'delete'});
  // 바로 쓰는 참조 1 + A 를 품은 B 의 참조 2 = 다시 그릴 대상 3
  assert.equal(result.length,3);
  const lines=shownLines(engine.doc);
  assert.ok(lines.some(l=>JSON.stringify(l)===JSON.stringify([[0,0],[0,20]])));
  assert.ok(lines.some(l=>JSON.stringify(l)===JSON.stringify([[100,500],[100,520]])), '중첩된 B 안의 A 도 새 모양');
  assert.ok(!lines.some(l=>JSON.stringify(l)===JSON.stringify([[0,0],[10,0]])));
  engine.execute({type:'undo'});engine.execute({type:'undo'});
  assert.equal(engine.doc,before);
  assert.throws(()=>engine.execute({type:'block.create',ids:[engine.doc.entities.find(e=>e.sharedBlock==='B').id],name:'A',base:P(0,0),shared:true,redefine:true}),/자기 자신/);
});

test('607 검사: 정의 하나를 더한 묶음은 바뀐 정의만 다시 검사(기록 남김)', ()=>{
  const engine=new DrawingEngine();
  engine.execute({type:'addMany',entities:[line(P(0,0),P(1,0)),line(P(0,0),P(0,1))]});
  engine.execute({type:'block.create',ids:[engine.doc.entities[0].id],name:'X',base:P(0,0),shared:true});
  const first=engine.doc.sharedBlocks;
  engine.execute({type:'block.create',ids:[engine.doc.entities.find(e=>e.type==='line').id],name:'Y',base:P(0,0),shared:true});
  const derivation=sharedDerivation(engine.doc.sharedBlocks);
  assert.equal(derivation.base,first);assert.deepEqual([...derivation.keys],['Y']);
  const next=withSharedDefinitions(first,{Z:{name:'Z',origin:P(0,0),entities:[{type:'block',name:'X',sharedBlock:'Z',layer:'default',position:P(0,0),entities:[]}]}});
  assert.throws(()=>engine.validate({...engine.doc,sharedBlocks:next}),/순환/);
});

test('602 역색인: 정의를 쓰는 최상위 참조(중첩 포함)를 도면 전체를 훑지 않고', ()=>{
  const defs={A:{origin:P(0,0),entities:[line(P(0,0),P(1,0))]},B:{origin:P(0,0),entities:[{type:'block',name:'A',sharedBlock:'A',layer:'default',position:P(0,0),entities:[]}]}};
  const r1={id:'1',type:'block',name:'A',sharedBlock:'A',layer:'default',position:P(0,0),entities:[]};
  const r2={id:'2',type:'block',name:'B',sharedBlock:'B',layer:'default',position:P(5,0),entities:[]};
  const doc=sharedDoc(defs,[r1,r2,line(P(0,0),P(2,2))]);
  const index=buildSharedRefIndex(doc);
  assert.equal(buildSharedRefIndex(doc),index,'같은 배열이면 다시 만들지 않는다');
  assert.deepEqual(referencesOf(index,'A').map(e=>e.id).sort(),['1','2']);
  assert.deepEqual(referencesOf(index,'B').map(e=>e.id),['2']);
});

test('603 정의별 통계: 펼치지 않고 중첩 블록 수·객체 수를 곱해서', ()=>{
  const defs={leaf:{entities:[line(P(0,0),P(1,0)),{type:'polyline',layer:'default',points:[P(0,0),P(1,1),P(2,0)]}]},room:{entities:Array.from({length:10},(_,i)=>({type:'block',name:'의자',sharedBlock:'leaf',layer:'default',position:P(i,0),entities:[]}))}};
  const stats=sharedDefinitionStats(defs,'room');
  assert.deepEqual([stats.prims,stats.points,stats.blocks.get('의자')],[20,50,10]);
  assert.equal(sharedDefinitionStats(defs,'room'),stats,'정의 묶음마다 한 번');
  const refs=Array.from({length:3},(_,i)=>({id:'r'+i,type:'block',name:'방',sharedBlock:'room',layer:'default',position:P(0,i*10),entities:[]}));
  assert.deepEqual(blockCounts(refs,defs),[{name:'방',count:3},{name:'의자',count:30}]);
  assert.deepEqual(blockCounts(refs),[{name:'방',count:3}],'정의를 안 주면 예전처럼');
});

test('604 비균일 축척 참조: 행렬과 펼친 모양·범위가 같고, 원은 폴리선으로 늘어난다', ()=>{
  const defs={U:{origin:P(5,7),entities:[line(P(5,7),P(15,9)),{type:'circle',layer:'default',center:P(5,7),radius:2}]}};
  const ref={id:'r',type:'block',name:'U',sharedBlock:'U',layer:'default',position:P(100,200),scale:2,scaleX:2,scaleY:3,rotation:30,entities:[]};
  const doc=sharedDoc(defs,[ref]);
  const m=referenceMatrix(ref,defs.U.origin);
  const shown=G.visibleEntities(doc).flatMap(G.primitives);
  const seg=shown.find(p=>p.type==='line');
  for(const [i,q] of [P(5,7),P(15,9)].entries()){const want=applyMatrix(m,q);assert.ok(near(seg.points[i].x,want.x)&&near(seg.points[i].y,want.y));}
  const ring=shown.find(p=>p.type==='polyline');
  assert.ok(ring.closed&&ring.points.length>=32);
  // 원의 한 점(로컬 (7,7))이 행렬로 옮긴 자리에 있다
  const want=applyMatrix(m,P(7,7));assert.ok(ring.points.some(q=>near(q.x,want.x,1e-6)&&near(q.y,want.y,1e-6)));
  G.prepareSharedDrawingReferences(doc);const b=doc.entities[0]._renderBounds;
  const corners=[P(3,5),P(15,9),P(3,9),P(15,5)].map(q=>applyMatrix(m,q));
  assert.ok(near(b.minX,Math.min(...corners.map(q=>q.x)))&&near(b.maxY,Math.max(...corners.map(q=>q.y))));
  // 이동·축척 편집도 두 축을 함께 바꾼다
  const scaled=G.resize(ref,P(100,200),2);assert.deepEqual([scaled.scaleX,scaled.scaleY],[4,6]);
  const cells=arrayReferences({...ref,array:{rows:2,cols:3,dx:10,dy:20},rotation:90});
  assert.equal(cells.length,6);assert.ok(near(cells[1].position.x,100)&&near(cells[1].position.y,210),'간격은 삽입 회전을 따른다');
  assert.ok(cells.every(c=>c.array===undefined&&c.sharedBlock==='U'));
});

test('605·607 사본형 블록 이전: 같은 이름·모양은 정의 하나로, 다른 모양은 그대로', ()=>{
  const chair=(id,x,y,r=10)=>({id,type:'block',name:'의자',layer:'default',entities:[line(P(x,y),P(x+40,y)),{type:'circle',layer:'default',center:P(x+20,y+20),radius:r}]});
  const doc={version:2,units:'mm',layers:[{id:'default',name:'0',color:'#ffffff',visible:true}],blocks:[],entities:[chair('a',0,0),chair('b',100,50),chair('c',300,0),chair('d',500,0,11)]};
  const plan=migratePlainBlocks(doc);
  assert.equal(plan.groups,1);assert.equal(plan.converted,3);
  const engine=new DrawingEngine();engine.execute({type:'load',document:doc});
  const before=shownLines(engine.doc).sort();
  engine.execute({type:'batch',commands:[{type:'shared.add',definitions:plan.definitions,templates:plan.templates},{type:'updateMany',updates:plan.updates.map(u=>{const {id,type,...changes}=u.replacement;return {id:u.id,changes};})}]});
  assert.equal(engine.doc.entities.filter(e=>e.sharedBlock).length,3);
  assert.ok(engine.doc.entities.find(e=>e.id==='d').entities.length===2,'모양이 다른 것은 그대로');
  assert.deepEqual(shownLines(engine.doc).sort(),before,'화면 모양은 같다');
});

test('606 중첩 REFEDIT 작업 세트: 경로 행렬로 놓고, 닫으면 역행렬로 정의 좌표', ()=>{
  const defs={inner:{origin:P(0,0),entities:[line(P(0,0),P(10,0))]},outer:{origin:P(0,0),entities:[{type:'block',name:'안',sharedBlock:'inner',layer:'default',position:P(100,0),scale:2,rotation:90,entities:[]},line(P(0,0),P(0,50))]}};
  const top={id:'t',type:'block',name:'밖',sharedBlock:'outer',layer:'default',position:P(1000,1000),scale:1,rotation:0,entities:[]};
  const doc=sharedDoc(defs,[top]);
  const paths=nestedPaths(defs,top);
  assert.deepEqual(paths.map(p=>p.label),['밖','밖 › 안']);
  const ws=openWorkSet(doc,paths[1].path);
  assert.equal(ws.key,'inner');
  const p=ws.members[0].points;assert.ok(near(p[0].x,1100)&&near(p[0].y,1000)&&near(p[1].x,1100)&&near(p[1].y,1020));
  assert.equal(ws.context.length,1,'바깥 블록의 나머지(선 하나)는 주변');
  const moved=G.translate(ws.members[0],5,0);
  const local=closeWorkSet(ws,[moved]);
  assert.ok(near(local[0].points[0].x,0)&&near(local[0].points[0].y,-2.5),'도면에서 X+5 = 안쪽 로컬 Y-2.5(회전 90°, 축척 2)');
  const m=pathMatrix(defs,paths[1].path),back=composeMatrix(invertMatrix(m),m);assert.ok(near(back.a,1)&&near(back.e,0));
});

test('608 BEDIT 대상: 놓인 참조가 있으면 그것, 없으면 임시 참조', ()=>{
  const defs={A:{name:'A',origin:P(0,0),entities:[line(P(0,0),P(1,0))]},B:{name:'B',origin:P(0,0),entities:[line(P(0,0),P(1,0))]},'@DOOR#x':{name:'문',entities:[line(P(0,0),P(1,0))]}};
  const doc=sharedDoc(defs,[{id:'r',type:'block',name:'A',sharedBlock:'A',layer:'default',position:P(3,3),entities:[]}]);
  assert.deepEqual(editableDefinitions(doc).map(x=>[x.key,x.count]),[['A',1],['B',0]]);
  assert.equal(beditTarget(doc,'A').ref.id,'r');
  const temp=beditTarget(doc,'B');assert.equal(temp.temporary,true);assert.deepEqual(temp.ref.position,P(0,0));
});

test('609 매개변수 블록: 같은 값이면 정의 하나, 값이 다르면 새 정의', ()=>{
  let calls=0;const build=p=>{calls++;return [line(P(0,0),P(p.width,0))];};
  const first=parametricReference({},'DOOR',{width:900,swing:'L'},build,{position:P(10,0),layer:'default'});
  assert.ok(first.definition);assert.equal(first.key,parametricKey('DOOR',{swing:'L',width:900.0004}));
  const defs={[first.key]:first.definition};
  const again=parametricReference(defs,'DOOR',{swing:'L',width:900},build,{position:P(500,0),layer:'default'});
  assert.equal(again.definition,null);assert.equal(calls,1);assert.equal(again.ref.sharedBlock,first.key);
  const other=parametricReference(defs,'DOOR',{swing:'L',width:1000},build,{});assert.notEqual(other.key,first.key);
  // 블록 모음 품목: 일람표가 읽는 category·attributes 는 그대로
  const item=BLOCK_ITEMS[0],values=itemDefaults(item),local=item.build(values);
  const upright=libraryReference({},item,values,local,{position:P(0,0),rotation:0,layer:'default'});
  const turned=libraryReference({[upright.key]:upright.definition},item,values,local,{position:P(0,0),rotation:200,layer:'default'});
  assert.equal(turned.ref.category,'LIBRARY');assert.equal(turned.ref.attributes.libraryId,item.id);assert.equal(turned.ref.attributes.width,values.width);
  assert.notEqual(turned.key,upright.key,'거꾸로 보일 회전은 문자를 바로 세운 정의를 따로');
  assert.equal(libraryReference({[upright.key]:upright.definition},item,values,local,{position:P(9,9),rotation:30,layer:'default'}).definition,null,'같은 값·같은 방향은 정의 재사용');
});

test('610 가시성 상태: 정의 하나에서 참조의 상태만 바꿔 보이는 자식이 바뀐다', ()=>{
  const defs={door:{origin:P(0,0),entities:[line(P(0,0),P(10,0)),{...line(P(0,0),P(0,10)),states:['열림']},{...line(P(0,0),P(7,7)),states:['닫힘','반열림']}]}};
  const ref=state=>({id:'d'+state,type:'block',name:'문',sharedBlock:'door',layer:'default',position:P(0,0),entities:[],...(state?{visibility:state}:{})});
  assert.equal(shownLines(sharedDoc(defs,[ref('열림')])).length,2);
  assert.equal(shownLines(sharedDoc(defs,[ref('닫힘')])).length,2);
  assert.equal(shownLines(sharedDoc(defs,[ref('')])).length,3,'상태가 없으면 모두');
  const plain={version:2,units:'mm',layers:[{id:'default',name:'0',color:'#ffffff',visible:true}],blocks:[],entities:[{id:'p',type:'block',name:'문',layer:'default',visibility:'열림',entities:defs.door.entities}]};
  assert.equal(shownLines(plain).length,2,'일반 블록도 같은 규칙');
  const engine=new DrawingEngine();engine.execute({type:'load',document:sharedDoc(defs,[ref('열림')])});
  engine.execute({type:'update',ids:['d열림'],changes:{visibility:'반열림'}});
  assert.equal(engine.doc.entities[0].visibility,'반열림');
});

test('604·603 MINSERT 묶음: 칸 참조만 세고(행×열), 칸마다 같은 정의를 펼쳐 그린다', ()=>{
  const defs={U:{origin:P(0,0),entities:[line(P(0,0),P(10,0))]}};
  const cells=Array.from({length:6},(_,i)=>({id:'c'+i,type:'block',name:'U',sharedBlock:'U',layer:'default',position:P((i%3)*100,Math.floor(i/3)*50),scale:1,rotation:0,entities:[]}));
  const minsert={id:'m',type:'block',name:'U',layer:'default',minsert:{rows:2,cols:3},entities:cells};
  assert.deepEqual(blockCounts([minsert],defs),[{name:'U',count:6}]);
  const engine=new DrawingEngine();engine.execute({type:'load',document:sharedDoc(defs,[minsert])});
  assert.equal(shownLines(engine.doc).length,6);
});
