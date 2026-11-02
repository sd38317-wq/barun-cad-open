import test from 'node:test';
import assert from 'node:assert/strict';
import {recordTarget, sameTarget, chunkEvents, opEvents, photoJobs, linkFile, linkEvent, shouldLogReply, sessionsToMove, bytesToBase64, createOutbox, isRejected, OUTBOX_MAX_TRIES} from './pad-records-log.js';

const session = {id: 'S1', name: '온천8구역', drawingPath: 'D:\\프로젝트\\온천8구역.dwg', scope: 'all', hours: 72, createdAt: '2026-10-16T05:00:00Z', expiresAt: '2026-10-19T05:00:00Z',
  key: 'K', writeToken: 'W', ownerToken: 'O', handled: []};

test('받은 핀·실측은 링크·묶음·순번으로 id 가 정해져 다시 받아도 같은 사건이다', () => {
  const pin = {type: 'pin', id: 'pad-p1', no: 3, kind: '하자', photos: [{id: 'A'.repeat(22), sha256: 'a'.repeat(64)}]};
  const [event] = opEvents(session, pin, 7, 1, '2026-10-16T05:32:00Z');
  assert.deepEqual(event, {id: 'S1:7:1', link: 'S1', at: '2026-10-16T05:32:00Z', by: '현장', kind: 'pin', pin});
  assert.deepEqual(opEvents(session, pin, 7, 1).map(e => e.id), ['S1:7:1']);
  assert.equal(opEvents(session, {type: 'measure', id: 'm'}, 2, 0)[0].kind, 'measure');
  assert.deepEqual(opEvents(session, {type: 'memo'}, 2, 0), [], '펜 표시·메모는 1단계 장부에 안 넣는다');
});

test('이미 폴더에 저장한 사진은 다시 받지 않는다', () => {
  const a = {id: 'A'.repeat(22)}, b = {id: 'B'.repeat(22)};
  const jobs = photoJobs(session, {type: 'pin', id: 'p', photos: [a, b]}, 'T', {[a.id]: {file: '사진/x.jpg'}});
  assert.deepEqual(jobs.map(j => j.photo.id), [b.id]);
  assert.deepEqual(photoJobs(session, {type: 'measure'}, 'T'), []);
});

test('링크 파일에는 열쇠·토큰이 없다', () => {
  const file = linkFile({...session, revokedAt: 'R'});
  for (const secret of ['key', 'writeToken', 'ownerToken', 'handled']) assert.equal(secret in file, false, secret);
  assert.equal(file.revokedAt, 'R');
  assert.equal(JSON.stringify(linkEvent(session, 'created', 'T')).includes('"W"'), false);
  assert.deepEqual(linkEvent(session, 'expired', 'T').id, 'link:S1:expired');
  assert.deepEqual(recordTarget({name: 'x'}), {drawingPath: '', drawingName: 'x'});
  assert.deepEqual(recordTarget({name: 'x', docKey: 'w:t1'}), {drawingPath: '', drawingName: 'x', draftKey: 'w:t1'}, '새 도면은 문서 칸별 대체 폴더');
  assert.deepEqual(recordTarget({...session, docKey: 'w:t1'}), {drawingPath: session.drawingPath, drawingName: session.name}, '저장한 도면은 경로만');
});

test('저장할 때 옮길 링크: 같은 경로, 또는 저장 안 한 도면이면 같은 문서 칸', () => {
  const list = [{id: 1, drawingPath: 'D:\\a.dwg'}, {id: 2, drawingPath: '', docKey: 'w:t1'}, {id: 3, drawingPath: '', docKey: 'w:t2'}, {id: 4, drawingPath: ''}];
  assert.deepEqual(sessionsToMove(list, 'D:\\a.dwg', 'w:t1').map(s => s.id), [1]);
  assert.deepEqual(sessionsToMove(list, '', 'w:t1').map(s => s.id), [2]);
  assert.deepEqual(sessionsToMove(list, '', ''), [], '문서 칸을 모르면 아무것도 옮기지 않는다');
});

test('base64 는 큰 바이트도 표준 형식으로', () => {
  const bytes = new Uint8Array(100000).map((_, i) => i * 7);
  assert.equal(bytesToBase64(bytes), Buffer.from(bytes).toString('base64'));
});

test('같은 기록 폴더 판단과 500개 한도 나누기', () => {
  assert.equal(sameTarget({drawingPath: 'D:\A.dwg'}, {drawingPath: 'd:\a.DWG'}), true);
  assert.equal(sameTarget({drawingPath: 'D:\A.dwg'}, {drawingPath: '', draftKey: 't1'}), false);
  assert.equal(sameTarget({drawingPath: '', draftKey: 't1'}, {drawingPath: '', draftKey: 't1'}), true);
  assert.equal(sameTarget({drawingPath: '', drawingName: 'x'}, {drawingPath: '', drawingName: 'x'}), false, '문서 칸을 모르는 새 도면끼리는 같다고 보지 않는다');
  const parts = chunkEvents(Array.from({length: 450}, (_, i) => i));
  assert.deepEqual(parts.map(p => p.length), [200, 200, 50]);
  assert.deepEqual(parts.flat(), Array.from({length: 450}, (_, i) => i));
  assert.deepEqual(chunkEvents([]), []);
});

test('사무실 답 기록: 글이 바뀌거나 지웠거나, 같은 글을 다시 보내 성공했을 때', () => {
  assert.equal(shouldLogReply('', '내일 갑니다', false), true);
  assert.equal(shouldLogReply('내일 갑니다', '내일 갑니다', false), false, '상태만 바꾸고 보내지 못함');
  assert.equal(shouldLogReply('내일 갑니다', '내일 갑니다', true), true, '같은 글 다시 보내 성공');
  assert.equal(shouldLogReply('내일 갑니다', '', false), true, '답을 지움');
  assert.equal(shouldLogReply('', '', true), false);
});

test('보낼 일 줄: 같은 key 는 한 번, 연결이 끊기면 순서대로 다시, 거절된 일은 건너뛰고 몇 번 뒤 버린다', async () => {
  const sent = [], dropped = [];
  let down = true;
  const box = createOutbox(async job => {
    if (down) throw Object.assign(Error('엔진 꺼짐'), {});
    if (job === 'bad') throw Object.assign(Error('JPEG 아님'), {status: 400});
    if (job === 'disk') throw Object.assign(Error('디스크 가득'), {status: 503});
    sent.push(job);
  }, {onDrop: job => dropped.push(job)});
  box.add('1', 'a'); box.add('1', 'a2'); box.add('2', 'bad'); box.add('3', 'c');
  assert.equal(box.size, 3);
  await box.flush();
  assert.deepEqual(sent, []); assert.equal(box.size, 3, '끊기면 아무것도 안 버린다');
  down = false;
  await box.flush();
  assert.deepEqual(sent, ['a', 'c'], '거절된 일은 건너뛰고 뒤의 일은 보낸다');
  assert.equal(box.pending(job => job === 'bad'), 1);
  for (let i = 1; i < OUTBOX_MAX_TRIES; i++) await box.flush();
  assert.deepEqual(dropped, ['bad']); assert.equal(box.size, 0);
  box.add('4', 'disk'); box.add('5', 'd');
  for (let i = 0; i < OUTBOX_MAX_TRIES + 2; i++) await box.flush();
  assert.equal(box.size, 2, '엔진 쪽 저장 오류(5xx)는 버리지 않고 거기서 멈춘다');
  assert.deepEqual(sent, ['a', 'c']);
});

test('사진 줄: 한 사진이 막혀도 다른 사진은 계속, 429·연결 끊김은 버리지 않는다', async () => {
  const saved = [], dropped = [];
  let tries429 = 0;
  const box = createOutbox(async job => {
    if (job === 'broken') throw Object.assign(Error('풀기 실패'), {photoFetch: true});
    if (job === 'busy') { tries429++; throw Object.assign(Error('잠시 뒤'), {status: 429}); }
    if (job === 'offline') throw Error('엔진 꺼짐');
    saved.push(job);
  }, {ordered: false, maxTries: 5, permanent: e => e?.status === 429 ? false : e?.photoFetch || isRejected(e), onDrop: job => dropped.push(job)});
  for (const job of ['broken', 'busy', 'offline', 'ok']) box.add(job, job);
  await box.flush();
  assert.deepEqual(saved, ['ok'], '앞의 사진이 막혀도 뒤 사진은 저장');
  for (let i = 0; i < 6; i++) await box.flush();
  assert.deepEqual(dropped, ['broken'], '받기·풀기 실패만 5번 뒤 버린다');
  assert.equal(box.pending(job => job === 'busy') + box.pending(job => job === 'offline'), 2);
  assert.ok(tries429 >= 7);
  assert.equal(isRejected({status: 429}), false); assert.equal(isRejected({status: 404}), true); assert.equal(isRejected({}), false);
});
