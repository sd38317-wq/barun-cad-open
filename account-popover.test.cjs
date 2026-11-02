// Actual Chromium regression test; headless Chrome/Edge, fake adapter/server only.
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const root = __dirname;

async function browserChecks() {
  const { createAccountPopover } = await import('/shared/account-window/popover.mjs');
  const check = (ok, message) => { if (!ok) throw new Error(message); };
  let raw = { session: { state: 'signed_out' } };
  let delayedRefresh = null, delayedLogin = null;
  const actions = [];
  const adapter = {
    app: { appId: 'barun-cad', displayName: '바른 CAD', installedVersion: '7.0.7' },
    loginProviders: [
      { id: 'kakao', label: '카카오 로그인', style: 'kakao', supported: true },
      { id: 'google', label: 'Google 로그인', style: 'google', supported: true },
    ],
    getState: async () => delayedRefresh ? delayedRefresh : raw,
    actions: {
      'auth.login': async ctx => { actions.push(ctx); if (delayedLogin) await delayedLogin; raw = { session: { state: 'authenticating' } }; return '브라우저에서 로그인을 마쳐 주세요.'; },
      'auth.logoutApp': async () => { raw = { session: { state: 'signed_out' } }; return '이 앱에서 로그아웃했습니다.'; },
    },
  };
  const mount = document.getElementById('barun-account-popover');
  const opener = document.getElementById('opener');
  const pop = await createAccountPopover({ mount, adapter });
  await pop.open(opener);
  await Promise.all([...document.querySelectorAll('link')].map(link => link.sheet ? null : new Promise((resolve, reject) => { link.onload = resolve; link.onerror = reject; })));
  await Promise.all([...mount.querySelectorAll('img')].map(img => img.decode()));
  const kakao = mount.querySelector('[data-aw-provider="kakao"]');
  const google = mount.querySelector('[data-aw-provider="google"]');
  const loginGroup = mount.querySelector('.ap-logins');
  const reason = id => mount.querySelector('#ap-login-reason-' + id);
  check(!kakao.disabled && !google.disabled, 'signed-out login must be enabled');
  check(google.textContent === 'Google 로그인', 'Google label');
  check(google.querySelector('img').naturalWidth > 0, 'Google logo must load');
  // Reproduce the actual color collision, then prove the scoped theme fix removes it.
  const oldTheme = document.createElement('style');
  oldTheme.textContent = ':root[data-theme=dark] :is(header,#top-ribbon) :is(button):not(.aw-dialog):not(.aw-dialog *){color:#d8dce1}';
  document.head.append(oldTheme);
  const legacy = document.createElement('div');
  legacy.className = 'ap';
  legacy.innerHTML = '<header><button class="ap-btn ap-kakao">카카오 로그인</button></header>';
  document.body.append(legacy);
  legacy.querySelector('button').style.transition = 'none';
  check(getComputedStyle(legacy.querySelector('button')).color === 'rgb(216, 220, 225)', 'legacy theme overrides Kakao text even when enabled');
  oldTheme.remove();
  check(getComputedStyle(legacy.querySelector('button')).color === 'rgba(0, 0, 0, 0.85)', 'popover buttons excluded from application header theme');
  legacy.classList.remove('ap');
  check(getComputedStyle(legacy.querySelector('button')).color === 'rgb(216, 220, 225)', 'ordinary header buttons keep application color');
  legacy.remove();
  const rect = node => node.getBoundingClientRect();
  // Render the original single-button header alongside the stack as a geometry reference.
  const readBaseline = () => {
    const reference = mount.cloneNode(true);
    reference.removeAttribute('id');
    reference.querySelectorAll('[id]').forEach(node => node.removeAttribute('id'));
    reference.querySelector('.ap-logins').remove();
    const referenceLogin = kakao.cloneNode(true);
    referenceLogin.hidden = loginGroup.hidden;
    reference.querySelector('.ap-head').append(referenceLogin);
    document.body.append(reference);
    reference.showPopover();
    const value = { width: rect(reference).width, height: rect(reference).height, buttonWidth: rect(reference.querySelector('.ap-kakao')).width, cards: [...reference.querySelectorAll('.ap-group')].map(node => rect(node).top) };
    reference.remove();
    return value;
  };
  let baseline = readBaseline();
  const checkGeometry = name => {
    const k = rect(kakao), g = rect(google);
    check(loginGroup.parentElement === mount.querySelector('.ap-head'), name + ': providers belong in header');
    check(k.height === 32 && g.height === 32 && Math.abs(k.width - baseline.buttonWidth) < 0.01 && k.width === g.width, name + ': original equal button sizes ' + JSON.stringify({k:{w:k.width,h:k.height},g:{w:g.width,h:g.height},baseline}));
    check(k.left === g.left && g.top - k.bottom === 4, name + ': vertical stack');
    check(rect(mount).width === baseline.width && rect(mount).height === baseline.height, name + ': unchanged popover size');
    [...mount.querySelectorAll('.ap-group')].forEach((node, i) => check(rect(node).top === baseline.cards[i], name + ': unchanged card position'));
    check(k.right <= rect(mount.querySelector('.ap-head')).right && k.left > rect(mount.querySelector('.ap-who')).right, name + ': header right edge');
  };
  const colors = [];
  for (const theme of ['dark', 'ivory', 'air']) {
    document.documentElement.dataset.theme = theme === 'air' ? 'dark' : theme;
    document.documentElement.dataset.barunTheme = theme;
    document.body.dataset.view = theme;
    baseline = readBaseline();
    checkGeometry(theme);
    const k = getComputedStyle(kakao), g = getComputedStyle(google);
    check(k.color === 'rgba(0, 0, 0, 0.85)', theme + ': Kakao foreground ' + k.color);
    check(k.backgroundColor === 'rgb(254, 229, 0)', theme + ': Kakao background');
    check(k.opacity === '1', theme + ': Kakao parent opacity');
    check(getComputedStyle(kakao.querySelector('span')).color === k.color, theme + ': actual Kakao label color');
    check(getComputedStyle(google.querySelector('span')).color === g.color, theme + ': actual Google label color');
    check(g.color === 'rgb(31, 31, 31)' && g.backgroundColor === 'rgb(255, 255, 255)', theme + ': Google colors');
    colors.push({ theme, kakao: k.color, google: g.color });
  }
  for (const session of ['offline', 'error', 'authenticating']) {
    pop.setState({ session: { state: session } });
    check(kakao.disabled && google.disabled && !loginGroup.hidden, session + ': visible disabled buttons');
    check(!reason('kakao').hidden && reason('kakao').textContent.length > 0, session + ': accessible reason');
    check(mount.querySelector('.ap-sub').textContent === reason('kakao').textContent, session + ': visible account status reason');
    check(kakao.getAttribute('aria-describedby') === reason('kakao').id, session + ': described button');
    checkGeometry(session);
    const disabled = getComputedStyle(kakao);
    check(disabled.opacity === '1' && disabled.color === 'rgba(0, 0, 0, 0.85)', session + ': readable disabled text');
    check(disabled.backgroundColor === 'rgb(255, 243, 163)', session + ': only background lightens');
    check(getComputedStyle(google).color === 'rgb(31, 31, 31)' && getComputedStyle(google).backgroundColor === 'rgb(255, 255, 255)' && getComputedStyle(google).opacity === '1', session + ': readable disabled Google');
  }
  // Shared package remains honest for a provider whose server flow is unavailable.
  adapter.loginProviders[1].supported = false;
  adapter.loginProviders[1].reason = '준비 중: 서버의 앱 연결 승인이 필요합니다.';
  pop.setState({ session: { state: 'signed_out' } });
  check(!kakao.disabled && google.disabled && reason('google').textContent.startsWith('준비 중'), 'unsupported Google reason');
  checkGeometry('unsupported Google');
  check(mount.querySelector('.ap-sub').textContent === reason('google').textContent, 'unsupported provider explanation in account status');
  google.click();
  check(actions.length === 0, 'unsupported Google sends no login');
  adapter.loginProviders[1].supported = true;
  // busy disables both providers. Success keeps them disabled during a slow refresh.
  let completeLogin, completeRefresh;
  delayedLogin = new Promise(resolve => { completeLogin = resolve; });
  delayedRefresh = new Promise(resolve => { completeRefresh = resolve; });
  pop.setState({ session: { state: 'signed_out' } });
  google.click();
  check(kakao.disabled && google.disabled, 'shared login busy gate');
  check(actions[0].provider === 'google', 'Google provider forwarded to auth.login');
  completeLogin();
  await new Promise(resolve => setTimeout(resolve, 0));
  check(pop.state.session.state === 'authenticating' && kakao.disabled && google.disabled, 'success must not reopen login before refresh');
  completeRefresh(raw);
  delayedRefresh = null;
  await new Promise(resolve => setTimeout(resolve, 0));
  // A logout action must release busy even when its following refresh is delayed.
  raw = { session: { state: 'connected', displayName: '회원' } };
  pop.setState(raw);
  check(loginGroup.hidden && rect(kakao).width === 0 && rect(google).width === 0, 'connected hides provider options');
  check(mount.querySelector('.ap-name').textContent === '회원', 'connected account display');
  const connectedBaseline = readBaseline();
  check(rect(mount).width === connectedBaseline.width && rect(mount).height === connectedBaseline.height, 'connected preserves original account layout');
  delayedRefresh = new Promise(resolve => { completeRefresh = resolve; });
  mount.querySelector('[data-aw-action="auth.logoutApp"]').click();
  await new Promise(resolve => setTimeout(resolve, 0));
  check(!kakao.disabled && !google.disabled, 'logout busy released before slow refresh');
  completeRefresh(raw);
  delayedRefresh = null;
  await new Promise(resolve => setTimeout(resolve, 0));
  check(pop.state.session.state === 'signed_out', 'logout state');
  // Older refresh responses must never overwrite a newer logout refresh.
  let oldResolve;
  delayedRefresh = new Promise(resolve => { oldResolve = resolve; });
  const old = pop.refresh();
  delayedRefresh = null;
  await pop.refresh();
  oldResolve({ session: { state: 'error' } });
  await old;
  check(!kakao.disabled && pop.state.session.state === 'signed_out', 'discard older refresh');
  // Narrow view: provider labels and reasons fit inside the popover.
  document.documentElement.style.width = '320px';
  mount.style.setProperty('--ap-width', '304px');
  check(loginGroup.scrollWidth <= loginGroup.clientWidth, 'provider options overflow');
  check(mount.querySelector('.ap-head').scrollWidth <= mount.querySelector('.ap-head').clientWidth, 'narrow header overflow');
  pop.dispose();
  pop.close();
  return { colors, baseline };
}

async function chromiumChecks(executable) {
  const html = '<!doctype html><html data-theme="dark"><head><meta charset="utf-8">' +
    '<link rel="stylesheet" href="/style.css"><link rel="stylesheet" href="/barun-air.css">' +
    '<link rel="stylesheet" href="/common-account-update.css"><style>.ap[popover],.ap *{animation:none!important;transition:none!important}</style></head><body>' +
    '<button id="opener">계정 연결</button><div id="barun-account-popover"></div>' +
    '<pre id="result">pending</pre><script type="module">(' + browserChecks.toString() + ')().then(result => { document.getElementById("result").textContent = JSON.stringify(result); }).catch(error => { document.getElementById("result").textContent = "FAILED: " + error.message; });</script></body></html>';
  const publicFiles = new Set([
    'style.css', 'barun-air.css', 'common-account-update.css',
    'shared/account-window/popover.mjs', 'shared/account-window/popover-model.mjs',
    'shared/account-window/model.mjs', 'shared/account-window/renderer.mjs',
    'shared/account-window/icons.mjs', 'shared/account-window/account-popover.css',
    'shared/account-window/contract/account-window.json',
    'shared/account-window/shared-assets/kakao-symbol-approved.svg',
    'shared/account-window/shared-assets/google-g.svg',
  ]);
  const server = http.createServer((req, res) => {
    if (req.url === '/') { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(html); return; }
    const file = req.url.slice(1);
    if (!publicFiles.has(file)) { res.writeHead(404); res.end(); return; }
    res.setHeader('Content-Type', file.endsWith('.mjs') ? 'text/javascript' : file.endsWith('.svg') ? 'image/svg+xml' : file.endsWith('.css') ? 'text/css' : 'application/json');
    res.end(fs.readFileSync(path.join(root, file)));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const profile = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'cad-account-ui-'));
  try {
    const run = await new Promise((resolve, reject) => {
      const child = require('node:child_process').spawn(executable, [
        '--headless', '--no-sandbox', '--disable-gpu', '--disable-background-networking',
        '--no-first-run', '--no-default-browser-check', '--user-data-dir=' + profile,
        '--virtual-time-budget=5000', '--dump-dom', 'http://127.0.0.1:' + server.address().port + '/',
      ], { cwd: root, windowsHide: true });
      let stdout = '', stderr = '';
      child.stdout.on('data', data => { stdout += data; });
      child.stderr.on('data', data => { stderr += data; });
      child.on('error', reject);
      const timeout = setTimeout(() => { child.kill(); reject(new Error('Chromium timed out')); }, 30000);
      child.on('close', status => { clearTimeout(timeout); resolve({ status, stdout, stderr }); });
    });
    require('node:assert/strict').equal(run.status, 0, run.stderr);
    const line = run.stdout.split('<pre id="result">')[1]?.split('</pre>')[0];
    require('node:assert/strict').ok(line && line !== 'pending' && !line.startsWith('FAILED:'), line || run.stdout);
    return JSON.parse(line.replace(/&quot;/g, '"').replace(/&amp;/g, '&'));
  } finally {
    await new Promise(resolve => server.close(resolve));
    // Only our uniquely generated temporary profile is removed.
    if (path.dirname(profile) === require('node:os').tmpdir() && path.basename(profile).startsWith('cad-account-ui-')) {
      fs.rmSync(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    }
  }
}
const test = require('node:test');
const assert = require('node:assert/strict');
const executable = [process.env.CAD_TEST_CHROMIUM, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(file => file && fs.existsSync(file));
test('Chromium: compact header stack, provider text colors, disabled reasons and session races', { timeout: 45000, skip: !executable && 'Chrome/Edge not installed; set CAD_TEST_CHROMIUM' }, async () => {
  const result = await chromiumChecks(executable);
  assert.equal(result.baseline.width, 410);
  assert.ok(result.baseline.buttonWidth > 0);
  assert.equal(result.colors.length, 3);
});
