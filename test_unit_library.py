from unittest.mock import patch
import copy
import json
import pytest
import cad_asset_client as client
import unit_library

# 7.0.x: CAD(bridge) 의 단위세대·주동 검색·넣기는 서버 자산(detail_search_library)만 쓴다.
# unit_library 는 로컬 폴더를 읽는 등록 도구 입력이라 그 시험은 그대로 두고, bridge 시험은 가짜 서버로 본다.
SERVER_UNITS=[{'kind':'unit','id':'UN-1','name':'84A 4.5베이','type_name':'84A','exclusive_area_m2':84,'bays':4.5,'rooms':3,'bathrooms':2,'core_form':'계단실형'},
              {'kind':'unit','id':'UN-2','name':'59B','exclusive_area_m2':59.7,'bays':3,'rooms':2,'bathrooms':1,'core_form':'복도형'}]
SERVER_JUTONG=[{'kind':'jutong','id':'JT-1','combination':'84A×2+59A×2','form':'판상형 일자'},
               {'kind':'jutong','id':'JT-2','combination':'59A×4','form':'타워형'}]
SERVER_UNIT_ASSET={**SERVER_UNITS[0],'format':'barun-asset/1','version':'2026-10-13','meta':{},
    'scenes':[{'n':1,'title':'평면','layers':[{'id':'wall','name':'A-WALL'}],
        'entities':[{'id':'e1','type':'line','layer':'wall','points':[{'x':0,'y':0},{'x':1000,'y':0}]}]}]}


@pytest.fixture(autouse=True)
def server(monkeypatch):
    # 진짜 계정 토큰·자산 서버(와 설치판 썸네일 목록)에 나가지 않는다.
    rows=SERVER_UNITS+SERVER_JUTONG
    monkeypatch.setattr(client,'catalog',lambda kind=None:copy.deepcopy([row for row in rows if kind in (None,row['kind'])]))
    monkeypatch.setattr(client,'get_asset',lambda kind,identifier:copy.deepcopy(SERVER_UNIT_ASSET) if (kind,identifier)==('unit','UN-1') else (_ for _ in ()).throw(client.CadAssetError('not_found')))
    monkeypatch.setattr(client,'_account_token',lambda:(_ for _ in ()).throw(AssertionError('real token consulted')))


def write_catalog(tmp_path):
    root=tmp_path/'units'
    root.mkdir()
    rows=[{'id':'UN-1','name':'84A 4.5베이','type_name':'84A','exclusive_area_m2':84,'bays':4.5,'rooms':3,'bathrooms':2,'core_form':'계단실형','detail_path':'g.json','scale_verified':True,'usable_as_unit':True},
          {'id':'UN-2','name':'59B','exclusive_area_m2':59.7,'bays':3,'rooms':2,'bathrooms':1,'core_form':'복도형'},
          {'id':'JT-ignore','exclusive_area_m2':84}]
    (root/'index.json').write_text(json.dumps({'details':rows},ensure_ascii=False),encoding='utf-8')
    geometry={'units':'mm','layers':[{'id':'wall','name':'A-WALL'}],'entities':[{'type':'line','layer':'wall','points':[{'x':0,'y':0},{'x':1000,'y':0}]}]}
    (root/'g.json').write_text(json.dumps({'geometry':geometry}),encoding='utf-8')
    return root


@pytest.fixture
def catalog(tmp_path,monkeypatch):
    root=write_catalog(tmp_path)
    monkeypatch.setenv('BARUN_UNIT_LIBRARY',str(root))
    return root


def test_filters_fractional_bay_and_detail_aliases(catalog):
    result=unit_library.search_units({'area_min':80,'bays':4.5,'rooms':3,'bathrooms':2,'core_form':'계단실형','query':'84A 4.5'})
    assert result['count']==1
    assert result['units']==result['details']
    assert unit_library.search_units({'area_max':60})['count']==1
    got=unit_library.get_unit('UN-1',True)
    assert got['unit']==got['detail']
    assert got['geometry']['units']=='mm'


@pytest.mark.parametrize('args',[{'area_min':'84'},{'area_min':float('nan')},{'area_max':float('inf')},{'area_min':85,'area_max':59},{'bays':True},{'bays':-1},{'rooms':2.5},{'bathrooms':'2'},{'query':[]},{'core_form':[]}])
def test_bad_search_values(catalog,args):
    with pytest.raises(ValueError):unit_library.search_units(args)


def test_path_traversal(catalog):
    index=json.loads((catalog/'index.json').read_text(encoding='utf-8'))
    index['details'][0]['detail_path']='../secret.json'
    (catalog/'index.json').write_text(json.dumps(index),encoding='utf-8')
    with pytest.raises(ValueError):unit_library.get_unit('UN-1',True)


@pytest.mark.parametrize('field,value',[('scale_verified',False),('scale_verified',None),('usable_as_unit',False),('usable_as_unit',None)])
def test_reviewable_but_not_insertable(catalog,field,value):
    index=json.loads((catalog/'index.json').read_text(encoding='utf-8'))
    index['details'][0][field]=value
    (catalog/'index.json').write_text(json.dumps(index),encoding='utf-8')
    assert unit_library.get_unit('UN-1')['status']=='ok'
    got=unit_library.get_unit('UN-1',True)
    assert got['status']=='unavailable' and 'geometry' not in got
    assert got['detail']['id']=='UN-1'


@pytest.mark.parametrize('geometry',[{'units':'m','layers':[{}],'entities':[{}]},{'units':'mm','layers':[],'entities':[{}]},{'units':'mm','layers':[{}],'entities':[]},[]])
def test_invalid_mm_geometry(catalog,geometry):
    (catalog/'g.json').write_text(json.dumps({'geometry':geometry}),encoding='utf-8')
    assert unit_library.get_unit('UN-1',True)['status']=='unavailable'


@patch('miri_account_service.require_ai_login', new=lambda: None)
def test_generic_area_group_and_routes(monkeypatch):
    import bridge
    found=bridge.call('cad_search_details',{'classification':'단위세대/59㎡'})
    assert [row['id'] for row in found['details']]==['UN-2']
    assert bridge.call('cad_search_details',{'classification':'단위세대/84㎡','bays':4.5})['count']==1
    assert bridge.call('cad_search_units',{'bays':4.5})['count']==1
    assert bridge.call('cad_get_unit',{'id':'UN-1'})['unit']['id']=='UN-1'
    assert bridge.call('cad_get_detail',{'id':'UN-1'})['detail']['id']=='UN-1'
    with pytest.raises(ValueError):bridge.call('cad_insert_unit',{'id':'UN-1'},allow_edit=False)
    with pytest.raises(ValueError):bridge.call('cad_insert_unit',{'id':'UN-1','target':{}})
    validated=[]
    monkeypatch.setattr(bridge,'validate_target',lambda target:validated.append(target))
    monkeypatch.setattr(bridge,'dispatch',lambda name,args:{'name':name,'args':args})
    args={'id':'UN-1','target':{'test':'bound'},'position':{'x':100,'y':200},'rotation':90,'mirror':True}
    for name in ('cad_insert_unit','cad_insert_unit_bound','cad_insert_detail','cad_insert_detail_bound'):
        dispatched=bridge.call(name,args)
        assert dispatched['name']=='cad_insert_unit'
        assert dispatched['args']['detail']['geometry']['units']=='mm'
        assert dispatched['args']['rotation']==90 and dispatched['args']['mirror'] is True
    assert len(validated)==4


def test_mcp_schema_registration():
    import bridge
    tools={tool['name']:tool for tool in bridge.TOOLS}
    # *_bound 는 목록에 싣지 않고 BOUND_ALIASES 로 원래 이름에 연결한다.
    assert bridge.BOUND_ALIASES['cad_insert_unit_bound']=='cad_insert_unit'
    assert 'cad_insert_unit_bound' not in tools
    assert 'cad_insert_unit' in bridge.MUTATING_TOOLS
    assert 'target' in tools['cad_insert_unit']['inputSchema']['required']
    assert tools['cad_insert_unit']['inputSchema']['properties']['mirror']['type']=='boolean'
    assert tools['cad_search_units']['inputSchema']['properties']['bays']['type']=='number'
    assert {'query','combination'}<=tools['cad_search_jutong']['inputSchema']['properties'].keys()
    assert {'rotation','mirror'}<=tools['cad_insert_detail']['inputSchema']['properties'].keys()
    assert {'bays','core_form','combination','area_min','area_max'}<=tools['cad_search_details']['inputSchema']['properties'].keys()


@patch('miri_account_service.require_ai_login', new=lambda: None)
def test_generic_combination_keeps_legacy_form_route():
    import bridge
    assert bridge.call('cad_search_details',{'classification':'주동/84A×2+59A×2'})['count']==1
    assert bridge.call('cad_search_details',{'classification':'주동/판상형'})['details'][0]['id']=='JT-1'
    assert bridge.call('cad_search_details',{'classification':'주동','combination':'59A×4'})['details'][0]['id']=='JT-2'


def test_unavailable_missing_and_invalid_id(tmp_path,monkeypatch):
    monkeypatch.setenv('BARUN_UNIT_LIBRARY',str(tmp_path))
    result=unit_library.search_units({})
    assert result['status']=='unavailable' and result['details']==result['units']==[]
    with pytest.raises(ValueError):unit_library.get_unit('../x')
    with pytest.raises(ValueError):unit_library.get_unit('UN-1','true')

@pytest.mark.parametrize('legacy',[False,True])
@patch('miri_account_service.require_ai_login', new=lambda: None)
def test_actual_mm_catalog_and_legacy_rows(catalog,legacy):
 index=json.loads((catalog/'index.json').read_text(encoding='utf8'))
 if legacy:index={'units':index['details']}
 else:index['units']='mm';index['category']='단위세대'
 (catalog/'index.json').write_text(json.dumps(index),encoding='utf8')
 assert unit_library.search_units({'area_min':84})['count']==1
 assert unit_library.get_unit('UN-1',True)['geometry']['units']=='mm'
 import bridge
 assert bridge.call('cad_search_details',{'classification':'단위세대/84㎡'})['count']==1
