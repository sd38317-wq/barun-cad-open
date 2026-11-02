"""Development-only local site-plan job mock."""
import copy, json, os, threading, time, uuid
MOCK_ENABLED="BARUN_SITE_PLAN_MOCK"
MOCK_DELAY_SECONDS=6.0
MOCK_MAX_JOBS=64
MOCK_MAX_BYTES=2_000_000
_JOBS={}
_LOCK=threading.RLock()
_WARNING="개발용 모의 응답입니다. 설계 계산 결과가 아닙니다."
def enabled(): return os.environ.get(MOCK_ENABLED)=="1"
def _purge():
    now=time.monotonic()
    with _LOCK:
        for jid,j in list(_JOBS.items()):
            if now-j["created"]>900: _JOBS.pop(jid,None)
def _shape(spec):
    parcel=copy.deepcopy((spec.get("site") or {}).get("parcel") or [])
    if len(parcel)<3: raise ValueError("대지 외곽이 필요합니다.")
    xs=[p[0] for p in parcel]; ys=[p[1] for p in parcel]; lx,hx,ly,hy=min(xs),max(xs),min(ys),max(ys)
    px,py=max((hx-lx)*.15,.5),max((hy-ly)*.15,.5); x1,x2,y1,y2=lx+px,hx-px,ly+py,hy-py
    if x2<=x1 or y2<=y1: x1,x2,y1,y2=lx,hx,ly,hy
    return parcel,[[x1,y1],[x2,y1],[x2,y2],[x1,y2]]
def result(spec):
    parcel,footprint=_shape(spec); floors=max(1,int((spec.get("program") or {}).get("floors") or 1)); height=round(floors*float((spec.get("program") or {}).get("floor_h") or 3.6),2)
    area=abs(sum(a[0]*b[1]-b[0]*a[1] for a,b in zip(footprint,footprint[1:]+footprint[:1])))/2; gfa=round(area*floors,2)
    geom={"footprint":footprint,"floors":[copy.deepcopy(footprint) for _ in range(floors)],"walkways":[],"landscape":[],"stalls":[],"parking_mode":"none","units":"m"}
    entities=[{"type":"LWPOLYLINE","layer":"A-SITE","points":parcel,"closed":True},{"type":"LWPOLYLINE","layer":"A-BLDG","points":copy.deepcopy(footprint),"closed":True},{"type":"TEXT","layer":"A-TEXT","text":"개발용 예시 · 설계 결과 아님","position":footprint[0],"height":.5}]
    report={"mode":"generate","checks":[{"id":"mock-example","rule":"개발용 예시 · 법규 미검토","ok":False,"provisional":True,"severity":"info","message":_WARNING}],"warnings":[_WARNING],"numbers":{"floors":floors,"height":height,"building_area":round(area,2),"gfa":gfa,"far":None,"bcr":None,"parking_placed":0,"parking_required":None},"geometry":geom,"sunlight":{"applies":False},"meta":{"mock":True,"warning":_WARNING}}
    return {"report":report,"entities":{"units":"m","crs":"EPSG:5187","layers":{"A-SITE":{"color":7},"A-BLDG":{"color":4},"A-BLDG-L1":{"color":4},"A-BLDG-UP":{"color":4},"A-TEXT":{"color":7}},"entities":entities},"meta":{"mock":True,"warning":_WARNING}}
def generate(spec):
    if not enabled(): return None
    _purge()
    if not isinstance(spec,dict): raise ValueError("배치 요청을 확인하세요.")
    if len(json.dumps(spec,ensure_ascii=False).encode())>MOCK_MAX_BYTES: raise ValueError("모의 작업 요청이 너무 큽니다.")
    with _LOCK:
        if len(_JOBS)>=MOCK_MAX_JOBS: raise RuntimeError("모의 작업 보관 한도에 도달했습니다.")
        jid=uuid.uuid4().hex; _JOBS[jid]={"created":time.monotonic(),"spec":copy.deepcopy(spec)}
    return {"job_id":jid,"status":"queued","meta":{"mock":True,"warning":_WARNING}}
def status(job_id):
    if not enabled(): return None
    _purge()
    with _LOCK: job=copy.deepcopy(_JOBS.get(job_id))
    if not job: return {"error":"모의 작업을 찾을 수 없습니다."},404
    elapsed=max(0,time.monotonic()-job["created"])
    if elapsed<MOCK_DELAY_SECONDS: return {"job_id":job_id,"status":"running","elapsed_seconds":round(elapsed,1),"meta":{"mock":True,"warning":_WARNING}},200
    return {"job_id":job_id,"status":"succeeded","elapsed_seconds":round(elapsed,1),"meta":{"mock":True,"warning":_WARNING},"result":result(job["spec"])},200
