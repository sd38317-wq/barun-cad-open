"""Independent checks against source dimensions and visible exported geometry."""
import json, math, unittest
import ezdxf
from shapely import wkt
from shapely.geometry import Point,LineString
from pipeline.validation.refine_dimension_first import OUT, BASE


class DetailRebuildTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.doc=json.loads((OUT/'drawing.bcad').read_text(encoding='utf8'))
        cls.model=json.loads((OUT/'wall-model.json').read_text(encoding='utf8'))
        cls.solid=wkt.loads((OUT/'wall-union.wkt').read_text())

    def test_source_room_clearances_on_actual_boundary(self):
        for a,b,expected in [((6900,2000),(10410,2000),3510),
                              ((8000,490),(8000,3220),2730),
                              ((9000,3370),(9000,3870),500),
                              ((9000,4020),(9000,5520),1500),
                              ((9500,5670),(9500,9100),3430),
                              ((1200,1060),(1200,4210),3150)]:
            line=LineString([a,b])
            self.assertAlmostEqual(line.length,expected)
            self.assertLess(self.solid.boundary.distance(Point(a)),1e-6)
            self.assertLess(self.solid.boundary.distance(Point(b)),1e-6)
            self.assertLess(line.intersection(self.solid).length,1e-6)

    def test_balcony_printed_vertices_are_real_wall_faces(self):
        vertices=[(1440,10220),(2041,10220),(2261,10390),(9106,10390),(9336,10180),(10410,10180)]
        for p in vertices:self.assertLess(self.solid.boundary.distance(Point(p)),1e-6)
        self.assertEqual(vertices[1][0]-vertices[0][0],601)
        self.assertEqual(vertices[2][0]-vertices[1][0],220)
        self.assertEqual(vertices[2][1]-vertices[1][1],170)
        self.assertEqual(vertices[3][0]-vertices[2][0],6845)
        self.assertEqual(vertices[4][0]-vertices[3][0],230)
        self.assertEqual(vertices[3][1]-vertices[4][1],210)

    def test_slope_true_perpendicular_half_thickness(self):
        axis=LineString(self.model['balcony_centerline'])
        for a,b in [((2041,10220),(2261,10390)),((9106,10390),(9336,10180))]:
            dx,dy=b[0]-a[0],b[1]-a[1];length=math.hypot(dx,dy)
            p=Point((a[0]+b[0])/2,(a[1]+b[1])/2)
            self.assertAlmostEqual(axis.distance(p),75,places=7)
            outside=Point(p.x-dy/length*150,p.y+dx/length*150)
            self.assertLess(self.solid.boundary.distance(outside),1e-6)

    def test_closed_junctions_without_buried_caps(self):
        self.assertTrue(self.solid.is_valid)
        self.assertTrue(self.solid.contains(Point(-125,-125)))
        edges=[]
        for e in self.doc['entities']:
            if e.get('generatedBy')=='wall-union-v2':
                line=LineString([(p['x'],-p['y']) for p in e['points']])
                self.assertLess(line.difference(self.solid.boundary.buffer(1e-6)).length,1e-5)
                edges.append(line)
        from shapely.ops import unary_union
        self.assertLess(self.solid.boundary.difference(unary_union(edges).buffer(1e-6)).length,1e-5)

    def test_openings_are_cut_and_have_real_hosts(self):
        walls={w['id']:w for w in self.model['wall_specs']}
        for o in self.model['opening_schedule']:
            w=walls[o['host_wall']];axis=LineString(w['points'])
            midpoint=axis.interpolate(o['start_mm']+o['width_mm']/2)
            self.assertGreater(self.solid.distance(midpoint),1)
            self.assertIn('planning assumption',o['evidence'])

    def test_dxf_actual_dimensions_survive_revision(self):
        dxf=ezdxf.readfile(OUT/'dimension-first-988516-v2.dxf')
        expected=json.loads((BASE/'validation.json').read_text(encoding='utf8'))['dimension_checks']
        dims=list(dxf.modelspace().query('DIMENSION'))
        self.assertEqual(len(dims),46)
        for e,d in zip(dims,expected):
            self.assertIn(e.dxf.text,('','<>'))
            self.assertAlmostEqual(abs(e.get_measurement()),d['expected_mm'],places=7)
        self.assertFalse(dxf.audit().errors)


if __name__=='__main__':unittest.main()
