"""Lazy server catalog and in-memory CAD asset adapters for search and insertion.

Original offline libraries remain tooling inputs; application search never reads them.
"""
import base64
import copy
import json
import math
import unicodedata
from asset_preview import source_decisions
from functools import lru_cache

GROUPS = {'기본': 'basic', '외벽': 'wall', '벽체': 'wall', '창호': 'window', '바닥': 'floor',
          '지붕': 'roof', '계단': 'stair', '방화': 'fire', '주차장': 'parking',
          '주차': 'parking', '편의시설': 'access', '접근성': 'access',
          '실내': 'interior', '철골': 'steel', '주동': 'jutong', '단위세대': 'unit'}
MESSAGES = {'not_logged_in': '로그인 필요 · 계정 연결 후 서버 자산을 사용할 수 있습니다.',
            'limit': '오늘 서버 자산 사용 한도에 도달했습니다. 내일 다시 이용하세요.',
            'offline': '로그인 필요 · 서버 연결을 확인한 뒤 다시 이용하세요.',
            'not_found': '서버 자산이 아직 없습니다. 작성 예정 자료입니다.'}


def _normalize(value):
    return ''.join(unicodedata.normalize('NFKC', str(value)).casefold().split())


def _failure(error, **extra):
    return {'status': 'unavailable', 'code': error.code,
            'message': MESSAGES.get(error.code, error.message), **extra}


def _group(item):
    if item.get('kind') in ('unit', 'jutong'):
        return item['kind']
    group = item.get('group')
    if group:
        return GROUPS.get(group, group)
    prefix = str(item.get('id', '')).split('-')[0].lower()
    prefix = {'st': 'steel'}.get(prefix, prefix)   # 서버 철골 상세 id 는 ST-… (group 없음)
    return prefix if prefix in GROUPS.values() else 'interior'


@lru_cache(maxsize=1)
def _dropped():
    return {k for k, v in source_decisions().items() if v.get('결정') == 'drop'}


def _item(row):
    # Catalogs contain metadata only. Do not accidentally expose geometry or GLB.
    item = {key: copy.deepcopy(value) for key, value in row.items()
            if key not in ('geometry', 'entities', 'glb', 'layers')}
    item['scenes'] = [{key: copy.deepcopy(value) for key, value in scene.items() if key in ('n', 'title', 'scale')} for scene in row.get('scenes', []) if isinstance(scene, dict)]
    item['thumb_url'] = '/api/cad-asset/thumb/' + row['kind'] + '/' + row['id']
    if row.get('thumb3d'):
        item['thumb3d_url'] = '/api/cad-asset/thumb3d/' + row['kind'] + '/' + row['id']
    item.update(source='library', source_name='바른 표준', group=_group(row),
                insertion_allowed=True, units='mm', server_asset=True)
    if item.get('kind') in ('unit', 'jutong'):
        item.update(scale_verified=True, **{'usable_as_' + item['kind']: True})
    return item


def load_library(root=None, kind=None):
    # root is kept solely for old callers; local paths never change the source.
    import cad_asset_client as client
    try:
        rows = client.catalog(kind)
    except client.CadAssetError as error:
        return _failure(error, items=[], root='server')
    return {'status': 'ok', 'root': 'server', 'items': [_item(row) for row in rows
            if isinstance(row, dict) and row.get('kind') in ('detail', 'unit', 'jutong') and row.get('id') not in _dropped()]}


def connect(value):
    raise ValueError('상세·동평면·주동은 서버 자산입니다. 계정 연결 후 이용하세요.')


def search_library_details(query='', classification='', facility='', root=None):
    if not all(isinstance(value, str) for value in (query, classification, facility)):
        raise ValueError('상세 검색어·분류·시설은 문자열이어야 합니다.')
    library = load_library(root)
    q, category, wanted_facility = map(_normalize, (query, classification, facility))
    primary, _, secondary = category.partition('/')
    group = GROUPS.get(primary, primary if primary in GROUPS.values() else '')
    def matches(item):
        text = _normalize(json.dumps(item, ensure_ascii=False))
        if q and q not in text:
            return False
        if group and item['group'] != group:
            return False
        if secondary and secondary not in text:
            return False
        if category and not group and category not in text:
            return False
        return not wanted_facility or wanted_facility in text
    rows = [item for item in library['items'] if matches(item)]
    return {key: value for key, value in library.items() if key != 'items'} | {'count': len(rows), 'details': rows}


def asset_geometry(asset):
    """Build a DOCUMENT without changing millimetre coordinates or server marks."""
    layers, entities = {}, []
    for layer in asset.get('layers', []):
        if isinstance(layer, dict) and isinstance(layer.get('id'), str):
            layers[layer['id']] = copy.deepcopy(layer)
    def visit(entity):
        if not isinstance(entity, dict) or not isinstance(entity.get('layer'), str) or not entity['layer']:
            raise ValueError('서버 자산 객체의 레이어가 올바르지 않습니다.')
        identifier = entity['layer']
        layers.setdefault(identifier, {'id': identifier, 'name': entity.get('layerName') or identifier,
            'color': '#ffffff', 'visible': True, 'locked': False, 'frozen': False,
            'plot': True, 'lineweight': 0.18, 'linetype': 'CONTINUOUS'})
        for key in ('entities', 'children'):
            for child in entity.get(key, []):
                visit(child)
    for scene in asset.get('scenes', []):
        for layer in scene.get('layers', []):
            if isinstance(layer, dict) and isinstance(layer.get('id'), str):
                layers[layer['id']] = copy.deepcopy(layer)
        for entity in scene.get('entities', []):
            visit(entity)
            entities.append(copy.deepcopy(entity))
    if not entities:
        raise ValueError('서버 자산에 실제 mm 기하가 없습니다.')
    return {'units': 'mm', 'layers': list(layers.values()), 'entities': entities}


def get_library_detail(identifier, root=None, include_geometry=False, importer=None, kind=None):
    if not isinstance(identifier, str) or not identifier:
        raise ValueError('서버 자산 ID가 필요합니다.')
    if not isinstance(include_geometry, bool):
        raise ValueError('include_geometry는 boolean이어야 합니다.')
    library = load_library(kind=kind)
    if library['status'] != 'ok':
        return {key: value for key, value in library.items() if key not in ('items', 'root')}
    item = next((row for row in library['items'] if row['id'] == identifier or
                 any(identifier in ids for ids in row.get('ids', {}).values() if isinstance(ids, list))), None)
    if item is None:
        return {'status': 'not_found', 'code': 'not_found', 'message': MESSAGES['not_found']}
    result = {'status': 'ok', 'detail': item}
    if include_geometry:
        import cad_asset_client as client
        try:
            asset = client.get_asset(item['kind'], item['id'])
            result['geometry'] = asset_geometry(asset)
        except client.CadAssetError as error:
            return _failure(error, detail=item)
        # Do not retain raw geometry in metadata; insertion receives it separately.
        result['detail'] = {**copy.deepcopy(asset.get('meta', {})), **item}
        # 자산은 장면 제목 글자를 빼고 n·title·scale 만 남긴다: 넣을 때 장면마다 제목을 다시 쓰도록 장면 범위도 함께 준다(10-25).
        scenes = [{'n': s.get('n'), 'title': s.get('title'), 'scale': s.get('scale'), 'bounds': list(s['bounds'])}
                  for s in asset.get('scenes', []) if isinstance(s, dict) and isinstance(s.get('bounds'), list) and len(s['bounds']) == 4]
        if scenes:
            result['detail']['scenes'] = scenes
    if item['kind'] == 'unit':
        result['unit'] = result['detail']
    return result


def get_unit(identifier, include_geometry=False):
    return get_library_detail(identifier, include_geometry=include_geometry, kind='unit')


def get_jutong(identifier, include_geometry=False):
    return get_library_detail(identifier, include_geometry=include_geometry, kind='jutong')


def _number(args, key, integer=False, positive=False):
    value = args.get(key)
    if value is None:
        return None
    if type(value) not in (int, float) or not math.isfinite(value) or value < 0 or (integer and type(value) is not int) or (positive and value == 0):
        raise ValueError(key + ' 검색 조건을 확인하세요.')
    return value


def _filter_metadata(library, fields, **extra):
    missing = sorted(field for field in fields if library['items'] and all(item.get(field) is None for item in library['items']))
    if missing and library['status'] == 'ok':
        return {'status': 'unavailable', 'code': 'filter_metadata_unavailable', 'count': 0,
                'message': '서버 목록에 해당 검색 조건 정보가 없습니다. 이름으로 검색하세요.',
                'missing_fields': missing, 'details': [], **extra}
    return None


def search_units(args=None):
    args = {} if args is None else args
    if not isinstance(args, dict):
        raise ValueError('검색 조건은 객체여야 합니다.')
    query, core = args.get('query', ''), args.get('core_form', '')
    if not isinstance(query, str) or not isinstance(core, str):
        raise ValueError('검색어와 코어 형식은 문자열이어야 합니다.')
    lower, upper = _number(args, 'area_min'), _number(args, 'area_max')
    if lower is not None and upper is not None and lower > upper:
        raise ValueError('면적 범위가 잘못되었습니다.')
    values = {key: _number(args, key, key != 'bays') for key in ('bays', 'rooms', 'bathrooms')}
    library = load_library(kind='unit')
    fields = [key for key, value in values.items() if value is not None]
    if lower is not None or upper is not None:
        fields.append('exclusive_area_m2')
    if core:
        fields.append('core_form')
    unavailable = _filter_metadata(library, fields, units=[])
    if unavailable:
        return unavailable
    def matches(item):
        area = item.get('exclusive_area_m2')
        if lower is not None and (type(area) not in (int, float) or area < lower):
            return False
        if upper is not None and (type(area) not in (int, float) or area > upper):
            return False
        if any(value is not None and item.get(key) != value for key, value in values.items()):
            return False
        text = json.dumps(item, ensure_ascii=False).casefold()
        return (not core or item.get('core_form') == core) and all(word in text for word in query.casefold().split())
    rows = [item for item in library['items'] if matches(item)]
    return {key: value for key, value in library.items() if key not in ('items', 'root')} | {'count': len(rows), 'units': rows, 'details': rows}


def search_jutong(args=None, **kwargs):
    if args is not None and not isinstance(args, dict):
        raise ValueError('검색 조건은 객체여야 합니다.')
    args = {**(args or {}), **kwargs}
    strings = {key: args.get(key, '') for key in ('query', 'combination', 'form', 'unit_type')}
    if not all(isinstance(value, str) for value in strings.values()):
        raise ValueError('주동 검색 조건은 문자열이어야 합니다.')
    count = _number(args, 'units_per_floor', True, True)
    ranges = {field: (_number(args, 'min_' + field), _number(args, 'max_' + field)) for field in ('width_mm', 'depth_mm')}
    if any(lo is not None and hi is not None and lo > hi for lo, hi in ranges.values()):
        raise ValueError('최소 크기가 최대 크기보다 큽니다.')
    library = load_library(kind='jutong')
    fields = [key for key, value in strings.items() if value and key != 'query']
    if 'unit_type' in fields:
        fields[fields.index('unit_type')] = 'unit_types'
    if count is not None:
        fields.append('units_per_floor')
    fields.extend(field for field, bounds in ranges.items() if any(value is not None for value in bounds))
    unavailable = _filter_metadata(library, fields)
    if unavailable:
        return unavailable
    def matches(item):
        text = json.dumps(item, ensure_ascii=False).casefold()
        if not all(word in text for word in strings['query'].casefold().split()):
            return False
        if any(value and value.casefold() not in str(item.get(key, '')).casefold() for key, value in strings.items() if key in ('form', 'combination')):
            return False
        if count is not None and item.get('units_per_floor') != count:
            return False
        if strings['unit_type'] and not any(str(value.get('type', '')).casefold() == strings['unit_type'].casefold() for value in item.get('unit_types', [])):
            return False
        for field, (lo, hi) in ranges.items():
            value = item.get(field)
            if lo is not None and (type(value) not in (int, float) or value < lo) or hi is not None and (type(value) not in (int, float) or value > hi):
                return False
        return True
    rows = [item for item in library['items'] if matches(item)]
    return {key: value for key, value in library.items() if key not in ('items', 'root')} | {'count': len(rows), 'details': rows}


def catalog():
    import cad_asset_client as client
    library = load_library()
    return {'status': library['status'], 'knowledge': {}, 'knowledgeError': '', 'signedIn': client.signed_in(),
            'lh': [], 'lhStatus': 'server', 'library': library['items'],
            'libraryStatus': library['status'], 'libraryMessage': library.get('message', ''),
            'libraryRoot': 'server', **({'code': library['code']} if library.get('code') else {})}


def preview(identifier, source='library', format='png'):
    if format != 'glb':
        raise ValueError('2D 미리보기는 상세를 선택하면 서버 자산으로 표시합니다.')
    if source != 'library':
        raise ValueError('서버 상세만 3D 미리보기를 지원합니다.')
    import cad_asset_client as client
    asset = client.get_asset('detail', identifier)
    data = asset.get('glb')
    if not isinstance(data, str) or not data:
        raise ValueError('3D 미리보기 없음')
    try:
        return base64.b64decode(data, validate=True)
    except (ValueError, TypeError) as error:
        raise ValueError('서버 3D 자료가 올바르지 않습니다.') from error


def process(data):
    action = data.get('action', 'catalog')
    if action == 'catalog':
        return catalog()
    if action == 'connect':
        return connect(data.get('path'))
    if action == 'get':
        return get_library_detail(data.get('id'), include_geometry=data.get('include_geometry', False), kind=data.get('kind'))
    raise ValueError('상세 모음 작업이 없습니다.')
