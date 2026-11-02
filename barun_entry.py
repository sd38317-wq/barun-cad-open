"""설치판 엔진 진입점(PyInstaller 가 이 파일만 바이트코드로 싣는다). 실제 코드는 기계어로 컴파일된 server 모듈에 있다."""
import builtins, importlib, sys, threading

# 기계어(Nuitka --module) 모듈은 두 스레드가 동시에 처음 불러오면 엔진이 죽는다(2026-10-21 재현: 요청 스레드들이
# 함수 안 import 로 vault_gate·layer_standards_asset 을 같이 불러올 때 연결이 끊기고, 파이썬에서 직접 불러도 세그폴트).
# 잠금을 거쳐 불러오기가 끝난 모듈만 잠그지 않고 통과시킨다(평소 속도 그대로). sys.modules 에 이름만 있는 것은
# 다른 스레드가 아직 초기화 중일 수 있어 믿지 않는다(아스트라 검토 10-21) — 잠금을 지나 표준 import 가 판단하게 한다.
_import_lock = threading.RLock()
_import = builtins.__import__
_import_module = importlib.import_module
_done = set()
_local = threading.local()   # 이 스레드의 잠금 깊이·이번에 불러온 이름(가장 바깥 import 가 끝나야 '끝남'으로 친다 — 순환 import 대비)


def _ready(name, fromlist):
    module = sys.modules.get(name) if name in _done else None
    return module is not None and all(hasattr(module, item) for item in (fromlist or ()) if item != '*')


def _locked(load, name):
    with _import_lock:
        depth = getattr(_local, 'depth', 0)
        if depth == 0:
            _local.names = []
        _local.depth = depth + 1
        try:
            module = load()
            if name:
                _local.names.append(name)
            return module
        finally:
            _local.depth = depth
            if depth == 0:
                _done.update(_local.names)


def _serial_import(name, globals=None, locals=None, fromlist=(), level=0):
    if level == 0 and _ready(name, fromlist):
        return _import(name, globals, locals, fromlist, level)
    return _locked(lambda: _import(name, globals, locals, fromlist, level), name if level == 0 else None)


def _serial_import_module(name, package=None):
    if not name.startswith('.') and _ready(name, ()):
        return sys.modules[name]
    return _locked(lambda: _import_module(name, package), None if name.startswith('.') else name)


builtins.__import__ = _serial_import
importlib.import_module = _serial_import_module

from server import main

main()
