"""현장 기록 도구의 공통 로그인·도면 선택·화면 전달 계약."""
import copy
import io
import json
import sys
import types
import unittest
from unittest.mock import Mock, patch

import bridge
import mcp_server
import test_mcp_3d as fixtures

NAMES = ('cad_field_records_list', 'cad_field_records_get', 'cad_field_records_update', 'cad_field_records_locate')


@patch('miri_account_service.require_ai_login', new=lambda: None)
class FieldRecordsMcpTest(unittest.TestCase):
    setUp = fixtures.Mcp3DTest.setUp
    clear_state = fixtures.Mcp3DTest.clear_state

    def adapter(self, value=None):
        call = Mock(return_value=value or {'records': [], 'count': 0})
        self.enterContext(patch.dict(sys.modules, {'field_records_ai': types.SimpleNamespace(call=call)}))
        return call

    def test_four_tools_are_shared_and_update_is_hidden_in_review(self):
        external = {t['name']: t for t in bridge.mcp_tools()}
        app = {t['name'] for t in bridge.app_tools(True)}
        review = {t['name'] for t in bridge.app_tools(False)}
        for name in NAMES:
            self.assertIn(name, external)
            self.assertIn(name, app)
            schema = external[name]['inputSchema']
            self.assertEqual(schema['type'], 'object')
            self.assertFalse(schema['additionalProperties'])
            self.assertIn('target', schema['properties'])
        self.assertNotIn(NAMES[2], review)
        self.assertTrue(set(NAMES) - {NAMES[2]} <= review)
        self.assertNotIn(NAMES[2], bridge.MUTATING_TOOLS)  # 장부 변경은 도면 수정 번호를 올리지 않는다.

    def test_current_drawing_uses_only_metadata_even_for_large_drawing(self):
        call = self.adapter()
        with bridge.lock:
            state = bridge.clients[self.session]
            state.update(drawingPath=str(__import__('pathlib').Path(self.folder.name)/'현장.dwg'), draftKey='tab-key', documentOmitted=60000)
            state.pop('document')
        original = {'status': '열림', 'target': copy.deepcopy(self.target)}
        bridge.call(NAMES[0], original)
        name, args, context = call.call_args.args
        self.assertEqual(name, NAMES[0])
        self.assertEqual(args, original)
        self.assertEqual(context['drawingPath'], str(__import__('pathlib').Path(self.folder.name)/'현장.dwg'))
        self.assertEqual(context['draftKey'], 'tab-key')
        self.assertNotIn('document', context)
        self.assertEqual(original['target'], self.target)

    def test_explicit_saved_path_works_without_editor_and_bad_path_is_rejected(self):
        call = self.adapter()
        path = str(__import__('pathlib').Path(self.folder.name)/'별도.dwg')
        with bridge.lock:
            bridge.clients.clear()
            bridge.active = None
        bridge.call(NAMES[0], {'path': path})
        self.assertEqual(call.call_args.args[2]['drawingPath'], path)
        for value in ('relative.dwg', '', '../other.dwg', True, str(__import__('pathlib').Path(self.folder.name)/'bad.txt')):
            call.reset_mock()
            with self.subTest(value=value), self.assertRaises(ValueError):
                bridge.call(NAMES[0], {'path': value})
            call.assert_not_called()

    def test_app_origin_beats_focused_window_and_update_checks_context_before_write(self):
        other = copy.deepcopy(bridge.clients[self.session])
        with bridge.lock:
            bridge.clients['other'] = other
            bridge.active = 'other'
            bridge.clients[self.session]['draftKey'] = 'origin-tab'
        call = self.adapter()
        bridge.call_app(NAMES[0], {}, False, request_origin=self.session)
        self.assertEqual(call.call_args.args[2]['draftKey'], 'origin-tab')
        # 실제 어댑터가 쓰기 직전에 호출하는 검사: 도면을 바꾸면 기록하지 않는다.
        def apply(name, args, context, *, assert_current):
            bridge.clients[self.session]['drawingPath'] = 'C:/changed.dwg'
            assert_current()
        call.side_effect = apply
        with patch.object(bridge, 'dispatch', return_value={'authorized': True, 'applied': False}), self.assertRaisesRegex(ValueError, '도면'):
            bridge.call_app(NAMES[2], {'target': self.target, 'pin_no': 3, 'reply': '확인'}, True, request_origin=self.session)

    def test_update_in_review_is_rejected_before_adapter(self):
        call = self.adapter()
        for invoke in (bridge.call, bridge.call_app):
            with self.assertRaises(ValueError):
                invoke(NAMES[2], {'pin_no': 3, 'status': '처리됨'}, False)
        call.assert_not_called()

    def test_locate_dispatches_saved_pin_and_rejects_other_drawing(self):
        path = str(__import__('pathlib').Path(self.folder.name)/'현장.dwg')
        with bridge.lock:
            bridge.clients[self.session]['drawingPath'] = path
        record = {'id': 'p1', 'link_id': 'l1', 'no': 3, 'at': {'x': 1200, 'y': 3400}}
        self.adapter({'record': record, 'drawingPath': path})
        with patch.object(bridge, 'dispatch', return_value={'located': True, 'applied': False}) as dispatch:
            self.assertTrue(bridge.call(NAMES[3], {'pin_no': 3})['located'])
        sent = dispatch.call_args.args
        self.assertEqual(sent[0], NAMES[3])
        self.assertEqual(sent[1]['record'], record)
        self.assertEqual(sent[1]['target'], self.target)
        with patch.object(bridge, 'dispatch') as dispatch, self.assertRaises(ValueError):
            bridge.call(NAMES[3], {'pin_no': 3, 'path': str(__import__('pathlib').Path(self.folder.name)/'other.dwg')})
        dispatch.assert_not_called()

    def test_stale_target_never_reads_ledger(self):
        call = self.adapter()
        with bridge.lock:
            bridge.clients[self.session]['revision'] += 1
        with self.assertRaises(ValueError):
            bridge.call(NAMES[0], {'target': self.target})
        call.assert_not_called()


    def test_large_drawing_locate_reaches_real_dispatch_without_geometry(self):
        call = self.adapter({'record': {'id': 'p1', 'no': 3, 'at': {'x': 1, 'y': 2}}})
        with bridge.lock:
            state = bridge.clients[self.session]
            state.pop('document')
            state['documentOmitted'] = 60000
        with patch.object(bridge, '_send_locked', return_value={'located': True}) as send:
            self.assertTrue(bridge.call(NAMES[3], {'pin_no': 3})['located'])
        self.assertEqual(send.call_args.args[1], NAMES[3])
        self.assertTrue(call.called)


    def test_real_ledger_through_mcp_and_app_entrypoints(self):
        import os
        from pathlib import Path
        import field_records
        path = str(Path(self.folder.name) / '현장.dwg')
        with bridge.lock:
            bridge.clients[self.session].update(drawingPath=path, draftKey='tab-key')
        with patch.dict(os.environ, {'BARUN_FIELD_RECORDS_SPOOL': str(Path(self.folder.name) / 'spool')}):
            field_records.process({'action': 'append', 'drawingPath': path, 'events': [
                {'id': 'received-1', 'kind': 'pin', 'link': 'l1', 'at': '2020-10-16T09:00:00+09:00',
                 'pin': {'id': 'p1', 'no': 3, 'title': '창가 누수', 'note': '배관 확인',
                         'status': '미해결', 'photos': [], 'at': {'x': 1200, 'y': 3400}}}]})
            listing = bridge.call(NAMES[0], {})
            self.assertEqual(listing['records'][0]['no'], 3)
            detail = bridge.call_app(NAMES[1], {'pin_no': 3}, False, request_origin=self.session)
            self.assertEqual(detail['record']['note'], '배관 확인')
            with patch.object(bridge, 'dispatch', return_value={'authorized': True, 'applied': False}) as authorize:
                update = bridge.call_app(NAMES[2], {'target': self.target, 'pin_no': 3, 'status': '처리됨', 'reply': '확인했습니다'},
                                         True, request_origin=self.session)
            authorize.assert_called_once_with('cad_field_records_authorize', {'target': self.target})
            self.assertFalse(update['delivered'])
            self.assertEqual((update['deleted'], update['added']), (0, 2))
            detail = bridge.call(NAMES[1], {'path': path, 'pin_no': 3})
            self.assertEqual(detail['record']['status'], '처리됨')
            self.assertEqual(len(detail['record']['history']), 3)
            self.assertEqual(detail['drawingPath'], path)

    def test_explicit_path_with_session_checks_same_drawing(self):
        call = self.adapter()
        from pathlib import Path
        with bridge.lock:
            bridge.clients[self.session]['drawingPath'] = str(Path(self.folder.name) / '현장.dwg')
        with self.assertRaises(ValueError):
            bridge.call(NAMES[0], {'path': str(Path(self.folder.name) / '다른.dwg'),
                                   'editor_session': self.session})
        call.assert_not_called()

    def test_stdio_photo_preview_is_an_image_block(self):
        request = {'id': 1, 'method': 'tools/call', 'params': {'name': NAMES[1], 'arguments': {'pin_no': 3, 'include_preview': True}}}
        output = io.StringIO()
        with patch.object(mcp_server, 'call', return_value={'record': {'no': 3}, 'image': {'mimeType': 'image/jpeg', 'data': 'SlBFRw=='}}), patch('sys.stdin', io.StringIO(json.dumps(request)+'\n')), patch('sys.stdout', output):
            mcp_server.serve()
        content = json.loads(output.getvalue())['result']['content']
        self.assertEqual(content[1]['type'], 'image')
        self.assertEqual(content[1]['mimeType'], 'image/jpeg')
        self.assertNotIn('SlBFRw==', content[0]['text'])


class FieldRecordsLoginTest(unittest.TestCase):
    def test_all_four_tools_reject_before_io_at_both_entrypoints(self):
        from miri_account_service import AILoginRequired
        with patch('miri_account_service.require_ai_login', side_effect=AILoginRequired()), patch.object(bridge, 'dispatch') as dispatch, patch.object(bridge, '_call') as call:
            for name in NAMES:
                for invoke in (bridge.call, bridge.call_app):
                    with self.subTest(name=name, entry=invoke.__name__), self.assertRaises(AILoginRequired):
                        invoke(name, {})
            dispatch.assert_not_called()
            call.assert_not_called()
