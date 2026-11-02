// SharedAccountWindow 팝오버 — "계정 및 업데이트"를 제목줄 계정 단추 바로 아래 작은 창(약 410px)으로 보여 준다.
// 사용: const pop = await createAccountPopover({ mount: document.getElementById('account-popover'), adapter }); pop.toggle(button);
// adapter 규격·계약(contract/)·상태 규칙(model.mjs)은 큰 창(renderer.mjs)과 똑같다. 바뀐 것은 그리는 모양뿐이다.
// 한 줄에 하나씩(코인·AI·업데이트·자가 복구), 자세한 내용은 ›를 눌렀을 때 그 줄 아래에만 펼친다(한 번에 한 줄).
import { RENDERER_VERSION, ALLOWED_APP_FIELDS, normalizeState, buildView } from './model.mjs';
import { loadContract } from './renderer.mjs';
import { ICONS } from './icons.mjs';
import { summarize, placePopover, POPOVER_ROWS, loginAvailability } from './popover-model.mjs';

const BASE = new URL('./', import.meta.url);
const icon = (body) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${body}</svg>`;
const ROW_ICONS = {
  coin: icon('<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/>'),
  ai: icon('<path d="M12 3.5l1.9 5.1 5.1 1.9-5.1 1.9L12 17.5l-1.9-5.1L5 10.5l5.1-1.9z"/><path d="M18.5 16.5l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z"/>'),
  update: ICONS.refresh,
  repair: ICONS.wrench,
};
const CHEVRON = icon('<path d="M9.5 6l6 6-6 6"/>');
const ROW_LABEL = { coin: '보유 코인', ai: 'AI', update: '업데이트', repair: '자가 복구' };
const FOCUSABLE = 'button:not([disabled]):not([hidden]), [href], input:not([disabled]), [tabindex]:not([tabindex="-1"])';

function ensureStyles() {
  if (document.querySelector('link[data-account-popover-css]')) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = new URL('account-popover.css', BASE).href;
  link.dataset.accountPopoverCss = RENDERER_VERSION;
  document.head.append(link);
}

function h(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key === 'html') node.innerHTML = value; // 이 파일의 고정 아이콘 문자열만
    else node.setAttribute(key, value === true ? '' : value);
  }
  node.append(...children.flat().filter((c) => c !== null && c !== undefined && c !== false));
  return node;
}

export async function createAccountPopover({ mount, adapter }) {
  if (!mount) throw new Error('계정 팝오버를 넣을 자리가 필요합니다.');
  const app = Object.fromEntries(ALLOWED_APP_FIELDS.map((key) => [key, adapter.app?.[key] ?? null]));
  ensureStyles();
  const { contract, hash } = await loadContract();
  const label = (id) => contract.actions.find((a) => a.id === id)?.label || id;

  mount.classList.add('ap');
  if (!mount.hasAttribute('popover')) mount.setAttribute('popover', 'manual');
  mount.setAttribute('role', 'dialog');
  mount.setAttribute('aria-modal', 'true');
  mount.setAttribute('aria-labelledby', 'ap-title');
  mount.tabIndex = -1;
  mount.dataset.rendererVersion = RENDERER_VERSION;
  mount.dataset.contractSha256 = hash;
  mount.dataset.appId = app.appId || '';

  let raw = {};
  let view = null;
  let state = null;
  let opener = null;
  let expanded = null;
  let lastAnchor = null;
  const busy = new Set();
  const buttons = new Map(); // actionId → [button]

  const actionButton = (id, { style = 'plain', text = label(id), cls = '', children = null, provider = null } = {}) => {
    const button = h('button', { type: 'button', class: `ap-btn ap-${style}${cls ? ` ${cls}` : ''}`, 'data-aw-action': id }, ...(children || [text]));
    if (provider) button.dataset.awProvider = provider;
    button.addEventListener('click', (event) => run(id, event, provider));
    if (!buttons.has(id)) buttons.set(id, []);
    buttons.get(id).push(button);
    return button;
  };

  // ── 머리: [동그라미][이름·한 줄 설명][카카오 로그인]
  const kakaoIcon = h('img', { src: new URL('shared-assets/kakao-symbol-approved.svg', BASE).href, alt: '', class: 'ap-kakao-icon', width: 16, height: 16 });
  const el = {
    avatar: h('span', { class: 'ap-avatar', 'aria-hidden': 'true' }),
    name: h('strong', { id: 'ap-title', class: 'ap-name', 'data-aw-field': 'name' }),
    subline: h('span', { class: 'ap-sub', 'data-aw-field': 'session' }),
    live: h('p', { class: 'ap-live', role: 'status', 'aria-live': 'polite', hidden: true }),
  };
  const providers = adapter.loginProviders || [{ id: 'kakao', label: label('auth.login'), style: 'kakao' }];
  const loginEntries = providers.map((provider) => {
    const symbol = provider.id === 'kakao' ? kakaoIcon : h('img', { src: new URL('shared-assets/google-g.svg', BASE).href, alt: '', class: 'ap-google-icon', width: 18, height: 18 });
    const button = actionButton('auth.login', { style: provider.style, provider: provider.id, children: [symbol, h('span', { text: provider.label })] });
    const reason = h('span', { id: `ap-login-reason-${provider.id}`, class: 'ap-login-reason', hidden: true });
    button.setAttribute('aria-describedby', reason.id);
    return { provider, button, reason, node: h('div', { class: 'ap-login-option' }, button, reason) };
  });
  const logins = h('div', { class: 'ap-logins', role: 'group', 'aria-label': '계정 로그인' }, loginEntries.map(entry => entry.node));
  const header = h('header', { class: 'ap-head', 'data-section': 'account' }, el.avatar, h('div', { class: 'ap-who' }, el.name, el.subline), logins);

  // ── 줄 하나: 머리(아이콘·이름·값·›)와 펼침 칸
  const rows = {};
  const makeRow = (id, { value, detail, headExtra = null }) => {
    const detailId = `ap-detail-${id}`;
    const disclose = h('button', { type: 'button', class: 'ap-disclose', 'aria-expanded': 'false', 'aria-controls': detailId, 'data-ap-toggle': id },
      headExtra ? null : h('span', { class: 'ap-row-label', text: ROW_LABEL[id] }),
      value, h('span', { class: 'ap-chev', html: CHEVRON }));
    const head = h('div', { class: 'ap-row-head' },
      h('span', { class: `ap-ic ap-ic-${id}`, html: ROW_ICONS[id] }),
      headExtra ? h('span', { class: 'ap-row-label', id: `ap-label-${id}`, text: ROW_LABEL[id] }) : null,
      headExtra, disclose);
    if (headExtra) disclose.setAttribute('aria-label', `${ROW_LABEL[id]} 자세히`);
    // 줄의 빈 곳을 눌러도 펼친다(AI 줄의 모드 단추는 제외).
    head.addEventListener('click', (event) => { if (!event.target.closest('button')) toggleRow(id); });
    disclose.addEventListener('click', () => toggleRow(id));
    const panel = h('div', { class: 'ap-detail', id: detailId, role: 'region', 'aria-label': `${ROW_LABEL[id]} 자세히`, hidden: true }, detail);
    const row = h('div', { class: 'ap-row', 'data-row': id }, head, panel);
    rows[id] = { row, disclose, panel };
    return row;
  };

  // 코인
  const coinValue = h('span', { class: 'ap-val', 'data-aw-field': 'wallet' });
  const coinText = h('p', { class: 'ap-note' });
  const coinRow = makeRow('coin', { value: coinValue, detail: [coinText, h('div', { class: 'ap-actions' },
    actionButton('wallet.openTopup', { style: 'accent' }), actionButton('wallet.openHistory'))] });

  // AI — 모드 고르기는 줄 위에 바로(미리 제공 | 내 모델), 상태 점, ›
  const modes = h('div', { class: 'ap-seg', role: 'radiogroup', 'aria-labelledby': 'ap-label-ai' });
  const aiStatus = h('span', { class: 'ap-val ap-status', 'data-aw-field': 'ai-status' });
  const aiModel = h('p', { class: 'ap-note ap-model' }, h('span', { class: 'ap-k', text: '사용 모델' }), h('span', { 'data-aw-field': 'model' }), h('span', { class: 'ap-sel' }));
  const aiCaption = h('p', { class: 'ap-note ap-caption', 'data-aw-field': 'ai-caption' });
  const aiExtensions = h('span', { class: 'ap-ext' });
  // 앱이 AI 자세히 칸 위쪽을 직접 그리는 자리(adapter.renderAiDetail, CAD 2026-10-26 내 모델 Codex/Claude). 내용이 있을 때만 보이고,
  // true 를 돌려주면 기본 '사용 모델'·설명 줄을 숨긴다.
  const aiCustom = h('div', { class: 'ap-ai-custom', hidden: true });
  const aiRow = makeRow('ai', { value: aiStatus, headExtra: modes, detail: [aiCustom, aiModel, aiCaption, h('div', { class: 'ap-actions' },
    aiExtensions, actionButton('ai.testConnection'), actionButton('ai.openSettings'))] });
  // 상태 글("연결됨"·"로그인 후")은 › 단추 안에 있으므로 누르면 펼쳐진다(disclose 클릭).

  // 업데이트
  const updateValue = h('span', { class: 'ap-val', 'data-aw-field': 'version' });
  const updateText = h('p', { class: 'ap-note', 'data-aw-field': 'update' });
  const updateVersions = h('p', { class: 'ap-note ap-versions' });
  const progress = h('progress', { class: 'ap-progress', max: 100, hidden: true });
  const notes = h('ul', { class: 'ap-notes', 'aria-label': '이번 업데이트 변경 내용', hidden: true });
  const extensions = h('span', { class: 'ap-ext' });
  const updateRow = makeRow('update', { value: updateValue, detail: [updateText, updateVersions, progress, notes, h('div', { class: 'ap-actions' },
    extensions, actionButton('update.download', { style: 'accent' }), actionButton('update.check'))] });

  // 자가 복구
  const repairValue = h('span', { class: 'ap-val', 'data-aw-field': 'repair' });
  const repairText = h('p', { class: 'ap-note', 'data-aw-field': 'footer' });
  const repairKeep = h('p', { class: 'ap-note ap-keep' });
  const repairRow = makeRow('repair', { value: repairValue, detail: [repairText, repairKeep, h('div', { class: 'ap-actions' },
    actionButton('repair.diagnose', { text: '자가 복구 실행' }))] });

  const logout = actionButton('auth.logoutApp', { style: 'link' });
  const footer = h('footer', { class: 'ap-foot', 'data-section': 'footer' },
    actionButton('account.manage', { style: 'link' }), actionButton('wallet.openHistory', { style: 'link', cls: 'ap-foot-history' }), logout);

  const scroller = h('div', { class: 'ap-scroll' }, header,
    h('div', { class: 'ap-group', role: 'group', 'aria-label': '코인과 AI', 'data-section': 'ai' }, coinRow, aiRow),
    h('div', { class: 'ap-group', role: 'group', 'aria-label': '프로그램', 'data-section': 'update' }, updateRow, repairRow),
    footer, el.live);
  mount.replaceChildren(scroller);

  function setAiMode(id) {
    if (state?.ai.viewMode === id) return;
    raw = { ...raw, ai: { ...raw.ai, viewMode: id } };
    render();
    Promise.resolve(adapter.setAiMode?.(id)).catch(() => announce('AI 방식을 저장하지 못했습니다.'));
  }

  function render() {
    state = normalizeState(app, raw);
    view = buildView(contract, state);
    const s = summarize(view, state);
    mount.dataset.session = view.account.sessionState;
    mount.dataset.expanded = expanded || '';
    el.avatar.textContent = s.header.avatar;
    el.avatar.classList.toggle('ap-on', s.header.connected);
    el.name.textContent = s.header.name; el.name.title = s.header.name;
    el.subline.textContent = s.header.subline; el.subline.title = view.account.description || '';
    logins.hidden = !s.header.showLogin;
    const loginReasons = [];
    for (const entry of loginEntries) {
      const availability = loginAvailability(state, { busy: busy.has('auth.login') || busy.has('auth.logoutApp'), supported: typeof adapter.actions?.['auth.login'] === 'function' && entry.provider.supported !== false, reason: entry.provider.reason });
      entry.button.disabled = availability.disabled;
      entry.button.title = availability.reason;
      entry.reason.textContent = availability.reason;
      entry.reason.hidden = !availability.reason;
      if (availability.reason) loginReasons.push(availability.reason);
    }
    // 상태 설명은 이름 아래 기존 한 줄에 표시해 버튼·카드 자리를 늘리지 않는다.
    if (s.header.showLogin && loginReasons.length) {
      el.subline.textContent = [...new Set(loginReasons)].join(' · ');
      el.subline.title = el.subline.textContent;
    }

    coinValue.textContent = s.coin.value;
    coinValue.classList.toggle('ap-strong', s.coin.known);
    coinText.textContent = view.account.walletKnown ? '충전과 사용 내역은 브라우저에서 열립니다.' : view.account.walletDescription;

    modes.replaceChildren(...s.ai.modes.map((mode) => {
      const b = h('button', { type: 'button', role: 'radio', class: `ap-seg-btn${mode.selected ? ' ap-on' : ''}`, 'aria-checked': String(mode.selected), 'data-aw-mode': mode.id, title: mode.label, tabindex: mode.selected ? '0' : '-1', text: mode.short });
      // 이미 고른 방식을 다시 누르면 AI 자세히 칸을 펼치거나 접는다(내 모델 → Codex 로그인·로그아웃).
      b.addEventListener('click', () => {
        if (state?.ai.viewMode !== mode.id) { setAiMode(mode.id); return; }
        toggleRow('ai');
        modes.querySelector(`[data-aw-mode="${mode.id}"]`)?.focus({ preventScroll: true }); // 다시 그려도 초점 유지
      });
      b.addEventListener('keydown', (event) => {
        if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
        event.preventDefault(); event.stopPropagation();
        const ids = s.ai.modes.map((m) => m.id), next = ids[(ids.indexOf(mode.id) + (event.key === 'ArrowRight' ? 1 : ids.length - 1)) % ids.length];
        setAiMode(next); modes.querySelector(`[data-aw-mode="${next}"]`)?.focus();
      });
      return b;
    }));
    aiStatus.replaceChildren(h('i', { class: 'ap-dot', 'aria-hidden': 'true' }), h('span', { text: s.ai.status }));
    aiStatus.dataset.state = s.ai.statusState;
    aiModel.children[1].textContent = view.ai.model;
    aiModel.children[1].classList.toggle('ap-unknown', !view.ai.modelKnown);
    aiModel.children[2].textContent = view.ai.selectedModel ? ` · ${view.ai.selectedModel}` : '';
    aiCaption.textContent = view.ai.caption;
    const replaceDefault = adapter.renderAiDetail?.(aiCustom, { state, refresh, announce }) === true;
    aiCustom.hidden = !aiCustom.childElementCount; aiModel.hidden = replaceDefault; aiCaption.hidden = replaceDefault;

    updateValue.textContent = s.update.value;
    updateValue.classList.toggle('ap-attn', s.update.attention);
    updateText.textContent = view.update.text;
    updateVersions.textContent = [view.update.current, view.update.next].filter(Boolean).join(' → ');
    updateVersions.hidden = !updateVersions.textContent;
    progress.hidden = view.update.progress === null;
    if (view.update.progress !== null) { if (view.update.progress >= 0) progress.value = view.update.progress; else progress.removeAttribute('value'); }
    notes.hidden = !view.update.notes.length;
    notes.replaceChildren(...view.update.notes.map((text) => h('li', { text })));
    const drawExtensions = (list) => (list || []).filter((x) => x.visible?.(state)).map((x) => {
      const b = h('button', { type: 'button', class: `ap-btn ap-${x.style || 'accent'}`, 'data-aw-extension': x.id, 'data-aw-action': x.id, text: x.label });
      b.disabled = busy.has(x.id) || x.enabled?.(state) === false;
      b.addEventListener('click', (event) => runExtension(x, event));
      return b;
    });
    extensions.replaceChildren(...drawExtensions(adapter.updateExtensions));
    aiExtensions.replaceChildren(...drawExtensions(adapter.aiExtensions));

    repairValue.textContent = s.repair.value;
    repairText.textContent = view.footer.description;
    repairKeep.textContent = view.footer.preservation;

    logout.hidden = !s.footer.logoutVisible;
    for (const [id, list] of buttons) {
      if (id === 'auth.login') continue;
      const supported = typeof adapter.actions?.[id] === 'function';
      for (const button of list) {
        button.disabled = !view.enabled[id] || !supported || busy.has(id);
        button.title = !supported ? '이 앱에서는 아직 지원하지 않습니다.' : !view.enabled[id] && ['account.manage', 'wallet.openHistory', 'wallet.openTopup'].includes(id) ? '로그인 후 사용할 수 있습니다.' : '';
      }
    }
    for (const button of buttons.get('ai.testConnection') || []) button.hidden = !view.ai.showTest;
    for (const button of buttons.get('update.download') || []) button.hidden = !view.update.showDownload;
    for (const id of POPOVER_ROWS) {
      const open = expanded === id;
      rows[id].row.classList.toggle('ap-open', open);
      rows[id].disclose.setAttribute('aria-expanded', String(open));
      rows[id].panel.hidden = !open;
    }
    // 초점을 가진 단추가 사라지면(로그인 성공 뒤 카카오 단추 등) 초점을 팝오버에 남긴다.
    const active = document.activeElement;
    if (isOpen() && (active === document.body || (mount.contains(active) && active !== mount && !active.getClientRects().length))) mount.focus({ preventScroll: true });
  }

  function toggleRow(id) {
    expanded = expanded === id ? null : id;
    render();
    if (expanded) requestAnimationFrame(() => rows[id].panel.scrollIntoView?.({ block: 'nearest' }));
  }

  function announce(text) {
    el.live.textContent = '';
    el.live.hidden = !text;
    if (text) requestAnimationFrame(() => { el.live.textContent = text; });
  }

  async function run(id, event, provider = null) {
    if (!view?.enabled[id] || busy.has(id) || typeof adapter.actions?.[id] !== 'function') return;
    if (id === 'auth.login' && (busy.has('auth.logoutApp') || loginEntries.find(entry => entry.provider.id === provider)?.provider.supported === false)) return;
    busy.add(id); render();
    try {
      const result = await adapter.actions[id]({ trusted: !!event?.isTrusted, ...(provider ? { provider } : {}), viewMode: state.ai.viewMode, window: api });
      if (id === 'auth.login') raw = { ...raw, session: { state: 'authenticating', displayName: null } };
      if (id === 'auth.logoutApp') raw = { ...raw, session: { state: 'signed_out', displayName: null }, wallet: { state: 'unknown', balance: null } };
      // 펼친 칸에 이미 보이는 문구(자가 복구 결과 등)는 아래에 한 번 더 쓰지 않는다.
      const shown = expanded ? rows[expanded].panel.textContent : '';
      if (typeof result === 'string' && !shown.includes(result)) announce(result);
    } catch (error) {
      announce(error?.message || '처리하지 못했습니다.');
    } finally {
      busy.delete(id); render(); // 상태 조회가 늦어져도 처리 중 표시는 즉시 푼다.
      await refresh();
    }
  }
  async function runExtension(x, event) {
    if (busy.has(x.id)) return;
    busy.add(x.id); render();
    try { const result = await x.run({ trusted: !!event?.isTrusted, window: api }); if (typeof result === 'string') announce(result); }
    catch (error) { announce(error?.message || '처리하지 못했습니다.'); }
    finally { busy.delete(x.id); await refresh(); }
  }

  let refreshSequence = 0;
  async function refresh() {
    const sequence = ++refreshSequence;
    try {
      const next = await adapter.getState();
      if (sequence !== refreshSequence) return;
      // 사용자가 고른 AI 방식(viewMode)은 새로 고쳐도 유지한다.
      raw = { ...next, ai: { ...next.ai, viewMode: raw.ai?.viewMode || next.ai?.viewMode }, repair: raw.repair?.state && raw.repair.state !== 'idle' ? raw.repair : next.repair };
    } catch { /* adapter가 상태를 못 주면 이전 화면 유지 */ }
    render();
  }

  function setState(partial) { raw = { ...raw, ...partial }; render(); }

  // ── 열기·닫기·자리·키보드
  const isOpen = () => mount.matches(':popover-open');
  function position() {
    if (!lastAnchor?.isConnected) return;
    const place = placePopover(lastAnchor.getBoundingClientRect(), { width: innerWidth, height: innerHeight });
    mount.style.setProperty('--ap-left', `${place.left}px`);
    mount.style.setProperty('--ap-top', `${place.top}px`);
    mount.style.setProperty('--ap-width', `${place.width}px`);
    mount.style.setProperty('--ap-caret', `${place.caret}px`);
    mount.style.setProperty('--ap-max-h', `${place.maxHeight}px`);
  }
  const focusables = () => [...mount.querySelectorAll(FOCUSABLE)].filter((n) => n.getClientRects().length);

  // keyboard: 단추를 키보드(Enter·Space)로 열었으면 첫 단추로 초점, 마우스로 열었으면 팝오버 자체에 초점(초점 테두리 없이).
  function open(from, { keyboard = true } = {}) {
    opener = from || document.activeElement;
    lastAnchor = from || lastAnchor;
    if (!isOpen()) announce(''); // 지난번 알림 문구는 새로 열 때 지운다
    render();
    position();
    if (!isOpen()) mount.showPopover();
    opener?.setAttribute?.('aria-expanded', 'true');
    document.addEventListener('pointerdown', onOutside, true);
    document.addEventListener('keydown', onDocumentKey, true);
    window.addEventListener('blur', onBlur);
    window.addEventListener('resize', position);
    (keyboard ? (loginEntries.find(entry => !logins.hidden && !entry.button.disabled)?.button || rows.coin.disclose) : mount).focus({ preventScroll: true });
    return refresh();
  }
  function close({ restoreFocus = true } = {}) {
    if (!isOpen()) return;
    mount.hidePopover();
    expanded = null;
    render();
    opener?.setAttribute?.('aria-expanded', 'false');
    document.removeEventListener('pointerdown', onOutside, true);
    document.removeEventListener('keydown', onDocumentKey, true);
    window.removeEventListener('blur', onBlur);
    window.removeEventListener('resize', position);
    if (restoreFocus && opener?.isConnected) opener.focus({ preventScroll: true });
  }
  function toggle(from, options) { return isOpen() ? close() : open(from, options); }

  // 초점이 팝오버 밖(body 등)에 있어도 Esc로 닫히고, Tab은 팝오버 안으로 돌아온다.
  function onDocumentKey(event) {
    if (mount.contains(event.target)) return;
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); }
    else if (event.key === 'Tab') { event.preventDefault(); (focusables()[0] || mount).focus(); }
  }
  function onOutside(event) {
    if (mount.contains(event.target) || opener?.contains?.(event.target)) return;
    close({ restoreFocus: false });
  }
  // 앱 창이 초점을 잃으면 닫는다(편집기 iframe을 누른 경우 포함). 카카오 로그인처럼 브라우저가 열려도 닫히지만,
  // 로그인 확인은 adapter가 팝오버와 따로 계속한다.
  function onBlur() { if (document.visibilityState === 'visible') close({ restoreFocus: false }); }

  mount.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); return; }
    if (event.key === 'Tab') {
      const list = focusables();
      if (!list.length) return;
      const first = list[0], last = list[list.length - 1], active = document.activeElement;
      const away = active === mount || !mount.contains(active);
      if (event.shiftKey && (active === first || away)) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (active === last || away)) { event.preventDefault(); first.focus(); }
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      // 줄 사이 이동: 줄 머리(›)·머리 단추·바닥 링크만 위아래로.
      const list = focusables().filter((n) => !n.closest('.ap-seg'));
      const i = list.indexOf(document.activeElement);
      if (i < 0) return;
      event.preventDefault();
      list[(i + (event.key === 'ArrowDown' ? 1 : list.length - 1)) % list.length].focus();
    }
    if ((event.key === 'ArrowRight' || event.key === 'ArrowLeft') && document.activeElement?.dataset?.apToggle) {
      const id = document.activeElement.dataset.apToggle;
      if ((event.key === 'ArrowRight') !== (expanded === id)) { event.preventDefault(); toggleRow(id); }
    }
  });
  mount.addEventListener('toggle', (event) => { if (event.newState === 'closed' && opener) opener.setAttribute?.('aria-expanded', 'false'); });

  // 닫혀 있을 때는 다시 묻지 않는다(업데이트 받는 중 진행 알림마다 계정 서버를 부르지 않도록).
  const unsubscribe = adapter.subscribe?.(() => { if (isOpen()) refresh(); });
  const api = {
    open, close, toggle, refresh, setState, render, expand: (id) => { if (POPOVER_ROWS.includes(id) && expanded !== id) toggleRow(id); },
    get isOpen() { return isOpen(); }, get expanded() { return expanded; }, get view() { return view; }, get state() { return state; },
    rendererVersion: RENDERER_VERSION, contractSha256: hash, dispose: () => unsubscribe?.(),
  };
  render();
  return api;
}
