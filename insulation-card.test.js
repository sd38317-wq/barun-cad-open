// 단열재 그리기 카드 INS 시험. 화면 없이 순수 기하·설정 판정만 확인한다. (원문 izzarder.com/228)
import test from 'node:test';
import assert from 'node:assert/strict';
import {
 insulationStage,coilPoints,coilRadius,coilSpan,clipAtLength,insulationProfile,pathRuler,pointAlong,sideSign,
 insulationEntities,insulationFromPoints,STAGE_PITCH,STAGE_RADIUS,STAGE_LABEL,INSULATION_FIELDS,INSULATION_LAYER,
} from './insulation-card.js';

const V={looseMax:60,midMax:150,thicknessInput:'separate',fitCut:true,dropStub:false};
const near=(a,b,eps=1e-6)=>Math.abs(a-b)<=eps;

test('두께별 형태 · 원문 기본 구간 0~60 느슨 / ~150 중간 / 150 초과 촘촘', () => {
 assert.equal(insulationStage(40,V).key,'loose');
 assert.equal(insulationStage(60,V).key,'loose');
 assert.equal(insulationStage(60.001,V).key,'mid');
 assert.equal(insulationStage(150,V).key,'mid');
 assert.equal(insulationStage(151,V).key,'dense');
 assert.equal(insulationStage(180,V).label,STAGE_LABEL.dense);
 // 마디 길이 = 두께 × 단계 비율
 assert.ok(near(insulationStage(180,V).pitch,180*STAGE_PITCH.dense));
 assert.ok(near(insulationStage(40,V).pitch,40*STAGE_PITCH.loose));
});

test('두께별 형태 · 원문의 0~1 / ~600 설정은 모두 중간 형태로 통일된다', () => {
 const u={...V,looseMax:1,midMax:600};
 for(const t of [20,40,80,150,300,590])assert.equal(insulationStage(t,u).key,'mid');
});

test('두께별 형태 · 잘못된 값은 거른다', () => {
 assert.throws(()=>insulationStage(0,V),/양수/);
 assert.throws(()=>insulationStage(-5,V),/양수/);
 assert.throws(()=>insulationStage(100,{looseMax:150,midMax:60}),/앞 값/);
});

test('고리선 · 한 마디마다 pitch 만큼 나아가고 두께 안에 머문다', () => {
 const t=100,pitch=60,rr=STAGE_RADIUS.mid,r=coilRadius(t,pitch,rr),pts=coilPoints(t,pitch,rr,3);
 assert.ok(near(pts[0].s,0,1e-9),`시작 s=${pts[0].s}`);            // 첫 고리의 왼쪽 끝이 0
 assert.ok(near(pts[0].d,r,1e-9),`시작 d=${pts[0].d}`);
 assert.ok(near(pts.at(-1).s,2*r+3*pitch,1e-6),`끝 s=${pts.at(-1).s}`);
 assert.ok(near(coilSpan(t,pitch,rr,3),2*r+3*pitch,1e-9));
 const ds=pts.map(p=>p.d);
 assert.ok(Math.min(...ds)>=-1e-9&&Math.max(...ds)<=t+1e-9,'두께 밖으로 나가지 않는다');
 // 위·아래 두 면에 모두 닿는다(고리가 위아래 번갈아 생긴다). 점으로 만든 선이라 1% 안쪽까지 본다.
 assert.ok(Math.min(...ds)<t*0.01,`아래 면 ${Math.min(...ds)}`);
 assert.ok(Math.max(...ds)>t*0.99,`위 면 ${Math.max(...ds)}`);
 // 고리를 도느라 s 가 잠깐 뒤로 물러나는 구간이 있다(원문의 X 교차)
 assert.ok(pts.some((p,i)=>i&&p.s<pts[i-1].s));
 // 마디 수를 늘리면 정확히 pitch 만큼 길어진다
 assert.ok(near(coilSpan(t,pitch,rr,4)-coilSpan(t,pitch,rr,3),pitch,1e-9));
});

test('고리선 · 잘못된 인자', () => {
 assert.throws(()=>coilPoints(0,60,0.2,2),/양수/);
 assert.throws(()=>coilPoints(100,0,0.2,2),/양수/);
 assert.throws(()=>coilPoints(100,60,0.9,2),/0 과 0.5/);
 assert.throws(()=>coilPoints(100,60,0.2,0),/1 이상/);
});

test('고리 반지름 · 원문에서 잰 값을 쓰되 겹치면 줄인다', () => {
 assert.ok(near(coilRadius(180,72,STAGE_RADIUS.dense),180*STAGE_RADIUS.dense,1e-9));
 // 마디가 지나치게 짧으면 고리가 겹치므로 접선이 생길 만큼 줄어든다
 const r=coilRadius(100,4,0.45);
 assert.ok(r<100*0.45);
 assert.ok(Math.hypot(2,100-2*r)>=2.02*r);
});

test('절단 · 켜면 길이에 딱 맞고, 끄면 마디 단위를 살린다', () => {
 const t=100,pitch=t*STAGE_PITCH.mid,r=coilRadius(t,pitch,STAGE_RADIUS.mid); // pitch 60
 const L=500,units=(L-2*r)/pitch; // 7.60 마디
 const cut=insulationProfile(L,t,{...V,fitCut:true,dropStub:false});
 assert.equal(cut.cycles,Math.ceil(units)); // 8 마디를 만든 뒤 잘라낸다
 assert.ok(near(cut.drawnLength,L,1e-6),`절단 길이 ${cut.drawnLength}`);

 const keep=insulationProfile(L,t,{...V,fitCut:false});
 assert.equal(keep.cycles,Math.round(units)); // 8
 assert.ok(near(keep.drawnLength,coilSpan(t,pitch,STAGE_RADIUS.mid,8),1e-6),`단위 살림 길이 ${keep.drawnLength}`);
 assert.ok(keep.drawnLength>L); // 마디를 자르지 않아 조금 넘칠 수 있다

 const stub=insulationProfile(L,t,{...V,fitCut:true,dropStub:true});
 assert.equal(stub.cycles,Math.floor(units)); // 7
 assert.ok(near(stub.drawnLength,coilSpan(t,pitch,STAGE_RADIUS.mid,7),1e-6));
 assert.ok(stub.drawnLength<L); // 쪼가리를 버려 길이보다 짧아진다
});

test('절단 · 딱 떨어지는 길이는 세 옵션이 같은 결과', () => {
 const t=100,pitch=t*STAGE_PITCH.mid,L=coilSpan(t,pitch,STAGE_RADIUS.mid,5); // 정확히 5 마디
 for(const o of [{fitCut:false},{fitCut:true,dropStub:false},{fitCut:true,dropStub:true}]){
  const p=insulationProfile(L,t,{...V,...o});
  assert.equal(p.cycles,5,JSON.stringify(o));
  assert.ok(near(p.drawnLength,L,1e-6),`${JSON.stringify(o)} → ${p.drawnLength}`);
 }
});

test('절단 · 잘라낸 점은 앞뒤 점 사이에 놓인다', () => {
 const pts=[{s:0,d:0},{s:10,d:40},{s:20,d:0}];
 const out=clipAtLength(pts,15);
 assert.equal(out.length,3);
 assert.deepEqual(out.at(-1),{s:15,d:20});
 assert.throws(()=>clipAtLength(pts,-1),/짧습니다/);
});

test('경로 자 · 누적 길이와 닫힌 경로', () => {
 const r=pathRuler([{x:0,y:0},{x:300,y:0},{x:300,y:400}],false);
 assert.deepEqual(r.acc,[0,300,700]);
 assert.equal(r.length,700);
 const c=pathRuler([{x:0,y:0},{x:100,y:0},{x:100,y:100},{x:0,y:100}],true);
 assert.equal(c.length,400); // 닫으면 마지막 변까지
 assert.throws(()=>pathRuler([{x:0,y:0}],false),/두 점 이상/);
 assert.throws(()=>pathRuler([{x:0,y:0},{x:0,y:0}],false),/두 점 이상/);
});

test('경로 자 · 거리 s 와 옆거리 d 로 좌표를 낸다', () => {
 const r=pathRuler([{x:0,y:0},{x:300,y:0},{x:300,y:400}],false);
 assert.deepEqual(pointAlong(r,0,0),{x:0,y:0});
 assert.deepEqual(pointAlong(r,150,0),{x:150,y:0});
 assert.deepEqual(pointAlong(r,150,50),{x:150,y:50});   // 왼쪽 법선 = +y
 assert.deepEqual(pointAlong(r,500,50),{x:250,y:200});  // 둘째 구간, 왼쪽 법선 = −x
});

test('방향점 · 왼쪽 +1 오른쪽 −1, 선 위는 오류', () => {
 const r=pathRuler([{x:0,y:0},{x:1000,y:0}],false);
 assert.equal(sideSign(r,{x:500,y:300}),1);
 assert.equal(sideSign(r,{x:500,y:-300}),-1);
 assert.throws(()=>sideSign(r,{x:500,y:0}),/한쪽에 찍으세요/);
});

test('두 점 + 방향 · 따로지정은 물어본 두께를 쓴다 (좌표 확인)', () => {
 const out=insulationFromPoints({x:0,y:0},{x:600,y:0},{x:300,y:1000},{...V,thicknessInput:'separate'},100);
 assert.equal(out.entities.length,1);
 const e=out.entities[0];
 assert.equal(e.type,'polyline');
 assert.equal(e.closed,false);
 assert.equal(e.cardLayer,INSULATION_LAYER);
 const xs=e.points.map(p=>p.x),ys=e.points.map(p=>p.y);
 assert.ok(near(xs[0],0,1e-6),`시작 x ${xs[0]}`);              // 첫 점은 첫째 점에서 시작한다
 assert.ok(ys[0]>0&&ys[0]<50,`시작 y ${ys[0]}`);                // 첫 고리의 왼쪽 끝이라 띠 아래쪽에 있다
 assert.ok(near(Math.min(...xs),0,1e-6),'첫째 점보다 앞으로 나가지 않는다');
 assert.ok(near(Math.max(...xs),600,1e-6),`끝 x ${Math.max(...xs)}`); // 절단이 켜져 있어 길이에 딱 맞는다
 assert.ok(Math.min(...ys)>=-1e-9&&Math.max(...ys)<=100+1e-9,'띠 밖으로 나가지 않는다');
 assert.ok(Math.max(...ys)>99,'반대쪽 면에 닿는다');
});

test('두 점 + 방향 · 동시지정은 둘째 점~방향점 거리가 두께다', () => {
 const out=insulationFromPoints({x:0,y:0},{x:600,y:0},{x:600,y:180},{...V,thicknessInput:'together'});
 assert.equal(out.stage.key,'dense'); // 180 > 150
 const ys=out.entities[0].points.map(p=>p.y);
 assert.ok(Math.max(...ys)>180*0.99&&Math.max(...ys)<=180+1e-9,`두께 ${Math.max(...ys)}`);
 // 동시지정에서는 넘겨준 두께 인자를 무시한다
 const same=insulationFromPoints({x:0,y:0},{x:600,y:0},{x:600,y:180},{...V,thicknessInput:'together'},999);
 assert.deepEqual(same.entities[0].points.at(-1),out.entities[0].points.at(-1));
});

test('방향점 쪽으로만 두껍게 그린다 (반대쪽으로 찍으면 부호가 뒤집힌다)', () => {
 const up=insulationFromPoints({x:0,y:0},{x:600,y:0},{x:300,y:500},V,100);
 const down=insulationFromPoints({x:0,y:0},{x:600,y:0},{x:300,y:-500},V,100);
 assert.ok(Math.min(...up.entities[0].points.map(p=>p.y))>=-1e-9);
 assert.ok(Math.max(...down.entities[0].points.map(p=>p.y))<=1e-9);
});

test('경로 단열재 · 꺾인 경로도 두께 안에서 따라간다', () => {
 const r=pathRuler([{x:0,y:0},{x:400,y:0},{x:400,y:400}],false);
 const out=insulationEntities({ruler:r,thickness:80,values:V,sign:1});
 assert.equal(out.stage.key,'mid');
 assert.ok(near(out.drawnLength,800,1e-6));
 assert.equal(out.entities[0].points.length,out.points.length);
 for(const p of out.entities[0].points)assert.ok(Number.isFinite(p.x)&&Number.isFinite(p.y));
});

test('너무 긴 단열재와 길이 0 은 막는다', () => {
 assert.throws(()=>insulationProfile(0,100,V),/길이/);
 assert.throws(()=>insulationProfile(1e9,10,V),/너무 깁니다/);
});

test('설정 칸 정의 · 원문 대화상자 항목이 모두 있다', () => {
 const keys=INSULATION_FIELDS.map(f=>f.key);
 assert.deepEqual(keys,['insulationType','lambda','thickness','looseMax','midMax','minPitch','thicknessInput','fitCut','dropStub']);
 assert.equal(INSULATION_FIELDS.find(f=>f.key==='insulationType').def,null);
 assert.equal(INSULATION_FIELDS.find(f=>f.key==='lambda').def,null);
 assert.equal(INSULATION_FIELDS.find(f=>f.key==='thickness').def,100);
 assert.ok(INSULATION_FIELDS.find(f=>f.key==='looseMax').hidden&&INSULATION_FIELDS.find(f=>f.key==='thicknessInput').hidden,'구간·입력방식은 숨긴 기본값');
 const stub=INSULATION_FIELDS.find(f=>f.key==='dropStub');
 assert.equal(stub.when({fitCut:false}),false); // 절단이 꺼지면 조건부로 꺼진다
 assert.equal(stub.when({fitCut:true}),true);
 const sel=INSULATION_FIELDS.find(f=>f.key==='thicknessInput');
 assert.equal(sel.def,'separate'); // 원문 기본값 = 따로지정
 assert.deepEqual(sel.options.map(([k])=>k),['separate','together']);
 assert.equal(INSULATION_FIELDS.find(f=>f.key==='looseMax').def,60);
 assert.equal(INSULATION_FIELDS.find(f=>f.key==='midMax').def,150);
 assert.equal(INSULATION_FIELDS.find(f=>f.key==='fitCut').def,true);
});

test('단열재 λ 미입력은 엔티티에서 null로 유지된다', () => {
 const out=insulationEntities({ruler:pathRuler([{x:0,y:0},{x:500,y:0}]),thickness:80,values:{lambda:null}});
 assert.equal(out.entities[0].lambda,null);
});
