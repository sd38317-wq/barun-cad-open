"""결정 기록 사본(rules/knowledge/drawing-decisions.json)이 docs 원본과 같아야 한다 — 설치판 미리는 이 사본을 서버에서 받아 읽는다(2026-10-30)."""
import json
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent


class DecisionsCopyTest(unittest.TestCase):
    def test_copy_matches_source(self):
        source = (ROOT / 'docs' / '도면기준-결정기록.md').open(encoding='utf-8', newline='').read()
        copy = json.loads((ROOT / 'rules' / 'knowledge' / 'drawing-decisions.json').read_text(encoding='utf-8'))
        self.assertEqual(copy['text'], source, '결정 기록을 고쳤으면 rules/knowledge/drawing-decisions.json 의 text 도 같이 바꾸세요')

    def test_installed_app_reads_the_server_copy(self):
        from unittest.mock import patch
        import bridge
        with patch.object(bridge, 'DECISIONS_DOC', ROOT / 'docs' / '없는-파일.md'):
            out = bridge.drawing_standard_bundle({'parts': ['decisions']})
        self.assertIsInstance(out['decisions'], str)
        self.assertIn('결정', out['decisions'][:200])


if __name__ == '__main__':
    unittest.main()
