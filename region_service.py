from shapely.geometry import Polygon
from shapely.ops import unary_union

def process(data):
    polygons=[]
    for item in data['regions']:
        p=Polygon([(p['x'],p['y']) for p in item['points']], [[(p['x'],p['y']) for p in loop] for loop in item.get('loops',[])])
        if not p.is_valid or p.is_empty:raise ValueError('자기 교차 또는 빈 경계는 병합할 수 없습니다.')
        polygons.append(p)
    result=unary_union(polygons)
    parts=[result] if result.geom_type=='Polygon' else list(result.geoms)
    return {'regions':[{'points':[{'x':x,'y':y} for x,y in list(part.exterior.coords)[:-1]],'loops':[[{'x':x,'y':y} for x,y in list(ring.coords)[:-1]] for ring in part.interiors]} for part in parts], 'area':result.area}
