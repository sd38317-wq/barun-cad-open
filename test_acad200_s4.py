"""ACAD200 영역 4 서버·DXF 쪽: BOUNDARY 꺾은선 경계 집합(412), 폴리선 호 구간 bulge 저장(408), 스플라인 맞춤점(409), 가리기 WIPEOUT(411)."""
import io, math, unittest
import ezdxf
import exchange
from hatch_service import boundary, paths_polygons


def model(entities):
    return {'version': 2, 'units': 'mm', 'blocks': [], 'layers': [{'id': 'default', 'name': '0', 'visible': True, 'color': '#ffffff'}], 'entities': entities}


def read(raw):
    return ezdxf.read(io.StringIO(raw.decode('utf8').replace('\r', '')))


class BoundaryPathsTest(unittest.TestCase):
    def test_paths_find_face_without_dxf(self):
        square = [[0, 0], [100, 0], [100, 100], [0, 100], [0, 0]]
        r = boundary({'paths': [square, [[50, -10], [50, 110]]], 'point': {'x': 20, 'y': 20}})
        xs = sorted({p['x'] for p in r['points']})
        self.assertEqual(xs, [0.0, 50.0])
        self.assertEqual(r['loops'], [])

    def test_paths_gap_tolerance_and_limits(self):
        gapped = [[[0, 0], [97, 0]], [[100, 0], [100, 100], [0, 100], [0, 0]]]
        with self.assertRaises(ValueError):
            boundary({'paths': gapped, 'point': {'x': 50, 'y': 50}})
        r = boundary({'paths': gapped, 'point': {'x': 50, 'y': 50}, 'gapTolerance': 5})
        self.assertGreaterEqual(len(r['points']), 4)
        with self.assertRaises(ValueError):
            paths_polygons([[[0, 0], ['x', 1]]])
        with self.assertRaises(ValueError):
            paths_polygons('nope')


class BulgeExportTest(unittest.TestCase):
    def test_arc_runs_become_one_bulge_vertex_and_broken_runs_stay_straight(self):
        # 반원(중심 100,0 · 반지름 100)을 36 조각으로 나눈 점 + 직선 하나. arcRuns 가 0~36 을 한 호로 표시한다.
        pts = [{'x': 100 - 100 * math.cos(math.pi * k / 36), 'y': -100 * math.sin(math.pi * k / 36)} for k in range(37)] + [{'x': 200, 'y': 100}]
        e = {'id': 'p', 'type': 'polyline', 'layer': 'default', 'points': pts, 'arcRuns': [[0, 36]]}
        verts = exchange.polyline_bulge_vertices(e)
        self.assertEqual(len(verts), 3)
        self.assertAlmostEqual(abs(verts[0][2]), 1.0, 9)
        raw, _ = exchange.export_dxf(model([e]))
        lw = [x for x in read(raw).modelspace() if x.dxftype() == 'LWPOLYLINE'][0]
        self.assertEqual(len(list(lw.get_points('xyb'))), 3)
        broken = dict(e, points=[dict(p) for p in pts]); broken['points'][10]['x'] += 3
        self.assertIsNone(exchange.polyline_bulge_vertices(broken))

    def test_spline_fit_points_export_as_spline(self):
        fit = [{'x': 0, 'y': 0}, {'x': 100, 'y': 50}, {'x': 200, 'y': 0}]
        pts = [{'x': 0, 'y': 0}] + [{'x': 1, 'y': 1}] * 31 + [{'x': 200, 'y': 0}]
        e = {'id': 's', 'type': 'polyline', 'layer': 'default', 'points': pts, 'spline': {'degree': 3, 'method': 'fit', 'fitPoints': fit, 'closed': False}}
        raw, _ = exchange.export_dxf(model([e]))
        spline = [x for x in read(raw).modelspace() if x.dxftype() == 'SPLINE'][0]
        self.assertEqual(len(spline.fit_points), 3)
        stale = dict(e, points=pts[:-1])
        raw, _ = exchange.export_dxf(model([stale]))
        self.assertEqual([x.dxftype() for x in read(raw).modelspace()], ['LWPOLYLINE'])


class WipeoutTest(unittest.TestCase):
    def test_wipeout_round_trip(self):
        ring = [{'x': 0, 'y': 0}, {'x': 100, 'y': 0}, {'x': 100, 'y': 50}, {'x': 0, 'y': 50}]
        e = {'id': 'w', 'type': 'hatch', 'layer': 'default', 'solid': True, 'wipeout': True, 'frame': 1, 'points': ring, 'spacing': 100, 'angle': 0}
        raw, _ = exchange.export_dxf(model([e]))
        self.assertIn('WIPEOUT', [x.dxftype() for x in read(raw).modelspace()])
        # 바른 CAD 원본 표시가 없는 AutoCAD 도면의 WIPEOUT 도 가리기로 연다.
        src = ezdxf.new('R2018')
        src.modelspace().add_wipeout([(0, 0), (100, 0), (100, 50), (0, 50)])
        buf = io.StringIO(); src.write(buf)
        doc = exchange.import_file(buf.getvalue().encode('utf8'), '.dxf')['document']
        hatch = [x for x in doc['entities'] if x['type'] == 'hatch'][0]
        self.assertTrue(hatch['wipeout'])
        self.assertEqual(len(hatch['points']), 4)


if __name__ == '__main__':
    unittest.main()
