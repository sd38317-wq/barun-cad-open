"""Local Windows-only startup helper microbenchmark; no drawing input or packaging."""
import json, statistics, subprocess, sys, time
from types import SimpleNamespace
import batch_converter as converter

def _snapshot_resume(process):
    """메모리 보호에 넣은 뒤 Windows의 중단된 첫 스레드를 재개한다."""
    import ctypes
    from ctypes import wintypes
    kernel = ctypes.WinDLL('kernel32', use_last_error=True)
    class ThreadEntry(ctypes.Structure):
        _fields_ = [('dwSize', wintypes.DWORD), ('cntUsage', wintypes.DWORD),
                    ('th32ThreadID', wintypes.DWORD), ('th32OwnerProcessID', wintypes.DWORD),
                    ('tpBasePri', wintypes.LONG), ('tpDeltaPri', wintypes.LONG), ('dwFlags', wintypes.DWORD)]
    kernel.CreateToolhelp32Snapshot.argtypes = [wintypes.DWORD, wintypes.DWORD]
    kernel.CreateToolhelp32Snapshot.restype = wintypes.HANDLE
    kernel.Thread32First.argtypes = kernel.Thread32Next.argtypes = [wintypes.HANDLE, ctypes.POINTER(ThreadEntry)]
    kernel.OpenThread.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
    kernel.OpenThread.restype = wintypes.HANDLE
    kernel.ResumeThread.argtypes = [wintypes.HANDLE]
    kernel.ResumeThread.restype = wintypes.DWORD
    kernel.CloseHandle.argtypes = [wintypes.HANDLE]
    snapshot = kernel.CreateToolhelp32Snapshot(0x4, 0)  # TH32CS_SNAPTHREAD
    if snapshot == ctypes.c_void_p(-1).value: raise ctypes.WinError(ctypes.get_last_error())
    try:
        entry = ThreadEntry(); entry.dwSize = ctypes.sizeof(entry)
        found = kernel.Thread32First(snapshot, ctypes.byref(entry))
        while found:
            if entry.th32OwnerProcessID == process.pid:
                thread = kernel.OpenThread(0x2, False, entry.th32ThreadID)  # THREAD_SUSPEND_RESUME
                if not thread: raise ctypes.WinError(ctypes.get_last_error())
                try:
                    if kernel.ResumeThread(thread) == 0xFFFFFFFF: raise ctypes.WinError(ctypes.get_last_error())
                finally: kernel.CloseHandle(thread)
                return
            found = kernel.Thread32Next(snapshot, ctypes.byref(entry))
        raise OSError('보조 엔진을 시작할 스레드를 찾지 못했습니다.')
    finally: kernel.CloseHandle(snapshot)



def benchmark(samples=20):
    results={}
    for name,resume in [('snapshot',_snapshot_resume),('process_handle',converter._resume_fallback)]:
        timings=[]
        for _ in range(samples):
            process=subprocess.Popen([sys.executable,'-c','pass'],creationflags=0x4|subprocess.CREATE_NO_WINDOW)
            try:
                started=time.perf_counter_ns();resume(process)
                timings.append((time.perf_counter_ns()-started)/1e6)
                process.wait(timeout=10)
            finally:
                if process.poll() is None:process.kill();process.wait()
        results[name]={'samples_ms':timings,'median_ms':statistics.median(timings),'max_ms':max(timings)}
    return results

if __name__=='__main__':
    if sys.platform!='win32':raise SystemExit('Windows only')
    print(json.dumps(benchmark(),indent=2))
