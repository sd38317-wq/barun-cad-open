// ACAD200 영역 7 — 특성·단위·명령 제안·축척 입력·플롯 스타일·굵기·선종류·색 견본집·PDF·스탬프·PUBLISH·설정 이전(712, 714~718, 720~725) 시험.
import test from 'node:test';
import assert from 'node:assert/strict';
import {contextTools, rolloverLines, createRestDetector, CONTEXT_TOOLS} from './rollover-tip.js';
import {buildDockModel, DOCK_SCAN_CAP} from './properties-dock.js';
import {insertScale, confirmInsertUnits, formatLength, formatAngle, normalizeUnits, unitlessImportScale, unitsSample} from './units.js';
import {suggestCommands, suggestCommandsRanked, learnCorrection, recordCommandUsage, defaultAliases, validateSettings, defaultHotkeys, resolveCommand, COMMANDS} from './commands.js';
import {S7_COMMANDS} from './s7-command-names.js';
import {parseScaleInput, tryParseScale} from './scale-input.js';
import {resolvePlotStyle, plotLineweightOf, plotPDFJob, plotSVG, pdfExportOptions, pdfLayerGroups, plotStampText, STAMP_FIELDS} from './plot.js';
import {screenLineweightPx, setLineweightDisplay, linetypeDashPattern, linDashPattern, screenDashPattern, dashWorldPerPattern, LIN_SCREEN_PX, setLinetypePatternSource, linetypeGeneration, LIN_DEFS} from './view.js';
import {parseColorBookCsv, parseAcbXml, mergeColorBook, searchColorBooks, loadColorBooks, saveColorBooks} from './color-books.js';
import {makePublishList, collectSheets, groupForCollate, runPublish, serializePublishList, parsePublishList, outOfDate} from './publish-list.js';
import {SETTING_GROUPS, settingGroupOf, exportSettings, planImport, restoreEntries} from './output-tools.js';
import {normalizePrefs, loadPrefs, savePrefs, PREF_DEFAULTS} from './cad-prefs.js';

const memoryStorage = () => { const m = new Map(); return {getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), key: (i) => [...m.keys()][i], get length() { return m.size; }}; };

/* 712 */
test('712 선택 도구 줄: 한 종류·상한 이하일 때만, 없는 명령은 빼고', () => {
  assert.deepEqual(contextTools([{type: 'text', count: 3}], 3, {limit: 2500}), CONTEXT_TOOLS.text);
  assert.deepEqual(contextTools([{type: 'text', count: 3}, {type: 'line', count: 1}], 4), []);
  assert.deepEqual(contextTools([{type: 'hatch', count: 3000}], 3000, {limit: 2500}), [], 'RIBBONCONTEXTSELLIM 넘으면 계산 안 함');
  assert.deepEqual(contextTools([{type: 'hatch', count: 3000}], 3000, {limit: 0}), CONTEXT_TOOLS.hatch, '0 = 제한 없음');
  assert.deepEqual(contextTools([{type: 'text', count: 1}], 1, {known: new Set(['TALIGN'])}), ['TALIGN']);
});
test('712 롤오버 4줄(선택지 값은 이름으로) · 멈춤 감지는 움직이는 동안 타이머만', () => {
  const lines = rolloverLines([{heading: '일반'}, {label: '레이어', value: 'a', options: [['a', '벽']]}, {label: '색', value: 'ByLayer'}, {label: '빈칸', value: ''}, {label: '굵기', value: '0.25'}, {label: '길이', value: 10}, {label: '다섯째', value: 1}]);
  assert.deepEqual(lines, ['레이어: 벽', '색: ByLayer', '굵기: 0.25', '길이: 10']);
  const fired = [], timers = {t: null, setTimeout(fn) { this.t = fn; return 1; }, clearTimeout() { this.t = null; }};
  let moves = 0;
  const d = createRestDetector({delay: 500, onRest: (x, y) => fired.push([x, y]), onMove: () => moves++, timers});
  d.move(1, 1); d.move(2, 2); d.move(3, 3);
  assert.equal(fired.length, 0); assert.equal(moves, 3);
  timers.t(); assert.deepEqual(fired, [[3, 3]]);
  d.move(4, 4); d.cancel(); assert.equal(timers.t, null);
});
test('712 PROPOBJLIMIT: 상한을 넘으면 공통 항목만(설정값으로)', () => {
  const es = Array.from({length: 50}, (_, i) => ({id: 'e' + i, type: 'line', layer: 'a', points: [{x: 0, y: 0}, {x: i + 1, y: 0}]}));
  const ctx = {layers: [['a', 'A']], layerName: () => 'A', linetypes: [], colorText: () => 'ByLayer'};
  assert.equal(buildDockModel(es, ctx, {cap: 10}).mode, 'fast');
  assert.notEqual(buildDockModel(es, ctx, {cap: DOCK_SCAN_CAP}).mode, 'fast');
  assert.equal(normalizePrefs({propObjLimit: 5}).propObjLimit, 100);
});

/* 714 */
test('714 삽입 단위 배율·묻기(스크립트 중엔 묻지 않음)·단위 없음', async () => {
  assert.equal(insertScale(6), 1000); assert.equal(insertScale(1), 25.4); assert.equal(insertScale(0), 1); assert.equal(insertScale(4), 1);
  assert.deepEqual(await confirmInsertUnits(6, {scriptActive: true, ask: () => assert.fail('묻지 않아야 함')}), {scale: 1000, asked: false});
  assert.deepEqual(await confirmInsertUnits(6, {ask: async (q) => { assert.match(q, /미터.*1,000배/); return false; }}), {scale: 1, asked: true});
  assert.deepEqual(await confirmInsertUnits(4, {ask: () => assert.fail()}), {scale: 1, asked: false});
  assert.equal(unitlessImportScale({unitless: false}, null), 1);
  assert.equal(unitlessImportScale({unitless: true}, 'm'), 1000);
  assert.throws(() => unitlessImportScale({unitless: true}, 'refuse'), /단위가 없습니다/);
});
test('714 표시 형식: 길이(십진·지수·피트인치)·각도(도·도분초·라디안, 기준·방향)', () => {
  assert.equal(formatLength(1234.5678, {lunits: 2, luprec: 2}), '1234.57');
  assert.equal(formatLength(1234.5, {lunits: 1, luprec: 2}), '1.23E+3');
  assert.equal(formatLength(304.8 * 3 + 25.4 * 6, {lunits: 3, luprec: 1}), `3'-6.0"`);
  assert.equal(formatLength(25.4 * 1.5, {lunits: 4, luprec: 1}), `0'-1 1/2"`);
  assert.equal(formatAngle(90, {aunits: 0, auprec: 1}), '90.0°');
  assert.equal(formatAngle(90, {aunits: 3, auprec: 4}), '1.5708r');
  assert.equal(formatAngle(45.5, {aunits: 1, auprec: 2}), `45°30'`);
  assert.equal(formatAngle(90, {angbase: 90}), '0°');
  assert.equal(formatAngle(90, {angdir: 1}), '270°');
  assert.throws(() => normalizeUnits({lunits: 9}), /길이 형식/);
  assert.match(unitsSample(normalizeUnits({})), /1235 · 각도 46°/);
});

/* 715 */
test('715 자동 교정 학습: 고른 명령이 다음엔 1위 · 정확한 이름은 기억 안 함 · 사용 횟수로 같은 점수 정렬', () => {
  const s = {aliases: defaultAliases()};
  const plain = suggestCommands('LAY', s, 8).map((c) => c.name);
  const learned = learnCorrection({}, 'lay', 'LAYDEL');
  assert.deepEqual(learned, {LAY: 'LAYDEL'});
  assert.equal(suggestCommandsRanked('lay', s, 8, {autoCorrect: learned})[0].name, 'LAYDEL');
  assert.deepEqual(learnCorrection({}, 'LINE', 'LINE'), {});
  const settings = validateSettings({version: 1, aliases: defaultAliases(), hotkeys: defaultHotkeys()});
  assert.deepEqual(learnCorrection({}, 'L', 'LINE', settings), {}, '별칭으로 이미 그 명령이면 배울 것이 없다');
  const second = plain[1], usage = recordCommandUsage(recordCommandUsage({}, second), second);
  const ranked = suggestCommandsRanked('LAY', s, 8, {usage}).map((c) => c.name);
  assert.ok(ranked.indexOf(second) <= plain.indexOf(second));
  assert.equal(usage[second], 2);
  assert.deepEqual(suggestCommandsRanked('', s), []);
});
test('715 새 명령 이름 등록·별칭 충돌 없음', () => {
  const settings = validateSettings({version: 1, aliases: defaultAliases(), hotkeys: defaultHotkeys()});
  for (const [name] of S7_COMMANDS) { assert.ok(COMMANDS.some((c) => c.name === name), name); assert.equal(resolveCommand(name, settings), name, name); }
  assert.equal(resolveCommand('LAYMCH', settings), 'LC');
  assert.equal(resolveCommand('UN', settings), 'UNITS');
});

/* 716 */
test('716 축척 입력: 100 · 1:100 · 1=100 · 2:1 · 1/50 · 단위', () => {
  assert.equal(parseScaleInput('100').denominator, 100);
  assert.equal(parseScaleInput('1:100').label, '1:100');
  assert.equal(parseScaleInput('1 = 200').denominator, 200);
  assert.equal(parseScaleInput('2:1').denominator, .5); assert.equal(parseScaleInput('2:1').label, '2:1');
  assert.equal(parseScaleInput('1/50').denominator, 50);
  assert.equal(parseScaleInput('1mm=1m').denominator, 1000);
  assert.equal(parseScaleInput('1：250').denominator, 250);
  assert.throws(() => parseScaleInput('0:1'), /0보다/);
  assert.throws(() => parseScaleInput('abc'), /축척은/);
  assert.throws(() => parseScaleInput(''), /넣으세요/);
  assert.equal(tryParseScale('x'), null);
});

/* 717 */
test('717 플롯 스타일: CTB 는 ACI(트루컬러 제외), STB 는 객체→레이어→Normal 이름', () => {
  const ctb = {styles: {1: {color: '#000000', lineweight: .5}}};
  assert.equal(resolvePlotStyle({aci: 1}, {}, ctb).lineweight, .5);
  assert.equal(resolvePlotStyle({color: '#ff0000', colorMode: 'truecolor', aci: 1}, {}, ctb), null);
  const stb = {kind: 'stb', styles: {Normal: {color: null, lineweight: 0}, WALL: {color: '#111111', lineweight: .7}}};
  assert.equal(resolvePlotStyle({plotStyleName: 'wall'}, {}, stb).lineweight, .7, '이름은 대소문자 무시');
  assert.equal(resolvePlotStyle({}, {plotStyleName: 'WALL'}, stb).color, '#111111');
  assert.equal(resolvePlotStyle({plotStyleName: 'ByLayer'}, {}, stb).lineweight, 0);
  assert.equal(resolvePlotStyle({plotStyleName: '없는것'}, {}, stb), null);
  assert.equal(plotLineweightOf({lineweight: -2}, {lineweight: .3}, null, .9), .9);
  assert.equal(plotLineweightOf({lineweight: -1}, {lineweight: .3}, null, .9), .3);
  assert.equal(plotLineweightOf({}, {lineweight: .3}, {lineweight: .7}), .7);
  const doc = {layers: [{id: 'a', name: 'A', color: '#ff0000', visible: true, plotStyleName: 'WALL'}], entities: [{id: 'l', type: 'line', layer: 'a', points: [{x: 0, y: 0}, {x: 100, y: 0}]}]};
  const job = plotPDFJob(doc, {colorMode: 'ctb', plotStyle: stb, denominator: 1, fit: false});
  assert.equal(job.entities[0].color, '#111111'); assert.equal(job.entities[0].lineweight, .7);
});

/* 718 */
test('718 LWDISPLAY: 끄면 1px, 켜면 0.75mm 까지 예전과 같고 그 위는 8px 까지 구별', () => {
  assert.equal(screenLineweightPx(.25, false), 1); assert.equal(screenLineweightPx(2, false), 1);
  for (const lw of [0, .13, .25, .35, .5, .7]) assert.equal(screenLineweightPx(lw, true), Math.max(1, Math.min(3, lw * 4)), String(lw));
  assert.ok(screenLineweightPx(1.0, true) > screenLineweightPx(.75, true));
  assert.ok(screenLineweightPx(2.0, true) > screenLineweightPx(1.4, true));
  assert.equal(screenLineweightPx(10, true), 8);
  setLineweightDisplay(false); assert.equal(screenLineweightPx(.7), 1); setLineweightDisplay(true); assert.equal(screenLineweightPx(.5), 2);
});

/* 720 */
test('720 선종류: .lin 비율 그대로(DASHED≠HIDDEN, ISO02 12:3), 예전 모양으로 되돌릴 수 있음, 도면 정의는 표준에 없는 이름만', () => {
  const g = linetypeGeneration();
  setLinetypePatternSource('lin', null);
  assert.ok(linetypeGeneration() > g, '바뀌면 GPU 무늬 캐시가 비워진다');
  const dashed = linetypeDashPattern('DASHED'), hidden = linetypeDashPattern('HIDDEN'), iso = linetypeDashPattern('ACAD_ISO02W100');
  assert.notDeepEqual(dashed, hidden);
  assert.ok(Math.abs(dashed[0] / dashed[1] - 2) < 1e-9);
  assert.ok(Math.abs(iso[0] / iso[1] - 4) < 1e-9);
  assert.equal(linetypeDashPattern('DOT')[0], .5, '점은 0.5px');
  assert.ok(Math.abs(linetypeDashPattern('CENTER', 2)[0] - 2 * linetypeDashPattern('CENTER')[0]) < 1e-9);
  assert.deepEqual(linetypeDashPattern('CONTINUOUS'), []);
  assert.deepEqual(linetypeDashPattern('MYWEIRD_DASH'), [7, 5], '모르는 이름은 예전 짐작');
  setLinetypePatternSource('lin', {MYWEIRD_DASH: {pattern: [10, -5]}, DASHED: {pattern: [1, -1]}});
  assert.deepEqual(linetypeDashPattern('MYWEIRD_DASH'), [6, 3]);
  assert.deepEqual(linetypeDashPattern('DASHED'), dashed, '표준 이름은 .lin 값');
  // 도면의 표준 이름 정의가 acad.lin 인치 값(표준의 1/25.4)이면 AutoCAD 처럼 도면 값 그대로(미터 도면에 인치 DASHED 0.5 — 주동딱지 가구).
  setLinetypePatternSource('lin', {DASHED: {pattern: [0.5, -0.25]}, HIDDEN: {pattern: [0.25, -0.125]}, DOT: {pattern: [0, -0.25]}});
  assert.deepEqual(linetypeDashPattern('DASHED', 90), linDashPattern('DASHED', 90, {DASHED: [0.5, -0.25]}));
  assert.ok(Math.abs(linetypeDashPattern('DASHED', 90)[0] - 0.5 * LIN_SCREEN_PX * 90) < 1e-9, '0.5 × 축척 90 = 45 mm 비율');
  assert.ok(Math.abs(linetypeDashPattern('HIDDEN', 10)[0] * 25.4 - 10 * hidden[0]) < 1e-6);
  assert.deepEqual(linetypeDashPattern('DOT')[1], 0.25 * LIN_SCREEN_PX < .25 ? .25 : 0.25 * LIN_SCREEN_PX);
  setLinetypePatternSource('legacy', null);
  assert.deepEqual(linetypeDashPattern('DASHED'), [7, 5]);
  assert.equal(linDashPattern('NOPE'), null);
  assert.equal(LIN_DEFS.ACAD_ISO04W100.length, 4);
});

/* 721 */
test('721 색 견본집: CSV·RGB 가 보이는 .acb 읽기, 가려진 .acb 는 안내, 같은 이름 다시 불러오면 바꿈', () => {
  const csv = parseColorBookCsv('# 우리 색\n이름,R,G,B\n벽 회색,128,128,128\n창틀,#1A2B3C\n벽 회색,1,1,1', '사무소');
  assert.deepEqual(csv.map((c) => [c.name, c.hex]), [['벽 회색', '#808080'], ['창틀', '#1a2b3c']]);
  const acb = parseAcbXml('<colorBook><bookName>RAL 예시</bookName><colorPage><colorEntry><colorName>RAL 1000</colorName><RGB8><red>190</red><green>189</green><blue>127</blue></RGB8></colorEntry></colorPage></colorBook>');
  assert.deepEqual(acb, [{book: 'RAL 예시', name: 'RAL 1000', hex: '#bebd7f'}]);
  assert.throws(() => parseAcbXml('<colorBook><colorEntry><colorName>x</colorName><RGB8Encrypt>zz</RGB8Encrypt></colorEntry></colorBook>'), /가려져/);
  const merged = mergeColorBook(mergeColorBook([], csv), [{book: '사무소', name: '새', hex: '#000000'}]);
  assert.deepEqual(merged.map((c) => c.name), ['새']);
  assert.equal(searchColorBooks(csv, '창')[0].hex, '#1a2b3c');
  const storage = memoryStorage(); saveColorBooks(storage, csv);
  assert.equal(loadColorBooks(storage).length, 2);
});

/* 722 · 723 */
test('722 PDF 선택·레이어 묶음, 723 플롯 스탬프 문자열과 작업 전달', () => {
  assert.deepEqual(pdfExportOptions({}), {includeLayers: false, bookmarks: true, hyperlinks: false, rasterDpi: 300, textAsText: true});
  assert.equal(pdfExportOptions({rasterDpi: 999}).rasterDpi, 300);
  const groups = pdfLayerGroups([{layer: 'a'}, {layer: 'b'}, {layer: 'a'}], [{id: 'a', name: 'A'}, {id: 'b', name: 'B'}]);
  assert.deepEqual(groups.map((g) => [g.name, g.entities.length]), [['A', 2], ['B', 1]]);
  assert.equal(plotStampText({on: false}, {}), null);
  const stamp = plotStampText({on: true, fields: ['drawing', 'sheet', 'scale', 'udf1'], udf1: '검토용', corner: 'top-right'}, {fileName: 'A.dwg', sheet: {number: 'A-101', title: '평면도'}, denominator: 100});
  assert.equal(stamp.text, 'A.dwg | A-101 평면도 | 1:100 | 검토용'); assert.equal(stamp.corner, 'top-right');
  assert.equal(plotStampText({on: true, fields: ['scale']}, {denominator: .5}).text, '2:1');
  assert.equal(STAMP_FIELDS.length, 9);
  const doc = {layers: [{id: 'a', name: 'A', color: '#000000', visible: true}], entities: [{id: 'l', type: 'line', layer: 'a', points: [{x: 0, y: 0}, {x: 100, y: 0}]}]};
  const job = plotPDFJob(doc, {denominator: 1, stamp, bookmark: 'A-101'});
  assert.equal(job.stamp.text, stamp.text); assert.equal(job.bookmark, 'A-101');
  assert.match(plotSVG(doc, {denominator: 1, stamp}), /class="plot-stamp"[^>]*text-anchor="end"/);
});

/* 724 */
test('724 PUBLISH: 열린 탭 시트 모으기·묶기 규칙·빠진 시트면 시작 전에 멈춤·.bpub 저장/읽기·바뀐 시트 표시', async () => {
  const sheetA = {id: 's1', number: 'A-101', title: '평면', paper: 'A3', denominator: 100, bounds: {minX: 0, minY: 0, maxX: 100, maxY: 100}};
  const tabs = [{id: 't1', name: '1층.dwg', doc: {entities: [{_renderBounds: {minX: 1, minY: 1, maxX: 2, maxY: 2}}], sheets: [sheetA]}}, {id: 't2', name: '2층.dwg', doc: {entities: [], sheets: [{...sheetA, id: 's2', number: 'A-102', pageSetup: 'Other'}]}}];
  const list = collectSheets(tabs);
  assert.deepEqual(list.map((x) => [x.file, x.number, x.pageSetup]), [['1층.dwg', 'A-101', 'default'], ['2층.dwg', 'A-102', 'Other']]);
  assert.equal(groupForCollate(list).length, 2, '페이지 설정이 다르면 따로');
  assert.equal(groupForCollate(makePublishList([{sheetId: 'a', pageSetup: 'X'}, {sheetId: 'b', pageSetup: 'x'}])).length, 1, '대소문자 무시로 같으면 한 번에');
  assert.equal(groupForCollate(list, false).length, 2);
  const calls = [];
  const out = await runPublish(list, {resolve: (item) => { const t = tabs.find((x) => x.id === item.tab); return {doc: t.doc, sheet: t.doc.sheets[0]}; }, plotPages: async (pages) => { calls.push(pages.length); return 'pdf' + pages.length; }, merge: (outs) => outs.join('+')});
  assert.equal(out, 'pdf1+pdf1'); assert.deepEqual(calls, [1, 1]);
  await assert.rejects(runPublish(list, {resolve: () => null, plotPages: () => assert.fail(), merge: () => assert.fail()}), /찾지 못한 시트/);
  assert.deepEqual(parsePublishList(serializePublishList(list)), list);
  assert.throws(() => parsePublishList('{"app":"x"}'), /출력 목록 파일이 아닙니다/);
  assert.equal(outOfDate(list[0], tabs[0].doc), false);
  assert.equal(outOfDate(list[0], {...tabs[0].doc, entities: []}), true, '시트 안 객체가 바뀌면 표시');
  assert.throws(() => makePublishList([{}]), /시트가 없습니다/);
});

/* 725 */
test('725 설정 묶음 내보내기·불러오기: 고른 묶음만, 덮일 값은 따로, 모르는 키는 건너뜀, 예전 파일도', () => {
  const entries = [['barun-cad-command-settings-v1', '{}'], ['barun-plot-settings', '{"paper":"A3"}'], ['barun-cad-prefs-v1', '{}'], ['barun-colorbooks-v1', '[]'], ['barun-rld-card', 'x'], ['other', 'no'], ['barun-settings-before-restore', 'old']];
  assert.equal(settingGroupOf('barun-plot-settings'), 'plot'); assert.equal(settingGroupOf('barun-rld-card'), 'cards'); assert.equal(settingGroupOf('barun-settings-before-restore'), null);
  const file = exportSettings(entries, ['plot', 'prefs'], '7.0.11');
  assert.deepEqual(Object.keys(file.data).sort(), ['barun-cad-prefs-v1', 'barun-plot-settings']);
  assert.equal(file.app, 'barun-cad'); assert.equal(file.version, '7.0.11');
  const plan = planImport({...file, data: {...file.data, 'barun-plot-settings': '{"paper":"A1"}', 'barun-settings-before-restore': 'x'}}, entries, {groups: ['plot']});
  assert.deepEqual(plan.apply, [['barun-plot-settings', '{"paper":"A1"}']]);
  assert.deepEqual(plan.backup, [['barun-plot-settings', '{"paper":"A3"}']]);
  assert.equal(plan.skipped, 2);
  assert.equal(planImport({version: 1, data: {'barun-x': '1'}}, []).apply.length, 1, '예전 BRBACKUP 파일');
  assert.throws(() => planImport({app: 'other', data: {}}, []), /바른 CAD 설정 파일이 아닙니다/);
  assert.equal(restoreEntries({data: {'barun-a': '1', b: '2'}}).length, 1);
  assert.ok(Object.keys(SETTING_GROUPS).includes('colorbooks'));
});
test('사용자 설정(cad-prefs): 잘못된 값은 기본값으로, 저장·읽기', () => {
  const p = normalizePrefs({layIsoMode: 'weird', inputSearchDelay: 99999, autoCorrect: {'LNIE': 'LINE', 'x y': 'LINE', BAD: 3}, plotStamp: {on: true, fields: ['drawing', 'nope'], corner: 'middle'}});
  assert.equal(p.layIsoMode, 'off'); assert.equal(p.inputSearchDelay, 10000);
  assert.deepEqual(p.autoCorrect, {LNIE: 'LINE'});
  assert.deepEqual(p.plotStamp.fields, ['drawing']); assert.equal(p.plotStamp.corner, 'bottom-left');
  const storage = memoryStorage();
  savePrefs(storage, {...PREF_DEFAULTS, layIsoMode: 'lock'});
  assert.equal(loadPrefs(storage).layIsoMode, 'lock');
  assert.equal(loadPrefs({getItem: () => '{bad'}).layIsoMode, 'off');
});

test('점선은 도면 길이(정의 × LTSCALE)와 화면 최소 길이 중 긴 쪽 — LTSCALE 100 도 실선처럼 안 보인다', () => {
  const base = linetypeDashPattern('DASHED', 1), big = linetypeDashPattern('DASHED', 100);
  // 멀리 축소(0.01 px/mm): LTSCALE 100 도 축척 1 화면 무늬보다 짧아지지 않고, 수백 px 로 커지지도 않는다.
  const far = screenDashPattern('DASHED', 100, 0.01);
  assert.ok(far.every((v, i) => Math.abs(v - Math.max(base[i], big[i] / LIN_SCREEN_PX * 0.01)) < 1e-9));
  assert.ok(far[0] < 20, '축소 화면의 무늬는 화면 몇 px 수준');
  // 확대하면 도면 길이 기준으로 함께 커진다(AutoCAD 처럼).
  const near = screenDashPattern('DASHED', 100, 1);
  assert.ok(Math.abs(near[0] - big[0] / LIN_SCREEN_PX) < 1e-9);
  assert.ok(Math.abs(dashWorldPerPattern(1, 100) - 1 / LIN_SCREEN_PX) < 1e-12);
  assert.ok(Math.abs(dashWorldPerPattern(0.01, 1) - 100) < 1e-9, '축척 1·축소: 화면 무늬 그대로(1/배율)');
});
