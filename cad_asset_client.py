"""Lazy account-authenticated CAD assets. Cache is bounded, account-scoped RAM only."""
import copy
from asset_preview import PreviewStore, validate_catalog, source_decisions
import gzip
import io
import json
import math
import os
import re
import threading
import zlib
from http.client import HTTPException
import urllib.error
import urllib.request
from collections import OrderedDict

DEFAULT_URL = 'https://barunarc.co.kr/api/public/cad-asset'
KINDS = frozenset(('detail', 'unit', 'jutong'))
MAX_RESPONSE_BYTES = 64 * 1024 * 1024


class CadAssetError(ValueError):
    def __init__(self, code, status=None):
        messages = {
            'not_logged_in': '로그인 필요 · [계정 연결]로 로그인한 뒤 자산을 사용할 수 있습니다.',
            'limit': '오늘 자산 이용 횟수를 초과했습니다. 내일 다시 시도하세요.',
            'offline': '로그인 필요 · 자산 서버에 연결하지 못했습니다. 인터넷 연결을 확인하세요.',
            'not_found': '서버에 이 자산이 없습니다. 작성 예정입니다.',
        }
        self.code = code
        self.status = status or {'not_logged_in': 401, 'limit': 429, 'offline': 503, 'not_found': 404}[code]
        self.message = messages[code]
        super().__init__(self.message)

    def response(self):
        return {'code': self.code, 'error': self.message, 'message': self.message}


def _account_token():
    # Exactly the account link / vault gate token path; never use the engine token.
    from miri_account_service import _load_token
    return _load_token()


def _urls():
    value = os.environ.get('BARUN_CAD_ASSET_URL', DEFAULT_URL).rstrip('/')
    if value.endswith('/cad-asset'):
        return value, value + '-catalog'
    return value + '/api/public/cad-asset', value + '/api/public/cad-asset-catalog'


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    # A redirect must not forward the account's Bearer token to another host.
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def _identifier(kind, identifier):
    if kind not in KINDS or not isinstance(identifier, str) or not identifier or len(identifier) > 200 or re.search(r'[/\\\x00-\x1f]', identifier):
        raise ValueError('자산 종류 또는 id가 올바르지 않습니다.')


def _validate_catalog(value):
    if not isinstance(value, list):
        raise CadAssetError('offline')
    for row in value:
        if not isinstance(row, dict) or row.get('kind') not in KINDS or not isinstance(row.get('scenes'), list):
            raise CadAssetError('offline')
        try:
            _identifier(row['kind'], row.get('id'))
        except ValueError:
            raise CadAssetError('offline') from None
        if 'entities' in row or 'geometry' in row or 'glb' in row or any(not isinstance(s, dict) or 'entities' in s for s in row['scenes']):
            raise CadAssetError('offline')
    try:
        validate_catalog(value)
    except (ValueError, TypeError, KeyError):
        raise CadAssetError('offline') from None
    return value


def _validate_asset(value, kind, identifier):
    if not isinstance(value, dict) or value.get('format') != 'barun-asset/1' or value.get('kind') != kind:
        raise CadAssetError('offline')
    covered = [x for ids in value.get('ids', {}).values() if isinstance(ids, list) for x in ids] if isinstance(value.get('ids'), dict) else []
    if value.get('id') != identifier and identifier not in covered:
        raise CadAssetError('offline')
    scenes = value.get('scenes')
    if not isinstance(scenes, list) or not scenes:
        raise CadAssetError('offline')
    for scene in scenes:
        if not isinstance(scene, dict) or not isinstance(scene.get('entities'), list) or not all(isinstance(e, dict) for e in scene['entities']):
            raise CadAssetError('offline')
        if (not isinstance(scene.get('bounds'), list) or len(scene['bounds']) != 4
                or not all(isinstance(x, (int, float)) and math.isfinite(x) for x in scene['bounds'])
                or not isinstance(scene.get('scale'), (int, float)) or not math.isfinite(scene['scale']) or scene['scale'] <= 0):
            raise CadAssetError('offline')
    return value


class CadAssetClient:
    def __init__(self, token_reader=None, max_entries=32, max_bytes=64 * 1024 * 1024, timeout=15, preview_path=None):
        self.preview = PreviewStore(preview_path)
        self._token_reader = token_reader or _account_token
        self.max_entries = max_entries
        self.max_bytes = max_bytes
        self.timeout = timeout
        self._cache = OrderedDict()
        self._bytes = 0
        self._scope = None
        self._lock = threading.RLock()
        self._opener = urllib.request.build_opener(_NoRedirect())

    def clear(self):
        with self._lock:
            self._cache.clear()
            self._bytes = 0
            self._scope = None

    def _fetch(self, catalog_request, kind=None, identifier=None):
        # Read only on demand. A disconnect or another login invalidates all RAM entries.
        with self._lock:
            token = self._token_reader()
            urls = _urls()
            scope = (token, urls)
            if scope != self._scope:
                self.clear()
                self._scope = scope
            if not token:
                raise CadAssetError('not_logged_in')
            key = ('catalog',) if catalog_request else (kind, identifier)
            if key in self._cache:
                value, size = self._cache.pop(key)
                self._cache[key] = (value, size)
                return copy.deepcopy(value)
            body = {} if catalog_request else {'kind': kind, 'id': identifier}
            request = urllib.request.Request(urls[1 if catalog_request else 0],
                data=json.dumps(body).encode('utf-8'), method='POST',
                headers={'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json', 'Accept-Encoding': 'gzip'})
            try:
                with self._opener.open(request, timeout=self.timeout) as response:
                    raw = response.read(MAX_RESPONSE_BYTES + 1)
                    if len(raw) > MAX_RESPONSE_BYTES:
                        raise CadAssetError('offline')
                    if response.headers.get('Content-Encoding') == 'gzip' or raw.startswith(b'\x1f\x8b'):
                        with gzip.GzipFile(fileobj=io.BytesIO(raw)) as compressed:
                            raw = compressed.read(MAX_RESPONSE_BYTES + 1)
                        if len(raw) > MAX_RESPONSE_BYTES:
                            raise CadAssetError('offline')
                    value = json.loads(raw)
            except urllib.error.HTTPError as error:
                if error.code == 401:
                    self.clear()
                    raise CadAssetError('not_logged_in') from None
                if error.code == 429:
                    raise CadAssetError('limit') from None
                if error.code == 404:
                    raise CadAssetError('not_found') from None
                raise CadAssetError('offline') from None
            except (OSError, ValueError, urllib.error.URLError, HTTPException, zlib.error) as error:
                if isinstance(error, CadAssetError):
                    raise
                raise CadAssetError('offline') from None
            # Accept direct JSON and the state/asset or catalog envelope used by public services.
            if isinstance(value, dict) and 'format' not in value:
                value = value.get('catalog', value.get('items')) if catalog_request else value.get('asset')
            value = _validate_catalog(value) if catalog_request else _validate_asset(value, kind, identifier)
            size = len(raw)
            if size <= self.max_bytes and self.max_entries > 0:
                self._cache[key] = (copy.deepcopy(value), size)
                self._bytes += size
                while len(self._cache) > self.max_entries or self._bytes > self.max_bytes:
                    _, (_, removed) = self._cache.popitem(last=False)
                    self._bytes -= removed
            return value

    def catalog(self, kind=None):
        if kind is not None and kind not in KINDS:
            raise ValueError('자산 종류가 올바르지 않습니다.')
        local = self.preview.catalog()
        # Reading thumbnails never reads an account token or downloads geometry.
        if not local:
            rows = self._fetch(True)
        elif not self._token_reader():
            self.clear()
            rows = local
        else:
            try:
                remote = self._fetch(True)
                validate_catalog(remote)
            except (CadAssetError, ValueError):
                remote = []
            merged = {(row['kind'], row['id']): row for row in local}
            for row in remote:
                key = (row['kind'], row['id'])
                merged[key] = {**merged.get(key, {}), **row}
            rows = list(merged.values())
        dropped = {identifier for identifier, decision in source_decisions().items() if decision.get('결정') == 'drop'}
        rows = [row for row in rows if row['kind'] != 'detail' or row['id'] not in dropped]
        for row in rows:
            if row['kind'] == 'detail':
                row['ids'] = {key: [identifier for identifier in (ids if isinstance(ids, list) else [ids]) if identifier not in dropped]
                              for key, ids in row.get('ids', {}).items()}
        return rows if kind is None else [row for row in rows if row['kind'] == kind]

    def get_asset(self, kind, identifier):
        _identifier(kind, identifier)
        return self._fetch(False, kind, identifier)


_client = CadAssetClient()


def catalog(kind=None):
    return _client.catalog(kind)


def get_asset(kind, identifier):
    return _client.get_asset(kind, identifier)


def signed_in():
    # 목록은 로그인 없이도 미리보기 사본으로 'ok' 가 온다. 넣기(도형 받기)는 계정 열쇠가 있어야 한다.
    return bool(_client._token_reader())


def thumb(kind, identifier, three=False):
    return _client.preview.thumb(kind, identifier, three)


def clear():
    _client.clear()
