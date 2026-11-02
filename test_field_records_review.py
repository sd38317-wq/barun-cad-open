"""현장 기록 날짜 복원, 요청 유효성, 장부 수정 승인 회귀 시험."""
import copy
from contextlib import nullcontext
from pathlib import Path
from unittest.mock import patch

import pytest
import bridge
import field_records as fr
import field_records_ai as ai
import test_mcp_3d as fixtures


@pytest.fixture
def ledger(tmp_path, monkeypatch):
    monkeypatch.setenv('BARUN_FIELD_RECORDS_HOME', str(tmp_path / 'home'))
    monkeypatch.setenv('BARUN_FIELD_RECORDS_SPOOL', str(tmp_path / 'spool'))
    context = {'drawingPath': str(tmp_path / '현장.dwg'), 'drawingName': '현장'}
    fr.process({**context, 'action': 'append', 'events': [
        {'id': 'receive:p1', 'kind': 'pin', 'link': 'l1', 'at': '2020-10-16T09:00:00+09:00',
         'pin': {'id': 'p1', 'no': 3, 'title': '확인', 'at': {'x': 1, 'y': 2}, 'photos': []}}]})
    return context


@pytest.mark.parametrize('received', ['bad-date', '2020-02-30T09:00:00Z', 42])
@pytest.mark.parametrize('filters', [{}, {'status': '열림'}, {'date_from': '2020-10-16'}, {'date_to': '2020-10-16'}])
def test_malformed_received_date_does_not_break_other_records(ledger, received, filters):
    data = fr.process({**ledger, 'action': 'read'})
    malformed = copy.deepcopy(data['pins'][0])
    malformed.update(id='bad', no=4, firstAt=received)
    data['pins'].append(malformed)
    with patch.object(fr, 'process', return_value=data):
        result = ai.call('cad_field_records_list', filters, ledger)
    assert [pin['id'] for pin in result['records']] == (['p1'] if any(k.startswith('date_') for k in filters) else ['p1', 'bad'])
    if not any(k.startswith('date_') for k in filters):
        assert result['records'][1]['firstAt'] == received


@pytest.mark.parametrize('action,args', [('list', {}), ('get', {'pin_no': 3}), ('locate', {'pin_no': 3})])
@pytest.mark.parametrize('when', ['before', 'after'])
def test_read_checks_request_before_io_and_after_io(ledger, action, args, when):
    real = fr.process
    checks = 0
    def current():
        nonlocal checks
        checks += 1
        if when == 'before' or checks == 2:
            raise ValueError('AI 요청을 중지했습니다.')
    with patch.object(fr, 'process', side_effect=real) as process:
        with pytest.raises(ValueError, match='중지'):
            ai.call('cad_field_records_' + action, args, ledger, assert_current=current)
    assert process.call_count == (0 if when == 'before' else 1)


@pytest.mark.parametrize('queued', [False, True])
def test_update_explicitly_reports_reply_not_delivered(ledger, queued):
    with patch.object(fr, '_append', side_effect=OSError('연결 끊김')) if queued else nullcontext():
        result = ai.call('cad_field_records_update', {'pin_no': 3, 'reply': '확인했습니다'}, ledger)
    assert result['delivered'] is False
    assert result['queued'] is queued


@patch('miri_account_service.require_ai_login', new=lambda: None)
class TestFieldRecordsAuthorization:
    def setup_method(self):
        self.fixture = fixtures.Mcp3DTest()
        self.fixture.setUp()
        self.session = self.fixture.session
        self.target = self.fixture.target
        self.path = str(Path(self.fixture.folder.name) / '현장.dwg')
        bridge.clients[self.session]['drawingPath'] = self.path

    def teardown_method(self):
        self.fixture.doCleanups()

    def test_update_schema_requires_target_without_drawing_revision_mutation(self):
        schema = next(t['inputSchema'] for t in bridge.TOOLS if t['name'] == 'cad_field_records_update')
        assert 'target' in schema['required']
        assert 'cad_field_records_update' not in bridge.MUTATING_TOOLS

    @pytest.mark.parametrize('explicit_path', [False, True])
    def test_update_without_target_never_reads_or_changes_ledger(self, explicit_path):
        args = {'pin_no': 3, 'reply': '답'}
        if explicit_path:
            args['path'] = self.path
        with patch.object(ai, 'call') as adapter, patch.object(bridge, 'dispatch') as dispatch:
            with pytest.raises(ValueError):
                bridge.call('cad_field_records_update', args)
        adapter.assert_not_called()
        dispatch.assert_not_called()

    @pytest.mark.parametrize('authorization', [{}, {'authorized': False}, {'authorized': 'true'}, {'authorized': True, 'applied': True}])
    def test_update_rejects_missing_renderer_authorization(self, authorization):
        with patch.object(ai, 'call') as adapter, patch.object(bridge, 'dispatch', return_value=authorization) as dispatch:
            with pytest.raises(ValueError):
                bridge.call('cad_field_records_update', {'target': self.target, 'pin_no': 3, 'reply': '답'})
        adapter.assert_not_called()
        dispatch.assert_called_once_with('cad_field_records_authorize', {'target': self.target})

    def test_update_authorizes_same_target_before_reading_ledger(self):
        calls = []
        def authorize(action, args):
            calls.append(('authorize', action, args))
            return {'authorized': True, 'applied': False}
        def adapter(name, args, context, *, assert_current):
            calls.append(('ledger', context))
            assert_current()
            return {'delivered': False}
        with patch.object(ai, 'call', side_effect=adapter), patch.object(bridge, 'dispatch', side_effect=authorize):
            result = bridge.call('cad_field_records_update', {'target': self.target, 'pin_no': 3, 'reply': '답'})
        assert calls[0] == ('authorize', 'cad_field_records_authorize', {'target': self.target})
        assert calls[1] == ('ledger', {'drawingPath': self.path, 'drawingName': 'drawing', 'draftKey': ''})
        assert result['delivered'] is False
        assert bridge.clients[self.session]['revision'] == self.target['revision']

    @pytest.mark.parametrize('change', ['path', 'revision', 'cancelled'])
    def test_update_rechecks_after_renderer_authorization(self, change):
        cancelled = [False]
        def authorize(*_):
            if change == 'path':
                bridge.clients[self.session]['drawingPath'] += '.changed'
            elif change == 'revision':
                bridge.clients[self.session]['revision'] += 1
            else:
                cancelled[0] = True
            return {'authorized': True, 'applied': False}
        with patch.object(ai, 'call') as adapter, patch.object(bridge, 'dispatch', side_effect=authorize):
            with pytest.raises(ValueError):
                bridge.call_app('cad_field_records_update', {'target': self.target, 'pin_no': 3, 'reply': '답'},
                                True, request_origin=self.session, cancelled=lambda: cancelled[0])
        adapter.assert_not_called()

    @pytest.mark.parametrize('action,args', [('list', {}), ('get', {'pin_no': 3})])
    @pytest.mark.parametrize('when', ['before', 'after'])
    def test_path_only_read_rechecks_request_even_without_editor(self, action, args, when):
        with bridge.lock:
            bridge.clients.clear()
            bridge.active = None
        checks = 0
        def active():
            nonlocal checks
            checks += 1
            if when == 'before' or checks == 2:
                raise ValueError('AI 요청을 중지했습니다.')
        with patch.object(ai, 'call', return_value={}) as adapter, patch.object(bridge, 'assert_app_active', side_effect=active):
            with pytest.raises(ValueError, match='중지'):
                bridge.call('cad_field_records_' + action, {'path': self.path, **args})
        assert adapter.call_count == (0 if when == 'before' else 1)

    def test_authorization_dispatch_supports_large_drawing_without_geometry(self):
        state = bridge.clients[self.session]
        state.pop('document')
        state['documentOmitted'] = 60000
        with patch.object(bridge, '_send_locked', return_value={'authorized': True, 'applied': False}) as send:
            assert bridge.dispatch('cad_field_records_authorize', {'target': self.target})['authorized'] is True
        assert send.call_args.args[1] == 'cad_field_records_authorize'

    @pytest.mark.parametrize('expire_during_read', [False, True])
    def test_expired_authorization_never_appends(self, expire_during_read, ledger):
        self.path = ledger['drawingPath']
        bridge.clients[self.session]['drawingPath'] = self.path
        now = [bridge.time.monotonic()]
        real_process = fr.process
        actions = []
        def process(data):
            actions.append(data['action'])
            result = real_process(data)
            if expire_during_read:
                now[0] += 1
            return result
        def authorize(*_):
            if not expire_during_read:
                now[0] += 1
            return {'authorized': True, 'applied': False}
        with patch.object(bridge.time, 'monotonic', side_effect=lambda: now[0]), \
                patch.object(bridge, 'dispatch_timeout', return_value=0.5), \
                patch.object(bridge, 'dispatch', side_effect=authorize), \
                patch.object(fr, 'process', side_effect=process):
            with pytest.raises(ValueError, match='만료'):
                bridge.call('cad_field_records_update', {'target': self.target, 'pin_no': 3, 'reply': '답'})
        assert actions == (['read'] if expire_during_read else [])
        assert real_process({**ledger, 'action': 'read'})['pins'][0]['replies'] == []
