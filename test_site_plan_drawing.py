import unittest
from copy import deepcopy
from site_plan_service import from_drawing, payload

class DrawingInputTests(unittest.TestCase):
    def fixture(self):
        return {'entities':[{'type':'block','parcelGroup':True,'entities':[
            {'type':'polyline','closed':True,'parcelRole':'site',
             'points':[{'x':0,'y':0},{'x':20000,'y':0},{'x':20000,'y':25000},{'x':0,'y':25000}],
             'attributes':{'sourceCRS':'EPSG:5179','originMetres':[1140000,1680000],'ring':'outer','pnu':'123'}}]}]}
    def test_imported_block_and_translation(self):
        d=self.fixture();before=deepcopy(d);a=from_drawing(d)
        self.assertEqual(d,before);payload(a,'generate')
        for p in d['entities'][0]['entities'][0]['points']:p['x']+=500000;p['y']-=100000
        self.assertEqual(a,from_drawing(d))
        self.assertEqual(a['zoning']['zone'],'미확인')
        self.assertEqual(a['program']['floors'],3)
    def test_missing_and_hole_rejected(self):
        with self.assertRaises(ValueError):from_drawing({'entities':[]})
        d=self.fixture();d['entities'][0]['entities'][0]['attributes']['ring']='hole'
        with self.assertRaises(ValueError):from_drawing(d)
    def parcel(self,x0,x1,role='site',ring='outer'):
        return {'type':'polyline','closed':True,'parcelRole':role,
                'points':[{'x':x0,'y':0},{'x':x1,'y':0},{'x':x1,'y':25000},{'x':x0,'y':25000}],
                'attributes':{'sourceCRS':'EPSG:5179','originMetres':[1140000,1680000],'ring':ring,'pnu':str(x0)}}
    def test_adjacent_parcels_merge_into_one_site(self):
        one=from_drawing(self.fixture())
        d={'entities':[self.parcel(0,12000),self.parcel(12000,20000)]}
        merged=from_drawing(d)['site']['parcel']
        self.assertEqual(len(merged),4)
        area=lambda ps:abs(sum(a[0]*b[1]-a[1]*b[0] for a,b in zip(ps,ps[1:]+ps[:1])))/2
        self.assertAlmostEqual(area(merged),area(one['site']['parcel']),delta=0.5)
        with self.assertRaises(ValueError):from_drawing({'entities':[self.parcel(0,10000),self.parcel(15000,20000)]})
    def test_neighbor_hole_ring_is_skipped(self):
        d=self.fixture();d['entities'].append(self.parcel(30000,40000,'neighbor','hole'));d['entities'].append(self.parcel(20000,30000,'road'))
        a=from_drawing(d);self.assertEqual(len(a['site']['neighbors']),1)

if __name__=='__main__':unittest.main()
