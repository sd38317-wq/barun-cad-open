// 커튼월 창호 카드 CW(xiCWALL, izzarder.com/164) 기하 시험. 화면 없이 순수 함수만 돌린다.
import test from 'node:test'
import assert from 'node:assert/strict'
import {normalizeValues,defaultsOf,loadCardState} from './card-kit.js'
import {CURTAINWALL_FIELDS,CURTAINWALL_SHARED_FIELDS,CURTAINWALL_STORAGE_KEY,CURTAINWALL_SLOTS,CURTAINWALL_FIXED_NAMES,curtainSlotDefaults,
 dedupe,barProfile,glassBand,barCenters,runStations,buildStraightCurtainWall,arcRun,buildCurvedCurtainWall,buildCurtainWall,curtainWallPreviewSvg} from './curtainwall-card.js'

const v=(extra={},name='CW')=>normalizeValues(CURTAINWALL_FIELDS,{...defaultsOf(CURTAINWALL_FIELDS),...extra},name)
const shared={barLayer:'A-GLAZ',glassLayer:'A-GLAZ',elevLayer:'A-GLAZ'}
const r2=n=>{const x=Math.round(n*100)/100;return x===0?0:x}
const P=e=>e.points.map(p=>[r2(p.x),r2(p.y)])
// 세 켜 기본값이 모두 A-GLAZ 라 켜로는 못 가른다. 미리보기 색으로 역할을 가른다.
const COLOR={bar:'#6ec6ff',glass:'#7ee787',elev:'#d0d0d0'}
const only=(b,role)=>b.entities.filter(e=>e.previewColor===COLOR[role])
// 원문 예시: 두 점 사이를 6등분하니 한 칸이 717.21mm 였다.
const RUN=717.21*6

test('원문 기본값: 대화상자 기본값이 원문 그림과 같다 (커튼월·6등분·바 60×150·CAP 60×30·유리 24)', () => {
  const d=defaultsOf(CURTAINWALL_FIELDS)
  assert.equal(d.kind,'curtain');assert.equal(d.divisions,6);assert.equal(d.barBase,'inside')
  assert.equal(d.barWidth,60);assert.equal(d.barDepth,150)
  assert.equal(d.cap,true);assert.equal(d.capWidth,60);assert.equal(d.capDepth,30)
  assert.equal(d.glass,24);assert.equal(d.curveGlassStraight,false);assert.equal(d.curveBarStraight,false)
  assert.equal(d.recycle,false);assert.equal(d.runMode,'dialog')
  assert.deepEqual(defaultsOf(CURTAINWALL_SHARED_FIELDS),{barLayer:'A-GLAZ',glassLayer:'A-GLAZ',elevLayer:'A-GLAZ'})
})

test('이어진 같은 점 지우기', () => {
  assert.deepEqual(dedupe([[0,0],[0,0],[1,0],[1,0],[1,1],[0,0]]),[[0,0],[1,0],[1,1]])
})

test('커튼월 바 단면(CAP 없음): 유리 자리에서 목이 좁아지고 바 바깥면에서 닫힌다', () => {
  const p=barProfile(v({kind:'curtain',cap:false}))
  assert.deepEqual(p,[[-30,0],[30,0],[30,102],[10,102],[10,126],[30,126],[30,150],[-30,150],[-30,126],[-10,126],[-10,102],[-30,102]])
})

test('커튼월 바 단면(CAP 있음): 유리 바깥면에서 캡 바가 세로 30 만큼 더 나간다', () => {
  const p=barProfile(v({kind:'curtain',cap:true}))
  assert.deepEqual(p,[[-30,0],[30,0],[30,102],[10,102],[10,126],[30,126],[30,156],[-30,156],[-30,126],[-10,126],[-10,102],[-30,102]])
  // CAP 을 켜면 바 바깥면(150)은 캡으로 대체되어 따로 긋지 않는다 (원문 그림).
  assert.ok(!p.some(([,d])=>d===150))
  // CAP 가로를 줄이면 캡만 좁아진다
  assert.deepEqual(barProfile(v({kind:'curtain',cap:true,capWidth:40})).filter(([,d])=>d===156),[[20,156],[-20,156]])
})

test('고정창 바 단면: CAP 과 목 없이 바 크기 그대로의 사각형', () => {
  assert.deepEqual(barProfile(v({kind:'fixed',cap:true})),[[-30,0],[30,0],[30,150],[-30,150]])
})

test('유리 두께 0: 유리선이 없고 단면이 단순해진다 (원문 "유리 두께 0 으로 입력")', () => {
  assert.equal(glassBand(v({glass:0})),null)
  assert.deepEqual(barProfile(v({kind:'curtain',cap:false,glass:0})),[[-30,0],[30,0],[30,150],[-30,150]])
  assert.deepEqual(barProfile(v({kind:'curtain',cap:true,glass:0})),[[-30,0],[30,0],[30,150],[30,180],[-30,180],[-30,150]])
  const b=buildStraightCurtainWall({x:0,y:0},{x:RUN,y:0},v({glass:0,cap:false}),shared)
  assert.equal(only(b,'glass').length,0)
})

test('유리 자리: 커튼월은 바 바깥면 쪽, 고정창은 두께 한가운데', () => {
  assert.deepEqual(glassBand(v({kind:'curtain'})),[102,126])
  assert.deepEqual(glassBand(v({kind:'fixed'})),[63,87])
})

test('등분과 바 위치: 원문 예시 6등분 간격 717.21mm', () => {
  const a=barCenters(v({divisions:6,barBase:'on'}),RUN)
  assert.equal(r2(a.step),717.21);assert.equal(a.divisions,6);assert.equal(a.centers.length,7)
  assert.equal(a.centers[0],0);assert.equal(r2(a.centers[6]),r2(RUN))
  assert.equal(r2(a.centers[1]),717.21)
  // 선택 점 안쪽에 삽입: 양끝 바만 반 폭씩 안으로 (가운데 바는 그대로)
  const b=barCenters(v({divisions:6,barBase:'inside'}),RUN)
  assert.equal(b.centers[0],30);assert.equal(r2(b.centers[6]),r2(RUN-30))
  assert.equal(r2(b.centers[3]),r2(a.centers[3]))
  assert.throws(()=>barCenters(v({divisions:200}),RUN),/등분 간격/)
  assert.throws(()=>barCenters(v(),0),/시작점과 끝점이 같습니다/)
})

test('길게 잇는 선의 마디: 입면선은 양끝 바 안쪽면, 커튼월 유리는 양끝 바 중간에서 시작', () => {
  const {centers}=barCenters(v({divisions:2,barBase:'on'}),2000)
  assert.deepEqual(runStations(v({kind:'curtain'}),centers,'elev'),[30,1000,1970])
  assert.deepEqual(runStations(v({kind:'curtain'}),centers,'glass'),[0,1000,2000])
  assert.deepEqual(runStations(v({kind:'fixed'}),centers,'glass'),[30,1000,1970])
})

test('직선 커튼월: 실외는 시작점→끝점의 오른쪽 (시계반대방향 원칙)', () => {
  const b=buildStraightCurtainWall({x:0,y:0},{x:RUN,y:0},v({divisions:6,barBase:'inside',cap:false}),shared)
  assert.equal(b.curved,false);assert.equal(b.divisions,6);assert.equal(r2(b.step),717.21);assert.equal(r2(b.length),r2(RUN))
  const bars=b.entities.filter(e=>e.type==='polyline')
  assert.equal(bars.length,7)
  // 첫 바: 바깥면이 시작점에 딱 맞고, 실외(유리·CAP 쪽)는 −y 이다
  assert.deepEqual(P(bars[0])[0],[0,0])
  assert.deepEqual(P(bars[0])[6],[60,-150])
  assert.ok(bars.every(e=>e.points.every(p=>p.y<=0)))
  // 마지막 바: 바깥면이 끝점에 맞는다
  assert.deepEqual(P(bars[6])[1],[r2(RUN),0])
  const glass=only(b,'glass')
  assert.equal(glass.length,2)
  assert.deepEqual(P(glass[0]),[[30,-102],[r2(RUN-30),-102]])
  assert.deepEqual(P(glass[1]),[[30,-126],[r2(RUN-30),-126]])
  const elev=only(b,'elev')
  assert.equal(elev.length,1)
  assert.deepEqual(P(elev[0]),[[60,0],[r2(RUN-60),0]])
  assert.equal(b.entities.length,10)
})

test('직선 커튼월: 바 삽입 기준을 바꾸면 양끝 바가 선택 점에 걸친다', () => {
  const b=buildStraightCurtainWall({x:0,y:0},{x:RUN,y:0},v({divisions:6,barBase:'on',cap:false}),shared)
  const bars=b.entities.filter(e=>e.type==='polyline')
  assert.deepEqual(P(bars[0])[0],[-30,0])
  assert.deepEqual(P(bars[6])[1],[r2(RUN+30),0])
})

test('직선 커튼월: 방향을 뒤집으면 실외도 반대쪽이 된다', () => {
  const b=buildStraightCurtainWall({x:RUN,y:0},{x:0,y:0},v({divisions:6,cap:false}),shared)
  assert.ok(b.entities.filter(e=>e.type==='polyline').every(e=>e.points.every(p=>p.y>=0)))
})

test('고정창: 입면선이 양쪽 면에 두 줄, 유리는 한가운데', () => {
  const b=buildStraightCurtainWall({x:0,y:0},{x:4000,y:0},v({kind:'fixed',divisions:4,barBase:'inside'}),shared)
  assert.equal(b.entities.filter(e=>e.type==='polyline').length,5)
  const lines=[...only(b,'glass'),...only(b,'elev')].map(e=>P(e))
  // 고정창은 유리도 양끝 바 안쪽면에서 시작한다(원문 그림)
  assert.deepEqual(lines,[[[60,-63],[3940,-63]],[[60,-87],[3940,-87]],[[60,0],[3940,0]],[[60,-150],[3940,-150]]])
  assert.equal(b.entities.length,9)
})

test('호 정보: 세 점 중 셋째가 호의 중간점이고 실외는 원 바깥이 된다', () => {
  const run=arcRun({x:0,y:0},{x:1000,y:1000},{x:0,y:2000})
  assert.deepEqual([r2(run.center.x),r2(run.center.y)],[0,1000])
  assert.equal(r2(run.radius),1000)
  assert.equal(r2(run.sweep),180)
  assert.equal(run.sign,1)
  assert.equal(r2(run.length),r2(Math.PI*1000))
  // 반대로 돌면 실외도 원 안쪽으로 바뀐다
  assert.equal(arcRun({x:0,y:2000},{x:1000,y:1000},{x:0,y:0}).sign,-1)
  assert.throws(()=>arcRun({x:0,y:0},{x:500,y:0},{x:1000,y:0}),/일직선/)
})

test('곡면 커튼월: 바는 곧은 막대로 방사로 서고 유리·입면선은 호가 된다', () => {
  const b=buildCurvedCurtainWall({x:0,y:0},{x:0,y:2000},{x:1000,y:1000},v({divisions:4,barBase:'on',cap:false}),shared)
  assert.equal(b.curved,true);assert.equal(r2(b.radius),1000)
  assert.equal(r2(b.step),r2(Math.PI*1000/4))
  const bars=b.entities.filter(e=>e.type==='polyline')
  assert.equal(bars.length,5)
  // 첫 바의 중간은 시작점, 마지막 바의 중간은 끝점
  assert.deepEqual(P(bars[0])[0],[-30,0]);assert.deepEqual(P(bars[0])[1],[30,0])
  assert.deepEqual(P(bars[4])[0],[30,2000]);assert.deepEqual(P(bars[4])[1],[-30,2000])
  // 실외는 원 바깥: 바 바깥면 꼭짓점이 반지름보다 멀다
  const far=bars[0].points[6]
  assert.ok(Math.hypot(far.x-b.center.x,far.y-b.center.y)>1000)
  const arcs=b.entities.filter(e=>e.type==='arc')
  assert.equal(arcs.length,3)
  assert.deepEqual(arcs.map(e=>r2(e.radius)),[1102,1126,1000])
  // 입면선 호는 양끝 바 안쪽면(바 반 폭 30mm = 1.72°)에서 시작해 끝난다
  assert.equal(r2(arcs[2].startAngle),271.72);assert.equal(r2(arcs[2].endAngle),88.28)
  // 유리 호는 양끝 바 중간, 곧 시작점·끝점 각도에서 끝난다
  assert.equal(r2(arcs[0].startAngle),270);assert.equal(r2(arcs[0].endAngle),90)
  assert.equal(b.entities.length,8)
  // 실외가 원 안쪽(sign −1)인데 창호 깊이가 반지름보다 크면 막는다
  assert.throws(()=>buildCurvedCurtainWall({x:0,y:2000},{x:0,y:0},{x:1000,y:1000},v({barDepth:1200,cap:false}),shared),/반지름/)
})

test('곡면: 직선 표현 체크박스를 켜면 호가 현(직선)으로 바뀐다', () => {
  const pts=[{x:0,y:0},{x:0,y:2000},{x:1000,y:1000}]
  const g=buildCurtainWall(pts,v({divisions:4,barBase:'on',cap:false,curveGlassStraight:true}),shared)
  assert.equal(g.entities.filter(e=>e.type==='arc').length,1)          // 입면선만 호
  assert.equal(g.entities.filter(e=>e.type==='line').length,8)          // 유리 2줄 × 4구간
  const both=buildCurtainWall(pts,v({divisions:4,barBase:'on',cap:false,curveGlassStraight:true,curveBarStraight:true}),shared)
  assert.equal(both.entities.filter(e=>e.type==='arc').length,0)
  assert.equal(both.entities.filter(e=>e.type==='line').length,12)      // 유리 8 + 입면선 4
})

test('점 갯수로 직선·곡면을 가른다 (셋째 점 생략 = 직선)', () => {
  assert.equal(buildCurtainWall([{x:0,y:0},{x:4000,y:0}],v(),shared).curved,false)
  assert.equal(buildCurtainWall([{x:0,y:0},{x:0,y:2000},{x:1000,y:1000}],v(),shared).curved,true)
  assert.throws(()=>buildCurtainWall([{x:0,y:0}],v(),shared),/시작점과 끝점/)
})

test('칸 저장: 2번 칸은 고정창으로 시작하고 켜는 표준 이름만 쓴다', () => {
  const store=new Map()
  const storage={getItem:k=>store.get(k)??null,setItem:(k,x)=>store.set(k,x)}
  const state=loadCardState(storage,CURTAINWALL_STORAGE_KEY,{fields:CURTAINWALL_FIELDS,sharedFields:CURTAINWALL_SHARED_FIELDS,slots:CURTAINWALL_SLOTS,fixedNames:CURTAINWALL_FIXED_NAMES,slotDefaults:curtainSlotDefaults})
  assert.equal(state.presets.length,4)
  assert.equal(state.presets[0].name,'CW 커튼월');assert.equal(state.presets[0].kind,'curtain')
  assert.equal(state.presets[1].name,'CW 고정창');assert.equal(state.presets[1].kind,'fixed')
  assert.equal(state.presets[1].cap,false);assert.equal(state.presets[1].divisions,4)
  for(const l of Object.values(state.shared))assert.ok(['A-GLAZ','A-WALL'].includes(l))
})

test('미리보기 SVG 가 만들어진다', () => {
  const svg=curtainWallPreviewSvg(v(),shared)
  assert.ok(svg.startsWith('<svg'));assert.ok(svg.includes('커튼월 6등분'))
  assert.ok(curtainWallPreviewSvg(v({kind:'fixed'}),shared,{width:64,height:34,compact:true}).includes('<svg'))
})
