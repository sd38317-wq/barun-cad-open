"""처음 깐 사용자도 Claude·Codex 에 바른 CAD MCP 를 한 번에 붙이게 한다.

계정 창 AI 칸의 [Claude에 연결]·[Codex에 연결] 단추와 `barun-cad-6-server.exe --register-mcp claude|codex` 가 같은 함수를 쓴다.
설정 파일은 바른 CAD 항목(barun-cad)만 바꾸고 나머지는 그대로 둔다. 쓰기 전에 옆에 백업을 남긴다.
"""
import json,os,shutil,subprocess,sys,time
from pathlib import Path,PureWindowsPath

NAME='barun-cad'
ROOT=Path(__file__).resolve().parent
RESTART='연결한 AI 프로그램을 완전히 껐다가 다시 켜야 바른 CAD 도구가 보입니다.'


# AI(Codex·Claude)가 띄우는 MCP 중계는 설치 폴더 밖의 복사본에서 돈다.
# 설치 폴더의 엔진 실행 파일을 그대로 쓰면, 업데이트 설치가 그 이름(barun-cad-6-server.exe)의 프로세스를 모두 끌 때
# 중계도 같이 꺼지고 Codex·Claude 는 다시 띄우지 않아 그 대화의 모든 호출이 "Transport closed" 가 됐다(10/21 기록).
# 복사본은 이름도 달라(barun-cad-mcp.exe) 설치가 끄지 않고, 설치 파일을 잠그지도 않는다. 엔진이 바뀌어도 중계는 연결 파일로
# 새 엔진을 다시 찾으므로 대화가 끊기지 않는다.
RELAY_ROOT=Path.home()/'.barun-cad'/'mcp-relay'   # AppData 가 아닌 곳: Codex 스토어 앱은 AppData 를 따로 본다
RELAY_EXE='barun-cad-mcp.exe' if os.name=='nt' else 'barun-cad-mcp'
# 맥도 같은 중계를 쓴다(2026-10-26): 앱 묶음 안 엔진을 그대로 띄우면 앱을 업데이트·다시 깔 때 그 파일들이 바뀌어
# 돌던 중계가 'unknown encoding: idna' 로 깨지거나 같이 꺼져 Claude·Codex 연결이 계속 끊겼다.
CODEX_EXTRA={'startup_timeout_sec':60,'tool_timeout_sec':180}
# Codex 가 approval_policy=never 일 때 "MCP tool call requires approval" 로 막던 것(10/16~21 기록 5건).
# 사용자 결정(10/22): 도면을 바꾸지 않는 읽기 도구만 자동 승인, 바꾸는 도구는 Codex 승인 그대로.
READ_PREFIXES=('cad_get_','cad_search_','cad_list_','cad_view_','cad_describe_','cad_validate','cad_check_','cad_observation_',
               'cad_preview','cad_suggest_','cad_evaluate_','cad_design_reference','cad_field_records_list','cad_field_records_get')
READ_EXTRA=frozenset(('cad_lisp_list','cad_lisp_read','cad_structure_get','cad_delivery_check'))


def read_tools():
    """Codex 에서 승인 없이 부를 읽기 도구: 도면 변경 도구(MUTATING_TOOLS)가 아니고 이름이 조회·검사·미리보기인 것."""
    from bridge import TOOLS,MUTATING_TOOLS
    return sorted(t['name'] for t in TOOLS if t['name'] not in MUTATING_TOOLS and (t['name'].startswith(READ_PREFIXES) or t['name'] in READ_EXTRA))


def _relay_name(source):
    import hashlib
    digest=hashlib.sha256()
    with open(source,'rb') as handle:
        for chunk in iter(lambda:handle.read(1<<20),b''):digest.update(chunk)
    return digest.hexdigest()[:16]


def ensure_relay(source_exe):
    """엔진 실행 파일 폴더를 RELAY_ROOT/<실행 파일 해시>/ 로 한 번 복사하고 그 중계 경로를 돌려준다. 같은 판이면 그대로 쓴다."""
    source=Path(source_exe);target=RELAY_ROOT/_relay_name(source);exe=target/RELAY_EXE
    if (target/'.complete').is_file() and exe.is_file():return exe
    RELAY_ROOT.mkdir(parents=True,exist_ok=True)
    temp=RELAY_ROOT/(target.name+f'.tmp-{os.getpid()}')
    shutil.rmtree(temp,ignore_errors=True)
    shutil.copytree(source.parent,temp,symlinks=True)   # 맥 묶음 안 프레임워크 링크는 링크 그대로
    os.replace(temp/source.name,temp/RELAY_EXE)
    (temp/'.complete').write_text(str(source),encoding='utf-8')
    try:os.replace(temp,target)
    except OSError:
        shutil.rmtree(temp,ignore_errors=True)   # 다른 프로세스가 먼저 만들었다
        if not (target/'.complete').is_file():raise
    prune_relays(keep=target)
    return exe


def _running(exe):
    """맥·리눅스는 도는 실행 파일도 지워지므로 프로세스 목록으로 본다(지우면 그 중계가 남은 모듈을 못 읽어 끊긴다)."""
    try:return subprocess.run(['pgrep','-f',str(exe)],capture_output=True,timeout=5).returncode==0
    except (OSError,subprocess.SubprocessError):return True   # 모르면 지우지 않는다


def prune_relays(keep):
    """옛 판 중계 복사본을 지운다. 아직 도는 중계는 건드리지 않는다 — 도는 중에 파일을 지우면 그 대화가 끊긴다."""
    for folder in RELAY_ROOT.glob('*'):
        if folder==keep or not folder.is_dir():continue
        exe=folder/RELAY_EXE
        if os.name!='nt' and _running(exe):continue
        try:
            if exe.exists():exe.unlink()   # 실행 중이면 Windows 가 거절한다
        except OSError:continue
        shutil.rmtree(folder,ignore_errors=True)


def is_relay_path(path):
    """엔진이 허락 창에서 '우리 중계'를 알아볼 때 쓴다: RELAY_ROOT/<해시>/barun-cad-mcp.exe."""
    try:
        p=Path(path).resolve()
        return p.name.lower()==RELAY_EXE.lower() and p.parent.parent==RELAY_ROOT.resolve()
    except (OSError,ValueError,TypeError):return False


def server_command():
    """설치판(Windows·맥)은 설치 폴더 밖 중계 복사본(--mcp), 복사 못 하면 엔진 실행 파일, 개발판은 이 폴더의 server.py."""
    from runtime_paths import packaged,packaged_executable
    if packaged():
        exe=packaged_executable()
        if os.name=='nt' or sys.platform=='darwin':
            try:
                relay=ensure_relay(exe)
                if sys.platform=='darwin':_write_pointer(relay)
                return str(relay),['--mcp']
            except OSError:pass
        return exe,['--mcp']
    return sys.executable,[str(ROOT/'server.py'),'--mcp']


# 맥 Claude 데스크톱은 설정 파일 대신 확장(.mcpb)으로 붙인다(2026-10-26).
# Claude 가 켜져 있을 때 claude_desktop_config.json 을 고치면 Claude 가 자기 설정으로 덮어써 바른 CAD 항목이 사라졌다.
# 확장은 Claude 가 직접 설치·보관하므로 덮이지 않는다. 확장 안 실행 파일은 POINTER 에 적힌 지금 판 중계를 띄우므로
# CAD 를 업데이트해도 확장을 다시 깔 필요가 없다.
POINTER_NAME='current'
EXTENSION_NAME='barun-cad'
LAUNCHER='''#!/bin/sh
# 바른 CAD 가 적어 둔 지금 판의 MCP 중계를 띄운다. 적힌 것이 없으면 확장을 만들 때의 엔진을 띄운다.
relay="$(cat "$HOME/.barun-cad/mcp-relay/current" 2>/dev/null)"
if [ -x "$relay" ]; then exec "$relay" --mcp; fi
exec {fallback} --mcp
'''


def _write_pointer(relay):
    pointer=RELAY_ROOT/POINTER_NAME
    if pointer.is_file() and pointer.read_text(encoding='utf-8').strip()==str(relay):return
    temp=pointer.with_name(f'{POINTER_NAME}.tmp-{os.getpid()}')
    temp.write_text(str(relay),encoding='utf-8');os.replace(temp,pointer)


def _home():return Path.home()


def claude_desktop_config():
    if os.name=='nt':base=Path(os.environ.get('APPDATA') or _home()/'AppData'/'Roaming')
    elif sys.platform=='darwin':base=_home()/'Library'/'Application Support'
    else:base=Path(os.environ.get('XDG_CONFIG_HOME') or _home()/'.config')
    return base/'Claude'/'claude_desktop_config.json'


def claude_extensions_dir():return claude_desktop_config().parent/'Claude Extensions'


def claude_extension_installed():
    """Claude 가 확장을 깔면 'Claude Extensions/<이름>/manifest.json' 을 남긴다."""
    folder=claude_extensions_dir()
    return folder.is_dir() and any((p/'manifest.json').is_file() for p in folder.glob(f'*{EXTENSION_NAME}*'))


def build_claude_extension(fallback):
    """~/.barun-cad/claude-extension/barun-cad.mcpb 를 만든다(zip: manifest.json + server/launch.sh). fallback 은 실행 명령 목록."""
    import shlex,zipfile
    manifest={'manifest_version':'0.3','name':EXTENSION_NAME,'display_name':'바른 CAD','version':'1.0.0',
              'description':'바른 CAD 도면을 Claude 에서 읽고 고칩니다. 바른 CAD 가 켜져 있어야 합니다.',
              'author':{'name':'바른건축'},
              'server':{'type':'binary','entry_point':'server/launch.sh',
                        'mcp_config':{'command':'/bin/sh','args':['${__dirname}/server/launch.sh'],'env':{}}},
              'compatibility':{'platforms':['darwin']}}
    target=_home()/'.barun-cad'/'claude-extension'/f'{EXTENSION_NAME}.mcpb'
    target.parent.mkdir(parents=True,exist_ok=True)
    temp=target.with_name(target.name+f'.tmp-{os.getpid()}')
    with zipfile.ZipFile(temp,'w',zipfile.ZIP_DEFLATED) as bundle:
        bundle.writestr('manifest.json',json.dumps(manifest,ensure_ascii=False,indent=2))
        script=zipfile.ZipInfo('server/launch.sh');script.external_attr=0o755<<16;script.compress_type=zipfile.ZIP_DEFLATED
        bundle.writestr(script,LAUNCHER.format(fallback=' '.join(shlex.quote(str(x)) for x in fallback)))
    os.replace(temp,target)
    return target


def _install_claude_extension():
    """확장 파일을 만들어 Claude 앱으로 연다. Claude 가 설치 창을 띄우고 사용자가 [설치]를 누른다."""
    from runtime_paths import packaged,packaged_executable
    bundle=build_claude_extension([packaged_executable()] if packaged() else [sys.executable,str(ROOT/'server.py')])
    done=subprocess.run(['open','-a','Claude',str(bundle)],capture_output=True,text=True,timeout=30)
    if done.returncode!=0:raise OSError((done.stderr or '').strip() or 'Claude 앱을 열지 못했습니다.')
    return 'already' if claude_extension_installed() else 'opened'


def claude_code_config():return _home()/'.claude.json'


def codex_config():return Path(os.environ.get('CODEX_HOME') or _home()/'.codex')/'config.toml'


def _backup(path):
    if path.is_file():shutil.copy2(path,path.with_name(f'{path.name}.barun-backup-{time.strftime("%Y%m%d-%H%M%S")}'))


def _write(path,text):
    path.parent.mkdir(parents=True,exist_ok=True)
    _backup(path)
    temp=path.with_name(path.name+'.barun-tmp')
    temp.write_text(text,encoding='utf-8');os.replace(temp,path)


def _read_json(path):
    if not path.is_file():return {}
    text=path.read_text(encoding='utf-8-sig')
    value=json.loads(text) if text.strip() else {}
    if not isinstance(value,dict):raise ValueError(f'{path.name} 내용이 올바르지 않아 바꾸지 않았습니다.')
    return value


def _json_entry(command,args,typed):
    entry={'command':command,'args':list(args),'env':{}}
    return {'type':'stdio',**entry} if typed else entry


def _register_json(path,command,args,typed):
    data=_read_json(path)
    servers=data.setdefault('mcpServers',{})
    if not isinstance(servers,dict):raise ValueError(f'{path.name} 의 mcpServers 가 올바르지 않아 바꾸지 않았습니다.')
    entry=_json_entry(command,args,typed)
    if servers.get(NAME)==entry:return 'already'
    servers[NAME]=entry
    _write(path,json.dumps(data,ensure_ascii=False,indent=2)+'\n')
    return 'registered'


def _toml_string(value):
    # 작은따옴표 문자열은 \ 를 그대로 둔다(Windows 경로). 작은따옴표가 든 값만 JSON 식 큰따옴표 문자열로.
    return json.dumps(value,ensure_ascii=False) if "'" in value or '\n' in value else f"'{value}'"


def codex_block(command,args):
    return (f'[mcp_servers.{NAME}]\n# 바른 CAD 가 [Codex에 연결]로 넣은 항목\n'
            f'command = {_toml_string(command)}\nargs = [{", ".join(_toml_string(a) for a in args)}]\n'
            +''.join(f'{key} = {json.dumps(value)}\n' for key,value in CODEX_EXTRA.items())
            +''.join(f'\n[mcp_servers.{NAME}.tools.{tool}]\napproval_mode = "approve"\n' for tool in read_tools()))


def _table_name(line):
    text=line.strip()
    if not text.startswith('[') or text.startswith('[['):return None
    return text.split(']',1)[0].strip('[ ').replace('"','').replace("'",'')


def replace_codex_entry(text,command,args):
    """[mcp_servers.barun-cad] 와 그 .env 만 새로 쓰고, 사용자가 붙인 .tools.* 승인 같은 다른 하위 표는 남긴다."""
    import tomllib
    own={f'mcp_servers.{NAME}',f'mcp_servers.{NAME}.env',*(f'mcp_servers.{NAME}.tools.{tool}' for tool in read_tools())}
    kept,skip=[],False
    for line in text.splitlines(keepends=True):
        name=_table_name(line)
        if name is not None or line.strip().startswith('[['):skip=name in own
        if not skip:kept.append(line)
    body=''.join(kept).rstrip()
    result=(body+'\n\n' if body else '')+codex_block(command,args)
    parsed=tomllib.loads(result)   # 깨진 설정은 쓰지 않는다
    entry=parsed.get('mcp_servers',{}).get(NAME,{})
    if entry.get('command')!=command or entry.get('args')!=list(args):raise ValueError('Codex 설정을 만들지 못했습니다.')
    return result


def _codex_status(path,command,args):
    import tomllib
    if not path.is_file():return 'missing'
    try:entry=tomllib.loads(path.read_text(encoding='utf-8-sig')).get('mcp_servers',{}).get(NAME)
    except (ValueError,OSError):return 'unreadable'
    if not entry:return 'missing'
    tools=entry.get('tools') or {}
    approved=all((tools.get(tool) or {}).get('approval_mode')=='approve' for tool in read_tools())
    return 'ok' if entry.get('command')==command and entry.get('args')==list(args) and all(entry.get(k)==v for k,v in CODEX_EXTRA.items()) and approved else 'other'


def _json_status(path,command,args):
    try:entry=_read_json(path).get('mcpServers',{}).get(NAME)
    except (ValueError,OSError):return 'unreadable'
    if not entry:return 'missing'
    return 'ok' if entry.get('command')==command and entry.get('args')==list(args) else 'other'


def _claude_cli():
    return shutil.which('claude.cmd') or shutil.which('claude') if os.name=='nt' else shutil.which('claude')


def _register_claude_code(command,args):
    cli=_claude_cli()
    if cli:
        # Claude Code 가 켜져 있으면 ~/.claude.json 을 계속 다시 쓴다 — 직접 고치면 덮일 수 있어 공식 명령을 먼저 쓴다.
        payload=json.dumps(_json_entry(command,args,True),ensure_ascii=False)
        subprocess.run([cli,'mcp','remove','--scope','user',NAME],capture_output=True,timeout=60)
        done=subprocess.run([cli,'mcp','add-json','--scope','user',NAME,payload],capture_output=True,text=True,encoding='utf-8',errors='replace',timeout=60)
        if done.returncode==0:return 'registered'
    return _register_json(claude_code_config(),command,args,True)


def targets(client):
    """client 마다 이 PC 에 깔린 프로그램만 고른다. 하나도 없으면 빈 목록."""
    if client=='claude':
        found=[]
        if claude_desktop_config().parent.is_dir():found.append(('Claude 데스크톱',claude_desktop_config()))
        if claude_code_config().is_file() or _claude_cli():found.append(('Claude Code',claude_code_config()))
        return found
    if client=='codex':
        path=codex_config()
        return [('Codex',path)] if path.parent.is_dir() else []
    raise ValueError('연결할 AI 는 claude 또는 codex 입니다.')


def register(client):
    command,args=server_command()
    found=targets(client)
    if not found:
        name='Claude(데스크톱 앱 또는 Claude Code)' if client=='claude' else 'Codex(앱 또는 CLI)'
        raise ValueError(f'이 PC에서 {name}를 찾지 못했습니다. 먼저 설치하고 한 번 실행한 뒤 다시 눌러 주세요.')
    results=[]
    for label,path in found:
        try:
            if label=='Codex':
                text=path.read_text(encoding='utf-8-sig') if path.is_file() else ''
                new=replace_codex_entry(text,command,args)
                if _codex_status(path,command,args)=='ok':state='already'
                else:_write(path,new);state='registered'
            elif label=='Claude Code':state=_register_claude_code(command,args)
            elif sys.platform=='darwin':state=_install_claude_extension()
            else:state=_register_json(path,command,args,False)
            results.append({'app':label,'state':state})
        except (OSError,ValueError,subprocess.SubprocessError) as error:
            results.append({'app':label,'state':'failed','error':str(error)})
    ok=[r['app'] for r in results if r['state']!='failed']
    message=(', '.join(ok)+'에 바른 CAD 를 연결했습니다. '+RESTART+' 그다음 AI 에게 "바른 CAD 도면 읽어 줘"처럼 말하면 됩니다.') if ok else '연결하지 못했습니다.'
    if any(r['state']=='opened' for r in results):
        message+=' Claude 데스크톱은 방금 뜬 Claude 창에서 [설치]를 한 번 눌러 주세요.'
    failed=[f"{r['app']}: {r['error']}" for r in results if r['state']=='failed']
    if failed:message+=' 실패: '+' / '.join(failed)
    return {'ok':bool(ok),'client':client,'results':results,'command':command,'args':args,'message':message}


def status():
    command,args=server_command()
    rows=[]
    for client in ('claude','codex'):
        for label,path in targets(client):
            if label=='Codex':state=_codex_status(path,command,args)
            elif label!='Claude Code' and sys.platform=='darwin' and claude_extension_installed():state='ok'
            else:state=_json_status(path,command,args)
            rows.append({'app':label,'state':state})
    return {'command':command,'args':args,'apps':rows}


def _ours(command):
    """설정에 있는 명령이 바른 CAD 가 넣은 것인지(설치판 엔진 또는 중계 복사본). 사용자가 직접 바꾼 명령은 건드리지 않는다."""
    name=PureWindowsPath(str(command or '')).name.lower()   # \ 와 / 둘 다 나눈다(맥 Path 는 윈도우 경로를 통째로 이름으로 봤다)
    return name==RELAY_EXE.lower() or (name.startswith('barun-cad') and name.endswith(('-server.exe','-server')))   # 맥 엔진은 .exe 가 없다


def refresh_existing():
    """CAD 를 켤 때: 이미 바른 CAD 를 연결해 둔 AI 설정만 지금 판의 중계로 바꾼다. 연결 안 한 AI 는 새로 넣지 않는다."""
    import tomllib
    command,args=server_command()
    changed=[]
    for client in ('claude','codex'):
        for label,path in targets(client):
            try:
                if label=='Codex':
                    if not path.is_file():continue
                    text=path.read_text(encoding='utf-8-sig')
                    entry=tomllib.loads(text).get('mcp_servers',{}).get(NAME)
                    if not entry or not _ours(entry.get('command')) or _codex_status(path,command,args)=='ok':continue
                    _write(path,replace_codex_entry(text,command,args))
                else:
                    entry=_read_json(path).get('mcpServers',{}).get(NAME)
                    if not entry or not _ours(entry.get('command')) or _json_status(path,command,args)=='ok':continue
                    if label=='Claude Code':_register_claude_code(command,args)
                    else:_register_json(path,command,args,False)
                changed.append(label)
            except (OSError,ValueError,subprocess.SubprocessError):continue
    return changed


def main(argv):
    """server.py --register-mcp claude|codex / --mcp-status 에서 부른다. 결과는 JSON 한 줄."""
    try:sys.stdout.reconfigure(encoding='utf-8')
    except (AttributeError,ValueError):pass
    try:result=status() if argv[0]=='status' else register(argv[0])
    except ValueError as error:result={'ok':False,'message':str(error)}
    print(json.dumps(result,ensure_ascii=False))
    return 0 if result.get('ok',True) else 1
