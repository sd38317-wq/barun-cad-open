// ACAD200 영역 6 — 외부참조·XCLIP·밑그림(617·618·619·620·224) 시험.
import test from 'node:test';
import assert from 'node:assert/strict';
import {DrawingEngine} from './engine.js';
import * as G from './geometry.js';
import {installFileWorkflows} from './file-workflows.js';
import {dependentLayers,relayer,nestedXrefFilter,chooseXrefStorage,documentMark,documentChanged,staleXrefs,watchXrefs,xrefKey} from './xref-tools.js';
import {underlayDefinition,underlayReference,tileLevel,visibleTileIndices,createTileCache,UNDERLAY_LAYER} from './underlay.js';

const P=(x,y)=>({x,y});
const line=(a,b,layer)=>({type:'line',layer,points:[a,b]});

function xrefStudio(engine,source,{unitless=false,fingerprint='10:1'}={}){
  let fields,apply;const calls=[];
  const studio=installFileWorkflows({handlers:{},getFolder:()=>'',context:{engine,execute:c=>engine.execute(c),activeLayer:()=>'default',toast(){},field:(name,label,value)=>({name,value}),pointFields:()=>[{name:'x',value:0},{name:'y',value:0}],form:(title,f,callback)=>{fields=f;apply=callback;},
    api:async(name,data)=>{calls.push([name,data?.action]);if(name==='project')return data.action==='stat'?{fingerprint}:{data:'fixture',extension:'.dxf',fingerprint};return {report:{unitless},document:structuredClone(source)};}}});
  const run=async values=>{studio.handlers.XREF();await apply({...Object.fromEntries(fields.map(f=>[f.name,f.value])),...values});};
  return {run,calls};
}

test('617 외부참조 연결: 원본 레이어는 "파일명|레이어" 의존 레이어로(끄기·색 유지), 겹치기 중첩은 따라가지 않음', async()=>{
  const engine=new DrawingEngine();
  const source={layers:[{id:'s0',name:'0',color:'#ffffff',visible:true},{id:'s1',name:'벽',color:'#ff0000',visible:true}],entities:[line(P(0,0),P(100,0),'s1'),{type:'block',name:'안',layer:'s0',entities:[line(P(0,0),P(0,10),'s0')]},{type:'block',name:'겹침',layer:'s0',xref:{folder:'x',name:'over.dxf',mode:'overlay'},entities:[line(P(0,0),P(1,1),'s0')]}]};
  const {run}=xrefStudio(engine,source);
  await run({action:'attach',folder:'fixture',name:'평면.dxf',x:1000,y:0,scale:1});
  const names=engine.doc.layers.map(l=>l.name);
  assert.ok(names.includes('평면|벽')&&names.includes('평면|0'));
  assert.ok(engine.doc.layers.filter(l=>l.name.startsWith('평면|')).every(l=>l.xref===true));
  const ref=engine.doc.entities[0];
  assert.equal(ref.xref.mode,'attach');assert.equal(ref.xref.layers,'keep');assert.equal(ref.xref.fingerprint,'10:1');
  assert.equal(ref.entities.length,2,'겹치기(overlay) 중첩은 빠짐');
  const wall=engine.doc.layers.find(l=>l.name==='평면|벽');assert.equal(ref.entities[0].layer,wall.id);
  // 갱신: 같은 의존 레이어를 다시 쓰고 새로 만들지 않는다(끄기·색 유지)
  engine.execute({type:'layer.update',id:wall.id,changes:{visible:false}});
  const count=engine.doc.layers.length;
  await (xrefStudio(engine,source).run)({action:'refresh',id:ref.id});
  assert.equal(engine.doc.layers.length,count);assert.equal(engine.doc.layers.find(l=>l.id===wall.id).visible,false);
});

test('224·617 큰 외부참조는 공유 정의: 되돌리기 기록에 도형이 복사되지 않고, 갱신은 정의 교체', async()=>{
  const engine=new DrawingEngine();
  const big=Array.from({length:2100},(_,i)=>line(P(i,0),P(i,10),'s0'));
  const source={layers:[{id:'s0',name:'0',color:'#ffffff',visible:true}],entities:big};
  await xrefStudio(engine,source).run({action:'attach',folder:'fixture',name:'큰.dxf',x:0,y:0,scale:2});
  const ref=engine.doc.entities[0],key=xrefKey({folder:'fixture',name:'큰.dxf'});
  assert.equal(ref.sharedBlock,key);assert.deepEqual(ref.entities,[]);assert.equal(ref.xref.storage,'shared');assert.equal(ref.scale,2);
  assert.equal(engine.doc.sharedBlocks[key].entities.length,2100);
  engine.execute({type:'move',ids:[ref.id],dx:5,dy:0});
  assert.equal(engine.undoStack.at(-1).sharedBlocks,engine.doc.sharedBlocks,'기록과 정의 묶음을 같이 쓴다');
  const shown=G.visibleEntities(engine.doc)[0].entities;assert.equal(shown.length,2100);assert.deepEqual(shown[3].points[0],P(11,0));
  source.entities=source.entities.slice(0,2050);
  await xrefStudio(engine,source).run({action:'refresh',id:ref.id});
  assert.equal(engine.doc.sharedBlocks[key].entities.length,2050);assert.equal(engine.doc.entities[0].sharedBlock,key);
  assert.equal(chooseXrefStorage('auto',[line(P(0,0),P(1,1))]),'embedded');
});

test('623 단위 없는 외부참조는 거부하지 않고 기본 단위로 환산', async()=>{
  const engine=new DrawingEngine();
  await xrefStudio(engine,{entities:[line(P(0,0),P(1,0),'default')]},{unitless:true}).run({action:'attach',folder:'f',name:'u.dxf',x:0,y:0,scale:1,layers:'one'});
  assert.deepEqual(engine.doc.entities[0].entities[0].points[1],P(1,0),'기본 원본 단위 mm → 배율 1');
});

test('617 순환·겹치기 거르기와 의존 레이어 도우미', ()=>{
  const r=nestedXrefFilter([{xref:{folder:'a',name:'b.dxf'}},{xref:{folder:'c',name:'d.dxf',mode:'overlay'},name:'d'},{type:'line'},{xref:{folder:'A',name:'B.DXF'}}],{path:'a/b.dxf'});
  assert.equal(r.entities.length,1);assert.equal(r.skipped.length,1);assert.equal(r.cycles.length,2);
  const {map,add}=dependentLayers([{id:'1',name:'벽',color:'bad'}],'파일',[{id:'z',name:'파일|기존'}],()=> 'new');
  assert.deepEqual(add.map(l=>[l.name,l.color,l.xref]),[['파일|벽','#ffffff',true]]);
  assert.equal(relayer({layer:'1',entities:[{layer:'?'}]},map,'f').entities[0].layer,'f');
});

test('618 바뀜 비교는 문서 객체·되돌리기 깊이로(직렬화 없음), 원본 지문 감시', async()=>{
  const engine=new DrawingEngine();const mark=documentMark(engine);
  assert.equal(documentChanged(engine,mark),false);
  engine.execute({type:'add',entity:line(P(0,0),P(1,0),'default')});
  assert.equal(documentChanged(engine,mark),true);
  const refs=[{xref:{folder:'a',name:'1.dxf',fingerprint:'1'}},{xref:{folder:'a',name:'2.dxf',fingerprint:'2'}},{xref:{folder:'a',name:'3.dxf',fingerprint:'3'}}];
  const stat=async x=>{if(x.name==='3.dxf')throw Error('없음');return {fingerprint:x.name==='1.dxf'?'1':'changed'};};
  const stale=await staleXrefs(refs,stat);
  assert.deepEqual(stale.map(s=>[s.ref.xref.name,!!s.missing]),[['2.dxf',false],['3.dxf',true]]);
  let interval;const told=[];const stop=watchXrefs(()=>refs,stat,item=>told.push(item.ref.xref.name),1000,{setInterval:fn=>{interval=fn;return 1;},clearInterval:()=>{interval=null;}});
  await stop.tick();await stop.tick();
  assert.deepEqual(told,['2.dxf','3.dxf'],'같은 변화는 한 번만 알린다');
  stop();assert.equal(interval,null);
  // 엔진 stat: 갱신 확인(check) 작업이 엔진에 stat 을 묻는다
  const engine2=new DrawingEngine();const s=xrefStudio(engine2,{entities:[line(P(0,0),P(1,0),'default')]});
  await s.run({action:'attach',folder:'f',name:'w.dxf',x:0,y:0,scale:1});
  await s.run({action:'check',id:engine2.doc.entities[0].id});
  assert.ok(s.calls.some(([name,action])=>name==='project'&&action==='stat'));
});

test('619 XCLIP: 경계 상자 밖 자식은 펼치지도 방문하지도 않는다(반전 클립은 그대로)', ()=>{
  const children=Array.from({length:100},(_,i)=>line(P(i*100,0),P(i*100+50,0),'default'));
  const clip={points:[P(-10,-10),P(1000,-10),P(1000,10),P(-10,10)],enabled:true};
  const kept=G.clipPrefilter(clip,children);
  assert.equal(kept.length,11,'경계에 닿는 것까지(1000~1050)');assert.equal(G.clipPrefilter({...clip,inverted:true},children),children);assert.equal(G.clipPrefilter({...clip,enabled:false},children),children);
  const doc={version:3,units:'mm',layers:[{id:'default',name:'0',color:'#ffffff',visible:true}],blocks:[],sharedBlocks:{k:{origin:P(0,0),entities:children}},entities:[{id:'r',type:'block',name:'k',sharedBlock:'k',layer:'default',position:P(0,0),scale:1,rotation:0,clip,entities:[]}]};
  assert.equal(G.visibleEntities(doc)[0].entities.length,11);
  const inside=children.slice(0,5);assert.equal(G.clipPrefilter(clip,inside),inside,'모두 안쪽이면 같은 배열(복사 없음)');
});

test('620 PDF 밑그림: 벡터는 정의 하나·참조 하나(출력 안 하는 흐린 레이어), 타일 계산·LRU', ()=>{
  const {key,definition}=underlayDefinition([{id:'a',type:'line',layer:'x',color:'#ff0000',points:[P(0,0),P(10,0)]}],{name:'배치.pdf',page:2},'U');
  assert.equal(key,'underlay:배치.pdf#2');assert.equal(definition.entities[0].layer,'U');assert.equal(definition.entities[0].color,undefined);
  const ref=underlayReference(key,definition,{position:P(5,5),layer:'U'});
  assert.deepEqual([ref.sharedBlock,ref.underlay.page,ref.underlay.fade],[key,2,50]);
  assert.equal(UNDERLAY_LAYER.plot,false);
  assert.throws(()=>underlayDefinition([],{name:'scan.pdf'},'U'),/벡터/);
  const engine=new DrawingEngine();engine.execute({type:'layer.add',id:'U',name:'밑그림',color:'#7f8a96'});
  engine.execute({type:'shared.add',definitions:{[key]:definition},entities:[ref]});
  assert.equal(engine.doc.entities[0].sharedBlock,key);
  assert.equal(tileLevel(0.3),0);assert.equal(tileLevel(5),3);assert.equal(tileLevel(1e6),6);
  assert.deepEqual(visibleTileIndices({minX:0,minY:0,maxX:1000,maxY:1000},{minX:450,minY:-50,maxX:620,maxY:120},256),[{ix:1,iy:0},{ix:2,iy:0}]);
  assert.deepEqual(visibleTileIndices({minX:0,minY:0,maxX:10,maxY:10},{minX:20,minY:20,maxX:30,maxY:30},5),[]);
  const closed=[];const cache=createTileCache(2);cache.set('a',{close:()=>closed.push('a')});cache.set('b',{});cache.get('a');cache.set('c',{});
  assert.equal(cache.size,2);assert.equal(cache.get('b'),undefined);assert.deepEqual(closed,[]);cache.set('d',{});assert.deepEqual(closed,['a']);
});

test('watchXrefs 기본 타이머는 브라우저처럼 this 를 따지는 setInterval 에서도 돈다(Illegal invocation 회귀)',()=>{
  const real={set:globalThis.setInterval,clear:globalThis.clearInterval};
  globalThis.setInterval=function(fn,ms){if(this!==undefined&&this!==globalThis)throw new TypeError('Illegal invocation');return 7;};
  globalThis.clearInterval=function(){if(this!==undefined&&this!==globalThis)throw new TypeError('Illegal invocation');};
  try{const stop=watchXrefs(()=>[],async()=>null,()=>{});stop();}
  finally{globalThis.setInterval=real.set;globalThis.clearInterval=real.clear;}
});
