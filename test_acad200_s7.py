# ACAD200 영역 7 서버 쪽 시험: 717 STB 읽기, 720 도면 선종류 정의, 722 책갈피, 723 플롯 스탬프.
import base64, io, tempfile, unittest
from pathlib import Path
import ezdxf
from ezdxf.addons import acadctb
from pypdf import PdfReader
import pdf_service
from plot_style import parse
import exchange

PAGE = {'action': 'plot', 'size': [420, 297], 'margin': 10, 'denominator': 100, 'bounds': {'minX': 0, 'minY': 0, 'maxX': 1000, 'maxY': 1000},
        'entities': [{'type': 'line', 'points': [{'x': 0, 'y': 0}, {'x': 1000, 'y': 1000}], 'color': '#000000', 'lineweight': .25}]}


def pdf_of(result):
    return PdfReader(io.BytesIO(base64.b64decode(result['data'])))


class PlotStampBookmarkTest(unittest.TestCase):
    def test_single_plot_stamp_and_bookmark(self):
        pdf = pdf_of(pdf_service.process({**PAGE, 'stamp': {'text': 'A.dwg | 1:100', 'corner': 'bottom-right'}, 'bookmark': 'A-101 평면도'}))
        self.assertIn('A.dwg | 1:100', pdf.pages[0].extract_text())
        self.assertEqual([o.title for o in pdf.outline], ['A-101 평면도'])

    def test_no_stamp_by_default(self):
        pdf = pdf_of(pdf_service.process(PAGE))
        self.assertNotIn('1:100', pdf.pages[0].extract_text())
        self.assertEqual(list(pdf.outline), [])

    def test_multi_plot_bookmarks(self):
        pdf = pdf_of(pdf_service.process({'action': 'plots', 'pages': [{**PAGE, 'bookmark': 'A-101'}, {**PAGE, 'bookmark': 'A-102'}]}))
        self.assertEqual(len(pdf.pages), 2)
        self.assertEqual([o.title for o in pdf.outline], ['A-101', 'A-102'])

    def test_sheet_render_default_line_kept_and_can_be_turned_off(self):
        sheet = {'paper': 'A3', 'denominator': 100, 'bounds': {'minX': 0, 'minY': 0, 'maxX': 1000, 'maxY': 1000}, 'entities': [], 'number': 'A-1', 'title': '배치도'}
        pdf = pdf_of(pdf_service.process({'action': 'render', 'sheets': [sheet]}))
        self.assertIn('1:100', pdf.pages[0].extract_text())
        self.assertEqual([o.title for o in pdf.outline], ['A-1 배치도'])
        pdf = pdf_of(pdf_service.process({'action': 'render', 'sheets': [{**sheet, 'stamp': False}]}))
        self.assertNotIn('1:100', pdf.pages[0].extract_text())

    def test_bad_stamp_is_ignored(self):
        self.assertFalse(pdf_service.draw_stamp(None, 'x', 1, 1))


class NamedPlotStyleTest(unittest.TestCase):
    def test_stb_is_read_by_name(self):
        table = acadctb.new_stb()
        style = table.new_style('Wall', data={'lineweight': 5})
        style.color = (10, 20, 30)
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'office.stb'
            # ezdxf 는 머리 숫자 셋을 pack("LLL")(기계 크기)로 쓴다. 64비트 맥·리눅스에서는 8바이트씩이라 실제 STB(4바이트씩)와
            # 달라진다. 시험 파일은 실제 STB 와 같은 표준 크기로 만든다(읽는 쪽 plot_style.parse 를 시험한다).
            import struct
            from unittest.mock import patch
            with patch.object(acadctb, 'pack', lambda fmt, *values: struct.pack('<' + fmt, *values)):
                table.save(path)
            result = parse({'name': 'office.stb', 'data': base64.b64encode(path.read_bytes()).decode()})
        self.assertEqual(result['kind'], 'stb')
        self.assertEqual(result['styles']['Wall']['color'], '#0a141e')
        self.assertGreater(result['styles']['Wall']['lineweight'], 0)
        self.assertIn('Normal', result['styles'])


class LinetypeDefinitionTest(unittest.TestCase):
    def test_simple_patterns_in_mm(self):
        doc = ezdxf.new('R2018')
        doc.linetypes.add('MY_DASH', pattern=[0.3, 0.2, -0.1], description='mine')
        defs = exchange._linetype_definitions(doc, 10.0)
        self.assertEqual(defs['MY_DASH']['pattern'], [2.0, -1.0])
        self.assertNotIn('CONTINUOUS', defs)


if __name__ == '__main__':
    unittest.main()
