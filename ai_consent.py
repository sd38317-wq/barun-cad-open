"""바깥 AI 프로그램 허락(10-21).

예전에는 연결 파일(connection-*.json)의 토큰만 있으면 같은 사용자의 아무 프로그램이나 /api/mcp 로 CAD 를 조종했다.
이제 연결 파일 토큰으로는 /api/mcp-hello(허락 요청)만 할 수 있다. 엔진이 그 요청을 보낸 프로그램을 직접 찾아
(이 PC 연결 표 → 프로세스 → 실행 파일 → 서명) CAD 화면에 "OOO가 이 CAD 를 쓰려고 합니다 [허락] [거절]"을 띄우고,
허락하면 그 중계에만 쓸 수 있는 연결 열쇠(grant)를 준다. /api/mcp 는 그 열쇠로만 열린다.

기억은 "서명한 회사 + 프로그램 이름"(서명 있는 프로그램, 업데이트해도 다시 안 물음) 또는
"실행 파일 경로 + SHA-256"(서명 없는 프로그램, 파일이 바뀌면 다시 물음)으로 한다(사장님 결정 10-21).
허락 목록은 Windows 에서 DPAPI 로 잠가 둔다. 같은 사용자 권한의 프로그램을 운영체제 수준에서 완전히 막는 방법은 아니다
(그 프로그램이 CAD 를 고쳐 쓰거나 메모리를 읽으면 못 막는다). 파일 하나 읽고 바로 조종하던 길을 막는 것이 목적이다.
"""
import hashlib,json,os,secrets,socket,subprocess,sys,threading,time,uuid
from pathlib import Path

PENDING_SECONDS=120   # 화면에 띄운 허락 창이 답 없이 남는 시간
WAIT_SECONDS=45       # 중계 한 번이 답을 기다리는 시간(Codex 도구 기본 제한 60초 안)
ENTROPY=b'barun-cad-ai-consent-v1'

CONSENT_REQUIRED='바른 CAD 화면에 "{label}이(가) 이 CAD를 쓰려고 합니다" 창이 떠 있습니다. [허락]을 누른 뒤 다시 시도하세요.'
NO_SCREEN='바른 CAD 도면 창이 열려 있지 않아 허락 창을 띄우지 못했습니다. 바른 CAD 도면 창을 연 뒤 다시 시도하세요.'
DENIED_ONCE='바른 CAD에서 {label}의 이번 연결을 거절했습니다.'
DENIED='바른 CAD에서 {label}의 사용을 거절했습니다. 다시 쓰려면 바른 CAD 계정 창 → AI → [허락한 AI 관리]에서 이 프로그램을 지운 뒤 다시 시도하세요.'
REVOKED='바른 CAD에서 이 AI 프로그램의 허락을 취소했습니다. 다시 쓰려면 바른 CAD 화면에서 다시 허락하세요.'
GRANT_ONLY='허락받은 AI 연결만 바른 CAD를 쓸 수 있습니다. AI 프로그램을 완전히 껐다가 다시 켜세요(바른 CAD가 업데이트된 경우).'


class ConsentError(Exception):
    def __init__(self,code,message,**details):
        super().__init__(message);self.code=code;self.details={'code':code,**details}


_cv=threading.Condition()
_pending={}          # id → 화면에 띄울 요청
_grants={}           # 열쇠 → {key, pid}
_store_cache=None


# ---------------------------------------------------------------- 허락 목록(저장)

def store_path():
    base=Path(os.environ.get('LOCALAPPDATA') or (Path.home()/'AppData'/'Local' if os.name=='nt' else Path.home()))
    return base/'BarunCAD'/'ai-consent.dat'


def _dpapi(data,protect):
    import ctypes
    from ctypes import wintypes
    class Blob(ctypes.Structure):_fields_=[('cbData',wintypes.DWORD),('pbData',ctypes.POINTER(ctypes.c_char))]
    crypt=ctypes.WinDLL('crypt32',use_last_error=True);kernel=ctypes.WinDLL('kernel32')
    source=ctypes.create_string_buffer(data,len(data));extra=ctypes.create_string_buffer(ENTROPY,len(ENTROPY))
    blob_in=Blob(len(data),ctypes.cast(source,ctypes.POINTER(ctypes.c_char)));blob_extra=Blob(len(ENTROPY),ctypes.cast(extra,ctypes.POINTER(ctypes.c_char)))
    out=Blob()
    function=crypt.CryptProtectData if protect else crypt.CryptUnprotectData
    function.argtypes=[ctypes.POINTER(Blob),ctypes.c_void_p,ctypes.POINTER(Blob),ctypes.c_void_p,ctypes.c_void_p,wintypes.DWORD,ctypes.POINTER(Blob)]
    if not function(ctypes.byref(blob_in),None,ctypes.byref(blob_extra),None,None,1,ctypes.byref(out)):raise OSError('DPAPI failed')
    try:return ctypes.string_at(out.pbData,out.cbData)
    finally:kernel.LocalFree(out.pbData)


def load_store():
    """허락 목록 {key: {...}}. 못 읽거나 남이 고쳐 풀리지 않으면 비운다(모두 다시 묻는다)."""
    global _store_cache
    if _store_cache is not None:return _store_cache
    try:
        raw=store_path().read_bytes()
        value=json.loads(_dpapi(raw,False) if os.name=='nt' else raw)
        _store_cache=value if isinstance(value,dict) else {}
    except (OSError,ValueError):_store_cache={}
    return _store_cache


def _save_store(entries):
    global _store_cache
    path=store_path();path.parent.mkdir(parents=True,exist_ok=True)
    raw=json.dumps(entries,ensure_ascii=False).encode('utf-8')
    if os.name=='nt':raw=_dpapi(raw,True)
    temp=path.with_name(path.name+'.tmp')
    temp.write_bytes(raw)
    if os.name!='nt':os.chmod(temp,0o600)
    os.replace(temp,path);_store_cache=entries


# ---------------------------------------------------------------- 요청한 프로그램 찾기

def _win_caller_pid(client_port,server_port):
    """이 PC 의 TCP 연결 표에서 (client_port → server_port) 쪽 끝을 가진 프로세스 번호."""
    import ctypes
    from ctypes import wintypes
    iphlp=ctypes.WinDLL('iphlpapi')
    size=wintypes.DWORD(0)
    iphlp.GetExtendedTcpTable(None,ctypes.byref(size),False,socket.AF_INET,5,0)   # TCP_TABLE_OWNER_PID_ALL
    for _ in range(3):
        buffer=(ctypes.c_byte*(size.value+4096))();size=wintypes.DWORD(len(buffer))
        if iphlp.GetExtendedTcpTable(buffer,ctypes.byref(size),False,socket.AF_INET,5,0)==0:break
    else:return None
    count=ctypes.cast(buffer,ctypes.POINTER(wintypes.DWORD))[0]
    rows=ctypes.cast(ctypes.byref(buffer,4),ctypes.POINTER(wintypes.DWORD*6))
    for index in range(count):
        state,local_addr,local_port,remote_addr,remote_port,pid=rows[index]
        if socket.ntohs(local_port&0xffff)==client_port and socket.ntohs(remote_port&0xffff)==server_port and pid!=os.getpid():return int(pid)
    return None


def _win_process(pid):
    """(실행 파일 경로, 만든 시각) — 열지 못하면 (None, None)."""
    import ctypes
    from ctypes import wintypes
    kernel=ctypes.WinDLL('kernel32',use_last_error=True)
    kernel.OpenProcess.restype=wintypes.HANDLE
    handle=kernel.OpenProcess(0x1000,False,pid)
    if not handle:return None,None
    try:
        buffer=ctypes.create_unicode_buffer(32768);size=wintypes.DWORD(len(buffer))
        path=buffer.value if kernel.QueryFullProcessImageNameW(wintypes.HANDLE(handle),0,buffer,ctypes.byref(size)) else None
        times=[ctypes.c_ulonglong() for _ in range(4)]
        created=times[0].value if kernel.GetProcessTimes(wintypes.HANDLE(handle),*[ctypes.byref(t) for t in times]) else None
        return path,created
    finally:kernel.CloseHandle(wintypes.HANDLE(handle))


def _win_parent(pid):
    import ctypes
    from ctypes import wintypes
    class Entry(ctypes.Structure):
        _fields_=[('dwSize',wintypes.DWORD),('cntUsage',wintypes.DWORD),('th32ProcessID',wintypes.DWORD),('th32DefaultHeapID',ctypes.c_size_t),
                  ('th32ModuleID',wintypes.DWORD),('cntThreads',wintypes.DWORD),('th32ParentProcessID',wintypes.DWORD),('pcPriClassBase',ctypes.c_long),
                  ('dwFlags',wintypes.DWORD),('szExeFile',ctypes.c_wchar*260)]
    kernel=ctypes.WinDLL('kernel32')
    kernel.CreateToolhelp32Snapshot.restype=wintypes.HANDLE
    snapshot=kernel.CreateToolhelp32Snapshot(2,0)
    if not snapshot or snapshot==wintypes.HANDLE(-1).value:return None
    try:
        entry=Entry();entry.dwSize=ctypes.sizeof(Entry)
        ok=kernel.Process32FirstW(wintypes.HANDLE(snapshot),ctypes.byref(entry))
        while ok:
            if entry.th32ProcessID==pid:return int(entry.th32ParentProcessID)
            ok=kernel.Process32NextW(wintypes.HANDLE(snapshot),ctypes.byref(entry))
        return None
    finally:kernel.CloseHandle(wintypes.HANDLE(snapshot))


def _win_signer(path):
    """Authenticode 서명이 유효하면 서명한 회사 이름, 아니면 None(인터넷 확인 없이 이 PC 정보만)."""
    import ctypes
    from ctypes import wintypes
    class GUID(ctypes.Structure):_fields_=[('d1',wintypes.DWORD),('d2',wintypes.WORD),('d3',wintypes.WORD),('d4',ctypes.c_ubyte*8)]
    class FileInfo(ctypes.Structure):_fields_=[('cbStruct',wintypes.DWORD),('pcwszFilePath',wintypes.LPCWSTR),('hFile',wintypes.HANDLE),('pgKnownSubject',ctypes.c_void_p)]
    class TrustData(ctypes.Structure):
        _fields_=[('cbStruct',wintypes.DWORD),('pPolicyCallbackData',ctypes.c_void_p),('pSIPClientData',ctypes.c_void_p),('dwUIChoice',wintypes.DWORD),
                  ('fdwRevocationChecks',wintypes.DWORD),('dwUnionChoice',wintypes.DWORD),('pFile',ctypes.POINTER(FileInfo)),('dwStateAction',wintypes.DWORD),
                  ('hWVTStateData',wintypes.HANDLE),('pwszURLReference',wintypes.LPWSTR),('dwProvFlags',wintypes.DWORD),('dwUIContext',wintypes.DWORD),('pSignatureSettings',ctypes.c_void_p)]
    class ProviderCert(ctypes.Structure):_fields_=[('cbStruct',wintypes.DWORD),('pCert',ctypes.c_void_p)]
    wintrust=ctypes.WinDLL('wintrust');crypt=ctypes.WinDLL('crypt32')
    action=GUID(0x00AAC56B,0xCD44,0x11d0,(ctypes.c_ubyte*8)(0x8C,0xC2,0x00,0xC0,0x4F,0xC2,0x95,0xEE))   # WINTRUST_ACTION_GENERIC_VERIFY_V2
    info=FileInfo(ctypes.sizeof(FileInfo),path,None,None)
    data=TrustData();data.cbStruct=ctypes.sizeof(TrustData);data.dwUIChoice=2;data.fdwRevocationChecks=0;data.dwUnionChoice=1
    data.pFile=ctypes.pointer(info);data.dwStateAction=1;data.dwProvFlags=0x1000|0x10   # 캐시만·폐기 확인 안 함(오프라인에서도 빠르게)
    wintrust.WinVerifyTrust.argtypes=[wintypes.HANDLE,ctypes.POINTER(GUID),ctypes.c_void_p];wintrust.WinVerifyTrust.restype=ctypes.c_long
    status=wintrust.WinVerifyTrust(None,ctypes.byref(action),ctypes.byref(data))
    try:
        if status!=0:return None
        wintrust.WTHelperProvDataFromStateData.restype=ctypes.c_void_p;wintrust.WTHelperProvDataFromStateData.argtypes=[wintypes.HANDLE]
        wintrust.WTHelperGetProvSignerFromChain.restype=ctypes.c_void_p;wintrust.WTHelperGetProvSignerFromChain.argtypes=[ctypes.c_void_p,wintypes.DWORD,wintypes.BOOL,wintypes.DWORD]
        wintrust.WTHelperGetProvCertFromChain.restype=ctypes.POINTER(ProviderCert);wintrust.WTHelperGetProvCertFromChain.argtypes=[ctypes.c_void_p,wintypes.DWORD]
        provider=wintrust.WTHelperProvDataFromStateData(data.hWVTStateData)
        signer=provider and wintrust.WTHelperGetProvSignerFromChain(provider,0,False,0)
        cert=signer and wintrust.WTHelperGetProvCertFromChain(signer,0)
        if not cert or not cert.contents.pCert:return None
        crypt.CertGetNameStringW.argtypes=[ctypes.c_void_p,wintypes.DWORD,wintypes.DWORD,ctypes.c_void_p,wintypes.LPWSTR,wintypes.DWORD]
        name=ctypes.create_unicode_buffer(512)
        crypt.CertGetNameStringW(cert.contents.pCert,4,0,None,name,len(name))   # CERT_NAME_SIMPLE_DISPLAY_TYPE
        return name.value or None
    finally:
        data.dwStateAction=2;wintrust.WinVerifyTrust(None,ctypes.byref(action),ctypes.byref(data))


def _posix_caller_pid(client_port,server_port):
    # chisle: macOS 는 lsof 로 찾는다(맥미니에서 아직 확인 안 함). 둘 다 같은 사용자라 root 없이 보인다.
    try:out=subprocess.run(['lsof','-nP',f'-iTCP@127.0.0.1:{client_port}','-sTCP:ESTABLISHED','-Fp'],capture_output=True,text=True,timeout=5).stdout
    except (OSError,subprocess.SubprocessError):return None
    pids=[int(line[1:]) for line in out.splitlines() if line.startswith('p') and line[1:].isdigit()]
    return next((p for p in pids if p!=os.getpid()),None)


def _posix_process(pid):
    try:
        out=subprocess.run(['ps','-o','ppid=,lstart=','-p',str(pid)],capture_output=True,text=True,timeout=5).stdout.strip()
        path=os.path.realpath(f'/proc/{pid}/exe') if os.path.exists(f'/proc/{pid}/exe') else subprocess.run(['ps','-o','comm=','-p',str(pid)],capture_output=True,text=True,timeout=5).stdout.strip()
    except (OSError,subprocess.SubprocessError):return None,None,None
    if not out:return None,None,None
    ppid,_,started=out.partition(' ')
    try:created=time.mktime(time.strptime(started.strip(),'%a %b %d %H:%M:%S %Y'))
    except ValueError:created=None
    return path or None,created,int(ppid) if ppid.isdigit() else None


def _posix_signer(path):
    if sys.platform!='darwin':return None
    try:
        if subprocess.run(['codesign','--verify',path],capture_output=True,timeout=10).returncode!=0:return None
        info=subprocess.run(['codesign','-dv','--verbose=2',path],capture_output=True,text=True,timeout=10).stderr
    except (OSError,subprocess.SubprocessError):return None
    # 임시 서명(adhoc, 직접 빌드한 python·node 등)은 Authority 줄이 없다 — 서명자 없음(None)으로 본다(10-26 mcp-hello 400 IndexError)
    line=next((l for l in info.splitlines() if l.startswith('Authority=')),'')
    return line.partition('=')[2].replace('Developer ID Application: ','').strip() or None


def process_info(pid):
    """{pid, path, created, parent} — 운영체제가 알려 주는 것만."""
    if os.name=='nt':
        path,created=_win_process(pid);parent=_win_parent(pid)
    else:path,created,parent=_posix_process(pid)
    return {'pid':pid,'path':path,'created':created,'parent':parent}


def signer_of(path):
    # 연결(중계 하나)마다 한 번만 부르므로 캐시하지 않는다. 경로·크기·시각으로 캐시하면 같은 크기로 바꿔 끼운 파일이 옛 서명을 물려받는다.
    try:return _win_signer(path) if os.name=='nt' else _posix_signer(path)
    except (OSError,AttributeError,ValueError):return None


def _sha256(path):
    digest=hashlib.sha256()
    with open(path,'rb') as handle:
        for chunk in iter(lambda:handle.read(1<<20),b''):digest.update(chunk)
    return digest.hexdigest()


def _same_file(a,b):
    try:return bool(a and b) and os.path.normcase(os.path.realpath(a))==os.path.normcase(os.path.realpath(b))
    except OSError:return False


# 실행 파일을 못 찾은 연결의 이름. 이 창은 AI 연결 요청에만 뜨므로 '알 수 없는 프로그램' 대신 'AI 프로그램'(2026-10-27 사장님).
UNKNOWN_LABEL='AI 프로그램'


def friendly_name(signer,path):
    text=(signer or '').lower()
    if 'anthropic' in text:return 'Claude'
    if 'openai' in text:return 'Codex'
    return Path(path).stem if path else UNKNOWN_LABEL


# 아무 스크립트나 돌리는 실행기·셸. 서명만으로 기억하면 그 위에서 도는 모든 스크립트를 허락하게 되므로 이번만 허락한다.
GENERIC_HOSTS=frozenset(('python','pythonw','py','node','deno','bun','powershell','pwsh','cmd','conhost','wscript','cscript','mshta','rundll32',
                         'bash','sh','zsh','java','javaw','ruby','perl','osascript','curl','wget','timeout','env','nohup','time','start'))
# 다른 프로그램을 감싸 띄우기만 하는 실행기. 'timeout 30 barun-cad-6-server --mcp' 처럼 감싸면 허락 창에
# "timeout이(가) 이 CAD를 쓰려고 합니다"가 떴다(10/22 backend.log). 감싼 쪽 위의 진짜 프로그램을 본다.
WRAPPERS=frozenset(('timeout','env','nohup','time','start'))


def _is_relay(path,relay_exe):
    candidates=[relay_exe] if relay_exe else [sys.executable,getattr(sys,'_base_executable',None)]
    if any(_same_file(path,c) for c in candidates if c):return True
    # 설치 폴더 밖 중계 복사본(~/.barun-cad/mcp-relay/<해시>/barun-cad-mcp.exe, 업데이트에도 안 꺼지게 둔 것)도 우리 중계다.
    import mcp_register
    return bool(path) and mcp_register.is_relay_path(path)


def identify(client_port,server_port,relay_exe=None):
    """요청을 보낸 프로그램. 우리 중계(--mcp, 이 엔진과 같은 실행 파일)면 그 중계를 띄운 부모 프로그램을 본다."""
    find_pid=_win_caller_pid if os.name=='nt' else _posix_caller_pid
    try:pid=find_pid(client_port,server_port)
    except (OSError,AttributeError,ValueError):pid=None
    if not pid:return {'key':None,'label':UNKNOWN_LABEL,'program':None,'signer':None,'path':None}
    caller=process_info(pid)
    subject=caller
    if _is_relay(caller['path'],relay_exe) and caller['parent']:
        parent=process_info(caller['parent'])
        # 부모가 먼저 꺼지고 번호가 다른 프로그램에 다시 쓰였으면 부모가 아니다(만든 시각이 중계보다 늦다).
        if parent['path'] and (parent['created'] is None or caller['created'] is None or parent['created']<=caller['created']):subject=parent
        for _ in range(3):
            if not subject['path'] or Path(subject['path']).stem.lower() not in WRAPPERS or not subject.get('parent'):break
            above=process_info(subject['parent'])
            if not above['path'] or (above['created'] is not None and subject['created'] is not None and above['created']>subject['created']):break
            subject=above
    path=subject['path']
    if not path:return {'key':None,'label':UNKNOWN_LABEL,'program':None,'signer':None,'path':None,'pid':subject['pid']}
    signer=signer_of(path);program=Path(path).name
    if Path(path).stem.lower() in GENERIC_HOSTS:key=None
    elif signer:key=f'sig:{signer}|{program.lower()}'
    else:
        try:key=f'file:{os.path.normcase(path)}|{_sha256(path)}'
        except OSError:key=None
    return {'key':key,'label':friendly_name(signer,path),'program':program,'signer':signer,'path':path,'pid':subject['pid'],'remember':key is not None}


# ---------------------------------------------------------------- 허락 흐름

def decision(key):
    entry=load_store().get(key) if key else None
    return entry.get('decision') if isinstance(entry,dict) else None


def _new_grant(who):
    token=secrets.token_urlsafe(32)
    _grants[token]={'key':who['key'] or f"session:{who.get('pid')}",'pid':who.get('pid'),'label':who['label']}
    return {'grant':token,'program':who['label']}


def _expire_locked():
    now=time.monotonic()
    for identifier in [i for i,p in _pending.items() if now-p['created']>PENDING_SECONDS]:_pending.pop(identifier,None)


def hello(who,client=None,wait=WAIT_SECONDS,has_screen=lambda:True):
    """중계가 처음 붙을 때. 허락됨 → 열쇠, 거절됨 → consent_denied, 아직 → 화면에 묻고 wait 초까지 기다린다."""
    client_name=str((client or {}).get('name') or '')[:80]
    screen=has_screen()   # 다리 잠금을 이 잠금 밖에서 먼저 잡는다(pulse 는 다리 잠금 안에서 pending_for_screen 을 부른다)
    with _cv:
        state=decision(who['key'])
        if state=='allow':return _new_grant(who)
        if state=='deny':raise ConsentError('consent_denied',DENIED.format(label=who['label']),program=who['label'])
        _expire_locked()
        # 기억하는 프로그램은 허락 목록이 답이다. 기억하지 않는 프로그램은 같은 프로세스의 답(기다림이 끝난 뒤 누른 [허락] 포함)을 한 번 쓴다.
        if who['key']:pending=next((p for p in _pending.values() if p['answer'] is None and p['key']==who['key']),None)
        else:pending=next((p for p in _pending.values() if p['key'] is None and p['pid']==who.get('pid')),None)
        if pending is None:
            identifier=str(uuid.uuid4())
            pending=_pending[identifier]={'id':identifier,'key':who['key'],'pid':who.get('pid'),'label':who['label'],'program':who['program'],
                                          'signer':who['signer'],'path':who['path'],'remember':bool(who.get('remember')),'client':client_name,'created':time.monotonic(),'answer':None}
        if not screen:raise ConsentError('consent_required',NO_SCREEN,program=who['label'],screen=False)
        deadline=time.monotonic()+max(0,min(float(wait or 0),WAIT_SECONDS))
        while pending['answer'] is None:
            left=deadline-time.monotonic()
            if left<=0:break
            _cv.wait(min(left,1.0))
        if pending['answer'] is not None:_pending.pop(pending['id'],None)
        if pending['answer']=='allow':return _new_grant(who)
        if pending['answer']=='deny':raise ConsentError('consent_denied',(DENIED if who['key'] else DENIED_ONCE).format(label=who['label']),program=who['label'])
        raise ConsentError('consent_required',CONSENT_REQUIRED.format(label=who['label']),program=who['label'],retry_after_seconds=2)


def pending_for_screen():
    with _cv:
        _expire_locked()
        return [{k:p[k] for k in ('id','label','program','signer','path','remember','client')} for p in _pending.values() if p['answer'] is None]


def decide(identifier,allow):
    with _cv:
        pending=_pending.get(identifier)
        if not pending or pending['answer'] is not None:raise ValueError('이미 답했거나 시간이 지난 허락 요청입니다.')
        answer='allow' if allow else 'deny'
        if pending['key']:
            entries=dict(load_store())
            entries[pending['key']]={'decision':answer,'label':pending['label'],'program':pending['program'],'signer':pending['signer'],'path':pending['path'],'at':time.time()}
            _save_store(entries)
        # 기억하지 않는 요청(key 없음)은 그 프로세스가 가져갈 때까지(또는 시간이 지날 때까지) 답을 남겨 둔다.
        # 같은 프로그램이 기다리는 다른 요청(Claude Code 창 여러 개)도 같은 답을 받는다.
        for other_id,other in list(_pending.items()):
            if other['answer'] is None and other['key']==pending['key'] and (pending['key'] or other is pending):
                other['answer']=answer
                if other['key']:_pending.pop(other_id,None)
        _cv.notify_all()
        return {'ok':True,'decision':answer,'program':pending['label']}


def entries():
    return [{'key':k,**{f:v.get(f) for f in ('decision','label','program','signer','path','at')}} for k,v in sorted(load_store().items(),key=lambda kv:-(kv[1].get('at') or 0)) if isinstance(v,dict)]


def revoke(key):
    with _cv:
        current=dict(load_store())
        if key not in current:raise ValueError('목록에 없는 프로그램입니다.')
        current.pop(key);_save_store(current)
        # 쓰던 열쇠는 지우지 않고 '취소됨'으로 둔다. 그래야 중계가 consent_revoked 를 받고 다시 허락을 청한다.
        for grant in _grants.values():
            if grant['key']==key:grant['revoked']=True
        return {'ok':True}


def check_grant(token):
    """/api/mcp 열쇠 확인. 맞으면 허락 정보, 아니면 None. 허락을 취소했으면 ConsentError."""
    if not isinstance(token,str) or not token:return None
    with _cv:
        grant=next((g for t,g in _grants.items() if secrets.compare_digest(t.encode(),token.encode())),None)
        if grant is None:return None
        if grant.get('revoked') or (not grant['key'].startswith('session:') and decision(grant['key'])!='allow'):
            raise ConsentError('consent_revoked',REVOKED,program=grant['label'])
        return grant


def process(data):
    """화면(/api/ai-consent, 화면 토큰) 전용: 목록·답·취소."""
    action=(data or {}).get('action')
    if action=='pending':return {'pending':pending_for_screen()}
    if action=='decide':return decide(str(data.get('id') or ''),data.get('allow') is True)
    if action=='list':return {'entries':entries()}
    if action=='revoke':return revoke(str(data.get('key') or ''))
    raise ValueError('지원하지 않는 허락 동작입니다.')
