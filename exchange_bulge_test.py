"""Regression for a valid near-straight segment producing an invalid huge arc."""
import math
import base64
import io
import zlib
import unittest
from unittest.mock import patch
import ezdxf
import exchange
from exchange_test import standard_bytes


class StableBulgeTest(unittest.TestCase):
    def test_tiny_bulge_import_preserves_endpoints_source_and_meaningful_arc(self):
        for sign in (1,-1):
            with self.subTest(sign=sign):
                doc=ezdxf.new('R2018');doc.units=4
                source=doc.modelspace().add_lwpolyline([(0,0,sign*2.8549385e-11),(1552,0,.5),(2000,0,0)],format='xyb')
                before=list(source.get_points('xyb'));handle=source.dxf.handle
                result=exchange.import_file(standard_bytes(doc),'.dxf')
                block=result['document']['entities'][0]
                self.assertEqual(block['sourceHandle'],handle)
                line,arc=block['entities']
                self.assertEqual(line['type'],'line')
                self.assertEqual(line['points'],[{'x':0.0,'y':0.0},{'x':1552.0,'y':0.0}])
                self.assertEqual(arc['type'],'arc')
                self.assertTrue(math.isfinite(arc['radius']) and 0<arc['radius']<=1e12)
                self.assertEqual(list(source.get_points('xyb')),before)
                self.assertEqual(result['report']['converted']['미세 Bulge → 직선 (최대 편차 0.000001 mm)'],1)

    def test_copy_widths_closed_segment_and_unit_scaled_tolerance(self):
        doc=ezdxf.new('R2018')
        source=doc.modelspace().add_lwpolyline([(0,0,2,3,0),(1000,0,4,5,1e-11)],format='xyseb',close=True)
        before=list(source.get_points('xyseb'))
        stable,count=exchange.stable_bulge_polyline(source,1)
        self.assertEqual(count,1);self.assertTrue(stable.closed)
        self.assertEqual(list(stable.get_points('xyseb'))[1],(1000,0,4,5,0))
        self.assertEqual(list(source.get_points('xyseb')),before)
        # The same source units at a much larger mm scale are not negligible.
        unchanged,count=exchange.stable_bulge_polyline(source,1000)
        self.assertIs(unchanged,source);self.assertEqual(count,0)

    def test_legacy_polyline_copy_and_all_straight_import(self):
        doc=ezdxf.new('R2018');doc.units=4
        source=doc.modelspace().add_polyline2d([(0,0),(1552,0)])
        source.vertices[0].dxf.bulge=2.8549385e-11
        stable,count=exchange.stable_bulge_polyline(source,1)
        self.assertEqual(count,1);self.assertEqual(stable.vertices[0].dxf.bulge,0)
        self.assertNotEqual(source.vertices[0].dxf.bulge,0)
        result=exchange.import_file(standard_bytes(doc),'.dxf')['document']['entities'][0]
        self.assertEqual(result['type'],'polyline')
        self.assertEqual(result['points'],[{'x':0.0,'y':0.0},{'x':1552.0,'y':0.0}])

    def test_import_tolerance_is_mm_for_each_supported_source_unit(self):
        for units,factor in ((0,1),(4,1),(5,10),(6,1000),(1,25.4)):
            with self.subTest(units=units):
                doc=ezdxf.new('R2018');doc.units=units
                doc.modelspace().add_lwpolyline([(0,0,1e-11),(1000/factor,0,0)],format='xyb')
                result=exchange.import_file(standard_bytes(doc),'.dxf')
                imported=result['document']['entities'][0]
                self.assertEqual(imported['type'],'polyline')
                self.assertAlmostEqual(imported['points'][1]['x'],1000)
                self.assertEqual(result['report']['unitScaleToMM'],factor)
                self.assertEqual(result['report']['converted']['미세 Bulge → 직선 (최대 편차 0.000001 mm)'],1)

    def test_large_real_arc_and_non_negligible_bulge_are_not_relaxed(self):
        doc=ezdxf.new('R2018');doc.units=4
        doc.modelspace().add_arc((0,0),2e12,0,90)
        # >1e12 mm radius but sagitta >1e-6 mm: retain the original policy.
        doc.modelspace().add_lwpolyline([(0,0,1e-6),(1e7,0,0)],format='xyb')
        result=exchange.import_file(standard_bytes(doc),'.dxf')
        self.assertEqual(result['document']['entities'][0]['radius'],2e12)
        self.assertEqual(result['document']['entities'][1]['entities'][0]['type'],'arc')
        self.assertNotIn('미세 Bulge → 직선 (최대 편차 0.000001 mm)',result['report']['converted'])

    def test_shared_definition_uses_largest_instance_scale_and_preserves_source(self):
        for scales,expected in (((1,), 'polyline'),((1,1e8),'block')):
            with self.subTest(scales=scales):
                doc=ezdxf.new('R2018');doc.units=4
                block=doc.blocks.new('fixture')
                bulge=2.8549385e-11
                block.add_lwpolyline([(0,0,bulge),(1552,0,0)],format='xyb')
                for scale in scales:doc.modelspace().add_blockref('fixture',(0,0),dxfattribs={'xscale':scale,'yscale':scale,'zscale':scale})
                raw=standard_bytes(doc)
                # Exercise the actual shared-definition normalizer; the DWG
                # converter alone is stubbed with the equivalent source DXF.
                with patch.object(exchange,'dwg_to_dxf',side_effect=lambda source,folder,split_lines=True:(source,'fixture',[],{'timings_ms':{}})):
                    result=exchange.import_file(raw,'.dwg')
                entity=result['document']['sharedBlocks']['fixture']['entities'][0]
                self.assertEqual(entity['type'],expected)
                if expected=='block':self.assertGreater(entity['entities'][0]['radius'],1e12)
                saved=zlib.decompress(base64.b64decode(result['document']['dxfPreservation']['data']))
                self.assertEqual(saved,raw)
                # Decode the preserved DXF itself: the source arc is retained
                # even when its editable preview was safely straightened.
                restored=ezdxf.read(io.StringIO(saved.decode('utf8')))
                self.assertEqual(list(restored.blocks.get('fixture').query('LWPOLYLINE'))[0].get_points('xyb')[0][2],bulge)

    def test_nested_nonuniform_reflected_and_cyclic_scale_bounds_are_conservative(self):
        doc=ezdxf.new('R2018')
        leaf=doc.blocks.new('leaf');leaf.add_line((0,0),(1,0))
        outer=doc.blocks.new('outer')
        outer.add_blockref('leaf',(0,0),dxfattribs={'xscale':1e5,'yscale':1e5,'zscale':1e5,'rotation':30})
        doc.modelspace().add_blockref('outer',(0,0),dxfattribs={'xscale':-1e3,'yscale':2,'zscale':1,'rotation':45})
        bounds=exchange.block_reference_scale_bounds(doc)
        self.assertEqual(bounds['leaf'],1e8)
        source=leaf.add_lwpolyline([(0,0,2.8549385e-11),(1552,0,0)],format='xyb')
        stable,count=exchange.stable_bulge_polyline(source,1,bounds['leaf'])
        self.assertIs(stable,source);self.assertEqual(count,0)
        outer.add_blockref('outer',(0,0),dxfattribs={'xscale':2,'yscale':2,'zscale':2})
        self.assertTrue(math.isinf(exchange.block_reference_scale_bounds(doc)['leaf']))


if __name__=='__main__':unittest.main()
