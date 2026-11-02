"""Exercise runtime staging without executing the desktop packaging script."""
import ast
import os
from pathlib import Path
import shutil
import subprocess
from types import SimpleNamespace
from unittest.mock import Mock

import pytest

ROOT = Path(__file__).resolve().parent
LICENSE_NAMES = ('LICENSE', 'NOTICE', 'THIRD_PARTY_LICENSES.txt')


def load_functions(filename, **namespace):
    tree = ast.parse((ROOT / filename).read_text(encoding='utf-8'))
    functions = [node for node in tree.body if isinstance(node, ast.FunctionDef)]
    exec(compile(ast.Module(body=functions, type_ignores=[]), filename, 'exec'), namespace)
    return namespace


@pytest.fixture
def build_env(tmp_path):
    source = tmp_path / 'converter-rs'
    source.mkdir()
    for name in LICENSE_NAMES:
        (source / name).write_bytes(('original ' + name + '\r\n고지').encode('utf-8'))
    work = tmp_path / 'work'
    work.mkdir()
    run = Mock(return_value=SimpleNamespace(returncode=1, stdout='사용법: barun-dwg2dxf', stderr=''))
    copy = SimpleNamespace(which=Mock(return_value='cargo'), copy2=shutil.copy2)
    shared = dict(Path=Path, shutil=copy, subprocess=SimpleNamespace(run=run), os=SimpleNamespace(name='nt', environ={}), ROOT=tmp_path, root=tmp_path, MIN_MACOS='12.0', platform=SimpleNamespace(machine=lambda: 'arm64'))
    desktop = load_functions('build_desktop.py', **shared)
    mac = load_functions('build_mac_runtimes.py', **shared)
    mac['replace_folder'] = Mock(side_effect=lambda target, staged: shutil.copytree(staged, target))
    return SimpleNamespace(root=tmp_path, source=source, work=work, run=run, copy=copy, desktop=desktop, mac=mac)


def binary(env, target=None):
    path = env.source / 'target'
    if target:
        path /= target
    path = path / 'release' / ('barun-dwg2dxf' if target else 'barun-dwg2dxf.exe')
    path.parent.mkdir(parents=True)
    path.write_bytes(b'fake executable')
    return path


def invoke(env, platform):
    if platform == 'windows':
        return env.desktop['build_acadrust_runtime']()
    return env.mac['build_acadrust']('arm64', env.work)


@pytest.mark.parametrize('platform', ['windows', 'mac'])
def test_cargo_missing_stops_build(build_env, platform):
    build_env.copy.which.return_value = None
    with pytest.raises(SystemExit, match='cargo'):
        invoke(build_env, platform)
    build_env.run.assert_not_called()


@pytest.mark.parametrize('platform', ['windows', 'mac'])
def test_cargo_failure_stops_build(build_env, platform):
    build_env.run.side_effect = subprocess.CalledProcessError(101, ['cargo', 'build'])
    with pytest.raises(subprocess.CalledProcessError):
        invoke(build_env, platform)
    assert not (build_env.root / 'acadrust-runtime').exists()
    build_env.mac['replace_folder'].assert_not_called()


@pytest.mark.parametrize('platform', ['windows', 'mac'])
def test_missing_binary_stops_build(build_env, platform):
    with pytest.raises(SystemExit, match='만들어지지 않았습니다'):
        invoke(build_env, platform)
    build_env.mac['replace_folder'].assert_not_called()


@pytest.mark.parametrize('platform', ['windows', 'mac'])
@pytest.mark.parametrize('name', LICENSE_NAMES)
def test_every_notice_is_required(build_env, platform, name):
    binary(build_env, 'aarch64-apple-darwin' if platform == 'mac' else None)
    (build_env.source / name).unlink()
    with pytest.raises(SystemExit, match='고지 파일'):
        invoke(build_env, platform)
    build_env.mac['replace_folder'].assert_not_called()


def assert_notices(env, runtime):
    for name in LICENSE_NAMES:
        assert (runtime / name).read_bytes() == (env.source / name).read_bytes()


def test_windows_build_command_and_staging(build_env):
    binary(build_env)
    invoke(build_env, 'windows')
    build_env.run.assert_called_once_with(['cargo', 'build', '--release', '--locked'], cwd=build_env.source, check=True)
    runtime = build_env.root / 'acadrust-runtime'
    assert (runtime / 'barun-dwg2dxf.exe').read_bytes() == b'fake executable'
    assert_notices(build_env, runtime)


@pytest.mark.parametrize(('arch', 'target'), [('arm64', 'aarch64-apple-darwin'), ('x64', 'x86_64-apple-darwin')])
def test_mac_target_command_notices_and_staged_smoke(build_env, arch, target):
    binary(build_env, target)
    build_env.mac['platform'].machine = lambda: 'arm64' if arch == 'arm64' else 'x86_64'
    build_env.mac['build_acadrust'](arch, build_env.work)
    assert build_env.run.call_args_list[0].args[0] == ['cargo', 'build', '--release', '--locked', '--target', target]
    assert build_env.run.call_args_list[0].kwargs['cwd'] == build_env.source
    assert build_env.run.call_args_list[0].kwargs['check'] is True
    staged = build_env.work / 'acadrust-out'
    assert build_env.run.call_args_list[1].args[0] == [str(staged / 'barun-dwg2dxf')]
    runtime = build_env.root / ('acadrust-runtime-mac-' + arch)
    build_env.mac['replace_folder'].assert_called_once_with(runtime, staged)
    assert (runtime / 'barun-dwg2dxf').read_bytes() == b'fake executable'
    assert_notices(build_env, runtime)


@pytest.mark.parametrize('failure', [SimpleNamespace(returncode=1, stdout='', stderr='wrong architecture'), OSError('bad executable')])
def test_mac_failed_staged_smoke_never_replaces_runtime(build_env, failure):
    binary(build_env, 'aarch64-apple-darwin')
    build_env.run.side_effect = [SimpleNamespace(returncode=0), failure]
    with pytest.raises((SystemExit, OSError)):
        invoke(build_env, 'mac')
    build_env.mac['replace_folder'].assert_not_called()


@pytest.mark.parametrize('missing', ['dwg-runtime-mac-arm64', 'acadrust-runtime-mac-arm64'])
def test_mac_preflight_requires_both_runtimes(tmp_path, missing):
    for folder in ('dwg-runtime-mac-arm64', 'acadrust-runtime-mac-arm64'):
        if folder != missing:
            (tmp_path / folder).mkdir()
    tree = ast.parse((ROOT / 'build_desktop.py').read_text(encoding='utf-8'))
    loop = next(node for node in ast.walk(tree) if isinstance(node, ast.For) and isinstance(node.target, ast.Name) and node.target.id == 'folder' and 'runtime-mac-' in ast.unparse(node))
    with pytest.raises(SystemExit, match=missing):
        exec(compile(ast.Module(body=[loop], type_ignores=[]), 'preflight', 'exec'), dict(root=tmp_path, arch='arm64'))


@pytest.mark.parametrize(('mac', 'arch'), [(False, 'x64'), (True, 'arm64'), (True, 'x64')])
def test_pyinstaller_includes_primary_and_auxiliary(tmp_path, mac, arch):
    tree = ast.parse((ROOT / 'build_desktop.py').read_text(encoding='utf-8'))
    start = next(i for i, node in enumerate(tree.body) if isinstance(node, ast.Assign) and any(isinstance(t, ast.Name) and t.id == 'runtime_suffix' for t in node.targets))
    end = next(i for i in range(start, len(tree.body)) if isinstance(tree.body[i], ast.Assign) and "root / 'fonts'" in ast.unparse(tree.body[i]))
    state = dict(root=tmp_path, arch=arch, mac=mac, os=os, args=['server.py'])
    exec(compile(ast.Module(body=tree.body[start:end], type_ignores=[]), 'runtime_args', 'exec'), state)
    suffix = '-mac-' + arch if mac else ''
    assert state['args'] == ['--add-data', str(tmp_path / ('dwg-runtime' + suffix)) + os.pathsep + 'dwg-runtime', '--add-data', str(tmp_path / ('acadrust-runtime' + suffix)) + os.pathsep + 'acadrust-runtime', 'server.py']


@pytest.mark.parametrize(('machine', 'arch'), [('arm64', 'arm64'), ('x86_64', 'x64')])
def test_mac_source_runtime_lookup_uses_staging_names(tmp_path, machine, arch):
    namespace = load_functions('runtime_paths.py', ROOT=tmp_path, sys=SimpleNamespace(platform='darwin'), platform=SimpleNamespace(machine=lambda: machine))
    expected = tmp_path / ('acadrust-runtime-mac-' + arch)
    expected.mkdir()
    assert namespace['bundled_runtime']('acadrust-runtime') == expected
