import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {previewInk, assetPreviewEntities, assetPreviewBounds, drawAssetPreview, PREVIEW_BACKGROUND, sceneLabel} from './cad-asset-preview.js';
import {LIBRARY_CARD_ICONS, libraryCardIconSvg} from './library-card-icons.js';

function fakeCanvas(width = 200, height = 100) {
  const calls = [];
  const ctx = new Proxy({calls}, {
    get(target, key) {
      if (key in target) return target[key];
      if (key === 'measureText') return text => ({width: String(text).length * 6});
      return (...args) => calls.push([key, ...args]);
    },
    set(target, key, value) {calls.push(['set:' + String(key), value]); return true;},
  });
  return {clientWidth: width, clientHeight: height, width: 0, height: 0, getContext: () => ctx, calls};
}

test('검은 바탕 CAD 색: 레이어 색은 그대로, ACI 7·검정은 흰색', () => {
  assert.equal(previewInk('#ff0000'), '#ff0000');
  assert.equal(previewInk('#00FFFF'), '#00ffff');
  assert.equal(previewInk('#000000'), '#ffffff');
  assert.equal(previewInk('#101010'), '#ffffff');
  assert.equal(previewInk(undefined), '#ffffff');
  assert.equal(previewInk('red'), '#ffffff');
});

test('서버 자료(scenes)의 객체를 장면 범위에 맞춰 검은 바탕에 그린다', () => {
  const asset = {scenes: [
    {bounds: [0, 0, 1000, 500], entities: [{type: 'line', points: [{x: 0, y: 0}, {x: 1000, y: 500}], color: '#000000'}]},
    {bounds: [2000, 0, 3000, 500], entities: [{type: 'line', points: [{x: 2000, y: 0}, {x: 3000, y: 0}], color: '#ff00ff'}]},
  ]};
  assert.equal(assetPreviewEntities(asset).length, 2);
  assert.deepEqual(assetPreviewBounds(asset), {minX: 0, minY: 0, maxX: 3000, maxY: 500});
  const canvas = fakeCanvas();
  assert.equal(drawAssetPreview(canvas, asset, {pixelRatio: 1}), 2);
  const fill = canvas.calls.findIndex(c => c[0] === 'set:fillStyle' && c[1] === PREVIEW_BACKGROUND);
  assert.ok(fill >= 0, '검은 바탕을 먼저 칠한다');
  const strokes = canvas.calls.filter(c => c[0] === 'set:strokeStyle').map(c => c[1]);
  assert.ok(strokes.includes('#ffffff'), '검정 선은 흰색으로');
  assert.ok(strokes.includes('#ff00ff'), '색 선은 그 색으로');
  // y 가 위로 가는 도면 좌표를 화면(아래로 가는 y)으로 뒤집는다: (0,0)은 아래쪽
  const moves = canvas.calls.filter(c => c[0] === 'moveTo');
  assert.ok(moves.some(c => c[2] > 50));
});

test('그릴 객체가 없으면 0 (부르는 쪽이 미리 구운 그림을 그대로 둔다)', () => {
  assert.equal(drawAssetPreview(fakeCanvas(), {scenes: []}, {pixelRatio: 1}), 0);
});

test('건축 요소 카드 그림 셋은 실제 자료로 그린 검은 바탕 그림이고 기본 꺾은선 아이콘이 아니다', () => {
  assert.deepEqual(Object.keys(LIBRARY_CARD_ICONS), ['상세', '주동', '단위세대']);
  for (const svg of Object.values(LIBRARY_CARD_ICONS)) {
    assert.match(svg, /^<svg class="library-card-icon" viewBox="0 0 64 48"/);
    assert.match(svg, /<rect width="64" height="48" rx="4" fill="#000" stroke="none"\/>/);
    assert.ok((svg.match(/<path /g) || []).length >= 2, '색마다 선이 있다');
    assert.doesNotMatch(svg, /reference-command-icon|icon-subject/);
    assert.ok(svg.length < 24_000);
  }
  assert.equal(libraryCardIconSvg('없는 카드'), null);
  // 런처 CSS 가 svg 에 선 색을 덮지 않도록 카드 그림은 크기만 정한다
  assert.match(fs.readFileSync('style.css', 'utf8'), /\.building-assist-launcher svg\.library-card-icon\{width:48px;height:36px\}/);
});

test('새 화면 모듈은 엔진 서버 허용 목록에 있다', () => {
  const server = fs.readFileSync('server.py', 'utf8');
  assert.match(server, /'\/cad-asset-preview\.js'/);
  assert.match(server, /'\/library-card-icons\.js'/);
});

test('블록 안 검정 자식도 흰색으로 그리고 원본 자료는 바꾸지 않는다', () => {
  const child = {type: 'line', points: [{x: 0, y: 0}, {x: 100, y: 100}], color: '#000000'};
  const asset = {scenes: [{bounds: [0, 0, 100, 100], entities: [{type: 'block', id: 'b1', color: '#00ff00', entities: [child]}]}]};
  const canvas = fakeCanvas();
  drawAssetPreview(canvas, asset, {pixelRatio: 1});
  const strokes = canvas.calls.filter(c => c[0] === 'set:strokeStyle').map(c => c[1]);
  assert.ok(strokes.length > 0);
  assert.ok(!strokes.includes('#000000'), '검정은 검은 바탕에 묻히므로 쓰지 않는다');
  assert.equal(child.color, '#000000');
  assert.equal(asset.scenes[0].entities[0].entities[0], child);
});

test('가리개(WIPEOUT·글자 배경)는 화면 테마가 아니라 미리보기 검은 바탕으로 칠한다(검토 B4)', () => {
  const asset = {scenes: [{bounds: [0, 0, 1000, 500], entities: [
    {type: 'hatch', wipeout: true, points: [{x: 0, y: 0}, {x: 400, y: 0}, {x: 400, y: 300}, {x: 0, y: 300}], loops: []},
    {type: 'text', position: {x: 500, y: 200}, text: 'A', height: 50, rotation: 0, backgroundMask: true},
  ]}]};
  const canvas = fakeCanvas();
  assert.equal(drawAssetPreview(canvas, asset, {pixelRatio: 1}), 2);
  const fills = canvas.calls.filter(c => c[0] === 'set:fillStyle').map(c => c[1]);
  for (const theme of ['#101820', '#f8f5ef']) assert.ok(!fills.includes(theme), '테마 바탕색 ' + theme + ' 를 쓰지 않는다: ' + fills);
  const fillAt = canvas.calls.findIndex(c => c[0] === 'fill' && c[1] === 'evenodd');
  assert.ok(fillAt > 0);
  assert.equal(canvas.calls.slice(0, fillAt).filter(c => c[0] === 'set:fillStyle').at(-1)[1], PREVIEW_BACKGROUND);
});

test('장면 제목(번호·제목·SCALE)을 장면 아래 화면 글자로 다시 쓰고, 장면 하나만 크게 그릴 수 있다(10-25)', () => {
  assert.equal(sceneLabel({n: 1, title: '단면', scale: 5}), '1  단면  SCALE 1/5');
  assert.equal(sceneLabel({n: 2, title: '확대'}), '2  확대');
  const asset = {scenes: [
    {n: 1, title: '단면', scale: 5, bounds: [0, 0, 1000, 500], entities: [{type: 'line', points: [{x: 0, y: 0}, {x: 1000, y: 500}]}]},
    {n: 2, title: '확대', scale: 2, bounds: [2000, 0, 3000, 500], entities: [{type: 'line', points: [{x: 2000, y: 0}, {x: 3000, y: 0}]}]},
  ]};
  const all = fakeCanvas(400, 200);
  assert.equal(drawAssetPreview(all, asset, {pixelRatio: 1}), 2);
  const texts = all.calls.filter(c => c[0] === 'fillText').map(c => c[1]);
  assert.deepEqual(texts, ['1  단면  SCALE 1/5', '2  확대  SCALE 1/2']);
  assert.deepEqual(all.sceneRects.map(r => r.n), [1, 2]);
  assert.ok(all.sceneRects[0].x1 < all.sceneRects[1].x0, '장면 사각형은 서로 겹치지 않는다');
  const one = fakeCanvas(400, 200);
  assert.equal(drawAssetPreview(one, asset, {pixelRatio: 1, scene: 2}), 1, '장면 2만 그린다');
  assert.deepEqual(one.calls.filter(c => c[0] === 'fillText').map(c => c[1]), ['2  확대  SCALE 1/2']);
  assert.ok(one.sceneRects[0].x1 - one.sceneRects[0].x0 > all.sceneRects[1].x1 - all.sceneRects[1].x0, '크게 본 장면이 더 크다');
  assert.equal(drawAssetPreview(fakeCanvas(), asset, {pixelRatio: 1, labels: false}), 2);
});
