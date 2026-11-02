// 5.0.4 검토(2026-09-24) D 영역 수정 회귀 시험 — 실제 DrawingEngine 위에서 카드 명령을 실행해 확인한다.
// 개수 상한(CSL·SCB·RND·SD·WU·LXP·CM·TII) · DH/DU · DPL · WSL · SAB/LCS 잠긴 켜 · 안내만 하던 12개의 실제 동작 ·
// PPP/SVS 가 PB 박스 인식 · 비동기/동기 오류가 카드 토스트로 · 체크박스 값 해석.
import test from 'node:test';
import assert from 'node:assert/strict';
import {DrawingEngine} from './engine.js';
import * as G from './geometry.js';
import {isChecked, boundedInteger} from './card-input.js';
import {buildCutSymbolPolyline, restoreDimensionTextPosition, refreshDimensionStyle, flowArrowPlacements, installDimSymbolTools} from './dim-symbol-tools.js';
import {scaleBarBars, windowSymbolBlock, cloudArcs, backupFileName, plotBoxCandidates, installSymbolOutputTools4} from './symbol-output-tools-4.js';
import {buildRoundSurface, installDimHatchTools} from './dim-hatch-tools.js';
import {orthoProjectionDims, boundingBoxDims, vertexDistanceDims, splitDimensionEqual} from './dim-tools-4.js';
import {splitByLockedLayer, fontUsageRows, formatFontReport, mslCleanupPlan, installOutputTools} from './output-tools.js';
import {unregisteredPlotBoxes, plotBoxSheetPlan, plotBoxSheetSpec, installSheetPlotTools} from './sheet-plot-tools.js';
import {installTextCreateTools} from './text-create-tools.js';
import {explodeByPattern, textLinePieces, usedLinetypeKeys, linetypeExportText, installSymbolTools} from './symbol-tools.js';
import {hatchOriginChanges, hpmTileContents, installHatchTableTools} from './hatch-table-tools.js';
import {hatchToPatDefinition, tileToPatDefinition, barunLinetypeDefinition, textLinetypeDefinition} from './pattern-files.js';
import {getSnapAngle, setSnapAngle, orthoSnap, resetSnapAngleCache, slopePercentToAngle, setSnapAngleDrawing, snapAngleLabel, SNAP_ANGLE_KEY} from './snap-angle.js';
import {preprocessImeCommand, defaultAliases} from './commands.js';
import {drawEntity} from './view.js';

const P = (x, y) => ({x, y});
const settle = async () => { for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 2)); };

class MemoryStorage {constructor() {this.m = new Map();} getItem(k) {return this.m.has(k) ? this.m.get(k) : null;} setItem(k, v) {this.m.set(k, String(v));} removeItem(k) {this.m.delete(k);} key(i) {return [...this.m.keys()][i] ?? null;} get length() {return this.m.size;}}

/* 내려받기(a.click)를 기록하는 최소 DOM */
const downloads = [];
globalThis.document = {createElement: (tag) => ({tag, click() { downloads.push({name: this.download, href: this.href}); }, remove() {}, set download(v) {this._d = v;}, get download() {return this._d;}}), body: {append() {}}, getElementById: () => null};
globalThis.URL.createObjectURL = (blob) => { downloads.lastBlob = blob; return 'blob:test'; };
globalThis.URL.revokeObjectURL = () => {};

function makeEngine() {
  const engine = new DrawingEngine();
  const add = (name) => { engine.execute({type: 'layer.add', name, color: '#ffffff'}); return engine.doc.layers.find((l) => l.name === name).id; };
  const L = {LOCK: add('A-LOCK'), DIM: add('A-DIMS')};
  const ids = engine.execute({type: 'addMany', entities: [
    {type: 'line', layer: 'default', points: [P(0, 0), P(4000, 0)]},
    {type: 'line', layer: 'default', points: [P(0, 1000), P(4000, 1000)]},
    {type: 'line', layer: L.LOCK, points: [P(9000, 0), P(9500, 0)]},
    {type: 'dimension', layer: L.DIM, mode: 'aligned', points: [P(0, 0), P(4000, 0), P(0, -600)], textHeight: 150, textPosition: P(1000, -400)},
    {type: 'polyline', closed: true, layer: 'default', points: [P(0, 0), P(2000, 0), P(2000, 1500), P(0, 1500)]},
    {type: 'hatch', layer: 'default', points: G.rectangle(P(0, 0), P(1000, 1000)), loops: [], pattern: 'ANSI31', spacing: 100, angle: 45},
    {type: 'text', layer: 'default', position: P(100, 100), height: 150, text: 'A-101', align: 'left', rotation: 0, textStyle: 'HGT', sourceFont: 'whgtxt.shx', sourceBigFont: 'H2GTRM.shx'},
  ]});
  engine.execute({type: 'layer.update', id: L.LOCK, changes: {locked: true}});
  engine.undoStack.length = 0;
  return {engine, L, ids};
}

function makeCtx(engine, {select = [], points = [], entities = [], form = {}, paths = []} = {}) {
  const rec = {toasts: [], forms: [], runs: [], prompts: []};
  let selection = new Set(select);
  const ctx = {
    storage: new MemoryStorage(),
    entities: () => engine.doc.entities, blocks: () => engine.doc.blocks, layers: () => engine.doc.layers,
    ensureLayer: (name) => { let l = engine.doc.layers.find((x) => x.name === name); if (!l) { engine.execute({type: 'layer.add', name, color: '#ffffff'}); l = engine.doc.layers.find((x) => x.name === name); } return l.id; },
    commit: ({removeIds = [], entities: list = []}) => engine.execute({type: 'batch', commands: [...(removeIds.length ? [{type: 'delete', ids: removeIds}] : []), {type: 'addMany', entities: list.map((e) => ({...e, layer: e.layer || 'default'}))}]}),
    setSelected: (ids) => { selection = new Set(ids); },
    pickEntity: async (o) => { rec.prompts.push(o?.prompt); const id = entities.shift(); return id ? engine.doc.entities.find((e) => e.id === id) : null; },
    pickPoint: async (prompt) => { rec.prompts.push(prompt); return points.shift() || null; },
    pickPath: async (o) => { rec.prompts.push(o?.prompt); const p = paths.shift(); return p ? {points: p} : null; },
    tolerance: () => 10, askNumber: () => {},
    toast: (m, isError) => rec.toasts.push({m: String(m), isError: !!isError}),
    userErrorMessage: (e) => String(e?.message || e), run: (name) => rec.runs.push(name),
    selected: () => engine.doc.entities.filter((e) => selection.has(e.id)), selectedIds: () => [...selection],
    execute: (c) => engine.execute(c),
    form: (title, fields, onApply) => { rec.forms.push(title); const values = {}; for (const f of fields) { if (Object.prototype.hasOwnProperty.call(form, f.name)) values[f.name] = String(form[f.name]); else if (f.type !== 'checkbox') values[f.name] = String(f.value ?? f.options?.[0]?.[0] ?? ''); } return Promise.resolve().then(() => onApply(values)).catch((e) => rec.toasts.push({m: String(e.message), isError: true, form: true})); },
    activeLayer: () => 'default', setActiveLayer() {}, log() {}, refresh() {}, num: (k, d) => d, scale: () => 1,
  };
  return {ctx, rec};
}

/* ─────────────── 상: 개수 상한 ─────────────── */
test('CSL·SCB·RND·SD·WU·LXP·CM 는 거대값을 반복문에 넣지 않고 한국어로 막는다', () => {
  assert.throws(() => buildCutSymbolPolyline(P(0, 0), P(1000, 0), {count: 1e15}), /CSL · 기호 개수.*1~100/);
  assert.equal(buildCutSymbolPolyline(P(0, 0), P(1000, 0), {count: 3}).length, 2 + 3 * 4);
  assert.throws(() => scaleBarBars('chess', 1000, 1e15), /분할 수는 1~50/);
  assert.throws(() => buildRoundSurface([P(0, 0), P(100, 0)], [P(0, 10), P(100, 10)], 2000000), /RND · 갯수.*1~500/);
  assert.equal(buildRoundSurface([P(0, 0), P(100, 0)], [P(0, 10), P(100, 10)], 12).length, 12);
  assert.throws(() => splitDimensionEqual({mode: 'horizontal', points: [P(0, 0), P(100, 0), P(0, -10)]}, 1e15), /SD · 등분 개수/);
  assert.throws(() => flowArrowPlacements([P(0, 0), P(1e9, 0)], {spacing: 1}), /너무 많습니다/);
  assert.throws(() => explodeByPattern([P(0, 0), P(1e9, 0)], [1e-6, 1e-6]), /LXP · 선 조각.*너무 많습니다/);
  assert.throws(() => cloudArcs(P(0, 0), P(1e9, 1e9), 1), /CM · 구름 호 개수/);
  assert.throws(() => boundedInteger('가나다', {min: 1, max: 5, label: '개수'}), /개수에는 숫자를 입력하세요/);
});

test('CSL·RND·TII 폼에 거대값을 넣으면 점을 묻기 전에 한국어 오류로 끝난다', async () => {
  const {engine} = makeEngine();
  for (const [install, key, form] of [[installDimSymbolTools, 'CSL', {count: 1e15}], [installDimHatchTools, 'RND', {count: 2000000}], [installTextCreateTools, 'TII', {mode: 'array', count: 1e15}]]) {
    const {ctx, rec} = makeCtx(engine, {form, points: [P(0, 0), P(100, 0)]});
    await install(ctx)[key]();
    await settle();
    assert.ok(rec.toasts.some((t) => t.isError && /1~\d+ 사이의 정수/.test(t.m)), `${key}: ${JSON.stringify(rec.toasts)}`);
    assert.equal(rec.prompts.length, 0, `${key} 는 점을 묻지 않아야 한다`);
  }
});

/* ─────────────── 중: DH·DU·DPL·WSL ─────────────── */
test('DH·DU 가 실제 엔진에서 치수를 고친다(textPosition 제거, 되돌리기 1회)', async () => {
  const {engine, ids} = makeEngine();
  const dimId = ids[3];
  assert.deepEqual(restoreDimensionTextPosition({type: 'dimension', textPosition: P(1, 2)}), {textPosition: undefined});
  const {ctx, rec} = makeCtx(engine, {select: [dimId]});
  installDimSymbolTools(ctx).DH();
  assert.equal(engine.doc.entities.find((e) => e.id === dimId).textPosition, undefined, JSON.stringify(rec.toasts));
  assert.ok(!JSON.stringify(engine.doc).includes('"textPosition":null'));
  engine.execute({type: 'undo'});
  assert.deepEqual(engine.doc.entities.find((e) => e.id === dimId).textPosition, P(1000, -400));
  const du = makeCtx(engine, {select: [dimId], form: {textHeight: 200}});
  installDimSymbolTools(du.ctx).DU();
  await settle();
  const dim = engine.doc.entities.find((e) => e.id === dimId);
  assert.equal(dim.textHeight, 200, JSON.stringify(du.rec.toasts));
  assert.equal(dim.textPosition, undefined);
  assert.deepEqual(refreshDimensionStyle({type: 'dimension'}, {}), {text: '', textTemplate: '', textPosition: undefined});
});

test('DPL 수직/수평·바운딩박스·정점간 방식이 textHeight 를 넣어 엔진 검증을 통과한다', () => {
  const pts = [P(0, 0), P(2000, 0), P(2000, 1500), P(0, 1500)];
  for (const dims of [orthoProjectionDims(pts, {textHeight: 150}), boundingBoxDims(G.bounds([{type: 'polyline', points: pts}]), {textHeight: 150}), vertexDistanceDims(pts, true, {textHeight: 150})]) {
    const engine = new DrawingEngine();
    assert.ok(dims.every((d) => d.textHeight === 150));
    const added = engine.execute({type: 'addMany', entities: dims.map((d) => ({...d, layer: 'default'}))});
    assert.equal(added.length, dims.length);
  }
});

test('WSL 넣기: 블록 자식에 켜가 있고 삽입점 좌표에 그려진다 → 목록·위치·기호변경까지 동작', async () => {
  const block = windowSymbolBlock(P(5000, 3000), 'W1', {size: 600, layer: 'L1'});
  assert.ok(block.entities.every((e) => e.layer === 'L1'));
  assert.deepEqual(block.entities[0].center, P(5000, 3000));
  const {engine} = makeEngine();
  const run = async (form, points = []) => { const c = makeCtx(engine, {form, points}); installSymbolOutputTools4(c.ctx).WSL(); await settle(); return c; };
  const ins = await run({mode: 'insert'}, [P(5000, 3000), P(7000, 3000)]);
  const symbols = engine.doc.entities.filter((e) => e.category === 'XI_WSL');
  assert.equal(symbols.length, 2, JSON.stringify(ins.rec.toasts));
  const b = G.bounds([symbols[0]]);
  assert.ok(Math.abs(b.minX - 4700) < 1 && Math.abs(b.maxX - 5300) < 1, JSON.stringify(b));
  const list = await run({mode: 'list'}, [P(0, -3000)]);
  assert.ok(list.rec.toasts.some((t) => /창호기호 2종/.test(t.m)), JSON.stringify(list.rec.toasts));
  const locate = makeCtx(engine, {form: {mode: 'locate', mark: 'W1'}});
  installSymbolOutputTools4(locate.ctx).WSL(); await settle();
  assert.ok(locate.rec.toasts.some((t) => /"W1" 기호 1개/.test(t.m)), JSON.stringify(locate.rec.toasts));
  const ren = await run({mode: 'renumber', action: 'rename', from: 'W1', to: 'W9'});
  assert.ok(engine.doc.entities.some((e) => e.attributes?.mark === 'W9'), JSON.stringify(ren.rec.toasts));
});

test('SAB·LCS: 잠긴 켜가 있어도 멈추지 않고 잠긴 켜 객체는 건너뛰었다고 알린다', async () => {
  const {engine, L} = makeEngine();
  assert.equal(splitByLockedLayer(engine.doc.entities, engine.doc.layers).skipped.length, 1);
  const sab = makeCtx(engine);
  installOutputTools(sab.ctx).SAB();
  assert.ok(sab.rec.toasts.some((t) => !t.isError && /잠긴 켜의 객체 1개는 건너뛰었습니다/.test(t.m)), JSON.stringify(sab.rec.toasts));
  assert.equal(engine.doc.entities.find((e) => e.layer === L.LOCK).points[0].x, 9000);
  const {engine: e2, ids, L: L2} = makeEngine();
  // 기준 켜: A-DIMS 치수, 조건: 선 → 모든 선(잠긴 켜 선 제외)을 A-DIMS 로
  const lcs = makeCtx(e2, {entities: [ids[3], ids[0]]});
  const before = e2.undoStack.length;
  await installSheetPlotTools(lcs.ctx).LCS();
  assert.equal(e2.undoStack.length - before, 1, '한 번에 옮겨 되돌리기 1회');
  assert.equal(e2.doc.entities.filter((e) => e.type === 'line' && e.layer === L2.DIM).length, 2);
  assert.ok(lcs.rec.toasts.some((t) => /잠긴 켜 객체 1개는 건너뛰었습니다/.test(t.m)), JSON.stringify(lcs.rec.toasts));
});

test('CER: 잠긴 켜 객체는 건너뛰고 나머지를 보정한다 · 거대 근사값은 막는다', async () => {
  const {engine} = makeEngine();
  engine.execute({type: 'addMany', entities: [{type: 'line', layer: 'default', points: [P(0.3, 0.2), P(100.4, 0.1)]}]});
  const {ctx, rec} = makeCtx(engine, {form: {scope: 'all', t_line: 'on', useOrigin: 'on', tol: 1, blockTol: 0.1}});
  installOutputTools(ctx).CER(); await settle();
  assert.ok(rec.toasts.some((t) => !t.isError && /잠긴 켜 객체 1개는 건너뛰었습니다/.test(t.m)), JSON.stringify(rec.toasts));
  const huge = makeCtx(engine, {form: {scope: 'all', t_line: 'on', useOrigin: 'on', tol: 1e15}});
  installOutputTools(huge.ctx).CER(); await settle();
  assert.ok(huge.rec.toasts.some((t) => t.isError && /1000mm 이하/.test(t.m)));
});

/* ─────────────── 안내만 → 실제 동작 12개 ─────────────── */
test('A0·A1: 작업 각도가 직교 입력을 돌리고 A0 가 되돌린다', async () => {
  resetSnapAngleCache();
  const {engine, ids} = makeEngine();
  const {ctx} = makeCtx(engine, {form: {mode: 'angle', value: 30}});
  installOutputTools(ctx).A1(); await settle();
  assert.ok(Math.abs(getSnapAngle() - 30) < 1e-9);
  const snapped = orthoSnap(P(0, 0), P(100, 10), P(100, 10), 30);
  assert.ok(Math.abs(G.angle(snapped) - 30) < 1e-6);
  assert.deepEqual(orthoSnap(P(0, 0), P(100, 10), P(100, 10), 0), P(100, 0)); // 0°는 예전과 같다
  const pick = makeCtx(engine, {select: [], entities: [], form: {mode: 'line'}});
  pick.ctx.selected = () => [{type: 'line', points: [P(0, 0), P(100, 100)]}];
  installOutputTools(pick.ctx).A1(); await settle();
  assert.ok(Math.abs(getSnapAngle() - 45) < 1e-9);
  assert.ok(Math.abs(slopePercentToAngle(100) - 45) < 1e-9);
  installOutputTools(ctx).A0();
  assert.equal(getSnapAngle(), 0);
  setSnapAngle(0);
});

test('AON·AOFF: 명령창의 한글 자판 → 영문 명령 변환을 실제로 켜고 끈다', () => {
  const store = new MemoryStorage();
  const saved = globalThis.localStorage; globalThis.localStorage = store;
  try {
    const {engine} = makeEngine();
    const {ctx} = makeCtx(engine); ctx.storage = store;
    const settings = {aliases: defaultAliases()};
    installOutputTools(ctx).AOFF();
    assert.equal(preprocessImeCommand('ㅣㅑㅜㄷ', 'idle', settings).command, null);
    installOutputTools(ctx).AON();
    assert.equal(preprocessImeCommand('ㅣㅑㅜㄷ', 'idle', settings).command, 'LINE');
  } finally { globalThis.localStorage = saved; }
});

test('FCC: 도면 문자모양·원본 글꼴을 모아 목록 파일로 내려받는다', async () => {
  const {engine} = makeEngine();
  const rows = fontUsageRows(engine.doc.entities);
  assert.deepEqual(rows.map((r) => [r.style, r.font, r.count]), [['HGT', 'whgtxt.shx', 1]]);
  const report = formatFontReport(rows);
  assert.deepEqual(report.externalFonts, ['H2GTRM.shx']);
  downloads.length = 0;
  const {ctx, rec} = makeCtx(engine);
  await installOutputTools(ctx).FCC();
  assert.ok(downloads.some((d) => /^사용글꼴_.*\.txt$/.test(d.name)), JSON.stringify(downloads));
  assert.ok(rec.toasts.some((t) => /FCC · 문자모양 1종/.test(t.m)), JSON.stringify(rec.toasts));
});

test('MSL: 현재 도면에 정리 작업을 실제로 적용한다(잠긴 켜 제외, 되돌리기 1회)', async () => {
  const {engine} = makeEngine();
  engine.execute({type: 'addMany', entities: [{type: 'text', layer: 'default', position: P(0, 0), height: 100, text: '  ', align: 'left', rotation: 0}]});
  const plan = mslCleanupPlan(engine.doc.entities, engine.doc.layers, {emptyText: true, points: true});
  assert.equal(plan.counts.removed, 1);
  const before = engine.undoStack.length, count = engine.doc.entities.length;
  const {ctx, rec} = makeCtx(engine, {form: {scope: 'current', points: 'yes', emptyText: 'yes', purgeLayers: 'no', zeroLayer: 'no', moveToOrigin: 'no'}});
  installOutputTools(ctx).MSL(); await settle();
  assert.equal(engine.doc.entities.length, count - 1, JSON.stringify(rec.toasts));
  assert.equal(engine.undoStack.length - before, 1);
});

test('HEX·HPM: 해치 무늬를 .pat 정의로 내보낸다', async () => {
  const def = hatchToPatDefinition({type: 'hatch', pattern: 'cross', spacing: 100, angle: 45}, 'my pat');
  assert.equal(def, '*MY_PAT, 바른 CAD 해치 내보내기\n45, 0, 0, 0, 100\n135, 0, 0, 0, 100');
  assert.throws(() => hatchToPatDefinition({type: 'hatch', solid: true}, 'S'), /SOLID/);
  const tile = {minX: 0, minY: 0, maxX: 100, maxY: 100};
  const pat = tileToPatDefinition({segments: [[P(0, 0), P(100, 0)], [P(0, 0), P(50, 50)]], points: [P(50, 50)]}, tile, 'tile');
  assert.equal(pat.skipped, 0);
  assert.match(pat.text, /^\*TILE,/);
  assert.match(pat.text, /\n0, 0, 0, 0, 100\n/); // 가로선: 세로 주기 100
  assert.match(pat.text, /\n45, 0, 0, /);
  const {engine, ids} = makeEngine();
  downloads.length = 0;
  const hex = makeCtx(engine, {select: [ids[5]], form: {name: 'ANSI31', file: 'acadiso'}});
  await installDimHatchTools(hex.ctx).HEX(); await settle();
  assert.ok(downloads.some((d) => d.name === 'acadiso.pat'), JSON.stringify(hex.rec.toasts));
  engine.execute({type: 'addMany', entities: [{type: 'rectangle', layer: 'default', points: G.rectangle(P(20000, 0), P(20100, 100))}, {type: 'line', layer: 'default', points: [P(20000, 50), P(20100, 50)]}]});
  const box = engine.doc.entities.at(-2);
  assert.equal(hpmTileContents(engine.doc.entities.filter((e) => e.id !== box.id), G.bounds([box])).segments.length, 1);
  const hpm = makeCtx(engine, {entities: [box.id], form: {step: 'save', name: 'USER', file: 'user'}});
  installHatchTableTools(hpm.ctx).HPM(); await settle();
  assert.ok(downloads.some((d) => d.name === 'user.pat'), JSON.stringify(hpm.rec.toasts));
});

test('HP: 해치 기준점(origin)을 바꾸고 되돌리기 1회로 복구된다', async () => {
  const {engine, ids} = makeEngine();
  assert.equal(hatchOriginChanges({type: 'hatch', solid: true}, P(0, 0)), null);
  const {ctx, rec} = makeCtx(engine, {select: [ids[5]], points: [P(12, 34)]});
  await installHatchTableTools(ctx).HP(); await settle();
  assert.deepEqual(engine.doc.entities.find((e) => e.id === ids[5]).origin, P(12, 34), JSON.stringify(rec.toasts));
  engine.execute({type: 'undo'});
  assert.equal(engine.doc.entities.find((e) => e.id === ids[5]).origin, undefined);
});

test('MTLT·LEX: 문자 포함 선을 그리고 선종류를 .lin 으로 내보낸다', async () => {
  const pieces = textLinePieces([P(0, 0), P(5000, 0)], {text: 'GAS', height: 100, dash: 1000});
  assert.ok(pieces.some((p) => p.type === 'text' && p.text === 'GAS'));
  assert.ok(pieces.filter((p) => p.type === 'line').length >= 2);
  const {engine, ids} = makeEngine();
  const before = engine.doc.entities.length;
  const m = makeCtx(engine, {entities: [ids[0]], form: {text: 'GAS', height: 100, dash: 1000, name: 'GAS_LINE', saveLin: 'no'}});
  installSymbolTools(m.ctx).MTLT(); await settle();
  assert.ok(engine.doc.entities.some((e) => e.type === 'text' && e.text === 'GAS'), JSON.stringify(m.rec.toasts));
  assert.ok(engine.doc.entities.length > before);
  assert.equal(barunLinetypeDefinition('CENTER'), '*CENTER,Center ____ _ ____ _\nA,30,-10,5,-10');
  assert.match(textLinetypeDefinition('GAS_LINE', 'GAS'), /\["GAS",STANDARD,S=2.5,R=0.0,X=-3.375,Y=-1.25\]/);
  engine.execute({type: 'layer.update', id: engine.doc.layers.find((l) => l.name === 'A-DIMS').id, changes: {linetype: 'DASHED'}});
  assert.deepEqual(usedLinetypeKeys(engine.doc.entities, engine.doc.layers), ['DASHED']);
  assert.equal(linetypeExportText(['DASHED']).count, 1);
  downloads.length = 0;
  const lex = makeCtx(engine, {form: {scope: 'all', file: 'barun'}});
  lex.ctx.storage = m.ctx.storage; // MTLT 가 저장한 문자 포함 선도 함께
  installSymbolTools(lex.ctx).LEX(); await settle();
  assert.ok(downloads.some((d) => d.name === 'barun.lin'), JSON.stringify(lex.rec.toasts));
  assert.ok(lex.rec.toasts.some((t) => /선종류 6개/.test(t.m)), JSON.stringify(lex.rec.toasts));
});

test('BAK: 도면 이름_년.월일.시분.bcad 로 새 백업 파일을 내려받고 현재 도면은 그대로 둔다', async () => {
  assert.equal(backupFileName('평면도', new Date(2020, 10, 6, 9, 59)), '평면도_2020.1106.0959.bcad');
  const {engine} = makeEngine();
  const snapshot = JSON.stringify(engine.doc);
  globalThis.window = globalThis;
  globalThis.cad = {getDocument: () => structuredClone(engine.doc), drawings: {list: () => [{id: 't1', name: '평면도.dxf'}], active: () => 't1'}};
  try {
    downloads.length = 0;
    const {ctx, rec} = makeCtx(engine);
    installSymbolOutputTools4(ctx).BAK();
    assert.ok(downloads.some((d) => /^평면도_\d{4}\.\d{4}\.\d{4}\.bcad$/.test(d.name)), JSON.stringify(rec.toasts));
    assert.equal(JSON.stringify(engine.doc), snapshot);
    assert.deepEqual(rec.runs, []);
  } finally { delete globalThis.cad; }
});

/* ─────────────── 하: PPP·SVS 가 PB 박스 인식 ─────────────── */
test('PPP: PB 로 그린 박스를 도곽으로 등록하고 SHEETPDF 를 실행한다 · SVS 지정켜 방식도 PB 박스를 찾는다', async () => {
  const {engine} = makeEngine();
  const pb = makeCtx(engine, {paths: [[P(0, 0), P(42000, 29700)]]});
  await installSymbolOutputTools4(pb.ctx).PB();
  const box = engine.doc.entities.at(-1);
  assert.equal(box.plotBox, true, JSON.stringify(pb.rec.toasts));
  assert.equal(plotBoxCandidates(engine.doc.entities, null).length, 1);
  assert.equal(unregisteredPlotBoxes(engine.doc.entities, engine.doc.layers).length, 1);
  assert.deepEqual(plotBoxSheetSpec({minX: 0, minY: 0, maxX: 42000, maxY: 29700}), {paper: 'A3', denominator: 100});
  assert.equal(plotBoxSheetPlan([{id: 'x', bounds: {minX: 0, minY: 0, maxX: 10, maxY: 10}}], [{number: 'P-001'}]).sheets[0].number, 'P-002');
  globalThis.cad = {getDocument: () => structuredClone(engine.doc)};
  try {
    const ppp = makeCtx(engine);
    installSheetPlotTools(ppp.ctx).PPP();
    assert.deepEqual(ppp.rec.runs, ['SHEETPDF'], JSON.stringify(ppp.rec.toasts));
    assert.equal(engine.doc.sheets.length, 1);
    assert.equal(engine.doc.sheets[0].denominator, 100);
    assert.equal(engine.doc.entities.find((e) => e.id === box.id).sheetDecoration, true);
  } finally { delete globalThis.cad; }
  const zero = makeCtx(engine, {paths: [[P(0, 0), P(100, 0)]]});
  await assert.rejects(installSymbolOutputTools4(zero.ctx).PB(), /폭과 높이/);
  const svs = makeCtx(engine, {form: {mode: 'layer', layerName: '없는켜'}});
  installSymbolOutputTools4(svs.ctx).SVS(); await settle();
  assert.ok(svs.rec.toasts.some((t) => /도곽 후보 1개/.test(t.m)), JSON.stringify(svs.rec.toasts));
});

/* 2026-10-06 봇 점검 "SVS: 도곽 표시는 가능, 파일 분리 저장 불가" */
test('SVS 분리 저장: 찾은 도곽을 도면 도곽으로 등록하고(한 번의 Ctrl+Z) SHEETDXF 로 도곽마다 DXF 저장을 시작한다', async () => {
  const {engine} = makeEngine();
  engine.execute({type: 'layer.add', name: 'TB-FRAME', color: '#ffffff'});
  const frame = engine.doc.layers.find((l) => l.name === 'TB-FRAME').id;
  engine.execute({type: 'addMany', entities: [
    {type: 'polyline', closed: true, layer: frame, points: G.rectangle(P(0, 0), P(42000, 29700))},
    {type: 'polyline', closed: true, layer: frame, points: G.rectangle(P(50000, 0), P(92000, 29700))},
  ]});
  engine.execute({type: 'document.update', changes: {sheets: [{id: 'old', number: 'A-001', title: '기존', paper: 'A3', denominator: 100, bounds: {minX: -9000, minY: -9000, maxX: -1000, maxY: -1000}}]}});
  const snap = () => JSON.stringify({entities: engine.doc.entities, sheets: engine.doc.sheets});
  const before = snap();
  globalThis.cad = {getDocument: () => structuredClone(engine.doc)};
  try {
    const svs = makeCtx(engine, {form: {mode: 'layer', layerName: 'TB-FRAME', save: 'dxf'}});
    installSymbolOutputTools4(svs.ctx).SVS(); await settle();
    assert.deepEqual(svs.rec.runs, ['SHEETDXF'], JSON.stringify(svs.rec.toasts));
    assert.equal(engine.doc.sheets.length, 3, '기존 1장 + 새 2장');
    const added = engine.doc.sheets.slice(1);
    assert.deepEqual(added.map((s) => s.number), ['A-001-2', 'A-002'], '겹치는 번호는 -2 를 붙인다');
    assert.deepEqual(added.map((s) => s.denominator), [100, 100]);
    const decorations = engine.doc.entities.filter((e) => e.sheetDecoration);
    assert.deepEqual(decorations.map((e) => e.sheetId).sort(), added.map((s) => s.id).sort(), '박스선은 출력에서 빠진다');
    assert.ok(svs.rec.toasts.some((t) => /도곽 2개를 등록/.test(t.m) && !t.isError));
    engine.execute({type: 'undo'});
    assert.equal(snap(), before, 'Ctrl+Z 한 번에 등록·표시가 모두 취소된다(켜 만들기는 다른 카드처럼 따로 남는다)');
  } finally { delete globalThis.cad; }
  // 본 화면이 아니면(도면 전체를 못 읽으면) 등록하지 않고 알린다
  const off = makeCtx(engine, {form: {mode: 'layer', layerName: 'TB-FRAME', save: 'dxf'}});
  installSymbolOutputTools4(off.ctx).SVS(); await settle();
  assert.deepEqual(off.rec.runs, []);
  assert.ok(off.rec.toasts.some((t) => t.isError && /본 화면/.test(t.m)));
});

/* ─────────────── 하: 오류가 카드 토스트로 · 명령창 안내 문자열 ─────────────── */
test('MK·SAB·DBC 오류는 한국어 메시지로 던져져 app.js runCardCommand 한 곳에서 보고된다(비평 11: 모듈 이중 감싸기 제거)', async () => {
  const engine = new DrawingEngine();
  const {ctx} = makeCtx(engine, {entities: [], paths: [[P(0, 0), P(10, 10)], [P(100, 100), P(200, 200)]]});
  assert.throws(() => installTextCreateTools(ctx).MK(), /먼저 선택/);
  assert.throws(() => installOutputTools(ctx).SAB(), /정리할 객체가 없습니다/);
  await assert.rejects(installSheetPlotTools(ctx).DBC(), /원본 영역 안/);
  // app.js runCardCommand 와 같은 방식으로 감싸면 보고는 한 번만 일어난다
  const reports = [];
  const runCardCommand = (fn) => { try { const r = fn(); if (r?.then) return r.then(() => {}, (e) => reports.push(e.message)); } catch (e) { reports.push(e.message); } };
  runCardCommand(() => installTextCreateTools(ctx).MK());
  await runCardCommand(() => installOutputTools(ctx).SAB());
  assert.deepEqual(reports.length, 2);
});

test('문자 생성 카드는 pickPoint 에 문자열 안내를 넘긴다("[object Object]" 방지)', async () => {
  const {engine, ids} = makeEngine();
  const {ctx, rec} = makeCtx(engine, {select: [ids[6]], form: {keepShape: 'on'}});
  await installTextCreateTools(ctx).DAT(); await settle();
  assert.ok(rec.prompts.length > 0);
  assert.ok(rec.prompts.every((p) => typeof p === 'string'), JSON.stringify(rec.prompts));
});

test('체크박스 값: form() 이 보내는 on 은 켜짐, 빈칸·없음은 꺼짐', () => {
  for (const v of ['on', 'true', 'yes', '1', true]) assert.equal(isChecked(v), true, String(v));
  for (const v of ['', undefined, null, 'off', false, 'no', 0]) assert.equal(isChecked(v), false, String(v));
});

/* 비평 5: 화면 해치 무늬도 출력·DXF 처럼 도면 원점(또는 HP origin)을 지난다 */
function hatchLineWorldYs(entity) {
  let m = [1, 0, 0, 1, 0, 0], clipped = false; const stack = [], ys = new Set();
  const apply = (x, y) => ({x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5]});
  const ctx = new Proxy({}, {get: (_, k) => ({
    save: () => stack.push([...m]), restore: () => { m = stack.pop() || m; },
    translate: (x, y) => { m = [m[0], m[1], m[2], m[3], m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]; },
    rotate: (a) => { const c = Math.cos(a), s = Math.sin(a); m = [m[0] * c + m[2] * s, m[1] * c + m[3] * s, -m[0] * s + m[2] * c, -m[1] * s + m[3] * c, m[4], m[5]]; },
    clip: () => { clipped = true; },
    moveTo: (x, y) => { if (!clipped) return; const p = apply(x, y); ys.add(Math.round(-p.y * 1000) / 1000); },
  })[k] || (() => {})});
  drawEntity(ctx, entity, (p) => ({x: p.x, y: -p.y}), 1, '#fff');
  return [...ys].sort((a, b) => a - b);
}
test('화면 해치 무늬 위상: origin 이 없으면 도면 원점(0,0), 있으면 origin 을 지난다(출력과 같음)', () => {
  const base = {type: 'hatch', points: G.rectangle(P(1000, 1000), P(2000, 1600)), loops: [], pattern: 'lines', spacing: 300, angle: 0};
  assert.deepEqual(hatchLineWorldYs(base).filter((y) => y >= 1000 && y <= 1600), [1200, 1500]);
  assert.deepEqual(hatchLineWorldYs({...base, origin: P(0, 100)}).filter((y) => y >= 1000 && y <= 1600), [1000, 1300, 1600]);
});

test('MSL 기본값(켜 퍼지 예): 블록 정의만 쓰는 켜가 있어도 정리가 통째로 실패하지 않는다(비평 1)', async () => {
  const {engine} = makeEngine();
  engine.execute({type: 'layer.add', name: 'BLK-ONLY', color: '#ffffff'});
  engine.execute({type: 'layer.add', name: 'EMPTY', color: '#ffffff'});
  const blkLayer = engine.doc.layers.find((l) => l.name === 'BLK-ONLY').id;
  engine.execute({type: 'document.update', changes: {blocks: [{name: 'DOORDEF', origin: P(0, 0), entities: [{type: 'line', layer: blkLayer, points: [P(0, 0), P(100, 0)]}]}]}});
  engine.execute({type: 'addMany', entities: [{type: 'text', layer: 'default', position: P(0, 0), height: 100, text: ' ', align: 'left', rotation: 0}]});
  const count = engine.doc.entities.length, before = engine.undoStack.length;
  const {ctx, rec} = makeCtx(engine, {form: {scope: 'current'}}); // 폼 기본값: 포인트·빈 문자 삭제, 켜 퍼지 예
  ctx.blocks = () => engine.doc.blocks;
  installOutputTools(ctx).MSL(); await settle();
  assert.ok(!rec.toasts.some((t) => t.isError), JSON.stringify(rec.toasts));
  assert.equal(engine.doc.entities.length, count - 1, '빈 문자 삭제가 남아야 한다');
  assert.ok(engine.doc.layers.some((l) => l.name === 'BLK-ONLY'), '블록 정의가 쓰는 켜는 남긴다');
  assert.ok(!engine.doc.layers.some((l) => l.name === 'EMPTY'), '빈 켜는 지운다');
  assert.equal(engine.undoStack.length - before, 1, '한 번에 되돌린다');
  const plan = mslCleanupPlan(engine.doc.entities, engine.doc.layers, {purgeLayers: true, blocks: engine.doc.blocks});
  assert.ok(!plan.layerDeletes.some((c) => c.id === blkLayer));
});

test('A1 작업 각도는 도면 탭별·실행 중에만 기억하고 예전 영구 저장값은 지운다(비평 3)', () => {
  resetSnapAngleCache();
  const store = new MemoryStorage(); store.setItem(SNAP_ANGLE_KEY, '30');
  assert.equal(getSnapAngle(store), 0, '어제 저장된 30°가 오늘 직교를 돌리면 안 된다');
  assert.equal(store.getItem(SNAP_ANGLE_KEY), null);
  setSnapAngleDrawing('tab-1'); setSnapAngle(30, store);
  assert.equal(store.getItem(SNAP_ANGLE_KEY), null, '영구 저장하지 않는다');
  assert.equal(snapAngleLabel(), ' · 30°');
  setSnapAngleDrawing('tab-2');
  assert.equal(getSnapAngle(), 0, '다른 도면 탭은 0°');
  assert.equal(snapAngleLabel(), '');
  setSnapAngleDrawing('tab-1');
  assert.equal(getSnapAngle(), 30, '돌아오면 그 탭의 값');
  resetSnapAngleCache();
});

test('BAK(설치본): 저장 창에서 저장했을 때만 "저장했습니다", 취소하면 취소 안내(비평 10)', async () => {
  const {engine} = makeEngine();
  globalThis.window = globalThis;
  globalThis.cad = {getDocument: () => structuredClone(engine.doc), drawings: {list: () => [{id: 't1', name: '평면도'}], active: () => 't1'}};
  const saves = [];
  try {
    globalThis.cadDesktop = {saveFile: async (payload) => { saves.push(payload.name); return {saved: true, path: 'D:/도면/' + payload.name}; }};
    const ok = makeCtx(engine);
    await installSymbolOutputTools4(ok.ctx).BAK();
    assert.match(saves[0], /^평면도_\d{4}\.\d{4}\.\d{4}\.bcad$/);
    assert.ok(ok.rec.toasts.some((t) => /백업본을 저장했습니다: D:\/도면\//.test(t.m)), JSON.stringify(ok.rec.toasts));
    globalThis.cadDesktop = {saveFile: async () => ({saved: false})};
    const cancel = makeCtx(engine);
    await installSymbolOutputTools4(cancel.ctx).BAK();
    assert.ok(cancel.rec.toasts.some((t) => /취소했습니다/.test(t.m)) && !cancel.rec.toasts.some((t) => /저장했습니다/.test(t.m)), JSON.stringify(cancel.rec.toasts));
  } finally { delete globalThis.cad; delete globalThis.cadDesktop; }
});

test('MSL 열린 도면 모두: 시작 탭으로 못 돌아가면 다시 시도하고 끝내 실패하면 알린다(재비평 2)', async () => {
  const {engine} = makeEngine();
  const run = async (selectImpl) => {
    let active = 't1';
    globalThis.window = globalThis;
    globalThis.cad = {drawings: {list: () => [{id: 't1', name: '가'}, {id: 't2', name: '나'}], active: () => active, select: (id) => { selectImpl(id, () => { active = id; }); }}};
    const {ctx, rec} = makeCtx(engine, {form: {scope: 'all', purgeLayers: 'no'}});
    installOutputTools(ctx).MSL();
    for (let i = 0; i < 80 && !rec.toasts.some((t) => /MSL · (열린 도면|정리를 시작한)/.test(t.m)); i++) await new Promise((r) => setTimeout(r, 25));
    await new Promise((r) => setTimeout(r, 700));
    delete globalThis.cad;
    return {rec, active};
  };
  let calls = 0; // 돌아가는 첫 시도만 거부(열린 창) → 재시도로 복귀
  const retry = await run((id, go) => { if (id === 't1' && ++calls === 2) throw Error('열려 있는 설정·검토 창을 닫은 뒤 도면을 전환하세요.'); go(); });
  assert.equal(retry.active, 't1');
  assert.ok(!retry.rec.toasts.some((t) => /돌아가지 못했습니다/.test(t.m)), JSON.stringify(retry.rec.toasts));
  const stuck = await run((id, go) => { if (id === 't1' && calls++ > 1) throw Error('도면을 읽거나 저장하고 있습니다.'); go(); });
  assert.equal(stuck.active, 't2');
  assert.ok(stuck.rec.toasts.some((t) => t.isError && /돌아가지 못했습니다.*"나"/.test(t.m)), JSON.stringify(stuck.rec.toasts));
});
