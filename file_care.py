"""ACAD200 영역 8: 도면 파일 안전(교체 저장 재시도·하드 링크 이전 본·저장 뒤 캐시 데우기).

AutoCAD 는 이름 바꾸기가 막히면 200·400·800 ms 쉬며 다시 하고(SaveCpp::CycleFileNames), 이전 본은 .bak 으로 돌린다.
여기서는 같은 재시도에 더해 이전 본을 복사 대신 하드 링크로 남긴다: 큰 도면에서도 즉시 끝나고, 교체(os.replace)는
한 번에 일어나므로 대상 파일이 사라지는 순간이 없다(링크를 못 거는 디스크는 예전처럼 복사).
"""
import os
import shutil
import threading
import time
from pathlib import Path

RETRY_DELAYS = (0.2, 0.4, 0.8)
BACKUP_SUFFIX = os.environ.get('BARUN_SAVE_BACKUP_SUFFIX', '.previous') or '.previous'


def _is_retryable(error):
    return isinstance(error, PermissionError) or getattr(error, 'winerror', None) in (5, 32, 33)


def keep_previous(target, suffix=None):
    """이전 본을 보존한다. 이미 있는 백업은 삭제하거나 덮어쓰지 않는다."""
    import uuid
    target = Path(target)
    suffix = BACKUP_SUFFIX if suffix is None else suffix
    if not suffix or not target.is_file():
        return None
    keep = target.with_name(target.name + suffix)
    while True:
        try:
            os.link(target, keep)
            return 'link'
        except FileExistsError:
            keep = target.with_name(target.name + suffix + '.' + uuid.uuid4().hex)
            continue
        except (OSError, NotImplementedError, AttributeError):
            try:
                # Exclusive creation also protects against another backup writer.
                with keep.open('xb') as destination:
                    try:
                        with target.open('rb') as source:
                            shutil.copyfileobj(source, destination, length=1024 * 1024)
                        destination.flush()
                        os.fsync(destination.fileno())
                    except BaseException:
                        destination.close()
                        keep.unlink(missing_ok=True)
                        raise
                return 'copy'
            except FileExistsError:
                keep = target.with_name(target.name + suffix + '.' + uuid.uuid4().hex)
                continue
            except OSError:
                return None


def replace_with_retry(temp, target, delays=RETRY_DELAYS, sleep=time.sleep, replace=os.replace):
    """temp 를 target 으로 바꾼다. 백신·동기화 프로그램이 잠깐 잡고 있으면(권한·공유 위반) 쉬며 다시 한다."""
    for attempt in range(len(delays) + 1):
        try:
            replace(temp, target)
            return attempt + 1
        except OSError as error:
            if attempt >= len(delays) or not _is_retryable(error):
                raise
            sleep(delays[attempt])


# ── 804: 저장한 도면을 다시 열 때 캐시가 맞도록 저장 직후 배경에서 미리 변환해 둔다 ──
WARM_MAX_BYTES = int(os.environ.get('BARUN_CACHE_WARM_MAX_BYTES', str(20 * 1024 * 1024)) or 0)
_warming = set()
_warm_lock = threading.Lock()


def should_warm(path, fmt, max_bytes=None):
    """DXF·DWG 만, 크기 한도 안에서만(큰 도면의 배경 변환은 수 GB 메모리를 쓰므로 설정으로만 켠다)."""
    max_bytes = WARM_MAX_BYTES if max_bytes is None else max_bytes
    if fmt not in ('dxf', 'dwg') or max_bytes <= 0:
        return False
    try:
        size = Path(path).stat().st_size
    except OSError:
        return False
    return 0 < size <= max_bytes


def warm_in_background(path, fmt, warm, max_bytes=None, start=True):
    """warm(path, '.dxf'|'.dwg') 를 배경 스레드에서 한 번 부른다. 같은 파일이 이미 데우는 중이면 건너뛴다."""
    if not should_warm(path, fmt, max_bytes):
        return None
    key = str(Path(path)).lower()
    with _warm_lock:
        if key in _warming:
            return None
        _warming.add(key)

    def run():
        try:
            warm(Path(path), '.' + fmt)
        except Exception:
            pass   # 데우기는 덤이다 — 실패해도 다음 열기가 평소처럼 변환한다
        finally:
            with _warm_lock:
                _warming.discard(key)
    thread = threading.Thread(target=run, name='barun-cache-warm', daemon=True)
    if start:
        thread.start()
    return thread


# ── 806: 구버전 저장 전에 단순화·제외되는 것을 미리 보기 ──
LOSS_MARKERS = ('구버전(', '2000·2004 DXF 에는', '고른 버전으로 저장되지')


def version_loss_preview(run_export):
    """run_export() → (내용, 경고). 실제 저장과 같은 변환을 돌려 경고 가운데 '잃는 것'만 돌려준다(파일은 쓰지 않는다)."""
    try:
        _content, warnings = run_export()
    except ValueError as error:
        return {'dryRun': True, 'ok': False, 'blocked': str(error), 'lost': []}
    lost = [w for w in warnings or [] if any(marker in w for marker in LOSS_MARKERS) and '유지했습니다' not in w]
    return {'dryRun': True, 'ok': True, 'lost': lost}


# ── 815: DXF 미리보기 그림(THUMBNAILIMAGE 구역, BMP DIB) ──
THUMBNAIL_MAX_BYTES = 512 * 1024


def thumbnail_dib(value):
    """화면이 보낸 base64 BMP(파일 머리 없는 DIB 또는 BM 파일)를 검사해 DIB 바이트로. 이상하면 None."""
    import base64
    import struct
    try:
        data = base64.b64decode(str(value or ''), validate=True)
    except (ValueError, TypeError):
        return None
    if data[:2] == b'BM' and len(data) > 14:
        data = data[14:]
    if len(data) < 40 or len(data) > THUMBNAIL_MAX_BYTES or struct.unpack_from('<I', data, 0)[0] != 40:
        return None
    width, height = struct.unpack_from('<ii', data, 4)
    if not (0 < width <= 1024 and 0 < abs(height) <= 1024):
        return None
    return data


def add_dxf_thumbnail(content, value):
    """DXF 끝(EOF) 앞에 THUMBNAILIMAGE 구역을 넣는다. 이미 있거나 그림이 이상하면 그대로 둔다."""
    dib = thumbnail_dib(value)
    if dib is None or b'THUMBNAILIMAGE' in content[-THUMBNAIL_MAX_BYTES * 3:]:
        return content
    import re
    match = None
    for match in re.finditer(rb'(?m)^ *0\r?\nEOF\r?\n?', content[-4096:]):
        pass
    if match is None:
        return content
    at = len(content) - len(content[-4096:]) + match.start()
    nl = b'\r\n' if b'\r\n' in content[:256] else b'\n'
    hexed = dib.hex().upper().encode('ascii')
    lines = [b'  0', b'SECTION', b'  2', b'THUMBNAILIMAGE', b' 90', str(len(dib)).encode('ascii')]
    for start in range(0, len(hexed), 254):
        lines += [b'310', hexed[start:start + 254]]
    lines += [b'  0', b'ENDSEC']
    return content[:at] + nl.join(lines) + nl + content[at:]
