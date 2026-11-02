// hatch-table-tools.js 의 순수 함수 시험 (node --test, DOM 없이 동작).
import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as H from './hatch-table-tools.js';

test('brickCourseLines: 막힌줄눈(엇갈림) — 가로 줄눈 2개 + 세로 줄눈이 한 켜씩 반 장 엇갈림', () => {
  const box = {minX: 0, minY: 0, maxX: 400, maxY: 130};
  const segs = H.brickCourseLines(box, {length: 190, height1: 60, height2: 60, joint: 10, bond: 'running'});
  const horiz = segs.filter((s) => s[0].y === s[1].y).map((s) => s[0].y).sort((a, b) => a - b);
  assert.deepEqual(horiz, [60, 120]);
  const row0 = segs.filter((s) => s[0].x === s[1].x && s[0].y === 0 && s[1].y === 60).map((s) => s[0].x).sort((a, b) => a - b);
  assert.deepEqual(row0, [190, 390]);
  const row1 = segs.filter((s) => s[0].x === s[1].x && s[0].y === 60 && s[1].y === 120).map((s) => s[0].x).sort((a, b) => a - b);
  assert.deepEqual(row1, [95, 295]);
});

test('brickCourseLines: 통줄눈(일직선) — 모든 켜의 세로 줄눈 x 가 같다', () => {
  const box = {minX: 0, minY: 0, maxX: 400, maxY: 130};
  const segs = H.brickCourseLines(box, {length: 190, height1: 60, height2: 60, joint: 10, bond: 'stack'});
  const row1 = segs.filter((s) => s[0].x === s[1].x && s[0].y === 60 && s[1].y === 120).map((s) => s[0].x).sort((a, b) => a - b);
  assert.deepEqual(row1, [190, 390]);
});

test('brickCourseLines: 유효성 검사(경계 0, 길이<50, 높이<=0, 줄눈<0)', () => {
  const box = {minX: 0, minY: 0, maxX: 400, maxY: 130};
  assert.throws(() => H.brickCourseLines({minX: 0, minY: 0, maxX: 0, maxY: 130}, {length: 190, height1: 60, height2: 60, joint: 10}));
  assert.throws(() => H.brickCourseLines(box, {length: 40, height1: 60, height2: 60, joint: 10}));
  assert.throws(() => H.brickCourseLines(box, {length: 190, height1: 0, height2: 60, joint: 10}));
  assert.throws(() => H.brickCourseLines(box, {length: 190, height1: 60, height2: 60, joint: -1}));
});

test('divideGap: 간격을 기준 폭에 가장 가까운 등분수로 나눈다', () => {
  assert.deepEqual(H.divideGap(1200, 1200), {n: 1, width: 1200});
  const r = H.divideGap(2500, 1200);
  assert.equal(r.n, 2);
  assert.equal(r.width, 1250);
  assert.throws(() => H.divideGap(0, 1200));
  assert.throws(() => H.divideGap(1200, 0));
});

test('gddJoints: 등분 안 되는 구간(n=1)은 건너뛰고, 등분되는 구간만 내부 줄눈을 만든다', () => {
  const segs = H.gddJoints([0, 2500], 1200, 0, 1000);
  assert.equal(segs.length, 1);
  assert.deepEqual(segs[0], [{x: 1250, y: 0}, {x: 1250, y: 1000}]);
});

test('gddJoints: 중심선이 2개 미만이면 오류', () => {
  assert.throws(() => H.gddJoints([0], 1200, 0, 1000));
});

test('thicknessRectangle: 두 점을 반대 순서로 지정해도 같은 사각형이 나온다', () => {
  const fwd = H.thicknessRectangle({x: 0, y: 0}, {x: 100, y: 0}, 20);
  const key = (p) => `${p.x},${p.y}`;
  assert.deepEqual(new Set(fwd.map(key)), new Set(['0,10', '100,10', '100,-10', '0,-10']));
  const rev = H.thicknessRectangle({x: 100, y: 0}, {x: 0, y: 0}, 20);
  assert.deepEqual(new Set(rev.map(key)), new Set(fwd.map(key)));
});

test('thicknessRectangle: 두께 0 이하는 오류', () => {
  assert.throws(() => H.thicknessRectangle({x: 0, y: 0}, {x: 10, y: 0}, 0));
});

test('cloneHatchStyle: 해치가 아니면 오류, 해치면 필요한 속성만 뽑는다', () => {
  assert.throws(() => H.cloneHatchStyle({type: 'line'}));
  const style = H.cloneHatchStyle({type: 'hatch', points: [], pattern: 'cross', solid: false, spacing: 40, angle: 45, color: '#fff', layer: 'L1', extra: 1});
  assert.deepEqual(style, {pattern: 'cross', solid: false, spacing: 40, hatchScale: undefined, angle: 45, color: '#fff', linetype: undefined, layer: 'L1'});
});

test('hatchContainsPoint / selectHatchesByObjects: 사각형 해치 안/밖 판정, 루프(구멍)는 제외', () => {
  const square = {id: 'h1', type: 'hatch', points: [{x: 0, y: 0}, {x: 100, y: 0}, {x: 100, y: 100}, {x: 0, y: 100}]};
  assert.equal(H.hatchContainsPoint(square, {x: 50, y: 50}), true);
  assert.equal(H.hatchContainsPoint(square, {x: 200, y: 200}), false);
  const withHole = {...square, id: 'h2', loops: [[{x: 40, y: 40}, {x: 60, y: 40}, {x: 60, y: 60}, {x: 40, y: 60}]]};
  assert.equal(H.hatchContainsPoint(withHole, {x: 50, y: 50}), false);
  const ids = H.selectHatchesByObjects([square, withHole], [{position: {x: 50, y: 50}}, {position: {x: 200, y: 200}}]);
  assert.deepEqual(ids, ['h1']);
});

test('filterMarkersByText: 포함(contains) 매칭', () => {
  const markers = [{text: '101전'}, {text: '102답'}, {text: '201전'}];
  assert.deepEqual(H.filterMarkersByText(markers, '전'), [{text: '101전'}, {text: '201전'}]);
});

test('pickRandomColor: 3개 미만이면 기본 팔레트, 같은 대상은 같은 색을 기억한다', () => {
  const fallback = ['#a', '#b', '#c', '#d'];
  const r1 = H.pickRandomColor([], {}, 'obj1', fallback, () => 0.99);
  assert.equal(r1.usedFallback, true);
  assert.equal(r1.color, '#d');
  const r2 = H.pickRandomColor(['#x', '#y', '#z'], r1.map, 'obj1', fallback, () => 0);
  assert.equal(r2.remembered, true);
  assert.equal(r2.color, '#d');
  const r3 = H.pickRandomColor(['#x', '#y', '#z'], r1.map, 'obj2', fallback, () => 0);
  assert.equal(r3.usedFallback, false);
  assert.equal(r3.color, '#x');
});

test('savePresetSlot / applyPresetSlot: 슬롯 범위와 미저장 오류', () => {
  assert.throws(() => H.savePresetSlot({}, 0, {}));
  assert.throws(() => H.savePresetSlot({}, 10, {}));
  const presets = H.savePresetSlot({}, 1, {pattern: 'solid'});
  assert.equal(H.applyPresetSlot(presets, 1).pattern, 'solid');
  assert.throws(() => H.applyPresetSlot(presets, 2));
});

test('dimMeasuredValue: 재정의 문자를 무시하고 실측값을 구한다', () => {
  const dim = {type: 'dimension', mode: 'horizontal', points: [{x: 0, y: 0}, {x: 1000, y: 0}, {x: 500, y: 200}], text: '무시될 값', precision: 2};
  assert.equal(H.dimMeasuredValue(dim), '1000');
  assert.throws(() => H.dimMeasuredValue({type: 'line'}));
});

test('numberedRows: 접두어 붙은 번호와 좌표순 정렬', () => {
  const dims = [
    {type: 'dimension', mode: 'horizontal', points: [{x: 500, y: 0}, {x: 1500, y: 0}, {x: 1000, y: 100}]}, // 1000
    {type: 'dimension', mode: 'horizontal', points: [{x: 0, y: 0}, {x: 400, y: 0}, {x: 200, y: 100}]}, // 400
  ];
  const selectionOrder = H.numberedRows(dims, {prefix: 'M', order: 'selection'});
  assert.deepEqual(selectionOrder.map((r) => r.no), ['M(1)', 'M(2)']);
  assert.deepEqual(selectionOrder.map((r) => r.text), ['1000', '400']);
  const positionOrder = H.numberedRows(dims, {order: 'position'});
  assert.deepEqual(positionOrder.map((r) => r.text), ['400', '1000']);
});

test('buildTableGeometry: 격자 선 개수와 문자 위치', () => {
  const geo = H.buildTableGeometry({origin: {x: 0, y: 1000}, colWidths: [100, 200], rowHeight: 50, rows: [['A', 'B'], ['C', 'D']], textHeight: 30});
  assert.equal(geo.totalW, 300);
  assert.equal(geo.totalH, 100);
  assert.equal(geo.lines.length, 3 + 3); // 가로 3(행2+1) + 세로 3(열2+1)
  assert.equal(geo.texts.length, 4);
  assert.deepEqual(geo.texts[0], {position: {x: 50, y: 1000 - 25 - 10.5}, text: 'A', height: 30});
  assert.throws(() => H.buildTableGeometry({origin: null, colWidths: [1], rowHeight: 1, rows: [['x']]}));
  assert.throws(() => H.buildTableGeometry({origin: {x: 0, y: 0}, colWidths: [1], rowHeight: 1, rows: []}));
});

test('autoColumnWidths: 문자가 긴 열일수록 폭이 넓다', () => {
  const widths = H.autoColumnWidths([['ab', 'xyz'], ['a', 'defgh']], {textHeight: 100});
  assert.equal(widths.length, 2);
  assert.ok(widths[1] > widths[0]);
  assert.throws(() => H.autoColumnWidths([]));
});

test('installHatchTableTools: 명령 11개를 반환한다', () => {
  const ctx = {toast() {}, userErrorMessage: (e) => e.message};
  const cmds = H.installHatchTableTools(ctx);
  assert.deepEqual(Object.keys(cmds).sort(), ['BPT', 'DTT', 'GDD', 'HC', 'HP', 'HPM', 'HR', 'HT', 'RDS', 'SHO', 'TAJ']);
  for (const fn of Object.values(cmds)) assert.equal(typeof fn, 'function');
});

test('installHatchTableTools: HP/HPM 은 안내 토스트가 아니라 실제 입력 흐름을 연다(2026-09-24)', async () => {
  const toasts = [], forms = [], picks = [];
  const ctx = {toast: (msg, isError) => toasts.push({msg, isError}), userErrorMessage: (e) => e.message, selected: () => [], layers: () => [],
    pickEntity: async (o) => {picks.push(o); return null;}, pickPoint: async () => null, form: (title) => forms.push(title)};
  const cmds = H.installHatchTableTools(ctx);
  await cmds.HP();
  cmds.HPM();
  assert.equal(picks.length, 1);
  assert.deepEqual(picks[0].types, ['hatch']);
  assert.equal(forms.length, 1);
  assert.ok(!toasts.some((t) => /제공하지 않/.test(t.msg)));
});
