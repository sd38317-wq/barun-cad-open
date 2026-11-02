import gzip
import json

import pytest

import bridge
import lh_detail_library as library


@pytest.fixture
def libraries(tmp_path, monkeypatch):
    roots = {source: tmp_path / source for source in library.SOURCES}
    for variable, source in [('BARUN_LH_2025', 'lh2025'), ('BARUN_LH_DETAILS', 'lh2017'), ('BARUN_LA_DETAILS', 'la'), ('BARUN_STEEL_DETAILS', 'steel')]:
        monkeypatch.setenv(variable, str(roots[source]))
    monkeypatch.delenv('BARUN_LH2017_DETAILS', raising=False)
    for root in roots.values():
        root.mkdir()
    return roots


def save(root, rows, **metadata):
    (root / 'catalog.json').write_text(json.dumps({'details': rows, **metadata}), encoding='utf-8')


def detail(identifier, **metadata):
    return {'id': identifier, 'kind': 'detail', 'drawing_id': 'DA-10-001', 'title': '벽 단면',
            'opening_status': 'ok', **metadata}


def test_four_sources_read_gzip_and_keep_detail_metadata(libraries):
    for source, root in libraries.items():
        row = detail(source, detail_path='detail.json.gz', notes=['T20 단열재'], parent='parent-id',
                     callouts=[{'detail_id': 'child-id'}], revision={'date': '2025-01-01'},
                     bounds={'minX': 0, 'minY': 0, 'maxX': 10, 'maxY': 20})
        save(root, [row])
        with gzip.open(root / 'detail.json.gz', 'wt', encoding='utf-8') as stream:
            json.dump({'geometry': {'units': 'mm', 'entities': [], 'marker': source}}, stream)
        result = bridge.call('cad_get_detail', {'id': source, 'source': source, 'include_geometry': True})
        assert result['geometry']['marker'] == source
        assert result['detail']['notes'] == ['T20 단열재']
        assert result['detail']['parent'] == 'parent-id'
        assert result['detail']['callouts'] == [{'detail_id': 'child-id'}]
        assert result['revision']['date'] == '2025-01-01'
    assert [row['source'] for row in library.search_details()['details']] == list(library.SOURCES)
    assert library.get_detail('DA-10-001')['status'] == 'ambiguous'
    assert library.get_detail('DA-10-001', source='la')['detail']['id'] == 'la'


def test_mixed_catalog_never_exposes_or_inserts_sheet(libraries, monkeypatch):
    sheet = {'id': 'sheet', 'kind': 'sheet', 'drawing_id': 'DA-10-999', 'opening_status': 'ok', 'detail_path': 'sheet.json'}
    for root in libraries.values():
        save(root, [sheet, detail('actual')], sheets=[sheet], history=[sheet], unavailable_sheets=[sheet])
        (root / 'sheet.json').write_text(json.dumps({'geometry': {'entities': []}}), encoding='utf-8')
    assert library.search_details()['count'] == 4
    assert library.get_detail('sheet', True)['status'] == 'not_found'
    assert library.get_detail('DA-10-999')['status'] == 'not_found'
    monkeypatch.setattr(bridge, 'validate_target', lambda value: value)
    monkeypatch.setattr(bridge, 'dispatch', lambda *args: pytest.fail('sheet dispatched'))
    assert bridge.call('cad_insert_detail', {'id': 'sheet', 'target': {}, 'source': 'la'})['status'] == 'not_found'
    tools = {tool['name']: tool for tool in bridge.TOOLS}
    assert 'kind' not in tools['cad_search_details']['inputSchema']['properties']
    for kind in ('sheet', 'all'):
        with pytest.raises(ValueError):
            bridge.call('cad_search_details', {'kind': kind})


def test_only_explicit_superseded_details_are_hidden(libraries):
    save(libraries['lh2025'], [detail('new', legacy_versions=[{'id': 'old', 'source': 'lh2017'}])])
    save(libraries['lh2017'], [detail('old', superseded_by={'id': 'new', 'source': 'lh2025'}), detail('old-only')])
    save(libraries['la'], [])
    result = library.search_details()
    assert [row['id'] for row in result['details']] == ['new', 'old-only']
    assert result['details'][0]['legacy_versions'] == [{'id': 'old', 'source': 'lh2017'}]
    assert library.get_detail('old')['status'] == 'not_found'
    assert library.get_detail('old-only')['status'] == 'ok'
    assert library.get_detail('DA-10-001')['status'] == 'ambiguous'


def test_scoped_drawing_number_is_ambiguous_for_multiple_subdetails(libraries):
    save(libraries['lh2025'], [detail('first', parent='sheet-id'), detail('second', parent='sheet-id')])
    assert library.get_detail('DA-10-001', source='lh2025')['status'] == 'ambiguous'
    assert library.get_detail('first', source='lh2025')['status'] == 'ok'


def test_custom_legacy_fixture_does_not_scan_default_other_libraries(tmp_path, monkeypatch):
    old = tmp_path / 'old'; old.mkdir()
    new = tmp_path / 'new'; new.mkdir()
    la = tmp_path / 'la'; la.mkdir()
    monkeypatch.setenv('BARUN_LH_DETAILS', str(old))
    for variable in ('BARUN_LH_2025', 'BARUN_LA_DETAILS', 'BARUN_LH2017_DETAILS'):
        monkeypatch.delenv(variable, raising=False)
    monkeypatch.setattr(library, 'DEFAULT_2025_ROOT', str(new))
    monkeypatch.setattr(library, 'DEFAULT_LA_ROOT', str(la))
    save(old, [detail('old')]); save(new, [detail('new')]); save(la, [detail('la')])
    assert [row['id'] for row in library.search_details()['details']] == ['old']
    assert library.library_2025_root() == new.resolve()


def test_steel_classification_search_and_review_metadata(libraries):
    row = detail('steel-1', drawing_id='aCBMHcHbxBTx000',
                 classification={'category': '기둥-보', 'connection': '강접'},
                 member_sections=['H-300x300x10x15'], bolts={'grade': 'F10T', 'size': 'M20', 'count': 8},
                 assignment={'requires_review': True}, source='steel',
                 detail_path='steel.json.gz')
    save(libraries['steel'], [row], source='steel', review_required=True)
    with gzip.open(libraries['steel'] / 'steel.json.gz', 'wt', encoding='utf-8') as stream:
        json.dump({'geometry': {'units': 'mm', 'entities': [], 'marker': 'steel'}}, stream)
    result = bridge.call('cad_search_details', {'source': 'steel', 'query': 'CBMH'})
    assert result['count'] == 1
    assert result['details'][0]['source'] == 'steel'
    fetched = bridge.call('cad_get_detail', {'id': 'steel-1', 'source': 'steel', 'include_geometry': True})
    assert fetched['geometry']['marker'] == 'steel'
    assert fetched['review_required'] is True
    assert fetched['detail']['bolts']['grade'] == 'F10T'


def test_steel_insert_is_review_gated(libraries, monkeypatch):
    row = detail('steel-blocked', source='steel', insertion_allowed=False,
                 opening_status='ok', detail_path='steel.json')
    save(libraries['steel'], [row], source='steel')
    (libraries['steel'] / 'steel.json').write_text(json.dumps({'geometry': {'units': 'mm', 'entities': []}}), encoding='utf8')
    monkeypatch.setattr(bridge, 'validate_target', lambda value: value)
    result = bridge.call('cad_insert_detail', {'id': 'steel-blocked', 'source': 'steel', 'target': {}})
    assert result['status'] == 'unavailable'
    assert '구조기술사 검토' in result['message']


def test_steel_default_root_can_be_overridden(tmp_path, monkeypatch):
    monkeypatch.setenv('BARUN_STEEL_DETAILS', str(tmp_path))
    assert library.library_root('steel') == tmp_path.resolve()
