"""DXF references must stay compact without losing special INSERT geometry."""
import base64
import io
import math
import unittest
import zlib
from unittest.mock import patch

import ezdxf
from ezdxf.xclip import XClip

import exchange


def drawing_bytes(doc):
    stream=io.StringIO();doc.write(stream)
    return stream.getvalue().encode('utf-8')


class DxfSharedImportTest(unittest.TestCase):
    def drawing(self):
        doc=ezdxf.new('R2018');doc.units=4
        block=doc.blocks.new('UNIT',base_point=(5,7))
        block.add_line((5,7),(15,7))
        return doc

    def test_repeated_dxf_normalizes_definition_once_and_preserves_source(self):
        doc=self.drawing()
        for i in range(100):
            doc.modelspace().add_blockref('UNIT',(i*100,20),dxfattribs={'xscale':2,'yscale':2,'rotation':90})
        raw=drawing_bytes(doc)
        # Sharing must avoid calling virtual_entities for every instance.
        with patch('ezdxf.entities.Insert.virtual_entities',side_effect=AssertionError('expanded repeated INSERT')):
            result=exchange.import_file(raw,'.dxf')
        model=result['document'];definition=model['sharedBlocks']['UNIT']
        self.assertEqual(model['version'],3)
        self.assertEqual(len(definition['entities']),1)
        self.assertEqual(definition['origin'],{'x':5.0,'y':7.0})
        self.assertEqual(len(model['entities']),100)
        self.assertTrue(all(e['sharedBlock']=='UNIT' and e['entities']==[] for e in model['entities']))
        self.assertEqual(model['entities'][1]['position'],{'x':100.0,'y':20.0})
        self.assertEqual(model['entities'][1]['scale'],2)
        self.assertEqual(model['entities'][1]['rotation'],90)
        self.assertEqual(zlib.decompress(base64.b64decode(model['dxfPreservation']['data'])),raw)
        self.assertEqual(result['report']['skipped'],{})
        self.assertEqual(model['blocks'][0]['sharedBlock'],'UNIT')
        self.assertEqual(model['blocks'][0]['position'],model['entities'][0]['position'])

    def test_clipped_insert_shares_its_definition_and_keeps_the_world_clip(self):
        # 2026-09-29: clipped INSERTs share their definition (a 9.8 MB plan expanded 198k clipped children and ran out of memory);
        # the world clip rides on the reference exactly as it did on the expanded block (test_shared_mirror_insert compares the drawing).
        doc=self.drawing();ref=doc.modelspace().add_blockref('UNIT',(100,200))
        XClip(ref).set_wcs_clipping_path([(100,190),(105,210)])
        document=exchange.import_file(drawing_bytes(doc),'.dxf')['document'];result=document['entities'][0]
        self.assertEqual(result['sharedBlock'],'UNIT')
        self.assertTrue(result['clip']['enabled'])
        self.assertEqual(result['clip']['points'][0],{'x':100.0,'y':190.0})
        points=document['sharedBlocks']['UNIT']['entities'][0]['points'];self.assertEqual(points[1]['x']-points[0]['x'],10.0)

    def test_nonuniform_and_array_inserts_share_their_definition(self):
        # ACAD200 604: 비균일 축척은 scaleX/scaleY 참조로, MINSERT 는 칸마다 같은 정의의 참조로 공유한다(예전: 통째로 펼침).
        doc=self.drawing();doc.modelspace().add_blockref('UNIT',(100,200),dxfattribs={'xscale':2,'yscale':1,'rotation':30})
        ref=doc.modelspace().query('INSERT')[0];self.assertTrue(exchange.can_share_block_reference(ref))
        result=exchange.import_file(drawing_bytes(doc),'.dxf');entity=result['document']['entities'][0]
        self.assertEqual(result['report']['skipped'],{})
        self.assertEqual((entity['sharedBlock'],entity['scaleX'],entity['scaleY'],entity['rotation']),('UNIT',2.0,1.0,30.0))
        doc=self.drawing();doc.modelspace().add_blockref('UNIT',(100,200),dxfattribs={'row_count':2,'row_spacing':20,'column_count':3,'column_spacing':50})
        result=exchange.import_file(drawing_bytes(doc),'.dxf');entity=result['document']['entities'][0]
        self.assertEqual(result['report']['skipped'],{})
        self.assertNotIn('sharedBlock',entity);self.assertEqual(entity['minsert'],{'rows':2,'cols':3})
        self.assertEqual(len(entity['entities']),6);self.assertTrue(all(cell['sharedBlock']=='UNIT' for cell in entity['entities']))
        self.assertEqual(sorted((c['position']['x'],c['position']['y']) for c in entity['entities']),sorted((100.0+50*j,200.0+20*i) for i in range(2) for j in range(3)))

    def test_nonuniform_insert_of_block_with_lwpolyline_is_not_dropped(self):
        # 10-25 글자 전수 검사: 폴리선이 든 블록을 비균일 축척으로 넣으면 굴곡 검사가 (bulge,) 묶음을 float() 해
        # TypeError → INSERT 통째로 '읽기 실패' 로 빠졌다(magnicad 화이트보드 도곽 글자 13개).
        for bulge in (0, 0.5):
            with self.subTest(bulge=bulge):
                doc=ezdxf.new('R2018');doc.units=4
                block=doc.blocks.new('FORM',base_point=(0,0))
                block.add_lwpolyline([(0,0,0,0,bulge),(10,0),(10,5)],format='xyseb');block.add_text('DRAWING NO.',dxfattribs={'height':2})
                doc.modelspace().add_blockref('FORM',(100,200),dxfattribs={'xscale':2,'yscale':1})
                ref=doc.modelspace().query('INSERT')[0]
                self.assertFalse(exchange.nonuniform_safe_block(ref),'글자가 든 정의는 펼친다')
                result=exchange.import_file(drawing_bytes(doc),'.dxf')
                self.assertEqual(result['report']['skipped'],{})
                texts=[c for e in result['document']['entities'] for c in e.get('entities',[]) if c.get('type')=='text']
                self.assertEqual([t['text'] for t in texts],['DRAWING NO.'])
                doc=ezdxf.new('R2018');block=doc.blocks.new('LINES');block.add_lwpolyline([(0,0,0,0,bulge),(10,0)],format='xyseb')
                ref=doc.modelspace().add_blockref('LINES',(0,0),dxfattribs={'xscale':3,'yscale':1})
                self.assertEqual(exchange.nonuniform_safe_block(ref),bulge==0,'굴곡 없는 폴리선만 정의 공유')

    def test_text_only_in_a_layout_tab_is_reported(self):
        # 10-25: 배치 탭에만 있는 글자는 모형 공간만 그리는 바른 CAD 화면에 안 보인다 → 가져오기 경고로 알린다.
        doc=ezdxf.new('R2018');doc.units=4;doc.modelspace().add_line((0,0),(10,0))
        paper=doc.layouts.get('Layout1');paper.add_text('석재 마감',dxfattribs={'height':3});paper.add_text('줄눈',dxfattribs={'height':3})
        report=exchange.import_file(drawing_bytes(doc),'.dxf')['report']
        notice=[w for w in report['warnings'] if '배치 탭에만' in w]
        self.assertEqual(len(notice),1);self.assertIn("'Layout1' 글자 2개",notice[0]);self.assertIn('모형 공간에는 글자가 없고',notice[0])
        self.assertEqual(report['paperSpaceText']['layouts'][0]['text'],2);self.assertFalse(report['paperSpaceText']['modelHasText'])
        doc.modelspace().add_text('평면',dxfattribs={'height':3})
        report=exchange.import_file(drawing_bytes(doc),'.dxf')['report']
        self.assertTrue(report['paperSpaceText']['modelHasText']);self.assertFalse(any('모형 공간에는 글자가 없고' in w for w in report['warnings']))
        empty=ezdxf.new('R2018');empty.modelspace().add_text('평면')
        self.assertNotIn('paperSpaceText',exchange.import_file(drawing_bytes(empty),'.dxf')['report'])

    def test_double_negative_scale_is_shared_as_a_half_turn_with_identical_geometry(self):
        # det(S(-s,-s)) = +s^2: a rotation by 180 degrees at scale s. Sharing it
        # must reproduce ezdxf's own expansion point for point.
        doc=ezdxf.new('R2018');doc.units=4
        block=doc.blocks.new('UNIT',base_point=(5,7))
        block.add_line((5,7),(15,9));block.add_lwpolyline([(0,0),(4,1),(6,5)],close=True)
        block.add_circle((8,3),2);block.add_arc((1,2),3,20,110)
        cases=[({'xscale':-1,'yscale':-1,'rotation':0},(100,200)),({'xscale':-2.5,'yscale':-2.5,'rotation':33},(-40,75)),({'xscale':-1,'yscale':-1,'rotation':270},(3,4))]
        for attrs,at in cases:doc.modelspace().add_blockref('UNIT',at,dxfattribs=attrs)
        model=exchange.import_file(drawing_bytes(doc),'.dxf')['document']
        definition=model['sharedBlocks']['UNIT'];origin=definition['origin']
        for (attrs,at),entity in zip(cases,model['entities']):
            with self.subTest(attrs=attrs):
                self.assertEqual(entity['sharedBlock'],'UNIT')
                self.assertGreater(entity['scale'],0)
                ref=[e for e in doc.modelspace() if e.dxftype()=='INSERT'][cases.index((attrs,at))]
                r=math.radians(entity['rotation']);c,sn=math.cos(r),math.sin(r);k=entity['scale'];p=entity['position']
                world=lambda q:(p['x']+k*(c*(q['x']-origin['x'])-sn*(q['y']-origin['y'])),p['y']+k*(sn*(q['x']-origin['x'])+c*(q['y']-origin['y'])))
                expected=list(ref.virtual_entities())
                line=[e for e in expected if e.dxftype()=='LINE'][0];mine=[e for e in definition['entities'] if e['type']=='line'][0]
                for q,v in zip(mine['points'],[line.dxf.start,line.dxf.end]):
                    self.assertAlmostEqual(world(q)[0],v.x,9);self.assertAlmostEqual(world(q)[1],v.y,9)
                poly=[e for e in expected if e.dxftype()=='LWPOLYLINE'][0];mine=[e for e in definition['entities'] if e['type']=='polyline'][0]
                for q,v in zip(mine['points'],poly.get_points('xy')):
                    self.assertAlmostEqual(world(q)[0],v[0],9);self.assertAlmostEqual(world(q)[1],v[1],9)
                circle=[e for e in expected if e.dxftype()=='CIRCLE'][0];mine=[e for e in definition['entities'] if e['type']=='circle'][0]
                self.assertAlmostEqual(world(mine['center'])[0],circle.dxf.center.x,9);self.assertAlmostEqual(world(mine['center'])[1],circle.dxf.center.y,9)
                self.assertAlmostEqual(k*mine['radius'],circle.dxf.radius,9)
                arc=[e for e in expected if e.dxftype()=='ARC'][0];mine=[e for e in definition['entities'] if e['type']=='arc'][0]
                self.assertAlmostEqual(world(mine['center'])[0],arc.dxf.center.x,9);self.assertAlmostEqual(world(mine['center'])[1],arc.dxf.center.y,9)
                turn=lambda a:a%360
                self.assertAlmostEqual(turn(mine['startAngle']+entity['rotation']),turn(arc.dxf.start_angle),7)
                self.assertAlmostEqual(turn(mine['endAngle']+entity['rotation']),turn(arc.dxf.end_angle),7)

    def test_nested_definition_and_attributes_survive_export_without_preservation(self):
        doc=self.drawing();outer=doc.blocks.new('OUTER')
        outer.add_blockref('UNIT',(10,20),dxfattribs={'xscale':3,'yscale':3})
        ref=doc.modelspace().add_blockref('OUTER',(100,200))
        ref.add_attrib('NAME','room',(105,205))
        model=exchange.import_file(drawing_bytes(doc),'.dxf')['document']
        self.assertEqual(model['sharedBlocks']['OUTER']['entities'][0]['sharedBlock'],'UNIT')
        self.assertEqual(model['entities'][0]['attributes'],{'NAME':'room'})
        self.assertEqual(model['entities'][0]['entities'][0]['text'],'room')
        model.pop('dxfPreservation')
        model.pop('sourceCoverage')  # Inspect a new geometry-only export of this fixture.
        raw,_=exchange.export_dxf(model)
        restored=ezdxf.read(io.StringIO(raw.decode('utf-8'),newline=None))
        top=list(restored.modelspace().query('INSERT'))[0]
        nested=list(restored.blocks.get(top.dxf.name).query('INSERT'))[0]
        self.assertEqual(nested.dxf.xscale,3)
        self.assertEqual(len(restored.blocks.get(nested.dxf.name).query('LINE')),1)

    def test_scaled_hatch_curve_keeps_point_one_mm_world_tolerance(self):
        doc=ezdxf.new('R2018');doc.units=4;block=doc.blocks.new('CURVE')
        hatch=block.add_hatch();hatch.paths.add_edge_path().add_arc((0,0),1,0,360)
        for scale in (1,1000):doc.modelspace().add_blockref('CURVE',(0,0),dxfattribs={'xscale':scale,'yscale':scale})
        result=exchange.import_file(drawing_bytes(doc),'.dxf')
        self.assertEqual(result['report']['skipped'],{})
        points=result['document']['sharedBlocks']['CURVE']['entities'][0]['points']
        # ezdxf first represents arcs with cubic Beziers. Preserve the old
        # world-space tessellation (including that existing approximation).
        with patch.object(exchange,'can_share_block_reference',return_value=False):
            expanded=exchange.import_file(drawing_bytes(doc),'.dxf')['document']['entities'][1]['entities'][0]['points']
        self.assertEqual(len(points),len(expanded))
        self.assertLess(max(math.hypot(a['x']*1000-b['x'],a['y']*1000-b['y']) for a,b in zip(points,expanded)),1e-8)
        errors=[]
        for a,b in zip(points,points[1:]):
            angle=math.atan2(a['x']*b['y']-a['y']*b['x'],a['x']*b['x']+a['y']*b['y'])
            errors.append((1-math.cos(angle/2))*1000)
        self.assertLessEqual(max(errors),.1)
        self.assertGreater(len(points),200)

    def test_nested_scaled_spline_keeps_point_one_mm_world_tolerance(self):
        doc=ezdxf.new('R2018');doc.units=4;leaf=doc.blocks.new('CURVE')
        leaf.add_open_spline([(0,0),(0,1),(1,1),(1,0)],degree=3)
        parent=doc.blocks.new('PARENT');parent.add_blockref('CURVE',(0,0),dxfattribs={'xscale':100,'yscale':100})
        doc.modelspace().add_blockref('PARENT',(0,0),dxfattribs={'xscale':10,'yscale':10})
        result=exchange.import_file(drawing_bytes(doc),'.dxf')
        self.assertEqual(result['report']['skipped'],{})
        points=result['document']['sharedBlocks']['CURVE']['entities'][0]['points']
        def segment_distance(x,y,a,b):
            dx=b['x']-a['x'];dy=b['y']-a['y'];length=dx*dx+dy*dy
            t=max(0,min(1,((x-a['x'])*dx+(y-a['y'])*dy)/length))
            return math.hypot(x-a['x']-t*dx,y-a['y']-t*dy)
        errors=[]
        for step in range(1001):
            t=step/1000;x=3*t*t-2*t*t*t;y=3*t*(1-t)
            errors.append(min(segment_distance(x,y,a,b) for a,b in zip(points,points[1:]))*1000)
        self.assertLessEqual(max(errors),.1)


if __name__=='__main__':unittest.main()
