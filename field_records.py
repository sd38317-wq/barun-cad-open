"""현장 기록함 — PC별 덧붙임 장부와 도면 옆 사진·링크·보고서 보관."""
import base64
import binascii
import copy
import csv
import hashlib
import io
import json
import os
import re
import shutil
import socket
import threading
import tempfile
import time
import uuid
from contextlib import ExitStack
from datetime import datetime, timezone
from pathlib import Path

DEVICE_NAMES={'CON','PRN','AUX','NUL','CLOCK$'}|{f'COM{i}' for i in range(1,10)}|{f'LPT{i}' for i in range(1,10)}
PIN_FIELDS=('no','title','kind','prio','status','assignee','due','note','at','photos')
PLAIN_KINDS={'link.created','link.revoked','link.expired','pin.status','reply.sent','reply.delivered','drawing.applied','report.made','folder.moved'}
CSV_COLUMNS=('번호','제목','유형','급한 정도','상태','담당','기한','처음 받은 때','마지막 변경','사진 수','사무실 답(마지막)','링크')
_LOCKS={};_LOCKS_GUARD=threading.Lock()
_SPOOL_LOCK=threading.RLock()
_WRITE_ACTIONS={'append','photo','link','report','move'}
_MOVED_FOLDERS={}
_QUEUED_FOLDERS={}


def _safe_name(value,limit=60):
    text=re.sub(r'[<>:"/\\|?*\x00-\x1f\x7f]', '_',str(value or '')).strip(' .')[:limit].rstrip(' .')
    if not text:text='도면'
    if text.split('.')[0].rstrip(' .').upper() in DEVICE_NAMES:text='_'+text
    return text[:limit]


def folder_for(data,*,_check_parent=True):
    """안전한 도면 경로(드라이브 글자, 또는 NAS 주소 \\서버\공유\…)는 파일이 없어도 옆 폴더를 쓰고, 나머지는 문서함을 쓴다.
    NAS 주소(UNC)도 받는다(사용자 결정 10/16): 사용자가 그 주소로 연 도면 바로 옆이라 같은 도면을 여는 다른 PC 도 같은 기록을 본다."""
    text=str(data.get('drawingPath') or '')
    # macOS: /Users/…, /Volumes/… 같은 절대 경로(// 로 시작하는 주소는 아래 UNC 규칙). 맥은 이름에 ':' 를 쓸 수 있다.
    posix=os.name!='nt' and text.startswith('/') and not text.startswith('//')
    parts=[p for p in re.split(r'[\\/]+',text[1:] if posix else text[2:]) if p]
    drive=bool(re.match(r'^[A-Za-z]:[\\/]',text))
    # \\?\ \\.\ 같은 장치 주소는 빼고, 서버·공유·파일 세 조각이 있어야 한다
    # NAS 주소(UNC)는 Windows 에서만 경로다. 맥에서는 \\서버\… 가 이름 하나짜리 상대 경로가 되어 엔진 폴더 아래에
    # 역슬래시 이름 폴더를 만들므로 받지 않는다(맥 NAS 는 /Volumes/… 로 위 posix 규칙을 탄다).
    unc=os.name=='nt' and text[:2] in ('\\\\','//') and len(parts)>=3 and parts[0] not in ('?','.')
    valid=(drive or unc or posix) and len(text)<=1024 and (posix or ':' not in text[2:])
    valid=valid and all(p not in ('.','..') and p==p.strip() and not p.endswith('.') for p in parts)
    valid=valid and not any(ch in p for p in parts for ch in '<>"|?*\x00')
    valid=valid and not any(ord(ch)<32 for ch in text)
    valid=valid and all(p.split('.')[0].rstrip(' .').upper() not in DEVICE_NAMES for p in parts)
    if valid:
        target=Path(text)
        if target.suffix.lower() in ('.dwg','.dxf','.bcad'):
            if _check_parent and not target.parent.is_dir():raise FileNotFoundError('도면 폴더에 닿을 수 없습니다: '+str(target.parent))
            return {'folder':str((target.parent/(target.stem+'_현장기록')).absolute()),'fallback':False}
    home=os.environ.get('BARUN_FIELD_RECORDS_HOME')
    base=Path(home) if home else Path(os.environ.get('USERPROFILE') or Path.home())/'Documents'/'바른 CAD'/'현장기록'
    name=_safe_name(data.get('drawingName') or '도면');draft_key=data.get('draftKey')
    if isinstance(draft_key,str) and draft_key:name+='_'+hashlib.sha256(draft_key.encode('utf-8')).hexdigest()[:6]
    return {'folder':str((base/(name+'_현장기록')).absolute()),'fallback':True}


def _pc_name():
    return _safe_name(os.environ.get('BARUN_FIELD_RECORDS_PC') or os.environ.get('COMPUTERNAME') or socket.gethostname())


def _resolved(path):
    # Windows는 폴더 생성 전후 resolve 결과에 긴 경로 접두사를 붙이기도 한다.
    text=str(path.resolve());prefix=chr(92)*2+'?'+chr(92)
    if text.startswith(prefix+'UNC'+chr(92)):text=chr(92)*2+text[8:]
    elif text.startswith(prefix):text=text[4:]
    return Path(text)


def _lock(folder):
    key=os.path.normcase(str(_resolved(folder)))
    with _LOCKS_GUARD:return _LOCKS.setdefault(key,threading.Lock())


def _now():
    return datetime.now().astimezone().isoformat()


def _local_time(value):
    if not value:return datetime.now().astimezone()
    try:return datetime.fromisoformat(str(value).replace('Z','+00:00')).astimezone()
    except (ValueError,OverflowError,OSError) as error:raise ValueError('기록 시각은 ISO 날짜와 시각으로 보내세요.') from error


def _at_key(value):
    try:return (0,datetime.fromisoformat(str(value).replace('Z','+00:00')).astimezone(timezone.utc).isoformat())
    except (ValueError,OverflowError,OSError):return (1,str(value or ''))


def _json_bytes(value):
    try:return json.dumps(value,ensure_ascii=False,separators=(',',':'),allow_nan=False).encode('utf-8')
    except (TypeError,ValueError,UnicodeError) as error:raise ValueError('기록은 올바른 JSON 형식이어야 합니다.') from error


def _inside(folder,relative):
    root=_resolved(folder);target=_resolved(folder/relative)
    if not target.is_relative_to(root):raise ValueError('기록함 밖의 파일은 사용할 수 없습니다.')
    return target


def _read_events(folder):
    """매번 모든 PC 장부를 읽어, 다른 PC가 방금 덧붙인 기록도 반영한다."""
    rows=[]
    for path in sorted(folder.glob('기록장부*.jsonl'),key=lambda p:p.name):
        if not path.is_file() or not _resolved(path).is_relative_to(_resolved(folder)):continue
        with path.open('rb') as stream:
            for index,line in enumerate(stream):
                try:event=json.loads(line)
                except (ValueError,UnicodeError):continue
                if not isinstance(event,dict) or not isinstance(event.get('id'),str) or not event['id']:continue
                if not isinstance(event.get('kind'),str):continue
                if 'link' in event and not isinstance(event['link'],str):continue
                if 'pin' in event and not isinstance(_pin_id(event['pin']),str):continue
                if event.get('at') is not None and not isinstance(event['at'],str):continue
                rows.append((_at_key(event.get('at')),path.name,index,event))
    return [row[3] for row in sorted(rows,key=lambda row:row[:3])]


def _append_events(folder,events):
    if not events:return
    folder.mkdir(parents=True,exist_ok=True)
    path=_inside(folder,'기록장부_'+_pc_name()+'.jsonl')
    # 이전 실행이 줄을 쓰다 끝났으면 그 깨진 줄과 새 사건을 구분한다(기존 바이트는 보존).
    separator=b''
    if path.exists() and path.stat().st_size:
        with path.open('rb') as stream:stream.seek(-1,os.SEEK_END);separator=b'' if stream.read(1)==b'\n' else b'\n'
    body=separator+b''.join(_json_bytes(event)+b'\n' for event in events)
    with path.open('ab') as stream:stream.write(body)


def _stamp(event):
    event=copy.deepcopy(event);event['pc']=_pc_name();event['savedAt']=_now()
    if not event.get('at'):event['at']=event['savedAt']
    return event


def _pin_id(value):
    return value.get('id') if isinstance(value,dict) else value


def _photo_ids(value):
    if not isinstance(value,list):return []
    return [item.get('id') if isinstance(item,dict) else item for item in (value or [])]


def _field_states(events):
    """현장이 보낸 값만 복원한다. 사무실 상태 때문에 같은 핀을 변경으로 오인하지 않는다."""
    states={}
    for event in events:
        key=(event.get('link',''),_pin_id(event.get('pin')))
        if not isinstance(key[0],str) or not isinstance(key[1],str):continue
        if event['kind'] in ('pin.received','pin.changed') and isinstance(event.get('data'),dict):states[key]=copy.deepcopy(event['data'])
        elif event['kind']=='pin.changed' and key in states and isinstance(event.get('changes'),dict):
            for field,change in event['changes'].items():
                if field in PIN_FIELDS and isinstance(change,dict):states[key][field]=copy.deepcopy(change.get('to'))
    return states


def _pins(events):
    states=_field_states(events);pins={}
    for key,state in states.items():
        pin=copy.deepcopy(state)
        pin.update(id=key[1],link=key[0],firstAt='',lastAt='',replies=[],photos=[],history=[])
        pins[key]=pin
    field_times={};office={};replies={}
    for event in events:
        pid=_pin_id(event.get('pin'));link=event.get('link');kind=event['kind']
        if not isinstance(pid,str) or (link is not None and not isinstance(link,str)):continue
        keys=[(link,pid)] if link is not None else [key for key in pins if key[1]==pid]
        for key in keys:
            if key not in pins:continue
            pin=pins[key];at=event.get('at') or event.get('savedAt','')
            pin['history'].append(copy.deepcopy(event))
            if kind in ('pin.received','pin.changed'):
                if not pin['firstAt']:pin['firstAt']=at
                pin['lastAt']=at;field_times[key]=_at_key(at)
            elif kind=='pin.status':office[key]=(at,event.get('to',event.get('status')))
            elif kind=='reply.sent':
                reply={field:event.get(field,False if field=='delivered' else '') for field in ('at','by','text','delivered')}
                pin['replies'].append(reply);replies[(key,event['id'])]=reply
            elif kind=='reply.delivered':
                ref=event.get('ref')
                if isinstance(ref,str) and (key,ref) in replies:replies[(key,ref)]['delivered']=True
            elif kind=='photo.saved':
                if not any(photo['id']==event['id'] for photo in pin['photos']):pin['photos'].append({'id':event['id'],'file':event.get('file','')})
    for key,(at,status) in office.items():
        if _at_key(at)>field_times.get(key,(1,'')):pins[key]['status']=status
    return list(pins.values())


def _pin_number(pin):
    try:return (0,float(pin.get('no') or 0))
    except (ValueError,TypeError):return (1,str(pin.get('no') or ''))


def _display_time(value):
    # 엑셀에서 읽기 쉽게 이 PC 시각 '2026-10-16 22:18' 로(장부에는 원래 ISO 그대로 남는다).
    try:return datetime.fromisoformat(str(value).replace('Z','+00:00')).astimezone().strftime('%Y-%m-%d %H:%M') if value else ''
    except (ValueError,OverflowError,OSError):return str(value)


def _csv_cell(value):
    if isinstance(value,str) and (value.startswith(('\t','\r','\n')) or value.lstrip().startswith(('=','+','-','@'))):return "'"+value
    return value


def _write_csv(folder):
    out=io.StringIO(newline='');writer=csv.writer(out,lineterminator='\r\n');writer.writerow(CSV_COLUMNS)
    for pin in sorted(_pins(_read_events(folder)),key=_pin_number):
        replies=pin['replies']
        writer.writerow([_csv_cell(value) for value in [pin.get(field,'') for field in ('no','title','kind','prio','status','assignee','due')]+[_display_time(pin['firstAt']),_display_time(pin['lastAt'])]+[
            len(pin['photos']),replies[-1]['text'] if replies else '',pin['link']]])
    try:_atomic_write(_inside(folder,'현장기록_목록.csv'),out.getvalue().encode('utf-8-sig'))
    except PermissionError:pass  # 엑셀에서 열어 두었으면 다음 기록을 받을 때 다시 만든다.


def _atomic_write(target,body):
    target.parent.mkdir(parents=True,exist_ok=True)
    temp=target.with_name(target.name+'.'+uuid.uuid4().hex+'.tmp')
    try:
        with temp.open('wb') as stream:stream.write(body)
        os.replace(temp,target)
    finally:
        try:temp.unlink(missing_ok=True)
        except OSError:pass


def _write_photo(folder,relative,body):
    digest=hashlib.sha256(body).hexdigest();name=Path(relative)
    index=1;temp=None
    try:
        while True:
            suffix='' if index==1 else '_'+str(index)
            target=_inside(folder,name.with_name(name.stem+suffix+name.suffix))
            if target.exists():
                if hashlib.sha256(target.read_bytes()).hexdigest()==digest:break
                index+=1;continue
            if temp is None:
                target.parent.mkdir(parents=True,exist_ok=True)
                temp=target.with_name(target.name+'.'+uuid.uuid4().hex+'.tmp')
                with temp.open('wb') as stream:stream.write(body)
            try:os.rename(temp,target);break  # Windows/NAS에서 대상이 생기면 덮어쓰지 않고 실패한다.
            except FileExistsError:pass  # 방금 다른 PC가 쓴 내용도 확인하고, 다르면 다음 번호로 간다.
    finally:
        if temp is not None:
            try:temp.unlink(missing_ok=True)
            except OSError:pass
    return target,digest


def _unique_file(folder,relative):
    path=_inside(folder,relative);index=2
    while path.exists():
        path=_inside(folder,str(Path(relative).with_name(Path(relative).stem+'_'+str(index)+Path(relative).suffix)));index+=1
    return path


def _decode(data,limit,signature,label):
    value=data.get('data')
    if not isinstance(value,str) or len(value)>4*((limit+2)//3):raise ValueError(label+' 파일 크기가 너무 크거나 형식이 올바르지 않습니다.')
    try:body=base64.b64decode(value,validate=True)
    except (ValueError,binascii.Error) as error:raise ValueError(label+'의 base64 형식이 올바르지 않습니다.') from error
    if len(body)>limit or not body.startswith(signature):raise ValueError(label+' 파일만 지정한 크기 이하로 저장할 수 있습니다.')
    return body


def _event_id(value):
    if not isinstance(value,str) or not value.strip():raise ValueError('기록 id는 비어 있지 않은 문자열이어야 합니다.')
    return value


def _validate_append(data):
    batch=data.get('events')
    if not isinstance(batch,list) or len(batch)>500:raise ValueError('사건은 한 번에 500개 이하의 목록으로 보내세요.')
    # 요청 전체를 검사한 뒤 기록한다. 뒤쪽 오류 때문에 앞쪽만 저장하지 않는다.
    for event in batch:
        if not isinstance(event,dict):raise ValueError('사건은 JSON 객체여야 합니다.')
        _event_id(event.get('id'))
        if len(_json_bytes(event))>64*1024:raise ValueError('사건 하나는 64 KB 이하여야 합니다.')
        if not isinstance(event.get('kind'),str) or event['kind'] not in PLAIN_KINDS|{'pin','measure'}:raise ValueError('지원하지 않는 사건 종류입니다.')
        if event.get('at') is not None and not isinstance(event['at'],str):raise ValueError('사건 시각은 문자열이어야 합니다.')
        if 'link' in event and not isinstance(event['link'],str):raise ValueError('링크 id는 문자열이어야 합니다.')
        if 'pin' in event:_event_id(_pin_id(event['pin']))
        if event['kind']=='pin':
            pin=event.get('pin')
            if not isinstance(pin,dict):raise ValueError('핀 내용은 JSON 객체여야 합니다.')
            _event_id(pin.get('id'))
            if pin.get('photos') is not None and not isinstance(pin['photos'],list):raise ValueError('핀 사진은 목록이어야 합니다.')
        elif event['kind']=='measure' and not isinstance(event.get('measure',event.get('data',{})),dict):raise ValueError('실측 내용은 JSON 객체여야 합니다.')
    return batch


def _append(data,folder):
    batch=_validate_append(data)
    events=_read_events(folder);ids={event['id'] for event in events};states=_field_states(events);added=[]
    latest={(event.get('link',''),_pin_id(event.get('pin'))):_at_key(event.get('at')) for event in events
            if event['kind'] in ('pin.received','pin.changed')}
    for raw in batch:
        if raw['id'] in ids:continue
        event=_stamp(raw)
        if event['kind']=='pin':
            pin=event.pop('pin');key=(event.get('link',''),pin['id']);prev=states.get(key)
            event['pin']=pin['id']
            if prev is None:event.update(kind='pin.received',data=pin)
            else:
                changes={}
                for field in PIN_FIELDS:
                    before=prev.get(field);after=pin.get(field)
                    if field=='photos':before=_photo_ids(before);after=_photo_ids(after)
                    if before!=after:changes[field]={'from':before,'to':after}
                if not changes:continue
                # 시각이 뒤섞여 도착해도 나중 사건이 생략한 칸을 복원하도록 전체 값도 보존한다.
                event.update(kind='pin.changed',changes=changes,data=pin)
            if prev is None or _at_key(event['at'])>=latest[key]:
                states[key]=copy.deepcopy(pin);latest[key]=_at_key(event['at'])
        elif event['kind']=='measure':
            event['kind']='measure.received';event['data']=event.pop('measure',event.get('data',{}))
        ids.add(event['id']);added.append(event)
    folder.mkdir(parents=True,exist_ok=True);_append_events(folder,added)
    if added:_write_csv(folder)
    return {'added':len(added),'skipped':len(batch)-len(added)}


def _photo(data,folder):
    eid=_event_id(data.get('id'))
    for event in _read_events(folder):
        if event['id']==eid:
            if event['kind']!='photo.saved':raise ValueError('이미 다른 기록에 사용한 id입니다.')
            return {'file':event['file'],'existed':True}
    if not isinstance(data.get('link',''),str):raise ValueError('링크 id는 문자열이어야 합니다.')
    _event_id(data.get('pinId'))
    body=_decode(data,8*1024*1024,b'\xff\xd8\xff','JPEG 사진')
    at=_local_time(data.get('takenAt'))
    try:number=int(data.get('pinNo') or 0)
    except (ValueError,TypeError,OverflowError) as error:raise ValueError('핀 번호는 정수여야 합니다.') from error
    stem=at.strftime('%Y-%m-%d_%H%M')+f'_핀{number:02d}_'+_safe_name(data.get('pinKind'),20)+'_'+_safe_name(eid[:6],6)
    target,digest=_write_photo(folder,f'사진/{stem}.jpg',body)
    relative=target.relative_to(_resolved(folder)).as_posix()
    event=_stamp({'id':eid,'kind':'photo.saved','link':data.get('link',''),'pin':data.get('pinId'),
                  'file':relative,'sha256':digest,'bytes':len(body)})
    _append_events(folder,[event]);_write_csv(folder)
    return {'file':relative,'existed':False}


def _photo_get(data,folder):
    relative=data.get('file')
    # 사진 id 로 찾기(권장): 폴더를 합치며 파일 이름이 바뀌어도 장부의 photo.saved 가 맞는 파일을 가리킨다.
    if data.get('id') is not None:
        pid=_event_id(data.get('id'))
        relative=next((event.get('file') for event in reversed(_read_events(folder)) if event['id']==pid and event['kind']=='photo.saved'),None)
        if relative is None:raise ValueError('저장된 사진이 없습니다.')
    if not isinstance(relative,str) or not re.fullmatch(r'사진[/\\][^/\\:<>"|?*\x00-\x1f]+\.jpg',relative,re.IGNORECASE):
        raise ValueError('사진 폴더 안의 JPG 파일만 읽을 수 있습니다.')
    target=_inside(folder,relative.replace('\\','/'))
    if not target.is_file():raise ValueError('저장된 사진이 없습니다.')
    return {'data':base64.b64encode(target.read_bytes()).decode('ascii')}


def _link(data,folder):
    link=data.get('link')
    if not isinstance(link,dict):raise ValueError('링크 내용은 JSON 객체여야 합니다.')
    _event_id(link.get('id'))
    # 현재 상태 파일에 열쇠가 섞이지 않도록 공개 상태 칸만 남긴다.
    public={key:link[key] for key in ('id','name','scope','hours','createdAt','expiresAt','revokedAt','endedAt') if key in link}
    stem=_local_time(link.get('createdAt')).strftime('%Y-%m-%d_%H%M')+'_'+_safe_name(link['id'][:8])
    target=_inside(folder,'링크/'+stem+'.json');_atomic_write(target,_json_bytes(public)+b'\n')
    return {'file':target.relative_to(_resolved(folder)).as_posix()}


def _report(data,folder,request_id=None):
    eid='report:'+(request_id or uuid.uuid4().hex)
    for event in _read_events(folder):
        if event['id']==eid and event['kind']=='report.made':return {'file':event['file']}
    body=_decode(data,30*1024*1024,b'%PDF','PDF 보고서')
    name=str(data.get('name') or '펀치리스트')
    if name.lower().endswith('.pdf'):name=name[:-4]
    target=_unique_file(folder,'펀치리스트/'+_safe_name(name)+'.pdf');_atomic_write(target,body)
    relative=target.relative_to(_resolved(folder)).as_posix()
    _append_events(folder,[_stamp({'id':eid,'kind':'report.made','file':relative})]);_write_csv(folder)
    return {'file':relative}


def _folder_key(folder):
    return os.path.normcase(os.path.abspath(folder))


def _remember_move(before,dest):
    _MOVED_FOLDERS.pop(_folder_key(dest['folder']),None)
    _MOVED_FOLDERS[_folder_key(before)]=(dict(dest),time.monotonic()+600)


def _redirect_folder(result):
    now=time.monotonic()
    for key,(_,expires) in list(_MOVED_FOLDERS.items()):
        if expires<=now:del _MOVED_FOLDERS[key]
    seen=set()
    while _folder_key(result['folder']) not in seen:
        key=_folder_key(result['folder']);seen.add(key)
        if key not in _MOVED_FOLDERS:break
        result=dict(_MOVED_FOLDERS[key][0])
    return result


def _move(data):
    source=folder_for({'drawingPath':data.get('fromPath'),'drawingName':data.get('fromName'),'draftKey':data.get('fromDraftKey')})
    dest=folder_for({'drawingPath':data.get('toPath'),'drawingName':data.get('toName'),'draftKey':data.get('toDraftKey')})
    before=Path(source['folder']);after=Path(dest['folder']);result={**dest,'moved':False}
    if _resolved(before)==_resolved(after):return result
    if _resolved(before).is_relative_to(_resolved(after)) or _resolved(after).is_relative_to(_resolved(before)):
        raise ValueError('기록함의 하위 폴더로 기록함을 옮길 수 없습니다.')
    with ExitStack() as stack:
        for folder in sorted((before,after),key=lambda p:os.path.normcase(str(_resolved(p)))):stack.enter_context(_lock(folder))
        if not before.is_dir():return result
        if not after.exists():
            after.parent.mkdir(parents=True,exist_ok=True);shutil.move(str(before),str(after))
        else:
            # 원본은 남긴다. 충돌한 파일명과 함께 장부의 상대 참조도 바꾼다.
            files={}
            for dirname in ('사진','링크','펀치리스트'):
                for path in sorted((before/dirname).rglob('*')):
                    if not path.is_file():continue
                    relative=path.relative_to(before).as_posix();_inside(before,relative)
                    body=path.read_bytes()
                    if dirname=='사진':target,_=_write_photo(after,relative,body)
                    else:target=_unique_file(after,relative);_atomic_write(target,body)
                    files[relative]=target.relative_to(_resolved(after)).as_posix()
            ids={event['id'] for event in _read_events(after)};incoming=[]
            for event in _read_events(before):
                if event['id'] in ids:continue
                event=copy.deepcopy(event)
                if event.get('file') in files:event['file']=files[event['file']]
                # 옮겨 적은 줄도 이 PC의 저장 시각·PC 이름을 남긴다.
                incoming.append(_stamp(event));ids.add(event['id'])
            _append_events(after,incoming)
        _remember_move(before,dest)
        at=_now()
        _append_events(after,[_stamp({'id':'move:'+at+':'+uuid.uuid4().hex,'kind':'folder.moved','from':str(before),'to':str(after)})])
        _write_csv(after)
    return {**dest,'moved':True}


def _spool_folder():
    override=os.environ.get('BARUN_FIELD_RECORDS_SPOOL')
    if override:return Path(override)
    return Path(os.environ.get('LOCALAPPDATA') or tempfile.gettempdir())/'BarunCAD'/'field-records-spool'


def _spool_files():
    return sorted(_spool_folder().glob('*.json'),key=lambda item:item.name)


def _enqueue(data,request_id=None):
    body=_json_bytes(data);folder=_spool_folder();folder.mkdir(parents=True,exist_ok=True)
    # 시계가 뒤로 가거나 같은 시각에 요청이 와도 기존 대기 파일 뒤에 붙인다.
    stamps=[int(item.name.split('_',1)[0]) for item in _spool_files() if item.name.split('_',1)[0].isdigit()]
    stamp=max([time.time_ns()]+[value+1 for value in stamps])
    target=folder/(f'{stamp:020d}_'+(request_id or uuid.uuid4().hex)+'.json')
    temp=target.with_suffix('.tmp')
    try:
        with temp.open('wb') as stream:stream.write(body)
        os.replace(temp,target)
    finally:
        try:temp.unlink(missing_ok=True)
        except OSError:pass
    return target


def drain_spool():
    """이름순으로 재실행한다. 완료 결과와 마지막 저장 오류를 호출자에게 돌려준다."""
    completed={};error=''
    with _SPOOL_LOCK:
        for item in _spool_files():
            try:
                request_id=item.stem.rsplit('_',1)[-1]
                if item.name in _QUEUED_FOLDERS:
                    _QUEUED_FOLDERS[item.name]=_redirect_folder(_QUEUED_FOLDERS[item.name])
                result=process(json.loads(item.read_bytes()),_replay=True,_request_id=request_id,_folder=_QUEUED_FOLDERS.get(item.name))
            except (ValueError,UnicodeError) as invalid:
                try:
                    bad=item.parent/'bad';bad.mkdir(parents=True,exist_ok=True)
                    target=bad/item.name
                    if target.exists():target=bad/(item.stem+'_'+uuid.uuid4().hex+'.json')
                    os.replace(item,target)
                except OSError as failure:error=str(failure);break
                _QUEUED_FOLDERS.pop(item.name,None)
                completed[item.name]=ValueError(str(invalid));continue
            except OSError as failure:error=str(failure);break
            try:item.unlink()
            except OSError as failure:error=str(failure);break
            _QUEUED_FOLDERS.pop(item.name,None)
            completed[item.name]=result
    return completed,error


def _spooled_result(data,error,folder=None):
    if folder is not None:return {**_redirect_folder(dict(folder)),'spooled':True,'error':error}
    target=data
    if data['action']=='move':target={'drawingPath':data.get('toPath'),'drawingName':data.get('toName'),'draftKey':data.get('toDraftKey')}
    result=folder_for(target,_check_parent=False)
    if data['action'] in _WRITE_ACTIONS-{'move'}:result=_redirect_folder(result)
    return {**result,'spooled':True,'error':error}


def _validate_write(data):
    """장애 중에도 잘못된 요청을 성공으로 접수하지 않도록 I/O 없이 검사한다."""
    action=data['action']
    if action=='append':_validate_append(data)
    elif action=='photo':
        _event_id(data.get('id'));_event_id(data.get('pinId'))
        if not isinstance(data.get('link',''),str):raise ValueError('링크 id는 문자열이어야 합니다.')
        _decode(data,8*1024*1024,b'\xff\xd8\xff','JPEG 사진');_local_time(data.get('takenAt'))
        try:int(data.get('pinNo') or 0)
        except (ValueError,TypeError,OverflowError) as error:raise ValueError('핀 번호는 정수여야 합니다.') from error
    elif action=='link':
        link=data.get('link')
        if not isinstance(link,dict):raise ValueError('링크 내용은 JSON 객체여야 합니다.')
        _event_id(link.get('id'));_local_time(link.get('createdAt'));_json_bytes(link)
    elif action=='report':_decode(data,30*1024*1024,b'%PDF','PDF 보고서')
    elif action=='move':
        source=folder_for({'drawingPath':data.get('fromPath'),'drawingName':data.get('fromName'),'draftKey':data.get('fromDraftKey')},_check_parent=False)
        dest=folder_for({'drawingPath':data.get('toPath'),'drawingName':data.get('toName'),'draftKey':data.get('toDraftKey')},_check_parent=False)
        before=Path(_folder_key(source['folder']));after=Path(_folder_key(dest['folder']))
        if before!=after and (before.is_relative_to(after) or after.is_relative_to(before)):
            raise ValueError('기록함의 하위 폴더로 기록함을 옮길 수 없습니다.')


def process(data,*,_replay=False,_request_id=None,_folder=None):
    if not isinstance(data,dict):raise ValueError('현장 기록 요청은 JSON 객체여야 합니다.')
    action=data.get('action')
    if not isinstance(action,str) or action not in ('append','photo','link','read','photo-get','folder','move','report'):
        raise ValueError('지원하지 않는 현장 기록 작업입니다.')
    if _replay:
        result=_process(data,_request_id=_request_id,_folder=_folder)
        # 앞선 시도에서 장부까지만 썼더라도 CSV가 복구되기 전에는 대기 파일을 지우지 않는다.
        folder=Path(result['folder'])
        if action in {'append','photo','report'} or (action=='move' and folder.is_dir()):
            with _lock(folder):_write_csv(folder)
        return result
    with _SPOOL_LOCK:
        route=None
        if action in _WRITE_ACTIONS-{'move'}:
            original=folder_for(data,_check_parent=False);redirected=_redirect_folder(original)
            if redirected!=original:route=redirected
        if action in _WRITE_ACTIONS and _spool_files():
            # 새 쓰기도 먼저 보관해야 앞선 장애 요청을 추월하지 않는다.
            _validate_write(data)
            queued=_enqueue(data)
            if route is not None:_QUEUED_FOLDERS[queued.name]=route
            completed,error=drain_spool()
            result=completed.get(queued.name)
            if isinstance(result,ValueError):raise result
            if result is None:result=_spooled_result(data,error,route)
        else:
            drain_spool()
            request_id=uuid.uuid4().hex
            try:result=_process(data,_request_id=request_id,_folder=route)
            except OSError as failure:
                if action not in _WRITE_ACTIONS:raise
                _validate_write(data)
                queued=_enqueue(data,request_id)
                # 이동 유예 중 받은 요청은 대기가 10분을 넘겨도 접수한 목적지를 유지한다.
                if route is not None:_QUEUED_FOLDERS[queued.name]=route
                result=_spooled_result(data,str(failure),route)
        result['spoolPending']=len(_spool_files())
        return result


def _process(data,*,_request_id=None,_folder=None):
    action=data['action']
    if action=='move':return _move(data)
    if _folder is not None:result=_redirect_folder(dict(_folder))
    elif action in _WRITE_ACTIONS:
        original=folder_for(data,_check_parent=False);result=_redirect_folder(original)
        if result==original:result=folder_for(data)
    else:result=folder_for(data)
    folder=Path(result['folder'])
    with _lock(folder):
        if action=='append':result.update(_append(data,folder))
        elif action=='photo':result.update(_photo(data,folder))
        elif action=='link':result.update(_link(data,folder))
        elif action=='read':
            events=_read_events(folder);result.update(events=events,pins=_pins(events))
        elif action=='photo-get':result.update(_photo_get(data,folder))
        elif action=='folder':folder.mkdir(parents=True,exist_ok=True)
        elif action=='report':result.update(_report(data,folder,_request_id))
    return result
