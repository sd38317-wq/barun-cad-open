// text-justify.js 시험 — 504 자리맞추기 15종, 맞춤점 고정, 맞춤·채움.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as G from './geometry.js';
import {TEXT_JUSTIFY, justifiedText, reanchorJustifiedText, withJustifiedAnchors, justifyFromDxf, justifyToDxf, TEXT_DESCENT} from './text-justify.js';

const near = (a, b, msg) => { assert.ok(Math.abs(a.x - b.x) < 1e-9 && Math.abs(a.y - b.y) < 1e-9, `${msg}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`); };

test('15종 모두 DXF 72/73 과 왕복한다', () => {
 assert.equal(Object.keys(TEXT_JUSTIFY).length, 15);
 for (const key of Object.keys(TEXT_JUSTIFY)) {
  const {halign, valign} = justifyToDxf(key);
  assert.equal(justifyFromDxf(halign, valign), key, key);
 }
 assert.equal(justifyFromDxf(9, 9), 'L');
});

test('수직 맞춤은 기준선을 맞춤점에서 높이 비율만큼 옮긴다(회전 포함)', () => {
 const p = {x: 100, y: 100};
 near(justifiedText({point: p, height: 10, key: 'TL'}).position, {x: 100, y: 90}, 'TL');
 near(justifiedText({point: p, height: 10, key: 'MC'}).position, {x: 100, y: 95}, 'MC');
 near(justifiedText({point: p, height: 10, key: 'BR'}).position, {x: 100, y: 100 + 10 * TEXT_DESCENT}, 'BR');
 near(justifiedText({point: p, height: 10, key: 'C'}).position, p, 'C');
 near(justifiedText({point: p, height: 10, key: 'TL', rotation: 90}).position, {x: 110, y: 100}, 'TL 90도');
 const mc = justifiedText({point: p, height: 10, key: 'MC'});
 assert.equal(mc.align, 'center'); assert.equal(mc.justify, 'MC'); near(mc.alignPoint, p, '맞춤점');
 const left = justifiedText({point: p, height: 10, key: 'L'});
 assert.equal(left.justify, undefined); assert.equal(left.align, undefined);   // 왼쪽 문자는 예전 문자와 똑같다
});

test('맞춤(A)은 높이를, 채움(F)은 폭 비율을 두 끝점 사이에 맞춘다', () => {
 const a = {x: 0, y: 0}, b = {x: 0, y: 260};
 const aligned = justifiedText({point: a, second: b, height: 999, key: 'A', text: 'ABCD'});
 assert.equal(aligned.rotation, 90);
 assert.ok(Math.abs(G.textLineUnits('ABCD') * aligned.height * aligned.widthFactor - 260) < 1e-9);
 near(aligned.position, {x: 0, y: 130}, '가운데');
 const fit = justifiedText({point: a, second: {x: 520, y: 0}, height: 100, key: 'F', text: 'ABCD'});
 assert.equal(fit.height, 100); assert.ok(Math.abs(fit.widthFactor - 2) < 1e-9);
 assert.throws(() => justifiedText({point: a, second: a, height: 10, key: 'F', text: 'x'}), /두 끝점/);
});

test('높이를 바꾸면 맞춤점이 고정되도록 위치를 다시 계산한다', () => {
 const e = {type: 'text', id: 't', text: '가', ...justifiedText({point: {x: 0, y: 0}, height: 10, key: 'TC'})};
 assert.equal(reanchorJustifiedText(e), null);
 const changed = reanchorJustifiedText({...e, height: 20});
 near(changed.position, {x: 0, y: -20}, '높이 20');
 assert.equal(reanchorJustifiedText({type: 'text', text: 'x', position: {x: 0, y: 0}, height: 1}), null);
});

test('withJustifiedAnchors: 맞춤 문자만 고치고 나머지는 같은 명령을 돌려준다', () => {
 const t = {type: 'text', id: 't', text: '가', ...justifiedText({point: {x: 0, y: 0}, height: 10, key: 'MC'})};
 const plain = {type: 'text', id: 'p', text: '나', position: {x: 5, y: 5}, height: 10};
 const lookup = ids => [t, plain].filter(e => ids.includes(e.id));
 const color = {type: 'update', ids: ['t'], changes: {color: '#fff'}};
 assert.equal(withJustifiedAnchors(color, lookup), color);
 const onlyPlain = {type: 'update', ids: ['p'], changes: {height: 30}};
 assert.equal(withJustifiedAnchors(onlyPlain, lookup), onlyPlain);
 const out = withJustifiedAnchors({type: 'update', ids: ['t', 'p'], changes: {height: 20}}, lookup);
 assert.equal(out.type, 'updateMany'); assert.equal(out.ids, undefined);
 near(out.updates.find(u => u.id === 't').changes.position, {x: 0, y: -10}, 'MC 높이 20');
 assert.deepEqual(out.updates.find(u => u.id === 'p').changes, {height: 20});
 // 위치를 직접 옮기면 맞춤점도 같이 옮긴다.
 const moved = withJustifiedAnchors({type: 'updateMany', updates: [{id: 't', changes: {position: {x: 100, y: -5}}}]}, lookup);
 near(moved.updates[0].changes.alignPoint, {x: 100, y: 0}, '맞춤점 이동');
 // 정렬을 직접 바꾸면(TJ) 맞춤 정보를 내려놓는다 — 다음 편집에서 예전 정렬로 튀지 않게.
 const tj = withJustifiedAnchors({type: 'update', ids: ['t'], changes: {align: 'left', position: {x: -3, y: -5}}}, lookup);
 assert.deepEqual(tj.updates[0].changes, {align: 'left', position: {x: -3, y: -5}, justify: null, alignPoint: null, fitTo: null});
 assert.equal(reanchorJustifiedText({...t, ...tj.updates[0].changes}), null);
});

test('대칭 복사한 맞춤 문자는 맞춤 정보를 내려놓고 보이는 위치를 유지한다', () => {
 const t = {type: 'text', id: 't', text: 'A', ...justifiedText({point: {x: 0, y: 10}, height: 5, key: 'TL'})};
 const m = G.mirror(t, {x: 0, y: 0}, {x: 1, y: 0});
 assert.equal(m.justify, undefined); assert.equal(m.alignPoint, undefined);
 near(m.position, {x: 0, y: -5}, '대칭 위치');
});

test('이동·회전 변환이 맞춤점도 같이 옮긴다(geometry.transformEntity)', () => {
 const t = {type: 'text', id: 't', text: 'A', ...justifiedText({point: {x: 10, y: 0}, second: {x: 20, y: 0}, height: 5, key: 'F', text: 'A'})};
 const moved = G.translate(t, 5, 7);
 near(moved.alignPoint, {x: 15, y: 7}, 'alignPoint'); near(moved.fitTo, {x: 25, y: 7}, 'fitTo');
 const turned = G.rotate(t, {x: 0, y: 0}, 90);
 near(turned.alignPoint, {x: 0, y: 10}, '회전');
 assert.equal(reanchorJustifiedText(turned), null);   // 회전 뒤에도 맞춤점과 위치가 서로 맞다
});
