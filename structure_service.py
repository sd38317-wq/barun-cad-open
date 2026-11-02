"""소규모 자동 구조(RC·철골·목조) — 계산은 바른 서버에서만 한다(엔진·KDS 42 규칙표는 설치본에 없음, 사용자 2026-10-16).

[계정 연결] 토큰으로 POST /api/public/cad-structure 를 부른다(cad_asset_client 와 같은 길·같은 안전장치).
이 파일은 캐드 입력(mm)을 엔진 입력(m)으로 바꾸고, 서버 응답을 구조 묶음 기록으로 만들고,
부재 크기 덮어쓰기(set_member)를 모델에 적용한 뒤 서버에 다시 검토를 맡긴다.
"""
import copy
import json
import math
import os
import re
import threading
import time
import uuid
import structure_inputs as si
import urllib.error
import urllib.request
from collections import OrderedDict
from http.client import HTTPException

DEFAULT_URL = 'https://barunarc.co.kr/api/public/cad-structure'
MAX_RESPONSE_BYTES = 64 * 1024 * 1024   # 4층 개략 검토 답이 17.8 MB(부재·기초 하중 표, 괴정 2026-10-30) — 16 MB 로는 '연결 못 함'이 됐다
SYSTEMS = ('rc', 'steel', 'wood')
LEGAL_CONFIRM_KEYS = ('excluded32_2_3to8Confirmed', 'smallBuildingConfirmed')
# 서버가 받는 층 칸(2026-10-19 실서버 확인). 평면 읽기만 쓰는 기록 칸은 보내지 않는다.
FLOOR_KEYS = frozenset(('name', 'H', 'outline', 'walls', 'columns', 'beams', 'footings', 'pilotis', 'sourceIds'))
FLOOR_READ_KEYS = frozenset(('alignment', 'heightConflict'))
KINDS = ('beam', 'column', 'slab', 'wall', 'stairWall', 'brace', 'purlin', 'footing', 'strip', 'mat', 'flight', 'landing',
         'woodWall', 'joists', 'ceilJoists', 'rafters', 'ridgeBoard', 'stripW', 'groundSlab', 'woodStair', 'hardware')


class StructureServiceError(ValueError):
    MESSAGES = {
        'not_logged_in': '로그인 필요 · [계정 연결]로 로그인한 뒤 구조 계산을 쓸 수 있습니다(무료).',
        'blocked': '이 계정은 구조 계산을 쓸 수 없습니다. 바른 고객센터에 문의하세요.',
        'limit': '오늘 구조 계산 횟수를 다 썼습니다. 내일 다시 시도하세요.',
        'offline': '구조 계산 서버에 연결하지 못했습니다. 인터넷 연결을 확인하세요.',
        'server': '구조 계산 서버가 오류를 돌려줬습니다. 잠시 뒤 다시 시도하고, 계속되면 바른 고객센터에 알려 주세요.',
        'bad_input': '구조 계산 입력이 올바르지 않습니다.',
        'cannot_compute': '고친 부재로는 다시 계산할 수 없습니다. 크기 형식을 확인하세요.',
    }

    def __init__(self, code, detail=None):
        self.code = code
        message = self.MESSAGES[code] + (f' ({detail})' if detail else '')
        super().__init__(message)

def _account_token():
    from miri_account_service import _load_token
    return _load_token()

def _url():
    value = os.environ.get('BARUN_CAD_STRUCTURE_URL', DEFAULT_URL).rstrip('/')
    return value if value.endswith('/cad-structure') else value + '/api/public/cad-structure'


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    # 다른 곳으로 넘기면 계정 토큰이 따라가지 않게 멈춘다.
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


_opener = urllib.request.build_opener(_NoRedirect)

def post(payload, token_reader=None, timeout=30):
    token = (token_reader or _account_token)()
    if not token:
        raise StructureServiceError('not_logged_in')
    request = urllib.request.Request(_url(), data=json.dumps(payload).encode('utf-8'), method='POST',
                                     headers={'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json'})
    try:
        with _opener.open(request, timeout=timeout) as response:
            raw = response.read(MAX_RESPONSE_BYTES + 1)
    except urllib.error.HTTPError as error:
        try:
            body = json.loads(error.read(65536) or b'{}')
        except ValueError:
            body = {}
        code = {401: 'not_logged_in', 403: 'blocked', 429: 'limit', 400: 'bad_input', 422: 'cannot_compute', 502: 'offline', 503: 'offline', 504: 'offline'}.get(error.code, 'server')
        raise StructureServiceError(code, _field_detail(payload, body.get('field')) if code == 'bad_input' else f'HTTP {error.code}' if code == 'server' else None) from None
    except (OSError, urllib.error.URLError, HTTPException):
        raise StructureServiceError('offline') from None
    # 연결은 됐는데 답이 크거나 모양이 다르면 '연결 못 함'이 아니라 서버 답 문제로 알린다
    if len(raw) > MAX_RESPONSE_BYTES:
        raise StructureServiceError('server', f'답이 {len(raw) // 1048576} MB 넘게 큼')
    try:
        value = json.loads(raw)
    except ValueError:
        raise StructureServiceError('server', '답을 읽지 못함') from None
    if not isinstance(value, dict) or value.get('state') != 'ok' or not isinstance(value.get('model'), dict) or not isinstance(value.get('review'), list):
        raise StructureServiceError('server', '답 모양이 다름')
    return value

def _field_detail(payload, field):
    """서버는 floors[0].walls[0] 처럼 자리만 알려 준다. 그 자리에 보낸 칸 이름·값 종류를 덧붙여 무엇을 고칠지 보이게 한다."""
    if not isinstance(field, str) or not field:
        return None
    value = payload.get('input') if isinstance(payload, dict) else None
    for name, index in re.findall(r'([A-Za-z_]\w*)(?:\[(\d+)\])?', field):
        value = value.get(name) if isinstance(value, dict) else None
        if index and isinstance(value, list):
            value = value[int(index)] if int(index) < len(value) else None
        elif index:
            value = None
    if not isinstance(value, dict):
        return field
    kinds = ', '.join(f'{k}:{type(v).__name__ if v is not None else "null"}' for k, v in list(value.items())[:20])
    return f'{field} — 보낸 칸 {kinds}'

def _mm(args, key, lo, hi):
    if key not in args:
        return None
    value = args[key]
    if type(value) not in (int, float) or not lo <= value <= hi:
        raise ValueError(f'{key} 는 {lo}~{hi} mm 입니다.')
    return value / 1000

def _polygon(value, name='outline'):
    if not isinstance(value, list) or len(value) < 3 or any(
        not isinstance(p, (list, tuple)) or len(p) != 2 or any(type(v) not in (int, float) or not math.isfinite(v) for v in p)
        for p in value
    ):
        raise ValueError(f'{name} 은 [[x,y], ...] (m) 꼭짓점 3개 이상입니다.')
    # m 배열 자리에 도면 mm 숫자를 넣으면 10 km 건물이 된다. 소규모 구조 범위(가로·세로 300 m)를 넘으면 단위부터 확인시킨다.
    span = max(max(p[k] for p in value) - min(p[k] for p in value) for k in (0, 1))
    if span > 300:
        raise ValueError(f'{name} 이 {span:,.0f} m 로 너무 큽니다. [[x,y], ...] 배열은 m 입니다(mm 이면 1000 으로 나누세요).')
    return copy.deepcopy(value)

STORY_HEIGHT_MAX_M = 20  # 층고 m 자리에 mm 를 넣는 실수를 막는다(소규모 구조 범위).

def _sync_legal(out):
    """같은 확인(시행령 제32조②3~8호 비해당)을 CAD 도구는 excluded32_2_3to8Confirmed, 서버 판정기는
    smallBuildingConfirmed 로 읽는다. 어느 쪽을 줘도 둘 다 같은 값으로 채워 보낸다(하나라도 거짓이면 거짓)."""
    legal = out.get('legal')
    if isinstance(legal, dict):
        given = [legal[k] for k in LEGAL_CONFIRM_KEYS if k in legal]
        if any(type(v) is not bool for v in given):
            raise ValueError('legal.excluded32_2_3to8Confirmed 는 참·거짓입니다.')
        # 서버는 legal 에 smallBuildingConfirmed 하나만 받는다(excluded32… 나 다른 칸이 섞이면 legal 째로 거절, 10-19 실서버 확인).
        if given:
            out['legal'] = {'smallBuildingConfirmed': all(given)}
        else:
            out.pop('legal', None)

def _sync_stairs(out):
    """평면 읽기는 계단을 [{x0,y0,x1,y1,sourceIds}, ...] 목록으로 주지만 엔진 stairsAt 은 외접 사각형 하나다
    (빈 목록·목록은 stairsAt 입력 오류). 계단 없음은 칸을 빼고, 하나면 그 사각형만, 여럿이면 고르지 않고 확인할 것으로 남긴다."""
    stairs = out.get('stairsAt')
    if not isinstance(stairs, list):
        return
    out.pop('stairsAt')
    floors = out.get('floors')
    stories = len(floors) if isinstance(floors, list) and floors else out.get('stories')
    finding = None
    if len(stairs) == 1 and isinstance(stairs[0], dict):
        out['stairsAt'] = {k: stairs[0][k] for k in ('x0', 'y0', 'x1', 'y1') if k in stairs[0]}
    elif len(stairs) > 1:
        ids = [i for s in stairs if isinstance(s, dict) for i in s.get('sourceIds') or []]
        finding = {'level': 'warn', 'st': 'hold', 'ids': ids,
                   'text': f'도면에서 계단을 {len(stairs)}개 읽었습니다. 구조 검토는 계단 하나만 놓으므로 위치를 정하지 않았습니다. 주 계단 위치를 확인해 주세요.'}
    elif not stairs and type(stories) is int and stories >= 2:
        finding = {'level': 'warn', 'st': 'hold', 'ids': [],
                   'text': '도면에서 계단을 찾지 못했습니다. 2층 이상이면 계단이 있어야 하니 계단 위치를 확인해 주세요.'}
    if finding:
        out['recognitionFindings'] = (out.get('recognitionFindings') or []) + [finding]

DRAWING_TYPES = {'rc-frame': 'rc-moment', 'wall': 'rc-wall', 'steel': 'steel-moment'}   # 도면 기준 structureSystems 이름 → 구조 엔진 이름


def _usual_values():
    """도면 기준의 구조 보통 값(structureAssumptions) — 서버 기준(설치판) 또는 저장소 사본."""
    try:
        import vault_gate
        return json.loads(vault_gate.knowledge('drawing-standard.json').decode('utf-8')).get('structureAssumptions')
    except Exception:
        return None


def engine_input(args, outline=None):
    """직사각형 선택만 mm→m. outline 배열·floors·실제 부재는 입력 약속(m, 단면 mm) 그대로 전달."""
    system = args.get('system', 'rc')
    if system not in SYSTEMS:
        raise ValueError('system 은 rc·steel·wood 입니다.')
    mode = args.get('mode', 'design')
    if mode not in ('design', 'check', 'renovation'):
        raise ValueError('mode 는 design·check·renovation 입니다.')
    out = {'system': system, 'mode': mode}
    for key in ('X', 'Y', 'H', 'target', 'openH', 'stories', 'pitch', 'grade', 'roof', 'use', 'snow', 'wind',
                'stairs', 'stairW', 'species', 'slope', 'Fe', 'soilOk', 'walls', 'columns', 'footings',
                'floors', 'renovation', 'stairsAt', 'basement', 'legal', 'location', 'recognitionFindings'):
        if key in args:
            out[key] = copy.deepcopy(args[key])
    _sync_legal(out)
    _sync_stairs(out)
    for key in si.NEW_KEYS:
        if key in args:
            out[key] = copy.deepcopy(args[key])
    # 도면 기준 구조 형식 이름(model.building.structure: rc-frame·wall·steel)을 엔진 이름으로 — 괴정 rc-frame 이 '제품 적용 범위 밖'이 됐다(2026-10-30)
    if 'structureType' in out:
        out['structureType'] = DRAWING_TYPES.get(out['structureType'], out['structureType'])
    if outline is None:
        outline = args.get('outline')
    if isinstance(outline, list):
        out['outline'] = _polygon(outline)
    elif isinstance(outline, dict):
        if not all(type(outline.get(k)) in (int, float) and math.isfinite(outline[k]) for k in ('x', 'y', 'width', 'depth')):
            raise ValueError('직사각형 outline 은 {x,y,width,depth} mm 입니다.')
        if not all(1000 <= outline[k] <= 200000 for k in ('width', 'depth')):
            raise ValueError('직사각형 폭·깊이는 1~200 m 입니다.')
        out.update(X=outline['width'] / 1000, Y=outline['depth'] / 1000)
    elif not out.get('floors') and not all(type(out.get(k)) in (int, float) and math.isfinite(out[k]) and out[k] > 0 for k in ('X', 'Y')):
        raise ValueError('outline 또는 floors 또는 X·Y 가 필요합니다.')
    # mm 로 받은 층고·경간·개구부 높이를 먼저 m 로 바꾼다. 층마다 H 가 빠졌을 때 아래에서 이 층고를 채운다.
    for key, name, lo, hi in (('storyHeight', 'H', 1500, 10000), ('targetSpan', 'target', 1000, 30000), ('openingHeight', 'openH', 500, 5000)):
        value = _mm(args, key, lo, hi)
        if value is not None:
            out[name] = value
    if type(out.get('H')) in (int, float) and out['H'] > STORY_HEIGHT_MAX_M:
        raise ValueError(f'H 가 {out["H"]:g} 입니다. H 는 층고 m 입니다(3 m 이면 3, mm 로 주려면 storyHeight).')
    if 'floors' in out:
        if not isinstance(out['floors'], list) or not out['floors']:
            raise ValueError('floors 는 아래층부터 나열한 층 배열입니다.')
        for i, floor in enumerate(out['floors']):
            if not isinstance(floor, dict):
                raise ValueError('floors 항목은 객체입니다.')
            _polygon(floor.get('outline'), f'floors[{i}].outline')
            height = floor.get('H')
            if 'H' not in floor and not floor.get('heightConflict') and type(out.get('H')) in (int, float) and math.isfinite(out['H']) and out['H'] > 0:
                height = floor['H'] = out['H']  # 층마다 같은 층고를 위에서 한 번만 준 경우
            if type(height) in (int, float) and math.isfinite(height) and height > STORY_HEIGHT_MAX_M:
                raise ValueError(f'floors[{i}].H 가 {height:g} 입니다. H 는 m 입니다(3 m 이면 3, mm 로 주려면 storyHeight).')
            if not (type(height) in (int, float) and math.isfinite(height) and height > 0):
                if floor.get('heightConflict'):
                    raise ValueError(f'{i + 1}층 층고 숫자가 도면에서 서로 다릅니다. 층고(H, m)를 알려 주세요.')
                raise ValueError(f'floors[{i}].H(층고 m)가 필요합니다. 이 층 바닥에서 위층 바닥까지 높이를 알려 주세요.')
            # 서버는 모르는 층 칸이 있으면 floors[i] 로만 거절한다. 평면 읽기 기록(alignment·heightConflict)은 빼고,
            # 그 밖의 칸(level·z 등)은 무엇이 틀렸는지 여기서 알린다.
            # 평면 읽기가 층 기준점 맞춤을 확인하지 못했으면(confirmed False) 위아래 층 벽 연속 판정이 틀릴 수 있어 멈춘다.
            if isinstance(floor.get('alignment'), dict) and floor['alignment'].get('confirmed') is False:
                raise ValueError(f'{i + 1}층 기준점 맞춤이 확인되지 않았습니다. 층마다 같은 기준점(readOptions.datums, mm)을 지정하거나 사용자에게 확인한 뒤 다시 검토하세요.')
            extra = sorted(set(floor) - FLOOR_KEYS - FLOOR_READ_KEYS)
            if extra:
                raise ValueError(f'floors[{i}] 에는 {", ".join(extra)} 칸을 쓸 수 없습니다. 층 순서·높이는 floors 순서와 H 로만 줍니다'
                                 f'(쓸 수 있는 칸: {", ".join(sorted(FLOOR_KEYS))}).')
            for j, wall in enumerate(floor.get('walls') or []):
                number = lambda v: type(v) in (int, float) and math.isfinite(v)
                openings = wall.get('openings', []) if isinstance(wall, dict) else None
                if not isinstance(wall, dict) or not all(number(wall.get(k)) for k in ('x0', 'y0', 'x1', 'y1')) or not (
                    isinstance(openings, list) and all(isinstance(g, list) and len(g) == 2 and all(map(number, g)) and g[0] <= g[1] for g in openings)
                ):
                    raise ValueError(f'floors[{i}].walls[{j}] 은 벽 중심선 x0·y0·x1·y1(m), 두께 t(mm), mat(conc 등), openings=[[s0,s1],...](벽 시작점에서 잰 m) 입니다. '
                                     '도면 벽을 직접 옮기지 말고 외곽 자동 평면 읽기(위층이 같으면 sameLayoutUpper)나 boxes 를 쓰세요.')
                # 평면 읽기가 붙이는 '위치를 못 찾은 창·문' 기록은 서버가 받지 않는다. 비었으면 빼고,
                # 남아 있으면 개구부를 뺀 벽 길이를 셀 수 없으므로 서버에 보내지 않고 멈춘다.
                if wall.get('unresolvedOpenings'):
                    ids = ', '.join(map(str, wall.get('sourceIds') or [])) or f'{j + 1}번째 벽'
                    found = [str(o.get('openingId') or ', '.join(map(str, o.get('sourceIds') or []))) for o in wall['unresolvedOpenings'] if isinstance(o, dict)]
                    raise ValueError(f'{i + 1}층 벽({ids})에 어느 벽에 붙었는지 정해지지 않은 창·문({", ".join(filter(None, found)) or "ID 없음"})이 있어 '
                                     '개구부를 뺀 벽 길이를 셀 수 없습니다. 그 창·문을 벽에 붙여 그리거나(문 D1·창 W1 명령) 사용자에게 어느 벽인지 확인한 뒤 다시 검토하세요. '
                                     '벽을 읽지 않는 구조 시안만 원하면 mode=design 으로 부르세요.')
                wall.pop('unresolvedOpenings', None)
            out['floors'][i] = {k: v for k, v in floor.items() if k in FLOOR_KEYS}
        # floors가 있으면 전체 층수도 floors 기준이다. 층 원점·기초 B(m), D(mm)는 변환하지 않는다.
    if 'siteSlope' in args:
        out['slope'] = args['siteSlope']
    soil = args.get('soil')
    if soil is not None:
        if not isinstance(soil, dict) or set(soil) - {'Fe', 'landfill'}:
            raise ValueError('soil 은 {Fe, landfill} 입니다.')
        if 'Fe' in soil:
            out['Fe'] = soil['Fe']
        if 'landfill' in soil:
            if type(soil['landfill']) is not bool:
                raise ValueError('soil.landfill 은 true/false 입니다.')
            out['soilOk'] = not soil['landfill']
    if si.storeys(out) >= 3:
        out['reviewMethod'] = 'kds41-preliminary'
    blocked = []
    if 'answers' in args:
        out, blocked = si.apply_answers(out, args['answers'], args.get('_questions'))
        _sync_legal(out)  # 답으로 한쪽 확인만 바뀌어도 두 칸이 어긋나지 않게
    out = si.auto_fill(out, blocked=blocked)
    out = si.fill_usual(out, _usual_values())
    # 서버는 근거 칸마다 source·confirmed·assumption 세 칸만 받는다(그 밖의 칸이면 inputEvidence.* 로 거절). 주소가 '부산광역시 …'처럼
    # 지진구역 표와 맞으면 reference·value 가 붙어 RC·벽식 구조 계산이 늘 거절됐다(2026-10-30 괴정 시험). 근거 글은 assumption 에 붙인다.
    for key, note in list((out.get('inputEvidence') or {}).items()):
        if isinstance(note, dict):
            extra = ' · '.join(str(note[k]) for k in ('value', 'reference') if note.get(k) not in (None, ''))
            out['inputEvidence'][key] = {'source': str(note.get('source', ''))[:1000], 'confirmed': bool(note.get('confirmed')),
                                         'assumption': (str(note.get('assumption', '')) + (' 근거: ' + extra if extra else ''))[:2000]}
    # NaN/Infinity는 JSON으로 서버에 넘기지 않는다. 미상은 누락/null로 보존한다.
    try:
        json.dumps(out, allow_nan=False)
    except (ValueError, TypeError):
        raise ValueError('입력에는 유한한 숫자와 JSON 값만 사용할 수 있습니다.') from None
    return out


STATES = ('ok', 'ng', 'hold', 'unsupported', 'scope', 'info')
VERDICTS = {'scope': '적용범위 밖', 'ng': '부적합', 'unsupported': '미지원', 'hold': '자료 부족', 'ok': '적합'}
FIX_KINDS = ('input', 'layout', 'member', 'field', 'calc')

def verdict_of(review, engine_result=None):
    """CORE verdictOf(review) 결과 우선. 구 서버 응답은 동일 우선순위로 집계."""
    counts = {st: sum(f.get('st') == st for f in review) for st in STATES}
    fixes = [kind for kind in FIX_KINDS if any(f.get('fix') == kind for f in review)]
    fallback = {'verdict': next((VERDICTS[st] for st in ('scope', 'ng', 'unsupported', 'hold') if counts[st]), '적합'),
                'counts': counts, 'fixKinds': fixes}
    engine_counts = engine_result.get('counts') if isinstance(engine_result, dict) else None
    if isinstance(engine_counts, dict) and engine_result.get('verdict') == fallback['verdict'] and all(
        engine_counts.get(st, 0) == counts[st] for st in STATES
    ):
        return {**engine_result, 'counts': counts, 'fixKinds': engine_result.get('fixKinds') or fixes}
    return fallback

def verdict(review):
    return verdict_of(review)['verdict']

def _response_verdict(response):
    value = response.get('verdictOf') or response.get('verdict')
    if isinstance(value, dict):
        return value
    if isinstance(value, str):
        return {k: response.get(k) for k in ('verdict', 'counts', 'fixKinds')}
    return response.get('verdictSummary')

def _missing_conditions(engine):
    """도면 밖 적용 조건을 서버 기본값으로 확정하지 않는다."""
    if si.preliminary(engine):
        return [{'grp': '검토 범위', 'item': '전체 구조설계 완료', 'st': 'hold', 'fix': 'calc',
                 'val': '개략 검토 초안', 'req': '후속 구조계산과 설계자 확인이 필요합니다.',
                 'ref': '3~5층 개략 검토 입력 약속', 'ids': []}]
    positive = lambda v: type(v) in (int, float) and math.isfinite(v) and v > 0
    floors = engine.get('floors')
    height_ok = all(positive(f.get('H')) for f in floors) if floors else positive(engine.get('H'))
    checks = [
        ('용도', engine.get('use') in ('house', 'retail', 'retailX', 'other'), '이 건물은 주택인가요, 가게인가요? 실제 쓰임을 확인해 주세요.', 'input'),
        ('층고', height_ok, '각 층 바닥에서 위층 바닥까지 높이를 알려 주세요.', 'input'),
        ('바람 조건', engine.get('wind') in ('normal', 'D35', 'D40', 'D40+', 'C40+'), '대지 주소나 위치를 알려 주세요. 적용할 풍속을 확인해야 합니다.', 'input'),
        ('눈 조건', engine.get('snow') in ('normal', 'heavy', 'east'), '대지 주소나 위치를 알려 주세요. 적용할 적설 조건을 확인해야 합니다.', 'input'),
        ('지내력', positive(engine.get('Fe')), '땅이 얼마의 하중을 버티는지 확인한 자료가 있나요? 없으면 현장 확인이 필요합니다.', 'field'),
        ('지반', type(engine.get('soilOk')) is bool, '성토·매립한 땅인지 확인해 주세요.', 'field'),
        ('지하층', type(engine.get('basement')) is bool or type(engine.get('basement')) is int and engine['basement'] >= 0, '지하층이 있는지 확인해 주세요.', 'input'),
        ('법적 적용 조건', isinstance(engine.get('legal'), dict) and engine['legal'].get('smallBuildingConfirmed') is True,
         '시행령 제32조제2항제3~8호의 중요 건물·보존 건물·특수구조 등에 해당하지 않는지 확인해 주세요.', 'input'),
    ]
    return [{'grp': '입력 확인', 'item': item, 'st': 'hold', 'val': reason, 'req': reason,
             'ref': '적용 조건 확인', 'fix': fix, 'ids': []} for item, known, reason, fix in checks if not known]


def members_summary(model):
    groups = OrderedDict()
    for m in model.get('members', []):
        code = m.get('code') or m.get('id')
        g = groups.setdefault(code, {'code': code, 'kind': m.get('kind'), 'count': 0, 'size': _size_of(m)})
        g['count'] += 1
    return list(groups.values())

def _size_of(m):
    if m.get('sec'):
        return m['sec']
    kind = m.get('kind')
    if kind == 'column':
        return f"{m.get('b')}x{m.get('h')} {m.get('bars', '')}".strip()
    if kind == 'beam':
        return f"{m.get('b')}x{m.get('h')}"
    if kind == 'footing':
        return f"{round(m.get('B', 0) * 1000)}x{m.get('D')}"
    if kind == 'woodWall':
        return f"38x{m.get('stud')}@{m.get('sp')}"
    if kind in ('joists', 'ceilJoists', 'rafters'):
        return f"38x{m.get('h')}@{m.get('sp')}"
    return f"t{m['t']}" if m.get('t') else kind

def review_with_conditions(review, engine):
    review = copy.deepcopy(review)
    for finding in _missing_conditions(engine):
        if not any(f.get('st') == 'hold' and f.get('item') == finding['item'] for f in review):
            review.append(finding)
    for finding in engine.get('recognitionFindings') or []:
        if finding.get('level') in ('warn', 'error') or finding.get('st') == 'hold' or re.search(r'가정|미확인|확인.*필요', finding.get('text') or ''):
            if not any(f.get('grp') == '도면 읽기' and f.get('val') == finding.get('text') for f in review):
                review.append({'grp': '도면 읽기', 'item': '도면 확인', 'st': 'hold', 'fix': 'field',
                               'val': finding.get('text'), 'req': finding.get('text'), 'ids': finding.get('ids', []), 'ref': '도면 판독'})
    return review

def effective_review(record):
    return review_with_conditions(record.get('review') or [], (record.get('input') or {}).get('engine') or {})

def record_from(response, args, outline, engine, set_id=None):
    review = review_with_conditions(response['review'], engine)
    return {'questions': si.questions_from(response, engine), 'missing': copy.deepcopy(response.get('missing') or []),
            'id': set_id or 'st-' + uuid.uuid4().hex[:10], 'system': response['model'].get('system'),
            'input': {'args': {k: v for k, v in args.items() if k not in ('target', 'expectedRevision', 'insert', '_questions')}, 'outline': outline, 'engine': engine},
            'rulesVersion': response.get('rulesVersion'), 'model': response['model'], 'overrides': response.get('overrides') or [], 'review': review,
            'assessment': verdict_of(review, _response_verdict(response)),
            'quantities': response.get('quantities'), 'createdAt': time.strftime('%Y-%m-%dT%H:%M:%S')}

def outline_bounds_mm(outline):
    """삽입 위치만을 위한 외접 상자. 엔진 윤곽을 사각형으로 대체하지 않는다."""
    if isinstance(outline, dict):
        return outline
    points = _polygon(outline)
    xs, ys = [p[0] * 1000 for p in points], [p[1] * 1000 for p in points]
    return {'x': min(xs), 'y': min(ys), 'width': max(xs) - min(xs), 'depth': max(ys) - min(ys)}

def out_of_scope(engine):
    """층별·다각형 입력도 보존한다. 명백한 범위 초과만 서버 호출 전에 차단."""
    findings = []
    count = len(engine['floors']) if engine.get('floors') else engine.get('stories', 2)
    def add(item, value, required):
        findings.append({'grp': '적용 범위', 'item': item, 'st': 'scope', 'fix': 'calc', 'val': value,
                         'req': required, 'ref': '건축물의 구조기준 등에 관한 규칙 제3조②', 'ids': []})
    if count > 5:
        add('층수', f'{count}층', '개략 검토 3~5층')
    if count >= 3:
        return findings or None
    outlines = [f['outline'] for f in engine['floors']] if engine.get('floors') else [engine.get('outline')]
    for ring in outlines:
        if ring:
            box = outline_bounds_mm(ring)
            x, y = box['width'] / 1000, box['depth'] / 1000
        else:
            x, y = engine['X'], engine['Y']
        if max(x, y) > 40:
            add('건물 크기', f'{x:g}×{y:g} m', '한 변 40 m 이하')
    return findings or None

def _finding_brief(f):
    # 원문 문장·fix와 부재 대응을 잃지 않는다.
    return {**f, 'item': f.get('item'), 'value': f.get('val'), 'required': f.get('req'),
            'basis': f.get('basis', f.get('ref')), 'ids': f.get('ids', []), 'fix': f.get('fix')}

def brief(record):
    review = effective_review(record)
    assessment = verdict_of(review, record.get('assessment'))
    return {'setId': record['id'], 'system': record.get('system'), 'rulesVersion': record.get('rulesVersion'), **assessment,
            'ok': assessment['counts']['ok'],
            **{st: [_finding_brief(f) for f in review if f.get('st') == st] for st in ('ng', 'hold', 'unsupported', 'scope')},
            'info': [_finding_brief(f) for f in review if f.get('st') == 'info'],
            'canCreateCertificate': not si.preliminary((record.get('input') or {}).get('engine') or record['model'].get('p') or {}) and assessment['verdict'] == '적합', 'outputType': '검토 초안',
            'members': members_summary(record['model']), 'quantities': _quantity_brief(record.get('quantities')), 'overrides': record.get('overrides', []),
            'drawn': record.get('drawn'),
            **_preliminary_brief(record)}


def _quantity_brief(q):
    if not isinstance(q, dict):
        return None
    if q.get('generic'):
        rows = q.get('rows') or {}
        out = {k: {'value': round(r.get('v', 0), 2), 'unit': r.get('u'), 'note': r.get('note')} for k, r in rows.items()}
        concrete = [r.get('v', 0) for k, r in rows.items() if '콘크리트' in k and r.get('u') in ('㎥', 'm³', 'm3')]
        rebar = [r.get('v', 0) for k, r in rows.items() if '철근' in k and r.get('u') == 't']
        form = [r.get('v', 0) for k, r in rows.items() if '거푸집' in k and r.get('u') in ('㎡', 'm²', 'm2')]
        out.update(concreteM3=round(sum(concrete), 1) if concrete else None,
                   formworkM2=round(sum(form), 1) if form else None,
                   rebarTon=round(sum(rebar), 2) if rebar else None,
                   rebarWithLapTon=round(sum(rebar) * 1.1, 2) if rebar else None,
                   lapFactor=1.1, assumptions=['철근 이음·정착 +10% 가정치', '서버 미제공 물량은 null'])
        return out
    tot = q.get('tot') or {}
    steel = tot.get('steel', 0)
    return {'concreteM3': round(tot.get('conc', 0), 1), 'rebarTon': round(steel / 1000, 2),
            'formworkM2': round(tot.get('form', 0), 1), 'rebarWithLapTon': round(steel * 1.1 / 1000, 2),
            'lapFactor': 1.1, 'assumptions': ['철근 이음·정착 +10% 가정치']}

def column_update_findings(previous, updated, code):
    """서버 반환값 전체를 매번 확인한다. 반복 수정으로 기존 주근 미달 판정이 사라지지 않는다."""
    before = {m['id']: m for m in previous.get('members', []) if m.get('kind') == 'column' and m.get('code') == code and not m.get('sec')}
    after = {m['id']: m for m in updated.get('members', [])}
    findings = []
    # CORE BAR의 공칭 단면적(mm²). 재설계가 아니라 서버 반환값의 최소 비율 검증에만 쓴다.
    areas = {16: 198.6, 19: 286.5, 22: 387.1}
    p = updated.get('p') or {}
    count = len(p['floors']) if p.get('floors') else p.get('stories') or max([m.get('level', 1) for m in updated.get('members', [])] or [1])
    minimum_area = 122500 if count == 1 else 160000
    for member_id in before:
        if member_id not in after:
            findings.append({'grp': '기둥', 'item': '서버 주근 재계산', 'st': 'hold', 'fix': 'member', 'val': '바꾼 기둥을 서버 응답에서 확인할 수 없습니다.', 'req': '서버에서 단면·주근 함께 재계산', 'ref': 'KDS 42 20 00 4.3.1(5)', 'ids': [member_id]})
    for m in updated.get('members', []):
        if m.get('kind') != 'column' or m.get('sec'):
            continue
        area = m.get('b', 0) * m.get('h', 0)
        if area <= minimum_area:
            continue
        spec = re.fullmatch(r'(\d+)-D(\d+)', str(m.get('bars') or ''))
        steel = int(spec[1]) * areas.get(int(spec[2]), 0) if spec else 0
        if not steel or steel / area < 0.01 - 1e-9:
            findings.append({'grp': '기둥', 'item': '서버 주근 재계산', 'st': 'ng' if steel else 'hold', 'fix': 'member',
                             'val': f"서버 주근 재계산 미완료: {m.get('bars') or '배근 미제공'}",
                             'req': '확대 기둥 단면의 1.0% 이상 주근을 서버에서 갱신해야 합니다.',
                             'ref': 'KDS 42 20 00 4.3.1(5)', 'ids': [m['id']]})
    return findings

def merge_override(overrides, code, size):
    """부호 크기 덮어쓰기 목록에 하나를 더한다(같은 부호는 새 값으로). 검사·적용은 서버가 한다(조용히 무시하지 않음)."""
    if not isinstance(code, str) or not re.fullmatch(r'[A-Z]{1,3}\d{0,3}', code):
        raise ValueError('code 는 G1·C1·J1 같은 부재 부호입니다(cad_structure_get 의 code).')
    if not isinstance(size, str) or not re.fullmatch(r'\d{2,4}\s*[xX×]\s*\d{2,4}|H-[\dxX×.]+', size.strip()):
        raise ValueError('size 형식: 300x550(RC 보·기둥) · 2500x400(독립기초) · H-400x200x8x13(철골) · 38x235(목조 장선)')
    return [o for o in overrides or [] if o.get('code') != code] + [{'code': code, 'size': size.strip()}]


class Sets:
    """도면에 넣지 않은 구조 묶음(insert=false)을 잠깐 기억한다(최근 20개, 이 실행 동안만)."""

    def __init__(self, limit=20):
        self.limit, self.items, self.lock = limit, OrderedDict(), threading.Lock()

    def put(self, record):
        with self.lock:
            self.items.pop(record['id'], None)
            self.items[record['id']] = copy.deepcopy(record)
            while len(self.items) > self.limit:
                self.items.popitem(last=False)

    def get(self, set_id):
        with self.lock:
            value = self.items.get(set_id)
            return copy.deepcopy(value) if value else None


pending = Sets()


def export_calc_report(result, set_id, folder=None):
    """계산서 초안 HTML을 임시 파일로 보관한다. 계산·배포·도면 수정 없음."""
    import tempfile
    from pathlib import Path
    if not isinstance(result, dict):
        raise ValueError('구조계산서 응답이 올바르지 않습니다.')
    if not result.get('ok'):
        return result
    if not isinstance(set_id, str) or not re.fullmatch(r'st-[0-9a-f]{10}', set_id):
        raise ValueError('구조계산서 묶음 ID가 올바르지 않습니다.')
    html = result.get('html')
    if not isinstance(html, str) or not html.startswith('<!doctype html>'):
        raise ValueError('구조계산서 HTML이 없습니다.')
    # 도면 폴더가 있으면 거기에(일조 보고서처럼 찾기 쉽게, 2026-11-02) — 없으면 임시 폴더
    folder = Path(folder) if folder else Path(tempfile.mkdtemp(prefix='barun-structure-calc-report-'))
    target = folder / (set_id + '-calc-report.html')
    target.write_text(html, encoding='utf-8')
    return {'ok': True, 'path': str(target), 'missing': result.get('missing', []),
            'sections': result.get('sections', []), 'setId': set_id, 'format': 'html'}


def export_certificate(result, set_id, format='pdf', folder=None):
    """브라우저의 서식 셀 격자를 기존 CAD PDF 엔진(ReportLab·CADKorean)으로 출력한다.

    HTML/PDF가 같은 셀 좌표·병합·치수를 사용한다. 출력 전 검증/조판에 실패하면 파일을 남기지 않는다.
    """
    import io
    import math
    import tempfile
    from pathlib import Path

    if format not in ('pdf', 'html'):
        raise ValueError('format은 pdf 또는 html이어야 합니다.')
    if not isinstance(result, dict):
        raise ValueError('확인서 응답이 올바르지 않습니다.')
    if not result.get('ok'):
        return result
    if not isinstance(set_id, str) or not re.fullmatch(r'st-[0-9a-f]{10}', set_id):
        raise ValueError('확인서 묶음 ID가 올바르지 않습니다.')
    table = result.get('table')
    if not isinstance(table, dict):
        raise ValueError('확인서 표가 없습니다.')
    widths, heights, rows = (table.get(k) for k in ('columnWidths', 'rowHeights', 'rows'))
    if not all(isinstance(v, list) and v for v in (widths, heights, rows)) or not 1 <= len(widths) <= 40 or not 1 <= len(heights) <= 60 or len(rows) != len(heights):
        raise ValueError('확인서 표 격자가 올바르지 않습니다.')
    if any(type(v) not in (int, float) or not math.isfinite(v) or v <= 0 for v in widths + heights) or sum(widths) > 186.01 or sum(heights) > 277:
        raise ValueError('확인서 표가 A4 세로 출력 범위를 벗어납니다.')
    occupied, cells = set(), []
    for r, row in enumerate(rows):
        if not isinstance(row, list):
            raise ValueError('확인서 행이 올바르지 않습니다.')
        for cell in row:
            if not isinstance(cell, dict):
                raise ValueError('확인서 셀이 올바르지 않습니다.')
            rr, cc, rs, cs = (cell.get(k) for k in ('row', 'column', 'rowspan', 'colspan'))
            if any(type(v) is not int for v in (rr, cc, rs, cs)) or rr != r or min(rr, cc) < 0 or min(rs, cs) < 1 or rr + rs > len(heights) or cc + cs > len(widths):
                raise ValueError('확인서 셀 병합 범위가 올바르지 않습니다.')
            slots = {(y, x) for y in range(rr, rr + rs) for x in range(cc, cc + cs)}
            if occupied & slots:
                raise ValueError('확인서 병합 셀이 겹칩니다.')
            occupied.update(slots)
            for k, default, lo, hi in (('fontSize', 7, 6, 16), ('padding', 0.5, 0, 3)):
                v = cell.get(k, default)
                if type(v) not in (int, float) or not math.isfinite(v) or not lo <= v <= hi:
                    raise ValueError('확인서 글자 크기 또는 여백이 올바르지 않습니다.')
            if cell.get('align', 'left') not in ('left', 'center') or type(cell.get('border', True)) is not bool or not isinstance(cell.get('text', ''), str) or len(cell.get('text', '')) > 8000:
                raise ValueError('확인서 셀 내용이 올바르지 않습니다.')
            cells.append(cell)
    if len(occupied) != len(widths) * len(heights):
        raise ValueError('확인서 표에 누락된 셀이 있습니다.')
    if format == 'html':
        html = result.get('html')
        if not isinstance(html, str) or not html.startswith('<!doctype html>'):
            raise ValueError('확인서 HTML이 올바르지 않습니다.')
        if 'url("fonts/NanumGothic-Regular.ttf")' in html:
            import base64
            import pdf_service
            from reportlab.pdfbase import pdfmetrics
            pdf_service.font()
            font_file = Path(pdfmetrics.getFont(pdf_service.FONT).face.filename)
            font_url = 'data:font/ttf;base64,' + base64.b64encode(font_file.read_bytes()).decode('ascii')
            html = html.replace('url("fonts/NanumGothic-Regular.ttf")', 'url("' + font_url + '")')
        content = html.encode('utf-8')
    else:
        from reportlab.pdfgen import canvas
        from reportlab.lib.pagesizes import A4
        from reportlab.lib.units import mm
        from reportlab.pdfbase import pdfmetrics
        import pdf_service

        pdf_service.font()
        default_face = pdf_service.FONT
        face = default_face
        out = io.BytesIO()
        cv = canvas.Canvas(out, pagesize=A4, pageCompression=1)
        cv.setTitle('구조안전 및 내진설계 확인서(소규모건축물)')
        cv.setCreator('바른 CAD')
        cv.setLineWidth(0.2 * mm)
        x = [(A4[0] - sum(widths) * mm) / 2]
        y = [A4[1] - 10 * mm]
        for w in widths:
            x.append(x[-1] + w * mm)
        for h in heights:
            y.append(y[-1] - h * mm)

        def wrap(text, width, size):
            lines = []
            for raw in text.split('\n'):
                line = ''
                for ch in raw:
                    if pdfmetrics.stringWidth(ch, face, size) > width:
                        return None
                    if line and pdfmetrics.stringWidth(line + ch, face, size) > width:
                        lines.append(line)
                        line = ch
                    else:
                        line += ch
                lines.append(line)
            return lines

        for cell in cells:
            r, c, rs, cs = (cell[k] for k in ('row', 'column', 'rowspan', 'colspan'))
            left, right, upper, bottom = x[c], x[c + cs], y[r], y[r + rs]
            if cell.get('border', True):
                cv.rect(left, bottom, right - left, upper - bottom, stroke=1, fill=0)
            if not cell.get('text'):
                continue
            face = default_face if pdf_service._covers(default_face, cell['text']) else pdf_service.text_font({'sourceFont': 'malgun'}, cell['text'])
            if not pdf_service._covers(face, cell['text']):
                raise ValueError('확인서에 글꼴이 지원하지 않는 문자가 있습니다. 다른 문자로 입력해 주세요.')
            pad = cell.get('padding', 0.5) * mm
            size = cell.get('fontSize', 7)
            while True:
                lines = wrap(cell['text'], right - left - 2 * pad, size)
                if lines is not None and len(lines) * size * 1.15 <= upper - bottom - 2 * pad + 0.01:
                    break
                if size <= 6:
                    raise ValueError(f'확인서 {r + 1}행 {c + 1}열 내용이 칸을 넘습니다. 입력을 줄이거나 작성자가 별도 기재해 주세요.')
                size = max(6, size - 0.25)
            cv.setFont(face, size)
            leading = size * 1.15
            ty = upper - pad - (upper - bottom - 2 * pad - len(lines) * leading) / 2 - size
            for line in lines:
                tx = (left + right - pdfmetrics.stringWidth(line, face, size)) / 2 if cell.get('align') == 'center' else left + pad
                cv.drawString(tx, ty, line)
                ty -= leading
        cv.showPage()
        cv.save()
        content = out.getvalue()
    folder = Path(folder) if folder else Path(tempfile.mkdtemp(prefix='barun-structure-certificate-'))
    target = folder / (set_id + '.' + format)
    target.write_bytes(content)
    return {'ok': True, 'path': str(target), 'missing': result.get('missing', []), 'setId': set_id, 'format': format}


def _preliminary_brief(record):
    engine = (record.get('input') or {}).get('engine') or record['model'].get('p') or {}
    if not si.preliminary(engine):
        return {}
    p = record['model'].get('preliminary') or {}
    analysis = p.get('analysis') or {}
    proposals = [{'id': r.get('id'), 'level': r.get('level'), 'kind': r.get('kind'),
                  'origin': 'proposal', 'choice': copy.deepcopy((r.get('data') or {}).get('choice') or r.get('choice'))}
                 for r in p.get('memberResults') or [] if (r.get('data') or {}).get('choice') or r.get('choice')]
    return {'reviewMethod': 'kds41-preliminary', 'seismic': copy.deepcopy(p.get('seismic')),
            'seismicParams': copy.deepcopy(p.get('params')),
            'drift': {'status': analysis.get('status'), 'dirs': copy.deepcopy(analysis.get('dirs'))},
            'memberProposals': proposals, 'questions': copy.deepcopy(record.get('questions') or si.questions_from(record, engine)),
            'inputEvidence': copy.deepcopy(engine.get('inputEvidence') or {}), 'notifications': si.notifications(engine)}
