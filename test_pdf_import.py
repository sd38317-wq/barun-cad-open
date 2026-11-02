import base64
import io
import math
import unittest

from pdf_import import PT_TO_MM, import_pdf_page, process


def make_pdf(rotate=0, image=False):
    from reportlab.pdfgen import canvas
    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=(400, 300))
    c.setFillColorRGB(1, 1, 1)
    c.rect(0, 0, 400, 300, stroke=0, fill=1)   # 흰 바탕 칠: 가져오지 않아야 한다
    c.line(10, 20, 110, 20)
    c.rect(50, 50, 100, 40, stroke=1, fill=0)
    c.circle(250, 150, 30, stroke=1, fill=0)
    c.setFont('Helvetica', 12)
    c.drawString(20, 250, 'PLAN A')
    c.saveState(); c.translate(300, 50); c.line(0, 0, 0, 50); c.restoreState()
    p = c.beginPath(); p.moveTo(10, 200); p.curveTo(30, 240, 60, 240, 80, 200); c.drawPath(p, stroke=1, fill=0)
    if image:
        from reportlab.lib.utils import ImageReader
        from PIL import Image
        img = Image.new('RGB', (2, 2), (255, 0, 0))
        c.drawImage(ImageReader(img), 0, 0, 10, 10)
    c.showPage()
    c.setPageSize((200, 100)); c.line(0, 0, 200, 100); c.showPage()
    c.save()
    return buf.getvalue()


def close(a, b, tol=1e-3):
    return abs(a - b) <= tol


def make_glyph_pdf():
    """크롬처럼 글자마다 글꼴을 바꾸고 Td 로 옮겨 찍은 줄(A49): 'ROOM 1' · 멀리 떨어진 'B2' · 다음 줄 'NEXT'."""
    from reportlab.pdfgen import canvas
    from reportlab.pdfbase.pdfmetrics import stringWidth
    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=(400, 300))
    t = c.beginText(20, 200)
    fonts = ('Helvetica', 'Courier', 'Times-Roman')
    for i, ch in enumerate('ROOM 1'):
        font = fonts[i % 3]
        t.setFont(font, 12); t.textOut(ch)
    t.moveCursor(200, 0); t.setFont('Helvetica', 12); t.textOut('B2')
    c.drawText(t)
    t = c.beginText(20, 170); t.setFont('Helvetica', 12); t.textOut('NEXT'); c.drawText(t)
    c.showPage(); c.save()
    return buf.getvalue()


class PdfImportTest(unittest.TestCase):
    def test_glyph_runs_on_one_line_become_one_text(self):
        texts = [e for e in import_pdf_page(make_glyph_pdf())['entities'] if e['type'] == 'text']
        self.assertEqual(sorted(t['text'] for t in texts), ['B2', 'NEXT', 'ROOM 1'])
        room = next(t for t in texts if t['text'] == 'ROOM 1')
        self.assertTrue(close(room['position']['x'], 20 * PT_TO_MM, 0.01) and close(room['position']['y'], 200 * PT_TO_MM, 0.01))

    def test_line_rect_circle_text(self):
        r = import_pdf_page(make_pdf())
        ents, rep = r['entities'], r['report']
        k = PT_TO_MM
        lines = [e for e in ents if e['type'] == 'line']
        self.assertTrue(any(close(e['points'][0]['x'], 10 * k) and close(e['points'][1]['x'], 110 * k) and close(e['points'][0]['y'], 20 * k) for e in lines))
        # q/cm/Q: 옮긴 좌표계의 선
        self.assertTrue(any(close(e['points'][0]['x'], 300 * k) and close(e['points'][1]['y'], 100 * k) for e in lines))
        rects = [e for e in ents if e['type'] == 'polyline' and e['closed'] and len(e['points']) == 4]
        self.assertEqual(len(rects), 1, '흰 바탕 칠은 빠지고 사각형 하나만')
        xs = sorted(p['x'] for p in rects[0]['points']); ys = sorted(p['y'] for p in rects[0]['points'])
        self.assertTrue(close(xs[0], 50 * k) and close(xs[-1], 150 * k) and close(ys[0], 50 * k) and close(ys[-1], 90 * k))
        circles = [e for e in ents if e['type'] == 'circle']
        self.assertEqual(len(circles), 1)
        self.assertTrue(close(circles[0]['center']['x'], 250 * k, 0.01) and close(circles[0]['radius'], 30 * k, 0.01))
        curve = [e for e in ents if e['type'] == 'polyline' and not e['closed']]
        self.assertEqual(len(curve), 1)
        self.assertGreater(len(curve[0]['points']), 4)
        self.assertTrue(close(curve[0]['points'][-1]['x'], 80 * k))
        texts = [e for e in ents if e['type'] == 'text']
        self.assertEqual([t['text'] for t in texts], ['PLAN A'])
        self.assertTrue(close(texts[0]['position']['x'], 20 * k, 0.01) and close(texts[0]['height'], 12 * k, 0.01))
        self.assertEqual(rep['skippedWhiteFills'], 1)
        self.assertEqual(rep['pages'], 2)
        self.assertTrue(close(rep['pageSize']['width'], 400 * k))

    def test_scale_page_and_errors(self):
        r = import_pdf_page(make_pdf(), page=1, scale=2, text=False)
        self.assertEqual(len(r['entities']), 1)
        self.assertTrue(close(r['entities'][0]['points'][1]['x'], 200 * PT_TO_MM * 2))
        with self.assertRaises(ValueError):
            import_pdf_page(make_pdf(), page=5)
        with self.assertRaises(ValueError):
            import_pdf_page(b'not a pdf')
        with self.assertRaises(ValueError):
            import_pdf_page(make_pdf(), scale=0)

    def test_rotated_page(self):
        from pypdf import PdfReader, PdfWriter
        reader = PdfReader(io.BytesIO(make_pdf())); writer = PdfWriter()
        writer.add_page(reader.pages[1]); writer.pages[0].rotate(90)
        buf = io.BytesIO(); writer.write(buf)
        r = import_pdf_page(buf.getvalue(), text=False)
        a, b = r['entities'][0]['points']
        k = PT_TO_MM
        # 200x100 쪽을 시계 방향 90° 돌리면 (0,0)→(0,200), (200,100)→(100,0)
        self.assertTrue(close(a['x'], 0) and close(a['y'], 200 * k) and close(b['x'], 100 * k) and close(b['y'], 0))
        self.assertTrue(close(r['report']['pageSize']['width'], 100 * k))

    def test_images_reported_and_process(self):
        r = process({'data': base64.b64encode(make_pdf(image=True)).decode(), 'page': 0})
        self.assertEqual(r['report']['images'], 1)
        self.assertTrue(all(math.isfinite(p['x']) for e in r['entities'] for p in e.get('points', [])))


class PlotLayersAndScaleTest(unittest.TestCase):
    """2026-10-29 괴정사리로: 바른 CAD 가 뽑은 PDF 를 다시 읽어 그리게 — 레이어(OCG)·글자·축척."""

    def plot(self, entities):
        import pdf_service
        return pdf_service.render_plot({'size': [420, 297], 'margin': 5, 'denominator': 100,
                                        'bounds': {'minX': 0, 'minY': 0, 'maxX': 30000, 'maxY': 20000}, 'entities': entities})

    def test_plot_writes_drawing_layers_and_import_reads_them_back(self):
        line = lambda y, layer: {'type': 'line', 'points': [{'x': 0, 'y': y}, {'x': 20000, 'y': y}], 'pdfLayer': layer}
        r = import_pdf_page(self.plot([line(0, 'A-WALL'), line(5000, 'A-DIMS'), line(9000, 'A-WALL'), line(9500, '벽체')]), 0, 1.0, True)
        self.assertEqual([e.get('pdfLayer') for e in r['entities']], ['A-WALL', 'A-DIMS', 'A-WALL', '벽체'])

    def test_text_placed_by_the_page_matrix_is_kept(self):
        r = import_pdf_page(self.plot([{'type': 'text', 'position': {'x': 1000, 'y': 6000}, 'text': '3600', 'height': 250}]), 0, 1.0, True)
        texts = [e for e in r['entities'] if e['type'] == 'text']
        self.assertEqual([t['text'] for t in texts], ['3600'])
        self.assertAlmostEqual(texts[0]['height'], 2.5, places=1)

    def test_curves_split_by_how_much_they_bend(self):
        from pdf_import import _bezier
        self.assertLessEqual(len(_bezier((0, 0), (0.3, 0.05), (0.7, 0.05), (1, 0))), 2)   # 단열재 무늬 같은 잔 곡선
        quarter = _bezier((100, 0), (100, 55.2), (55.2, 100), (0, 100))                      # 반지름 100 pt 사분원
        self.assertGreaterEqual(len(quarter), 8)
        self.assertTrue(all(abs(math.hypot(x, y) - 100) < 0.1 for x, y in quarter))

    def test_door_swing_comes_back_as_an_arc_but_tiny_curves_stay_lines(self):
        r = import_pdf_page(self.plot([{'type': 'arc', 'center': {'x': 5000, 'y': 5000}, 'radius': 900, 'startAngle': 0, 'endAngle': 90}]), 0, 1.0, True)
        arcs = [e for e in r['entities'] if e['type'] == 'arc']
        self.assertEqual(len(arcs), 1)
        self.assertAlmostEqual(arcs[0]['radius'], 9, places=1)                       # 1:100 → 종이 9 mm
        self.assertAlmostEqual((arcs[0]['endAngle'] - arcs[0]['startAngle']) % 360, 90, delta=1)
        tiny = import_pdf_page(self.plot([{'type': 'arc', 'center': {'x': 5000, 'y': 5000}, 'radius': 20, 'startAngle': 0, 'endAngle': 180}]), 0, 1.0, True)
        self.assertFalse([e for e in tiny['entities'] if e['type'] == 'arc'])

    def test_dimension_numbers_give_the_real_scale(self):
        from pdf_import import dimension_scale
        entities = []
        for i, mm in enumerate((3600, 4140, 2810, 15700)):   # 1:144 로 뽑힌 치수선과 그 위 숫자
            y = 20 + 10 * i;length = mm / 144
            entities += [{'type': 'line', 'points': [{'x': 10, 'y': y}, {'x': 10 + length, 'y': y}]},
                         {'type': 'text', 'position': {'x': 10 + length / 2 - 0.28 * 2 * len(str(mm)) / 2, 'y': y + 1}, 'text': str(mm), 'height': 2, 'rotation': 0}]
        self.assertAlmostEqual(dimension_scale(entities), 144, delta=0.5)
        self.assertIsNone(dimension_scale(entities[:4]))   # 두 개로는 정하지 않는다


if __name__ == '__main__':
    unittest.main()
