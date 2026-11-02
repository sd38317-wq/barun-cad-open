import copy
import json
import tempfile
import unittest
from pathlib import Path

from pipeline.common.io import ROOT, choose, digest, read_json
from pipeline.phase0.normalize import base_document, catalog_records, normalize_catalog
from pipeline.phase0.classify import classify
from pipeline.phase0.scale import verify_scale
from pipeline.phase0.run import classify_document, main


def square(x=0,y=0,size=100):
    return [[x,y],[x+size,y],[x+size,y+size],[x,y+size]]


def drawing(kind='APT'):
    d=base_document('g',['original/001'])
    d['schema_version']='source-v7'
    d['units']='mm'
    d['metadata']={'housing_values':[kind],'drawing_type_values':['FP']}
    d['entities']=[{'id':'entry','layer':'A-AREA-ENTRY','poly':square(),'flags':[]},
                   {'id':'bed','layer':'A-AREA-BED','poly':square(200),'flags':[]}]
    return d


def add_dimensions(doc,factor=1):
    for i,length in enumerate([1000,2000]):
        doc['entities'] += [{'id':'t'+str(i),'layer':'A-DIM','text':str(length*factor)},
                           {'id':'d'+str(i),'layer':'A-DIM','measurement_kind':'linear',
                            'measurement_points':[[0,0],[length,0]]}]
        doc['dimension_pairs'].append({'text_id':'t'+str(i),'line_id':'d'+str(i)})


class Phase0Tests(unittest.TestCase):
    def test_metadata_first_and_floor_subtypes(self):
        d=drawing('DEH');d['entities'] += [{'id':f'e{i}','layer':'A-AREA-ENTRY','poly':square(i*200+500)} for i in range(8)]
        r=classify(d)
        self.assertEqual(r['building_type'],'DETACHED')
        self.assertEqual(r['doc_subtype'],'FLOOR')
        self.assertFalse(r['classification_evidence']['dwelling_boundary_verified'])

    def test_site_core_titles_unknown_and_nonfloor(self):
        d=drawing();d['entities']=[{'id':'site','layer':'A-SITE','poly':square()}]
        self.assertEqual(classify(d)['doc_subtype'],'SITE')
        d['entities']=[{'id':'core','layer':'A-AREA-STAIR','poly':square()}]
        self.assertEqual(classify(d)['doc_subtype'],'CORE_ONLY')
        d['metadata']['drawing_title']='지하 1층 평면도'
        self.assertEqual(classify(d)['doc_subtype'],'BASEMENT')
        d['metadata']['drawing_title']='지붕 평면도'
        self.assertEqual(classify(d)['doc_subtype'],'ROOF')
        d['metadata']['drawing_type_values']=['SD']
        result=classify_document(d)
        self.assertEqual(result['doc_type'],'구조도'); self.assertIsNone(result['doc_subtype'])
        self.assertFalse(result['eligible_for_phase1'])

    def test_building_inference_ambiguous_and_duplicate_entries(self):
        d=drawing();d['metadata'].pop('housing_values')
        self.assertEqual(classify(d)['building_type'],'UNKNOWN')
        d['entities'].append({'id':'entry-copy','layer':'A-AREA-ENTRY','poly':square()})
        self.assertEqual(classify(d)['classification_evidence']['polygon_counts']['공간_현관'],1)
        d['entities'].append({'id':'entry2','layer':'A-AREA-ENTRY','poly':square(500)})
        self.assertEqual(classify(d)['building_type'],'MULTI')

    def test_bbox_and_plain_ocr_are_never_dimension_evidence(self):
        d=drawing();d['units']='px'
        d['entities'].append({'id':'ocr','layer':'A-TEXT','text':'10410','bbox':[0,0,50,20]})
        r=classify_document(d)
        self.assertIsNone(r['scale_factor']);self.assertEqual(r['units'],'px')
        self.assertFalse(r['eligible_for_phase1'])

    def test_explicit_dimension_correction_and_id_version_preservation(self):
        d=drawing();add_dimensions(d,5)
        before=copy.deepcopy(d);r=classify_document(d)
        self.assertEqual(r['scale_factor'],5);self.assertTrue(r['scale_corrected'])
        self.assertEqual(r['entities'][0]['poly'][1],[500,0])
        self.assertEqual(r['schema_version'],'source-v7');self.assertEqual(r['source_id'],'original/001')
        self.assertTrue(r['eligible_for_phase1']);self.assertEqual(d,before)

    def test_normal_scale_does_not_rescale_and_conflict_is_held(self):
        d=drawing();add_dimensions(d,1.01)
        r=classify_document(d)
        self.assertEqual(r['scale_factor'],1);self.assertFalse(r['scale_corrected'])
        d['entities'][-2]['text']='999999'
        self.assertEqual(verify_scale(d)['status'],'review')

    def test_duplicate_dimension_cannot_satisfy_two_pairs(self):
        d=drawing();add_dimensions(d)
        d['dimension_pairs']=[d['dimension_pairs'][0]]*2
        self.assertEqual(verify_scale(d)['status'],'review')

    def test_seed_and_group_split_are_deterministic(self):
        records=[{'key':str(i),'selection_type':'apt','selection_split':'train'} for i in range(10)]
        records.append({'key':'mixed','selection_type':'apt','selection_split':'mixed'})
        self.assertEqual(choose(records,'apt',3,'train',42),choose(list(reversed(records)),'apt',3,'train',42))
        self.assertNotIn('mixed',[r['key'] for r in choose(records,'all',0,'train',42)])

    def test_invalid_input_kept_and_valid_original_not_changed(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp); source=root/'input';source.mkdir()
            invalid=source/'bad.json';invalid.write_text('{bad',encoding='utf8')
            valid=source/'good.json';valid.write_text(json.dumps(drawing()),encoding='utf8')
            before=valid.read_bytes()
            report=main(['--input',str(source),'--output-root',str(root),'--sample','0','--type','all','--split','all'])
            self.assertEqual(report['output_records'],2);self.assertEqual(report['processing_failures'],1)
            self.assertEqual(valid.read_bytes(),before);self.assertEqual(invalid.read_text(),'{bad')
            failed=[read_json(p) for p in (root/'data/classified').glob('*.json') if any(f['code']=='processing_failure' for f in read_json(p)['flags'])]
            self.assertEqual(len(failed),1);self.assertEqual(failed[0]['review_layer'],'A-REVIEW')

    def test_real_calibration_and_all_linked_original_ids(self):
        root=ROOT/'data/aihub-71465/full-catalog'
        key='Training/DEH_FP_SPA_001310864'
        record=next(r for r in catalog_records(root) if any(row['id']==key for row in r['rows']))
        doc=normalize_catalog(record,root,read_json(root/'verified-scales.json'))
        self.assertGreater(len(doc['source_ids']),1)
        scale=verify_scale(doc)
        self.assertEqual(scale['status'],'verified')
        self.assertAlmostEqual(scale['scale_factor'],5.074649178111575)
        self.assertEqual(doc['units'],'px')
        expected=sum(s.get('raw_annotations',0)-s.get('background_annotations',0) for s in doc['sources'])
        self.assertEqual(sum(len(e['source_refs']) for e in doc['entities']),expected)


if __name__=='__main__': unittest.main()
