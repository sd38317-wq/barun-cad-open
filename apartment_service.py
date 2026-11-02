"""아파트 검토 — 바른 CAD 도면의 대지(필지 1~10개)·용도지역을 읽어 설계엔진 `apartment/site_zones` 로 1단계(면적·구역) 계산.

도면 좌표는 `대지 가져오기` 가 넣은 EPSG:5179 투영 mm 라 그대로 m 로 바꿔 쓴다(면적 왜곡 ≤0.1%).
용도지역은 필지 attributes.landInfo.zones(VWorld UQA 코드, '접함' 제외). 한 필지가 두 지역이면 사용자가
'용도지역' 레이어에 점선(열린 폴리라인)과 글자(지역 이름)를 그려 조각을 나눈다.
엔진 위치는 BARUN_APARTMENT_DIR (개발 기본값 D:\\어플\\설계엔진\\apartment). 배포 때 번들로 옮긴다.
"""
import os
import sys
import threading
import time
import uuid
from pathlib import Path

ENGINE_DIR = Path(os.environ.get('BARUN_APARTMENT_DIR') or (Path.home() / 'dev' / '설계엔진' / 'apartment' if sys.platform == 'darwin' else r'D:\어플\설계엔진\apartment'))
ZONE_LAYER = '용도지역'


def _engine():
    if not (ENGINE_DIR / 'site_zones.py').is_file():
        raise ValueError(f'아파트 엔진을 찾지 못했습니다: {ENGINE_DIR}')
    if str(ENGINE_DIR) not in sys.path:
        sys.path.insert(0, str(ENGINE_DIR))
    import site_zones
    return site_zones


def engine_local():
    """[2026-10-18 사장님] 빠른·정밀 검토는 늘 배치 엔진 서버(맥미니)에서 — 로그인한 누구나 같은 엔진.
    이 PC 계산은 개발 시험용으로 BARUN_APARTMENT_LOCAL=1 을 켰을 때만(설계엔진 아파트 폴더도 있어야 함)."""
    if os.environ.get('BARUN_APARTMENT_LOCAL') != '1':
        return False
    return all((ENGINE_DIR / f).is_file() for f in ('site_zones.py', 'target_plan.py', 'maxfar.py'))


class _ServerZones:
    """로컬 엔진이 없을 때 enclose 의 용도지역 묶음(site_zones.split_zones 대신, 서버 검토용).
    조례 건폐·용적은 서버 규칙표(/rules/busan, 엔진 Rules.zoning 과 같은 대지면적 구간), 84조 판정은 하지 않고 조각별 각자로 둔다(확인필요).
    한 필지에 지역이 둘이면 점선 나누기 대신 '용도지역' 레이어 묶음 PL 로 나눠야 한다."""
    def __init__(self):
        import parcel_service
        rules, _ = parcel_service.request(parcel_service.BASE + '/rules/busan', authenticated=True)
        self.zoning = (rules or {}).get('zoning') or {}

    def _zoning(self, zone, site_area):
        z = self.zoning.get(zone)
        if not isinstance(z, dict) or 'far' not in z or 'bcr' not in z:
            raise ValueError(f"서버 규칙표에 '{zone}' 이 없습니다 — 용도지역을 확인하세요.")
        far = float(z['far'])
        for row in sorted(z.get('far_by_site_area') or [], key=lambda r: float(r.get('site_area_max', 1e12))):
            if site_area <= float(row.get('site_area_max', 1e12)) + 1e-6:
                far = float(row['far'])
                break
        return float(z['bcr']), far

    def split_zones(self, parcels, zone_lines=None, zone_labels=None, strip_commercial=False):
        from shapely.geometry import Polygon
        from shapely.ops import unary_union
        by = {}
        for p in parcels:
            zs = [z for z in p.get('zones', []) if z]
            if len(zs) != 1:
                raise ValueError(f"{p.get('pnu', '?')}: 한 필지에 용도지역 {len(zs)}개 — 점선 나누기는 로컬 아파트 엔진이 있어야 합니다. "
                                 "'용도지역' 레이어에 닫힌 묶음 PL 과 지역 이름 글자로 나누세요.")
            g = Polygon(p['coords']).buffer(0)
            by[zs[0]] = unary_union([by[zs[0]], g]) if zs[0] in by else g
        site = unary_union(list(by.values())).buffer(0)
        if site.geom_type != 'Polygon':
            raise ValueError('필지들이 한 덩어리로 붙어 있지 않습니다 (합필 불가)')
        rows = []
        for z, g in sorted(by.items(), key=lambda t: -t[1].area):
            if g.geom_type != 'Polygon':
                raise ValueError(f"'{z}' 조각이 떨어져 있습니다 — '용도지역' 레이어 묶음 PL 로 조각을 나누세요.")
            bcr, far = self._zoning(z, site.area)
            rows.append({'zone': z, 'area_m2': round(g.area, 2), 'share': round(g.area / site.area, 4), 'bcr': bcr, 'far': far,
                         'provisional': {'bcr': False, 'far': False}, 'poly': [[round(x, 3), round(y, 3)] for x, y in g.exterior.coords[:-1]]})
        multi = len(rows) > 1
        return {'mode': 'separate' if multi else 'single', 'site_area_m2': round(site.area, 2), 'parts': rows,
                'zoning': {'zone': rows[0]['zone'], 'bcr': rows[0]['bcr'], 'far': rows[0]['far']},
                'site': [[round(x, 3), round(y, 3)] for x, y in site.exterior.coords[:-1]],
                'warnings': ['건폐·용적은 서버 규칙표(/rules/busan) 값 — 조례 원문 확인 필요'],
                'basis': ['84조 판정은 로컬 아파트 엔진에서 — 서버 검토는 조각마다 각자 적용(확인필요)'] if multi else []}

    def table(self, res):
        L = [f"대지(지적) {res['site_area_m2']:,.1f}㎡ · 판정 {res['mode']} (서버 규칙표)"]
        L += [f"  {r['zone']:<12} {r['area_m2']:>10,.1f}㎡ {r['share'] * 100:5.1f}%  건폐 {r['bcr']:g}%  용적 {r['far']:g}%" for r in res['parts']]
        return '\n'.join(L + ['  ' + b for b in res['basis']] + ['  ! ' + w for w in res['warnings']])


def _flat(entities):
    out = []
    def visit(e):
        if e.get('type') == 'block' and e.get('parcelGroup'):
            for child in e.get('entities', []): visit(child)
        else: out.append(e)
    for e in entities or []: visit(e)
    return out


FRAME_CRS = ('EPSG:5179', 'EPSG:5187')


class Frame:
    """CAD mm ↔ EPSG:5179 m. `대지 가져오기`는 첫 필지 첫 점을 originMetres 로 두고 mm 상대 좌표를 넣는다(parcel_service.drawing).
    계획 탭 ③ 주변 지적도는 EPSG:5187 로 그린다(A30) — 그때는 도면 m(5187) 를 5179 로 바꿔 계산하고, 돌려 그릴 때 되돌린다."""
    def __init__(self, site=None):
        a = (site or {}).get('attributes', {})
        o = a.get('originMetres')
        self.crs = 'EPSG:5179'; self._to = self._back = None
        if site and isinstance(o, list) and len(o) == 2 and a.get('sourceCRS') in FRAME_CRS:
            self.ox, self.oy = float(o[0]), float(o[1]); self.ax, self.ay = float(site['points'][0]['x']), float(site['points'][0]['y'])
            self.set_crs(a['sourceCRS'])
        else:
            self.ox = self.oy = self.ax = self.ay = 0.0
    def set_crs(self, crs):
        self.crs = crs or 'EPSG:5179'
        if self.crs != 'EPSG:5179':
            import korea_crs
            self._to = korea_crs.transformer(self.crs, 'EPSG:5179'); self._back = korea_crs.transformer('EPSG:5179', self.crs)
        return self
    def _m(self, x, y):
        mx, my = self.ox + (x - self.ax) / 1000.0, self.oy + (y - self.ay) / 1000.0
        return list(self._to.transform(mx, my)) if self._to else [mx, my]
    def m(self, points):
        return [self._m(p['x'], p['y']) for p in points]
    def xy_m(self, p):
        return self._m(p.get('x', 0), p.get('y', 0))
    def mm(self, x, y):
        if self._back:
            x, y = self._back.transform(x, y)
        return {'x': self.ax + (x - self.ox) * 1000.0, 'y': self.ay + (y - self.oy) * 1000.0}


def zone_names(info):
    zones = (info or {}).get('zones') or []
    names = [z.get('name', '') for z in zones if str(z.get('code', '')).startswith('UQA') and z.get('relation') != '접함' and z.get('name')]
    if not names:
        names = [n for n in (info or {}).get('zoneNames', []) if n]
    return list(dict.fromkeys(names))


def parcels(entities, frame):
    sites = [e for e in entities if e.get('parcelRole') == 'site' and e.get('type') == 'polyline' and e.get('closed')]
    if not sites:
        raise ValueError('대지 경계가 없습니다. 주소로 대지를 먼저 가져오세요.')
    if any(e.get('attributes', {}).get('ring') == 'hole' for e in sites):
        raise ValueError('내부 구멍이 있는 필지는 아직 지원하지 않습니다.')
    out = []
    for e in sites:
        a = e.get('attributes', {})
        out.append({'pnu': a.get('pnu', ''), 'jibun': a.get('jibun', ''), 'coords': frame.m(e['points']), 'zones': zone_names(a.get('landInfo')), 'info': a.get('landInfo')})
    return out


def zone_marks(entities, layers, frame):
    ids = {l['id'] for l in layers or [] if l.get('name') == ZONE_LAYER}
    lines, labels = [], []
    for e in entities:
        if e.get('layer') not in ids:
            continue
        if e.get('type') == 'polyline' and len(e.get('points', [])) >= 2:
            pts = frame.m(e['points'])
            lines.append(pts + [pts[0]] if e.get('closed') else pts)
        elif e.get('type') == 'text' and e.get('text', '').strip():
            p = e.get('position') or {}
            labels.append({'xy': frame.xy_m(p), 'name': e['text'].strip()})
    return lines, labels


ZONE_SHORT = [(r'^(제)?([12])종전용', lambda m: f'제{m.group(2)}종전용주거지역'), (r'^(제)?([123])종', lambda m: f'제{m.group(2)}종일반주거지역'),
              (r'^준주거', lambda m: '준주거지역'), (r'^(일반|중심|근린|유통)상업', lambda m: m.group(1) + '상업지역'), (r'^(전용|일반|준)공업', lambda m: m.group(1) + '공업지역'),
              (r'^(보전|생산|자연)녹지', lambda m: m.group(1) + '녹지지역'), (r'^자연환경보전', lambda m: '자연환경보전지역')]
ZONE_CHOICES = ['제3종일반주거지역', '제2종일반주거지역', '준주거지역', '일반상업지역', '근린상업지역', '중심상업지역', '제1종일반주거지역', '준공업지역', '자연녹지지역']


def zone_full(name):
    """짧게 쓴 용도지역 이름('일반상업', '3종일반', '제3종일반주거') → 정식 이름. 모르면 그대로.
    지난 검토가 '용도지역' 레이어에 그린 글자('묶음 1 · 일반상업지역 · 66,601㎡')도 받는다 — 다시 돌리면 그 묶음을 사용자 묶음으로 읽기 때문."""
    import re
    m = re.match(r'^\s*묶음\s*\d+\s*·\s*([^·]+)', str(name or ''))
    if m:
        name = m.group(1).strip()
    s = re.sub(r'\s+', '', str(name or '')).replace('지역', '')
    for pat, fn in ZONE_SHORT:
        m = re.match(pat, s)
        if m:
            return fn(m)
    return str(name or '').strip() if str(name or '').strip().endswith('지역') else (s + '지역' if s else '')


def _zone_groups(entities, layers, frame):
    """'용도지역' 레이어의 닫힌 PL(묶음) + 안의 글자 → [{'no', 'zone', 'raw', 'poly', 'id'}] (면적 큰 순 번호)."""
    from shapely.geometry import Polygon, Point
    ids = {l['id'] for l in layers or [] if l.get('name') == ZONE_LAYER}
    polys, labels = [], []
    for e in entities:
        if e.get('layer') not in ids:
            continue
        if e.get('type') == 'polyline' and e.get('closed') and len(e.get('points', [])) >= 3:
            g = Polygon(frame.m(e['points']))
            if not g.is_valid:
                g = g.buffer(0)
            if not g.is_empty:
                polys.append((g, e.get('id')))
        elif e.get('type') == 'text' and e.get('text', '').strip():
            labels.append((Point(frame.xy_m(e.get('position') or {})), e['text'].strip()))
    out = []
    for g, eid in sorted(polys, key=lambda t: -t[0].area):
        inside = [n for pt, n in labels if g.contains(pt)]
        if not inside:
            continue
        out.append({'no': len(out) + 1, 'zone': zone_full(inside[0]), 'raw': inside[0], 'poly': g, 'id': eid, 'area_m2': round(g.area, 1)})
    return out


def zone_suggest(data):
    """[용도지역 자동 그리기] — VWorld 용도지역 면 ∩ 가두리 PL 을 '용도지역' 레이어용 닫힌 PL + 글자로 돌려준다(사용자가 고쳐 쓰는 초안)."""
    from shapely.geometry import Polygon
    import parcel_service
    import korea_crs   # 설치판엔 pyproj 가 없다(7.0.14 부터 korea_crs 로 바꿈)
    ents = _flat(data.get('entities'))
    frame = _frame_of(ents)
    pl = Polygon(frame.m(data.get('pl') or [])).buffer(0)
    if pl.is_empty:
        raise ValueError('가두리 PL 이 필요합니다.')
    config, _ = parcel_service.request(parcel_service.BASE + '/api/vworld', authenticated=True)
    tr = korea_crs.transformer('EPSG:5179', 'EPSG:4326')
    bx = pl.bounds; lon0, lat0 = tr.transform(bx[0], bx[1]); lon1, lat1 = tr.transform(bx[2], bx[3])
    zone_polys = parcel_service.zone_polygons_in_box(config, (min(lon0, lon1), min(lat0, lat1), max(lon0, lon1), max(lat0, lat1)))
    by = {}
    for g, name in zone_polys:
        cut_ = g.intersection(pl)
        if cut_.area > 1:
            by[name] = by[name].union(cut_) if name in by else cut_
    draw = []; groups = []
    h = _text_h(pl)
    for name, g in sorted(by.items(), key=lambda t: -t[1].area):
        for gg in (g.geoms if hasattr(g, 'geoms') else [g]):
            if gg.geom_type != 'Polygon' or gg.area < 1:
                continue
            c = gg.representative_point()
            draw.append({'type': 'polyline', 'closed': True, 'points': [frame.mm(x, y) for x, y in gg.exterior.coords[:-1]], 'apartmentLayer': ZONE_LAYER, 'apartmentZone': 'zone-suggest'})
            draw.append({'type': 'text', 'text': name, 'position': frame.mm(c.x, c.y), 'height': h, 'rotation': 0, 'apartmentLayer': ZONE_LAYER, 'apartmentZone': 'zone-suggest'})
            groups.append({'zone': name, 'area_m2': round(gg.area, 1)})
    if not groups:
        raise ValueError('가두리 안에서 용도지역 면을 찾지 못했습니다.')
    return {'draw': draw, 'groups': groups, 'source': 'vworld-layer ' + parcel_service.ZONE_LAYER_ID}


def zones(data):
    sz = _engine()
    ents = _flat(data.get('entities'))
    first = next((e for e in ents if e.get('parcelRole') == 'site' and e.get('type') == 'polyline' and e.get('attributes', {}).get('ring') != 'hole'), None)
    frame = Frame(first)
    ps = parcels(ents, frame)
    lines, labels = zone_marks(ents, data.get('layers'), frame)
    res = sz.split_zones(ps, lines or None, labels or None, bool(data.get('stripCommercial')))
    table = sz.table(res)
    draw = []
    terr = None
    try:
        import terrain
        terr = terrain.site_terrain(res['site'], 'EPSG:5179')
        table += (f"\n경사: 표고 {terr['elev_min']}~{terr['elev_max']}m (고저차 {terr['range_m']}m) · 평균 경사 {terr['slope_pct']}% · 내리막 방위 {terr['downhill_deg']:.0f}°"
                  f"\n  {terr['source']}")
        for c in terr['contours']:
            for ln in c['lines']:
                draw.append({'type': 'polyline', 'closed': False, 'points': [frame.mm(x, y) for x, y in ln], 'apartmentLayer': '등고선', 'apartmentZone': f"z{c['z']:g}"})
                x, y = ln[0]
                draw.append({'type': 'text', 'text': f"{c['z']:g}", 'position': frame.mm(x, y), 'height': 600, 'rotation': 0, 'apartmentLayer': '등고선', 'apartmentZone': f"z{c['z']:g}"})
    except Exception as error:  # noqa: BLE001 — DEM 없음·범위 밖이면 경사 없이 진행
        table += f"\n경사: 조회 못 함 ({error})"
    for i, part in enumerate(res['parts']):
        pts = [frame.mm(x, y) for x, y in part['poly']]
        draw.append({'type': 'polyline', 'closed': True, 'points': pts, 'apartmentZone': part['zone']})
        cx = sum(p['x'] for p in pts) / len(pts); cy = sum(p['y'] for p in pts) / len(pts)
        draw.append({'type': 'text', 'text': f"{part['zone']} {part['area_m2']:,.1f}㎡ · 건폐 {part['bcr']:g}% 용적 {part['far']:g}%",
                     'position': {'x': cx, 'y': cy}, 'height': 1200, 'rotation': 0, 'apartmentZone': part['zone']})
    # 지구(고도·지구단위 등) 경고 — 토지이용정보의 지역 외 항목
    districts = sorted({z.get('name', '') for p in ps for z in ((p.get('info') or {}).get('zones') or []) if z.get('relation') != '접함' and not str(z.get('code', '')).startswith('UQA') and z.get('name')})
    for name in districts:
        if '고도' in name:
            table += f"\n! {name}: 최고높이 값을 '높이제한(m)'에 넣어야 층수 상한이 잡힘"
        elif '지구단위' in name:
            table += f"\n! {name}: 세부 결정도서의 건축선·높이·용적 지침 별도 확인"
    # 높이제한·인센티브 → 법정 용적·건폐·높이
    inc = None
    sel = data.get('incentives') or {}
    hl = data.get('heightLimit')
    if sel or hl:
        import incentive
        zg = res['zoning']; extra = data.get('siteExtra') or {}
        base = {'bcr': zg['bcr'] / 100.0, 'far': zg['far'] / 100.0, 'height': float(hl) if hl else None}
        st = {'area_m2': res['site_area_m2'], 'zone': zg['zone'], 'gfa_m2': zg['far'] / 100.0 * res['site_area_m2'], 'use': '공동주택',
              **{k: float(v) for k, v in extra.items() if v not in (None, '')}}
        try:
            r = incentive.apply(base, st, sel)
            L = r['legal']
            inc = {'far_pct': round(L['far'] * 100, 1), 'bcr_pct': round(L['bcr'] * 100, 1), 'height_m': (round(L['height'], 1) if L.get('height') is not None else None),
                   'far_pct_sum': round(r['far'] * 100, 1), 'applied': [it['name'] for it in r['items'] if it['applied']], 'warnings': r['warnings']}
            scale = (L['far'] * 100) / zg['far'] if zg['far'] else 1.0
            for part in res['parts']:
                part['far_base'] = part['far']; part['far'] = round(part['far'] * scale, 2)
                part['bcr_base'] = part['bcr']; part['bcr'] = round(min(part['bcr'] * ((L['bcr'] * 100) / zg['bcr'] if zg['bcr'] else 1.0), 100), 2)
            res['zoning'] = {**zg, 'far_base': zg['far'], 'far': inc['far_pct'], 'bcr_base': zg['bcr'], 'bcr': inc['bcr_pct']}
            table += f"\n인센티브: 용적 {zg['far']:g}% → {inc['far_pct']:g}% (법정 상한 적용; 단순 합산 {inc['far_pct_sum']:g}%) · 건폐 {zg['bcr']:g}% → {inc['bcr_pct']:g}%"
            if inc['height_m'] is not None:
                table += f" · 높이 {float(hl):g}m → {inc['height_m']:g}m"
            if inc['applied']:
                table += "\n  적용: " + ', '.join(inc['applied'])
            for it in r['items']:
                if not it['applied'] and sel.get(it['id']) not in (None, False, '미적용'):
                    table += f"\n  미적용: {it['name']} — {it.get('reason') or '조건 미충족'}"
            for w in r['warnings']:
                table += "\n  ! " + w
        except ValueError as error:
            table += f"\n인센티브: 계산 못 함 ({error})"
    elif hl:
        inc = {'height_m': float(hl)}
    return {'result': res, 'table': table, 'draw': draw, 'terrain': ({k: v for k, v in terr.items() if k != 'contours'} if terr else None),
            'incentive': inc, 'height_limit_m': (inc or {}).get('height_m') if inc else (float(hl) if hl else None),
            'parcels': [{'pnu': p['pnu'], 'jibun': p['jibun'], 'zones': p['zones']} for p in ps]}


def place(data):
    """동 배치 3안 — zones() 와 같은 입력 + floors. 결과 동 폴리곤은 CAD mm 로 돌려준다."""
    z = zones(data)
    _engine()
    import placement
    floors = int(data.get('floors') or 15)
    if not 5 <= floors <= 60:
        raise ValueError('층수는 5~60 사이로 입력하세요.')
    floor_h = 2.9; note = ''
    hl = z.get('height_limit_m')
    if hl:
        cap = int(hl // floor_h)
        if cap < floors:
            note = f"높이제한 {hl:g}m → 층수 {floors} → {cap} (층고 {floor_h}m)"; floors = max(cap, 1)
    ents = _flat(data.get('entities'))
    first = next((e for e in ents if e.get('parcelRole') == 'site' and e.get('type') == 'polyline' and e.get('attributes', {}).get('ring') != 'hole'), None)
    frame = Frame(first)
    blocks = placement.load_blocks(max_units=int(data.get('maxUnitsPerFloor') or 8), floors=floors)
    zone = z['result']['zoning']['zone']
    roads = [frame.m(e['points']) for e in ents if e.get('parcelRole') == 'road' and e.get('type') == 'polyline' and e.get('closed') and len(e.get('points', [])) >= 3]
    import highrise, elevator
    hr = highrise.review(floors, floor_h)
    evr = elevator.elevators_required(floors, height_m=hr['height_m'])
    note += ("\n" if note else '') + f"승강기 {evr['count']}대(법정 최소 {evr['legal_min']}) · " + ' / '.join(evr['reasons'][-1:])
    if hr['class'] != '일반':
        note += f"\n{hr['class']}({floors}층·{hr['height_m']}m): 피난안전구역 {hr['refuge_floors']}개 층(층 {hr['refuge_positions']}) → 세대 층수 {hr['unit_floors']}\n  " + '\n  '.join(hr['notes'])
    plans = placement.three_plans(z['result']['parts'], blocks, floors,
                                  {'zone': zone, 'redevelopment': bool(data.get('redevelopment')), 'north_exempt': bool(data.get('northExempt')), 'roads': roads,
                                   'unit_floors': hr['unit_floors']})
    out = []
    for i, p in enumerate(plans):
        t = p['totals']
        draw = []
        for b in p['buildings']:
            pts = [frame.mm(x, y) for x, y in b['poly']]
            draw.append({'type': 'polyline', 'closed': True, 'points': pts, 'apartmentLayer': '아파트-배치', 'apartmentZone': f"plan{i+1}"})
            cx = sum(q['x'] for q in pts) / len(pts); cy = sum(q['y'] for q in pts) / len(pts)
            draw.append({'type': 'text', 'text': f"{b['id']} {b['block']} {b['units_per_floor']}세대×{b['floors']}F", 'position': {'x': cx, 'y': cy}, 'height': 900, 'rotation': 0, 'apartmentLayer': '아파트-배치', 'apartmentZone': f"plan{i+1}"})
        summary = (f"{p['title']} · 동 {t['buildings']} · 세대 {t['units']} · 용적 {t['far_pct']}% · 건폐 {t['bcr_pct']}%"
                   f" · 인동·일조 {'통과' if p['checks_ok'] else '불통 ' + str(len(p['checks_failed']))}")
        out.append({'title': p['title'], 'summary': summary, 'totals': t, 'angle_deg': p['angle_deg'], 'draw': draw,
                    'buildings': [{k: v for k, v in b.items() if k != 'poly'} for b in p['buildings']], 'warnings': p['warnings']})
    return {'zones': {'table': z['table'] + ("\n" + note if note else ''), 'result': z['result']}, 'floors': floors, 'unit_floors': hr['unit_floors'], 'highrise': hr, 'elevators': evr, 'plans': out}


# =====================================================================================================
# 가두리(PL) 흐름 — 대표 2026-10-02: "필지 불러와 200m → PL 로 가두리 → 알아서 필지 검토 → 인센티브 최대 → 계산표 → 용적 최대 배치"
# 결과는 전부 도면 글자(미리보기 레이어)로 적는다. 패널은 단추와 같은 숫자만.
# =====================================================================================================
PREVIEW_LAYER = '아파트-검토'          # 임시(재실행 때 지워짐)
PLAN_LAYER = '아파트-배치'             # [이 안 그리기] 로만 영구
PUBLIC_JIMOK = {'도': '도로', '도로': '도로', '구': '구거', '천': '하천', '제': '제방', '철': '철도용지', '공': '공원', '유': '유지', '수': '수도용지', '학': '학교용지', '사': '사적지', '묘': '묘지'}
FLOOR_H = 2.9
# 인센티브 항목 분류 — 소유자 약속(가정)으로 자동 적용하는 것과 값이 있어야 되는 것
ASSUMED_ITEMS = {'green_building_cert': '1+/최우수', 'zero_energy': None, 'long_life_housing': '최우수', 'remodeling_ready': {'tier': '90점 이상'},
                 'intelligent_building': '1등급', 'recycled_material': None, 'green_pilot_project': '대상'}
AUTO_ITEMS = ('road_frontage',)
NEEDS_VALUE = {'public_facility_land': '기부채납(공공시설 제공) 면적', 'open_space_building_act': '공개공지 면적', 'open_space_district_plan': '공개공지 면적(지구단위)',
               'bcr_reduction': '계획 건폐율', 'landscape_upgrade': '조경 면적', 'open_space_upper': '공개공지 면적(주거복합)', 'block_development': '주거복합만',
               'flexible_structure': '주거복합만', 'street_building_link': '주거복합만', 'block_guideline_height': '가로구역 지침 높이(m)'}
EXTRA_RULE_FILES = ('rules.incentive_redevelopment.json', 'rules.incentive_extra.json')   # 다른 에이전트 작성 중 — 있으면 읽는다


def _frame_of(ents):
    """site 가 없어도(가두리 안에 site 가 없을 수도) originMetres 가 있는 아무 필지로 좌표계를 잡는다."""
    first = next((e for e in ents if e.get('parcelRole') == 'site' and e.get('type') == 'polyline' and e.get('attributes', {}).get('ring') != 'hole'), None)
    if first is None:
        first = next((e for e in ents if e.get('type') == 'polyline' and isinstance(e.get('attributes', {}).get('originMetres'), list)), None)
    if first is None:
        raise ValueError('지적 필지가 없습니다. 주소로 대지를 먼저 가져오세요(주변 범위 200m 권장).')
    fr = Frame(first)
    ins = first.get('attributes', {}).get('insertionMm')
    if isinstance(ins, list) and len(ins) == 2 and first.get('parcelRole') != 'site':
        fr.ax, fr.ay = float(ins[0]), float(ins[1])
    return fr


def _frame_dict(fr):
    return {'ox': fr.ox, 'oy': fr.oy, 'ax': fr.ax, 'ay': fr.ay, 'crs': fr.crs}


def _frame_from(d):
    fr = Frame(None)
    if d:
        fr.ox, fr.oy, fr.ax, fr.ay = float(d['ox']), float(d['oy']), float(d['ax']), float(d['ay'])
        fr.set_crs(d.get('crs') if d.get('crs') in FRAME_CRS else 'EPSG:5179')
    return fr


def _text_h(site_poly):
    """글자 높이(mm): 대지 크기에 비례, 0.8~6m."""
    minx, miny, maxx, maxy = site_poly.bounds
    return float(max(800.0, min(6000.0, max(maxx - minx, maxy - miny) * 1000 / 50)))


def _text(frame, x, y, text, h, tag, layer=PREVIEW_LAYER):
    return {'type': 'text', 'text': text, 'position': frame.mm(x, y), 'height': h, 'rotation': 0, 'apartmentLayer': layer, 'apartmentZone': tag}


def _poly_ent(frame, coords, tag, layer=PREVIEW_LAYER, **extra):
    return {'type': 'polyline', 'closed': True, 'points': [frame.mm(x, y) for x, y in coords], 'apartmentLayer': layer, 'apartmentZone': tag, **extra}


def _parcel_groups(ents, frame):
    """도면의 지적 필지(site·neighbor·road)를 (pnu, polygon) 별 shapely 폴리곤으로."""
    from shapely.geometry import Polygon
    groups = {}
    for e in ents:
        if e.get('type') != 'polyline' or not e.get('closed') or e.get('parcelRole') not in ('site', 'neighbor', 'road'):
            continue
        a = e.get('attributes', {})
        if not a.get('pnu') or len(e.get('points', [])) < 3:
            continue
        groups.setdefault((a['pnu'], a.get('polygon', 0), a.get('contextPart', 0)), []).append(e)
    out = []
    for (pnu, _, _), rings_ in groups.items():
        outer = next((e for e in rings_ if e['attributes'].get('ring') != 'hole'), None)
        if outer is None:
            continue
        holes = [frame.m(e['points']) for e in rings_ if e['attributes'].get('ring') == 'hole' and len(e['points']) >= 3]
        g = Polygon(frame.m(outer['points']), holes)
        if not g.is_valid:
            g = g.buffer(0)
        if g.is_empty:
            continue
        a = outer['attributes']
        out.append({'pnu': pnu, 'jibun': a.get('jibun', ''), 'jimok': a.get('jimok', ''), 'role': outer.get('parcelRole'), 'geom': g, 'info': a.get('landInfo'),
                    'clipped': bool(a.get('clippedToContext')), 'source': 'doc'})
    return out


def _jimok_of(p):
    j = str(p.get('jimok') or '').strip()
    if not j:
        jb = str(p.get('jibun') or '').strip()
        j = jb.split()[-1] if ' ' in jb else (jb[-1] if jb and not jb[-1].isdigit() else '')
    return j


def _fetch_missing(pl_poly, known, warnings):
    """PL 이 불러온 필지 밖으로 나가면 VWorld 에서 bbox 로 더 받는다(100개 한도는 page·타일로 넘김). 실패는 경고로."""
    import parcel_service
    import korea_crs
    minx, miny, maxx, maxy = pl_poly.bounds
    tr = korea_crs.transformer('EPSG:5179', 'EPSG:4326')
    lon0, lat0 = tr.transform(minx, miny); lon1, lat1 = tr.transform(maxx, maxy)
    config, _ = parcel_service.request(parcel_service.BASE + '/api/vworld', authenticated=True)
    feats = parcel_service.features_in_box(config, (min(lon0, lon1), min(lat0, lat1), max(lon0, lon1), max(lat0, lat1)))
    out = []
    for f in feats:
        props = f.get('properties') or {}
        pnu = str(props.get('pnu', ''))
        if not pnu or pnu in known:
            continue
        for g, _ in parcel_service.feature_polygons_m(f):
            if not g.intersects(pl_poly):
                continue
            out.append({'pnu': pnu, 'jibun': str(props.get('jibun', '')), 'jimok': str(props.get('jimok', '')), 'role': 'fetched', 'geom': g, 'info': None, 'clipped': False, 'source': 'vworld'})
    return out, config


def enclose(data):
    """가두리: 닫힌 PL(mm) 안 필지를 전부 모아 대지로 묶고 필지 검토 표 + 용도지역 조각(엔진 parts)을 만든다."""
    from shapely.geometry import Polygon, MultiPolygon
    from shapely.ops import unary_union
    sz = _engine() if (ENGINE_DIR / 'site_zones.py').is_file() else _ServerZones()
    pl_pts = data.get('pl') or []
    if len(pl_pts) < 3:
        raise ValueError('가두리 PL(닫힌 폴리선) 점이 3개 이상이어야 합니다.')
    ents = _flat(data.get('entities'))
    frame = _frame_of(ents)
    pl = Polygon(frame.m(pl_pts))
    if not pl.is_valid:
        pl = pl.buffer(0)
    if pl.is_empty or pl.geom_type != 'Polygon':
        raise ValueError('가두리 PL 이 꼬여 있습니다. 교차 없는 닫힌 선으로 다시 그리세요.')
    warnings = []
    parcels_all = _parcel_groups(ents, frame)
    inside = [p for p in parcels_all if p['geom'].intersects(pl) and p['geom'].intersection(pl).area > 0.5]
    known = {p['pnu'] for p in parcels_all}
    covered = unary_union([p['geom'] for p in parcels_all]) if parcels_all else Polygon()
    gap = pl.difference(covered)
    fetched = 0; config = None
    if gap.area > 1.0 and data.get('fetchMissing', True):
        try:
            more, config = _fetch_missing(pl, known, warnings)
            inside += [p for p in more if p['geom'].intersection(pl).area > 0.5]; fetched = len(more)
            gap = pl.difference(unary_union([p['geom'] for p in parcels_all + more])) if more else gap
        except ValueError as error:
            warnings.append(f'VWorld 추가 조회 실패({error}) — 도면에 있는 필지만으로 묶었습니다. 필지 없는 틈 {gap.area:,.1f}㎡')
    if not inside:
        raise ValueError('가두리 안에 필지가 없습니다. PL 이 지적 필지 위에 놓였는지 확인하세요.')
    # 지목: 지적(연속지적도) jibun 꼬리글자(…대/도/천) 또는 jimok — 필지별 추가 호출 없음.
    # 도(도로)·천·구·공 등 기반시설 필지는 기본 '대지면적 제외 · 구역면적 포함', includePnus 로 되돌림(재개발 폐도 편입).
    include = set(data.get('includePnus') or []); exclude = set(data.get('excludePnus') or [])
    rows = []
    for p in inside:
        piece = p['geom'].intersection(pl)
        j = _jimok_of(p)
        public = j in PUBLIC_JIMOK
        rows.append({'pnu': p['pnu'], 'jibun': p['jibun'], 'jimok': j, 'jimok_known': bool(j), 'public_like': public, 'public_kind': PUBLIC_JIMOK.get(j, ''),
                     'area_full_m2': round(p['geom'].area, 1), 'area_m2': round(piece.area, 1), 'cut_by_pl': piece.area < p['geom'].area - 0.5,
                     'zones': [], 'zone_error': '', 'source': p['source'], 'excluded': (p['pnu'] in exclude) or (public and p['pnu'] not in include), 'geom': piece, 'info': p.get('info')})
    rows.sort(key=lambda r: -r['area_m2'])
    # 접도: 가두리 밖에서 대지에 닿는 도로 필지(폭 추정 = 면적 ÷ (둘레/2))
    pl_zone = unary_union([r['geom'] for r in rows]).buffer(0)
    frontage = []; road_polys = []   # 86조⑥: 접한 도로(가두리 밖) + 대지에서 뺀 도로·천·구·공원(가두리 안) → 엔진 roads
    for p in parcels_all:
        road = _jimok_of(p) in ('도', '도로') or p.get('role') == 'road'
        if not road and _jimok_of(p) not in PUBLIC_JIMOK:
            continue
        outside = p['geom'].difference(pl)
        if outside.is_empty or not outside.buffer(0.05).intersects(pl_zone):
            continue
        road_polys.append(outside)                     # 도로·하천·구거·공원 모두 86조⑥ 대상
        if not road:
            continue
        L = outside.length
        touch = outside.buffer(0.3).intersection(pl_zone.exterior).length
        frontage.append({'pnu': p['pnu'], 'jibun': p['jibun'], 'width_m': round(outside.area / (L / 2), 1) if L else None, 'touch_m': round(touch, 1)})
    # 용도지역: ① VWorld 용도지역 면(LT_C_UQ111) 한 번 조회 → 대지와 교차(조각이 그대로 나옴) ② 안 되면 필지별 토지이용정보(캐시·동시 3) ③ site 의 landInfo
    zone_source = 'doc'; zone_polys = None; zmap = dict(data.get('zonesByPnu') or {})
    if data.get('lookupZones', True) and data.get('zoneLayer', True):
        try:
            import parcel_service
            import korea_crs
            if config is None:
                config, _ = parcel_service.request(parcel_service.BASE + '/api/vworld', authenticated=True)
            tr = korea_crs.transformer('EPSG:5179', 'EPSG:4326')
            bx = pl.bounds; lon0, lat0 = tr.transform(bx[0], bx[1]); lon1, lat1 = tr.transform(bx[2], bx[3])
            zone_polys = parcel_service.zone_polygons_in_box(config, (min(lon0, lon1), min(lat0, lat1), max(lon0, lon1), max(lat0, lat1)))
            zone_source = 'vworld-layer'
        except ValueError as error:
            warnings.append(f'용도지역 레이어 조회 못 함({error}) → 필지별 토지이용정보로 대체')
    if zone_polys:
        for r in rows:
            hits = {}
            for g, name in zone_polys:
                a = r['geom'].intersection(g).area
                if a > 0.5:
                    hits[name] = hits.get(name, 0) + a
            r['zones'] = [n for n, _ in sorted(hits.items(), key=lambda t: -t[1])]
            r['zone_error'] = '' if r['zones'] else '용도지역 레이어에 없음'
    else:
        need = [r['pnu'] for r in rows if r['pnu'] not in zmap and not zone_names(r.get('info'))]
        if need and data.get('lookupZones', True):
            try:
                import parcel_service
                zmap.update(parcel_service.zones_by_pnu(need, config=config)); zone_source = 'land_info'
            except ValueError as error:
                warnings.append(f'용도지역 조회 실패: {error}')
        for r in rows:
            r['zones'] = zone_names(r.get('info')) or zone_names(zmap.get(r['pnu']))
            r['zone_error'] = (zmap.get(r['pnu']) or {}).get('error') or ('' if r['zones'] else '용도지역 없음')
    for r in rows:
        r.pop('info', None)
    for r in rows:
        if r['zones'] or r['excluded']:
            continue
        best = max((o for o in rows if o['zones'] and o is not r), key=lambda o: r['geom'].buffer(0.05).intersection(o['geom']).area, default=None)
        if best is not None and r['geom'].buffer(0.05).intersection(best['geom']).area > 0:
            r['zones'] = [best['zones'][0]]; r['zone_error'] = ''
            warnings.append(f"{r['jibun'] or r['pnu']}: 용도지역 없음 → 붙은 필지 {best['jibun'] or best['pnu']} 의 '{best['zones'][0]}' 로 가정, 확인필요")
    # 엔진 parcels: 조각(멀티면 각각) + 지역 하나.
    #  ① 사용자 묶음 PL('용도지역' 레이어의 닫힌 PL + 안의 글자) 이 있으면 그것이 우선: 조각 = 대지 ∩ 묶음 PL, 안 덮인 부분은 자동 지역(확인필요) 또는 유일 지역
    #  ② 없으면 레이어 경로면 필지∩지역 조각으로 정확히 나누고, 아니면 점선(기존 방식) 또는 첫 지역 가정
    lines, labels = zone_marks(ents, data.get('layers'), frame)
    groups = _zone_groups(ents, data.get('layers'), frame)
    group_names = sorted({g['zone'] for g in groups})
    eng = []; uncovered = 0.0
    for r in rows:
        if r['excluded']:
            continue
        if groups:
            remaining = r['geom']
            for g in groups:
                cut_ = r['geom'].intersection(g['poly'])
                if cut_.area <= 0.5:
                    continue
                for gg in (cut_.geoms if hasattr(cut_, 'geoms') else [cut_]):
                    if gg.geom_type == 'Polygon' and gg.area > 0.5:
                        eng.append({'pnu': f"{r['pnu']}@{g['no']}", 'coords': [[x, y] for x, y in gg.exterior.coords[:-1]], 'zones': [g['zone']]})
                if r['zones'] and g['zone'] not in r['zones']:
                    warnings.append(f"{r['jibun'] or r['pnu']}: 묶음 {g['no']} '{g['zone']}' ≠ 자동 조회 {'/'.join(r['zones'])} — 사용자 묶음대로 계산, 확인필요")
                remaining = remaining.difference(g['poly'])
            if remaining.area > 0.5:
                fallback = r['zones'][0] if r['zones'] else (group_names[0] if len(group_names) == 1 else None)
                if fallback:
                    for gg in (remaining.geoms if hasattr(remaining, 'geoms') else [remaining]):
                        if gg.geom_type == 'Polygon' and gg.area > 0.5:
                            eng.append({'pnu': f"{r['pnu']}@rest", 'coords': [[x, y] for x, y in gg.exterior.coords[:-1]], 'zones': [fallback]})
                    warnings.append(f"{r['jibun'] or r['pnu']}: 묶음 밖 {remaining.area:,.1f}㎡ → '{fallback}' 로 둠, 확인필요")
                else:
                    uncovered += remaining.area
                    warnings.append(f"{r['jibun'] or r['pnu']}: 묶음 밖 {remaining.area:,.1f}㎡ 용도지역 모름 — 대지에서 뺌, 확인필요")
            continue
        if not r['zones']:
            warnings.append(f"{r['jibun'] or r['pnu']}: 용도지역을 못 읽어 대지에서 뺐습니다({r['zone_error']}) 확인필요")
            continue
        pieces_ = []
        if zone_polys and len(r['zones']) > 1:
            cuts = {}
            for g, name in zone_polys:
                cut_ = r['geom'].intersection(g)
                if cut_.area > 0.5:
                    cuts[name] = cuts[name].union(cut_) if name in cuts else cut_
            # 용도지역 면끼리 경계가 조금 어긋나면(양정동 156-7: 0.3㎡ 쐐기 틈) 조각 합이 갈라져 엔진이 MultiPolygon 으로 실패 → 가장 넓은 지역 = 필지 − 나머지 지역
            main = max(cuts, key=lambda n: cuts[n].area, default=None)
            if main and len(cuts) > 1:
                cuts[main] = r['geom'].difference(unary_union([g for n, g in cuts.items() if n != main]))
            for name, cut_ in cuts.items():
                pieces_ += [(gg, [name]) for gg in (cut_.geoms if hasattr(cut_, 'geoms') else [cut_])]
        else:
            zs = r['zones'] if (len(r['zones']) == 1 or lines) else [r['zones'][0]]
            if len(r['zones']) > 1 and not lines:
                warnings.append(f"{r['jibun'] or r['pnu']}: 용도지역 {len(r['zones'])}개({'/'.join(r['zones'])}) — 점선 없어 '{zs[0]}' 로 가정. 나누려면 '용도지역' 레이어에 점선·글자")
            pieces_ = [(g, zs) for g in (r['geom'].geoms if isinstance(r['geom'], MultiPolygon) else [r['geom']])]
        for k, (g, zs) in enumerate(pieces_):
            if g.geom_type != 'Polygon' or g.area < 0.5:
                continue
            eng.append({'pnu': r['pnu'] + (f'#{k}' if k else ''), 'coords': [[x, y] for x, y in g.exterior.coords[:-1]], 'zones': zs})
    if not eng:
        raise ValueError('용도지역을 읽은 필지가 하나도 없어 대지를 묶지 못했습니다.')
    site = unary_union([Polygon(e['coords']) for e in eng]).buffer(0)
    if site.geom_type == 'MultiPolygon':
        big = max(site.geoms, key=lambda g: g.area)
        small = [g for g in site.geoms if g is not big]
        if sum(g.area for g in small) <= site.area * 0.01:
            warnings.append(f'떨어진 작은 조각 {len(small)}개({sum(g.area for g in small):,.1f}㎡)는 대지에서 뺐습니다')
            eng = [e for e in eng if big.intersects(Polygon(e['coords'])) and big.intersection(Polygon(e['coords'])).area > 0.5]
        else:
            raise ValueError('가두리 안 필지가 한 덩어리로 붙지 않습니다(도로 등으로 갈라짐). 가르는 필지를 포함하거나 가두리를 나누세요.')
    res = sz.split_zones(eng, lines or None, labels or None, bool(data.get('stripCommercial')))
    site_poly = Polygon(res['site'])
    # 묶음 번호(면적 큰 순) — 사용자 묶음 PL 이 있으면 그 번호를 따른다
    for i, part in enumerate(res['parts']):
        pg = Polygon(part['poly'])
        g = max(groups, key=lambda gr: gr['poly'].intersection(pg).area, default=None) if groups else None
        part['no'] = g['no'] if g and g['poly'].intersection(pg).area > 0 else i + 1
        part['label'] = f"묶음 {part['no']}"
        part['residential'] = '주거' in part['zone'] or '녹지' in part['zone']
    zone_area = pl_zone.area
    n_doc = sum(r['source'] == 'doc' for r in rows)
    by_j = {}
    for r in rows:
        if not r['excluded']:
            by_j[r['jimok'] or '?'] = by_j.get(r['jimok'] or '?', 0) + r['area_m2']
    pub = [r for r in rows if r['public_like']]
    pub_out = [r for r in pub if r['excluded']]; pub_in = [r for r in pub if not r['excluded']]
    land = [r for r in rows if not r['excluded']]
    unknown_j = [r for r in rows if not r['jimok_known']]
    head = f"대지 {len(land)}필지 {res['site_area_m2']:,.0f}㎡"
    if pub_out:
        head += f" · 기존도로등 {len(pub_out)}필지 {sum(r['area_m2'] for r in pub_out):,.0f}㎡(제외)"
    if pub_in:
        head += f" · 도로등 편입 {len(pub_in)}필지 {sum(r['area_m2'] for r in pub_in):,.0f}㎡(포함)"
    head += ' · ' + ' · '.join(f"{p['zone']} {p['area_m2']:,.0f}㎡" for p in res['parts'])
    T = [head, f"구역(가두리 안 필지 전부) {zone_area:,.1f}㎡ · PL 면적 {pl.area:,.1f}㎡ · 필지 {len(rows)}개(도면 {n_doc} · VWorld 추가 {fetched})" + (f" · 필지 없는 틈 {gap.area:,.1f}㎡" if gap.area > 1 else '') + f" · 용도지역 출처 {zone_source}"]
    T.append('지목별: ' + ' · '.join(f"{j} {a:,.1f}㎡" for j, a in sorted(by_j.items(), key=lambda t: -t[1])))
    if pub:
        T.append('기반시설(도로·천·구·공원) 필지 ' + f"{len(pub)}개: " + ', '.join(f"{r['jibun'] or r['pnu']}({r['public_kind']}{' 제외' if r['excluded'] else ' 포함'})" for r in pub) + '  ← 패널에서 포함/제외')
    if frontage:
        T.append('접도: ' + ' · '.join(f"{f['jibun'] or f['pnu']} 폭 약 {f['width_m']:g}m(접한 길이 {f['touch_m']:g}m)" for f in frontage[:8]))
    cut = [r for r in rows if r['cut_by_pl'] and not r['excluded']]
    if cut:
        T.append(f"PL 로 잘린 필지 {len(cut)}개: " + ', '.join(f"{r['jibun'] or r['pnu']} {r['area_m2']:,.0f}/{r['area_full_m2']:,.0f}㎡" for r in cut[:12]) + (' …' if len(cut) > 12 else ''))
    T.append(sz.table(res))
    for w in res.get('warnings', []) + warnings:
        T.append('! ' + w)
    # 도면(미리보기): 가두리 굵은 선 · 묶음 PL + 큰 글자('용도지역' 레이어, 사용자 묶음이 없을 때만 새로 그림) · 기반시설 필지 표시
    h = _text_h(site_poly)
    draw = [_poly_ent(frame, list(pl.exterior.coords[:-1]), 'enclose', lineweight=0.6)]
    for part in res['parts']:
        g = Polygon(part['poly']); c = g.representative_point()
        if not groups:
            draw.append(_poly_ent(frame, part['poly'], 'zone-group', layer=ZONE_LAYER))
            draw.append(_text(frame, c.x, c.y, f"묶음 {part['no']} · {part['zone']} · {part['area_m2']:,.0f}㎡", h * 1.2, 'zone-group', layer=ZONE_LAYER))
        draw.append(_text(frame, c.x, c.y - h / 1000 * 1.6, f"법정 건폐 {part['bcr']:g}% · 용적 {part['far']:g}%", h * 0.8, 'enclose'))
    for r in rows:
        if r['public_like'] and not r['geom'].is_empty:
            c = r['geom'].representative_point()
            draw.append(_text(frame, c.x, c.y, f"{r['public_kind']} {r['jibun'] or r['pnu'][-4:]}" + (' 제외' if r['excluded'] else ' 포함'), h * 0.6, 'enclose'))
    draw += [_poly_ent(frame, [[x, y] for x, y in r['geom'].exterior.coords[:-1]], 'enclose-fetched', layer='가두리-추가필지', attributes={'pnu': r['pnu'], 'jibun': r['jibun'], 'jimok': r['jimok']})
             for r in rows if r['source'] == 'vworld' and r['geom'].geom_type == 'Polygon']
    # 검토서 — 전체 1열 + 묶음별 열 + 합계
    addr = next(((p.get('info') or {}).get('address') for p in inside if (p.get('info') or {}).get('address')), '')
    jibuns = [r['jibun'] for r in rows if r['jibun'] and not r['excluded']]
    MODE = {'single': '단일 지역', 'weighted': '가중평균', 'separate': '조각별 각자'}
    SRC = {'vworld-layer': 'VWorld 용도지역 면(한 번 조회)', 'land_info': '필지별 토지이용정보', 'doc': '도면 landInfo'}
    sheet = [['대지 묶음', [f"대지위치  {addr or (jibuns[0] + ' 외 ' + str(len(jibuns) - 1) + '필지' if jibuns else '')}", head, f"구역면적(필지 전부)  {zone_area:,.2f} ㎡", f"대지면적(기반시설 제외)  {res['site_area_m2']:,.2f} ㎡", f"가두리(PL) 면적  {pl.area:,.2f} ㎡",
                          f"필지 {len(rows)}개 (도면 {n_doc} · VWorld 추가 {fetched})", f"용도지역 출처  {SRC.get(zone_source, zone_source)}" + ('  · 사용자 묶음 PL 우선' if groups else '')]
                          + ([f"필지 없는 틈  {gap.area:,.1f} ㎡  확인필요"] if gap.area > 1 else []) + ([f"묶음 밖 용도지역 모름  {uncovered:,.1f} ㎡  확인필요"] if uncovered > 0.5 else [])],
             ['지목별 면적 (지적 jibun 꼬리글자)', [f"{j}  {a:,.1f} ㎡" for j, a in sorted(by_j.items(), key=lambda t: -t[1])] + [f"{r['jibun'] or r['pnu']}: 지목 모름 확인필요" for r in unknown_j[:10]]],
             ['기반시설 필지 (도로·하천·구거·공원)', [f"{r['jibun'] or r['pnu']}  {r['public_kind']}  {r['area_m2']:,.1f} ㎡  " + ('제외(기본)' if r['excluded'] else '포함(편입) 확인필요') for r in pub]],
             ['접도 (가두리 밖 도로)', [f"{f['jibun'] or f['pnu']}  폭 약 {f['width_m']:g} m · 접한 길이 {f['touch_m']:g} m" for f in frontage] or ['접한 도로 필지 없음 — 접도 폭 산정 필요']],
             ['PL 로 잘린 필지', [f"{r['jibun'] or r['pnu']}  {r['area_m2']:,.1f} / {r['area_full_m2']:,.1f} ㎡" for r in cut]],
             ['용도지역 묶음 (국토계획법 84조)', [f"묶음 {p['no']}  {p['zone']}  {p['area_m2']:,.1f} ㎡ ({p['share'] * 100:.1f}%)" for p in res['parts']] + [f"판정  {MODE.get(res['mode'], res['mode'])}"] + list(res.get('basis', []))],
             ['우선 확인사항', list(res.get('warnings', [])) + list(warnings) + [f"{r['jibun'] or r['pnu']}: 용도지역 없음" for r in rows if not r['zones'] and not r['excluded']]],
             ['자료 기준', ['연속지적도(VWorld) · 용도지역 면/토지이용정보 · 바른 CAD 가두리', '참고 경계 · 현황측량 경계와 다를 수 있음']]]
    try:
        import placement
        osp = f"대지안의 공지  {placement.OPEN_SPACE_M:g} m"
    except ImportError:          # 로컬 엔진 없음 — 서버 배치 엔진 값으로 계산
        osp = '대지안의 공지  배치 엔진(서버) 기준'
    per_group = []
    for p in res['parts']:
        per_group.append([f"묶음 {p['no']} · {p['zone']}", [f"면적  {p['area_m2']:,.1f} ㎡ ({p['share'] * 100:.1f}%)", f"법정 건폐율  {p['bcr']:g} %", f"법정 용적률  {p['far']:g} %", '높이  제한 입력 시 반영 · 산정 필요'] + _law_rows(p['zone']) + [osp, '인센티브·상한 용적·목표 세대  → [인센티브 최대] 뒤 표시']])
    per_group.append(['합계', [f"대지면적  {res['site_area_m2']:,.1f} ㎡", f"묶음 {len(res['parts'])}개 · 판정 {MODE.get(res['mode'], res['mode'])}", f"가중 건폐 {res['zoning']['bcr']:g} % · 용적 {res['zoning']['far']:g} % (기준 지역 {res['zoning']['zone']})"]])
    return {'table': '\n'.join(T), 'draw': draw, 'warnings': warnings, 'sheets': [{'title': '필지 검토서', 'groups': sheet}, {'title': '묶음별 검토', 'groups': per_group, 'perColumn': True}],
            'parcels': [{k: v for k, v in r.items() if k != 'geom'} for r in rows], 'zonesByPnu': {k: {'zoneNames': zone_names(v), 'error': (v or {}).get('error')} for k, v in zmap.items()},
            'frontage': frontage, 'zone_source': zone_source, 'zone_area_m2': round(zone_area, 2), 'user_groups': [{'no': g['no'], 'zone': g['zone'], 'area_m2': g['area_m2']} for g in groups],
            'engine': {'parts': res['parts'], 'site': res['site'], 'site_area_m2': res['site_area_m2'], 'zoning': res['zoning'], 'mode': res['mode'], 'basis': res['basis'], 'frame': _frame_dict(frame),
                       'address': addr or (jibuns[0] + f' 외 {len(jibuns) - 1}필지' if jibuns else ''), 'jibuns': jibuns[:40], 'frontage': frontage,
                       'roads': [[[round(x, 3), round(y, 3)] for x, y in g.exterior.coords[:-1]] for g in _polys(unary_union(road_polys + [r['geom'] for r in rows if r['public_like'] and r['excluded']]))]},
            'site_mm': [frame.mm(x, y) for x, y in res['site']], 'pl_mm': [frame.mm(x, y) for x, y in pl.exterior.coords[:-1]],
            'parts_mm': [{'no': p['no'], 'zone': p['zone'], 'area_m2': p['area_m2'], 'far': p['far'], 'bcr': p['bcr'], 'points': [frame.mm(x, y) for x, y in p['poly']]} for p in res['parts']],
            'text_h': h}


def _law_rows(zone):
    """묶음별 적용 규칙 — rules.law_apartment.json 'zone_applicability' 가 있으면(다른 에이전트 작성 중) 그대로, 없으면 기본 판단(TODO)."""
    import json
    f = ENGINE_DIR / 'rules.law_apartment.json'
    rows = []
    try:
        if f.is_file():
            za = (json.loads(f.read_text(encoding='utf-8')).get('zone_applicability') or {})
            spec = za.get(zone) or za.get('default')
            if isinstance(spec, dict):
                for rid, v in spec.items():
                    if isinstance(v, dict):
                        rows.append(f"{v.get('name', rid)}  {'적용' if v.get('applies', True) else '해당없음'} · {v.get('basis', '')}")
                    else:
                        rows.append(f"{rid}  {'적용' if v else '해당없음'}")
            elif isinstance(spec, list):
                rows += [str(x) for x in spec]
    except (ValueError, OSError):
        rows = []
    if rows:
        return rows
    res = '주거' in zone or '녹지' in zone
    return [f"정북 일조(영 86조①)  {'적용' if res else '해당없음(전용·일반주거지역만, 영 86조①)'}", '인동간격·채광창(영 86조③)  적용(공동주택)', f"접도 용적 120%(조례 50조⑤)  {'해당없음(주거지역)' if res else '검토 대상'}", 'TODO rules.law_apartment.json zone_applicability 로 교체']


def _best_tier(table):
    best, bv = None, -1.0
    for k, v in (table or {}).items():
        r = v.get('ratio') if isinstance(v, dict) else v
        if isinstance(r, (int, float)) and r > bv:
            best, bv = k, float(r)
    return best


def _extra_rules():
    """다른 에이전트가 쓰는 추가 인센티브 규칙(정비사업 등). TODO: 스키마 확정 전 — items[{id,name,ratio|far_delta_pct,height_ratio?,auto?,applies_when?}] 로 가정."""
    import json
    out = []
    for name in EXTRA_RULE_FILES:
        f = ENGINE_DIR / name
        if f.is_file():
            try:
                d = json.loads(f.read_text(encoding='utf-8'))
                out += [dict(it, _file=name) for it in (d.get('items') or []) if it.get('id')]
            except (ValueError, OSError) as error:
                out.append({'id': f'_error:{name}', 'name': f'{name} 읽기 실패: {error}'})
    return out


def _max_selections(zone, extra, off, overrides):
    import incentive
    sel = {}
    for iid, v in ASSUMED_ITEMS.items():
        spec = incentive.ITEMS.get(iid)
        if not spec:
            continue
        if v is None:
            v = _best_tier(spec.get('table'))
        if iid == 'recycled_material':
            zn = incentive.parse_zone(zone)[0]
            if not (zn and incentive.ZONES.get(zn, {}).get('reuse_zone')):
                continue
        sel[iid] = v
    if extra.get('road_width_m') or extra.get('park_adjacent'):
        sel['road_frontage'] = {'road_width_m': extra.get('road_width_m'), 'road_frontage_m': extra.get('road_frontage_m'), 'park_adjacent': bool(extra.get('park_adjacent')),
                                'building_area_m2': extra.get('building_area_m2')}
    if extra.get('public_land_m2'):
        sel['public_facility_land'] = {'public_land_m2': extra['public_land_m2']}
    if extra.get('open_space_m2'):
        sel['open_space_building_act'] = {'open_space_m2': extra['open_space_m2']}
    if extra.get('landscape_m2'):
        sel['landscape_upgrade'] = {'landscape_m2': extra['landscape_m2']}
    if extra.get('block_guideline_height_add_m'):
        sel['block_guideline_height'] = {'height_add_m': extra['block_guideline_height_add_m']}
    for k, v in (overrides or {}).items():
        if v not in (None, False, '미적용'):
            sel[k] = v
    for iid in off or []:
        sel.pop(iid, None)
    return sel


def _program_simple(parts, caps, floors_max, blocks):
    """계산표(단순판) — TODO: maxfar.optimize 결과 result['program'] 이 생기면 그것으로 바꾼다(Phase A)."""
    import math, re
    def lm(b):
        vs = [float(m.group(1)) for m in (re.match(r'(\d{2,3})', str(l)) for l in b.get('labels', [])) if m]
        return sum(vs) / len(vs) if vs else None
    b84 = [b for b in blocks if lm(b) is not None and 80 <= lm(b) <= 90]
    unit84 = (sum(b['far_area_m2'] for b in b84) / max(sum(b['units'] for b in b84), 1)) if b84 else 84 * 1.15
    slabs = [b for b in blocks if b['length'] / max(b['depth'], 1) >= 2.0]
    upf_slab = sorted(b['units'] for b in slabs)[len(slabs) // 2] if slabs else 6
    upf_tower = 4
    import highrise
    hr = highrise.review(floors_max, FLOOR_H)
    uf = hr['unit_floors']
    pieces = []
    for p, c in zip(parts, caps):
        gfa = c['far_max_pct'] / 100 * p['area_m2']
        pieces.append({'zone': p['zone'], 'area_m2': p['area_m2'], 'far_max_pct': c['far_max_pct'], 'target_gfa_m2': round(gfa, 1), 'target_units84': int(gfa // unit84), 'floors_max': floors_max,
                       'height_max_m': c.get('height_max_m')})
    total_units = sum(x['target_units84'] for x in pieces)
    forms = []
    for title, upf in (('타워형', upf_tower), ('판상형', upf_slab), ('혼합형', round((upf_tower + upf_slab) / 2))):
        per = upf * uf
        dongs = max(1, math.ceil(total_units / max(per, 1)))
        forms.append({'form': title, 'dongs': dongs, 'floors': floors_max, 'units_per_floor': upf, 'units': min(total_units, dongs * per), 'unit_floors': uf})
    return {'pieces': pieces, 'unit84_far_m2': round(unit84, 1), 'total_units84': total_units, 'forms': forms, 'floors_max': floors_max,
            'source': 'service-simple', 'todo': 'maxfar.optimize 결과 program(Phase A) 으로 교체'}


def incentive_max(data):
    """조각별 인센티브 최대 → 상한 표 + 계산표. 가정 항목은 체크 해제(incentiveOff)로 빼고 다시 돌릴 수 있다."""
    import incentive
    from shapely.geometry import Polygon
    _engine()
    eng = data.get('engine') or {}
    parts = eng.get('parts') or []
    if not parts:
        raise ValueError('먼저 [가두리로 대지 묶기]를 실행하세요.')
    frame = _frame_from(eng.get('frame'))
    hl = data.get('heightLimit'); hl = float(hl) if hl else None
    extra = {k: float(v) if isinstance(v, (int, float, str)) and str(v).replace('.', '', 1).isdigit() else v for k, v in (data.get('siteExtra') or {}).items() if v not in (None, '')}
    off = list(data.get('incentiveOff') or [])
    overrides = data.get('incentives') or {}
    extras = _extra_rules()
    pieces, items_seen = [], {}
    for part in parts:
        base = {'bcr': part['bcr'] / 100.0, 'far': part['far'] / 100.0, 'height': hl}
        st = {'area_m2': part['area_m2'], 'zone': part['zone'], 'gfa_m2': part['far'] / 100.0 * part['area_m2'], 'use': '공동주택', **{k: v for k, v in extra.items() if isinstance(v, (int, float))}}
        sel = _max_selections(part['zone'], extra, off, overrides)
        try:
            r = incentive.apply(base, st, sel)
        except ValueError as error:
            raise ValueError(f"{part['zone']} 인센티브 계산 실패: {error}")
        L = r['legal']
        far_max = L['far'] * 100; bcr_max = L['bcr'] * 100; h_max = L['height']
        rows = []
        for it in r['items']:
            iid = it['id']
            group = 'auto' if iid in AUTO_ITEMS else 'assumed' if iid in ASSUMED_ITEMS else 'needs_value'
            d = it.get('delta_legal') or {}
            rows.append({'id': iid, 'name': it['name'], 'group': group, 'applied': bool(it['applied']), 'checked': iid in sel, 'selection': sel.get(iid),
                         'far_delta_pct': round((d.get('far') or 0) * 100, 1), 'height_delta_m': (round(d['height'], 1) if d.get('height') else None),
                         'reason': it.get('reason') or ('' if it['applied'] else NEEDS_VALUE.get(iid, '')), 'needs': NEEDS_VALUE.get(iid, '')})
            items_seen.setdefault(iid, rows[-1])
        # 추가 규칙(정비사업 등) — 가정으로 더함
        for ex in extras:
            if str(ex['id']).startswith('_error'):
                continue
            if ex['id'] in off or (ex.get('applies_when') == 'redevelopment' and not data.get('redevelopment')):
                rows.append({'id': ex['id'], 'name': ex.get('name', ex['id']), 'group': 'extra', 'applied': False, 'checked': ex['id'] not in off, 'far_delta_pct': 0, 'reason': '미적용', 'needs': ex.get('applies_when', '')})
                continue
            dv = float(ex.get('far_delta_pct') or (float(ex.get('ratio') or 0) * part['far']))
            far_max += dv
            if h_max is not None and ex.get('height_ratio'):
                h_max += hl * float(ex['height_ratio'])
            rows.append({'id': ex['id'], 'name': ex.get('name', ex['id']), 'group': 'extra', 'applied': dv > 0, 'checked': True, 'far_delta_pct': round(dv, 1), 'reason': f"추가 규칙 {ex.get('_file')} (가정)", 'needs': ''})
        pieces.append({'zone': part['zone'], 'area_m2': part['area_m2'], 'far_base_pct': part['far'], 'far_max_pct': round(far_max, 1), 'bcr_base_pct': part['bcr'], 'bcr_max_pct': round(bcr_max, 1),
                       'height_base_m': hl, 'height_max_m': (round(h_max, 1) if h_max is not None else None), 'items': rows, 'warnings': r['warnings'],
                       'applied': [x['name'] for x in rows if x['applied']], 'assumed': [x['name'] for x in rows if x['applied'] and x['group'] in ('assumed', 'extra')]})
    # 최고층: 높이상한 ÷ 층고, 없으면 입력(기본 35)
    fmax_in = int(data.get('floorsMax') or 35)
    hs = [p['height_max_m'] for p in pieces if p['height_max_m']]
    floors_max = min(fmax_in, int(min(hs) // FLOOR_H)) if hs else fmax_in
    floors_max = max(5, min(60, floors_max))
    import placement
    blocks = placement.load_blocks(max_units=int(data.get('maxUnitsPerFloor') or 8))
    caps = [{'far_max_pct': p['far_max_pct'], 'height_max_m': p['height_max_m']} for p in pieces]
    # 상한 반영 parts (배치용)
    parts_capped = [dict(p, far_base=p['far'], far=pc['far_max_pct'], bcr_base=p['bcr'], bcr=min(pc['bcr_max_pct'], 100.0)) for p, pc in zip(parts, pieces)]
    program = _program_simple(parts, caps, floors_max, blocks)          # 계산표 글(검토서)용
    try:   # 엔진 A단계 프로그램(형식별 동×층×층당세대) — 실제 블록·층 띠 기준. 실패해도 단순표로 진행
        import maxfar
        mopts = {'floors_max': floors_max, 'floor_h': FLOOR_H, 'redevelopment': bool(data.get('redevelopment')), 'north_exempt': bool(data.get('northExempt'))}
        program['maxfar'] = {form: maxfar.program(maxfar.Problem(parts_capped, mopts, form)) for form in maxfar.FORMS}
    except Exception as error:  # noqa: BLE001
        program['maxfar_error'] = f'{type(error).__name__}: {error}'
    # 표(큰 숫자 먼저)
    T = []
    for p in pieces:
        T.append(f"{p['zone']} {p['area_m2']:,.0f}㎡ : 용적 {p['far_base_pct']:g}% → {p['far_max_pct']:g}%" + (f" · 높이 {p['height_base_m']:g} → {p['height_max_m']:g}m" if p['height_max_m'] else '') + f" · 건폐 {p['bcr_base_pct']:g} → {p['bcr_max_pct']:g}%")
        if p['assumed']:
            T.append('   가정(소유자 약속): ' + ', '.join(p['assumed']))
    T.append(f"최고층 {floors_max}층(층고 {FLOOR_H}m) · 84형 1세대 산정면적 {program.get('unit84_far_m2', 0):g}㎡ · 목표 세대 {program.get('total_units84', 0):,}")
    for f in program.get('forms', []):
        T.append(f"  {f['form']}: {f['dongs']}동 × {f['floors']}층 × 층당 {f['units_per_floor']}세대 = {f['units']:,}세대")
    for p in pieces:
        for w in p['warnings'][:4]:
            T.append('! ' + w)
    # 도면 글자: 조각 글자를 상한으로 갱신(제자리) + 검토서 2장(인센티브 검토 · 계산표)
    site_poly = Polygon(eng['site']); h = float(data.get('textH') or _text_h(site_poly))
    draw = [_poly_ent(frame, part['poly'], 'enclose') for part in parts]
    for part, p in zip(parts, pieces):
        c = Polygon(part['poly']).representative_point()
        draw.append(_text(frame, c.x, c.y, f"{part['zone']} · {part['area_m2']:,.0f}㎡ · 상한 용적 {p['far_max_pct']:g}% (기본 {p['far_base_pct']:g}%)", h, 'enclose'))
    GN = {'auto': '자동', 'assumed': '가정', 'needs_value': '값 필요', 'extra': '추가규칙'}
    inc_groups = []
    for p in pieces:
        rows_ = [f"용적률  {p['far_base_pct']:g}% → {p['far_max_pct']:g}%   건폐율  {p['bcr_base_pct']:g}% → {p['bcr_max_pct']:g}%" + (f"   높이  {p['height_base_m']:g} → {p['height_max_m']:g} m" if p['height_max_m'] else '')]
        for it in p['items']:
            if it['applied']:
                rows_.append(f"{it['name']} : 적용{' (가정)' if it['group'] in ('assumed', 'extra') else ''} · +{it['far_delta_pct']:g}%p" + (f" · 높이 +{it['height_delta_m']:g}m" if it.get('height_delta_m') else '') + (f" · {it['reason']}" if it.get('reason') else ''))
            elif it.get('checked'):
                rows_.append(f"{it['name']} : 미적용 — {it.get('reason') or '조건 미충족'}")
        for it in p['items']:
            if not it['applied'] and not it.get('checked') and it['group'] == 'needs_value':
                rows_.append(f"{it['name']} : 값 필요({it['needs']}) 산정 필요")
        inc_groups.append([f"{p['zone']}  {p['area_m2']:,.1f} ㎡", rows_])
    inc_groups.append(['우선 확인사항', ['가정 항목은 소유자 약속(인증·장수명 등)이 있어야 성립 — 패널에서 체크를 풀면 빠짐'] + [w for p in pieces for w in p['warnings'][:3]]])
    calc_groups = [[f"{pp['zone']}  {pp['area_m2']:,.1f} ㎡", [f"상한 용적률  {pp['far_max_pct']:g} %", f"목표 연면적(용적률 산정용)  {pp['target_gfa_m2']:,.0f} ㎡", f"84형 목표 세대수  {pp['target_units84']:,} 세대 (1세대 {program.get('unit84_far_m2', 0):g} ㎡)",
                                                            f"최고층  {pp['floors_max']} 층" + (f" (높이 {pp['height_max_m']:g} m)" if pp.get('height_max_m') else '')]] for pp in program.get('pieces', [])]
    calc_groups.append(['형식별 프로그램 (동 × 층 × 층당 세대)', [f"{f['form']}  {f['dongs']}동 × {f['floors']}층 × {f['units_per_floor']}세대 = {f['units']:,}세대 (세대 층 {f.get('unit_floors', f['floors'])})" for f in program.get('forms', [])] + [f"합계 목표  {program.get('total_units84', 0):,} 세대 · 층고 {FLOOR_H} m"]])
    if program.get('source') == 'service-simple':
        calc_groups.append(['자료 기준', ['단순 계산표(서비스) — 최대용적 엔진 program 으로 교체 예정 확인필요']])
    return {'pieces': pieces, 'items': list(items_seen.values()), 'floors_max': floors_max, 'program': program, 'table': '\n'.join(T), 'draw': draw,
            'sheets': [{'title': '인센티브 검토', 'groups': inc_groups}, {'title': '계산표', 'groups': calc_groups}],
            'engine': {**eng, 'parts': parts_capped, 'parts_base': parts, 'incentive_applied': sorted({n for p in pieces for n in p['applied']}), 'incentive_assumed': sorted({n for p in pieces for n in p['assumed']})},
            'extra_rules': [e.get('name') for e in extras]}


def _polys(g):
    """Polygon/MultiPolygon/GeometryCollection → 면 목록(빈 것·선 제외)."""
    if g.is_empty:
        return []
    if g.geom_type == 'Polygon':
        return [g]
    return [x for part in getattr(g, 'geoms', []) for x in _polys(part)]


def _maxfar_plans(parts, opts):
    """maxfar 3안(타워형·판상형·혼합형). 결과 모양이 아직 바뀌는 중이라 list / {'plans'} / 단일 dict 를 모두 받는다. 없거나 실패하면 None."""
    try:
        import maxfar
    except ImportError:
        return None
    r = maxfar.optimize(parts, opts, time_s=float(opts.get('time_s') or 0) or None)
    if isinstance(r, list):
        return r
    if isinstance(r, dict) and isinstance(r.get('plans'), list):
        return r['plans']
    if isinstance(r, dict) and 'buildings' in r:
        return [r]
    return None


def _target_plans(parts, opts):
    """[2026-10-17 설계엔진] 목표 먼저 배치(target_plan): 인센티브 최대 목표를 정하고 동 조합(줄·계단식·혼합·층수)을 돌려
    1안 84타입 · 2안 최대 용적(타입 무관) 두 안. 인센티브는 target_plan 이 최대로 직접 고른다(패널 선택값 대신).
    작업 프로세스 풀이 안 되는 실행 환경(설치판 등)이면 한 프로세스로 다시."""
    import target_plan
    o = {k: v for k, v in opts.items() if k != 'incentive_selections'}
    out = []
    for mode, title in (('84', '1안 84타입'), ('max', '2안 최대 용적')):
        try:
            p = target_plan.plan(parts, o, mode=mode)
        except Exception:  # noqa: BLE001 — BrokenProcessPool 등
            p = target_plan.plan(parts, o, mode=mode, workers=1)
        p['title'] = f"{title} · {p.get('title', '')}"
        out.append(p)
    return out


def _target_note(plans):
    lines = []
    for p in plans:
        tp = p.get('target_plan') or {}
        lines.append(f"{p.get('title', '')}: 목표 {tp.get('target_far_pct')}%(확정 {tp.get('confirmed_far_pct')}%) → 달성 {tp.get('reached_pct')}% · "
                     + " / ".join(f"{s['step'][:24]} {s.get('far_pct')}%" for s in tp.get('steps') or []))
        for a in (tp.get('assumptions') or [])[:6]:
            lines.append('  가정: ' + a)
        oe = p.get('outside_engine') or {}
        if oe.get('green_note'):
            lines.append('  ' + oe['green_note'])
    return '\n'.join(lines)


def _label_num(l):
    import re
    m = re.match(r'(\d{2,3})', str(l or ''))
    return int(m.group(1)) if m else None


def _mix_label(labels):
    """['84A','84B','59A','59A'] → '84×2+59×2'."""
    cnt = {}
    for l in labels:
        n = _label_num(l)
        if n:
            cnt[n] = cnt.get(n, 0) + 1
    return '+'.join(f"{n}×{c}" for n, c in sorted(cnt.items(), key=lambda t: -t[0])) or '?'


def _catalog(path):
    import json
    try:
        return json.loads(Path(path).read_text(encoding='utf-8'))
    except (OSError, ValueError):
        return None


def block_drawings(codes, unit_codes_by_block=None):
    """실제 들어간 도면: 주동 기준층(외곽·코어·세대 구획·방) + 단위세대 평면(외곽·방). 없는 건 missing 표시(지어내지 않음)."""
    import placement
    root = placement.BLOCKS_DIR.parent
    blocks, unit_types, seen_units = [], [], {}
    for code in dict.fromkeys(codes):
        j = _catalog(root / 'judong' / f'{code}.json') or _catalog(root / 'judong-gen' / f'{code}.json')
        fp = _catalog(root / 'floorplans' / f'{code}.json')
        if not j:
            blocks.append({'code': code, 'missing': True, 'note': '평면 정보 없음', 'outline_mm': [], 'core': [], 'units': [], 'rooms': []})
            continue
        core = []
        if isinstance(j.get('core'), list):
            core = [c for c in j['core'] if isinstance(c, list) and len(c) >= 3]
        core_detail = [{'name': c.get('name', ''), 'poly': c.get('poly')} for c in (j.get('core_detail') or []) if c.get('poly')]
        units = [{'label': u.get('label', ''), 'poly': u.get('poly_mm') or u.get('slot_poly_mm'), 'unit_code': u.get('unit_code')} for u in (j.get('units') or []) if (u.get('poly_mm') or u.get('slot_poly_mm'))]
        rooms = []
        if fp:
            for u in fp.get('units') or []:
                for r in u.get('rooms') or []:
                    if r.get('poly'):
                        rooms.append({'label': (r.get('labels') or [''])[0], 'area_m2': r.get('area_m2'), 'poly': r['poly'], 'unit': u.get('label', '')})
                if u.get('unit_code'):
                    seen_units.setdefault(u['unit_code'], u.get('label', ''))
        for uc in (j.get('recipe') or {}).get('unit_codes') or []:
            seen_units.setdefault(uc, '')
        blocks.append({'code': code, 'missing': False, 'title': (j.get('title_texts') or [j.get('recipe', {}).get('type', '') if isinstance(j.get('recipe'), dict) else ''])[0] if j.get('title_texts') else (j.get('recipe') or {}).get('type', ''),
                       'source': j.get('source') or ('생성 블록(judong-gen)' if j.get('generated') else ''), 'outline_mm': j.get('outline_mm') or [], 'core': core, 'core_detail': core_detail, 'core_code': j.get('core_code'),
                       'units': units, 'rooms': rooms, 'area_m2': j.get('area_m2'), 'length_mm': j.get('length_mm'), 'depth_mm': j.get('depth_mm'),
                       'note': '' if (units or core) else '세대 구획 없음(외곽만)', 'rooms_note': '' if rooms else '방 정보 없음'})
    for uc, label in seen_units.items():
        u = _catalog(root / 'units' / f'{uc}.json')
        if not u:
            unit_types.append({'code': uc, 'label': label, 'missing': True, 'note': '평면 정보 없음', 'outline_mm': [], 'rooms': []}); continue
        rooms = [{'label': (r.get('labels') or [''])[0], 'type': (r.get('types') or [''])[0], 'area_m2': r.get('area_m2'), 'poly': r['poly']} for r in (u.get('rooms') or []) if r.get('poly')]
        unit_types.append({'code': uc, 'label': label or (str(u.get('area_label_m2') or '') + '형'), 'missing': False, 'area_m2': u.get('area_label_m2') or u.get('outline_area_m2'), 'outline_mm': u.get('outline_mm') or [],
                           'outline_ok': u.get('outline_ok', True), 'rooms': rooms, 'source_file': u.get('source_file', ''), 'note': '' if rooms else (u.get('rooms_note') or '방 정보 없음')})
    return {'blocks': blocks, 'unit_types': unit_types}


def place_max(data):
    """계산표에 맞춰 용적 최대 배치 3안 + 배치도 자료(세대 구성·지반고·등고선·건축개요·실제 도면). maxfar 가 없거나 실패하면 placement.three_plans 로 대체(표시)."""
    from shapely.geometry import Polygon
    _engine()
    import placement, highrise
    eng = data.get('engine') or {}
    parts = eng.get('parts') or []
    if not parts:
        raise ValueError('먼저 [가두리로 대지 묶기] → [인센티브 최대]를 실행하세요.')
    frame = _frame_from(eng.get('frame'))
    floors = int(data.get('floorsMax') or data.get('floors') or 35)
    floors = max(5, min(60, floors))
    program = data.get('program') or {}
    ents = _flat(data.get('entities') or [])
    roads = [frame.m(e['points']) for e in ents if e.get('parcelRole') == 'road' and e.get('type') == 'polyline' and e.get('closed') and len(e.get('points', [])) >= 3]
    roads += eng.get('roads') or []          # 가두리에서 찾은 도로·기반시설(지목) — 86조⑥ 중심선 완화
    zone = (eng.get('zoning') or {}).get('zone') or parts[0]['zone']
    opts = {'zone': zone, 'redevelopment': bool(data.get('redevelopment')), 'north_exempt': bool(data.get('northExempt')), 'roads': roads, 'floors_max': floors, 'floor_h': FLOOR_H,
            'max_units': int(data.get('maxUnitsPerFloor') or 8), 'incentive_selections': data.get('incentiveSelections') or {}, 'time_s': data.get('timeS'), 'program': program,
            'sun_gate': bool(data.get('sunGate'))}          # 세대 일조 2시간 미달 안 빼기(기본 끔)
    blocks = placement.load_blocks(max_units=opts['max_units'], floors=floors)
    bmeta = {b['code']: b for b in placement.load_blocks(max_units=opts['max_units'])}
    note = ''; plans = None
    if data.get('planMode') == 'target':
        try:
            plans = _target_plans(parts, opts)
            note = _target_note(plans)
        except Exception as error:  # noqa: BLE001
            note = f'목표 배치(target_plan) 실패 → 기존 3안으로: {str(error)[:160]}'
            plans = None
    if not plans and data.get('useMaxfar', True):
        try:
            plans = _maxfar_plans(parts, opts)
        except Exception as error:  # noqa: BLE001 — 엔진 재작성 중: 실패하면 기존 3안으로
            note = f'최대용적 엔진(maxfar) 실패 → 기존 3안으로 대체: {str(error)[:120]}'
    if not plans:
        hr = highrise.review(floors, FLOOR_H)
        plans = placement.three_plans(parts, blocks, floors, {**opts, 'unit_floors': hr['unit_floors']})
        note = note or 'TODO: maxfar 3안(타워형·판상형·혼합형) 준비 전 — placement.three_plans 로 대체'
    north = next((e.get('attributes', {}).get('northVector') for e in ents if e.get('attributes', {}).get('northVector')), [0, 1])
    return _render(plans, eng, program, floors, note, bmeta, data.get('textH'), north, data.get('drawings', True))


def _render(plans, eng, program, floors, note, bmeta, text_h, north_vec, drawings=True):
    """엔진 안(plan) → 패널 카드 값 + 도면 글자·외곽(draw) + 건축개요 시트. place_max 와 빠른·정밀 검토(로컬·서버 작업)가 같이 쓴다."""
    from shapely.geometry import Polygon
    parts = eng['parts']
    frame = _frame_from(eng.get('frame'))
    site_poly = Polygon(eng['site']); h = float(text_h or _text_h(site_poly))
    polys = [(p, Polygon(p['poly'])) for p in parts]
    caps = {p['zone']: p['far'] / 100 * p['area_m2'] for p in parts}
    bcr_caps = {p['zone']: p['bcr'] / 100 * p['area_m2'] for p in parts}
    # 등고선·지반고 (DEM 없으면 생략)
    terr = None; contours_mm = []
    try:
        import terrain
        terr = terrain.site_terrain(eng['site'], 'EPSG:5179')
        for c in terr.get('contours', []):
            for ln in c['lines']:
                contours_mm.append({'z': c['z'], 'points': [frame.mm(x, y) for x, y in ln]})
    except Exception as error:  # noqa: BLE001
        note += ('\n' if note else '') + f'등고선 없음({str(error)[:80]})'
    def ground(poly_m):
        if not terr:
            return None
        try:
            import terrain
            return terrain.ground_level(poly_m, 'EPSG:5179')
        except Exception:  # noqa: BLE001
            return None
    form_of = lambda t: '타워형' if '타워' in t else '판상형' if ('판상' in t or '남향' in t) else '혼합형'
    out = []
    all_codes = []
    for i, p in enumerate(plans):
        tag = f'plan{i+1}'
        t = dict(p.get('totals') or {})
        blds = p.get('buildings') or []
        status = '불가' if not blds else {'ok': '가능'}.get(p.get('status'), p.get('status')) or '가능'   # maxfar: ok/불가 · 동이 없으면 이유(reason)와 함께 불가
        used = {z: 0.0 for z in caps}; foot = {z: 0.0 for z in caps}
        mix = {}      # type → {'units','dongs':set,'upf'}
        draw, bl_out = [], []
        for k, b in enumerate(blds):
            bp = Polygon(b['poly']); c = bp.centroid
            z = next((pp['zone'] for pp, g in polys if g.contains(c)), parts[0]['zone'])
            used[z] = used.get(z, 0) + float(b.get('gfa_m2') or 0)
            foot[z] = foot.get(z, 0) + bp.area
            labs = b.get('labels') or bmeta.get(b.get('block'), {}).get('labels', [])
            uf = int(b.get('unit_floors') or b.get('floors') or 0); upf = int(b.get('units_per_floor') or len(labs) or 0)
            dong = 101 + k
            per_type = {}
            for l in labs:
                key = str(l) if any(ch.isalpha() for ch in str(l)) else str(_label_num(l) or l)
                per_type[key] = per_type.get(key, 0) + 1
            if not per_type and upf:
                per_type['?'] = upf
            for key, n in per_type.items():
                m = mix.setdefault(key, {'type': key, 'num': _label_num(key), 'units': 0, 'dongs': [], 'upf': n, 'area_m2': None})
                m['units'] += n * uf; m['dongs'].append(dong)
            gl = ground(bp)
            label = f"{dong}동 {_mix_label(labs) if labs else str(upf)} · {b.get('floors')}F"
            steep = bool(gl and (gl['max'] - gl['min']) > 3.0)
            bl_out.append({**{kk: vv for kk, vv in b.items() if kk != 'poly'}, 'dong': dong, 'label': label, 'zone': z, 'points_mm': [frame.mm(x, y) for x, y in b['poly']], 'centroid_mm': frame.mm(c.x, c.y),
                           'footprint_m2': round(bp.area, 1), 'types': per_type, 'ground': gl, 'steep': steep, 'labels': labs})
            draw.append(_poly_ent(frame, b['poly'], tag, layer=PLAN_LAYER))
            draw.append(_text(frame, c.x, c.y, label + (f" · EL.{gl['mean']:g}" if gl else ''), h * 0.9, tag, layer=PLAN_LAYER))
            all_codes.append(b.get('block'))
        per_piece = [{'zone': pp['zone'], 'area_m2': pp['area_m2'], 'far_cap_pct': pp['far'], 'bcr_cap_pct': pp['bcr'], 'used_gfa_m2': round(used.get(pp['zone'], 0), 1), 'footprint_m2': round(foot.get(pp['zone'], 0), 1),
                      'far_used_pct': round(used.get(pp['zone'], 0) / pp['area_m2'] * 100, 1), 'bcr_used_pct': round(foot.get(pp['zone'], 0) / pp['area_m2'] * 100, 1),
                      'fill_pct': round(used.get(pp['zone'], 0) / caps[pp['zone']] * 100, 1) if caps[pp['zone']] else 0} for pp in parts]
        for pp, g in polys:
            c = g.representative_point(); row = next(r for r in per_piece if r['zone'] == pp['zone'])
            draw.append(_text(frame, c.x, c.y - h / 1000 * 1.4, f"사용 용적 {row['far_used_pct']:g}% / 상한 {row['far_cap_pct']:g}% (채움 {row['fill_pct']:g}%)", h * 0.8, tag, layer=PLAN_LAYER))
        total_cap = sum(caps.values()); total_used = sum(used.values()); total_foot = sum(foot.values())
        fill = round(total_used / total_cap * 100, 1) if total_cap else 0
        units = int(t.get('units') or sum(m['units'] for m in mix.values()))
        for m in mix.values():
            m['pct'] = round(m['units'] / units * 100, 1) if units else 0
            m['dongs'] = sorted(set(m['dongs']))
        if isinstance(p.get('unit_mix'), dict):       # maxfar 가 주면 그 숫자 우선(세대수·면적)
            for key, v in p['unit_mix'].items():
                m = mix.setdefault(str(key), {'type': str(key), 'num': _label_num(key), 'units': 0, 'dongs': [], 'upf': 0, 'pct': 0})
                if isinstance(v, dict):
                    m.update({kk: vv for kk, vv in v.items() if kk in ('units', 'pct', 'area_m2', 'supply_m2', 'dongs', 'upf')})
        mix_rows = sorted(mix.values(), key=lambda m: -(m['num'] or 0))
        units84 = sum(m['units'] for m in mix_rows if m['num'] and 80 <= m['num'] <= 90)
        share84 = round(units84 / units * 100, 1) if units else 0
        failed = p.get('checks_failed') or []
        by_rule = {}
        for c in failed:
            by_rule.setdefault(c.get('rule') or c.get('id') or 'check', []).append(c)
        cbr = p.get('checks_by_rule') if isinstance(p.get('checks_by_rule'), dict) else None
        check_rows = []
        for rule in (list(cbr) if cbr else ['86조① 정북 일조', '86조③1호 채광창-인접대지경계', '86조③2호 인동간격', '동지 일조']):
            v = cbr.get(rule) if cbr else None
            if isinstance(v, str) and '/' in v:                              # maxfar: "통과/전체"
                ok_n, tot = (int(x) for x in v.split('/')[:2])
                check_rows.append({'rule': rule, 'ok': ok_n == tot, 'text': f"{ok_n}/{tot}"})
            elif isinstance(v, dict):
                ok_n, tot = int(v.get('ok', 0)), int(v.get('total', 0))
                check_rows.append({'rule': rule, 'ok': ok_n == tot, 'text': f"{ok_n}/{tot}"})
            else:
                nf = sum(len(v) for r, v in by_rule.items() if any(w in r for w in rule.split()[:1]) or r == rule)
                check_rows.append({'rule': rule, 'ok': nf == 0, 'text': ('통과' if nf == 0 else f'불통 {nf}건') if blds else '검사 없음'})
        blocked = p.get('blocked_by') or ([p['reason']] if status == '불가' and p.get('reason') else []) or (list(by_rule) if status == '불가' else [])
        form = form_of(p.get('title', ''))
        prog = next((f for f in program.get('forms', []) if f.get('form') == form), None)
        n_fail = len(failed); checks_ok = bool(p.get('checks_ok', True))
        # 규칙 실패 글자(제자리) — 짝 중심 사이
        bmap = {b['id']: Polygon(b['poly']).centroid for b in blds if b.get('id')}
        callouts = []
        for rule, cs in list(by_rule.items())[:12]:
            c0 = cs[0]; a, bb = bmap.get(c0.get('a')), bmap.get(c0.get('b'))
            if a is None:
                continue
            x, y = ((a.x + bb.x) / 2, (a.y + bb.y) / 2) if bb is not None else (a.x, a.y + h / 1000 * 1.2)
            callouts.append({'position': frame.mm(x, y), 'text': f"불통 {rule} ({len(cs)}건)"})
            draw.append(_text(frame, x, y, f"불통 {rule} ({len(cs)}건)", h * 0.75, tag, layer=PLAN_LAYER))
        floors_list = [int(b.get('floors') or 0) for b in blds]
        heights = [float(b.get('height_m') or 0) for b in blds]
        far_pct = round(total_used / site_poly.area * 100, 1); far_cap_pct = round(total_cap / site_poly.area * 100, 1)
        # 건축개요 (없는 값은 '산정 필요')
        inc_applied = eng.get('incentive_applied') or []
        ov = [['건축개요', [f"대지위치  {eng.get('address') or '산정 필요'}", f"지역지구  {' / '.join(dict.fromkeys(pp['zone'] for pp in parts))}", f"대지면적  {site_poly.area:,.2f} ㎡"] +
               [f"  · {pp['zone']}  {pp['area_m2']:,.2f} ㎡" for pp in parts] +
               [f"건축면적  {total_foot:,.2f} ㎡", f"건폐율  법정 {round(sum(bcr_caps.values()) / site_poly.area * 100, 1):g} % / 계획 {round(total_foot / site_poly.area * 100, 2):g} %",
                f"연면적  지상 {total_used:,.2f} ㎡ (용적률 산정용) · 지하 산정 필요", f"용적률  법정 {far_cap_pct:g} % / 계획 {far_pct:g} %"] +
               [f"  · {r['zone']}  법정 {r['far_cap_pct']:g} % / 계획 {r['far_used_pct']:g} % (채움 {r['fill_pct']:g} %)" for r in per_piece] +
               [f"규모  지상 {len(blds)}개 동 · 최고 {max(floors_list) if floors_list else 0}층 / 최저 {min(floors_list) if floors_list else 0}층 · 지하 산정 필요", f"높이  최고 {max(heights) if heights else 0:g} m (층고 {FLOOR_H} m)",
                f"세대수  {units:,} 세대"] + [f"  · {m['type']}형  {m['units']:,}세대 ({m['pct']:g}%) · 층당 {m['upf']}호 · {', '.join(str(d) + '동' for d in m['dongs'][:12])}" + (f" · 전용 {m['area_m2']:g}㎡" if m.get('area_m2') else '') for m in mix_rows] +
               [f"주동 형식  {form} ({', '.join(dict.fromkeys(str(b.get('block')) for b in blds)) or '-'})", f"일조·인동  {'통과' if checks_ok else f'불통 {n_fail}건'}" + ''.join(f" · {c['rule']} {c['text']}" for c in check_rows),
                f"적용 인센티브  {', '.join(inc_applied) if inc_applied else '없음'}" + (f"  (가정: {', '.join(eng.get('incentive_assumed') or [])})" if eng.get('incentive_assumed') else '')]]]
        if status == '불가':
            ov.append(['우선 확인사항', ['이 형식은 규칙을 못 지킴(불가) — 막은 규칙: ' + ', '.join(map(str, blocked))]])
        summary = [f"{p.get('title', tag)} ({form}) {status}", f"용적 채움 {fill:g}% ({far_pct:g}% / 상한 {far_cap_pct:g}%)", f"{len(blds)}동 · {units:,}세대 · 84형 {share84:g}%",
                   f"일조·인동 {'통과' if checks_ok else f'불통 {n_fail}건'}"] + ([f"계산표 {prog['dongs']}동×{prog['floors']}F×{prog['units_per_floor']} = {prog['units']:,}세대 ↔ 결과 {units:,}세대"] if prog else []) + (['막은 규칙: ' + ', '.join(map(str, blocked))] if blocked else [])
        out.append({'title': p.get('title', tag), 'form': form, 'status': status, 'blocked_by': blocked, 'fill_pct': fill, 'far_pct': far_pct, 'far_cap_pct': far_cap_pct, 'bcr_pct': round(total_foot / site_poly.area * 100, 2),
                    'gfa_m2': round(total_used, 1), 'buildings_n': len(blds), 'units': units, 'share84_pct': share84, 'floors_max': max(floors_list) if floors_list else 0, 'floors_min': min(floors_list) if floors_list else 0,
                    'height_max_m': max(heights) if heights else 0, 'per_piece': per_piece, 'unit_mix': mix_rows, 'checks_ok': checks_ok, 'checks_failed_n': n_fail, 'checks_by_rule': {k: len(v) for k, v in by_rule.items()},
                    'check_rows': check_rows, 'callouts': callouts, 'program': prog, 'summary': ' · '.join(summary), 'summary_lines': summary, 'totals': t, 'draw': draw, 'buildings': bl_out,
                    'sheets': [{'title': f"건축개요 · {p.get('title', tag)}", 'groups': ov}], 'warnings': p.get('warnings') or [], 'block_codes': list(dict.fromkeys(str(b.get('block')) for b in blds)),
                    'mode': p.get('mode'), 'review': p.get('review'), 'seconds': p.get('seconds'),
                    'target_plan': {k: (p.get('target_plan') or {}).get(k) for k in ('target_far_pct', 'confirmed_far_pct', 'reached_pct', 'gap_pct', 'assumptions', 'next_levers', 'note')}})
    drawings = block_drawings([c for c in all_codes if c]) if drawings else None
    return {'plans': out, 'floors': floors, 'note': note, 'engine': eng, 'site_mm': [frame.mm(x, y) for x, y in eng['site']],
            'parts_mm': [{'zone': pp['zone'], 'area_m2': pp['area_m2'], 'far': pp['far'], 'points': [frame.mm(x, y) for x, y in pp['poly']]} for pp in parts],
            'contours_mm': contours_mm, 'terrain': ({k: v for k, v in terr.items() if k != 'contours'} if terr else None), 'north_vec': north_vec,
            'drawings': drawings, 'text_h': h}


# ── 빠른 검토(무료·회원) · 정밀 검토(P) — 사장님 2026-10-18 ─────────────────────────────────
# 기본은 배치 엔진 서버(맥미니)에 작업을 보낸다. BARUN_APARTMENT_LOCAL=1 일 때만 이 PC 에서 뒤에서 계산(개발 시험용).
# 결과는 어느 쪽이든 _render 로 도면 글자·레이어(아파트-검토 미리보기 · [이 안 그리기] 아파트-배치)로 그린다.
# 빠른 검토 = 대표 동 9종만 시간 제한 탐색(안마다 30초). 아래 값은 배치 엔진 services/site-plan/apartment_job.py 와 같게 둔다 — 바꾸면 같이.
QUICK_BLOCKS = ['참고 판상 58x13 84x4', '참고 판상 58x13 59x2 84x2', '84 84 84 84 판상', '？ 판상-9', '？ 판상-2', '？ 판상-5',
                '？ 타워', '59 59 타워', '84 84 84 84 ㄱ자-13']
QUICK_TIME_S = 30
REVIEW_MODES = ('84', 'max')
REVIEW_TITLES = {'84': '1안 84타입 주력', 'max': '2안 최대 용적'}
_JOBS = {}
_JOBS_LOCK = threading.Lock()


def _review_opts(eng, data, ents, frame):
    """서버 작업이 받는 계획 조건만(app.py APT_OPTS 허용 목록). 인센티브는 엔진이 최대로 고른다."""
    roads = [frame.m(e['points']) for e in ents if e.get('parcelRole') == 'road' and e.get('type') == 'polyline' and e.get('closed') and len(e.get('points', [])) >= 3]
    o = {'zone': (eng.get('zoning') or {}).get('zone') or eng['parts'][0]['zone'], 'roads': (roads + (eng.get('roads') or []))[:300], 'floor_h': FLOOR_H,
         'max_units': max(1, min(16, int(data.get('maxUnitsPerFloor') or 8))), 'redevelopment': bool(data.get('redevelopment')),
         'north_exempt': bool(data.get('northExempt')), 'sun_gate': bool(data.get('sunGate'))}
    if data.get('heightLimit'):
        o['floors_max'] = max(3, min(80, int(float(data['heightLimit']) // FLOOR_H)))
    extra = {k: v for k, v in (data.get('siteExtra') or {}).items() if isinstance(v, (int, float)) and not isinstance(v, bool)}
    if extra:
        o['incentive_site'] = extra
    o.update(_picks(data))
    return o


def _picks(data):
    """[사장님 2026-10-18] 인센티브 빼기·등급 낮추기 — 서버 opts incentive_exclude·incentive_choices. 없으면 엔진이 최대로 고른다."""
    exclude = [str(i)[:60] for i in (data.get('incentiveExclude') or []) if i][:30]
    choices = {str(k)[:60]: v for k, v in (data.get('incentiveChoices') or {}).items() if isinstance(v, (str, bool, dict))}
    out = {}
    if exclude:
        out['incentive_exclude'] = exclude
    if choices:
        out['incentive_choices'] = dict(list(choices.items())[:30])
    return out


def _choice_label(ch):
    if ch is True:
        return '적용'
    if isinstance(ch, dict):
        return str(ch.get('tier', '적용')) + (' · 특별공급' if ch.get('special_supply') else '')
    return str(ch)


def _user_selections(incentive, base, site, exclude=(), choices=None):
    """인센티브 최대(max_selections)에서 사용자가 뺀 항목·낮춘 등급만 바꾼 선택. max_selections 와 같은 모양으로 돌려준다(이 PC 계산용 — 서버는 같은 규칙을 서버 코드로)."""
    choices = choices or {}
    off = set(exclude) | {k for k, v in choices.items() if v in ('미적용', False, None)}
    mx = incentive.max_selections(base, site, exclude=tuple(off))
    sel = dict(mx['selections'])
    for k, v in choices.items():
        if k not in off:
            sel[k] = v
    res = incentive.apply(base, site, sel)
    far = res['legal']['far']
    names = {it['id']: it for it in incentive.RULES['items']}
    picked = []
    for k, v in sel.items():
        gain = far - incentive.apply(base, site, {a: b for a, b in sel.items() if a != k})['legal']['far']
        it = names.get(k, {})
        picked.append({'id': k, 'name': it.get('name', k), 'choice': v, 'far_gain': round(gain, 4), 'confirmed': it.get('_confirmed', True)})
    assumptions = [f"{p['name']} — {_choice_label(p['choice'])} 받는다고 가정" + ('' if p['confirmed'] else ' (등급별 비율 원문 미확인)') for p in picked]
    return {'selections': sel, 'result': res, 'picked': picked, 'assumptions': assumptions, 'far_base': mx['far_base'], 'far_max': far,
            'daylight_factor': float(res.get('daylight_factor') or 1.0)}


VALUE_ITEMS = {'public_facility_land': 'public_land_m2', 'open_space_building_act': 'open_space_m2', 'open_space_district_plan': 'open_space_m2',
               'block_guideline_height': 'block_guideline_height_add_m', 'landscape_upgrade': 'landscape_m2'}


def _inc_table_local(parts, opts):
    """인센티브 표(이 PC 엔진) — 서버 POST /site-plan/apartment/incentive 와 같은 모양."""
    _engine()
    import incentive
    main = max(parts, key=lambda p: p['area_m2'])  # shortcut: 가장 큰 조각만(이 PC 시험용) — 여러 용도지역 대지는 서버 결과 기준
    base = {'bcr': main['bcr'] / 100, 'far': main['far'] / 100, 'height': main.get('height_m')}
    site = {'area_m2': main['area_m2'], 'zone': main['zone'], **(opts.get('incentive_site') or {})}
    exclude, choices = opts.get('incentive_exclude') or [], opts.get('incentive_choices') or {}
    mx = incentive.max_selections(base, site)
    cur = _user_selections(incentive, base, site, exclude, choices) if (exclude or choices) else mx
    conf = incentive.max_selections(base, site, confirmed_only=True)
    base_far = mx['far_base']
    items = []
    for it in incentive.RULES['items']:
        iid = it['id']
        opts_ = [c for c in incentive._choices(it)]
        gains = []
        for ch in opts_:
            try:
                gains.append((ch, incentive.apply(base, site, {iid: ch})['legal']['far'] - base_far))
            except Exception:  # noqa: BLE001 — 이 대지에 안 맞는 선택지
                continue
        useful = [c for c, g in gains if g > 1e-9]
        group = 'auto' if iid in AUTO_ITEMS else 'value' if iid in VALUE_ITEMS else 'assumed'
        if not useful and group != 'value':
            continue
        on = iid in cur['selections']
        gain = next((p['far_gain'] for p in cur['picked'] if p['id'] == iid), 0.0)
        if cur is mx and on:   # 최대 그대로일 때도 '뺐을 때 대비' 이득
            gain = mx['result']['legal']['far'] - incentive.apply(base, site, {a: b for a, b in mx['selections'].items() if a != iid})['legal']['far']
        ch_list = [{'label': _choice_label(c), 'value': c} for c in (useful or ([True] if group == 'value' else []))] + [{'label': '미적용', 'value': '미적용'}]
        mc = mx['selections'].get(iid)
        items.append({'id': iid, 'name': it.get('name', iid), 'group': group, 'on': on, 'choices': ch_list,
                      'choice': {'label': _choice_label(cur['selections'][iid]), 'value': cur['selections'][iid]} if on else None,
                      'max_choice': {'label': _choice_label(mc), 'value': mc} if mc is not None else None,
                      'far_gain_pct': round(gain * 100, 1), 'confirmed': it.get('_confirmed', True) is not False,
                      'needs': NEEDS_VALUE.get(iid, '') if group == 'value' else '', 'param': VALUE_ITEMS.get(iid, '')})
    green_used = sum(i['far_gain_pct'] for i in items if i['id'] in incentive.GREEN_IDS and i['on'])
    return {'base_far_pct': round(base_far * 100, 1), 'max_far_pct': round(mx['far_max'] * 100, 1), 'far_pct': round(cur['far_max'] * 100, 1),
            'confirmed_far_pct': round(conf['far_max'] * 100, 1), 'daylight_relax': cur['daylight_factor'],
            'green': {'limit_pct': round(main['far'] * 0.15, 1), 'used_pct': round(green_used, 1)}, 'items': items, 'zone': main['zone'], 'area_m2': main['area_m2']}


def incentive_table(data):
    """인센티브 표: 대지(가두리)를 묶고 최대 인센티브 → 사용자가 빼거나 낮춘 조건의 목표 용적률. 다시 부를 때는 enclose 결과(engine)를 넘겨 다시 묶지 않는다."""
    enc = data.get('enclose') if isinstance(data.get('enclose'), dict) and (data['enclose'].get('engine') or {}).get('parts') else enclose(data)
    eng = enc['engine']
    height = float(data['heightLimit']) if data.get('heightLimit') else None
    parts = [{**{k: p[k] for k in ('zone', 'area_m2', 'far', 'bcr', 'poly')}, **({'height_m': height} if height else {})} for p in eng['parts']]
    opts = {k: v for k, v in _review_opts(eng, data, _flat(data.get('entities')), _frame_from(eng.get('frame'))).items() if k in ('zone', 'incentive_site', 'incentive_exclude', 'incentive_choices')}
    if engine_local():
        table = _inc_table_local(parts, opts)
        where = 'local'
    else:
        table = _server('/site-plan/apartment/incentive', {'crs': 'EPSG:5179', 'parts': parts, 'opts': opts})
        where = 'server'
    return {'enclose': enc if not data.get('enclose') else None, 'table': table, 'where': where}


def _inc_for(target_plan, parts, opts, confirmed_only):
    """target_plan._inc + 사용자 고르기(incentive_exclude·incentive_choices). 엔진이 opts 로 받게 되면 없앤다."""
    if confirmed_only or not (opts.get('incentive_exclude') or opts.get('incentive_choices')):
        return _ORIG_INC.get(target_plan, target_plan._inc)(parts, opts, confirmed_only)
    import incentive
    main = max(parts, key=lambda p: p['area_m2'])  # shortcut: 가장 큰 조각만(이 PC 시험용) — 여러 용도지역 대지는 서버 결과 기준
    return _user_selections(incentive, {'bcr': main['bcr'] / 100, 'far': main['far'] / 100, 'height': main.get('height_m')},
                            {'area_m2': main['area_m2'], 'zone': main['zone'], **(opts.get('incentive_site') or {})},
                            opts.get('incentive_exclude') or [], opts.get('incentive_choices') or {})


_ORIG_INC = {}


def _local_plan(review, parts, opts, mode):
    _engine()
    import target_plan
    if target_plan not in _ORIG_INC:   # 정밀 검토(target_plan.plan)도 사용자 고르기를 쓰게 감싼다
        _ORIG_INC[target_plan] = target_plan._inc
        target_plan._inc = lambda p, o, c: _inc_for(target_plan, p, o, c)
    if review == 'quick':
        import maxfar
        tgt = target_plan._inc(parts, opts, False)
        o = {**opts, 'incentive_selections': tgt['selections'], 'block_prefix': QUICK_BLOCKS, 'multi_start': False}
        if tgt['daylight_factor'] > 1.0:
            o['daylight_relax'] = tgt['daylight_factor']
        if mode == '84':
            o['allow_types'] = ['84']
        try:
            r = maxfar.optimize(parts, o, time_s=QUICK_TIME_S, use_jev=False, workers=2)
        except Exception:  # noqa: BLE001 — 작업 프로세스 풀이 안 되는 실행 환경(설치판 등)
            r = maxfar.optimize(parts, o, time_s=QUICK_TIME_S, use_jev=False, workers=1)
        ok = [p for p in r.get('plans') or [] if p.get('status') == 'ok' and p.get('checks_ok')]
        p = max(ok or r.get('plans') or [{}], key=lambda x: (x.get('totals') or {}).get('gfa_m2', 0))
        p['title'] = f"빠른 검토 · {REVIEW_TITLES[mode]} · {p.get('form', '')}".rstrip(' ·')
        p['target_plan'] = {'target_far_pct': round(tgt['far_max'] * 100, 1), 'incentives': tgt['picked'], 'assumptions': tgt['assumptions'],
                            'daylight_relax': tgt['daylight_factor'], 'reached_pct': (p.get('totals') or {}).get('far_pct'),
                            'note': '빠른 검토 — 대표 동 %d종만, 탐색 %d초. 전체 주동·각도 1°·단계별 검토는 정밀 검토' % (len(QUICK_BLOCKS), QUICK_TIME_S)}
    else:
        try:
            p = target_plan.plan(parts, opts, mode=mode)
        except Exception:  # noqa: BLE001 — BrokenProcessPool 등
            p = target_plan.plan(parts, opts, mode=mode, workers=1)
        p['title'] = p.get('title') or REVIEW_TITLES[mode]
    p['mode'], p['review'] = mode, review
    return p


def _run_local(job_id, review, parts, opts):
    job = _JOBS[job_id]
    job.update(status='running', started_at=time.time())
    try:
        for mode in REVIEW_MODES:
            job['current'] = mode
            t0 = time.time()
            p = _local_plan(review, parts, opts, mode)
            p['seconds'] = round(time.time() - t0, 1)
            job['plans'] = job['plans'] + [p]
            job['done'] = job['done'] + [mode]
        job['status'] = 'done'
    except Exception as error:  # noqa: BLE001 — 이유는 상태에 남긴다
        job.update(status='failed', error=f'{type(error).__name__}: {str(error)[:200]}')
    job.update(current=None, finished_at=time.time())


def _server(path, body=None):
    """배치 엔진 서버(웹 프록시) — 로그인한 회원만(401). 계정 연결 토큰·예전 이메일 세션을 같이 보낸다."""
    import json
    import urllib.error
    import urllib.request
    import parcel_service
    headers = {'Content-Type': 'application/json', 'User-Agent': 'BarunCAD/3'}
    if hasattr(parcel_service, 'auth_headers'):
        headers.update(parcel_service.auth_headers())
    elif parcel_service.cookie():
        headers['Cookie'] = parcel_service.cookie()
    req = urllib.request.Request(parcel_service.BASE + path, data=json.dumps(body, allow_nan=False).encode() if body is not None else None,
                                 headers=headers, method='POST' if body is not None else 'GET')
    try:
        with urllib.request.urlopen(req, timeout=60) as response:
            raw = response.read(40_000_001)
    except urllib.error.HTTPError as error:
        if error.code == 401:
            raise ValueError('아파트 배치 검토는 로그인한 회원만 쓸 수 있습니다(빠른 검토 무료). 오른쪽 위 [계정 연결]에서 로그인하세요.') from None
        try:
            reason = json.loads(error.read(20_000)).get('error')
        except (ValueError, AttributeError):
            reason = None
        raise ValueError(reason or f'배치 엔진 서버 응답 오류 ({error.code})') from None
    except (urllib.error.URLError, TimeoutError):
        raise ValueError('배치 엔진 서버에 연결하지 못했습니다. 잠시 후 다시 시도하세요.') from None
    if len(raw) > 40_000_000:
        raise ValueError('배치 결과가 너무 큽니다.')
    return json.loads(raw)


def review(data):
    """[빠른 검토]·[정밀 검토] 접수: 가두리 묶기 → 작업 시작(로컬 또는 서버). 결과는 review_job 으로 조회."""
    rv = data.get('review')
    if rv not in ('quick', 'precise'):
        raise ValueError('review 는 quick(빠른 검토)·precise(정밀 검토) 중 하나입니다.')
    enc = data['enclose'] if isinstance(data.get('enclose'), dict) and (data['enclose'].get('engine') or {}).get('parts') else enclose(data)
    eng = enc['engine']
    ents = _flat(data.get('entities'))
    opts = _review_opts(eng, data, ents, _frame_from(eng.get('frame')))
    height = float(data['heightLimit']) if data.get('heightLimit') else None
    parts = [{**{k: p[k] for k in ('zone', 'area_m2', 'far', 'bcr', 'poly')}, **({'height_m': height} if height else {})} for p in eng['parts']]
    north = next((e.get('attributes', {}).get('northVector') for e in ents if e.get('attributes', {}).get('northVector')), [0, 1])
    if engine_local():
        with _JOBS_LOCK:
            if any(j['review'] == rv and j['status'] in ('queued', 'running') for j in _JOBS.values()):
                raise ValueError(('빠른' if rv == 'quick' else '정밀') + ' 검토를 이 PC 에서 계산 중입니다. 끝난 뒤 다시 누르세요.')
            job_id = uuid.uuid4().hex
            _JOBS[job_id] = {'review': rv, 'status': 'queued', 'queued_at': time.time(), 'modes': list(REVIEW_MODES), 'done': [], 'current': None, 'plans': [], 'error': None}
        threading.Thread(target=_run_local, args=(job_id, rv, parts, opts), daemon=True).start()
        where = 'local'
    else:
        job_id = _server('/site-plan/apartment/jobs', {'crs': 'EPSG:5179', 'parts': parts, 'opts': opts, 'review': rv, 'modes': list(REVIEW_MODES)})['job_id']
        where = 'server'
    return {'job_id': job_id, 'where': where, 'review': rv, 'modes': list(REVIEW_MODES), 'enclose': enc, 'north_vec': north}


def review_job(data):
    """작업 상태. 끝난 안이 have 개보다 많아지면 place(카드·도면 글자)를 같이 돌려준다 — 조회마다 다시 그리지 않게."""
    import re
    job_id = str(data.get('jobId') or '')
    if not re.fullmatch('[a-f0-9]{32}', job_id):
        raise ValueError('작업 번호를 확인하세요.')
    if data.get('where') == 'local':
        with _JOBS_LOCK:
            j = _JOBS.get(job_id)
            if j is None:
                raise ValueError('이 PC 의 계산 기록이 없습니다(바른 CAD 를 다시 켰으면 다시 실행하세요).')
            st = {**j, 'elapsed_s': round((j.get('finished_at') or time.time()) - (j.get('started_at') or j['queued_at']), 1)}
    else:
        st = _server(f'/site-plan/apartment/jobs/{job_id}')
    plans = st.get('plans') or []
    out = {k: st.get(k) for k in ('status', 'review', 'modes', 'done', 'current', 'elapsed_s', 'error')}
    out['job_id'], out['plans_n'] = job_id, len(plans)
    if plans and len(plans) > int(data.get('have') or 0) and data.get('engine'):
        bmeta = {}
        if engine_local():
            _engine()
            import placement
            bmeta = {b['code']: b for b in placement.load_blocks(max_units=8)}
        out['place'] = _render(plans, data['engine'], {}, max((int(b.get('floors') or 0) for p in plans for b in p.get('buildings') or []), default=0),
                               _target_note(plans), bmeta, data.get('textH'), data.get('northVec') or [0, 1], bool(bmeta) and data.get('drawings', True))
    return out


def run_all(data):
    """한 번에: 가두리 묶기 → 묶음별 법 검토 → 인센티브 최대 → 계산표 → 3안 배치. 단계별 결과를 모두 돌려준다(검토서는 각각).
    이 PC 엔진 전용(개발 시험) — 설치판에서는 엔진이 없어 ImportError → '내장 구성요소 누락'으로 보였다(10/22)."""
    if not engine_local():
        raise ValueError('한 번에 검토는 개발용입니다. [가두리로 대지 묶기] → 인센티브 표 → 빠른·정밀 검토(배치 엔진 서버) 순서로 실행하세요.')
    enc = enclose(data)
    inc = incentive_max({**data, 'engine': enc['engine'], 'textH': enc['text_h']})
    pl = place_max({**data, 'engine': inc['engine'], 'program': inc['program'], 'floorsMax': data.get('floorsMax') or inc['floors_max'], 'textH': enc['text_h']})
    return {'enclose': enc, 'incentive': inc, 'place': pl}


def process(data):
    action = (data or {}).get('action')
    if action == 'zones':
        return zones(data)
    if action == 'place':
        return place(data)
    if action == 'enclose':
        return enclose(data)
    if action == 'incentive_max':
        return incentive_max(data)
    if action == 'place_max':
        return place_max(data)
    if action == 'zone_suggest':
        return zone_suggest(data)
    if action == 'run_all':
        return run_all(data)
    if action == 'review':
        return review(data)
    if action == 'review_job':
        return review_job(data)
    if action == 'incentive_table':
        return incentive_table(data)
    raise ValueError('지원하지 않는 아파트 검토 동작입니다.')
