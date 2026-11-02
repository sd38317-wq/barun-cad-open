"""OCCT(3D 모델 → 평면·단면·입면) 부품을 설치본에서 빼고 처음 쓸 때 받아 이 PC 에 둔다.

설치판에는 고지 파일만 있다. 화면 Worker 가 /vendor/occt-pkg/.../dist/replicad_single.{js,wasm} 를 부르면
묶음 안에 파일이 없을 때만 여기서 내려받아(sha256 고정 검사) 캐시에서 준다. 개발 실행은 vendor 파일 그대로.
"""
import hashlib
import os
import tempfile
import threading
import urllib.request
from pathlib import Path

VERSION = '1.1.0'
DIST = '/vendor/occt-pkg/node_modules/replicad-opencascadejs/dist/'
# 이름: (sha256, 바이트). vendor/occt-pkg replicad-opencascadejs@1.1.0 그대로. 바꾸면 릴리스 파일도 새 꼬리표로.
FILES = {
    'replicad_single.js': ('018e57538fcb773f0124eae60aee4de693d3aae01c55b2b883a874911ab121c3', 60124),
    'replicad_single.wasm': ('4c9f22e9f3828dca6f3c95405934cdbe624e593c35266f47f392ab337478dbde', 22980267),
}
# 릴리스 저장소는 비공개 → 홈페이지가 GitHub 임시 주소로 넘겨준다(설치 파일과 같은 길, 로그인 불필요).
BASE_URL = os.environ.get('BARUN_OCCT_URL') or f'https://barunarc.co.kr/downloads/barun-cad-occt/{VERSION}/'
TIMEOUT = 120
_lock = threading.Lock()


def name_of(path):
    """Worker 가 부르는 OCCT 실행 파일 이름, 아니면 None."""
    if not path.startswith(DIST):return None
    name = path[len(DIST):]
    return name if name in FILES else None


def cache_dir():
    # macOS 는 server.py 가 runtime_paths 로 LOCALAPPDATA 를 ~/Library/Application Support 로 맞춘다.
    return Path(os.environ.get('LOCALAPPDATA') or tempfile.gettempdir()) / 'BarunCAD' / 'occt' / VERSION


def _valid(path, name):
    digest, size = FILES[name]
    try:
        if path.stat().st_size != size:return False
        return hashlib.sha256(path.read_bytes()).hexdigest() == digest
    except OSError:return False


def fetch(name, opener=urllib.request.urlopen):
    """캐시 파일 경로. 없거나 깨졌으면 한 번만 내려받는다. 실패하면 ValueError(쉬운 말)."""
    digest, size = FILES[name]
    target = cache_dir() / name
    if _valid(target, name):return target
    with _lock:
        if _valid(target, name):return target
        target.parent.mkdir(parents=True, exist_ok=True)
        part = target.with_name(name + '.part')
        try:
            with opener(urllib.request.Request(BASE_URL + name, headers={'User-Agent': 'BarunCAD-OCCT'}), timeout=TIMEOUT) as response:
                body = response.read(size + 1)
        except OSError as error:
            raise ValueError('3D 도면 부품(OCCT)을 받지 못했습니다. 인터넷 연결을 확인하고 다시 실행하세요.') from error
        if len(body) != size or hashlib.sha256(body).hexdigest() != digest:
            raise ValueError('받은 3D 도면 부품(OCCT)이 손상되었습니다. 잠시 뒤 다시 실행하세요.')
        part.write_bytes(body)
        os.replace(part, target)
        return target
