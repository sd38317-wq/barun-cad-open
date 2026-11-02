// text-measure.js 시험 — 508 글꼴 측정 캐시와 geometry 연결.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as G from './geometry.js';
import {createTextMeasurer, textBoxOf, DRAW_EM} from './text-measure.js';

const fakeMeasure = () => {
 const calls = [];
 const fn = (font, text) => { calls.push([font, text]); return /[가-힣]/.test(text) ? 92 : text === 'W' ? 90 : 55; };
 return {fn, calls};
};

test('글자마다 한 번만 재고(캐시) 화면 글꼴 크기(높이×1.15) 기준 폭을 돌려준다', () => {
 const {fn, calls} = fakeMeasure();
 const units = createTextMeasurer(fn);
 const e = {sourceFont: 'malgun.ttf'};
 assert.ok(Math.abs(units(e, '가나W') - (0.92 * 2 + 0.9) * DRAW_EM) < 1e-12);
 const before = calls.length;
 units(e, '가나W가가가');
 assert.equal(calls.length, before);                   // 이미 잰 글자는 다시 재지 않는다
 assert.match(calls[0][0], /Malgun Gothic/);
 assert.equal(units.size(), 3);
 units.clear(); units(e, '가'); assert.equal(calls.length, before + 1);
});

test('같은 CSS 글꼴로 그리는 다른 글꼴 이름은 글자 표를 같이 쓴다', () => {
 const {fn, calls} = fakeMeasure();
 const units = createTextMeasurer(fn);
 units({sourceFont: 'romans.shx'}, 'A'); units({sourceFont: 'simplex.shx'}, 'A');
 assert.equal(calls.length, 1);
});

test('측정기를 꽂으면 선택 상자·마스크 폭 함수가 그 값을 쓰고, 빼면 예전 어림값으로 돌아간다', () => {
 const e = {type: 'text', text: 'ABCD', height: 10, position: {x: 0, y: 0}, rotation: 0};
 const before = G.textBoxWidth(e);
 assert.ok(Math.abs(before - 26) < 1e-9);               // 어림값 0.65 × 4 × 10
 G.setTextLineMeasurer(createTextMeasurer(() => 70));     // 70px/100px × 1.15 = 0.805
 try {
  assert.ok(Math.abs(G.textBoxWidth(e) - 4 * 0.805 * 10) < 1e-9);
  const xs = G.vertices(e).map(p => p.x);
  assert.ok(Math.abs(Math.max(...xs) - 32.2) < 1e-9);
 } finally { G.setTextLineMeasurer(null); }
 assert.ok(Math.abs(G.textBoxWidth(e) - before) < 1e-12);
});

test('측정기가 없으면 null, 상자는 그리기 규칙(위 1·아래 0.25·줄 간격 1.35)', () => {
 assert.equal(createTextMeasurer(null), null);
 const box = textBoxOf({text: '가\nAB', height: 10, widthFactor: 2}, (e, line) => G.textLineUnits(line));
 assert.deepEqual(box, {width: 1.3 * 10 * 2, ascent: 10, descent: 2.5, lines: 2, lineGap: 13.5});
});
