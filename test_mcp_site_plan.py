import copy,io,json,time,unittest,uuid
from unittest.mock import patch
from concurrent.futures import ThreadPoolExecutor
import bridge,mcp_server,miriboda_service,plan_service,site_plan_service


def request():
    return {'site':{'crs':'EPSG:5187','id':'TEST','parcel':[[200000,400000],[200020,400000],[200020,400025],[200000,400025]],'neighbors':[]},
            'zoning':{'zone':'원래 지역','bcr':60,'far':200},'program':{'floors':3,'use':'근린생활시설'}}


def result():
    geometry={'crs':'EPSG:5187','units':'m','footprint':[[200002,400002],[200012,400002],[200012,400012]],'stalls':[],'parking_mode':'front'}
    return {'input':request(),'report':{'checks':[{'rule':'건폐율','ok':True,'value':40,'limit':60,'provisional':False,'details':'원본'},
            {'rule':'주차','ok':False,'value':1,'limit':2,'provisional':True}],
            'numbers':{'building_area':200,'gfa':600,'bcr':40,'far':120,'floors':3,'private':'미노출'},'geometry':geometry},
            'entities':{'crs':'EPSG:5187','units':'m','layers':{},'entities':[{'type':'LINE'},{'type':'LINE'},{'type':'TEXT'}]}}


@patch('miri_account_service.require_ai_login', new=lambda: None)
class McpSitePlanTest(unittest.TestCase):
    def setUp(self):
        with bridge.lock:
            bridge.clients.clear();bridge.queue.clear();bridge.results.clear();bridge.pending_requests.clear();bridge.active=None
        with bridge._layout_lock:bridge._layouts.clear()
        self.addCleanup(self.clear_state)
        # 새 시험은 서버 호출을 모두 mock한다.
        self.network=patch('urllib.request.urlopen',side_effect=AssertionError('Unexpected network call'))
        self.network.start();self.addCleanup(self.network.stop)
        self.session=str(uuid.uuid4());self.document={'entities':[{'id':'site','type':'polyline','closed':True,'parcelRole':'site','points':[{'x':0,'y':0},{'x':20000,'y':0},{'x':20000,'y':25000},{'x':0,'y':25000}],'attributes':{'pnu':'1234567890123456789','sourceCRS':'EPSG:5187','originMetres':[200000,400000]}}],'program':{'use':'도면 용도'}}
        self.add_editor(self.session,self.document)
        self.target=bridge.snapshot()['target']

    def clear_state(self):
        with bridge.lock:
            bridge.clients.clear();bridge.queue.clear();bridge.results.clear();bridge.pending_requests.clear();bridge.active=None
        with bridge._layout_lock:bridge._layouts.clear()

    def add_editor(self,session,doc):
        with bridge.lock:
            bridge.clients[session]={'protocol_version':1,'document_generation':str(uuid.uuid4()),'snapshot_id':str(uuid.uuid4()),
                'revision':0,'document_revision':0,'document':copy.deepcopy(doc),'seen':time.monotonic()}
            bridge.active=session

    def cache(self,value=None):return bridge._cache_layout(value or result(),request())

    def test_tool_schemas_and_edit_binding(self):
        names=('cad_site_plan_from_drawing','cad_suggest_layout','cad_validate_layout','cad_insert_layout')
        for name in names:
            tool=next(t for t in bridge.TOOLS if t['name']==name)
            self.assertEqual(tool['inputSchema']['type'],'object')
            self.assertEqual('target' in tool['inputSchema']['required'],name=='cad_insert_layout')
            self.assertEqual(name in bridge.MUTATING_TOOLS,name=='cad_insert_layout')
        self.assertEqual(bridge.BOUND_ALIASES['cad_insert_layout_bound'],'cad_insert_layout')
        self.assertNotIn('cad_insert_layout_bound',{t['name'] for t in bridge.TOOLS})

    def test_from_drawing_enrichment_overrides_and_small_summary(self):
        info={'address':'시험 주소','zones':[{'name':'지역 이름','code':'1'}],'review':{'large':'원본 미노출'}}
        with patch.object(miriboda_service,'enrich_drawing',return_value={'request':request(),'landInfo':info}) as enrich:
            value=bridge.call('cad_site_plan_from_drawing',{'program':{'floors':5},'zoning':{'bcr':50}})
        self.assertEqual(enrich.call_args.args[0]['program'],{'use':'도면 용도','floors':5})
        self.assertEqual(value['request']['zoning'],{'zone':'원래 지역','bcr':50,'far':200})
        self.assertEqual(value['request']['program']['floors'],5);self.assertEqual(value['request']['program']['use'],'도면 용도')
        self.assertEqual(value['summary'],{'site_area_m2':500,'zone':'원래 지역','bcr':50,'far':200,'floors':5})
        self.assertEqual(value['landInfo'],{'address':'시험 주소','zones':['지역 이름']})
        self.assertEqual(bridge.snapshot()['document'],self.document)

    def test_from_drawing_without_enrichment_uses_requested_editor(self):
        other=str(uuid.uuid4());self.add_editor(other,{'entities':[{'id':'other'}]})
        with patch.object(site_plan_service,'from_drawing',return_value=request()) as source,patch.object(miriboda_service,'enrich_drawing') as enrich:
            value=bridge.call('cad_site_plan_from_drawing',{'editor_session':self.session,'enrich':False,'program':{'floors':7}})
        self.assertEqual(source.call_args.args[0]['entities'],self.document['entities']);enrich.assert_not_called()
        self.assertEqual(value['request']['program']['floors'],7);self.assertNotIn('landInfo',value)

    def test_housing_missing_units_asks_before_server_call(self):
        for tool in ('cad_site_plan_from_drawing', 'cad_suggest_layout', 'cad_validate_layout'):
            for units, keys in ((None, ['count', 'exclusive_area_m2']), ({'count': 80}, ['exclusive_area_m2']), ({'exclusive_area_m2': 84}, ['count'])):
                req=request();req['program']={'use':'아파트','floors':12}
                if units is not None:req['program']['units']=units
                with self.subTest(tool=tool,units=units),patch.object(plan_service,'suggest_site_engine') as suggest,patch.object(site_plan_service,'process') as process:
                    out=bridge.call(tool,{'request':req})
                needs={n['key']:n for n in out['needs']}
                self.assertEqual(out['status'],'needs_input')
                for key in keys:
                    n=needs['program.units.'+key];self.assertTrue(n['question']);self.assertTrue(n['choices'])
                suggest.assert_not_called();process.assert_not_called()

    def test_housing_complete_units_and_mixed_areas_pass_through(self):
        for units in ({'count':80,'exclusive_area_m2':84},{'exclusive_areas_m2':[59,84]}):
            req=request();req['program'].update(use='아파트',units=units)
            with patch.object(plan_service,'suggest_site_engine',return_value=(result(),200)) as suggest:
                bridge.call('cad_suggest_layout',{'request':req})
            self.assertEqual(suggest.call_args.args[0]['siteEngine']['program']['units'],units)

    def test_neighbor_errors_name_the_input_before_server_call(self):
        for neighbors in ({}, [None], [{'jimok':'도','points':[[0,0],[1,0],[1,1]]}], [{'coords':[]}], [{'coords':[[0,0],[1,0],['bad',1]]}]):
            req=request();req['site']['neighbors']=neighbors
            with self.subTest(neighbors=neighbors),patch.object(plan_service,'suggest_site_engine') as suggest:
                with self.assertRaisesRegex(ValueError,r'site.neighbors') as error:
                    bridge.call('cad_suggest_layout',{'request':req})
            self.assertNotIn('BCAD',str(error.exception));suggest.assert_not_called()

    def test_partial_site_neighbors_are_validated(self):
        req={'site':{'neighbors':[{'jimok':'도','points':[[0,0],[1,0],[1,1]]}]},'zoning':request()['zoning'],'program':request()['program']}
        with patch.object(plan_service,'suggest_site_engine') as suggest:
            out=bridge.call('cad_suggest_layout',{'request':req,'enrich':False})
        self.assertEqual(out['status'],'needs_input');self.assertEqual(out['needs'][0]['key'],'site')
        self.assertRegex(out['needs'][0]['question'],r'site.neighbors.*coords');suggest.assert_not_called()

    def test_cached_layout_housing_override_also_asks(self):
        identifier=self.cache()
        with patch.object(site_plan_service,'process') as process:
            out=bridge.call('cad_validate_layout',{'layout_id':identifier,'program':{'use':'아파트'}})
        self.assertEqual([n['key'] for n in out['needs']],['program.units.count','program.units.exclusive_area_m2'])
        process.assert_not_called()

    def test_housing_invalid_units_name_field(self):
        for units,field in (({'count':0},'count'),({'exclusive_area_m2':-84},'exclusive_area_m2'),({'exclusive_areas_m2':[]},'exclusive_areas_m2'),({'count':2,'exclusive_areas_m2':[84]},'count')):
            req=request();req['program'].update(use='아파트',units=units)
            with self.subTest(units=units),patch.object(plan_service,'suggest_site_engine') as suggest:
                with self.assertRaisesRegex(ValueError,'program.units.'+field):bridge.call('cad_suggest_layout',{'request':req})
            suggest.assert_not_called()

    def test_layout_schema_describes_neighbor_polygon_and_housing_units(self):
        for name in ('cad_site_plan_from_drawing','cad_suggest_layout','cad_validate_layout'):
            tool=next(t for t in bridge.TOOLS if t['name']==name)
            req=tool['inputSchema']['properties']['request']['properties']
            neighbor=req['site']['properties']['neighbors']['items']
            self.assertIn('coords',neighbor['required']);self.assertIn('jimok',neighbor['properties'])
            self.assertIn('coords',tool['description'])
            units=req['program']['properties']['units']['properties']
            self.assertTrue({'count','exclusive_area_m2','exclusive_areas_m2'}<=units.keys())

    def test_suggest_summary_cache_and_request_overrides(self):
        req=request();raw=result()
        with patch.object(plan_service,'suggest_site_engine',return_value=(raw,200)) as suggest:
            value=bridge.call('cad_suggest_layout',{'request':req,'zoning':{'zone':'새 지역'},'program':{'floors':4}})
        sent=suggest.call_args.args[0]['siteEngine']
        self.assertEqual(sent['zoning']['zone'],'새 지역');self.assertEqual(sent['program']['floors'],4)
        self.assertEqual(req,request());self.assertTrue(bridge.valid_uuid(value['layout_id']))
        self.assertFalse(value['ok']);self.assertEqual(value['entity_counts'],{'LINE':2,'TEXT':1})
        self.assertEqual(value['metrics'],{'building_area':200,'gfa':600,'bcr':40,'far':120,'floors':3})
        self.assertNotIn('entities',value);self.assertNotIn('input',value);self.assertNotIn('geometry',value)
        self.assertEqual(set(value['checks'][0]),{'rule','ok','value','limit','provisional'})
        self.assertEqual(bridge._get_layout(value['layout_id']),raw)

    def test_suggest_from_drawing_and_all_checks_ok(self):
        raw=result();raw['report']['checks'][1]['ok']=True
        with patch.object(miriboda_service,'enrich_drawing',return_value={'request':request()}),patch.object(plan_service,'suggest_site_engine',return_value=(raw,200)) as suggest:
            value=bridge.call('cad_suggest_layout',{'editor_session':self.session,'program':{'floors':6}},allow_edit=False)
        self.assertTrue(value['ok']);self.assertEqual(suggest.call_args.args[0]['siteEngine']['program']['floors'],6)

    def test_remote_errors_preserved_without_fallback(self):
        for status,message in ((429,'서버 한도 안내'),(404,'공개 서버 경로 없음')):
            with self.subTest(status=status),patch.object(plan_service,'suggest_site_engine',return_value=({'error':message},status)) as suggest:
                with self.assertRaisesRegex(ValueError,'하루 사용 한도 초과.*서버 한도 안내' if status==429 else '^공개 서버 경로 없음$'):
                    bridge.call('cad_suggest_layout',{'request':request()})
                suggest.assert_called_once();self.assertEqual(len(bridge._layouts),0)

    def test_validate_layout_id_uses_cached_input_and_server_geometry(self):
        raw=result();raw['input']['program']['floors']=4;raw['input']['output']={'format':'json'}
        identifier=self.cache(raw)
        with patch.object(site_plan_service,'process',return_value=(raw['report'],200)) as process:
            value=bridge.call('cad_validate_layout',{'layout_id':identifier},allow_edit=False)
        sent,mode=process.call_args.args
        self.assertEqual(mode,'validate');self.assertEqual(sent['program']['floors'],4)
        self.assertEqual(sent['overrides'],raw['report']['geometry']);self.assertNotIn('output',sent)
        site_plan_service.payload(sent,'validate')
        self.assertFalse(value['ok']);self.assertEqual(set(value),{'checks','ok','destination'})

    def test_validate_explicit_request_and_error(self):
        req={**request(),'overrides':result()['report']['geometry']}
        with patch.object(site_plan_service,'process',return_value=(result()['report'],200)) as process:
            bridge.call('cad_validate_layout',{'request':req})
        process.assert_called_once_with(req,'validate')
        with patch.object(site_plan_service,'process',return_value=({'error':'서버 검증 경로 없음'},404)):
            with self.assertRaisesRegex(ValueError,'^서버 검증 경로 없음$'):bridge.call('cad_validate_layout',{'request':req})

    def test_validate_payload_accepts_engine_parking_modes(self):
        for parking_mode in ('front','piloti','front_piloti','general','none'):
            with self.subTest(parking_mode=parking_mode):
                req={**request(),'overrides':result()['report']['geometry']}
                req['overrides']['parking_mode']=parking_mode
                self.assertIs(site_plan_service.payload(req,'validate'),req)

    def test_validate_payload_rejects_unknown_parking_mode(self):
        req={**request(),'overrides':result()['report']['geometry']}
        req['overrides']['parking_mode']='unknown'
        with self.assertRaisesRegex(ValueError,'^주차 구획과 방식을 확인하세요\\.$'):
            site_plan_service.payload(req,'validate')

    def test_validate_payload_skips_empty_floor_rings(self):
        req={**request(),'overrides':result()['report']['geometry']}
        req['overrides']['floors']=[[],req['overrides']['footprint'],[]]
        original=copy.deepcopy(req)
        self.assertIs(site_plan_service.payload(req,'validate'),req)
        self.assertEqual(req,original)

    def test_validate_payload_keeps_other_rings_strict(self):
        for name,ring in (('walkways',[]),('landscape',[]),('floors',None),('floors',[[1,2]])):
            with self.subTest(name=name,ring=ring):
                req={**request(),'overrides':result()['report']['geometry']}
                req['overrides'][name]=[ring]
                with self.assertRaisesRegex(ValueError,'^다각형 꼭짓점을 확인하세요\\.$'):
                    site_plan_service.payload(req,'validate')

    def test_validate_requires_one_source_and_valid_cache(self):
        for args in ({'request':request(),'layout_id':str(uuid.uuid4())},{'layout_id':str(uuid.uuid4())}):
            with self.subTest(args=args),patch.object(site_plan_service,'process') as process:
                with self.assertRaises(ValueError):bridge.call('cad_validate_layout',args)
                process.assert_not_called()

    def test_insert_missing_target_or_read_only_rejected_before_dispatch(self):
        identifier=self.cache()
        with patch.object(bridge,'dispatch') as dispatch:
            with self.assertRaisesRegex(ValueError,'target binding'):bridge.call('cad_insert_layout',{'layout_id':identifier})
            with self.assertRaisesRegex(ValueError,'대화/검토 모드'):bridge.call('cad_insert_layout',{'target':self.target,'layout_id':identifier},allow_edit=False)
            dispatch.assert_not_called()

    def test_insert_missing_and_expired_cache_never_dispatch(self):
        expired=self.cache()
        with bridge._layout_lock:created,raw=bridge._layouts[expired];bridge._layouts[expired]=(created-bridge.LAYOUT_CACHE_SECONDS,raw)
        for identifier in (str(uuid.uuid4()),expired):
            with self.subTest(identifier=identifier),patch.object(bridge,'dispatch') as dispatch:
                with self.assertRaisesRegex(ValueError,'없거나 만료'):bridge.call('cad_insert_layout',{'target':self.target,'layout_id':identifier})
                dispatch.assert_not_called()

    def test_insert_dispatch_uses_cached_payload_and_bound_alias(self):
        raw=result();identifier=self.cache(raw)
        for name in ('cad_insert_layout','cad_insert_layout_bound'):
            args={'target':self.target,'layout_id':identifier,'offset':{'x':100,'y':200},'title':'검토안','result':{'bad':True}}
            with patch.object(bridge,'dispatch',return_value={'applied':True}) as dispatch:
                self.assertTrue(bridge.call(name,args)['applied'])
            action,sent=dispatch.call_args.args
            self.assertEqual(action,'cad_insert_layout');self.assertEqual(sent['request'],raw['input']);self.assertEqual(sent['result'],raw)
            self.assertEqual(sent['target'],self.target);self.assertEqual(sent['offset'],args['offset']);self.assertEqual(args['result'],{'bad':True})

    def test_stale_target_rejected_before_dispatch(self):
        identifier=self.cache()
        with bridge.lock:
            state=bridge.clients[self.session];state.update(revision=1,document_revision=1,snapshot_id=str(uuid.uuid4()))
        with patch.object(bridge,'dispatch') as dispatch:
            with self.assertRaisesRegex(ValueError,'target changed'):bridge.call('cad_insert_layout',{'target':self.target,'layout_id':identifier})
            dispatch.assert_not_called()

    def test_cache_capacity_expiry_and_isolation(self):
        raw=result()
        with patch.object(bridge.time,'monotonic',return_value=100):
            identifiers=[self.cache(raw) for _ in range(17)]
            self.assertEqual(len(bridge._layouts),16)
            with self.assertRaises(ValueError):bridge._get_layout(identifiers[0])
            raw['input']['program']['floors']=90
            value=bridge._get_layout(identifiers[-1]);value['input']['program']['floors']=80
            self.assertEqual(bridge._get_layout(identifiers[-1])['input']['program']['floors'],3)
        with patch.object(bridge.time,'monotonic',return_value=100+bridge.LAYOUT_CACHE_SECONDS):
            with self.assertRaises(ValueError):bridge._get_layout(identifiers[-1])
            self.assertEqual(len(bridge._layouts),0)

    def test_cache_concurrent_writes_stay_bounded(self):
        with ThreadPoolExecutor(max_workers=4) as pool:identifiers=list(pool.map(lambda _:self.cache(),range(32)))
        self.assertEqual(len(set(identifiers)),32)
        with bridge._layout_lock:remaining=list(bridge._layouts)
        self.assertEqual(len(remaining),16)
        for identifier in remaining:self.assertEqual(bridge._get_layout(identifier),result())

    def test_pulse_accepts_insert_result_across_load_generation(self):
        good,bad=str(uuid.uuid4()),str(uuid.uuid4());deadline=time.monotonic()+10
        with bridge.lock:
            for identifier in (good,bad):bridge.pending_requests[identifier]={'recipient':self.session,'request':{'action':'cad_insert_layout','args':{'target':self.target}},'deadline':deadline}
        response={'target':self.target,'before_revision':0,'after_revision':1,'revision':1,'applied':True}
        data={'client':self.session,'editor_session':self.session,'protocol_version':1,'document_generation':str(uuid.uuid4()),
              'revision':1,'document_revision':1,'document':self.document,'active':True,
              'results':[{'id':good,'target':self.target,'result':response},{'id':bad,'target':self.target,'result':{**response,'applied':False}}]}
        with patch.object(bridge,'schedule_recovery'),patch.object(bridge,'preserve_last_session'),patch.object(bridge,'recovery_has_content',return_value=False),patch.object(bridge,'recovery_error',return_value=None):value=bridge.pulse(data)
        self.assertEqual(bridge.results[good]['result'],response);self.assertNotIn(bad,bridge.results)
        self.assertIn(bad,value['rejected_results']);self.assertNotEqual(value['target']['document_generation'],self.target['document_generation'])

    def test_mcp_transport_waits_for_layout_services(self):
        state={'url':'http://127.0.0.1:1','token':'mock'}
        for name,timeout in (('cad_site_plan_from_drawing',30),('cad_suggest_layout',30),('cad_validate_layout',30),('cad_insert_layout',30)):
            with self.subTest(name=name),patch.object(mcp_server,'_grant',return_value='test-grant'),patch.object(mcp_server,'find_connection',return_value=state),patch.object(mcp_server,'_alive',return_value=True),patch('urllib.request.urlopen',return_value=io.BytesIO(b'{}')) as urlopen:
                self.assertEqual({k:v for k,v in mcp_server.call(name,{}).items() if k!='destination'},{})
                self.assertEqual(urlopen.call_args.kwargs['timeout'],timeout)
                self.assertEqual(json.loads(urlopen.call_args.args[0].data),{'name':name,'arguments':{}})

    def test_mcp_tools_list_exposes_new_tools(self):
        stdin=io.StringIO(json.dumps({'id':1,'method':'tools/list'})+'\n');stdout=io.StringIO()
        with patch.object(mcp_server.sys,'stdin',stdin),patch.object(mcp_server.sys,'stdout',stdout):mcp_server.serve()
        names={t['name'] for t in json.loads(stdout.getvalue())['result']['tools']}
        self.assertTrue({'cad_site_plan_from_drawing','cad_suggest_layout','cad_validate_layout','cad_insert_layout'}<=names)

    def test_cache_input_falls_back_to_request_without_valid_engine_input(self):
        raw=result();raw['input']={'site':{'crs':'wrong'}}
        identifier=self.cache(raw);self.assertEqual(bridge._get_layout(identifier)['input'],request())


if __name__=='__main__':unittest.main()
