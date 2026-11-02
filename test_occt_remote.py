import hashlib,io,os,tempfile,unittest
from pathlib import Path
from unittest.mock import patch
import occt_remote
PINNED=dict(occt_remote.FILES)

BODY=b'occt-wasm-bytes'
FILES={'replicad_single.wasm':(hashlib.sha256(BODY).hexdigest(),len(BODY))}

class Opener:
 def __init__(self,body=BODY,error=None):self.body=body;self.error=error;self.urls=[]
 def __call__(self,request,timeout):
  self.urls.append(request.full_url)
  if self.error:raise self.error
  return io.BytesIO(self.body)

class OcctRemoteTest(unittest.TestCase):
 def setUp(self):
  self.root=tempfile.TemporaryDirectory();self.addCleanup(self.root.cleanup)
  for p in (patch.dict(os.environ,{'LOCALAPPDATA':self.root.name}),patch.object(occt_remote,'FILES',FILES)):p.start();self.addCleanup(p.stop)

 def test_only_occt_dist_files_are_remote(self):
  self.assertEqual(occt_remote.name_of(occt_remote.DIST+'replicad_single.wasm'),'replicad_single.wasm')
  self.assertIsNone(occt_remote.name_of(occt_remote.DIST+'../package.json'))
  self.assertIsNone(occt_remote.name_of('/vendor/occt-pkg/NOTICE.md'))

 def test_downloads_once_then_serves_cache(self):
  opener=Opener()
  path=occt_remote.fetch('replicad_single.wasm',opener)
  self.assertEqual(path.read_bytes(),BODY)
  self.assertEqual(occt_remote.fetch('replicad_single.wasm',opener),path)
  self.assertEqual(opener.urls,[occt_remote.BASE_URL+'replicad_single.wasm'])
  self.assertTrue(occt_remote.BASE_URL.endswith('/downloads/barun-cad-occt/'+occt_remote.VERSION+'/'))

 def test_wrong_bytes_are_never_cached(self):
  with self.assertRaisesRegex(ValueError,'손상'):occt_remote.fetch('replicad_single.wasm',Opener(body=b'x'*len(BODY)))
  self.assertFalse((occt_remote.cache_dir()/'replicad_single.wasm').exists())

 def test_corrupt_cache_is_downloaded_again(self):
  target=occt_remote.cache_dir()/'replicad_single.wasm';target.parent.mkdir(parents=True);target.write_bytes(b'y'*len(BODY))
  opener=Opener()
  self.assertEqual(occt_remote.fetch('replicad_single.wasm',opener).read_bytes(),BODY)
  self.assertEqual(len(opener.urls),1)

 def test_offline_gives_plain_message(self):
  with self.assertRaisesRegex(ValueError,'인터넷'):occt_remote.fetch('replicad_single.wasm',Opener(error=OSError('down')))

 def test_pinned_hashes_match_vendor_package(self):
  dist=Path(__file__).parent/'vendor/occt-pkg/node_modules/replicad-opencascadejs/dist'
  if not dist.is_dir():self.skipTest('vendor/occt-pkg 없음')
  for name,(digest,size) in PINNED.items():
   data=(dist/name).read_bytes()
   self.assertEqual((hashlib.sha256(data).hexdigest(),len(data)),(digest,size),name)

if __name__=='__main__':unittest.main()
