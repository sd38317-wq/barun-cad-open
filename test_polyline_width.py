import unittest,io,math
from unittest.mock import patch
import exchange
import ezdxf
from exchange import export_dxf,import_file

class PolylineWidthTest(unittest.TestCase):
 def test_physical_width_survives_external_dxf(self):
  model={'version':2,'units':'mm','layers':[{'id':'sun','name':'일조선','color':'#ff0000'}],'entities':[{'id':'limit','type':'polyline','layer':'sun','points':[{'x':0,'y':0},{'x':10000,'y':20000}],'constantWidth':50,'color':'#ff0000','linetype':'DASHED'}]}
  data,_=export_dxf(model);doc=ezdxf.read(io.StringIO(data.decode('utf8'),newline=None));entity=list(doc.modelspace())[0]
  self.assertEqual(entity.dxftype(),'LWPOLYLINE');self.assertEqual(entity.dxf.const_width,50);self.assertEqual(entity.dxf.linetype,'DASHED');self.assertEqual(entity.dxf.true_color,0xff0000)
  del doc.rootdict['BARUN_CAD_V2'];stream=io.StringIO();doc.write(stream)
  imported=import_file(stream.getvalue().encode('utf8'),'.dxf')['document']['entities'][0]
  self.assertEqual(imported['constantWidth'],50);self.assertEqual(imported['linetype'],'DASHED');self.assertEqual(imported['color'],'#ff0000')

def _import(build):
 doc=ezdxf.new('R2018');doc.header['$INSUNITS']=4;build(doc.modelspace());stream=io.StringIO();doc.write(stream)
 return import_file(stream.getvalue().encode('utf8'),'.dxf')

class ExternalWidthTest(unittest.TestCase):
 """사용자 제보: 기존 도면을 열면 PLINE 폭이 가는 선이 되고, 글자 폭이 1로 바뀐다."""
 def test_vertex_widths_curves_tapers_and_old_polylines_keep_width(self):
  r=_import(lambda m:(m.add_lwpolyline([(0,0,30,30),(1000,0,30,30),(1000,500,30,30)],format='xyse'),
   m.add_lwpolyline([(0,2000,0,0,0),(1000,2000,0,0,1),(2000,2000,0,0,0)],format='xyseb',dxfattribs={'const_width':40}),
   m.add_lwpolyline([(0,3000,100,0),(1000,3000,0,0)],format='xyse'),
   m.add_polyline2d([(0,4000),(1000,4000),(1000,4500)],dxfattribs={'default_start_width':60,'default_end_width':60}),
   m.add_lwpolyline([(0,5000),(1000,5000)])))
  same,curve,taper,old,thin=r['document']['entities']
  self.assertEqual((same['type'],same['constantWidth']),('polyline',30))
  self.assertEqual((curve['type'],curve['constantWidth']),('polyline',40));self.assertGreater(len(curve['points']),10)
  self.assertTrue(any(p['y']<1999 for p in curve['points']),'호가 나뉘어 들어온다')
  self.assertEqual((taper['type'],taper['name']),('block','DXF 폭 폴리선'))
  hatch=taper['entities'][0];self.assertTrue(hatch['solid']);self.assertEqual(sorted(round(p['y']) for p in hatch['points'])[::3],[2950,3050],'시작 폭 100 → 위아래 50씩')
  self.assertEqual((old['type'],old['constantWidth']),('polyline',60))
  self.assertNotIn('constantWidth',thin)
  self.assertNotIn('폴리선 폭 → 중심선',r['report']['converted'])

 def test_mtext_width_code_becomes_width_factor(self):
  r=_import(lambda m:(m.add_mtext(r'\W0.6;좁은 글자',dxfattribs={'insert':(0,0),'char_height':250}),
   m.add_mtext(r'{\W0.8;앞}{\W0.5;뒤}',dxfattribs={'insert':(0,1000),'char_height':250}),
   m.add_mtext('보통',dxfattribs={'insert':(0,2000),'char_height':250})))
  narrow,mixed,plain=r['document']['entities']
  self.assertAlmostEqual(narrow['widthFactor'],.6);self.assertEqual(narrow['text'],'좁은 글자')
  self.assertAlmostEqual(mixed['widthFactor'],.8);self.assertEqual(r['report']['converted']['MTEXT 글자 폭 섞임 → 가장 많은 폭'],1)
  self.assertEqual(plain['widthFactor'],1)



class WidthPrecedenceTest(unittest.TestCase):
    def test_constant_width_wins_over_vertex_widths(self):
        result = _import(lambda m: m.add_lwpolyline(
            [(0, 0, 10, 10), (1000, 0, 10, 10)], format='xyse',
            dxfattribs={'const_width': 40}))
        entity = result['document']['entities'][0]
        self.assertEqual((entity['type'], entity['constantWidth']), ('polyline', 40))

    def test_nonzero_negative_constant_overrides_positive_vertex_widths(self):
        entity = ezdxf.new().modelspace().add_lwpolyline(
            [(0, 0, 10, 10), (1000, 0, 10, 10)], format='xyse',
            dxfattribs={'const_width': -40})
        self.assertEqual(exchange.polyline_widths(entity), ('none', 0))

    def test_unused_last_vertex_and_negative_widths_are_thin(self):
        doc = ezdxf.new()
        m = doc.modelspace()
        for old in (False, True):
            for negative in (False, True):
                with self.subTest(old=old, negative=negative):
                    if old:
                        entity = m.add_polyline2d([(0, 0), (1000, 0)])
                        vertex = entity.vertices[0 if negative else -1]
                        vertex.dxf.start_width = -10 if negative else 10
                        vertex.dxf.end_width = -20 if negative else 20
                    else:
                        points = [(0, 0, -10, -20), (1000, 0, 0, 0)] if negative else [(0, 0, 0, 0), (1000, 0, 10, 20)]
                        entity = m.add_lwpolyline(points, format='xyse', dxfattribs={'const_width': 0})
                    self.assertEqual(exchange.polyline_widths(entity), ('none', 0))
        result = _import(lambda m: (
            m.add_lwpolyline([(0, 0, 0, 0), (1000, 0, 10, 20)], format='xyse'),
            m.add_lwpolyline([(0, 10, -10, -20), (1000, 10, 0, 0)], format='xyse'),
            m.add_polyline2d([(0, 20), (1000, 20)], dxfattribs={'default_start_width': -10, 'default_end_width': -20})))
        self.assertEqual([e['type'] for e in result['document']['entities']], ['polyline'] * 3)
        self.assertTrue(all('constantWidth' not in e for e in result['document']['entities']))

    def test_old_polyline_defaults_only_fill_missing_vertex_widths(self):
        entity = ezdxf.new().modelspace().add_polyline2d(
            [(0, 0), (100, 0), (100, 100)],
            dxfattribs={'default_start_width': 40, 'default_end_width': 40})
        self.assertEqual(exchange.polyline_widths(entity), ('uniform', 40))
        for vertex in entity.vertices:
            vertex.dxf.start_width = vertex.dxf.end_width = 10
        self.assertEqual(exchange.polyline_widths(entity), ('uniform', 10))
        for vertex in entity.vertices[:-1]:
            vertex.dxf.start_width = vertex.dxf.end_width = 0
        self.assertEqual(exchange.polyline_widths(entity), ('none', 0))
        entity.close(True)
        self.assertEqual(exchange.polyline_widths(entity)[0], 'varying')

    def test_negative_component_is_clamped_before_building_trace(self):
        for old in (False, True):
            def build(m):
                if old:
                    entity = m.add_polyline2d([(0, 0), (1000, 0)])
                    entity.vertices[0].dxf.start_width = -100
                    entity.vertices[0].dxf.end_width = 40
                else:
                    m.add_lwpolyline([(0, 0, -100, 40), (1000, 0, 0, 0)], format='xyse')
            with self.subTest(old=old):
                entity = _import(build)['document']['entities'][0]
                points = [p for face in entity['entities'] for p in face['points']]
                self.assertTrue(all(abs(p['y']) < 1e-8 for p in points if abs(p['x']) < 1e-8))
                self.assertEqual(max(p['y'] for p in points), 20)
                self.assertEqual(min(p['y'] for p in points), -20)


class WidthCurveTest(unittest.TestCase):
    def test_width_arcs_do_not_expand_discarded_virtual_entities(self):
        for varying in (False, True):
            def build(m):
                m.add_lwpolyline([(0, 0, 40, 20 if varying else 40, 1), (1000, 0, 0, 0, 0)], format='xyseb')
                m.add_point((2000, 0))
            with self.subTest(varying=varying):
                result = _import(build)
                entity, marker = result['document']['entities']
                expected = '가변 폭 폴리선 → 채운 면' if varying else '곡선 폴리선 폭 → 실폭 폴리선(호 나눔)'
                self.assertEqual(result['report']['converted'], {expected: 1})
                self.assertEqual(result['report']['skipped'], {})
                self.assertEqual(result['report']['imported'], 2)
                count = len(entity['entities']) if varying else 0
                # The next id follows the parent and actual faces, with no discarded ARC ids.
                self.assertEqual(int(marker['id'][12:], 16), count + 2)

    def test_thin_arc_keeps_original_block_behaviour(self):
        result = _import(lambda m: m.add_lwpolyline([(0, 0, 1), (1000, 0, 0)], format='xyb'))
        entity = result['document']['entities'][0]
        self.assertEqual((entity['type'], entity['name']), ('block', 'DXF 곡선 폴리선'))
        self.assertEqual([e['type'] for e in entity['entities']], ['arc'])
        self.assertEqual(result['report']['converted'], {'Bulge 폴리선 → 선/호 블록': 1})

    def test_tiny_bulge_uses_stabilised_copy_for_tapers_and_uniform_curves(self):
        for old in (False, True):
            for varying in (False, True):
                def build(m):
                    points = [(0, 0, 100, 0 if varying else 100, 1e-16),
                              (1000, 0, 100, 100, 0 if varying else 1),
                              (2000, 0, 0, 0, 0)]
                    if old:
                        entity = m.add_polyline2d([(p[0], p[1]) for p in points])
                        for vertex, (_, _, s, e, b) in zip(entity.vertices, points):
                            vertex.dxf.start_width = s; vertex.dxf.end_width = e; vertex.dxf.bulge = b
                    else:
                        m.add_lwpolyline(points[:2] if varying else points, format='xyseb')
                with self.subTest(old=old, varying=varying):
                    result = _import(build)
                    entity = result['document']['entities'][0]
                    points = [p for face in entity['entities'] for p in face['points']] if varying else entity['points']
                    self.assertTrue(all(abs(p[axis]) < 1e6 for p in points for axis in ('x', 'y')))
                    self.assertEqual(result['report']['converted']['미세 Bulge → 직선 (최대 편차 0.000001 mm)'], 1)
                    self.assertNotIn('Bulge 폴리선 → 선/호 블록', result['report']['converted'])
                    if varying:
                        self.assertTrue(all(0 <= p['x'] <= (2000 if old else 1000) for p in points))
                    else:
                        self.assertEqual(entity['points'][:2], [{'x': 0, 'y': 0}, {'x': 1000, 'y': 0}])
                        self.assertTrue(any(p['y'] < -100 for p in points))

    def test_planar_width_paths_use_ocs_xy_and_do_not_inherit_extrusion(self):
        for old in (False, True):
            for bulge in (0, 1):
                for varying in (False, True):
                    def build(m):
                        attrs = {'extrusion': (0, 2e-6, 1)}
                        if old:
                            attrs['elevation'] = (0, 0, 1e7)
                            entity = m.add_polyline2d([(10, 20), (1010, 20)], dxfattribs=attrs)
                            entity.vertices[0].dxf.bulge = bulge
                            for v in entity.vertices:
                                v.dxf.start_width = 40; v.dxf.end_width = 20 if varying else 40
                        else:
                            attrs['elevation'] = 1e7
                            m.add_lwpolyline([(10, 20, 40, 20 if varying else 40, bulge), (1010, 20, 0, 0, 0)], format='xyseb', dxfattribs=attrs)
                    with self.subTest(old=old, bulge=bulge, varying=varying):
                        result = _import(build)
                        entity = result['document']['entities'][0]
                        points = [p for face in entity['entities'] for p in face['points']] if varying else entity['points']
                        self.assertTrue(all(p['x'] > -11 for p in points))
                        if varying:
                            if bulge:
                                self.assertTrue(any(abs(p['x'] + 10) < 1e-6 and abs(p['y'] - 20) < 1e-6 for p in points))
                                self.assertTrue(any(abs(p['x'] - 30) < 1e-6 and abs(p['y'] - 20) < 1e-6 for p in points))
                            else:
                                start = [p for p in points if abs(p['x'] - 10) < 1e-6]
                                self.assertTrue(start)
                                self.assertAlmostEqual(min(p['y'] for p in start), 0)
                                self.assertAlmostEqual(max(p['y'] for p in start), 40)
                            self.assertNotIn('SOLID 미세 기운 법선 → XY 평면', result['report']['converted'])
                        else:
                            self.assertEqual(points[0], {'x': 10, 'y': 20})
                            self.assertEqual(points[-1], {'x': 1010, 'y': 20})

    def test_flipped_width_polylines_are_flipped_once(self):
        def build(m):
            for varying in (False, True):
                m.add_lwpolyline([(10, 20, 40, 20 if varying else 40, 1), (1010, 20, 0, 0, 0)],
                                 format='xyseb', dxfattribs={'extrusion': (0, 0, -1)})
        uniform, varying = _import(build)['document']['entities']
        self.assertEqual(uniform['points'][0], {'x': -10, 'y': 20})
        self.assertEqual(uniform['points'][-1], {'x': -1010, 'y': 20})
        self.assertTrue(all(p['x'] < 11 for face in varying['entities'] for p in face['points']))

    def test_uniform_arcs_match_exact_circle_and_sagitta_including_closure(self):
        for old in (False, True):
            for clockwise in (False, True):
                def build(m):
                    sign = -1 if clockwise else 1
                    points = [(10000, 0, 2, 2, sign), (-10000, 0, 2, 2, sign)]
                    if old:
                        entity = m.add_polyline2d([(p[0], p[1]) for p in points], close=True)
                        for v in entity.vertices:
                            v.dxf.start_width = v.dxf.end_width = 2; v.dxf.bulge = sign
                    else:
                        m.add_lwpolyline(points, format='xyseb', close=True)
                with self.subTest(old=old, clockwise=clockwise):
                    entity = _import(build)['document']['entities'][0]
                    points = entity['points']
                    self.assertTrue(entity['closed'])
                    self.assertLessEqual(len(points), 20000)
                    self.assertNotEqual(points[0], points[-1])
                    self.assertEqual(entity['constantWidth'], 2)
                    self.assertTrue(any(p['y'] > 9990 for p in points))
                    self.assertTrue(any(p['y'] < -9990 for p in points))
                    for a, b in zip(points, points[1:] + points[:1]):
                        self.assertAlmostEqual(math.hypot(a['x'], a['y']), 10000, places=6)
                        midpoint_radius = math.hypot((a['x'] + b['x']) / 2, (a['y'] + b['y']) / 2)
                        self.assertLessEqual(10000 - midpoint_radius, .1 + 1e-8)

    def test_large_uniform_arc_falls_back_to_old_block_above_point_limit(self):
        result = _import(lambda m: m.add_lwpolyline([(0, 0, 1), (2e8, 0, 0)], format='xyb', dxfattribs={'const_width': 1}))
        entity = result['document']['entities'][0]
        self.assertEqual((entity['type'], entity['name']), ('block', 'DXF 곡선 폴리선'))
        self.assertEqual(result['report']['converted'], {'Bulge 폴리선 → 선/호 블록': 1})

    def test_thin_varying_arc_faces_follow_true_offset_with_sub_mm_accuracy(self):
        radius = 10000
        result = _import(lambda m: m.add_lwpolyline(
            [(radius, 0, 2, 4, math.tan(math.pi / 8)), (0, radius, 0, 0, 0)], format='xyseb'))
        faces = result['document']['entities'][0]['entities']
        self.assertGreater(len(faces), 100)
        def assert_offset(p):
            angle = max(0, min(math.pi / 2, math.atan2(p['y'], p['x'])))
            half_width = 1 + angle / (math.pi / 2)
            self.assertLess(abs(abs(math.hypot(p['x'], p['y']) - radius) - half_width), .5)
        for face in faces:
            points = face['points']
            for p in points:assert_offset(p)
            for a, b in zip(points, points[1:] + points[:1]):
                # Check the edges along the curve as well as exact radial stations.
                if abs(math.atan2(a['y'], a['x']) - math.atan2(b['y'], b['x'])) > 1e-8:
                    assert_offset({'x': (a['x'] + b['x']) / 2, 'y': (a['y'] + b['y']) / 2})

    def test_trace_resolution_uses_largest_radius_smallest_used_width_and_bounds(self):
        doc = ezdxf.new()
        for radius, expected in ((1, 32), (1e9, 4096)):
            entity = doc.modelspace().add_lwpolyline(
                [(radius, 0, 2, 4, 1), (-radius, 0, 0, 0, 0)], format='xyseb')
            self.assertEqual(exchange.width_trace_segments(entity, .1), expected)
        with patch.object(exchange.TraceBuilder, 'from_polyline', wraps=exchange.TraceBuilder.from_polyline) as trace:
            result = _import(lambda m: m.add_lwpolyline(
                [(100, 0, 100, 100, 1), (-100, 0, 2, 4, 0),
                 (10000, 0, 2, 4, 1), (-10000, 0, .001, .001, 0)], format='xyseb'))
        self.assertEqual(len(result['document']['entities']), 1)
        n = trace.call_args.kwargs['segments']
        self.assertLessEqual(10000 * (1 - math.cos(math.pi / n)), .1)
        self.assertGreater(10000 * (1 - math.cos(math.pi / (n - 1))), .1)


class MtextWidthScannerTest(unittest.TestCase):
    def test_scoped_relative_escaped_and_mixed_widths(self):
        cases = [
            (r'{\W0.5;}ABC', 1, None),
            (r'\W2;\W0.5x;ABC', 1, None),
            (r'ABC{\W0.8;DEF}', 1, 'mixed'),
            (r'\\W0.8;ABC', 1, None),
            (r'A{\W0.8;BCDE}', .8, 'mixed'),
            (r'\W2;A{\W0.5x;BC{\W0.5x;D}EH}FG', 1, 'mixed'),
            (r'\W0.5;    {\W0.8;ABC}', .8, 'code'),
            (r'\W0.8;\{ABC\}', .8, 'code'),
            (r'{\W0.5;}   ', 1, None),
        ]
        for raw, width, report in cases:
            with self.subTest(raw=raw):
                result = _import(lambda m: m.add_mtext(raw))
                entity = result['document']['entities'][0]
                self.assertAlmostEqual(entity['widthFactor'], width)
                converted = result['report']['converted']
                self.assertEqual(converted.get('MTEXT 글자 폭 섞임 → 가장 많은 폭', 0), int(report == 'mixed'))
                self.assertEqual(converted.get('MTEXT 글자 폭 코드 → 글자 폭', 0), int(report == 'code'))
                self.assertEqual(entity['codeWidth'], width)

    def test_percent_symbols_count_as_one_visible_character(self):
        for symbol in ('%%d', '%%c', '%%p', '%%D', '%%C', '%%P'):
            with self.subTest(symbol=symbol):
                raw = r'\W0.5;' + symbol + r'{\W0.8;AB}'
                result = _import(lambda m: m.add_mtext(raw))
                entity = result['document']['entities'][0]
                self.assertEqual(len(entity['text']), 3)
                self.assertEqual(entity['widthFactor'], .8)
                self.assertEqual(result['report']['converted']['MTEXT 글자 폭 섞임 → 가장 많은 폭'], 1)

    def test_other_format_codes_do_not_count_as_visible_characters(self):
        raw = r'\W0.5;\A1;\C256;\c16777215;\FLongFontName;\fArial|b1;\H100x;\Q30;\T5;\pql;\S123456/789;\P\L\l\O\o\K\k\N\~{\W0.8;ABC}'
        result = _import(lambda m: m.add_mtext(raw))
        entity = result['document']['entities'][0]
        self.assertEqual(entity['widthFactor'], .8)
        self.assertNotIn('MTEXT 글자 폭 섞임 → 가장 많은 폭', result['report']['converted'])
        self.assertEqual(result['report']['converted']['MTEXT 글자 폭 코드 → 글자 폭'], 1)

    def test_style_width_is_initial_and_restored_by_groups(self):
        def build(m):
            m.doc.styles.get('Standard').dxf.width = .7
            m.add_mtext(r'{\W0.5;}ABC')
            m.add_mtext(r'\W2x;\W0.5x;ABC')
            m.add_mtext(r'A{\W2x;BBBB}')
        result = _import(build)
        self.assertEqual([e['widthFactor'] for e in result['document']['entities']], [.7, .7, 1.4])
        self.assertEqual(result['report']['converted'].get('MTEXT 글자 폭 코드 → 글자 폭', 0), 0)
        self.assertEqual(result['report']['converted']['MTEXT 글자 폭 섞임 → 가장 많은 폭'], 1)

    def test_export_width_edit_does_not_reuse_stale_mtext_codes(self):
        for raw in (r'\W0.6;ABC', r'\W0.6;ABC\PDEF', r'A{\W0.6;BCDE}'):
            for new_width in (1, 1.25):
                with self.subTest(raw=raw, new_width=new_width):
                    model = _import(lambda m: m.add_mtext(raw))['document']
                    entity = model['entities'][0]
                    self.assertEqual(entity['codeWidth'], .6)
                    entity['widthFactor'] = new_width
                    data, _ = export_dxf(model)
                    doc = ezdxf.read(io.StringIO(data.decode('utf8'), newline=None))
                    mtext = doc.modelspace().query('MTEXT')[0]
                    self.assertNotEqual(mtext.text, raw)
                    if new_width != 1:self.assertTrue(mtext.text.startswith(r'\W1.25;'))
                    if 'BARUN_CAD_V2' in doc.rootdict:del doc.rootdict['BARUN_CAD_V2']
                    stream = io.StringIO(); doc.write(stream)
                    imported = import_file(stream.getvalue().encode('utf8'), '.dxf')['document']['entities'][0]
                    self.assertEqual(imported['widthFactor'], new_width)
                    self.assertEqual(imported['text'], entity['text'])

    def test_plain_style_width_keeps_its_original_precision(self):
        def build(m):
            m.doc.styles.get('Standard').dxf.width = 1 / 3
            m.add_mtext(r'{\W0.5;}ABC')
        result = _import(build)
        self.assertEqual(result['document']['entities'][0]['widthFactor'], 1 / 3)
        self.assertNotIn('MTEXT 글자 폭 코드 → 글자 폭', result['report']['converted'])

    def test_width_edit_to_one_overrides_non_unit_style(self):
        def build(m):
            m.doc.styles.get('Standard').dxf.width = .7
            m.add_mtext(r'\W0.6;ABC')
        model = _import(build)['document']
        model['entities'][0]['widthFactor'] = 1
        data, _ = export_dxf(model)
        doc = ezdxf.read(io.StringIO(data.decode('utf8'), newline=None))
        self.assertEqual(doc.modelspace().query('MTEXT')[0].text, r'\W1;ABC')
        del doc.rootdict['BARUN_CAD_V2']
        stream = io.StringIO(); doc.write(stream)
        imported = import_file(stream.getvalue().encode('utf8'), '.dxf')['document']['entities'][0]
        self.assertEqual(imported['widthFactor'], 1)

    def test_fresh_multiline_and_masked_mtext_exports_width_code(self):
        for text, mask in (('ABC\nDEF', False), ('ABC', True)):
            model = {'version': 2, 'units': 'mm', 'layers': [{'id': '0', 'name': '0', 'color': '#ffffff'}],
                     'entities': [{'id': 't', 'layer': '0', 'type': 'text', 'text': text,
                                   'position': {'x': 0, 'y': 0}, 'height': 100,
                                   'widthFactor': .75, 'backgroundMask': mask}]}
            data, _ = export_dxf(model)
            doc = ezdxf.read(io.StringIO(data.decode('utf8'), newline=None))
            self.assertTrue(doc.modelspace().query('MTEXT')[0].text.startswith(r'\W0.75;'))


if __name__=='__main__':unittest.main()
