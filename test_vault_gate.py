"""핵심 자산 열쇠 문(vault_gate): 로그인 전 잠김 → 서버 열쇠로 풀림 → PC 보관(오프라인에서도 열림)."""
import hmac
import json
import shutil
import subprocess
import tempfile
import unittest
from hashlib import sha256
from pathlib import Path
from unittest import mock

import vault
import vault_gate

TEST_MASTER = '22' * 32   # 시험용 가짜 비밀


class VaultGateTests(unittest.TestCase):
    def setUp(self):
        self.dir = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.dir, True)
        self.key = vault_gate.derive_key(TEST_MASTER)
        pack = self.dir / 'pro.pack'
        pack.write_bytes(vault.pack(vault_gate.source_files(), self.key))
        for name, value in (('PRO_PACK', pack), ('KEY_DIR', self.dir / 'keys'), ('_files', None), ('_key', None), ('_server', None), ('_generation', 0), ('_refill_after', 1e9), ('_refill_at', 1.0)):   # 시험은 저장된 진짜 로그인으로 서버에 묻지 않는다
            patcher = mock.patch.object(vault_gate, name, value)
            patcher.start()
            self.addCleanup(patcher.stop)

    def test_engine_restart_refills_server_knowledge_from_saved_login(self):
        """2026-10-27: 엔진이 다시 켜지면(멈춤 복구) 서버 규칙이 비어, 로그인돼 있어도 도서 만들기가 '로그인한 뒤 쓸 수 있습니다'로 막혔다.
        규칙이 필요할 때 저장된 로그인으로 한 번 다시 받는다(실패하면 잠시 다시 묻지 않는다)."""
        with mock.patch('miri_account_service._load_token', return_value='token'), \
                mock.patch.object(vault_gate, '_fetch', return_value=self.key), \
                mock.patch.object(vault_gate, '_fetch_knowledge', return_value={'command-library.json': b'{"ok":1}'}) as got, \
                mock.patch.object(vault_gate, '_refill_after', 0.0), mock.patch.object(vault_gate, '_refill_at', 0.0), \
                mock.patch.object(vault_gate, 'refill_enabled', True):
            self.assertEqual(vault_gate.knowledge('command-library.json'), b'{"ok":1}')
            self.assertEqual(got.call_count, 1)
        vault_gate._server = None
        with mock.patch('miri_account_service._load_token', return_value='token'), \
                mock.patch.object(vault_gate, '_fetch_knowledge', side_effect=ValueError('오프라인')) as got, \
                mock.patch.object(vault_gate, '_refill_after', 20.0), mock.patch.object(vault_gate, '_refill_at', 0.0), \
                mock.patch.object(vault_gate, 'refill_enabled', True):
            for _ in range(3):
                with self.assertRaises(ValueError): vault_gate.knowledge('command-library.json')
            self.assertEqual(got.call_count, 1, '실패 뒤 곧바로 다시 묻지 않는다')

    def test_key_formula_matches_server(self):
        expected = hmac.new(bytes.fromhex(TEST_MASTER), f'barun-vault/v1/barun-cad/{vault_gate.version()}'.encode(), sha256).digest()
        self.assertEqual(self.key, expected)

    @mock.patch('miri_account_service._protect', side_effect=lambda value: value)
    @mock.patch('miri_account_service._unprotect', side_effect=lambda value: value)
    def test_locked_until_login_then_unlocked_and_kept(self, _unprotect, _protect):
        self.assertEqual(vault_gate.state(), 'locked')
        self.assertIn(b'locked', vault_gate.screen_file('layer-knowledge-data.js'))
        self.assertIn('로그인'.encode(), vault_gate.screen_file('livecheck-worker.js'))
        with self.assertRaises(ValueError):
            vault_gate.knowledge('drawing-rulebook.json')
        with mock.patch.object(vault_gate, '_fetch', return_value=self.key) as fetch, mock.patch.object(vault_gate, '_fetch_knowledge', return_value={}):
            self.assertEqual(vault_gate.ensure('token'), {'protected': 'unlocked', 'protected_fresh': True})
            self.assertEqual(vault_gate.ensure('token')['protected_fresh'], False, '두 번째는 서버에 묻지 않는다')
            self.assertEqual(fetch.call_count, 1)
        self.assertEqual(vault_gate.screen_file('livecheck-worker.js'), (vault_gate.ROOT / 'livecheck-worker.js').read_bytes())
        self.assertTrue(json.loads(vault_gate.knowledge('drawing-rulebook.json')))
        # 다시 켠 것처럼(메모리 비움): 보관한 열쇠로 오프라인에서도 열린다
        vault_gate._files = None
        with mock.patch.object(vault_gate, '_fetch', side_effect=AssertionError('오프라인')):
            self.assertEqual(vault_gate.state(), 'unlocked')
            self.assertEqual(vault_gate.pack_key(), self.key, '보조 묶음(리습·미리보기)도 같은 열쇠로 연다')
        # 로그아웃: 메모리·보관 열쇠 모두 버려 다시 잠긴다(2026-10-23)
        (self.dir / 'keys' / 'vault-key-7.0.5.bin').write_bytes(b'old')
        vault_gate.forget()
        self.assertFalse(list((self.dir / 'keys').glob('*.bin')))
        self.assertEqual(vault_gate.state(), 'locked')
        with self.assertRaises(ValueError):
            vault_gate.pack_key()

    def test_mcp_drawing_standard_comes_only_from_server(self):
        # 작도 기준 6개는 pro.pack 에 없고(설치판에 없음) 로그인 때 서버에서 받아 메모리에만 둔다. 로그아웃하면 버린다.
        self.assertFalse(set(vault_gate.SERVER_KNOWLEDGE) & set(vault_gate.source_files()))
        served = {name: {'name': name, '_barun_mark': 'abc'} for name in vault_gate.SERVER_KNOWLEDGE}
        reply = mock.MagicMock()
        reply.__enter__.return_value.read.return_value = json.dumps({'state': 'ok', 'files': served}).encode()
        with mock.patch('urllib.request.urlopen', return_value=reply), mock.patch.object(vault_gate, '_fetch', return_value=self.key),              mock.patch.object(vault_gate, '_save_key'):
            vault_gate.ensure('token')
        self.assertEqual(json.loads(vault_gate.knowledge('layer-usage.json'))['_barun_mark'], 'abc')
        vault_gate.forget()
        with self.assertRaises(ValueError):
            vault_gate.knowledge('layer-usage.json')
        bad = mock.MagicMock()
        bad.__enter__.return_value.read.return_value = json.dumps({'state': 'ok', 'files': {'layer-usage.json': {}}}).encode()
        with mock.patch('urllib.request.urlopen', return_value=bad), self.assertRaises(ValueError):
            vault_gate._fetch_knowledge('token')

    def test_extra_bundles_are_all_or_none(self):
        # 도서 양식 묶음(extras)은 서버가 아직 모르면 빠져도 기본 작도 기준은 연다. 묶음의 일부만 오면 거절한다.
        def reply(names):
            r = mock.MagicMock(); r.__enter__.return_value.read.return_value = json.dumps({'state': 'ok', 'files': {n: {'n': n} for n in names}}).encode(); return r
        base = list(vault_gate.BASE_KNOWLEDGE); energy = list(vault_gate.EXTRA_KNOWLEDGE['energy-plan']); access = list(vault_gate.EXTRA_KNOWLEDGE['access-plan'])
        with mock.patch('urllib.request.urlopen', return_value=reply(base + energy)):
            self.assertEqual(set(vault_gate._fetch_knowledge('t')), set(base + energy))   # 편의시설 묶음을 아직 안 주는 서버
        with mock.patch('urllib.request.urlopen', return_value=reply(base + energy + access)):
            self.assertIn('access-plan/templates.json', vault_gate._fetch_knowledge('t'))
        for names in (base + access[:1], base[1:] + energy, base + ['other.json']):
            with mock.patch('urllib.request.urlopen', return_value=reply(names)), self.assertRaises(ValueError):
                vault_gate._fetch_knowledge('t')
        self.assertEqual(set(vault_gate.KNOWLEDGE_EXTRAS), {'energy-plan', 'access-plan'})

    def test_logout_during_key_fetch_keeps_it_locked(self):
        # 열쇠를 받는 사이 로그아웃하면 늦게 온 열쇠로 다시 열리지 않는다(Codex 검토 10-23)
        def late(_token):
            vault_gate.forget()
            return self.key
        with mock.patch.object(vault_gate, '_fetch_knowledge', side_effect=ValueError('x')), mock.patch.object(vault_gate, '_fetch', side_effect=late):
            self.assertEqual(vault_gate.ensure('token')['protected'], 'locked')
        self.assertEqual(vault_gate.state(), 'locked')

    def test_wrong_key_is_not_kept(self):
        with mock.patch.object(vault_gate, '_fetch', return_value=b'\x01' * 32):
            result = vault_gate.ensure('token')
        self.assertEqual(result['protected'], 'locked')
        self.assertFalse(any((self.dir / 'keys').glob('*.bin')) if (self.dir / 'keys').exists() else False)

    def test_locked_screen_stubs_keep_basic_layer_features(self):
        # 잠긴 빈 자리로도 레이어 판정이 깨지지 않고, 새 도면 표준 레이어(공간_*·주방기구 14개)는 그대로다.
        work = self.dir / 'js'
        work.mkdir()
        for name in ('layer-knowledge.js', 'layer-ranking.js', 'layer-standards.js', 'layer-standards-data.js'):
            shutil.copy(vault_gate.ROOT / name, work / name)
        for name in ('layer-knowledge-data.js', 'layer-ranking-data.js'):
            (work / name).write_bytes(vault_gate.LOCKED_SCREEN[name])
        script = ("import {learnedLayerStandards,classifyByLayerKnowledge,layerNameLabel} from './layer-knowledge.js';"
                  "import {rankLayerCandidates} from './layer-ranking.js';"
                  "const r=rankLayerCandidates({id:'a',type:'line'},{name:'A-WALL'});"
                  "console.log(JSON.stringify({n:learnedLayerStandards.length,r:[r.label,r.accepted,r.status],"
                  "c:classifyByLayerKnowledge({id:'t',type:'text'},{name:'X'})?.label,name:layerNameLabel({name:'DIM'})}));")
        out = subprocess.run(['node', '--input-type=module', '-e', script], cwd=work, capture_output=True, text=True, encoding='utf-8', check=True).stdout
        self.assertEqual(json.loads(out), {'n': 14, 'r': [None, False, 'review'], 'c': '문자', 'name': None})

    def test_detail_groups_locked_pack_requires_key(self):
        with self.assertRaises(ValueError):
            vault_gate.detail_groups()

    def test_details_are_packaged_and_traversal_is_rejected(self):
        self.assertIn('details/wall.json', vault_gate.source_files())
        self.assertIn('country/kor/details/wall.json', vault_gate.source_files())
        with self.assertRaises(ValueError):
            vault_gate.knowledge('../package.json')

    def test_detail_groups_excludes_schema(self):
        with mock.patch.object(vault_gate, 'PRO_PACK', self.dir / 'missing.pack'):
            groups = vault_gate.detail_groups()
        self.assertNotIn('_schema', groups)
        self.assertEqual(set(groups), {'wall', 'window', 'floor', 'roof', 'stair', 'fire', 'parking', 'access', 'interior', 'steel'})

    def test_detail_groups_reads_packaged_memory_without_plaintext_directory(self):
        payload = {'schema': 'barun-detail-group', 'group': 'wall', 'details': []}
        packed = {'details/_schema.json': b'{}', 'details/wall.json': json.dumps(payload).encode('utf8')}
        with mock.patch.object(vault_gate, 'PRO_PACK', self.dir / 'present.pack'), mock.patch.object(vault_gate, 'files', return_value=packed):
            (self.dir / 'present.pack').write_bytes(b'pack')
            groups = vault_gate.detail_groups()
        self.assertEqual(groups, {'wall': payload})

    def test_country_selection_and_missing_pack_keep_drawings(self):
        with mock.patch.object(vault_gate, 'PRO_PACK', self.dir / 'missing.pack'):
            kor = vault_gate.detail_groups('kor')
            common = vault_gate.detail_groups('')
            missing = vault_gate.detail_groups('absent')
        self.assertEqual(common, missing)
        for group, value in common.items():
            self.assertEqual(value['laws'], [])
            self.assertEqual([d['id'] for d in value['details']], [d['id'] for d in kor[group]['details']])
            self.assertTrue(all(not d['checks'] and not d['lawRefs'] and not d['lh'] for d in value['details']))
        self.assertTrue(kor['wall']['laws'])
        with self.assertRaises(ValueError):
            vault_gate.detail_groups('../kor')

    def test_country_environment_is_single_default_setting(self):
        with mock.patch.object(vault_gate, 'PRO_PACK', self.dir / 'missing.pack'), mock.patch.dict(vault_gate.os.environ, {'BARUN_DETAIL_COUNTRY': ''}):
            self.assertEqual(vault_gate.detail_groups(), vault_gate.detail_groups(''))

    def test_country_overlay_reads_packaged_memory_without_plaintext(self):
        common = {'group': 'wall', 'laws': [], 'details': [{'id': 'WALL-01', 'checks': [], 'lh': []}]}
        overlay = {'schema': 'barun-detail-country', 'country': 'kor', 'group': 'wall', 'laws': [{'id': 'LAW'}], 'details': [{'id': 'WALL-01', 'lh': ['DA-01-001']}]}
        packed = {'details/wall.json': json.dumps(common).encode(), 'country/kor/details/wall.json': json.dumps(overlay).encode()}
        with mock.patch.object(vault_gate, 'PRO_PACK', self.dir / 'present.pack'), mock.patch.object(vault_gate, 'files', return_value=packed):
            (self.dir / 'present.pack').write_bytes(b'pack')
            result = vault_gate.detail_groups('kor')
        self.assertEqual(result['wall']['laws'], overlay['laws'])
        self.assertEqual(result['wall']['details'][0]['lh'], ['DA-01-001'])


class ScreenVaultTests(unittest.TestCase):
    """화면 핵심 코드(screen.pack): 세션 이용권(짧은 열쇠)·계정 표식·기한·로그아웃. 진짜 서버에 나가지 않는다."""

    def setUp(self):
        self.dir = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.dir, True)
        self.key = vault_gate.derive_screen_key(TEST_MASTER)
        manifest = {'order': ['chunk-A.js', 'drawing-generator.js'], 'entries': ['drawing-generator.js'], 'fingerprints': []}
        self.files = {'chunk-A.js': b'export const a=1;', 'drawing-generator.js': b'import{a}from"barun-vault:chunk-A.js";export const g=a;',
                      'manifest.json': json.dumps(manifest).encode()}
        pack = self.dir / 'screen.pack'
        pack.write_bytes(vault.pack(self.files, self.key))
        for name, value in (('SCREEN_PACK', pack), ('_screen', None), ('_screen_failed', None)):
            patcher = mock.patch.object(vault_gate, name, value)
            patcher.start()
            self.addCleanup(patcher.stop)

    def grant(self, session='ab' * 8, mark='Mark0001', ttl=3600, key=None):
        return {'key': key or self.key, 'session': session, 'mark': mark, 'ttl': ttl}

    def test_screen_key_differs_from_pro_key_and_matches_server_formula(self):
        expected = hmac.new(bytes.fromhex(TEST_MASTER), f'barun-screen/v1/barun-cad/{vault_gate.version()}'.encode(), sha256).digest()
        self.assertEqual(self.key, expected)
        self.assertNotEqual(self.key, vault_gate.derive_key(TEST_MASTER))
        with self.assertRaises(ValueError):
            vault.unpack(vault.pack(self.files, self.key), vault_gate.derive_key(TEST_MASTER))

    def test_locked_until_login_then_watermarked_in_memory_only(self):
        self.assertEqual(vault_gate.screen_bundle(), {'state': 'locked', 'error': vault_gate.SCREEN_LOCKED_MESSAGE})
        keys = self.dir / 'keys'
        with mock.patch.object(vault_gate, '_fetch_screen', return_value=self.grant()) as fetch, mock.patch.object(vault_gate, 'KEY_DIR', keys):
            self.assertEqual(vault_gate.ensure_screen('token'), {'screen': 'unlocked', 'screen_fresh': True})
            self.assertEqual(vault_gate.ensure_screen('token'), {'screen': 'unlocked'}, '기한 안에는 서버에 다시 묻지 않는다')
            self.assertEqual(fetch.call_count, 1)
        bundle = vault_gate.screen_bundle()
        self.assertEqual(bundle['order'], ['chunk-A.js', 'drawing-generator.js'])
        code = bundle['files']['drawing-generator.js']
        self.assertTrue(code.startswith('/*barun:Mark0001:' + 'ab' * 8 + '*/'), code)
        self.assertIn('barun-vault:chunk-A.js', code, '자리표는 화면이 채운다')
        self.assertTrue(code.rstrip().endswith('//barun:Mark0001:' + 'ab' * 8))
        self.assertFalse(keys.exists(), '세션 열쇠는 PC 에 남기지 않는다')
        self.assertNotIn('key', vault_gate._screen)

    def test_session_expiry_logout_and_new_session_mark(self):
        with mock.patch.object(vault_gate, '_fetch_screen', return_value=self.grant(ttl=60)):
            vault_gate.ensure_screen('token')
        with mock.patch.object(vault_gate.time, 'monotonic', return_value=vault_gate.time.monotonic() + 61):
            self.assertEqual(vault_gate.screen_bundle()['state'], 'locked', '기한이 지나면 다시 잠긴다')
        with mock.patch.object(vault_gate, '_fetch_screen', return_value=self.grant(session='cd' * 8, mark='Other002')):
            self.assertEqual(vault_gate.ensure_screen('token')['screen'], 'unlocked')
        self.assertIn('Other002:' + 'cd' * 8, vault_gate.screen_bundle()['files']['chunk-A.js'], '새 세션은 새 표식')
        vault_gate.forget_screen()
        self.assertEqual(vault_gate.screen_bundle()['state'], 'locked')

    def test_wrong_key_or_offline_stays_locked(self):
        with mock.patch.object(vault_gate, '_fetch_screen', return_value=self.grant(key=b'\x01' * 32)):
            self.assertEqual(vault_gate.ensure_screen('token')['screen'], 'locked')
        with mock.patch.object(vault_gate, '_fetch_screen', side_effect=ValueError('열쇠 서버에 연결하지 못했습니다.')):
            result = vault_gate.ensure_screen('token', force=True)
        self.assertEqual(result, {'screen': 'locked', 'screen_error': '열쇠 서버에 연결하지 못했습니다.'})
        self.assertEqual(vault_gate.screen_bundle()['state'], 'locked')

    def test_offline_backoff_but_user_request_asks_now(self):
        # 오프라인: 상태 확인마다 15초짜리 요청을 되풀이하지 않는다. 사용자가 누른 요청(force)·로그아웃 뒤에는 바로 묻는다.
        with mock.patch.object(vault_gate, '_fetch_screen', side_effect=ValueError('끊김')) as fetch:
            vault_gate.ensure_screen('token')
            self.assertEqual(vault_gate.ensure_screen('token'), {'screen': 'locked', 'screen_error': '끊김'})
            self.assertEqual(fetch.call_count, 1)
        with mock.patch.object(vault_gate, '_fetch_screen', return_value=self.grant()) as fetch:
            self.assertEqual(vault_gate.ensure_screen('token', force=True)['screen'], 'unlocked')
        vault_gate.forget_screen()
        self.assertIsNone(vault_gate._screen_failed)
        later = vault_gate.time.monotonic() + vault_gate.SCREEN_RETRY + 1
        with mock.patch.object(vault_gate.time, 'monotonic', return_value=later), mock.patch.object(vault_gate, '_fetch_screen', side_effect=ValueError('끊김')):
            vault_gate.ensure_screen('token')
            self.assertEqual(vault_gate.screen_bundle()['state'], 'locked')

    def test_server_response_is_validated(self):
        good = {'state': 'ok', 'key': self.key.hex(), 'session': 'ab' * 8, 'mark': 'Mark0001', 'expiresIn': 43200}

        class Response:
            def __init__(self, body): self.body = json.dumps(body).encode()
            def __enter__(self): return self
            def __exit__(self, *args): return False
            def read(self, limit): return self.body

        sent = []
        def urlopen(request, timeout):
            sent.append(json.loads(request.data))
            return Response(body)
        for body, ok in ((good, True), ({**good, 'mark': 'a b'}, False), ({**good, 'expiresIn': 10 ** 6}, False),
                         ({**good, 'session': 'x'}, False), ({**good, 'key': 'zz'}, False), ({'state': 'login_required'}, False)):
            with mock.patch.object(vault_gate.urllib.request, 'urlopen', urlopen):
                if ok:
                    self.assertEqual(vault_gate._fetch_screen('t')['mark'], 'Mark0001')
                else:
                    with self.assertRaises(ValueError):
                        vault_gate._fetch_screen('t')
        self.assertEqual(sent[0], {'product': 'barun-cad', 'version': vault_gate.version(), 'scope': 'screen'})

    def test_source_run_uses_files_directly(self):
        with mock.patch.object(vault_gate, 'SCREEN_PACK', self.dir / 'missing.pack'):
            self.assertEqual(vault_gate.screen_bundle(), {'state': 'source'})
            self.assertEqual(vault_gate.ensure_screen('token'), {'screen': 'source'})

    def test_engine_route_needs_screen_token_and_session(self):
        import functools
        import threading
        import urllib.error
        import urllib.request
        from http.server import ThreadingHTTPServer
        import miri_account_service
        import server

        class Quiet(server.Handler):
            def log_message(self, *args):
                pass
        httpd = ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(Quiet, directory=str(server.ROOT)))
        threading.Thread(target=httpd.serve_forever, daemon=True).start()
        self.addCleanup(httpd.shutdown)
        origin = f'http://127.0.0.1:{httpd.server_port}'

        def post(token):
            request = urllib.request.Request(origin + '/api/screen-vault', data=b'{}', method='POST',
                                             headers={'Content-Type': 'application/json', 'Origin': origin, 'X-CAD-Token': token})
            try:
                with urllib.request.urlopen(request, timeout=10) as response:
                    return response.status, json.loads(response.read())
            except urllib.error.HTTPError as error:
                return error.code, json.loads(error.read())
        status, body = post('wrong-token')
        self.assertEqual(status, 403)
        self.assertNotIn('files', body)
        with mock.patch.object(miri_account_service, '_load_token', return_value=None):
            self.assertEqual(post(server.TOKEN), (403, {'state': 'locked', 'error': vault_gate.SCREEN_LOCKED_MESSAGE}))
        # 화면이 먼저 눌렀다(상태 확인 전): 저장된 계정 토큰으로 바로 받아 내준다.
        with mock.patch.object(miri_account_service, '_load_token', return_value='account'), \
                mock.patch.object(vault_gate, '_fetch_screen', return_value=self.grant()) as fetch:
            status, body = post(server.TOKEN)
        self.assertEqual(status, 200)
        self.assertEqual(fetch.call_args.args, ('account',))
        self.assertEqual(body['order'], ['chunk-A.js', 'drawing-generator.js'])
        self.assertTrue(body['files']['chunk-A.js'].startswith('/*barun:Mark0001:'))

    def test_logout_clears_screen_session(self):
        import miri_account_service
        vault_gate._screen = {'expires': vault_gate.time.monotonic() + 100, 'files': {}, 'order': []}
        with mock.patch.object(miri_account_service, 'TOKEN_FILE', self.dir / 'token.bin'):
            miri_account_service._clear_token()
        self.assertIsNone(vault_gate._screen)


if __name__ == '__main__':
    unittest.main()
