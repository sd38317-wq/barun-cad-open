"""인동거리 검토 중계: CAD 화면 → (계정 토큰) → barunarc.co.kr 설계 엔진.
규칙·면 구분·계산은 서버(설계 엔진)에만 있다. 로그인(계정 연결) 안 되어 있으면 쓰지 못한다."""
import json
import math
import os
import urllib.error
import urllib.request
from http.client import HTTPException

DEFAULT_URL = 'https://barunarc.co.kr/api/public/cad-indong'
MAX_BUILDINGS, MAX_HULL, MAX_RESPONSE = 200, 2000, 8 * 1024 * 1024
MESSAGES = {
    'not_logged_in': (401, '로그인 필요 · [계정 연결]로 로그인한 뒤 인동 검토를 쓸 수 있습니다.'),
    'not_ready': (404, '인동 검토 서버가 아직 열리지 않았습니다(준비 중).'),
    'offline': (503, '인동 검토 서버에 연결하지 못했습니다. 인터넷 연결을 확인하세요.'),
    'bad_reply': (502, '인동 검토 서버 응답 형식이 올바르지 않습니다.'),
}


class IndongError(ValueError):
    def __init__(self, code):
        self.status, self.message = MESSAGES[code]
        self.code = code
        super().__init__(self.message)

    def response(self):
        return {'code': self.code, 'error': self.message, 'message': self.message}


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    # 리다이렉트로 계정 토큰이 다른 곳에 가지 않게 한다.
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def _token():
    from miri_account_service import _load_token
    return _load_token()


def _num(v):
    return isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)


def validate_request(data):
    if not isinstance(data, dict) or not isinstance(data.get('buildings'), list):
        raise ValueError('인동 검토 요청 형식이 올바르지 않습니다.')
    if not (_num(data.get('floors_default')) and data['floors_default'] > 0 and _num(data.get('floor_height_m')) and data['floor_height_m'] > 0):
        raise ValueError('층수와 층고는 0보다 커야 합니다.')
    if not 0 < len(data['buildings']) <= MAX_BUILDINGS:
        raise ValueError(f'주동은 1~{MAX_BUILDINGS}개까지 검토합니다.')
    for b in data['buildings']:
        hull = b.get('hull') if isinstance(b, dict) else None
        if not isinstance(b.get('jutong_id'), str) or not isinstance(hull, list) or not 3 <= len(hull) <= MAX_HULL:
            raise ValueError('주동 외곽 정보가 올바르지 않습니다.')
        if not all(isinstance(p, list) and len(p) == 2 and _num(p[0]) and _num(p[1]) for p in hull):
            raise ValueError('주동 외곽 좌표가 올바르지 않습니다.')
        if b.get('floors') is not None and not (_num(b['floors']) and b['floors'] > 0):
            raise ValueError('층수는 0보다 커야 합니다.')
    return data


def process(data, token_reader=None, opener=None, timeout=30):
    validate_request(data)
    token = (token_reader or _token)()
    if not token:
        raise IndongError('not_logged_in')
    url = os.environ.get('BARUN_INDONG_URL', DEFAULT_URL)
    request = urllib.request.Request(url, data=json.dumps(data).encode('utf-8'), method='POST',
                                     headers={'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json'})
    try:
        with (opener or urllib.request.build_opener(_NoRedirect())).open(request, timeout=timeout) as response:
            raw = response.read(MAX_RESPONSE + 1)
    except urllib.error.HTTPError as error:
        raise IndongError({401: 'not_logged_in', 404: 'not_ready'}.get(error.code, 'offline')) from None
    except (OSError, urllib.error.URLError, HTTPException):
        raise IndongError('offline') from None
    try:
        if len(raw) > MAX_RESPONSE:
            raise ValueError
        value = json.loads(raw)
        if not isinstance(value, dict) or not isinstance(value.get('marks'), list):
            raise ValueError
    except ValueError:
        raise IndongError('bad_reply') from None
    return value
