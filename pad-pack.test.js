import test from 'node:test';
import assert from 'node:assert/strict';
import {packDrawing, encodePadPack, decodePadPack, flattenInstances, INHERIT, FLAG_CLOSED, FLAG_PAIRS} from './pad-pack.js';
import {materializeSharedDrawingReference} from './geometry.js';

const layers = [{id: 'L0', name: '0', color: '#ffffff'}, {id: 'W', name: 'A-WALL', color: '#ff0000'}, {id: 'H', name: 'A-HATCH', color: '#00ff00', visible: false}];
const doc = {
  units: 'mm', layers,
  entities: [
    {id: 'a', type: 'line', layer: 'W', color: '#ff0000', points: [{x: 1000.04, y: 2000}, {x: 5000, y: 2000.06}]},
    {id: 'b', type: 'circle', layer: 'W', color: '#ff0000', center: {x: 3000, y: 3000}, radius: 500},
    {id: 'c', type: 'text', layer: 'W', color: '#ff0000', position: {x: 100, y: 100}, text: '거실', height: 250, rotation: 90, align: 'center'},
    {id: 'd', type: 'hatch', layer: 'H', color: '#00ff00', points: [{x: 0, y: 0}, {x: 1000, y: 0}, {x: 1000, y: 1000}, {x: 0, y: 1000}], loops: [], solid: false, spacing: 100, angle: 45},
    {id: 'e', type: 'hatch', layer: 'H', color: '#00ff00', points: [{x: 2000, y: 0}, {x: 2500, y: 0}, {x: 2500, y: 500}], loops: [], solid: true},
    {id: 'r1', type: 'block', name: 'DOOR', sharedBlock: 'DOOR', layer: 'W', color: '#0000ff', position: {x: 7000, y: 1000}, scale: 2, rotation: 30, entities: []},
    {id: 'r2', type: 'block', name: 'DOOR', sharedBlock: 'DOOR', layer: 'W', color: '#0000ff', position: {x: 9000, y: -500}, scale: 1, rotation: 180, mirror: true, entities: []},
    {id: 'r3', type: 'block', name: 'ROOM', sharedBlock: 'ROOM', layer: 'W', color: '#0000ff', position: {x: -4000, y: 800}, scale: 1, rotation: 90, entities: []},
  ],
  sharedBlocks: {
    DOOR: {origin: {x: 100, y: 50}, entities: [
      {id: 'd1', type: 'polyline', layer: 'L0', color: '#ffffff', colorMode: 'byblock', points: [{x: 100, y: 50}, {x: 900, y: 50}, {x: 900, y: 120}], closed: false},
    ]},
    ROOM: {origin: {x: 0, y: 0}, entities: [
      {id: 'm1', type: 'line', layer: 'W', color: '#ff0000', points: [{x: 0, y: 0}, {x: 300, y: 0}]},
      {id: 'm2', type: 'block', name: 'DOOR', sharedBlock: 'DOOR', layer: 'W', color: '#0000ff', position: {x: 300, y: 0}, scale: 1, rotation: 0, entities: []},
    ]},
  },
};

const roundTrip = () => decodePadPack(encodePadPack(packDrawing(doc, {name: 't'})));

test('묶음은 바이트로 갔다 와도 좌표가 0.1 안에서 같다', () => {
  const pack = roundTrip(), origin = pack.sets[0].origin;
  const first = [pack.xy[0] + origin.x, pack.xy[1] + origin.y, pack.xy[2] + origin.x, pack.xy[3] + origin.y];
  [1000.04, 2000, 5000, 2000.06].forEach((v, i) => assert.ok(Math.abs(first[i] - v) <= 0.05 + 1e-9, `${i}: ${first[i]} vs ${v}`));
  assert.equal(pack.header.layers[pack.poly.layer[0]].name, 'A-WALL');
  assert.equal(pack.header.layers.find(l => l.name === 'A-HATCH').visible, false);
});

test('글자·원·채운 해치·무늬 해치가 들어간다', () => {
  const pack = roundTrip();
  assert.equal(pack.text.str.length, 1);
  assert.equal(pack.header.strings[pack.text.str[0]], '거실');
  assert.ok(Math.abs(pack.text.rot[0] - Math.PI / 2) < 1e-6);
  assert.equal(pack.curve.kind.length, 1);
  assert.equal(pack.fill.rings.length, 1);
  const flags = Array.from(pack.poly.flags);
  assert.ok(flags.includes(FLAG_PAIRS), '무늬 선분');
  assert.ok(!flags.includes(FLAG_CLOSED), '해치 경계선은 그리지 않는다(CAD 와 같게)');
});

test('무늬 선분은 경계 밖으로 나가지 않는다', () => {
  const pack = roundTrip(), origin = pack.sets[0].origin;
  const i = Array.from(pack.poly.flags).indexOf(FLAG_PAIRS);
  for (let k = 0; k < pack.poly.len[i]; k++) {
    const j = (pack.poly.start[i] + k) * 2, x = pack.xy[j] + origin.x, y = pack.xy[j + 1] + origin.y;
    assert.ok(x >= -0.06 && x <= 1000.06 && y >= -0.06 && y <= 1000.06, `${x},${y}`);
  }
});

test('펼친 블록 위치가 CAD 의 블록 펼치기와 같다(배율·회전·뒤집기·중첩)', () => {
  const pack = roundTrip(), origin = pack.sets[0].origin;
  const placed = flattenInstances(pack);
  const doorSet = pack.sets.findIndex(s => s.name === 'DOOR');
  const doors = placed.filter(p => p.set === doorSet);
  assert.equal(doors.length, 3, '직접 2 + ROOM 안 1');
  const points = p => {
    const set = pack.sets[p.set], out = [];
    for (let i = set.poly[0]; i < set.poly[0] + set.poly[1]; i++) for (let k = 0; k < pack.poly.len[i]; k++) {
      const j = (pack.poly.start[i] + k) * 2, x = pack.xy[j], y = pack.xy[j + 1], m = p.m;
      out.push({x: m[0] * x + m[2] * y + m[4] + origin.x, y: m[1] * x + m[3] * y + m[5] + origin.y});
    }
    return out;
  };
  const expected = ref => {
    const resolved = materializeSharedDrawingReference(doc, ref), out = [];
    const walk = e => { if (e.type === 'polyline' && e.points) out.push(...e.points); for (const c of e.entities || []) walk(c); };
    walk(resolved);
    return out;
  };
  const near = (a, b) => a.length === b.length && a.every((p, i) => Math.abs(p.x - b[i].x) < 0.2 && Math.abs(p.y - b[i].y) < 0.2);
  assert.ok(near(points(doors[0]), expected(doc.entities[5])), '배율 2·30°');
  assert.ok(near(points(doors[1]), expected(doc.entities[6])), '뒤집기·180°');
  const nested = doors.find(d => d !== doors[0] && d !== doors[1]);
  assert.ok(near(points(nested), expected(doc.entities[7])), 'ROOM 안 DOOR(90°)');
});

test('레이어 0·BYBLOCK 은 놓인 블록을 따른다', () => {
  const pack = roundTrip();
  const doorSet = pack.sets.find(s => s.name === 'DOOR');
  assert.equal(pack.poly.layer[doorSet.poly[0]], INHERIT);
  assert.equal(pack.poly.color[doorSet.poly[0]], INHERIT);
  const door = flattenInstances(pack).find(p => p.set === pack.sets.indexOf(doorSet));
  assert.equal(pack.header.layers[door.layer].name, 'A-WALL');
  assert.equal(pack.header.colors[door.color], '#0000ff');
});

test('묶음이 아닌 바이트는 거절한다', () => {
  assert.throws(() => decodePadPack(new Uint8Array(16)), /형식이 아닙니다/);
});

test('점선·폭 있는 선·BYBLOCK 선 종류가 선 모양 표로 간다', () => {
  const d = {units: 'mm', layers: [{id: 'L0', name: '0'}, {id: 'C', name: 'A-CENT', linetype: 'CENTER'}],
    entities: [
      {id: 'h', type: 'line', layer: 'C', points: [{x: 0, y: 0}, {x: 1000, y: 0}]},
      {id: 'w', type: 'polyline', layer: 'L0', constantWidth: 50, points: [{x: 0, y: 100}, {x: 1000, y: 100}]},
      {id: 'r', type: 'block', name: 'B', sharedBlock: 'B', layer: 'L0', linetype: 'HIDDEN', position: {x: 0, y: 0}, scale: 1, rotation: 0, entities: []},
    ],
    sharedBlocks: {B: {origin: {x: 0, y: 0}, entities: [{id: 'b1', type: 'line', layer: 'L0', linetype: 'BYBLOCK', points: [{x: 0, y: 0}, {x: 10, y: 0}]}]}}};
  const pack = decodePadPack(encodePadPack(packDrawing(d)));
  const styles = pack.header.styles;
  const lineStyle = styles[pack.poly.style[0]];
  assert.ok(lineStyle.dash.length >= 2, '레이어 CENTER → 점선');
  assert.equal(styles[pack.poly.style[1]].cw, 50, '폭 있는 폴리선');
  const blockSet = pack.sets.findIndex(s => s.name === 'B');
  assert.equal(pack.poly.style[pack.sets[blockSet].poly[0]], INHERIT, 'BYBLOCK');
  const placed = flattenInstances(pack).find(p => p.set === blockSet);
  assert.ok(styles[placed.style].dash.length >= 2, '놓인 블록의 HIDDEN 을 따른다');
});

test('XCLIP 으로 잘린 블록은 굽는 단계에서 잘린다', () => {
  const d = {units: 'mm', layers: [{id: 'L0', name: '0'}],
    entities: [{id: 'blk', type: 'block', name: 'X', layer: 'L0', clip: {enabled: true, points: [{x: 0, y: 0}, {x: 50, y: 0}, {x: 50, y: 50}, {x: 0, y: 50}]},
      entities: [{id: 'c1', type: 'line', layer: 'L0', points: [{x: -100, y: 25}, {x: 100, y: 25}]}]}]};
  const pack = decodePadPack(encodePadPack(packDrawing(d)));
  const o = pack.sets[0].origin, xs = [];
  for (let k = 0; k < pack.poly.len[0]; k++) xs.push(pack.xy[(pack.poly.start[0] + k) * 2] + o.x);
  assert.equal(pack.poly.flags[0] & FLAG_PAIRS, FLAG_PAIRS);
  assert.ok(Math.min(...xs) >= -0.1 && Math.max(...xs) <= 50.1, xs.join(','));
});
