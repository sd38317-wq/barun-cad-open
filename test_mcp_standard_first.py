"""MCP 기준 먼저 — 연결마다 기준 세 가지를 한 번 읽기 전에는 그리기·고치기 도구를 거절한다(사용자 2026-10-25)."""
import unittest
from unittest import mock
import mcp_server
from bridge import CADToolError


class StandardFirstTest(unittest.TestCase):
    def setUp(self):
        mcp_server._standard_read.clear()

    def test_mutation_refused_until_all_three_read(self):
        with mock.patch.object(mcp_server, '_call', return_value={'ok': True}) as call:
            with self.assertRaises(CADToolError) as caught:
                mcp_server.tool_call('cad_generate_drawing', {})
            self.assertEqual(caught.exception.code, 'standard_first')
            call.assert_not_called()
            call.return_value = {'standard': {'grid': {}}, 'rulebook': {'items': []}}
            mcp_server.tool_call('cad_get_drawing_standard', {'parts': ['standard', 'rulebook']})
            with self.assertRaises(CADToolError):
                mcp_server.tool_call('cad_execute_bound', {})
            call.return_value = {'decisions': {'error': '이 판에는 결정 기록 문서가 없습니다'}}
            mcp_server.tool_call('cad_get_drawing_standard', {'parts': ['decisions']})
            call.return_value = {'ok': True}
            self.assertEqual(mcp_server.tool_call('cad_generate_drawing', {}), {'ok': True})

    def test_locked_standard_does_not_count(self):
        with mock.patch.object(mcp_server, '_call', return_value={'standard': {'error': '잠김'}, 'rulebook': {'error': '잠김'}, 'decisions': '기록'}):
            mcp_server.tool_call('cad_get_drawing_standard', {})
        self.assertEqual(mcp_server._standard_read, {'decisions'})

    def test_new_design_must_be_full_set(self):
        mcp_server._standard_read.update(mcp_server.STANDARD_PARTS)
        with mock.patch.object(mcp_server, '_call', return_value={'ok': True}):
            with self.assertRaises(CADToolError) as caught:
                mcp_server.tool_call('cad_generate_drawing', {'kind': 'plan', 'model': {'stories': []}})
            self.assertEqual(caught.exception.code, 'full_set_required')
            self.assertEqual(mcp_server.tool_call('cad_generate_drawing', {'kind': 'set', 'model': {'stories': []}}), {'ok': True})
            self.assertEqual(mcp_server.tool_call('cad_generate_drawing', {'kind': 'section'}), {'ok': True})   # 지금 평면에서 단면만(설계 JSON 없이)은 된다

    def test_reads_undo_save_not_gated(self):
        with mock.patch.object(mcp_server, '_call', return_value={'ok': True}):
            for name in ('cad_get_document', 'cad_view_drawing', 'cad_undo', 'cad_save'):
                self.assertEqual(mcp_server.tool_call(name, {}), {'ok': True})


if __name__ == '__main__':
    unittest.main()
