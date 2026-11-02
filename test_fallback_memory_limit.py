"""보조 프로세스 보호와 조용한 누락의 실제 제어 흐름 회귀시험."""
import json
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock
import subprocess
import sys

import ezdxf
import pytest
import batch_converter as converter


@pytest.mark.parametrize('code, log, expected', [
    (-6, b'memory allocation of 4294967296 bytes failed', True),
    (0xC0000017, b'', True),
    (-1073741801, b'', True),
    (-9, b'', False), (137, b'', False), (1, b'bad drawing', False),
])
def test_memory_failure_requires_allocation_evidence(code, log, expected):
    assert converter._fallback_memory_exceeded(SimpleNamespace(returncode=code, stdout=log)) is expected


def test_synchronous_fallback_attaches_job_before_waiting(monkeypatch):
    events = []
    child = SimpleNamespace(returncode=0)
    child.communicate = lambda timeout=None: (events.append('wait') or (b'ok', None))
    child.kill = Mock()
    monkeypatch.setattr(converter.subprocess, 'Popen', lambda *a, **kw: events.append('spawn') or child)
    monkeypatch.setattr(converter, '_attach_to_job', lambda p: events.append('attach') or True)
    monkeypatch.setattr(converter, '_resume_fallback', lambda p: events.append('resume'))
    monkeypatch.setattr(converter, '_fallback_process_options', lambda: {})
    result = converter._run_fallback(['auxiliary'], timeout=12)
    assert events == (['spawn', 'attach', 'resume', 'wait'] if converter.os.name == 'nt' else ['spawn', 'wait'])
    assert result.returncode == 0 and result.stdout == b'ok'
    child.kill.assert_not_called()


@pytest.mark.skipif(converter.os.name != 'nt', reason='Windows Job')
def test_job_attachment_failure_kills_the_unprotected_child(monkeypatch):
    child = SimpleNamespace(kill=Mock(), communicate=Mock(return_value=(b'', None)))
    monkeypatch.setattr(converter.subprocess, 'Popen', lambda *a, **kw: child)
    monkeypatch.setattr(converter, '_attach_to_job', lambda p: False)
    monkeypatch.setattr(converter, '_fallback_process_options', lambda: {})
    with pytest.raises(OSError, match='메모리 보호'):
        converter._start_fallback(['auxiliary'])
    child.kill.assert_called_once()
    child.communicate.assert_called_once()


def test_posix_launch_does_not_use_preexec_in_threaded_server(monkeypatch):
    monkeypatch.setattr(converter.os, 'name', 'posix')
    assert converter._fallback_process_options() == {}


def test_large_broken_source_cannot_succeed_as_empty_drawing(tmp_path, monkeypatch):
    primary = tmp_path / 'primary'; primary.mkdir()
    (primary / converter.CONVERTER).write_bytes(b'stub')
    auxiliary = tmp_path / 'auxiliary'; auxiliary.mkdir()
    (auxiliary / ('barun-dwg2dxf' + converter.runtime_paths.EXE)).write_bytes(b'stub')
    monkeypatch.setattr(converter, 'RUNTIME', primary)
    monkeypatch.setattr(converter.runtime_paths, 'bundled_runtime', lambda name: auxiliary)
    monkeypatch.setattr(converter.subprocess, 'run', lambda *a, **kw: SimpleNamespace(returncode=1, stdout=b'{}'))
    def fallback(args, **kwargs):
        ezdxf.new('R2018').saveas(args[args.index('-o') + 1])
        return SimpleNamespace(returncode=0, stdout=b'{"ok":true,"entities":0}')
    monkeypatch.setattr(converter, '_run_fallback', fallback)
    result = converter.process({'action':'convert', 'name':'broken.dwg', 'direction':'dwg-dxf',
        'folder':str(tmp_path), '_raw':b'AC10' + b'0' * 200001, '_no_parallel_fallback':True})
    assert result['failed'] is True
    assert result['verification']['code'] == 'FALLBACK_EMPTY_RESULT'
    assert not (tmp_path / 'broken.dxf').exists()


def test_equal_total_cannot_hide_a_missing_kind(tmp_path, monkeypatch):
    primary = tmp_path / 'primary'; primary.mkdir()
    (primary / converter.CONVERTER).write_bytes(b'stub')
    auxiliary = tmp_path / 'auxiliary'; auxiliary.mkdir()
    (auxiliary / ('barun-dwg2dxf' + converter.runtime_paths.EXE)).write_bytes(b'stub')
    monkeypatch.setattr(converter, 'RUNTIME', primary)
    monkeypatch.setattr(converter.runtime_paths, 'bundled_runtime', lambda name: auxiliary)
    report = {'inputTypes':{'Line':1, 'Circle':1}}
    monkeypatch.setattr(converter.subprocess, 'run', lambda *a, **kw: SimpleNamespace(returncode=1, stdout=json.dumps(report).encode()))
    def fallback(args, **kwargs):
        doc = ezdxf.new('R2018')
        doc.modelspace().add_line((0, 0), (1, 0)); doc.modelspace().add_line((0, 1), (1, 1))
        doc.saveas(args[args.index('-o') + 1])
        return SimpleNamespace(returncode=0, stdout=b'{"ok":true,"entities":2}')
    monkeypatch.setattr(converter, '_run_fallback', fallback)
    result = converter.process({'action':'convert', 'name':'missing.dwg', 'direction':'dwg-dxf',
        'folder':str(tmp_path), '_raw':b'AC10-test', '_no_parallel_fallback':True})
    assert result['failed'] is True
    assert result['verification'] == {'code':'FALLBACK_ENTITY_COUNT_MISMATCH', 'missingTypes':{'CIRCLE':1}, 'extraTypes':{'LINE':1}}
    assert not (tmp_path / 'missing.dxf').exists()


@pytest.mark.skipif(converter.os.name != 'nt', reason='Windows Job')
def test_real_windows_child_is_resumed_under_memory_limit(monkeypatch):
    # 작은 시험 상한으로 실제 Job 할당을 확인한다. 큰 메모리를 사용하지 않는다.
    monkeypatch.setattr(converter, '_JOB', None)
    monkeypatch.setattr(converter, 'FALLBACK_MEMORY_LIMIT', 64 * 1024 * 1024)
    program = 'import sys\ntry: x = bytearray(128 * 1024 * 1024)\nexcept MemoryError: print("memory allocation of 134217728 bytes failed"); sys.exit(23)\nsys.exit(0)'
    try:
        result = converter._run_fallback([sys.executable, '-c', program],
            stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=20)
        assert result.returncode == 23
        assert converter._fallback_memory_exceeded(result)
    finally:
        job = converter._JOB
        if job:
            job[0].CloseHandle(job[1])
