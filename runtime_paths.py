"""운영체제별 경로: 사용자 데이터 폴더와 내장 변환기 폴더·실행 파일 이름.

Windows 는 예전과 같다(LOCALAPPDATA, dwg-runtime/BarunConverter.exe).
macOS 는 사용자 데이터를 ~/Library/Application Support 에 두고, 소스에서 실행할 때는
Windows 실행 파일 옆의 <이름>-mac-<arch>/ 폴더(build_mac_runtimes.py 가 만든다)를 쓴다.
설치본은 build_desktop.py 가 그 폴더를 <이름>/ 으로 담으므로 같은 코드로 찾는다.
"""
import os
import platform
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
EXE = '.exe' if os.name == 'nt' else ''


def packaged():
    """설치판으로 도는지: PyInstaller(sys.frozen) 또는 Nuitka 기계어 판(모듈마다 __compiled__)."""
    return bool(getattr(sys, 'frozen', False) or '__compiled__' in globals())


def packaged_executable():
    """설치판 엔진 실행 파일 경로. Nuitka 는 sys.executable 이 가상의 python.exe 라 argv[0] 을 쓴다."""
    if getattr(sys, 'frozen', False): return sys.executable
    return str(Path(sys.argv[0]).resolve())


def mac_arch():
    return 'arm64' if platform.machine() == 'arm64' else 'x64'


def local_data_root():
    """사용자별 프로그램 데이터 폴더(BarunCAD/ 등의 부모)."""
    if os.environ.get('LOCALAPPDATA'): return Path(os.environ['LOCALAPPDATA'])
    if sys.platform == 'darwin': return Path.home() / 'Library' / 'Application Support'
    return Path.home()


def ensure_local_data_env():
    """macOS 에서 LOCALAPPDATA 를 채워, 그 값을 읽는 모든 모듈이 같은 사용자 데이터 폴더를 쓰게 한다."""
    if sys.platform == 'darwin' and not os.environ.get('LOCALAPPDATA'):
        os.environ['LOCALAPPDATA'] = str(local_data_root())


def bundled_runtime(name):
    if sys.platform == 'darwin':
        mac = ROOT / f'{name}-mac-{mac_arch()}'
        if mac.is_dir(): return mac
    return ROOT / name
