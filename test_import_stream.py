"""S1/S7/S16 · NDJSON 가져오기 스트림, 캐시 정리, 오류 문구 검사."""
import gzip,json,tempfile,unittest,os,time
from pathlib import Path
from unittest.mock import patch
import import_stream,server

def synthetic_result(entities=5000,points=40,preservation_chars=3*import_stream.PRESERVATION_PART_CHARS+7):
    document={'version':2,'units':'mm','layers':[{'id':'a','name':'A','color':'#ffffff','visible':True,'locked':False}],'blocks':[{'name':'B','entities':[{'type':'line','layer':'a','points':[{'x':0,'y':0},{'x':1,'y':1}]}]}],
              'entities':[{'id':f'e{i}','type':'polyline','layer':'a','closed':False,'points':[{'x':float(i+j),'y':float(j)} for j in range(points)],'text':'한글\ud800'} for i in range(entities)],
              'sharedBlocks':{'DOOR':{'origin':{'x':0,'y':0},'entities':[{'type':'line','layer':'a','points':[{'x':0,'y':0},{'x':900,'y':0}]}]*3}},
              'dxfPreservation':{'format':'dxf-zlib-v1','data':'A'*preservation_chars,'handles':['1','2'],'version':'AC1032'}}
    return {'document':document,'report':{'imported':entities,'warnings':['w']}}

class ImportStreamTest(unittest.TestCase):
    def test_roundtrip_keeps_every_line_under_safe_size_and_repairs_surrogates(self):
        result=synthetic_result()
        with patch.object(import_stream,'PAGE_TARGET_BYTES',64*1024):
            lines=list(import_stream.iter_lines(result))
        self.assertGreater(len(lines),20)
        self.assertLessEqual(max(len(line) for line in lines),import_stream.SAFE_LINE_BYTES)
        kinds=[json.loads(line)['kind'] for line in lines]
        self.assertEqual(kinds[0],'header');self.assertEqual(kinds[-1],'end')
        self.assertIn('sharedBlock',kinds);self.assertIn('preservationMeta',kinds);self.assertEqual(kinds.count('preservation'),4)
        rebuilt=import_stream.assemble(lines)
        self.assertEqual(len(rebuilt['document']['entities']),5000)
        self.assertEqual(rebuilt['document']['entities'][7]['text'],'한글�')
        self.assertEqual(rebuilt['document']['dxfPreservation']['data'],result['document']['dxfPreservation']['data'])
        self.assertEqual(rebuilt['document']['dxfPreservation']['handles'],['1','2'])
        self.assertEqual(len(rebuilt['document']['sharedBlocks']['DOOR']['entities']),3)
        self.assertEqual(rebuilt['document']['blocks'][0]['name'],'B')
        self.assertEqual(rebuilt['report']['imported'],5000)
        self.assertNotIn('entities',json.loads(lines[0])['document'])

    def test_write_stream_is_atomic_and_validates_truncation(self):
        with tempfile.TemporaryDirectory() as folder:
            target=Path(folder)/'x.ndjson.gz'
            stats=import_stream.write_stream(synthetic_result(entities=50,preservation_chars=10),target)
            self.assertTrue(target.is_file());self.assertEqual(stats['lines'],len(list(gzip.open(target))))
            self.assertTrue(import_stream.stream_is_complete(target))
            self.assertEqual(len(import_stream.read_stream(target)['document']['entities']),50)
            raw=target.read_bytes();target.write_bytes(raw[:len(raw)//2])
            self.assertFalse(import_stream.stream_is_complete(target))
            target.write_bytes(b'');self.assertFalse(import_stream.stream_is_complete(target))
            self.assertEqual([p.name for p in Path(folder).glob('*.tmp')],[])

    def test_cached_stream_rebuilds_broken_cache_and_prunes_shared_policy(self):
        with tempfile.TemporaryDirectory() as folder, patch.object(server,'import_cache_dir',return_value=Path(folder)):
            calls=[]
            def convert():calls.append(1);return synthetic_result(entities=10,preservation_chars=1)
            target=Path(folder)/'k.ndjson.gz'
            path,hit=server.cached_stream(target,convert);self.assertFalse(hit);self.assertEqual(len(calls),1)
            path,hit=server.cached_stream(target,convert);self.assertTrue(hit);self.assertEqual(len(calls),1)
            target.write_bytes(target.read_bytes()[:20]);path,hit=server.cached_stream(target,convert);self.assertFalse(hit);self.assertEqual(len(calls),2)
            # S7: 옛 형식은 지우고, 최신 keep 개만 남긴다(업로드·경로 가져오기 공통).
            (Path(folder)/'legacy.json.gz').write_bytes(b'x')
            for index in range(15):
                item=Path(folder)/f'{index:02}.ndjson.gz';item.write_bytes(b'x'*10);os.utime(item,(time.time()-index,time.time()-index))
            server.prune_import_cache(keep=10,max_bytes=10**9)
            names=sorted(p.name for p in Path(folder).iterdir())
            self.assertNotIn('legacy.json.gz',names);self.assertEqual(len([n for n in names if n.endswith('.ndjson.gz')]),10)
            server.prune_import_cache(keep=10,max_bytes=25)
            self.assertLessEqual(len(list(Path(folder).glob('*.ndjson.gz'))),3)

    def test_import_semaphore_serialises_conversions(self):
        import threading
        with tempfile.TemporaryDirectory() as folder, patch.object(server,'import_cache_dir',return_value=Path(folder)):
            active=[];peak=[0];lock=threading.Lock()
            def convert():
                with lock:active.append(1);peak[0]=max(peak[0],len(active))
                time.sleep(0.15)
                with lock:active.pop()
                return synthetic_result(entities=3,preservation_chars=1)
            # 큰 도면(IMPORT_LARGE_BYTES 이상)만 한 번에 하나, 작은 도면은 같이 돈다
            threads=[threading.Thread(target=lambda i=i:server.cached_stream(Path(folder)/f'{i}.ndjson.gz',convert,server.IMPORT_LARGE_BYTES)) for i in range(3)]
            for t in threads:t.start()
            for t in threads:t.join()
            self.assertEqual(peak[0],1)
            peak[0]=0
            threads=[threading.Thread(target=lambda i=i:server.cached_stream(Path(folder)/f's{i}.ndjson.gz',convert,10)) for i in range(3)]
            for t in threads:t.start()
            for t in threads:t.join()
            self.assertGreater(peak[0],1);self.assertEqual(server.import_queue_state(),{'active':0,'waiting':0,'largeActive':0})

    def test_user_error_message_hides_internal_key_errors(self):
        self.assertIn("항목(color)",server.user_error_message(KeyError('color')))
        self.assertNotEqual(server.user_error_message(KeyError('color')),"'color'")
        self.assertIn('형식이 예상과 달라',server.user_error_message(TypeError("'NoneType' object is not subscriptable")))
        self.assertEqual(server.user_error_message(ValueError('한글 안내')),'한글 안내')
        self.assertTrue(server.user_error_message(RuntimeError('boom')).startswith('처리 중 오류가 났습니다'))

    def test_status_reports_pid_port_and_stream_version(self):
        import functools,threading
        from urllib.request import urlopen
        httpd=server.LocalServer(('127.0.0.1',0),functools.partial(server.Handler,directory=str(server.ROOT)))
        thread=threading.Thread(target=httpd.serve_forever,daemon=True);thread.start()
        try:
            with urlopen(f'http://127.0.0.1:{httpd.server_port}/api/status',timeout=3) as response:
                self.assertEqual(response.headers.get('X-Frame-Options'),'DENY')
                data=json.loads(response.read())
            self.assertEqual(data['pid'],os.getpid());self.assertEqual(data['port'],httpd.server_port);self.assertEqual(data['importStream'],1)
            self.assertEqual(server.Handler.timeout,120)
        finally:httpd.shutdown();httpd.server_close();thread.join(timeout=3)

    def test_connection_file_is_namespaced_by_port(self):
        with tempfile.TemporaryDirectory() as folder, patch.dict(os.environ,{'LOCALAPPDATA':folder}):
            target=server.write_connection_file(18825,'http://127.0.0.1:18825','tok')
            self.assertEqual(target.name,'connection-18825.json')
            state=json.loads(target.read_text(encoding='utf8'));self.assertEqual(state['pid'],os.getpid());self.assertEqual(state['token'],'tok')
            server.remove_connection_file();self.assertFalse(target.exists())

if __name__=='__main__':unittest.main()
