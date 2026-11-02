"""데스크톱 엔진의 화면 열쇠·엔진 시험·연결 파일 권한(2026-10-20 보안 점검 후속).

- 풀린 핵심 자산(지식·레이어 정리·법규 검사)은 Host·Sec-Fetch-Site 만으로 내주지 않고 화면 열쇠가 있어야 준다.
- /api/status 는 시험(X-CAD-Challenge)에 열쇠를 아는 엔진만 낼 수 있는 답(X-CAD-Proof)을 붙인다(포트까지 묶음).
- 연결 파일(열쇠가 들어 있음)은 이 계정만 읽게 0600 으로 쓴다.
"""
import hashlib
import hmac
import http.client
import json
import os
import stat
import tempfile
import threading
import unittest
from http.server import ThreadingHTTPServer
from unittest.mock import patch

import server

REJECTED = '이 CAD 화면에서 요청을 다시 실행하세요.'.encode()


class ScreenKeyTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.httpd = ThreadingHTTPServer(('127.0.0.1', 0), server.Handler)
        cls.port = cls.httpd.server_port
        threading.Thread(target=cls.httpd.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.httpd.shutdown(); cls.httpd.server_close()

    def get(self, path, headers=None):
        connection = http.client.HTTPConnection('127.0.0.1', self.port, timeout=30)
        connection.request('GET', path, headers={'Host': f'127.0.0.1:{self.port}', **(headers or {})})
        response = connection.getresponse(); data = response.read(); connection.close()
        return response.status, dict(response.getheaders()), data

    def test_desktop_engine_keeps_unlocked_assets_behind_the_screen_key(self):
        forged = {'Sec-Fetch-Site': 'same-origin', 'Referer': f'http://127.0.0.1:{self.port}/'}
        with patch.object(server, 'SHELL_SECRET', 'shell-secret'):
            for path in sorted(server.PROTECTED_SCREEN_PATHS):
                for headers in ({}, forged, {'X-CAD-Screen': 'wrong'}):
                    status, _, data = self.get(path, headers)
                    self.assertEqual(status, 403, (path, headers)); self.assertIn(REJECTED, data)
                for key in (server.TOKEN, server.MCP_TOKEN):
                    status, _, data = self.get(path, {'X-CAD-Screen': key})
                    self.assertNotIn(REJECTED, data, path)
            # 서버 자산 목록·미리보기도 꾸민 같은 출처 표시만으로는 주지 않는다.
            status, _, data = self.get('/api/cad-asset/catalog', forged)
            self.assertEqual(status, 403); self.assertIn(REJECTED, data)
            status, _, data = self.get('/api/cad-asset/catalog', {**forged, 'X-CAD-Screen': server.TOKEN})
            self.assertNotIn(REJECTED, data)

    def test_browser_engine_is_unchanged(self):
        with patch.object(server, 'SHELL_SECRET', ''):
            status, _, data = self.get('/layer-knowledge-data.js')
        self.assertNotIn(REJECTED, data)

    def test_status_proves_the_keys_bound_to_the_port(self):
        challenge = 'c' * 32
        status, headers, _ = self.get('/api/status', {'X-CAD-Challenge': challenge})
        self.assertEqual(status, 200)
        answers = headers['X-CAD-Proof'].split(',')
        message = f'barun-cad-engine/v1|{self.port}|{challenge}'.encode()
        for key in (server.TOKEN, server.MCP_TOKEN):
            self.assertIn(hmac.new(key.encode(), message, hashlib.sha256).hexdigest(), answers)
        other = f'barun-cad-engine/v1|{self.port + 1}|{challenge}'.encode()
        self.assertNotIn(hmac.new(server.TOKEN.encode(), other, hashlib.sha256).hexdigest(), answers)
        self.assertNotIn(server.TOKEN, headers['X-CAD-Proof'])
        for bad in ('short', 'x' * 129, 'has space ' * 3):
            _, headers, _ = self.get('/api/status', {'X-CAD-Challenge': bad})
            self.assertNotIn('X-CAD-Proof', headers, bad)
        _, headers, _ = self.get('/api/status')
        self.assertNotIn('X-CAD-Proof', headers)


@unittest.skipIf(os.name == 'nt', 'Windows 는 사용자 폴더 권한을 따른다')
class ConnectionFileTest(unittest.TestCase):
    def test_connection_file_is_private(self):
        previous = server.CONNECTION_FILE
        with tempfile.TemporaryDirectory() as folder, patch.dict(os.environ, {'LOCALAPPDATA': folder}):
            try:
                target = server.write_connection_file(43210, 'http://127.0.0.1:43210', 'secret-token')
                self.assertEqual(stat.S_IMODE(target.stat().st_mode), 0o600)
                self.assertEqual(json.loads(target.read_text(encoding='utf8'))['token'], 'secret-token')
                # 예전 판이 넓은 권한으로 남긴 임시 파일도 좁혀 쓴다.
                temp = target.with_name(target.name + '.tmp'); temp.write_text('{}'); os.chmod(temp, 0o644)
                server.write_private_text(temp, '{}')
                self.assertEqual(stat.S_IMODE(temp.stat().st_mode), 0o600)
            finally:
                server.CONNECTION_FILE = previous


if __name__ == '__main__':
    unittest.main()
