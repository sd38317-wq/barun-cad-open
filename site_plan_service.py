"""Transport adapter for SPEC v0.5.3. No planning or regulatory calculations."""
import json
import math
import urllib.request
import urllib.error
import urllib.parse
import base64
import site_plan_mock
from parcel_service import BASE, auth_headers, remote_error
JOB_TIMEOUT=15
ARTIFACT_TIMEOUT=45
MAX_ARTIFACT_BYTES=50_000_000
_JOB_ID=r'^[0-9a-fA-F]{32}$'


def boundary_entities(data):
    """Imported parcel tags take priority; standard CAD layers also carry boundaries."""
    layers={layer.get('id'):str(layer.get('name','')).upper() for layer in data.get('layers',[])}
    entities=[]
    def visit(e):
        if e.get('type')=='block':
            for child in e.get('entities',[]):visit(child)
        elif e.get('type') in ('polyline','rectangle'):entities.append(e)
    for e in data.get('entities',[]):visit(e)
    tagged=any(e.get('parcelRole')=='site' for e in entities)
    result=[]
    for e in entities:
        role=e.get('parcelRole')
        name=layers.get(e.get('layer'),str(e.get('layer','')).upper())
        if role not in ('site','road','neighbor'):
            if e.get('sitePlanId'):continue  # generated layout copies are not source parcel boundaries
            role='site' if not tagged and name in ('A-SITE','A-SITE-BND','A-SITE-BNDY') else 'road' if name in ('A-ROAD','A-SITE-ROAD') else None
        if role:result.append({**e,'parcelRole':role})
    return result


def drawing_frame(data, source):
    attrs=source.get('attributes') or {}
    origin=attrs.get('originMetres')
    if attrs.get('sourceCRS') in ('EPSG:5179','EPSG:5187') and isinstance(origin,list) and len(origin)==2:
        return attrs['sourceCRS'],origin,source['points'][0],False
    geo=data.get('drawingGeo') or {}
    if geo.get('crs') in ('EPSG:5179','EPSG:5187') and isinstance(geo.get('originM'),list) and len(geo['originM'])==2:
        if geo.get('rotationDeg',0)!=0:raise ValueError('회전된 도면의 대지 좌표 정합을 확인하세요.')
        return geo['crs'],geo['originM'],{'x':0,'y':0},False
    # A local drawing has shape and scale, but no surveyed geographic origin.
    # This is only a translated planning frame; callers must disclose it.
    return 'EPSG:5187',[200000,400000],source['points'][0],True

# 웹 프록시(barun sitePlanProxy)가 엔진을 260초(대기열 60 + 계산 180 + 여유) 기다린다. 그보다 조금 길게 잡아 웹의 시간초과 응답을 받는다.
ENGINE_WAIT_SECONDS = 270


def from_drawing(data):
    """Use edited cadastral rings or closed A-SITE CAD geometry (drawing unit mm)."""
    import korea_crs
    if data.get('units','mm')!='mm':raise ValueError('대지 도면은 mm 단위여야 합니다.')
    entities=boundary_entities(data)
    sites=[e for e in entities if e.get('parcelRole')=='site']
    if not sites:raise ValueError('배치할 대지 외곽이 필요합니다. A-SITE 레이어에 닫힌 폴리선을 그리거나 주소로 대지를 가져오세요.')
    if any((e.get('attributes') or {}).get('ring')=='hole' for e in sites):
        raise ValueError('주소로 가져온 필지 안에 다른 땅(구멍)이 있어 자동 배치가 안 됩니다. 바깥 경계만 A-SITE 레이어에 닫힌 폴리선으로 다시 그리면 배치할 수 있습니다.')
    # Several untagged rings may be alternative sites or nested outlines. Do not union by guess.
    if len(sites)>1 and not any(e.get('parcelRole')=='site' for e in _tagged_entities(data)):
        raise ValueError('A-SITE 대지 외곽이 여러 개입니다. 배치할 외곽 하나를 남기거나 필지 역할을 지정해 주세요.')
    source=sites[0];attrs=source.get('attributes') or {}
    if not source.get('points'):raise ValueError('대지 경계 점이 필요합니다.')
    crs,origin,anchor,_=drawing_frame(data,source)
    if not isinstance(anchor,dict) or any(type(anchor.get(k)) not in (int,float) or not math.isfinite(anchor[k]) for k in ('x','y')):raise ValueError('대지 도면 좌표를 확인하세요.')
    if any(type(v) not in (int,float) or not math.isfinite(v) for v in origin):raise ValueError('대지 원점 좌표를 확인하세요.')
    transform=korea_crs.transformer(crs, 'EPSG:5187')
    def coords(e):
        if not (e.get('closed') or e.get('type')=='rectangle') or any(e.get('bulges',[])):
            raise ValueError('대지는 닫힌 직선 경계여야 합니다.')
        ps=[]
        for p in e.get('points',[]):
            if not isinstance(p,dict) or any(type(p.get(k)) not in (int,float) or not math.isfinite(p[k]) for k in ('x','y')):
                raise ValueError('대지 도면 좌표는 mm 단위 x·y 숫자여야 합니다.')
            ps.append(list(transform.transform(origin[0]+(p['x']-anchor['x'])/1000,origin[1]+(p['y']-anchor['y'])/1000)))
        if len(ps)>1 and ps[0]==ps[-1]:ps.pop()
        polygon(ps)
        ox,oy=ps[0]
        area=abs(sum((a[0]-ox)*(b[1]-oy)-(a[1]-oy)*(b[0]-ox) for a,b in zip(ps,ps[1:]+ps[:1])))/2
        if area<=1e-8:raise ValueError('면적이 있는 대지 외곽이 필요합니다.')
        return ps
    neighbors=[]
    for e in entities:
        if e.get('parcelRole')=='site':continue
        a=e.get('attributes') or {}
        if a.get('ring')=='hole':continue
        neighbors.append({'pnu':a.get('pnu',''),'jimok':'도' if e['parcelRole']=='road' else '', 'coords':coords(e)})
    return {'site':{'id':attrs.get('pnu','CAD-SITE'),'address':attrs.get('jibun',''),
                    'crs':'EPSG:5187','parcel':coords(source) if len(sites)==1 else merged_site([coords(e) for e in sites]),'neighbors':neighbors},
            'zoning':{'zone':'미확인','bcr':None,'far':None},
            'program':{'use':'근린생활시설','floors':3,'floor_h':3.6,'massing':'auto','shape':'auto','entry_side':'auto',
                       'parking':{'count':'auto','mode':'auto','layout':'auto','stall':'일반형'}}}


def parcel_snapshot_entities(data):
    """Match geometry.js parcelEntities IDs, including parcelGroup world-coordinate children."""
    def visit(e,owner=None):
        if e.get('type')=='block' and e.get('parcelGroup'):
            for child in e.get('entities',[]):yield from visit(child,e.get('id'))
        else:yield {**e,'id':str(owner)+':'+str(e.get('id'))} if owner else e
    for e in data.get('entities',[]):yield from visit(e)


def _tagged_entities(data):
    for e in data.get('entities',[]):
        if e.get('type')=='block':yield from _tagged_entities(e)
        else:yield e


def merged_site(rings):
    """여러 필지를 담은 대지(합필): 붙어 있는 필지를 대지 하나로 합친다. 지적 경계의 미세한 틈(10cm 미만)은 메운다."""
    from shapely.geometry import Polygon
    from shapely.ops import unary_union
    shape = unary_union([Polygon(r).buffer(0) for r in rings]).buffer(0.05, join_style=2).buffer(-0.05, join_style=2)
    if shape.geom_type != 'Polygon' or shape.interiors:
        raise ValueError('담은 필지들이 서로 붙어 있지 않거나 가운데가 비어 있어 대지 하나로 합칠 수 없습니다. 붙어 있는 필지만 담으세요.')
    ps = [[x, y] for x, y in shape.simplify(0.01).exterior.coords[:-1]]
    polygon(ps)
    return ps

def polygon(value):
    if not isinstance(value, list) or not 3 <= len(value) <= 10000:
        raise ValueError('다각형 꼭짓점을 확인하세요.')
    if any(not isinstance(p, list) or len(p) != 2 or any(type(v) not in (int, float) or not math.isfinite(v) for v in p) for p in value):
        raise ValueError('좌표는 대지 CRS의 미터 단위 [x,y]입니다.')


def payload(data, mode):
    if mode not in ('generate', 'validate') or not isinstance(data, dict):
        raise ValueError('배치 요청을 확인하세요.')
    allowed = {'site', 'zoning', 'program', 'output'} if mode == 'generate' else {'site', 'zoning', 'program', 'overrides'}
    if set(data) - allowed or any(not isinstance(data.get(k), dict) for k in ('site', 'zoning', 'program')):
        raise ValueError('SPEC §6 형식의 대지·용도지역·프로그램이 필요합니다.')
    if data['site'].get('crs') != 'EPSG:5187':
        raise ValueError('대지 좌표계는 EPSG:5187이어야 합니다.')
    polygon(data['site'].get('parcel'))
    if mode == 'validate':
        g = data.get('overrides')
        if not isinstance(g, dict) or 'building_rect' in g:
            raise ValueError('report.geometry 다각형 형식이 필요합니다.')
        if g.get('crs', 'EPSG:5187') != 'EPSG:5187' or g.get('units', 'm') != 'm':
            raise ValueError('재검증 좌표계와 단위를 확인하세요.')
        polygon(g.get('footprint'))
        for name in ('floors', 'walkways', 'landscape'):
            if name in g:
                if not isinstance(g[name], list): raise ValueError('다각형 목록을 확인하세요.')
                for ring in g[name]:
                    if name == 'floors' and ring == []: continue
                    polygon(ring)
        if g.get('rooftop_box'): polygon(g['rooftop_box'])
        if not isinstance(g.get('stalls'), list) or g.get('parking_mode') not in ('front', 'piloti', 'front_piloti', 'general', 'none'):
            raise ValueError('주차 구획과 방식을 확인하세요.')
        for stall in g['stalls']:
            if not isinstance(stall, dict) or type(stall.get('tandem')) is not bool or type(stall.get('group')) is not int:
                raise ValueError('주차 구획의 rect·tandem·group을 유지하세요.')
            polygon(stall.get('rect'))
    json.dumps(data, allow_nan=False)
    return data


def process(data, mode):
    if site_plan_mock.enabled() and mode == 'generate':
        import time as _mock_time
        _mock_time.sleep(site_plan_mock.MOCK_DELAY_SECONDS)
        return site_plan_mock.result(payload(data, mode)), 200
    body = payload(data, mode)
    headers = {'Content-Type': 'application/json', 'User-Agent': 'BarunCAD/3'}
    headers.update(auth_headers())   # [계정 연결] 토큰 + 예전 이메일 세션
    request = urllib.request.Request(BASE + '/site-plan/' + mode, data=json.dumps(body, allow_nan=False).encode('utf8'), headers=headers)
    try:
        with urllib.request.urlopen(request, timeout=ENGINE_WAIT_SECONDS) as response:
            raw = response.read(30_000_001)
        if len(raw) > 30_000_000: raise ValueError('배치 결과가 너무 큽니다.')
        result = json.loads(raw)
        report = result.get('report') if mode == 'generate' else result
        if not isinstance(report, dict) or not isinstance(report.get('checks'), list) or not isinstance(report.get('geometry'), dict):
            raise ValueError('v0.5.3 배치 응답이 아닙니다.')
        if mode == 'validate' and report.get('mode') != 'validate': raise ValueError('재검증 응답 모드를 확인하세요.')
        # 엔진은 후보를 못 찾아도(no_candidate) 200 과 빈 건물 바닥을 준다. 도면에 넣다 깨지지 않게 이유로 돌려준다.
        if mode == 'generate' and not report['geometry'].get('footprint'):
            return {'error': '설계엔진이 이 대지·조건에서 배치 후보를 찾지 못했습니다. 층수·주차 방식·목표 연면적을 바꿔 보세요.'}, 422
        return result, 200
    except urllib.error.HTTPError as error:
        return {'error': remote_error(error, '설계엔진')}, error.code
    except TimeoutError:
        return {'error': '설계엔진 응답 시간 초과: 배치 계산이 너무 오래 걸렸습니다. 잠시 후 다시 시도하세요. 기존 검증 결과는 갱신되지 않았습니다.'}, 504
    except (urllib.error.URLError, json.JSONDecodeError):
        return {'error': '설계엔진 연결 필요: 바른 서버 배치 엔진에 연결하지 못했습니다(인터넷 연결 확인). 기존 검증 결과는 갱신되지 않았습니다.'}, 502

_PLAN_IDS=frozenset(('max_far','max_bcr','efficiency','comparison'))
_ARTIFACT_RE=__import__('re').compile(r'^/site-plan/[0-9a-fA-F]{32}/(dxf|png|pdf)$')


def _json_request(url, method='GET', body=None, timeout=JOB_TIMEOUT, limit=30_000_000):
    h={'Content-Type':'application/json','User-Agent':'BarunCAD/3'}; h.update(auth_headers())
    data=None if body is None else json.dumps(body,allow_nan=False).encode('utf8')
    req=urllib.request.Request(url,data=data,headers=h,method=method)
    with urllib.request.urlopen(req,timeout=timeout) as r: raw=r.read(limit+1)
    if len(raw)>limit: raise ValueError('설계엔진 응답이 너무 큽니다.')
    return json.loads(raw)

def process_jobs(action, spec=None, job_id=None):
    if isinstance(action, dict):
        data=action; action=data.get('action'); spec=data.get('request'); job_id=data.get('jobId')
    try:
        if action=='submit':
            if site_plan_mock.enabled():
                if not isinstance(spec,dict): raise ValueError('배치 요청을 확인하세요.')
                return site_plan_mock.generate(payload(spec, 'generate')), 202
            if not isinstance(spec,dict): raise ValueError('배치 요청을 확인하세요.')
            result=_json_request(BASE+'/site-plan/jobs','POST',payload(spec,'generate')); jid=result.get('job_id')
            if not isinstance(jid,str) or not __import__('re').fullmatch(_JOB_ID,jid): raise ValueError('설계엔진 작업 번호가 올바르지 않습니다.')
            return result,202
        if action=='status':
            if site_plan_mock.enabled():
                if not isinstance(job_id,str) or not __import__('re').fullmatch(_JOB_ID,job_id): raise ValueError('설계엔진 작업 번호가 올바르지 않습니다.')
                mock_status = site_plan_mock.status(job_id)
                return mock_status
            if not isinstance(job_id,str) or not __import__('re').fullmatch(_JOB_ID,job_id): raise ValueError('설계엔진 작업 번호가 올바르지 않습니다.')
            return _json_request(BASE+'/site-plan/jobs/'+job_id),200
        raise ValueError('작업 동작이 올바르지 않습니다.')
    except urllib.error.HTTPError as e: return {'error':remote_error(e,'설계엔진')},e.code
    except (TimeoutError,urllib.error.URLError,json.JSONDecodeError): return {'error':'설계엔진 연결 필요: 작업을 처리하지 못했습니다.'},502

def process_artifact(url, fmt=None, plan=None):
    if isinstance(url, dict):
        data=url; url=data.get('url'); fmt=data.get('format'); plan=data.get('plan')
    if not isinstance(url, str): raise ValueError('설계엔진 파일 경로가 올바르지 않습니다.')
    parsed=urllib.parse.urlsplit(url)
    if parsed.scheme or parsed.netloc or parsed.fragment: raise ValueError('설계엔진 파일 경로가 올바르지 않습니다.')
    query=urllib.parse.parse_qs(parsed.query, keep_blank_values=True)
    if set(query) - {'plan'} or len(query.get('plan', [])) > 1: raise ValueError('설계엔진 파일 경로가 올바르지 않습니다.')
    if query.get('plan'):
        if plan is not None and plan != query['plan'][0]: raise ValueError('설계안 번호가 올바르지 않습니다.')
        plan=query['plan'][0]
    url=parsed.path
    if fmt not in ('dxf','png','pdf') or not _ARTIFACT_RE.fullmatch(url): raise ValueError('설계엔진 파일 경로가 올바르지 않습니다.')
    if url.rsplit('/',1)[-1]!=fmt: raise ValueError('파일 형식과 경로가 맞지 않습니다.')
    if plan is not None and plan not in _PLAN_IDS: raise ValueError('설계안 번호가 올바르지 않습니다.')
    target=BASE+url+(('?' + urllib.parse.urlencode({'plan':plan})) if plan else '')
    try:
        h={'User-Agent':'BarunCAD/3'}; h.update(auth_headers())
        with urllib.request.urlopen(urllib.request.Request(target,headers=h),timeout=ARTIFACT_TIMEOUT) as r: raw=r.read(MAX_ARTIFACT_BYTES+1)
        if len(raw)>MAX_ARTIFACT_BYTES: raise ValueError('설계엔진 파일이 너무 큽니다.')
        return {'data':base64.b64encode(raw).decode('ascii'),'extension':'.'+fmt,'mime':{'dxf':'application/dxf','png':'image/png','pdf':'application/pdf'}[fmt]},200
    except urllib.error.HTTPError as e: return {'error':remote_error(e,'설계엔진')},e.code
    except (TimeoutError,urllib.error.URLError): return {'error':'설계엔진 연결 필요: 파일을 내려받지 못했습니다.'},502
