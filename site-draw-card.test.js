// 그리기 카드 3종(CTR·DDB·HGRID) 기하 시험. 화면 없이 순수 함수만 돌린다.
// 원문: izzarder.com/88(CTR) · /580(DDB) · /289(HGRID)
import test from 'node:test'
import assert from 'node:assert/strict'
import {normalizeValues,defaultsOf} from './card-kit.js'
import {SITE_LAYERS,dedupePoints,
 CTR_FIELDS,CTR_SHARED_FIELDS,CTR_VEHICLES,CTR_KEYS,ctrSlotDefaults,carShape,poseWorld,bodyCorners,wheelPoints,driveStep,
 parseDriveKeys,posesFromKeys,fitPathArcs,posesAlongSegments,posesAlongPath,buildTrajectory,specTableRows,specTableEntities,ctrPreviewSvg,
 DDB_FIELDS,DDB_SHARED_FIELDS,DDB_NAMES,DDB_PRESETS,ddbSlotDefaults,drainProfile,offsetProfile,buildDrainBoard,ddbPreviewSvg,
 HGRID_FIELDS,HGRID_SHARED_FIELDS,squareSpiral,heatCoil,roundCorners,cornerFrame,buildHeatGrid,hgridPreviewSvg} from './site-draw-card.js'

const r6=n=>Math.round(n*1e6)/1e6
const r3=n=>Math.round(n*1e3)/1e3
const ctr=(extra={})=>normalizeValues(CTR_FIELDS,{...defaultsOf(CTR_FIELDS),...extra},'기아 K5')
const ctrShared=normalizeValues(CTR_SHARED_FIELDS,defaultsOf(CTR_SHARED_FIELDS))
const ddb=(extra={})=>normalizeValues(DDB_FIELDS,{...defaultsOf(DDB_FIELDS),...extra},'배수판')
const ddbShared=(extra={})=>normalizeValues(DDB_SHARED_FIELDS,{...defaultsOf(DDB_SHARED_FIELDS),...extra})
const hg=(extra={})=>normalizeValues(HGRID_FIELDS,{...defaultsOf(HGRID_FIELDS),...extra},'간격 200')
const hgShared=normalizeValues(HGRID_SHARED_FIELDS,defaultsOf(HGRID_SHARED_FIELDS))
const xy=e=>e.points.map(p=>[r6(p.x),r6(p.y)])

/* ───────────────────────── CTR ───────────────────────── */

test('CTR 기본값은 원문 대화상자의 기아 K5 제원·이동조건과 같다', () => {
 const v=ctr()
 assert.deepEqual([v.carLength,v.carWidth,v.wheelbase,v.frontTrack,v.rearOverhang,v.minRadius,v.userRadius],[4905,1860,2850,1618,1035,5780,5780])
 assert.equal(v.moveStep,800)   // 이동조건 · 전후진거리
 assert.equal(v.turnAngle,5)    // 이동조건 · 회전 각도
 assert.equal(v.followCar,false)
 assert.equal(v.writeSpec,false)
 assert.deepEqual(ctrSlotDefaults(1),CTR_VEHICLES[1])
 assert.equal(ctrSlotDefaults(1).name,'현대코나')
 assert.equal(ctrSlotDefaults(5).name,'사용자 차량 4')
})

test('CTR 차체 치수: 뒤축을 원점으로 뒤오버행 뒤·앞오버행 앞이 나온다', () => {
 const g=carShape(ctr())
 assert.deepEqual([g.rear,g.front,g.half,g.wheelbase,g.frontOverhang],[-1035,3870,930,2850,1020])
 assert.throws(()=>carShape(ctr({carLength:3000,wheelbase:2850,rearOverhang:1035})),/전장/)
 assert.throws(()=>carShape({carLength:4905,carWidth:1860,wheelbase:0,frontTrack:1618,rearOverhang:1035}),/축간거리/)
 assert.throws(()=>carShape({carLength:4905,carWidth:0,wheelbase:2850,frontTrack:1618,rearOverhang:1035}),/전폭/)
})

test('CTR 차체 외곽: 원점·0도 자세에서 네 모서리 좌표가 그대로 나온다', () => {
 const cs=bodyCorners(ctr(),{x:0,y:0,h:0})
 assert.deepEqual(cs.map(p=>[r6(p.x),r6(p.y)]),[[-1035,-930],[3870,-930],[3870,930],[-1035,930]])
 const w=wheelPoints(ctr(),{x:0,y:0,h:0})
 assert.deepEqual([r6(w.fl.x),r6(w.fl.y)],[2850,809])   // 윤거 앞 1618 의 절반
 assert.deepEqual([r6(w.rr.x),r6(w.rr.y)],[0,-809])
 // 90도로 돌리면 앞쪽이 +y 로 간다
 const t=bodyCorners(ctr(),{x:100,y:200,h:90})
 assert.deepEqual([r6(t[1].x),r6(t[1].y)],[1030,4070])
})

test('CTR poseWorld: 차 좌표(앞쪽 s, 왼쪽 d)를 도면 좌표로 바꾼다', () => {
 assert.deepEqual(poseWorld({x:0,y:0,h:0},100,50),{x:100,y:50})
 const p=poseWorld({x:10,y:20,h:180},100,50)
 assert.deepEqual([r6(p.x),r6(p.y)],[-90,-30])
})

test('CTR driveStep: 직진은 거리만큼, 좌조향은 반경 원 위를 회전각도만큼 돈다', () => {
 assert.deepEqual(driveStep({x:0,y:0,h:0},800,5780,0),{x:800,y:0,h:0})
 // 반경 5780 에서 90도 좌회전: 중심 (0,5780) 기준 사분원
 const q=driveStep({x:0,y:0,h:0},5780*Math.PI/2,5780,1)
 assert.deepEqual([r6(q.x),r6(q.y),r6(q.h)],[5780,5780,90])
 // 같은 조향으로 후진하면 방향이 반대로 돈다
 const b=driveStep({x:0,y:0,h:0},-5780*Math.PI/2,5780,1)
 assert.deepEqual([r6(b.x),r6(b.y),r6(b.h)],[-5780,5780,270])
 // 우조향 전진
 const rr=driveStep({x:0,y:0,h:0},5780*Math.PI/2,5780,-1)
 assert.deepEqual([r6(rr.x),r6(rr.y),r6(rr.h)],[5780,-5780,270])
 assert.throws(()=>driveStep({x:0,y:0,h:0},100,0,1),/회전반경/)
})

test('CTR 키보드 입력표: 원문의 숫자패드와 영문자가 같은 동작에 붙어 있다', () => {
 for(const [num,alpha] of [['7','Q'],['8','W'],['9','E'],['4','A'],['5','S'],['6','D'],['1','Z'],['3','C'],['0','U']])
  assert.equal(CTR_KEYS[num],CTR_KEYS[alpha],`${num} 와 ${alpha} 는 같은 동작`)
 assert.equal(CTR_KEYS['P'],'사용자반경+100')
 assert.equal(CTR_KEYS['M'],'사용자반경-100')
 assert.deepEqual(parseDriveKeys('w q e'),['전진','전좌','전우'])
 assert.deepEqual(parseDriveKeys('890'),['전진','전우','되돌리기'])
 assert.throws(()=>parseDriveKeys('WXW'),/운전 키 "X"/)
 assert.throws(()=>parseDriveKeys('   '),/운전 키 순서/)
})

test('CTR 키 순서 운전: 전진·좌회전·되돌리기가 좌표에 그대로 나온다', () => {
 const v=ctr({moveStep:1000,turnAngle:90,minRadius:2000,userRadius:2000})
 const {poses}=posesFromKeys(v,{x:0,y:0},0,'WQ')
 assert.equal(poses.length,3)
 assert.deepEqual([r6(poses[1].x),r6(poses[1].y),r6(poses[1].h)],[1000,0,0])
 // 반경 2000 · 90도 좌회전 → 중심 (1000,2000) 기준 사분원
 assert.deepEqual([r6(poses[2].x),r6(poses[2].y),r6(poses[2].h)],[3000,2000,90])
 // 되돌리기(U) 는 마지막 한 걸음을 지운다
 assert.equal(posesFromKeys(v,{x:0,y:0},0,'WQU').poses.length,2)
 assert.equal(posesFromKeys(v,{x:0,y:0},0,'UUU').poses.length,1)
})

test('CTR 회전반경 키: 제원반경/사용자반경/P/M 이 반경을 바꾼다', () => {
 const v=ctr({moveStep:1000,turnAngle:90,minRadius:2000,userRadius:3000})
 assert.equal(posesFromKeys(v,{x:0,y:0},0,'1').radius,2000)
 assert.equal(posesFromKeys(v,{x:0,y:0},0,'3').radius,3000)
 assert.equal(posesFromKeys(v,{x:0,y:0},0,'3P').userRadius,3100)
 assert.equal(posesFromKeys(v,{x:0,y:0},0,'3PP').radius,3200)
 // 최소반경 아래로는 내려가지 않는다(원문)
 assert.equal(posesFromKeys(v,{x:0,y:0},0,'3MMMMMMMMMMMMMMM').userRadius,2000)
 assert.throws(()=>posesFromKeys(ctr({minRadius:5780,userRadius:3000}),{x:0,y:0},0,'W'),/최소반경/)
})

test('CTR 경로 맞춤: 직각으로 꺾인 경로에 반경만큼의 원호가 끼워진다', () => {
 const fit=fitPathArcs([{x:0,y:0},{x:10000,y:0},{x:10000,y:10000}],2000)
 assert.equal(fit.stopped,null)
 assert.equal(fit.segments.length,3)
 assert.deepEqual([fit.segments[0].type,fit.segments[1].type,fit.segments[2].type],['line','arc','line'])
 // 90도 꺾임 → 접선길이 = 반경
 assert.deepEqual([r6(fit.segments[0].b.x),r6(fit.segments[0].b.y)],[8000,0])
 const arc=fit.segments[1]
 assert.deepEqual([r6(arc.center.x),r6(arc.center.y)],[8000,2000])
 assert.equal(r6(arc.radius),2000)
 assert.equal(r6(arc.sweep),90)
 assert.deepEqual([r6(fit.segments[2].a.x),r6(fit.segments[2].a.y)],[10000,2000])
 assert.deepEqual([r6(fit.segments[2].b.x),r6(fit.segments[2].b.y)],[10000,10000])
})

test('CTR 경로 맞춤: 반경이 안 나오면 그 꼭짓점에서 멈춘다(원문)', () => {
 // 꺾이는 곳까지 500 밖에 없는데 반경 2000 은 접선길이 2000 이 필요하다
 const fit=fitPathArcs([{x:0,y:0},{x:500,y:0},{x:500,y:9000}],2000)
 assert.equal(fit.stopped,1)
 assert.equal(fit.segments.length,1)
 assert.deepEqual([r6(fit.segments[0].b.x),r6(fit.segments[0].b.y)],[500,0])
 // 되돌아가는(180도) 경로도 멈춘다
 assert.equal(fitPathArcs([{x:0,y:0},{x:9000,y:0},{x:0,y:0.0000001}],2000).stopped,1)
 assert.throws(()=>fitPathArcs([{x:0,y:0}],2000),/둘 이상/)
 assert.throws(()=>fitPathArcs([{x:0,y:0},{x:10,y:0}],0),/회전반경/)
})

test('CTR 자세 뽑기: 직선은 전후진거리마다, 원호는 회전각도마다 나온다', () => {
 const segs=[{type:'line',a:{x:0,y:0},b:{x:2500,y:0}}]
 const poses=posesAlongSegments(segs,1000,5)
 assert.deepEqual(poses.map(p=>[r6(p.x),r6(p.h)]),[[0,0],[1000,0],[2000,0],[2500,0]])
 const arc=[{type:'arc',center:{x:0,y:0},radius:1000,start:0,sweep:90,side:1}]
 const ap=posesAlongSegments(arc,1000,30)
 assert.equal(ap.length,4)
 assert.deepEqual([r6(ap[0].x),r6(ap[0].y),r6(ap[0].h)],[1000,0,90])
 assert.deepEqual([r6(ap[3].x),r6(ap[3].y),r6(ap[3].h)],[0,1000,180])
 assert.throws(()=>posesAlongSegments(segs,0,5),/전후진거리/)
 assert.throws(()=>posesAlongSegments(segs,10,0),/회전 각도/)
})

test('CTR 궤적 객체: 자세마다 차체 하나 + 바퀴 4줄 + 차체 모서리 4줄', () => {
 const v=ctr()
 const {poses,stopped}=posesAlongPath(v,[{x:0,y:0},{x:30000,y:0},{x:30000,y:30000}],6000)
 assert.equal(stopped,null)
 const r=buildTrajectory(v,ctrShared,poses)
 assert.equal(r.tracks,8)
 assert.equal(r.bodies,poses.length)
 assert.equal(r.entities.length,poses.length+8)
 const bodies=r.entities.filter(e=>e.cardLayer===SITE_LAYERS.body)
 assert.equal(bodies.length,poses.length)
 assert.ok(bodies.every(e=>e.type==='polyline'&&e.closed===true&&e.points.length===4))
 const tracks=r.entities.filter(e=>e.cardLayer===SITE_LAYERS.track)
 assert.equal(tracks.length,8)
 assert.ok(tracks.every(e=>e.closed===false&&e.points.length===poses.length))
 // 첫 차체는 시작점에 0도로 놓인다
 assert.deepEqual(xy(bodies[0]),[[-1035,-930],[3870,-930],[3870,930],[-1035,930]])
 assert.throws(()=>buildTrajectory(v,ctrShared,[{x:0,y:0,h:0}]),/둘 이상/)
})

test('CTR 제원쓰기: 원문 문자표의 일곱 줄 이름과 값이 그대로 들어간다', () => {
 const v=ctr()
 assert.deepEqual(specTableRows(v,'현대코나').map(r=>r[0]),['이름','전체길이','전체폭','앞뒤바퀴간격','앞바퀴간격','뒤오버행','최소회전반경'])
 assert.deepEqual(specTableRows(v,'기아 K5').map(r=>r[1]),['기아 K5','4905','1860','2850','1618','1035','5780'])
 const t=specTableEntities(v,ctrShared,{x:0,y:0},'기아 K5',100)
 assert.equal(t.textHeight,100)
 assert.equal(r6(t.width),1300)          // 700 + 600
 assert.equal(r6(t.height),1260)         // 180 × 7줄
 const lines=t.entities.filter(e=>e.type==='line')
 assert.equal(lines.length,8+3)          // 가로 8줄 + 세로 3줄
 assert.ok(lines.every(e=>e.cardLayer===SITE_LAYERS.symb))
 const texts=t.entities.filter(e=>e.type==='text')
 assert.equal(texts.length,14)
 assert.ok(texts.every(e=>e.cardLayer===SITE_LAYERS.text))
 assert.deepEqual([r6(texts[0].position.x),r6(texts[0].position.y),texts[0].text,texts[0].align],[40,-90,'이름','left'])
 assert.deepEqual([r6(texts[1].position.x),texts[1].text,texts[1].align],[1260,'기아 K5','right'])
})

test('CTR 미리보기 SVG 가 만들어진다', () => {
 const svg=ctrPreviewSvg(ctr(),ctrShared,{width:200,height:100})
 assert.match(svg,/^<svg /)
 assert.match(svg,/기아 K5|전장 4905/)
})

/* ───────────────────────── DDB ───────────────────────── */

test('DDB 다섯 칸은 원문 구분표의 이름과 숫자 그대로다', () => {
 assert.deepEqual([...DDB_NAMES],['배수판','데크1','데크2','골판1','골판2'])
 assert.deepEqual(ddbSlotDefaults(0),{topLength:20,slopeLength:10,bottomLength:20,plateThickness:2})
 assert.deepEqual(ddbSlotDefaults(1),{topLength:10,slopeLength:10,bottomLength:600,plateThickness:1})
 assert.deepEqual(ddbSlotDefaults(2),{topLength:30,slopeLength:30,bottomLength:900,plateThickness:1})
 assert.deepEqual(ddbSlotDefaults(3),{topLength:60,slopeLength:30,bottomLength:60,plateThickness:1})
 assert.deepEqual(ddbSlotDefaults(4),{topLength:100,slopeLength:30,bottomLength:100,plateThickness:1})
 assert.equal(DDB_PRESETS.length,5)
 const s=ddbShared()
 assert.equal(s.totalHeight,50)        // 원문 [전체높이] 기본값
 assert.equal(s.screenHeight,false)
 assert.equal(s.cutToLength,true)
})

test('DDB 단면선: 하판 → 경사 → 상판 → 경사 로 한 주기가 돈다', () => {
 // 한 주기 = 20 + 10 + 20 + 10 = 60
 const pts=drainProfile(ddb(),120,50,true)
 assert.deepEqual(pts,[[0,0],[20,0],[30,50],[50,50],[60,0],[80,0],[90,50],[110,50],[120,0]])
})

test('DDB [길이에 맞춰 절단]: 켜면 지정 길이에서 자르고 끄면 온전한 주기까지만 그린다', () => {
 const cut=drainProfile(ddb(),100,50,true)
 assert.deepEqual(cut.at(-1),[100,50])        // 상판 한가운데에서 잘린다
 const keep=drainProfile(ddb(),100,50,false)
 assert.deepEqual(keep.at(-1),[60,0])         // 온전한 한 주기(60)까지
 // 경사 중간에서 잘리면 높이도 사이값이 된다
 assert.deepEqual(drainProfile(ddb(),25,50,true).at(-1),[25,25])
 assert.throws(()=>drainProfile(ddb({topLength:0,slopeLength:0,bottomLength:0}),100,50,true),/0 으로 둘 수는/)
 assert.throws(()=>drainProfile(ddb(),0,50,true),/시작점과 끝점/)
 assert.throws(()=>drainProfile(ddb(),100,0,true),/전체높이/)
})

test('DDB 판두께: 꺾은선을 각 이등분선으로 평행 이동한다', () => {
 // 곧은 선은 그대로 평행 이동
 assert.deepEqual(offsetProfile([[0,0],[100,0]],-2),[[0,-2],[100,-2]])
 // 직각으로 꺾이면 모서리는 각 이등분선(대각선)만큼 움직인다
 const o=offsetProfile([[0,0],[100,0],[100,100]],-2)
 assert.deepEqual(o.map(p=>[r6(p[0]),r6(p[1])]),[[0,-2],[102,-2],[102,100]])
 assert.throws(()=>offsetProfile([[0,0]],-2),/둘 이상/)
})

test('DDB 객체: 두께가 있으면 닫힌 단면 하나, 0 이면 단선 하나', () => {
 const f={origin:{x:0,y:0},u:{x:1,y:0},n:{x:0,y:1},t:80,angle:0,flip:1}
 const solid=buildDrainBoard(f,120,ddb(),ddbShared())
 assert.equal(solid.entities.length,1)
 assert.equal(solid.single,false)
 assert.equal(solid.height,50)
 assert.equal(solid.period,60)
 const e=solid.entities[0]
 assert.equal(e.type,'polyline');assert.equal(e.closed,true);assert.equal(e.cardLayer,SITE_LAYERS.board)
 assert.equal(e.points.length,18)                  // 바깥 9점 + 안쪽 9점
 assert.deepEqual([r6(e.points[0].x),r6(e.points[0].y)],[0,0])
 assert.deepEqual([r6(e.points[8].x),r6(e.points[8].y)],[120,0])
 // 안쪽 선은 바깥 선을 두께만큼 기준선 쪽으로 민 것이다(되돌아오므로 마지막 점이 0번 점의 짝)
 assert.deepEqual([r6(e.points.at(-1).x),r6(e.points.at(-1).y)],[0,-2])
 const thin=buildDrainBoard(f,120,ddb({plateThickness:0}),ddbShared())
 assert.equal(thin.single,true)
 assert.equal(thin.entities[0].closed,false)
 assert.equal(thin.entities[0].points.length,9)
})

test('DDB [화면에서 높이지정]: 켜면 셋째 점까지의 거리가 전체높이가 된다', () => {
 const f={origin:{x:0,y:0},u:{x:1,y:0},n:{x:0,y:1},t:80,angle:0,flip:1}
 assert.equal(buildDrainBoard(f,120,ddb(),ddbShared({screenHeight:true})).height,80)
 assert.equal(buildDrainBoard(f,120,ddb(),ddbShared({screenHeight:false,totalHeight:35})).height,35)
 const top=buildDrainBoard(f,120,ddb(),ddbShared({screenHeight:true})).entities[0].points[2]
 assert.deepEqual([r6(top.x),r6(top.y)],[30,80])
})

test('DDB 미리보기 SVG 가 만들어진다', () => {
 assert.match(ddbPreviewSvg(ddb(),ddbShared(),{width:200,height:100}),/^<svg /)
})

/* ───────────────────────── HGRID ───────────────────────── */

test('HGRID 사각 나선: 시작 모서리에서 나가 pitch 씩 좁혀 든다', () => {
 const s=squareSpiral(1000,800,200,0)
 assert.deepEqual(s[0],[0,0])
 assert.deepEqual(s[1],[1000,0])     // 1번 점에서 +s 방향으로 먼저 간다
 assert.deepEqual(s[2],[1000,800])
 assert.deepEqual(s[3],[0,800])
 assert.deepEqual(s[4],[0,200])      // 아래 변이 200 올라갔다
 assert.deepEqual(s[5],[800,200])
 // inset 을 주면 그만큼 안쪽에서 시작한다
 assert.deepEqual(squareSpiral(1000,800,200,100)[0],[100,100])
 assert.deepEqual(squareSpiral(1000,800,200,100)[1],[900,100])
 // 간격보다 작은 칸은 아무것도 못 그린다
 assert.deepEqual(squareSpiral(1000,800,200,500),[])
 assert.throws(()=>squareSpiral(0,800,200,0),/가로·세로/)
 assert.throws(()=>squareSpiral(1000,800,0,0),/파이프 간격/)
})

test('HGRID 되돌림 나선: 들어가는 줄과 나오는 줄이 한 칸씩 엇갈리고 끝이 시작 모서리에 온다', () => {
 const g=200,c=heatCoil(4000,3000,g)
 assert.deepEqual(c[0],[0,0])                 // 한쪽 끝 = 1번 점 모서리
 assert.deepEqual(c.at(-1),[g,g])             // 다른 쪽 끝 = 그 옆(간격만큼 안쪽)
 // 두 줄이 간격만큼 엇갈린다: 아래 변을 지나는 줄들의 높이
 const lows=[...new Set(c.map(p=>p[1]))].sort((a,b)=>a-b)
 assert.deepEqual(lows.slice(0,4),[0,200,400,600])
 assert.ok(c.length>20)
 assert.throws(()=>heatCoil(100,100,200),/작습니다/)
})

test('HGRID 모서리 둥글리기: 직각 모서리가 반지름만큼 물러난 호로 바뀐다', () => {
 const out=roundCorners([[0,0],[1000,0],[1000,1000]],100,4)
 assert.deepEqual(out[0],[0,0])
 assert.deepEqual([r3(out[1][0]),r3(out[1][1])],[900,0])        // 접점 = 모서리에서 반지름만큼 앞
 assert.deepEqual([r3(out.at(-2)[0]),r3(out.at(-2)[1])],[1000,100])
 assert.deepEqual(out.at(-1),[1000,1000])
 assert.equal(out.length,1+1+4+1)                                // 시작 + 접점 + 호 4토막 + 끝
 // 호 위 한가운데 점은 중심 (900,100) 에서 반지름 100
 const mid=out[3]
 assert.equal(r3(Math.hypot(mid[0]-900,mid[1]-100)),100)
 // 꺾이지 않은 선은 그대로
 assert.deepEqual(roundCorners([[0,0],[100,0]],50),[[0,0],[100,0]])
})

test('HGRID 두 점: 1번 점이 시작 모서리이고 방향이 바뀌면 좌표계가 뒤집힌다', () => {
 const a=cornerFrame({x:0,y:0},{x:4000,y:3000})
 assert.deepEqual([a.width,a.depth],[4000,3000])
 assert.deepEqual(a.frame.origin,{x:0,y:0})
 assert.deepEqual([a.frame.u,a.frame.n],[{x:1,y:0},{x:0,y:1}])
 const b=cornerFrame({x:4000,y:3000},{x:0,y:0})
 assert.deepEqual(b.frame.origin,{x:4000,y:3000})
 assert.deepEqual([b.frame.u,b.frame.n],[{x:-1,y:0},{x:0,y:-1}])
 assert.throws(()=>cornerFrame({x:0,y:0},{x:0,y:3000}),/마주 보는 모서리/)
})

test('HGRID 객체: 파이프 한 줄이 1번 점에서 시작해 되돌아 나온다', () => {
 const v=hg(),r=buildHeatGrid({x:1000,y:2000},{x:5000,y:5000},v,hgShared)
 assert.deepEqual([r.width,r.depth],[4000,3000])
 assert.equal(r.entities.length,1)
 const e=r.entities[0]
 assert.equal(e.type,'polyline');assert.equal(e.closed,false);assert.equal(e.cardLayer,SITE_LAYERS.pipe)
 // 첫 점은 1번 점 그대로
 assert.deepEqual([r6(e.points[0].x),r6(e.points[0].y)],[1000,2000])
 // 마지막 점은 간격만큼 안쪽(되돌아 나온 끝)
 assert.deepEqual([r6(e.points.at(-1).x),r6(e.points.at(-1).y)],[1200,2200])
 // 모든 점은 사각형 안에 있다
 assert.ok(e.points.every(p=>p.x>=999.99&&p.x<=5000.01&&p.y>=1999.99&&p.y<=5000.01))
 assert.ok(e.points.length>50)
 // 2번 점을 반대 모서리로 잡으면 파이프도 거기서 시작한다
 const flip=buildHeatGrid({x:5000,y:5000},{x:1000,y:2000},v,hgShared)
 assert.deepEqual([r6(flip.entities[0].points[0].x),r6(flip.entities[0].points[0].y)],[5000,5000])
})

test('HGRID 간격을 넓히면 파이프 줄 수가 준다', () => {
 const wide=buildHeatGrid({x:0,y:0},{x:4000,y:3000},hg({spacing:400}),hgShared)
 const tight=buildHeatGrid({x:0,y:0},{x:4000,y:3000},hg({spacing:200}),hgShared)
 assert.ok(tight.entities[0].points.length>wide.entities[0].points.length)
 assert.throws(()=>buildHeatGrid({x:0,y:0},{x:300,y:200},hg({spacing:400}),hgShared),/작습니다/)
})

test('HGRID 미리보기 SVG 가 만들어진다', () => {
 assert.match(hgridPreviewSvg(hg(),hgShared,{width:200,height:100}),/^<svg /)
})

/* ───────────────────────── 공통 ───────────────────────── */

test('켜 기본값이 표준 이름이다', () => {
 assert.deepEqual({...SITE_LAYERS},{body:'A-SITE',track:'A-SITE-ROAD',symb:'A-SYM',text:'A-TEXT',board:'A-WALL-FNSH',pipe:'A-PLMB'})
 assert.equal(ctrShared.bodyLayer,'A-SITE')
 assert.equal(ctrShared.trackLayer,'A-SITE-ROAD')
 assert.equal(ddbShared().boardLayer,'A-WALL-FNSH')
 assert.equal(hgShared.pipeLayer,'A-PLMB')
})

test('dedupePoints 는 이어진 같은 점을 지운다', () => {
 assert.deepEqual(dedupePoints([{x:0,y:0},{x:0,y:0},{x:1,y:0}]),[{x:0,y:0},{x:1,y:0}])
 assert.deepEqual(dedupePoints([]),[])
})
