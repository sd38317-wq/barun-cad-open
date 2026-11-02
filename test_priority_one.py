import unittest,io,ezdxf,tempfile
from pathlib import Path
import exchange
from exchange_test import standard_bytes
class PriorityOneTests(unittest.TestCase):
 def test_flipped_planar_ocs_preserves_world_geometry(self):
  d=ezdxf.new();d.units=4;m=d.modelspace()
  m.add_circle((100,200),30,dxfattribs={'extrusion':(0,0,-1)})
  m.add_lwpolyline([(10,20),(30,40)],dxfattribs={'extrusion':(0,0,-1)})
  result=exchange.import_file(standard_bytes(d),'.dxf');self.assertFalse(result['report']['skipped'])
  circle,line=result['document']['entities'];self.assertEqual(circle['center'],{'x':-100,'y':200});self.assertEqual(circle['radius'],30)
  self.assertEqual(line['points'],[{'x':-10,'y':20},{'x':-30,'y':40}]);self.assertEqual(sum(result['report']['converted'].values()),2)
 def test_nonplot_and_byblock_dxf_import(self):
  d=ezdxf.new();d.layers.new('GUIDE',dxfattribs={'plot':0});d.modelspace().add_line((0,0),(10,0),dxfattribs={'layer':'GUIDE','color':0})
  result=exchange.import_file(standard_bytes(d),'.dxf')['document'];self.assertFalse(next(l for l in result['layers'] if l['name']=='GUIDE')['plot']);self.assertEqual(result['entities'][0]['colorMode'],'byblock')
 def test_radius_diameter_and_both_angular_dimension_import_and_export(self):
  d=ezdxf.new(setup=True);d.units=4;m=d.modelspace()
  for dim in [m.add_radius_dim(center=(0,0),radius=500,angle=30),m.add_diameter_dim(center=(2000,0),radius=500,angle=30),m.add_angular_dim_3p(base=(500,500),center=(0,0),p1=(1000,0),p2=(0,1000)),m.add_angular_dim_2l(base=(500,500),line1=((0,0),(1000,0)),line2=((0,0),(0,1000))),m.add_ordinate_dim(feature_location=(1000,2000),offset=(500,300),dtype=0,origin=(100,200),rotation=30)]:dim.render()
  result=exchange.import_file(standard_bytes(d),'.dxf');self.assertFalse(result['report']['skipped']);es=result['document']['entities'];self.assertEqual([e['mode'] for e in es],['radius','diameter','angular','angular','ordinateY']);self.assertEqual(es[2]['points'][0],{'x':0.,'y':0.})
  raw,_=exchange.export_dxf(result['document']);restored=exchange.import_file(raw,'.dxf');self.assertEqual(restored['document'],result['document'])
  with tempfile.TemporaryDirectory() as tmp:
   path=Path(tmp)/'out.dxf';path.write_bytes(raw);foreign=ezdxf.readfile(path)
  del foreign.rootdict['BARUN_CAD_V2'];again=exchange.import_file(standard_bytes(foreign),'.dxf');self.assertFalse(again['report']['skipped'])
  for a,b in zip(es,again['document']['entities']):
   self.assertEqual(a['mode'],b['mode'])
   for p,q in zip(a['points'][:2],b['points'][:2]):
    self.assertAlmostEqual(p['x'],q['x'],places=6);self.assertAlmostEqual(p['y'],q['y'],places=6)
if __name__=='__main__':unittest.main()
