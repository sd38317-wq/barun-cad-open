"""도면 저장(DWG): DXF 를 만든 뒤 내장 엔진(도면 변환과 같은 것)으로 DWG 로 바꿔 저장한다.
중간 파일은 임시 폴더에서만 쓰고 지우며, 실패는 한 문장 한국어로 알린다. 저장 경로는 셸이 등록한 것만 쓴다."""
import base64,json,tempfile,unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
import ezdxf
import batch_converter,exchange,server
from test_critic_e import doc,LiveServer
from test_critic_e2 import register,SECRET
from batch_converter import process

SIGNATURES={'2018':b'AC1032','2013':b'AC1027','2010':b'AC1024','2004':b'AC1018','2000':b'AC1015'}

def drawing_dxf(n=5):
    content,_=exchange.export_dxf(doc('D',n),'R2018')
    return content

class IsolatedTemp:
    """tempfile 이 쓰는 임시 폴더를 비어 있는 시험 폴더로 돌려, 저장이 끝난 뒤 남은 것이 없는지 본다."""
    def __enter__(self):
        self.holder=tempfile.TemporaryDirectory();self.root=Path(self.holder.name)
        self.patch=patch.object(batch_converter.tempfile,'tempdir',str(self.root));self.patch.start();return self.root
    def __exit__(self,*args):
        self.patch.stop();self.holder.cleanup()

class DxfToDwgTest(unittest.TestCase):
    def test_converts_with_the_bundled_engine_in_the_chosen_version_and_leaves_no_temp_files(self):
        for version in ('2018','2004'):
            with self.subTest(version=version),IsolatedTemp() as root:
                dwg,info=batch_converter.dxf_to_dwg(drawing_dxf(),version)
                self.assertTrue(dwg.startswith(SIGNATURES[version]),dwg[:6])
                self.assertEqual(info['version'],version);self.assertEqual(info['entities'],5);self.assertEqual(info['sourceEntities'],5)
                self.assertEqual(info['lost'],0);self.assertEqual(info['warnings'],[])
                self.assertEqual(list(root.iterdir()),[],'입력 DXF·출력 DWG·엔진 작업 폴더가 남으면 안 된다')

    def test_calls_the_converter_in_the_dxf_to_dwg_direction_on_a_temp_copy(self):
        calls=[]
        def fake(data):
            calls.append(dict(data));out=Path(data['folder'])/'save.dwg';out.write_bytes(b'AC1032fake')
            return {'path':str(out),'after':5,'sourceEntities':5,'engine':'ACadSharp 3.8.0'}
        with IsolatedTemp() as root,patch.object(batch_converter,'process',side_effect=fake):
            dwg,info=batch_converter.dxf_to_dwg(b'0\nEOF\n','2013')
            self.assertEqual(list(root.iterdir()),[])
        self.assertEqual(dwg,b'AC1032fake')
        self.assertEqual(calls[0]['action'],'convert');self.assertEqual(calls[0]['direction'],'dxf-dwg');self.assertEqual(calls[0]['version'],'2013')
        self.assertTrue(calls[0]['_source_path'].endswith('save.dxf'))
        self.assertTrue(str(calls[0]['folder']).startswith(str(root)),'결과는 임시 폴더에만 쓴다')

    def test_engine_failure_is_one_korean_sentence_and_cleans_up(self):
        failed={'failed':True,'message':'Entity count changed during output verification:','before':5,'after':4,'engine_version':'ACadSharp 3.8.0','route':'acadsharp','warnings':[]}
        with IsolatedTemp() as root,patch('batch_converter.subprocess.run',return_value=SimpleNamespace(returncode=1,stdout=json.dumps(failed).encode())):
            with self.assertRaises(ValueError) as caught:batch_converter.dxf_to_dwg(drawing_dxf(),'2018')
            self.assertEqual(list(root.iterdir()),[])
        message=str(caught.exception)
        self.assertTrue(message.startswith('DWG로 저장하지 못했습니다.'),message)
        self.assertIn('객체 수가 원본과 달라',message);self.assertIn('DXF',message)
        self.assertNotIn('{',message);self.assertNotIn('Entity',message)

    def test_missing_engine_and_bad_version_are_explained(self):
        with self.assertRaisesRegex(ValueError,'지원하지 않는 DWG 버전'):batch_converter.dxf_to_dwg(b'x','2007')
        with IsolatedTemp(),patch.object(batch_converter,'RUNTIME',Path('Z:/nowhere')):
            with self.assertRaisesRegex(ValueError,'설치 파일로 복구'):batch_converter.dxf_to_dwg(drawing_dxf(),'2018')

    def test_legacy_versions_refuse_korean_text_instead_of_writing_question_marks(self):
        korean=doc('K',2);korean['entities'].append({'id':'t','type':'text','layer':'0','position':{'x':0,'y':0},'text':'거실','height':250,'rotation':0})
        content,_=exchange.export_dxf(korean,'R2018')
        for version in ('2004','2000'):
            with self.subTest(version=version),IsolatedTemp() as root:
                with self.assertRaisesRegex(ValueError,'2010 이상'):batch_converter.dxf_to_dwg(content,version)
                self.assertEqual(list(root.iterdir()),[])
        with IsolatedTemp():
            dwg,_=batch_converter.dxf_to_dwg(content,'2010')
            self.assertTrue(dwg.startswith(b'AC1024'))
            dwg,_=batch_converter.dxf_to_dwg(drawing_dxf(),'2000')   # 영문뿐인 도면은 옛 버전도 된다
            self.assertTrue(dwg.startswith(b'AC1015'))

    def test_xclip_made_before_the_block_moved_keeps_its_window_in_the_dwg(self):
        # 내장 엔진은 DXF 를 읽을 때 SPATIAL_FILTER 의 '클립 당시 블록 역행렬'을 버린다. 경계점에 미리 곱해 두어야
        # DWG 에서도 같은 부분이 보인다(실도면 1370-2 에서 15곳이 25만 mm 어긋났다).
        from ezdxf.math import Matrix44
        from ezdxf.xclip import XClip
        with tempfile.TemporaryDirectory() as folder:
            doc=ezdxf.new('R2018',setup=True);block=doc.blocks.new('SITE')
            for x in range(0,3000,500):block.add_line((x,0),(x,1000))
            insert=doc.modelspace().add_blockref('SITE',(10000,0))
            clip=XClip(insert);clip.set_block_clipping_path([(0,0),(1200,800)])
            spatial=insert.get_extension_dict().dictionary['ACAD_FILTER']['SPATIAL']
            spatial.set_boundary_vertices([(700,0),(1900,800)]);spatial.set_inverse_insert_matrix(Matrix44.translate(-700,0,0))   # 클립한 뒤 700 옮긴 것과 같다
            expected=[tuple(round(c,6) for c in v) for v in XClip(insert).get_block_clipping_path().vertices]
            source=Path(folder)/'clip.dxf';doc.saveas(source)
            with IsolatedTemp():
                dwg,info=batch_converter.dxf_to_dwg(source.read_bytes(),'2018')
            self.assertEqual(info['xclipsBaked'],1)
            saved=Path(folder)/'clip.dwg';saved.write_bytes(dwg)
            back=batch_converter.process({'action':'convert','name':'clip.dwg','direction':'dwg-dxf','folder':folder,'_source_path':str(saved)})
            reread=ezdxf.readfile(back['path']);insert=reread.modelspace().query('INSERT')[0]
            self.assertEqual([tuple(round(c,6) for c in v) for v in XClip(insert).get_block_clipping_path().vertices],expected)

    def test_ole_frame_that_the_engine_cannot_write_is_left_out_and_reported(self):
        # 내장 엔진은 OLE2FRAME 의 이진 데이터를 비운 채 DWG 를 쓰다가 'Value cannot be null (buffer)' 로 도면 전체를 실패했다.
        doc=ezdxf.new('R2018',setup=True);msp=doc.modelspace()
        for x in range(5):msp.add_line((x*10,0),(x*10,10))
        msp.new_entity('OLE2FRAME',{}).binary_data=b'\x00'*64
        with tempfile.TemporaryDirectory() as folder:
            source=Path(folder)/'ole.dxf';doc.saveas(source)
            with IsolatedTemp():
                dwg,info=batch_converter.dxf_to_dwg(source.read_bytes(),'2018')
        self.assertTrue(dwg.startswith(SIGNATURES['2018']))
        self.assertEqual((info['entities'],info['sourceEntities'],info['lost']),(5,5,0))
        self.assertEqual(info['warnings'],[batch_converter.OLE_REMOVED_MESSAGE.format(count=1)])

    def test_fewer_objects_in_the_dwg_than_in_the_dxf_is_reported(self):
        def fake(data):
            out=Path(data['folder'])/'save.dwg';out.write_bytes(b'AC1032');return {'path':str(out),'after':3,'sourceEntities':5}
        with IsolatedTemp(),patch.object(batch_converter,'process',side_effect=fake):
            _,info=batch_converter.dxf_to_dwg(b'0\nEOF\n','2018')
        self.assertEqual(info['lost'],2);self.assertIn('DXF 5개 → DWG 3개',info['warnings'][0])

class DwgExportHttpTest(unittest.TestCase):
    def test_small_export_returns_dwg_bytes_and_dxf_stays_default(self):
        with LiveServer() as live:
            status,_,result=live.post('export',{'document':doc('S',4),'format':'dwg','dwgVersion':'2010'},timeout=120)
            self.assertEqual(status,200,result)
            self.assertTrue(base64.b64decode(result['data']).startswith(b'AC1024'))
            self.assertEqual(result['dwg']['version'],'2010');self.assertEqual(result['dwg']['entities'],4)
            status,_,plain=live.post('export',{'document':doc('S',4)},timeout=60)
            self.assertEqual(status,200,plain);self.assertNotIn('dwg',plain)
            self.assertIn(b'SECTION',base64.b64decode(plain['data'])[:200])
            status,_,bad=live.post('export',{'document':doc('S',4),'format':'dwg','dwgVersion':'1999'},timeout=60)
            self.assertEqual(status,400);self.assertIn('DWG 버전',bad['error'])

    def test_large_path_writes_the_dwg_only_to_a_shell_registered_dwg_target(self):
        with tempfile.TemporaryDirectory() as folder,patch.object(server,'SHELL_SECRET',SECRET),LiveServer() as live:
            target=Path(folder)/'배치도.dwg'
            status,registered=register(live,str(target),'dwg');self.assertEqual(status,200,registered)
            status,_,result=live.post('export',{'document':doc('L',6),'format':'dxf','saveToken':registered['saveToken']},timeout=60)
            self.assertEqual(status,400,'DWG 로 등록한 위치에 DXF 를 쓰면 안 된다');self.assertIn('형식',result['error'])
            status,_,result=live.post('export',{'document':doc('L',6),'format':'dwg','dwgVersion':'2018','saveToken':registered['saveToken']},timeout=120)
            self.assertEqual(status,200,result);self.assertEqual(result['path'],str(target))
            self.assertTrue(target.read_bytes().startswith(b'AC1032'));self.assertEqual(result['dwg']['entities'],6)
            self.assertEqual(sorted(p.name for p in Path(folder).iterdir()),['배치도.dwg'],'임시 파일이 남으면 안 된다')
            status,wrong=register(live,str(Path(folder)/'x.dxf'),'dwg')
            self.assertEqual(status,400);self.assertIn('확장자',wrong['error'])

    def test_validate_save_path_accepts_dwg_only_with_the_dwg_format(self):
        with tempfile.TemporaryDirectory() as folder:
            self.assertEqual(server.validate_save_path(str(Path(folder)/'a.dwg'),'dwg'),Path(folder)/'a.dwg')
            with self.assertRaises(ValueError):server.validate_save_path(str(Path(folder)/'a.dwg'),'dxf')
            with self.assertRaises(ValueError):server.validate_save_path(str(Path(folder)/'a.dxf'),'dwg')
            with self.assertRaises(ValueError):server.validate_save_path(str(Path(folder)/'a.dwg'),'exe')

def shifted_xclip_dxf(path,korean=False):
    """클립한 뒤 700 옮긴 블록(SPATIAL_FILTER 역행렬이 단위행렬이 아니다)이 든 DXF. 기대하는 블록 좌표 클립 경계를 돌려준다."""
    from ezdxf.math import Matrix44
    from ezdxf.xclip import XClip
    doc=ezdxf.new('R2018',setup=True);block=doc.blocks.new('SITE')
    for x in range(0,3000,500):block.add_line((x,0),(x,1000))
    if korean:doc.modelspace().add_text('거실',dxfattribs={'height':250})
    insert=doc.modelspace().add_blockref('SITE',(10000,0))
    XClip(insert).set_block_clipping_path([(0,0),(1200,800)])
    spatial=insert.get_extension_dict().dictionary['ACAD_FILTER']['SPATIAL']
    spatial.set_boundary_vertices([(700,0),(1900,800)]);spatial.set_inverse_insert_matrix(Matrix44.translate(-700,0,0))
    expected=[tuple(round(c,6) for c in v) for v in XClip(insert).get_block_clipping_path().vertices]
    doc.saveas(path);return expected

def block_clip(dwg_path,folder):
    from ezdxf.xclip import XClip
    back=process({'action':'convert','name':'back.dwg','direction':'dwg-dxf','folder':str(folder),'_source_path':str(dwg_path)})
    insert=ezdxf.readfile(back['path']).modelspace().query('INSERT')[0]
    return [tuple(round(c,6) for c in v) for v in XClip(insert).get_block_clipping_path().vertices]

class BatchDxfToDwgTest(unittest.TestCase):
    """'도면 변환' 창의 DXF → DWG(process direction dxf-dwg)도 저장과 같은 보정·차단을 한다. 파일마다 따로 판정한다."""
    def test_batch_conversion_bakes_xclip_on_a_temp_copy_and_keeps_the_original(self):
        with tempfile.TemporaryDirectory() as folder:
            folder=Path(folder);source=folder/'원본.dxf';expected=shifted_xclip_dxf(source);before=source.read_bytes()
            out=folder/'out';out.mkdir()
            for request in ({'_source_path':str(source)},{'_raw':before}):     # 경로로 넘긴 파일·화면에서 보낸 바이트
                with self.subTest(route=next(iter(request))):
                    result=process({'action':'convert','name':'원본.dxf','direction':'dxf-dwg','version':'2018','folder':str(out),**request})
                    self.assertFalse(result.get('failed'),result);self.assertEqual(result['xclipsBaked'],1)
                    self.assertEqual(block_clip(result['path'],folder),expected,'클립 창이 옮겨지면 안 된다')
            self.assertEqual(source.read_bytes(),before,'원본 DXF 는 건드리지 않는다')

    def test_legacy_versions_refuse_only_the_files_with_korean_text(self):
        with tempfile.TemporaryDirectory() as folder:
            folder=Path(folder);out=folder/'out';out.mkdir()
            korean=folder/'한글.dxf';shifted_xclip_dxf(korean,korean=True)
            plain=folder/'plain.dxf';shifted_xclip_dxf(plain)
            old=folder/'escaped.dxf';doc=ezdxf.new('R2000',setup=True);doc.modelspace().add_text('거실');doc.saveas(old)   # 옛 DXF 의 \U+ 표기
            self.assertIn(b'\\U+',old.read_bytes())
            for version,signature in (('2004',b'AC1018'),('2000',b'AC1015')):
                with self.subTest(version=version):
                    results={path.name:process({'action':'convert','name':path.name,'direction':'dxf-dwg','version':version,'folder':str(out),'_source_path':str(path)}) for path in (korean,plain,old)}
                    for name in ('한글.dxf','escaped.dxf'):
                        self.assertTrue(results[name]['failed'],results[name]);self.assertEqual(results[name]['code'],'LEGACY_VERSION_TEXT')
                        self.assertIn('2010 이상',results[name]['message']);self.assertNotIn('{',results[name]['message'])
                    self.assertFalse(results['plain.dxf'].get('failed'),results['plain.dxf'])
                    self.assertTrue(Path(results['plain.dxf']['path']).read_bytes().startswith(signature))
            self.assertEqual(sorted(p.stem.split('_')[0] for p in out.iterdir()),['plain','plain'],'거절한 파일은 결과를 남기지 않는다')
            result=process({'action':'convert','name':'한글.dxf','direction':'dxf-dwg','version':'2010','folder':str(out),'_source_path':str(korean)})
            self.assertFalse(result.get('failed'),result)

    def test_dwg_to_dxf_is_unchanged(self):
        with tempfile.TemporaryDirectory() as folder:
            folder=Path(folder);korean=folder/'한글.dxf';shifted_xclip_dxf(korean,korean=True)
            dwg=process({'action':'convert','name':'한글.dxf','direction':'dxf-dwg','version':'2018','folder':str(folder),'_source_path':str(korean)})
            result=process({'action':'convert','name':'한글.dwg','direction':'dwg-dxf','version':'2004','folder':str(folder),'_source_path':dwg['path']})
            self.assertFalse(result.get('failed'),result)
            self.assertNotIn('xclipsBaked',{k:v for k,v in result.items() if v})

if __name__=='__main__':unittest.main()
