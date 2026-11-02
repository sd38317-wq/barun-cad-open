"""Compile all existing catalog summary observations without changing sources."""
import hashlib
import json
from pathlib import Path

BASE = Path(__file__).resolve().parent
SOURCE = BASE / 'data/aihub-71465/full-catalog'
OUT = BASE / 'rules/knowledge'


def build():
    OUT.mkdir(parents=True, exist_ok=True)
    summary = json.loads((SOURCE / 'summary.json').read_text(encoding='utf-8'))
    spatial = json.loads((SOURCE / 'spatial-patterns.json').read_text(encoding='utf-8'))
    gates = []
    definitions = [
        ('scale', 'scaleVerified', '실측 축척 확인', ['physical_length', 'physical_area'], '실측 치수와 mm/픽셀 또는 검증된 CAD 단위'),
        ('dwelling', 'dwellingBoundaryVerified', '세대 경계 확인', ['per_dwelling_count'], '세대 경계 폴리곤과 해당 실의 소속'),
        ('connectivity', 'doorConnectivityVerified', '문을 통한 통행 확인', ['traversable_connection'], '두 공간을 연결하는 실제 문과 통로'),
        ('regulations', 'siteLegalRulesVerified', '대지별 법규 근거 확인', ['legal_compliance'], '대지·용도·적용일·관할과 검증된 법규'),
        ('structure', 'structuralReviewVerified', '구조 검토 근거 확인', ['structural_approval'], '구조 계산과 검토 결과'),
        ('source', 'sourcePreserved', '원본 보존 확인', ['source_unchanged'], '원본 해시 또는 원본을 수정하지 않는 조회 경로'),
        ('quality', 'annotationQualityVerified', '주석 품질 확인', ['geometry_reliable'], '유효 폴리곤·이미지 일치·누락 검토 결과'),
    ]
    for name, fact, meaning, blocks, evidence in definitions:
        gates.append(dict(id='evidence.' + name, fact=fact, meaning=meaning, blocks=blocks, evidence=evidence,
                          source='data/aihub-71465/design-cases/rules.json' if name in ('scale','dwelling','connectivity','regulations') else 'data/aihub-71465/full-catalog/summary.json'))
    observations = []
    for name, count in summary['classCounts'].items():
        observations.append(dict(id='class.' + name, kind='class_frequency', classes=[name], count=count,
                                 unit='annotation', mandatory=False, source='summary.json#/classCounts/' + name))
    for i, item in enumerate(spatial['patterns']):
        observations.append(dict(id=f'proximity.{i:03}', kind='proximity', classes=item['classes'], count=item['observations'],
                                 unit='edge', mandatory=False, source='spatial-patterns.json#/patterns/' + str(i),
                                 sourceExamples=list(dict.fromkeys(item['sourceExamples'])), thresholdPx=8, traversable=None))
    data = dict(schemaVersion=1, generatedFrom='local catalog snapshot',
                coverage={**summary['counts'], 'spatialSheets': spatial['spatialSheets'],
                          'excludedInvalidObjects': spatial['excludedInvalidObjects'],
                          'missingVsPublicDescription': summary['missingVsPublicDescription']},
                interpretation=['관찰 빈도는 필수 설계 규칙이 아니다.', '근접은 문 연결이 아니다.',
                                '시트 개수는 세대별 개수가 아니다.', '불명확한 증거는 unknown이며 합격이 아니다.',
                                '학습 가중치 변경이나 정확도 개선 실측은 수행하지 않았다.'],
                sources=[{'path': str(p.relative_to(BASE)).replace('\\','/'), 'sha256': hashlib.sha256(p.read_bytes()).hexdigest()}
                         for p in [SOURCE/'summary.json', SOURCE/'spatial-patterns.json', SOURCE/'rules.json', SOURCE.parent/'design-cases/rules.json']],
                gates=gates, observations=observations)
    (OUT/'drawing-knowledge.json').write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding='utf-8')
    facts = {'type': 'object', 'additionalProperties': False,
             'properties': {g['fact']: {'type': ['boolean', 'null'], 'description': g['evidence']} for g in gates}}
    schema = {'$schema': 'http://json-schema.org/draft-07/schema#', 'title': 'Drawing evidence facts', **facts}
    (OUT/'facts.schema.json').write_text(json.dumps(schema, ensure_ascii=False, indent=2), encoding='utf-8')
    rule_schema = {'$schema': 'http://json-schema.org/draft-07/schema#', 'type': 'object',
        'required': ['schemaVersion', 'coverage', 'sources', 'gates', 'observations', 'interpretation'],
        'properties': {
            'schemaVersion': {'const': 1}, 'coverage': {'type': 'object'},
            'sources': {'type': 'array', 'minItems': 1, 'items': {'type': 'object', 'required': ['path', 'sha256']}},
            'interpretation': {'type': 'array', 'items': {'type': 'string'}},
            'gates': {'type': 'array', 'items': {'type': 'object', 'additionalProperties': False,
                'required': ['id', 'fact', 'meaning', 'blocks', 'evidence', 'source'],
                'properties': {**{k: {'type': 'string', 'minLength': 1} for k in ['id','fact','meaning','evidence','source']},
                               'blocks': {'type': 'array', 'minItems': 1, 'items': {'type': 'string'}}}}},
            'observations': {'type': 'array', 'items': {'type': 'object', 'additionalProperties': False,
                'required': ['id', 'kind', 'classes', 'count', 'unit', 'mandatory', 'source'],
                'properties': {'id': {'type': 'string'}, 'kind': {'enum': ['class_frequency','proximity']},
                    'classes': {'type': 'array', 'minItems': 1, 'items': {'type': 'string'}},
                    'count': {'type': 'integer', 'minimum': 0}, 'unit': {'enum': ['annotation','edge']},
                    'mandatory': {'const': False}, 'source': {'type': 'string'},
                    'sourceExamples': {'type': 'array', 'items': {'type': 'string'}},
                    'thresholdPx': {'const': 8}, 'traversable': {'type': 'null'}}}}}}
    (OUT/'knowledge.schema.json').write_text(json.dumps(rule_schema, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps({'gates': len(gates), 'observationRules': len(observations), 'coverage': data['coverage']}, ensure_ascii=False))


if __name__ == '__main__':
    build()
