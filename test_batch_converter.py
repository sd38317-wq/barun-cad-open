import base64,json,tempfile,unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
import ezdxf
import batch_converter
from batch_converter import process

class FallbackMockTests(unittest.TestCase):
    """프로세스를 대역으로 쓰는 시험은 설치된 보조 실행 파일에 의존하지 않는다."""
    def setUp(self):
        super().setUp()
        folder = self.enterContext(tempfile.TemporaryDirectory())
        runtime = Path(folder) / 'acadrust-runtime'
        runtime.mkdir()
        (runtime / ('barun-dwg2dxf' + batch_converter.runtime_paths.EXE)).write_bytes(b'test executable marker')
        original = batch_converter.runtime_paths.bundled_runtime
        self.enterContext(patch('batch_converter.runtime_paths.bundled_runtime',
            side_effect=lambda name: runtime if name == 'acadrust-runtime' else original(name)))
        self.enterContext(patch('batch_converter._attach_to_job', return_value=True))
        self.enterContext(patch('batch_converter._resume_fallback'))
        self.enterContext(patch('batch_converter._run_fallback',
            side_effect=lambda *a, **kw: batch_converter.subprocess.run(*a, **kw)))


class BatchConverterTests(FallbackMockTests):
 def test_acadrust_fallback_path_and_memory_limit_options(self):
  self.assertTrue(str(batch_converter.runtime_paths.bundled_runtime('acadrust-runtime')).endswith('acadrust-runtime'))
  self.assertTrue(str(batch_converter.FALLBACK_MEMORY_LIMIT) == str(4 * 1024 * 1024 * 1024))
  options = batch_converter._fallback_process_options()
  self.assertTrue(options == {} or 'preexec_fn' in options)

 def test_unreadable_region_sidecar_keeps_secondary_first_and_original_counts(self):
  from exchange_test import region_sample
  reads=[];calls=[]
  with tempfile.TemporaryDirectory() as folder:
   def run(args,**kwargs):
    calls.append(args)
    if len(calls)==1:
     doc=ezdxf.new('R2018');doc.modelspace().add_line((0,0),(10,0));doc.saveas(args[2])
     record={'handle':'FFFF','ownerBlock':'*Model_Space','data':base64.b64encode(b'invalid ACIS').decode(),'binary':False}
     report={'inputTypes':{'Region':1,'Line':1},'expectedOutputTypes':{'REGION':1,'LINE':1},'decomposedTypes':{'ACAD_TABLE':4},'acisRegions':[record],'unresolvedDecompositions':[{'ownerBlock':'NESTED','type':'ACAD_TABLE','count':1}],'warnings':[]}
     return SimpleNamespace(returncode=0,stdout=json.dumps(report).encode())
    doc=ezdxf.new('R2010');region_sample(doc);doc.modelspace().add_line((0,0),(10,0));doc.saveas(args[args.index('-o')+1])
    return SimpleNamespace(returncode=0,stdout=b'fallback ok')
   def read(path):reads.append(Path(path).name);return ezdxf.readfile(path)
   with patch('batch_converter.subprocess.run',side_effect=run):
    result=process({'action':'convert','name':'region.dwg','direction':'dwg-dxf','folder':folder,'_raw':b'AC10-test','_no_parallel_fallback':True,'_defer_dxf_validation':True,'_keep_document':True,'_reader':read})
   self.assertFalse(result.get('failed'),result);self.assertEqual(reads,['verified-fallback.dxf'])
   self.assertEqual(result['route'],'acadrust-fallback');self.assertFalse(result['decomposedTypes']);self.assertFalse(result['unresolvedDecompositions'])
   self.assertNotIn('acisRegions',result)

 def test_bundled_roundtrip_and_no_overwrite(self):
  with tempfile.TemporaryDirectory() as folder:
   source=Path(folder)/'original.dxf';doc=ezdxf.new('R2018',setup=True);doc.modelspace().add_line((0,0),(5000,0));doc.modelspace().add_circle((100,200),50);doc.saveas(source)
   raw=source.read_bytes();data={'action':'convert','name':'sample.dxf','direction':'dxf-dwg','folder':folder,'data':base64.b64encode(raw).decode()}
   first=process(data);second=process(data);self.assertNotEqual(first['path'],second['path']);self.assertEqual(source.read_bytes(),raw)
   result=process({'action':'convert','name':'sample.dwg','direction':'dwg-dxf','folder':folder,'data':base64.b64encode(Path(first['path']).read_bytes()).decode()})
   self.assertEqual(len(ezdxf.readfile(result['path']).modelspace()),2)
 def test_wrong_direction_rejected(self):
  self.assertTrue(process({'action':'convert','name':'test.dwg','direction':'dxf-dwg'})['failed'])
 def test_path_name_rejected(self):
  self.assertTrue(process({'action':'convert','name':'../test.dxf','direction':'dxf-dwg'})['failed'])
 def test_any_primary_dwg_parser_failure_uses_acadrust_fallback(self):
  with tempfile.TemporaryDirectory() as folder:
   calls=[]
   def run(args,**kwargs):
    calls.append(args)
    if len(calls)==1:
     payload={'failed':True,'message':'Value was either too large or too small for an Int16.','engine_version':'ACadSharp 3.7.1','route':'acadsharp','warnings':[]}
     return SimpleNamespace(returncode=1,stdout=json.dumps(payload).encode())
    target=Path(args[args.index('-o')+1]);doc=ezdxf.new('R2018');doc.modelspace().add_line((0,0),(10,0));doc.saveas(target)
    return SimpleNamespace(returncode=0,stdout=b'fallback ok')
   with patch('batch_converter.subprocess.run',side_effect=run):
    result=process({'action':'convert','name':'overflow.dwg','direction':'dwg-dxf','folder':folder,'_raw':b'AC10-test','_no_parallel_fallback':True})
   self.assertFalse(result.get('failed'),result)
   self.assertEqual(result['route'],'acadrust-fallback')
   self.assertEqual(len(ezdxf.readfile(result['path']).modelspace()),1)
   self.assertEqual(len(calls),2)
 def test_result_is_named_only_after_full_write(self):
  # 감사 6: 쓰다 실패하면 정상 이름의 반쪽 결과가 남지 않고, 같은 이름은 덮어쓰지 않고 _1 로 붙인다.
  def run(args,**kwargs):
   if '-o' not in args:return SimpleNamespace(returncode=1,stdout=json.dumps({'failed':True,'message':'x','warnings':[]}).encode())
   doc=ezdxf.new('R2018');doc.modelspace().add_line((0,0),(10,0));doc.saveas(Path(args[args.index('-o')+1]))
   return SimpleNamespace(returncode=0,stdout=b'ok')
  data=lambda folder:{'action':'convert','name':'plan.dwg','direction':'dwg-dxf','folder':folder,'_raw':b'AC10-test','_no_parallel_fallback':True}
  with tempfile.TemporaryDirectory() as folder,patch('batch_converter.subprocess.run',side_effect=run):
   with patch('batch_converter.os.fsync',side_effect=OSError(28,'No space left on device')):
    self.assertTrue(process(data(folder)).get('failed'))
   self.assertEqual(sorted(p.name for p in Path(folder).iterdir()),[],'실패하면 아무것도 남기지 않는다')
   first=process(data(folder));second=process(data(folder))
   self.assertEqual([Path(first['path']).name,Path(second['path']).name],['plan.dxf','plan_1.dxf'])
   self.assertEqual(sorted(p.name for p in Path(folder).iterdir()),['plan.dxf','plan_1.dxf'])
 def test_no_hardlink_folder_still_names_only_after_full_write(self):
  # 검토 B1: 하드 링크를 못 쓰는 폴더(FAT·일부 공유)도 최종 이름에 바로 쓰지 않고, 다 쓴 임시 파일의 이름을 바꾼다.
  def run(args,**kwargs):
   if '-o' not in args:return SimpleNamespace(returncode=1,stdout=json.dumps({'failed':True,'message':'x','warnings':[]}).encode())
   doc=ezdxf.new('R2018');doc.modelspace().add_line((0,0),(10,0));doc.saveas(Path(args[args.index('-o')+1]))
   return SimpleNamespace(returncode=0,stdout=b'ok')
  data=lambda folder:{'action':'convert','name':'plan.dwg','direction':'dwg-dxf','folder':folder,'_raw':b'AC10-test','_no_parallel_fallback':True}
  with tempfile.TemporaryDirectory() as folder,patch('batch_converter.subprocess.run',side_effect=run),patch('batch_converter.os.link',side_effect=OSError(1,'hard links not supported')):
   with patch('batch_converter.os.fsync',side_effect=OSError(28,'No space left on device')):
    self.assertTrue(process(data(folder)).get('failed'))
   self.assertEqual(list(Path(folder).iterdir()),[])
   first=process(data(folder));second=process(data(folder))
   self.assertEqual(sorted(p.name for p in Path(folder).iterdir()),['plan.dxf','plan_1.dxf'])
   self.assertEqual(len(ezdxf.readfile(second['path']).modelspace()),1)
 def test_failed_engines_return_short_user_message_without_internal_json(self):
  with tempfile.TemporaryDirectory() as folder:
   primary={'failed':True,'message':'Value was either too large or too small for an Int16.','engine_version':'ACadSharp 3.7.1','route':'acadsharp'}
   results=[SimpleNamespace(returncode=1,stdout=json.dumps(primary).encode()),SimpleNamespace(returncode=1,stdout=b'fallback native details')]
   with patch('batch_converter.subprocess.run',side_effect=results):
    result=process({'action':'convert','name':'broken.dwg','direction':'dwg-dxf','folder':folder,'_raw':b'AC10-test','_no_parallel_fallback':True})
   self.assertTrue(result['failed'])
   self.assertNotIn('Int16',result['message'])
   self.assertNotIn('{',result['message'])
   self.assertLess(len(result['message']),180)
 def test_parallel_fallback_is_used_when_primary_fails_and_stopped_when_it_succeeds(self):
  # 보조 엔진은 기본 엔진과 함께 미리 돈다. 기본 엔진이 떨어지면 그 결과를 쓰고, 성공하면 끝내고 버린다.
  class Early:
   instances=[]
   def __init__(self,args,**kwargs):
    self.args=args;self.returncode=None;self.killed=False;Early.instances.append(self)
    target=Path(args[args.index('-o')+1]);doc=ezdxf.new('R2018');doc.modelspace().add_line((0,0),(10,0));doc.saveas(target)
   def poll(self):return self.returncode
   def kill(self):self.killed=True;self.returncode=-9
   def communicate(self,timeout=None):
    if self.returncode is None:self.returncode=0
    return (b'fallback ok',None)
  failed={'failed':True,'message':'Entity count changed during output verification:','engine_version':'ACadSharp 3.7.1','route':'acadsharp','warnings':[]}
  with tempfile.TemporaryDirectory() as folder:
   with patch('batch_converter.subprocess.Popen',Early),patch('batch_converter.subprocess.run',return_value=SimpleNamespace(returncode=1,stdout=json.dumps(failed).encode())) as run:
    result=process({'action':'convert','name':'lost.dwg','direction':'dwg-dxf','folder':folder,'_raw':b'AC10-test'})
   self.assertFalse(result.get('failed'),result)
   self.assertEqual(result['route'],'acadrust-fallback')
   self.assertEqual(run.call_count,1)            # 보조 엔진을 다시 돌리지 않았다
   self.assertEqual(len(ezdxf.readfile(result['path']).modelspace()),1)
   self.assertFalse(Early.instances[-1].killed)
  with tempfile.TemporaryDirectory() as folder:
   def primary(args,**kwargs):
    doc=ezdxf.new('R2018');doc.modelspace().add_circle((0,0),5);doc.saveas(args[2])
    return SimpleNamespace(returncode=0,stdout=json.dumps({'route':'acadsharp','warnings':[],'before':1,'after':1}).encode())
   with patch('batch_converter.subprocess.Popen',Early),patch('batch_converter.subprocess.run',side_effect=primary):
    result=process({'action':'convert','name':'ok.dwg','direction':'dwg-dxf','folder':folder,'_raw':b'AC10-test'})
   self.assertFalse(result.get('failed'),result)
   self.assertEqual(ezdxf.readfile(result['path']).modelspace()[0].dxftype(),'CIRCLE')
   self.assertTrue(Early.instances[-1].killed)
if __name__=='__main__':unittest.main()
