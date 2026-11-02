"""Versioned evidence rules. Dataset observations never confer design approval."""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent / 'rules' / 'knowledge'


def bundle():
    """배포본은 서버 열쇠 묶음(pro.pack, 로그인 뒤)에서, 개발 중에는 폴더에서 읽는다."""
    import vault_gate
    return json.loads(vault_gate.knowledge('drawing-knowledge.json').decode('utf-8'))


def evaluate(facts):
    """Evaluate explicit evidence flags; missing/invalid evidence is never a pass."""
    if not isinstance(facts, dict):
        raise ValueError('facts must be an object')
    rules = bundle()['gates']
    allowed = {r['fact'] for r in rules}
    if set(facts) - allowed:
        raise ValueError('Unknown facts: ' + ', '.join(sorted(set(facts) - allowed)))
    if any(v is not None and type(v) is not bool for v in facts.values()):
        raise ValueError('Evidence flags must be true, false or null')
    results = []
    for rule in rules:
        value = facts.get(rule['fact'])
        results.append({'ruleId': rule['id'], 'status': 'pass' if value is True else 'fail' if value is False else 'unknown',
                        'meaning': rule['meaning'], 'blockedClaims': [] if value is True else rule['blocks'],
                        'requiredEvidence': rule['evidence'], 'source': rule['source']})
    return {'schemaVersion': 1, 'kind': 'evidence_readiness', 'results': results,
            'status': 'fail' if any(r['status'] == 'fail' for r in results) else 'unknown' if any(r['status'] == 'unknown' for r in results) else 'pass',
            'designApproval': False, 'note': '증거 준비 상태입니다. 설계 적합·법규 적합 판정이 아닙니다.'}


def context():
    data = bundle()
    return {'schemaVersion': data['schemaVersion'], 'coverage': data['coverage'],
            'gates': data['gates'], 'interpretation': data['interpretation'],
            'observationRuleCount': len(data['observations']), 'defaultVerdict': 'unknown'}


def observed_rules(classes=None):
    """Retrieve machine-readable observations without turning frequency into a threshold."""
    if classes is not None and (not isinstance(classes, list) or any(not isinstance(c, str) for c in classes)):
        raise ValueError('classes must be a list of class names')
    data = bundle()
    return {'schemaVersion': 1, 'sources': data['sources'], 'coverage': data['coverage'],
            'interpretation': data['interpretation'], 'gates': data['gates'],
            'observations': [r for r in data['observations'] if not classes or set(classes).issubset(r['classes'])]}


def case_readiness(detail):
    scale = detail.get('scaleMmPerPixel')
    import math
    return evaluate({'scaleVerified': True if type(scale) in (int, float) and math.isfinite(scale) and scale > 0 else None,
                     'sourcePreserved': detail.get('sourceUnchanged'),
                     'annotationQualityVerified': False if detail.get('issues', 0) > 0 else None})
