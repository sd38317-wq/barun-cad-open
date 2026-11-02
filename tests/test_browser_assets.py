"""Serve every source module and recognize every details lazy chunk without a build."""
import re
import threading
from urllib.request import Request, urlopen
import pytest
import server


@pytest.fixture(scope='module')
def http_server():
    from functools import partial
    from http.server import ThreadingHTTPServer
    handler = partial(server.Handler, directory=str(server.ROOT))
    http = ThreadingHTTPServer(('127.0.0.1', 0), handler)
    thread = threading.Thread(target=http.serve_forever, daemon=True)
    thread.start()
    yield 'http://127.0.0.1:' + str(http.server_port)
    http.shutdown()
    http.server_close()
    thread.join()


@pytest.mark.parametrize('name', ['detail-search-panel','detail-search-index','detail-search-actions'])
def test_details_module_served_and_lazy_chunk_allowed(http_server, name):
    with urlopen(http_server + '/' + name + '.js') as response:
        assert response.status == 200
        assert response.read()
    assert re.fullmatch(server.BUNDLE_CHUNK_PATTERN, '/' + name + '-Ab12_X.js')
    assert not re.fullmatch(server.BUNDLE_CHUNK_PATTERN, '/detail-search-panel-../../secret.js')


def test_compute_modules_are_not_served(http_server):
    # 구조계산서·평면 인식·창호 계획·배치 품질 계산은 바른 서버에만 있다. 화면은 compute-client.js 로 부른다.
    from urllib.error import HTTPError
    for name in ('structure-calc-report.js', 'compute/structure-calc-report.js', 'compute/actions.js', 'plan-to-model.js'):
        with pytest.raises(HTTPError):
            urlopen(http_server + '/' + name)
    with urlopen(http_server + '/compute-client.js') as response:
        assert response.status == 200
        assert b'structure.calcReport' in response.read()


def test_catalog_requires_same_origin(http_server):
    from urllib.error import HTTPError
    with pytest.raises(HTTPError) as failed:
        urlopen(http_server + '/api/detail-search/catalog')
    assert failed.value.code == 403
    request = Request(http_server + '/api/detail-search/catalog', headers={'Sec-Fetch-Site':'same-origin'})
    with urlopen(request) as response:
        import json
        result = json.load(response)
    assert result['status'] == 'ok'
    assert isinstance(result['lh'], list)
    assert isinstance(result['knowledge'], dict)


def test_dynamic_block_module_is_lazy_and_chunk_is_allowed(http_server):
    from pathlib import Path
    app = (Path(__file__).resolve().parents[1] / 'app.js').read_text(encoding='utf8')
    assert not re.search(r'''from\s*['"]\./dynamic-block\.js['"]''', app)
    assert re.search(r'''import\(['"]\./dynamic-block\.js['"]\)''', app)
    with urlopen(http_server + '/dynamic-block.js') as response:
        assert response.status == 200
    assert re.fullmatch(server.BUNDLE_CHUNK_PATTERN, '/dynamic-block-Ab12_X.js')
    assert not re.fullmatch(server.BUNDLE_CHUNK_PATTERN, '/dynamic-block-../../private.js')
