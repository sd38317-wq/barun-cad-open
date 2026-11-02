"""바깥 AI 첫 연결 허락(ai_consent.py). 가짜 클라이언트는 진짜 다른 프로세스라 엔진이 실제로 프로그램을 찾아낸다."""
import json,os,subprocess,sys,tempfile,threading,time,unittest,http.client
from pathlib import Path
from unittest.mock import patch
from http.server import ThreadingHTTPServer
import ai_consent,bridge,mcp_server,server

WHO={'key':'sig:OpenAI OpCo, LLC|codex.exe','label':'Codex','program':'codex.exe','signer':'OpenAI OpCo, LLC','path':'C:/x/codex.exe','pid':4242,'remember':True}

# 가짜 AI 클라이언트: 연결 파일 토큰으로 허락을 청하고, 받은 열쇠로 /api/mcp 를 부른다.
FAKE_CLIENT='''
import json,sys,http.client
port,token,wait=int(sys.argv[1]),sys.argv[2],float(sys.argv[3])
def post(path,data,key):
    c=http.client.HTTPConnection('127.0.0.1',port,timeout=30)
    c.request('POST',path,json.dumps(data).encode(),{'Content-Type':'application/json','Origin':f'http://127.0.0.1:{port}','X-CAD-Token':key})
    r=c.getresponse();body=json.loads(r.read());c.close();return r.status,body
status,body=post('/api/mcp',{'name':'cad_get_document','arguments':{}},token)
out={'file_token_mcp':[status,body.get('code')]}
status,body=post('/api/mcp-hello',{'client':{'name':'fake-ai'},'wait':wait},token)
out['hello']=[status,body.get('code')]
if status==200:
    status,body=post('/api/mcp',{'name':'cad_get_document','arguments':{}},body['grant'])
    out['mcp']=[status,body]
print(json.dumps(out))
'''


class FlowTest(unittest.TestCase):
    """엔진 안 흐름: 허락·거절·취소·대기·도면 창 없음."""
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
        self.enterContext(patch.dict(os.environ,{'LOCALAPPDATA':self.tmp.name}))
        self.enterContext(patch.object(ai_consent,'_store_cache',None))
        self.enterContext(patch.dict(ai_consent._pending,clear=True));self.enterContext(patch.dict(ai_consent._grants,clear=True))

    def answer_when_asked(self,allow):
        def run():
            for _ in range(200):
                pending=ai_consent.pending_for_screen()
                if pending:ai_consent.decide(pending[0]['id'],allow);return
                time.sleep(0.02)
        thread=threading.Thread(target=run);thread.start();self.addCleanup(thread.join)

    def test_allow_is_remembered_and_revoke_asks_again(self):
        self.answer_when_asked(True)
        grant=ai_consent.hello(WHO,{'name':'codex-mcp-client'},wait=5)['grant']
        self.assertEqual(ai_consent.check_grant(grant)['key'],WHO['key'])
        self.assertIsNone(ai_consent.check_grant('made-up'))
        # 다음 중계(같은 서명·이름, 업데이트로 경로만 바뀜)는 묻지 않는다.
        again=ai_consent.hello({**WHO,'path':'C:/y/codex.exe','pid':5555},wait=0)
        self.assertIn('grant',again);self.assertEqual(ai_consent.pending_for_screen(),[])
        # 저장은 DPAPI 로 잠가 평문이 아니다(Windows).
        raw=ai_consent.store_path().read_bytes()
        if os.name=='nt':self.assertNotIn(b'codex',raw.lower())
        ai_consent._store_cache=None
        self.assertEqual(ai_consent.entries()[0]['decision'],'allow')
        ai_consent.revoke(WHO['key'])
        with self.assertRaises(ai_consent.ConsentError) as caught:ai_consent.hello(WHO,wait=0)
        self.assertEqual(caught.exception.code,'consent_required')
        self.assertEqual(len(ai_consent.pending_for_screen()),1)
        with self.assertRaises(ai_consent.ConsentError) as caught:ai_consent.check_grant(grant)
        self.assertEqual(caught.exception.code,'consent_revoked','취소한 열쇠는 consent_revoked 로 알려 중계가 다시 묻게 한다')

    def test_deny_is_remembered(self):
        self.answer_when_asked(False)
        with self.assertRaises(ai_consent.ConsentError) as caught:ai_consent.hello(WHO,wait=5)
        self.assertEqual(caught.exception.code,'consent_denied')
        with self.assertRaises(ai_consent.ConsentError) as caught:ai_consent.hello(WHO,wait=0)
        self.assertEqual(caught.exception.code,'consent_denied')
        self.assertEqual(ai_consent.pending_for_screen(),[])

    def test_tampered_store_asks_again(self):
        path=ai_consent.store_path();path.parent.mkdir(parents=True,exist_ok=True)
        path.write_text(json.dumps({WHO['key']:{'decision':'allow'}}),encoding='utf8')   # 다른 프로그램이 평문으로 끼워 넣음
        if os.name=='nt':
            with self.assertRaises(ai_consent.ConsentError):ai_consent.hello(WHO,wait=0)

    def test_waiting_and_no_screen(self):
        with self.assertRaises(ai_consent.ConsentError) as caught:ai_consent.hello(WHO,wait=0.1)
        self.assertEqual(caught.exception.code,'consent_required');self.assertIn('[허락]',str(caught.exception))
        with self.assertRaises(ai_consent.ConsentError) as caught:ai_consent.hello(WHO,wait=5,has_screen=lambda:False)
        self.assertFalse(caught.exception.details['screen']);self.assertIn('도면 창',str(caught.exception))
        self.assertEqual(len(ai_consent.pending_for_screen()),1,'같은 프로그램 요청은 하나로 묶는다')

    def test_late_answer_for_generic_program_is_kept_for_its_retry(self):
        generic={**WHO,'key':None,'label':'python','program':'python.exe','remember':False}
        with self.assertRaises(ai_consent.ConsentError):ai_consent.hello(generic,wait=0)   # 기다림이 먼저 끝남
        ai_consent.decide(ai_consent.pending_for_screen()[0]['id'],True)                   # 그 뒤에 [허락]
        self.assertIn('grant',ai_consent.hello(generic,wait=0),'같은 프로세스가 다시 시도하면 그 답을 쓴다')
        with self.assertRaises(ai_consent.ConsentError):ai_consent.hello(generic,wait=0)   # 한 번만
        other={**generic,'pid':9999}
        ai_consent.decide(ai_consent.pending_for_screen()[0]['id'],True)
        with self.assertRaises(ai_consent.ConsentError):ai_consent.hello(other,wait=0)     # 다른 프로세스는 못 가져간다

    def test_unknown_or_generic_program_is_not_remembered(self):
        generic={**WHO,'key':None,'label':'python','program':'python.exe','remember':False}
        self.answer_when_asked(True)
        self.assertIn('grant',ai_consent.hello(generic,wait=5))
        self.assertEqual(ai_consent.entries(),[])
        with self.assertRaises(ai_consent.ConsentError):ai_consent.hello(generic,wait=0)

    def test_adhoc_signed_program_has_no_signer(self):
        # 2026-10-26: 임시 서명(Signature=adhoc, Authority 줄 없음) 프로그램이 붙으면 IndexError 로 mcp-hello 가 400 이었다
        runs=[subprocess.CompletedProcess([],0,'',''),subprocess.CompletedProcess([],0,'','Executable=/x/python3\nSignature=adhoc\n')]
        with patch.object(ai_consent.sys,'platform','darwin'),patch.object(ai_consent.subprocess,'run',side_effect=runs):
            self.assertIsNone(ai_consent.signer_of('/x/python3'))

    def test_identify_uses_parent_of_our_relay(self):
        relay='C:/Barun/barun-cad-6-server.exe'
        infos={10:{'pid':10,'path':relay,'created':200,'parent':20},20:{'pid':20,'path':'C:/OpenAI/codex.exe','created':100,'parent':1}}
        with patch.object(ai_consent,'_win_caller_pid' if os.name=='nt' else '_posix_caller_pid',return_value=10),\
             patch.object(ai_consent,'process_info',side_effect=lambda pid:infos[pid]),\
             patch.object(ai_consent,'_same_file',side_effect=lambda a,b:a==b),\
             patch.object(ai_consent,'signer_of',return_value='OpenAI OpCo, LLC'):
            who=ai_consent.identify(1,2,relay_exe=relay)
            self.assertEqual((who['key'],who['label']),('sig:OpenAI OpCo, LLC|codex.exe','Codex'))
            infos[20]['created']=300   # 부모 번호가 나중에 만든 다른 프로그램에 다시 쓰였다 → 중계 자신을 본다
            self.assertEqual(ai_consent.identify(1,2,relay_exe=relay)['program'],'barun-cad-6-server.exe')

    def test_identify_looks_past_timeout_wrapper(self):
        # 10/22 backend.log: 'timeout' 으로 감싼 중계 → 허락 창에 "timeout이(가) 이 CAD를 쓰려고 합니다"
        relay='C:/Barun/barun-cad-6-server.exe'
        infos={10:{'pid':10,'path':relay,'created':300,'parent':20},20:{'pid':20,'path':'C:/Git/usr/bin/timeout.exe','created':200,'parent':30},
               30:{'pid':30,'path':'C:/Anthropic/claude.exe','created':100,'parent':1}}
        with patch.object(ai_consent,'_win_caller_pid' if os.name=='nt' else '_posix_caller_pid',return_value=10),             patch.object(ai_consent,'process_info',side_effect=lambda pid:infos[pid]),             patch.object(ai_consent,'_same_file',side_effect=lambda a,b:a==b),             patch.object(ai_consent,'signer_of',side_effect=lambda path:'Anthropic, PBC' if 'claude' in path else None):
            self.assertEqual(ai_consent.identify(1,2,relay_exe=relay)['label'],'Claude')
            infos[30]['created']=400   # 감싼 프로그램 위 번호가 재사용됐으면 올라가지 않고, timeout 은 기억하지도 않는다
            who=ai_consent.identify(1,2,relay_exe=relay)
            self.assertEqual((who['program'],who['remember']),('timeout.exe',False))

    def test_screen_actions(self):
        with self.assertRaises(ValueError):ai_consent.process({'action':'decide','id':'none','allow':True})
        with self.assertRaises(ValueError):ai_consent.process({'action':'revoke','key':'none'})
        with self.assertRaises(ValueError):ai_consent.process({'action':'grant'})
        self.assertEqual(ai_consent.process({'action':'list'}),{'entries':[]})


@unittest.skipUnless(os.name=='nt','엔진이 다른 프로세스를 찾는 길은 Windows 에서 시험한다')
class EngineHTTPTest(unittest.TestCase):
    """진짜 엔진 Handler + 다른 프로세스 가짜 AI: 연결 파일 토큰만으로는 못 쓰고, 화면에서 허락해야 쓴다."""
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
        self.enterContext(patch.dict(os.environ,{'LOCALAPPDATA':self.tmp.name}))
        self.enterContext(patch.object(ai_consent,'_store_cache',None))
        self.enterContext(patch.dict(ai_consent._pending,clear=True));self.enterContext(patch.dict(ai_consent._grants,clear=True))
        self.enterContext(patch.object(ai_consent,'GENERIC_HOSTS',frozenset()))   # 시험용 가짜 AI 가 python 이라 기억하게 한다
        self.enterContext(patch.object(bridge,'has_screen',return_value=True))
        self.enterContext(patch.object(bridge,'call',return_value={'ok':True,'document':'fixture'}))
        self.httpd=ThreadingHTTPServer(('127.0.0.1',0),server.Handler)
        self.addCleanup(self.httpd.server_close);self.addCleanup(self.httpd.shutdown)
        threading.Thread(target=self.httpd.serve_forever,daemon=True).start()
        self.port=self.httpd.server_port

    def post(self,path,data,token):
        c=http.client.HTTPConnection('127.0.0.1',self.port,timeout=10)
        try:
            c.request('POST',path,json.dumps(data).encode(),{'Content-Type':'application/json','Origin':f'http://127.0.0.1:{self.port}','X-CAD-Token':token,'Connection':'close'})
            r=c.getresponse();return r.status,json.loads(r.read())
        finally:c.close()

    def fake_ai(self,wait,answer=None):
        process=subprocess.Popen([sys.executable,'-c',FAKE_CLIENT,str(self.port),server.MCP_TOKEN,str(wait)],stdout=subprocess.PIPE,text=True)
        if answer is not None:
            for _ in range(300):
                pending=ai_consent.pending_for_screen()
                if pending:break
                time.sleep(0.02)
            else:process.kill();self.fail('허락 창 요청이 오지 않았다')
            self.assertIn('python',pending[0]['program'].lower(),'엔진이 요청한 프로세스를 직접 찾았다')
            self.assertEqual(pending[0]['client'],'fake-ai')
            status,_=self.post('/api/ai-consent',{'action':'decide','id':pending[0]['id'],'allow':answer},server.MCP_TOKEN)
            self.assertEqual(status,403,'연결 파일 토큰으로는 스스로 허락할 수 없다')
            self.assertEqual(self.post('/api/ai-consent',{'action':'decide','id':pending[0]['id'],'allow':answer},server.TOKEN)[0],200)
        out,_=process.communicate(timeout=60)
        return json.loads(out)

    def test_file_token_alone_cannot_edit_then_allow_deny_revoke(self):
        out=self.fake_ai(10,answer=True)
        self.assertEqual(out['file_token_mcp'],[403,'consent_required'],'연결 파일 토큰만으로는 /api/mcp 를 못 쓴다')
        self.assertEqual(out['hello'],[200,None]);self.assertEqual(out['mcp'],[200,{'ok':True,'document':'fixture'}])
        # 허락한 프로그램은 다음 연결 때 묻지 않는다.
        self.assertEqual(self.fake_ai(0)['mcp'][0],200)
        status,listed=self.post('/api/ai-consent',{'action':'list'},server.TOKEN)
        self.assertEqual(status,200);key=listed['entries'][0]['key']
        self.assertEqual(self.post('/api/ai-consent',{'action':'list'},server.MCP_TOKEN)[0],403)
        # 취소 → 다시 묻는다 → 이번엔 거절 → 그 뒤로는 바로 거절.
        ai_consent._grants['kept-grant']={'key':key,'pid':1,'label':'python'}
        self.assertEqual(self.post('/api/ai-consent',{'action':'revoke','key':key},server.TOKEN)[0],200)
        status,body=self.post('/api/mcp',{'name':'cad_get_document'},'kept-grant')
        self.assertEqual((status,body.get('code')),(403,'consent_revoked'),'취소 뒤 쓰던 열쇠 → 중계가 다시 묻는 코드')
        out=self.fake_ai(10,answer=False)
        self.assertEqual(out['hello'],[403,'consent_denied']);self.assertNotIn('mcp',out)
        self.assertEqual(self.fake_ai(0)['hello'],[403,'consent_denied'])
        bridge.call.assert_called()
        self.assertEqual(bridge.call.call_count,2,'허락받은 두 번만 CAD 도구가 돌았다')

    def test_grant_opens_only_mcp(self):
        ai_consent._grants['grant-for-test']={'key':'session:1','pid':1,'label':'x'}
        for path in ('/api/bridge','/api/chat','/api/lisp','/api/ai-consent','/api/mcp-hello'):
            self.assertEqual(self.post(path,{'action':'list'},'grant-for-test')[0],403,path)
        self.assertEqual(self.post('/api/mcp',{'name':'cad_get_document'},'grant-for-test')[0],200)


class RelayTest(unittest.TestCase):
    """중계(mcp_server): 열쇠는 엔진마다 한 번 받고, 취소되면 한 번만 다시 받는다."""
    def setUp(self):
        self.enterContext(patch.dict(mcp_server._grants,clear=True))

    def test_relay_pairs_once_and_retries_after_revoke(self):
        import io,urllib.error
        state={'url':'http://127.0.0.1:9','token':'file-token','pid':77}
        seen=[]
        class Response(io.BytesIO):
            def __enter__(self):return self
            def __exit__(self,*_):self.close()
        revoked=[True]
        def transport(request,timeout=None):
            token=request.headers.get('X-cad-token');seen.append((request.full_url.rsplit('/',1)[1],token))
            if request.full_url.endswith('/api/mcp-hello'):return Response(json.dumps({'grant':f'g{len(seen)}'}).encode())
            if token=='g1' and revoked[0]:
                revoked[0]=False
                body=json.dumps({'error':ai_consent.REVOKED,'code':'consent_revoked','details':{'code':'consent_revoked'}}).encode()
                raise urllib.error.HTTPError(request.full_url,403,'',{},io.BytesIO(body))
            return Response(json.dumps({'ok':True}).encode())
        with patch('urllib.request.urlopen',side_effect=transport):
            self.assertEqual(mcp_server._post(state,'cad_get_document',{}),{'ok':True})
            self.assertEqual(mcp_server._post(state,'cad_get_document',{}),{'ok':True})
        self.assertEqual(seen,[('mcp-hello','file-token'),('mcp','g1'),('mcp-hello','file-token'),('mcp','g3'),('mcp','g3')])

    def test_relay_reports_consent_code(self):
        import io,urllib.error
        body=json.dumps({'error':'허락 창','code':'consent_required','details':{'code':'consent_required'}}).encode()
        with patch('urllib.request.urlopen',side_effect=urllib.error.HTTPError('http://x/api/mcp-hello',403,'',{},io.BytesIO(body))):
            with self.assertRaises(bridge.CADToolError) as caught:mcp_server._post({'url':'http://x','token':'t','pid':1},'cad_get_document',{})
        self.assertEqual(caught.exception.code,'consent_required')


if __name__=='__main__':unittest.main()


class RelayCopyConsent(unittest.TestCase):
    def test_relay_copy_outside_install_folder_is_seen_as_our_relay(self):
        import mcp_register
        relay=str(mcp_register.RELAY_ROOT/'abc'/'barun-cad-mcp.exe')
        infos={10:{'pid':10,'path':relay,'created':200,'parent':20},20:{'pid':20,'path':'C:/OpenAI/codex.exe','created':100,'parent':1}}
        with patch.object(ai_consent,'_win_caller_pid' if os.name=='nt' else '_posix_caller_pid',return_value=10),\
             patch.object(ai_consent,'process_info',side_effect=lambda pid:infos[pid]),\
             patch.object(ai_consent,'signer_of',return_value='OpenAI OpCo, LLC'):
            self.assertEqual(ai_consent.identify(1,2)['label'],'Codex')


class UnknownCallerLabel(unittest.TestCase):
    # 2026-10-27 사장님: 허락 창의 "알 수 없는 프로그램"은 말이 안 된다 → 실행 파일을 못 찾은 연결은 "AI 프로그램".
    def test_caller_without_process_or_path_is_called_ai_program(self):
        finder='_win_caller_pid' if os.name=='nt' else '_posix_caller_pid'
        with patch.object(ai_consent,finder,return_value=None):
            self.assertEqual(ai_consent.identify(1,2)['label'],'AI 프로그램')
        with patch.object(ai_consent,finder,return_value=10),patch.object(ai_consent,'process_info',return_value={'pid':10,'path':None,'created':None,'parent':None}):
            self.assertEqual(ai_consent.identify(1,2)['label'],'AI 프로그램')
