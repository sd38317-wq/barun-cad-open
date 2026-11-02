"""설치판 화면 묶음에서 바로 그려야 하는 핵심 코드(도면 생성기·상세 규칙·IFC·상세 찾기)를 골라 screen.pack 으로 잠근다.

build_desktop.py 가 esbuild(--splitting --metafile) 결과로 부른다.
- 잠그는 출력: 잠금 입구(screen-vault.js LOCKED_ENTRIES)이거나 잠금 소스(LOCKED_SOURCE)를 담은 조각.
- 평문 조각이 잠근 조각을 import 하면 빌드를 멈춘다(화면이 로그인 전에 그 조각을 못 읽어 깨진다).
- 잠근 조각 안의 상대 경로 import 는 자리표(barun-vault:이름 / barun-plain:이름)로 바꾼다. 화면(screen-vault.js
  instantiate)이 blob URL 또는 이 앱 주소로 채운다. blob 은 상대 경로를 못 풀기 때문이다.
- order 는 잠근 조각끼리 의존하는 순서(먼저 만들 것부터), fingerprints 는 잠근 조각에만 있는 글자들 — 설치판 평문에서
  하나라도 보이면 release_encryption_check 가 실패한다.
"""
import json
import posixpath
import re
from pathlib import Path

LOCKED_ENTRIES = ('drawing-generator.js', 'drawing-details/registry.js', 'ifc-writer.js', 'detail-search-panel.js', 'auto-plan.js', 'planset-command.js')
# 계획안 생성(auto-plan → plan-floor-bridge → plan-layout)·실시도면 한 벌(planset-command)도 로그인 뒤에만 받는다(2026-10-23)
LOCKED_PLAN_SOURCES = ('auto-plan.js', 'plan-floor-bridge.js', 'plan-layout.js', 'planset-command.js')
# kit.js 는 앱 첫 화면 묶음이 쓰는 그리기 도우미(평문으로 둔다). knowledge.js·test-knowledge.js 는 화면 묶음에 안 들어간다.
PLAIN_DETAIL_HELPERS = ('drawing-details/kit.js', 'drawing-details/knowledge.js', 'drawing-details/test-knowledge.js')
SPECIFIER = re.compile(r'''(\bfrom\s*|\bimport\s*\(\s*|\bimport\s*)(["'])(\.{1,2}/[^"'\s]+?\.js)\2''')
# 지문: 한글 문구(esbuild 는 \uXXXX 로 적는다). 소스에 그대로 든 한글로도 찾게 풀어 둔 글자를 남긴다.
LITERAL = re.compile(r'''"((?:[^"\\\n]|\\u[0-9A-Fa-f]{4}){12,160})"''')
ESCAPE = re.compile(r'\\u([0-9A-Fa-f]{4})')


def decode(literal):
    return ESCAPE.sub(lambda m: chr(int(m[1], 16)), literal)


def locked_source(path):
    if path in ('drawing-generator.js', 'ifc-writer.js', 'detail-search-panel.js', *LOCKED_PLAN_SOURCES):
        return True
    return path.startswith('drawing-details/') and path.endswith('.js') and not path.endswith('.test.js') and path not in PLAIN_DETAIL_HELPERS


def split(dist, metafile, root):
    """{'files': {이름: 자리표로 바꾼 코드}, 'order': [...], 'plain': [평문 출력 이름], 'fingerprints': [...]}."""
    dist, root = Path(dist), Path(root)
    meta = json.loads(Path(metafile).read_text(encoding='utf-8'))
    name = lambda output: (root / output).resolve().relative_to(dist.resolve()).as_posix()
    outputs = {name(o): v for o, v in meta['outputs'].items() if o.endswith('.js')}
    locked = {n for n, v in outputs.items()
              if v.get('entryPoint') in LOCKED_ENTRIES or any(locked_source(i) for i in v.get('inputs', {}))}
    missing = [e for e in LOCKED_ENTRIES if e not in locked]
    if missing:
        raise SystemExit('잠금 입구가 묶음에 없습니다: ' + ', '.join(missing))
    # 잠근 조각만 부르는 평문 조각이 잠근 조각을 부르면(예: 생성기만 쓰는 access-plan) 그 조각도 잠근다.
    importers = {n: set() for n in outputs}
    for n, v in outputs.items():
        for item in v.get('imports', []):
            if not item.get('external'):
                importers[name(item['path'])].add(n)
    grew = True
    while grew:
        grew = False
        for n, v in outputs.items():
            if (n not in locked and v.get('entryPoint') != n and importers[n] and importers[n] <= locked
                    and any(not i.get('external') and name(i['path']) in locked for i in v.get('imports', []))):
                locked.add(n)
                grew = True
    deps, leaks = {n: set() for n in locked}, []
    for n, v in outputs.items():
        for item in v.get('imports', []):
            if item.get('external'):
                continue
            target = name(item['path'])
            if target in locked and n not in locked:
                leaks.append(f'{n} → {target}')
            if n in locked and target in locked:
                deps[n].add(target)
    if leaks:
        raise SystemExit('평문 조각이 잠근 조각을 바로 부릅니다(lockedImport 로 바꾸세요): ' + ', '.join(sorted(leaks)))
    order, state = [], {}
    def visit(n, path=()):
        if state.get(n) == 'done':
            return
        if state.get(n) == 'busy':
            raise SystemExit('잠근 조각끼리 서로 부릅니다(순환): ' + ' → '.join((*path, n)))
        state[n] = 'busy'
        for d in sorted(deps[n]):
            visit(d, (*path, n))
        state[n] = 'done'
        order.append(n)
    for n in sorted(locked):
        visit(n)
    files = {}
    for n in order:
        code = (dist / n).read_text(encoding='utf-8')
        expected = {name(i['path']) if not i.get('external') else posixpath.normpath(posixpath.join(posixpath.dirname(n), i['path']))
                    for i in outputs[n].get('imports', [])}
        seen = set()
        def place(match):
            target = posixpath.normpath(posixpath.join(posixpath.dirname(n), match[3]))
            seen.add(target)
            return f'{match[1]}{match[2]}barun-{"vault" if target in locked else "plain"}:{target}{match[2]}'
        files[n] = SPECIFIER.sub(place, code)
        if seen != expected:
            raise SystemExit(f'{n} 의 import 자리를 다 찾지 못했습니다(빠짐 {sorted(expected - seen)}, 더 {sorted(seen - expected)})')
    plain = sorted(set(outputs) - locked)
    plain_text = ''.join((dist / p).read_text(encoding='utf-8') for p in plain)
    fingerprints = sorted({decode(m) for n in order for m in LITERAL.findall(files[n])
                           if m.count('\\u') >= 8 and '\\' not in ESCAPE.sub('', m) and m not in plain_text and decode(m) not in plain_text})[:200]
    if len(fingerprints) < 20:
        raise SystemExit(f'잠근 조각 지문이 너무 적습니다({len(fingerprints)}개) — 평문 검사를 믿을 수 없습니다')
    return {'files': files, 'order': order, 'plain': plain, 'fingerprints': fingerprints}


def drop_shipped(result, paths):
    """설치판에 함께 싣는 다른 평문 파일(README·index.html 등)에도 있는 문구는 지문에서 뺀다(잘못된 실패 방지)."""
    text = ''.join(Path(p).read_bytes().decode('utf-8', 'replace') for p in paths if Path(p).is_file() and Path(p).suffix.lower() in ('.js', '.mjs', '.html', '.css', '.md', '.json', '.txt'))
    result['fingerprints'] = [f for f in result['fingerprints'] if f not in text]
    if len(result['fingerprints']) < 20:
        raise SystemExit(f'잠근 조각 지문이 너무 적습니다({len(result["fingerprints"])}개)')
    return result


def pack_files(result):
    """screen.pack 에 넣을 {이름: 바이트}(manifest.json 포함)."""
    manifest = {'order': result['order'], 'entries': list(LOCKED_ENTRIES), 'fingerprints': result['fingerprints']}
    return {**{n: code.encode('utf-8') for n, code in result['files'].items()},
            'manifest.json': json.dumps(manifest, ensure_ascii=False, sort_keys=True).encode('utf-8')}
