"""Geometry context for Lisp tools (room boundaries, regions, hatch gap closing)."""
import io
import ezdxf
from ezdxf.path import make_path
from shapely.geometry import LineString
from shapely.ops import polygonize, unary_union

def close_gaps(segments,gap):
    """HATCH 간격 허용(AutoCAD HPGAPTOL): 다른 선에 닿지 않은 끝점을 gap 안의 가장 가까운 선(자기 반대쪽 끝 포함)에 잇는 짧은 선을 더한다."""
    if not gap or gap<=0 or not segments:return segments
    from shapely.geometry import Point
    from shapely.strtree import STRtree
    from shapely.ops import nearest_points
    tree=STRtree(segments);bridges=[];touch=max(gap*1e-6,1e-6)
    for i,s in enumerate(segments):
        c=list(s.coords)
        if len(c)<2 or Point(c[0]).distance(Point(c[-1]))<=touch:continue
        for end,other in ((Point(c[0]),Point(c[-1])),(Point(c[-1]),Point(c[0]))):
            near=[int(j) for j in tree.query(end.buffer(gap)) if int(j)!=i]
            if any(segments[j].distance(end)<=touch for j in near):continue   # 이미 이어진 끝
            best=None
            if s.length>gap and end.distance(other)<=gap:best=(end.distance(other),other)   # 거의 닫힌 폴리선
            for j in near:
                d=segments[j].distance(end)
                if d<=gap and (best is None or d<best[0]):best=(d,nearest_points(end,segments[j])[1])
            if best:bridges.append(LineString([(end.x,end.y),(best[1].x,best[1].y)]))
    return segments+bridges

def close_openings(segments,symbols):
    """문·창 기호가 있는 틈만 같은 직선 위의 벽 끝 사이로 연장한다(문 호 자체는 경계가 아니다)."""
    from shapely.geometry import MultiPoint
    from shapely.strtree import STRtree
    if not segments or not symbols:return segments
    tree=STRtree(segments);bridges=[]
    for points in symbols:
        near=[int(i) for i in tree.query(MultiPoint(points).envelope.buffer(300))]
        for at,i in enumerate(near):
            a,b=segments[i].coords;length=segments[i].length
            if length<1e-6:continue
            ux,uy=(b[0]-a[0])/length,(b[1]-a[1])/length
            along=lambda p:(p[0]-a[0])*ux+(p[1]-a[1])*uy
            across=lambda p:abs((p[0]-a[0])*uy-(p[1]-a[1])*ux)
            lo,hi=min(map(along,points)),max(map(along,points));tol=max(100,(hi-lo)*.2)
            if hi-lo<20 or min(map(across,points))>300:continue
            for j in near[at+1:]:
                c,d=segments[j].coords
                if max(across(c),across(d))>1e-4:continue
                c,d=sorted((c,d),key=along)
                if along(c)>length+1e-4:p,q=b,c
                elif along(d)<-1e-4:p,q=d,a
                else:continue
                if abs(along(p)-lo)<=tol and abs(along(q)-hi)<=tol:bridges.append(LineString([p,q]))
    return segments+bridges

def dxf_text(raw):
    """내보낸 DXF 바이트 → 문자열. R2007 이상은 UTF-8 이지만, 원본 판을 지키는 R2004 이하 도면(한국 사무소 CP949 DXF)은
    $DWGCODEPAGE 코드페이지로 쓰여 있다. UTF-8 로만 읽으면 한글 한 글자만 있어도 해치·방 찾기가 실패했다 (A38, 10-20)."""
    try:return raw.decode('utf-8').replace('\r','')
    except UnicodeDecodeError:pass
    from ezdxf.lldxf.validator import dxf_info
    encoding=dxf_info(io.StringIO(raw.decode('cp1252',errors='ignore').replace('\r',''))).encoding
    return raw.decode(encoding,errors='replace').replace('\r','')

def boundary_polygons(raw,gap=0,*,room=False):
    drawing=ezdxf.read(io.StringIO(dxf_text(raw)))
    segments=[];symbols=[]
    def collect(entity,depth=0,inherited=None):
        if depth>8:return
        name=inherited if room and entity.dxf.layer=='0' and inherited else entity.dxf.layer
        layer=drawing.layers.get(name)
        if layer.is_off() or layer.is_frozen():return
        kind=entity.dxftype()
        if kind=='INSERT':
            for child in entity.virtual_entities():collect(child,depth+1,name)
        elif kind in ('LINE','LWPOLYLINE','POLYLINE','ARC','CIRCLE','ELLIPSE','SPLINE'):
            pts=[(v.x,v.y) for v in make_path(entity).flattening(.5)]
            if len(pts)<2:return
            if not room:segments.append(LineString(pts));return
            if name.startswith('A-DOOR') and kind=='ARC':
                symbols.append([(p.x,p.y) for p in (entity.dxf.center,entity.start_point,entity.end_point)])
            elif name.startswith('A-GLAZ'):symbols.append(pts)
            if name=='A-WALL-C' or (name.startswith('A-') and not name.startswith(('A-WALL','A-COL'))):return
            edges=[LineString([a,b]) for a,b in zip(pts,pts[1:]) if a!=b]
            segments.extend(edges)
    for entity in drawing.modelspace():collect(entity)
    if room:segments=close_openings(segments,symbols)
    segments=close_gaps(segments,gap)
    return list(polygonize(unary_union(segments))) if segments else []

def room_context(raw):
    return rooms_expression(boundary_polygons(raw,room=True))

def rooms_expression(polygons):
    def ring(points):return '('+' '.join(f'({x:.9f} {y:.9f} 0.0)' for x,y in list(points)[:-1])+')'
    return "(setq br:rooms '("+' '.join('('+ring(p.exterior.coords)+f' {p.area:.9f} ('+' '.join(ring(h.coords) for h in p.interiors)+'))' for p in polygons if p.area>0)+'))'

def region_list(polygons):
    """자체 엔진의 (command "BOUNDARY" 내부점) 이 실행 전에 미리 받아 두는 닫힌 영역 목록."""
    ring=lambda r:[[round(x,6),round(y,6)] for x,y in list(r.coords)[:-1]]
    return [{'ring':ring(p.exterior),'holes':[ring(h) for h in p.interiors],'area':p.area} for p in polygons if p.area>0]
