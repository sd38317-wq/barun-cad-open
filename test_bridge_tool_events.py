"""Presentation events must preserve tool replies and isolate CAD windows."""
import json,threading,time,unittest,uuid
from unittest.mock import patch
import bridge

class ToolEventsTest(unittest.TestCase):
    def setUp(self):
        with bridge.lock:
            bridge.clients.clear();bridge.queue.clear();bridge.results.clear();bridge.pending_requests.clear();bridge.active=None
        with bridge._jobs_lock:
            bridge._jobs.clear();bridge._tool_events.clear();bridge._tool_active.clear()
        self.enterContext(patch('miri_account_service.capture_ai_epoch',return_value=None))
        self.enterContext(patch('miri_account_service.validate_ai_epoch'))
        self.enterContext(patch.object(bridge,'schedule_recovery'))
        self.enterContext(patch.object(bridge,'recovery_error',return_value=None))
        self.client=str(uuid.uuid4());self.other=str(uuid.uuid4())
        bridge.pulse({'client':self.client,'active':True})
        bridge.pulse({'client':self.other,'active':False})

    def pulse(self):return bridge.pulse({'client':self.client,'active':True})

    def test_fast_read_preserves_result_and_only_sends_safe_aggregates(self):
        raw={'summary':{'entityCount':3},'path':'private-path','token':'private-token'}
        with patch.object(bridge,'_call',return_value=raw):
            result=bridge._invoke_tool('cad_get_document',{'ids':['private-id']},True)
        self.assertEqual({k:v for k,v in result.items() if k!='destination'},raw)
        events=self.pulse()['toolEvents']
        self.assertEqual([e['phase'] for e in events],['running','completed'])
        self.assertEqual(events[-1]['count'],3);self.assertEqual(events[-1]['target'],{'ids_count':1})
        self.assertEqual(len({e['id'] for e in events}),1)
        self.assertNotIn('private',json.dumps(events));self.assertTrue(events[0]['started_at_ms']<=events[-1]['at_ms'])
        self.assertEqual(bridge.pulse({'client':self.other})['toolEvents'],[])
        self.assertEqual(self.pulse()['toolActiveIds'],[])

    def test_real_background_stages_and_chat_origin_are_shared_without_changing_job_reply(self):
        release=threading.Event();entered=threading.Event()
        def operation(*args):
            bridge._tool_stage('dispatch');entered.set();release.wait(2);return {'applied':True,'count':2}
        with patch.object(bridge,'_call_app',side_effect=operation),patch.object(bridge,'JOB_RESPONSE_SECONDS',.001):
            try:
                result=bridge.call_app('cad_execute',{},True,request_epoch=7,request_origin=self.client)
                self.assertEqual(result['status'],'running');self.assertIn(result['stage'],('queued','running','dispatch'))
                self.assertTrue(entered.wait(1));first=self.pulse()
                self.assertEqual([e['stage'] for e in first['toolEvents']],['queued','running','dispatch'])
                self.assertTrue(all(e['source']=='chat' and e['request_epoch']==7 for e in first['toolEvents']))
                self.assertEqual(len(first['toolActiveIds']),1)
                self.assertEqual(bridge._jobs[result['job_id']]['stage'],'dispatch')
            finally:release.set()
            done=bridge.get_job({'job_id':result['job_id'],'wait_seconds':1})
        self.assertEqual(done['result']['count'],2)
        last=self.pulse();self.assertEqual(last['toolEvents'][-1]['phase'],'completed');self.assertEqual(last['toolActiveIds'],[])

    def test_failure_reply_is_not_reported_as_success_and_preflight_has_no_orphan_start(self):
        with patch.object(bridge,'_call',return_value={'error':'private-error'}):
            self.assertEqual(bridge._invoke_tool('cad_list_commands',{},True)['error'],'private-error')
        self.assertEqual(self.pulse()['toolEvents'][-1]['phase'],'failed')
        with self.assertRaises(ValueError):bridge._invoke_tool('cad_execute',{},False,app=True)
        self.assertEqual(self.pulse()['toolActiveIds'],[])

    def test_bounded_queue_snapshot_recovers_dropped_terminal_and_missing_start(self):
        def event(identifier,phase):return {'id':identifier,'tool':'cad_execute','phase':phase,'stage':phase,'source':'mcp','target':{}}
        bridge.emit_tool_event(self.client,event('long','running'))
        self.assertEqual(self.pulse()['toolActiveIds'],['long'])
        bridge.emit_tool_event(self.client,event('long','completed'))
        for i in range(100):bridge.emit_tool_event(self.client,event(str(i),'completed'))
        state=self.pulse();self.assertLessEqual(len(state['toolEvents']),64);self.assertEqual(state['toolActiveIds'],[])
        bridge.emit_tool_event(self.client,event('active','running'))
        bridge.take_tool_events(self.client)
        replay=self.pulse();self.assertEqual(replay['toolEvents'][0]['id'],'active')

    def test_waiting_path_stays_in_existing_mcp_reply_only(self):
        record={'done':threading.Event(),'destination':{},'waiting':{'kind':'cad_window_confirmation','path':'C:/private.dxf'}}
        value=bridge._job_value('job',record)
        self.assertEqual(value['waiting']['path'],'C:/private.dxf')
        self.assertIn('C:/private.dxf',value['message'])
        safe=bridge._safe_tool_target({'target':{'kind':'C:/private.dxf','path':'private','entity_count':True}})
        self.assertEqual(safe,{})

    def test_counts_use_existing_result_lists_without_inspecting_geometry(self):
        class Unreadable(dict):
            def __iter__(self):raise AssertionError('geometry scan')
        self.assertEqual(bridge._tool_count({'document':{'entities':[Unreadable()] * 3}}),3)
        self.assertEqual(bridge._tool_count({'added':['one','two']}),2)
