import {test} from 'node:test';
import assert from 'node:assert/strict';
import {
 buildX,buildXZ,buildK,buildV,buildRD,
 formatLevelNumber,buildELM,buildPLM,
 buildPPB,slopeOf,formatSlope,buildSL,
 outlineOfPolygons,closedPolygonPoints,
 dashRatioFor,entityPathPoints,pathLength,pointAtLength,explodeByPattern,
 installSymbolTools,
} from './symbol-tools.js';

const near=(a,b,eps=1e-6)=>Math.abs(a-b)<eps;
const p=(x,y)=>({x,y});

test('installSymbolTools 는 14개 명령을 모두 함수로 돌려준다',()=>{
 const ctx={num:()=>150};
 const cmds=installSymbolTools(ctx);
 for(const name of ['CMW','ELM','K','PLM','PPB','RD','SL','V','X','XZ','OOL','MTLT','LEX','LXP'])
  assert.equal(typeof cmds[name],'function',name+' 가 없습니다');
 assert.equal(Object.keys(cmds).length,14);
});

test('X: 두 대각선(사각형의 두 대각선)',()=>{
 const es=buildX(p(0,0),p(100,50));
 assert.equal(es.length,2);
 assert.deepEqual(es[0].points,[p(0,0),p(100,50)]);
 assert.deepEqual(es[1].points,[p(0,50),p(100,0)]);
});

test('XZ: 점1이 왼쪽이면 세로 변(좌우가 닫힘)',()=>{
 const es=buildXZ(p(0,0),p(100,50));
 assert.equal(es.length,4);
 // 첫 두 변은 세로선(x 값이 같은 두 점)
 assert.equal(es[0].points[0].x,es[0].points[1].x);
 assert.equal(es[1].points[0].x,es[1].points[1].x);
 assert.equal(es[0].points[0].x,0);
 assert.equal(es[1].points[0].x,100);
});

test('XZ: 점1이 오른쪽이면 가로 변(상하가 닫힘)',()=>{
 const es=buildXZ(p(100,0),p(0,50));
 assert.equal(es[0].points[0].y,es[0].points[1].y);
 assert.equal(es[1].points[0].y,es[1].points[1].y);
});

test('K: 꼭짓점은 점1의 x, 중간 높이 · 두 팔은 점2쪽 x 열의 위아래 모서리',()=>{
 const es=buildK(p(0,0),p(100,50));
 const vertex=es[0].points[0];
 assert.deepEqual(vertex,p(0,25));
 assert.deepEqual(es[0].points[1],p(100,50));
 assert.deepEqual(es[1].points[1],p(100,0));
});

test('V: 꼭짓점은 점1의 y, 중간 x · 두 팔은 점2쪽 y 열의 좌우 모서리',()=>{
 const es=buildV(p(0,0),p(100,50));
 const vertex=es[0].points[0];
 assert.deepEqual(vertex,p(50,0));
 assert.deepEqual(es[0].points[1],p(0,50));
 assert.deepEqual(es[1].points[1],p(100,50));
});

test('RD: 사각형 + 대각선 두 개, 지름만큼의 정사각형',()=>{
 const es=buildRD(p(1000,1000),200);
 assert.equal(es.length,3);
 assert.equal(es[0].type,'polyline');
 assert.equal(es[0].closed,true);
 const b=es[0].points;
 assert.ok(near(Math.abs(b[0].x-b[2].x),200));
 assert.ok(near(Math.abs(b[0].y-b[2].y),200));
});
test('RD: 지름이 0 이하면 오류',()=>{
 assert.throws(()=>buildRD(p(0,0),0));
});

test('formatLevelNumber: 콤마 없는 입력은 콤마 없이, 부호는 자동 +',()=>{
 assert.equal(formatLevelNumber('3500',0),'+3500');
});
test('formatLevelNumber: 콤마 있는 입력은 콤마 유지',()=>{
 assert.equal(formatLevelNumber('3,500',0),'+3,500');
});
test('formatLevelNumber: 소숫점자릿수 3 이면 1000 으로 나눠 m 단위처럼',()=>{
 assert.equal(formatLevelNumber('3500',3),'+3.500');
});
test('formatLevelNumber: 앞 공백과 음수 부호를 보존',()=>{
 assert.equal(formatLevelNumber(' -250',0),' -250');
});
test('formatLevelNumber: 숫자가 아니면 오류',()=>{
 assert.throws(()=>formatLevelNumber('abc',0));
});

test('buildELM: 쐐기(삼각형) + 문자, 문자는 접두사+표시숫자',()=>{
 const es=buildELM(p(0,0),'E.L','+3,500',150);
 assert.equal(es[0].type,'polyline');
 assert.equal(es[0].points.length,3);
 assert.equal(es[0].points[0],es[0].points[0]); // apex 존재
 assert.deepEqual(es[0].points[0],p(0,0));
 assert.equal(es[1].type,'text');
 assert.equal(es[1].text,'E.L +3,500');
 assert.equal(es[1].height,150);
});
test('buildELM: 문자높이가 0 이하면 오류',()=>{
 assert.throws(()=>buildELM(p(0,0),'E.L','+0',0));
});

test('buildPLM: 크로스헤어(원+십자) + 밑줄문자',()=>{
 const es=buildPLM(p(0,0),'F.L','+3,500',150);
 assert.equal(es[0].type,'circle');
 assert.equal(es[1].type,'line');
 assert.equal(es[2].type,'line');
 assert.equal(es[3].type,'text');
 assert.equal(es[3].text,'F.L +3,500');
 assert.equal(es[4].type,'line'); // 밑줄
});

test('buildPPB: 사각형(PHANTOM)+리더+원+2단 문자',()=>{
 const es=buildPPB(p(0,0),p(1000,600),'1','A-205',600,150);
 const rect=es.find(e=>e.type==='polyline');
 assert.equal(rect.linetype,'PHANTOM');
 const circle=es.find(e=>e.type==='circle');
 assert.equal(circle.radius,300);
 const texts=es.filter(e=>e.type==='text');
 assert.equal(texts.length,2);
 assert.equal(texts[0].text,'1');
 assert.equal(texts[1].text,'A-205');
});
test('buildPPB: 두 점이 같으면 오류',()=>{
 assert.throws(()=>buildPPB(p(0,0),p(0,0),'1','A-1',600,150));
});

test('slopeOf: 수평거리가 0이면 오류',()=>{
 assert.throws(()=>slopeOf(p(0,0),p(0,100)));
});
test('slopeOf/formatSlope: 예시(10, 6.48 → 64.8%)와 같은 비율 확인',()=>{
 const {run,rise}=slopeOf(p(0,0),p(10,6.48));
 assert.ok(near(run,10));
 assert.ok(near(rise,6.48));
 assert.equal(formatSlope(run,rise,'percent'),'64.8%');
});
test('formatSlope: 네 가지 표현방식이 같은 경사(0.2)를 다르게 표기',()=>{
 assert.equal(formatSlope(1,0.2,'percent'),'20.0%');
 assert.equal(formatSlope(1,0.2,'ratio1'),'1:0.20');
 assert.equal(formatSlope(1,0.2,'ratio10'),'10:2.00');
 assert.equal(formatSlope(1,0.2,'ratio1v'),'1:5.00');
});

test('buildSL: 삼각 기호 없이는 문자만(기본)',()=>{
 const es=buildSL(p(0,0),p(1000,200),{prefix:'SLOPE =',textHeight:150,format:'percent'});
 assert.equal(es.length,1);
 assert.equal(es[0].type,'text');
});
test('buildSL: 삼각 기호 켜면 삼각형이 추가되고, 문자표시 끄면 문자가 빠진다',()=>{
 const withTri=buildSL(p(0,0),p(1000,200),{textHeight:150,triangle:true,textOnSymbol:false,format:'percent'});
 assert.equal(withTri.length,1);
 assert.equal(withTri[0].type,'polyline');
 assert.deepEqual(withTri[0].points,[p(0,0),p(0,200),p(1000,200)]);
});
test('buildSL: 목구조(studs) 켜면 삼각형+3개 tick',()=>{
 const es=buildSL(p(0,0),p(1000,200),{textHeight:150,triangle:true,textOnSymbol:true,studs:true,format:'percent'});
 assert.equal(es.filter(e=>e.type==='line').length,3);
 assert.equal(es.filter(e=>e.type==='polyline').length,1);
 assert.equal(es.filter(e=>e.type==='text').length,1);
});

test('closedPolygonPoints: 사각형/닫힌폴리선/원, 열린폴리선은 null',()=>{
 assert.equal(closedPolygonPoints({type:'rectangle',points:[p(0,0),p(10,0),p(10,10),p(0,10)]}).length,4);
 assert.equal(closedPolygonPoints({type:'polyline',closed:true,points:[p(0,0),p(10,0),p(10,10)]}).length,3);
 assert.equal(closedPolygonPoints({type:'polyline',closed:false,points:[p(0,0),p(10,0)]}),null);
 assert.equal(closedPolygonPoints({type:'circle',center:p(0,0),radius:10},8).length,8);
});

test('outlineOfPolygons: 겹치는 두 정사각형의 외곽선 하나(면적으로 검증)',()=>{
 const a=[p(0,0),p(100,0),p(100,100),p(0,100)];
 const b=[p(50,50),p(150,50),p(150,150),p(50,150)];
 const loops=outlineOfPolygons([a,b]);
 assert.equal(loops.length,1);
 const area=Math.abs(shoelace(loops[0]));
 // 합집합 넓이 = 100*100 + 100*100 - 50*50(겹침) = 17500
 assert.ok(near(area,17500,1));
});
test('outlineOfPolygons: 겹치지 않는 두 도형은 각자의 외곽선 두 개',()=>{
 const a=[p(0,0),p(10,0),p(10,10),p(0,10)];
 const b=[p(100,100),p(110,100),p(110,110),p(100,110)];
 const loops=outlineOfPolygons([a,b]);
 assert.equal(loops.length,2);
});
test('outlineOfPolygons: 도형이 1개면 그대로 돌려준다',()=>{
 const a=[p(0,0),p(10,0),p(10,10),p(0,10)];
 const loops=outlineOfPolygons([a]);
 assert.equal(loops.length,1);
 assert.deepEqual(loops[0],a);
});
function shoelace(pts){let s=0;for(let i=0;i<pts.length;i++){const a=pts[i],b=pts[(i+1)%pts.length];s+=a.x*b.y-b.x*a.y;}return s/2;}

test('dashRatioFor: 실선은 null, 나머지 4종은 배열',()=>{
 assert.equal(dashRatioFor('CONTINUOUS'),null);
 assert.equal(dashRatioFor(undefined),null);
 assert.deepEqual(dashRatioFor('CENTER'),[12,4,2,4]);
 assert.deepEqual(dashRatioFor('PHANTOM2'),[12,3,2,3,2,3]);
 assert.deepEqual(dashRatioFor('DOT'),[1,4]);
 assert.deepEqual(dashRatioFor('HIDDEN'),[7,5]);
});

test('entityPathPoints/pathLength: 직선·사각형·원',()=>{
 const line={type:'line',points:[p(0,0),p(100,0)]};
 assert.equal(pathLength(entityPathPoints(line)),100);
 const rect={type:'rectangle',points:[p(0,0),p(10,0),p(10,10),p(0,10)]};
 assert.ok(near(pathLength(entityPathPoints(rect)),40));
 const circle={type:'circle',center:p(0,0),radius:10};
 assert.ok(near(pathLength(entityPathPoints(circle,360)),2*Math.PI*10,0.1));
});

test('pointAtLength: 직선 위 절반 지점',()=>{
 const pts=[p(0,0),p(100,0)];
 assert.deepEqual(pointAtLength(pts,50),p(50,0));
 assert.deepEqual(pointAtLength(pts,0),p(0,0));
 assert.deepEqual(pointAtLength(pts,1000),p(100,0));
});

test('explodeByPattern: CENTER 비율로 100mm 직선을 조각낸다(첫 조각은 dash)',()=>{
 const pts=[p(0,0),p(100,0)];
 const pieces=explodeByPattern(pts,[12,4,2,4]);
 assert.ok(pieces.length>=2);
 assert.deepEqual(pieces[0].points[0],p(0,0));
 assert.ok(near(pieces[0].points[1].x,12));
 // 총 길이를 넘지 않는다
 for(const piece of pieces)for(const pt of piece.points)assert.ok(pt.x<=100+1e-6);
});
test('explodeByPattern: 길이가 0이면 오류',()=>{
 assert.throws(()=>explodeByPattern([p(0,0),p(0,0)],[12,4]));
});
