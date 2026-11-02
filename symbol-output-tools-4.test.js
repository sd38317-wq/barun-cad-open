// symbol-output-tools-4.js 의 순수 함수 시험. DOM 없이 node --test 로 돈다.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  nextIncrementValue, cornersToBox, circlePolygon,
  cloudArcs, cloudMarkAnchor,
  sectionSymbolEntities,
  scaleBarLabel, scaleBarDivisions, scaleBarBars, SCB_LINEWEIGHT,
  windowSymbolBlock, openingSymbolCounts, openingSymbolCountsFromSelection, parseMarkNumber, renameMarkPlan, countChangePlan, shiftMarkPlan,
  timestampLabel,
  emptyTextIds, pointEntityIds, unusedLayerIds,
  isAxisAlignedQuad, quadCandidates, blockWorldBounds, attributeCandidates, textsInsideBox, autoSheetNumbers,
  entityContainingPoint, solidHatchBoundaryPoints,
  computeLinetypeScales,
  findDuplicateShortcut,
  copyContentChanges,
} from './symbol-output-tools-4.js';

/* ── 공용 헬퍼 ── */
test('nextIncrementValue increments numbers and single letters, rejects other strings', () => {
  assert.equal(nextIncrementValue('1'), '2');
  assert.equal(nextIncrementValue('9'), '10');
  assert.equal(nextIncrementValue('A'), 'B');
  assert.throws(() => nextIncrementValue('AB'));
});
test('cornersToBox normalizes regardless of corner order', () => {
  assert.deepEqual(cornersToBox({ x: 10, y: 0 }, { x: 0, y: 10 }), { minX: 0, minY: 0, maxX: 10, maxY: 10 });
});
test('circlePolygon returns the requested number of points on the circle', () => {
  const pts = circlePolygon({ x: 0, y: 0 }, 10, 4);
  assert.equal(pts.length, 4);
  for (const p of pts) assert.ok(Math.abs(Math.hypot(p.x, p.y) - 10) < 1e-9);
  assert.throws(() => circlePolygon({ x: 0, y: 0 }, 0));
});

/* ── CM ── */
test('cloudArcs covers the rectangle perimeter with arcs sized near the pitch', () => {
  const { arcs, bounds } = cloudArcs({ x: 0, y: 0 }, { x: 1000, y: 500 }, 250);
  assert.deepEqual(bounds, { minX: 0, minY: 0, maxX: 1000, maxY: 500 });
  assert.ok(arcs.length >= 8);
  for (const a of arcs) assert.ok(a.radius > 0 && a.radius < 300);
  assert.throws(() => cloudArcs({ x: 0, y: 0 }, { x: 0, y: 500 }, 250), /폭·높이/);
  assert.throws(() => cloudArcs({ x: 0, y: 0 }, { x: 10, y: 10 }, 0), /호 간격/);
});
test('cloudMarkAnchor returns fixed top-left when autoPosition is off, nearest corner otherwise', () => {
  const bounds = { minX: 0, minY: 0, maxX: 100, maxY: 50 };
  assert.deepEqual(cloudMarkAnchor(bounds, { x: 5, y: 5 }, false), { x: 0, y: 50 });
  assert.deepEqual(cloudMarkAnchor(bounds, { x: 95, y: 5 }, true), { x: 100, y: 0 });
  assert.deepEqual(cloudMarkAnchor(bounds, { x: 2, y: 2 }, true), { x: 0, y: 0 });
});

/* ── SSL ── */
test('sectionSymbolEntities builds a leader + circle + hatch + two-line text', () => {
  const list = sectionSymbolEntities({ x: 0, y: 0 }, { x: 1000, y: 0 }, { radius: 700, textHeight: 250, mark: 'A', reference: 'A-101' });
  assert.equal(list[0].type, 'line');
  assert.equal(list[1].type, 'circle');
  assert.equal(list[1].radius, 700);
  assert.equal(list[2].type, 'hatch');
  const texts = list.filter(e => e.type === 'text');
  assert.equal(texts.length, 2);
  assert.equal(texts[0].text, 'A');
  assert.equal(texts[1].text, 'A-101');
  assert.throws(() => sectionSymbolEntities({ x: 0, y: 0 }, { x: 0, y: 0 }, { radius: 1, textHeight: 1 }));
  assert.throws(() => sectionSymbolEntities({ x: 0, y: 0 }, { x: 1, y: 0 }, { radius: 0, textHeight: 1 }));
});

/* ── SCB ── */
test('scaleBarLabel formats "Scale : 1/N" and rejects non-positive denominators', () => {
  assert.equal(scaleBarLabel(100), 'Scale : 1/100');
  assert.throws(() => scaleBarLabel(0));
});
test('scaleBarDivisions splits length into divisions+1 marks in meters', () => {
  const marks = scaleBarDivisions(10000, 5);
  assert.equal(marks.length, 6);
  assert.equal(marks[0].label, '0');
  assert.equal(marks[5].label, '10');
  assert.throws(() => scaleBarDivisions(10000, 0));
  assert.throws(() => scaleBarDivisions(0, 5));
});
test('scaleBarBars alternates fill only for the chess style', () => {
  const chess = scaleBarBars('chess', 1000, 4);
  assert.deepEqual(chess.map(b => b.filled), [true, false, true, false]);
  const step = scaleBarBars('step-thick', 1000, 4);
  assert.ok(step.every(b => b.filled === false));
  assert.equal(SCB_LINEWEIGHT['step-thick'], 0.7);
});

/* ── WSL ── */
test('windowSymbolBlock builds a circle or hexagon block carrying mark+count attributes', () => {
  const circle = windowSymbolBlock({ x: 10, y: 20 }, 'W1', { shape: 'circle', size: 600 });
  assert.equal(circle.category, 'XI_WSL');
  assert.equal(circle.attributes.mark, 'W1');
  assert.equal(circle.entities[0].type, 'circle');
  const hex = windowSymbolBlock({ x: 0, y: 0 }, 'W2', { shape: 'hex', size: 600 });
  assert.equal(hex.entities[0].points.length, 6);
  assert.throws(() => windowSymbolBlock({ x: 0, y: 0 }, 'W3', { size: 0 }));
});
test('WSL selection fallback counts whole drawing when unrelated objects are selected', () => {
  const symbol = { type: 'block', category: 'XI_WSL', attributes: { mark: 'W1', count: 3 } };
  const wall = { type: 'line', points: [{x:0,y:0},{x:10,y:0}] };
  assert.deepEqual(openingSymbolCountsFromSelection([symbol, wall], [wall]), [['W1', 3]]);
  assert.deepEqual(openingSymbolCountsFromSelection([symbol, wall], []), [['W1', 3]]);
});

test('openingSymbolCounts sums the count tag per mark and ignores other blocks', () => {
  const entities = [
    { type: 'block', category: 'XI_WSL', attributes: { mark: 'W1', count: 2 } },
    { type: 'block', category: 'XI_WSL', attributes: { mark: 'W1', count: 1 } },
    { type: 'block', category: 'XI_WSL', attributes: { mark: 'W2' } },
    { type: 'block', category: 'OTHER', attributes: { mark: 'W9' } },
  ];
  assert.deepEqual(openingSymbolCounts(entities), [['W1', 3], ['W2', 1]]);
});
test('parseMarkNumber splits a trailing number from its prefix', () => {
  assert.deepEqual(parseMarkNumber('WD12'), { prefix: 'WD', number: 12 });
  assert.equal(parseMarkNumber('NoDigits'), null);
});
test('renameMarkPlan and countChangePlan only touch matching XI_WSL blocks', () => {
  const entities = [
    { id: 'a', type: 'block', category: 'XI_WSL', attributes: { mark: 'WD', count: 1 } },
    { id: 'b', type: 'block', category: 'XI_WSL', attributes: { mark: 'SD', count: 1 } },
  ];
  assert.deepEqual(renameMarkPlan(entities, 'WD', 'SD2'), [{ id: 'a', attributes: { mark: 'SD2', count: 1 } }]);
  assert.deepEqual(countChangePlan(entities, 'SD', 4), [{ id: 'b', attributes: { mark: 'SD', count: 4 } }]);
  assert.throws(() => countChangePlan(entities, 'SD', 0));
});
test('shiftMarkPlan shifts numbers at or above the threshold by delta in one pass', () => {
  const entities = ['WD3', 'WD4', 'WD5', 'WD6'].map((mark, i) => ({ id: 'e' + i, type: 'block', category: 'XI_WSL', attributes: { mark } }));
  const up = shiftMarkPlan(entities, 3, 1);
  assert.deepEqual(up.map(c => c.attributes.mark), ['WD4', 'WD5', 'WD6', 'WD7']);
  const down = shiftMarkPlan(entities, 4, -1);
  assert.deepEqual(down.map(c => c.attributes.mark), ['WD3', 'WD4', 'WD5']);
});

/* ── BAK ── */
test('timestampLabel formats year.monthday.hourminute with zero padding', () => {
  assert.equal(timestampLabel(new Date(2020, 10, 6, 9, 59)), '2020.1106.0959');
});

/* ── PUA ── */
test('emptyTextIds and pointEntityIds find blank text and point entities only', () => {
  const entities = [
    { id: 'a', type: 'text', text: '  ' },
    { id: 'b', type: 'text', text: '내용' },
    { id: 'c', type: 'point' },
    { id: 'd', type: 'line' },
  ];
  assert.deepEqual(emptyTextIds(entities), ['a']);
  assert.deepEqual(pointEntityIds(entities), ['c']);
});
test('unusedLayerIds keeps layer "0" and locked layers, and scans nested block entities', () => {
  const layers = [{ id: 'L0', name: '0' }, { id: 'L1', name: 'A-WALL' }, { id: 'L2', name: 'UNUSED' }, { id: 'L3', name: 'LOCKED', locked: true }];
  const entities = [{ type: 'line', layer: 'L1' }, { type: 'block', layer: 'L1', entities: [{ type: 'line', layer: 'L3' }] }];
  assert.deepEqual(unusedLayerIds(entities, layers), ['L2']);
});

/* ── SVS ── */
test('isAxisAlignedQuad accepts closed axis-aligned rectangles only', () => {
  assert.ok(isAxisAlignedQuad({ type: 'rectangle', points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }] }));
  assert.ok(!isAxisAlignedQuad({ type: 'polyline', closed: false, points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }] }));
  assert.ok(!isAxisAlignedQuad({ type: 'polyline', closed: true, points: [{ x: 0, y: 0 }, { x: 10, y: 5 }, { x: 10, y: 10 }, { x: 0, y: 10 }] }));
});
test('quadCandidates only returns quads on the requested layer', () => {
  const rect = (layer) => ({ type: 'rectangle', layer, points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }] });
  const entities = [rect('PB'), rect('OTHER')];
  assert.equal(quadCandidates(entities, 'PB').length, 1);
});
test('blockWorldBounds uses the block children as drawing coordinates (2026-09-24: no double offset)', () => {
  // 바른 CAD 블록 자식은 이미 도면 좌표다(geometry.js primitives 가 변환 없이 그린다) — 삽입점을 다시 더하지 않는다.
  const block = { position: { x: 100, y: 200 }, entities: [{ type: 'line', points: [{ x: 100, y: 200 }, { x: 110, y: 205 }] }] };
  assert.deepEqual(blockWorldBounds(block), { minX: 100, minY: 200, maxX: 110, maxY: 205 });
  assert.equal(blockWorldBounds({ position: { x: 0, y: 0 }, entities: [] }), null);
});
test('attributeCandidates keeps only blocks carrying the number tag', () => {
  const entities = [
    { type: 'block', position: { x: 0, y: 0 }, entities: [{ type: 'line', points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] }], attributes: { NUMBER: 'A-101', NAME: '평면도' } },
    { type: 'block', position: { x: 0, y: 0 }, entities: [], attributes: {} },
  ];
  const out = attributeCandidates(entities, 'NAME', 'NUMBER');
  assert.equal(out.length, 1);
  assert.equal(out[0].number, 'A-101');
  assert.equal(out[0].title, '평면도');
});
test('textsInsideBox collects and sorts text entities within the box, top-to-bottom then left-to-right', () => {
  const entities = [
    { type: 'text', text: 'bottom', position: { x: 0, y: 0 } },
    { type: 'text', text: 'top', position: { x: 5, y: 10 } },
    { type: 'text', text: 'outside', position: { x: 100, y: 100 } },
    { type: 'text', text: '  ', position: { x: 1, y: 1 } },
  ];
  assert.deepEqual(textsInsideBox(entities, { minX: 0, minY: 0, maxX: 10, maxY: 10 }), ['top', 'bottom']);
});
test('autoSheetNumbers pads sequential numbers with the given prefix and digit count', () => {
  assert.deepEqual(autoSheetNumbers(3), ['A-001', 'A-002', 'A-003']);
  assert.deepEqual(autoSheetNumbers(2, 'P-', 5, 2), ['P-05', 'P-06']);
});

/* ── SOL ── */
test('entityContainingPoint finds the smallest enclosing closed boundary', () => {
  const big = { type: 'circle', center: { x: 0, y: 0 }, radius: 100 };
  const small = { type: 'polyline', closed: true, points: [{ x: -10, y: -10 }, { x: 10, y: -10 }, { x: 10, y: 10 }, { x: -10, y: 10 }] };
  assert.equal(entityContainingPoint([big, small], { x: 0, y: 0 }), small);
  assert.equal(entityContainingPoint([big], { x: 200, y: 200 }), null);
});
test('solidHatchBoundaryPoints approximates a circle and passes through polygon points', () => {
  const circlePts = solidHatchBoundaryPoints({ type: 'circle', center: { x: 0, y: 0 }, radius: 5 });
  assert.equal(circlePts.length, 24);
  const poly = { type: 'polyline', points: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }] };
  assert.equal(solidHatchBoundaryPoints(poly), poly.points);
  assert.throws(() => solidHatchBoundaryPoints({ type: 'polyline', points: [{ x: 0, y: 0 }] }));
});

/* ── LSC ── */
test('computeLinetypeScales applies an absolute value or multiplies the existing scale', () => {
  const entities = [{ id: 'a', linetypeScale: 2 }, { id: 'b' }];
  assert.deepEqual(computeLinetypeScales(entities, 'absolute', 3), [{ id: 'a', linetypeScale: 3 }, { id: 'b', linetypeScale: 3 }]);
  assert.deepEqual(computeLinetypeScales(entities, 'multiply', 2), [{ id: 'a', linetypeScale: 4 }, { id: 'b', linetypeScale: 2 }]);
  assert.throws(() => computeLinetypeScales(entities, 'absolute', 0));
});

/* ── COM ── */
test('findDuplicateShortcut finds another key mapped to the same command, excluding the given key', () => {
  const map = { A1: { command: 'LINE' }, A2: { command: 'LINE' }, A3: { command: 'CIRCLE' } };
  assert.equal(findDuplicateShortcut(map, 'LINE', 'A2'), 'A1');
  assert.equal(findDuplicateShortcut(map, 'CIRCLE', 'A3'), null);
});

/* ── CT ── */
test('copyContentChanges copies type-specific content and optional layer/style', () => {
  const textSrc = { type: 'text', text: 'hello', layer: 'L1', color: '#fff', linetype: 'DASHED' };
  const textDst = { type: 'text', text: 'old' };
  assert.deepEqual(copyContentChanges(textSrc, textDst), { text: 'hello' });
  assert.deepEqual(copyContentChanges(textSrc, textDst, { layer: true, style: true }), { text: 'hello', layer: 'L1', color: '#fff', linetype: 'DASHED' });

  const lineSrc = { type: 'line', points: [{ x: 0, y: 0 }, { x: 10, y: 0 }] };
  const lineDst = { type: 'line', points: [{ x: 5, y: 5 }, { x: 5, y: 15 }] };
  const changes = copyContentChanges(lineSrc, lineDst);
  assert.equal(Math.round(Math.hypot(changes.points[1].x - changes.points[0].x, changes.points[1].y - changes.points[0].y)), 10);

  const circleSrc = { type: 'circle', radius: 50 }, circleDst = { type: 'circle', radius: 10 };
  assert.deepEqual(copyContentChanges(circleSrc, circleDst), { radius: 50 });

  assert.deepEqual(copyContentChanges({ type: 'text' }, { type: 'circle' }), {});
  assert.throws(() => copyContentChanges(null, { type: 'text' }));
});

// 실제 자동 실행 트랜잭션: 종료 null 없이 찍은 기호가 다음 MCP 호출까지 남는다.
test('WSL scripted 3점 넣기 → 별도 집계, 무관 선택 fallback과 한 번 undo', async () => {
  const {DrawingEngine}=await import('./engine.js');
  const {runScripted}=await import('./command-runner.js');
  const engine=new DrawingEngine(), before=structuredClone(engine.doc);
  const inserted=await runScripted(engine,'WSL',{form:{mode:'insert'},points:[[0,0],[2000,0],[4000,0]]});
  assert.equal(inserted.added.length,3);
  assert.equal(engine.doc.entities.filter(e=>e.category==='XI_WSL').length,3);
  const line=engine.execute({type:'add',entity:{type:'line',layer:engine.doc.layers[0].id,points:[{x:0,y:100},{x:5000,y:100}]}})[0];
  const prior=structuredClone(engine.doc), undo=engine.undoStack.length;
  const listed=await runScripted(engine,'WSL',{form:{mode:'list'},selection:[line],points:[[10000,0]]});
  assert.equal(listed.added.length,3);
  assert.deepEqual(engine.doc.entities.filter(e=>listed.added.includes(e.id)).map(e=>e.text),['W1 : 1개','W2 : 1개','W3 : 1개']);
  assert.equal(engine.undoStack.length,undo+1);
  engine.execute({type:'undo'});assert.deepEqual(engine.doc,prior);
  engine.execute({type:'undo'});engine.execute({type:'undo'});assert.deepEqual(engine.doc,before);
});

test('WSL scripted 점 누락은 NeedInput과 원본 보존', async () => {
  const {DrawingEngine}=await import('./engine.js');
  const {runScripted,NeedInput}=await import('./command-runner.js');
  const engine=new DrawingEngine(),before=structuredClone(engine.doc);
  await assert.rejects(runScripted(engine,'WSL',{form:{mode:'insert'}}),NeedInput);
  assert.deepEqual(engine.doc,before);
});
