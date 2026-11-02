// 파란 네모(그립)를 눌러 끌면 도형이 실제로 고쳐지는가.
// 엔진 쪽 gripCommand 는 priority-one 에서 보지만, 마우스로 이어지는 길은 여기서 본다.
// 첫 미세 이동 드래그 문턱이 들어간 뒤 이 길이 끊기지 않았는지 확인한다.
import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import fs from 'node:fs'
import * as G from './geometry.js'
import { DrawingEngine } from './engine.js'

const source = fs.readFileSync(new URL('./app.js', import.meta.url), 'utf8')
const begin = source.indexOf('function moveDragPreview(command){')
const end = source.indexOf('canvas.addEventListener("pointercancel"')

/** app.js 의 포인터 처리 부분만 떼어 내 가짜 화면에서 돌린다. */
function stage(entity, selectedInitially=true) {
  // 문서는 엔진이 직접 만들게 한다. 손으로 만든 문서는 미리보기 엔진이 거부한다.
  const engine = new DrawingEngine()
  const [id] = engine.execute({ type: 'add', entity: { ...entity, layer: 'default' } })
  const events = {}
  const context = {
    handleOverlapSelection:()=>null,
    G, DrawingEngine, engine, structuredClone, performance,
    interaction:{value:0,tag:value=>({...value,interactionEpoch:0}),accepts:value=>value?.interactionEpoch===0},
    inputState:()=>`${context.mode}.${context.phase}`,traceInput(){},scheduleEngineUiRefresh(){},
    lastCanvasPointerId:null,lastSelectDown:null,selectDoubleClickEpoch:-1,
    rebuildArchitecture: (entity) => entity,
    wallOpening: () => { throw Error('이 시험에서는 벽 개구부를 사용하지 않습니다.') },
    drag: null, mode: 'SELECT', phase: 'idle', busy: false, space: false, origin: { x: 0, y: 0 },
    cursor: { x: 0, y: 0 }, rawCursor: { x: 0, y: 0 }, params: {}, selected: new Set(selectedInitially?[id]:[]),
    chosen: () => engine.doc.entities.filter(e => context.selected.has(e.id)),
    editable: () => engine.doc.entities,
    layerMap: () => new Map(engine.doc.layers.map(l => [l.id, l])),
    // 화면 좌표 = 도면 좌표(1:1). 그래야 시험에서 거리를 바로 읽을 수 있다.
    screen: (p) => ({ x: p.x, y: p.y }), world: (p) => ({ x: p.x, y: p.y }),
    localPoint: (e) => ({ x: e.x, y: e.y }), snap: (p) => p,
    pick: (p) => engine.doc.entities.find(e => G.entityDistance(e, p) < 2) || null,
    execute: (command) => engine.execute(command),
    safe: (fn) => fn(), refresh() { }, render() { }, toast() { },
    syncCurrentLayerChooser: (layerId) => { context.syncedLayer = layerId },
    requestAnimationFrame: (fn) => { context.frames.push(fn); return context.frames.length },
    cancelAnimationFrame: (id) => { context.frames[id - 1] = null },
    frames: [],
    rememberView() { }, pickWallCenterline() { }, beginSelection() { },
    objectPickCursor: () => context.mode==='SELECT'||context.mode==='MATCHPROP'||['select','window','pick','offset-object','insulation-select','wall-center-pick'].includes(context.phase),
    $: () => ({ textContent: '' }), fmt: (n) => String(n),
    canvas: {
      focus() { }, setPointerCapture() { }, releasePointerCapture() { }, hasPointerCapture: () => false,
      addEventListener: (name, fn) => { events[name] = fn },
      getBoundingClientRect: () => ({ left: 0, top: 0 }),
    },
  }
  vm.createContext(context)
  vm.runInContext(source.slice(begin, end), context)
  const flush = () => { for (const fn of context.frames.splice(0)) fn?.() }
  return {
    engine, context,
    drag(from, to) {
      events.pointerdown({ button: 0, pointerId: 1, x: from.x, y: from.y, shiftKey: false, preventDefault() { } })
      events.pointermove({ buttons: 1, pointerId: 1, x: to.x, y: to.y })
      flush()
      this.previewBeforeCommit = structuredClone(context.drag?.preview)
      this.documentBeforeCommit = structuredClone(engine.doc)
      events.pointerup({ pointerId: 1, x: to.x, y: to.y })
    },
  }
}

const line = { type: 'line', points: [{ x: 0, y: 0 }, { x: 100, y: 0 }] }

test('선택한 선은 양 끝점과 중간점 그립을 표시한다', () => {
  assert.deepEqual(G.selectionGrips(line), [{x:0,y:0},{x:50,y:0},{x:100,y:0}])
})

test('오른쪽 정렬 문자의 실제 왼쪽 영역도 선택할 수 있다', () => {
  const text={type:'text',text:'ABCD',position:{x:100,y:100},height:10,align:'right'}
  assert.equal(G.entityDistance(text,{x:80,y:105}),0)
  assert.ok(G.entityDistance(text,{x:110,y:105})>0)
})

test('그립을 눌러 끌면 선 끝점이 따라온다', () => {
  const s = stage(line)
  const grip = G.editingGrips(s.engine.doc.entities[0]).find(g => G.dist(g.point, { x: 100, y: 0 }) < 1)
  assert.ok(grip, '끝점 그립이 있어야 한다')
  s.drag({ x: 100, y: 0 }, { x: 100, y: 60 })
  assert.deepEqual(s.engine.doc.entities[0].points[1], { x: 100, y: 60 })
})

test('0.5px 미만의 좌표 잡음만 있으면 도면은 그대로다', () => {
  const s = stage(line)
  s.drag({ x: 100, y: 0 }, { x: 100.2, y: .2 })
  assert.deepEqual(s.engine.doc.entities[0].points[1], { x: 100, y: 0 })
})

test('마우스의 첫 1px 이동 이벤트부터 (이미 고른) 객체 드래그가 시작된다', () => {
  const s = stage(line, true)
  s.drag({ x: 50, y: 0 }, { x: 50, y: 1 })
  assert.deepEqual(s.engine.doc.entities[0].points, [{ x: 0, y: 1 }, { x: 100, y: 1 }])
  assert.equal(s.context.selected.size,1)
})

test('선택한 선의 몸통을 누른 채 끌면 바로 이동한다', () => {
  const s = stage(line)
  s.drag({ x: 50, y: 0 }, { x: 50, y: 40 })        // 그립이 아닌 선 위를 잡는다
  assert.deepEqual(s.engine.doc.entities[0].points, [{ x: 0, y: 40 }, { x: 100, y: 40 }])
})

test('선택하지 않은 선은 끌어도 움직이지 않는다(오토캐드: 끌면 선택창)', () => {
  const s = stage(line, false)
  s.drag({ x: 50, y: 0 }, { x: 50, y: 40 })
  assert.deepEqual(s.engine.doc.entities[0].points, [{ x: 0, y: 0 }, { x: 100, y: 0 }])
  assert.equal(s.context.syncedLayer, 'default', '누르는 순간 해당 객체 레이어를 상단에 표시해야 한다')
})

test('원과 사각형도 몸통을 누른 채 끌면 바로 움직인다', () => {
  const circle = stage({ type: 'circle', center: { x: 50, y: 50 }, radius: 40 })
  circle.drag({ x: 78.28, y: 78.28 }, { x: 120, y: 120 })
  assert.deepEqual(circle.engine.doc.entities[0].center, { x: 91.72, y: 91.72 })
  const rectangle = stage({ type: 'rectangle', points: [{x:0,y:0},{x:100,y:0},{x:100,y:80},{x:0,y:80}], closed:true })
  rectangle.drag({ x: 50, y: 0 }, { x: 80, y: 30 })
  assert.deepEqual(rectangle.engine.doc.entities[0].points, [{x:30,y:30},{x:130,y:30},{x:130,y:110},{x:30,y:110}])
})

test('드래그 미리보기는 매 프레임 도면 전체를 복제하거나 JSON 비교하지 않는다', () => {
  const body=source.slice(begin,source.indexOf('const DRAG_THRESHOLD_MOUSE',begin))
  assert.doesNotMatch(body,/structuredClone\(engine\.doc\)/)
  assert.doesNotMatch(body,/JSON\.stringify/)
  assert.match(body,/previewTransformEntity\(e,'translate'/,'이동 미리보기는 좌표 변환 래퍼를 사용해야 한다')
  assert.match(body,/count>800/,'큰 블록 미리보기는 외곽선으로 단순화해야 한다')
})

test('선택은 전체 도면 재검색과 첫 클릭 인덱스 생성을 피한다', () => {
  assert.match(source,/chosen\s*=\s*\(\)\s*=>\s*selected\.size\?\[\.\.\.selected\]\.map\(id=>entityMap\(\)\.get\(id\)\)/)
  assert.match(source,/warmNearbyIndex\(visibleEntities\)/)
  const warm=source.slice(source.indexOf('function warmNearbyIndex'),source.indexOf('// 선택 상자에 걸릴 수 있는 후보'))
  assert.doesNotMatch(warm,/prepareEntityDistanceIndex|warmBlocks/,'열기 뒤 모든 블록 인덱스를 백그라운드에서 만들면 대형 도면이 계속 버벅인다')
  assert.match(source,/prepareNearbyIndexNow\(\)/,'첫 편집 전에 최상위 선택 인덱스가 준비되어야 한다')
  assert.match(source,/G\.querySnapPrimitives\(entity,box\)/,'블록 스냅은 마우스 주변 요소만 조회해야 한다')
  assert.match(source,/pickDisplayEntity\(nearby\(p,tolerance\),p,tolerance,options/)
  const picking=fs.readFileSync(new URL('./display-picking.js',import.meta.url),'utf8')
  assert.match(picking,/pickDistance\(entity, point, tolerance, best\)/,'공통 선택 경로도 현재 최단 거리를 공간 조회에 전달해야 한다')
  assert.match(source,/nearby\.objectsGeneration!==pickGeneration\(\)/,'선택 인덱스는 후보 세대가 바뀌면 다시 만들어야 한다')
  // 작은 도면의 후보는 화면(visible) 세대를 따른다. 대형 도면은 도면 전체 후보를 쓰므로 팬·줌으로 낡지 않는다.
  assert.match(source,/function pickGeneration\(\)\{return engine\.doc\.entities\.length>50000\?-1:visibleGeneration;\}/,'작은 도면은 팬·줌 뒤 현재 화면 기준 인덱스를 써야 한다')
})

test('잠긴 레이어의 그립은 움직이지 않는다', () => {
  const s = stage(line)
  s.engine.doc.layers.find(l => l.id === s.engine.doc.entities[0].layer).locked = true
  s.drag({ x: 100, y: 0 }, { x: 100, y: 60 })
  assert.deepEqual(s.engine.doc.entities[0].points[1], { x: 100, y: 0 })
})

test('치수선 그립도 같은 길로 움직인다', () => {
  const dimension = { type: 'dimension', mode: 'aligned', points: [{ x: 0, y: 0 }, { x: 1000, y: 0 }, { x: 500, y: 300 }], textHeight: 100 }
  const s = stage(dimension)
  const grips = G.editingGrips(s.engine.doc.entities[0])
  assert.ok(grips.length, '치수선에도 그립이 있어야 한다')
  const start = grips[0].point
  s.drag({ x: start.x, y: start.y }, { x: start.x + 300, y: start.y + 300 })
  assert.notDeepEqual(s.engine.doc.entities[0].points, dimension.points)
})

test('dimension line and text drag preview equals the committed geometry', () => {
 for (const kind of ['line','text']) {
  const source={type:'dimension',mode:'horizontal',textHeight:100,arrowType:'filled',points:[{x:0,y:0},{x:1000,y:0},{x:500,y:300}]};
  const s=stage(source),saved=structuredClone(s.engine.doc.entities[0]),grip=G.editingGrips(saved).find(g=>kind==='text'?g.kind==='dimension-text':g.index===2);
  s.drag(grip.point,{x:800,y:900});assert.deepEqual(s.documentBeforeCommit.entities[0],saved);assert.equal(s.previewBeforeCommit[0].type,'dimension');assert.deepEqual(G.dimensionParts(s.engine.doc.entities[0]),G.dimensionParts(s.previewBeforeCommit[0]));
  if(kind==='text')assert.deepEqual(s.engine.doc.entities[0].points,saved.points);
 }
})
