import os, tempfile, unittest
from pathlib import Path
from unittest.mock import Mock, patch
import codex_chat

class CodexAppToolsTests(unittest.TestCase):
    def make(self, root):
        with patch.object(codex_chat, 'DATA', Path(root)):
            c = codex_chat.Client()
        c.start = Mock(); c.verify_mcp = Mock(); c.configured_mcp = Mock(return_value=[])
        return c

    def test_execution_and_review_receive_app_tools_and_isolate_permissions(self):
        tools = [
            {'name': 'cad_get_document', 'description': 'read', 'parameters': {}},
            {'name': 'cad_execute', 'description': 'edit', 'parameters': {}},
        ]
        def app_tools(allow_edit=False):
            return tools if allow_edit else tools[:1]
        with tempfile.TemporaryDirectory() as root, patch.object(codex_chat.bridge, 'app_tools', side_effect=app_tools), patch('miri_account_service.require_ai_login', new=lambda: None):
            for mode, expected in [('review', tools[:1]), ('execute', tools)]:
                c = self.make(root); c.rpc = Mock(side_effect=[{'thread': {'id': mode}}, {}])
                c.chat({'project': root, 'mode': mode, 'message': '조회'})
                sent = c.rpc.call_args_list[0].args[1]['dynamicTools']
                self.assertEqual(sent, [{'type': 'function', **x} for x in expected])

    def test_tool_fingerprint_refreshes_stored_thread(self):
        with tempfile.TemporaryDirectory() as root, patch.object(codex_chat.bridge, 'app_tools', return_value=[{'name':'new','parameters':{}}]), patch('miri_account_service.require_ai_login', new=lambda: None):
            c = self.make(root); key = str(Path(root).resolve())
            c.history[key] = {'threadId':'old', 'toolFingerprint':'stale'}
            c.rpc = Mock(side_effect=[{'thread': {'id':'fresh'}}, {}])
            c.chat({'project': key, 'mode':'review', 'message':'조회'})
            self.assertEqual(c.rpc.call_args_list[0].args[0], 'thread/start')
            self.assertNotEqual(c.history[key]['toolFingerprint'], 'stale')

    def test_item_tool_call_uses_call_app_and_execution_flag(self):
        c = self.make(tempfile.mkdtemp()); c.process = Mock(); c.process.stdin = Mock()
        c.allow['t'] = True; c.active_threads.add('t')
        with patch.object(codex_chat.bridge, 'call_app', return_value={'ok': True}) as call, patch.object(c, 'send'):
            c.server_request({'id':'1','method':'item/tool/call','params':{'tool':'cad_execute','arguments':{},'threadId':'t'}})
        self.assertEqual(call.call_args.args,('cad_execute', {}));self.assertTrue(call.call_args.kwargs['allow_edit']);self.assertFalse(call.call_args.kwargs['cancelled']())

    def test_completed_job_image_is_sent_as_image_without_mutating_job_cache(self):
        import copy,json
        with tempfile.TemporaryDirectory() as folder:
            c=self.make(folder);c.active_threads.add('t');c.allow['t']=False
            result={'status':'completed','job_id':'fixture','result':{'image':{'mimeType':'image/png','data':'fixture-png'},'width':900}}
            original=copy.deepcopy(result)
            with patch.object(codex_chat.bridge,'call_app',return_value=result),patch.object(c,'send') as send:
                c.server_request({'id':'1','method':'item/tool/call','params':{'tool':'cad_get_job','arguments':{'job_id':'fixture'},'threadId':'t'}})
            items=send.call_args.args[0]['result']['contentItems']
            self.assertEqual(items[1],{'type':'inputImage','imageUrl':'data:image/png;base64,fixture-png'})
            self.assertNotIn('fixture-png',items[0]['text']);self.assertEqual(result,original)

if __name__ == '__main__': unittest.main()
