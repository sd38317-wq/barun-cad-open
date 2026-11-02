import json,math,unittest
from pathlib import Path
from shapely.geometry import LineString,Point,box
from pipeline.generation.engine import generate,resolve,join_walls
from pipeline.generation.centerline_grid import full_axes
from pipeline.generation.spatial_review import review

ROOT=Path(__file__).resolve().parents[1]
PROBES={
 '19828473f38b': [('침실',2000,2400),('거실',4800,2300),('현관',8500,1000),('욕실',7200,2700),('우하 구획',8500,3000)],
 '0d8dd53685ef': [('현관',2300,2800),('거실',7000,5000),('침실1',1500,5500),('침실2',4000,5500),('안방',11300,5500),('욕실1',4300,2700),('욕실2',10000,2900),('드레스룸',11700,2500),('다용도실',4900,1100),('후면1',7300,500),('후면2',11000,500),('전면',5000,7300),('전면2',9900,7300),('창고',11600,7600),('측면1',13300,2200),('측면2',13300,5500)],
 '0671843e912d': [('현관',700,5200),('거실',7000,7400),('침실1',4300,2700),('침실2',1200,7400),('침실3',3800,7400),('안방',10400,6500),('욕실1',2500,3900),('욕실2',10100,3600),('다용도실',9500,1200),('드레스룸',11600,3700),('발코니',10100,8700),('창고',11700,8900)]}

class ThreeTrialTests(unittest.TestCase):
    def test_axes_extend_to_envelope_and_deduplicate_collinear_walls(self):
        walls=[dict(id='a',points=[(0,0),(1000,0)]),dict(id='b',points=[(500,0),(2000,0)]),dict(id='c',points=[(0,0),(1000,1000)])]
        axes=full_axes(walls);self.assertEqual(len(axes),2)
        boundary=box(-600,-600,2600,1600).boundary
        for axis in axes:
            for pt in axis['points']:self.assertLess(boundary.distance(Point(pt)),1e-6)
        self.assertEqual(set(axes[0]['sourceWallIds']),{'a','b'})

    def test_source_door_hand_and_nonstandard_wall_thickness(self):
        s=json.loads((ROOT/'data/generation-specs/new-3/19828473f38b.json').read_text(encoding='utf8'))
        doors=[o for o in s['openings'] if o['kind']=='door']
        self.assertEqual([(o['hinge_end'],o['side']) for o in doors],[(False,-1),(True,1),(True,-1)])
        s=json.loads((ROOT/'data/generation-specs/new-3/0671843e912d.json').read_text(encoding='utf8'))
        wall=next(w for w in s['walls'] if w['name']=='상부 침실 동측')
        self.assertEqual(wall['thickness'],161)
        self.assertEqual(wall['points'][0][0]-wall['thickness']/2,5639)
        self.assertEqual(wall['points'][0][0]+wall['thickness']/2,5800)

    def test_rooms_connected_to_entrance(self):
        for ident,points in PROBES.items():
            s=json.loads((ROOT/'data/generation-specs/new-3'/(ident+'.json')).read_text(encoding='utf8'))
            s['room_probes']=[dict(name=n,point=[x,y],access_group='main') for n,x,y in points]
            walls,openings,*_=resolve(s);g,solids=join_walls(walls);r=review(s,walls,openings,g,solids)
            self.assertFalse(r['connection_errors'],(ident,r))


if __name__=='__main__':unittest.main()
