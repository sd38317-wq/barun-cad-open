"""동적 블록에서 확인된 거리만 환산하고 다른 값은 보존한다."""
import copy
import io
from pathlib import Path
from unittest.mock import patch

import ezdxf
import pytest
import exchange


def import_dynamic(tmp_path, parameters, values):
    source = ezdxf.new('R2018')
    source.units = 6
    block = source.blocks.new('시험블록')
    block.add_line((0, 0), (2, 1))
    ref = source.modelspace().add_blockref('시험블록', (0, 0))
    sidecar = {'defs': {'시험블록': {'parameters': parameters, 'actions': []}},
               'inserts': {ref.dxf.handle: {'source': '시험블록', 'values': values}}}
    original = copy.deepcopy(sidecar)
    stream = io.StringIO()
    source.write(stream)
    target = tmp_path / 'source.dxf'
    target.write_bytes(stream.getvalue().encode('utf8'))
    details = {'_document': source, '_dyn_blocks': sidecar, 'timings_ms': {}}
    with patch.object(exchange, 'dwg_to_dxf', return_value=(target, '시험', [], details)):
        model = exchange._import_source(target, '.dwg', Path(tmp_path))['document']
    assert sidecar == original
    return model['entities'][0]['dynamic']['values'], model['sharedBlocks']['시험블록']['dynamic']


@pytest.mark.parametrize('other_kind', ['visibility', 'lookup'])
def test_unmapped_states_and_boolean_are_not_distances(tmp_path, other_kind):
    params = [{'id': 1, 'kind': 'linear', 'value': 2}, {'id': 2, 'kind': other_kind}]
    values, _ = import_dynamic(tmp_path, params, {'1': 2, 'state-index': 1, 'enabled': True})
    assert values == {'1': 2000, 'state-index': 1, 'enabled': True}
    assert values['enabled'] is True


def test_boolean_is_preserved_even_for_explicit_distance_id(tmp_path):
    values, definition = import_dynamic(tmp_path, [{'id': 1, 'kind': 'linear', 'value': True}], {'1': True})
    assert values['1'] is True
    assert definition['parameters'][0]['value'] is True


@pytest.mark.parametrize('alias', ['name', 'label'])
@pytest.mark.parametrize('second_kind', ['linear', 'rotation'])
def test_named_values_with_multiple_numeric_parameters_follow_kind(tmp_path, alias, second_kind):
    params = [{'id': 1, 'kind': 'linear', alias: '거리', 'value': 2},
              {'id': 2, 'kind': second_kind, alias: '두번째', 'value': 3}]
    values, _ = import_dynamic(tmp_path, params, {'거리': 4, '두번째': 5})
    assert values == {'거리': 4000, '두번째': 5000 if second_kind == 'linear' else 5}


def test_parameter_without_id_can_use_its_name(tmp_path):
    values, _ = import_dynamic(tmp_path, [{'kind': 'linear', 'name': '거리', 'value': 2}], {'거리': 4})
    assert values == {'거리': 4000}


@pytest.mark.parametrize('kind,key', [('linear', 'valueSet'), ('xy', 'valueSetX'), ('xy', 'valueSetY')])
def test_list_limits_allow_null_bounds(tmp_path, kind, key):
    value = {'x': 2, 'y': 1} if kind == 'xy' else 2
    params = [{'id': 1, 'kind': kind, 'value': value,
               key: {'type': 'List', 'min': None, 'max': None, 'increment': None, 'list': [1, 2]}}]
    _, definition = import_dynamic(tmp_path, params, {'1': value})
    assert definition['parameters'][0][key] == {
        'type': 'List', 'min': None, 'max': None, 'increment': None, 'list': [1000, 2000]}


def test_partial_value_set_preserves_missing_fields(tmp_path):
    _, definition = import_dynamic(tmp_path, [{'id': 1, 'kind': 'linear', 'value': 2,
                                              'valueSet': {'type': 'List', 'list': [1, 2]}}], {'1': 3})
    assert definition['parameters'][0]['valueSet'] == {'type': 'List', 'list': [1000, 2000]}


def test_multiple_unknown_numbers_are_not_all_inferred_as_one_distance(tmp_path):
    values, _ = import_dynamic(tmp_path, [{'id': 1, 'kind': 'linear', 'value': 2}], {'old-a': 3, 'old-b': 4})
    assert values == {'old-a': 3, 'old-b': 4}


def test_duplicate_aliases_do_not_guess_a_parameter_kind(tmp_path):
    params = [{'id': 1, 'kind': 'linear', 'label': '같은 이름', 'value': 2},
              {'id': 2, 'kind': 'rotation', 'label': '같은 이름', 'value': 1}]
    values, _ = import_dynamic(tmp_path, params, {'같은 이름': 3})
    assert values == {'같은 이름': 3}


def test_explicit_id_takes_precedence_over_another_parameters_alias(tmp_path):
    params = [{'id': 1, 'kind': 'rotation', 'label': '각도', 'value': 1},
              {'id': 2, 'kind': 'linear', 'label': '1', 'value': 2}]
    values, _ = import_dynamic(tmp_path, params, {'1': 3, '2': 4})
    assert values == {'1': 3, '2': 4000}


def test_known_distance_does_not_claim_an_additional_unknown_number(tmp_path):
    values, _ = import_dynamic(tmp_path, [{'id': 1, 'kind': 'linear', 'value': 2}], {'1': 3, 'state-index': 4})
    assert values == {'1': 3000, 'state-index': 4}
