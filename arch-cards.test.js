// 보조명령 카드(문·창·개구부·계단·주차·벽 정리) 기하 시험. 화면 없이 자체 엔진 안에서만 돈다.
import test from 'node:test'
import assert from 'node:assert/strict'
import {wallFrame,toLocal,cutWallBand,capLines,entitiesSvg,normalizeValues,defaultsOf,loadCardState,saveCardState,snapWallFrame} from './card-kit.js'
import {DOOR_FIELDS,DOOR_SHARED_FIELDS,doorSlotDefaults,buildDoor,doorLeaves,doorPreviewSvg,validateDoorValues,doorExtents,steelFrameSpan,wallEndFrame,installDoorCards,DOOR_STORAGE_KEY,parseDoorTypeOption,DOOR_TYPE_LETTERS} from './door-card.js'
import {createHash} from 'node:crypto'
import {WINDOW_FIELDS,windowSlotDefaults,buildWindow,windowPanels,windowPreviewSvg} from './window-card.js'
import {OPENING_FIELDS,buildOpening,openingSpan} from './opening-card.js'
import {STP_FIELDS,STC_FIELDS,buildStairPlan,buildStairSection,offsetPath} from './stair-card.js'
import {PARKING_FIELDS,buildParking,stallStarts,stallSize} from './parking-card.js'
import {wallFilletOnce,groupByDirection,collectBoxLines,isWallPolyline} from './wall-fillet-card.js'

/* ── 2026-09-24 검토 F2·F3 ── */
test('FL/FT/FX: 벽 켜가 아닌 폴리선(면적선·도곽)은 영역에 걸려도 폭파하지 않는다', () => {
  const room={id:'room',type:'polyline',closed:true,points:[{x:-100,y:-100},{x:300,y:-100},{x:300,y:300},{x:-100,y:300}],layer:'AREA'}
  const layers=[{id:'AREA',name:'A-AREA'},{id:'W',name:'A-WALL'}]
  const r=collectBoxLines([room],{x:-200,y:-200},{x:0,y:0},layers)
  assert.deepEqual(r.removeIds,[]);assert.equal(r.lines.length,0)
  assert.equal(isWallPolyline(room,layers),false)
  assert.equal(isWallPolyline({...room,layer:'W'},layers),true)
  assert.equal(isWallPolyline({...room,wallPreset:'RC 200'},layers),true)
  // 검토자 재지적 ③: 벽이 아닌 구조 부재 켜(슬래브·보·기둥·기초)는 CONC 가 붙어도 제외
  for(const nm of ['S-CONC-SLAB','S-CONC-BEAM','S-CONC-COL','S-CONC-COLS','S-CONC-FOOT','S-CONC-FDN','C-슬래브','C-기둥'])assert.equal(isWallPolyline(room,[{id:'AREA',name:nm}]),false,nm)
  for(const nm of ['S-CONC-WALL','A-WALL-CONC','조적벽','A-PARTITION'])assert.equal(isWallPolyline(room,[{id:'AREA',name:nm}]),true,nm)
})
test('FL: 벽 폴리선은 영역에 걸린 구간만 낱개 선으로 떼고 나머지 연속 구간은 폴리선으로 남긴다', () => {
  const poly={id:'p',type:'polyline',closed:true,points:[{x:0,y:0},{x:6000,y:0},{x:6000,y:4000},{x:0,y:4000}],layer:'A-WALL'}
  const r=collectBoxLines([poly],{x:-100,y:-100},{x:400,y:400})
  assert.deepEqual(r.removeIds,['p'])
  assert.equal(r.lines.length,2,'걸린 두 변만 선으로')
  assert.equal(r.extra.length,1);assert.equal(r.extra[0].type,'polyline');assert.equal(r.extra[0].points.length,3)
})
test('FT: 가지선 끝이 벽 두께 띠 안에서 끝나도 바깥 끝에서 먼저 만나는 면에 붙고 먼 면은 그대로', () => {
  const T=[{id:'h1',type:'line',points:[{x:-3000,y:0},{x:3000,y:0}],layer:'L'},{id:'h2',type:'line',points:[{x:-3000,y:200},{x:3000,y:200}],layer:'L'},
    {id:'v1',type:'line',points:[{x:0,y:100},{x:0,y:3000}],layer:'L'},{id:'v2',type:'line',points:[{x:150,y:100},{x:150,y:3000}],layer:'L'}]
  const r=wallFilletOnce('FT',T,{x:-400,y:-100},{x:500,y:600})
  const key=e=>e.points.map(p=>`${Math.round(p.x)},${Math.round(p.y)}`).join('>')
  assert.ok(!r.removeIds.includes('h1'),'먼 면 h1 은 손대지 않음')
  assert.deepEqual(r.add.map(key).sort(),['-3000,200>0,200','0,200>0,3000','150,200>150,3000','150,200>3000,200'])
})

const values=(fields,extra={},name='t')=>normalizeValues(fields,{...defaultsOf(fields),...extra},name)
const doorShared={frameLayer:'A-DOOR',leafLayer:'A-DOOR',swingLayer:'A-DOOR'}
const winShared={frameLayer:'A-GLAZ',elevLayer:'A-GLAZ',wallElevLayer:'A-WALL'}
const stairShared={stairLayer:'A-STAIR',textLayer:'A-TEXT'}
const parkShared={parkLayer:'A-PARK',textLayer:'A-TEXT',markLayer:'A-SYM'}
const wall200=(x0=-1000,x1=5000)=>[{id:'a',type:'line',points:[{x:x0,y:0},{x:x1,y:0}],layer:'L1'},{id:'b',type:'line',points:[{x:x0,y:200},{x:x1,y:200}],layer:'L2'},{id:'c',type:'line',points:[{x:x0,y:100},{x:x1,y:100}],layer:'LC',linetype:'CENTER'}]
const xs=e=>e.points.map(p=>Math.round(p.x))

test('벽 좌표계: 셋째 점이 어느 쪽이든 두께는 양수이고 d 축은 셋째 점 쪽을 향한다', () => {
  const f=wallFrame({x:0,y:0},{x:1000,y:0},{x:300,y:-200})
  assert.equal(f.t,200);assert.ok(f.n.y<0);assert.equal(f.flip,-1)
  const l=toLocal(f,{x:500,y:-200});assert.equal(Math.round(l.s),500);assert.equal(Math.round(l.d),200)
  assert.throws(()=>wallFrame({x:0,y:0},{x:1000,y:0},{x:500,y:0}),/반대쪽 벽선/)
})

test('벽선 절단: 띠 안의 평행선만 잘리고 중심선은 남는다', () => {
  const f=wallFrame({x:0,y:0},{x:1000,y:0},{x:0,y:200})
  const cut=cutWallBand(wall200(),f,1000,1900)
  assert.deepEqual(cut.removeIds.sort(),['a','b'])
  assert.deepEqual(cut.add.map(xs).sort((p,q)=>p[0]-q[0]||p[1]-q[1]),[[-1000,1000],[-1000,1000],[1900,5000],[1900,5000]])
  assert.deepEqual(cut.cuts.map(c=>c.d),[0,200])
  assert.ok(cut.add.every(e=>e.type==='line'&&!e.id))
})

test('벽선 절단: 닫힌 폴리선(사각 벽)은 구간이 잘려 열린 폴리선이 된다', () => {
  const f=wallFrame({x:0,y:0},{x:1000,y:0},{x:0,y:200})
  const rect={id:'r',type:'polyline',closed:true,points:[{x:0,y:0},{x:4000,y:0},{x:4000,y:3000},{x:0,y:3000}],layer:'L'}
  const cut=cutWallBand([rect],f,1000,2000,{dMin:0,dMax:0})
  assert.deepEqual(cut.removeIds,['r'])
  assert.equal(cut.add.length,1);assert.equal(cut.add[0].type,'polyline');assert.equal(cut.add[0].closed,false)
  const pts=cut.add[0].points.map(p=>[Math.round(p.x),Math.round(p.y)])
  assert.deepEqual(pts[0],[2000,0]);assert.deepEqual(pts.at(-1),[1000,0]);assert.equal(pts.length,6)
})

test('벽선 절단: 표준 실·해치·주석·치수는 보존하고 비표준 켜 벽은 그대로 자른다', () => {
  const f=wallFrame({x:0,y:0},{x:1000,y:0},{x:0,y:200})
  const names=['A-AREA','A-AREA-BED','A-AREA-PATT','A-HATCH','A-TEXT','A-DIM','A-SYM','A-TITLE','A-PLOT','A-NOTE','A-ACCS']
  for(const mapped of [true,false]){
    const layers=names.map((name,i)=>({id:'keep-layer-'+i,name})),points=[{x:0,y:200},{x:5000,y:200},{x:5000,y:4000},{x:0,y:4000}]
    const keep=names.map((name,i)=>({id:'keep-'+i,type:['line','polyline','rectangle'][i%3],layer:mapped?layers[i].id:name,closed:true,points:structuredClone(points)}))
    keep.push({id:'hatch',type:'hatch',layer:keep[2].layer,points:structuredClone(points)},{id:'dim',type:'dimension',layer:keep[5].layer,points:structuredClone(points)},{id:'text',type:'text',layer:keep[4].layer,position:{x:1500,y:200},text:'안방',height:200})
    const wallLayers=[{id:'wall',name:'A-WALL-CONC'},{id:'legacy',name:'0'}]
    const walls=wallLayers.map((l,i)=>({id:'wall-'+i,type:i?'polyline':'line',layer:mapped?l.id:l.name,points:[{x:0,y:i*200},{x:5000,y:i*200}]}))
    const entities=[...keep,...walls],before=structuredClone(entities)
    const cut=cutWallBand(entities,f,1000,2000,{layers:mapped?[...layers,...wallLayers]:[]})
    assert.deepEqual(cut.removeIds.sort(),walls.map(e=>e.id))
    assert.equal(cut.add.length,4);assert.deepEqual(cut.cuts.map(c=>c.layer),walls.map(e=>e.layer))
    assert.deepEqual(entities,before,'입력 객체도 그대로')
  }
})

test('단면 정리선: 첫 선을 따라 한 선, 각각의 벽선으로 이웃 사이마다', () => {
  const f=wallFrame({x:0,y:0},{x:1000,y:0},{x:0,y:300})
  const cuts=[{d:0,layer:'A'},{d:100,layer:'B'},{d:300,layer:'C'}]
  const one=capLines(f,[500],cuts,'first');assert.equal(one.length,1);assert.equal(one[0].layer,'A');assert.deepEqual(one[0].points.map(p=>Math.round(p.y)),[0,300])
  const each=capLines(f,[500],cuts,'each');assert.equal(each.length,2);assert.deepEqual(each.map(e=>e.layer),['A','B'])
  const none=capLines(f,[500],[],'first',{fallbackLayerName:'A-DOOR'});assert.equal(none[0].cardLayer,'A-DOOR')
})

test('문: 폭이 양개문 시작길이 이상이면 양개, 분할 방식대로 나뉜다', () => {
  const v=values(DOOR_FIELDS,{width:900});assert.deepEqual(doorLeaves(v).map(l=>l.w),[900])
  const big=values(DOOR_FIELDS,{width:1800});assert.deepEqual(doorLeaves(big).map(l=>l.w),[900,900])
  assert.deepEqual(doorLeaves({...big,split:'twoOne'}).map(l=>Math.round(l.w)),[1200,600])
  assert.deepEqual(doorLeaves({...big,split:'fixed',fixedWidth:500}).map(l=>l.w),[500,1300])
  assert.deepEqual(doorLeaves(values(DOOR_FIELDS,{width:900,swing:'double'})).map(l=>l.w),[450,450])
})

test('문: 절단 구간은 폭 + 2(틀 폭+간격) 이고 상세문은 문틀·문짝·호를 만든다', () => {
  const f=wallFrame({x:0,y:0},{x:5000,y:0},{x:0,y:200})
  const v=values(DOOR_FIELDS,{...doorSlotDefaults(1),width:900,frameWidth:45,gap:20,offset:100},'D2')
  const d=buildDoor(f,v,doorShared)
  assert.deepEqual(d.cut,[100,100+900+130])
  assert.equal(d.entities.filter(e=>e.type==='arc').length,1)
  assert.equal(d.entities.filter(e=>e.type==='polyline').length,3,'문틀 2 + 문짝 1')
  assert.ok(d.entities.every(e=>e.cardLayer==='A-DOOR'))
  const arc=d.entities.find(e=>e.type==='arc');assert.equal(Math.round(arc.radius),900);assert.equal(Math.round(arc.center.x),165);assert.equal(Math.round(arc.center.y),100)
})

test('문: 간단문(D1)은 (틀 폭+간격) 길이 단선 두 개와 문짝 단선으로 표현된다 (원문 65 예)', () => {
  const f=wallFrame({x:0,y:0},{x:5000,y:0},{x:0,y:200})
  const v=values(DOOR_FIELDS,{...doorSlotDefaults(0),width:900,frameWidth:45,gap:20,swingMark:'none'},'D1')
  const d=buildDoor(f,v,doorShared)
  const lines=d.entities.filter(e=>e.type==='line')
  assert.equal(lines.length,3)
  const stubs=lines.filter(e=>Math.abs(e.points[0].y-e.points[1].y)<1e-9).map(e=>Math.round(Math.abs(e.points[1].x-e.points[0].x)))
  assert.deepEqual(stubs,[65,65])
})

test('문: 셋째 점 쪽으로 열리고, 벽선이 뒤집혀도 문짝 끝이 셋째 점 쪽에 놓인다', () => {
  const v=values(DOOR_FIELDS,{width:900,swingMark:'none',leafThickness:0})
  for(const y3 of [200,-200]){
    const f=wallFrame({x:0,y:0},{x:5000,y:0},{x:0,y:y3}),d=buildDoor(f,v,doorShared)
    const leaf=d.entities.find(e=>e.type==='line'&&Math.abs(e.points[1].y-e.points[0].y)>100)
    assert.ok(Math.sign(leaf.points[1].y-leaf.points[0].y)===Math.sign(y3),`셋째 점 y=${y3}`)
  }
})

test('문 카드 상태: 슬롯 이름은 고정, 켜 설정은 공통으로 저장·복원된다', () => {
  const memory=new Map(),storage={getItem:k=>memory.get(k)??null,setItem:(k,v)=>memory.set(k,v)}
  const st=loadCardState(storage,'k',{fields:DOOR_FIELDS,sharedFields:DOOR_SHARED_FIELDS,slots:6,fixedNames:['D1 간단문','D2 상세문','D3 상세문 (설정 2)'],slotDefaults:doorSlotDefaults})
  assert.equal(st.presets[0].detail,'simple');assert.equal(st.presets[1].detail,'detail');assert.equal(st.presets[2].name,'D3 상세문 (설정 2)');assert.equal(st.shared.frameLayer,'A-DOOR')
  st.presets[1].width=1000;st.shared.leafLayer='A-DOOR-X';saveCardState(storage,'k',st)
  const again=loadCardState(storage,'k',{fields:DOOR_FIELDS,sharedFields:DOOR_SHARED_FIELDS,slots:6,fixedNames:['D1 간단문'],slotDefaults:doorSlotDefaults})
  assert.equal(again.presets[1].width,1000);assert.equal(again.shared.leafLayer,'A-DOOR-X');assert.equal(again.presets[0].name,'D1 간단문')
})

test('세 점 스냅: 벽선 근처를 찍으면 벽선 위 점으로 붙고 두께는 반대 벽선까지다', () => {
  const f=snapWallFrame(wall200(),{x:1000,y:6},{x:2000,y:-4},{x:1500,y:207},20)
  assert.equal(Math.round(f.t),200);assert.equal(Math.round(f.origin.y),0);assert.equal(f.snapped.first.id,'a');assert.equal(f.snapped.opposite.id,'b')
})

test('창: 고정창은 등분 수만큼 중간 창틀이 생기고, 미서기는 열리는 폭 고정이 첫 판에 적용된다', () => {
  const f=wallFrame({x:0,y:0},{x:5000,y:0},{x:0,y:200})
  const fixed=values(WINDOW_FIELDS,{...windowSlotDefaults(0),width:1800,divisions:3},'W1')
  const w1=buildWindow(f,fixed,winShared)
 assert.ok(w1.entities.every(e=>e.uValue===null&&e.shgc===null))
  assert.equal(w1.entities.filter(e=>e.type==='polyline').length,2+2,'양끝 틀 2 + 중간 틀 2')
  assert.deepEqual(w1.cut,[0,1800])
  const sl=values(WINDOW_FIELDS,{...windowSlotDefaults(1),width:1800,frameWidth:50,fixOpen:true,fixedOpenWidth:600},'W2')
  assert.deepEqual(windowPanels(sl,1700),[600,1100])
  const w2=buildWindow(f,sl,winShared);assert.ok(w2.entities.some(e=>e.cardLayer==='A-GLAZ'))
  const dbl=buildWindow(f,{...sl,sashType:'double',detail:'simple'},winShared);assert.ok(dbl.entities.length>w2.entities.length-2)
})

test('창: 지정 두께와 내부돌출은 첫째 점(실내) 쪽으로 움직이고 드러난 벽면에 벽체 입면선이 생긴다', () => {
  const f=wallFrame({x:0,y:0},{x:5000,y:0},{x:0,y:200})
  const v=values(WINDOW_FIELDS,{...windowSlotDefaults(1),width:1800,depthMode:'custom',depth:100,protrude:30},'W2')
  const w=buildWindow(f,v,winShared)
  assert.equal(Math.round(w.dLo),20);assert.equal(Math.round(w.dHi),120)
  assert.ok(w.entities.some(e=>e.cardLayer==='A-WALL'&&Math.abs(e.points[0].y-200)<1e-9),'반대쪽(외부) 벽면 입면선')
})

test('개구부: 첫째~둘째 점 구간 또는 두 점 중간에 지정 크기', () => {
  const v=values(OPENING_FIELDS,{offset:100});assert.deepEqual(openingSpan(v,1500),[100,1500])
  assert.deepEqual(openingSpan(values(OPENING_FIELDS,{midMode:true,openWidth:1000}),3000),[1000,2000])
  assert.throws(()=>openingSpan(values(OPENING_FIELDS,{offset:2000}),1500),/둘째 점/)
  const f=wallFrame({x:0,y:0},{x:5000,y:0},{x:0,y:200})
  const o=buildOpening(f,values(OPENING_FIELDS,{protrudeIn:50,protrudeOut:30}),{lineLayer:'A-WALL'},1500)
  assert.equal(o.entities.length,4);assert.ok(o.entities.some(e=>Math.round(Math.min(e.points[0].y,e.points[1].y))===-50))
})

test('계단 평면: 돌음계단은 두 흐름과 계단참, 일자계단은 참을 두고 단수를 나눈다', () => {
  const f=wallFrame({x:0,y:0},{x:1,y:0},{x:0,y:1})
  const turn=buildStairPlan(f,1200,values(STP_FIELDS,{count:20,tread:280,gap:100,floorHeight:3300}),stairShared)
  const risers=turn.entities.filter(e=>e.type==='line'&&Math.abs(e.points[0].x-e.points[1].x)<1e-9&&Math.abs(e.points[1].y-e.points[0].y-1200)<1e-6)
  assert.equal(risers.length,19,'계단참 1단을 뺀 디딤 19단');assert.equal(turn.riser,165)
  assert.ok(turn.entities.some(e=>e.type==='text'&&e.text==='UP'))
  const straight=buildStairPlan(f,1200,values(STP_FIELDS,{kind:'straight',count:16,landing:1200,direction:'updown',numbers:true}),stairShared)
  assert.ok(straight.entities.some(e=>e.type==='text'&&e.text==='DN'));assert.ok(straight.entities.some(e=>e.type==='text'&&e.text==='16'))
  assert.ok(straight.entities.some(e=>e.type==='polyline'&&e.points.length===6),'절단선')
  assert.deepEqual(offsetPath([[0,0],[100,0],[100,100]],10).map(p=>p.map(Math.round)),[[0,10],[90,10],[90,100]])
})

test('계단 입·단면: 두 점을 단수로 나눠 단 너비·높이를 정하고 10 배수 맞춤이 된다', () => {
  const v=values(STC_FIELDS,{count:10,landing:800})
  const sec=buildStairSection({x:0,y:0},{x:2830,y:1700},{...v,view:'section'},stairShared)
  assert.equal(sec.tread,283);assert.equal(sec.riser,170)
  const outline=sec.entities.find(e=>e.type==='polyline'&&e.closed);assert.ok(outline,'단면은 닫힌 윤곽')
  assert.equal(sec.entities.filter(e=>e.type==='text').length,10)
  const ten=buildStairSection({x:0,y:0},{x:2830,y:1700},{...v,roundTen:true},stairShared);assert.equal(ten.tread,280)
  const dbl=buildParking(wallFrame({x:0,y:0},{x:1,y:0},{x:0,y:1}),5000,values(PARKING_FIELDS,{style:'double'}),parkShared);assert.equal(dbl.entities.filter(e=>e.type==='line').length,3+4+2,'경계 3 + 안쪽 이중선 4 + 뒤쪽 선 2')
  const elev=buildStairSection({x:0,y:0},{x:-2800,y:1700},{...v,view:'elevation',railHeight:0},stairShared)
  assert.ok(!elev.entities.some(e=>e.closed));assert.ok(elev.entities.some(e=>e.type==='polyline'&&e.points[1].x===0&&e.points[1].y===170))
})

test('주차: 종류별 크기, 정렬 기준, 자동 대수, 장애인 표지', () => {
  assert.deepEqual([stallSize(values(PARKING_FIELDS)).w,stallSize(values(PARKING_FIELDS,{type:'disabled33'})).w],[2500,3300])
  assert.deepEqual(stallStarts(values(PARKING_FIELDS),12600),[0,2500,5000,7500,10000])
  assert.deepEqual(stallStarts(values(PARKING_FIELDS,{align:'end'}),12600),[100,2600,5100,7600,10100])
  assert.deepEqual(stallStarts(values(PARKING_FIELDS,{align:'center',count:2}),12600),[3800,6300])
  assert.throws(()=>stallStarts(values(PARKING_FIELDS),1000),/짧습니다/)
  const f=wallFrame({x:0,y:0},{x:1,y:0},{x:0,y:1})
  const r=buildParking(f,12600,values(PARKING_FIELDS,{numbering:true,startNumber:3}),parkShared)
  assert.equal(r.count,5);assert.equal(r.entities.filter(e=>e.type==='line').length,7,'경계 6 + 뒤쪽 선 1');assert.deepEqual(r.entities.filter(e=>e.type==='text').map(e=>e.text),['3','4','5','6','7'])
  const dis=buildParking(f,7000,values(PARKING_FIELDS,{type:'disabled35'}),parkShared);assert.equal(dis.count,2);assert.ok(dis.entities.filter(e=>e.type==='circle').length>=4)
  const ext=buildParking(f,5200,values(PARKING_FIELDS,{type:'extended'}),parkShared);assert.ok(ext.entities.some(e=>e.type==='circle'&&e.cardLayer==='A-SYM'))
})

test('FL: 두 방향 벽선을 안쪽부터 짝지어 모서리에서 만나게 하고 넘친 부분은 잘린다', () => {
  const L=[{id:'h1',type:'line',points:[{x:-3000,y:0},{x:300,y:0}],layer:'L'},{id:'h2',type:'line',points:[{x:-3000,y:200},{x:300,y:200}],layer:'L'},{id:'v1',type:'line',points:[{x:0,y:-300},{x:0,y:3000}],layer:'L'},{id:'v2',type:'line',points:[{x:200,y:-300},{x:200,y:3000}],layer:'L'},{id:'c',type:'line',points:[{x:-3000,y:100},{x:100,y:100}],layer:'L',linetype:'CENTER'}]
  const r=wallFilletOnce('FL',L,{x:-100,y:300},{x:400,y:-400})
  assert.deepEqual(r.removeIds.sort(),['h1','h2','v1','v2'],'중심선은 손대지 않음')
  const key=e=>e.points.map(p=>`${Math.round(p.x)},${Math.round(p.y)}`).join('>')
  assert.deepEqual(r.add.map(key).sort(),['-3000,0>200,0','-3000,200>0,200','0,200>0,3000','200,0>200,3000'])
})

test('FT: 가지 벽선을 가장 가까운 통과선에 붙이고 그 통과선만 끊는다', () => {
  const T=[{id:'h1',type:'line',points:[{x:-3000,y:0},{x:3000,y:0}],layer:'L'},{id:'h2',type:'line',points:[{x:-3000,y:200},{x:3000,y:200}],layer:'L'},{id:'v1',type:'line',points:[{x:0,y:-300},{x:0,y:-3000}],layer:'L'},{id:'v2',type:'line',points:[{x:150,y:-300},{x:150,y:-3000}],layer:'L'}]
  const r=wallFilletOnce('FT',T,{x:-400,y:-500},{x:500,y:300})
  assert.deepEqual(r.removeIds.sort(),['h1','v1','v2'])
  const key=e=>e.points.map(p=>`${Math.round(p.x)},${Math.round(p.y)}`).join('>')
  assert.deepEqual(r.add.map(key).sort(),['-3000,0>0,0','0,0>0,-3000','150,0>150,-3000','150,0>3000,0'])
})

test('FX: 교차부에서 서로의 바깥선 사이를 끊어 속이 빈 십자가 된다', () => {
  const X=[{id:'h1',type:'line',points:[{x:-3000,y:0},{x:3000,y:0}],layer:'L'},{id:'h2',type:'line',points:[{x:-3000,y:200},{x:3000,y:200}],layer:'L'},{id:'v1',type:'line',points:[{x:0,y:-3000},{x:0,y:3000}],layer:'L'},{id:'v2',type:'line',points:[{x:150,y:-3000},{x:150,y:3000}],layer:'L'}]
  const r=wallFilletOnce('FX',X,{x:-400,y:-500},{x:500,y:500})
  assert.equal(r.removeIds.length,4);assert.equal(r.add.length,8)
  assert.ok(r.add.every(e=>{const [a,b]=e.points;return !(Math.min(a.x,b.x)>0&&Math.max(a.x,b.x)<150&&Math.min(a.y,b.y)>0&&Math.max(a.y,b.y)<200)}),'가운데에는 아무 선도 없다')
  assert.equal(groupByDirection(X).length,2)
})

test('FL: 폴리선 벽은 낱개 선으로 나눠 정리하고 나머지 구간은 선으로 남긴다', () => {
  const poly={id:'p',type:'polyline',points:[{x:-3000,y:0},{x:300,y:0},{x:300,y:-2000}],layer:'A-WALL'}
  const v=[{id:'v1',type:'line',points:[{x:0,y:-300},{x:0,y:3000}],layer:'A-WALL'}]
  const r=wallFilletOnce('FL',[poly,...v],{x:-100,y:300},{x:200,y:-200})
  assert.ok(r.removeIds.includes('p')&&r.removeIds.includes('v1'))
  assert.ok(r.add.some(e=>e.points.some(p=>p.y===-2000)),'상자 밖 구간은 그대로 선으로')
  assert.throws(()=>wallFilletOnce('FL',[],{x:0,y:0},{x:1,y:1}),/벽선이 없습니다/)
})

test('SVG 미리보기는 모든 카드에서 만들어지고 위험한 문자는 이스케이프된다', () => {
  const d=doorPreviewSvg(values(DOOR_FIELDS,doorSlotDefaults(1),'D2'),doorShared);assert.match(d,/^<svg/);assert.match(d,/<path/);
  const w=windowPreviewSvg(values(WINDOW_FIELDS,windowSlotDefaults(0),'W1'),winShared);assert.match(w,/<line/)
  const svg=entitiesSvg([{type:'text',position:{x:0,y:0},text:'<b>&',height:100},{type:'arc',center:{x:0,y:0},radius:100,startAngle:0,endAngle:90}],{label:'"x"'})
  assert.ok(!svg.includes('<b>'));assert.match(svg,/&lt;b&gt;&amp;/);assert.match(svg,/A\d/)
  assert.match(entitiesSvg([]),/<svg/)
})

/* ── 2026-09-21 미룬 보정 3건 ── */
test('창: 외부돌출은 반대쪽(외부) 벽선 밖으로 창 두께를 늘리고 외부 벽면 입면선은 생기지 않는다', () => {
  const f=wallFrame({x:0,y:0},{x:5000,y:0},{x:0,y:200})
  const w=buildWindow(f,values(WINDOW_FIELDS,{...windowSlotDefaults(1),width:1800,protrudeOut:50},'W1'),winShared)
  assert.equal(Math.round(w.dLo),0);assert.equal(Math.round(w.dHi),250)
  assert.ok(!w.entities.some(e=>e.cardLayer==='A-WALL'&&Math.abs(e.points[0].y-200)<1e-9),'외부 벽면 입면선 없음')
})
test('계단 평면: 절단선 모양 직선이면 지그재그 폴리선 대신 한 선', () => {
  const f=wallFrame({x:0,y:0},{x:1,y:0},{x:0,y:1})
  const st=buildStairPlan(f,1200,values(STP_FIELDS,{kind:'straight',count:16,landing:1200,direction:'updown',breakStyle:'straight'}),stairShared)
  assert.ok(!st.entities.some(e=>e.type==='polyline'&&e.points.length===6),'지그재그 없음')
  assert.ok(st.entities.some(e=>e.type==='line'&&Math.abs(e.points[0].x-e.points[1].x)<1e-9&&Math.abs(Math.abs(e.points[1].y-e.points[0].y)-1200*1.16)<1e-6),'직선 절단선')
})
test('주차구획: 도면의 블럭을 칸마다 삽입하고 없는 이름은 한국어 오류', () => {
  const f=wallFrame({x:0,y:0},{x:1,y:0},{x:0,y:1})
  const blocks=[{name:'CAR',entities:[{type:'line',layer:'L1',points:[{x:-1000,y:0},{x:1000,y:0}]}]}]
  const r=buildParking(f,12600,values(PARKING_FIELDS,{carSymbol:'block',blockName:'CAR',blockScale:1}),parkShared,blocks)
  const refs=r.entities.filter(e=>e.type==='block')
  assert.equal(refs.length,5);assert.equal(refs[0].name,'CAR')
  assert.equal(Math.round(refs[0].entities[0].points[0].x),1250-1000);assert.equal(Math.round(refs[0].entities[0].points[0].y),2500)
  assert.throws(()=>buildParking(f,12600,values(PARKING_FIELDS,{carSymbol:'block',blockName:'NOPE'}),parkShared,blocks),/블럭이 없습니다.*CAR/)
  const preview=buildParking(f,12600,values(PARKING_FIELDS,{carSymbol:'block',blockName:'CAR'}),parkShared,null)
  assert.ok(!preview.entities.some(e=>e.type==='block')&&preview.entities.some(e=>e.type==='polyline'),'미리보기는 윤곽으로 대신')
})

/* ── H85(2026-09-26): 문 종류 [여닫이 / 양개 / 편개 / 철제(S)] · 마감 두께 · 명령행 순서 ── */
// 기준값: 이 기능을 넣기 전 door-card.js 로 만든 결과의 sha256. 새 설정의 기본값(여닫이 · 마감 0)이 예전과 한 글자도 다르지 않은지 본다.
// (-0 은 '-0' 으로 적어 0 과 구별한다.) 값이 바뀌었다면 기존 도면에 그려지는 문 모양이 바뀐 것이다.
const DOOR_GOLDEN={build:'f1ba014eb585b9d4bb5c053818508f70a908506b3c7fcf1790c354830e7810ec',preview:'f8d25026d17bff719420da6c99754b720a54fe5c108895d9b9f30475f55e21d8',draw:'1e261ce0d3a409aa8be65e160764988f2426b0de98db388a30d4741cdbd16bb0'}
const goldenJson=x=>JSON.stringify(x,(k,v)=>k==='reviewInput'?undefined:Object.is(v,-0)?'-0':v)
const goldenShared={frameLayer:'A-DOOR',leafLayer:'A-DOOR-LEAF',swingLayer:'A-DOOR-SWNG'}
/* 명령입력·명령행 순서 실행을 화면 없이 돌린다. answers.numbers 는 askNumber 에 차례로 답할 값(없으면 기본값으로 Enter). */
async function runDoorCard(slotIndex,preset,points,entities,layers,answers={}){
  const store=new Map(),presets=[];presets[slotIndex]={runMode:'command',...preset}
  store.set(DOOR_STORAGE_KEY,JSON.stringify({presets,shared:{frameLayer:'A-DOOR',leafLayer:'A-DOOR',swingLayer:'A-DOOR'},selected:slotIndex}))
  const out={store},pending=[],numbers=[...(answers.numbers||[])]
  const ctx={
    storage:{getItem:k=>store.get(k)??null,setItem:(k,val)=>store.set(k,val)},entities:()=>entities,layers:()=>layers,tolerance:()=>10,
    ensureLayer:name=>'id:'+name,
    askNumber:(opts,cb)=>{(out.asked||=[]).push(opts.label);pending.push(Promise.resolve().then(()=>cb(numbers.length?numbers.shift():opts.value)).catch(e=>{out.error=e}))},
    pickPath:async o=>{(out.picks||=[]).push(o.minPoints);return points?{points}:null},
    commit:r=>{out.commit=r;return ['x']},
    toast:m=>{out.toast=m},
    form:(title,fields,onApply)=>{out.form=fields.map(f=>f.name);out.formValue=fields[0].value;pending.push(Promise.resolve().then(()=>onApply({[fields[0].name]:answers.type??fields[0].value})).catch(e=>{out.error=e}))},
  }
  installDoorCards(ctx)[['D1','D2','D3'][slotIndex]]()
  while(pending.length)await pending.shift()
  return out
}

test('H85 문: 새 설정 기본값(여닫이·마감 0)은 예전 문 도형·미리보기·그리기 결과와 바이트 단위로 같다', async () => {
  const frames=[wallFrame({x:0,y:0},{x:5000,y:0},{x:0,y:200}),wallFrame({x:0,y:0},{x:5000,y:0},{x:0,y:-200}),wallFrame({x:1000,y:500},{x:1000+4330,y:500+2500},{x:1000-75,y:500+130})]
  const h=createHash('sha256');let n=0
  for(const f of frames)for(const slot of [0,1])for(const swing of ['single','double'])for(const width of [900,1800])for(const split of ['equal','twoOne','fixed'])for(const position of ['center','hinge','opposite'])
    for(const gap of [0,20])for(const frameWidth of [45,0])for(const leafThickness of [40,0])for(const swingMark of ['arc','line','both','none'])for(const [openAngle,offset] of [[90,0],[60,100]]){
      const v=values(DOOR_FIELDS,{...doorSlotDefaults(slot),swing,width,split,fixedWidth:600,position,protrude:position==='hinge'?30:-20,gap,frameWidth,leafThickness,swingMark,openAngle,offset},'c')
      assert.equal(v.doorType,'swing');assert.equal(v.finishThickness,0)
      h.update(goldenJson(buildDoor(f,v,goldenShared)));n++
    }
  assert.equal(n,13824);assert.equal(h.digest('hex'),DOOR_GOLDEN.build,'buildDoor 기본값 출력이 예전과 다르다')
  const hp=createHash('sha256')
  for(const slot of [0,1,2])for(const width of [900,1800])hp.update(doorPreviewSvg(values(DOOR_FIELDS,{...doorSlotDefaults(slot),width}),goldenShared))
  assert.equal(hp.digest('hex'),DOOR_GOLDEN.preview,'미리보기 SVG 가 예전과 다르다')
  const wall=[...wall200(-1000,5000),{id:'r',type:'polyline',closed:true,points:[{x:6000,y:0},{x:9000,y:0},{x:9000,y:200},{x:6000,y:200}],layer:'L1'}]
  const layers=[{id:'L1',name:'A-WALL'},{id:'L2',name:'A-WALL'},{id:'LC',name:'A-WALL-C',linetype:'CENTER'}]
  const hd=createHash('sha256')
  for(const slot of [0,1,2])for(const extra of [{},{width:1800},{offset:100,gap:20,wallCap:'each'},{position:'hinge',protrude:30}])
    for(const pts of [[{x:1000,y:2},{x:2000,y:0},{x:1500,y:198}],[{x:6500,y:0},{x:7000,y:0},{x:6600,y:200}]]){
      // select:false(넣은 뒤 선택을 남기지 않음, 10-24)는 도형이 아니라 화면 선택 표시라 지문에서 뺀다
      const {commit:{select,...commit},toast}=await runDoorCard(slot,{...doorSlotDefaults(slot),width:900,...extra},pts,wall,layers);assert.equal(select,false);hd.update(goldenJson({commit,toast}))
    }
  assert.equal(hd.digest('hex'),DOOR_GOLDEN.draw,'벽선 절단·정리선·커밋 결과가 예전과 다르다')
})

test('H85 문: 새 키가 없는 예전 저장값도 그대로 그려지고, 저장소에서 읽으면 새 키는 기본값으로 채워진다', () => {
  const f=wallFrame({x:0,y:0},{x:5000,y:0},{x:0,y:200})
  const legacy={detail:'detail',width:1200,swing:'single',offset:50,doubleFrom:1500,split:'equal',fixedWidth:600,openAngle:90,position:'hinge',protrude:15,frameWidth:45,leafThickness:40,gap:10,swingMark:'both',wallCap:'first'}
  assert.deepEqual(buildDoor(f,legacy,doorShared),buildDoor(f,values(DOOR_FIELDS,legacy),doorShared))
  const memory=new Map([['k',JSON.stringify({presets:[null,{...legacy,runMode:'dialog'}],shared:{},selected:1})]]),storage={getItem:k=>memory.get(k)??null,setItem:(k,v)=>memory.set(k,v)}
  const st=loadCardState(storage,'k',{fields:DOOR_FIELDS,sharedFields:DOOR_SHARED_FIELDS,slots:6,fixedNames:['D1 간단문','D2 상세문','D3 상세문 (설정 2)'],slotDefaults:doorSlotDefaults})
  assert.equal(st.presets[1].doorType,'swing');assert.equal(st.presets[1].finishThickness,0);assert.equal(st.presets[1].steelPlate,1.6);assert.equal(st.presets[1].width,1200)
})

test('H85 문 종류: 여닫이는 예전 규칙, 양개는 항상 두 짝, 편개는 항상 한 짝, 철제는 여닫이 규칙을 따른다', () => {
  const at=(width,doorType,swing='single')=>doorLeaves(values(DOOR_FIELDS,{width,doorType,swing})).map(l=>l.w)
  assert.deepEqual(at(900,'swing'),[900]);assert.deepEqual(at(1800,'swing'),[900,900]);assert.deepEqual(at(900,'swing','double'),[450,450])
  assert.deepEqual(at(900,'double'),[450,450]);assert.deepEqual(at(1800,'single'),[1800]);assert.deepEqual(at(900,'single','double'),[900])
  assert.deepEqual(at(1800,'steel'),[900,900]);assert.deepEqual(at(900,'steel'),[900])
})

test('H85 철제문: 틀 폭 × 깊이의 ㄷ자 철판 문틀(1.6t 이중선)이 벽 쪽으로 열리고 문짝·궤적은 그대로', () => {
  const f=wallFrame({x:0,y:0},{x:5000,y:0},{x:0,y:200})
  const v=values(DOOR_FIELDS,{...doorSlotDefaults(2),doorType:'steel',width:900,frameWidth:50,leafThickness:45,steelDepth:100,steelPlate:1.6},'D3')
  const d=buildDoor(f,v,doorShared),r1=p=>[Math.round(p.x*10)/10,Math.round(p.y*10)/10]
  const frames=d.entities.filter(e=>e.type==='polyline'&&e.points.length===8)
  assert.equal(frames.length,2,'문틀 두 개(힌지 쪽·반대 쪽)');assert.ok(frames.every(e=>e.closed&&e.cardLayer==='A-DOOR'))
  assert.deepEqual(frames[0].points.map(r1),[[0,50],[50,50],[50,150],[0,150],[0,148.4],[48.4,148.4],[48.4,51.6],[0,51.6]])
  assert.deepEqual(frames[1].points.map(r1),[[1000,50],[950,50],[950,150],[1000,150],[1000,148.4],[951.6,148.4],[951.6,51.6],[1000,51.6]])
  assert.equal(d.entities.filter(e=>e.type==='polyline'&&e.points.length===4).length,1,'목재 사각 문틀은 없고 문짝 하나만')
  const leaf=d.entities.find(e=>e.type==='polyline'&&e.points.length===4)
  assert.deepEqual([...new Set(leaf.points.map(p=>Math.round(p.x*10)/10))].sort((a,b)=>a-b),[27.5,72.5],'문짝 두께 45, 힌지는 철판 문틀 안쪽 면(s=50)')
  const arc=d.entities.find(e=>e.type==='arc');assert.equal(Math.round(arc.radius),900);assert.deepEqual(r1(arc.center),[50,100])
  assert.deepEqual(d.cut,[0,1000])
  // 깊이 0 = 마감면까지 벽 두께 전체, 돌출 위치면 그쪽 마감면에 맞춘다
  assert.deepEqual(steelFrameSpan(f,{...v,steelDepth:0,finishThickness:20}),[-20,220])
  assert.deepEqual(steelFrameSpan(f,{...v,position:'hinge',protrude:0,finishThickness:20}),[-20,80])
  assert.deepEqual(steelFrameSpan(f,{...v,position:'opposite',protrude:0,finishThickness:20}),[120,220])
  const ext=doorExtents(f,{...v,steelDepth:300},d.dL);assert.deepEqual([ext.capLo,ext.capHi,ext.band],[-50,250,null],'문틀이 벽보다 깊으면 단면 정리선도 문틀까지')
  assert.match(doorPreviewSvg(v,doorShared),/철제문 1\.6t/)
})

test('H85 마감 두께: 문틀·벽선 절단 띠·단면 정리선이 양쪽 마감면까지 넓어지고 돌출 위치는 마감면 기준이다', async () => {
  const f=wallFrame({x:0,y:0},{x:5000,y:0},{x:0,y:200})
  const v=values(DOOR_FIELDS,{...doorSlotDefaults(1),width:900,finishThickness:20},'D2'),d=buildDoor(f,v,doorShared)
  const rects=d.entities.filter(e=>e.type==='polyline'&&e.points.length===4&&e.points.some(p=>p.y<0))
  assert.equal(rects.length,2);for(const r of rects)assert.deepEqual([...new Set(r.points.map(p=>Math.round(p.y)))].sort((a,b)=>a-b),[-20,220])
  assert.deepEqual(doorExtents(f,v,d.dL),{capLo:-20,capHi:220,band:[-20,220]})
  assert.equal(buildDoor(f,{...v,position:'hinge',protrude:5},doorShared).dL,-25)
  assert.equal(buildDoor(f,{...v,position:'opposite',protrude:5},doorShared).dL,225)
  assert.equal(d.dL,100,'벽중심은 양쪽 마감이 같아 그대로')
  assert.match(doorPreviewSvg(v,doorShared),/마감 20/)
  // 도면에 마감선(골조선 바깥 20)이 있으면 마감 두께를 넣었을 때만 마감선도 잘린다
  const walls=[...wall200(-1000,5000),{id:'fa',type:'line',points:[{x:-1000,y:-20},{x:5000,y:-20}],layer:'LF'},{id:'fb',type:'line',points:[{x:-1000,y:220},{x:5000,y:220}],layer:'LF'}]
  const layers=[{id:'L1',name:'A-WALL'},{id:'L2',name:'A-WALL'},{id:'LC',name:'A-WALL-C',linetype:'CENTER'},{id:'LF',name:'A-WALL-FNSH'}]
  const pts=[{x:1000,y:2},{x:2000,y:0},{x:1500,y:198}]
  const plain=await runDoorCard(1,{...doorSlotDefaults(1)},pts,walls,layers)
  assert.deepEqual(plain.commit.removeIds.sort(),['a','b'])
  const fin=await runDoorCard(1,{...doorSlotDefaults(1),finishThickness:20},pts,walls,layers)
  assert.deepEqual(fin.commit.removeIds.sort(),['a','b','fa','fb']);assert.match(fin.toast,/마감 20/)
  const cap=fin.commit.entities.find(e=>e.type==='line'&&Math.abs(e.points[0].x-e.points[1].x)<1e-9&&Math.round(e.points[0].x)===1000)
  assert.deepEqual(cap.points.map(p=>Math.round(p.y)).sort((a,b)=>a-b),[-20,220],'단면 정리선이 마감면까지')
})

test('H85 잘못된 값: 범위 밖은 잘라 맞추고, 그릴 수 없는 철제 문틀은 한국어 오류', () => {
  assert.equal(values(DOOR_FIELDS,{finishThickness:-5}).finishThickness,0);assert.equal(values(DOOR_FIELDS,{finishThickness:999}).finishThickness,200)
  assert.equal(values(DOOR_FIELDS,{finishThickness:'abc'}).finishThickness,0);assert.equal(values(DOOR_FIELDS,{doorType:'wood'}).doorType,'swing')
  assert.equal(values(DOOR_FIELDS,{steelPlate:0}).steelPlate,0.5);assert.equal(values(DOOR_FIELDS,{steelDepth:-10}).steelDepth,0);assert.equal(values(DOOR_FIELDS,{runMode:'x'}).runMode,'dialog')
  const steel=extra=>values(DOOR_FIELDS,{doorType:'steel',...extra})
  assert.doesNotThrow(()=>validateDoorValues(steel({})))
  assert.throws(()=>validateDoorValues(steel({frameWidth:3})),/틀 폭\(3 mm\).*두 배/)
  assert.throws(()=>validateDoorValues(steel({steelDepth:3})),/깊이\(3 mm\)/)
  assert.throws(()=>validateDoorValues({...steel({}),finishThickness:-1}),/마감 두께는 0~200/)
  assert.throws(()=>validateDoorValues({...steel({}),steelPlate:0}),/철판 두께는 양수/)
  assert.throws(()=>validateDoorValues(values(DOOR_FIELDS,{split:'fixed',fixedWidth:900,width:900})),/고정폭은 문 폭보다 작아야/)
  assert.throws(()=>validateDoorValues({...values(DOOR_FIELDS),width:0}),/문 폭은 양수/)
  const f=wallFrame({x:0,y:0},{x:5000,y:0},{x:0,y:200})
  assert.throws(()=>buildDoor(f,steel({frameWidth:0}),doorShared),/틀 폭/)
  assert.throws(()=>buildDoor(wallFrame({x:0,y:0},{x:5000,y:0},{x:0,y:2}),steel({steelDepth:0}),doorShared),/깊이\(2 mm\)/,'깊이 0(벽 두께 전체)인데 벽이 너무 얇으면')
  assert.throws(()=>doorPreviewSvg(steel({frameWidth:2}),doorShared),/틀 폭/,'미리보기도 같은 오류(대화상자가 오류 문구로 보여 준다)')
})

test('H85 두 점 벽 좌표계: 첫 점은 벽 끝으로 붙고 벽 안쪽을 향하며, 모서리에서는 반대 벽과 평행한 벽선을 고른다', () => {
  const walls=wall200(0,5000)
  const f=wallEndFrame(walls,{x:3,y:-4},{x:500,y:203},10,{layers:[{id:'LC',name:'A-WALL-C'}]})
  assert.deepEqual([f.origin.x,f.origin.y,Math.round(f.u.x),Math.round(f.u.y),f.t],[0,0,1,0,200]);assert.equal(f.snapped.opposite.id,'b')
  const g=wallEndFrame(walls,{x:4996,y:2},{x:4500,y:200},10)
  assert.deepEqual([g.origin.x,g.origin.y,Math.round(g.u.x),g.t],[5000,0,-1,200])
  const mid=wallEndFrame(walls,{x:2000,y:3},{x:2400,y:200},10);assert.deepEqual([mid.origin.x,mid.origin.y,Math.round(mid.u.x)],[2000,0,1],'끝에서 멀면 찍은 점의 수선 발')
  const room=[{id:'o',type:'polyline',closed:true,points:[{x:0,y:0},{x:6000,y:0},{x:6000,y:4000},{x:0,y:4000}],layer:'L1'},{id:'i',type:'polyline',closed:true,points:[{x:200,y:200},{x:5800,y:200},{x:5800,y:3800},{x:200,y:3800}],layer:'L1'}]
  const c=wallEndFrame(room,{x:1,y:1},{x:1000,y:201},10);assert.deepEqual([c.origin.x,c.origin.y,Math.round(c.u.x),Math.round(c.u.y),c.t],[0,0,1,0,200],'모서리: 아래 벽선')
  const c2=wallEndFrame(room,{x:1,y:1},{x:201,y:1000},10);assert.deepEqual([Math.round(c2.u.x),Math.round(c2.u.y),c2.t],[0,1,200],'모서리: 왼쪽 벽선')
  assert.throws(()=>wallEndFrame(walls,{x:0,y:900},{x:500,y:200},10),/힌지 쪽 벽선/)
})

test('H85 명령행 순서: D3 → 종류(철제 S) → 벽 끝·반대 벽 → 폭 → 벽 거리 → 마감 두께, 입력값은 다음 실행 기본값으로 저장', async () => {
  const walls=[...wall200(0,5000),{id:'end',type:'line',points:[{x:0,y:0},{x:0,y:200}],layer:'L1'}]
  const layers=[{id:'L1',name:'A-WALL'},{id:'L2',name:'A-WALL'},{id:'LC',name:'A-WALL-C',linetype:'CENTER'}]
  const r=await runDoorCard(2,{...doorSlotDefaults(2),runMode:'sequence'},[{x:3,y:-4},{x:500,y:203}],walls,layers,{type:'S',numbers:[1000,100,20]})
  assert.equal(r.error,undefined);assert.deepEqual(r.form,['doorType']);assert.equal(r.formValue,'W','종류 기본값은 지금 칸의 종류 글자');assert.deepEqual(r.picks,[2],'두 점')
  assert.deepEqual(r.asked.map(s=>s.split(' ')[0]),['문','벽','마감'])
  assert.match(r.toast,/폭 1000 · 철제문 · 마감 20/)
  assert.deepEqual(r.commit.removeIds.sort(),['a','b'])
  const pieces=r.commit.entities.filter(e=>e.type==='line'&&e.layer==='L1'&&Math.abs(e.points[0].y-e.points[1].y)<1e-9).map(xs).sort((p,q)=>p[0]-q[0])
  assert.deepEqual(pieces,[[0,100],[1190,5000]],'벽 끝에서 100 띄우고 폭 1000 + 문틀 2×45')
  assert.equal(r.commit.entities.filter(e=>e.type==='polyline'&&e.points.length===8).length,2,'철판 문틀 두 개')
  const saved=JSON.parse(r.store.get(DOOR_STORAGE_KEY)).presets[2]
  assert.deepEqual([saved.runMode,saved.doorType,saved.width,saved.offset,saved.finishThickness],['sequence','steel',1000,100,20])
  const cancelled=await runDoorCard(2,{runMode:'sequence'},null,walls,layers);assert.equal(cancelled.commit,undefined,'Esc 로 점 입력을 멈추면 아무것도 그리지 않는다')
  const rejected=await runDoorCard(2,{runMode:'sequence',frameWidth:2},[{x:3,y:-4},{x:500,y:203}],walls,layers,{type:'s',numbers:[900,0,0]})
  assert.equal(rejected.commit,undefined,'그릴 수 없는 철제 문틀은 커밋하지 않는다');assert.match(String(rejected.error?.message),/틀 폭/)
  const wrong=await runDoorCard(2,{runMode:'sequence'},[{x:3,y:-4},{x:500,y:203}],walls,layers,{type:'X'})
  assert.match(String(wrong.error?.message),/W\(여닫이\)·D\(양개\)·P\(편개\)·S\(철제\)/);assert.equal(wrong.picks,undefined,'틀린 종류면 점을 묻지 않는다(폼이 오류를 보이고 남는다)')
  const enter=await runDoorCard(2,{runMode:'sequence',doorType:'single'},[{x:3,y:-4},{x:500,y:203}],walls,layers,{type:'',numbers:[1800]})
  assert.equal(enter.formValue,'P');assert.equal(enter.commit.entities.filter(e=>e.type==='arc').length,1,'빈칸 Enter = 저장된 종류(편개) → 폭 1800 도 한 짝');assert.doesNotMatch(enter.toast,/마감/)
})

test('H85 종류 입력 글자: W 여닫이 · D 양개 · P 편개 · S 철제, 한글 자판·한글 이름도 받고 빈칸은 기본값', () => {
  assert.deepEqual(DOOR_TYPE_LETTERS,{swing:'W',double:'D',single:'P',steel:'S'})
  for(const [text,type] of [['W','swing'],['d','double'],['P','single'],['s','steel'],['ㄴ','steel'],['ㅇ','double'],['ㅔ','single'],['ㅈ','swing'],['철제','steel'],['편개','single'],['양개','double'],['여닫이','swing'],[' S ','steel'],['steel','steel']])assert.equal(parseDoorTypeOption(text),type,text)
  assert.equal(parseDoorTypeOption('','single'),'single');assert.equal(parseDoorTypeOption(null),'swing')
  for(const bad of ['X','SS','철','1','constructor','toString'])assert.equal(parseDoorTypeOption(bad),null,bad)
})

test('STP 손스침 끝마감은 첫·끝 챌판과 중복 생성하지 않는다',async()=>{
 const {planOverkill}=await import('./drawing-cleanup.js');
 for(const kind of ['turn','straight'])for(const angle of [0,37]){
  const rad=angle*Math.PI/180,f=wallFrame({x:0,y:0},{x:Math.cos(rad),y:Math.sin(rad)},{x:-Math.sin(rad),y:Math.cos(rad)});
  const r=buildStairPlan(f,1200,values(STP_FIELDS,{kind,count:18,floorHeight:3000}),stairShared);
  const entities=r.entities.map((e,i)=>({...e,id:String(i),layer:e.cardLayer}));
  const over=planOverkill({entities});
  assert.equal(over.duplicates,0,kind+' @'+angle);assert.equal(over.merged,0,kind+' @'+angle);
  assert.ok(entities.some(e=>e.type==='polyline'));assert.ok(entities.some(e=>e.text==='UP'));
 }
});

// 켜 이름으로 벽과 다른 도형을 구분하고 실 연결 표식은 벽 표식보다 먼저 보호한다.
test('벽선 절단: 표준 켜는 벽 켜만, 사무소 비표준 벽 켜는 종전처럼 자르고 실 연결 경계는 보존한다',()=>{
 const f=wallFrame({x:0,y:0},{x:1000,y:0},{x:0,y:200});
 const names=['A-WALL','A-WALL-CONC','S-CONC-WALL','A-SITE','A-GLAZ','A-DOOR','A-STAIR','S-CONC-SLAB','벽체'];
 const layers=names.map((name,i)=>({id:'layer-'+i,name}));
 const entities=layers.map((l,i)=>({id:'e-'+i,type:'polyline',layer:l.id,closed:true,points:[{x:0,y:200},{x:5000,y:200},{x:5000,y:4000},{x:0,y:4000}]}));
 entities.push({...entities[0],id:'named-room',room:{name:'거실'},wallPreset:'벽'},
  {...entities[0],id:'tagged-room'}, {id:'tag',type:'text',roomBoundary:'tagged-room'},
  {...entities[0],id:'scheduled-room'}, {id:'table',type:'block',roomSchedule:{rooms:[{sourceId:'scheduled-room'}]}},
  {...entities[0],id:'marked-wall',layer:layers.at(-1).id,wallPreset:'벽'});
 const before=structuredClone(entities),cut=cutWallBand(entities,f,1000,2000,{layers});
 assert.deepEqual(cut.removeIds,['e-0','e-1','e-2','e-8','marked-wall']);
 assert.ok(cut.add.every(e=>e.closed===false));assert.deepEqual(entities,before);
});
