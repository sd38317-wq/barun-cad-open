import unittest,tempfile,ezdxf
from pathlib import Path
import exchange,project
from exchange_test import standard_bytes
class PriorityTwoTests(unittest.TestCase):
 def test_native_inverse_dxf_without_metadata(self):
  d=ezdxf.new();d.units=4;b=d.blocks.new('test');b.add_line((-100,0),(100,0));ref=d.modelspace().add_blockref('test',(0,0))
  from ezdxf.xclip import XClip
  c=XClip(ref);c.set_wcs_clipping_path([(-50,-50),(50,-50),(0,50)]);c.invert_clipping_path(ignore_acad_compatibility=True)
  imported=exchange.import_file(standard_bytes(d),'.dxf');self.assertTrue(imported['document']['entities'][0]['clip']['inverted'])
  raw,_=exchange.export_dxf(imported['document'])
  with tempfile.TemporaryDirectory() as folder:
   f=Path(folder)/'test.dxf';f.write_bytes(raw);d=ezdxf.readfile(f)
  self.assertGreater(len(d.modelspace()),1)
  for ref in d.modelspace():self.assertFalse(XClip(ref).is_inverted_clip)
  del d.rootdict['BARUN_CAD_V2'];again=exchange.import_file(standard_bytes(d),'.dxf');self.assertFalse(again['report']['skipped'])
 def test_relative_reference_resolves_after_project_move(self):
  with tempfile.TemporaryDirectory() as folder:
   base=Path(folder).resolve();(base/'project').mkdir();(base/'refs').mkdir();(base/'refs'/'a.dxf').touch()
   self.assertEqual(project.target('../refs','a.dxf',str(base/'project')),base/'refs'/'a.dxf')
   with self.assertRaises(ValueError):project.target('../refs','../a.dxf',str(base/'project'))
