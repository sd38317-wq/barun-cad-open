import copy,json,unittest
from pathlib import Path
from shapely import wkt
from pipeline.generation.engine import generate,resolve,join_walls,SpecificationError
from pipeline.generation.prepare_ten_trial import Plan
from pipeline.generation.refine_ten_trial import split_windows
from pipeline.generation.spatial_review import review

ROOT=Path(__file__).resolve().parents[1]
SPECS=ROOT/'data/generation-specs/batch-10'
BASELINE=ROOT/'docs/drawing-ai/batch-10-review/run-20260911-112509'

def read(p):return json.loads(p.read_text(encoding='utf8'))

class RefinedTrialTests(unittest.TestCase):
    def test_all_ten_preserve_prior_dimensions_and_validate(self):
        files=[p for p in SPECS.glob('*.json') if p.stem!='manifest']
        self.assertEqual(len(files),10)
        for f in files:
            with self.subTest(id=f.stem):
                s=read(f);old=read(BASELINE/f.stem/'input.json')
                self.assertEqual(s['chains'][:len(old['chains'])],old['chains'])
                dims={a['id']:a for a in s['annotations'] if a['type']=='dimension'}
                for a in old['annotations']:
                    if a['type']=='dimension':self.assertEqual(dims[a['id']],a)
                doc,geometry,report=generate(s)
                self.assertEqual(report['full_apertures_checked'],len(s['openings']))
                if f.stem in ('988516eaf2c4','acb6fcdd29ac'):
                    prior=wkt.loads((BASELINE/f.stem/'wall-union.wkt').read_text())
                    self.assertLess(geometry.symmetric_difference(prior).area,1e-5)
                else:
                    r=report['spatial_review'];self.assertGreaterEqual(len(r['room_probes']),9)
                    self.assertFalse(r['connection_errors']);self.assertFalse(r['door_sweep_wall_conflicts']);self.assertFalse(r['door_sweep_pair_conflicts'])
                    self.assertTrue(all(e['valid'] for e in r['entrances']))

    def test_closed_bedroom_is_rejected(self):
        s=read(SPECS/'02a8a2a4ea54.json')
        hosts={w['id'] for w in s['walls'] if w['name']=='침실 복도 출입'}
        s['openings']=[o for o in s['openings'] if o['host_wall'] not in hosts]
        with self.assertRaisesRegex(SpecificationError,'Disconnected'):generate(s)

    def test_accidentally_joined_households_are_rejected(self):
        s=read(SPECS/'cb457cb4c915.json')
        wall=next(w for w in s['walls'] if w['name']=='세대 사이 욕실 남측')
        s['openings'].append(dict(id='wrong-connection',kind='passage',host_wall=wall['id'],start_mm=500,width_mm=900))
        with self.assertRaisesRegex(SpecificationError,'Separate access groups joined'):generate(s)

    def test_partition_windows_and_explicit_opening_on_sloping_host(self):
        p=Plan('test','test',6000,5000)
        w=p.wall((0,0),(4800,3600));p.win(w)
        p.wall((2400,1800),(1800,2600))
        split_windows(p)
        doc,g,r=generate(p.s)
        self.assertEqual(len(doc['metadata']['generation']['opening_schedule']),2)
        self.assertEqual(r['full_apertures_checked'],2)
        # Explicit source1700 cannot be resized by the inferred-window helper.
        q=Plan('explicit','explicit',6000,4000);w=q.wall((0,0),(6000,0))
        q.s['openings']=[dict(id='fixed',host_wall=w['id'],kind='window',start_mm=1000,width_mm=1700)]
        q.wall((2200,0),(2200,1000));before=copy.deepcopy(q.s['openings'])
        split_windows(q);self.assertEqual(before,q.s['openings'])
        with self.assertRaisesRegex(SpecificationError,'Opening blocked'):generate(q.s)

    def test_compact_entry_1050_is_measured_between_faces(self):
        s=read(SPECS/'d7720dab3f0f.json');_,_,r=generate(s)
        check=next(c for c in s['checks'] if c.get('basis')=='source_clearance')
        self.assertEqual(check['expected_mm'],1050)
        self.assertEqual(check['points'],[[4080,6700],[5130,6700]])

    def test_swing_collision_is_detected_away_from_doorway(self):
        p=Plan('swing','swing',4000,4000);w=p.wall((0,0),(4000,0));p.door(w)
        p.wall((2100,400),(2100,1600))
        walls,openings,*_=resolve(p.s);g,solids=join_walls(walls)
        r=review(p.s,walls,openings,g,solids)
        self.assertTrue(r['door_sweep_wall_conflicts'])

if __name__=='__main__':unittest.main()
