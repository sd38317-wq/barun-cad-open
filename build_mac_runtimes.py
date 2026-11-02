"""macOS 용 DWG 변환기 두 개를 소스에서 다시 만든다(Mac 에서 실행).

- dwg-runtime-mac-<arch>/      : converter/ (ACadSharp, .NET 8) 를 self-contained 로 게시한 BarunConverter
- acadrust-runtime-mac-<arch>/ : converter-rs/ (acadrust, Rust) 를 빌드한 barun-dwg2dxf

Windows 용 dwg-runtime/, acadrust-runtime/ 은 건드리지 않는다. 설치본을 만들 때 build_desktop.py 가
이 폴더를 엔진 안의 dwg-runtime/, acadrust-runtime/ 이름으로 담는다.

필요: .NET 8 SDK (DOTNET 환경변수 또는 ~/.barun-toolchain/dotnet/dotnet), Rust/Cargo, 해당 Rust 대상, Xcode 명령줄 도구.
사용법: python3 build_mac_runtimes.py [--arch arm64|x64]
"""
import argparse, os, platform, shutil, subprocess, sys, tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent
MIN_MACOS = '12.0'


def native_smoke_available(arch):
    native = {'arm64': 'arm64', 'aarch64': 'arm64', 'x86_64': 'x64', 'AMD64': 'x64'}.get(platform.machine())
    if native == arch:
        return True
    print(f'실행 검사 생략: 대상 {arch}, 현재 {platform.machine()}. 대상 Mac에서 실행 검사가 필요합니다.')
    return False


def dotnet():
    found = os.environ.get('DOTNET') or shutil.which('dotnet') or str(Path.home() / '.barun-toolchain' / 'dotnet' / 'dotnet')
    if not Path(found).is_file(): raise SystemExit('.NET 8 SDK 가 없습니다. DOTNET 환경변수로 dotnet 경로를 알려 주세요.')
    return found


def replace_folder(target, staged):
    """완성된 결과만 소스 폴더로 옮긴다(중간에 실패하면 기존 폴더를 그대로 둔다)."""
    old = target.with_name(target.name + '.old')
    if old.exists(): shutil.rmtree(old)
    if target.exists(): target.rename(old)
    shutil.copytree(staged, target)
    if old.exists(): shutil.rmtree(old)


def build_converter(arch, work):
    source = work / 'converter'
    shutil.copytree(ROOT / 'converter', source, ignore=shutil.ignore_patterns('bin', 'obj'))
    out = work / 'converter-out'
    env = {**os.environ, 'MACOSX_DEPLOYMENT_TARGET': MIN_MACOS, 'DOTNET_CLI_TELEMETRY_OPTOUT': '1', 'DOTNET_NOLOGO': '1'}
    subprocess.run([dotnet(), 'publish', str(source / 'BarunConverter.csproj'), '-c', 'Release', '-r', f'osx-{arch}', '--self-contained', 'true', '-o', str(out)], check=True, env=env)
    for pdb in out.glob('*.pdb'): pdb.unlink()   # 디버그 기호는 싣지 않는다
    # 디버거·덤프 도구는 BarunConverter.csproj(DropDiagnosticsMac)가 지운다. 남아 있으면 서명·공증에 걸리므로 멈춘다.
    left = [p.name for p in (out.iterdir() if out.is_dir() else ()) if p.name in ('createdump', 'libmscordbi.dylib', 'libdbgshim.dylib') or p.name.startswith('libmscordaccore')]
    if left: raise SystemExit('맥 변환기에 디버그 도구가 남았습니다: ' + ', '.join(left))
    for name in ('ACadSharp-LICENSE.txt', 'DOTNET-LICENSE.txt', 'DOTNET-THIRD-PARTY-NOTICES.txt'):
        shutil.copy2(ROOT / 'dwg-runtime' / name, out / name)
    if native_smoke_available(arch):
        smoke = subprocess.run([str(out / 'BarunConverter')], capture_output=True, text=True, timeout=60)
        if smoke.returncode != 2 or 'required' not in smoke.stderr: raise SystemExit('Mac 용 BarunConverter 가 실행되지 않습니다: ' + smoke.stderr[-300:])
    replace_folder(ROOT / f'dwg-runtime-mac-{arch}', out)


def build_acadrust(arch, work):
    target='aarch64-apple-darwin' if arch=='arm64' else 'x86_64-apple-darwin'
    cargo=shutil.which('cargo')
    if not cargo: raise SystemExit('acadrust 보조 엔진을 만들 cargo가 없습니다.')
    subprocess.run([cargo,'build','--release','--locked','--target',target],cwd=ROOT/'converter-rs',check=True,
                   env={**os.environ, 'MACOSX_DEPLOYMENT_TARGET': MIN_MACOS})
    source=ROOT/'converter-rs'/'target'/target/'release'/'barun-dwg2dxf'
    if not source.is_file(): raise SystemExit(f'acadrust 보조 엔진이 만들어지지 않았습니다: {source}')
    out=work/'acadrust-out'; out.mkdir()
    shutil.copy2(source,out/'barun-dwg2dxf')
    for name in ('LICENSE','NOTICE','THIRD_PARTY_LICENSES.txt'):
        src=ROOT/'converter-rs'/name
        if not src.is_file(): raise SystemExit(f'acadrust 고지 파일이 없습니다: {src}')
        shutil.copy2(src,out/name)
    if native_smoke_available(arch):
        smoke = subprocess.run([str(out / 'barun-dwg2dxf')], capture_output=True, text=True, encoding='utf-8', timeout=60)
        if smoke.returncode != 1 or '사용법: barun-dwg2dxf' not in smoke.stdout:
            raise SystemExit('Mac 용 보조 변환기가 실행되지 않습니다: ' + (smoke.stderr or smoke.stdout)[-300:])
    replace_folder(ROOT/f'acadrust-runtime-mac-{arch}',out)


def main():
    if sys.platform != 'darwin': raise SystemExit('이 스크립트는 Mac 에서만 실행합니다.')
    parser = argparse.ArgumentParser()
    parser.add_argument('--arch', choices=('arm64', 'x64'), default='arm64' if platform.machine() == 'arm64' else 'x64')
    arch = parser.parse_args().arch
    with tempfile.TemporaryDirectory(prefix='barun-mac-runtimes-') as temp:
        work = Path(temp)
        build_converter(arch, work)
        build_acadrust(arch, work)
    print(f'완료: dwg-runtime-mac-{arch}/, acadrust-runtime-mac-{arch}/')


if __name__ == '__main__':
    main()
