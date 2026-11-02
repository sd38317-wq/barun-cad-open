// dim-hatch-tools.js 의 순수 함수 시험. DOM 없이 node --test 로 돈다.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {
  alignLeaderEndpoint, baselineDimensionText, overrideDimensionText, convertDimensionMode,
  toggleExtensionLines, buildRoundSurface, PAPER_SIZES, computeDboxScale, formatDateStamp,
} from './dim-hatch-tools.js';

// LDA
test('alignLeaderEndpoint · 45도 선을 수평 기준선(y=200)까지 연장한다', () => {
  const next = alignLeaderEndpoint([{x: 0, y: 0}, {x: 100, y: 100}], {x: 0, y: 200}, {x: 500, y: 200});
  assert.equal(next.length, 2);
  assert.equal(next[0].x, 0);
  assert.equal(next[0].y, 0);
  assert.ok(Math.abs(next[1].x - 200) < 1e-6);
  assert.ok(Math.abs(next[1].y - 200) < 1e-6);
});
test('alignLeaderEndpoint · 평행하면 오류', () => {
  assert.throws(() => alignLeaderEndpoint([{x: 0, y: 0}, {x: 100, y: 0}], {x: 0, y: 200}, {x: 500, y: 200}), /평행/);
});
test('alignLeaderEndpoint · 점이 2개 미만이면 오류', () => {
  assert.throws(() => alignLeaderEndpoint([{x: 0, y: 0}], {x: 0, y: 200}, {x: 500, y: 200}), /점이 2개/);
});

// CDE
test('baselineDimensionText · 수평 치수 실측값(문자 재정의 없이)', () => {
  const dim = {type: 'dimension', mode: 'horizontal', points: [{x: 0, y: 0}, {x: 1000, y: 0}, {x: 0, y: 200}]};
  assert.equal(baselineDimensionText(dim), '1000');
});
test('overrideDimensionText · 빈칸/R 은 복원(빈 문자)', () => {
  const dim = {type: 'dimension', mode: 'horizontal', points: [{x: 0, y: 0}, {x: 1000, y: 0}, {x: 0, y: 200}]};
  assert.deepEqual(overrideDimensionText(dim, ''), {text: ''});
  assert.deepEqual(overrideDimensionText(dim, 'r'), {text: ''});
});
test('overrideDimensionText · +50 은 실측값에 더한다', () => {
  const dim = {type: 'dimension', mode: 'horizontal', points: [{x: 0, y: 0}, {x: 1000, y: 0}, {x: 0, y: 200}]};
  assert.deepEqual(overrideDimensionText(dim, '+50'), {text: '1050'});
});
test('overrideDimensionText · -50 은 실측값에서 뺀다', () => {
  const dim = {type: 'dimension', mode: 'horizontal', points: [{x: 0, y: 0}, {x: 1000, y: 0}, {x: 0, y: 200}]};
  assert.deepEqual(overrideDimensionText(dim, '-50'), {text: '950'});
});
test('overrideDimensionText · 절대값 문자는 그대로 대입', () => {
  const dim = {type: 'dimension', mode: 'horizontal', points: [{x: 0, y: 0}, {x: 1000, y: 0}, {x: 0, y: 200}]};
  assert.deepEqual(overrideDimensionText(dim, '900 (참고)'), {text: '900 (참고)'});
});

// DCV
test('convertDimensionMode · 거의 수평이면 horizontal', () => {
  const dim = {mode: 'aligned', points: [{x: 0, y: 0}, {x: 1000, y: 20}]};
  assert.equal(convertDimensionMode(dim), 'horizontal');
});
test('convertDimensionMode · 거의 수직이면 vertical', () => {
  const dim = {mode: 'aligned', points: [{x: 0, y: 0}, {x: 20, y: 1000}]};
  assert.equal(convertDimensionMode(dim), 'vertical');
});
test('convertDimensionMode · 45도는 변환 대상 아님(null)', () => {
  const dim = {mode: 'aligned', points: [{x: 0, y: 0}, {x: 1000, y: 1000}]};
  assert.equal(convertDimensionMode(dim), null);
});
test('convertDimensionMode · aligned 아니면 null', () => {
  const dim = {mode: 'horizontal', points: [{x: 0, y: 0}, {x: 1000, y: 0}]};
  assert.equal(convertDimensionMode(dim), null);
});

// DDT
test('toggleExtensionLines · 켜져있는 치수를 감추면 0 길이로 접힌다', () => {
  const dim = {mode: 'aligned', extensionOffset: 60, extensionOvershoot: 40};
  const changes = toggleExtensionLines(dim);
  assert.equal(changes.extensionOffset, 1e9);
  assert.equal(changes.extensionOvershoot, 0);
  assert.equal(changes.extLineHidden, true);
  assert.deepEqual(changes._dimExtSaved, {extensionOffset: 60, extensionOvershoot: 40});
});
test('toggleExtensionLines · 감춰진 치수를 다시 누르면 저장된 값으로 복원', () => {
  const dim = {mode: 'aligned', extLineHidden: true, _dimExtSaved: {extensionOffset: 60, extensionOvershoot: 40}};
  const changes = toggleExtensionLines(dim);
  assert.equal(changes.extensionOffset, 60);
  assert.equal(changes.extensionOvershoot, 40);
  assert.equal(changes.extLineHidden, false);
});
test('toggleExtensionLines · radius/diameter 는 대상 아님(null)', () => {
  assert.equal(toggleExtensionLines({mode: 'radius'}), null);
  assert.equal(toggleExtensionLines({mode: 'diameter'}), null);
});

// RND
test('buildRoundSurface · 한쪽 형식은 count 개 반원, 반지름=폭/2', () => {
  const p1 = [{x: 0, y: 0}, {x: 1000, y: 0}];
  const p2 = [{x: 0, y: 100}, {x: 1000, y: 100}];
  const arcs = buildRoundSurface(p1, p2, 4, 'one');
  assert.equal(arcs.length, 4);
  for (const a of arcs) {
    assert.equal(a.type, 'arc');
    assert.ok(Math.abs(a.radius - 50) < 1e-6);
    assert.equal(a.endAngle - a.startAngle, 180);
  }
});
test('buildRoundSurface · 양쪽 형식은 번갈아 방향이 바뀐다', () => {
  const p1 = [{x: 0, y: 0}, {x: 1000, y: 0}];
  const p2 = [{x: 0, y: 100}, {x: 1000, y: 100}];
  const arcs = buildRoundSurface(p1, p2, 4, 'both');
  assert.notEqual(arcs[0].startAngle, arcs[1].startAngle);
});
test('buildRoundSurface · 거리 0이면 그 구간은 빠진다', () => {
  const p1 = [{x: 0, y: 0}, {x: 1000, y: 0}];
  const p2 = [{x: 0, y: 0}, {x: 1000, y: 0}];
  assert.equal(buildRoundSurface(p1, p2, 3, 'one').length, 0);
});

// DFS
test('computeDboxScale · A1 원본 대비 100배로 그려진 도곽은 1/100', () => {
  const result = computeDboxScale({x: 0, y: 0}, {x: 84100, y: 59400}, 'A1');
  assert.ok(Math.abs(result.scale - 100) < 1e-6);
  assert.equal(result.width, 84100);
  assert.equal(result.height, 59400);
});
test('computeDboxScale · 폭이나 높이가 0이면 오류', () => {
  assert.throws(() => computeDboxScale({x: 0, y: 0}, {x: 0, y: 100}, 'A3'), /폭과 높이/);
});
test('computeDboxScale · 모르는 용지 규격은 오류', () => {
  assert.throws(() => computeDboxScale({x: 0, y: 0}, {x: 100, y: 100}, 'A9'), /알 수 없는/);
});
test('PAPER_SIZES · A3 는 297x420', () => {
  assert.deepEqual(PAPER_SIZES.A3, {w: 297, h: 420});
});

// DTS
test('formatDateStamp · "생성: YYYY-MM-DD HH:MM" 형식', () => {
  const s = formatDateStamp(new Date(2026, 8, 21, 9, 5));
  assert.equal(s, '생성: 2026-09-21 09:05');
});

// CON — 콘크리트는 회색 솔리드, 여러 폐곡선을 한 번에(실행 취소 한 단계)
test('CON · 고른 폐곡선 전부를 회색 솔리드 해치 하나로 넣는다', async () => {
  const {installDimHatchTools} = await import('./dim-hatch-tools.js');
  const sq = (x) => [{x, y: 0}, {x: x + 100, y: 0}, {x: x + 100, y: 100}, {x, y: 100}];
  const picks = [{id: 'a', type: 'polyline', closed: true, points: sq(0)}, {id: 'b', type: 'rectangle', points: sq(200)}, null];
  const commits = [];
  const ctx = {selected: () => [], pickEntity: async () => picks.shift(), ensureLayer: () => 'CONC', commit: (c) => commits.push(c), toast: () => {}, userErrorMessage: (e) => e.message};
  installDimHatchTools(ctx).CON();
  for (let i = 0; i < 20 && !commits.length; i++) await new Promise((r) => setTimeout(r, 5));   // guard 는 약속을 돌려주지 않는다
  assert.equal(commits.length, 1);
  assert.equal(commits[0].entities.length, 1);
  assert.equal(commits[0].entities[0].loops.length, 1);
  for (const h of commits[0].entities) { assert.equal(h.solid, true); assert.equal(h.pattern, 'solid'); assert.equal(h.color, '#808080'); }
});
