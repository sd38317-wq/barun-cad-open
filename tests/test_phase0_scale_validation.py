import copy
import json
import unittest
from pipeline.common.io import digest
from pipeline.phase0.scale_validation import analyze,reviewed_estimates
from pipeline.phase0.scale import verify_scale


def dimension(i,axis,start,end,value,line=10):
    pts=[[start,line],[end,line]] if axis=='horizontal' else [[line,start],[line,end]]
    return {'text_id':str(i),'axis':axis,'measurement_points':pts,'printed_value_candidate':value,
        'mm_per_pixel_candidate':value/(end-start)}


class ScaleValidationTests(unittest.TestCase):
    def test_chain_and_axes_never_certify_units(self):
        evidence={'dimension_candidates':[dimension(0,'horizontal',0,100,1000),dimension(1,'horizontal',0,40,400),
            dimension(2,'horizontal',40,100,600),dimension(3,'vertical',0,80,800)]}
        result=analyze(evidence)
        self.assertEqual(result['status'],'geometry_consistent');self.assertFalse(result['verified'])
        self.assertTrue(result['chain_checks'][0]['passed'])
        self.assertEqual(verify_scale({'units':'px','recovered_numeric_ocr':evidence})['status'],'review')

    def test_repeated_overall_dimension_does_not_inflate_support(self):
        evidence={'dimension_candidates':[dimension(i,'horizontal',0,100,1000,i*10) for i in range(5)]}
        self.assertEqual(analyze(evidence)['independent_seed_count'],1)

    def test_two_scales_block_global_calibration(self):
        evidence={'dimension_candidates':[dimension(0,'horizontal',0,100,1000),dimension(1,'horizontal',100,140,400),
            dimension(2,'vertical',0,80,800),dimension(3,'horizontal',300,400,2000),
            dimension(4,'horizontal',400,450,1000),dimension(5,'vertical',300,360,1200)]}
        self.assertTrue(analyze(evidence)['possible_multiple_scales'])

    def test_review_binds_sources_numbers_scope_and_hash(self):
        evidence={'source_image_sha256':'image','dimension_candidates':[dimension(0,'horizontal',0,100,1000),
            dimension(1,'horizontal',100,140,400),dimension(2,'vertical',0,80,800)]}
        doc={'document_id':'d','source_ids':['s'],'units':'px','recovered_numeric_ocr':evidence}
        review={'schema_version':1,'document_id':'d','source_ids':['s'],'source_image_sha256':'image',
            'evidence_sha256':digest(json.dumps(evidence,ensure_ascii=False,sort_keys=True,separators=(',',':')).encode()),
            'status':'accepted','units':'mm','scope':'single_scale_whole_image','reviewer':'test','unit_basis':'test','scope_basis':'test',
            'dimensions':[{'candidate_index':i,'printed_mm':c['printed_value_candidate'],'text_confirmed':True,'endpoints_confirmed':True}
                for i,c in enumerate(evidence['dimension_candidates'])]}
        self.assertEqual(len(reviewed_estimates(doc,review)),3)
        doc['raster_scale_review']=review
        self.assertEqual(verify_scale(doc)['scale_factor'],10)
        changed=copy.deepcopy(doc);changed['recovered_numeric_ocr']['dimension_candidates'][0]['printed_value_candidate']=100
        self.assertEqual(verify_scale(changed)['status'],'review')
        duplicate=copy.deepcopy(review);duplicate['dimensions'][2]=duplicate['dimensions'][0]
        with self.assertRaises(ValueError):reviewed_estimates(doc,duplicate)
        already_mm=copy.deepcopy(doc);already_mm['units']='mm'
        with self.assertRaises(ValueError):reviewed_estimates(already_mm,review)
        corrected=copy.deepcopy(doc);corrected_review=copy.deepcopy(review)
        c=corrected['recovered_numeric_ocr']['dimension_candidates'][0]
        c.update(text='100',printed_value_candidate=100,mm_per_pixel_candidate=1)
        corrected_review['evidence_sha256']=digest(json.dumps(corrected['recovered_numeric_ocr'],ensure_ascii=False,sort_keys=True,separators=(',',':')).encode())
        with self.assertRaises(ValueError):reviewed_estimates(corrected,corrected_review)
        corrected_review['dimensions'][0]['ocr_correction']={'original_text':'100','reviewed_text':'1000','reason':'test visual correction'}
        self.assertEqual(reviewed_estimates(corrected,corrected_review)[0]['factor'],10)


if __name__=='__main__':unittest.main()
