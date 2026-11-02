# 나눠 찍기(큰 용지를 A4·A3 프린터로 여러 장): 장 배치, 안내도, 자르는 선, 묶음 한 번만 그리기.
import base64, io, unittest
from pypdf import PdfReader
import pdf_service

MM = 72 / 25.4
LINES = [{'type': 'line', 'points': [{'x': i * 100, 'y': 0}, {'x': i * 100, 'y': 50000}], 'color': '#000000', 'lineweight': .25} for i in range(800)]
A1 = {'action': 'plot', 'size': [841, 594], 'margin': 10, 'denominator': 100, 'bounds': {'minX': 0, 'minY': 0, 'maxX': 80000, 'maxY': 50000},
      'entities': LINES, 'stamp': {'text': '바른 CAD 스탬프', 'corner': 'bottom-left'}}


def pdf_of(result):
    return PdfReader(io.BytesIO(base64.b64decode(result['data'])))


class PlotTileTest(unittest.TestCase):
    def test_grid_picks_fewer_sheets(self):
        g = pdf_service.tile_grid(841, 594, (210, 297), 10)
        # 세로(5열×3행=15장)가 가로(4×4=16장)보다 적다
        self.assertEqual((g['sw'], g['sh'], g['cols'], g['rows']), (210, 297, 5, 3))
        # 마지막 장까지 큰 용지 끝을 덮는다
        self.assertGreaterEqual((g['cols'] - 1) * (g['cw'] - 10) + g['cw'], 841)
        self.assertGreaterEqual((g['rows'] - 1) * (g['ch'] - 10) + g['ch'], 594)

    def test_a1_on_a4_pages_and_labels(self):
        reader = pdf_of(pdf_service.process({**A1, 'stamp': None, 'tile': {'paper': 'A4', 'overlap': 10}}))
        # 빈 여백은 나누지 않는다: 도면 영역 800×500 mm 만 → A4 가로 3열×3행 9장(용지 전체를 나누면 15장)
        self.assertEqual(len(reader.pages), 10)   # 안내도 1 + 9장
        for page in reader.pages:
            self.assertAlmostEqual(float(page.mediabox.width), 297 * MM, places=1)
            self.assertAlmostEqual(float(page.mediabox.height), 210 * MM, places=1)
        guide = reader.pages[0].extract_text()
        self.assertIn('붙임 안내', guide)
        self.assertIn('실제 크기', guide)
        self.assertIn('9장', guide)
        first, second = reader.pages[1].extract_text(), reader.pages[2].extract_text()
        self.assertIn('가1', first)
        self.assertIn('가2', first)       # 오른쪽 이웃 이름
        self.assertNotIn('자르는 선', first)   # 첫 장(왼쪽 위)은 자를 곳이 없다
        self.assertIn('자르는 선', second)

    def test_drawing_is_stored_once(self):
        single = base64.b64decode(pdf_service.process(dict(A1))['data'])
        tiled = base64.b64decode(pdf_service.process({**A1, 'tile': {'paper': 'A4'}})['data'])
        # 10쪽이어도 도면 묶음은 하나라 한 장 출력의 두 배를 넘지 않는다
        self.assertLess(len(tiled), len(single) * 2)

    def test_rejects_bad_requests(self):
        with self.assertRaisesRegex(ValueError, '겹침'):
            pdf_service.process({**A1, 'tile': {'paper': 'A4', 'overlap': 80}})
        small = {**A1, 'size': [297, 210], 'bounds': {'minX': 0, 'minY': 0, 'maxX': 20000, 'maxY': 15000}}
        with self.assertRaisesRegex(ValueError, '들어갑니다'):
            pdf_service.process({**small, 'tile': {'paper': 'A3'}})
        with self.assertRaisesRegex(ValueError, '너무 많'):
            pdf_service.process({**A1, 'size': [2000, 1189], 'margin': 0, 'bounds': {'minX': 0, 'minY': 0, 'maxX': 199000, 'maxY': 118000}, 'tile': {'paper': 'A4', 'overlap': 50}})

    def test_stamp_and_thin_drawings(self):
        # 스탬프는 용지 모서리라 용지 전체를 나눈다(본문 장에도 스탬프가 나온다)
        stamped = pdf_of(pdf_service.process({**A1, 'stamp': {'text': '스탬프확인', 'corner': 'top-right'}, 'tile': {'paper': 'A4'}}))
        self.assertTrue(any('스탬프확인' in page.extract_text() for page in stamped.pages[1:]))
        # 긴 수평선 하나뿐(높이 0)이어도 나눠 찍는다
        line = {**A1, 'stamp': None, 'bounds': {'minX': 0, 'minY': 0, 'maxX': 80000, 'maxY': 0},
                'entities': [{'type': 'line', 'points': [{'x': 0, 'y': 0}, {'x': 80000, 'y': 0}], 'color': '#000000'}]}
        self.assertGreater(len(pdf_of(pdf_service.process({**line, 'tile': {'paper': 'A4'}})).pages), 2)

    def test_single_plot_unchanged(self):
        reader = pdf_of(pdf_service.process(dict(A1)))
        self.assertEqual(len(reader.pages), 1)
        self.assertIn('스탬프', reader.pages[0].extract_text())


if __name__ == '__main__':
    unittest.main()
