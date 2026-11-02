"""MCP 리습 스키마·권한·전송 계약. 실제 계정과 외부 서비스는 사용하지 않는다."""
import io,json,threading,unittest,urllib.error
from unittest.mock import patch
import bridge,mcp_server
from test_mcp_3d import Mcp3DTest

@patch('miri_account_service.require_ai_login',new=lambda:None)
class McpLispTest(unittest.TestCase):
    setUp=Mcp3DTest.setUp
    clear_state=Mcp3DTest.clear_state

    def test_tools_bound_and_mutating(self):
        for name,required in [('cad_lisp_run','command'),('cad_lisp_load','source')]:
            tool=next(t for t in bridge.TOOLS if t['name']==name)
            self.assertIn(name,bridge.MUTATING_TOOLS)
            self.assertIn('target',tool['inputSchema']['required'])
            self.assertIn('expectedRevision',tool['inputSchema']['required'])
            self.assertIn(required,tool['inputSchema']['required'])
            self.assertEqual(tool['inputSchema']['properties']['timeout_ms']['maximum'],10000)

    def test_review_mode_refuses_load_and_run(self):
        for name in ('cad_lisp_load','cad_lisp_run'):
            with self.assertRaisesRegex(ValueError,'대화/검토'),patch.object(bridge,'dispatch') as dispatch:
                bridge.call(name,{'target':self.target},allow_edit=False)
            dispatch.assert_not_called()

    def test_invalid_inputs_rejected_before_dispatch(self):
        base={'target':self.target,'expectedRevision':0,'command':'BRX'}
        for changes in [{'expectedRevision':True},{'expectedRevision':1},{'command':'(BRX)'},{'inputs':[True]},{'inputs':[[1,float('nan')]]},{'inputs':[{}]},{'selection':'id'},{'timeout_ms':0},{'timeout_ms':10001}]:
            with self.subTest(changes=changes),patch.object(bridge,'dispatch') as dispatch,self.assertRaises(ValueError):
                bridge.call('cad_lisp_run',{**base,**changes})
            dispatch.assert_not_called()
        for source in ['',None,'한'*70000]:
            with self.subTest(source=type(source)),patch.object(bridge,'dispatch') as dispatch,self.assertRaises(ValueError):
                bridge.call('cad_lisp_load',{**base,'source':source})
            dispatch.assert_not_called()

    def test_ordered_inputs_and_selection_forwarded_unchanged(self):
        args={'target':self.target,'expectedRevision':0,'command':'BCIRCLE','inputs':[[100,200],50],'selection':[],'timeout_ms':1000}
        with patch.object(bridge,'dispatch',return_value={'created':1}) as dispatch:
            self.assertEqual(bridge.call('cad_lisp_run',args)['created'],1)
        dispatch.assert_called_once_with('cad_lisp_run',args)

    def test_dispatch_keeps_error_output_revisions_and_input_question(self):
        args={'target':self.target,'expectedRevision':0,'command':'BRX'}
        details={'code':'input_required','output':'before','ask':{'what':'point'},'created':0,'before_revision':0,'after_revision':0,'revision':0,'applied':False}
        errors=[]
        def caller():
            try:bridge.call('cad_lisp_run',args)
            except Exception as error:errors.append(error)
        thread=threading.Thread(target=caller);thread.start()
        with bridge.lock:
            bridge.lock.wait_for(lambda:bool(bridge.queue.get(self.session)),timeout=2)
            request=bridge.queue[self.session][0]
            bridge.results[request['id']]={'id':request['id'],'target':self.target,'error':'입력 필요: point','error_data':details}
            bridge.lock.notify_all()
        thread.join(2)
        self.assertFalse(thread.is_alive())
        self.assertIsInstance(errors[0],bridge.CADToolError)
        self.assertEqual(errors[0].details,details)
        self.assertEqual(errors[0].code,'input_required')

    def test_http_error_and_stdio_keep_structured_lisp_error(self):
        details={'code':'lisp_error','output':'원문 출력','created':0,'before_revision':1,'after_revision':1}
        body={'error':'0으로 나눌 수 없습니다','code':'lisp_error','details':details}
        http_error=urllib.error.HTTPError('http://127.0.0.1/api/mcp',400,'bad request',{},io.BytesIO(json.dumps(body).encode()))
        with patch.object(mcp_server,'_grant',return_value='test-grant'),patch.object(mcp_server,'_connection',{'url':'http://127.0.0.1','token':'fixture'}),patch.object(mcp_server,'_alive',return_value=True),patch('urllib.request.urlopen',side_effect=http_error):
            with self.assertRaises(bridge.CADToolError) as caught:mcp_server.call('cad_lisp_run',{})
        self.assertEqual(caught.exception.details,details)
        request={'id':1,'method':'tools/call','params':{'name':'cad_lisp_run'}}
        stdout=io.StringIO()
        with patch('sys.stdin',io.StringIO(json.dumps(request)+'\n')),patch('sys.stdout',stdout),patch.object(mcp_server,'call',side_effect=caught.exception),patch.object(mcp_server,'_standard_read',set(mcp_server.STANDARD_PARTS)):
            mcp_server.serve()
        result=json.loads(stdout.getvalue())['result']
        self.assertTrue(result['isError'])
        self.assertEqual(json.loads(result['content'][0]['text'])['output'],'원문 출력')

if __name__=='__main__': unittest.main()
