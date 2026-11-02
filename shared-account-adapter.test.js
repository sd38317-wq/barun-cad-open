// node --test shared-account-adapter.test.js
// 공통 계정 창 패키지(shared/account-window, 중앙 판 복사본) 무결성 + 바른 CAD adapter + 공통 model.mjs 화면 규칙.
// 공통 renderer.mjs는 DOM이 필요하고 jsdom이 없어 여기서 돌리지 않는다(중앙 판의 몫). 화면 값은 model.mjs의 buildView로 검사한다.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import * as CAD from './shared-account-adapter.js';
import { RENDERER_VERSION, CONTRACT_SHA256, ALLOWED_APP_FIELDS, PREDICATES, predicateName, validateContract, normalizeState, buildView, compareVersions } from './shared/account-window/model.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const pkg = path.join(here, 'shared', 'account-window');
const sha = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const readJson = rel => JSON.parse(fs.readFileSync(path.join(pkg, rel), 'utf8'));
const contract = readJson('contract/account-window.json');
const repair = readJson('contract/self-repair.json');
const manifest = readJson('manifest.json');
const APP = { appId: 'barun-cad', displayName: '바른 CAD', officialIconAsset: 'barun-cad-brand.png', installedVersion: '5.0.6' };
const view = (raw, app = APP) => buildView(contract, normalizeState(app, raw));
const SESSION_STATES = ['signed_out', 'authenticating', 'connected', 'expired', 'offline', 'error', 'locally_disconnected'];
function allStrings(value, out = []) {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) value.forEach(v => allStrings(v, out));
  else if (value && typeof value === 'object') Object.values(value).forEach(v => allStrings(v, out));
  return out;
}

/* ------------------------------------------------------------ 공통 패키지 무결성 */

// CAD 수정판만 검사한다. 사용자 금지에 따라 중앙 원본 경로는 조회하지 않는다.
const PINNED_VERSION = '2.1.0-r1+cad.2';
test('CAD package identifies its local patch and upstream version', () => {
  assert.equal(manifest.rendererVersion, PINNED_VERSION);
  assert.equal(manifest.upstreamRendererVersion, '2.1.0-r1');
});

test('CAD patch preserves the pinned upstream contract without reading the central folder', () => {
  assert.deepEqual(manifest.contractSha256, {
    'account-window.json': '2c57536b0b2bd544136b7d376af557718e178f38dea3f3c7acab7a8374543803',
    'self-repair.json': '3596fb06bd3dde624f90b0358f1489abc59ecb033156b96b5354f8d310aefd1f',
    'sso-contract.json': '566d5d6d99935ea50f4c46c70d420c1d2773900c2effa2a043f1a258eaf1ef8f',
  });
});

test('package pins match: manifest, model.mjs, contract files and Kakao symbol', () => {
  assert.equal(manifest.rendererVersion, RENDERER_VERSION);
  for (const [name, hash] of Object.entries(manifest.contractSha256)) {
    assert.equal(sha(path.join(pkg, 'contract', name)), hash, name);
    assert.equal(CONTRACT_SHA256[name], hash, `model.mjs pin ${name}`);
  }
  assert.equal(sha(path.join(pkg, manifest.kakaoSymbol.file)), manifest.kakaoSymbol.sha256);
  const provenance = readJson('shared-assets/PROVENANCE.json');
  for (const [rel, hash] of Object.entries(provenance.files)) assert.equal(sha(path.join(pkg, 'shared-assets', rel)), hash, rel);
  assert.doesNotThrow(() => validateContract(contract));
});

test('CAD app values agree with contract/apps/barun-cad.json and only allowed fields are passed', () => {
  const appJson = readJson('contract/apps/barun-cad.json');
  const adapter = CAD.createCadAccountAdapter({ studio: { api: async () => ({}) }, desktop: null, installedVersion: '5.0.6' });
  assert.deepEqual(Object.keys(adapter.app).sort(), [...ALLOWED_APP_FIELDS].sort());
  assert.equal(adapter.app.appId, appJson.appId);
  assert.equal(adapter.app.displayName, appJson.displayName);
  assert.equal(adapter.app.officialIconAsset, CAD.CAD_ICON);
  assert.ok(fs.existsSync(path.join(here, CAD.CAD_ICON)), 'official icon file exists');
  assert.equal(adapter.app.installedVersion, '5.0.6');
  assert.equal(CAD.REPAIR_UNSUPPORTED, repair.outcomes.unsupported);
});

test('adapter never bundles the shared renderer and never evaluates or logs', () => {
  const source = fs.readFileSync(path.join(here, 'shared-account-adapter.js'), 'utf8');
  assert.doesNotMatch(source, /from\s+['"]\.\/shared\/account-window/, 'renderer.mjs must stay a separate module (it resolves assets from import.meta.url)');
  assert.doesNotMatch(source, /\beval\s*\(|new\s+Function\s*\(|\.innerHTML\b|insertAdjacentHTML|console\.(log|info|debug|warn)/);
  assert.doesNotMatch(source, /refresh_token|access_token|account-token\.bin|Authorization/);
  for (const id of Object.keys(CAD.createCadAccountAdapter({ studio: { api: async () => ({}) } }).actions)) assert.ok(contract.actions.some(action => action.id === id), `action ${id} is a contract action`);
});

/* ------------------------------------------------------------ 공통 화면 규칙(model.mjs)과 CAD 값 */

test('login, account and wallet buttons follow the contract enabledWhen table', () => {
  for (const state of SESSION_STATES) {
    const v = view({ session: { state, displayName: '사용자' }, wallet: { state: 'ready', balance: 5 } });
    assert.equal(v.enabled['auth.login'], ['signed_out', 'expired', 'locally_disconnected'].includes(state), `login ${state}`);
    for (const id of ['auth.logoutApp', 'account.manage', 'wallet.openTopup', 'wallet.openHistory']) assert.equal(v.enabled[id], state === 'connected', `${id} ${state}`);
    assert.equal(v.enabled['window.close'], true);
  }
  for (const action of contract.actions) assert.ok(Object.hasOwn(PREDICATES, predicateName(action.enabledWhen)), action.id);
});

test('unknown wallet is never shown as zero', () => {
  const unknown = contract.sections[1].right.unknownValue;
  for (const raw of [{}, { session: { state: 'signed_out' }, wallet: { state: 'ready', balance: 0 } }, { session: { state: 'connected' }, wallet: { state: 'unknown', balance: 0 } }, { session: { state: 'connected' }, wallet: { state: 'ready', balance: null } }, { session: { state: 'connected' }, wallet: { state: 'error', balance: 0 } }]) {
    const account = view(raw).account;
    assert.equal(account.walletKnown, false, JSON.stringify(raw));
    assert.equal(account.walletValue, unknown);
  }
  const mapped = CAD.mapAccountStatus({ connected: false, state: 'disconnected', coin_balance: 0 });
  assert.deepEqual(mapped.wallet, { state: 'unknown', balance: null });
  assert.equal(CAD.mapAccountStatus({ connected: true, state: 'linked', coin_balance: null }).wallet.state, 'error');
  const zero = view({ session: { state: 'connected' }, wallet: { state: 'ready', balance: 0 } }).account;
  assert.deepEqual([zero.walletKnown, zero.walletValue], [true, '0']);
});

test('CAD AI: 미리 제공 model never guessed; 내 모델 is the user own Codex account', () => {
  const connected = view({ ai: CAD.mapAi('connected') }).ai;
  assert.equal(connected.model, contract.sections[2].unknownModel);
  assert.equal(connected.modelKnown, false);
  assert.equal(connected.statusState, 'connected');
  assert.match(connected.caption, /제공: 미리/);
  assert.deepEqual(connected.modes.map(mode => [mode.id, mode.active]), [['managed', true], ['personal', false]]);
  const unknown = view({ ai: CAD.mapAi(null) }).ai;
  assert.deepEqual([unknown.statusState, unknown.showTest], ['unconfigured', false]);
  const offline = view({ ai: CAD.mapAi('offline') }).ai;
  assert.deepEqual([offline.statusState, offline.showTest], ['offline', true]);
  const personal = CAD.mapAi('connected').modes.personal;
  assert.deepEqual(personal, { state: 'unconfigured', configured: false });
  // 내 모델: 사용자 본인 ChatGPT 계정의 Codex. 고른 방식이 채팅이 실제로 쓰는 길(activeMode)이다.
  const codex = CAD.mapCodex({ connected: true, authenticated: true, plan: 'plus' });
  assert.deepEqual([codex.state, codex.configured, codex.billingSource], ['connected', true, 'ChatGPT plus 요금제 (사용자 본인 계정)']);
  assert.deepEqual(CAD.mapCodex({ connected: true, authenticated: false }), { state: 'unconfigured', configured: false, providerDisplayName: 'OpenAI Codex (ChatGPT 계정)', actualModelId: null, selectedModelId: null, billingSource: null });
  const mine = view({ ai: CAD.mapAi('connected', codex, 'personal') }).ai;
  assert.deepEqual(mine.modes.map(mode => [mode.id, mode.active]), [['managed', false], ['personal', true]]);
  assert.match(mine.caption, /OpenAI Codex/);
  assert.equal(CAD.mapAi('connected', codex, 'bogus').activeMode, 'managed');
  const loginView = normalizeState(APP, { ai: CAD.mapAi('connected', null, 'personal') });
  assert.deepEqual([CAD.showCodexLogin(loginView), CAD.showCodexLogout(loginView)], [true, false]);
  const logoutView = normalizeState(APP, { ai: CAD.mapAi('connected', codex, 'personal') });
  assert.deepEqual([CAD.showCodexLogin(logoutView), CAD.showCodexLogout(logoutView)], [false, true]);
  const managedView = normalizeState(APP, { ai: CAD.mapAi('connected', codex, 'managed') });
  assert.deepEqual([CAD.showCodexLogin(managedView), CAD.showCodexLogout(managedView)], [false, false]);
});

test('download is offered only for a verified newer version', () => {
  const at = (nextVersion, extra = {}) => view({ update: { state: 'available', verified: true, nextVersion, phase: null, ...extra } }).update;
  assert.equal(at('5.0.7').showDownload, true);
  for (const version of ['5.0.6', '5.0.5', '5.0.7-beta.1', 'latest']) assert.equal(at(version).showDownload, false, version);
  assert.equal(at('5.0.7', { verified: false }).showDownload, false);
  assert.equal(at('5.0.7', { phase: 'downloading' }).showDownload, false);
  assert.equal(view({ update: { state: 'available', verified: true, nextVersion: '5.0.7' } }, { ...APP, installedVersion: null }).update.showDownload, false);
  assert.equal(compareVersions('5.0.10', '5.0.9'), 1);
  for (const [a, b] of [['5.0.7', '5.0.6'], ['5.0.6', '5.0.6'], ['5.0.5', '5.0.6'], ['5.0.10', '5.0.9'], ['x', '5.0.6']]) assert.equal(CAD.compareVersions(a, b), compareVersions(a, b), `${a} vs ${b}`);
});

test('every state combination renders contract labels and no placeholder text', () => {
  const labels = Object.fromEntries(contract.actions.map(action => [action.id, action]));
  for (const session of SESSION_STATES) for (const wallet of ['unknown', 'loading', 'ready', 'error']) for (const ai of [null, 'checking', 'connected', 'offline', 'error']) for (const update of [{ state: 'idle' }, { state: 'checking' }, { state: 'current' }, { state: 'downloading', version: '5.0.7', current: '5.0.6', percent: 40, total: 10 }, { state: 'ready', version: '5.0.7', current: '5.0.6' }, { state: 'error' }, { state: 'skip', message: '이 분리 설치판은 자동업데이트를 사용하지 않습니다.' }]) {
    const v = view({ session: { state: session, displayName: '아주 긴 이름 '.repeat(10) }, wallet: { state: wallet, balance: wallet === 'ready' ? 10 : null }, ai: CAD.mapAi(ai), update: CAD.mapUpdateStatus(update, '5.0.6') });
    assert.equal(v.header.title, contract.sections[0].title);
    assert.equal(v.header.brand, '바른 CAD');
    assert.equal(v.update.title, '바른 CAD 업데이트');
    for (const [id, label] of Object.entries(v.labels)) assert.equal(label, labels[id].label);
    for (const [id, style] of Object.entries(v.styles)) assert.equal(style, labels[id].style);
    for (const text of allStrings(v)) assert.doesNotMatch(text, /\bundefined\b|\bnull\b|NaN|\[object/, text);
    if (session !== 'connected') assert.equal(v.account.walletKnown, false);
  }
});

/* ------------------------------------------------------------ CAD 변환 */

test('account status mapping', () => {
  const now = 1_000_000;
  const linked = CAD.mapAccountStatus({ connected: true, state: 'linked', display_name: '카카오 사용자', coin_balance: 300, miri_connected: true }, { now });
  assert.deepEqual(linked.session, { state: 'connected', displayName: '카카오 사용자' });
  assert.deepEqual(linked.wallet, { state: 'ready', balance: 300 });
  assert.equal(linked.miriConnected, true);
  assert.equal(CAD.mapAccountStatus({ state: 'disconnected' }).session.state, 'signed_out');
  assert.equal(CAD.mapAccountStatus({ state: 'disconnected' }, { expired: true }).session.state, 'expired');
  assert.equal(CAD.mapAccountStatus({ state: 'waiting' }, { loginPending: { since: now - 1000, limitMs: 600_000 }, now }).session.state, 'authenticating');
  assert.equal(CAD.mapAccountStatus({ state: 'waiting' }, { loginPending: { since: now - 700_000, limitMs: 600_000 }, now }).session.state, 'signed_out');
  assert.equal(CAD.mapAccountStatus({ state: 'waiting' }, { now }).session.state, 'signed_out', 'stale waiting link without a local login click');
  assert.equal(CAD.mapAccountStatus({ state: 'blocked' }).session.state, 'error');
  assert.equal(CAD.classifyAccountError(new Error('카카오 계정 연결이 만료됐습니다. 다시 로그인해 주세요.')), 'expired');
  assert.equal(CAD.classifyAccountError(new Error('미리보다 계정 서버에 연결하지 못했습니다.')), 'offline');
  assert.equal(CAD.classifyAccountError(new TypeError('Failed to fetch')), 'error', 'local engine failure is not internet offline');
});

test('update status mapping re-checks versions and separates download from install', () => {
  const m = status => CAD.mapUpdateStatus(status, '5.0.6');
  assert.equal(m({ state: 'current', version: '5.0.6' }).state, 'up_to_date');
  const downloading = m({ state: 'downloading', version: '5.0.7', current: '5.0.6', percent: 30, total: 100, notes: '[개선] 첫 줄\n[수정] 둘째 줄' });
  assert.deepEqual([downloading.state, downloading.phase, downloading.verified, downloading.nextVersion, downloading.percent], ['available', 'downloading', true, '5.0.7', 30]);
  assert.deepEqual(downloading.releaseNotes, ['[개선] 첫 줄', '[수정] 둘째 줄']);
  assert.equal(m({ state: 'downloading', version: '5.0.5', current: '5.0.6' }).state, 'up_to_date', 'main compares strings; an older server version is never offered');
  assert.equal(m({ state: 'downloading', version: '5.0.7' }).percent, null, 'no total → indeterminate');
  const ready = m({ state: 'ready', version: '5.0.7', current: '5.0.6' });
  assert.deepEqual([ready.state, ready.phase], ['available', 'downloaded']);
  assert.match(view({ update: ready }).update.text, /받기를 마쳤습니다/);
  assert.equal(CAD.mapUpdateStatus({ state: 'downloading', version: '5.0.7' }, null).state, 'idle', 'unknown installed version → no claim');
  const skip = m({ state: 'skip', message: '이 분리 설치판은 자동업데이트를 사용하지 않습니다.' });
  assert.deepEqual([skip.state, skip.message], ['idle', '이 분리 설치판은 자동업데이트를 사용하지 않습니다.']);
  assert.equal(view({ update: skip }).update.text, '이 분리 설치판은 자동업데이트를 사용하지 않습니다.');
  assert.equal(m({ state: 'error', message: 'token=abcdefabcdefabcdefabcdefabcdefabcdef 실패' }).message.includes('abcdef'), false);
});

/* ------------------------------------------------------------ adapter 동작 */

function fakeStudio(responses) {
  const calls = [];
  return {
    calls,
    api: async (route, data) => {
      calls.push([route, { ...data }]);
      const answer = responses[`${route}:${data.action}`];
      const value = typeof answer === 'function' ? answer(data) : answer;
      if (value instanceof Error) throw value;
      if (value === undefined) throw new Error('지원하지 않는 계정 작업입니다.');
      return value;
    },
  };
}
function fakeTimers() {
  const timers = new Map(); let seq = 0;
  return { timers, setInterval: (fn, ms) => { timers.set(++seq, { fn, ms }); return seq; }, clearInterval: id => timers.delete(id), tick() { for (const timer of [...timers.values()]) timer.fn(); } };
}

test('getState reads the existing account API and forwards no tokens', async () => {
  const studio = fakeStudio({ 'account:status': { connected: true, state: 'linked', display_name: '홍길동', coin_balance: 50, packs: ['p'], miri_connected: false, token: 'SECRET-SHOULD-NOT-PASS', authorize_url: 'https://x' } });
  const sessions = [];
  const adapter = CAD.createCadAccountAdapter({ studio, desktop: null, installedVersion: '5.0.6', onSession: s => sessions.push(s) });
  const state = await adapter.getState();
  assert.deepEqual(studio.calls, [['account', { action: 'status' }], ['chat', { action: 'mode' }], ['chat', { action: 'codexStatus' }]]); // 내 모델(Codex|Claude)을 먼저 읽는다(10-26)
  assert.doesNotMatch(JSON.stringify(state), /SECRET|authorize_url|packs/);
  assert.deepEqual(sessions, ['connected'], 'header button follows the session');
  assert.equal(state.ai.modes.managed.state, 'offline');
  const v = view(state);
  assert.deepEqual([v.account.name, v.account.walletValue], ['홍길동', '50']);
});

test('account lookups are cached briefly so update progress does not hammer the account server', async () => {
  let clock = 0;
  const studio = fakeStudio({ 'account:status': { state: 'disconnected' }, 'chat:status': { authenticated: true } });
  const adapter = CAD.createCadAccountAdapter({ studio, desktop: null, now: () => clock });
  await adapter.getState(); await adapter.getState();
  assert.equal(studio.calls.filter(([route, data]) => route === 'account' && data.action === 'status').length, 1);
  clock = CAD.ACCOUNT_CACHE_MS + 1;
  await adapter.getState();
  assert.equal(studio.calls.filter(([route, data]) => route === 'account' && data.action === 'status').length, 2);
});

test('login needs a trusted click, polls while waiting and stops when linked', async () => {
  let clock = 0, status = { state: 'disconnected' }, open = false;
  const studio = fakeStudio({ 'account:status': () => status, 'account:login': { state: 'waiting', expires_in: 600 }, 'chat:status': { authenticated: true } });
  const timers = fakeTimers();
  const adapter = CAD.createCadAccountAdapter({ studio, desktop: null, now: () => clock, timers, isWindowOpen: () => open });
  let notified = 0;
  adapter.subscribe(() => notified++);
  await assert.rejects(adapter.actions['auth.login']({ trusted: false }), /직접 눌러야/);
  await assert.rejects(adapter.actions['auth.login']({}), /직접 눌러야/);
  assert.equal(studio.calls.length, 0);
  assert.equal(await adapter.actions['auth.login']({ trusted: true }), CAD.CAD_TEXT.loginStarted);
  assert.deepEqual(studio.calls.at(-1), ['account', { action: 'login' }]);
  assert.equal([...timers.timers.values()][0].ms, CAD.LOGIN_POLL_MS);
  status = { state: 'waiting' };
  clock = 5_000;
  assert.equal((await adapter.getState()).session.state, 'authenticating');
  open = true; timers.tick();
  assert.equal(notified, 1, 'open window is asked to refresh');
  status = { state: 'linked', connected: true, display_name: '홍', coin_balance: 1 };
  clock = 10_000;
  assert.equal((await adapter.getState()).session.state, 'connected');
  assert.equal(timers.timers.size, 0, 'polling stops once linked');
  await adapter.actions['auth.login']({ trusted: true });
  status = { state: 'waiting' };
  clock = 700_000;
  assert.equal((await adapter.getState()).session.state, 'signed_out', 'approval window over');
  assert.equal(timers.timers.size, 0);
});

test('expired stays until the user logs in; logout and account pages call the existing API', async () => {
  let clock = 0, status = new Error('카카오 계정 연결이 만료됐습니다. 다시 로그인해 주세요.');
  const studio = fakeStudio({ 'account:status': () => status, 'account:logout': { state: 'disconnected' }, 'account:open': { opened: true }, 'account:login': { state: 'waiting' }, 'chat:status': { authenticated: false } });
  const adapter = CAD.createCadAccountAdapter({ studio, desktop: null, now: () => clock, timers: fakeTimers() });
  const expired = await adapter.getState();
  assert.equal(expired.session.state, 'expired');
  assert.equal(expired.ai.modes.managed.state, 'offline', 'AI is probed separately when the account call fails');
  status = { state: 'disconnected' }; clock += CAD.ACCOUNT_CACHE_MS + 1;
  assert.equal((await adapter.getState()).session.state, 'expired');
  await adapter.actions['auth.login']({ trusted: true });
  clock += 1;
  assert.equal((await adapter.getState()).session.state, 'signed_out');
  for (const [id, page] of Object.entries(CAD.ACCOUNT_PAGES)) {
    assert.equal(await adapter.actions[id]({}), CAD.CAD_TEXT.pageOpened);
    assert.deepEqual(studio.calls.at(-1), ['account', { action: 'open', page }]);
  }
  assert.equal(await adapter.actions['auth.logoutApp']({}), CAD.CAD_TEXT.loggedOut);
  assert.deepEqual(studio.calls.at(-1), ['account', { action: 'logout' }]);
  status = new Error('미리보다 계정 서버에 연결하지 못했습니다.'); clock += CAD.ACCOUNT_CACHE_MS + 1;
  assert.equal((await adapter.getState()).session.state, 'offline');
  const failing = CAD.createCadAccountAdapter({ studio: fakeStudio({ 'account:open': new Error('계정 메뉴가 올바르지 않습니다. C:\\Users\\me\\x') }), desktop: null });
  await assert.rejects(failing.actions['wallet.openTopup']({}), error => !/me\\/.test(error.message));
});

test('missing CAD features stay honest', async () => {
  const studio = fakeStudio({ 'account:status': { state: 'disconnected' }, 'chat:status': new Error('미리와 연결하지 못했습니다.') });
  const adapter = CAD.createCadAccountAdapter({ studio, desktop: null });
  assert.equal(adapter.actions['ai.openSettings'], undefined, 'no AI settings screen in CAD; the shared renderer disables the button');
  assert.deepEqual(adapter.updateExtensions, [], 'no desktop bridge → no install extension');
  let patched = null;
  assert.equal(await adapter.actions['repair.diagnose']({ window: { setState: value => { patched = value; } } }), repair.outcomes.unsupported);
  assert.deepEqual(patched, { repair: { state: 'blocked', summary: repair.outcomes.unsupported } });
  assert.equal(view({ repair: patched.repair }).footer.description, repair.outcomes.unsupported);
  assert.equal(PREDICATES.notRepairing(normalizeState(APP, { repair: patched.repair })), true);
  await assert.rejects(adapter.actions['ai.testConnection']({ viewMode: 'managed' }), /미리와 연결되지 않았습니다/);
  await assert.rejects(adapter.actions['ai.testConnection']({ viewMode: 'personal' }), /Codex에 로그인되어 있지 않습니다/);
  assert.equal(await adapter.actions['update.check']({}), CAD.CAD_TEXT.updateNoDesktop);
  const state = await adapter.getState();
  assert.equal(state.update.state, 'error');
  assert.equal(view(state).update.text, CAD.CAD_TEXT.updateNoDesktop);
  assert.equal(state.ai.modes.managed.state, 'error');
});

test('update check, barunRenderUpdate stream and the install-on-close extension', async () => {
  let checks = 0, applied = 0;
  const desktop = { checkUpdate: async () => { checks++; return { state: 'downloading', version: '5.0.7', current: '5.0.6' }; }, applyUpdate: async () => { applied++; return { ok: true }; } };
  const adapter = CAD.createCadAccountAdapter({ studio: fakeStudio({ 'account:status': { state: 'disconnected' }, 'chat:status': { authenticated: true } }), desktop, installedVersion: '5.0.6' });
  let notified = 0;
  const off = adapter.subscribe(() => notified++);
  assert.equal(await adapter.actions['update.check']({}), null);
  assert.equal(notified, 1, 'checking state is pushed before the result');
  assert.equal((await adapter.getState()).update.phase, 'downloading');
  await adapter.actions['update.download']({});
  assert.equal(checks, 1, 'download already running; no second request');
  adapter.pushUpdateStatus({ state: 'downloading', version: '5.0.7', current: '5.0.6', percent: 50, transferred: 5, total: 10 });
  assert.equal((await adapter.getState()).update.percent, 50);
  const [install] = adapter.updateExtensions;
  let state = normalizeState(APP, await adapter.getState());
  assert.equal(install.visible(state), false, 'install is not offered before the download finished');
  adapter.pushUpdateStatus({ state: 'ready', version: '5.0.7', current: '5.0.6' });
  state = normalizeState(APP, await adapter.getState());
  assert.deepEqual([install.visible(state), install.enabled(state), install.label], [true, true, '업데이트 적용']);
  assert.equal(await install.run({ trusted: false }), CAD.CAD_TEXT.installNeedsClick);
  assert.equal(applied, 0);
  assert.equal(await install.run({ trusted: true }), CAD.CAD_TEXT.installStarted);
  assert.equal(applied, 1);
  off();
  adapter.pushUpdateStatus({ state: 'checking' });
  assert.equal(notified, 3, 'unsubscribed listener gets nothing more');
});

test('내 모델: Codex login needs a trusted click, polls until linked; mode is saved on the server', async () => {
  let authenticated = false;
  const studio = fakeStudio({
    'account:status': { state: 'disconnected' }, 'chat:status': { authenticated: true },
    'chat:codexStatus': () => ({ connected: true, authenticated, plan: 'pro' }), 'chat:codexLogin': { opened: true }, 'chat:codexLogout': { loggedOut: true },
    'chat:mode': { mode: 'managed' }, 'chat:setMode': data => ({ mode: data.mode }),
  });
  const timers = fakeTimers();
  const adapter = CAD.createCadAccountAdapter({ studio, desktop: null, timers });
  const [login, logout] = adapter.aiExtensions;
  await assert.rejects(login.run({ trusted: false }), /직접 눌러야/);
  assert.equal(await login.run({ trusted: true }), CAD.CAD_TEXT.codexLoginStarted);
  assert.equal(timers.timers.size, 1, 'polls while the browser login is open');
  authenticated = true;
  timers.tick();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(timers.timers.size, 0, 'stops polling once linked');
  assert.equal(await adapter.actions['ai.testConnection']({ viewMode: 'personal' }), CAD.CAD_TEXT.codexConnected);
  await assert.rejects(adapter.setAiMode('other'), /AI 방식이 올바르지 않습니다/);
  await adapter.setAiMode('personal');
  assert.deepEqual(studio.calls.filter(([, d]) => d.action === 'setMode'), [['chat', { action: 'setMode', mode: 'personal' }]]);
  const state = await adapter.getState();
  assert.deepEqual([state.ai.activeMode, state.ai.modes.personal.state], ['personal', 'connected']);
  await assert.rejects(logout.run({ trusted: false }), /직접 눌러야/);
  assert.equal(await logout.run({ trusted: true }), CAD.CAD_TEXT.codexLoggedOut);
  adapter.dispose();
});

test('Codex missing on this PC leaves the account window usable', async () => {
  const studio = fakeStudio({ 'account:status': { state: 'disconnected' }, 'chat:status': { authenticated: false }, 'chat:codexStatus': new Error('이 PC에서 Codex를 찾지 못했습니다.'), 'chat:mode': { mode: 'personal' } });
  const state = await CAD.createCadAccountAdapter({ studio, desktop: null }).getState();
  assert.deepEqual([state.ai.activeMode, state.ai.modes.personal], ['personal', { state: 'unconfigured', configured: false }]);
});

test('처음 사용자: [Claude에 연결]·[Codex에 연결]은 직접 누를 때만 MCP 설정을 넣고 결과 문장을 보여 준다', async () => {
  const studio = fakeStudio({
    'chat:mcpRegister': data => data.client === 'codex'
      ? { ok: true, message: 'Codex에 바른 CAD 를 연결했습니다.' }
      : { ok: false, message: '이 PC에서 Claude(데스크톱 앱 또는 Claude Code)를 찾지 못했습니다.' },
  });
  const adapter = CAD.createCadAccountAdapter({ studio, desktop: null, timers: fakeTimers() });
  const buttons = Object.fromEntries(adapter.aiExtensions.filter(b => b.id.startsWith('ai.mcpRegister.')).map(b => [b.id, b]));
  assert.deepEqual(Object.keys(buttons), ['ai.mcpRegister.claude', 'ai.mcpRegister.codex']);
  assert.ok(buttons['ai.mcpRegister.codex'].visible({}));
  await assert.rejects(buttons['ai.mcpRegister.codex'].run({ trusted: false }), /직접 눌러야/);
  assert.equal(studio.calls.length, 0, 'untrusted click writes nothing');
  assert.equal(await buttons['ai.mcpRegister.codex'].run({ trusted: true }), 'Codex에 바른 CAD 를 연결했습니다.');
  await assert.rejects(buttons['ai.mcpRegister.claude'].run({ trusted: true }), /찾지 못했습니다/);
  assert.deepEqual(studio.calls.map(([, d]) => d), [{ action: 'mcpRegister', client: 'codex' }, { action: 'mcpRegister', client: 'claude' }]);
  adapter.dispose();
});

test('바깥 AI 허락 목록: [허락한 AI 관리]는 직접 누를 때만 연다', async () => {
  const studio = fakeStudio({});
  const adapter = CAD.createCadAccountAdapter({ studio, desktop: null, timers: fakeTimers() });
  const manage = adapter.aiExtensions.find(b => b.id === 'ai.consentManage');
  assert.equal(manage.label, '허락한 AI 관리');
  await assert.rejects(manage.run({ trusted: false }), /직접 눌러야/);
  assert.equal(studio.calls.length, 0);
  adapter.dispose();
});

/* ------------------------------------------------------------ 설치(가짜 DOM) */

function fakeDocument() {
  const byId = new Map();
  const make = tag => {
    const node = {
      tagName: tag.toUpperCase(), children: [], attributes: {}, dataset: {}, listeners: {}, className: '', textContent: '', open: false, _id: '', popoverOpen: false,
      matches(selector) { return selector === ':popover-open' && this.popoverOpen; },
      get id() { return this._id; }, set id(value) { this._id = value; byId.set(value, this); },
      classList: { set: new Set(), toggle(name, on) { on ? this.set.add(name) : this.set.delete(name); }, contains(name) { return this.set.has(name); } },
      append(...nodes) { this.children.push(...nodes); },
      setAttribute(key, value) { this.attributes[key] = String(value); },
      addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); },
      click() { (this.listeners.click || []).forEach(fn => fn({ isTrusted: false })); },
    };
    return node;
  };
  const header = make('div');
  const body = make('body');
  return { baseURI: 'http://127.0.0.1:18765/', body, header, createElement: make, getElementById: id => byId.get(id) ?? null, querySelector: selector => (selector === 'header .file-actions' ? header : null) };
}

test('installCadAccountWindow keeps #shared-account, the global entry points and the shared popover module', async () => {
  const doc = fakeDocument();
  let checks = 0;
  const desktop = { checkUpdate: async () => { checks++; return { state: 'current', version: '5.0.6', current: '5.0.6' }; }, applyUpdate: async () => ({ ok: true }) };
  const win = { cadDesktop: desktop };
  const imported = [], opened = [];
  let createdWith = null;
  const importRenderer = async url => {
    imported.push(url);
    return { createAccountPopover: async ({ mount, adapter }) => { createdWith = { mount, adapter }; return { open: async from => { opened.push(from); mount.popoverOpen = true; }, close: () => { mount.popoverOpen = false; }, expand: () => {}, refresh: async () => {} }; } };
  };
  const studio = fakeStudio({ 'account:status': { connected: true, state: 'linked', display_name: '홍', coin_balance: 3, miri_connected: true } });
  const fetchImpl = async url => ({ ok: url === 'package.json', json: async () => ({ version: '5.0.6' }) });
  const installed = CAD.installCadAccountWindow({ studio, doc, win, importRenderer, fetchImpl });
  const button = doc.getElementById('shared-account');
  assert.ok(button, 'header button keeps id shared-account (design-cases-panel.js clicks it)');
  assert.equal(button.className, 'common-link-button');
  const mount = doc.getElementById('barun-account-popover');
  assert.deepEqual([mount.tagName, mount.attributes.popover], ['DIV', 'manual'], 'same popover as 바른문서 (popover="manual" mount)');
  assert.equal(doc.getElementById('shared-account-dialog'), null, 'old dialog id is not reused');
  assert.equal(typeof win.barunOpenAccountUpdate, 'function');
  assert.equal(typeof win.barunRenderUpdate, 'function');
  await installed.ready;
  assert.deepEqual(imported, ['http://127.0.0.1:18765/shared/account-window/popover.mjs']);
  assert.equal(createdWith.adapter.app.installedVersion, '5.0.6', 'installed version comes from the running package.json');
  assert.equal(createdWith.adapter.app.officialIconAsset, 'http://127.0.0.1:18765/barun-cad-brand.png');
  button.click();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.deepEqual(opened, [button], 'header click opens the shared popover');
  button.click();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(mount.popoverOpen, false, 'second click closes it');
  await win.barunOpenAccountUpdate({ checkUpdate: true });
  assert.equal(checks, 1, 'barunOpenAccountUpdate({checkUpdate:true}) still checks for updates');
  let pushed = 0;
  createdWith.adapter.subscribe(() => pushed++);
  win.barunRenderUpdate({ state: 'downloading', version: '5.0.7', current: '5.0.6' });
  assert.equal(pushed, 1);
  assert.equal((await createdWith.adapter.getState()).update.phase, 'downloading');
  assert.equal(button.classList.contains('connected'), true);
  assert.equal(CAD.installCadAccountWindow({ studio, doc, win, importRenderer, fetchImpl }), null, 'installs once');
  createdWith.adapter.dispose();
});

test('logout immediately enables login and rejects stale in-flight account status', async () => {
  let resolveStatus;
  const oldStatus = new Promise(resolve => { resolveStatus = resolve; });
  let requests = 0;
  const studio = fakeStudio({
    'account:status': () => { requests++; return oldStatus; },
    'account:logout': { state: 'disconnected' },
    'chat:status': { authenticated: false }, 'chat:codexStatus': {}, 'chat:mode': { mode: 'managed' },
  });
  const adapter = CAD.createCadAccountAdapter({ studio, now: () => 0 });
  const pending = adapter.getState();
  await adapter.actions['auth.logoutApp']({});
  const loggedOut = await adapter.getState();
  assert.equal(loggedOut.session.state, 'signed_out');
  assert.equal(view(loggedOut).enabled['auth.login'], true);
  resolveStatus({ state: 'blocked' });
  assert.equal((await pending).session.state, 'signed_out');
  assert.equal((await adapter.getState()).session.state, 'signed_out');
  assert.equal(requests, 1, 'logout response is used immediately without waiting for another network lookup');
  adapter.dispose();
});

test('logout wins over an older getState stalled by the optional AI probe', async () => {
  let releaseProbe, probes = 0;
  const delayed = new Promise(resolve => { releaseProbe = resolve; });
  const studio = fakeStudio({
    'account:status': { state: 'linked', connected: true },
    'account:logout': { state: 'disconnected' },
    'chat:status': () => { probes++; return delayed; }, 'chat:codexStatus': {}, 'chat:mode': {},
  });
  const sessions = [];
  const adapter = CAD.createCadAccountAdapter({ studio, now: () => 0, onSession: s => sessions.push(s) });
  const pending = adapter.getState();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(probes, 1);
  await adapter.actions['auth.logoutApp']({});
  releaseProbe({ authenticated: false });
  assert.equal((await pending).session.state, 'signed_out');
  assert.ok(sessions.every(s => s === 'signed_out'), 'stale connected result cannot re-enable header');
});

test('Google login uses the same login action and pending poll, without frontend tokens', async () => {
  let status = { state: 'waiting' }, clock = 0;
  const studio = fakeStudio({
    'account:login': { state: 'waiting', expires_in: 600 },
    'account:status': () => status, 'chat:status': { authenticated: false },
  });
  const timers = fakeTimers();
  const adapter = CAD.createCadAccountAdapter({ studio, timers, now: () => clock });
  assert.deepEqual(adapter.loginProviders.map(p => [p.id, p.label, p.supported]), [
    ['kakao', '카카오 로그인', true], ['google', 'Google 로그인', true],
  ]);
  await assert.rejects(adapter.actions['auth.login']({ trusted: false, provider: 'google' }), /직접 눌러야/);
  await assert.rejects(adapter.actions['auth.login']({ trusted: true, provider: 'unknown' }), /지원하지/);
  assert.equal(studio.calls.length, 0);
  assert.match(await adapter.actions['auth.login']({ trusted: true, provider: 'google' }), /Google/);
  assert.deepEqual(studio.calls[0], ['account', { action: 'login', provider: 'google' }]);
  assert.equal((await adapter.getState()).session.state, 'authenticating');
  clock += CAD.ACCOUNT_CACHE_MS + 1;
  status = { connected: true, state: 'linked', display_name: '회원', coin_balance: 9 };
  assert.equal((await adapter.getState()).session.state, 'connected');
  assert.equal(timers.timers.size, 0);
  adapter.dispose();
});

test('login availability explains busy, unsupported, network and server states', async () => {
  const { loginAvailability, summarize } = await import('./shared/account-window/popover-model.mjs');
  for (const session of SESSION_STATES) {
    const state = normalizeState(APP, { session: { state: session } });
    const available = loginAvailability(state);
    assert.equal(available.disabled, !view(state).enabled['auth.login'], session);
    assert.equal(!!available.reason, available.disabled, session);
    assert.equal(summarize(view(state), state).header.showLogin, session !== 'connected');
  }
  const state = normalizeState(APP);
  assert.match(loginAvailability(state, { busy: true }).reason, /처리/);
  assert.equal(loginAvailability(state, { supported: false, reason: '준비 중' }).reason, '준비 중');
});

/* ------------------------------------------------------------ 내 모델 > Claude (2026-10-26 시안 docs/mockup-my-model-claude-2026-10-26) */

test('Claude app rows: installed+registered = 연결됨, missing row = 설치 안 됨', () => {
  const rows = [{ app: 'Claude 데스크톱', state: 'ok' }, { app: 'Claude Code', state: 'missing' }];
  assert.deepEqual(CAD.claudeAppState(rows, 'Claude 데스크톱'), { state: 'connected', text: '연결됨' });
  assert.deepEqual(CAD.claudeAppState(rows, 'Claude Code'), { state: 'unconfigured', text: '연결 안 됨' });
  assert.deepEqual(CAD.claudeAppState([], 'Claude Code'), { state: 'unconfigured', text: '설치 안 됨' });
});

test('mapClaude: connected by Claude app (subscription) or API key; key shown only as last 4', () => {
  assert.equal(CAD.mapClaude({ authenticated: false }, []).configured, false);
  const viaApp = CAD.mapClaude({ authenticated: false }, [{ app: 'Claude 데스크톱', state: 'ok' }]);
  assert.equal(viaApp.state, 'connected'); assert.match(viaApp.billingSource, /Claude 구독/);
  const viaKey = CAD.mapClaude({ authenticated: true, keyTail: 'a1B2', modelName: 'Claude Sonnet' }, []);
  assert.equal(viaKey.actualModelId, 'Claude Sonnet'); assert.match(viaKey.billingSource, /…a1B2/);
  assert.equal(view({ ai: { activeMode: 'personal', viewMode: 'personal', modes: { personal: viaKey } } }).ai.status, '연결됨');
});

test('personal=claude: getState asks Claude key + MCP status (not Codex) and hides Codex login buttons', async () => {
  const studio = fakeStudio({ 'account:status': { state: 'disconnected' }, 'chat:status': { authenticated: false },
    'chat:mode': { mode: 'personal', personal: 'claude' },
    'chat:claudeStatus': { authenticated: true, keyTail: 'zz99', model: 'claude-sonnet-5-5', modelName: 'Claude Sonnet' },
    'chat:mcpStatus': { apps: [{ app: 'Claude Code', state: 'ok' }] } });
  const adapter = CAD.createCadAccountAdapter({ studio, desktop: null });
  const state = await adapter.getState();
  assert.ok(!studio.calls.some(([, d]) => d.action === 'codexStatus'), 'Claude 를 고르면 Codex 를 묻지 않는다');
  assert.equal(state.ai.modes.personal.state, 'connected');
  assert.doesNotMatch(JSON.stringify(state), /sk-ant/);
  const s = { ai: { viewMode: 'personal', modes: { personal: { configured: false } } } };
  const ext = id => adapter.aiExtensions.find(x => x.id === id);
  assert.equal(ext('ai.codexLogin').visible(s), false);
  assert.equal(ext('ai.mcpRegister.claude').visible(s), false, 'Claude 칸 안에 같은 단추가 있다');
  assert.equal(typeof adapter.renderAiDetail, 'function');
  assert.equal(adapter.renderAiDetail(null, { state: { ai: { viewMode: 'managed' } } }), false, '미리 제공에서는 아무것도 그리지 않는다');
});

test('내 모델에서는 고른 모델의 연결 단추만 보인다(10-26 "코덱스 연결인데 클로드가 뜨네")', async () => {
  const make = async personal => { const studio = fakeStudio({ 'account:status': { state: 'disconnected' }, 'chat:status': { authenticated: false }, 'chat:mode': { mode: 'personal', personal },
    'chat:codexStatus': { authenticated: true }, 'chat:claudeStatus': { authenticated: false }, 'chat:mcpStatus': { apps: [] } });
    const a = CAD.createCadAccountAdapter({ studio, desktop: null }); await a.getState(); return a; };
  const seen = (a, view) => a.aiExtensions.filter(x => x.id.startsWith('ai.mcpRegister.') && x.visible({ ai: { viewMode: view, modes: { personal: { configured: true } } } })).map(x => x.id);
  const codex = await make('codex'), claude = await make('claude');
  assert.deepEqual(seen(codex, 'personal'), ['ai.mcpRegister.codex']);
  assert.deepEqual(seen(claude, 'personal'), []);
  assert.deepEqual(seen(codex, 'managed'), ['ai.mcpRegister.claude', 'ai.mcpRegister.codex']);
});

test('Codex 모델·추론 깊이: 상태 줄에 고른 모델이 보이고, 고른 값은 저장 요청으로 간다(10-26)', async () => {
  const shown = CAD.mapCodex({ authenticated: true, plan: 'plus', modelName: 'GPT-6-Astra', effort: 'high' });
  assert.equal(shown.actualModelId, 'GPT-6-Astra · 높음');
  assert.equal(CAD.mapCodex({ authenticated: false, modelName: 'GPT-6-Astra', effort: 'high' }).actualModelId, null);
  assert.equal(CAD.EFFORT_LABEL.low, '낮음 · 빠름');
});
