import test from 'node:test';
import assert from 'node:assert/strict';
import {packDrawing, encodePadPack, decodePadPack, flattenInstances, FLAG_PAIRS, FLAG_CURVE} from './pad-pack.js';
import {materializeSharedDrawingReference} from './geometry.js';
import {createPadSnapper} from './pad-snap.js';

const layers = [
  {id: 'L0', name: '0', color: '#ffffff'},
  {id: 'W', name: 'A-WALL', color: '#ff0000'},
  {id: 'H', name: 'A-HIDDEN', color: '#00ff00', visible: false},
];
const point = (x, y) => ({x, y});
const line = (id, points, layer = 'W') => ({id, type: 'line', layer, color: '#ff0000', points});
const circle = (id, x, y, radius) => ({id, type: 'circle', layer: 'W', color: '#ff0000', center: point(x, y), radius});
const allModes = ['끝점', '교차점', '중간점', '중심점', '사분점', '수직점', '근처점'];

function fixture(entities, sharedBlocks = {}, quantum = 0.1) {
  const doc = {units: 'mm', layers, entities, sharedBlocks};
  const pack = decodePadPack(encodePadPack(packDrawing(doc, {quantum})));
  return {doc, pack, snapper: createPadSnapper(pack, flattenInstances(pack))};
}
const relative = (pack, p) => ({x: p.x - pack.sets[0].origin.x, y: p.y - pack.sets[0].origin.y});
function snap(f, p, modes, options = {}) {
  const {from, ...rest} = options;
  return f.snapper.snap(relative(f.pack, p), {scale: 100, modes: new Set(modes), ...rest, from: from ? relative(f.pack, from) : null});
}
function near(actual, expected, kind, tolerance = 1e-5) {
  assert.ok(actual, kind + ' 후보');
  assert.equal(actual.kind, kind);
  assert.ok(Math.abs(actual.x - expected.x) <= tolerance, 'x: ' + actual.x + ' vs ' + expected.x);
  assert.ok(Math.abs(actual.y - expected.y) <= tolerance, 'y: ' + actual.y + ' vs ' + expected.y);
}
const expectAt = (f, actual, p, kind, tolerance) => near(actual, relative(f.pack, p), kind, tolerance);

test('끝점은 열린 선의 모든 꼭짓점과 POINT 에 붙는다', () => {
  const points = [point(5000, 2000), point(5010, 2000), point(5010, 2010)];
  const f = fixture([
    {id: 'p', type: 'polyline', layer: 'W', color: '#ff0000', points},
    {id: 'dot', type: 'point', layer: 'W', color: '#ff0000', position: point(5020, 2020)},
  ]);
  assert.notDeepEqual(f.pack.sets[0].origin, point(0, 0), '모형 원점 이동도 검사한다');
  for (const p of [...points, point(5020, 2020)]) expectAt(f, snap(f, point(p.x + 0.03, p.y + 0.02), ['끝점']), p, '끝점');
});

test('중간점은 각 선분과 닫힌 선의 마지막 선분에도 붙는다', () => {
  const f = fixture([{id: 'p', type: 'polyline', layer: 'W', color: '#ff0000',
    points: [point(0, 0), point(10, 0), point(10, 10), point(0, 10)], closed: true}]);
  for (const p of [point(5, 0), point(10, 5), point(5, 10), point(0, 5)]) expectAt(f, snap(f, point(p.x + 0.02, p.y + 0.02), ['중간점']), p, '중간점');
});

test('PAIRS 는 쌍별 끝점·중간점·근처점만 쓰고 쌍 사이를 잇지 않는다', () => {
  const f = fixture([{id: 'h', type: 'hatch', layer: 'W', color: '#ff0000', solid: false, spacing: 10, angle: 0,
    points: [point(0, 0), point(40, 0), point(40, 40), point(0, 40)], loops: []}]);
  const {pack, snapper} = f, i = Array.from(pack.poly.flags).indexOf(FLAG_PAIRS);
  assert.ok(i >= 0);
  const start = pack.poly.start[i] * 2, end = start + pack.poly.len[i] * 2;
  for (let k = start; k < end; k += 4) {
    const a = point(pack.xy[k], pack.xy[k + 1]), b = point(pack.xy[k + 2], pack.xy[k + 3]);
    const mid = point((a.x + b.x) / 2, (a.y + b.y) / 2);
    for (const p of [a, b]) near(snapper.snap(p, {scale: 100, modes: new Set(['끝점'])}), p, '끝점');
    near(snapper.snap(mid, {scale: 100, modes: new Set(['중간점'])}), mid, '중간점');
    near(snapper.snap(point(mid.x, mid.y + 0.02), {scale: 100, modes: new Set(['근처점'])}), mid, '근처점');
    if (k + 4 < end) {
      const gap = point((b.x + pack.xy[k + 4]) / 2, (b.y + pack.xy[k + 5]) / 2);
      assert.equal(snapper.snap(gap, {scale: 100, modes: new Set(['중간점', '근처점'])}), null, '가짜 연결 선분 없음');
    }
  }
});

test('교차점은 두 선분의 세계 좌표 교점이다', () => {
  const f = fixture([line('a', [point(0, 0), point(20, 20)]), line('b', [point(0, 20), point(20, 0)])]);
  expectAt(f, snap(f, point(10.04, 10.02), ['교차점']), point(10, 10), '교차점');
});

test('교차점은 선분의 연장과 평행·겹친 선에서는 나오지 않는다', () => {
  const f = fixture([
    line('a', [point(0, 0), point(1, 0)]), line('b', [point(2, -1), point(2, 1)]),
    line('c', [point(0, 0), point(1, 0)]), line('d', [point(0, 0.1), point(1, 0.1)]),
  ]);
  assert.equal(snap(f, point(2, 0), ['교차점']), null);
  assert.equal(snap(f, point(0.5, 0), ['교차점']), null);
});

test('수직점은 from 의 수선 발이 선분 위에 있을 때만 나온다', () => {
  const f = fixture([line('a', [point(0, 0), point(10, 0)])]);
  expectAt(f, snap(f, point(5.03, 0.04), ['수직점'], {from: point(5, 9)}), point(5, 0), '수직점');
  assert.equal(snap(f, point(0, 0), ['수직점'], {from: point(-1, 9)}), null);
  assert.equal(snap(f, point(5, 0), ['수직점']), null);
});

test('중심점과 원의 네 사분점은 curve 기록에서 나온다', () => {
  const f = fixture([circle('c', 3000, 4000, 10)]);
  expectAt(f, snap(f, point(3000.02, 4000.01), ['중심점']), point(3000, 4000), '중심점');
  for (const p of [point(3010, 4000), point(3000, 4010), point(2990, 4000), point(3000, 3990)]) expectAt(f, snap(f, point(p.x + 0.02, p.y + 0.02), ['사분점']), p, '사분점');
});

test('원·호를 쪼갠 꼭짓점은 끝점·중간점이 아니다', () => {
  const f = fixture([circle('c', 0, 0, 10)]);
  assert.ok(f.pack.poly.flags[0] & FLAG_CURVE);
  const k = f.pack.poly.start[0] * 2, p = point(f.pack.xy[k], f.pack.xy[k + 1]);
  assert.equal(f.snapper.snap(p, {scale: 100, modes: new Set(['끝점', '중간점'])}), null);
});

test('호의 끝점과 사분점은 라디안 범위와 0° 경계를 따른다', () => {
  // 현재 묶음은 원본 각도를 그대로 기록한다. 이 시험은 curve의 라디안 계약을 넣는다.
  const f = fixture([{id: 'a', type: 'arc', layer: 'W', color: '#ff0000', center: point(100, 100),
    radius: 10, startAngle: 270, endAngle: 90}]);
  for (const p of [point(100, 90), point(100, 110)]) expectAt(f, snap(f, p, ['끝점']), p, '끝점');
  for (const p of [point(110, 100), point(100, 90), point(100, 110)]) expectAt(f, snap(f, p, ['사분점']), p, '사분점');
  assert.equal(snap(f, point(90, 100), ['사분점']), null);
  expectAt(f, snap(f, point(100, 100), ['중심점']), point(100, 100), '중심점');
});

test('근처점은 선분에 가장 가까운 점이고 끝을 넘어가면 끝에 붙는다', () => {
  const f = fixture([line('a', [point(0, 0), point(10, 0)]), line('b', [point(0, 1), point(10, 1)])]);
  expectAt(f, snap(f, point(3, 0.1), ['근처점']), point(3, 0), '근처점');
  expectAt(f, snap(f, point(10.05, 0.02), ['근처점']), point(10, 0), '근처점');
});

test('근처점은 더 가까워도 다른 종류 후보가 있으면 양보한다', () => {
  const f = fixture([line('a', [point(-10, 0), point(10, 0)]),
    {id: 'p', type: 'point', layer: 'W', color: '#ff0000', position: point(0, 1)}]);
  expectAt(f, snap(f, point(0, 0), ['근처점', '끝점'], {scale: 10}), point(0, 1), '끝점');
});

test('회전·배율·뒤집기·중첩 블록의 끝점은 CAD 펼치기와 같다', () => {
  const reference = (id, sharedBlock, position, scale, rotation, mirror = false) => ({id, type: 'block', sharedBlock, layer: 'W', color: '#ff0000', position, scale, rotation, mirror, entities: []});
  const refs = [
    reference('r1', 'DOOR', point(7000, 1000), 2, 30),
    reference('r2', 'DOOR', point(9000, -500), 0.5, 180, true),
    reference('r3', 'ROOM', point(-4000, 800), 1.5, 90, true),
    reference('r4', 'DOOR', point(3000, -3000), 0.02, -70, true),
  ];
  const f = fixture(refs, {
    DOOR: {origin: point(100, 50), entities: [{id: 'd', type: 'polyline', layer: 'L0', color: '#ffffff',
      points: [point(100, 50), point(900, 50), point(900, 120)]}]},
    ROOM: {origin: point(20, 30), entities: [reference('nested', 'DOOR', point(320, 30), 2, 15, true)]},
  });
  for (const ref of refs) {
    const resolved = materializeSharedDrawingReference(f.doc, ref), expected = [];
    const walk = e => { if (e.type === 'polyline') expected.push(...e.points); for (const child of e.entities || []) walk(child); };
    walk(resolved);
    assert.equal(expected.length, 3);
    for (const p of expected) expectAt(f, snap(f, p, ['끝점'], {scale: 20}), p, '끝점', 0.15);
  }
});

test('블록의 curve 중심·사분점·호 끝점도 같은 행렬로 놓인다', () => {
  const f = fixture([{id: 'r', type: 'block', sharedBlock: 'C', layer: 'W', position: point(100, 100), scale: 2, rotation: 90, mirror: true, entities: []}], {
    C: {origin: point(10, 20), entities: [
      circle('c', 10, 20, 5),
      {id: 'a', type: 'arc', layer: 'L0', color: '#ff0000', center: point(30, 20), radius: 5, startAngle: 0, endAngle: 90},
    ]},
  });
  expectAt(f, snap(f, point(100, 100), ['중심점']), point(100, 100), '중심점');
  for (const p of [point(100, 110), point(90, 100), point(100, 90), point(110, 100)]) expectAt(f, snap(f, p, ['사분점']), p, '사분점');
  for (const p of [point(100, 50), point(90, 60)]) expectAt(f, snap(f, p, ['끝점']), p, '끝점');
});

test('교차점은 서로 다른 블록과 모형 공간 사이에도 나온다', () => {
  const ref = (id, x, y, rotation) => ({id, type: 'block', sharedBlock: 'L', layer: 'W', position: point(x, y), scale: 1, rotation, entities: []});
  const f = fixture([
    ref('a', 100, 100, 0), ref('b', 110, 90, 90),
    line('model', [point(115, 90), point(115, 110)]),
  ], {L: {origin: point(5, 5), entities: [line('edge', [point(5, 5), point(25, 5)], 'L0')]}});
  for (const p of [point(110, 100), point(115, 100)]) expectAt(f, snap(f, point(p.x + 0.03, p.y + 0.02), ['교차점']), p, '교차점');
});

test('뒤집힌 블록의 수직점·근처점은 세계 좌표로 계산한다', () => {
  const f = fixture([{id: 'r', type: 'block', sharedBlock: 'L', layer: 'W', position: point(100, 100), scale: 2, rotation: 90, mirror: true, entities: []}],
    {L: {origin: point(0, 0), entities: [line('edge', [point(0, 0), point(10, 0)], 'L0')]}});
  expectAt(f, snap(f, point(100.04, 90.02), ['수직점'], {from: point(110, 90)}), point(100, 90), '수직점');
  expectAt(f, snap(f, point(100.04, 90.02), ['근처점']), point(100, 90.02), '근처점');
});

test('숨긴 레이어는 선·POINT·curve 후보와 교차점에서 빠진다', () => {
  const f = fixture([
    line('h', [point(0, 0), point(10, 0)], 'H'), line('w', [point(5, -10), point(5, 20)]),
    {id: 'p', type: 'point', layer: 'H', position: point(20, 0)},
    {...circle('c', 40, 0, 5), layer: 'H'},
  ]);
  let hidden = true;
  const layerShown = i => !(hidden && f.pack.header.layers[i]?.visible === false);
  for (const [p, modes] of [
    [point(0, 0), ['끝점']], [point(5, 0), ['중간점', '교차점', '수직점']],
    [point(2, 0), ['근처점']], [point(20, 0), ['끝점']], [point(40, 0), ['중심점']], [point(45, 0), ['사분점']],
  ]) assert.equal(snap(f, p, modes, {layerShown, from: point(5, 9)}), null);
  hidden = false;
  expectAt(f, snap(f, point(0, 0), ['끝점'], {layerShown}), point(0, 0), '끝점');
});

test('정의의 INHERIT 레이어는 각 인스턴스 레이어로 판정한다', () => {
  const ref = (id, x, layer) => ({id, type: 'block', sharedBlock: 'L', layer, position: point(x, 0), scale: 1, rotation: 0, entities: []});
  const f = fixture([ref('h', 100, 'H'), ref('w', 200, 'W')], {
    L: {origin: point(0, 0), entities: [line('inherited', [point(0, 0), point(10, 0)], 'L0'),
      line('explicit', [point(0, 10), point(10, 10)], 'W')]},
  });
  const layerShown = i => f.pack.header.layers[i]?.visible !== false;
  assert.equal(snap(f, point(100, 0), ['끝점'], {layerShown}), null);
  expectAt(f, snap(f, point(200, 0), ['끝점'], {layerShown}), point(200, 0), '끝점');
  expectAt(f, snap(f, point(100, 10), ['끝점'], {layerShown}), point(100, 10), '끝점');
});

test('동일 거리 우선순위는 끝점 > 교차점 > 중간점 > 중심점 > 사분점 > 수직점 > 근처점', () => {
  const f = fixture([
    {id: 'p', type: 'point', layer: 'W', position: point(0, 0)},
    line('h', [point(-10, 0), point(10, 0)]), line('v', [point(0, -10), point(0, 10)]),
    circle('center', 0, 0, 8), circle('quad', -8, 0, 8),
  ]);
  for (let i = 0; i < allModes.length; i++) expectAt(f, snap(f, point(0, 0), allModes.slice(i), {from: point(0, 5)}),
    point(0, 0), allModes[i]);
});

test('1px 이내 후보는 우선순위로, 그 밖 후보는 거리로 고른다', () => {
  const f = fixture([
    {id: 'p', type: 'point', layer: 'W', position: point(0.18, 0)},
    line('h', [point(-5, 0), point(5, 0)]), line('v', [point(0.09, -20), point(0.09, 10)]),
  ], {}, 0.001);
  expectAt(f, snap(f, point(0, 0), ['끝점', '교차점', '중간점'], {scale: 10, aperturePx: 3}), point(0.09, 0), '교차점');
  expectAt(f, snap(f, point(0.09, 0), ['끝점', '교차점'], {scale: 10}), point(0.18, 0), '끝점');
  expectAt(f, snap(f, point(0.09, 0), ['끝점', '교차점'], {scale: 100}), point(0.09, 0), '교차점');
});

test('반경은 aperturePx / scale 이고 원형 반경 밖은 null 이다', () => {
  const f = fixture([{id: 'p', type: 'point', layer: 'W', position: point(0, 0)}]);
  expectAt(f, snap(f, point(14, 0), ['끝점'], {scale: 1}), point(0, 0), '끝점');
  assert.equal(snap(f, point(14.001, 0), ['끝점'], {scale: 1}), null);
  assert.equal(snap(f, point(10, 10), ['끝점'], {scale: 1}), null);
  assert.equal(snap(f, point(1, 0), ['끝점'], {scale: 20, aperturePx: 10}), null);
  assert.equal(snap(f, point(0, 0), []), null);
});

test('큰 선분은 굵은 격자에서도 검색되고 블록 상자 밖 반경도 닿는다', () => {
  const f = fixture([
    line('long', [point(-1e8, 0), point(1e8, 0)]),
    ...Array.from({length: 100}, (_, i) => line('small' + i, [point(i, 100), point(i + 0.1, 100)])),
    {id: 'r', type: 'block', sharedBlock: 'L', layer: 'W', position: point(0, 1000), scale: 0.1, rotation: 0, entities: []},
  ], {L: {origin: point(0, 0), entities: [line('edge', [point(0, 0), point(10, 0)])]}});
  expectAt(f, snap(f, point(12345, 0.02), ['근처점']), point(12345, 0), '근처점');
  expectAt(f, snap(f, point(-0.1, 1000), ['끝점']), point(0, 1000), '끝점');
});

test('빈 묶음·잘못된 축척·퇴화 선분은 안전하게 처리한다', () => {
  const empty = fixture([]);
  assert.equal(snap(empty, point(0, 0), allModes), null);
  const f = fixture([line('zero', [point(0, 0), point(0, 0)])]);
  for (const scale of [0, -1, Infinity, NaN]) assert.equal(snap(f, point(0, 0), allModes, {scale}), null);
  assert.equal(snap(f, point(0, 0), ['교차점', '수직점'], {from: point(1, 1)}), null);
  expectAt(f, snap(f, point(0, 0), ['끝점']), point(0, 0), '끝점');
});

test('모형 공간과 레이어 0 인스턴스는 실제 0번 레이어의 숨김을 따른다', () => {
  const f = fixture([
    line('model', [point(0, 0), point(10, 0)], 'L0'),
    {id: 'p', type: 'point', layer: 'L0', position: point(30, 0)},
    {...circle('c', 60, 0, 5), layer: 'L0'},
    {id: 'r', type: 'block', sharedBlock: 'L', layer: 'L0', position: point(100, 0), scale: 1, rotation: 0, entities: []},
  ], {L: {origin: point(0, 0), entities: [line('inherited', [point(0, 0), point(10, 0)], 'L0')]}});
  const zero = f.pack.header.layers.findIndex(layer => layer.name === '0'), layerShown = i => i !== zero;
  for (const [p, modes] of [[point(0, 0), ['끝점']], [point(30, 0), ['끝점']], [point(60, 0), ['중심점']], [point(65, 0), ['사분점']], [point(100, 0), ['끝점']]]) {
    assert.equal(snap(f, p, modes, {layerShown}), null);
    expectAt(f, snap(f, p, modes), p, modes[0]);
  }
});

test('교차점은 반경 0과 반경 경계에 닿는 선분에서도 나온다', () => {
  const zero = fixture([line('a', [point(-10, -10), point(10, 10)]), line('b', [point(-10, 10), point(10, -10)])]);
  expectAt(zero, snap(zero, point(0, 0), ['교차점'], {aperturePx: 0}), point(0, 0), '교차점');
  const edge = fixture([line('a', [point(14, 0), point(20, 0)]), line('b', [point(14, -20), point(14, 20)])]);
  expectAt(edge, snap(edge, point(0, 0), ['교차점'], {scale: 1}), point(14, 0), '교차점');
});

test('호의 안쪽 사분점만 고르고 일반 각도 끝점도 정확하다', () => {
  const f = fixture([{id: 'a', type: 'arc', layer: 'W', center: point(0, 0), radius: 10,
    startAngle: 45, endAngle: 135}]);
  expectAt(f, snap(f, point(0, 10), ['사분점']), point(0, 10), '사분점');
  for (const p of [point(10, 0), point(-10, 0), point(0, -10)]) assert.equal(snap(f, p, ['사분점']), null);
  for (const angle of [Math.PI / 4, Math.PI * 3 / 4]) {
    const p = point(10 * Math.cos(angle), 10 * Math.sin(angle));
    expectAt(f, snap(f, p, ['끝점']), p, '끝점');
  }
});
