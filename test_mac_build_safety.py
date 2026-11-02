"""Build policy checks without compiling or packaging any application."""
import ast
import os
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock
import pytest
import build_mac_runtimes as build

@pytest.mark.parametrize(('machine','arch'), [('x86_64','arm64'), ('arm64','x64')])
@pytest.mark.parametrize('engine', ['converter', 'acadrust'])
def test_cross_arch_never_executes_target(tmp_path, monkeypatch, machine, arch, engine):
    monkeypatch.setattr(build.platform, 'machine', lambda: machine)
    monkeypatch.setattr(build, 'ROOT', tmp_path)
    monkeypatch.setattr(build, 'dotnet', lambda: 'dotnet')
    monkeypatch.setattr(build.shutil, 'which', lambda _: 'cargo')
    monkeypatch.setattr(build.shutil, 'copytree', Mock())
    monkeypatch.setattr(build.shutil, 'copy2', Mock())
    monkeypatch.setattr(build, 'replace_folder', Mock())
    monkeypatch.setattr(Path, 'is_file', lambda _: True)
    run = Mock(return_value=SimpleNamespace(returncode=0, stdout='', stderr=''))
    monkeypatch.setattr(build.subprocess, 'run', run)
    getattr(build, 'build_' + engine)(arch, tmp_path)
    assert run.call_count == 1
    assert run.call_args.args[0][0] in ('dotnet', 'cargo')
    assert run.call_args.kwargs['env']['MACOSX_DEPLOYMENT_TARGET'] == '12.0'

@pytest.mark.parametrize('engine', ['converter', 'acadrust'])
def test_native_smoke_failure_blocks_staging(tmp_path, monkeypatch, engine):
    monkeypatch.setattr(build.platform, 'machine', lambda: 'arm64')
    monkeypatch.setattr(build, 'ROOT', tmp_path)
    monkeypatch.setattr(build, 'dotnet', lambda: 'dotnet')
    monkeypatch.setattr(build.shutil, 'which', lambda _: 'cargo')
    monkeypatch.setattr(build.shutil, 'copytree', Mock())
    monkeypatch.setattr(build.shutil, 'copy2', Mock())
    stage = Mock()
    monkeypatch.setattr(build, 'replace_folder', stage)
    monkeypatch.setattr(Path, 'is_file', lambda _: True)
    run = Mock(side_effect=[SimpleNamespace(returncode=0), SimpleNamespace(returncode=99, stdout='', stderr='broken')])
    monkeypatch.setattr(build.subprocess, 'run', run)
    with pytest.raises(SystemExit):
        getattr(build, 'build_' + engine)('arm64', tmp_path)
    stage.assert_not_called()

def test_desktop_sets_mac_deployment_target_without_running_build(monkeypatch):
    path = Path(__file__).with_name('build_desktop.py')
    tree = ast.parse(path.read_text(encoding='utf8'))
    nodes = [n for n in tree.body if isinstance(n, ast.If) and isinstance(n.test, ast.Name) and n.test.id == 'mac' and 'MACOSX_DEPLOYMENT_TARGET' in ast.unparse(n)]
    assert nodes, 'Mac packaging must set the native compilation deployment target'
    monkeypatch.delenv('MACOSX_DEPLOYMENT_TARGET', raising=False)
    namespace = dict(mac=True, os=os, MIN_MACOS='12.0')
    exec(compile(ast.Module(body=nodes, type_ignores=[]), str(path), 'exec'), namespace)
    assert os.environ['MACOSX_DEPLOYMENT_TARGET'] == '12.0'

@pytest.mark.parametrize(('machine','arch'), [('x86_64','arm64'), ('arm64','x64')])
def test_desktop_cross_arch_does_not_execute_backend(machine, arch):
    path = Path(__file__).with_name('build_desktop.py')
    tree = ast.parse(path.read_text(encoding='utf8'))
    node = next(n for n in tree.body if 'standalone_smoke.py' in ast.unparse(n))
    run = Mock()
    state = dict(mac=True, arch=arch, platform=SimpleNamespace(machine=lambda: machine),
                 subprocess=SimpleNamespace(run=run), sys=SimpleNamespace(executable='python'),
                 root=Path('workspace'), backend_dist='backend', backend_name='engine', exe='', beta=False)
    exec(compile(ast.Module(body=[node], type_ignores=[]), str(path), 'exec'), state)
    run.assert_not_called()
