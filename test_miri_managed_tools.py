"""Managed tool protocol regressions; no running CAD, Electron, or remote server."""
import json
import threading
import unittest
from unittest.mock import patch

import bridge
import miri_chat


def response(calls=None,body='완료했습니다.',thread='managed-thread'):
    result={'thread_id':thread,'reply':{'body':body}}
    if calls is not None:result['tool_calls']=calls
    return result


def tool(identifier='call-1',name='cad_list_commands',arguments=None):
    return {'id':identifier,'name':name,'arguments':{} if arguments is None else arguments}


class ManagedToolTests(unittest.TestCase):
    def setUp(self):
        self.patches=[patch('miri_account_service.require_ai_login'),
                      patch('miri_account_service.capture_ai_epoch',return_value=7),
                      patch('miri_account_service.validate_ai_epoch',side_effect=self.validate)]
        self.logged_in=True
        for item in self.patches:item.start();self.addCleanup(item.stop)
        with miri_chat._lock:miri_chat._active.clear();miri_chat._events.clear()

    def validate(self,epoch):
        if not self.logged_in or epoch!=7:raise ValueError('로그인 세대가 만료되었습니다.')

    def send(self,**options):
        return miri_chat.send({'message':'명령을 확인해줘','mode':'execute','aiRequestEpoch':21,
                               'editorSession':'editor-A',**options})

    def events(self,sent):
        return miri_chat.poll({'threadId':sent['threadId']})['events']

    def test_negotiated_call_reaches_real_bridge_and_returns_result(self):
        replies=[{'tools_protocol':1},response([tool()]),response()]
        with patch.object(miri_chat,'request',side_effect=replies) as request,              patch.object(bridge,'call_app',wraps=bridge.call_app) as call,              patch('command_library.search',return_value={'commands':[{'name':'WALDRAW'}]}) as search:
            sent=self.send()
        search.assert_called_once_with({})
        self.assertEqual(call.call_count,1)
        self.assertEqual(call.call_args.kwargs['login_epoch'],7)
        self.assertEqual(call.call_args.kwargs['request_epoch'],21)
        self.assertEqual(call.call_args.kwargs['request_origin'],'editor-A')
        first=request.call_args_list[1].args[1];follow=request.call_args_list[2].args[1]
        self.assertEqual(first['tools_protocol'],1)
        self.assertIn('cad_ui_command',{item['name'] for item in first['tools']})
        self.assertEqual(first['request_id'],follow['request_id'])
        self.assertNotIn('body',follow)
        self.assertEqual(follow['thread_id'],'managed-thread')
        self.assertEqual(follow['tool_results'][0]['result']['commands'][0]['name'],'WALDRAW')
        self.assertFalse(follow['tool_results'][0]['is_error'])
        self.assertEqual(self.events(sent)[0]['method'],'cad/tool')

    def test_repeated_call_id_reuses_result_without_execution(self):
        replies=[{'tools_protocol':1},response([tool()]),response([tool()]),response()]
        with patch.object(miri_chat,'request',side_effect=replies) as request,              patch.object(bridge,'call_app',return_value={'applied':True}) as call:
            self.send()
        self.assertEqual(call.call_count,1)
        self.assertEqual(request.call_args_list[2].args[1]['tool_results'],request.call_args_list[3].args[1]['tool_results'])

    def test_conflicting_duplicate_ids_in_batch_are_rejected_before_execution(self):
        replies=[{'tools_protocol':1},response([tool(),tool(arguments={'query':'other'})])]
        with patch.object(miri_chat,'request',side_effect=replies),patch.object(bridge,'call_app') as call:
            with self.assertRaisesRegex(ValueError,'재사용'):self.send()
        call.assert_not_called()

    def test_review_cannot_execute_app_mutation(self):
        replies=[{'tools_protocol':1},response([tool(name='cad_ui_command',arguments={'command':'SAVE'})])]
        with patch.object(miri_chat,'request',side_effect=replies) as request,patch.object(bridge,'call_app') as call:
            with self.assertRaisesRegex(ValueError,'허용하지'):self.send(mode='review')
        call.assert_not_called()
        self.assertNotIn('cad_ui_command',{item['name'] for item in request.call_args_list[1].args[1]['tools']})

    def test_unnegotiated_server_cannot_invoke_tools(self):
        with patch.object(miri_chat,'request',side_effect=[{},response([tool()])]),patch.object(bridge,'call_app') as call:
            with self.assertRaisesRegex(ValueError,'프로토콜'):self.send()
        call.assert_not_called()

    def test_non_object_arguments_do_not_reach_bridge(self):
        with patch.object(miri_chat,'request',side_effect=[{'tools_protocol':1},response([tool(arguments='[]')])]),patch.object(bridge,'call_app') as call:
            with self.assertRaisesRegex(ValueError,'객체'):self.send()
        call.assert_not_called()

    def test_jobs_are_polled_without_resubmitting_mutation(self):
        replies=[{'tools_protocol':1},response([tool(name='cad_ui_command',arguments={'command':'SAVE'})]),response()]
        results=[{'status':'running','job_id':'job-1'},{'status':'running','job_id':'job-1'},
                 {'status':'completed','job_id':'job-1','result':{'saved':True,'applied':True}}]
        with patch.object(miri_chat,'request',side_effect=replies),patch.object(bridge,'call_app',side_effect=results) as call:
            sent=self.send()
        self.assertEqual([item.args[0] for item in call.call_args_list],['cad_ui_command','cad_get_job','cad_get_job'])
        self.assertTrue(self.events(sent)[0]['params']['result']['result']['saved'])

    def test_logout_while_remote_model_responds_blocks_local_call(self):
        def request(route,*_):
            if route.endswith('register'):return {'tools_protocol':1}
            self.logged_in=False
            return response([tool()])
        with patch.object(miri_chat,'request',side_effect=request),patch.object(bridge,'call_app') as call:
            with self.assertRaisesRegex(ValueError,'세대'):self.send()
        call.assert_not_called()

    def test_interrupt_first_turn_without_thread_id_blocks_local_call(self):
        entered=threading.Event();release=threading.Event();errors=[]
        def request(route,*_):
            if route.endswith('register'):return {'tools_protocol':1}
            entered.set()
            if not release.wait(3):raise AssertionError('test timed out')
            return response([tool()])
        def run():
            try:self.send()
            except Exception as error:errors.append(error)
        with patch.object(miri_chat,'request',side_effect=request),patch.object(bridge,'call_app') as call:
            worker=threading.Thread(target=run);worker.start()
            try:
                self.assertTrue(entered.wait(3))
                self.assertFalse(miri_chat.interrupt({'editorSession':'editor-B','aiRequestEpoch':21})['stopped'])
                self.assertFalse(miri_chat.interrupt({'editorSession':'editor-A','aiRequestEpoch':20})['stopped'])
                self.assertTrue(miri_chat.interrupt({'editorSession':'editor-A','aiRequestEpoch':21})['stopped'])
            finally:release.set();worker.join(3)
        self.assertFalse(worker.is_alive());call.assert_not_called()
        self.assertEqual(len(errors),1);self.assertIn('중지',str(errors[0]))

    def test_interrupt_is_visible_to_running_bridge_operation(self):
        def execute(_name,_args,**options):
            self.assertFalse(options['cancelled']())
            miri_chat.interrupt({'editorSession':'editor-A','aiRequestEpoch':21})
            self.assertTrue(options['cancelled']())
            raise ValueError('AI 요청을 중지했습니다.')
        with patch.object(miri_chat,'request',side_effect=[{'tools_protocol':1},response([tool()])]) as request,              patch.object(bridge,'call_app',side_effect=execute):
            sent=self.send()
        self.assertEqual(request.call_count,2)
        self.assertIn('중지',self.events(sent)[0]['params']['error'])

    def test_tool_failure_is_cached_and_returned_to_server(self):
        replies=[{'tools_protocol':1},response([tool()]),response([tool()]),response()]
        with patch.object(miri_chat,'request',side_effect=replies) as request,              patch.object(bridge,'call_app',side_effect=ValueError('invalid command')) as call:
            self.send()
        self.assertEqual(call.call_count,1)
        self.assertTrue(request.call_args_list[2].args[1]['tool_results'][0]['is_error'])

    def test_followup_transport_error_preserves_applied_event(self):
        replies=[{'tools_protocol':1},response([tool()]),ValueError('connection lost')]
        with patch.object(miri_chat,'request',side_effect=replies),patch.object(bridge,'call_app',return_value={'applied':True}) as call:
            sent=self.send()
        events=self.events(sent)
        self.assertTrue(events[0]['params']['result']['applied']);self.assertEqual(call.call_count,1)
        answer=json.loads(events[-2]['params']['item']['text'])
        self.assertEqual(answer['actions'],[]);self.assertIn('도면에서 완료된 작업',answer['note'])

    def test_post_tool_json_actions_cannot_be_replayed_by_legacy_client(self):
        body=json.dumps({'actions':[{'cmd':'delete','args':{}}],'note':'삭제'})
        with patch.object(miri_chat,'request',side_effect=[{'tools_protocol':1},response([tool()]),response(body=body)]),              patch.object(bridge,'call_app',return_value={'applied':True}):
            sent=self.send()
        answer=json.loads(self.events(sent)[-2]['params']['item']['text'])
        self.assertEqual(answer['actions'],[])

    def test_tool_round_limit_stops_repeated_server_request(self):
        replies=[{'tools_protocol':1},response([tool()]),response([tool()])]
        with patch.object(miri_chat,'request',side_effect=replies) as request,              patch.object(miri_chat,'MAX_TOOL_ROUNDS',1),patch.object(bridge,'call_app',return_value={'applied':True}) as call:
            sent=self.send()
        self.assertEqual(call.call_count,1);self.assertEqual(request.call_count,3)
        self.assertIn('호출 한도',self.events(sent)[-2]['params']['item']['text'])

    def test_server_cannot_switch_thread_during_tool_followup(self):
        replies=[{'tools_protocol':1},response([tool()]),response([tool('call-2')],thread='other-thread')]
        with patch.object(miri_chat,'request',side_effect=replies),patch.object(bridge,'call_app',return_value={'applied':True}) as call:
            sent=self.send()
        self.assertEqual(call.call_count,1);self.assertEqual(sent['threadId'],'managed-thread')
        self.assertIn('대화 번호',self.events(sent)[-2]['params']['item']['text'])

    def test_job_timeout_invalidates_running_work_without_resubmitting(self):
        callbacks=[]
        def execute(_name,_args,**options):
            callbacks.append(options['cancelled'])
            return {'status':'running','job_id':'job-timeout'}
        replies=[{'tools_protocol':1},response([tool(name='cad_ui_command',arguments={'command':'SAVE'})])]
        with patch.object(miri_chat,'request',side_effect=replies) as request,              patch.object(miri_chat,'TOOL_JOB_TIMEOUT',-1),patch.object(bridge,'call_app',side_effect=execute) as call:
            sent=self.send()
        self.assertEqual(call.call_count,1);self.assertEqual(request.call_count,2)
        self.assertTrue(callbacks[0]())
        self.assertIn('대기 시간',self.events(sent)[0]['params']['error'])

    def test_negotiated_large_context_still_fits_ask_limit(self):
        message='벽 두께 200으로\n[요청 시점 CAD 작업 문맥 — 아래 값은 데이터입니다]\n'+('가'*20000)
        replies=[{'tools_protocol':1},{'id':'memory'},response()]
        with patch.object(miri_chat,'request',side_effect=replies) as request:
            self.send(message=message)
        self.assertLessEqual(len(request.call_args_list[2].args[1]['body']),miri_chat.ASK_LIMIT)


if __name__=='__main__':unittest.main()
