"""Repeatable desktop build with a bundled Python CAD engine (Windows NSIS, macOS dmg).

macOS 는 정식 6 채널만 만든다: python3 build_desktop.py --official6 [--arch arm64|x64]
Mac 빌드는 공유(네트워크) 폴더가 아니라 Mac 로컬 복사본에서, Mac 용 node_modules(npm ci)와
build_mac_runtimes.py 로 만든 변환기(dwg-runtime-mac-<arch>/, acadrust-runtime-mac-<arch>/)를 갖춘 뒤 실행한다."""
from pathlib import Path
import subprocess,sys,json,shutil,os,re,platform
beta='--beta' in sys.argv
official5='--official5' in sys.argv
official6='--official6' in sys.argv
# 엔진 우리 모듈은 기계어(.pyd, Nuitka)로 싣는다(10/21, 소스 복원 막기). --no-native 는 예전 바이트코드 묶음(시험·비상용).
# Windows keeps native compilation by default; Mac keeps its established build unless --native is requested.
native=(sys.platform=='win32' or '--native' in sys.argv) and '--no-native' not in sys.argv
if sum((beta,official5,official6))>1:raise SystemExit('배포 채널은 하나만 선택할 수 있습니다')
root=Path(__file__).parent
version=json.loads((root/'package.json').read_text(encoding='utf8'))['version']
# 핵심 자산(pro.pack: 지식·레이어 정리·법규 검사)은 서버(barunarc.co.kr vault-key)와 같은 비밀로 잠근다. 비밀이 없으면 빌드하지 않는다.
vault_master=os.environ.get('BARUN_VAULT_MASTER') or ((Path.home()/'.barun'/'vault-master.hex').read_text(encoding='utf8').strip() if (Path.home()/'.barun'/'vault-master.hex').is_file() else '')
if not re.fullmatch('[0-9a-f]{64}',vault_master):raise SystemExit('pro.pack 을 잠글 비밀이 없습니다: %USERPROFILE%/.barun/vault-master.hex(64자리 hex) 또는 BARUN_VAULT_MASTER')
# 6 은 자동 업데이트: 사용자에게 보일 "무엇이 바뀌었나"(build/release-notes.md, latest.yml 과 업데이트 뒤 창)가 이 판 것이어야 한다.
if official6:
    notes_title=(root/'build'/'release-notes.md').read_text(encoding='utf8').splitlines()[0]
    if version not in notes_title:raise SystemExit(f'build/release-notes.md 첫 줄이 이번 판({version})이 아닙니다: {notes_title}  — 사용자에게 보일 변경 내용을 먼저 고치세요.')
mac=sys.platform=='darwin'
MIN_MACOS='12.0'
if mac:
    os.environ['MACOSX_DEPLOYMENT_TARGET']=MIN_MACOS

def build_acadrust_runtime():
    cargo=shutil.which('cargo')
    if not cargo: raise SystemExit('acadrust 보조 엔진을 만들 cargo가 없습니다. Rust를 설치한 뒤 다시 빌드하세요.')
    subprocess.run([cargo,'build','--release','--locked'],cwd=root/'converter-rs',check=True)
    source=root/'converter-rs'/'target'/'release'/('barun-dwg2dxf.exe' if os.name=='nt' else 'barun-dwg2dxf')
    if not source.is_file(): raise SystemExit(f'acadrust 보조 엔진이 만들어지지 않았습니다: {source}')
    runtime=root/'acadrust-runtime'; runtime.mkdir(exist_ok=True); shutil.copy2(source,runtime/source.name)
    for name in ('LICENSE','NOTICE','THIRD_PARTY_LICENSES.txt'):
        src=root/'converter-rs'/name
        if not src.is_file(): raise SystemExit(f'acadrust 고지 파일이 없습니다: {src}')
        shutil.copy2(src,runtime/name)

if not mac: build_acadrust_runtime()
arch=(sys.argv[sys.argv.index('--arch')+1] if '--arch' in sys.argv else ('arm64' if platform.machine()=='arm64' else 'x64')) if mac else 'x64'
if mac and native and platform.machine()!=('arm64' if arch=='arm64' else 'x86_64'):
    raise SystemExit('Native Mac builds require the host architecture to match --arch; use the target Mac or omit --native.')
npm='npm' if mac else 'npm.cmd'
exe='' if mac else '.exe'
# esbuild 의 bin/esbuild 는 Windows 에서는 JS 시동 파일이지만, Mac 에서는 설치 때 진짜 실행 파일로 바뀐다(node 로 읽으면 문법 오류).
esbuild=[str(root/'node_modules'/'esbuild'/'bin'/'esbuild')] if mac else ['node','node_modules/esbuild/bin/esbuild']
if mac:
    # 바른 CAD 는 베타판을 만들지 않고, 5 는 Windows 전용 옛 채널이다.
    if not official6:raise SystemExit('Mac 빌드는 --official6 채널만 지원합니다.')
    if arch not in ('arm64','x64'):raise SystemExit('--arch 는 arm64 또는 x64 입니다.')
    # 네트워크 폴더(SMB 등)에 만든 실행 파일에는 macOS 가 격리 표시를 붙여 실행을 막는다. 로컬 디스크에서만 빌드한다.
    mounts=[line.split(' on ',1)[1].rsplit(' (',1) for line in subprocess.run(['mount'],capture_output=True,text=True,check=True).stdout.splitlines() if ' on ' in line]
    here=str(root.resolve());owner=max((m for m in mounts if here==m[0] or here.startswith(m[0].rstrip('/')+'/')),key=lambda m:len(m[0]),default=None)
    if owner and owner[1].split(',')[0] in ('smbfs','afpfs','nfs','webdav'):raise SystemExit(f'Mac 빌드는 네트워크 폴더({owner[0]})에서 할 수 없습니다. Mac 로컬 디스크로 복사한 소스에서 빌드하세요.')
    if not (root/'node_modules'/'electron'/'dist'/'Electron.app').is_dir():raise SystemExit('Mac 용 node_modules 가 없습니다. 이 폴더에서 npm ci 를 먼저 실행하세요.')
    for folder in (f'dwg-runtime-mac-{arch}', f'acadrust-runtime-mac-{arch}'):
        if not (root/folder).is_dir():raise SystemExit(f'{folder}/ 가 없습니다. python3 build_mac_runtimes.py --arch {arch} 를 먼저 실행하세요.')
    # 맥 설치판은 Developer ID 서명 + Apple 공증만 낸다. 인증서 이름과 공증 열쇠는 ~/.barun/mac-signing.env(export 이름=값)에서 읽는다(이미 환경에 있으면 그것).
    signing_env=Path.home()/'.barun'/'mac-signing.env'
    if signing_env.is_file():
        for line in signing_env.read_text(encoding='utf8').splitlines():
            found=re.fullmatch(r'\s*(?:export\s+)?([A-Z_][A-Z0-9_]*)=(.*?)\s*',line)
            if found and found[1] not in os.environ:os.environ[found[1]]=found[2].strip('\'"')
    missing=[name for name in ('CSC_NAME','APPLE_API_KEY','APPLE_API_KEY_ID','APPLE_API_ISSUER') if not os.environ.get(name)]
    if missing:raise SystemExit('맥 서명·공증 설정이 없습니다('+', '.join(missing)+'): ~/.barun/mac-signing.env 를 확인하세요. 임시 서명판은 만들지 않습니다.')
    os.environ['APPLE_API_KEY']=str(Path(os.environ['APPLE_API_KEY']).expanduser())
    if not Path(os.environ['APPLE_API_KEY']).is_file():raise SystemExit('공증 열쇠 파일(APPLE_API_KEY)이 없습니다: '+os.environ['APPLE_API_KEY'])
    identities=subprocess.run(['security','find-identity','-v','-p','codesigning'],capture_output=True,text=True).stdout
    if 'Developer ID Application: '+os.environ['CSC_NAME'].removeprefix('Developer ID Application: ') not in identities:raise SystemExit('키체인에 Developer ID Application 인증서가 없습니다: '+os.environ['CSC_NAME'])
    os.environ.pop('CSC_IDENTITY_AUTO_DISCOVERY',None)
    # 서명 뒤 검사(build/verify-signed.cjs)가 엔진 단독 시험(standalone_smoke.py)을 이 파이썬으로 다시 돌린다.
    os.environ['BARUN_BUILD_PYTHON']=sys.executable
# Windows 6 설치 파일 코드 서명(Azure Artifact Signing). 값은 환경변수·%USERPROFILE%/.barun/code-signing.json 에서만 읽는다(code_signing.py).
# 일부만 채워졌거나 build/code-signing.json 이 서명을 요구하는데 없으면 여기서 멈춘다. 없으면 지금처럼 서명 없이 만들고 크게 알린다.
import code_signing
sign_options,sign_env=code_signing.load() if (official6 and not mac) else (None,{})
if official6 and not mac:print(code_signing.unsigned_banner() if sign_options is None else f'코드 서명: {sign_options["publisherName"]} ({sign_options["endpoint"]}, 프로필 {sign_options["certificateProfileName"]})')
# A build is not releasable if a previously fixed interaction regresses.
subprocess.run([npm,'test'],cwd=root,check=True)
if official5:subprocess.run(['node','--test','official-packaging.test.cjs'],cwd=root,check=True)
if official6:subprocess.run(['node','--test','official6-packaging.test.cjs'],cwd=root,check=True)
subprocess.run([sys.executable,'-m','unittest','test_browser_assets.py'],cwd=root,check=True)
subprocess.run([sys.executable,'-m','unittest','test_code_signing.py'],cwd=root,check=True)
subprocess.run([sys.executable,'-m','unittest','test_server_import_path.py'],cwd=root,check=True)
subprocess.run([sys.executable,'-m','unittest','test_dxf_shared_import','test_multi_plot_pdf'],cwd=root,check=True)
subprocess.run(['node','--test','desktop-http.test.cjs'],cwd=root,check=True)
subprocess.run([*esbuild,'vendor/plan/entry.ts','--bundle','--format=esm','--outfile=plan-layout.js'],cwd=root,check=True)
subprocess.run([npm,'run','build:livecheck'],cwd=root,check=True)
# 화면 코드는 낱개 소스로 담지 않는다. 한 덩어리로 묶고 이름까지 줄여서 담는다.
# app.js 가 늦게 부르는 review-3d·auto-plan 은 따로 뽑아 두어야 켤 때 같이 딸려오지 않는다.
# livecheck-worker.js 는 Worker 라 묶이지 않으므로 따로 만들어 옆에 둔다.
# livecheck-engine.js 는 시험에서만 쓰므로 아예 담지 않는다.
dist=root/'tmp'/'dist'
if dist.resolve()!=root.resolve()/'tmp'/'dist' or dist.is_symlink():raise RuntimeError('Unsafe build output path')
shutil.rmtree(dist,ignore_errors=True)
# lisp-worker.js(리습 전용 Worker)도 입구로 함께 묶는다. 같은 dist 에 lisp-worker.js 로 나와 app.js 와 조각(chunk)을 나눠 쓴다.
# 바로 그려야 하는 핵심(도면 생성기·상세 규칙·IFC·상세 찾기)은 따로 입구로 뽑아 screen.pack 으로 잠근다(screen_lock.py).
# 화면은 lockedImport 로만 부른다. BARUN_SCREEN_VAULT 정의가 있으면 screen-vault.js 가 엔진에서 받아 blob 으로 불러온다.
import screen_lock
subprocess.run([*esbuild,'app.js','review-3d.js','site-3d.js','tablet-input.js','lisp-worker.js','mcp-lisp.js','ai-layer-policy.js','app-ai-tools.js','ai-commit.js','command-worker.js','gpu-compile-worker.js','gpu-render-worker.js',*screen_lock.LOCKED_ENTRIES,
                '--bundle','--format=esm','--splitting','--platform=browser','--minify','--legal-comments=none','--define:BARUN_SCREEN_VAULT=true',
                # 레이어 정리 지식은 묶음에 평문으로 넣지 않는다. 실행할 때 엔진이 pro.pack 에서 꺼내 준다(vault_gate.screen_file).
                '--external:./occt-client.js','--external:./layer-knowledge-data.js','--external:./layer-ranking-data.js','--external:./layer-standards-data.js',
                '--metafile=tmp/dist-meta.json','--outdir='+str(dist.relative_to(root)).replace(chr(92),'/')],cwd=root,check=True)
screen=screen_lock.split(dist,root/'tmp'/'dist-meta.json',root)
bundled=[f for f in sorted(dist.glob('*.js')) if f.name not in screen['files']]
if not bundled:raise RuntimeError('묶인 화면 코드가 나오지 않았습니다')
# 서버로 옮긴 계산 코드(compute/)가 화면 묶음에 딸려 오면 바로 멈춘다(설치판 마지막 검사도 같은 문장으로 다시 본다).
from release_encryption_check import SERVER_COMPUTE_MARKERS
leaked=[f.name for f in bundled if any(marker in f.read_bytes() for marker in SERVER_COMPUTE_MARKERS)]
if leaked:raise SystemExit('서버 계산 코드(compute/)가 화면 묶음에 들어갔습니다: '+', '.join(leaked))
# 문장 표식과 별도로 묶음 입력 목록도 본다: compute/ 파일이 하나라도 입력이면 멈춘다.
leaked=[name for name in json.loads((root/'tmp'/'dist-meta.json').read_text(encoding='utf-8'))['inputs'] if name.replace(chr(92),'/').startswith('compute/')]
if leaked:raise SystemExit('서버 계산 코드(compute/)가 화면 묶음 입력에 있습니다: '+', '.join(leaked))
# 설치판 서버가 내주지 않는 조각 이름이면 마지막 점검(standalone_smoke)까지 가기 전에 멈춘다.
import re
from server import BUNDLE_CHUNK_PATTERN
entries={'app.js','review-3d.js','site-3d.js','tablet-input.js','lisp-worker.js','mcp-lisp.js','ai-layer-policy.js','app-ai-tools.js','ai-commit.js','command-worker.js','gpu-compile-worker.js','gpu-render-worker.js'}
unknown=[f.name for f in bundled if f.name not in entries and not re.fullmatch(BUNDLE_CHUNK_PATTERN,'/'+f.name)]
if unknown:raise SystemExit('설치판 서버가 모르는 묶음 조각: '+', '.join(unknown)+' — server.py BUNDLE_CHUNK_PATTERN 에 더하세요')
# 법규 검사(livecheck-worker.js)도 pro.pack 으로만 싣는다.
assets=[*bundled,root/'index.html',root/'tablet.html',root/'style.css',root/'menu-shell.css',root/'barun-air.css',root/'common-account-update.css',root/'package.json',root/'THIRD_PARTY_NOTICES.md',root/'THREE-LICENSE.txt',root/'barun-cad-brand.png']
# GPU 비교/선택 화면은 동적으로 읽는 자산이라 PyInstaller에 명시적으로 포함한다.
# 대기화면 3종(아파트·소규모 배치·단면 상세). 화면 스크립트는 따로 한 덩어리로 묶어(필요한 view.js 등 포함) 싣는다.
# 예시 기록(apt_example·site_example·detail_data)은 보호 자원이라 싣지 않는다(사장님 2026-10-23, release_encryption_check 가 막음).
# 없으면 화면은 실제 값과 '계산 중'만 보이고, 엔진 실시간 탐색 걸음이 오면 그 자리에 그린다.
wait_dist=root/'tmp'/'wait-dist'/'wait-screens'
subprocess.run([*esbuild,'wait-screens/site-wait-frame.js','wait-screens/drafting-main.js','--bundle','--format=esm','--platform=browser','--minify','--legal-comments=none','--outdir='+str(wait_dist.relative_to(root)).replace(chr(92),'/')],cwd=root,check=True)
assets += [root/'wait-screens'/name for name in ('apartment.html','apartment-embed.js','site.html','drafting.html')]+sorted(wait_dist.glob('*.js'))
# GPU code is bundled by esbuild into the normal browser assets above. Keep the
# third-party notices beside the bundled vendor name so the installed copy is
# auditable without accidentally serving a second, stale renderer.
assets += [root/name for name in ('vendor/mlightcad.js.LEGAL.txt','vendor/mlightcad.NOTICE.txt')]
# OCCT는 첫 명령에서만 Worker로 로드된다. 설치판에는 실행 모듈과 고지 파일만 싣고, 단일 JS·WASM(22MB)은
# 처음 쓸 때 occt_remote 가 홈페이지(/downloads/barun-cad-occt/<판>/, 비공개 릴리스 occt-<판>)에서 받아 sha256 검사 후 이 PC 에 둔다(설치본 줄이기 10/18).
assets += [root/name for name in ('occt-client.js','occt-worker.js','occt-loader.js','occt-building.js','occt-kernel.js','occt-section.js','occt-commands.js',
    'vendor/occt-pkg/package.json','vendor/occt-pkg/NOTICE.md',
    'vendor/occt-pkg/node_modules/replicad-opencascadejs/LICENSE')]
# 잠근 조각 + 순서·지문(manifest.json)을 써 둔다. pro.pack 처럼 release_encryption_check 가 이 폴더와 묶음을 대조한다.
screen_lock.drop_shipped(screen,[*assets,*(root/'shared'/'account-window').rglob('*')])
screen_dir=root/'tmp'/'screen-vault'
shutil.rmtree(screen_dir,ignore_errors=True)
for name,raw in screen_lock.pack_files(screen).items():
    (screen_dir/name).parent.mkdir(parents=True,exist_ok=True);(screen_dir/name).write_bytes(raw)
backend_name='arun-cad-beta-server' if beta else 'barun-cad-5-server' if official5 else 'barun-cad-6-server' if official6 else 'barun-cad-server'
backend_dist='desktop-backend-beta' if beta else f'desktop-backend-{version}'+('-mac' if mac else '') if (official5 or official6) else 'desktop-backend'
args=[sys.executable,'-m','PyInstaller','--noconfirm','--clean','--onedir','--name',backend_name,'--distpath',backend_dist,'--workpath','tmp/pyinstaller-beta' if beta else 'tmp/pyinstaller']
for asset in assets:
    dest='wait-screens' if asset.parent.name=='wait-screens' else '.artifact-runtime' if asset.name=='excel_service.mjs' else ('vendor/'+asset.relative_to(root/'vendor').parent.as_posix() if asset.is_relative_to(root/'vendor') else '.')
    args+=['--add-data',str(asset)+os.pathsep+dest]
# 공통 계정 창은 폴더째 싣는다(renderer.mjs가 import.meta.url 기준으로 계약·CSS·심볼을 읽는다). 어댑터는 app.js 묶음에 들어간다.
args+=['--add-data',str(root/'shared'/'account-window')+os.pathsep+'shared/account-window']
# 가볍게: ezdxf 부가 기능이 끌어오는 matplotlib·tkinter(Tcl/Tk)는 엔진이 쓰지 않는다(약 23MB).
args+=['--exclude-module','matplotlib','--exclude-module','tkinter','--exclude-module','_tkinter']
# PyMuPDF(AGPL)도 뺀다: 우리 코드는 쓰지 않는데 --collect-all ezdxf 가 ezdxf 의 pymupdf 그림 부록을 따라 같이 묶는다.
args+=['--exclude-module','fitz','--exclude-module','pymupdf']
# lxml(약 7MB)은 openpyxl 이 있으면 골라 쓰는 선택 부품이다. 없으면 표준 XML 쓰기로 같은 시트 구조를 만든다(요소·속성·값 같음, 2026-10-17 대조).
# pyproj(약 27MB)는 korea_crs.py(한국 좌표계 순수 파이썬, pyproj 와 0.00001mm 이내 대조 시험 test_korea_crs.py)로 바꿨다.
args+=['--exclude-module','lxml','--exclude-module','pyproj']
# The asset client is imported lazily by API handlers; package code, never server originals.
hidden=['cad_asset_client','asset_preview','layout_context','site_placement','chat_images','access_context','safe_writes','indong_relay','occt_remote','mcp_register','tomllib']
# 인허가 도서(에너지·편의시설): permit_book_service 가 tools/ 의 도서 엔진을 실행 중에 부른다(sys.path) — PyInstaller 가 못 보니 경로·모듈을 적어 준다.
hidden+=['permit_book_service','energy_envelope_service','energy_envelope','energy_insulation_check']
args+=['--paths',str(root/'tools'),'--collect-submodules','energy_plan','--collect-submodules','plan_book','--collect-submodules','access_plan']
entry='server.py'
if native:
    import native_build
    ours,others=native_build.scan(excludes=('matplotlib','tkinter','_tkinter','fitz','pymupdf','lxml','pyproj'))
    compiled=native_build.compile_modules(ours)
    # 원본 .py 는 빼고 .pyd 를 싣는다. .pyd 속 import 는 PyInstaller 가 못 보니 원본으로 뽑은 목록을 hidden import 로.
    args+=native_build.pyinstaller_args(compiled,others)
    hidden=[name for name in hidden if name not in compiled]
    entry=native_build.ENTRY
for name in hidden:args+=['--hidden-import',name]
args+=['--collect-all','ezdxf','--collect-all','reportlab','--collect-all','openpyxl','--collect-all','shapely','--collect-all','pypdf',entry]
# Mac 은 Mac 용 변환기를 같은 이름(dwg-runtime/, acadrust-runtime/)으로 담는다. 엔진은 이름으로 찾는다(runtime_paths.py).
runtime_suffix=f'-mac-{arch}' if mac else ''
args[-1:-1]=['--add-data',str(root/('dwg-runtime'+runtime_suffix))+os.pathsep+'dwg-runtime']
runtime_folder=(root/f'acadrust-runtime-mac-{arch}' if mac else root/'acadrust-runtime')
args[-1:-1]=['--add-data',str(runtime_folder)+os.pathsep+'acadrust-runtime']
args[-1:-1]=['--add-data',str(root/'fonts')+os.pathsep+'fonts']
# 핵심 자산은 낱개 파일로 싣지 않는다. 설치 폴더를 열어도 그냥 읽히기 때문이다.
# 핵심 자산은 서버 열쇠 묶음(pro.pack — 로그인한 PC만 서버에서 열쇠를 받아 푼다, vault_gate.py).
sys.path.insert(0,str(root))
import vault,vault_gate,release_encryption_check
# 상세·동평면·주동은 서버 전용이다. 기하/목록/원본 팩을 화면 자료나 pro.pack에 섞으면 중단한다.
release_encryption_check.assert_no_server_assets({asset.relative_to(root).as_posix(): asset.read_bytes() for asset in assets})
pro_sources=vault_gate.source_files()
release_encryption_check.assert_no_server_assets(pro_sources)
pack_dir=root/'tmp'/'pack';pack_dir.mkdir(parents=True,exist_ok=True)
preview_files=release_encryption_check.preview_source_files()
preview_blob=(root/'tmp/cad-assets/asset-preview.pack').read_bytes()
release_encryption_check.assert_no_server_assets({'rules/asset-preview.pack':preview_blob})
(pack_dir/'asset-preview.pack').write_bytes(vault.pack(vault.unpack(preview_blob),vault_gate.derive_key(vault_master,ver=version)))  # 서버 열쇠: 로그인 뒤에만 열린다
# 동봉 건축 리습(examples/architecture-lisp)은 2026-10-27 설치판에서 뺐다 — 기본 건축 명령과 같은 일. 파일은 리습 엔진 시험용으로 저장소에만 둔다.
(pack_dir/'layer-standards.pack').write_bytes(vault.pack({'layer-standards-data.js':(root/'layer-standards-data.js').read_bytes()}))
(pack_dir/'pro.pack').write_bytes(vault.pack(pro_sources,vault_gate.derive_key(vault_master,ver=version)))
(pack_dir/'screen.pack').write_bytes(vault.pack(release_encryption_check.screen_source_files(),vault_gate.derive_screen_key(vault_master,ver=version)))
args[-1:-1]=['--add-data',str(pack_dir/'screen.pack')+os.pathsep+'rules']
# 엔진은 원본 결정에서 '뺄 상세 ID'만 쓴다(cad_asset_client·detail_search_library). 이유 글은 잠근 화면 코드(registry.js)에만 두고
# 설치판 평문에는 ID·결정만 싣는다 — 전체를 실으면 잠근 조각의 글이 평문으로 남아 암호화 검사가 막는다.
decisions=json.loads((root/'drawing-details/source-decisions.json').read_text(encoding='utf-8'))
(pack_dir/'drawing-details').mkdir(exist_ok=True)
(pack_dir/'drawing-details'/'source-decisions.json').write_text(json.dumps({k:{'결정':'drop'} for k,v in sorted(decisions.items()) if v.get('결정')=='drop'},ensure_ascii=False),encoding='utf-8')
args[-1:-1]=['--add-data',str(pack_dir/'drawing-details'/'source-decisions.json')+os.pathsep+'drawing-details']
args[-1:-1]=['--add-data',str(pack_dir/'asset-preview.pack')+os.pathsep+'rules']
args[-1:-1]=['--add-data',str(pack_dir/'pro.pack')+os.pathsep+'rules']
args[-1:-1]=['--add-data',str(pack_dir/'layer-standards.pack')+os.pathsep+'rules']
if mac:args[-1:-1]=['--target-arch','arm64' if arch=='arm64' else 'x86_64']
subprocess.run(args,cwd=root,check=True)
internal=root/backend_dist/backend_name/'_internal'
if native:print(f'기계어 엔진 검사 통과: 우리 모듈 {native_build.verify_bundle(root/backend_dist/backend_name/(backend_name+exe),compiled)}개 모두 .pyd, 바이트코드 0개')
# --collect-all 은 실행에 쓰지 않는 Cython 소스(ezdxf 의 *.c 등, 약 8MB)까지 담는다. 우리 코드는 AVIF 그림을 쓰지 않으므로
# Pillow 의 AVIF 부품(_avif, 약 8MB)도 뺀다. 없으면 Pillow 는 AVIF 만 꺼 두고 나머지는 그대로다. 아래 스모크 시험이 지운 뒤의 엔진을 확인한다.
for junk in [*(p for suffix in ('.c','.h','.pyx','.pxd','.pxi','.pyi') for p in internal.rglob('*'+suffix)),*internal.glob('PIL/_avif.*')]:
    if junk.is_file():junk.unlink()
# shapely 의 자체 시험(shapely/tests, 맥 wheel 에는 tests/legacy/data 까지 들어 있다)은 실행에 쓰지 않는다.
# 'data' 폴더 이름이 설치판 자료 금지 검사(build/packaged-data-policy.cjs)에 걸리므로 지운다(검사 규칙은 그대로).
shutil.rmtree(internal/'shapely'/'tests',ignore_errors=True)
# PyMuPDF(AGPL)는 싣지 않는다(spec excludes). ezdxf 부록이 끌고 오면 여기서 빌드를 멈춘다.
agpl=[p for p in internal.rglob('*') if (p.is_dir() and p.name.lower() in ('pymupdf','fitz')) or (p.is_file() and (p.name.lower()=='mupdfcpp64.dll' or (p.suffix.lower() in ('.pyd','.so','.dylib') and 'mupdf' in p.name.lower())))]
if agpl:raise SystemExit('PyMuPDF(AGPL)가 엔진에 들어갔습니다: '+', '.join(str(p.relative_to(internal)) for p in agpl))
# Fail the release if the bundled engine relies on the developer profile or PATH.
if not mac or platform.machine()==('arm64' if arch=='arm64' else 'x86_64'):
    subprocess.run([sys.executable,str(root/'standalone_smoke.py'),str(root/backend_dist/backend_name/(backend_name+exe)),'--output',str(root/('tmp/release-standalone-smoke-beta.json' if beta else 'tmp/release-standalone-smoke.json'))],cwd=root,check=True)
else:
    print(f'실행 검사 생략: 대상 {arch}, 현재 {platform.machine()}. 대상 Mac에서 standalone_smoke.py 검사가 필요합니다.')
# 설치 파일은 electron-builder 가 한 번만 만든다.
# 예전에는 여기서 installer.nsi 로 한 벌 더 만들어 폴더에 이름이 비슷한 파일이 둘씩 남았고,
# 그쪽은 latest.yml 을 만들지 않아 온라인 업데이트가 붙지 않았다.
config='electron-builder.beta.json' if beta else 'electron-builder.official5.json' if official5 else ('electron-builder.official6.mac.json' if mac else 'electron-builder.official6.json') if official6 else None
# 자동 업데이트 모듈은 의존 모듈까지 한 파일로 묶어 넣는다. electron-builder 의 node_modules 수집이
# electron-updater 의 의존 모듈(builder-util-runtime·js-yaml 등)을 빠뜨려 설치본에서 업데이트가 조용히 꺼졌었다.
updater_bundle=root/'vendor'/'electron-updater.cjs'
subprocess.run([*esbuild,'node_modules/electron-updater/out/main.js','--bundle','--platform=node','--format=cjs','--external:electron','--outfile='+str(updater_bundle)],cwd=root,check=True)
# 묶은 파일이 electron 없이도 모든 의존 모듈을 찾아 읽히는지(빠진 모듈이 있으면 여기서 실패) 확인한다.
subprocess.run(['node','-e',"const M=require('module'),o=M._load;M._load=function(r,...a){return r==='electron'?{}:o.call(this,r,...a)};const u=require(process.argv[1]);if(!('autoUpdater' in u))throw Error('autoUpdater 없음')",str(updater_bundle)],cwd=root,check=True)
builder=[npm,'exec','electron-builder','--']
if config and sign_options:
    signed_config=root/'tmp'/'electron-builder.official6.signed.json';signed_config.parent.mkdir(exist_ok=True)
    signed_config.write_text(json.dumps(code_signing.builder_config(json.loads((root/config).read_text(encoding='utf8')),sign_options),ensure_ascii=False,indent=2),encoding='utf8')
    config=str(signed_config)
# 셸 코드(desktop*.cjs·quality-*.cjs·desktop-shell.js 등)는 줄이고(minify) 주석을 빼서 싣는다 — 설치판에서 보안 설계 설명이 읽히지 않게(2026-10-23).
if config:
    shell_dir=root/'tmp'/'shell-min';shutil.rmtree(shell_dir,ignore_errors=True);shell_dir.mkdir(parents=True)
    shell_config=json.loads((root/config).read_text(encoding='utf8'))
    scripts=[f for f in shell_config['files'] if isinstance(f,str) and f.endswith(('.cjs','.js')) and '/' not in f]
    for name in scripts:subprocess.run([*esbuild,name,'--minify','--legal-comments=none','--outfile=tmp/shell-min/'+name],cwd=root,check=True)
    shell_config['files']=[f for f in shell_config['files'] if f not in scripts]+[{'from':'tmp/shell-min','to':'.','filter':scripts}]
    config=root/'tmp'/'electron-builder.shell-min.json';config.write_text(json.dumps(shell_config,ensure_ascii=False,indent=2),encoding='utf8');config=str(config)
if config: builder += ['--config',config]
# Reuse the dependency installed for this workspace instead of downloading a
# second Electron runtime during an otherwise offline, repeatable build.
local_electron=root/'node_modules'/'electron'/'dist'
if (local_electron/('Electron.app' if mac else 'electron.exe')).exists() and (not mac or platform.machine()==('arm64' if arch=='arm64' else 'x86_64')):builder += ['--config.electronDist='+str(local_electron)]
# 맥 자동 업데이트(electron-updater)는 zip 으로 바꿔 끼운다. dmg 는 처음 설치용.
builder += (['--mac','dmg','zip','--'+arch] if mac else ['--win','nsis','--x64'])+['--publish','never']
# 5.0.6 빌드 뒤 소스의 package.json 이 설치본용 짧은 메타데이터(472바이트, 검사·빌드 설정 없음)로 덮여 있었다.
# 빌드 전에 원본을 기억해 두고, 끝나면(실패해도) 바뀌었으면 되돌린다.
if mac:(root/'tmp'/f'release-{version}-mac'/'signed-check.json').unlink(missing_ok=True)   # 지난 빌드의 통과 기록으로 헛통과하지 않게
package_json=root/'package.json';package_before=package_json.read_bytes()
try:subprocess.run(builder,cwd=root,check=True,env={**os.environ,**sign_env})
finally:
    if package_json.read_bytes()!=package_before:
        package_json.write_bytes(package_before)
        print('경고: 빌드 도구가 package.json 을 바꿔 원래 내용으로 되돌렸습니다.')
out_dir=root/('installer-beta5' if beta else f'installer-{version}'+('-mac' if mac else '') if (official5 or official6) else 'installer')
installer=out_dir/('arun CAD Setup 5.exe' if beta else f'Barun CAD 5 Setup {version}.exe' if official5 else (f'Barun CAD 6 {version} Mac {arch}.dmg' if mac else f'Barun CAD 6 Setup {version}.exe') if official6 else 'Barun CAD Setup '+version+'.exe')
resources=out_dir/('mac-arm64' if arch=='arm64' else 'mac')/'Barun CAD 6.app'/'Contents'/'Resources' if mac else out_dir/'win-unpacked'/'resources'
mac_zip=installer.with_suffix('.zip') if mac else None
# 맥: 서명·공증 뒤 검사(build/verify-signed.cjs, afterSign)가 통과 기록을 남겨야 한다. 서명이 안 됐으면 afterSign 이 건너뛰어져 기록이 없다.
if mac:
    signed=root/'tmp'/f'release-{version}-mac'/'signed-check.json'
    try:signed_ok=json.loads(signed.read_text(encoding='utf8')).get('status')=='passed'
    except (OSError,ValueError):signed_ok=False
    if not signed_ok:
        for item in (installer,mac_zip):
            if item.is_file():item.replace(item.with_name(item.name+'.서명검사실패'))
        raise SystemExit('서명·공증 뒤 검사 통과 기록이 없습니다: '+str(signed))
    print('서명·공증 뒤 검사 통과')
# 모든 빌드의 마지막 단계: 보호 자원 암호화와 서버 전용 상세·동평면·주동 원본(평문·묶음 없음)을 검사한다.
# 실패하면 설치 파일 이름에 '암호화검사실패'를 붙여 실수로 배포하지 못하게 하고 빌드를 실패시킨다.
import release_encryption_check
problems=release_encryption_check.check(resources)
for problem in problems:print('암호화 검사 실패:',problem)
if problems:
    for item in (installer,mac_zip):
        if item and item.is_file():item.replace(item.with_name(item.name+'.암호화검사실패'))
    raise SystemExit('암호화 검사 실패: 이 빌드는 배포하면 안 됩니다.')
print('암호화 검사 통과')
# 보안 마무리 검사(build/release-hardening.cjs): 안전 스위치(퓨즈)·기본 화면 묶음 없음·맥 암호 없는 연결 허용 꺼짐.
# 실패하면 설치 파일 이름에 '보안검사실패'를 붙이고 빌드를 실패시킨다(암호화 검사와 같은 방식).
if official6:
    electron_app=resources.parent.parent if mac else out_dir/'win-unpacked'/'Barun CAD 6.exe'
    hardening=subprocess.run(['node','build/release-hardening.cjs','check',str(electron_app),str(resources),*([str(resources.parent/'Info.plist')] if mac else [])],cwd=root)
    if hardening.returncode!=0:
        for item in (installer,mac_zip):
            if item and item.is_file():item.replace(item.with_name(item.name+'.보안검사실패'))
        raise SystemExit('보안 마무리 검사 실패: 이 빌드는 배포하면 안 됩니다.')
# afterPack 품질 검사는 퓨즈를 끊기 전 실행 파일로 돈다(electron-builder 순서: afterPack → 퓨즈 → 서명). 퓨즈가 끊긴
# 최종 실행 파일로 한 번 더 켜서 화면·엔진이 실제로 뜨는지 본다(아스트라 검토 10-21). 실패하면 이 빌드는 배포하면 안 된다.
if official6 and not mac:
    fused_report=root/'tmp'/f'release-{version}'/'packaged-quality-fused.json'
    fused_report.unlink(missing_ok=True)
    try:fused=subprocess.run([str(out_dir/'win-unpacked'/'Barun CAD 6.exe'),'--barun-verify','--report',str(fused_report)],timeout=240).returncode==0
    except subprocess.TimeoutExpired:fused=False
    fused=fused and fused_report.is_file() and json.loads(fused_report.read_text(encoding='utf-8')).get('report',{}).get('status')=='passed'
    if not fused:
        if installer.is_file():installer.replace(installer.with_name(installer.name+'.퓨즈실행검사실패'))
        raise SystemExit('퓨즈를 끊은 실행 파일로 품질 검사 실패: 이 빌드는 배포하면 안 됩니다. '+str(fused_report))
    print('퓨즈 끊은 실행 파일 품질 검사 통과')
# 서명 검사·업데이트 설정 검사에 쓰는 설치본 실행 파일.
app_executable=out_dir/('mac-arm64' if arch=='arm64' else 'mac')/'Barun CAD 6.app' if mac else out_dir/'win-unpacked'/'Barun CAD 6.exe'
if sign_options:
    problems=code_signing.verify_signed([installer,app_executable,resources/'backend'/(backend_name+exe)],sign_options['publisherName'])
    for problem in problems:print('서명 검사 실패:',problem)
    if problems:
        if installer.is_file():installer.replace(installer.with_name(installer.name+'.서명검사실패'))
        raise SystemExit('서명 검사 실패: 이 빌드는 배포하면 안 됩니다.')
    print('서명 확인:',sign_options['publisherName'])
# 서명 판과 무서명 판이 섞여도 업데이트가 깨지지 않게: 게시자 확인은 서명 판에만 켜져 있어야 한다.
if official6 and not mac:
    problem=code_signing.update_config_problem((resources/'app-update.yml').read_text(encoding='utf8'),sign_options)
    if problem:
        if installer.is_file():installer.replace(installer.with_name(installer.name+'.업데이트설정오류'))
        raise SystemExit('업데이트 설정 검사 실패: '+problem)
# 설치본에 자동 업데이트 모듈이 들어갔는지 확인한다. 빠지면 업데이트가 조용히 꺼지므로 빌드를 실패시킨다.
if official6:
    listed=subprocess.run(['node','-e',"console.log(require('@electron/asar').listPackage(process.argv[1]).join('\\n'))",str(resources/'app.asar')],cwd=root,check=True,capture_output=True,text=True).stdout
    if not any(line.replace('\\','/').endswith('/vendor/electron-updater.cjs') for line in listed.splitlines()):
        if installer.is_file():installer.replace(installer.with_name(installer.name+'.업데이트모듈없음'))
        raise SystemExit('설치본에 자동 업데이트 모듈(vendor/electron-updater.cjs)이 없습니다.')
    print('자동 업데이트 모듈 포함 확인')
print('설치 파일:',installer)
# 자동 업데이트: 서버(downloads/barun-cad-6/)에 올릴 것만 한 폴더에 모은다. 지난 판 .blockmap 은 서버에서 지우지 않는다(바뀐 조각 계산에 쓴다).
if official6:
    upload=out_dir/'서버에 올릴 파일';shutil.rmtree(upload,ignore_errors=True);upload.mkdir()
    # Windows: 설치 파일·blockmap·latest.yml. 맥: 업데이트용 zip·blockmap 과 latest-mac.yml, 처음 설치용 dmg.
    needed=[installer,installer.with_name(installer.name+'.blockmap'),out_dir/'latest.yml'] if not mac else [installer,mac_zip,mac_zip.with_name(mac_zip.name+'.blockmap'),out_dir/'latest-mac.yml']
    for item in needed:
        if not item.is_file():raise SystemExit(f'업데이트에 필요한 파일이 없습니다: {item.name}')
        shutil.copy2(item,upload/item.name)
    if sign_options is None and not mac:   # 맥은 Developer ID 서명·공증을 위(signed-check.json)에서 이미 확인했다
        (upload/'서명 안 됨.txt').write_text(code_signing.unsigned_banner()+'\n',encoding='utf8')
        print(code_signing.unsigned_banner())
    print('서버에 올릴 파일:',upload)
