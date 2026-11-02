"""Entities with flipped or noisy extrusion vectors are imported where AutoCAD draws them."""
import tempfile
import unittest
from pathlib import Path

import ezdxf
import exchange


class ExtrusionImportTest(unittest.TestCase):
    def imported(self, build):
        doc = ezdxf.new('R2018'); doc.units = 4
        build(doc, doc.modelspace())
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'drawing.dxf'; doc.saveas(path)
            return exchange.import_file_path(path, '.dxf')

    def test_lines_are_wcs_whatever_their_extrusion(self):
        # 78k such lines in 27 of 64 real drawings used to be dropped as non-planar.
        result = self.imported(lambda doc, m: (
            m.add_line((10, 20, 0), (30, 40, 0), dxfattribs={'extrusion': (0, 0, -1)}),
            m.add_line((1, 2, 0), (3, 4, 0), dxfattribs={'extrusion': (0, 2e-6, 1)}),
            m.add_line((5, 5, 0), (5, 5, 9), dxfattribs={'extrusion': (1, 0, 0)}),
            m.add_point((7, 8, 0), dxfattribs={'extrusion': (0, 0, -1)})))
        entities = result['document']['entities']
        lines = [e['points'] for e in entities if e['type'] == 'line']
        self.assertEqual(lines, [[{'x': 10.0, 'y': 20.0}, {'x': 30.0, 'y': 40.0}], [{'x': 1.0, 'y': 2.0}, {'x': 3.0, 'y': 4.0}], [{'x': 5.0, 'y': 5.0}, {'x': 5.0, 'y': 5.0}]])
        self.assertEqual(result['report']['skipped'], {})   # the vertical line remains an endpoint seen from above
        self.assertEqual([e['position'] for e in entities if e['type'] == 'point'], [{'x': 7.0, 'y': 8.0}])
        self.assertEqual(result['report']['converted']['LINE 법선 무관 WCS 좌표 → XY 평면'], 3)

    def test_axis_noise_is_read_as_planar(self):
        noise = (0, 2e-6, 1)
        result = self.imported(lambda doc, m: (
            m.add_arc((1, 2), 5, 10, 80, dxfattribs={'extrusion': noise}),
            m.add_circle((3, 4), 2, dxfattribs={'extrusion': (-1e-6, 0, 1)}),
            m.add_text('기울어진 문자', dxfattribs={'insert': (6, 7), 'height': 2.5, 'extrusion': (-1e-6, -1e-6, 1)}),
            m.add_lwpolyline([(0, 0), (10, 0), (10, 5)], dxfattribs={'extrusion': noise})))
        by_type = {e['type']: e for e in result['document']['entities']}
        self.assertEqual((by_type['arc']['center'], by_type['arc']['startAngle'], by_type['arc']['endAngle']), ({'x': 1.0, 'y': 2.0}, 10, 80))
        self.assertEqual(by_type['circle']['center'], {'x': 3.0, 'y': 4.0})
        self.assertEqual(by_type['text']['text'], '기울어진 문자')
        self.assertEqual(len(by_type['polyline']['points']), 3)
        self.assertEqual(result['report']['skipped'], {})

    def test_nearly_flipped_extrusion_is_uprighted_like_an_exact_one(self):
        def build(doc, m):
            m.add_arc((1, 2), 5, 10, 80, dxfattribs={'extrusion': (0, 1e-6, -1)})
            m.add_arc((1, 2), 5, 10, 80, dxfattribs={'extrusion': (0, 0, -1)})
        arcs = [e for e in self.imported(build)['document']['entities'] if e['type'] == 'arc']
        self.assertEqual(len(arcs), 2)
        strip = lambda e: {k: v for k, v in e.items() if k not in ('id', 'sourceHandle', 'sourceFingerprint')}
        self.assertEqual(strip(arcs[0]), strip(arcs[1]))
        self.assertEqual(arcs[0]['center'], {'x': -1.0, 'y': 2.0})

    def test_flipped_text_is_kept_readable_over_the_mirrored_extent(self):
        def build(doc, m):
            m.add_text('뒤집힌 문자', dxfattribs={'insert': (10, 5), 'height': 2.5, 'rotation': 30, 'extrusion': (0, 0, -1)})
            m.add_text('가운데', dxfattribs={'insert': (0, 0), 'align_point': (4, 6), 'halign': 1, 'height': 2, 'extrusion': (0, 1e-7, -1)})
        result = self.imported(build)
        texts = result['document']['entities']
        self.assertEqual([(t['text'], t['position'], t['rotation'], t['align']) for t in texts],
                         [('뒤집힌 문자', {'x': -10.0, 'y': 5.0}, 330.0, 'right'), ('가운데', {'x': -4.0, 'y': 6.0}, 0.0, 'center')])
        self.assertEqual(result['report']['skipped'], {})

    def test_text_in_a_tilted_plane_shows_its_plan_view(self):
        # Riser diagrams hold text in tilted planes. OCS axes here: x → (-1,0,0), y → (0,-0.8,0.6).
        result = self.imported(lambda doc, m: m.add_text('입상관', dxfattribs={'insert': (10, 5), 'height': 2, 'extrusion': (0, 0.6, 0.8)}))
        [text] = result['document']['entities']
        self.assertEqual((round(text['position']['x'], 9), round(text['position']['y'], 9)), (-10.0, -4.0))
        self.assertAlmostEqual(text['rotation'], 180.0)
        self.assertAlmostEqual(text['height'], 1.6); self.assertAlmostEqual(text['widthFactor'], 1.25)
        self.assertEqual(text['align'], 'left')
        self.assertEqual(result['report']['converted']['TEXT 3D 평면 → XY 투영'], 1)

    def test_a_dimension_in_a_tilted_plane_is_expanded_and_projected(self):
        def build(doc, m):
            dim = m.add_linear_dim(base=(0, 5), p1=(0, 0), p2=(10, 0), dxfattribs={'extrusion': (0, 0.6, 0.8)})
            dim.render()
        result = self.imported(build)
        [block] = result['document']['entities']
        self.assertEqual(block['type'], 'block'); self.assertTrue(block['entities'])
        self.assertEqual(result['report']['skipped'], {})

    def test_geometry_in_other_planes_is_projected_onto_xy_like_a_plan_view(self):
        tilt = (0, 0.6, 0.8)
        def build(doc, m):
            # Normal (1,0,0): OCS (x, y, z) is WCS (z, x, y), so this arc lies in the plane x = 0.
            m.add_arc((1, 2), 5, 10, 80, dxfattribs={'extrusion': (1, 0, 0)})
            m.add_lwpolyline([(0, 0), (10, 0), (10, 5)], dxfattribs={'extrusion': tilt, 'elevation': 2})
            m.add_solid([(0, 0), (1, 0), (0, 1), (1, 1)], dxfattribs={'extrusion': tilt})
            block = doc.blocks.new('B'); block.add_line((0, 0), (4, 0)); block.add_circle((0, 0), 1)
            m.add_blockref('B', (3, 3), dxfattribs={'extrusion': tilt})
            m.add_text('세운 문자', dxfattribs={'insert': (0, 0), 'height': 2, 'extrusion': (1, 0, 0)})
        result = self.imported(build)
        entities = result['document']['entities']
        arc = entities[0]
        self.assertEqual(arc['type'], 'polyline')
        self.assertTrue(all(abs(p['x']) < 1e-9 for p in arc['points']))
        self.assertTrue(all(1 - 5 - 1e-9 <= p['y'] <= 1 + 5 + 1e-9 for p in arc['points']))
        polyline = entities[1]
        self.assertEqual([(round(p['x'], 9), round(p['y'], 9)) for p in polyline['points']], [(0.0, 1.2), (-10.0, 1.2), (-10.0, -2.8)])   # OCS y axis is (0, -0.8, 0.6) here
        self.assertEqual(entities[2]['type'], 'hatch')
        block = entities[3]
        self.assertEqual(block['type'], 'block'); self.assertEqual(sorted(e['type'] for e in block['entities']), ['line', 'polyline'])
        self.assertEqual(result['report']['skipped'], {'TEXT (비평면 OCS)': 1})   # edge-on text stays with the preserved source
        self.assertEqual(result['report']['converted']['ARC 3D 평면 → XY 투영'], 1)


    def test_invalid_empty_text_is_skipped_before_it_can_expand_extents(self):
        def build(doc, m):
            m.add_line((10, 20), (30, 40))
            m.add_text('', dxfattribs={'insert': (4.88e153, 4.88e153)})
            m.add_text('  ', dxfattribs={'insert': (1e13, 1)})
            m.add_mtext('', dxfattribs={'insert': (4.88e153, 0)})
            m.new_entity('ATTRIB', {'tag': 'EMPTY', 'text': '', 'insert': (4.88e153, 0)})
        result = self.imported(build)
        self.assertEqual([e['type'] for e in result['document']['entities']], ['line'])
        self.assertEqual(result['report']['skipped'], {'TEXT 빈 문자 비정상 좌표': 2, 'MTEXT 빈 문자 비정상 좌표': 1, 'ATTRIB 빈 문자 비정상 좌표': 1})
        self.assertTrue(any('문자 4개를 건너' in w for w in result['report']['warnings']))

    def test_nonempty_text_recovers_from_insert_or_alignment_point(self):
        def build(doc, m):
            m.add_text('정렬점 복구', dxfattribs={'insert': (1e153, 1e153), 'align_point': (10, 20)})
            m.add_text('삽입점 복구', dxfattribs={'insert': (30, 40), 'align_point': (1e153, 1e153), 'halign': 1})
            m.new_entity('ATTRIB', {'tag': 'TAG', 'text': '속성 복구', 'insert': (1e153, 0), 'align_point': (50, 60)})
            m.add_text('복구 불가', dxfattribs={'insert': (1e153, 1e153), 'align_point': (1e153, 1e153)})
            m.add_mtext('복구 불가', dxfattribs={'insert': (1e153, 0)})
        result = self.imported(build)
        self.assertEqual([e['position'] for e in result['document']['entities']], [{'x': 10., 'y': 20.}, {'x': 30., 'y': 40.}, {'x': 50., 'y': 60.}])
        self.assertEqual(result['report']['skipped'], {'TEXT 비정상 좌표': 1, 'MTEXT 비정상 좌표': 1})
        self.assertEqual(result['report']['converted']['TEXT 비정상 좌표 → 대체 기준점 복구'], 2)
        self.assertEqual(result['report']['converted']['ATTRIB 비정상 좌표 → 대체 기준점 복구'], 1)

    def test_empty_insert_has_an_accurate_skip_warning(self):
        result = self.imported(lambda doc, m: (doc.blocks.new('EMPTY'), m.add_blockref('EMPTY', (0, 0), dxfattribs={'xscale': 2})))
        self.assertEqual(result['report']['skipped'], {'INSERT EMPTY': 1})
        self.assertTrue(any('빈 블록 참조(INSERT EMPTY) 1개를 건너' in w for w in result['report']['warnings']))
        self.assertFalse(any('미지원 객체 1개' in w for w in result['report']['warnings']))


    def test_nonfinite_text_anchors_recover_or_skip(self):
        def build(doc, m):
            for bad in (float('nan'), float('inf'), -float('inf')):
                m.add_text('내용', dxfattribs={'insert': (bad, 0), 'align_point': (10, 20)})
                m.add_text('', dxfattribs={'insert': (bad, 0)})
        result = self.imported(build)
        self.assertEqual([e['position'] for e in result['document']['entities']], [{'x': 10., 'y': 20.}] * 3)
        self.assertEqual(result['report']['skipped'], {'TEXT 빈 문자 비정상 좌표': 3})

    def test_shared_block_text_is_filtered_without_dropping_visible_children(self):
        def build(doc, m):
            block = doc.blocks.new('SYMBOL')
            block.add_line((0, 0), (1, 0))
            block.add_text('', dxfattribs={'insert': (1e153, 0)})
            block.add_text('복구', dxfattribs={'insert': (1e153, 0), 'align_point': (10, 20)})
            m.add_blockref('SYMBOL', (100, 100))
            m.add_blockref('SYMBOL', (200, 100))
        result = self.imported(build)
        self.assertEqual(len(result['document']['entities']), 2)
        children = result['document']['sharedBlocks']['SYMBOL']['entities']
        self.assertEqual([e['type'] for e in children], ['line', 'text'])
        self.assertEqual(children[1]['position'], {'x': 10., 'y': 20.})
        self.assertEqual(result['report']['skipped'], {'TEXT 빈 문자 비정상 좌표': 1})


if __name__ == '__main__':
    unittest.main()
