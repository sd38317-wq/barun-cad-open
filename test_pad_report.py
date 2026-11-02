"""현장 기록 보고서(펀치리스트) PDF — 쪽 수·글·사진이 들어가는지."""
import base64
import io
import unittest

from pypdf import PdfReader

import pad_report


def jpeg():
    from PIL import Image
    out = io.BytesIO()
    Image.new('RGB', (160, 120), (74, 107, 122)).save(out, 'JPEG')
    return base64.b64encode(out.getvalue()).decode()


class PadReportTest(unittest.TestCase):
    def test_punch_list(self):
        pins = [{'no': i + 1, 'title': f'핀 {i + 1} 벽 확인', 'kind': '하자', 'status': ['미해결', '진행 중', '해결'][i % 3], 'prio': '높음',
                 'assignee': '골조팀', 'due': '2026-10-01' if i == 0 else '2026-12-01', 'note': '거푸집 위치 50 안쪽. 타설 전 확인 필요.',
                 'reply': '확인함' if i == 1 else '', 'at': {'x': i * 1000, 'y': 500}, 'photos': [jpeg()] if i < 2 else []} for i in range(5)]
        data = {'action': 'punch', 'title': '펀치리스트', 'drawing': '101동 3층', 'date': '2026-10-13', 'pins': pins,
                'measures': [{'text': '실측 4,000 · 도면 4,050 · −50', 'over': True}],
                'plan': {'box': [-1000, -1000, 6000, 2000], 'segments': [0, 0, 5000, 0, 0, 0, 0, 1500]}}
        pdf = base64.b64decode(pad_report.process(data)['data'])
        reader = PdfReader(io.BytesIO(pdf))
        self.assertEqual(len(reader.pages), 1 + 2 + 1, '첫 장 + 핀 상세 2장(3개씩) + 실측')
        first = reader.pages[0].extract_text()
        for word in ('펀치리스트', '101동 3층', '기한 지남', '핀 1 벽 확인', '(서명)'):
            self.assertIn(word, first)
        self.assertIn('사무실 답', reader.pages[1].extract_text())
        self.assertIn('허용 넘음', reader.pages[3].extract_text())
        self.assertTrue(any('/XObject' in str(reader.pages[1].get('/Resources', {})) for _ in [0]), '사진이 들어간다')

    def test_rejects_other_actions(self):
        with self.assertRaises(ValueError):
            pad_report.process({'action': 'plot'})


if __name__ == '__main__':
    unittest.main()
