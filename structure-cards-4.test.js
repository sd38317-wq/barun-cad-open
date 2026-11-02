// structure-cards-4.js 시험. DOM 없이 도는 순수 함수(치수 환산·기하·문자 조합)만 확인한다.
// 기대값은 원문 그림(izzarder.com/160·161·269)에서 읽어낸 숫자·문자 그대로다.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
 cornerPolygon,boxOf,subBox,entitiesInBox,barLabel,
 columnSizes,columnBarPoints,columnBarCount,columnTexts,columnEntities,cliSlotDefaults,
 beamSizes,barRow,skinDrawn,beamTexts,beamEntities,SKIN_MIN_DEPTH,
 BE_H_SPECS,beHSpec,beLoops,beEntities,beSummary,beSlotDefaults,
} from './structure-cards-4.js';

const P=(x,y)=>({x,y});
const near=(a,b,eps=1e-6)=>assert.ok(Math.abs(a-b)<=eps,`${a} ≈ ${b} 이 아님`);
const TAN22=Math.tan(Math.PI/8);   // 90도 모서리 호의 bulge = tan(90/4도)
const sq=(w,h)=>[P(-w/2,-h/2),P(w/2,-h/2),P(w/2,h/2),P(-w/2,h/2)];

/* ════════ 모서리 처리 (대근형태 · 늑근의 형태 · 모서리 직각) ════════ */
test('cornerPolygon · 직각(sharp)은 꼭짓점 그대로, 호(round)는 꼭짓점당 두 점 + bulge', () => {
 const sharp=cornerPolygon(sq(600,400),20,'sharp');
 assert.equal(sharp.points.length,4);
 assert.deepEqual(sharp.bulges,[0,0,0,0]);
 const round=cornerPolygon(sq(600,400),20,'round');
 assert.equal(round.points.length,8);
 // 반시계 사각형의 볼록 모서리 → bulge 는 +tan(22.5도)
 near(round.bulges[0],TAN22);
 assert.deepEqual(round.bulges.filter(b=>b===0).length,4);
 // 첫 모서리(-300,-200)의 접점은 반지름만큼 들어와 있다
 near(round.points[0].x,-300);near(round.points[0].y,-180);
 near(round.points[1].x,-280);near(round.points[1].y,-200);
});
test('cornerPolygon · 꺾음(chamfer)은 접점만 남기고 bulge 는 0, 반지름은 변 절반으로 깎인다', () => {
 const ch=cornerPolygon(sq(600,400),50,'chamfer');
 assert.equal(ch.points.length,8);
 assert.deepEqual(ch.bulges,[0,0,0,0,0,0,0,0]);
 const big=cornerPolygon(sq(200,100),500,'round');   // 반지름이 너무 크면 변 절반까지만
 near(big.points[0].y,-50+50);                        // 세로 100 의 절반 = 50
 assert.equal(cornerPolygon(sq(600,400),0,'round').points.length,4);
});

/* ════════ CLI 기둥 배근도 (izzarder.com/160) ════════ */
const CLI={...cliSlotDefaults(0),round:false,scale:60,barDisplayDia:30,dimGap:5,width:700,depth:700,cover:40,
 mainGrade:'HD',mainDia:22,nx:5,ny:5,tieShape:'bent',tieGrade:'HD',tieDia:10,tieEndSpace:150,tieMidSpace:300,
 subTieDia:10,subTieCount:1,subTieTextOn:false,textOn:true,sizeTextOn:true,diaPrefix:'D=',textHeight:1.5,lineGap:4.2};

test('CLI · "×축척" 칸은 축척을 곱해 mm 가 된다(문자높이 1.5 · 1/60 → 90)', () => {
 const s=columnSizes(CLI);
 assert.deepEqual([s.textHeight,s.lineGap,s.dimGap],[90,252,300]);
 assert.deepEqual([s.width,s.depth,s.barDia],[700,700,30]);   // 기둥 크기·철근지름(적당값)은 mm 그대로
 const half=columnSizes({...CLI,scale:30});
 assert.deepEqual([half.textHeight,half.lineGap,half.dimGap],[45,126,150]);
 assert.throws(()=>columnSizes({...CLI,scale:0}),/축척/);
 assert.throws(()=>columnSizes({...CLI,cover:400}),/피복/);
});
test('CLI · 주근은 대근 사각형 위에 놓이고 모서리를 함께 쓴다(가로 5 × 세로 5 → 16개)', () => {
 const s=columnSizes(CLI),pts=columnBarPoints(s);
 assert.equal(columnBarCount(s),16);
 assert.equal(pts.length,16);
 // 피복 40 → 대근 중심 사각형은 ±310. 위 줄 다섯 개는 -310 … +310 등간격
 const top=pts.filter(p=>Math.abs(p.y-310)<1e-9).map(p=>p.x).sort((a,b)=>a-b);
 assert.deepEqual(top,[-310,-155,0,155,310]);
 const right=pts.filter(p=>Math.abs(p.x-310)<1e-9).map(p=>p.y).sort((a,b)=>a-b);
 assert.deepEqual(right,[-310,-155,0,155,310]);   // 모서리 두 개 포함
 assert.throws(()=>columnBarPoints({...s,nx:1}),/2 이상/);
});
test('CLI · 원형 기둥은 세로 칸 없이 가로를 지름으로 쓰고 주근을 원둘레에 돌린다', () => {
 const s=columnSizes({...CLI,...cliSlotDefaults(1),round:true,width:600,nx:6});
 assert.equal(s.depth,600);
 const pts=columnBarPoints(s);
 assert.equal(pts.length,6);
 near(pts[0].x,0);near(pts[0].y,260);              // 600/2 - 40 = 260, 첫 철근은 12시 방향
 for(const p of pts)near(Math.hypot(p.x,p.y),260);
});
test('CLI · 표 아래 문자는 원문 그림 그대로다', () => {
 assert.deepEqual(columnTexts(CLI),['700 x 700','16 - HD22','HD10 @150','HD10 @300']);
 assert.deepEqual(columnTexts({...CLI,round:true,width:600,nx:6,mainDia:22}).slice(0,2),['D=600','6 - HD22']);
 assert.deepEqual(columnTexts({...CLI,textOn:false}),[]);           // [문자표현] 을 끄면 한 줄도 안 쓴다
 assert.equal(columnTexts({...CLI,sizeTextOn:false})[0],'16 - HD22');
 assert.equal(columnTexts({...CLI,subTieTextOn:true}).at(-1),'HD10');
 assert.equal(barLabel('SD',22),'SD22');
});
test('CLI · 한 칸을 채우면 단면·대근·주근·보조대근·철근수 문자·치수·아래 문자가 모두 나온다', () => {
 const box={x0:0,y0:0,x1:3000,y1:3000},es=columnEntities(CLI,{},box);
 assert.equal(es.filter(e=>e.type==='circle').length,16);          // 주근
 assert.equal(es.filter(e=>e.type==='dimension').length,2);        // 가로·세로 치수
 assert.equal(es.filter(e=>e.type==='polyline'&&!e.closed).length,2); // 보조대근 가로·세로 각 1
 const texts=es.filter(e=>e.type==='text');
 assert.equal(texts.length,4+4);                                    // 철근수 4 + 아래 문자 4
 // 치수선은 기둥 끝선에서 "기둥과 치수 간격"(5×60=300) 만큼 떨어진다
 const dim=es.find(e=>e.mode==='horizontal');
 near(dim.points[2].y,1500+350+300);
 // 아래 문자는 칸 아래로 줄간격(252)씩 내려간다
 const lines=texts.filter(t=>t.position.y<0).sort((a,b)=>b.position.y-a.position.y);
 near(lines[0].position.y,-126);near(lines[1].position.y,-378);
 assert.equal(lines[0].text,'700 x 700');
 // 대근은 꺽인형이라 모서리가 깎여 8점, 직선형이면 4점
 const tie=es.filter(e=>e.type==='polyline'&&e.closed)[1];
 assert.equal(tie.points.length,8);
 const straight=columnEntities({...CLI,tieShape:'straight'},{},box).filter(e=>e.type==='polyline'&&e.closed)[1];
 assert.equal(straight.points.length,4);
});

/* ════════ BLI 보 배근도 (izzarder.com/161) ════════ */
const SH={width:600,depth:1000,cover:40,scale:60,stirrupShape:'round',namePos:'topCell',
 mainGrade:'HD',mainDia:22,stirrupGrade:'HD',stirrupDia:10,skinOn:true,skinGrade:'HD',skinCount:5,
 subOn:true,subCount:2,sizeTextOn:true,dimOn:true,dimGap:5,textHeight:1.5,lineGap:4.2};
const COL={on:true,sectionName:'CENT',topMain:4,topSub:0,botMain:4,botSub:4,stirrupSpace:150};

test('BLI · 축척 환산과 늑근 형태', () => {
 const s=beamSizes(SH);
 assert.deepEqual([s.textHeight,s.lineGap,s.dimGap],[90,252,300]);
 assert.equal(s.stirrupShape,'round');
 assert.equal(beamSizes({...SH,stirrupShape:'bent'}).stirrupShape,'chamfer');
 assert.throws(()=>beamSizes({...SH,width:0}),/0보다/);
});
test('BLI · 한 줄 철근은 늑근 안쪽 폭에 등간격, 한 개면 가운데', () => {
 assert.deepEqual(barRow(260,5),[-260,-130,0,130,260]);
 assert.deepEqual(barRow(260,1),[0]);
 assert.deepEqual(barRow(260,0),[]);
});
test('BLI · 표피철근은 보 높이 900 미만이면 그리지 않는다(원문 주의)', () => {
 assert.equal(SKIN_MIN_DEPTH,900);
 assert.equal(skinDrawn(SH),true);
 assert.equal(skinDrawn({...SH,depth:899}),false);
 assert.equal(skinDrawn({...SH,depth:900}),true);
 assert.equal(skinDrawn({...SH,skinOn:false}),false);
 const low=beamEntities({...SH,depth:800},COL,{x0:0,y0:0,x1:3000,y1:3000});
 assert.equal(low.filter(e=>e.type==='line').length,2);   // 보조늑근 2개뿐, 표피철근 × 표시 없음
});
test('BLI · 아래 문자: 상부근·하부근은 주열+부열, 표피철근은 입력값의 2배(원문)', () => {
 assert.deepEqual(beamTexts(SH,COL),['600x1000','4-HD22','8-HD22','HD10 @150','10-HD10','HD10']);
 assert.deepEqual(beamTexts({...SH,skinOn:false,subOn:false},COL),['600x1000','4-HD22','8-HD22','HD10 @150']);
 assert.deepEqual(beamTexts({...SH,sizeTextOn:false},COL),[]);
});
test('BLI · 한 칸을 채우면 단면·늑근·주근·보조늑근·표피철근·치수·이름·문자가 나온다', () => {
 const box={x0:0,y0:0,x1:3000,y1:2000},es=beamEntities(SH,COL,box);
 assert.equal(es.filter(e=>e.type==='circle').length,4+4+4);        // 상단 주열4 + 하단 주열4·부열4
 assert.equal(es.filter(e=>e.type==='line').length,2+5*2*2);        // 보조늑근 2 + 표피 × 표시 (5개 × 양쪽 × 선 2)
 assert.equal(es.filter(e=>e.type==='dimension').length,2);
 assert.equal(es.filter(e=>e.type==='text').length,1+6);            // 단부이름 + 아래 문자 6줄
 // 늑근은 둥근 형이라 8점(호), 꺾인 형도 8점이지만 bulge 가 없다
 const hoop=es.filter(e=>e.type==='polyline'&&e.closed)[1];
 assert.equal(hoop.points.length,8);
 assert.ok(hoop.bulges.some(b=>b>0));
 const bent=beamEntities({...SH,stirrupShape:'bent'},COL,box).filter(e=>e.type==='polyline'&&e.closed)[1];
 assert.equal(bent.bulges,undefined);
 // 단부이름 위치 [상단 칸] → 칸 위쪽, [하단 칸] → 칸 아래쪽에서 아래 문자보다 먼저
 near(es.find(e=>e.text==='CENT').position.y,2000-126);   // 칸 위쪽에서 줄간격 반 칸
 const bottom=beamEntities({...SH,namePos:'bottomCell'},COL,box);
 near(bottom.find(e=>e.text==='CENT').position.y,-126);
 near(bottom.find(e=>e.text==='600x1000').position.y,-378);
});
test('BLI · 표현을 켠 칸 수만큼 셀을 가로로 나눈다', () => {
 const box=boxOf(P(1000,500),P(4000,2500));
 assert.deepEqual(box,{x0:1000,y0:500,x1:4000,y1:2500});
 assert.deepEqual(subBox(box,1,3),{x0:2000,x1:3000,y0:500,y1:2500});
});

/* ════════ BE 형강 단면 (izzarder.com/269) ════════ */
test('BE · 규격 목록의 첫 행들이 원문 대화상자 표(H·B·T1·T2·R·*)와 같다', () => {
 const head=BE_H_SPECS.slice(0,6).map(s=>[s.h,s.b,s.tw,s.tf,s.r,s.starred]);
 assert.deepEqual(head,[
  [100,100,6,8,10,true],[125,125,6.5,9,10,true],[150,75,5,7,8,true],
  [148,100,6,9,11,true],[150,150,7,10,11,false],[198,99,4.5,7,11,true]]);
 assert.equal(beHSpec('H-400x200x8x13').tf,13);
 assert.equal(beHSpec('없는규격').label,BE_H_SPECS[0].label);
});
test('BE · H형강 단면은 12 꼭짓점 + 웨브 붙는 안쪽 모서리 네 곳의 필렛', () => {
 const [loop]=beLoops({shape:'h',spec:'H-400x200x8x13'});
 assert.equal(loop.points.length,16);                 // 12 + 필렛 4곳이 한 점씩 더 만든다
 const fillets=loop.bulges.filter(b=>b!==0);
 assert.equal(fillets.length,4);
 for(const b of fillets)near(b,-TAN22);               // 오목 모서리라 음수
 const xs=loop.points.map(p=>p.x),ys=loop.points.map(p=>p.y);
 near(Math.min(...xs),-100);near(Math.max(...xs),100);   // B=200
 near(Math.min(...ys),-200);near(Math.max(...ys),200);   // H=400
 // 아래 플랜지 윗면은 -200+13 = -187, 웨브 옆면은 ±4
 assert.ok(loop.points.some(p=>Math.abs(p.y+187)<1e-6&&Math.abs(p.x-(4+16))<1e-6));
});
test('BE · 각형 강관은 바깥·안쪽 두 고리이고 [모서리 직각]을 켜면 4점으로 돌아간다', () => {
 const v={shape:'box',secH:150,secB:100,secT:6,secR:12,squareCorner:false};
 const [outer,inner]=beLoops(v);
 assert.equal(outer.points.length,8);
 assert.equal(inner.points.length,8);
 near(outer.bulges[0],TAN22);
 const [o2,i2]=beLoops({...v,squareCorner:true});
 assert.deepEqual([o2.points.length,i2.points.length],[4,4]);
 assert.deepEqual(o2.bulges,[0,0,0,0]);
 assert.throws(()=>beLoops({...v,secT:80}),/두께/);
});
test('BE · 나머지 모양도 원문 라디오대로 만들어진다', () => {
 assert.equal(beLoops({shape:'l',secH:100,secB:100,secT:7,secR:10})[0].points.length,7);   // 6점 + 안쪽 필렛
 assert.equal(beLoops({shape:'c',secH:150,secB:75,secT1:6.5,secT2:10,secR:10})[0].points.length,10);
 assert.equal(beLoops({shape:'ch',secH:150,secB:75,secLip:20,secT:4.5,secR:6})[0].points.length,24);
 assert.equal(beLoops({shape:'ch',secH:150,secB:75,secLip:20,secT:4.5,secR:6,squareCorner:true})[0].points.length,12);
 const pipe=beEntities({shape:'pipe',secD:216.3,secT:6},{},P(100,200));
 assert.deepEqual(pipe.map(e=>e.type),['circle','circle']);
 assert.deepEqual([pipe[0].center.x,pipe[0].center.y],[100,200]);
 near(pipe[0].radius,108.15);near(pipe[1].radius,102.15);
 assert.throws(()=>beEntities({shape:'pipe',secD:10,secT:6},{}),/두께/);
 assert.equal(beSummary(beSlotDefaults(5)),'원형 관 D216.3×6');
});
test('BE · 삽입점은 단면 바깥치수의 가운데다', () => {
 const es=beEntities({shape:'h',spec:'H-400x200x8x13'},{},P(1000,-500));
 const xs=es[0].points.map(p=>p.x),ys=es[0].points.map(p=>p.y);
 near((Math.min(...xs)+Math.max(...xs))/2,1000);
 near((Math.min(...ys)+Math.max(...ys))/2,-500);
 assert.equal(es[0].cardLayer,'A-BEAM');
});

/* ════════ 칸 재지정 시 자동 갱신 ════════ */
test('셀 안에 완전히 들어간 객체만 지운다(표 격자선은 경계를 넘으므로 남는다)', () => {
 const box={x0:0,y0:0,x1:1000,y1:1000};
 const es=[
  {id:'in',type:'line',points:[P(100,100),P(900,900)]},
  {id:'grid',type:'line',points:[P(-500,0),P(1500,0)]},
  {id:'out',type:'circle',center:P(3000,3000),radius:10},
  {id:'txt',type:'text',text:'700 x 700',position:P(500,500),height:90},
  {id:'far',type:'text',text:'옆칸',position:P(2500,500),height:90},
 ];
 // 문자는 글자 폭이 칸을 넘어도 기준점이 칸 안이면 갱신 대상이다
 assert.deepEqual(entitiesInBox(es,box),['in','txt']);
 assert.deepEqual(entitiesInBox(es,box,{textOnly:true}),['txt']);
 assert.deepEqual(entitiesInBox(es,box,{textByPosition:false}),['in']);
});
