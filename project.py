"""Local project storage; only CAD files and named project settings are exposed."""
from pathlib import Path
import json, os, tempfile

DEFAULTS = {'paper':'A3','denominator':100,'textHeight':250,'paperTextHeight':2.5,'colorMode':'mono','projectName':'','author':'','layerStandard':[]}
CONFIG = '.barun-cad.json'

def network_path(value):
    r"""감사 2: \\컴퓨터\공유 경로는 여는 순간 윈도우가 그 컴퓨터에 로그인 정보(NTLM)를 보낸다.
    사무실 NAS(사설·Tailscale IP, 점 없는 이름)만 허락하고 바깥 주소·장치 경로(\\?\, \\.\)는 거절한다."""
    text=str(value or '')
    if not (text.startswith('\\\\') or text.startswith('//')):return
    import ipaddress,re
    host=re.split(r'[\\/]',text[2:],maxsplit=1)[0]
    try:ip=ipaddress.ip_address(host);local=ip.is_private or ip in ipaddress.ip_network('100.64.0.0/10')
    except ValueError:local=bool(re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_-]{0,62}',host))
    if not local:raise ValueError('바깥 네트워크 주소의 공유 폴더는 쓸 수 없습니다. 사무실 NAS 나 로컬 드라이브를 쓰세요.')

def folder(value):
    network_path(value)
    p=Path(value).expanduser()
    if not p.is_absolute(): raise ValueError('프로젝트 폴더는 절대 경로를 입력하세요.')
    p=p.resolve()
    if not p.is_dir(): raise ValueError('존재하는 프로젝트 폴더를 지정하세요.')
    return p

def atomic(path, data):
    fd,temp=tempfile.mkstemp(prefix='.cad-',dir=path.parent)
    try:
        # S15: 바꿔치기 전에 디스크까지 내려써야 정전·강제 종료 뒤에도 빈 파일이 남지 않는다.
        with os.fdopen(fd,'wb') as f:
            f.write(data); f.flush(); os.fsync(f.fileno())
        os.replace(temp,path)
    finally:
        if os.path.exists(temp): os.unlink(temp)

def settings(path):
    p=folder(path); values=dict(DEFAULTS); sources=[]
    for parent in [*reversed(p.parents),p]:
        f=parent/CONFIG
        if f.exists():
            v=json.loads(f.read_text(encoding='utf-8-sig'))
            if not isinstance(v,dict): raise ValueError(str(f)+' 설정 형식 오류')
            values.update(v); sources.append(str(f))
    return {'folder':str(p),'settings':values,'sources':sources,'files':sorted(f.name for f in p.iterdir() if f.is_file() and f.suffix.lower() in ('.dxf','.dwg','.bcad','.pdf','.xlsx'))}

def update(path, values):
    p=folder(path)
    if values.get('paper','A3') not in ('A1','A3','A4'): raise ValueError('용지는 A1/A3/A4입니다.')
    for key in ('textHeight','paperTextHeight','denominator'):
        if key in values and not 0<float(values[key])<1e7: raise ValueError(key+'는 양수입니다.')
    atomic(p/CONFIG,json.dumps(values,ensure_ascii=False,indent=2).encode('utf-8'))
    return settings(str(p))

def target(path,name,base_folder=None):
    if base_folder is not None:
        base=folder(base_folder)
        if Path(path).is_absolute():raise ValueError('상대 경로 모드에서는 프로젝트 기준 상대 폴더를 입력하세요.')
        path=str((base/path).resolve())
    p=folder(path)
    if not name or Path(name).name!=name or any(c in name for c in '/\\:'): raise ValueError('파일 이름만 입력하세요.')
    f=(p/name).resolve()
    if f.parent!=p or f.suffix.lower() not in ('.dxf','.dwg','.bcad','.pdf','.xlsx'): raise ValueError('지원하지 않는 파일 이름')
    return f

def save(path,name,content,transaction=None,assert_current=None):
    import safe_writes
    f=target(path,name)
    if transaction is not None:
        if transaction.target != f:
            raise ValueError('저장 예약 대상이 일치하지 않습니다.')
        return transaction.save(content,assert_current=assert_current)
    with safe_writes.reserve(f,assert_current=assert_current) as reserved:
        return reserved.save(content)
