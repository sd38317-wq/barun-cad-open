// 실시 — 오른쪽 막대의 '실시' 탭(2026-10-24 대표 통과 시안 ⑧, 2026-10-26 구현).
// 실시 도면을 그리는 명령과 인허가 검토(장애인 편의시설·에너지절약계획)를 한 칸에 모은다. 명령은 그대로이고 여는 길만 더한다.
// 구조 검토(⑪)·증축·대수선 검토(⑫)는 2026-10-26 같은 날 이어서 붙였다.

/** 실시 도면 줄: [이름, 명령 또는 [단추 이름, 명령] 목록, 메모]. 명령이 없는 줄은 '준비 중'으로 눌리지 않는다. */
export const SILSI_DRAWING_ROWS = Object.freeze([
 ['평면으로 도면 한 벌', 'PLANSET', '목록·개요·구적·배치·평면·입면·단면·창호도·상세'],
 ['평면도 · 입면도 · 단면도', [['평면', 'OCCTPLAN'], ['입면', 'OCCTELEVATION'], ['단면', 'OCCTSECTION']], '3D 건물 모델에서'],
 ['창호 일람표', 'WSL', '창호 기호 집계'],
 ['실내재료 마감표', 'PLANSET', '도면 한 벌 안에 함께 그립니다'],
 ['실별 면적표 · 구적표', [['면적표', 'MRT'], ['구적표', 'AREATAKEOFF']], ''],
 ['도면목록표 · 도곽', [['목록표', 'SHEETLIST'], ['도곽', 'SHEET']], ''],
 ['방화구획 상세도', 'FIREDETAILS', '상세 생성기 · 방화구획 상세 한 묶음'],
]);

/** 검토 카드: [이름, 설명, 여는 곳]. 'permit:탭' 은 인허가 도서 창의 그 탭, 그 밖은 studio.handlers 이름. */
export const SILSI_REVIEW_CARDS = Object.freeze([
 ['장애인 편의시설', '출입문·경사로·화장실·주차·접근로 검사, 적합성 확인서', 'permit:access'],
 ['에너지절약계획', '부위별 열관류율, 창면적비, 의무사항, EPI', 'permit:energy'],
 ['구조 검토', '벽식 · 라멘 · 철골 · 목구조, 구조계산서·안전 확인서 초안', 'STRUCTUREREVIEW'],
 ['증축 · 대수선 검토', '기존·증축·철거 구분, 면적 변화, 대수선 해당 여부, 허가·신고', 'EXTENSIONREVIEW'],
]);

const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

const two = n => String(n).padStart(2, '0');
/** 도면 인식 카드의 꼬리표: 읽은 때 · 확인 필요 수(state = drawing-recognition.js state(): ①~⑤ 확인 필요를 모두 센다). */
export function recognitionChips(state) {
 if (!state?.read) return [['아직 읽지 않음', 'muted']];
 const d = new Date(state.readAt), out = [[`읽음 ${two(d.getMonth() + 1)}-${two(d.getDate())} ${two(d.getHours())}:${two(d.getMinutes())}`, 'ok']];
 if (state.confirm) out.push([`확인 필요 ${state.confirm}`, 'warn']);
 return out;
}

/** '실시' 패널 본문. run(명령 이름) 은 CAD 명령 실행, open(여는 곳) 은 검토 창(SILSI_REVIEW_CARDS 셋째 칸).
 *  recognition = {state(), open()} 이면 맨 위에 [도면 인식] 카드(10-27 대표 결정 docs/adr/0001). root.refresh() 로 꼬리표를 다시 그린다. */
export function silsiPanelElement({ run, open, recognition = null }) {
 const root = el('div', 'silsi-panel');
 root.refresh = () => {};
 if (recognition) {
  const card = el('button', 'silsi-card silsi-recognition'); card.type = 'button'; card.setAttribute('aria-haspopup', 'dialog');
  const top = el('span', 'silsi-card-head'); top.append(el('strong', null, '도면 인식'), el('em', null, '열기 →'));
  const chips = el('span', 'silsi-card-chips');
  card.append(top, el('small', null, '개요표 · 배치 · 층 평면을 한 번에 읽기'), chips); card.onclick = () => recognition.open();
  root.refresh = () => { chips.replaceChildren(...recognitionChips(recognition.state()).map(([t, c]) => el('span', 'silsi-chip ' + c, t))); };
  root.refresh(); root.addEventListener('pointerenter', () => root.refresh());   // 도면 탭을 바꾸거나 되돌린 뒤에도 맞게
  root.append(card);
 }
 const folder = el('details', 'silsi-folder'); folder.open = true;
 // '로그인' 꼬리표는 뺐다(10-27 대표: 무엇인지 모르겠다). 눌러도 아무 일이 없는 표시였고, 로그인이 필요하면 명령이 그때 알린다.
 const head = el('summary', null, '실시 도면 그리기');
 folder.append(head);
 for (const [label, command, note] of SILSI_DRAWING_ROWS) {
  const row = el('div', 'silsi-row');
  const text = el('span', 'silsi-row-text'); text.append(el('strong', null, label)); if (note) text.append(el('small', null, note));
  row.append(text);
  if (!command) { row.classList.add('is-missing'); row.append(el('span', 'silsi-chip muted', '없음')); }
  else if (Array.isArray(command)) {
   const buttons = el('span', 'silsi-row-buttons');
   for (const [name, cmd] of command) { const b = el('button', null, name); b.type = 'button'; b.title = cmd; b.onclick = () => run(cmd); buttons.append(b); }
   row.append(buttons);
  } else { row.classList.add('is-action'); row.tabIndex = 0; row.title = command; row.setAttribute('role', 'button'); row.onclick = () => run(command); row.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); run(command); } }; }
  folder.append(row);
 }
 root.append(folder);
 for (const [label, note, tab] of SILSI_REVIEW_CARDS) {
  const card = el('button', 'silsi-card'); card.type = 'button'; card.setAttribute('aria-haspopup', 'dialog');
  const top = el('span', 'silsi-card-head'); top.append(el('strong', null, label), el('em', null, '열기 →'));
  card.append(top, el('small', null, note)); card.onclick = () => open(tab);
  root.append(card);
 }
 return root;
}
