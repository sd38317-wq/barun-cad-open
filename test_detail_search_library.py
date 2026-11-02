import base64
import copy
from unittest.mock import patch
import pytest
import bridge
import cad_asset_client as client
import detail_search_library as details

CATALOG = [
    {'kind': 'detail', 'id': 'FLOOR-072', 'name': '온돌 바닥', 'ids': {'1': ['FLOOR-072'], '2': ['FLOOR-074']},
     'scenes': [{'n': 1, 'title': '온돌 단면', 'scale': 10}, {'n': 2, 'title': '온돌 확대', 'scale': 5}], 'has_glb': True},
    {'kind': 'unit', 'id': 'UN-84', 'name': '84㎡ 독립 세대', 'ids': {'1': ['UN-84']},
     'scenes': [{'n': 1, 'title': '평면', 'scale': 100}], 'has_glb': False},
    {'kind': 'jutong', 'id': 'JT-A', 'name': '판상형 주동', 'ids': {'1': ['JT-A']},
     'scenes': [{'n': 1, 'title': '주동 평면', 'scale': 100}], 'has_glb': False},
]
REAL_SIGNED_IN = client.signed_in
ASSETS = {}
for row in CATALOG:
    layer = 'A-WALL' if row['kind'] == 'unit' else 'A-BLDG-L1' if row['kind'] == 'jutong' else 'A-WALL-CONC'
    ASSETS[row['id']] = {**copy.deepcopy(row), 'format': 'barun-asset/1', 'version': '2026-10-13',
        'meta': {'assumed': [], 'to_confirm': [], 'source_note': '서버 고정 자료', 'same_as': None},
        'glb': base64.b64encode(b'glTF-server-fixture').decode(), 'wm_points': 4,
        'scenes': [{'n': 1, 'title': row['name'], 'scale': row['scenes'][0]['scale'], 'bounds': [0, 0, 8400, 9000],
            'entities': [{'id': 'original', 'type': 'line', 'layer': layer,
                'points': [{'x': 0.004, 'y': -0.004}, {'x': 8400.004, 'y': 8999.996}],
                'xdata': {'BARUN_WM': ['barun-asset/1', row['kind'], row['id'], 'abcdef123456']}}]}]}


@pytest.fixture(autouse=True)
def server(monkeypatch):
    # No real account token or external connection is consulted by these tests.
    monkeypatch.setattr(client, 'catalog', lambda kind=None: copy.deepcopy([row for row in CATALOG if kind is None or row['kind'] == kind]))
    monkeypatch.setattr(client, 'get_asset', lambda kind, identifier: copy.deepcopy(ASSETS[identifier]))
    monkeypatch.setattr(client, '_account_token', lambda: (_ for _ in ()).throw(AssertionError('real token consulted')))
    monkeypatch.setattr(client, 'signed_in', lambda: False)


def test_exact_server_catalog_contract_is_lazy_and_ignores_local_paths(tmp_path):
    with patch.object(client, 'get_asset', side_effect=AssertionError('listing downloaded geometry')):
        result = details.load_library(tmp_path)
        assert result['status'] == 'ok' and result['root'] == 'server'
        assert [row['kind'] for row in result['items']] == ['detail', 'unit', 'jutong']
        assert result['items'][0]['has_glb'] is True
        assert 'geometry' not in result['items'][0]
        assert details.get_library_detail('FLOOR-074')['detail']['id'] == 'FLOOR-072'
        assert details.search_library_details('온 돌', '바닥')['count'] == 1
        assert details.search_units({'query': '84㎡'})['count'] == 1
        assert details.search_jutong({'query': '판상'})['count'] == 1


@pytest.mark.parametrize('kind', ['detail', 'unit', 'jutong'])
def test_explicit_geometry_preserves_actual_mm_marks_and_does_not_import_disk(kind):
    row = next(row for row in CATALOG if row['kind'] == kind)
    with patch.object(client, 'get_asset', wraps=client.get_asset) as fetched:
        result = details.get_library_detail(row['id'], include_geometry=True, importer=lambda *args: pytest.fail('local DXF read'))
    fetched.assert_called_once_with(kind, row['id'])
    assert result['geometry']['units'] == 'mm'
    assert result['geometry']['entities'] == ASSETS[row['id']]['scenes'][0]['entities']
    assert result['geometry']['layers'][0]['name'] == result['geometry']['entities'][0]['layer']
    result['geometry']['entities'][0]['points'][0]['x'] = 0
    assert ASSETS[row['id']]['scenes'][0]['entities'][0]['points'][0]['x'] == 0.004
    if kind != 'detail':
        assert result['detail']['scale_verified'] is True
        assert result['detail']['usable_as_' + kind] is True


@pytest.mark.parametrize('code', ['not_logged_in', 'limit', 'offline'])
def test_missing_account_limit_offline_guide_without_local_fallback(code):
    with patch.object(client, 'catalog', side_effect=client.CadAssetError(code)), patch('lh_detail_library.search_details', side_effect=AssertionError('local LH fallback')):
        result = details.catalog()
        assert result['library'] == [] and result['code'] == code
        assert result['libraryStatus'] == 'unavailable' and result['libraryMessage']
        assert details.search_units()['code'] == code
        assert details.get_jutong('JT-A', True)['code'] == code
    with patch.object(client, 'get_asset', side_effect=client.CadAssetError(code)):
        result = details.get_library_detail('FLOOR-072', include_geometry=True)
        assert result['status'] == 'unavailable' and result['code'] == code


def test_glb_preview_is_server_base64_in_memory():
    with patch.object(client, 'get_asset', wraps=client.get_asset) as fetched:
        assert details.preview('FLOOR-072', format='glb') == b'glTF-server-fixture'
    fetched.assert_called_once_with('detail', 'FLOOR-072')
    for args in ({}, {'format': 'png'}, {'source': 'lh2017', 'format': 'glb'}):
        with pytest.raises(ValueError):
            details.preview('FLOOR-072', **args)
    with pytest.raises(ValueError, match='서버 자산'):
        details.connect('D:/local/details')


@pytest.mark.parametrize('name,identifier', [('cad_insert_detail', 'FLOOR-072'), ('cad_insert_unit', 'UN-84'), ('cad_insert_jutong', 'JT-A')])
@patch('miri_account_service.require_ai_login', new=lambda: None)
def test_mcp_insertion_dispatches_server_entities_with_marks(name, identifier):
    with patch.object(bridge, 'validate_target'), patch.object(bridge, 'dispatch', side_effect=lambda name, args: {'name': name, 'args': args}), patch('unit_library.get_unit', side_effect=AssertionError('local unit read')), patch('jutong_library.get_jutong', side_effect=AssertionError('local jutong read')):
        response = bridge.call(name, {'id': identifier, 'position': {'x': 0, 'y': 0}, 'target': {}})
    assert response['name'] == name
    assert response['args']['detail']['geometry']['entities'] == ASSETS[identifier]['scenes'][0]['entities']


@pytest.mark.parametrize('name,args,key', [('cad_search_units', {}, 'units'), ('cad_search_jutong', {}, 'details'), ('cad_search_details', {'source': 'lh2025'}, 'details'), ('cad_list_details', {}, 'details')])
@patch('miri_account_service.require_ai_login', new=lambda: None)
def test_all_mcp_searches_use_server_catalog(name, args, key):
    with patch('unit_library.search_units', side_effect=AssertionError('local unit list')), patch('jutong_library.search_jutong', side_effect=AssertionError('local jutong list')), patch('lh_detail_library.search_details', side_effect=AssertionError('local LH list')):
        result = bridge.call(name, args)
    assert result['status'] == 'ok' and result[key]


def test_minimal_catalog_does_not_pretend_optional_filter_metadata_exists():
    units = details.search_units({'area_min': 80})
    assert units['code'] == 'filter_metadata_unavailable'
    assert units['missing_fields'] == ['exclusive_area_m2']
    jutong = details.search_jutong({'units_per_floor': 4})
    assert jutong['code'] == 'filter_metadata_unavailable' and jutong['message']


def test_optional_filter_metadata_remains_useful_without_asset_download():
    unit = {**CATALOG[1], 'exclusive_area_m2': 84, 'bays': 4, 'rooms': 3, 'bathrooms': 2, 'core_form': '계단형'}
    jutong = {**CATALOG[2], 'combination': '84+84', 'units_per_floor': 4, 'width_mm': 30000, 'depth_mm': 10000}
    with patch.object(client, 'catalog', side_effect=lambda kind=None: [unit] if kind == 'unit' else [jutong]), patch.object(client, 'get_asset', side_effect=AssertionError('filter downloaded geometry')):
        assert details.search_units({'area_min': 80, 'area_max': 85, 'rooms': 3})['count'] == 1
        assert details.search_jutong({'combination': '84', 'units_per_floor': 4, 'min_width_mm': 29000})['count'] == 1


@pytest.mark.parametrize('tool,field,key,index', [('cad_search_units', 'bays', 'units', 1), ('cad_search_jutong', 'units_per_floor', 'details', 2)])
@patch('miri_account_service.require_ai_login', new=lambda: None)
def test_unit_and_jutong_filters_use_values_when_some_catalog_rows_omit_them(tool, field, key, index):
    known = {**CATALOG[index], field: 4}
    with patch.object(client, 'catalog', return_value=[known, CATALOG[index], {**known, field: 3}]), patch.object(client, 'get_asset', side_effect=AssertionError('filter downloaded geometry')):
        result = bridge.call(tool, {field: 4})
    assert result['status'] == 'ok' and result['count'] == 1
    assert [row[field] for row in result[key]] == [4]


@pytest.mark.parametrize('args', [{'rooms': True}, {'area_min': float('nan')}, {'area_min': 90, 'area_max': 80}])
def test_unit_search_validates_filters(args):
    with pytest.raises(ValueError):
        details.search_units(args)


@pytest.mark.parametrize('name,identifier', [('cad_insert_unit', 'UN-84'), ('cad_insert_jutong', 'JT-A'), ('cad_insert_detail', 'FLOOR-072')])
@patch('miri_account_service.require_ai_login', new=lambda: None)
def test_mcp_readonly_insert_rejected_before_server_asset_read(name, identifier):
    with patch.object(client, 'get_asset', side_effect=AssertionError('read before authorization')):
        with pytest.raises(ValueError):
            bridge.call(name, {'id': identifier, 'target': {}}, allow_edit=False)

@patch('miri_account_service.require_ai_login', new=lambda: None)
def test_generator_detail_listing_does_not_offer_unit_jutong_ids():
    result = bridge.call('cad_list_details', {})
    assert [item['id'] for item in result['details']] == ['FLOOR-072']
    assert result['count'] == 1

def test_steel_details_land_in_steel_folder():
    # 2026-10-27: 서버 철골 상세는 id 가 ST-… 이고 group 이 없어 '실내'로 떨어져, 상세 찾기 '철골' 폴더가 0개였다.
    assert details._group({'kind': 'detail', 'id': 'ST-178df26e1c0f4239-001'}) == 'steel'
    assert details._group({'kind': 'detail', 'id': 'STAIR-01'}) == 'stair'
    assert details._group({'kind': 'detail', 'id': 'INTERIOR-001'}) == 'interior'


def test_catalog_tells_panel_whether_account_is_signed_in(monkeypatch):
    # 목록은 로그인 없이도 미리보기 사본으로 'ok' 가 와서, 창이 로그인된 상태에서도 '넣으려면 로그인'을 띄웠다(10-28).
    assert details.catalog()['signedIn'] is False
    monkeypatch.setattr(client, 'signed_in', lambda: True)
    assert details.catalog()['signedIn'] is True
    for token, expected in (('token', True), ('', False), (None, False)):
        monkeypatch.setattr(client._client, '_token_reader', lambda: token)
        assert REAL_SIGNED_IN() is expected
