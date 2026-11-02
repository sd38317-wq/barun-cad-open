"""패드 원격 수정 중계: 설치본용 barunarc.co.kr 전달(pad_relay)과 개발용 모의 중계(pad_relay_mock)."""
import io
import json
import unittest
from unittest.mock import patch
from urllib.error import HTTPError

import pad_relay
import pad_relay_mock as mock

ID = 'A' * 22


class FakeResponse(io.BytesIO):
    def __init__(self, status, body):
        super().__init__(json.dumps(body).encode())
        self.status = status

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False


class ForwardTest(unittest.TestCase):
    def capture(self, status=200, body=None):
        seen = []

        def opener(request, timeout):
            seen.append(request)
            return FakeResponse(status, body if body is not None else {'ok': True})
        return seen, opener

    def test_only_create_carries_account_token(self):
        seen, opener = self.capture(201, {'id': ID, 'ownerToken': 'o'})
        with patch.object(pad_relay.account, '_load_token', return_value='f' * 64):
            result = pad_relay.forward({'method': 'POST', 'path': '', 'body': {'id': ID}}, opener)
            pad_relay.forward({'method': 'GET', 'path': f'/{ID}/ops?after=3', 'token': 'owner-token-123456'}, opener)
        self.assertEqual(result, {'status': 201, 'data': {'id': ID, 'ownerToken': 'o'}})
        self.assertEqual(seen[0].full_url, 'https://barunarc.co.kr/api/public/cad-pad/sessions')
        self.assertEqual(seen[0].get_header('Authorization'), 'Bearer ' + 'f' * 64)
        self.assertIsNone(seen[1].get_header('Authorization'))
        self.assertEqual(seen[1].get_header('X-pad-token'), 'owner-token-123456')

    def test_create_without_login_is_refused_locally(self):
        seen, opener = self.capture()
        with patch.object(pad_relay.account, '_load_token', return_value=None):
            result = pad_relay.forward({'method': 'POST', 'path': '', 'body': {}}, opener)
        self.assertEqual(result['status'], 401)
        self.assertEqual(seen, [])

    def test_rejects_other_paths_and_maps_http_errors(self):
        for bad in ({'method': 'PUT', 'path': ''}, {'method': 'GET', 'path': '/../admin'}, {'method': 'GET', 'path': f'/{ID}/x'}):
            with self.assertRaises(ValueError):
                pad_relay.forward(bad, lambda *a, **k: None)

        def failing(request, timeout):
            raise HTTPError(request.full_url, 404, 'nf', {}, io.BytesIO(b'{"error":"gone","code":"NOT_FOUND"}'))
        self.assertEqual(pad_relay.forward({'method': 'GET', 'path': f'/{ID}'}, failing), {'status': 404, 'data': {'error': 'gone', 'code': 'NOT_FOUND'}})


class MockRelayTest(unittest.TestCase):
    def setUp(self):
        mock._sessions.clear()

    def test_session_ops_and_revoke_follow_the_protocol(self):
        status, created = mock.create({'id': ID, 'ciphertext': 'AAAA', 'expiresInHours': 24, 'writeTokenHash': mock._sha('write-token')})
        self.assertEqual(status, 201)
        self.assertEqual(mock.create({'id': ID, 'ciphertext': 'AAAA', 'expiresInHours': 24, 'writeTokenHash': mock._sha('x')})[0], 409)
        self.assertEqual(mock._route('POST', [ID, 'ops'], {'writeToken': 'wrong', 'ciphertext': 'AA'}, '', '')[0], 403)
        self.assertEqual(mock._route('POST', [ID, 'ops'], {'writeToken': 'write-token', 'ciphertext': 'AA'}, '', ''), (201, {'seq': 1}))
        self.assertEqual(mock._route('POST', [ID, 'ops'], {'writeToken': 'write-token', 'ciphertext': 'BB'}, '', ''), (201, {'seq': 2}))
        status, page = mock._route('GET', [ID, 'ops'], {}, 'after=1', 'write-token')
        self.assertEqual([op['seq'] for op in page['ops']], [2])
        self.assertEqual(mock._route('DELETE', [ID], {}, '', 'write-token')[0], 403)
        self.assertEqual(mock._route('DELETE', [ID], {}, '', created['ownerToken'])[0], 204)
        self.assertEqual(mock._route('GET', [ID], {}, '', '')[0], 404)


if __name__ == '__main__':
    unittest.main()
