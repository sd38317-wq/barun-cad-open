"""앱 AI 전체 도구 권한, MCP 동등성, 로그인 및 파일 덮어쓰기 계약."""
import io,json,tempfile,unittest
from pathlib import Path
from unittest.mock import patch
import bridge,mcp_server,miri_chat,chat_router
from test_mcp_3d import Mcp3DTest

@patch('miri_account_service.require_ai_login',new=lambda:None)
class AppAIToolsTest(unittest.TestCase):
    setUp=Mcp3DTest.setUp
    clear_state=Mcp3DTest.clear_state

    def test_app_tool_names_cover_actual_mcp_tools_list(self):
        out=io.StringIO()
        with patch('sys.stdin',io.StringIO(json.dumps({'id':1,'method':'tools/list'})+'\n')),patch('sys.stdout',out):mcp_server.serve()
        mcp={t['name'] for t in json.loads(out.getvalue())['result']['tools']}
        app={t['name'] for t in bridge.app_tools(True)}
        self.assertGreater(app,mcp)
        self.assertEqual(mcp,{t['name'] for t in bridge.TOOLS if not t.get('app_only')})
        self.assertEqual(app-mcp,{'cad_ui_command','cad_lisp_list','cad_lisp_read','cad_lisp_save'})
        self.assertFalse(any('app_only' in t for t in bridge.app_tools()))

    def test_future_common_tool_is_automatically_exposed(self):
        future={'name':'cad_future_read','description':'future','inputSchema':{'type':'object','properties':{}}}
        with patch.object(bridge,'TOOLS',[*bridge.TOOLS,future]):
            for tools in (bridge.app_tools(True),bridge.app_tools(False),bridge.mcp_tools()):self.assertIn('cad_future_read',{t['name'] for t in tools})

    def test_review_exposes_every_read_but_no_changes_or_exports(self):
        expected={t['name'] for t in bridge.TOOLS}-bridge.EDIT_TOOLS
        self.assertEqual({t['name'] for t in bridge.app_tools(False)},expected)
        for name in bridge.EDIT_TOOLS:
            with self.subTest(name=name),patch.object(bridge,'dispatch') as dispatch,self.assertRaises(ValueError):bridge.call_app(name,{},False)
            dispatch.assert_not_called()

    def test_external_mcp_cannot_call_app_only_tools(self):
        for name in ('cad_ui_command','cad_lisp_list','cad_lisp_read','cad_lisp_save'):
            with self.subTest(name=name),patch.object(bridge,'dispatch') as dispatch,self.assertRaisesRegex(ValueError,'전용'):bridge.call(name,{'target':self.target},True)
            dispatch.assert_not_called()

    def test_ui_command_requires_valid_bound_target_and_single_name(self):
        for args in ({'command':'NEW'},{'command':'(SHELL)','target':self.target},{'command':'NEW\nSHELL','target':self.target}):
            with patch.object(bridge,'dispatch') as dispatch,self.assertRaises(ValueError):bridge.call_app('cad_ui_command',args,True)
            dispatch.assert_not_called()
        args={'command':'PLANSET','target':self.target}
        with patch.object(bridge,'dispatch',return_value={'started':True}) as dispatch:self.assertTrue(bridge.call_app('cad_ui_command',args,True)['started'])
        dispatch.assert_called_once_with('cad_ui_command',args)

    def test_new_lisp_save_validation_does_not_expose_arbitrary_paths(self):
        for args in ({'name':'../a.lsp','source':'(princ)'},{'name':'a.py','source':'(princ)'},{'name':'a.lsp','source':' '},{'name':'a.lsp','source':'한'*70000}):
            with patch.object(bridge,'dispatch') as dispatch,self.assertRaises(ValueError):bridge.call_app('cad_lisp_save',{'target':self.target,**args},True)
            dispatch.assert_not_called()

    def test_other_file_overwrite_needs_ui_confirmation(self):
        file=Path(self.folder.name)/'other.dxf';file.write_bytes(b'original')
        args={'folder':self.folder.name,'name':file.name,'target':self.target}
        with patch.object(bridge,'dispatch',return_value={'confirmed':False}) as dispatch,patch.object(bridge,'call') as call,self.assertRaisesRegex(ValueError,'취소'):bridge.call_app('cad_save',args,True)
        call.assert_not_called();self.assertEqual(file.read_bytes(),b'original');self.assertEqual(dispatch.call_args.args[0],'cad_confirm_write')
        with patch.object(bridge,'dispatch',return_value={'confirmed':True}),patch.object(bridge,'call',return_value={'path':str(file)}) as call:bridge.call_app('cad_save',args,True)
        call.assert_called_once_with('cad_save',args,allow_edit=True)

    def test_overwrite_confirmation_wait_is_reported_in_running_job(self):
        # 덮어쓰기 확인을 CAD 창에서 기다리는 동안 AI 쪽 결과는 그냥 "작업 중"이라 사용자가 몰랐다.
        import threading
        file=Path(self.folder.name)/'other.dxf';file.write_bytes(b'original');asked=threading.Event();answer=threading.Event()
        def confirm(*_):asked.set();answer.wait(5);return {'confirmed':False}
        args={'folder':self.folder.name,'name':file.name,'target':self.target}
        with patch.object(bridge,'dispatch',side_effect=confirm),patch.object(bridge,'call'),patch.object(bridge,'JOB_RESPONSE_SECONDS',0.05):
            running=bridge.call_app('cad_save',args,True)
            self.assertTrue(asked.wait(2))
            running=bridge.call_app('cad_get_job',{'job_id':running['job_id']},True)
            self.assertEqual(running['status'],'running');self.assertEqual(running['waiting']['kind'],'cad_window_confirmation')
            self.assertIn('CAD 창에서 확인 필요',running['message'])
            answer.set()
            with self.assertRaisesRegex(ValueError,'취소'):bridge.call_app('cad_get_job',{'job_id':running['job_id'],'wait_seconds':5},True)

    def test_current_drawing_save_does_not_ask(self):
        file=Path(self.folder.name)/'current.dxf';file.write_bytes(b'old')
        with bridge.lock:bridge.clients[self.session]['drawingPath']=str(file)
        args={'folder':self.folder.name,'name':file.name,'target':self.target}
        with patch.object(bridge,'dispatch') as dispatch,patch.object(bridge,'call',return_value={'path':str(file)}):bridge.call_app('cad_save',args,True)
        dispatch.assert_not_called()

    def test_file_changed_during_confirmation_is_preserved(self):
        file=Path(self.folder.name)/'other.dxf';file.write_bytes(b'original')
        def approve(*_):file.write_bytes(b'changed concurrently');return {'confirmed':True}
        with patch.object(bridge,'dispatch',side_effect=approve),patch.object(bridge,'call') as call,self.assertRaisesRegex(ValueError,'바뀌어'):bridge.call_app('cad_save',{'folder':self.folder.name,'name':file.name,'target':self.target},True)
        call.assert_not_called();self.assertEqual(file.read_bytes(),b'changed concurrently')

    def test_lisp_library_only_reuses_status_and_read(self):
        with patch('lisp_service.process',return_value={'files':[]}) as process:bridge.call_app('cad_lisp_list',{},False)
        process.assert_called_once_with({'action':'status'})
        with patch('lisp_service.process',return_value={'source':'(princ)'}) as process:bridge.call_app('cad_lisp_read',{'id':'x'},False)
        process.assert_called_once_with({'action':'read','id':'x'})

    def test_cancelled_app_dispatch_is_removed_and_marks_only_app_requests(self):
        import threading,time
        cancelled=threading.Event();errors=[]
        def invoke():
            try:bridge.call_app('cad_ui_command',{'target':self.target,'command':'PLANSET'},True,request_epoch=11,cancelled=cancelled.is_set)
            except ValueError as error:errors.append(str(error))
        worker=threading.Thread(target=invoke);worker.start()
        with bridge.lock:
            self.assertTrue(bridge.lock.wait_for(lambda:bool(bridge.queue.get(self.session)),timeout=2))
            self.assertEqual(bridge.queue[self.session][0]['args']['_app_epoch'],11)
        cancelled.set();worker.join(2)
        self.assertFalse(worker.is_alive());self.assertIn('중지',errors[0])
        with bridge.lock:self.assertFalse(bridge.queue[self.session]);self.assertFalse(bridge.pending_requests)

    def test_screen_tools_do_not_need_large_document_snapshot(self):
        import threading
        with bridge.lock:
            bridge.clients[self.session].pop('document',None)
            bridge.clients[self.session]['documentOmitted']=60000
        replies=[]
        def invoke():replies.append(bridge.call_app('cad_ui_command',{'command':'PLANSET'},True,request_epoch=1,request_origin=self.session))
        worker=threading.Thread(target=invoke);worker.start()
        with bridge.lock:
            self.assertTrue(bridge.lock.wait_for(lambda:bool(bridge.queue.get(self.session)),timeout=2))
            request=bridge.queue[self.session][0]
            self.assertIsNone(request['args']['target'])
            bridge.results[request['id']]={'id':request['id'],'target':None,'result':{'started':True}}
            bridge.lock.notify_all()
        worker.join(2);self.assertFalse(worker.is_alive());self.assertTrue(replies[0]['started'])

    def test_cancel_during_dxf_export_never_writes_file(self):
        cancelled=False
        def export(_):
            nonlocal cancelled
            cancelled=True
            return b'DXF',[]
        args={'folder':self.folder.name,'name':'new.dxf','target':self.target}
        with patch('exchange.export_dxf',side_effect=export),patch('project.save') as save,self.assertRaisesRegex(ValueError,'중지'):
            bridge.call_app('cad_save',args,True,cancelled=lambda:cancelled)
        save.assert_not_called()

    def test_request_authorization_uses_recipient_and_server_cancellation(self):
        import time
        identifier='pending-test';cancelled=False
        with bridge.lock:bridge.pending_requests[identifier]={'recipient':self.session,'deadline':time.monotonic()+30,'login_epoch':__import__('miri_account_service')._token_epoch,'cancelled':lambda:cancelled}
        self.assertTrue(bridge.validate_app_request(identifier,self.session)['authorized'])
        with self.assertRaises(ValueError):bridge.validate_app_request(identifier,'another-window')
        cancelled=True
        with self.assertRaisesRegex(ValueError,'중지'):bridge.validate_app_request(identifier,self.session)

    def test_miri_advertises_same_tools_and_keeps_legacy_ask(self):
        for mode in ('execute','review'):
            with patch.object(miri_chat,'request',return_value={}) as request:miri_chat.register(mode)
            data=request.call_args.args[1]
            self.assertEqual(data['tools'],bridge.app_tools(mode=='execute'))
            self.assertEqual(data['tools_protocol'],1)
            self.assertEqual(data['context_policy']['allow_edit'],mode=='execute')

class AppAILoginTest(unittest.TestCase):
    def test_login_required_before_any_app_tool_or_authorization(self):
        from miri_account_service import AILoginRequired
        with patch('miri_account_service.require_ai_login',side_effect=AILoginRequired('not_logged_in')):
            for name in ('cad_get_document','cad_ui_command','cad_lisp_list','cad_lisp_read','cad_lisp_save'):
                with patch.object(bridge,'dispatch') as dispatch,self.assertRaises(AILoginRequired):bridge.call_app(name,{},True)
                dispatch.assert_not_called()
            with self.assertRaises(AILoginRequired):chat_router.process({'action':'authorize'})
            with patch.object(miri_chat,'register') as register:self.assertFalse(miri_chat.status()['authenticated'])
            register.assert_not_called()

if __name__=='__main__':unittest.main()
