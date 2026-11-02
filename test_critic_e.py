"""검토자(Opus) 지적 재현 테스트 · 실제 서버·파일로 검사한다.
t1 캐시 무결성(페이지 누락) / t2 변환 대기열 / t4 복구 세대·포트 예비 / 종료 전 flush / 대용량 복구 왕복 / 줄 단위 저장 요청."""
import functools,gzip,json,os,tempfile,threading,time,unittest,importlib
from pathlib import Path
from unittest.mock import patch
from urllib.request import Request,urlopen
from urllib.error import HTTPError
import ezdxf
import import_stream,server,bridge

def doc(tag,n=3):return {'version':2,'units':'mm','layers':[{'id':'0','name':'0','color':'#ffffff','visible':True,'locked':False}],'blocks':[],'entities':[{'id':f'{tag}{i}','type':'line','layer':'0','points':[{'x':0,'y':0},{'x':i,'y':1}]} for i in range(n)]}

class LiveServer:
    """테스트용 인프로세스 엔진(포트 0). 토큰·Origin 을 갖춰 실제 핸들러를 거친다."""
    def __enter__(self):
        self.httpd=server.LocalServer(('127.0.0.1',0),functools.partial(server.Handler,directory=str(server.ROOT)))
        self.thread=threading.Thread(target=self.httpd.serve_forever,daemon=True);self.thread.start()
        self.origin=f'http://127.0.0.1:{self.httpd.server_port}';return self
    def __exit__(self,*args):
        self.httpd.shutdown();self.httpd.server_close();self.thread.join(timeout=3)
    def post(self,route,data=None,body=None,content_type='application/json',timeout=30):
        raw=body if body is not None else json.dumps(data).encode('utf-8')
        request=Request(self.origin+'/api/'+route,raw,{'Content-Type':content_type,'X-CAD-Token':server.TOKEN,'Origin':self.origin})
        try:
            with urlopen(request,timeout=timeout) as response:
                payload=response.read();headers=dict(response.headers)
                if 'x-ndjson' in headers.get('Content-Type',''):payload=gzip.decompress(payload) if headers.get('Content-Encoding')=='gzip' else payload;return response.status,headers,payload
                return response.status,headers,json.loads(payload)
        except HTTPError as error:return error.code,dict(error.headers),json.loads(error.read() or b'{}')
    def status(self):
        with urlopen(self.origin+'/api/status',timeout=5) as response:return json.loads(response.read())

def reset_bridge():
    bridge.flush_recovery();bridge.clients.clear();bridge.queue.clear();bridge.results.clear();bridge.active=None
    bridge._written=None;bridge._has_content=None
    with bridge._write_lock:bridge._pending=None;bridge._last_error=None;bridge._last_write=0.0

def new_engine_session(instance):
    """엔진 프로세스를 새로 띄운 것처럼 브리지 상태를 초기화한다(검토자 t4 의 importlib.reload 와 같은 효과)."""
    reset_bridge();bridge.configure(instance);return bridge

class CacheIntegrityTest(unittest.TestCase):
    def test_missing_entity_page_is_detected_by_server_and_every_assembler(self):
        result={'document':doc('E',3000),'report':{'imported':3000}}
        with tempfile.TemporaryDirectory() as folder, patch.object(import_stream,'PAGE_TARGET_BYTES',20_000):
            target=Path(folder)/'x.ndjson.gz';import_stream.write_stream(result,target)
            self.assertTrue(import_stream.stream_is_complete(target))
            lines=gzip.decompress(target.read_bytes()).split(b'\n')
            pages=[i for i,l in enumerate(lines) if l.startswith(b'{"kind":"entities"')];self.assertGreater(len(pages),3)
            del lines[pages[1]]   # 검토자 t1 변형 D: gzip 정상, end 있음, 페이지 하나 누락
            target.write_bytes(gzip.compress(b'\n'.join(lines),1))
            self.assertFalse(import_stream.stream_is_complete(target))          # 서버: 캐시 적중으로 쓰지 않는다
            with self.assertRaises(import_stream.StreamError) as caught:import_stream.assemble(l for l in lines if l.strip())
            self.assertIn('불완전',str(caught.exception))                     # 조립기: 조용히 넘기지 않는다
            calls=[]
            with patch.object(server,'import_cache_dir',return_value=Path(folder)):
                path,hit=server.cached_stream(target,lambda:(calls.append(1),{'document':doc('E',3000),'report':{}})[1],10)
            self.assertFalse(hit);self.assertEqual(len(calls),1);self.assertTrue(import_stream.stream_is_complete(path))
            self.assertEqual(len(import_stream.read_stream(path)['document']['entities']),3000)

    def test_end_record_carries_counts_lines_and_bytes(self):
        lines=list(import_stream.iter_lines({'document':doc('C',10),'report':{}}))
        end=json.loads(lines[-1]);self.assertEqual(end['lines'],len(lines)-1);self.assertEqual(end['bytes'],sum(len(l) for l in lines[:-1]));self.assertEqual(end['counts']['entities'],10)

class ReopenCacheTest(unittest.TestCase):
    def test_reopen_does_not_read_the_drawing_and_a_changed_drawing_converts_again(self):
        # 인터넷 너머 NAS(초당 2MB)에서 같은 도면을 다시 열 때 파일을 통째로 다시 받지 않는다(2026-10-29).
        with tempfile.TemporaryDirectory() as folder, patch.object(server,'import_cache_dir',return_value=Path(folder)/'cache'):
            (Path(folder)/'cache').mkdir();drawing=Path(folder)/'plan.dxf'
            d=ezdxf.new('R2018');d.modelspace().add_line((0,0),(1,0));d.saveas(drawing)
            calls=[];import exchange;real=exchange.import_file_path
            def counted(*a,**k):calls.append(1);return real(*a,**k)
            with patch.object(exchange,'import_file_path',counted):
                self.assertFalse(server.cached_import_path_body(drawing,'.dxf')[1])
                path_open=Path.open
                def guarded(self,*a,**k):
                    if self==drawing:raise AssertionError('reopen read the drawing')
                    return path_open(self,*a,**k)
                with patch.object(Path,'open',guarded):
                    self.assertTrue(server.cached_import_path_body(drawing,'.dxf')[1])
                stat=drawing.stat();os.utime(drawing,ns=(stat.st_atime_ns,stat.st_mtime_ns+1_000_000_000))
                self.assertFalse(server.cached_import_path_body(drawing,'.dxf')[1])
            self.assertEqual(len(calls),2)

class ImportQueueTest(unittest.TestCase):
    def test_small_drawing_is_not_blocked_behind_large_conversion_and_queue_is_visible(self):
        with tempfile.TemporaryDirectory() as folder:
            big=Path(folder)/'big.dxf';small=Path(folder)/'small.dxf'
            for path in (big,small):
                d=ezdxf.new('R2018');d.modelspace().add_line((0,0),(1,0))
                if path is big:
                    for i in range(50):d.modelspace().add_line((i,0),(i,1))
                d.saveas(path)
            real=server.exchange_import_path if hasattr(server,'exchange_import_path') else None
            import exchange
            original=exchange.import_file_path
            def slow(path,extension,*args,**kwargs):
                if Path(path).name=='big.dxf':time.sleep(2.5)
                return original(path,extension,*args,**kwargs)
            with patch.object(server,'import_cache_dir',return_value=Path(folder)/'cache'), patch.object(server,'IMPORT_LARGE_BYTES',big.stat().st_size), patch.object(exchange,'import_file_path',slow), LiveServer() as live:
                (Path(folder)/'cache').mkdir(exist_ok=True)
                # 작은 파일이 큰 파일보다 커지지 않도록 small 을 조금 더 작게 맞춘다
                self.assertLess(small.stat().st_size,big.stat().st_size)
                timings={}
                def run(name,path):
                    t=time.perf_counter();status,headers,body=live.post('import-path',{'path':str(path),'extension':'.dxf'},timeout=60);timings[name]=(status,time.perf_counter()-t)
                threads=[threading.Thread(target=run,args=('big',big)),threading.Thread(target=run,args=('small',small))]
                threads[0].start();time.sleep(0.4)
                snapshot=live.status()['importQueue']
                threads[1].start()
                for t in threads:t.join()
                self.assertEqual(timings['big'][0],200);self.assertEqual(timings['small'][0],200)
                self.assertLess(timings['small'][1],1.5,'작은 도면이 큰 변환 뒤에서 기다렸다')
                self.assertEqual(snapshot['largeActive'],1);self.assertEqual(snapshot['active'],1)
                self.assertEqual(live.status()['importQueue'],{'active':0,'waiting':0,'largeActive':0})

class RecoveryGenerationsTest(unittest.TestCase):
    def setUp(self):reset_bridge()
    def tearDown(self):reset_bridge()
    def pulse(self,client,document=None,fresh=False,dirty=False):
        data={'client':client,'revision':1,'active':True,'dirty':dirty}
        if fresh:data['freshLaunch']=True
        if document is not None:data['document']=document
        r=bridge.pulse(data);bridge.flush_recovery();return r
    def test_critic_t4_sequence_keeps_unsaved_work_across_three_launches(self):
        with tempfile.TemporaryDirectory() as folder, patch.dict(os.environ,{'BARUN_CAD_RECOVERY_DIR':folder}), patch.object(bridge,'RECOVERY_DEBOUNCE_SECONDS',0.0):
            (Path(folder)/'recovery.json').write_text(json.dumps({'document':doc('L1')}),'utf8')
            new_engine_session('18765')
            self.pulse('c1',{'entities':[]},fresh=True)                       # 1 fresh empty
            self.assertEqual(bridge.restore()['document']['entities'][0]['id'],'L10')
            self.pulse('c1',doc('W1'),dirty=True)                              # 2 S1 edits W1 then crashes
            new_engine_session('18765');self.pulse('c2',{'entities':[]},fresh=True)   # 3 S2 fresh → W1 must be preserved (dirty)
            self.assertEqual(len(bridge.session_files()),1)
            self.pulse('c2',doc('F2'),dirty=False)                             # 4 S2 opens reference F2 (not dirty)
            new_engine_session('18765');self.pulse('c3',{'entities':[]},fresh=True)   # 5 S3 fresh → F2 is not dirty → no new generation, W1 generation stays
            files=bridge.session_files();self.assertEqual(len(files),1)
            self.assertEqual(json.loads(files[0].read_text('utf8'))['document']['entities'][0]['id'],'W10')
            self.assertTrue(any('W1' in p.read_text('utf8') for p in Path(folder).glob('*') if p.is_file()))
            # 세 번 더 dirty 세션을 만들면 최신 3세대만 남고, 서로 덮어쓰지 않는다
            for tag in ('W2','W3','W4'):
                self.pulse('cx',doc(tag),dirty=True);time.sleep(1.05);new_engine_session('18765');self.pulse('cy',{'entities':[]},fresh=True)
            names=[json.loads(p.read_text('utf8'))['document']['entities'][0]['id'][:2] for p in bridge.session_files()]
            self.assertEqual(names,['W4','W3','W2'])
    def test_fallback_port_reads_channel_recovery_before_legacy(self):
        with tempfile.TemporaryDirectory() as folder, patch.dict(os.environ,{'BARUN_CAD_RECOVERY_DIR':folder,'BARUN_CAD_CHANNEL_PORT':'18765'}):
            (Path(folder)/'recovery.json').write_text(json.dumps({'document':doc('L1')}),'utf8')
            (Path(folder)/'recovery-18765.json').write_text(json.dumps({'document':doc('P1'),'dirty':True}),'utf8')
            new_engine_session('18865')
            restored=bridge.restore();self.assertEqual(restored['document']['entities'][0]['id'],'P10');self.assertIn('기본 포트',restored['recoveryWarning'])
            (Path(folder)/'recovery-18765.json').unlink()
            self.assertEqual(bridge.restore()['document']['entities'][0]['id'],'L10')

class ShutdownAndLargeRecoveryTest(unittest.TestCase):
    def setUp(self):reset_bridge()
    def tearDown(self):reset_bridge()
    def test_shutdown_endpoint_flushes_pending_recovery_before_closing(self):
        with tempfile.TemporaryDirectory() as folder, patch.object(bridge,'RECOVERY',Path(folder)/'recovery-1.json'), patch.object(bridge,'RECOVERY_DEBOUNCE_SECONDS',30.0):
            httpd=server.LocalServer(('127.0.0.1',0),functools.partial(server.Handler,directory=str(server.ROOT)))
            thread=threading.Thread(target=httpd.serve_forever,daemon=True);thread.start()
            origin=f'http://127.0.0.1:{httpd.server_port}'
            try:
                def post(route,data):
                    request=Request(origin+'/api/'+route,json.dumps(data).encode(),{'Content-Type':'application/json','X-CAD-Token':server.TOKEN,'Origin':origin})
                    with urlopen(request,timeout=5) as response:return json.loads(response.read())
                post('bridge',{'client':'c','revision':1,'active':True,'dirty':True,'document':doc('Z'),'results':[]})
                time.sleep(0.3)   # 첫 저장은 바로 쓴다
                self.assertEqual(json.loads(bridge.RECOVERY.read_text('utf8'))['document']['entities'][0]['id'],'Z0')
                post('bridge',{'client':'c','revision':2,'active':True,'dirty':True,'document':doc('Q'),'results':[]})
                time.sleep(0.3)
                self.assertEqual(json.loads(bridge.RECOVERY.read_text('utf8'))['document']['entities'][0]['id'],'Z0')   # 디바운스 30초 → 아직 디스크에 없다(강제 종료면 사라질 편집)
                self.assertEqual(post('shutdown',{}),{'ok':True})
                self.assertEqual(json.loads(bridge.RECOVERY.read_text('utf8'))['document']['entities'][0]['id'],'Q0')
                thread.join(timeout=5);self.assertFalse(thread.is_alive())   # 스스로 닫혔다
            finally:
                try:httpd.server_close()
                except OSError:pass
    def test_large_drawing_recovery_round_trip_streams_without_json_string(self):
        big=doc('B',bridge.MAX_BRIDGE_ENTITIES+5)
        with tempfile.TemporaryDirectory() as folder, patch.object(bridge,'RECOVERY',Path(folder)/'recovery-9.json'), LiveServer() as live:
            body=b''.join(import_stream.iter_lines({'document':big,'report':{'client':'c','largeRecovery':True,'folder':'','commandSettings':{'a':1},'dirty':True}}))
            status,headers,result=live.post('recovery',body=body,content_type=import_stream.CONTENT_TYPE,timeout=120)
            self.assertEqual(status,200,result);self.assertTrue(result['stored']);self.assertTrue(bridge.large_recovery_file().is_file())
            status,headers,payload=live.post('restore',{},timeout=120)
            self.assertIn('x-ndjson',headers['Content-Type'])
            restored=import_stream.assemble(line for line in payload.split(b'\n') if line.strip())
            self.assertEqual(len(restored['document']['entities']),bridge.MAX_BRIDGE_ENTITIES+5);self.assertEqual(restored['report']['commandSettings'],{'a':1})
            # 잘린 요청은 저장하지 않는다
            status,headers,result=live.post('recovery',body=body[:len(body)//2],content_type=import_stream.CONTENT_TYPE,timeout=60)
            self.assertEqual(status,400);self.assertIn('불완전',result['error'])
            # 그 뒤 일반 복구본이 더 새로우면 JSON 으로 돌려준다
            time.sleep(0.05);bridge.write_recovery({'document':doc('S'),'dirty':True})
            status,headers,result=live.post('restore',{});self.assertEqual(result['document']['entities'][0]['id'],'S0')
    # (줄 단위 저장·경로 토큰 검사는 test_critic_e2.py 로 옮김)

class TabletDosTest(unittest.TestCase):
    def test_paired_session_survives_wrong_codes_from_others(self):
        import tablet,urllib.request
        info=tablet.local({'action':'start','owner':'owner-abcdefghijklmnop','address':'127.0.0.1'});base='http://127.0.0.1:'+str(tablet.SERVER.server_port)
        def post(path,data):
            request=urllib.request.Request(base+path,json.dumps(data).encode(),{'Content-Type':'application/json','Origin':base})
            try:
                with urllib.request.urlopen(request) as r:return r.status,json.load(r)
            except HTTPError as e:return e.code,json.load(e)
        try:
            status,paired=post('/pair',{'code':info['code']});self.assertEqual(status,200)
            for _ in range(tablet.ATTEMPTS_TOTAL+3):
                with tablet.LOCK:tablet.STATE['attempts']={}
                self.assertNotEqual(post('/pair',{'code':'000000' if info['code']!='000000' else '111111'})[0],200)
            self.assertIsNotNone(tablet.SERVER)                                            # 연결은 살아 있다
            self.assertEqual(post('/input',{'token':paired['token'],'seq':1,'events':[]})[0],200)
        finally:tablet.stop()

if __name__=='__main__':unittest.main()

class PreservationFingerprintTest(unittest.TestCase):
    def test_fingerprint_survives_javascript_number_roundtrip_so_unchanged_entities_are_preserved(self):
        import exchange
        entity={'id':'a','type':'line','layer':'0','points':[{'x':1.0,'y':2.5},{'x':-0.0,'y':3.0}],'sourceHandle':'1F'}
        entity['sourceFingerprint']=exchange.editable_fingerprint(entity)
        roundtrip=json.loads(json.dumps(entity).replace('1.0','1').replace('3.0','3').replace('-0.0','0'))   # JS JSON.stringify 가 돌려주는 표기
        self.assertEqual(exchange.editable_fingerprint(roundtrip),entity['sourceFingerprint'])
        changed=json.loads(json.dumps(entity));changed['points'][0]['x']=1.5
        self.assertNotEqual(exchange.editable_fingerprint(changed),entity['sourceFingerprint'])
        # 실제 DXF 왕복: JS 표기로 돌아온 문서도 원본 보존 계층이 '수정하지 않은 객체'로 인식한다
        with tempfile.TemporaryDirectory() as folder:
            source=Path(folder)/'s.dxf';d=ezdxf.new('R2018');d.units=4
            for i in range(20):d.modelspace().add_line((i,0),(i,1))
            d.saveas(source)
            imported=exchange.import_file_path(str(source),'.dxf')['document']
            js=json.loads(json.dumps(imported,ensure_ascii=False).replace('.0,',',').replace('.0}','}'))
            content,warnings=exchange.export_dxf(js,'R2018')
            self.assertTrue(any('수정하지 않은 객체 20개' in w for w in warnings),warnings)
