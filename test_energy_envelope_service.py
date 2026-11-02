"""외피 자료 서버 저장·불러오기(energy_envelope_service) — 주소·토큰·오류 전달을 가짜 서버로 확인한다."""
import io
import json
import os
import unittest
import urllib.error

import energy_envelope_service as svc

SAMPLE = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'docs', 'energy-envelope-sample.json'), encoding='utf-8'))


class FakeResponse(io.BytesIO):
    def __enter__(self): return self
    def __exit__(self, *a): return False


class Opener:
    def __init__(self, status=200, body=None):
        self.calls = []; self.status = status; self.body = body or {}
    def __call__(self, req, timeout=None):
        self.calls.append((req.get_method(), req.full_url, req.get_header('Authorization'), req.data))
        payload = json.dumps(self.body).encode('utf-8')
        if self.status >= 400:
            raise urllib.error.HTTPError(req.full_url, self.status, 'x', {}, io.BytesIO(payload))
        return FakeResponse(payload)


class EnvelopeServiceTest(unittest.TestCase):
    def setUp(self):
        os.environ.pop('BARUN_CAD_ENERGY_URL', None)

    def test_save_posts_envelope_with_account_token(self):
        op = Opener(body={'id': 'a' * 22})
        self.assertEqual(svc.save(SAMPLE, project='에너지 샘플', token='t' * 64, opener=op)['id'], 'a' * 22)
        method, url, auth, data = op.calls[0]
        self.assertEqual((method, url, auth), ('POST', svc.DEFAULT_URL, 'Bearer ' + 't' * 64))
        self.assertEqual(json.loads(data)['envelope'], SAMPLE)

    def test_save_with_id_replaces(self):
        op = Opener(body={'id': 'b' * 22})
        svc.save(SAMPLE, id='b' * 22, token='t', opener=op)
        self.assertEqual(op.calls[0][:2], ('PUT', svc.DEFAULT_URL + '/' + 'b' * 22))

    def test_list_load_delete_urls_and_local_override(self):
        os.environ['BARUN_CAD_ENERGY_URL'] = 'http://localhost:3399'
        op = Opener(body={'items': [{'id': 'c' * 22}]})
        self.assertEqual(svc.listing('일 1', token='t', opener=op), [{'id': 'c' * 22}])
        self.assertEqual(op.calls[0][1], 'http://localhost:3399/api/public/cad-energy/envelopes?project=%EC%9D%BC+1')
        svc.load('c' * 22, token='t', opener=op); svc.delete('c' * 22, token='t', opener=op)
        self.assertEqual([c[0] for c in op.calls[1:]], ['GET', 'DELETE'])

    def test_rejects_before_sending(self):
        op = Opener()
        with self.assertRaises(svc.EnvelopeError): svc.save({'schema': 'x'}, token='t', opener=op)
        with self.assertRaises(svc.EnvelopeError): svc.load('../../etc', token='t', opener=op)
        with self.assertRaises(svc.EnvelopeError) as e: svc.listing(token='', opener=op)
        self.assertEqual(e.exception.status, 401)
        self.assertEqual(op.calls, [])

    def test_server_reason_is_passed_on(self):
        op = Opener(status=422, body={'error': 'floors[0].edges[1].segments[0]: 순 외벽 ≠ 외벽 − 개구부', 'code': 'BAD_ENVELOPE'})
        with self.assertRaises(svc.EnvelopeError) as e: svc.save(SAMPLE, token='t', opener=op)
        self.assertEqual((e.exception.status, e.exception.code), (422, 'BAD_ENVELOPE'))
        self.assertIn('순 외벽', str(e.exception))


if __name__ == '__main__':
    unittest.main()
