// 자르기 및 끌기 CUT(413) FE(489) BAT(487) BB(412) BRO(415) DIB(312) DTP(501) 기하 시험. 화면 없이 순수 함수만 돌린다.
import test from 'node:test'
import assert from 'node:assert/strict'
import {filletExtend,divideToPolyline,breakToCurrentLine,breakAtIntersections,diagramBoxes,boundaryPolygon,cutTargetsByBoundary,cutAnchorOf,repeatPositions,breakWindowsAndText,BAT_MAX_REPEAT,migrateBatStorage} from './trim-tools.js'

/* ── 2026-09-24 검토 F1: CUT 은 문자·치수·점·타원도 대표점 기준으로 지운다 ── */
test('CUT 경계 안의 문자·치수·점·타원은 통째로 지우고 경계 밖 것은 남긴다', () => {
  const box = { id: 'b', type: 'polyline', closed: true, points: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }] }
  const entities = [box,
    { id: 't-in', type: 'text', text: '거실', position: { x: 50, y: 50 }, height: 5 },
    { id: 't-out', type: 'text', text: '밖', position: { x: 500, y: 500 }, height: 5 },
    { id: 'p-in', type: 'point', position: { x: 10, y: 10 } },
    { id: 'd-in', type: 'dimension', mode: 'linear', points: [{ x: 10, y: 10 }, { x: 90, y: 10 }, { x: 50, y: 30 }], textHeight: 3 },
    { id: 'l-out', type: 'line', points: [{ x: 300, y: 300 }, { x: 400, y: 300 }] },
  ]
  const r = cutTargetsByBoundary({ entities, boundaries: [box], pick: { x: 50, y: 50 } })
  assert.deepEqual(r.removeIds.sort(), ['d-in', 'p-in', 't-in'])
  assert.deepEqual(cutAnchorOf({ type: 'ellipse', center: { x: 6, y: 6 } }), { x: 6, y: 6 })
  assert.equal(r.add.length, 0)
  // 바깥쪽을 클릭하면 경계 상자와 겹치지 않는 먼 객체도 지운다
  const out = cutTargetsByBoundary({ entities, boundaries: [box], pick: { x: 500, y: 500 } })
  assert.deepEqual(out.removeIds.sort(), ['l-out', 't-out'])
  assert.deepEqual(cutAnchorOf({ type: 'text', position: { x: 1, y: 2 } }), { x: 1, y: 2 })
  assert.deepEqual(cutAnchorOf({ type: 'dimension', points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 4, y: 6 }] }), { x: 4, y: 6 })
})
test('CUT 바깥 삭제는 경계를 감싸는 블록(도곽)을 보존하고 삭제·보존 블록 이름을 돌려준다(재지적 ①)', () => {
  const box = { id: 'b', type: 'polyline', closed: true, points: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }] }
  const tb = { id: 'titleblock', type: 'block', name: 'A1', position: { x: -1000, y: -1000 }, entities: [{ type: 'rectangle', points: [{ x: -1000, y: -1000 }, { x: 5000, y: -1000 }, { x: 5000, y: 4000 }, { x: -1000, y: 4000 }] }] }
  const far = { id: 'far', type: 'block', name: 'DOOR', position: { x: 9000, y: 9000 }, entities: [{ type: 'line', points: [{ x: 9000, y: 9000 }, { x: 9100, y: 9000 }] }] }
  const r = cutTargetsByBoundary({ entities: [box, tb, far], boundaries: [box], pick: { x: 500, y: 500 } })
  assert.deepEqual(r.removeIds, ['far'])
  assert.deepEqual(r.removedBlockNames, ['DOOR'])
  assert.deepEqual(r.skippedBlockNames, ['A1'])
  assert.equal(r.skippedBlock, 1)
})
test('BAT 저장값 v1→v2 이전: 옛 기본값(20·5·2.5)만 버리고 나머지는 옮긴다', () => {
  const m = new Map(); const storage = { getItem: k => m.has(k) ? m.get(k) : null, setItem: (k, v) => m.set(k, v) }
  storage.setItem('trim-bat-v1', JSON.stringify({ presets: [{ name: '설정', gap: 20, cutLen: 5, height: 2.5, text: 'GAS', angleMode: '0', halfFirst: false }], shared: {}, selected: 0 }))
  assert.equal(migrateBatStorage(storage), true)
  const v2 = JSON.parse(storage.getItem('trim-bat-v2'))
  assert.deepEqual(v2.presets[0], { name: '설정', text: 'GAS', angleMode: '0', halfFirst: false })
  assert.ok(storage.getItem('trim-bat-v1'), 'v1 은 지우지 않는다')
  assert.equal(migrateBatStorage(storage), false, 'v2 가 있으면 다시 이전하지 않는다')
  const custom = { getItem: k => k === 'trim-bat-v1' ? JSON.stringify({ presets: [{ gap: 1000, height: 150 }] }) : null, setItem() {} }
  let saved = null; custom.setItem = (k, v) => { saved = JSON.parse(v) }
  migrateBatStorage(custom); assert.deepEqual(saved.presets[0], { gap: 1000, height: 150 }, '사용자가 바꾼 값은 유지')
})
test('BAT 반복 위치는 최대 개수를 넘으면 한글 오류로 막는다(F16)', () => {
  assert.throws(() => repeatPositions(6000, 20, true), new RegExp(`최대 ${BAT_MAX_REPEAT}개`))
  assert.equal(repeatPositions(6000, 1200, true).length, 5)
})

const r2 = n => { const x = Math.round(n * 100) / 100; return x === 0 ? 0 : x }
const P = pts => pts.map(p => [r2(p.x), r2(p.y)])
const near = (a, b, eps = 1e-6) => Math.abs(a - b) < eps

test('FE 길이 남기고 모따기 · G.corner(chamfer=true) 를 그대로 옮긴다', () => {
  const a = { type: 'line', layer: 'ly', points: [{ x: 0, y: 0 }, { x: 5, y: 0 }] }
  const b = { type: 'line', layer: 'ly', points: [{ x: 5, y: 5 }, { x: 5, y: 0 }] }
  const out = filletExtend(a, b, 2)
  assert.equal(out.length, 3)
  assert.deepEqual(P(out[0].points), [[0, 0], [3, 0]])
  assert.deepEqual(P(out[1].points), [[5, 2], [5, 5]])
  assert.deepEqual(P(out[2].points), [[3, 0], [5, 2]])
  assert.throws(() => filletExtend(a, b, -1))
  assert.throws(() => filletExtend({ type: 'polyline', points: a.points }, b, 1))
})

test('DTP 곡선을 직선 조합으로 분할 · 원을 n 등분', () => {
  const circle = { type: 'circle', layer: 'ly', center: { x: 0, y: 0 }, radius: 10 }
  const poly = divideToPolyline(circle, 4)
  assert.equal(poly.type, 'polyline')
  assert.equal(poly.closed, true)
  assert.equal(poly.points.length, 4)
  assert.deepEqual(P(poly.points), [[10, 0], [0, 10], [-10, 0], [0, -10]])
})

test('DTP 호는 열린 폴리선으로(n등분은 정점 n+1개)', () => {
  const arc = { type: 'arc', layer: 'ly', center: { x: 0, y: 0 }, radius: 10, startAngle: 0, endAngle: 90 }
  const poly = divideToPolyline(arc, 3)
  assert.equal(poly.closed, false)
  assert.equal(poly.points.length, 4)
  assert.deepEqual(P(poly.points)[0], [10, 0])
  assert.deepEqual(P(poly.points)[3], [0, 10])
  assert.throws(() => divideToPolyline(arc, 2)) // n 은 3 이상
})
test('DTP 폴리선은 정점 그대로(이 캐드는 불지를 지원하지 않음)', () => {
  const pl = { type: 'polyline', layer: 'ly', closed: false, points: [{ x: 0, y: 0 }, { x: 5, y: 5 }, { x: 10, y: 0 }] }
  const out = divideToPolyline(pl, 8)
  assert.deepEqual(P(out.points), [[0, 0], [5, 5], [10, 0]])
  assert.throws(() => divideToPolyline({ type: 'text' }, 8))
})

test('BB 자르고 현재 켜로 넣기 · 직선 · 가운데가 cut, 양옆이 keep', () => {
  const line = { type: 'line', layer: 'ly', points: [{ x: 0, y: 0 }, { x: 10, y: 0 }] }
  const r = breakToCurrentLine(line, { x: 3, y: 0 }, { x: 7, y: 0 }, { x: 3, y: 0 })
  assert.deepEqual(P(r.cut.points), [[3, 0], [7, 0]])
  assert.equal(r.keep.length, 2)
  assert.deepEqual(P(r.keep[0].points), [[0, 0], [3, 0]])
  assert.deepEqual(P(r.keep[1].points), [[7, 0], [10, 0]])
})
test('BB 원 · anchor 가 있는 쪽 호가 cut', () => {
  const circle = { type: 'circle', layer: 'ly', center: { x: 0, y: 0 }, radius: 5 }
  const p1 = { x: 5, y: 0 }, p2 = { x: 0, y: 5 } // 0도, 90도
  const near0 = breakToCurrentLine(circle, p1, p2, { x: 3.5, y: 3.5 }) // 45도(작은 호 안)
  assert.equal(near0.cut.type, 'arc')
  assert.ok(near(near0.cut.startAngle, 0) && near(near0.cut.endAngle, 90))
  const far0 = breakToCurrentLine(circle, p1, p2, { x: -5, y: 0 }) // 180도(큰 호 안)
  assert.ok(near(far0.cut.startAngle, 90) && near(far0.cut.endAngle, 0))
})
test('BB 는 닫힌 폴리선·호·타원을 거부한다(이 버전 한계)', () => {
  assert.throws(() => breakToCurrentLine({ type: 'polyline', closed: true, points: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }] }, { x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 0 }))
  assert.throws(() => breakToCurrentLine({ type: 'arc' }, { x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 0 }))
})

test('BRO 객체 위의 객체 끊기 · 기준선 두 개가 만나는 자리마다 끊긴다', () => {
  const target = { type: 'line', layer: 'ly', points: [{ x: 0, y: 0 }, { x: 10, y: 0 }] }
  const bases = [
    { type: 'line', points: [{ x: 3, y: -5 }, { x: 3, y: 5 }] },
    { type: 'line', points: [{ x: 7, y: -5 }, { x: 7, y: 5 }] },
  ]
  const pieces = breakAtIntersections(target, bases)
  assert.equal(pieces.length, 3)
  assert.deepEqual(P(pieces[0].points), [[0, 0], [3, 0]])
  assert.deepEqual(P(pieces[1].points), [[3, 0], [7, 0]])
  assert.deepEqual(P(pieces[2].points), [[7, 0], [10, 0]])
})
test('BRO 는 기준과 만나지 않으면 null(변경 없음)', () => {
  const target = { type: 'line', points: [{ x: 0, y: 0 }, { x: 10, y: 0 }] }
  const bases = [{ type: 'line', points: [{ x: 30, y: -5 }, { x: 30, y: 5 }] }]
  assert.equal(breakAtIntersections(target, bases), null)
})

test('DIB 다이아그램 만들기 · 맞닿은 변만 절반씩 벌어지고 외곽은 그대로', () => {
  const A = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }]
  const B = [{ x: 10, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 10 }, { x: 10, y: 10 }]
  const [outA, outB] = diagramBoxes([A, B], 2)
  assert.deepEqual(P(outA), [[0, 0], [9, 0], [9, 10], [0, 10]])
  assert.deepEqual(P(outB), [[11, 0], [20, 0], [20, 10], [11, 10]])
})
test('DIB 는 공유 변이 없으면 오류, 이격 거리는 양수여야 한다', () => {
  const A = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }]
  const B = [{ x: 100, y: 100 }, { x: 110, y: 100 }, { x: 110, y: 110 }, { x: 100, y: 110 }]
  assert.throws(() => diagramBoxes([A, B], 2))
  assert.throws(() => diagramBoxes([A, A], 0))
})

test('CUT boundaryPolygon · 닫힌 폴리선/사각형/원만 지원', () => {
  assert.deepEqual(P(boundaryPolygon({ type: 'rectangle', points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }] })), [[0, 0], [10, 0], [10, 10], [0, 10]])
  assert.throws(() => boundaryPolygon({ type: 'polyline', closed: false, points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] }))
  assert.throws(() => boundaryPolygon({ type: 'text' }))
})

test('CUT 경계 만들고 자르기 · 점을 클릭한 안쪽만 지워지고 바깥은 남는다', () => {
  const boundary = { id: 'B1', type: 'rectangle', layer: 'wall', points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }] }
  const line = { id: 'L1', type: 'line', layer: 'deco', points: [{ x: -5, y: 5 }, { x: 15, y: 5 }] }
  const r = cutTargetsByBoundary({ entities: [boundary, line], boundaries: [boundary], pick: { x: 5, y: 5 }, layers: [] })
  assert.equal(r.touched, 1)
  assert.deepEqual(r.removeIds, ['L1'])
  assert.equal(r.add.length, 2)
  const pts = r.add.map(e => P(e.points)).sort((a, b) => a[0][0] - b[0][0])
  assert.deepEqual(pts, [[[-5, 5], [0, 5]], [[10, 5], [15, 5]]])
})
test('CUT 은 바깥쪽 점을 클릭하면 반대로 안쪽이 남는다', () => {
  const boundary = { id: 'B1', type: 'rectangle', layer: 'wall', points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }] }
  const line = { id: 'L1', type: 'line', layer: 'deco', points: [{ x: -5, y: 5 }, { x: 15, y: 5 }] }
  const r = cutTargetsByBoundary({ entities: [boundary, line], boundaries: [boundary], pick: { x: -20, y: 5 }, layers: [] })
  assert.equal(r.add.length, 1)
  assert.deepEqual(P(r.add[0].points), [[0, 5], [10, 5]])
})
test('CUT 은 잠긴 켜의 객체를 기본적으로 건너뛰고, 포함 옵션을 켜면 자른다', () => {
  const boundary = { id: 'B1', type: 'rectangle', layer: 'wall', points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }] }
  const line = { id: 'L1', type: 'line', layer: 'locked-layer', points: [{ x: -5, y: 5 }, { x: 15, y: 5 }] }
  const layers = [{ id: 'locked-layer', locked: true }]
  const skip = cutTargetsByBoundary({ entities: [boundary, line], boundaries: [boundary], pick: { x: 5, y: 5 }, layers })
  assert.equal(skip.touched, 0)
  assert.equal(skip.skippedLocked, 1)
  const take = cutTargetsByBoundary({ entities: [boundary, line], boundaries: [boundary], pick: { x: 5, y: 5 }, includeLocked: true, layers })
  assert.equal(take.touched, 1)
})
test('CUT 여러 객체 모드는 pick 없이 경계 내부를 지운다', () => {
  const b1 = { id: 'B1', type: 'rectangle', points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }] }
  const line = { id: 'L1', type: 'line', points: [{ x: -5, y: 5 }, { x: 15, y: 5 }] }
  const r = cutTargetsByBoundary({ entities: [b1, line], boundaries: [b1], multi: true, layers: [] })
  assert.equal(r.add.length, 2)
})

test('BAT 일정거리 반복 위치 계산', () => {
  assert.deepEqual(repeatPositions(100, 20, true), [10, 30, 50, 70, 90])
  assert.deepEqual(repeatPositions(100, 20, false), [20, 40, 60, 80])
  assert.throws(() => repeatPositions(100, 0, true))
})
test('BAT 자르고 문자넣기 · 자른 자리를 비우고 가운데 좌표로 문자를 만든다', () => {
  const line = { type: 'line', layer: 'ly', points: [{ x: 0, y: 0 }, { x: 20, y: 0 }] }
  const texts = []
  const { pieces, texts: out } = breakWindowsAndText(line, [5, 15], 2, (p, dir) => { texts.push([p, dir]); return { type: 'text', position: p, text: 'F' } })
  assert.equal(pieces.length, 3)
  assert.deepEqual(P(pieces[0].points), [[0, 0], [4, 0]])
  assert.deepEqual(P(pieces[1].points), [[6, 0], [14, 0]])
  assert.deepEqual(P(pieces[2].points), [[16, 0], [20, 0]])
  assert.equal(out.length, 2)
  assert.deepEqual([r2(out[0].position.x), r2(out[0].position.y)], [5, 0])
  assert.deepEqual([r2(out[1].position.x), r2(out[1].position.y)], [15, 0])
})
