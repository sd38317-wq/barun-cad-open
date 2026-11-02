"""Replay renderer wire payloads through an isolated MCP job (no HTTP server)."""
import json
import sys
import uuid
from unittest.mock import patch

import bridge
import vault_gate

# 작도 기준은 개발 실행도 서버에서만 받는다(2026-10-25) — 시험은 저장소 파일을 '서버에서 받은 것'으로 넣는다
vault_gate._server = {n: (vault_gate.KNOWLEDGE_DIR / n).read_bytes()
                      for n in vault_gate.SERVER_KNOWLEDGE if (vault_gate.KNOWLEDGE_DIR / n).exists()}


def replay(wire):
    first, *pulses = wire['pulses']
    target = wire['request']['args']['target']
    with (patch.object(bridge, 'BACKEND_GENERATION', target['backend_generation']),
          patch.object(bridge, 'schedule_recovery'),
          patch.object(bridge, 'recovery_has_content', return_value=False),
          patch.object(bridge, 'recovery_error', return_value=None),
          patch('miri_account_service.require_ai_login'),
          patch('miri_account_service.capture_ai_epoch', return_value=None),
          patch('miri_account_service.validate_ai_epoch')):
        with patch.object(bridge.uuid, 'uuid4', return_value=uuid.UUID(target['snapshot_id'])):
            assert bridge.pulse(first)['target'] == target
        inputs = wire['request']['args']['request']
        with patch.object(bridge, 'JOB_RESPONSE_SECONDS', .001):
            job = bridge.call('cad_generate_drawing', {
                'target': target, **{k: v for k, v in inputs.items() if k != 'standard'}})
        assert job['status'] == 'running', job
        with bridge.lock:
            assert bridge.lock.wait_for(lambda: bridge.queue.get(first['client']), timeout=10)  # 전체 시험을 병렬로 돌리면 2초를 넘길 때가 있었다(7.0.41 빌드 2회)
            request_id = bridge.queue[first['client']][0]['id']
        rejected = []
        for pulse in pulses:
            for result in pulse['results']:
                result['id'] = request_id
            rejected.extend(bridge.pulse(pulse)['rejected_results'])
        completed = bridge.get_job({'job_id': job['job_id'], 'wait_seconds': 2})
        assert completed['status'] == 'completed', completed
        result = completed['result']
        assert result['target']['revision'] == pulses[-1]['revision']
        document = bridge.snapshot(first['client'])['document']
        assert document['blocks'] and document['sharedBlocks']
        assert any(e.get('sheetFrame') and e.get('sharedBlock') for e in document['entities'])
        assert not bridge.pending_requests
        return {'status': completed['status'], 'rejected_results': rejected,
                'revision': result['target']['revision'], 'added': result['added']}


if __name__ == '__main__':
    print(json.dumps(replay(json.load(sys.stdin))))
