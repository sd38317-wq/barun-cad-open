// draw-cards-3.js 시험. DOM 없이 도는 순수 함수(치수 계산·기하·정규화)만 확인한다.
// 좌표는 숫자로 직접 비교한다(원문 그림에서 읽어낸 값 그대로).
import test from 'node:test';
import assert from 'node:assert/strict';
import {
 DRAW3_LAYERS,
 stbSizes,stbMark,stbJoint,stbGeometry,stbSummary,
 farthestFrom,secondHinge,rotationSign,doorRotationResult,
 isRound,textSegment,entitySegments,longestSegment,midMark,crossMark,centerlineOfTwo,bestSegmentPair,pairDistance,parallelPairs,cenGeometry,
 pathOf,resamplePath,alignPath,blendPaths,polygonCentroid,cepRatios,cepGeometry,
 elevatorSizes,elevatorMark,elevatorGeometry,
} from './draw-cards-3.js';

const P=(x,y)=>({x,y});
const near=(a,b,eps=1e-6)=>assert.ok(Math.abs(a-b)<=eps,`${a} ≈ ${b} 이 아님`);
const nearPt=(p,x,y,eps=1e-6)=>{near(p.x,x,eps);near(p.y,y,eps);};
const line=(x1,y1,x2,y2,extra={})=>({id:`l${x1}_${y1}_${x2}_${y2}`,type:'line',points:[P(x1,y1),P(x2,y2)],...extra});

/* ════════ STB ════════ */
const STB={shape:'symbol',gap:1,beamWidth:400,webLinetype:'HIDDEN',webThick:6,markPrefix:'sg',markNumber:'1',
 upper:true,headJoint:'rigid',tailJoint:'rigid',headSize:4,lineWidth:1,textHeight:3,lineScale:100,recycle:false};

test('STB · 대화상자의 "× 선축척" 값은 선축척을 곱해 mm 가 된다', () => {
 const s=stbSizes(STB);
 assert.deepEqual([s.gap,s.head,s.lineWidth,s.textHeight],[100,400,100,300]);
 assert.equal(s.beamWidth,400);   // 철골보폭·웨브두께는 원문에서 mm 그대로다
 assert.equal(s.webThick,6);
 const s2=stbSizes({...STB,lineScale:50});
 assert.deepEqual([s2.gap,s2.head,s2.lineWidth,s2.textHeight],[50,200,50,150]);
 assert.throws(()=>stbSizes({...STB,lineScale:0}),/선축척/);
 assert.throws(()=>stbSizes({...STB,shape:'plan',webThick:400}),/웨브두께/);
});

test('STB · [대문자] 체크는 부호를 대문자로 바꾼다', () => {
 assert.equal(stbMark(STB),'SG1');
 assert.equal(stbMark({...STB,upper:false}),'sg1');
 assert.equal(stbMark({...STB,markPrefix:' G ',markNumber:' 12 '}),'G12');
});

test('STB · 구조기호: 두꺼운 한 선 + 강접합 삼각형 + 부호 문자 좌표', () => {
 const r=stbGeometry(STB,{},P(0,0),P(6000,0));
 near(r.length,6000);
 const body=r.entities.find(e=>e.type==='polyline'&&e.constantWidth);
 assert.equal(body.constantWidth,100);                 // 선 두께 1 × 선축척
 nearPt(body.points[0],0,0);nearPt(body.points[1],6000,0);
 assert.equal(body.cardLayer,DRAW3_LAYERS.beam);       // 기호켜 = A-BEAM

 // 머리 강접합 = 밑변(보에 직각) 400, 보 방향 길이 400/3 인 속 채운 삼각형
 const tri=r.entities.filter(e=>e.type==='polyline'&&e.closed);
 assert.equal(tri.length,2);                            // 머리·꼬리
 nearPt(tri[0].points[0],0,200);nearPt(tri[0].points[1],0,-200);nearPt(tri[0].points[2],400/3,0);
 nearPt(tri[1].points[0],6000,200);nearPt(tri[1].points[1],6000,-200);nearPt(tri[1].points[2],6000-400/3,0);
 assert.equal(r.entities.filter(e=>e.type==='hatch'&&e.solid).length,2);

 const txt=r.entities.find(e=>e.type==='text');
 assert.equal(txt.text,'SG1');
 assert.equal(txt.height,300);                          // 문자크기 3 × 선축척
 nearPt(txt.position,3000,150);                         // 이격거리 100 + 선 두께의 절반 50
 assert.equal(txt.cardLayer,DRAW3_LAYERS.text);
});

test('STB · 핀접합은 보에 직각인 짧은 선 하나다', () => {
 const es=stbJoint('pin',P(0,0),P(1,0),P(0,1),400,'A-BEAM');
 assert.equal(es.length,1);
 assert.equal(es[0].type,'line');
 nearPt(es[0].points[0],0,200);nearPt(es[0].points[1],0,-200);
 const r=stbGeometry({...STB,headJoint:'pin',tailJoint:'pin'},{},P(0,0),P(6000,0));
 assert.equal(r.entities.filter(e=>e.type==='hatch').length,0);
});

test('STB · 평면: 철골보폭 직사각형 + 웨브선(0 이면 한 선, 숫자면 두 선)', () => {
 const r=stbGeometry({...STB,shape:'plan'},{},P(0,0),P(6000,0));
 const box=r.entities.find(e=>e.type==='polyline'&&e.closed);
 nearPt(box.points[0],0,200);nearPt(box.points[1],6000,200);
 nearPt(box.points[2],6000,-200);nearPt(box.points[3],0,-200);
 const webs=r.entities.filter(e=>e.type==='line');
 assert.equal(webs.length,2);
 assert.equal(webs[0].linetype,'HIDDEN');
 near(webs[0].points[0].y,3);near(webs[1].points[0].y,-3);
 const one=stbGeometry({...STB,shape:'plan',webThick:0},{},P(0,0),P(6000,0)).entities.filter(e=>e.type==='line');
 assert.equal(one.length,1);
 near(one[0].points[0].y,0);
 assert.equal(stbGeometry({...STB,shape:'plan'},{},P(0,0),P(6000,0)).entities.some(e=>e.type==='text'),false);
 assert.match(stbSummary({...STB,shape:'plan'}),/평면/);
 assert.throws(()=>stbGeometry(STB,{},P(0,0),P(0,0)),/서로 다른 점/);
});

test('STB · 비스듬한 보도 보 축을 따라 그려진다(45도)', () => {
 const r=stbGeometry(STB,{},P(0,0),P(1000,1000));
 near(r.angle,45);
 const tri=r.entities.find(e=>e.type==='polyline'&&e.closed);
 const d=Math.hypot(tri.points[0].x-tri.points[1].x,tri.points[0].y-tri.points[1].y);
 near(d,400);   // 밑변 길이는 회전해도 머리크기 그대로
});

/* ════════ DOR ════════ */
const DOOR=[line(0,0,900,0),line(0,0,0,40),line(900,0,900,40),line(0,40,900,40)];
const DOR={angle:30,doubleDoor:false,arcLinetype:'CONTINUOUS',recycle:true};

test('DOR · 힌지에서 가장 먼 점이 궤적 호의 반지름이 된다', () => {
 const f=farthestFrom(DOOR,P(0,0));
 near(f.distance,Math.hypot(900,40));
 nearPt(f.point,900,40);
 assert.throws(()=>farthestFrom([],P(0,0)),/점을 찾을 수 없/);
});

test('DOR · 회전 방향 지정: 찍은 점이 문짝 아래면 시계방향(−)', () => {
 assert.equal(rotationSign([line(0,0,900,0)],P(0,0),P(450,-500)),-1);
 assert.equal(rotationSign([line(0,0,900,0)],P(0,0),P(450,500)),1);
});

test('DOR · 홑문 30도: 사본 좌표와 궤적 호가 숫자로 맞는다', () => {
 const out=doorRotationResult(DOR,{},[[line(0,0,900,0)]],[P(0,0)],-1);
 const leaf=out.find(e=>e.type==='line');
 nearPt(leaf.points[0],0,0,1e-9);
 nearPt(leaf.points[1],900*Math.cos(-Math.PI/6),900*Math.sin(-Math.PI/6),1e-6);
 assert.equal(leaf.cardLayer,DRAW3_LAYERS.door);
 assert.equal(leaf.id,undefined);
 const arc=out.find(e=>e.type==='arc');
 near(arc.radius,900);
 near(arc.startAngle,330);near(arc.endAngle,0);   // 시계방향이라 330 → 360(0)
 assert.equal(arc.linetype,'CONTINUOUS');
 const ccw=doorRotationResult(DOR,{},[[line(0,0,900,0)]],[P(0,0)],1).find(e=>e.type==='arc');
 near(ccw.startAngle,0);near(ccw.endAngle,30);
});

test('DOR · 양개문: 둘째 문 힌지는 첫째 힌지에서 가장 먼 제 끝점이고 반대로 돈다', () => {
 const right=[line(1100,0,2000,0)],left=[line(0,0,900,0)];
 nearPt(secondHinge(left,P(2000,0)),0,0);
 const out=doorRotationResult({...DOR,doubleDoor:true},{},[right,left],[P(2000,0),P(0,0)],-1);
 const arcs=out.filter(e=>e.type==='arc');
 assert.equal(arcs.length,2);
 near(arcs[0].startAngle,150);near(arcs[0].endAngle,180);   // 오른쪽 문: 180 → 150 (시계)
 near(arcs[1].startAngle,0);near(arcs[1].endAngle,30);      // 왼쪽 문: 0 → 30 (반시계)
 assert.throws(()=>doorRotationResult({...DOR,angle:0},{},[left],[P(0,0)],1),/기본 각도/);
});

test('DOR · 궤적선 켜와 선종류는 설정대로 따로 붙는다', () => {
 const out=doorRotationResult({...DOR,arcLinetype:'DASHED'},{},[[line(0,0,900,0)]],[P(0,0)],1,
 );
 const arc=out.find(e=>e.type==='arc'),leaf=out.find(e=>e.type==='line');
 assert.equal(arc.linetype,'DASHED');
 const named=doorRotationResult(DOR,{doorLayer:'A-DOOR',arcLayer:'A-SYM'},[[line(0,0,900,0)]],[P(0,0)],1);
 assert.equal(named.find(e=>e.type==='arc').cardLayer,'A-SYM');
 assert.equal(named.find(e=>e.type==='line').cardLayer,'A-DOOR');
 assert.equal(leaf.cardLayer,'A-DOOR');
});

/* ════════ CEN ════════ */
const CEN={asPolyline:false,extend:15,lineScale:100,maxPair:250,multi:false};   // 연장 = 1500

test('CEN · 선 하나는 중점에서 직각인 중심선이 된다', () => {
 const s=midMark([P(0,0),P(1000,0)],200);
 nearPt(s[0],500,200);nearPt(s[1],500,-200);
 const v=midMark([P(0,0),P(0,1000)],100);
 nearPt(v[0],-100,500);nearPt(v[1],100,500);
});

test('CEN · 호·원은 중심에 축에 나란한 십자(반지름 + 연장길이)', () => {
 const [h,v]=crossMark(P(100,50),500,100);
 nearPt(h[0],-500,50);nearPt(h[1],700,50);
 nearPt(v[0],100,-550);nearPt(v[1],100,650);
 assert.equal(isRound({type:'circle',center:P(0,0),radius:5}),true);
 assert.equal(isRound({type:'line',points:[P(0,0),P(1,0)]}),false);
});

test('CEN · 평행한 두 선 사이 중심선: 가운데를 지나고 양끝으로 연장길이만큼 더 나간다', () => {
 const s=centerlineOfTwo([P(0,0),P(1000,0)],[P(0,200),P(1000,200)],100);
 nearPt(s[0],-100,100);nearPt(s[1],1100,100);
});

test('CEN · 각도가 다른 두 선은 교점을 지나는 이등분선이 된다', () => {
 // y=0 위의 선과 원점에서 90도로 올라가는 선 → 45도 이등분선
 const s=centerlineOfTwo([P(0,0),P(1000,0)],[P(0,0),P(0,1000)],0);
 const u={x:s[1].x-s[0].x,y:s[1].y-s[0].y};
 near(Math.atan2(u.y,u.x)*180/Math.PI,45,1e-6);
 // 이등분선은 교점(0,0)을 지난다
 near(u.x*s[0].y-u.y*s[0].x,0,1e-6);
});

test('CEN · 여러선 동시 입력(M): 최대 인식 거리 안의 평행 쌍만 짝지어진다', () => {
 const segs=[[P(0,0),P(1000,0)],[P(0,200),P(1000,200)],[P(0,3000),P(1000,3000)],[P(0,3200),P(1000,3200)]];
 assert.equal(pairDistance(segs[0],segs[1]),200);
 assert.equal(pairDistance(segs[0],segs[2]),3000);
 assert.equal(pairDistance([P(0,0),P(1000,0)],[P(0,0),P(0,1000)]),null);          // 평행이 아님
 assert.equal(pairDistance([P(0,0),P(100,0)],[P(5000,50),P(6000,50)]),null);      // 겹치지 않음
 const pairs=parallelPairs(segs,250);
 assert.equal(pairs.length,2);
 near(pairs[0][0][0].y,0);near(pairs[1][0][0].y,3000);
 assert.equal(parallelPairs(segs,100).length,0);
});

test('CEN · cenGeometry: 벽선 두 줄 → CENTER 선종류의 중심선 하나', () => {
 const es=cenGeometry(CEN,{},[line(0,0,5000,0),line(0,200,5000,200)]);
 assert.equal(es.length,1);
 assert.equal(es[0].type,'line');
 assert.equal(es[0].linetype,'CENTER');
 assert.equal(es[0].cardLayer,DRAW3_LAYERS.wallCntr);
 nearPt(es[0].points[0],-1500,100);nearPt(es[0].points[1],6500,100);
 const poly=cenGeometry({...CEN,asPolyline:true},{},[line(0,0,5000,0),line(0,200,5000,200)]);
 assert.equal(poly[0].type,'polyline');
 assert.equal(cenGeometry(CEN,{},[{type:'circle',center:P(0,0),radius:500}]).length,2);   // 십자 두 줄
 assert.throws(()=>cenGeometry(CEN,{},[]),/객체를 고르/);
 assert.throws(()=>cenGeometry({...CEN,multi:true},{},[line(0,0,1000,0),line(0,3000,1000,3000)]),/최대 인식 거리/);
});

test('CEN · 폴리선·사각형은 마주 보는 구간끼리 짝지어지고, 문자는 대표 선분으로 바뀐다', () => {
 const rect={id:'r',type:'rectangle',points:[P(0,0),P(1000,0),P(1000,200),P(0,200)]};
 assert.equal(entitySegments(rect).length,4);
 const [a,b]=bestSegmentPair(entitySegments(rect),entitySegments(line(0,600,1000,600)));
 near(a[0].y,200);near(b[0].y,600);            // 사각형의 윗변이 골라진다
 const seg=textSegment({type:'text',position:P(0,0),text:'ABCD',height:100,rotation:0,align:'left'});
 nearPt(seg[0],0,0);near(seg[1].x,4*100*0.65);
 const mid=textSegment({type:'text',position:P(0,0),text:'ABCD',height:100,rotation:0,align:'center'});
 near(mid[0].x,-130);near(mid[1].x,130);
 near(longestSegment(entitySegments(rect))[1].x,1000);
});

/* ════════ CEP ════════ */
const CEP={mode:'center',extend:5,divide:5,nodes:100,lineScale:100,asPolyline:false,recycle:false};
const openA={id:'a',type:'polyline',closed:false,points:[P(0,0),P(1000,0),P(2000,0)]};
const openB={id:'b',type:'polyline',closed:false,points:[P(0,1000),P(1000,1000),P(2000,1000)]};

test('CEP · 길이로 다시 나누기(resamplePath): 열린 선과 닫힌 선', () => {
 const r=resamplePath([P(0,0),P(1000,0)],false,3);
 assert.equal(r.length,3);
 nearPt(r[0],0,0);nearPt(r[1],500,0);nearPt(r[2],1000,0);
 const sq=resamplePath([P(0,0),P(100,0),P(100,100),P(0,100)],true,4);
 assert.equal(sq.length,4);
 nearPt(sq[1],100,0);nearPt(sq[2],100,100);
 assert.throws(()=>resamplePath([P(0,0),P(0,0)],false,3),/길이가 0/);
});

test('CEP · 거꾸로 그려진 둘째 폴리선은 뒤집어 맞춘다', () => {
 const a=[P(0,0),P(100,0)],b=[P(100,10),P(0,10)];
 const aligned=alignPath(a,b);
 nearPt(aligned[0],0,10);nearPt(aligned[1],100,10);
 nearPt(blendPaths(a,aligned,.5)[1],100,5);
});

test('CEP · 중심선 생성: 두 열린 폴리선 사이 50% 선 하나, 정점 수는 많은 쪽', () => {
 const es=cepGeometry(CEP,{},[openA,openB]);
 assert.equal(es.length,1);
 assert.equal(es[0].type,'polyline');
 assert.equal(es[0].linetype,'CENTER');
 assert.equal(es[0].cardLayer,DRAW3_LAYERS.cntr);
 assert.equal(es[0].points.length,3);
 nearPt(es[0].points[0],0,500);nearPt(es[0].points[1],1000,500);nearPt(es[0].points[2],2000,500);
});

test('CEP · 임의 등분·등고선: 나눔과 정점 수가 각각 걸린다', () => {
 assert.deepEqual(cepRatios('center',5),[0.5]);
 assert.deepEqual(cepRatios('contour2',5),[0.5]);
 assert.deepEqual(cepRatios('contourDiv',5),[0.2,0.4,0.6,0.8]);
 const div=cepGeometry({...CEP,mode:'contourDiv',divide:5,nodes:11},{},[openA,openB]);
 assert.equal(div.length,4);
 assert.equal(div[0].points.length,11);
 assert.equal(div[0].linetype,'CONTINUOUS');
 near(div[0].points[0].y,200);near(div[3].points[0].y,800);
 const two=cepGeometry({...CEP,mode:'contour2',nodes:7},{},[openA,openB]);
 assert.equal(two.length,1);
 assert.equal(two[0].points.length,7);
 near(two[0].points[0].y,500);
});

test('CEP · 닫힌 폴리선 하나는 무게중심에 십자(돌출 = 연장길이 × 선축척)', () => {
 nearPt(polygonCentroid([P(0,0),P(200,0),P(200,100),P(0,100)]),100,50);
 nearPt(polygonCentroid([P(0,0),P(100,0)]),50,0);          // 면적 0 이면 정점 평균
 const closed={id:'c',type:'polyline',closed:true,points:[P(0,0),P(200,0),P(200,100),P(0,100)]};
 const es=cepGeometry(CEP,{},[closed]);                    // 연장 5 × 100 = 500
 assert.equal(es.length,2);
 nearPt(es[0].points[0],-500,50);nearPt(es[0].points[1],700,50);
 nearPt(es[1].points[0],100,-500);nearPt(es[1].points[1],100,600);
 assert.throws(()=>cepGeometry(CEP,{},[openA]),/열린 폴리선은 두 개/);
 assert.throws(()=>cepGeometry(CEP,{},[closed,openB]),/열린 폴리선 두 개/);
 assert.throws(()=>pathOf({type:'circle',center:P(0,0),radius:1}),/선·폴리선·사각형/);
});

/* ════════ ELV (추정) ════════ */
const ELV={shaftWidth:2200,shaftDepth:2200,carWidth:1600,carDepth:1500,doorWidth:900,
 leafThickness:50,mark:'EV1',textHeight:200,count:1};

test('ELV · 크기 검사: 카는 승강로보다, 출입문은 카보다 작아야 한다', () => {
 const s=elevatorSizes(ELV);
 assert.deepEqual([s.W,s.D,s.cw,s.cd,s.dw,s.count],[2200,2200,1600,1500,900,1]);
 assert.throws(()=>elevatorSizes({...ELV,carWidth:2400}),/카 폭/);
 assert.throws(()=>elevatorSizes({...ELV,carDepth:2400}),/카 깊이/);
 assert.throws(()=>elevatorSizes({...ELV,doorWidth:1800}),/출입문 폭/);
 assert.throws(()=>elevatorSizes({...ELV,shaftWidth:0}),/승강로/);
});

test('ELV · 번호는 대수가 2 이상일 때만 끝 숫자를 올린다', () => {
 assert.equal(elevatorMark(ELV,0),'EV1');
 assert.equal(elevatorMark({...ELV,count:3},0),'EV1');
 assert.equal(elevatorMark({...ELV,count:3},2),'EV3');
 assert.equal(elevatorMark({...ELV,count:2,mark:'EV'},1),'EV2');
});

test('ELV · 평면 좌표: 승강로 외곽·출입구 벌어짐·카·번호 위치', () => {
 const r=elevatorGeometry(ELV,{},P(0,0),0);
 near(r.width,2200);near(r.depth,2200);
 const lines=r.entities.filter(e=>e.type==='line');
 const at=(p,x,y)=>Math.abs(p.x-x)<1e-6&&Math.abs(p.y-y)<1e-6;
 nearPt(lines[0].points[0],0,0);nearPt(lines[0].points[1],0,2200);         // 왼쪽 벽
 const front=lines.filter(e=>Math.abs(e.points[0].y)<1e-6&&Math.abs(e.points[1].y)<1e-6);
 assert.equal(front.length,2);                                              // 앞면은 출입구만큼 벌어진 두 도막
 nearPt(front[0].points[1],650,0);                                          // (2200−900)/2
 nearPt(front[1].points[0],1550,0);
 const car=lines.find(e=>at(e.points[0],300,350)&&at(e.points[1],300,1850));
 assert.ok(car,'카 왼쪽 선이 있어야 한다');                                  // 카 1600×1500 가운데
 const leaves=r.entities.filter(e=>e.type==='polyline'&&e.cardLayer===DRAW3_LAYERS.door);
 assert.equal(leaves.length,2);
 nearPt(leaves[0].points[0],650,0);nearPt(leaves[0].points[1],1100,0);      // 문짝 폭 450 씩
 const txt=r.entities.find(e=>e.type==='text');
 assert.equal(txt.text,'EV1');
 nearPt(txt.position,1100,1100);
 assert.equal(txt.cardLayer,DRAW3_LAYERS.text);
});

test('ELV · 대수 2 는 옆으로 이어 붙고, 회전각을 주면 그대로 돌아간다', () => {
 const two=elevatorGeometry({...ELV,count:2},{},P(0,0),0);
 near(two.width,4400);
 assert.equal(two.entities.filter(e=>e.type==='text').length,2);
 nearPt(two.entities.filter(e=>e.type==='text')[1].position,3300,1100);
 const rot=elevatorGeometry(ELV,{},P(0,0),90);
 const left=rot.entities.find(e=>e.type==='line');
 nearPt(left.points[0],0,0,1e-9);
 nearPt(left.points[1],-2200,0,1e-9);                                       // 90도 돌면 +y 가 −x 로
 const moved=elevatorGeometry(ELV,{x:1000,y:2000},P(1000,2000),0);
 nearPt(moved.entities.find(e=>e.type==='text').position,2100,3100);
});
