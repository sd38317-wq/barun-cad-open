"""리습 먼저(2026-10-21): 바른 명령 라이브러리(카드 명령)로 그릴 수 있는 건축 요소를
기본 도형(cad_execute)이나 AI가 짠 리습(cad_lisp_load)으로 그리면 거절하고 쓸 명령을 알려 준다.
그 명령을 실제로 찾아보거나 실행해 본 기록이 있고 안 되는 이유(library_check)를 대면 그때만 통과시킨다.
외부 MCP와 앱 안 AI가 같은 입구(bridge._call)를 지나므로 둘 다 같은 규칙을 받는다."""
import re,threading,time
import command_library

# 무엇을 그리는지 → 먼저 쓸 라이브러리 명령(앞이 먼저). 시험 통과(recommend) 항목만 실제 후보가 된다.
INTENTS={
    'wall':('벽',('WALDRAW',)),
    'door':('문',('D1',)),
    'window':('창',('W1',)),
    'column':('기둥',('COL',)),
    'grid':('그리드(축선)',()),   # 동봉 GRID 리습은 2026-10-27 뺐다 — 라이브러리 카드가 없어 막지 않는다
    'room':('실·면적',('MAC',)),
    'parking':('주차 구획',('PK',)),
    'dimension':('치수',('DQ','DIMSEQ')),
    'title':('도곽',()),   # 동봉 TITLE2 리습은 2026-10-27 뺐다
}
LAYER_INTENTS=(('A-WALL','wall'),('A-DOOR','door'),('A-GLAZ','window'),('A-COL','column'),('A-GRID','grid'),
               ('A-AREA','room'),('A-PARK','parking'),('A-DIM','dimension'),('A-TITLE','title'))
WORD_INTENTS={'wall':'wall','벽':'wall','벽체':'wall','door':'door','문':'door','window':'window','창':'window','창호':'window',
              'column':'column','기둥':'column','grid':'grid','그리드':'grid','축선':'grid','room':'room','area':'room','실':'room',
              '면적':'room','parking':'parking','주차':'parking','주차구획':'parking','dimension':'dimension','치수':'dimension',
              'titleblock':'title','도곽':'title'}
ENTITY_INTENTS={'wall':'wall','dimension':'dimension'}
ADD_TYPES=('add','addMany','add.classified')
LOOKUP_TOOLS={'cad_get_command':'name','cad_describe_command':'name','cad_preview_command':'name','cad_run_command':'name','cad_lisp_run':'command'}
EVIDENCE_SECONDS=1800
_lock=threading.Lock()
_seen={}  # 대문자 명령 이름 → 마지막으로 찾아보거나 실행해 본 시각(monotonic)


def note(name,args):
    """명령을 찾아보거나(cad_get_command·cad_describe_command) 실행해 본(cad_run_command·cad_lisp_run) 기록."""
    value=args.get(LOOKUP_TOOLS[name]) if name in LOOKUP_TOOLS and isinstance(args,dict) else None
    if isinstance(value,str) and value.strip():
        with _lock:_seen[value.strip().upper()]=time.monotonic()


def _seen_recently(names):
    now=time.monotonic()
    with _lock:return any(now-_seen.get(n.upper(),-1e18)<=EVIDENCE_SECONDS for n in names)


def _intent_of_name(value,layer_names):
    if not isinstance(value,str) or not value.strip():return None
    value=value.strip();name=layer_names.get(value,value)
    upper=name.upper()
    for prefix,intent in LAYER_INTENTS:
        if upper==prefix or upper.startswith(prefix+'-'):return intent
    return WORD_INTENTS.get(name.lower().replace(' ',''))


def _commands(command):
    if not isinstance(command,dict):return
    yield command
    if command.get('type')=='batch':
        for child in command.get('commands') or []:yield from _commands(child)


def _entities(command):
    for c in _commands(command):
        kind=c.get('type')
        if kind=='add':yield c.get('entity')
        elif kind in ADD_TYPES:yield from c.get('entities') or []


def _nested_intents(entity,layer_names):
    """블록·묶음 안쪽 도형(entities·children)도 본다. 안쪽은 레이어가 없으면 바깥을 따르므로 미지정으로 세지 않는다."""
    for key in ('entities','children'):
        for child in entity.get(key) or []:
            if not isinstance(child,dict):continue
            yield ENTITY_INTENTS.get(str(child.get('type','')).lower()) or _intent_of_name(child.get('layer'),layer_names)
            yield from _nested_intents(child,layer_names)


def intents(command,args,layer_names):
    """새로 그리는 도형마다 무엇인지(intent) 본다. 레이어·용도가 하나도 없는 새 도형은 '미지정'으로 센다."""
    # 같은 batch 에서 만드는 레이어(cad_preview 의 normalized_command 가 이 모양)도 ID→이름으로 푼다.
    layer_names={**layer_names,**{c['id']:c['name'] for c in _commands(command)
                                  if c.get('type')=='layer.add' and isinstance(c.get('id'),str) and isinstance(c.get('name'),str)}}
    default=_intent_of_name(args.get('layer'),layer_names) or _intent_of_name(args.get('purpose'),layer_names)
    labelled=args.get('layer') is not None or args.get('purpose') is not None
    found=set();unlabelled=0
    for entity in _entities(command):
        if not isinstance(entity,dict):continue
        intent=ENTITY_INTENTS.get(str(entity.get('type','')).lower())
        if not intent and entity.get('layer') is not None:intent=_intent_of_name(entity['layer'],layer_names)
        elif not intent:
            intent=default
            if not labelled:unlabelled+=1
        found|={intent,*_nested_intents(entity,layer_names)}
    return found-{None},unlabelled


def candidates(intent):
    """그 일에 먼저 쓸 라이브러리 명령. 시험 통과(recommend·passed)만 센다(계단처럼 없으면 막지 않음)."""
    # 같은 이름이 여러 항목(조건이 다른 기록)일 수 있다: 시험 통과·추천 항목이 하나라도 있으면 후보.
    entries={e['command']:e for e in command_library.bundle()['commands'] if e.get('recommend') and e.get('status')=='passed'}
    out=[]
    for name in INTENTS[intent][1]:
        e=entries.get(name)
        if e:
            out.append({'command':e['command'],'aliases':e.get('aliases',[]),'label':e.get('label',''),
                        'runner':e.get('runner'),'tool':'cad_run_command' if e.get('runner')=='card' else 'cad_lisp_run'})
    return out


def _checks(value):
    if value is None:return []
    items=value if isinstance(value,list) else [value]
    if not items or len(items)>20:raise ValueError('library_check는 {command, reason} 객체 또는 그 배열(20개 이하)입니다.')
    for item in items:
        if (not isinstance(item,dict) or set(item)-{'command','reason'} or not isinstance(item.get('command'),str)
                or not isinstance(item.get('reason'),str) or not 4<=len(item['reason'].strip())<=500):
            raise ValueError('library_check 항목은 {command:명령 이름, reason:명령으로 안 되는 이유(4~500자)}입니다.')
    return items


def _hint(intent,names):
    return INTENTS[intent][0]+': '+', '.join(f"{c['command']}({c['label']}, {c['tool']})" for c in names)


def lisp_intents(args,layer_names):
    """AI가 짠 리습: layer/purpose 와, 새 객체를 만드는 소스(entmake·vla-Add…)면 그 안의 표준 레이어 이름("A-WALL" 등)으로 본다.
    기존 객체를 고르기만 하는 리습((ssget … (8 . "A-WALL")) 뒤 MOVE 등)은 막지 않는다."""
    found={_intent_of_name(args.get(k),layer_names) for k in ('layer','purpose')}
    source=str(args.get('source') or '')
    if re.search(r'\(\s*(entmake|entmakex|vla-add)',source,re.I):
        found|={_intent_of_name(n,{}) for n in re.findall(r'"(A-[A-Za-z0-9-]+)"',source)}
    return found-{None},0


def plan(tool,args,layer_names):
    """막아야 할 일과 후보 명령. (blocked: [{intent,label,candidates}], unlabelled 개수)"""
    found,unlabelled=lisp_intents(args,layer_names) if tool=='cad_lisp_load' else intents(args.get('command'),args,layer_names)
    blocked=[]
    for intent in sorted(found):
        names=candidates(intent)
        if names:blocked.append({'intent':intent,'label':INTENTS[intent][0],'candidates':names})
    return blocked,unlabelled


def preview_hint(args,layer_names):
    """미리보기는 막지 않고 먼저 쓸 명령만 알려 준다."""
    blocked,unlabelled=plan('cad_preview',args,layer_names)
    if not blocked and not unlabelled:return None
    text=['리습 먼저: cad_execute 는 아래 명령을 먼저 써 본 뒤에만 실행됩니다.']+[_hint(b['intent'],b['candidates']) for b in blocked]
    if unlabelled:text.append('레이어(layer)나 용도(purpose)가 없는 새 도형은 cad_execute 가 거절합니다.')
    return {'blocked':blocked,'unlabelled':unlabelled,'message':' '.join(text)}


def enforce(tool,args,layer_names):
    """라이브러리 명령으로 할 수 있는 일을 기본 도형·AI 리습으로 하려 하면 CADToolError(code=library_first)."""
    from bridge import CADToolError
    checks=_checks(args.get('library_check'))
    blocked,unlabelled=plan(tool,args,layer_names)
    if unlabelled and tool=='cad_execute':
        raise CADToolError('새 도형에 레이어(layer)나 용도(purpose)가 없습니다. 무엇을 그리는지 정하세요(cad_get_layer_usage). '
                           '벽·문·창·기둥 같은 건축 요소면 명령 라이브러리(cad_list_commands)를 먼저 쓰세요.',
                           {'code':'library_first','unlabelled':unlabelled})
    missing=[]
    for item in blocked:
        # 이유를 댄 명령이 이 일의 후보이고, 그 명령(이름·별칭 아무거나)을 30분 안에 찾아보거나 실행해 봤어야 한다.
        tried=[c for check in checks for c in item['candidates']
               if check['command'].strip().upper() in {n.upper() for n in (c['command'],*c['aliases'])}]
        if not any(_seen_recently([c['command'],*c['aliases']]) for c in tried):missing.append(item)
    if missing:
        raise CADToolError('리습 먼저: 이 일은 바른 명령 라이브러리로 그립니다. '+' / '.join(_hint(m['intent'],m['candidates']) for m in missing)+
                           '. 카드 명령은 cad_describe_command → cad_run_command, 리습은 cad_lisp_run 으로 실행하세요. '
                           '명령을 써 봤는데 이 모양을 못 그리면 그 명령 이름과 이유를 library_check:{command, reason} 로 붙여 다시 부르세요(써 본 기록이 있어야 통과).',
                           {'code':'library_first','blocked':missing})
    return [{'command':c['command'].strip().upper(),'reason':c['reason'].strip()} for c in checks] if blocked else []


# 앱 안 AI(codex_chat·miri_chat) 실행 안내에 붙이는 같은 규칙.
ACTIONS_RULE=('\n벽·문·창·기둥·그리드·실 면적·주차·치수·도곽은 옛 actions(wall·line·polyline·rect·circle·text)로 그리지 말고 '
              '명령 라이브러리(cad_run_command WALDRAW·D1·W1·COL 등)를 먼저 쓰세요. 바른 CAD 가 막고(library_first) 쓸 명령을 알려 줍니다. '
              '그 명령을 써 보고도 못 그릴 때만 그 action 의 args 에 library_check:{command, reason} 를 넣으세요(써 본 기록이 없으면 통과하지 않음).\n')


def check_actions(data):
    """앱 안 AI 옛 actions(ai-actions.js 의 line·polyline·rect·circle·wall·text)도 같은 표·같은 써 본 기록으로 본다.
    앱은 새 도형의 종류와 레이어 이름만 보내고(표는 여기 한 곳), 막히면 {blocked, message} 를 받아 실행하지 않는다."""
    from bridge import CADToolError
    entities=data.get('entities')
    if (not isinstance(entities,list) or not 1<=len(entities)<=200
            or any(not isinstance(e,dict) or set(e)-{'type','layer'} or not all(isinstance(e.get(k),str) for k in ('type','layer')) for e in entities)):
        raise ValueError('리습 먼저 확인 요청 형식이 올바르지 않습니다.')
    try:checks=enforce('cad_execute',{'command':{'type':'addMany','entities':entities},'library_check':data.get('library_check')},{})
    except CADToolError as error:
        if error.code!='library_first':raise
        return {'blocked':error.details.get('blocked',[]),'unlabelled':error.details.get('unlabelled',0),'message':str(error)}
    return {'blocked':[],'checks':checks}
