import io
import json
import unittest
import urllib.error

import indong_relay as R

REQ = {'version': 1, 'floors_default': 20, 'floor_height_m': 2.9,
       'buildings': [{'ref': 'a', 'jutong_id': 'JT-1', 'floors': None, 'hull': [[0, 0], [1, 0], [0, 1]]}]}


class _Resp(io.BytesIO):
    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


class _Opener:
    def __init__(self, body=None, code=None):
        self.body, self.code, self.seen = body, code, None

    def open(self, request, timeout=None):
        self.seen = request
        if self.code:
            raise urllib.error.HTTPError(request.full_url, self.code, 'x', {}, None)
        return _Resp(json.dumps(self.body).encode())


class RelayTest(unittest.TestCase):
    def test_login_required(self):
        with self.assertRaises(R.IndongError) as c:
            R.process(REQ, token_reader=lambda: '')
        self.assertEqual(c.exception.status, 401)

    def test_sends_bearer_and_returns_marks(self):
        op = _Opener({'status': 'ok', 'marks': [{'type': 'line', 'from': [0, 0], 'to': [1, 1], 'ok': True}]})
        r = R.process(REQ, token_reader=lambda: 'tok', opener=op)
        self.assertEqual(r['marks'][0]['type'], 'line')
        self.assertEqual(op.seen.get_header('Authorization'), 'Bearer tok')
        self.assertEqual(json.loads(op.seen.data)['buildings'][0]['jutong_id'], 'JT-1')

    def test_server_codes(self):
        for code, status in ((401, 401), (404, 404), (500, 503)):
            with self.assertRaises(R.IndongError) as c:
                R.process(REQ, token_reader=lambda: 'tok', opener=_Opener(code=code))
            self.assertEqual(c.exception.status, status)
        with self.assertRaises(R.IndongError) as c:
            R.process(REQ, token_reader=lambda: 'tok', opener=_Opener({'nope': 1}))
        self.assertEqual(c.exception.code, 'bad_reply')

    def test_rejects_bad_input_before_network(self):
        for bad in ({}, {**REQ, 'floors_default': 0}, {**REQ, 'buildings': [{'jutong_id': 'x', 'hull': [[0, 0]]}]},
                    {**REQ, 'buildings': [{'jutong_id': 'x', 'hull': [[0, 0], [1, 'a'], [2, 2]]}]}):
            with self.assertRaises(ValueError):
                R.process(bad, token_reader=lambda: 'tok', opener=_Opener(code=500))


if __name__ == '__main__':
    unittest.main()
