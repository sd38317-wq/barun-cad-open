// 머리줄 [패드 연결] 하나 — 사무실에서 수정(같은 Wi-Fi 패드) · 현장에서 수정(밖에서 보기 링크) · 기록 열기.
// 단추 셋이 머리줄에 늘 보이는 것이 싫다는 요청(2026-10-19)으로 묶었다. 실제 일은 tablet-control.js · pad-share.js 의
// 원래 단추가 그대로 한다(여기서는 숨겨 두고 누르기만 한다). 상태는 원래 단추의 data-pad-state·data-pad-count 를 읽는다.
const ROLES = ['office', 'field', 'records', 'records-more'];

export function installPadHub({doc = globalThis.document, win = globalThis} = {}) {
  const actions = doc?.querySelector('header .file-actions');
  if (!actions) return null;
  const find = role => actions.querySelector(`button[data-pad-role="${role}"]`);
  const originals = Object.fromEntries(ROLES.map(role => [role, find(role)]));
  if (!originals.office && !originals.field) return null;
  for (const b of Object.values(originals)) if (b) b.style.display = 'none';

  const hub = doc.createElement('button');
  hub.type = 'button'; hub.className = 'pad-hub-button'; hub.setAttribute('aria-haspopup', 'menu'); hub.setAttribute('aria-expanded', 'false');
  const label = doc.createElement('span'), badge = doc.createElement('span');
  badge.className = 'pad-hub-badge'; badge.hidden = true; hub.append(label, badge);
  (originals.office || originals.field).before(hub);

  const menu = doc.createElement('div');
  menu.className = 'pad-hub-menu'; menu.setAttribute('role', 'menu'); menu.hidden = true;
  const item = (title, run) => {
    const b = doc.createElement('button'); b.type = 'button'; b.setAttribute('role', 'menuitem');
    const strong = doc.createElement('strong'), small = doc.createElement('small'); strong.textContent = title;
    b.append(strong, small); b.onclick = () => {close(); run();}; menu.append(b); return small;
  };
  const officeNote = originals.office ? item('사무실에서 수정', () => originals.office.click()) : null;
  const fieldNote = originals.field ? item('현장에서 수정', () => originals.field.click()) : null;
  const recordsNote = originals.records ? item('기록 열기', () => originals.records.click()) : null;
  if (originals['records-more']) {
    const more = doc.createElement('button'); more.type = 'button'; more.className = 'pad-hub-sub'; more.textContent = '기록 창(핀 목록·답)';
    more.onclick = () => {close(); originals['records-more'].click();}; menu.append(more);
  }
  doc.body.append(menu);

  const count = button => Math.max(0, Number(button?.dataset.padCount) || 0);
  function refresh() {
    const connected = originals.office?.dataset.padState === 'connected';
    const memos = count(originals.field), records = count(originals.records), links = count({dataset: {padCount: originals.field?.dataset.padSessions}});
    label.textContent = connected ? '패드 연결됨' : '패드 연결';
    hub.classList.toggle('connected', connected);
    if (officeNote) officeNote.textContent = connected ? '같은 Wi-Fi 패드 연결됨' : '같은 Wi-Fi 패드로 이 도면 고치기';
    if (fieldNote) fieldNote.textContent = memos ? `받은 현장 메모 ${memos}건` : links ? `보기 링크 ${links}개 열림` : '현장 패드·휴대폰에 보기 링크 보내기';
    if (recordsNote) recordsNote.textContent = records ? `안 본 기록 ${records}건` : '사진·기록 장부 폴더';
    const n = memos + records;
    badge.hidden = !n; badge.textContent = !n ? '' : n > 99 ? '99+' : String(n);
    hub.title = n ? `현장 메모·기록 ${n}건` : '패드 연결 · 현장 기록';
  }
  const Observer = win.MutationObserver;
  if (Observer) {
    const observer = new Observer(refresh);
    for (const b of Object.values(originals)) if (b) observer.observe(b, {childList: true, characterData: true, subtree: true, attributes: true});
  }
  refresh();

  function place() {
    const r = hub.getBoundingClientRect();
    menu.style.top = `${Math.round(r.bottom + 6)}px`;
    menu.style.left = `${Math.round(Math.max(8, Math.min(r.left, (win.innerWidth || 0) - menu.offsetWidth - 8)))}px`;
  }
  function open() {menu.hidden = false; place(); hub.setAttribute('aria-expanded', 'true'); menu.querySelector('button')?.focus?.();}
  function close() {menu.hidden = true; hub.setAttribute('aria-expanded', 'false');}
  hub.onclick = () => menu.hidden ? open() : close();
  doc.addEventListener('pointerdown', event => {if (!menu.hidden && !menu.contains(event.target) && !hub.contains(event.target)) close();}, true);
  menu.addEventListener('keydown', event => {if (event.key === 'Escape') {close(); hub.focus?.();} event.stopPropagation();});
  win.addEventListener?.('resize', () => {if (!menu.hidden) place();});
  return {hub, menu, refresh, open, close};
}
