import copy,json,unittest
from pathlib import Path
from shapely import wkt
from shapely.geometry import Point
from pipeline.generation.engine import generate,SpecificationError


class CommonGeneratorTests(unittest.TestCase):
    def minimal(self,t=150):
        return dict(schema_version=1,document_id='synthetic-test',units='mm',y_axis='down',
                    walls=[dict(id='a',points=[[0,0],[1700,0]],thickness=t)],openings=[])

    def test_four_wall_thicknesses_and_exact_length(self):
        for t in (100,150,200,400):
            _,s,_=generate(self.minimal(t))
            self.assertEqual(s.bounds,(0,-t/2,1700,t/2))

    def test_mixed_thickness_corner(self):
        s=self.minimal(200);s['walls'].append(dict(id='b',points=[[0,0],[0,2000]],thickness=400))
        _,g,_=generate(s)
        self.assertTrue(g.contains(Point(-190,-90)))
        self.assertTrue(g.is_valid)

    def test_invalid_chain_is_rejected(self):
        s=self.minimal();s['chains']=[dict(id='x',segments=[1700,150],total=1800)]
        with self.assertRaises(SpecificationError):generate(s)

    def test_missing_host_and_outside_opening_rejected(self):
        s=self.minimal();s['openings']=[dict(id='o',host_wall='absent',start_mm=0,width_mm=900,kind='door')]
        with self.assertRaises(SpecificationError):generate(s)
        s['openings'][0].update(host_wall='a',start_mm=1000)
        with self.assertRaises(SpecificationError):generate(s)

    def test_unresolved_reference_rejected(self):
        s=self.minimal();s['walls'][0]['points'][0][0]='missing'
        with self.assertRaises(SpecificationError):generate(s)

    def test_opening_obstruction_away_from_midpoint_rejected(self):
        for kind in ('door','window','passage'):
            for points in ([[400,-500],[400,500]], [[300,60],[500,60]]):
                with self.subTest(kind=kind,points=points):
                    s=self.minimal()
                    s['openings']=[dict(id='o',host_wall='a',start_mm=200,width_mm=900,kind=kind)]
                    s['walls'].append(dict(id='blocker',points=points,thickness=20))
                    with self.assertRaisesRegex(SpecificationError,'Opening blocked'):
                        generate(s)

    def test_opening_jamb_contact_permitted(self):
        s=self.minimal()
        s['openings']=[dict(id='o',host_wall='a',start_mm=200,width_mm=900,kind='door')]
        s['walls'].append(dict(id='jamb',points=[[125,-500],[125,500]],thickness=150))
        _,_,report=generate(s)
        self.assertEqual(report['openings'],1)

    def test_prior_plan_geometry_and_door_swings_preserved(self):
        spec=json.loads(Path('data/generation-specs/988516-dimension-first.json').read_text(encoding='utf8'))
        doc,solid,report=generate(spec)
        p=Path('docs/drawing-ai/centerline-rebuild-988516/revision-2')
        previous=wkt.loads((p/'wall-union.wkt').read_text())
        self.assertLess(solid.symmetric_difference(previous).area,1e-5)
        old=json.loads((p/'drawing.bcad').read_text(encoding='utf8'))
        def arcs(d):return {e['openingId']:(e['center'],e['radius'],e['startAngle'],e['endAngle']) for e in d['entities'] if e['type']=='arc'}
        self.assertEqual(arcs(old),arcs(doc))
        self.assertEqual(report['dimensions'],46)
        self.assertEqual(report['checks_passed'],6)


if __name__=='__main__':unittest.main()
