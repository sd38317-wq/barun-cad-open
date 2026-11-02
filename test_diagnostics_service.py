import json, os, tempfile, unittest
from pathlib import Path
import diagnostics_service as D


class DiagnosticsTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.old = os.environ.get('PROGRAMDATA')
        os.environ['PROGRAMDATA'] = self.tmp.name
        self.path = Path(self.tmp.name) / 'Barun' / 'CAD6Quality' / 'last-install-check.json'
        self.path.parent.mkdir(parents=True)
        envelope = {'candidate': {'version': '7.0.17'}, 'report': {'status': 'failed', 'version': '7.0.17', 'errors': ['GPU renderer did not become active'],
                    'checks': [{'id': 'GPU_TEXT_VIEWPORT_BUDGET', 'status': 'failed', 'error': 'GPU 없음'}, {'id': 'FILLET_RADIUS', 'status': 'passed'}],
                    'gateError': {'code': 'RUNTIME_FAILED', 'message': 'Isolated runtime verification failed'}}, 'path': r'C:\Users\홍길동\도면.dwg'}
        self.path.write_text(json.dumps(envelope, ensure_ascii=False), encoding='utf-8')

    def tearDown(self):
        if self.old is None: os.environ.pop('PROGRAMDATA', None)
        else: os.environ['PROGRAMDATA'] = self.old
        self.tmp.cleanup()

    def test_sends_once_when_logged_in_and_only_failed_checks(self):
        sent = []
        post = lambda url, body, token: (sent.append(json.loads(body)), 200)[1]
        self.assertEqual(D.send_pending(token='', post=post), 0, '로그인 없으면 안 보냄')
        self.assertEqual(D.send_pending(token='t' * 64, post=post), 1)
        self.assertEqual(D.send_pending(token='t' * 64, post=post), 0, '같은 기록은 한 번만')
        body = sent[0]
        self.assertEqual(body['kind'], 'install-check'); self.assertEqual(body['appVersion'], '7.0.17')
        self.assertEqual([c['id'] for c in body['checks']], ['GPU_TEXT_VIEWPORT_BUDGET'])
        self.assertNotIn('도면.dwg', json.dumps(body, ensure_ascii=False), '경로 같은 개인 내용은 보내지 않음')

    def test_failed_post_retries_later(self):
        self.assertEqual(D.send_pending(token='t' * 64, post=lambda *a: 503), 0)
        self.assertEqual(D.send_pending(token='t' * 64, post=lambda *a: 200), 1)


if __name__ == '__main__':
    unittest.main()
