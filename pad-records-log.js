// 현장 기록함: 현장 패드에서 온 핀·실측·사진과 사무실이 한 일을 도면 옆 `<도면>_현장기록` 폴더 장부(field_records.py)로 보낸다.
// 장부는 덧붙이기만 한다 — 같은 사건 id 는 엔진이 한 번만 쓰므로, 다시 켜서 처음부터 다시 받아도 겹치지 않는다.
// 화면 없이 시험할 수 있게 pad-share.js 에서 뺐다.

// 장부 폴더: 링크를 만든 도면 경로. 저장 안 한 도면이면 빈 값 → 엔진이 문서\바른 CAD\현장기록 아래 대체 폴더를
// 문서 칸 열쇠(draftKey)로 나눠 쓴다(같은 이름의 새 도면 둘이 한 폴더를 쓰지 않게).
export const recordTarget = session => session?.drawingPath
  ? {drawingPath: session.drawingPath, drawingName: session.name || '도면'}
  : {drawingPath: '', drawingName: session?.name || '도면', ...(session?.docKey ? {draftKey: session.docKey} : {})};
// 같은 기록 폴더인지(경로는 대소문자 무시, 새 도면은 문서 칸 열쇠)
export const sameTarget = (a, b) => a.drawingPath || b.drawingPath
  ? (a.drawingPath || '').toLowerCase() === (b.drawingPath || '').toLowerCase()
  : !!a.draftKey && a.draftKey === b.draftKey;

// 엔진은 한 요청에 사건 500개까지 받는다 — 여유 있게 200개씩
export const chunkEvents = (events, size = 200) => Array.from({length: Math.ceil(events.length / size)}, (_, i) => events.slice(i * size, i * size + size));

// 받은 작업 하나 → 장부 사건. 핀은 엔진이 장부를 보고 처음이면 pin.received, 아니면 바뀐 칸만 pin.changed 로 쓴다.
export function opEvents(session, op, seq, index, at) {
  const base = {id: `${session.id}:${seq}:${index}`, link: session.id, at: at || new Date().toISOString(), by: '현장'};
  if (op?.type === 'pin') return [{...base, kind: 'pin', pin: op}];
  if (op?.type === 'measure') return [{...base, kind: 'measure', data: op}];
  return [];
}

// 아직 폴더에 저장하지 않은 사진만(saved: 사진 id → 저장 정보)
export const photoJobs = (session, op, at, saved = {}) =>
  op?.type === 'pin' ? (op.photos || []).filter(photo => !saved[photo.id]).map(photo => ({session, pin: op, photo, at})) : [];

// 링크 상태 파일(링크\*.json): 열쇠·토큰은 절대 넣지 않는다(폴더는 평문, NAS 로 공유될 수 있다).
export const linkFile = session => ({
  id: session.id, name: session.name, scope: session.scope, hours: session.hours, createdAt: session.createdAt, expiresAt: session.expiresAt,
  ...(session.revokedAt ? {revokedAt: session.revokedAt} : {}), ...(session.endedAt ? {endedAt: session.endedAt} : {}),
});
export const linkEvent = (session, kind, at = new Date().toISOString()) =>
  ({id: `link:${session.id}:${kind}`, kind: `link.${kind}`, link: session.id, at, by: '사무실', data: {name: session.name, scope: session.scope, hours: session.hours, expiresAt: session.expiresAt}});

// 사무실 답: 글이 바뀌었거나(지운 것도) 현장으로 보내려 하면 한 줄 — 같은 글을 다시 보내는 것도 남는다(닿으면 reply.delivered 가 뒤따른다).
export const shouldLogReply = (before, text, sending) => text !== (before || '') || (sending && !!text);

// 도면을 저장(다른 이름 포함)했을 때 기록 폴더를 따라 옮길 링크들: 예전 경로가 같거나, 저장 안 한 도면이면 같은 문서 칸에서 만든 것
export const sessionsToMove = (sessions, prevPath, docKey) =>
  sessions.filter(s => prevPath ? s.drawingPath === prevPath : !s.drawingPath && !!docKey && s.docKey === docKey);

export function bytesToBase64(bytes) {
  let text = '';
  for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(text);
}

// 보낼 일 줄(메모리). 기록이 디스크·NAS 문제로 못 쓰이면 엔진이 대기 폴더에 받아 두고 스스로 다시 쓰므로(field_records.py spool),
// 여기서는 엔진에 닿지 못했을 때(재시작 중)만 다시 보낸다. 받은 핀·실측·사진은 앱을 다시 켜면 처음부터 다시 받아 채워진다.
// - ordered(기록 줄): 순서를 지킨다. 일시 오류면 거기서 멈추고 다음 받기 때 이어서.
// - 순서 없음(사진 줄): 한 사진이 실패해도 다른 사진은 계속.
// permanent(error) 인 오류만 횟수를 세어 maxTries 번 뒤 버리고 onDrop 으로 알린다. 나머지(연결 끊김·429·5xx)는 계속 다시.
export const OUTBOX_MAX_TRIES = 3;
export const isRejected = error => error?.status >= 400 && error.status < 500 && error.status !== 429;
export function createOutbox(send, {onDrop, ordered = true, permanent = isRejected, maxTries = OUTBOX_MAX_TRIES} = {}) {
  const queue = new Map();
  let running = null, lastError = null;
  return {
    add(key, job) { if (!queue.has(key)) queue.set(key, {job, tries: 0}); },
    get size() { return queue.size; },
    get lastError() { return lastError; },
    pending(match) { return [...queue.values()].filter(entry => match(entry.job)).length; },
    async flush() {
      if (running) return running;
      running = (async () => {
        for (const [key, entry] of [...queue]) {
          try { await send(entry.job); queue.delete(key); lastError = null; }
          catch (error) {
            lastError = error;
            if (permanent(error)) { if (++entry.tries >= maxTries) { queue.delete(key); onDrop?.(entry.job, error); } continue; }
            if (ordered) break;
          }
        }
      })().finally(() => { running = null; });
      return running;
    },
  };
}
