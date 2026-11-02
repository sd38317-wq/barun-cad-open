// multi-tools-4.js 순수 함수 시험(4차 멀티도구 9개). DOM 없이 node --test 로 돈다.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as G from './geometry.js';
import {
 ANCHOR_OPTIONS,insertionPoint,anchorPoint,groupAnchorPoint,facingAngle,shortAngle,faceRotation,FACING_OFFSET,
 divideCopyPlan,
 nearerEnd,extendEndChanges,
 joinGroups,joinedEntity,dropCollinearVertices,
 stepDelta,
 evenSpacingPlan,targetOnEntity,alignPlan,
 doubleOffsetPair,
 offsetOnce,
 rotateEachPlan,rotateGroupPlan,pivotRatio,pivotFromRatio,mirrorEachPlan,
 scaleEachPlan,scaleGroupPlan,entitySize,unifyFactors,entitiesInsideBoundary,
 anchorGridSvg,
} from './multi-tools-4.js';

const P=(x,y)=>({x,y});
const line=(id,a,b,extra={})=>({id,type:'line',points:[a,b],layer:'L1',...extra});
const rect=(id,x,y,w,h)=>({id,type:'rectangle',points:[P(x,y),P(x+w,y),P(x+w,y+h),P(x,y+h)],layer:'L1'});
const close=(a,b,eps=1e-6)=>assert.ok(Math.abs(a-b)<eps,`${a} ≈ ${b} 이어야 합니다`);
const closeP=(a,b,eps=1e-6)=>{close(a.x,b.x,eps);close(a.y,b.y,eps);};

/* ── 공통 · 3x3 기준점 ── */
test('anchorPoint: 3x3 아홉 자리와 삽입점', () => {
 const e=rect('r',0,0,100,50);
 assert.equal(ANCHOR_OPTIONS.length,10);
 closeP(anchorPoint(e,'BL'),P(0,0));
 closeP(anchorPoint(e,'MC'),P(50,25));
 closeP(anchorPoint(e,'TR'),P(100,50));
 closeP(anchorPoint(e,'TC'),P(50,50));
 closeP(anchorPoint(e,'MR'),P(100,25));
 closeP(anchorPoint(e,'INS'),P(0,0));
 closeP(insertionPoint({type:'text',position:P(7,9),text:'가',height:100}),P(7,9));
 closeP(groupAnchorPoint([rect('a',0,0,10,10),rect('b',90,40,10,10)],'BL'),P(0,0));
 closeP(groupAnchorPoint([rect('a',0,0,10,10),rect('b',90,40,10,10)],'TR'),P(100,50));
});
test('facingAngle · shortAngle · faceRotation(RM 한점 방향 4-라디오)', () => {
 close(facingAngle(line('l',P(0,0),P(0,10))),90);
 close(facingAngle({type:'text',position:P(0,0),text:'가',height:10,rotation:30}),30);
 assert.equal(shortAngle(270),-90);
 assert.equal(shortAngle(-450),-90);
 assert.deepEqual(FACING_OFFSET,{up:90,right:0,down:270,left:180});
 // 오른쪽을 보는 선(각도 0)의 "우측"이 오른쪽 점을 바라보면 회전 0
 close(faceRotation(0,'right',P(0,0),P(10,0)),0);
 // 같은 선의 "상측"이 오른쪽 점을 바라보려면 -90도
 close(faceRotation(0,'up',P(0,0),P(10,0)),-90);
 close(faceRotation(0,'left',P(0,0),P(10,0)),180);
});

/* ── DVC ── */
test('DVC: 기본 등분 · 최소간격(M) · 최대간격(X)', () => {
 const a=P(0,0),b=P(1000,0);
 const base=divideCopyPlan({a,b,mode:'divide',count:4});
 assert.deepEqual(base.offsets,[0,250,500,750,1000]);
 close(base.spacing,250);
 // 최소 800 → 1000/800=1.25 → 1등분, 실제 간격 1000
 const min=divideCopyPlan({a,b,mode:'min',gap:800});
 assert.equal(min.count,1);
 close(min.spacing,1000);
 // 최대 800 → 올림 2등분, 실제 간격 500 (입력값보다 작다)
 const max=divideCopyPlan({a,b,mode:'max',gap:800});
 assert.equal(max.count,2);
 close(max.spacing,500);
 assert.ok(max.spacing<=800);
 // 원문 예시 성격 확인: 최소는 입력값 이상, 최대는 입력값 이하
 const m2=divideCopyPlan({a,b:P(5700,0),mode:'min',gap:800});
 assert.ok(m2.spacing>=800,`${m2.spacing} >= 800`);
 const x2=divideCopyPlan({a,b:P(5700,0),mode:'max',gap:800});
 assert.ok(x2.spacing<=800,`${x2.spacing} <= 800`);
 assert.throws(()=>divideCopyPlan({a,b:a,mode:'divide',count:2}),/서로 달라야/);
 assert.throws(()=>divideCopyPlan({a,b,mode:'min',gap:0}),/0보다 커야/);
});
test('DVC: 등폭(In) 은 간격이 바깥, 등폭(Out) 은 객체가 바깥', () => {
 const a=P(0,0),b=P(1000,0),width=100,count=4;
 const inn=divideCopyPlan({a,b,mode:'in',count,width});
 // 객체 4개(폭 100) → 남는 600 을 5 칸으로 → 간격 120, 첫 객체 중심 120+50=170
 assert.equal(inn.offsets.length,4);
 close(inn.offsets[0],170);
 close(inn.offsets[1]-inn.offsets[0],220);
 assert.ok(inn.offsets[0]-width/2>0,'In 은 첫 객체 앞에 간격이 있다');
 const out=divideCopyPlan({a,b,mode:'out',count,width});
 close(out.offsets[0],50);                 // 첫 객체가 시작점에 붙는다
 close(out.offsets.at(-1),1000-50);        // 마지막 객체가 끝점에 붙는다
 close(out.offsets[1]-out.offsets[0],300);
 assert.throws(()=>divideCopyPlan({a,b,mode:'in',count:4,width:0}),/객체 폭/);
 assert.throws(()=>divideCopyPlan({a,b,mode:'in',count:20,width:100}),/보다 큽니다/);
 assert.throws(()=>divideCopyPlan({a,b,mode:'out',count:1,width:100}),/두 개 이상/);
});

/* ── EXL ── */
test('EXL: 선·폴리선 끝점 이동(양수 늘리기 · 음수 줄이기)', () => {
 const e=line('l',P(0,0),P(100,0));
 assert.equal(nearerEnd(e,P(95,3)),'end');
 assert.equal(nearerEnd(e,P(4,-2)),'start');
 closeP(extendEndChanges(e,'end',50).points[1],P(150,0));
 closeP(extendEndChanges(e,'end',-30).points[1],P(70,0));
 closeP(extendEndChanges(e,'start',50).points[0],P(-50,0));
 const pl={id:'p',type:'polyline',points:[P(0,0),P(0,100),P(100,100)],layer:'L1'};
 closeP(extendEndChanges(pl,'end',20).points[2],P(120,100));
 closeP(extendEndChanges(pl,'start',10).points[0],P(0,-10));
 assert.throws(()=>extendEndChanges(e,'end',-200),/넘어 줄일 수 없습니다/);
 assert.throws(()=>extendEndChanges(e,'end',0),/길이를 입력/);
});
test('EXL: 호 지원(2차 검증이 빠졌다고 한 것)', () => {
 const arc={id:'a',type:'arc',center:P(0,0),radius:100,startAngle:0,endAngle:90,layer:'L1'};
 assert.equal(nearerEnd(arc,P(101,2)),'start');
 assert.equal(nearerEnd(arc,P(2,101)),'end');
 // 길이 100 만큼 늘리면 호 각도가 100/100 rad = 57.2957…도 늘어난다
 const grown=extendEndChanges(arc,'end',100);
 close(grown.endAngle,90+180/Math.PI,1e-9);
 const back=extendEndChanges(arc,'start',100);
 close(back.startAngle,G.normalizeAngle(-180/Math.PI),1e-9);
 assert.throws(()=>extendEndChanges(arc,'end',-1000),/0보다 짧게/);
 assert.throws(()=>extendEndChanges(arc,'end',100000),/한 바퀴/);
});

/* ── JL ── */
test('JL: 끊어진 선 잇기 · ByLayer 통일 물음', () => {
 const es=[
  line('a',P(0,0),P(100,0),{color:'#ff0000',linetype:'DASHED'}),
  line('b',P(100,0),P(100,100)),
  line('c',P(100,100),P(0,100)),
  line('z',P(900,900),P(950,900)),
 ];
 const groups=joinGroups(es,0.001);
 assert.equal(groups.length,1);
 assert.deepEqual(groups[0].ids.toSorted(),['a','b','c']);
 assert.equal(groups[0].points.length,4);
 assert.equal(groups[0].closed,false);
 // 허용오차 안의 틈도 잇는다
 assert.equal(joinGroups([line('a',P(0,0),P(100,0)),line('b',P(100.4,0),P(200,0))],0.5)[0].ids.length,2);
 assert.equal(joinGroups([line('a',P(0,0),P(100,0)),line('b',P(100.4,0),P(200,0))],0.001).length,0);
 // 정점 2개짜리 폴리선은 일반 선과도 이어진다(원문), 3개짜리는 선과 잇지 않는다
 const flat={id:'p2',type:'polyline',points:[P(100,0),P(200,0)],layer:'L1'};
 assert.equal(joinGroups([line('a',P(0,0),P(100,0)),flat],0.001)[0].ids.length,2);
 const bent={id:'p3',type:'polyline',points:[P(100,0),P(200,0),P(200,80)],layer:'L1'};
 assert.equal(joinGroups([line('a',P(0,0),P(100,0)),bent],0.001).length,0);
 // ByLayer 통일이면 강제색·강제 선모양을 뗀다
 const keep=joinedEntity(groups[0],false),unify=joinedEntity(groups[0],true);
 assert.equal(keep.color,'#ff0000');
 assert.equal(keep.linetype,'DASHED');
 assert.equal(unify.color,undefined);
 assert.equal(unify.linetype,undefined);
 assert.equal(unify.layer,'L1');
});
test('JL: 일직선 두 선은 중간 정점 없이 선 하나로 합친다(2026-09-24 F12)', () => {
 const g=joinGroups([line('a',P(7000,0),P(8000,0)),line('b',P(8000,0),P(9000,0))],0.001);
 assert.equal(g.length,1);
 assert.deepEqual(g[0].points,[P(7000,0),P(9000,0)]);
 const e=joinedEntity(g[0],false);
 assert.equal(e.type,'line');
 assert.deepEqual(dropCollinearVertices([P(0,0),P(50,0),P(100,0),P(100,100)]),[P(0,0),P(100,0),P(100,100)]);
 // 꺾인 선은 그대로 폴리선
 const bent=joinGroups([line('a',P(0,0),P(100,0)),line('b',P(100,0),P(100,100))],0.001);
 assert.equal(joinedEntity(bent[0],false).type,'polyline');
 assert.equal(bent[0].points.length,3);
});
test('JL: 한 바퀴 돌면 닫힌 폴리선이 된다', () => {
 const es=[line('a',P(0,0),P(100,0)),line('b',P(100,0),P(100,100)),line('c',P(100,100),P(0,0))];
 const [g]=joinGroups(es,0.001);
 assert.equal(g.closed,true);
 assert.equal(g.points.length,3);
});

/* ── MC ── */
test('MC: 방향·간격 한 칸 변위', () => {
 closeP(stepDelta(P(2,0),300),P(300,0));
 closeP(stepDelta(P(0,-5),100),P(0,-100));
 const d=stepDelta(P(3,4),50);
 close(Math.hypot(d.x,d.y),50);
 assert.throws(()=>stepDelta(P(0,0),10),/서로 다른 두 점/);
});

/* ── OA ── */
test('OA: 수평 등간격은 양 끝을 두고 사이 간격만 고르게 한다', () => {
 const es=[rect('a',0,0,100,10),rect('b',150,0,300,10),rect('c',900,0,100,10)];
 const plan=evenSpacingPlan(es,'x');
 const byId=Object.fromEntries(plan.map(p=>[p.id,p]));
 close(byId.a.dx,0);
 close(byId.c.dx,0);
 // 전체 1000, 폭 합 500 → 간격 250 → b 의 왼쪽은 100+250=350
 close(byId.b.dx,350-150);
 assert.ok(plan.every(p=>p.dy===0));
 assert.throws(()=>evenSpacingPlan(es.slice(0,2),'x'),/세 개 이상/);
});
test('OA: 점 지정 · 수평/수직 이동은 한 축만 움직인다', () => {
 const es=[rect('a',0,0,100,10)];
 const h=alignPlan(es,{target:'point',move:'h',anchor:'BL',rotate:false},{point:P(500,700)});
 close(h[0].dx,500);close(h[0].dy,0);
 const v=alignPlan(es,{target:'point',move:'v',anchor:'TR',rotate:false},{point:P(500,700)});
 close(v[0].dx,0);close(v[0].dy,700-10);
});
test('OA: 두점중간은 덩어리째, 두점중심은 각 객체 개별', () => {
 const es=[rect('a',0,0,100,100),rect('b',400,0,100,100)];
 const aim={p1:P(0,0),p2:P(1000,0)};           // 중간 = (500,0)
 const mid=alignPlan(es,{target:'mid2',move:'h',anchor:'MC',rotate:false},aim);
 // 덩어리 중심 (250,50) → 같은 변위를 둘 다 받는다
 close(mid[0].dx,250);close(mid[1].dx,250);
 close(mid[0].dy,-50);close(mid[1].dy,-50);
 const each=alignPlan(es,{target:'center2',move:'h',anchor:'MC',rotate:false},aim);
 close(each[0].dx,450);close(each[1].dx,50);   // 각자 중심이 (500,0) 이 된다
 close(each[0].dy,-50);close(each[1].dy,-50);
});
test('OA: 목표 객체에 맞추고 그 각도로 회전', () => {
 const target={id:'t',type:'line',points:[P(300,0),P(300,1000)],layer:'L1'};
 const hit=targetOnEntity(target,P(0,400),'x');
 closeP(hit.point,P(300,400));
 close(hit.angle,90);
 const es=[line('a',P(0,400),P(50,400))];      // 각도 0
 const plan=alignPlan(es,{target:'object',move:'h',anchor:'INS',rotate:true},{entity:target});
 close(plan[0].dx,300);
 close(plan[0].dy,0);
 close(plan[0].angle,90);
 const noRotate=alignPlan(es,{target:'object',move:'h',anchor:'INS',rotate:false},{entity:target});
 close(noRotate[0].angle,0);
});

/* ── OB ── */
test('OB: 양쪽 동시 옵셋 · 켜를 붙이지 않는다(현재 켜로 들어간다)', () => {
 const e=line('l',P(0,0),P(1000,0),{layer:'L1'});
 const pair=doubleOffsetPair(e,200);
 assert.equal(pair.length,2);
 const ys=pair.map(x=>x.points[0].y).toSorted((a,b)=>a-b);
 close(ys[0],-200);
 close(ys[1],200);
 assert.ok(pair.every(x=>x.layer===undefined),'결과에 원본 켜가 남으면 안 된다');
 assert.ok(pair.every(x=>x.id===undefined));
 const c={id:'c',type:'circle',center:P(0,0),radius:500,layer:'L1'};
 const rs=doubleOffsetPair(c,100).map(x=>x.radius).toSorted((a,b)=>a-b);
 assert.deepEqual(rs,[400,600]);
 assert.throws(()=>doubleOffsetPair(c,600),/반지름보다 큽니다/);
 assert.throws(()=>doubleOffsetPair(e,0),/0보다 커야/);
});

/* ── OM ── */
test('OM: 한 번에 하나씩, 방향점 쪽으로 띄운다', () => {
 const e=line('l',P(0,0),P(1000,0),{layer:'L1'});
 const up=offsetOnce(e,150,P(500,900));
 close(up.points[0].y,150);
 const down=offsetOnce(e,150,P(500,-900));
 close(down.points[0].y,-150);
 assert.equal(up.id,undefined);
 assert.throws(()=>offsetOnce(e,0,P(0,1)),/0보다 커야/);
});

/* ── RM ── */
test('RM[기본]: 여러 개를 골라도 각자 자기 기준점에서 돈다', () => {
 const es=[rect('a',0,0,100,100),rect('b',1000,0,100,100)];
 const plan=rotateEachPlan(es,'MC',90);
 assert.equal(plan.length,2);
 // 제자리 회전이므로 각 객체의 바운딩박스 중심이 그대로다
 for(const [i,e] of es.entries()){
  const moved={...e,...plan[i].changes},before=G.bounds([e]),after=G.bounds([moved]);
  close((before.minX+before.maxX)/2,(after.minX+after.maxX)/2,1e-6);
  close((before.minY+before.maxY)/2,(after.minY+after.maxY)/2,1e-6);
 }
 // 좌하 기준이면 제자리가 아니라 그 모서리를 축으로 돈다
 const corner=rotateEachPlan([rect('a',0,0,100,50)],'BL',90)[0];
 const pts=corner.changes.points;
 closeP(pts[0],P(0,0));
 closeP(pts[1],P(0,100));
});
test('RM[묶음]: 기준점 비율을 다른 묶음에 그대로 옮긴다', () => {
 const first=[rect('a',0,0,100,100),rect('b',100,0,100,100)];
 const ratio=pivotRatio(first,P(100,50));
 close(ratio.fx,0.5);close(ratio.fy,0.5);
 const second=[rect('c',1000,500,200,200),rect('d',1200,500,200,200)];
 closeP(pivotFromRatio(second,ratio),P(1200,600));
 const plan=rotateGroupPlan(second,P(1200,600),180);
 const moved=second.map((e,i)=>({...e,...plan[i].changes}));
 const b0=G.bounds(second),b1=G.bounds(moved);
 close((b0.minX+b0.maxX)/2,(b1.minX+b1.maxX)/2);   // 묶음 전체는 제자리
 close(G.dist(moved[0].points[0],moved[1].points[0]),G.dist(second[0].points[0],second[1].points[0]));
});
test('RM[미러]: 자기 자리에서 좌우·위아래 뒤집기', () => {
 const e=line('l',P(0,0),P(100,50));
 const [v]=mirrorEachPlan([e],'BL','v');
 closeP(v.changes.points[0],P(0,0));
 closeP(v.changes.points[1],P(-100,50));
 const [h]=mirrorEachPlan([e],'BL','h');
 closeP(h.changes.points[1],P(100,-50));
});

/* ── SM ── */
test('SM[자기자리]: 각자 제자리에서 축척(공용 기준점이 아니다)', () => {
 const es=[rect('a',0,0,100,100),rect('b',1000,0,100,100)];
 const plan=scaleEachPlan(es,'BL',0.5);
 closeP(plan[0].changes.points[2],P(50,50));
 closeP(plan[1].changes.points[0],P(1000,0));
 closeP(plan[1].changes.points[2],P(1050,50));
 assert.throws(()=>scaleEachPlan(es,'BL',0),/0보다 커야/);
 const grouped=scaleGroupPlan(es,P(0,0),2);
 closeP(grouped[1].changes.points[0],P(2000,0));
});
test('SM[통일]: 기준 객체 크기에 맞는 배율을 각자 계산', () => {
 const ref=rect('r',0,0,100,100);
 const es=[rect('a',500,0,200,200),rect('b',900,0,50,50)];
 close(entitySize(ref,'width'),100);
 close(entitySize(ref,'diag'),Math.hypot(100,100));
 const fs=unifyFactors(es,ref,'diag');
 close(fs[0].factor,0.5);
 close(fs[1].factor,2);
 close(unifyFactors(es,ref,'width')[0].factor,0.5);
 assert.throws(()=>unifyFactors(es,{id:'z',type:'line',points:[P(0,0),P(0,0)]},'diag'),/크기가 0/);
});
test('SM[통일]: 도곽·닫힌 폴리선 테두리 안 객체 고르기', () => {
 const border={id:'bd',type:'polyline',closed:true,points:[P(0,0),P(1000,0),P(1000,1000),P(0,1000)],layer:'L1'};
 const inner=line('in',P(100,100),P(200,200)),outer=line('out',P(2000,0),P(2100,0));
 const found=entitiesInsideBoundary([border,inner,outer],border);
 assert.deepEqual(found.map(e=>e.id),['in']);
});

/* ── 미리보기 ── */
test('anchorGridSvg: 480x130 한 장, 고른 칸만 칠한다', () => {
 const svg=anchorGridSvg('BL',{width:480,height:130});
 assert.ok(svg.startsWith('<svg'));
 assert.ok(svg.includes('viewBox="0 0 480 130"'));
 assert.equal((svg.match(/<rect[^>]*fill="#ffd479"/g)||[]).length,1);
 assert.ok(svg.includes('기준점: 좌하'));
 assert.ok(anchorGridSvg('INS',{width:480,height:130}).includes('삽입점 또는 시작점'));
 const compact=anchorGridSvg('MC',{width:64,height:34,compact:true});
 assert.ok(!compact.includes('<text'));
});
