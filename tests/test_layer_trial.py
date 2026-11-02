import copy,unittest,json
from pathlib import Path as FilePath
from pipeline.generation.run_layer_trial import house,unit
from pipeline.generation.engine import generate
from pipeline.generation.proportional import validate
class LayerTrialTests(unittest.TestCase):
    def test_classification_required(self):
        s=house('test');s['walls'][0].pop('classification_evidence')
        with self.assertRaisesRegex(ValueError,'classification'):generate(s)
    def test_source_topology_and_layers(self):
        for fn,wall_count,opening_count in [(house,9,11),(unit,15,4)]:
            s=fn('test');d,g,r=generate(s)
            self.assertEqual(len(s['walls']),wall_count);self.assertEqual(len(s['openings']),opening_count)
            self.assertTrue(validate(s)['passed'])
            layers={l['id']:l for l in d['layers']}
            for e in d['entities']:self.assertEqual(e['lineweight'],layers[e['layer']]['lineweight'])
            self.assertIn('A-FURN',{e['layer'] for e in d['entities']})
            for o in s['openings']:
                if o.get('access'):self.assertEqual({e['layer'] for e in d['entities'] if e.get('openingId')==o['id']},{'A-DOOR'})
    def test_printed_dimensions_and_uncertainty(self):
        s=unit('test');self.assertEqual(s['chains'][1]['segments'],[625,900,1605,2920,1500])
        o=next(o for o in s['openings'] if '욕실' in o['name']);self.assertEqual(o['width_mm'],750);self.assertEqual(o['kind'],'door');self.assertFalse(o['hinge_end']);self.assertEqual(o['side'],1)
        self.assertTrue(s['source_limitations'])
        s=house('test');doors=[o for o in s['openings'] if o['kind']=='door']
        self.assertEqual([(o['hinge_end'],o['side']) for o in doors],[(True,1),(True,-1)])
    def test_explicit_residual_and_actual_clearances(self):
        s=unit('test');d,g,r=generate(s);self.assertEqual(r['checks_passed'],2)
        e=next(e for e in s['proportion_evidence'] if e.get('explicit_span_mm'));self.assertEqual(e['right_mm'],675)
        e['explicit_span_mm']+=10;self.assertFalse(validate(s)['passed'])
    def test_masonry_hatch_clipped_and_exported(self):
        from shapely.geometry import Polygon
        import exchange,ezdxf,io
        s=house('test');d,g,r=generate(s)
        hatches=[e for e in d['entities'] if e['type']=='hatch'];self.assertTrue(hatches)
        for e in hatches:
            self.assertEqual(e['layer'],'A-WALL-MASN')
            poly=Polygon([(p['x'],-p['y']) for p in e['points']], [[(p['x'],-p['y']) for p in ring] for ring in e['loops']])
            self.assertLess(poly.difference(g).area,1e-6)
            for mask in s['masonry_exclusions']:self.assertLess(poly.intersection(Polygon(mask)).area,1e-6)
        layer=next(l for l in d['layers'] if l['id']=='A-WALL-MASN');standards=json.loads((FilePath(__file__).resolve().parents[1]/'rules/knowledge/generation-layer-standards.json').read_text(encoding='utf8'));self.assertEqual(layer['color'],next(l['color'] for l in standards['layers'] if l['name']=='A-WALL-MASN'))
        raw,warnings=exchange.export_dxf(d);self.assertFalse(warnings)
        import tempfile
        from pathlib import Path
        with tempfile.TemporaryDirectory() as tmp:
            path=Path(tmp)/'drawing.dxf';path.write_bytes(raw);dx=ezdxf.readfile(path)
        exported=list(dx.modelspace().query('HATCH'));self.assertEqual(len(exported),len(hatches))
        for h in exported:self.assertEqual(h.dxf.color,256);self.assertEqual(h.dxf.layer,'A-WALL-MASN')
if __name__=='__main__':unittest.main()
