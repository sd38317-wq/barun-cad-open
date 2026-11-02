"""On-demand local LH, LA, and structural-steel detail catalogs."""
import gzip
import json
import os
import re
from pathlib import Path

DEFAULT_ROOT=r'D:\어플\캐드\data\lh-details'
DEFAULT_2025_ROOT=r'D:\어플\캐드\data\lh-2025'
DEFAULT_LA_ROOT=r'D:\어플\캐드\data\la-details'
DEFAULT_STEEL_ROOT=r'D:\어플\캐드\data\steel-details'
SOURCES=('lh2025','lh2017','la','steel')

def library_root(source='lh2017'):
    if source=='lh2025':return Path(os.environ.get('BARUN_LH_2025') or DEFAULT_2025_ROOT).resolve()
    if source=='la':return Path(os.environ.get('BARUN_LA_DETAILS') or DEFAULT_LA_ROOT).resolve()
    if source=='steel':return Path(os.environ.get('BARUN_STEEL_DETAILS') or DEFAULT_STEEL_ROOT).resolve()
    return Path(os.environ.get('BARUN_LH2017_DETAILS') or os.environ.get('BARUN_LH_DETAILS') or DEFAULT_ROOT).resolve()

def library_2025_root():return library_root('lh2025')
def _unavailable():return {'status':'unavailable','message':'라이브러리 없음','details':[]}
def _validate_source(source):
    if not isinstance(source,str) or source not in ('',*SOURCES):raise ValueError('지원하지 않는 출처입니다.')

def _read_catalog_at(root,primary=False):
    for name in ('catalog.json','list2025.json') if primary else ('catalog.json',):
        path=root/name
        if path.is_file():return root,json.loads(path.read_text(encoding='utf-8'))
    return root,None

def _catalogs(source=''):
    _validate_source(source)
    legacy=Path(os.environ.get('BARUN_LH_DETAILS') or DEFAULT_ROOT).resolve()
    isolated=bool(os.environ.get('BARUN_LH_DETAILS')) and legacy!=Path(DEFAULT_ROOT).resolve()
    configured=[]
    if not isolated or os.environ.get('BARUN_LH_2025'):configured.append(('lh2025',library_root('lh2025')))
    configured.append(('lh2017',legacy))
    if os.environ.get('BARUN_LH2017_DETAILS'):configured.append(('lh2017',library_root('lh2017')))
    if not isolated or os.environ.get('BARUN_LA_DETAILS') or source=='la':configured.append(('la',library_root('la')))
    if not isolated or source=='steel' or os.environ.get('BARUN_STEEL_DETAILS'):configured.append(('steel',library_root('steel')))
    seen=set();catalogs=[]
    for current,root in configured:
        if root in seen:continue
        seen.add(root);_,catalog=_read_catalog_at(root,current=='lh2025')
        if catalog is not None:catalogs.append((current,root,catalog))
    return catalogs

def _safe_path(root,relative):
    if not isinstance(relative,str) or Path(relative).is_absolute():raise ValueError('라이브러리 경로가 자료 폴더를 벗어납니다.')
    candidate=(root/relative).resolve()
    if not candidate.is_relative_to(root):raise ValueError('라이브러리 경로가 자료 폴더를 벗어납니다.')
    return candidate

def _rows(catalog):
    # Never expose sheet geometry, including old mixed or malformed catalogs.
    return [row for row in catalog.get('details',[]) if row.get('kind','detail')=='detail' and not row.get('superseded_by')]

def _pools(source=''):
    catalogs=_catalogs(source);pools=[]
    for current,root,catalog in catalogs:
        for original in _rows(catalog):
            item=dict(original);found=item.get('source') or catalog.get('source') or current
            if found not in SOURCES:found=current
            item['source']=found
            number=item.get('drawing_id') or item.get('id','').split('@')[0];item['drawing_id']=number
            if found=='lh2025':
                item.setdefault('id',number+'@2025-01'+('-list-'+str(item['xlsx_row']) if item.get('xlsx_row') else ''))
                item.setdefault('edition','2025-01');item.setdefault('edition_label','2025년 1월 기준판');item.setdefault('baseline_status','primary')
            elif found=='lh2017':
                item.setdefault('edition','legacy');item.setdefault('edition_label','구판 (2017~2019 DWG)')
            pools.append((found,root,item))
    current={item['drawing_id'] for found,_,item in pools if found=='lh2025'}
    for found,_,item in pools:
        if found=='lh2017':item['baseline_status']='auxiliary' if item['drawing_id'] in current else 'old-only'
    return [entry for entry in pools if not source or entry[0]==source],bool(catalogs)

def _public(item):return {k:v for k,v in item.items() if not k.startswith('_')}
def search_details(query='',classification='',facility='',source='',kind=None):
    if not all(isinstance(v,str) for v in (query,classification,facility)):raise ValueError('검색어·분류·시설은 문자열이어야 합니다.')
    if kind not in (None,'detail'):raise ValueError('상세 단위만 조회할 수 있습니다.')
    pools,available=_pools(source)
    if not available:return _unavailable()
    words=query.casefold().split();selected=[];legacy={}
    for current,_,detail in pools:
        if current=='lh2017':legacy.setdefault(detail['drawing_id'],[]).append({k:detail.get(k) for k in ('id','source','edition','edition_label','opening_status','baseline_status')})
    for current,_,detail in pools:
        hay=' '.join(str(detail.get(k,'')) for k in ('id','detail_id','drawing_id','title','name','drawing_title','text_summary')).casefold();classes=detail.get('classification') or {}
        if words and not all(word in hay for word in words):continue
        code=re.fullmatch(r'(?:DA[-:]?)?(\d{1,2})',classification,re.I) if current in ('lh2017','lh2025') else None
        if code:
            number=code[1]
            if number!=classes.get('first_code' if len(number)==1 else 'second_code'):continue
        elif classification:
            names=' '.join(str(v) for v in classes.values()).casefold()
            if not all(part.strip().casefold() in names for part in classification.split('/') if part.strip()):continue
        if facility and facility not in detail.get('facility',[]):continue
        row={k:v for k,v in _public(detail).items() if k not in ('texts','notes','text_summary')};row['text_summary']=str(detail.get('text_summary',''))[:500]
        if current=='lh2025':row['legacy_versions']=detail.get('legacy_versions') or legacy.get(detail['drawing_id'],[])
        selected.append(row)
    return {'status':'ok','count':len(selected),'details':selected}

def get_detail(identifier,include_geometry=False,source=''):
    if not isinstance(include_geometry,bool):raise ValueError('include_geometry는 boolean이어야 합니다.')
    if not isinstance(identifier,str) or not identifier:raise ValueError('상세 ID가 필요합니다.')
    pools,available=_pools(source)
    if not available:return _unavailable()
    candidates=[p for p in pools if p[2].get('id')==identifier]
    if not candidates:candidates=[p for p in pools if p[2].get('detail_id')==identifier]
    if not candidates:
        candidates=[p for p in pools if p[2].get('drawing_id')==identifier]
    if not candidates:return {'status':'not_found','message':'상세를 찾을 수 없습니다.','id':identifier}
    if len(candidates)>1:return {'status':'ambiguous','message':'같은 상세 ID/도면 번호가 여러 개입니다. 검색 결과 ID와 source를 지정하세요.','details':[_public(p[2]) for p in candidates]}
    current,root,item=candidates[0];result={'status':'ok','detail':_public(item)}
    for key in ('revision','revision_history','latest'):
        if key in item:result[key]=item[key]
    if include_geometry:
        if item.get('assignment',{}).get('requires_review') or item.get('insertion_allowed') is False:result['review_required']=True
        if item.get('opening_status') not in ('ok','partial') or not item.get('detail_path'):return {'status':'unavailable','message':'열리지 않은 상세입니다.','detail':result['detail']}
        asset=_safe_path(root,item['detail_path'])
        if not asset.is_file():return {'status':'unavailable','message':'상세 자료가 없습니다. 등록 도구를 다시 실행하세요.','detail':result['detail']}
        if asset.name.endswith('.gz'):
            with gzip.open(asset,'rt',encoding='utf-8') as stream:payload=json.load(stream)
        else:payload=json.loads(asset.read_text(encoding='utf-8'))
        result['geometry']=payload['geometry']
    return result
