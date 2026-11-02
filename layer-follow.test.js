// 객체를 고르면 위 레이어 칸이 그 객체의 레이어를 보여 주는가(오토캐드와 같은 규칙).
// 그리는 레이어를 바꾸는 게 아니라 '무슨 레이어인지 알려 주는' 표시다.
// app.js 에서 그 판단 부분만 떼어 내 가짜 화면에서 돌린다(grip-drag.test.js 와 같은 방식).
import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import fs from 'node:fs'

const source = fs.readFileSync(new URL('./app.js', import.meta.url), 'utf8')
const piece = source.slice(source.indexOf('/** 레이어 칸에 보여 줄 값.'), source.indexOf('function refresh() {'))

const layer = (id, name, extra = {}) => ({ id, name, color: '#ffffff', visible: true, locked: false, frozen: false, ...extra })
const line = (id, layerId) => ({ id, type: 'line', layer: layerId, points: [{ x: 0, y: 0 }, { x: 100, y: 0 }] })

/** 고른 것과 지금 그리는 레이어를 주고, 칸에 무엇이 보이는지 본다. */
function shown(ids, activeLayer = 'L0') {
  const context = {
    selected: new Set(ids), activeLayer,
    engine: { doc: { layers, entities } },
  }
  vm.createContext(context)
  vm.runInContext(piece + '\nglobalThis.결과=shownLayer();', context)
  return context.결과
}

const layers = [layer('L0', '0'), layer('INS', 'A-WALL-INSL'), layer('WALL', 'A-WALL'), layer('LOCK', '잠긴레이어', { locked: true })]
const entities = [line('a', 'INS'), line('b', 'INS'), line('c', 'WALL'), line('d', 'LOCK')]

test('객체를 고르면 그 객체의 레이어를 보여 준다', () => {
  // 벽체인지 단열재인지 눌러 보고 위 칸으로 확인하는 쓰임새다.
  assert.equal(shown(['a']), 'INS')
  assert.equal(shown(['c']), 'WALL')
  assert.equal(shown(['d']), 'LOCK')          // 잠긴 레이어도 '무엇인지'는 보여 준다
})

test('같은 레이어를 여럿 골라도 그 레이어를 보여 준다', () => {
  assert.equal(shown(['a', 'b']), 'INS')
})

test('여러 레이어가 섞이면 빈칸이다', () => {
  // 오토캐드와 같다. 무엇 하나로 답할 수 없으므로 비운다.
  assert.equal(shown(['a', 'c']), '')
  assert.equal(shown(['a', 'c', 'd']), '')
})

test('선택을 풀면 지금 그리는 레이어로 돌아온다', () => {
  assert.equal(shown([], 'WALL'), 'WALL')
  assert.equal(shown([], 'L0'), 'L0')
})

test('보여 주기만 할 뿐 그리는 레이어는 건드리지 않는다', () => {
  // 고르는 것만으로 다음 작도 레이어가 바뀌면 안 된다.
  const context = { selected: new Set(['a']), activeLayer: 'L0', engine: { doc: { layers, entities } } }
  vm.createContext(context)
  vm.runInContext(piece + '\nshownLayer();', context)
  assert.equal(context.activeLayer, 'L0')
})
