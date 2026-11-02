"""Verify actual exported measurements, not rounded display labels."""
import unittest
import json
import ezdxf
from pipeline.validation.rebuild_dimension_first import OUT


class DimensionFirstRebuildTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.doc=json.loads((OUT/'drawing.bcad').read_text(encoding='utf8'))
        cls.walls={e['name']:e for e in cls.doc['entities'] if e['type']=='wall'}
        cls.dxf=ezdxf.readfile(OUT/'dimension-first-988516.dxf')

    def test_printed_upper_bedroom_clear_width(self):
        left=self.walls['주방 동측'];right=self.walls['동측 외벽']
        clear=right['points'][0]['x']-right['thickness']/2-(left['points'][0]['x']+left['thickness']/2)
        self.assertEqual(clear,3510)

    def test_three_independent_room_heights(self):
        for top,bottom,expected in [
            ('상부 우측침실 북측','상부 우측침실 남측',2730),
            ('상부 발코니/침실','좌측 침실 남측',3150),
            ('하부 우측침실 북측','거실/하부침실 남측',3430),
        ]:
            a,b=self.walls[top],self.walls[bottom]
            clear=abs(a['points'][0]['y']-b['points'][0]['y'])-(a['thickness']+b['thickness'])/2
            self.assertEqual(clear,expected)

    def test_dxf_measurement_not_cosmetic_override(self):
        dims=list(self.dxf.modelspace().query('DIMENSION'))
        expected=json.loads((OUT/'validation.json').read_text(encoding='utf8'))['dimension_checks']
        self.assertEqual(len(dims),46)
        for dim,record in zip(dims,expected):
            self.assertAlmostEqual(abs(dim.get_measurement()),record['expected_mm'],places=8)
            self.assertIn(dim.dxf.text,('','<>'))
        self.assertFalse(self.dxf.audit().errors)

    def test_unknowns_remain_unknown(self):
        facts=self.doc['metadata']['dimensionFirst']
        self.assertFalse(facts['approved'])
        self.assertFalse(facts['whole_plan_dimension_verified'])
        self.assertTrue(facts['planning_assumptions'])
        for e in self.walls.values():
            if e['evidence']=='planning_assumption':self.assertEqual(e['layer'],'pending')


if __name__=='__main__':unittest.main()
