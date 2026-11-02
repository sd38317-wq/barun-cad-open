"""기준 세 가지 읽기 도구(cad_get_drawing_standard)와 MCP 안내 — 사용자 2026-10-25 "고치기 전 기준 3개 읽기"."""
import unittest
import bridge


class DrawingStandardToolTest(unittest.TestCase):
    def test_tool_is_public_and_instructions_say_read_first(self):
        names = [t['name'] for t in bridge.mcp_tools()]
        self.assertIn('cad_get_drawing_standard', names)
        self.assertIn('cad_get_drawing_standard', bridge.CAD_DRAWING_INSTRUCTIONS)
        self.assertIn('결정 기록', bridge.CAD_DRAWING_INSTRUCTIONS)

    def test_reads_all_three(self):
        out = bridge.drawing_standard_bundle({})
        self.assertIn('details', out['standard'])
        self.assertTrue(out['rulebook']['items'])
        self.assertIn('도면 기준 결정 기록', out['decisions'])

    def test_filters(self):
        out = bridge.drawing_standard_bundle({'parts': ['standard', 'rulebook'], 'keys': ['grid'], 'at': ['elevation']})
        self.assertEqual(list(out['standard']), ['grid'])
        self.assertTrue(out['rulebook']['items'])
        self.assertTrue(all(i.get('at') == 'elevation' for i in out['rulebook']['items']))
        self.assertNotIn('decisions', out)


if __name__ == '__main__':
    unittest.main()
