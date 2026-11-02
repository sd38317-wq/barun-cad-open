import unittest
import apartment_service as a


def site(pnu, pts, zones, hole=False, origin=None):
    return {'type': 'polyline', 'closed': True, 'parcelRole': 'site', 'points': [{'x': x, 'y': y} for x, y in pts],
            'attributes': {'pnu': pnu, 'jibun': pnu[-4:], 'ring': 'hole' if hole else 'outer', **({'originMetres': origin, 'sourceCRS': 'EPSG:5179'} if origin else {}),
                           'landInfo': {'zones': [{'code': 'UQA120', 'name': z, 'relation': '포함'} for z in zones] + [{'code': 'UQB100', 'name': '지구단위계획구역', 'relation': '포함'}]}}}


class ApartmentServiceTests(unittest.TestCase):
    def test_zone_names_skip_touching_and_non_area(self):
        info = {'zones': [{'code': 'UQA120', 'name': '제2종일반주거지역', 'relation': '포함'}, {'code': 'UQA210', 'name': '일반상업지역', 'relation': '접함'}]}
        self.assertEqual(a.zone_names(info), ['제2종일반주거지역'])

    def test_two_parcels_weighted(self):
        ents = [site('2611010100100010001', [[0, 0], [95000, 0], [95000, 60000], [0, 60000]], ['제2종일반주거지역']),
                site('2611010100100010002', [[95000, 0], [100000, 0], [100000, 60000], [95000, 60000]], ['일반상업지역'])]
        r = a.zones({'action': 'zones', 'entities': ents, 'layers': []})
        self.assertEqual(r['result']['mode'], 'weighted')
        self.assertEqual(len(r['draw']), 4)
        self.assertEqual(r['draw'][0]['points'][0].keys(), {'x', 'y'})
        self.assertIn('가중평균', r['table'])

    def test_one_parcel_two_zones_with_dashed_line(self):
        ents = [site('2611010100100010001', [[0, 0], [100000, 0], [100000, 60000], [0, 60000]], ['제2종일반주거지역', '일반상업지역'])]
        with self.assertRaises(ValueError):
            a.zones({'action': 'zones', 'entities': ents, 'layers': []})
        layers = [{'id': 'L1', 'name': '용도지역'}]
        ents += [{'type': 'polyline', 'closed': False, 'layer': 'L1', 'points': [{'x': 90000, 'y': -5000}, {'x': 90000, 'y': 65000}]},
                 {'type': 'text', 'layer': 'L1', 'text': '제2종일반주거지역', 'position': {'x': 50000, 'y': 30000}},
                 {'type': 'text', 'layer': 'L1', 'text': '일반상업지역', 'position': {'x': 95000, 'y': 30000}}]
        r = a.zones({'action': 'zones', 'entities': ents, 'layers': layers})
        self.assertEqual(r['result']['mode'], 'separate')
        self.assertEqual([p['zone'] for p in r['result']['parts']], ['제2종일반주거지역', '일반상업지역'])

    def test_block_group_and_no_site(self):
        with self.assertRaises(ValueError):
            a.zones({'action': 'zones', 'entities': [], 'layers': []})
        grouped = {'type': 'block', 'parcelGroup': True, 'entities': [site('2611010100100010001', [[0, 0], [50000, 0], [50000, 50000], [0, 50000]], ['제3종일반주거지역'])]}
        r = a.zones({'action': 'zones', 'entities': [grouped], 'layers': []})
        self.assertEqual(r['result']['mode'], 'single'); self.assertEqual(r['result']['site_area_m2'], 2500)


    def test_terrain_real_coords(self):
        from pyproj import Transformer
        x, y = Transformer.from_crs('EPSG:4326', 'EPSG:5179', always_xy=True).transform(129.058, 35.162)
        # 실제 가져오기 형식: 첫 점 = 삽입점(0,0), originMetres 가 그 점의 5179 m 좌표
        ents = [site('2623010100103840030', [[0, 0], [120000, 0], [120000, 80000], [0, 80000]], ['제2종일반주거지역'], origin=[x, y])]
        r = a.zones({'action': 'zones', 'entities': ents, 'layers': []})
        self.assertAlmostEqual(r['result']['site'][0][0], x, places=3)
        part = next(e for e in r['draw'] if e['type'] == 'polyline' and not e.get('apartmentLayer'))
        self.assertLess(min(abs(p['x']) + abs(p['y']) for p in part['points']), 5)   # 삽입점(0,0) 근처로 되돌아옴(mm, 반올림 오차)
        self.assertIn('경사:', r['table'])
        self.assertTrue(r['terrain'] and r['terrain']['elev_max'] >= r['terrain']['elev_min'])
        self.assertTrue(any(e.get('apartmentLayer') == '등고선' for e in r['draw']) or r['terrain']['range_m'] < 1)


    def test_incentive_and_height_limit(self):
        ents = [site('2611010100100010001', [[0, 0], [200000, 0], [200000, 120000], [0, 120000]], ['제2종일반주거지역'])]
        r = a.zones({'action': 'zones', 'entities': ents, 'layers': [], 'heightLimit': 30, 'incentives': {'green_building_cert': '1+/최우수', 'road_frontage': True},
                     'siteExtra': {'road_width_m': 30, 'road_frontage_m': 40}})
        self.assertIn('인센티브:', r['table'])
        self.assertGreater(r['result']['zoning']['far'], 200)
        self.assertEqual(r['result']['zoning']['far_base'], 200)
        self.assertGreaterEqual(r['height_limit_m'], 30)      # 녹색건축 높이 인센티브로 30 → 32.7m
        p = a.process({'action': 'place', 'entities': ents, 'layers': [], 'floors': 15, 'heightLimit': 30})
        self.assertEqual(p['floors'], 10)      # 30m / 2.9 → 10층
        self.assertIn('높이제한', p['zones']['table'])

    def test_highrise_refuge_and_elevators(self):
        ents = [site('2611010100100010001', [[0, 0], [200000, 0], [200000, 120000], [0, 120000]], ['제3종일반주거지역'])]
        r = a.process({'action': 'place', 'entities': ents, 'layers': [], 'floors': 35, 'northExempt': True})
        self.assertEqual(r['unit_floors'], 34)
        self.assertEqual(r['highrise']['class'], '준초고층')
        self.assertEqual(r['elevators']['count'], 2)
        self.assertIn('피난안전구역', r['zones']['table'])
        for p in r['plans']:
            for b in p['buildings']:
                self.assertEqual(b['gfa_m2'], round(b['far_area_per_floor_m2'] * 34, 1))   # 용적 = (전용+코어) × 세대 층수(피난층 제외)

    def test_place_three_plans(self):
        ents = [site('2611010100100010001', [[0, 0], [200000, 0], [200000, 120000], [0, 120000]], ['제2종일반주거지역'])]
        r = a.process({'action': 'place', 'entities': ents, 'layers': [], 'floors': 15})
        self.assertEqual(len(r['plans']), 3)
        self.assertTrue(all(p['totals']['buildings'] > 0 for p in r['plans']))
        self.assertTrue(all(p['totals']['far_pct'] <= 200.01 for p in r['plans']))
        self.assertTrue(any(e['type'] == 'polyline' and e['apartmentLayer'] == '아파트-배치' for e in r['plans'][0]['draw']))


if __name__ == '__main__':
    unittest.main()


def site_role(pnu, pts, zones, role='site', jibun=None):
    e = site(pnu, pts, zones)
    e['parcelRole'] = role; e['attributes']['jibun'] = jibun or (pnu[-4:] + ' 대'); e['attributes']['polygon'] = 0
    if not zones: e['attributes'].pop('landInfo', None)
    return e


def enclosure():
    ents = [site_role('2611010100100010001', [[0, 0], [100000, 0], [100000, 80000], [0, 80000]], ['제3종일반주거지역']),
            site_role('2611010100100010002', [[100000, 0], [160000, 0], [160000, 80000], [100000, 80000]], ['일반상업지역'], role='neighbor'),
            site_role('2611010100100010003', [[0, 80000], [160000, 80000], [160000, 90000], [0, 90000]], [], role='road', jibun='3 도'),
            site_role('2611010100100010004', [[-10000, 0], [0, 0], [0, 80000], [-10000, 80000]], [], role='road', jibun='4 도')]
    pl = [{'x': -5000, 'y': -5000}, {'x': 130000, 'y': -5000}, {'x': 130000, 'y': 95000}, {'x': -5000, 'y': 95000}]
    return ents, pl


class EncloseTests(unittest.TestCase):
    def test_enclose_mixed_zones_pl_cuts_parcel_roads_excluded(self):
        ents, pl = enclosure()
        r = a.process({'action': 'enclose', 'entities': ents, 'layers': [], 'pl': pl, 'fetchMissing': False, 'lookupZones': False})
        parts = r['engine']['parts']
        self.assertEqual([p['zone'] for p in parts], ['제3종일반주거지역', '일반상업지역'])
        self.assertEqual(parts[1]['area_m2'], 2400)                      # 상업 필지는 PL 로 잘려 30m × 80m 만
        self.assertEqual(r['engine']['site_area_m2'], 10400)
        road = next(p for p in r['parcels'] if p['jibun'] == '3 도')
        self.assertTrue(road['public_like'] and road['excluded'])        # 지목 '도' → 기존 도로, 기본 제외
        self.assertGreater(r['zone_area_m2'], r['engine']['site_area_m2'])   # 구역면적은 도로 포함
        self.assertTrue(any(f['jibun'] == '4 도' for f in r['frontage']))    # 가두리 밖 도로 = 접도
        self.assertIn('기존도로등 2필지', r['table'])
        self.assertEqual([s['title'] for s in r['sheets']], ['필지 검토서', '묶음별 검토'])
        self.assertTrue(any(e['type'] == 'text' and e['text'].startswith('묶음 1') for e in r['draw']))

    def test_enclose_include_road_and_user_zone_groups_win(self):
        ents, pl = enclosure()
        r = a.process({'action': 'enclose', 'entities': ents, 'layers': [], 'pl': pl, 'fetchMissing': False, 'lookupZones': False, 'includePnus': ['2611010100100010003']})
        self.assertEqual(r['engine']['site_area_m2'], 10400 + 1300)       # 도로 편입 (PL 안 130m × 10m)
        layers = [{'id': 'Z', 'name': '용도지역'}]
        ents2 = ents + [{'type': 'polyline', 'closed': True, 'layer': 'Z', 'points': [{'x': -5000, 'y': -5000}, {'x': 130000, 'y': -5000}, {'x': 130000, 'y': 95000}, {'x': -5000, 'y': 95000}]},
                        {'type': 'text', 'layer': 'Z', 'text': '준주거', 'position': {'x': 50000, 'y': 40000}}]
        r2 = a.process({'action': 'enclose', 'entities': ents2, 'layers': layers, 'pl': pl, 'fetchMissing': False, 'lookupZones': False})
        self.assertEqual([p['zone'] for p in r2['engine']['parts']], ['준주거지역'])   # 사용자 묶음 PL 우선 + 짧은 이름 보정
        self.assertTrue(any('≠ 자동 조회' in w for w in r2['warnings']))

    def test_incentive_max_assumed_items_and_untick(self):
        ents, pl = enclosure()
        r = a.process({'action': 'enclose', 'entities': ents, 'layers': [], 'pl': pl, 'fetchMissing': False, 'lookupZones': False})
        inc = a.process({'action': 'incentive_max', 'engine': r['engine'], 'heightLimit': 60})
        p = inc['pieces'][0]
        self.assertGreater(p['far_max_pct'], p['far_base_pct'])
        self.assertIn('장수명 주택 인증 (주택법 제38조)', p['assumed'])
        self.assertEqual(len(inc['program']['forms']), 3)
        self.assertEqual([s['title'] for s in inc['sheets']], ['인센티브 검토', '계산표'])
        off = [i['id'] for i in inc['items'] if i['group'] == 'assumed']
        inc2 = a.process({'action': 'incentive_max', 'engine': r['engine'], 'heightLimit': 60, 'incentiveOff': off})
        self.assertEqual(inc2['pieces'][0]['far_max_pct'], inc2['pieces'][0]['far_base_pct'])   # 가정 전부 끄면 기본으로
        self.assertEqual(inc2['pieces'][0]['assumed'], [])

    def test_place_max_fallback_cards_and_drawings(self):
        ents, pl = enclosure()
        r = a.process({'action': 'enclose', 'entities': ents, 'layers': [], 'pl': pl, 'fetchMissing': False, 'lookupZones': False})
        inc = a.process({'action': 'incentive_max', 'engine': r['engine'], 'incentiveOff': list(a.ASSUMED_ITEMS)})
        pm = a.process({'action': 'place_max', 'engine': inc['engine'], 'program': inc['program'], 'floorsMax': 20, 'useMaxfar': False, 'entities': ents})
        self.assertEqual(len(pm['plans']), 3)
        self.assertIn('TODO', pm['note'])
        for p in pm['plans']:
            self.assertEqual(len(p['per_piece']), 2)
            self.assertLessEqual(p['far_pct'], p['far_cap_pct'] + 0.01)
            self.assertTrue(p['unit_mix'] and all(m['dongs'] for m in p['unit_mix']))
            self.assertTrue(p['sheets'][0]['title'].startswith('건축개요'))
            self.assertTrue(any('산정 필요' in row for row in p['sheets'][0]['groups'][0][1]))   # 모르는 값(지하 등)은 지어내지 않음
            self.assertTrue(all(b['label'].endswith('F') and b['points_mm'] for b in p['buildings']))
        self.assertTrue(pm['drawings']['blocks'] and pm['drawings']['unit_types'])

    def test_place_max_uses_maxfar_when_available(self):
        from unittest.mock import patch
        ents, pl = enclosure()
        r = a.process({'action': 'enclose', 'entities': ents, 'layers': [], 'pl': pl, 'fetchMissing': False, 'lookupZones': False})
        inc = a.process({'action': 'incentive_max', 'engine': r['engine']})
        fake = [{'title': t, 'status': st, 'buildings': ([] if st == '불가' else [{'id': 'B1', 'block': 'J-001', 'floors': 20, 'unit_floors': 20, 'units_per_floor': 3, 'labels': ['84A', '84A', '84B'], 'gfa_m2': 3060, 'height_m': 58, 'poly': [[10, 10], [40, 10], [40, 22], [10, 22]]}]),
                 'totals': {'units': 60}, 'checks_ok': st != '불가', 'checks_failed': [] if st != '불가' else [{'rule': '86조① 정북', 'a': 'B1', 'ok': False}], 'blocked_by': ['86조① 정북'] if st == '불가' else None}
                for t, st in (('타워형', '가능'), ('판상형', '불가'), ('혼합형', '가능'))]
        with patch.object(a, '_maxfar_plans', return_value=fake):
            pm = a.process({'action': 'place_max', 'engine': inc['engine'], 'floorsMax': 20, 'drawings': False})
        self.assertEqual([p['status'] for p in pm['plans']], ['가능', '불가', '가능'])
        self.assertEqual(pm['plans'][1]['blocked_by'], ['86조① 정북'])
        self.assertEqual(pm['plans'][0]['share84_pct'], 100.0)
        self.assertEqual(pm['plans'][0]['unit_mix'][0]['dongs'], [101])

    def test_place_max_target_mode_uses_target_plan(self):
        """[2026-10-17] 배치 방식 '목표 배치' → 설계엔진 target_plan(1안 84타입·2안 최대 용적), 목표·단계 요약이 note 에."""
        from unittest.mock import patch
        ents, pl = enclosure()
        r = a.process({'action': 'enclose', 'entities': ents, 'layers': [], 'pl': pl, 'fetchMissing': False, 'lookupZones': False})
        inc = a.process({'action': 'incentive_max', 'engine': r['engine']})
        b = {'id': 'B1', 'block': 'J-001', 'floors': 20, 'unit_floors': 20, 'units_per_floor': 4, 'labels': ['84A'] * 4, 'gfa_m2': 8520, 'height_m': 58, 'poly': [[10, 10], [68, 10], [68, 23], [10, 23]]}
        fake = [{'title': t, 'status': 'ok', 'buildings': [b], 'totals': {'units': 80}, 'checks_ok': True, 'checks_failed': [],
                 'target_plan': {'target_far_pct': 340.0, 'confirmed_far_pct': 200.0, 'reached_pct': 210.0, 'steps': [{'step': '인센티브 최대 + 법규 그대로(1.0H)', 'far_pct': 190.0}], 'assumptions': ['녹색건축 — 가정']},
                 'outside_engine': {'green_note': '조경·오픈스페이스 추정 약 60% (도로·주차 22% 가정)'}}
                for t in ('1안 84타입 · x', '2안 최대 용적 · y')]
        with patch.object(a, '_target_plans', return_value=fake) as tp, patch.object(a, '_maxfar_plans') as mf:
            pm = a.process({'action': 'place_max', 'engine': inc['engine'], 'floorsMax': 20, 'drawings': False, 'planMode': 'target'})
        tp.assert_called_once(); mf.assert_not_called()
        self.assertEqual(len(pm['plans']), 2)
        self.assertIn('목표 340.0%', pm['note'])
        self.assertIn('도로·주차 22% 가정', pm['note'])

    def test_roads_reach_engine_for_86_6(self):
        """가두리 안에서 뺀 도로(3 도)와 밖에서 접한 도로(4 도)가 엔진 roads 로 넘어가 86조⑥ 중심선 완화에 쓰인다."""
        from unittest.mock import patch
        from shapely.geometry import Polygon
        ents, pl = enclosure()
        r = a.process({'action': 'enclose', 'entities': ents, 'layers': [], 'pl': pl, 'fetchMissing': False, 'lookupZones': False})
        roads = r['engine']['roads']
        self.assertTrue(roads)
        area = sum(Polygon(x).area for x in roads)
        self.assertGreaterEqual(area, 1300 - 1)                       # 적어도 가두리 안에서 뺀 3 도(130m × 10m)
        inc = a.process({'action': 'incentive_max', 'engine': r['engine']})
        seen = {}
        with patch.object(a, '_maxfar_plans', side_effect=lambda parts, opts: seen.update(opts) or None):
            a.process({'action': 'place_max', 'engine': inc['engine'], 'floorsMax': 20, 'drawings': False, 'useMaxfar': True})
        self.assertEqual(len(seen['roads']), len(roads))

    def test_zone_full_short_names(self):
        self.assertEqual(a.zone_full('3종일반'), '제3종일반주거지역'); self.assertEqual(a.zone_full('일반상업'), '일반상업지역'); self.assertEqual(a.zone_full('준주거지역'), '준주거지역')
        self.assertEqual(a.zone_full('묶음 1 · 일반상업지역 · 66,601㎡'), '일반상업지역')        # 지난 검토가 그린 묶음 글자(다시 돌릴 때)
        self.assertEqual(a.zone_full('묶음 2 · 3종일반'), '제3종일반주거지역')


class FrameCrsTests(unittest.TestCase):
    """계획 탭 ③ 주변 지적도는 EPSG:5187 로 그린다(A30). 아파트 계산은 5179 m 로 하고, 그림은 도면 mm 로 되돌린다."""
    def test_enclose_zone_layer_gap_keeps_site_one_piece(self):
        # 양정동 156-7(10-28, 실제 좌표): VWorld 용도지역 면 두 개가 필지 안에서 0.3㎡ 쐐기 틈을 둬 조각 합이 MultiPolygon → 엔진 'no attribute exterior'
        from unittest.mock import patch
        from shapely.geometry import Polygon
        from shapely.ops import unary_union
        import parcel_service
        o = [1143150.0, 1688220.0]
        m = lambda pts: Polygon([(o[0] + x, o[1] + y) for x, y in pts])
        lot = [[9.68, 17.514], [21.276, 10.108], [14.803, 0.158], [4.103, 6.851], [3.312, 7.355]]
        ents = [site('2623010100101560007', [[(x - lot[0][0]) * 1000, (y - lot[0][1]) * 1000] for x, y in lot], ['일반상업지역', '준주거지역'], origin=[o[0] + lot[0][0], o[1] + lot[0][1]])]
        pl = [dict(p) for p in ents[0]['points']]
        com = m([[4.103, 6.851], [10.61, 16.92], [21.276, 10.108], [14.803, 0.158]])
        zp = [(m([[10.572, 16.944], [4.103, 6.851], [3.312, 7.355], [9.68, 17.514]]), '준주거지역'), (com, '일반상업지역'), (com, '일반상업지역')]
        with patch.object(parcel_service, 'request', return_value=({}, {})), patch.object(parcel_service, 'zone_polygons_in_box', return_value=zp):
            r = a.process({'action': 'enclose', 'entities': ents, 'layers': [], 'pl': pl, 'fetchMissing': False})
        parts = r['engine']['parts']
        self.assertEqual([p['zone'] for p in parts], ['일반상업지역', '준주거지역'])
        self.assertEqual(unary_union([Polygon(p['poly']).buffer(0) for p in parts]).geom_type, 'Polygon')   # 엔진 maxfar.Problem 이 .exterior 를 쓴다
        self.assertAlmostEqual(sum(p['area_m2'] for p in parts), Polygon(lot).area, delta=0.05)

    def test_5187_site_round_trip_and_area(self):
        import korea_crs
        origin = [384000.0, 184000.0]           # 부산 근처 5187 m
        ent = {'type': 'polyline', 'closed': True, 'parcelRole': 'site', 'points': [{'x': 0, 'y': 0}, {'x': 80000, 'y': 0}, {'x': 80000, 'y': 100000}, {'x': 0, 'y': 100000}],
               'attributes': {'pnu': '1', 'ring': 'outer', 'sourceCRS': 'EPSG:5187', 'originMetres': origin}}
        fr = a.Frame(ent)
        self.assertEqual(fr.crs, 'EPSG:5187')
        want = korea_crs.transformer('EPSG:5187', 'EPSG:5179').transform(*origin)
        got = fr.m([ent['points'][0]])[0]
        self.assertAlmostEqual(got[0], want[0], places=3); self.assertAlmostEqual(got[1], want[1], places=3)   # 예전에는 원점 0 으로 떨어졌다
        back = fr.mm(*fr.m([ent['points'][2]])[0])
        self.assertAlmostEqual(back['x'], 80000, delta=1); self.assertAlmostEqual(back['y'], 100000, delta=1)
        from shapely.geometry import Polygon
        self.assertAlmostEqual(Polygon(fr.m(ent['points'])).area, 8000, delta=8)                      # 면적 왜곡 0.1% 안
        fr2 = a._frame_from(a._frame_dict(fr))
        self.assertEqual(fr2.crs, 'EPSG:5187'); self.assertAlmostEqual(fr2.m([ent['points'][2]])[0][0], fr.m([ent['points'][2]])[0][0], places=6)

    def test_5179_and_old_frame_dicts_unchanged(self):
        ent = site('1', [[0, 0], [1000, 0], [1000, 1000]], ['제2종일반주거지역'], origin=[900000.0, 1800000.0])
        fr = a.Frame(ent)
        self.assertEqual(fr.crs, 'EPSG:5179'); self.assertEqual(fr.m([{'x': 1000, 'y': 0}]), [[900001.0, 1800000.0]])
        old = a._frame_from({'ox': 1, 'oy': 2, 'ax': 0, 'ay': 0})                                        # crs 없는 예전 작업 번호
        self.assertEqual(old.crs, 'EPSG:5179'); self.assertEqual(old.mm(2, 2), {'x': 1000.0, 'y': 0.0})
