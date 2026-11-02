"""원문을 확인한 구판 예제만 갱신하고 사용자 수정본은 보존한다."""
import base64, tempfile, unittest
from pathlib import Path
from unittest.mock import patch
import lisp_service as service

ROOT=Path(__file__).resolve().parent
class ExampleLayerMigrationTest(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory()
        self.patch=patch.object(service,'ROOT',Path(self.temp.name));self.patch.start()
        self.old=(ROOT/'test-fixtures/mcp-lisp/legacy-example.lsp').read_bytes()
        self.current=(ROOT/'examples/바른캐드_리습예제.lsp').read_bytes()
    def tearDown(self):self.patch.stop();self.temp.cleanup()
    def install(self,source):
        item={'id':'e'*32,'name':'바른캐드_리습예제.lsp','size':len(source),'commands':['BCIRCLE']}
        path=service.ROOT/(item['id']+'.bin');path.write_bytes(source);service.save_library([item]);return item,path
    def test_exact_old_example_refreshes_once_to_current_with_metadata(self):
        item,path=self.install(self.old)
        library=service.ensure_architecture_library()
        self.assertEqual(path.read_bytes(),self.current)
        entry=next(x for x in library if x['id']==item['id'])
        self.assertEqual(entry['size'],len(self.current));self.assertEqual(entry['commands'],['BCIRCLE','BBOX','BNUMBER','BLENGTH'])
        stamp=path.stat().st_mtime_ns;service.ensure_architecture_library();self.assertEqual(path.stat().st_mtime_ns,stamp)
        self.assertFalse(path.with_suffix('.previous').exists())
    def test_edited_or_previous_backed_example_is_preserved(self):
        for source,backed in [(self.old+b'; user edit',False),(self.old,True)]:
            with self.subTest(backed=backed):
                item,path=self.install(source)
                if backed:path.with_suffix('.previous').write_bytes(b'original backup')
                service.ensure_architecture_library();self.assertEqual(path.read_bytes(),source)
                if backed:self.assertEqual(path.with_suffix('.previous').read_bytes(),b'original backup')
    def test_status_refreshes_old_example_once_without_login(self):
        # 동봉 건축 리습은 2026-10-27 뺐다. 사용자가 등록한 예제 사본의 레이어 고침은 로그인 없이 상태 확인 때 한 번 한다.
        item,path=self.install(self.old)
        with patch.object(service.exchange,'autocad_console',return_value=None):
            first=service.process({'action':'status'});second=service.process({'action':'status'})
        self.assertEqual(first['bundledCount'],0);self.assertFalse(first['loginRequired'])
        self.assertEqual(path.read_bytes(),self.current);self.assertEqual([f['id'] for f in second['files']],[item['id']])
    def test_crlf_and_utf8_bom_old_copy_refreshes_without_touching_user_files(self):
        _,path=self.install(b'\xef\xbb\xbf'+self.old.replace(b'\n',b'\r\n'))
        user=service.ROOT/'user.bin';user.write_bytes(b'user data')
        service.ensure_architecture_library();self.assertEqual(path.read_bytes(),self.current);self.assertEqual(user.read_bytes(),b'user data')

if __name__=='__main__':unittest.main()
