import unittest
from unittest.mock import patch
import miriboda_service as m

class MiribodaTests(unittest.TestCase):
 def test_land_retains_mixed_zones_and_service_limits_without_secrets(self):
  uses={'landUses':{'field':[{'prposAreaDstrcCode':'UQA220','prposAreaDstrcCodeNm':'일반상업지역','cnflcAtNm':'저촉'},{'prposAreaDstrcCode':'UQA130','prposAreaDstrcCodeNm':'준주거지역','cnflcAtNm':'저촉'}]}}
  review={'massing':{'zoneName':'준주거지역','zoneConfirmed':True},'report':{'sections':[{'rows':[{'label':'건폐율','value':{'v':'60%'}},{'label':'용적률','value':{'v':'400%'}}]}]}}
  with patch.object(m.parcel,'request',side_effect=[(uses,None),(review,None)]):
   result=m.land_info('2623010100101560007',163,config={'key':'secret-test','domain':'barunarc.co.kr'})
  self.assertIsNone(result['recordAreaM2']);self.assertEqual(result['polygonAreaM2'],163)
  self.assertEqual(len(result['zones']),2);self.assertEqual(result['limits'],{'bcr':60,'far':400});self.assertTrue(result['warnings']);self.assertNotIn('secret-test',str(result))
 def test_outside_busan_plans_with_unconfirmed_zone_and_city_group_is_not_a_second_zone(self):
  # 대전 구성동 21: 도시지역+자연녹지지역, zoneConfirmed=False(부산 밖) — 수치가 있으면 계획 진행.
  uses={'landUses':{'field':[{'prposAreaDstrcCode':'UQA100','prposAreaDstrcCodeNm':'도시지역','cnflcAtNm':'포함'},{'prposAreaDstrcCode':'UQA430','prposAreaDstrcCodeNm':'자연녹지지역','cnflcAtNm':'포함'}]}}
  review={'massing':{'zoneName':'자연녹지지역','zoneConfirmed':False,'maxBuildingAreaM2':1969.6,'maxFloorAreaM2':7878.4},'report':{'sections':[]}}
  with patch.object(m.parcel,'request',side_effect=[(uses,None),(review,None)]):
   result=m.land_info('3020012400100210000',9848.1,config={'key':'k','domain':'barunarc.co.kr'})
  self.assertFalse([w for w in result['warnings'] if '복수 용도지역' in w])
  request={'site':{'id':'3020012400100210000','parcel':[[0,0],[100,0],[100,98.481],[0,98.481]]},'program':{}}
  with patch('site_plan_service.from_drawing',return_value=request),patch.object(m,'land_info',return_value=result):
   out=m.enrich_drawing({'program':{'floors':4}})
  self.assertEqual(out['request']['zoning']['zone'],'자연녹지지역')
 def test_plan_input_sources_record_defaults_before_user_and_lookup_values(self):
  from copy import deepcopy
  base={'site':{'id':'x','parcel':[[0,0],[10,0],[10,10],[0,10]]},'program':{'use':'근린생활시설','floor_h':3.6,'floors':3,'parking':{'stall':'일반형'}}}
  info={'address':'시험','massing':{'zoneName':'시험지역','maxBuildingAreaM2':60,'maxFloorAreaM2':200},'limits':{'bcr':60,'far':200}}
  for program, source in (({},'default'),({'floors':4},'user')):
   with self.subTest(source=source),patch('site_plan_service.from_drawing',return_value=deepcopy(base)),patch.object(m,'land_info',return_value=info):
    out=m.enrich_drawing({'program':program})
   sources=out['inputSources']
   self.assertEqual(sources['program.floor_h']['source'],'default')
   self.assertEqual(sources['program.floor_h']['value'],3.6)
   self.assertEqual(sources['program.floors']['source'],source)
   self.assertEqual(sources['program.target_gfa']['source'],'default')
   self.assertEqual(sources['zoning.bcr']['source'],'confirmed')
   self.assertNotIn('inputSources',out['request'])
 def test_sms_never_sends_without_explicit_confirmation(self):
  with patch.object(m.parcel,'request') as request:
   with self.assertRaises(ValueError):m.process({'action':'sms','phone':'01012345678','text':'test'})
   request.assert_not_called()
 def test_sms_wires_exact_confirmed_content_mock_only(self):
  with patch.object(m.parcel,'request',return_value=({'ok':True},None)) as request:
   m.process({'action':'sms','phone':'010-1234-5678','text':'검토 내용','confirmed':True})
   self.assertEqual(request.call_args.args[1],{'phone':'01012345678','text':'검토 내용'})
 def test_report_escapes_remote_text(self):
  self.assertIn('&lt;script&gt;',''.join(m.report_pages({'address':'<script>','zones':[]})))

if __name__=='__main__':unittest.main()
