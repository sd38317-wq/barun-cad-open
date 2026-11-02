import unittest,tempfile,json,io,base64
from pathlib import Path
FIXTURES = Path(__file__).resolve().parent / 'test-fixtures' / 'exchange'
import project
from pdf_service import render,process
from pypdf import PdfReader

class StudioTest(unittest.TestCase):
    def test_network_folder_only_office_hosts(self):
        # 감사 2: 바깥 주소 공유 폴더는 여는 순간 로그인 정보(NTLM)가 나가므로 거절, 사무실 NAS 는 허락.
        for ok in (r'\\192.168.0.10\개발', r'\\NAS\share', r'\\192.168.0.5\a', 'C:/a', '//10.0.0.2/x'):project.network_path(ok)
        for bad in (r'\\evil.com\s', r'\\8.8.8.8\s', r'\\?\UNC\evil\s', r'\\host@SSL\s', '//evil.com/s'):
            with self.assertRaises(ValueError,msg=bad):project.folder(bad)
    def test_block_clip_is_written_as_pdf_clipping_path(self):
        data=render({'sheets':[{'number':'XCLIP','bounds':{'minX':0,'minY':0,'maxX':1000,'maxY':1000},'denominator':100,'entities':[{'type':'block','clip':{'enabled':True,'points':[{'x':100,'y':100},{'x':500,'y':100},{'x':500,'y':500},{'x':100,'y':500}]},'entities':[{'type':'text','position':{'x':0,'y':200},'height':100,'text':'original retained'}]}]}]})
        page=PdfReader(io.BytesIO(data)).pages[0];content=page.get_contents().get_data()
        self.assertIn(b'100 100 m 500 100 l 500 500 l 100 500 l h W',content)
        self.assertIn('original retained',page.extract_text())
    def test_inheritance_and_previous_file(self):
        with tempfile.TemporaryDirectory() as td:
            p=Path(td);child=p/'child';child.mkdir()
            project.update(str(p),{'paper':'A1','textHeight':250,'author':'설계자'})
            project.update(str(child),{'textHeight':300})
            s=project.settings(str(child));self.assertEqual(s['settings']['paper'],'A1');self.assertEqual(s['settings']['textHeight'],300)
            project.save(str(child),'test.dxf',b'first');project.save(str(child),'test.dxf',b'second')
            self.assertEqual((child/'test.dxf.previous').read_bytes(),b'first')
            with self.assertRaises(ValueError):project.save(str(child),'../escape.dxf',b'bad')
    def test_pdf_geometry_text_and_merge_split(self):
        job=json.loads((FIXTURES / 'studio-job.json').read_text(encoding='utf8'))
        data=render(job);r=PdfReader(io.BytesIO(data));self.assertEqual(len(r.pages),2)
        self.assertAlmostEqual(float(r.pages[0].mediabox.width),841*72/25.4,places=3)
        self.assertIn('한글 도곽',r.pages[0].extract_text())
        parts=process({'action':'split','data':base64.b64encode(data).decode()})['files'];self.assertEqual(len(parts),2)
        joined=process({'action':'merge','files':parts});self.assertEqual(len(PdfReader(io.BytesIO(base64.b64decode(joined['data']))).pages),2)
        (Path(tempfile.mkdtemp(prefix='barun-cad-pdf-'))/'건축도곽_검증.pdf').write_bytes(data)
        job['sheets'][0]['denominator']=1
        with self.assertRaises(ValueError):render(job)

if __name__=='__main__':unittest.main(verbosity=2)
