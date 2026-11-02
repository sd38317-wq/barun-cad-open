import test from 'node:test';import assert from 'node:assert/strict';import {DrawingEngine} from './engine.js';import {architecturalDetail,detailDefaults} from './architectural-library.js';import * as G from './geometry.js';
test('centerline red, wall yellow, dimensions white; undo restores source and layers',()=>{
 const e=new DrawingEngine();e.doc.entities=[{id:'axis',type:'line',layer:'default',color:'#123456',points:[{x:0,y:0},{x:4000,y:0}]}];const before=structuredClone(e.doc);
 const ids=e.execute({type:'add.classified',centerlineId:'axis',entities:[{type:'wall',layer:'default',points:[{x:0,y:0},{x:4000,y:0}],thickness:300,openings:[]},{type:'dimension',layer:'default',points:[{x:0,y:0},{x:4000,y:0},{x:0,y:600}],mode:'aligned',textHeight:100}]});
 const color=x=>e.doc.layers.find(l=>l.id===x.layer).color;assert.equal(color(e.doc.entities[0]),'#ff0000');assert.equal(e.doc.entities[0].color,undefined);assert.equal(color(e.doc.entities.find(x=>x.id===ids[0])),'#ffff00');assert.equal(color(e.doc.entities.find(x=>x.id===ids[1])),'#ffffff');e.execute({type:'undo'});assert.deepEqual(e.doc,before);
});
test('locked target rejects transaction without recoloring centerline',()=>{const e=new DrawingEngine();e.doc.layers.push({id:'locked',name:'A-WALL',color:'#ffff00',locked:true,visible:true});e.doc.entities=[{id:'axis',type:'line',layer:'default',points:[{x:0,y:0},{x:100,y:0}]}];const before=structuredClone(e.doc);assert.throws(()=>e.execute({type:'add.classified',centerlineId:'axis',entities:[{type:'wall',layer:'default',points:[{x:0,y:0},{x:100,y:0}],thickness:200}]}));assert.deepEqual(e.doc,before);});

test('참조로 놓은 문·창·기둥은 저마다 제 레이어와 제 색으로 들어간다',()=>{
 // 회귀: 블록 껍데기만 옮기고 안쪽 선은 현재 레이어에 남아, 놓는 족족 같은 색으로 보였다.
 const e=new DrawingEngine(),active=e.doc.layers[0].id;
 const 기대={DOD:['A-DOOR','#00ff00'],WID:['A-GLAZ','#00ffff'],COD:['A-COL','#ffff00'],STD:['A-STAIR','#a8c0ff'],ELD:['A-ELEV','#eab779']};
 for(const [cmd,[레이어,색]] of Object.entries(기대)){
  const ids=e.execute({type:'add.classified',entities:[architecturalDetail(cmd,{...detailDefaults(cmd),x:0,y:0},active)]});
  const made=e.doc.entities.find(x=>x.id===ids[0]),name=id=>e.doc.layers.find(l=>l.id===id)?.name;
  assert.equal(name(made.layer),레이어,cmd+' 블록');
  assert.deepEqual([...new Set(made.entities.map(c=>name(c.layer)))],[레이어],cmd+' 안쪽 선');
 }
 // 화면에 실제로 칠해지는 색까지 확인한다.
 for(const shown of G.visibleEntities(e.doc)){
  const 색=[...new Set(shown.entities.map(c=>c.color))];
  assert.equal(색.length,1,shown.name+' 색이 하나여야 한다');
  assert.ok(Object.values(기대).some(([,c])=>c===색[0]),shown.name+' 색 '+색[0]);
 }
 assert.equal(new Set(G.visibleEntities(e.doc).map(s=>s.entities[0].color)).size,5,'다섯 종류가 서로 다른 색이어야 한다');
});

