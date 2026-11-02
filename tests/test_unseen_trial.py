import copy,json,math,unittest
from pathlib import Path
from pipeline.generation.engine import generate,SpecificationError
from pipeline.generation.prepare_ten_trial import Plan
from pipeline.generation.refine_ten_trial import split_windows

ROOT=Path(__file__).resolve().parents[1]
def read(p):return json.loads(p.read_text(encoding='utf8'))

class UnseenTrialTests(unittest.TestCase):
    def test_rotated_t_junctions_split_all_windows_without_rounding(self):
        # Endpoints differing by ulps used to be missed by exact intersection.
        for angle in (-math.pi/4,math.pi/7,math.pi/3):
            p=Plan('rotation','rotation',10000,10000)
            def tr(x,y):return (x*math.cos(angle)-y*math.sin(angle),9000+x*math.sin(angle)+y*math.cos(angle))
            host=p.wall(tr(0,0),tr(6000,0));p.win(host,.9)
            p.wall(tr(2100,0),tr(2100,1800));p.wall(tr(4300,0),tr(4300,1700))
            before=copy.deepcopy(host['points']);split_windows(p)
            self.assertEqual(len(p.s['openings']),3)
            doc,g,r=generate(p.s);self.assertEqual(r['full_apertures_checked'],3)
            points=[pt for w in p.s['walls'] for pt in w['points']]
            for a in before:self.assertTrue(any(math.dist(a,b)<1e-8 for b in points))

    def test_three_units_reach_common_stair_without_merging(self):
        s=read(ROOT/'data/generation-specs/unseen-5/1a4113ab273f.json')
        d,g,r=generate(s);sr=r['spatial_review']
        self.assertFalse(sr['connection_errors'])
        comps={p['access_group']:p['component'] for p in sr['room_probes']}
        self.assertEqual(len(set(comps.values())),4)
        self.assertEqual(sum(e['connects_groups'] is not None for e in sr['entrances']),3)
        self.assertEqual(sum(e['connection_type']=='vertical' for e in sr['entrances']),1)

    def test_false_common_door_declaration_is_rejected(self):
        s=read(ROOT/'data/generation-specs/unseen-5/1a4113ab273f.json')
        o=next(o for o in s['openings'] if o.get('connects_groups')==['left','common'])
        o['connects_groups']=['upper','common']
        with self.assertRaisesRegex(SpecificationError,'Invalid declared entrance'):generate(s)

    def test_missing_stair_transfer_disconnects_units(self):
        s=read(ROOT/'data/generation-specs/unseen-5/1a4113ab273f.json')
        s['openings']=[o for o in s['openings'] if not o.get('circulation_transfer')]
        with self.assertRaisesRegex(SpecificationError,'No external entrance'):generate(s)

    def test_new_sources_and_prior_ten_geometry(self):
        old=ROOT/'docs/drawing-ai/batch-10-review/run-20260911-120418'
        hashes={r['source_sha256'] for r in read(old/'summary.json')}
        chosen=read(ROOT/'docs/drawing-ai/unseen-5-review/selection.json')
        self.assertEqual(len(chosen),5)
        self.assertFalse(hashes&{r['document_id'] for r in chosen})
        for row in read(old/'summary.json'):
            folder=old/row['id'];doc,_,_=generate(read(folder/'input.json'))
            self.assertEqual(json.loads(json.dumps(doc['entities'])),read(folder/'drawing.bcad')['entities'])

    def test_rotated_plan_emits_no_zero_length_cad_lines(self):
        s=read(ROOT/'data/generation-specs/unseen-5/009a4136488d.json')
        doc,_,_=generate(s)
        for e in doc['entities']:
            if e['type']=='line':
                a,b=e['points'];self.assertGreaterEqual(math.hypot(a['x']-b['x'],a['y']-b['y']),1e-7)

if __name__=='__main__':unittest.main()
