"""No CAD service or protected assets needed: request validation before dispatch."""
import math
import pytest
import bridge

def valid(**changes):
    return {'facility':dict(use='clinic',areaM2=500,work='change-use',date='2026-10-11',**changes)}

def test_complete_request():
    request=valid(parkingSpaces=10,parkingRatio=.03,employmentObligation=False)
    request.update(story='11F',origin={'x':100,'y':200},overlay=True)
    bridge.validate_access_request(request)

@pytest.mark.parametrize('new,model',[(True,None),(True,{'stories':[],'elements':[]})])
def test_new_requires_facility_even_with_model(new,model):
    with pytest.raises(ValueError):bridge.validate_access_request({'model':model},new=new)

def test_regeneration_may_reuse_facility():
    bridge.validate_access_request({},new=False)

@pytest.mark.parametrize('field,value',[('areaM2',0),('areaM2',True),('areaM2',math.inf),('date','2026-02-30'),('date','20261011'),('work','repair'),('use',' '),('parkingSpaces',1.5),('rooms',-1),('units',True),('residents',math.nan),('parkingRatio',1.1),('parkingRatio',-.1),('employmentObligation','no')])
def test_reject_invalid_facility(field,value):
    request=valid();request['facility'][field]=value
    with pytest.raises(ValueError):bridge.validate_access_request(request)

@pytest.mark.parametrize('extra',[{'origin':{'x':math.nan,'y':0}},{'origin':{'x':0}},{'overlay':'true'},{'story':1}])
def test_reject_invalid_drawing_options(extra):
    request=valid();request.update(extra)
    with pytest.raises(ValueError):bridge.validate_access_request(request)

def test_unknown_facility_field_rejected():
    with pytest.raises(ValueError):bridge.validate_access_request(valid(customer='excluded'))

def test_both_mcp_schemas_offer_facility_and_overlay():
    for name in ('cad_access_plan','cad_generate_drawing'):
        tool=next(t for t in bridge.TOOLS if t['name']==name)
        fields=tool['inputSchema']['properties']
        assert {'facility','story','origin','overlay'}<=set(fields)
    assert 'cad_access_plan' in bridge.MUTATING_TOOLS
