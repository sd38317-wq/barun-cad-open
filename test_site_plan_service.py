import json
import unittest
from pathlib import Path
from unittest.mock import patch
import site_plan_service as service

class ContractTests(unittest.TestCase):
    def setUp(self):
        root=Path('test-fixtures/site-plan-v053')
        raw=json.loads((root/'demo_site_north_road.json').read_text(encoding='utf8'))
        self.request={k:raw[k] for k in ('site','zoning','program')}
        self.request.update(json.loads((root/'validate_overrides_northroad.json').read_text(encoding='utf8')))

    def test_polygon_contract_preserves_every_field(self):
        result=service.payload(self.request,'validate')
        self.assertEqual(result,self.request)
        self.assertEqual(len(result['overrides']['footprint']),6)
        self.assertIn('rooftop_box',result['overrides'])
        self.assertIn('landscape',result['overrides'])

    def test_rejects_old_rectangle_and_wrong_crs(self):
        self.request['overrides']['building_rect']=[[0,0]]*4
        with self.assertRaises(ValueError):service.payload(self.request,'validate')
        del self.request['overrides']['building_rect']
        self.request['site']['crs']='EPSG:5179'
        with self.assertRaises(ValueError):service.payload(self.request,'validate')

    @patch.object(service,'auth_headers',return_value={})
    @patch.object(service.urllib.request,'urlopen')
    def test_validate_url_and_exact_wire_payload(self,open_url,_):
        report={'mode':'validate','checks':[{'rule':'구획 도로 접근','ok':False,'provisional':False}], 'geometry':self.request['overrides'],'all_ok':False,'provisional_rules':['건폐율']}
        open_url.return_value.__enter__.return_value.read.return_value=json.dumps(report).encode()
        result,status=service.process(self.request,'validate')
        self.assertEqual(status,200);self.assertEqual(result,report)
        req=open_url.call_args.args[0]
        self.assertTrue(req.full_url.endswith('/site-plan/validate'))
        self.assertEqual(json.loads(req.data),self.request)

    @patch.object(service,'auth_headers',return_value={})
    @patch.object(service.urllib.request,'urlopen')
    def test_no_candidate_is_an_error_not_an_empty_plan(self,open_url,_):
        reply={'execution_status':'no_candidate','report':{'checks':[],'geometry':{'footprint':[],'floors':[]}}}
        open_url.return_value.__enter__.return_value.read.return_value=json.dumps(reply).encode()
        root=Path('test-fixtures/site-plan-v053');raw=json.loads((root/'demo_site_north_road.json').read_text(encoding='utf8'))
        result,status=service.process({k:raw[k] for k in ('site','zoning','program')},'generate')
        self.assertEqual(status,422);self.assertIn('후보를 찾지 못했습니다',result['error'])

    @patch.object(service,'auth_headers',return_value={})
    @patch.object(service.urllib.request,'urlopen',side_effect=TimeoutError())
    def test_waits_past_engine_limit_and_reports_timeout_not_offline(self,open_url,_):
        # 엔진은 90초에 504 로 이유를 알린다 → CAD 는 그보다 오래 기다려야 그 답을 받는다.
        result,status=service.process(self.request,'validate')
        self.assertGreater(open_url.call_args.kwargs['timeout'],90)
        self.assertEqual(status,504);self.assertIn('시간 초과',result['error']);self.assertNotIn('인터넷',result['error'])

if __name__=='__main__':unittest.main()
