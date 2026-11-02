import unittest,hashlib,json,tempfile,os
from pathlib import Path
from unittest.mock import patch
import design_case_service as cases
import bridge

@patch('miri_account_service.require_ai_login', new=lambda: None)
class DesignCaseTests(unittest.TestCase):
    def test_catalogue_location_recovers_after_packaged_backend_start(self):
        original=cases.ROOT
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder)/'catalog';root.mkdir();(root/'catalog.sqlite').write_bytes(b'fixture')
            cases.ROOT=Path(folder)/'missing-at-startup'
            try:
                with patch.dict(os.environ,{'BARUN_DESIGN_CATALOG':str(root)}):
                    self.assertEqual(cases.active_root(),root.resolve())
            finally:
                cases.ROOT=original

    def test_scale_follows_identical_image_across_tasks(self):
        original=cases.calibration('Training/DEH_FP_SPA_001310864')
        self.assertTrue(original)
        self.assertEqual(original,cases.calibration('Training/DEH_FP_STR_659268933'))
    def test_editable_whole_annotation_document(self):
        key=cases.search({'query':'주택'})['results'][0]['id']
        with patch('parcel_service.require_verified_login',return_value={'verified':True}):
            r=cases.process({'action':'editable','id':key})
        source=cases.reference_document(key,cases.calibration(key).get('mmPerPixel',10))
        self.assertGreater(r['objectCount'],len(source['entities']))
        self.assertGreater(len(r['sourceCases']),1)
        self.assertEqual(r['scaleVerified'],bool(cases.calibration(key)))
        self.assertTrue(all(not e['referenceOnly'] for e in r['document']['entities']))
        self.assertTrue(all(not l['locked'] for l in r['document']['layers']))
        self.assertEqual([e['points'] for e in source['entities']],[e['points'] for e in r['document']['entities'][:len(source['entities'])]])
        (Path(tempfile.mkdtemp(prefix='barun-cad-cases-'))/'engine-test-editable.json').write_text(json.dumps(r['document']),encoding='utf8')
    def test_simple_search_and_pagination(self):
        a=cases.search({'query':'아파트','limit':30})
        b=cases.search({'query':'아파트','limit':30,'offset':30})
        self.assertEqual(len(a['results']),30)
        self.assertTrue(a['hasMore'])
        self.assertFalse(set(x['id'] for x in a['results']) & set(x['id'] for x in b['results']))
        self.assertTrue(all(x['housing']=='DEH' for x in cases.search({'query':'주택'})['results']))
        for q in ('상가','병원'):
            self.assertEqual(cases.search({'query':q})['total'],0)
        r=cases.search({'query':'84'})
        self.assertTrue(r['results']);self.assertTrue(r['unverifiedConstraints'])
    def test_search_and_provenance(self):
        result=bridge.call('cad_search_design_cases',{'query':'단독주택 방 3개 욕실 2개'})
        self.assertTrue(result['results'])
        self.assertEqual(result['interpreted']['desiredSheetCounts'],{'공간_침실':3,'공간_화장실':2})
        r=result['results'][0]
        self.assertEqual(r['housing'],'DEH'); self.assertEqual(r['countDistance'],0)
        detail=bridge.call('cad_get_design_case',{'id':r['id']})
        self.assertIsNone(detail['scaleMmPerPixel'])
        self.assertNotIn('annotations',detail)
        self.assertIsNone(detail['pattern']['method']['physicalScale'])
    def test_reference_requires_scale_and_preserves_original(self):
        key=cases.search({'query':'단독주택 방 3개 욕실 2개'})['results'][0]['id']
        row=cases.row_for(key);p=cases.ROOT/row['label_path'];before=hashlib.sha256(p.read_bytes()).hexdigest()
        for scale in (None,0,-1,float('nan'),True):
            with self.assertRaises(ValueError):cases.reference_document(key,scale)
        doc=cases.reference_document(key,2)
        self.assertTrue(doc['entities']);self.assertTrue(doc['metadata']['referenceOnly'])
        self.assertEqual(before,hashlib.sha256(p.read_bytes()).hexdigest())
        raw=cases.raw_for(row);a=next(a for a in raw['annotations'] if a['id']==doc['entities'][0]['sourceAnnotation'])
        poly=a['segmentation'][0]
        self.assertAlmostEqual(doc['entities'][0]['points'][0]['x'],poly[0]*2)
        self.assertAlmostEqual(doc['entities'][0]['points'][0]['y'],(raw['images'][0]['height']-poly[1])*2)
        (Path(tempfile.mkdtemp(prefix='barun-cad-cases-'))/'engine-test-reference.json').write_text(json.dumps(doc),encoding='utf-8')
    def test_missing_case_and_invalid_options(self):
        with self.assertRaises(ValueError):cases.detail('../../anything')
        with self.assertRaises(ValueError):cases.search({'housing':'invalid'})
    def test_spatial_preference_and_unknown_physical_area(self):
        r=cases.search({'query':'단독주택 방 3개 욕실 2개 주방 거실 가깝게 100㎡'})
        self.assertTrue(r['unverifiedConstraints'])
        first=r['results'][0]
        self.assertTrue(first['preferredProximityObserved'])
        d=cases.detail(first['id'])
        self.assertTrue(any(e['classes']==['공간_거실','공간_주방'] for e in d['pattern']['nearbyCandidates']))

if __name__=='__main__':unittest.main()
