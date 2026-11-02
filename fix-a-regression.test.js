// 5.0.4 검토(2026-09-24) 수정 A 영역 회귀 테스트. 화면 규칙은 모듈로 떼어 실제 함수를 시험한다.
//  command-search.js(F1 검색), command-history-shortcut.js(Ctrl+Z 라우팅), form-controls.js(체크박스),
//  calculator-shortcut.js(연산자 계산기), lisp-question-queue.js(리습 질문 경쟁), engine.js transaction(카드 되돌리기 묶음),
//  commands.js(투명 명령·한글 명령·옛 이름·추천), plot.js(맞춤 오차·여백·색), geometry.js(치수 미리보기), user-error.js(값 보존).
//  화면 재현은 scratchpad\fix\A\r01-critic.mjs, r02-critic.mjs (헤드리스 Edge/CDP) 로 별도 확인한다.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {COMMANDS, defaultAliases, resolveCommand, classifyInput, suggestCommands, TRANSPARENT_COMMANDS, LEGACY_LABELS, koreanNamesFor, stripCommandPrefix, preprocessImeCommand, hangulToQwerty} from './commands.js';
import {rankCommandSearch, searchEnterDecision, tokenizeLabel} from './command-search.js';
import {historyShortcutAction} from './command-history-shortcut.js';
import {checkboxState, controlValue} from './form-controls.js';
import {calculatorShortcut} from './calculator-shortcut.js';
import {createQuestionQueue} from './lisp-question-queue.js';
import {plotSVG, plotPDFJob, fitsPaper, automaticPlotColor, legiblePlotColor, paperFitError} from './plot.js';
import {dimensionParts, primitives} from './geometry.js';
import {userErrorMessage, looksTechnical} from './user-error.js';
import {DrawingEngine} from './engine.js';
import {MENU_CATALOG} from './menu-catalog.js';

const settings = { aliases: defaultAliases() };
const app = fs.readFileSync(new URL('./app.js', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('./style.css', import.meta.url), 'utf8');
const html = fs.readFileSync(new URL('./index.html', import.meta.url), 'utf8');
const luminance = hex => { const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)); return r * .2126 + g * .7152 + b * .0722; };
const line = (i = 0) => ({ type: 'line', layer: 'default', points: [{ x: 0, y: i }, { x: 100, y: i }] });
const rect = (w, h) => ({ type: 'rectangle', layer: 'default', points: [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }] });

// ── 1. 명령 도중 취소·U·ㅕ (검토자 #1) ──
test('취소 는 명령 끝내기(SELECT)이고, UNDO/REDO 는 투명 명령이 아니라 좌표 단계에서 실행되지 않는다', () => {
  assert.equal(resolveCommand('취소', settings), 'SELECT');
  assert.equal(TRANSPARENT_COMMANDS.has('UNDO'), false);
  assert.equal(TRANSPARENT_COMMANDS.has('REDO'), false);
  assert.deepEqual(classifyInput('U', 'point', settings), { kind: 'value', value: 'U', blockedCommand: 'UNDO' });
  assert.deepEqual(classifyInput('UNDO', 'point', settings), { kind: 'value', value: 'UNDO', blockedCommand: 'UNDO' });
  assert.deepEqual(classifyInput('취소', 'point', settings), { kind: 'command', value: 'SELECT' });
  // 한글 자판 옵션은 submit() 이 옵션 검사보다 먼저 영문으로 바꾼다(ㅕ→U, ㅊ→C, ㅁ→A).
  assert.equal(hangulToQwerty('ㅕ').toUpperCase(), 'U');
  assert.equal(hangulToQwerty('ㅊ').toUpperCase(), 'C');
  assert.match(app, /const typed=value\.trim\(\),option=\(\/\^\[ㄱ-ㅣ가-힣\]\+\$\/\.test\(typed\)\?hangulToQwerty\(typed\):typed\)\.toUpperCase\(\);/);
});

// ── 2. Ctrl+Z 라우팅 (검토자 #2) ──
test('Ctrl+Z: 대기면 도면 되돌리기, 선·폴리선·경로 중이면 마지막 점 취소, 그 밖의 명령 중이면 명령만 취소, Ctrl+Y 는 명령 중 무시', () => {
  assert.equal(historyShortcutAction({ name: 'UNDO', mode: 'SELECT', phase: 'idle' }).action, 'document');
  assert.equal(historyShortcutAction({ name: 'REDO', mode: 'SELECT', phase: 'idle' }).action, 'document');
  assert.equal(historyShortcutAction({ name: 'UNDO', mode: 'LINE', phase: 'point', points: [{}], lineSteps: [{}] }).action, 'step');
  assert.equal(historyShortcutAction({ name: 'UNDO', mode: 'LINE', phase: 'point', points: [{}], lineSteps: [] }).action, 'cancel', '첫 점만 찍은 선은 명령 취소');
  assert.equal(historyShortcutAction({ name: 'UNDO', mode: 'PLINE', phase: 'point', points: [{}, {}] }).action, 'step');
  assert.equal(historyShortcutAction({ name: 'UNDO', mode: 'PICKPATH', phase: 'point', points: [{}] }).action, 'step');
  assert.equal(historyShortcutAction({ name: 'UNDO', mode: 'CIRCLE', phase: 'point', points: [{}] }).action, 'cancel');
  assert.equal(historyShortcutAction({ name: 'UNDO', mode: 'MOVE', phase: 'point', points: [] }).action, 'cancel');
  assert.equal(historyShortcutAction({ name: 'REDO', mode: 'LINE', phase: 'point', points: [{}], lineSteps: [{}] }).action, 'ignore');
  assert.match(app, /if\(historyCommand\)\{e\.preventDefault\(\);historyShortcut\(historyCommand\);return;\}/);
  assert.match(app, /if\(\['UNDO','REDO'\]\.includes\(found\[0\]\)\)historyShortcut\(found\[0\]\);else run\(found\[0\]\);/);
});

// ── 3. 카드 되돌리기 묶음: 엔진 transaction (검토자 #3) ──
test('engine transaction: 150번 실행해도 되돌리기 한 번에 시작 문서로 돌아가고 상한(100)을 소모하지 않는다', () => {
  const e = new DrawingEngine();
  const base = e.doc;
  e.beginTransaction();
  for (let i = 0; i < 150; i++) e.execute({ type: 'add', entity: line(i) });
  assert.equal(e.undoStack.length, 0, '묶음 안에서는 되돌리기 더미를 쓰지 않는다');
  assert.deepEqual(e.endTransaction(), { merged: 150, changed: true });
  assert.equal(e.undoStack.length, 1);
  e.execute({ type: 'undo' });
  assert.equal(e.doc, base);
  e.execute({ type: 'redo' });
  assert.equal(e.doc.entities.length, 150);
  // 중첩: 바깥 end 에서만 확정. 변경이 없으면 아무것도 넣지 않는다.
  e.beginTransaction(); e.beginTransaction(); e.execute({ type: 'add', entity: line(200) }); assert.equal(e.endTransaction().open, true); assert.equal(e.endTransaction().changed, true);
  e.beginTransaction(); assert.equal(e.endTransaction().changed, false);
  assert.equal(e.undoStack.length, 2);
  // 묶음 도중 undo 가 오면 지금까지를 한 단계로 확정한 뒤 되돌린다.
  e.beginTransaction(); e.execute({ type: 'add', entity: line(300) }); e.execute({ type: 'add', entity: line(301) }); e.execute({ type: 'undo' });
  assert.equal(e.inTransaction(), false); assert.equal(e.doc.entities.length, 151);
  assert.match(app, /function beginCardWork\(\)\{engine\.beginTransaction\(\);\}/);
  assert.doesNotMatch(app, /engine\.undoStack\.splice|stack\.splice\(index\+1\)/);
});

test('N2 탭 전환: 묶음은 시작한 되돌리기 더미에 묶여, 더미가 바뀌면(탭 전환·새 도면) 다른 탭 이력에 아무것도 넣지 않는다', () => {
  const e = new DrawingEngine();
  e.beginTransaction();
  e.execute({ type: 'add', entity: line(1) });                       // TAB-B 에서 카드가 작업 중
  const tabB = { doc: e.doc, undoStack: e.undoStack, redoStack: e.redoStack };
  const tabA = { doc: { ...e.doc, entities: [line(-777)] }, undoStack: [], redoStack: [] };
  e.abortTransaction(); e.doc = tabA.doc; e.undoStack = tabA.undoStack; e.redoStack = tabA.redoStack;   // applyDrawingTab 과 같은 순서
  assert.equal(e.inTransaction(), false);
  e.execute({ type: 'undo' });                                       // 되돌릴 것이 없어야 한다
  assert.deepEqual(e.doc.entities.map(x => x.points[0].y), [-777]);
  e.execute({ type: 'redo' });
  assert.deepEqual(e.doc.entities.map(x => x.points[0].y), [-777]);
  // abort 없이 더미만 바뀐 경우(늦은 endTransaction)에도 다른 더미에 넣지 않는다.
  const f = new DrawingEngine(); f.beginTransaction(); f.execute({ type: 'add', entity: line(2) });
  const other = []; f.undoStack = other; f.doc = tabA.doc;
  assert.deepEqual(f.endTransaction(), { merged: 0, changed: false }); assert.equal(other.length, 0);
  // 늦게 온 execute 도 새 더미에 정상적으로 쌓인다(묶음이 버려졌으므로).
  f.execute({ type: 'add', entity: line(3) }); assert.equal(other.length, 1);
  assert.match(app, /reset\(\);engine\.abortTransaction\(\);/);
});

test('c17 탭 전환 시 카드가 이미 바꾼 부분은 한 단계로 확정되어 이전 작업(원)과 합쳐지지 않는다', () => {
  const e = new DrawingEngine();
  e.execute({ type: 'add', entity: { type: 'circle', layer: 'default', center: { x: 0, y: 0 }, radius: 50 } });   // 원 그리기(단계 1)
  e.beginTransaction();                                                                                              // TII 시작
  e.execute({ type: 'add', entity: { type: 'text', layer: 'default', position: { x: 0, y: 500 }, text: '1', height: 100 } });
  e.execute({ type: 'add', entity: { type: 'text', layer: 'default', position: { x: 300, y: 500 }, text: '2', height: 100 } });
  const tabB = { doc: e.doc, undoStack: e.undoStack, redoStack: e.redoStack };
  assert.deepEqual(e.abortTransaction(), { had: true, committed: true });                                          // 탭 전환 직전(applyDrawingTab)
  assert.equal(tabB.undoStack.length, 2, '원(1) + TII 문자 2개(1) = 두 단계');
  const tabA = { doc: { ...e.doc, entities: [] }, undoStack: [], redoStack: [] };
  e.doc = tabA.doc; e.undoStack = tabA.undoStack; e.redoStack = tabA.redoStack;
  e.doc = tabB.doc; e.undoStack = tabB.undoStack; e.redoStack = tabB.redoStack;                                       // 다시 TAB-B
  e.execute({ type: 'undo' });
  assert.deepEqual(e.doc.entities.map(x => x.type), ['circle'], 'Ctrl+Z 한 번은 문자 2개만 지우고 원은 남는다');
  e.execute({ type: 'undo' }); assert.equal(e.doc.entities.length, 0);
  e.execute({ type: 'redo' }); e.execute({ type: 'redo' }); assert.equal(e.doc.entities.length, 3);
  // 더미가 이미 바뀐(다른 탭) 묶음은 확정하지 않는다.
  const f = new DrawingEngine(); f.beginTransaction(); f.execute({ type: 'add', entity: line(1) }); const other = []; f.undoStack = other;
  assert.deepEqual(f.abortTransaction(), { had: true, committed: false }); assert.equal(other.length, 0);
  assert.deepEqual(f.abortTransaction(), { had: false, committed: false });
});

test('N1 카드 창 취소: 묶음을 강제로 닫아 이후 작업이 한 단계로 합쳐지지 않는다', () => {
  const e = new DrawingEngine();
  e.beginTransaction();                                              // runCardCommand 가 열었고 카드는 폼 답을 영영 기다림
  assert.deepEqual(e.closeTransaction(), { merged: 0, changed: false });
  assert.equal(e.inTransaction(), false);
  for (let i = 0; i < 4; i++) e.execute({ type: 'add', entity: line(i) });
  assert.equal(e.undoStack.length, 4, '취소 뒤 그린 선 4개는 각각 되돌리기 단계');
  e.execute({ type: 'undo' }); assert.equal(e.doc.entities.length, 3);
  // 변경이 있는 묶음을 닫으면 한 단계로 확정된다(중첩 깊이 무시).
  const g = new DrawingEngine(); g.beginTransaction(); g.beginTransaction(); g.execute({ type: 'add', entity: line(9) }); g.execute({ type: 'add', entity: line(10) });
  assert.deepEqual(g.closeTransaction(), { merged: 2, changed: true }); assert.equal(g.undoStack.length, 1);
  assert.match(app, /const cancelled=form\.appliedSession!==form\.session&&form\.closingForPick!==form\.session;/);
  assert.match(app, /if\(engine\.inTransaction\(\)\)engine\.closeTransaction\(\);/);
  assert.match(app, /form\.closingForPick=form\.session;dialog\.close\(\);/);
  assert.match(app, /const session=form\.session;form\.appliedSession=session;/);
  assert.match(app, /form:\(title,fields,onApply,onCancel\)=>form\(title,fields,cardFormApply\(onApply\),onCancel\)/);
});

// ── 4. F1 검색 (검토자 #4) ──
test('F1 검색은 명령창과 같은 해석을 1위로 두고, 괄호 라벨·한글 별칭·자판 보정을 찾는다', () => {
  const resolve = q => resolveCommand(q, settings) || preprocessImeCommand(q, 'idle', settings).command || null;
  const terms = c => [c.name, c.label, LEGACY_LABELS[c.name], ...koreanNamesFor(c.name), settings.aliases[c.name]].filter(Boolean).join(' ');
  const top = q => rankCommandSearch(COMMANDS, q, { aliases: settings.aliases, resolve, terms })[0]?.command.name;
  for (const [q, name] of [['CO', 'COPY'], ['레이어', 'LAYER'], ['해치', 'HATCH'], ['저장', 'SAVE'], ['계산', 'NUMCALC'], ['벽', 'WALL'], ['옵셋', 'OFFSET'], ['블럭', 'BLOCK'], ['ㅣ', 'LINE'], ['오프셋', 'OFFSET'], ['LA', 'LAYER'], ['복사', 'COPY'], ['L', 'LINE'], ['선', 'LINE'], ['켜 합치기', 'LAM']])
    assert.equal(top(q), name, q);
  assert.deepEqual(tokenizeLabel('간격띄우기 (오프셋)'), ['간격띄우기', '오프셋']);
  const co = rankCommandSearch(COMMANDS, 'CO', { aliases: settings.aliases, resolve, terms });
  assert.equal(searchEnterDecision(co).action, 'run');
  assert.equal(searchEnterDecision(co).command.name, 'COPY');
  assert.equal(top('치수'), 'DIMLINEAR', '한글 명령(치수)은 명령창과 같이 풀린다');
  // DIM 은 AutoCAD 처럼 스마트 치수 명령으로 풀리므로, 여럿이 앞부분 일치하는 예로 DIMC 를 쓴다.
  const dim = rankCommandSearch(COMMANDS, 'DIMC', { aliases: settings.aliases, resolve, terms });
  assert.ok(dim.length > 2 && dim[0].score === 2 && dim[1].score === 2);
  assert.equal(searchEnterDecision(dim).action, 'hint', '앞부분 일치가 여럿이면 강조만');
  assert.equal(searchEnterDecision(dim, 2).command, dim[2].command, '↑↓ 로 고른 항목은 실행');
  assert.equal(searchEnterDecision([]).action, 'none');
  // N4: '취소'(SELECT) 는 1위로 두지 않고, 한 글자 호환 별칭(R→REGEN)은 정확한 이름·별칭이 아니면 바로 실행하지 않는다.
  assert.notEqual(top('취소'), 'SELECT');
  const r = rankCommandSearch(COMMANDS, 'R', { aliases: settings.aliases, resolve, terms });
  assert.equal(searchEnterDecision(r).action, 'hint');
  assert.equal(searchEnterDecision(rankCommandSearch(COMMANDS, 'L', { aliases: settings.aliases, resolve, terms })).command.name, 'LINE', '정확한 별칭 L 은 실행');
  assert.equal(searchEnterDecision(rankCommandSearch(COMMANDS, 'REGEN', { aliases: settings.aliases, resolve, terms })).command.name, 'REGEN');
  assert.match(app, /rankCommandSearch\(searchCommands,query,\{aliases:settings\.aliases,resolve:resolveSearchQuery,terms:commandSearchTerms\}\)/);
});

// ── 5. 판 번호 (검토자 #5) ──
test('판 번호: package.json 을 서버·설치본 모두에서 제공하고 좁은 화면은 짧게 보여 준다', () => {
  assert.match(app, /fetch\('package.json',\{cache:'no-store'\}\)/);
  assert.match(app, /label\.dataset\.short=`v\$\{appVersion\}`/);
  assert.match(fs.readFileSync(new URL('./build_desktop.py', import.meta.url), 'utf8'), /root\/'package\.json'/);
  assert.match(fs.readFileSync(new URL('./server.py', import.meta.url), 'utf8'), /'\/package\.json'/);
  assert.match(css, /@media \(max-width:1180px\)\{#app-version\{font-size:0;\}#app-version::after\{content:attr\(data-short\)/);
  assert.match(css, /@media \(max-width:1100px\)\{#app-version\{display:none;\}\}/);
  assert.match(app, /helpTitle\.textContent\+=` · 바른 CAD \$\{appVersion\}`/);
});

// ── 6. PDF 색 (검토자 #6) ──
test('PDF 색: 자동 보정 기본은 5.0.3 과 같고(140/190), 도면 색상 모드는 색을 바꾸지 않으며, 밝은 색 진하게는 옵션이다', () => {
  assert.equal(automaticPlotColor('#79d4ff'), '#5798b6', '기존 기대값 유지');
  assert.equal(automaticPlotColor('#ffff00'), '#979700');
  assert.ok(luminance(automaticPlotColor('#ffff00', { darkenLightColors: true })) <= 125);
  const e = new DrawingEngine();
  e.execute({ type: 'layer.add', name: '노랑', color: '#ffff00' });
  const layer = e.doc.layers.find(l => l.name === '노랑');
  e.execute({ type: 'add', entity: { type: 'line', layer: layer.id, points: [{ x: 0, y: 0 }, { x: 1000, y: 0 }] } });
  const stroke = options => plotSVG(e.doc, { paper: 'A4', fit: true, margin: 10, ...options }).match(/stroke="(#[0-9a-f]{6})"/)[1];
  assert.equal(stroke({ colorMode: 'color' }), '#ffff00', '도면 색상은 원본 그대로');
  assert.equal(stroke({ colorMode: 'color', darkenLightColors: true }), legiblePlotColor('#ffff00'));
  assert.ok(luminance(stroke({ colorMode: 'auto', darkenLightColors: true })) <= 125);
  assert.equal(plotPDFJob(e.doc, { paper: 'A4', fit: true, colorMode: 'color' }).entities[0].color, '#ffff00');
  assert.match(app, /darkenLightColors:values\.darkenLight==='on'/);
  assert.match(app, /autoNote\.hidden=raw\.colorMode!=='auto'\|\|raw\.plotStyles==='off';/);
});

// ── 7. 여백 (검토자 #7) ──
test('용지 여백: 맞춤 실패 안내에 여백을 밝히고, 음수 여백은 거부한다', () => {
  const e = new DrawingEngine();
  e.execute({ type: 'add', entity: rect(41000, 28000) });
  assert.doesNotThrow(() => plotSVG(e.doc, { paper: 'A3', denominator: 100, margin: 0 }));
  assert.throws(() => plotSVG(e.doc, { paper: 'A3', denominator: 100, margin: 10 }), /여백 10 mm 제외[\s\S]*여백을 줄이세요/);
  assert.throws(() => plotPDFJob(e.doc, { paper: 'A3', denominator: 100, margin: 10 }), /여백 10 mm 제외/);
  assert.doesNotMatch(paperFitError(0), /여백/);
  assert.match(app, /if\(!Number\.isFinite\(margin\)\|\|margin<0\)throw Error\('용지 여백은 0 이상의 숫자\(mm\)로 입력하세요\.'\);/);
  assert.throws(() => plotPDFJob(e.doc, { paper: 'A3', fit: true, margin: -5 }), /여백/);
});

// ── 8. 투명 명령 범위 (검토자 #8) ──
test("'ZOOM 접두어·-LAYER 접두어를 떼고, DIST/ID 는 좌표 단계에서 막히며, 한 글자 입력은 명령 옵션이 우선이다", () => {
  assert.equal(stripCommandPrefix("'ZOOM"), 'ZOOM');
  assert.equal(stripCommandPrefix('-LAYER'), 'LAYER');
  assert.equal(stripCommandPrefix('-100,200'), '-100,200', '음수 좌표는 그대로');
  assert.deepEqual(classifyInput("'Z", 'point', settings), { kind: 'command', value: 'ZOOM' });
  assert.equal(classifyInput('DIST', 'point', settings).blockedCommand, 'DIST', 'N3: 측정 명령은 진행 중 명령을 끝내므로 투명이 아니다');
  assert.equal(classifyInput('ID', 'point', settings).blockedCommand, 'ID');
  assert.deepEqual(classifyInput('-LAYER', 'idle', settings), { kind: 'command', value: 'LAYER' });
  assert.match(app, /classified\.blockedCommand && !looksLikeCoordinateValue\(classified\.value\) && classified\.value\.trim\(\)\.length > 1/);
});

// ── 9. 이름 바꾼 뒤 옛 이름·아이콘·메뉴 (검토자 #9) ──
test('옛 라벨을 쳐도 풀리고 검색어에 남으며, 메뉴 절 이름과 아이콘 규칙도 새 용어를 안다', () => {
  for (const [name, old] of Object.entries(LEGACY_LABELS)) assert.equal(resolveCommand(old, settings), name, old);
  assert.equal(resolveCommand('켜 합치기', settings), 'LAM');
  assert.equal(resolveCommand('오프셋', settings), 'OFFSET');
  assert.ok(koreanNamesFor('OFFSET').includes('옵셋'));
  const sections = Object.values(MENU_CATALOG).flatMap(menu => menu.sections.map(s => s.label));
  assert.ok(sections.includes('레이어 도구') && sections.includes('블록·외부참조 도구'));
  assert.doesNotMatch(sections.join('|'), /켜 도구|블럭/);
  const rules = fs.readFileSync(new URL('./별도개발/건축CAD보조명령/src/reference-command-icons-v2.js', import.meta.url), 'utf8');
  for (const word of ['분해', '동결', '해동', '가져오기', '일람표', '소수점']) assert.ok(rules.includes(word), word);
});

// ── 10. 카드 숫자 입력 0 (검토자 #10) ──
test('askCardNumber 는 카드가 명시한 min/allowZero 만 따르고 기본값 0 이라는 이유로 0 을 받지 않는다', () => {
  assert.match(app, /const lower=Number\.isFinite\(min\)\?min:allowNegative\?-Infinity:allowZero\?0:null;/);
  assert.doesNotMatch(app, /Number\(value\)===0\)\?0/);
  for (const [file, pattern] of [['shape-tools.js', /PW · 폴리선 두께 주기'[^}]*allowZero:true/], ['trim-tools.js', /FE · 길이 남기고 모따기'[^}]*allowZero: true/], ['symbol-tools.js', /CMW · 구름형 수정기호 입체화'[^}]*allowZero:true/]])
    assert.match(fs.readFileSync(new URL('./' + file, import.meta.url), 'utf8'), pattern, file);
});

// ── 11. 추천 (검토자 #11) ──
test('비슷한 명령 추천: 자르→TRIM, lne→LINE, 레이러→LAYER, 사용자 별칭이 한글 목록보다 먼저', () => {
  assert.equal(suggestCommands('자르', settings)[0].name, 'TRIM');
  assert.equal(suggestCommands('lne', settings)[0].name, 'LINE');
  assert.equal(suggestCommands('레이러', settings)[0].name, 'LAYER');
  assert.equal(suggestCommands('COPPY', settings)[0].name, 'COPY');
  assert.deepEqual(suggestCommands('', settings), []);
  const custom = { aliases: { ...defaultAliases(), LINE: 'LAYER2' } };
  assert.equal(resolveCommand('LAYER2', custom), 'LINE');
  // 별칭은 영문만 허용되므로(validateSettings) 한글 낱말과 겹칠 수 없지만, 해석 순서는 별칭이 먼저다.
  assert.match(fs.readFileSync(new URL('./commands.js', import.meta.url), 'utf8'), /settings\.aliases\[c\.name\] === key && key\)\?\.name \|\|\n\s*KOREAN_COMMANDS\[compact\]/);
});

// ── 13. 계산기 단축 (검토자 #13) ──
test("연산자 계산기: 대기 상태에서만, '-' 는 키를 누르는 즉시 열지 않아 -LAYER 입력이 가능하고 '-' Enter 는 연다", () => {
  assert.equal(calculatorShortcut({ text: '+', mode: 'SELECT', phase: 'idle', trigger: 'key' }), '+');
  assert.equal(calculatorShortcut({ text: '-', mode: 'SELECT', phase: 'idle', trigger: 'key' }), null);
  assert.equal(calculatorShortcut({ text: '-', mode: 'SELECT', phase: 'idle', trigger: 'key', selectionCount: 2 }), '-');
  assert.equal(calculatorShortcut({ text: '-', mode: 'SELECT', phase: 'idle', trigger: 'submit' }), '-');
  assert.equal(calculatorShortcut({ text: '-', mode: 'LINE', phase: 'point', trigger: 'key' }), null);
  assert.equal(calculatorShortcut({ text: '+', mode: 'SELECT', phase: 'idle', trigger: 'key', inputValue: '12' }), null);
  assert.equal(calculatorShortcut({ text: '×', mode: 'SELECT', phase: 'idle', busy: true }), null);
  assert.equal(calculatorShortcut({ text: 'a', mode: 'SELECT', phase: 'idle' }), null);
});

// ── 이전 검토 항목(폼 체크박스·리습 질문·U-M1·U-M2·U-M7·L3·L8·L12 값 보존) ──
test('폼 체크박스 규칙(form-controls.js): checked 는 field.value 로, value 는 항상 on', () => {
  assert.deepEqual(checkboxState({ type: 'checkbox', value: true }), { checked: true, value: 'on' });
  assert.deepEqual(checkboxState({ type: 'checkbox', value: 'yes' }), { checked: true, value: 'on' });
  assert.deepEqual(checkboxState({ type: 'checkbox', value: false }), { checked: false, value: 'on' });
  assert.deepEqual(checkboxState({ type: 'checkbox', value: 'false' }), { checked: false, value: 'on' });
  assert.deepEqual(checkboxState({ type: 'checkbox' }), { checked: false, value: 'on' });
  assert.equal(controlValue({ type: 'number', value: 5 }), 5);
  assert.match(app, /const state = checkboxState\(field\);\s*control\.checked = state\.checked;\s*control\.value = state\.value;/);
  assert.match(app, /useCenterline:v\.centered==='on'/);
});

test('리습 질문 대기열: 늦게 온 close 이벤트가 다음 질문을 취소하지 않고, 실제 닫힘은 취소한다', async () => {
  const answers = [];
  // 첫 답 → 리습이 곧바로 다음 질문을 연다 → 이전 창의 close 이벤트가 늦게 도착(창은 다시 열린 상태)
  const fresh = createQuestionQueue();
  const p1 = new Promise(resolve => { const settle = fresh.ask(resolve); settle('0,0'); });
  answers.push(await p1);
  const p2 = new Promise(resolve => fresh.ask(resolve));
  assert.equal(fresh.onDialogClose({ dialogOpen: true }), false, '창이 다시 열려 있으면 무시');
  assert.equal(fresh.hasPending(), true);
  assert.equal(fresh.onDialogClose({ dialogOpen: false }), true, '실제로 닫히면 취소');
  assert.equal(await p2, null);
  assert.deepEqual(answers, ['0,0']);
  // 도면에서 찍기: takeover 는 현재 질문만 뺀다
  const q3 = createQuestionQueue(); const s3 = q3.ask(() => {}); const stale = () => {};
  assert.equal(q3.takeover(stale), false); assert.equal(q3.takeover(s3), true); assert.equal(q3.hasPending(), false);
  assert.match(app, /lispQuestions\.onDialogClose\(\{dialogOpen:\$\('form-dialog'\)\.open\}\)/);
});

test('좌표 단계의 오타는 명령을 실행하지 않고, 한글 명령·추천·상태 표시는 한글이다', () => {
  assert.equal(classifyInput('abc', 'point', settings).blockedCommand, 'ABC');
  assert.deepEqual(classifyInput('abc', 'idle', settings), { kind: 'command', value: 'ABC' });
  for (const [word, name] of [['레이어', 'LAYER'], ['켜', 'LAYER'], ['숫자계산', 'NUMCALC'], ['복사', 'COPY'], ['간격띄우기', 'OFFSET'], ['도움말', 'HELP']]) assert.equal(resolveCommand(word, settings), name, word);
  assert.equal(COMMANDS.find(c => c.name === 'NUMCALC').label, '숫자 계산');
  const labels = COMMANDS.map(c => c.label).join('\n');
  for (const bad of ['퀘적', '수정 마트', '미세한게', '소숫점', '스케쥴', '다이아그램', '훔쳐오기', 'ACAD', 'Qdim', '하위 버전', '블럭', '옵셋', '켜 ON/OFF', '켜로', '켜색', ' 켜 ']) assert.doesNotMatch(labels, new RegExp(bad), bad);
  assert.match(app, /\$\("active-command"\)\.textContent = activeCommandLabel\(\);/);
  assert.doesNotMatch(app, /<strong>LIVE<\/strong>/);
  assert.doesNotMatch(html, /canvas-label">TOP /);
  assert.match(app, /if \(phase !== "text"\) \$\("coordinate"\)\.value = "";\s*toast\(error\.message, true\);/);
});

test('용지 맞춤 오차 허용과 치수 미리보기·오류문 값 보존', () => {
  assert.equal(fitsPaper(420.00000000000006, 200, 1, 420, 297, 0), true);
  assert.equal(fitsPaper(421, 200, 1, 420, 297, 0), false);
  let rejected = 0, total = 0;
  for (let w = 137; w < 90000; w += 2731) for (let h = 91; h < 60000; h += 1973) { total++; const e = new DrawingEngine(); e.execute({ type: 'add', entity: rect(w, h) }); try { plotSVG(e.doc, { paper: 'A3', fit: true, margin: 10 }); plotPDFJob(e.doc, { paper: 'A2', fit: true, margin: 10 }); } catch { rejected++; } }
  assert.ok(total > 900); assert.equal(rejected, 0);
  const same = { x: 100, y: 100 };
  for (const mode of ['aligned', 'horizontal', 'vertical', 'radius', 'diameter']) assert.doesNotThrow(() => dimensionParts({ type: 'dimension', mode, points: [same, { ...same }, { ...same }], textHeight: 150 }), mode);
  assert.doesNotThrow(() => primitives({ type: 'dimension', mode: 'aligned', layer: 'default', points: [same, same, { x: 100, y: 300 }], textHeight: 150 }));
  assert.equal(userErrorMessage('레벨 문자를 읽을 수 없습니다: "FL+3,000"'), '레벨 문자를 읽을 수 없습니다: "FL+3,000"');
  assert.equal(userErrorMessage('블록 이름을 찾을 수 없습니다: DOOR-01'), '블록 이름을 찾을 수 없습니다: DOOR-01');
  assert.doesNotMatch(userErrorMessage('도면 열기 실패: decoder process crashed'), /decoder/);
  assert.equal(looksTechnical('DOOR-01'), false);
});

test('pickPoint 객체 인수·폼 닫기·도움말 분류·아이콘·빠른 도구 라벨(화면 접착 코드)', () => {
  assert.match(app, /function pickPointOnce\(options=/);
  assert.match(app, /closeFormForPicking\(\);reset\(\);mode='PICKPATH'/);
  assert.match(app, /const HELP_GROUP_ORDER=\['work','file','arch'/);
  assert.match(app, /heading\.className="help-group-title"/);
  const icons = app.match(/const BASIC_COMMAND_ICONS=\{([\s\S]*?)\n\};/)[1];
  const pick = name => icons.match(new RegExp(`\\n ${name}:'([^']+)'`))[1];
  assert.notEqual(pick('CIRCLE'), pick('LINE')); assert.notEqual(pick('OFFSET'), pick('LINE'));
  assert.match(app, /const quickLabels=\{HATCH:'해치',OFFSET:'간격띄우기',TRIM:'자르기'/);
  assert.match(css, /quick-tools button span\{[^}]*white-space:normal/);
  assert.match(css, /\.drawing-column>\.input-dock\{margin-right:42px;\}/);
});
