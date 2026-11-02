"""에너지절약계획서 영역 읽기 AI 도구(cad_energy_regions) — 목록에 실리고, 읽기 전용이며 target 으로 묶인다."""
import unittest
import bridge


class EnergyRegionsToolTest(unittest.TestCase):
    def test_tool_is_listed_read_only_and_bound(self):
        tools = {t['name']: t for t in bridge.TOOLS}
        tool = tools['cad_energy_regions']
        schema = tool['inputSchema']
        self.assertIn('region', schema['properties'])
        self.assertIn('target', schema['properties'])
        self.assertNotIn('target', schema['required'])
        self.assertNotIn('cad_energy_regions', bridge.MUTATING_TOOLS)
        self.assertIn('cad_energy_regions', {t['name'] for t in bridge.mcp_tools()})
        for word in ('윈도우', '입면', 'cad_view_drawing', 'null'):
            self.assertIn(word, tool['description'])


    def test_energy_plan_tool_listed_read_only(self):
        tool = {t['name']: t for t in bridge.TOOLS}['cad_energy_plan']
        self.assertIn('build', tool['inputSchema']['properties'])
        self.assertNotIn('cad_energy_plan', bridge.MUTATING_TOOLS)
        self.assertIn('cad_energy_plan', {t['name'] for t in bridge.mcp_tools()})
        for word in ('확정', 'needs', 'cad_energy_regions'):
            self.assertIn(word, tool['description'])


    def test_extension_review_tool_listed_read_only(self):
        tool = {t['name']: t for t in bridge.TOOLS}['cad_extension_review']
        self.assertTrue({'existing', 'added', 'removed', 'repairs'} <= set(tool['inputSchema']['properties']))
        self.assertNotIn('cad_extension_review', bridge.MUTATING_TOOLS)
        self.assertIn('cad_extension_review', {t['name'] for t in bridge.mcp_tools()})


if __name__ == '__main__':
    unittest.main()
