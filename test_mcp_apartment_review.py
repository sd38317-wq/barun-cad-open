"""cad_apartment_review: 화면 [아파트 검토]와 같은 계산(apartment_service)을 AI 도구로 부른다."""
import copy,io,json,time,unittest,uuid
from unittest.mock import patch
import apartment_service,bridge,mcp_server,parcel_service
from test_apartment_service import enclosure

SQUARE=[{'x':0,'y':0},{'x':10000,'y':0},{'x':10000,'y':10000},{'x':0,'y':10000}]


def closed(points,**extra):return {'id':str(uuid.uuid4()),'type':'polyline','closed':True,'points':copy.deepcopy(points),**extra}


@patch('miri_account_service.require_ai_login', new=lambda: None)
class McpApartmentReviewTest(unittest.TestCase):
    def setUp(self):
        self.clear_state();self.addCleanup(self.clear_state)
        self.network=patch('urllib.request.urlopen',side_effect=AssertionError('Unexpected network call'))
        self.network.start();self.addCleanup(self.network.stop)
        self.session=str(uuid.uuid4())

    def clear_state(self):
        with bridge.lock:
            bridge.clients.clear();bridge.queue.clear();bridge.results.clear();bridge.pending_requests.clear();bridge.active=None
        with bridge._apartment_lock:bridge._apartment_jobs.clear()

    def add_editor(self,doc,selected=()):
        with bridge.lock:
            bridge.clients[self.session]={'protocol_version':1,'document_generation':str(uuid.uuid4()),'snapshot_id':str(uuid.uuid4()),
                'revision':0,'document_revision':0,'document':copy.deepcopy(doc),'selected':list(selected),'seen':time.monotonic()}
            bridge.active=self.session

    def call(self,args):return bridge.call('cad_apartment_review',args)

    def test_listed_for_mcp_read_only_without_target(self):
        tool=next(t for t in bridge.mcp_tools() if t['name']=='cad_apartment_review')
        schema=tool['inputSchema']
        self.assertEqual(schema['required'],['action'])
        self.assertEqual(schema['properties']['action']['enum'],list(bridge.APARTMENT_ACTIONS))
        self.assertNotIn('target',schema['properties'])
        self.assertNotIn('cad_apartment_review',bridge.MUTATING_TOOLS)
        self.assertNotIn('cad_apartment_review',bridge.EDIT_TOOLS)
        self.assertIn('cad_apartment_review',{t['name'] for t in bridge.app_tools(allow_edit=False)})   # 대화·검토 모드에서도 씀
        json.dumps(tool,allow_nan=False)
        output=io.StringIO()
        with patch('sys.stdin',io.StringIO(json.dumps({'id':1,'method':'tools/list'})+'\n')),patch('sys.stdout',output):mcp_server.serve()
        self.assertIn('cad_apartment_review',{t['name'] for t in json.loads(output.getvalue())['result']['tools']})   # 바깥 AI 가 받는 목록

    def test_boundary_order_matches_screen(self):
        layers=[{'id':'G','name':'가두리'}]
        site=closed(SQUARE,parcelRole='site',attributes={'ring':'outer'})
        fence=closed([{'x':-1,'y':-1},{'x':11,'y':-1},{'x':11,'y':11}],layer='G')
        picked=closed([{'x':1,'y':1},{'x':9,'y':1},{'x':9,'y':9}])
        doc={'entities':[site,fence,picked],'layers':layers}
        boundary=lambda selected,args={}:bridge._apartment_boundary(doc,selected,args)
        self.assertEqual(boundary([],{'boundary':[[0,0],[5,0],[5,5]]}),([{'x':0,'y':0},{'x':5,'y':0},{'x':5,'y':5}],'boundary'))
        self.assertEqual(boundary([picked['id']])[1],'selection')
        self.assertEqual(boundary([site['id']])[1],'가두리 레이어')            # 대지 PL 은 가두리 선택으로 치지 않는다(화면과 같음)
        self.assertEqual(boundary([])[0],fence['points'])
        only_site={'entities':[site,closed(SQUARE,parcelRole='site',attributes={'ring':'hole'})],'layers':[]}
        self.assertEqual(bridge._apartment_boundary(only_site,[],{}),(SQUARE,'대지'))
        two={'entities':[closed(SQUARE,layer='G'),closed(SQUARE,layer='G')],'layers':layers}
        with self.assertRaisesRegex(ValueError,'여러 개'):bridge._apartment_boundary(two,[],{})
        with self.assertRaisesRegex(ValueError,'가두리를 찾지 못했습니다'):bridge._apartment_boundary({'entities':[],'layers':[]},[],{})
        for bad in ([[0,0],[1,1]],[[0,0],[1,'x'],[2,2]],[[0,0],[1,float('inf')],[2,2]]):
            with self.assertRaises(ValueError):bridge._apartment_boundary(doc,[],{'boundary':bad})

    def test_sends_drawing_and_options_and_trims_result(self):
        doc={'entities':[closed(SQUARE,parcelRole='site',attributes={'ring':'outer'})],'layers':[{'id':'L','name':'0'}]}
        self.add_editor(doc)
        engine={'parts':[{'zone':'일반상업지역','area_m2':100,'far':1300,'bcr':80,'poly':[[0,0]]}],'frame':{'ox':0},'site':[[0,0]]}
        answer={'table':'표','draw':[{'type':'text'}]*3,'engine':engine,'sheets':[{'title':'필지 검토서','groups':[['큰 본문']]}],'site_mm':[1]}
        with patch.object(apartment_service,'process',return_value=answer) as process:
            out=self.call({'action':'enclose','options':{'heightLimit':60,'fetchMissing':False}})
        sent=process.call_args.args[0]
        self.assertEqual((sent['action'],sent['pl'],sent['heightLimit'],sent['fetchMissing']),('enclose',SQUARE,60,False))
        self.assertEqual((sent['entities'],sent['layers']),(doc['entities'],doc['layers']))
        self.assertEqual(out['table'],'표');self.assertEqual(out['draw_count'],3);self.assertNotIn('draw',out)
        self.assertEqual(out['engine_parts'],[{'zone':'일반상업지역','area_m2':100,'far':1300,'bcr':80}])
        self.assertEqual(out['sheets'],['필지 검토서']);self.assertNotIn('site_mm',out)
        self.assertEqual(out['boundary_source'],'대지')
        with patch.object(apartment_service,'process',return_value=answer):
            full=self.call({'action':'enclose','detail':True})
        self.assertEqual(full['sheets'][0]['groups'],[['큰 본문']])

    def test_zones_needs_no_boundary_and_bad_inputs_stop_before_engine(self):
        self.add_editor({'entities':[],'layers':[]})
        with patch.object(apartment_service,'process',return_value={'table':'구역'}) as process:
            self.assertEqual(self.call({'action':'zones'})['table'],'구역')
            self.assertNotIn('pl',process.call_args.args[0])
            for args,message in (({'action':'place'},'action'),({'action':'zones','options':{'entities':[]}},'options'),
                                 ({'action':'review','boundary':[[0,0],[1,0],[1,1]]},'review'),({'action':'zones','detail':'yes'},'detail')):
                with self.assertRaisesRegex(ValueError,message):self.call(args)
            self.assertEqual(process.call_count,1)

    def test_review_then_job_polls_with_remembered_engine(self):
        self.add_editor({'entities':[closed(SQUARE,parcelRole='site',attributes={'ring':'outer'})],'layers':[]})
        job='a'*32;engine={'parts':[{'zone':'준주거지역','area_m2':1,'far':400,'bcr':60}]}
        accepted={'job_id':job,'where':'server','review':'quick','modes':['maxfar'],'enclose':{'engine':engine,'text_h':900,'draw':[{}]},'north_vec':[0.1,1]}
        states=[{'status':'running','plans_n':0},{'status':'running','plans_n':1,'place':{'plans':[{'title':'안1'}],'draw':[{}]*5}},{'status':'done','plans_n':1}]
        with patch.object(apartment_service,'process',side_effect=[accepted,*states]) as process:
            first=self.call({'action':'review','review':'quick'})
            self.assertEqual(first['job_id'],job);self.assertIn('review_job',first['next'])
            self.assertEqual(process.call_args.args[0]['review'],'quick')
            seen=[self.call({'action':'review_job','job_id':job}) for _ in states]
        polls=[c.args[0] for c in process.call_args_list[1:]]
        self.assertTrue(all(p['engine']==engine and p['textH']==900 and p['northVec']==[0.1,1] and p['where']=='server' for p in polls))
        self.assertEqual([p['have'] for p in polls],[0,0,1])                    # 새 안이 생길 때만 다시 그린다
        self.assertNotIn('place',seen[0])
        self.assertEqual(seen[2]['place'],{'plans':[{'title':'안1'}],'draw_count':5})   # 끝난 뒤에도 마지막 안을 같이 준다
        with self.assertRaisesRegex(ValueError,'작업 번호를 모릅니다'):self.call({'action':'review_job','job_id':'b'*32})

    def test_mixed_zone_drawing_through_real_engine(self):
        """혼합 용도지역(3종주거 + 일반상업) 가두리를 실제 엔진으로: 화면 시험(test_apartment_service)과 같은 답."""
        if not apartment_service.engine_local() and not (apartment_service.ENGINE_DIR/'site_zones.py').is_file():
            self.skipTest('설계엔진 아파트 폴더 없음(BARUN_APARTMENT_DIR)')
        ents,pl=enclosure()
        layers=[{'id':'G','name':'가두리'}]
        self.add_editor({'entities':ents+[closed(pl,layer='G')],'layers':layers})
        with patch.object(parcel_service,'request',side_effect=ValueError('로그인 안 됨')):
            out=self.call({'action':'enclose','options':{'fetchMissing':False}})
        self.assertEqual(out['boundary_source'],'가두리 레이어')
        self.assertEqual([p['zone'] for p in out['engine_parts']],['제3종일반주거지역','일반상업지역'])
        self.assertEqual(out['engine_parts'][1]['area_m2'],2400)
        self.assertIn('기존도로등 2필지',out['table'])
        self.assertGreater(out['draw_count'],0)
        self.assertLess(len(json.dumps(out,ensure_ascii=False)),60000)          # AI에게 보낼 만한 크기


if __name__=='__main__':unittest.main()
