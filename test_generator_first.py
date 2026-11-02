"""MCP 새 평면은 생성기부터. 계정·화면·네트워크 없이 입구만 검증한다."""
import unittest, uuid
from unittest.mock import patch
import bridge, test_mcp_3d


@patch('miri_account_service.require_ai_login', new=lambda: None)
class GeneratorFirstTest(unittest.TestCase):
    setUp = test_mcp_3d.Mcp3DTest.setUp
    clear_state = test_mcp_3d.Mcp3DTest.clear_state

    def args(self, name='WALDRAW', **extra):
        return {'target': self.target, 'expectedRevision': 0, 'name': name, **extra}

    def test_empty_and_unused_wall_layer_refuse_both_aliases(self):
        bridge.clients[self.session]['document']['layers'] = [{'id': 'wall', 'name': 'A-WALL-CONC'}]
        for tool in ('cad_run_command', 'cad_run_command_bound'):
            for name in ('WALDRAW', 'wal'):
                with patch.object(bridge, 'dispatch') as dispatch, self.assertRaises(bridge.CADToolError) as caught:
                    bridge.call(tool, self.args(name))
                self.assertEqual(caught.exception.code, 'generator_first')
                self.assertIn('cad_generate_drawing', str(caught.exception))
                self.assertIn('stories', caught.exception.details['model'])
                dispatch.assert_not_called()

    def test_existing_walls_by_layer_id_or_name_and_other_commands_pass(self):
        for layer in ('wall', 'A-WALL-CONC', 'WALL', '벽체', '0'):
            bridge.clients[self.session]['document'] = {'layers': [{'id': 'wall', 'name': 'A-WALL-CONC'}], 'entities': [{'layer': layer}]}
            with patch.object(bridge, 'dispatch', return_value={'applied': True}) as dispatch:
                bridge.call('cad_run_command', self.args())
            dispatch.assert_called_once()
        bridge.clients[self.session]['document'] = {'entities': []}
        with patch.object(bridge, 'dispatch', return_value={}) as dispatch:
            bridge.call('cad_run_command', self.args('D1'))
            bridge._call_app('cad_run_command', self.args(), allow_edit=True)
        self.assertEqual(dispatch.call_count, 2)

    def test_override_validation_and_schema(self):
        with patch.object(bridge, 'dispatch', return_value={}) as dispatch:
            bridge.call('cad_run_command', self.args(generator_check={'reason': '사용자가 직접 벽 작도를 요청함'}))
        self.assertNotIn('generator_check', dispatch.call_args.args[1])
        for bad in (None, {}, {'reason': ''}, {'reason': '  '}, {'reason': 1}, {'reason': 'x', 'extra': True}, {'reason': 'x' * 1001}):
            with patch.object(bridge, 'dispatch') as dispatch, self.assertRaises(ValueError):
                bridge.call('cad_run_command', self.args(generator_check=bad))
            dispatch.assert_not_called()
        tools = {t['name']: t for t in bridge.mcp_tools()}
        # 호환 _bound 별칭은 목록에 중복 등록하지 않고 원래 도구로 정규화한다.
        for name in ('cad_run_command',):
            self.assertIn('generator_check', tools[name]['inputSchema']['properties'])
            self.assertIn('generator_first', tools[name]['description'])

    def test_document_changes_and_target_are_checked(self):
        with self.assertRaises(bridge.CADToolError):bridge._enforce_generator_first(self.args())
        bridge.clients[self.session]['document'] = {'entities': [{'layer': '벽체'}]}
        bridge._enforce_generator_first(self.args())
        with self.assertRaises(bridge.CADToolError):
            bridge._enforce_generator_first({**self.args(), 'target': {**self.target, 'revision': 1}})

    def test_pulse_uses_target_instead_of_active_window(self):
        other = str(uuid.uuid4())
        bridge.clients[other] = {**bridge.clients[self.session], 'document': {'entities': [{'layer': 'A-WALL'}]}}
        bridge.active = other
        with self.assertRaises(bridge.CADToolError) as caught:
            bridge._enforce_generator_first(self.args())
        self.assertEqual(caught.exception.code, 'generator_first')
        generation = bridge.clients[self.session]['document_generation']
        with patch.object(bridge, 'schedule_recovery'):
            for revision, entities in ((1, [{'layer': 'A-WALL-CONC'}]), (2, [])):
                bridge.pulse({'client': self.session, 'editor_session': self.session, 'protocol_version': 1,
                              'document_generation': generation, 'revision': revision, 'document_revision': revision,
                              'document': {'entities': entities}})
                self.target = bridge.snapshot(self.session)['target']
                if entities:
                    bridge._enforce_generator_first(self.args())
                else:
                    with self.assertRaises(bridge.CADToolError) as caught:
                        bridge._enforce_generator_first(self.args())
                    self.assertEqual(caught.exception.code, 'generator_first')
