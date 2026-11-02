import test from 'node:test';
import assert from 'node:assert/strict';
import {site3dModel,planMasses,BUILDING_COLORS,GROUND_BOARDS,focusPoint} from './site-3d.js';
import {ANALYSIS_PANELS} from './site-analysis.js';

const line=(y)=>Array.from({length:21},(_,i)=>({x:-50000+i*5000,y}));
const square=(x,y,s)=>[{x,y},{x:x+s,y},{x:x+s,y:y+s},{x,y:y+s}];

test('3D 재료: 지반고는 대지 가운데 기준 0, 주변 건물은 지반고·높이, 높이 없는 건물은 추정 표시',()=>{
 const doc={entities:[
  {type:'polyline',closed:true,parcelRole:'site',points:square(0,0,10000),attributes:{ring:'outer'}},
  {type:'polyline',closed:false,parcelRole:'contour',points:line(5000),attributes:{elevationM:20}},
  {type:'polyline',closed:false,parcelRole:'contour-major',points:line(40000),attributes:{elevationM:25}},
  {type:'polyline',closed:true,parcelRole:'building',points:square(20000,0,8000),model3d:{height:12600},attributes:{groundM:21,heightSource:'건물 높이(GIS건물통합정보)'}},
  {type:'polyline',closed:true,parcelRole:'building',points:square(-30000,0,8000),model3d:{height:6600},attributes:{groundM:null,heightSource:'지상 2층 × 3.3m'}},
 ]};
 const m=site3dModel(doc);
 assert.equal(m.hasTerrain,true);assert.ok(Math.abs(m.base-20)<0.5,String(m.base));
 assert.equal(m.terrain.length,2);assert.equal(m.terrain[1].major,true);assert.ok(Math.abs(m.terrain[0].points[0].z-(20-m.base))<1e-9);
 assert.equal(m.buildings.length,2);assert.equal(m.buildings[0].height,12.6);assert.ok(Math.abs(m.buildings[0].z-(21-m.base))<1e-9);
 assert.equal(m.buildings[0].estimated,false);assert.equal(m.buildings[1].estimated,true);
 assert.equal(m.lines[0].role,'site');
});

test('계획 매스: 설계엔진 층별 윤곽(5187 m)을 도면 원점 mm 로, 높이는 층수로 나눈다 — 원점·좌표계가 없으면 없음',()=>{
 const ring=[[1000,2000],[1010,2000],[1010,2010],[1000,2010]];
 const doc={drawingGeo:{crs:'EPSG:5187',originM:[1000,2000]},sitePlan:{geometry:{footprint:ring,floors:[ring,ring,ring]},report:{numbers:{floors:3,height:9.9}}}};
 const masses=planMasses(doc);
 assert.equal(masses.length,3);assert.deepEqual(masses[0].points[2],{x:10000,y:10000});assert.ok(Math.abs(masses[2].z-6.6)<1e-9);assert.ok(Math.abs(masses[1].height-3.3)<1e-9);
 assert.deepEqual(planMasses({...doc,drawingGeo:{crs:'EPSG:5179',originM:[0,0]}}),[]);
 assert.deepEqual(planMasses({sitePlan:doc.sitePlan}),[]);
});

test('3D 건물 색: 대지분석 도판과 같은 높이·용도·연대 색, 층수 없는 건물은 높이 미상 · 바닥 도판은 모두 있는 도판',()=>{
 const sq=square(0,0,8000);
 const m=site3dModel({entities:[
  {type:'polyline',closed:true,parcelRole:'site',points:square(0,0,1000),attributes:{ring:'outer'}},
  {type:'polyline',closed:true,parcelRole:'building',points:sq,model3d:{height:45000},attributes:{heightM:45,heightSource:'건물 높이(GIS건물통합정보)',useCode:'14000',approvalYear:1985}},
  {type:'polyline',closed:true,parcelRole:'building',points:sq,model3d:{height:3300},attributes:{heightM:3.3,heightSource:'층수 없음 · 1층으로 봄'}},
 ]});
 const [tall,unknown]=m.buildings;
 assert.equal(BUILDING_COLORS.height.of(tall),'#2563eb');assert.equal(BUILDING_COLORS.height.of(unknown),'#e0e0de');
 assert.equal(BUILDING_COLORS.use.of(tall),'#7fa7e3');assert.equal(BUILDING_COLORS.age.of(tall),'#9c3a24');assert.equal(BUILDING_COLORS.age.of(unknown),'#e3e3e1');
 assert.equal(BUILDING_COLORS.basic.of(unknown),'#8d969d');
 for(const g of GROUND_BOARDS)if(g.key)assert.ok(ANALYSIS_PANELS.some(p=>p.key===g.key),g.key);
});

test('3D 반경: 대지 가운데에서 반경 안 건물만, 등고선은 원 밖에서 끊는다(대지분석 원 도판과 같은 원)',()=>{
 const doc={entities:[
  {type:'polyline',closed:true,parcelRole:'site',points:square(-5000,-5000,10000),attributes:{ring:'outer'}},
  {type:'polyline',closed:true,parcelRole:'building',points:square(40000,0,8000),model3d:{height:9900},attributes:{}},
  {type:'polyline',closed:true,parcelRole:'building',points:square(120000,0,8000),model3d:{height:9900},attributes:{}},
  {type:'polyline',closed:false,parcelRole:'contour',points:line(0),attributes:{elevationM:20}},
 ]};
 assert.equal(site3dModel(doc).buildings.length,2);
 const m=site3dModel(doc,{radiusM:45});
 assert.equal(m.buildings.length,1);assert.ok(m.buildings[0].points.every(p=>Math.hypot(p.x,p.y)<=45000+1),'걸친 건물은 원 둘레에서 잘린다');assert.ok(m.buildings[0].points.length>4);
 assert.equal(m.terrain.length,1);assert.ok(m.terrain[0].points.every(p=>Math.hypot(p.x,p.y)<=45000+1),'원 밖 점 없음');
 assert.ok(m.terrain[0].points.length<21);
 assert.ok(m.lines.every(l=>l.points.every(p=>Math.hypot(p.x,p.y)<=45000+1)),'지적선도 원 안만');assert.equal(m.lines[0].closed,true,'다 안에 있는 대지 선은 닫힌 채로');
});

test('3D 첫 화면: 계획안이 있으면 계획 매스, 없으면 대지 가운데 · 색 설명은 고른 색에 따라(보이는 색만)',()=>{
 const site={type:'polyline',closed:true,parcelRole:'site',points:square(10000,20000,10000),attributes:{ring:'outer'}};
 const m=site3dModel({entities:[site,{type:'polyline',closed:true,parcelRole:'building',points:square(40000,0,8000),model3d:{height:45000},attributes:{heightM:45,heightSource:'건물 높이(GIS건물통합정보)',useCode:'14000'}}]});
 assert.deepEqual(focusPoint(m),{x:15,y:0,z:-25},'대지 가운데(동 15m, 북 25m)');
 assert.deepEqual(focusPoint({...m,plan:[{points:[{x:0,y:0},{x:2000,y:0}]}]}),{x:1,y:0,z:-0});
 assert.equal(focusPoint({plan:[],lines:[]}),null);
 assert.deepEqual(BUILDING_COLORS.basic.legend(m).map(x=>x.t),['실제 높이(GIS)','층수로 추정']);
 assert.deepEqual(BUILDING_COLORS.basic.legend({...m,plan:[{points:[]}]}).map(x=>x.t)[0],'계획안');
 assert.deepEqual(BUILDING_COLORS.height.legend(m).map(x=>x.t),['35~60m']);
 assert.deepEqual(BUILDING_COLORS.use.legend(m).map(x=>x.t),['업무']);
 assert.deepEqual(BUILDING_COLORS.age.legend(m).map(x=>x.t),['미상']);
});
