"""바른 서버 계산 — 평면 인식·벽 찾기·창호 계획·구조 평면 읽기·구조계산서·배치 품질(사장님 2026-10-21).

계산 코드는 설치본에 없다(바른 CAD 저장소 compute/ 는 서버 묶음으로만 간다). 화면(compute-client.js)이
/api/compute 로 보낸 {action, input} 을 [계정 연결] 로그인 머리글(parcel_service.auth_headers)과 함께
POST /api/public/cad-compute 로 넘기고 결과만 돌려준다. 본문은 gzip 으로 줄여 보낸다(도면 JSON 은 8~10배 줄어든다).
"""
import gzip
import json
import os
import urllib.error
import urllib.request
import zlib
from http.client import HTTPException

import parcel_service

DEFAULT_URL = 'https://barunarc.co.kr/api/public/cad-compute'
ACTIONS = frozenset({'walls.detect', 'plan.toModel', 'plan.officeFloors', 'plan.officeViews', 'plan.traceWalls',
                     'plan.foreignRead', 'electrical.layout', 'electrical.review',
                     'structure.readPlan', 'structure.calcReport', 'openings.suggest', 'openings.daylight', 'openings.prepare', 'plan.quality'})
MAX_REQUEST_BYTES = 24 * 1024 * 1024        # 서버로 보내는 gzip 본문 상한(서버 창구와 같다)
MAX_RESPONSE_BYTES = 64 * 1024 * 1024
TIMEOUT_SECONDS = 90

LOGIN_GUIDE = ('로그인 필요 · 오른쪽 위 [계정 연결]에서 카카오(또는 구글)로 로그인하면 평면 인식·창호 계획·구조 계산서·'
               '배치 품질 검사를 쓸 수 있습니다(무료).')
MESSAGES = {
    'not_logged_in': LOGIN_GUIDE,
    'blocked': '이 계정은 서버 계산을 쓸 수 없습니다. 바른 고객센터에 문의하세요.',
    'limit': '오늘 서버 계산 횟수를 다 썼습니다. 내일 다시 시도하세요.',
    'too_large': '도면이 너무 커서 서버로 보낼 수 없습니다. 필요한 평면만 고르거나 도면을 나눠 다시 실행하세요.',
    'bad_input': '서버 계산 입력이 올바르지 않습니다.',
    'cannot_compute': '바른 서버가 이 도면을 계산하지 못했습니다.',
    'busy': '바른 서버가 다른 계산으로 바쁩니다. 잠시 후 다시 시도하세요.',
    'timeout': '계산이 너무 오래 걸려 바른 서버가 멈췄습니다. 필요한 평면만 골라 다시 실행하세요.',
    'offline': '바른 서버에 연결하지 못했습니다. 인터넷 연결을 확인하고 다시 시도하세요.',
}
STATUS = {401: 'not_logged_in', 403: 'blocked', 413: 'too_large', 429: 'limit', 400: 'bad_input', 422: 'cannot_compute', 503: 'busy', 504: 'timeout'}
HTTP_OF = {'not_logged_in': 401, 'blocked': 403, 'too_large': 413, 'limit': 429, 'bad_input': 400, 'cannot_compute': 422, 'busy': 503, 'timeout': 504, 'offline': 502}


def _url():
    value = os.environ.get('BARUN_CAD_COMPUTE_URL', DEFAULT_URL).rstrip('/')
    return value if value.endswith('/cad-compute') else value + '/api/public/cad-compute'


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    # 다른 곳으로 넘기면 계정 토큰이 따라가지 않게 멈춘다.
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


_opener = urllib.request.build_opener(_NoRedirect)


def failure(code, detail=None):
    message = MESSAGES[code]
    # 계산 코드가 일부러 낸 안내(예: '벽 탐지는 mm 도면에서 실행하세요.')는 그대로 보인다.
    if detail and code in ('cannot_compute', 'bad_input'):
        message = str(detail)[:500] if code == 'cannot_compute' else message + f' ({str(detail)[:200]})'
    return {'state': 'failed', 'code': code, 'error': message}, HTTP_OF[code]


def _read(response):
    raw = response.read(MAX_RESPONSE_BYTES + 1)
    if 'gzip' in (response.headers.get('Content-Encoding') or '').lower():
        decompressor = zlib.decompressobj(16 + 15)
        raw = decompressor.decompress(raw, MAX_RESPONSE_BYTES + 1)
    if len(raw) > MAX_RESPONSE_BYTES:
        raise ValueError('too large')
    return raw


def process(data, headers_reader=None, opener=None):
    """화면 요청 {action, input} → ({state:'ok', result} | {state:'failed', code, error}, HTTP 상태)."""
    if not isinstance(data, dict) or set(data) - {'action', 'input'} or data.get('action') not in ACTIONS or not isinstance(data.get('input'), dict):
        return failure('bad_input')
    headers = (headers_reader or parcel_service.auth_headers)()
    if 'Authorization' not in headers:
        return failure('not_logged_in')
    body = gzip.compress(json.dumps({'action': data['action'], 'input': data['input']}, ensure_ascii=False, separators=(',', ':')).encode('utf-8'), 6)
    if len(body) > MAX_REQUEST_BYTES:
        return failure('too_large')
    request = urllib.request.Request(_url(), data=body, method='POST', headers={
        'Authorization': headers['Authorization'], 'Content-Type': 'application/json', 'Content-Encoding': 'gzip',
        'Accept-Encoding': 'gzip', 'User-Agent': 'BarunCAD/compute'})
    try:
        with (opener or _opener).open(request, timeout=TIMEOUT_SECONDS) as response:
            raw = _read(response)
    except urllib.error.HTTPError as error:
        try:
            detail = json.loads(error.read(65536) or b'{}')
        except ValueError:
            detail = {}
        code = STATUS.get(error.code, 'offline')
        return failure(code, detail.get('message') if code == 'cannot_compute' else detail.get('field'))
    except (OSError, ValueError, urllib.error.URLError, HTTPException):
        return failure('offline')
    try:
        value = json.loads(raw)
    except ValueError:
        return failure('offline')
    if not isinstance(value, dict) or value.get('state') != 'ok' or 'result' not in value:
        return failure('offline')
    return {'state': 'ok', 'result': value['result']}, 200
