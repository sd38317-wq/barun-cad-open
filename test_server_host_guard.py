"""The loopback server answers only requests addressed to its own loopback name (DNS rebinding guard)."""
import http.client
import threading
import unittest
from http.server import ThreadingHTTPServer

import server


class HostGuardTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.httpd = ThreadingHTTPServer(('127.0.0.1', 0), server.Handler)
        cls.port = cls.httpd.server_port
        threading.Thread(target=cls.httpd.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.httpd.shutdown(); cls.httpd.server_close()

    def request(self, method, path, host, headers=None, body=None):
        connection = http.client.HTTPConnection('127.0.0.1', self.port, timeout=10)
        connection.putrequest(method, path, skip_host=True)
        connection.putheader('Host', host)
        for key, value in (headers or {}).items(): connection.putheader(key, value)
        if body is not None: connection.putheader('Content-Length', str(len(body)))
        connection.endheaders(body)
        response = connection.getresponse(); data = response.read(); connection.close()
        return response.status, data

    def test_a_rebound_host_name_gets_no_token_and_no_assets(self):
        for path in ('/api/status', '/', '/app.js'):
            status, data = self.request('GET', path, f'attacker.example:{self.port}')
            self.assertEqual(status, 421, path); self.assertNotIn(server.TOKEN.encode(), data)

    def test_the_loopback_names_are_served(self):
        for host in (f'127.0.0.1:{self.port}', f'localhost:{self.port}'):
            status, data = self.request('GET', '/api/status', host)
            self.assertEqual(status, 200, host)

    def test_the_desktop_engine_does_not_hand_out_its_token(self):
        import json
        from unittest.mock import patch
        with patch.object(server, 'SHELL_SECRET', 'shell-secret'):
            status, data = self.request('GET', '/api/status', f'127.0.0.1:{self.port}')
        self.assertEqual(status, 200); self.assertNotIn(server.TOKEN.encode(), data)
        self.assertEqual(json.loads(data)['tokenPolicy'], 'desktop')
        with patch.object(server, 'SHELL_SECRET', ''):
            status, data = self.request('GET', '/api/status', f'127.0.0.1:{self.port}')
        self.assertEqual(json.loads(data)['token'], server.TOKEN)   # 브라우저·개발 실행은 예전처럼

    def test_image_get_needs_the_browser_same_origin_mark(self):
        host = f'127.0.0.1:{self.port}'
        for headers in ({}, {'Referer': f'http://{host}/'}, {'Sec-Fetch-Site': 'cross-site'}):
            status, _ = self.request('GET', '/api/design-cases/image?id=x&token=' + server.TOKEN, host, headers)
            self.assertEqual(status, 403, headers)

    def test_energy_standards_use_protected_vault_knowledge(self):
        import json
        from unittest.mock import patch
        import vault_gate
        host = f'127.0.0.1:{self.port}'
        expected = json.loads((server.ROOT/'rules/knowledge/energy_envelope_standards.json').read_text(encoding='utf-8'))
        with patch.object(server.Handler, 'screen_key_ok', return_value=False):
            self.assertEqual(self.request('GET', '/energy-envelope-standards.json', host)[0], 403)
        with patch.object(server.Handler, 'screen_key_ok', return_value=True), patch.object(vault_gate, 'knowledge', return_value=json.dumps(expected).encode()) as read:
            status, data = self.request('GET', '/energy-envelope-standards.json', host)
            self.assertEqual(status, 200); self.assertEqual(json.loads(data), expected)
            read.assert_called_once_with('energy_envelope_standards.json')
        with patch.object(server.Handler, 'screen_key_ok', return_value=True), patch.object(vault_gate, 'knowledge', side_effect=ValueError('locked')):
            self.assertEqual(self.request('GET', '/energy-envelope-standards.json', host)[0], 403)

    def test_energy_plan_standards_use_protected_vault_knowledge(self):
        import json
        from unittest.mock import patch
        import vault_gate
        host = f'127.0.0.1:{self.port}'
        expected = json.loads((server.ROOT/'rules/knowledge/energy_saving_plan_standards.json').read_text(encoding='utf-8'))
        with patch.object(server.Handler, 'screen_key_ok', return_value=False):
            self.assertEqual(self.request('GET', '/energy-plan-standards.json', host)[0], 403)
        with patch.object(server.Handler, 'screen_key_ok', return_value=True), patch.object(vault_gate, 'knowledge', return_value=json.dumps(expected).encode()) as read:
            status, data = self.request('GET', '/energy-plan-standards.json', host)
            self.assertEqual(status, 200); self.assertEqual(json.loads(data), expected)
            read.assert_called_once_with('energy_saving_plan_standards.json')

    def test_posts_need_the_token_compared_in_constant_time(self):
        origin = f'http://127.0.0.1:{self.port}'
        status, _ = self.request('POST', '/api/shutdown', f'127.0.0.1:{self.port}', {'Origin': origin, 'X-CAD-Token': 'wrong', 'Content-Type': 'application/json'}, b'{}')
        self.assertEqual(status, 403)
        status, _ = self.request('POST', '/api/shutdown', f'127.0.0.1:{self.port}', {'Origin': origin, 'Content-Type': 'application/json'}, b'{}')
        self.assertEqual(status, 403)


if __name__ == '__main__':
    unittest.main()
