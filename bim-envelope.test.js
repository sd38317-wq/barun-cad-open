import test from 'node:test';
import assert from 'node:assert/strict';
import {northAllowedHeight,northDistance,sitePlanMasses,northCheck,northEnvelope,ifcPayload,floorElevation} from './bim-envelope.js';

// 20m x 20m 대지(mm), 북쪽 경계 y=20000. 1층 0~4m, 2층 4~8m, 3층 8~14m.
const square=[{x:0,y:0},{x:20000,y:0},{x:20000,y:20000},{x:0,y:20000}];
const floorRing=(y1)=>[{x:5000,y:2000},{x:15000,y:2000},{x:15000,y:y1},{x:5000,y:y1}];
function planDoc({top3=14,y3=14000,applies=true}={}){
 return {units:'mm',layers:[{id:'L',name:'0'}],entities:[
  {id:'site',type:'polyline',closed:true,parcelRole:'site',points:square,layer:'L',attributes:{pnu:'123'}},
  {id:'f1',type:'polyline',closed:true,points:floorRing(18000),layer:'L'},
  {id:'f2',type:'polyline',closed:true,points:floorRing(16000),layer:'L'},
  {id:'f3',type:'polyline',closed:true,points:floorRing(y3),layer:'L'},
 ],sitePlan:{request:{program:{floor_h:4}},report:{sunlight:{applies,boundary_credit_m:0,by_floor:[{floor:1,top_h:4},{floor:2,top_h:8},{floor:3,top_h:top3}]}},
  bindings:[{path:['floors',2],entityId:'f3'},{path:['floors',0],entityId:'f1'},{path:['floors',1],entityId:'f2'},{path:['footprint'],entityId:'f1'}]}};
}

test('정북일조 허용 높이: 1.5m 미만 0, 10m 이하 구간, 그 위는 거리의 2배',()=>{
 assert.equal(northAllowedHeight(1),0);
 assert.equal(northAllowedHeight(1.5),10);
 assert.equal(northAllowedHeight(4.99),10);
 assert.equal(northAllowedHeight(5),10);
 assert.equal(northAllowedHeight(7),14);
});

test('정북 거리는 점에서 정북으로 올라가 처음 닿는 경계까지',()=>{
 const ring=square.map(p=>({x:p.x/1000,y:p.y/1000}));
 assert.equal(northDistance(ring,{x:10,y:12}),8);
 assert.equal(northDistance(ring,{x:30,y:12}),Infinity);
});

test('배치 층은 층 순서로 쌓고 아래층 높이에서 시작한다',()=>{
 const masses=sitePlanMasses(planDoc());
 assert.deepEqual(masses.map(m=>[m.floor,m.low,m.top]),[[1,0,4],[2,4,8],[3,8,14]]);
});

test('북쪽 경계에 가까운 높은 층만 초과로 잡는다',()=>{
 // 3층 북쪽 끝 y=14m → 경계까지 6m → 허용 12m < 14m 초과. 2층은 4m 거리 → 허용 10m ≥ 8m 통과.
 const check=northCheck(planDoc());
 assert.deepEqual(check.floors.map(f=>f.ok),[true,true,false]);
 assert.ok(Math.abs(check.floors[2].margin+2)<1e-9);
 const fixed=northCheck(planDoc({y3:13000}));
 assert.ok(fixed.floors.every(f=>f.ok));
});

test('정북일조 비적용 지역이면 초과로 잡지 않고 허용 면도 그리지 않는다',()=>{
 const doc=planDoc({applies:false});
 assert.ok(northCheck(doc).floors.every(f=>f.ok));
 assert.equal(northEnvelope(doc).length,0);
});

test('허용 높이 면은 대지 안에만 있고 북쪽 1.5m 안은 높이 0',()=>{
 const tris=northEnvelope(planDoc(),{cells:20});
 assert.ok(tris.length>0);
 const points=tris.flat();
 assert.ok(points.every(p=>p.x>=0&&p.x<=20&&p.y>=0&&p.y<=20));
 assert.ok(points.filter(p=>p.y>18.6).every(p=>p.h===0));
});

test('IFC 자료: 벽의 문·창 위치는 벽 시작점에서 잰 거리',()=>{
 const doc={units:'mm',layers:[{id:'A',name:'A-WALL 2F',height:2800}],entities:[
  {id:'w',type:'wall',points:[{x:1000,y:0},{x:6000,y:0}],thickness:200,layer:'A'},
  {id:'d',type:'block',category:'DOOR',hostWall:'w',position:{x:2000,y:0},openingWidth:900,parameters:{height:2100},layer:'A'},
  {id:'n',type:'block',category:'WINDOW',hostWall:'w',position:{x:4000,y:0},openingWidth:1500,parameters:{height:1200,sill:900},layer:'A'},
  {id:'b',type:'polyline',closed:true,points:square,layer:'A'},
  {id:'t',type:'text',text:' 거실 ',roomBoundary:'b',layer:'A'},
 ]};
 const p=ifcPayload(doc);
 assert.equal(p.walls.length,1);
 assert.equal(p.walls[0].height,2800);
 assert.equal(p.walls[0].base,floorElevation('A-WALL 2F',3000));
 assert.deepEqual(p.walls[0].openings.map(o=>[o.kind,o.offset,o.width,o.sill]),[['door',1000,900,0],['window',3000,1500,900]]);
 assert.deepEqual(p.rooms.map(r=>r.name),['거실']);
 assert.deepEqual(ifcPayload(planDoc()).masses.map(m=>[m.floor,m.base,m.height]),[[1,0,4000],[2,4000,4000],[3,8000,6000]]);
});

test('옥탑은 맨 위층 위에 3m 로 얹고 정북일조 검토에 넣는다',()=>{
 const doc=planDoc({y3:13000});
 doc.entities.push({id:'roof',type:'polyline',closed:true,points:[{x:6000,y:12000},{x:9000,y:12000},{x:9000,y:15000},{x:6000,y:15000}],layer:'L'});
 doc.sitePlan.bindings.push({path:['rooftop_box'],entityId:'roof'});
 const last=sitePlanMasses(doc).at(-1);
 assert.deepEqual([last.floor,last.low,last.top],['옥탑',14,17]);
 // 옥탑 북쪽 끝 y=15m → 경계까지 5m → 허용 10m < 17m 초과.
 const check=northCheck(doc);
 assert.deepEqual(check.floors.map(f=>f.ok),[true,true,true,false]);
 assert.equal(ifcPayload(doc).masses.at(-1).floor,'옥탑');
});

test('배치도가 따로 그려져 있으면 그 안의 대지 경계로 검토한다',()=>{
 const doc=planDoc();
 // 원래 지적 대지는 멀리 떨어진 곳, 배치도 대지(A-SITE)는 층 덩어리와 같은 자리.
 doc.entities[0].points=square.map(p=>({x:p.x+900000,y:p.y}));
 doc.layers.push({id:'S',name:'A-SITE'},{id:'R',name:'A-SITE-ROAD'});
 doc.entities.push({id:'ps',type:'polyline',closed:true,points:square,layer:'S'},{id:'pr',type:'polyline',closed:true,points:[{x:0,y:20000},{x:20000,y:20000},{x:20000,y:26000},{x:0,y:26000}],layer:'R'});
 doc.sitePlan.contextGeometry=[{entityId:'ps'},{entityId:'pr'}];
 assert.deepEqual(northCheck(doc).floors.map(f=>f.ok),[true,true,false]);
 assert.equal(ifcPayload(doc).site[0].points,square);
});
