"""Mirrored and clipped INSERTs share their definition and still draw exactly like the old expanded import."""
import json
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import ezdxf
import exchange

ROOT = Path(__file__).parent


def build(path):
    doc = ezdxf.new('R2018', setup=True); doc.units = 4
    block = doc.blocks.new('FLOOR')
    block.add_line((0, 0), (1000, 0)); block.add_line((1000, 0), (1000, 400))
    block.add_arc((500, 200), 150, 20, 140)
    block.add_text('101동', dxfattribs={'height': 120, 'rotation': 15}).set_placement((100, 250))
    block.add_text('우측', dxfattribs={'height': 80}).set_placement((900, 50), align=ezdxf.enums.TextEntityAlignment.RIGHT)
    hatch = block.add_hatch(color=3); hatch.paths.add_polyline_path([(50, 50), (300, 50), (300, 150), (50, 150)], is_closed=True)
    m = doc.modelspace()
    m.add_blockref('FLOOR', (0, 0))                                                      # plain
    m.add_blockref('FLOOR', (5000, 0), dxfattribs={'xscale': -1, 'yscale': 1})          # mirror (X)
    m.add_blockref('FLOOR', (10000, 0), dxfattribs={'xscale': 2, 'yscale': -2, 'rotation': 30})  # mirror (Y) + turn + scale
    m.add_blockref('FLOOR', (15000, 0), dxfattribs={'xscale': -1, 'yscale': -1})        # 180 degree turn
    clipped = m.add_blockref('FLOOR', (20000, 0), dxfattribs={'xscale': -1.5, 'yscale': 1.5, 'rotation': -20})
    from ezdxf.xclip import XClip
    XClip(clipped).set_block_clipping_path([(0, 0), (600, 0), (600, 300), (0, 300)])
    m.add_blockref('FLOOR', (25000, 0), dxfattribs={'extrusion': (0, 0, -1), 'rotation': 40})       # seen from below (OCS -Z)
    doc.saveas(path)


def flat(document, folder, name):
    saved = Path(folder) / f'{name}.json'; saved.write_text(json.dumps(document), encoding='utf-8')
    run = subprocess.run(['node', str(ROOT / 'shared_expand_check.mjs'), str(saved)], capture_output=True, text=True, encoding='utf-8', check=True)
    return json.loads(run.stdout)


class SharedMirrorInsertTest(unittest.TestCase):
    def test_mirrored_and_clipped_inserts_share_and_draw_like_the_expanded_import(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'mirror.dxf'; build(path)
            shared = exchange.import_file_path(path, '.dxf')['document']
            with patch.object(exchange, 'can_share_block_reference', lambda entity: False):
                expanded = exchange.import_file_path(path, '.dxf')['document']
            new, old = flat(shared, folder, 'shared'), flat(expanded, folder, 'expanded')
        self.assertEqual(new['shared'], 6, 'every INSERT now shares its definition')
        self.assertEqual(new['mirror'], 4)
        self.assertEqual(new['clipped'], 1)
        self.assertEqual(old['shared'], 0)
        self.assertEqual(len(new['rows']), len(old['rows']))
        for got, want in zip(new['rows'], old['rows']):
            self.assertEqual(got['type'], want['type'])
            for key in ('points', 'center', 'radius', 'start', 'end', 'position', 'rotation', 'align', 'text', 'height', 'loops', 'clip'):
                if key in want:
                    self.assertEqual(got.get(key), want[key], f'{want["type"]} {key}')

    def test_export_writes_the_mirror_back_as_a_negative_x_scale(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'mirror.dxf'; build(path)
            document = exchange.import_file_path(path, '.dxf')['document']
            for entity in document['entities']: entity.pop('sourceHandle', None); entity.pop('sourceFingerprint', None)
            content, _ = exchange.export_dxf(document, 'R2018')
            out = Path(folder) / 'out.dxf'
            out.write_bytes(content if isinstance(content, bytes) else content.encode('utf-8'))
            refs = [(round(e.dxf.xscale, 6), round(e.dxf.yscale, 6)) for e in ezdxf.readfile(out).modelspace().query('INSERT')]
            self.assertIn((-1.0, 1.0), refs)
            # Reimported, the exported file draws the same as the original import.
            again = exchange.import_file_path(out, '.dxf')['document']
            first, second = flat(document, folder, 'first'), flat(again, folder, 'second')
            self.assertEqual([r['type'] for r in first['rows']], [r['type'] for r in second['rows']])
            for got, want in zip(second['rows'], first['rows']):
                for key in ('points', 'center', 'radius', 'position', 'rotation', 'align'):
                    if key in want: self.assertEqual(got.get(key), want[key], f'{want["type"]} {key}')


if __name__ == '__main__':
    unittest.main()
