"""Relay planning input to the existing Barun engine, without copying its rules."""
import json
import io
import math
import urllib.request
import urllib.error
from parcel_service import BASE, auth_headers, remote_error

def positive(value):
    return type(value) in (int, float) and math.isfinite(value) and value > 0

def validate(data):
    if not isinstance(data, dict): raise ValueError('설계 입력이 필요합니다.')
    allowed = {'categoryId','detailName','floors','buildingAreaM2','site','pilotiFirstFloor','fireResistant','multiUseBusiness'}
    payload = {k:v for k,v in data.items() if k in allowed}
    if not positive(payload.get('buildingAreaM2')): raise ValueError('확인한 건축면적 상한을 입력하세요.')
    floors = payload.get('floors')
    if type(floors) is not int or not 1 <= floors <= 100: raise ValueError('층수는 1~100의 정수여야 합니다.')
    if not isinstance(payload.get('categoryId'),str) or not payload['categoryId']: raise ValueError('용도를 선택하세요.')
    if not isinstance(payload.get('detailName'),str) or not payload['detailName'].strip(): raise ValueError('세부 용도를 입력하세요.')
    site = payload.get('site')
    if not isinstance(site,dict) or any(k not in {'ring','extraRings','roadEdgeIndex','roadWidthM','roadEdges','jibun','isBusan','zoneNames','maxTotalFloorAreaM2'} for k in site): raise ValueError('지원하지 않는 대지 입력입니다.')
    rings = [site.get('ring'), *site.get('extraRings',[])]
    if len(rings)>100: raise ValueError('대지 경계가 너무 많습니다.')
    for ring in rings:
        if not isinstance(ring,list) or not 3<=len(ring)<=10000: raise ValueError('대지 경계가 올바르지 않습니다.')
        if any(not isinstance(p,dict) or any(type(p.get(k)) not in (int,float) or not math.isfinite(p[k]) for k in ('x','z')) for p in ring): raise ValueError('대지 좌표가 올바르지 않습니다.')
    edges=site.get('roadEdges')
    if not isinstance(edges,list) or not edges: raise ValueError('확인된 접도변이 필요합니다.')
    for edge in edges:
        r,i=edge.get('ringIdx'),edge.get('index')
        if type(r) is not int or not 0<=r<len(rings) or type(i) is not int or not 0<=i<len(rings[r]) or not positive(edge.get('widthM')): raise ValueError('접도변 또는 도로폭이 올바르지 않습니다.')
    index=site.get('roadEdgeIndex')
    if not positive(site.get('roadWidthM')) or not any(e['ringIdx']==0 and e['index']==index and e['widthM']==site['roadWidthM'] for e in edges): raise ValueError('주 접도변과 도로폭이 일치하지 않습니다.')
    if type(site.get('isBusan')) is not bool: raise ValueError('지역을 확인하세요.')
    if not isinstance(site.get('zoneNames'),list) or not site['zoneNames'] or any(not isinstance(z,str) or not z.strip() for z in site['zoneNames']): raise ValueError('확인한 용도지역을 입력하세요.')
    if not positive(site.get('maxTotalFloorAreaM2')): raise ValueError('확인한 연면적 상한을 입력하세요.')
    for key in ('pilotiFirstFloor','fireResistant','multiUseBusiness'):
        if key in payload and type(payload[key]) is not bool: raise ValueError('설계 조건이 올바르지 않습니다.')
    return payload

def process(data):
    payload=validate(data)
    headers={'Content-Type':'application/json','User-Agent':'BarunCAD/3'}
    headers.update(auth_headers())
    req=urllib.request.Request(BASE+'/api/public/plan-suggest', data=json.dumps(payload,allow_nan=False).encode('utf-8'),headers=headers)
    try:
        with urllib.request.urlopen(req,timeout=90) as response:
            raw=response.read(12_000_001)
        if len(raw)>12_000_000: raise ValueError('설계 응답이 너무 큽니다.')
        result=json.loads(raw)
        if not isinstance(result,dict) or not any(k in result for k in ('blocked','floors','error')): raise ValueError('설계 검토 응답 형식을 확인할 수 없습니다.')
        return result,200
    except urllib.error.HTTPError as error:
        # 운영 plan-suggest 는 옛 'site:{ring}' 요청에 400 SITE_ENGINE_INPUT_REQUIRED 를 준다(2026-09-30 확인). 원문 코드를 살려 안내한다.
        message={429:'설계 검토 이용 한도를 초과했습니다. 잠시 후 다시 시도하세요.'}.get(error.code) or remote_error(error,'설계 검토 서비스')
        return {'error':message},error.code
    except (urllib.error.URLError,TimeoutError,json.JSONDecodeError):
        return {'error':'설계 검토 서비스 연결이 끊기거나 응답 시간이 초과됐습니다. 다시 요청하세요.'},502

def validate_site_engine(data):
    """plan-suggest 의 새 계약: {siteEngine:{site(EPSG:5187),zoning,program}}. 좌표는 site_plan_service.from_drawing 이 만든다."""
    engine=data.get('siteEngine') if isinstance(data,dict) else None
    if not isinstance(engine,dict) or set(engine)-{'site','zoning','program','output'} or any(not isinstance(engine.get(k),dict) for k in ('site','zoning','program')):
        raise ValueError('설계엔진 입력(site·zoning·program)이 필요합니다.')
    site=engine['site']
    if site.get('crs')!='EPSG:5187': raise ValueError('설계엔진 대지 좌표계는 EPSG:5187이어야 합니다.')
    ring=site.get('parcel')
    if not isinstance(ring,list) or not 3<=len(ring)<=10000 or any(not isinstance(p,list) or len(p)!=2 or any(type(v) not in (int,float) or not math.isfinite(v) for v in p) for p in ring):
        raise ValueError('대지 좌표가 올바르지 않습니다.')
    if not isinstance(site.get('neighbors'),list): raise ValueError('인접 필지 자료가 필요합니다.')
    json.dumps(engine,allow_nan=False)
    return {'siteEngine':engine}

def suggest_site_engine(data):
    """POST /api/public/plan-suggest {siteEngine} → 서버가 /site-plan/prepare → /generate 를 이어 부른다(공개 경로, 하루 한도)."""
    payload=validate_site_engine(data)
    headers={'Content-Type':'application/json','User-Agent':'BarunCAD/3'}
    headers.update(auth_headers())
    req=urllib.request.Request(BASE+'/api/public/plan-suggest',data=json.dumps(payload,allow_nan=False).encode('utf-8'),headers=headers)
    try:
        with urllib.request.urlopen(req,timeout=120) as response: raw=response.read(30_000_001)
        if len(raw)>30_000_000: raise ValueError('설계엔진 응답이 너무 큽니다.')
        result=json.loads(raw)
    except urllib.error.HTTPError as error:
        return {'error':remote_error(error,'설계엔진')},error.code
    except (urllib.error.URLError,TimeoutError,json.JSONDecodeError):
        return {'error':'설계엔진 연결 필요: 바른 서버에 연결하지 못했거나 응답 시간이 초과됐습니다. 인터넷 연결을 확인하세요.'},502
    report=result.get('report') if isinstance(result,dict) else None
    if not isinstance(report,dict) or not isinstance(report.get('checks'),list) or not isinstance(result.get('entities'),dict):
        return {'error':'설계엔진 응답 형식(v0.5.3 report·entities)을 확인할 수 없습니다.'},502
    # 미리보기 PNG·파일 주소는 CAD 가 쓰지 않는다(파일은 서버에 24시간만 남는다). 입력(input)은 도면에 함께 보관한다.
    return {'report':report,'entities':result['entities'],'input':result.get('input') or payload['siteEngine']},200

def generate(data):
    if isinstance(data,dict) and 'siteEngine' in data: return suggest_site_engine(data)
    # Generate once, then export exactly that specification. Never recompute an alternative here.
    result,status=process(data)
    if status!=200 or result.get('error'): return result,status
    if result.get('blocked'):
        return {'error':' / '.join(str(r) for r in result['blocked'].get('reasons',[])) or '이 조건으로 배치할 수 없습니다.'},422
    if not result.get('site') or not result.get('sitePlan') or not result.get('spec'):
        return {'error':'대지에 맞춘 도면을 생성하지 못했습니다.'},422
    spec=result['spec']
    req=urllib.request.Request(BASE+'/api/plan-dxf',data=json.dumps({'title':'자동 배치','building':spec['building'],'floors':spec['floors']},allow_nan=False).encode('utf-8'),headers={'Content-Type':'application/json',**auth_headers(),'User-Agent':'BarunCAD/3'})
    try:
        with urllib.request.urlopen(req,timeout=90) as response: raw=response.read(30_000_001)
        imported=read_generated_dxf(raw)
        if any(count for kind,count in imported['report'].get('skipped',{}).items() if kind!='ZERO_LENGTH'): return {'error':'생성 도면 일부를 읽지 못해 삽입하지 않았습니다.','report':imported['report']},422
        return {'document':imported['document'],'sitePlan':result['sitePlan'],'spec':spec,'frontEdgeIndex':result.get('frontEdgeIndex'),'report':imported['report'],'floors':[{'label':f['label'],'areaM2':f['areaM2']} for f in result['floors']]},200
    except urllib.error.HTTPError as error:
        return {'error':'편집 도면을 받으려면 바른 계정으로 로그인하세요.' if error.code==401 else f'도면 생성 오류 ({error.code})'},error.code
    except (urllib.error.URLError,TimeoutError):
        return {'error':'도면을 받지 못했습니다. 다시 생성하세요.'},502

def read_generated_dxf(raw):
    import ezdxf
    from exchange import import_file
    if len(raw)>30_000_000: raise ValueError('생성 도면이 너무 큽니다.')
    doc=ezdxf.read(io.StringIO(raw.decode('utf-8')))
    # The upstream writer emits measurement definitions without anonymous display blocks.
    for dim in doc.modelspace().query('DIMENSION'):
        if not dim.dxf.get('geometry') or dim.dxf.get('text_midpoint') is None:
            dim.override().render()
    output=io.StringIO();doc.write(output)
    return import_file(output.getvalue().encode('utf-8'),'.dxf')
