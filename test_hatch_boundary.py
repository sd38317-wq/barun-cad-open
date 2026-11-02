import unittest,copy,math
from hatch_service import boundary
import exchange
def line(a,b,i):return {'id':str(i),'type':'line','layer':'default','points':[dict(zip(('x','y'),a)),dict(zip(('x','y'),b))]}
def model():
 pts=[(0,0),(4000,0),(4000,3000),(0,3000)]
 return {'version':2,'blocks':[],'units':'mm','layers':[{'id':'default','name':'0','visible':True,'color':'#ffffff'}],'entities':[line(pts[i],pts[(i+1)%4],i) for i in range(4)]}
class HatchTest(unittest.TestCase):
 def test_lines_form_closed_face(self):
  r=boundary({'document':model(),'point':{'x':2000,'y':1500}});self.assertEqual(len(r['points']),4);self.assertEqual(r['loops'],[])
 def test_gap_and_outside_rejected(self):
  m=model();m['entities'].pop()
  for d,p in [(m,{'x':2000,'y':1500}),(model(),{'x':5000,'y':1500})]:
   with self.assertRaises(ValueError):boundary({'document':d,'point':p})
 def test_island_circle_and_hidden_boundary(self):
  m=model();m['entities'].append({'id':'island','type':'circle','layer':'default','center':{'x':2000,'y':1500},'radius':500})
  r=boundary({'document':m,'point':{'x':500,'y':500}});self.assertEqual(len(r['loops']),1)
  r=boundary({'document':m,'point':{'x':2000,'y':1500}});self.assertEqual(r['loops'],[]);self.assertGreater(len(r['points']),20)
  m['layers'][0]['visible']=False
  with self.assertRaises(ValueError):boundary({'document':m,'point':{'x':2000,'y':1500}})
 def test_cross_dxf_preserves_color_scale_and_angle(self):
  m=model();b=boundary({'document':m,'point':{'x':1000,'y':1000}});m['entities']=[{'id':'h','layer':'default','type':'hatch',**b,'pattern':'cross','spacing':250,'hatchScale':2.5,'angle':30,'color':'#ff0000','solid':False}]
  raw,_=exchange.export_dxf(m);d=exchange.import_file(raw,'.dxf',include_handles=True)['document'];e=d['entities'][0];self.assertEqual(e['pattern'],'cross');self.assertAlmostEqual(e['spacing'],250);self.assertEqual(e['color'],'#ff0000');self.assertAlmostEqual(e['angle'],30)
class HatchCodepageTest(unittest.TestCase):
 # A38(10-20 촬영): 한국 사무소 CP949 DXF(R12, $DWGCODEPAGE ANSI_949)에서 연 도면은 원본 판·코드페이지로 다시 내보내진다.
 # 해치 경계가 그 DXF 를 UTF-8 로만 읽어 한글 글자가 있으면 항상 실패했다.
 def test_cp949_dxf_drawing_hatches(self):
  t=['0','SECTION','2','HEADER','9','$ACADVER','1','AC1009','9','$DWGCODEPAGE','3','ANSI_949','9','$INSUNITS','70','4','0','ENDSEC',
     '0','SECTION','2','ENTITIES','0','POLYLINE','8','0','66','1','70','1']
  for x,y in ((0,0),(4000,0),(4000,3000),(0,3000)):t+=['0','VERTEX','8','0','10',str(x),'20',str(y)]
  t+=['0','SEQEND','8','0','0','TEXT','8','0','10','500','20','500','40','250','1','작은 방 평면','0','ENDSEC','0','EOF']
  doc=exchange.import_file('\r\n'.join(t).encode('cp949')+b'\r\n','.dxf')['document']
  r=boundary({'document':doc,'point':{'x':2000,'y':1500}});self.assertEqual(len(r['points']),4)
class HatchOriginTest(unittest.TestCase):
 def test_pattern_hatch_origin_round_trips_through_dxf(self):
  # HATCH O(원점): 표준 무늬 줄의 기준점이 원점이 되고, DXF 를 거쳐도 origin 으로 돌아온다.
  m=model();b=boundary({'document':m,'point':{'x':1000,'y':1000}})
  lines=[{'angle':45,'base':{'x':12,'y':34},'offset':{'x':-2.2450640303,'y':2.2450640303},'dashes':[]}]
  m['entities']=[{'id':'h','layer':'default','type':'hatch',**b,'pattern':'pattern','patternName':'ANSI31','patternScale':1,'patternLines':lines,'spacing':3.175,'angle':0,'origin':{'x':12,'y':34},'solid':False}]
  raw,_=exchange.export_dxf(m);e=exchange.import_file(raw,'.dxf')['document']['entities'][0]
  self.assertEqual(e['patternName'],'ANSI31');self.assertAlmostEqual(e['origin']['x'],12,6);self.assertAlmostEqual(e['origin']['y'],34,6)
class GapToleranceTest(unittest.TestCase):
 def gapped(self,gap=30):
  # 오른쪽 아래 모서리에서 아래 변이 gap 만큼 모자란 사각형
  m=model();m['entities'][0]['points'][1]={'x':4000-gap,'y':0};return m
 def test_default_zero_keeps_gap_open(self):
  with self.assertRaises(ValueError) as e:boundary({'document':self.gapped(),'point':{'x':2000,'y':1500}})
  self.assertIn('간격 허용',str(e.exception))
 def test_gap_within_tolerance_is_closed(self):
  r=boundary({'document':self.gapped(),'point':{'x':2000,'y':1500},'gapTolerance':50})
  from shapely.geometry import Polygon
  self.assertAlmostEqual(Polygon([(p['x'],p['y']) for p in r['points']]).area,4000*3000,delta=4000*3000*.001)
 def test_gap_larger_than_tolerance_stays_open(self):
  with self.assertRaises(ValueError):boundary({'document':self.gapped(80),'point':{'x':2000,'y':1500},'gapTolerance':50})
 def test_nearly_closed_polyline(self):
  m=model();m['entities']=[{'id':'p','type':'polyline','layer':'default','closed':False,'points':[{'x':0,'y':0},{'x':1000,'y':0},{'x':1000,'y':1000},{'x':0,'y':1000},{'x':0,'y':20}]}]
  with self.assertRaises(ValueError):boundary({'document':m,'point':{'x':500,'y':500}})
  r=boundary({'document':m,'point':{'x':500,'y':500},'gapTolerance':25});self.assertGreaterEqual(len(r['points']),4)
 def test_closed_drawing_unchanged_and_bad_values_rejected(self):
  a=boundary({'document':model(),'point':{'x':2000,'y':1500}});b=boundary({'document':model(),'point':{'x':2000,'y':1500},'gapTolerance':100})
  self.assertEqual(sorted((p['x'],p['y']) for p in a['points']),sorted((p['x'],p['y']) for p in b['points']))
  for bad in (-1,'abc',99999,float('nan')):
   with self.assertRaises(ValueError):boundary({'document':model(),'point':{'x':2000,'y':1500},'gapTolerance':bad})
if __name__=='__main__':unittest.main()
