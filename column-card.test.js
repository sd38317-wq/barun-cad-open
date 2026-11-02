// 기둥 그리기 카드 COL 기하 시험(izzarder.com/189). 화면 없이 순수 함수만 돌린다.
import test from 'node:test'
import assert from 'node:assert/strict'
import {normalizeValues,defaultsOf} from './card-kit.js'
import {COLUMN_FIELDS,COLUMN_SHARED_FIELDS,COLUMN_LAYERS,columnSlotDefaults,columnGeometry,columnCenter,columnRotation,
 hSectionPoints,steelSize,autoSteelThickness,columnSummary,columnPreviewSvg} from './column-card.js'

const v=(extra={})=>normalizeValues(COLUMN_FIELDS,{...defaultsOf(COLUMN_FIELDS),...extra},'t')
const shared=normalizeValues(COLUMN_SHARED_FIELDS,defaultsOf(COLUMN_SHARED_FIELDS))
const xy=e=>e.points.map(p=>[Math.round(p.x*1e6)/1e6,Math.round(p.y*1e6)/1e6])

test('RC 사각: 삽입점이 단면 중심이고 가로·세로가 그대로 나온다', () => {
 const r=columnGeometry(v({kind:'rc',shape:'rect',concWidth:600,concDepth:400}),shared,{x:1000,y:2000})
 assert.equal(r.entities.length,1)
 const e=r.entities[0]
 assert.equal(e.type,'polyline');assert.equal(e.closed,true);assert.equal(e.cardLayer,COLUMN_LAYERS.conc)
 assert.deepEqual(xy(e),[[700,1800],[1300,1800],[1300,2200],[700,2200]])
})

test('RC 원형: 가로를 지름으로 쓰고 세로는 쓰지 않는다', () => {
 const r=columnGeometry(v({kind:'rc',shape:'circle',concWidth:600,concDepth:4000}),shared,{x:0,y:0})
 assert.equal(r.entities.length,1)
 assert.deepEqual(r.entities[0],{type:'circle',center:{x:0,y:0},radius:300,cardLayer:'A-COL'})
})

test('편심: 중심이 삽입점에서 가로·세로만큼 벗어난다', () => {
 const val=v({kind:'rc',shape:'rect',concWidth:600,concDepth:600,eccX:100,eccY:-50})
 assert.deepEqual(columnCenter(val,{x:1000,y:1000}),{x:1100,y:950})
 const r=columnGeometry(val,shared,{x:1000,y:1000})
 assert.deepEqual(r.center,{x:1100,y:950})
 assert.deepEqual(xy(r.entities[0]),[[800,650],[1400,650],[1400,1250],[800,1250]])
})

test('철골 H 단면 12점: 플랜지는 위·아래 수평, 웨브는 가운데 수직', () => {
 // 가로 300 · 세로 300 · Web 5 · Flg 9 (원문 대화상자 기본값)
 assert.deepEqual(hSectionPoints(300,300,5,9),
  [[-150,-150],[150,-150],[150,-141],[2.5,-141],[2.5,141],[150,141],[150,150],[-150,150],[-150,141],[-2.5,141],[-2.5,-141],[-150,-141]])
})

test('철골만: 콘크리트 단면 없이 철골켜에 H 단면 하나만 그린다', () => {
 const r=columnGeometry(v({kind:'steel',steelWidth:300,steelDepth:300,web:5,flange:9}),shared,{x:0,y:0})
 assert.equal(r.entities.length,1)
 assert.equal(r.entities[0].cardLayer,COLUMN_LAYERS.steel)
 assert.equal(r.entities[0].points.length,12)
 assert.deepEqual(xy(r.entities[0])[0],[-150,-150])
})

test('SRC: 콘크리트 단면 + 철골 단면 두 개, 철골이 콘크리트 중심에 놓인다', () => {
 const r=columnGeometry(v({kind:'src',shape:'rect',concWidth:600,concDepth:600,steelWidth:300,steelDepth:300,web:5,flange:9}),shared,{x:500,y:500})
 assert.equal(r.entities.length,2)
 assert.deepEqual(r.entities.map(e=>e.cardLayer),['A-COL','A-COL'])
 const box=xy(r.entities[0]),h=xy(r.entities[1])
 assert.deepEqual(box,[[200,200],[800,200],[800,800],[200,800]])
 const cx=(Math.min(...h.map(p=>p[0]))+Math.max(...h.map(p=>p[0])))/2
 const cy=(Math.min(...h.map(p=>p[1]))+Math.max(...h.map(p=>p[1])))/2
 assert.deepEqual([cx,cy],[500,500])
 assert.equal(Math.max(...h.map(p=>p[0]))-Math.min(...h.map(p=>p[0])),300)
})

test('철골회전각도: 각도고정 90도는 철골만 돌리고 콘크리트는 그대로 둔다', () => {
 const r=columnGeometry(v({kind:'src',shape:'rect',concWidth:600,concDepth:400,steelWidth:300,steelDepth:300,web:5,flange:9,angleMode:'fixed',rotation:90}),shared,{x:0,y:0})
 assert.deepEqual(xy(r.entities[0]),[[-300,-200],[300,-200],[300,200],[-300,200]])  // 콘크리트는 축에 나란함
 assert.deepEqual(xy(r.entities[1])[0],[150,-150])   // (-150,-150) 을 90도 돌린 값
 assert.deepEqual(xy(r.entities[1])[1],[150,150])    // (150,-150) 을 90도 돌린 값
 assert.equal(r.rotation,90)
})

test('철골회전각도: 화면에서 지정은 찍은 각을 쓰고, RC 는 언제나 0 이다', () => {
 assert.equal(columnRotation(v({kind:'steel',angleMode:'screen'}),30),30)
 assert.equal(columnRotation(v({kind:'steel',angleMode:'screen'}),-30),330)
 assert.equal(columnRotation(v({kind:'steel',angleMode:'screen'}),null),0)
 assert.equal(columnRotation(v({kind:'steel',angleMode:'fixed',rotation:45}),999),45)
 assert.equal(columnRotation(v({kind:'rc',rotation:45}),90),0)
})

test('자동: KS 표준 H형강 표에서 가장 가까운 규격의 Web·Flg 를 쓴다', () => {
 assert.deepEqual(autoSteelThickness(300,300),{web:10,flange:15,h:300,b:300})
 assert.deepEqual(autoSteelThickness(198,402),{web:8,flange:13,h:400,b:200})
 const s=steelSize(v({kind:'steel',steelWidth:300,steelDepth:300,web:5,flange:9,autoSize:true}))
 assert.deepEqual([s.web,s.flange,s.auto],[10,15,true])
 assert.equal(s.section,'H-300×300×10×15')
 const m=steelSize(v({kind:'steel',steelWidth:300,steelDepth:300,web:5,flange:9,autoSize:false}))
 assert.deepEqual([m.web,m.flange,m.auto],[5,9,false])
})

test('크기 검증: Web·Flg 가 단면보다 크면 한국어 오류를 던진다', () => {
 assert.throws(()=>hSectionPoints(300,300,300,9),/Web 두께는/)
 assert.throws(()=>hSectionPoints(300,300,5,150),/Flg 두께는/)
 assert.throws(()=>hSectionPoints(0,300,5,9),/철골 크기/)
 assert.throws(()=>columnGeometry({kind:'rc',shape:'rect',concWidth:600,concDepth:0},shared),/콘크리트 세로/)
 assert.throws(()=>columnGeometry({kind:'rc',shape:'circle',concWidth:0},shared),/콘크리트 가로/)
})

test('칸 기본값 네 개와 요약·미리보기가 원문의 형태를 덮는다', () => {
 const kinds=[0,1,2,3].map(i=>v(columnSlotDefaults(i)))
 assert.deepEqual(kinds.map(k=>[k.kind,k.shape]),[['rc','rect'],['rc','circle'],['steel','rect'],['src','rect']])
 assert.deepEqual(kinds.map(k=>columnGeometry(k,shared).entities.length),[1,1,1,2])
 assert.equal(columnSummary(kinds[0]),'600×600')
 assert.equal(columnSummary(kinds[1]),'⌀600')
 assert.equal(columnSummary(kinds[3]),'600×600 · H-300×300×5×9')
 assert.equal(columnSummary(v({kind:'rc',eccX:100,eccY:0})),'600×600 · 편심 100,0')
 for(const k of kinds)assert.match(columnPreviewSvg(k,shared,{width:64,height:34,compact:true}),/^<svg /)
})
