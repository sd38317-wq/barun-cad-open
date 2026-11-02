"""남의 배치도로 설계 모델을 실제 대지(지적)에 앉히기 — 읽기만, 도면은 안 바꾼다(2026-10-30 괴정동 213-17·18).
원본 배치도의 대지선을 지적 대지선에 겹치고(돌림+옮김, 뒤집기 없음), 그 위 건물 윤곽에 설계 1층 바깥 벽 고리를 겹쳐
지적 대지를 설계 좌표(model.site.parcel)로 돌려준다. 겹침 정도는 IoU(겹친 넓이 ÷ 합친 넓이)."""
import math
import re
import ezdxf
from shapely.geometry import LineString, Polygon
from shapely.ops import polygonize, unary_union

# drawing-recognition-read.js readSitePlan 과 같은 레이어 실마리
SITE_LAYER = re.compile(r'SITE|대지|경계|BND|BOUND|부지', re.I)
BUILDING_LAYER = re.compile(r'WALL|벽|BLDG|건물|BUILD|외곽|OUTLINE', re.I)
NORTH_BLOCK = re.compile(r'north|방위|^n$|북', re.I)
GOOD_IOU = 0.85
NEXT = ('결과 modelSite 를 설계 JSON model.site 에 그대로 넣고(parcel·northAngle·ledgerAreaM2·jibun·zone·roads·neighbors — 좌표는 설계 mm) 같은 setId 로 cad_generate_drawing kind=set. '
        '주차칸(parking)·조경(landscape)·출입구(entrance)는 설계에서 정해 model.site 에 더하세요. 한 벌을 그린 뒤 정북 일조·건폐율 등 배치 법규는 '
        'cad_validate_layout({}) 로 AI 설계 엔진에 검사하세요 — 그린 설계를 지적 대지에 자동으로 앉힙니다(사용자에게 경계를 고르게 하지 마세요).')
ROAD_SLIVER_M2 = 30   # parcel-road.js 와 같은 값 — 지적도 자투리 도로 조각은 뺀다


def road_width_mm(g):
    """도로 필지를 넓이·둘레가 같은 직사각형으로 보고 짧은 변 = 폭(parcel-road.js estimatedRoadWidthM 과 같은 식)."""
    q = g.length / 4
    return q - math.sqrt(q * q - g.area) if q * q > g.area else q


def _polygon(points):
    pts = [(float(x), float(y)) for x, y in points]
    if len(pts) > 2 and math.dist(pts[0], pts[-1]) < 1: pts.pop()
    if len(pts) < 3: return None
    g = Polygon(pts)
    if not g.is_valid: g = g.buffer(0)
    if g.geom_type == 'MultiPolygon': g = max(g.geoms, key=lambda p: p.area)
    return g if g.geom_type == 'Polygon' and g.area > 0 else None


def read_plan(path):
    """배치도 DXF 의 닫힌 폴리선(레이어·넓이)과 방위 블록.
    shortcut: 맨 위 닫힌 폴리선만 본다(블록 안 대지선·선 조각으로 된 윤곽은 못 읽음 → IoU 낮음으로 알림). 그런 도면이 나오면 블록 펼치기·선 잇기를 더한다."""
    msp = ezdxf.readfile(path).modelspace()
    shapes = []
    for e in msp.query('LWPOLYLINE POLYLINE'):
        pts = [p[:2] for p in e.get_points('xy')] if e.dxftype() == 'LWPOLYLINE' else [tuple(v)[:2] for v in e.points()]
        if not (e.closed or (len(pts) > 2 and math.dist(pts[0], pts[-1]) < 1)): continue
        g = _polygon(pts)
        if g is not None: shapes.append({'layer': e.dxf.layer, 'poly': g})
    norths = [(e.dxf.insert.x, e.dxf.insert.y, e.dxf.rotation) for e in msp.query('INSERT') if NORTH_BLOCK.search(e.dxf.name)]
    return shapes, norths


class Rigid:
    """p → R(deg)·p + (ox, oy)."""
    def __init__(self, deg, ox, oy): self.deg, self.ox, self.oy = deg, ox, oy

    def __call__(self, p):
        c, s = math.cos(math.radians(self.deg)), math.sin(math.radians(self.deg))
        return (c * p[0] - s * p[1] + self.ox, s * p[0] + c * p[1] + self.oy)

    def inverse(self):
        c, s = math.cos(math.radians(-self.deg)), math.sin(math.radians(-self.deg))
        return Rigid(-self.deg, -(c * self.ox - s * self.oy), -(s * self.ox + c * self.oy))

    def poly(self, g): return Polygon([self(p) for p in g.exterior.coords])

    def vector(self, v):
        c, s = math.cos(math.radians(self.deg)), math.sin(math.radians(self.deg))
        return (c * v[0] - s * v[1], s * v[0] + c * v[1])


def _iou(a, b):
    u = a.union(b).area
    return a.intersection(b).area / u if u else 0.0


def _wrap(deg): return (deg + 180) % 360 - 180


def fit(moving, fixed, prefer=0.0):
    """moving 을 돌리고 옮겨 fixed 와 가장 많이 겹치게. 돌림 후보는 긴 변 방향 짝마다(+180°), 무게중심을 맞춘 뒤 조금씩 다듬는다.
    겹침이 거의 같은 후보(0.02 안)가 여럿이면 prefer(도)에 가까운 쪽 — 직사각형처럼 돌려도 같은 모양의 앞뒤를 가르려고.
    반환 (Rigid, iou, 비슷한 다른 방향 수)."""
    cm, cf = moving.centroid, fixed.centroid

    def place(deg, dx, dy):
        c, s = math.cos(math.radians(deg)), math.sin(math.radians(deg))
        return Rigid(deg, cf.x + dx - (c * cm.x - s * cm.y), cf.y + dy - (s * cm.x + c * cm.y))

    def dirs(g):
        pts = list(g.exterior.coords)
        return [math.degrees(math.atan2(b[1] - a[1], b[0] - a[0])) for a, b in zip(pts, pts[1:]) if math.dist(a, b) >= g.length * 0.03]
    tried = {}
    for a in dirs(moving):
        for b in dirs(fixed):
            for flip in (0, 180):
                deg = round(_wrap(b - a + flip), 6)
                if deg not in tried: tried[deg] = _iou(place(deg, 0, 0).poly(moving), fixed)
    size = math.sqrt(fixed.area)
    results = []
    for deg in sorted(tried, key=tried.get, reverse=True)[:6]:
        best, step = (tried[deg], deg, 0.0, 0.0), [1.0, size * 0.02, size * 0.02]
        while step[0] > 1e-4 or step[1] > 0.1:
            moved = False
            for k in range(3):
                for sign in (1, -1):
                    trial = list(best[1:]); trial[k] += sign * step[k]
                    value = _iou(place(*trial).poly(moving), fixed)
                    if value > best[0] + 1e-9: best, moved = (value, *trial), True
            if not moved: step = [v / 2 for v in step]
        results.append(best)
    top = max(r[0] for r in results)
    near = [r for r in results if r[0] >= top - 0.02]
    pick = min(near, key=lambda r: abs(_wrap(r[1] - prefer)))
    others = {round(_wrap(r[1]) / 5) for r in near if abs(_wrap(r[1] - pick[1])) > 5}
    return place(*pick[1:]), pick[0], len(others)


def outer_loop(model):
    """가장 낮은 층의 바깥 벽(exterior, 없으면 그 층 모든 벽) 중심선이 둘러싼 바닥 — 생성기 outerLoop 와 같은 뜻을 shapely 로."""
    walls = [e for e in model.get('elements') or [] if e.get('kind') == 'wall' and len(e.get('path') or []) >= 2]
    stories = sorted(model.get('stories') or [], key=lambda s: s.get('elevation') or 0)
    for story in stories:
        mine = [w for w in walls if w.get('story') == story.get('id')]
        lines = [LineString([tuple(p[:2]) for p in w['path']]) for w in ([w for w in mine if w.get('exterior')] or mine)]
        faces = list(polygonize(unary_union(lines))) if lines else []
        if faces:
            g = unary_union(faces)
            g = max(g.geoms, key=lambda p: p.area) if g.geom_type == 'MultiPolygon' else g
            return Polygon(g.exterior.coords), story.get('id')
    return None, None


def _north_text(v):
    deg = round(math.degrees(math.atan2(v[0], v[1])))
    return deg, '위쪽이 북' if deg == 0 else f"위쪽에서 {abs(deg)}° {'시계' if deg > 0 else '반시계'} 방향"


def place(plan_path, model, site, north_vector=None, context=None):
    """plan_path: 원본 배치도 DXF(mm). site: 지적 대지 [[x,y],…] 도면 mm. north_vector: 지적의 북쪽 단위 벡터(도면 좌표).
    context: 도면의 지적 둘레 {'parcels': [{'role': 'road'|'neighbor', 'coords', 'jibun'}], 'jibun', 'ledgerAreaM2', 'zone'} — 대지에 닿은 도로·이웃을 설계 좌표로 돌려준다."""
    target = _polygon(site)
    if target is None: raise ValueError('지적 대지 경계가 닫힌 다각형이 아닙니다.')
    loop, story = outer_loop(model)
    if loop is None: raise ValueError('설계 모델에서 1층 바깥 벽 고리를 찾지 못했습니다(벽 path 가 닫힌 고리가 되는지 보세요).')
    shapes, norths = read_plan(plan_path)
    assumed, needs = [], []
    big = [s for s in shapes if s['poly'].area >= 2e7]
    if not big: raise ValueError('원본 배치도에서 대지 경계(20㎡ 넘는 닫힌 선)를 찾지 못했습니다.')
    # 대지선: 대지 레이어 중 지적 면적에 가장 가까운 것(없으면 모든 닫힌 선 중) — 도곽·주차칸을 고르지 않게
    lot = min([s for s in big if SITE_LAYER.search(s['layer'])] or big, key=lambda s: abs(s['poly'].area - target.area))
    lot_poly, scale = lot['poly'], 1.0
    ratio = lot_poly.area / target.area
    if abs(ratio - 1) > 0.05:
        scale = 1 / math.sqrt(ratio)
        assumed.append(f'원본 배치도 대지 넓이({lot_poly.area / 1e6:.2f}㎡)가 지적({target.area / 1e6:.2f}㎡)과 {abs(ratio - 1) * 100:.0f}% 달라 원본 축척이 틀렸다고 보고 {scale:.4f}배로 맞췄어요.')
    zoom = lambda g: Polygon([(x * scale, y * scale) for x, y in g.exterior.coords])
    to_site, lot_iou, lot_alt = fit(zoom(lot_poly), target)
    # 건물 윤곽: 대지 안 닫힌 선 중 설계 1층 고리와 가장 잘 겹치는 것(건물 레이어가 있으면 그것만)
    inner = [s for s in shapes if s is not lot and 1e7 <= s['poly'].area < lot_poly.area * 0.95 and lot_poly.buffer(lot_poly.length * 0.01).contains(s['poly'])]
    inner = [s for s in inner if BUILDING_LAYER.search(s['layer'])] or inner
    if not inner: raise ValueError('원본 배치도 대지 안에서 건물 윤곽(10㎡ 넘는 닫힌 선)을 찾지 못했습니다.')
    best = None
    for s in sorted(inner, key=lambda s: -s['poly'].area)[:8]:
        mapped = to_site.poly(zoom(s['poly']))
        tried = (s, mapped, *fit(loop, mapped, prefer=to_site.deg))
        if best is None or tried[3] > best[3]: best = tried
    building, mapped, to_model_site, bld_iou, bld_alt = best
    back = to_model_site.inverse()
    placed = to_model_site.poly(loop)
    ring = list(target.exterior.coords)[:-1]
    edges = [{'edge': i + 1, 'lengthM': round(math.dist(a, b) / 1000, 2), 'setbackM': round(LineString([a, b]).distance(placed) / 1000, 2)}
             for i, (a, b) in enumerate(zip(ring, ring[1:] + ring[:1]))]
    north = None
    if north_vector:
        v = back.vector(north_vector); deg, text = _north_text(v)
        north = {'vector': [round(v[0], 6), round(v[1], 6)], 'degrees': deg, 'text': text, 'evidence': '지적(연속지적도) 북쪽'}
    else:
        arrow = next((n for n in norths if lot_poly.buffer(math.sqrt(lot_poly.area)).contains(Polygon([(n[0] - 1, n[1] - 1), (n[0] + 1, n[1] - 1), (n[0], n[1] + 1)]))), None)
        if arrow:
            r = math.radians(arrow[2]); v = back.vector(to_site.vector((-math.sin(r), math.cos(r)))); deg, text = _north_text(v)
            north = {'vector': [round(v[0], 6), round(v[1], 6)], 'degrees': deg, 'text': text, 'evidence': '원본 배치도 방위 블록(위가 북으로 그렸다고 봄)'}
        else: assumed.append('북쪽 방향은 지적에도 원본 배치도에도 없어 비워 두었어요.')
    if lot_alt: assumed.append('원본 대지 모양이 돌려도 비슷해, 원본을 덜 돌리는 쪽으로 겹쳤어요. 배치가 거꾸로면 말해 주세요.')
    if bld_alt: assumed.append('건물 모양이 돌려도 비슷해, 원본 배치도와 같은 방향으로 평면을 그렸다고 보고 앉혔어요. 앞뒤가 바뀌었으면 말해 주세요.')
    if lot_iou < GOOD_IOU:
        needs.append({'key': 'site', 'question': f'원본 배치도의 대지선이 지적 대지와 {lot_iou * 100:.0f}%만 겹칩니다. 원본 대지 모양이 다르거나 다른 필지일 수 있어요. 이대로 앉힐까요, 대지 기준 모서리를 알려 주실래요?'})
    if bld_iou < GOOD_IOU:
        needs.append({'key': 'building', 'question': f'설계 1층 바깥 벽이 원본 배치도 건물 윤곽과 {bld_iou * 100:.0f}%만 겹칩니다. 평면 모양이 원본과 다를 수 있어요. 이대로 앉힐까요, 대지 경계에서 건물까지 거리를 알려 주실래요?'})
    # 대지에 닿은(1 m 안) 도로·이웃 필지를 설계 좌표로 — 배치도에 도로 폭·이름, 이웃 지번을 그리려고(2026-10-30 괴정 배치도에 없던 것)
    context = context or {}
    near, roads, neighbors = target.buffer(1000), [], []
    for p in context.get('parcels') or []:
        g = _polygon(p.get('coords') or [])
        if g is None or not g.intersects(near): continue
        coords = [[round(x), round(y)] for x, y in (back(q) for q in list(g.exterior.coords)[:-1])]
        if p.get('role') == 'road':
            if g.area / 1e6 >= ROAD_SLIVER_M2: roads.append({'coords': coords, 'width': round(road_width_mm(g)), 'name': str(p.get('jibun') or '도로'), 'evidence': '지적 도로 필지(폭은 넓이·둘레로 추정)'})
        elif p.get('role') == 'neighbor': neighbors.append({'coords': coords, 'jibun': str(p.get('jibun') or '')})
    model_site = {'parcel': [[round(x), round(y)] for x, y in (back(p) for p in ring)], 'roads': roads, 'neighbors': neighbors}
    if north: model_site['northAngle'] = -north['degrees']   # 생성기 방위표 각(반시계 +)
    for key in ('jibun', 'ledgerAreaM2', 'zone'):
        if context.get(key): model_site[key] = context[key]
    if not context.get('ledgerAreaM2'): assumed.append(f"건축물대장 대지면적을 몰라 대지면적은 지적 넓이({target.area / 1e6:.2f}㎡)로 그려집니다. 대장 면적을 알면 model.site.ledgerAreaM2 에 넣으세요.")
    return {
        'parcel': model_site['parcel'], 'modelSite': model_site,
        'rotationDeg': round(to_model_site.deg, 3),
        'north': north,
        'fit': {'lot': {'iou': round(lot_iou, 4), 'layer': lot['layer'], 'areaM2': {'drawing': round(lot_poly.area * scale * scale / 1e6, 2), 'cadastre': round(target.area / 1e6, 2)}, 'scale': round(scale, 6)},
                'building': {'iou': round(bld_iou, 4), 'layer': building['layer'], 'areaM2': {'drawing': round(mapped.area / 1e6, 2), 'model': round(loop.area / 1e6, 2)}, 'story': story}},
        'footprint': [[round(x), round(y)] for x, y in list(placed.exterior.coords)[:-1]],   # 지적(도면) 좌표 위 1층 외곽 — 정북 사선 검사용
        'setbacks': edges, 'minSetbackM': min(e['setbackM'] for e in edges),
        'setbackBasis': '설계 1층 바깥 벽 중심선 ↔ 지적 대지 각 변',
        'assumed': assumed, 'needs': needs, 'next': NEXT,
    }
