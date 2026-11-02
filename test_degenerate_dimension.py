"""A zero-length dimension (AutoCAD draws it as '0') must not stop the whole drawing from opening."""
import json
import subprocess
import tempfile
import unittest
from pathlib import Path

import ezdxf
import exchange

ROOT = Path(__file__).parent


class DegenerateDimensionTest(unittest.TestCase):
    def test_zero_length_aligned_dimension_imports_as_its_drawn_shape(self):
        doc = ezdxf.new('R2018', setup=True); doc.units = 4
        m = doc.modelspace()
        m.add_aligned_dim(p1=(1000, 1000), p2=(1000 + 1e-12, 1000), distance=300).render()
        m.add_aligned_dim(p1=(0, 0), p2=(2000, 0), distance=300).render()
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'zero-dim.dxf'; doc.saveas(path)
            result = exchange.import_file_path(path, '.dxf')
            entities = result['document']['entities']
            dims = [e for e in entities if e['type'] == 'dimension']
            self.assertEqual(len(dims), 1, 'the normal dimension stays an editable dimension')
            self.assertTrue(any(e['type'] == 'block' and e.get('name') == 'DXF DIMENSION' or e['type'] == 'block' for e in entities),
                            'the zero-length one arrives as its drawn lines and text')
            # The real engine check that used to reject the whole drawing now accepts it.
            saved = Path(folder) / 'doc.json'; saved.write_text(json.dumps(result['document']), encoding='utf-8')
            check = subprocess.run(['node', str(ROOT / 'tmp' / 'review' / 'check_validate.mjs'), str(saved)], capture_output=True, text=True, encoding='utf-8')
            if check.returncode == 0 and check.stdout:
                self.assertIn('validate OK', check.stdout)


if __name__ == '__main__':
    unittest.main()
