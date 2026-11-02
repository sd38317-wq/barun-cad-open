"""Measure bundled converter startup, without changing it or touching user drawings.

Run from this worktree: python tools/measure_converter_startup.py
All outputs/copies stay under tmp/converter-startup. Fresh copies exercise new-path
loading; copying itself warms file pages, so this is NOT a flushed disk-cache test.
The bundled JSON excludes pre-Main work and report serialization. Without managed
entry markers those cannot be separated exactly: never label their difference JIT.
"""
import argparse
import ctypes
import hashlib
import json
import os
from pathlib import Path
import shutil
import struct
import subprocess
import sys
import threading
import time
import uuid

ROOT = Path(__file__).resolve().parents[1]
FOLDER = ROOT / 'tmp' / 'converter-startup'


def ready_to_run(file):
    data = Path(file).read_bytes()
    pe = struct.unpack_from('<I', data, 60)[0]
    sections, optional_size = struct.unpack_from('<H', data, pe + 6)[0], struct.unpack_from('<H', data, pe + 20)[0]
    optional = pe + 24
    directory = optional + (112 if struct.unpack_from('<H', data, optional)[0] == 0x20b else 96)
    def raw(rva):
        for n in range(sections):
            section = optional + optional_size + n * 40
            virtual_size, virtual_address, raw_size, raw_offset = struct.unpack_from('<IIII', data, section + 8)
            if virtual_address <= rva < virtual_address + max(virtual_size, raw_size): return raw_offset + rva - virtual_address
        return rva
    cli = struct.unpack_from('<I', data, directory + 14 * 8)[0]
    native, size = struct.unpack_from('<II', data, raw(cli) + 64) if cli else (0, 0)
    signature = data[raw(native):raw(native) + 4] if native else b''
    return {'file': Path(file).name, 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest(),
            'managed_native_rva': native, 'managed_native_bytes': size, 'signature': signature.hex(), 'ready_to_run': signature == b'RTR\0'}


def cpu_times(process):
    if os.name != 'nt': return {}
    from ctypes import wintypes
    kernel = ctypes.WinDLL('kernel32', use_last_error=True)
    kernel.GetProcessTimes.argtypes = [wintypes.HANDLE] + [ctypes.POINTER(wintypes.FILETIME)] * 4
    values = [wintypes.FILETIME() for _ in range(4)]
    if not kernel.GetProcessTimes(int(process._handle), *(ctypes.byref(v) for v in values)): return {}
    def ms(v): return ((v.dwHighDateTime << 32) | v.dwLowDateTime) / 10000
    return {'kernel_ms': ms(values[2]), 'user_ms': ms(values[3])}


def watch_modules(process, start, stop, loaded):
    if os.name != 'nt': return
    from ctypes import wintypes
    psapi = ctypes.WinDLL('psapi', use_last_error=True)
    psapi.EnumProcessModulesEx.argtypes = [wintypes.HANDLE, ctypes.POINTER(wintypes.HMODULE), wintypes.DWORD, ctypes.POINTER(wintypes.DWORD), wintypes.DWORD]
    psapi.GetModuleFileNameExW.argtypes = [wintypes.HANDLE, wintypes.HMODULE, wintypes.LPWSTR, wintypes.DWORD]
    wanted = {'coreclr.dll', 'clrjit.dll', 'barunconverter.dll', 'acadsharp.dll', 'system.text.encoding.codepages.dll', 'system.text.json.dll'}
    while not stop.is_set():
        modules = (wintypes.HMODULE * 512)(); needed = wintypes.DWORD()
        if psapi.EnumProcessModulesEx(int(process._handle), modules, ctypes.sizeof(modules), ctypes.byref(needed), 3):
            for module in modules[:min(len(modules), needed.value // ctypes.sizeof(wintypes.HMODULE))]:
                name = ctypes.create_unicode_buffer(32768)
                if psapi.GetModuleFileNameExW(int(process._handle), module, name, len(name)):
                    base = Path(name.value).name.lower()
                    if base in wanted and base not in loaded: loaded[base] = round((time.perf_counter() - start) * 1000, 3)
        stop.wait(.005)


def measure(runtime, source, output, env=None):
    start = time.perf_counter()
    process = subprocess.Popen([str(runtime / 'BarunConverter.exe'), str(source), str(output), '2018'],
        cwd=output.parent, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
        creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0), env={**os.environ, **(env or {})})
    spawn = time.perf_counter(); first = last = None; lines = []; loaded = {}; stop = threading.Event()
    watcher = threading.Thread(target=watch_modules, args=(process, start, stop, loaded), daemon=True); watcher.start()
    # A watchdog also bounds a process that never emits its first line.
    watchdog = threading.Timer(60, process.kill); watchdog.daemon = True; watchdog.start()
    try:
        for line in process.stdout:
            now = time.perf_counter(); first = first or now; last = now; lines.append(line)
        process.wait(timeout=5)
    finally:
        watchdog.cancel(); stop.set(); watcher.join(1)
        if process.poll() is None: process.kill(); process.wait(timeout=5)
    end = time.perf_counter()
    report = json.loads(b''.join(lines).decode('utf8'))
    if process.returncode or report.get('failed') or not output.is_file(): raise RuntimeError(report)
    if report['before'] != 1000 or report['after'] != 1000: raise RuntimeError('entity counts changed')
    total = report['timings_ms']['csharp_total']
    return {'wall_ms': round((end-start)*1000, 3), 'spawn_return_ms': round((spawn-start)*1000, 3),
        'first_output_ms': round((first-start)*1000, 3), 'exit_after_output_ms': round((end-last)*1000, 3),
        'outside_engine_ms': round((end-start)*1000-total, 3), 'cpu_ms': cpu_times(process),
        'module_first_seen_ms': loaded, 'report': report, 'output_bytes': output.stat().st_size}


def main():
    if os.name != 'nt': raise SystemExit('This diagnostic measures the bundled Windows runtime.')
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--save-pairs-only', action='store_true', help='Measure the actual first DWG save conversion in three fresh-path pairs.')
    args = parser.parse_args()
    FOLDER.mkdir(parents=True, exist_ok=True)
    folder = FOLDER / ('run-' + uuid.uuid4().hex[:8]); folder.mkdir()
    os.environ['LOCALAPPDATA'] = str(folder / 'local')
    os.environ['TEMP'] = os.environ['TMP'] = str(folder / 'temp'); (folder / 'temp').mkdir()
    sys.path.insert(0, str(ROOT))
    import batch_converter as bc
    import exchange
    model = {'units': 'mm', 'layers': [{'id': 'A-WALL', 'name': 'A-WALL', 'color': '#ffffff'}], 'blocks': [],
             'entities': [{'id': str(i), 'type': 'line', 'layer': 'A-WALL', 'points': [{'x': i, 'y': 0}, {'x': i, 'y': 10}]} for i in range(1000)]}
    source = folder / '1000-lines.dxf'; source.write_bytes(exchange.export_dxf(model)[0])
    original = ROOT / 'dwg-runtime'
    result = {'sample': {'entities': 1000, 'source_sha256': hashlib.sha256(source.read_bytes()).hexdigest()},
              'r2r': [ready_to_run(original / f) for f in ('BarunConverter.dll', 'ACadSharp.dll', 'System.Private.CoreLib.dll', 'System.Text.Encoding.CodePages.dll', 'System.Text.Json.dll')],
              'runs': [], 'warmups': [], 'batch': [], 'save_pairs': [],
              'limits': ['Fresh copies do not flush system disk caches.', 'Module timestamps are first observations (5ms sampling), not Main entry.',
                         'csharp_total excludes startup and report serialization. No exact pre-Main/JIT split.', 'No antivirus exclusions or system settings are changed.']}
    def save(): (folder / 'results.json').write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf8')
    def series(runtime, label, env=None):
        for n in range(1, 4):
            row = {'label': label, 'run': n, **measure(runtime, source, folder / (label + '.dwg'), env)}
            result['runs'].append(row); save(); print(json.dumps(row), flush=True)
    def preheat(runtime, pair, scenario):
        old_runtime = bc.RUNTIME; old_allowed = bc._warmup_allowed; old_popen = bc.subprocess.Popen; processes = []
        def capture(*args, **kwargs):
            process = old_popen(*args, **kwargs); processes.append(process); return process
        bc.RUNTIME = runtime; bc.subprocess.Popen = capture
        # Benchmark the production worker, forcing only its idle/power eligibility gate.
        bc._warmup_allowed = lambda: True
        started = time.perf_counter()
        try: bc._ConverterWarmup().run(0)
        finally: bc.RUNTIME = old_runtime; bc._warmup_allowed = old_allowed; bc.subprocess.Popen = old_popen
        row = {'pair': pair, 'scenario': scenario, 'wall_ms': round((time.perf_counter()-started)*1000, 3),
               'exit_code': processes[0].returncode if processes else None, 'cpu_ms': cpu_times(processes[0]) if processes else {}}
        result['warmups'].append(row)
        return row
    if not args.save_pairs_only:
        series(original, 'original')
        fresh = folder / 'fresh-runtime'; shutil.copytree(original, fresh); series(fresh, 'fresh-copy')
        series(original, 'r2r-disabled', {'COMPlus_ReadyToRun': '0'})
        # Three interleaved comparisons. Every target runtime path is new and byte-identical.
        for n in range(1, 4):
            for heated in (False, True):
                runtime = folder / ('pair-' + str(n) + ('-warm' if heated else '-cold')); shutil.copytree(original, runtime)
                if heated: preheat(runtime, n, 'direct')
                row = {'label': 'paired-warm' if heated else 'paired-cold', 'run': n, **measure(runtime, source, folder / 'paired.dwg')}
                result['runs'].append(row); save(); print(json.dumps(row), flush=True)
    for n in range(1, 4):
        for heated in (False, True):
            runtime = folder / ('save-pair-' + str(n) + ('-warm' if heated else '-cold')); shutil.copytree(original, runtime)
            warmup = preheat(runtime, n, 'save') if heated else None
            old_runtime = bc.RUNTIME; bc.RUNTIME = runtime; started = time.perf_counter()
            try: raw, info = bc.dxf_to_dwg(source.read_bytes())
            finally: bc.RUNTIME = old_runtime
            if info.get('entities') != 1000: raise RuntimeError('saved entity count changed')
            row = {'pair': n, 'heated': heated, 'wall_ms': round((time.perf_counter()-started)*1000, 3),
                   'output_bytes': len(raw), 'timings_ms': info['timings_ms'], 'warmup': warmup}
            result['save_pairs'].append(row); save(); print(json.dumps(row), flush=True)
    for n in range(1, 4):
        started = time.perf_counter(); raw, info = bc.dxf_to_dwg(source.read_bytes())
        row = {'run': n, 'wall_ms': round((time.perf_counter()-started)*1000, 3), 'bytes': len(raw), 'timings_ms': info['timings_ms']}
        result['batch'].append(row); save(); print(json.dumps(row), flush=True)
    print(str(folder / 'results.json'), flush=True)


if __name__ == '__main__': main()
