// escalator-card.js 의 순수 계산 시험. DOM 없이 돈다. node --test escalator-card.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeValues} from './card-kit.js';
import {
 ESC,FEATHER_LINES,ESC_LAYER,SITE_LAYER,
 escalatorLength,escalatorRuns,elevationRun,buildEscalatorElevation,buildEscalatorPlan,
 pathPoints,pathLength,pointAlong,nearestAlong,rayHit,slopeStation,slopeStations,
 buildPlannedSlope,buildNaturalSlope,naturalMark,slopeMarkAt,buildSlopePattern,
 EED_FIELDS,EPD_FIELDS,SLP_FIELDS,ESC_SHARED_FIELDS,SLP_SHARED_FIELDS,
} from './escalator-card.js';

const near=(a,b,eps=1e-6)=>assert.ok(Math.abs(a-b)<eps,`${a} ≈ ${b} 아님`);
const nearPt=(p,x,y,eps=1e-6)=>{near(p.x,x,eps);near(p.y,y,eps);};

/* ── 1. 폭 계산 (원문 EED 대화상자 값 재현) ── */
test('EED 폭계산: 층고 4500 · 30도 = 12350.0 (원문 대화상자 값)',()=>{
 assert.equal(escalatorLength(4500,30).toFixed(1),'12350.0');
});
test('EED 폭계산: 35도는 층고÷tan35 + 상·하부 수평부',()=>{
 near(escalatorLength(4500,35),4500/Math.tan(35*Math.PI/180)+ESC.LEAD,1e-9);
 near(escalatorLength(4500,35),10982.44,0.01);
});
test('경사각이 0 또는 90이면 거절한다',()=>{
 assert.throws(()=>escalatorLength(4500,0),/경사각/);
 assert.throws(()=>escalatorLength(4500,90),/경사각/);
});
test('층고 0 이면 상·하부 수평부만 남는다',()=>{near(escalatorLength(0,30),ESC.LEAD);});

/* ── 2. 층수·종류별 W.P. 배치 ── */
test('되돌림형: 층마다 수평 방향이 뒤집힌다',()=>{
 const r=escalatorRuns({x:0,y:0},{x:12000,y:4500},'return',3);
 assert.equal(r.length,3);
 nearPt(r[0][0],0,0);nearPt(r[0][1],12000,4500);
 nearPt(r[1][0],12000,4500);nearPt(r[1][1],0,9000);
 nearPt(r[2][0],0,9000);nearPt(r[2][1],12000,13500);
});
test('연속형: 같은 방향으로 이어 붙는다',()=>{
 const r=escalatorRuns({x:0,y:0},{x:12000,y:4500},'inline',3);
 assert.equal(r.length,3);
 nearPt(r[1][0],12000,4500);nearPt(r[1][1],24000,9000);
 nearPt(r[2][1],36000,13500);
});
test('교차형: 층마다 두 대가 X 로 엇갈린다',()=>{
 const r=escalatorRuns({x:0,y:0},{x:12000,y:4500},'cross',2);
 assert.equal(r.length,4);
 nearPt(r[0][0],0,0);nearPt(r[0][1],12000,4500);
 nearPt(r[1][0],12000,0);nearPt(r[1][1],0,4500);
 nearPt(r[2][0],0,4500);nearPt(r[2][1],12000,9000);
 nearPt(r[3][0],12000,4500);nearPt(r[3][1],0,9000);
});
test('층수는 최소 1 로 맞춘다',()=>{assert.equal(escalatorRuns({x:0,y:0},{x:12000,y:4500},'inline',0).length,1);});

/* ── 3. EED 입면 한 대의 좌표 ── */
test('입면: 트러스 바닥선이 W.P. 에서 내려와 수평부·경사부를 지난다',()=>{
 const [truss,rail]=elevationRun({x:0,y:0},{x:20000,y:4500});
 assert.equal(truss.type,'polyline');
 assert.equal(truss.points.length,6);
 nearPt(truss.points[0],0,0);
 nearPt(truss.points[1],0,-ESC.TRUSS);
 nearPt(truss.points[2],ESC.FLAT,-ESC.TRUSS);
 nearPt(truss.points[3],20000-ESC.FLAT,4500-ESC.TRUSS);
 nearPt(truss.points[4],20000,4500-ESC.TRUSS);
 nearPt(truss.points[5],20000,4500);
 // 경사부 기울기 = 두 W.P. 사이 수평거리에서 수평부를 뺀 값으로 정해진다
 near((truss.points[3].y-truss.points[2].y)/(truss.points[3].x-truss.points[2].x),4500/(20000-ESC.LEAD),1e-9);
 assert.equal(rail.points.length,26);
 nearPt(rail.points[0],ESC.RAIL_START+ESC.RAIL_STUB,ESC.RAIL_RETURN);
 nearPt(rail.points[1],ESC.RAIL_START,ESC.RAIL_RETURN);
 nearPt(rail.points[6],ESC.RAIL_START-(ESC.RAIL-ESC.RAIL_RETURN)/2,(ESC.RAIL+ESC.RAIL_RETURN)/2,1e-9);
 nearPt(rail.points[11],ESC.RAIL_START,ESC.RAIL);
 nearPt(rail.points[12],ESC.FLAT,ESC.RAIL);
 nearPt(rail.points[13],20000-ESC.FLAT,4500+ESC.RAIL);
 nearPt(rail.points[25],20000-ESC.RAIL_START-ESC.RAIL_STUB,4500+ESC.RAIL_RETURN);
});
test('입면: 왼쪽으로 가는 대는 좌우가 뒤집힌다',()=>{
 const [truss]=elevationRun({x:20000,y:0},{x:0,y:4500});
 nearPt(truss.points[1],20000,-ESC.TRUSS);
 nearPt(truss.points[2],20000-ESC.FLAT,-ESC.TRUSS);
 nearPt(truss.points[5],0,4500);
});
test('입면: 수평거리가 상·하부 수평부보다 짧으면 거절한다',()=>{
 assert.throws(()=>elevationRun({x:0,y:0},{x:3000,y:4500}),/수평부/);
});
test('입면: 대마다 선 두 개, 켜는 A-ELEV',()=>{
 const r=buildEscalatorElevation({x:0,y:0},{x:20000,y:4500},{kind:'cross',floors:2},{});
 assert.equal(r.runs,4);
 assert.equal(r.entities.length,8);
 assert.ok(r.entities.every(e=>e.cardLayer===ESC_LAYER));
});

/* ── 4. EPD 평면 좌표 ── */
test('평면: 외곽·난간·중심선·수평부 경계·디딤판',()=>{
 const v={height:4500,angle:'30',width:'1200',result:'none'};
 const r=buildEscalatorPlan({x:0,y:0},{x:1,y:0},v,{});
 near(r.length,12350,0.01);
 assert.equal(r.steps,19);           // 경사부 7794.23 ÷ 400
 assert.equal(r.entities.length,27); // 외곽1 + 난간·스텝선4 + 중심선1 + 수평부경계2 + 디딤판19
 const rect=r.entities[0];
 assert.equal(rect.type,'polyline');assert.equal(rect.closed,true);
 nearPt(rect.points[0],0,-775);       // 600 + 175
 nearPt(rect.points[2],r.length,775);
 const center=r.entities.find(e=>e.linetype==='CENTER');
 nearPt(center.points[0],0,0);nearPt(center.points[1],r.length,0);
 const first=r.entities.find(e=>e.type==='line'&&Math.abs(e.points[0].x-ESC.FLAT)<1e-6&&Math.abs(e.points[0].y+600)<1e-6);
 assert.ok(first,'하부 수평부 경계선이 있어야 한다');
});
test('평면: 너비 800 이면 외곽이 좁아지고 길이는 그대로',()=>{
 const r=buildEscalatorPlan({x:0,y:0},{x:1,y:0},{height:4500,angle:'30',width:'800'},{});
 nearPt(r.entities[0].points[0],0,-575);
 near(r.length,12350,0.01);
});
test('평면: 방향이 +y 면 길이 축이 세로가 된다',()=>{
 const r=buildEscalatorPlan({x:100,y:200},{x:100,y:999},{height:4500,angle:'30',width:'1200'},{});
 nearPt(r.entities[0].points[0],100+775,200,1e-6); // n = normal(+y) = (-1,0) → -hw 쪽이 +x
 nearPt(r.entities[0].points[1],100+775,200+r.length,1e-6);
});
test('평면: 둘째 점이 시작점과 같으면 거절한다',()=>{
 assert.throws(()=>buildEscalatorPlan({x:0,y:0},{x:0,y:0},{height:4500,angle:'30',width:'1200'},{}),/방향/);
});

/* ── 5. 경로 도구 ── */
test('pathPoints: 선·폴리선·닫힌 폴리선·사각형',()=>{
 assert.equal(pathPoints({type:'line',points:[{x:0,y:0},{x:10,y:0}]}).length,2);
 assert.equal(pathPoints({type:'polyline',points:[{x:0,y:0},{x:10,y:0},{x:10,y:10}]}).length,3);
 assert.equal(pathPoints({type:'polyline',closed:true,points:[{x:0,y:0},{x:10,y:0},{x:10,y:10}]}).length,4);
 assert.equal(pathPoints({type:'rectangle',points:[{x:0,y:0},{x:10,y:0},{x:10,y:10},{x:0,y:10}]}).length,5);
 assert.throws(()=>pathPoints({type:'circle',center:{x:0,y:0},radius:5}),/선·폴리선/);
});
test('pathLength · pointAlong · nearestAlong',()=>{
 const p=[{x:0,y:0},{x:100,y:0},{x:100,y:100}];
 near(pathLength(p),200);
 const a=pointAlong(p,150);nearPt(a.point,100,50);nearPt(a.dir,0,1);
 near(nearestAlong(p,{x:60,y:40}),60);
 near(nearestAlong(p,{x:130,y:80}),180);
});
test('rayHit: 반직선이 처음 만나는 곳',()=>{
 const low=[{x:0,y:-300},{x:1000,y:-300}];
 assert.equal(rayHit(low,{x:500,y:0},{x:0,y:1}),null);
 const h=rayHit(low,{x:500,y:0},{x:0,y:-1});
 near(h.t,300);nearPt(h.point,500,-300);
});

/* ── 6. SLP 계획사면 ── */
const HIGH=[{x:0,y:0},{x:10000,y:0}],LOW=[{x:0,y:-3000},{x:10000,y:-3000}];
test('slopeStation: 높은 쪽 선에 직각으로 낮은 쪽 선까지',()=>{
 const s=slopeStation(HIGH,LOW,5000);
 nearPt(s.high,5000,0);nearPt(s.low,5000,-3000);near(s.length,3000);nearPt(s.dir,0,-1);
});
test('slopeStations: 주표시 간격 + 끝점',()=>{
 assert.deepEqual(slopeStations(HIGH,5000),[0,5000,10000]);
 assert.deepEqual(slopeStations(HIGH,4000),[0,4000,8000,10000]);
});
test('계획사면: 긴 선 3 + 짧은 선 8, 짧은 선은 낮은 쪽에 붙고 길이 비율 0.4',()=>{
 const v={kind:'planned',mainSpacing:5000,subDivide:5,planRatio:0.4};
 const es=buildPlannedSlope(HIGH,LOW,v);
 assert.equal(es.length,11);
 const long=es.filter(e=>Math.abs(e.points[0].y-e.points[1].y)>2000);
 assert.equal(long.length,3);
 const short=es.filter(e=>Math.abs(e.points[0].y-e.points[1].y)<2000);
 assert.equal(short.length,8);
 nearPt(short[0].points[0],1000,-3000);   // 5000 ÷ 5 = 1000 마다
 nearPt(short[0].points[1],1000,-1800);   // 3000 × 0.4 = 1200 만큼 올라온다
 assert.ok(es.every(e=>e.cardLayer===SITE_LAYER));
});
test('계획사면: 보조 나누기 1 이면 짧은 선이 없다',()=>{
 const es=buildPlannedSlope(HIGH,LOW,{kind:'planned',mainSpacing:5000,subDivide:1,planRatio:0.4});
 assert.equal(es.length,3);
});
test('계획사면: 직각 기준은 먼저 고른(높은 쪽) 선이다',()=>{
 const slanted=[{x:0,y:0},{x:3000,y:4000}];      // 방향 (0.6,0.8)
 const low=[{x:8000,y:-6000},{x:8000,y:6000}];    // 세로선
 const s=slopeStation(slanted,low,2500);
 nearPt(s.high,1500,2000);
 nearPt(s.dir,0.8,-0.6);                          // 높은 쪽 선에 직각
 nearPt(s.low,8000,-2875);
});

/* ── 7. SLP 자연사면 ── */
test('자연사면: 직선부 = (1 - 길이비율) × 전체, 깃은 8 단',()=>{
 const st=slopeStation(HIGH,LOW,5000);
 const es=naturalMark(st,{natRatio:0.3,oneLine:false});
 assert.equal(es.length,1+FEATHER_LINES);
 nearPt(es[0].points[0],5000,0);
 nearPt(es[0].points[1],5000,-2100);              // 3000 × 0.7
 const last=es.at(-1);                            // 밑변은 낮은 쪽 선 위
 near(last.points[0].y,-3000);near(last.points[1].y,-3000);
 near(Math.abs(last.points[1].x-last.points[0].x),2*900*0.75); // 깃 높이 900 × 0.75 × 2
});
test('자연사면: [한 선으로 그리기] 는 폴리선 하나',()=>{
 const st=slopeStation(HIGH,LOW,5000);
 const es=naturalMark(st,{natRatio:0.3,oneLine:true});
 assert.equal(es.length,1);
 assert.equal(es[0].type,'polyline');
 assert.equal(es[0].closed,false);
 assert.equal(es[0].points.length,2+2*FEATHER_LINES);
 nearPt(es[0].points[0],5000,0);
 nearPt(es[0].points[1],5000,-2100);
});
test('자연사면 전체: 주표시 간격마다 한 자리씩',()=>{
 const es=buildNaturalSlope(HIGH,LOW,{kind:'natural',mainSpacing:5000,natRatio:0.3,oneLine:true});
 assert.equal(es.length,3);
});

/* ── 8. 하나씩 그리기 · 갈래 ── */
test('slopeMarkAt: 계획사면은 긴 선 1 + 짧은 선 4',()=>{
 const es=slopeMarkAt(HIGH,LOW,0,{kind:'planned',mainSpacing:5000,subDivide:5,planRatio:0.4});
 assert.equal(es.length,5);
 nearPt(es[0].points[0],0,0);nearPt(es[0].points[1],0,-3000);
});
test('slopeMarkAt: 자연사면은 깃 한 자리',()=>{
 const es=slopeMarkAt(HIGH,LOW,2500,{kind:'natural',mainSpacing:5000,natRatio:0.3,oneLine:true});
 assert.equal(es.length,1);
 nearPt(es[0].points[0],2500,0);
});
test('마주 보지 않는 두 선이면 빈 결과',()=>{
 const away=[{x:0,y:5000},{x:10000,y:5000}];      // 높은 쪽 선 위쪽이라 직각 방향으로 못 만나는 구간 없음 → 만난다
 assert.ok(buildSlopePattern(HIGH,away,{kind:'planned',mainSpacing:5000,subDivide:5,planRatio:0.4}).length>0);
 const parallelGap=[{x:20000,y:0},{x:30000,y:0}]; // 같은 직선 위 → 직각으로 만나지 않는다
 assert.equal(buildSlopePattern(HIGH,parallelGap,{kind:'planned',mainSpacing:5000,subDivide:5,planRatio:0.4}).length,0);
});

/* ── 9. 원문 대화상자 기본값 ── */
test('EED 기본값: 층수 3 · 층고 4500 · 30도 · 되돌림형',()=>{
 const v=normalizeValues(EED_FIELDS,{},'EED 기본');
 assert.equal(v.kind,'return');assert.equal(v.floors,3);
 assert.equal(v.calcHeight,4500);assert.equal(v.calcAngle,'30');assert.equal(v.repeat,false);
 assert.equal(normalizeValues(ESC_SHARED_FIELDS,{}).escLayer,'A-ELEV');
});
test('EPD 기본값: 층고 4500 · 30도 · 1,200mm · 그룹으로 묶기',()=>{
 const v=normalizeValues(EPD_FIELDS,{},'EPD 기본');
 assert.equal(v.height,4500);assert.equal(v.angle,'30');assert.equal(v.width,'1200');
 assert.equal(v.result,'group');assert.equal(v.repeat,false);
});
test('SLP 기본값: 계획사면 · 한꺼번에 · 5000 · 5 · 0.4 / 0.3 · 한 선으로 그리기 켬',()=>{
 const v=normalizeValues(SLP_FIELDS,{},'SLP 기본');
 assert.equal(v.kind,'planned');assert.equal(v.runMode,'all');
 assert.equal(v.mainSpacing,5000);assert.equal(v.subDivide,5);
 assert.equal(v.planRatio,0.4);assert.equal(v.natRatio,0.3);assert.equal(v.oneLine,true);
 assert.equal(normalizeValues(SLP_SHARED_FIELDS,{}).slopeLayer,'A-SITE');
});
test('범위를 벗어난 값은 잘린다',()=>{
 assert.equal(normalizeValues(SLP_FIELDS,{planRatio:9,subDivide:0}).planRatio,1);
 assert.equal(normalizeValues(SLP_FIELDS,{subDivide:0}).subDivide,1);
 assert.equal(normalizeValues(EED_FIELDS,{floors:99}).floors,20);
});
