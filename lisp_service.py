"""User-selected AutoLISP executed by an installed, isolated AutoCAD Core Console."""
import base64, copy, json, os, re, subprocess, tempfile, threading, time, uuid
from pathlib import Path
import exchange
import lisp_architecture
import parcel_service
import lisp_output

ROOT=Path(os.environ.get('LOCALAPPDATA',str(Path.home())))/'BarunCAD'/'lisp'
LOCK=threading.RLock()
JOBS={}
EXTENSIONS={'.lsp','.fas','.vlx','.dcl'}

def read_library():
    path=ROOT/'library.json'
    return json.loads(path.read_text(encoding='utf8')) if path.exists() else []

def save_library(items,assert_current=None):
    import safe_writes
    ROOT.mkdir(parents=True,exist_ok=True)
    with safe_writes.reserve(ROOT/'library.json',assert_current=assert_current) as transaction:
        transaction.save(json.dumps(items,ensure_ascii=False).encode('utf8'))

def decode_source(raw):
    for encoding in ('utf-8-sig','cp949'):
        try:return raw.decode(encoding),encoding
        except UnicodeDecodeError:pass
    raise ValueError('LSP 문자 인코딩은 UTF-8 또는 CP949로 저장하세요.')

def inspect_source(raw):
    source,encoding=decode_source(raw)
    # Discard comments (block #| |# / ;| |; too) and string literals before looking for definitions/capabilities.
    code=re.sub(r'#\|.*?\|#|;\|.*?\|;|;[^\n]*|"(?:\\.|[^"\\])*"',' ',source,flags=re.S)
    commands=list(dict.fromkeys(x.upper() for x in re.findall(r'\(\s*defun\s+c:([^\s()]+)',code,re.I)))
    ui=sorted(set(x.lower() for x in re.findall(r'\b(start_dialog|new_dialog|grread|vla-get-application|vlax-get-acad-object|acet-[\w-]+)\b',code,re.I)))
    return {'commands':commands,'encoding':encoding,'uiDependencies':ui}

# 2026-10-06: 본체 명령에 가려 실행되지 않던 동봉 리습의 명령 이름을 바꾸며 파일 이름도 바꿨다(예: 07_COL_기둥 → 07_COL2_기둥).
# 예전 이름으로 등록된 사본은 사용자가 리습 편집기로 고치지 않았을 때만 지운다(.previous 없음 또는 동봉본과 같은 내용). 고친 사본은 사용자 파일로 남긴다.
RETIRED_BUNDLED_LISP={
    '03_WALL_벽.lsp':{'e74595478e0bbb0d60270e59aca60113f875a3113a4d683bfadc43b16aded5a0', 'fe6bc57267033079bab1569eef725da4bb7fed1b684417c54c99647a81923ebb'},
    '04_WALL2_직선벽.lsp':{'a306af0a0eebfca23d939bf2b565675b5c16a7acc1ec9fe09b39b27f398a2e1a', 'b8b726f4ac7f84c735e74393b1199e4872e9f2b568e6fc4edb230d473cbfb662'},
    '06_GRID_그리드.lsp':{'1207c743f8f177c82ec4c0e5db936b807ab17694b669dfdae07022bf64a82a9b', '74d4f5a83fc83ec57c1e8c32915f644505ddbe7a8ea194bc63b9cd639fe8c01d'},
    '07_COL_기둥.lsp':{'c4a2a52854291a1427ead3c689872026287e3b45a86f17b95b9f4bd83e44db63', '447fc2f1f4452e735f7f30f28acf3c91ab1b09756de47a9f81b2c28cbff200f7'},
    '08_DOOR_문.lsp':{'121b10828778ded97cd3b7b348fcc8dcefdd5e16ad9c94ed9c71f7d89263f992', '6d8efe106b31a25dcc98fb0520f6238b81ac854255649dcebb70735a7fbf41fa'},
    '09_WIND_창.lsp':{'9d2b983a50b2312885acbb0ae76156d6959efbce149918fca507f24cb707bbf0', '74af0f07453b3510a7922c19409dd721ddce6a89f0b7f0b3a982326b952b55d7'},
    '10_ROOM_실.lsp':{'66024d7da8df8f0661a5463edfe88a9457954edb67299c8abf9fdb1578cddbd1', '05b78401ad73c97132f0d98ff5ff4dcd376a95a3d8466700fe122359e4437b82'},
    '11_AREA2_면적.lsp':{'3eaedd7b7a373baa07a36833dd0f6c6982ff214c6fc7672b3c12c5fab095f511', 'cbc837447964feb339791cdea649f8ef17ee10238d06d8457dc89b355632581f'},
    '15_PJ_접합.lsp':{'cee7a6078524b81e6c8cea39d6f9ac2274a24678c8dec386814c4282546fad30', 'd4504d4cc2895deefb22a603beb2a6a6ec8d7b0856ac51f0c5322e2f574a4f6a'},
    '16_PC_닫기.lsp':{'d8975e85b93168db80c7581712789320fa2984d96a61a502bce6e5cb303eb6e8', '98e90d668afbe749cc743bbe41378876b6ea8c0565735dda3763cf9b82fa48e0'},
    '17_LEN_길이.lsp':{'dee6aba94eccd79887a3d5543eeca8282a57b86ef5fdce0cbb89ff8f6f83c94a', 'cbaa71b673a35d8df40d6ef6278f898221c5f8a30da091fc4b2450ceebf4e79f'},
    '18_TALIGN_정렬.lsp':{'403a091e00e7ae3577e271972318e6a36cc422d85c016c064a22a489e1bf2e29', 'e1013f92928b2e9bf254c56c2b4379b5c78003b4de68f345985c46039d2bb6a6'},
    '21_DIMCLEAN_치수정리.lsp':{'79ef167deacc76f1fcdd523eb0e25e3861e417ae1be503c2fd30b45c17ee589b', 'c721f6b709e08801d80f852a54374af0a87d704d98401a0bc68ac2f455ca0008'},
    '22_TITLE_도각.lsp':{'5e21b6455dbc073eebcb8c8a38ef04d14b941b7ef1e370baa186172de7045c2a', '582318f82aa09e1e558a74e78275ae761d5d8126d0759268002eec2874bf9842'},
}

def retire_renamed_bundled(items):
    """옛 이름 동봉 사본 중 고치지 않은 것을 목록과 저장 파일에서 빼고, 남은 목록을 돌려준다."""
    import hashlib
    kept=[]
    for item in items:
        known=RETIRED_BUNDLED_LISP.get(item.get('name'))
        stored=ROOT/(str(item.get('id',''))+'.bin')
        # 리습 편집기로 고치면 <id>.previous 가 남는다(update). 그 흔적이 없거나 내용이 동봉본과 같으면 고치지 않은 사본이다.
        untouched=stored.is_file() and (not (ROOT/(str(item.get('id',''))+'.previous')).exists() or hashlib.sha256(stored.read_bytes()).hexdigest() in known) if known else False
        if untouched:
            stored.unlink(missing_ok=True);continue
        kept.append(item)
    return kept

# 예제 4개는 사용자 등록 파일이다. 알려진 미수정 구판만 갱신하며 .previous가 있는 수정본은 보존한다.
LEGACY_EXAMPLE_SHA256={'1c342a5cfd917e9cf4bb98fbc810a9bf1fa0d3fff9de54fed3c7bc7cf7973678'}
EXAMPLE_LAYER_HELPER="(defun BC:layer (name)\n  (if (not (tblsearch \"LAYER\" name))\n    (entmake (list '(0 . \"LAYER\") '(100 . \"AcDbSymbolTableRecord\") '(100 . \"AcDbLayerTableRecord\")\n      (cons 2 name) '(70 . 0) '(62 . 7) '(420 . 16777215) '(6 . \"CONTINUOUS\") '(370 . 18))))\n  name)\n"
EXAMPLE_LAYER_REPLACEMENTS=[["(cons 10 p) (cons 40 r)","(cons 8 (BC:layer \"A-SYM\")) (cons 10 p) (cons 40 r)"],["(if (and p q) (command \"_.RECTANG\" p q))","(if (and p q) (progn (BC:layer \"A-SYM\") (command \"_.RECTANG\" p q) (command \"_.CHPROP\" (entlast) \"\" \"_LA\" \"A-SYM\" \"\")))"],["(cons 10 p) (cons 40 h)","(cons 8 (BC:layer \"A-TEXT\")) (cons 10 p) (cons 40 h)"]]

def refresh_example_copy(items):
    import hashlib
    changed=False
    for item in items:
        if item.get('name','').casefold()!='바른캐드_리습예제.lsp'.casefold():continue
        stored=ROOT/(str(item.get('id',''))+'.bin')
        if not stored.is_file() or (ROOT/(str(item.get('id',''))+'.previous')).exists():continue
        try:source,_=decode_source(stored.read_bytes())
        except ValueError:continue
        source=source.replace('\r\n','\n').replace('\r','\n').rstrip()+'\n'
        if hashlib.sha256(source.encode('utf8')).hexdigest() not in LEGACY_EXAMPLE_SHA256:continue
        source=source.replace('\n','\n'+EXAMPLE_LAYER_HELPER,1)
        for before,after in EXAMPLE_LAYER_REPLACEMENTS:source=source.replace(before,after,1)
        raw=source.encode('utf8');stored.write_bytes(raw)
        item.update(size=len(raw),**inspect_source(raw));changed=True
    return changed

def retire_bundled_library(items):
    """동봉 건축 리습은 2026-10-27 모두 뺐다(기본 건축 명령과 같은 일 — 대표 결정 "전부 빼기").
    예전에 자동으로 등록된 사본(bundled)은 사용자가 리습 편집기로 고치지 않았을 때(.previous 없음)만 지운다.
    고친 사본은 보통 사용자 파일로 남긴다. 사용자가 직접 넣은 파일(예제 포함)은 건드리지 않는다."""
    kept=[]
    for item in retire_renamed_bundled(items):
        if item.get('bundled') is True:
            stored=ROOT/(str(item.get('id',''))+'.bin')
            if not (ROOT/(str(item.get('id',''))+'.previous')).exists():
                stored.unlink(missing_ok=True);continue
            item={k:v for k,v in item.items() if k!='bundled'}
        kept.append(item)
    return kept

def ensure_architecture_library():
    """등록 목록을 읽어 옛 동봉 사본을 정리하고, 모든 항목을 사용자 파일(bundled False)로 돌려준다."""
    items=read_library();kept=retire_bundled_library(items)
    if refresh_example_copy(kept) or kept!=items:save_library(kept)
    return [{**item,'bundled':False} for item in kept]

tagged_library=ensure_architecture_library

def text_log(raw):
    if b'\x00' in raw[:200]:return raw.decode('utf-16le',errors='replace').replace('\r','')
    return raw.decode('cp949',errors='replace').replace('\r','')

def canonical(value,layers):
    if isinstance(value,dict):return {k:(layers.get(v,v) if k=='layer' else v.upper() if k=='linetype' and isinstance(v,str) else canonical(v,layers)) for k,v in value.items() if k not in ('id','sourceHandle')}
    if isinstance(value,list):return [canonical(v,layers) for v in value]
    if isinstance(value,float):return round(value,7)
    return value

def merge_result(original,before,after,handles):
    """Keep native IDs/parameters on untouched objects; replace only changed geometry."""
    doc=copy.deepcopy(original);old_by_name={l['name']:l for l in original['layers']}
    source_layers={l['id']:l['name'] for l in before['document']['layers']}
    target_layers={l['id']:l['name'] for l in after['document']['layers']}
    layers=copy.deepcopy(original['layers']);layer_ids={};positions={l['id']:i for i,l in enumerate(layers)}
    before_layers={l['name']:l for l in before['document']['layers']};deferred=[]
    for layer in after['document']['layers']:
        old=old_by_name.get(layer['name']);new={**(old or {}),**layer,'id':old['id'] if old else layer['id']};layer_ids[layer['id']]=new['id']
        baseline=before_layers.get(layer['name'])
        if baseline and canonical(baseline,{})==canonical(layer,{}):
            if not old:deferred.append(new)
            continue
        if new['id'] in positions:layers[positions[new['id']]]=new
        else:layers.append(new)
    base={e.get('sourceHandle'):e for e in before['document']['entities']}
    originals={handles[e['id']]:e for e in original['entities']};counts={'preserved':0,'changed':0,'added':0,'deleted':0}
    seen=set();entities=[]
    def remap(e):
        e=copy.deepcopy(e);e.pop('sourceHandle',None);e['layer']=layer_ids[e['layer']]
        if 'entities' in e:e['entities']=[remap(c) for c in e['entities']]
        return e
    for item in after['document']['entities']:
        handle=item.get('sourceHandle');old=originals.get(handle);seen.add(handle)
        if old and handle in base and canonical(base[handle],source_layers)==canonical(item,target_layers):
            entities.append(copy.deepcopy(old));counts['preserved']+=1
        else:
            entity=remap(item)
            if old:entity['id']=old['id'];counts['changed']+=1
            else:counts['added']+=1
            entities.append(entity)
    def used_layers(items):
        return {e['layer'] for e in items}|set().union(*(used_layers(e.get('entities',[])) for e in items)) if items else set()
    used=used_layers(entities);layers.extend(l for l in deferred if l['id'] in used)
    counts['deleted']=len(set(originals)-seen);doc.update(entities=entities,layers=layers)
    return doc,counts

COMPILED_NOTE='FAS·VLX 는 컴파일된 리습이라 바른 CAD 자체 엔진에서 실행할 수 없습니다. AutoCAD 가 설치된 PC에서만 실행됩니다.'

def console_prologue(code,error):
    """AutoCAD Core Console 스크립트 첫 줄들. SECURELOAD 는 끄지 않고 1(신뢰 경로만 불러오기)로 명시한다.
    신뢰 경로는 이번 실행에 복사한 임시 code 폴더 하나뿐이다."""
    return ['(setvar "FILEDIA" 0)','(setvar "CMDECHO" 0)','(setvar "OSMODE" 0)','(setvar "SNAPMODE" 0)','(setvar "OSNAPCOORD" 1)',
            f'(setvar "TRUSTEDPATHS" {lstr(code)})','(setvar "SECURELOAD" 1)',
            '(setq br:ok T)',f'(defun br:fail (msg / f) (setq br:ok nil f (open {lstr(error)} "w")) (write-line msg f) (close f))']

def lstr(value):
    text=value.as_posix() if isinstance(value,Path) else str(value)
    return '"'+text.replace('\\','\\\\').replace('"','\\"').replace('\n','\\n').replace('\r','\\r')+'"'

def execute_job(job,data,files):
    try:
        executable=exchange.autocad_console()
        if not executable:raise ValueError('실제 리습 실행에는 설치·인증된 AutoCAD가 필요합니다. 현재 실행 엔진을 찾지 못했습니다.')
        with tempfile.TemporaryDirectory(prefix='barun_lisp_',ignore_cleanup_errors=True) as temporary:
            folder=Path(temporary);code=folder/'code';code.mkdir();handles={}
            raw,warnings=exchange.export_dxf(data['document'],entity_handles=handles)
            before=exchange.import_file(raw,'.dxf',include_handles=True)
            (folder/'input.dxf').write_bytes(raw)
            for item,content in files:
                path=code/item['name'];path.write_bytes(content);path.chmod(0o444)
            output=folder/'output.dxf';error=folder/'error.txt';done=folder/'done.txt'
            # Only this execution's copied files are trusted in a separate profile.
            # SECURELOAD is set explicitly to 1 (never disabled) and the user's AutoCAD profile is untouched.
            lines=console_prologue(code,error)
            for item,_ in files:
                if Path(item['name']).suffix.lower()=='.dcl':continue
                lines.append(f'(if br:ok (progn (setq br:r (vl-catch-all-apply \'load (list {lstr(code/item["name"])}))) (if (vl-catch-all-error-p br:r) (br:fail (vl-catch-all-error-message br:r)))))')
            lines+=['(setq br:ss (ssadd))']
            # Original labels remain distinct from unique DXF block-definition names.
            names=[f'({lstr(handles[e["id"]])} . {lstr(e["name"])})' for e in data['document']['entities'] if e.get('type')=='block' and e.get('name') and e['id'] in handles]
            lines.append("(setq br:blocknames '("+' '.join(names)+'))')
            if any(b'C:ROOM' in content for _,content in files):
                lines.append(lisp_architecture.room_context(raw))
            for identifier in data.get('selected',[]):
                if identifier in handles:lines.append(f'(ssadd (handent "{handles[identifier]}") br:ss)')
            lines+=['(sssetfirst nil br:ss)']
            active=next((l['name'] for l in data['document']['layers'] if l['id']==data.get('activeLayer')),None)
            if active:lines.append(f'(if (tblsearch "LAYER" {lstr(active)}) (setvar "CLAYER" {lstr(active)}))')
            expression=data.get('expression','').strip()
            invocation=f'(eval (read {lstr(expression)}))' if expression else f"(c:{data['command']})"
            call=f"(vl-catch-all-apply '(lambda () (setq br:value {invocation}) (setq br:finished T) br:value) nil)"
            lines.append('(setq br:finished nil)')
            lines.append(f'(if br:ok (setq br:r {call}))')
            lines.extend('' if x.strip()=='<Enter>' else x for x in data.get('inputs','').replace('\r','').split('\n') if x or data.get('inputs'))
            lines+=["(if (and br:ok (vl-catch-all-error-p br:r)) (br:fail (vl-catch-all-error-message br:r)))",
                    '(if (and br:ok (not br:finished)) (br:fail "Command interrupted before completion"))',
                    f'(if br:ok (command "_.DXFOUT" {lstr(output)} "16"))',
                    f'(if br:ok (progn (setq br:f (open {lstr(done)} "w")) (write-line "OK" br:f) (close br:f)))',
                    '(command "_.QUIT" "_Y")']
            script=folder/'run.scr';script.write_text('\n'.join(lines)+'\n',encoding='cp949')
            # Serialized jobs use one isolated profile; original user profile is never selected.
            profile=ROOT/'core-profile';profile.mkdir(parents=True,exist_ok=True)
            with open(folder/'console.log','wb') as log:
                if job['cancel'].is_set():raise InterruptedError('리습 실행을 중지했습니다.')
                proc=subprocess.Popen([executable,'/i',str(folder/'input.dxf'),'/s',str(script),'/l','en-US','/isolate','BarunCADLisp',str(profile)],cwd=code,stdout=log,stderr=subprocess.STDOUT,creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
                job['process']=proc;deadline=time.monotonic()+120
                while proc.poll() is None:
                    if job['cancel'].wait(.15) or time.monotonic()>deadline:
                        proc.terminate();proc.wait(timeout=10)
                        raise InterruptedError('리습 실행을 중지했습니다.' if job['cancel'].is_set() else '입력 부족 또는 실행 시간 초과입니다. 입력 순서와 실행 로그를 확인하세요.')
                    job['log']=text_log((folder/'console.log').read_bytes())[-18000:]
            job['log']=text_log((folder/'console.log').read_bytes())[-18000:]
            if job['cancel'].is_set():raise InterruptedError('리습 실행을 중지했습니다.')
            if error.exists():raise ValueError('리습 오류: '+decode_source(error.read_bytes())[0].strip())
            if not done.exists() or not output.exists():raise ValueError('리습 완료를 확인하지 못했습니다. 명령 이름·입력 순서·엔진 지원 여부를 실행 로그에서 확인하세요.')
            result_raw=output.read_bytes();after=exchange.import_file(result_raw,'.dxf',include_handles=True)
            merged,counts=merge_result(data['document'],before,after,handles)
            skipped=after['report'].get('skipped',{})
            expression_commands=re.findall(r'\(\s*c:([^\s()]+)',data.get('expression',''),re.I)
            command=data.get('command') or (expression_commands[0] if expression_commands else 'USER')
            merged,counts['added']=lisp_output.normalize(merged,data['document'],command.upper())
            if not skipped:
                result_raw,output_warnings=exchange.export_dxf(merged)
                warnings+=output_warnings
            job['result']={'document':merged,'counts':counts,'canApply':not bool(skipped) and merged!=data['document'],'data':base64.b64encode(result_raw).decode(),
                'warnings':warnings+after['report'].get('warnings',[])+[str(k)+': '+str(v) for k,v in after['report'].get('converted',{}).items()],
                'skipped':skipped,'note':'새 결과는 기능별 레이어의 개별 객체로 생성합니다. 새 블록과 여러 줄 문자는 분리하며, 기존 객체는 유지합니다.'}
            job['state']='completed'
    except Exception as e:job['state']='cancelled' if job['cancel'].is_set() else 'failed';job['error']=str(e)

def process(data, *, assert_current=None):
    from miri_account_service import capture_ai_epoch,validate_ai_epoch
    login_epoch=capture_ai_epoch()
    if data.get('_login_epoch') is not None:validate_ai_epoch(data['_login_epoch'])
    def check():
        validate_ai_epoch(login_epoch)
        if assert_current:assert_current()
    action=data.get('action')
    if data.get('ai'):
        from miri_account_service import require_ai_login
        require_ai_login()
        if action not in ('upload','update'):raise ValueError('AI 리습 등록 작업 오류')
    with LOCK:
        if action=='status':
            files=ensure_architecture_library()
            return {'available':bool(exchange.autocad_console()),'engine':'설치된 AutoCAD Core Console','files':files,'bundledCount':0,'autoload':True,'loginRequired':False}
        if action=='context':
            # 자체 엔진 전용. 닫힌 실 경계를 파이썬에서 한 번 계산해
            # 리습 식(br:rooms)과 좌표 목록(BOUNDARY 명령용) 둘 다로 돌려준다.
            raw,_=exchange.export_dxf(data['document'])
            polygons=lisp_architecture.boundary_polygons(raw)
            return {'rooms':lisp_architecture.room_context(raw),'regions':lisp_architecture.region_list(polygons)}
        if action=='install_architecture':
            return {'files':[]}   # 옛 화면용. 동봉 건축 리습은 2026-10-27 뺐다.
        if action=='upload':
            name=data.get('name','');suffix=Path(name).suffix.lower()
            if not name or len(name)>150 or re.search(r'[\\/:*?"<>|\x00-\x1f]',name) or name.endswith((' ','.')) or suffix not in EXTENSIONS:raise ValueError('LSP/FAS/VLX/DCL 파일 이름을 확인하세요.')
            if name.split('.')[0].upper() in {'CON','PRN','AUX','NUL',*[f'COM{i}' for i in range(10)],*[f'LPT{i}' for i in range(10)]}:raise ValueError('예약된 파일 이름입니다.')
            raw=base64.b64decode(data.get('data',''),validate=True)
            if not raw or len(raw)>5_000_000:raise ValueError('리습 파일은 5 MB 이하로 등록하세요.')
            items=read_library()
            if any(i['name'].casefold()==name.casefold() for i in items):raise ValueError('같은 이름의 파일이 있습니다. 기존 등록을 제거한 뒤 추가하세요.')
            if len(items)>=64:raise ValueError('등록 가능한 파일은 64개입니다.')
            item={'id':uuid.uuid4().hex,'name':name,'size':len(raw),**(inspect_source(raw) if suffix=='.lsp' else {'commands':[],'encoding':'binary','uiDependencies':[]})}
            if suffix in ('.fas','.vlx'):item.update(compiled=True,note=COMPILED_NOTE)
            import safe_writes
            ROOT.mkdir(parents=True,exist_ok=True)
            with safe_writes.reserve(ROOT/(item['id']+'.bin'),assert_current=check) as transaction:transaction.save(raw)
            check();save_library([*items,item],assert_current=check);return {'file':item}
        if action=='remove':
            items=read_library();item=next((i for i in items if i['id']==data.get('id')),None)
            if not item:raise ValueError('등록된 파일이 아닙니다.')
            save_library([i for i in items if i!=item]);(ROOT/(item['id']+'.bin')).unlink(missing_ok=True);return {'removed':True}
        if action=='toggle':
            # 파일을 지우지 않고 자동 불러오기에서만 뺀다(리습 관리 창의 켜기·끄기).
            items=read_library();item=next((i for i in items if i['id']==data.get('id')),None)
            if not item:raise ValueError('등록된 파일이 아닙니다.')
            if data.get('enabled',True):item.pop('disabled',None)
            else:item['disabled']=True
            save_library(items);return {'saved':True,'disabled':bool(item.get('disabled'))}
        if action=='reorder':
            items=read_library();order=data.get('ids',[])
            if len(order)!=len(items) or set(order)!={i['id'] for i in items}:raise ValueError('리습 목록이 변경되었습니다. 다시 열어주세요.')
            lookup={i['id']:i for i in items};save_library([lookup[i] for i in order]);return {'saved':True}
        if action in ('read','update'):
            items=read_library();item=next((i for i in items if i['id']==data.get('id')),None)
            if not item or Path(item['name']).suffix.lower()!='.lsp':raise ValueError('LSP 원문 파일만 편집할 수 있습니다.')
            path=ROOT/(item['id']+'.bin');raw=path.read_bytes()
            if action=='read':return {'source':decode_source(raw)[0]}
            if 'expectedSource' in data and decode_source(raw)[0]!=data['expectedSource']:raise ValueError('확인 중 리습이 변경되어 저장하지 않았습니다.')
            source=data.get('source','')
            if not isinstance(source,str) or not source.strip() or len(source.encode('utf8'))>5_000_000:raise ValueError('5MB 이하의 리습 원문을 입력하세요.')
            import safe_writes
            with safe_writes.reserve(path,assert_current=check) as transaction:
                if path.read_bytes()!=raw:raise ValueError('확인 중 리습이 바뀌어 저장하지 않았습니다.')
                updated=source.encode('utf8');transaction.save(updated)
                legacy=ROOT/(item['id']+'.previous')
                if not legacy.exists():
                    try:os.link(path.with_name(path.name+'.previous'),legacy)
                    except OSError:pass
            item.update(inspect_source(updated),size=len(updated));check();save_library(items,assert_current=check);return {'saved':True}
        if action=='start':
            if any(j['state']=='running' for j in JOBS.values()):raise ValueError('현재 리습 실행을 마치거나 중지한 뒤 실행하세요.')
            command=data.get('command','').strip().upper();expression=data.get('expression','').strip()
            if not expression and not re.fullmatch(r'[^\s()\[\]"\';\\]{1,100}',command):raise ValueError('실행할 리습 명령 이름을 입력하세요.')
            if len(expression)>20000 or len(data.get('inputs',''))>20000:raise ValueError('입력이 너무 깁니다.')
            files=[];library={i['id']:i for i in read_library()}
            for identifier in dict.fromkeys(data.get('files',[])):
                if identifier not in library:raise ValueError('등록된 리습 파일을 다시 선택하세요.')
                item=library[identifier];files.append((item,(ROOT/(identifier+'.bin')).read_bytes()))
            if not files and not expression:raise ValueError('실행할 리습 파일을 추가하세요.')
            if not isinstance(data.get('document'),dict):raise ValueError('현재 도면이 필요합니다.')
            if len(JOBS)>=16:
                for key in list(JOBS):
                    if JOBS[key]['state']!='running':del JOBS[key];break
            job={'id':uuid.uuid4().hex,'login_epoch':login_epoch,'state':'running','cancel':threading.Event(),'log':''};JOBS[job['id']]=job
            payload=copy.deepcopy(data);payload['command']=command
            threading.Thread(target=execute_job,args=(job,payload,files),daemon=True).start();return {'id':job['id']}
        if action in ('poll','cancel'):
            job=JOBS.get(data.get('id'))
            if not job:raise ValueError('리습 실행 기록이 없습니다. 다시 실행하세요.')
            validate_ai_epoch(job.get('login_epoch'))
            if action=='cancel':job['cancel'].set();return {'requested':True}
            return {k:job[k] for k in ('id','state','log','result','error') if k in job}
    raise ValueError('지원하지 않는 리습 작업입니다.')

