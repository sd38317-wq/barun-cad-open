"""실제 설치 Codex의 추론 도구 목록 검사. localhost 모의 서버만 쓰며 실제 모델 호출 없음."""
import gzip,json,os,queue,subprocess,tempfile,threading,unittest
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
from pathlib import Path
from unittest.mock import patch
import codex_chat

class ToolSurfaceTests(unittest.TestCase):
    def test_cad_only_config_keeps_code_mode_host_and_blocks_shell_exec_plugins(self):
        # Codex 0.162+ 최신 모델은 cad_* 를 exec 의 tools.cad_*() 로만 부른다. 실행기를 끄면 도구가 전부 막힌다(2026-10-19).
        config=codex_chat.CAD_ONLY_CONFIG
        self.assertIs(config['features.code_mode_host'],True)
        for name in ('shell_tool','unified_exec','unified_exec_tty','code_mode','code_mode_only','apps','plugins','remote_plugin','computer_use','browser_use','browser_use_external','in_app_browser','multi_agent','hooks'):
            self.assertIs(config['features.'+name],False,name)
        self.assertEqual(config['web_search'],'disabled')

    def test_real_payload_has_only_cad_and_nonexecuting_question_tool(self):
        try:exe=codex_chat.executable()
        except ValueError as error:self.skipTest(str(error))
        captured=queue.Queue()
        class Stub(BaseHTTPRequestHandler):
            def log_message(self,*args):pass
            def do_POST(self):
                raw=self.rfile.read(int(self.headers['Content-Length']))
                if self.headers.get('Content-Encoding')=='gzip':raw=gzip.decompress(raw)
                captured.put(json.loads(raw))
                self.send_response(200);self.send_header('Content-Type','text/event-stream');self.end_headers()
                event={'type':'response.completed','response':{'id':'r_test','object':'response','status':'completed','output':[],'usage':{'input_tokens':1,'output_tokens':0,'total_tokens':1}}}
                self.wfile.write(('data: '+json.dumps(event)+'\n\n').encode())
        server=ThreadingHTTPServer(('127.0.0.1',0),Stub)
        threading.Thread(target=server.serve_forever,daemon=True).start()
        temporary_root=codex_chat.ROOT/'tmp'/'codex-tool-surface';temporary_root.mkdir(parents=True,exist_ok=True)
        try:
            with tempfile.TemporaryDirectory(dir=temporary_root) as temp,tempfile.TemporaryDirectory() as workspace:
                # 제품과 같은 설정 경로: CODEX_HOME 의 MCP 서버(최상위·프로필)를 cad_config() 가 끄고, 대화는 빈 작업 폴더에서 연다.
                # 옛 프로필 표(Codex 0.162 는 무시)와 최상위 서버. 프로세스에는 기능 차단만, 대화에는 cad_config(설정 파일 + Codex 가 아는 이름).
                Path(temp,'config.toml').write_text('[mcp_servers.cadtest_mcp]\ncommand="barun-cad-nonexistent-mcp"\n[profiles.p.mcp_servers.cadtest_profile]\ncommand="barun-cad-nonexistent-mcp"\n',encoding='utf8')
                opts={'model':'cad-review','model_provider':'cadtest','model_providers.cadtest.name':'CAD test','model_providers.cadtest.base_url':f'http://127.0.0.1:{server.server_port}/v1','model_providers.cadtest.wire_api':'responses','model_providers.cadtest.requires_openai_auth':False,**codex_chat.CAD_ONLY_CONFIG}
                argv=[exe,'app-server','--stdio']
                for key,value in opts.items():argv.extend(['-c',key+'='+json.dumps(value)])
                process=subprocess.Popen(argv,cwd=workspace,env={**os.environ,'CODEX_HOME':temp},stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,text=True,encoding='utf8',creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
                messages=queue.Queue()
                def read():
                    for line in process.stdout:
                        try:messages.put(json.loads(line))
                        except ValueError:pass
                reader=threading.Thread(target=read,daemon=True);reader.start()
                counter=0
                def rpc(method,params):
                    nonlocal counter
                    counter+=1;process.stdin.write(json.dumps({'id':counter,'method':method,'params':params})+'\n');process.stdin.flush()
                    while True:
                        message=messages.get(timeout=15)
                        if message.get('id')==counter:
                            if 'error' in message:raise AssertionError(message['error'])
                            return message['result']
                try:
                    rpc('initialize',{'clientInfo':{'name':'cad_test','version':'1'},'capabilities':{'experimentalApi':True}})
                    process.stdin.write('{"method":"initialized","params":{}}\n');process.stdin.flush()
                    tools=codex_chat.bridge.app_tools(True)
                    known=[s['name'] for s in rpc('mcpServerStatus/list',{})['data']]   # 대화 없이: Codex 가 아는 이름(서버는 안 띄움)
                    self.assertIn('cadtest_mcp',known)
                    with patch.dict(os.environ,{'CODEX_HOME':temp}):config=codex_chat.cad_config(names=known)
                    self.assertIs(config['mcp_servers.cadtest_mcp.enabled'],False);self.assertIs(config['profiles.p.mcp_servers.cadtest_profile.enabled'],False)
                    started=rpc('thread/start',{'cwd':workspace,'sandbox':'read-only','approvalPolicy':'never','ephemeral':True,'config':config,'dynamicTools':[{'type':'function',**tool} for tool in tools]})
                    statuses=rpc('mcpServerStatus/list',{'threadId':started['thread']['id']})['data']
                    self.assertIn('cadtest_mcp',[s['name'] for s in statuses])
                    self.assertEqual([s['name'] for s in statuses if s.get('runtimeStatus')!='disabled'],[],statuses)
                    rpc('turn/start',{'threadId':started['thread']['id'],'input':[{'type':'text','text':'Reply hello. Use no tools.'}],'environments':[]})
                    payload=captured.get(timeout=15)
                    names={tool.get('name',tool.get('type')) for tool in payload['tools']}
                    self.assertFalse([n for n in names if str(n).startswith('mcp__')],names)
                    self.assertEqual(payload['model'],'cad-review')
                    expected={tool['name'] for tool in tools}
                    self.assertTrue(expected<=names)
                    self.assertLessEqual(names-expected,{'request_user_input'})
                finally:
                    process.terminate()
                    try:process.wait(timeout=10)
                    except subprocess.TimeoutExpired:process.kill();process.wait(timeout=5)
                    reader.join(3);process.stdin.close();process.stdout.close()
        finally:server.shutdown();server.server_close()

if __name__=='__main__':unittest.main()
