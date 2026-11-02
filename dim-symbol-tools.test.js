// node --test dim-symbol-tools.test.js
// 3차 병렬 작업: DOM 없이 동작하는 순수 함수만 시험한다(install 안의 pick/dialog 는 시험 대상이 아니다).
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {dimensionPreview} from './dimension-preview.js';
import * as G from './geometry.js';
import {
  restyleLeaderBlock, nearestPointOnBox, buildTextLeaderEntities,
  projectDimensionExtensionStarts, classifyDimTextClick, moveDimensionTextDirection, resolveLabelOverlaps,
  auxTextPosition, formatAuxDistance,
  buildCutSymbolPolyline,
  downMarkSide, buildDownMarkEntities,
  nextIncrementValue, buildDirectionSymbolEntities,
  flowArrowPlacements,
  arcToCircleEntity,
  rectangleFrom3Points,
  incircleOfThreeLines,
  restoreDimensionTextPosition,
  refreshDimensionStyle,
  intersectionDimensionPoints,
  buildSolidBoxEntities,
} from './dim-symbol-tools.js';

const close = (p, q, eps = 1e-6) => {assert.ok(Math.abs(p.x - q.x) < eps && Math.abs(p.y - q.y) < eps, `${JSON.stringify(p)} != ${JSON.stringify(q)}`);};

/* LSE */
test('restyleLeaderBlock: 원형 화살표 + 옆 문자위치', () => {
  const block = {entities: [
    {type: 'line', points: [{x: 0, y: 0}, {x: 100, y: 0}], layer: 'L1'},
    {type: 'polyline', points: [{x: 0, y: 0}, {x: 10, y: 5}], closed: false, layer: 'L1'},
    {type: 'text', position: {x: 100, y: 0}, text: '내용', height: 100, layer: 'L1'},
  ]};
  const {entities} = restyleLeaderBlock(block, {shape: 'circle', textPos: 'side', arrowScale: 1});
  const head = entities[1];
  assert.equal(head.type, 'circle');
  close(head.center, {x: 0, y: 0});
  assert.ok(Math.abs(head.radius - 28) < 1e-6);
  close(entities[2].position, {x: 100, y: 0});
});

test('restyleLeaderBlock: 파형 화살표 + 위 문자위치', () => {
  const block = {entities: [
    {type: 'line', points: [{x: 0, y: 0}, {x: 100, y: 0}], layer: 'L1'},
    {type: 'polyline', points: [{x: 0, y: 0}, {x: 10, y: 5}], closed: false, layer: 'L1'},
    {type: 'text', position: {x: 100, y: 0}, text: '내용', height: 100, layer: 'L1'},
  ]};
  const {entities} = restyleLeaderBlock(block, {shape: 'wave', textPos: 'above', arrowScale: 1});
  assert.equal(entities[1].type, 'polyline');
  assert.equal(entities[1].points.length, 4);
  close(entities[1].points[0], {x: 0, y: 0});
  close(entities[1].points[3], {x: 80, y: 0});
  close(entities[2].position, {x: 100, y: 90});
});

test('restyleLeaderBlock: 블록 구조가 아니면 오류', () => {
  assert.throws(() => restyleLeaderBlock({entities: [{type: 'line', points: [{x: 0, y: 0}, {x: 1, y: 0}]}]}));
});

/* TL */
test('nearestPointOnBox: 경계 안으로 clamp', () => {
  const box = {minX: 0, minY: 0, maxX: 100, maxY: 50};
  close(nearestPointOnBox(box, {x: 150, y: 20}), {x: 100, y: 20});
  close(nearestPointOnBox(box, {x: -10, y: 70}), {x: 0, y: 50});
});

test('buildTextLeaderEntities: 문자 경계에서 지정점으로 지시선', () => {
  const box = {minX: 0, minY: 0, maxX: 100, maxY: 50};
  const [line, arrow] = buildTextLeaderEntities(box, {x: 150, y: 20}, 40);
  close(line.points[0], {x: 150, y: 20});
  close(line.points[1], {x: 100, y: 20});
  assert.equal(arrow.points.length, 3);
  close(arrow.points[1], {x: 150, y: 20});
});

/* DLA */
test('projectDimensionExtensionStarts: 수평 기준선에 보조선 시작점 투영', () => {
  const dim = {mode: 'horizontal', points: [{x: 0, y: 0}, {x: 100, y: 0}, {x: 50, y: 50}]};
  const [a, b, p] = projectDimensionExtensionStarts(dim, {x: 0, y: 10}, {x: 100, y: 10});
  close(a, {x: 0, y: 10});
  close(b, {x: 100, y: 10});
  close(p, {x: 50, y: 50});
});
test('projectDimensionExtensionStarts: 각도 치수는 거부', () => {
  assert.throws(() => projectDimensionExtensionStarts({mode: 'angular', points: [{x: 0, y: 0}, {x: 1, y: 0}, {x: 0, y: 1}, {x: 1, y: 1}]}, {x: 0, y: 0}, {x: 1, y: 0}));
});

/* DTM */
const dtmDim = {mode: 'horizontal', points: [{x: 0, y: 0}, {x: 100, y: 0}, {x: 50, y: 100}], textHeight: 150};
test('classifyDimTextClick: 좌/우/아래 판정', () => {
  assert.equal(classifyDimTextClick(dtmDim, {x: 50, y: 95}), 'down');
  assert.equal(classifyDimTextClick(dtmDim, {x: -100, y: 145}), 'left');
  assert.equal(classifyDimTextClick(dtmDim, {x: 200, y: 145}), 'right');
});
test('moveDimensionTextDirection: 방향·거리만큼 문자 위치 이동', () => {
  close(moveDimensionTextDirection(dtmDim, 'left', 30), {x: 20, y: 145});
  close(moveDimensionTextDirection(dtmDim, 'right', 30), {x: 80, y: 145});
  close(moveDimensionTextDirection(dtmDim, 'down', 30), {x: 50, y: 115});
});
test('resolveLabelOverlaps: 겹치는 위치를 최소 간격으로 밀어냄', () => {
  assert.deepEqual(resolveLabelOverlaps([0, 1, 1.2, 5], 2), [0, 2, 4, 6]);
  assert.deepEqual(resolveLabelOverlaps([0, 10, 20], 2), [0, 10, 20]);
});

/* DTO */
test('auxTextPosition: 치수 문자 아래 간격만큼', () => {
  close(auxTextPosition(dtmDim, 200), {x: 50, y: -55});
});
test('formatAuxDistance: 거리 측정 문자열', () => {
  assert.equal(formatAuxDistance({x: 0, y: 0}, {x: 3, y: 4}, {suffix: 'mm'}), '5mm');
});

/* CSL */
test('buildCutSymbolPolyline: 지그재그 절단기호 좌표', () => {
  const pts = buildCutSymbolPolyline({x: 0, y: 0}, {x: 1000, y: 0}, {symbolSize: 200, extend: 100, count: 1});
  assert.equal(pts.length, 6);
  close(pts[0], {x: -100, y: 0});
  close(pts[1], {x: 420, y: 0});
  close(pts[2], {x: 476, y: 100});
  close(pts[3], {x: 524, y: -100});
  close(pts[4], {x: 580, y: 0});
  close(pts[5], {x: 1100, y: 0});
});

/* DDM */
test('downMarkSide: 수평선 위/아래, 수직선 왼쪽/오른쪽', () => {
  assert.equal(downMarkSide({x: 0, y: 0}, {x: 100, y: 0}, {x: 50, y: 10}), 'up');
  assert.equal(downMarkSide({x: 0, y: 0}, {x: 100, y: 0}, {x: 50, y: -10}), 'down');
  assert.equal(downMarkSide({x: 0, y: 0}, {x: 0, y: 100}, {x: -10, y: 50}), 'up');
  assert.equal(downMarkSide({x: 0, y: 0}, {x: 0, y: 100}, {x: 10, y: 50}), 'down');
});
test('buildDownMarkEntities: 삼각형·문자 좌표', () => {
  const {triangle, text} = buildDownMarkEntities({x: 0, y: 0}, {x: 100, y: 0}, 'up', {length: 100, label: 'FL ±0', textHeight: 50});
  close(triangle.points[0], {x: 20, y: 0});
  close(triangle.points[1], {x: 80, y: 0});
  close(triangle.points[2], {x: 50, y: 100});
  close(text.position, {x: 50, y: 125});
  assert.equal(text.text, 'FL ±0');
});

/* ESS */
test('nextIncrementValue: 숫자·알파벳 자동 증가', () => {
  assert.equal(nextIncrementValue('3'), '4');
  assert.equal(nextIncrementValue('A'), 'B');
  assert.equal(nextIncrementValue('y'), 'z');
  assert.throws(() => nextIncrementValue('A1'));
});
test('buildDirectionSymbolEntities: 원+화살표+문자 좌표', () => {
  const {circle, arrow, text} = buildDirectionSymbolEntities({x: 0, y: 0}, {x: 0, y: 100}, 'A1', {radius: 100, textHeight: 50});
  close(circle.center, {x: 0, y: 0});
  assert.equal(circle.radius, 100);
  close(arrow.points[0], {x: 0, y: 160});
  close(arrow.points[1], {x: -35, y: 100});
  close(arrow.points[2], {x: 35, y: 100});
  assert.equal(text.text, 'A1');
});

/* WU */
test('flowArrowPlacements: 직선 경로 위 등간격 화살표', () => {
  const marks = flowArrowPlacements([{x: 0, y: 0}, {x: 2000, y: 0}], {spacing: 1000, size: 200});
  assert.equal(marks.length, 2);
  close(marks[0].points[0], {x: 600, y: 0});
  close(marks[0].points[1], {x: 400, y: 60});
  close(marks[0].points[2], {x: 400, y: -60});
  close(marks[1].points[0], {x: 1600, y: 0});
});

/* ATC */
test('arcToCircleEntity: 같은 중심·반지름의 원', () => {
  const circle = arcToCircleEntity({type: 'arc', center: {x: 5, y: 5}, radius: 10, startAngle: 0, endAngle: 90});
  assert.equal(circle.type, 'circle');
  close(circle.center, {x: 5, y: 5});
  assert.equal(circle.radius, 10);
});
test('arcToCircleEntity: 호가 아니면 오류', () => {
  assert.throws(() => arcToCircleEntity({type: 'circle', center: {x: 0, y: 0}, radius: 1}));
});

/* R3 */
test('rectangleFrom3Points: 축 평행', () => {
  const pts = rectangleFrom3Points({x: 0, y: 0}, {x: 100, y: 0}, {x: 50, y: 50});
  close(pts[0], {x: 0, y: 0}); close(pts[1], {x: 100, y: 0}); close(pts[2], {x: 100, y: 50}); close(pts[3], {x: 0, y: 50});
});
test('rectangleFrom3Points: 회전된 사각형', () => {
  const pts = rectangleFrom3Points({x: 0, y: 0}, {x: 0, y: 100}, {x: -50, y: 50});
  close(pts[0], {x: 0, y: 0}); close(pts[1], {x: 0, y: 100}); close(pts[2], {x: -50, y: 100}); close(pts[3], {x: -50, y: 0});
});
test('rectangleFrom3Points: 폭 0이면 오류', () => {
  assert.throws(() => rectangleFrom3Points({x: 0, y: 0}, {x: 100, y: 0}, {x: 50, y: 0}));
});

/* OTC */
test('incircleOfThreeLines: 3-4-5 직각삼각형의 내접원', () => {
  const l1 = {a: {x: 0, y: 0}, b: {x: 4, y: 0}};
  const l2 = {a: {x: 4, y: 0}, b: {x: 0, y: 3}};
  const l3 = {a: {x: 0, y: 3}, b: {x: 0, y: 0}};
  const {center, radius} = incircleOfThreeLines(l1, l2, l3);
  close(center, {x: 1, y: 1}, 1e-6);
  assert.ok(Math.abs(radius - 1) < 1e-6);
});
test('incircleOfThreeLines: 평행선이면 오류', () => {
  const l1 = {a: {x: 0, y: 0}, b: {x: 10, y: 0}};
  const l2 = {a: {x: 0, y: 5}, b: {x: 10, y: 5}};
  const l3 = {a: {x: 0, y: 0}, b: {x: 0, y: 5}};
  assert.throws(() => incircleOfThreeLines(l1, l2, l3));
});

/* DH */
test('restoreDimensionTextPosition: textPosition 을 지운다', () => {
  // 2026-09-24: null 은 engine.js 검증(좌표 오류)에 걸려 DH 가 항상 실패했다 — undefined 로 "지정 안 함"을 만든다.
  assert.deepEqual(restoreDimensionTextPosition({type: 'dimension', textPosition: {x: 1, y: 2}}), {textPosition: undefined});
  assert.throws(() => restoreDimensionTextPosition({type: 'dimension', textPosition: null}));
});

/* DU */
test('refreshDimensionStyle: 재정의 문자를 지우고 설정값 적용', () => {
  const defaults = {textHeight: 120, extensionOffset: 5, extensionOvershoot: 80, textGap: 60, arrowSize: 90};
  const changes = refreshDimensionStyle({type: 'dimension'}, defaults);
  assert.deepEqual(changes, {text: '', textTemplate: '', textPosition: undefined, ...defaults});
});

/* IL */
test('intersectionDimensionPoints: 기준선과 두 선의 교차점 사이 길이', () => {
  const {p1, p2, length} = intersectionDimensionPoints(
    {x: 5, y: -10}, {x: 5, y: 10},
    {a: {x: 0, y: 0}, b: {x: 10, y: 0}},
    {a: {x: 0, y: 100}, b: {x: 10, y: 100}},
  );
  close(p1, {x: 5, y: 0});
  close(p2, {x: 5, y: 100});
  assert.equal(length, 100);
});

/* RS */
test('buildSolidBoxEntities: 외곽선 + solid 해치', () => {
  const {outline, fill} = buildSolidBoxEntities({x: 0, y: 0}, {x: 100, y: 50});
  assert.equal(outline.type, 'polyline');
  assert.equal(outline.closed, true);
  assert.equal(outline.points.length, 4);
  close(outline.points[2], {x: 100, y: 50});
  assert.equal(fill.type, 'hatch');
  assert.equal(fill.solid, true);
});
test('buildSolidBoxEntities: 폭 또는 높이가 0이면 오류', () => {
  assert.throws(() => buildSolidBoxEntities({x: 0, y: 0}, {x: 0, y: 50}));
});

// geometry.js 기본 함수가 기대대로 동작하는지(간접 의존성 확인용) 한 건만 더 확인
test('G.dist 스모크', () => {
  assert.equal(G.dist({x: 0, y: 0}, {x: 3, y: 4}), 5);
});


test('preview contract · TL/DLA builders equal committed entities and do not mutate input', () => {
  const box = {minX: 0, minY: 0, maxX: 100, maxY: 50};
  const cursor = {x: 150, y: 20};
  const cb = dimensionPreview((point) => buildTextLeaderEntities(box, point, 40));
  const preview = cb([], cursor);
  assert.deepEqual(preview, buildTextLeaderEntities(box, cursor, 40));
  assert.deepEqual(box, {minX: 0, minY: 0, maxX: 100, maxY: 50});
  const dim = {type: 'dimension', mode: 'horizontal', points: [{x: 0, y: 0}, {x: 100, y: 0}, {x: 50, y: 50}]};
  const original = JSON.stringify(dim);
  const dcb = dimensionPreview((point) => [{...dim, points: projectDimensionExtensionStarts(dim, {x: 0, y: 10}, point)}]);
  const out = dcb([], {x: 100, y: 10});
  assert.deepEqual(out[0].points, [{x: 0,y:10},{x:100,y:10},{x:50,y:50}]);
  assert.equal(JSON.stringify(dim), original);
});
