"""우리 엔진 모듈만 Nuitka 로 기계어(.pyd)로 바꾼다. 묶음(PyInstaller)은 그대로 둔다(사장님 10/21).

  python native_build.py            # 목록·컴파일만(시험용)
  build_desktop.py 가 compile_modules() 결과를 --add-binary 로, 같은 이름 .py 는 --exclude-module 로 넘긴다.

- 진입점 barun_entry.py 만 바이트코드로 남는다(server.main() 한 줄).
- 우리 모듈이 쓰는 표준·외부 모듈은 .pyd 안에 숨어 PyInstaller 가 못 보므로, 원본으로 의존 목록을 뽑아 hidden import 로 준다.
- 같은 소스·같은 Nuitka 판·같은 옵션이면 tmp/native/cache 의 .pyd 를 다시 쓴다(두 번째부터 빠르게).
"""
import ast
import concurrent.futures
import hashlib
import os
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent
ENTRY = 'barun_entry.py'
CACHE = ROOT / 'tmp' / 'native' / 'cache'
# 설명글은 실행에 안 쓰고 기능 설명이 그대로 남는다. assert 는 검사로 쓰는 곳이 있어 남긴다.
NUITKA_FLAGS = ('--module', '--nofollow-imports', '--remove-output', '--quiet',
                '--assume-yes-for-downloads', '--python-flag=no_docstrings') + (('--msvc=latest',) if os.name == 'nt' else ())
# 시험·개발 도구는 엔진에 싣지 않는다(엔진이 import 하지도 않는다).
NEVER = ('test_', 'build_', 'benchmark_')


def _imports(path):
    """파일 안의 모든 import(함수 안 늦은 import 포함) → 점 이름 그대로(하위 모듈까지 hidden import 로 줘야 한다).
    from X import Y 는 Y 가 하위 모듈일 수도 있어 X.Y 도 후보로 둔다(없는 이름은 scan 이 거른다)."""
    names = set()
    for node in ast.walk(ast.parse(path.read_text(encoding='utf-8'), str(path))):
        if isinstance(node, ast.Import): names.update(a.name for a in node.names)
        elif isinstance(node, ast.ImportFrom) and node.level == 0 and node.module:
            names.add(node.module); names.update(f'{node.module}.{a.name}' for a in node.names if a.name != '*')
    return names


def _exists(name):
    import importlib.util
    try: return importlib.util.find_spec(name) is not None
    except (ImportError, ValueError, AttributeError): return False


def scan(entry=ENTRY, excludes=()):
    """원본 소스로 엔진이 닿는 모듈을 모은다 → (우리 모듈 이름들, 그 밖의 맨 윗 이름들).
    우리 모듈 = 이 폴더의 .py 가운데 진입점에서 import 로 닿는 것(시험·빌드 도구 제외)."""
    local = {p.stem for p in ROOT.glob('*.py') if not p.stem.startswith(NEVER)}
    ours, others, todo = set(), set(), [Path(entry).stem]
    while todo:
        name = todo.pop()
        for imported in _imports(ROOT / f'{name}.py'):
            top = imported.split('.')[0]
            if top in local:
                if '.' not in imported and imported not in ours and imported != Path(entry).stem: ours.add(imported); todo.append(imported)
            elif top not in excludes:
                others.add(imported)
    # 이 PC 에 없는 이름(개발 시험용 아파트 엔진 모듈, from X import 함수 이름 등)은 뺀다 — 원본 PyInstaller 와 같다.
    return sorted(ours), sorted(n for n in others if _exists(n))


def _key(name):
    import nuitka.Version
    source = (ROOT / f'{name}.py').read_bytes()
    digest = hashlib.sha256(source + nuitka.Version.getNuitkaVersion().encode() + repr(NUITKA_FLAGS).encode() + sys.version.encode())
    return digest.hexdigest()[:20]


def _compile_one(name, out):
    # 캐시 이름: <이름>-<해시><확장 꼬리>(예: bridge-ab12….cp313-win_amd64.pyd). 실을 때는 해시만 뗀다.
    key = _key(name)
    hit = next(CACHE.glob(f'{name}-{key}.*'), None) if CACHE.is_dir() else None
    if hit: return name, hit, 0.0
    work = out / name
    work.mkdir(parents=True, exist_ok=True)
    started = time.time()
    subprocess.run([sys.executable, '-m', 'nuitka', *NUITKA_FLAGS, '--jobs=2', f'--output-dir={work}', str(ROOT / f'{name}.py')],
                   cwd=ROOT, check=True, capture_output=True)
    built = next(p for p in work.glob(f'{name}.*') if p.suffix in ('.pyd', '.so'))
    CACHE.mkdir(parents=True, exist_ok=True)
    target = CACHE / f'{name}-{key}{built.name[len(name):]}'
    built.replace(target)
    return name, target, time.time() - started


def compile_modules(names, workers=None, log=print):
    """모듈마다 .pyd 하나. 결과 {이름: .pyd 경로}. 실패하면 그 모듈 이름과 함께 멈춘다."""
    out = ROOT / 'tmp' / 'native' / 'work'
    workers = workers or max(1, (os.cpu_count() or 4) // 2)
    done, started = {}, time.time()
    with concurrent.futures.ThreadPoolExecutor(workers) as pool:
        jobs = {pool.submit(_compile_one, name, out): name for name in names}
        for job in concurrent.futures.as_completed(jobs):
            try: name, path, seconds = job.result()
            except subprocess.CalledProcessError as error:
                raise SystemExit(f'기계어 컴파일 실패: {jobs[job]}\n{(error.stderr or b"").decode("utf-8", "replace")[-2000:]}') from None
            done[name] = path
            if seconds: log(f'  {name} {seconds:.0f}초')
    log(f'기계어 모듈 {len(done)}개, {(time.time() - started) / 60:.1f}분')
    return done


def pyinstaller_args(compiled, others):
    """PyInstaller 에 줄 인자: 원본 .py 는 빼고 .pyd 를 싣고, .pyd 속 import 는 hidden import 로."""
    args = []
    for name, path in sorted(compiled.items()):
        # 실을 때 이름은 import 가 찾는 <이름>.cp313-win_amd64.pyd 꼴로(캐시 이름의 해시를 뗀다).
        staged = ROOT / 'tmp' / 'native' / 'stage' / (name + path.name[len(name) + 21:])
        staged.parent.mkdir(parents=True, exist_ok=True)
        staged.write_bytes(path.read_bytes())
        args += ['--exclude-module', name, '--add-binary', f'{staged}{os.pathsep}.']
    for name in others: args += ['--hidden-import', name]
    return args



def verify_bundle(exe, compiled):
    """빌드된 엔진 검사: 우리 모듈이 바이트코드(PYZ)로 하나도 없고, .pyd 는 모두 _internal 에 있어야 한다."""
    from PyInstaller.archive.readers import CArchiveReader
    reader = CArchiveReader(str(exe))
    leaked = set()
    for name in reader.toc:
        if name.endswith('.pyz'): leaked |= set(reader.open_embedded_archive(name).toc) & set(compiled)
    internal = Path(exe).parent / '_internal'
    missing = [n for n in compiled if not any(internal.glob(f'{n}.*.pyd')) and not (internal / f'{n}.pyd').is_file() and not any(internal.glob(f'{n}.*.so'))]
    problems = ([f'바이트코드로 남은 우리 모듈: {", ".join(sorted(leaked))}'] if leaked else []) + ([f'빠진 기계어 모듈: {", ".join(missing)}'] if missing else [])
    if problems: raise SystemExit('기계어 엔진 검사 실패 — ' + ' / '.join(problems))
    return len(compiled)

if __name__ == '__main__':
    ours, others = scan(excludes=('matplotlib', 'tkinter', 'fitz', 'pymupdf', 'lxml', 'pyproj'))
    print(f'우리 모듈 {len(ours)}개, 그 밖 맨 윗 이름 {len(others)}개')
    compile_modules(ours)
