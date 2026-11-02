import subprocess
from types import SimpleNamespace
import pytest
import batch_converter as c

@pytest.mark.parametrize('code', [0xC00000FD, 0xC0000409, -9])
def test_crashes_require_job_evidence(code):
    assert not c._fallback_memory_exceeded(SimpleNamespace(returncode=code, stdout=b''))
    assert c._fallback_memory_exceeded(SimpleNamespace(returncode=code, stdout=b'', memory_limit_exceeded=True))

@pytest.mark.parametrize('log', [b'os error 1455', b'(os error 8)', b'(os error 14)'])
def test_localized_os_error_uses_numeric_code(log):
    assert c._fallback_memory_exceeded(SimpleNamespace(returncode=1, stdout=log))

def test_success_with_old_allocation_log_is_not_memory_failure():
    assert not c._fallback_memory_exceeded(SimpleNamespace(returncode=0, stdout=b'os error 1455'))

def test_result_preserves_job_evidence(monkeypatch):
    child=SimpleNamespace(args=['tool'],returncode=0xC0000409)
    monkeypatch.setattr(c, '_job_memory_exceeded', lambda p: p is child, raising=False)
    assert c._fallback_result(child,b'').memory_limit_exceeded

@pytest.mark.skipif(c.os.name!='nt',reason='Windows Job')
def test_real_job_evidence_without_english_log(monkeypatch):
    import sys
    monkeypatch.setattr(c,'_JOB',None)
    monkeypatch.setattr(c,'FALLBACK_MEMORY_LIMIT',64*1024*1024)
    try:
        result=c._run_fallback([sys.executable,'-c','import sys\ntry: x=bytearray(128*1024*1024)\nexcept MemoryError: sys.exit(19)'],stdout=subprocess.PIPE,stderr=subprocess.STDOUT,timeout=20)
        assert result.returncode==19
        assert result.memory_limit_exceeded
        assert c._fallback_memory_exceeded(result)
    finally:
        if c._JOB:
            c._JOB[0].CloseHandle(c._JOB[1])
            if len(c._JOB)>2:c._JOB[0].CloseHandle(c._JOB[2])

@pytest.mark.skipif(c.os.name!='nt',reason='Windows API')
def test_resume_uses_process_handle_not_thread_snapshot(monkeypatch):
    import ctypes
    from unittest.mock import Mock
    ntdll=SimpleNamespace(NtResumeProcess=Mock(return_value=0))
    monkeypatch.setattr(ctypes,'WinDLL',lambda name,**kw: ntdll if name=='ntdll' else pytest.fail('global snapshot requested'))
    c._resume_fallback(SimpleNamespace(_handle=0x123456789))
    ntdll.NtResumeProcess.assert_called_once_with(0x123456789)

@pytest.mark.skipif(c.os.name!='nt',reason='Windows API')
def test_job_closes_handle_on_exception(monkeypatch):
    import ctypes
    from unittest.mock import Mock
    kernel=SimpleNamespace(**{name:Mock() for name in ['CreateJobObjectW','SetInformationJobObject','AssignProcessToJobObject','CloseHandle','CreateIoCompletionPort','GetQueuedCompletionStatus']})
    kernel.CreateJobObjectW.return_value=0x123456789
    kernel.SetInformationJobObject.side_effect=RuntimeError('test setup failure')
    monkeypatch.setattr(c,'_JOB',None)
    monkeypatch.setattr(ctypes,'WinDLL',lambda *a,**kw:kernel)
    assert c._converter_job() is None
    kernel.CloseHandle.assert_called_once_with(0x123456789)
    assert kernel.CreateJobObjectW.restype is ctypes.wintypes.HANDLE

@pytest.mark.skipif(c.os.name!='nt',reason='Windows API')
def test_concurrent_job_initialization_creates_one_handle(monkeypatch):
    import ctypes,time
    from concurrent.futures import ThreadPoolExecutor
    from unittest.mock import Mock
    kernel=SimpleNamespace(**{name:Mock(return_value=1) for name in ['CreateJobObjectW','SetInformationJobObject','AssignProcessToJobObject','CloseHandle','CreateIoCompletionPort','GetQueuedCompletionStatus']})
    def create(*args):time.sleep(.02);return 0x123456789
    kernel.CreateJobObjectW.side_effect=create
    monkeypatch.setattr(c,'_JOB',None)
    monkeypatch.setattr(ctypes,'WinDLL',lambda *a,**kw:kernel)
    with ThreadPoolExecutor(max_workers=8) as pool:
        jobs=list(pool.map(lambda _:c._converter_job(),range(8)))
    assert len({id(job) for job in jobs})==1
    kernel.CreateJobObjectW.assert_called_once()

@pytest.mark.parametrize('code,expected',[(0xC00000FD,True),(0xC0000409,True)])
def test_parallel_cap_failure_is_not_retried(tmp_path,monkeypatch,code,expected):
    import json,ezdxf
    from unittest.mock import Mock
    primary=tmp_path/'primary';primary.mkdir()
    (primary/c.CONVERTER).write_bytes(b'stub')
    auxiliary=tmp_path/'auxiliary';auxiliary.mkdir()
    (auxiliary/('barun-dwg2dxf'+c.runtime_paths.EXE)).write_bytes(b'stub')
    monkeypatch.setattr(c,'RUNTIME',primary)
    monkeypatch.setattr(c.runtime_paths,'bundled_runtime',lambda _:auxiliary)
    child=SimpleNamespace(args=['tool'],returncode=code,communicate=lambda **kw:(b'',None),poll=lambda:code)
    monkeypatch.setattr(c,'_start_fallback',lambda *a,**kw:child)
    monkeypatch.setattr(c,'_job_memory_exceeded',lambda p:True,raising=False)
    monkeypatch.setattr(c.subprocess,'run',lambda *a,**kw:SimpleNamespace(returncode=1,stdout=b'{}'))
    retry=Mock(side_effect=AssertionError('cap failure retried'))
    monkeypatch.setattr(c,'_run_fallback',retry)
    with pytest.raises(c.ConversionFailure,match='메모리'):
        c._process({'action':'convert','name':'broken.dwg','direction':'dwg-dxf','folder':str(tmp_path),'_raw':b'AC10-test'})
    retry.assert_not_called()

@pytest.mark.parametrize('log,expected',[(b'barun_memory_limit_exceeded',True),(b'barun_memory_monitor_unavailable',False)])
def test_macos_explicit_guard_marker(log,expected):
    assert c._fallback_memory_exceeded(SimpleNamespace(returncode=71,stdout=log)) is expected

def test_warning_summary_uses_uncompacted_count(tmp_path,monkeypatch):
    import json,ezdxf
    primary=tmp_path/'primary';primary.mkdir()
    (primary/c.CONVERTER).write_bytes(b'stub')
    monkeypatch.setattr(c,'RUNTIME',primary)
    def convert(args,**kw):
        ezdxf.new('R2018').saveas(args[2])
        return SimpleNamespace(returncode=0,stdout=json.dumps({'warnings':['same warning']*3}).encode())
    monkeypatch.setattr(c.subprocess,'run',convert)
    result=c._process({'action':'convert','name':'input.dwg','direction':'dwg-dxf','folder':str(tmp_path),'_raw':b'AC10-test','_no_parallel_fallback':True})
    assert result['warningCount']==3
    assert any('엔진 주의사항 3건:' in warning for warning in result['warnings'])

def test_partial_primary_warning_list_is_not_mutated(tmp_path,monkeypatch):
    import json,ezdxf
    primary=tmp_path/'primary';primary.mkdir()
    (primary/c.CONVERTER).write_bytes(b'stub')
    auxiliary=tmp_path/'auxiliary';auxiliary.mkdir()
    (auxiliary/('barun-dwg2dxf'+c.runtime_paths.EXE)).write_bytes(b'stub')
    monkeypatch.setattr(c,'RUNTIME',primary)
    monkeypatch.setattr(c.runtime_paths,'bundled_runtime',lambda _:auxiliary)
    payload={'inputTypes':{'Line':2},'warnings':['original warning']}
    def convert(args,**kw):
        doc=ezdxf.new('R2018');doc.modelspace().add_line((0,0),(1,0));doc.saveas(args[2])
        return SimpleNamespace(returncode=0,stdout=json.dumps(payload).encode())
    captured=[];original_loads=json.loads
    def load(*args,**kw):
        result=original_loads(*args,**kw)
        if isinstance(result,dict) and result.get('inputTypes'):captured.append(result)
        return result
    monkeypatch.setattr(c.subprocess,'run',convert)
    monkeypatch.setattr(c.json,'loads',load)
    monkeypatch.setattr(c,'_run_fallback',lambda *a,**kw:SimpleNamespace(returncode=1,stdout=b'out of memory'))
    result=c._process({'action':'convert','name':'input.dwg','direction':'dwg-dxf','folder':str(tmp_path),'_raw':b'AC10-test','_no_parallel_fallback':True,'_reader':ezdxf.readfile,'_keep_document':True,'_defer_dxf_validation':True})
    assert result['incomplete']['engine']=='primary'
    assert c.FALLBACK_MEMORY_WARNING in result['engineWarnings']
    assert captured[0]['warnings']==['original warning']

def test_posix_os_error_8_is_not_memory_exhaustion(monkeypatch):
    monkeypatch.setattr(c,'os',SimpleNamespace(name='posix'))
    assert not c._fallback_memory_exceeded(SimpleNamespace(returncode=1,stdout=b'Exec format error (os error 8)'))


def test_existing_compaction_recounts_after_a_memory_warning_is_appended():
    report={'warnings':['기존 경고'], 'warningCount':1}
    report['warnings'].append(c.FALLBACK_MEMORY_WARNING)
    result=c.compact_engine_warnings(report)
    assert result['warningCount']==2
    assert len(result['warnings'])==2
