// 잠근 화면 코드 불러오기(screen-vault.js): 진짜 서버·엔진 없이 자리표 잇기·잠김 안내·다시 받기를 확인한다.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {instantiate, lockedImport, LOCKED_MESSAGE, LOCKED_ENTRIES, setScreenVaultSource, screenVaultBundle, forgetScreenVault} from './screen-vault.js';

const dataUrl = code => 'data:text/javascript,' + encodeURIComponent(code);

test('자리표: 잠근 조각끼리는 만든 URL, 나머지는 앱 주소로 잇는다(정적·동적 import)', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'screen-vault-'));
  fs.writeFileSync(path.join(dir, 'chunk-PLAIN.js'), 'export const plain=5;');
  const bundle = {
    order: ['chunk-A.js', 'sub/entry.js'],
    files: {
      'chunk-A.js': 'export const a=1;',
      'sub/entry.js': 'import{a}from"barun-vault:chunk-A.js";import{plain}from"barun-plain:chunk-PLAIN.js";export const v=a+plain;export const later=()=>import(\'barun-vault:chunk-A.js\');',
    },
  };
  const urls = instantiate(bundle, {origin: pathToFileURL(dir).href, makeUrl: dataUrl});
  const entry = await import(urls['sub/entry.js']);
  assert.equal(entry.v, 6);
  assert.equal((await entry.later()).a, 1);
  assert.doesNotMatch(decodeURIComponent(urls['sub/entry.js']), /barun-(vault|plain):/);
});

test('자리표 순서가 틀리거나 파일이 빠지면 멈춘다', () => {
  assert.throws(() => instantiate({order: ['b.js', 'a.js'], files: {'a.js': '', 'b.js': 'import"barun-vault:a.js";'}}, {origin: 'http://x', makeUrl: dataUrl}), /순서/);
  assert.throws(() => instantiate({order: ['a.js'], files: {}}, {origin: 'http://x', makeUrl: dataUrl}), /빠졌습니다/);
});

test('개발 실행(빌드 정의 없음)은 소스를 그대로 불러오고, 잠금 목록 밖 이름은 거절한다', async () => {
  const registry = await lockedImport('drawing-details/registry.js');
  assert.equal(typeof registry.autoSelect, 'function');
  await assert.rejects(lockedImport('engine.js'), /잠근 화면 코드가 아닙니다/);
  assert.deepEqual([...LOCKED_ENTRIES].sort(), ['auto-plan.js', 'detail-search-panel.js', 'drawing-details/registry.js', 'drawing-generator.js', 'ifc-writer.js', 'planset-command.js']);
});

test('설치판: 로그인 전에는 안내 문구로 실패하고, 로그인 뒤 다시 부르면 다시 받는다', async () => {
  globalThis.BARUN_SCREEN_VAULT = true;
  const realFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    calls.push([url, init.headers?.['X-CAD-Token'] ?? null]);
    if (url === '/api/status') return new Response(JSON.stringify({token: 'screen-token'}));
    return new Response(JSON.stringify({state: 'locked', error: LOCKED_MESSAGE}), {status: 403});
  };
  try {
    await assert.rejects(lockedImport('drawing-generator.js'), error => error.message === LOCKED_MESSAGE && error.code === 'screen_locked');
    await assert.rejects(lockedImport('drawing-generator.js'), /로그인하면/);
    assert.deepEqual(calls.filter(([url]) => url === '/api/screen-vault').map(([, token]) => token), ['screen-token', 'screen-token'], '실패는 기억하지 않고 화면 토큰을 실어 다시 묻는다');
    // Worker: 화면 스레드가 건네는 길(setScreenVaultSource)로 받고, 잠김 오류도 그대로 전한다.
    setScreenVaultSource(async () => { throw Object.assign(Error(LOCKED_MESSAGE), {code: 'screen_locked'}); });
    await assert.rejects(screenVaultBundle(), /로그인하면/);
  } finally {
    setScreenVaultSource(null);
    globalThis.fetch = realFetch;
    delete globalThis.BARUN_SCREEN_VAULT;
  }
});

test('로그아웃·만료(forgetScreenVault): 받아 둔 묶음을 버리고 다음 요청은 엔진에 다시 묻는다 — 잠겼으면 실패', async () => {
  globalThis.BARUN_SCREEN_VAULT = true;
  const realFetch = globalThis.fetch;
  let unlocked = true, asked = 0;
  globalThis.fetch = async url => {
    if (url === '/api/status') return new Response(JSON.stringify({token: 'screen-token'}));
    asked++;
    return unlocked ? new Response(JSON.stringify({state: 'unlocked', order: [], files: {}})) : new Response(JSON.stringify({state: 'locked', error: LOCKED_MESSAGE}), {status: 403});
  };
  try {
    forgetScreenVault();
    await screenVaultBundle();
    await screenVaultBundle();
    assert.equal(asked, 1, '로그인 동안은 한 번 받은 묶음을 쓴다');
    unlocked = false;
    forgetScreenVault();
    await assert.rejects(screenVaultBundle(), /로그인하면/);
    assert.equal(asked, 2);
  } finally {
    forgetScreenVault();
    globalThis.fetch = realFetch;
    delete globalThis.BARUN_SCREEN_VAULT;
  }
});

test('로그아웃 알림이 화면 잠금 캐시와 명령 실행기 Worker 를 함께 내린다(이름이 서로 맞는지)', () => {
  const read = name => fs.readFileSync(new URL('./' + name, import.meta.url), 'utf8');
  assert.match(read('screen-vault.js'), /addEventListener\?\.\('barun-protected-locked', forgetScreenVault\)/);
  assert.match(read('command-runner.js'), /addEventListener\?\.\('barun-protected-locked',\(\)=>\{if\(active===null\)terminate\(\);else retire=true;\}\)/);
  const adapter = read('shared-account-adapter.js');
  assert.equal(adapter.match(/dispatchEvent\?\.\(new Event\('barun-protected-locked'\)\)/g)?.length, 2, '로그아웃·만료 두 곳');
});

test('설치판 화면 CSP 가 blob 모듈(잠근 코드)을 허용하고, 그 밖의 원격·eval 은 그대로 막는다', () => {
  const meta = fs.readFileSync(new URL('./index.html', import.meta.url), 'utf8').match(/Content-Security-Policy" content="([^"]+)"/)[1];
  const script = meta.split(';').map(part => part.trim().split(/\s+/)).find(([name]) => name === 'script-src');
  assert.ok(script.includes('blob:'));
  assert.ok(!script.includes("'unsafe-eval'") && !script.includes("'unsafe-inline'"));
});
