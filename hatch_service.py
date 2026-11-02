"""Find the smallest closed visible face containing a picked drawing point."""
import math
from shapely.geometry import Point
import exchange
from lisp_architecture import boundary_polygons

MAX_GAP=5000  # AutoCAD HPGAPTOL 과 같은 범위(0~5000 도면 단위)

def gap_tolerance(value):
    try:gap=float(value or 0)
    except (TypeError,ValueError):raise ValueError('간격 허용 값은 숫자로 입력하세요.')
    if not math.isfinite(gap) or gap<0 or gap>MAX_GAP:raise ValueError('간격 허용 값은 0 이상 5000 이하입니다.')
    return gap

MAX_PATH_POINTS=400000

def paths_polygons(paths,gap=0):
    """[[x,y],...] 꺾은선 목록 → 닫힌 면. 숫자·크기를 확인한 뒤 서버의 DXF 경로와 같은 polygonize 를 쓴다."""
    from shapely.geometry import LineString
    from shapely.ops import polygonize, unary_union
    from lisp_architecture import close_gaps
    if not isinstance(paths,list):raise ValueError('경계 후보 형식이 잘못되었습니다.')
    segments=[];count=0
    for path in paths:
        if not isinstance(path,list) or len(path)<2:continue
        count+=len(path)
        if count>MAX_PATH_POINTS:raise ValueError('경계 후보가 너무 많습니다. 화면을 확대하고 다시 클릭하세요.')
        pts=[]
        for p in path:
            if not isinstance(p,(list,tuple)) or len(p)!=2:raise ValueError('경계 후보 좌표가 잘못되었습니다.')
            x,y=float(p[0]),float(p[1])
            if not (math.isfinite(x) and math.isfinite(y)):raise ValueError('경계 후보 좌표가 잘못되었습니다.')
            pts.append((x,y))
        if len(set(pts))>1:segments.append(LineString(pts))
    segments=close_gaps(segments,gap)
    return list(polygonize(unary_union(segments))) if segments else []

def boundary(data):
    p=data['point'];x=float(p['x']);y=float(p['y'])
    if not all(math.isfinite(v) for v in (x,y)):raise ValueError('좌표를 확인하세요.')
    gap=gap_tolerance(data.get('gapTolerance',0))
    # ACAD200-412: 화면이 이미 편 꺾은선(paths)을 받으면 도면 전체 DXF 쓰기·읽기를 건너뛴다(경계 집합 = 화면).
    polygons=paths_polygons(data['paths'],gap) if 'paths' in data else boundary_polygons(exchange.export_dxf(data['document'])[0],gap)
    candidates=[g for g in polygons if g.contains(Point(x,y))]
    if not candidates:raise ValueError('닫힌 영역을 찾지 못했습니다. 선이 끊긴 곳이 없는지 확인하고 영역 안쪽을 클릭하세요.'+('' if gap else ' 조금 끊긴 경계는 간격 허용(G) 값을 주면 이어서 찾습니다.'))
    poly=min(candidates,key=lambda g:g.area)
    ring=lambda r:[{'x':x,'y':y} for x,y in list(r.coords)[:-1]]
    return {'points':ring(poly.exterior),'loops':[ring(r) for r in poly.interiors]}
