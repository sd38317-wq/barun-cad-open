"""구조 입력 상담: 계산 없이 질문/답과 출처 있는 주소·용도 매핑만 한다."""
import copy
import fnmatch
import json
import math
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent
ZONE_TABLE = ROOT / 'docs/structure/kds41/지진구역표.json'
IMPORTANCE_TABLE = ROOT / 'docs/structure/kds41/용도중요도표.json'
NEW_KEYS = ('reviewMethod', 'structureType', 'basementModel', 'complexBase', 'extension',
            'occupancy', 'legalArea_m2', 'inputEvidence', 'seismic', 'lateralSystem',
            'diaphragms', 'otherLoads', 'loadPaths', 'irregularityEvidence', 'members',
            'pilotisDetails', 'foundation', 'materials', 'lateralAnalysis')
UNKNOWN = ('', '모름', '몰라요', '모르겠어요', '미상', '확인 필요', 'unknown')

# pattern, 쉬운 질문, 응답 종류, 보기→서버 값. 문서의 전체 표는 이 목록에서 생성한다.
QUESTION_TABLE = []
def rule(pattern, question, kind='data', choices=None):
    QUESTION_TABLE.append({'pattern': pattern, 'question': question, 'kind': kind, 'choices': choices or {}})

rule('seismic.siteClass', '대지 지반이 어떤가요? (보기: 암반 / 단단한 흙 / 보통 흙 / 연약한 흙 / 모름 — 지반조사서가 있으면 그 값을 알려 주세요. 흙은 깊이와 조사값을 함께 확인해요.)', 'site',
     {'암반 (S1)': 'S1', '얕고 단단한 흙 (S2)': 'S2', '얕고 연약한 흙 (S3)': 'S3', '깊고 단단한 흙 (S4)': 'S4', '깊고 연약한 흙 (S5)': 'S5', '별도 검토가 필요한 지반 (S6)': 'S6'})
rule('seismic.importance', '이 건물은 무엇으로 쓰나요? 학교·병원·대피시설인지, 함께 쓰는 용도가 있는지도 알려 주세요. 용도와 규모로 확인할게요.', 'importance')
rule('seismic.zone', '대지 주소의 시·도와 시·군을 알려 주세요. 경계가 겹치면 정확한 주소를 확인할게요.', 'zone')
rule('seismic.mapS','지진 위험지도에 적힌 대지 가속도를 확인할 수 있나요? 지역별 표를 쓰면 사용하지 않음을 선택해 주세요. (중력가속도에 대한 비)','number', {'지역별 표라 사용하지 않음':None})
rule('seismic.method', '지진 자료는 어느 것으로 확인할까요?', 'choice', {'지역별 표': 'zone', '지진 위험지도': 'map'})
rule('structureType', '건물은 어떤 방식으로 버티나요? 도면을 먼저 확인할게요.', 'choice', {'콘크리트 기둥·보': 'rc-moment', '콘크리트 벽': 'rc-wall', '아래층 주차장·위층 벽': 'pilotis-wall', '철골 기둥·보': 'steel-moment'})
rule('basementModel', '지하층과 지상층을 함께 계산해야 하나요?', 'choice', {'지상층만 독립 검토': 'above-ground', '지하층과 함께 검토': 'integrated'})
rule('complexBase', '경사지처럼 건물 아래 기준 높이가 복잡한가요?', 'bool')
rule('extension', '기존 건물에 더 짓는 공사인가요?', 'bool')
rule('location','대지의 주소를 알려 주세요. 시·도와 시·군까지 있으면 지역을 확인할 수 있어요.','text')
rule('occupancy.legalUse','건축물대장에 적힌 용도는 무엇인가요? (보기: 아파트 / 단독주택 / 학교 / 실제 쓰임 / 모름)','text')
rule('occupancy.importantFacility','대피시설로 지정됐거나 중요한 시설의 기능을 유지하는 건물인가요?','bool')
rule('occupancy.residentialStoreys','사람이 거주하는 층은 몇 층인가요?','number')
rule('occupancy.emergencyShelter','재난 때 긴급 대피시설로 지정된 건물인가요?','bool')
rule('occupancy.essentialToSpecialFacility','재난 때 꼭 필요한 시설의 기능을 유지하는 부속 건물인가요?','bool')
rule('occupancy.hasSurgery','병원에 수술시설이 있나요?','bool')
rule('occupancy.hasEmergency','병원에 응급시설이 있나요?','bool')
rule('occupancy.freightTerminal','이 운수시설은 화물터미널이나 집배송시설인가요?','bool')
rule('occupancy.publicFacility','국가나 지방자치단체의 시설인가요?','bool')
rule('occupancy*', '건축물대장에 적힌 용도와 각 층의 실제 쓰임을 알려 주세요. 학교·병원·대피시설인지도 확인할게요.')
rule('legalArea_m2', '건축물대장이나 허가서의 연면적은 얼마인가요? (㎡)', 'number')
rule('inputEvidence*', '이 값은 어느 도면이나 자료에서 확인했나요? 자료 이름과 확인 여부를 알려 주세요.')
for field, label, unit in [('baseZ','지진 계산을 시작하는 밑면 높이','m'), ('topZ','지진 계산에 쓰는 건물 맨 위 높이','m'), ('bedrockDepth_m','지반조사서에 적힌 암반 깊이','m'), ('avgVs_mps','지반조사서에 적힌 흙의 파동 속도','m/s')]:
    rule('seismic.'+field, label+'를 자료에서 확인할 수 있나요? ('+unit+')', 'number')
for field, text in [('depthUnknown','지반조사서에서도 암반 깊이를 알 수 없다고 확인됐나요?'), ('hasInfill','기둥·보 사이에 채운 벽이 건물의 흔들림에 영향을 주나요? 도면으로 확인할게요.'), ('isolation','지진 흔들림을 줄이는 면진장치가 있나요?'), ('damping','흔들림을 흡수하는 제진장치가 있나요?'), ('dynamicRequired','별도의 정밀한 지진 해석이 필요하다는 검토 결과가 있나요?')]:
    rule('seismic.'+field,text,'bool')
rule('seismic.analysisPeriod.*','구조 해석 자료에 적힌 건물의 흔들림 주기를 확인할 수 있나요? (초)','number')
rule('seismic.reference*','이전 계산서를 재현할 원자료가 있나요? 있으면 해당 부분을 확인할게요.')
rule('lateralSystem.*.systemKey','가로·세로 방향에서 건물이 버티는 방식이 표시된 구조도면이 있나요? 도면에 표시된 방식으로 확인할게요.','choice',{'콘크리트 기둥·보(보통)':'rcMomentOrdinary','콘크리트 기둥·보(중간)':'rcMomentIntermediate','콘크리트 기둥·보(특수)':'rcMomentSpecial','콘크리트 내력벽(보통)':'rcWallBearingOrdinary','콘크리트 내력벽(특수)':'rcWallBearingSpecial','철골 기둥·보(보통)':'steelMomentOrdinary','철골 기둥·보(중간)':'steelMomentIntermediate','철골 기둥·보(특수)':'steelMomentSpecial'})
rule('floors.*.pilotis','이 층은 벽 없이 기둥 위주로 열린 주차장 같은 공간인가요?','bool')
rule('floors.*.H','이 층 바닥에서 위층 바닥까지 높이는 얼마인가요? (m)','number')
rule('diaphragms.*.rigid','이 층 바닥이 함께 움직이는 단단한 판으로 검토됐나요? 구조도면이나 계산서를 확인할게요.','bool')
rule('diaphragms.*.roof','이 판은 건물 맨 위 지붕인가요?','bool')
rule('diaphragms.*.massComplete','이 층 바닥에 실리는 건물 자체 무게를 빠짐·중복 없이 모두 합산했나요?','bool')
rule('diaphragms.*.uniformExtraDead','별도로 더한 설비·조경 무게가 이 층에 고르게 퍼져 있나요?','bool')
for field,label,unit in [('z','이 층 바닥판의 공통 기준 높이','m'),('area','무게 계산에 쓰는 이 판의 실제 면적','㎡'),('slabArea','보·벽 등을 구분한 바닥판 순면적','㎡'),('DL','마감·보·기둥·벽까지 합산한 이 판의 평균 자체 무게','kN/㎡'),('snow_kNm2','이 지붕에 쌓이는 눈의 무게','kN/㎡'),('Px_kN','이 층 위에서 내려오는 전체 수직하중','kN')]:
    rule('diaphragms.*.'+field,label+'를 자료에서 확인할 수 있나요? ('+unit+')','number')
rule('*.liveUse','이 기둥이나 벽이 받치는 공간은 무엇으로 쓰나요? (보기: 주거 / 사무실 / 가게의 구체적인 쓰임 / 모름)','text')
rule('diaphragms.*.liveZones.*.use','이 바닥 위 공간의 구체적인 쓰임을 알려 주세요. (보기: 주거 / 사무실 / 실제 가게 쓰임 / 모름)','text')
rule('*.id','도면에 적힌 이 부재의 이름이나 부호가 있나요? 도면에서 확인할게요.','text')
rule('*.tieBar','기둥을 둘러싼 철근 굵기가 도면에 어떻게 적혀 있나요? (보기: D10 / D13 / 모름)','bar')
rule('*.confinement','기둥을 둘러싼 철근이 어떤 모양인가요? 도면을 확인할게요.','choice',{'네모 띠철근':'tied','나선 철근':'spiral'})
for field,text in [('structural','이 벽은 건물의 무게나 흔들림을 버티는 벽인가요?'),('continuous','이 벽이나 기둥이 아래층까지 끊기지 않고 이어지나요?'),('detailConfirmed','철근 연결과 상세가 도면에서 확인됐나요?'),('compression','이 벽이 눌리는 힘을 받는지 확인됐나요?'),('special','특수한 지진 상세를 적용한 벽인가요? 도면을 확인할게요.'),('conditionConfirmed','이 부재에 쓰는 계산 조건이 도면에서 확인됐나요?'),('lateral','이 부재가 옆으로 미는 힘도 버티나요?'),('cracked','이 벽은 균열이 생긴 상태로 검토하나요?'),('transfer','이 보는 위층 기둥이나 벽의 무게를 옮겨 받나요?'),('confirmed','이 값은 관련 자료에서 확인됐나요?'),('basisMatched','기초 하중과 지반 자료가 같은 기준으로 정리됐나요?')]:
    rule('*.'+field,text,'bool')
for field,label in [('Ast','기둥 전체 철근량'),('phi','강도를 줄여 적용하는 계수'),('Pu','이 부재에 최종 적용할 눌리는 힘'),('Vu','이 부재에 최종 적용할 옆으로 미는 힘'),('t','벽이나 바닥판의 두께'),('lw','벽의 유효 길이'),('Avh','벽 가로 철근량'),('sh','벽 가로 철근 간격'),('span_mm','부재가 건너가는 길이'),('thickness_mm','바닥판 두께'),('density','재료의 단위 부피당 무게'),('bw','보의 폭'),('cover','철근을 덮는 콘크리트 두께'),('fyt','띠철근 강도'),('lambda','콘크리트 종류에 따른 계수'),('aggregateClear','골재 크기를 고려한 철근 사이 여유'),('stiffnessFactor','부재 강성을 줄이는 확인된 비율'),('level','이 부재가 있는 층')]:
    rule('*.'+field,'도면이나 계산서에 적힌 '+label+'를 확인할 수 있나요?','number')
rule('diaphragms.*.liveZones*','이 바닥 위 공간은 각각 무엇으로 쓰고 면적은 얼마인가요? (보기: 주거 / 사무실 / 가게의 실제 쓰임 / 창고 / 모름)')
rule('diaphragms.*.CM*','이 층 무게가 모이는 중심 위치가 계산서에 있나요? 도면과 함께 확인할게요.')
rule('diaphragms.*.massPoints*','이 층에 놓이는 무게별 위치와 크기를 정리한 자료가 있나요?')
rule('diaphragms.*.weightItems.*','앞서 합산한 자체 무게에 포함하지 않은 칸막이·설비·조경 무게가 있나요? 없는 항목도 확인해 주세요.','number')
rule('members.*.*.b','제안 단면({section})으로 할까요? 제안이 없으면 도면의 가로 크기를 확인할게요. (mm)','section')
rule('members.*.*.h','제안 단면({section})으로 할까요? 제안이 없으면 도면의 세로 크기를 확인할게요. (mm)','section')
rule('floors.*.columns.*.b','제안 단면({section})으로 할까요? 제안이 없으면 도면의 가로 크기를 확인할게요. (mm)','section')
rule('floors.*.columns.*.h','제안 단면({section})으로 할까요? 제안이 없으면 도면의 세로 크기를 확인할게요. (mm)','section')
for field,label in [('fck','콘크리트 강도'),('fy','철근 강도'),('Ec_MPa','콘크리트의 탄성계수'),('G_MPa','콘크리트의 전단탄성계수'),('nu','콘크리트의 포아송비'),('E_MPa','강재의 탄성계수'),('Ix_mm4','철골 단면의 가로축 단면성질'),('Iy_mm4','철골 단면의 세로축 단면성질')]:
    rule('*.'+field,'도면이나 재료 성적서에 적힌 '+label+'를 확인할 수 있나요?','number')
for prefix,text in [('members.columns.*','기둥의 철근 배치·길이·힘·상세'),('members.walls.*','벽의 두께·철근 배치·연속성·힘·상세'),('members.beams.*','보의 크기·철근 배치·힘·상세'),('members.flexure.*','바닥판·보의 길이·받침·두께'),('floors.*.columns.*','이 층 기둥의 위치·크기·받는 공간'),('floors.*.walls.*','이 층 벽의 위치·두께·끊긴 부분과 역할')]:
    rule(prefix+'*',text+'를 확인할 구조도면이나 계산서가 있나요? 해당 부분을 확인할게요.')
rule('otherLoads.*','물·온도·빗물·바람이 이 부재에 주는 힘을 확인한 계산서가 있나요? 해당하지 않는 항목도 확인해 주세요.','number')
rule('loadPaths.missingSupport','위층 기둥이나 벽을 아래에서 받치지 못하는 곳이 있나요?','bool')
rule('loadPaths.reactions*','위층에서 아래 기둥으로 내려오는 힘을 구한 계산서가 있나요? 그대로 확인할게요.')
rule('irregularityEvidence.*.strength','층마다 옆으로 미는 힘을 얼마나 버티는지 계산한 자료가 있나요?')
rule('irregularityEvidence.*','층마다 벽·기둥 배치와 버티는 정도가 급격히 달라지는지 검토한 자료가 있나요?')
rule('pilotisDetails*','열린 주차장 층의 코어·벽·기둥 연결과 철근 상세를 확인할 도면이나 계산서가 있나요?')
rule('foundation*','기초 크기와 땅이 버티는 힘을 확인할 기초도면·지반조사서·계산서가 있나요?')
rule('lateralAnalysis.wallBoundary','벽 위아래가 어떻게 고정되는지 도면에서 확인할 수 있나요?','choice',{'아래만 고정': 'cantilever','위아래 고정': 'fixed-fixed'})
rule('lateralAnalysis.beta','변형 검토에 사용한 하중 비율을 계산서에서 확인할 수 있나요?','number')
rule('dirs.*','이 층의 흔들림과 버티는 정도를 계산하려면 구조도면·재료 자료가 더 필요해요. 관련 자료가 있나요?','computed')
rule('*','이 항목을 확인할 도면이나 자료가 있나요? 모르면 확인 전으로 남길게요.')


def storeys(p):
    return len(p['floors']) if p.get('floors') else p.get('stories', 2)

def preliminary(p):
    return storeys(p) >= 3 or p.get('reviewMethod') == 'kds41-preliminary'

def _load(path):
    try:
        value=json.loads(Path(path).read_text(encoding='utf-8-sig'))
        return value if isinstance(value, dict) else {}
    except (OSError, ValueError):
        return {}

def zone_for_address(address, table=None):
    table = _load(ZONE_TABLE) if table is None else table
    if isinstance(table.get('zones'), dict):
        table={**table,'rows':[{**row,'zone':zone} for zone,rows in table['zones'].items() for row in rows]}
    if not isinstance(address, str) or not table.get('source') or not isinstance(table.get('rows'), list):
        return None
    tokens=re.findall(r'[가-힣A-Za-z0-9]+',address)
    if tokens:tokens[0]=table.get('aliases',{}).get(tokens[0],tokens[0])
    matches=[]
    for row in table['rows']:
        provinces=row.get('sido',[]);cities=row.get('sigungu') or []
        if isinstance(provinces,str): provinces=[provinces]
        if isinstance(cities,str): cities=[cities]
        # 접두 부분문자열로 다른 지명/건물명을 고르지 않는다. 시·도는 첫 주소 토큰.
        if not tokens or tokens[0] not in provinces or row.get('zone') not in ('I','II'): continue
        if cities and '*' not in cities:
            if not any(city in tokens[1:3] for city in cities): continue
            matches.append((1,row))
        else:
            # 예외 시·군이 있는 도는 시·군을 모르면 도 전체 행도 적용하지 않는다.
            exceptions=[r for r in table['rows'] if r.get('sido')==row.get('sido') and r.get('sigungu') not in (None,[], '*', ['*'])]
            if exceptions and not any(t.endswith(('시','군')) for t in tokens[1:3]): continue
            matches.append((0,row))
    if not matches:return None
    best=[r for rank,r in matches if rank==max(x[0] for x in matches)]
    if len({r['zone'] for r in best})!=1:return None
    return {'value':best[0]['zone'],'reference':best[0].get('source') or table['source']}

def importance_for_use(p, table=None):
    table=_load(IMPORTANCE_TABLE) if table is None else table
    occ=p.get('occupancy') or {}
    if not isinstance(occ,dict) or not table.get('source') or not table.get('seismic'):return None
    uses=occ.get('uses') or [occ.get('legalUse')]
    if not isinstance(uses,list) or not uses or not all(isinstance(u,str) for u in uses):return None
    special=occ.get('emergencyShelter') is True or occ.get('essentialToSpecialFacility') is True
    if special:return {'value':'특','coefficient':1.5,'buildingImportance':'특','reference':table['source']+'; 3.1(4)(5)'}
    found=[]
    for use in uses:
        rows=[r for r in table.get('rows',[]) if use in r['uses']]
        if len(rows)!=1:return None
        row=rows[0]
        if row.get('alwaysSpecial') or use=='병원' and (occ.get('hasSurgery') is True or occ.get('hasEmergency') is True):
            imp='특'
        else:
            # 특수 기능의 비해당은 좁은 용도명만으로 확정하지 않는다.
            if occ.get('importantFacility') is not False:return None
            if use=='병원':
                a,b=occ.get('hasSurgery'),occ.get('hasEmergency')
                if a is True or b is True:imp='특'
                elif a is False and b is False:imp='1'
                else:return None
            elif use=='운수시설' and occ.get('freightTerminal') is True:
                imp='2'
            elif use=='운수시설' and occ.get('freightTerminal') is not False:
                return None
            elif row.get('areaThreshold'):
                area=p.get('legalArea_m2')
                if type(area) not in (int,float) or not math.isfinite(area) or area<=0:return None
                if use=='데이터센터' and area>=row['areaThreshold'] and type(occ.get('publicFacility')) is not bool:return None
                imp=row['above'] if area>=row['areaThreshold'] and (use!='데이터센터' or occ.get('publicFacility')) else row['below']
            elif row.get('storeysThreshold'):
                n=storeys(p)
                if type(n) is not int:return None
                imp=row['above'] if n>=row['storeysThreshold'] else row['below']
            else:imp=row['importance']
        found.append((imp,row['clause']))
    if not found:return None
    imp=max((x[0] for x in found),key=lambda x:{'3':0,'2':1,'1':2,'특':3}[x])
    grade,coeff=table['seismic'][imp]
    return {'value':grade,'coefficient':coeff,'buildingImportance':imp,
            'reference':str(table.get('source'))+'; '+', '.join(x[1] for x in found)}

def auto_fill(p, zone_table=None, importance_table=None, blocked=()):
    p=copy.deepcopy(p)
    if not preliminary(p):return p
    seismic=p.setdefault('seismic',{})
    if seismic is None:seismic=p['seismic']={}
    if not isinstance(seismic,dict):raise ValueError('seismic 은 객체입니다.')
    evidence=p.setdefault('inputEvidence',{})
    if evidence is None:evidence=p['inputEvidence']={}
    if not isinstance(evidence,dict):raise ValueError('inputEvidence 은 객체입니다.')
    for key,e in list(evidence.items()):
        if key in ('seismic.zone','seismic.importance') and isinstance(e,dict) and e.get('source')=='자동(주소/용도)' and e.get('confirmed') is False:
            field=key.split('.')[-1]
            if seismic.get(field)==e.get('value'):seismic.pop(field,None)
            evidence.pop(key,None)
    for field,result in [('zone',zone_for_address(p.get('location'),zone_table)),('importance',importance_for_use(p,importance_table))]:
        key='seismic.'+field
        if (evidence.get(key) or {}).get('withheld') is True:continue
        if key in blocked or seismic.get(field) is not None or not result:continue
        seismic[field]=result['value']
        evidence[key]={'source':'자동(주소/용도)','confirmed':False,
                       'assumption':'주소·용도를 원문 표와 대조한 잠정값이며 사용자 확인 전입니다.',
                       'reference':result['reference'],'value':result['value']}
        if field=='importance':evidence[key].update(coefficient=result['coefficient'],buildingImportance=result['buildingImportance'])
    return p

# 보통 값 채움(대표 승인 2026-10-30 '그걸로' — '자료 부족으로 끝나면 AI 가 왜 필요하냐'): 3~5층 개략 검토에서 도면·주소·용도로 못 정한 칸을
# 보통 값으로 채우고 근거에 '미리 가정(보통 값)' 을 남긴다. 사용자가 답했거나 '모름'(withheld)으로 남긴 칸은 건드리지 않는다. 값은 도면 기준 structureAssumptions.
USUAL_SOURCE='미리 가정(보통 값)'
LATERAL_KEYS={'rc-moment':'rcMomentOrdinary','rc-wall':'rcWallBearingOrdinary','pilotis-wall':'rcWallBearingOrdinary','steel-moment':'steelMomentOrdinary'}

def _ring_area(r):
    return abs(sum(a[0]*b[1]-b[0]*a[1] for a,b in zip(r,r[1:]+r[:1])))/2

def _ring_centroid(r):
    a=sum(p[0]*q[1]-q[0]*p[1] for p,q in zip(r,r[1:]+r[:1]))/2
    if not a:return {'x':sum(p[0] for p in r)/len(r),'y':sum(p[1] for p in r)/len(r)}
    return {'x':sum((p[0]+q[0])*(p[0]*q[1]-q[0]*p[1]) for p,q in zip(r,r[1:]+r[:1]))/(6*a),'y':sum((p[1]+q[1])*(p[0]*q[1]-q[0]*p[1]) for p,q in zip(r,r[1:]+r[:1]))/(6*a)}

def floor_uses(p,n):
    """층마다 활하중 용도 — legalUse '1·2층 근린생활시설 / 3·4층 단독주택' 처럼 층을 적었으면 그대로, 아니면 위쪽 거주층은 주거·나머지는 상점."""
    out=[None]*n
    for part in re.split(r'[/;]|,(?=\s*\d[\d·,~\-\s]*층)',str((p.get('occupancy') or {}).get('legalUse') or '')):
        m=re.match(r'\s*([\d·,~\-\s]+)층',part)
        nums=[]
        if m:
            for a,b in re.findall(r'(\d+)\s*(?:[~\-]\s*(\d+))?',m[1]):nums+=list(range(int(a),int(b or a)+1))
        kind='주거' if re.search(r'주택|주거|아파트|다세대|다가구|연립',part) else '사무실' if re.search(r'사무|업무',part) else '상점' if re.search(r'근린|상점|판매|상가|매장',part) else None
        for f in (nums or range(1,n+1)) if kind else ():
            if 1<=f<=n and out[f-1] is None:out[f-1]=kind
    res=int((p.get('occupancy') or {}).get('residentialStoreys') or 0)
    return [u or ('주거' if i>=n-res else '상점') for i,u in enumerate(out)]

def fill_usual(p, usual):
    p=copy.deepcopy(p)
    if not preliminary(p) or not usual:return p
    ev=p.setdefault('inputEvidence',{})
    def put(path,value,why):
        parts=path.split('.');cur=p
        for k in parts[:-1]:cur=cur.setdefault(k,{}) if isinstance(cur,dict) else cur[int(k)]
        if isinstance(cur,dict) and parts[-1] in cur:return   # 준 값·일부러 비운 값(None)은 그대로 — 없는 칸만 채운다
        if (ev.get(path) or {}).get('withheld') is True or (ev.get(path) or {}).get('confirmed') is True:return
        cur[parts[-1]]=value;ev[path]={'source':USUAL_SOURCE,'confirmed':False,'assumption':why+' · 근거: 도면 기준 보통 값(structureAssumptions, 대표 승인 2026-10-30)'}
    floors=p.get('floors') or [];n=len(floors);hs=[float(f.get('H') or 0) for f in floors]
    put('structureType',p.get('structureType') or ('steel-moment' if p.get('system')=='steel' else 'rc-moment'),'도면 구조 형식 — 없으면 재료로')
    put('basementModel','above-ground','지하층 없음(도면)');put('complexBase',False,'평지 대지 가정');put('extension',False,'신축')
    occ=p.setdefault('occupancy',{})
    if isinstance(occ,dict):
        uses=floor_uses(p,n)
        if 'residentialStoreys' not in occ:occ['residentialStoreys']=sum(u=='주거' for u in uses)
        if 'importantFacility' not in occ:occ['importantFacility']=False
        if 'legalUse' not in occ:occ['legalUse']='근린생활시설'
    S=usual['seismic']
    for k,v,why in (('siteClass',S['siteClass'],'지반조사서 없음 — 보통 쓰는 지반'),('method','zone','지역별 표'),('baseZ',0,'지상 1층 바닥'),('topZ',round(sum(hs),3),'맨 위층 바닥판 높이'),
                    ('isolation',False,'면진장치 없음'),('damping',False,'제진장치 없음'),('hasInfill',False,'채움벽은 강성에 넣지 않음'),('importance',S['importance'],'일반 건축물')):
        put('seismic.'+k,v,why)
    if (p.get('seismic') or {}).get('method')=='zone' and 'mapS' not in p['seismic']:p['seismic']['mapS']=None
    lk=LATERAL_KEYS.get(p.get('structureType'))
    if lk:
        for d in ('x','y'):put('lateralSystem.'+d+'.systemKey',lk,'구조 형식의 보통(ordinary) 골조')
    for i,f in enumerate(floors):
        if 'pilotis' not in f:f['pilotis']=False;ev.setdefault('floors.'+str(i)+'.pilotis',{'source':USUAL_SOURCE,'confirmed':False,'assumption':'필로티 아님(층에 실이 있음) · 근거: 도면'})
    L=usual['loads'];uses=floor_uses(p,n)
    for i,f in enumerate(floors):   # 기둥이 받는 바닥 용도 = 그 층 바로 위 바닥판 용도(맨 위층은 지붕)
        use='지붕' if i==n-1 else (uses[i+1] if uses[i+1]!='상점' else '상점 2층 이상')
        for c in f.get('columns') or []:
            if not isinstance(c,dict):continue
            if 'liveUse' not in c:c['liveUse']=use
            C=usual.get('column') or {};M=usual.get('materials') or {}
            for k,v in (('cover',C.get('cover')),('bar',C.get('bar')),('tieBar',C.get('tieBar')),('nx',C.get('barsPerFace')),('ny',C.get('barsPerFace')),('fck',M.get('fck')),('fy',M.get('fy'))):
                if v is not None and k not in c:c[k]=v
    if 'diaphragms' not in p and n and all(f.get('outline') for f in floors):
        ds=[];z=0
        for i,f in enumerate(floors):
            z+=hs[i];roof=i==n-1;ring=[tuple(q[:2]) for q in f['outline']];area=round(_ring_area(ring),3)
            use='지붕' if roof else (uses[i+1] if uses[i+1]!='상점' else '상점 2층 이상')
            ds.append({'z':round(z,3),'area':area,'slabArea':area,'DL':round(L['slabThicknessM']*L['concreteKNm3']+L['finishKNm2']+(L['roofExtraKNm2'] if roof else 0),3),
                       'massComplete':True,'roof':roof,'snow_kNm2':L['roofSnowKNm2'] if roof else 0,'liveZones':[{'area':area,'use':use}],
                       'weightItems':{'partition_kNm2':0,'equipment_kN':0,'landscape_kN':0},'uniformExtraDead':True,'rigid':True,'CM':_ring_centroid(ring)})
        p['diaphragms']=ds
        ev.setdefault('diaphragms',{'source':USUAL_SOURCE,'confirmed':False,'assumption':f"근거: 도면 기준 보통 값 · 바닥판마다 고정하중 = 슬래브 {L['slabThicknessM']} m × {L['concreteKNm3']} + 마감 {L['finishKNm2']}(지붕 +{L['roofExtraKNm2']}) kN/㎡, 활하중은 층 용도 기준표, 지붕 적설 {L['roofSnowKNm2']} kN/㎡, 무게중심은 바닥 도심"})
    put('otherLoads.F',0,'유체 하중 없음');put('otherLoads.T',0,'온도 하중 없음');put('otherLoads.R',0,'강우 하중 없음')
    put('loadPaths.missingSupport',False,'위층 기둥·벽이 아래층에 받침(도면)')
    for d in ('x','y'):put('irregularityEvidence.'+d,{'confirmed':True,'regular':True,'types':[]},'평면·입면 정형으로 가정 — 비정형이면 구조기술사 확인')
    put('seismic.bedrockDepth_m',S['bedrockDepth_m'],'지반조사서 없음 — 깊고 단단한 흙(S4)의 보통 값')
    put('seismic.avgVs_mps',S['avgVs_mps'],'지반조사서 없음 — 깊고 단단한 흙(S4)의 보통 값')
    # 엔진은 입력 묶음마다 근거를 본다(하위 칸 근거는 위로 올라가지 않음) — 미리가 도면에서 넣은 값도 근거 없이 오면 채운다
    for group,why in (('structureType','도면 구조 형식'),('occupancy','건축개요 용도'),('seismic','주소·보통 값'),('lateralSystem','구조 형식의 보통 골조'),('floors','도면 층 윤곽·층고'),
                      ('irregularityEvidence','정형 가정'),('otherLoads','해당 없음 가정'),('loadPaths','도면 받침 확인')):
        if group in p and group not in ev:ev[group]={'source':USUAL_SOURCE,'confirmed':False,'assumption':why+' · 근거: 도면·주소·보통 값'}
    return p

def notifications(p):
    return [f"{'주소' if key.endswith('.zone') else '용도'}로 {'지진구역' if key.endswith('.zone') else '내진등급'} {e.get('value')}을 채웠어요. 사용자 확인 전 값이에요."
            for key,e in (p.get('inputEvidence') or {}).items() if isinstance(e,dict) and e.get('source')=='자동(주소/용도)' and e.get('confirmed') is False]

def normalized(key):
    return re.sub(r'\[(\d+)\]',r'.\1',key)

def _parts(key):
    parts=normalized(key).split('.')
    if any(part.startswith('_') for part in parts):
        raise ValueError('답변 입력 경로가 올바르지 않습니다.')
    if any(not re.fullmatch(r'[A-Za-z_][A-Za-z0-9_-]*|\d+',part) for part in parts) or len(parts)>14:
        raise ValueError('답변 입력 경로가 올바르지 않습니다.')
    return [int(x) if x.isdigit() else x for x in parts]

def input_key(key,p):
    key=normalized(key)
    if key.startswith('members.') and re.search(r'\.(?:analysis|demand|Lr|[DLESRFTW])\.',key):return None
    if re.fullmatch(r'storeys\.\d+\..+',key):
        suffix=key.split('.',2)[2]
        if suffix in ('h_m','outline'):
            return 'floors.'+key.split('.')[1]+'.'+('H' if suffix=='h_m' else 'outline')
        if suffix not in ('z_m','rigid','CM','CM.x','CM.y','Px_kN/P_kN','Px_kN','massPoints'):return None
        key='diaphragms.'+key[8:]
        key=re.sub(r'\.z_m$', '.z', key)
        key=re.sub(r'\.Px_kN/P_kN$', '.Px_kN', key)
    if re.fullmatch(r'strength\.[xy]',key):return 'irregularityEvidence.'+key[-1]+'.strength'
    match=re.fullmatch(r'members\.(\d+)\.([^.]+)\.(.+)',key)
    if match:
        level,member,field=match.groups();floors=p.get('floors') or []
        if int(level)>=len(floors) or '/' in field:return None
        found=[f'floors.{level}.{group}.{i}.{field}' for group in ('columns','walls') for i,m in enumerate(floors[int(level)].get(group) or []) if m.get('id')==member]
        return found[0] if len(found)==1 else None
    match=re.fullmatch(r'members\.(column|wall|beam)\.([^.]+)\.(\d+)\.(.+)',key)
    if match:
        kind,member,level,field=match.groups()
        if re.match(r'(?:analysis|demand|Lr|[DLESRFTW])\.',field):return None
        group={'column':'columns','wall':'walls','beam':'beams'}[kind]
        rows=(p.get('members') or {}).get(group) or []
        found=[f'members.{group}.{i}.{field}' for i,m in enumerate(rows) if m.get('id')==member and m.get('level')==int(level)]
        if len(found)==1:return found[0]
        floors=p.get('floors') or []
        if kind in ('column','wall') and 1<=int(level)<=len(floors):
            found=[f'floors.{int(level)-1}.{group}.{i}.{field}' for i,m in enumerate(floors[int(level)-1].get(group) or []) if m.get('id')==member]
            if len(found)==1:return found[0]
        found=[f'members.{group}.{i}.{field}' for i,m in enumerate(rows) if m.get('id')==member and m.get('level') is None]
        return found[0] if len(found)==1 else None
    if key.split('.')[0] in NEW_KEYS+('floors','location','H','use','wind','snow','Fe','soilOk','basement','legal'):
        try:_parts(key)
        except ValueError:return None
        # members.0...는 계산기의 부재 식별자 진단이며 p.members의 배열 경로가 아니다.
        if re.match(r'members\.\d+\.',key):return None
        return key
    return None

def _write(p,key,value,remove=False):
    parts=_parts(key);current=p
    if parts[0]=='inputEvidence' and len(parts)>1:
        evidence=p.setdefault('inputEvidence',{});field='.'.join(str(v) for v in parts[1:])
        if remove:evidence.pop(field,None)
        else:evidence[field]=copy.deepcopy(value)
        return
    for i,part in enumerate(parts[:-1]):
        nxt=parts[i+1]
        if isinstance(current,list):
            if not isinstance(part,int) or part>=len(current):raise ValueError('답변할 층·부재가 없습니다. 도면부터 확인하세요.')
            current=current[part]
        elif isinstance(current,dict) and isinstance(part,str):
            if part not in current or current[part] is None:
                if isinstance(nxt,int):raise ValueError('답변할 층·부재 목록이 없습니다.')
                current[part]={}
            current=current[part]
        else:raise ValueError('답변 경로가 입력과 다릅니다.')
    last=parts[-1]
    if isinstance(current,dict) and isinstance(last,str):
        if remove:current.pop(last,None)
        else:current[last]=copy.deepcopy(value)
    elif isinstance(current,list) and isinstance(last,int) and last<len(current):current[last]=None if remove else copy.deepcopy(value)
    else:raise ValueError('답변할 항목이 없습니다.')

def question_for(key,p=None,proposal=None):
    p=p or {};target=input_key(key,p)
    canonical=target or normalized(key)
    row=next(r for r in QUESTION_TABLE if fnmatch.fnmatchcase(canonical,r['pattern']))
    section=f"{proposal['b']}×{proposal['h']} mm" if proposal and proposal.get('b') and proposal.get('h') else '미정'
    q={'key':key,'inputKey':target,'question':row['question'].replace('{section}',section),
       'kind':row['kind'],'options':list(row['choices'])+['모름'],'choices':copy.deepcopy(row['choices'])}
    context=re.fullmatch(r'members\.(column|wall|beam)\.([^.]+)\.(\d+)\..+',normalized(key))
    if context:q['question']=context[3]+'층 '+context[2]+' '+{'column':'기둥','wall':'벽','beam':'보'}[context[1]]+': '+q['question']
    if row['kind']=='bool':q['options']=['예','아니요','모름']
    if row['kind']=='section' and proposal:q['options']=['제안대로','다른 치수(숫자로 입력)','모름']
    if proposal:q['proposal']=copy.deepcopy(proposal)
    return q

def answer_value(question,answer):
    if answer is None or isinstance(answer,str) and answer.strip() in UNKNOWN:return None
    kind=question['kind'];choices=question['choices']
    if isinstance(answer,str) and answer in choices:return choices[answer]
    if kind=='bool':
        if type(answer) is bool:return answer
        if answer in ('예','네','있어요','맞아요'):return True
        if answer in ('아니요','없어요'):return False
        raise ValueError('예 / 아니요 / 모름 중에서 답해 주세요.')
    if kind=='site':
        if answer in ('S1','S2','S3','S4','S5','S6'):return answer
        # 넓은 흙 분류를 세부 지반종류로 추정하지 않는다.
        if answer in ('암반','단단한 흙','보통 흙','연약한 흙'):return None
        raise ValueError('지반조사서 값이나 모름으로 답해 주세요.')
    if kind=='importance':
        if answer in ('특','I','II'):return answer
        raise ValueError('용도는 occupancy.legalUse에 넣어 주세요. 등급을 직접 정할 필요는 없어요.')
    if kind=='zone':
        if answer in ('I','II'):return answer
        raise ValueError('주소는 location에 넣어 주세요. 지역별 표로 확인할게요.')
    if kind=='section' and answer in ('예','네','제안대로'):
        proposal=question.get('proposal') or {}
        if not question.get('inputKey'):raise ValueError('제안 부재의 도면 위치와 층을 먼저 확인해 주세요.')
        field=question['inputKey'].split('.')[-1]
        if type(proposal.get(field)) not in (int,float):raise ValueError('확인할 제안 단면이 없습니다.')
        return proposal[field]
    if kind in ('number','section'):
        if type(answer) in (int,float) and math.isfinite(answer):return answer
        if isinstance(answer,str) and re.fullmatch(r'-?\d+(?:\.\d+)?',answer.strip()):return float(answer)
        raise ValueError('자료에 적힌 숫자나 모름으로 답해 주세요.')
    if kind=='choice':
        if answer in choices.values():return answer
        raise ValueError('보기 또는 모름으로 답해 주세요.')
    if kind=='bar':
        if isinstance(answer,str) and re.fullmatch(r'D[1-9][0-9]?',answer):return answer
        raise ValueError('도면에 적힌 철근 굵기나 모름으로 답해 주세요.')
    if kind=='text':
        if isinstance(answer,str):return answer.strip()
        raise ValueError('확인한 내용을 짧게 답해 주세요.')
    if kind=='computed':raise ValueError('이 값은 계산 결과예요. 도면·재료 입력을 보충해 다시 검토해야 해요.')
    # 복잡한 부재·조사 자료는 AI가 원자료에서 구조화한 JSON만 사용한다. 자유문장을 엔진 값으로 추정하지 않는다.
    if not isinstance(answer,(dict,list)) and type(answer) not in (int,float,bool):
        raise ValueError('관련 도면·자료를 확인해 입력을 채워 주세요. 모르면 모름으로 남길 수 있어요.')
    return answer

def _scope_member_answer(p,key):
    """층별 질문의 답을 level 없는 공통 부재에 덮어쓰지 않는다."""
    match=re.fullmatch(r'members\.(column|wall|beam)\.([^.]+)\.(\d+)\.(.+)',normalized(key))
    target=input_key(key,p)
    if not match or not target or not target.startswith('members.'):return
    kind,member,level,field=match.groups();parts=_parts(target);group,index=parts[1:3]
    rows=p['members'][group];common=rows[index]
    if common.get('level') is not None:return
    scoped={**copy.deepcopy(common),'level':int(level)}
    rows.insert(index,scoped)
    # 배열 삽입으로 출처가 다른 부재에 붙지 않도록 경로도 함께 이동하고 같은 원자료만 복사한다.
    prefix=f'members.{group}.';evidence=p['inputEvidence'];shifted={};inherited={}
    for old,value in list(evidence.items()):
        if old.startswith(prefix):
            m=re.match(r'(\d+)(.*)',old[len(prefix):])
            if m and int(m[1])>=index:
                shifted[prefix+str(int(m[1])+1)+m[2]]=value
                if int(m[1])==index:inherited[prefix+str(index)+m[2]]=copy.deepcopy(value)
                evidence.pop(old)
    evidence.update(shifted);evidence.update(inherited)

def apply_answers(p,answers,questions=None):
    if not isinstance(answers,dict):raise ValueError('answers 는 질문 key와 답의 객체입니다.')
    p=copy.deepcopy(p)
    if p.get('inputEvidence') is None:p['inputEvidence']={}
    if not isinstance(p['inputEvidence'],dict):raise ValueError('inputEvidence 은 객체입니다.')
    unresolved=[];known={q['key']:q for q in questions or []}
    # 같은 답 묶음에서 층 사본이 삽입돼도 원 인덱스가 가리킨 부재를 고정한다.
    bound={}
    for key in answers:
        if not isinstance(key,str):raise ValueError('질문 key가 올바르지 않습니다.')
        match=re.fullmatch(r'(inputEvidence\.)?members\.(columns|walls|beams)\.(\d+)\.(.+)',normalized(key))
        if match:
            prefix,group,index,field=match.groups();rows=(p.get('members') or {}).get(group) or []
            if int(index)<len(rows):bound[key]=(prefix or '',group,rows[int(index)],field)
    for key,answer in answers.items():
        if not isinstance(key,str):raise ValueError('질문 key가 올바르지 않습니다.')
        q=copy.deepcopy(known.get(key) or question_for(key,p))
        _scope_member_answer(p,key)
        target=input_key(key,p)
        if key in bound:
            prefix,group,row,field=bound[key]
            index=next((i for i,m in enumerate(p['members'][group]) if m is row),None)
            if index is None:raise ValueError('답변 대상 부재가 바뀌었습니다. 도면을 다시 확인하세요.')
            target=f'{prefix}members.{group}.{index}.{field}'
        q['inputKey']=target
        if q['kind'] in ('zone','importance') and isinstance(answer,str) and answer.strip() not in UNKNOWN and answer not in ('I','II','특'):
            target='location' if q['kind']=='zone' else 'occupancy.legalUse'
            auto_key='seismic.'+('zone' if q['kind']=='zone' else 'importance')
            previous=(p.get('inputEvidence') or {}).get(auto_key) or {}
            if previous.get('source')=='자동(주소/용도)' and previous.get('confirmed') is False and (p.get('seismic') or {}).get(auto_key.split('.')[-1])==previous.get('value'):
                p['seismic'].pop(auto_key.split('.')[-1],None)
            if previous.get('source')=='자동(주소/용도)' and previous.get('confirmed') is False or previous.get('withheld') is True:
                (p.get('inputEvidence') or {}).pop(auto_key,None)
            value=answer.strip()
        else:value=answer_value(q,answer)
        if target is None:
            if value is None:unresolved.append(key);continue
            raise ValueError('계산 결과를 입력으로 바꿀 수 없습니다. 관련 도면·자료를 확인하세요.')
        explicit_null=target=='seismic.mapS' and answer=='지역별 표라 사용하지 않음'
        if explicit_null and (p.get('seismic') or {}).get('method')!='zone':raise ValueError('지역별 표를 선택한 경우에만 지도값을 사용하지 않을 수 있어요.')
        _write(p,target,value,remove=value is None and not explicit_null)
        evidence=p.setdefault('inputEvidence',{})
        if value is None and not explicit_null:
            evidence[target]={'source':'사용자 확인 전','confirmed':False,'withheld':True,
                              'assumption':'사용자가 확인 전으로 남긴 항목. 새 명시 답까지 자동 채움을 중지합니다.'}
            unresolved.append(target)
        else:evidence[target]={'source':'사용자 답변','confirmed':True,'assumption':None}
    json.dumps(p,allow_nan=False)
    return p,unresolved

def questions_from(response,p):
    found=[]
    def collect(value,context=None):
        if isinstance(value,dict):
            if value.get('id') and value.get('kind') and value.get('level') is not None:
                context=f"members.{value['kind']}.{value['id']}.{value['level']}"
            elif value.get('memberKey'):
                match=re.fullmatch(r'(.+)@(\d+)',str(value['memberKey']))
                if match:
                    member,level=match.groups()
                    candidates=[group[:-1] for group,rows in (p.get('members') or {}).items() if isinstance(rows,list) and any(m.get('id')==member for m in rows)]
                    if len(candidates)==1:context=f'members.{candidates[0]}.{member}.{level}'
            for k,v in value.items():
                if k in ('missing','missingInputs') and isinstance(v,list):
                    for item in v:
                        key=item.get('key') if isinstance(item,dict) else item
                        if not isinstance(key,str):continue
                        # 개별 부재의 짧은 필드명에 id·층을 붙여 주 엔진과 같은 키로 만든다.
                        if context and not re.match(r'^(seismic|members|floors|storeys|diaphragms|analysis|dirs|strength|materials|inputEvidence)\.',key):key=context+'.'+key
                        if key not in found:found.append(key)
                elif isinstance(v,(dict,list)):collect(v,context)
        elif isinstance(value,list):
            for v in value:collect(v,context)
    collect(response)
    proposals={}
    for result in ((response.get('model') or {}).get('preliminary') or {}).get('memberResults',[]):
        choice=(result.get('data') or {}).get('choice') or result.get('choice')
        if isinstance(choice,dict):proposals[(result.get('id'),result.get('level'))]=choice
    questions=[]
    for key in found:
        target=input_key(key,p);proposal=None
        match=re.match(r'floors\.(\d+)\.(columns|walls)\.(\d+)\.',target or '')
        if match:
            level,group,index=match.groups();member=p['floors'][int(level)][group][int(index)]
            proposal=proposals.get((member.get('id'),int(level)+1))
        match=re.match(r'members\.(columns|walls|beams)\.(\d+)\.',target or '')
        if match:
            group,index=match.groups();rows=(p.get('members') or {}).get(group) or []
            member=rows[int(index)] if int(index)<len(rows) else {}
            context=re.fullmatch(r'members\.(?:column|wall|beam)\.[^.]+\.(\d+)\..+',key)
            level=int(context[1]) if context else member.get('level')
            proposal=proposals.get((member.get('id'),level))
        questions.append(question_for(key,p,proposal))
    return questions
