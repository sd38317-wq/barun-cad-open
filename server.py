"""Dependency-free loopback-only static server for Barun CAD."""
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
import argparse
import webbrowser
import functools
import sys
import json
import base64
import secrets
import subprocess
import os
import tempfile
import gzip
import hashlib
import hmac
import time
import io
import gc
import zlib
import uuid
import atexit
import re
import shutil
import threading
import runtime_paths
runtime_paths.ensure_local_data_env()   # macOS: 사용자 데이터를 ~/Library/Application Support 에(아래 모듈들이 LOCALAPPDATA 를 읽는다)
import bridge
import image_service
import import_stream
import file_care
import pad_relay_mock
import ai_consent
from cad_asset_client import CadAssetError
from urllib.parse import urlparse,unquote,parse_qs
from urllib.request import urlopen
from urllib.error import URLError

ROOT = Path(__file__).resolve().parent
# 데스크톱 셸이 만든 토큰을 환경으로 받으면 그것을 쓴다(셸은 /api/status 없이도 안다). 읽은 뒤 환경에서 지운다.
TOKEN = (lambda given: given if len(given) >= 32 else secrets.token_urlsafe(32))(os.environ.pop('BARUN_CAD_TOKEN', ''))
MCP_TOKEN = secrets.token_urlsafe(32)
# 풀린 핵심 자산(pro.pack·layer-standards.pack)을 내주는 화면 경로: 데스크톱에서는 열쇠(screen_key_ok)가 있어야 준다.
PROTECTED_SCREEN_PATHS = frozenset({'/energy-envelope-standards.json','/energy-plan-standards.json','/drawing-knowledge.json','/layer-standards-data.js','/layer-knowledge-data.js','/layer-ranking-data.js','/livecheck-worker.js'})
ENGINE_CHALLENGE = re.compile(r'[A-Za-z0-9_-]{16,128}')

def engine_proof(challenge,port):
    """셸이 엔진을 넘겨받기 전에 묻는 시험(desktop-http.cjs probeEngine): 열쇠(TOKEN·연결 파일의 MCP_TOKEN)를 아는 엔진만 맞게 답한다.
    포트도 묶는다: 가짜 서버가 다른 포트의 진짜 엔진에게 답을 대신 받아 와도 맞지 않는다."""
    message=f'barun-cad-engine/v1|{int(port)}|{challenge}'.encode()
    return ','.join(hmac.new(key.encode(),message,hashlib.sha256).hexdigest() for key in (TOKEN,MCP_TOKEN))

# 묶음 빌드(esbuild --splitting)가 만드는 조각 이름. 새 이름이 생기면 여기에 더한다 — build_desktop.py 가 빌드 직후 검사한다.
BUNDLE_CHUNK_PATTERN=r'/(?:chunk|review-3d-clipper|detail-3d-viewer|gpu-renderer|gpu-render-client|gpu-selection-overlay|command-runner|occt-commands|compute-client|drawing-generator|ifc-writer|design-model3d|design-push-pull-ui|drawing-set-command|planset-command|drawing-sync|registry|basic|kit|checks|knowledge|window|steel|wall|floor|roof|stair|fire|parking|access|interior|detail-search-panel|detail-search-index|detail-search-actions|access-plan|cad-asset-client|dynamic-block|bim-envelope|model-work|wait-model-progress|site-analysis|apartment-wait-frame|drafting-wait-frame|image-underlay|studio)-[A-Za-z0-9_-]+\.js'
IMPORT_CACHE_VERSION = '6.0.0-import-v12'   # v12: mm 가 아닌 도면은 원본 보존 없이 mm 로(감사 1) · v11: 음수 true color(netDxf 투명도 비트) → #rrggbb · v10: v8+v9 합침 · v9: TABLE 선·문자 블록 / REGION ACIS 닫힌 경계 가져오기 · v8: 곡선 분할 뒤 0.05 mm Douglas-Peucker 로 과분할 점 제거 · v7: 공유 블록 재삽입 목록·월드 공간 곡선 분할 정밀도 유지
# S7: 동시 변환은 메모리를 수 GB 씩 쓰므로 한 번에 하나(환경변수로 조정)만 돌린다. 캐시 적중은 제한하지 않는다.
IMPORT_SEMAPHORE = threading.BoundedSemaphore(max(1, int(os.environ.get('BARUN_IMPORT_CONCURRENCY', '1') or 1)))
# 작은 도면은 큰 도면 변환 뒤에서 기다리지 않도록 따로 돌린다(20 MB 기준). 대기 상태는 /api/status importQueue 로 알린다.
IMPORT_LARGE_BYTES = int(os.environ.get('BARUN_IMPORT_LARGE_BYTES', str(20 * 1024 * 1024)) or 20 * 1024 * 1024)
SMALL_IMPORT_SEMAPHORE = threading.BoundedSemaphore(max(1, int(os.environ.get('BARUN_IMPORT_SMALL_CONCURRENCY', '3') or 3)))
IMPORT_QUEUE = {'active': 0, 'waiting': 0, 'largeActive': 0}
IMPORT_QUEUE_LOCK = threading.Lock()
NDJSON_REQUEST_MAX_BYTES = 2_000_000_000
STALE_TMP_SECONDS = 15 * 60
# ACAD200-804: 캐시 한도는 AutoCAD(CACHEMAXFILES·CACHEMAXTOTALSIZE)처럼 개수·총용량 두 값이고 환경 변수로 바꾼다.
IMPORT_CACHE_KEEP = max(1, int(os.environ.get('BARUN_IMPORT_CACHE_KEEP', '10') or 10))
IMPORT_CACHE_MAX_BYTES = max(1, int(os.environ.get('BARUN_IMPORT_CACHE_MAX_MB', '500') or 500)) * 1_000_000
CONNECTION_FILE = None

def import_cache_namespace(extension):
    """Invalidate cached drawings when the import route or bundled engine changes."""
    route=os.environ.get('BARUN_DWG_IMPORT_ROUTE','deferred').strip().lower()
    runtime=Path(os.environ.get('BARUN_DWG_RUNTIME') or runtime_paths.bundled_runtime('dwg-runtime'))
    digest=hashlib.sha256()
    found=False
    # 보조 엔진 acadrust(batch_converter 가 쓰는 같은 파일)도 넣는다: 변환기만 고친 판에서 옛 변환 캐시를 다시 쓰지 않게(7.0.30 온천동).
    acadrust=runtime_paths.bundled_runtime('acadrust-runtime')
    for folder,name in ((runtime,'ACadSharp.dll'),(runtime,'BarunConverter.dll'),(runtime,'BarunConverter'+runtime_paths.EXE),(acadrust,'barun-dwg2dxf'+runtime_paths.EXE)):
        component=folder/name;digest.update(name.encode())
        if component.is_file():
            found=True
            with component.open('rb') as stream:
                for chunk in iter(lambda:stream.read(1024*1024),b''):digest.update(chunk)
        else:digest.update(b'missing')
    signature=digest.hexdigest() if found else 'missing'
    engine_version=os.environ.get('BARUN_DWG_ENGINE_VERSION','ACadSharp 3.8.0')
    return '|'.join((IMPORT_CACHE_VERSION,extension.lower(),route,engine_version,signature)).encode()

def release_import_memory():
    """Large drawings can temporarily consume gigabytes; release cycles and trim the Windows working set after the response."""
    gc.collect()
    if os.name=='nt':
        try:
            import ctypes
            from ctypes import wintypes
            # S8: 64비트에서는 HANDLE 을 int 로 자르면 호출이 조용히 실패한다. 형식을 명시한다.
            kernel32=ctypes.WinDLL('kernel32',use_last_error=True);psapi=ctypes.WinDLL('psapi',use_last_error=True)
            kernel32.GetCurrentProcess.restype=wintypes.HANDLE;kernel32.GetCurrentProcess.argtypes=[]
            psapi.EmptyWorkingSet.restype=wintypes.BOOL;psapi.EmptyWorkingSet.argtypes=[wintypes.HANDLE]
            psapi.EmptyWorkingSet(kernel32.GetCurrentProcess())
        except (AttributeError,OSError):pass

def import_cache_dir():
    root=Path(os.environ.get('LOCALAPPDATA') or tempfile.gettempdir())/'BarunCAD'/'drawing-cache'
    root.mkdir(parents=True,exist_ok=True)
    return root

def prune_import_cache(keep=None,max_bytes=None):
    """S7: 업로드·경로 가져오기 공통 정리. 최신 keep 개, 합계 max_bytes 이하만 남기고 옛 형식(.json.gz)은 모두 지운다."""
    keep=IMPORT_CACHE_KEEP if keep is None else keep;max_bytes=IMPORT_CACHE_MAX_BYTES if max_bytes is None else max_bytes
    removed=0
    try:
        folder=import_cache_dir()
        for legacy in folder.glob('*.json.gz'):
            try:legacy.unlink();removed+=1
            except OSError:pass
        # 쓰다 만 .tmp(강제 종료)는 15분이 지나면 지우고, 그 전에도 용량 상한에는 포함한다.
        total=0
        for stale in folder.glob('*.tmp'):
            try:
                if time.time()-stale.stat().st_mtime>STALE_TMP_SECONDS:stale.unlink();removed+=1
                else:total+=stale.stat().st_size
            except OSError:pass
        items=sorted(folder.glob('*'+import_stream.CACHE_SUFFIX),key=lambda p:p.stat().st_mtime,reverse=True)
        for index,item in enumerate(items):
            total+=item.stat().st_size
            if index>=keep or total>max_bytes:
                try:item.unlink();removed+=1
                except OSError:pass
    except OSError:pass
    return removed

def import_queue_state():
    with IMPORT_QUEUE_LOCK:return dict(IMPORT_QUEUE)

def _queue(field,delta):
    with IMPORT_QUEUE_LOCK:IMPORT_QUEUE[field]=max(0,IMPORT_QUEUE[field]+delta)

def cached_stream(target,convert,size=0):
    """Return (cache path, hit). The stream file is validated (line/byte counts) before reuse and rebuilt under the size-class semaphore."""
    if target.is_file():
        # Forced shutdown must never leave an empty/truncated cache that the
        # browser then reports as a cut response.
        if import_stream.stream_is_complete(target):
            try:os.utime(target,None)
            except OSError:pass
            return target,True
        try:target.unlink()
        except OSError:pass
    large=size>=IMPORT_LARGE_BYTES
    semaphore=IMPORT_SEMAPHORE if large else SMALL_IMPORT_SEMAPHORE
    _queue('waiting',1);acquired=False
    try:
        semaphore.acquire();acquired=True
        _queue('waiting',-1);_queue('active',1)
        if large:_queue('largeActive',1)
        if target.is_file() and import_stream.stream_is_complete(target):return target,True
        result=convert()
        result.setdefault('report',{})['cacheHit']=False
        try:
            stats=import_stream.write_stream(result,target)
            if sys.stderr is not None:print(f"[import-stream] lines={stats['lines']} maxLineBytes={stats['maxLineBytes']} gzipBytes={stats['bytes']} oversized={stats['oversized']}",file=sys.stderr,flush=True)
        finally:
            del result;gc.collect()
    finally:
        if acquired:
            _queue('active',-1)
            if large:_queue('largeActive',-1)
            semaphore.release()
        else:_queue('waiting',-1)
    prune_import_cache()
    return target,False

def cached_import_body(raw,extension):
    """Upload based import: convert once per content hash and stream the cached NDJSON result."""
    key=hashlib.sha256(import_cache_namespace(extension)+raw).hexdigest()
    target=import_cache_dir()/(key+import_stream.CACHE_SUFFIX)
    def convert():
        import exchange
        return exchange.import_file(raw,extension)
    return cached_stream(target,convert,len(raw))

def cached_import_path_body(source,extension,recover=False):
    """Path based desktop import: cache key is path·size·mtime, so a reopen never reads the source again.
    밖에서 인터넷 너머 NAS(초당 2MB)를 열 때 같은 20MB 도면을 매번 통째로 받아 해시했다(2026-10-29).
    저장하면 수정 시각이 바뀌어 새 키가 된다."""
    stat=Path(source).stat()
    digest=hashlib.sha256();digest.update(import_cache_namespace(extension)+(b'|recover' if recover else b''))
    digest.update(f'|{Path(source).resolve()}|{stat.st_size}|{stat.st_mtime_ns}'.encode('utf-8','surrogateescape'))
    target=import_cache_dir()/(digest.hexdigest()+import_stream.CACHE_SUFFIX)
    def convert():
        import exchange
        return exchange.import_file_path(source,extension,recover=True) if recover else exchange.import_file_path(source,extension)
    return cached_stream(target,convert,stat.st_size)

import re
# N1: 저장 경로는 셸(desktop.cjs)이 저장 대화상자에서 받은 것만, 일회용 토큰으로 넘긴다. 화면 코드는 경로를 직접 지정할 수 없다.
SHELL_SECRET=os.environ.pop('BARUN_CAD_SHELL_SECRET','')   # 읽은 뒤 환경에서 지운다(변환기·LISP·codex 자식 프로세스에 상속되지 않게)
SUPERSCRIPT_DIGITS=str.maketrans('¹²³⁴⁵⁶⁷⁸⁹','123456789')

def device_stem(name):
    """장치 이름 판정용 줄기: 첫 점 앞, 끝의 공백·점 제거, 위첨자 숫자 정규화, 대문자."""
    return str(name).split('.')[0].rstrip(' .').translate(SUPERSCRIPT_DIGITS).upper()
SAVE_TARGETS={};SAVE_TARGET_LOCK=threading.Lock();SAVE_TARGET_TTL=600
DEVICE_NAMES={'CON','PRN','AUX','NUL','CLOCK$'}|{f'COM{i}' for i in range(1,10)}|{f'LPT{i}' for i in range(1,10)}
BODY_READ_TIMEOUT=float(os.environ.get('BARUN_BODY_READ_TIMEOUT','30') or 30)   # N3: 본문이 오다 말면 이 시간 안에 400
NDJSON_ROUTES=('/api/export','/api/recovery')                                    # N4: 줄 단위 본문은 이 경로만

def validate_save_path(path,fmt,windows=None):
    """Windows: 로컬 드라이브의 절대 경로, UNC·장치 이름·상대 조각·대체 스트림 금지.
    macOS: '/' 로 시작하는 절대 경로, 상대 조각 금지. 파일 이름은 Windows 사용자에게 넘겨도 열리도록 Windows 이름 규칙(장치 이름·금지 문자)을 그대로 따른다.
    두 경우 모두 확장자는 형식과 일치해야 한다."""
    windows=os.name=='nt' if windows is None else windows
    text=str(path or '')
    if not text or '\x00' in text or len(text)>1024:raise ValueError('저장 경로가 올바르지 않습니다.')
    if text.startswith('\\\\') or text.startswith('//'):raise ValueError('네트워크(UNC) 경로에는 저장할 수 없습니다. 로컬 드라이브를 선택하세요.')
    if windows:
        if not re.match(r'^[A-Za-z]:[\\/]',text):raise ValueError('저장 경로는 로컬 드라이브의 전체 경로여야 합니다.')
        if ':' in text[2:]:raise ValueError('저장 경로에 쓸 수 없는 문자(:)가 있습니다.')
        parts=[part for part in re.split(r'[\\/]+',text[2:]) if part]
        if any(part in ('.','..') or part!=part.strip() for part in parts):raise ValueError('저장 경로에 상대 경로 조각(..)이 있습니다.')
        if any(ch in part for part in parts for ch in '<>"|?*'):raise ValueError('저장 경로에 쓸 수 없는 문자가 있습니다.')
    else:
        if not text.startswith('/'):raise ValueError('저장 경로는 전체 경로여야 합니다.')
        parts=[part for part in text.split('/') if part]
        if any(part in ('.','..') for part in parts):raise ValueError('저장 경로에 상대 경로 조각(..)이 있습니다.')
        if any(ch in (parts[-1] if parts else '') for ch in '<>"|?*:\\'):raise ValueError('저장 파일 이름에 쓸 수 없는 문자가 있습니다.')
    target=Path(text)
    if fmt not in ('dxf','dwg','bcad','lsp','pdf','xlsx','svg','ifc','png','jpg') or target.suffix.lower()!='.'+fmt:raise ValueError('저장 형식과 확장자가 맞지 않습니다 (.'+str(fmt)+').')
    if device_stem(target.name) in DEVICE_NAMES:raise ValueError('예약된 장치 이름은 파일 이름으로 쓸 수 없습니다: '+target.stem)
    if not target.parent.is_dir():raise ValueError('저장 폴더가 없습니다: '+str(target.parent))
    if target.exists() and not target.is_file():raise ValueError('저장 경로가 파일이 아닙니다.')
    return target

def save_authorizer(data):
    identifier=data.get('aiRequestId');recipient=data.get('aiRecipient')
    if not identifier:
        if data.get('aiRequestEpoch') is not None:raise ValueError('AI 저장 요청 식별자가 없습니다.')
        return lambda:None
    return lambda:bridge.validate_app_request(identifier,recipient)

def register_save_target(path,fmt,authorization=None):
    import safe_writes
    target=validate_save_path(path,fmt)
    check=save_authorizer(authorization or {})
    token=secrets.token_urlsafe(24);now=time.monotonic()
    with SAVE_TARGET_LOCK:
        expired=[SAVE_TARGETS.pop(key) for key in list(SAVE_TARGETS) if SAVE_TARGETS[key]['expires']<now]
    for entry in expired:entry['transaction'].close()
    transaction=safe_writes.reserve(target,assert_current=check);transaction.__enter__()
    with SAVE_TARGET_LOCK:
        SAVE_TARGETS[token]={'path':str(target),'format':fmt,'expires':now+SAVE_TARGET_TTL,'transaction':transaction,'check':check}
    return {'saveToken':token,'path':str(target),'existed':transaction.existed,'tempPath':str(target)+'.'+token+'.tmp','timings_ms':dict(transaction.timings_ms)}

def save_target_entry(token,fmt=None):
    with SAVE_TARGET_LOCK:entry=SAVE_TARGETS.get(str(token or ''))
    if not entry or entry['expires']<time.monotonic():
        consume_save_target(token)
        raise ValueError('저장 위치 확인이 만료되었습니다. 저장을 다시 실행하세요.')
    if fmt is not None and entry['format']!=fmt:raise ValueError('저장 형식이 고른 파일 형식과 다릅니다.')
    entry['check']();entry['transaction'].assert_unchanged()
    return entry

def take_save_target(token,fmt):
    return validate_save_path(save_target_entry(token,fmt)['path'],fmt)

def consume_save_target(token):
    with SAVE_TARGET_LOCK:entry=SAVE_TARGETS.pop(str(token or ''),None)
    if entry:entry['transaction'].close()

def export_to_path(content,target,fmt,warm=True,transaction=None,assert_current=None):
    import safe_writes
    target=validate_save_path(target,fmt)
    if transaction is None:
        with safe_writes.reserve(target,assert_current=assert_current) as reservation:result=reservation.save(content)
    else:
        if transaction.target!=target.resolve():raise ValueError('저장 예약 대상이 다릅니다.')
        result=transaction.save(content,assert_current=assert_current)
    if warm:file_care.warm_in_background(target,fmt,cached_import_path_body)
    return result

def user_error_message(error):
    """S16: 내부 예외(KeyError 'color' 등)를 그대로 화면에 보이지 않게 한글 안내로 바꾼다."""
    text=str(error)[:500]
    if isinstance(error,KeyError):
        key=error.args[0] if error.args else ''
        return f'도면 자료에 필요한 항목({key})이 없어 처리하지 못했습니다. 도면을 BCAD로 백업한 뒤 다시 열어 시도하세요.'
    if isinstance(error,(TypeError,AttributeError,IndexError)):
        return '도면 자료 형식이 예상과 달라 처리하지 못했습니다. 도면을 BCAD로 백업한 뒤 다시 열어 시도하세요. (내부: '+text[:120]+')'
    if isinstance(error,MemoryError):return '메모리가 부족해 처리를 중단했습니다. 다른 프로그램을 닫거나 도면을 나누어 여세요.'
    if not text.strip():return '변환에 실패했습니다.'
    if any('가'<=char<='힣' for char in text):return text
    return '처리 중 오류가 났습니다: '+text

def json_safe(value):
    """Replace malformed UTF-16 surrogate code points found in some legacy CAD text.

    ACadSharp can preserve a lone surrogate from damaged DWG text.  Python accepts
    it in a str, but UTF-8 cannot encode it, which used to abort the whole import.
    """
    if isinstance(value,str):
        return ''.join('\ufffd' if 0xD800 <= ord(char) <= 0xDFFF else char for char in value)
    if isinstance(value,list):return [json_safe(item) for item in value]
    if isinstance(value,tuple):return [json_safe(item) for item in value]
    if isinstance(value,dict):return {json_safe(key):json_safe(item) for key,item in value.items()}
    return value

def json_bytes(value,compact=False):
    """Encode clean drawings once and only scan the tree if damaged text needs repair."""
    options={'ensure_ascii':False,'allow_nan':False}
    if compact:options['separators']=(',',':')
    rendered=json.dumps(value,**options)
    try:return rendered.encode('utf-8')
    except UnicodeEncodeError:return json.dumps(json_safe(value),**options).encode('utf-8')

class LocalServer(ThreadingHTTPServer):
    # macOS·리눅스: 방금 끈 엔진의 닫힌 연결(TIME_WAIT)이 남으면 SO_REUSEADDR 없이는 같은 포트를 못 열어
    # 껐다 바로 켜면 '포트 18765를 다른 프로그램이 사용 중'으로 끝났다(10-19 맥). 거기서는 듣는 소켓 둘이 한 포트를 나눠 갖지 못하니 켜도 안전하다.
    # 윈도우의 SO_REUSEADDR 은 남이 쓰는 포트를 가로챌 수 있어 끈 채로 둔다.
    allow_reuse_address = os.name != 'nt'
    # 첫 화면은 모듈·CSS 수십~백여 개를 한꺼번에 연다. 기본 대기열 5개로는 macOS 가 넘친 연결을 끊어(ERR_CONNECTION_RESET)
    # 메뉴만 펼쳐진 채 디자인이 빠진 화면으로 떴다(10-19 맥 개발 앱). 넉넉히 받아 둔다.
    request_queue_size = 256
    converter_warmup = None
    converter_warmup_cancelled = None

def start_converter_warmup(server,delay=30):
    """Only the live server calls this; importing the module does no converter work."""
    if os.environ.get('BARUN_DWG_WARMUP','1').strip().lower() in ('0','false','off','no'):return None
    server.converter_warmup=None;server.converter_warmup_cancelled=threading.Event()
    def prepare_converter():
        try:
            if server.converter_warmup_cancelled.is_set():return
            from batch_converter import schedule_warmup
            if server.converter_warmup_cancelled.is_set():return
            server.converter_warmup=schedule_warmup(delay=0)
            if server.converter_warmup_cancelled.is_set() and server.converter_warmup is not None:server.converter_warmup.cancel()
        except Exception:pass
    timer=threading.Timer(delay,prepare_converter);timer.daemon=True
    try:timer.start()
    except Exception:
        server.converter_warmup_cancelled.set();return None
    return timer

class Handler(SimpleHTTPRequestHandler):
    extensions_map = {**SimpleHTTPRequestHandler.extensions_map, '.js': 'text/javascript', '.mjs': 'text/javascript', '.svg': 'image/svg+xml', '.bcad': 'application/json', '.wasm': 'application/wasm', '.md': 'text/markdown'}
    # S11: 덜 온 요청 본문이 핸들러 스레드를 영구히 붙잡지 않도록 소켓 읽기·쓰기 대기 시간을 둔다.
    timeout = 120
    def log_message(self, format, *args):
        if sys.stderr is not None:
            super().log_message(format, *args)
    def parse_request(self):
        # DNS rebinding guard: a web page whose host name is re-pointed at 127.0.0.1
        # still sends its own Host header. Only the loopback names of this port are
        # served, for every method (the /api/status token, assets and the APIs).
        if not super().parse_request():return False
        port=self.server.server_port
        if self.headers.get('Host','') not in (f'127.0.0.1:{port}',f'localhost:{port}'):
            self.send_error(421,'Misdirected Request');return False
        if self.command=='POST' and self.path in ('/api/import','/api/import-path','/api/export','/api/convert','/api/convert-file'):
            # 시험이나 다른 서버 객체로 돌 때도 멈추지 않게(예열은 선택)
            cancelled=getattr(self.server,'converter_warmup_cancelled',None)
            if cancelled is not None:cancelled.set()
            task=getattr(self.server,'converter_warmup',None)
            if task is not None:task.cancel()
        return True
    def end_headers(self):
        self.send_header('X-Barun-CAD', '2')
        for name,value in self.__dict__.pop('extra_headers',()):self.send_header(name,value)   # 이번 응답에만(같은 연결의 다음 요청에 남지 않게)
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('X-Frame-Options', 'SAMEORIGIN' if urlparse(self.path).path in ('/wait-screens/apartment.html','/wait-screens/site.html','/wait-screens/drafting.html') else 'DENY')
        self.send_header('Referrer-Policy', 'same-origin')
        super().end_headers()

    def json_response(self,data,status=200):
        job=getattr(self,'output_job_id',None)
        if job:
            import output_jobs
            failed=status>=400 or (isinstance(data,dict) and (data.get('error') or data.get('failed')))
            snapshot=output_jobs.fail(job,data.get('error') or data.get('message')) if failed else output_jobs.finish(job)
            if isinstance(data,dict):data={**data,'_outputProgress':snapshot}
            self.output_job_id=None
        body=json_bytes(data)
        encoded=gzip.compress(body,compresslevel=1) if len(body)>100_000 and 'gzip' in self.headers.get('Accept-Encoding','') else body
        self.send_response(status);self.send_header('Content-Type','application/json; charset=utf-8')
        if encoded is not body:self.send_header('Content-Encoding','gzip')
        self.send_header('Content-Length',str(len(encoded)));self.end_headers();self.wfile.write(encoded)

    def stream_response(self,path,hit):
        """S1: 변환 결과를 줄 단위 NDJSON(gzip)으로 보낸다. 한 줄도 import_stream.SAFE_LINE_BYTES 를 넘지 않는다."""
        size=path.stat().st_size
        self.send_response(200);self.send_header('Content-Type',import_stream.CONTENT_TYPE)
        self.send_header('Content-Encoding','gzip');self.send_header('X-Barun-Import-Cache','hit' if hit else 'miss')
        self.send_header('X-Barun-Import-Format','ndjson-v'+str(import_stream.STREAM_VERSION))
        self.send_header('Content-Length',str(size));self.end_headers()
        try:
            with path.open('rb') as stream:shutil.copyfileobj(stream,self.wfile,4*1024*1024)
        finally:release_import_memory()

    def import_response(self,raw,extension):
        path,hit=cached_import_body(raw,extension)
        del raw
        self.stream_response(path,hit)

    def same_origin_get(self):
        # <img src>는 헤더를 못 붙이므로 브라우저가 붙이는 같은 출처 표시(Sec-Fetch-Site)로만 확인한다.
        # 토큰 질의값은 받지 않는다(요청 줄이 로그에 남는다). Referer 는 아무 프로그램이나 꾸밀 수 있다.
        return self.headers.get('Sec-Fetch-Site')=='same-origin'

    def screen_key_ok(self):
        # 데스크톱 엔진(셸 비밀 있음)은 지식·자산 GET 에도 열쇠를 본다. Host·Sec-Fetch-Site 는 같은 PC 의 다른 프로그램이
        # 꾸밀 수 있어서, 풀린 핵심 자산(pro.pack)을 그것만으로 내주지 않는다. 화면 요청에는 셸이 X-CAD-Screen 을 붙인다
        # (desktop.cjs screenKey · <img>·모듈 import·Worker 도 포함). 브라우저 실행은 /api/status 가 토큰을 알리므로 막지 않는다.
        if not SHELL_SECRET:return True
        supplied=(self.headers.get('X-CAD-Screen') or self.headers.get('X-CAD-Token') or '').encode()
        return bool(supplied) and (secrets.compare_digest(supplied,TOKEN.encode()) or secrets.compare_digest(supplied,MCP_TOKEN.encode()))

    def screen_get_ok(self):
        return self.same_origin_get() and self.screen_key_ok()

    def status_token(self):
        # 데스크톱(셸 비밀이 있는 엔진)에서는 토큰을 /api/status 로 주지 않는다. 같은 PC 의 다른 프로그램·다른
        # 계정이 루프백으로 토큰을 받아 가지 못하게, 화면은 셸의 IPC(cadDesktop.engineToken)로 받는다.
        return {'tokenPolicy':'desktop'} if SHELL_SECRET else {'token':TOKEN}

    def do_GET(self):
        # 패드 원격 수정 모의 중계(개발 전용, BARUN_PAD_MOCK=1): 패드 화면 /p/<ID> 와 공개 중계 API.
        if pad_relay_mock.enabled() and pad_relay_mock.handle(self,'GET'):return
        if urlparse(self.path).path=='/api/image':
            if not self.screen_get_ok():
                self.json_response({'error':'이 CAD 화면에서 요청을 다시 실행하세요.'},403);return
            try:
                path=parse_qs(urlparse(self.path).query).get('path',[''])[0]
                content,mime=image_service.image_bytes(path)
                self.send_response(200);self.send_header('Content-Type',mime);self.send_header('Cache-Control','no-store');self.send_header('Content-Length',str(len(content)));self.end_headers();self.wfile.write(content)
            except ValueError as error:self.json_response({'error':str(error)},400)
            except OSError as error:self.json_response({'error':'이미지 파일을 읽을 수 없습니다.'},400)
            return
        if urlparse(self.path).path=='/api/design-cases/image':
            if not self.screen_get_ok():
                self.json_response({'error':'이 CAD 화면에서 요청을 다시 실행하세요.'},403);return
            try:
                from design_case_service import image_bytes
                content=image_bytes(parse_qs(urlparse(self.path).query).get('id',[''])[0])
                self.send_response(200);self.send_header('Content-Type','image/jpeg');self.send_header('Content-Length',str(len(content)));self.end_headers();self.wfile.write(content)
            except Exception as error:self.json_response({'error':str(error)},400)
            return
        preview_path=urlparse(self.path).path
        thumb_route=re.fullmatch(r'/api/cad-asset/(thumb|thumb3d)/(detail|unit|jutong)/([^/]+)',preview_path)
        if preview_path=='/api/cad-asset/catalog' or thumb_route:
            if not self.screen_get_ok():
                self.json_response({'error':'이 CAD 화면에서 요청을 다시 실행하세요.'},403);return
            try:
                import cad_asset_client as assets
                if thumb_route:
                    content=assets.thumb(thumb_route[2],unquote(thumb_route[3]),thumb_route[1]=='thumb3d')
                    if content is None:self.json_response({'error':'미리보기 없음'},404);return
                    self.send_response(200);self.send_header('Content-Type','image/webp');self.send_header('Content-Length',str(len(content)));self.end_headers();self.wfile.write(content)
                else:
                    params=parse_qs(urlparse(self.path).query)
                    self.json_response(assets.catalog(params.get('kind',[None])[0]))
            except CadAssetError as error:self.json_response(error.response(),error.status)
            except ValueError as error:self.json_response({'error':str(error)},400)
            return
        if urlparse(self.path).path in ('/api/detail-search/catalog','/api/detail-search/preview'):
            if urlparse(self.path).path.endswith('/preview') and not secrets.compare_digest(self.headers.get('X-CAD-Token','').encode(),TOKEN.encode()):
                self.json_response({'error':'이 CAD 화면에서 요청을 다시 실행하세요.'},403);return
            if not self.screen_get_ok():
                self.json_response({'error':'이 CAD 화면에서 요청을 다시 실행하세요.'},403);return
            try:
                import detail_search_library as details
                if urlparse(self.path).path.endswith('/catalog'):
                    self.json_response(details.catalog())
                else:
                    params=parse_qs(urlparse(self.path).query)
                    format=params.get('format',['png'])[0].lower()
                    content=details.preview(params.get('id',[''])[0],params.get('source',['library'])[0],format)
                    mime='model/gltf-binary' if format == 'glb' else 'image/png'
                    self.send_response(200);self.send_header('Content-Type',mime);self.send_header('Content-Length',str(len(content)));self.end_headers();self.wfile.write(content)
            except CadAssetError as error:self.json_response(error.response(),error.status)
            except Exception as error:self.json_response({'error':str(error)},400)
            return
        if self.path=='/api/status':
            challenge=self.headers.get('X-CAD-Challenge','')
            if ENGINE_CHALLENGE.fullmatch(challenge):self.extra_headers=[('X-CAD-Proof',engine_proof(challenge,self.server.server_port))]
            try:
                import exchange
                self.json_response({'version':3,**self.status_token(),'pid':os.getpid(),'port':self.server.server_port,'dxf':True,'ezdxf':exchange.ezdxf.__version__,'converters':{k:bool(v) for k,v in exchange.converters().items()},'importStream':import_stream.STREAM_VERSION,'importQueue':import_queue_state(),'offlineCore':True,'optionalServices':{'ai':'인터넷과 AI 계정 연결 필요','parcel':'인터넷과 바른 계정 연결 필요','autocadLisp':'AutoCAD 전용 리습만 별도 AutoCAD 필요; 기본 LSP는 내장 엔진 사용'}})
            except ImportError:
                self.json_response({'version':2,**self.status_token(),'pid':os.getpid(),'port':self.server.server_port,'dxf':False,'converters':{},'error':'내장 도면 엔진이 누락되었습니다. 바른 CAD 설치 파일로 복구하세요.' if getattr(sys,'frozen',False) else 'python -m pip install -r requirements.txt 로 DXF 라이브러리를 설치하세요.'})
            return
        # Serve application assets and documentation, never arbitrary project files.
        path=unquote(urlparse(self.path).path)
        # 핵심 자산(레이어 정리 지식·법규 검사)은 설치본에 평문으로 없다. 서버 열쇠 묶음(pro.pack)에서 꺼내 주고,
        # 로그인 전에는 빈 자리를 준다(기본 기능은 그대로). 개발 실행은 None → 평소처럼 파일.
        if path in PROTECTED_SCREEN_PATHS and not self.screen_key_ok():
            self.json_response({'error':'이 CAD 화면에서 요청을 다시 실행하세요.'},403);return
        if path in ('/energy-envelope-standards.json','/energy-plan-standards.json'):
            import vault_gate
            name={'/energy-envelope-standards.json':'energy_envelope_standards.json','/energy-plan-standards.json':'energy_saving_plan_standards.json'}[path]
            try:self.json_response(json.loads(vault_gate.knowledge(name)))
            except (ValueError,KeyError,FileNotFoundError) as error:self.json_response({'error':str(error)},403)
            return
        if path=='/drawing-knowledge.json':
            # 도면 다시 만들기(AIREDRAW): 도면 기준·구성표. 열쇠는 한 번 로그인하면 이 PC 에 남아 오프라인에서도 열린다.
            import vault_gate
            try:self.json_response({'standard':json.loads(vault_gate.knowledge('drawing-standard.json')),'assemblies':json.loads(vault_gate.knowledge('drawing-assemblies.json')),'details':vault_gate.detail_groups(),'quality':json.loads(vault_gate.knowledge('drawing-quality.json')),'recipes':json.loads(vault_gate.knowledge('drawing-recipes.json'))})
            except ValueError as error:self.json_response({'error':str(error)},403)
            return
        if path=='/layer-standards-data.js':
            import layer_standards_asset
            body=layer_standards_asset.screen_file(path[1:])
            if body is not None:
                self.send_response(200);self.send_header('Content-Type','text/javascript; charset=utf-8')
                self.send_header('Content-Length',str(len(body)));self.end_headers();self.wfile.write(body);return
        if path in ('/layer-knowledge-data.js','/layer-ranking-data.js','/livecheck-worker.js'):
            import vault_gate
            body=vault_gate.screen_file(path[1:])
            if body is not None:
                self.send_response(200);self.send_header('Content-Type','text/javascript; charset=utf-8');self.send_header('Cache-Control','no-store')
                self.send_header('Content-Length',str(len(body)));self.end_headers();self.wfile.write(body);return
        allowed={'/','/index.html','/app.js','/overlap-selection.js','/input-manager.js','/engine.js','/geometry.js','/commands.js','/menu-catalog.js','/viewport-visibility.js','/view.js','/symbols.js','/plot.js','/studio.js','/user-error.js','/workflows.js','/dimension-style.js','/style.css','/menu-shell.css','/common-account-update.css','/README.md','/기능목록.md','/favicon.ico','/barun-cad-brand.png','/fonts/NanumGothic-Regular.ttf'}
        example=(ROOT/path.lstrip('/')).resolve()
        is_example=example.is_relative_to(ROOT/'examples') and example.suffix.lower() in ('.dxf','.bcad','.svg')
        allowed.update({'/tool-card-icons.js','/access-review.js','/permit-book.js','/silsi-panel.js','/drawing-recognition.js','/drawing-recognition-read.js','/building-overview.js','/structure-review.js','/extension-review.js','/permit-energy.js','/energy-envelope.js','/energy-plan.js','/energy-regions.js','/site-context.js','/review-panel.js','/review-model.js','/quick-tools-order.js','/architecture-lisp-catalog.js','/architecture-assist-state.js','/number-calculator.js','/sheet-layout.js','/area-takeoff.js','/area-conversion.js','/lisp-panel.js','/mcp-lisp.js','/ai-layer-policy.js','/app-ai-tools.js','/architectural-library.js','/tablet-control.js','/tablet-pad.js','/pad-sketch.js','/plan-floor-bridge.js','/plan-layout.js','/live-check.js','/livecheck-auto.js','/livecheck-worker.js','/livecheck-engine.js','/room-schedule.js','/ai-actions.js','/review-3d.js','/design-model3d.js','/design-push-pull-ui.js','/three.module.js','/three.core.js','/OrbitControls.js','/GLTFExporter.js','/GLTFLoader.js','/SkeletonUtils.js','/detail-3d-viewer.js','/detail-3d-utils.js','/BufferGeometryUtils.js','/architecture.js','/workflow-names.js','/structure.js','/file-workflows.js','/bridge-client.js','/chat.js','/batch-converter.js','/plan-input.js','/site-plan.js','/site-contract.js','/site-plan-panel.js','/auto-plan.js','/plan-workflow-panel.js','/site-3d.js','/rail-autohide.js','/plan-quality-panel.js','/review-3d-geometry.js','/review-3d-clipper.js','/site-plan-results.js','/site-plan-jobs.js','/site-plan-contract-panel.js','/output-wait.js','/output-requests.js','/site-merge.js','/site-analysis.js','/sheet-frame-block.js'})
        allowed.update({'/dynamic-block.js','/lisp-native.js','/lisp-host.js','/drawing-tabs.js','/import-stream.js','/design-cases-panel.js','/apartment-panel.js','/apartment-sheet.js','/miriboda-panel.js','/parcel-info.js','/parcel-corner.js','/parcel-road.js','/layer-knowledge.js','/layer-knowledge-data.js','/layer-ranking.js','/layer-ranking-data.js','/reference-data.js','/new-build.js','/sheet-tools.js','/block-tools.js','/architecture-command-pack.js','/architecture-howto-data.js','/wall-preset.js','/card-kit.js','/door-card.js','/window-card.js','/opening-card.js','/stair-card.js','/parking-card.js','/wall-fillet-card.js','/layer-tools.js','/area-tools.js','/shape-tools.js','/multi-tools.js','/curtainwall-card.js','/handrail-card.js','/column-card.js','/insulation-card.js','/block-xref-tools.js','/symbol-tools.js','/dim-hatch-tools.js','/output-tools.js','/escalator-card.js','/structure-card.js','/site-draw-card.js','/unfold-card.js','/graphic-card.js','/hatch-table-tools.js','/dim-symbol-tools.js','/block-edit-tools.js','/text-edit-tools.js','/sheet-plot-tools.js','/edit-calc-tools.js','/text-create-tools.js','/trim-tools.js','/draw-cards-3.js','/layer-tools-4.js','/multi-tools-4.js','/trim-shape-tools-4.js','/structure-cards-4.js','/block-text-tools-4.js','/dim-tools-4.js','/table-sheet-tools-4.js','/text-edit-tools-4.js','/area-select-tools-4.js','/symbol-output-tools-4.js','/별도개발/건축CAD보조명령/menu-prototype.html','/별도개발/건축CAD보조명령/src/menu-prototype.js','/별도개발/건축CAD보조명령/src/reference-command-catalog.js','/별도개발/건축CAD보조명령/src/reference-command-engine.js','/별도개발/건축CAD보조명령/src/reference-command-icons.js','/별도개발/건축CAD보조명령/src/reference-command-icons-v2.js','/apartment-wait-frame.js','/wait-screens/apartment.html','/wait-screens/apartment-embed.js','/wait-screens/apt_example.js','/wait-screens/site.html','/wait-screens/site_example.js','/wait-screens/site-wait-frame.js','/drafting-wait-frame.js','/drafting-wait-data.js','/wait-screens/drafting.html','/wait-screens/drafting-main.js','/wait-screens/detail_data.js'})
        # 5.0.4 검토 수정: 카드 공통 입력·패턴·작업축 모듈과 판 번호(package.json) 표시용.
        allowed.update({'/bim-envelope.js','/ifc-writer.js','/storeys.js','/renovation.js','/card-input.js','/pattern-files.js','/snap-angle.js','/group-file-tools.js','/package.json','/command-search.js','/command-history-shortcut.js','/form-controls.js','/calculator-shortcut.js','/lisp-question-queue.js'})
        allowed.update({'/layer-states.js','/layer-filters.js','/layer-reconcile.js','/layer-manager.js','/viewport-layers.js','/paper-space.js','/named-views.js','/units.js','/scale-input.js','/color-books.js','/publish-list.js','/cad-prefs.js','/rollover-tip.js','/acad200-s7.js','/s7-command-names.js'})   # ACAD200 s7
        # ACAD200 영역 6(블록·속성·외부참조·데이터) 모듈
        allowed.update({'/shared-blocks.js','/block-count-live.js','/data-extraction.js','/block-spot.js','/side-docs.js','/xref-tools.js','/drawing-compare.js','/underlay.js','/image-underlay.js','/image-commands.js','/image-render.js','/block-workset.js','/block-data-tools.js'})
        allowed.update({'/cad-properties.js','/property-tools.js','/hatch-patterns.js','/hatch-pattern-library.js','/drafting-tools.js','/text-fonts.js','/annotation-scale.js','/grid-tools.js','/dim-sequence.js','/mleader-tools.js','/quick-menu.js','/smart-dim.js','/dimension-preview.js','/dimension-extra.js','/dimension-break-preview.js','/dimension-export.js','/sheet-edit-tools.js','/block-library.js','/title-tools.js','/detail-library.js'})  # 2026-09-26 AutoCAD 특성 패널(현재 색·선종류·CHPROP)
        allowed.add('/jutong-insertion.js')
        allowed.add('/screen-vault.js')  # 잠근 화면 코드 불러오기(도면 생성기·상세, 설치판은 엔진이 메모리에서 내줌)
        allowed.add('/indong-client.js')  # 인동거리 검토(계산은 설계 엔진 서버)
        allowed.add('/unit-insertion.js')
        allowed.add('/drawing-cleanup.js')  # 6.0.15 PURGE·OVERKILL·AUDIT 순수 계획 함수
        allowed.add('/extent-core.js')  # 7.0.13 전체 보기에서 멀리 떨어진 객체 빼기
        allowed.add('/delivery-check.js')  # 7.0.13 납품 전 점검(기존 정리 도구 모음 + A- 레이어·A3 글자)
        allowed.update({'/review-table.js','/review-3d-law.js','/review-3d-law-geometry.js'})  # 법규 3D 보기 전용 모듈
        allowed.update({'/review-3d-sun.js','/sun-study.js','/review-3d-walk.js','/material-presets.js','/wind-load.js','/ai-asks.js','/ai-consent.js'})  # 7.0.13 3D 일조 띠(날짜·시각 그림자, 일조 확보 칸)
        allowed.add('/layer-name-groups.js')  # 레이어 정리 이름 묶음 확인(2026-10-21)
        allowed.add('/drawing-check.js')
        allowed.add('/roof-geometry.js')  # 3D 검토용 순수 지붕 면 계산
        allowed.add('/layer-number-tools.js')  # 2026-09-26 H12·H07 레이어 번호(LAYNUM · LN3)
        allowed.update({'/ai-work-band.js','/ai-commit.js','/ai-draw-reveal.js','/ai-draw-reveal-player.js','/wait-stage.js','/site-plan-wait.js','/site-plan-wait-scene.js','/wait-model-progress.js','/model-work.js','/drawing-open-preview.js'})
        allowed.add('/lisp-worker.js')  # 5.0.4 검토 수정(B): 리습 전용 Worker(화면 스레드 밖에서 실행·중지)
        allowed.update({'/shared-account-adapter.js','/shared/account-window/renderer.mjs','/shared/account-window/model.mjs','/shared/account-window/icons.mjs','/shared/account-window/account-window.css','/shared/account-window/popover.mjs','/shared/account-window/popover-model.mjs','/shared/account-window/account-popover.css','/shared/account-window/contract/account-window.json','/shared/account-window/shared-assets/kakao-symbol-approved.svg','/shared/account-window/shared-assets/google-g.svg'})  # 공통 계정 및 업데이트 창(중앙 판 2.1.0-r1, 팝오버)
        allowed.add('/pgp-aliases.js')  # H05 acad.pgp 가져오기·내보내기 · 명령 하나에 별칭 여러 개
        allowed.update({'/gpu-order-index.js','/gpu-record-upload.js','/packed-bounds-index.js','/display-instance.js','/gpu-controller.js','/gpu-transparent-batches.js','/gpu-scene-matrices.js','/gpu-opaque-batches.js','/gpu-pattern-parameters.js','/gpu-view-safety.js','/gpu-renderer.js','/gpu-spatial.js','/gpu-scene.js','/gpu-fills.js','/gpu-edit-translation.js','/vendor/mlightcad.js'})
        allowed.add('/snap-intersections.js')
        allowed.update({'/input-assist.js','/selection-assist.js','/grip-tools.js','/snap-assist.js','/input-prefs.js'})  # ACAD200 영역 3 선택·스냅·입력·그립
        allowed.add('/barun-air.css')  # 바른문서와 같은 D-2 화면 테마
        allowed.add('/display-picking.js')
        allowed.update({'/gpu-selection-overlay.js','/gpu-selection-source.js','/gpu-selection-shared.js','/gpu-selection-transform.js','/gpu-selection-dashes.js'})
        allowed.add('/recovery-chunks.js')
        allowed.update({'/pad-crypto.js','/pad-ops.js','/pad-viewer.js','/pad-share.js','/pad.css','/pad-pack.js','/pad-gl.js','/pad-snap.js','/pad-records-log.js','/pad-hub.js'})  # 패드 원격 수정 1단계 · 머리줄 [패드 연결] 묶음(10-19)
        allowed.update({'/entity-refs.js','/history-delta.js','/low-memory.js','/handle-table.js','/entity-stubs.js','/undo-log.js','/bcad-store.js'})  # ACAD200 영역 2: 역참조·되돌리기 차이·저메모리·스텁 표·증분 저장
        allowed.update({'/layer-standards.js','/layer-standards-data.js','/layer-migration.js'})
        allowed.update({'/card-registry.js','/command-runner.js','/command-worker.js','/wall-detect-command.js','/drawing-generator.js','/paper-sizes.js','/drawing-sync.js','/drawing-set-command.js','/planset-command.js','/drawing-quality.js','/access-plan.js','/access-plan-rules.js','/access-plan-command.js','/access-plan-mark.js'})  # 건축 요소 명령 화면 없는 실행(AI·리습)
        # OCCT 건물 도면 생성은 첫 명령 때 Worker가 로드하는 지연 자산이다.
        allowed.update({'/occt-client.js','/occt-worker.js','/occt-loader.js','/occt-building.js','/occt-kernel.js','/occt-section.js','/occt-commands.js'})
        allowed.update({'/vendor/occt-pkg/package.json','/vendor/occt-pkg/NOTICE.md','/vendor/occt-pkg/node_modules/replicad-opencascadejs/LICENSE','/vendor/occt-pkg/node_modules/replicad-opencascadejs/dist/replicad_single.js','/vendor/occt-pkg/node_modules/replicad-opencascadejs/dist/replicad_single.wasm'})
        allowed.update({'/drawing-details/kit.js','/drawing-details/knowledge.js','/drawing-details/registry.js','/drawing-details/basic.js','/drawing-details/checks.js','/drawing-details/wall.js','/drawing-details/window.js','/drawing-details/steel.js','/drawing-details/floor.js','/drawing-details/roof.js','/drawing-details/stair.js','/drawing-details/fire.js','/drawing-details/parking.js','/drawing-details/access.js','/drawing-details/interior.js','/drawing-details/plan-geometry.js','/drawing-details/plan-alignment.js','/drawing-details/plan-dimension-quality.js','/drawing-details/plan-layout.js','/drawing-details/plan-labels.js','/drawing-recipes.js'})
        allowed.update({'/cad-asset-client.js','/cad-asset-preview.js','/library-card-icons.js','/detail-search-panel.js','/detail-search-index.js','/detail-search-actions.js','/drawing-details/source-decisions.json','/drawing-details/kit.js','/drawing-details/registry.js','/drawing-details/basic.js','/drawing-details/checks.js','/drawing-details/wall.js','/drawing-details/floor.js','/drawing-details/roof.js','/drawing-details/stair.js','/drawing-details/fire.js','/drawing-details/parking.js','/drawing-details/access.js','/drawing-details/interior.js'})
        allowed.add('/entity-index.js')  # engine.js·geometry.js 가 쓰는 확정 객체 배열 색인
        allowed.add('/structure-drawing.js')
        allowed.update({'/compute-client.js','/plan-quality-client.js','/plan-quality-scope.js','/planset-shared.js'})  # 서버 계산 부르기(계산 코드는 바른 서버에만, compute/)
        allowed.add('/structure-certificate.js')
        allowed.add('/structure-schedule.js')
        allowed.add('/structure-preliminary.js')
        allowed.add('/gpu-polyline-lod.js')
        allowed.update({'/gpu-compile-client.js','/gpu-compile-worker.js','/gpu-compile-job.js'})
        allowed.update({'/file-care.js','/file-care-commands.js','/gpu-record-reuse.js'})  # ACAD200 영역 8: 파일 안전·복구·스크립트
        allowed.update({'/display-quality.js','/gpu-lod-policy.js','/canvas-imposters.js','/regen-interrupt.js','/gpu-transparency.js','/gpu-draw-order.js','/preview-matrix.js','/raster-mip-cache.js','/gpu-batch-edit.js','/gpu-edit-mask.js','/gpu-regen-queue.js','/gpu-tessellation-range.js','/gpu-memory-meter.js','/gpu-instance-pools.js','/gpu-raster-cache.js','/gpu-linetype-scale.js'})  # ACAD200 영역 1(그래픽·성능)
        allowed.update({'/gpu-render-client.js','/gpu-render-worker.js','/gpu-render-protocol.js'})
        allowed.update({'/color-picker.js','/properties-palette.js','/properties-dock.js','/expression-calculator.js'})  # 2026-09-30 속성 팔레트·색 선택기·계산기
        allowed.update({'/text-codes.js','/text-justify.js','/text-inline-editor.js','/text-measure.js','/shx-font.js','/text-style.js','/text-fields.js','/block-attributes.js','/text-annotation-commands.js','/scale-list.js','/text-find.js','/table-datalink.js','/spell-check.js','/dim-assoc.js'})  # ACAD200 영역 5 문자·주석·치수·지시선·표
        allowed.update({'/curve-edit.js','/assoc-edit.js','/constraints.js','/edit-commands-s4.js'})  # ACAD200 영역 4 그리기·편집
        # 묶음 빌드가 만든 공용 조각. 이름에 해시가 붙어 미리 적어 둘 수 없다.
        is_chunk=bool(re.fullmatch(BUNDLE_CHUNK_PATTERN,path))
        if path not in allowed and not is_example and not is_chunk:
            self.send_error(404);return
        # 설치판은 OCCT 실행 파일을 싣지 않는다(설치본 줄이기). 묶음에 없으면 처음 쓸 때 받아 캐시에서 준다.
        import occt_remote
        occt_name=occt_remote.name_of(path)
        if occt_name and not Path(self.translate_path(path)).is_file():
            try:body=occt_remote.fetch(occt_name).read_bytes()
            except ValueError as error:self.json_response({'error':str(error)},503);return
            self.send_response(200);self.send_header('Content-Type','application/wasm' if occt_name.endswith('.wasm') else 'text/javascript; charset=utf-8')
            self.send_header('Content-Length',str(len(body)));self.end_headers();self.wfile.write(body);return
        super().do_GET()

    def do_PUT(self):
        # 모의 창고(개발 전용, BARUN_PAD_MOCK=1): 서명 주소 PUT 흉내.
        if pad_relay_mock.enabled() and pad_relay_mock.handle(self,'PUT'):return
        self.send_error(405)

    def do_DELETE(self):
        if pad_relay_mock.enabled() and pad_relay_mock.handle(self,'DELETE'):return
        self.send_error(405)

    def do_POST(self):
        data=None
        self.output_job_id=None
        def release_failed_save():
            if self.path=='/api/export' and isinstance(data,dict) and data.get('saveToken'):consume_save_target(data['saveToken'])
        # 모의 중계는 barunarc.co.kr 공개 API 흉내라 CAD 토큰을 받지 않는다(패드 브라우저가 부른다). 개발 전용.
        if pad_relay_mock.enabled() and self.path.startswith(pad_relay_mock.PREFIX) and pad_relay_mock.handle(self,'POST'):return
        expected=f'http://127.0.0.1:{self.server.server_port}'
        supplied=self.headers.get('X-CAD-Token','').encode()
        screen=secrets.compare_digest(supplied,TOKEN.encode())
        # 연결 파일 토큰(MCP_TOKEN)은 허락 요청(/api/mcp-hello)만 연다. /api/mcp 는 CAD 화면에서 허락받은 중계의 열쇠로만(ai_consent.py).
        connection=secrets.compare_digest(supplied,MCP_TOKEN.encode())
        grant=consent_error=None
        if self.path=='/api/mcp' and not screen:
            try:grant=ai_consent.check_grant(self.headers.get('X-CAD-Token',''))
            except ai_consent.ConsentError as error:consent_error=error
        if self.headers.get('Origin')!=expected or not (screen or grant or (connection and self.path=='/api/mcp-hello')):
            if self.headers.get('Origin')==expected and self.path=='/api/mcp' and (connection or consent_error):
                error=consent_error or ai_consent.ConsentError('consent_required',ai_consent.GRANT_ONLY)
                self.json_response({'error':str(error),'code':error.code,'details':error.details},403);return
            self.json_response({'error':'이 CAD 화면에서 요청을 다시 실행하세요.'},403);return
        asset_route=re.fullmatch(r'/api/cad-asset/(detail|unit|jutong)/([^/]+)',self.path)
        if not asset_route and self.path not in ('/api/cad-asset/catalog','/api/compute','/api/miriboda','/api/apartment','/api/detail-search','/api/indong','/api/pad-qr','/api/pad-relay','/api/pad-report','/api/field-records','/api/design-cases','/api/permit-book','/api/hatch-boundary','/api/lisp','/api/import','/api/import-path','/api/export','/api/pdf','/api/project','/api/excel','/api/shp','/api/bridge','/api/mcp','/api/mcp-hello','/api/ai-consent','/api/chat','/api/regions','/api/restore','/api/parcel','/api/account','/api/convert','/api/convert-file','/api/site-plan/from-drawing','/api/site-plan/generate','/api/site-plan/validate','/api/site-plan/jobs','/api/site-plan/artifact','/api/auto-plan','/api/plot-style','/api/plan-import','/api/pdf-import','/api/tablet','/api/realtime','/api/shutdown','/api/recovery','/api/save-target','/api/output-jobs','/api/screen-vault','/api/image-read'):
            self.json_response({'error':'지원하지 않는 API'},404);return
        try:
            size=int(self.headers.get('Content-Length','0'))
            job=self.headers.get('X-CAD-Output-Job')
            if job and self.path in ('/api/export','/api/pdf','/api/convert-file'):
                import output_jobs
                if output_jobs.claim(job,self.path.rsplit('/',1)[-1]):self.output_job_id=job
            progress=(lambda event:output_jobs.update(self.output_job_id,**event)) if self.output_job_id else None
            if self.path=='/api/image-read':
                if size<=0 or size>8192:raise ValueError('이미지 읽기 요청이 올바르지 않습니다.')
                data=json.loads(self.rfile.read(size))
                self.json_response(image_service.image_read(data.get('path') if isinstance(data,dict) else None));return
            if self.path=='/api/import' and self.headers.get('Content-Type','').startswith('application/octet-stream'):
                if size<=0 or size>250_000_000:raise ValueError('파일은 250 MB 이하만 지원합니다.')
                extension=self.headers.get('X-CAD-Import','').lower()
                if extension not in ('.dwg','.dxf'):raise ValueError('DXF 또는 DWG 파일을 선택하세요.')
                raw=self.rfile.read(size)
                if len(raw)!=size:raise ValueError('파일 전송이 중단되었습니다. 다시 시도하세요.')
                self.import_response(raw,extension);return
            if self.path=='/api/convert-file':
                from batch_converter import process
                if size<=0 or size>250_000_000:raise ValueError('파일은 250 MB 이하만 지원합니다.')
                data=json.loads(unquote(self.headers.get('X-CAD-Convert','{}')))
                if not isinstance(data,dict):raise ValueError('변환 요청 형식이 올바르지 않습니다.')
                data={k:v for k,v in data.items() if not str(k).startswith('_')}   # _keep_document 같은 내부 표시는 화면에서 넣을 수 없다
                data['action']='convert'
                data['_raw']=self.rfile.read(size)
                if len(data['_raw'])!=size:raise ValueError('파일 전송이 중단되었습니다. 다시 시도하세요.')
                if progress:progress({'phase':'convert','name':data.get('name','')})
                converted=process(data)
                if progress:progress({'phase':'record','name':data.get('name','')})
                self.json_response(converted);return
            if self.path=='/api/shutdown':
                # S15/S13: 셸이 강제 종료하기 전에 남은 복구 내용을 내려쓰고 스스로 닫는다.
                if size>0:self.rfile.read(min(size,32768))
                bridge.flush_recovery()
                self.json_response({'ok':True})
                threading.Thread(target=self.server.shutdown,daemon=True).start();return
            if self.path=='/api/save-target':
                # N1: 셸(저장 대화상자)만 저장 경로를 등록할 수 있다. 화면 코드는 셸 비밀을 모른다.
                if not SHELL_SECRET or not secrets.compare_digest(self.headers.get('X-CAD-Shell',''),SHELL_SECRET):
                    self.json_response({'error':'저장 위치는 데스크톱 앱의 저장 대화상자에서만 정할 수 있습니다.'},403);return
                if size<=0 or size>8192:raise ValueError('저장 위치 요청이 올바르지 않습니다.')
                data=json.loads(self.rfile.read(size))
                action=data.get('action','register')
                if action=='cancel':consume_save_target(data.get('saveToken'));self.json_response({'cancelled':True});return
                if action=='commit':
                    token=data.get('saveToken')
                    try:
                        entry=save_target_entry(token)
                        expected=entry['path']+'.'+token+'.tmp'
                        if data.get('tempPath')!=expected:raise ValueError('저장 임시 파일이 예약과 다릅니다.')
                        result=entry['transaction'].commit_temp(expected,assert_current=entry['check'])
                        self.json_response({**result,'saved':True});return
                    finally:consume_save_target(token)
                if action!='register':raise ValueError('지원하지 않는 저장 작업')
                self.json_response(register_save_target(data.get('path'),data.get('format'),data));return
            ndjson=self.headers.get('Content-Type','').startswith('application/x-ndjson')
            if ndjson:
                # S1: 화면이 대용량 문서를 줄 단위로 보낸다(저장·내보내기·대용량 복구). 한 줄씩 해석한다. N4: 이 두 경로만.
                if self.path not in NDJSON_ROUTES:raise ValueError('이 요청은 줄 단위 본문을 받지 않습니다.')
                if size<=0 or size>NDJSON_REQUEST_MAX_BYTES:raise ValueError('요청 크기가 너무 크거나 비어 있습니다.')
                self.connection.settimeout(BODY_READ_TIMEOUT)
                try:
                    if self.path=='/api/recovery':
                        # 대용량 복구: 문서를 메모리에 올리지 않고 요청 줄을 그대로 gzip NDJSON 복구 파일로 저장한다.
                        self.json_response(bridge.store_large_recovery(self.rfile,size));return
                    assembled=import_stream.read_request(self.rfile,size)
                except (TimeoutError,ConnectionError,OSError) as error:
                    # N3: 본문이 오다 말았다(Content-Length 보다 짧게 끊김). 온라인 오류가 아니라 요청 오류로 알린다.
                    raise ValueError('요청 본문이 중간에 끊겼습니다. 저장을 다시 실행하세요.') from error
                finally:self.connection.settimeout(self.timeout)
                data={**(assembled.get('report') or {}),'document':assembled['document']}
            else:
                if self.path=='/api/recovery':raise ValueError('대용량 복구 요청은 줄 단위 형식만 받습니다.')
                if size<=0 or size>400_000_000:raise ValueError('요청 크기가 너무 크거나 비어 있습니다.')
                self.connection.settimeout(BODY_READ_TIMEOUT if size>1_000_000 else self.timeout)
                try:raw=self.rfile.read(size)
                except (TimeoutError,ConnectionError,OSError) as error:raise ValueError('요청 본문이 중간에 끊겼습니다. 다시 실행하세요.') from error
                finally:self.connection.settimeout(self.timeout)
                if len(raw)!=size:raise ValueError('요청 본문이 중간에 끊겼습니다. 다시 실행하세요.')
                data=json.loads(raw)
            if self.path=='/api/screen-vault':
                # 바로 그려야 하는 화면 핵심 코드(도면 생성기·상세): 화면 토큰을 낸 이 CAD 화면에만, 로그인 세션 동안만 내준다(vault_gate.screen_bundle).
                import vault_gate
                result=vault_gate.screen_bundle()
                if result['state']=='locked':
                    import miri_account_service
                    token=miri_account_service._load_token()
                    if token and vault_gate.ensure_screen(token,force=True)['screen']=='unlocked':result=vault_gate.screen_bundle()
                self.json_response(result,403 if result['state']=='locked' else 200);return
            if self.path=='/api/output-jobs':
                import output_jobs
                action=data.get('action')
                if action=='create':
                    kind=data.get('kind')
                    if kind not in ('export','pdf','convert-file'):raise ValueError('지원하지 않는 출력 작업입니다.')
                    result=output_jobs.create(kind)
                elif action=='status':
                    result=output_jobs.status(data.get('jobId'))
                    if result is None:self.json_response({'error':'출력 작업을 찾지 못했습니다.'},404);return
                else:raise ValueError('지원하지 않는 출력 상태 요청입니다.')
                self.json_response(result);return
            if self.path=='/api/cad-asset/catalog' or asset_route:
                import cad_asset_client as assets
                if not isinstance(data,dict):raise ValueError('자산 요청 형식이 올바르지 않습니다.')
                result=assets.catalog(data.get('kind')) if not asset_route else assets.get_asset(asset_route[1],unquote(asset_route[2]))
                self.json_response(result);return
            if self.path=='/api/indong':
                import indong_relay
                try:self.json_response(indong_relay.process(data))
                except indong_relay.IndongError as error:self.json_response(error.response(),error.status)
                return
            if self.path=='/api/detail-search':
                from detail_search_library import process
                self.json_response(process(data));return
            if self.path=='/api/compute':
                from compute_service import process as compute
                result,status=compute(data)
                self.json_response(result,status);return
            if self.path=='/api/apartment':
                from apartment_service import process
                self.json_response(process(data));return
            if self.path=='/api/miriboda':
                from miriboda_service import process
                self.json_response(process(data));return
            if self.path=='/api/design-cases':
                from design_case_service import process
                self.json_response(process(data));return
            if self.path=='/api/permit-book':   # 인허가 도서 창(에너지·편의시설 도서 엔진)
                from permit_book_service import process
                self.json_response(process(data));return
            if self.path=='/api/site-plan/from-drawing':
                from miriboda_service import enrich_drawing
                self.json_response(enrich_drawing(data));return
            if self.path=='/api/hatch-boundary':
                from hatch_service import boundary
                self.json_response(boundary(data));return
            if self.path in ('/api/site-plan/jobs','/api/site-plan/artifact'):
                from site_plan_service import process_jobs, process_artifact
                result,status=(process_jobs if self.path.endswith('/jobs') else process_artifact)(data)
                self.json_response(result,status);return
            if self.path in ('/api/site-plan/generate','/api/site-plan/validate'):
                from site_plan_service import process
                result,status=process(data,self.path.rsplit('/',1)[-1])
                self.json_response(result,status);return
            if self.path=='/api/lisp':
                from lisp_service import process
                # The screen owns the native LISP panel; MCP only reaches the restricted Worker via /api/mcp.
                clean={k:v for k,v in data.items() if not str(k).startswith('_') and k!='ai'}
                if data.get('aiRequestId'):
                    bridge.validate_app_request(data.get('aiRequestId'),data.get('aiRecipient'))
                    clean['ai']=True
                    clean['_login_epoch']=bridge.pending_requests[data['aiRequestId']]['login_epoch']
                identity={k:data[k] for k in ('aiRequestId','aiRecipient') if k in data}
                self.json_response(process(clean,assert_current=save_authorizer(identity)));return
            if self.path=='/api/realtime':
                from realtime_voice import create
                self.json_response(create(data));return
            if self.path=='/api/pad-relay':
                import pad_relay
                self.json_response(pad_relay.forward(data));return
            if self.path=='/api/pad-qr':
                # 패드 링크 QR. 링크(열쇠 포함)는 이 PC 안에서만 그림으로 바꾸고 어디에도 보내지 않는다.
                import io as _io,qrcode,qrcode.image.svg
                link=str(data.get('text',''))
                if not link.startswith(('https://','http://127.0.0.1','http://localhost')) or len(link)>600:raise ValueError('패드 링크가 올바르지 않습니다.')
                stream=_io.BytesIO();qrcode.make(link,image_factory=qrcode.image.svg.SvgPathImage).save(stream)
                self.json_response({'qr':'data:image/svg+xml;base64,'+base64.b64encode(stream.getvalue()).decode()});return
            if self.path=='/api/tablet':
                import tablet
                self.json_response(tablet.local(data));return
            if self.path=='/api/plan-import':
                from plan_service import read_generated_dxf
                self.json_response(read_generated_dxf(base64.b64decode(data['data'],validate=True)));return
            if self.path=='/api/pdf-import':
                # PDFIMPORT: PDF 한 쪽의 벡터를 객체로. 명령을 실행했을 때만 불린다.
                from pdf_import import process as pdf_import
                self.json_response(pdf_import(data));return
            if self.path=='/api/plot-style':
                import plot_style
                self.json_response(plot_style.parse(data));return
            if self.path=='/api/auto-plan':
                from plan_service import generate
                if os.environ.get('BARUN_SITE_PLAN_MOCK')=='1' and isinstance(data,dict) and data.get('siteEngine'):
                    from site_plan_service import process
                    result,status=process(data['siteEngine'],'generate')
                else:result,status=generate(data)
                self.json_response(result,status);return
            import exchange
            if self.path=='/api/convert':
                from batch_converter import process
                if isinstance(data,dict):data={k:v for k,v in data.items() if not str(k).startswith('_')}   # 내부 표시(_로 시작)는 서버 안에서만
                self.json_response(process(data));return
            if self.path=='/api/parcel':
                from parcel_service import process
                self.json_response(process(data));return
            if self.path=='/api/import-path':
                if size<=0 or size>32_768:raise ValueError('도면 경로 요청이 올바르지 않습니다.')
                # The JSON request body was already read above. Reading it again blocks forever
                # because the desktop client correctly sends only Content-Length bytes once.
                import project;project.network_path(data.get('path',''))
                source=Path(bridge.on_disk_path(str(Path(str(data.get('path',''))).resolve())));extension=str(data.get('extension','')).lower()
                if extension not in ('.dwg','.dxf') or source.suffix.lower()!=extension:raise ValueError('DXF 또는 DWG 파일을 선택하세요.')
                # ACAD200-809: 복구해서 열기(DWGRECOVER) — 구조를 살리는 읽기로 따로 변환·캐시한다(원본은 바꾸지 않는다).
                path,hit=cached_import_path_body(source,extension,recover=bool(data.get('recover')))
                self.stream_response(path,hit)
                return
            if self.path=='/api/account':
                from miri_account_service import process
                self.json_response(process(data));return
            if self.path=='/api/restore':
                if data.get('probe'):
                    # 복구본 목록만(내용 없이): 화면이 IndexedDB 보관본과 시각을 비교해 더 새로운 쪽을 되살린다.
                    self.json_response({'sources':bridge.recovery_sources()});return
                result=bridge.restore()
                if result.get('largeRecoveryPath'):
                    # 대용량 복구본은 저장된 그대로 줄 단위 스트림으로 돌려준다(화면은 receiveImportStream 으로 조립).
                    self.stream_response(Path(result['largeRecoveryPath']),True);return
            elif self.path=='/api/regions':
                from region_service import process
                result=process(data)
            elif self.path=='/api/chat':
                from chat_router import process
                result=process(data)
            elif self.path=='/api/bridge':
                result=bridge.pulse(data)
                refresh_connection_file()
            elif self.path=='/api/mcp':
                result=bridge.call(data['name'],data.get('arguments',{}))
            elif self.path=='/api/mcp-hello':
                # 로그인(카카오·구글 등 [계정 연결] 어느 것이든) 안 된 CAD 에는 AI 프로그램이 연결조차 못 한다(사용자 2026-10-25). 허락 창도 띄우지 않는다.
                import miri_account_service;miri_account_service.require_ai_login()
                who=ai_consent.identify(self.client_address[1],self.server.server_port)
                result=ai_consent.hello(who,data.get('client'),data.get('wait',ai_consent.WAIT_SECONDS),has_screen=bridge.has_screen)
            elif self.path=='/api/ai-consent':
                result=ai_consent.process(data)
            elif self.path=='/api/project':
                import project
                action=data['action']
                # 감사 4: 화면은 외부참조 read·stat 만 쓴다. 예전 PROJECT 의 open·settings·save(아무 폴더에 아무 파일 쓰기)는 없앴다 — AI 저장은 bridge 가 project.save 를 직접 부른다.
                if action=='read':
                    f=project.target(data['folder'],data['name'],data.get('baseFolder'));st=f.stat();result={'data':base64.b64encode(f.read_bytes()).decode(),'extension':f.suffix,'fingerprint':f'{st.st_size}:{st.st_mtime_ns}'}
                elif action=='stat':
                    # 618 XREFNOTIFY: 원본 파일 지문(크기·수정 시각)만. 내용은 읽지 않는다.
                    f=project.target(data['folder'],data['name'],data.get('baseFolder'));st=f.stat();result={'size':st.st_size,'mtimeMs':st.st_mtime*1000,'fingerprint':f'{st.st_size}:{st.st_mtime_ns}'}
                else:raise ValueError('지원하지 않는 프로젝트 작업')
            elif self.path=='/api/shp':
                from gis_service import process
                result=process(data)
            elif self.path=='/api/excel':
                from excel_service import process
                result=process(data)
            elif self.path=='/api/pad-report':
                from pad_report import process
                result=process(data)
            elif self.path=='/api/field-records':
                from field_records import process
                try:result=process(data)
                except OSError as error:
                    self.json_response({'error':'현장 기록 폴더에 쓰지 못했습니다: '+str(error)},503);return
            elif self.path=='/api/pdf':
                from pdf_service import process
                result=process(data,progress=progress) if progress else process(data)
            elif self.path=='/api/import':
                result=exchange.import_file(base64.b64decode(data['data'],validate=True),data['extension'])
            else:
                if 'targetPath' in data:raise ValueError('저장 경로는 직접 지정할 수 없습니다. 저장 대화상자를 사용하세요.')
                export_started=time.perf_counter();timings={}
                fmt=data.get('format') if data.get('format') in ('bcad','dwg') else 'dxf'
                target=take_save_target(data['saveToken'],fmt) if data.get('saveToken') else None
                dwg=None
                if data.get('dryRun'):
                    # ACAD200-806: 구버전으로 저장하기 전에 '단순화·제외되는 것'만 미리 알려 준다(파일은 쓰지 않는다).
                    self.json_response(file_care.version_loss_preview(lambda:exchange.export_dxf(data['document'],data.get('version','R2018'))));return
                if progress:progress({'phase':'dxf','objects':len(data['document'].get('entities',[]))})
                stage_started=time.perf_counter()
                if fmt=='bcad':content=json.dumps(data['document'],ensure_ascii=False,separators=(',',':')).encode('utf-8');warnings=[]  # 감사 7: 들여쓰기 없이 — 15만 객체 기준 파일 크기 절반(36→16 MB), 쓰기 0.20→0.16초
                else:content,warnings=exchange.export_dxf(data['document'],data.get('version','R2018'),timings_ms=timings)
                timings['serialize']=round((time.perf_counter()-stage_started)*1000,3)
                # ACAD200-815: 화면이 만든 미리보기 그림(BMP)을 DXF THUMBNAILIMAGE 구역에 넣는다(AutoCAD 열기 창·탐색기 미리보기).
                if fmt=='dxf' and data.get('thumbnail'):content=file_care.add_dxf_thumbnail(content,data.get('thumbnail'))
                if fmt=='dwg':
                    # DWG 저장: 위와 똑같이 만든 DXF 를 '도면 변환'과 같은 내장 엔진으로 바꾼다. 중간 파일은 임시 폴더에서만 쓰고 지운다.
                    from batch_converter import dxf_to_dwg
                    stage_started=time.perf_counter()
                    content,dwg=dxf_to_dwg(content,data.get('dwgVersion','2018'),progress=progress) if progress else dxf_to_dwg(content,data.get('dwgVersion','2018'))
                    timings.update({'converter_'+key:value for key,value in (dwg.get('timings_ms') or {}).items()})
                    timings['conversion']=round((time.perf_counter()-stage_started)*1000,3)
                    warnings=[*warnings,*dwg['warnings']]
                    dwg={key:value for key,value in dwg.items() if key!='warnings'}
                if progress:progress({'phase':'record','bytes':len(content)})
                if target is not None:
                    entry=save_target_entry(data['saveToken'],fmt)
                    try:result={**export_to_path(content,target,fmt,transaction=entry['transaction'],assert_current=entry['check']),'warnings':warnings}
                    finally:consume_save_target(data['saveToken'])   # 성공했을 때만 토큰 소모
                else:
                    if len(content)>250_000_000:raise ValueError('결과가 250 MB를 넘어 화면으로 돌려보낼 수 없습니다. 데스크톱 앱의 저장 대화상자로 저장하세요.')
                    result={'data':base64.b64encode(content).decode('ascii'),'warnings':warnings}
                if dwg is not None:result['dwg']=dwg
                timings.update(result.get('timings_ms') or {})
                timings['export_total']=round((time.perf_counter()-export_started)*1000,3)
                result['timings_ms']=timings
                del content
            self.json_response(result)
        except ai_consent.ConsentError as error:
            self.json_response({'error':str(error),'code':error.code,'details':error.details},403)
        except bridge.CADToolError as error:
            release_failed_save()
            self.json_response({'error':str(error),'code':error.code,'details':error.details},400)
        except bridge.AILoginCheckUnavailable as error:
            release_failed_save()
            self.json_response({'error':str(error),'code':error.code},503)
        except bridge.AILoginRequired as error:
            release_failed_save()
            self.json_response({'error':str(error),'code':error.code},403)
        except CadAssetError as error:
            release_failed_save()
            self.json_response(error.response(),error.status)
        except ImportError:
            release_failed_save()
            self.json_response({'error':'이 기능의 내장 구성요소가 누락되었습니다. 바른 CAD 설치 파일로 복구하세요. 도면은 유지됩니다.'},503)
        except (URLError,TimeoutError,ConnectionError):
            release_failed_save()
            self.json_response({'error':'온라인 서비스에 연결하지 못했습니다. 인터넷 연결을 확인하세요. 로컬 작도와 저장은 계속 사용할 수 있습니다.'},503)
        except Exception as error:
            release_failed_save()
            if sys.stderr is not None and not isinstance(error,ValueError):
                import traceback;traceback.print_exc()
            self.json_response({'error':user_error_message(error)},400)
        finally:
            if self.path=='/api/export' and isinstance(locals().get('data'),dict) and data.get('saveToken'):consume_save_target(data['saveToken'])

def connection_file(port,base=None):
    """S5: 채널·포트마다 다른 연결 파일을 쓴다(3.x/Beta/5 가 한 파일을 덮어쓰던 문제)."""
    base=Path(base or os.environ.get('LOCALAPPDATA') or str(Path.home()))/'BarunCAD'
    return base/f'connection-{int(port)}.json'

def write_private_text(target,text):
    """연결 파일에는 열쇠가 들어 있다: 이 계정만 읽고 쓰게(0600) 만든다. Windows 는 사용자 폴더 권한을 따른다."""
    fd=os.open(target,os.O_WRONLY|os.O_CREAT|os.O_TRUNC,0o600)
    with os.fdopen(fd,'w',encoding='utf8') as stream:stream.write(text)
    try:os.chmod(target,0o600)   # 전에 남은 임시 파일이 더 넓은 권한이었어도 좁힌다
    except OSError:pass

def _connection_targets():
    """연결 파일 + 스토어 앱이 돌리지 않는 사본(mcp_server.connection_mirror)."""
    from mcp_server import connection_mirror
    mirror=connection_mirror(CONNECTION_FILE.parent)
    return [CONNECTION_FILE]+([mirror/CONNECTION_FILE.name] if mirror else [])

def _write_connection(path,text):
    path.parent.mkdir(parents=True,exist_ok=True)
    temp=path.with_name(path.name+'.tmp')
    # MCP 다리가 연결 파일을 읽는 순간과 겹치면 윈도우가 바꿔 쓰기를 거부해 엔진이 켜지다 죽었다(WinError 5, 2026-11-02) — 잠깐 쉬며 다시.
    write_private_text(temp,text);file_care.replace_with_retry(temp,path)

def write_connection_file(port,url,token):
    global CONNECTION_FILE
    CONNECTION_FILE=target=connection_file(port)
    text=json.dumps({'url':url,'token':token,'pid':os.getpid(),'port':int(port),'started':time.time(),'backend_generation':bridge.BACKEND_GENERATION})
    _write_connection(target,text)
    for mirror in _connection_targets()[1:]:
        try:_write_connection(mirror,text)
        except OSError:pass   # 사본은 보조 — 못 써도 기본 연결은 그대로
    return target

_connection_write_lock=threading.Lock()
_connection_signature=None
_connection_updated=0.0

def refresh_connection_file():
    """Publish tiny window metadata on change, at most one heartbeat per five seconds."""
    global _connection_signature,_connection_updated
    if not CONNECTION_FILE:return
    windows=bridge.window_list()
    signature=tuple((w['editor_session'],w['drawingPath'],w['drawingName'],w['folder'],w['focused'],w['lastActivated']) for w in windows)
    with _connection_write_lock:
        now=time.monotonic()
        if signature==_connection_signature and now-_connection_updated<5:return
        try:
            state=json.loads(CONNECTION_FILE.read_text(encoding='utf8'))
            if state.get('pid')!=os.getpid():return
            state.update(backend_generation=bridge.BACKEND_GENERATION,windows=windows,
                         focused=any(w['focused'] for w in windows),lastActivated=max((w['lastActivated'] for w in windows),default=0),seenAt=time.time())
            text=json.dumps(state,ensure_ascii=False)
            for path in _connection_targets():
                try:_write_connection(path,text)
                except OSError:pass
            _connection_signature=signature;_connection_updated=now
        except (OSError,ValueError):pass  # A read-only discovery file must never stop editor pulses.

def remove_connection_file():
    if not CONNECTION_FILE:return
    for path in _connection_targets():
        try:
            if path.is_file() and json.loads(path.read_text(encoding='utf8')).get('pid')==os.getpid():path.unlink()
        except (OSError,ValueError):pass

def drain_field_records_spool():
    from field_records import drain_spool
    while True:
        try:drain_spool()
        except OSError:pass  # 로컬 대기 폴더도 잠겨 있으면 다음 주기에 다시 시도한다.
        time.sleep(60)


def _refresh_ai_connections():
    from runtime_paths import packaged
    if not packaged():return
    try:
        import mcp_register
        changed=mcp_register.refresh_existing()
        if changed:print('AI 연결을 이 판으로 갱신했습니다: '+', '.join(changed),flush=True)
    except Exception as error:print('AI 연결 갱신 실패: '+str(error)[:200],flush=True)


def main():
    """엔진 시작. 설치판은 barun_entry.py 가 부른다(server 모듈을 기계어 .pyd 로 컴파일해도 진입점은 이 함수)."""
    import vault_gate; vault_gate.refill_enabled = True   # 엔진이 다시 켜져도 저장된 로그인으로 서버 규칙을 다시 받는다(2026-10-27)
    parser = argparse.ArgumentParser()
    parser.add_argument('--port', type=int, default=8765)
    parser.add_argument('--no-browser', action='store_true')
    parser.add_argument('--mcp',action='store_true')
    # 처음 사용자·AI 가 한 줄로 연결: "barun-cad-6-server.exe --register-mcp codex" (설치 폴더 AI-CONNECT.md 안내)
    parser.add_argument('--register-mcp',choices=('claude','codex'))
    parser.add_argument('--mcp-status',action='store_true')
    args = parser.parse_args()
    if args.register_mcp or args.mcp_status:
        import mcp_register
        sys.exit(mcp_register.main(['status'] if args.mcp_status else [args.register_mcp]))
    if args.mcp:
        # MCP 중계는 실행 중인 엔진을 찾아 쓴다. --port 를 직접 준 경우에만 그 인스턴스로 고정한다.
        if any(item=='--port' or item.startswith('--port=') for item in sys.argv[1:]):os.environ['BARUN_CAD_INSTANCE']=str(args.port)
        import mcp_server
        mcp_server.serve()
        sys.exit(0)
    os.environ['BARUN_CAD_INSTANCE']=str(args.port)
    bridge.configure(str(args.port))
    url = f'http://127.0.0.1:{args.port}'
    try:
        server = LocalServer(('127.0.0.1', args.port), functools.partial(Handler, directory=str(ROOT)))
    except OSError:
        try:
            with urlopen(url+'/api/status', timeout=2) as response:
                if response.headers.get('X-Barun-CAD') != '2':
                    raise RuntimeError('foreign')
            if not args.no_browser:
                webbrowser.open(url)
            sys.exit(0)
        except SystemExit:raise
        except Exception:
            # S4: 다른 프로그램이 포트를 쓰고 있다. 셸(desktop.cjs)은 종료 코드 3 을 보고 포트 충돌로 안내한다.
            print(f'포트 {args.port}를 다른 프로그램이 사용 중이라 바른 CAD 엔진을 시작하지 못했습니다. 그 프로그램을 종료하거나 다른 포트로 실행하세요: python server.py --port {args.port + 1}',file=sys.stderr,flush=True)
            sys.exit(3)
    print(f'Barun CAD: {url}', flush=True)
    write_connection_file(args.port,url,MCP_TOKEN)
    atexit.register(remove_connection_file)
    threading.Thread(target=drain_field_records_spool,daemon=True,name='field-records-spool').start()
    # 이미 연결해 둔 Codex·Claude 설정을 이 판의 중계(설치 폴더 밖 복사본)로 바꾼다 — 업데이트 뒤에도 AI 연결이 끊기지 않게.
    threading.Thread(target=_refresh_ai_connections,daemon=True,name='mcp-refresh').start()
    # 설치 전 기능 검사 실패 기록을 로그인이 있으면 홈페이지 진단 기록으로(diagnostics_service.py, 사용자 2026-10-21)
    try:
        import diagnostics_service; diagnostics_service.start()
    except Exception: pass
    if not args.no_browser:
        webbrowser.open(url)
    converter_timer=start_converter_warmup(server)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        server.server_close()
    finally:
        if converter_timer is not None:converter_timer.cancel()
        if server.converter_warmup_cancelled is not None:server.converter_warmup_cancelled.set()
        if server.converter_warmup is not None:server.converter_warmup.cancel()
        bridge.flush_recovery()

if __name__ == '__main__':
    main()
