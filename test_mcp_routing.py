"""No real CAD process: routing and image transports use temporary connection files."""
import copy,io,json,os,tempfile,time,unittest,uuid
from pathlib import Path
from unittest.mock import patch
import bridge,mcp_server

class Response(io.BytesIO):
    def __init__(self,value):super().__init__(json.dumps(value).encode())
    def __enter__(self):return self
    def __exit__(self,*_):self.close()

class RoutingTest(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
        self.enterContext(patch.dict(os.environ,{'LOCALAPPDATA':self.tmp.name,'BARUN_CAD_INSTANCE':''}))
        self.enterContext(patch.object(mcp_server,'_alive',return_value=True))
        self.enterContext(patch.object(mcp_server,'_pid_running',return_value=True))
        self.enterContext(patch.object(mcp_server,'_connection',None))
        self.enterContext(patch.object(mcp_server,'_grant',return_value='test-grant'))   # 허락 열쇠는 test_ai_consent 가 본다
        self.a,self.b=str(uuid.uuid4()),str(uuid.uuid4());self.sa,self.sb=str(uuid.uuid4()),str(uuid.uuid4())
        self.write(1,self.a,self.sa,focused=True,activated=20,name='active drawing')
        self.write(2,self.b,self.sb,focused=False,activated=10,name='empty drawing')

    def write(self,port,generation,session,focused,activated,name):
        folder=Path(self.tmp.name)/'BarunCAD';folder.mkdir(exist_ok=True)
        state={'url':f'http://127.0.0.1:{port}','port':port,'token':'test-only','pid':123,'backend_generation':generation,
               'focused':focused,'lastActivated':activated,'seenAt':time.time(),'windows':[{'editor_session':session,'drawingName':name,'drawingPath':f'C:/{name}.dxf','focused':focused,'lastActivated':activated,'seenAt':time.time()}]}
        (folder/f'connection-{port}.json').write_text(json.dumps(state),encoding='utf8')
        return state

    def test_active_window_wins_over_newer_file_and_every_call_reselects(self):
        requested=[]
        def transport(request,**_):requested.append(request.full_url);return Response({'ok':True})
        with patch('urllib.request.urlopen',side_effect=transport):
            self.assertTrue(mcp_server.call('cad_list_commands',{})['ok'])
            self.write(1,self.a,self.sa,False,20,'active drawing');self.write(2,self.b,self.sb,True,30,'other drawing')
            mcp_server.call('cad_list_commands',{})
        self.assertEqual(requested,['http://127.0.0.1:1/api/mcp','http://127.0.0.1:2/api/mcp'])

    def test_bound_target_and_top_level_session_use_windows_and_never_fall_back(self):
        self.assertEqual(mcp_server.find_connection(target={'backend_generation':self.b,'editor_session':self.sb})['port'],2)
        self.assertEqual(mcp_server.find_connection(target={'editor_session':self.sb})['port'],2)
        with patch('urllib.request.urlopen',return_value=Response({'target':{'editor_session':self.sb}})) as transport:
            mcp_server.call('cad_get_document',{'editor_session':self.sb})
        self.assertEqual(transport.call_args.args[0].full_url,'http://127.0.0.1:2/api/mcp')
        with self.assertRaises(bridge.CADToolError):mcp_server.find_connection(target={'backend_generation':self.a,'editor_session':self.sb})
        with self.assertRaises(bridge.CADToolError):mcp_server.find_connection(target={'backend_generation':str(uuid.uuid4())})

    def test_job_pins_original_backend_even_when_other_window_is_focused(self):
        job=self.b+':'+str(uuid.uuid4())
        with patch('urllib.request.urlopen',return_value=Response({'status':'running','job_id':job})) as transport:
            out=mcp_server.call('cad_get_job',{'job_id':job,'wait_seconds':0})
        self.assertEqual(transport.call_args.args[0].full_url,'http://127.0.0.1:2/api/mcp');self.assertEqual(out['destination']['backend_generation'],self.b)

    def test_job_of_restarted_engine_is_unavailable_not_endless_reconnecting(self):
        # 기록: 엔진이 다시 켜진 뒤 cad_get_job 이 'reconnecting' 만 되풀이(10/16~22)
        gone=str(uuid.uuid4())+':'+str(uuid.uuid4())
        with patch('urllib.request.urlopen') as transport,self.assertRaises(bridge.CADToolError) as caught:
            mcp_server.call('cad_get_job',{'job_id':gone,'wait_seconds':0})
        transport.assert_not_called();self.assertEqual(caught.exception.code,'job_unavailable')

    def test_read_tool_waits_out_short_reconnect_but_edit_does_not(self):
        calls=[]
        def transport(_):
            calls.append(1)
            if len(calls)==1:raise bridge.CADToolError('다시 연결 중',{'code':'reconnecting'})
            return {'ok':True}
        with patch.object(mcp_server,'_post',side_effect=lambda state,name,args:transport(None)),patch.object(mcp_server,'RECONNECT_WAIT',0):
            self.assertTrue(mcp_server.call('cad_view_drawing',{'editor_session':self.sa})['ok'])
            calls.clear()
            with self.assertRaises(bridge.CADToolError):mcp_server.call('cad_execute',{'editor_session':self.sa})
        self.assertEqual(len(calls),1)

    def test_explicit_instance_is_respected(self):
        self.assertEqual(mcp_server.find_connection(instance='2')['port'],2)
        with self.assertRaises(bridge.CADToolError):mcp_server.find_connection(instance='1',target={'backend_generation':self.b})

    def test_document_merges_windows_by_session_without_losing_selection_help(self):
        local={'editor_session':self.sa,'backend_generation':self.a,'drawingName':'fresh name','focused':True}
        with patch('urllib.request.urlopen',return_value=Response({'windows':[local],'destination':{'editor_session':self.sa,'drawingName':'fresh name'}})):
            out=mcp_server.call('cad_get_document',{})
        self.assertEqual(len(out['windows']),2);self.assertEqual({w['editor_session'] for w in out['windows']},{self.sa,self.sb})
        self.assertEqual(next(w for w in out['windows'] if w['editor_session']==self.sa)['drawingName'],'fresh name')
        self.assertIn('BARUN_CAD_INSTANCE',out['selection_help']);self.assertEqual(out['destination']['engine_url'],'http://127.0.0.1:1')
        self.assertNotIn('token',json.dumps(out))

    def test_completed_image_is_a_mcp_image_and_cached_result_is_unchanged(self):
        out={'status':'completed','job_id':self.a+':'+str(uuid.uuid4()),'result':{'image':{'mimeType':'image/png','data':'png-fixture'},'width':900}}
        original=copy.deepcopy(out);stdin=io.StringIO(json.dumps({'id':1,'method':'tools/call','params':{'name':'cad_get_job','arguments':{'job_id':out['job_id']}}})+'\n');stdout=io.StringIO()
        with patch.object(mcp_server,'call',return_value=out),patch('sys.stdin',stdin),patch('sys.stdout',stdout):mcp_server.serve()
        content=json.loads(stdout.getvalue())['result']['content']
        self.assertEqual(content[1],{'type':'image','mimeType':'image/png','data':'png-fixture'})
        self.assertNotIn('png-fixture',content[0]['text']);self.assertEqual(out,original)

if __name__=='__main__':unittest.main()
