"""패드 원격 수정(1단계) 로컬 모의 중계 — barunarc.co.kr 의 /api/public/cad-pad 규약과 같게 메모리에서만 흉내 낸다.

개발·시험 전용: 환경변수 BARUN_PAD_MOCK=1 일 때만 server.py 가 연결한다(설치본에서는 꺼져 있다).
서버처럼 암호문만 다루고 풀지 않는다. 프로세스를 끄면 모두 사라진다.
"""
import base64
import hashlib
import hmac
import json
import os
import re
import secrets
import threading
import time
from datetime import datetime, timezone
from pathlib import Path

PREFIX = '/api/public/cad-pad/sessions'
ID = re.compile(r'^[A-Za-z0-9_-]{22}$')
HEX64 = re.compile(r'^[0-9a-f]{64}$')
MAX_DRAWING = 12 * 1024 * 1024
MAX_OPS_BYTES = 64 * 1024
MAX_BATCHES = 500
PAGE = 100
ROOT = Path(__file__).resolve().parent

_lock = threading.Lock()
_sessions = {}
_store = {}  # 모의 창고: 키 → 바이트(서버의 Tigris 흉내)
STORE_PREFIX = '/__mock-store/'
MAX_STORED = 64 * 1024 * 1024
MAX_PHOTO = 6 * 1024 * 1024


def enabled():
    return os.environ.get('BARUN_PAD_MOCK') == '1'


def _sha(text):
    return hashlib.sha256(text.encode()).hexdigest()


def _iso(seconds):
    return datetime.fromtimestamp(seconds, timezone.utc).isoformat().replace('+00:00', 'Z')


def _decoded_size(text):
    if not isinstance(text, str) or not re.fullmatch(r'[A-Za-z0-9_-]+', text):
        raise ValueError('암호문 형식이 올바르지 않습니다.')
    return len(text) * 3 // 4


def _live(session_id):
    session = _sessions.get(session_id)
    if session and session['expires'] <= time.time():
        _sessions.pop(session_id, None)
        return None
    return session


def _token_ok(session, token, owner_only=False):
    digest = _sha(token or '')
    if hmac.compare_digest(digest, session['owner_hash']):
        return True
    return not owner_only and hmac.compare_digest(digest, session['write_hash'])


def _hex_sha(data):
    return hashlib.sha256(data).hexdigest()


def _stored_ok(key, size, digest):
    data = _store.get(key)
    if data is None:
        return 409, {'error': '창고에 파일이 아직 없습니다.', 'code': 'NOT_UPLOADED'}
    if len(data) != size or _hex_sha(data) != digest:
        _store.pop(key, None)
        return 409, {'error': '올라간 파일의 크기·지문이 다릅니다.', 'code': 'MISMATCH'}
    return None


def create(body):
    session_id, ciphertext = body.get('id'), body.get('ciphertext')
    if not isinstance(session_id, str) or not ID.match(session_id):
        return 400, {'error': '세션 ID 형식이 올바르지 않습니다.'}
    if not isinstance(body.get('writeTokenHash'), str) or not HEX64.match(body['writeTokenHash']):
        return 400, {'error': '쓰기 토큰 해시 형식이 올바르지 않습니다.'}
    hours = body.get('expiresInHours', 24)
    if not isinstance(hours, int) or not 1 <= hours <= 168:
        return 400, {'error': '기간은 1~168시간입니다.'}
    stored = body.get('storage') is True
    if stored:
        size, digest = body.get('bytes'), body.get('sha256')
        if not isinstance(size, int) or not 28 <= size <= MAX_STORED:
            return 413, {'error': '도면이 너무 큽니다(64MB까지).', 'code': 'TOO_LARGE'}
        if not isinstance(digest, str) or not HEX64.match(digest):
            return 400, {'error': 'sha256 형식이 올바르지 않습니다.'}
    else:
        try:
            if _decoded_size(ciphertext) > MAX_DRAWING:
                return 413, {'error': '도면이 12MB 를 넘습니다. 지금 화면 범위로 보내세요.'}
        except ValueError as error:
            return 400, {'error': str(error)}
    owner = base64.urlsafe_b64encode(secrets.token_bytes(32)).decode().rstrip('=')
    now = time.time()
    with _lock:
        if _live(session_id):
            return 409, {'error': '이미 있는 세션 ID 입니다.'}
        _sessions[session_id] = {'ciphertext': None if stored else ciphertext, 'write_hash': body['writeTokenHash'], 'owner_hash': _sha(owner),
                                 'created': now, 'expires': now + hours * 3600, 'ops': [], 'blobs': {},
                                 **({'key': f'cad-pad/{session_id}/drawing.bin', 'size': body['bytes'], 'sha256': body['sha256'], 'ready': False} if stored else {})}
    out = {'id': session_id, 'ownerToken': owner, 'expiresAt': _iso(now + hours * 3600)}
    if stored:
        out['uploadUrl'] = STORE_PREFIX + f'cad-pad/{session_id}/drawing.bin'
    return 201, out


def handle(handler, method):
    """server.py 핸들러에서 부른다. 처리했으면 True."""
    path = handler.path.split('?', 1)[0]
    query = handler.path.split('?', 1)[1] if '?' in handler.path else ''
    if method == 'GET' and re.fullmatch(r'/p/[A-Za-z0-9_-]{22}/?', path):
        body = (ROOT / 'pad.html').read_bytes()
        handler.send_response(200)
        handler.send_header('Content-Type', 'text/html; charset=utf-8')
        handler.send_header('Cache-Control', 'no-store')
        handler.send_header('Content-Length', str(len(body)))
        handler.end_headers()
        handler.wfile.write(body)
        return True
    if path.startswith(STORE_PREFIX):
        key = path[len(STORE_PREFIX):]
        if method == 'PUT':
            size = int(handler.headers.get('Content-Length', '0') or 0)
            if size <= 0 or size > MAX_STORED:
                handler.json_response({'error': '크기가 올바르지 않습니다.'}, 413)
                return True
            _store[key] = handler.rfile.read(size)
            handler.send_response(200)
            handler.send_header('Content-Length', '0')
            handler.end_headers()
            return True
        if method == 'GET' and key in _store:
            data = _store[key]
            handler.send_response(200)
            handler.send_header('Content-Type', 'application/octet-stream')
            handler.send_header('Content-Length', str(len(data)))
            handler.end_headers()
            handler.wfile.write(data)
            return True
        handler.json_response({'error': '창고에 없는 파일입니다.'}, 404)
        return True
    if not path.startswith(PREFIX):
        return False
    rest = path[len(PREFIX):].strip('/').split('/') if path != PREFIX else []
    body = {}
    if method == 'POST':
        size = int(handler.headers.get('Content-Length', '0') or 0)
        if size <= 0 or size > MAX_DRAWING * 2:
            handler.json_response({'error': '요청 크기가 올바르지 않습니다.'}, 413)
            return True
        try:
            body = json.loads(handler.rfile.read(size))
        except ValueError:
            handler.json_response({'error': 'JSON 형식이 아닙니다.'}, 400)
            return True
    status, data = _route(method, rest, body, query, handler.headers.get('x-pad-token', ''))
    if status == 204:
        handler.send_response(204)
        handler.send_header('Content-Length', '0')
        handler.end_headers()
    else:
        handler.json_response(data, status)
    return True


def _route(method, rest, body, query, token):
    if method == 'POST' and not rest:
        return create(body)
    if not rest or not ID.match(rest[0]):
        return 404, {'error': '없는 세션입니다.'}
    with _lock:
        session = _live(rest[0])
        if not session:
            return 404, {'error': '세션이 끝났거나 회수되었습니다.'}
        if len(rest) == 1 and method == 'GET':
            if session['ciphertext'] is None:
                if not session.get('ready'):
                    return 404, {'error': '아직 올리는 중입니다.'}
                return 200, {'downloadUrl': STORE_PREFIX + session['key'], 'bytes': session['size'], 'sha256': session['sha256'],
                             'expiresAt': _iso(session['expires']), 'createdAt': _iso(session['created'])}
            return 200, {'ciphertext': session['ciphertext'], 'expiresAt': _iso(session['expires']), 'createdAt': _iso(session['created'])}
        if len(rest) == 2 and rest[1] == 'ready' and method == 'POST':
            if not session.get('key') or not _token_ok(session, token, owner_only=True):
                return 403, {'error': '준비 권한이 없습니다.'}
            bad = _stored_ok(session['key'], session['size'], session['sha256'])
            if bad:
                return bad
            session['ready'] = True
            return 200, {'ready': True}
        if len(rest) >= 2 and rest[1] == 'blobs':
            return _blobs(session, rest, method, body, token)
        if len(rest) == 1 and method == 'DELETE':
            if not _token_ok(session, token, owner_only=True):
                return 403, {'error': '회수 권한이 없습니다.'}
            for key in [session.get('key'), *[b['key'] for b in session.get('blobs', {}).values()]]:
                _store.pop(key, None)
            _sessions.pop(rest[0], None)
            return 204, None
        if len(rest) == 2 and rest[1] == 'ops' and method == 'POST':
            if not isinstance(body.get('writeToken'), str) or not hmac.compare_digest(_sha(body['writeToken']), session['write_hash']):
                return 403, {'error': '쓰기 권한이 없습니다.'}
            try:
                if _decoded_size(body.get('ciphertext')) > MAX_OPS_BYTES:
                    return 413, {'error': '작업 묶음이 너무 큽니다.'}
            except ValueError as error:
                return 400, {'error': str(error)}
            if len(session['ops']) >= MAX_BATCHES:
                return 429, {'error': '이 세션의 작업 수 한도를 넘었습니다.'}
            seq = len(session['ops']) + 1
            session['ops'].append({'seq': seq, 'ciphertext': body['ciphertext'], 'createdAt': _iso(time.time())})
            return 201, {'seq': seq}
        if len(rest) == 2 and rest[1] == 'ops' and method == 'GET':
            if not _token_ok(session, token):
                return 403, {'error': '읽기 권한이 없습니다.'}
            match = re.search(r'(?:^|&)after=(\d+)', query)
            after = int(match.group(1)) if match else 0
            return 200, {'ops': [op for op in session['ops'] if op['seq'] > after][:PAGE], 'expiresAt': _iso(session['expires'])}
    return 404, {'error': '지원하지 않는 경로입니다.'}


def _blobs(session, rest, method, body, token):
    """현장 사진(잠근 바이트): 만들기 → 창고 PUT → ready → 받기. 서버 cadPad.ts 와 같은 규약."""
    def writer():
        return isinstance(body.get('writeToken'), str) and hmac.compare_digest(_sha(body['writeToken']), session['write_hash'])
    if len(rest) == 2 and method == 'POST':
        if not writer():
            return 403, {'error': '쓰기 권한이 없습니다.'}
        size, digest = body.get('bytes'), body.get('sha256')
        if not isinstance(size, int) or not 28 <= size <= MAX_PHOTO:
            return 413, {'error': '사진이 너무 큽니다(6MB까지).', 'code': 'TOO_LARGE'}
        if not isinstance(digest, str) or not HEX64.match(digest):
            return 400, {'error': 'sha256 형식이 올바르지 않습니다.'}
        blob_id = base64.urlsafe_b64encode(secrets.token_bytes(16)).decode().rstrip('=')
        key = f"cad-pad/{rest[0]}/{blob_id}.bin"
        session['blobs'][blob_id] = {'key': key, 'size': size, 'sha256': digest, 'ready': False}
        return 201, {'blobId': blob_id, 'uploadUrl': STORE_PREFIX + key}
    blob = session['blobs'].get(rest[2]) if len(rest) >= 3 else None
    if not blob:
        return 404, {'error': '없는 사진입니다.'}
    if len(rest) == 4 and rest[3] == 'ready' and method == 'POST':
        if not writer():
            return 403, {'error': '쓰기 권한이 없습니다.'}
        bad = _stored_ok(blob['key'], blob['size'], blob['sha256'])
        if bad:
            return bad
        blob['ready'] = True
        return 200, {'ready': True}
    if len(rest) == 3 and method == 'GET':
        if not _token_ok(session, token):
            return 403, {'error': '읽기 권한이 없습니다.'}
        if not blob['ready']:
            return 404, {'error': '아직 올리는 중입니다.'}
        return 200, {'downloadUrl': STORE_PREFIX + blob['key'], 'bytes': blob['size'], 'sha256': blob['sha256']}
    return 404, {'error': '지원하지 않는 경로입니다.'}
