// 바로 그려야 하는 핵심 화면 코드(도면 생성기·상세 규칙·IFC·상세 찾기)를 불러온다.
// 설치판에는 이 코드가 평문으로 없다(rules/screen.pack, 서버 열쇠). 로그인하면 엔진이 메모리에서 풀어
// 계정 표식을 넣어 주고(/api/screen-vault, 화면 토큰 필요), 화면은 blob URL 로 import 한다.
// 개발 실행·노드 시험은 소스를 그대로 import 한다(BARUN_SCREEN_VAULT 는 설치판 빌드에서만 true 로 정의).
export const LOCKED_MESSAGE = '로그인하면 상세·도면 생성을 쓸 수 있어요.';
export const LOCKED_ENTRIES = Object.freeze(['drawing-generator.js', 'drawing-details/registry.js', 'ifc-writer.js', 'detail-search-panel.js', 'auto-plan.js', 'planset-command.js']);
const PLACEHOLDER = /(["'])barun-(vault|plain):([\w./-]+)\1/g;

let source = null;          // Worker 는 화면 스레드에 묶음을 물어본다(setScreenVaultSource)
let modules = null;         // Promise<{이름: blob URL}> — 한 번 만들면 앱이 꺼질 때까지 쓴다
let fetched = null;         // 화면 스레드가 받은 묶음(Worker 를 다시 띄워도 다시 받지 않는다)

/** 로그아웃·이용권 만료(shared-account-adapter.js 가 'barun-protected-locked' 를 알림): 받은 묶음을 버린다.
    다음 import 는 엔진에서 다시 받아야 하고, 엔진도 세션을 버렸으므로 로그인 전까지 잠긴다. Worker 는 명령 실행기가 새로 띄운다. */
export function forgetScreenVault() {
  modules = null;
  fetched = null;
}
globalThis.addEventListener?.('barun-protected-locked', forgetScreenVault);

export function bundled() {
  return typeof BARUN_SCREEN_VAULT !== 'undefined';
}

/** 엔진이 준 묶음({order, files})을 blob URL 로 만든다. 잠근 파일끼리는 blob URL, 나머지 조각은 이 앱 주소로 잇는다. */
export function instantiate({order, files}, {origin = globalThis.location?.origin, makeUrl = code => URL.createObjectURL(new Blob([code], {type: 'text/javascript'}))} = {}) {
  const urls = {};
  for (const name of order) {
    const code = files[name];
    if (typeof code !== 'string') throw Error('잠근 화면 코드가 빠졌습니다: ' + name);
    urls[name] = makeUrl(code.replace(PLACEHOLDER, (_, quote, kind, target) => {
      const url = kind === 'vault' ? urls[target] : origin + '/' + target;
      if (!url) throw Error('잠근 화면 코드 순서가 맞지 않습니다: ' + name + ' → ' + target);
      return quote + url + quote;
    }));
  }
  return urls;
}

async function engineBundle() {
  const status = await (await fetch('/api/status', {cache: 'no-store'})).json();
  const token = status?.token || (status?.tokenPolicy === 'desktop' ? await globalThis.window?.cadDesktop?.engineToken?.() : null);
  const response = await fetch('/api/screen-vault', {method: 'POST', headers: {'Content-Type': 'application/json', 'X-CAD-Token': token || ''}, body: '{}', cache: 'no-store'});
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.state !== 'unlocked') throw Object.assign(Error(data.error || LOCKED_MESSAGE), {code: 'screen_locked'});
  return data;
}

/** 화면 스레드: Worker 가 잠근 코드를 물으면 같은 묶음을 건넨다(각자 자기 blob URL 을 만든다). */
export function screenVaultBundle() {
  if (source) return source();
  const pending = fetched ||= engineBundle();
  pending.catch(() => { if (fetched === pending) fetched = null; });
  return pending;
}

/** Worker 쪽에서 묶음을 받는 길을 정한다(command-worker.js). */
export function setScreenVaultSource(fn) {
  source = fn;
}

export async function lockedImport(name) {
  if (!LOCKED_ENTRIES.includes(name)) throw Error('잠근 화면 코드가 아닙니다: ' + name);
  if (!bundled()) return import(new URL('./' + name, import.meta.url).href);
  const pending = modules ||= screenVaultBundle().then(bundle => instantiate(bundle));
  let urls;
  try {
    urls = await pending;
  } catch (error) {
    if (modules === pending) modules = null;   // 잠겨 있었다: 로그인 뒤 다시 누르면 다시 받는다
    throw error;
  }
  return import(urls[name]);
}
