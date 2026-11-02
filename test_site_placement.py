import copy,math,tempfile,time,unittest,uuid
from pathlib import Path
from unittest.mock import patch
import ezdxf
import bridge,site_placement
from site_placement import Rigid

# 지적 대지(도면 mm) — 돌려도 같은 모양이 아닌 오각형
SITE=[(200000,400000),(216000,401500),(218500,414000),(207000,419000),(199000,411000)]
L_SHAPE=[(203000,404000),(213000,404000),(213000,410000),(209000,410000),(209000,414000),(203000,414000)]
RECT=[(203000,404000),(213000,404000),(213000,412000),(203000,412000)]
TO_SITE=Rigid(23,-150000,80000)   # 원본 배치도 → 지적


def plan_dxf(folder,building,name='plan.dxf'):
    """원본 배치도: 지적 대지·건물을 TO_SITE 의 거꾸로 옮겨 그린 것 + 도곽·주차칸(헷갈리게)."""
    back=TO_SITE.inverse();doc=ezdxf.new();msp=doc.modelspace()
    msp.add_lwpolyline([back(p) for p in SITE],close=True,dxfattribs={'layer':'SITE-1'})
    msp.add_lwpolyline([back(p) for p in building],close=True,dxfattribs={'layer':'ELE-4'})
    a=back((214000,405000));msp.add_lwpolyline([a,(a[0]+2500,a[1]),(a[0]+2500,a[1]+5000),(a[0],a[1]+5000)],close=True,dxfattribs={'layer':'0'})
    xs,ys=zip(*[back(p) for p in SITE]);msp.add_lwpolyline([(min(xs)-9000,min(ys)-9000),(max(xs)+9000,min(ys)-9000),(max(xs)+9000,max(ys)+9000),(min(xs)-9000,max(ys)+9000)],close=True,dxfattribs={'layer':'SHEET'})
    path=Path(folder)/name;doc.saveas(path);return str(path)


def model_for(loop,to_site):
    """설계: 1층 바깥 벽 = loop 를 to_site 의 거꾸로(설계 좌표), 안쪽 벽 하나, 2층은 다른 모양."""
    back=to_site.inverse();pts=[list(back(p)) for p in loop]
    mid=[[(pts[0][0]+pts[1][0])/2,(pts[0][1]+pts[1][1])/2],[(pts[-1][0]+pts[-2][0])/2,(pts[-1][1]+pts[-2][1])/2]]
    return {'stories':[{'id':'2F','elevation':3300},{'id':'1F','elevation':0}],
            'elements':[{'kind':'wall','story':'1F','exterior':True,'thickness':200,'path':pts+[pts[0]]},
                        {'kind':'wall','story':'1F','thickness':100,'path':mid},
                        {'kind':'wall','story':'2F','exterior':True,'path':[[0,0],[3000,0],[3000,3000],[0,3000],[0,0]]}]}


class SitePlacementTest(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)

    def check(self,result,to_model_site):
        expected=[to_model_site.inverse()(p) for p in SITE]
        for got,want in zip(result['parcel'],expected):self.assertLess(math.dist(got,want),1.0,result['parcel'])
        self.assertAlmostEqual(result['fit']['lot']['iou'],1,places=3)
        self.assertGreater(result['fit']['building']['iou'],0.999)
        self.assertAlmostEqual(_wrap(result['rotationDeg']-to_model_site.deg),0,places=2)
        self.assertEqual(result['needs'],[])

    def test_rotated_shifted_plan_maps_site_into_model_coordinates(self):
        to_model_site=Rigid(113,170000,350000)
        result=site_placement.place(plan_dxf(self.tmp.name,L_SHAPE),model_for(L_SHAPE,to_model_site),SITE,[0,1])
        self.check(result,to_model_site)
        self.assertEqual(result['fit']['building']['story'],'1F')
        # 이격: 건물(대지 좌표 L 자)에서 대지 각 변까지
        self.assertEqual(len(result['setbacks']),5)
        self.assertAlmostEqual(result['minSetbackM'],min(s['setbackM'] for s in result['setbacks']))
        self.assertEqual(result['minSetbackM'],0.71)   # L 자 왼쪽 위 모서리(203000,414000) ↔ 북서 변: 1000/√2 mm
        # 정북 사선 검사용 지적 위 1층 외곽 = 대지 좌표의 L 자
        from shapely.geometry import Polygon
        self.assertGreater(Polygon(result['footprint']).intersection(Polygon(L_SHAPE)).area/Polygon(L_SHAPE).area,0.999)
        # 북쪽: 지적의 위(0,1)를 설계 좌표로 — 설계는 대지보다 113° 덜 돌아 있다
        v=result['north']['vector'];self.assertAlmostEqual(math.degrees(math.atan2(v[1],v[0])),90-113,places=3)

    def test_context_roads_neighbors_ledger_come_back_in_model_coordinates(self):
        # 배치도에 그릴 둘레(2026-10-30 괴정 배치도에 도로·지번·대장 면적이 없던 것): 대지에 닿은 도로·이웃만, 설계 좌표로
        to_model_site=Rigid(113,170000,350000);back=to_model_site.inverse()
        road=[(200000,400000),(216000,401500),(216000,395500),(200000,394000)]
        near=[(216000,401500),(225000,402000),(225000,413000),(218500,414000)];far=[(300000,300000),(310000,300000),(310000,310000)]
        context={'parcels':[{'role':'road','coords':road,'jibun':'12-3도'},{'role':'neighbor','coords':near,'jibun':'12-4'},{'role':'neighbor','coords':far,'jibun':'99'}],
                 'jibun':'12-1·12-2','ledgerAreaM2':222,'zone':'제2종일반주거지역'}
        result=site_placement.place(plan_dxf(self.tmp.name,L_SHAPE),model_for(L_SHAPE,to_model_site),SITE,[0,1],context)
        site=result['modelSite']
        self.assertEqual(site['parcel'],result['parcel'])
        self.assertEqual((site['jibun'],site['ledgerAreaM2'],site['zone']),('12-1·12-2',222,'제2종일반주거지역'))
        self.assertEqual([n['jibun'] for n in site['neighbors']],['12-4'],'닿지 않은 필지는 뺀다')
        self.assertEqual(len(site['roads']),1);r=site['roads'][0]
        self.assertEqual(r['name'],'12-3도');self.assertAlmostEqual(r['width'],5970,delta=60)
        for got,p in zip(r['coords'],road):self.assertLess(math.dist(got,back(p)),1.0)
        # 방위표 각(반시계 +): 설계 좌표 북쪽 벡터 = (-sin a, cos a)
        a=math.radians(site['northAngle']);v=result['north']['vector'];self.assertLess(math.dist((-math.sin(a),math.cos(a)),v),0.02)
        self.assertFalse(any('대장' in x for x in result['assumed']))

    def test_symmetric_building_keeps_original_plan_direction(self):
        # 직사각형은 180° 돌려도 같다 — 원본 배치도와 같은 방향(23°)으로 평면을 그렸다고 본다
        to_model_site=Rigid(23,9000,-4000)
        result=site_placement.place(plan_dxf(self.tmp.name,RECT),model_for(RECT,to_model_site),SITE)
        self.check(result,to_model_site)
        self.assertTrue(any('앞뒤' in a for a in result['assumed']))

    def test_poor_fit_returns_question_instead_of_silence(self):
        to_model_site=Rigid(0,0,0)
        tiny=[(203000,404000),(206000,404000),(206000,406000),(203000,406000)]
        result=site_placement.place(plan_dxf(self.tmp.name,L_SHAPE),model_for(tiny,to_model_site),SITE)
        self.assertLess(result['fit']['building']['iou'],0.85)
        self.assertEqual(result['needs'][0]['key'],'building')


def _wrap(d):return (d+180)%360-180


@patch('miri_account_service.require_ai_login', new=lambda: None)
class BridgePlaceTest(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
        self.addCleanup(self.clear);self.clear()

    def clear(self):
        with bridge.lock:bridge.clients.clear();bridge.queue.clear();bridge.results.clear();bridge.pending_requests.clear();bridge.active=None

    def test_tool_reads_site_and_set_from_current_drawing(self):
        to_model_site=Rigid(113,170000,350000)
        attrs={'northVector':[0,1],'jibun':'12-1 외 1필지','siteJibuns':['12-1','12-2'],'ledgerAreaM2':222,'landInfo':{'zones':[{'name':'도로','relation':'접함'},{'name':'제2종일반주거지역','relation':'포함'}]}}
        road=[(200000,400000),(216000,401500),(216000,395500),(200000,394000)]
        doc={'entities':[{'id':'s','type':'polyline','closed':True,'parcelRole':'site','points':[{'x':x,'y':y} for x,y in SITE],'attributes':attrs},
                         {'id':'r','type':'polyline','closed':True,'parcelRole':'road','points':[{'x':x,'y':y} for x,y in road],'attributes':{'jibun':'12-3도','ring':'outer'}}],
             'drawingSets':{'set-1':{'kind':'set','model':model_for(L_SHAPE,to_model_site)}}}
        session=str(uuid.uuid4())
        with bridge.lock:
            bridge.clients[session]={'protocol_version':1,'document_generation':str(uuid.uuid4()),'snapshot_id':str(uuid.uuid4()),'revision':0,'document_revision':0,'document':copy.deepcopy(doc),'seen':time.monotonic()}
            bridge.active=session
        tool=next(t for t in bridge.TOOLS if t['name']=='cad_place_from_site_plan')
        self.assertNotIn('cad_place_from_site_plan',bridge.MUTATING_TOOLS)
        self.assertIn('cad_place_from_site_plan',{t['name'] for t in bridge.app_tools(False)})
        self.assertEqual(tool['inputSchema']['required'],['sitePlanPath'])
        out=bridge._call('cad_place_from_site_plan',{'sitePlanPath':plan_dxf(self.tmp.name,L_SHAPE)})
        for got,p in zip(out['parcel'],SITE):self.assertLess(math.dist(got,to_model_site.inverse()(p)),1.0)
        self.assertIn('set-1',out['next'])
        self.assertIn('modelSite',out['next'])
        site=out['modelSite'];self.assertEqual((site['jibun'],site['ledgerAreaM2'],site['zone']),('12-1·12-2',222,'제2종일반주거지역'))
        self.assertEqual([r['name'] for r in site['roads']],['12-3도'])
        with self.assertRaisesRegex(ValueError,'PDF 또는 DXF'):bridge._call('cad_place_from_site_plan',{'sitePlanPath':'/x/plan.dwg'})


if __name__=='__main__':unittest.main()
