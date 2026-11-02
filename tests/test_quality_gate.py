import copy
import unittest
from pipeline.generation.quality_gate import REQUIRED, assess, fingerprint


class QualityGateTests(unittest.TestCase):
    def reviewed(self):
        s={'walls': [], 'openings': [{'id':'door1','kind':'door','hinge_end':True,'side':-1}]}
        d={'entities': [], 'layers': []}
        s['quality_review']={'fingerprint':fingerprint(s,d,'source'), 'checks': {
            key:dict(status='verified',evidence='source crop and object comparison record',reviewer='reviewer')
            for key in REQUIRED}}
        return s,d

    def test_geometry_success_alone_is_not_delivery(self):
        self.assertFalse(assess({}, {}, 'source', True, True)['deliverable'])

    def test_complete_current_record_can_pass(self):
        s,d=self.reviewed()
        self.assertTrue(assess(s,d,'source',True,True)['deliverable'])

    def test_every_required_review_blocks_when_absent(self):
        for key in REQUIRED:
            s,d=self.reviewed();del s['quality_review']['checks'][key]
            self.assertFalse(assess(s,d,'source',True,True)['deliverable'],key)

    def test_modified_source_input_or_output_invalidates_review(self):
        s,d=self.reviewed()
        self.assertFalse(assess(s,d,'other',True,True)['deliverable'])
        s['walls'].append({'id':'new'})
        self.assertFalse(assess(s,d,'source',True,True)['deliverable'])
        s,d=self.reviewed();d['entities'].append({'id':'changed'})
        self.assertFalse(assess(s,d,'source',True,True)['deliverable'])

    def test_default_hinge_cannot_be_approved_by_checkboxes(self):
        s,d=self.reviewed();del s['openings'][0]['hinge_end']
        s['quality_review']['fingerprint']=fingerprint(s,d,'source')
        self.assertFalse(assess(s,d,'source',True,True)['deliverable'])

    def test_unresolved_or_failed_files_block(self):
        s,d=self.reviewed()
        self.assertFalse(assess(s,d,'source',True,False)['deliverable'])
        s['source_review_required']=['dimension unresolved']
        s['quality_review']['fingerprint']=fingerprint(s,d,'source')
        self.assertFalse(assess(s,d,'source',True,True)['deliverable'])


if __name__=='__main__':unittest.main()
