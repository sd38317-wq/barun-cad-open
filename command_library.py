"""바른 CAD 명령 라이브러리(건축 명령): AI 가 명령을 찾고 쓰는 법을 읽는다. 읽기 전용."""
import json
from functools import lru_cache

NAME = 'command-library.json'
SUMMARY_KEYS = ('command', 'aliases', 'label', 'category', 'kind', 'runner', 'status', 'recommend')


@lru_cache(maxsize=1)
def bundle():
    """배포본은 서버 열쇠 묶음(pro.pack, 로그인 뒤)에서, 개발 중에는 폴더에서 읽는다. 잠겨 있으면 ValueError(캐시 안 됨)."""
    import vault_gate
    return json.loads(vault_gate.knowledge(NAME).decode('utf-8'))


def _text(entry):
    return ' '.join([entry['command'], *entry.get('aliases', []), entry.get('label', ''), entry.get('manual_label', ''),
                     entry.get('category', ''), *entry.get('when_to_use', [])]).lower()


def search(args):
    """검색어(여러 낱말이면 모두 포함)·분류·종류·실행 방식으로 거른 요약 목록."""
    data = bundle()
    words = str(args.get('query') or '').lower().split()
    category, kind, runner = args.get('category'), args.get('kind'), args.get('runner')
    limit = max(1, min(int(args.get('limit') or 30), 200))
    hits = [e for e in data['commands']
            if all(w in _text(e) for w in words)
            and (not category or e.get('category') == category)
            and (not kind or e.get('kind') == kind)
            and (not runner or e.get('runner') == runner)]
    # 명령·별칭 일치 → 분류·이름 일치 → 설명 속 낱말 순서로 찾는다
    exact = {w.upper() for w in words}
    hits.sort(key=lambda e: (not (exact & {e['command'], *e.get('aliases', [])}),
                             not any(w == e.get('category', '').lower() or w in e.get('label', '').lower() for w in words),
                             not e.get('recommend'), not (e.get('example') and e.get('runner') == 'card')))
    return {'total': len(hits), 'commands': [{k: e.get(k) for k in SUMMARY_KEYS} for e in hits[:limit]],
            'categories': sorted({e.get('category') for e in data['commands']}) if not words and not category else None,
            'rules': data['rules']}


def get(args):
    """이름 또는 별칭이 같은 항목 전부(명령과 리습이 같은 별칭을 쓰면 둘 다)."""
    name = str(args.get('name') or '').strip().upper()
    if not name:
        raise ValueError('name 이 필요합니다.')
    data = bundle()
    found = [e for e in data['commands'] if name == e['command'].upper() or name in (a.upper() for a in e.get('aliases', []))]
    return {'matches': found, 'rules': data['rules']}


@lru_cache(maxsize=1)
def layer_usage():
    """AI도 명령 선택과 생성 레이어에 쓰는 실제 보호 규칙을 읽는다."""
    import vault_gate
    return json.loads(vault_gate.knowledge('layer-usage.json').decode('utf-8'))
