"""잠근 화면 코드(screen.pack) 실제 브라우저 시험·속도 비교. 진짜 계정 서버·엔진에 나가지 않는다.

설치판과 같은 esbuild 묶음을 두 벌 만든다.
  vault : BARUN_SCREEN_VAULT 정의 + screen_lock 으로 잠근 조각을 빼고 시험 열쇠로 screen.pack 을 만든다.
          /api/screen-vault 는 vault_gate.screen_bundle(가짜 세션 이용권)로 답한다. 처음엔 잠겨 있다.
  plain : 같은 묶음을 잠그지 않고 그대로 낸다(지금 설치판과 같은 길, 비교 기준).
두 벌을 각각 http://127.0.0.1:<port>/ 와 <port+1>/ 로 띄운다. 브라우저로 열면 시험 페이지가
  1) (vault) 로그인 전 lockedImport·상세 생성이 안내 문구로 실패하는지
  2) 로그인 뒤 상세 10종·도면 한 벌을 Worker 에서 몇 번 그려 걸린 시간
을 화면에 JSON 으로 적는다(document.title 이 'done' 이 되면 끝).

사용: python tools/screen_vault_e2e.py [--port 8790]          서버만 띄운다(브라우저로 직접 열기)
      python tools/screen_vault_e2e.py --run 3                   화면 없는 Electron 으로 두 벌을 번갈아 3번씩 재고 끝낸다
"""
import argparse
import functools
import json
import re
import shutil
import subprocess
import sys
import threading
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import screen_lock  # noqa: E402
import vault  # noqa: E402
import vault_gate  # noqa: E402

WORK = ROOT / 'tmp' / 'screen-e2e'
TEST_MASTER = '33' * 32
TOKEN = 'e2e-screen-token'
ENTRIES = ['app.js', 'review-3d.js', 'site-3d.js', 'tablet-input.js', 'lisp-worker.js', 'mcp-lisp.js', 'ai-layer-policy.js',
           'app-ai-tools.js', 'ai-commit.js', 'command-worker.js', 'gpu-compile-worker.js', 'gpu-render-worker.js', *screen_lock.LOCKED_ENTRIES]
EXTERNALS = ['./occt-client.js', './layer-knowledge-data.js', './layer-ranking-data.js', './layer-standards-data.js']

HARNESS = r'''
import {createCommandClient} from '../../../command-runner.js';
import {lockedImport, LOCKED_MESSAGE} from '../../../screen-vault.js';
import {DrawingEngine} from '../../../engine.js';
const out = {variant: location.port === VAULT_PORT ? 'vault' : 'plain'};
const show = () => { document.body.textContent = JSON.stringify(out); };
const ids = ['WALL-001','WINDOW-033','FLOOR-001','ROOF-001','STAIR-01','FIRE-01','PARKING-001','ACCESS-01','INTERIOR-001','STEEL-01'];
try {
  const knowledge = await (await fetch('/drawing-knowledge.json')).json();
  const model = await (await fetch('/fixture/model.json')).json(), base = await (await fetch('/fixture/base.json')).json();
  const client = createCommandClient({url: new URL('/command-worker.js', location.origin)});
  const details = () => client.generate(new DrawingEngine().doc, {...knowledge, kind: 'details', model, ids, standardDetails: {}});
  const set = () => client.generate(new DrawingEngine().doc, {...knowledge, kind: 'set', model: base, standardDetails: {}});
  if (out.variant === 'vault') {
    await fetch('/harness/logout');
    out.before = {};
    try { await lockedImport('drawing-details/registry.js'); out.before.import = 'opened?!'; } catch (e) { out.before.import = e.message === LOCKED_MESSAGE ? 'locked-message' : e.message; }
    try { await details(); out.before.generate = 'opened?!'; } catch (e) { out.before.generate = e.message; }
    await fetch('/harness/login');
  }
  let t = performance.now();
  const registry = await lockedImport('drawing-details/registry.js');
  out.mainImportMs = +(performance.now() - t).toFixed(1);
  out.registryHasAutoSelect = typeof registry.autoSelect === 'function';
  out.details = []; out.set = [];
  for (let i = 0; i < 6; i++) { t = performance.now(); const r = await details(); out.details.push(+(performance.now() - t).toFixed(1)); out.detailEntities = r.document.entities.length; }
  for (let i = 0; i < 5; i++) { t = performance.now(); const r = await set(); out.set.push(+(performance.now() - t).toFixed(1)); out.setEntities = r.document.entities.length; }
  if (out.variant === 'vault') {
    const marks = await (await fetch('/api/screen-vault', {method: 'POST', headers: {'X-CAD-Token': TOKEN}, body: '{}'})).json();
    out.watermarked = Object.values(marks.files).every(code => code.startsWith('/*barun:E2Emark01:'));
    out.blobModules = performance.getEntriesByType('resource').filter(e => e.name.startsWith('blob:')).length;
  }
  out.plainLockedRequests = performance.getEntriesByType('resource').map(e => e.name).filter(n => /drawing-generator|registry|steel-|access-plan-|ifc-writer|detail-search-panel/.test(n) && !n.startsWith('blob:'));
} catch (error) { out.error = String(error?.stack || error); }
show(); document.title = 'done';
'''


def build(variant, port):
    out = WORK / variant
    shutil.rmtree(out, ignore_errors=True)
    src = WORK / 'harness-src'
    src.mkdir(parents=True, exist_ok=True)
    (src / 'harness.js').write_text(HARNESS.replace('VAULT_PORT', json.dumps(str(port))).replace('TOKEN', json.dumps(TOKEN)), encoding='utf-8')
    harness = (src / 'harness.js').relative_to(ROOT).as_posix()
    meta = WORK / f'{variant}-meta.json'
    args = ['node', 'node_modules/esbuild/bin/esbuild', *ENTRIES, harness, '--bundle', '--format=esm', '--splitting', '--platform=browser', '--minify',
            '--legal-comments=none', *(f'--external:{e}' for e in EXTERNALS), f'--metafile={meta.relative_to(ROOT).as_posix()}',
            f'--outdir={out.relative_to(ROOT).as_posix()}']
    if variant == 'vault':
        args.insert(-2, '--define:BARUN_SCREEN_VAULT=true')
    subprocess.run(args, cwd=ROOT, check=True)
    # 설치판 화면과 같은 CSP(script-src 에 blob: 이 없으면 잠근 코드를 못 불러온다)
    csp = re.search(r'<meta http-equiv="Content-Security-Policy"[^>]*>', (ROOT / 'index.html').read_text(encoding='utf-8'))[0]
    (out / 'index.html').write_text(f'<!doctype html><meta charset="utf-8">{csp}<title>run</title><script type="module" src="/{harness[:-3]}.js"></script>', encoding='utf-8')
    if variant != 'vault':
        return None
    result = screen_lock.split(out, meta, ROOT)
    for name in result['files']:
        (out / name).unlink()     # 설치판처럼 평문 조각을 지운다
    pack = WORK / 'screen.pack'
    pack.write_bytes(vault.pack(screen_lock.pack_files(result), vault_gate.derive_screen_key(TEST_MASTER)))
    return pack


def handler(dist, pack):
    class Handler(SimpleHTTPRequestHandler):
        extensions_map = {**SimpleHTTPRequestHandler.extensions_map, '.js': 'text/javascript', '.json': 'application/json'}

        def log_message(self, *args):
            pass

        def send_json(self, body, status=200):
            raw = json.dumps(body).encode("ascii")
            self.send_response(status)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.send_header('Content-Length', str(len(raw)))
            self.end_headers()
            self.wfile.write(raw)

        def do_GET(self):
            if self.path == '/api/status':
                return self.send_json({'token': TOKEN})
            if self.path == '/drawing-knowledge.json':
                return self.send_json({'standard': json.loads(vault_gate.knowledge('drawing-standard.json')), 'assemblies': json.loads(vault_gate.knowledge('drawing-assemblies.json')),
                                       'details': vault_gate.detail_groups(), 'quality': json.loads(vault_gate.knowledge('drawing-quality.json'))})
            if self.path in ('/layer-knowledge-data.js', '/layer-ranking-data.js', '/layer-standards-data.js', '/occt-client.js'):
                raw = (ROOT / self.path[1:]).read_bytes()   # 묶음 밖(external) 모듈: 설치판은 엔진이 따로 낸다
                self.send_response(200)
                self.send_header('Content-Type', 'text/javascript; charset=utf-8')
                self.send_header('Content-Length', str(len(raw)))
                self.end_headers()
                return self.wfile.write(raw)
            if self.path in ('/fixture/model.json', '/fixture/base.json'):
                name = 'buildit-detail-integration.json' if self.path.endswith('model.json') else 'buildit-building.json'
                return self.send_json(json.loads((ROOT / 'test-fixtures/drawing' / name).read_text(encoding='utf-8')))
            if self.path == '/harness/login' and pack:
                grant = {'key': vault_gate.derive_screen_key(TEST_MASTER), 'session': 'e2' * 8, 'mark': 'E2Emark01', 'ttl': 600}
                vault_gate.SCREEN_PACK = pack
                vault_gate._fetch_screen = lambda token: grant
                return self.send_json(vault_gate.ensure_screen('account-token'))
            if self.path == '/harness/logout':
                vault_gate.forget_screen()
                return self.send_json({'screen': 'locked'})
            return super().do_GET()

        def do_POST(self):
            self.rfile.read(int(self.headers.get('Content-Length', '0')))
            if self.path == '/api/screen-vault' and pack:
                if self.headers.get('X-CAD-Token') != TOKEN:
                    return self.send_json({'error': '이 CAD 화면에서 요청을 다시 실행하세요.'}, 403)
                vault_gate.SCREEN_PACK = pack
                result = vault_gate.screen_bundle()
                return self.send_json(result, 403 if result['state'] == 'locked' else 200)
            self.send_error(404)
    return functools.partial(Handler, directory=str(dist))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--port', type=int, default=8790)
    parser.add_argument('--run', type=int, default=0, help='Electron 으로 번갈아 잴 횟수(0 이면 서버만)')
    options = parser.parse_args()
    port = options.port
    vault_gate.SCREEN_PACK = WORK / 'missing.pack'
    pack = build('vault', port)
    build('plain', port)
    servers = [ThreadingHTTPServer(('127.0.0.1', port), handler(WORK / 'vault', pack)),
               ThreadingHTTPServer(('127.0.0.1', port + 1), handler(WORK / 'plain', None))]
    for server in servers:
        threading.Thread(target=server.serve_forever, daemon=True).start()
    print(f'vault: http://127.0.0.1:{port}/  plain: http://127.0.0.1:{port + 1}/', flush=True)
    if not options.run:
        threading.Event().wait()
    sys.exit(run_electron(port, options.run))


ELECTRON_MAIN = r'''
const {app, BrowserWindow} = require('electron');
app.on('window-all-closed', () => {});   // 창을 하나씩 닫고 다음을 연다: 앱이 먼저 꺼지지 않게
app.whenReady().then(async () => {
  const urls = JSON.parse(process.env.SCREEN_E2E_URLS), results = [];
  for (const url of urls) {
    const win = new BrowserWindow({show: false, webPreferences: {backgroundThrottling: false}});
    for (let k = 0; k < 3; k++) { try { await win.loadURL(url + '?r=' + Math.random()); break; } catch { await new Promise(r => setTimeout(r, 1000)); } }
    let text = '';
    for (let i = 0; i < 240 && !text; i++) {
      await new Promise(r => setTimeout(r, 500));
      text = await win.webContents.executeJavaScript("document.title === 'done' ? document.body.textContent : ''");
    }
    results.push(text ? JSON.parse(text) : {url, error: 'timeout'});
    win.destroy();
  }
  process.stdout.write('E2E-RESULT ' + JSON.stringify(results) + String.fromCharCode(10));
  app.exit(0);
});
'''


def run_electron(port, rounds):
    main_file = WORK / 'electron-main.cjs'
    main_file.write_text(ELECTRON_MAIN, encoding='utf-8')
    urls = [f'http://127.0.0.1:{port + (i % 2)}/' for i in range(rounds * 2)]
    electron = ROOT / 'node_modules' / 'electron' / 'dist' / ('electron.exe' if sys.platform == 'win32' else 'electron')
    done = subprocess.run([str(electron), str(main_file)], env={**__import__('os').environ, 'SCREEN_E2E_URLS': json.dumps(urls)},
                          capture_output=True, text=True, encoding='utf-8', timeout=900)
    line = next((l for l in done.stdout.splitlines() if l.startswith('E2E-RESULT ')), None)
    if not line:
        print(done.stdout[-2000:], done.stderr[-2000:])
        return 1
    results = json.loads(line[len('E2E-RESULT '):])
    median = lambda values: sorted(values)[len(values) // 2]
    failed = []
    for variant in ('vault', 'plain'):
        rows = [r for r in results if r.get('variant') == variant]
        for r in rows:
            if r.get('error'):
                failed.append(f"{variant}: {r['error']}")
        rows = [r for r in rows if not r.get('error')]
        if not rows:
            continue
        first = [r['details'][0] for r in rows]
        steady = [v for r in rows for v in r['details'][1:]]
        set_first = [r['set'][0] for r in rows]
        sets = [v for r in rows for v in r['set'][1:]]
        print(f"{variant:5}  첫 불러오기 {median([r['mainImportMs'] for r in rows]):7.1f}ms  상세10 첫 {median(first):7.1f}ms  이후 {median(steady):7.1f}ms  "
              f"한 벌 첫 {median(set_first):7.1f}ms  이후 {median(sets):7.1f}ms  (상세 {rows[0]['detailEntities']}개·한 벌 {rows[0]['setEntities']}개 객체)")
    for r in results:
        if r.get('variant') == 'vault' and not r.get('error'):
            if r['before'] != {'import': 'locked-message', 'generate': '로그인하면 상세·도면 생성을 쓸 수 있어요.'}:
                failed.append(f"로그인 전 안내가 다릅니다: {r['before']}")
            if not r['watermarked']:
                failed.append('계정 표식이 없습니다')
            if r['plainLockedRequests']:
                failed.append(f"잠근 조각을 평문 주소로 불렀습니다: {r['plainLockedRequests']}")
    vault_rows = [r for r in results if r.get('variant') == 'vault' and not r.get('error')]
    plain_rows = [r for r in results if r.get('variant') == 'plain' and not r.get('error')]
    if vault_rows and plain_rows and (vault_rows[0]['detailEntities'], vault_rows[0]['setEntities']) != (plain_rows[0]['detailEntities'], plain_rows[0]['setEntities']):
        failed.append('잠근 판과 평문 판의 결과 객체 수가 다릅니다')
    for problem in failed:
        print('실패:', problem)
    return 1 if failed else 0


if __name__ == '__main__':
    main()
