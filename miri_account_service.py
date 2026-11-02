"""Standalone Barun account link for Barun CAD.

Account, balance and update access work without Miri Agent. Miri remains an
optional local memory/AI bridge and is reported separately by the UI.
"""
import base64
import ctypes
import json
import os
import secrets
import re
import subprocess
import sys
import urllib.parse
import urllib.error
import urllib.request
import webbrowser
from pathlib import Path
from threading import RLock, Event
import time


def _local_data_dir():
    """사용자별 프로그램 데이터 폴더. Windows 는 LOCALAPPDATA(예전과 같다), macOS 는 ~/Library/Application Support."""
    if os.environ.get('LOCALAPPDATA'): return Path(os.environ['LOCALAPPDATA'])
    if sys.platform == 'darwin': return Path.home() / 'Library' / 'Application Support'
    return Path.home() / 'AppData' / 'Local'

ORIGIN = 'https://barunarc.co.kr'
API = ORIGIN + '/api/public/miri-account/'
TOKEN_FILE = _local_data_dir() / 'Barun' / 'CAD' / 'account-token.bin'
MIRI_KEY = _local_data_dir() / 'Miriboda' / 'miri-core.key'
# 계정 창 '계정 관리'·'사용 내역'은 홈페이지 작업실의 그 탭을 바로 연다(사장님 2026-10-26 "계정 보기 하니까 이상한 창이 뜨는데").
PAGES = {'charge': ORIGIN + '/charge', 'history': ORIGIN + '/my?tab=points', 'packs': ORIGIN + '/my', 'account': ORIGIN + '/my?tab=account'}

if os.name == 'nt':
    from ctypes import wintypes

    # 창을 띄워 묻지 않는다(엔진은 화면 없는 프로세스). 기존 보관 파일은 이 값과 무관하게 그대로 풀린다.
    CRYPTPROTECT_UI_FORBIDDEN = 0x1

    class DATA_BLOB(ctypes.Structure):
        _fields_ = [('cbData', wintypes.DWORD), ('pbData', ctypes.POINTER(ctypes.c_ubyte))]

    def _blob(data):
        raw = ctypes.create_string_buffer(data)
        return DATA_BLOB(len(data), ctypes.cast(raw, ctypes.POINTER(ctypes.c_ubyte))), raw

    def _dpapi_protect(data):
        source, keep = _blob(data)
        target = DATA_BLOB()
        if not ctypes.windll.crypt32.CryptProtectData(ctypes.byref(source), 'Barun CAD account', None, None, None, CRYPTPROTECT_UI_FORBIDDEN, ctypes.byref(target)):
            raise ValueError('Windows 계정 보안 저장소를 사용할 수 없습니다.')
        try: return ctypes.string_at(target.pbData, target.cbData)
        finally: ctypes.windll.kernel32.LocalFree(target.pbData)

    def _dpapi_unprotect(data):
        source, keep = _blob(data)
        target = DATA_BLOB()
        if not ctypes.windll.crypt32.CryptUnprotectData(ctypes.byref(source), None, None, None, None, CRYPTPROTECT_UI_FORBIDDEN, ctypes.byref(target)):
            raise ValueError('저장된 계정 연결을 읽지 못했습니다. 다시 로그인해 주세요.')
        try: return ctypes.string_at(target.pbData, target.cbData)
        finally: ctypes.windll.kernel32.LocalFree(target.pbData)

# macOS: 토큰 파일은 AES-GCM 으로 잠그고, 그 열쇠(32바이트)는 로그인 키체인에 둔다.
# 키체인 항목은 Apple 이 서명한 /usr/bin/security 로만 다룬다(엔진은 서명 없는 PyInstaller 실행 파일이라 직접 접근하면 매번 허용 창이 뜬다).
SECURITY_TOOL = '/usr/bin/security'
KEYCHAIN_SERVICE = 'kr.barun.cad.account-key'
KEYCHAIN_ACCOUNT = 'barun-cad'
KEYCHAIN_NOT_FOUND = 44   # security: 항목 없음
MAC_MAGIC = b'BCK1'
MAC_AAD = b'Barun CAD account'

class KeychainUnavailable(ValueError):
    """키체인이 잠겼거나 허용을 거부·시간 초과 — 지금은 못 읽을 뿐 저장된 로그인은 멀쩡하다."""

def _keychain_read():
    try:found = subprocess.run([SECURITY_TOOL, 'find-generic-password', '-s', KEYCHAIN_SERVICE, '-a', KEYCHAIN_ACCOUNT, '-w'], capture_output=True, text=True, timeout=15)
    except (subprocess.TimeoutExpired, OSError):raise KeychainUnavailable('macOS 키체인을 사용할 수 없습니다.') from None
    if found.returncode == KEYCHAIN_NOT_FOUND: return None
    if found.returncode != 0: raise KeychainUnavailable('macOS 키체인을 사용할 수 없습니다.')
    try: key = bytes.fromhex(found.stdout.strip())
    except ValueError: return None
    return key if len(key) == 32 else None

def _keychain_key(create):
    key = _keychain_read()
    if key or not create: return key
    # 열쇠를 명령 인자로 넘기지 않는다(같은 컴퓨터의 다른 프로세스가 ps 로 볼 수 있다). security -i 는 표준 입력에서 명령을 읽는다.
    subprocess.run([SECURITY_TOOL, '-i'], input=f'add-generic-password -U -s {KEYCHAIN_SERVICE} -a {KEYCHAIN_ACCOUNT} -w {secrets.token_bytes(32).hex()}\n', capture_output=True, text=True, timeout=15)
    key = _keychain_read()
    if not key: raise ValueError('macOS 키체인에 계정 열쇠를 저장하지 못했습니다.')
    return key

def _keychain_protect(data):
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    nonce = secrets.token_bytes(12)
    return MAC_MAGIC + nonce + AESGCM(_keychain_key(create=True)).encrypt(nonce, data, MAC_AAD)

def _keychain_unprotect(data):
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    from cryptography.exceptions import InvalidTag
    key = _keychain_key(create=False)
    if not key or not data.startswith(MAC_MAGIC): raise ValueError('저장된 계정 연결을 읽지 못했습니다. 다시 로그인해 주세요.')
    body = data[len(MAC_MAGIC):]
    try: return AESGCM(key).decrypt(body[:12], body[12:], MAC_AAD)
    except InvalidTag: raise ValueError('저장된 계정 연결을 읽지 못했습니다. 다시 로그인해 주세요.') from None

def _protect(data):
    if os.name == 'nt': return _dpapi_protect(data)
    if sys.platform == 'darwin': return _keychain_protect(data)
    raise ValueError('이 운영체제에서는 계정 보안 저장소를 사용할 수 없습니다.')

def _unprotect(data):
    if os.name == 'nt': return _dpapi_unprotect(data)
    if sys.platform == 'darwin': return _keychain_unprotect(data)
    raise ValueError('이 운영체제에서는 계정 보안 저장소를 사용할 수 없습니다.')

# AI 도구 입구에서는 네트워크·파일 복호화를 반복하지 않는다. 저장/해제로 즉시 갱신한다.
_token_lock = RLock()
_token_path = None
_token_cache = None
_linked_token = None
_login_check_until = 0.0
_login_check_error = None
_login_check_inflight = None
LOGIN_CHECK_TTL = 300.0
LOGIN_CHECK_FAILURE_TTL = 5.0

def _token_stat():
    try:
        stat=TOKEN_FILE.stat()
        return (stat.st_mtime_ns,stat.st_size,stat.st_ino)
    except FileNotFoundError:return None

_token_signature=None
_token_epoch=0

def _invalidate_login_locked():
    global _linked_token,_login_check_until,_login_check_error,_login_check_inflight,_token_epoch
    _linked_token=None;_login_check_until=0.0;_login_check_error=None;_token_epoch+=1
    if _login_check_inflight is not None:_login_check_inflight[2].set()
    _login_check_inflight=None

def _load_token(*, refresh=False):
    global _token_path,_token_cache,_token_signature
    with _token_lock:
        signature=_token_stat()
        if not refresh and _token_path==TOKEN_FILE and signature==_token_signature:return _token_cache
        try:token=_unprotect(base64.b64decode(TOKEN_FILE.read_bytes(),validate=True)).decode('ascii')
        except FileNotFoundError:token=None
        except KeychainUnavailable:
            # 잠긴 키체인·거부·시간 초과는 일시적이다. 파일을 지우면 모든 바른 CAD 가 로그아웃된다(10-19 맥: 촬영 준비 중 계정 연결이 풀림).
            return None
        except Exception:
            # Only remove the broken generation we read, never a replacement login.
            if signature==_token_stat():TOKEN_FILE.unlink(missing_ok=True)
            token=None;signature=_token_stat()
        if token!=_token_cache or _token_path!=TOKEN_FILE or signature!=_token_signature:_invalidate_login_locked()
        _token_path,_token_cache,_token_signature=TOKEN_FILE,token,signature
        return token

class AILoginRequired(ValueError):
    code='not_logged_in'

class AILoginCheckUnavailable(ValueError):
    code='login_check_unavailable'

AI_LOGIN_CHECK_MESSAGE='로그인 확인을 못 했습니다(네트워크). 잠시 뒤 다시 시도해 주세요.'
AI_LOGIN_MESSAGE='바른 CAD에 로그인해야 AI 도구를 쓸 수 있습니다. [계정 연결]에서 로그인하세요.'

def require_ai_login():
    global _linked_token,_login_check_until,_login_check_error,_login_check_inflight
    while True:
        with _token_lock:
            token=_load_token()
            if not token:raise AILoginRequired(AI_LOGIN_MESSAGE)
            epoch=_token_epoch;now=time.monotonic()
            if _login_check_until>now:
                if _login_check_error:raise _login_check_error
                if _linked_token==token:return
            flight=_login_check_inflight
            if flight is None:
                flight=(token,epoch,Event());_login_check_inflight=flight;owner=True
            else:owner=False
        if not owner:
            flight[2].wait(16)
            continue
        status=None;failure=None;expired=False
        try:
            try:status=_status(_request(token,'poll'))
            except (ValueError,OSError,TimeoutError) as error:
                expired='만료' in str(error)
                failure=AILoginRequired(AI_LOGIN_MESSAGE) if expired else AILoginCheckUnavailable(AI_LOGIN_CHECK_MESSAGE)
            with _token_lock:
                # Logout, expiry or token replacement wins over an older response.
                if _load_token()!=token or _token_epoch!=epoch:continue
                if expired:
                    _clear_token(expected=token,epoch=epoch)
                    raise failure
                connected=bool(status and status['connected'])
                _linked_token=token if connected else None
                _login_check_error=failure or (None if connected else AILoginRequired(AI_LOGIN_MESSAGE))
                _login_check_until=time.monotonic()+(LOGIN_CHECK_TTL if connected else LOGIN_CHECK_FAILURE_TTL)
                if _login_check_error:raise _login_check_error
                return
        finally:
            with _token_lock:
                if _login_check_inflight is flight:_login_check_inflight=None
                flight[2].set()

def capture_ai_epoch():
    require_ai_login()
    with _token_lock:return _token_epoch

def validate_ai_epoch(epoch):
    require_ai_login()
    with _token_lock:
        if type(epoch) is not int or epoch!=_token_epoch:raise AILoginRequired('로그인 상태가 바뀌어 이전 AI 요청을 취소했습니다. 다시 요청하세요.')

def _save_token(token):
    global _token_path,_token_cache,_token_signature
    with _token_lock:
        TOKEN_FILE.parent.mkdir(parents=True,exist_ok=True)
        temporary=TOKEN_FILE.with_suffix('.tmp')
        temporary.write_bytes(base64.b64encode(_protect(token.encode('ascii'))))
        temporary.replace(TOKEN_FILE)
        _invalidate_login_locked()
        _token_path,_token_cache,_token_signature=TOKEN_FILE,token,_token_stat()

def _clear_token(*,expected=None,epoch=None):
    global _token_path,_token_cache,_token_signature
    with _token_lock:
        if expected is not None and (_load_token()!=expected or (epoch is not None and _token_epoch!=epoch)):return False
        TOKEN_FILE.unlink(missing_ok=True)
        _invalidate_login_locked()
        import vault_gate
        vault_gate.forget_screen()   # 로그아웃·만료: 화면 핵심 코드의 세션 이용권도 버린다
        vault_gate.forget()          # 핵심 자산 열쇠도 PC에서 지운다
        _token_path,_token_cache,_token_signature=TOKEN_FILE,None,None
        return True

def _request(token, action):
    request = urllib.request.Request(API + action, data=b'', method='POST', headers={'Authorization': 'Bearer ' + token})
    try:
        with urllib.request.urlopen(request, timeout=15) as response:
            return json.loads(response.read(1_000_001))
    except urllib.error.HTTPError as error:
        if error.code == 401: raise ValueError('계정 연결이 만료됐습니다. 다시 로그인해 주세요.') from None
        raise ValueError('미리보다 계정 서버에 연결하지 못했습니다.') from None
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError):
        raise ValueError('미리보다 계정 서버에 연결하지 못했습니다.') from None

def _status(result):
    if not isinstance(result,dict):raise ValueError('계정 서버 응답을 확인하지 못했습니다.')
    connected = result.get('state') == 'linked'
    balance = result.get('coin_balance')
    return {'connected': connected, 'state': result.get('state', 'disconnected'),
        'display_name': result.get('display_name'),
        'coin_balance': int(balance) if isinstance(balance, (int, float)) else None,
        'packs': [item for item in result.get('packs', []) if isinstance(item, str)][:50]}

def _miri_connected():
    try:
        key = MIRI_KEY.read_text(encoding='utf-8').strip()
        request = urllib.request.Request('http://127.0.0.1:7801/api/miri/status', headers={'X-Miri-Core-Key': key, 'X-Miri-App-Id': 'barun-cad'})
        with urllib.request.urlopen(request, timeout=1.5) as response:
            result = json.loads(response.read(1_000_001))
        return bool(result.get('ok'))
    except Exception: return False

def process(data):
    global _linked_token, _login_check_until, _login_check_error
    action = data.get('action')
    if action == 'status':
        import vault_gate
        token = _load_token(refresh=True)  # 다른 엔진의 로그인/로그아웃도 계정 상태 갱신 때 반영한다.
        if not token:
            vault_gate.forget(); vault_gate.forget_screen()   # 토큰 없는 PC에 열쇠가 남아 있으면 버린다
            return {**_status({'state': 'disconnected'}), 'miri_connected': _miri_connected(), 'protected': vault_gate.state()}
        with _token_lock:epoch=_token_epoch
        try:
            status = _status(_request(token, 'poll'))
            with _token_lock:
                if _load_token() == token and _token_epoch==epoch:
                    if not status['connected']:_invalidate_login_locked()  # Only revocation changes the login generation.
                    _linked_token = token if status['connected'] else None
                    _login_check_error = None if status['connected'] else AILoginRequired(AI_LOGIN_MESSAGE)
                    _login_check_until = time.monotonic() + (LOGIN_CHECK_TTL if status['connected'] else LOGIN_CHECK_FAILURE_TTL)
            # 핵심 자산 열쇠: 로그인돼 있고 이 판 열쇠가 아직 없을 때만 서버에 한 번 묻는다(받으면 로그인 동안 PC에 보관).
            if not status['connected']: vault_gate.forget()
            gate = vault_gate.ensure(token) if status['connected'] else {'protected': vault_gate.state()}
            # 화면 핵심 코드(도면 생성기·상세): 세션 이용권이 없거나 기한이 지났을 때만 서버에 묻는다(PC에 남기지 않음).
            if status['connected']: gate.update(vault_gate.ensure_screen(token))
            else: vault_gate.forget_screen()
            return {**status, 'miri_connected': _miri_connected(), **gate}
        except ValueError as error:
            if '만료' in str(error): _clear_token(expected=token,epoch=epoch)
            raise
    if action == 'login':
        provider = data.get('provider', 'kakao')
        if provider not in ('kakao', 'google'):
            raise ValueError('지원하지 않는 로그인 방식입니다.')
        token = _load_token() or secrets.token_hex(32)
        _save_token(token)
        with _token_lock:
            _linked_token = None
            _login_check_error=AILoginRequired(AI_LOGIN_MESSAGE)
            _login_check_until=time.monotonic()+LOGIN_CHECK_FAILURE_TTL
        result = _request(token, 'start')
        authorize = str(result.get('authorize_url', ''))
        url = urllib.parse.urlsplit(authorize)
        query = urllib.parse.parse_qs(url.query, keep_blank_values=True)
        codes = query.get('code', [])
        if (url.scheme != 'https' or url.netloc != 'barunarc.co.kr'
                or url.path != '/api/auth/miri/connect' or url.fragment
                or set(query) != {'code'} or len(codes) != 1
                or not re.fullmatch(r'[a-f0-9]{64}', codes[0])):
            raise ValueError('계정 로그인 주소가 올바르지 않습니다.')
        if provider == 'google':
            # 웹 로그인 뒤 같은 승인 주소로 돌아온다. PC 토큰은 브라우저·화면에 전달하지 않는다.
            return_to = '/api/auth/miri/connect?' + urllib.parse.urlencode({'code': codes[0]})
            authorize = ORIGIN + '/api/auth/google/start?' + urllib.parse.urlencode({'mode': 'login', 'returnTo': return_to})
        webbrowser.open(authorize, new=2)
        return {'connected': False, 'state': 'waiting', 'expires_in': result.get('expires_in', 600)}
    if action == 'logout':
        token = _load_token()
        _clear_token()
        if token:
            try: _request(token, 'disconnect')
            except ValueError: pass
        return {'connected': False, 'state': 'disconnected'}
    if action == 'open':
        page = str(data.get('page', ''))
        if page not in PAGES: raise ValueError('계정 메뉴가 올바르지 않습니다.')
        webbrowser.open(PAGES[page], new=2)
        return {'opened': True}
    raise ValueError('지원하지 않는 계정 작업입니다.')
