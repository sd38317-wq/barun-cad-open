import test from 'node:test';
import assert from 'node:assert/strict';
import {PAPERS, DEFAULT_SHEET_TEMPLATE, sheetGeometry, paperFor, packSheets, drawSheetFrame, sheetNumber, SHEET_SERIES} from './sheet-layout.js';

const overlap = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

test('시트 채우기: 겹침 없이 그림 칸 안에, 키 큰 그림 옆 빈 곳도 쓴다', () => {
  const items = [[2040, 1860], [2040, 2060], [2514, 2770], [3530, 2760], [2982, 1807], [6184, 5400], [3323, 4054], [4386, 1968], [5825, 2531], [6218, 1301], [2960, 3859], [2486, 2840], [2554, 3708]].map(([w, h]) => ({w, h}));
  const pages = packSheets(items, {denominator: 10, gap: 120, paper: 'A1'}), g = sheetGeometry(DEFAULT_SHEET_TEMPLATE, 'A1');
  const W = (g.draw.maxX - g.draw.minX) * 10, H = (g.draw.maxY - g.draw.minY) * 10;
  assert.equal(pages.flatMap((p) => p.places).length, items.length, '모든 그림이 한 번씩');
  assert.ok(pages.length <= 5, '13개를 5장 이내로');
  for (const page of pages) {
    const boxes = page.places.map((p) => ({x: p.x, y: p.y, w: items[p.index].w, h: items[p.index].h}));
    for (const b of boxes) assert.ok(b.x + b.w <= W + 1e-6 && b.y + b.h <= H + 1e-6, '그림 칸 밖');
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) assert.equal(overlap(boxes[i], boxes[j]), false);
  }
});

test('용지: 모든 그림이 들어가는 가장 작은 용지, 양식의 기본 용지보다 작게는 안 간다', () => {
  assert.equal(paperFor([{w: 15000, h: 10000, k: 100}]), 'A3');
  assert.equal(paperFor([{w: 26860, h: 29900, k: 100}]), 'A2');
  assert.equal(paperFor([{w: 29410, h: 62750, k: 100}]), 'A0');
  assert.equal(paperFor([{w: 100, h: 100, k: 100}], {...DEFAULT_SHEET_TEMPLATE, paper: 'A2'}), 'A2');
  assert.deepEqual(Object.keys(PAPERS), ['A3', 'A2', 'A1', 'A0']);
});

test('바른 CAD 기본 도곽: 용지 경계·테두리·표제란 칸과 값, 축척 분모만큼 커진다', () => {
  const lines = [], texts = [];
  const fills = [], g = {line: (a, b, layer) => lines.push({a, b, layer}), text: (p, t, h, layer) => texts.push({p, t, h, layer}), fill: (pts, layer, color) => fills.push({pts, layer, color})};
  const frame = drawSheetFrame(g, {at: {x: 1000, y: -2000}, k: 100, fields: {project: '사리로 64-1 단독주택', title: '1층 평면도', number: 'A-101', scale: '1/100', paper: 'A3', date: '2026-10-12', sheetIndex: 3, sheetCount: 15}});
  assert.deepEqual(frame.bounds, {minX: 1000, minY: -2000, maxX: 1000 + 420 * 100, maxY: -2000 + 297 * 100});
  const all = texts.map((t) => t.t).join(' ');   // 긴 사업명은 칸 폭에 맞춰 두 줄
  for (const v of ['바른 CAD', '사리로 64-1 단독주택', '1층 평면도', 'A-101', '1/100', 'A3', '2026-10-12', '사업명', '도면명', '도면번호', '설계', '작성', '검토', '개정', '03 / 15'])
    assert.ok(all.includes(v), v);
  // 솔리드: 맨 위 진한 띠, 도면번호 칸 바탕 / 사업명은 위, 도면번호는 맨 아래
  assert.equal(fills.length, 2);assert.ok(fills.every((f) => f.layer === 'A-TITLE'));
  const y = (v) => texts.find((t) => t.t.startsWith(v)).p[1];assert.ok(y('사업명') > y('도면명') && y('도면명') > y('A-101'));
  assert.ok(lines.every((l) => l.layer === 'A-TITLE') && texts.every((t) => t.layer === 'A-TEXT'));
  assert.ok(frame.draw.maxX < frame.bounds.maxX - DEFAULT_SHEET_TEMPLATE.titleWidth * 100, '그림 칸은 표제란 왼쪽');
});

test('시트 번호 체계: 001 목록 · 1xx 평면 · 2xx 입면 · 5xx 상세', () => {
  assert.equal(sheetNumber('A', 0, 1), 'A-001');
  assert.equal(sheetNumber('A', SHEET_SERIES.plan, 1), 'A-101');
  assert.equal(sheetNumber('A', SHEET_SERIES.elevation, 2), 'A-202');
  assert.equal(sheetNumber('A', SHEET_SERIES.detail, 12), 'A-512');
});
