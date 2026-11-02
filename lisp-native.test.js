// 자체 AutoLISP 엔진 · 도면 어댑터 · 명령 다리 시험.
// 여기서 다루는 것은 전부 AutoCAD 없이 도는 경로다.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { Interpreter, unsupportedCalls, usedCommands, scanByFunction } from './lisp-native.js'
import { createHost, SUPPORTED_COMMANDS } from './lisp-host.js'
import { TEMPLATE_LAYERS } from './layer-standards.js'

test('APPLOAD 는 리습 관리 창(목록·삭제·순서·켜기끄기·편집·식 실행)을 연다', () => {
  // U-M6: 예전에는 파일 추가만 있었다. README 가 말하는 관리 기능이 창에 있어야 한다.
  const panel = fs.readFileSync(new URL('./lisp-panel.js', import.meta.url), 'utf8')
  assert.match(panel, /studio\.handlers\.APPLOAD=openManager/)
  assert.match(panel, /picker\.setAttribute\('aria-label','사용자 리습 추가'\)/)
  for (const action of ["action:'remove'", "action:'reorder'", "action:'toggle'", "action:'update'"])
    assert.ok(panel.includes(action), action)
  assert.doesNotMatch(panel, /'예제 4개 추가'/)   // 동봉·예제 리습은 2026-10-27 뺐다(기본 건축 명령과 같은 일)
  assert.match(panel, /리습 식 실행/)
  assert.match(panel, /hasCommand:name=>enabled\(\)\.some/)          // 끈 파일의 명령은 명령창에서 부르지 않는다
})

test('리습 관리 창에 동봉 건축 리습 줄이 없다(2026-10-27 뺌)', () => {
  const panel = fs.readFileSync(new URL('./lisp-panel.js', import.meta.url), 'utf8')
  assert.doesNotMatch(panel, /기본 건축 리습/)
  assert.doesNotMatch(panel, /bundledCount/)
})

test('예제 4개 원문은 examples 폴더의 예제 파일과 같다', async () => {
  const { EXAMPLE_LISP } = await import('./lisp-panel.js')
  const file = fs.readFileSync(new URL('./examples/바른캐드_리습예제.lsp', import.meta.url), 'utf8').replace(/^﻿/, '')
  assert.equal(EXAMPLE_LISP.replace(/\r/g, '').trim(), file.replace(/\r/g, '').trim())
})

test('명령창의 (+ 1 2) 같은 식은 리습 식으로 실행한다', () => {
  const app = fs.readFileSync(new URL('./app.js', import.meta.url), 'utf8')
  assert.match(app, /studio\.lisp\?\.isExpression\?\.\(value\)\)\{log\('❯ '\+value\.trim\(\)\);studio\.lisp\.evaluate\(value\.trim\(\)\)/)
})

const layer0 = { id: 'L0', name: '0', color: '#d8d8d8', visible: true, locked: false, lineweight: 0.25, linetype: 'CONTINUOUS' }
const doc = (entities = [], layers = [layer0]) => ({ units: 'mm', layers: structuredClone(layers), entities: structuredClone(entities) })
const line = (id, x, y, x2, y2) => ({ id, type: 'line', layer: 'L0', points: [{ x, y }, { x: x2, y: y2 }] })

/** 도면 하나에 리습 한 조각을 돌리고 결과 문서를 돌려준다. */
function run(source, { entities = [], inputs = [], preselected = [], command = null, layers = [layer0], regions = [] } = {}) {
  const model = doc(entities, layers)
  const host = createHost(model, { inputs, preselected, regions, vars: { CLAYER: '0' } })
  const interp = new Interpreter(host)
  interp.load(source)
  if (command) interp.callCommand(command)
  host.finish()
  return { doc: model, interp, out: interp.output.join('') }
}
const kinds = (model) => model.entities.map(e => e.type).sort()
const layerOf = (model, e) => (model.layers.find(l => l.id === e.layer) || {}).name

test('셈과 문자열이 AutoLISP 규칙대로 계산된다', () => {
  const { out } = run('(princ (strcat "=" (rtos (+ 1 2.5) 2 1)))')
  assert.equal(out.trim(), '=3.5')
})

test('선언하지 않은 setq 는 전역이 된다(AutoLISP 규칙)', () => {
  const { interp } = run('(defun f () (setq 몫 42)) (f)')
  assert.equal(interp.global.get('몫'), 42n)                 // 정수는 INT(BigInt)로 담는다
})

test('(cons 10 점) 은 목록이 되고 좌표 전체를 돌려준다', () => {
  // 회귀: 예전에는 x 값 하나만 읽어 "점 좌표가 필요합니다" 로 멈췄다.
  const { doc: model } = run('(entmake (list (cons 0 "TEXT") (cons 10 (list 100 200 0)) (cons 40 250) (cons 1 "가")))')
  assert.equal(model.entities.length, 1)
  assert.deepEqual(model.entities[0].position, { x: 100, y: 200 })
})

test('질문에 Enter 만 치면 nil 이다', () => {
  const { interp } = run('(setq p (getpoint "\\n점: "))', { inputs: [''] })
  assert.equal(interp.global.get('P'), null)
})

test('ssget 은 입력값으로 고른다 · _ALL 과 좌표와 미리 선택', () => {
  const es = [line('a', 0, 0, 100, 0), line('b', 0, 500, 100, 500)]
  assert.equal(run('(princ (sslength (ssget)))', { entities: es, inputs: ['_ALL', ''] }).out.trim(), '2')
  assert.equal(run('(princ (sslength (ssget)))', { entities: es, inputs: ['50,0', ''] }).out.trim(), '1')
  assert.equal(run('(princ (sslength (ssget "_I")))', { entities: es, preselected: ['b'] }).out.trim(), '1')
})

test('그리기 명령이 도면을 실제로 바꾼다', () => {
  const { doc: model } = run('(command "_.LINE" (list 0 0) (list 1000 0) "")\n'
    + '(command "_.PLINE" (list 0 0) (list 0 500) (list 500 500) "C")\n'
    + '(command "_.CIRCLE" (list 100 100) 50)\n'
    + '(command "_.RECTANG" (list 0 0) (list 300 200))\n'
    + '(command "_.TEXT" (list 10 10) 250 0 "방")')
  assert.deepEqual(kinds(model), ['circle', 'line', 'polyline', 'rectangle', 'text'])
  assert.equal(model.entities.find(e => e.type === 'polyline').closed, true)
  assert.equal(model.entities.find(e => e.type === 'text').text, '방')
})

test('OFFSET 은 가리킨 쪽으로 간다', () => {
  const source = '(setq e (car (entsel "\\n선: "))) (command "_.OFFSET" 200 e (list 500 900) "")'
  const { doc: model } = run(source, { entities: [line('a', 0, 0, 1000, 0)], inputs: ['500,0'] })
  const made = model.entities.find(e => e.id !== 'a')
  assert.equal(made.points[0].y, 200)
})

test('ERASE · MOVE · COPY 가 개수와 자리를 맞춘다', () => {
  const es = [line('a', 0, 0, 100, 0), line('b', 0, 500, 100, 500)]
  const erased = run('(command "_.ERASE" (ssget "_X") "")', { entities: es }).doc
  assert.equal(erased.entities.length, 0)
  const moved = run('(command "_.MOVE" (ssget "_X") "" (list 0 0) (list 0 1000))', { entities: es }).doc
  assert.deepEqual(moved.entities.map(e => e.points[0].y).sort((x, y) => x - y), [1000, 1500])
  const copied = run('(command "_.COPY" (ssget "_X") "" (list 0 0) (list 0 1000))', { entities: es }).doc
  assert.equal(copied.entities.length, 4)
})

test('LAYER 끄기는 현재 레이어를 살려 둔다', () => {
  const layers = [layer0, { ...layer0, id: 'L1', name: 'A-WALL' }]
  const { doc: model } = run('(command "_.LAYER" "_OFF" "*" "")', { entities: [], layers })
  assert.equal(model.layers.find(l => l.name === '0').visible, true)
  assert.equal(model.layers.find(l => l.name === 'A-WALL').visible, false)
})

test('EXPLODE 는 사각형을 선 네 개로 나눈다', () => {
  const rect = { id: 'r', type: 'rectangle', layer: 'L0', points: [{ x: 0, y: 0 }, { x: 100, y: 50 }] }
  const { doc: model } = run('(command "_.EXPLODE" (ssget "_X") "")', { entities: [rect] })
  assert.deepEqual(kinds(model), ['line', 'line', 'line', 'line'])
})

test('PEDIT 접합은 끝이 맞닿은 선을 폴리선 하나로 만든다', () => {
  const es = [line('a', 0, 0, 100, 0), line('b', 100, 0, 100, 80)]
  const { doc: model } = run('(command "_.PEDIT" "_M" (ssget "_X") "" "_Y" "_J" "0.0" "")', { entities: es })
  assert.deepEqual(kinds(model), ['polyline'])
  assert.equal(model.entities[0].points.length, 3)
})

test('FILLET 은 두 선 사이에 호를 넣는다', () => {
  const es = [line('a', 0, 0, 1000, 0), line('b', 1000, 0, 1000, 1000)]
  const { doc: model } = run('(command "_.FILLET" "_R" 100) (command "_.FILLET" (list 500 0) (list 1000 500))', { entities: es })
  assert.equal(model.entities.filter(e => e.type === 'arc').length, 1)
})

test('AREA 는 면적을 시스템 변수에 담는다', () => {
  const room = { id: 'p', type: 'polyline', layer: 'L0', closed: true, points: [{ x: 0, y: 0 }, { x: 5000, y: 0 }, { x: 5000, y: 4000 }, { x: 0, y: 4000 }] }
  const { out } = run('(command "_.AREA" "_O" (car (entsel))) (princ (rtos (/ (getvar "AREA") 1000000.0) 2 2))',
    { entities: [room], inputs: ['2500,0'] })
  assert.equal(out.trim(), '20.00')
})

test('울타리 TRIM 이 교차 벽선을 개구부만큼 끊는다', () => {
  const es = [line('h1', 0, 0, 6000, 0), line('h2', 0, 200, 6000, 200),
  line('v1', 3000, -2000, 3000, 2000), line('v2', 3200, -2000, 3200, 2000)]
  const { doc: model } = run('(command "_.TRIM" (ssget "_X") "" "_F" (list 3100 -100) (list 3100 300) "" "")', { entities: es })
  const left = model.entities.filter(e => e.points[0].y === 0 || e.points[1].y === 0)
  assert.equal(model.entities.length, 6)                    // 가로 두 줄이 각각 둘로 갈라진다
  assert.ok(left.some(e => Math.abs(e.points[1].x - 3000) < 1e-3))
})

test('(exit) 는 오류가 아니라 조용한 중단이다', () => {
  const { interp } = run('(defun c:멈춤 () (princ "그만") (exit) (princ "여기는 안 온다"))', { command: '멈춤' })
  assert.equal(interp.output.join('').includes('여기는 안 온다'), false)
})

test('화면에서 찍는 자리(pause)는 입력값 칸의 다음 줄을 쓴다', () => {
  // 화면이 없으니 실시간 추적 대신 미리 적어 둔 좌표를 쓴다.
  const { doc: model } = run('(command "_.PLINE" (list 0 0) pause "")', { inputs: ['3000,0'] })
  assert.deepEqual(model.entities[0].points, [{ x: 0, y: 0 }, { x: 3000, y: 0 }])
})

test('적어 둔 좌표가 모자라면 몇 줄이 더 필요한지 말한다', () => {
  assert.throws(() => run('(command "_.PLINE" (list 0 0) pause "")'), /입력이 모자랍니다/)
})

test('검사는 파일이 아니라 명령 단위로 한다', () => {
  const source = '(defun c:좋음 () (princ "ok"))\n(defun c:나쁨 () (start_dialog))'
  assert.equal(unsupportedCalls(source, '좋음').length, 0)
  assert.equal(unsupportedCalls(source, '나쁨')[0].name, 'START_DIALOG')
  assert.deepEqual(usedCommands('(defun c:ㄱ () (command "_.OFFSET"))', 'ㄱ'), [{ name: 'OFFSET', count: 1 }])
  assert.ok(scanByFunction(source).owners.has('C:좋음'.toUpperCase()))
})

test('동봉 건축 리습 23개는 전부 AutoCAD 없이 실행할 수 있다', () => {
  const dir = new URL('./examples/architecture-lisp/', import.meta.url)
  const names = fs.readdirSync(dir).filter(f => f.endsWith('.lsp')).sort()
  const all = names.map(f => fs.readFileSync(new URL(f, dir), 'utf8').replace(/^﻿/, '')).join('\n')
  const blocked = []
  for (const command of scanByFunction(all).owners.keys()) {
    if (!command.startsWith('C:')) continue
    const name = command.slice(2)
    const bad = [...unsupportedCalls(all, name),
    ...usedCommands(all, name).filter(c => !c.name.startsWith('(') && !SUPPORTED_COMMANDS.has(c.name.replace(/^-/, '')))]
    if (bad.length) blocked.push(name)
  }
  assert.deepEqual(blocked.filter(n => /^[A-Z0-9]+$/.test(n)), [])
})

test('치수·블록·레이어를 리습이 읽고 고칠 수 있다', () => {
  // 예전에는 이 셋의 DXF 그룹코드를 내보내지 않아 DIMCLEAN 이 죽고 BLKCNT 가 늘 비었다.
  const dimension = { type: 'dimension', mode: 'aligned', points: [{ x: 0, y: 0 }, { x: 1000, y: 0 }, { x: 500, y: 300 }], textHeight: 100 }
  const seen = run('(setq e (entget (car (entsel)))) (princ (strcat (cdr (assoc 0 e)) "/" (rtos (cadr (assoc 13 e)) 2 0)))',
    { entities: [dimension], inputs: ['500,0'] })
  assert.match(seen.out, /^DIMENSION\/0$/)
  const moved = run('(setq e (entget (car (entsel)))) (entmod (subst (cons 10 (list 500 900 0)) (assoc 10 e) e))',
    { entities: [dimension], inputs: ['500,0'] })
  assert.equal(moved.doc.entities[0].points[2].y, 900)
})

test('원·호의 길이와 면적을 제대로 잰다', () => {
  // 0 을 돌려주던 시절에는 LEN 이 틀린 총합을 도면에 써 넣었다.
  const circle = { type: 'circle', center: { x: 0, y: 0 }, radius: 1000 }
  const arc = { type: 'arc', center: { x: 0, y: 0 }, radius: 1000, startAngle: 0, endAngle: 90 }
  const area = run('(princ (rtos (vlax-curve-getArea (car (entsel))) 2 0))', { entities: [circle], inputs: ['1000,0'] })
  assert.equal(area.out, String(Math.round(Math.PI * 1e6)))
  const len = run('(princ (rtos (vlax-curve-getEndParam (car (entsel))) 2 1))', { entities: [arc], inputs: ['1000,0'] })
  assert.equal(len.out, (Math.PI * 1000 / 2).toFixed(1))
})

test('레이어 선종류가 리습이 준 대로 만들어진다', () => {
  // 통심선·벽중심선이 실선으로 나오면 도면이 틀린다.
  const { doc: model } = run(`(entmake (list (cons 0 "LAYER") (cons 2 "A-GRID") (cons 62 4) (cons 6 "CENTER")))`)
  assert.equal(model.layers.find(l => l.name === 'A-GRID')?.linetype, 'CENTER')
})

test('함수 안에서 만든 도우미 함수가 지역 이름을 덮어쓴다', () => {
  // (defun c:X (/ helper) (defun helper ...) (helper)) 는 AutoLISP 의 흔한 관용구다.
  const { interp } = run('(defun c:씀 (/ 도우미) (defun 도우미 (n) (* n 2)) (princ (도우미 21)))', { command: '씀' })
  assert.equal(interp.output.join('').trim(), '42')
})

/* ── AutoCAD 를 부르던 명령들을 자체 엔진으로 옮긴 자리 ─────────── */

// 파이썬(ezdxf·shapely)이 실행 전에 넘겨 주는 닫힌 영역. 모양은 lisp_architecture.region_list 와 같다.
const roomRegion = [{ ring: [[0, 0], [4000, 0], [4000, 3000], [0, 3000]], holes: [], area: 12e6 }]

test('BOUNDARY 는 찍은 점을 품는 닫힌 영역을 폴리선으로 만든다', () => {
  // AutoCAD 없이 된다. 영역 찾기는 실행 전에 파이썬이 끝내 두고, 여기서는 고르기만 한다.
  const { doc: model } = run('(command "_.-BOUNDARY" (list 2000 1500) "") (princ (rtos (/ (vlax-curve-getArea (entlast)) 1000000.0) 2 1))',
    { regions: roomRegion })
  assert.equal(model.entities.length, 1)
  assert.equal(model.entities[0].closed, true)
  assert.equal(model.entities[0].points.length, 4)
})

test('BOUNDARY 는 영역 밖을 찍으면 무엇이 잘못됐는지 말한다', () => {
  assert.throws(() => run('(command "_.-BOUNDARY" (list 9000 9000) "")', { regions: roomRegion }), /닫힌 영역 안이 아닙니다/)
})

test('BOUNDARY 는 구멍 안쪽을 품는 가장 작은 영역을 고른다', () => {
  const two = [{ ring: [[0, 0], [4000, 0], [4000, 3000], [0, 3000]], holes: [[[500, 500], [1500, 500], [1500, 1500], [500, 1500]]], area: 11e6 },
  { ring: [[500, 500], [1500, 500], [1500, 1500], [500, 1500]], holes: [], area: 1e6 }]
  const { doc: model } = run('(command "_.-BOUNDARY" (list 1000 1000) "")', { regions: two })
  assert.deepEqual(model.entities[0].points[0], { x: 500, y: 500 })
})

test('JUSTIFYTEXT 는 글자를 그대로 두고 정렬 기준만 옮긴다', () => {
  const label = { id: 't', type: 'text', layer: 'L0', position: { x: 1000, y: 2000 }, height: 200, text: '침실', rotation: 0 }
  const { doc: model } = run('(command "_.JUSTIFYTEXT" (ssget "_X") "" "MC")', { entities: [label] })
  const after = model.entities[0]
  const width = 2 * 200 * 0.65
  assert.equal(after.align, 'center')
  assert.equal(after.vertical, 'middle')
  // 정렬점은 글자 한가운데다. 넣는 점은 글자가 안 움직이도록 함께 옮긴다.
  assert.deepEqual(after.alignPoint, { x: 1000 + width / 2, y: 2100 })
  assert.deepEqual(after.position, { x: 1000 + width / 2, y: 2000 })
})

test('-HATCHEDIT 는 해치에서 바깥 경계와 구멍을 폴리선으로 뽑는다', () => {
  const hatch = {
    id: 'h', type: 'hatch', layer: 'L0', pattern: 'ANSI31',
    points: [{ x: 0, y: 0 }, { x: 1000, y: 0 }, { x: 1000, y: 800 }, { x: 0, y: 800 }],
    loops: [[{ x: 200, y: 200 }, { x: 400, y: 200 }, { x: 400, y: 400 }, { x: 200, y: 400 }]],
  }
  const { doc: model } = run('(command "_.-HATCHEDIT" (ssget "_X" (list (cons 0 "HATCH"))) "B" "P" "Y")', { entities: [hatch] })
  const made = model.entities.filter(e => e.type === 'polyline')
  assert.equal(made.length, 2)
  assert.ok(made.every(e => e.closed))
})

test('SELECTSIMILAR 은 같은 종류·같은 레이어를 모아 (ssget "_P") 에 넘긴다', () => {
  const es = [line('a', 0, 0, 100, 0), line('b', 0, 50, 100, 50),
  { id: 'c', type: 'circle', layer: 'L0', center: { x: 0, y: 0 }, radius: 30 }]
  const { out } = run('(command "_.SELECTSIMILAR") (princ (itoa (sslength (ssget "_P"))))',
    { entities: es, preselected: ['a'] })
  assert.equal(out.trim(), '2')                       // 원은 빠지고 선 둘만
})

test('grread 는 적어 둔 좌표를 찍은 점으로 돌려준다', () => {
  // 실시간 마우스 추적 대신 입력값 칸의 다음 줄을 쓴다.
  const { out } = run('(setq g (grread T)) (princ (strcat (itoa (car g)) ":" (rtos (cadr (cadr g)) 2 0)))',
    { inputs: ['1200,900'] })
  assert.equal(out.trim(), '5:900')
})

test('textbox 는 글자 크기를 실제로 잰다', () => {
  // 0 을 돌려주던 시절에는 이 값으로 표식을 그리는 리습이 찌그러진 도형을 만들었다.
  const label = { id: 't', type: 'text', layer: 'L0', position: { x: 0, y: 0 }, height: 200, text: '가나다' }
  const { out } = run('(princ (rtos (car (cadr (textbox (entget (car (entsel)))))) 2 0))',
    { entities: [label], inputs: ['0,0'] })
  assert.equal(out.trim(), String(Math.round(3 * 200 * 0.65)))
})

test('PLINE 의 호 구간이 직선 현이 아니라 둥근 길로 나온다', () => {
  // 회귀: 예전에는 점만 모아 직선 폴리선을 만들어 단열재가 직선으로 나왔다.
  const { doc: model } = run('(command "_.PLINE" (list 0 0) "A" "S" (list 50 50) (list 100 0) "")')
  const pline = model.entities[0]
  assert.ok(pline.points.length > 3, '호가 여러 점으로 펴져야 한다')
  assert.ok(pline.points.some(p => p.y > 45), '호가 위로 부풀어야 한다')
  assert.deepEqual(pline.points.at(-1), { x: 100, y: 0 })
})

test('PLINE 은 Enter 를 받기 전까지 살아 있어 점을 이어 찍을 수 있다', () => {
  // 구름마크처럼 점 개수를 미리 모르는 리습이 (command 점) 으로 하나씩 이어 찍는다.
  const { doc: model } = run('(command "_.PLINE" (list 0 0)) (command (list 100 0)) (command (list 100 100)) (command "C")')
  const pline = model.entities[0]
  assert.equal(pline.points.length, 3)
  assert.equal(pline.closed, true)
})

test('TEXT 는 정렬 옵션을 읽고 숫자 모양 글자를 회전각으로 잘못 먹지 않는다', () => {
  const { doc: model } = run('(command "_.TEXT" "J" "MC" (list 1000 500) 250 0 "12.34")')
  const made = model.entities[0]
  assert.equal(made.text, '12.34')
  assert.equal(made.rotation, 0)
  assert.equal(made.align, 'center')
  assert.deepEqual(made.alignPoint, { x: 1000, y: 500 })
})

test('initget 로 걸어 둔 낱말은 점 대신 답할 수 있다', () => {
  // 구름마크의 Close/Undo 가 이 규칙에 기댄다. 낱말은 다음 질문 한 번에만 쓰고 지운다.
  const { out } = run('(initget 32 "Close Undo") (setq a (getpoint)) (setq b (getpoint)) (princ (strcat a ":" (rtos (car b) 2 0)))',
    { inputs: ['Close', '700,0'] })
  assert.equal(out.trim(), 'Close:700')
})

test('리습 창은 window.prompt 를 쓰지 않는다(Electron 은 prompt() 를 지원하지 않는다)', () => {
  const panel = fs.readFileSync(new URL('./lisp-panel.js', import.meta.url), 'utf8')
  assert.doesNotMatch(panel, /window\.prompt|[^.\w]prompt\(/)
  assert.match(panel, /await ask\(/)
  assert.match(panel, /list:\(\)=>enabled\(\)\.flatMap/)
})

test('입력이 모자라면 무엇을 묻는지와 리습의 안내문을 함께 알려 준다', () => {
  assert.throws(() => run('(getpoint "\\n시작점: ")'), (error) => error.ask?.what === '점' && /시작점/.test(error.ask.prompt) && error.ask.step === 1)
  assert.throws(() => run('(getstring T "이름: ")'), (error) => error.ask?.what === '문자' && error.ask.prompt === '이름: ')
  assert.throws(() => run('(getdist (list 0 0 0) "길이: ")'), (error) => error.ask?.what === '거리' && error.ask.prompt === '길이: ')
})

/* ── 5.0.4 검토(lisp-engine report) 반영 ─────────────────────────── */
import { read, write } from './lisp-native.js'
import { DrawingEngine } from './engine.js'

const val = (source, options) => { const { interp } = run(source, options); return write(interp.evaluate('*r*')) }
const out = (source, options) => run(source, options).out

test('정수와 실수를 가른다: (/ 7 2)=3, (type 1.0)=REAL, fix·float', () => {
  assert.equal(val('(setq *r* (list (/ 7 2) (/ 7 2.0) (type 1.0) (type 1) (fix 3.7) (float 3) (rem 7 2) (* 2147483647 2)))'),
    '(3 3.5 REAL INT 3 3.0 1 -2)')
  assert.equal(val('(setq *r* (itoa (length (list 1 2 3))))'), '"3"')
})

test('실수는 AutoLISP 처럼 6자리로 보이고 prin1 은 따옴표를 붙인다', () => {
  assert.equal(out('(princ 1.0) (princ " ") (princ (/ 1 3.0)) (princ " ") (princ 1e8) (princ " ") (prin1 "가")'), '1.0 0.333333 1.0e+008 "가"')
})

test('동적 범위: 불린 함수가 부른 쪽의 지역 변수를 본다', () => {
  assert.equal(val('(setq x 10) (defun g () x) (defun f (x) (g)) (setq *r* (list (f 1) x))'), '(1 10)')
})

test('*error* 처리기가 오류 문구를 받고, 처리한 오류는 명령을 조용히 끝낸다', () => {
  const { interp } = run('(defun *error* (m) (princ (strcat "처리:" m)))')
  assert.equal(interp.evaluate('(/ 1 0)'), null)
  assert.match(interp.output.join(''), /처리:0으로 나눌 수 없습니다/)
  assert.equal(interp.handledError, '0으로 나눌 수 없습니다')
})

test('*error* 는 오류 자리에서 불린다: 지역 *error* 관용구·부른 쪽 지역 변수·처리기 안 (exit)', () => {
  // Lee Mac 관용구: (defun c:x (/ *error* os) (defun *error* …) …) — 지역 처리기가 되돌려지기 전에 불려야 한다.
  let r = run('(defun c:t1 (/ *error* os) (defun *error* (m) (princ (strcat "[지역:" m "]"))) (setq os 7) (/ 1 0))', { command: 't1' })
  assert.equal(r.out, '[지역:0으로 나눌 수 없습니다]')
  // 전역 처리기가 오류 순간의 지역 변수(os)를 본다 → (setvar "OSMODE" os) 복원이 된다
  r = run('(defun *error* (m) (setvar "OSMODE" os) (princ (strcat "[os=" (itoa os) "]"))) (defun c:t2 (/ os) (setq os (getvar "OSMODE")) (setvar "OSMODE" 0) (car 5))', { command: 't2' })
  assert.equal(r.out, '[os=0]')
  // 처리기 안의 (exit) 는 조용한 끝이다
  r = run('(defun c:t3 (/ *error*) (defun *error* (m) (princ "[정리]") (exit)) (/ 1 0))', { command: 't3' })
  assert.equal(r.out, '[정리]')
  assert.equal(r.interp.handledError, '0으로 나눌 수 없습니다')
  // vl-catch-all-apply 가 잡는 오류에는 *error* 를 부르지 않는다
  r = run("(defun *error* (m) (princ \"[불림]\")) (setq x (vl-catch-all-apply '/ '(1 0))) (princ (vl-catch-all-error-p x))")
  assert.equal(r.out, 'T')
})

test('*error* 가 처리한 오류는 화면에서 실패가 아니라 결과 적용 + 알림이다(runNative)', async () => {
  const { runNative, inspectFile, planRun } = await import('./lisp-panel.js')
  const model = { ...new DrawingEngine().doc }
  const files = planRun([inspectFile({ name: 'e.lsp', source: '(defun c:EH (/ *error*) (defun *error* (m) (princ "[정리]")) (entmake (list (cons 0 "LINE") (cons 10 (list 0 0)) (cons 11 (list 10 0)))) (/ 1 0))' })], 'EH').files
  const r = runNative({ files, command: 'EH', snapshot: JSON.stringify(model), activeLayer: model.layers[0].name })
  assert.equal(r.changed, true)
  assert.match(r.notes.join(), /\*error\* 처리기가 받았습니다: 0으로 나눌 수 없습니다/)
  assert.doesNotThrow(() => JSON.stringify(r.document))
})

test('정의되지 않은 함수는 이름을 말하고, 문법 오류는 줄 번호를 말한다', () => {
  assert.throws(() => run('(foo 1)'), /함수 FOO 이\(가\) 정의되지 않았습니다/)
  assert.throws(() => read('(princ "abc'), /닫는 따옴표.*1번째 줄/)
  assert.throws(() => read('(a\n(b'), /괄호가 닫히지 않았습니다 \(2번째 줄/)
  assert.throws(() => read("'( . 1)"), /점 표기/)
  assert.equal(read('#| 머리말\n여러 줄 |# (+ 1 2) ;| 안쪽 |; 3').length, 2)
})

test('5만 개 목록을 cons 로 만들고 cdr 로 훑어도 빠르다', () => {
  const start = Date.now()
  assert.equal(val('(setq l nil i 0) (repeat 50000 (setq l (cons i l) i (1+ i))) (setq n 0) (while l (setq l (cdr l) n (1+ n))) (setq *r* n)'), '50000')
  assert.ok(Date.now() - start < 3000, `너무 느림: ${Date.now() - start}ms`)
})

test('재귀가 너무 깊으면 한국어로 알린다(영문 RangeError 가 아니다)', () => {
  assert.throws(() => run('(defun r (n) (if (= n 0) 0 (+ 1 (r (- n 1))))) (r 100000)'), /재귀.*너무 깊습니다/)
  // 깊이 한도는 자바스크립트 스택이라 엔진이 덜 데워진 때는 1,000 단계 근처에서도 멈춘다(맥에서 약 1,100~2,200). 그 경계 대신 실제로 늘 되는 깊이를 본다.
  assert.equal(val('(defun r (n) (if (= n 0) 0 (+ 1 (r (- n 1))))) (setq *r* (r 500))'), '500')
})

test('실행 시간 한도를 넘으면 한국어로 멈춘다', () => {
  // 단계 수가 아니라 시간으로 멈춰야 한다(단계 한도 메시지는 받지 않는다).
  const interp = new Interpreter(null, { timeLimitMs: 300 })
  const started = Date.now()
  assert.throws(() => interp.evaluate('(setq i 0) (while T (setq i (1+ i)))'), /실행 시간이 0\.3초를 넘어 중지했습니다/)
  assert.ok(Date.now() - started < 3000)
  assert.ok(interp.steps > 5_000_000 || Date.now() - started >= 300, `단계 ${interp.steps}`)
})

test('몸통이 빈 무한 반복 (while T)·(while 1)·(repeat 큰수 nil) 도 시간 한도로 바로 멈춘다', () => {
  for (const source of ['(while T)', '(while 1)', '(while T nil)', '(repeat 2000000000 nil)']) {
    const interp = new Interpreter(null, { timeLimitMs: 300 }), started = Date.now()
    assert.throws(() => interp.evaluate(source), /실행 시간이 0\.3초를 넘어 중지했습니다/, source)
    assert.ok(Date.now() - started < 1500, `${source}: ${Date.now() - started}ms`)
  }
})

test('정당한 200만 번 반복은 끊지 않는다(예전 500만 단계 한도)', () => {
  assert.equal(write(new Interpreter(null).evaluate('(setq i 0) (repeat 2000000 (setq i (1+ i))) i')), '2000000')
})

test('vl-catch-all-apply 는 입력 요청을 삼키지 않는다', () => {
  assert.throws(() => run("(vl-catch-all-apply 'getpoint (list \"점: \"))"), (e) => e.ask?.what === '점')
})

test('initget 비트와 getkword 목록을 지킨다(어기면 받은 값: 으로 다시 묻게 한다)', () => {
  assert.throws(() => run('(initget 6) (getint)', { inputs: ['-1'] }), /음수는 입력할 수 없습니다.*받은 값: -1/)
  assert.throws(() => run('(initget 6) (getreal)', { inputs: ['0'] }), /0 은 입력할 수 없습니다/)
  assert.throws(() => run('(initget 1) (getpoint)', { inputs: [''] }), /비워 둘 수 없습니다/)
  assert.throws(() => run('(initget "예 아니오") (getkword)', { inputs: ['몰라'] }), /보기 중 하나를 고르세요\(예\/아니오\)\. 받은 값: 몰라/)
  assert.throws(() => run('(getint)', { inputs: ['7.5'] }), /정수를 입력하세요\. 받은 값: 7\.5/)
  assert.equal(out('(initget "Yes No") (princ (getkword))', { inputs: ['y'] }), 'Yes')
  assert.equal(out('(princ (getstring "이름: "))', { inputs: ['가 나'] }), '가')
  assert.equal(out('(princ (getstring T "이름: "))', { inputs: ['가 나'] }), '가 나')
})

test('좌표는 3D·상대(@)·극좌표(<)·지수 표기도 읽는다', () => {
  assert.equal(val('(setq *r* (list (getpoint) (getpoint) (getpoint)))', { inputs: ['1,2,3', '@10,0', '1e3,2'] }),
    '((1.0 2.0 3.0) (11.0 2.0 3.0) (1000.0 2.0 0.0))')
  assert.equal(out('(setq p (getpoint)) (princ (rtos (car p) 2 3)) (princ ",") (princ (rtos (cadr p) 2 3))', { inputs: ['100<90'] }), '0.000,100.000')
})

test('색(62)이 entmake·entget·entmod 로 왕복한다', () => {
  const { doc: model, interp } = run('(entmake (list (cons 0 "LINE") (cons 10 (list 0 0)) (cons 11 (list 10 0)) (cons 62 1)))')
  assert.equal(model.entities[0].color, '#ff0000')
  assert.equal(write(interp.evaluate('(cdr (assoc 62 (entget (entlast))))')), '1')
  interp.evaluate('(setq e (entget (entlast))) (entmod (subst (cons 62 256) (assoc 62 e) e))')
  assert.equal(model.entities[0].color, undefined)
})

test('그룹 8 이 없는 entmake 는 현재 레이어에 만들고, LAYER 레코드는 "0" 레이어를 덤으로 만들지 않는다', () => {
  const layers = [{ ...layer0, id: 'LA', name: 'A-WALL' }]
  const model = doc([], layers)
  const host = createHost(model, { vars: { CLAYER: 'A-WALL' } })
  new Interpreter(host).load('(entmake (list (cons 0 "LINE") (cons 10 (list 0 0)) (cons 11 (list 10 0)))) (entmake (list (cons 0 "LAYER") (cons 2 "A-DOOR") (cons 62 3)))')
  assert.equal(model.entities[0].layer, 'LA')
  assert.deepEqual(model.layers.map(l => l.name).sort(), ['A-DOOR', 'A-WALL'])
})

test('ssget 필터: 이름(2)·글자(1) 와일드카드·색(62)·-4 논리·*TEXT·좌표 비교', () => {
  const es = [
    { id: 'd', type: 'block', layer: 'L0', name: 'DOOR', position: { x: 0, y: 0 }, entities: [] },
    { id: 'w', type: 'block', layer: 'L0', name: 'WIN', position: { x: 500, y: 0 }, entities: [] },
    { id: 't', type: 'text', layer: 'L0', position: { x: 0, y: 900 }, height: 100, text: '거실 12.00㎡' },
    { ...line('r', 0, 0, 100, 0), color: '#ff0000' }, line('g', 0, 2000, 100, 2000),
  ]
  const count = (f) => out(`(princ (if (setq s (ssget "_X" ${f})) (sslength s) 0))`, { entities: es })
  assert.equal(count(`'((2 . "DOOR"))`), '1')
  assert.equal(count(`'((1 . "*㎡"))`), '1')
  assert.equal(count(`'((1 . "ZZZ"))`), '0')
  assert.equal(count(`'((62 . 1))`), '1')
  assert.equal(count(`'((0 . "*TEXT"))`), '1')
  assert.equal(count(`'((-4 . "<NOT") (0 . "INSERT") (-4 . "NOT>"))`), '3')
  assert.equal(count(`'((-4 . "<OR") (2 . "DOOR") (0 . "TEXT") (-4 . "OR>"))`), '2')
  assert.equal(count(`'((0 . "LINE") (-4 . ">,>,*") (10 -1 1000 0))`), '1')
})

test('선택 질문: 미리 고른 것이 없으면 묻고, 미리 고른 것이 있으면 다음 질문의 답을 먹지 않는다', () => {
  const es = [line('a', 0, 0, 100, 0), line('b', 0, 500, 100, 500)]
  assert.throws(() => run('(ssget)', { entities: es }), (e) => e.ask?.what === '선택할 객체 위의 점' && /ALL=전체/.test(e.ask.prompt))
  // 미리 고른 것 → 묻지 않고 쓰고, 첫 답은 getpoint 의 몫이다
  assert.equal(out('(setq s (ssget)) (princ (sslength s)) (princ (car (getpoint)))', { entities: es, preselected: ['a'], inputs: ['50,0'] }), '150.0')
  // 좌표로 하나씩 고르고 Enter 로 끝
  assert.equal(out('(princ (sslength (ssget)))', { entities: es, inputs: ['50,0', '50,500', ''] }), '2')
  // 창(두 점)
  assert.equal(out('(princ (sslength (ssget)))', { entities: es, inputs: ['-10,-10 200,100', ''] }), '1')
  // 아무 것도 없는 자리는 받은 값: 으로 다시 묻게 한다
  assert.throws(() => run('(ssget)', { entities: es, inputs: ['9000,9000'] }), /받은 값: 9000,9000/)
})

const engineDoc = (entities = []) => ({ ...new DrawingEngine().doc, entities })
const applies = (model) => { const e = new DrawingEngine(); e.execute({ type: 'load', document: model }); return e.doc }

test('RECTANG 은 네 꼭짓점 사각형을 만들고 도면에 적용된다(COL·BBOX)', () => {
  const model = engineDoc()
  const host = createHost(model, { vars: { CLAYER: model.layers[0].name } })
  new Interpreter(host).load('(command "_.RECTANG" (list 800 800) (list 1200 1400))')
  assert.equal(model.entities[0].type, 'rectangle')
  assert.equal(model.entities[0].points.length, 4)
  assert.equal(applies(model).entities.length, 1)
})

test('네 꼭짓점 사각형의 entget 은 찌그러지지 않고, PC(닫기)와 EXPLODE 가 도형을 지킨다', () => {
  const rect = { id: 'r', type: 'rectangle', layer: 'L0', points: [{ x: 0, y: 0 }, { x: 4000, y: 0 }, { x: 4000, y: 3000 }, { x: 0, y: 3000 }] }
  assert.equal(val("(setq *r* (mapcar 'cdr (vl-remove-if-not '(lambda (x) (= (car x) 10)) (entget (car (entsel))))))", { entities: [rect], inputs: ['2000,0'] }),
    '((0.0 0.0) (4000.0 0.0) (4000.0 3000.0) (0.0 3000.0))')
  const closed = run('(setq e (entget (car (entsel)))) (entmod (subst (cons 70 1) (assoc 70 e) e))', { entities: [rect], inputs: ['2000,0'] }).doc
  assert.deepEqual(closed.entities[0].points, rect.points)
  const exploded = run('(command "_.EXPLODE" (ssget "_X") "")', { entities: [rect] }).doc
  assert.equal(exploded.entities.length, 4)
  assert.ok(exploded.entities.every(e => Math.hypot(e.points[1].x - e.points[0].x, e.points[1].y - e.points[0].y) > 1))
})

test('(command …) 는 글자 좌표·글자 반지름·MOVE 변위(_D)·빈 (command) 를 받는다', () => {
  const { doc: model } = run('(command "LINE" "0,0" "100,0" "") (command "CIRCLE" "0,0" "5") (command) (command "MOVE" (ssget "_X") "" "_D" "10,20")')
  assert.deepEqual(model.entities.find(e => e.type === 'line').points[0], { x: 10, y: 20 })
  assert.equal(model.entities.find(e => e.type === 'circle').radius, 5)
})

test('잠긴 레이어의 객체는 지우거나 고치지 않는다', () => {
  const layers = [layer0, { ...layer0, id: 'LK', name: '잠김', locked: true }]
  const es = [line('a', 0, 0, 100, 0), { ...line('b', 0, 500, 100, 500), layer: 'LK' }]
  const { doc: model, interp } = run('(command "_.ERASE" (ssget "_X") "")', { entities: es, layers })
  assert.deepEqual(model.entities.map(e => e.id), ['b'])
  assert.match(interp.host.notes().join(), /잠긴 레이어의 객체 1개/)
  // 모두 잠겨 있어도 명령은 멈추지 않고(AutoCAD 와 같음) 알림만 남긴다
  const only = run('(command "_.ERASE" (ssget "_X") "")', { entities: [es[1]], layers })
  assert.equal(only.doc.entities.length, 1)
  assert.match(only.interp.host.notes().join(), /잠긴 레이어/)
  assert.equal(out('(setq e (entget (handent "b"))) (princ (entmod (subst (cons 8 "0") (assoc 8 e) e)))', { entities: es, layers }), 'nil')
})

test('파일 함수는 메모리 안에서만 쓰고, 없는 파일을 읽으면 nil 이다', () => {
  const { interp, out: printed } = run('(setq f (open "결과.txt" "w")) (write-line "첫 줄" f) (close f) (setq g (open "없음.txt" "r")) (princ g) (setq f (open "결과.txt" "r")) (princ (read-line f))')
  assert.equal(printed, 'nil첫 줄')
  assert.deepEqual(interp.host.outputFiles(), { '결과.txt': '첫 줄' })
})

test('자주 쓰는 함수가 있다: wcmatch·eval·load·vl-string->list·gcd·exp·log·acad_strlsort 등', () => {
  const host = createHost(doc(), { loadLisp: name => (name === 'helper.lsp' ? '(defun helper () 42)' : null) })
  const interp = new Interpreter(host)
  assert.equal(write(interp.evaluate("(list (wcmatch \"A-WALL\" \"A-*,S-*\") (eval '(+ 1 2)) (load \"helper.lsp\") (helper) (vl-string->list \"AB\") (gcd 12 18) (exp 0) (log 1) (acad_strlsort '(\"b\" \"a\")) (vl-list->string '(65)) (load \"없음.lsp\" \"대신\"))")),
    '(T 3 HELPER 42 (65 66) 6 1.0 0.0 ("a" "b") "A" "대신")')
  assert.throws(() => interp.evaluate('(load "없음.lsp")'), /등록한 파일만 불러올 수 있습니다/)
})

/* ── 비판 검토(Fable) 반영 ─────────────────────────── */

test('cdr 로 훑으며 member 로 중복을 지우는 관용구가 메모리를 제곱으로 먹지 않는다(n=2만)', () => {
  global.gc?.()
  const before = process.memoryUsage().heapUsed, started = Date.now()
  const r = val('(setq l nil i 0) (repeat 20000 (setq l (cons (rem i 97) l) i (1+ i))) (setq out nil) (while l (if (not (member (car l) (cdr l))) (setq out (cons (car l) out))) (setq l (cdr l))) (setq *r* (length out))')
  assert.equal(r, '97')
  assert.ok(Date.now() - started < 4000, `${Date.now() - started}ms`)
  assert.ok(process.memoryUsage().heapUsed - before < 300 * 1024 * 1024, 'heap 증가가 너무 큼')
})

test('문자열이 너무 커지면 영문 RangeError 가 아니라 한국어로 멈춘다', () => {
  assert.throws(() => run('(setq s "가") (repeat 40 (setq s (strcat s s)))'), /문자열이나 목록이 너무 커져/)
})

test('32비트 경계·각도 표기·정수 거듭제곱·atoi 가 AutoCAD 와 같다', () => {
  assert.equal(val("(setq *r* (list (type -2147483648) (abs -2147483648) (- -2147483648) (+ 2147483647 1) (expt 2 -1) (expt -1 -3) (atoi \"99999999999\")))"),
    '(INT -2147483648 -2147483648 -2147483648 0 -1 2147483647)')
  assert.equal(val('(setq *r* (list (angtos -1.5708) (angtos (/ pi 4) 1 4) (angtos 0.5 3 4) (angtos (/ pi 4) 4 4) (angtos (* pi 2))))'),
    '("270" "45d0\'0\\"" "0.5000r" "N 45d0\'0\\" E" "0")')
})

test('(cons 10 점) 으로 시작하는 ssget 필터는 다각형이 아니라 필터다', () => {
  assert.equal(out('(princ (sslength (ssget "_X" (list (cons 10 (list 0 500 0))))))', { entities: [line('a', 0, 500, 100, 500), line('b', 0, 0, 100, 0)] }), '1')
})

test('벽 면(가상 LINE)은 entdel·옮기는 entmod·레이어만 바꾸는 entmod 에 nil + 알림을 준다(리습은 계속 돈다)', () => {
  const wall = { id: 'w', type: 'wall', layer: 'L0', points: [{ x: 0, y: 0 }, { x: 3000, y: 0 }], thickness: 200 }
  const r = run('(setq ss (ssget "_X" (list (cons 0 "LINE"))) i 0 res nil) (repeat (sslength ss) (setq e (ssname ss i) d (entget e) i (1+ i)) (setq res (cons (list (entdel e) (entmod (subst (cons 8 "새층") (assoc 8 d) d)) (entmod (subst (cons 10 (list 0 900 0)) (assoc 10 d) d))) res))) (princ "완료")',
    { entities: [wall] })
  assert.equal(r.out, '완료')
  assert.equal(write(r.interp.evaluate('res')).includes('(nil nil nil)'), true)
  assert.deepEqual(r.doc.entities.find(e => e.id === 'w').points, wall.points)
  assert.match(r.interp.host.notes().join(), /벽 객체.*면/)
})

test('정수(BigInt)가 도면으로 새지 않는다: setvar·entmod·entmake 뒤 JSON 이 된다', async () => {
  const { runNative, inspectFile, planRun } = await import('./lisp-panel.js')
  const model = { ...new DrawingEngine().doc, entities: [{ id: 'p', type: 'polyline', layer: 'default', points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }], closed: false }] }
  const source = '(defun c:BI () (setvar "USERI1" 5) (setq e (entget (handent "p"))) (entmod (subst (cons 70 1) (assoc 70 e) e)) (entmake (list (cons 0 "CIRCLE") (cons 10 (list 1 2)) (cons 40 3) (cons 62 1) (cons 70 7))) (princ (getvar "USERI1")))'
  const files = planRun([inspectFile({ name: 'bi.lsp', source })], 'BI').files
  const r = runNative({ files, command: 'BI', snapshot: JSON.stringify(model), activeLayer: model.layers[0].name })
  const bigints = []
  const walk = (v, at) => { if (typeof v === 'bigint') bigints.push(at); else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, at + '.' + k) }
  walk(r.document, 'doc')
  assert.deepEqual(bigints, [])
  assert.doesNotThrow(() => JSON.stringify(r.document))
  assert.equal(r.output, '5')
  assert.equal(r.document.entities[0].closed, true)
  assert.equal(r.document.entities[1].radius, 3)
})

test('리습 전용 Worker 처리 함수: 결과·질문(ask)·형식 오류(retry)·시간 한도를 돌려준다', async () => {
  const { handleMessage } = await import('./lisp-worker.js')
  const snapshot = JSON.stringify({ ...new DrawingEngine().doc })
  const items = [{ name: 'w.lsp', source: '(defun c:WK () (setq p (getpoint "점: ")) (princ (car p)))\n(defun c:LOOP () (while T))' }]
  const ok = handleMessage({ id: 1, items, command: 'WK', snapshot, inputs: ['5,6'] })
  assert.equal(ok.result.output, '5.0')
  const ask = handleMessage({ id: 2, items, command: 'WK', snapshot, inputs: [] })
  assert.equal(ask.error.ask.what, '점'); assert.equal(ask.error.lisp, true)
  const retry = handleMessage({ id: 3, items, command: 'WK', snapshot, inputs: ['abc'] })
  assert.equal(retry.error.retry, true)
  const started = Date.now()
  const slow = handleMessage({ id: 4, items, command: 'LOOP', snapshot, timeLimitMs: 200 })
  assert.match(slow.error.message, /실행 시간이 0\.2초를 넘어 중지했습니다/)
  assert.ok(Date.now() - started < 1500, `시간 한도가 늦게 걸림: ${Date.now() - started}ms`)
})

test('화면은 Worker 로 돌리고 중지 버튼으로 끊을 수 있으며, Worker 가 없으면 이 스레드에서 돈다', () => {
  const panel = fs.readFileSync(new URL('./lisp-panel.js', import.meta.url), 'utf8')
  assert.match(panel, /new Worker\(new URL\('\.\/lisp-worker\.js'\+versionQuery\(\),import\.meta\.url\),\{type:'module'\}\)/)
  assert.match(panel, /workerFailures>=2&&!workerBroken/)            // 한 번 실패로 세션 내내 끄지 않는다
  assert.match(panel, /stop\.textContent='중지';stop\.onclick=cancelRun/)
  assert.match(panel, /function cancelRun\(\)\{[^}]*dropWorker\(\)/)
  assert.match(panel, /if\(!ready\)return runNativeBridged\(\{\.\.\.options,cardStorage,timeLimitMs:INLINE_LIMIT_MS\}\)/)   // 건축 요소 명령 다리도 같은 길
  const server = fs.readFileSync(new URL('./server.py', import.meta.url), 'utf8')
  assert.match(server, /allowed\.add\('\/lisp-worker\.js'\)/)
  const build = fs.readFileSync(new URL('./build_desktop.py', import.meta.url), 'utf8')
  assert.match(build, /'tablet-input\.js','lisp-worker\.js'/)
})

test('형식이 틀린 답만 되묻고, 리습 자체의 오류(받은 값: 이 들어 있어도)는 답을 지우지 않는다', async () => {
  const { runWithPrompts, inspectFile, planRun } = await import('./lisp-panel.js')
  const snapshot = JSON.stringify({ ...new DrawingEngine().doc })
  const files = planRun([inspectFile({ name: 't.lsp', source: '(defun c:TE () (setq n (getreal "수: ")) (+ "a" n))' })], 'TE').files
  let asked = 0
  await assert.rejects(runWithPrompts({ files, command: 'TE', snapshot, activeLayer: '0' }, () => { asked++; return '3' }), /\+: 숫자가 필요합니다/)
  assert.equal(asked, 1)
})

// 큰 도면 리습: 원본을 얼려 두고 목록만 복사해 쓰는 방식(copy-on-write)은 예전 방식(매번 전체 JSON.parse)과 결과가 같아야 한다.
test('copy-on-write 실행은 예전 방식과 같은 결과를 내고, 바뀐 것만 delta 로 돌려준다', async () => {
  const { runNative, inspectFile, planRun, applyLispDelta, releasePristine } = await import('./lisp-panel.js')
  const layer = { id: 'L0', name: '0', color: '#ffffff', visible: true, locked: false }
  const text = (id, x, value) => ({ id, type: 'text', layer: 'L0', position: { x, y: 0 }, text: value, height: 250, rotation: 0 })
  const model = { version: 2, units: 'mm', layers: [layer], blocks: [], entities: [text('t1', 0, '거실'), text('t2', 1000, '침실'), text('t3', 2000, '거실'),
    { id: 'p1', type: 'polyline', layer: 'L0', points: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }] }] }
  const source = `
(defun c:RED (/ ss) (setq ss (ssget "X" '((0 . "TEXT") (1 . "거실")))) (command "CHPROP" ss "" "C" "1" "") (princ))
(defun c:JUST (/ ss) (setq ss (ssget "X" '((0 . "TEXT")))) (command "JUSTIFYTEXT" ss "" "MC") (princ))
(defun c:DEL1 () (entdel (handent "t2")) (princ))
(defun c:MOD1 (/ e) (setq e (entget (handent "t1"))) (entmod (subst (cons 1 "안방") (assoc 1 e) e)) (princ))
(defun c:ERR1 (/ *error* ss) (defun *error* (m) (princ m)) (setq ss (ssget "X" '((0 . "TEXT")))) (command "CHPROP" ss "" "C" "3" "") (princ))
(defun c:NONE () (princ "그대로"))`
  const files = [inspectFile({ name: 'cow.lsp', source })]
  const snapshot = JSON.stringify(model)
  const strip = (doc) => JSON.stringify(doc.entities.map(e => ({ ...e, id: model.entities.some(o => o.id === e.id) ? e.id : 'NEW' })))
  for (const command of ['RED', 'JUST', 'DEL1', 'MOD1', 'ERR1', 'NONE']) {
    const plan = planRun(files, command)
    const legacy = runNative({ files: plan.files, command, snapshot, copyOnWrite: false })
    const fresh = runNative({ files: plan.files, command, snapshot, snapshotKey: 'cow-' + command })
    releasePristine()
    assert.equal(fresh.changed, legacy.changed, command)
    assert.ok('delta' in fresh, `${command}: 가벼운 복사로 돌아야 한다(예전 방식으로 넘어가면 안 된다)`)
    const applied = fresh.delta ? applyLispDelta(model, structuredClone(fresh.delta)) : model
    assert.equal(strip(applied), strip(legacy.changed ? legacy.document : model), command)
    // 바뀌지 않은 객체는 실행 전 객체 그대로 쓴다.
    if (fresh.delta) assert.ok(applied.entities.some(e => model.entities.includes(e)), command)
  }
  assert.equal(JSON.stringify(model), snapshot, '원본 도면은 바뀌지 않는다')
})


test('생성한 LAYSTD 표준의 색·선종류·굵기·출력은 레이어 레코드 왕복으로 보존된다', () => {
  const model = doc(), host = createHost(model), interp = new Interpreter(host)
  interp.load(fs.readFileSync(new URL('./examples/architecture-lisp/01_LAYSTD_레이어표준.lsp', import.meta.url), 'utf8'))
  interp.callCommand('LAYSTD')
  for (const standard of TEMPLATE_LAYERS) {
    const layer = model.layers.find(l => l.name === standard.name)
    assert.ok(layer, standard.name)
    for (const key of ['color', 'linetype', 'lineweight', 'plot']) assert.equal(layer[key], standard[key], standard.name + ':' + key)
    const before = structuredClone(layer)
    host.entmod(host.entget(host.tblobjname('LAYER', standard.name)))
    assert.deepEqual(layer, before, standard.name)
  }
})

test('사용자 리습 레이어의 DXF truecolor·굵기·출력·상태도 왕복 보존한다', () => {
  const { doc: model } = run('(entmake \'((0 . "LAYER") (2 . "USER") (62 . -7) (420 . 1193046) (370 . 50) (290 . 0) (70 . 5) (6 . "HIDDEN"))) (entmod (entget (tblobjname "LAYER" "USER")))')
  const layer = model.layers.find(l => l.name === 'USER')
  assert.equal(layer.color, '#123456')
  assert.equal(layer.lineweight, .5)
  assert.equal(layer.plot, false)
  assert.equal(layer.visible, false)
  assert.equal(layer.locked, true)
  assert.equal(layer.frozen, true)
  assert.equal(layer.linetype, 'HIDDEN')
})

test('선택집합 반복 조회 후 추가·삭제해도 ssmemb·순서·개수가 일치한다',()=>{
 const host=createHost(doc([line('a',0,0,1,0),line('b',0,1,1,1)])),i=new Interpreter(host);
 i.load('(setq s (ssget "_X") a (ssname s 0) b (ssname s 1)) (repeat 10000 (ssmemb a s)) (ssdel a s)');
 assert.equal(i.evaluate('(ssmemb a s)'),null);assert.equal(i.evaluate('(sslength s)'),1n);
 i.load('(ssadd a s) (ssadd a s)');
 assert.equal(i.evaluate('(sslength s)'),2n);assert.equal(i.evaluate('(ssname s 0)').id,'b');assert.equal(i.evaluate('(ssmemb a s)').id,'a');
});

test('ssget 명시적 전체 선택 뒤에는 미리 선택을 재사용하지 않고 다음 입력을 읽는다(G8)', () => {
  const es=[line('a',0,0,100,0),line('b',0,500,100,500)]
  for(const all of ['ALL','_ALL','전체','*']) {
    const source='(princ (sslength (ssget))) (princ ":") (princ (cadr (cdr (assoc 10 (entget (ssname (ssget) 0)))))) (princ ":") (princ (car (getpoint)))'
    assert.equal(out(source,{entities:es,preselected:['a'],inputs:[all,'50,500','','75,800']}),'2:500.0:75.0',all)
  }
})
