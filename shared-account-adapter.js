/*
 * 바른 CAD → 공통 "계정 및 업데이트" 창 adapter.
 * 공통 부품: shared/account-window/ (바른문서에서 만든 중앙 판, rendererVersion 2.1.0-r1+cad.1). CAD 수정판은 manifest와 docs/계정창-바른문서-옮길것.md에 기록한다.
 * 이 파일은 README의 adapter 규격(app · getState · subscribe · actions · updateExtensions)만 채운다.
 *
 *   계정·코인·계정 페이지  studio.api('account', {action:'status'|'login'|'logout'|'open', page}) → server.py → miri_account_service.py
 *   업데이트             window.cadDesktop.checkUpdate() · applyUpdate() · onUpdateStatus(→ window.barunRenderUpdate)
 *   AI                  미리 제공(managed): 계정 status의 miri_connected, 없으면 studio.api('chat', {action:'status'})
 *                       내 모델(personal): 이 PC의 Codex(ChatGPT 계정). studio.api('chat', {action:'codexStatus'|'codexLogin'|'codexLogout'})
 *                       고른 방식은 studio.api('chat', {action:'mode'|'setMode'})로 서버(chat_router.py)에 남기고, 채팅도 그 길로 간다.
 *
 * 없는 것은 없다고 둔다: 미리 쪽 실제 모델·과금 출처(null → "연결 후 확인"),
 * AI 연결 설정 화면(action 없음 → 공통 부품이 꺼 둠), 자가 복구 처리기(unsupported 결과만 표시), SSO broker.
 * 토큰은 이 파일을 지나가지 않는다(백엔드가 Windows DPAPI로 보관). 응답에서 필요한 필드만 골라 넘긴다.
 *
 * 공통 renderer.mjs는 import.meta.url 기준으로 계약·CSS·심볼을 읽으므로 app.js 묶음에 넣지 않는다.
 * 그래서 정적 import 대신 실행 중 주소로 불러온다(esbuild는 문자열이 아닌 import(url)을 그대로 둔다).
 */
import { userErrorMessage } from './user-error.js';
import { openConsentManager } from './ai-consent.js';

export const CAD_APP_ID = 'barun-cad';
/* shared/account-window/contract/apps/barun-cad.json 의 displayName. */
export const CAD_DISPLAY_NAME = '바른 CAD';
/* P0 확인: BrowserWindow 아이콘으로 쓰는 512×512 공식 아이콘(서버 허용 목록·설치본에 이미 있음). */
export const CAD_ICON = 'barun-cad-brand.png';
export const SHARED_BASE = 'shared/account-window/';
export const CAD_PROVIDER = '미리';
export const ACCOUNT_PAGES = Object.freeze({ 'account.manage': 'account', 'wallet.openTopup': 'charge', 'wallet.openHistory': 'history' });
/* shared/account-window/contract/self-repair.json outcomes.unsupported (시험이 같은 글자인지 확인한다). */
export const REPAIR_UNSUPPORTED = '이 연결은 자동 복구를 지원하지 않습니다.';
export const LOGIN_POLL_MS = 3000;
export const LOGIN_PROVIDERS = Object.freeze([
  Object.freeze({ id: 'kakao', label: '카카오 로그인', style: 'kakao', supported: true }),
  Object.freeze({ id: 'google', label: 'Google 로그인', style: 'google', supported: true }),
]);
/* 업데이트 진행 이벤트마다 계정 서버를 다시 부르지 않도록 계정 조회 결과를 잠깐 재사용한다. */
export const ACCOUNT_CACHE_MS = 4000;
const LOGIN_WINDOW_S = { min: 60, max: 900, fallback: 600 };

export const CAD_TEXT = Object.freeze({
  loginNeedsClick: '로그인은 사용자가 직접 눌러야 시작됩니다.',
  loginStarted: '브라우저에서 카카오 로그인을 마쳐 주세요.',
  loggedOut: '이 앱에서 로그아웃했습니다.',
  pageOpened: '브라우저에서 열었습니다.',
  aiConnected: '미리와 연결되어 있습니다. (요금이 드는 요청은 보내지 않았습니다.)',
  aiNotConnected: '미리와 연결되지 않았습니다. 미리를 실행한 뒤 다시 시도해 주세요.',
  codexConnected: 'Codex 연결을 확인했습니다. (요금이 드는 요청은 보내지 않았습니다.)',
  codexNotConnected: 'Codex에 로그인되어 있지 않습니다.',
  codexLoginStarted: '브라우저에서 로그인한 뒤 이 창으로 돌아오세요.',
  codexLoggedOut: 'Codex에서 로그아웃했습니다.',
  logoutNeedsClick: '로그아웃은 사용자가 직접 눌러야 합니다.',
  mcpNeedsClick: 'AI 프로그램 연결은 사용자가 직접 눌러야 합니다.',
  consentManageOpened: '허락한 AI 목록을 열었습니다.',
  aiModeInvalid: 'AI 방식이 올바르지 않습니다.',
  updateNoDesktop: '이 실행 환경에서는 업데이트를 확인할 수 없습니다. 바른 CAD 데스크톱 앱에서 확인해 주세요.',
  updateSkip: '이 설치판은 온라인 업데이트를 사용하지 않습니다.',
  installLabel: '업데이트 적용',
  installNeedsClick: '업데이트 적용은 버튼을 직접 눌러야 합니다.',
  installStarted: 'CAD를 닫으면서 받은 업데이트를 적용합니다.',
  installMissing: '적용할 업데이트가 없습니다.',
  failed: '요청을 완료하지 못했습니다.',
});

/* ---------------------------------------------------------------- 순수 변환 */

/* 런타임 문장에서 토큰·이메일·전체 경로를 지운다(self-repair.json report.redaction 범위). */
export function sanitize(value, max = 240) {
  const source = value instanceof Error ? value.message : value;
  if (typeof source !== 'string') return null;
  const text = source.replace(/\s+/g, ' ').trim()
    .replace(/\bBearer\s+\S+/gi, 'Bearer [숨김]')
    .replace(/\b(access_?token|refresh_?token|api_?key|authorization|token|secret)(\s*[=:]\s*)["']?[^\s"',;]+/gi, '$1$2[숨김]')
    .replace(/[A-Za-z0-9+/_=-]{32,}/g, '[숨김]')
    .replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, '[이메일]')
    .replace(/(?:[A-Za-z]:\\|\\\\)[^\s"'<>|]*/g, '[경로]')
    // 맥·리눅스 경로에도 사용자 이름이 들어 있다(/Users/<이름>/…).
    .replace(/(?:\/Users|\/home|\/private|\/Volumes|\/var\/folders)\/[^\s"'<>|]*/g, '[경로]');
  return text ? Array.from(text).slice(0, max).join('') : null;
}

const PLAIN_VERSION = /^v?(\d+)\.(\d+)\.(\d+)$/;
export const plainVersion = value => { const m = PLAIN_VERSION.exec(String(value ?? '').trim()); return m ? `${Number(m[1])}.${Number(m[2])}.${Number(m[3])}` : null; };
/* 공통 model.mjs의 compareVersions와 같은 규칙(x.y.z만, 꼬리표가 있으면 비교 불가). */
export function compareVersions(a, b) {
  const x = plainVersion(a)?.split('.').map(Number), y = plainVersion(b)?.split('.').map(Number);
  if (!x || !y) return null;
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i] ? 1 : -1;
  return 0;
}

/* 계정 오류 문장 → 세션 상태. 백엔드: '…만료됐습니다…'(401), '미리보다 계정 서버에 연결하지 못했습니다.'(망·서버). */
export function classifyAccountError(error) {
  const text = String(error?.message ?? error ?? '');
  if (/만료/.test(text)) return 'expired';
  if (/계정 서버에 연결하지 못했습니다|인터넷/.test(text)) return 'offline';
  return 'error';
}

/* miri_account_service.process({action:'status'}) 응답 → 세션·지갑. 필요한 필드만 읽는다. */
export function mapAccountStatus(result, { loginPending = null, expired = false, now = Date.now() } = {}) {
  const r = result && typeof result === 'object' ? result : {};
  const serverState = typeof r.state === 'string' ? r.state : 'disconnected';
  const pendingActive = !!loginPending && now - loginPending.since < loginPending.limitMs;
  let session, clearPending = true;
  if (serverState === 'linked' && r.connected === true) {
    const name = typeof r.display_name === 'string' && r.display_name.trim() ? Array.from(r.display_name.trim()).slice(0, 120).join('') : null;
    session = { state: 'connected', displayName: name };
  } else if (serverState === 'waiting' && pendingActive) {
    session = { state: 'authenticating', displayName: null };
    clearPending = false;
  } else if (serverState === 'blocked') {
    session = { state: 'error', displayName: null };
  } else {
    // 승인 창이 지난 waiting, disconnected: 로그인하지 않은 상태. 401로 만료된 적이 있으면 로그인 전까지 expired.
    session = { state: expired ? 'expired' : 'signed_out', displayName: null };
  }
  const balance = typeof r.coin_balance === 'number' && Number.isFinite(r.coin_balance) ? r.coin_balance : null;
  const wallet = session.state !== 'connected' ? { state: 'unknown', balance: null } : balance === null ? { state: 'error', balance: null } : { state: 'ready', balance };
  return { session, wallet, miriConnected: typeof r.miri_connected === 'boolean' ? r.miri_connected : null, clearPending };
}

export const AI_MODES = Object.freeze(['managed', 'personal']);
export const CODEX_LOGIN_POLL = Object.freeze({ intervalMs: 3000, maxMs: 120_000 });

/* 내 모델: codex_chat.py status({connected, authenticated, plan}) → 공통 규격. 바른문서 mapCodex와 같은 표시. */
/* Codex 추론 깊이 이름(10-26 시안 docs/mockup-codex-model-2026-10-26). */
export const EFFORT_LABEL = Object.freeze({ low: '낮음 · 빠름', medium: '보통', high: '높음', xhigh: '아주 높음', max: '최대', ultra: '울트라' });
/* 모델 이름의 갈래로 짧은 설명(Codex 가 주는 설명은 영어라서). 시안: Astra 가장 똑똑함, Sol 일반, Luna 빠르고 저렴, Terra 균형. */
export const codexKind = id => /astra/i.test(id) ? '가장 똑똑함 · 어려운 일' : /luna/i.test(id) ? '빠르고 저렴 · 쉬운 일' : /terra/i.test(id) ? '균형' : /sol/i.test(id) ? '일반 작업' : '';
export function mapCodex(status) {
  if (!status || typeof status !== 'object') return { state: 'unconfigured', configured: false };
  const connected = status.authenticated === true;
  return {
    state: connected ? 'connected' : 'unconfigured',
    configured: connected,
    providerDisplayName: 'OpenAI Codex (ChatGPT 계정)',
    actualModelId: connected && status.modelName ? `${status.modelName} · ${EFFORT_LABEL[status.effort] || status.effort || ''}`.replace(/ · $/, '') : null,
    selectedModelId: null,
    billingSource: connected ? `ChatGPT ${status.plan ? `${status.plan} ` : ''}요금제 (사용자 본인 계정)` : null,
  };
}

/* AI: 미리 제공은 실제 모델·과금을 미리가 알려 주지 않으므로 비워 둔다. 고른 방식(mode)이 채팅이 실제로 쓰는 길이다. */
export function mapAi(probe, personal = null, mode = 'managed') {
  const managed = probe === null || probe === undefined
    ? { state: 'unconfigured', configured: false }
    : { state: probe, configured: true, providerDisplayName: CAD_PROVIDER, actualModelId: null, selectedModelId: null, billingSource: null };
  const active = AI_MODES.includes(mode) ? mode : 'managed';
  return { activeMode: active, viewMode: active, modes: { managed, personal: personal ?? { state: 'unconfigured', configured: false } } };
}

/* 내 모델 안에서 고르는 모델(2026-10-26 사장님 "그걸로" — docs/mockup-my-model-claude-2026-10-26). */
export const PERSONAL_PROVIDERS = Object.freeze(['codex', 'claude']);
export const CLAUDE_APPS = Object.freeze(['Claude 데스크톱', 'Claude Code']);
export const CLAUDE_KEY_PAGE = 'https://console.anthropic.com/settings/keys';
/* mcp_register.status() 의 한 줄 상태 → 화면 글. 줄이 없으면 그 프로그램이 이 PC 에 없다. */
export function claudeAppState(rows, app) {
  const row = (Array.isArray(rows) ? rows : []).find(r => r?.app === app);
  if (!row) return { state: 'unconfigured', text: '설치 안 됨' };
  if (row.state === 'ok') return { state: 'connected', text: '연결됨' };
  if (row.state === 'unreadable') return { state: 'error', text: '설정을 읽지 못함' };
  return { state: 'unconfigured', text: '연결 안 됨' };
}
/* 내 모델 > Claude: Claude 앱(MCP) 하나라도 연결됐거나 API 키가 있으면 연결됨. 키는 끝 4자리만 다룬다. */
export function mapClaude(key, mcpRows) {
  const apps = CLAUDE_APPS.filter(app => claudeAppState(mcpRows, app).state === 'connected');
  const keyed = key?.authenticated === true;
  const connected = apps.length > 0 || keyed;
  return {
    state: connected ? 'connected' : 'unconfigured',
    configured: connected,
    providerDisplayName: connected ? `Claude (${[apps.length ? 'Claude 앱' : null, keyed ? 'API 키' : null].filter(Boolean).join(' · ')})` : null,
    actualModelId: keyed ? (key.modelName || null) : null,
    selectedModelId: null,
    billingSource: connected ? [apps.length ? 'Claude 구독(Claude 앱)' : null, keyed ? `Anthropic API 키(…${key.keyTail || ''})` : null].filter(Boolean).join(' · ') : null,
  };
}

/* AI 자세히 칸의 Codex 로그인·로그아웃 단추: 보고 있는 방식이 '내 모델'일 때만. */
export const aiViewMode = s => s?.ai?.viewMode || s?.ai?.activeMode || 'managed';
export const showCodexLogin = s => aiViewMode(s) === 'personal' && s?.ai?.modes?.personal?.configured !== true;
export const showCodexLogout = s => aiViewMode(s) === 'personal' && s?.ai?.modes?.personal?.configured === true;

/* desktop.cjs 업데이트 상태({state:'idle'|'checking'|'current'|'downloading'|'ready'|'error'|'skip', version, current, percent, total, notes, message}) → 공통 규격.
   메인 프로세스는 문자열 같음으로만 비교하므로 여기서 다시 비교한다. 새 버전이 "높을 때만" available. */
export function mapUpdateStatus(status, installedVersion = null) {
  const s = status && typeof status === 'object' ? status : {};
  const installed = plainVersion(s.current) ?? plainVersion(installedVersion);
  const next = plainVersion(s.version);
  const base = { state: 'idle', phase: null, verified: false, nextVersion: null, percent: null, message: null, releaseNotes: [] };
  switch (s.state) {
    case 'checking': return { ...base, state: 'checking' };
    case 'current': return { ...base, state: 'up_to_date' };
    case 'downloading':
    case 'ready': {
      const order = compareVersions(next, installed);
      if (order === 1) {
        const percent = s.state === 'downloading' && Number.isFinite(s.percent) && Number(s.total) > 0 ? Math.max(0, Math.min(100, s.percent)) : null;
        const releaseNotes = String(s.notes ?? '').split(/\r?\n/).map(line => sanitize(line, 300)).filter(Boolean).slice(0, 5);
        // electron-updater가 설정된 배포 주소의 latest.yml에서 받은 버전이고 설치 버전보다 높을 때만 "검증됨".
        return { ...base, state: 'available', phase: s.state === 'ready' ? 'downloaded' : 'downloading', verified: true, nextVersion: next, percent, releaseNotes };
      }
      return order === null ? base : { ...base, state: 'up_to_date' };
    }
    case 'error': return { ...base, state: 'error', message: sanitize(s.message) };
    case 'skip': return { ...base, message: sanitize(s.message) ?? CAD_TEXT.updateSkip };
    default: return base;
  }
}

export async function readInstalledVersion(fetchImpl = globalThis.fetch?.bind(globalThis), url = 'package.json') {
  if (typeof fetchImpl !== 'function') return null;
  try {
    const response = await fetchImpl(url, { cache: 'no-store' });
    return response?.ok ? plainVersion((await response.json())?.version) : null;
  } catch { return null; }
}

/* ---------------------------------------------------------------- adapter */

export function createCadAccountAdapter({
  studio, desktop = globalThis.window?.cadDesktop ?? null, iconUrl = CAD_ICON, installedVersion = null,
  now = () => Date.now(), timers = {}, isWindowOpen = () => false, onSession = () => {}, errorMessage = userErrorMessage,
} = {}) {
  if (!studio || typeof studio.api !== 'function') throw new TypeError('studio.api is required');
  const setIntervalFn = timers.setInterval ?? ((fn, ms) => globalThis.setInterval(fn, ms));
  const clearIntervalFn = timers.clearInterval ?? (id => globalThis.clearInterval(id));
  let loginPending = null, loginTimer = null, expired = false, accountRevision = 0;
  let lastUpdate = {}, lastAiProbe = null, accountCache = null, codexCache = null, aiMode = null, codexPoll = null;
  let personalProvider = null, claudeKey = null, claudeMcp = null, codexChoice = null;
  async function readCodexChoice() {
    // Codex 가 알려 주는 모델 목록과 고른 모델·추론 깊이. 못 받으면 칸을 숨긴다(계정 창은 계속 열림).
    try { codexChoice = await studio.api('chat', { action: 'codexModels' }); }
    catch { codexChoice = { models: [] }; }
    return codexChoice;
  }
  const listeners = new Set();
  const notify = () => { for (const fn of listeners) { try { fn(); } catch { /* 화면 쪽 오류가 adapter를 멈추지 않게 */ } } };
  const message = error => sanitize(errorMessage(error)) ?? CAD_TEXT.failed;
  const fail = error => { throw new Error(message(error)); };

  const app = { appId: CAD_APP_ID, displayName: CAD_DISPLAY_NAME, officialIconAsset: iconUrl, installedVersion: plainVersion(installedVersion) };

  function stopLogin() {
    loginPending = null;
    if (loginTimer !== null) { clearIntervalFn(loginTimer); loginTimer = null; }
  }
  function startLogin(expiresIn) {
    const seconds = Number(expiresIn);
    const window = Math.min(LOGIN_WINDOW_S.max, Math.max(LOGIN_WINDOW_S.min, Number.isFinite(seconds) ? seconds : LOGIN_WINDOW_S.fallback));
    loginPending = { since: now(), limitMs: window * 1000 };
    expired = false;
    accountRevision++; accountCache = null;
    if (loginTimer === null) {
      // 브라우저 승인을 기다리는 동안 몇 초마다 다시 확인한다. 창이 닫혀 있어도 머리 단추 표시는 맞춘다.
      loginTimer = setIntervalFn(() => {
        accountCache = null;
        if (!loginPending) { stopLogin(); return; }
        if (isWindowOpen()) notify(); else getState().catch(() => {});
      }, LOGIN_POLL_MS);
    }
  }

  async function probeMiri() {
    try { return (await studio.api('chat', { action: 'status' }))?.authenticated === true ? 'connected' : 'offline'; }
    catch { return 'error'; }
  }

  async function readCodex() {
    // Codex가 설치되지 않았거나 응답이 없으면 '연결 안 됨'으로 둔다(계정 창은 계속 열려야 한다).
    try { codexCache = mapCodex(await studio.api('chat', { action: 'codexStatus' })); }
    catch { codexCache = { state: 'unconfigured', configured: false }; }
    return codexCache;
  }

  async function readMode() {
    if (aiMode) return aiMode;
    try {
      const result = await studio.api('chat', { action: 'mode' });
      aiMode = AI_MODES.includes(result?.mode) ? result.mode : 'managed';
      personalProvider = PERSONAL_PROVIDERS.includes(result?.personal) ? result.personal : 'codex';
    }
    catch { return 'managed'; }
    return aiMode;
  }

  async function readClaude() {
    // 키 상태(끝 4자리·모델)와 이 PC 의 Claude 앱 연결(MCP 등록) — 못 읽어도 계정 창은 열린다.
    const [key, mcp] = await Promise.all([
      studio.api('chat', { action: 'claudeStatus' }).catch(() => ({ authenticated: false })),
      studio.api('chat', { action: 'mcpStatus' }).catch(() => ({ apps: [] })),
    ]);
    claudeKey = key || { authenticated: false };
    claudeMcp = Array.isArray(mcp?.apps) ? mcp.apps : [];
    return mapClaude(claudeKey, claudeMcp);
  }

  async function readPersonal() {   // readMode 다음에 부른다(내 모델을 못 읽었으면 예전처럼 Codex)
    return (personalProvider || 'codex') === 'claude'
      ? (claudeKey && claudeMcp ? mapClaude(claudeKey, claudeMcp) : readClaude())
      : (codexCache ?? readCodex());
  }

  function stopCodexPoll() { if (codexPoll !== null) { clearIntervalFn(codexPoll); codexPoll = null; } }
  function startCodexPoll() {
    // Codex 로그인은 브라우저에서 끝나므로 최대 2분간 몇 초마다 다시 확인한다.
    stopCodexPoll();
    const until = now() + CODEX_LOGIN_POLL.maxMs;
    let checking = false;
    codexPoll = setIntervalFn(async () => {
      if (checking) return;
      if (now() > until) { stopCodexPoll(); return; }
      checking = true;
      try { const c = await readCodex(); notify(); if (c.configured) stopCodexPoll(); } finally { checking = false; }
    }, CODEX_LOGIN_POLL.intervalMs);
  }

  async function readAccount() {
    if (accountCache && now() - accountCache.at < ACCOUNT_CACHE_MS) return accountCache.value;
    const revision = accountRevision;
    let value;
    try {
      const raw = await studio.api('account', { action: 'status' });
      if (revision !== accountRevision) return readAccount(); // 로그인·로그아웃 전 조회 결과는 버린다.
      // 로그인 뒤 핵심 자산 열쇠를 이번에 처음 받았으면 화면 쪽 지식·법규 검사를 새로 읽게 알린다(app.js·live-check.js).
      if (raw?.protected_fresh) globalThis.dispatchEvent?.(new Event('barun-protected-unlocked'));
      const mapped = mapAccountStatus(raw, { loginPending, expired, now: now() });
      if (mapped.clearPending) stopLogin();
      if (mapped.session.state === 'connected') expired = false;
      value = mapped;
    } catch (error) {
      if (revision !== accountRevision) return readAccount();
      const kind = classifyAccountError(error);
      if (kind === 'expired') { expired = true; stopLogin(); globalThis.dispatchEvent?.(new Event('barun-protected-locked')); }
      value = { session: { state: kind, displayName: null }, wallet: { state: 'unknown', balance: null }, miriConnected: null };
    }
    accountCache = { at: now(), value };
    return value;
  }

  async function getState() {
    const revision = accountRevision;
    const account = await readAccount();
    const probe = account.miriConnected === null ? (lastAiProbe ?? await probeMiri()) : (account.miriConnected ? 'connected' : 'offline');
    const mode = await readMode(); // 내 모델(Codex|Claude)을 먼저 알아야 어느 쪽 상태를 물을지 정한다
    const personal = await readPersonal();
    if (revision !== accountRevision) return getState();
    onSession(account.session.state, account.session.displayName);
    return {
      session: { ...account.session },
      wallet: { ...account.wallet },
      ai: mapAi(probe, personal, mode),
      update: mapUpdateStatus(lastUpdate, app.installedVersion),
      repair: { state: 'idle' },
    };
  }

  async function checkUpdate() {
    if (typeof desktop?.checkUpdate !== 'function') { lastUpdate = { state: 'error', message: CAD_TEXT.updateNoDesktop }; notify(); return CAD_TEXT.updateNoDesktop; }
    lastUpdate = { state: 'checking' };
    notify();
    try { lastUpdate = (await desktop.checkUpdate()) || { state: 'error' }; }
    catch (error) { lastUpdate = { state: 'error', message: message(error) }; }
    return null; // 결과는 업데이트 칸의 상태 글자로 보인다.
  }

  const openPage = id => async () => {
    try { await studio.api('account', { action: 'open', page: ACCOUNT_PAGES[id] }); return CAD_TEXT.pageOpened; }
    catch (error) { return fail(error); }
  };

  const actions = {
    'auth.login': async ({ trusted, provider = 'kakao' } = {}) => {
      if (trusted !== true) throw new Error(CAD_TEXT.loginNeedsClick); // 명시적 사용자 클릭만 로그인을 시작한다.
      if (!LOGIN_PROVIDERS.some(p => p.id === provider && p.supported)) throw new Error('지원하지 않는 로그인 방식입니다.');
      try { startLogin((await studio.api('account', provider === 'kakao' ? { action: 'login' } : { action: 'login', provider }))?.expires_in); }
      catch (error) { return fail(error); }
      return provider === 'google' ? '브라우저에서 Google 로그인을 마쳐 주세요.' : CAD_TEXT.loginStarted;
    },
    'auth.logoutApp': async () => {
      // 백엔드는 서버 연결 해제 실패를 삼키고 이 PC의 연결 정보만 지운다(P0 표). "이 앱에서" 로그아웃으로만 알린다.
      let result;
      try { result = await studio.api('account', { action: 'logout' }); }
      catch (error) { return fail(error); }
      stopLogin(); expired = false; accountRevision++;
      // 백엔드가 로컬 토큰을 지웠다는 응답을 즉시 반영한다. 늦은 조회·AI 응답이 다시 막지 못하게 한다.
      accountCache = { at: now(), value: mapAccountStatus({ ...result, state: 'disconnected', connected: false }) };
      // 이미 받아 둔 잠근 화면 코드도 버린다(screen-vault.js·command-runner.js) — 엔진의 forget_screen 과 짝.
      globalThis.dispatchEvent?.(new Event('barun-protected-locked'));
      notify();
      return CAD_TEXT.loggedOut;
    },
    'account.manage': openPage('account.manage'),
    'wallet.openTopup': openPage('wallet.openTopup'),
    'wallet.openHistory': openPage('wallet.openHistory'),
    // 'ai.openSettings'는 넣지 않는다: 바른 CAD에는 AI 연결 설정 화면이 없다(미리의 전체 설정에서 관리). 공통 부품이 단추를 꺼 둔다.
    'ai.testConnection': async ({ viewMode } = {}) => {
      if (viewMode === 'personal' && personalProvider === 'claude') {
        const result = await readClaude();
        notify();
        if (!result.configured) throw new Error('Claude 가 아직 연결되지 않았습니다. Claude에 연결을 누르거나 API 키를 넣어 주세요.');
        return 'Claude 연결을 확인했습니다. (요금이 드는 요청은 보내지 않았습니다.)';
      }
      if (viewMode === 'personal') {
        const result = await readCodex();
        if (!result.configured) throw new Error(CAD_TEXT.codexNotConnected);
        return CAD_TEXT.codexConnected;
      }
      lastAiProbe = await probeMiri();
      accountCache = null;
      if (lastAiProbe !== 'connected') throw new Error(CAD_TEXT.aiNotConnected);
      return CAD_TEXT.aiConnected;
    },
    'update.check': checkUpdate,
    // desktop.cjs는 새 버전을 확인하는 순간 내려받기를 시작한다(autoDownload). 따로 받는 IPC가 없어 같은 확인 요청으로 시작·재확인한다.
    'update.download': async () => (mapUpdateStatus(lastUpdate, app.installedVersion).phase ? null : checkUpdate()),
    // 자가 복구 main/native 처리기가 아직 없다. 진단하는 척하지 않고 계약의 unsupported 결과만 보여 준다.
    'repair.diagnose': async ({ window: view } = {}) => {
      view?.setState?.({ repair: { state: 'blocked', summary: REPAIR_UNSUPPORTED } });
      return REPAIR_UNSUPPORTED;
    },
  };

  // 계약 v2에 없는 기존 CAD 기능 보존: 받아 둔 업데이트를 사용자가 눌러 적용(CAD를 닫으면서 설치). 공통 README가 정한 확장 자리.
  const updateExtensions = typeof desktop?.applyUpdate === 'function' ? [{
    id: 'update.install', label: CAD_TEXT.installLabel, style: 'accent',
    visible: state => state.update.phase === 'downloaded',
    enabled: state => state.update.phase === 'downloaded',
    run: async ({ trusted } = {}) => {
      if (trusted !== true) return CAD_TEXT.installNeedsClick;
      const result = await desktop.applyUpdate();
      return result?.ok ? CAD_TEXT.installStarted : CAD_TEXT.installMissing;
    },
  }] : [];

  // 계약에 없는 앱 전용(바른문서와 같음): AI 자세히 칸의 Codex(내 모델) 로그인·로그아웃. 사용자가 직접 누른 경우에만.
  const aiExtensions = [{
    id: 'ai.codexLogin', label: 'Codex 로그인', style: 'accent',
    visible: s => personalProvider !== 'claude' && showCodexLogin(s),
    enabled: () => true,
    run: async ({ trusted } = {}) => {
      if (trusted !== true) throw new Error(CAD_TEXT.loginNeedsClick);
      try { await studio.api('chat', { action: 'codexLogin' }); }
      catch (error) { return fail(error); }
      startCodexPoll();
      return CAD_TEXT.codexLoginStarted;
    },
  }, {
    id: 'ai.codexLogout', label: 'Codex 로그아웃', style: 'outline',
    visible: s => personalProvider !== 'claude' && showCodexLogout(s),
    enabled: () => true,
    run: async ({ trusted } = {}) => {
      if (trusted !== true) throw new Error(CAD_TEXT.logoutNeedsClick);
      stopCodexPoll();
      try { await studio.api('chat', { action: 'codexLogout' }); }
      catch (error) { return fail(error); }
      codexCache = null;
      notify();
      return CAD_TEXT.codexLoggedOut;
    },
  }, ...[['claude', 'Claude에 연결'], ['codex', 'Codex에 연결']].map(([client, label]) => ({
    // 처음 사용자: 이 PC의 Claude·Codex 설정에 바른 CAD MCP를 넣는다(chat_router mcpRegister → mcp_register.py). 바른 CAD 항목만 바꾼다.
    id: `ai.mcpRegister.${client}`, label, style: 'outline',
    // 내 모델에서는 고른 모델의 단추만(사장님 10-26 "코덱스 연결인데 클로드가 뜨네"): Codex 를 고르면 [Codex에 연결]만,
    // Claude 를 고르면 둘 다 숨긴다([Claude에 연결]은 Claude 칸 안에 따로 있다). 미리 제공에서는 둘 다 보인다.
    visible: s => aiViewMode(s) !== 'personal' || (client === 'codex' && (personalProvider || 'codex') === 'codex'),
    enabled: () => true,
    run: async ({ trusted } = {}) => {
      if (trusted !== true) throw new Error(CAD_TEXT.mcpNeedsClick);
      try {
        const result = await studio.api('chat', { action: 'mcpRegister', client });
        if (!result?.ok) throw new Error(result?.message || CAD_TEXT.failed);
        if (client === 'claude') claudeMcp = null;
        return result.message;
      } catch (error) { return fail(error); }
    },
  })), {
    // 바깥 AI 가 처음 붙을 때 CAD 화면에서 허락한·거절한 프로그램 목록(ai_consent.py). 취소하면 다음 연결 때 다시 묻는다.
    id: 'ai.consentManage', label: '허락한 AI 관리', style: 'outline',
    visible: () => true,
    enabled: () => true,
    run: async ({ trusted } = {}) => {
      if (trusted !== true) throw new Error(CAD_TEXT.mcpNeedsClick);
      try { await openConsentManager({ api: studio.api.bind(studio) }); }
      catch (error) { return fail(error); }
      return CAD_TEXT.consentManageOpened;
    },
  }];

  /* 내 모델 칸(시안 docs/mockup-my-model-claude-2026-10-26): [Codex | Claude] 고르기 → Claude 는 'Claude 앱으로 쓰기(구독, MCP)'가 먼저,
     'CAD 안 AI 창에서 쓰기(API 키)'는 접어 둔다. 한 번 만든 칸을 그대로 두고 글·숨김만 바꾼다(입력 중인 키가 지워지지 않게). */
  let panel = null, keyOpen = false, howtoOpen = false;
  async function setPersonal(next, ctx) {
    if (!PERSONAL_PROVIDERS.includes(next) || next === personalProvider) return;
    personalProvider = next;
    ctx.refresh?.();
    try { await studio.api('chat', { action: 'setPersonal', personal: next }); }
    catch (error) { ctx.announce?.(message(error)); }
    if (next === 'claude') await readClaude(); else await readCodex();
    notify();
  }
  function buildPanel(doc, ctx) {
    const el = (tag, props = {}, ...children) => {
      const node = doc.createElement(tag);
      for (const [k, v] of Object.entries(props)) {
        if (v === null || v === undefined || v === false) continue;
        if (k === 'class') node.className = v; else if (k === 'text') node.textContent = v; else node.setAttribute(k, v === true ? '' : v);
      }
      node.append(...children.filter(Boolean));
      return node;
    };
    const busyRun = async (button, work) => {
      if (button.disabled) return;
      button.disabled = true;
      try { const text = await work(); if (text) ctx.announce?.(text); }
      catch (error) { ctx.announce?.(message(error)); }
      finally { button.disabled = false; notify(); }
    };
    const choice = (id, title, sub) => {
      const b = el('button', { type: 'button', class: 'cad-ai-choice', role: 'radio', 'data-provider': id }, el('b', { text: title }), el('small', { text: sub }));
      b.addEventListener('click', () => setPersonal(id, ctx));
      return b;
    };
    const choices = el('div', { class: 'cad-ai-choices', role: 'radiogroup', 'aria-label': '내 모델' },
      choice('codex', 'Codex', 'ChatGPT 계정으로 로그인'), choice('claude', 'Claude', 'Claude 구독 · 또는 API 키'));
    // Claude 앱으로 쓰기(구독)
    const appRows = CLAUDE_APPS.map(app => {
      const status = el('span', { class: 'ap-status' }, el('i', { class: 'ap-dot', 'aria-hidden': 'true' }), el('span'));
      return { app, status, node: el('span', { class: 'cad-ai-app' }, el('span', { text: app }), status) };
    });
    const connect = el('button', { type: 'button', class: 'ap-btn ap-accent', text: 'Claude에 연결' });
    connect.addEventListener('click', event => busyRun(connect, async () => {
      if (!event.isTrusted) throw new Error(CAD_TEXT.mcpNeedsClick);
      const result = await studio.api('chat', { action: 'mcpRegister', client: 'claude' });
      if (!result?.ok) throw new Error(result?.message || CAD_TEXT.failed);
      await readClaude();
      return result.message;
    }));
    const howtoButton = el('button', { type: 'button', class: 'ap-btn ap-outline', text: '쓰는 법 보기' });
    const howto = el('ol', { class: 'ap-note cad-ai-howto', hidden: true },
      el('li', { text: 'Claude 데스크톱 앱(또는 Claude Code)을 켭니다.' }),
      el('li', { text: '대화창에서 "바른 CAD 도면 읽어 줘", "평면 그려 줘"처럼 말합니다.' }),
      el('li', { text: '처음 붙을 때 CAD 화면에 허락 창이 뜨면 [허락]을 누릅니다.' }));
    howtoButton.addEventListener('click', () => { howtoOpen = !howtoOpen; self.update(); });
    const appBox = el('div', { class: 'cad-ai-box' },
      el('div', { class: 'cad-ai-title' }, el('span', { text: 'Claude 앱으로 쓰기' }), el('span', { class: 'cad-ai-badge', text: '추천 · 구독 그대로' })),
      el('p', { class: 'ap-note', text: '쓰고 계신 Claude(Pro·Max) 구독 그대로, Claude 앱 대화창에서 "평면 그려 줘"라고 하면 바른 CAD 가 그립니다. API 키·추가 요금이 없습니다.' }),
      el('p', { class: 'ap-note cad-ai-k', text: '이 PC 의 Claude' }),
      el('div', { class: 'cad-ai-apps' }, ...appRows.map(r => r.node)),
      el('div', { class: 'ap-actions' }, connect, howtoButton),
      howto,
      el('p', { class: 'ap-note', text: '연결한 뒤 Claude 앱을 한 번 껐다 켜면 바른 CAD 도구가 보입니다.' }));
    // CAD 안 AI 창에서 쓰기(API 키) — 접어 둔다
    const foldState = el('span', { class: 'cad-ai-fold-state' });
    const fold = el('button', { type: 'button', class: 'cad-ai-fold', 'aria-expanded': 'false' }, el('span', { text: 'CAD 안 AI 창에서 쓰기 (API 키 · 쓴 만큼 요금)' }), foldState);
    fold.addEventListener('click', () => { keyOpen = !keyOpen; self.update(); });
    const keyInput = el('input', { type: 'password', class: 'cad-ai-input', autocomplete: 'off', spellcheck: 'false', placeholder: 'sk-ant-… 붙여넣기', 'aria-label': 'Anthropic API 키' });
    const modelSelect = el('select', { class: 'cad-ai-input', 'aria-label': 'Claude 모델' });
    const save = el('button', { type: 'button', class: 'ap-btn ap-accent', text: '키 저장하고 연결 확인' });
    save.addEventListener('click', event => busyRun(save, async () => {
      if (!event.isTrusted) throw new Error('키 저장은 직접 눌러야 합니다.');
      const result = await studio.api('chat', { action: 'claudeSaveKey', key: keyInput.value, model: modelSelect.value });
      keyInput.value = '';
      claudeKey = result;
      return result?.message;
    }));
    const keyPage = el('button', { type: 'button', class: 'ap-btn ap-outline', text: '키 받는 곳 열기' });
    keyPage.addEventListener('click', () => { globalThis.window?.open?.(CLAUDE_KEY_PAGE, '_blank', 'noopener'); });
    const forget = el('button', { type: 'button', class: 'ap-btn ap-outline', text: '키 지우기' });
    forget.addEventListener('click', event => busyRun(forget, async () => {
      if (!event.isTrusted) throw new Error('키 지우기는 직접 눌러야 합니다.');
      claudeKey = await studio.api('chat', { action: 'claudeForgetKey' });
      return claudeKey?.message;
    }));
    modelSelect.addEventListener('change', () => {
      if (!claudeKey?.authenticated) return; // 키를 넣기 전에는 저장할 때 같이 보낸다
      studio.api('chat', { action: 'claudeSetModel', model: modelSelect.value })
        .then(result => { claudeKey = { ...claudeKey, ...result }; notify(); ctx.announce?.(`${result.modelName} 로 바꿨습니다.`); })
        .catch(error => ctx.announce?.(message(error)));
    });
    const keySaved = el('p', { class: 'ap-note cad-ai-saved' });
    const keyNew = el('div', {}, el('p', { class: 'ap-note cad-ai-k', text: 'Anthropic API 키' }), keyInput);
    const keyBody = el('div', { class: 'cad-ai-key', hidden: true },
      keySaved, keyNew,
      el('p', { class: 'ap-note cad-ai-k', text: '모델' }), modelSelect,
      el('div', { class: 'ap-actions' }, save, keyPage, forget),
      el('p', { class: 'ap-note', text: '키는 이 PC 보안 저장소(맥 키체인 · 윈도우 보호 저장소)에만 둡니다. 바른 서버로 보내지 않습니다. 요금은 키 주인의 Anthropic 계정으로 나가고, 바른 코인은 쓰지 않습니다.' }));
    const claude = el('div', { class: 'cad-ai-claude', hidden: true }, appBox, fold, keyBody);
    // Codex 모델·추론 깊이 고르기(사장님 10-26 "아스트라·솔 이런 모델을 선택하게 · 추론도 내가 선택")
    const codexList = el('div', { class: 'cad-ai-models', role: 'radiogroup', 'aria-label': 'Codex 모델' });
    const codexLevels = el('div', { class: 'cad-ai-levels', role: 'radiogroup', 'aria-label': '추론 깊이' });
    const codexNote = el('p', { class: 'ap-note' });
    const choose = async (model, effort) => {
      try {
        codexChoice = await studio.api('chat', { action: 'codexSetChoice', model, effort });
        codexCache = null; self.update(); notify();
        globalThis.window?.dispatchEvent?.(new CustomEvent('cad-ai-choice'));
        ctx.announce?.(`${codexChoice.modelName} · ${EFFORT_LABEL[codexChoice.effort] || codexChoice.effort} 로 바꿨습니다.`);
      } catch (error) { ctx.announce?.(message(error)); }
    };
    let codexKey = '';
    const codex = el('div', { class: 'cad-ai-codex', hidden: true },
      el('p', { class: 'ap-note cad-ai-k', text: 'Codex 모델' }), codexList,
      el('p', { class: 'ap-note cad-ai-k', text: '추론 깊이 (깊을수록 오래 생각하고 느림)' }), codexLevels, codexNote);
    const root = el('div', { class: 'cad-ai-personal' }, el('p', { class: 'ap-note cad-ai-k', text: '쓸 모델을 고르세요' }), choices, codex, claude);
    const self = {
      root,
      update() {
        const provider = personalProvider || 'codex';
        for (const b of choices.children) { const on = b.dataset.provider === provider; b.classList.toggle('ap-on', on); b.setAttribute('aria-checked', String(on)); }
        claude.hidden = provider !== 'claude';
        const codexModels = Array.isArray(codexChoice?.models) ? codexChoice.models : [];
        codex.hidden = provider !== 'codex' || !codexModels.length;
        if (!codex.hidden) {
          const pick = codexModels.find(m => m.id === codexChoice.model) || codexModels[0];
          const key = JSON.stringify([codexModels.map(m => m.id), pick.id, codexChoice.effort]);
          if (key !== codexKey) {
            codexKey = key;
            codexList.replaceChildren(...codexModels.map(m => {
              const b = el('button', { type: 'button', role: 'radio', class: `cad-ai-model${m.id === pick.id ? ' ap-on' : ''}`, 'aria-checked': String(m.id === pick.id), title: m.description || m.name },
                el('b', { text: m.name }), el('small', { text: [codexKind(m.id), m.default ? '기본' : ''].filter(Boolean).join(' · ') }));
              b.addEventListener('click', () => { if (m.id !== pick.id) choose(m.id, codexChoice.effort); });
              return b;
            }));
            codexLevels.replaceChildren(...pick.efforts.map(level => {
              const b = el('button', { type: 'button', role: 'radio', class: `cad-ai-level${level === codexChoice.effort ? ' ap-on' : ''}`, 'aria-checked': String(level === codexChoice.effort), text: EFFORT_LABEL[level] || level });
              b.addEventListener('click', () => { if (level !== codexChoice.effort) choose(pick.id, level); });
              return b;
            }));
            codexNote.textContent = `${pick.name} · ${EFFORT_LABEL[codexChoice.effort] || codexChoice.effort} — 대화와 도면 작업에 같이 씁니다. 요금은 ChatGPT 요금제 안에서(바른 코인 안 씀).`;
          }
        }
        for (const r of appRows) { const s = claudeAppState(claudeMcp, r.app); r.status.dataset.state = s.state; r.status.lastChild.textContent = s.text; }
        howto.hidden = !howtoOpen; howtoButton.textContent = howtoOpen ? '쓰는 법 접기' : '쓰는 법 보기';
        fold.setAttribute('aria-expanded', String(keyOpen)); foldState.textContent = keyOpen ? '접기 ▴' : '펼치기 ▾';
        keyBody.hidden = !keyOpen;
        const keyed = claudeKey?.authenticated === true;
        keySaved.hidden = !keyed; keyNew.hidden = keyed; save.hidden = keyed; forget.hidden = !keyed;
        keySaved.textContent = keyed ? `${claudeKey.modelName || 'Claude'} · Anthropic API 키(…${claudeKey.keyTail || ''}) — CAD 안 AI 창이 이 키로 Claude 를 씁니다.` : '';
        const models = Array.isArray(claudeKey?.models) && claudeKey.models.length ? claudeKey.models : [{ id: 'claude-sonnet-5-5', name: 'Claude Sonnet' }, { id: 'claude-opus-5-5', name: 'Claude Opus' }];
        if (modelSelect.options.length !== models.length) {
          modelSelect.replaceChildren(...models.map(m => el('option', { value: m.id, text: m.id.includes('sonnet') ? `${m.name} (기본 · 빠름)` : `${m.name} (정밀 · 요금 높음)` })));
        }
        if (claudeKey?.model && doc.activeElement !== modelSelect) modelSelect.value = claudeKey.model;
      },
    };
    return self;
  }
  function renderAiDetail(container, ctx = {}) {
    if (aiViewMode(ctx.state) !== 'personal' || !container?.ownerDocument) { container?.replaceChildren?.(); panel = null; return false; }
    if (!panel || panel.root.parentNode !== container) { panel = buildPanel(container.ownerDocument, ctx); container.replaceChildren(panel.root); }
    panel.update();
    if (personalProvider === 'claude' && (!claudeKey || !claudeMcp)) readClaude().then(notify).catch(() => {});
    if ((personalProvider || 'codex') === 'codex' && !codexChoice) readCodexChoice().then(notify).catch(() => {});
    return false; // 기본 '사용 모델'·비용 줄은 그대로 둔다(고른 모델의 실제 상태를 보여 준다)
  }

  return {
    app,
    getState,
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    actions,
    loginProviders: LOGIN_PROVIDERS,
    updateExtensions,
    aiExtensions,
    renderAiDetail,
    /* 미리 제공 | 내 모델. 서버에 남기고 채팅도 그 길로 보낸다(chat_router.py). AI 창은 cad-ai-mode 이벤트로 표시를 바꾼다. */
    async setAiMode(mode) {
      if (!AI_MODES.includes(mode)) throw new Error(CAD_TEXT.aiModeInvalid);
      await studio.api('chat', { action: 'setMode', mode });
      aiMode = mode;
      globalThis.window?.dispatchEvent?.(new CustomEvent('cad-ai-mode', { detail: { mode } }));
    },
    /* 기존 window.barunRenderUpdate(status) 자리: desktop.cjs 'cad:update-status' 이벤트를 받는다. */
    pushUpdateStatus(status) {
      lastUpdate = status && typeof status === 'object' ? status : {};
      if (!app.installedVersion && plainVersion(lastUpdate.current)) app.installedVersion = plainVersion(lastUpdate.current);
      notify();
    },
    dispose() { stopLogin(); stopCodexPoll(); listeners.clear(); },
  };
}

/* ---------------------------------------------------------------- 설치 (app.js installSharedAccount 자리) */

export function installCadAccountWindow({
  studio, doc = globalThis.document, win = globalThis.window, onError = () => {}, sharedBase = SHARED_BASE,
  importRenderer = url => import(url), fetchImpl = win?.fetch ? win.fetch.bind(win) : undefined,
} = {}) {
  const host = doc?.querySelector('header .file-actions');
  if (!host || doc.getElementById('shared-account')) return null;
  // 머리 단추는 기존 그대로(#shared-account, "계정 연결"). design-cases-panel.js가 이 id를 누른다.
  const zone = doc.createElement('div');
  zone.className = 'common-connection-zone';
  zone.setAttribute('aria-label', '계정 연결');
  const button = doc.createElement('button');
  button.id = 'shared-account';
  button.className = 'common-link-button';
  button.type = 'button';
  button.title = '계정 연결 및 업데이트';
  button.setAttribute('aria-haspopup', 'dialog');
  button.setAttribute('aria-expanded', 'false');
  const dot = doc.createElement('span'); dot.className = 'common-account-dot'; dot.setAttribute('aria-hidden', 'true');
  const label = doc.createElement('span'); label.className = 'common-account-label'; label.textContent = '계정 연결';
  button.append(dot, label);
  zone.append(button);
  host.append(zone);
  // 바른문서와 같은 공통 계정 팝오버(머리 단추 바로 아래 작은 창). popover="manual" 빈 div 를 자리로 준다.
  const mount = doc.createElement('div');
  mount.id = 'barun-account-popover';
  mount.setAttribute('popover', 'manual');
  doc.body.append(mount);
  const isOpen = () => { try { return mount.matches(':popover-open'); } catch { return false; } };

  const adapter = createCadAccountAdapter({
    studio, desktop: win?.cadDesktop ?? null,
    iconUrl: new URL(CAD_ICON, doc.baseURI).href,
    isWindowOpen: isOpen,
    // 로그인하면 머리 단추 글자도 바로 바꾼다(점 색만 바뀌어 로그인됐는지 모르겠다는 요청, 10/19).
    onSession: (state, displayName) => {
      button.classList.toggle('connected', state === 'connected'); button.dataset.session = state;
      label.textContent = state === 'connected' ? (displayName || '계정 연결됨') : state === 'authenticating' ? '로그인 중…' : '계정 연결';
      button.title = state === 'connected' ? `${displayName ? displayName + ' · ' : ''}계정 연결됨 · 업데이트` : '계정 연결 및 업데이트';
    },
  });
  const report = error => onError(sanitize(error) ?? '계정 창을 불러오지 못했습니다.');
  const ready = (async () => {
    const version = await readInstalledVersion(fetchImpl);
    if (version) adapter.app.installedVersion = version; // 실행 중인 package.json. 메인 이벤트의 current가 먼저 왔으면 그 값 유지.
    const { createAccountPopover } = await importRenderer(new URL(`${sharedBase}popover.mjs`, doc.baseURI).href);
    return createAccountPopover({ mount, adapter });
  })();
  ready.catch(report);
  const open = async (options = {}) => {
    const view = await ready;
    if (!isOpen()) await view.open(button, { keyboard: false });
    if (options?.expand === 'ai') view.expand?.('ai'); // AI 창 위 모델 표시를 누르면 AI 칸을 펼쳐 연다
    if (options?.checkUpdate === true) { view.expand?.('update'); await adapter.actions['update.check']({ trusted: false, window: view }); await view.refresh(); }
  };
  // 주 헤더 단추는 이 팝오버를 열고 닫는다(작은 로그인 카드 없음).
  button.addEventListener('click', () => { ready.then(view => (isOpen() ? view.close() : open())).catch(report); });
  if (win) {
    win.barunOpenAccountUpdate = open;
    win.barunRenderUpdate = status => adapter.pushUpdateStatus(status);
  }
  adapter.getState().catch(() => {}); // 시작할 때 머리 단추의 연결 표시만 맞춘다.
  return { adapter, button, mount, ready, open };
}
