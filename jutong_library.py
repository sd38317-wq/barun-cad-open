"""On-demand apartment building library."""
import json, os, math
from pathlib import Path
DEFAULT_ROOT=r"D:\어플\설계엔진\평면자산\주동"
def library_root(): return Path(os.environ.get("BARUN_JUTONG_LIBRARY") or DEFAULT_ROOT).resolve()
def _catalog():
 root=library_root(); p=root/'index.json'
 if not p.is_file(): return root,None
 d=json.loads(p.read_text(encoding='utf-8'))
 if not isinstance(d,dict) or not isinstance(d.get('details'),list): raise ValueError('주동 index.json 형식이 올바르지 않습니다.')
 return root,d
def search_jutong(args=None,**kwargs):
 q=dict(args or {},**kwargs); root,cat=_catalog()
 if cat is None:return {'status':'unavailable','message':'주동 라이브러리 없음','details':[]}
 query=q.get('query','')
 if not isinstance(query,str):raise ValueError('검색어는 문자열이어야 합니다.')
 combo=q.get('combination','');
 if not isinstance(combo,str):raise ValueError('조합은 문자열이어야 합니다.')
 form=q.get('form',''); typ=q.get('unit_type',q.get('unitType','')); units=q.get('units_per_floor',q.get('unitsPerFloor'))
 if not isinstance(form,str) or not isinstance(typ,str):raise ValueError('형태와 세대 타입은 문자열이어야 합니다.')
 if units is not None and (type(units) is not int or units<1):raise ValueError('층당 세대수는 양의 정수여야 합니다.')
 for f in ('width_mm','depth_mm'):
  lo=q.get('min_'+f);hi=q.get('max_'+f)
  for v in (lo,hi):
   if v is not None and (type(v) not in (int,float) or not math.isfinite(v) or v<0):raise ValueError('크기 범위는 유한한 음이 아닌 mm 값이어야 합니다.')
  if lo is not None and hi is not None and lo>hi:raise ValueError('최소 크기가 최대 크기보다 큽니다.')
 def ok(d):
  hay=' '.join(str(d.get(k,'')) for k in ('id','name','form','original_name','text_summary','combination')).casefold()
  if not all(word in hay for word in query.casefold().split()):return False
  if combo and combo.casefold() not in str(d.get('combination','')).casefold():return False
  if form and form.casefold() not in str(d.get('form',(d.get('classification') or {}).get('second_name',''))).casefold():return False
  if units is not None and d.get('units_per_floor')!=units:return False
  if typ and not any(str(x.get('type','')).casefold()==str(typ).casefold() for x in d.get('unit_types',[])):return False
  for f in ('width_mm','depth_mm'):
   v=d.get(f); lo=q.get('min_'+f); hi=q.get('max_'+f)
   if lo is not None and (not isinstance(v,(int,float)) or v<lo):return False
   if hi is not None and (not isinstance(v,(int,float)) or v>hi):return False
  return True
 rows=[d for d in cat['details'] if ok(d)]; return {'status':'ok','count':len(rows),'details':rows}
def get_jutong(identifier,include_geometry=False):
 if not isinstance(identifier,str) or not identifier:raise ValueError('주동 ID가 필요합니다.')
 if not isinstance(include_geometry,bool):raise ValueError('include_geometry는 boolean이어야 합니다.')
 root,cat=_catalog()
 if cat is None:return {'status':'unavailable','message':'주동 라이브러리 없음'}
 item=next((d for d in cat['details'] if d.get('id')==identifier),None)
 if item is None:return {'status':'not_found','id':identifier}
 if include_geometry and item.get('usable_as_jutong') is False:return {'status':'unavailable','message':'동 전체 구성·분리 범위 확인 필요','detail':item}
 if include_geometry and item.get('scale_verified') is not True:return {'status':'unavailable','message':'축척 확인 필요','detail':item}
 out={'status':'ok','detail':dict(item)}
 if include_geometry:
  rel=item.get('detail_path'); p=(root/rel).resolve() if rel else None
  if p is None or not p.is_relative_to(root) or not p.is_file() or p.suffix.lower()!='.json':return {'status':'unavailable','message':'주동 기하 자료 없음','detail':item}
  geometry=json.loads(p.read_text(encoding='utf-8')).get('geometry',{})
  if geometry.get('units')!='mm' or not geometry.get('entities'):return {'status':'unavailable','message':'실제 mm 기하 자료가 올바르지 않습니다.','detail':item}
  out['geometry']=geometry
 return out
