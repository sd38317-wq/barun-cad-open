import test from 'node:test';
import assert from 'node:assert/strict';
import {basicWindSpeed,kzr,designWind,wallCpe,facePressure,windVector,classifyFace,windOnWalls,IMPORTANCE} from './wind-load.js';

const near=(a,b,tol,msg)=>assert.ok(Math.abs(a-b)<=tol,`${msg}: ${a} vs ${b}`);

test('지역별 기본풍속(LH DA-93-005-1 표): 주소·시군 이름, 같은 이름은 도로 구분', ()=>{
 assert.equal(basicWindSpeed('서울특별시 강남구 테헤란로').speed,26);
 assert.equal(basicWindSpeed('부산광역시 해운대구').speed,38);
 assert.equal(basicWindSpeed('제주특별자치도 서귀포시').speed,44);
 assert.equal(basicWindSpeed('경기도 광주시').speed,26);
 assert.equal(basicWindSpeed('광주광역시 북구').speed,26);
 assert.equal(basicWindSpeed('강원도 고성군').speed,34);
 assert.equal(basicWindSpeed('경상남도 고성군').speed,32);
 assert.match(basicWindSpeed('고성').error,/여러 지역/);
 assert.equal(basicWindSpeed('경기도 남양주시').speed,26,'남양주는 양주와 다르게');
 assert.equal(basicWindSpeed('울산광역시 울주군').speed,34);
 assert.equal(basicWindSpeed('인천광역시').speed,28);
 assert.match(basicWindSpeed('어딘가').error,/표에 없는/);
});

test('풍속고도분포계수(표 5.5-2·5.5-3)', ()=>{
 assert.equal(kzr(5,'C'),1.0);assert.equal(kzr(10,'C'),1.0);
 near(kzr(30,'C'),.71*30**.15,1e-12,'C 30 m');near(kzr(100,'A'),.22*100**.33,1e-12,'A 100 m');
 assert.equal(kzr(3,'D'),1.13);assert.equal(kzr(15,'B'),.81);
 near(kzr(900,'B'),.45*450**.22,1e-12,'Z_g 위는 Z_g 값');
 assert.throws(()=>kzr(10,'E'),/A·B·C·D/);
});

test('설계풍속·속도압(5.5): V = V0·K_D·K_zr·K_zt·I_w, q = ½·1.225·V²', ()=>{
 const r=designWind({V0:38,terrain:'C',height:30,importance:'1'});
 const V=38*(.71*30**.15);near(r.VH,V,1e-9,'V_H');near(r.qH,.5*1.225*V*V,1e-6,'q_H');
 assert.equal(IMPORTANCE['특'],1.05);assert.equal(IMPORTANCE['3'],.90);
 assert.throws(()=>designWind({V0:30,height:10,importance:'4'}),/중요도/);
});

test('외압계수(표 5.15-1)와 최소 675 N/m²', ()=>{
 assert.equal(wallCpe('windward'),.6);assert.equal(wallCpe('leeward'),-.5);
 assert.deepEqual([0,.7,2,3].map(x=>wallCpe('side',x)),[-.8,-.7,-.3,-.2]);
 assert.deepEqual([0,.7,2,3].map(x=>wallCpe('roof',x)),[-1,-.8,-.3,-.2]);
 assert.deepEqual(facePressure(500,.6),{pressure:675,raw:300,minApplied:true});
 assert.equal(facePressure(2000,-.5,2).pressure,-2000);
});

test('바람 방향·면 분류·벽 면별 풍압', ()=>{
 const n=windVector(0);near(n.x,0,1e-12,'x');near(n.y,-1,1e-12,'북풍은 남쪽으로');
 assert.equal(classifyFace({x:0,y:1},windVector(0)),'windward');   // 북쪽 면에 북풍
 assert.equal(classifyFace({x:0,y:-1},windVector(0)),'leeward');
 assert.equal(classifyFace({x:1,y:0},windVector(0)),'side');
 const box=[{id:'S',a:{x:0,y:0},b:{x:20000,y:0}},{id:'E',a:{x:20000,y:0},b:{x:20000,y:10000}},{id:'N',a:{x:20000,y:10000},b:{x:0,y:10000}},{id:'W',a:{x:0,y:10000},b:{x:0,y:0}}];
 const [north]=windOnWalls(box,{qH:1500,height:10,directions:[0]});
 const f=id=>north.faces.find(x=>x.id===id);
 assert.equal(f('N').face,'windward');assert.equal(f('N').pressure,900);
 assert.equal(f('S').face,'leeward');assert.equal(f('S').pressure,-750);
 assert.equal(f('E').face,'side');assert.equal(f('E').cpe,-.7);   // 벽 가운데가 풍상끝에서 5 m = 0.5H
 assert.equal(north.label,'북풍');assert.equal(north.maxPositive,900);assert.equal(north.maxNegative,-1050);
});

test('실내 칸막이·안쪽 면은 빼고 바깥 벽만', async ()=>{
 const {exteriorWalls}=await import('./wind-load.js');
 const box=[{id:'S',a:{x:0,y:0},b:{x:20000,y:0}},{id:'E',a:{x:20000,y:0},b:{x:20000,y:10000}},{id:'N',a:{x:20000,y:10000},b:{x:0,y:10000}},{id:'W',a:{x:0,y:10000},b:{x:0,y:0}},{id:'P',a:{x:8000,y:0},b:{x:8000,y:6000}}];
 assert.deepEqual(exteriorWalls(box).map(w=>w.id).sort(),['E','N','S','W']);
 const [r]=windOnWalls(box,{qH:1500,height:10,directions:[90]});assert.ok(!r.faces.some(f=>f.id==='P'));
});
