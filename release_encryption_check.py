"""빌드 마지막 암호화 검사: 설치본에 보호 자원이 평문으로 남았으면 빌드를 실패시킨다.

검사 대상은 electron-builder 가 만든 앱의 resources 폴더(설치 파일은 이 폴더를 그대로 담는다).
Windows: win-unpacked/resources, macOS: mac-arm64/Barun CAD 6.app/Contents/Resources (Intel 은 mac/...).
- 리습 묶음(기본 열쇠)과 핵심 자산 묶음 pro.pack(서버 열쇠)은 BCV2(AES-256-GCM)로 시작하고,
  풀었을 때 소스 파일과 한 바이트도 다르지 않아야 한다. pro.pack 은 빌드 PC 비밀로만 열린다(기본 열쇠로 열리면 실패).
- 낱개 .lsp 파일, rules/·examples/ 안의 묶음 아닌 파일은 하나도 없어야 한다.
- 레이어 정리 지식·법규 검사 화면 코드가 묶음 밖에 평문으로 남으면 안 된다.
- 바로 그리는 핵심 화면 코드(도면 생성기·상세 규칙·IFC·상세 찾기)는 screen.pack(세션 열쇠)으로만 싣는다.
  잠근 JS 의 이름·지문(잠근 조각에만 있는 문구)이 묶음 밖 어느 파일에도 없어야 한다(잠근 JS 평문 0개).
  법규 엔진 평문 사본(livecheck-engine.js)도 싣지 않는다.
- 상세·동평면·주동 원본은 서버에만 둔다. 평문, gzip, ASAR, ZIP, 암호화 묶음에도 없어야 한다.
"""
import os
import gzip
import io
import zipfile
import re
import sys
import json
import struct
from pathlib import Path

import vault
import vault_gate
from asset_preview import validate_files as validate_preview_files

ROOT = Path(__file__).resolve().parent
def preview_source_files():
    source = ROOT / 'tmp/cad-assets/asset-preview.pack'
    if not source.is_file():
        raise ValueError('미리보기 묶음이 없습니다. tools/asset_pack.py --preview를 먼저 실행하세요.')
    files = vault.unpack(source.read_bytes())
    validate_preview_files(files)
    return files


def screen_source_files():
    """build_desktop.py 가 screen_lock.split 결과를 써 둔 tmp/screen-vault(잠근 조각 + manifest.json)."""
    folder = ROOT / 'tmp' / 'screen-vault'
    if not (folder / 'manifest.json').is_file():
        raise ValueError('잠근 화면 코드가 없습니다. build_desktop.py 의 묶음 단계(screen_lock)를 먼저 실행하세요.')
    return {p.relative_to(folder).as_posix(): p.read_bytes() for p in sorted(folder.rglob('*')) if p.is_file()}


PACKS = {
    'rules/pro.pack': vault_gate.source_files,
    'rules/asset-preview.pack': preview_source_files,
    'rules/layer-standards.pack': lambda: {'layer-standards-data.js': (ROOT / 'layer-standards-data.js').read_bytes()},
    'rules/screen.pack': screen_source_files,
}
# 기본 열쇠(로그인 없이 열림)로 두는 묶음: 기본 편집이 바로 쓰는 레이어 세트뿐. 나머지는 서버 열쇠.
DEFAULT_KEY_PACKS = frozenset({'rules/layer-standards.pack'})
# 잠근 화면 코드의 소스 이름(어느 폴더에서든 이 이름의 파일이 보이면 평문으로 남은 것)
SCREEN_LOCKED_NAMES = frozenset({'drawing-generator.js', 'ifc-writer.js', 'detail-search-panel.js', 'livecheck-engine.js', 'auto-plan.js', 'plan-floor-bridge.js', 'plan-layout.js', 'planset-command.js'})
# 묶은 화면 코드(app.js 조각 등)에 섞여 들어가면 안 되는 핵심 자산 표시(레이어 정리 지식·순위 모델의 자료 이름)
PLAIN_MARKERS = (b'catalogRows', b'priorSource', b'export const LAYER_STANDARDS =')
# 대기화면 예시 기록(다른 대지 엔진 탐색 기록)은 설치판에 싣지 않는다(사장님 2026-10-23). 이름이나 자료 첫머리가 보이면 실패.
WAIT_EXAMPLE_NAMES = frozenset({'apt_example.js', 'site_example.js', 'detail_data.js'})
WAIT_EXAMPLE_MARKERS = tuple(m + sep for m in (b'window.APT_RUN', b'window.ENGINE_RUN', b'window.DETAIL') for sep in (b' = {', b'={'))
# 바른 서버로 옮긴 계산 코드(compute/, 사장님 2026-10-21)에만 있는 문장 — 파일마다 하나 이상. 설치판 어디에도 있으면 안 된다.
def esbuild_escaped(text):
    """esbuild 가 묶음에 적는 꼴: ASCII 밖 글자 중 U+00FF 이하는 \\xHH, 그 위는 \\uHHHH(대문자)."""
    return ''.join(c if ord(c) < 128 else ('\\x%02X' % ord(c) if ord(c) < 256 else '\\u%04X' % ord(c)) for c in text)


# 원문(UTF-8)과 esbuild 묶음 꼴 둘 다 찾는다 — 묶음에서는 한글이 \uXXXX 로 바뀌어 원문 표식만으로는 못 찾는다(아스트라 검토 10-21).
SERVER_COMPUTE_MARKERS = tuple(form for text in (
    '책임구조기술자 검토·서명 전 초안',                      # structure-calc-report.js
    '외벽 끝 두 곳을 직선으로 이어 외곽을 닫음',               # structure-recognize.js
    '곡선이 있어 직선 벽으로 읽지 못했습니다',                 # structure-plan-read.js
    '사선 벽은 아직 그리지 않습니다',                          # plan-to-model.js
    '두 변이 1200mm 이하인 닫힌 사각형 기둥 후보',             # wall-detect.js
    '대지 외곽을 A-SITE 레이어의 닫힌 폴리선으로 알려 주세요',  # opening-planner.js
    '면적과 허용오차를 확인하세요',                            # opening-rules.js
    '경고로 판정 보류',                                         # plan-quality.js
) for form in (text.encode('utf-8'), esbuild_escaped(text).encode('ascii')))
SERVER_ASSET_PARTS = frozenset({
    'data', 'lh-details', 'lh-2025', 'la-details', 'steel-details', 'jutong',
    'kor - 상세 모음', 'cad-assets', '_바른표준', 'standard-detail', 'standard-details',
    'details-v2', 'unit-library', 'unit_library', 'jutong-library', 'jutong_library',
    '단위세대', '동평면', '주동',
})
SERVER_ASSET_KINDS = frozenset({'detail', 'unit', 'jutong'})
# Existing encrypted knowledge files contain rules/assemblies, not original geometry.
MAX_ASSET_BYTES = 128 * 1024 * 1024
ARCHIVE_SUFFIXES = ('.json', '.gz', '.zip', '.pack', '.dxf', '.dwg', '.glb')


def master():
    home = Path.home() / '.barun' / 'vault-master.hex'
    value = os.environ.get('BARUN_VAULT_MASTER') or (home.read_text(encoding='utf8').strip() if home.is_file() else '')
    if not re.fullmatch('[0-9a-f]{64}', value):
        raise ValueError('pro.pack 을 검사할 비밀(vault-master.hex)이 없습니다.')
    return value


def asar_entries(path):
    """Read bounded ASAR metadata and offsets without extracting or executing files."""
    with Path(path).open('rb') as stream:
        prefix = stream.read(16)
        if len(prefix) != 16:
            raise ValueError('ASAR 헤더가 잘렸습니다.')
        size, header_size, payload_size, json_size = struct.unpack('<4I', prefix)
        if size != 4 or not 0 < json_size <= 16 * 1024 * 1024 or header_size != payload_size + 4 or json_size + 4 > payload_size:
            raise ValueError('ASAR 헤더 길이가 올바르지 않습니다.')
        raw = stream.read(json_size)
        if len(raw) != json_size:
            raise ValueError('ASAR 목록이 잘렸습니다.')
        tree = json.loads(raw)
    def entries(node, prefix=''):
        files = node.get('files')
        if not isinstance(files, dict):
            raise ValueError('ASAR 파일 목록이 없습니다.')
        for name, info in files.items():
            if not isinstance(name, str) or not isinstance(info, dict) or '/' in name or '\\' in name or name in ('', '.', '..'):
                raise ValueError('ASAR 파일 항목이 올바르지 않습니다.')
            full = prefix + name
            if 'files' in info:
                yield from entries(info, full + '/')
            else:
                yield full, info, 8 + header_size
    return list(entries(tree))


def server_asset_path(name):
    parts = name.replace('\\', '/').strip('/').lower().split('/')
    return any(part in SERVER_ASSET_PARTS for part in parts)


def server_asset_payload(value):
    """Recognize actual assets/catalogs or imported geometry, never code references."""
    pending = [value]
    while pending:
        item = pending.pop()
        if isinstance(item, dict):
            if item.get('format') == 'barun-asset/1':
                return True
            if isinstance(item.get('kind'), str) and item['kind'] in SERVER_ASSET_KINDS and isinstance(item.get('id'), str) and isinstance(item.get('scenes'), list):
                return True
            entities = item.get('entities')
            if isinstance(entities, list) and any(isinstance(entity, dict) and isinstance(entity.get('type'), str) and entity['type'] in
                    {'line', 'polyline', 'lwpolyline', 'arc', 'circle', 'text', 'dimension', 'insert', 'hatch', 'solid'} for entity in entities):
                return True
            pending.extend(item.values())
        elif isinstance(item, list):
            pending.extend(item)
    return False


def server_asset_file_problems(name, raw=None, depth=0):
    """Inspect originals, gzip JSON and nested ZIP contents; opaque packs fail closed."""
    problems = []
    label = str(name)
    normalized = label.replace('\\', '/').lower()
    if server_asset_path(label):
        problems.append(f'서버 전용 상세·동평면·주동 원본 경로가 남아 있습니다: {label}')
    if raw is None:
        return problems
    if depth > 8:
        return problems + [f'서버 자산 묶음 검사 깊이를 초과했습니다: {label}']
    if normalized.endswith(('.dxf', '.dwg', '.glb')):
        return problems + [f'서버 전용 원본 기하 파일이 남아 있습니다: {label}']
    if normalized == 'rules/asset-preview.pack':
        try:
            if raw[:4] != vault.MAGIC:
                raise ValueError('BCV2 기본 열쇠 묶음이 아닙니다.')
            validate_preview_files(vault.unpack(raw))
        except (ValueError, TypeError, KeyError, UnicodeError) as error:
            problems.append(f'미리보기 묶음에 원본 기하 또는 잘못된 내용이 있습니다: {label}: {error}')
        return problems
    if normalized.endswith(('.pack', '.7z', '.rar', '.tar', '.tgz', '.tar.gz')) or raw[:4] in (vault.MAGIC, vault.LEGACY_MAGIC):
        return problems + [f'검사 허용 목록 밖의 자산 묶음이 남아 있습니다: {label}']
    if normalized.endswith('.zip') or raw[:4] == b'PK\x03\x04':
        try:
            with zipfile.ZipFile(io.BytesIO(raw)) as archive:
                total = 0
                for member in archive.infolist():
                    full = label + ':' + member.filename
                    problems.extend(server_asset_file_problems(member.filename))
                    if member.is_dir() or not member.filename.lower().endswith(ARCHIVE_SUFFIXES):
                        continue
                    total += member.file_size
                    if total > MAX_ASSET_BYTES:
                        raise ValueError('ZIP 검사 자료가 너무 큽니다.')
                    problems.extend(server_asset_file_problems(full, archive.read(member), depth + 1))
        except (ValueError, OSError, RuntimeError, zipfile.BadZipFile) as error:
            problems.append(f'자산 ZIP 검사 실패: {label}: {error}')
        return problems
    if normalized.endswith('.gz') or raw[:2] == b'\x1f\x8b':
        try:
            with gzip.GzipFile(fileobj=io.BytesIO(raw)) as stream:
                raw = stream.read(MAX_ASSET_BYTES + 1)
            if len(raw) > MAX_ASSET_BYTES:
                raise ValueError('gzip 검사 자료가 너무 큽니다.')
        except (ValueError, OSError, EOFError) as error:
            return problems + [f'자산 gzip 검사 실패: {label}: {error}']
    if raw.lstrip()[:1] in (b'{', b'['):
        try:
            value = json.loads(raw)
        except (ValueError, UnicodeError, RecursionError):
            value = None
        if server_asset_payload(value):
            problems.append(f'서버 전용 상세·동평면·주동 원본 내용이 남아 있습니다: {label}')
    return problems


def assert_no_server_assets(files):
    """Build-time source guard, before any original can enter a release bundle."""
    problems = []
    for name, raw in files.items():
        problems.extend(server_asset_file_problems(name, raw))
    if problems:
        raise ValueError('\n'.join(problems))


def protected_asset_path(name):
    parts = name.replace('\\', '/').strip('/').split('/')
    leaf = parts[-1].lower()
    return (leaf.endswith('.lsp') or leaf in {n.lower() for n in (*vault_gate.SCREEN_FILES, 'layer-standards-data.js', 'law-changes.json', 'generation-layer-standards.json')}
            or (leaf.endswith('.json') and any(p.lower() in {'rules', 'knowledge', 'details', 'country'} for p in parts[:-1])))

def check(resources):
    """문제 목록을 돌려준다. 빈 목록이면 통과."""
    resources = Path(resources)
    internal = resources / 'backend' / '_internal'
    problems, opened = [], {}
    if not internal.is_dir():
        return [f'엔진 폴더가 없습니다: {internal}']
    for relative, source in PACKS.items():
        pack = internal / relative
        if not pack.is_file():
            problems.append(f'암호화 묶음이 없습니다: {relative}')
            continue
        blob = pack.read_bytes()
        if blob[:4] != vault.MAGIC:
            problems.append(f'{relative} 가 BCV2 암호화가 아닙니다(앞 4바이트 {blob[:4]!r}).')
            continue
        try:
            key = vault_gate.derive_screen_key(master()) if relative == 'rules/screen.pack' else None if relative in DEFAULT_KEY_PACKS else vault_gate.derive_key(master())
            if key is not None:
                wrong = [(None, '기본 열쇠')] + ([(vault_gate.derive_key(master()), 'pro.pack 열쇠')] if relative == 'rules/screen.pack' else [])
                for other, label in wrong:
                    try:
                        vault.unpack(blob, other)
                        problems.append(f'{Path(relative).name} 이 {label}로 열립니다(서버 열쇠로 잠가야 함).')
                    except ValueError:
                        pass
            packed = vault.unpack(blob, key)
            opened[relative] = packed
        except ValueError as error:
            problems.append(f'{relative} 를 풀 수 없습니다: {error}')
            continue
        if relative == 'rules/asset-preview.pack':
            try:
                validate_preview_files(packed)
            except (ValueError, TypeError, KeyError, UnicodeError) as error:
                problems.append(f'미리보기 묶음에 원본 기하 또는 잘못된 내용이 있습니다: {error}')
        else:
            for name, raw in packed.items():
                problems.extend(server_asset_file_problems(name, raw))
        try:
            expected = source()
        except (ValueError, OSError) as error:
            problems.append(f'{relative} 소스를 검사할 수 없습니다: {error}')
            continue
        if packed != expected:
            missing = sorted(set(expected) - set(packed))
            changed = sorted(n for n in set(expected) & set(packed) if expected[n] != packed[n])
            problems.append(f'{relative} 내용이 소스와 다릅니다(빠짐 {missing[:5]}, 다름 {changed[:5]}).')
    for path in resources.rglob('*.lsp'):
        problems.append(f'평문 리습이 남아 있습니다: {path.relative_to(resources)}')
    for folder in ('rules', 'examples'):
        for path in (internal / folder).rglob('*'):
            if path.is_file() and path.suffix != '.pack':
                problems.append(f'암호화되지 않은 파일: {path.relative_to(resources)}')
    for path in resources.rglob('details/*.json'):
        problems.append(f'상세 기준 JSON이 평문으로 남아 있습니다: {path.relative_to(resources)}')
    forbidden = SERVER_ASSET_PARTS
    protected_names = {'law-changes.json', 'generation-layer-standards.json'}
    for path in resources.rglob('*'):
        relative = path.relative_to(resources)
        if any(part.lower() in forbidden for part in relative.parts):
            problems.append(f'설치판에 외부 자료가 남아 있습니다: {relative}')
        if path.is_file() and path.suffix == '.asar':
            try:
                with path.open('rb') as archive:
                    for name, info, payload_start in asar_entries(path):
                        if protected_asset_path(name) or server_asset_path(name):
                            problems.append(f'ASAR에 보호 자원 또는 외부 자료가 남아 있습니다: {relative}:{name}')
                        if info.get('unpacked') or not name.lower().endswith(ARCHIVE_SUFFIXES):
                            continue
                        size, offset = info.get('size'), info.get('offset')
                        if type(size) is not int or not 0 <= size <= MAX_ASSET_BYTES or not isinstance(offset, str) or not offset.isdigit():
                            raise ValueError('ASAR 자산 크기/위치가 올바르지 않습니다.')
                        archive.seek(payload_start + int(offset))
                        raw = archive.read(size)
                        if len(raw) != size:
                            raise ValueError('ASAR 자산 내용이 잘렸습니다.')
                        problems.extend(server_asset_file_problems(f'{relative}:{name}', raw))
            except (ValueError, OSError, UnicodeError) as error:
                problems.append(f'ASAR 목록 검사 실패: {relative}: {error}')
        if path.is_file() and path.suffix.lower() != '.asar' and (path.suffix.lower() in ARCHIVE_SUFFIXES or path.name.lower().endswith(('.7z', '.rar', '.tar', '.tgz'))):
            if relative.as_posix() not in {'backend/_internal/' + name for name in PACKS}:
                problems.extend(server_asset_file_problems(str(relative), path.read_bytes()))
        if path.is_file() and path.name in protected_names:
            problems.append(f'보호 지식 JSON이 평문으로 남아 있습니다: {relative}')
    worker = (ROOT / 'livecheck-worker.js').read_bytes()
    for path in resources.rglob('*'):
        if not path.is_file() or path.suffix == '.pack':
            continue
        if path.name in (*vault_gate.SCREEN_FILES, 'layer-standards-data.js'):
            problems.append(f'핵심 자산 화면 코드가 평문으로 남아 있습니다: {path.relative_to(resources)}')
        elif path.suffix in ('.js', '.mjs', '.json', '.html', '.asar'):
            raw = path.read_bytes()
            if raw == worker or any(marker in raw for marker in PLAIN_MARKERS):
                problems.append(f'레이어 정리 지식·법규 검사가 섞여 들어갔습니다: {path.relative_to(resources)}')
            if any(marker in raw for marker in SERVER_COMPUTE_MARKERS):
                problems.append(f'서버로 옮긴 계산 코드(compute/)가 설치판에 들어갔습니다: {path.relative_to(resources)}')
            if path.name in WAIT_EXAMPLE_NAMES or any(marker in raw for marker in WAIT_EXAMPLE_MARKERS):
                problems.append(f'대기화면 예시 기록(보호 자원)이 설치판에 들어갔습니다: {path.relative_to(resources)}')
    problems.extend(screen_plain_problems(resources, opened.get('rules/screen.pack')))
    return problems


def _escaped(text):
    """esbuild 가 적는 꼴(한글 → 역슬래시 uXXXX, 대문자)."""
    return ''.join(c if ord(c) < 128 else '\\u%04X' % ord(c) for c in text)


def screen_plain_problems(resources, packed):
    """잠근 JS 평문 0개: 잠근 조각의 이름·지문이 묶음 밖 어느 파일(.js·.mjs·.html·.json·.asar·.txt·.md)에도 없어야 한다."""
    if packed is None:
        return []
    if 'manifest.json' not in packed:
        return ['screen.pack 에 순서·지문(manifest.json)이 없어 잠근 JS 평문 검사를 할 수 없습니다.']
    manifest = json.loads(packed['manifest.json'])
    names = {n.lower() for n in SCREEN_LOCKED_NAMES} | {Path(n).name.lower() for n in manifest['order'] if not n.startswith('chunk-')}
    chunks = {n for n in manifest['order'] if n.startswith('chunk-')}
    marks = [m for text in manifest['fingerprints'] for m in (text.encode('utf-8'), _escaped(text).encode('ascii'))]
    bodies = {raw for name, raw in packed.items() if name != 'manifest.json'}
    problems = []
    for path in resources.rglob('*'):
        if not path.is_file() or path.suffix == '.pack':
            continue
        relative = path.relative_to(resources)
        if path.name.lower() in names or path.name in chunks or (path.parent.name == 'drawing-details' and path.suffix == '.js'):
            problems.append(f'잠근 화면 코드가 평문으로 남아 있습니다: {relative}')
            continue
        if path.suffix.lower() in ('.js', '.mjs', '.cjs', '.html', '.json', '.asar', '.txt', '.md', '.map'):
            raw = path.read_bytes()
            hit = next((m for m in marks if m in raw), None)
            if hit is not None or raw in bodies:
                problems.append(f'잠근 화면 코드가 섞여 들어갔습니다: {relative} ({(hit or b"").decode("utf-8", "replace")[:40]})')
    return problems


def main(argv=sys.argv[1:]):
    if len(argv) != 1:
        print('사용법: python release_encryption_check.py <win-unpacked\\resources | Barun CAD 6.app/Contents/Resources>')
        return 2
    problems = check(argv[0])
    for problem in problems:
        print('암호화 검사 실패:', problem)
    if not problems:
        print('암호화 검사 통과:', ', '.join(PACKS), '· 잠근 JS 평문 0개')
    return 1 if problems else 0


if __name__ == '__main__':
    sys.exit(main())
