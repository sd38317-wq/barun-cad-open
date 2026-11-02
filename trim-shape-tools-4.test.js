// 4차 FM(470) STR(132) XT(259) B(411) DRL(506) PVL(90) 순수 계산 시험. 화면 없이 export 된 함수만 돌린다.
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  parseFilletInput, absorbFilletArcs, chainLines, filletPolyline, multiFillet,
  crossingTargets, stretchDelta, twoPointDelta,
  trimExtendToBase, isCenterlineEntity,
  breakMultiEntity,
  pathDirection, directionArrows, reversedPoints,
  collectCoordinates, orderCoordinates, coordinateRows, rowsToTsv, parseCoordinateRows, tableEntities, vertexNumberTexts,
} from './trim-shape-tools-4.js'

const r2 = n => { const x = Math.round(n * 100) / 100; return x === 0 ? 0 : x }
const P = pts => pts.map(p => [r2(p.x), r2(p.y)])
const near = (a, b, eps = 1e-6) => Math.abs(a - b) < eps
const line = (a, b, rest = {}) => ({ id: rest.id || ('l' + a.join('') + b.join('')), type: 'line', layer: 'ly', ...rest, points: [{ x: a[0], y: a[1] }, { x: b[0], y: b[1] }] })

/* ── FM ── */
test('FM 반지름 문자 · C 를 붙이면 챔퍼', () => {
  assert.deepEqual(parseFilletInput('300'), { chamfer: false, size: 300 })
  assert.deepEqual(parseFilletInput('C300'), { chamfer: true, size: 300 })
  assert.deepEqual(parseFilletInput(' c25 '), { chamfer: true, size: 25 })
  assert.deepEqual(parseFilletInput('0'), { chamfer: false, size: 0 })
  assert.throws(() => parseFilletInput(''))
  assert.throws(() => parseFilletInput('CC30'))
  assert.throws(() => parseFilletInput('-5'))
})

test('FM 연속 필렛 · 이어진 직선 세 개의 모서리 두 곳에 호가 생긴다', () => {
  const a = line([0, 0], [100, 0], { id: 'a' })
  const b = line([100, 0], [100, 100], { id: 'b' })
  const c = line([100, 100], [0, 100], { id: 'c' })
  const r = multiFillet([a, b, c], { size: 10, chamfer: false })
  assert.deepEqual(r.removeIds.sort(), ['a', 'b', 'c'])
  assert.equal(r.entities.filter(e => e.type === 'arc').length, 2)
  assert.equal(r.entities.filter(e => e.type === 'line').length, 3)
  const mid = r.entities.find(e => e.type === 'line' && near(e.points[0].x, 100) && near(e.points[1].x, 100))
  assert.deepEqual(P(mid.points), [[100, 10], [100, 90]])
})

test('FM C300 형태 · 챔퍼는 호 대신 모따기 선이 생긴다', () => {
  const a = line([0, 0], [100, 0], { id: 'a' })
  const b = line([100, 0], [100, 100], { id: 'b' })
  const r = multiFillet([a, b], { size: 10, chamfer: true })
  assert.equal(r.entities.filter(e => e.type === 'arc').length, 0)
  const chamfer = r.entities.find(e => e.type === 'line' && near(e.points[0].y, 0) && near(e.points[1].x, 100) && near(e.points[1].y, 10))
  assert.ok(chamfer, '모따기 선 (90,0)-(100,10) 이 있어야 한다')
})

test('FM 기존 호 재정리 · 선택에 든 옛 필렛 호를 지우고 두 선을 교차점까지 되돌린다', () => {
  const a = line([0, 0], [90, 0], { id: 'a' })
  const b = line([100, 10], [100, 100], { id: 'b' })
  const arc = { id: 'arc', type: 'arc', layer: 'ly', center: { x: 90, y: 10 }, radius: 10, startAngle: 270, endAngle: 0 }
  const fixed = absorbFilletArcs([a, b], [arc])
  assert.equal(fixed.arcs.length, 1)
  assert.deepEqual(P(fixed.lines[0].points), [[0, 0], [100, 0]])
  assert.deepEqual(P(fixed.lines[1].points), [[100, 0], [100, 100]])
  const r = multiFillet([a, b, arc], { size: 20, chamfer: false })
  assert.ok(r.removeIds.includes('arc'))
  assert.equal(r.reusedArcs, 1)
  const made = r.entities.find(e => e.type === 'arc')
  assert.equal(r2(made.radius), 20)
})

test('FM 폴리선 한 개 · 닫힌 사각형의 네 모서리를 모두 처리한다', () => {
  const poly = { id: 'p', type: 'polyline', layer: 'ly', closed: true, points: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }] }
  const fillet = filletPolyline(poly, 10, false)
  assert.equal(fillet.skipped, 0)
  assert.equal(fillet.entities.filter(e => e.type === 'arc').length, 4)
  assert.equal(fillet.entities.filter(e => e.type === 'line').length, 4)
  const chamfer = filletPolyline(poly, 10, true)
  assert.equal(chamfer.entities.length, 1)
  assert.equal(chamfer.entities[0].type, 'polyline')
  assert.equal(chamfer.entities[0].points.length, 8)
  assert.throws(() => filletPolyline({ type: 'polyline', points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] }, 1, false))
})

test('FM 갈라진 묶음은 거부한다(chainLines)', () => {
  const a = line([0, 0], [10, 0], { id: 'a' })
  const b = line([10, 0], [20, 0], { id: 'b' })
  const c = line([10, 0], [10, 10], { id: 'c' })
  assert.throws(() => chainLines([a, b, c]))
  assert.equal(chainLines([a, b]).length, 2)
})

/* ── STR ── */
test('STR 크로싱 상자 안의 정점만 대상이 된다', () => {
  const wall = { id: 'w', type: 'line', points: [{ x: 0, y: 0 }, { x: 1000, y: 0 }] }
  const text = { id: 't', type: 'text', position: { x: 900, y: 50 }, text: '실', height: 3 }
  const far = { id: 'f', type: 'line', points: [{ x: -100, y: 0 }, { x: -50, y: 0 }] }
  const targets = crossingTargets([wall, text, far], { x: 800, y: -100 }, { x: 1200, y: 100 })
  assert.equal(targets.length, 2)
  assert.deepEqual(targets[0], { id: 'w', indices: [1], center: false, position: false })
  assert.equal(targets[1].position, true)
})

test('STR 거리·각도 따로 입력 · 빼기 기능은 상수를 뺀 거리로 움직인다', () => {
  const plain = stretchDelta({ distance: 1500, angle: 0 })
  assert.equal(r2(plain.x), 1500)
  assert.equal(r2(plain.y), 0)
  const minus = stretchDelta({ distance: 1500, angle: 0, subtract: true, subtractBy: 2 })
  assert.equal(r2(minus.x), 1498)
  assert.equal(minus.subtracted, 2)
  const up = stretchDelta({ distance: 900, angle: 90, subtract: true, subtractBy: 2 })
  assert.equal(r2(up.x), 0)
  assert.equal(r2(up.y), 898)
  assert.throws(() => stretchDelta({ distance: 2, angle: 0, subtract: true, subtractBy: 2 }))
  assert.throws(() => stretchDelta({ distance: NaN, angle: 0 }))
})

test('STR 동시 입력 · 두 점에서 거리와 각도를 얻는다', () => {
  const r = twoPointDelta({ x: 0, y: 0 }, { x: 0, y: 300 })
  assert.equal(r2(r.distance), 300)
  assert.equal(r2(r.angle), 90)
  assert.throws(() => twoPointDelta({ x: 1, y: 1 }, { x: 1, y: 1 }))
})

/* ── XT ── */
test('XT 길면 자르고 짧으면 연장 · 같은 계산 한 번으로 갈린다', () => {
  const base = line([0, 0], [0, 100], { id: 'base' })      // 세로 기준선(x=0)
  const long = line([-50, 20], [50, 20], { id: 'long' })   // 오른쪽으로 50 삐져나옴
  const short = line([-50, 40], [-10, 40], { id: 'short' }) // 오른쪽에 10 못 미침
  const pick = { x: 30, y: 50 }                             // 오른쪽을 정리
  const a = trimExtendToBase(long, base, pick, 0)
  assert.equal(a.action, 'trim')
  assert.deepEqual(P(a.points), [[-50, 20], [0, 20]])
  const b = trimExtendToBase(short, base, pick, 0)
  assert.equal(b.action, 'extend')
  assert.deepEqual(P(b.points), [[-50, 40], [0, 40]])
})

test('XT 남길 길이만큼 기준선 밖으로 내민다 · 반대쪽을 클릭하면 반대쪽이 정리된다', () => {
  const base = line([0, 0], [0, 100], { id: 'base' })
  const target = line([-50, 20], [50, 20], { id: 't' })
  const right = trimExtendToBase(target, base, { x: 30, y: 50 }, 5)
  assert.deepEqual(P(right.points), [[-50, 20], [5, 20]])
  const left = trimExtendToBase(target, base, { x: -30, y: 50 }, 5)
  assert.deepEqual(P(left.points), [[-5, 20], [50, 20]])
  assert.throws(() => trimExtendToBase(line([-50, 0], [50, 0]), line([-50, 10], [50, 10]), { x: 0, y: 20 }, 0))
})

test('XT 중심선 판정 · 선종류 CENTER 또는 중심선·축선 켜', () => {
  const layers = [{ id: 'L1', name: 'A-WALL-C' }, { id: 'L2', name: 'A-WALL' }]
  assert.equal(isCenterlineEntity({ layer: 'L1' }, layers), true)
  assert.equal(isCenterlineEntity({ layer: 'L2', linetype: 'CENTER' }, layers), true)
  assert.equal(isCenterlineEntity({ layer: 'L2', linetype: 'CONTINUOUS' }, layers), false)
})

/* ── B ── */
test('B 두 점 지정 · 그 구간을 들어내고 양옆을 남긴다', () => {
  const e = { id: 'e', type: 'line', layer: 'ly', points: [{ x: 0, y: 0 }, { x: 100, y: 0 }] }
  const r = breakMultiEntity(e, [{ x: 30, y: 5 }, { x: 70, y: -5 }], 'gap')
  assert.equal(r.removeId, 'e')
  assert.equal(r.pieces.length, 2)
  assert.deepEqual(P(r.pieces[0].points), [[0, 0], [30, 0]])
  assert.deepEqual(P(r.pieces[1].points), [[70, 0], [100, 0]])
  assert.equal(r.pieces[0].layer, 'ly')
})

test('B 한 점 + 엔터 · 그 점에서 둘로 끊는다', () => {
  const e = { id: 'e', type: 'line', points: [{ x: 0, y: 0 }, { x: 100, y: 0 }] }
  const r = breakMultiEntity(e, [{ x: 40, y: 0 }], 'split')
  assert.equal(r.pieces.length, 2)
  assert.deepEqual(P(r.pieces[0].points), [[0, 0], [40, 0]])
  assert.deepEqual(P(r.pieces[1].points), [[40, 0], [100, 0]])
})

test('B 여러점(M) · 점마다 끊어 조각이 늘어난다', () => {
  const e = { id: 'e', type: 'line', points: [{ x: 0, y: 0 }, { x: 100, y: 0 }] }
  const r = breakMultiEntity(e, [{ x: 25, y: 0 }, { x: 50, y: 0 }, { x: 75, y: 0 }], 'split')
  assert.equal(r.pieces.length, 4)
  assert.deepEqual(P(r.pieces[1].points), [[25, 0], [50, 0]])
})

test('B 폴리선 · 두 점 사이를 들어내면 앞뒤 조각이 남는다', () => {
  const e = { id: 'p', type: 'polyline', closed: false, points: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }] }
  const r = breakMultiEntity(e, [{ x: 50, y: 0 }, { x: 100, y: 50 }], 'gap')
  assert.equal(r.pieces.length, 2)
  assert.deepEqual(P(r.pieces[0].points), [[0, 0], [50, 0]])
  assert.deepEqual(P(r.pieces[1].points), [[100, 50], [100, 100]])
})

test('B 원 · 두 점으로 호 하나가 남는다(반시계로 둘째 점 → 첫째 점)', () => {
  const e = { id: 'c', type: 'circle', layer: 'ly', center: { x: 0, y: 0 }, radius: 10 }
  const r = breakMultiEntity(e, [{ x: 10, y: 0 }, { x: 0, y: 10 }], 'gap')
  assert.equal(r.pieces.length, 1)
  assert.equal(r.pieces[0].type, 'arc')
  assert.ok(near(r.pieces[0].startAngle, 90) && near(r.pieces[0].endAngle, 0))
  const four = breakMultiEntity(e, [{ x: 10, y: 0 }, { x: 0, y: 10 }, { x: -10, y: 0 }, { x: 0, y: -10 }], 'split')
  assert.equal(four.pieces.length, 4)
})

test('B 는 문자 같은 비선형 객체를 거부한다', () => {
  assert.throws(() => breakMultiEntity({ type: 'text', position: { x: 0, y: 0 } }, [{ x: 0, y: 0 }], 'gap'))
  assert.throws(() => breakMultiEntity({ type: 'line', points: [{ x: 0, y: 0 }, { x: 10, y: 0 }] }, [{ x: 3, y: 0 }], 'gap'))
})

/* ── DRL ── */
test('DRL 진행 방향 판정과 역전', () => {
  const ccw = { type: 'polyline', closed: true, points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }] }
  assert.equal(pathDirection(ccw), 'ccw')
  assert.equal(pathDirection({ ...ccw, points: [...ccw.points].reverse() }), 'cw')
  assert.equal(pathDirection({ type: 'line', points: [{ x: 0, y: 0 }, { x: 1, y: 0 }] }), null)
  assert.deepEqual(P(reversedPoints({ type: 'line', points: [{ x: 0, y: 0 }, { x: 5, y: 1 }] })), [[5, 1], [0, 0]])
  assert.deepEqual(P(reversedPoints(ccw)), P([...ccw.points].reverse()))
  assert.throws(() => reversedPoints({ type: 'text', position: { x: 0, y: 0 } }))
})

test('DRL 화살표 임시선 · 구간마다 화살촉 두 선 + 시작점 표시', () => {
  const e = { type: 'polyline', closed: false, points: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }] }
  const arrows = directionArrows(e, 10)
  assert.equal(arrows[0].type, 'circle')
  assert.deepEqual([r2(arrows[0].center.x), r2(arrows[0].center.y)], [0, 0])
  assert.equal(arrows.filter(a => a.type === 'line').length, 4)
  const head = arrows[1]
  assert.deepEqual(P([head.points[0]]), [[55, 0]]) // 첫 구간 중점 50 + 화살촉 절반 5
})

/* ── PVL ── */
test('PVL 구분별 좌표 수집', () => {
  const entities = [
    { id: 'p', type: 'polyline', closed: true, points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }] },
    { id: 'c', type: 'circle', center: { x: 5, y: 5 }, radius: 2 },
    { id: 't', type: 'text', position: { x: 1, y: 2 }, text: 'A', height: 2 },
  ]
  assert.equal(collectCoordinates(entities, 'polyline').length, 3)
  assert.deepEqual(collectCoordinates(entities, 'circle'), [{ x: 5, y: 5, z: 0, sourceId: 'c', vertex: 0 }])
  assert.equal(collectCoordinates(entities, 'block').length, 0)
  assert.equal(collectCoordinates(entities, 'text')[0].x, 1)
})

test('PVL 정렬기준점 및 순서 · 오차 안의 점은 같은 줄로 본다', () => {
  const list = [{ x: 10, y: 0 }, { x: 0, y: 100 }, { x: 0, y: 5 }, { x: 10, y: 95 }]
  const tl = orderCoordinates(list, { pattern: 'TL', tolerance: 10 })
  assert.deepEqual(tl.map(p => [p.x, p.y]), [[0, 100], [10, 95], [0, 5], [10, 0]])
  const br = orderCoordinates(list, { pattern: 'BR', tolerance: 10 })
  assert.deepEqual(br.map(p => [p.x, p.y]), [[10, 0], [0, 5], [10, 95], [0, 100]])
  const tight = orderCoordinates(list, { pattern: 'TL', tolerance: 1 })
  assert.deepEqual(tight.map(p => [p.x, p.y]), [[0, 100], [10, 95], [0, 5], [10, 0]])
  assert.deepEqual(orderCoordinates(list, { pickOrder: true }).map(p => p.x), [10, 0, 0, 10])
})

test('PVL 표 만들기와 되읽기 · 번호 열이 있어도 좌표만 되읽는다', () => {
  const list = [{ x: 0, y: 0, z: 0 }, { x: 1500.5, y: -20, z: 0 }]
  const rows = coordinateRows(list, { includeZ: false })
  assert.deepEqual(rows[0], ['번호', 'X', 'Y'])
  assert.deepEqual(rows[2], ['2', '1500.5', '-20'])
  const tsv = rowsToTsv(rows)
  assert.equal(tsv.split('\n').length, 3)
  const back = parseCoordinateRows(tsv, { includeZ: false })
  assert.deepEqual(back.map(p => [p.x, p.y]), [[0, 0], [1500.5, -20]])
  const zrows = coordinateRows(list, { includeZ: true })
  assert.deepEqual(zrows[0], ['번호', 'X', 'Y', 'Z'])
  assert.deepEqual(parseCoordinateRows('0 0 0\n10, 20, 30', { includeZ: true }).map(p => [p.x, p.y, p.z]), [[0, 0, 0], [10, 20, 30]])
  assert.throws(() => parseCoordinateRows('X\tY\n', { includeZ: false }))
})

test('PVL 캐드표 객체 · 칸선과 칸 문자가 모두 생긴다', () => {
  const rows = coordinateRows([{ x: 0, y: 0 }, { x: 10, y: 20 }], { includeZ: false })
  const out = tableEntities(rows, { origin: { x: 100, y: 200 }, height: 2.5, layerName: 'A-TEXT' })
  const texts = out.filter(e => e.type === 'text'), lines = out.filter(e => e.type === 'line')
  assert.equal(texts.length, 9)          // 머리글 3 + 두 행 6
  assert.equal(lines.length, 4 + 4)      // 가로 4(행 3개+1) + 세로 4(열 3개+1)
  assert.equal(texts[0].text, '번호')
  assert.ok(texts.every(t => t.cardLayer === 'A-TEXT'))
  assert.ok(texts[0].position.y < 200 && texts[0].position.x > 100)
  assert.throws(() => tableEntities([], { origin: { x: 0, y: 0 } }))
})

test('PVL 정점 번호 문자', () => {
  const out = vertexNumberTexts([{ x: 0, y: 0 }, { x: 10, y: 0 }], { height: 2, layerName: 'A-TEXT' })
  assert.deepEqual(out.map(t => t.text), ['1', '2'])
  assert.equal(out[0].height, 2)
  assert.equal(out[1].cardLayer, 'A-TEXT')
})

/* ── 진입점 ── */
test('installTrimShapeTools4 는 명령 6개를 돌려준다(DOM 없이)', async () => {
  const { installTrimShapeTools4 } = await import('./trim-shape-tools-4.js')
  const ctx = { storage: null, entities: () => [], layers: () => [], selected: () => [], toast() {}, log() {}, userErrorMessage: e => e.message }
  const commands = installTrimShapeTools4(ctx)
  assert.deepEqual(Object.keys(commands).sort(), ['B', 'DRL', 'FM', 'PVL', 'STR', 'XT'])
  assert.ok(Object.values(commands).every(f => typeof f === 'function'))
})
