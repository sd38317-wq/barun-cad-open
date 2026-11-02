"""미리 도구가 돌려준 그림을 대화창에 보이게(2026-10-30 대표 "추천대로해" — docs/시안-미리그림보기-2026-10-30).
그림은 이 PC 사용자 폴더(chat-images)에 파일로 두고, 대화 이벤트에는 작은 참조({id,caption})만 싣는다(이벤트마다 base64 를 싣지 않는다).
대화 기록을 다시 열면 같은 id 로 읽고, 지워졌으면 화면이 '그림 없음' 칸을 보인다. 오래된 그림은 KEEP 장까지만 남긴다."""
import base64,binascii,os,re,threading,uuid
from pathlib import Path
import bridge

FOLDER=Path(os.environ.get('LOCALAPPDATA',str(Path.home())))/'BarunCAD'/'chat-images'
KEEP=300;MAX_BYTES=20_000_000;JOB_KEEP=200
EXT={'image/png':'.png','image/jpeg':'.jpg'};MIME={v:k for k,v in EXT.items()}
_jobs={};_lock=threading.Lock()   # job_id → (도구 이름, 인자): Codex 는 오래 걸리는 도구를 cad_get_job 으로 받아 원래 이름을 모른다

def caption(name,args,result):
    """그림 아래 이름: 무엇을 본 그림인지(건물 전체 / 4F 실내 / 일조 동지 12:00 …)."""
    r=result if isinstance(result,dict) else {};args=args if isinstance(args,dict) else {}
    if name=='cad_view_interior' or 'eye' in r:
        floor=args.get('floor') or next((a.get('value') for a in r.get('assumed') or [] if isinstance(a,dict) and a.get('key')=='floor'),None)
        return (str(floor)+' 실내') if floor else '실내'
    if name=='cad_wind_check' or 'imageDirection' in r:
        label=(r.get('imageDirection') or {}).get('label')
        return '풍동 · '+str(label) if label else '풍동 검토'
    if name=='cad_sun_study' or 'dayLabel' in r:return ' '.join(str(v) for v in ('일조',r.get('dayLabel'),r.get('time')) if v)
    if name=='cad_view_3d' or 'boundsMm' in r:return '건물 전체'
    if name=='cad_view_drawing' or 'mmPerPixel' in r:return '도면 살펴보기'
    if name.startswith('cad_structure') or 'setId' in r:return '구조 미리보기'
    return '그림'

def from_tool(name,args,result):
    """도구 결과 → (그림 뺀 결과, 그림, 화면 참조). 그림이 없으면 참조는 None. 그림을 못 남겨도 도구 결과는 그대로 쓴다."""
    args=args if isinstance(args,dict) else {}
    if isinstance(result,dict) and result.get('status')=='running' and isinstance(result.get('job_id'),str):
        with _lock:
            _jobs[result['job_id']]=(name,args)
            while len(_jobs)>JOB_KEEP:_jobs.pop(next(iter(_jobs)))
    if name=='cad_get_job':
        with _lock:name,args=_jobs.get(str(args.get('job_id')),(name,args))
    shown,image=bridge.extract_tool_image(result)
    if not isinstance(image,dict):return shown,None,None
    body=shown.get('result') if isinstance(shown,dict) and shown.get('status')=='completed' else shown
    try:return shown,image,store(image,caption(name,args,body))
    except (OSError,ValueError):return shown,image,None

def store(image,label):
    ext=EXT.get(image.get('mimeType'))
    if not ext:raise ValueError('그림 형식이 아닙니다.')
    try:raw=base64.b64decode(str(image.get('data') or ''),validate=True)
    except (binascii.Error,ValueError) as error:raise ValueError('그림 자료가 올바르지 않습니다.') from error
    if not raw or len(raw)>MAX_BYTES:raise ValueError('그림 크기가 올바르지 않습니다.')
    FOLDER.mkdir(parents=True,exist_ok=True)
    identifier=uuid.uuid4().hex;target=FOLDER/(identifier+ext);temp=target.with_suffix('.tmp')
    temp.write_bytes(raw);os.replace(temp,target)
    old=sorted((p for p in FOLDER.iterdir() if p.suffix in MIME),key=lambda p:p.stat().st_mtime)
    for path in old[:-KEEP]:path.unlink(missing_ok=True)
    return {'id':identifier,'caption':label,'mimeType':image['mimeType']}

def read(identifier):
    """화면이 id 로 그림을 받는다. 없으면 missing(대화 기록의 '그림 없음' 칸)."""
    if not isinstance(identifier,str) or not re.fullmatch(r'[0-9a-f]{32}',identifier):raise ValueError('그림 번호가 올바르지 않습니다.')
    for ext,mime in MIME.items():
        path=FOLDER/(identifier+ext)
        if path.is_file():return {'id':identifier,'mimeType':mime,'data':base64.b64encode(path.read_bytes()).decode('ascii')}
    return {'id':identifier,'missing':True}
