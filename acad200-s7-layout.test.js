// ACAD200 영역 7 — 배치·뷰포트·뷰·선종류 축척(709~711, 713, 719) 시험.
import test from 'node:test';
import assert from 'node:assert/strict';
import {DrawingEngine} from './engine.js';
import {plotSVG} from './plot.js';
import {sheetToLayout, layoutsFromSheets, modelToPaper, setViewportScale, panViewport, maximizeViewport, minimizeViewport, exportLayout, layoutPreviewSVG, effectiveLinetypeScale, activeSpace, paperSize, updateLayoutViewport} from './paper-space.js';
import {setViewportOverride} from './viewport-layers.js';
import {saveNamedView, restoreNamedView, deleteNamedView, viewFromScreen, screenFromView} from './named-views.js';

const L = (id, name, extra = {}) => ({id, name, color: '#ffffff', visible: true, locked: false, lineweight: .25, linetype: 'CONTINUOUS', ...extra});
const sheet = {id: 's1', number: 'A-101', title: '평면도', paper: 'A3', denominator: 100, bounds: {minX: 0, minY: 0, maxX: 42000, maxY: 29700}};

/* 709 */
test('709 모형 도곽 시트 → 뷰포트 하나짜리 배치(축척 1:100, 종이 가득)', () => {
  const layout = sheetToLayout(sheet);
  assert.equal(layout.name, 'A-101'); assert.equal(layout.viewports.length, 1);
  const vp = layout.viewports[0];
  assert.equal(vp.scale, .01); assert.equal(vp.width, 420); assert.equal(vp.height, 297); assert.equal(vp.locked, true);
  assert.deepEqual(vp.modelView, sheet.bounds);
  const toPaper = modelToPaper(vp);
  assert.deepEqual(toPaper({x: 0, y: 0}), {x: 0, y: 0});
  assert.deepEqual(toPaper({x: 42000, y: 29700}), {x: 420, y: 297});
  assert.deepEqual(paperSize({paper: 'A3', orientation: 'portrait'}), [297, 420]);
  assert.equal(activeSpace({currentLayout: 'Model'}), 'model'); assert.equal(activeSpace({currentLayout: 'layout-s1'}), 'paper');
});
test('709 도곽에서 배치 만들기는 이미 있는 배치를 덮어쓰지 않고, 엔진에 저장된다', () => {
  const doc = {sheets: [sheet, {...sheet, id: 's2', number: 'A-102'}], layouts: [sheetToLayout(sheet)]};
  const r = layoutsFromSheets(doc);
  assert.equal(r.added, 1); assert.equal(r.layouts.length, 2);
  const e = new DrawingEngine();
  e.execute({type: 'document.update', changes: {layouts: r.layouts}});
  assert.equal(e.doc.layouts[1].name, 'A-102');
});

/* 710 */
test('710 뷰포트 축척: 중심 고정, 뷰 높이 = 종이 높이 / 축척, 잠기면 거절', () => {
  const vp = {...sheetToLayout(sheet).viewports[0], locked: false};
  const half = setViewportScale(vp, .02);   // 1:50
  assert.equal(half.modelView.maxX - half.modelView.minX, 21000);
  assert.equal((half.modelView.minX + half.modelView.maxX) / 2, 21000);
  assert.throws(() => setViewportScale({...vp, locked: true}, .02), /잠긴/);
  assert.throws(() => setViewportScale(vp, 0), /양수/);
  assert.throws(() => panViewport({...vp, locked: true}, 1, 1), /잠긴/);
  assert.equal(panViewport(vp, 10, 0).modelView.minX, 10);
  const doc = {layouts: [{id: 'L1', viewports: [vp]}]};
  assert.equal(updateLayoutViewport(doc, 'L1', vp.id, (v) => setViewportScale(v, .05))[0].viewports[0].scale, .05);
  assert.throws(() => updateLayoutViewport(doc, 'L1', 'none', (v) => v), /뷰포트를 찾지/);
});
test('710 VPMAX/VPMIN 은 화면 상태만 바꾸고 되돌린다', () => {
  const vp = sheetToLayout(sheet).viewports[0], view = {scale: .3, origin: {x: 1, y: 2}};
  const max = maximizeViewport({view}, vp);
  assert.deepEqual(max.bounds, vp.modelView); assert.equal(max.maximized.vpId, vp.id);
  assert.equal(maximizeViewport(max, vp), max, '두 번 최대화하지 않는다');
  const min = minimizeViewport(max);
  assert.deepEqual(min.view, view); assert.equal(min.maximized, null);
  assert.throws(() => maximizeViewport({view}, null), /고르세요/);
});

/* 711 */
test('711 이름 있는 뷰: 창 크기가 달라도 같은 범위, 레이어 상태 함께, 지우면 상태도', () => {
  const doc = {layers: [L('a', 'A'), L('b', 'B', {visible: false})], layerStates: {}, namedViews: []};
  const screen = {scale: .5, origin: {x: 100, y: 400}, width: 800, height: 600};
  const view = viewFromScreen(screen);
  assert.deepEqual(view, {center: {x: 600, y: 200}, width: 1600, height: 1200});
  const restored = screenFromView(view, {width: 1600, height: 1200});
  assert.equal(restored.scale, 1); assert.deepEqual(restored.origin, {x: 200, y: 800});
  const saved = saveNamedView(doc, '정면', screen, {savedAt: 1});
  assert.equal(saved.namedViews[0].layerState, '*VIEW:정면');
  assert.deepEqual(saved.layerStates['*VIEW:정면'].mask, ['visible', 'frozen', 'locked']);
  const later = {...doc, ...saved, layers: [L('a', 'A', {visible: false}), L('b', 'B')]};
  const r = restoreNamedView(later, '정면', {width: 800, height: 600});
  assert.equal(r.view.scale, .5);
  assert.deepEqual(r.commands.map((c) => [c.id, c.changes.visible]), [['a', true], ['b', false]]);
  assert.equal(restoreNamedView(later, '정면', {width: 800, height: 600}, {layers: false}).commands.length, 0);
  const again = saveNamedView({...later}, '정면', screen, {savedAt: 2});
  assert.equal(Object.keys(again.layerStates).filter((k) => k.startsWith('*VIEW:')).length, 1, '같은 이름을 다시 저장하면 옛 상태를 지운다');
  const gone = deleteNamedView({...later, ...again}, '정면');
  assert.equal(gone.namedViews.length, 0); assert.equal(gone.layerStates['*VIEW:정면'], undefined);
  assert.throws(() => saveNamedView(doc, '  ', screen), /이름/);
  assert.throws(() => restoreNamedView(doc, '없음', screen), /그런 뷰/);
});
test('711 엔진: namedViews 는 document.update 로 저장·되돌리기', () => {
  const e = new DrawingEngine();
  e.execute({type: 'document.update', changes: {namedViews: [{name: 'v', center: {x: 0, y: 0}, width: 1, height: 1}]}});
  assert.equal(e.doc.namedViews[0].name, 'v');
  e.execute({type: 'undo'});
  assert.equal(e.doc.namedViews, undefined);
});

/* 713 + 708 */
test('713 EXPORTLAYOUT: 뷰포트 안만 잘라 종이 mm 로, 문자 높이도 축척만큼, VP 동결 레이어는 빠진다', () => {
  const doc = {version: 2, units: 'mm', linetypeScale: 50, layers: [L('a', 'A'), L('b', 'B')], blocks: [], entities: [
    {id: 'in', type: 'line', layer: 'a', points: [{x: 1000, y: 1000}, {x: 2000, y: 1000}]},
    {id: 'cross', type: 'line', layer: 'a', points: [{x: 41000, y: 500}, {x: 50000, y: 500}]},
    {id: 'far', type: 'line', layer: 'a', points: [{x: 90000, y: 0}, {x: 91000, y: 0}]},
    {id: 'frozen', type: 'line', layer: 'b', points: [{x: 1000, y: 2000}, {x: 2000, y: 2000}]},
    {id: 't', type: 'text', layer: 'a', position: {x: 5000, y: 5000}, height: 250, text: '실'},
  ], dxfPreservation: {big: true}};
  const layout = sheetToLayout(sheet);
  layout.viewports[0].layerOverrides = setViewportOverride(layout.viewports[0], 'b', 'frozen', true);
  let n = 0;
  const r = exportLayout(doc, layout, {idFactory: () => 'n' + (++n)});
  const byText = r.document.entities.find((e) => e.type === 'text');
  assert.equal(byText.height, 2.5);
  assert.deepEqual(byText.position, {x: 50, y: 50});
  const lines = r.document.entities.filter((e) => e.type === 'line');
  assert.equal(lines.length, 2, '안의 선 + 잘린 선 · 밖의 선·동결 레이어 선 없음');
  assert.ok(lines.every((l) => l.points.every((p) => p.x <= 420.0001)));
  assert.equal(r.scanned, 4, '뷰포트 상자와 겹치는 객체만 살핀다');
  assert.equal(r.document.dxfPreservation, undefined); assert.deepEqual(r.document.sheets, []);
  assert.equal(r.document.linetypeScale, 1, 'PSLTSCALE: 종이 위 무늬 길이 그대로');
  new DrawingEngine().validate(r.document);
  const svg = layoutPreviewSVG(doc, layout, plotSVG);
  assert.match(svg, /<svg[^>]+width="420mm"/);
});

/* 719 */
test('719 뷰포트 선종류 축척: PSLTSCALE 켜면 1/축척, 끄면 모형 그대로, MSLTSCALE 은 주석 축척', () => {
  const vp = {scale: .01};
  assert.equal(effectiveLinetypeScale({linetypeScale: 2}, null, {linetypeScale: 1}, vp), 200);
  assert.equal(effectiveLinetypeScale({}, null, {linetypeScale: 1, psltscale: false}, vp), 1);
  assert.equal(effectiveLinetypeScale({}, null, {linetypeScale: 1, annotationScale: 50}), 50);
  assert.equal(effectiveLinetypeScale({}, null, {linetypeScale: 1, annotationScale: 50, msltscale: false}), 1);
  const e = new DrawingEngine();
  e.execute({type: 'document.update', changes: {psltscale: false, msltscale: true}});
  assert.equal(e.doc.psltscale, false);
  assert.throws(() => e.execute({type: 'document.update', changes: {psltscale: 'yes'}}), /켜기\/끄기/);
});
