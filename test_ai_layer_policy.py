import io, json, tempfile, unittest
from pathlib import Path
import bridge, codex_chat, miri_chat, mcp_server
from unittest.mock import Mock, patch

ROOT = Path(__file__).resolve().parent

class LayerPolicyTests(unittest.TestCase):
    def test_tools_expose_layer_purpose_and_policy(self):
        tools = {t['name']: t for t in bridge.app_tools(allow_edit=True)}
        for name in ('cad_preview','cad_execute','cad_lisp_load','cad_lisp_run'):
            self.assertIn(name, tools)
            props = tools[name]['inputSchema']['properties']
            self.assertEqual(props['layer']['type'], 'string')
            self.assertEqual(props['purpose']['type'], 'string')
            text = tools[name]['description']
            self.assertIn('layer', text)
            self.assertIn('purpose', text)
            self.assertIn('A-', text)
        policy = bridge.CAD_DRAWING_INSTRUCTIONS
        for term in ('cad_get_layer_usage','cad_list_commands','cad_get_command','WALDRAW','사용자 등록 리습','기본 도형'):
            self.assertIn(term, policy)

    def test_layer_usage_reads_real_json_in_review_mode(self):
        with patch('miri_account_service.require_ai_login', return_value=True):
            usage = bridge.call_app('cad_get_layer_usage', {}, allow_edit=False)
        usage.pop('destination', None)   # 도구 결과마다 붙는 '어느 도면 칸에 답했는가'(bridge.call_app) — 규칙 내용과 별개
        self.assertEqual(usage, json.loads((ROOT/'rules/knowledge/layer-usage.json').read_text(encoding='utf8')))
        self.assertIsInstance(usage, dict)
        self.assertIn('tool_choice', usage)
        self.assertTrue(any('layer' in str(item).lower() for item in usage['tool_choice']))
        self.assertNotIn('write', json.dumps(usage, ensure_ascii=False).lower())

    def test_policy_matches_json_tool_choice(self):
        usage = json.loads((ROOT / 'rules' / 'knowledge' / 'layer-usage.json').read_text(encoding='utf-8'))
        joined = '\n'.join(usage['tool_choice'])
        for term in ('명령', '리습', '기본 도형', 'layer', '경고'):
            self.assertIn(term, joined)

    def test_mcp_initialize_exposes_the_shared_drawing_policy(self):
        output=io.StringIO()
        with patch('sys.stdin',io.StringIO(json.dumps({'id':1,'method':'initialize'})+'\n')),patch('sys.stdout',output):
            mcp_server.serve()
        instructions=json.loads(output.getvalue())['result']['instructions']
        self.assertIn(bridge.CAD_DRAWING_INSTRUCTIONS.strip(), instructions)

    def test_codex_execute_and_review_and_miri_receive_shared_instructions(self):
        self.assertIn(bridge.CAD_DRAWING_INSTRUCTIONS, codex_chat.ACTION_INSTRUCTIONS)
        self.assertIn(bridge.CAD_DRAWING_INSTRUCTIONS, miri_chat.CAD_ACTION_INSTRUCTIONS)
        with tempfile.TemporaryDirectory() as folder,patch('miri_account_service.require_ai_login',new=lambda:None),patch.object(codex_chat,'DATA',Path(folder)):
            for mode in ('review','execute'):
                client=codex_chat.Client();client.start=Mock();client.save_history=Mock()
                client.configured_mcp=Mock(return_value=[]);client.verify_mcp=Mock()
                client.rpc=Mock(side_effect=[{'thread':{'id':mode}},{}])
                client.chat({'project':folder,'mode':mode,'message':'조회'})
                instructions=client.rpc.call_args_list[0].args[1]['developerInstructions']
                self.assertIn(bridge.CAD_DRAWING_INSTRUCTIONS,instructions)

    def test_invalid_layer_arguments_do_not_reach_renderer(self):
        for value in ('',123,[],True,'x'*201):
            with patch('miri_account_service.require_ai_login',new=lambda:None),patch.object(bridge,'dispatch') as dispatch:
                with self.assertRaises(ValueError):bridge.call('cad_preview',{'command':{},'layer':value})
                dispatch.assert_not_called()

if __name__ == '__main__':
    unittest.main()
