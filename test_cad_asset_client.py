"""Loopback-only fake public service and real engine-route smoke checks."""
import copy
import functools
import gzip
import json
import os
import threading
from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from unittest.mock import patch
from urllib.error import HTTPError
from urllib.request import Request, urlopen

import pytest
import cad_asset_client as assets

@pytest.fixture(autouse=True)
def no_developer_preview(monkeypatch, tmp_path):
    # Existing server-contract tests deliberately have no installed preview.
    monkeypatch.setattr('asset_preview.pack_path', lambda: tmp_path / 'missing.pack')


ASSET = {
    'format': 'barun-asset/1', 'kind': 'detail', 'id': 'FLOOR-072',
    'name': '온돌', 'version': '2026-10-13', 'ids': {'1': ['FLOOR-072', 'FLOOR-074']},
    'scenes': [{'n': 1, 'title': '단면', 'scale': 10, 'bounds': [0, 0, 1000, 600],
                'entities': [{'type': 'line', 'layer': 'A-DETL', 'start': {'x': .004, 'y': -.004},
                              'end': {'x': 1000.004, 'y': 0.004},
                              'xdata': {'BARUN_WM': ['barun-asset/1', 'detail', 'FLOOR-072', '0123456789ab']}}]}],
    'meta': {'assumed': [], 'to_confirm': [], 'source_note': 'test', 'same_as': None},
    'glb': 'Z2xURg==', 'wm_points': 4,
}
CATALOG = [{k: copy.deepcopy(ASSET[k]) for k in ('kind', 'id', 'name', 'ids')}]
CATALOG[0].update(scenes=[{'n': 1, 'title': '단면', 'scale': 10}], has_glb=True)


@contextmanager
def fake_service():
    state = {'status': 200, 'requests': [], 'gzip': False, 'envelope': False, 'asset': ASSET, 'catalog': CATALOG}
    class Fake(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass
        def do_POST(self):
            body = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
            state['requests'].append((self.path, self.headers.get('Authorization'), body))
            self.send_response(state['status'])
            value = state['catalog'] if self.path.endswith('-catalog') else state['asset']
            if state['envelope']:
                value = {'state': 'ok', 'catalog' if self.path.endswith('-catalog') else 'asset': value}
            payload = json.dumps(value).encode()
            if state['gzip']:
                payload = gzip.compress(payload)
                self.send_header('Content-Encoding', 'gzip')
            self.send_header('Content-Length', str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)
    server = ThreadingHTTPServer(('127.0.0.1', 0), Fake)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    state['url'] = f'http://127.0.0.1:{server.server_port}'
    try:
        with patch.dict(os.environ, BARUN_CAD_ASSET_URL=state['url']):
            yield state
    finally:
        server.shutdown()
        server.server_close()


def test_lazy_missing_login_never_calls_server():
    with fake_service() as state:
        client = assets.CadAssetClient(token_reader=lambda: None)
        assert not state['requests']
        with pytest.raises(assets.CadAssetError) as error:
            client.catalog()
        assert (error.value.code, error.value.status) == ('not_logged_in', 401)
        assert not state['requests']


@pytest.mark.parametrize('status,code', [(401, 'not_logged_in'), (429, 'limit'), (503, 'offline'), (404, 'not_found')])
def test_public_failures_are_stable(status, code):
    with fake_service() as state:
        state['status'] = status
        client = assets.CadAssetClient(token_reader=lambda: 'account-test-token')
        with pytest.raises(assets.CadAssetError) as error:
            client.get_asset('detail', 'FLOOR-072')
        assert error.value.code == code
        assert not client._cache
        assert 'account-test-token' not in str(error.value)


@pytest.mark.parametrize('compressed,envelope', [(False, False), (True, False), (True, True)])
def test_gzip_catalog_asset_contract_and_memory_only(compressed, envelope):
    with fake_service() as state:
        state.update(gzip=compressed, envelope=envelope)
        client = assets.CadAssetClient(token_reader=lambda: 'account-test-token')
        # All filesystem writes are forbidden while fetching or reading RAM cache.
        with patch('pathlib.Path.write_bytes', side_effect=AssertionError('disk cache')), patch('pathlib.Path.write_text', side_effect=AssertionError('disk cache')), patch('builtins.open', side_effect=AssertionError('disk cache')):
            rows = client.catalog('detail')
            asset = client.get_asset('detail', 'FLOOR-072')
            asset['scenes'][0]['entities'][0]['start']['x'] = 999
            cached = client.get_asset('detail', 'FLOOR-072')
        assert rows == CATALOG
        assert cached == ASSET
        assert state['requests'] == [
            ('/api/public/cad-asset-catalog', 'Bearer account-test-token', {}),
            ('/api/public/cad-asset', 'Bearer account-test-token', {'kind': 'detail', 'id': 'FLOOR-072'})]


def test_same_as_alias_accepts_representative_asset():
    with fake_service():
        client = assets.CadAssetClient(token_reader=lambda: 'one')
        assert client.get_asset('detail', 'FLOOR-074')['id'] == 'FLOOR-072'


def test_account_change_disconnect_and_url_change_clear_memory():
    with fake_service() as state:
        token = ['one']
        client = assets.CadAssetClient(token_reader=lambda: token[0])
        client.get_asset('detail', 'FLOOR-072')
        token[0] = 'two'
        client.get_asset('detail', 'FLOOR-072')
        assert len(state['requests']) == 2
        token[0] = None
        with pytest.raises(assets.CadAssetError):
            client.get_asset('detail', 'FLOOR-072')
        assert not client._cache
        token[0] = 'two'
        client.get_asset('detail', 'FLOOR-072')
        with patch.dict(os.environ, BARUN_CAD_ASSET_URL=state['url'] + '/alternate'):
            client.get_asset('detail', 'FLOOR-072')
        assert len(state['requests']) == 4


def test_lru_and_byte_budget():
    with fake_service() as state:
        client = assets.CadAssetClient(token_reader=lambda: 'one', max_entries=1)
        client.catalog()
        client.get_asset('detail', 'FLOOR-072')
        assert list(client._cache) == [('detail', 'FLOOR-072')]
        client.catalog()
        assert len(state['requests']) == 3
        small = assets.CadAssetClient(token_reader=lambda: 'one', max_bytes=1)
        small.get_asset('detail', 'FLOOR-072')
        assert not small._cache


def test_connection_failure_and_bad_response():
    client = assets.CadAssetClient(token_reader=lambda: 'one')
    with patch.dict(os.environ, BARUN_CAD_ASSET_URL='http://127.0.0.1:1'):
        with pytest.raises(assets.CadAssetError, match='연결') as error:
            client.catalog()
        assert error.value.code == 'offline'
    with fake_service() as state:
        state['asset'] = {'format': 'unknown'}
        with pytest.raises(assets.CadAssetError):
            client.get_asset('detail', 'FLOOR-072')
        assert not client._cache
        state['catalog'] = [{**CATALOG[0], 'geometry': []}]
        with pytest.raises(assets.CadAssetError):
            client.catalog()


def test_existing_account_token_reader_is_reused():
    with patch('miri_account_service._load_token', return_value='account') as reader:
        assert assets._account_token() == 'account'
        reader.assert_called_once_with()


@pytest.mark.parametrize('kind,identifier', [('other', 'x'), ('detail', '../x'), ('unit', 'a/b'), ('detail', '')])
def test_bad_identifier_never_fetches(kind, identifier):
    with fake_service() as state:
        client = assets.CadAssetClient(token_reader=lambda: 'one')
        with pytest.raises(ValueError):
            client.get_asset(kind, identifier)
        assert not state['requests']


def test_engine_uses_existing_token_origin_and_preserves_failure_status():
    import server as engine
    class Quiet(engine.Handler):
        def log_message(self, *args):
            pass
    http = ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(Quiet, directory=str(engine.ROOT)))
    threading.Thread(target=http.serve_forever, daemon=True).start()
    base = f'http://127.0.0.1:{http.server_port}'
    def post(route, token=engine.TOKEN, origin=base):
        return urlopen(Request(base + route, data=b'{}', headers={'Origin': origin, 'X-CAD-Token': token, 'Content-Type': 'application/json'}))
    try:
        with fake_service() as state, patch.object(assets, '_client', assets.CadAssetClient(token_reader=lambda: 'account')):
            for token, origin in [('bad', base), (engine.TOKEN, 'https://other.invalid')]:
                with pytest.raises(HTTPError) as error:
                    post('/api/cad-asset/detail/FLOOR-072', token, origin)
                assert error.value.code == 403
            assert not state['requests']
            with post('/api/cad-asset/catalog') as response:
                assert json.load(response) == CATALOG
            with post('/api/cad-asset/detail/FLOOR-072') as response:
                assert json.load(response) == ASSET
            for status, code in [(401, 'not_logged_in'), (429, 'limit'), (503, 'offline')]:
                assets.clear()
                state['status'] = status
                with pytest.raises(HTTPError) as error:
                    post('/api/cad-asset/detail/FLOOR-072')
                assert error.value.code == status
                assert json.load(error.value)['code'] == code
            with pytest.raises(HTTPError) as error:
                post('/api/cad-asset/detail/a%2Fb')
            assert error.value.code == 400
    finally:
        http.shutdown()
        http.server_close()


def make_preview(tmp_path, rows=CATALOG):
    from PIL import Image
    from tools.asset_preview_render import thumbnail
    import vault
    target = tmp_path / 'asset-preview.pack'
    pixels = thumbnail(Image.new('RGB', (640, 400), 'white'))
    files = {'catalog': json.dumps(rows).encode()}
    files.update({f"thumb/{r['kind']}/{r['id']}.webp": pixels for r in rows})
    target.write_bytes(vault.pack(files))
    return target, pixels


def test_preview_without_login_never_fetches_geometry_and_returns_alias(tmp_path):
    target, pixels = make_preview(tmp_path)
    client = assets.CadAssetClient(token_reader=lambda: None, preview_path=target)
    with patch.object(client._opener, 'open', side_effect=AssertionError('network')):
        assert client.catalog() == CATALOG
        assert client.preview.thumb('detail', 'FLOOR-074') == pixels
        with pytest.raises(assets.CadAssetError) as error:
            client.get_asset('detail', 'FLOOR-072')
        assert error.value.status == 401
        assert client.preview.thumb('detail', 'missing') is None
        with pytest.raises(ValueError):
            client.preview.thumb('detail', '../secret')


def test_preview_merges_updated_server_rows_and_keeps_offline_catalog(tmp_path):
    target, _ = make_preview(tmp_path)
    with fake_service() as state:
        new = {**CATALOG[0], 'id': 'NEW-1', 'name': '새 상세'}
        state['catalog'] = [{**CATALOG[0], 'name': '갱신'}, new]
        client = assets.CadAssetClient(token_reader=lambda: 'account', preview_path=target)
        rows = client.catalog()
        assert [r['name'] for r in rows] == ['갱신', '새 상세']
        client.clear()
        state['status'] = 503
        assert client.catalog() == CATALOG
        client.clear()
        state['status'] = 200
        state['catalog'] = [{**CATALOG[0], 'scenes': [{'n': 1, 'title': 'bad', 'scale': 10, 'bounds': [0, 0, 1, 1]}]}]
        assert client.catalog() == CATALOG


def test_engine_public_preview_get_and_post_do_not_require_account(tmp_path):
    import server as engine
    target, pixels = make_preview(tmp_path)
    class Quiet(engine.Handler):
        def log_message(self, *args):
            pass
    http = ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(Quiet, directory=str(engine.ROOT)))
    threading.Thread(target=http.serve_forever, daemon=True).start()
    base = f'http://127.0.0.1:{http.server_port}'
    client = assets.CadAssetClient(token_reader=lambda: None, preview_path=target)
    try:
        with patch.object(assets, '_client', client), patch.object(client._opener, 'open', side_effect=AssertionError('network')):
            for route in ('/api/cad-asset/catalog', '/api/cad-asset/thumb/detail/FLOOR-072'):
                with urlopen(Request(base + route, headers={'Sec-Fetch-Site': 'same-origin'})) as response:
                    assert response.status == 200
                    if '/thumb/' in route:
                        assert response.headers['Content-Type'] == 'image/webp' and response.read() == pixels
                    else:
                        assert json.load(response) == CATALOG
            with urlopen(Request(base + '/api/cad-asset/catalog', data=b'{}',
                    headers={'Origin': base, 'X-CAD-Token': engine.TOKEN, 'Content-Type': 'application/json'})) as response:
                assert json.load(response) == CATALOG
            with pytest.raises(HTTPError) as error:
                urlopen(Request(base + '/api/cad-asset/detail/FLOOR-072', data=b'{}',
                    headers={'Origin': base, 'X-CAD-Token': engine.TOKEN, 'Content-Type': 'application/json'}))
            assert error.value.code == 401
            with pytest.raises(HTTPError) as error:
                urlopen(Request(base + '/api/cad-asset/thumb/detail/FLOOR-072'))
            assert error.value.code == 403
    finally:
        http.shutdown()
        http.server_close()
