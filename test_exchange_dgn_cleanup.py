"""DGN helper records are removed only from the DXF parsing copy."""
import io
import base64
import zlib
import re
from collections import Counter
from pathlib import Path
from unittest.mock import patch

import ezdxf
import pytest
import exchange


def fixture_bytes(with_dgn=True, newline='\n', padded=True, korean=False):
    doc = ezdxf.new('R2018')
    doc.units = 4  # mm: 원본 보존은 mm 도면에만 생긴다
    doc.layers.new('A-TEST')
    doc.modelspace().add_line((0, 0), (5, 2), dxfattribs={'layer': 'A-TEST'})
    doc.modelspace().add_text('한글' if korean else 'LS data is not a drawing', dxfattribs={'layer': 'A-TEST'})
    block = doc.blocks.new('DETAIL')
    block.add_circle((1, 2), 3, dxfattribs={'layer': 'A-TEST'})
    doc.modelspace().add_blockref('DETAIL', (10, 20))
    keep = doc.rootdict.add_xrecord('KEEP_ME')
    keep.extend([(1, 'ACAD_DGNLINESTYLECOMP in ordinary text'), (90, 42)])
    replacements = {}
    if with_dgn:
        dgn = doc.rootdict.add_new_dict('ACAD_DGNLINESTYLECOMP')
        for i, kind in enumerate(('LSCOMPOUNDCOMPONENT', 'LSSTROKEPATTERNCOMPONENT', 'LSDEFINITION')):
            obj = dgn.add_xrecord('component' + str(i))
            obj.extend([(1, 'unused payload')])
            replacements[obj.dxf.handle] = kind
        mixed = doc.rootdict.add_new_dict('KEEP_DICTIONARY')
        mixed['keep'] = keep
        mixed['stale_alias'] = obj
    stream = io.StringIO()
    doc.write(stream)
    text = stream.getvalue()
    for handle, kind in replacements.items():
        text = text.replace('  0\nXRECORD\n  5\n' + handle + '\n', '  0\n' + kind + '\n  5\n' + handle + '\n')
    if not padded:
        lines = text.splitlines()
        for i in range(0, len(lines), 2):
            lines[i] = lines[i].strip()
        text = '\n'.join(lines) + '\n'
    return text.replace('\n', newline).encode('utf8')


def graphics(doc):
    return {block.name: Counter((e.dxftype(), e.dxf.handle) for e in block) for block in doc.blocks}


@pytest.mark.parametrize('newline,padded', [('\n', True), ('\r\n', True), ('\n', False), ('\r\n', False)])
def test_cleanup_preserves_graphics_handles_and_other_dictionary_entries(tmp_path, newline, padded):
    raw = fixture_bytes(newline=newline, padded=padded)
    source = tmp_path / 'original.dxf'
    source.write_bytes(raw)
    before = ezdxf.readfile(source)
    parsed = []
    original_reader = ezdxf.readfile
    def spy(path, *args, **kwargs):
        parsed.append((Path(path), Path(path).read_bytes()))
        return original_reader(path, *args, **kwargs)
    with patch.object(exchange, '_readfile', side_effect=spy):
        after = exchange.read_dxf_preserving_unicode(source, tmp_path / 'parse')
    assert source.read_bytes() == raw
    assert graphics(after) == graphics(before)
    assert after.rootdict['KEEP_ME'].dxf.handle == before.rootdict['KEEP_ME'].dxf.handle
    assert list(after.rootdict['KEEP_ME'].tags) == list(before.rootdict['KEEP_ME'].tags)
    assert after.rootdict['KEEP_DICTIONARY']['keep'].dxf.handle == before.rootdict['KEEP_ME'].dxf.handle
    assert 'stale_alias' not in after.rootdict['KEEP_DICTIONARY']
    assert 'ACAD_DGNLINESTYLECOMP' not in after.rootdict
    assert parsed and all(path != source for path, _ in parsed)
    assert all(not re.search(rb'(?m)^ *0\r?\nLS[A-Z]+\r?$', data) for _, data in parsed)
    assert not any(e.dxftype().startswith('LS') for e in after.objects)


def test_plain_primary_style_dxf_uses_original_without_creating_copy(tmp_path):
    source = tmp_path / 'primary.dxf'
    raw = fixture_bytes(with_dgn=False)
    source.write_bytes(raw)
    original_reader = ezdxf.readfile
    with patch.object(exchange, '_readfile', wraps=original_reader) as reader:
        after = exchange.read_dxf_preserving_unicode(source, tmp_path / 'parse')
    assert Path(reader.call_args.args[0]) == source
    assert not (tmp_path / 'parse').exists()
    assert source.read_bytes() == raw
    assert graphics(after) == graphics(original_reader(source))


def test_dgn_cleanup_and_unicode_normalization_share_parsing_copy(tmp_path):
    source = tmp_path / 'original.dxf'
    raw = fixture_bytes(korean=True)
    source.write_bytes(raw)
    after = exchange.read_dxf_preserving_unicode(source, tmp_path / 'parse')
    assert '한글' in [exchange.dxf_unicode(e.dxf.text) for e in after.modelspace().query('TEXT')]
    assert source.read_bytes() == raw
    assert not any(e.dxftype().startswith('LS') for e in after.objects)
    assert 'KEEP_ME' in after.rootdict


def test_import_preservation_payload_keeps_original_dgn_bytes(tmp_path):
    raw = fixture_bytes()
    source = tmp_path / 'original.dxf'
    source.write_bytes(raw)
    result = exchange.import_file_path(source, '.dxf', include_handles=True)
    assert source.read_bytes() == raw
    assert result['report']['imported'] > 0
    assert result['report'].get('skipped', {}) == {}
    preserved = result['document']['dxfPreservation']['data']
    assert zlib.decompress(base64.b64decode(preserved)) == raw


def test_no_dgn_does_not_allocate_temporary_directory(tmp_path):
    source = tmp_path / 'primary.dxf'
    source.write_bytes(fixture_bytes(with_dgn=False))
    with patch.object(exchange.tempfile, 'mkdtemp', side_effect=AssertionError('unexpected copy')):
        exchange.read_dxf_preserving_unicode(source)


def test_object_filter_never_removes_ls_named_graphics_or_binary_data():
    graphics = b'0\nSECTION\n2\nENTITIES\n0\nLSCUSTOMGRAPHIC\n5\nA1\n0\nENDSEC\n'
    objects = b'0\nSECTION\n2\nOBJECTS\n0\nLSDEFINITION\n5\nA2\n0\nENDSEC\n0\nEOF\n'
    filtered = exchange._dgn_filtered_bytes(graphics + objects)
    assert filtered.startswith(graphics)
    assert b'LSDEFINITION' not in filtered
    binary = b'AutoCAD Binary DXF\r\n\x1a\x00' + graphics + objects
    assert exchange._dgn_filtered_bytes(binary) is binary


def test_parsing_copy_name_cannot_overwrite_input_in_same_folder(tmp_path):
    source = tmp_path / 'dgn-filtered.dxf'
    raw = fixture_bytes()
    source.write_bytes(raw)
    after = exchange.read_dxf_preserving_unicode(source, tmp_path)
    assert source.read_bytes() == raw
    assert not any(e.dxftype().startswith('LS') for e in after.objects)


def test_unicode_parsing_copy_cannot_overwrite_input_in_same_folder(tmp_path):
    source = tmp_path / 'unicode.dxf'
    raw = fixture_bytes(korean=True)
    source.write_bytes(raw)
    after = exchange.read_dxf_preserving_unicode(source, tmp_path)
    assert source.read_bytes() == raw
    assert '한글' in [exchange.dxf_unicode(e.dxf.text) for e in after.modelspace().query('TEXT')]
    assert not any(e.dxftype().startswith('LS') for e in after.objects)
