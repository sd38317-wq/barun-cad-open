"""치수 끝 모양(arrowType)이 DXF 로도 같게 나간다: 사선=ARCHTICK, 채운 화살표=기본, 설정 없음=사선."""
import tempfile
import unittest
from pathlib import Path

import ezdxf
import exchange


class DimensionArrowExportTest(unittest.TestCase):
    def test_arrow_type_becomes_dimblk_override(self):
        src = ezdxf.new('R2018', setup=True); src.units = 4
        src.modelspace().add_aligned_dim(p1=(0, 0), p2=(2000, 0), distance=300).render()
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'a.dxf'; src.saveas(path)
            model = exchange.import_file_path(path, '.dxf')['document']; model.pop('dxfPreservation', None); model.pop('sourceCoverage', None)
            dim = next(e for e in model['entities'] if e['type'] == 'dimension')
            for arrow, expected in (('tick', 'ARCHTICK'), ('open', 'OPEN'), ('closed-filled', ''), (None, 'ARCHTICK')):
                if arrow is None: dim.pop('arrowType', None)
                else: dim['arrowType'] = arrow
                data = exchange.export_dxf(model)
                data = data[0] if isinstance(data, tuple) else data
                out = Path(folder) / 'out.dxf'; out.write_bytes(data if isinstance(data, bytes) else data.encode('utf-8'))
                exported = next(iter(ezdxf.readfile(out).modelspace().query('DIMENSION')))
                blk = exported.get_dim_style().dxf.get('dimblk', '')
                override = exported.override().get('dimblk', None)
                self.assertEqual((override if override is not None else blk).lstrip('_').upper(), expected, arrow)


if __name__ == '__main__':
    unittest.main()
