"""출력 명령의 무변경 응답과 완료 뒤 한 번만 허용되는 QQ 닫기 승인."""
import time
import uuid
from unittest.mock import patch

import pytest
import bridge
import chat_router


@pytest.fixture
def editor(monkeypatch):
    for table in (bridge.clients, bridge.queue, bridge.results, bridge.pending_requests):
        table.clear()
    if hasattr(bridge, 'output_close_receipts'):
        bridge.output_close_receipts.clear()
    bridge.active = None
    monkeypatch.setattr(bridge, 'schedule_recovery', lambda *_: None)
    monkeypatch.setattr('miri_account_service.require_ai_login', lambda: None)
    monkeypatch.setattr('miri_account_service.capture_ai_epoch', lambda: 'epoch')
    monkeypatch.setattr('miri_account_service.validate_ai_epoch', lambda epoch: None)
    client = str(uuid.uuid4())
    body = {'client': client, 'editor_session': client, 'protocol_version': 1,
            'document_generation': str(uuid.uuid4()), 'revision': 3, 'document_revision': 3,
            'document': {'entities': []}, 'active': True}
    target = bridge.pulse(body)['target']
    yield client, body, target
    for table in (bridge.clients, bridge.queue, bridge.results, bridge.pending_requests):
        table.clear()
    if hasattr(bridge, 'output_close_receipts'):
        bridge.output_close_receipts.clear()
    bridge.active = None


def answer(request, *, applied=True, **extra):
    target = request['args']['target']
    revision = request['revision']
    return {'id': request['id'], 'target': target, 'result': {
        'target': target, 'before_revision': revision, 'after_revision': revision,
        'revision': revision, 'applied': applied, **extra}}


def pending(editor, action='cad_run_command', command='QQ', *, deadline=None, cancelled=None):
    client, body, target = editor
    identifier = str(uuid.uuid4())
    args = {'target': target, 'command' if action == 'cad_ui_command' else 'name': command}
    request = {'id': identifier, 'action': action, 'args': args, 'revision': target['revision']}
    bridge.pending_requests[identifier] = {'recipient': client, 'request': request,
        'deadline': deadline if deadline is not None else time.monotonic() + 120,
        'login_epoch': 'epoch', 'cancelled': cancelled}
    return request


@pytest.mark.parametrize('command', ['MSL', 'QQ', ' qq '])
def test_output_no_change_result_is_accepted(editor, command):
    _, body, _ = editor
    request = pending(editor, command=command)
    response = bridge.pulse({**body, 'results': [answer(request, applied=False, cancelled=True)]})
    assert response['rejected_results'] == []
    assert bridge.results[request['id']]['result']['applied'] is False


@pytest.mark.parametrize('action,command', [('cad_run_command', 'WAL'), ('cad_execute', 'QQ'), ('cad_undo', 'QQ')])
def test_other_mutations_still_reject_applied_false(editor, action, command):
    _, body, _ = editor
    request = pending(editor, action=action, command=command)
    response = bridge.pulse({**body, 'results': [answer(request, applied=False)]})
    assert response['rejected_results'] == [request['id']]
    assert request['id'] not in bridge.results


@pytest.mark.parametrize('action,targeted', [('cad_run_command', True), ('cad_ui_command', True), ('cad_ui_command', False)])
def test_success_receipt_survives_pending_removal_and_is_one_use(editor, action, targeted):
    client, body, target = editor
    delivered = []
    def deliver(_):
        request = bridge.queue[client][0]
        delivered.append(request)
        assert bridge.pulse({**body, 'results': [answer(request, deferred=['window'], pending=1)]})['rejected_results'] == []
    args = {'target': target if targeted else None, 'command' if action == 'cad_ui_command' else 'name': 'QQ'}
    with bridge.lock, patch.object(bridge.lock, 'wait', side_effect=deliver):
        bridge._send_locked(client, action, args, target['revision'])
    identifier = delivered[0]['id']
    assert identifier not in bridge.pending_requests
    with pytest.raises(ValueError):
        bridge.validate_app_request(identifier, client)
    assert bridge.validate_output_close(identifier, client) == {'authorized': True}
    with pytest.raises(ValueError):
        bridge.validate_output_close(identifier, client)


@pytest.mark.parametrize('problem', ['logout', 'epoch', 'cancelled', 'expired', 'recipient', 'generation', 'revision', 'closed'])
def test_receipt_rechecks_original_authority_and_current_document(editor, monkeypatch, problem):
    client, body, target = editor
    stopped = [False]
    request = pending(editor, cancelled=lambda: stopped[0])
    bridge.pulse({**body, 'results': [answer(request, deferred=['window'], pending=1)]})
    bridge.pending_requests.pop(request['id'])
    if problem == 'logout':
        monkeypatch.setattr('miri_account_service.require_ai_login', lambda: (_ for _ in ()).throw(ValueError('로그인')))
    elif problem == 'epoch':
        monkeypatch.setattr('miri_account_service.validate_ai_epoch', lambda epoch: (_ for _ in ()).throw(ValueError('로그인 변경')))
    elif problem == 'cancelled':
        stopped[0] = True
    elif problem == 'expired':
        now = time.monotonic()
        monkeypatch.setattr(bridge.time, 'monotonic', lambda: now + 31)
    elif problem == 'generation':
        bridge.clients[client]['document_generation'] = str(uuid.uuid4())
    elif problem == 'revision':
        bridge.clients[client]['revision'] += 1
    elif problem == 'closed':
        bridge.clients.pop(client)
    recipient = str(uuid.uuid4()) if problem == 'recipient' else client
    with pytest.raises(ValueError):
        bridge.validate_output_close(request['id'], recipient)


def test_same_document_with_new_snapshot_id_keeps_close_authorized(editor):
    client, body, _ = editor
    request = pending(editor)
    bridge.pulse({**body, 'results': [answer(request, deferred=['window'], pending=1)]})
    bridge.clients[client]['snapshot_id'] = str(uuid.uuid4())
    assert bridge.validate_output_close(request['id'], client)['authorized'] is True


@pytest.mark.parametrize('case', ['rejected_target', 'rejected_revision', 'error', 'cancelled', 'nothing_pending', 'other_command', 'recipient'])
def test_only_accepted_successful_qq_creates_close_receipt(editor, case):
    client, body, target = editor
    request = pending(editor, command='MSL' if case == 'other_command' else 'QQ')
    result = answer(request, deferred=['window'], pending=1)
    if case == 'rejected_target':
        result['target'] = {**target, 'snapshot_id': str(uuid.uuid4())}
    elif case == 'rejected_revision':
        result['result']['before_revision'] += 1
    elif case == 'error':
        result['error'] = '출력 실패'
    elif case == 'cancelled':
        result['result']['cancelled'] = True
    elif case == 'nothing_pending':
        result['result'].update(deferred=[], pending=0)
    elif case == 'recipient':
        bridge.pending_requests[request['id']]['recipient'] = str(uuid.uuid4())
    response = bridge.pulse({**body, 'results': [result]})
    if case.startswith('rejected') or case == 'recipient':
        assert response['rejected_results'] == [request['id']]
    with pytest.raises(ValueError):
        bridge.validate_output_close(request['id'], client)


def test_receipt_never_outlives_original_request(editor, monkeypatch):
    client, body, _ = editor
    now = time.monotonic()
    request = pending(editor, deadline=now + 1)
    bridge.pulse({**body, 'results': [answer(request, deferred=['window'], pending=1)]})
    monkeypatch.setattr(bridge.time, 'monotonic', lambda: now + 2)
    with pytest.raises(ValueError):
        bridge.validate_output_close(request['id'], client)


def test_chat_router_uses_dedicated_close_validator(editor):
    with patch.object(bridge, 'validate_output_close', create=True, return_value={'authorized': True}) as validate, \
            patch.object(chat_router, 'provider', return_value='miri'), \
            patch.object(chat_router, 'backend', side_effect=AssertionError('must not call chat provider')):
        assert chat_router.process({'action': 'validateOutputClose', 'requestId': 'request', 'recipient': 'editor'}) == {'authorized': True}
    validate.assert_called_once_with('request', 'editor')


def test_receipts_are_bounded_and_expired_entries_are_reclaimed(editor, monkeypatch):
    client, body, _ = editor
    monkeypatch.setattr(bridge, 'OUTPUT_CLOSE_LIMIT', 1)
    first = pending(editor)
    bridge.pulse({**body, 'results': [answer(first, deferred=['window'], pending=1)]})
    second = pending(editor)
    bridge.pulse({**body, 'results': [answer(second, deferred=['window'], pending=1)]})
    assert list(bridge.output_close_receipts) == [first['id']]
    with pytest.raises(ValueError):
        bridge.validate_output_close(second['id'], client)
    now = time.monotonic()
    monkeypatch.setattr(bridge.time, 'monotonic', lambda: now + 31)
    third = pending(editor)
    bridge.pulse({**body, 'results': [answer(third, deferred=['window'], pending=1)]})
    assert list(bridge.output_close_receipts) == [third['id']]
    assert bridge.validate_output_close(third['id'], client)['authorized'] is True


def test_duplicate_pulse_cannot_restore_consumed_receipt(editor):
    client, body, _ = editor
    request = pending(editor)
    result = answer(request, deferred=['window'], pending=1)
    bridge.pulse({**body, 'results': [result]})
    assert bridge.validate_output_close(request['id'], client)['authorized'] is True
    bridge.pulse({**body, 'results': [result]})
    with pytest.raises(ValueError):
        bridge.validate_output_close(request['id'], client)


def test_validate_tool_is_repeatable_while_request_is_pending(editor):
    # 같은 대기 요청의 재검증은 소비하지 않는다. 종료 후의 허용과는 별개다.
    client, _, _ = editor
    request = pending(editor, command='MSL')
    for _ in range(2):
        assert bridge.validate_app_request(request['id'], client) == {'authorized': True}
    assert request['id'] in bridge.pending_requests
