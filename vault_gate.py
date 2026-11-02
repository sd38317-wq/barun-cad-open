"""핵심 자산(pro.pack) 열쇠: [계정 연결] 로그인한 PC만 서버에서 받아 쓴다.

pro.pack = 지식 데이터(rules/knowledge/*.json) + 레이어 정리 지식(layer-knowledge-data.js·layer-ranking-data.js)
          + 법규 검사(livecheck-worker.js). 기본 기능은 로그인 없이 그대로 쓴다.
열쇠: barunarc.co.kr/api/public/vault-key 가 제품·버전마다 HMAC(BARUN_VAULT_MASTER, 'barun-vault/v1/barun-cad/<버전>')
     을 준다. 빌드 PC도 같은 비밀(%USERPROFILE%\\.barun\\vault-master.hex)로 잠근다(build_desktop.py).
보관: Windows 계정 보안 저장소(DPAPI)로 감싸 LOCALAPPDATA\\Barun\\CAD\\vault-key-<버전>.bin. 기한 없음(2026-10-10 사용자 결정),
     로그인해 있는 동안은 오프라인에서도 열린다. 로그아웃·만료되면 열쇠 파일과 푼 자료를 모두 버린다(2026-10-23 사용자 결정).
개발(소스 실행)에는 pro.pack 이 없으므로 소스 파일을 그대로 쓴다.
"""
import base64
import hmac
import json
import os
import re
import time
import urllib.error
import urllib.request
from hashlib import sha256
from pathlib import Path

import vault

PRODUCT = 'barun-cad'
ROOT = Path(__file__).resolve().parent
PRO_PACK = ROOT / 'rules' / 'pro.pack'
KEY_URL = 'https://barunarc.co.kr/api/public/vault-key'
KEY_DIR = Path(os.environ.get('LOCALAPPDATA', str(Path.home() / 'AppData' / 'Local'))) / 'Barun' / 'CAD'
# 화면에 내줄 때 쓰는 이름 → 소스 위치(개발 실행·빌드 묶기 공용)
SCREEN_FILES = ('layer-knowledge-data.js', 'layer-ranking-data.js', 'livecheck-worker.js')
KNOWLEDGE_DIR = ROOT / 'rules' / 'knowledge'
# MCP·AI 작도 기준(명령 라이브러리·레이어 용도·도면 기준·품질·작도 지식): 설치판에 싣지 않고 바른 서버에만 둔다(2026-10-23).
# 로그인하면 계정 표식(_barun_mark)이 든 사본을 받아 메모리에만 두고, 로그아웃하면 버린다. 개발 실행은 소스 파일.
KNOWLEDGE_URL = 'https://barunarc.co.kr/api/public/cad-knowledge'
# 도서 양식(에너지절약계획서·장애인편의시설: 시트·칸·문구·글자 크기 기준·NOTES·표준 상세 목록)도 서버에만 둔다(2026-10-25 대표 결정).
# 서버는 extras 로 물은 CAD 에게만 이 묶음을 준다 — 이미 설치된 판(7.0.27 까지)은 6개만 받아야 열리기 때문.
# 묶음마다 전부 오거나 전부 안 와야 한다. 서버가 아직 모르는 묶음은 빠져도 기본 작도 기준은 연다(그 도서만 "양식을 받지 못함").
# 한 벌 템플릿(sheet-templates.json, 2026-10-25)은 받으면 도면 기준에 붙이고, 없으면 그리기만 막는다(_standard_with_templates) — 서버 응답 검사에서는 있어도 없어도 된다.
BASE_KNOWLEDGE = ('command-library.json', 'layer-usage.json', 'drawing-standard.json', 'drawing-assemblies.json',
                  'drawing-quality.json', 'drawing-knowledge.json')
OPTIONAL_KNOWLEDGE = ('sheet-templates.json', 'drawing-decisions.json')   # 결정 기록 사본(2026-10-30, 없는 서버면 빠져도 된다)
EXTRA_KNOWLEDGE = {'energy-plan': ('energy-plan/templates.json', 'energy-plan/notes.json', 'energy-plan/library/details.json'),
                   'access-plan': ('access-plan/templates.json', 'access-plan/notes.json', 'access-plan/library/standard-pages.json')}
KNOWLEDGE_EXTRAS = tuple(EXTRA_KNOWLEDGE)
SERVER_KNOWLEDGE = BASE_KNOWLEDGE + OPTIONAL_KNOWLEDGE + tuple(n for names in EXTRA_KNOWLEDGE.values() for n in names)

_files = None
_server = None   # 서버에서 받은 작도 기준 {이름: 바이트}
_generation = 0   # forget() 마다 하나씩 — 로그아웃 전에 떠난 요청의 늦은 응답을 버린다
_refill_at = 0.0   # 서버 규칙 다시 받기를 마지막으로 해 본 때
_refill_after = 20.0   # 실패하면 이만큼(초) 다시 묻지 않는다
refill_enabled = False   # 엔진(server.main)만 켠다 — 시험·명령줄은 저장된 로그인으로 서버에 묻지 않는다
_key = None   # 푼 pro.pack 열쇠: 같은 열쇠로 잠근 보조 묶음(동봉 리습·미리보기)도 연다


def version():
    return json.loads((ROOT / 'package.json').read_text(encoding='utf-8'))['version']


def derive_key(master_hex, product=PRODUCT, ver=None):
    """서버 vaultKey() 와 글자 그대로 같은 식. 빌드 PC가 잠글 때 쓴다."""
    return hmac.new(bytes.fromhex(master_hex), f'barun-vault/v1/{product}/{ver or version()}'.encode(), sha256).digest()


def source_files():
    """pro.pack 에 넣을 {이름: 바이트}."""
    paths = [*KNOWLEDGE_DIR.glob('*.json'), *(KNOWLEDGE_DIR / 'details').glob('*.json'),
             *(KNOWLEDGE_DIR / 'country').glob('*/details/*.json')]
    files = {p.relative_to(KNOWLEDGE_DIR).as_posix(): p.read_bytes() for p in sorted(paths)
             if p.relative_to(KNOWLEDGE_DIR).as_posix() not in SERVER_KNOWLEDGE}
    files.update({name: (ROOT / name).read_bytes() for name in SCREEN_FILES})
    return files


def packaged():
    return PRO_PACK.is_file()


def _key_file():
    return KEY_DIR / f'vault-key-{version()}.bin'


def _load_key():
    from miri_account_service import _unprotect
    try:
        return _unprotect(base64.b64decode(_key_file().read_bytes(), validate=True))
    except FileNotFoundError:
        return None
    except Exception:
        _key_file().unlink(missing_ok=True)
        return None


def _save_key(key):
    from miri_account_service import _protect
    KEY_DIR.mkdir(parents=True, exist_ok=True)
    temporary = _key_file().with_suffix('.tmp')
    temporary.write_bytes(base64.b64encode(_protect(key)))
    temporary.replace(_key_file())


def _open(key):
    global _files, _key
    _files = vault.unpack(PRO_PACK.read_bytes(), key)
    _key = key
    return _files


def files():
    """잠금이 풀렸으면 {이름: 바이트}, 잠겨 있으면 None. 개발 실행은 소스."""
    if not packaged():
        return source_files()
    if _files is not None:
        return _files
    key = _load_key()
    if not key:
        return None
    try:
        return _open(key)
    except ValueError:
        _key_file().unlink(missing_ok=True)   # 다른 판의 열쇠·손상: 다음 로그인 때 다시 받는다
        return None


def forget():
    """로그아웃·만료: 메모리의 푼 자료와 이 PC에 보관한 모든 판의 열쇠 파일을 버린다."""
    global _files, _key, _server, _generation
    _files = _key = _server = None
    _generation += 1
    for path in KEY_DIR.glob('vault-key-*.bin'):
        path.unlink(missing_ok=True)


def state():
    return 'source' if not packaged() else 'unlocked' if files() is not None else 'locked'


def _fetch(token):
    body = json.dumps({'product': PRODUCT, 'version': version(), 'extras': list(KNOWLEDGE_EXTRAS)}).encode()
    request = urllib.request.Request(KEY_URL, data=body, method='POST',
                                     headers={'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(request, timeout=15) as response:
            result = json.loads(response.read(100_000))
    except urllib.error.HTTPError as error:
        raise ValueError(f'열쇠 서버가 거절했습니다({error.code}).') from None
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError):
        raise ValueError('열쇠 서버에 연결하지 못했습니다.') from None
    key = result.get('key') if isinstance(result, dict) else None
    if result.get('state') != 'ok' or not isinstance(key, str) or len(key) != 64:
        raise ValueError('열쇠 서버 응답이 올바르지 않습니다.')
    return bytes.fromhex(key)


def _fetch_knowledge(token):
    body = json.dumps({'product': PRODUCT, 'version': version(), 'extras': list(KNOWLEDGE_EXTRAS)}).encode()
    request = urllib.request.Request(KNOWLEDGE_URL, data=body, method='POST',
                                     headers={'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            result = json.loads(response.read(8_000_000))
    except urllib.error.HTTPError as error:
        raise ValueError(f'작도 기준 서버가 거절했습니다({error.code}).') from None
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError):
        raise ValueError('작도 기준 서버에 연결하지 못했습니다.') from None
    got = result.get('files') if isinstance(result, dict) and result.get('state') == 'ok' else None
    if not isinstance(got, dict) or not set(BASE_KNOWLEDGE) <= set(got) <= set(SERVER_KNOWLEDGE) or not all(isinstance(v, dict) for v in got.values()) \
            or any(set(names) & set(got) not in (set(), set(names)) for names in EXTRA_KNOWLEDGE.values()):
        raise ValueError('작도 기준 서버 응답이 올바르지 않습니다.')
    return {name: json.dumps(value, ensure_ascii=False).encode('utf-8') for name, value in got.items()}


def ensure(token):
    """로그인된 토큰으로 잠금을 푼다. {'protected': 'source'|'unlocked'|'locked', 'protected_fresh': 이번에 처음 풀림}."""
    global _server
    generation, knowledge_error = _generation, None
    if _server is None:   # 개발 실행도 서버에서(위 knowledge 참고)
        try:
            got = _fetch_knowledge(token)
            if generation == _generation:
                _server = got
        except ValueError as error:   # 작도 기준만 못 받음(오프라인 등): 다음 상태 확인 때 다시 묻는다
            knowledge_error = {'protected_error': str(error)}
    if not packaged() or files() is not None:
        return {'protected': state(), 'protected_fresh': False, **(knowledge_error or {})}
    try:
        key = _fetch(token)
        if generation != _generation:   # 받는 사이 로그아웃했다
            return {'protected': 'locked', 'protected_fresh': False}
        _open(key)          # 이 판의 묶음이 실제로 열리는 열쇠인지 먼저 확인하고 보관한다
        _save_key(key)
        if generation != _generation:   # 보관하는 사이 로그아웃했다: 다시 지운다
            forget()
            return {'protected': 'locked', 'protected_fresh': False}
        return {'protected': 'unlocked', 'protected_fresh': True, **(knowledge_error or {})}
    except ValueError as error:
        return {'protected': 'locked', 'protected_fresh': False, 'protected_error': str(error)}


LOCKED_MESSAGE = '이 자료는 [계정 연결]로 로그인한 뒤 쓸 수 있습니다(무료).'


def pack_key():
    """pro.pack 과 같은 서버 열쇠로 잠근 보조 묶음(동봉 리습·미리보기)의 열쇠. 개발 실행은 None(기본 열쇠), 잠겨 있으면 ValueError."""
    if not packaged():
        return None
    if files() is None or _key is None:
        raise ValueError(LOCKED_MESSAGE)
    return _key


def _standard_with_templates(server):
    '''도면 기준에 한 벌 템플릿(sheet-templates.json)을 sheetTemplates 로 붙인다(사장님 2026-10-25 "템플릿과 다르면 그리기를 막고").
    도면 기준을 받는 곳(화면·PLANSET·MCP)이 모두 같은 템플릿을 받게 한 곳에서 붙인다. 서버에 템플릿이 없으면 그리지 못한다.'''
    if 'sheet-templates.json' not in server:
        raise ValueError('도면 템플릿(sheet-templates.json)을 서버에서 받지 못했습니다. 다시 로그인하거나 바른 서버를 확인하세요.')
    standard = json.loads(server['drawing-standard.json'].decode('utf-8'))
    standard['sheetTemplates'] = json.loads(server['sheet-templates.json'].decode('utf-8'))
    return json.dumps(standard, ensure_ascii=False).encode('utf-8')


def _refill():
    '''엔진이 다시 켜져(멈춤 복구) 서버 규칙이 비었을 때, 저장된 로그인으로 한 번 다시 받는다(2026-10-27).
    화면이 계정 상태를 다시 물어야만 채워져, 그 사이 로그인돼 있어도 도서 만들기가 막혔다. 실패하면 잠시 다시 묻지 않는다.'''
    global _refill_at
    if not refill_enabled: return
    now = time.monotonic()
    if _refill_at and now - _refill_at < _refill_after: return
    _refill_at = now
    try:
        from miri_account_service import _load_token
        token = _load_token()
        if token: ensure(token)
    except Exception:
        pass


def knowledge(name):
    '''지식 데이터 한 개(바이트). 잠겨 있으면 ValueError.'''
    relative = Path(name)
    if relative.is_absolute() or '..' in relative.parts:
        raise ValueError('지식 자료 이름이 올바르지 않습니다.')
    key = relative.as_posix()
    # 작도 기준(SERVER_KNOWLEDGE)은 개발 실행도 늘 서버에서 받은 것만 쓴다(사용자 2026-10-25 "항상 서버에서 규칙을 받아서 · 로그인이 안 되면 그리기를 못 쓴다").
    # 개발판만 소스 파일을 읽던 때는 서버에 기준 주소가 없어 설치판이 다 막혀도 개발 중에는 드러나지 않았다.
    if key in SERVER_KNOWLEDGE:
        if _server is None:
            _refill()
        if _server is None:
            raise ValueError(LOCKED_MESSAGE)
        if key == 'drawing-standard.json':
            return _standard_with_templates(_server)
        if key not in _server:   # 서버가 아직 주지 않는 도서 양식 묶음
            raise ValueError('이 도서 양식을 서버에서 받지 못했습니다. 바른 CAD 서버가 이 판의 양식을 줄 때 쓸 수 있습니다.')
        return _server[key]
    if not packaged():
        target = (KNOWLEDGE_DIR / relative).resolve()
        if KNOWLEDGE_DIR.resolve() not in target.parents:
            raise ValueError('지식 자료 이름이 올바르지 않습니다.')
        return target.read_bytes()
    opened = files()
    if opened is None:
        raise ValueError(LOCKED_MESSAGE)
    return opened[key]


def detail_groups(country=None, only=None):
    '''보호 묶음의 상세 지식을 {공종: json 객체}로 읽는다.'''
    country = os.environ.get('BARUN_DETAIL_COUNTRY', 'kor') if country is None else country
    if country and not re.fullmatch(r'[a-z0-9_-]+', country):
        raise ValueError('상세 국가 팩 이름이 올바르지 않습니다.')
    groups = {}
    if packaged():
        opened = files()
        if opened is None:
            raise ValueError(LOCKED_MESSAGE)
        names = sorted(name for name in opened if name.startswith('details/') and name.endswith('.json'))
    else:
        names = [f'details/{path.name}' for path in sorted(KNOWLEDGE_DIR.glob('details/*.json'))]
    if only is not None:
        if not isinstance(only,(set,list,tuple)) or any(not re.fullmatch(r'[a-z0-9_-]+',str(g)) for g in only):
            raise ValueError('상세 공종 이름을 확인하세요.')
        names=[name for name in names if Path(name).stem in only]
    for name in names:
        if name.endswith('/_schema.json'):
            continue
        value = json.loads(knowledge(name).decode('utf-8'))
        group = value.get('group') if isinstance(value, dict) else None
        if not isinstance(group, str) or not group:
            raise ValueError(f'상세 지식 자료에 공종이 없습니다: {name}')
        pack_name = f'country/{country}/details/{group}.json'
        available = pack_name in opened if packaged() else (KNOWLEDGE_DIR / pack_name).is_file()
        if country and available:
            overlay = json.loads(knowledge(pack_name).decode('utf-8'))
            if overlay.get('group') != group or overlay.get('country') != country:
                raise ValueError(f'상세 국가 팩 공종/국가 불일치: {pack_name}')
            for key, item in overlay.items():
                if key not in ('schema', 'country', 'group', 'details'):
                    value[key] = item
            by_id = {item['id']: item for item in overlay.get('details', [])}
            for detail in value.get('details', []):
                item = by_id.get(detail['id'], {})
                for key, field in item.items():
                    if key not in ('id', 'assemblyNotes', 'assemblyFields'):
                        detail[key] = field
                if item.get('assemblyFields'):
                    detail['assembly'].update(item['assemblyFields'])
                for note in item.get('assemblyNotes', []):
                    layers = detail.get('assembly', {}).get('layers', [])
                    if 0 <= note['index'] < len(layers):
                        layers[note['index']]['note'] = note['note']
        groups[group] = value
    return groups


# 잠겨 있을 때 내주는 빈 자리: 레이어 지식은 비어 있고, 법규 검사는 로그인 안내만 돌려준다.
LOCKED_SCREEN = {
    'layer-knowledge-data.js': b'export const LAYER_KNOWLEDGE={"schemaVersion":1,"locked":true,"coverage":{},"classRules":[],"aliases":[]};\n',
    'layer-ranking-data.js': b'export const LAYER_RANKING={"schemaVersion":1,"locked":true,"priors":{},"weights":{},"priorStrength":0,"unknownLogit":0,"minimumScore":1,"minimumMargin":1};\n',
    'livecheck-worker.js': 'self.onmessage=e=>self.postMessage({id:e.data&&e.data.id,error:"법규 검사는 [계정 연결]로 로그인한 뒤 쓸 수 있습니다(무료)."});\n'.encode('utf-8'),
}


def screen_file(name):
    """화면 코드 한 개: 풀렸으면 진짜, 잠겨 있으면 빈 자리(기본 기능은 그대로 돈다). 개발 실행은 None(평소처럼 파일)."""
    if not packaged():
        return None
    opened = files()
    return opened[name] if opened is not None else LOCKED_SCREEN[name]


# ── 바로 그려야 하는 화면 코드(도면 생성기·상세 규칙·IFC·상세 찾기): screen.pack ──
# pro.pack 과 달리 열쇠를 PC 에 남기지 않는다. 로그인(세션)마다 서버가 짧은 이용권(열쇠·세션 번호·기한·계정 표식)을
# 주고, 엔진은 그 기한 동안만 메모리에서 푼 코드를 화면에 내준다(/api/screen-vault). 화면은 blob URL 로 import 한다
# (screen-vault.js). 내줄 때마다 계정 표식을 넣어, 코드가 새어 나가면 어느 계정에서 나왔는지 알 수 있다.
SCREEN_PACK = ROOT / 'rules' / 'screen.pack'
SCREEN_LOCKED_MESSAGE = '로그인하면 상세·도면 생성을 쓸 수 있어요.'
SCREEN_TTL_MAX = 24 * 3600
SCREEN_RETRY = 20
_screen = None   # {'files': {이름: 표식 넣은 코드}, 'order': [...], 'session', 'mark', 'expires'(monotonic)}
_screen_failed = None   # (monotonic, 오류) — 마지막 실패


def derive_screen_key(master_hex, product=PRODUCT, ver=None):
    """서버 screenKey() 와 같은 식. pro.pack 열쇠와 이름표가 달라 서로 열리지 않는다."""
    return hmac.new(bytes.fromhex(master_hex), f'barun-screen/v1/{product}/{ver or version()}'.encode(), sha256).digest()


def watermark(code, mark, session):
    """계정 표식: 파일 앞뒤 주석. 서버만 표식 → 계정을 되짚을 수 있다(barunarc.co.kr screenMark)."""
    tag = f'barun:{mark}:{session}'
    return f'/*{tag}*/{code}\n//{tag}\n'


def _fetch_screen(token):
    body = json.dumps({'product': PRODUCT, 'version': version(), 'scope': 'screen'}).encode()
    request = urllib.request.Request(KEY_URL, data=body, method='POST',
                                     headers={'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(request, timeout=15) as response:
            result = json.loads(response.read(100_000))
    except urllib.error.HTTPError as error:
        raise ValueError(f'열쇠 서버가 거절했습니다({error.code}).') from None
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError):
        raise ValueError('열쇠 서버에 연결하지 못했습니다.') from None
    if not isinstance(result, dict) or result.get('state') != 'ok':
        raise ValueError('열쇠 서버 응답이 올바르지 않습니다.')
    key, session, mark, ttl = result.get('key'), result.get('session'), result.get('mark'), result.get('expiresIn')
    if (not isinstance(key, str) or not re.fullmatch('[0-9a-f]{64}', key) or not isinstance(session, str) or not re.fullmatch('[0-9a-f]{16,64}', session)
            or not isinstance(mark, str) or not re.fullmatch('[A-Za-z0-9]{8,32}', mark) or type(ttl) is not int or not 60 <= ttl <= SCREEN_TTL_MAX):
        raise ValueError('열쇠 서버 응답이 올바르지 않습니다.')
    return {'key': bytes.fromhex(key), 'session': session, 'mark': mark, 'ttl': ttl}


def _screen_live():
    return _screen is not None and time.monotonic() < _screen['expires']


def ensure_screen(token, force=False):
    """세션 이용권이 없거나 기한이 지났으면 서버에서 새로 받는다. 열쇠는 묶음을 푸는 데만 쓰고 버린다.
    실패하면 SCREEN_RETRY 초 동안은 상태 확인 때마다 다시 묻지 않는다(오프라인). 사용자가 직접 누른 요청(force)은 바로 묻는다."""
    global _screen, _screen_failed
    if not SCREEN_PACK.is_file():
        return {'screen': 'source'}
    if _screen_live():
        return {'screen': 'unlocked'}
    if not force and _screen_failed and time.monotonic() < _screen_failed[0] + SCREEN_RETRY:
        return {'screen': 'locked', 'screen_error': _screen_failed[1]}
    try:
        grant = _fetch_screen(token)
        opened = vault.unpack(SCREEN_PACK.read_bytes(), grant['key'])
        manifest = json.loads(opened.pop('manifest.json'))
        _screen = {'order': manifest['order'], 'session': grant['session'], 'mark': grant['mark'],
                   'expires': time.monotonic() + grant['ttl'],
                   'files': {name: watermark(opened[name].decode('utf-8'), grant['mark'], grant['session']) for name in manifest['order']}}
        _screen_failed = None
        return {'screen': 'unlocked', 'screen_fresh': True}
    except (ValueError, KeyError) as error:
        _screen, _screen_failed = None, (time.monotonic(), str(error))
        return {'screen': 'locked', 'screen_error': str(error)}


def forget_screen():
    """로그아웃: 세션 이용권과 푼 코드를 버린다."""
    global _screen, _screen_failed
    _screen = _screen_failed = None


def screen_bundle():
    """화면에 내줄 잠근 코드 묶음. 개발 실행은 'source'(화면이 소스를 바로 import)."""
    global _screen
    if not SCREEN_PACK.is_file():
        return {'state': 'source'}
    if not _screen_live():
        _screen = None
        return {'state': 'locked', 'error': SCREEN_LOCKED_MESSAGE}
    return {'state': 'unlocked', 'order': _screen['order'], 'files': _screen['files']}
