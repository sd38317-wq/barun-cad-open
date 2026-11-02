from unittest.mock import patch
import copy
import json
import pytest
import cad_asset_client as client
from jutong_library import search_jutong,get_jutong

# 7.0.x: CAD(bridge) 의 주동 검색·넣기는 서버 자산(detail_search_library)만 쓴다.
# jutong_library 는 로컬 폴더를 읽는 등록 도구 입력이라 그 시험은 그대로 두고, bridge 시험은 가짜 서버로 본다.
SERVER_JUTONG=[{'kind':'jutong','id':'JT-one','name':'84A','form':'판상형 일자'},
               {'kind':'jutong','id':'JT-two','name':'84A 타워','form':'타워형'}]
SERVER_JUTONG_ASSET={**SERVER_JUTONG[0],'format':'barun-asset/1','version':'2026-10-13','meta':{},
    'scenes':[{'n':1,'title':'주동','layers':[{'id':'wall','name':'A-WALL'}],
        'entities':[{'id':'e1','type':'line','layer':'wall','points':[{'x':0,'y':0},{'x':1000,'y':0}]}]}]}

@pytest.fixture(autouse=True)
def server(monkeypatch):
 # 진짜 계정 토큰·자산 서버(와 설치판 썸네일 목록)에 나가지 않는다.
 monkeypatch.setattr(client,'catalog',lambda kind=None:copy.deepcopy([row for row in SERVER_JUTONG if kind in (None,row['kind'])]))
 monkeypatch.setattr(client,'get_asset',lambda kind,identifier:copy.deepcopy(SERVER_JUTONG_ASSET) if (kind,identifier)==('jutong','JT-one') else (_ for _ in ()).throw(client.CadAssetError('not_found')))
 monkeypatch.setattr(client,'_account_token',lambda:(_ for _ in ()).throw(AssertionError('real token consulted')))
def test_search_and_get(tmp_path,monkeypatch):
 monkeypatch.setenv('BARUN_JUTONG_LIBRARY',str(tmp_path));(tmp_path/'a.json').write_text(json.dumps({'geometry':{'units':'mm','entities':[{'id':'e'}]}}),encoding='utf8');(tmp_path/'index.json').write_text(json.dumps({'version':1,'units':'mm','details':[{'id':'a','form':'판상형','units_per_floor':4,'unit_types':[{'type':'84A','count':4}],'scale_verified':True,'detail_path':'a.json'}]}),encoding='utf8');assert search_jutong({'form':'판상형','units_per_floor':4})['count']==1;assert get_jutong('a',True)['geometry']['entities']

def _write_index(root, details):
 (root/'index.json').write_text(json.dumps({'version':1,'units':'mm','details':details}),encoding='utf8')
def test_missing_library_and_metadata_only_scale(monkeypatch,tmp_path):
 monkeypatch.setenv('BARUN_JUTONG_LIBRARY',str(tmp_path/'absent')); assert search_jutong({})['status']=='unavailable'
 monkeypatch.setenv('BARUN_JUTONG_LIBRARY',str(tmp_path)); _write_index(tmp_path,[{'id':'u','scale_verified':False,'name':'확인 필요'}]); assert get_jutong('u')['status']=='ok'; assert get_jutong('u',True)['status']=='unavailable'
def test_path_traversal_and_dxf_only_block_geometry(monkeypatch,tmp_path):
 monkeypatch.setenv('BARUN_JUTONG_LIBRARY',str(tmp_path)); _write_index(tmp_path,[{'id':'bad','scale_verified':True,'detail_path':'../outside.json'},{'id':'dxf','scale_verified':True,'dxf_path':'shape.dxf'}]); assert get_jutong('bad',True)['status']=='unavailable'; assert get_jutong('dxf',True)['status']=='unavailable'
def test_invalid_range_and_query_types_are_rejected(monkeypatch,tmp_path):
 monkeypatch.setenv('BARUN_JUTONG_LIBRARY',str(tmp_path)); _write_index(tmp_path,[{'id':'a','form':'판상형','width_mm':1000,'depth_mm':500}]);
 import pytest
 with pytest.raises((TypeError,ValueError)): search_jutong({'min_width_mm':2000,'max_width_mm':1000})
 with pytest.raises((TypeError,ValueError)): search_jutong({'units_per_floor':'4'})

def test_filters_find_actual_types_and_inclusive_mm_ranges(monkeypatch,tmp_path):
 monkeypatch.setenv('BARUN_JUTONG_LIBRARY',str(tmp_path))
 _write_index(tmp_path,[{'id':'JT-one','name':'판상형 84A','form':'판상형 일자','units_per_floor':4,'unit_types':[{'type':'84A','count':4}],'width_mm':30000,'depth_mm':14000},{'id':'JT-two','form':'혼합형','units_per_floor':6,'width_mm':45000,'depth_mm':25000}])
 assert search_jutong({'form':'판상형','unit_type':'84a','units_per_floor':4,'min_width_mm':30000,'max_width_mm':30000,'max_depth_mm':14000})['count']==1
 assert search_jutong({'min_width_mm':30001,'unit_type':'84A'})['count']==0

@patch('miri_account_service.require_ai_login', new=lambda: None)
def test_common_detail_route_and_target_bound_dispatch(monkeypatch):
 import bridge
 assert bridge.call('cad_search_details',{'classification':'주동/판상형','query':'84A'})['count']==1
 assert bridge.call('cad_get_detail',{'id':'JT-one'})['detail']['id']=='JT-one'
 with pytest.raises(ValueError):bridge.call('cad_insert_jutong',{'id':'JT-one'},False)
 with pytest.raises(ValueError):bridge.call('cad_insert_jutong',{'id':'JT-one','target':{}})
 validated=[];sent=[]
 monkeypatch.setattr(bridge,'validate_target',lambda t:validated.append(t))
 monkeypatch.setattr(bridge,'dispatch',lambda name,args:sent.append((name,args)) or {'status':'ok'})
 assert bridge.call('cad_insert_detail',{'id':'JT-one','target':{'binding':'yes'},'position':{'x':0,'y':0}})['status']=='ok'
 assert validated==[{'binding':'yes'}]
 assert sent[0][0]=='cad_insert_jutong' and sent[0][1]['detail']['geometry']['units']=='mm'
 tools={t['name']:t for t in bridge.TOOLS}
 # *_bound 는 목록에 싣지 않고 BOUND_ALIASES 로 원래 이름에 연결한다.
 assert bridge.BOUND_ALIASES['cad_insert_jutong_bound']=='cad_insert_jutong'
 assert 'cad_insert_jutong_bound' not in tools
 assert 'target' in tools['cad_insert_jutong']['inputSchema']['required']

def test_unusable_entry_allows_review_but_not_geometry(monkeypatch,tmp_path):
 monkeypatch.setenv('BARUN_JUTONG_LIBRARY',str(tmp_path))
 _write_index(tmp_path,[{'id':'JT-part','scale_verified':True,'usable_as_jutong':False}])
 assert get_jutong('JT-part')['status']=='ok'
 assert get_jutong('JT-part',True)['status']=='unavailable'

def test_nonfinite_ranges_and_wrong_query_type_rejected(monkeypatch,tmp_path):
 import pytest
 monkeypatch.setenv('BARUN_JUTONG_LIBRARY',str(tmp_path));_write_index(tmp_path,[])
 for args in ({'min_width_mm':float('nan')},{'max_depth_mm':float('inf')},{'query':[]},{'units_per_floor':True}):
  with pytest.raises(ValueError):search_jutong(args)
