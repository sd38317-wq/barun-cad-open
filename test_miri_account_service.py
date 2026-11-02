"""miri_account_service 검사 (5.0.5 갱신).

서비스는 바른 서버(barunarc.co.kr) 계정 토큰으로 상태·로그인·로그아웃을 처리하고,
미리보다 로컬 코어(127.0.0.1:7801)는 선택 연결 여부(miri_connected)로만 보고한다.
예전 검사는 로컬 코어에서 잔액을 읽던 시절의 것이라(KEY 이름·주소·응답 형식 모두 다름) 현재 동작에 맞춰 다시 쓴다.
실제 토큰 저장소(DPAPI)·브라우저·네트워크는 건드리지 않는다.
"""
import io
import json
import tempfile
import urllib.parse
import unittest
from pathlib import Path
from unittest.mock import patch

import miri_account_service as service


class FakeResponse:
    def __init__(self, value):
        self.body = io.BytesIO(json.dumps(value).encode('utf-8'))

    def __enter__(self):
        return self

    def __exit__(self, *_):
        return False

    def read(self, size=-1):
        return self.body.read(size)


def _isolated(folder, key_text='k' * 43):
    """토큰 파일·미리 키를 임시 폴더로 돌리고 DPAPI 보호를 항등 함수로 바꾼다."""
    key = Path(folder) / 'miri-core.key'
    if key_text is not None:
        key.write_text(key_text, encoding='utf-8')
    return [
        patch.object(service, 'TOKEN_FILE', Path(folder) / 'account-token.bin'),
        patch.object(service, 'MIRI_KEY', key),
        patch.object(service, '_protect', lambda data: data),
        patch.object(service, '_unprotect', lambda data: data),
    ]


class MiriAccountServiceTest(unittest.TestCase):
    def test_status_without_token_is_disconnected_and_probes_local_miri(self):
        with tempfile.TemporaryDirectory() as folder:
            patches = _isolated(folder)
            for p in patches: p.start()
            try:
                with patch('urllib.request.urlopen', side_effect=lambda *_a, **_k: FakeResponse({'ok': True})) as opened:
                    result = service.process({'action': 'status'})
                self.assertFalse(result['connected'])
                self.assertEqual(result['state'], 'disconnected')
                self.assertIsNone(result['coin_balance'])
                self.assertTrue(result['miri_connected'])
                request = opened.call_args.args[0]
                self.assertEqual(request.full_url, 'http://127.0.0.1:7801/api/miri/status')
                self.assertEqual(request.headers['X-miri-core-key'], 'k' * 43)
                self.assertEqual(request.headers['X-miri-app-id'], 'barun-cad')
            finally:
                for p in patches: p.stop()

    def test_status_with_token_polls_server_with_bearer(self):
        with tempfile.TemporaryDirectory() as folder:
            patches = _isolated(folder, key_text=None)   # 미리 키 없음 → miri_connected False
            for p in patches: p.start()
            try:
                service._save_token('t' * 64)
                payload = {'state': 'linked', 'display_name': '표님', 'coin_balance': 3250, 'packs': ['건축 팩', 7]}
                with patch('urllib.request.urlopen', side_effect=lambda *_a, **_k: FakeResponse(payload)) as opened:
                    result = service.process({'action': 'status'})
                self.assertTrue(result['connected'])
                self.assertEqual(result['coin_balance'], 3250)
                self.assertEqual(result['display_name'], '표님')
                self.assertEqual(result['packs'], ['건축 팩'])
                self.assertFalse(result['miri_connected'])
                request = opened.call_args_list[0].args[0]
                self.assertEqual(request.full_url, service.API + 'poll')
                self.assertEqual(request.method, 'POST')
                self.assertEqual(request.headers['Authorization'], 'Bearer ' + 't' * 64)
            finally:
                for p in patches: p.stop()

    def test_login_logout_and_menu_are_restricted(self):
        with tempfile.TemporaryDirectory() as folder:
            patches = _isolated(folder)
            for p in patches: p.start()
            try:
                good = {'authorize_url': service.ORIGIN + '/api/auth/miri/connect?code=' + 'a' * 64, 'expires_in': 600}
                with patch('urllib.request.urlopen', side_effect=lambda *_a, **_k: FakeResponse(good)) as opened, \
                     patch('webbrowser.open') as browser:
                    result = service.process({'action': 'login'})
                self.assertEqual(result['state'], 'waiting')
                self.assertEqual(opened.call_args.args[0].full_url, service.API + 'start')
                self.assertEqual(opened.call_args.args[0].method, 'POST')
                browser.assert_called_once_with(good['authorize_url'], new=2)
                self.assertIsNotNone(service._load_token())

                bad = {'authorize_url': 'https://evil.example/connect?code=abc'}
                with patch('urllib.request.urlopen', side_effect=lambda *_a, **_k: FakeResponse(bad)), \
                     patch('webbrowser.open') as browser, self.assertRaisesRegex(ValueError, '올바르지'):
                    service.process({'action': 'login'})
                browser.assert_not_called()

                with patch('urllib.request.urlopen', side_effect=lambda *_a, **_k: FakeResponse({'ok': True})) as opened:
                    result = service.process({'action': 'logout'})
                self.assertEqual(result['state'], 'disconnected')
                self.assertEqual(opened.call_args.args[0].full_url, service.API + 'disconnect')
                self.assertIsNone(service._load_token())

                with patch('webbrowser.open') as browser, self.assertRaisesRegex(ValueError, '올바르지'):
                    service.process({'action': 'open', 'page': 'https://evil.example'})
                browser.assert_not_called()
                with self.assertRaisesRegex(ValueError, '지원하지'):
                    service.process({'action': 'nope'})
            finally:
                for p in patches: p.stop()


    def test_google_uses_same_desktop_token_start_poll_and_disconnect(self):
        with tempfile.TemporaryDirectory() as folder:
            patches = _isolated(folder, key_text=None)
            for p in patches: p.start()
            try:
                seen = []
                code = 'a' * 64
                def fake_server(request, **_):
                    seen.append(request)
                    if request.full_url.endswith('/start'):
                        return FakeResponse({'authorize_url': service.ORIGIN + '/api/auth/miri/connect?code=' + code, 'expires_in': 600})
                    if request.full_url.endswith('/poll'):
                        return FakeResponse({'state': 'linked', 'display_name': 'Google 회원', 'coin_balance': 100})
                    return FakeResponse({'ok': True})
                with patch('urllib.request.urlopen', side_effect=fake_server), patch('webbrowser.open') as browser, patch('vault_gate.ensure', return_value={'protected': True}):
                    started = service.process({'action': 'login', 'provider': 'google'})
                    self.assertEqual(started, {'connected': False, 'state': 'waiting', 'expires_in': 600})
                    login_url = urllib.parse.urlsplit(browser.call_args.args[0])
                    self.assertEqual(login_url.scheme + '://' + login_url.netloc, service.ORIGIN)
                    self.assertEqual(login_url.path, '/api/auth/google/start')
                    self.assertEqual(urllib.parse.parse_qs(login_url.query), {'mode': ['login'], 'returnTo': ['/api/auth/miri/connect?code=' + code]})
                    desktop_token = service._load_token()
                    self.assertNotIn(desktop_token, browser.call_args.args[0])
                    status = service.process({'action': 'status'})
                    self.assertTrue(status['connected'])
                    self.assertEqual(status['coin_balance'], 100)
                    service.process({'action': 'logout'})
                self.assertEqual([r.full_url for r in seen], [service.API + a for a in ('start', 'poll', 'disconnect')])
                self.assertEqual({r.headers['Authorization'] for r in seen}, {'Bearer ' + desktop_token})
                self.assertIsNone(service._load_token())
            finally:
                for p in patches: p.stop()

    def test_login_rejects_unknown_provider_before_storage_or_network(self):
        with patch.object(service, '_load_token') as load, patch.object(service, '_request') as request, patch('webbrowser.open') as browser:
            with self.assertRaisesRegex(ValueError, '지원하지'):
                service.process({'action': 'login', 'provider': 'other'})
            load.assert_not_called()
            request.assert_not_called()
            browser.assert_not_called()

    def test_provider_login_rejects_unsafe_or_invalid_approval_urls(self):
        code = 'a' * 64
        bad_urls = [
            'https://barunarc.co.kr.evil.example/api/auth/miri/connect?code=' + code,
            service.ORIGIN + '/api/auth/miri/connect?code=' + code + '&returnTo=https://evil.example',
            service.ORIGIN + '/api/auth/miri/connect?code=' + code + '&code=' + code,
            service.ORIGIN + '/api/auth/miri/connect?code=' + code + '#fragment',
            service.ORIGIN + '/api/auth/miri/connect?code=short',
            service.ORIGIN + '/api/auth/miri/connect/other?code=' + code,
            'http://barunarc.co.kr/api/auth/miri/connect?code=' + code,
        ]
        for provider in ('kakao', 'google'):
            for url in bad_urls:
                with self.subTest(provider=provider, url=url), patch.object(service, '_load_token', return_value='t' * 64), patch.object(service, '_save_token'), patch.object(service, '_request', return_value={'authorize_url': url}), patch('webbrowser.open') as browser:
                    with self.assertRaisesRegex(ValueError, '올바르지'):
                        service.process({'action': 'login', 'provider': provider})
                    browser.assert_not_called()


if __name__ == '__main__':
    unittest.main()
