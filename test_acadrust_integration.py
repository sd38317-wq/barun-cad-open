"""저장소의 작은 DWG를 실제 release 바이너리로 검증한다."""
from collections import Counter
import hashlib
import json
from pathlib import Path
import subprocess
from types import SimpleNamespace
from unittest.mock import patch

import ezdxf
import pytest
import batch_converter as converter

ROOT = Path(__file__).resolve().parent
EXE = ROOT / 'converter-rs/target/release' / ('barun-dwg2dxf' + converter.runtime_paths.EXE)
SOURCE = ROOT / 'tests/fixtures/dwg-import/table-merged.dwg'
pytestmark = pytest.mark.skipif(not EXE.is_file(), reason='cargo build --release --locked 필요')


def test_release_binary_reads_small_table_dwg_without_touching_source(tmp_path):
    original = hashlib.sha256(SOURCE.read_bytes()).digest()
    target = tmp_path / 'table.dxf'
    result = converter._run_fallback([str(EXE), '-v0', '--as', 'r2018', '-o', str(target), str(SOURCE)],
        stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=30)
    assert result.returncode == 0, result.stdout.decode('utf8', 'replace')
    report = json.loads(result.stdout.decode('utf8').splitlines()[-1])
    assert report['ok'] and report['engine'] == 'acadrust 0.6.4'
    document = ezdxf.readfile(target)
    assert Counter(e.dxftype() for e in document.modelspace()) == {'ACAD_TABLE':1, 'LINE':1}
    assert {e.dxf.handle for e in document.modelspace()} == {'48', '4C'}
    assert hashlib.sha256(SOURCE.read_bytes()).digest() == original


def test_primary_failure_uses_the_real_auxiliary_binary(tmp_path):
    original = SOURCE.read_bytes()
    failed = SimpleNamespace(returncode=1, stdout=b'{"failed":true,"inputTypes":{"TableEntity":1,"Line":1}}')
    with patch.object(converter.subprocess, 'run', return_value=failed), \
         patch.object(converter.runtime_paths, 'bundled_runtime', return_value=EXE.parent):
        result = converter.process({'action':'convert','name':'table.dwg','direction':'dwg-dxf',
            'folder':str(tmp_path), '_source_path':str(SOURCE), '_no_parallel_fallback':True})
    assert not result.get('failed'), result
    assert result['engine'] == 'acadrust 0.6.4'
    assert result['route'] == 'acadrust-fallback'
    assert result['after'] == 2
    assert SOURCE.read_bytes() == original
