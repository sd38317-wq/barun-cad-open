"""Execute the shipped 23-file set together and check results, not only exit codes."""
import copy,json,tempfile,time,unittest,base64
from pathlib import Path
from unittest import mock
import lisp_service as l

@unittest.skipUnless(l.exchange.autocad_console(),'AutoCAD required')
class ArchitecturePackTest(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.old=l.ROOT;l.ROOT=Path(self.tmp.name)
  self.files=l.process({'action':'install_architecture'})['files']
  self.cases={c['command']:c for c in json.loads(Path('test-fixtures/architecture-lisp-cases.json').read_text(encoding='utf8'))}
 def tearDown(self):l.ROOT=self.old;self.tmp.cleanup()
 def run_case(self,command,inputs=None,model=None,selected=None,failed=False):
  c=self.cases[command];j=l.process({'action':'start','files':[f['id'] for f in self.files],'expression':f'(progn (setvar "TEXTSIZE" 200) (C:{command}))','inputs':c['inputs'] if inputs is None else inputs,'document':model or copy.deepcopy(c['before']),'selected':selected or []})
  for _ in range(400):
   time.sleep(.1);r=l.process({'action':'poll','id':j['id']})
   if r['state']!='running':break
  if r['state']=='running':l.process({'action':'cancel','id':j['id']})
  self.assertEqual(r['state'],'failed' if failed else 'completed',command+' '+r.get('error','')+'\n'+r.get('log','')[-2000:])
  if failed:self.assertNotIn('result',r);return r
  self.assertFalse(r['result']['skipped'],command)
  return r
 def test_all_23_with_actual_geometry(self):
  self.assertEqual(len(self.files),23)
  for cmd in self.cases:
   with self.subTest(command=cmd):
    r=self.run_case(cmd);d=r['result']['document'];es=d['entities'];texts='\n'.join(e.get('text','') for e in es)
    original_ids={e['id'] for e in self.cases[cmd]['before']['entities']};names={l['id']:l['name'] for l in d['layers']}
    for e in es:
     if e['id'] not in original_ids:
      self.assertNotEqual(e['type'],'block',cmd);self.assertTrue(names[e['layer']].startswith(('A-','LISP-')),cmd);self.assertNotIn('\n',e.get('text',''),cmd)
    if cmd in ('LAYSTD','LAYCMD'):self.assertEqual(len(d['layers']),18)
    elif cmd in ('PWALL','WALL2'):self.assertEqual(len(es),3)
    elif cmd=='WALLTRIM':self.assertEqual(sum(e['points'][0]['x']==2000 for e in es),3)
    elif cmd=='GRID':self.assertEqual(len(es),6);self.assertEqual(max(p['y'] for e in es for p in e['points']),8000)
    elif cmd=='COL2':self.assertEqual(es[0]['points'][0],{'x':800,'y':700})
    elif cmd=='DOOR2':
     a=next(e for e in es if e['type']=='arc');self.assertEqual(a['radius'],900);self.assertEqual(a['center']['x'],1550);self.assertAlmostEqual(a['endAngle']-a['startAngle'],90)
    elif cmd=='WIND':self.assertEqual(len(es),4);self.assertAlmostEqual(es[0]['points'][1]['x'],1100)
    elif cmd in ('ROOM2','AREA2'):self.assertIn('12㎡',texts);self.assertIn('3.63평',texts)
    elif cmd=='AREATABLE':self.assertIn('【면적표】\n거실 12.00',texts)
    elif cmd=='NUM':self.assertEqual(texts,'A-1\nA-2')
    elif cmd=='TAG':self.assertEqual(texts,'문 D1')
    elif cmd=='PJ2':self.assertEqual(len(es),1);self.assertEqual(len(es[0]['points']),3)
    elif cmd=='PC2':self.assertTrue(es[0]['closed'])
    elif cmd=='LEN2':self.assertIn('합계 4000',r['log'])
    elif cmd=='TALIGN2':self.assertTrue(all(e['position']['x']==500 for e in es))
    elif cmd=='TFIND':self.assertEqual(texts,'바꿈바꿈\nbar바꿈')
    elif cmd=='BLKCNT':self.assertIn('UNIT  2개',texts);self.assertNotIn('UNIT_',texts)
    elif cmd=='DIMCLEAN2':
     self.assertEqual(r['result']['counts']['changed'],1);self.assertTrue(all(e['points'][:2]==self.cases[cmd]['before']['entities'][0]['points'][:2] for e in es));self.assertGreaterEqual(abs(es[0]['points'][2]['y']-es[1]['points'][2]['y']),150)
    elif cmd=='TITLE2':self.assertTrue(any(e.get('closed') for e in es));self.assertIn('테스트 도면',texts)
    elif cmd=='DXFOUT2':self.assertGreater(len(base64.b64decode(r['result']['data'])),1000)
 def test_options_and_rejection(self):
  r=self.run_case('AREA2','점\n시험실\n0,0\n4000,0\n4000,3000\n0,3000\n<Enter>\n5000,0');self.assertIn('12㎡',r['result']['document']['entities'][-1]['text'])
  r=self.run_case('DOOR2','900\n선택\n2000,0\n오른쪽',selected=['wall']);a=next(e for e in r['result']['document']['entities'] if e['type']=='arc');self.assertEqual(a['center']['x'],2450);self.assertAlmostEqual(a['endAngle']-a['startAngle'],90)
  r=self.run_case('WIND','1800\n40\n1000,0\n2000,0');self.assertEqual(r['result']['counts']['added'],3)
  self.run_case('DOOR2','900\n마지막\n10,0\n왼쪽',failed=True)
  m=copy.deepcopy(self.cases['ROOM2']['before']);m['entities'].pop();self.run_case('ROOM2',model=m,failed=True)
  r=self.run_case('LEN2','_ALL\n<Enter>\n예\n0,2000');self.assertEqual(r['result']['document']['entities'][-1]['text'],'4000mm')
  r=self.run_case('TALIGN2','_ALL\n<Enter>\nY\n0,500');self.assertTrue(all(e['position']['y']==500 for e in r['result']['document']['entities']))
  r=self.run_case('LAYSTD');m=r['result']['document'];r=self.run_case('LAYCMD','끄기',model=m);self.assertFalse(next(x for x in r['result']['document']['layers'] if x['name']=='A-FURN')['visible'])
  r=self.run_case('LAYCMD','켜기',model=r['result']['document']);self.assertTrue(all(x['visible'] for x in r['result']['document']['layers']))

class RoomBoundaryTest(unittest.TestCase):
 def test_room_walls_close_openings_ignore_swing_glazing_and_stairs(self):
  from shapely.geometry import Point
  import io,ezdxf,lisp_architecture as a
  d=ezdxf.new();m=d.modelspace()
  for name in ('A-WALL-CONC','A-DOOR','A-GLAZ','A-STAIR','A-WALL-C','A-AREA'):d.layers.new(name)
  def line(p,q,layer='A-WALL-CONC'):m.add_line(p,q,dxfattribs={'layer':layer})
  # 200mm 벽 두 실: 순면적 3.4 x 4.35m. 문과 창은 두 벽면 모두 끊겨 있다.
  for x in (-200,0,3400,3600,7000,7200):
   if x in (3400,3600):
    line((x,0),(x,1000));line((x,1990),(x,4350))
   else:line((x,-200),(x,4550))
  for y in (-200,0,4350,4550):
   if y>=4350:
    line((-200,y),(1000,y));line((2200,y),(7200,y))
   else:line((-200,y),(7200,y))
  for y in (1000,1990):line((3400,y),(3600,y))
  m.add_arc((3500,1045),900,0,90,dxfattribs={'layer':'A-DOOR'})
  line((3500,1045),(2600,1045),'A-DOOR')
  line((1000,4450),(2200,4450),'A-GLAZ')
  for y in (500,800,1100):line((0,y),(3400,y),'A-STAIR')
  m.add_lwpolyline([(500,500),(1500,500),(1500,1500),(500,1500)],close=True,dxfattribs={'layer':'A-AREA'})
  line((1700,0),(1700,4350),'A-WALL-C')
  f=io.StringIO();d.write(f);raw=f.getvalue().encode()
  with mock.patch.object(l.exchange,'export_dxf',return_value=(raw,{})), mock.patch('miri_account_service.capture_ai_epoch',return_value=1), mock.patch('miri_account_service.validate_ai_epoch'):
   context=l.process({'action':'context','document':{}})
  from shapely.geometry import Polygon
  regions=[Polygon(r['ring'],r['holes']) for r in context['regions']]
  # 일반 BOUNDARY에는 계단이 남고, ROOM2 전용 br:rooms에는 들어오지 않는다.
  self.assertTrue(any(p.contains(Point(700,600)) and p.area<14e6 for p in regions))
  self.assertIn('14790000.000000000',context['rooms'])
  for pt in ((1700,2000),(5300,2000)):
   rooms=a.boundary_polygons(raw,room=True)
   found=min((p for p in rooms if p.contains(Point(pt))),key=lambda p:p.area)
   self.assertAlmostEqual(found.area,3400*4350,delta=3400*4350*.01)
 def test_room_does_not_close_unmarked_wall_gap(self):
  import io,ezdxf,lisp_architecture as a
  d=ezdxf.new();d.layers.new('A-WALL-CONC');m=d.modelspace()
  for p,q in [((0,0),(4000,0)),((4000,0),(4000,3000)),((4000,3000),(0,3000)),((0,3000),(0,2000)),((0,1000),(0,0))]:m.add_line(p,q,dxfattribs={'layer':'A-WALL-CONC'})
  f=io.StringIO();d.write(f)
  self.assertEqual(a.boundary_polygons(f.getvalue().encode(),room=True),[])

 def test_room_keeps_legacy_boundaries_with_standard_wall(self):
  import io,ezdxf,lisp_architecture as a
  for legacy in ('0','WALL'):
   with self.subTest(layer=legacy):
    d=ezdxf.new();d.layers.new('A-WALL')
    if legacy!='0':d.layers.new(legacy)
    pts=[(0,0),(4000,0),(4000,3000),(0,3000),(0,0)]
    for i,(p,q) in enumerate(zip(pts,pts[1:])):d.modelspace().add_line(p,q,dxfattribs={'layer':'A-WALL' if i==0 else legacy})
    f=io.StringIO();d.write(f);rooms=a.boundary_polygons(f.getvalue().encode(),room=True)
    self.assertEqual(len(rooms),1);self.assertAlmostEqual(rooms[0].area,12e6)
 def test_room_keeps_column_face_boundary(self):
  import io,ezdxf,lisp_architecture as a
  d=ezdxf.new();d.layers.new('A-WALL-CONC');d.layers.new('A-COL');m=d.modelspace()
  pts=[(0,0),(4000,0),(4000,2500),(4000,3000),(3500,3000),(0,3000),(0,0)]
  for i,(p,q) in enumerate(zip(pts,pts[1:])):m.add_line(p,q,dxfattribs={'layer':'A-COL' if i in (2,3) else 'A-WALL-CONC'})
  f=io.StringIO();d.write(f);rooms=a.boundary_polygons(f.getvalue().encode(),room=True)
  self.assertEqual(len(rooms),1);self.assertAlmostEqual(rooms[0].area,12e6)
 def test_room_closes_opening_between_mixed_layer_walls(self):
  import io,ezdxf,lisp_architecture as a
  d=ezdxf.new();d.layers.new('A-WALL-CONC');d.layers.new('A-DOOR');m=d.modelspace()
  edges=[((0,0),(1000,0)),((2000,0),(4000,0)),((4000,0),(4000,3000)),((4000,3000),(0,3000)),((0,3000),(0,0))]
  for i,(p,q) in enumerate(edges):m.add_line(p,q,dxfattribs={'layer':'A-WALL-CONC' if i==0 else '0'})
  m.add_arc((1000,0),1000,0,90,dxfattribs={'layer':'A-DOOR'})
  f=io.StringIO();d.write(f);rooms=a.boundary_polygons(f.getvalue().encode(),room=True)
  self.assertEqual(len(rooms),1);self.assertAlmostEqual(rooms[0].area,12e6)
 def test_room_closes_openings_on_symbol_sublayers(self):
  import io,ezdxf,lisp_architecture as a
  # 외부 도면의 기존 하위 레이어를 읽는 시험이며 생성 명령에 새 레이어를 추가하지 않는다.
  for symbol in ('A-DOOR-EXISTING','A-GLAZ-EXISTING'):
   with self.subTest(layer=symbol):
    d=ezdxf.new();d.layers.new('A-WALL-CONC');d.layers.new(symbol);m=d.modelspace()
    for p,q in [((0,0),(1000,0)),((2000,0),(4000,0)),((4000,0),(4000,3000)),((4000,3000),(0,3000)),((0,3000),(0,0))]:m.add_line(p,q,dxfattribs={'layer':'A-WALL-CONC'})
    if symbol.startswith('A-DOOR'):m.add_arc((1000,0),1000,0,90,dxfattribs={'layer':symbol})
    else:m.add_line((1000,0),(2000,0),dxfattribs={'layer':symbol})
    f=io.StringIO();d.write(f);rooms=a.boundary_polygons(f.getvalue().encode(),room=True)
    self.assertEqual(len(rooms),1);self.assertAlmostEqual(rooms[0].area,12e6)

 def test_room_ignores_standard_non_boundary_lines(self):
  import io,ezdxf,lisp_architecture as a
  for layer in ('A-GRID','A-CNTR','A-FURN','A-PARK','A-SITE'):
   with self.subTest(layer=layer):
    d=ezdxf.new();d.layers.new('A-WALL');d.layers.new(layer);m=d.modelspace()
    m.add_lwpolyline([(0,0),(4000,0),(4000,3000),(0,3000)],close=True,dxfattribs={'layer':'A-WALL'})
    m.add_line((2000,-500),(2000,3500),dxfattribs={'layer':layer})
    f=io.StringIO();d.write(f);rooms=a.boundary_polygons(f.getvalue().encode(),room=True)
    self.assertEqual(len(rooms),1);self.assertAlmostEqual(rooms[0].area,12e6)

if __name__=='__main__':unittest.main()
