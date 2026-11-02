"""AI one-sentence planning: no production network, CAD process or Electron needed."""
import copy
import json
import subprocess
from pathlib import Path
import threading
import time
import unittest
import uuid
from unittest.mock import patch
import access_context
import bridge
import layout_context
import miriboda_service
import parcel_service
import plan_service
import site_plan_service
import vault_gate
from test_mcp_site_plan import request, result

PNU='1234567890123456789'
ZONE={'zone':'시험 용도지역','bcr':60,'far':200}


def drawing(geographic=False):
    e={'id':'land','type':'polyline','closed':True,'layer':'site-layer','points':[{'x':10000,'y':20000},{'x':30000,'y':20000},{'x':30000,'y':45000},{'x':10000,'y':45000}]}
    if geographic:e.update(parcelRole='site',attributes={'pnu':PNU,'sourceCRS':'EPSG:5187','originMetres':[200000,400000]})
    return {'units':'mm','layers':[{'id':'site-layer','name':'A-SITE'}],'entities':[e],'zoning':copy.deepcopy(ZONE),'program':{'use':'근린생활시설','floors':4}}


def building():
    return {'id':'building','type':'rectangle','layer':'A-BLDG-L1','points':[{'x':12000,'y':22000},{'x':22000,'y':22000},{'x':22000,'y':32000},{'x':12000,'y':32000}]}


class PlanContextTest(unittest.TestCase):
    def setUp(self):
        self.enterContext(patch('urllib.request.urlopen',side_effect=AssertionError('production network forbidden')))

    def test_standard_site_id_layer_preserves_drawing_and_discloses_local_frame(self):
        doc=drawing();before=copy.deepcopy(doc)
        out=layout_context.prepare(doc,{})
        self.assertEqual(out['status'],'ready');self.assertEqual(doc,before)
        self.assertEqual(out['request']['site']['parcel'][0],[200000,400000])
        self.assertAlmostEqual(layout_context.area(out['request']['site']['parcel']),500)
        self.assertEqual(out['request']['program']['floors'],4)
        self.assertTrue(any(a['key']=='site.crs' for a in out['assumed']))
        site_plan_service.payload(out['request'],'generate')

    def test_aliases_rectangles_and_road_layers(self):
        for name in ('A-SITE','A-SITE-BND','A-SITE-BNDY'):
            doc=drawing();doc['layers'][0]['name']=name;doc['entities'][0]['type']='rectangle';doc['entities'][0].pop('closed')
            road=copy.deepcopy(building());road['layer']='A-ROAD';doc['entities'].append(road)
            out=site_plan_service.from_drawing(doc)
            self.assertEqual(len(out['site']['neighbors']),1);self.assertEqual(out['site']['neighbors'][0]['jimok'],'도')

    def test_imported_tags_win_over_extra_layer_outline(self):
        doc=drawing(True);extra=building();extra['layer']='A-SITE';doc['entities'].append(extra)
        self.assertEqual(site_plan_service.from_drawing(doc)['site']['parcel'],request()['site']['parcel'])

    def test_open_degenerate_and_multiple_boundaries_need_input(self):
        cases=[]
        doc=drawing();doc['entities'][0]['closed']=False;cases.append(doc)
        doc=drawing();doc['entities'][0]['points']=[{'x':0,'y':0},{'x':100,'y':0},{'x':200,'y':0}];cases.append(doc)
        doc=drawing();doc['entities'].append(copy.deepcopy(doc['entities'][0]));cases.append(doc)
        for doc in cases:
            out=layout_context.prepare(doc,{})
            self.assertEqual(out['status'],'needs_input');self.assertTrue(out['needs'][0]['question'])

    def test_unconfirmed_zoning_is_not_invented(self):
        doc=drawing();doc.pop('zoning')
        out=layout_context.prepare(doc,{})
        self.assertEqual(out['status'],'needs_input');self.assertIsNone(out['request']['zoning']['bcr'])
        self.assertEqual(out['needs'][0]['key'],'address')

    def test_partial_and_explicit_requests_preserve_priority(self):
        out=layout_context.prepare(drawing(),{'request':{'program':{'floors':6}},'program':{'floors':7}})
        self.assertEqual(out['request']['program']['floors'],7)
        original=request();out=layout_context.prepare(drawing(),{'request':original})
        self.assertEqual(out['request'],original);self.assertEqual(original,request())
        wrapped=layout_context.prepare({}, {'request':{'siteEngine':original}})
        self.assertEqual(wrapped['request'],original)

    def test_explicit_5179_objects_are_transformed_and_local_objects_are_mm(self):
        from pyproj import Transformer
        req=request();req['site']['crs']='EPSG:5179';req['site']['parcel']=[{'x':1140000,'y':1680000},{'x':1140020,'y':1680000},{'x':1140020,'y':1680025}]
        out=layout_context.prepare({}, {'request':req})
        expected=Transformer.from_crs('EPSG:5179','EPSG:5187',always_xy=True).transform(1140000,1680000)
        self.assertAlmostEqual(out['request']['site']['parcel'][0][0],expected[0]);self.assertEqual(out['request']['site']['crs'],'EPSG:5187')
        req['site'].pop('crs');req['site']['parcel']=[{'x':0,'y':0},{'x':20000,'y':0},{'x':20000,'y':25000}]
        out=layout_context.prepare({}, {'request':req})
        self.assertEqual(out['request']['site']['parcel'],[[200000,400000],[200020,400000],[200020,400025]])

    def test_neighbors_without_drawing_site_need_input(self):
        raw={'site':{'neighbors':[{'jimok':'도','coords':[[0,0],[1000,0],[0,1000]]}]}}
        out=layout_context.prepare({}, {'request':raw})
        self.assertEqual(out['status'],'needs_input')
        self.assertEqual(out['needs'][0]['key'],'address')

    def test_drawing_site_neighbors_use_same_mm_to_m_frame(self):
        raw={'site':{'neighbors':[{'jimok':'도','coords':[[10000,50000],[30000,50000],[30000,55000]]}]}}
        out=layout_context.prepare(drawing(),{'request':raw})
        self.assertEqual(out['status'],'ready')
        self.assertEqual(out['request']['site']['neighbors'][0]['coords'],
                         [[200000,400030],[200020,400030],[200020,400035]])

    def test_drawing_site_neighbors_keep_projected_crs_and_anchor(self):
        from pyproj import Transformer
        transform=Transformer.from_crs('EPSG:5179','EPSG:5187',always_xy=True)
        raw={'site':{'neighbors':[{'jimok':'도','coords':[[10000,50000],[30000,50000],[30000,55000]]}]}}
        for imported in (False,True):
            with self.subTest(imported=imported):
                doc=drawing()
                if imported:
                    doc['entities'][0]['attributes']={'sourceCRS':'EPSG:5179','originMetres':[1140000,1680000]}
                    anchor=[10000,20000]
                else:
                    doc['drawingGeo']={'crs':'EPSG:5179','originM':[1140000,1680000]};anchor=[0,0]
                before=copy.deepcopy(doc);out=layout_context.prepare(doc,{'request':raw})
                self.assertEqual(out['status'],'ready');self.assertEqual(out['request']['site']['crs'],'EPSG:5187')
                for actual,(x,y) in zip(out['request']['site']['neighbors'][0]['coords'],raw['site']['neighbors'][0]['coords']):
                    expected=transform.transform(1140000+(x-anchor[0])/1000,1680000+(y-anchor[1])/1000)
                    self.assertAlmostEqual(actual[0],expected[0]);self.assertAlmostEqual(actual[1],expected[1])
                self.assertEqual(doc,before)

    def test_invalid_drawing_site_neighbors_need_input(self):
        raw={'site':{'neighbors':[{'jimok':'도','coords':[[0,0],[1,1]]}]}}
        out=layout_context.prepare(drawing(),{'request':raw})
        self.assertEqual(out['status'],'needs_input')
        self.assertEqual(out['needs'][0]['key'],'site')

    def test_address_only_fetches_existing_adapter_and_enriches(self):
        fetched=drawing(True);fetched.pop('zoning');fetched['pnu']=PNU
        with patch.object(parcel_service,'search',return_value={'results':[{'pnu':PNU,'jibunAddress':'시험동 1'}]}) as search,patch.object(parcel_service,'fetch',return_value=fetched) as fetch,patch.object(miriboda_service,'enrich_drawing',return_value={'request':request()}) as enrich:
            out=layout_context.prepare({}, {'address':'시험동 1'})
        self.assertEqual(out['status'],'ready');search.assert_called_once_with('시험동 1')
        fetch.assert_called_once_with({'pnu':PNU,'crs':'EPSG:5187'});enrich.assert_called_once()
        self.assertEqual(out['request']['site']['id'],PNU)

    def test_ambiguous_address_does_not_pick_or_fetch(self):
        rows=[{'pnu':PNU,'jibunAddress':'동 1'},{'pnu':'9876543210987654321','jibunAddress':'동 2'}]
        with patch.object(parcel_service,'search',return_value={'results':rows}),patch.object(parcel_service,'fetch') as fetch:
            out=layout_context.prepare({}, {'address':'어느 동'})
        self.assertEqual(out['status'],'needs_input');self.assertEqual(len(out['needs'][0]['choices']),2);fetch.assert_not_called()

    def test_existing_boundary_is_preserved_when_address_provides_rules(self):
        doc=drawing();doc.pop('zoning');original=site_plan_service.from_drawing(doc)['site']['parcel']
        enriched=request();enriched['site']['parcel'][1][0]+=100
        with patch.object(parcel_service,'search',return_value={'results':[{'pnu':PNU}]}),patch.object(miriboda_service,'enrich_drawing',return_value={'request':enriched}):
            out=layout_context.prepare(doc,{'address':'시험동 1'})
        self.assertEqual(out['request']['site']['parcel'],original)

    def test_new_address_cannot_reuse_another_imported_parcel(self):
        with patch.object(parcel_service,'search',return_value={'results':[{'pnu':'9876543210987654321'}]}),patch.object(miriboda_service,'enrich_drawing') as enrich:
            out=layout_context.prepare(drawing(True),{'address':'다른 주소'})
        self.assertEqual(out['status'],'needs_input');enrich.assert_not_called()

    def test_current_building_produces_validation_overrides(self):
        doc=drawing();doc['entities'].append(building())
        out=layout_context.prepare(doc,{},mode='validate')
        self.assertEqual(out['status'],'ready');self.assertEqual(out['request']['overrides']['footprint'][0],[200002,400002])
        site_plan_service.payload(out['request'],'validate')

    def test_drawn_set_is_placed_on_site_for_engine_check(self):
        # 괴정 2026-10-30: 대지 위 외곽 없이 한 벌만 그렸더니 AI 설계 엔진이 빈 건물(면적 0·3층 가정)로 정북 일조를 못 봤다
        wall=lambda i,story,ring:[{'id':f'{story}{i}','kind':'wall','story':story,'thickness':200,'path':[ring[i],ring[(i+1)%len(ring)]]} for i in range(len(ring))]
        f1=[[0,0],[10000,0],[10000,10000],[0,10000]];f2=[[0,0],[10000,0],[10000,6000],[0,6000]]
        rail=[{'id':'r','kind':'wall','story':'2F','role':'railing','height':1200,'path':[[0,6000],[0,10000],[10000,10000],[10000,6000]]}]
        # 높이 없는 옥상 난간벽(parapet)·손스침 벽(handrail)도 도면 기준(areaSheet.excludeWallRoles)대로 뺀다
        rail+=[{'id':'p'+str(i),'kind':'wall','story':'rf','role':'parapet','path':w} for i,w in enumerate([[[0,0],[10000,0]],[[10000,0],[10000,6000]],[[10000,6000],[0,6000]],[[0,6000],[0,0]]])]+[{'id':'h','kind':'wall','story':'2F','role':'handrail','path':[[0,6000],[0,9000],[10000,9000],[10000,6000]]}]
        model={'stories':[{'id':'1F','elevation':0,'height':3300},{'id':'2F','elevation':3300,'height':3000},{'id':'rf','elevation':6300,'height':1000}],
               'elements':[w for i in range(4) for w in wall(i,'1F',f1)[i:i+1]]+[w for i in range(4) for w in wall(i,'2F',f2)[i:i+1]]+rail,
               'site':{'parcel':[[-2000,-2000],[18000,-2000],[18000,23000],[-2000,23000]]}}
        doc=drawing();doc['program']={'use':'근린생활시설'};doc['drawingSets']={'s1':{'kind':'set','model':model}}
        doc['entities'].append({**building(),'points':[{'x':x+90000,'y':y} for x,y in ((12000,22000),(22000,22000),(22000,32000),(12000,32000))]})   # 배치도 장 안 외곽(대지 밖)은 안 씀
        out=layout_context.prepare(doc,{},mode='validate')
        self.assertEqual(out['status'],'ready',out['needs']);g=out['request']['overrides']
        self.assertEqual(len(g['floors']),2);self.assertEqual(g['footprint'],g['floors'][0])
        self.assertEqual(sorted(map(lambda p:[round(v,3) for v in p],g['floors'][1])),[[200002,400002],[200002,400008],[200012,400002],[200012,400008]])
        self.assertEqual(out['request']['program']['floors'],2)
        site_plan_service.payload(out['request'],'validate')

    def test_cadastre_neighbors_are_mapped_into_design_mm(self):
        # 일조 보고서: 이웃 필지(다른 원점으로 받은 지적)를 EPSG m 로 거쳐 설계 mm 로 — 3D 그림자 칸을 필지별로 셀 수 있게
        doc=drawing(True);doc['entities'][0]['attributes']['insertionMm']=[10000,20000]
        doc['drawingSets']={'s':{'kind':'set','model':{'stories':[],'elements':[],'site':{'parcel':[[0,0],[20000,0],[20000,25000],[0,25000]]}}}}
        north={'type':'polyline','closed':True,'parcelRole':'neighbor','attributes':{'jibun':'1-2','originMetres':[200010,400025],'insertionMm':[0,0]},
               'points':[{'x':-10000,'y':0},{'x':10000,'y':0},{'x':10000,'y':8000},{'x':-10000,'y':8000}]}
        out=layout_context.set_neighbors(doc,doc['entities'][0],[north,{**north,'parcelRole':'road'}])
        self.assertEqual(out,[{'jibun':'1-2','coords':[[0,25000],[20000,25000],[20000,33000],[0,33000]]}])

    def test_engine_coverage_and_far_use_drawing_area(self):
        # 엔진은 발코니까지 바닥으로 세어 용적률이 도면 구적과 달랐다(괴정 182.68%) — 한 벌 구적 값으로, 한도 판정은 엔진 한도로
        doc={'drawingSets':{'s':{'kind':'set','model':{'stories':[],'elements':[]},'area':{'coverage':53.41,'far':172.5}}}}
        report={'checks':[{'rule':'건폐율','ok':True,'value':53.41,'limit':60},{'rule':'용적률','ok':True,'value':182.68,'limit':170},{'rule':'1F 건축가능영역 내','ok':True,'value':119}]}
        out=layout_context.use_set_area(report,doc)['checks']
        self.assertEqual((out[1]['value'],out[1]['engineValue'],out[1]['source'],out[1]['ok']),(172.5,182.68,'도면 구적',False))
        self.assertEqual(out[2]['value'],119)
        self.assertEqual(layout_context.use_set_area({'checks':[{'rule':'용적률','value':1}]},{})['checks'][0]['value'],1,'구적 없으면 그대로')

    def test_missing_building_needs_input_and_no_stale_geometry_used(self):
        out=layout_context.prepare(drawing(),{},mode='validate')
        self.assertIn('overrides',[n['key'] for n in out['needs']])
        doc=drawing();doc['sitePlan']={'geometry':result()['report']['geometry'],'bindings':[{'entityId':'gone','path':['footprint']}],'origin':{'x':200000,'y':400000},'offset':{'x':0,'y':0}}
        self.assertIsNone(layout_context.drawing_overrides(doc))

    def test_bound_plan_uses_current_vertices(self):
        doc=drawing();e=building();doc['entities'].append(e)
        doc['sitePlan']={'geometry':result()['report']['geometry'],'bindings':[{'entityId':'building','path':['footprint']}],'origin':{'x':200000,'y':400000},'offset':{'x':10000,'y':20000}}
        e['points'][0]['x']+=1000
        out=layout_context.drawing_overrides(doc)
        self.assertEqual(out['footprint'][0],[200003,400002])

    def test_real_attach_then_edited_plan_validation_and_guards(self):
        doc=drawing();doc.update(version=2,blocks=[])
        spec=layout_context.prepare(doc,{})['request'];raw=result()
        # Complete the renderer contract as in the existing v0.5.3 engine fixtures.
        raw['report']['sunlight']={'applies':False}
        raw['entities']={'crs':'EPSG:5187','units':'m','layers':{'A-SITE':{},'A-BLDG-L1':{},'A-TEXT':{}},'entities':[
            {'type':'LWPOLYLINE','closed':True,'layer':'A-SITE','points':spec['site']['parcel']},
            {'type':'LWPOLYLINE','closed':True,'layer':'A-BLDG-L1','points':raw['report']['geometry']['footprint']}]}
        code="import {attachSitePlan} from './site-plan.js';let s='';for await(const c of process.stdin)s+=c;const v=JSON.parse(s);process.stdout.write(JSON.stringify(attachSitePlan(v.doc,v.spec,v.raw)));"
        completed=subprocess.run(['node','--input-type=module','-e',code],input=json.dumps({'doc':doc,'spec':spec,'raw':raw}),cwd=Path(__file__).parent,text=True,encoding='utf8',capture_output=True,timeout=15,check=True)
        inserted=json.loads(completed.stdout);before=copy.deepcopy(inserted)
        out=layout_context.prepare(inserted,{},mode='validate')
        self.assertEqual(out['status'],'ready');self.assertEqual(inserted,before)
        self.assertEqual(len(site_plan_service.boundary_entities(inserted)),1)
        self.assertIn('land',[s['entityId'] for s in inserted['sitePlan']['sourceParcelGeometry']])
        binding=next(b for b in inserted['sitePlan']['bindings'] if b['path']==['footprint'])
        bound=next(e for e in inserted['entities'] if e['id']==binding['entityId'])
        bound['points'][0]['x']+=1000
        edited=layout_context.prepare(inserted,{},mode='validate')
        self.assertAlmostEqual(edited['request']['overrides']['footprint'][0][0],raw['report']['geometry']['footprint'][0][0]+1)
        # Hatch is a valid server-generated building footprint binding.
        bound['type']='hatch';bound.pop('closed',None)
        self.assertEqual(layout_context.prepare(inserted,{},mode='validate')['status'],'ready')
        duplicate=copy.deepcopy(bound);duplicate['id']='copied-building';inserted['entities'].append(duplicate)
        blocked=layout_context.prepare(inserted,{},mode='validate')
        self.assertEqual(blocked['status'],'needs_input');self.assertIn('복사',blocked['needs'][0]['question'])
        inserted=copy.deepcopy(before);inserted['entities'][0]['points'][0]['x']+=1000
        blocked=layout_context.prepare(inserted,{},mode='validate')
        self.assertEqual(blocked['status'],'needs_input');self.assertIn('원본 대지',blocked['needs'][0]['question'])
        inserted=copy.deepcopy(before);generated=next(e for e in inserted['entities'] if e['id']==inserted['sitePlan']['contextGeometry'][0]['entityId']);generated['points'][0]['y']+=1000
        self.assertIn('대지·주변',layout_context.prepare(inserted,{},mode='validate')['needs'][0]['question'])
        inserted=copy.deepcopy(before);inserted['sitePlan']['contract']={'revalidate':False}
        self.assertIn('지원하지',layout_context.prepare(inserted,{},mode='validate')['needs'][0]['question'])

    def test_grouped_cadastral_attach_and_validation_use_browser_snapshot_ids(self):
        doc=drawing(True);source=doc['entities'][0];doc['entities']=[{'id':'parcel-group','type':'block','parcelGroup':True,'name':'대지','entities':[source]}];doc.update(version=2,blocks=[])
        spec=layout_context.prepare(doc,{})['request'];raw=result();raw['report']['sunlight']={'applies':False}
        raw['entities']={'crs':'EPSG:5187','units':'m','layers':{'A-SITE':{},'A-BLDG-L1':{},'A-TEXT':{}},'entities':[
            {'type':'LWPOLYLINE','closed':True,'layer':'A-SITE','points':spec['site']['parcel']},
            {'type':'LWPOLYLINE','closed':True,'layer':'A-BLDG-L1','points':raw['report']['geometry']['footprint']}]}
        code="import {attachSitePlan} from './site-plan.js';let s='';for await(const c of process.stdin)s+=c;const v=JSON.parse(s);process.stdout.write(JSON.stringify(attachSitePlan(v.doc,v.spec,v.raw)));"
        completed=subprocess.run(['node','--input-type=module','-e',code],input=json.dumps({'doc':doc,'spec':spec,'raw':raw}),cwd=Path(__file__).parent,text=True,encoding='utf8',capture_output=True,timeout=15,check=True)
        inserted=json.loads(completed.stdout)
        self.assertEqual(inserted['sitePlan']['sourceParcelGeometry'][0]['entityId'],'parcel-group:land')
        self.assertEqual(layout_context.prepare(inserted,{},mode='validate')['status'],'ready')
        inserted['entities'][0]['entities'][0]['points'][0]['x']+=1000
        out=layout_context.prepare(inserted,{},mode='validate')
        self.assertEqual(out['status'],'needs_input');self.assertIn('원본 대지',out['needs'][0]['question'])

    def test_invalid_explicit_inputs_rejected(self):
        for raw in ([],None,{'unknown':True},{'site':{'crs':'EPSG:4326','parcel':[[0,0],[1,0],[1,1]]}}):
            with self.subTest(raw=raw),self.assertRaises(ValueError):layout_context.prepare({}, {'request':raw})


@patch('miri_account_service.require_ai_login',new=lambda:None)
class BridgePlanContextTest(unittest.TestCase):
    def setUp(self):
        self.enterContext(patch('urllib.request.urlopen',side_effect=AssertionError('production network forbidden')))
        self.session=str(uuid.uuid4());self.doc=drawing()
        with bridge.lock:
            bridge.clients.clear();bridge._parcel_contexts.clear();bridge.active=self.session
            bridge.clients[self.session]={'protocol_version':1,'document_generation':str(uuid.uuid4()),'snapshot_id':str(uuid.uuid4()),'revision':0,'document_revision':0,'document':self.doc,'seen':time.monotonic()}
        self.target=bridge.snapshot()['target']
        self.addCleanup(self.cleanup)

    def cleanup(self):
        with bridge.lock:bridge.clients.clear();bridge._parcel_contexts.clear();bridge.active=None
        with bridge._jobs_lock:bridge._jobs.clear()
        with bridge._layout_lock:bridge._layouts.clear()

    def test_suggest_and_validate_both_app_and_external_without_spec(self):
        self.doc['entities'].append(building())
        for app in (False,True):
            call=bridge.call_app if app else bridge.call
            with patch.object(plan_service,'suggest_site_engine',return_value=(result(),200)) as generate,patch.object(site_plan_service,'process',return_value=(result()['report'],200)) as validate:
                out=call('cad_suggest_layout',{})
                self.assertTrue(bridge.valid_uuid(out['layout_id']));self.assertFalse(out['needs'])
                out=call('cad_validate_layout',{})
                self.assertFalse(out['needs']);generate.assert_called_once();validate.assert_called_once()

    def test_needs_stops_before_server(self):
        self.doc.pop('zoning')
        with patch.object(plan_service,'suggest_site_engine') as generate:
            out=bridge.call('cad_suggest_layout',{})
        self.assertEqual(out['status'],'needs_input');generate.assert_not_called()

    def test_get_parcel_cache_is_document_scoped_and_does_not_mutate(self):
        self.doc['entities']=[];self.doc.pop('zoning')
        fetched=drawing(True);fetched['pnu']=PNU
        with patch.object(parcel_service,'fetch',return_value=fetched) as fetch,patch.object(miriboda_service,'enrich_drawing',return_value={'request':request()}):
            bridge.call('cad_get_parcel',{'pnu':PNU})
            out=bridge.call('cad_site_plan_from_drawing',{})
            self.assertEqual(out['status'],'ready');fetch.assert_called_once()
            self.assertEqual(self.doc['entities'],[])
            with bridge.lock:bridge.clients[self.session]['document_generation']=str(uuid.uuid4())
            out=bridge.call('cad_site_plan_from_drawing',{})
        self.assertEqual(out['status'],'needs_input')

    def test_lookup_finishing_after_document_switch_does_not_contaminate_new_document(self):
        def fetch(_):
            with bridge.lock:bridge.clients[self.session]['document_generation']=str(uuid.uuid4())
            value=drawing(True);value['pnu']=PNU;return value
        self.doc['entities']=[];self.doc.pop('zoning')
        with patch.object(parcel_service,'fetch',side_effect=fetch):bridge.call('cad_get_parcel',{'pnu':PNU})
        self.assertEqual(bridge.call('cad_site_plan_from_drawing',{})['status'],'needs_input')

    def test_search_result_reused_without_another_search(self):
        self.doc['entities']=[];self.doc.pop('zoning')
        with patch.object(parcel_service,'search',return_value={'results':[{'pnu':PNU}]}) as search,patch.object(parcel_service,'fetch',return_value=drawing(True)),patch.object(miriboda_service,'enrich_drawing',return_value={'request':request()}):
            bridge.call('cad_search_address',{'query':'시험 주소'})
            out=bridge.call('cad_site_plan_from_drawing',{})
        self.assertEqual(out['status'],'ready');search.assert_called_once()

    def test_facility_upper_use_needs_before_dispatch(self):
        knowledge=vault_gate.detail_groups(only={'access'})['access']
        self.doc['entities'].append(building())
        with patch.object(bridge,'dispatch') as dispatch:
            out=bridge.call('cad_access_plan',{'target':self.target,'facility':{'use':'공동주택'}})
        # 추천이 있는 질문은 미리가 묻지 않고 골라 진행하고(assumed), 추천이 없는 다음 질문에서 멈춘다(2026-10-30).
        picked=next(a for a in out['assumed'] if a['key']=='facility.use')
        self.assertEqual(picked['value'],'apartment');self.assertTrue(picked['auto'])
        self.assertEqual(out['needs'][0]['key'],'facility.areaM2');dispatch.assert_not_called()

    def test_validate_picks_the_building_outline_on_the_site(self):
        # 한 벌 배치도 장(도곽 안)에도 A-BLDG-L1 외곽이 있다 — 대지 위 외곽만 검사한다(2026-10-30)
        sq=lambda x,y,w:[{'x':x,'y':y},{'x':x+w,'y':y},{'x':x+w,'y':y+w},{'x':x,'y':y+w}]
        doc={'units':'mm','layers':[{'id':'b','name':'A-BLDG-L1'}],'entities':[
            {'type':'polyline','closed':True,'parcelRole':'site','points':sq(0,0,20000),'attributes':{'pnu':'1'*19,'ring':'outer','sourceCRS':'EPSG:5187','originMetres':[200000,400000],'insertionMm':[0,0]}},
            {'type':'polyline','closed':True,'layer':'b','points':sq(5000,5000,8000)},
            {'type':'polyline','closed':True,'layer':'b','points':sq(500000,0,80)}]}
        out=layout_context.drawing_overrides(doc)
        self.assertIsNotNone(out);xs=[p[0] for p in out['footprint']];self.assertAlmostEqual(max(xs)-min(xs),8,places=1)

    def test_program_floors_from_design_model(self):
        program={}
        layout_context.fill_program_from_model(program,{'stories':[{'id':'B1','elevation':-3000,'height':3000},*({'id':f'{i}F','elevation':0,'height':h} for i,h in enumerate((3100,3100,2900,3000),1))]})
        self.assertEqual(program,{'floors':4,'floor_h':3.02},'지하는 빼고 그려 둔 층으로')

    def test_unnamed_shop_is_assumed_retail_not_apartment(self):
        knowledge=vault_gate.detail_groups(only={'access'})['access']
        model={'stories':[{'id':'1F','elevation':0,'height':3100}],'elements':[{'kind':'space','story':'1F','name':'상가','use':'상가','outline':[[0,0],[9000,0],[9000,8000],[0,8000]]}]}
        out=access_context.prepare({'units':'mm','entities':[],'layers':[]},{'model':model},knowledge)
        self.assertEqual(out['needs'][0]['key'],'facility.use');self.assertEqual(out['needs'][0]['suggested'],'retail')

    def test_facility_use_and_area_from_room_names(self):
        knowledge=vault_gate.detail_groups(only={'access'})['access']
        model={'stories':[{'id':'1F','elevation':0,'height':3100}],'elements':[
            {'kind':'space','story':'1F','name':'소매점','outline':[[0,0],[10000,0],[10000,5000],[0,5000]]},
            {'kind':'space','story':'1F','name':'화장실','outline':[[0,5000],[2000,5000],[2000,7000],[0,7000]]}]}
        out=access_context.prepare({'units':'mm','entities':[],'layers':[]},{'facility':{'use':'근린생활시설 및 단독주택'},'model':model},knowledge)
        self.assertEqual(out['needs'][0]['key'],'facility.use');self.assertEqual(out['needs'][0]['suggested'],'retail')
        again=access_context.prepare({'units':'mm','entities':[],'layers':[]},{'facility':{'use':'retail'},'model':model},knowledge)
        self.assertEqual(again['needs'][0]['key'],'facility.areaM2');self.assertEqual(again['needs'][0]['suggested'],50.0)

    def test_facility_long_job_dispatches_once_and_filters_details(self):
        self.doc['entities'].append(building());event=threading.Event();seen=[]
        def dispatch(name,args):
            seen.append((name,args));event.wait(2);return {'applied':True}
        try:
            with patch.object(bridge,'dispatch',side_effect=dispatch),patch.object(bridge,'JOB_RESPONSE_SECONDS',.001):
                out=bridge.call('cad_access_plan',{'target':self.target,'facility':{'use':'아파트','units':30,'areaM2':100}})
                self.assertEqual(out['status'],'running');event.set()
                done=bridge.call('cad_get_job',{'job_id':out['job_id'],'wait_seconds':1})
            self.assertEqual(done['status'],'completed');self.assertTrue(done['result']['applied'])
            self.assertEqual(len(seen),1);sent=seen[0][1]['request']
            self.assertEqual(set(sent['details']),{'access'});self.assertEqual(sent['facility']['use'],'apartment')
            self.assertEqual(sent['facility']['areaM2'],100)
        finally:event.set()

    def test_login_required_for_all_plan_paths(self):
        from miri_account_service import AILoginRequired
        names=('cad_site_plan_from_drawing','cad_suggest_layout','cad_validate_layout','cad_insert_layout','cad_access_plan','cad_suggest_openings','cad_apply_openings','cad_check_daylight')
        with patch('miri_account_service.require_ai_login',side_effect=AILoginRequired('login')):
            for name in names:
                for call in (bridge.call,bridge.call_app):
                    with self.subTest(name=name,call=call),self.assertRaises(AILoginRequired):call(name,{})


class AccessContextTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):cls.knowledge=vault_gate.detail_groups(only={'access'})['access']

    def test_requires_use_only_when_missing_and_conditions_only_when_unknown(self):
        doc=drawing();doc['program']['use']='공동주택';doc['entities'].append(building())
        out=access_context.prepare(doc,{},self.knowledge)
        self.assertEqual(out['needs'][0]['key'],'facility.use')
        out=access_context.prepare(doc,{'facility':{'use':'연립주택'}},self.knowledge)
        self.assertIn('facility.units',[n['key'] for n in out['needs']])
        out=access_context.prepare(doc,{'facility':{'use':'다세대주택','units':10,'areaM2':100}},self.knowledge)
        self.assertFalse(out['needs']);self.assertEqual(out['facility']['use'],'multi-family')

    def test_multistorey_outline_cannot_stand_for_total_facility_area(self):
        doc=drawing();doc['entities'].append(building())
        out=access_context.prepare(doc,{'facility':{'use':'아파트'}},self.knowledge)
        self.assertIn('facility.areaM2',[n['key'] for n in out['needs']])
        doc['program'].update(use='아파트');doc['sitePlan']={'report':{'numbers':{'gfa':400}}}
        out=access_context.prepare(doc,{},self.knowledge)
        self.assertEqual(out['facility']['areaM2'],400);self.assertFalse(out['needs'])
        doc.pop('sitePlan');doc['program']['floors']=1
        out=access_context.prepare(doc,{},self.knowledge)
        self.assertEqual(out['facility']['areaM2'],100);self.assertTrue(any(a['key']=='facility.areaM2' for a in out['assumed']))

    def test_filtered_knowledge_matches_full_group(self):
        self.assertEqual(vault_gate.detail_groups(only={'access'}),{'access':vault_gate.detail_groups()['access']})
        with self.assertRaises(ValueError):vault_gate.detail_groups(only={'../access'})


if __name__=='__main__':unittest.main()
