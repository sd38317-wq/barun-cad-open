import copy
import unittest
import numpy as np
from pipeline.refinement.drawing_regions import propose
from pipeline.refinement.numeric_recheck import reread
from pipeline.refinement.geometry_review import inspect
from pipeline.refinement.scale_decision import decide
from pipeline.refinement.resolve import audit_transform
from pipeline.phase0.scale import apply_scale


class RefinementTests(unittest.TestCase):
    def test_fixture_only_source_is_not_assumed_single_viewport(self):
        entities=[{'id':str(i),'layer':'A-SANI','bbox':[10+i*5,20,3,3]} for i in range(6)]
        entities +=[{'id':str(i+6),'layer':'A-KTCH','bbox':[160+i*5,20,3,3]} for i in range(6)]
        doc={'document_id':'obj-only','image':{'width':200,'height':100},'entities':entities}
        gray=np.full((100,200),255,dtype=np.uint8)
        for e in entities:
            x,y,w,h=e['bbox'];gray[y:y+h,x:x+w]=0
        r=propose(doc,gray)
        self.assertEqual(len(r['regions']),2)
        self.assertEqual(r['structural_coverage'],'insufficient')
        self.assertTrue(all(not x['scope_confirmed'] for x in r['regions']))
        self.assertEqual(sum(len(x['entity_ids']) for x in r['regions']),12)
        self.assertEqual(len(propose(doc)['regions']),1)
        # A connected dark plan between the fixtures is not a viewport gutter.
        gray[15:40,5:195]=0
        self.assertEqual(len(propose(doc,gray)['regions']),1)

    def test_transform_audit_catches_area_and_coordinate_corruption(self):
        d={'source_ids':['s'],'schema_version':1,'layers':['wall'],'units':'px',
            'entities':[{'id':'e','poly':[[0,0],[10,0],[10,10]],'area':50,'bbox':[0,0,10,10]}]}
        scale={'status':'verified','scale_factor':2.5}
        c=apply_scale(d,scale);c.update(scale=scale,scale_factor=2.5)
        self.assertTrue(audit_transform(d,c)['passed'])
        c['entities'][0]['area']=125
        with self.assertRaises(ValueError):audit_transform(d,c)
        c['entities'][0]['area']=312.5;c['entities'][0]['poly'][1][0]=26
        with self.assertRaises(ValueError):audit_transform(d,c)

    def test_regions_preserve_cross_gap_entities(self):
        entities=[{'id':str(i),'layer':'A-WALL','bbox':[10+i,10,10,10]} for i in range(6)]
        entities +=[{'id':str(i+6),'layer':'A-WALL','bbox':[150+i,10,10,10]} for i in range(6)]
        entities.append({'id':'long-title','layer':'A-TEXT','bbox':[10,1,160,5]})
        doc={'document_id':'d','image':{'width':200,'height':100},'entities':entities}
        before=copy.deepcopy(doc);r=propose(doc)
        self.assertEqual(len(r['regions']),2);self.assertIn('long-title',r['unassigned_entity_ids'])
        self.assertEqual(doc,before);self.assertFalse(any(x['scope_confirmed'] for x in r['regions']))

    def test_numeric_rotations_are_proposals_and_preserve_box(self):
        e={'numeric_texts':[{'id':'n','text':'0606','bbox':[2,2,40,10]}]}
        seen=[]
        def recognize(crops):
            seen.extend(crops);return [('9090',.95),('0606',.93)],0
        r=reread(np.zeros((30,60,3),dtype=np.uint8),e,recognize)
        self.assertEqual(len(seen),2);self.assertEqual(r['texts'][0]['original_text'],'0606')
        self.assertFalse(r['verified']);self.assertEqual(r['texts'][0]['readings'][0]['value'],9090)

    def test_invalid_polygon_repair_never_applied(self):
        doc={'entities':[{'id':'wall','layer':'A-WALL','poly':[[0,0],[10,10],[0,10],[10,0]]}]}
        original=copy.deepcopy(doc);r=inspect(doc)
        self.assertEqual(len(r['invalid_polygons']),1);self.assertFalse(r['invalid_polygons'][0]['applied'])
        self.assertEqual(doc,original)

    def test_recheck_cannot_create_scale_seed_or_mm(self):
        evidence={'numeric_texts':[{'id':'t','bbox':[20,20,30,10]}],
            'dimension_candidates':[{'text_id':'t','axis':'horizontal','measurement_points':[[0,40],[100,40]],
                'printed_value_candidate':100,'geometry_length_px':100,'mm_per_pixel_candidate':1}]}
        regions={'regions':[{'region_id':'r','rect_px':[0,0,200,200]}]}
        recheck={'texts':[{'text_id':'t','readings':[{'value':1000,'accepted_as_candidate':True}]}]}
        r=decide(evidence,regions,recheck,{'scale':{'status':'review'},'scale_factor':None})
        self.assertEqual(r['new_mm_approvals'],0);self.assertIsNone(r['regions'][0]['mm_per_pixel'])
        self.assertEqual(r['regions'][0]['correction_proposals'],[])

    def test_dimension_crossing_region_is_not_assigned(self):
        e={'numeric_texts':[{'id':'t','bbox':[90,0,20,10]}],'dimension_candidates':[{'text_id':'t','axis':'horizontal','measurement_points':[[5,20],[195,20]],'printed_value_candidate':1000,'geometry_length_px':190,'mm_per_pixel_candidate':1000/190}]}
        regions={'regions':[{'region_id':'a','rect_px':[0,0,100,100]},{'region_id':'b','rect_px':[100,0,200,100]}]}
        r=decide(e,regions,{'texts':[]},{'scale':{'status':'review'},'scale_factor':None})
        self.assertEqual(r['unassigned_candidate_indices'],[0])


if __name__=='__main__':unittest.main()
