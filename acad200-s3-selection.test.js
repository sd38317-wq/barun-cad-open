// ACAD200 영역 3 — 선택: 302 올가미, 303 호버, 304 창 미리보기, 305 겹친 객체 순환, 306 선택 집합, 321 더블클릭 표,
// 322 해치 집기, 323 아웃코드, 324 선택 옵션, 325 비슷한 객체.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as G from './geometry.js';
import {crossing,segmentHitsBox} from './view.js';
import {pickDistance,pickDisplayEntity,setHatchPickInterior,setHatchPickMode} from './display-picking.js';
import {selectSimilar,similarKeys,describeSimilarMode} from './drafting-tools.js';
import {hoverAllowed,HoverPreview,toggleSelectionCycling,selectionCyclingMode,SelectionSteps,LassoPath,polygonSelectionHits,polygonBounds,WindowPreview,windowSelects,doubleClickAction,selectionOption} from './selection-assist.js';

const app=fs.readFileSync(new URL('./app.js',import.meta.url),'utf8');
const line=(id,a,b,extra={})=>({id,type:'line',layer:'0',points:[a,b],...extra});
const p=(x,y)=>({x,y});

test('302 올가미: 4px 보다 촘촘한 점은 버리고, 오른→왼은 걸침, Space 로 창→걸침→울타리',()=>{
  const l=new LassoPath(p(0,0),p(100,100));
  assert.equal(l.add(p(1,1),p(102,100)),false);assert.equal(l.add(p(5,0),p(110,100)),true);
  assert.equal(l.effectiveKind,'WP');l.add(p(-5,0),p(90,100));assert.equal(l.effectiveKind,'CP');
  assert.equal(l.cycle(),'F');assert.equal(l.cycle(),'WP');assert.equal(l.cycle(),'CP');
  assert.deepEqual(polygonBounds([p(1,5),p(-2,3),p(4,-1)]),{minX:-2,minY:-1,maxX:4,maxY:5});
});
test('302 올가미 판정은 applySelectPolygon 과 같은 규칙(WP 모두 안, CP 걸침, F 선과 만남)',()=>{
  const inside=line('in',p(2,2),p(4,4)),half=line('half',p(5,5),p(20,5)),out=line('out',p(30,30),p(40,40));
  const square=[p(0,0),p(10,0),p(10,10),p(0,10)];
  assert.deepEqual(polygonSelectionHits([inside,half,out],'WP',square,G).map(e=>e.id),['in']);
  assert.deepEqual(polygonSelectionHits([inside,half,out],'CP',square,G).map(e=>e.id),['in','half']);
  assert.deepEqual(polygonSelectionHits([inside,half,out],'F',[p(15,0),p(15,10)],G).map(e=>e.id),['half']);
  assert.match(app,/boxCandidates\(IA\.polygonBounds\(poly\)\)/,'F·WP·CP 도 경계 상자 후보만 본다');
});

test('303 호버: 대기 중·선택 단계에서만, 단추를 누르면 끔, 멈춘 뒤 한 번만 집고 바뀔 때만 다시 그림',()=>{
  assert.equal(hoverAllowed({mode:'SELECT',phase:'idle'}),true);
  assert.equal(hoverAllowed({mode:'SELECT',phase:'idle',buttons:1}),false);
  assert.equal(hoverAllowed({mode:'MOVE',phase:'select',pref:1}),false);
  assert.equal(hoverAllowed({mode:'MOVE',phase:'select',pref:2}),true);
  assert.equal(hoverAllowed({mode:'LINE',phase:'point'}),false);
  const timers=[];const h=new HoverPreview({setTimer:fn=>{timers.push(fn);return timers.length;},clearTimer:id=>{timers[id-1]=null;}});
  let picks=0,changes=0;const pick=()=>{picks++;return 'a';};
  for(let i=0;i<5;i++)h.schedule(true,pick,()=>changes++,p(i,0));
  assert.equal(picks,0,'움직이는 동안은 집지 않는다');timers.filter(Boolean).forEach(fn=>fn());
  assert.equal(picks,1);assert.equal(changes,1);assert.equal(h.id,'a');
  h.schedule(true,pick,()=>changes++,p(5,0));timers.filter(Boolean).at(-1)();assert.equal(changes,1,'같은 결과면 다시 그리지 않는다');
  h.schedule(false,pick,()=>changes++,p(5,0));assert.equal(h.id,null);assert.equal(changes,2);
});
test('305 겹친 객체: Shift+Space 로 돌린 후보는 손떨림에 풀리지 않고 클릭이 집는다 · 끄고 켜도 모드 기억',()=>{
  const h=new HoverPreview({setTimer:()=>0,clearTimer:()=>{}});h.id='a';
  assert.equal(h.cycle(['a','b','c'],p(10,10)),true);assert.equal(h.id,'b');assert.equal(h.cycle(['a','b','c'],p(10,10))&&h.id,'c');
  h.schedule(true,()=>'zzz',null,p(12,11));assert.equal(h.pinnedId(p(12,11)),'c','4px 안 떨림은 유지');
  assert.equal(h.pinnedId(p(30,10)),null);assert.equal(h.cycle(['a'],p(0,0)),false);
  assert.equal(toggleSelectionCycling(0),2);assert.equal(toggleSelectionCycling(2),-2);assert.equal(toggleSelectionCycling(-2),2);assert.equal(toggleSelectionCycling(1),-1);
  assert.equal(selectionCyclingMode(-2),0);assert.equal(selectionCyclingMode(2),2);
  assert.match(app,/IA\.selectionCyclingMode\(assist\.prefs\.selectionCycling\)===2\)\?handleOverlapSelection/);
});

test('304 창 미리보기: 결과는 놓을 때 판정과 같고, 6ms 씩 나눠 계산하며, 한도를 넘으면 생략',()=>{
  const es=Array.from({length:100},(_,i)=>line('l'+i,p(i*10,0),p(i*10+5,5)));
  const box={minX:-1,minY:-1,maxX:300,maxY:10},test=(e,b,c)=>windowSelects(e,b,c,{G,crossing});
  let now=0;const w=new WindowPreview({limit:1000,budgetMs:2,clock:()=>now+=1});
  let frames=0;while(!w.update(box,false,()=>es,test))frames++;
  assert.ok(frames>=2,'한 프레임에 다 하지 않는다');
  const expected=es.filter(e=>test(e,box,false)).map(e=>e.id);assert.deepEqual(w.result(box,false),expected);
  assert.equal(w.result(box,true),null,'다른 상자(걸침)는 다시 계산');
  const small=new WindowPreview({limit:10});assert.equal(small.update(box,true,()=>es,test),true);assert.equal(small.skipped,true);assert.equal(small.result(box,true),null);
  let queries=0;const bigger={...box,maxX:400};assert.equal(small.update(bigger,true,()=>{queries++;return es;},test),true);assert.equal(queries,0,'한도를 넘은 상자를 품는 더 큰 상자는 질의하지 않는다');
  assert.match(app,/const ready=typeof windowPreviewResult==='function'&&phase!=='window'\?windowPreviewResult\(box,cross\):null;/);
});

test('306 선택 집합: addMany 는 리비전을 한 번만, chosen() 은 같은 선택·도면이면 같은 배열',()=>{
  const begin=app.indexOf('class SelectionSet extends Set {'),end=app.indexOf('// 성능: 레이어 선형 탐색',begin);
  const steps=new SelectionSteps();steps.start();
  const c={selectionRevision:0,blockEditOutside:new Set(['blocked']),assist:{steps}};vm.createContext(c);
  vm.runInContext(app.slice(begin,end)+';globalThis.SelectionSet=SelectionSet;',c);
  const s=new c.SelectionSet();const before=c.selectionRevision;
  assert.equal(s.addMany(['a','b','a','blocked','c']),3);assert.equal(c.selectionRevision,before+1);assert.deepEqual([...s],['a','b','c']);
  assert.equal(s.addMany(['a']),0);assert.equal(c.selectionRevision,before+1,'더한 게 없으면 리비전 그대로');
  // chosen 캐시
  const m=app.match(/  chosen = \(\) => \{[\s\S]*?\n  \};/);assert.ok(m);
  const entities=[{id:'a'},{id:'b'}],map=new Map(entities.map(e=>[e.id,e]));
  const ctx={selectionRevision:1,sceneRevision:1,selected:new Set(['a']),engine:{doc:{entities}},entityMap:()=>map};ctx.fresh_chosen=()=>[...ctx.selected].map(id=>map.get(id));vm.createContext(ctx);
  vm.runInContext('var chosen;'+m[0].trim().replace(/^chosen/,'chosen')+';',ctx);
  const first=ctx.chosen();assert.equal(ctx.chosen(),first);ctx.selectionRevision++;ctx.selected.add('b');
  assert.notEqual(ctx.chosen(),first);assert.deepEqual([...ctx.chosen().map(e=>e.id)],['a','b']);
  assert.match(app,/if\(option==='ALL'\)\{const ids=allSelectableIds\(\);if\(selected\.addMany\)selected\.addMany\(ids\)/);
});
test('324 선택 단계 기록: U 는 마지막 동작(더하기·빼기)만 되돌린다 · SI·BOX·AU·M 해석',()=>{
  const s=new SelectionSteps(),sel=new Set();
  const record={add:id=>{sel.add(id);s.record('+',id);},del:id=>{sel.delete(id);s.record('-',id);}};
  s.record('+','ignored');assert.equal(s.size,0,'선택 단계가 아니면 기록 없음');
  s.start();s.begin();record.add('a');record.add('b');s.begin();record.add('c');record.del('a');
  assert.equal(s.undo(sel),2);assert.deepEqual([...sel].sort(),['a','b']);
  assert.equal(s.undo(sel),2);assert.deepEqual([...sel],[]);assert.equal(s.undo(sel),0);
  assert.equal(selectionOption('u'),'undo');assert.equal(selectionOption('SI'),'single');assert.equal(selectionOption('BOX'),'default');assert.equal(selectionOption('AU'),'default');assert.equal(selectionOption('M'),'default');assert.equal(selectionOption('W'),null);
  assert.match(app,/if\(kind==='undo'\)\{const count=assist\.steps\.undo\(selected\)/);
  assert.match(app,/function afterSelectionGesture\(\)\{/);
});

test('321 더블클릭 표: 문자·블록·해치·폴리선은 전용 편집, 나머지는 특성, 잠김·끔 처리',()=>{
  assert.equal(doubleClickAction({type:'text'}),'text-inline');
  assert.equal(doubleClickAction({type:'block'}),'block-edit');
  assert.equal(doubleClickAction({type:'block'},{blockEditing:true}),'properties');
  assert.equal(doubleClickAction({type:'hatch'}),'command:HATCHEDIT');
  assert.equal(doubleClickAction({type:'polyline'}),'command:PLINEEDIT');
  assert.equal(doubleClickAction({type:'circle'}),'properties');
  assert.equal(doubleClickAction({type:'hatch'},{locked:true}),'properties');
  assert.equal(doubleClickAction({type:'text'},{enabled:false}),'none');
  assert.match(app,/if\(typeof doubleClickEdit==='function'\)\{doubleClickEdit\(hit\);return;\}/);
  // 사용자 요청(10/16): 선·원 등 '특성' 동작은 가운데 창 대신 오른쪽 특성 창을 연다
  assert.match(app,/\['line','circle','arc','ellipse','spline','point','xline','ray'\]\.includes\(hit\.type\)&&!hit\.parameters&&!hit\.libraryCommand\)\{if\(propertiesDock\.open\)/,'문·창·계단 같은 건축 블록과 벽은 전용 편집 창을 그대로 연다');
});

test('322 무늬 해치는 그려진 대로: 빈칸은 안 집히고 무늬 선·경계는 집힘, 칠 해치는 안쪽 전체',()=>{
  const ring=[p(0,0),p(1000,0),p(1000,1000),p(0,1000)];
  const pattern={id:'h',type:'hatch',points:ring,pattern:'lines',spacing:100,angle:0,origin:p(0,0)};
  const solid={...pattern,id:'s',solid:true,pattern:'solid'};
  const tol=10;
  assert.ok(pickDistance(pattern,p(500,150),tol)>pickDistance(pattern,p(500,103),tol),'무늬 빈칸(선에서 50) 은 무늬 선보다 약하게');
  assert.ok(pickDistance(pattern,p(500,103),tol)<tol,'무늬 선 3 거리는 집힘');
  assert.ok(pickDistance(pattern,p(2,500),tol)<tol,'경계는 집힘');
  assert.equal(pickDistance(solid,p(500,150),tol),tol/2,'칠 해치는 안쪽(반 칸 미룸)');
  const under=line('under',p(400,150),p(600,150));
  assert.equal(pickDisplayEntity([under,pattern],p(500,152),tol)?.id,'under','해치 아래 선을 고를 수 있다');
  assert.equal(pickDistance(pattern,p(500,150),tol),tol*0.95,'빈칸은 약한 집기: 해치만 있으면 집힌다');
  setHatchPickMode('drawn');try{assert.equal(pickDistance(pattern,p(500,150),tol),Infinity,'AutoCAD 식: 빈칸은 안 집힘');}finally{setHatchPickMode('weak');}
  setHatchPickInterior(true);try{assert.equal(pickDistance(pattern,p(500,150),tol),tol/2,'예전 동작 설정');}finally{setHatchPickInterior(false);}
});

test('323 아웃코드: 같은 바깥쪽 선분은 바로 버리고, 결과는 교점 계산과 같다',()=>{
  const box={minX:0,minY:0,maxX:10,maxY:10};
  assert.equal(segmentHitsBox(p(-5,-5),p(-1,20),box),false);
  assert.equal(segmentHitsBox(p(-5,5),p(15,5),box),true);
  assert.equal(segmentHitsBox(p(-5,12),p(12,-5),box),true);
  assert.equal(segmentHitsBox(p(-5,26),p(26,-5),box),false,'모서리 밖을 비껴감');
  const brute=(a,c)=>{for(let i=0;i<=4000;i++){const t=i/4000,x=a.x+(c.x-a.x)*t,y=a.y+(c.y-a.y)*t;if(x>=0&&x<=10&&y>=0&&y<=10)return true;}return false;};
  let seed=7;const r=()=>{seed=(seed*16807)%2147483647;return seed/2147483647*40-15;};
  for(let i=0;i<400;i++){const a=p(r(),r()),c=p(r(),r());if(segmentHitsBox(a,c,box)!==brute(a,c)){
    const near=Math.min(...[a,c].map(q=>Math.min(Math.abs(q.x),Math.abs(q.x-10),Math.abs(q.y),Math.abs(q.y-10))));if(near>0.05)assert.fail(`다름 ${JSON.stringify([a,c])}`);}}
  const poly={type:'polyline',points:Array.from({length:2000},(_,i)=>p(i*10,Math.sin(i)*3))};
  assert.equal(crossing(poly,{minX:5000,minY:-10,maxX:5004,maxY:10}),true);
  assert.equal(crossing(poly,{minX:5000,minY:20,maxX:5010,maxY:30}),false);
});

test('325 비슷한 객체: 고른 객체 모두가 기준, 종류는 늘 같고, 기본 130 = 종류+레이어+이름',()=>{
  const layers=[{id:'A',visible:true},{id:'B',visible:true},{id:'H',visible:false}];
  const es=[line('l1',p(0,0),p(1,0),{layer:'A'}),line('l2',p(0,1),p(1,1),{layer:'A',color:'#ff0000'}),line('l3',p(0,2),p(1,2),{layer:'B'}),
    {id:'c1',type:'circle',layer:'A',center:p(0,0),radius:1},{id:'b1',type:'block',layer:'A',name:'DOOR',entities:[]},{id:'b2',type:'block',layer:'A',name:'WIN',entities:[]},
    {id:'b3',type:'block',layer:'A',name:'DOOR',entities:[]},line('lh',p(0,3),p(1,3),{layer:'H'})];
  assert.deepEqual(selectSimilar(es,layers,[es[0]]).map(e=>e.id),['l1','l2']);
  assert.deepEqual(selectSimilar(es,layers,[es[0],es[2]]).map(e=>e.id),['l1','l2','l3']);
  assert.deepEqual(selectSimilar(es,layers,[es[4]]).map(e=>e.id),['b1','b3']);
  assert.deepEqual(selectSimilar(es,layers,[es[0]],131).map(e=>e.id),['l1'],'색까지 같아야');
  assert.deepEqual(selectSimilar(es,layers,[es[0]],0).map(e=>e.id),['l1','l2','l3']);
  assert.deepEqual(similarKeys(130),['type','layer','block']);assert.equal(describeSimilarMode(130),'종류+레이어+이름');
  assert.throws(()=>selectSimilar(es,layers,[]),/기준/);
});

test('Ctrl+A·선택 ALL 은 화면 밖·큰 도면도 전부(숨김·꺼짐·동결·잠금 레이어만 뺌)',()=>{
  const m=app.match(/  allSelectableIds = \(\) => \{[\s\S]*?\n  \},/);assert.ok(m,'allSelectableIds 정의');
  const layers=[{id:'on',visible:true},{id:'off',visible:false},{id:'frz',visible:true,frozen:true},{id:'lck',visible:true,locked:true}];
  // 5만 개 초과: 예전에는 visible() 이 화면 안만 돌려줘 일부만 골랐다.
  const entities=Array.from({length:60000},(_,i)=>({id:'e'+i,layer:'on'}));
  entities.push({id:'hid',layer:'on',hidden:true},{id:'o',layer:'off'},{id:'f',layer:'frz'},{id:'l',layer:'lck'},{id:'nolayer',layer:'gone'});
  const ctx={engine:{doc:{entities}},layerMap:()=>new Map(layers.map(l=>[l.id,l]))};vm.createContext(ctx);
  vm.runInContext('var allSelectableIds='+m[0].trim().replace(/^allSelectableIds = /,'').replace(/,$/,'')+';',ctx);
  const ids=ctx.allSelectableIds();
  assert.equal(ids.length,60000);assert.ok(!ids.some(id=>['hid','o','f','l','nolayer'].includes(id)));
  for(const call of [/key === "A"\) \{\r?\n    e\.preventDefault\(\);\r?\n    setSelected\(allSelectableIds\(\)\);/,/mode==='SELECT'&&option==='ALL'\)\{setSelected\(allSelectableIds\(\)\)/])assert.match(app,call);
});
