import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizePadBatch, planPadOps, describePadOp, measureText, PAD_PROTOCOL_VERSION, PAD_MARK_LAYER_ID, PAD_CAPABILITIES} from './pad-ops.js';

const batch = ops => normalizePadBatch({v: PAD_PROTOCOL_VERSION, seq: 1, baseRevision: 'r', ops});
const doc = {layers: [{id: 'L', name: 'A-WALL'}], entities: []};

test('핀·실측 작업을 받고, 잘못된 값은 거절한다', () => {
  const ok = batch([
    {type: 'pin', id: 'pad-p1', at: {x: 100, y: 200}, no: 3, title: '주방 벽 사이 50 짧음', kind: '하자', status: '미해결', prio: '높음', assignee: '골조팀', due: '2026-10-17', note: '타설 전 확인'},
    {type: 'measure', id: 'pad-m1', a: {x: 0, y: 0}, b: {x: 4050, y: 0}, drawn: 4050, actual: 4000, tolerance: 20},
  ]);
  assert.equal(ok.ops[0].status, '미해결');
  assert.equal(ok.ops[1].actual, 4000);
  assert.throws(() => batch([{type: 'pin', id: 'pad-p2', at: {x: 0, y: 0}, kind: '하자', status: '모름', prio: '높음'}]), /상태/);
  assert.throws(() => batch([{type: 'measure', id: 'pad-m2', a: {x: 0, y: 0}, b: {x: 1, y: 0}, drawn: 'x'}]), /drawn/);
  assert.deepEqual([...PAD_CAPABILITIES], ['pin', 'measure', 'photo']);
  const sha = 'a'.repeat(64), pid = 'A'.repeat(22);
  const withPhoto = batch([{type: 'pin', id: 'pad-p3', at: {x: 0, y: 0}, kind: '하자', status: '미해결', prio: '보통', photos: [{id: pid, sha256: sha, extra: 1}]}]);
  assert.deepEqual(withPhoto.ops[0].photos, [{id: pid, sha256: sha}], '사진은 id·지문만');
  assert.throws(() => batch([{type: 'pin', id: 'pad-p4', at: {x: 0, y: 0}, kind: '하자', status: '미해결', prio: '보통', photos: [{id: 'short', sha256: sha}]}]), /사진/);
  assert.throws(() => batch([{type: 'pin', id: 'pad-p5', at: {x: 0, y: 0}, kind: '하자', status: '미해결', prio: '보통', photos: Array.from({length: 11}, () => ({id: pid, sha256: sha}))}]), /10장/);
});

test('사무실 도면에는 표시 레이어에 핀·치수선·글로 들어간다', () => {
  const {ops} = batch([
    {type: 'pin', id: 'pad-p1', at: {x: 100, y: 200}, no: 3, title: '주방 벽', kind: '질문', status: '진행 중', prio: '보통'},
    {type: 'measure', id: 'pad-m1', a: {x: 0, y: 0}, b: {x: 4050, y: 0}, drawn: 4050, actual: 4000, tolerance: 20},
  ]);
  const plan = planPadOps(doc, ops.map((op, index) => ({seq: 1, index, op})));
  assert.deepEqual(plan.map(p => p.status), ['ready', 'ready']);
  const adds = plan.flatMap(p => p.commands).filter(c => c.type === 'add').map(c => c.entity);
  assert.ok(adds.every(e => e.layer === PAD_MARK_LAYER_ID));
  const texts = adds.filter(e => e.type === 'text').map(e => e.text);
  assert.ok(texts.includes('[질문·진행 중·보통] 3. 주방 벽'));
  assert.ok(texts.includes('실측 4,000 · 도면 4,050 · −50'));
  assert.equal(adds.find(e => e.id === 'pad-m1').color, '#f08a3e', '허용 넘으면 주황');
  assert.match(describePadOp(ops[0]), /핀 3/);
  assert.equal(measureText({drawn: 4050}), '치수 4,050');
});
