// SharedAccountWindow — 네 앱 공통 "계정 및 업데이트" 창 렌더러.
// 사용: const win = await createAccountWindow({ dialog, adapter }); win.open(opener);
// adapter 규격은 README.md 참고. 이 파일·model.mjs·account-window.css·contract/는 앱마다 고치지 않는다.
import { RENDERER_VERSION, CONTRACT_SHA256, ALLOWED_APP_FIELDS, validateContract, normalizeState, buildView } from './model.mjs';
import { ICONS } from './icons.mjs';

const BASE = new URL('./', import.meta.url);

async function sha256Hex(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

export async function loadContract() {
  const response = await fetch(new URL('contract/account-window.json', BASE), { cache: 'no-store' });
  const text = await response.text();
  const hash = await sha256Hex(text);
  if (hash !== CONTRACT_SHA256['account-window.json']) throw new Error('계정 창 계약 파일이 공통 판과 다릅니다.');
  return { contract: validateContract(JSON.parse(text)), hash };
}

function ensureStyles() {
  if (document.querySelector('link[data-account-window-css]')) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = new URL('account-window.css', BASE).href;
  link.dataset.accountWindowCss = RENDERER_VERSION;
  document.head.append(link);
}

function applyTheme(dialog, contract) {
  const t = contract.theme, l = contract.layout;
  const set = (name, value) => dialog.style.setProperty(`--aw-${name}`, value);
  for (const key of ['background', 'surface', 'panel', 'border', 'text', 'muted', 'accent', 'kakaoBackground', 'kakaoText', 'error', 'focus']) set(key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`), t[key]);
  set('font', t.fontFamily.map((f) => (/\s/.test(f) ? `"${f}"` : f)).join(','));
  for (const [name, type] of Object.entries(t.type)) { set(`${name}-size`, `${type.size}px`); set(`${name}-line`, `${type.lineHeight}px`); set(`${name}-weight`, type.weight); }
  set('modal-width', `${l.modal.width}px`); set('modal-padding', `${l.modal.padding}px`); set('modal-gap', `${l.modal.gap}px`); set('modal-radius', `${l.modal.radius}px`);
  set('header-height', `${l.header.height}px`); set('brand-icon', `${l.header.brandIconSize}px`); set('brand-gap', `${l.header.brandGap}px`); set('close-size', `${l.header.closeSize}px`);
  set('account-min', `${l.accountPanel.minHeight}px`); set('panel-padding', `${l.accountPanel.padding}px`); set('avatar', `${l.accountPanel.avatarSize}px`); set('avatar-gap', `${l.accountPanel.avatarTextGap}px`);
  set('ai-min', `${l.aiPanel.minHeight}px`); set('update-min', `${l.updatePanel.minHeight}px`); set('footer-min', `${l.footer.minHeight}px`); set('footer-gap', `${l.footer.gap}px`);
  set('button-height', `${l.button.height}px`); set('button-radius', `${l.button.radius}px`); set('button-px', `${l.button.paddingX}px`); set('button-gap', `${l.button.gap}px`);
  set('kakao-width', `${l.kakaoButton.width}px`); set('kakao-height', `${l.kakaoButton.height}px`); set('kakao-icon', `${l.kakaoButton.iconSize}px`); set('kakao-icon-gap', `${l.kakaoButton.iconGap}px`);
  set('outer', `${l.responsive.outerMargin}px`);
}

function h(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key === 'html') node.innerHTML = value; // 고정 아이콘 문자열만
    else if (key.startsWith('data-') || key.startsWith('aria-') || key === 'role' || key === 'type' || key === 'id' || key === 'hidden' || key === 'tabindex') node.setAttribute(key, value === true ? '' : value);
    else node[key] = value;
  }
  node.append(...children.flat().filter((c) => c !== null && c !== undefined && c !== false));
  return node;
}

export async function createAccountWindow({ dialog, adapter }) {
  if (!dialog || dialog.tagName !== 'DIALOG') throw new Error('계정 창을 넣을 <dialog>가 필요합니다.');
  const app = Object.fromEntries(ALLOWED_APP_FIELDS.map((key) => [key, adapter.app?.[key] ?? null]));
  ensureStyles();
  const { contract, hash } = await loadContract();
  applyTheme(dialog, contract);
  dialog.classList.add('aw-dialog');
  dialog.setAttribute('aria-labelledby', 'aw-title');
  dialog.dataset.rendererVersion = RENDERER_VERSION;
  dialog.dataset.contractSha256 = hash;
  dialog.dataset.appId = app.appId || '';

  let raw = {};
  let view = null;
  let opener = null;
  const busy = new Set();
  const buttons = new Map(); // actionId → [button]

  const actionButton = (id, extra = {}) => {
    const button = h('button', { type: 'button', class: `aw-button aw-${extra.style || 'outline'}`, 'data-aw-action': id, ...extra.attrs }, ...(extra.children || []));
    button.addEventListener('click', (event) => run(id, event));
    if (!buttons.has(id)) buttons.set(id, []);
    buttons.get(id).push(button);
    return button;
  };
  const label = (id) => contract.actions.find((a) => a.id === id)?.label || id;
  const style = (id) => contract.actions.find((a) => a.id === id)?.style || 'outline';

  // header
  const brandIcon = app.officialIconAsset ? h('img', { src: app.officialIconAsset, alt: '', class: 'aw-brand-img' }) : h('span', { class: 'aw-brand-fallback', text: (app.displayName || '?').charAt(0) });
  const el = {
    title: h('h2', { id: 'aw-title' }), subtitle: h('p', { class: 'aw-subtitle' }),
    brand: h('strong'), version: h('span', { 'data-aw-field': 'version' }),
    avatar: h('span', { class: 'aw-avatar', 'aria-hidden': 'true' }), name: h('strong', { class: 'aw-name', 'data-aw-field': 'name' }), accountText: h('p', { class: 'aw-body-text', 'data-aw-field': 'session' }),
    walletTitle: h('h3', { class: 'aw-section-title' }), walletValue: h('strong', { class: 'aw-wallet-value', 'data-aw-field': 'wallet' }), walletText: h('p', { class: 'aw-body-text' }),
    aiTitle: h('h3', { class: 'aw-section-title' }), modes: h('div', { class: 'aw-modes', role: 'group', 'aria-label': 'AI 연결 방식' }),
    model: h('span', { class: 'aw-model', 'data-aw-field': 'model' }), selectedModel: h('span', { class: 'aw-caption aw-selected-model' }), status: h('span', { class: 'aw-chip', 'data-aw-field': 'ai-status' }), aiCaption: h('p', { class: 'aw-caption' }),
    updateTitle: h('h3', { class: 'aw-section-title' }), updateText: h('p', { class: 'aw-body-text', 'data-aw-field': 'update' }), updateCurrent: h('span', { class: 'aw-update-current' }), updateNext: h('span', { class: 'aw-update-next' }),
    progress: h('progress', { class: 'aw-progress', max: 100, hidden: true }),
    notes: h('ul', { class: 'aw-notes', 'aria-label': '이번 업데이트 변경 내용', hidden: true }),
    extensions: h('span', { class: 'aw-extension-actions' }),
    footerText: h('p', { class: 'aw-caption', 'data-aw-field': 'footer' }), footerKeep: h('p', { class: 'aw-caption' }),
    live: h('p', { class: 'aw-live', 'aria-live': 'polite', role: 'status' }),
  };
  // 카카오 공식 심볼(카카오 로그인 공식 리소스 kakao_login_light.svg의 말풍선 경로 그대로). 네 앱 공통이라 adapter가 바꾸지 않는다.
  const kakaoIcon = h('img', { src: new URL('shared-assets/kakao-symbol-approved.svg', BASE).href, alt: '', class: 'aw-kakao-icon', width: 20, height: 20 });
  const shell = h('div', { class: 'aw-shell' },
    h('header', { class: 'aw-header', 'data-section': 'header' },
      h('div', { class: 'aw-heading' }, el.title, el.subtitle),
      h('div', { class: 'aw-brand' }, h('span', { class: 'aw-brand-icon' }, brandIcon), h('div', { class: 'aw-brand-text' }, el.brand, el.version)),
      actionButton('window.close', { style: 'icon', attrs: { class: 'aw-button aw-close', 'aria-label': label('window.close') }, children: [h('span', { html: ICONS.close })] })),
    h('div', { class: 'aw-body' },
      h('section', { class: 'aw-panel aw-account', 'data-section': 'account', 'aria-label': '계정' },
        h('div', { class: 'aw-account-left' },
          h('div', { class: 'aw-account-head' }, el.avatar, h('div', { class: 'aw-account-copy' }, el.name, el.accountText)),
          h('div', { class: 'aw-actions' },
            actionButton('auth.login', { style: 'kakao', children: [kakaoIcon, h('span', { text: label('auth.login') })] }),
            actionButton('auth.logoutApp', { style: style('auth.logoutApp'), children: [label('auth.logoutApp')] }),
            actionButton('account.manage', { style: style('account.manage'), children: [label('account.manage')] }))),
        h('div', { class: 'aw-account-right' },
          el.walletTitle, el.walletValue, el.walletText,
          h('div', { class: 'aw-actions' },
            actionButton('wallet.openTopup', { style: style('wallet.openTopup'), children: [label('wallet.openTopup')] }),
            actionButton('wallet.openHistory', { style: style('wallet.openHistory'), children: [label('wallet.openHistory')] })))),
      h('section', { class: 'aw-panel aw-ai', 'data-section': 'ai', 'aria-labelledby': 'aw-ai-title' },
        h('div', { class: 'aw-panel-head' }, h('span', { class: 'aw-badge', html: ICONS.robot }), h('div', { class: 'aw-panel-head-copy' }, el.aiTitle, el.modes)),
        h('div', { class: 'aw-ai-row' },
          h('span', { class: 'aw-row-label', text: '사용 모델' }), h('span', { class: 'aw-row-sep', 'aria-hidden': 'true' }),
          h('span', { class: 'aw-model-wrap' }, el.model, el.selectedModel), el.status, h('span', { class: 'aw-grow' }),
          actionButton('ai.testConnection', { style: style('ai.testConnection'), children: [label('ai.testConnection')] }),
          actionButton('ai.openSettings', { style: style('ai.openSettings'), children: [label('ai.openSettings')] })),
        el.aiCaption),
      h('section', { class: 'aw-panel aw-update', 'data-section': 'update', 'aria-label': '업데이트' },
        h('div', { class: 'aw-panel-head aw-update-head' }, h('span', { class: 'aw-badge', html: ICONS.refresh }), h('div', { class: 'aw-panel-head-copy' }, el.updateTitle, el.updateText)),
        h('div', { class: 'aw-update-side' }, h('div', { class: 'aw-update-versions' }, el.updateCurrent, el.updateNext),
          h('div', { class: 'aw-actions' }, el.extensions,
            actionButton('update.download', { style: style('update.download'), children: [label('update.download')] }),
            actionButton('update.check', { style: style('update.check'), children: [label('update.check')] }))),
        el.progress, el.notes)),
    h('footer', { class: 'aw-footer', 'data-section': 'footer' },
      actionButton('repair.diagnose', { style: style('repair.diagnose'), attrs: { class: 'aw-button aw-outline aw-repair' }, children: [h('span', { class: 'aw-inline-icon', html: ICONS.wrench }), h('span', { text: label('repair.diagnose') })] }),
      h('span', { class: 'aw-footer-sep', 'aria-hidden': 'true' }),
      h('div', { class: 'aw-footer-copy' }, el.footerText, el.footerKeep),
      h('span', { class: 'aw-grow' }),
      actionButton('window.close', { style: 'outline', attrs: { class: 'aw-button aw-outline aw-footer-close' }, children: [label('window.close')] })),
    el.live);
  el.aiTitle.id = 'aw-ai-title';
  dialog.replaceChildren(shell);

  function render() {
    const state = normalizeState(app, raw);
    view = buildView(contract, state);
    el.title.textContent = view.header.title; el.subtitle.textContent = view.header.subtitle;
    el.brand.textContent = view.header.brand || ''; el.version.textContent = view.header.version;
    dialog.dataset.session = view.account.sessionState;
    el.avatar.textContent = view.account.avatar; el.name.textContent = view.account.name; el.accountText.textContent = view.account.description;
    el.walletTitle.textContent = view.account.walletTitle;
    el.walletValue.textContent = view.account.walletKnown ? view.account.walletValue : '';
    el.walletValue.classList.toggle('aw-unknown', !view.account.walletKnown);
    el.walletValue.setAttribute('aria-label', view.account.walletKnown ? `${view.account.walletValue} 코인` : '보유 코인 알 수 없음');
    el.walletText.textContent = view.account.walletDescription;
    el.aiTitle.textContent = view.ai.title;
    el.modes.replaceChildren(...view.ai.modes.map((mode) => {
      const b = h('button', { type: 'button', class: `aw-mode${mode.selected ? ' aw-selected' : ''}`, 'aria-pressed': String(mode.selected), 'data-aw-mode': mode.id, text: mode.label });
      b.addEventListener('click', () => { raw = { ...raw, ai: { ...raw.ai, viewMode: mode.id } }; render(); });
      return b;
    }));
    el.model.textContent = view.ai.model; el.model.classList.toggle('aw-unknown-text', !view.ai.modelKnown);
    el.selectedModel.textContent = view.ai.selectedModel;
    el.status.innerHTML = `${view.ai.statusState === 'connected' ? ICONS.check : view.ai.statusState === 'error' || view.ai.statusState === 'offline' ? ICONS.alert : ICONS.clock}`;
    el.status.append(h('span', { text: view.ai.status }));
    el.status.dataset.state = view.ai.statusState;
    el.aiCaption.textContent = view.ai.caption;
    el.updateTitle.textContent = view.update.title; el.updateText.textContent = view.update.text;
    el.updateCurrent.textContent = view.update.current; el.updateNext.textContent = view.update.next;
    el.progress.hidden = view.update.progress === null;
    if (view.update.progress !== null) { if (view.update.progress >= 0) el.progress.value = view.update.progress; else el.progress.removeAttribute('value'); }
    el.notes.hidden = !view.update.notes.length;
    el.notes.replaceChildren(...view.update.notes.map((text) => h('li', { text })));
    el.extensions.replaceChildren(...(adapter.updateExtensions || []).filter((x) => x.visible?.(state)).map((x) => {
      const b = h('button', { type: 'button', class: `aw-button aw-${x.style || 'accent'}`, 'data-aw-extension': x.id, text: x.label });
      b.disabled = busy.has(x.id) || x.enabled?.(state) === false;
      b.addEventListener('click', (event) => runExtension(x, event));
      return b;
    }));
    el.footerText.textContent = view.footer.description; el.footerKeep.textContent = view.footer.preservation;
    for (const [id, list] of buttons) {
      const supported = typeof adapter.actions?.[id] === 'function' || id === 'window.close';
      for (const button of list) {
        button.disabled = !view.enabled[id] || !supported || busy.has(id);
        button.title = supported ? '' : '이 앱에서는 아직 지원하지 않습니다.';
      }
    }
    for (const button of buttons.get('ai.testConnection') || []) button.hidden = !view.ai.showTest;
    for (const button of buttons.get('update.download') || []) button.hidden = !view.update.showDownload;
  }

  function announce(text) { el.live.textContent = ''; if (text) requestAnimationFrame(() => { el.live.textContent = text; }); }

  async function run(id, event) {
    if (id === 'window.close') { close(); return; }
    if (!view?.enabled[id] || busy.has(id) || typeof adapter.actions?.[id] !== 'function') return;
    busy.add(id); render();
    try {
      const result = await adapter.actions[id]({ trusted: !!event?.isTrusted, viewMode: normalizeState(app, raw).ai.viewMode, window: api });
      if (typeof result === 'string') announce(result);
    } catch (error) {
      announce(error?.message || '처리하지 못했습니다.');
    } finally {
      busy.delete(id);
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

  async function refresh() {
    try {
      const next = await adapter.getState();
      // 사용자가 고른 AI 보기 칸(viewMode)은 새로 고쳐도 유지한다. 실제 제공자 전환은 하지 않는다.
      raw = { ...next, ai: { ...next.ai, viewMode: raw.ai?.viewMode || next.ai?.viewMode }, repair: raw.repair?.state && raw.repair.state !== 'idle' ? raw.repair : next.repair };
    } catch { /* adapter가 상태를 못 주면 이전 화면 유지 */ }
    render();
  }

  function setState(partial) {
    raw = { ...raw, ...partial };
    render();
  }

  function open(from) {
    opener = from || document.activeElement;
    if (!dialog.open) dialog.showModal();
    dialog.querySelector('[data-aw-action="auth.login"]:not(:disabled), .aw-close')?.focus();
    return refresh();
  }
  function close() {
    if (dialog.open) dialog.close();
  }
  dialog.addEventListener('close', () => { if (opener?.isConnected) opener.focus(); });

  const unsubscribe = adapter.subscribe?.(() => { if (dialog.open) refresh(); });
  const api = { open, close, refresh, setState, render, get view() { return view; }, rendererVersion: RENDERER_VERSION, contractSha256: hash, dispose: () => unsubscribe?.() };
  render();
  return api;
}
