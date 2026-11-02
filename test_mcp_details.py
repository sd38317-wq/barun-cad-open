"""상세 MCP: 대상 바인딩, 보호 지식 전달, 기존 Worker 생성 액션 재사용."""
import json
import unittest
from unittest.mock import patch
import bridge
import vault_gate


@patch('miri_account_service.require_ai_login', new=lambda: None)
class DetailToolsTest(unittest.TestCase):
    def dispatch_details(self, args, state=None):
        sent = {}
        with patch.object(bridge, 'validate_target'), patch.object(bridge, '_bound_state_locked', return_value=state or {'document': {}}), patch.object(bridge, 'dispatch', side_effect=lambda name, args: sent.update(name=name, args=args) or {'applied': True}):
            bridge.call('cad_generate_details', {'target': {}, **args})
        return sent

    def test_tools_and_bound_alias_registered(self):
        names = {t['name'] for t in bridge.TOOLS}
        self.assertIn('cad_list_details', names)
        self.assertEqual(bridge.BOUND_ALIASES['cad_generate_details_bound'],'cad_generate_details')
        self.assertNotIn('cad_generate_details_bound', names)
        self.assertIn('cad_generate_details', bridge.MUTATING_TOOLS)
        tool = next(t for t in bridge.TOOLS if t['name'] == 'cad_generate_details')
        self.assertEqual(tool['inputSchema']['required'], ['target'])
        self.assertEqual(set(tool['inputSchema']['properties']['group']['enum']), {'basic','wall','window','floor','roof','stair','fire','parking','access','interior','steel'})

    def test_list_uses_catalog_and_filters_non_details(self):
        rows=[{'id':'wall-1','kind':'detail','group':'wall'},
              {'id':'floor-1','kind':'detail','group':'floor'},
              {'id':'unit-1','kind':'unit','group':'unit'}]
        with patch('detail_search_library.search_library_details',return_value={'details':rows}) as search:
            result=bridge.call('cad_list_details',{})
        search.assert_called_once_with(classification='')
        self.assertEqual(result['groups'],['floor','wall'])
        self.assertEqual(result['count'],2)
        self.assertEqual([d['id'] for d in result['details']],['wall-1','floor-1'])

    def test_list_forwards_group_to_catalog(self):
        row={'id':'WALL-01','name':'시험 상세','kind':'detail','group':'wall'}
        with patch('detail_search_library.search_library_details',return_value={'details':[row]}) as search:
            result=bridge.call('cad_list_details',{'group':'wall'})
        search.assert_called_once_with(classification='wall')
        self.assertEqual(result['details'],[row])

    def test_generate_uses_existing_action_with_vault_knowledge(self):
        sent = self.dispatch_details({'ids': ['BASIC-01'], 'origin': {'x': 1000, 'y': 2000}})
        request = sent['args']['request']
        self.assertEqual(sent['name'], 'cad_generate_drawing')
        self.assertEqual(request['kind'], 'details')
        self.assertEqual(request['ids'], ['BASIC-01'])
        self.assertIn('walls', request['assemblies'])
        self.assertIn('wall', request['details'])
        self.assertNotIn('model', request)

    def test_generate_set_id_and_selection_switch(self):
        state = {'document': {'drawingSets': {'ds-1': {'kind': 'details'}}}}
        sent = self.dispatch_details({'setId': 'ds-1'}, state)
        self.assertEqual(sent['args']['request']['setId'], 'ds-1')
        sent = self.dispatch_details({'setId': 'ds-1', 'group': 'basic'}, state)
        self.assertIsNone(sent['args']['request']['ids'])
        self.assertEqual(sent['args']['request']['group'], 'basic')
        with self.assertRaises(ValueError):
            self.dispatch_details({'setId': 'ds-1'}, {'document': {'drawingSets': {'ds-1': {'kind': 'plan'}}}})

    def test_reject_bad_selectors_and_coordinates(self):
        for args in ({}, {'ids': []}, {'ids': ['BASIC-01', 'BASIC-01']},
                     {'ids': ['BASIC-01'], 'group': 'basic'}, {'group': 'missing'},
                     {'group': 'basic', 'origin': {'x': float('nan'), 'y': 0}},
                     {'group': 'basic', 'origin': {'x': True, 'y': 0}}):
            with self.subTest(args=args), self.assertRaises(ValueError):
                self.dispatch_details(args)

    def test_target_binding_and_read_only_mode_enforced(self):
        with self.assertRaises(ValueError):
            bridge.call('cad_generate_details', {'group': 'basic'})
        with self.assertRaises(ValueError):
            bridge.call('cad_generate_details', {'group': 'basic', 'target': {}}, allow_edit=False)

    def test_generic_drawing_generation_carries_details(self):
        sent = {}
        with patch.object(bridge, 'validate_target'), patch.object(bridge, '_bound_state_locked', return_value={'document': {}}), patch.object(bridge, 'dispatch', side_effect=lambda name, args: sent.update(name=name, args=args)):
            bridge.call('cad_generate_drawing', {'kind': 'details', 'group': 'basic', 'target': {}})
        self.assertEqual(sent['args']['request']['details']['wall']['schema'], 'barun-detail-group')


if __name__ == '__main__':
    unittest.main()
