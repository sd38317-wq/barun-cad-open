"""엔진 묶음 비교(설치 파일은 만들지 않음): 예전 바이트코드 묶음 vs 우리 모듈만 기계어(.pyd) 묶음.

  python tools/native_compare.py --data "<설치판 backend/_internal>"

두 판 모두 build_desktop.py 와 같은 PyInstaller 패키지·제외·숨은 import 로 엔진만 묶고, 화면 자료·변환기·암호화 묶음은
--data 의 기존 설치판에서 복사해 같은 조건으로 standalone_smoke.py 를 돌린다. 결과는 tmp/native-compare.json.
"""
import argparse
import json
import shutil
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import native_build  # noqa: E402

NAME = 'barun-cad-6-server'
HIDDEN = ['cad_asset_client', 'asset_preview', 'layout_context', 'access_context', 'safe_writes', 'indong_relay', 'occt_remote', 'mcp_register', 'tomllib']
EXCLUDE = ['matplotlib', 'tkinter', '_tkinter', 'fitz', 'pymupdf', 'lxml', 'pyproj']
COLLECT = ['ezdxf', 'reportlab', 'openpyxl', 'shapely', 'pypdf']
DATA_DIRS = ('acadrust-runtime', 'dwg-runtime', 'fonts', 'rules', 'examples', 'shared', 'vendor', 'drawing-details', '.artifact-runtime')
DATA_SUFFIXES = {'.js', '.mjs', '.css', '.html', '.png', '.svg', '.json', '.md', '.txt', '.ico', '.webp', '.wasm', '.ttf'}


def size_mb(folder):
    return round(sum(p.stat().st_size for p in Path(folder).rglob('*') if p.is_file()) / 2**20, 1)


def bundle(kind, data):
    dist, work = ROOT / 'tmp' / f'compare-{kind}', ROOT / 'tmp' / f'compare-{kind}-work'
    shutil.rmtree(dist, ignore_errors=True)
    args = [sys.executable, '-m', 'PyInstaller', '--noconfirm', '--clean', '--onedir', '--name', NAME, '--distpath', str(dist), '--workpath', str(work)]
    for m in EXCLUDE: args += ['--exclude-module', m]
    hidden, entry, compiled, native_seconds = list(HIDDEN), 'server.py', {}, 0.0
    if kind == 'native':
        started = time.time()
        ours, others = native_build.scan(excludes=EXCLUDE)
        compiled = native_build.compile_modules(ours)
        native_seconds = time.time() - started
        args += native_build.pyinstaller_args(compiled, others)
        hidden = [h for h in hidden if h not in compiled]
        entry = native_build.ENTRY
    for h in hidden: args += ['--hidden-import', h]
    for c in COLLECT: args += ['--collect-all', c]
    started = time.time()
    subprocess.run([*args, entry], cwd=ROOT, check=True, capture_output=True)
    pack_seconds = time.time() - started
    folder = dist / NAME
    code_mb = size_mb(folder)
    exe = folder / f'{NAME}.exe'
    if compiled: native_build.verify_bundle(exe, compiled)
    internal = folder / '_internal'
    for name in DATA_DIRS:
        if (Path(data) / name).is_dir(): shutil.copytree(Path(data) / name, internal / name, dirs_exist_ok=True)
    for path in Path(data).iterdir():
        if path.is_file() and path.suffix.lower() in DATA_SUFFIXES: shutil.copy2(path, internal / path.name)
    smoke = ROOT / 'tmp' / f'compare-{kind}-smoke.json'
    started = time.time()
    run = subprocess.run([sys.executable, str(ROOT / 'standalone_smoke.py'), str(exe), '--output', str(smoke)], cwd=ROOT, capture_output=True, text=True, encoding='utf-8', errors='replace')
    smoke_seconds = time.time() - started
    result = json.loads(smoke.read_text(encoding='utf-8')) if smoke.is_file() else {'error': run.stdout[-1500:] + run.stderr[-1500:]}
    return {'kind': kind, 'native_compile_min': round(native_seconds / 60, 1), 'pyinstaller_min': round(pack_seconds / 60, 1),
            'engine_code_mb': code_mb, 'with_data_mb': size_mb(folder), 'compiled_modules': len(compiled),
            'smoke_passed': result.get('passed'), 'smoke_error': result.get('error'), 'smoke_seconds': round(smoke_seconds, 1)}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--data', required=True)
    parser.add_argument('--only', choices=('bytecode', 'native'))
    args = parser.parse_args()
    results = [bundle(kind, args.data) for kind in (('bytecode', 'native') if not args.only else (args.only,))]
    out = ROOT / 'tmp' / 'native-compare.json'
    out.write_text(json.dumps(results, ensure_ascii=False, indent=1), encoding='utf-8')
    print(json.dumps(results, ensure_ascii=False, indent=1))


if __name__ == '__main__':
    main()
