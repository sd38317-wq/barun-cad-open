"""AI(MCP) 사용 기록에서 반복된 오류를 재현하는 작은 시험 묶음(2026-10-22 전수 검토, 진행메모/2026-10-22_AI오류전수검토_*.md)."""
import time
import unittest
import uuid
from unittest.mock import patch

import bridge


class BridgeTargetErrors(unittest.TestCase):
    def setUp(self):
        with bridge.lock:
            bridge.clients.clear();bridge.queue.clear();bridge.results.clear();bridge.pending_requests.clear();bridge.active=None
        self.enterContext(patch.object(bridge,'schedule_recovery'))
        self.enterContext(patch('miri_account_service.require_ai_login',new=lambda:None))
        self.enterContext(patch('miri_account_service.capture_ai_epoch',return_value=None))
        self.client=str(uuid.uuid4())
        self.body={'client':self.client,'editor_session':self.client,'protocol_version':1,'document_generation':str(uuid.uuid4()),
                   'revision':2,'document_revision':2,'document':{'entities':[],'layers':[]},'active':True}
        self.old=bridge.pulse(self.body)['target']
        self.new=bridge.pulse({**self.body,'revision':3,'document_revision':3})['target']
        self.assertNotEqual(self.old['revision'],self.new['revision'])

    def test_read_tool_with_old_target_is_rebound_not_refused(self):
        # 기록: 그린 뒤 옛 target 으로 cad_describe_command·cad_view_drawing 을 불러 'CAD target changed' (11건)
        with patch.object(bridge,'_send_locked',return_value={'ok':True}) as send:
            bridge.dispatch('cad_describe_command',{'name':'W1','target':self.old})
        self.assertEqual(send.call_args.args[2]['target'],self.new)

    def test_mutating_tool_with_old_target_is_refused_in_korean_with_code(self):
        with patch.object(bridge,'_send_locked') as send,self.assertRaises(bridge.CADToolError) as caught:
            bridge.dispatch('cad_execute',{'command':{'type':'add'},'target':self.old})
        send.assert_not_called()
        self.assertEqual(caught.exception.code,'target_changed')
        self.assertRegex(str(caught.exception),'[가-힣]')
        self.assertIn('cad_get_document',str(caught.exception))

    def test_read_timeout_does_not_say_do_not_retry_change(self):
        with patch.object(bridge,'dispatch_timeout',return_value=0),self.assertRaises(bridge.CADToolError) as caught:
            bridge.dispatch('cad_view_drawing',{'target':self.new})
        self.assertEqual(caught.exception.code,'timeout_read')
        self.assertNotIn('재시도하지 마세요',str(caught.exception))
        with patch.object(bridge,'dispatch_timeout',return_value=0),self.assertRaisesRegex(ValueError,'재시도하지 마세요'):
            bridge.dispatch('cad_execute',{'command':{'type':'add'},'target':self.new})


class LargeResults(unittest.TestCase):
    def setUp(self):
        self.enterContext(patch('miri_account_service.require_ai_login',new=lambda:None))

    def test_unit_and_jutong_search_are_paged(self):
        # 기록: cad_search_units/jutong(query="") 결과가 AI 한도를 넘어 못 읽음(5건)
        rows=[{'id':f'U{i}'} for i in range(130)]
        with patch('detail_search_library.search_units',return_value={'status':'ok','count':130,'units':rows,'details':rows}):
            first=bridge.call('cad_search_units',{})
            last=bridge.call('cad_search_units',{'offset':120,'limit':50})
        self.assertEqual((first['count'],first['total'],first['has_more']),(20,130,True))
        self.assertEqual(first['units'],first['details'])
        self.assertEqual((last['count'],last['has_more']),(10,False))
        with patch('detail_search_library.search_jutong',return_value={'status':'ok','count':130,'details':rows}):
            self.assertEqual(len(bridge.call('cad_search_jutong',{'query':''})['details']),20)

    def test_drawing_sets_skip_models_when_many(self):
        doc={'drawingSets':{f'ds-{i}':{'kind':'set','model':{'big':'x'*1000},'revision':1} for i in range(5)}}
        with patch.object(bridge,'snapshot',return_value={'document':doc}):
            many=bridge.call('cad_get_drawing_sets',{})
            one=bridge.call('cad_get_drawing_sets',{'setId':'ds-3'})
        self.assertFalse(any('model' in r for r in many['sets']))
        self.assertIn('setId',many['hint'])
        self.assertEqual([r['setId'] for r in one['sets']],['ds-3']);self.assertIn('model',one['sets'][0])


    def test_classified_drawings_missing_index_is_not_an_error(self):
        # 기록: '전체 정규화 활용 인덱스가 아직 없습니다.' 오류(4건) — 설치판엔 인덱스가 없다
        import classified_drawing_service as classified
        with patch.object(classified,'available',return_value=False):
            for name in ('cad_search_classified_drawings','cad_get_classified_drawing'):
                out=bridge.call(name,{'group_id':'x'} if name=='cad_get_classified_drawing' else {})
                self.assertEqual((out['status'],out['code']),('unavailable','not_bundled'))
                self.assertIn('cad_search_design_cases',out['message'])


class PlainMessages(unittest.TestCase):
    def test_site_hole_says_what_to_do(self):
        import site_plan_service
        pts=[{'x':0,'y':0},{'x':10,'y':0},{'x':10,'y':10}]
        ring=lambda i,kind:{'id':i,'type':'polyline','closed':True,'layer':'s','parcelRole':'site','attributes':{'ring':kind},'points':pts}
        with self.assertRaisesRegex(ValueError,'바깥 경계만 A-SITE'):
            site_plan_service.from_drawing({'units':'mm','layers':[{'id':'s','name':'A-SITE'}],'entities':[ring('a','outer'),ring('b','hole')]})


if __name__=='__main__':unittest.main()
