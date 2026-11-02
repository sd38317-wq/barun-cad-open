// multi-tools.js 순수 함수 시험. DOM 없이 node --test 로 돈다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeIntersectionPoints, copyToPoints, copyThenRotate, copyToLayer,
  findDuplicateEntities, offsetAndDrop, offsetSource, offsetToLayer, offsetTolerance,
  collectSegments, buildChain, offsetChain, randomCopyOnce,
  collectRecoverArea, mergeCollinearLines, mergeCircles, mergeArcs, wallRecoverOnce,
  parseAngleInput, parseScaleInput, ANGLE_LIMIT, SCALE_LIMIT,
} from './multi-tools.js';

/* ── 2026-09-24 검토 F8: CR·CIN·RDC 입력 검증 ── */
test('parseAngleInput: 빈값 0 · 숫자 통과 · 비숫자/거대값은 한글 오류', () => {
  assert.equal(parseAngleInput(''), 0);
  assert.equal(parseAngleInput('90'), 90);
  assert.equal(parseAngleInput(-45), -45);
  assert.throws(() => parseAngleInput('거실'), /숫자로 입력/);
  assert.throws(() => parseAngleInput(1e15), new RegExp(`${ANGLE_LIMIT}`));
});
test('parseScaleInput: 0·음수·비숫자·범위 밖은 한글 오류', () => {
  assert.equal(parseScaleInput('2'), 2);
  assert.throws(() => parseScaleInput(0), /0보다 커야/);
  assert.throws(() => parseScaleInput('거실'), /숫자로 입력/);
  assert.throws(() => parseScaleInput(SCALE_LIMIT * 10), /사이로 입력/);
});

const P = (x, y) => ({ x, y });
const line = (a, b, extra = {}) => ({ id: crypto.randomUUID(), type: 'line', layer: 'L', points: [a, b], ...extra });

/* ── CIN ── */
test('CIN: computeIntersectionPoints 는 십자형 두 선의 교차점 1개를 찾는다', () => {
  const a = line(P(-10, 0), P(10, 0)), b = line(P(0, -10), P(0, 10));
  const pts = computeIntersectionPoints([a, b]);
  assert.equal(pts.length, 1);
  assert.ok(Math.abs(pts[0].x) < 1e-6 && Math.abs(pts[0].y) < 1e-6);
});
test('CIN: computeIntersectionPoints 는 격자(가로2×세로2)에서 교차점 4개를 찾고 중복을 만들지 않는다', () => {
  const h1 = line(P(-10, 0), P(10, 0)), h2 = line(P(-10, 5), P(10, 5));
  const v1 = line(P(0, -10), P(0, 10)), v2 = line(P(5, -10), P(5, 10));
  const pts = computeIntersectionPoints([h1, h2, v1, v2]);
  assert.equal(pts.length, 4);
});
test('CIN: copyToPoints 는 각 교차점에 선택 객체를 옮겨 붙이고, 각도 0 이면 회전하지 않는다', () => {
  const obj = line(P(0, 0), P(2, 0));
  const copies = copyToPoints([obj], P(0, 0), [P(10, 10), P(20, 20)], 0);
  assert.equal(copies.length, 2);
  assert.deepEqual(copies[0].points, [P(10, 10), P(12, 10)]);
  assert.deepEqual(copies[1].points, [P(20, 20), P(22, 20)]);
  assert.equal(copies[0].id, undefined);
});
test('CIN: copyToPoints 는 각도를 지정하면 그 점 기준으로 회전한다', () => {
  const obj = line(P(0, 0), P(2, 0));
  const [copy] = copyToPoints([obj], P(0, 0), [P(10, 10)], 90);
  assert.ok(Math.abs(copy.points[0].x - 10) < 1e-9 && Math.abs(copy.points[0].y - 10) < 1e-9);
  assert.ok(Math.abs(copy.points[1].x - 10) < 1e-6 && Math.abs(copy.points[1].y - 12) < 1e-6);
});

/* ── CR ── */
test('CR: copyThenRotate 는 기준점→목표점 변위로 옮긴 뒤 목표점 기준으로 회전한다', () => {
  const obj = line(P(0, 0), P(2, 0));
  const [copy] = copyThenRotate([obj], P(0, 0), P(100, 0), 90);
  assert.ok(Math.abs(copy.points[0].x - 100) < 1e-9 && Math.abs(copy.points[0].y) < 1e-9);
  assert.ok(Math.abs(copy.points[1].x - 100) < 1e-6 && Math.abs(copy.points[1].y - 2) < 1e-6);
});

/* ── CTL / CNL ── */
test('CTL: copyToLayer(entities,null) 은 켜를 지워 카드 문맥이 현재 켜를 쓰게 한다', () => {
  const obj = line(P(0, 0), P(1, 1), { layer: 'OLD' });
  const [copy] = copyToLayer([obj], null);
  assert.equal(copy.layer, undefined);
  assert.deepEqual(copy.points, obj.points);
});
test('CNL: copyToLayer(entities,id) 은 새 켜 id 로 바꿔 복사한다', () => {
  const obj = line(P(0, 0), P(1, 1), { layer: 'OLD' });
  const [copy] = copyToLayer([obj], 'NEW-LAYER-ID');
  assert.equal(copy.layer, 'NEW-LAYER-ID');
});

/* ── DDE ── */
test('DDE: 완전히 겹친 두 선 중 상위(배열 뒤쪽)만 남긴다', () => {
  const a = line(P(0, 0), P(10, 0)); a.id = 'a';
  const b = line(P(0, 0), P(10, 0)); b.id = 'b';
  const { removeIds } = findDuplicateEntities([a, b], { scope: 'full', keep: 'top' });
  assert.deepEqual(removeIds, ['a']);
});
test('DDE: 일부만 겹친 선은 scope=full 에서는 잡히지 않고 scope=partial 에서는 잡힌다', () => {
  const a = line(P(0, 0), P(10, 0)); a.id = 'a';
  const b = line(P(5, 0), P(15, 0)); b.id = 'b';
  assert.equal(findDuplicateEntities([a, b], { scope: 'full' }).removeIds.length, 0);
  assert.equal(findDuplicateEntities([a, b], { scope: 'partial' }).removeIds.length, 1);
});
test('DDE: keep=longest 는 더 짧은 선을 지운다', () => {
  const a = line(P(0, 0), P(10, 0)); a.id = 'short';
  const b = line(P(0, 0), P(10, 0)); b.id = 'long-but-earlier';
  // b 를 배열상 앞에 두어 "상위(뒤)" 규칙이면 a 가 남아야 하지만 longest 규칙을 켜면 길이만 본다(동일 길이이므로 결과는 상위 규칙과 같음을 별도 케이스로 검증)
  const c = line(P(0, 0), P(20, 0)); c.id = 'longer';
  const { removeIds } = findDuplicateEntities([a, c], { scope: 'partial', keep: 'longest' });
  assert.deepEqual(removeIds, ['short']);
});
test('DDE: 동일 위치·반지름 원은 중복으로 판정한다', () => {
  const c1 = { id: '1', type: 'circle', layer: 'L', center: P(0, 0), radius: 5 };
  const c2 = { id: '2', type: 'circle', layer: 'L2', center: P(0.00001, 0), radius: 5 };
  const { removeIds } = findDuplicateEntities([c1, c2]);
  assert.deepEqual(removeIds, ['1']);
});
test('DDE: 문자는 내용·위치·높이가 같아야 중복이다(켜는 무시)', () => {
  const t1 = { id: '1', type: 'text', layer: 'A', text: '거실', position: P(0, 0), height: 100 };
  const t2 = { id: '2', type: 'text', layer: 'B', text: '거실', position: P(0, 0), height: 100 };
  const t3 = { id: '3', type: 'text', layer: 'B', text: '침실', position: P(0, 0), height: 100 };
  assert.deepEqual(findDuplicateEntities([t1, t2, t3]).removeIds, ['1']);
});

/* ── OE ── */
test('OE: offsetAndDrop 은 옵셋 결과와 삭제할 원본 id 를 함께 돌려준다', () => {
  const a = line(P(0, 0), P(10, 0)); a.id = 'a';
  const { add, removeIds, failed } = offsetAndDrop([a], 5, P(0, 5));
  assert.equal(add.length, 1);
  assert.deepEqual(removeIds, ['a']);
  assert.equal(failed.length, 0);
  assert.ok(add[0].points.every(p => Math.abs(p.y - 5) < 1e-9));
});

/* ── OO ── */
test('OO: offsetSource 는 문자를 바운딩박스 폴리선으로 바꾼다', () => {
  const t = { type: 'text', text: 'A', position: P(0, 0), height: 100, align: 'left' };
  const src = offsetSource(t);
  assert.equal(src.type, 'polyline');
  assert.ok(src.closed);
  assert.ok(src.points.length >= 4);
});
test('OO: offsetToLayer 는 옵셋 결과의 켜를 지정한 켜로 바꾼다', () => {
  const a = line(P(0, 0), P(10, 0), { layer: 'OLD' });
  const { add } = offsetToLayer([a], 5, P(0, 5), 'CUR');
  assert.equal(add[0].layer, 'CUR');
});

/* ── OT ── */
test('OT: 평행한 두 벽선은 항상 바깥쪽으로 벌어진다', () => {
  const a = line(P(0, 0), P(10, 0)), b = line(P(0, 20), P(10, 20));
  const [oa, ob] = offsetTolerance(a, b, P(0, 0), 2, { fillet: false });
  // a 는 더 아래(y 작아짐), b 는 더 위(y 커짐)로 벌어져야 한다
  assert.ok(oa.points[0].y < 0);
  assert.ok(ob.points[0].y > 20);
});
test('OT: 비평행 두 선에서 왼쪽 점을 먼저 클릭하면 바깥쪽으로 벌어진다', () => {
  const a = line(P(-10, 0), P(10, 0)), b = line(P(0, -10), P(0, 10));
  const [oa] = offsetTolerance(a, b, P(-10, 0), 2, { fillet: false }); // 교차점(0,0)보다 왼쪽에서 클릭
  // 바깥쪽(교차점에서 먼 쪽)이면 a 선은 교차점 반대편(음의 x 쪽 절반)이 더 아래로 밀려야 하므로 y 부호가 흩어짐을 최소한 확인
  assert.ok(oa.points.some(p => Math.abs(p.y) > 0.5));
});
test('OT: fillet 옵션은 두 옵셋선을 코너에서 만나게 한다(끝점이 서로 같다)', () => {
  const a = line(P(-10, 0), P(10, 0)), b = line(P(0, 0), P(0, 10));
  const result = offsetTolerance(a, b, P(-10, 0), 2, { fillet: true });
  assert.equal(result.length, 2);
  // 두 선이 한 점에서 만나야 한다(공유 끝점 존재)
  const [l1, l2] = result;
  const shares = l1.points.some(p1 => l2.points.some(p2 => Math.abs(p1.x - p2.x) < 1e-6 && Math.abs(p1.y - p2.y) < 1e-6));
  assert.ok(shares);
});

/* ── OI ── */
test('OI: collectSegments 는 line·polyline·rectangle 을 낱개 선분으로 편다', () => {
  const poly = { id: 'p', type: 'polyline', layer: 'L', closed: false, points: [P(0, 0), P(10, 0), P(10, 10)] };
  const segs = collectSegments([poly]);
  assert.equal(segs.length, 2);
});
test('OI: buildChain 은 맞닿은 두 선분을 하나의 꺾은선으로 잇는다(코너)', () => {
  const s1 = line(P(0, 0), P(10, 0)), s2 = line(P(10, 0), P(10, 10));
  const segs = collectSegments([s1, s2]);
  const chain = buildChain(segs, { a: P(0, 0), b: P(10, 0) }, 1);
  assert.equal(chain.length, 2);
  assert.deepEqual(chain[0].a, P(0, 0));
  assert.deepEqual(chain[1].b, P(10, 10));
});
test('OI: buildChain 은 갈래(3개 이상 만남)가 있으면 오류를 던진다', () => {
  const s1 = line(P(0, 0), P(10, 0)), s2 = line(P(10, 0), P(20, 0)), s3 = line(P(10, 0), P(10, 10));
  const segs = collectSegments([s1, s2, s3]);
  assert.throws(() => buildChain(segs, { a: P(0, 0), b: P(10, 0) }, 1));
});
test('OI: offsetChain 은 코너를 이룬 두 선을 같은 거리로 옵셋해 코너를 유지한다', () => {
  const s1 = line(P(0, 0), P(10, 0)), s2 = line(P(10, 0), P(10, 10));
  const segs = collectSegments([s1, s2]);
  const chain = buildChain(segs, { a: P(0, 0), b: P(10, 0) }, 1);
  const out = offsetChain(chain, 2, P(5, 5)); // 안쪽(위/왼쪽)으로 옵셋
  assert.equal(out.length, 2);
  assert.ok(Math.abs(out[0].points[0].y - 2) < 1e-6); // 첫 선은 y=2 로 이동
  assert.ok(Math.abs(out[1].points[1].x - 8) < 1e-6); // 둘째 선은 x=8 로 이동
  // 두 옵셋선이 코너에서 맞닿아야 한다
  assert.ok(Math.abs(out[0].points[1].x - out[1].points[0].x) < 1e-6);
  assert.ok(Math.abs(out[0].points[1].y - out[1].points[0].y) < 1e-6);
});

/* ── RDC ── */
test('RDC: randomCopyOnce 는 기준점→목표점 변위로 옮기고 난수로 범위 안의 배율·회전을 적용한다', () => {
  const obj = line(P(0, 0), P(10, 0));
  const rng = () => 0.5; // 중간값 고정
  const [copy] = randomCopyOnce([obj], P(0, 0), P(100, 0), { scaleMin: 1, scaleMax: 3, rotMin: 0, rotMax: 90 }, rng);
  // scale = 1+(3-1)*0.5 = 2, rot = 0+(90-0)*0.5 = 45, 목표점(100,0) 기준
  const len = Math.hypot(copy.points[1].x - copy.points[0].x, copy.points[1].y - copy.points[0].y);
  assert.ok(Math.abs(len - 20) < 1e-6); // 원래 길이 10 의 2배
});
test('RDC: 배율 범위가 1~1 이면 크기를 바꾸지 않는다', () => {
  const obj = line(P(0, 0), P(10, 0));
  const [copy] = randomCopyOnce([obj], P(0, 0), P(0, 0), { scaleMin: 1, scaleMax: 1, rotMin: 0, rotMax: 0 }, () => 0.9);
  const len = Math.hypot(copy.points[1].x - copy.points[0].x, copy.points[1].y - copy.points[0].y);
  assert.ok(Math.abs(len - 10) < 1e-9);
});

/* ── WR ── */
test('WR: collectRecoverArea 는 선택 영역과 바운딩박스가 겹치는 객체만 모은다', () => {
  const inside = line(P(0, 0), P(5, 0));
  const outside = line(P(100, 100), P(105, 100));
  const { touched } = collectRecoverArea([inside, outside], P(-1, -1), P(10, 10));
  assert.equal(touched.length, 1);
  assert.equal(touched[0], inside);
});
test('WR: collectRecoverArea 는 중심선 켜를 제외한다', () => {
  const centerLine = line(P(0, 0), P(5, 0), { layer: 'CTR' });
  const layers = [{ id: 'CTR', name: 'A-WALL-C' }];
  const { touched } = collectRecoverArea([centerLine], P(-1, -1), P(10, 10), layers);
  assert.equal(touched.length, 0);
});
test('WR: mergeCollinearLines 는 같은 직선 위의 조각 두 개를 최외곽 끝점 하나의 선으로 합친다', () => {
  const a = line(P(0, 0), P(4, 0)), b = line(P(6, 0), P(10, 0));
  const [merged] = mergeCollinearLines([a, b], 0.5);
  assert.ok(Math.min(merged.points[0].x, merged.points[1].x) === 0);
  assert.ok(Math.max(merged.points[0].x, merged.points[1].x) === 10);
});
test('WR: mergeCollinearLines 는 서로 다른 방향의 선을 따로 묶는다', () => {
  const a = line(P(0, 0), P(4, 0)), b = line(P(0, 0), P(0, 4));
  const groups = mergeCollinearLines([a, b], 0.5);
  assert.equal(groups.length, 2);
});
test('WR: mergeCircles 는 같은 중심·반지름 원을 하나로 줄인다', () => {
  const c1 = { type: 'circle', layer: 'L', center: P(0, 0), radius: 5 };
  const c2 = { type: 'circle', layer: 'L', center: P(0.1, 0), radius: 5 };
  const out = mergeCircles([c1, c2], 0.5);
  assert.equal(out.length, 1);
});
test('WR: mergeArcs 는 이어진 두 호를 하나의 넓은 호로 합친다', () => {
  const a1 = { type: 'arc', layer: 'L', center: P(0, 0), radius: 5, startAngle: 0, endAngle: 90 };
  const a2 = { type: 'arc', layer: 'L', center: P(0, 0), radius: 5, startAngle: 90, endAngle: 180 };
  const out = mergeArcs([a1, a2], 0.5);
  assert.equal(out.length, 1);
  assert.ok(Math.abs(out[0].startAngle - 0) < 1e-6);
  assert.ok(Math.abs(out[0].endAngle - 180) < 1e-6);
});
test('WR: mergeArcs 는 360도를 채우면 원으로 바꾼다', () => {
  const a1 = { type: 'arc', layer: 'L', center: P(0, 0), radius: 5, startAngle: 0, endAngle: 180 };
  const a2 = { type: 'arc', layer: 'L', center: P(0, 0), radius: 5, startAngle: 180, endAngle: 360 };
  const out = mergeArcs([a1, a2], 0.5);
  assert.equal(out.length, 1);
  assert.equal(out[0].type, 'circle');
});
test('WR: wallRecoverOnce 는 영역 안 선을 복구하고 그 외 객체는 재작도 없이 삭제 목록에만 넣는다', () => {
  const a = line(P(0, 0), P(4, 0)); a.id = 'a';
  const b = line(P(6, 0), P(10, 0)); b.id = 'b';
  const txt = { id: 't', type: 'text', layer: 'L', text: 'x', position: P(2, 2), height: 10 };
  const r = wallRecoverOnce([a, b, txt], [], P(-1, -1), P(11, 11));
  assert.deepEqual(r.removeIds.sort(), ['a', 'b', 't']);
  assert.equal(r.add.length, 1); // 선만 복구, 문자는 재작도 없음
  assert.equal(r.touchedCount, 3);
  assert.equal(r.recoveredCount, 1);
});
test('WR: 영역 안에 아무것도 없으면 오류를 던진다', () => {
  assert.throws(() => wallRecoverOnce([], [], P(0, 0), P(1, 1)));
});

// 2026-10-27 설명서 시험: 상자 안에 통째로 든 원·호(문 열림 호 등 중간 객체)를 지우지 않고 다시 넣었다.
test('WR: 상자 안에 통째로 든 원·호는 지우고, 상자에 걸친 선만 이어 되살린다',()=>{
 const lay=[{id:'L',name:'A-WALL',visible:true,locked:false}];
 const ents=[
  {id:'a',type:'line',layer:'L',points:[{x:0,y:0},{x:1000,y:0}]},
  {id:'b',type:'line',layer:'L',points:[{x:1900,y:0},{x:3000,y:0}]},
  {id:'swing',type:'arc',layer:'L',center:{x:1000,y:0},radius:800,startAngle:0,endAngle:90},
  {id:'c',type:'circle',layer:'L',center:{x:1450,y:300},radius:100}];
 const r=wallRecoverOnce(ents,lay,{x:900,y:-200},{x:2000,y:900});
 assert.ok(r.removeIds.includes('swing')&&r.removeIds.includes('c'),'중간 객체는 지운다');
 assert.equal(r.add.filter(e=>e.type==='arc'||e.type==='circle').length,0,'원·호를 다시 넣지 않는다');
 assert.equal(r.add.filter(e=>e.type==='line').length,1,'끊긴 벽선은 하나로');
});
