"""S5 · MCP 중계가 채널별 연결 파일 중 살아 있는 엔진을 고르는지 검사."""
import json,os,tempfile,time,unittest
from pathlib import Path
from unittest.mock import patch
import mcp_server

class McpConnectionTest(unittest.TestCase):
    def test_picks_live_instance_and_ignores_stale_files(self):
        with tempfile.TemporaryDirectory() as folder:
            base=Path(folder)/'BarunCAD';base.mkdir()
            (base/'connection.json').write_text(json.dumps({'url':'http://127.0.0.1:1','token':'legacy'}),encoding='utf8')
            (base/'connection-18765.json').write_text(json.dumps({'url':'http://127.0.0.1:18765','token':'dead'}),encoding='utf8')
            time.sleep(0.01)
            (base/'connection-18767.json').write_text(json.dumps({'url':'http://127.0.0.1:18767','token':'live'}),encoding='utf8')
            probe=lambda state:state['token']=='live'
            with patch.dict(os.environ,{'BARUN_CAD_INSTANCE':''}):
                self.assertEqual(mcp_server.find_connection(folder,probe=probe)['token'],'live')
                self.assertEqual(mcp_server.find_connection(folder,instance='18767',probe=probe)['token'],'live')
                with self.assertRaises(ValueError):mcp_server.find_connection(folder,instance='18765',probe=probe)
                with self.assertRaises(ValueError):mcp_server.find_connection(folder,probe=lambda state:False)

    def test_a_desktop_engine_is_recognised_by_its_pid_not_a_published_token(self):
        import threading
        from http.server import ThreadingHTTPServer
        import server
        httpd=ThreadingHTTPServer(('127.0.0.1',0),server.Handler)
        threading.Thread(target=httpd.serve_forever,daemon=True).start()
        url=f'http://127.0.0.1:{httpd.server_port}'
        try:
            with patch.object(server,'SHELL_SECRET','shell'):
                self.assertTrue(mcp_server._alive({'url':url,'token':server.TOKEN,'pid':os.getpid()}))
                self.assertFalse(mcp_server._alive({'url':url,'token':server.TOKEN,'pid':os.getpid()+1}))   # 다른 엔진이 남긴 파일
                self.assertFalse(mcp_server._alive({'url':url,'token':server.TOKEN}))
            with patch.object(server,'SHELL_SECRET',''):
                self.assertTrue(mcp_server._alive({'url':url,'token':server.TOKEN}))
                self.assertFalse(mcp_server._alive({'url':url,'token':'stale'}))
        finally:httpd.shutdown();httpd.server_close()

    def test_files_of_exited_engines_are_skipped_without_probing(self):
        # 꺼진 주소를 찌르면 Windows 가 하나에 2초씩 기다린다 — 프로세스가 없으면 묻지도 않는다.
        with tempfile.TemporaryDirectory() as folder:
            base=Path(folder)/'BarunCAD';base.mkdir()
            (base/'connection-18768.json').write_text(json.dumps({'url':'http://127.0.0.1:18768','token':'live','pid':os.getpid()}),encoding='utf8')
            time.sleep(0.01)
            (base/'connection-18765.json').write_text(json.dumps({'url':'http://127.0.0.1:18765','token':'dead','pid':2**31-7}),encoding='utf8')
            probed=[]
            def probe(state):probed.append(state['token']);return True
            with patch.dict(os.environ,{'BARUN_CAD_INSTANCE':''}):
                self.assertEqual(mcp_server.find_connection(folder,probe=probe)['token'],'live')
            self.assertEqual(probed,['live'])
        self.assertTrue(mcp_server._pid_running(os.getpid()));self.assertFalse(mcp_server._pid_running(2**31-7))

    def test_failure_says_which_of_three_problems_it_is(self):
        # 예전엔 앱이 켜져 있어도 "먼저 실행하세요" 하나였다. 꺼짐·접속 막힘·옛 연결 정보를 나눠 알린다.
        with tempfile.TemporaryDirectory() as folder:
            base=Path(folder)/'BarunCAD';base.mkdir()
            with patch.dict(os.environ,{'BARUN_CAD_INSTANCE':''}):
                with self.assertRaises(mcp_server.CADToolError) as caught:mcp_server.find_connection(folder)
                self.assertEqual(caught.exception.code,'cad_not_running')
                (base/'connection-18768.json').write_text(json.dumps({'url':'http://127.0.0.1:18768','token':'t','pid':os.getpid()}),encoding='utf8')
                for answer,code in (('unreachable','cad_unreachable'),(False,'stale_connection'),('mismatch','stale_connection'),('gone','cad_not_running')):
                    with self.assertRaises(mcp_server.CADToolError) as caught:mcp_server.find_connection(folder,probe=lambda state:answer)
                    self.assertEqual(caught.exception.code,code)
                    if code=='cad_unreachable':self.assertIn('127.0.0.1:18768',str(caught.exception))

    def test_a_closed_port_means_cad_is_off_not_blocked(self):
        # 10/22: CAD 를 끈 뒤 남은 연결 파일(프로세스 번호 재사용)로 "보안 차단 확인" 이라고 잘못 알렸다.
        import socket
        sock=socket.socket();sock.bind(('127.0.0.1',0));port=sock.getsockname()[1];sock.close()
        self.assertEqual(mcp_server._check({'url':f'http://127.0.0.1:{port}','token':'t'},timeout=1),'gone')
        with tempfile.TemporaryDirectory() as folder:
            base=Path(folder)/'BarunCAD';base.mkdir()
            (base/'connection-18768.json').write_text(json.dumps({'url':f'http://127.0.0.1:{port}','token':'t','pid':os.getpid()}),encoding='utf8')
            with patch.dict(os.environ,{'BARUN_CAD_INSTANCE':''}),self.assertRaises(mcp_server.CADToolError) as caught:
                mcp_server.find_connection(folder,running=lambda pid:True)
            self.assertEqual(caught.exception.code,'cad_not_running')

    def test_missing_localappdata_still_finds_the_windows_folder(self):
        with patch.dict(os.environ,{},clear=False):
            os.environ.pop('LOCALAPPDATA',None)
            expected=Path.home()/'AppData'/'Local'/'BarunCAD' if os.name=='nt' else Path.home()/'BarunCAD'
            self.assertEqual(mcp_server.connection_dir(),expected)

    @unittest.skipUnless(os.name=='nt','Windows 스토어 앱 전용')
    def test_store_app_stale_appdata_copy_does_not_hide_the_live_cad(self):
        # Codex(스토어 앱)는 AppData 읽기를 옛 사본으로 돌린다(10/21) → ~/.barun-cad 사본으로 지금 켜진 CAD 를 찾는다.
        with tempfile.TemporaryDirectory() as home,patch.object(mcp_server.Path,'home',return_value=Path(home)):
            local=Path(home)/'AppData'/'Local';appdata=local/'BarunCAD';mirror=Path(home)/'.barun-cad'
            appdata.mkdir(parents=True);mirror.mkdir()
            (appdata/'connection-18768.json').write_text(json.dumps({'url':'http://127.0.0.1:18768','token':'old','pid':1}),encoding='utf8')
            (mirror/'connection-18768.json').write_text(json.dumps({'url':'http://127.0.0.1:18768','token':'live','pid':2}),encoding='utf8')
            probe=lambda state:state['token']=='live'
            with patch.dict(os.environ,{'LOCALAPPDATA':str(local),'BARUN_CAD_INSTANCE':''}):
                self.assertEqual(mcp_server.connection_dirs(),[mirror,appdata])
                self.assertEqual(mcp_server.find_connection(probe=probe,running=lambda pid:True)['token'],'live')
                self.assertEqual(mcp_server.find_connection(instance='18768',probe=probe,running=lambda pid:True)['token'],'live')
            with patch.dict(os.environ,{'LOCALAPPDATA':str(Path(home)/'other')}):
                self.assertEqual(mcp_server.connection_dirs(),[Path(home)/'other'/'BarunCAD'])   # 시험·다른 위치는 사본 없음

    def test_korean_arguments_survive_a_cp949_console(self):
        # AI 클라이언트는 UTF-8 로 보낸다. 한국어 Windows 의 sys.stdin(cp949)으로 읽으면 '대연동'이 깨진다.
        import io,contextlib
        line=json.dumps({'jsonrpc':'2.0','id':1,'method':'tools/call','params':{'name':'cad_search_address','arguments':{'query':'대연동 1754-3'}}},ensure_ascii=False)+'\n'
        stdin=io.TextIOWrapper(io.BytesIO(line.encode('utf-8')),encoding='cp949',errors='replace')
        out=io.StringIO()
        with patch.object(mcp_server.sys,'stdin',stdin),patch.object(mcp_server,'call',side_effect=lambda name,args:args),contextlib.redirect_stdout(out):
            mcp_server.serve()
        result=json.loads(out.getvalue())['result']
        self.assertEqual(json.loads(result['content'][0]['text']),{'query':'대연동 1754-3'})

if __name__=='__main__':unittest.main()
