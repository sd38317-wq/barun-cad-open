import copy,json,unittest
from pathlib import Path
from pipeline.generation.proportional import snap10,partition,validate
from pipeline.generation.engine import generate,SpecificationError

ROOT=Path(__file__).resolve().parents[1]

class ProportionalTests(unittest.TestCase):
    def sample(self):return json.loads((ROOT/'data/generation-specs/proportion-3/174be5705541.json').read_text(encoding='utf8'))
    def test_user_examples(self):
        self.assertEqual([snap10(x) for x in (1011,1047,1098,950,1050,1100)],[1010,1050,1100,950,1050,1100])
    def test_remainder_preserves_whole_span(self):
        e=partition(2270,243.7,1011)
        self.assertEqual((e['left_mm'],e['width_mm'],e['right_mm']),(240,1010,1020))
    def test_non_grid_span_is_not_silently_adjusted(self):
        with self.assertRaises(ValueError):partition(2271,240,1011)
    def test_actual_geometry_not_just_display_is_guarded(self):
        s=self.sample();s['openings'][0]['width_mm']+=1
        with self.assertRaisesRegex(SpecificationError,'Proportion evidence rejected'):generate(s)
    def test_tampered_evidence_cannot_approve_arbitrary_width(self):
        s=self.sample();s['openings'][0]['width_mm']+=100;s['proportion_evidence'][0]['width_mm']+=100;s['proportion_evidence'][0]['right_mm']-=100
        self.assertFalse(validate(s)['passed'])
    def test_missing_source_reference_blocks(self):
        s=self.sample();del s['proportion_evidence'][0]['reference']
        self.assertFalse(validate(s)['passed'])
    def test_all_three_generate_with_measured_evidence(self):
        for f in (ROOT/'data/generation-specs/proportion-3').glob('*.json'):
            s=json.loads(f.read_text(encoding='utf8'));self.assertTrue(validate(s)['passed']);d,g,r=generate(s)
            self.assertEqual(r['openings'],len(s['proportion_evidence']))

if __name__=='__main__':unittest.main()
