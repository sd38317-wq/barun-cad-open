import unittest,tempfile,base64
from pathlib import Path
from ezdxf.addons import acadctb
from plot_style import parse
class PlotStyleTest(unittest.TestCase):
 def test_binary_ctb_roundtrip(self):
  table=acadctb.ColorDependentPlotStyles();table[2].color=(255,0,0);table[2].set_lineweight(.5);table[2].screen=50
  with tempfile.TemporaryDirectory() as folder:
   path=Path(folder)/'test.ctb';table.save(path);result=parse({'name':'test.ctb','data':base64.b64encode(path.read_bytes()).decode()})
  self.assertEqual(result['styles']['2']['color'],'#ff0000');self.assertEqual(result['styles']['2']['lineweight'],.5);self.assertEqual(result['styles']['2']['screen'],50)
 def test_invalid_ctb(self):
  with self.assertRaises(Exception):parse({'data':base64.b64encode(b'invalid').decode()})
if __name__=='__main__':unittest.main()
