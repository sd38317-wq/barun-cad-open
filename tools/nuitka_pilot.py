"""Nuitka 시범: 엔진(server.py)을 기계어로 컴파일해 소스 복원을 막는다(사장님 10/21 결정).

  python tools/nuitka_pilot.py [--data <PyInstaller _internal 폴더>]

결과: tmp/nuitka/server.dist/barun-cad-6-server.exe (+ 라이브러리).
시범에서는 화면 자산·변환기·암호화 묶음을 새로 만들지 않고, --data 로 준 기존 설치판 _internal 에서
파이썬이 아닌 자료만 복사해 같은 조건으로 돌려 본다. build_desktop.py 연결은 다음 단계.
"""
import argparse
import shutil
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
NAME = 'barun-cad-6-server'
# build_desktop.py 의 PyInstaller 설정과 같은 뜻.
PACKAGES = ('ezdxf', 'reportlab', 'openpyxl', 'shapely', 'pypdf')
HIDDEN = ('cad_asset_client', 'asset_preview', 'layout_context', 'access_context', 'safe_writes',
          'indong_relay', 'occt_remote', 'mcp_register', 'tomllib')
EXCLUDE = ('matplotlib', 'tkinter', '_tkinter', 'fitz', 'pymupdf', 'lxml', 'pyproj', 'pytest', 'IPython')
# 기존 설치판에서 가져올 자료(파이썬 실행 부품은 빼고). 폴더는 통째로.
DATA_DIRS = ('acadrust-runtime', 'dwg-runtime', 'fonts', 'rules', 'examples', 'shared', 'vendor', 'drawing-details', '.artifact-runtime')
DATA_SUFFIXES = {'.js', '.mjs', '.css', '.html', '.png', '.svg', '.json', '.md', '.txt', '.ico', '.webp', '.wasm', '.ttf'}


def compile_engine(out):
    args = [sys.executable, '-m', 'nuitka', '--standalone', '--assume-yes-for-downloads', '--msvc=latest',
            f'--output-dir={out}', f'--output-filename={NAME}.exe', '--remove-output', '--quiet']
    # 설명글(docstring)은 실행에 안 쓰고 기능 설명이 그대로 남으므로 뺀다. assert 는 검사로 쓰는 곳이 있어 남긴다.
    args.append('--python-flag=no_docstrings')
    for p in PACKAGES: args += [f'--include-package={p}', f'--include-package-data={p}']
    for m in HIDDEN: args.append(f'--include-module={m}')
    for m in EXCLUDE: args.append(f'--nofollow-import-to={m}')
    args.append(str(ROOT / 'server.py'))
    started = time.time()
    subprocess.run(args, cwd=ROOT, check=True)
    return time.time() - started


def copy_data(source, dist):
    source = Path(source)
    for name in DATA_DIRS:
        if (source / name).is_dir(): shutil.copytree(source / name, dist / name, dirs_exist_ok=True)
    for path in source.iterdir():
        if path.is_file() and path.suffix.lower() in DATA_SUFFIXES: shutil.copy2(path, dist / path.name)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--data', help='자료를 빌려 올 기존 설치판 backend/_internal 폴더')
    parser.add_argument('--skip-compile', action='store_true')
    args = parser.parse_args()
    out = ROOT / 'tmp' / 'nuitka'
    if not args.skip_compile:
        seconds = compile_engine(out)
        print(f'컴파일 {seconds / 60:.1f}분')
    dist = out / 'server.dist'
    if args.data: copy_data(args.data, dist)
    print(dist / f'{NAME}.exe')


if __name__ == '__main__':
    main()
