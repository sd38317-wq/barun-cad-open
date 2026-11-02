"""동적 블록의 단위와 속성 DXF 왕복 회귀 시험."""
import io
import json
from pathlib import Path
import subprocess
import tempfile
from unittest.mock import patch

import ezdxf
import pytest
import exchange

ROOT = Path(__file__).resolve().parent


def raw_dxf(doc):
    stream = io.StringIO()
    doc.write(stream)
    return stream.getvalue().encode('utf8')


def test_dynb_attributes_keep_native_value_position_and_style():
    source = ezdxf.new('R2018')
    source.units = 4
    source.layers.new('A-문자')
    source.styles.new('검수', dxfattribs={'font': 'malgun.ttf'})
    block = source.blocks.new('시험블록')
    block.add_line((0, 0), (5, 0))
    ref = source.modelspace().add_blockref('시험블록', (100, 200), dxfattribs={'rotation': 90, 'xscale': 2, 'yscale': 2})
    ref.add_attrib('NO', '203', (123, 456), dxfattribs={'layer': 'A-문자', 'style': '검수', 'height': 17, 'rotation': 31, 'width': .7, 'flags': 1})
    model = exchange.import_file(raw_dxf(source), '.dxf')['document']
    imported = model['entities'][0]
    definition = model['sharedBlocks'][imported['sharedBlock']]
    definition['dynamic'] = {'parameters': [{'id': 1, 'kind': 'linear', 'label': '길이', 'p1': {'x': 0, 'y': 0}, 'p2': {'x': 5, 'y': 0}, 'value': 5}], 'actions': []}
    imported['dynamic'] = {'source': imported['sharedBlock'], 'values': {'1': 5}}
    script = """
import {dynamicChanges} from './dynamic-block.js';
let data='';for await(const chunk of process.stdin)data+=chunk;
const doc=JSON.parse(data);let ref=doc.entities[0];
for(const value of [20,5])ref={...ref,...dynamicChanges(doc,ref,{1:value})};
doc.entities[0]=ref;process.stdout.write(JSON.stringify(doc));
"""
    result = subprocess.run(['node', '--input-type=module', '-e', script], input=json.dumps(model), cwd=ROOT, capture_output=True, text=True, encoding='utf8', check=True)
    changed = json.loads(result.stdout)
    raw, _ = exchange.export_dxf(changed)
    with tempfile.TemporaryDirectory() as folder:
        target = Path(folder) / 'attrs.dxf'
        target.write_bytes(raw)
        written = ezdxf.readfile(target)
    insert = written.modelspace().query('INSERT')[0]
    assert len(insert.attribs) == 1
    attr = insert.get_attrib('NO')
    assert attr.dxf.text == '203'
    assert tuple(attr.dxf.insert)[:2] == (123, 456)
    assert attr.dxf.height == 17
    assert attr.dxf.rotation == 31
    assert attr.dxf.width == .7
    assert attr.dxf.style == '검수'
    assert written.styles.get('검수').dxf.font == 'malgun.ttf'
    assert attr.is_invisible
    assert not written.audit().errors


@pytest.mark.parametrize('stale_xy', [False, True])
def test_dynamic_sidecar_units_follow_parameter_kind(stale_xy):
    source = ezdxf.new('R2018')
    source.units = 1  # inch -> mm
    block = source.blocks.new('시험블록')
    block.add_line((0, 0), (2, 1))
    ref = source.modelspace().add_blockref('시험블록', (0, 0))
    params = [
        {'id': 1, 'kind': 'linear', 'p1': {'x': 0, 'y': 0}, 'p2': {'x': 2, 'y': 0}, 'value': 2},
        {'id': 2, 'kind': 'flip', 'p1': {'x': 1, 'y': 0}, 'p2': {'x': 1, 'y': 2}, 'value': 0},
        {'id': 3, 'kind': 'rotation', 'p1': {'x': 1, 'y': 0}, 'p2': {'x': 2, 'y': 0}, 'value': .5},
        {'id': 4, 'kind': 'xy', 'p1': {'x': 0, 'y': 0}, 'p2': {'x': 2, 'y': 1}, 'value': {'x': 2, 'y': 1}, 'valueSetX': {'type': 'Increment', 'min': 1, 'max': 5, 'increment': .5, 'list': []}, 'valueSetY': {'type': 'List', 'min': 0, 'max': 0, 'increment': 0, 'list': [1, 2]}},
    ]
    actions = [{'kind': 'rotate', 'param': 3, 'center': {'x': 1, 'y': 2}, 'handles': []}]
    sidecar = {'defs': {'시험블록': {'parameters': params, 'actions': actions}}, 'inserts': {ref.dxf.handle: {'source': '시험블록', 'values': {'1': 3, '2': 1, '3': 1.25, ('40' if stale_xy else '4'): {'x': 3, 'y': -2}}}}}
    with tempfile.TemporaryDirectory() as folder:
        target = Path(folder) / 'source.dxf'
        target.write_bytes(raw_dxf(source))
        details = {'_document': source, '_dyn_blocks': sidecar, 'timings_ms': {}}
        with patch.object(exchange, 'dwg_to_dxf', return_value=(target, '시험', [], details)):
            model = exchange._import_source(target, '.dwg', Path(folder))['document']
    dyn = model['sharedBlocks']['시험블록']['dynamic']
    by_id = {p['id']: p for p in dyn['parameters']}
    assert by_id[1]['value'] == 50.8
    assert by_id[2]['p1']['x'] == 25.4
    assert by_id[2]['p2']['y'] == 50.8
    assert by_id[2]['value'] == 0
    assert by_id[3]['value'] == .5
    assert by_id[4]['value'] == {'x': 50.8, 'y': 25.4}
    assert by_id[4]['valueSetX']['increment'] == 12.7
    assert by_id[4]['valueSetY']['list'] == [25.4, 50.8]
    assert dyn['actions'][0]['center'] == {'x': 25.4, 'y': 50.8}
    values = model['entities'][0]['dynamic']['values']
    assert values == {'1': 76.19999999999999, '2': 1, '3': 1.25, ('40' if stale_xy else '4'): {'x': 76.19999999999999, 'y': -50.8}}


def test_plain_drawing_does_not_interpret_dynamic_values():
    source = ezdxf.new('R2018')
    source.units = 4
    block = source.blocks.new('일반블록')
    block.add_line((0, 0), (5, 1))
    for i in range(12):
        source.modelspace().add_blockref('일반블록', (i * 10, 0))
    with patch.object(exchange, '_dynamic_block_value', side_effect=AssertionError('unexpected dynamic evaluation')) as convert:
        model = exchange.import_file(raw_dxf(source), '.dxf')['document']
    convert.assert_not_called()
    assert len(model['entities']) == 12
    assert all('dynamic' not in ref for ref in model['entities'])


@pytest.mark.parametrize('kind', ['linear', 'rotation', 'flip'])
def test_unknown_old_scalar_cache_is_not_guessed_from_the_only_numeric_parameter(kind):
    source = ezdxf.new('R2018')
    source.units = 1
    block = source.blocks.new('시험블록')
    block.add_line((0, 0), (2, 1))
    ref = source.modelspace().add_blockref('시험블록', (0, 0))
    sidecar = {'defs': {'시험블록': {'parameters': [{'id': 1, 'kind': kind, 'value': 0 if kind != 'linear' else 2}], 'actions': []}},
               'inserts': {ref.dxf.handle: {'source': '시험블록', 'values': {'1': None, 'old': 1}}}}
    with tempfile.TemporaryDirectory() as folder:
        target = Path(folder) / 'source.dxf'
        target.write_bytes(raw_dxf(source))
        details = {'_document': source, '_dyn_blocks': sidecar, 'timings_ms': {}}
        with patch.object(exchange, 'dwg_to_dxf', return_value=(target, '시험', [], details)):
            model = exchange._import_source(target, '.dwg', Path(folder))['document']
    # 모르는 옛 키는 환산·추측하지 않고 원래 값 그대로 둔다(화면은 쓰지 않음)
    assert model['entities'][0]['dynamic']['values'] == {'1': None, 'old': 1}


def test_untyped_coordinate_cache_cannot_be_scaled_as_xy():
    source = ezdxf.new('R2018')
    source.units = 1
    block = source.blocks.new('시험블록')
    block.add_line((0, 0), (2, 1))
    ref = source.modelspace().add_blockref('시험블록', (0, 0))
    sidecar = {'defs': {'시험블록': {'parameters': [{'id': 1, 'kind': 'xy', 'value': {'x': 2, 'y': 1}}], 'actions': []}},
               'inserts': {ref.dxf.handle: {'source': '시험블록', 'values': {'1': None, 'old': {'points': [[0, 0], [2, 1]]}}}}}
    with tempfile.TemporaryDirectory() as folder:
        target = Path(folder) / 'source.dxf'
        target.write_bytes(raw_dxf(source))
        details = {'_document': source, '_dyn_blocks': sidecar, 'timings_ms': {}}
        with patch.object(exchange, 'dwg_to_dxf', return_value=(target, '시험', [], details)):
            model = exchange._import_source(target, '.dwg', Path(folder))['document']
    assert model['entities'][0]['dynamic']['values'] == {'1': None, 'old': {'points': [[0, 0], [2, 1]]}}


@pytest.mark.parametrize('anonymous', [False, True])
@pytest.mark.parametrize('attribute_only', [False, True])
def test_native_dynamic_attribute_follows_rotation_and_survives_dxf_save(anonymous, attribute_only):
    source = ezdxf.new('R2018')
    source.units = 4
    block = source.blocks.new('시험블록')
    source.layers.new('A-문자')
    if not attribute_only:block.add_line((0, 0), (5, 0))
    attdef = block.add_attdef('NO', (100, 0), '기본', dxfattribs={'height': 3, 'layer': 'A-문자'})
    if anonymous:
        current = source.blocks.new('*U1')
        if not attribute_only:current.add_line((0, 0), (5, 0))
    ref = source.modelspace().add_blockref('*U1' if anonymous else '시험블록', (0, 0))
    ref.add_attrib('NO', '203', (100, 0), dxfattribs={'height': 3, 'layer': 'A-문자', 'width': .7})
    sidecar = {'defs': {'시험블록': {'parameters': [{'id': 1, 'kind': 'rotation', 'value': 0, 'p1': {'x': 0, 'y': 0}, 'p2': {'x': 1, 'y': 0}}],
                  'actions': [{'kind': 'rotate', 'param': 1, 'center': {'x': 0, 'y': 0}, 'handles': [attdef.dxf.handle]}]}},
               'inserts': {ref.dxf.handle: {'source': '시험블록', 'values': {'1': 0}}}}
    with tempfile.TemporaryDirectory() as folder:
        target = Path(folder) / 'source.dxf'
        target.write_bytes(raw_dxf(source))
        details = {'_document': source, '_dyn_blocks': sidecar, 'timings_ms': {}}
        with patch.object(exchange, 'dwg_to_dxf', return_value=(target, '시험', [], details)):
            model = exchange._import_source(target, '.dwg', Path(folder))['document']
    definition = model['sharedBlocks']['시험블록']
    assert definition['dynamic']['attributeDefinitions'] == [{'tag': 'NO', 'sourceHandle': attdef.dxf.handle}]
    assert all('attdef' not in e for e in definition['entities'])
    script = """
import {dynamicChanges} from './dynamic-block.js';
import {materializeSharedDrawingReference} from './geometry.js';
let data='';for await(const chunk of process.stdin)data+=chunk;
const doc=JSON.parse(data);
if(materializeSharedDrawingReference(doc,doc.entities[0]).entities.filter(e=>e.attributeTag==='NO').length!==1)throw Error('duplicate initial attribute');
doc.entities[0]={...doc.entities[0],...dynamicChanges(doc,doc.entities[0],{1:Math.PI/2})};
process.stdout.write(JSON.stringify(doc));
"""
    result = subprocess.run(['node', '--input-type=module', '-e', script], input=json.dumps(model), cwd=ROOT,
                            capture_output=True, text=True, encoding='utf8', check=True)
    changed = json.loads(result.stdout)
    raw, _ = exchange.export_dxf(changed)
    written = ezdxf.read(io.StringIO(raw.decode('utf8'), newline=None))
    insert = written.modelspace().query('INSERT')[0]
    assert len(insert.attribs) == 1
    attr = insert.get_attrib('NO')
    assert tuple(attr.dxf.insert)[:2] == pytest.approx((0, 100))
    assert attr.dxf.rotation == pytest.approx(90)
    assert attr.dxf.text == '203'
    assert attr.dxf.width == .7
    assert not written.audit().errors
