"""내 모델 > Claude(API 키) — claude_chat.py. 실제 Anthropic 서버·키체인 없이: 요청과 보안 저장소를 가짜로 바꿔 본다."""
import json,tempfile,unittest
from pathlib import Path
from unittest.mock import patch
import claude_chat

class ClaudeChatTests(unittest.TestCase):
    def setUp(self):
        self.root=tempfile.TemporaryDirectory();folder=Path(self.root.name)
        self.requests=[]
        self.replies=[]
        def fake_request(route,key,body=None,timeout=180):
            self.requests.append((route,key,json.loads(json.dumps(body)) if body else None))
            return self.replies.pop(0) if route=='/messages' else {'data':[{'id':'claude-sonnet-5-5'}]}
        self.patches=[patch.object(claude_chat,'_key_file',lambda:folder/'claude-api-key.bin'),
            patch.object(claude_chat,'_request',fake_request),
            patch('miri_account_service._protect',lambda data:b'P'+data[::-1]),
            patch('miri_account_service._unprotect',lambda data:data[1:][::-1]),
            patch('miri_account_service.capture_ai_epoch',return_value=1),patch('miri_account_service.validate_ai_epoch',lambda e:None),
            patch.object(claude_chat,'_events',{}),patch.object(claude_chat,'_history',{}),patch.object(claude_chat,'_active',{})]
        for p in self.patches:p.start()
    def tearDown(self):
        for p in self.patches:p.stop()
        self.root.cleanup()

    def test_key_is_checked_for_free_saved_protected_and_only_tail_is_shown(self):
        with self.assertRaises(ValueError):claude_chat.save_key({'key':'not-a-key'})
        self.assertEqual(self.requests,[],'모양이 틀리면 서버에 보내지 않는다')
        key='sk-ant-api03-'+'x'*30+'Ab12'
        result=claude_chat.save_key({'key':key,'model':'claude-opus-5-5'})
        self.assertEqual(self.requests[-1][0],'/models?limit=1','연결 확인은 모델 목록(요금 없음)')
        self.assertEqual((result['authenticated'],result['keyTail'],result['model']),(True,'Ab12','claude-opus-5-5'))
        self.assertNotIn(key,json.dumps(result))
        self.assertNotIn(key.encode(),claude_chat._key_file().read_bytes(),'파일에 키가 그대로 남지 않는다')
        self.assertEqual(claude_chat._read_key(),key)
        self.assertFalse(claude_chat.forget_key()['authenticated'])

    def test_without_key_chat_explains_both_ways(self):
        with self.assertRaisesRegex(ValueError,'API 키.*Claude 앱'):claude_chat.send({'action':'send','message':'안녕'})

    def test_tool_loop_runs_cad_tools_through_bridge_and_answers(self):
        claude_chat.save_key({'key':'sk-ant-api03-'+'y'*30})
        self.replies=[
            {'stop_reason':'tool_use','content':[{'type':'text','text':'도면을 봅니다.'},{'type':'tool_use','id':'t1','name':'cad_get_document','input':{'mode':'summary'}}]},
            {'stop_reason':'end_turn','content':[{'type':'text','text':'벽이 4개 있습니다.'}]}]
        calls=[]
        def call_app(name,args,**options):calls.append((name,args,options['allow_edit']));return {'summary':{'entityCount':4}}
        with patch('bridge.call_app',call_app):
            sent=claude_chat.send({'action':'send','message':'도면 요약해 줘','editorSession':'e1'})
        self.assertEqual(calls,[('cad_get_document',{'mode':'summary'},False)],'검토 모드: 고치지 않는 권한으로')
        second=self.requests[-1][2]['messages']
        self.assertEqual(second[-1]['content'][0]['type'],'tool_result')
        self.assertTrue(all(t['name'].startswith('cad_') for t in self.requests[-1][2]['tools']))
        events=claude_chat.poll({'threadId':sent['threadId'],'cursor':0})['events']
        self.assertEqual(events[-2]['params']['item']['text'],'벽이 4개 있습니다.')
        self.assertEqual(events[0]['method'],'cad/tool')

    def test_execute_mode_wraps_answer_as_actions_note_and_refuses_unknown_tools(self):
        claude_chat.save_key({'key':'sk-ant-api03-'+'z'*30})
        self.replies=[
            {'stop_reason':'tool_use','content':[{'type':'tool_use','id':'t1','name':'shell','input':{}}]},
            {'stop_reason':'end_turn','content':[{'type':'text','text':'못 했습니다.'}]}]
        with patch('bridge.call_app',side_effect=AssertionError('불리면 안 됨')):
            sent=claude_chat.send({'action':'send','message':'지워','mode':'execute'})
        result=self.requests[-1][2]['messages'][-1]['content'][0]
        self.assertTrue(result['is_error'])
        answer=claude_chat.poll({'threadId':sent['threadId'],'cursor':0})['events'][-2]['params']['item']['text']
        self.assertEqual(json.loads(answer),{'actions':[],'ask':None,'note':'못 했습니다.'})

if __name__=='__main__':unittest.main()
