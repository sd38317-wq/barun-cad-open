"""바른 서버 계산(compute_service): 로그인 머리글·gzip 본문·다른 곳으로 넘기지 않기·오류를 쉬운 말로."""
import gzip
import io
import json
import os
import unittest
import urllib.error
from email.message import Message
from pathlib import Path

import compute_service


class Response(io.BytesIO):
    def __init__(self, body, encoding=None):
        super().__init__(gzip.compress(body) if encoding == 'gzip' else body)
        self.headers = Message()
        if encoding:
            self.headers['Content-Encoding'] = encoding

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False


class Opener:
    def __init__(self, reply):
        self.reply, self.requests = reply, []

    def open(self, request, timeout=None):
        self.requests.append(request)
        if isinstance(self.reply, Exception):
            raise self.reply
        return self.reply


def http_error(status, body):
    return urllib.error.HTTPError('https://barunarc.co.kr/api/public/cad-compute', status, 'x', Message(), io.BytesIO(json.dumps(body).encode()))


TOKEN = {'Authorization': 'Bearer abc', 'Cookie': 'legacy=1'}
REQUEST = {'action': 'walls.detect', 'input': {'document': {'units': 'mm', 'layers': [], 'entities': []}}}


class ComputeServiceTest(unittest.TestCase):
    def test_sends_gzip_body_with_account_token_only(self):
        opener = Opener(Response(json.dumps({'state': 'ok', 'result': {'walls': []}}).encode(), 'gzip'))
        result, status = compute_service.process(REQUEST, lambda: TOKEN, opener)
        self.assertEqual((result, status), ({'state': 'ok', 'result': {'walls': []}}, 200))
        sent = opener.requests[0]
        self.assertEqual(sent.full_url, compute_service.DEFAULT_URL)
        self.assertEqual(sent.get_header('Authorization'), 'Bearer abc')
        self.assertIsNone(sent.get_header('Cookie'), '예전 쿠키는 바른 서버 계산에 보내지 않는다')
        self.assertEqual(sent.get_header('Content-encoding'), 'gzip')
        self.assertEqual(json.loads(gzip.decompress(sent.data)), REQUEST)

    def test_not_logged_in_never_calls_server(self):
        opener = Opener(AssertionError('불리면 안 됨'))
        result, status = compute_service.process(REQUEST, lambda: {'Cookie': 'legacy=1'}, opener)
        self.assertEqual(status, 401)
        self.assertEqual(result['code'], 'not_logged_in')
        self.assertIn('[계정 연결]', result['error'])
        self.assertEqual(opener.requests, [])

    def test_rejects_unknown_action_and_shape(self):
        for bad in ({'action': 'nope', 'input': {}}, {'action': 'walls.detect', 'input': []}, {'action': 'walls.detect', 'input': {}, 'x': 1}, []):
            result, status = compute_service.process(bad, lambda: TOKEN, Opener(AssertionError()))
            self.assertEqual((status, result['code']), (400, 'bad_input'))

    def test_server_errors_become_plain_korean(self):
        cases = [(401, {}, 'not_logged_in', 401), (403, {}, 'blocked', 403), (413, {}, 'too_large', 413), (429, {}, 'limit', 429),
                 (400, {'field': 'input.document'}, 'bad_input', 400), (503, {}, 'busy', 503), (504, {}, 'timeout', 504), (500, {}, 'offline', 502)]
        for remote, body, code, local in cases:
            result, status = compute_service.process(REQUEST, lambda: TOKEN, Opener(http_error(remote, body)))
            self.assertEqual((result['code'], status), (code, local), remote)
        result, _ = compute_service.process(REQUEST, lambda: TOKEN, Opener(http_error(422, {'message': '벽 탐지는 mm 도면에서 실행하세요.'})))
        self.assertEqual(result['error'], '벽 탐지는 mm 도면에서 실행하세요.', '계산 코드가 일부러 낸 안내는 그대로')
        result, status = compute_service.process(REQUEST, lambda: TOKEN, Opener(OSError('down')))
        self.assertEqual((result['code'], status), ('offline', 502))
        result, _ = compute_service.process(REQUEST, lambda: TOKEN, Opener(Response(b'{"state":"failed"}')))
        self.assertEqual(result['code'], 'offline')

    def test_too_large_is_refused_before_sending(self):
        big = {'action': 'walls.detect', 'input': {'document': {'entities': [], 'noise': os.urandom(compute_service.MAX_REQUEST_BYTES).hex()}}}
        opener = Opener(AssertionError())
        result, status = compute_service.process(big, lambda: TOKEN, opener)
        self.assertEqual((status, result['code'], opener.requests), (413, 'too_large', []))

    def test_redirects_are_not_followed(self):
        handler = compute_service._NoRedirect()
        self.assertIsNone(handler.redirect_request(None, None, 302, 'Found', {}, 'https://evil.example/'))

    def test_route_and_url_override(self):
        source = Path(__file__).with_name('server.py').read_text(encoding='utf-8')
        self.assertIn("if self.path=='/api/compute':", source)

        saved = os.environ.get('BARUN_CAD_COMPUTE_URL')
        try:
            os.environ['BARUN_CAD_COMPUTE_URL'] = 'http://127.0.0.1:3999'
            self.assertEqual(compute_service._url(), 'http://127.0.0.1:3999/api/public/cad-compute')
        finally:
            if saved is None:
                os.environ.pop('BARUN_CAD_COMPUTE_URL', None)
            else:
                os.environ['BARUN_CAD_COMPUTE_URL'] = saved


if __name__ == '__main__':
    unittest.main()
