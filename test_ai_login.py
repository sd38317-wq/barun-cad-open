"""AI 공통 로그인 경계: 실제 계정·네트워크를 사용하지 않는다."""
import io,json,tempfile,threading,unittest
from pathlib import Path
from unittest.mock import patch
from http.server import ThreadingHTTPServer
import urllib.request,urllib.error
import bridge,mcp_server,miri_account_service as account

class AILoginTests(unittest.TestCase):
    def setUp(self):
        self.folder=tempfile.TemporaryDirectory()
        self.addCleanup(self.folder.cleanup)
        self.enterContext(patch.object(account,'TOKEN_FILE',Path(self.folder.name)/'token'))
        self.enterContext(patch.object(account,'_token_path',None))
        self.enterContext(patch.object(account,'_token_cache',None))
        self.enterContext(patch.object(account,'_linked_token',None))
        for key,value in {'_token_signature':None,'_token_epoch':0,'_login_check_until':0.0,'_login_check_error':None,'_login_check_inflight':None}.items():
            self.enterContext(patch.object(account,key,value))
        self.enterContext(patch.object(account,'_protect',side_effect=lambda data:data))
        self.unprotect=self.enterContext(patch.object(account,'_unprotect',side_effect=lambda data:data))
        self.enterContext(patch.object(account,'_miri_connected',return_value=False))
        self.enterContext(patch('vault_gate.ensure',return_value={}))
        self.network=self.enterContext(patch.object(account,'_request',side_effect=AssertionError('unexpected network')))

    def linked(self):
        account._save_token('fixture-token')
        with patch.object(account,'_request',return_value={'state':'linked'}):
            account.process({'action':'status'})

    def test_every_tool_and_legacy_alias_rejected_before_any_work(self):
        with patch.object(bridge,'dispatch') as dispatch, patch.object(bridge,'snapshot') as snapshot:
            for name in [t['name'] for t in bridge.TOOLS]+list(bridge.BOUND_ALIASES):
                with self.subTest(name=name), self.assertRaises(account.AILoginRequired) as caught:
                    bridge.call(name,{})
                self.assertEqual(str(caught.exception),account.AI_LOGIN_MESSAGE)
                self.assertEqual(caught.exception.code,'not_logged_in')
            dispatch.assert_not_called()
            snapshot.assert_not_called()

    def test_legacy_parcel_cookie_does_not_unlock_ai(self):
        with patch('parcel_service.cookie',return_value='old-session'):
            with self.assertRaises(account.AILoginRequired): bridge.call('cad_get_document',{})

    def test_starting_login_without_finishing_never_unlocks_ai(self):
        with patch.object(account,'_request',side_effect=ValueError('start failed')):
            with self.assertRaisesRegex(ValueError,'start failed'): account.process({'action':'login'})
        self.assertTrue(account._load_token())
        with self.assertRaises(account.AILoginRequired): account.require_ai_login()

    def test_linked_state_and_token_are_cached(self):
        self.linked()
        for _ in range(30): account.require_ai_login()
        self.assertEqual(self.unprotect.call_count,1)
        self.network.assert_not_called()
        with patch.object(bridge,'dispatch',return_value={'ok':True}):
            self.assertTrue(bridge.call('cad_suggest_details',{})['ok'])

    def test_waiting_and_expired_status_revoke_access(self):
        self.linked()
        with patch.object(account,'_request',return_value={'state':'waiting'}):
            account.process({'action':'status'})
        with self.assertRaises(account.AILoginRequired): account.require_ai_login()
        self.linked()
        with patch.object(account,'_request',side_effect=ValueError('연결 만료')):
            with self.assertRaisesRegex(ValueError,'만료'): account.process({'action':'status'})
        self.assertIsNone(account._load_token())
        with self.assertRaises(account.AILoginRequired): account.require_ai_login()

    def test_account_status_refreshes_other_engine_token_changes(self):
        self.assertIsNone(account._load_token())
        import base64
        account.TOKEN_FILE.write_bytes(base64.b64encode(b'other-engine-token'))
        with patch.object(account,'_request',return_value={'state':'linked'}):
            account.process({'action':'status'})
        account.require_ai_login()
        account.TOKEN_FILE.unlink()
        account.process({'action':'status'})
        with self.assertRaises(account.AILoginRequired): account.require_ai_login()

    def test_logout_revokes_before_disconnect_request(self):
        self.linked()
        def disconnect(*_):
            with self.assertRaises(account.AILoginRequired): account.require_ai_login()
            return {}
        with patch.object(account,'_request',side_effect=disconnect):
            account.process({'action':'logout'})

    def test_both_internal_ai_windows_reject_before_transport(self):
        import codex_chat,miri_chat
        client=codex_chat.Client.__new__(codex_chat.Client)
        with patch.object(miri_chat,'register') as register:
            for call in (lambda:client.chat({}),lambda:miri_chat.send({})):
                with self.assertRaises(account.AILoginRequired): call()
            register.assert_not_called()

    def test_http_and_mcp_preserve_code_and_exact_message(self):
        import server
        httpd=ThreadingHTTPServer(('127.0.0.1',0),server.Handler)
        threading.Thread(target=httpd.serve_forever,daemon=True).start()
        url=f'http://127.0.0.1:{httpd.server_port}'
        state={'url':url,'token':server.TOKEN}
        try:
            with patch.object(server,'SHELL_SECRET',''), patch.object(mcp_server,'_grant',return_value=server.TOKEN), patch.object(mcp_server,'_connection',state), patch.object(mcp_server,'_alive',return_value=True), patch.object(mcp_server,'find_connection',return_value=state):
                with self.assertRaises(account.AILoginRequired) as caught: mcp_server.call('cad_get_document',{})
                self.assertEqual(str(caught.exception),account.AI_LOGIN_MESSAGE)
                self.assertEqual(caught.exception.code,'not_logged_in')
        finally:
            httpd.shutdown();httpd.server_close()

    def test_stdio_list_available_and_call_reports_login_code(self):
        requests=[{'id':1,'method':'tools/list'},{'id':2,'method':'tools/call','params':{'name':'cad_get_document'}}]
        stdin=io.StringIO('\n'.join(map(json.dumps,requests))+'\n')
        output=io.StringIO()
        with patch('sys.stdin',stdin),patch('sys.stdout',output),patch.object(mcp_server,'call',side_effect=account.AILoginRequired(account.AI_LOGIN_MESSAGE)) as call:
            mcp_server.serve()
        listed,called=map(json.loads,output.getvalue().splitlines())
        self.assertEqual(len(listed['result']['tools']),len(bridge.mcp_tools()))
        self.assertTrue(called['result']['isError'])
        self.assertEqual(called['result']['code'],'not_logged_in')
        self.assertEqual(called['result']['content'][0]['text'],account.AI_LOGIN_MESSAGE)
        call.assert_called_once()

    def test_first_ai_open_polls_token_without_ui_status_and_caches_success(self):
        account._save_token('first-call-token')
        with patch.object(account,'_request',return_value={'state':'linked'}) as poll,patch.object(bridge,'open_file',return_value={'opened':True}) as opened:
            self.assertTrue(bridge.call('cad_open_file',{'path':'fixture.dxf'})['opened'])
            for _ in range(10):account.require_ai_login()
        poll.assert_called_once_with('first-call-token','poll');opened.assert_called_once()

    def test_missing_token_never_calls_poll(self):
        with self.assertRaises(account.AILoginRequired):account.require_ai_login()
        self.network.assert_not_called()

    def test_first_not_connected_is_denied_and_failure_is_cached(self):
        account._save_token('waiting-token')
        with patch.object(account,'_request',return_value={'state':'waiting'}) as poll:
            for _ in range(2):
                with self.assertRaises(account.AILoginRequired):account.require_ai_login()
        poll.assert_called_once()

    def test_network_failure_has_distinct_message_and_short_cache(self):
        account._save_token('network-token')
        with patch.object(account,'_request',side_effect=ValueError('network offline')) as poll:
            for _ in range(2):
                with self.assertRaises(account.AILoginCheckUnavailable) as error:account.require_ai_login()
                self.assertEqual(error.exception.code,'login_check_unavailable');self.assertIn('네트워크',str(error.exception))
        poll.assert_called_once()
        with patch.object(account,'_login_check_until',0),patch.object(account,'_request',return_value={'state':'linked'}) as retry:account.require_ai_login()
        retry.assert_called_once()

    def test_concurrent_first_calls_share_one_poll(self):
        account._save_token('concurrent-token')
        started=threading.Event();release=threading.Event();barrier=threading.Barrier(6);errors=[]
        def poll(*_):started.set();self.assertTrue(release.wait(3));return {'state':'linked'}
        def caller():
            try:barrier.wait(3);account.require_ai_login()
            except Exception as error:errors.append(error)
        with patch.object(account,'_request',side_effect=poll) as requested:
            workers=[threading.Thread(target=caller) for _ in range(6)]
            for worker in workers:worker.start()
            self.assertTrue(started.wait(3));release.set()
            for worker in workers:worker.join(3);self.assertFalse(worker.is_alive())
        self.assertEqual(errors,[]);requested.assert_called_once()

    def test_success_cache_expires_and_rechecks_server(self):
        self.linked()
        with patch.object(account,'_login_check_until',0),patch.object(account,'_request',return_value={'state':'disconnected'}) as poll:
            with self.assertRaises(account.AILoginRequired):account.require_ai_login()
        poll.assert_called_once()

    def test_other_engine_logout_file_deletion_revokes_immediately(self):
        self.linked();account.TOKEN_FILE.unlink()
        with self.assertRaises(account.AILoginRequired):account.require_ai_login()
        self.network.assert_not_called()

    def test_logout_during_poll_cannot_reauthorize_old_token(self):
        account._save_token('old-token')
        def poll(*_):account._clear_token();return {'state':'linked'}
        with patch.object(account,'_request',side_effect=poll):
            with self.assertRaises(account.AILoginRequired):account.require_ai_login()
        self.assertIsNone(account._linked_token)

    def test_stale_expiry_response_cannot_delete_replacement_login(self):
        account._save_token('old-token')
        def poll(token,_):
            if token=='old-token':account._save_token('new-token');raise ValueError('연결 만료')
            return {'state':'linked'}
        with patch.object(account,'_request',side_effect=poll) as requested:account.require_ai_login()
        self.assertEqual(account._load_token(),'new-token');self.assertEqual(requested.call_count,2)

    def test_newer_disconnected_ui_status_wins_over_older_linked_ai_poll(self):
        account._save_token('race-token');started=threading.Event();release=threading.Event();errors=[]
        def poll(*_):
            if threading.current_thread().name=='old-ai-poll':started.set();release.wait(3);return {'state':'linked'}
            return {'state':'disconnected'}
        def call_ai():
            try:account.require_ai_login()
            except Exception as error:errors.append(error)
        with patch.object(account,'_request',side_effect=poll):
            worker=threading.Thread(target=call_ai,name='old-ai-poll');worker.start()
            self.assertTrue(started.wait(3));self.assertFalse(account.process({'action':'status'})['connected']);release.set();worker.join(3)
        self.assertFalse(worker.is_alive());self.assertEqual(len(errors),1);self.assertIsInstance(errors[0],account.AILoginRequired)
        self.assertIsNone(account._linked_token)

    def test_http_and_mcp_preserve_network_check_error(self):
        import server
        httpd=ThreadingHTTPServer(('127.0.0.1',0),server.Handler)
        threading.Thread(target=httpd.serve_forever,daemon=True).start()
        state={'url':f'http://127.0.0.1:{httpd.server_port}','token':server.TOKEN}
        try:
            with patch.object(server,'SHELL_SECRET',''),patch.object(mcp_server,'_grant',return_value=server.TOKEN),patch.object(mcp_server,'find_connection',return_value=state),patch.object(account,'require_ai_login',side_effect=account.AILoginCheckUnavailable(account.AI_LOGIN_CHECK_MESSAGE)):
                with self.assertRaises(account.AILoginCheckUnavailable) as error:mcp_server.call('cad_get_document',{})
                self.assertIn('네트워크',str(error.exception));self.assertEqual(error.exception.code,'login_check_unavailable')
        finally:httpd.shutdown();httpd.server_close()

if __name__=='__main__': unittest.main()
