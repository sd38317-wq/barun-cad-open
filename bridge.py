"""Shared local CAD bridge for desktop UI, MCP, and Codex chat tools."""
import threading,time,uuid,copy,json,os,shutil,hashlib,base64,struct,re,math,unicodedata
from contextlib import contextmanager
from pathlib import Path
from miri_account_service import AILoginRequired,AILoginCheckUnavailable
import library_first
lock=threading.Condition()
clients={};queue={};results={};active=None
# 닫힌 편집 창(도면 칸)의 도면 사본을 엔진 메모리에 쌓아 두지 않는다. 8초만 지나도 이미 '없는 창'으로 다루므로 동작은 같다.
STALE_CLIENT_SECONDS=120
PROTOCOL_VERSION=1
BACKEND_GENERATION=str(uuid.uuid4())
TARGET_KEYS=frozenset(('protocol_version','backend_generation','editor_session','document_generation','snapshot_id','revision'))
BINDING_CAPABILITIES={'target_binding':1,'apply_time_check':True,'recipient_check':True,'consistent_snapshot':True}
BOUND_ALIASES={name+'_bound':name for name in ('cad_execute','cad_select','cad_undo','cad_redo','cad_save','cad_run_command','cad_insert_layout','cad_apply_openings','cad_generate_drawing','cad_generate_details','cad_insert_detail','cad_insert_jutong','cad_insert_unit','cad_access_plan','cad_insert_image')}
# 사용자는 짧게만 말한다(2026-10-16): 도면에서 채우고, 모르는 것만 쉬운 말·보기로 하나씩 묻는다(ai-asks.js 의 needs·assumed).
ASK_INSTRUCTIONS=' A tool may return status=running and job_id. Call cad_get_job with that same job_id and wait_seconds=10 until completed; use result, never submit the original mutation/open/save again. If reconnecting, wait a few seconds and read cad_get_document again. The user speaks briefly (e.g. 풍동검토 해줘, 일조 봐줘, 안에서 보여줘, 외벽 바꿔줘) and does not know code symbols or parameters. Never ask for technical terms, code categories or tool argument names. Fill what the drawing already tells (site address, model height, scale, room names) and say so in one plain line. Find answers yourself first (drawing, opened files, room labels, address, tools); if still unknown use the usual value, proceed and say it is assumed. Suggested needs are auto-answered. Ask the user only when nothing can be found or assumed: needs[0] in plain Korean, choices numbered, then call the same tool again with the answer. When a tool returns assumed, give the result and mention each assumption in one plain sentence so the user can change it. Never ask the user to select anything in the drawing; find it with the tools. One question per turn. For a section from the current plan call cad_generate_drawing with kind=section and omit model. For window/door schedules call kind=schedule; the tool collects existing openings without WSL registration. Read a fresh target first. Report recognition.assumed and unresolved rather than claiming inferred heights are known.'
FIELD_RECORD_INSTRUCTIONS=" 현장 사진·핀 질문은 cad_field_records_list로 목록부터 읽고 cad_field_records_get으로 메모·사진·이력을 확인합니다. 처리됨/다시 열림·답은 cad_field_records_update로 남기고 도면에서 보기 요청은 cad_field_records_locate를 씁니다. 같은 번호가 여럿이면 링크·제목을 확인하세요. 답의 장부 저장과 현장 전달을 구분하고 전달되지 않은 답을 보냈다고 말하지 마세요."
ASK_INSTRUCTIONS+=FIELD_RECORD_INSTRUCTIONS
CAD_DRAWING_INSTRUCTIONS='''
새 도면은 선을 하나씩 그리지 않는다: 설계 JSON(stories, elements: wall path·thickness / door·window host·offset·width / stair / space outline·use)을 만들어 cad_generate_drawing(kind=set)으로 늘 한 벌(풀세트: 목록·건축개요·구적도·배치도·평면·입면·단면·창호도·상세)을 그린다(사용자 2026-10-25 "도면 그려 달라 하면 무조건 풀세트"). 평면을 고칠 때도 JSON 을 고쳐 같은 setId 로 kind=set 을 다시 불러, 고친 평면이 입면·단면·창호도·상세 전부에 반영되게 한다(평면만 따로 다시 그리지 않는다). 생성기가 도면 기준(drawing-standard.json)의 순서·레이어·치수로 그린다.
모든 장은 한 벌 템플릿(sheet-templates.json, 도면 기준의 sheetTemplates)으로 그린다(사용자 2026-10-25 확정): 목록·개요·구적·배치·평면·입면·단면·창호도·상세마다 칸 자리·제목 자리·기호 모양이 정해져 있고, 층이 몇 개든 평면은 같은 틀·같은 축척·같은 축선 번호다. 다 그린 뒤 템플릿과 다르면(상세 칸 없음·네 면 치수 빠짐·제목 자리 다름·기호 원 겹침·원 안 글이 최소 크기보다 작음 등) code=sheet_template 로 그리기가 막힌다 — 막히면 설계 JSON 을 고치거나 사용자에게 알리고, 템플릿·검사를 피해 손으로 그리지 않는다. 템플릿을 바꾸는 것은 사용자 승인 뒤 sheet-templates.json 과 결정 기록에 함께 넣는다.
그림·사진에서 만들 때: 원본 치수선으로 중심선과 그릴 것을 정하고, 숫자가 없으면 안 보이는 50 mm 그리드로 벽 두께 비례 측정해 정수 mm 로, 묻지 않고 바로 그린다. 근거는 요소 evidence 에만("치수 3600"·"벽두께 비례"). 그린 뒤 결과 plan.storyOffsets[층]=[dx,dy] 로 cad_insert_image(path, align={imagePoints: 그림 속 두 점, drawingPoints: 설계 좌표+[dx,dy]}) 해서 원본을 비출력 밑그림으로 깐다.
도면 품질을 판단하거나 고치기 전, 생성기·기준을 바꾸기 전에는 cad_get_drawing_standard 로 기준 세 가지(도면 기준 drawing-standard.json · 규칙집 drawing-rulebook.json · 결정 기록)를 먼저 읽고 그 기준·결정대로 판단하고 고친다. 기준에 없는 새 규칙은 사용자 승인을 받아 기준 JSON 과 결정 기록에 함께 넣는다(생성기 코드에 숫자를 박지 않는다).
있는 도면을 조금 고칠 때: cad_get_layer_usage → cad_list_commands → cad_get_command 로 건축 명령(WALDRAW·D1·W1 등)을 먼저, 없으면 사용자 등록 리습(cad_lisp_run), 둘 다 없을 때만 기본 도형(cad_execute). 라이브러리로 그릴 것을 기본 도형·AI 리습으로 그리면 code=library_first 로 거절된다(써 보고 안 될 때만 library_check:{command, reason}).
기본 도형·리습도 바른 A- 레이어 세트를 쓰고 layer 또는 purpose 를 준다. 세트 밖 레이어 warnings 를 받으면 표준 레이어로 고친다. 사용자 레이어는 조용히 바꾸지 않는다. 성공하지 않은 명령을 성공으로 말하지 않는다.
'''
MUTATING_TOOLS=frozenset(BOUND_ALIASES.values()) | frozenset(('cad_set_floor_heights','cad_set_model3d','cad_push_pull','cad_set_materials','cad_delivery_fix','cad_lisp_run','cad_lisp_load','cad_save_complete','cad_structure_set_member','cad_structure_drawings','cad_structure_apply','cad_recognize_drawing'))  # cad_structure_apply = 브라우저에 보내는 내부 동작(도구 아님) — 결과 applied=true 를 받으려면 여기 있어야 한다
REVEAL_REQUIRED_TOOLS=frozenset(('cad_generate_drawing','cad_generate_details','cad_access_plan','cad_structure_drawings'))   # 도면을 새로 그려 넣는 도구 — 연출 필수
APP_CONTEXT=threading.local()

def assert_app_active():
    cancelled=getattr(APP_CONTEXT,'cancelled',None)
    if cancelled and cancelled():raise ValueError('AI 요청을 중지했습니다.')
    epoch=getattr(APP_CONTEXT,'login_epoch',None)
    if epoch is not None:
        from miri_account_service import validate_ai_epoch
        validate_ai_epoch(epoch)

def validate_app_request(identifier,recipient):
    from miri_account_service import require_ai_login
    require_ai_login()
    with lock:
        pending=pending_requests.get(identifier)
        if not pending or pending['recipient']!=recipient or time.monotonic()>=pending['deadline']:raise ValueError('종료되거나 만료된 AI 도구 요청입니다.')
        from miri_account_service import validate_ai_epoch
        validate_ai_epoch(pending.get('login_epoch'))
        cancelled=pending.get('cancelled')
        if cancelled and cancelled():raise ValueError('AI 요청을 중지했습니다.')
        return {'authorized':True}

pending_requests={}
output_close_receipts={}
OUTPUT_CLOSE_SECONDS=30
OUTPUT_CLOSE_LIMIT=1024


def _output_command(request):
    action=request.get('action');args=request.get('args') or {}
    value=args.get('name') if action=='cad_run_command' else args.get('command') if action=='cad_ui_command' else None
    return value.strip().upper() if isinstance(value,str) else None


def _remember_output_close_locked(identifier,pending,result):
    value=result.get('result');request=pending['request']
    if _output_command(request)!='QQ' or result.get('error') or not isinstance(value,dict):return
    if value.get('error') or value.get('cancelled') or value.get('applied') is not True:return
    if not isinstance(value.get('deferred'),list) or not value['deferred'] or type(value.get('pending')) is not int or value['pending']<=0:return
    now=time.monotonic()
    for key,receipt in list(output_close_receipts.items()):
        if receipt['deadline']<=now:output_close_receipts.pop(key,None)
    if len(output_close_receipts)>=OUTPUT_CLOSE_LIMIT:return
    target=request['args'].get('target')
    identity=(target['backend_generation'],target['document_generation'],target['revision']) if target else pending.get('output_identity')
    if identity is None:return
    output_close_receipts[identifier]={'recipient':pending['recipient'],'target':copy.deepcopy(target),'identity':identity,
        'login_epoch':pending.get('login_epoch'),'cancelled':pending.get('cancelled'),
        'deadline':min(pending['deadline'],now+OUTPUT_CLOSE_SECONDS)}


def validate_output_close(identifier,recipient):
    """성공 응답을 받은 QQ의 지연 닫기만 원래 요청 권한으로 한 번 허용한다."""
    from miri_account_service import require_ai_login,validate_ai_epoch
    require_ai_login()
    with lock:
        receipt=output_close_receipts.get(identifier)
        if not receipt or receipt['recipient']!=recipient:raise ValueError('확인할 출력 닫기 요청이 없습니다.')
        output_close_receipts.pop(identifier,None)
        if time.monotonic()>=receipt['deadline']:raise ValueError('출력 닫기 요청이 만료되었습니다.')
        validate_ai_epoch(receipt['login_epoch'])
        cancelled=receipt.get('cancelled')
        if cancelled and cancelled():raise ValueError('AI 요청을 중지했습니다.')
        state=_live_locked(recipient)
        if not state or receipt['identity']!=(BACKEND_GENERATION,state.get('document_generation'),state.get('revision')):
            raise ValueError('도면이 바뀌어 출력 닫기를 중지했습니다.')
        return {'authorized':True}


def register_chat_request(data):
    from miri_account_service import capture_ai_epoch
    origin=data.get('editorSession')
    epoch=capture_ai_epoch();identifier=str(uuid.uuid4());cancelled=threading.Event()
    with lock:
        for key,entry in list(pending_requests.items()):
            if entry.get('chat') and (entry['deadline']<=time.monotonic() or entry['recipient']==origin):
                entry['cancel_event'].set();pending_requests.pop(key,None)
        if len(pending_requests)>=1024:raise ValueError('진행 중 요청이 너무 많습니다.')
        pending_requests[identifier]={'chat':True,'recipient':origin,'login_epoch':epoch,'app_epoch':data.get('aiRequestEpoch'),
            'deadline':time.monotonic()+600,'cancel_event':cancelled,'cancelled':cancelled.is_set}
    return {'requestId':identifier,'recipient':origin,'expiresAt':int((time.time()+600)*1000)},epoch

def cancel_chat_requests(data):
    with lock:
        for entry in pending_requests.values():
            if entry.get('chat') and entry['recipient']==data.get('editorSession'):
                entry['cancel_event'].set()

DISPATCH_TIMEOUT=600
POST_EDIT_SNAPSHOT_SECONDS=2
RECONNECT_MESSAGE='편집 창에 다시 연결 중입니다. 몇 초 뒤 다시 시도하세요.'
# 영어 ValueError 는 MCP 에서 '처리 중 오류가 났습니다: CAD target changed…' 로 나가 AI·사용자가 원인을 몰랐다(10/16~22 기록).
TARGET_CHANGED_MESSAGE='그 사이 도면이 바뀌었습니다(편집·실행 취소·탭 전환, target changed). cad_get_document 로 새 target 을 읽고 미리보기부터 다시 하세요.'
JOB_RESPONSE_SECONDS=1.0
JOB_RETENTION_SECONDS=1800
JOB_LIMIT=64
_jobs={}
_jobs_lock=threading.Lock()
_tool_events={}
_tool_active={}
_TOOL_EVENT_LIMIT=64

def _safe_tool_target(args):
    target=args.get('target') if isinstance(args,dict) else None
    if not isinstance(target,dict): target={}
    out={}
    mode=args.get('mode',args.get('scope'))
    if mode in ('selection','window'):out['kind']=mode
    for key in ('kind','entity_count','ids_count'):
        value=target.get(key)
        if key=='kind' and value in ('document','selection','window'): out[key]=value
        elif key!='kind' and type(value) is int and 0<=value<=1000000: out[key]=value
    if isinstance(args,dict) and isinstance(args.get('ids'),list): out['ids_count']=len(args['ids'])
    return out

def emit_tool_event(recipient,event):
    if not recipient:return
    with lock:
        if not _live_locked(recipient):return
    with _jobs_lock:
        bucket=_tool_events.setdefault(recipient,[]);bucket.append(dict(event));del bucket[:-_TOOL_EVENT_LIMIT]
        active=_tool_active.setdefault(recipient,{})
        if event['phase']=='running':active[event['id']]=dict(event)
        else:active.pop(event['id'],None)
        while len(active)>JOB_LIMIT:active.pop(next(iter(active)))

def take_tool_events(recipient):
    with _jobs_lock:
        events=_tool_events.pop(recipient,[])
        active=_tool_active.get(recipient,{})
        # Include current state so a dropped/failed pulse cannot strand a band.
        present={event['id'] for event in events}
        events.extend(dict(event) for key,event in active.items() if key not in present)
        return events,list(active)

def _tool_count(result):
    if not isinstance(result,dict):return None
    summary=result.get('summary')
    document=result.get('document');entities=document.get('entities') if isinstance(document,dict) else None
    added=result.get('added')
    values=[summary.get('entityCount') if isinstance(summary,dict) else None,result.get('matched_count'),result.get('count'),
            result.get('entityCount'),len(entities) if isinstance(entities,list) else None,len(added) if isinstance(added,list) else None]
    return next((v for v in values if type(v) is int and 0<=v<=100000000),None)

def _tool_stage(stage):
    record=getattr(APP_CONTEXT,'job_record',None)
    event=getattr(APP_CONTEXT,'tool_event',None)
    if record is not None:record['stage']=stage
    if event:
        recipient,base=event
        emit_tool_event(recipient,{**base,'phase':'running','stage':stage,'at_ms':int(time.time()*1000)})

# 창(편집 세션) 단위 일: 도면 대상 묶기(target)가 없고 결과에도 리비전이 없다.
APP_SESSION_ACTIONS=frozenset(('cad_ui_command','cad_lisp_save'))
SESSION_ACTIONS=frozenset(('cad_open_file','cad_close_document','cad_reveal')) | APP_SESSION_ACTIONS
DRAWING_SUFFIXES=('.dxf','.dwg','.bcad')
OPEN_WAIT_SECONDS=120
CLOSING_SECONDS=10
closing_sessions={}  # 닫기로 한 세션 → 시각. 창이 실제로 닫히기 전 마지막 신호로 '열린 창'에 되살아나지 않게.


def validate_access_request(args, *, new=True):
    from datetime import date
    facility=args.get('facility')
    if facility is None:
        if new:raise ValueError('신규 편의시설 계획도에는 facility가 필요합니다.')
    else:
        allowed={'use','areaM2','work','date','parkingSpaces','parkingRatio','rooms','employmentObligation','units','residents','parkingKind','noiseDb'}
        if not isinstance(facility,dict) or set(facility)-allowed:raise ValueError('facility 필드를 확인하세요.')
        if not isinstance(facility.get('use'),str) or not facility['use'].strip():raise ValueError('대상 용도가 필요합니다.')
        area=facility.get('areaM2')
        if type(area) not in (int,float) or not math.isfinite(area) or area<=0:raise ValueError('면적은 유한 양수여야 합니다.')
        if facility.get('work') not in ('new','change-use'):raise ValueError('신축/용도변경을 지정하세요.')
        raw=facility.get('date')
        try:
            if not isinstance(raw,str) or not re.fullmatch(r'\d{4}-\d{2}-\d{2}',raw) or date.fromisoformat(raw).isoformat()!=raw:raise ValueError()
        except ValueError:raise ValueError('실제 달력 날짜(YYYY-MM-DD)가 필요합니다.') from None
        for key in ('parkingSpaces','rooms','units','residents'):
            value=facility.get(key)
            if value is not None and (type(value) not in (int,float) or not math.isfinite(value) or value<0 or value!=int(value)):raise ValueError(key+'은 비음수 정수여야 합니다.')
        ratio=facility.get('parkingRatio')
        if ratio is not None and (type(ratio) not in (int,float) or not math.isfinite(ratio) or not 0<=ratio<=1):raise ValueError('parkingRatio는 0~1이어야 합니다.')
        if 'employmentObligation' in facility and type(facility['employmentObligation']) is not bool:raise ValueError('employmentObligation은 boolean이어야 합니다.')
        if facility.get('parkingKind','ancillary') not in ('ancillary','off-street'):raise ValueError('parkingKind 유형을 확인하세요.')
        noise=facility.get('noiseDb')
        if noise is not None and (type(noise) not in (int,float) or not math.isfinite(noise) or noise<0):raise ValueError('noiseDb는 비음수여야 합니다.')
    if 'origin' in args:
        origin=args['origin']
        if not isinstance(origin,dict) or set(origin)!={'x','y'} or any(type(v) not in (int,float) or not math.isfinite(v) for v in origin.values()):raise ValueError('origin은 유한 x·y 좌표여야 합니다.')
    if 'overlay' in args and type(args['overlay']) is not bool:raise ValueError('overlay는 boolean이어야 합니다.')
    if 'story' in args and not isinstance(args['story'],str):raise ValueError('story는 층 id 문자열이어야 합니다.')

def valid_revision(value):
    return type(value) is int and 0<=value<=9007199254740991

def valid_uuid(value):
    if not isinstance(value,str):return False
    try:return str(uuid.UUID(value))==value
    except (ValueError,AttributeError):return False

def validate_target(target):
    if not isinstance(target,dict) or set(target)!=TARGET_KEYS:raise ValueError('CAD target binding is required')
    if type(target['protocol_version']) is not int or target['protocol_version']!=PROTOCOL_VERSION:raise ValueError('Unsupported CAD target protocol')
    if not valid_revision(target['revision']):raise ValueError('Invalid CAD target revision')
    if not all(valid_uuid(target[key]) for key in TARGET_KEYS-{'protocol_version','revision'}):raise ValueError('Invalid CAD target identifier')
    if target['backend_generation']!=BACKEND_GENERATION:raise CADToolError('바른 CAD 엔진이 다시 시작됐습니다(backend generation changed). cad_get_document 로 도면을 다시 읽으세요.',{'code':'target_changed'})
    return target

def _target_locked(client,state):
    if state.get('protocol_version')!=PROTOCOL_VERSION or not state.get('snapshot_id'):raise ValueError('이 CAD 화면은 AI 도면 연결을 지원하지 않습니다(target binding). 바른 CAD 를 최신 판으로 다시 켜 주세요.')
    if state.get('document_revision')!=state.get('revision'):raise CADToolError('CAD 화면이 방금 바뀐 도면 내용을 아직 보내는 중입니다(snapshot is stale). 몇 초 뒤 다시 시도하세요.',{'code':'reconnecting','retry_after_seconds':2})
    return {'protocol_version':PROTOCOL_VERSION,'backend_generation':BACKEND_GENERATION,'editor_session':client,
            'document_generation':state['document_generation'],'snapshot_id':state['snapshot_id'],'revision':state['document_revision']}

PAGE_SCHEMA={'limit':{'type':'integer','minimum':1,'maximum':100,'default':20},'offset':{'type':'integer','minimum':0,'default':0}}

def page_rows(result,args,keys):
    # 단위세대·주동 검색에 개수 제한이 없어 빈 검색어 한 번에 결과가 AI 한도를 넘었다(10/13·10/16 기록 5건).
    limit,offset=args.get('limit',20),args.get('offset',0)
    if type(limit) is not int or not 1<=limit<=100:raise ValueError('limit 는 1~100 정수여야 합니다.')
    if type(offset) is not int or offset<0:raise ValueError('offset 은 0 이상 정수여야 합니다.')
    rows=result.get(keys[0])
    if not isinstance(rows,list):return result
    page=rows[offset:offset+limit]
    out={**result,**{key:page for key in keys if key in result},'count':len(page),'total':len(rows),'offset':offset,'has_more':offset+limit<len(rows)}
    if out['has_more']:out['hint']=f'{len(rows)}개 중 {offset+1}~{offset+len(page)}번째입니다. 검색어를 좁히거나 offset={offset+limit} 로 다음을 읽으세요.'
    return out

def large_document_message(top):
    # 화면은 블록 정의 안 객체까지 센 무게로 판단한다(bridge-client.js documentWeight). 최상위 개수만 보이면
    # "46,525개라 안 됨, 50,000개 이하에서 쓰라"처럼 모순된다: 최상위가 한도 이하면 블록 안 객체 때문이라고 밝힌다.
    over=f"블록 정의 안 객체까지 합치면 {MAX_BRIDGE_ENTITIES:,}개를 넘어(최상위 객체 {top:,}개)" if top<=MAX_BRIDGE_ENTITIES else f"도면 객체가 {top:,}개라"
    return (f"{over} 전체 본문을 필요로 하는 도구를 지원하지 않습니다. "
            "cad_get_document 의 mode=window 또는 mode=selection 으로 좁혀 읽으세요. 대형 도면 target은 조회 전용입니다.")

def _state_locked(client,*,allow_omitted=False):
    state=clients.get(client)
    if state and 'documentOmitted' in state and time.monotonic()-state.get('seen',0)<=8:
        if allow_omitted:return state
        raise ValueError(large_document_message(state['documentOmitted']))
    if not state or 'document' not in state or time.monotonic()-state.get('seen',0)>8:raise CADToolError(RECONNECT_MESSAGE,{'code':'reconnecting','retry_after_seconds':2})
    return state

def _bound_state_locked(target,*,allow_omitted=False):
    validate_target(target)
    state=_state_locked(target['editor_session'],allow_omitted=allow_omitted)
    if _target_locked(target['editor_session'],state)!=target:raise CADToolError(TARGET_CHANGED_MESSAGE,{'code':'target_changed'})
    return state
MAX_BRIDGE_ENTITIES=50000                     # S6: 이보다 큰 도면은 화면이 문서를 보내지 않는다(app.js 복구 기준과 같다)
RECOVERY_DEBOUNCE_SECONDS=float(os.environ.get('BARUN_RECOVERY_DEBOUNCE','1.0') or 1.0)
RECOVERY_WRITE_ERROR='복구 파일을 저장하지 못했습니다. 디스크 여유 공간과 폴더 권한을 확인하세요.'

def recovery_dir():
    return Path(os.environ.get('BARUN_CAD_RECOVERY_DIR',str(Path(os.environ.get('LOCALAPPDATA',str(Path.home())))/'BarunCAD')))

def recovery_file(instance=None):
    """S5: 채널·포트(BARUN_CAD_INSTANCE)마다 다른 복구 파일. 3.x/Beta/5 가 한 파일을 번갈아 덮어쓰던 문제를 없앤다."""
    instance=os.environ.get('BARUN_CAD_INSTANCE','') if instance is None else str(instance)
    instance=''.join(ch for ch in instance if ch.isalnum() or ch in '-_')
    return recovery_dir()/(f'recovery-{instance}.json' if instance else 'recovery.json')

RECOVERY=recovery_file()
_written=None  # (경로,내용,크기,수정시각) 우리가 마지막으로 쓴 복구 파일 — 편집마다 전체를 다시 읽고 파싱하지 않으려고 기억한다
_write_lock=threading.Lock();_pending=None;_timer=None;_last_write=0.0;_last_error=None;_has_content=None

def configure(instance):
    """server.py 가 포트를 정한 뒤 호출한다(모듈 import 시점에는 아직 포트를 모른다)."""
    global RECOVERY,_written,_has_content
    RECOVERY=recovery_file(instance);_written=None;_has_content=None
    try:prune_recovery_files()   # 켤 때 오래된 세대(30일)·초과 세대를 정리한다
    except Exception:pass
    return RECOVERY

def legacy_recovery_file():
    """이전 판이 쓰던 공용 파일(같은 폴더의 recovery.json). 읽기만 하고 다시 쓰지 않는다."""
    return RECOVERY.parent/'recovery.json'

SESSION_GENERATIONS=3   # 저장하지 않은(dirty) 세션 보관본을 몇 세대까지 두는지

def session_files():
    """보관된 세션 세대(최신순). 이름: recovery-<port>-session-<UTC시각>.json"""
    prefix=RECOVERY.stem+'-session-'
    return sorted((p for p in RECOVERY.parent.glob(prefix+'*.json') if p.name.startswith(prefix)),key=lambda p:p.name,reverse=True)

def last_session_file():
    """가장 최근 세션 보관본(없으면 새로 만들 이름)."""
    found=session_files()
    if found:return found[0]
    return RECOVERY.with_name(RECOVERY.stem+'-session-'+time.strftime('%Y%m%dT%H%M%SZ',time.gmtime())+'.json')

def channel_recovery_file():
    """S4 예비 포트로 뜬 엔진도 채널 기본 포트의 복구본을 읽을 수 있게 한다(BARUN_CAD_CHANNEL_PORT)."""
    channel=os.environ.get('BARUN_CAD_CHANNEL_PORT','')
    if not channel:return None
    path=recovery_file(channel)
    return None if path==RECOVERY else path

LARGE_GENERATIONS=2;LARGE_MAX_BYTES=1_000_000_000;GENERATION_MAX_AGE_DAYS=30

def large_recovery_files():
    """5만 객체를 넘는 도면의 복구본(화면이 보낸 NDJSON 그대로, gzip). 시각 이름, 최신순."""
    prefix=RECOVERY.stem+'-large-'
    return sorted((p for p in RECOVERY.parent.glob(prefix+'*.ndjson.gz') if p.name.startswith(prefix)),key=lambda p:p.name,reverse=True)

def large_session_of(path):
    """파일 이름 recovery-<port>-large-<UTC>-<session>.ndjson.gz 에서 세션 id 를 꺼낸다(없으면 'nosession')."""
    name=path.name[:-len('.ndjson.gz')] if path.name.endswith('.ndjson.gz') else path.stem
    tail=name.split('-large-',1)[1] if '-large-' in name else ''
    parts=tail.split('-')
    return parts[1] if len(parts)>=2 and parts[1] else 'nosession'

def large_drawing_label(name):
    """ACAD200-812: 파일 이름에 넣을 도면 이름(쓸 수 없는 글자는 _, 60자). 없으면 ''(예전 이름 그대로)."""
    text=str(name or '').strip()
    text=''.join('_' if ch in '\\/:*?"<>|' or ord(ch)<32 else ch for ch in text)
    return text.rstrip(' .')[:60]

def large_drawing_of(path):
    """recovery-<port>-large-<UTC>-<session>-<도면>.ndjson.gz 의 도면 이름(옛 이름이면 '')."""
    name=path.name[:-len('.ndjson.gz')] if path.name.endswith('.ndjson.gz') else path.stem
    tail=name.split('-large-',1)[1] if '-large-' in name else ''
    return '-'.join(tail.split('-')[2:])

def large_recovery_file():
    """가장 최근 대용량 복구본(없으면 None)."""
    found=large_recovery_files()
    return found[0] if found else None

def prune_recovery_files():
    """8: 세대 보관본은 개수·용량·나이(30일)로 정리한다. 현재 복구본(recovery-<port>.json)은 건드리지 않는다."""
    removed=0;now=time.time()
    try:
        for index,item in enumerate(session_files()):
            if index>=SESSION_GENERATIONS or now-item.stat().st_mtime>GENERATION_MAX_AGE_DAYS*86400:
                try:item.unlink();removed+=1
                except OSError:pass
        # 대용량 세대: 세션(화면 client id)마다 가장 새 것은 남긴다. 개수 상한은 '세션별 최신이 아닌 것'부터 지우고,
        # 용량·나이 상한을 넘으면 오래된 것부터(세션별 최신이라도) 지운다.
        # ACAD200-812: 세션 하나에 큰 도면 탭이 여럿이면 도면마다 최신 세대를 남긴다(예전에는 한 탭 것만 살았다).
        files=large_recovery_files();newest_per_session={}
        key=lambda item:(large_session_of(item),large_drawing_of(item))
        for item in files:newest_per_session.setdefault(key(item),item)
        keep=[item for item in files if newest_per_session.get(key(item)) is item]
        extra=[item for item in files if item not in keep]
        for index,item in enumerate(keep+extra):
            if item in extra and index>=LARGE_GENERATIONS:
                try:item.unlink();removed+=1
                except OSError:pass
        total=0
        for item in [f for f in large_recovery_files()]:
            total+=item.stat().st_size
            if total>LARGE_MAX_BYTES or now-item.stat().st_mtime>GENERATION_MAX_AGE_DAYS*86400:
                try:item.unlink();removed+=1
                except OSError:pass
        for stale in RECOVERY.parent.glob(RECOVERY.stem+'-large-*.new.*'):
            try:
                if now-stale.stat().st_mtime>900:stale.unlink();removed+=1
            except OSError:pass
        legacy=RECOVERY.with_name(RECOVERY.stem+'-large.ndjson.gz')
        for old in (legacy,legacy.with_suffix('.bak')):
            try:
                if old.exists():old.unlink();removed+=1
            except OSError:pass
    except OSError:pass
    return removed

def _large_header(path):
    """대용량 복구본의 첫 줄(header)만 읽어 report(dirty·folder 등)를 돌려준다."""
    import gzip
    try:
        with gzip.open(path,'rb') as stream:line=stream.readline(1_000_000)
        record=json.loads(line)
        return record.get('report') or {}
    except (OSError,ValueError,EOFError):return None

def _saved_after(drawing_path,recovery_path):
    """감사 5·검토 A8: 대용량 복구본은 늘 dirty 로 적힌다. 그 뒤에 도면 파일이 더 새로우면(저장했거나 동기화·다른 프로그램이 건드림)
    켤 때 자동으로 권하지 않는다. 복구본 목록(RECOVER)에서는 그대로 보인다 — 파일 시각만으로 우리 저장인지 알 수 없으므로 숨기지 않는다."""
    if not drawing_path:return False
    try:
        import project;project.network_path(drawing_path)
        return Path(drawing_path).stat().st_mtime>=recovery_path.stat().st_mtime
    except (OSError,ValueError):return False

def recovery_sources():
    """복구본 목록(내용 없이, 최신순): kind large|json, savedAt(ms), dirty. 화면은 IndexedDB 보관본과 비교해 더 새로운 쪽을 고른다."""
    found=[]
    try:
        if RECOVERY.is_file():
            found.append({'kind':'json','savedAt':int(RECOVERY.stat().st_mtime*1000),'dirty':_payload_is_dirty(RECOVERY),'bytes':RECOVERY.stat().st_size,'hasContent':recovery_has_content()})
    except OSError:pass
    for path in large_recovery_files():
        header=_large_header(path)
        if header is None:continue
        try:found.append({'kind':'large','savedAt':int(path.stat().st_mtime*1000),'dirty':bool(header.get('dirty')),'fileNewer':_saved_after(header.get('drawingPath'),path),'bytes':path.stat().st_size,'hasContent':True,'path':path.name,'drawingName':str(header.get('drawingName') or large_drawing_of(path))})
        except OSError:continue
    found.sort(key=lambda item:item['savedAt'],reverse=True)
    return found

def _document_has_content(data):
    document=data.get('document') if isinstance(data,dict) else None
    return isinstance(document,dict) and bool(document.get('entities'))

def write_recovery(data):
    global _written,_has_content
    content=json.dumps(data,ensure_ascii=False)
    try:
        RECOVERY.parent.mkdir(parents=True,exist_ok=True)
        rotate=False
        if RECOVERY.exists():
            info=RECOVERY.stat();mine=bool(_written) and _written[0]==str(RECOVERY) and _written[2:]==(info.st_size,info.st_mtime_ns)
            if mine:  # 파일이 우리가 쓴 그대로면 읽기·파싱 없이 내용 비교와 회전 여부를 판단한다
                if _written[1]==content:return True
                rotate=True
            else:
                old=None
                try:old=RECOVERY.read_text(encoding='utf8')
                except (OSError,ValueError):pass  # 읽지 못하면 손상으로 보고 백업 회전 없이 새로 쓴다
                if old==content:_written=(str(RECOVERY),content,info.st_size,info.st_mtime_ns);return True
                if old is not None:
                    try:json.loads(old)
                    except ValueError:pass
                    else:rotate=True
        if rotate:
            first=RECOVERY.with_suffix('.bak');second=RECOVERY.with_suffix('.bak2')
            if first.exists():os.replace(first,second)
            os.replace(RECOVERY,first)  # 직전 내용을 다시 직렬화해 쓰지 않고 이름만 바꿔 회전한다
        temp=RECOVERY.with_suffix('.tmp')
        with temp.open('w',encoding='utf8') as handle:handle.write(content);handle.flush();os.fsync(handle.fileno())   # S15
        os.replace(temp,RECOVERY)
        info=RECOVERY.stat();_written=(str(RECOVERY),content,info.st_size,info.st_mtime_ns);_has_content=_document_has_content(data)
        return True
    except (OSError,ValueError):  # 복구 저장은 best-effort — 실패해도 pulse를 죽이면 안 된다
        _written=None;return False

def recovery_has_content():
    """현재 복구 파일에 객체가 있는 도면이 들어 있는지. 한 번만 읽고 이후에는 우리가 쓴 내용으로 갱신한다."""
    global _has_content
    if _has_content is None:
        _has_content=False
        for path in (RECOVERY,legacy_recovery_file()):
            try:_has_content=_document_has_content(json.loads(path.read_text(encoding='utf8')))
            except (OSError,ValueError):continue
            break
    return _has_content

def _payload_is_dirty(path):
    """복구 파일이 저장하지 않은 편집(dirty)을 담고 있는지. 파일이 크면 앞부분만 읽어 판단한다."""
    try:
        with path.open('r',encoding='utf8') as handle:head=handle.read(4096)
    except OSError:return False
    if '"dirty": true' in head or '"dirty":true' in head:return True
    if '"dirty"' in head:return False
    try:return bool(json.loads(path.read_text(encoding='utf8')).get('dirty'))
    except (OSError,ValueError):return False

def preserve_last_session():
    """S2: 새 세션이 직전 복구본을 덮어쓰기 전에 별도 세대로 남긴다.
    저장하지 않은(dirty) 복구본만 보관하고, 시각이 붙은 이름이라 서로 덮어쓰지 않으며 최신 SESSION_GENERATIONS 개를 유지한다.
    (참고 파일만 열어 본 세션은 잃을 것이 없으므로 보관하지 않는다 → 앞선 dirty 보관본이 살아남는다)"""
    try:
        if not RECOVERY.is_file() or not recovery_has_content() or not _payload_is_dirty(RECOVERY):return False
        stamp=time.strftime('%Y%m%dT%H%M%SZ',time.gmtime())
        target=RECOVERY.with_name(RECOVERY.stem+'-session-'+stamp+'.json');index=0
        while target.exists():index+=1;target=RECOVERY.with_name(RECOVERY.stem+f'-session-{stamp}-{index}.json')
        temp=target.with_suffix('.tmp')
        shutil.copyfile(RECOVERY,temp);os.replace(temp,target)
        for old in session_files()[SESSION_GENERATIONS:]:
            try:old.unlink()
            except OSError:pass
        return True
    except (OSError,ValueError):return False

def store_large_recovery(stream,size):
    """5만 객체를 넘는 도면: 화면이 보낸 NDJSON 요청을 그대로 복구 파일로 저장한다(검증·fsync·교체)."""
    import import_stream
    RECOVERY.parent.mkdir(parents=True,exist_ok=True)
    stamp=time.strftime('%Y%m%dT%H%M%SZ',time.gmtime())
    temp=RECOVERY.with_name(RECOVERY.stem+f'-large-{stamp}.new.'+uuid.uuid4().hex)
    info=import_stream.save_request_stream(stream,size,str(temp))
    # 4: 세션(화면 client id)을 이름에 넣어 세션마다 최신 세대가 살아남게 한다.
    session=''.join(ch for ch in str((info['header'].get('report') or {}).get('client') or '') if ch.isalnum())[:8] or 'nosession'
    label=large_drawing_label((info['header'].get('report') or {}).get('drawingName'));suffix=f'-{label}' if label else ''
    target=RECOVERY.with_name(RECOVERY.stem+f'-large-{stamp}-{session}{suffix}.ndjson.gz');index=0
    while target.exists():index+=1;target=RECOVERY.with_name(RECOVERY.stem+f'-large-{stamp}{index}-{session}{suffix}.ndjson.gz')
    try:os.replace(str(temp),target)
    except OSError as error:raise ValueError('대용량 복구 파일을 저장하지 못했습니다: '+str(error))
    prune_recovery_files()
    return {'stored':True,'lines':info['lines'],'bytes':info['bytes'],'path':str(target),'generations':len(large_recovery_files())}

_io_lock=threading.Lock()   # 배경 타이머와 종료 flush 가 같은 파일을 동시에 쓰지 않게 한다

def _flush_pending():
    global _pending,_timer,_last_write,_last_error
    while True:
        with _write_lock:
            data=_pending;_pending=None
            if data is None:_timer=None;return
        with _io_lock:ok=write_recovery(data)
        with _write_lock:_last_write=time.monotonic();_last_error=None if ok else RECOVERY_WRITE_ERROR

def schedule_recovery(data):
    """S6: 편집마다 디스크에 쓰지 않고 잠깐 모아 배경 스레드에서 쓴다. 브리지 lock 밖에서 돈다."""
    global _pending,_timer
    with _write_lock:
        _pending=data
        if _timer is not None:return
        wait=max(0.0,RECOVERY_DEBOUNCE_SECONDS-(time.monotonic()-_last_write))
        _timer=threading.Timer(wait,_flush_pending);_timer.name='barun-recovery-writer';_timer.start()

def flush_recovery():
    """정상 종료·테스트에서 남은 복구 내용을 바로 쓴다."""
    with _write_lock:timer=_timer
    if timer is not None:timer.cancel()
    _flush_pending()

def recovery_error():
    with _write_lock:return _last_error

def _bridge_document(value):
    if isinstance(value,list):return [_bridge_document(item) for item in value]
    if not isinstance(value,dict):return value
    image=value.get('type')=='image'
    result={key:_bridge_document(item) for key,item in value.items() if not (image and key=='data')}
    if image:result['hasData']=bool(value.get('data') or value.get('hasData'))
    return result


def pulse(data):
    global active
    if isinstance(data.get('document'),dict):data={**data,'document':_bridge_document(data['document'])}
    client=data['client']
    if not isinstance(client,str) or not client:raise ValueError('Invalid editor client')
    with lock:
        if time.monotonic()-closing_sessions.get(client,-math.inf)<CLOSING_SECONDS:raise ValueError('Closed editor session')
        previous=clients.get(client,{})
        state=dict(previous)
        bound=data.get('protocol_version')==PROTOCOL_VERSION
        if bound:
            if type(data.get('protocol_version')) is not int or not valid_uuid(client) or data.get('editor_session')!=client:raise ValueError('Invalid editor session')
            if not valid_uuid(data.get('document_generation')) or not valid_revision(data.get('revision')):raise ValueError('Invalid document generation/revision')
            if previous.get('protocol_version')==PROTOCOL_VERSION and data['revision']<previous.get('revision',0):raise ValueError('Editor revision went backwards')
            changed_generation=state.get('document_generation')!=data['document_generation']
            if changed_generation:
                for key in ('document','document_revision','snapshot_id','documentOmitted','document_digest'):state.pop(key,None)
            state.update(protocol_version=PROTOCOL_VERSION,document_generation=data['document_generation'])
            if 'document' in data or data.get('documentOmitted'):
                if ('document' in data and not isinstance(data['document'],dict)) or data.get('document_revision')!=data['revision'] or not valid_revision(data.get('document_revision')):raise ValueError('Document body revision mismatch')
                same=not changed_generation and state.get('document_revision')==data['document_revision']
                if same and 'document' in data and 'document' in state and state['document']!=data['document']:raise ValueError('Immutable CAD snapshot body changed at the same revision')
                if not same or not state.get('snapshot_id'):state['snapshot_id']=str(uuid.uuid4())
                if 'document' in data and (not same or not state.get('document_digest')):
                    state['document_digest']=hashlib.sha256(json.dumps(data['document'],sort_keys=True,separators=(',',':'),ensure_ascii=False,allow_nan=False).encode('utf-8')).hexdigest()
                state['document_revision']=data['document_revision']
        elif previous.get('protocol_version')==PROTOCOL_VERSION:
            raise ValueError('Editor protocol downgrade is not allowed')
        fresh=bool(data.get('freshLaunch')) and not state.get('freshHandled')
        if fresh:state['freshHandled']=True
        for key in ('document','selected','revision','folder','commandSettings','drawingPath','drawingName','draftKey'):
            if key in data:state[key]=data[key]
        if data.get('documentOmitted'):
            state.pop('document',None);state['documentOmitted']=int(data.get('entityCount') or 0)
            state.pop('document_digest',None)
            if not bound:state.pop('snapshot_id',None);state.pop('document_revision',None)
        elif 'document' in data:state.pop('documentOmitted',None)
        state['focused']=data.get('active') is True
        state['visible']=data.get('visible') is not False   # 옛 화면은 이 값을 안 보낸다 → 보이는 것으로
        if state['focused'] and not previous.get('focused'):state['lastActivated']=time.time()
        state['seenAt']=time.time()
        state['seen']=time.monotonic()
        clients[client]=state
        now=time.monotonic()
        for other in [c for c,s in clients.items() if c!=client and now-s.get('seen',0)>STALE_CLIENT_SECONDS]:
            clients.pop(other,None);queue.pop(other,None)
            with _jobs_lock:_tool_events.pop(other,None);_tool_active.pop(other,None)
            if active==other:active=None
        if data.get('active') or active is None:active=client
        elif not _live_locked(active):
            active=max((c for c in clients if _live_locked(c)),key=lambda c:clients[c].get('lastActivated',0),default=client)
        rejected=[]
        for result in data.get('results',[]):
            identifier=result.get('id') if isinstance(result,dict) else None
            pending=pending_requests.get(identifier)
            if not pending or pending['recipient']!=client or result.get('target')!=pending['request']['args']['target']:
                rejected.append(identifier);continue
            if identifier in results:continue  # An identical retried pulse cannot complete it twice.
            if time.monotonic()>pending['deadline']:
                rejected.append(identifier);continue
            if pending['request']['action'] in SESSION_ACTIONS:
                if not result.get('error') and not isinstance(result.get('result'),dict):rejected.append(identifier);continue
            elif not result.get('error'):
                value=result.get('result');target=pending['request']['args']['target']
                wanted=pending['request']['action'] in MUTATING_TOOLS
                output_no_change=pending['request']['action']=='cad_run_command' and _output_command(pending['request']) in ('MSL','QQ') and isinstance(value,dict) and value.get('applied') is False and value.get('after_revision')==target['revision']
                if (not isinstance(value,dict) or value.get('target')!=target or not valid_revision(value.get('before_revision')) or value.get('before_revision')!=target['revision'] or
                    not valid_revision(value.get('after_revision')) or value['after_revision']<target['revision'] or
                    value.get('revision')!=value['after_revision'] or type(value.get('applied')) is not bool or (value['applied']!=wanted and not output_no_change)):
                    rejected.append(identifier);continue
            results[identifier]=copy.deepcopy(result)
            _remember_output_close_locked(identifier,pending,result)
        pending=[]
        retained=[]
        for request in queue.get(client,[]):
            record=pending_requests.get(request['id'])
            if record and request['id'] not in results and time.monotonic()<record['deadline']:
                pending.append(copy.deepcopy(request));retained.append(request)
        queue[client]=retained;lock.notify_all()
        stale=bound and state.get('document_revision')!=state.get('revision')
        tool_events,tool_active=take_tool_events(client)
        response={'requests':pending,'active':active==client,'needDocument':('document' not in state or stale) and 'documentOmitted' not in state,
                  'protocol_version':PROTOCOL_VERSION,'backend_generation':BACKEND_GENERATION,'rejected_results':rejected,'toolEvents':tool_events,'toolActiveIds':tool_active}
        if bound and ('document' in state or 'documentOmitted' in state) and not stale:response['target']=_target_locked(client,state)
        if active==client:
            import ai_consent
            consent=ai_consent.pending_for_screen()
            if consent:response['aiConsent']=consent   # 바깥 AI 첫 연결 허락 창(지금 쓰는 도면 창에만)
        if 'dirty' in data:state['dirty']=bool(data['dirty'])
        payload={k:state[k] for k in ('document','folder','commandSettings','dirty') if k in state} if ('document' in data and active==client) else None
        empty=payload is not None and not _document_has_content(data) and not data.get('dirty')
    # 디스크 작업은 lock 밖에서: 결과 수집·큐 배달을 막지 않는다
    if fresh:preserve_last_session()
    if payload is not None:
        # 빈 새 도면(편집 전)은 내용이 있는 직전 복구본을 덮어쓰지 않는다
        if not (empty and recovery_has_content()):schedule_recovery(payload)
    error=recovery_error()
    if error:response['recoveryError']=error
    return response

def restore():
    legacy=legacy_recovery_file();channel=channel_recovery_file()
    large=large_recovery_file()
    # 대용량 복구본이 일반 복구본보다 새로우면 그것을 스트림으로 돌려준다(server.py 가 stream_response 로 보낸다).
    try:
        if large is not None and large.is_file() and (not RECOVERY.is_file() or large.stat().st_mtime>=RECOVERY.stat().st_mtime):
            return {'largeRecoveryPath':str(large),'document':{}}
    except OSError:pass
    candidates=[(RECOVERY,None),(RECOVERY.with_suffix('.bak'),'최근 복구 파일을 읽지 못해 이전 백업을 불러왔습니다.'),(RECOVERY.with_suffix('.bak2'),'최근 복구 파일을 읽지 못해 이전 백업을 불러왔습니다.')]
    if channel is not None:
        candidates+=[(channel,'기본 포트의 복구 파일을 불러왔습니다(예비 포트 실행).'),(channel.with_suffix('.bak'),'기본 포트의 복구 백업을 불러왔습니다.')]
    if legacy!=RECOVERY:
        candidates+=[(legacy,'이전 판의 복구 파일을 불러왔습니다.'),(legacy.with_suffix('.bak'),'이전 판의 복구 백업을 불러왔습니다.'),(legacy.with_suffix('.bak2'),'이전 판의 복구 백업을 불러왔습니다.')]
    candidates+=[(path,'지난 세션 보관본을 불러왔습니다.') for path in session_files()]
    for path,warning in candidates:
        try:
            data=json.loads(path.read_text(encoding='utf8'))
            if not isinstance(data,dict) or not isinstance(data.get('document'),dict):continue
            if warning:data['recoveryWarning']=warning
            return data
        except (OSError,ValueError):continue
    return {}

def _default_editor():
    return getattr(APP_CONTEXT,'recipient',None) or getattr(APP_CONTEXT,'origin',None) or active

def snapshot(editor_session=None):
    with lock:
        client=_default_editor() if editor_session is None else editor_session
        if editor_session is not None and not valid_uuid(editor_session):raise ValueError('Invalid requested editor session')
        state=_state_locked(client)
        value={k:v for k,v in state.items() if k in ('document','selected','revision','folder','commandSettings','drawingPath','drawingName')}
        value.update(windows=window_list(),selection_help='editor_session으로 창을 고른 뒤 그 target으로 편집하세요. BARUN_CAD_INSTANCE로 엔진을 고정할 수 있습니다.')
        if state.get('protocol_version')==PROTOCOL_VERSION:
            value.update(target=_target_locked(client,state),capabilities=dict(BINDING_CAPABILITIES))
        else:value['capabilities']={'target_binding':0}
        return copy.deepcopy(value)

def get_document(args):
    mode=args.get('mode');window=args.get('window');ids=args.get('ids');limit=args.get('limit',200)
    if mode is not None and mode not in ('summary','window','selection'):raise ValueError('mode는 summary·window·selection 중 하나입니다.')
    if type(limit) is not int or not 1<=limit<=1000:raise ValueError('limit은 1~1000 정수입니다.')
    if mode=='window':
        if (not isinstance(window,dict) or set(window)!={'x0','y0','x1','y1'} or
            any(type(v) not in (int,float) or not math.isfinite(v) for v in window.values()) or window['x0']>window['x1'] or window['y0']>window['y1']):raise ValueError('window는 유한한 x0,y0,x1,y1과 정방향 범위가 필요합니다.')
    elif 'window' in args:raise ValueError('window는 mode=window에서만 씁니다.')
    if 'ids' in args and (mode!='selection' or not isinstance(ids,list) or len(ids)>1000 or any(not isinstance(i,str) or not i for i in ids)):raise ValueError('ids는 mode=selection의 1000개 이하 객체 ID 배열입니다.')
    with lock:
        client=args.get('editor_session',_default_editor())
        if 'editor_session' in args and not valid_uuid(client):raise ValueError('Invalid requested editor session')
        state=_state_locked(client,allow_omitted=True)
        if mode is None and 'documentOmitted' not in state:return snapshot(args.get('editor_session'))
        # 편집 직후에는 본문 전송이 늦을 수 있다. 같은 도면의 현재 본문을 기다린 뒤 target을 묶는다.
        generation=state.get('document_generation');backend=BACKEND_GENERATION;end=time.monotonic()+POST_EDIT_SNAPSHOT_SECONDS
        while state.get('protocol_version')==PROTOCOL_VERSION and state.get('document_revision')!=state.get('revision'):
            assert_app_active();remain=end-time.monotonic()
            if remain<=0:raise CADToolError('CAD 화면이 방금 바뀐 도면 내용을 아직 보내는 중입니다(snapshot is stale). 몇 초 뒤 다시 시도하세요.',{'code':'reconnecting','retry_after_seconds':2})
            lock.wait(min(remain,.1));state=_state_locked(client,allow_omitted=True)
            if BACKEND_GENERATION!=backend or state.get('document_generation')!=generation:raise CADToolError(TARGET_CHANGED_MESSAGE,{'code':'target_changed'})
        out=dispatch('cad_get_document',{**args,'mode':mode or 'summary','editor_session':client})
    return {**out,'windows':window_list(),'selection_help':'editor_session으로 창을 고르고 mode=window·selection으로 좁혀 읽으세요.'}

def observation_head(editor_session=None):
    """Bound, constant-size metadata only; no document copy or hash during polling."""
    if editor_session is not None and not valid_uuid(editor_session):raise ValueError('Invalid requested editor session')
    with lock:
        client=_default_editor() if editor_session is None else editor_session
        state=clients.get(client,{})
        bound=state.get('protocol_version')==PROTOCOL_VERSION
        unavailable={'available':False,'capabilities':dict(BINDING_CAPABILITIES) if bound else {'target_binding':0}}
        try:state=_state_locked(client)
        except CADToolError:return {**unavailable,'reason':'reconnecting','message':RECONNECT_MESSAGE,'retry_after_seconds':2}
        except ValueError as error:return {**unavailable,'reason':'document_unavailable','message':str(error)}
        if not bound:return {**unavailable,'reason':'target_binding_unavailable'}
        if state.get('document_revision')!=state.get('revision') or not state.get('document_digest'):
            return {**unavailable,'reason':'snapshot_stale'}
        try:target=_target_locked(client,state)
        except ValueError:return {**unavailable,'reason':'snapshot_stale'}
        return {'available':True,'target':target,'capabilities':dict(BINDING_CAPABILITIES),
                'document_digest':state['document_digest'],'focused':state.get('focused') is True,
                'age_ms':max(0,int((time.monotonic()-state['seen'])*1000))}

def dispatch(action,args):
    with lock:
        target=args.get('target')
        if target is None:
            if action in MUTATING_TOOLS:raise ValueError('도면을 바꾸는 도구에는 target 이 필요합니다(target binding is required). cad_get_document 로 읽은 target 을 넣으세요.')
            client=args.get('editor_session',_default_editor())
            if 'editor_session' in args and not valid_uuid(client):raise ValueError('Invalid requested editor session')
            state=_state_locked(client,allow_omitted=action in ('cad_get_document','cad_field_records_locate','cad_field_records_authorize'));target=_target_locked(client,state)
        elif action not in MUTATING_TOOLS and isinstance(target,dict) and target.get('backend_generation')==BACKEND_GENERATION and valid_uuid(target.get('editor_session')):
            # 읽기 도구(설명·미리보기·보기)는 같은 창의 옛 target 을 지금 target 으로 다시 묶는다. AI 가 그린 직후 옛 target 을
            # 그대로 넘겨 cad_describe_command·cad_view_drawing 이 'target changed' 로 막히던 것(10/16~22 기록 11건).
            # 바꾸는 도구는 그대로 완전 일치를 요구한다.
            target=_target_locked(target['editor_session'],_state_locked(target['editor_session'],allow_omitted=action in ('cad_get_document','cad_field_records_locate','cad_field_records_authorize')))
        _bound_state_locked(target,allow_omitted=action in ('cad_get_document','cad_field_records_locate','cad_field_records_authorize'))
        # 그리는 연출 필수(사용자 2026-10-25 "그거 없으면 도면 못 그리게"): 도면 창이 숨겨져(최소화·뒤에서 켜짐·화면 잠김) 연출을 보여 줄 수 없으면 그리지 않는다.
        if BOUND_ALIASES.get(action,action) in REVEAL_REQUIRED_TOOLS and clients.get(target['editor_session'],{}).get('visible') is False:
            # 같은 앱의 다른 탭에 가려진 것이면 그 탭을 앞으로 꺼내고 그린다(미리가 PDF 를 다른 탭에 열어 제 탭이 뒤로 갔다, 2026-10-29). 그래도 안 보이면(최소화·화면 잠금) 거절.
            try:
                if _send_locked(target['editor_session'],'cad_reveal',{'target':None},target['revision']).get('visible') is True:clients[target['editor_session']]['visible']=True
            except (ValueError,CADToolError):pass
        if BOUND_ALIASES.get(action,action) in REVEAL_REQUIRED_TOOLS and clients.get(target['editor_session'],{}).get('visible') is False:
            raise CADToolError('바른 CAD 도면 창이 숨겨져 있어 그리는 과정을 보여 줄 수 없습니다. CAD 창을 화면에 띄운 뒤 다시 하세요.',{'code':'reveal_unavailable'})
        args=copy.deepcopy({**args,'target':target})
        if 'expectedRevision' in args and args['expectedRevision']!=target['revision']:raise CADToolError('도면 판 번호가 미리보기 때와 다릅니다(revision differs). cad_get_document 로 다시 읽고 미리보기부터 다시 하세요.',{'code':'target_changed'})
        return _send_locked(target['editor_session'],action,args,target['revision'])

class CADToolError(ValueError):
    def __init__(self,message,details):
        super().__init__(message)
        self.details=details
        self.code=details.get('code','cad_tool_error')

def dispatch_timeout(action,args):
    # HTTP 호출은 짧게 job을 돌려주고 실제 편집은 원래 대상에서 계속 기다린다.
    action=BOUND_ALIASES.get(action,action)
    command=str(args.get('name','')).strip().upper()
    if action in APP_SESSION_ACTIONS or action=='cad_confirm_write':return 180
    if action in ('cad_generate_drawing','cad_generate_details','cad_access_plan','cad_push_pull'):return DISPATCH_TIMEOUT
    if action in ('cad_run_command','cad_preview_command','cad_describe_command'):return DISPATCH_TIMEOUT
    return DISPATCH_TIMEOUT

def _send_locked(client,action,args,revision):
    assert_app_active()
    from miri_account_service import capture_ai_epoch
    login_epoch=getattr(APP_CONTEXT,'login_epoch',None)
    if login_epoch is None:login_epoch=capture_ai_epoch()
    args={**args,'_login_epoch':login_epoch}
    app_epoch=getattr(APP_CONTEXT,'epoch',None)
    if app_epoch is not None:args={**args,'_app_epoch':app_epoch,'_app_origin':getattr(APP_CONTEXT,'origin',None)}
    cancelled=getattr(APP_CONTEXT,'cancelled',None)
    if cancelled and cancelled():raise ValueError('AI 요청을 중지했습니다.')
    identifier=str(uuid.uuid4());timeout=dispatch_timeout(action,args);end=time.monotonic()+timeout
    request={'id':identifier,'action':action,'args':args,'revision':revision,
             'expires_at':int((time.time()+timeout)*1000)}
    pending_requests[identifier]={'recipient':client,'request':request,'deadline':end,'cancelled':cancelled,'login_epoch':login_epoch}
    if _output_command(request)=='QQ':
        state=clients.get(client,{})
        pending_requests[identifier]['output_identity']=(BACKEND_GENERATION,state.get('document_generation'),revision)
    queue.setdefault(client,[]).append(request)
    _tool_stage('waiting' if action=='cad_confirm_write' else 'dispatch')
    lock.notify_all()
    try:
        while identifier not in results:
            assert_app_active()
            remain=end-time.monotonic()
            if remain<=0:
                if action in MUTATING_TOOLS:raise ValueError('CAD 창 응답 시간이 초과되었습니다. 실행 여부가 미확인입니다. 같은 변경을 자동 재시도하지 마세요.')
                # 읽기 도구는 바뀐 것이 없으니 '재시도 금지'를 붙이지 않는다.
                raise CADToolError('CAD 창 응답 시간이 초과되었습니다. 읽기만 하는 요청이라 도면은 바뀌지 않았습니다. 창을 새로 고쳤거나 닫았다면 cad_get_document 로 창을 다시 고른 뒤 다시 부르세요.',{'code':'timeout_read','retry_after_seconds':2})
            lock.wait(min(remain,.25))
        result=results.pop(identifier)
        if cancelled and cancelled():raise ValueError('AI 요청을 중지했습니다.')
    finally:
        pending_requests.pop(identifier,None)
        queue[client]=[r for r in queue.get(client,[]) if r['id']!=identifier]
    if result.get('error'):
        if action in ('cad_lisp_run','cad_lisp_load') and isinstance(result.get('error_data'),dict):
            raise CADToolError(result['error'],result['error_data'])
        raise ValueError(result['error'])
    value=result['result']
    if action in MUTATING_TOOLS and value.get('applied'):
        # 원래 target은 응답 검증용. 다음 편집에는 화면이 보낸 편집 후 본문에 묶인 target만 준다.
        target=args['target'];after=value['after_revision'];end=time.monotonic()+POST_EDIT_SNAPSHOT_SECONDS
        while True:
            state=clients.get(client,{})
            if BACKEND_GENERATION!=target['backend_generation'] or state.get('document_generation')!=target['document_generation'] or state.get('revision',0)>after:break
            if state.get('revision')==state.get('document_revision')==after and state.get('snapshot_id') and _live_locked(client):
                value={**value,'target':_target_locked(client,state)}
                if 'documentOmitted' in state:
                    value.update(documentOmitted=True,capabilities={**BINDING_CAPABILITIES,'document_query':True,'editing':False},
                                 message=(value.get('message','')+' '+large_document_message(state['documentOmitted'])).strip())
                return value
            remain=end-time.monotonic()
            if remain<=0:break
            lock.wait(min(remain,.1))
        value={**value,'target':None,'target_refresh_required':True,'message':(value.get('message','')+' target 다시 읽기 필요: cad_get_document 로 현재 target 을 받으세요.').strip()}
    return value

def _live_locked(client):
    state=clients.get(client)
    return state if state and time.monotonic()-state.get('seen',0)<=8 else None

def has_screen():
    """AI 허락 창을 띄울 도면 창이 지금 있는지(ai_consent.hello)."""
    with lock:return any(_live_locked(c) for c in list(clients))

def _path_key(value):
    # 맥은 이름의 대소문자를 가리지 않고(APFS 기본) 한글을 NFD 로 줄 때가 있다. 같은 파일이면 같은 열쇠가 되게 한다.
    import sys,unicodedata
    key=os.path.normcase(os.path.normpath(unicodedata.normalize('NFC',str(value))))
    return key.casefold() if sys.platform=='darwin' else key

def _window_for_path_locked(key):
    """그 파일이 지금 도면인 살아 있는 창. 도면 본문(또는 대용량 표시)이 온 뒤에만 '열림'."""
    for client,state in clients.items():
        if _live_locked(client) and state.get('drawingPath') and _path_key(state['drawingPath'])==key and ('document' in state or 'documentOmitted' in state):return client
    return None

def _opened(client,already_open):
    state=clients[client]
    return {'opened':True,'already_open':already_open,'editor_session':client,'drawingPath':state.get('drawingPath',''),'drawingName':state.get('drawingName',''),
            'revision':state.get('revision',0),'large':'documentOmitted' in state}

def on_disk_path(path):
    """NAS(SMB)는 맥이 올린 한글 이름을 자모로 나눈 꼴(NFD)로 두어, 다른 꼴(NFC) 경로로는 못 찾는다(2026-10-29 괴정사리로).
    경로(파일·폴더)가 앱을 지나며 어느 꼴로 바뀌어 오든, 폴더 목록에 실제로 적힌 이름으로 바꿔 돌려준다(없으면 그대로).
    있는지 묻기(exists)로 고르지 않는다: 맥 SMB 는 방금 쓴 이름을 기억해 다른 꼴도 가끔 '있다'고 해, 다음 읽기에서 실패한다."""
    parts=Path(path).parts
    if not parts or all(part.isascii() for part in parts):return path
    found=Path(parts[0])
    for name in parts[1:]:
        if not name.isascii():
            try:name=next((entry for entry in os.listdir(found) if unicodedata.normalize('NFC',entry)==unicodedata.normalize('NFC',name)),name)
            except OSError:pass
        found=found/name
    return str(found)

PDF_OPEN_ROOT=None   # 시험이 바꿀 수 있게; None 이면 임시 폴더/BarunCAD/pdf-open

def pdf_as_dxf(path):
    """PDF 첫 쪽을 PDFIMPORT 와 같은 벡터·글자 객체로 임시 DXF 에 담아 (경로, 축척 N) 을 돌려준다.
    PDF 레이어(OCG)가 있으면 그 이름 레이어로, 없으면 PDF-IMPORT 하나. 치수 숫자로 축척을 찾으면 실제 mm(×N)로 키운다(못 찾으면 종이 mm, N=None).
    미리가 PDF 도면을 열어 남의 도면 읽기(치수 숫자 근거)로 다시 그리게(2026-10-29 괴정사리로). 원본 폴더에는 아무것도 안 쓴다.
    shortcut: 첫 쪽만 — 여러 쪽 PDF 를 쓰게 되면 page 인자를 받는다."""
    import tempfile,pdf_import,exchange
    raw=Path(path).read_bytes()
    folder=Path(PDF_OPEN_ROOT or Path(tempfile.gettempdir())/'BarunCAD'/'pdf-open')/(hashlib.sha256(raw).hexdigest()[:16]+'-v2')
    target=folder/(Path(path).stem+'.dxf');scale_file=folder/'scale.txt'
    if not target.is_file():
        page=pdf_import.import_pdf_page(raw,0,1.0,True)
        if not page['entities']:raise ValueError('PDF 에 선·글자가 없습니다(스캔 그림 PDF 는 사진으로 넣으세요: cad_insert_image).')
        scale=pdf_import.dimension_scale(page['entities'])
        if scale:page=pdf_import.import_pdf_page(raw,0,scale,True)
        names=sorted({entity.get('pdfLayer') or 'PDF-IMPORT' for entity in page['entities']})
        model={'version':2,'units':'mm','layers':[{'id':f'L{index}','name':name,'color':'#ffffff','visible':True,'locked':False} for index,name in enumerate(names)],
               'entities':[{**{k:v for k,v in entity.items() if k!='pdfLayer'},'id':f'p{index}','layer':f"L{names.index(entity.get('pdfLayer') or 'PDF-IMPORT')}"} for index,entity in enumerate(page['entities'])]}
        folder.mkdir(parents=True,exist_ok=True);partial=target.with_suffix('.part')
        partial.write_bytes(exchange.export_dxf(model)[0]);scale_file.write_text(repr(scale),encoding='utf-8');os.replace(partial,target)
    scale=float(scale_file.read_text(encoding='utf-8')) if scale_file.is_file() and scale_file.read_text(encoding='utf-8')!='None' else None
    return str(target),scale

def _pdf_note(result,scale):
    """PDF 로 연 창이면 찾은 축척을 알린다(미리가 '종이 mm 인지 실제 mm 인지' 알고 읽게)."""
    if scale is False:return result
    return {**result,'pdf':{'scale':round(scale,2) if scale else None,'units':'실제 mm(치수 숫자로 맞춤)' if scale else '종이 mm(치수로 축척을 못 찾음 — 치수 숫자로 읽으세요)'}}

# 사용자는 "문서/캐드참고자료/…"처럼 말한다(2026-10-30 괴정 시험: 미리가 폴더를 못 열어 평면 읽기에 폴더 이름을 넘겼다).
USER_FOLDERS={'문서':'Documents','도큐먼트':'Documents','documents':'Documents','바탕화면':'Desktop','desktop':'Desktop','다운로드':'Downloads','downloads':'Downloads'}

def user_path(path):
    if not isinstance(path,str):return path
    path=os.path.expanduser(path.strip())
    head,_,rest=path.replace('\\','/').partition('/')
    folder=USER_FOLDERS.get(unicodedata.normalize('NFC',head).lower())
    return os.path.join(os.path.expanduser('~'),folder,rest) if folder and not os.path.isabs(path) else path

def drawing_files(folder):
    """폴더를 주면 열지 않고 그 안 도면 파일(DXF·DWG·BCAD·PDF) 목록을 준다 — 미리가 하나씩 cad_open_file 로 연다."""
    names=sorted(n for n in os.listdir(folder) if n.lower().endswith(DRAWING_SUFFIXES+('.pdf',)) and not n.startswith('.'))
    return {'folder':folder,'files':[os.path.join(folder,unicodedata.normalize('NFC',n)) for n in names[:200]],'truncated':len(names)>200,
            'next':'폴더라 열지 않았습니다. 필요한 파일을 cad_open_file(path=files[i])로 하나씩 열고, 평면은 그 창 editor_session 으로 cad_read_foreign_plan 을 부르세요.'}

def open_file(args):
    """도면 파일을 데스크톱 앱의 새 도면 창으로 열고, 그 창이 엔진에 붙을 때까지 기다린다(이미 열려 있으면 그 창)."""
    path=user_path(args.get('path'))
    if not isinstance(path,str) or not os.path.isabs(path):raise ValueError('path 는 도면 파일의 절대 경로여야 합니다.')
    if os.path.isdir(on_disk_path(path)):return drawing_files(on_disk_path(path))
    if not path.lower().endswith(DRAWING_SUFFIXES+('.pdf',)):raise ValueError('DXF·DWG·BCAD·PDF 도면 파일만 열 수 있습니다.')
    path=on_disk_path(path)
    if not os.path.isfile(path):raise ValueError('도면 파일이 없습니다: '+path)
    pdf_scale=False
    if path.lower().endswith('.pdf'):path,pdf_scale=pdf_as_dxf(path)
    wait=args.get('timeout_seconds',OPEN_WAIT_SECONDS)
    if type(wait) not in (int,float) or not 5<=wait<=600:raise ValueError('timeout_seconds 는 5~600 초입니다.')
    key=_path_key(path)
    with lock:
        found=_window_for_path_locked(key)
        if found:return _pdf_note(_opened(found,True),pdf_scale)
        requester=args.get('editor_session',_default_editor())
        if 'editor_session' in args and not valid_uuid(requester):raise ValueError('Invalid requested editor session')
        if not _live_locked(requester):raise CADToolError(RECONNECT_MESSAGE,{'code':'reconnecting','retry_after_seconds':2})
        _send_locked(requester,'cad_open_file',{'path':path,'target':None},clients[requester].get('revision',0))
        end=time.monotonic()+wait
        while not (found:=_window_for_path_locked(key)):
            remain=end-time.monotonic()
            if remain<=0:raise ValueError(f'도면 창이 {wait:g}초 안에 열리지 않았습니다(큰 도면은 더 걸립니다). 같은 열기를 반복하지 말고 잠시 뒤 cad_open_file 로 다시 확인하세요 — 이미 열렸으면 그 창을 돌려줍니다.')
            lock.wait(min(remain,1))
        return _pdf_note(_opened(found,False),pdf_scale)

def close_document(args,*,app_ai=False):
    """편집 창의 지금 도면을 닫는다. 저장 안 한 변경이 있으면 창이 거부한다. 마지막 도면이면 창(프로세스)째 닫힌다."""
    global active
    client=args.get('editor_session')
    if not valid_uuid(client):raise ValueError('닫을 창의 editor_session 이 필요합니다(cad_get_document·cad_open_file 결과).')
    with lock:
        if not _live_locked(client):raise ValueError('그 편집 창이 열려 있지 않습니다(이미 닫혔을 수 있습니다).')
        result=_send_locked(client,'cad_close_document',{'target':None,'app_ai':app_ai},clients[client].get('revision',0))
        if result.get('closed') is not True:raise ValueError('CAD 창이 닫기 결과를 돌려주지 않았습니다.')
        session_closed=result.get('session_closed') is True
        if session_closed:
            now=time.monotonic()
            for other in [c for c,t in closing_sessions.items() if now-t>=CLOSING_SECONDS]:closing_sessions.pop(other)
            closing_sessions[client]=now;clients.pop(client,None);queue.pop(client,None)
            if active==client:active=None
        return {'closed':True,'session_closed':session_closed,'editor_session':client,
                'drawingPath':str(result.get('drawingPath') or ''),'drawingName':str(result.get('drawingName') or '')}


LAYOUT_CACHE_LIMIT=16;LAYOUT_CACHE_SECONDS=30*60
_layout_lock=threading.Lock();_layouts={}

def _prune_layouts_locked():
    now=time.monotonic()
    for key in [key for key,(created,_) in _layouts.items() if now-created>=LAYOUT_CACHE_SECONDS]:_layouts.pop(key)

def _cache_layout(result,request):
    source=result.get('input')
    source=source if isinstance(source,dict) and source.get('site',{}).get('crs')=='EPSG:5187' else request
    value=copy.deepcopy({'report':result['report'],'entities':result['entities'],'input':source})
    identifier=str(uuid.uuid4())
    with _layout_lock:
        _prune_layouts_locked()
        while len(_layouts)>=LAYOUT_CACHE_LIMIT:_layouts.pop(next(iter(_layouts)))
        _layouts[identifier]=(time.monotonic(),value)
    return identifier

def _get_layout(identifier):
    with _layout_lock:
        _prune_layouts_locked()
        item=_layouts.get(identifier) if isinstance(identifier,str) else None
        if item is None:raise ValueError('배치안 layout_id가 없거나 만료되었습니다. 배치안을 다시 요청하세요.')
        value=item[1]
    return copy.deepcopy(value)

def _layout_overrides(request,args):
    for key in ('zoning','program'):
        if key not in args:continue
        if not isinstance(args[key],dict):raise ValueError('배치 '+key+'은 객체여야 합니다.')
        request.setdefault(key,{}).update(copy.deepcopy(args[key]))
    return request

_parcel_contexts={}


def _parcel_context_key(args):
    try:
        with lock:
            client=args.get('editor_session') or _default_editor()
            state=_state_locked(client)
            return client,state.get('document_generation')
    except ValueError:return None


def _remember_parcel(name,args,value,key):
    if key is None:return value
    with lock:
        for k,(created,_) in list(_parcel_contexts.items()):
            if time.monotonic()-created>=LAYOUT_CACHE_SECONDS:_parcel_contexts.pop(k,None)
        if len(_parcel_contexts)>=LAYOUT_CACHE_LIMIT:_parcel_contexts.pop(next(iter(_parcel_contexts)))
        if name=='cad_search_address':context={'address':args.get('query',''),'search':copy.deepcopy(value)}
        else:context={'pnu':value.get('pnu') or args.get('pnu'),'parcel':copy.deepcopy(value)}
        _parcel_contexts[key]=(time.monotonic(),context)
    return value


def _layout_input(args,mode='generate'):
    import layout_context
    try:
        current=snapshot(args.get('editor_session'));document=current['document']
        target=current['target'];key=(target['editor_session'],target['document_generation'])
    except ValueError:
        if args.get('editor_session'):raise
        document={};key=None
    with lock:item=_parcel_contexts.get(key)
    cached=copy.deepcopy(item[1]) if item and time.monotonic()-item[0]<LAYOUT_CACHE_SECONDS else None
    return layout_context.prepare(document,args,cached,mode)


def _site_plan_from_drawing(args):
    import layout_context
    result=_layout_input(args)
    request=result.get('request')
    if request:
        zoning=request['zoning'];program=request['program']
        result['summary']={'site_area_m2':layout_context.area(request['site']['parcel']),'zone':zoning.get('zone'),'bcr':zoning.get('bcr'),'far':zoning.get('far'),'floors':program.get('floors')}
    return result


def _place_from_site_plan(args):
    """원본 배치도 + 설계 + 지적 대지 → 설계 좌표 대지(model.site.parcel). 미리가 '기준 모서리·대지까지 거리'를 묻던 것(2026-10-30 괴정동 213-17·18)."""
    import site_placement
    path=args.get('sitePlanPath')
    if not isinstance(path,str) or not path.lower().endswith(('.pdf','.dxf')):raise ValueError('sitePlanPath 는 원본 배치도 PDF 또는 DXF 경로입니다.')
    path=on_disk_path(path)
    if not Path(path).is_file():raise ValueError(f'원본 배치도 파일이 없습니다: {path}')
    if path.lower().endswith('.pdf'):path,_=pdf_as_dxf(path)
    model,site,north,context=args.get('model'),args.get('site'),None,None
    set_id=args.get('setId')
    if model is None or site is None:
        document=snapshot(args.get('editor_session'))['document']
        if model is None:
            sets=document.get('drawingSets') or {}
            if set_id is None and len(sets)==1:set_id=next(iter(sets))
            if not isinstance(set_id,str) or not isinstance((sets.get(set_id) or {}).get('model'),dict):raise ValueError('설계 묶음을 찾지 못했습니다. cad_get_drawing_sets 의 setId 나 model 을 주세요.')
            model=sets[set_id]['model']
        if site is None:
            area=lambda pts:abs(sum(p['x']*q['y']-q['x']*p['y'] for p,q in zip(pts,pts[1:]+pts[:1])))/2
            rings=[e for e in document.get('entities') or [] if e.get('type')=='polyline' and e.get('parcelRole')=='site' and (e.get('attributes') or {}).get('ring')!='hole' and len(e.get('points') or [])>=3]
            if not rings:raise ValueError('현재 도면에 가져온 대지가 없습니다. 먼저 cad_get_parcel 로 지적 대지를 불러오거나 site 로 점(mm)을 주세요.')
            source=max(rings,key=lambda e:area(e['points']))
            site=[[p['x'],p['y']] for p in source['points']];a=source.get('attributes') or {};north=a.get('northVector')
            # 배치도에 그릴 둘레(2026-10-30): 지적 도로·이웃 필지, 대지 지번(합필이면 필지들), 대장 대지면적, 용도지역
            zone=next((z.get('name') for z in (a.get('landInfo') or {}).get('zones') or [] if z.get('relation')!='접함' and str(z.get('name') or '').endswith('지역')),None)
            context={'parcels':[{'role':e['parcelRole'],'coords':[[p['x'],p['y']] for p in e['points']],'jibun':(e.get('attributes') or {}).get('jibun','')} for e in document.get('entities') or []
                                if e.get('type')=='polyline' and e.get('parcelRole') in ('road','neighbor') and (e.get('attributes') or {}).get('ring')!='hole' and len(e.get('points') or [])>=3],
                     'jibun':'·'.join(a.get('siteJibuns') or [])or a.get('jibun'),'ledgerAreaM2':a.get('ledgerAreaM2'),'zone':zone}
    if not isinstance(model,dict):raise ValueError('model 은 설계 JSON 입니다.')
    site=[[p['x'],p['y']] for p in _apartment_points(site,'site')]
    result=site_placement.place(path,model,site,north if isinstance(north,list) and len(north)==2 else None,context)
    if set_id:result['next']=f"{result['next']} (setId {set_id})"
    return result


def _layout_response(result,status):
    if status!=200:
        message=result.get('error') or ('설계엔진 오류 ('+str(status)+')')
        raise ValueError(('하루 사용 한도 초과: ' if status==429 else '')+str(message))
    return result

def _layout_checks(report):
    checks=[{key:c.get(key) for key in ('rule','ok','value','limit','provisional','source','engineValue') if key in c} for c in report['checks']]
    return {'ok':all(c['ok'] is True for c in checks),'checks':checks}

def _suggest_layout(args):
    import plan_service
    context=_layout_input(args)
    if context['needs']:return context
    request=context['request']
    result=_layout_response(*plan_service.suggest_site_engine({'siteEngine':request}))
    report=result['report'];numbers=report.get('numbers') or {};counts={}
    for entity in result['entities']['entities']:
        kind=entity['type'];counts[kind]=counts.get(kind,0)+1
    keys=('site_area_gross','site_area','deducted_area','building_area','gfa','bcr','bcr_max','far','far_max','floors','height','floor_areas','parking_placed','parking_required','landscape_provided','landscape_required')
    return {'layout_id':_cache_layout(result,request),**_layout_checks(report),'metrics':{key:numbers[key] for key in keys if key in numbers},'entity_counts':counts,
            **{key:context[key] for key in ('autoFilled','assumed','needs')}}


def _extension_from_ledger(args):
    """증축·대수선: 기존 건축면적·연면적·대지면적·층수를 도면 대지의 건축물대장에서 채운다(괴정 2026-10-30: 미리가 '대장 건축면적·연면적이 몇 ㎡냐' 고 물었다)."""
    existing=args.get('existing') or {}
    if existing.get('arch') is not None and existing.get('floor') is not None:return args,{}
    import parcel_service,site_plan_service
    try:
        with lock:document=_bound_state_locked(args['target'])['document']
        pnus=list(dict.fromkeys(str((e.get('attributes') or {}).get('pnu')) for e in site_plan_service.boundary_entities(document) if e.get('parcelRole')=='site' and (e.get('attributes') or {}).get('pnu')))
    except (ValueError,KeyError):pnus=[]
    for pnu in pnus:
        try:found=parcel_service.ledger(pnu)
        except ValueError:continue
        if not (found.get('archAreaM2') or found.get('totalAreaM2')):continue
        values={'existing.arch':found.get('archAreaM2'),'existing.floor':found.get('totalAreaM2'),'siteArea':found.get('lotAreaM2'),'floors':found.get('groundFloors')}
        filled={k:{'value':v,'from':'건축물대장 '+found['jibun']} for k,v in values.items() if v is not None and (k.split('.')[-1] not in (existing if k.startswith('existing') else args))}
        out={**args,'existing':{**({'arch':values['existing.arch']} if values['existing.arch'] is not None else {}),**({'floor':values['existing.floor']} if values['existing.floor'] is not None else {}),**existing}}
        if 'siteArea' in filled:out['siteArea']=values['siteArea']
        if 'floors' in filled:out['floors']=values['floors']
        return out,filled
    return args,{}


def _sunlight_report(args):
    """일조 보고서 PDF(2026-10-30 대표 '일조 보고서 도구'): AI 설계 엔진 정북 일조(층별·평면·A–A 단면) + 3D 동지 그림자(이웃 필지별 일조 시간) + 토지·법규. 화면 [토지·법규 검토서]와 같은 쪽 그림."""
    import miriboda_service,site_plan_service
    context=_layout_input(args,'validate')
    if context['needs']:return context
    request=context['request'];request.pop('output',None)
    report=_layout_response(*site_plan_service.process(request,'validate'))
    import layout_context
    report=layout_context.use_set_area(report,snapshot(args.get('editor_session'))['document'])   # 보고서의 건폐율·용적률도 도면 구적으로
    sun=report.get('sunlight') if isinstance(report.get('sunlight'),dict) else {'applies':False}
    review={'sunlight':sun,'limits':[],'limitsFrom':'section',**({'section':miriboda_service.sunlight_section(request['site'],report['geometry'],sun)} if sun.get('applies') else {})}
    current=snapshot(args.get('editor_session'));document=current['document']
    source=next((e for e in site_plan_service.boundary_entities(document) if e.get('parcelRole')=='site'),None)
    info=((source or {}).get('attributes') or {}).get('landInfo') or {}
    if not info.get('review') and request['site'].get('id'):
        import layout_context
        info=miriboda_service.land_info(request['site']['id'],layout_context.area(request['site']['parcel']),request['program'].get('floors',3))
    import layout_context,parcel_service
    near=[e for e in site_plan_service.parcel_snapshot_entities(document) if e.get('parcelRole')=='neighbor']
    if source and not near and request['site'].get('id'):
        try:near=parcel_service.fetch({'pnu':request['site']['id'],'crs':'EPSG:5187'}).get('entities',[])
        except ValueError:near=[]
    neighbors=layout_context.set_neighbors(document,source,near) if source else []
    study=dispatch('cad_sun_study',{'target':current['target'],'day':'winter','grid':True,'size':256,'neighbors':neighbors})
    shadow=(study.get('result') or study).get('grid') if isinstance(study,dict) else None
    out=miriboda_service.pdf({'landInfo':info,'report':report,'site':request['site'],'sunlightReview':review,'shadow':shadow,'localOk':True,'dxf':True})   # 인쇄 서버가 거절하면 같은 쪽을 이 PC 글꼴로
    import tempfile
    folder=Path(current.get('folder') or '') if current.get('folder') else Path(tempfile.mkdtemp(prefix='barun-sunlight-'))
    path=folder/('일조검토서-'+time.strftime('%Y%m%d-%H%M')+'.pdf');path.write_bytes(base64.b64decode(out['data']))
    drawing=path.with_suffix('.dxf');drawing.write_bytes(base64.b64decode(out['dxf']))   # 캐드에서 볼 판(쪽마다 A4)
    floors=[{'floor':f['floor'],'heightM':f['top_h'],'requiredM':f['north_setback']} for f in sun.get('by_floor') or []]
    legal=[c for c in report['checks'] if re.search('건축가능영역|정북|일조',c.get('rule',''))]
    return {'path':str(path),'drawingPath':str(drawing),'next':'drawingPath 를 cad_open_file 로 열어 캐드에서 보여 주세요(쪽마다 A4 한 장).','renderer':out.get('renderer'),'sunlight':{'applies':sun.get('applies'),'floors':floors},
            'checks':[{k:c.get(k) for k in ('rule','ok','value','limit')} for c in legal],'shadow':shadow and {k:shadow.get(k) for k in ('okRatio','cells','neighbors','worst')},
            **{key:context[key] for key in ('autoFilled','assumed')}}


def _validate_layout(args):
    import site_plan_service
    if 'layout_id' in args and 'request' in args:raise ValueError('layout_id 또는 request 하나만 주세요.')
    context=None
    if 'layout_id' in args:
        result=_get_layout(args['layout_id']);source=result['input']
        request={key:copy.deepcopy(source[key]) for key in ('site','zoning','program')}
        request['overrides']=copy.deepcopy(args.get('overrides') or source.get('overrides') or result['report']['geometry'])
        request=_layout_overrides(request,args)
        import layout_context
        needs=layout_context.housing_needs(request['program'])
        if needs:return {'status':'needs_input','needs':needs,'autoFilled':{},'assumed':[]}
    else:
        context=_layout_input(args,'validate')
        if context['needs']:return context
        request=context['request'];request.pop('output',None)
    report=_layout_response(*site_plan_service.process(request,'validate'))
    import layout_context
    try:report=layout_context.use_set_area(report,snapshot(args.get('editor_session'))['document'])   # 건폐율·용적률은 도면 구적으로
    except ValueError:pass   # 열린 도면이 없으면 엔진 값 그대로
    # 정북 일조는 층마다(엔진 sunlight.by_floor: 층 윗면 높이·필요 정북 이격) — 미리가 층별로 알리게(2026-10-30)
    return {**_layout_checks(report),**({'sunlight':report['sunlight']} if isinstance(report.get('sunlight'),dict) else {}),**({key:context[key] for key in ('autoFilled','assumed','needs')} if context else {})}


# 아파트 검토(apartment_service): 화면(apartment-panel.js)과 같은 계산을 AI도 부른다. 도면은 바꾸지 않고 표·숫자만 돌려준다.
# run_all(이 PC 엔진으로 한 번에)은 넣지 않는다 — 설치판엔 엔진이 없어 '내장 구성요소 누락'으로 멈췄다(10/22). AI 는 서버 흐름만.
APARTMENT_ACTIONS=('zones','zone_suggest','enclose','incentive_table','review','review_job')
APARTMENT_OPTIONS={'heightLimit':{'type':'number','exclusiveMinimum':0,'description':'높이 제한 m'},
    'redevelopment':{'type':'boolean','description':'재개발·재건축 사업'},'northExempt':{'type':'boolean','description':'정북 일조 제외(상업·준주거 등)'},
    'sunGate':{'type':'boolean','description':'동지 일조 2시간 확인'},'stripCommercial':{'type':'boolean','description':'저층 상가 띠'},
    'planMode':{'type':'string','enum':['maxfar','target'],'description':'maxfar=용적률 최대, target=목표 용적률'},
    'maxUnitsPerFloor':{'type':'integer','minimum':1,'maximum':16},'floors':{'type':'integer','minimum':1,'maximum':80},'floorsMax':{'type':'integer','minimum':1,'maximum':80},
    'incentives':{'type':'object','description':'켤 인센티브. 예: {"road_frontage":{"road_width_m":20,"road_frontage_m":40},"green_building_cert":"우수"}'},
    'siteExtra':{'type':'object','description':'인센티브 계산용 대지 값. 예: {"open_space_m2":300,"landscape_m2":500,"road_width_m":20}'},
    'incentiveExclude':{'type':'array','items':{'type':'string'},'maxItems':30,'description':'review·incentive_table: 뺄 인센티브 이름'},
    'incentiveChoices':{'type':'object','description':'review·incentive_table: 인센티브 이름 → 고른 등급'},
    'includePnus':{'type':'array','items':{'type':'string'},'description':'대지면적에 넣을 도로·하천 등 필지 PNU'},
    'excludePnus':{'type':'array','items':{'type':'string'},'description':'가두리 안이지만 뺄 필지 PNU'},
    'fetchMissing':{'type':'boolean','default':True,'description':'도면에 없는 가두리 안 필지를 VWorld에서 더 받기'}}
_apartment_lock=threading.Lock();_apartment_jobs={}
APARTMENT_JOB_LIMIT=20


def _apartment_points(points,label):
    if not isinstance(points,list) or len(points)<3:raise ValueError(label+' 는 [x,y] 점 3개 이상입니다.')
    out=[]
    for p in points:
        x,y=(p.get('x'),p.get('y')) if isinstance(p,dict) else (p[0],p[1]) if isinstance(p,(list,tuple)) and len(p)>=2 else (None,None)
        if type(x) not in (int,float) or type(y) not in (int,float) or not math.isfinite(x) or not math.isfinite(y):raise ValueError(label+' 점은 유한한 mm 좌표 [x,y] 입니다.')
        out.append({'x':x,'y':y})
    return out


def _apartment_boundary(document,selected,args):
    """가두리 찾기 — 화면(enclosurePL·sitePolyline)과 같은 순서: 준 점 → 선택한 닫힌 PL 하나 → '가두리' 레이어 닫힌 PL 하나 → 가져온 대지 바깥 경계."""
    if args.get('boundary') is not None:return _apartment_points(args['boundary'],'boundary'),'boundary'
    ents=document.get('entities') or []
    closed=lambda e:e.get('type')=='polyline' and e.get('closed') and len(e.get('points') or [])>=3 and not e.get('parcelRole')
    chosen=set(selected or []);pick=[e for e in ents if e.get('id') in chosen and closed(e)];source='selection'
    if not pick:
        layer=next((l for l in document.get('layers') or [] if l.get('name')=='가두리'),None)
        pick=[e for e in ents if layer and e.get('layer')==layer.get('id') and closed(e)];source='가두리 레이어'
    if len(pick)>1:raise ValueError('가두리로 쓸 닫힌 PL이 여러 개입니다. 하나만 선택하거나 "가두리" 레이어에 하나만 두거나 boundary 로 점을 주세요.')
    if pick:return _apartment_points(pick[0]['points'],'가두리'),source
    area=lambda pts:abs(sum(p['x']*q['y']-q['x']*p['y'] for p,q in zip(pts,pts[1:]+pts[:1])))/2
    rings=[e for e in ents if e.get('type')=='polyline' and e.get('closed') and e.get('parcelRole')=='site' and (e.get('attributes') or {}).get('ring')!='hole' and len(e.get('points') or [])>=3]
    if rings:return _apartment_points(max(rings,key=lambda e:area(e['points']))['points'],'대지'),'대지'
    raise ValueError('가두리를 찾지 못했습니다. 지번으로 대지를 가져오거나, 닫힌 PL 하나를 선택하거나 "가두리" 레이어에 그리거나, boundary 로 점(mm)을 주세요.')


def _apartment_trim(value,detail=False):
    """AI에게는 표·숫자만: 그릴 객체(draw)는 개수로, 엔진 내부 모양(engine·좌표)은 조각 요약으로 줄인다."""
    if isinstance(value,list):return [_apartment_trim(v,detail) for v in value]
    if not isinstance(value,dict):return value
    out={}
    for key,item in value.items():
        if key=='draw' and isinstance(item,list):out['draw_count']=len(item)
        elif key=='engine' and isinstance(item,dict):out['engine_parts']=[{k:p.get(k) for k in ('zone','area_m2','far','bcr')} for p in item.get('parts') or []]
        elif key in ('site_mm','contours','frame','poly'):continue
        elif key=='sheets' and not detail and isinstance(item,list):out['sheets']=[s.get('title') for s in item if isinstance(s,dict)]
        else:out[key]=_apartment_trim(item,detail)
    return out


def _apartment_review(args):
    import apartment_service
    action=args.get('action')
    if action not in APARTMENT_ACTIONS:raise ValueError('action 은 '+'·'.join(APARTMENT_ACTIONS)+' 중 하나입니다.')
    detail=args.get('detail',False)
    if type(detail) is not bool:raise ValueError('detail 은 true/false 입니다.')
    if action=='review_job':
        job_id=str(args.get('job_id') or '')
        with _apartment_lock:job=copy.deepcopy(_apartment_jobs.get(job_id))
        if job is None:raise ValueError('이 작업 번호를 모릅니다. 바른 CAD를 다시 켰으면 action=review 부터 다시 실행하세요.')
        state=apartment_service.process({'action':'review_job','jobId':job_id,'where':job['where'],'have':job['have'],'engine':job['engine'],'textH':job['textH'],'northVec':job['northVec']})
        with _apartment_lock:
            kept=_apartment_jobs.get(job_id)
            if kept is not None and state.get('place'):kept.update(place=state['place'],have=state.get('plans_n') or 0)
            place=copy.deepcopy(kept.get('place')) if kept else None
        if place is not None:state['place']=place
        return _apartment_trim(state,detail)
    options=args.get('options') or {}
    if not isinstance(options,dict) or set(options)-set(APARTMENT_OPTIONS):raise ValueError('options 에 쓸 수 있는 값: '+', '.join(APARTMENT_OPTIONS))
    current=snapshot(args.get('editor_session'));document=current.get('document') or {}
    data={**copy.deepcopy(options),'action':action,'entities':document.get('entities') or [],'layers':document.get('layers') or []}
    source=None
    if action in ('enclose','incentive_table','review'):data['pl'],source=_apartment_boundary(document,current.get('selected'),args)
    if action=='review':
        if args.get('review') not in ('quick','precise'):raise ValueError('review 는 quick(빠른 검토)·precise(정밀 검토) 중 하나입니다.')
        data['review']=args['review']
    result=apartment_service.process(data)
    if action=='review':
        enc=result.get('enclose') or {}
        with _apartment_lock:
            while len(_apartment_jobs)>=APARTMENT_JOB_LIMIT:_apartment_jobs.pop(next(iter(_apartment_jobs)))
            _apartment_jobs[result['job_id']]={'where':result.get('where'),'engine':enc.get('engine'),'textH':enc.get('text_h'),'northVec':result.get('north_vec'),'have':0,'place':None}
        result={**result,'next':'cad_apartment_review action=review_job, job_id 로 끝날 때까지 몇 초 간격으로 조회하세요. 같은 검토를 다시 접수하지 마세요.'}
    out=_apartment_trim(result,detail)
    if source:out['boundary_source']=source
    return out


def object_schema(properties=None,required=None):return {'type':'object','properties':properties or {},'required':required or [],'additionalProperties':False}
PLAN_SITE_SCHEMA={'type':'object','properties':{
    'id':{'type':'string'},'address':{'type':'string'},'crs':{'type':'string','enum':['EPSG:5187','EPSG:5179','local']},
    'units':{'type':'string','enum':['m','mm'],'description':'투영 좌표는 m, CRS 없는 도면 좌표는 mm'},
    'parcel':{'type':'array','minItems':3,'items':{'oneOf':[{'type':'array','items':{'type':'number'},'minItems':2,'maxItems':2},object_schema({'x':{'type':'number'},'y':{'type':'number'}},['x','y'])]}},
    'neighbors':{'type':'array','description':'인접 필지·도로 외곽. 예: [{"jimok":"도","coords":[[x,y],...]}]. coords는 대지와 같은 좌표계·단위의 다각형(3점 이상).','items':{'type':'object','properties':{'pnu':{'type':'string'},'jimok':{'type':'string','description':'도로는 도, 대지는 대'},'coords':{'type':'array','minItems':3,'items':{'type':'array','items':{'type':'number'},'minItems':2,'maxItems':2}}},'required':['jimok','coords'],'additionalProperties':True}}},'additionalProperties':True}
PLAN_ZONING_SCHEMA={'type':'object','properties':{'zone':{'type':'string'},'bcr':{'type':['number','null']},'far':{'type':['number','null']}},'additionalProperties':True}
PLAN_PROGRAM_SCHEMA={'type':'object','properties':{'use':{'type':'string'},'floors':{'type':'integer','minimum':1,'maximum':100},'floor_h':{'type':'number','exclusiveMinimum':0},'parking':{'type':'object'},'units':object_schema({'count':{'type':'integer','minimum':1,'maximum':500},'exclusive_area_m2':{'type':'number','exclusiveMinimum':0,'description':'전 세대 동일 전용면적 ㎡'},'exclusive_areas_m2':{'type':'array','minItems':1,'maxItems':500,'items':{'type':'number','exclusiveMinimum':0},'description':'세대별 전용면적 ㎡ 목록(개수=세대수)'},'type':{'type':'string'}})},'additionalProperties':True}
PLAN_INPUT_SCHEMA=object_schema({'site':PLAN_SITE_SCHEMA,'zoning':PLAN_ZONING_SCHEMA,'program':PLAN_PROGRAM_SCHEMA,'output':{'type':'object'},'overrides':{'type':'object'},'address':{'type':'string'},'pnu':{'type':'string','pattern':r'^\d{19}$'}})
LAYOUT_ARGUMENTS={'request':PLAN_INPUT_SCHEMA,'editor_session':{'type':'string','format':'uuid'},'address':{'type':'string'},'pnu':{'type':'string','pattern':r'^\d{19}$'},'enrich':{'type':'boolean','default':True},'zoning':PLAN_ZONING_SCHEMA,'program':PLAN_PROGRAM_SCHEMA}
OPENING_PROPOSAL_SCHEMA=object_schema({
    'room':{'type':'string'},'kind':{'type':'string','enum':['DOOR','WINDOW']},'wallId':{'type':'string'},
    'offset':{'type':'number','minimum':0},'width':{'type':'number','exclusiveMinimum':0},
    'height':{'type':'number','exclusiveMinimum':0},'sill':{'type':'number','minimum':0},
    'style':{'type':'string'},'openableRatio':{'type':'number','minimum':0,'maximum':1},
    'reason':{'type':'string'},'law':{'type':'object'}},['room','kind','wallId','offset','width','height','sill'])
AI_LAYER_PROPERTIES={
    'layer':{'type':'string','minLength':1,'maxLength':200,'description':'신규 객체의 기본 레이어: 표준 A- 이름·한글 용도 또는 기존 레이어 ID/이름. 없는 표준은 표준 속성으로 생성. 명시적 객체 layer/DXF 8은 보존'},
    'purpose':{'type':'string','minLength':1,'maxLength':200,'description':'layer 대안: wall/door/window/stair/column/room/dimension/text 또는 벽체/문/창호/계단/기둥/실/치수 등. cad_get_layer_usage 참조'}
}
# 리습 먼저(library_first.py): 라이브러리 명령을 써 봤는데 이 모양을 못 그릴 때만 붙인다.
_LIBRARY_CHECK_ITEM={'type':'object','properties':{'command':{'type':'string','description':'써 본 라이브러리 명령 이름(예: WALDRAW)'},'reason':{'type':'string','minLength':4,'maxLength':500,'description':'그 명령으로 안 되는 이유'}},'required':['command','reason'],'additionalProperties':False}
GENERATOR_CHECK_SCHEMA={'generator_check':{'type':'object','properties':{'reason':{'type':'string','minLength':1,'maxLength':1000}},'required':['reason'],'additionalProperties':False,
    'description':'새 도면 WALDRAW/WAL은 code=generator_first로 거절합니다. 설계 JSON → cad_generate_drawing(kind=plan)을 먼저 쓰세요. 사용자가 정말 손으로 벽을 그리라고 요청한 경우만 {reason: 사용자 요청 이유}로 통과합니다.'}}
LIBRARY_CHECK_SCHEMA={'library_check':{'anyOf':[_LIBRARY_CHECK_ITEM,{'type':'array','items':_LIBRARY_CHECK_ITEM,'minItems':1,'maxItems':20}],
    'description':'리습 먼저 거절(code=library_first)을 받은 뒤에만: 알려 준 명령을 cad_describe_command/cad_run_command·cad_lisp_run 으로 써 보고도 못 그릴 때 {command, reason}. 써 본 기록이 없으면 통과하지 않습니다.'}}
LISP_PROPERTIES={
    **copy.deepcopy(AI_LAYER_PROPERTIES),
    'command':{'type':'string','description':'c: 접두어 없는 등록 리습 명령 이름'},
    'selection':{'type':'array','items':{'type':'string'},'description':'사전 선택 객체 ID. 생략하면 cad_select의 현재 선택'},
    'inputs':{'type':'array','maxItems':1000,'items':{},'description':'질문 순서대로 문자열·숫자·점 [x,y] 또는 [x,y,z]. 예: [[100,200],50]'},
    'timeout_ms':{'type':'integer','minimum':100,'maximum':10000,'default':5000},
    'expectedRevision':{'type':'integer','minimum':0}
}
PLAN_OPTIONS_SCHEMA=object_schema({
    'boxIds':{'type':'array','minItems':1,'items':{'type':'string'},'description':'아래층부터 닫힌 PL/사각형 ID. 없으면 사무소 시트 또는 전체 평면'},
    'floors':{'type':'array','items':object_schema({'name':{'type':'string'},'height':{'type':'number','exclusiveMinimum':0}})},
    **{k:{'type':'number','exclusiveMinimum':0} for k in ('floorHeight','windowHeight','doorHeight','slab')},
    'sill':{'type':'number','minimum':0},
    'roofBox':{'type':'string','enum':['auto','yes','no']},
    'align':{'type':'string','enum':['walls','box']},
    'structure':{'type':'string','enum':['rc','masonry','steel']},
    'insulation':{'type':'string','enum':['exterior','interior']},
    'region':{'type':'string','enum':['중부1','중부2','남부','제주']}
})

SCRIPT_POINT_SCHEMA={'anyOf':[{'type':'array','minItems':2,'maxItems':3,'items':{'type':'number'}},object_schema({'x':{'type':'number'},'y':{'type':'number'}},['x','y'])]}
COMMAND_INPUTS_SCHEMA=object_schema({
    'form':{'anyOf':[{'type':'object'},{'type':'array','items':{'type':'object'}}],'description':"입력은 질문 순서의 큐이며 길이는 mm입니다. WALDRAW/WAL: form={slot:2,method:points,lines:[{d:100,layer:A-WALL-CONC},{d:-100,layer:A-WALL-CONC}],byLayer:true,explode:false,fixedLayers:A-GRID}. slot은 0부터, lines 생략 시 저장 프리셋. points 방식은 paths=[{points:[[0,0],[6000,0],[6000,4000]],closed:true}]. center 방식은 entities=[중심선ID,null], points=[[실외x,실외y]]. drag는 네 점(같은 벽면 두 점,반대 벽면,옮길 위치); 완성된 묶음 뒤 큐 종료나 null로 마침. D1/W1: form.width는 공칭 문·창 폭, points는 같은 벽 한 면의 두 점과 반대 면의 한 점(중심선이 아닌 양면). PLANSET: selection에 층별 닫힌 박스 ID, form={occt:no,details:none,scale:1/100}; 생략하면 현재 평면 인식. 추가 입력은 cad_describe_command에서 확인."},
    'points':{'type':'array','items':{'anyOf':[*SCRIPT_POINT_SCHEMA['anyOf'],{'type':'null'},object_schema({'option':{'type':'string'}},['option'])]},'description':'점 큐(mm). null은 Esc/Enter로 반복 종료'},
    'paths':{'type':'array','items':{'anyOf':[{'type':'array','items':SCRIPT_POINT_SCHEMA},object_schema({'points':{'type':'array','minItems':2,'items':SCRIPT_POINT_SCHEMA},'closed':{'type':'boolean'}},['points']),{'type':'null'}]},'description':'경로 큐. closed:true로 닫힌 외벽'},
    'entities':{'type':'array','items':{'anyOf':[{'type':'string'},{'type':'null'},object_schema({'id':{'type':'string'},'point':SCRIPT_POINT_SCHEMA},['id']),object_schema({'option':{'type':'string'}},['option'])]},'description':'객체 선택 큐. null로 반복 종료'},
    'numbers':{'type':'array','items':{'type':'number'}},'selection':{'type':'array','items':{'type':'string'}},
    'slot':{'type':'integer','minimum':0},'method':{'type':'string'},'shared':{'type':'object'}
})

FIELD_RECORD_TOOLS=frozenset(('cad_field_records_list','cad_field_records_get','cad_field_records_update','cad_field_records_locate'))

# 기준 세 가지(사용자 2026-10-25 "고치기 전 기준 3개 읽기"): 도면 기준·규칙집은 보호 자산(설치판은 로그인 뒤 열림), 결정 기록은 소스 docs 에만 있다.
DECISIONS_DOC=Path(__file__).resolve().parent/'docs'/'도면기준-결정기록.md'
def drawing_standard_bundle(args):
    import vault_gate
    parts=args.get('parts') or ['standard','rulebook','decisions']
    out={'read_order':'도면 기준 → 규칙집 → 결정 기록. 결정 기록의 최신 줄이 기준보다 앞선다(그 줄이 기준 파일에 아직 안 들어갔으면 사용자에게 알린다).'}
    for part,name in (('standard','drawing-standard.json'),('rulebook','drawing-rulebook.json')):
        if part not in parts:continue
        try:data=json.loads(vault_gate.knowledge(name))
        except (ValueError,KeyError,OSError) as error:out[part]={'error':str(error) or name+' 없음'};continue
        if part=='standard' and args.get('keys'):data={k:data[k] for k in args['keys'] if k in data}
        if part=='rulebook' and args.get('at'):data={**data,'items':[i for i in data.get('items',[]) if isinstance(i,dict) and i.get('at') in args['at']]}
        out[part]=data
    if 'decisions' in parts:
        try:out['decisions']=DECISIONS_DOC.read_text(encoding='utf-8')
        except OSError:
            # 설치판은 docs 가 없다 — 작도 기준처럼 서버에서 받은 사본(drawing-decisions.json)을 읽는다(2026-10-30)
            import vault_gate
            try:out['decisions']=json.loads(vault_gate.knowledge('drawing-decisions.json').decode('utf-8'))['text']
            except (ValueError,KeyError,OSError):out['decisions']={'error':'결정 기록을 서버에서 받지 못했습니다(로그인·서버 판 확인).'}
    return out

TOOLS=[
 {'name':'cad_insert_image','description':'Insert a JPG, PNG, or BMP photo as a proportional underlay. path is a local absolute path; position is the lower-left drawing point in mm. Use width or pxToMm, and optional align for two-point alignment. One undo step.','inputSchema':object_schema({'path':{'type':'string'},'position':object_schema({'x':{'type':'number'},'y':{'type':'number'}},['x','y']),'width':{'type':'number','exclusiveMinimum':0},'pxToMm':{'type':'number','exclusiveMinimum':0},'rotation':{'type':'number','default':0},'fade':{'type':'number','minimum':0,'maximum':90,'default':50},'align':object_schema({'imagePoints':{'type':'array','minItems':2,'maxItems':2,'items':{'type':'array','minItems':2,'maxItems':2,'items':{'type':'number'}}},'drawingPoints':{'type':'array','minItems':2,'maxItems':2,'items':{'type':'array','minItems':2,'maxItems':2,'items':{'type':'number'}}}},['imagePoints','drawingPoints'])},['path','position'])},
 {'name':'cad_get_drawing_standard','description':'도면 품질 판단·수정 전 필수: 우리 기준 세 가지 — 도면 기준(drawing-standard.json, 한 벌 템플릿 sheetTemplates 포함), 규칙집(drawing-rulebook.json), 결정 기록(도면기준-결정기록.md) — 을 읽습니다. parts 로 일부만, keys 로 도면 기준의 항목(예 sheetTemplates·details·grid·tags·elevation)만, at 으로 규칙집의 도면 종류(예 elevation·schedule)만 고를 수 있습니다. 읽기 전용.','inputSchema':object_schema({'parts':{'type':'array','items':{'enum':['standard','rulebook','decisions']}},'keys':{'type':'array','items':{'type':'string'}},'at':{'type':'array','items':{'type':'string'}}})},
 {'name':'cad_get_layer_usage','description':'건축 요소를 그리기 전 필수: rules/knowledge/layer-usage.json의 용도별 표준 레이어와 명령→리습→기본도형 선택 규칙을 읽습니다. 다음 cad_list_commands/cad_get_command로 카드·command-runner 건축 명령을 먼저 찾으세요. 읽기 전용.','inputSchema':object_schema()},
 {'name':'cad_search_units','description':'독립 단위세대를 전용면적·베이·방 수·욕실 수·코어 방식으로 검색합니다.','inputSchema':object_schema({'query':{'type':'string'},'area_min':{'type':'number','minimum':0},'area_max':{'type':'number','minimum':0},'bays':{'type':'number','minimum':0},'rooms':{'type':'integer','minimum':0},'bathrooms':{'type':'integer','minimum':0},'core_form':{'type':'string'},**PAGE_SCHEMA})},
 {'name':'cad_get_unit','description':'단위세대 메타데이터와 검증된 실제 mm 기하를 읽습니다.','inputSchema':object_schema({'id':{'type':'string'},'include_geometry':{'type':'boolean'}},['id'])},
 {'name':'cad_insert_unit','description':'독립 단위세대를 실제 mm 크기 블록 하나로 삽입합니다. mirror는 원점의 Y축 대칭 후 rotation 반시계 도 회전입니다. 실행 취소 한 단계.','inputSchema':object_schema({'id':{'type':'string'},'position':object_schema({'x':{'type':'number'},'y':{'type':'number'}},['x','y']),'rotation':{'type':'number','default':0},'mirror':{'type':'boolean','default':False}},['id','position'])},
 {'name':'cad_search_jutong','description':'주동 라이브러리를 세대 조합·형태·층당 세대수·세대 타입·실제 mm 크기로 검색합니다. 확인 필요 정보도 함께 반환합니다.','inputSchema':object_schema({'query':{'type':'string'},'combination':{'type':'string'},'form':{'type':'string'},'units_per_floor':{'type':'integer','minimum':1},'unit_type':{'type':'string'},**{k:{'type':'number','minimum':0} for k in ('min_width_mm','max_width_mm','min_depth_mm','max_depth_mm')},**PAGE_SCHEMA})},
 {'name':'cad_get_jutong','description':'주동 메타데이터와 선택적인 실제 mm 기하를 읽습니다.','inputSchema':object_schema({'id':{'type':'string'},'include_geometry':{'type':'boolean'}},['id'])},
 {'name':'cad_insert_jutong','description':'주동을 실제 크기 블록 하나로 삽입합니다. position은 동 윤곽 원점 mm, rotation은 반시계 도. 실행 취소 한 단계.','inputSchema':object_schema({'id':{'type':'string'},'position':object_schema({'x':{'type':'number'},'y':{'type':'number'}},['x','y']),'rotation':{'type':'number','default':0}},['id','position'])},
 {'name':'cad_suggest_openings','description':'A-AREA 또는 A-AREA-용도 레이어의 닫힌 실 영역과 벽에서 창·문을 제안합니다. rooms는 실 도형 ID·실 이름·용도 코드. 일반 A-WALL 선분도 인식하며 부족한 정보는 needs로 안내. north는 +X 반시계 각도, 생략 시 도면 정북. 길이 mm, 면적 m². 도면 불변.','inputSchema':object_schema({'rooms':{'type':'array','items':{'type':'string'}},'north':{'type':'number','description':'생략 시 도면 정북 사용'},'editor_session':{'type':'string','format':'uuid'}})},
 {'name':'cad_electrical_layout','description':'조명·스위치·콘센트·화재감지기 배치 미리 계산(읽기만, 도면 안 바꿈): 층 평면의 실마다 조명 개수(광속법 N=E·A/(Φ·U·M), 이용률은 실지수로 보간)·스위치(문 손잡이 쪽)·콘센트(실제 벽면만, 용도별 간격, 물기 있는 곳 방수형)·감지기(법정 기준 근거 basis)와 기구 집계표. unresolved 는 사용자에게 확인. 결과는 초안이며 법령 판정은 설계엔진 몫 — include_engine_input=true 면 엔진 검토 요청(barun.electrical-review-request/0.1, building={use,region,grossFloorArea,storeys,fireResistive,ceilingHeight})을 함께 준다. 자동 가구 콘센트는 A-POWR-FURN 레이어(끌 수 있음). 도면에 그리려면 cad_run_command name=ELECLAYOUT.','inputSchema':object_schema({'occupancy':{'type':'string','enum':['housing','neighborhood']},'autoFurnish':{'type':'boolean'},'include_engine_input':{'type':'boolean'},'building':{'type':'object'},'editor_session':{'type':'string','format':'uuid'}})},
 {'name':'cad_read_foreign_plan','description':'남의 도면 읽기(읽기만, 도면 안 바꿈): 다른 사무소 층 평면 DXF(도곽마다 한 층, 층별 파일)에서 벽 중심선(사선 포함)·창·문·실 다각형·계단·바닥 윤곽을 읽어 층별 바닥면적(벽 중심선, 외단열은 내력벽 중심선)과 실 목록을 돌려줍니다. 벽 레이어는 후보를 실제 추출해 고릅니다(wallLayer 로 지정 가능). 그림·스캔·남의 도면은 치수선 숫자만으로 좌표를 만들며, 생성 전 문·창·벽 근거 치수표를 사용자에게 보여 주고 ?인 항목을 쉬운 말로 확인한 뒤 생성합니다. 결과 JSON의 evidence가 비어 있으면 checklist에 근거 없음으로 안내합니다. unresolved 는 사람이 확인할 것. floors[].checks 의 실 밖 열린 공간(바깥 발코니·테라스 후보)은 바닥면적에 넣은 채라, 원본 개요 면적과 비교해 스스로 판단해 그 둘레 벽을 난간(role railing 또는 height 1500 이하)으로 그려 빼고 가정으로 알린다(묻지 않는다). include_geometry=true 면 좌표(mm)까지. 도면에 우리 레이어로 그리려면 cad_run_command name=FOREIGNREAD.','inputSchema':object_schema({'wallLayer':{'type':'string','maxLength':200},'fileName':{'type':'string','maxLength':400},'include_geometry':{'type':'boolean'},'editor_session':{'type':'string','format':'uuid'}})},
 {'name':'cad_check_daylight','description':'도면의 실별 현재 외벽 창으로 채광·환기 면적을 검사합니다(일조 시간·정북 일조사선 법적 판정과 별개). A-AREA/실 이름·일반 벽·창 레이어를 인식. 대지·높이·정북을 자동 읽고 부족한 값과 일조 후속 도구를 안내. ±3% 계획 허용오차, 면적 m².','inputSchema':object_schema({'rooms':{'type':'array','items':{'type':'string'}},'north':{'type':'number'},'editor_session':{'type':'string','format':'uuid'}})},
 {'name':'cad_apply_openings','description':'cad_suggest_openings의 proposals 전부 또는 일부를 target 벽에 적용합니다. 길이·offset mm. 하나라도 실패하면 도면 불변, 실행 취소 한 단계.','inputSchema':object_schema({'proposals':{'type':'array','minItems':1,'items':OPENING_PROPOSAL_SCHEMA},'expectedRevision':{'type':'integer','minimum':0}},['proposals','expectedRevision'])},
 {'name':'cad_place_from_site_plan','description':'남의 배치도로 설계를 실제 대지에 앉히기(읽기만, 도면 안 바꿈): 원본 배치도(PDF·DXF)의 대지선을 지적 대지(현재 도면의 가져온 대지, 또는 site [[x,y],…] mm)에 돌림·옮김으로 겹치고, 그 위 건물 윤곽에 설계 1층 바깥 벽 고리를 겹쳐 지적 대지를 설계 좌표(model.site.parcel)로 돌려줍니다. 설계는 setId(이 도면의 AI 도면 묶음) 또는 model. 결과: parcel·modelSite(설계 좌표 mm 의 model.site 그대로: parcel·northAngle·ledgerAreaM2(건축물대장 대지면적)·jibun·zone(용도지역)·roads[{coords,width(mm),name}]·neighbors[{coords,jibun}] — 도면의 지적 도로·이웃 필지에서)·rotationDeg·north(설계 좌표 북쪽)·fit(대지·건물 IoU)·setbacks(대지 각 변까지 거리 m)·next. 대지 기준 모서리·이격 거리를 사용자에게 묻기 전에 먼저 부르세요. needs 가 있으면(겹침 85% 미만) 그 질문을 쉬운 말로 묻습니다. Place a design on the real cadastral site from the original site plan; read-only.','inputSchema':object_schema({'sitePlanPath':{'type':'string','maxLength':1000},'setId':{'type':'string'},'model':{'type':'object'},'site':{'type':'array','items':{'type':'array','items':{'type':'number'},'minItems':2,'maxItems':2},'minItems':3,'maxItems':2000},'editor_session':{'type':'string','format':'uuid'}},['sitePlanPath'])},
 {'name':'cad_site_plan_from_drawing','description':'현재 도면 A-SITE(별칭 A-SITE-BND/A-SITE-BNDY)의 닫힌 폴리선·사각형 또는 주소·직전 필지 조회 결과로 EPSG:5187 배치 입력을 자동 만듭니다. 주소/PNU로 토지정보를 조회하고 모르는 값만 needs로 묻습니다. 인접 도로는 request.site.neighbors=[{jimok:"도",coords:[[x,y],...]}](대지와 같은 단위·좌표계, 3점 이상). 도면 불변.','inputSchema':object_schema(copy.deepcopy(LAYOUT_ARGUMENTS))},
 {'name':'cad_apartment_review','description':'아파트 검토(화면 [아파트 검토]와 같은 계산)를 현재 도면으로 실행합니다. 먼저 지번으로 대지를 가져와야 합니다. action: zones=필지·용도지역 면적과 국토계획법 84조 구역 판정, zone_suggest=한 필지에 지역이 둘일 때 나누기 제안, enclose=가두리 안 필지를 대지로 묶고 용도지역 조각별 필지 검토, incentive_table=인센티브 표(빼기·등급 고르기 반영 목표 용적률), review=빠른(quick)·정밀(precise) 배치 검토 접수(review 필요, job_id 돌려줌), review_job=job_id 로 진행·결과 조회. 전체 검토 순서: enclose → incentive_table → review → review_job(배치 계산은 늘 배치 엔진 서버). 가두리: boundary(mm 점) → 선택한 닫힌 PL 하나 → "가두리" 레이어 닫힌 PL 하나 → 가져온 대지 바깥 경계 순서로 찾습니다(boundary_source). review·incentive_table 은 바른 계정 로그인이 필요할 수 있습니다. 결과는 표(table)·숫자이며 그릴 객체는 draw_count 로만 알려 줍니다. 도면 불변 — 도면에 그리려면 사용자에게 화면 [아파트 검토]를 쓰게 하세요.','inputSchema':object_schema({
    'action':{'type':'string','enum':list(APARTMENT_ACTIONS)},'editor_session':{'type':'string','format':'uuid'},
    'boundary':{'type':'array','minItems':3,'items':{'type':'array','items':{'type':'number'},'minItems':2,'maxItems':2},'description':'가두리 점 [x,y] mm(도면 좌표). 생략하면 도면에서 찾음'},
    'review':{'type':'string','enum':['quick','precise']},'job_id':{'type':'string','pattern':'^[a-f0-9]{32}$'},
    'options':object_schema(copy.deepcopy(APARTMENT_OPTIONS)),'detail':{'type':'boolean','default':False,'description':'검토서(sheets) 본문까지'}},['action'])},
 {'name':'cad_suggest_layout','description':'도면·주소만으로 대지·용도지역·프로그램을 자동 채워 서버 배치안을 요청합니다(하루 한도 차감). request 생략 가능. 아파트는 program.units={count:세대수,exclusive_area_m2:전용㎡} 또는 exclusive_areas_m2 목록. 인접 도로는 request.site.neighbors=[{jimok:"도",coords:[[x,y],...]}](대지와 같은 단위·좌표계, 3점 이상). needs면 첫 질문만 묻고 재호출. layout_id는 최대 16개·30분 보관. running은 cad_get_job으로 조회.','inputSchema':object_schema(copy.deepcopy(LAYOUT_ARGUMENTS))},
 {'name':'cad_validate_layout','description':'AI 설계 엔진으로 정북 일조·건폐율·용적률 등 배치 법규 검사(일조 검토는 늘 이것으로): 한 벌(kind=set)을 그렸으면 인자 없이 부르세요 — 그린 설계(model.site.parcel)를 도면의 지적 대지에 자동으로 앉혀 층마다 바깥 외곽을 넘깁니다(대지 위에 외곽을 따로 그리지 말고, 사용자에게 경계를 고르게 하지 말 것). 결과 sunlight.by_floor 는 층마다 정북 이격 기준, ‘n층 건축가능영역 내’ 가 그 층 정북 일조·이격 적합 여부입니다. ‘옥탑(계단실 3m)’·‘코어 배치’·‘목표’·‘대표 규칙’ 줄은 엔진의 설계 목표·옥탑 자리 시험(3×6 상자 가정)이라 법규 위반이 아닙니다 — 그린 설계에 옥탑이 없으면 그렇게 구분해 알리세요. layout_id의 서버 배치 다각형 또는 현재 도면의 대지·A-BLDG-L1 건물 외곽을 자동으로 채워 재검증합니다. request 생략 가능. 도면에서 못 읽은 값은 needs로 안내. layout_id와 request 동시 지정 금지. 인접 도로는 request.site.neighbors=[{jimok:"도",coords:[[x,y],...]}](대지와 같은 단위·좌표계, 3점 이상). 도면 불변.','inputSchema':object_schema({**copy.deepcopy(LAYOUT_ARGUMENTS),'layout_id':{'type':'string','format':'uuid'},'overrides':{'type':'object'}})},
 {'name':'cad_insert_layout','description':'캐시의 배치안을 target 도면에 넣습니다. offset은 배치 원점의 도면 좌표(mm), 생략하면 도면 오른쪽에 둡니다. 실행 취소 한 단계. 넣은 뒤 다음 편집 전 cad_get_document로 target을 다시 읽으세요.','inputSchema':object_schema({'layout_id':{'type':'string','format':'uuid'},'offset':object_schema({'x':{'type':'number'},'y':{'type':'number'}},['x','y']),'title':{'type':'string'}},['layout_id'])},
 {'name':'cad_search_classified_drawings','description':'Search the fully normalized residential corpus by building type and reuse capability. Room counts are sheet-level, not per dwelling. Relative geometry does not confirm physical scale. Read-only.','inputSchema':object_schema({'building_type':{'type':'string','enum':['','APT','MULTI','DETACHED']},'usage':{'type':'string','enum':['all','relative_space_geometry','physical_geometry','unit_extraction']},'doc_type':{'type':'string'},'bedrooms':{'type':'integer'},'baths':{'type':'integer'},'limit':{'type':'integer'},'offset':{'type':'integer'}})},
 {'name':'cad_get_classified_drawing','description':'Read a normalized drawing by group ID or original source ID, including all source links, scale status and review requirements. Optional geometry remains in declared units. Read-only.','inputSchema':object_schema({'id':{'type':'string'},'include_geometry':{'type':'boolean'}},['id'])},
 {'name':'cad_suggest_details','description':'현재 도면 문맥에 맞는 상세를 제안합니다.','inputSchema':object_schema({'context':{'type':'object'}})},
 {'name':'cad_search_details','description':'상세 모음에서 LH·LA·철골 상세·주동(조합)·단위세대(면적대)를 검색합니다. 라이브러리가 없으면 정상적으로 unavailable을 반환합니다.','inputSchema':object_schema({'query':{'type':'string'},'source':{'type':'string','enum':['lh2025','lh2017','la','steel','library']},'classification':{'type':'string'},'facility':{'type':'string'},'combination':{'type':'string'},'form':{'type':'string'},'units_per_floor':{'type':'integer','minimum':1},'unit_type':{'type':'string'},**{k:{'type':'number','minimum':0} for k in ('min_width_mm','max_width_mm','min_depth_mm','max_depth_mm','area_min','area_max','bays')},'rooms':{'type':'integer','minimum':0},'bathrooms':{'type':'integer','minimum':0},'core_form':{'type':'string'}})},
 {'name':'cad_get_detail','description':'상세 모음 한 항목의 메타데이터와 선택적 DOCUMENT 기하를 읽습니다.','inputSchema':object_schema({'id':{'type':'string'},'source':{'type':'string','enum':['lh2025','lh2017','la','steel','library']},'include_geometry':{'type':'boolean'}},['id'])},
 {'name':'cad_insert_detail','description':'상세·주동·단위세대·철골 상세를 블록 하나로 삽입합니다. 주동·단위세대는 실제 mm 크기만 허용합니다. rotation은 주동·단위세대, mirror는 단위세대에 적용합니다. 한 번의 실행 취소로 되돌릴 수 있습니다.','inputSchema':object_schema({'id':{'type':'string'},'source':{'type':'string','enum':['lh2025','lh2017','la','steel','library']},'position':object_schema({'x':{'type':'number'},'y':{'type':'number'}},['x','y']),'scale':{'type':'number','exclusiveMinimum':0},'rotation':{'type':'number','default':0},'mirror':{'type':'boolean','default':False},'expectedRevision':{'type':'integer'},'bounds':object_schema({k:{'type':'number'} for k in ('minX','minY','maxX','maxY')},['minX','minY','maxX','maxY'])},['id'])},
 {'name':'cad_get_drawing_knowledge','description':'Read all compiled drawing observations and evidence gates, optionally filter by exact class names. Dataset frequencies are advisory, never mandatory design standards.','inputSchema':object_schema({'classes':{'type':'array','items':{'type':'string'}}})},
 {'name':'cad_evaluate_drawing_evidence','description':'Evaluate drawing evidence readiness with versioned schema rules. Supply only independently verified boolean facts; omit missing evidence. Does not grant design or legal approval. Read-only.','inputSchema':object_schema({'facts':{'type':'object','additionalProperties':False,'properties':{k:{'type':['boolean','null']} for k in ('scaleVerified','dwellingBoundaryVerified','doorConnectivityVerified','siteLegalRulesVerified','structuralReviewVerified','sourcePreserved','annotationQualityVerified')}}},['facts'])},
 {'name':'cad_search_design_cases','description':'Search local original design references by Korean request, housing APT/DEH/ROW, and task SPA/STR/OBJ/OCR. Sheet-level counts only, not verified dwelling counts. Read-only.','inputSchema':object_schema({'query':{'type':'string'},'housing':{'type':'string'},'task':{'type':'string'},'limit':{'type':'integer'}},['query'])},
 {'name':'cad_get_design_case','description':'Read measured annotation patterns and provenance of an exact design case ID. Proximity is not door connectivity; pixel area is not square metres. Read-only.','inputSchema':object_schema({'id':{'type':'string'}},['id'])},
 {'name':'cad_design_reference','description':'Build an unchanged reference drawing with a USER-VERIFIED mmPerPixel. Never guess scale. Does not edit CAD. Use design.import with reference:true in preview/execute to append it, preserving current drawing.','inputSchema':object_schema({'id':{'type':'string'},'mmPerPixel':{'type':'number'}},['id','mmPerPixel'])},
 {'name':'cad_search_address','description':'Search Korean road/jibun address and return matching addresses and PNU. Read-only. Resolve ambiguous candidates before fetching a parcel.','inputSchema':object_schema({'query':{'type':'string'},'editor_session':{'type':'string','format':'uuid'}},['query'])},
 {'name':'cad_get_parcel','description':'Fetch cadastral parcel geometry and surrounding parcels for a verified PNU. Read-only; does not edit the drawing. Requires land-service login in CAD. Returns editable polylines in local mm and projection origin. When the building register lot area differs from the parcel (a lot made of several parcels), touching parcels that make up the difference are merged into one site automatically (mergedLot; original lines stay as site-original). pnus lists several parcels to load together; mergeLot=false keeps a single parcel. landInfo carries the zoning rules (zones, limits bcr/far) and sunlight (applies: 정북 일조 대상) — use them, do not ask the user.','inputSchema':object_schema({'pnu':{'type':'string'},'pnus':{'type':'array','items':{'type':'string'},'maxItems':10},'mergeLot':{'type':'boolean'},'editor_session':{'type':'string','format':'uuid'},'crs':{'type':'string','enum':['EPSG:5179','EPSG:5187']},'surroundings':{'type':'boolean'},'x':{'type':'number'},'y':{'type':'number'}},['pnu'])},
 {'name':'cad_get_document','description':'Read one editor snapshot. Omit editor_session to discover the active editor. Units mm. mode=summary returns top-level counts by layer/type, extents, block definition and selection counts. mode=window returns top-level entities whose bounds are fully inside window {x0,y0,x1,y1}. mode=selection reads current selection or ids. Partial reads default to 200 entities, limit max 1000; truncated/detailsOmitted mark omitted objects or details. Block children are never expanded. Large drawings default to summary; their target is query-only (editing unavailable). Small drawings without mode keep the full snapshot. commandSettings is omitted unless include_command_settings=true.','inputSchema':object_schema({'editor_session':{'type':'string','format':'uuid'},'include_command_settings':{'type':'boolean','default':False},'mode':{'type':'string','enum':['summary','window','selection']},'window':object_schema({k:{'type':'number'} for k in ('x0','y0','x1','y1')},['x0','y0','x1','y1']),'ids':{'type':'array','items':{'type':'string'},'maxItems':1000},'limit':{'type':'integer','minimum':1,'maximum':1000,'default':200}})},
 {'name':'cad_open_file','description':'Open an existing DXF/DWG/BCAD file, or a vector PDF drawing (first page, opened as PDF-IMPORT lines/text in paper mm — then cad_read_foreign_plan reads it by its dimension numbers), (absolute path, or the user\'s words like 문서/폴더/파일.pdf, 바탕화면/…, 다운로드/…, ~/…; a folder path returns its drawing files list to open one by one; cad_read_foreign_plan only reads an opened window, never a path) in its own Barun CAD drawing window (desktop app) and wait until it is loaded; returns its editor_session for cad_get_document and cad_close_document. A file that is already open returns that window. Automated checks must close every window they opened with cad_close_document so windows do not pile up. Do not repeat after a timeout; call again later to find the window.','inputSchema':object_schema({'path':{'type':'string'},'timeout_seconds':{'type':'number','minimum':5,'maximum':600},'editor_session':{'type':'string','format':'uuid'}},['path'])},
 {'name':'cad_close_document','description':'Close the current drawing of one editor window. Refused when that drawing has unsaved changes (save with cad_save or leave it open; never discards edits). Closing the last drawing of a desktop window closes the window and its process, releasing its memory (session_closed=true; the editor_session is then gone).','inputSchema':object_schema({'editor_session':{'type':'string','format':'uuid'}},['editor_session'])},
 {'name':'cad_observation_head','description':'Read constant-size editor observation metadata without document contents. Unavailable or stale snapshots are not evidence of completed changes. Focus does not prove human actions. Read-only.','inputSchema':object_schema({'editor_session':{'type':'string','format':'uuid'}})},
 {'name':'cad_select','description':'Select existing entity IDs in the CAD window.','inputSchema':object_schema({'ids':{'type':'array','items':{'type':'string'}}},['ids'])},
 {'name':'cad_preview','description':'Validate an engine command against a copy and return changes without modifying the drawing.','inputSchema':object_schema({'command':{'type':'object'},**copy.deepcopy(AI_LAYER_PROPERTIES)},['command'])},
 {'name':'cad_execute','description':'Execute a validated edit with undo in the active CAD drawing. Use exact entity IDs from cad_get_document. Commands: add {entity}, move/copy {ids,dx,dy}, rotate {ids,base:{x,y},angle}, delete {ids}, update {ids,changes}, batch {commands}. Entities: line {points:[{x,y},{x,y}],layer}, circle {center:{x,y},radius,layer}, text {position:{x,y},height,text,layer}, wall {points,thickness,openings:[],layer}. 객체 layer에는 기존 ID 또는 표준 A- 이름을 쓰세요. 최상위 layer/purpose는 생략된 객체 layer의 기본값입니다. 없는 표준 레이어는 같은 Undo로 만들고 현재 레이어는 바꾸지 않습니다. 리습 먼저: 바른 명령 라이브러리로 그릴 수 있는 건축 요소(벽·문·창·기둥·그리드·실 면적·주차·치수·도곽)를 add 하면 거절(code=library_first)하고 쓸 명령을 알려 줍니다. 레이어·용도 없는 새 도형도 거절합니다. 이동·복사·회전·삭제·속성 변경은 그대로 됩니다.','inputSchema':object_schema({'command':{'type':'object'},'expectedRevision':{'type':'integer'},**copy.deepcopy(AI_LAYER_PROPERTIES),**copy.deepcopy(LIBRARY_CHECK_SCHEMA)},['command','expectedRevision'])},
 {'name':'cad_undo','description':'Undo the latest CAD edit.','inputSchema':object_schema()},
 {'name':'cad_redo','description':'Redo the latest undone CAD edit. Read a fresh target after undo.','inputSchema':object_schema()},
 {'name':'cad_get_job','description':'진행 중 AI 작업을 조회합니다. running이면 같은 job_id로 완료될 때까지 기다리세요. 원래 생성/저장/열기 도구를 다시 실행하지 마세요. 완료 결과는 result에 있습니다.','inputSchema':object_schema({'job_id':{'type':'string'},'wait_seconds':{'type':'number','minimum':0,'maximum':10}},['job_id'])},
 {'name':'cad_validate','description':'Validate the current drawing model and report entity counts and bounds.','inputSchema':object_schema()},
 {'name':'cad_list_commands','description':'Search the Barun CAD command library (architecture commands and bundled AutoLISP) by Korean/English words, category, kind (command|lisp) or runner (card=call with cad_run_command, lisp, core=screen commands). Returns summaries; use cad_get_command for usage. Read-only, no drawing needed.','inputSchema':object_schema({'query':{'type':'string'},'category':{'type':'string'},'kind':{'type':'string','enum':['command','lisp']},'runner':{'type':'string','enum':['card','lisp','core']},'limit':{'type':'integer','minimum':1,'maximum':200}})},
 {'name':'cad_get_command','description':'Read how to use a Barun CAD command or bundled AutoLISP by exact name or alias: purpose, steps, form inputs, verification status and whether it may be recommended. One alias can match both a command and a lisp; show both, never auto-run by alias alone. Read-only.','inputSchema':object_schema({'name':{'type':'string'}},['name'])},
 {'name':'cad_view_drawing','description':'See the drawing as a PNG image (the AI eye), drawn like a plot on white paper. Area: window {minX,minY,maxX,maxY} in drawing mm, or ids (fit those entities), or scope=screen (what the user sees), default the whole drawing. size = long side in px (256-2048, default 1024). Map pixels back with x=minX+px*mmPerPixel, y=maxY-py*mmPerPixel. Read-only; use it to check results after cad_run_command.','inputSchema':object_schema({'window':object_schema({k:{'type':'number'} for k in ('minX','minY','maxX','maxY')},['minX','minY','maxX','maxY']),'ids':{'type':'array','items':{'type':'string'}},'scope':{'type':'string','enum':['drawing','screen']},'size':{'type':'integer','minimum':256,'maximum':2048},'colorMode':{'type':'string','enum':['auto','mono','gray','color'],'description':'Plot color: auto (default), mono = black-and-white print, gray, color'}})},
 {'name':'cad_field_records_list','description':'현장 사진 뭐 왔어? 지금 도면 또는 path 도면 옆 현장 기록함의 핀 번호·도면 좌표·제목·열림/처리됨·받은 날짜·사진 수·마지막 수정 시각을 읽습니다. status와 date_from/date_to(받은 날짜, 양끝 포함)로 거릅니다. 자세한 메모와 사진은 cad_field_records_get으로 읽으세요.','inputSchema':object_schema({'path':{'type':'string','description':'저장한 도면의 전체 경로. 생략하면 지금 도면'},'editor_session':{'type':'string','format':'uuid'},'status':{'type':'string','enum':['열림','처리됨']},'date_from':{'type':'string','format':'date'},'date_to':{'type':'string','format':'date'}})},
 {'name':'cad_field_records_get','description':'현장 기록 하나의 메모·답·수정 이력·저장된 사진 경로를 읽습니다. 목록의 pin_id 또는 pin_no로 고릅니다. 같은 번호가 여럿이면 link_id도 줍니다. include_preview=true면 photo_id(생략하면 첫 사진)의 작은 사진 한 장을 보여 줍니다.','inputSchema':object_schema({'path':{'type':'string'},'editor_session':{'type':'string','format':'uuid'},'pin_id':{'type':'string'},'pin_no':{'type':'integer','minimum':1},'link_id':{'type':'string'},'include_preview':{'type':'boolean','default':False},'photo_id':{'type':'string'}})},
 {'name':'cad_field_records_update','description':'3번 핀 처리했다고 해줘, 다시 열어줘, 답 달아줘처럼 현장 기록의 상태나 답을 장부에 더합니다. status는 처리됨/열림, reply는 남길 답입니다. 기존 내용과 수정 이력은 지우지 않습니다. 도면을 먼저 저장하고 cad_get_document에서 받은 target을 지정해야 합니다. 답은 장부에 저장하며 현장 패드 전달 여부는 delivered로 확인하세요.','inputSchema':object_schema({'path':{'type':'string'},'editor_session':{'type':'string','format':'uuid'},'pin_id':{'type':'string'},'pin_no':{'type':'integer','minimum':1},'link_id':{'type':'string'},'status':{'type':'string','enum':['열림','처리됨']},'reply':{'type':'string','minLength':1,'maxLength':8000}})},
 {'name':'cad_field_records_locate','description':'현장 핀 위치를 도면 화면에서 확대하고 번호를 강조해 보여 줍니다. pin_id 또는 pin_no로 고르며 같은 번호가 여럿이면 link_id도 줍니다. 도면은 바뀌지 않습니다. path를 주면 지금 열린 도면과 같아야 합니다.','inputSchema':object_schema({'path':{'type':'string'},'editor_session':{'type':'string','format':'uuid'},'pin_id':{'type':'string'},'pin_no':{'type':'integer','minimum':1},'link_id':{'type':'string'}})},
 {'name':'cad_get_pad_sketch','description':'현재 도면의 최근 패드 손글씨·손그림 원획 목록과 PNG를 읽습니다. 기본은 최신 그룹 그림, sketch_id로 목록의 그룹을 고릅니다. include_image=false면 목록·도면 좌표 bounds(mm)만 반환합니다. PNG는 cad_view_drawing과 같은 image/window/mmPerPixel 형식입니다. x=minX+px*mmPerPixel, y=maxY-py*mmPerPixel. 현재 도면 메모리에 최근 10개 그룹·그룹당 128획만 보관하고 지우기/연결 종료/도면 전환 때 사라집니다. 도면은 바꾸지 않습니다. AI가 뜻을 읽은 뒤 기존 cad_execute/cad_run_command로 반영하세요.','inputSchema':object_schema({'sketch_id':{'type':'string'},'include_image':{'type':'boolean','default':True},'size':{'type':'integer','minimum':256,'maximum':2048}})},
 {'name':'cad_view_3d','description':'Render the current 3D model offscreen as a PNG for the AI eye without opening the 3D window. view defaults to iso-se, size to 900, floors omitted shows all visible floors. Coordinates: drawing mm -> model metres (x, height, -y). Read-only.','inputSchema':object_schema({'setId':{'type':'string'},'view':{'type':'string','enum':['iso-ne','iso-nw','iso-se','iso-sw','top','front','back','left','right'],'default':'iso-se'},'size':{'type':'integer','minimum':256,'maximum':1600,'default':900},'floors':{'type':'array','items':{'type':'string','pattern':'^[1-9][0-9]*F$'}}})},
 {'name':'cad_push_pull','description':'설계 JSON 3D 밀고 당기기: setId 묶음의 층 높이 또는 외벽 위치를 distance mm만큼 바꾸고 평면·단면·입면을 다시 그립니다. element={type:story|wall,id}. 층 높이는 위층 elevation에 연쇄 반영, 외벽은 바깥 법선 방향. 10 mm 스냅. 손 편집 확인은 CAD 화면에서 묻습니다. 실행 취소 한 단계.','inputSchema':object_schema({'setId':{'type':'string'},'element':object_schema({'type':{'type':'string','enum':['story','wall']},'id':{'type':'string'}},['type','id']),'distance':{'type':'number'},'expectedRevision':{'type':'integer','minimum':0}},['setId','element','distance','expectedRevision'])},
 {'name':'cad_set_floor_heights','description':'Replace the per-floor 3D height table in mm, e.g. {"1F":4500,"2F":3000}. Missing floors use 3000. One undo step. Read cad_get_document again before the next edit.','inputSchema':object_schema({'floorHeights':{'type':'object','propertyNames':{'pattern':'^[1-9][0-9]*F$'},'additionalProperties':{'type':'number','exclusiveMinimum':0,'maximum':100000}},'expectedRevision':{'type':'integer','minimum':0}},['floorHeights','expectedRevision'])},
 {'name':'cad_set_model3d','description':'Merge partial 3D properties into walls, closed outlines or furniture/sanitary/kitchen blocks (bed, sofa, toilet, sink... shown as boxes in 3D and GLB) by exact IDs; door/window/stair blocks use their existing architecture editor. Furniture accepts only height/elevation/color. height/elevation/roofRise are mm, kind is solid|slab|roof, color #RRGGBB. One undo step; read cad_get_document again before the next edit.','inputSchema':object_schema({'ids':{'type':'array','items':{'type':'string'},'minItems':1},'changes':object_schema({'height':{'type':'number','exclusiveMinimum':0,'maximum':100000},'elevation':{'type':'number'},'kind':{'type':'string','enum':['solid','slab','roof']},'roofRise':{'type':'number','minimum':0},'color':{'type':'string','pattern':'^#[0-9a-fA-F]{6}$'}}), 'expectedRevision':{'type':'integer','minimum':0}},['ids','changes','expectedRevision'])},
 # 2026-10-16 AI 가 쓰는 3D·검토 도구(사용자: "기능 99%는 AI 가 쓴다", "사람은 하다 보면 방식을 까먹는다")
 {'name':'cad_energy_regions','description':'에너지절약계획서 영역(설계자가 출력처럼 [윈도우]로 고른 개요·n층 평면·입면-남/북/동/서·단면·창호 일람표)을 읽습니다. region 을 빼면 영역 목록(key·label·bounds), region(key 또는 label, 예: floor:1 / 1층 / 입면-남)을 주면 그 영역 안에 다 들어온 글자·벽(길이·두께·재료층·외기 노출)·창호(폭·높이·U값·기밀등급·SHGC)·치수·닫힌 도형 면적·블록·레이어를 줍니다. 모르는 값은 null 이며 짐작해 채우지 마세요. 그림은 결과 view.window 로 cad_view_drawing 을 부르세요. Read only.','inputSchema':object_schema({'region':{'type':'string','minLength':1,'maxLength':40,'description':'영역 key 또는 label. 빼면 목록'}})},
 {'name':'cad_extension_review','description':'증축·대수선 예비 판정. 기존(건축물대장 — cad_get_parcel)·증축·철거의 건축면적(arch)·연면적(floor) ㎡ 로 합계·건폐율·용적률을 내고, 건축법 제14조①1·3·4호·시행령 제3조의2·제11조② 로 허가/신고를 판정합니다. repairs = {bearingWall|column|beam|roofTruss|fireWall|stair|partyWall|finish: none|repair|change}. existing·siteArea·floors 를 비우면 도면 대지의 건축물대장에서 채워 autoFilled 로 알려 줍니다 — 사용자에게 묻지 말고 그것을 쓰세요(대장에도 없을 때만 묻기, 짐작 금지). permit.structural 이 true 면 구조 검토를 권하세요. 도면은 바꾸지 않습니다.','inputSchema':object_schema({'existing':{'type':'object','properties':{'arch':{'type':'number','minimum':0},'floor':{'type':'number','minimum':0}},'additionalProperties':False},'added':{'type':'object','properties':{'arch':{'type':'number','minimum':0},'floor':{'type':'number','minimum':0}},'additionalProperties':False},'removed':{'type':'object','properties':{'arch':{'type':'number','minimum':0},'floor':{'type':'number','minimum':0}},'additionalProperties':False},'siteArea':{'type':'number','minimum':0},'floors':{'type':'integer','minimum':0},'repairs':{'type':'object','additionalProperties':{'type':'string','enum':['none','repair','change']}}})},
 {'name':'cad_recognize_drawing','description':'도면 인식(실시 탭 [도면 인식] 창과 같은 결과 한 벌, 다른 사람이 그린 도면용): action=read 는 ① 개요표("건축개요" 표·도곽) → ② 배치도(대지 경계·건물 윤곽·정북) → ③ 층 평면(도곽·그림 제목으로 층마다 바닥면적·실 수·층고, 바른 서버·로그인) → ④ 검산(연속치수 합=전체치수 ±10 mm, 실 면적 합=층 면적·층 합=연면적·배치=개요 ±1%)까지 읽어 도면에 저장합니다(Ctrl+Z 되돌림). 저장된 결과만 볼 때는 cad_get_recognition. 결과 needs(확인 필요)는 값을 짐작하지 말고 하나씩 쉬운 말로 물어, 답을 action=answer 로 id·value(choices 가 있으면 그중 값, ovc: 는 mine/read, ov: 는 그 칸 값, 그 밖에는 keep)·note(이대로 두는 이유)로 넣으세요. 읽기는 누를 때만 — 사용자가 도면 인식을 부탁했을 때만 read 를 부르세요. 벽·실 좌표가 필요하면 cad_read_foreign_plan.','inputSchema':object_schema({'action':{'type':'string','enum':['read','answer']},'id':{'type':'string','maxLength':200},'value':{'type':['string','number']},'note':{'type':'string','maxLength':500}},['action'])},
 {'name':'cad_get_recognition','description':'도면 인식 결과 읽기만(도면 안 바꿈): 실시 탭 [도면 인식]이 저장한 ① 건축개요(값·근거) ② 배치(대지·건물 윤곽·정북) ③ 층 평면(층마다 바닥면적·실 수·층고) ④ 검산(ok·fail·skip) ⑤ needs(확인 필요). 아직 읽지 않았으면 readAt 이 null — 사용자가 원하면 cad_recognize_drawing action=read.','inputSchema':object_schema({})},
 {'name':'cad_energy_plan','description':'에너지절약계획서 도서(DXF·PDF)를 만듭니다. 설계자가 에너지절약계획서 창(실시 탭)에서 ⑥ 확정했으면 그 값을 그대로 씁니다. 확정 전이면(2026-10-30 대표 "필요한 건 자기가 찾아 넣어야") 묻지 말고 도구가 도면에서 빈칸을 스스로 채웁니다: 건축명·대지위치(건축개요 글자·한 벌 설계 자료), 지역(대지위치로 별표1), 층 평면 범위·층고(한 벌 평면 장·층 높이), 창호 일람표 영역(한 벌 창호도 장), 형별(기본값, [가정] 표시). 설계자가 이미 넣은 값은 덮지 않고, 채운 값은 초안으로 도면에 저장(되돌리기 됨) — 확정은 하지 않습니다. 결과 assumed 를 한 줄씩 쉬운 말로 알리고 "에너지절약계획서 창에서 보고 고친 뒤 ⑥ 확정하시면 정식 도서"라고 전하세요. 도면에서도 못 찾은 것만 needs 로 오니 그것만 물으세요. build 를 빼면 만들지 않고 채우기·빠진 것(missing)만, build=true 는 1분 안팎 — 확정 전이면 장마다 \'초안 — 설계자 확인 전\'·파일 이름 _초안(draft=true) 도서, 결과 dxf·pdf·folder·sheets 경로를 알려 주세요. autofill=false 면 채우지 않고 예전처럼 창에서 할 일(needs)만. 영역 내용은 cad_energy_regions 로 읽습니다.','inputSchema':object_schema({'build':{'type':'boolean'},'autofill':{'type':'boolean','description':'확정 전 빈칸을 도면에서 채워 초안으로(기본 true)'}})},
 {'name':'cad_get_materials','description':'List 3D material presets (id, Korean label, part kinds they fit) and the drawing\'s current per-kind materials. Call this first to map words like 적벽돌/징크/로이 유리/노출 콘크리트 to ids for cad_set_materials. Read only.','inputSchema':object_schema({})},
 {'name':'cad_set_materials','description':'Change 3D materials in one undo step. materials sets per part kind for the whole drawing (kinds: wall, slab, roof, frame, leaf=door leaf, glass, stair, solid; value = preset id from cad_get_materials, null = back to default). ids + material sets one material on exact walls/closed outlines only (null clears). Then look with cad_view_3d or cad_view_interior and keep iterating with the user.','inputSchema':object_schema({'materials':{'type':'object','additionalProperties':{'type':['string','null']}},'ids':{'type':'array','items':{'type':'string'},'minItems':1},'material':{'type':['string','null']},'expectedRevision':{'type':'integer','minimum':0}},['expectedRevision'])},
 {'name':'cad_sunlight_report','description':'일조 보고서 PDF(일조 검토서)와 캐드에서 볼 같은 내용의 도면(DXF, 쪽마다 A4)을 도면 폴더에 저장합니다(지금 도면 불변) — 다 만들면 drawingPath 를 cad_open_file 로 열어 보여 주세요. AI 설계 엔진 정북 일조(층마다 높이·필요 이격·건축가능영역 적합, 평면·A–A 단면 그림) + 3D 동지 그림자로 이웃 필지(지번)별 일조 시간 + 토지·법규 요약. 한 벌을 그린 뒤 인자 없이 부르세요 — 사용자에게 경계·지반을 묻지 마세요. 결과 path 를 알려 주세요.','inputSchema':object_schema({'editor_session':{'type':'string','format':'uuid'}})},
 {'name':'cad_sun_study','description':'Sunlight study on the 3D model (real shadows). day: winter(동지 12/22, default)|equinox(춘·추분)|summer(하지). Returns sun altitude/azimuth (azimuth relative to drawing up = grid north; site from cadastre drawingGeo or default Busan), and with grid (default true) the share of ground cells meeting 동지 09~15 연속 2시간 또는 08~16 총 4시간 plus the worst spots in drawing mm. Omitted day = 동지 and unknown site = Busan latitude are reported in assumed; tell the user in plain words. image = 3D view at time (HH:MM, default 12:00) with the sunlight grid colored (green ok, orange 2h+, red short). grid.neighbors = 이웃 필지(지번)별 동지 기준 충족 비율·가장 짧은 연속/총 일조 분(한 벌 model.site.neighbors). 건축법 정북 일조 사선은 cad_validate_layout, 보고서 PDF 는 cad_sunlight_report — never ask the user for north boundaries or ground levels.','inputSchema':object_schema({'day':{'type':'string','enum':['winter','equinox','summer']},'time':{'type':'string','pattern':'^([01]\\d|2[0-3]):[0-5]\\d$'},'grid':{'type':'boolean'},'view':{'type':'string','enum':['iso-ne','iso-nw','iso-se','iso-sw','top']},'size':{'type':'integer','minimum':256,'maximum':1600},'setId':{'type':'string'}})},
 {'name':'cad_view_interior','description':'Interior perspective PNG from a standing eye (floor + 1.5 m) at drawing point x,y (mm). Omit x,y when the user did not say where: returns needs with room-name spots (from room labels) and the building center to ask; pass the chosen value x,y,floor. floor: nF (default lowest, reported in assumed). heading degrees: 0 = drawing up (north), 90 = right (east); omitted = toward model center. pitch -60..60, fov 30..100 (default 60). day/time set the sun (default winter 12:00). Use with cad_set_materials to show material options from inside.','inputSchema':object_schema({'x':{'type':'number'},'y':{'type':'number'},'floor':{'type':'string','pattern':'^[1-9]\\d*F$'},'heading':{'type':'number'},'pitch':{'type':'number','minimum':-60,'maximum':60},'fov':{'type':'number','minimum':30,'maximum':100},'size':{'type':'integer','minimum':256,'maximum':1600},'day':{'type':'string','enum':['winter','equinox','summer']},'time':{'type':'string','pattern':'^([01]\\d|2[0-3]):[0-5]\\d$'},'setId':{'type':'string'}})},
 {'name':'cad_delivery_check','description':'납품 전 점검 (before handing a drawing over): data errors, duplicate/overlapping lines, line ends that miss (gap/overshoot/undershoot), slightly tilted lines, objects on non-standard (non A-) layers, text too small/large when plotted on A3 at 1:denominator (omitted = the drawing annotation or sheet scale, else 100 reported in assumed), and stray objects far from the main drawing. Returns each item with count, reason and up to 200 ids. Read only; fix with cad_delivery_fix.','inputSchema':object_schema({'denominator':{'type':'integer','minimum':1,'maximum':5000}})},
 {'name':'cad_delivery_fix','description':'Fix delivery-check items that are safe to fix automatically, one undo step per item, re-checking between items: audit (data errors), overkill (duplicates), angle (tilted lines, also closes their line ends), ends (gaps/overshoots). Layers, text size and far objects need a person/your decision (use ids from cad_delivery_check). Returns what was fixed and what remains.','inputSchema':object_schema({'keys':{'type':'array','items':{'type':'string','enum':['audit','overkill','angle','ends']},'minItems':1},'denominator':{'type':'integer','minimum':1,'maximum':5000},'expectedRevision':{'type':'integer','minimum':0}},['keys','expectedRevision'])},
 {'name':'cad_plot_pdf','description':'Save the whole drawing (or a window in mm) as a vector PDF. paper A0~A4, orientation landscape|portrait, scale = 1:N denominator or fit (default fit). tile {paper:A4|A3, overlap mm} splits a big sheet for small printers (first page = assembly guide, cut lines). path = absolute .pdf; omitted saves beside the drawing. Drawing colors as they are (CTB not applied).','inputSchema':object_schema({'path':{'type':'string'},'paper':{'type':'string','enum':['A0','A1','A2','A3','A4']},'orientation':{'type':'string','enum':['landscape','portrait']},'scale':{'type':'number','exclusiveMinimum':0},'window':object_schema({'minX':{'type':'number'},'minY':{'type':'number'},'maxX':{'type':'number'},'maxY':{'type':'number'}},['minX','minY','maxX','maxY']),'tile':object_schema({'paper':{'type':'string','enum':['A4','A3']},'overlap':{'type':'number','minimum':0,'maximum':50}},['paper'])})},
 {'name':'cad_wind_check','description':'풍하중 개략 바람 검토 (KDS 41 12 00:2022 5.5 속도압 + 5.15 간편법 외압계수, 지역별 기본풍속 = LH 표준상세 DA-93-005-1 표). Call it as soon as the user asks (e.g. 풍동검토 해줘) with nothing known: region comes from the drawing site address, height from the model. Missing region or terrain returns needs (plain questions with choices, nothing computed): ask the user needs[0] in plain words and call again with the chosen value. region = address or 시·군 name or basicWindSpeed m/s. terrain A|B|C|D (KDS 표 5.5-1, asked as surroundings), importance 특|1|2|3 (omitted = 1, the safe side, reported in assumed), height = reference height m (default model top). directions = wind-from degrees relative to drawing up (default 0,90,180,270). Returns design wind speed, velocity pressure q_H, and per exterior wall face (windward 0.6, leeward -0.5, side/roof zones) pressure N/m2 (min 675), plus an image colored for one direction (direction, default the worst suction). gust = 가스트영향계수 if the structural engineer gives it; otherwise not applied. Rough check only, not structural design.','inputSchema':object_schema({'region':{'type':'string'},'basicWindSpeed':{'type':'number','exclusiveMinimum':0,'maximum':80},'terrain':{'type':'string','enum':['A','B','C','D']},'importance':{'type':'string','enum':['특','1','2','3']},'height':{'type':'number','exclusiveMinimum':0,'maximum':1000},'directions':{'type':'array','items':{'type':'number','minimum':0,'maximum':360},'minItems':1,'maxItems':16},'direction':{'type':'number','minimum':0,'maximum':360},'gust':{'type':'number','minimum':1,'maximum':4},'size':{'type':'integer','minimum':256,'maximum':1600},'setId':{'type':'string'}})},
 {'name':'cad_export_glb','description':'Export the 3D model to an absolute .glb path; omit path to save beside the drawing/project or in Documents. Default names get a suffix if occupied; an explicit existing path is rejected. Returns path and byte size. Drawing read-only.','inputSchema':object_schema({'path':{'type':'string'},'setId':{'type':'string'}})},
 {'name':'cad_describe_command','description':'Describe which inputs a Barun CAD architecture element command (card) asks for and in what order, without drawing. Use it before cad_run_command. inputs: {form:{key:value} or [..] card/form values. WALDRAW/WAL: form:{slot:0,method:center|points|drag,lines:[{d,layer,lt,color}],byLayer,explode,fixedLayers}; center uses entities:[wallId,null] and points:[[x,y],...] (outside-face points), points uses paths:[{points:[[x,y],...],closed:true}], drag uses four points then null (or an exhausted queue). D1/W1: points are three picks on the same wall (two on one face and one on the opposite face), and form.width is the opening width. General points:[[x,y]..] in mm (null = Esc/Enter), paths:[[[x,y]..]] or [{points,closed}], entities:[entity ids] (null = finish), numbers:[n], selection:[entity ids], slot, method, shared:{}}. Missing inputs are reported as what=point|path|entity|number without changing the drawing. Read-only.','inputSchema':object_schema({'name':{'type':'string'},'inputs':COMMAND_INPUTS_SCHEMA},['name'])},
 {'name':'cad_preview_command','description':'Run a Barun CAD architecture element command (wall, door D1, window W1, stair, column, dims, hatch, text and ~340 other menu commands) by name on a copy and return the changes without modifying the drawing. inputs: {form:{key:value} or [..] card/form values. WALDRAW/WAL: form:{slot:0,method:center|points|drag,lines:[{d,layer,lt,color}],byLayer,explode,fixedLayers}; center uses entities:[wallId,null] and points:[[x,y],...] (outside-face points), points uses paths:[{points:[[x,y],...],closed:true}], drag uses four points then null (or an exhausted queue). D1/W1: points are three picks on the same wall (two on one face and one on the opposite face), and form.width is the opening width. General points:[[x,y]..] in mm (null = Esc/Enter), paths:[[[x,y]..]] or [{points,closed}], entities:[entity ids] (null = finish), numbers:[n], selection:[entity ids], slot, method, shared:{}}. Missing inputs are reported as what=point|path|entity|number without changing the drawing.','inputSchema':object_schema({'name':{'type':'string'},'inputs':COMMAND_INPUTS_SCHEMA},['name'])},
 {'name':'cad_access_plan','description':'현재 평면으로 편의시설 계획도를 생성합니다. 시설 용도·면적은 도면에서 보완하고 공동주택이면 아파트/연립·다세대/기숙사 중 세부용도를 needs로 묻습니다(아파트 추천). 신축·오늘 기준일 가정은 assumed로 안내. 긴 작업은 job_id로 cad_get_job 조회; 같은 생성 재호출 금지.','inputSchema':object_schema({'facility':{'type':'object','properties':{'use':{'type':'string'},'areaM2':{'type':'number','exclusiveMinimum':0},'work':{'type':'string','enum':['new','change-use']},'date':{'type':'string'},'parkingSpaces':{'type':['number','null']},'parkingRatio':{'type':['number','null']},'rooms':{'type':['number','null']},'employmentObligation':{'type':'boolean'},'units':{'type':['number','null']},'residents':{'type':['number','null']},'parkingKind':{'type':'string','enum':['ancillary','off-street']},'noiseDb':{'type':'number','minimum':0}},'required':[],'additionalProperties':False},'model':{'type':'object'},'setId':{'type':'string'},'story':{'type':'string'},'origin':{'type':'object','properties':{'x':{'type':'number'},'y':{'type':'number'}},'required':['x','y'],'additionalProperties':False},'overlay':{'type':'boolean'}})},
 {'name':'cad_generate_drawing','description':'현재 평면으로 단면도·창호도를 실제 생성합니다(원본 유지, 실행 취소 한 단계). cad_get_document로 target을 읽고 kind=section(건물 단면), schedule(문·창 기호+치수 창호도+일람표), set/all(평면·4면 입면·단면·창호·상세 연결 한 벌), elevation(입면만; face=south/north/east/west/all, 기본 all), plan, wall-section-detail 중 선택. model과 setId를 생략하면 기존 평면 인식기로 벽·문·창·층을 읽습니다. planOptions.boxIds로 층별 닫힌 박스를 지정할 수 있고 floors:[{name,height}]로 층고(mm)를 보완합니다. 인식되지 않은 높이는 recognition.assumed로 반환하므로 사용자에게 알리세요. sectionAt은 인식 모델의 로컬 x(mm), occt=true는 선택적 3D 절단. origin 생략 시 기존 도형 오른쪽에 배치. model을 직접 주면 stories:[{id,name,elevation,height}], elements:[{id,kind:wall,story,path:[[0,0],[6000,0]],thickness:200},...] 형식이며 점은 [x,y] 또는 {x,y}; wall은 유효 층에 있어야 합니다. window/door는 host(벽id),offset,width,height,sill(mm) — offset+width 는 host 벽 길이 안, 같은 벽 창·문끼리 겹치지 않게(벽 밖·겹침이면 외벽이 끊겨 code=sheet_template 로 막힘). 기울어진 외벽도 끝점을 이웃 벽 끝점과 똑같은 좌표로 이어 닫힌 테두리로. stair 는 outline(계단실)에 실제 계단 값 risers(단 수)·perRun(참까지 단 수)·runLength(한 줄 오름 길이)·width(한 줄 폭)를 주면 그대로 그리고 검토합니다(없으면 outline 으로 짬). set/all model 직접 입력에는 analysis.summary:[[항목,값],...] 건축개요 표도 필요합니다(평면 자동 인식은 자동 작성). 건축개요 줄은 도면 기준(overview.table)으로 고정이고 대지면적·건축면적·건폐율·연면적·용적률·규모·최고높이는 생성기가 구적에서 셉니다 — summary 에는 공사명·대지위치·지역지구·주용도·구조·주차 같은 값만, "원본"·"확인 필요"·"재작성" 같은 작업 메모는 넣지 마세요(빠지고 warnings 로 돌아옴). 대지는 model.site={parcel, address, ledgerAreaM2(건축물대장 대지면적 — 비율 계산에 씀, 합필이면 cad_get_parcel 의 ledgerAreaM2), zone(용도지역·지구)}, 주차는 model.building.parking={required(법정), planned(계획), basis(산정식)}. 테라스·발코니 둘레 벽은 role:"railing"(또는 height 1500 이하)으로 주어야 바닥면적에서 빠집니다. 방이 덮은 확장 발코니(바깥쪽 1.5 m 이내 띠)는 elements 에 kind:"balcony",story,outline 으로 두면 바닥면적에서 빠집니다 — 원본 개요·구적 면적보다 층 바닥이 크면 앞쪽 발코니 띠를 스스로 찾아 넣고(사용자에게 묻지 말 것) assumed 를 알리세요. 실(space)이 없는 열린 부분(위층 바닥 밖)은 생성기가 테라스로 보고 바닥면적에서 빼고 assumed 로 알립니다 — 뺄 경계를 사용자에게 묻지 말고 그 assumed 를 그대로 알리세요. 정북 일조 검토는 다 그린 뒤 cad_validate_layout({}) (AI 설계 엔진)로 하세요 — 북측 경계·지반 높이를 묻지 마세요. 용도지역(zone)을 모르면 묻지 말고 주소·지적 조회 결과의 용도지역을 model.site.zone 에 넣으세요. setId로 같은 묶음 재생성(model 생략 시 기억한 모델). 창호는 WSL 수동 등록 없이 평면의 문·창에서 모읍니다. 구조 형식: 남의 도면을 읽어 다시 그릴 때는 베끼지 말고 벽 중심선만 가져와 model.building.structure 에 wall(벽식 RC 내력벽, 기둥 없음)·rc-frame(RC 라멘: 기둥·얇은 채움벽)·steel(철골: H형강 기둥·가벼운 외벽) 중 하나를 꼭 넣으세요(도면·사용자 말·구조 검토 결과로 판단, 모르면 사용자에게 한 번 묻기). 그러면 벽 두께는 도면 기준 structureSystems 값으로 바뀌고(wall.thickness 생략 가능), 라멘·철골은 모서리·교차점·8 m 이하 간격에 기둥을 둡니다. 배치도(A-100)는 model.site 로 그립니다: parcel(대지, 설계 mm)·ledgerAreaM2(건축물대장 대지면적 — 대지면적·건폐율·용적률은 이 값)·jibun·zone(용도지역, 주거지역이면 정북 일조 사선)·northAngle·roads[{coords,width(mm),name}]·neighbors[{coords,jibun}]·parking[{coords}](주차칸) 또는 parkingCount·landscape[{coords}](조경)·entrance{path:[[x,y],[x,y]],name}(출입구 화살표, 끝이 화살촉)·buildingLine[[x,y],…](건축선). 대지·도로·이웃은 cad_place_from_site_plan 결과 modelSite 를 그대로 넣고, 빠진 내용은 결과 warnings 의 ‘배치도 빠진 내용’ 으로 알려 줍니다. 구조 서버(cad_structure_generate) 기둥 위치·크기가 있으면 elements 에 kind:column,story,position:[x,y],width,depth,material(rc|steel) 로 넣으면 그 기둥을 씁니다. 결과 assumed 의 구조 형식 값을 사용자에게 알리세요.','inputSchema':object_schema({'setId':{'type':'string'},'facility':{'type':'object','properties':{'use':{'type':'string'},'areaM2':{'type':'number','exclusiveMinimum':0},'work':{'type':'string','enum':['new','change-use']},'date':{'type':'string'},'parkingSpaces':{'type':['number','null']},'parkingRatio':{'type':['number','null']},'rooms':{'type':['number','null']},'employmentObligation':{'type':'boolean'},'units':{'type':['number','null']},'residents':{'type':['number','null']},'parkingKind':{'type':'string','enum':['ancillary','off-street']},'noiseDb':{'type':'number','minimum':0}},'required':[],'additionalProperties':False},'overlay':{'type':'boolean'},'model':{'type':'object'},'kind':{'type':'string','enum':['all','set','elevation','plan','section','schedule','wall-section-detail','details','access-plan'],'default':'set'},'face':{'type':'string','enum':['south','north','east','west','all'],'default':'all'},'sectionAt':{'type':'number','description':'인식 모델 로컬 x(mm); 생략하면 창을 지나는 중앙'},'occt':{'type':'boolean','default':False},'planOptions':PLAN_OPTIONS_SCHEMA,'sheets':{'type':'boolean','default':True,'description':'plan: 층마다 A3 도곽(기본 true); false면 도곽 없이 생성'},'story':{'type':'string'},'wallId':{'type':'string'},'at':{'type':'number'},'origin':{'type':'object','properties':{'x':{'type':'number'},'y':{'type':'number'}},'required':['x','y'],'additionalProperties':False},'scale':{'type':'string','description':'1/50, 1/100 같은 축척. plan은 auto 또는 생략 시 A3 그림 칸에 맞춤','pattern':'^(auto|1/[1-9][0-9]*)$'},'title':{'type':'string'},'ids':{'type':'array','items':{'type':'string'},'minItems':1},'group':{'type':'string'}})},
 {'name':'cad_list_details','description':'사용 가능한 건축 상세 목록. group: basic 또는 wall/window/floor/roof/stair/fire/parking/access/interior/steel. 비어 있는 공종은 아직 준비 중입니다. 법정 수치는 보호 지식에서 읽습니다.','inputSchema':object_schema({'group':{'type':'string'}})},
 {'name':'cad_generate_details','description':'상세 번호(ids) 또는 공종(group)의 상세를 겹치지 않는 격자로 생성합니다. origin은 시트 왼쪽 위 도면 좌표(mm). setId로 같은 상세 묶음을 다시 만들 수 있습니다. 모델 검토값은 model로 전달합니다. Worker 생성·되돌리기 경로는 cad_generate_drawing과 같습니다.','inputSchema':object_schema({'setId':{'type':'string'},'model':{'type':'object'},'ids':{'type':'array','minItems':1,'items':{'type':'string'}},'group':{'type':'string','enum':['basic','wall','window','floor','roof','stair','fire','parking','access','interior','steel']},'origin':{'type':'object','properties':{'x':{'type':'number'},'y':{'type':'number'}},'required':['x','y'],'additionalProperties':False}})},
 {'name':'cad_get_drawing_sets','description':'활성 도면에 기억된 AI 도면 묶음(cad_generate_drawing 으로 만든 것) 목록: setId·kind·options·revision, include_model 이면 설계 JSON(model) 도. 설계를 고칠 때 이 model 을 고쳐 cad_generate_drawing(setId, model) 로 다시 그리세요.','inputSchema':object_schema({'editor_session':{'type':'string','format':'uuid'},'setId':{'type':'string'},'include_model':{'type':'boolean','description':'기본: 묶음이 하나이거나 setId 를 주면 true, 여럿이면 false'}})},
 {'name':'cad_run_command','description':'Run a Barun CAD architecture element command by name in the active drawing as ONE undo step, exactly like the menu command (standard layers are chosen by the command). 새 도면 WALDRAW/WAL은 generator_first로 거절합니다. 설계 JSON → cad_generate_drawing(kind=plan)을 먼저 쓰세요. 사용자가 직접 벽 그리기를 요청한 경우만 generator_check:{reason}를 붙이세요. inputs: {form:{key:value} or [..] card/form values. WALDRAW/WAL: form:{slot:0,method:center|points|drag,lines:[{d,layer,lt,color}],byLayer,explode,fixedLayers}; center uses entities:[wallId,null] and points:[[x,y],...] (outside-face points), points uses paths:[{points:[[x,y],...],closed:true}], drag uses four points then null (or an exhausted queue). D1/W1: points are three picks on the same wall (two on one face and one on the opposite face), and form.width is the opening width. General points:[[x,y]..] in mm (null = Esc/Enter), paths:[[[x,y]..]] or [{points,closed}], entities:[entity ids] (null = finish), numbers:[n], selection:[entity ids], slot, method, shared:{}}. PLANSET accepts inputs.selection (closed plan boxes) and inputs.form:{occt:no,details:none}; for current-plan section/schedule prefer cad_generate_drawing. WSL insert: inputs.form:{mode:insert}, points:[[0,0],[2000,0]] (queue end finishes); WSL list: form:{mode:list}, points:[[10000,0]]. OCCTSECTION needs a stored building model; first use cad_generate_drawing or prefer kind=section. Missing inputs roll back without changing the drawing.','inputSchema':object_schema({'name':{'type':'string'},'inputs':COMMAND_INPUTS_SCHEMA,'expectedRevision':{'type':'integer'},**copy.deepcopy(GENERATOR_CHECK_SCHEMA)},['name','expectedRevision'])},
 {'name':'cad_lisp_run','description':'사용자 등록 또는 이 도면 세션에 로드한 AutoLISP 명령을 기존 샌드박스 Worker로 실행합니다. 실행 취소 한 단계. selection 생략 시 현재 선택, inputs는 질문 순서의 값(점은 [x,y]). 입력 부족은 input_required로 즉시 종료하고 도면을 보존합니다. 파일·셸·외부 실행 불가. 결과: before_revision/after_revision, created/added, entity_ids, output(princ), 오류 원문.','inputSchema':object_schema(copy.deepcopy(LISP_PROPERTIES),['command','expectedRevision'])},
 {'name':'cad_lisp_load','description':'AI가 작성한 AutoLISP source(200KB 이하)를 현재 도면 세션 메모리에 로드합니다. 파일에 저장하지 않습니다. name은 선택 .lsp 이름(같은 이름은 교체), command를 주면 로드와 실행을 한 Undo로 적용합니다. 성공한 함수 정의와 전역 변수는 이 도면에서 유지되며 입력 부족·오류는 적용하지 않습니다. 세션당 32개·소스 1MB. 시간 초과로 Worker 종료 시 세션 소스를 다시 로드하세요. inputs/selection과 결과는 cad_lisp_run과 같습니다. 리습 먼저: layer/purpose 나 소스의 표준 레이어("A-WALL" 등)로 보아 바른 명령 라이브러리로 그릴 수 있는 건축 요소면 거절(code=library_first)하고 쓸 명령을 알려 줍니다(사용자 등록 리습은 cad_lisp_run 으로).','inputSchema':object_schema({**copy.deepcopy(LISP_PROPERTIES),'source':{'type':'string','maxLength':200000},'name':{'type':'string','maxLength':100},**copy.deepcopy(LIBRARY_CHECK_SCHEMA)},['source','expectedRevision'])},
 # 소규모 자동 구조(RC·철골·목조) — 계산은 바른 서버에서만(엔진·KDS 42 규칙표는 설치본에 없음). 로그인 필요.
 {'name':'cad_structure_generate','description':'소규모 구조 생성·검토를 바른 서버에서 계산합니다([계정 연결] 로그인 필요). outline=[[x,y],...] 및 floors는 m, 단면은 mm(footings[].B는 m, D는 mm). 기존 {entityId}·{x,y,width,depth} 윤곽은 mm. 외곽만 주면 주위 1m의 현재 평면을 읽어 벽·문 개구부·기둥·계단을 전달하고 기본 mode=check로 실제 RC 벽을 검토합니다. 평면 읽기 실패 시 중단하며, 여러 층 검토는 boxes/floors가 필요합니다. mode=design을 명시하면 평면 읽기 없이 외곽·stories로 시안을 생성합니다. 서버는 문 회피 기둥 재배치를 지원하지 않으므로 결과 배치 확인이 필요합니다. boxes=[선택 박스 객체 ID,...]는 아래층부터 평면 읽기→인식 API로 읽으며 readOptions에 층별 기준점 datums(mm)·heights(mm)를 지정합니다. mode=design/check/renovation, renovation·stairsAt·basement·legal은 입력 약속 그대로 전달합니다. 대지 위치(풍속·적설)·실제 용도·층고·지하층 유무는 도면·설계 모델·열린 PDF·주소 조회로 직접 채우세요. 3~5층 floors 에는 설계 모델의 기둥(kind:column)을 columns:[{id,x,y(m),b,h(mm)}] 로 꼭 넣으세요 — 위아래 같은 자리 기둥은 같은 id(빠지면 기둥 중력축력이 자료 부족으로 남음). 3~5층은 그래도 모르는 값(지반·하중·재료·배근·바닥판 등)을 도구가 도면 기준의 보통 값으로 채우고 근거에 ‘미리 가정(보통 값)’ 을 남깁니다(대표 2026-10-30) — 묻지 말고 실행한 뒤 어떤 값을 가정했는지 알리세요. 1~2층의 모르는 값(지반·지내력, 시행령 제32조제2항제3~8호 비해당 조건 등)은 묻지 말고 생략해 자료 부족으로 남긴 채 실행하고 무엇이 부족한지 알리세요. 가정값을 확정이라고 말하지 마세요. 자료 부족이면 확인서를 만들지 마세요. 구조도(cad_structure_drawings)는 자료 부족이어도 장마다 ‘검토 초안 · 구조계산 전’ 도장을 찍어 그립니다. 결과: 적합/부적합/자료 부족/미지원/적용범위 밖, counts, fixKinds(input 입력·layout 배치·member 부재·field 현장·calc 구조계산), 각 상태의 원문 이유, 부재·물량. 현재 출력은 검토 초안. insert=true는 적합일 때 저장·도면 생성. 풍속 normal/D35/D40/D40+/C40+, 적설 normal/heavy/east. 기준 KDS 42:2022.','inputSchema':object_schema({'system':{'type':'string','enum':['rc','steel','wood']},'outline':{'type':['object','array'],'description':'[[x,y],...] m 또는 {entityId}/{x,y,width,depth} mm'},'boxes':{'type':'array','items':{'type':'string'},'minItems':1,'description':'아래층부터 선택한 닫힌 평면 박스 객체 ID'},'H':{'type':'number','exclusiveMinimum':0,'description':'층고 m'},'X':{'type':'number','exclusiveMinimum':0},'Y':{'type':'number','exclusiveMinimum':0},'stairW':{'type':'number','exclusiveMinimum':0,'description':'계단 폭 m'},'target':{'type':'number','exclusiveMinimum':0},'openH':{'type':'number','exclusiveMinimum':0},'Fe':{'type':'number','minimum':0},'soilOk':{'type':'boolean'},'slope':{'type':'number','minimum':0},'walls':{'type':'array','items':{'type':'object'}},'columns':{'type':'array','items':{'type':'object'}},'footings':{'type':'array','items':{'type':'object'},'description':'B m / D mm'},'readOptions':{'type':'object','description':'readPlanForStructure options: datums·heights(mm), align 등'},'floors':{'type':'array','minItems':1,'items':{'type':'object'},'description':'아래층부터. 층마다 name·H(층고 m)·outline(m) 필수, 선택 walls·columns·beams·footings(B m / D mm)·pilotis·sourceIds만. level·z 등 다른 칸은 거절(층 순서·높이는 배열 순서와 H)'},'mode':{'type':'string','enum':['design','check','renovation']},'renovation':{'type':'object'},'stairsAt':{'type':'array','items':{'type':'object'},'description':'계단 경계 x0,y0,x1,y1 (m)'},'basement':{'type':['boolean','integer'],'description':'지하층 유무 또는 층수. 미확인은 생략'},'legal':{'type':'object','properties':{'excluded32_2_3to8Confirmed':{'type':'boolean'}},'description':'시행령 제32조②3~8호 모두 비해당 확인 시 excluded32_2_3to8Confirmed=true. 나머지 법적 조건은 그대로 전달, 미확인은 생략'},'location':{'type':'string'},'stories':{'type':'integer','minimum':1,'maximum':5},'sameLayoutUpper':{'type':'boolean','description':'도면에 1층만 있고 위층이 같은 배치라고 사용자가 확인한 경우만 true. 외곽 자동 평면 읽기로 읽은 1층을 stories 층까지 복사(벽을 손으로 만들지 마세요)'},'storyHeight':{'type':'number','minimum':1500,'maximum':10000,'description':'층고 mm(3 m 이면 3000). m 값은 H 에'},'roof':{'type':'string','enum':['flat','gable']},'pitch':{'type':'number','minimum':0,'maximum':75},'use':{'type':'string','enum':['house','retail','retailX','other']},'soil':object_schema({'Fe':{'type':'number','minimum':0,'maximum':1000},'landfill':{'type':'boolean'}}),'snow':{'type':'string','enum':['normal','heavy','east']},'wind':{'type':'string','enum':['normal','D35','D40','D40+','C40+']},'siteSlope':{'type':'number','minimum':0,'maximum':50},'stairs':{'type':'string','enum':['auto','none']},'targetSpan':{'type':'number','minimum':1000,'maximum':30000},'species':{'type':'string','enum':['가','나','다','라']},'grade':{'type':'integer','enum':[1,2]},'openingHeight':{'type':'number','minimum':500,'maximum':5000},'insert':{'type':'boolean'},'expectedRevision':{'type':'integer','minimum':0}})},
 {'name':'cad_structure_review','description':'구조 묶음(setId)의 검토 전체: 항목마다 그룹·항목·판정(ok·ng·info·hold 자료 부족·unsupported 미지원·scope 적용범위 밖)·fix·값·기준·근거 조항(KDS 42)·부재 id. 부재를 바꾼 뒤에는 서버가 다시 계산한 값입니다. Read only.','inputSchema':object_schema({'setId':{'type':'string'}},['setId'])},
 {'name':'cad_structure_get','description':'구조 묶음(setId)의 부재 목록 JSON(좌표 m, 크기 mm, footing.B는 m·D는 mm)과 규칙 판. kind 로 거르기(beam·column·slab·wall·brace·footing·woodWall·joists 등). Read only.','inputSchema':object_schema({'setId':{'type':'string'},'kind':{'type':'string'}},['setId'])},
 {'name':'cad_structure_set_member','description':'부호(code, 예 G1·C1·H1·J1)의 부재 크기를 덮어쓰고 서버가 다시 검토합니다. size = 300x550(RC 보·기둥) · H-400x200x8x13(철골) · 38x235(목조). 도면에 들어가 있으면 다시 그립니다(실행 취소 한 번). 기둥 확대 시 서버가 다시 계산한 주근을 사용합니다. 서버 응답의 1.0% 미달·미상 주근은 적합으로 처리하지 않습니다. 작게 바꿔 부적합이 나오면 그대로 알립니다. 다시 만들기는 사용자 수정 객체·주석을 보존하고 알립니다.','inputSchema':object_schema({'setId':{'type':'string'},'code':{'type':'string'},'size':{'type':'string'},'expectedRevision':{'type':'integer','minimum':0}},['setId','code','size','expectedRevision'])},
 {'name':'cad_structure_drawings','description':'구조 묶음을 도면에 그립니다: plan(층별 구조평면 — 축선·기둥·보·벽·가새·계단 구멍) · foundation(기초평면) · schedule(배근도·부재 일람표) · notes(구조일반주기, KDS 피복·정착·이음). S- 레이어와 부호 글자. origin(mm, 생략하면 건물 오른쪽 10 m). 도면 기준 승인 전에는 그림(PNG) 미리보기만 돌려주고 approval_required 를 알립니다.','inputSchema':object_schema({'setId':{'type':'string'},'sheets':{'type':'array','items':{'type':'string','enum':['plan','foundation','schedule','notes']},'minItems':1},'origin':object_schema({'x':{'type':'number'},'y':{'type':'number'}},['x','y']),'expectedRevision':{'type':'integer','minimum':0}},['setId','expectedRevision'])},
 {'name':'cad_structure_calc_report','description':'3~5층 kds41-preliminary 엔진 결과를 구조계산서(자동 작성 초안) A4 인쇄용 HTML로 옮깁니다. 계산·재판정·서명은 하지 않습니다. 해석 미수행과 hold/unsupported/scope를 유지합니다. project에는 공사명·대지위치·작성일·적용 KDS 판·구조특기사항만 보충하세요. 작성자·서명란은 비웁니다. missing.question을 확인하고 수치 누락은 엔진 입력 보충 후 재생성하세요. 1~2층은 cad_structure_certificate를 사용하세요.','inputSchema':object_schema({'setId':{'type':'string'},'project':{'type':'object'},'format':{'type':'string','enum':['html']}},['setId'])},
 {'name':'cad_structure_certificate','description':'소규모건축물 구조안전 및 내진설계 확인서(별지 제3호서식)를 HTML 또는 PDF로 만듭니다. 엔진이 채우지 못한 칸은 missing으로 알려드립니다. project에는 공사명·대지위치·작성자·주소·연락처·작성일·서명·면허번호 등을 넣습니다. missing.question을 사용자에게 쉬운 말로 묻고 답은 missing.key 이름으로 project에 넣어 다시 호출하세요. 모르면 작성자 확인으로 남기세요. 범위 밖·부적합·검토 미완료이면 파일을 만들지 않습니다.','inputSchema':object_schema({'setId':{'type':'string'},'project':{'type':'object'},'format':{'type':'string','enum':['pdf','html']}},['setId'])},
 {'name':'cad_save','description':'Save the active drawing as a real DXF or DWG (name ends with .dxf or .dwg; no extension → .dxf) in an existing absolute project folder. Previous file is preserved as .previous.','inputSchema':object_schema({'folder':{'type':'string'},'name':{'type':'string'},'dwgVersion':{'type':'string','enum':['2018','2013','2010','2004','2000'],'default':'2018'}},['folder','name'])}
]


# 3~5층: 입력 약속의 p 객체와 이름·단위를 맞춘다. null/누락은 미상이며 기본값을 만들지 않는다.
_STRUCTURE_INPUTS = {
 'reviewMethod': {'type':['string','null'],'enum':['kds42-table','kds41-preliminary',None]},
 'structureType': {'type':['string','null'],'description':'rc-moment / rc-wall / pilotis-wall / steel-moment. 그 밖 형식은 엔진이 범위 판정'},
 'basementModel': {'type':['string','null'],'enum':['above-ground','integrated',None]},
 'complexBase': {'type':['boolean','null']}, 'extension': {'type':['boolean','null']},
 'legalArea_m2': {'type':['number','null'],'description':'법정 연면적 ㎡. 외곽 면적을 대입하지 않음'},
 'occupancy': {'type':['object','null'],'properties':{'legalUse':{'type':['string','null']}, 'uses':{'type':['array','null'],'items':{'type':'string'}}, 'residentialStoreys':{'type':['integer','null']}, **{k:{'type':['boolean','null']} for k in ('importantFacility','emergencyShelter','essentialToSpecialFacility','hasSurgery','hasEmergency','publicFacility','freightTerminal')}},
               'description':'법정·실제 용도. residentialStoreys(주거층수), importantFacility(특수 기능), uses(복합용도 배열), emergencyShelter, essentialToSpecialFacility, hasSurgery, hasEmergency, publicFacility, freightTerminal도 원자료가 확인된 경우만. 중요한 기능 비해당은 importantFacility:false로 확인'},
 'inputEvidence': {'type':['object','null'],'description':'입력 경로→{source,confirmed,assumption}. 미확정 자동 값은 confirmed:false와 assumption·reference 포함'},
 'seismic': {'type':['object','null'],'properties': {
    'zone':{'type':['string','null'],'enum':['I','II',None]},
    'siteClass':{'type':['string','null'],'enum':['S1','S2','S3','S4','S5','S6',None]},
    'importance':{'type':['string','null'],'enum':['특','I','II',None]},
    'method':{'type':['string','null'],'enum':['zone','map',None]},
    **{k:{'type':['number','null']} for k in ('mapS','baseZ','topZ','bedrockDepth_m','avgVs_mps')},
    **{k:{'type':['boolean','null']} for k in ('depthUnknown','hasInfill','isolation','damping','dynamicRequired')},
    'analysisPeriod':{'type':['object','null'],'description':'x/y 각각 초'},
    'reference':{'type':['object','null'],'description':'구기준 계산서 재현 전용. 범위·자료부족 판정을 해제하지 않음'} }},
 **{k:{'type':['object','null'],'description':d} for k,d in {
   'lateralSystem':'x/y:{systemKey}. 구조 형식별 실제 시스템',
   'otherLoads':'F/T/R/W 중력 하중효과 kN. 미상은 0을 넣지 않음',
   'loadPaths':'missingSupport:boolean, reactions[id]:{D,L,Lr,S,R,F,T,W,levels}',
   'irregularityEvidence':'x/y:{confirmed,regular,types,stiffness,strength,weights,widths,weightsIncludeRoof}',
   'members':'columns/walls/beams/flexure 배열. 실제 단면·배근 또는 design 후보. 제안과 실제 입력 구분',
   'pilotisDetails':'코어·벽·전이·상세·전단 입력 약속 그대로. Ln은 m',
   'foundation':'Nservice/B/L/qa/qmax/confirmed/basisMatched 및 기초 설계 입력 약속 그대로',
   'materials':'fck/Ec_MPa/G_MPa/nu. 강도 MPa, 미상은 추정하지 않음',
   'lateralAnalysis':'wallBoundary:cantilever/fixed-fixed, beta. 확인된 해석 조건만'}.items()},
 'diaphragms':{'type':['array','null'],'items':{'type':'object'},'description':'floors 상단 아래부터: z(m),area/slabArea(㎡),DL(kN/㎡),massComplete,liveZones[{area,use}],roof,snow_kNm2,weightItems,uniformExtraDead,rigid,CM/massPoints,Px_kN'},
 'answers': {'type':'object','description':'questions[].key→쉬운 답. 모름은 엔진에 넘기지 않고 보류. 0·아니요는 실제 확인한 경우만'},
 'answerSetId': {'type':'string','description':'이전에 받은 setId. 원 입력·제안 질문을 이어 받아 재검토. 도면을 넣지 않고 새 초안 생성'},
}
for _tool in TOOLS:
    if _tool['name']=='cad_structure_generate':
        _tool['inputSchema']['properties'].update(_STRUCTURE_INPUTS)
        _tool['description'] += ' 3~5층은 kds41-preliminary(KDS 41)로 서버 개략 검토합니다. 입력은 docs/structure/입력약속_층별·검토방식.md의 새 p 키 그대로. 도면·주소·용도로 근거 있는 값부터 채우고, questions의 쉬운 질문만 사용자에게 보여 주세요. answers와 answerSetId로 답을 반영합니다. 모름은 hold 유지. notifications 한 줄을 사용자에게 알리고 자동값을 확정으로 말하지 마세요. 전체 설계 완료는 후속 구조계산 보류이며 확인서는 1~2층 전용입니다.'
    elif _tool['name']=='cad_structure_review':
        _tool['description'] += ' 3~5층은 지진력·층간변위·부재 제안·questions·inputEvidence·notifications도 반환합니다.'

# Old method names also require binding at runtime; aliases protect new callers
# from old servers that would otherwise silently ignore an unknown target field.
TARGET_SCHEMA=object_schema({key:({'type':'integer','const':1} if key=='protocol_version' else
    {'type':'integer','minimum':0,'maximum':9007199254740991} if key=='revision' else
    {'type':'string','format':'uuid'}) for key in TARGET_KEYS},list(sorted(TARGET_KEYS)))
# 앱 전용도 같은 원장에 두고 외부 MCP 목록에서만 뺀다.
TOOLS.extend([
 {'name':'cad_ui_command','app_only':True,'description':'앱 안 전용. 화면 작업 하나를 요청합니다. NEW/OPEN/SAVE/SAVEAS/BACKUP, PDF/PLOT/SHEET/SHEETS와 APPLOAD/SETTINGS/HELP/LAYER 등을 지원합니다. PLANSET 등 등록 카드 명령은 제한 Worker에서 완료 후 적용하며 추가 입력이 필요하면 cad_describe_command/cad_run_command를 사용하세요. 파일 선택·덮어쓰기·도곽 설정은 사용자가 화면에서 진행합니다. 그 밖의 편집·출력은 전용 CAD 도구를 사용하세요. target은 도면 편집 문맥이 있을 때만 주고 생략하면 요청한 앱 창에서 실행합니다. 결과 started는 작업 완료가 아닙니다. 리습은 cad_lisp_run/load만 사용. 파일 삭제·셸·파이썬·명령 문자열/스크립트 주입 불가.','inputSchema':object_schema({'command':{'type':'string','maxLength':100},'target':copy.deepcopy(TARGET_SCHEMA)},['command'])},
 {'name':'cad_lisp_list','app_only':True,'description':'앱 안 사용자 리습 등록 목록과 명령 이름을 읽습니다. 파일 삭제 기능 없음.','inputSchema':object_schema({})},
 {'name':'cad_lisp_read','app_only':True,'description':'등록 목록의 id로 LSP 원문을 읽습니다. 수정본은 cad_lisp_save로 저장·등록하세요.','inputSchema':object_schema({'id':{'type':'string'}},['id'])},
 {'name':'cad_lisp_save','app_only':True,'description':'AI가 작성/수정한 AutoLISP를 .lsp 파일로 저장하고 기존 사용자 리습 자동 등록 경로로 등록합니다. id 생략은 새 등록, id는 기존 LSP 수정. 기존 파일/등록 덮어쓰기는 화면에서 사용자 확인. 삭제 불가. 소스는 실행하지 않으며 실행은 샌드박스 cad_lisp_run만 사용합니다.','inputSchema':object_schema({'id':{'type':'string'},'name':{'type':'string','maxLength':100},'source':{'type':'string','maxLength':200000},'target':copy.deepcopy(TARGET_SCHEMA)},['name','source'])},
])
EDIT_TOOLS=MUTATING_TOOLS | SESSION_ACTIONS | frozenset(('cad_plot_pdf','cad_export_glb','cad_field_records_update'))

def _public_tool(tool):return copy.deepcopy({k:v for k,v in tool.items() if k!='app_only'})

def mcp_tools():return [_public_tool(t) for t in TOOLS if not t.get('app_only')]

def app_tools(allow_edit=True):
    return [_public_tool(t) for t in TOOLS if allow_edit or t['name'] not in EDIT_TOOLS]

for _tool in TOOLS:
    if _tool['name'] in ('cad_preview','cad_execute','cad_lisp_run','cad_lisp_load'):
        _tool['description']+=CAD_DRAWING_INSTRUCTIONS
    if _tool['name'] in MUTATING_TOOLS or _tool['name'] in ('cad_suggest_details','cad_preview','cad_validate','cad_preview_command','cad_describe_command','cad_view_drawing','cad_get_pad_sketch',*FIELD_RECORD_TOOLS,'cad_view_3d','cad_export_glb','cad_get_materials','cad_energy_regions','cad_get_recognition','cad_sun_study','cad_view_interior','cad_delivery_check','cad_plot_pdf','cad_wind_check'):
        _tool['inputSchema']['properties']['target']=copy.deepcopy(TARGET_SCHEMA)
        if _tool['name'] in MUTATING_TOOLS or _tool['name']=='cad_field_records_update':_tool['inputSchema']['required'].append('target')
        if _tool['name']=='cad_execute':
            _tool['inputSchema']['required']=['command','target']
        _tool['description']+=' Binding v1: use the exact target from cad_get_document; never construct identifiers.'
# *_bound 이름은 원래 도구와 똑같아 목록에는 싣지 않는다(AI가 둘 중 고르다 헷갈림). 예전 호출은 call()이 원래 이름으로 받는다.

def window_list():
    """Metadata only: never walk, copy or hash drawing geometry during polling."""
    with lock:
        return [{'editor_session':client,'drawingPath':state.get('drawingPath',''),'drawingName':state.get('drawingName',''),
                 'folder':state.get('folder',''),'focused':state.get('focused',False),'lastActivated':state.get('lastActivated',0),
                 'seenAt':state.get('seenAt',0),'backend_generation':BACKEND_GENERATION,'instance':os.environ.get('BARUN_CAD_INSTANCE','')}
                for client,state in clients.items() if _live_locked(client)]

def destination(args,result=None):
    value=result if isinstance(result,dict) else {}
    target=value.get('target') or args.get('target') or {}
    client=value.get('editor_session') or target.get('editor_session') or args.get('editor_session') or getattr(APP_CONTEXT,'origin',None)
    with lock:
        client=client or _default_editor()
        state=clients.get(client,{})
        return {'backend_generation':BACKEND_GENERATION,'instance':os.environ.get('BARUN_CAD_INSTANCE',''),
                'editor_session':client,'drawingPath':value.get('drawingPath',state.get('drawingPath','')),
                'drawingName':value.get('drawingName',state.get('drawingName','')),'folder':value.get('folder',state.get('folder',''))}

def get_job(args):
    identifier=args.get('job_id');wait=args.get('wait_seconds',0)
    if not isinstance(identifier,str) or not identifier.startswith(BACKEND_GENERATION+':'):raise CADToolError('원래 엔진의 작업을 찾을 수 없습니다. 엔진이 재시작되었으면 실행 여부를 도면에서 확인하세요.',{'code':'job_unavailable'})
    if type(wait) not in (int,float) or not math.isfinite(wait) or not 0<=wait<=10:raise ValueError('wait_seconds는 0~10초입니다.')
    with _jobs_lock:record=_jobs.get(identifier)
    if record is None:raise ValueError('작업을 찾을 수 없거나 보관 시간이 지났습니다.')
    origin=getattr(APP_CONTEXT,'origin',None)
    if origin is not None and record['origin']!=origin:raise ValueError('다른 앱 창의 작업을 조회할 수 없습니다.')
    record['done'].wait(wait)
    return _job_value(identifier,record)

def _job_value(identifier,record):
    if not record['done'].is_set():
        waiting=record.get('waiting')
        if waiting:return {'job_id':identifier,'status':'running','retry_after_seconds':2,'destination':record['destination'],'waiting':dict(waiting),
            'message':f"CAD 창에서 확인 필요: '{waiting['path']}' 파일이 이미 있어 CAD 창에 덮어쓰기 확인이 떠 있습니다. 사용자에게 CAD 창에서 덮어쓸지 정해 달라고 알리고, 같은 job_id로 cad_get_job을 기다리세요. 같은 저장을 다시 실행하지 마세요."}
        return {'job_id':identifier,'status':'running','stage':record.get('stage'),'retry_after_seconds':1,'destination':record['destination'],
        'message':'작업 중입니다. cad_get_job으로 완료를 기다리세요. 같은 작업을 다시 실행하지 마세요.'}
    if 'error' in record:raise record['error']
    return {'job_id':identifier,'status':'completed','result':record['result'],'destination':record['result'].get('destination',record['destination'])}

# 미리가 스스로 채우기(2026-10-30 사용자 "다 해 달라고만 하네"): 추천(suggested)이나 보기가 하나뿐인 질문은
# 묻지 않고 그 값으로 같은 도구를 다시 불러 진행하고, 무엇을 골랐는지 assumed 로 알린다. 추천이 없을 때만 묻는다.
AUTO_ANSWER_ROUNDS=4

def _auto_answer(name,args,need):
    choices=need.get('choices') or []
    if 'suggested' in need:pick=need['suggested']
    elif len(choices)==1:pick=choices[0].get('value')
    else:return None
    key=need.get('key')
    props=next((t['inputSchema'].get('properties',{}) for t in TOOLS if t['name']==BOUND_ALIASES.get(name,name)),{})
    if not isinstance(key,str) or pick is None:return None
    new=copy.deepcopy(args)
    if isinstance(pick,dict) and '.' not in key:
        if not set(pick)<=set(props):return None
        new.update(copy.deepcopy(pick))
    else:
        parts=key.split('.')
        if parts[0] not in props:return None
        node=new
        for part in parts[:-1]:
            if not isinstance(node.get(part,{}),dict):return None
            node=node.setdefault(part,{})
        node[parts[-1]]=copy.deepcopy(pick)
    label=next((c.get('label') for c in choices if c.get('value')==pick),None) or str(pick)
    why=(' — '+need['why']) if need.get('why') else ''
    return new,{'key':key,'value':pick,'say':f'"{need.get("question","")}"는 묻지 않고 "{label}"(으)로 정해 진행했어요{why}. 다르면 말해 주세요.','auto':True}

def _proceed_on_suggestions(name,args,out,run):
    picked=[];asked=set()
    for _ in range(AUTO_ANSWER_ROUNDS):
        needs=out.get('needs') if isinstance(out,dict) else None
        if not needs or not isinstance(needs[0],dict) or needs[0].get('key') in asked:break
        answer=_auto_answer(name,args,needs[0])
        if answer is None:break
        args,note=answer;asked.add(note['key']);picked.append(note)
        out=run(args)
    if picked and isinstance(out,dict):out={**out,'assumed':[*picked,*(out.get('assumed') or [])]}
    return out

def _invoke_tool(name,args,allow_edit,app=False):
    from miri_account_service import capture_ai_epoch,validate_ai_epoch
    epoch=getattr(APP_CONTEXT,'login_epoch',None)
    if epoch is None:epoch=capture_ai_epoch()
    else:validate_ai_epoch(epoch)
    if not isinstance(args,dict):raise ValueError('CAD arguments must be an object')
    if name=='cad_get_job':return get_job(args)
    # 날짜·숫자 버전의 마침표는 확장자가 아니다. 영문 확장자는 기존 DXF 전용 검증에 맡긴다.
    if BOUND_ALIASES.get(name,name)=='cad_save' and isinstance(args.get('name'),str) and args['name'] and not re.fullmatch(r'\.[A-Za-z][A-Za-z0-9]*',Path(args['name']).suffix):
        args={**args,'name':args['name']+'.dxf'}
    operation=_call_app if app else _call
    with lock:
        recipient=(args.get('target') or {}).get('editor_session') or args.get('editor_session') or _default_editor()
        document_query=name=='cad_get_document' and (args.get('mode') is not None or 'documentOmitted' in clients.get(recipient,{}))
    event_id=BACKEND_GENERATION+':'+str(uuid.uuid4())
    source='chat' if app else 'mcp'
    started_at_ms=int(time.time()*1000)
    event_base={'id':event_id,'tool':name,'source':source,'target':_safe_tool_target(args),'started_at_ms':started_at_ms,'request_epoch':getattr(APP_CONTEXT,'epoch',None)}
    def execute():
        previous=(getattr(APP_CONTEXT,'recipient',None),getattr(APP_CONTEXT,'login_epoch',None),getattr(APP_CONTEXT,'tool_event',None))
        APP_CONTEXT.recipient=recipient;APP_CONTEXT.login_epoch=epoch;APP_CONTEXT.tool_event=(recipient,event_base)
        _tool_stage('running')
        try:
            out=_proceed_on_suggestions(name,args,operation(name,args,allow_edit),lambda chosen:operation(name,chosen,allow_edit))
            library_first.note(BOUND_ALIASES.get(name,name),args)  # 리습 먼저: 실제로 찾아보거나 실행한 명령만 기록(입구에서 거절된 호출은 아님)
            failed=isinstance(out,dict) and (bool(out.get('error')) or out.get('status') in ('failed','cancelled'))
            phase='failed' if failed else 'completed'
            record=getattr(APP_CONTEXT,'job_record',None)
            if record is not None:record['stage']=phase
            count=_tool_count(out)
            emit_tool_event(recipient,{**event_base,'phase':phase,'stage':phase,'at_ms':int(time.time()*1000),**({'count':count} if count is not None else {})})
            return {**out,'destination':destination(args,out)} if isinstance(out,dict) else out
        except Exception as error:
            # 엔진·화면이 돌려준 실행 실패(입력 부족 등)도 '써 본' 기록이다. 입구 검사(ValueError)는 아니다.
            if isinstance(error,CADToolError) and error.code not in ('library_first','generator_first'):library_first.note(BOUND_ALIASES.get(name,name),args)
            record=getattr(APP_CONTEXT,'job_record',None)
            if record is not None:record['stage']='failed'
            emit_tool_event(recipient,{**event_base,'phase':'failed','stage':'failed','at_ms':int(time.time()*1000)})
            raise
        finally:APP_CONTEXT.recipient,APP_CONTEXT.login_epoch,APP_CONTEXT.tool_event=previous
    # Fast metadata reads stay synchronous. Jobs wrap commandJob/renderer work and
    # slow file/network work; their thread retains the original target and app epoch.
    job_action=BOUND_ALIASES.get(name,name)
    slow=document_query or job_action in MUTATING_TOOLS or job_action in SESSION_ACTIONS or any(t['name']==job_action and 'target' in t['inputSchema'].get('properties',{}) for t in TOOLS) or job_action in {
        'cad_preview','cad_validate','cad_preview_command','cad_describe_command','cad_suggest_details','cad_view_drawing',
        'cad_view_3d','cad_export_glb','cad_sun_study','cad_view_interior','cad_wind_check','cad_plot_pdf',
        'cad_suggest_layout','cad_validate_layout','cad_site_plan_from_drawing','cad_place_from_site_plan','cad_search_address','cad_get_parcel','cad_apartment_review',
        # 바른 서버 계산. 미리(Codex)는 30초가 지나면 도구 답을 못 받는다(평면 읽기 31초 → 빈 답, 2026-10-29) — 1초 뒤 job_id 로 돌려준다
        'cad_read_foreign_plan','cad_electrical_layout','cad_suggest_openings','cad_check_daylight','cad_extension_review','cad_energy_plan','cad_sunlight_report',
        'cad_structure_review','cad_structure_calc_report','cad_structure_certificate'}
    if not slow or getattr(APP_CONTEXT,'job_running',False):return execute()
    # Authorization/mode checks precede starting background work.
    if app and name not in {t['name'] for t in app_tools(allow_edit)}:raise ValueError('대화/검토 모드에서는 읽기·조회만 가능합니다. 도면 실행 모드를 선택하세요.')
    context={key:getattr(APP_CONTEXT,key,None) for key in ('epoch','origin','cancelled','login_epoch')}
    context['login_epoch']=epoch
    record={'done':threading.Event(),'destination':destination({**args,'editor_session':recipient}),'created':time.monotonic(),'origin':context['origin'],'stage':'queued','tool_event_id':event_id}
    identifier=BACKEND_GENERATION+':'+str(uuid.uuid4())
    with _jobs_lock:
        for key,value in list(_jobs.items()):
            if value['done'].is_set() and time.monotonic()-value['created']>JOB_RETENTION_SECONDS:_jobs.pop(key,None)
        if len(_jobs)>=JOB_LIMIT:
            finished=sorted((k for k,v in _jobs.items() if v['done'].is_set()),key=lambda k:_jobs[k]['created'])
            if finished:_jobs.pop(finished[0])
            else:raise ValueError('진행 중 작업이 많습니다. 기존 작업이 끝난 뒤 다시 시도하세요.')
        _jobs[identifier]=record
    emit_tool_event(recipient,{**event_base,'phase':'running','stage':'queued','at_ms':started_at_ms})
    def work():
        for key,value in context.items():setattr(APP_CONTEXT,key,value)
        APP_CONTEXT.job_running=True;APP_CONTEXT.job_record=record;record['stage']='running'
        try:record['result']=execute()
        except Exception as error:record['error']=error
        finally:record['done'].set()
    threading.Thread(target=work,daemon=True,name='cad-tool-job').start()
    if record['done'].wait(JOB_RESPONSE_SECONDS):
        with _jobs_lock:_jobs.pop(identifier,None)
        if 'error' in record:raise record['error']
        return record['result']
    return _job_value(identifier,record)

def extract_tool_image(result):
    """Transport copy: reading a completed job must not mutate its cached result."""
    if not isinstance(result,dict):return result,None
    out=dict(result)
    if out.get('status')=='completed' and isinstance(out.get('result'),dict):
        nested=dict(out['result']);image=nested.pop('image',None);out['result']=nested
    else:image=out.pop('image',None)
    return out,image

STRUCTURE_TOOLS=('cad_structure_generate','cad_structure_review','cad_structure_get','cad_structure_set_member','cad_structure_drawings','cad_structure_certificate','cad_structure_calc_report')
STRUCTURE_APPROVAL='구조 도면을 직접 그리려면 사용자 승인이 필요합니다(도면 기준 "명령 강제": 구조 축선·기둥·보는 맞는 명령이 없어 생성기가 그립니다). 승인되면 drawing-standard.json noCommand 에 structurePlan 을 더하고 docs/도면기준-결정기록.md 에 남깁니다. 지금은 미리보기 그림만 드립니다.'
EDIT_MODE_ONLY='현재 채팅은 대화/검토 모드입니다. 도면 실행 모드를 선택하세요.'

def _structure_target(args):
    return {'target':args['target']} if args.get('target') is not None else {}

def _structure_record(args):
    """구조 묶음: 도면(structureSets)에 있으면 그것, 아니면 이 실행에서 넣지 않고 만든 것."""
    import structure_service as ss
    set_id=args.get('setId')
    if not isinstance(set_id,str) or not re.fullmatch(r'st-[0-9a-f]{10}',set_id):raise ValueError('setId 가 올바르지 않습니다(cad_structure_generate 가 준 값을 쓰세요).')
    found=dispatch('cad_structure_read',{'setId':set_id,**_structure_target(args)}).get('record')
    if found:
        found=copy.deepcopy(found);found['review']=ss.effective_review(found)
        return found,True
    pending=ss.pending.get(set_id)
    if pending:
        pending['review']=ss.effective_review(pending)
        return pending,False
    raise ValueError('없는 구조 묶음입니다. cad_structure_generate 로 다시 만드세요.')

def _structure_sheet_templates():
    '''구조 장을 평면도와 같은 도곽에 담을 한 벌 템플릿 일부(2026-10-27). 서버 기준을 못 받으면 None — 예전처럼 도곽 없이 그린다.'''
    import vault_gate
    try:t=json.loads(vault_gate.knowledge('drawing-standard.json').decode('utf-8')).get('sheetTemplates')
    except ValueError:return None
    if not isinstance(t,dict) or not (t.get('sheets') or {}).get('plan'):return None
    keep=('plan','structure-notes','structure-foundation','structure-plan','structure-schedule')
    return {**{k:t[k] for k in ('paper','sheet','frame','titleBlock','drawZone','titleMark','structureDetails') if k in t},'sheets':{k:v for k,v in t['sheets'].items() if k in keep}}

def _structure_drawing_allowed():
    import vault_gate
    try:standard=json.loads(vault_gate.knowledge('drawing-standard.json').decode('utf-8'))
    except ValueError:return False
    return 'structurePlan' in ((standard.get('commandsFirst') or {}).get('noCommand') or {})

def _copied_upper_floor(ground,name,height=None):
    """sameLayoutUpper 로 만든 위층. 도면에는 없는 층이라 1층 객체 ID(sourceIds)를 떼어, 판정이 1층 객체를 가리키지 않게 한다."""
    floor=copy.deepcopy(ground);floor['name']=name;floor.pop('sourceIds',None);floor.pop('alignment',None)
    if height is not None:floor['H']=height
    for kind in ('walls','columns','beams','footings'):
        for member in floor.get(kind) or []:
            if isinstance(member,dict):member.pop('sourceIds',None)
    return floor

def _structure_outline(args):
    outline=args.get('outline')
    if outline is None and args.get('floors'):outline=args['floors'][0].get('outline')
    if outline is None and all(type(args.get(k)) in (int,float) and math.isfinite(args[k]) and 1<=args[k]<=200 for k in ('X','Y')):
        outline={'x':0,'y':0,'width':args['X']*1000,'depth':args['Y']*1000}
    if isinstance(outline,list):
        import structure_service as ss
        return ss._polygon(outline)
    if isinstance(outline,dict) and set(outline)=={'entityId'} and isinstance(outline['entityId'],str) and outline['entityId']:
        return dispatch('cad_structure_read',{'entityId':outline['entityId'],**_structure_target(args)})['outline']
    if isinstance(outline,dict) and set(outline)=={'x','y','width','depth'} and all(type(outline[k]) in (int,float) and math.isfinite(outline[k]) for k in outline) and 1000<=outline['width']<=200000 and 1000<=outline['depth']<=200000:
        return {k:float(outline[k]) for k in ('x','y','width','depth')}
    raise ValueError('outline 은 [[x,y],...] m 또는 {entityId}/{x,y,width,depth} mm, 아니면 floors·boxes 를 지정하세요.')

def _structure_edit_ready(args,allow_edit):
    if not allow_edit:raise ValueError(EDIT_MODE_ONLY)
    validate_target(args.get('target'))
    if not valid_revision(args.get('expectedRevision')) or args['expectedRevision']!=args['target']['revision']:raise ValueError('expectedRevision must equal target revision')

def _structure_apply(record,args):
    return dispatch('cad_structure_apply',{'record':record,'target':args['target'],'expectedRevision':args['expectedRevision']})

def _structure_call(name,args,allow_edit):
    import structure_service as ss
    if name in ('cad_structure_certificate','cad_structure_calc_report'):
        fmt=args.get('format','html' if name=='cad_structure_calc_report' else 'pdf')
        if name=='cad_structure_calc_report' and fmt!='html': raise ValueError('구조계산서 초안 format은 html이어야 합니다.')
        if fmt not in ('pdf','html'): raise ValueError('format은 pdf 또는 html이어야 합니다.')
        project=args.get('project',{})
        if not isinstance(project,dict): raise ValueError('project는 객체여야 합니다.')
        if len(project)>100 or any(not isinstance(k,str) or len(k)>64 for k in project): raise ValueError('project 키를 확인하세요.')
        for val in project.values():
            if type(val) not in (str,int,float,bool) or (type(val) is float and not math.isfinite(val)) or (isinstance(val,str) and len(val)>2000): raise ValueError('project 값은 scalar이며 문자열은 2000자 이하이어야 합니다.')
        record,in_drawing=_structure_record(args)
        if name=='cad_structure_certificate' and ss.si.preliminary((record.get('input') or {}).get('engine') or record['model'].get('p') or {}):
            return {'ok':False,'reason':'확인서는 1~2층 전용입니다. 3~5층은 cad_structure_calc_report를 사용하세요.','missing':[]}
        # 3~5층 서버 답은 원 입력 p 를 빼고 온다 — 기록의 엔진 입력으로 채우고 층수는 층 목록 수(괴정 4층이 p 없이 '지상 3~5층 전용' 으로 막혔다 2026-10-30)
        p=(record.get('model') or {}).get('p') or (record.get('input') or {}).get('engine')
        if isinstance(p,dict):
            record={**record,'model':{**record['model'],'p':{**p,'stories':ss.si.storeys(p)}}}
        out=dispatch(name,{'record':record,'project':project,**_structure_target(args)})
        if not out.get('ok',False): return out
        folder=(snapshot(args.get('editor_session')).get('folder') or None) if args.get('target') is not None else None
        if name=='cad_structure_calc_report': return ss.export_calc_report(out,record['id'],folder)
        return ss.export_certificate(out,record['id'],fmt,folder)
    if name=='cad_structure_generate':
        insert=args.get('insert',False)
        if type(insert) is not bool:raise ValueError('insert 는 true/false 입니다.')
        if insert:_structure_edit_ready(args,allow_edit)
        source_args=args
        if args.get('answerSetId'):
            previous,_=_structure_record({**args,'setId':args['answerSetId']})
            source_args={**previous['input']['engine'], 'outline':previous['input']['outline'], **args,
                         '_questions':previous.get('questions') or []}
        if 'boxes' in args:
            if not isinstance(args['boxes'],list) or not args['boxes'] or any(not isinstance(v,str) or not v for v in args['boxes']):
                raise ValueError('boxes 는 아래층부터 선택한 박스 객체 ID 배열입니다.')
            read=dispatch('cad_structure_read',{'boxes':args['boxes'],'options':args.get('readOptions',{}),
                                               'overrides':{k:v for k,v in args.items() if k in ('system','mode')},**_structure_target(args)})
            if not read.get('input'):raise ValueError('평면을 읽지 못했습니다: '+' / '.join(f.get('text','') for f in read.get('findings',[])))
            source_args={**read['input'],**source_args,'recognitionFindings':read.get('findings',[])}
        elif source_args.get('mode')!='design' and not any(k in source_args for k in ('floors','walls','columns')):
            outline=_structure_outline(source_args);options=copy.deepcopy(source_args.get('readOptions',{}))
            if not isinstance(options,dict):raise ValueError('readOptions는 층고·기준점 읽기 옵션 객체입니다.')
            height=source_args.get('storyHeight') if 'storyHeight' in source_args else source_args.get('H')
            if 'storyHeight' not in source_args and type(height) in (int,float) and height>ss.STORY_HEIGHT_MAX_M:
                raise ValueError(f'H 가 {height:g} 입니다. H 는 층고 m 입니다(3 m 이면 3, mm 로 주려면 storyHeight).')
            if type(height) in (int,float) and math.isfinite(height) and height>0:options.setdefault('heights',[height if 'storyHeight' in source_args else height*1000])
            read=dispatch('cad_structure_read',{'outline':outline,'options':options,'overrides':{'system':source_args.get('system','rc'),'mode':source_args.get('mode','check')},**_structure_target(args)})
            # 도면을 무시한 격자 배치로 조용히 넘어가지 않는다. 외곽 시안은 mode=design 을 명시하게 안내.
            if not read.get('input'):raise ValueError('평면을 읽지 못했습니다: '+' / '.join(f.get('text','') for f in read.get('findings',[]))+' (도면에 벽이 아직 없어 외곽만으로 시안을 원하면 mode=design 으로 다시 부르세요.)')
            floors=read['input'].get('floors');stories=source_args.get('stories',len(floors or []))
            if floors and len(floors)==1 and type(stories) is int and stories>1 and source_args.get('sameLayoutUpper') is True:
                # 사용자가 '위층도 1층과 같은 배치'라고 확인한 경우만 읽은 1층을 위층으로 복사한다.
                heights=options.get('heights') if isinstance(options.get('heights'),list) else []
                read['input']['floors']=floors+[_copied_upper_floor(floors[0],f'{i+1}층',heights[i]/1000 if i<len(heights) and type(heights[i]) in (int,float) and heights[i]>0 else None) for i in range(1,stories)]
            elif floors and stories!=len(floors):
                raise ValueError(f'층수가 읽은 평면과 다릅니다(도면에서 읽은 층 {len(floors)}개, 요청 {stories}층). 위층이 1층과 같은 배치라고 사용자가 확인했으면 sameLayoutUpper=true 로, 아니면 층별 boxes 또는 floors를 지정하세요.')
            source_args={**read['input'],**source_args,'mode':source_args.get('mode','check'),'recognitionFindings':read.get('findings',[])}
        outline=_structure_outline(source_args)
        engine=ss.engine_input(source_args,outline);scope=ss.out_of_scope(engine)
        # 3~5층은 서버의 KDS 41 경로. 6층 이상 또는 1~2층 40 m 초과만 여기서 중단.
        response={'model':{'system':engine['system'],'p':engine,'members':[]},'review':scope,'rulesVersion':None} if scope else ss.post({'action':'generate','input':engine})
        record=ss.record_from(response,args,outline,engine)
        if scope:record['outOfScope']=True
        out=ss.brief(record)
        if not insert or out['verdict']!='적합':
            ss.pending.put(record)
            out.update(inserted=False)
            if insert:out['refused']=out['verdict']+' — 검토가 완료되지 않아 도면에 넣지 않았습니다.'+(' 구조계산 필요.' if out['verdict']=='적용범위 밖' else '')
            return out
        drawing=_structure_drawing_allowed()
        bounds=ss.outline_bounds_mm(outline)
        if drawing:record['drawn']={'origin':{'x':bounds['x']+bounds['width']+10000,'y':bounds['y']},'sheets':['plan','foundation']}
        applied=_structure_apply(record,args)
        out.update(inserted=True,drawn=record.get('drawn'),added=applied.get('added'),revision=applied.get('revision'),warnings=applied.get('warnings',[]),preserved=applied.get('preserved',[]))
        if not drawing:out['drawingsPending']=STRUCTURE_APPROVAL
        return out
    if name=='cad_structure_review':
        record,in_doc=_structure_record(args)
        return {**ss.brief(record),'inDrawing':in_doc,'review':[{'group':f.get('grp'),'item':f.get('item'),'status':f.get('st'),'fix':f.get('fix'),'value':f.get('val'),'required':f.get('req'),'basis':f.get('ref'),'ids':f.get('ids',[])} for f in record.get('review') or []]}
    if name=='cad_structure_get':
        kind=args.get('kind')
        if kind is not None and kind not in ss.KINDS:raise ValueError('kind 는 '+'·'.join(ss.KINDS)+' 중 하나입니다.')
        record,in_doc=_structure_record(args)
        members=[m for m in record['model'].get('members',[]) if kind is None or m.get('kind')==kind]
        return {'setId':record['id'],'system':record.get('system'),'rulesVersion':record.get('rulesVersion'),'inDrawing':in_doc,'units':{'coordinates':'m','sizes':'mm','footing.B':'m','footing.D':'mm'},'count':len(members),'members':members[:500],'truncated':len(members)>500}
    if name=='cad_structure_set_member':
        _structure_edit_ready(args,allow_edit)
        record,in_doc=_structure_record(args)
        if record.get('outOfScope') or not (record.get('input') or {}).get('engine'):raise ValueError('범위 밖으로 만든 묶음은 부재를 고칠 수 없습니다. 조건을 바꿔 cad_structure_generate 로 다시 만드세요.')
        if ss.si.preliminary(record['input']['engine']):
            raise ValueError('3~5층 단면은 cad_structure_generate의 answerSetId·answers 또는 members 입력으로 확인 후 다시 검토하세요.')
        overrides=ss.merge_override(record.get('overrides'),args.get('code'),args.get('size'))
        # 서버가 원래 입력으로 다시 만들고 덮어쓰기를 적용해 다시 검토한다(고친 모델을 보내지 않는다)
        response=ss.post({'action':'generate','input':record['input']['engine'],'overrides':overrides})
        response['review']=response['review']+ss.column_update_findings(record['model'],response['model'],args['code'])
        updated=ss.record_from(response,record['input']['args'],record['input']['outline'],record['input']['engine'],record['id'])
        record.update(model=updated['model'],review=updated['review'],assessment=updated['assessment'],quantities=updated['quantities'],overrides=response.get('overrides') or overrides)
        out={**ss.brief(record),'inDrawing':in_doc,'changed':args['code']}
        if in_doc:
            applied=_structure_apply(record,args);out.update(revision=applied.get('revision'),redrawn=bool(record.get('drawn')),warnings=applied.get('warnings',[]),preserved=applied.get('preserved',[]))
        else:ss.pending.put(record)
        return out
    if name=='cad_structure_drawings':
        _structure_edit_ready(args,allow_edit)
        sheets=args.get('sheets',['plan','foundation'])
        if not isinstance(sheets,list) or not sheets or any(s not in ('plan','foundation','schedule','notes') for s in sheets):raise ValueError('sheets 는 plan·foundation·schedule·notes 중에서 고릅니다.')
        origin=args.get('origin')
        if origin is not None and not (isinstance(origin,dict) and set(origin)=={'x','y'} and all(type(origin[k]) in (int,float) and math.isfinite(origin[k]) for k in origin)):raise ValueError('origin 은 {x,y} mm 입니다.')
        record,in_doc=_structure_record(args)
        brief=ss.brief(record);state=brief['verdict']
        # 자료 부족은 '검토 초안' 도장을 찍어 그린다(대표 2026-10-30 '로그인이면 초안으로 그림' — 미리 도구는 로그인해야만 열린다). 부적합·적용범위 밖·미지원은 그리지 않는다
        if state not in ('적합','자료 부족'):raise ValueError(state+' 상태의 구조 묶음은 도면에 그리지 않습니다.'+(' 구조계산 필요.' if state=='적용범위 밖' else '')+' cad_structure_review 로 확인하세요.')
        outline=ss.outline_bounds_mm((record.get('input') or {}).get('outline') or {'x':0,'y':0,'width':0})
        record['drawn']={'origin':origin or {'x':outline['x']+outline['width']+10000,'y':outline['y']},'sheets':list(dict.fromkeys(sheets))}
        templates=_structure_sheet_templates()
        if templates:record['drawn']['templates']=templates
        if (((record.get('input') or {}).get('args') or {}).get('mode') or (record.get('input') or {}).get('mode'))=='design':record['drawn']['gridPrefix']='S'   # 외곽만 시안 축선은 SX1·SY1
        if state=='자료 부족':record['drawn']['draft']='검토 초안 · 구조계산 전 · 가정값 포함 · 후속 확인 '+str((brief.get('counts') or {}).get('hold',''))+'건 — 시공용 아님'
        if not _structure_drawing_allowed():
            preview=dispatch('cad_structure_preview',{'record':record,**_structure_target(args)})
            return {'status':'approval_required','message':STRUCTURE_APPROVAL,'setId':record['id'],'sheets':preview.get('sheets'),'count':preview.get('count'),'image':preview.get('image'),'inDrawing':in_doc}
        applied=_structure_apply(record,args)
        return {'status':'drawn','setId':record['id'],'sheets':applied.get('sheets'),'added':applied.get('added'),'removed':applied.get('removed'),'revision':applied.get('revision'),'warnings':applied.get('warnings',[]),'preserved':applied.get('preserved',[])}
    raise ValueError('알 수 없는 구조 도구')

def _field_records_call(name,args,allow_edit):
    updating=name=='cad_field_records_update'
    if updating:
        if not allow_edit:raise ValueError('대화/검토 모드에서는 기록을 바꿀 수 없습니다. 도면 실행 모드를 선택하세요.')
        validate_target(args.get('target'))
    path=args.get('path')
    if 'path' in args:
        if not isinstance(path,str) or not path or not Path(path).is_absolute() or Path(path).suffix.lower() not in DRAWING_SUFFIXES:
            raise ValueError('저장한 도면의 전체 경로를 주세요.')
        from field_records import folder_for
        if folder_for({'drawingPath':path})['fallback']:raise ValueError('저장한 도면의 전체 경로를 주세요.')
    current=path is None or name=='cad_field_records_locate' or args.get('target') is not None or 'editor_session' in args
    client=None;identity=None;target=None;authorization_deadline=None
    with lock:
        if current:
            target=args.get('target')
            client=(target or {}).get('editor_session') or args.get('editor_session') or _default_editor()
            if 'editor_session' in args and not valid_uuid(args['editor_session']):raise ValueError('도면 창을 다시 선택하세요.')
            if target is not None:
                if args.get('editor_session',client)!=client:raise ValueError('도면 창이 서로 다릅니다.')
                state=_bound_state_locked(target,allow_omitted=True)
            else:
                state=_state_locked(client,allow_omitted=True)
            context={key:state.get(key,'') for key in ('drawingPath','drawingName','draftKey')}
            identity=(state.get('document_generation'),context['drawingPath'],context['draftKey'])
            if path is not None and _path_key(path)!=_path_key(context['drawingPath']):
                raise ValueError('지금 열린 도면과 경로가 다릅니다. 해당 도면을 열고 다시 요청하세요.')
            if name=='cad_field_records_locate' and target is None:target=_target_locked(client,state)
        else:context={'drawingPath':path,'drawingName':Path(path).stem}
    def assert_current():
        assert_app_active()
        if authorization_deadline is not None and time.monotonic()>=authorization_deadline:
            raise ValueError('현장 기록 변경 요청이 만료되었습니다. 다시 요청하세요.')
        if client is not None:
            with lock:
                state=_state_locked(client,allow_omitted=True)
                if identity!=(state.get('document_generation'),state.get('drawingPath',''),state.get('draftKey','')):
                    raise ValueError('기록을 읽는 동안 도면이 바뀌었습니다. 다시 요청하세요.')
                if args.get('target') is not None:_bound_state_locked(args['target'],allow_omitted=True)
    assert_current()
    if updating:
        # 장부 수정은 도면 revision을 올리지 않지만 같은 화면의 승인과 정확한 target은 필요하다.
        authorization_deadline=time.monotonic()+dispatch_timeout('cad_field_records_authorize',{'target':target})
        authorization=dispatch('cad_field_records_authorize',{'target':target})
        if not isinstance(authorization,dict) or authorization.get('authorized') is not True or authorization.get('applied') is not False:
            raise ValueError('도면 창에서 현장 기록 변경을 확인하지 못했습니다. 다시 요청하세요.')
        assert_current()
    from field_records_ai import call as records_call
    result=records_call(name,args,context,assert_current=assert_current)
    if not updating:assert_current()
    if name=='cad_field_records_locate':
        return dispatch(name,{'target':target,'record':result['record'],'drawingPath':context['drawingPath']})
    return {**result,'drawingPath':context['drawingPath']}


def call(name,args,allow_edit=True):
    return _invoke_tool(name,args,allow_edit)

@contextmanager
def save_transaction(args):
    previous=getattr(APP_CONTEXT,'save_transaction',None)
    if previous is not None:
        yield previous
        return
    import project,safe_writes
    target=args.get('target');validate_target(target)
    dest=project.target(args.get('folder',''),args.get('name',''))
    with safe_writes.reserve(dest,assert_current=assert_app_active) as transaction:
        with lock:current=_bound_state_locked(target).get('drawingPath','')
        if transaction.existed and _path_key(str(dest))!=_path_key(current):
            # 사용자가 CAD 창에서 답할 때까지 막힌다: 진행 중 작업 조회(cad_get_job)에 그 사실을 싣는다.
            job=getattr(APP_CONTEXT,'job_record',None)
            if job is not None:job['waiting']={'kind':'cad_window_confirmation','path':str(dest)}
            try:approved=dispatch('cad_confirm_write',{'target':target,'path':str(dest)})
            finally:
                if job is not None:job.pop('waiting',None)
                _tool_stage('running')
            if approved.get('confirmed') is not True:raise ValueError('덮어쓰기를 취소했습니다.')
        transaction.assert_unchanged();APP_CONTEXT.save_transaction=transaction
        try:yield transaction
        finally:APP_CONTEXT.save_transaction=previous

def save_new_export(path,raw,requested,folder,stem):
    import safe_writes
    suffix=path.suffix;index=0
    while True:
        try:
            with safe_writes.reserve(path,assert_current=assert_app_active) as transaction:
                if transaction.existed:raise FileExistsError(str(path))
                transaction.save(raw)
            return path
        except (FileExistsError,safe_writes.SaveBusy):
            if requested:raise ValueError('파일이 이미 있거나 다른 저장이 사용 중입니다. 다른 경로를 주세요.')
            index+=1;path=folder/(stem+f'-{index}'+suffix)

def _layer_names(args):
    """대상 도면의 레이어 ID→이름(리습 먼저 판정용). 큰 도면처럼 본문이 없으면 빈 표."""
    session=(args.get('target') or {}).get('editor_session') if isinstance(args.get('target'),dict) else None
    with lock:document=(clients.get(session or active) or {}).get('document') or {}
    return {l['id']:l['name'] for l in document.get('layers') or [] if isinstance(l,dict) and isinstance(l.get('id'),str) and isinstance(l.get('name'),str)}

def _enforce_generator_first(args):
    check=args.get('generator_check')
    if 'generator_check' in args:
        if (not isinstance(check,dict) or set(check)!={'reason'} or not isinstance(check['reason'],str)
            or not 1<=len(check['reason'].strip())<=1000):raise ValueError('generator_check는 사용자가 벽을 직접 그리라고 한 이유를 {reason: "이유"}로 적으세요(1~1000자).')
    if str(args.get('name','')).strip().upper() not in ('WALDRAW','WAL'):return
    with lock:
        state=_bound_state_locked(args['target']);document=state['document']
        has_entities=bool(document.get('entities'))
    if has_entities or check:return
    model={'stories':[{'id':'s1','name':'1층','elevation':0,'height':2800}],
           'elements':[{'id':'w1','kind':'wall','story':'s1','path':[[0,0],[6000,0]],'thickness':200}]}
    raise CADToolError('새 도면은 벽을 하나씩 그리지 말고 설계 JSON(model)을 만들어 cad_generate_drawing(kind="plan", model=model, story="s1", origin={"x":0,"y":0})으로 그리세요. '
                       '짧은 model 예시: '+json.dumps(model,ensure_ascii=False)+'. 사용자가 정말 벽을 직접 그리라고 요청했다면 generator_check:{reason:"사용자 요청 이유"}를 붙이세요.',
                       {'code':'generator_first','model':model})

def _call(name,args,allow_edit=True,*,mcp=True):
    from miri_account_service import require_ai_login
    require_ai_login()
    if any(t['name']==name and t.get('app_only') for t in TOOLS):raise ValueError('앱 안 AI 전용 도구입니다.')
    if not isinstance(args,dict):raise ValueError('CAD arguments must be an object')
    name=BOUND_ALIASES.get(name,name)
    if name in FIELD_RECORD_TOOLS:return _field_records_call(name,args,allow_edit)
    if name in STRUCTURE_TOOLS:return _structure_call(name,args,allow_edit)
    if name=='cad_suggest_details':
        return dispatch(name,args)
    if name=='cad_search_details' and args.get('source')=='library':
        from detail_search_library import search_library_details
        return search_library_details(args.get('query',''), args.get('classification',args.get('분류','')), args.get('facility',args.get('시설','')))
    if name=='cad_get_detail' and args.get('source')=='library':
        from detail_search_library import get_library_detail
        return get_library_detail(args.get('id'), include_geometry=args.get('include_geometry',False))
    if name in ('cad_search_units','cad_get_unit'):
        import detail_search_library as ul
        if name=='cad_search_units': return page_rows(ul.search_units(args),args,('units','details'))
        return ul.get_unit(args.get('id'), args.get('include_geometry',False))
    if name in ('cad_search_jutong','cad_get_jutong'):
        import detail_search_library as jl
        if name=='cad_search_jutong': return page_rows(jl.search_jutong(args),args,('details',))
        return jl.get_jutong(args.get('id'), args.get('include_geometry',False))
    classification=args.get('classification',args.get('분류',''))
    if name=='cad_search_details' and isinstance(classification,str) and classification.partition('/')[0]=='단위세대':
        import detail_search_library as ul
        result=ul.search_units(args)
        area_group=classification.partition('/')[2].strip()
        if area_group and result.get('status')=='ok':
            matched=re.fullmatch(r'(\d+(?:\.\d+)?)\s*(?:㎡|m2|m²)?',area_group)
            if matched:
                lower=float(matched.group(1))
                rows=[row for row in result['units'] if type(row.get('exclusive_area_m2')) in (int,float) and lower<=row['exclusive_area_m2']<lower+1]
            else:
                rows=[row for row in result['units'] if (row.get('classification') or {}).get('second_name')==area_group]
            result={**result,'count':len(rows),'units':rows,'details':rows}
        return result
    if name=='cad_search_details' and isinstance(classification,str) and classification.partition('/')[0]=='주동':
        import detail_search_library as jl
        filters=dict(args)
        suffix=classification.partition('/')[2].strip()
        if suffix:
            # Old saved detail searches used a form here; current catalogs group by combination.
            field='form' if suffix.startswith(('판상','타워','혼합','테라스','ㄱ','ㄷ','ㅁ','+','Y')) else 'combination'
            filters[field]=suffix
        return jl.search_jutong(filters)
    if name=='cad_get_detail' and str(args.get('id','')).startswith('UN-'):
        import detail_search_library as ul
        return ul.get_unit(args.get('id'),args.get('include_geometry',False))
    if name=='cad_get_detail' and str(args.get('id','')).startswith('JT-'):
        import detail_search_library as jl
        return jl.get_jutong(args.get('id'),args.get('include_geometry',False))
    if name=='cad_insert_detail' and args.get('source')!='library' and str(args.get('id','')).startswith('UN-'):
        return call('cad_insert_unit',args,allow_edit)
    if name=='cad_insert_detail' and args.get('source')!='library' and str(args.get('id','')).startswith('JT-'):
        return call('cad_insert_jutong',args,allow_edit)
    if name in ('cad_search_details','cad_get_detail'):
        import detail_search_library as details
        if name=='cad_search_details':
            return details.search_library_details(args.get('query',''), args.get('classification',args.get('분류','')), args.get('facility',args.get('시설','')))
        return details.get_library_detail(args.get('id'), include_geometry=args.get('include_geometry',False))
    if name=='cad_insert_unit':
        if not allow_edit: raise ValueError('현재 채팅은 대화/검토 모드입니다. 도면 실행 모드를 선택하세요.')
        validate_target(args.get('target')); import detail_search_library as ul
        detail=ul.get_unit(args.get('id'), True)
        if detail.get('status')!='ok': return detail
        args={**args,'detail':{**(detail.get('unit') or {}),'geometry':detail.get('geometry')}}
        return dispatch(name,args)
    if name=='cad_insert_jutong':
        if not allow_edit: raise ValueError('현재 채팅은 대화/검토 모드입니다. 도면 실행 모드를 선택하세요.')
        validate_target(args.get('target'))
        import detail_search_library as jl
        detail=jl.get_jutong(args.get('id'), True)
        if detail.get('status')!='ok': return detail
        args={**args,'detail':{**(detail.get('detail') or {}),'geometry':detail.get('geometry')}}
        return dispatch(name,args)
    if name=='cad_insert_detail':
        if not allow_edit: raise ValueError('현재 채팅은 대화/검토 모드입니다. 도면 실행 모드를 선택하세요.')
        validate_target(args.get('target'))
        from detail_search_library import get_library_detail
        detail=get_library_detail(args.get('id'), include_geometry=True)
        if detail.get('status')!='ok': return detail
        if detail.get('detail',{}).get('insertion_allowed') is False or detail.get('detail',{}).get('assignment',{}).get('requires_review'):
            message='구판 철골 참고 자료입니다. 구조기술사 검토와 상세의 실치수·경계 확인이 필요합니다.' if detail.get('detail',{}).get('source')=='steel' else '2025 상세의 번호·분리·실제 치수 검토가 필요합니다.'
            return {'status':'unavailable','message':message,'detail':detail.get('detail')}
        args={**args,'detail':{**(detail.get('detail') or {}),'geometry':detail.get('geometry')}}
        return dispatch(name,args)
    if name in ('cad_search_classified_drawings','cad_get_classified_drawing'):
        import classified_drawing_service as classified
        # 설치판에는 인덱스가 실리지 않아 늘 '아직 없습니다' 오류였다(사용자가 뭘 빠뜨린 것처럼 들림). 오류 대신 '이 판에 없음'으로 답한다.
        if not classified.available():return dict(classified.UNAVAILABLE)
        return classified.search(args) if name=='cad_search_classified_drawings' else classified.detail(args)
    if name in ('cad_list_commands','cad_get_command'):
        import command_library
        return command_library.search(args) if name=='cad_list_commands' else command_library.get(args)
    if name=='cad_get_drawing_standard':
        return drawing_standard_bundle(args)
    if name=='cad_get_layer_usage':
        import command_library
        return command_library.layer_usage()
    if name=='cad_get_drawing_knowledge':
        import drawing_knowledge
        return drawing_knowledge.observed_rules(args.get('classes'))
    if name=='cad_evaluate_drawing_evidence':
        import drawing_knowledge
        return drawing_knowledge.evaluate(args.get('facts',{}))
    if name in ('cad_search_design_cases','cad_get_design_case','cad_design_reference'):
        import design_case_service as cases
        if name=='cad_search_design_cases':return cases.search(args)
        if name=='cad_design_reference':return {'document':cases.reference_document(args.get('id'),args.get('mmPerPixel'))}
        result=cases.detail(args.get('id'));result.pop('annotations',None);return result
    if name in ('cad_search_address','cad_get_parcel'):
        import parcel_service
        context_key=_parcel_context_key(args)
        value=parcel_service.search(args.get('query','')) if name=='cad_search_address' else parcel_service.fetch(args)
        return _remember_parcel(name,args,value,context_key)
    if name=='cad_site_plan_from_drawing':return _site_plan_from_drawing(args)
    if name=='cad_place_from_site_plan':return _place_from_site_plan(args)
    if name=='cad_apartment_review':return _apartment_review(args)
    if name=='cad_suggest_layout':return _suggest_layout(args)
    if name=='cad_validate_layout':return _validate_layout(args)
    if name=='cad_sunlight_report':return _sunlight_report(args)
    if name=='cad_open_file':return open_file(args)
    if name=='cad_close_document':return close_document(args)
    if name=='cad_get_document':
        include=args.get('include_command_settings',False)
        if type(include) is not bool:raise ValueError('include_command_settings 는 true/false 입니다.')
        value=get_document(args)
        if not include and isinstance(value,dict):value.pop('commandSettings',None)
        return value
    if name=='cad_observation_head':return observation_head(args.get('editor_session'))
    if name=='cad_list_details':
        from detail_search_library import search_library_details
        result=search_library_details(classification=args.get('group') or '')
        result['details']=[item for item in result['details'] if item.get('kind')=='detail']
        result['count']=len(result['details'])
        result['groups']=sorted({item['group'] for item in result['details']})
        return result
    if name=='cad_get_drawing_sets':
        sets=snapshot(args.get('editor_session'))['document'].get('drawingSets') or {}
        if args.get('setId') is not None:sets={k:v for k,v in sets.items() if k==args['setId']}
        # 묶음마다 설계 JSON 전체를 붙이면 결과가 AI 한도(수만 토큰)를 넘어 못 읽었다(10/21 기록). 묶음이 여럿이면 기본은 목록만.
        keep=args.get('include_model',len(sets)<=1)
        out={'sets':[{'setId':k,**{f:v for f,v in r.items() if keep or f!='model'}} for k,r in sets.items()]}
        if not keep and len(sets)>1:out['hint']='설계 JSON(model)은 setId 와 include_model=true 로 한 묶음씩 읽으세요.'
        return out
    if name=='cad_get_pad_sketch':
        if 'sketch_id' in args and (not isinstance(args['sketch_id'],str) or not args['sketch_id']):raise ValueError('sketch_id는 목록의 ID를 쓰세요.')
        if 'include_image' in args and not isinstance(args['include_image'],bool):raise ValueError('include_image는 boolean이어야 합니다.')
        if 'size' in args and (type(args['size']) is not int or not 256<=args['size']<=2048):raise ValueError('size는 256~2048 정수여야 합니다.')
        return dispatch(name,args)
    if name in MUTATING_TOOLS:
        if not allow_edit:raise ValueError('현재 채팅은 대화/검토 모드입니다. 도면 실행 모드를 선택하세요.')
        validate_target(args.get('target'))
    if name=='cad_insert_image':
        import image_service
        image_service.validate_image_path(args.get('path'))
        if not isinstance(args.get('position'),dict) or set(args['position'])!= {'x','y'} or any(type(v) not in (int,float) or not math.isfinite(v) for v in args['position'].values()): raise ValueError('position은 유한한 x·y 좌표여야 합니다.')
        if args.get('width') is None and args.get('pxToMm') is None and not args.get('align'): raise ValueError('width 또는 pxToMm가 필요합니다.')
    if name in ('cad_set_floor_heights','cad_set_model3d','cad_push_pull','cad_set_materials','cad_delivery_fix'):
        with lock:_bound_state_locked(args['target'])
        if not valid_revision(args.get('expectedRevision')) or args['expectedRevision']!=args['target']['revision']:raise ValueError('expectedRevision must equal target revision')
    if name in ('cad_preview','cad_execute','cad_lisp_run','cad_lisp_load'):
        for key in ('layer','purpose'):
            if key in args and (not isinstance(args[key],str) or not args[key].strip() or len(args[key])>200):raise ValueError(key+'는 비어 있지 않은 200자 이하 문자열이어야 합니다.')
    if name=='cad_run_command':
        if mcp:_enforce_generator_first(args)
        args={k:v for k,v in args.items() if k!='generator_check'}
    if name in ('cad_execute','cad_lisp_load'):
        # 리습 먼저: 라이브러리 명령으로 그릴 수 있는 건축 요소는 써 본 기록과 이유 없이는 기본 도형·AI 리습으로 안 그린다.
        library_first.enforce(name,args,_layer_names(args))
        args={k:v for k,v in args.items() if k!='library_check'}
    if name=='cad_preview':
        hint=library_first.preview_hint(args,_layer_names(args))
        if hint:
            result=dispatch(name,args)
            if isinstance(result,dict):result={**result,'library_first':hint}
            return result
    if name in ('cad_lisp_run','cad_lisp_load'):
        with lock:_bound_state_locked(args['target'])
        if not valid_revision(args.get('expectedRevision')) or args['expectedRevision']!=args['target']['revision']:raise ValueError('expectedRevision must equal target revision')
        command=args.get('command')
        if name=='cad_lisp_run' or command is not None:
            if not isinstance(command,str) or not command.strip() or len(command)>100 or re.search(r"""[\s()\[\]"';\\]""",command):raise ValueError('리습 명령 이름(command)을 확인하세요.')
        if name=='cad_lisp_load':
            source=args.get('source')
            if not isinstance(source,str) or not source.strip() or len(source.encode('utf8'))>200000:raise ValueError('source는 200KB 이하 AutoLISP 문자열이어야 합니다.')
        selection=args.get('selection')
        if selection is not None and (not isinstance(selection,list) or any(not isinstance(i,str) for i in selection)):raise ValueError('selection은 객체 ID 배열이어야 합니다.')
        values=args.get('inputs',[])
        if not isinstance(values,list) or len(values)>1000:raise ValueError('inputs는 1000개 이하의 배열이어야 합니다.')
        for value in values:
            if isinstance(value,str) and len(value)<=4000:continue
            if type(value) in (int,float) and math.isfinite(value):continue
            if isinstance(value,list) and 2<=len(value)<=3 and all(type(v) in (int,float) and math.isfinite(v) for v in value):continue
            raise ValueError('inputs는 문자열·유한 숫자·좌표 배열만 받습니다.')
        limit=args.get('timeout_ms',5000)
        if type(limit) is not int or not 100<=limit<=10000:raise ValueError('timeout_ms는 100~10000 정수입니다.')
        return dispatch(name,args)
    if name=='cad_set_floor_heights':
        table=args.get('floorHeights')
        if not isinstance(table,dict) or any(not isinstance(k,str) or not re.fullmatch(r'[1-9]\d*F',k) or int(k[:-1])>9007199254740991 or type(v) not in (int,float) or not math.isfinite(v) or not 0<v<=100000 for k,v in table.items()):raise ValueError('층 이름은 nF, 높이는 0~100000 mm 안의 양수여야 합니다.')
    if name=='cad_set_model3d':
        ids=args.get('ids');changes=args.get('changes')
        if not isinstance(ids,list) or not ids or any(not isinstance(i,str) for i in ids):raise ValueError('부재 ID가 필요합니다.')
        if not isinstance(changes,dict) or not changes or set(changes)-{'height','elevation','kind','roofRise','color'}:raise ValueError('3D 부재 속성이 잘못되었습니다.')
        for key in ('height','elevation','roofRise'):
            if key in changes and (type(changes[key]) not in (int,float) or not math.isfinite(changes[key])):raise ValueError('3D 부재 값은 유한한 숫자여야 합니다.')
        if 'height' in changes and not 0<changes['height']<=100000 or 'roofRise' in changes and changes['roofRise']<0:raise ValueError('3D 부재 높이 오류')
        if 'kind' in changes and changes['kind'] not in ('solid','slab','roof') or 'color' in changes and (not isinstance(changes['color'],str) or not re.fullmatch(r'#[\da-fA-F]{6}',changes['color'])):raise ValueError('3D 부재 형태·색상 오류')
    if name in ('cad_view_3d','cad_export_glb') and 'setId' in args:
        if not isinstance(args['setId'],str) or not args['setId']:raise ValueError('setId는 도면 묶음 ID여야 합니다.')
    if name=='cad_push_pull':
        with lock:sets=(_bound_state_locked(args['target'])['document'].get('drawingSets') or {})
        if not isinstance(args.get('setId'),str) or args['setId'] not in sets:raise ValueError('도면 묶음이 없습니다. cad_get_drawing_sets로 확인하세요.')
        element=args.get('element')
        if not isinstance(element,dict) or set(element)!={'type','id'} or element['type'] not in ('story','wall') or not isinstance(element['id'],str) or not element['id']:raise ValueError('element는 type(story|wall)와 id가 필요합니다.')
        if type(args.get('distance')) not in (int,float) or not math.isfinite(args['distance']):raise ValueError('distance는 유한한 mm 숫자여야 합니다.')
        import vault_gate
        standard=json.loads(vault_gate.knowledge('drawing-standard.json').decode('utf-8'));assemblies=json.loads(vault_gate.knowledge('drawing-assemblies.json').decode('utf-8'))
        args={**args,'request':{'standard':standard,'assemblies':assemblies}}
    if name=='cad_view_3d':
        if args.get('view','iso-se') not in ('iso-ne','iso-nw','iso-se','iso-sw','top','front','back','left','right'):raise ValueError('지원하지 않는 3D 보기입니다.')
        if type(args.get('size',900)) is not int or not 256<=args.get('size',900)<=1600:raise ValueError('3D 크기는 256~1600 정수여야 합니다.')
        if 'floors' in args and (not isinstance(args['floors'],list) or any(not isinstance(f,str) or not re.fullmatch(r'[1-9]\d*F',f) for f in args['floors'])):raise ValueError('floors에는 nF 층 이름 목록을 주세요.')
    if name=='cad_export_glb':
        with lock:
            target=args.get('target')
            if target is None:target=_target_locked(active,_state_locked(active))
            state=_bound_state_locked(target)
            drawing=Path(state.get('drawingPath') or '')
            folder=drawing.parent if drawing.is_absolute() else Path(state.get('folder') or Path.home()/'Documents')
            stem=drawing.stem if drawing.is_absolute() else re.sub(r'[<>:"/\\|?*\x00-\x1f]','_',str(state.get('drawingName') or 'barun-cad'))
            args={**args,'target':copy.deepcopy(target)}
        requested=args.get('path')
        if requested is not None and (not isinstance(requested,str) or not requested.strip()):raise ValueError('GLB path must be an absolute .glb path')
        path=Path(requested) if requested else folder/(stem+'.glb')
        if not path.is_absolute() or path.suffix.lower()!='.glb':raise ValueError('GLB path must be an absolute .glb path')
        if requested and path.exists():raise ValueError('GLB 파일이 이미 있습니다. 다른 경로를 주세요.')
        response=dispatch(name,args)
        try:raw=base64.b64decode(response['data'],validate=True)
        except (ValueError,KeyError,TypeError) as error:raise ValueError('Invalid GLB binary response') from error
        if len(raw)<20 or raw[:4]!=b'glTF' or struct.unpack_from('<II',raw,4)!=(2,len(raw)):raise ValueError('Invalid GLB header or byte size')
        assert_app_active()
        path.parent.mkdir(parents=True,exist_ok=True)
        path=save_new_export(path,raw,requested,folder,stem)
        return {**{k:v for k,v in response.items() if k not in ('data','mimeType','size')},'path':str(path.resolve()),'size':len(raw)}
    if name in ('cad_sun_study','cad_view_interior','cad_wind_check','cad_delivery_check','cad_delivery_fix','cad_set_materials'):
        if 'size' in args and (type(args['size']) is not int or not 256<=args['size']<=1600):raise ValueError('size 는 256~1600 정수입니다.')
        if 'time' in args and (not isinstance(args['time'],str) or not re.fullmatch(r'([01]\d|2[0-3]):[0-5]\d',args['time'])):raise ValueError('time 은 00:00~23:59 입니다.')
        if name=='cad_delivery_fix' and (not isinstance(args.get('keys'),list) or not args['keys'] or any(k not in ('audit','overkill','angle','ends') for k in args['keys'])):raise ValueError('keys 는 audit·overkill·angle·ends 배열입니다.')
        if name=='cad_set_materials':
            if 'materials' in args and (not isinstance(args['materials'],dict) or any(not isinstance(k,str) or not (v is None or isinstance(v,str)) for k,v in args['materials'].items())):raise ValueError('materials 는 {부재 종류: 재료 ID 또는 null} 입니다.')
            if 'ids' in args and (not isinstance(args['ids'],list) or not args['ids'] or any(not isinstance(i,str) for i in args['ids'])):raise ValueError('ids 는 객체 ID 문자열 배열입니다.')
            if 'materials' not in args and 'ids' not in args:raise ValueError('materials 또는 ids+material 을 주세요.')
        if name=='cad_view_interior':
            for key,lo,hi in (('x',-1e9,1e9),('y',-1e9,1e9),('fov',30,100),('pitch',-60,60)):
                if key in args and (type(args[key]) not in (int,float) or not math.isfinite(args[key]) or not lo<=args[key]<=hi):raise ValueError(f'{key} 값을 확인하세요.')
    if name=='cad_plot_pdf':
        with lock:
            target=args.get('target')
            if target is None:target=_target_locked(active,_state_locked(active))
            state=_bound_state_locked(target)
            drawing=Path(state.get('drawingPath') or '')
            folder=drawing.parent if drawing.is_absolute() else Path(state.get('folder') or Path.home()/'Documents')
            stem=drawing.stem if drawing.is_absolute() else re.sub(r'[<>:"/\\|?*\x00-\x1f]','_',str(state.get('drawingName') or 'barun-cad'))
            args={**args,'target':copy.deepcopy(target)}
        requested=args.get('path')
        if requested is not None and (not isinstance(requested,str) or not requested.strip()):raise ValueError('PDF path must be an absolute .pdf path')
        tile=args.get('tile')
        path=Path(requested) if requested else folder/(stem+(f"_{tile['paper']}나눠찍기" if tile else '_plot')+'.pdf')
        if not path.is_absolute() or path.suffix.lower()!='.pdf':raise ValueError('PDF path must be an absolute .pdf path')
        path=Path(on_disk_path(str(path.parent)))/path.name   # NAS 폴더 이름 꼴(NFD) 맞춤
        if requested and path.exists():raise ValueError('PDF 파일이 이미 있습니다. 다른 경로를 주세요.')
        base_stem=path.stem   # 이름이 겹치면 이 이름 뒤에 -1, -2 …
        response=dispatch(name,args)
        job=response.get('job')
        if not isinstance(job,dict) or job.get('action')!='plot':raise ValueError('출력 작업을 만들지 못했습니다.')
        import pdf_service
        raw=base64.b64decode(pdf_service.process(job)['data'])
        if not raw.startswith(b'%PDF'):raise ValueError('PDF 생성 실패')
        assert_app_active()
        path.parent.mkdir(parents=True,exist_ok=True)
        path=save_new_export(path,raw,requested,folder,base_stem)
        return {**{k:v for k,v in response.items() if k!='job'},'path':str(path.resolve()),'size':len(raw),'pages':raw.count(b'/Type /Page')-raw.count(b'/Type /Pages')}
    if name=='cad_extension_review':
        args,filled=_extension_from_ledger(args)
        if filled:return {**dispatch(name,args),'autoFilled':filled}
    if name=='cad_apply_openings':
        expected=args.get('expectedRevision')
        if type(expected) is not int or expected<0 or expected!=args['target']['revision']:raise ValueError('expectedRevision is required and must match the target')
        with lock:_bound_state_locked(args['target'])
    if name in ('cad_generate_drawing','cad_generate_details','cad_access_plan'):
        is_access=name=='cad_access_plan' or args.get('kind')=='access-plan'
        is_details=name=='cad_generate_details' or args.get('kind')=='details'
        with lock:_bound_state_locked(args['target'])
        with lock:sets=(_bound_state_locked(args['target'])['document'].get('drawingSets') or {})
        set_id=args.get('setId')
        if set_id is not None and (not isinstance(set_id,str) or set_id not in sets):raise ValueError(f'도면 묶음 "{set_id}" 이 이 도면에 없습니다. cad_get_drawing_sets 로 확인하세요.')
        model=args.get('model')
        if is_access:
            if set_id is not None and sets[set_id].get('kind')!='access-plan':raise ValueError(f"이 setId 는 편의시설 계획도가 아니라 '{sets[set_id].get('kind')}' 묶음입니다. 새로 만들려면 setId 를 빼고, 다시 그리려면 cad_get_drawing_sets 에서 kind=access-plan 인 setId 를 주세요.")
            if set_id is None or 'facility' in args:
                import access_context,vault_gate
                knowledge=vault_gate.detail_groups(only={'access'}).get('access') or {}
                with lock:document=copy.deepcopy(_bound_state_locked(args['target'])['document'])
                access_info=access_context.prepare(document,args,knowledge)
                if access_info['needs']:return access_info
                args={**args,'facility':access_info['facility']}
            validate_access_request(args, new=set_id is None)
        # model/setId를 생략하면 화면의 기존 평면 인식기(planToModel)가 현재 도면을 읽는다.
        if model is not None:
            if not isinstance(model,dict) or not isinstance(model.get('stories'),list) or not isinstance(model.get('elements'),list):raise ValueError('model 은 공통 건물 모델(stories·elements)이어야 합니다.')
            if len(json.dumps(model))>20_000_000:raise ValueError('model 이 너무 큽니다(20 MB 이하).')
        import vault_gate
        standard=json.loads(vault_gate.knowledge('drawing-standard.json').decode('utf-8'));assemblies=json.loads(vault_gate.knowledge('drawing-assemblies.json').decode('utf-8'))
        details=vault_gate.detail_groups(only={'access'}) if is_access else vault_gate.detail_groups()
        if is_details:
            ids=args.get('ids');group=args.get('group')
            if ids is not None and (not isinstance(ids,list) or not ids or any(not isinstance(i,str) or not i for i in ids) or len(set(ids))!=len(ids)):raise ValueError('ids는 중복 없는 상세 번호 배열이어야 합니다.')
            if ids is not None and group is not None:raise ValueError('ids 또는 group 중 하나만 지정하세요.')
            if group is not None and group not in ('basic',*details):raise ValueError('상세 공종이 없습니다: '+str(group))
            if ids is None and group is None and set_id is None:raise ValueError('ids 또는 group 또는 setId가 필요합니다.')
            if set_id is not None and sets[set_id].get('kind')!='details':raise ValueError('상세 도면 묶음의 setId를 주세요.')
            origin=args.get('origin')
            if origin is not None and (not isinstance(origin,dict) or set(origin)!={'x','y'} or any(type(v) not in (int,float) or not math.isfinite(v) for v in origin.values())):raise ValueError('origin은 유한한 x·y 좌표여야 합니다.')
            if ids is not None or group is not None:
                # 재생성 선택 방식을 바꾸면 예전 ids/group 이 남지 않도록 명시적으로 비웁니다.
                args={**args,'ids':ids,'group':group}
            args={**args,'kind':'details'}
            name='cad_generate_drawing'
        request={k:args[k] for k in ('setId','model','kind','story','wallId','at','origin','scale','title','ids','group','facility','overlay','sectionAt','face','occt','planOptions','sheets') if k in args}
        if is_access:request['kind']='access-plan'
        args={**args,'request':{**request,'standard':standard,'assemblies':assemblies,'details':details}}
        if is_access and 'access_info' in locals():
            out=dispatch(name,args)
            return {**out,**{key:access_info[key] for key in ('autoFilled','assumed','needs')}}
    if name=='cad_insert_layout':
        with lock:_bound_state_locked(args['target'])
        result=_get_layout(args.get('layout_id'))
        args={**args,'request':copy.deepcopy(result['input']),'result':result}
    if name=='cad_save':
        import exchange,project
        target=copy.deepcopy(args['target'])
        with lock:document=copy.deepcopy(_bound_state_locked(target)['document'])
        suffix=Path(args['name']).suffix.lower()
        # 화면 저장은 DWG 도 되는데 AI 저장만 '저장 파일은 DXF여야 합니다'로 거절했다(10/16 기록). 화면 저장과 같은 변환기를 쓴다.
        if suffix not in ('.dxf','.dwg'):raise ValueError('저장 파일은 .dxf 또는 .dwg 여야 합니다.')
        with save_transaction(args) as transaction:
            raw,warnings=exchange.export_dxf(document)
            if suffix=='.dwg':
                from batch_converter import dxf_to_dwg
                raw,dwg=dxf_to_dwg(raw,str(args.get('dwgVersion','2018')))
                warnings=[*warnings,*dwg.get('warnings',[])]
            assert_app_active()
            saved=project.save(args['folder'],args['name'],raw,transaction=transaction,assert_current=assert_app_active)
        try:
            acknowledged=dispatch('cad_save_complete',{'target':target,'path':saved['path']})
        except (ValueError,TimeoutError) as error:
            # The snapshot is on disk, but a changed/closed editor must remain dirty.
            acknowledged={'saved':True,'state_updated':False,'message':'파일은 저장했지만 현재 도면의 저장 상태를 갱신하지 못했습니다. '+str(error),'applied':False}
        return {**saved,'warnings':warnings,'target':target,
                'before_revision':target['revision'],'after_revision':target['revision'],'revision':target['revision'],
                'state_updated':not bool(acknowledged.get('error')),**acknowledged}
    if name not in [t['name'] for t in TOOLS]:raise ValueError('지원하지 않는 CAD 도구')
    return dispatch(name,args)


def call_app(name,args,allow_edit=False,*,request_epoch=None,request_origin=None,cancelled=None,login_epoch=None):
    previous=(getattr(APP_CONTEXT,'epoch',None),getattr(APP_CONTEXT,'cancelled',None),getattr(APP_CONTEXT,'origin',None),getattr(APP_CONTEXT,'login_epoch',None))
    APP_CONTEXT.epoch=request_epoch;APP_CONTEXT.cancelled=cancelled;APP_CONTEXT.origin=request_origin;APP_CONTEXT.login_epoch=login_epoch
    try:
        if cancelled and cancelled():raise ValueError('AI 요청을 중지했습니다.')
        return _invoke_tool(name,args,allow_edit,app=True)
    finally:APP_CONTEXT.epoch,APP_CONTEXT.cancelled,APP_CONTEXT.origin,APP_CONTEXT.login_epoch=previous

def _call_app(name,args,allow_edit=False):
    """앱 채팅 전용 입구. MCP보다 넓되 CAD 밖 실행/삭제 도구는 없다."""
    from miri_account_service import require_ai_login
    require_ai_login()
    name=BOUND_ALIASES.get(name,name)
    if not isinstance(args,dict):raise ValueError('CAD arguments must be an object')
    if name not in {t['name'] for t in app_tools(allow_edit)}:
        raise ValueError('대화/검토 모드에서는 읽기·조회만 가능합니다. 도면 실행 모드를 선택하세요.')
    if name in ('cad_lisp_list','cad_lisp_read'):
        import lisp_service
        return lisp_service.process({'action':'status'} if name=='cad_lisp_list' else {'action':'read','id':args.get('id')})
    if name in APP_SESSION_ACTIONS:
        if args.get('target') is not None:
            validate_target(args['target'])
            with lock:_bound_state_locked(args['target'])
        if name=='cad_ui_command':
            command=args.get('command')
            if not isinstance(command,str) or not re.fullmatch(r'[A-Za-z0-9_?-]{1,100}',command):raise ValueError('CAD 명령 이름 하나만 지정하세요.')
        else:
            source=args.get('source');filename=args.get('name')
            if not isinstance(source,str) or not source.strip() or len(source.encode('utf8'))>200000:raise ValueError('source는 200KB 이하 AutoLISP 문자열이어야 합니다.')
            if not isinstance(filename,str) or not re.fullmatch(r'[^\\/:*?"<>|\x00-\x1f]{1,96}\.lsp',filename,re.I):raise ValueError('경로 없는 .lsp 파일 이름이 필요합니다.')
        if args.get('target') is not None:return dispatch(name,args)
        # 화면/리습 등록은 도면 본문 없이도 된다(대용량·빈 도면 포함). 요청한 앱 창으로만 보낸다.
        client=getattr(APP_CONTEXT,'origin',None)
        if not valid_uuid(client):raise ValueError('앱 편집 창을 확인할 수 없습니다.')
        with lock:
            if not _live_locked(client):raise ValueError('앱 편집 창이 열려 있지 않습니다.')
            return _send_locked(client,name,{**args,'target':None},clients[client].get('revision',0))
    if name=='cad_close_document':return close_document(args,app_ai=True)
    if name=='cad_save':
        with save_transaction(args):return call(name,args,allow_edit=allow_edit)
    if name=='cad_run_command':return _call(name,args,allow_edit,mcp=False)
    return call(name,args,allow_edit=allow_edit)
