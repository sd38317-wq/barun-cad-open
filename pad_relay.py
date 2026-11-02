"""패드 원격 수정(1단계): 바른 CAD 화면 → barunarc.co.kr 공개 중계(/api/public/cad-pad).

서버에 CORS 가 없으므로 화면이 직접 부르지 않고 이 엔진(파이썬)이 대신 보낸다. 오가는 것은 암호문뿐이다(열쇠는 화면에만).
세션 만들기에만 바른 계정 토큰(Authorization: Bearer)을 붙인다 — 계정 연결과 같은 토큰 파일을 쓴다.
"""
import base64
import json
import re
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

import miri_account_service as account

PREFIX = '/api/public/cad-pad/sessions'
PATH = re.compile(r'(/[A-Za-z0-9_-]{22}(/ops(\?after=\d{1,9})?|/ready|/blobs(/[A-Za-z0-9_-]{22}(/ready)?)?)?)?')
# 큰 도면·현장 사진은 파일 창고(Tigris 서명 주소)와 바로 주고받는다. 이 주소 말고는 보내지 않는다.
STORE_ORIGIN = 'https://fly.storage.tigris.dev/'
MAX_STORE_PUT = 64 * 1024 * 1024
MAX_STORE_GET = 8 * 1024 * 1024


def store_transfer(data, opener=urlopen):
    """창고 서명 주소로 PUT(잠근 바이트, base64url) 또는 GET(돌려줄 때 base64url). 다른 주소는 거절한다."""
    url, kind = data.get('url'), data.get('store')
    if not isinstance(url, str) or not url.startswith(STORE_ORIGIN) or kind not in ('put', 'get'):
        raise ValueError('파일 창고 주소가 올바르지 않습니다.')
    body = None
    if kind == 'put':
        text = data.get('b64')
        if not isinstance(text, str) or not re.fullmatch(r'[A-Za-z0-9_-]+', text) or len(text) * 3 // 4 > MAX_STORE_PUT:
            raise ValueError('올릴 내용이 올바르지 않습니다.')
        body = base64.urlsafe_b64decode(text + '=' * (-len(text) % 4))
    request = Request(url, data=body, method='PUT' if kind == 'put' else 'GET', headers={'Content-Type': 'application/octet-stream'} if body else {})
    try:
        with opener(request, timeout=180) as response:
            status, raw = response.status, response.read(MAX_STORE_GET + 1) if kind == 'get' else b''
    except HTTPError as error:
        return {'status': error.code, 'data': {'error': f'파일 창고 오류({error.code})'}}
    except (URLError, TimeoutError, OSError):
        return {'status': 503, 'data': {'error': '파일 창고에 연결하지 못했습니다.', 'code': 'OFFLINE'}}
    if kind == 'get':
        if len(raw) > MAX_STORE_GET:
            return {'status': 413, 'data': {'error': '받을 파일이 너무 큽니다.'}}
        return {'status': status, 'data': {'b64': base64.urlsafe_b64encode(raw).decode().rstrip('=')}}
    return {'status': status, 'data': None}


def forward(data, opener=urlopen):
    if data.get('store'):
        return store_transfer(data, opener)
    method, path = data.get('method', 'GET'), data.get('path', '')
    if method not in ('GET', 'POST', 'DELETE') or not isinstance(path, str) or not PATH.fullmatch(path):
        raise ValueError('패드 중계 요청이 올바르지 않습니다.')
    headers = {'Accept': 'application/json'}
    body = None
    if data.get('body') is not None:
        body = json.dumps(data['body']).encode('utf-8')
        headers['Content-Type'] = 'application/json'
    if method == 'POST' and path == '':
        token = account._load_token()
        if not token:
            return {'status': 401, 'data': {'error': '[계정 연결]로 바른 계정에 로그인한 뒤 링크를 만들 수 있습니다.', 'code': 'LOGIN_REQUIRED'}}
        headers['Authorization'] = 'Bearer ' + token
    if data.get('token'):
        headers['x-pad-token'] = str(data['token'])[:256]
    request = Request(account.ORIGIN + PREFIX + path, data=body, method=method, headers=headers)
    try:
        with opener(request, timeout=90) as response:
            status, raw = response.status, response.read()
    except HTTPError as error:
        status, raw = error.code, error.read()
    except (URLError, TimeoutError, OSError):
        return {'status': 503, 'data': {'error': '바른 서버에 연결하지 못했습니다. 인터넷 연결을 확인하세요.', 'code': 'OFFLINE'}}
    try:
        parsed = json.loads(raw) if raw else None
    except ValueError:
        parsed = {'error': f'바른 서버 응답을 읽지 못했습니다({status}).'}
    return {'status': status, 'data': parsed}
