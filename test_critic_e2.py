"""검토자(Opus) 2차 지적 재현 · N1 저장 경로 보안 / N3 끊긴 본문 / N4 줄 단위 본문 제한 / 8·2 대용량 복구 세대·탐색 / 1 토큰 저장."""
import json,os,tempfile,time,unittest,http.client
from pathlib import Path
from unittest.mock import patch
from urllib.request import Request,urlopen
from urllib.error import HTTPError
import ezdxf
import import_stream,server,bridge
from test_critic_e import doc,LiveServer,reset_bridge

SECRET='shell-secret-for-test'

def register(live,path,fmt,secret=SECRET):
    headers={'Content-Type':'application/json','X-CAD-Token':server.TOKEN,'Origin':live.origin}
    if secret is not None:headers['X-CAD-Shell']=secret
    request=Request(live.origin+'/api/save-target',json.dumps({'path':path,'format':fmt}).encode(),headers)
    try:
        with urlopen(request,timeout=5) as response:return response.status,json.loads(response.read())
    except HTTPError as error:return error.code,json.loads(error.read())

class TokenSaveTest(unittest.TestCase):
    def test_ndjson_export_saves_through_one_time_target_token_and_accepts_oversized_single_entity(self):
        big=doc('X',200);big['entities'][0]['points']=[{'x':float(i),'y':float(i)} for i in range(50_000)]
        with tempfile.TemporaryDirectory() as folder, patch.object(import_stream,'SAFE_LINE_BYTES',200_000), patch.object(server,'SHELL_SECRET',SECRET), LiveServer() as live:
            target=Path(folder)/'out.dxf';target.write_bytes(b'old')
            status,registered=register(live,str(target),'dxf');self.assertEqual(status,200,registered);token=registered['saveToken']
            body=b''.join(import_stream.iter_lines({'document':big,'report':{'version':'R2018','saveToken':token}}))
            self.assertGreater(max(len(line) for line in body.split(bytes([10]))),200_000)   # 객체 하나가 SAFE 를 넘는다
            status,headers,result=live.post('export',body=body,content_type=import_stream.CONTENT_TYPE,timeout=120)
            self.assertEqual(status,200,result);self.assertEqual(result['path'],str(target));self.assertGreater(result['bytes'],1000)
            self.assertEqual(len(ezdxf.readfile(target).modelspace()),200);self.assertEqual(target.with_name('out.dxf.previous').read_bytes(),b'old')
            status,headers,result=live.post('export',body=body,content_type=import_stream.CONTENT_TYPE,timeout=120)   # 토큰은 일회용
            self.assertEqual(status,400);self.assertIn('만료',result['error'])
            status,registered=register(live,str(Path(folder)/'out.bcad'),'bcad');self.assertEqual(status,200)
            body2=b''.join(import_stream.iter_lines({'document':doc('Y',3),'report':{'format':'bcad','saveToken':registered['saveToken']}}))
            status,headers,result=live.post('export',body=body2,content_type=import_stream.CONTENT_TYPE);self.assertEqual(status,200,result)
            self.assertEqual(len(json.loads((Path(folder)/'out.bcad').read_text('utf8'))['entities']),3)
            status,registered=register(live,str(Path(folder)/'mismatch.dxf'),'dxf');self.assertEqual(status,200)
            body3=b''.join(import_stream.iter_lines({'document':doc('Y',3),'report':{'format':'bcad','saveToken':registered['saveToken']}}))
            status,headers,result=live.post('export',body=body3,content_type=import_stream.CONTENT_TYPE);self.assertEqual(status,400);self.assertIn('형식',result['error']);self.assertFalse((Path(folder)/'mismatch.dxf').exists())
            broken=body2[:len(body2)-40]+bytes([10])   # end 줄이 깨진 요청은 400
            status,headers,result=live.post('export',body=broken,content_type=import_stream.CONTENT_TYPE);self.assertEqual(status,400)
            # 토큰 없는 base64 응답 경로는 250 MB 까지만
            status,headers,result=live.post('export',{'document':doc('Z',2)});self.assertEqual(status,200);self.assertIn('data',result)

class SaveTargetSecurityTest(unittest.TestCase):
    """N1 (검토자 t9): 화면 코드는 경로를 직접 지정할 수 없고, 셸만 검사된 경로를 일회용 토큰으로 등록한다."""
    def test_targetpath_is_rejected_and_only_shell_can_register_validated_paths(self):
        d=doc('S')
        with tempfile.TemporaryDirectory() as folder, patch.object(server,'SHELL_SECRET',SECRET), LiveServer() as live:
            victim=Path(folder)/'important.dxf';victim.write_text('ORIGINAL','utf8')
            status,headers,result=live.post('export',{'document':d,'format':'bcad','targetPath':str(victim)})
            self.assertEqual(status,400);self.assertIn('직접 지정할 수 없습니다',result['error']);self.assertEqual(victim.read_text('utf8'),'ORIGINAL')
            self.assertEqual(register(live,str(victim),'dxf',secret=None)[0],403)      # 화면(토큰만 아는 쪽)은 등록 불가
            self.assertEqual(register(live,str(victim),'dxf',secret='wrong')[0],403)
            unc='\\\\'+'127.0.0.1\\c$\\x.dxf'
            bad=[unc,'relative.dxf',str(Path(folder)/'..'/'escaped.dxf'),str(Path(folder)/'a.dxf:stream'),str(Path(folder)/'con.dxf'),str(Path(folder)/'LPT1.tmp.dxf'),str(Path(folder)/'x.exe'),str(Path(folder)/'nope'/'x.dxf'),str(Path(folder)/'x.dxf')+chr(0),str(Path(folder)/'bad?.dxf')]
            for path in bad:
                status,result=register(live,path,'dxf');self.assertEqual(status,400,path);self.assertNotIn('saveToken',result)
            self.assertEqual(register(live,str(Path(folder)/'x.bcad'),'dxf')[0],400)   # 형식↔확장자
            status,registered=register(live,str(victim),'dxf');self.assertEqual(status,200)
            # 유효한 토큰이라도 등록된 형식(dxf)과 다른 bcad 로는 쓸 수 없다 → important.dxf 가 JSON 으로 덮이지 않는다
            status,headers,result=live.post('export',{'document':d,'format':'bcad','saveToken':registered['saveToken']});self.assertEqual(status,400);self.assertEqual(victim.read_text('utf8'),'ORIGINAL')
            self.assertFalse((Path(folder).parent/'escaped.dxf').exists())
            with patch.object(server,'SHELL_SECRET',''):
                self.assertEqual(register(live,str(victim),'dxf',secret='')[0],403)    # 셸이 띄우지 않은 엔진은 등록 자체가 불가
            self.assertEqual(server.validate_save_path(str(victim),'dxf'),victim)

    def test_truncated_bodies_get_a_prompt_korean_400_and_ndjson_is_limited_to_export_recovery(self):
        with patch.object(server,'BODY_READ_TIMEOUT',1.5), LiveServer() as live:
            t=time.perf_counter()
            c=http.client.HTTPConnection('127.0.0.1',live.httpd.server_port,timeout=30)
            c.putrequest('POST','/api/export');c.putheader('Content-Type','application/x-ndjson');c.putheader('X-CAD-Token',server.TOKEN);c.putheader('Origin',live.origin);c.putheader('Content-Length','1900000000');c.endheaders()
            c.send(b'{"kind":"header","version":1,"report":{},"document":{},"counts":{"entities":0,"blocks":0,"sharedBlocks":0},"preservation":false}'+bytes([10]))
            response=c.getresponse();payload=json.loads(response.read());elapsed=time.perf_counter()-t;c.close()
            self.assertEqual(response.status,400);self.assertIn('끊겼습니다',payload['error']);self.assertLess(elapsed,10)
            c=http.client.HTTPConnection('127.0.0.1',live.httpd.server_port,timeout=30)
            c.putrequest('POST','/api/restore');c.putheader('Content-Type','application/json');c.putheader('X-CAD-Token',server.TOKEN);c.putheader('Origin',live.origin);c.putheader('Content-Length','5000000');c.endheaders();c.send(b'{}')
            response=c.getresponse();payload=json.loads(response.read());c.close()
            self.assertEqual(response.status,400);self.assertIn('끊겼습니다',payload['error'])
            body=b''.join(import_stream.iter_lines({'document':doc('N',2),'report':{'action':'login'}}))
            status,headers,result=live.post('account',body=body,content_type=import_stream.CONTENT_TYPE);self.assertEqual(status,400);self.assertIn('줄 단위 본문을 받지 않습니다',result['error'])

class LargeRecoveryGenerationsTest(unittest.TestCase):
    def setUp(self):reset_bridge()
    def tearDown(self):reset_bridge()
    def test_large_generations_are_capped_probe_lists_newest_and_restore_prefers_newest(self):
        with tempfile.TemporaryDirectory() as folder, patch.object(bridge,'RECOVERY',Path(folder)/'recovery-7.json'), LiveServer() as live:
            for tag in ('G1','G2','G3'):
                body=b''.join(import_stream.iter_lines({'document':doc(tag,bridge.MAX_BRIDGE_ENTITIES+1),'report':{'client':'c','dirty':True}}))
                status,headers,result=live.post('recovery',body=body,content_type=import_stream.CONTENT_TYPE,timeout=120);self.assertEqual(status,200,result)
                time.sleep(1.05)
            files=bridge.large_recovery_files();self.assertEqual(len(files),bridge.LARGE_GENERATIONS)
            self.assertFalse(list(Path(folder).glob('*-large.ndjson.gz')));self.assertFalse(list(Path(folder).glob('*.bak')));self.assertFalse(list(Path(folder).glob('*.new*')))
            status,headers,result=live.post('restore',{'probe':True});self.assertEqual(status,200)
            self.assertEqual(result['sources'][0]['kind'],'large');self.assertTrue(result['sources'][0]['dirty']);self.assertEqual(len(result['sources']),2)
            status,headers,payload=live.post('restore',{},timeout=120)
            restored=import_stream.assemble(line for line in payload.split(bytes([10])) if line.strip());self.assertEqual(restored['document']['entities'][0]['id'],'G30')
            old=files[-1];os.utime(old,(time.time()-40*86400,time.time()-40*86400));bridge.prune_recovery_files();self.assertEqual(len(bridge.large_recovery_files()),1)
            bridge.write_recovery({'document':doc('J'),'dirty':True});time.sleep(0.05)
            status,headers,result=live.post('restore',{'probe':True});self.assertEqual(result['sources'][0]['kind'],'json');self.assertTrue(result['sources'][0]['dirty'])

if __name__=='__main__':unittest.main()
