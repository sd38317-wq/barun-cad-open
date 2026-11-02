"""Geometry-free, default-key previews. Loaded only when browsing assets."""
import copy
import json
import math
from pathlib import Path
import re
import sys
import threading
import vault

KINDS = frozenset(('detail', 'unit', 'jutong'))
CATALOG_FIELDS = frozenset(('kind', 'id', 'name', 'ids', 'scenes', 'has_glb', 'thumb', 'thumb3d',
    'group', 'exclusive_area_m2', 'bays', 'rooms', 'bathrooms', 'core_form', 'combination', 'form',
    'units_per_floor', 'width_mm', 'depth_mm', 'unit_types'))
NUMBER_FIELDS = frozenset(('exclusive_area_m2', 'bays', 'rooms', 'bathrooms', 'units_per_floor', 'width_mm', 'depth_mm'))
THUMB_LIMIT = 24 * 1024

def identifier(value):
    return isinstance(value, str) and bool(re.fullmatch(r'[A-Za-z0-9_가-힣.-]{1,200}', value)) and value not in ('.', '..')

def validate_catalog(rows):
    if not isinstance(rows, list):
        raise ValueError('미리보기 목록은 배열이어야 합니다.')
    seen = set()
    for row in rows:
        if not isinstance(row, dict) or set(row) - CATALOG_FIELDS or row.get('kind') not in KINDS or not identifier(row.get('id')):
            raise ValueError('미리보기 목록에 기하 또는 허용하지 않은 필드가 있습니다.')
        key = (row['kind'], row['id'])
        if key in seen:
            raise ValueError('미리보기 목록 ID가 중복되었습니다.')
        seen.add(key)
        if not isinstance(row.get('name'), str) or not isinstance(row.get('scenes'), list):
            raise ValueError('미리보기 목록 이름·장면이 올바르지 않습니다.')
        for scene in row['scenes']:
            if not isinstance(scene, dict) or set(scene) != {'n', 'title', 'scale'} or type(scene['n']) is not int or not isinstance(scene['title'], str):
                raise ValueError('미리보기 장면에 기하 또는 허용하지 않은 필드가 있습니다.')
            scale = scene['scale']
            if scale is not None and (type(scale) not in (int, float) or not math.isfinite(scale) or scale <= 0):
                raise ValueError('미리보기 축척이 올바르지 않습니다.')
        ids = row.get('ids', {})
        if not isinstance(ids, dict) or any(not isinstance(k, str) or not k.isdigit() or
                not all(identifier(v) for v in (values if isinstance(values, list) else [values])) for k, values in ids.items()):
            raise ValueError('미리보기 연결 ID가 올바르지 않습니다.')
        for field, value in row.items():
            if field in NUMBER_FIELDS:
                if type(value) not in (int, float) or not math.isfinite(value) or value < 0:
                    raise ValueError('미리보기 검색 수치가 올바르지 않습니다.')
            elif field in ('has_glb', 'thumb', 'thumb3d'):
                if type(value) is not bool:
                    raise ValueError('미리보기 표시 필드가 올바르지 않습니다.')
            elif field == 'unit_types':
                if not isinstance(value, list) or any(not isinstance(v, dict) or set(v) - {'type', 'count'} or
                        not isinstance(v.get('type'), str) or ('count' in v and (type(v['count']) is not int or v['count'] < 0)) for v in value):
                    raise ValueError('미리보기 세대 형식에 기하가 있습니다.')
            elif field not in ('kind', 'id', 'name', 'ids', 'scenes') and not isinstance(value, str):
                raise ValueError('미리보기 검색 필드에 기하가 있습니다.')
    return rows

def validate_webp(raw):
    # Only the pixel chunks are allowed: no EXIF/XMP, animations or trailing payload.
    if len(raw) > THUMB_LIMIT or raw[:4] != b'RIFF' or raw[8:12] != b'WEBP' or int.from_bytes(raw[4:8], 'little') + 8 != len(raw):
        raise ValueError('미리보기 WebP 크기·형식이 올바르지 않습니다.')
    at, dimensions, pixels = 12, None, 0
    while at < len(raw):
        tag = raw[at:at+4]
        size = int.from_bytes(raw[at+4:at+8], 'little')
        data = raw[at+8:at+8+size]
        if tag not in (b'VP8 ', b'VP8L', b'VP8X', b'ALPH') or len(data) != size:
            raise ValueError('미리보기 그림에 허용하지 않은 자료가 있습니다.')
        if tag == b'VP8 ':
            if len(data) < 10 or data[3:6] != b'\x9d\x01\x2a':
                raise ValueError('미리보기 픽셀이 올바르지 않습니다.')
            dimensions = (int.from_bytes(data[6:8], 'little') & 16383, int.from_bytes(data[8:10], 'little') & 16383)
            pixels += 1
        elif tag == b'VP8L':
            if len(data) < 5 or data[0] != 47:
                raise ValueError('미리보기 픽셀이 올바르지 않습니다.')
            bits = int.from_bytes(data[1:5], 'little')
            dimensions = ((bits & 16383) + 1, ((bits >> 14) & 16383) + 1)
            pixels += 1
        elif tag == b'VP8X' and (len(data) != 10 or data[0] & ~16):
            raise ValueError('미리보기 그림 부가 자료가 있습니다.')
        at += 8 + size + (size % 2)
    if at != len(raw) or pixels != 1 or dimensions is None or min(dimensions) < 1 or max(dimensions) != 320:
        raise ValueError('미리보기 긴 변은 320px이어야 합니다.')

def validate_files(files):
    if 'catalog' not in files:
        raise ValueError('미리보기 목록이 없습니다.')
    rows = validate_catalog(json.loads(files['catalog']))
    keys = {(r['kind'], r['id']) for r in rows}
    for name, raw in files.items():
        if name == 'catalog':
            continue
        match = re.fullmatch(r'(thumb|thumb3d)/(detail|unit|jutong)/([^/]+)\.webp', name)
        if not match or (match[2], match[3]) not in keys:
            raise ValueError('미리보기 묶음에 기하 또는 허용하지 않은 파일이 있습니다: ' + name)
        validate_webp(raw)
    for row in rows:
        for folder in ('thumb', 'thumb3d'):
            if row.get(folder) and f"{folder}/{row['kind']}/{row['id']}.webp" not in files:
                raise ValueError('미리보기 그림이 빠졌습니다.')
    return rows

def source_decisions():
    base = Path(getattr(sys, '_MEIPASS', Path(__file__).resolve().parent))
    source = base / 'drawing-details/source-decisions.json'
    return json.loads(source.read_text(encoding='utf-8')) if source.is_file() else {}


def pack_path():
    base = Path(getattr(sys, '_MEIPASS', Path(__file__).resolve().parent))
    installed = base / 'rules/asset-preview.pack'
    from runtime_paths import packaged
    return installed if installed.is_file() or packaged() else base / 'tmp/cad-assets/asset-preview.pack'

class PreviewStore:
    def __init__(self, path=None):
        self.path = Path(path) if path is not None else None
        self._stamp = None
        self._files = {}
        self._rows = []
        self._lock = threading.RLock()

    def _load(self):
        source = self.path or pack_path()
        if not source.is_file():
            self._files, self._rows, self._stamp = {}, [], None
            return False
        import vault_gate
        try:
            key = vault_gate.pack_key()   # 설치판은 서버 열쇠(로그인 뒤에만), 개발 묶음은 기본 열쇠
        except ValueError:
            self._files, self._rows, self._stamp = {}, [], None   # 로그아웃하면 푼 미리보기도 버린다
            return False
        stamp = (str(source), source.stat().st_mtime_ns, source.stat().st_size)
        if stamp != self._stamp:
            blob = source.read_bytes()
            if blob[:4] != vault.MAGIC:
                raise ValueError('미리보기는 BCV2 묶음이어야 합니다.')
            files = vault.unpack(blob, key)
            rows = validate_files(files)
            self._files, self._rows, self._stamp = files, rows, stamp
        return True

    def catalog(self):
        with self._lock:
            self._load()
            return copy.deepcopy(self._rows)

    def thumb(self, kind, asset_id, three=False):
        if kind not in KINDS or not identifier(asset_id):
            raise ValueError('미리보기 자산 ID가 올바르지 않습니다.')
        with self._lock:
            self._load()
            folder = 'thumb3d' if three else 'thumb'
            raw = self._files.get(f'{folder}/{kind}/{asset_id}.webp')
            if raw is None:
                row = next((r for r in self._rows if r['kind'] == kind and any(asset_id in
                    (v if isinstance(v, list) else [v]) for v in r.get('ids', {}).values())), None)
                if row:
                    raw = self._files.get(f"{folder}/{kind}/{row['id']}.webp")
            return raw
