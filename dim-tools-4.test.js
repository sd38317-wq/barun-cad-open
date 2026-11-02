// 4차 dim-tools-4 시험. DOM 없이 export 된 순수 함수만 검증한다(8절).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {dimensionPreview} from './dimension-preview.js';
import {
  snapAngleStep, snappedLeaderEnd, buildAutoLeaderEntities,
  continueDimension, oneByOneDimension, aboveBelowDimension,
  arrangeDimensionGaps,
  unifyExtensionLength,
  orthoProjectionDims, boundingBoxDims, vertexDistanceDims, totalLengthPath,
  representativePoint, quickDimPoints, quickDimChain, quickDimTotal,
  dimScaleFromSize, dimScaleFromBlock,
  dimStylesInUse, mergeDimStylePlan,
  absoluteDimScale, multipleDimScale,
  splitDimensionAtParams, splitDimensionEqual, nearestEqualCount, splitDimensionByNearestLength, mergeDimensions,
} from './dim-tools-4.js';

const p = (x, y) => ({ x, y });
const linDim = (a, b, off, extra = {}) => ({ id: 'd1', type: 'dimension', mode: 'horizontal', points: [a, b, off], textHeight: 150, ...extra });
const alignedDim = (a, b, off, extra = {}) => ({ id: 'd1', type: 'dimension', mode: 'aligned', points: [a, b, off], textHeight: 150, ...extra });

/* ── LX ── */
test('LX · snapAngleStep은 15도 단위로 반올림한다', () => {
  assert.equal(snapAngleStep(7), 0);
  assert.equal(snapAngleStep(8), 15);
  assert.equal(snapAngleStep(41), 45);
});
test('LX · snappedLeaderEnd는 거리를 유지하며 각도만 스냅한다', () => {
  const a = p(0, 0), b = p(1000, 80); // 각도 약 4.57도 → 0도로 스냅
  const snapped = snappedLeaderEnd(a, b, 15);
  assert.ok(Math.abs(snapped.y) < 1e-6);
  assert.ok(Math.abs(snapped.x - Math.hypot(1000, 80)) < 1e-6);
});
test('LX · buildAutoLeaderEntities는 끝단 형태별로 선·머리·문자를 만든다', () => {
  const a = p(0, 0), b = p(1000, 0);
  const dot = buildAutoLeaderEntities(a, b, '마감재', { endShape: 'dot', textHeight: 150 });
  assert.equal(dot.head.type, 'circle');
  assert.equal(dot.text.text, '마감재');
  const arrow = buildAutoLeaderEntities(a, b, 'X', { endShape: 'arrow' });
  assert.equal(arrow.head.type, 'polyline');
  assert.throws(() => buildAutoLeaderEntities(a, b, ''), /지시선 문자/);
  assert.throws(() => buildAutoLeaderEntities(a, a, 'X'), /같습니다/);
});

/* ── CC ── */
test('CC · continueDimension은 같은 오프셋으로 이어 그린다(합계치수 모드)', () => {
  const dim = linDim(p(0, 0), p(1000, 0), p(500, 300));
  const next = continueDimension(dim, p(2000, 0), { offsetMode: 'same' });
  assert.deepEqual(next.points, [p(1000, 0), p(2000, 0), p(500, 300)]);
  assert.equal(next.textHeight, 150);
});
test('CC · continueDimension value 모드는 기존 오프셋에서 값만큼 더 밀어낸다(계단치수)', () => {
  const dim = linDim(p(0, 0), p(1000, 0), p(0, 300)); // p.y=300, 위쪽
  const next = continueDimension(dim, p(2000, 0), { offsetMode: 'value', offsetValue: 100 });
  assert.equal(next.points[2].y, 400);
});
test('CC · oneByOneDimension은 참조 치수의 오프셋 거리를 새 두 점에 적용한다', () => {
  const ref = linDim(p(0, 0), p(1000, 0), p(0, 300));
  const dim = oneByOneDimension(ref, p(0, 1000), p(1000, 1000));
  assert.equal(dim.points[2].y, 1300);
});
test('CC · aboveBelowDimension은 클릭 쪽으로 기존 치수와 같은 모양을 만든다', () => {
  const ref = linDim(p(0, 0), p(1000, 0), p(0, 300));
  const above = aboveBelowDimension(ref, p(500, 1000), 200);
  assert.equal(above.points[2].y, 500);
  const below = aboveBelowDimension(ref, p(500, -1000), 200);
  assert.equal(below.points[2].y, 100);
  assert.throws(() => aboveBelowDimension(ref, p(0, 0), -1), /양수/);
});

/* ── DG ── */
test('DG · arrangeDimensionGaps는 기준점 오프셋에서 gap씩 순서대로 재배치한다', () => {
  const d1 = linDim(p(0, 0), p(1000, 0), p(0, 900), { id: 'a' });
  const d2 = linDim(p(0, 0), p(1000, 0), p(0, 100), { id: 'b' });
  const results = arrangeDimensionGaps([d1, d2], p(0, 0), 200);
  // d2(오프셋100)가 더 작으므로 기준점부터 첫 줄(0), d1이 다음 줄(200)
  assert.equal(results[1].points[2].y, 0);
  assert.equal(results[0].points[2].y, 200);
});
test('DG · oneLine 옵션은 모두 같은 오프셋으로 모은다', () => {
  const d1 = linDim(p(0, 0), p(1000, 0), p(0, 900), { id: 'a' });
  const d2 = linDim(p(0, 0), p(1000, 0), p(0, 100), { id: 'b' });
  const results = arrangeDimensionGaps([d1, d2], p(0, 500), 200, { oneLine: true });
  assert.equal(results[0].points[2].y, 500);
  assert.equal(results[1].points[2].y, 500);
});
test('DG · 평행하지 않은 치수는 거부한다', () => {
  const d1 = linDim(p(0, 0), p(1000, 0), p(0, 900), { id: 'a' });
  const d2 = { id: 'b', type: 'dimension', mode: 'vertical', points: [p(0, 0), p(0, 1000), p(100, 0)] };
  assert.throws(() => arrangeDimensionGaps([d1, d2], p(0, 0), 200), /평행/);
});

/* ── DLL ── */
test('DLL · unifyExtensionLength는 보조선 돌출 길이를 지정값으로 바꾼다', () => {
  const dim = linDim(p(0, 0), p(1000, 0), p(0, 300));
  const changes = unifyExtensionLength(dim, 250);
  assert.deepEqual(changes, { extensionOvershoot: 250 });
  assert.throws(() => unifyExtensionLength(dim, -1), /0 이상/);
});

/* ── DPL ── */
test('DPL · orthoProjectionDims는 서로 다른 x·y 좌표마다 체인 치수를 만든다', () => {
  const pts = [p(0, 0), p(1000, 0), p(1000, 500), p(0, 500)]; // 사각형
  const dims = orthoProjectionDims(pts, { offsetX: 200, offsetY: 200 });
  const horiz = dims.filter((d) => d.mode === 'horizontal'), vert = dims.filter((d) => d.mode === 'vertical');
  assert.equal(horiz.length, 1); // x: 0,1000 → 1개
  assert.equal(vert.length, 1); // y: 0,500 → 1개
});
test('DPL · boundingBoxDims는 폭·높이 치수 2개를 만든다', () => {
  const dims = boundingBoxDims({ minX: 0, minY: 0, maxX: 2000, maxY: 3000 }, { offset: 300 });
  assert.equal(dims.length, 2);
  assert.equal(dims[0].mode, 'horizontal');
  assert.equal(dims[1].mode, 'vertical');
});
test('DPL · vertexDistanceDims는 열린 폴리선의 구간마다 정렬 치수를 만든다', () => {
  const pts = [p(0, 0), p(1000, 0), p(1000, 1000)];
  const dims = vertexDistanceDims(pts, false, { offset: 100 });
  assert.equal(dims.length, 2);
  assert.equal(dims.every((d) => d.mode === 'aligned'), true);
});
test('DPL · vertexDistanceDims는 닫힌 폴리선이면 마지막 구간도 만든다', () => {
  const pts = [p(0, 0), p(1000, 0), p(1000, 1000)];
  const dims = vertexDistanceDims(pts, true, { offset: 100 });
  assert.equal(dims.length, 3);
});
test('DPL · totalLengthPath는 전체 길이를 라벨에 담는다', () => {
  const pts = [p(0, 0), p(3000, 0), p(3000, 4000)];
  const r = totalLengthPath(pts, false, { textHeight: 150 });
  assert.equal(r.total, 7000);
  assert.equal(r.label.text, '7000');
});

/* ── DQ ── */
test('DQ · representativePoint는 타입별 대표점을 낸다', () => {
  assert.equal(representativePoint({ type: 'line', points: [p(0, 0), p(1, 1)] }).length, 2);
  assert.equal(representativePoint({ type: 'block', position: p(5, 5) })[0].x, 5);
  assert.equal(representativePoint({ type: 'circle', center: p(0, 0), radius: 100 }).length, 4);
});
test('DQ · quickDimPoints는 좌표를 정렬·중복제거한다', () => {
  const es = [
    { type: 'line', points: [p(0, 0), p(0, 100)] },
    { type: 'block', position: p(1000, 0) },
    { type: 'block', position: p(500, 0) },
  ];
  const pts = quickDimPoints(es, 'horizontal');
  assert.deepEqual(pts.map((q) => q.x), [0, 500, 1000]);
});
test('DQ · quickDimChain·quickDimTotal은 체인과 합계 치수를 만든다', () => {
  const pts = [p(0, 0), p(500, 0), p(1000, 0)];
  const chain = quickDimChain(pts, 'horizontal', p(0, 300));
  assert.equal(chain.length, 2);
  const total = quickDimTotal(pts, 'horizontal', p(0, 600));
  assert.deepEqual(total.points, [p(0, 0), p(1000, 0), p(0, 600)]);
});

/* ── DSC ── */
test('DSC · dimScaleFromSize는 실제 도곽 크기 대비 배율을 계산한다', () => {
  assert.equal(dimScaleFromSize(42000, 420), 100);
  assert.throws(() => dimScaleFromSize(0, 420), /양수/);
});
test('DSC · dimScaleFromBlock은 블록의 삽입 축척을 읽는다', () => {
  assert.equal(dimScaleFromBlock({ type: 'block', scale: 50 }), 50);
  assert.equal(dimScaleFromBlock({ type: 'block' }), 1);
  assert.throws(() => dimScaleFromBlock({ type: 'line' }), /블록/);
});

/* ── DSM ── */
test('DSM · dimStylesInUse는 최상위·블록 내부 치수의 스타일 이름을 모은다', () => {
  const entities = [
    { type: 'dimension', dimStyle: 'A' },
    { type: 'block', entities: [{ type: 'dimension', dimStyle: 'B' }] },
  ];
  assert.deepEqual(dimStylesInUse(entities), ['A', 'B']);
});
test('DSM · mergeDimStylePlan은 원본 이름의 치수를 대상 이름·값으로 바꾼다', () => {
  const entities = [
    { id: 'x1', type: 'dimension', dimStyle: 'OLD', textHeight: 100 },
    { id: 'x2', type: 'dimension', dimStyle: 'NEW', textHeight: 250, arrowSize: 90 },
    { id: 'x3', type: 'dimension', dimStyle: 'OTHER', textHeight: 100 },
  ];
  const plan = mergeDimStylePlan(entities, ['OLD'], 'NEW');
  assert.equal(plan.count, 1);
  assert.equal(plan.updates[0].id, 'x1');
  assert.equal(plan.updates[0].changes.textHeight, 250);
  assert.equal(plan.updates[0].changes.dimStyle, 'NEW');
});
test('DSM · 블록 내부 치수도 includeBlocks 로 합쳐진다', () => {
  const entities = [
    { id: 'b1', type: 'block', entities: [{ type: 'dimension', dimStyle: 'OLD', textHeight: 100 }] },
    { id: 'x2', type: 'dimension', dimStyle: 'NEW', textHeight: 250 },
  ];
  const plan = mergeDimStylePlan(entities, ['OLD'], 'NEW', { includeBlocks: true });
  assert.equal(plan.count, 1);
  assert.equal(plan.blockUpdates.length, 1);
  assert.equal(plan.blockUpdates[0].entities[0].dimStyle, 'NEW');
});
test('DSM · 대상 이름을 쓰는 치수가 없으면 거부한다', () => {
  assert.throws(() => mergeDimStylePlan([{ type: 'dimension', dimStyle: 'A' }], ['A'], 'NEW'), /찾을 수 없습니다/);
});

/* ── ED ── */
test('ED · absoluteDimScale·multipleDimScale', () => {
  assert.equal(absoluteDimScale(100), 100);
  assert.equal(multipleDimScale(100, 2), 200);
  assert.throws(() => absoluteDimScale(0), /양수/);
  assert.throws(() => multipleDimScale(0, 2), /축척/);
});

/* ── SD ── */
test('SD · nearestEqualCount는 원문 예시와 같은 사사오입 결과를 낸다', () => {
  assert.equal(nearestEqualCount(6000, 900), 7); // 6.67 → 7
  assert.equal(nearestEqualCount(3611, 900), 4); // 4.01 → 4
});
test('SD · splitDimensionEqual은 N등분 치수를 만든다', () => {
  const dim = linDim(p(0, 0), p(900, 0), p(0, 300));
  const parts = splitDimensionEqual(dim, 3);
  assert.equal(parts.length, 3);
  assert.equal(parts[0].points[0].x, 0);
  assert.equal(parts[0].points[1].x, 300);
  assert.equal(parts[2].points[1].x, 900);
  assert.equal(parts.every((d) => d.points[2].y === 300), true);
});
test('SD · splitDimensionAtParams는 지정한 비율로 나눈다', () => {
  const dim = linDim(p(0, 0), p(1000, 0), p(0, 300));
  const parts = splitDimensionAtParams(dim, [0.25, 0.75]);
  assert.equal(parts.length, 3);
  assert.equal(parts[0].points[1].x, 250);
  assert.equal(parts[1].points[1].x, 750);
});
test('SD · splitDimensionByNearestLength는 근접길이로 등분수를 정한다', () => {
  const dim = linDim(p(0, 0), p(6000, 0), p(0, 300));
  const parts = splitDimensionByNearestLength(dim, 900);
  assert.equal(parts.length, 7);
});
test('SD · mergeDimensions는 평행한 치수들을 최외곽 두 점으로 합친다', () => {
  const d1 = linDim(p(0, 0), p(1000, 0), p(0, 300), { id: 'a' });
  const d2 = linDim(p(1000, 0), p(2500, 0), p(0, 300), { id: 'b' });
  const merged = mergeDimensions([d1, d2]);
  assert.deepEqual(merged.points[0], p(0, 0));
  assert.deepEqual(merged.points[1], p(2500, 0));
});
test('SD · 서로 다른 모드는 합칠 수 없다', () => {
  const d1 = linDim(p(0, 0), p(1000, 0), p(0, 300), { id: 'a' });
  const d2 = alignedDim(p(0, 0), p(1000, 500), p(0, 300), { id: 'b' });
  assert.throws(() => mergeDimensions([d1, d2]), /같은 방향/);
});


// Interactive preview contract: hover is temporary and must match the committed builder.
test('preview contract · CC/DQ dimension entities equal final geometry without document mutation', () => {
  const source = linDim(p(0, 0), p(1000, 0), p(0, 300));
  const cursor = p(2000, 0);
  const before = JSON.stringify(source);
  const cb = dimensionPreview((point) => [continueDimension(source, point, {offsetMode: 'same'})]);
  const preview = cb([], cursor);
  const committed = continueDimension(source, cursor, {offsetMode: 'same'});
  assert.deepEqual(preview[0], committed);
  assert.equal(JSON.stringify(source), before);
  const points = [p(0, 0), p(1000, 0), p(2000, 0)];
  const dcb = dimensionPreview((point) => quickDimChain(points, 'horizontal', point, {textHeight: 150}));
  const hover = dcb([], p(0, 500));
  assert.equal(hover.length, 2);
  assert.deepEqual(hover, quickDimChain(points, 'horizontal', p(0, 500), {textHeight: 150}));
});
