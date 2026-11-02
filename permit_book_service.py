"""인허가 도서 창(permit-book.js) ↔ 도서 엔진(tools/access_plan · tools/energy_plan).

창에서 받은 것(지금 도면·① 개요·③ 층 범위·편의시설 조건·④ 시설 확인)으로 엔진 프로젝트 폴더를 만들어 돌린다.
결정(docs/access-plan-book-list.md '화면'): 한 창 두 탭, PDF 는 도서마다 따로, 검사에 걸리면 PDF 이름 끝 '_검사필요'.
도서는 도면 파일 옆 '<도면 이름>_인허가도서/{편의시설,에너지}' 에 둔다(저장 안 한 도면은 문서 폴더).
"""
import json
import os
import re
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent
TOOLS = ROOT / 'tools'
ACTIONS = ('access-profiles', 'access-review', 'access-build', 'energy-region', 'energy-defaults', 'energy-envelope', 'energy-build', 'open-path')
REGION_SHORT = {'서울': '서울특별시', '부산': '부산광역시', '대구': '대구광역시', '인천': '인천광역시', '광주': '광주광역시', '대전': '대전광역시', '울산': '울산광역시',
                '세종': '세종특별자치시', '경기': '경기도', '강원': '강원특별자치도', '강원도': '강원특별자치도', '충북': '충청북도', '충남': '충청남도', '전북': '전북특별자치도',
                '전라북도': '전북특별자치도', '전남': '전라남도', '경북': '경상북도', '경남': '경상남도', '제주': '제주특별자치도', '제주도': '제주특별자치도'}
_made = set()   # 이 실행에서 만든 결과 파일 — open-path 는 이것만 연다


def _tools():
    if str(TOOLS) not in sys.path: sys.path.insert(0, str(TOOLS))


def _text(v, limit=200):
    return str(v).strip()[:limit] if isinstance(v, (str, int, float)) and str(v).strip() else ''


def _num(v):
    try:
        n = float(v)
        return n if n == n and n >= 0 else None
    except (TypeError, ValueError):
        return None


def _floors(data):
    out = {}
    for f in data.get('floors') or []:
        b = f.get('bounds') or {}
        box = [b.get('minX'), b.get('minY'), b.get('maxX'), b.get('maxY')]
        name = _text(f.get('name'), 20)
        if name and all(isinstance(v, (int, float)) for v in box) and box[2] > box[0] and box[3] > box[1]: out[name] = box
    if not out: raise ValueError('③ 층 평면 범위를 먼저 고르세요(층마다 윈도우 두 점).')
    return out


def _out_root(data, kind):
    drawing = _text(data.get('drawingPath'), 1000)
    name = _text((data.get('overview') or {}).get('name'), 60) or (Path(drawing).stem if drawing else '새 도면')
    safe = ''.join(c for c in name if c not in '\\/:*?"<>|').strip() or '도서'
    base = Path(drawing).parent if drawing and Path(drawing).parent.is_dir() else Path.home() / 'Documents' / '바른CAD 인허가도서'
    return base / f'{safe}_인허가도서' / kind, safe


def _source(data, folder):
    """지금 도면 → 엔진이 읽을 DXF(앱 DXF 저장 그대로)."""
    import exchange
    doc = data.get('document')
    if not isinstance(doc, dict) or not isinstance(doc.get('entities'), list): raise ValueError('도면 자료가 없습니다.')
    raw, _warnings = exchange.export_dxf(doc)
    path = Path(folder) / 'source.dxf'; path.write_bytes(raw)
    return path


def _access_project(data, folder, file_name):
    ov = data.get('overview') or {}; fac = dict(data.get('facility') or {})
    if not fac.get('use') or _num(fac.get('areaM2')) in (None, 0): raise ValueError('② 대상 판정의 용도와 해당 용도 면적을 넣으세요.')
    fac['areaM2'] = _num(fac['areaM2'])
    for k in ('parkingSpaces',):
        if fac.get(k) not in (None, ''): fac[k] = int(_num(fac[k]) or 0)
        else: fac.pop(k, None)
    if fac.get('parkingRatio') not in (None, ''): fac['parkingRatio'] = _num(fac['parkingRatio'])
    else: fac.pop('parkingRatio', None)
    fac['work'] = fac.get('work') if fac.get('work') in ('new', 'change-use') else 'new'
    fac['date'] = _text(fac.get('date'), 10) or _text(ov.get('date'), 10)
    project = {
        'schema': 'barun.access.project/1',
        'project': {'name': _text(ov.get('name'), 60) or file_name, 'office': _text(ov.get('office'), 60) or '(입력 필요)', 'date': _text(ov.get('date'), 10),
                    'purpose': _text(ov.get('purpose'), 20) or '허가', 'fileName': f'{file_name}_편의시설도서'},
        'source': {'dxf': str(_source(data, folder)), 'frameNumber': _text(ov.get('frameNumber'), 20) or None},
        'regions': {'plans': _floors(data)},
        'originalSheets': {'plans': _text(ov.get('planSheets'), 40) or '-', 'section': _text(ov.get('sectionSheet'), 40) or '-', 'site': _text(ov.get('siteSheet'), 40) or '-'},
        'site': {'address': _text(ov.get('address'), 120) or '(입력 필요)', 'area': _num(ov.get('siteArea')), 'zone': _text(ov.get('zone'), 60)},
        'use': {'main': _text(ov.get('mainUse'), 60) or '(입력 필요)', 'drawingUse': ''},
        'gfa': _num(ov.get('gfa')), 'buildingArea': _num(ov.get('buildingArea')), 'structure': _text(ov.get('structure'), 40),
        'facility': fac, 'accessibility': data.get('accessibility') or {}, 'assumed': [], 'notesOverride': {},
    }
    pdir = Path(folder) / 'project'; pdir.mkdir(exist_ok=True)
    (pdir / 'project.json').write_text(json.dumps(project, ensure_ascii=False), encoding='utf-8')
    bridge = data.get('bridge')   # 앱 창이 명령 작업자로 만든 판정·계획도 기호(설치판: 백엔드에 node·잠금 코드가 없음)
    if bridge is not None:
        if not (isinstance(bridge, dict) and isinstance(bridge.get('rows'), list) and isinstance(bridge.get('floors'), list) and isinstance(bridge.get('model'), dict)
                and isinstance(bridge.get('decision'), dict) and {f.get('id') for f in bridge['floors'] if isinstance(f, dict)} >= set(project['regions']['plans'])):
            raise ValueError('편의시설 판정 결과가 올바르지 않습니다. 창을 닫았다 열고 다시 해 보세요.')
        (pdir / 'bridge.json').write_text(json.dumps(bridge, ensure_ascii=False), encoding='utf-8')
    return pdir


def _row(r):
    return {k: r.get(k) for k in ('id', 'code', 'name', 'requirement', 'status', 'installed', 'violation', 'targets', 'remedy', 'conditionNote')} | {
        'checks': [{k: c.get(k) for k in ('name', 'field', 'unit', 'op', 'limit', 'value', 'ok', 'alternative')} for c in r.get('checks', [])]}


def _mark(path, overflow):
    """검사에 걸린 PDF 는 이름 끝에 '_검사필요'(에너지 ⑦ 결정과 같음). 고쳐서 다시 만들면 원래 이름."""
    p = Path(path); bad = p.with_name(p.stem.removesuffix('_검사필요') + '_검사필요' + p.suffix)
    clean = p.with_name(p.stem.removesuffix('_검사필요') + p.suffix)
    target = bad if overflow else clean
    for old in {bad, clean} - {target}:
        if old.exists() and old != p: old.unlink()
    if p != target: os.replace(p, target)
    return target


def _access(data, build):
    _tools()
    from access_plan.book import Book
    from access_plan import sheets as S
    out, name = _out_root(data, '편의시설')
    with tempfile.TemporaryDirectory(prefix='barun_permit_') as tmp:
        b = Book(str(_access_project(data, tmp, name)))
        result = {'decision': {k: b.decision.get(k) for k in ('use', 'name', 'status', 'applies')}, 'rows': [_row(r) for r in b.rows],
                  'candidates': [{k: e.get(k) for k in ('id', 'kind', 'story', 'location', 'drawingClearWidth')} for e in b.data['model']['elements']],
                  'labels': {k: v.get('labels', []) for k, v in b.floor_data.items()}, 'sheets': [{'number': s['number'], 'title': s['title']} for s in b.plan]}
        if not build: return result
        out.mkdir(parents=True, exist_ok=True)
        dxf, summary = b.build(str(out))
        pdf = b.report(dxf, summary, ('floor-plan', 'site-plan'), pdf=True)
        std = S.pdf_overlay(b, pdf)   # 상세표준도 원본이 없으면 False(상세 칸 비움)
        pdf = _mark(pdf, summary['textOverflow'])
        _made.update({str(Path(dxf)), str(pdf), str(out)})
        return {**result, 'dxf': str(dxf), 'pdf': str(pdf), 'folder': str(out), 'textOverflow': summary['textOverflow'],
                'assumed': bool(b.ctx.assumed), 'sheetScale': summary['sheetScale'], 'standardDetails': bool(std)}


# ───────────── 에너지(②~⑦) ─────────────

def _knowledge_json(name):
    _tools()
    from plan_book.base import knowledge
    return json.loads(knowledge(name))


def region_of(address):
    """주소 → 별표1 지역(central1·central2·south·jeju). 모르면 None. 시·도 + 시·군·구 이름으로 별표1 비고의 '(… 제외)' 를 따른다."""
    words = [w for w in str(address or '').replace(',', ' ').split() if w]
    if not words: return None
    sido = REGION_SHORT.get(words[0], words[0]); city = words[1] if len(words) > 1 else ''
    city = city[:-1] if len(city) > 2 and city[-1] in '시군구' else city
    import re
    for key, reg in _knowledge_json('energy_envelope_standards.json')['regions'].items():
        for m in re.finditer(r'([^,(]+?)(?:\(([^)]*)\))?(?:,|$)', reg['members']):
            name, paren = m.group(1).strip(), m.group(2)
            if name != sido: continue
            if not paren: return key
            items = [x.strip() for x in paren.replace('제외', '').split(',') if x.strip()]
            if ('제외' in paren) != (city in items): return key
    return None


def _energy_settings(data):
    e = data.get('energy') if isinstance(data.get('energy'), dict) else {}
    return e


def _spec(data, e):
    """평면 읽기(tools/energy_envelope.py) 입력 — ③ 층 범위 + ④ 층고·창호 일람표 영역·북쪽."""
    floors = _floors(data); fl_set = e.get('floors') or {}; level = 0.0; out = []
    for name, box in floors.items():
        h = _num((fl_set.get(name) or {}).get('height'))
        if not h: raise ValueError(f'④ {name} 층고(m)를 넣으세요.')
        out.append({'name': name, 'level': round(level, 3), 'height': h, 'schedule_floor': name.replace('지하', 'B').replace('층', 'F'), 'window': box, 'north_deg': _num(e.get('northDeg')) if _num(e.get('northDeg')) is not None else 90.0})
        level += h
    sched = [[b['minX'], b['minY'], b['maxX'], b['maxY']] for b in (data.get('scheduleRegions') or []) if isinstance(b, dict) and all(isinstance(b.get(k), (int, float)) for k in ('minX', 'minY', 'maxX', 'maxY'))]
    if not sched: raise ValueError('④ 창호 일람표 영역을 고르세요(창·문 크기를 읽는 곳).')
    north = '도면 위쪽 = 북쪽' if (e.get('northDeg') in (None, '', 90, 90.0)) else f"북쪽 = 도면 {e.get('northDeg')}° 방향"
    return {'source_name': 'source.dxf', 'align_grid': _text(e.get('grid'), 10) or 'X1', 'schedule_windows': sched, 'energy_codes': {'window': 'G1', 'door': 'D1'},
            'assumptions': [north, '외벽 면적 = 벽 바깥면 길이 × 층고', '창·문 면적 = 창호 일람표 폭 × 높이'], 'floors': out}


def _envelope(data, folder):
    _tools()
    import energy_envelope
    e = _energy_settings(data); spec = _spec(data, e)
    sp = Path(folder) / 'spec.json'; sp.write_text(json.dumps(spec, ensure_ascii=False), encoding='utf-8')
    src = _source(data, folder); out = Path(folder) / 'envelope.json'
    energy_envelope.main(str(src), str(sp), str(out))
    return json.loads(out.read_text(encoding='utf-8')), src


def envelope_summary(env):
    """④ 층마다 확인할 것 — 바닥 구적·노출 면적·방위별 외벽·창·문. sig 는 확인 표시가 아직 맞는지 보는 지문."""
    floors = []
    for f in env['floors']:
        ops = [o for e in f['edges'] for o in e['openings']]
        by = {d: {k: round(v.get(k, 0), 2) for k in ('gross', 'window', 'door')} for d, v in f['by_orientation'].items() if v.get('gross')}
        row = {'name': f['name'], 'height': f['height'], 'floorArea': round(f['floor_area'], 2), 'roof': round(f['roof_exposed_area'], 2), 'ground': round(f['ground_floor_area'], 2),
               'windows': sum(1 for o in ops if o['kind'] == 'window'), 'doors': sum(1 for o in ops if o['kind'] == 'door'), 'tags': sorted({o['tag'] for o in ops}),
               'rooms': len(f['rooms']), 'byOrientation': by}
        import hashlib
        row['sig'] = hashlib.sha256(json.dumps({k: row[k] for k in ('floorArea', 'roof', 'ground', 'windows', 'doors', 'tags', 'byOrientation', 'height')}, sort_keys=True).encode()).hexdigest()[:12]
        floors.append(row)
    return {'floors': floors, 'issues': env.get('issues', []), 'schedule': {k: {kk: v.get(kk) for kk in ('width', 'height', 'opening', 'kind')} for k, v in env.get('schedule', {}).items()}}


def _energy_use(ov, legal):
    """도서의 주용도·연면적 — ② 법적 검토에서 판정에 쓴 값(용도 이름·주거+비주거 면적)을 먼저, 없으면 ① 개요."""
    nonres, res = _num(legal.get('nonResidentialAreaM2')), _num(legal.get('residentialAreaM2'))
    area = (nonres or 0) + (res or 0)
    return (_text(legal.get('useLabel'), 60) or _text(ov.get('mainUse'), 60) or '(입력 필요)', float(area) if area > 0 else _num(ov.get('gfa')))


def _energy_project(data, folder, file_name, env):
    ov = data.get('overview') or {}; e = _energy_settings(data); legal = data.get('energyPlan') or {}
    A = e.get('assemblies')
    if not isinstance(A, dict) or not all(k in A for k in ('W1', 'R1', 'F1', 'openings')): raise ValueError('⑤ 형별(외벽·지붕·바닥·창·문)을 넣으세요.')
    region = e.get('region') or region_of(ov.get('address'))
    if region not in ('central1', 'central2', 'south', 'jeju'): raise ValueError('② 지역(중부1·중부2·남부·제주)을 고르세요.')
    nonres, res = _num(legal.get('nonResidentialAreaM2')), _num(legal.get('residentialAreaM2'))
    main, gfa = _energy_use(ov, legal)
    if gfa is None: raise ValueError('① 연면적(㎡)을 넣으세요.')
    if res is None and nonres is None:   # 미리 초안(② 법적 검토 전): 주용도 글자로 — 주택만이면 주거, 근린·업무 등이 섞이면 비주거
        category = 'res' if re.search('주택|아파트|기숙사', main) and not re.search('근린|업무|판매|숙박|교육|의료', main) else 'nonres'
    else:
        category = 'res' if (res or 0) > (nonres or 0) else 'nonres'
    # 도서 양식(의무사항 표)은 비주거 EPI 건축 1번 점수를 쓴다 — 주거는 그 점수가 없어 KeyError 로 깨졌다
    if category == 'res': raise ValueError(f"주거 용도({main}) 에너지절약계획서 양식은 아직 없습니다(비주거 양식만 있음). 제출 대상인지 먼저 확인해 주세요.")
    defaults = _knowledge_json('energy_plan_defaults.json')
    project = {
        'schema': 'barun.energy.project/1',
        'project': {'name': _text(ov.get('name'), 60) or file_name, 'office': _text(ov.get('office'), 60) or '(입력 필요)', 'date': _text(ov.get('date'), 10),
                    'purpose': _text(ov.get('purpose'), 20) or '허가', 'work': {'new': '신축', 'rebuild': '재축', 'full_remodel': '전부 개축', 'annex': '별동 증축', 'extension': '증축',
                                                                              'use_change': '용도변경'}.get(legal.get('work'), '신축'), 'fileName': f"{file_name}_에너지절약계획서{'_초안' if data.get('draft') is True else ''}"},
        'owner': {'name': _text(ov.get('owner'), 60) or '(입력 필요)'},
        'source': {'dxf': str(Path(folder) / 'source.dxf'), 'frameNumber': _text(ov.get('frameNumber'), 20) or None},
        'regions': {'plans': _floors(data)},
        'originalSheets': {'plans': _text(ov.get('planSheets'), 40) or '-', 'elevations': _text(ov.get('elevationSheets'), 40) or '-',
                           'section': _text(ov.get('sectionSheet'), 40) or '-', 'windows': _text(ov.get('windowSheet'), 40) or '-'},
        'site': {'address': _text(ov.get('address'), 120) or '(입력 필요)', 'region': region, 'area': _num(ov.get('siteArea'))},
        'use': {'main': main, 'category': category, 'drawingUse': '', 'exempt': False},
        'gfa': gfa, 'public': legal.get('publicAgency') == 'yes', 'measuredArea': None,
        'section': e.get('section') or defaults['section'], 'shading': e.get('shading') or False, 'assumed': list(e.get('assumed') or []), 'notesOverride': {},
        'draft': data.get('draft') is True}   # 미리 초안(설계자 ⑥ 확정 전, 2026-10-30) — 장마다 '초안' 표시·파일 이름 '_초안'
    if e.get('thermalBridge'): project['thermalBridge'] = e['thermalBridge']
    sysd = e.get('systems') or {}
    systems = {'schema': 'barun.energy.systems/1', 'designers': {'mechanical': '(협력사 입력)', 'electrical': '(협력사 입력)'},
               'summary': {k: _text((sysd.get('summary') or {}).get(k), 120) or '(협력사 입력)' for k in ('mechanical', 'electrical', 'renewable')},
               'mandatoryBasis': {'mechanical': '설치예정확인서', 'electrical': '설치예정확인서'},
               'epi': [[x[0], int(x[1]), x[2], float(x[3]), x[4]] for x in sysd.get('epi') or [] if isinstance(x, list) and len(x) == 5]}
    pdir = Path(folder) / 'project'; pdir.mkdir(exist_ok=True)
    for n, v in (('project', project), ('assemblies', {'schema': 'barun.energy.assemblies/1', **A}), ('systems', systems),
                 ('details', {'schema': 'barun.energy.details/1', 'items': e.get('details') or defaults['details']}), ('envelope', env)):
        (pdir / f'{n}.json').write_text(json.dumps(v, ensure_ascii=False), encoding='utf-8')
    return pdir


def _energy(data):
    _tools()
    from energy_plan.book import Book
    out, name = _out_root(data, '에너지')
    with tempfile.TemporaryDirectory(prefix='barun_permit_') as tmp:
        if data.get('energyProject'):   # 예전 방식: 에너지 프로젝트 폴더를 직접
            project = Path(_text(data.get('energyProject'), 1000)).expanduser()
            if not (project / 'project.json').is_file(): raise ValueError('에너지 프로젝트 폴더(project.json·assemblies.json·systems.json·details.json·envelope.json)를 고르세요.')
            env = None
        else:
            env, _src = _envelope(data, tmp); project = _energy_project(data, tmp, name, env)
        out.mkdir(parents=True, exist_ok=True)
        b = Book(str(project)); dxf, summary = b.build(str(out))
        pdf = b.report(dxf, summary, tuple({q['kind'] for q in b.tpl['sheets'] if q.get('pdfColor')}), pdf=True)
    broken = (summary.get('sectionCheck') or {}).get('끊김', 0)
    pdf = _mark(pdf, summary['textOverflow'] or broken)
    _made.update({str(Path(dxf)), str(pdf), str(out)})
    saved = None
    if env is not None and data.get('saveEnvelope', True):   # ⑦ 결정: 도서 만들 때 외피 자료 자동 서버 저장(로그인돼 있을 때)
        try:
            import energy_envelope_service as svc
            got = svc.save(env, name=name, project=name, id=(data.get('energy') or {}).get('envelopeId') or None)
            saved = {'id': got.get('id'), 'ok': True}
        except Exception as error:   # 로그인 안 함·오프라인: 도서는 그대로, 저장만 못 함
            saved = {'ok': False, 'error': str(error)[:200]}
    return {'dxf': str(dxf), 'pdf': str(pdf), 'folder': str(out), 'sheets': summary['sheets'], 'calc': summary.get('calc'),
            'sectionCheck': summary.get('sectionCheck'), 'textOverflow': summary['textOverflow'], 'sheetScale': summary['sheetScale'],
            'assumed': bool(b.project.get('assumed')), 'draft': bool(b.project.get('draft')), 'envelopeSaved': saved, 'templatesVersion': b.tpl.get('version')}


def _energy_envelope(data):
    with tempfile.TemporaryDirectory(prefix='barun_permit_') as tmp:
        env, _src = _envelope(data, tmp)
    return envelope_summary(env)


def _profiles():
    _tools()
    from plan_book.base import knowledge
    pr = json.loads(knowledge('country/kor/details/access.json'))['planRules']
    return {'profiles': [{'id': p['id'], 'name': p['name'], 'conditions': [c['field'] for c in p.get('conditions', [])]} for p in pr['profiles']]}


def _open(data):
    path = _text(data.get('path'), 1000)
    if path not in _made: raise ValueError('이 창에서 만든 도서만 열 수 있습니다.')
    if sys.platform == 'darwin': subprocess.Popen(['open', path])
    elif os.name == 'nt': os.startfile(path)   # noqa: S606 — 이 실행에서 만든 결과 파일만
    else: subprocess.Popen(['xdg-open', path])
    return {'ok': True}


def process(data):
    if not isinstance(data, dict) or data.get('action') not in ACTIONS: raise ValueError('인허가 도서 요청이 올바르지 않습니다.')
    a = data['action']
    if a == 'access-profiles': return _profiles()
    if a == 'access-review': return _access(data, build=False)
    if a == 'access-build': return _access(data, build=True)
    if a == 'energy-build': return _energy(data)
    if a == 'energy-envelope': return _energy_envelope(data)
    if a == 'energy-region':
        r = region_of((data.get('overview') or {}).get('address'))
        return {'region': r, 'label': _knowledge_json('energy_envelope_standards.json')['regions'][r]['label'] if r else None}
    if a == 'energy-defaults': return _knowledge_json('energy_plan_defaults.json')
    return _open(data)
