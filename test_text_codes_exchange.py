"""501·502·504·505 문자 원문 코드와 자리맞추기 DXF 왕복 시험(외부 CAD 가 읽는 실제 DXF 기준)."""
import io, math, tempfile, unittest
from pathlib import Path
import ezdxf
from ezdxf.enums import TextEntityAlignment
import exchange


def dxf_bytes(doc):
    stream = io.StringIO(); doc.write(stream); return stream.getvalue().encode('utf8')


def doc_model(entities):
    for i, e in enumerate(entities): e.setdefault('id', f't{i}'); e.setdefault('layer', 'default')
    return {'version': 2, 'units': 'mm', 'layers': [{'id': 'default', 'name': '0', 'color': '#ffffff', 'visible': True, 'locked': False}], 'blocks': [], 'entities': entities}


def foreign(data):
    """내장 모델을 지운 DXF(= AutoCAD 가 저장한 것과 같은 조건)로 다시 읽는다."""
    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / 'out.dxf'; path.write_bytes(data); doc = ezdxf.readfile(path)
    if 'BARUN_CAD_V2' in doc.rootdict: del doc.rootdict['BARUN_CAD_V2']
    return doc, exchange.import_file(dxf_bytes(doc), '.dxf')['document']['entities']


class PercentCodes(unittest.TestCase):
    def test_import_decodes_percent_codes_and_keeps_raw(self):
        d = ezdxf.new('R2018'); d.units = 4; m = d.modelspace()
        m.add_text('%%c100 90%%d %%p5 %%%', dxfattribs={'height': 100})
        m.add_text('%%u밑줄%%u', dxfattribs={'height': 100, 'insert': (0, 500)})
        m.add_text('보통 문자', dxfattribs={'height': 100, 'insert': (0, 900)})
        es = exchange.import_file(dxf_bytes(d), '.dxf')['document']['entities']
        self.assertEqual(es[0]['text'], 'Ø100 90° ±5 %')
        self.assertEqual((es[0]['codeKind'], es[0]['codeText'], es[0]['codePlain']), ('text', '%%c100 90%%d %%p5 %%%', 'Ø100 90° ±5 %'))
        self.assertEqual(es[1]['text'], '밑줄')
        self.assertNotIn('codeText', es[2])  # 코드 없는 문자는 원문을 따로 두지 않는다(메모리)

    def test_export_unedited_keeps_raw_and_edited_encodes(self):
        es = [{'type': 'text', 'position': {'x': 0, 'y': 0}, 'text': '밑줄', 'height': 100, 'rotation': 0, 'codeKind': 'text', 'codeText': '%%u밑줄%%u', 'codePlain': '밑줄'},
              {'type': 'text', 'position': {'x': 0, 'y': 300}, 'text': 'Ø20 50% ±3', 'height': 100, 'rotation': 0, 'codeKind': 'text', 'codeText': '%%u옛글%%u', 'codePlain': '옛글'}]
        data, _ = exchange.export_dxf(doc_model(es))
        doc, back = foreign(data)
        raw = [t.dxf.text for t in doc.modelspace().query('TEXT')]
        self.assertEqual(raw, ['%%u밑줄%%u', '%%c20 50% %%p3'])
        self.assertEqual([e['text'] for e in back], ['밑줄', 'Ø20 50% ±3'])

    def test_helpers_match_js_rules(self):
        self.assertEqual(exchange.encode_percent('50%%'), '50%%%%%%')
        self.assertEqual(exchange.percent_to_plain(exchange.encode_percent('%Ø')), '%Ø')
        self.assertEqual(exchange.percent_to_plain('%%065'), 'A')
        self.assertEqual(exchange.plain_to_mtext('C:\\temp {ab}\n다음'), 'C:\\\\temp \\{ab\\}\\P다음')


class MtextEscape(unittest.TestCase):
    def test_edited_multiline_text_escapes_backslash_and_braces(self):
        es = [{'type': 'text', 'position': {'x': 0, 'y': 0}, 'text': 'C:\\도면\\A동\n{가}', 'height': 100, 'rotation': 0}]
        data, _ = exchange.export_dxf(doc_model(es))
        doc, back = foreign(data)
        mtext = doc.modelspace().query('MTEXT')[0]
        self.assertEqual(mtext.text, 'C:\\\\도면\\\\A동\\P\\{가\\}')
        self.assertEqual(mtext.plain_text(), 'C:\\도면\\A동\n{가}')
        self.assertEqual(back[0]['text'], 'C:\\도면\\A동\n{가}')

    def test_mtext_position_roundtrips_without_shifting_one_line(self):
        es = [{'type': 'text', 'position': {'x': 1000, 'y': 2000}, 'text': '첫 줄\n둘째 줄', 'height': 200, 'rotation': 30}]
        data, _ = exchange.export_dxf(doc_model(es))
        _, back = foreign(data)
        self.assertAlmostEqual(back[0]['position']['x'], 1000, places=6)
        self.assertAlmostEqual(back[0]['position']['y'], 2000, places=6)

    def test_formatted_mtext_keeps_codes_when_untouched(self):
        d = ezdxf.new('R2018'); d.units = 4
        raw = '{\\H2x;큰글}\\S1/2;끝 {\\fArial|b1;굵게}'
        d.modelspace().add_mtext(raw, dxfattribs={'char_height': 100})
        es = exchange.import_file(dxf_bytes(d), '.dxf')['document']['entities']
        self.assertEqual((es[0]['codeKind'], es[0]['codeText']), ('mtext', raw))
        data, _ = exchange.export_dxf(doc_model([{k: v for k, v in es[0].items() if k not in ('sourceHandle', 'sourceFingerprint', 'id', 'layer')}]))
        doc, _ = foreign(data)
        self.assertEqual(doc.modelspace().query('MTEXT')[0].text, raw)
        # 고친 문자는 원문을 버리고 새 문자를 쓴다.
        edited = {**{k: v for k, v in es[0].items() if k not in ('sourceHandle', 'sourceFingerprint', 'id', 'layer')}, 'text': '새 문자'}
        data, _ = exchange.export_dxf(doc_model([edited]))
        doc, _ = foreign(data)
        self.assertEqual([t.dxf.text for t in doc.modelspace().query('TEXT')], ['새 문자'])


class Justify(unittest.TestCase):
    def test_import_keeps_justify_and_shifts_baseline_by_vertical_mode(self):
        d = ezdxf.new('R2018'); d.units = 4; m = d.modelspace()
        mc = m.add_text('가운데', dxfattribs={'height': 100}); mc.set_placement((1000, 1000), align=TextEntityAlignment.MIDDLE_CENTER)
        tl = m.add_text('위왼쪽', dxfattribs={'height': 100}); tl.set_placement((0, 0), align=TextEntityAlignment.TOP_LEFT)
        bl = m.add_text('아래', dxfattribs={'height': 100}); bl.set_placement((0, 500), align=TextEntityAlignment.BOTTOM_LEFT)
        c = m.add_text('기준선', dxfattribs={'height': 100}); c.set_placement((0, 900), align=TextEntityAlignment.CENTER)
        es = exchange.import_file(dxf_bytes(d), '.dxf')['document']['entities']
        self.assertEqual([e.get('justify') for e in es], ['MC', 'TL', 'BL', 'C'])
        self.assertEqual(es[0]['alignPoint'], {'x': 1000, 'y': 1000})
        self.assertAlmostEqual(es[0]['position']['y'], 950)   # 기준선 = 맞춤점 - 높이/2
        self.assertEqual(es[0]['align'], 'center')
        self.assertAlmostEqual(es[1]['position']['y'], -100)  # 위 맞춤: 기준선 = 맞춤점 - 높이
        self.assertAlmostEqual(es[2]['position']['y'], 525)   # 아래 맞춤: 내림 끝이 맞춤점
        self.assertAlmostEqual(es[3]['position']['y'], 900)

    def test_measured_start_point_from_autocad_wins_over_ratio(self):
        d = ezdxf.new('R2018'); d.units = 4
        t = d.modelspace().add_text('ABC', dxfattribs={'height': 100, 'halign': 1, 'valign': 2, 'insert': (-80, 1000 - 41.5), 'align_point': (0, 1000)})
        es = exchange.import_file(dxf_bytes(d), '.dxf')['document']['entities']
        self.assertAlmostEqual(es[0]['position']['y'], 958.5)
        self.assertAlmostEqual(es[0]['position']['x'], 0)

    def test_aligned_and_fit_text_spans_two_points(self):
        d = ezdxf.new('R2018'); d.units = 4
        d.modelspace().add_text('ABCD', dxfattribs={'height': 100, 'halign': 5, 'insert': (0, 0), 'align_point': (1000, 0)})
        e = exchange.import_file(dxf_bytes(d), '.dxf')['document']['entities'][0]
        self.assertEqual((e['justify'], e['align']), ('F', 'center'))
        self.assertEqual((e['alignPoint'], e['fitTo']), ({'x': 0, 'y': 0}, {'x': 1000, 'y': 0}))
        self.assertEqual(e['position'], {'x': 500, 'y': 0})
        self.assertAlmostEqual(4 * .65 * 100 * e['widthFactor'], 1000)

    def test_export_writes_72_73_and_alignment_point(self):
        es = [{'type': 'text', 'position': {'x': 0, 'y': 950}, 'text': '가운데', 'height': 100, 'rotation': 0, 'align': 'center', 'justify': 'MC', 'alignPoint': {'x': 0, 'y': 1000}},
              {'type': 'text', 'position': {'x': 500, 'y': 0}, 'text': 'ABCD', 'height': 100, 'rotation': 0, 'align': 'center', 'justify': 'F', 'alignPoint': {'x': 0, 'y': 0}, 'fitTo': {'x': 1000, 'y': 0}, 'widthFactor': 3.8}]
        data, _ = exchange.export_dxf(doc_model(es))
        doc, back = foreign(data)
        a, b = doc.modelspace().query('TEXT')
        self.assertEqual((a.dxf.halign, a.dxf.valign, tuple(a.dxf.align_point)[:2]), (1, 2, (0, 1000)))
        self.assertEqual((b.dxf.halign, tuple(b.dxf.insert)[:2], tuple(b.dxf.align_point)[:2]), (5, (0, 0), (1000, 0)))
        self.assertEqual([e['justify'] for e in back], ['MC', 'F'])
        self.assertAlmostEqual(back[0]['position']['y'], 950)


class StylesAndScales(unittest.TestCase):
    def test_text_style_table_imports_and_exports_width_oblique_height(self):
        d = ezdxf.new('R2018'); d.units = 4
        d.styles.add('KOR', font='romans.shx').dxf.bigfont = 'whgtxt.shx'
        st = d.styles.get('KOR'); st.dxf.width = .8; st.dxf.oblique = 15
        d.modelspace().add_text('글', dxfattribs={'style': 'KOR', 'height': 100})
        doc = exchange.import_file(dxf_bytes(d), '.dxf')['document']
        self.assertEqual(doc['textStyles']['KOR'], {'font': 'romans.shx', 'bigFont': 'whgtxt.shx', 'height': 0.0, 'widthFactor': .8, 'oblique': 15.0})
        model = doc_model([{'type': 'text', 'position': {'x': 0, 'y': 0}, 'text': '글', 'height': 100, 'rotation': 0, 'textStyle': 'ARCH', 'sourceFont': 'malgun.ttf'}])
        model['textStyles'] = {'ARCH': {'font': 'malgun.ttf', 'bigFont': '', 'height': 0, 'widthFactor': .9, 'oblique': 10}, 'bad/name': {'font': 'x.ttf'}}
        data, _ = exchange.export_dxf(model)
        out, _ = foreign(data)
        self.assertEqual((out.styles.get('ARCH').dxf.width, out.styles.get('ARCH').dxf.oblique), (.9, 10))
        self.assertNotIn('bad/name', out.styles)

    def test_scale_list_custom_imports_default_skips_and_export_adds_missing_only(self):
        model = doc_model([{'type': 'line', 'points': [{'x': 0, 'y': 0}, {'x': 1, 'y': 0}]}])
        model['scaleList'] = [{'name': '1:100', 'paper': 1, 'drawing': 100}, {'name': '1:600', 'paper': 1, 'drawing': 600}, {'name': '1:1200', 'paper': 1, 'drawing': 1200}]
        data, _ = exchange.export_dxf(model)
        out, back = foreign(data)
        names = [exchange.read_scale_list(out)]
        self.assertEqual([s['name'] for s in names[0]], ['1:100', '1:600', '1:1200'])
        self.assertEqual(exchange.write_scale_list(out, model['scaleList']), 0)   # 이미 있는 축척은 다시 넣지 않는다
        doc = exchange.import_file(dxf_bytes(out), '.dxf')['document']
        self.assertEqual([s['name'] for s in doc['scaleList']], ['1:100', '1:600', '1:1200'])
        plain = ezdxf.new('R2018'); exchange.write_scale_list(plain, [{'name': n, 'paper': 1, 'drawing': float(n[2:])} for n in ('1:1', '1:50', '1:100')])
        self.assertEqual(exchange.read_scale_list(plain), [])   # AutoCAD 기본 축척뿐이면 한국 건축 기본 목록을 쓴다


class BlockAttributes(unittest.TestCase):
    def make(self):
        d = ezdxf.new('R2018'); d.units = 4
        blk = d.blocks.new('DOORTAG'); blk.add_circle((0, 0), 300)
        blk.add_attdef('NO', (0, -50), dxfattribs={'height': 120})
        blk.add_attdef('NOTE', (0, -400), dxfattribs={'height': 80, 'flags': 1})
        ref = d.modelspace().add_blockref('DOORTAG', (1000, 2000))
        ref.add_auto_attribs({'NO': 'D%%c1', 'NOTE': '숨은 메모'})
        return d

    def test_import_tags_visible_and_hidden_attribute_texts(self):
        doc = exchange.import_file(dxf_bytes(self.make()), '.dxf')['document']
        block = next(e for e in doc['entities'] if e['type'] == 'block')
        tagged = {c['attributeTag']: c for c in block['entities'] if c.get('attributeTag')}
        self.assertEqual(block['attributes'], {'NO': 'DØ1', 'NOTE': '숨은 메모'})
        self.assertEqual(tagged['NO']['text'], 'DØ1'); self.assertNotIn('hidden', tagged['NO'])
        self.assertTrue(tagged['NOTE']['hidden'])
        self.assertAlmostEqual(tagged['NO']['position']['y'], 1950)

    def test_export_writes_attrib_with_its_geometry_once(self):
        doc = exchange.import_file(dxf_bytes(self.make()), '.dxf')['document']
        block = next(e for e in doc['entities'] if e['type'] == 'block')
        block['attributes']['NO'] = 'D2'
        for c in block['entities']:
            if c.get('attributeTag') == 'NO': c['text'] = 'D2'
        for e in doc['entities']: e.pop('sourceHandle', None); e.pop('sourceFingerprint', None)
        doc.pop('dxfPreservation', None); doc.pop('sourceCoverage', None)
        data, _ = exchange.export_dxf(doc)
        out, back = foreign(data)
        attribs = {a.dxf.tag: a for ins in out.modelspace().query('INSERT') for a in ins.attribs}
        self.assertEqual(attribs['NO'].dxf.text, 'D2'); self.assertAlmostEqual(attribs['NO'].dxf.height, 120)
        self.assertAlmostEqual(attribs['NO'].dxf.insert[1], 1950)
        self.assertFalse(attribs['NO'].is_invisible); self.assertTrue(attribs['NOTE'].is_invisible)
        loose = [t.dxf.text for t in out.modelspace().query('TEXT')]
        self.assertNotIn('D2', loose)   # 속성 글자가 따로 한 번 더 써지지 않는다
        for blk in out.blocks:
            self.assertFalse(any(t.dxftype() == 'TEXT' and t.dxf.text == 'D2' for t in blk))


if __name__ == '__main__':
    unittest.main()
