"""Read-only retrieval of Phase 0 outputs by declared reuse capability."""
import json
import sqlite3
import time
from contextlib import closing
from pathlib import Path

ROOT=Path(__file__).resolve().parent


UNAVAILABLE={'status':'unavailable','code':'not_bundled','count':0,'results':[],
             'message':'이 설치판에는 분류 도면 자료(전체 정규화 인덱스)가 들어 있지 않습니다. 비슷한 사례는 cad_search_design_cases 로 찾으세요.'}


def available():
    return (ROOT/'data/usability/current.json').exists()


def connection():
    folder=ROOT/'data/usability'
    pointer=folder/'current.json'
    if not pointer.exists(): raise ValueError('전체 정규화 활용 인덱스가 아직 없습니다.')
    metadata=json.loads(pointer.read_text(encoding='utf-8'))
    path=(folder/metadata['database']).resolve()
    if path.parent!=folder.resolve() or not path.is_file(): raise ValueError('활용 인덱스 경로 오류')
    db=sqlite3.connect(path.as_uri()+'?mode=ro',uri=True);db.row_factory=sqlite3.Row
    return db


def search(data):
    kind=data.get('building_type','')
    if kind not in ('','APT','MULTI','DETACHED'): raise ValueError('건물 유형을 확인하세요.')
    usage=data.get('usage','relative_space_geometry')
    columns={'all':None,'relative_space_geometry':'relative_usable','physical_geometry':'scale_verified','unit_extraction':'unit_ready'}
    if usage not in columns: raise ValueError('지원하지 않는 활용 범위')
    doc_type=data.get('doc_type','평면도')
    if doc_type not in ('','평면도','단면도','입면도','구조도','UNKNOWN'): raise ValueError('도면 종류를 확인하세요.')
    limit=data.get('limit',20);offset=data.get('offset',0)
    if type(limit) is not int or type(offset) is not int or not 1<=limit<=100 or offset<0: raise ValueError('limit/offset 범위 오류')
    clauses=[];values=[]
    if kind: clauses.append('building_type=?');values.append(kind)
    if doc_type: clauses.append('doc_type=?');values.append(doc_type)
    if columns[usage]: clauses.append(columns[usage]+'=1')
    for key in ('bedrooms','baths'):
        if key in data:
            value=data[key]
            if type(value) is not int or not 0<=value<=100: raise ValueError('실 개수 범위 오류')
            clauses.append(key+'=?');values.append(value)
    condition=' AND '.join(clauses) or '1=1'
    with closing(connection()) as db:
        total=db.execute('SELECT count(*) FROM documents WHERE '+condition,values).fetchone()[0]
        rows=db.execute('SELECT payload FROM documents WHERE '+condition+' ORDER BY priority DESC,document_id LIMIT ? OFFSET ?',values+[limit,offset]).fetchall()
    results=[]
    for row in rows:
        result=json.loads(row['payload'])
        result.pop('dimension_text_candidates',None)
        results.append(result)
    return {'results':results,'total':total,'offset':offset,'hasMore':offset+len(results)<total,
            'notice':'이미지 그룹·시트 기준 참고 자료입니다. 실 개수는 세대별 개수가 아니며, relative_space_geometry는 mm 축척·통행 연결을 확인했다는 뜻이 아닙니다.'}


def detail(data):
    key=data.get('id')
    if not isinstance(key,str) or not key: raise ValueError('도면 또는 원본 ID가 필요합니다.')
    with closing(connection()) as db:
        row=db.execute('SELECT payload FROM documents WHERE document_id=?',(key,)).fetchone()
        if row is None:
            row=db.execute('SELECT d.payload FROM documents d JOIN sources s ON s.document_id=d.document_id WHERE s.source_id=?',(key,)).fetchone()
    if row is None: raise ValueError('정규화 도면을 찾을 수 없습니다.')
    result=json.loads(row['payload'])
    if data.get('include_geometry'):
        path=Path(result['classified_path']).resolve()
        if path.parent!=(ROOT/'data/classified').resolve(): raise ValueError('분류 도면 경로 오류')
        result['document']=json.loads(path.read_text(encoding='utf-8'))
    return result


def summary():
    with closing(connection()) as db:
        totals=db.execute('SELECT count(*),sum(relative_usable),sum(scale_verified),sum(unit_ready) FROM documents').fetchone()
        source_count=db.execute('SELECT count(*) FROM sources').fetchone()[0]
        floor_count=db.execute('SELECT count(*) FROM documents WHERE doc_type=?',('평면도',)).fetchone()[0]
    result=dict(zip(('documents','relative_space_geometry','physical_geometry','unit_extraction'),totals),source_records=source_count)
    state_path=ROOT/'data/usability/enrichment-status.json'
    if state_path.exists():
        state=json.loads(state_path.read_text(encoding='utf-8'))
        result['enrichment']={'stage':state['stage'],'numeric_ocr_target':floor_count,
            'numeric_ocr_sidecars':sum(1 for p in (ROOT/'data/recovered-numeric-ocr').glob('*.json') if len(p.stem)==64),
            'notice':'Sidecars include processed and failed attempts. OCR hypotheses are not verified dimensions.'}
        progress_path=ROOT/'data/recovered-numeric-ocr/progress.json'
        if progress_path.exists():
            progress=json.loads(progress_path.read_text(encoding='utf-8'))
            result['enrichment']['progress']=progress
            result['enrichment']['progress_matches_job']=progress.get('pid')==state.get('pid')
            result['enrichment']['progress_age_seconds']=round(time.time()-progress.get('updated_at_unix',0),1)
        result['enrichment']['pid']=state.get('pid')
    return result


def planning_context(query):
    kind=next((value for word,value in [('단독','DETACHED'),('다세대','MULTI'),('연립','MULTI'),('아파트','APT')] if word in query),'')
    if any(word in query for word in ('병원','학교','상가','사무실')):
        return {'references':[],'notice':'현재 정규화 주거 자료에 해당 건물 용도 없음'}
    result=search({'building_type':kind,'usage':'relative_space_geometry','limit':3})
    return {'kind':'normalized_drawing_reference','total':result['total'],'notice':result['notice'],
            'references':[{k:r[k] for k in ('document_id','source_ids','building_type','doc_subtype','capabilities','requirements','valid_entity_counts','scale_status')} for r in result['results']]}
