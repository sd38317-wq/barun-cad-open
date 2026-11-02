import unittest
from pipeline.generation.engine import generate,SpecificationError
from pipeline.generation.planning import choose,preset


class PlanningTests(unittest.TestCase):
    def spec(self):return dict(schema_version=1,document_id='planning-test',units='mm',y_axis='down',walls=[dict(id='w',points=[[0,0],[4000,0]])],openings=[dict(id='o',host_wall='w',kind='door',use='bathroom',placement={'anchor':'end'})])
    def test_defaults_are_applied_and_recorded(self):
        d,g,r=generate(self.spec());m=d['metadata']['generation']
        self.assertEqual(m['wall_specs'][0]['thickness'],150)
        self.assertEqual(m['opening_schedule'][0]['width_mm'],850)
        self.assertEqual(m['opening_schedule'][0]['start_mm'],3000)
        self.assertEqual(len(r['planning_decisions']),3)
        self.assertTrue(m['wall_specs'][0]['pending'])
        self.assertTrue(all(not x['verified'] for x in r['planning_decisions']))
    def test_explicit_values_take_precedence(self):
        s=self.spec();s['walls'][0]['thickness']=200;s['openings'][0].update(width_mm=873,start_mm=117)
        d,g,r=generate(s)
        self.assertEqual(d['metadata']['generation']['opening_schedule'][0]['width_mm'],873)
        self.assertEqual(r['planning_decisions'],[])
    def test_window_ratio_selects_a_fitting_standard(self):
        self.assertEqual(choose(dict(rule='window_width',available_mm=4000,observed_ratio=.68),preset()),2800)
    def test_partition_preserves_span(self):
        c=preset();base=dict(rule='partition_axis',clear_span_mm=2160,observed_weights=[360,1140,360],origin_mm=8250)
        self.assertEqual(choose(dict(base,index=1),c),8685)
        self.assertEqual(choose(dict(base,index=2),c),9975)
    def test_fit_failure_does_not_shrink_the_door(self):
        s=self.spec();s['walls'][0]['points'][1]=[900,0]
        with self.assertRaises(SpecificationError):generate(s)


if __name__=='__main__':unittest.main()
