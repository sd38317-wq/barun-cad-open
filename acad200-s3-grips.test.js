// ACAD200 영역 3 — 그립: 307 한도, 308 색인 집기, 309 구간 가운데 그립·메뉴, 310 여러 뜨거운 그립.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as G from './geometry.js';
import {DrawingEngine} from './engine.js';
import {gripsShown,segmentGrips,gripMenuOps,extendedGripCommand,GripIndex,gripPickRadiusPx,HotGrips,GRIP_OBJ_LIMIT_DEFAULT} from './grip-tools.js';

const app=fs.readFileSync(new URL('./app.js',import.meta.url),'utf8');
const p=(x,y)=>({x,y});
function engineWith(entity){const engine=new DrawingEngine();const [id]=engine.execute({type:'add',entity:{...entity,layer:'default'}});return {engine,id,get:()=>engine.doc.entities.find(e=>e.id===id)};}

test('307 그립 한도: 기본 100 개, 넘으면 그리기·집기 모두 건너뜀, 0 은 한도 없음',()=>{
  assert.equal(GRIP_OBJ_LIMIT_DEFAULT,100);
  assert.equal(gripsShown(100),true);assert.equal(gripsShown(101),false);assert.equal(gripsShown(0),false);assert.equal(gripsShown(50000,0),true);assert.equal(gripsShown(5,'x'),true);
  assert.match(app,/if\(assistOn\)\{if\(selected\.size&&gripsVisibleNow\(\)\)paintGrips\(palette\);\}/,'그리기(화면 안 그립만 색인에서)');
  assert.match(app,/function gripHitAt\(p,w,e\)\{\r?\n  if\(!w\|\|!gripsVisibleNow\(\)\)return null;/,'집기');
  assert.match(app,/그립 숨김\(\$\{assist\.prefs\.gripObjLimit\}개 넘음\)/,'상태줄 안내');
});

test('308 그립 색인: 같은 열쇠면 다시 만들지 않고, 화면 상자 안에서 가장 가까운 그립, 손가락은 넓게',()=>{
  const entity={id:'a',type:'line',points:[p(0,0),p(100,0)]};
  const idx=new GripIndex();let builds=0;
  const collect=()=>{builds++;return G.editingGrips(entity).map(grip=>({entity,grip}));};
  idx.ensure('k1',collect);idx.ensure('k1',collect);assert.equal(builds,1);idx.ensure('k2',collect);assert.equal(builds,2);
  const screen=q=>({x:q.x,y:-q.y});
  assert.equal(idx.at(p(3,3),p(3,-3),screen,1,8)?.grip.index,0);
  assert.equal(idx.at(p(97,0),p(97,0),screen,1,8)?.grip.index,1);
  assert.equal(idx.at(p(50,0),p(50,0),screen,1,8),null);
  assert.equal(idx.at(p(12,0),p(12,0),screen,1,8),null,'마우스 8px 밖');
  assert.equal(idx.at(p(12,0),p(12,0),screen,1,gripPickRadiusPx('touch'))?.grip.index,0,'손가락 16px');
  // 많은 그립에서도 질의는 둘레만(정확성)
  const many=Array.from({length:3000},(_,i)=>({id:'e'+i,type:'line',points:[p(i*10,0),p(i*10+5,0)]}));
  const big=new GripIndex().ensure('m',()=>many.flatMap(e=>G.editingGrips(e).map(grip=>({entity:e,grip}))));
  assert.equal(big.at(p(15002,1),p(15002,-1),screen,1,8)?.entity.id,'e1500');
});

test('309 구간 가운데 그립: 폴리선·사각형 구간마다, 끌면 구간 평행 이동, 메뉴로 정점 추가·삭제',()=>{
  const poly={id:'p',type:'polyline',points:[p(0,0),p(100,0),p(100,100)]};
  assert.deepEqual(segmentGrips(poly).map(g=>g.point),[p(50,0),p(100,50)]);
  assert.equal(segmentGrips({...poly,closed:true}).length,3);assert.equal(segmentGrips({type:'line',points:[p(0,0),p(1,1)]}).length,0);
  assert.deepEqual(gripMenuOps(poly,{kind:'segment'}),['stretch','add-vertex']);assert.deepEqual(gripMenuOps(poly,{kind:'vertex'}),['stretch','remove-vertex']);
  assert.deepEqual(gripMenuOps({type:'rectangle',points:[]},{kind:'segment'}),['stretch']);
  const s=engineWith({type:'polyline',points:[p(0,0),p(100,0),p(100,100)]});
  const grip=segmentGrips(s.get())[0];
  s.engine.execute(extendedGripCommand(s.get(),grip,p(50,-20),'stretch'));
  assert.deepEqual(s.get().points,[p(0,-20),p(100,-20),p(100,100)],'구간 양 끝이 같이 움직인다');
  s.engine.execute(extendedGripCommand(s.get(),segmentGrips(s.get())[0],p(50,-50),'add-vertex'));
  assert.deepEqual(s.get().points,[p(0,-20),p(50,-50),p(100,-20),p(100,100)]);
  s.engine.execute(extendedGripCommand(s.get(),{kind:'vertex',index:1,point:p(50,-50)},p(50,-50),'remove-vertex'));
  assert.deepEqual(s.get().points,[p(0,-20),p(100,-20),p(100,100)]);
  const r=engineWith({type:'rectangle',points:G.rectangle(p(0,0),p(100,50))});
  const top=segmentGrips(r.get()).find(g=>g.point.y===50&&g.point.x===50)||segmentGrips(r.get())[2];
  r.engine.execute(extendedGripCommand(r.get(),top,{x:top.point.x,y:top.point.y+30},'stretch'));
  assert.equal(G.bounds([r.get()]).maxY,80,'사각형 한 변 늘이기');
  assert.equal(extendedGripCommand(poly,{kind:'vertex',index:0,point:p(0,0)},p(1,1),'stretch'),null,'정점 신축은 기본 그립 명령에 맡김');
  assert.throws(()=>extendedGripCommand({id:'x',type:'polyline',points:[p(0,0),p(1,0)]},{kind:'vertex',index:0,point:p(0,0)},p(0,0),'remove-vertex'),/최소/);
});

test('310 여러 뜨거운 그립: Shift+클릭으로 넣고 빼며, 그중 하나를 끌면 모두 한 번에 늘어난다',()=>{
  const s=engineWith({type:'polyline',points:[p(0,0),p(100,0),p(100,100),p(0,100)],closed:true});
  const hot=new HotGrips();hot.sync(1);
  const grips=G.editingGrips(s.get());
  assert.equal(hot.toggle(s.id,grips[1]),true);hot.toggle(s.id,grips[2]);assert.equal(hot.size,2);
  hot.toggle(s.id,grips[2]);assert.equal(hot.size,1);hot.toggle(s.id,grips[2]);
  assert.equal(hot.toggle(s.id,{kind:'move',point:p(0,0)}),false,'정점만');
  assert.equal(hot.command({id:s.id,grip:grips[0]},p(5,5)),null,'뜨겁지 않은 그립을 끌면 평소대로');
  const cmd=hot.command({id:s.id,grip:grips[1]},p(150,0));
  s.engine.execute(cmd);assert.deepEqual(s.get().points,[p(0,0),p(150,0),p(150,100),p(0,100)]);
  hot.sync(2);assert.equal(hot.size,0,'선택이 바뀌면 비운다');
  assert.match(app,/assist\.hotGrips\.toggle\(gh\.entity\.id,gh\.grip\)/);
  assert.match(app,/const hot=assist\.hotGrips\.command\(d,point\);if\(hot\)\{d\.hotUsed=true;return hot;\}/);
});
