"""On-demand unit apartment catalog; insertion geometry is verified millimetres."""
import json
import math
import os
from pathlib import Path

DEFAULT_ROOT = r'D:\어플\설계엔진\평면자산\단위세대'


def library_root():
    return Path(os.environ.get('BARUN_UNIT_LIBRARY') or DEFAULT_ROOT).resolve()


def _rows(data):
    # Canonical catalogs use units='mm'; legacy unit lists used the same key.
    return data.get('details') if isinstance(data.get('details'), list) else data.get('units')


def _catalog():
    root = library_root()
    index = root / 'index.json'
    if not index.is_file():
        return root, None
    data = json.loads(index.read_text(encoding='utf-8'))
    if not isinstance(data, dict) or not isinstance(_rows(data), list):
        raise ValueError('단위세대 index.json 형식이 올바르지 않습니다.')
    return root, data


def _safe(root, relative):
    target = (root / relative).resolve()
    if not target.is_relative_to(root):
        raise ValueError('라이브러리 경로가 자료 폴더를 벗어납니다.')
    return target


def _unavailable():
    return {'status': 'unavailable', 'message': '단위세대 라이브러리 없음', 'units': [], 'details': []}


def search_units(args=None):
    if args is None:
        args = {}
    if not isinstance(args, dict):
        raise ValueError('검색 조건은 객체여야 합니다.')
    query = args.get('query', '')
    core = args.get('core_form', '')
    if not isinstance(query, str) or not isinstance(core, str):
        raise ValueError('검색어와 코어 형식은 문자열이어야 합니다.')

    def number(key, integer=False):
        value = args.get(key)
        if value is None:
            return None
        if type(value) not in (int, float) or not math.isfinite(value) or value < 0 or (integer and type(value) is not int):
            raise ValueError(f'{key}는 유한한 음이 아닌 숫자여야 합니다.')
        return value

    area_min, area_max = number('area_min'), number('area_max')
    if area_min is not None and area_max is not None and area_min > area_max:
        raise ValueError('면적 범위가 잘못되었습니다.')
    bays, rooms, bathrooms = number('bays'), number('rooms', True), number('bathrooms', True)
    root, data = _catalog()
    if data is None:
        return _unavailable()
    rows = []
    for row in _rows(data):
        if not isinstance(row, dict) or not str(row.get('id', '')).startswith('UN-'):
            continue
        area = row.get('exclusive_area_m2')
        if area_min is not None and (type(area) not in (int, float) or not math.isfinite(area) or area < area_min):
            continue
        if area_max is not None and (type(area) not in (int, float) or not math.isfinite(area) or area > area_max):
            continue
        if any(value is not None and row.get(key) != value for key, value in (('bays', bays), ('rooms', rooms), ('bathrooms', bathrooms))):
            continue
        if core and row.get('core_form') != core:
            continue
        haystack = ' '.join(str(row.get(key, '')) for key in ('id', 'name', 'type_name', 'exclusive_area_m2', 'core_form')).casefold()
        if not all(word in haystack for word in query.casefold().split()):
            continue
        rows.append(dict(row))
    return {'status': 'ok', 'count': len(rows), 'units': rows, 'details': rows}


def get_unit(identifier, include_geometry=False):
    if not isinstance(include_geometry, bool):
        raise ValueError('include_geometry는 boolean이어야 합니다.')
    if not isinstance(identifier, str) or not identifier.startswith('UN-'):
        raise ValueError('단위세대 ID가 필요합니다.')
    root, data = _catalog()
    if data is None:
        return _unavailable()
    row = next((dict(row) for row in _rows(data) if row.get('id') == identifier), None)
    if row is None:
        return {'status': 'not_found', 'message': '단위세대를 찾을 수 없습니다.', 'id': identifier}
    result = {'status': 'ok', 'unit': row, 'detail': row}
    if include_geometry:
        if row.get('usable_as_unit') is not True:
            return {**result, 'status': 'unavailable', 'message': '독립 단위세대 분리 범위 확인 필요'}
        if row.get('scale_verified') is not True:
            return {**result, 'status': 'unavailable', 'message': '축척 확인 필요'}
        relative = row.get('detail_path') or row.get('geometry_path')
        target = _safe(root, relative) if isinstance(relative, str) and relative else None
        if target is None or target.suffix.lower() != '.json' or not target.is_file():
            return {**result, 'status': 'unavailable', 'message': '단위세대 기하 자료 없음'}
        payload = json.loads(target.read_text(encoding='utf-8'))
        geometry = payload.get('geometry', payload) if isinstance(payload, dict) else None
        if not isinstance(geometry, dict) or geometry.get('units') != 'mm' or not isinstance(geometry.get('layers'), list) or not geometry['layers'] or not isinstance(geometry.get('entities'), list) or not geometry['entities']:
            return {**result, 'status': 'unavailable', 'message': '실제 mm 기하 자료가 올바르지 않습니다.'}
        result['geometry'] = geometry
    return result
