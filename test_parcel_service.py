import unittest
from unittest.mock import patch
import parcel_service as p
class ParcelTests(unittest.TestCase):
 def test_explicit_road_land_category(self):
  ring=[[[129,35],[129.0001,35],[129.0001,35.0001],[129,35]]]
  target=self.feature(ring);road=self.feature(ring,'other','2');road['properties']['jimok']='도로'
  self.assertEqual(p.drawing([target],[road],'test')['counts']['road'],1)
 def feature(self, coords, pnu='2611010100100010001', jibun='1 대'):
  return {'type':'Feature','properties':{'pnu':pnu,'jibun':jibun},'geometry':{'type':'Polygon','coordinates':coords}}
 def test_projection_holes_and_road_roles(self):
  outer=[[129,35],[129.0001,35],[129.0001,35.0001],[129,35.0001],[129,35]]
  hole=[[129.00002,35.00002],[129.00003,35.00002],[129.00003,35.00003],[129.00002,35.00002]]
  target=self.feature([outer,hole]);road=self.feature([outer],'2611010100100010002','2 도')
  r=p.drawing([target],[road],'2611010100100010001',1000,2000)
  self.assertEqual(r['counts'],{'site':2,'road':1,'neighbor':0})
  self.assertEqual(r['entities'][0]['points'][0],{'x':1000,'y':2000})
  self.assertEqual(r['entities'][1]['attributes']['ring'],'hole')
  self.assertGreater(r['entities'][0]['points'][1]['x']-1000,8000)
  self.assertEqual(len(r['entities'][0]['points']),4)
 def test_bad_pnu_never_requests_network(self):
  with patch.object(p,'request') as request:
   with self.assertRaises(ValueError):p.fetch({'pnu':'bad'})
   with self.assertRaises(ValueError):p.fetch({'pnus':[f'261101010010001{i:04d}' for i in range(11)]})
   request.assert_not_called()
 def test_fetches_up_to_ten_distinct_parcels_in_one_drawing(self):
  pnus=['2611010100100010001','2611010100100010002']
  def found(config,filters,size):
   value=filters['attrFilter'].split(':')[-1]
   offset=0 if value==pnus[0] else .0002
   return [self.feature([[[129+offset,35],[129.0001+offset,35],[129.0001+offset,35.0001],[129+offset,35]]],value,value+' 대')]
  with patch.object(p,'request',return_value=({'key':'k','domain':'example.com'},None)),patch.object(p,'features',side_effect=found),patch('miriboda_service.land_info',side_effect=lambda pnu,area,config:{'pnu':pnu,'zones':[]}):
   result=p.fetch({'pnus':pnus,'surroundings':False})
  self.assertEqual(result['pnus'],pnus);self.assertEqual(result['counts']['site'],2);self.assertEqual(set(result['landInfoByPnu']),set(pnus))
 def test_read_search_does_not_return_secrets(self):
  with patch.object(p,'cookie',return_value='test-session'),patch.object(p,'request',return_value=({'results':[{'pnu':'123','key':'private','jibunAddress':'주소'}]},None)):
   result=p.search('주소');self.assertNotIn('key',result['results'][0])
 def test_unauthenticated_parcel_does_not_fabricate_geometry(self):
  with patch.object(p,'request',side_effect=ValueError('로그인 필요')):
   with self.assertRaisesRegex(ValueError,'로그인'):p.fetch({'pnu':'2611010100100010001'})
 def test_search_requires_membership(self):
  with patch.object(p,'cookie',return_value=''),patch.object(p,'account_token',return_value=''),patch.object(p,'request') as request:
   with self.assertRaisesRegex(ValueError,'로그인'):p.search('부산 주소')
   request.assert_not_called()
 def test_expired_session_not_connected(self):
  with patch.object(p,'cookie',return_value='expired'),patch.object(p,'request',side_effect=ValueError('로그인 필요')):
   self.assertFalse(p.process({'action':'status'})['connected'])
 def test_signed_in_but_server_closed_is_not_login_required(self):
  # 공개 기간 서버는 앱 토큰 요청에 404 — 로그인은 있으니 '로그인 필요'가 아니라 '서버 준비 중'
  with patch.object(p,'account_token',return_value='tok'),patch.object(p,'request',side_effect=ValueError('지도 제공 서비스 응답 오류 (404)')):
   r=p.process({'action':'status'})
  self.assertFalse(r['connected']);self.assertTrue(r['signedIn']);self.assertIn('서버',r['message']);self.assertNotIn('로그인하세요',r['message'])


class ContextTests(unittest.TestCase):
 def test_long_road_is_clipped_but_site_coordinates_are_unchanged(self):
  import copy
  def entity(role,points):return {'type':'polyline','closed':True,'parcelRole':role,'points':[{'x':x,'y':y} for x,y in points],'attributes':{'pnu':role,'polygon':0,'ring':'outer'}}
  site=entity('site',[(0,0),(10000,0),(10000,10000),(0,10000)])
  road=entity('road',[(-1000000,-5000),(1000000,-5000),(1000000,-1000),(-1000000,-1000)])
  data={'entities':[site,road],'warnings':[]};original=copy.deepcopy(site)
  p.limit_context(data,30)
  self.assertEqual(data['entities'][0],original)
  points=data['entities'][1]['points'];self.assertGreaterEqual(min(q['x'] for q in points),-30000);self.assertLessEqual(max(q['x'] for q in points),40000)
  self.assertTrue(data['entities'][1]['attributes']['clippedToContext']);self.assertEqual(data['counts']['road'],1)
 def test_invalid_context_rejected_before_network(self):
  with patch.object(p,'request') as request:
   for size in [0,201,float('nan')]:
    with self.assertRaises(ValueError):p.fetch({'pnu':'2611010100100010001','contextMeters':size})
   request.assert_not_called()


def test_account_token_is_sent_as_bearer(monkeypatch):
    """[계정 연결] 토큰 하나로 서버 업무 기능 로그인 — Authorization: Bearer 로 보낸다(예전 이메일 쿠키는 있으면 같이)."""
    import parcel_service as ps
    monkeypatch.setattr(ps, 'account_token', lambda: 'a' * 64)
    monkeypatch.setattr(ps, 'cookie', lambda: '')
    assert ps.auth_headers() == {'Authorization': 'Bearer ' + 'a' * 64}
    assert ps.signed_in() is True

def test_basemap_stitches_tiles_and_maps_drawing_mm_to_image_px(monkeypatch):
    import io, base64, math
    from PIL import Image
    from pyproj import Transformer
    import parcel_service as ps
    buf = io.BytesIO(); Image.new('RGB', (256, 256), (10, 20, 30)).save(buf, 'PNG'); tile = buf.getvalue()
    monkeypatch.setattr(ps, 'request', lambda *a, **k: ({'key': 'secret-key', 'domain': 'barun.fly.dev'}, None))
    monkeypatch.setattr(ps, '_tile', lambda key, ref, layer, z, x, y: tile)
    ox, oy = Transformer.from_crs('EPSG:4326', 'EPSG:5187', always_xy=True).transform(127.36, 36.372)
    r = ps.basemap({'crs': 'EPSG:5187', 'originM': [ox, oy], 'bboxMm': [-100000, -100000, 100000, 100000], 'layer': 'Base', 'maxPx': 512})
    assert 'secret-key' not in str(r) and r['missingTiles'] == 0
    img = Image.open(io.BytesIO(base64.b64decode(r['image'].split(',')[1])))
    assert img.size == (r['width'], r['height']) and max(img.size) <= 512
    a, b, c, d, e, f = r['affine']
    # 지도는 도면 대비 약 1° 돈다(자오선 수렴) — 모서리 넷이 모두 그림 안에 들고, 맞춤에 안 쓴 네 번째 모서리도 0.5px 안에 맞아야 한다.
    to_geo = Transformer.from_crs('EPSG:5187', 'EPSG:4326', always_xy=True)
    corners = [(-100000, -100000), (100000, -100000), (-100000, 100000), (100000, 100000)]
    for x, y in corners:
        px, py = a * x + c * y + e, b * x + d * y + f
        assert -1 <= px <= r['width'] + 1 and -1 <= py <= r['height'] + 1
    world = [ps._world_px(*to_geo.transform(ox + x / 1000, oy + y / 1000), r['zoom']) for x, y in corners]
    left, top = math.floor(min(w[0] for w in world)), math.floor(min(w[1] for w in world))
    assert math.hypot(a * 100000 + c * 100000 + e - (world[3][0] - left), b * 100000 + d * 100000 + f - (world[3][1] - top)) < 0.5

def test_surroundings_buildings_heights_and_server_contours(monkeypatch):
    from pyproj import Transformer
    import parcel_service as ps
    ox, oy = 200000.0, 300000.0
    to_geo = Transformer.from_crs('EPSG:5187', 'EPSG:4326', always_xy=True)
    ring = lambda x, y, s: [list(to_geo.transform(ox + x, oy + y)) for x, y in ((x, y), (x + s, y), (x + s, y + s), (x, y + s), (x, y))]
    features = [{'properties': {'grnd_flr': '3', 'height': '12.6'}, 'geometry': {'type': 'MultiPolygon', 'coordinates': [[ring(10, 10, 8)]]}},
                {'properties': {'grnd_flr': '2', 'height': '20250101'}, 'geometry': {'type': 'Polygon', 'coordinates': [ring(-30, 0, 8)]}},
                {'properties': {'grnd_flr': '', 'height': ''}, 'geometry': {'type': 'Polygon', 'coordinates': [ring(-500, 0, 8)]}}]
    sent = {}
    def fake(url, data=None, **k):
        if url.endswith('/api/vworld'): return {'key': 'secret-key', 'domain': 'barun.fly.dev'}, None
        if url.endswith('/site-plan/terrain'):
            sent.update(data)
            return {'covered': True, 'source': 'test DEM', 'interval': 5, 'heights': [21.5, 20.0], 'minM': 18, 'maxM': 31,
                    'contours': [{'elevation': 20.0, 'major': False, 'points': [[ox - 50, oy], [ox, oy + 5], [ox + 50, oy]]},
                                 {'elevation': 25.0, 'major': True, 'points': [[ox - 50, oy + 40], [ox, oy + 45], [ox + 50, oy + 40]]}]}, None
        return {'response': {'status': 'OK', 'page': {'total': '1'}, 'result': {'featureCollection': {'features': features}}}}, None
    monkeypatch.setattr(ps, 'request', fake)
    r = ps.surroundings({'crs': 'EPSG:5187', 'originM': [ox, oy], 'bboxMm': [-60000, -60000, 60000, 60000]})
    assert 'secret-key' not in str(r) and sent['crs'] == 'EPSG:5187' and len(sent['points']) == 2 and sent['interval'] == 5
    b = [e for e in r['entities'] if e['parcelRole'] == 'building']
    assert len(b) == 2 and r['counts'] == {'buildings': 2, 'contours': 2}   # 범위 밖 건물(−500m)은 뺀다
    assert b[0]['model3d']['height'] == 12600 and b[0]['attributes']['groundM'] == 21.5
    assert b[1]['model3d']['height'] == 6600                                 # 날짜가 든 높이 → 2층 × 3.3m
    c = [e for e in r['entities'] if e['parcelRole'].startswith('contour')]
    assert [e['parcelRole'] for e in c] == ['contour', 'contour-major'] and c[0]['points'][1] == {'x': 0.0, 'y': 5000.0}
    # 서버가 등고선을 못 주면(배포 전 404 등) 건물만 넣고 알린다
    monkeypatch.setattr(ps, 'request', lambda url, data=None, **k: (_ for _ in ()).throw(ValueError('응답 오류 (404)')) if url.endswith('/site-plan/terrain') else fake(url, data))
    r = ps.surroundings({'crs': 'EPSG:5187', 'originM': [ox, oy], 'bboxMm': [-60000, -60000, 60000, 60000]})
    assert r['counts'] == {'buildings': 2, 'contours': 0} and any('등고선을 받지 못해' in w for w in r['warnings'])


class ParcelUnionTests(unittest.TestCase):
    def setUp(self):
        # 모든 union 시험은 로그인/원격 경로에 들어가면 즉시 실패한다.
        for name in ('request', 'signed_in', 'require_login', 'auth_headers'):
            mock = patch.object(p, name, side_effect=AssertionError('union은 로컬 계산만 해야 합니다.'))
            mock.start()
            self.addCleanup(mock.stop)

    def rectangle(self, x1, y1, x2, y2, part=1):
        return {'pnu': f'261101010010001{part:04d}',
                'outer': [[x1, y1], [x2, y1], [x2, y2], [x1, y2]], 'holes': []}

    def sariro(self, offset=0):
        return [self.rectangle(0, 0, 13525, 10000),
                self.rectangle(13525 + offset, 0, 22295 + offset, 10000, 2)]

    def assert_ring(self, result, count=None):
        from shapely.geometry import Polygon
        ring = result['ring']
        polygon = Polygon(ring)
        self.assertTrue(polygon.is_valid)
        self.assertTrue(polygon.exterior.is_ccw)
        self.assertNotEqual(ring[0], ring[-1])
        self.assertEqual(len(ring), len(set(map(tuple, ring))))
        self.assertAlmostEqual(polygon.area / 1000000, result['areaM2'])
        for i, point in enumerate(ring):
            a, b = ring[i - 1], ring[(i + 1) % len(ring)]
            cross = (point[0] - a[0]) * (b[1] - point[1]) - (point[1] - a[1]) * (b[0] - point[0])
            self.assertNotEqual(cross, 0, '직선 위 중복 꼭짓점')
            for value in point:
                self.assertEqual(value, round(value, 3))
        if count is not None:
            self.assertEqual(len(ring), count)

    def test_touching_sariro_rectangles(self):
        result = p.union({'rings': self.sariro()})
        self.assert_ring(result, 4)
        self.assertAlmostEqual(result['areaM2'], 222.95)
        self.assertAlmostEqual(result['partsAreaM2'], 222.95)
        self.assertEqual(result['pnus'], [parcel['pnu'] for parcel in self.sariro()])
        self.assertEqual(result['warnings'], [])

    def test_midpoint_gap_and_overlap(self):
        for variant in ('midpoint', 'gap', 'overlap'):
            with self.subTest(variant=variant):
                parcels = self.sariro(3 if variant == 'gap' else -3 if variant == 'overlap' else 0)
                if variant == 'midpoint':
                    parcels[1]['outer'].append([13525, 5000])
                result = p.union({'rings': parcels})
                self.assert_ring(result, 4)
                self.assertAlmostEqual(result['partsAreaM2'], 222.95)
                self.assertLess(abs(result['areaM2'] - result['partsAreaM2']) / result['partsAreaM2'], 0.001)
                self.assertEqual(result['warnings'], [])

    def test_distant_parcels_rejected(self):
        parcels = self.sariro(500)
        with self.assertRaisesRegex(ValueError, '맞닿지 않은.*' + parcels[0]['pnu'] + '.*' + parcels[1]['pnu']):
            p.union({'rings': parcels})

    def test_corner_contact_rejected(self):
        parcels = [self.rectangle(0, 0, 10000, 10000), self.rectangle(10000, 10000, 20000, 20000, 2)]
        for tol in (0, 20, 100):
            with self.subTest(tol=tol), self.assertRaisesRegex(ValueError, '맞닿지 않은'):
                p.union({'rings': parcels, 'snapMm': tol})

    def test_l_shape_connected_through_second_parcel(self):
        parcels = [self.rectangle(0, 0, 10000, 10000), self.rectangle(10000, 0, 20000, 10000, 2),
                   self.rectangle(10000, 10000, 20000, 20000, 3)]
        result = p.union({'rings': parcels})
        self.assert_ring(result, 6)
        self.assertAlmostEqual(result['areaM2'], 300)
        self.assertAlmostEqual(result['partsAreaM2'], 300)

    def test_unselected_central_parcel_rejected(self):
        parcels = [self.rectangle(0, 0, 30000, 10000), self.rectangle(20000, 10000, 30000, 20000, 2),
                   self.rectangle(0, 20000, 30000, 30000, 3), self.rectangle(0, 10000, 10000, 20000, 4)]
        with self.assertRaisesRegex(ValueError, '가운데'):
            p.union({'rings': parcels})

    def test_small_input_hole_rejected(self):
        parcels = [self.rectangle(0, 0, 10000, 10000), self.rectangle(10000, 0, 20000, 10000, 2)]
        parcels[0]['holes'] = [[[1000, 1000], [1500, 1000], [1500, 1500], [1000, 1500]]]
        with self.assertRaisesRegex(ValueError, '가운데'):
            p.union({'rings': parcels})

    def test_one_square_metre_hole_rejected(self):
        parcels = self.sariro()
        parcels[0]['holes'] = [[[1000, 1000], [2000, 1000], [2000, 2000], [1000, 2000]]]
        with self.assertRaisesRegex(ValueError, '가운데'):
            p.union({'rings': parcels})

    def test_process_union_is_local(self):
        result = p.process({'action': 'union', 'rings': self.sariro()})
        self.assert_ring(result, 4)
        self.assertAlmostEqual(result['areaM2'], 222.95)

    def test_snap_zero_does_not_fill_gap(self):
        self.assert_ring(p.union({'rings': self.sariro(), 'snapMm': 0}), 4)
        with self.assertRaisesRegex(ValueError, '맞닿지 않은'):
            p.union({'rings': self.sariro(3), 'snapMm': 0})

    def test_maximum_snap_and_parcel_count(self):
        parcels = [self.rectangle(1000 * i, 0, 1000 * (i + 1), 10000, i + 1) for i in range(40)]
        result = p.union({'rings': parcels, 'snapMm': 100})
        self.assert_ring(result, 4)
        self.assertAlmostEqual(result['areaM2'], 400)

    def test_overlap_warning_absolute_or_relative_threshold(self):
        examples = [([self.rectangle(0, 0, 100000, 100000), self.rectangle(99990, 0, 199990, 100000, 2)], 1.0),
                    ([self.rectangle(0, 0, 1000, 1000), self.rectangle(988, 0, 1988, 1000, 2)], 0.012)]
        for parcels, overlap in examples:
            with self.subTest(overlap=overlap):
                result = p.union({'rings': parcels})
                self.assertEqual(len(result['warnings']), 1)
                self.assertIn(f'필지 경계가 겹칩니다(약 {overlap:.3f}㎡)', result['warnings'][0])
                self.assertAlmostEqual(result['partsAreaM2'] - result['areaM2'], overlap)

    def test_overlap_exact_warning_threshold_has_no_warning(self):
        parcels = [self.rectangle(0, 0, 2000, 25000), self.rectangle(1980, 0, 3980, 25000, 2)]
        self.assertEqual(p.union({'rings': parcels})['warnings'], [])

    def test_large_area_change_rejected(self):
        for parcels in ([self.rectangle(0, 0, 10000, 10000), self.rectangle(9700, 0, 19700, 10000, 2)],
                        [self.rectangle(0, 0, 1000, 1000), self.rectangle(1003, 0, 2003, 1000, 2)]):
            # 두 번째 경우에는 작은 내부 구멍을 버릴 때 면적이 1% 넘게 커진다.
            if parcels[0]['outer'][1][0] == 1000:
                parcels[0]['holes'] = [[[100, 100], [600, 100], [600, 600], [100, 600]]]
            with self.subTest(parcels=parcels), self.assertRaisesRegex(ValueError, '면적이 크게 달라졌습니다|가운데'):
                p.union({'rings': parcels})

    def test_pnu_order_dedup_and_clockwise_closed_input(self):
        parcels = self.sariro()
        parcels.append(self.rectangle(22295, 0, 25000, 10000))
        parcels[0]['outer'].reverse()
        parcels[0]['outer'].append(parcels[0]['outer'][0][:])
        result = p.union({'rings': parcels})
        self.assert_ring(result, 4)
        self.assertEqual(result['pnus'], [parcels[0]['pnu'], parcels[1]['pnu']])

    def test_rounding_to_three_decimals(self):
        parcels = self.sariro()
        for parcel in parcels:
            parcel['outer'] = [[x + 0.123456, y + 0.654321] for x, y in parcel['outer']]
        self.assert_ring(p.union({'rings': parcels}), 4)

    def test_invalid_ring_counts(self):
        for parcels in (None, {}, [], self.sariro()[:1], [self.sariro()[0]] * 41):
            with self.subTest(parcels=parcels), self.assertRaisesRegex(ValueError, '2~40'):
                p.union({'rings': parcels})

    def test_invalid_point_counts_and_coordinates(self):
        invalid = [None, [], [[0, 0], [1, 0]], [[i, 0] for i in range(10001)],
                   [[0, 0], [1, 0], [float('nan'), 1]], [[0, 0], [1, 0], [1, float('inf')]],
                   [[0, 0], [1, 0], ['1', 1]], [[0, 0], [1, 0], [True, 1]],
                   [[0, 0], [1, 0], [1, 1, 0]], [[0, 0], [1, 0], [10 ** 400, 1]]]
        for points in invalid:
            with self.subTest(points=repr(points)[:100]):
                parcels = self.sariro()
                parcels[0]['outer'] = points
                with self.assertRaisesRegex(ValueError, '필지 경계'):
                    p.union({'rings': parcels})

    def test_invalid_snap(self):
        for tol in (-1, 101, float('nan'), float('inf'), '20', None, True, 10 ** 400):
            with self.subTest(tol=tol), self.assertRaisesRegex(ValueError, '0~100mm'):
                p.union({'rings': self.sariro(), 'snapMm': tol})

    def test_invalid_pnu_holes_and_geometry(self):
        import copy
        invalid = [None, {}, {**self.sariro()[0], 'pnu': 'bad'}, {**self.sariro()[0], 'holes': None},
                   {**self.sariro()[0], 'holes': [[[0, 0], [1, 1]]]},
                   {**self.sariro()[0], 'outer': [[0, 0], [1000, 1000], [0, 1000], [1000, 0]]},
                   {**self.sariro()[0], 'outer': [[0, 0], [1, 0], [2, 0]]},
                   {**self.sariro()[0], 'holes': [[[30000, 0], [31000, 0], [31000, 1000], [30000, 1000]]]}]
        for parcel in invalid:
            with self.subTest(parcel=parcel), self.assertRaises(ValueError):
                p.union({'rings': [copy.deepcopy(parcel), self.sariro()[1]]})


    def test_touching_union_preserves_narrow_concavity(self):
        parcels = [self.rectangle(0, 0, 10000, 10000), self.rectangle(10000, 0, 20000, 10000, 2)]
        parcels[0]['outer'] = [[0, 0], [10000, 0], [10000, 10000], [5010, 10000], [5010, 5000], [4990, 5000], [4990, 10000], [0, 10000]]
        result = p.union({'rings': parcels})
        self.assertAlmostEqual(result['areaM2'], 199.9)
        self.assertIn([5010, 5000], result['ring'])
        self.assertIn([4990, 5000], result['ring'])

    def test_gap_correction_rejects_changed_shape(self):
        parcels = [self.rectangle(0, 0, 10000, 10000), self.rectangle(10003, 0, 20003, 10000, 2)]
        parcels[0]['outer'] = [[0, 0], [10000, 0], [10000, 10000], [5010, 10000], [5010, 5000], [4990, 5000], [4990, 10000], [0, 10000]]
        with self.assertRaisesRegex(ValueError, '필지 경계를 맞추는 중 모양이 바뀌어 합칠 수 없습니다'):
            p.union({'rings': parcels})

    def test_input_holes_rejected_before_buffer_or_exterior(self):
        for tol, height, hole in [(20, 50000, [[5000, 5000], [5030, 5000], [5030, 45000], [5000, 45000]]),
                                  (0, 10000, [[1000, 1000], [1500, 1000], [1500, 1500], [1000, 1500]])]:
            parcels = [self.rectangle(0, 0, 10000, height), self.rectangle(10000, 0, 20000, height, 2)]
            parcels[0]['holes'] = [hole]
            with self.subTest(tol=tol), self.assertRaisesRegex(ValueError, '가운데'):
                p.union({'rings': parcels, 'snapMm': tol})

    def test_shared_boundary_requires_500mm_within_20mm(self):
        for x, y, h in [(10045, 0, 10000), (10000, 9900, 10000), (10003, 9900, 10000)]:
            parcels = [self.rectangle(0, 0, 10000, 10000), self.rectangle(x, y, x + 10000, y + h, 2)]
            with self.subTest(x=x, y=y), self.assertRaisesRegex(ValueError, '맞닿지 않은'):
                p.union({'rings': parcels})
        for gap in (0, 3, 20):
            result = p.union({'rings': [self.rectangle(0, 0, 10000, 10000), self.rectangle(10000 + gap, 0, 20000 + gap, 500, 2)]})
            self.assertGreater(result['areaM2'], 100)

    def test_small_artifact_hole_only_discarded_when_not_input_hole(self):
        parcels = [self.rectangle(0, 0, 20000, 10000), self.rectangle(0, 10000, 9900, 11000, 2),
                   self.rectangle(10100, 10000, 20000, 11000, 3), self.rectangle(0, 11000, 20000, 30000, 4)]
        self.assertAlmostEqual(p.union({'rings': parcels})['areaM2'], 600)


    def test_tilted_neighbor_with_3_to_6mm_gap(self):
        parcels = [self.rectangle(0, 0, 10000, 10000), self.rectangle(10003, 0, 20003, 1000, 2)]
        parcels[1]['outer'] = [[10003, 0], [20003, 0], [20006, 1000], [10006, 1000]]
        result = p.union({'rings': parcels})
        self.assertAlmostEqual(result['areaM2'], 110.0045)

    def test_shared_projection_threshold_excludes_corner_buffer_length(self):
        for shared in (470, 499):
            parcels = [self.rectangle(0, 0, 10000, 10000), self.rectangle(10000, 10000 - shared, 20000, 20000 - shared, 2)]
            with self.subTest(shared=shared), self.assertRaisesRegex(ValueError, '맞닿지 않은'):
                p.union({'rings': parcels})
        parcels = [self.rectangle(0, 0, 10000, 10000), self.rectangle(10000, 9500, 20000, 19500, 2)]
        self.assertAlmostEqual(p.union({'rings': parcels})['areaM2'], 200)

    def test_gap_with_interior_shared_edge_vertex_is_accepted(self):
        parcels = self.sariro(3)
        parcels[1]['outer'].append([13528, 5000])
        result = p.union({'rings': parcels})
        self.assert_ring(result, 4)
        self.assertAlmostEqual(result['areaM2'], 222.98)
        self.assertAlmostEqual(result['partsAreaM2'], 222.95)
        self.assertEqual(result['warnings'], [])

    def test_gap_with_shared_edge_vertex_rejects_filled_north_concavity(self):
        parcels = self.sariro(3)
        parcels[0]['outer'] = [[0, 0], [13525, 0], [13525, 10000],
                               [5010, 10000], [5010, 5000], [4990, 5000],
                               [4990, 10000], [0, 10000]]
        parcels[1]['outer'].append([13528, 5000])
        with self.assertRaisesRegex(ValueError, '필지 경계를 맞추는 중 모양이 바뀌어 합칠 수 없습니다'):
            p.union({'rings': parcels})

    def test_tilted_gap_with_interior_shared_edge_vertex_is_accepted(self):
        parcels = [self.rectangle(0, 0, 10000, 10000),
                   self.rectangle(10003, 0, 20003, 1000, 2)]
        parcels[1]['outer'] = [[10003, 0], [20003, 0], [20006, 1000],
                               [10006, 1000], [10004.5, 500]]
        result = p.union({'rings': parcels})
        self.assert_ring(result)
        self.assertAlmostEqual(result['areaM2'], 110.0045)
        self.assertAlmostEqual(result['partsAreaM2'], 110)
        self.assertEqual(result['warnings'], [])


    def test_polygon_union_fills_open_wedge_at_shared_edge(self):
        for gap in (3, 20):
            parcels = [self.rectangle(0, 0, 10000, 10000),
                       self.rectangle(10000, 0, 20000, 10000, 2)]
            parcels[1]['outer'] = [[10000, 0], [20000, 0], [20000, 10000],
                                   [10000 + gap, 10000], [10000, 5000]]
            with self.subTest(gap=gap):
                result = p.union({'rings': parcels})
                self.assert_ring(result, 4)
                self.assertAlmostEqual(result['areaM2'], 200)

    def test_polygon_open_wedge_with_snap_zero_is_preserved(self):
        parcels = [self.rectangle(0, 0, 10000, 10000),
                   self.rectangle(10000, 0, 20000, 10000, 2)]
        parcels[1]['outer'] = [[10000, 0], [20000, 0], [20000, 10000],
                               [10020, 10000], [10000, 5000]]
        result = p.union({'rings': parcels, 'snapMm': 0})
        self.assertAlmostEqual(result['areaM2'], 199.95)
        self.assertIn([10000, 5000], result['ring'])

    def test_donut_with_selected_inner_parcel(self):
        for gap in (0, 3, 20):
            parcels = [self.rectangle(0, 0, 20000, 20000),
                       self.rectangle(5000 + gap, 5000 + gap, 15000 - gap, 15000 - gap, 2)]
            parcels[0]['holes'] = [[[5000, 5000], [15000, 5000], [15000, 15000], [5000, 15000]]]
            with self.subTest(gap=gap):
                result = p.union({'rings': parcels})
                self.assert_ring(result, 4)
                self.assertAlmostEqual(result['areaM2'], 400)

    def test_donut_inner_parcel_beyond_snap_distance_rejected(self):
        parcels = [self.rectangle(0, 0, 20000, 20000),
                   self.rectangle(5021, 5021, 14979, 14979, 2)]
        parcels[0]['holes'] = [[[5000, 5000], [15000, 5000], [15000, 15000], [5000, 15000]]]
        with self.assertRaisesRegex(ValueError, '맞닿지 않은'):
            p.union({'rings': parcels})

    def test_donut_partially_selected_inner_parcel_preserves_unselected_hole(self):
        parcels = [self.rectangle(0, 0, 20000, 20000),
                   self.rectangle(5000, 5000, 14500, 15000, 2)]
        parcels[0]['holes'] = [[[5000, 5000], [15000, 5000], [15000, 15000], [5000, 15000]]]
        with self.assertRaisesRegex(ValueError, '가운데'):
            p.union({'rings': parcels})

    def test_polygon_open_wedge_beyond_snap_distance_is_preserved(self):
        parcels = [self.rectangle(0, 0, 10000, 10000),
                   self.rectangle(10000, 0, 20000, 10000, 2)]
        parcels[1]['outer'] = [[10000, 0], [20000, 0], [20000, 10000],
                               [10021, 10000], [10000, 5000]]
        result = p.union({'rings': parcels})
        self.assertAlmostEqual(result['areaM2'], 199.9475)
        self.assertIn([10000, 5000], result['ring'])

    def test_polygon_wedge_correction_rejects_filled_exterior_concavity(self):
        parcels = [self.rectangle(0, 0, 10000, 10000),
                   self.rectangle(10000, 0, 20000, 10000, 2)]
        parcels[0]['outer'] = [[0, 0], [10000, 0], [10000, 10000],
                               [5010, 10000], [5010, 5000], [4990, 5000],
                               [4990, 10000], [0, 10000]]
        parcels[1]['outer'] = [[10000, 0], [20000, 0], [20000, 10000],
                               [10020, 10000], [10000, 5000]]
        with self.assertRaisesRegex(ValueError, '필지 경계를 맞추는 중 모양이 바뀌어 합칠 수 없습니다'):
            p.union({'rings': parcels})

    def test_donut_partial_fill_does_not_discard_small_unselected_remainder(self):
        parcels = [self.rectangle(0, 0, 20000, 20000),
                   self.rectangle(5000, 5000, 14950, 15000, 2)]
        parcels[0]['holes'] = [[[5000, 5000], [15000, 5000], [15000, 15000], [5000, 15000]]]
        with self.assertRaisesRegex(ValueError, '가운데'):
            p.union({'rings': parcels})

    def test_donut_exact_inner_fill_with_snap_zero(self):
        parcels = [self.rectangle(0, 0, 20000, 20000),
                   self.rectangle(5000, 5000, 15000, 15000, 2)]
        parcels[0]['holes'] = [[[5000, 5000], [15000, 5000], [15000, 15000], [5000, 15000]]]
        result = p.union({'rings': parcels, 'snapMm': 0})
        self.assert_ring(result, 4)
        self.assertAlmostEqual(result['areaM2'], 400)


def test_merged_site_is_one_engine_parcel_without_original_neighbors():
    from shapely.geometry import Polygon
    from site_plan_service import from_drawing, boundary_entities

    parts = [{'pnu': '2629010800102130017', 'outer': [[0, 0], [13525, 0], [13525, 10000], [0, 10000]]},
             {'pnu': '2629010800102130018', 'outer': [[13525, 0], [22295, 0], [22295, 10000], [13525, 10000]]}]
    merged = p.process({'action': 'union', 'rings': parts})
    def entity(ring, role, pnu, layer):
        return {'type': 'polyline', 'closed': True, 'parcelRole': role, 'layer': layer,
                'points': [{'x': x, 'y': y} for x, y in ring],
                'attributes': {'ring': 'outer', 'pnu': pnu, 'sourceCRS': 'EPSG:5187', 'originMetres': [200000, 400000]}}
    # 합집합의 시작점은 원래 필지 첫 점과 달라도 지도 원점을 유지한다.
    ring = merged['ring'][1:] + merged['ring'][:1]
    site = entity(ring, 'site', parts[0]['pnu'], 'site')
    site['attributes']['originMetres'] = [200000 + ring[0][0] / 1000, 400000 + ring[0][1] / 1000]
    site['attributes']['insertionMm'] = ring[0]
    originals = [entity(part['outer'], 'site-original', part['pnu'], 'original') for part in parts]
    road = entity([[-4000, 0], [0, 0], [0, 10000], [-4000, 10000]], 'road', '', 'road')
    drawing = {'units': 'mm', 'entities': [site, *originals, road],
               'layers': [{'id': 'site', 'name': 'A-SITE'}, {'id': 'original', 'name': 'A-SITE-PARCEL'},
                          {'id': 'road', 'name': 'A-SITE-ROAD'}]}
    assert [e['parcelRole'] for e in boundary_entities(drawing)] == ['site', 'road']
    request = from_drawing(drawing)
    assert abs(Polygon(request['site']['parcel']).area - merged['areaM2']) < 1e-6
    assert request['site']['parcel'] == [[200000 + x / 1000, 400000 + y / 1000] for x, y in ring]
    assert len(request['site']['neighbors']) == 1
    assert request['site']['neighbors'][0]['jimok'] == '도'

if __name__ == '__main__':
    unittest.main()


class FetchSurroundingsTests(unittest.TestCase):
 """A12(10-21): 큰 대지(부산시청 70,373㎡)는 30m 둘레 필지가 100개를 넘는다. 한 쪽(100개)만 받아 대지 한 귀퉁이 필지만 그려졌다."""
 def square(self,pnu,x,jimok='대'):
  ring=[[129+x,35],[129.0001+x,35],[129.0001+x,35.0001],[129+x,35.0001],[129+x,35]]
  return {'type':'Feature','properties':{'pnu':pnu,'jibun':f'{pnu[-4:]} {jimok}','jimok':jimok},'geometry':{'type':'Polygon','coordinates':[ring]}}
 def test_more_than_100_neighbors_are_all_fetched_in_5187(self):
  site='2611010100100010001';near=[self.square(f'26110101001002{i:05d}',0.00001*(i%7),'도' if i%5==0 else '대') for i in range(250)]
  def fake(config,filters,size):
   if 'attrFilter' in filters:return [self.square(site,0)]
   page=int(filters.get('page',1));rows=[self.square(site,0)]+near
   return rows[(page-1)*size:page*size]
  with patch.object(p,'request',return_value=({'key':'k','domain':'example.com'},None)),patch.object(p,'features',side_effect=fake),patch('miriboda_service.land_info',side_effect=lambda pnu,area,config:{'pnu':pnu,'zones':[]}):
   r=p.fetch({'pnu':site,'contextMeters':30})
  self.assertEqual(r['counts']['road']+r['counts']['neighbor'],250)
  self.assertFalse(any('100' in w for w in r['warnings']))
  self.assertEqual(r['crs'],'EPSG:5187');self.assertEqual(r['drawingGeo']['crs'],'EPSG:5187')      # A30: 기본 좌표계도 계획 탭과 같게
def test_surroundings_keeps_use_code_and_approval_year(monkeypatch):
    # 대지분석 도판(건축물 용도·준공 연대)이 쓰는 칸: 별표1 주용도 코드와 사용승인 연도. 이상한 값은 버린다(지어내지 않음).
    from pyproj import Transformer
    import parcel_service as ps
    ox, oy = 200000.0, 300000.0
    to_geo = Transformer.from_crs('EPSG:5187', 'EPSG:4326', always_xy=True)
    ring = lambda x, y, s: [list(to_geo.transform(ox + x, oy + y)) for x, y in ((x, y), (x + s, y), (x + s, y + s), (x, y + s), (x, y))]
    features = [{'properties': {'grnd_flr': '5', 'height': '16', 'usability': '02000', 'useapr_day': '19970301'}, 'geometry': {'type': 'Polygon', 'coordinates': [ring(0, 0, 8)]}},
                {'properties': {'grnd_flr': '1', 'height': '4', 'usability': '2000', 'useapr_day': '30000101'}, 'geometry': {'type': 'Polygon', 'coordinates': [ring(20, 0, 8)]}}]
    def fake(url, data=None, **k):
        if url.endswith('/api/vworld'): return {'key': 'secret-key', 'domain': 'barun.fly.dev'}, None
        if url.endswith('/site-plan/terrain'): return {'covered': False}, None
        return {'response': {'status': 'OK', 'page': {'total': '1'}, 'result': {'featureCollection': {'features': features}}}}, None
    monkeypatch.setattr(ps, 'request', fake)
    r = ps.surroundings({'crs': 'EPSG:5187', 'originM': [ox, oy], 'bboxMm': [-60000, -60000, 60000, 60000]})
    a = [e['attributes'] for e in r['entities'] if e['parcelRole'] == 'building']
    assert a[0]['useCode'] == '02000' and a[0]['approvalYear'] == 1997
    assert 'useCode' not in a[1] and 'approvalYear' not in a[1]
    assert r['attributeCounts'] == {'use': 1, 'year': 1} and 'usability' in r['propertyKeys'] and 'secret-key' not in str(r)

def test_market_and_use_recommend_go_to_homepage_with_token(monkeypatch):
    # 상권(카카오)·추천 용도(AI)는 홈페이지가 계산한다. 캐드는 토큰을 실어 입력만 보내고, 401 이면 «로그인이 끊김»을 알린다.
    import io, json as j, urllib.error
    import parcel_service as ps
    monkeypatch.setattr(ps, 'account_token', lambda: 'tok')
    monkeypatch.setattr(ps, 'cookie', lambda: '')
    sent = []
    class Resp(io.BytesIO):
        def __enter__(self): return self
        def __exit__(self, *a): return False
    def fake(req, timeout=0):
        sent.append((req.full_url, req.headers.get('Authorization'), j.loads(req.data)))
        if req.full_url.endswith('/api/use-recommend'): raise urllib.error.HTTPError(req.full_url, 401, 'x', {}, io.BytesIO(b'{}'))
        return Resp(j.dumps({'상권': {'총점포': 120}, '후보': [], '전체': []}).encode())
    monkeypatch.setattr(ps.urllib.request, 'urlopen', fake)
    r = ps.process({'action': 'market', 'address': '부산 부산진구 부전동 139-3'})
    assert r['상권']['총점포'] == 120
    assert sent[0][0].endswith('/api/public/site-fit') and sent[0][1] == 'Bearer tok' and sent[0][2]['kind'] == 'newbuild'
    try:
        ps.process({'action': 'use-recommend', 'address': 'a', 'lotAreaM2': 400, 'stats': [{'use': '공동주택', 'count': 3, 'avgFloors': 5}, {'use': '', 'count': 1}]})
        raise AssertionError('401 이면 오류여야 한다')
    except ValueError as error:
        assert '로그인이 끊겼거나' in str(error) and '홈페이지 업데이트' not in str(error)
    assert sent[1][2]['stats'] == [{'use': '공동주택', 'count': 3, 'avgFloors': 5.0}] and sent[1][2]['totalBuildings'] == 3

def test_zoning_layers_clip_to_window_and_label(monkeypatch):
    # 용도지역(LT_C_UQ111)·지구(LT_C_UQ124)·시설(LT_C_UPISUQ151)을 범위로 자르고 이름·묶음을 붙인다. 키는 결과에 남지 않는다.
    from pyproj import Transformer
    import parcel_service as ps
    ox, oy = 200000.0, 300000.0
    to_geo = Transformer.from_crs('EPSG:5187', 'EPSG:4326', always_xy=True)
    sq = lambda s: [[list(to_geo.transform(ox + x, oy + y)) for x, y in ((-s, -s), (s, -s), (s, s), (-s, s), (-s, -s))]]
    layers = {'LT_C_UQ111': {'uname': '일반상업지역'}, 'LT_C_UQ124': {'uname': '방화지구'}, 'LT_C_UPISUQ151': {'dgm_nm': '소로3류', 'atr_nam': '소로3류'}, 'LT_C_WKMSTRM': {'riv_nm': '부전천', 'cat_nam': '지방2급하천'}}
    def fake(url, data=None, **k):
        if url.endswith('/api/vworld'): return {'key': 'secret-key', 'domain': 'barun.fly.dev'}, None
        name = ps.urllib.parse.parse_qs(ps.urllib.parse.urlparse(url).query)['data'][0]
        if name not in layers: return {'response': {'status': 'NOT_FOUND'}}, None
        return {'response': {'status': 'OK', 'result': {'featureCollection': {'features': [{'properties': layers[name], 'geometry': {'type': 'Polygon', 'coordinates': sq(500)}}]}}}}, None
    monkeypatch.setattr(ps, 'request', fake)
    r = ps.zoning({'crs': 'EPSG:5187', 'originM': [ox, oy], 'bboxMm': [-100000, -100000, 100000, 100000]})
    assert r['counts'] == {'zone': 1, 'district': 1, 'water': 1, 'facility': 1} and 'secret-key' not in str(r)
    river = next(z for z in r['zones'] if z['kind'] == 'water')
    assert river['name'] == '부전천' and river['detail'] == '지방2급하천'     # 하천망: 하천 이름·등급(공원·녹지·하천 도판)
    road = next(z for z in r['zones'] if z['kind'] == 'facility')
    assert road['group'] == '도로' and road['name'] == '소로3류'
    xs = [p[0] for p in road['polygons'][0][0]]
    assert min(xs) >= -100000.5 and max(xs) <= 100000.5     # 500m 면이 범위(±100m)로 잘린다

def test_zoning_reports_failed_layers_by_kind(monkeypatch):
    # 지구 레이어 하나만 실패하면 그 종류(district)에만 실패를 적는다 — 화면이 "받지 못함"과 "자료 없음"을 가른다(2026-10-22 검토).
    import parcel_service as ps
    def fake(url, data=None, **k):
        if url.endswith('/api/vworld'): return {'key': 'k', 'domain': 'barun.fly.dev'}, None
        name = ps.urllib.parse.parse_qs(ps.urllib.parse.urlparse(url).query)['data'][0]
        if name == 'LT_C_UQ124': return {'response': {'status': 'ERROR', 'error': {'text': '일시 오류'}}}, None
        return {'response': {'status': 'NOT_FOUND'}}, None
    monkeypatch.setattr(ps, 'request', fake)
    r = ps.zoning({'crs': 'EPSG:5187', 'originM': [200000.0, 300000.0], 'bboxMm': [-100000, -100000, 100000, 100000]})
    assert r['failed'] == {'zone': [], 'district': ['LT_C_UQ124'], 'water': [], 'facility': []}
    assert r['warnings'] == ['LT_C_UQ124: 일시 오류'] and r['zones'] == []

def test_ledger_values_existing_building_for_extension_review():
    # 증축·대수선 검토(2026-10-26)가 기존 건축면적·연면적·지상층수를 대장에서 읽는다. 용적률산정연면적은 연면적에 넣지 않는다.
    rows = [{'대지면적': '270.5', '건축면적': '132.4', '연면적': '396', '용적률산정연면적': '300', '지상층수': '3'}, {'대지면적': '270.5', '연면적': '10.0'}]
    assert p.ledger_values(rows) == {'lotAreaM2': 270.5, 'archAreaM2': 132.4, 'totalAreaM2': 406.0, 'groundFloors': 3}
    assert p.ledger_values([]) == {'lotAreaM2': None, 'archAreaM2': None, 'totalAreaM2': None, 'groundFloors': None}
