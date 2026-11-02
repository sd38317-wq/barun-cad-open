"""Verify the browser import graph through the actual HTTP allowlist."""
import gzip, json, os, re, threading, tempfile, unittest
from pathlib import Path
from unittest.mock import patch
from urllib.request import urlopen
from urllib.parse import quote, urljoin
from http.server import ThreadingHTTPServer
from server import Handler, ROOT, TOKEN, cached_import_body, json_safe
import functools

class AssetTest(unittest.TestCase):
 def test_packaged_gpu_chunk_is_served_but_private_files_are_not(self):
  class QuietHandler(Handler):
   def log_message(self,*args): pass
  from urllib.error import HTTPError
  with tempfile.TemporaryDirectory() as folder, patch('server.ROOT',Path(folder)):
   public=('occt-commands-AB123.js','gpu-renderer-AB123.js','gpu-render-client-AB123.js','gpu-selection-overlay-AB123.js','gpu-render-worker.js','gpu-render-client.js','gpu-render-protocol.js','detail-3d-viewer-AB123.js','cad-asset-client-AB123.js')
   for name in (*public,'private.js'):
    (Path(folder)/name).write_text('export const ok=true;',encoding='utf8')
   server=ThreadingHTTPServer(('127.0.0.1',0),functools.partial(QuietHandler,directory=folder))
   threading.Thread(target=server.serve_forever,daemon=True).start()
   base=f'http://127.0.0.1:{server.server_port}'
   try:
    for name in public:
     with urlopen(base+'/'+name) as response:self.assertEqual(response.status,200)
    for route in ('/private.js','/gpu-renderer-AB123.js/private.js'):
     with self.assertRaises(HTTPError) as error:urlopen(base+route)
     self.assertEqual(error.exception.code,404)
   finally:server.shutdown();server.server_close()

 def test_every_dynamic_import_is_a_chunk_the_installed_server_serves(self):
  # 검토 A1: 동적 import 는 esbuild 조각(이름-해시.js)이 되는데, BUNDLE_CHUNK_PATTERN 에 없으면 설치판 빌드가 멈추거나 그 기능이 404.
  import server
  entries={'app','review-3d','auto-plan','site-3d','tablet-input','lisp-worker','mcp-lisp','ai-layer-policy','app-ai-tools','ai-commit','command-worker','gpu-compile-worker','gpu-render-worker','occt-client'}
  names={m for f in ROOT.glob('*.js') if not f.name.endswith('.test.js') for m in re.findall(r"import\(\s*['\"]\./([A-Za-z0-9_-]+)\.js['\"]\s*\)",f.read_text(encoding='utf-8',errors='replace'))}
  self.assertEqual(sorted(n for n in names-entries if not re.fullmatch(server.BUNDLE_CHUNK_PATTERN,'/'+n+'-ABCD1234.js')),[])
 def test_apartment_wait_assets_are_served(self):
  class QuietHandler(Handler):
   def log_message(self,*args): pass
  server=ThreadingHTTPServer(('127.0.0.1',0),functools.partial(QuietHandler,directory=str(ROOT)))
  threading.Thread(target=server.serve_forever,daemon=True).start()
  base=f'http://127.0.0.1:{server.server_port}'
  try:
   for name,kind in (('wait-screens/apartment.html?embed=1','text/html'),('wait-screens/apartment-embed.js','javascript'),('wait-screens/apt_example.js','javascript'),('apartment-wait-frame.js','javascript'),('wait-screens/drafting-main.js','javascript'),('wait-screens/site-wait-frame.js','javascript'),('fonts/NanumGothic-Regular.ttf','')):
    with urlopen(base+'/'+name) as response:
     self.assertEqual(response.status,200)
     self.assertIn(kind,response.headers.get('Content-Type',''))
     if name.startswith('wait-screens/apartment.html'):self.assertEqual(response.headers.get('X-Frame-Options'),'SAMEORIGIN')
     else:self.assertEqual(response.headers.get('X-Frame-Options'),'DENY')
   from server import BUNDLE_CHUNK_PATTERN
   self.assertRegex('/apartment-wait-frame-AB123.js',BUNDLE_CHUNK_PATTERN)
  finally:server.shutdown();server.server_close()

 def test_import_cache_reuses_compressed_conversion(self):
  result={'document':{'version':2,'units':'mm','layers':[],'blocks':[],'entities':[]},'report':{}}
  with tempfile.TemporaryDirectory() as folder, patch('server.import_cache_dir',return_value=Path(folder)), patch('exchange.import_file',return_value=result) as convert:
   first,hit1=cached_import_body(b'drawing','.dwg')
   second,hit2=cached_import_body(b'drawing','.dwg')
   # 5.0.4 S1: 결과는 줄 단위 NDJSON(gzip) 캐시 파일로 남고 경로를 돌려준다
   import import_stream
   self.assertEqual(import_stream.read_stream(second)['document']['version'],2)
  self.assertFalse(hit1);self.assertTrue(hit2);self.assertEqual(first,second);convert.assert_called_once()
  self.assertTrue(str(second).endswith(import_stream.CACHE_SUFFIX))

 def test_interrupted_import_cache_is_rebuilt(self):
  result={'document':{'version':2,'units':'mm','layers':[],'blocks':[],'entities':[]},'report':{}}
  with tempfile.TemporaryDirectory() as folder, patch('server.import_cache_dir',return_value=Path(folder)), patch('exchange.import_file',return_value=result) as convert:
   cached_import_body(b'drawing','.dwg')
   next(Path(folder).glob('*.ndjson.gz')).write_bytes(b'')
   body,hit=cached_import_body(b'drawing','.dwg')
   self.assertGreater(body.stat().st_size,10)
  self.assertFalse(hit);self.assertEqual(convert.call_count,2)

 def test_malformed_dwg_text_cannot_abort_utf8_response(self):
  cleaned=json_safe({'text':'정상\ud800문자','items':['A\udfffB']})
  encoded=__import__('json').dumps(cleaned,ensure_ascii=False).encode('utf-8')
  self.assertIn('정상�문자'.encode('utf-8'),encoded)
  self.assertNotIn(b'\\ud800',encoded)

 def test_browser_module_imports_are_served(self):
  class QuietHandler(Handler):
   def log_message(self,*args): pass
  server=None
  base=os.environ.get('CAD_ASSET_BASE_URL')
  if not base:
   server=ThreadingHTTPServer(('127.0.0.1',0),functools.partial(QuietHandler,directory=str(ROOT)))
   threading.Thread(target=server.serve_forever,daemon=True).start()
   base=f'http://127.0.0.1:{server.server_port}/'
  pending=[urljoin(base,'app.js'),urljoin(base,'review-3d.js'),urljoin(base,'occt-worker.js'),urljoin(base,'lisp-worker.js')];seen=set()
  try:
   while pending:
    url=pending.pop()
    if url in seen: continue
    seen.add(url)
    try:
     with urlopen(quote(url,safe=':/%'),timeout=5) as response:
      self.assertIn('javascript',response.headers.get('Content-Type',''),url)
      text=response.read().decode('utf-8')
    except OSError as error:
     self.fail(f'Browser dependency unavailable: {url}: {error}')
    for dep in re.findall(r'''(?:from\s*|import\s*|import\s*\()\s*['"](\./[^'"]+\.js)['"]''',text):
     pending.append(urljoin(url,dep))
    # 잠근 화면 코드(screen-vault.js)는 lockedImport('이름') 으로 부른다. 개발 실행은 소스 파일을 그대로 낸다.
    for dep in re.findall(r'''lockedImport\(\s*['"]([^'"]+\.js)['"]''',text):
     pending.append(urljoin(base,dep))
   self.assertIn(urljoin(base,'structure-schedule.js'),seen)
   self.assertIn(urljoin(base,'structure-preliminary.js'),seen)
   # 계산 핵심(compute/)은 바른 서버에만 — 화면은 compute-client 로 부른다.
   self.assertIn(urljoin(base,'compute-client.js'),seen)
   self.assertIn(urljoin(base,'plan-quality-client.js'),seen)
   for name in ('structure-calc-report.js','structure-recognize.js','structure-plan-read.js','plan-to-model.js','wall-detect.js','opening-planner.js','opening-rules.js','plan-quality.js'):
    self.assertNotIn(urljoin(base,name),seen)
    self.assertNotIn(urljoin(base,'compute/'+name),seen)
   self.assertIn(urljoin(base,'chat.js'),seen)
   self.assertIn(urljoin(base,'cad-asset-client.js'),seen)
   self.assertIn(urljoin(base,'mcp-lisp.js'),seen)
   self.assertIn(urljoin(base,'lisp-worker.js'),seen)
   for name in ('occt-commands.js','occt-client.js','occt-worker.js','occt-loader.js','occt-building.js','occt-kernel.js','occt-section.js'):
    self.assertIn(urljoin(base,name),seen)
   for name,kind in (('vendor/occt-pkg/node_modules/replicad-opencascadejs/dist/replicad_single.js','javascript'),('vendor/occt-pkg/node_modules/replicad-opencascadejs/dist/replicad_single.wasm','application/wasm'),('vendor/occt-pkg/NOTICE.md','text'),('vendor/occt-pkg/node_modules/replicad-opencascadejs/LICENSE','')):
    with urlopen(urljoin(base,name),timeout=5) as response:
     self.assertEqual(response.status,200,name)
     self.assertIn(kind,response.headers.get('Content-Type',''),name)
   for name in ('review-3d.js','review-3d-law.js','review-3d-law-geometry.js','review-3d-geometry.js','review-3d-clipper.js','detail-3d-viewer.js','detail-3d-utils.js','GLTFLoader.js','SkeletonUtils.js'):
    self.assertIn(urljoin(base,name),seen)
   self.assertIn(urljoin(base,'roof-geometry.js'),seen)
   self.assertIn(urljoin(base,'layer-name-groups.js'),seen)
   self.assertIn(urljoin(base,'drawing-check.js'),seen)
   # 동적 계정 팝오버와 두 공급자 심볼도 실제 서버 허용 목록으로 확인한다.
   for name,kind in (('shared/account-window/popover.mjs','javascript'),('shared/account-window/popover-model.mjs','javascript'),('shared/account-window/account-popover.css','text/css'),('shared/account-window/shared-assets/kakao-symbol-approved.svg','image/svg+xml'),('shared/account-window/shared-assets/google-g.svg','image/svg+xml')):
    with urlopen(urljoin(base,name),timeout=5) as response:
     self.assertEqual(response.status,200,name)
     self.assertIn(kind,response.headers.get('Content-Type',''),name)
   with urlopen(urljoin(base,'fonts/NanumGothic-Regular.ttf'),timeout=5) as response:
    self.assertGreater(len(response.read()),1_000_000)
  finally:
   if server: server.shutdown();server.server_close()

 def test_block_double_click_opens_reference_editor(self):
  source=(ROOT/'app.js').read_text(encoding='utf-8')
  # 블록 더블클릭은 도면 위 제자리 편집(REFEDIT)으로 들어간다.
  self.assertIn("else if(hit.type==='block'&&!(typeof blockEdit!=='undefined'&&blockEdit))safe(()=>startBlockEdit());",source)

 def test_detail_glb_preview_mime_and_same_origin(self):
  class QuietHandler(Handler):
   def log_message(self,*args): pass
  import cad_asset_client as assets
  from urllib.request import Request
  from urllib.error import HTTPError
  import base64
  asset={'format':'barun-asset/1','kind':'detail','id':'x','glb':base64.b64encode(b'glTF\x02binary').decode(),'scenes':[]}
  with patch.object(assets,'get_asset',return_value=asset):
   server=ThreadingHTTPServer(('127.0.0.1',0),functools.partial(QuietHandler,directory=str(ROOT)))
   threading.Thread(target=server.serve_forever,daemon=True).start()
   base=f'http://127.0.0.1:{server.server_port}'
   try:
    route=base+'/api/detail-search/preview?id=x&source=library&format=glb'
    with urlopen(Request(route,headers={'Sec-Fetch-Site':'same-origin','X-CAD-Token':TOKEN})) as response:
     self.assertEqual(response.status,200)
     self.assertEqual(response.headers.get('Content-Type'),'model/gltf-binary')
     self.assertEqual(response.read(),b'glTF\x02binary')
    with self.assertRaises(HTTPError) as error:urlopen(Request(route,headers={'Sec-Fetch-Site':'same-origin'}))
    self.assertEqual(error.exception.code,403)
    for site in ('cross-site',None):
     headers={'Sec-Fetch-Site':site,'X-CAD-Token':TOKEN} if site else {'X-CAD-Token':TOKEN}
     with self.assertRaises(HTTPError) as error:urlopen(Request(route,headers=headers))
     self.assertEqual(error.exception.code,403)
    for bad in (route.replace('format=glb','format=exe'),route.replace('source=library','source=lh2017')):
     with self.assertRaises(HTTPError) as error:urlopen(Request(bad,headers={'Sec-Fetch-Site':'same-origin','X-CAD-Token':TOKEN}))
     self.assertEqual(error.exception.code,400)
    with patch.object(assets,'get_asset',side_effect=assets.CadAssetError('not_logged_in')):
     with self.assertRaises(HTTPError) as error:urlopen(Request(route,headers={'Sec-Fetch-Site':'same-origin','X-CAD-Token':TOKEN}))
     self.assertEqual(error.exception.code,401)
   finally:server.shutdown();server.server_close()

if __name__=='__main__': unittest.main()


class ReviewModelAssetTest(unittest.TestCase):
 def test_review_model_is_served(self):
  class QuietHandler(Handler):
   def log_message(self,*args):pass
  server=ThreadingHTTPServer(('127.0.0.1',0),functools.partial(QuietHandler,directory=str(ROOT)))
  threading.Thread(target=server.serve_forever,daemon=True).start()
  try:
   with urlopen(f'http://127.0.0.1:{server.server_port}/review-model.js',timeout=5) as response:
    self.assertEqual(response.status,200);self.assertIn('javascript',response.headers.get('Content-Type',''));self.assertIn('makeReviewItem',response.read().decode('utf-8'))
  finally:server.shutdown();server.server_close()
