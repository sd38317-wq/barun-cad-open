"""보조 엔진 배포 고지와 진단 도구의 연결 회귀시험."""
from pathlib import Path
import importlib.util
import tomllib

ROOT = Path(__file__).resolve().parent


def test_acadrust_notices_cover_locked_crates():
    lock = tomllib.loads((ROOT / 'converter-rs/Cargo.lock').read_text(encoding='utf-8'))
    notice = (ROOT / 'converter-rs/NOTICE').read_text(encoding='utf-8')
    texts = (ROOT / 'converter-rs/THIRD_PARTY_LICENSES.txt').read_text(encoding='utf-8')
    for package in lock['package']:
        if 'source' in package:
            marker = package['name'] + ' ' + package['version']
            assert marker in notice
            assert marker in texts
    assert 'https://github.com/hakanaktt/acadrust' in notice
    assert 'MPL-2.0' in notice
    assert 'Unicode-3.0' in notice
    assert 'BSD-3-Clause' in notice


def test_runtime_contains_full_mpl_and_matching_notices():
    for name in ('LICENSE', 'NOTICE', 'THIRD_PARTY_LICENSES.txt'):
        source = ROOT / 'converter-rs' / name
        assert (ROOT / 'acadrust-runtime' / name).read_bytes() == source.read_bytes()
    license_text = (ROOT / 'converter-rs/LICENSE').read_text(encoding='utf-8')
    assert license_text.startswith('Mozilla Public License Version 2.0')
    assert 'Exhibit B' in license_text
    notices = (ROOT / 'THIRD_PARTY_NOTICES.md').read_text(encoding='utf-8')
    assert '**acadrust 0.6.4**' in notices
    assert 'acadrust-runtime' in notices
    assert 'libredwg-runtime' not in notices


def test_import_diagnosis_uses_bundled_auxiliary_engine():
    source = (ROOT / 'tools/quality/diagnose-import-failures.py').read_text(encoding='utf-8')
    assert 'acadrust-runtime/barun-dwg2dxf.exe' in source
    assert 'libredwg-runtime' not in source


def test_handle_comparison_uses_local_primary_command():
    spec = importlib.util.spec_from_file_location('handle_comparison', ROOT / 'compare_dxf_by_handle.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    dwg, target = ROOT / 'input.dwg', ROOT / 'out.dxf'
    assert module.conversion_command('acadsharp', dwg, target) == [
        str(ROOT / 'dwg-runtime/BarunConverter.exe'), str(dwg), str(target), '2018', '--defer-verify']
    assert module.conversion_command('acadrust', dwg, target) == [
        str(ROOT / 'converter-rs/target/release/barun-dwg2dxf.exe'), '-v0', '--as', 'r2018', '-o', str(target), str(dwg)]


def test_audit_defaults_to_current_engine_pair():
    spec = importlib.util.spec_from_file_location('fallback_audit', ROOT / 'audit_dwg_fallback_engines.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    assert {key.split('_', 1)[0] for key in module.FIELDS if key.endswith('_ok')} == {'primary', 'rust'}
    assert module.primary_command(ROOT / 'in.dwg', ROOT / 'out.dxf') == [
        str(ROOT / 'dwg-runtime/BarunConverter.exe'), str(ROOT / 'in.dwg'), str(ROOT / 'out.dxf'), '2018']


def test_new_comparison_summary_does_not_add_an_absent_previous_engine(tmp_path):
    import json
    spec = importlib.util.spec_from_file_location('fallback_summary', ROOT / 'summarize_dwg_fallback_engines.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    row = {'index':1, 'source':'sample.dwg', 'version':'AC1027', 'source_mb':0.01,
           'primary':{'ok':False, 'seconds':0.1},
           'rust':{'ok':True, 'read':'성공', 'seconds':0.1, 'ms':2, 'barun':2, 'kinds':{'LINE':2}}}
    (tmp_path / 'results.json').write_text(json.dumps({'found':1, 'rows':[row]}), encoding='utf8')
    module.main(tmp_path)
    summary = (tmp_path / '요약.md').read_text(encoding='utf8')
    assert 'acadrust' in summary
    assert '이전 보조' not in summary
    assert 'Libre' not in summary
