"""AI 채팅 길 고르기: 계정 창에서 고른 방식(미리 제공 | 내 모델 = Codex 또는 Claude)에 따라 miri_chat·codex_chat·claude_chat 으로 보낸다.
방식은 이 PC 사용자 폴더(ai-mode.json)에 남겨 CAD를 다시 켜도 같다. 대화 도중 방식을 바꿔도 이미 시작한 대화의
poll·interrupt 는 그 대화를 만든 쪽으로 보낸다."""
import json,os,threading
from pathlib import Path

DATA=Path(os.environ.get('LOCALAPPDATA',str(Path.home())))/'BarunCAD'
MODE_FILE=DATA/'ai-mode.json'
MODES=('managed','personal')
# 내 모델 안에서 고른 모델(2026-10-26 사장님 "그걸로" — docs/mockup-my-model-claude-2026-10-26). 기본은 예전처럼 Codex.
PERSONAL=('codex','claude')
_threads={};_authorizations={};_lock=threading.Lock()

def _read():
    try:value=json.loads(MODE_FILE.read_text(encoding='utf8'))
    except (OSError,ValueError):value={}
    return value if isinstance(value,dict) else {}

def _write(**changes):
    value={**_read(),**changes}
    DATA.mkdir(parents=True,exist_ok=True)
    temp=MODE_FILE.with_suffix('.tmp');temp.write_text(json.dumps(value),encoding='utf8');os.replace(temp,MODE_FILE)

def mode():
    value=_read().get('mode')
    return value if value in MODES else 'managed'

def personal():
    value=_read().get('personal')
    return value if value in PERSONAL else 'codex'

def set_mode(value):
    if value not in MODES:raise ValueError('AI 방식이 올바르지 않습니다.')
    _write(mode=value)
    return {'mode':value,'personal':personal()}

def set_personal(value):
    if value not in PERSONAL:raise ValueError('내 모델이 올바르지 않습니다.')
    _write(personal=value)
    return {'mode':mode(),'personal':value}

def provider():
    return personal() if mode()=='personal' else 'miri'

def backend(name):
    if name=='codex':
        import codex_chat;return codex_chat
    if name=='claude':
        import claude_chat;return claude_chat
    import miri_chat;return miri_chat

def process(data):
    action=data.get('action')
    if action=='validateOutputClose':
        import bridge
        return bridge.validate_output_close(data.get('requestId'),data.get('recipient'))
    if action=='validateTool':
        import bridge
        return bridge.validate_app_request(data.get('requestId'),data.get('recipient'))
    if action=='authorize':
        from miri_account_service import require_ai_login
        require_ai_login()
        if data.get('aiRequestEpoch') is not None:
            import bridge
            authorization,_=bridge.register_chat_request(data)
            return {'authorized':True,'requestAuthorization':authorization}
        return {'authorized':True}
    # 리습 먼저: 앱 AI 옛 actions 가 그리려는 도형을 엔진 표(library_first.py)로 판정한다.
    if action=='libraryFirst':
        import library_first
        return library_first.check_actions(data)
    # 대화창 그림 칸: 도구 이벤트가 준 그림 번호로 PNG 를 받는다(2026-10-30 미리 그림 보기). AI 방식과 상관없다.
    if action=='image':
        import chat_images
        return chat_images.read(data.get('id'))
    if action=='mode':return {'mode':mode(),'personal':personal()}
    if action=='setMode':return set_mode(data.get('mode'))
    if action=='setPersonal':return set_personal(data.get('personal'))
    # 계정 창 "내 모델" 칸: 지금 고른 방식과 상관없이 Codex 연결만 확인·로그인·로그아웃한다.
    if action in ('codexStatus','codexLogin','codexLogout'):return backend('codex').process({'action':action[5:].lower()})
    # 계정 창 "내 모델 > Codex": 모델 목록(Codex 가 알려 주는 대로)과 고른 모델·추론 깊이(10-26).
    if action=='codexModels':return backend('codex').process({'action':'models'})
    if action=='codexSetChoice':return backend('codex').process({'action':'setChoice','model':data.get('model'),'effort':data.get('effort')})
    # 계정 창 "내 모델 > Claude": API 키 확인·저장·지우기·모델(CAD 안 AI 창용). 키는 응답에 싣지 않는다(끝 4자리만).
    if action in ('claudeStatus','claudeSaveKey','claudeForgetKey','claudeSetModel'):
        return backend('claude').process({**{k:v for k,v in data.items() if k in ('key','model')},'action':action[6].lower()+action[7:]})
    # 계정 창 [Claude에 연결]·[Codex에 연결]: 바깥 AI 프로그램 설정에 이 CAD 의 MCP 를 넣는다(사용자가 누른 경우만).
    if action=='mcpRegister':
        import mcp_register;return mcp_register.register(data.get('client'))
    if action=='mcpStatus':
        import mcp_register;return mcp_register.status()
    if action in ('poll','interrupt'):
        if action=='interrupt':
            import bridge
            bridge.cancel_chat_requests(data)
        with _lock:name=_threads.get(str(data.get('threadId') or ''))
        result=backend(name or provider()).process(data)
        if action=='poll' and isinstance(result,dict):
            with _lock:authorization=_authorizations.get(str(data.get('threadId') or ''))
            if authorization:result={**result,'requestAuthorization':authorization}
        return result
    name=provider()
    # AI 창의 모델 칸은 '미리'만 있다. Codex로 보낼 때는 비워서 사용자의 Codex 기본 모델을 쓴다(Claude 는 계정 창에서 고른 모델).
    if name in ('codex','claude') and data.get('model')=='miri':data={**data,'model':None}
    authorization=None
    if action=='send':
        import bridge
        authorization,epoch=bridge.register_chat_request(data)
        data={**data,'_loginEpoch':epoch}
    result=backend(name).process(data)
    if action=='send' and isinstance(result,dict) and result.get('threadId'):
        with _lock:
            _threads[str(result['threadId'])]=name
            _authorizations[str(result['threadId'])]=authorization
        result={**result,'requestAuthorization':authorization}
    if action=='status' and isinstance(result,dict):result={**result,'provider':name}
    return result
