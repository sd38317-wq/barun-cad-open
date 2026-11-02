// 저장이 오토캐드와 같은 규칙대로 도는가.
// 오늘 저장 쪽에서 결함이 열 건 나왔는데 그 자리를 지켜 주는 시험이 없었다.
// app.js 에서 저장 구간만 떼어 내 가짜 화면에서 돌린다(grip-drag.test.js 와 같은 방식).
import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import fs from 'node:fs'

const source = fs.readFileSync(new URL('./app.js', import.meta.url), 'utf8')
const cut = (from, to) => source.slice(source.indexOf(from), source.indexOf(to))
const saving = cut('let saveDialogEl = null,', 'function bytesToBase64(bytes) {')
const savingAll = cut('async function saveAllDrawings(){', 'async function initializeDrawingTabs(){')

/** 저장 창의 진짜 DOM 대신, 코드가 실제로 찾는 자리만 갖춘 가짜 창. */
function fakeDialog() {
  const note = { textContent: '' }
  const name = { value: '', focus() { }, select() { }, addEventListener() { } }
  const heading = { textContent: '' }
  const radios = { dxf: { value: 'dxf', checked: true }, dwg: { value: 'dwg', checked: false, disabled: false }, bcad: { value: 'bcad', checked: false } }
  for (const radio of Object.values(radios)) {
    let checked = radio.checked
    Object.defineProperty(radio, 'checked', { get: () => checked, set(value) { checked = value; if (value) for (const other of Object.values(radios)) if (other !== radio) other.checked = false } })
  }
  const versionListeners = []
  const version = { value: '2018', disabled: false, addEventListener(kind, fn) { versionListeners.push(fn) }, pick(value) { version.value = value; for (const fn of versionListeners) fn() } }
  const dxfVersionListeners = []
  const dxfVersion = { value: '2018', addEventListener(kind, fn) { dxfVersionListeners.push(fn) }, pick(value) { dxfVersion.value = value; for (const fn of dxfVersionListeners) fn() } }
  const dwgRow = { title: '' }
  const confirmButton = {}, closeButtons = [{}, {}]
  const listeners = []
  const dialog = {
    className: '', innerHTML: '', open: false, __done: null,
    append() { },
    addEventListener(kind, fn, options) { listeners.push({ kind, fn, once: !!options?.once }) },
    showModal() { dialog.open = true },
    close() {
      if (!dialog.open) return
      dialog.open = false
      // 진짜 dialog.close() 는 close 이벤트를 '다음 차례'에 띄운다. 그 순서를 그대로 흉내낸다.
      setTimeout(() => {
        for (const entry of listeners.filter(l => l.kind === 'close')) {
          if (entry.once) listeners.splice(listeners.indexOf(entry), 1)
          entry.fn()
        }
      }, 0)
    },
    querySelector(selector) {
      if (selector === '[name=save-format]:checked') return Object.values(radios).find(r => r.checked) || null
      return { '.save-note': note, '.save-name': name, '.dialog-header h2': heading, '.save-confirm': confirmButton, '[value=dxf]': radios.dxf, '[value=dwg]': radios.dwg, '[value=bcad]': radios.bcad, '.save-dwg-version': version, '.save-dxf-version': dxfVersion, '.save-dwg-row': dwgRow }[selector] || null
    },
    querySelectorAll() { return closeButtons },
    parts: { note, name, heading, radios, version, dxfVersion, dwgRow, confirmButton, closeButtons },
  }
  return dialog
}

/** 저장 구간을 돌릴 가짜 화면. saved 에 '무엇이 저장됐는지'가 쌓인다. */
function stage({ fileName = '평면도', tabs = [], activeId = null, exportFails = false, api = null, large = false, warnings = [] } = {}) {
  const dialog = fakeDialog()
  const saved = []
  const toasts = []
  const requests = []
  const infos = []
  const context = {
    api, requests, sceneRevision: 0,
    structuredClone, JSON, Promise, setTimeout,
    // Collect the browser console: Node stdout also carries V8 test report frames.
    // Mixing console.info text with those frames can break deserialization.
    console: { info: (...args) => infos.push(args) },
    fileName, filePath: '', busy: false, dirty: true,
    engine: { doc: { entities: [], layers: [] } },
    saved, toasts, infos, dialog,
    document: { createElement: () => dialog, body: { append() { } } },
    canvas: { focus() { } },
    $: () => ({ textContent: '' }),
    toast: (text, bad) => toasts.push({ text, bad }),
    safe: (fn) => { try { return fn() } catch (e) { toasts.push({ text: e.message, bad: true }); return null } },
    updatePrompt() { }, renderDrawingTabs() { }, scheduleDrawingRecovery() { },
    flushDrawingRecovery: async () => { },
    tabSwitchAllowed() { },
    studio: {
      getFolder: () => '', output: async () => { },
      isLargeDocument: () => large,
      // 대용량 저장: 셸의 저장 창이 경로를 등록하고 엔진이 그 경로에 직접 쓴다. 무엇을 넘겼는지 받는다.
      saveLargeDocument: async (document, outName, format, options) => {
        requests.push({ large: true, name: outName, format, options })
        if (exportFails) throw Error('내보내기 실패')
        saved.push({ name: outName, format }); return { warnings: [] }
      },
    },
    // 서버 왕복도 진짜처럼 한 차례 쉬어 간다. 그래야 창 닫힘과의 순서가 드러난다.
    request: async (path, body) => {
      requests.push({ path, format: body.format, dwgVersion: body.dwgVersion, ...('version' in body ? { version: body.version } : {}) })
      await new Promise(done => setTimeout(done, 0))
      if (exportFails) throw Error('내보내기 실패')
      return { data: '', warnings }
    },
    backup: async () => {
      await new Promise(done => setTimeout(done, 0))
      saved.push({ name: context.fileName, format: 'bcad' })
      context.dirty = false; context.documents.checkpoint(); return true
    },
  }
  context.documents = {
    tabs, activeId,
    // 저장이 끝나면 지금 상태를 탭에 새겨 둔다(진짜 checkpoint 가 하는 일).
    checkpoint() { const tab = tabs.find(t => t.id === context.documents.activeId); if (tab) Object.assign(tab, context.__captureSaveState(), { dirty: context.dirty }) },
    dirtyTabs: () => tabs.filter(t => t.dirty),
    // 탭을 고르면 그 탭의 이름·형식이 살아난다(applyDrawingTab 이 하는 일).
    select(id) {
      const tab = tabs.find(t => t.id === id)
      context.documents.activeId = id
      context.__applySaveState(tab)
    },
  }
  vm.createContext(context)
  // saveFormat 은 떼어 온 구간 안의 let 이라 바깥에서 건드릴 수 없다.
  // 같은 조각에 작은 손잡이를 함께 실어, 탭 전환이 형식을 되살리는 길을 흉내낸다.
  vm.runInContext(saving + '\n' + savingAll
    + '\nfunction __setFormat(value,version){saveFormat=value;if(version)dwgVersion=version}\nfunction __getFormat(){return saveFormat}\nfunction __getVersion(){return dwgVersion}\nfunction __getDxfVersion(){return dxfVersion}'
    + '\nfunction __captureSaveState(){' + source.match(/return \{name:fileName,filePath,saveFormat,[^\n]+/)[0].split(',doc:')[0] + '}}'
    + '\nfunction __applySaveState(tab){' + source.match(/fileName=tab.name;filePath=tab.filePath[^\n]+/)[0].split('const view=')[0] + '}', context)
  // saveDXF·saveDWG 는 studio.output 으로 파일을 내보낸다. 무엇을 내보냈는지 여기서 받는다.
  context.studio.output = async (data, outName) => { saved.push({ name: outName, format: /\.dwg$/.test(outName) ? 'dwg' : 'dxf' }) }
  return context
}

/** 저장 창이 뜬 상태에서 이름을 적고 저장 단추를 누른다. */
function typeAndConfirm(stageContext, name, format = 'dxf') {
  const { parts } = stageContext.dialog
  parts.name.value = name
  parts.radios.dxf.checked = format === 'dxf'
  parts.radios.dwg.checked = format === 'dwg'
  parts.radios.bcad.checked = format === 'bcad'
  parts.confirmButton.onclick()
}
const settle = () => new Promise(done => setTimeout(done, 5))

test('이름이 있는 도면은 묻지 않고 그대로 저장한다', async () => {
  const s = stage({ fileName: '평면도' })
  const done = s.saveActiveDrawing()
  assert.equal(s.dialog.open, false, '창이 뜨면 안 된다')
  assert.equal(await done, true)
  assert.deepEqual(s.saved, [{ name: '평면도.dxf', format: 'dxf' }])
})

test('아직 이름이 없는 새 도면은 이름부터 묻는다', async () => {
  const s = stage({ fileName: '새 도면 2' })
  const done = s.saveActiveDrawing()
  assert.equal(s.dialog.open, true)
  typeAndConfirm(s, '1층 평면도')
  assert.equal(await done, true, '저장에 성공했으면 성공이라고 답해야 한다')
  assert.deepEqual(s.saved, [{ name: '1층 평면도.dxf', format: 'dxf' }])
  assert.equal(s.fileName, '1층 평면도')
})

test('확장자까지 적어도 평면도.dxf.dxf 가 되지 않는다', async () => {
  const s = stage({ fileName: '새 도면 1' })
  const done = s.saveActiveDrawing()
  typeAndConfirm(s, '평면도.dxf')
  await done
  assert.deepEqual(s.saved, [{ name: '평면도.dxf', format: 'dxf' }])
})

test('저장에 실패하면 이름이 예전 것으로 되돌아간다', async () => {
  const s = stage({ fileName: '새 도면 1', exportFails: true })
  const done = s.saveActiveDrawing()
  typeAndConfirm(s, '평면도')
  assert.equal(await done, false)
  assert.equal(s.fileName, '새 도면 1', '실패한 이름으로 굳으면 다음 저장까지 틀어진다')
  assert.deepEqual(s.saved, [])
})

test('다른 탭이 이미 쓰는 이름은 막는다', async () => {
  const s = stage({ fileName: '새 도면 1', activeId: 'b', tabs: [{ id: 'a', name: '평면도' }, { id: 'b', name: '새 도면 1' }] })
  s.saveActiveDrawing()
  typeAndConfirm(s, '평면도')
  await settle()
  assert.match(s.dialog.parts.note.textContent, /이미 "평면도" 도면이 열려 있습니다/)
  assert.equal(s.dialog.open, true, '이름을 고칠 수 있게 창이 열려 있어야 한다')
  assert.deepEqual(s.saved, [])
})

test('BCAD 를 고르면 BCAD 로 저장하고 다음 저장도 그 형식이다', async () => {
  const s = stage({ fileName: '새 도면 1' })
  const done = s.saveActiveDrawing()
  typeAndConfirm(s, '주단면도', 'bcad')
  await done
  assert.deepEqual(s.saved, [{ name: '주단면도', format: 'bcad' }])
  await s.saveActiveDrawing()
  assert.equal(s.saved.length, 2)
  assert.equal(s.saved[1].format, 'bcad', '형식을 기억해야 Ctrl+S 가 형식을 바꾸지 않는다')
  assert.equal(s.__getFormat(), 'bcad')
})

test('모두 저장은 탭마다 제 이름·제 형식으로 저장한다', async () => {
  const tabs = [{ id: 'a', name: '평면도', saveFormat: 'dxf', dirty: true },
  { id: 'b', name: '주단면도', saveFormat: 'bcad', dirty: true },
  { id: 'c', name: '입면도', saveFormat: 'dxf', dirty: false }]
  const s = stage({ fileName: '평면도', activeId: 'a', tabs })
  const ok = await s.saveAllDrawings()
  assert.equal(ok, true)
  assert.deepEqual(s.saved, [{ name: '평면도.dxf', format: 'dxf' }, { name: '주단면도', format: 'bcad' }])
  assert.equal(s.documents.activeId, 'a', '저장이 끝나면 원래 보던 탭으로 돌아와야 한다')
})

test('모두 저장 도중 이름을 물어도 나머지 탭까지 저장한다', async () => {
  const tabs = [{ id: 'a', name: '새 도면 1', saveFormat: 'dxf', dirty: true },
  { id: 'b', name: '주단면도', saveFormat: 'dxf', dirty: true }]
  const s = stage({ fileName: '새 도면 1', activeId: 'a', tabs })
  const done = s.saveAllDrawings()
  await settle()
  assert.equal(s.dialog.open, true, '이름 없는 탭은 이름을 물어야 한다')
  typeAndConfirm(s, '배치도')
  assert.equal(await done, true, '창으로 저장한 탭을 실패로 세면 나머지 탭이 저장되지 않는다')
  assert.deepEqual(s.saved.map(x => x.name), ['배치도.dxf', '주단면도.dxf'])
})

test('DWG 를 고르면 엔진에 DWG 변환(버전 포함)을 맡기고 .dwg 로 저장하며, 다음 저장도 DWG 다', async () => {
  const s = stage({ fileName: '새 도면 1' })
  const done = s.saveActiveDrawing()
  s.dialog.parts.version.pick('2013')
  assert.equal(s.dialog.parts.radios.dwg.checked, true, '버전을 고르면 DWG 를 고른 것이다')
  typeAndConfirm(s, '배치도.dwg', 'dwg')
  assert.equal(await done, true)
  assert.deepEqual(s.saved, [{ name: '배치도.dwg', format: 'dwg' }], '확장자를 적어도 배치도.dwg.dwg 가 되지 않는다')
  assert.deepEqual(s.requests[0], { path: '/api/export', format: 'dwg', dwgVersion: '2013' })
  assert.equal(s.dirty, false)
  await s.saveActiveDrawing()
  assert.deepEqual(s.saved.at(-1), { name: '배치도.dwg', format: 'dwg' }, 'Ctrl+S 는 묻지 않고 DWG 로 저장한다')
  assert.deepEqual(s.requests.at(-1), { path: '/api/export', format: 'dwg', dwgVersion: '2013' }, '고른 버전을 기억한다')
  assert.equal(s.__getFormat(), 'dwg')
})

test('DXF 저장 요청에는 DWG 변환 표시가 붙지 않는다(기본은 여전히 DXF)', async () => {
  const s = stage({ fileName: '평면도' })
  await s.saveActiveDrawing()
  assert.deepEqual(s.requests, [{ path: '/api/export', format: undefined, dwgVersion: undefined, version: 'R2018' }])
  assert.deepEqual(s.saved, [{ name: '평면도.dxf', format: 'dxf' }])
  s.openSaveDialog(true)
  assert.equal(s.dialog.parts.radios.dxf.checked, true)
  assert.equal(s.dialog.parts.radios.dwg.checked, false)
})

test('DWG 변환이 실패하면 이름·형식·버전이 예전 것으로 돌아가고 이유를 알린다', async () => {
  const s = stage({ fileName: '평면도', exportFails: true })
  const done = s.openSaveDialog(true)
  s.dialog.parts.version.pick('2004')
  typeAndConfirm(s, '배치도', 'dwg')
  assert.equal(await done, false)
  assert.equal(s.fileName, '평면도')
  assert.equal(s.__getFormat(), 'dxf')
  assert.equal(s.__getVersion(), '2018')
  assert.ok(s.toasts.some(t => t.bad && /내보내기 실패/.test(t.text)))
})

test('변환 엔진이 없는 실행에서는 DWG 를 고를 수 없고 이유를 보인다', async () => {
  const s = stage({ fileName: '평면도', api: { dxf: true, converters: { bundled: false } } })
  s.__setFormat('dwg')
  s.openSaveDialog(true)
  assert.equal(s.dialog.parts.radios.dwg.disabled, true)
  assert.equal(s.dialog.parts.version.disabled, true)
  assert.equal(s.dialog.parts.radios.dxf.checked, true, '못 쓰는 DWG 대신 DXF 가 골라져 있어야 한다')
  assert.match(s.dialog.parts.note.textContent, /DWG 변환 엔진이 없어/)
  // 예전에 DWG 로 저장하던 탭에서 Ctrl+S 를 눌러도 엉뚱한 파일을 만들지 않고 이유를 말한다.
  s.dialog.close()
  await settle()
  assert.equal(await s.saveActiveDrawing(), false)
  assert.deepEqual(s.saved, [])
  assert.ok(s.toasts.some(t => t.bad && /DWG 변환 엔진이 없어/.test(t.text)))
})

test('대용량 도면의 DWG 저장은 셸 저장 창 경로(dwg 형식·버전)로 간다', async () => {
  const s = stage({ fileName: '전체평면도', large: true })
  s.__setFormat('dwg', '2010')
  assert.equal(await s.saveActiveDrawing(), true)
  assert.deepEqual(JSON.parse(JSON.stringify(s.requests)), [{ large: true, name: '전체평면도.dwg', format: 'dwg', options: { dwgVersion: '2010' } }])
})

test('모두 저장은 DWG 탭을 제 버전의 DWG 로 저장한다', async () => {
  const tabs = [{ id: 'a', name: '평면도', saveFormat: 'dxf', dirty: true },
  { id: 'b', name: '배치도', saveFormat: 'dwg', dwgVersion: '2004', dirty: true }]
  const s = stage({ fileName: '평면도', activeId: 'a', tabs })
  assert.equal(await s.saveAllDrawings(), true)
  assert.deepEqual(s.saved, [{ name: '평면도.dxf', format: 'dxf' }, { name: '배치도.dwg', format: 'dwg' }])
  assert.equal(s.requests[1].dwgVersion, '2004')
})

for (const large of [false, true]) test('DXF 2000 선택·다음 저장·탭별 복원(' + (large ? '대용량' : '일반') + ')', async () => {
  const tabs = [{ id: 'a', name: '평면도', saveFormat: 'dwg', dirty: true }, { id: 'b', name: '배치도', dirty: true }]
  const s = stage({ fileName: '평면도', activeId: 'a', tabs, large })
  s.documents.select('a')
  const done = s.openSaveDialog(true)
  s.dialog.parts.dxfVersion.pick('2000')
  assert.equal(s.dialog.parts.radios.dxf.checked, true)
  assert.equal(s.dialog.parts.radios.dwg.checked, false)
  s.dialog.parts.confirmButton.onclick()
  assert.equal(await done, true)
  assert.equal(tabs[0].dxfVersion, '2000', '체크포인트에 버전을 보관한다')
  const expected = large
    ? { large: true, name: '평면도.dxf', format: 'dxf', options: { dxfVersion: '2000' } }
    : { path: '/api/export', format: undefined, dwgVersion: undefined, version: 'R2000' }
  const check = () => assert.deepEqual(structuredClone(s.requests.at(-1)), expected)
  check()
  assert.equal(await s.saveActiveDrawing(), true)
  check()
  s.documents.select('b')
  assert.equal(s.__getDxfVersion(), '2018', '다른 탭 기본값에 이전 버전이 섞이지 않는다')
  assert.equal(await s.saveActiveDrawing(), true)
  if (large) assert.equal(s.requests.at(-1).options.dxfVersion, '2018')
  else assert.equal(s.requests.at(-1).version, 'R2018')
  s.documents.select('a')
  assert.equal(s.__getDxfVersion(), '2000')
  assert.equal(await s.saveActiveDrawing(), true)
  check()
  const reopened = s.openSaveDialog(true)
  assert.equal(s.dialog.parts.dxfVersion.value, '2000', '다시 연 창에도 기억한 버전을 표시한다')
  s.dialog.close()
  assert.equal(await reopened, false)
})

test('DXF 저장 실패는 이름·형식·버전을 복구한다', async () => {
  const s = stage({ fileName: '평면도', exportFails: true })
  const done = s.openSaveDialog(true)
  s.dialog.parts.dxfVersion.pick('2000')
  typeAndConfirm(s, '배치도')
  assert.equal(await done, false)
  assert.equal(s.fileName, '평면도')
  assert.equal(s.__getDxfVersion(), '2018')
  assert.equal(s.__getFormat(), 'dxf')
})

const newerVersionWarning = '원본 보존을 위해 처음 DXF 버전(2018)을 유지했습니다. 고른 버전으로 저장되지 않았습니다.'
const olderVersionNotice = '원본 보존을 위해 처음 DXF 버전(2013)을 유지했습니다.'
const specialCharacterWarning = '2000·2004 DXF 에는 일부 특수 문자(2자)를 담을 수 없습니다. 2007 이상으로 저장하세요.'
for (const [warnings,versionWarning] of [[[], ''], [['선종류를 대체했습니다.'], ''], [[olderVersionNotice], ''], [['선종류를 대체했습니다.', newerVersionWarning], newerVersionWarning], [[specialCharacterWarning], specialCharacterWarning], [[newerVersionWarning, specialCharacterWarning], newerVersionWarning + ' ' + specialCharacterWarning]]) test('DXF 저장 알림은 버전 불일치·특수 문자 경고만 보여 준다(' + warnings.length + ')', async () => {
  const s = stage({ warnings })
  const done = s.openSaveDialog(true)
  s.dialog.parts.dxfVersion.pick('2000')
  s.dialog.parts.confirmButton.onclick()
  assert.equal(await done, true)
  assert.deepEqual(s.toasts.at(-1), { text: 'DXF 파일을 저장했습니다.' + (versionWarning ? ' ' + versionWarning : ''), bad: !!versionWarning })
  assert.deepEqual(s.infos, warnings.length ? [['저장 세부 안내', warnings]] : [])
})

test('DXF 강등 안내는 일반 알림이다', async () => {
  const notice='구버전(2000) 저장: MULTILEADER 2개를 기본 객체로 바꿨습니다.'
  const s=stage({warnings:[notice]});const done=s.openSaveDialog(true)
  s.dialog.parts.dxfVersion.pick('2000');s.dialog.parts.confirmButton.onclick()
  assert.equal(await done,true);assert.deepEqual(s.toasts.at(-1),{text:'DXF 파일을 저장했습니다. '+notice,bad:false})
  assert.deepEqual(s.infos, [['저장 세부 안내', [notice]]])
})
