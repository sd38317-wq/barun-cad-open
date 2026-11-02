"""Address/parcel integration. Upstream secrets never enter CAD documents or logs."""
import ctypes
import json
import math
import os
import re
import threading
import urllib.error
import urllib.parse
import urllib.request
from http.cookies import SimpleCookie
from pathlib import Path
import korea_crs

BASE = 'https://barunarc.co.kr'
SESSION = Path(os.environ.get('LOCALAPPDATA', str(Path.home()))) / 'BarunCAD' / 'parcel-session.dpapi'
_cookie = ''
_lock = threading.RLock()

def protect(data, decrypt=False):
    if os.name != 'nt':
        raise ValueError('로그인 저장은 Windows에서만 지원합니다.')
    class Blob(ctypes.Structure):
        _fields_ = [('size', ctypes.c_ulong), ('data', ctypes.POINTER(ctypes.c_ubyte))]
    buffer = ctypes.create_string_buffer(data)
    source = Blob(len(data), ctypes.cast(buffer, ctypes.POINTER(ctypes.c_ubyte)))
    target = Blob()
    fn = ctypes.windll.crypt32.CryptUnprotectData if decrypt else ctypes.windll.crypt32.CryptProtectData
    if not fn(ctypes.byref(source), None, None, None, None, 1, ctypes.byref(target)):
        raise ValueError('Windows 로그인 보관함을 열지 못했습니다.')
    try:
        return ctypes.string_at(target.data, target.size)
    finally:
        ctypes.windll.kernel32.LocalFree(target.data)

def cookie():
    global _cookie
    with _lock:
        if not _cookie and SESSION.exists():
            try: _cookie = protect(SESSION.read_bytes(), True).decode()
            except Exception: pass
        return _cookie

def account_token():
    """오른쪽 위 [계정 연결] 토큰 — 카카오(또는 구글) 로그인 한 번으로 서버 업무 기능을 같은 회원으로 쓴다. 없으면 ''."""
    try:
        from miri_account_service import _load_token
        return _load_token() or ''
    except Exception:
        return ''

def auth_headers():
    """서버 업무 기능 로그인 머리글: 계정 연결 토큰(Authorization: Bearer) + 예전 이메일 로그인 쿠키(있으면)."""
    headers, token, session = {}, account_token(), cookie()
    if token: headers['Authorization'] = 'Bearer ' + token
    if session: headers['Cookie'] = session
    return headers

def signed_in():
    """로그인이 이 PC 에 있는지: [계정 연결] 토큰 또는 예전 이메일 세션. 둘 다 Windows DPAPI 로 이 사용자만 풀 수 있다."""
    return bool(account_token() or cookie())

def require_login(feature):
    """로그인이 있어야 열리는 기능의 문지기. 기본 CAD 기능에는 걸지 않는다. 서버 기능은 서버가 토큰을 다시 확인한다."""
    if not signed_in():
        raise ValueError(feature + ' 기능은 ' + LOGIN_GUIDE)

def require_verified_login(feature):
    """이 PC 에 있는 자료(설계 사례·동봉 리습)를 여는 문지기. 토큰 파일이 있는지만 보지 않고 서버가 확인한 로그인인지 본다
    (만료·해지된 토큰으로 열리지 않게). 예전 이메일 로그인 세션은 그대로 통과."""
    if account_token():
        from miri_account_service import require_ai_login, AILoginRequired
        try:
            return require_ai_login()
        except AILoginRequired:
            pass
    if cookie():
        return
    raise ValueError(feature + ' 기능은 ' + LOGIN_GUIDE)

# 계획 탭(대지·지적도)이 쓰는 좌표계. 5179 는 예전 [대지 가져오기] 기본값, 5187 은 설계엔진(SPEC v0.5.3) 좌표계다.
DRAWING_CRS = ('EPSG:5179', 'EPSG:5187')
REVIEW_NOTE = '검토용 — 연속지적도 기반, 지적측량 성과 아님'
LOGIN_GUIDE = '오른쪽 위 [계정 연결]에서 카카오(또는 구글)로 로그인하세요. 로그인 한 번이면 대지 조회·토지정보·설계엔진이 모두 됩니다.'

def remote_error(error, feature='바른 서버'):
    """원격 HTTP 오류를 사용자가 읽을 한국어로. 422·400 은 서버가 준 원문을 그대로 보인다(주택 세대수 등)."""
    code = getattr(error, 'code', 0)
    detail = ''
    try:
        body = json.loads(error.read(20000).decode('utf-8', 'replace') or '{}')
        detail = body.get('error') or body.get('detail') or body.get('message') or ''
        if isinstance(detail, list): detail = ' / '.join(str(d.get('msg', d)) if isinstance(d, dict) else str(d) for d in detail)
        if body.get('code') == 'SITE_ENGINE_INPUT_REQUIRED':
            return '설계엔진은 좌표계(EPSG:5187)와 인접 필지 지목이 있는 지적 자료가 필요합니다. 계획 탭에서 주소로 대지를 불러와 [계획안 만들기]를 쓰세요. (SITE_ENGINE_INPUT_REQUIRED)'
    except Exception:
        pass
    detail = str(detail).strip()[:500]
    if code in (401, 403): return f'{feature}: 로그인이 끊겼거나 권한이 없습니다 ({code}). ' + LOGIN_GUIDE
    if code == 429: return f'{feature}: 오늘 이용 한도를 넘었습니다. 내일 다시 시도하세요.' + (f' ({detail})' if detail else '')
    if code in (400, 422): return f'{feature}: 입력을 받아들이지 않았습니다 ({code}) — ' + (detail or '입력 조건을 확인하세요.')
    if code == 504: return f'{feature}: 응답 시간이 초과됐습니다(504). 잠시 후 다시 시도하세요.'
    return f'{feature} 응답 오류 ({code})' + (f' — {detail}' if detail else '')

def request(url, data=None, authenticated=False, extra_headers=None):
    headers = {'Content-Type': 'application/json', 'User-Agent': 'BarunCAD/3'}
    if authenticated: headers.update(auth_headers())
    headers.update(extra_headers or {})
    req = urllib.request.Request(url, data=json.dumps(data).encode() if data is not None else None, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=25) as response:
            raw = response.read(12_000_001)
            if len(raw) > 12_000_000: raise ValueError('지도 응답이 너무 큽니다.')
            return json.loads(raw), response.headers
    except urllib.error.HTTPError as error:
        if error.code == 401: raise ValueError('토지 연결 로그인이 필요합니다. ' + LOGIN_GUIDE) from None
        if error.code == 429: raise ValueError('주소 조회 한도를 초과했습니다. 잠시 후 다시 시도하세요.') from None
        if error.code in (400, 403, 422, 504): raise ValueError(remote_error(error, '바른 서버')) from None
        raise ValueError(f'지도 제공 서비스 응답 오류 ({error.code})') from None
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError):
        raise ValueError('지도 제공 서비스에 연결하지 못했습니다. 잠시 후 다시 시도하세요.') from None

def login(data):
    global _cookie
    password = str(data.get('password', ''))
    if not password: raise ValueError('비밀번호를 입력하세요.')
    _, headers = request(BASE + '/api/login', {'email': str(data.get('email', '')), 'password': password})
    jar = SimpleCookie()
    for value in headers.get_all('Set-Cookie', []): jar.load(value)
    if not jar: raise ValueError('로그인 세션을 받지 못했습니다.')
    with _lock:
        _cookie = '; '.join(f'{name}={value.value}' for name, value in jar.items())
        if data.get('remember', True):
            SESSION.parent.mkdir(parents=True, exist_ok=True)
            SESSION.write_bytes(protect(_cookie.encode()))
    # Verify access, without returning the key.
    request(BASE + '/api/vworld', authenticated=True)
    return {'connected': True}

def search(query):
    query = str(query).strip()
    if len(query) < 2 or len(query) > 200: raise ValueError('주소는 2~200자로 입력하세요.')
    if not signed_in(): raise ValueError('로그인한 회원만 대지 조회를 사용할 수 있습니다. ' + LOGIN_GUIDE)
    request(BASE + '/api/vworld', authenticated=True)
    # 홍보 공개 기간 서버는 주소 검색도 [계정 연결] 토큰이 있어야 연다(앱 업무 기능)
    result, _ = request(BASE + '/api/public/address-search?' + urllib.parse.urlencode({'q': query}), authenticated=True)
    return {'results': [{k: row.get(k, '') for k in ('roadAddress', 'jibunAddress', 'buildingName', 'pnu')} for row in result.get('results', [])]}

def features(config, filters, size):
    params = {'service': 'data', 'request': 'GetFeature', 'data': 'LP_PA_CBND_BUBUN', 'key': config['key'], 'domain': config['domain'], 'format': 'json', 'geometry': 'true', 'size': size, 'crs': 'EPSG:4326', **filters}
    result, _ = request('https://api.vworld.kr/req/data?' + urllib.parse.urlencode(params), extra_headers={'Referer': 'https://' + str(config['domain']).removeprefix('https://').strip('/') + '/'})
    response = result.get('response', {})
    if response.get('status') == 'NOT_FOUND': return []
    if response.get('status') != 'OK': raise ValueError('VWorld 지적도 조회가 거절됐습니다. 연결 계정의 키·등록 도메인을 확인하세요.')
    return response.get('result', {}).get('featureCollection', {}).get('features', [])

def rings(feature):
    geometry = feature.get('geometry') or {}
    coords = geometry.get('coordinates') or []
    if geometry.get('type') == 'Polygon': return [coords]
    if geometry.get('type') == 'MultiPolygon': return coords
    raise ValueError('지도 제공자가 필지 면 경계를 반환하지 않았습니다.')

def drawing(targets, surroundings, pnu, x=0, y=0, crs='EPSG:5179', origin=None, labels=False):
    if crs not in DRAWING_CRS: raise ValueError('지원하지 않는 도면 좌표계입니다.')
    transform = korea_crs.transformer('EPSG:4326', crs)
    first = rings(targets[0])[0][0][0]
    ox, oy = transform.transform(*first[:2])
    if origin is not None:
        # 도면에 이미 지리 정합(drawingGeo)이 있으면 그 원점을 그대로 써서 새 지적이 같은 자리에 맞게 한다.
        if not (isinstance(origin, (list, tuple)) and len(origin) == 2 and all(isinstance(v, (int, float)) and math.isfinite(v) for v in origin)): raise ValueError('도면 원점(drawingGeo)을 확인하세요.')
        ox, oy, x, y = float(origin[0]), float(origin[1]), 0.0, 0.0
    north_x,north_y=transform.transform(first[0],first[1]+.00001)
    north_length=math.hypot(north_x-ox,north_y-oy)
    north_vector=[(north_x-ox)/north_length,(north_y-oy)/north_length]
    if not all(math.isfinite(v) for v in (ox, oy, x, y)): raise ValueError('대지 좌표가 올바르지 않습니다.')
    entities = []
    for feature in [*targets, *surroundings]:
        props = feature.get('properties') or {}
        target = feature in targets
        road = str(props.get('jimok', '')).strip() in ('도', '도로') or str(props.get('jibun', '')).strip().endswith(('도', '도로'))
        role = 'site' if target else 'road' if road else 'neighbor'
        for polygon_index, polygon in enumerate(rings(feature)):
            for ring_index, ring in enumerate(polygon):
                points = []
                for lon, lat, *_ in ring:
                    if not (120 <= lon <= 140 and 30 <= lat <= 45): raise ValueError('대한민국 위경도 범위가 아닙니다.')
                    px, py = transform.transform(lon, lat)
                    points.append({'x': (px - ox) * 1000 + x, 'y': (py - oy) * 1000 + y})
                if len(points)>1 and points[0] == points[-1]: points.pop()
                if len(points)<3: raise ValueError('필지 경계 점이 부족합니다.')
                entities.append({'type': 'polyline', 'points': points, 'closed': True, 'parcelRole': role, 'attributes': {'source': 'VWorld continuous cadastral', 'pnu': str(props.get('pnu', pnu if target else '')), 'jibun': str(props.get('jibun', '')), 'jimok': str(props.get('jimok', '')), 'ring': 'hole' if ring_index else 'outer', 'polygon': polygon_index, 'sourceCRS': crs, 'originMetres': [ox, oy], 'insertionMm': [x, y]}})
    for entity in entities:entity['attributes']['northVector']=north_vector
    # 도면(mm) = (투영좌표(m) − originM) × 1000 . 삽입점(x,y)은 원점에 녹여 한 식으로 되돌릴 수 있게 한다.
    geo = {'crs': crs, 'originM': [ox - x / 1000, oy - y / 1000], 'unit': 'mm', 'rotationDeg': 0}
    return {'pnu': pnu, 'entities': entities, 'originMetres': [ox, oy], 'crs': crs, 'units': 'mm', 'drawingGeo': geo, 'labels': bool(labels), 'warnings': ['연속지적도 참고 경계이며 현황측량 경계와 다를 수 있습니다.'], 'counts': {role: sum(e['parcelRole']==role for e in entities) for role in ('site','road','neighbor')}}

def label_entities(entities, height=1000):
    """지번 문자(CAD 에서는 A-SITE-TEXT 레이어)와 검토용 문구. 필지 안쪽 점(shapely representative_point)에 둔다."""
    from shapely.geometry import Polygon
    labels, seen = [], set()
    for e in entities:
        a = e.get('attributes') or {}
        if e.get('parcelRole') not in ('site', 'road', 'neighbor') or a.get('ring') == 'hole': continue
        text = str(a.get('jibun', '')).strip()
        key = (a.get('pnu'), a.get('polygon'), a.get('contextPart'))
        if not text or key in seen or len(e['points']) < 3: continue
        seen.add(key)
        shape = Polygon([(p['x'], p['y']) for p in e['points']])
        if not shape.is_valid: shape = shape.buffer(0)
        if shape.is_empty or shape.area < (height * 2) ** 2: continue
        point = shape.representative_point()
        labels.append({'type': 'text', 'text': text[:40], 'position': {'x': point.x, 'y': point.y}, 'height': height * (1.4 if e['parcelRole'] == 'site' else 1), 'rotation': 0, 'align': 'center', 'parcelRole': 'label', 'attributes': {'pnu': str(a.get('pnu', '')), 'jibun': text, 'labelOf': e['parcelRole']}})
    xs = [p['x'] for e in entities for p in e['points']]; ys = [p['y'] for e in entities for p in e['points']]
    if xs:
        labels.append({'type': 'text', 'text': REVIEW_NOTE, 'position': {'x': min(xs), 'y': min(ys) - height * 3}, 'height': height, 'rotation': 0, 'parcelRole': 'label', 'attributes': {'reviewNote': True}})
    return labels

def limit_context(result, metres):
    from shapely.geometry import Polygon, box
    site=[p for e in result['entities'] if e['parcelRole']=='site' for p in e['points']]
    margin=metres*1000
    window=box(min(p['x'] for p in site)-margin,min(p['y'] for p in site)-margin,max(p['x'] for p in site)+margin,max(p['y'] for p in site)+margin)
    kept=[e for e in result['entities'] if e['parcelRole']=='site'];groups={}
    for e in result['entities']:
        if e['parcelRole']=='site':continue
        a=e['attributes'];groups.setdefault((a['pnu'],a['polygon'],e['parcelRole']),[]).append(e)
    for rings_ in groups.values():
        outer=next((e for e in rings_ if e['attributes']['ring']=='outer'),None)
        if outer is None:continue
        coords=lambda e:[(p['x'],p['y']) for p in e['points']]
        geom=Polygon(coords(outer),[coords(e) for e in rings_ if e['attributes']['ring']=='hole'])
        if not geom.is_valid:geom=geom.buffer(0)
        clipped=geom.intersection(window)
        parts=list(clipped.geoms) if hasattr(clipped,'geoms') else [clipped]
        for index,part in enumerate(parts):
            if part.geom_type!='Polygon' or part.area<=0:continue
            for ring_index,ring in enumerate([part.exterior,*part.interiors]):
                kept.append({**outer,'points':[{'x':x,'y':y} for x,y in list(ring.coords)[:-1]],'attributes':{**outer['attributes'],'ring':'hole' if ring_index else 'outer','contextPart':index,'clippedToContext':not geom.equals(clipped)}})
    result['entities']=kept;result['contextMeters']=metres
    result['counts']={role:sum(e['parcelRole']==role for e in kept) for role in ('site','road','neighbor')}
    result['warnings'].append(f'주변 경계는 대지 외곽 사각 범위에서 {metres:g}m까지만 표시합니다. 잘린 가장자리는 실제 필지 경계가 아닙니다.')
    return result


def union(data):
    """도면 mm 좌표의 인접 필지들을 로그인 없이 한 대지 외곽으로 합친다."""
    from shapely.errors import ShapelyError
    from shapely.geometry import Polygon
    from shapely.geometry.polygon import orient
    from shapely.ops import unary_union

    def finite_number(value):
        try:
            return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)
        except OverflowError:
            return False

    parcels = data.get('rings')
    if not isinstance(parcels, list) or not 2 <= len(parcels) <= 40:
        raise ValueError('합칠 필지는 2~40개를 선택하세요.')
    tol = data.get('snapMm', 20)
    if not finite_number(tol) or not 0 <= tol <= 100:
        raise ValueError('필지 경계 보정 거리는 0~100mm의 유한 숫자로 입력하세요.')

    def coordinates(points):
        if not isinstance(points, list) or not 3 <= len(points) <= 10000:
            raise ValueError('필지 경계는 3~10000개의 점으로 입력하세요.')
        if any(not isinstance(point, (list, tuple)) or len(point) != 2
               or not all(finite_number(value) for value in point) for point in points):
            raise ValueError('필지 경계 좌표는 유한한 숫자 [x, y]로 입력하세요.')
        return points

    polygons, pnus = [], []
    for parcel in parcels:
        if not isinstance(parcel, dict):
            raise ValueError('필지의 PNU와 경계 정보를 확인하세요.')
        pnu = parcel.get('pnu')
        if not isinstance(pnu, str) or not re.fullmatch(r'[0-9]{19}', pnu):
            raise ValueError('필지 PNU는 19자리 숫자로 입력하세요.')
        outer = coordinates(parcel.get('outer'))
        holes = parcel.get('holes', [])
        if not isinstance(holes, list):
            raise ValueError('필지 내부 경계는 점 목록들의 배열로 입력하세요.')
        holes = [coordinates(hole) for hole in holes]
        if len(outer) + sum(len(hole) for hole in holes) > 10000:
            raise ValueError('필지 하나의 경계 점은 총 10000개 이하여야 합니다.')
        polygon = Polygon(outer, holes)
        if not polygon.is_valid or not math.isfinite(polygon.area) or polygon.area <= 0:
            raise ValueError('필지 경계가 올바른 다각형이 아닙니다. 교차하거나 면적이 없는 경계를 확인하세요.')
        polygons.append(polygon)
        if pnu not in pnus:
            pnus.append(pnu)

    disconnected = '맞닿지 않은 필지는 한 대지로 합칠 수 없습니다: ' + ', '.join(pnus)
    try:
        # 정확히 공유한 변은 GEOS로 바로 판정한다. 틈/기울기는 공간 인덱스로
        # 가까운 변 쌍만 찾아 JS와 같은 투영 길이를 센다(전체 변 쌍 탐색 금지).
        from shapely.geometry import LineString
        from shapely.strtree import STRtree

        edge_cache = {}

        def edges(index):
            if index not in edge_cache:
                segments = []
                for ring in [polygons[index].exterior, *polygons[index].interiors]:
                    coords = list(ring.coords)
                    segments.extend((a, b) for a, b in zip(coords, coords[1:]) if a != b)
                lines = [LineString(segment) for segment in segments]
                edge_cache[index] = (segments, lines, STRtree(lines))
            return edge_cache[index]

        def clipped_length(a, b, c, d):
            dx, dy = b[0] - a[0], b[1] - a[1]
            length = math.hypot(dx, dy)
            ux, uy = dx / length, dy / length
            t = (c[0] - a[0]) * ux + (c[1] - a[1]) * uy
            u = (d[0] - a[0]) * ux + (d[1] - a[1]) * uy
            lo, hi = max(0, min(t, u)), min(length, max(t, u))
            if hi <= lo:
                return 0.0
            vx, vy = d[0] - c[0], d[1] - c[1]
            for position in (lo, hi):
                fraction = (position - t) / (u - t)
                x, y = c[0] + fraction * vx, c[1] + fraction * vy
                if abs((x - a[0]) * uy - (y - a[1]) * ux) > tol:
                    return 0.0
            return (hi - lo) / abs(u - t) * math.hypot(vx, vy)

        def connected_edges(i, j):
            if polygons[i].boundary.intersection(polygons[j].boundary).length >= 500:
                return True
            if not tol:
                return False
            left_edges, left_lines, _ = edges(i)
            right_edges, _, tree = edges(j)
            shared = 0.0
            for (a, b), line in zip(left_edges, left_lines):
                for index in tree.query(line, predicate='dwithin', distance=tol):
                    c, d = right_edges[index]
                    ab = clipped_length(a, b, c, d)
                    if not ab:
                        continue
                    ba = clipped_length(c, d, a, b)
                    if ba:
                        shared += (ab + ba) / 2
                        if shared >= 500:
                            return True
            return False

        neighbors = [set() for _ in polygons]
        for i, left in enumerate(polygons):
            for j in range(i + 1, len(polygons)):
                if left.boundary.distance(polygons[j].boundary) <= tol and connected_edges(i, j):
                    neighbors[i].add(j)
                    neighbors[j].add(i)
        reached, pending = set(), [0]
        while pending:
            index = pending.pop()
            if index not in reached:
                reached.add(index)
                pending.extend(neighbors[index] - reached)
        if len(reached) != len(polygons):
            raise ValueError(disconnected)

        parts_area = math.fsum(polygon.area for polygon in polygons)
        if not math.isfinite(parts_area):
            raise ValueError('필지 면적이 유한한 숫자가 아닙니다. 경계 좌표를 확인하세요.')
        exact = unary_union(polygons)
        overlap = max(0.0, parts_area - exact.area)
        warnings = []
        if overlap > 500000 or overlap > parts_area * 0.005:
            warnings.append(f'필지 경계가 겹칩니다(약 {overlap / 1000000:.3f}㎡). 선택한 필지와 경계를 확인하세요.')
        hole_error = '합친 대지 가운데에 다른 필지가 남습니다. 가운데 필지도 함께 고르세요.'
        input_holes = [Polygon(hole) for polygon in polygons for hole in polygon.interiors]
        # 원래 내부 필지는 선택된 면이 보정 거리 안에서 채우는 경우에만 허용한다.
        protected_holes, correctable_holes = [], []
        for hole in input_holes:
            remaining = hole.difference(exact)
            if remaining.is_empty:
                continue
            selected = hole.intersection(exact)
            if tol and selected.area > 0 and hole.difference(selected.buffer(tol, join_style=2)).area < 1e-6:
                correctable_holes.append(hole)
            else:
                protected_holes.append(hole)
        exact_parts = list(exact.geoms) if exact.geom_type == 'MultiPolygon' else [exact]
        for part in exact_parts:
            if part.geom_type != 'Polygon':
                raise ValueError('필지를 합치는 중 올바른 대지 경계를 만들지 못했습니다.')
            for ring in part.interiors:
                hole = Polygon(ring)
                if any(hole.intersection(original).area > 0 for original in protected_holes) or (
                        hole.area >= 1000000 and not any(original.covers(hole) for original in correctable_holes)):
                    raise ValueError(hole_error)
        def has_open_gap():
            # 연결된 Polygon에도 공유 변 끝에서 벌어진 틈이 있을 수 있다.
            # 인접 필지의 가까운 변만 검사하고, 실제 빈 면적이 있을 때만 보정한다.
            for i, adjacent in enumerate(neighbors):
                for j in adjacent:
                    if j <= i:
                        continue
                    left_edges, left_lines, _ = edges(i)
                    right_edges, _, tree = edges(j)
                    for (a, b), line in zip(left_edges, left_lines):
                        for index in tree.query(line, predicate='dwithin', distance=tol):
                            c, d = right_edges[index]
                            if not clipped_length(a, b, c, d) or not clipped_length(c, d, a, b):
                                continue
                            dx, dy = b[0] - a[0], b[1] - a[1]
                            length2 = dx * dx + dy * dy
                            t = ((c[0] - a[0]) * dx + (c[1] - a[1]) * dy) / length2
                            u = ((d[0] - a[0]) * dx + (d[1] - a[1]) * dy) / length2
                            lo, hi = max(0, min(t, u)), min(1, max(t, u))
                            near = [(a[0] + v * dx, a[1] + v * dy) for v in (lo, hi)]
                            far = [(c[0] + (v - t) / (u - t) * (d[0] - c[0]),
                                    c[1] + (v - t) / (u - t) * (d[1] - c[1])) for v in (hi, lo)]
                            # 이미 채워진 면은 빼고 두 변 사이의 실제 빈 면적만 확인한다.
                            bridge = Polygon(near + far).convex_hull
                            if bridge.is_valid and bridge.area > 1e-6 and bridge.difference(exact).area > 1e-6:
                                return True
            return False

        needs_correction = bool(tol) and (exact.geom_type == 'MultiPolygon' or
                                         bool(correctable_holes) or has_open_gap())
        merged = exact
        if needs_correction:
            merged = unary_union([polygon.buffer(tol, join_style=2) for polygon in polygons]).buffer(-tol, join_style=2)
        if merged.geom_type == 'MultiPolygon':
            raise ValueError(disconnected)
        if merged.geom_type != 'Polygon' or merged.is_empty or not merged.is_valid:
            raise ValueError('필지를 합치는 중 올바른 대지 경계를 만들지 못했습니다.')
        if needs_correction:
            from shapely import distance, get_coordinates, points, segmentize

            def directed_distance(boundary, target):
                samples = points(get_coordinates(segmentize(boundary, 100)))
                return max(distance(samples, target), default=0.0)

            shape_error = '필지 경계를 맞추는 중 모양이 바뀌어 합칠 수 없습니다'
            # 외곽이 원래 경계에서 튀어나온 곳은 100mm 간격으로 검사한다.
            if directed_distance(merged.exterior, exact.boundary) > 2 * tol + 1:
                raise ValueError(shape_error)
            # 다른 필지 근처의 내부 변은 제외하고, 노출된 오목부가 메워졌는지 검사한다.
            for i, polygon in enumerate(polygons):
                others = unary_union(polygons[:i] + polygons[i + 1:])
                exposed = polygon.exterior.difference(others.buffer(2 * tol + 1))
                if directed_distance(exposed, merged.exterior) > tol + 1:
                    raise ValueError(shape_error)
        if any(Polygon(hole).area >= 1000000 or
               any(Polygon(hole).intersection(original).area > 1e-6 for original in input_holes)
               for hole in merged.interiors):
            raise ValueError(hole_error)
        # 1㎡ 미만 내부 틈은 버리고, 직선 위 중복 꼭짓점과 1mm 이하 잡음을 정리한다.
        merged = orient(Polygon(merged.exterior).simplify(1, preserve_topology=True), sign=1.0)
        ring = [[round(x, 3), round(y, 3)] for x, y in list(merged.exterior.coords)[:-1]]
        rounded = Polygon(ring)
        area = rounded.area
        if not rounded.is_valid or not math.isfinite(area) or area <= 0:
            raise ValueError('필지를 합치는 중 올바른 대지 경계를 만들지 못했습니다.')
        if abs(area - parts_area) > parts_area * 0.01:
            raise ValueError('필지를 합치는 중 면적이 크게 달라졌습니다. 선택한 필지와 경계 보정 거리를 확인하세요.')
    except (ShapelyError, OverflowError) as error:
        raise ValueError('필지를 합치는 중 경계를 계산하지 못했습니다. 필지 좌표를 확인하세요.') from error
    return {'ring': ring, 'areaM2': area / 1000000, 'partsAreaM2': parts_area / 1000000,
            'pnus': pnus, 'warnings': warnings}


def merge_lot(result, ledger_reader=None, tolerance_pct=3.0, max_extra=3, min_shared_m=0.5):
    """건축물대장 대지면적이 지적 필지 면적과 다르면(합필·여러 필지 대지) 맞닿은 이웃 필지 중 면적 합이 맞는 조합을 찾아
    한 대지 외곽으로 합친다(계획 탭 [필지 합치기]와 같은 규칙: 오차 3% · 이웃 3필지까지 · 공유 변 0.5 m 이상). 2026-10-30 대표:
    "필지도 합쳐져야 한다 대지가 222가 되려면". 원래 필지선은 site-original 로 남긴다. 못 찾으면 그대로 두고 알린다."""
    from itertools import combinations
    from shapely.geometry import Polygon
    entities = result.get('entities') or []
    sites = [e for e in entities if e.get('parcelRole') == 'site']
    if not sites or len({e['attributes'].get('pnu') for e in sites}) != 1: return None
    pnu = sites[0]['attributes'].get('pnu')
    try: lot = (ledger_reader or ledger)(pnu).get('lotAreaM2')
    except ValueError as error:
        result['warnings'].append(f'건축물대장 대지면적을 읽지 못해 필지 합치기를 확인하지 못했습니다: {error}')
        return None
    def polygon(es):
        outer = [e for e in es if e['attributes'].get('ring') != 'hole']
        holes = [e for e in es if e['attributes'].get('ring') == 'hole']
        shape = None
        for o in outer:
            piece = Polygon([(q['x'], q['y']) for q in o['points']], [[(q['x'], q['y']) for q in h['points']] for h in holes])
            shape = piece if shape is None else shape.union(piece)
        return shape
    site_shape = polygon(sites)
    site_area = site_shape.area / 1e6
    if not lot or abs(site_area - lot) / lot * 100 <= tolerance_pct or site_area > lot: return None
    groups = {}
    for e in entities:
        a = e.get('attributes') or {}
        if e.get('parcelRole') == 'neighbor' and a.get('pnu') and not a.get('clippedToContext'): groups.setdefault(a['pnu'], []).append(e)
    shapes = {k: polygon(v) for k, v in groups.items()}
    touching = [k for k, g in shapes.items() if g is not None and g.is_valid and site_shape.buffer(20).intersection(g.boundary).length / 1000 >= min_shared_m]
    best = None
    for n in range(1, max_extra + 1):
        for combo in combinations(touching[:24], n):
            total = site_area + sum(shapes[k].area for k in combo) / 1e6
            diff = abs(total - lot) / lot * 100
            if diff <= tolerance_pct and (best is None or diff < best[1]): best = (combo, diff, total)
        if best: break   # 적은 필지 조합을 먼저
    if not best:
        result['warnings'].append(f'건축물대장 대지면적 {lot:g}㎡ 와 지적 면적 {site_area:.2f}㎡ 가 달라 맞닿은 필지를 찾았지만 면적이 맞는 조합이 없습니다. 대지 경계를 확인하세요.')
        return None
    combo = best[0]
    def rings(pnu_value, es):
        outers = [e for e in es if e['attributes'].get('ring') != 'hole']
        return [{'pnu': pnu_value, 'outer': [[q['x'], q['y']] for q in o['points']],
                 'holes': [[[q['x'], q['y']] for q in h['points']] for h in es if h['attributes'].get('ring') == 'hole' and len(outers) == 1]} for o in outers]
    merged = union({'rings': rings(pnu, sites) + [r for k in combo for r in rings(k, groups[k])]})
    first = next(e for e in sites if e['attributes'].get('ring') != 'hole')
    points = [{'x': x, 'y': y} for x, y in merged['ring']]
    attributes = {**first['attributes']}
    if isinstance(attributes.get('originMetres'), list) and isinstance(attributes.get('insertionMm'), list):
        at = attributes['insertionMm']
        attributes['originMetres'] = [v + (points[0][k] - at[i]) / 1000 for i, (v, k) in enumerate(zip(attributes['originMetres'], 'xy'))]
        attributes['insertionMm'] = [points[0]['x'], points[0]['y']]
    jibuns = [first['attributes'].get('jibun', '')] + [groups[k][0]['attributes'].get('jibun', '') for k in combo]
    attributes.update(ring='outer', polygon=0, pnu=pnu, jibun=f'{jibuns[0]} 외 {len(combo)}필지', sitePnus=[pnu, *combo], siteJibuns=jibuns,
                      mergedSite=True, ledgerAreaM2=lot)
    chosen = set(combo)
    for e in entities:
        if e in sites or e.get('parcelRole') == 'neighbor' and e['attributes'].get('pnu') in chosen: e['parcelRole'] = 'site-original'
    entities.insert(0, {'type': 'polyline', 'closed': True, 'points': points, 'parcelRole': 'site', 'attributes': attributes})
    info = {'pnus': [pnu, *combo], 'jibuns': jibuns, 'areaM2': round(merged['areaM2'], 2), 'ledgerAreaM2': lot}
    result['mergedLot'] = info; result['pnus'] = info['pnus']
    if isinstance(result.get('counts'), dict): result['counts']['site'] = 1
    result['warnings'].append(f"건축물대장 대지면적 {lot:g}㎡ 에 맞춰 {' + '.join(jibuns)} 를 한 대지({info['areaM2']:.2f}㎡)로 합쳤습니다. 원래 필지선은 따로 남깁니다.")
    return info

def fetch(data):
    context=float(data.get('contextMeters',30))
    if not math.isfinite(context) or not 5<=context<=200:raise ValueError('주변 범위는 5~200m로 입력하세요.')
    # A30(10-21): 기본은 계획 탭·설계엔진과 같은 EPSG:5187. 예전 5179 는 명시할 때만.
    crs=str(data.get('crs','EPSG:5187'))
    if crs not in DRAWING_CRS: raise ValueError('도면 좌표계는 EPSG:5179 또는 EPSG:5187만 지원합니다.')
    raw_pnus=data.get('pnus') if isinstance(data.get('pnus'),list) else [data.get('pnu','')]
    pnus=list(dict.fromkeys(str(value) for value in raw_pnus))
    if not 1<=len(pnus)<=10: raise ValueError('대지는 한 번에 1~10필지를 선택하세요.')
    if any(not re.fullmatch(r'\d{19}',pnu) for pnu in pnus): raise ValueError('주소 검색 결과의 19자리 PNU를 선택하세요.')
    config, _ = request(BASE + '/api/vworld', authenticated=True)
    targets=[]
    for pnu in pnus:
        found=features(config, {'attrFilter': 'pnu:=:' + pnu}, 10)
        if not found: raise ValueError(f'선택한 필지 경계를 찾지 못했습니다: {pnu}')
        targets.extend(found)
    surroundings = []
    warnings = []
    if data.get('surroundings', True):
        points = [point for f in targets for polygon in rings(f) for ring in polygon for point in ring]
        xs, ys = [p[0] for p in points], [p[1] for p in points]
        dy = context/110940; dx = context/(111320*math.cos(math.radians(sum(ys)/len(ys))))
        box = ','.join(str(v) for v in (min(xs)-dx,min(ys)-dy,max(xs)+dx,max(ys)+dy))
        # A12(10-21): 한 번에 100개만 받으면 큰 대지(부산시청 등)는 둘레 한 귀퉁이 필지만 온다 → 쪽 넘기기·사각 쪼개기로 전부.
        try:
            try:
                nearby=features_in_box(config, tuple(float(v) for v in box.split(',')))
            except ValueError as error:
                if '넘습니다' not in str(error): raise
                nearby=features(config, {'geomFilter': f'BOX({box})'}, FEATURE_PAGE)
                warnings.append(f'주변 필지가 {BOX_MAX_PARCELS}개를 넘어 일부만 가져왔습니다. 주변 범위를 줄이세요.')
            surroundings=[f for f in nearby if str((f.get('properties') or {}).get('pnu')) not in set(pnus)]
        except ValueError: warnings.append('주변 필지 조회에 실패해 대상 대지 경계만 가져왔습니다.')
    result=drawing(targets,surroundings,pnus[0],float(data.get('x',0)),float(data.get('y',0)),crs=crs,origin=data.get('originM'),labels=bool(data.get('labels')))
    result['pnus']=pnus
    if data.get('surroundings',True):limit_context(result,context)
    if data.get('labels'):result['entities'].extend(label_entities(result['entities']))
    result['warnings'].extend(warnings)
    from miriboda_service import land_info
    infos={}
    for pnu in pnus:
        try:
            area=0
            for entity in result['entities']:
                if entity['parcelRole']!='site' or entity['attributes'].get('pnu')!=pnu:continue
                ps=entity['points'];ring_area=abs(sum(a['x']*b['y']-a['y']*b['x'] for a,b in zip(ps,ps[1:]+ps[:1])))/2e6
                area+=ring_area*(-1 if entity['attributes']['ring']=='hole' else 1)
            infos[pnu]=land_info(pnu,area,config=config)
        except (ValueError,KeyError,TypeError) as error:
            infos[pnu]={'pnu':pnu,'error':str(error),'zones':[]}
            result['warnings'].append(f'{pnu} 토지정보 자동 조회 실패: {error}')
    result['landInfoByPnu']=infos;result['landInfo']=infos[pnus[0]]
    for entity in result['entities']:
        if entity['parcelRole']=='site':entity['attributes']['landInfo']=infos.get(entity['attributes'].get('pnu'),infos[pnus[0]])
    if len(pnus)==1 and data.get('mergeLot',True) and data.get('surroundings',True):merge_lot(result)
    return result

def pnu_jibun(pnu):
    """PNU 19자리 → (법정동코드 10자리, 지번 '156-7' / '산 12')."""
    if not re.fullmatch(r'\d{19}', str(pnu)): raise ValueError('19자리 PNU가 필요합니다.')
    bun, ji = int(pnu[11:15]), int(pnu[15:19])
    return pnu[:10], ('산 ' if pnu[10] == '2' else '') + str(bun) + (f'-{ji}' if ji else '')

def ledger(pnu):
    """건축물대장 대지면적(바른 서버 /api/public/check). 무료 조회 한도(대장 조회)와 합산되므로 사용자가 누를 때만 부른다.
    응답의 VWorld 키 등은 돌려주지 않는다."""
    bjd, jibun = pnu_jibun(pnu)
    try:
        result, _ = request(BASE + '/api/public/check', {'bjdCode': bjd, 'jibun': jibun}, authenticated=signed_in())
    except ValueError as error:
        raise ValueError('건축물대장 조회 실패: ' + str(error)) from None
    building = result.get('building') or {}
    rows = building.get('buildings') or []
    return {'pnu': pnu, 'jibun': jibun, 'found': bool(building.get('found')), **ledger_values(rows),
            'buildings': len(rows) if isinstance(rows, list) else 0,
            'message': '' if ledger_values(rows)['lotAreaM2'] else (str(building.get('error') or '') or '건축물대장에 대지면적이 없습니다(건물이 없는 필지일 수 있습니다).')}

def _ledger_number(value):
    try:
        number = float(str(value).replace(',', '').replace('㎡', '').replace('층', '').strip())
    except ValueError:
        return None
    return number if number > 0 else None

def ledger_values(rows):
    """대장 행들에서 대지면적(가장 큰 값)과 기존 건물 건축면적·연면적(합)·지상층수(가장 높은 값). 증축·대수선 검토가 기존 값으로 쓴다."""
    lot, arch, total, floors = [], 0.0, 0.0, []
    for row in rows if isinstance(rows, list) else []:
        for key, value in (row or {}).items():
            key, number = str(key), _ledger_number(value)
            if number is None: continue
            if '대지면적' in key: lot.append(number)
            elif '건축면적' in key: arch += number
            elif '연면적' in key and '용적률' not in key: total += number
            elif '지상층수' in key: floors.append(number)
    return {'lotAreaM2': max(lot) if lot else None, 'archAreaM2': arch or None, 'totalAreaM2': total or None,
            'groundFloors': int(max(floors)) if floors else None}

# 지도(미니맵·도면 뒤 배경): 브이월드 WMTS 조각을 이어 붙인 그림 한 장과, 도면 좌표(mm) → 그림 화소 아핀 변환.
# 열쇠는 Python 안에서만 쓰고 그림만 돌려준다. 몇백 m 범위는 메르카토르↔평면직각이 거의 선형이라 세 모서리로 맞춘다.
BASEMAP_LAYERS = {'Base': ('png', 'PNG', 'image/png'), 'Satellite': ('jpeg', 'JPEG', 'image/jpeg')}

def _world_px(lon, lat, zoom):
    size = 256 * 2 ** zoom
    lat = max(-85.0, min(85.0, lat))
    return (lon + 180) / 360 * size, (1 - math.log(math.tan(math.radians(lat)) + 1 / math.cos(math.radians(lat))) / math.pi) / 2 * size

@__import__('functools').lru_cache(maxsize=256)
def _tile(key, referer, layer, zoom, x, y):
    ext = BASEMAP_LAYERS[layer][0]
    req = urllib.request.Request(f'https://api.vworld.kr/req/wmts/1.0.0/{key}/{layer}/{zoom}/{y}/{x}.{ext}', headers={'User-Agent': 'BarunCAD/3', 'Referer': referer})
    try:
        with urllib.request.urlopen(req, timeout=15) as response:
            raw = response.read(2_000_001)
            return raw if len(raw) <= 2_000_000 and response.headers.get_content_type().startswith('image/') else None
    except (urllib.error.URLError, TimeoutError):
        return None

def basemap(data):
    import base64, io
    from concurrent.futures import ThreadPoolExecutor
    from PIL import Image
    crs = str(data.get('crs', ''))
    if crs not in DRAWING_CRS: raise ValueError('지도는 지적 좌표계(EPSG:5179·5187) 도면에서만 볼 수 있습니다. 주소로 대지를 불러오세요.')
    layer = str(data.get('layer', 'Base'))
    if layer not in BASEMAP_LAYERS: raise ValueError('지도 종류는 일반 또는 위성입니다.')
    origin, box = data.get('originM'), data.get('bboxMm')
    numbers = lambda v, n: isinstance(v, (list, tuple)) and len(v) == n and all(isinstance(i, (int, float)) and math.isfinite(i) for i in v)
    if not numbers(origin, 2) or not numbers(box, 4): raise ValueError('도면 원점과 지도 범위를 확인하세요.')
    x0, y0, x1, y1 = box
    if not (0 < x1 - x0 <= 5_000_000 and 0 < y1 - y0 <= 5_000_000): raise ValueError('지도 범위는 5km 이내로 정하세요.')
    max_px = int(min(2048, max(256, data.get('maxPx', 1024))))
    to_geo = korea_crs.transformer(crs, 'EPSG:4326')
    corners = [(x0, y0), (x1, y0), (x0, y1), (x1, y1)]
    lonlat = [to_geo.transform(origin[0] + x / 1000, origin[1] + y / 1000) for x, y in corners]
    if not all(120 <= lon <= 140 and 30 <= lat <= 45 for lon, lat in lonlat): raise ValueError('대한민국 범위의 도면이 아닙니다.')
    zoom = 19
    while zoom > 6:
        pts = [_world_px(lon, lat, zoom) for lon, lat in lonlat]
        if max(p[0] for p in pts) - min(p[0] for p in pts) <= max_px and max(p[1] for p in pts) - min(p[1] for p in pts) <= max_px: break
        zoom -= 1
    pts = [_world_px(lon, lat, zoom) for lon, lat in lonlat]
    left, top = math.floor(min(p[0] for p in pts)), math.floor(min(p[1] for p in pts))
    right, bottom = math.ceil(max(p[0] for p in pts)), math.ceil(max(p[1] for p in pts))
    tiles = [(tx, ty) for ty in range(top // 256, (bottom - 1) // 256 + 1) for tx in range(left // 256, (right - 1) // 256 + 1)]
    if len(tiles) > 81: raise ValueError('지도 범위가 너무 넓습니다.')
    config, _ = request(BASE + '/api/vworld', authenticated=True)
    referer = 'https://' + str(config['domain']).removeprefix('https://').strip('/') + '/'
    with ThreadPoolExecutor(8) as pool:
        raws = list(pool.map(lambda t: _tile(config['key'], referer, layer, zoom, *t), tiles))
    if not any(raws): raise ValueError('지도 조각을 받지 못했습니다. 인터넷 연결을 확인하고 다시 시도하세요.')
    image = Image.new('RGB', (right - left, bottom - top), (232, 232, 232))
    for (tx, ty), raw in zip(tiles, raws):
        if raw:
            try: image.paste(Image.open(io.BytesIO(raw)).convert('RGB'), (tx * 256 - left, ty * 256 - top))
            except OSError: pass
    out = io.BytesIO()
    image.save(out, BASEMAP_LAYERS[layer][1], **({'quality': 85} if layer == 'Satellite' else {'optimize': True}))
    # 도면(mm) → 그림 화소: px = a*x + c*y + e, py = b*x + d*y + f (canvas setTransform 순서)
    (p0x, p0y), (p1x, p1y), (p2x, p2y) = [(p[0] - left, p[1] - top) for p in pts[:3]]
    a, b = (p1x - p0x) / (x1 - x0), (p1y - p0y) / (x1 - x0)
    c, d = (p2x - p0x) / (y1 - y0), (p2y - p0y) / (y1 - y0)
    return {'image': f'data:{BASEMAP_LAYERS[layer][2]};base64,' + base64.b64encode(out.getvalue()).decode(), 'width': image.width, 'height': image.height,
            'affine': [a, b, c, d, p0x - a * x0 - c * y0, p0y - b * x0 - d * y0], 'layer': layer, 'zoom': zoom, 'bboxMm': [x0, y0, x1, y1],
            'attribution': '지도 © 브이월드(국토교통부)', 'missingTiles': sum(raw is None for raw in raws)}

# 주변 3D 자료: 브이월드 GIS건물통합정보(LT_C_BLDGINFO, 전국) 건물 바닥·높이 + 바른 서버(배치 엔진 /site-plan/terrain)의
# 5m 등고선·지반고. 지형 자료는 서버에만 둔다(지금은 부산: 1:5000 수치지형도 등고선 → 5m DEM). 없는 지역은 건물만.
FLOOR_HEIGHT_M = 3.3

def _number(value):
    try:
        value = float(value)
        return value if math.isfinite(value) else 0.0
    except (TypeError, ValueError):
        return 0.0

# 사용승인 연도 칸: GIS건물통합정보 판마다 이름이 달라 후보를 차례로 본다. 없으면 None(지어내지 않음).
APPROVAL_KEYS = ('useapr_day', 'use_apr_day', 'useaprday', 'use_confm_de', 'useconfmde', 'aprv_de', 'apr_day', 'crtn_day')

def approval_year(props):
    """GIS건물통합정보 속성에서 사용승인 연도(1900~올해). 칸이 없거나 값이 이상하면 None."""
    import datetime
    for key in APPROVAL_KEYS:
        match = re.match(r'\s*((?:19|20)\d{2})', str(props.get(key) or ''))
        if match and 1900 <= int(match.group(1)) <= datetime.date.today().year: return int(match.group(1))
    return None

def use_code(props):
    """주용도 코드(건축법 시행령 별표1 호 번호 × 1000, 예: 02000 = 공동주택). 다섯 자리 숫자만 받는다."""
    code = str(props.get('usability') or '').strip()
    return code if re.fullmatch(r'\d{5}', code) else ''

def surroundings(data):
    """대지 둘레 주변 건물(바닥·높이)과 5m 등고선을 도면(mm) 객체로."""
    crs = str(data.get('crs', ''))
    if crs not in DRAWING_CRS: raise ValueError('주변 건물·등고선은 지적 좌표계 도면에서만 가져올 수 있습니다. 주소로 대지를 불러오세요.')
    origin, box = data.get('originM'), data.get('bboxMm')
    numbers = lambda v, n: isinstance(v, (list, tuple)) and len(v) == n and all(isinstance(i, (int, float)) and math.isfinite(i) for i in v)
    if not numbers(origin, 2) or not numbers(box, 4): raise ValueError('도면 원점과 범위를 확인하세요.')
    x0, y0, x1, y1 = origin[0] + box[0] / 1000, origin[1] + box[1] / 1000, origin[0] + box[2] / 1000, origin[1] + box[3] / 1000
    if not (0 < x1 - x0 <= 1500 and 0 < y1 - y0 <= 1500): raise ValueError('주변 범위는 1.5km 이내로 정하세요.')
    to_mm = lambda X, Y: {'x': (X - origin[0]) * 1000, 'y': (Y - origin[1]) * 1000}
    to_geo = korea_crs.transformer(crs, 'EPSG:4326')
    to_crs = korea_crs.transformer('EPSG:4326', crs)
    corners = [to_geo.transform(X, Y) for X, Y in ((x0, y0), (x1, y0), (x0, y1), (x1, y1))]
    lons, lats = [p[0] for p in corners], [p[1] for p in corners]
    config, _ = request(BASE + '/api/vworld', authenticated=True)
    referer = 'https://' + str(config['domain']).removeprefix('https://').strip('/') + '/'
    warnings, features = [], []
    for page in range(1, 7):   # 1,000동씩 6쪽 = 6,000동(반경 500m 도심, 2026-10-27)
        params = {'service': 'data', 'request': 'GetFeature', 'data': 'LT_C_BLDGINFO', 'key': config['key'], 'domain': config['domain'], 'format': 'json',
                  'geometry': 'true', 'size': 1000, 'page': page, 'crs': 'EPSG:4326', 'geomFilter': f'BOX({min(lons)},{min(lats)},{max(lons)},{max(lats)})'}
        raw, _ = request('https://api.vworld.kr/req/data?' + urllib.parse.urlencode(params), extra_headers={'Referer': referer})
        response = raw.get('response') or {}
        if response.get('status') == 'NOT_FOUND': break
        if response.get('status') != 'OK': raise ValueError('주변 건물 조회 실패: ' + str((response.get('error') or {}).get('text') or response.get('status')))
        features += ((response.get('result') or {}).get('featureCollection') or {}).get('features') or []
        if int((response.get('page') or {}).get('total', 1)) <= page: break
    else:
        warnings.append('주변 건물이 6,000동을 넘어 일부만 가져왔습니다.')
    buildings = []
    for feature in features:
        props, geometry = feature.get('properties') or {}, feature.get('geometry') or {}
        polygons = geometry.get('coordinates') or []
        if geometry.get('type') == 'Polygon': polygons = [polygons]
        floors, height = int(_number(props.get('grnd_flr'))), _number(props.get('height'))
        # GIS건물 높이 칸에는 날짜 등 잘못 든 값이 섞인다 → 층당 10m+20m·600m 넘으면 버리고 층수×3.3m.
        if 0 < height <= 600 and (not floors or height <= floors * 10 + 20): source = '건물 높이(GIS건물통합정보)'
        elif floors > 0: height, source = floors * FLOOR_HEIGHT_M, f'지상 {floors}층 × {FLOOR_HEIGHT_M}m'
        else: height, source, floors = FLOOR_HEIGHT_M, '층수 없음 · 1층으로 봄', 1
        for polygon in polygons:
            ring = [to_crs.transform(lon, lat) for lon, lat, *_ in polygon[0]]
            if len(ring) > 1 and ring[0] == ring[-1]: ring.pop()
            if len(ring) < 3: continue
            cx, cy = sum(p[0] for p in ring) / len(ring), sum(p[1] for p in ring) / len(ring)
            if x0 <= cx <= x1 and y0 <= cy <= y1: buildings.append((ring, (cx, cy), height, floors, source, str(props.get('bld_nm') or ''), use_code(props), approval_year(props), _number(props.get('totalarea'))))
    terrain = {'covered': False, 'contours': [], 'heights': []}
    try:
        terrain, _ = request(BASE + '/site-plan/terrain', {'crs': crs, 'bbox': [x0, y0, x1, y1], 'interval': 5, 'points': [list(b[1]) for b in buildings][:5000]}, authenticated=True)
    except ValueError as error:
        warnings.append(f'등고선을 받지 못해 건물만 넣었습니다({error}).')
    heights = terrain.get('heights') or []
    entities = [{'type': 'polyline', 'closed': True, 'parcelRole': 'building', 'points': [to_mm(*p) for p in ring],
                 'model3d': {'height': round(height * 1000), 'elevation': 0, 'color': '#b8c7d0'},
                 'attributes': {'source': 'VWorld LT_C_BLDGINFO', 'floors': floors, 'heightM': round(height, 2), 'heightSource': source,
                                'name': name, 'groundM': heights[i] if i < len(heights) else None,
                                **({'useCode': use} if use else {}), **({'approvalYear': year} if year else {}), **({'totalAreaM2': round(gfa, 1)} if 0 < gfa < 5_000_000 else {})}}
                for i, (ring, _, height, floors, source, name, use, year, gfa) in enumerate(buildings)]
    for line in terrain.get('contours') or []:
        entities.append({'type': 'polyline', 'closed': False, 'parcelRole': 'contour-major' if line.get('major') else 'contour',
                         'points': [to_mm(X, Y) for X, Y in line['points']], 'attributes': {'source': terrain.get('source', ''), 'elevationM': line['elevation']}})
    if not terrain.get('covered') and not any('등고선을 받지 못해' in w for w in warnings):
        warnings.append('이 지역은 5m 지형 자료가 없어 등고선을 그리지 않았습니다(지금은 부산만 있음).')
    estimated = sum(not b[4].startswith('건물 높이') for b in buildings)
    if estimated: warnings.append(f'높이 자료가 없는 건물 {estimated}동은 층수×{FLOOR_HEIGHT_M}m로 잡았습니다.')
    info = {'source': terrain['source'], 'minM': terrain.get('minM'), 'maxM': terrain.get('maxM')} if terrain.get('covered') else None
    # 대지분석 도판이 "용도·연도 자료 없음"을 정확히 말하도록, 받은 칸 이름(값 아님)을 함께 돌려준다.
    keys = sorted({k for f in features[:50] for k in (f.get('properties') or {})})
    return {'entities': entities, 'counts': {'buildings': len(buildings), 'contours': len(terrain.get('contours') or [])},
            'attributeCounts': {'use': sum(bool(b[6]) for b in buildings), 'year': sum(bool(b[7]) for b in buildings)}, 'propertyKeys': keys,
            'terrain': info, 'warnings': warnings, 'source': '브이월드 GIS건물통합정보' + (' · ' + info['source'] if info else '')}

# ---- 가두리(PL) 묶기용 보조 — 기존 fetch 는 손대지 않는다 ----------------------------------------
FEATURE_PAGE=100            # VWorld GetFeature 한 번 최대
BOX_MAX_PARCELS=2000        # 가두리 하나에 받는 필지 상한(메모리·요청 수 보호)
_ZONE_CACHE={}              # pnu → {'zones','zoneNames'} (프로세스 수명 동안)

def features_in_box(config, bbox, size=FEATURE_PAGE, max_total=BOX_MAX_PARCELS, depth=0):
    """bbox(lon,lat 4326: minx,miny,maxx,maxy) 안 필지 전부. 1페이지 100개 한도를 page 로 넘기고,
    page 가 안 먹으면(2쪽이 1쪽과 같음) 사각형을 4조각으로 쪼개 다시 묻는다(최대 6단 = 4096조각)."""
    minx,miny,maxx,maxy=bbox
    box=f'BOX({minx},{miny},{maxx},{maxy})'
    out={};page=1
    while True:
        rows=features(config,{'geomFilter':box,'page':page},size)
        keys=[str((f.get('properties') or {}).get('pnu'))+'/'+str(i) for i,f in enumerate(rows)]
        new=[f for f in rows if str((f.get('properties') or {}).get('pnu')) not in out]
        if page>1 and not new:
            break                                    # page 를 무시하는 서버 → 타일 분할로
        for f in new: out[str((f.get('properties') or {}).get('pnu'))]=f
        if len(rows)<size: return list(out.values())
        if len(out)>=max_total: raise ValueError(f'가두리 안 필지가 {max_total}개를 넘습니다. 범위를 줄이세요.')
        page+=1
        if page>max_total//size+1: break
    if depth>=6: return list(out.values())
    mx,my=(minx+maxx)/2,(miny+maxy)/2
    for sub in ((minx,miny,mx,my),(mx,miny,maxx,my),(minx,my,mx,maxy),(mx,my,maxx,maxy)):
        for f in features_in_box(config,sub,size,max_total,depth+1):
            out[str((f.get('properties') or {}).get('pnu'))]=f
        if len(out)>max_total: raise ValueError(f'가두리 안 필지가 {max_total}개를 넘습니다. 범위를 줄이세요.')
    return list(out.values())

def feature_polygons_m(feature):
    """VWorld 필지 → [(shapely Polygon in EPSG:5179 m, props)] (구멍 포함)."""
    from shapely.geometry import Polygon
    transform=korea_crs.transformer('EPSG:4326','EPSG:5179')
    props=feature.get('properties') or {}
    out=[]
    for polygon in rings(feature):
        shells=[]
        for ring in polygon:
            pts=[]
            for lon,lat,*_ in ring:
                if not (120<=lon<=140 and 30<=lat<=45): raise ValueError('대한민국 위경도 범위가 아닙니다.')
                pts.append(transform.transform(lon,lat))
            shells.append(pts)
        if len(shells[0])<3: continue
        g=Polygon(shells[0],[s for s in shells[1:] if len(s)>=3])
        if not g.is_valid: g=g.buffer(0)
        if not g.is_empty: out.append((g,props))
    return out

ZONE_LAYER_ID='LT_C_UQ111'     # VWorld 용도지역(도시지역) 면 — 한 번의 범위 조회로 가두리 안 지역 조각을 얻는다

def zone_polygons_in_box(config, bbox):
    """용도지역 면(LT_C_UQ111)을 bbox 로 한 번에 → [(Polygon 5179 m, 지역명)]. 레이어가 막혀 있으면 ValueError(호출자가 pnu 별 조회로 대체)."""
    minx,miny,maxx,maxy=bbox
    feats=features(config,{'geomFilter':f'BOX({minx},{miny},{maxx},{maxy})','data':ZONE_LAYER_ID},FEATURE_PAGE)
    out=[]
    for f in feats:
        props=f.get('properties') or {}
        name=str(props.get('uname') or props.get('dgm_nm') or props.get('prpos_area_dstrc_nm') or '').strip()
        if not name: continue
        for g,_ in feature_polygons_m(f): out.append((g,name))
    if not out: raise ValueError('용도지역 레이어에서 면을 받지 못했습니다.')
    return out

def zone_lookup(pnu, config):
    """토지이용정보(용도지역)만 가볍게 — 미리보다 법규 검토 호출 없음. 결과는 _ZONE_CACHE 에."""
    if pnu in _ZONE_CACHE: return _ZONE_CACHE[pnu]
    params={'key':config['key'],'domain':config['domain'],'pnu':pnu,'format':'json','numOfRows':100,'pageNo':1}
    raw,_=request('https://api.vworld.kr/ned/data/getLandUseAttr?'+urllib.parse.urlencode(params),
        extra_headers={'Referer':'https://'+str(config['domain']).removeprefix('https://').strip('/')+'/'})
    uses=raw.get('landUses') or {}
    if uses.get('resultCode'): raise ValueError('토지이용정보 조회 실패: '+str(uses.get('resultMsg') or uses['resultCode']))
    rows=uses.get('field') or []
    if isinstance(rows,dict): rows=[rows]
    zones=[{'code':r.get('prposAreaDstrcCode',''),'name':r.get('prposAreaDstrcCodeNm',''),'relation':r.get('cnflcAtNm','')} for r in rows]
    names=list(dict.fromkeys(z['name'] for z in zones if z['name'] and z['code'].startswith('UQA') and z['relation']!='접함'))
    info={'pnu':pnu,'zones':zones,'zoneNames':names}
    _ZONE_CACHE[pnu]=info
    return info

def zones_by_pnu(pnus, config=None, workers=3):
    """여러 필지 용도지역을 작은 동시성(기본 3)으로. 실패는 {'error'} 로 돌려주고 예외를 던지지 않는다."""
    from concurrent.futures import ThreadPoolExecutor
    pnus=list(dict.fromkeys(str(p) for p in pnus if p))
    if not pnus: return {}
    config=config or request(BASE+'/api/vworld',authenticated=True)[0]
    def one(pnu):
        try: return pnu,zone_lookup(pnu,config)
        except (ValueError,KeyError,TypeError) as error: return pnu,{'pnu':pnu,'error':str(error),'zones':[],'zoneNames':[]}
    with ThreadPoolExecutor(max(1,min(workers,8))) as ex:
        return dict(ex.map(one,pnus))

# 대지분석 «상권·추천 용도»: 홈페이지의 상권 맞춤추천(/api/public/site-fit, 카카오 장소 — 음식점·카페 등 업종별 점포 수와 부족 업종)과
# 신축 용도 추천(/api/use-recommend, 주변 건물 용도 분포 → AI). 둘 다 서버가 계산하고 캐드는 입력만 보낸다(엔진은 서버에).
# 홈페이지 v762(2026-10-22)부터 두 창구가 계정 연결 토큰을 받는다 — 401 은 다른 기능처럼 «로그인이 끊김»으로 안내한다.
# 추천 용도는 회원 하루 5번(429 → remote_error 가 «오늘 이용 한도»로 알린다).

def _homepage_post(path, body, feature):
    require_login(feature)
    headers = {'Content-Type': 'application/json', 'User-Agent': 'BarunCAD/3', **auth_headers()}
    req = urllib.request.Request(BASE + path, data=json.dumps(body).encode(), headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=110) as response:
            raw = response.read(2_000_001)
            if len(raw) > 2_000_000: raise ValueError(feature + ' 응답이 너무 큽니다.')
            return json.loads(raw)
    except urllib.error.HTTPError as error:
        raise ValueError(remote_error(error, feature)) from None
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError):
        raise ValueError(f'{feature}: 바른 서버에 연결하지 못했습니다. 잠시 후 다시 시도하세요.') from None

def market(data):
    """주소 둘레 상권(반경 1km 업종별 점포 수 · 부족 업종 후보). 신축 기준."""
    address = str(data.get('address', '')).strip()[:200]
    if len(address) < 2: raise ValueError('상권은 주소가 있는 대지에서만 볼 수 있습니다. 계획 탭에서 주소로 대지를 불러오세요.')
    return _homepage_post('/api/public/site-fit', {'address': address, 'currentUse': '', 'kind': 'newbuild'}, '상권 분석')

def use_recommend(data):
    """주변 건물 용도 분포(캐드가 VWorld 에서 받아 센 값) → 신축 추천 용도 구성."""
    area = data.get('lotAreaM2')
    if not isinstance(area, (int, float)) or not math.isfinite(area) or area <= 0: raise ValueError('대지면적을 확인하세요.')
    stats = []
    for row in (data.get('stats') or [])[:12]:
        if not isinstance(row, dict): continue
        use, count, floors = str(row.get('use', ''))[:60], row.get('count'), row.get('avgFloors')
        if use and isinstance(count, (int, float)) and count > 0:
            stats.append({'use': use, 'count': int(count), 'avgFloors': float(floors) if isinstance(floors, (int, float)) and math.isfinite(floors) else 0})
    body = {'address': str(data.get('address', ''))[:200], 'zoneNames': [str(z)[:40] for z in (data.get('zoneNames') or [])][:10],
            'lotAreaM2': float(area), 'jiga': data.get('jiga') if isinstance(data.get('jiga'), (int, float)) else None,
            'stats': stats, 'totalBuildings': int(data.get('totalBuildings') or sum(s['count'] for s in stats))}
    return _homepage_post('/api/use-recommend', body, '추천 용도')

# 대지분석 «용도지역 · 구역지구 · 도시계획시설»: 브이월드 2D 데이터 API(전국, 도시계획정보 UPIS 기반). 레이어 이름은 2026-10-19 로그인 상태로 확인.
ZONING_LAYERS = {
    'zone': ('LT_C_UQ111', 'LT_C_UQ112', 'LT_C_UQ113', 'LT_C_UQ114'),                       # 도시·관리·농림·자연환경보전지역(용도지역)
    'district': ('LT_C_UQ121', 'LT_C_UQ123', 'LT_C_UQ124', 'LT_C_UQ125', 'LT_C_UQ126', 'LT_C_UQ128', 'LT_C_UQ129', 'LT_C_UQ130', 'LT_C_UQ141'),  # 용도지구·지구단위계획구역
    'water': ('LT_C_WKMSTRM',),                                                                 # 하천망(하천 이름·국가/지방하천 등급) — 공원·녹지·하천 도판
    'facility': ('LT_C_UPISUQ151', 'LT_C_UPISUQ152', 'LT_C_UPISUQ153', 'LT_C_UPISUQ154', 'LT_C_UPISUQ155', 'LT_C_UPISUQ156', 'LT_C_UPISUQ158', 'LT_C_UPISUQ159'),
}
FACILITY_GROUPS = {'LT_C_UPISUQ151': '도로', 'LT_C_UPISUQ152': '교통', 'LT_C_UPISUQ153': '공간', 'LT_C_UPISUQ154': '유통·공급',
                   'LT_C_UPISUQ155': '공공·문화체육', 'LT_C_UPISUQ156': '방재', 'LT_C_UPISUQ158': '환경기초', 'LT_C_UPISUQ159': '기타'}

def zoning(data):
    """대지 둘레 용도지역·용도지구·지구단위계획구역·도시계획시설 면(도면 mm, 범위로 자름). 도면은 바꾸지 않는다."""
    from concurrent.futures import ThreadPoolExecutor
    from shapely.geometry import box as sbox, shape
    crs = str(data.get('crs', ''))
    if crs not in DRAWING_CRS: raise ValueError('용도지역 도판은 지적 좌표계 도면에서만 됩니다. 주소로 대지를 불러오세요.')
    origin, bb = data.get('originM'), data.get('bboxMm')
    numbers = lambda v, n: isinstance(v, (list, tuple)) and len(v) == n and all(isinstance(i, (int, float)) and math.isfinite(i) for i in v)
    if not numbers(origin, 2) or not numbers(bb, 4): raise ValueError('도면 원점과 범위를 확인하세요.')
    x0, y0, x1, y1 = origin[0] + bb[0] / 1000, origin[1] + bb[1] / 1000, origin[0] + bb[2] / 1000, origin[1] + bb[3] / 1000
    if not (0 < x1 - x0 <= 2000 and 0 < y1 - y0 <= 2000): raise ValueError('용도지역 범위는 2km 이내로 정하세요.')
    to_geo, to_crs = korea_crs.transformer(crs, 'EPSG:4326'), korea_crs.transformer('EPSG:4326', crs)
    corners = [to_geo.transform(X, Y) for X, Y in ((x0, y0), (x1, y0), (x0, y1), (x1, y1))]
    lons, lats = [p[0] for p in corners], [p[1] for p in corners]
    config, _ = request(BASE + '/api/vworld', authenticated=True)
    referer = 'https://' + str(config['domain']).removeprefix('https://').strip('/') + '/'
    window = sbox(x0, y0, x1, y1)
    def layer(name):
        params = {'service': 'data', 'request': 'GetFeature', 'data': name, 'key': config['key'], 'domain': config['domain'], 'format': 'json',
                  'geometry': 'true', 'size': 1000, 'page': 1, 'crs': 'EPSG:4326', 'geomFilter': f'BOX({min(lons)},{min(lats)},{max(lons)},{max(lats)})'}
        try:
            raw, _ = request('https://api.vworld.kr/req/data?' + urllib.parse.urlencode(params), extra_headers={'Referer': referer})
        except ValueError as error:
            return name, [], str(error)
        response = raw.get('response') or {}
        if response.get('status') == 'NOT_FOUND': return name, [], ''
        if response.get('status') != 'OK': return name, [], str((response.get('error') or {}).get('text') or response.get('status'))
        return name, ((response.get('result') or {}).get('featureCollection') or {}).get('features') or [], ''
    with ThreadPoolExecutor(6) as pool:
        results = list(pool.map(layer, [n for names in ZONING_LAYERS.values() for n in names]))
    kind_of = {n: k for k, names in ZONING_LAYERS.items() for n in names}
    zones, warnings = [], []
    failed = {k: [] for k in ZONING_LAYERS}   # 종류별로 받지 못한 레이어 — 화면이 "자료 없음"과 "받지 못함"을 가른다(2026-10-22 검토)
    for name, features, error in results:
        if error: warnings.append(f'{name}: {error}'); failed[kind_of[name]].append(name)
        for feature in features:
            props, geometry = feature.get('properties') or {}, feature.get('geometry') or {}
            try:
                g = shape({'type': geometry.get('type'), 'coordinates': geometry.get('coordinates')})
                from shapely.ops import transform as stransform
                g = stransform(lambda X, Y, Z=None: to_crs.transform(X, Y), g).intersection(window)
            except Exception:
                continue
            if g.is_empty or g.area <= 0: continue
            parts = list(g.geoms) if hasattr(g, 'geoms') else [g]
            rings = [[[[round((X - origin[0]) * 1000, 1), round((Y - origin[1]) * 1000, 1)] for X, Y in list(r.coords)[:-1]] for r in [p.exterior, *p.interiors]]
                     for p in parts if p.geom_type == 'Polygon']
            if not rings: continue
            label = str(props.get('uname') or props.get('dgm_nm') or props.get('atr_nam') or props.get('riv_nm') or '').strip()[:60]
            zones.append({'kind': kind_of[name], 'layer': name, 'name': label, 'group': FACILITY_GROUPS.get(name, ''),
                          'detail': str(props.get('atr_nam') or props.get('mls_nam') or props.get('cat_nam') or '')[:40], 'year': str(props.get('dyear') or '')[:4], 'polygons': rings})
    return {'zones': zones, 'counts': {k: sum(z['kind'] == k for z in zones) for k in ZONING_LAYERS}, 'warnings': warnings, 'failed': failed,
            'attribution': '브이월드 2D 데이터(국토교통부 도시계획정보)'}

def process(data):
    global _cookie
    action=data.get('action')
    if action=='union': return union(data)
    if action=='status':
        if not signed_in(): return {'connected':False,'service':BASE,'message':LOGIN_GUIDE}
        try:
            request(BASE + '/api/vworld', authenticated=True)
            profile = {}
            try:
                info, _ = request(BASE + '/api/office/info', authenticated=True)
                profile = {'officeName': (info.get('office') or {}).get('name', ''), 'userName': info.get('userName') or ''}
            except ValueError:
                pass
            return {'connected':True,'service':BASE,**profile}
        except ValueError as error:
            # 로그인은 이 PC 에 있다 — 서버가 거절한 것이지 로그인이 없는 게 아니다(공개 기간 서버는 404).
            message=str(error)
            if '(404)' in message: message='로그인은 되어 있습니다. 바른 서버가 아직 이 기능을 열지 않았습니다(서버 업데이트 필요, 404).'
            return {'connected':False,'signedIn':True,'service':BASE,'message':message}
    if action=='login': return login(data)
    if action=='logout':
        _cookie='';SESSION.unlink(missing_ok=True);return {'connected':False}
    if action=='search': return search(data.get('query',''))
    if action=='fetch': return fetch(data)
    if action=='ledger': return ledger(data.get('pnu',''))
    if action=='basemap': return basemap(data)
    if action=='surroundings': return surroundings(data)
    if action=='market': return market(data)
    if action=='zoning': return zoning(data)
    if action=='use-recommend': return use_recommend(data)
    raise ValueError('지원하지 않는 토지 연결 작업입니다.')

# ── 아파트 검토(6.0.9 → 7.x, 2026-10-19): 가두리(PL) 범위 필지·용도지역 면 조회 ──
FEATURE_PAGE=100            # VWorld GetFeature 한 번 최대

BOX_MAX_PARCELS=2000        # 가두리 하나에 받는 필지 상한(메모리·요청 수 보호)

_ZONE_CACHE={}              # pnu → {'zones','zoneNames'} (프로세스 수명 동안)

def features_in_box(config, bbox, size=FEATURE_PAGE, max_total=BOX_MAX_PARCELS, depth=0):
    """bbox(lon,lat 4326: minx,miny,maxx,maxy) 안 필지 전부. 1페이지 100개 한도를 page 로 넘기고,
    page 가 안 먹으면(2쪽이 1쪽과 같음) 사각형을 4조각으로 쪼개 다시 묻는다(최대 6단 = 4096조각)."""
    minx,miny,maxx,maxy=bbox
    box=f'BOX({minx},{miny},{maxx},{maxy})'
    out={};page=1
    while True:
        rows=features(config,{'geomFilter':box,'page':page},size)
        keys=[str((f.get('properties') or {}).get('pnu'))+'/'+str(i) for i,f in enumerate(rows)]
        new=[f for f in rows if str((f.get('properties') or {}).get('pnu')) not in out]
        if page>1 and not new:
            break                                    # page 를 무시하는 서버 → 타일 분할로
        for f in new: out[str((f.get('properties') or {}).get('pnu'))]=f
        if len(rows)<size: return list(out.values())
        if len(out)>=max_total: raise ValueError(f'가두리 안 필지가 {max_total}개를 넘습니다. 범위를 줄이세요.')
        page+=1
        if page>max_total//size+1: break
    if depth>=6: return list(out.values())
    mx,my=(minx+maxx)/2,(miny+maxy)/2
    for sub in ((minx,miny,mx,my),(mx,miny,maxx,my),(minx,my,mx,maxy),(mx,my,maxx,maxy)):
        for f in features_in_box(config,sub,size,max_total,depth+1):
            out[str((f.get('properties') or {}).get('pnu'))]=f
        if len(out)>max_total: raise ValueError(f'가두리 안 필지가 {max_total}개를 넘습니다. 범위를 줄이세요.')
    return list(out.values())

def feature_polygons_m(feature):
    """VWorld 필지 → [(shapely Polygon in EPSG:5179 m, props)] (구멍 포함)."""
    from shapely.geometry import Polygon
    transform=korea_crs.transformer('EPSG:4326','EPSG:5179')
    props=feature.get('properties') or {}
    out=[]
    for polygon in rings(feature):
        shells=[]
        for ring in polygon:
            pts=[]
            for lon,lat,*_ in ring:
                if not (120<=lon<=140 and 30<=lat<=45): raise ValueError('대한민국 위경도 범위가 아닙니다.')
                pts.append(transform.transform(lon,lat))
            shells.append(pts)
        if len(shells[0])<3: continue
        g=Polygon(shells[0],[s for s in shells[1:] if len(s)>=3])
        if not g.is_valid: g=g.buffer(0)
        if not g.is_empty: out.append((g,props))
    return out

ZONE_LAYER_ID='LT_C_UQ111'     # VWorld 용도지역(도시지역) 면 — 한 번의 범위 조회로 가두리 안 지역 조각을 얻는다

def zone_polygons_in_box(config, bbox):
    """용도지역 면(LT_C_UQ111)을 bbox 로 한 번에 → [(Polygon 5179 m, 지역명)]. 레이어가 막혀 있으면 ValueError(호출자가 pnu 별 조회로 대체)."""
    minx,miny,maxx,maxy=bbox
    feats=features(config,{'geomFilter':f'BOX({minx},{miny},{maxx},{maxy})','data':ZONE_LAYER_ID},FEATURE_PAGE)
    out=[]
    for f in feats:
        props=f.get('properties') or {}
        name=str(props.get('uname') or props.get('dgm_nm') or props.get('prpos_area_dstrc_nm') or '').strip()
        if not name: continue
        for g,_ in feature_polygons_m(f): out.append((g,name))
    if not out: raise ValueError('용도지역 레이어에서 면을 받지 못했습니다.')
    return out

def zone_lookup(pnu, config):
    """토지이용정보(용도지역)만 가볍게 — 미리보다 법규 검토 호출 없음. 결과는 _ZONE_CACHE 에."""
    if pnu in _ZONE_CACHE: return _ZONE_CACHE[pnu]
    params={'key':config['key'],'domain':config['domain'],'pnu':pnu,'format':'json','numOfRows':100,'pageNo':1}
    raw,_=request('https://api.vworld.kr/ned/data/getLandUseAttr?'+urllib.parse.urlencode(params),
        extra_headers={'Referer':'https://'+str(config['domain']).removeprefix('https://').strip('/')+'/'})
    uses=raw.get('landUses') or {}
    if uses.get('resultCode'): raise ValueError('토지이용정보 조회 실패: '+str(uses.get('resultMsg') or uses['resultCode']))
    rows=uses.get('field') or []
    if isinstance(rows,dict): rows=[rows]
    zones=[{'code':r.get('prposAreaDstrcCode',''),'name':r.get('prposAreaDstrcCodeNm',''),'relation':r.get('cnflcAtNm','')} for r in rows]
    names=list(dict.fromkeys(z['name'] for z in zones if z['name'] and z['code'].startswith('UQA') and z['relation']!='접함'))
    info={'pnu':pnu,'zones':zones,'zoneNames':names}
    _ZONE_CACHE[pnu]=info
    return info

def zones_by_pnu(pnus, config=None, workers=3):
    """여러 필지 용도지역을 작은 동시성(기본 3)으로. 실패는 {'error'} 로 돌려주고 예외를 던지지 않는다."""
    from concurrent.futures import ThreadPoolExecutor
    pnus=list(dict.fromkeys(str(p) for p in pnus if p))
    if not pnus: return {}
    config=config or request(BASE+'/api/vworld',authenticated=True)[0]
    def one(pnu):
        try: return pnu,zone_lookup(pnu,config)
        except (ValueError,KeyError,TypeError) as error: return pnu,{'pnu':pnu,'error':str(error),'zones':[],'zoneNames':[]}
    with ThreadPoolExecutor(max(1,min(workers,8))) as ex:
        return dict(ex.map(one,pnus))
