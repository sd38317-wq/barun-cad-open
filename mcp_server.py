"""Standards-based JSON-RPC stdio MCP server for the active Barun CAD desktop."""
import json,sys,urllib.request,urllib.error,os,glob,time
from pathlib import Path
from bridge import mcp_tools,ASK_INSTRUCTIONS,CAD_DRAWING_INSTRUCTIONS,CADToolError,dispatch_timeout,extract_tool_image

_connection=None

def connection_dir(base=None):
    # AI 프로그램이 LOCALAPPDATA 를 안 넘겨줘도 CAD 가 연결 파일을 쓰는 곳(Windows 기본 위치)을 본다.
    default=Path.home()/'AppData'/'Local' if os.name=='nt' else Path.home()
    return Path(base or os.environ.get('LOCALAPPDATA') or default)/'BarunCAD'

def connection_mirror(folder):
    """Windows 스토어 앱(Codex 등)은 그 앱이 띄운 프로그램의 AppData 쓰기를 앱 전용 사본(Packages\\…\\LocalCache)으로 돌리고,
    읽을 때도 사본이 있으면 사본을 준다 → 한 번 생긴 사본이 옛 연결 정보를 붙잡아 CAD 를 다시 켜도 stale_connection 이었다(10/21).
    사용자 폴더 바로 아래는 돌리지 않으므로, 기본 위치를 쓸 때는 같은 연결 파일을 ~/.barun-cad 에도 둔다."""
    if os.name!='nt' or Path(folder)!=Path.home()/'AppData'/'Local'/'BarunCAD':return None
    return Path.home()/'.barun-cad'

def connection_dirs(base=None):
    """연결 파일을 찾을 폴더들 — 스토어 앱이 돌리지 않는 사본 폴더 먼저."""
    folder=connection_dir(base)
    return [d for d in (connection_mirror(folder),folder) if d]

# 연결 실패를 사용자가 고칠 수 있게 셋으로 나눈다(예전엔 모두 "먼저 실행하세요"라 앱이 켜져 있어도 같은 말이었다).
NOT_RUNNING='바른 CAD가 실행되어 있지 않습니다. 바른 CAD를 켜고 도면 창이 뜬 뒤 다시 시도하세요.'
UNREACHABLE='바른 CAD는 실행 중인데 이 AI 프로그램이 CAD 연결 주소({url})에 접속하지 못했습니다. AI 프로그램의 보안 격리(sandbox)나 보안 프로그램이 이 PC 안 연결을 막는지 확인하세요.'
STALE='바른 CAD 연결 정보가 지금 켜진 CAD와 맞지 않습니다. 바른 CAD를 완전히 껐다가 다시 켜 주세요.'

def _check(state,timeout=2):
    """연결 파일이 가리키는 엔진 상태: 'ok' | 'gone'(그 주소에 아무도 없음 = 꺼진 CAD) | 'unreachable'(있는데 막힘) | 'mismatch'(다른 엔진·옛 정보).
    접속 거부를 'unreachable' 로 보던 때는 CAD 를 끈 뒤에도 "보안 차단을 확인하세요"라고 했다(10/22) — 프로세스 번호가 재사용되면 pid 거르기를 통과한다."""
    try:
        with urllib.request.urlopen(state['url']+'/api/status',timeout=timeout) as response:
            if response.headers.get('X-Barun-CAD')!='2':return 'mismatch'
            status=json.load(response)
            # 데스크톱 엔진은 /api/status 로 토큰을 주지 않는다. 그때는 연결 파일을 쓴 그 프로세스(pid)인지로 본다.
            if 'token' in status:same=status.get('token')==state.get('token')
            else:same=status.get('tokenPolicy')=='desktop' and bool(state.get('pid')) and status.get('pid')==state.get('pid')
            return 'ok' if same else 'mismatch'
    except urllib.error.HTTPError:return 'mismatch'
    except urllib.error.URLError as e:
        if isinstance(e.reason,ConnectionRefusedError):return 'gone'
        return _closed_port(state['url']) if isinstance(e.reason,TimeoutError) else 'unreachable'
    except ConnectionRefusedError:return 'gone'
    except TimeoutError:return _closed_port(state['url'])
    except OSError:return 'unreachable'
    except (ValueError,KeyError):return 'mismatch'

def _closed_port(url):
    """시간 초과일 때만 한 번 더 본다. Windows 는 닫힌 localhost 포트에도 약 2초 다시 두드린 뒤에야 거부하므로
    짧은 timeout 의 urlopen 은 꺼진 CAD 를 '시간 초과'로 본다 → 3초 기다려 거부면 'gone'."""
    import socket
    from urllib.parse import urlsplit
    parts=urlsplit(url)
    try:socket.create_connection((parts.hostname,parts.port),timeout=3).close()
    except ConnectionRefusedError:return 'gone'
    except OSError:pass
    return 'unreachable'

_last_check={}   # url → 마지막 _check 결과. 연결 실패 문구를 고를 때 다시 찌르지 않으려고 남긴다.

def _alive(state,timeout=2):
    """연결 파일이 가리키는 엔진이 지금 살아 있고 같은 토큰을 쓰는지 확인한다(S5: 채널마다 파일이 다르다)."""
    result=_last_check[state.get('url')]=_check(state,timeout)
    return result=='ok'

def _probe(state):
    return 'ok' if _alive(state) else _last_check.get(state.get('url'),'mismatch')

def _pid_running(pid):
    """연결 파일을 쓴 엔진 프로세스가 아직 있는지. 모르면 True(그때는 주소로 확인한다)."""
    if not isinstance(pid,int) or pid<=0:return True
    if os.name!='nt':
        try:os.kill(pid,0);return True
        except ProcessLookupError:return False
        except OSError:return True
    import ctypes
    kernel=ctypes.WinDLL('kernel32',use_last_error=True)
    handle=kernel.OpenProcess(0x1000,False,pid)   # PROCESS_QUERY_LIMITED_INFORMATION
    if not handle:return ctypes.get_last_error()==5   # 권한 없음 = 있기는 하다
    try:
        code=ctypes.c_ulong();kernel.GetExitCodeProcess(handle,ctypes.byref(code));return code.value==259   # STILL_ACTIVE
    finally:kernel.CloseHandle(handle)

def _connection_mtime(path):
    try:return path.stat().st_mtime
    except OSError:return 0

def _metadata_rank(state):
    try:
        seen=float(state.get('seenAt') or 0);activated=float(state.get('lastActivated') or 0)
        recent=not seen or time.time()-seen<120
        return (bool(state.get('focused')) and recent,activated if recent else 0,seen)
    except (ValueError,TypeError):return (False,0,0)

def _target_match(state, target):
    if not target: return True
    if target.get('backend_generation') and target.get('backend_generation') != state.get('backend_generation'): return False
    sessions = {state.get('editor_session')} | {w.get('editor_session') for w in state.get('windows',[]) if isinstance(w,dict)}
    if target.get('editor_session') and target.get('editor_session') not in sessions: return False
    if target.get('job_id') and state.get('job_id') and target.get('job_id') != state.get('job_id'): return False
    return True

def find_connection(base=None,instance=None,target=None,probe=None,running=None):
    """BARUN_CAD_INSTANCE(포트)가 있으면 그 파일, 없으면 최근 파일부터 살아 있는 엔진을 고른다.
    꺼진 엔진의 연결 파일은 프로세스 번호로 먼저 거른다 — 꺼진 주소는 Windows 가 하나에 2초씩 기다렸다."""
    probe=_probe if probe is None else probe
    running=_pid_running if running is None else running
    folders=connection_dirs(base)
    instance=os.environ.get('BARUN_CAD_INSTANCE','') if instance is None else str(instance)
    candidates=[]
    if instance:candidates.extend(folder/f'connection-{instance}.json' for folder in folders)
    else:
        candidates.extend(sorted((Path(p) for folder in folders for p in glob.glob(str(folder/'connection-*.json'))),key=_connection_mtime,reverse=True))
        candidates.extend(folder/'connection.json' for folder in folders)
    loaded=[];generations=set()
    for path in candidates:
        try: state=json.loads(path.read_text(encoding='utf8'))
        except (OSError,ValueError): continue
        if isinstance(state,dict) and running(state.get('pid')):generations.add(state.get('backend_generation'))
        if isinstance(state,dict) and state.get('url') and state.get('token') and _target_match(state,target) and running(state.get('pid')):
            loaded.append(state)
    # job_id 를 맡았던 엔진이 다시 시작돼 사라졌으면 기다려도 돌아오지 않는다. 'reconnecting' 을 끝없이 되풀이하지 않게 바로 알린다.
    if target and target.get('job_id') and target.get('backend_generation') and target['backend_generation'] not in generations:
        raise CADToolError(JOB_GONE,{'code':'job_unavailable'})
    loaded.sort(key=_metadata_rank, reverse=True)
    unreachable=None;stale=False
    for state in loaded:
        result=probe(state)
        result='ok' if result is True else 'mismatch' if result is False else result
        if result=='ok': return state
        if result=='unreachable' and unreachable is None: unreachable=state
        if result=='mismatch': stale=True
    if target:raise CADToolError('지정한 도면 창에 다시 연결 중입니다. 몇 초 뒤 cad_get_document로 창 목록을 다시 읽으세요.',{'code':'reconnecting','retry_after_seconds':2})
    if unreachable:raise CADToolError(UNREACHABLE.format(url=unreachable['url']),{'code':'cad_unreachable'})
    if stale:raise CADToolError(STALE,{'code':'stale_connection'})
    raise CADToolError(NOT_RUNNING,{'code':'cad_not_running'})

JOB_GONE=('그 작업을 맡았던 바른 CAD 엔진이 다시 시작돼 작업 결과를 받을 수 없습니다. 도면을 바꾸는 작업이었다면 '
          'cad_get_document 로 도면을 읽어 반영됐는지 확인한 뒤, 안 됐으면 다시 하세요.')
# 읽기·조회 도구는 '다시 연결 중'이면 잠깐 기다렸다 다시 찾는다(창 새로 고침·잠깐 멈춤은 몇 초면 돌아온다, 10/16~22 기록 17건).
# 바꾸는 도구는 사용자·AI 가 확인하고 다시 부르게 그대로 알린다.
READ_PREFIXES=('cad_get_','cad_search_','cad_list_','cad_view_','cad_describe_','cad_validate','cad_check_','cad_observation_')
RECONNECT_TRIES=3;RECONNECT_WAIT=2

from miri_account_service import AILoginRequired, AILoginCheckUnavailable, AI_LOGIN_MESSAGE

CLIENT_INFO={}   # MCP initialize 의 clientInfo(AI 프로그램이 밝힌 이름). 허락 창에 참고로만 보인다 — 누구인지는 엔진이 직접 확인한다.
_grants={}       # (엔진 주소, 엔진 pid) → CAD 화면에서 허락받아 받은 열쇠
CONSENT_RETRY=('consent_required','consent_revoked')

def _raise_http(e):
    try:error=json.load(e)
    except ValueError:error={}
    if error.get('code') in ('not_logged_in','login_check_unavailable'):
        exc = AILoginCheckUnavailable if error.get('code') == 'login_check_unavailable' else AILoginRequired
        raise exc(error.get('error',AI_LOGIN_MESSAGE)) from None
    if isinstance(error.get('details'),dict):raise CADToolError(error.get('error','CAD 연결 오류'),error['details']) from None
    raise ValueError(error.get('error','CAD 연결 오류')) from None

def _grant(state,refresh=False):
    """연결 파일 토큰으로는 허락 요청만 한다. 처음이면 CAD 화면에 [허락] 창이 뜨고, 답을 45초까지 기다린다."""
    key=(state['url'],state.get('pid'))
    if refresh:_grants.pop(key,None)
    if key not in _grants:
        body=json.dumps({'client':CLIENT_INFO,'wait':45}).encode()
        request=urllib.request.Request(state['url']+'/api/mcp-hello',body,headers={'Content-Type':'application/json','Origin':state['url'],'X-CAD-Token':state['token']})
        try:
            with urllib.request.urlopen(request,timeout=60) as response:_grants[key]=json.load(response)['grant']
        except urllib.error.HTTPError as e:_raise_http(e)
    return _grants[key]

def _post(state,name,args,refreshed=False):
    url=state['url']
    body=json.dumps({'name':name,'arguments':args}).encode()
    request=urllib.request.Request(url+'/api/mcp',body,headers={'Content-Type':'application/json','Origin':url,'X-CAD-Token':_grant(state,refresh=refreshed)})
    # HTTP only starts or polls a job; the editor/worker keeps its separate deadline.
    timeout=30  # Work returns a job within one second; cad_get_job waits at most ten.
    try:
        with urllib.request.urlopen(request,timeout=timeout) as response:return json.load(response)
    except urllib.error.HTTPError as e:
        try:_raise_http(e)
        except CADToolError as error:
            # 허락을 취소했거나 엔진이 열쇠를 잊었으면 한 번만 다시 허락을 받는다.
            if error.code in CONSENT_RETRY and not refreshed:return _post(state,name,args,refreshed=True)
            raise

# 기준 먼저(사용자 2026-10-25 "연결할 때 무조건 읽게"): 이 연결에서 기준 세 가지를 한 번 다 읽기 전에는 도면을 그리거나 바꾸는 도구를 거절한다.
# 연결마다 한 번이면 된다(약 93 KB). 되돌리기·저장·선택은 막지 않는다.
STANDARD_PARTS=frozenset(('standard','rulebook','decisions'))
STANDARD_FREE=frozenset(('cad_select','cad_undo','cad_redo','cad_save','cad_save_complete'))
_standard_read=set()

def _standard_gate(name):
    from bridge import MUTATING_TOOLS,BOUND_ALIASES
    base=BOUND_ALIASES.get(name,name)
    if base in MUTATING_TOOLS and base not in STANDARD_FREE and not STANDARD_PARTS<=_standard_read:
        missing=sorted(STANDARD_PARTS-_standard_read)
        raise CADToolError('도면을 그리거나 고치기 전에 cad_get_drawing_standard 로 우리 기준 세 가지(도면 기준·규칙집·결정 기록)를 먼저 읽으세요.',{'code':'standard_first','missing':missing})

# 풀세트(사용자 2026-10-25): 새 설계로 평면만 그리지 않는다. 설계 JSON 을 새로 주면 늘 kind=set(같은 setId 로 다시 그리면 고친 평면이 모든 도면에).
def _full_set_gate(name,args):
    from bridge import BOUND_ALIASES
    if BOUND_ALIASES.get(name,name)!='cad_generate_drawing' or not isinstance(args,dict):return
    if args.get('model') and args.get('kind','set') in ('plan','elevation','section','schedule'):
        raise CADToolError('새 설계·고친 설계는 kind=set 으로 한 벌(풀세트)을 그리세요. 고칠 때는 같은 setId 로 다시 부르면 평면·입면·단면·창호도·상세가 함께 바뀝니다.',{'code':'full_set_required'})

def tool_call(name,args):
    """AI 프로그램의 도구 호출 입구(stdio). 기준 먼저·풀세트 검사 뒤 call 로 보낸다."""
    _standard_gate(name)
    _full_set_gate(name,args)
    result=call(name,args)
    if name=='cad_get_drawing_standard' and isinstance(result,dict):
        # 잠겨서 못 읽은 기준은 읽은 것으로 치지 않는다. 결정 기록은 설치판에 없으므로 받은 것만으로 친다.
        _standard_read.update(p for p in STANDARD_PARTS if p in result and (p=='decisions' or not (isinstance(result[p],dict) and set(result[p])=={'error'})))
    return result

def call(name,args):
    if not str(name).startswith(READ_PREFIXES):return _call(name,args)
    for attempt in range(RECONNECT_TRIES):
        try:return _call(name,args)
        except CADToolError as error:
            if error.code!='reconnecting' or attempt==RECONNECT_TRIES-1:raise
            time.sleep(RECONNECT_WAIT)

def _call(name,args):
    global _connection
    target = dict(args.get('target') or {}) if isinstance(args,dict) else {}
    if isinstance(args,dict) and args.get('job_id'):
        target['job_id'] = args['job_id']
        target['backend_generation'] = str(args['job_id']).split(':',1)[0]
    if isinstance(args,dict) and args.get('editor_session'):
        target['editor_session'] = args['editor_session']
    pinned = bool(target.get('backend_generation') or target.get('editor_session'))
    if pinned:
        _connection = find_connection(target=target)
    else:
        _connection = find_connection()
    state=_connection;url=state['url']
    result=_post(state,name,args)
    if isinstance(result,dict):
        result['destination']={**{'backend_generation':state.get('backend_generation'),'instance':str(state.get('port','')),'engine_url':url},**result.get('destination',{})}
        if name=='cad_get_document':
            windows={}
            for path in (p for folder in connection_dirs() for p in glob.glob(str(folder/'connection-*.json'))):
                try:
                    other=json.loads(Path(path).read_text(encoding='utf8'))
                    if not isinstance(other,dict) or not _pid_running(other.get('pid')):continue
                    for window in other.get('windows',[]):
                        if not isinstance(window,dict) or not window.get('editor_session'):continue
                        if window.get('seenAt') and time.time()-window['seenAt']>120:continue
                        row={k:window[k] for k in ('editor_session','drawingPath','drawingName','folder','focused','lastActivated','seenAt') if k in window}
                        row.update(backend_generation=other.get('backend_generation'),instance=str(other.get('port','')))
                        windows[(row['backend_generation'],row['editor_session'])]=row
                except (OSError,ValueError,TypeError):pass
            for window in result.get('windows',[]):
                windows[(window.get('backend_generation'),window.get('editor_session'))]=window
            result['windows']=sorted(windows.values(),key=_metadata_rank,reverse=True)
            result['selection_help']='windows의 editor_session을 cad_get_document에 주고 반환된 target으로 편집하세요. BARUN_CAD_INSTANCE=포트로 엔진을 고정할 수 있습니다. job_id와 target이 있는 호출은 원래 엔진을 계속 사용합니다.'
    return result

def serve():
    # MCP stdio 는 UTF-8 이다. sys.stdin 은 한국어 Windows 에서 cp949 로 읽어 한글 인자(주소·글자)가 깨졌다.
    for raw in getattr(sys.stdin,'buffer',sys.stdin):
        try:
            request=json.loads(raw.decode('utf-8') if isinstance(raw,bytes) else raw);method=request.get('method');identifier=request.get('id')
            if identifier is None:continue
            if method=='initialize':
                info=(request.get('params') or {}).get('clientInfo')
                if isinstance(info,dict):CLIENT_INFO.update({k:str(info[k])[:80] for k in ('name','version') if info.get(k)})
                result={'protocolVersion':'2024-11-05','capabilities':{'tools':{'listChanged':False}},'serverInfo':{'name':'barun-cad','version':'3.0.0'},'instructions':(ASK_INSTRUCTIONS+CAD_DRAWING_INSTRUCTIONS).strip()}
            elif method=='ping':result={}
            elif method=='tools/list':result={'tools':mcp_tools()}
            elif method=='tools/call':
                p=request['params']
                try:
                    out=tool_call(p['name'],p.get('arguments',{}))
                    # cad_view_drawing: 그림은 MCP image 로, 나머지(영역·축척)는 글로
                    out,image=extract_tool_image(out)
                    result={'content':[{'type':'text','text':json.dumps(out,ensure_ascii=False)}]+([{'type':'image','data':image['data'],'mimeType':image['mimeType']}] if image else []),'isError':False}
                except CADToolError as e:result={'content':[{'type':'text','text':json.dumps({'error':str(e),**e.details},ensure_ascii=False)}],'isError':True,'code':e.code}
                except (AILoginRequired, AILoginCheckUnavailable) as e:result={'content':[{'type':'text','text':str(e)}],'isError':True,'code':e.code}
                except Exception as e:result={'content':[{'type':'text','text':str(e)}],'isError':True}
            else:
                print(json.dumps({'jsonrpc':'2.0','id':identifier,'error':{'code':-32601,'message':'Method not found'}}),flush=True);continue
            print(json.dumps({'jsonrpc':'2.0','id':identifier,'result':result},ensure_ascii=True),flush=True)
        except Exception as e:
            print(json.dumps({'jsonrpc':'2.0','id':None,'error':{'code':-32700,'message':str(e)}}),flush=True)

if __name__=='__main__':serve()
