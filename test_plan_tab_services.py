"""계획 탭이 쓰는 로컬 엔진 경로: 5187 지적·지번 문자·drawingGeo, 대장 면적, 설계엔진 새 계약(siteEngine), 원격 오류 문구."""
import io
import json
import unittest
from unittest.mock import patch
from urllib.error import HTTPError
import parcel_service as parcel
import plan_service
import site_plan_service


def feature(coords, pnu='2623010300101560007', jibun='156-7 대', jimok=None):
    props = {'pnu': pnu, 'jibun': jibun}
    if jimok: props['jimok'] = jimok
    return {'type': 'Feature', 'properties': props, 'geometry': {'type': 'Polygon', 'coordinates': coords}}


SITE = [[[129.05, 35.17], [129.0503, 35.17], [129.0503, 35.1703], [129.05, 35.1703], [129.05, 35.17]]]
ROAD = [[[129.0496, 35.17], [129.05, 35.17], [129.05, 35.1703], [129.0496, 35.1703], [129.0496, 35.17]]]


def http_error(code, body):
    return HTTPError('https://barunarc.co.kr/x', code, 'err', {}, io.BytesIO(json.dumps(body).encode()))


class CadastreTests(unittest.TestCase):
    def test_5187_drawing_records_drawing_geo_and_labels(self):
        result = parcel.drawing([feature(SITE)], [feature(ROAD, '2623010300100010000', '1 도', '도')], '2623010300101560007', crs='EPSG:5187', labels=True)
        self.assertEqual(result['crs'], 'EPSG:5187')
        self.assertEqual(result['drawingGeo']['crs'], 'EPSG:5187'); self.assertEqual(result['drawingGeo']['unit'], 'mm')
        site = result['entities'][0]
        self.assertEqual(site['points'][0], {'x': 0.0, 'y': 0.0})
        self.assertEqual(site['attributes']['sourceCRS'], 'EPSG:5187')
        # 도면(mm) = (투영(m) − originM) × 1000: 원점이 첫 점이다.
        self.assertEqual(result['drawingGeo']['originM'], site['attributes']['originMetres'])
        labels = parcel.label_entities(result['entities'])
        texts = [e['text'] for e in labels]
        self.assertIn('156-7 대', texts); self.assertIn(parcel.REVIEW_NOTE, texts)
        self.assertTrue(all(e['parcelRole'] == 'label' and e['type'] == 'text' for e in labels))

    def test_existing_origin_is_reused_so_new_parcels_overlay(self):
        first = parcel.drawing([feature(SITE)], [], 'p', crs='EPSG:5187')
        origin = first['drawingGeo']['originM']
        second = parcel.drawing([feature(ROAD, '2623010300100010000')], [], 'q', crs='EPSG:5187', origin=origin)
        self.assertEqual(second['drawingGeo']['originM'], origin)
        # 도로 필지의 동쪽 변이 대지 서쪽 변과 같은 x(0mm 근처)에 온다.
        xs = [p['x'] for p in second['entities'][0]['points']]
        self.assertAlmostEqual(max(xs), 0, delta=1)
        with self.assertRaises(ValueError): parcel.drawing([feature(SITE)], [], 'p', crs='EPSG:3857')

    def test_fetch_passes_crs_and_rejects_unknown_before_network(self):
        with patch.object(parcel, 'request') as request:
            with self.assertRaises(ValueError): parcel.fetch({'pnu': '2623010300101560007', 'crs': 'EPSG:3857'})
            request.assert_not_called()
        with patch.object(parcel, 'request', return_value=({'key': 'k', 'domain': 'example.com'}, None)), \
             patch.object(parcel, 'features', side_effect=lambda config, filters, size: [feature(SITE)] if 'attrFilter' in filters else [feature(ROAD, '2623010300100010000', '1 도', '도')]), \
             patch('miriboda_service.land_info', side_effect=lambda pnu, area, config: {'pnu': pnu, 'zones': []}):
            result = parcel.fetch({'pnu': '2623010300101560007', 'crs': 'EPSG:5187', 'labels': True, 'contextMeters': 50})
        self.assertEqual(result['drawingGeo']['crs'], 'EPSG:5187')
        self.assertTrue(any(e['parcelRole'] == 'label' for e in result['entities']))
        self.assertNotIn('key', json.dumps(result))

    def test_ledger_reads_lot_area_without_returning_keys(self):
        self.assertEqual(parcel.pnu_jibun('2623010300101560007'), ('2623010300', '156-7'))
        self.assertEqual(parcel.pnu_jibun('2623010300200120000'), ('2623010300', '산 12'))
        body = {'building': {'found': True, 'buildings': [{'대지면적(㎡)': '430.5'}]}, 'vworld': {'key': 'secret', 'domain': 'x'}}
        with patch.object(parcel, 'request', return_value=(body, None)) as request, patch.object(parcel, 'cookie', return_value=''), patch.object(parcel, 'account_token', return_value=''):
            result = parcel.process({'action': 'ledger', 'pnu': '2623010300101560007'})
        self.assertEqual(result['lotAreaM2'], 430.5)
        self.assertNotIn('secret', json.dumps(result))
        self.assertEqual(request.call_args.args[1], {'bjdCode': '2623010300', 'jibun': '156-7'})
        with patch.object(parcel, 'request', return_value=({'building': {'found': False, 'error': '대장 없음'}}, None)), patch.object(parcel, 'cookie', return_value=''), patch.object(parcel, 'account_token', return_value=''):
            self.assertIsNone(parcel.ledger('2623010300101560007')['lotAreaM2'])

    def test_remote_error_messages(self):
        self.assertIn('SITE_ENGINE_INPUT_REQUIRED', parcel.remote_error(http_error(400, {'error': 'x', 'code': 'SITE_ENGINE_INPUT_REQUIRED'})))
        self.assertIn('세대수', parcel.remote_error(http_error(422, {'detail': '주택·오피스텔의 주차대수는 세대수 기준'}), '설계엔진'))
        self.assertIn('이용 한도', parcel.remote_error(http_error(429, {'error': '오늘 한도'})))
        self.assertIn('[계정 연결]', parcel.remote_error(http_error(403, {})))   # 로그인은 하나: 카카오·구글 [계정 연결]
        self.assertIn('시간이 초과', parcel.remote_error(http_error(504, {})))


class SiteEngineTests(unittest.TestCase):
    def drawn(self, crs):
        result = parcel.drawing([feature(SITE)], [feature(ROAD, '2623010300100010000', '1 도', '도')], '2623010300101560007', crs=crs)
        return result['entities'] + parcel.label_entities(result['entities'])

    def test_from_drawing_accepts_5187_and_ignores_labels(self):
        a = site_plan_service.from_drawing({'entities': self.drawn('EPSG:5187')})
        b = site_plan_service.from_drawing({'entities': self.drawn('EPSG:5179')})
        self.assertEqual(a['site']['crs'], 'EPSG:5187'); self.assertEqual(len(a['site']['neighbors']), 1)
        self.assertEqual(a['site']['neighbors'][0]['jimok'], '도')
        for p, q in zip(a['site']['parcel'], b['site']['parcel']):
            self.assertAlmostEqual(p[0], q[0], delta=0.05); self.assertAlmostEqual(p[1], q[1], delta=0.05)

    @patch.object(plan_service, 'auth_headers', return_value={})
    @patch.object(plan_service.urllib.request, 'urlopen')
    def test_auto_plan_sends_site_engine_contract(self, send, _):
        request = site_plan_service.from_drawing({'entities': self.drawn('EPSG:5187')})
        request['program'].update(use='업무시설', floors=3, floors_search=False, target_gfa=500)
        send.return_value.__enter__.return_value.read.return_value = json.dumps({'report': {'checks': [], 'geometry': {}}, 'entities': {'units': 'm'}, 'input': request, 'png_preview': 'data:...', 'dxf_url': '/x'}).encode()
        result, status = plan_service.generate({'siteEngine': request})
        self.assertEqual(status, 200)
        wire = send.call_args.args[0]
        self.assertEqual(wire.full_url, plan_service.BASE + '/api/public/plan-suggest')
        self.assertEqual(set(json.loads(wire.data)), {'siteEngine'})
        self.assertNotIn('png_preview', result); self.assertEqual(result['input'], request)
        with self.assertRaises(ValueError): plan_service.generate({'siteEngine': {**request, 'site': {**request['site'], 'crs': 'EPSG:5179'}}})

    @patch.object(plan_service, 'auth_headers', return_value={})
    @patch.object(plan_service.urllib.request, 'urlopen', side_effect=http_error(422, {'detail': '주택·오피스텔의 주차대수는 세대수 기준입니다.'}))
    def test_engine_422_keeps_original_message(self, *_):
        request = site_plan_service.from_drawing({'entities': self.drawn('EPSG:5187')})
        result, status = plan_service.generate({'siteEngine': request})
        self.assertEqual(status, 422); self.assertIn('세대수 기준', result['error'])

    @patch.object(plan_service, 'auth_headers', return_value={})
    @patch.object(plan_service.urllib.request, 'urlopen', side_effect=http_error(400, {'error': '새 지적 자료가 필요합니다.', 'code': 'SITE_ENGINE_INPUT_REQUIRED'}))
    def test_old_ring_contract_rejection_is_explained(self, *_):
        data = {'categoryId': '1', 'detailName': '단독주택', 'floors': 1, 'buildingAreaM2': 60, 'site': {'ring': [{'x': 0, 'z': 0}, {'x': 20, 'z': 0}, {'x': 20, 'z': 25}], 'roadEdgeIndex': 0, 'roadWidthM': 6, 'roadEdges': [{'ringIdx': 0, 'index': 0, 'widthM': 6}], 'isBusan': True, 'zoneNames': ['제2종일반주거지역'], 'maxTotalFloorAreaM2': 100}}
        result, status = plan_service.process(data)
        self.assertEqual(status, 400); self.assertIn('SITE_ENGINE_INPUT_REQUIRED', result['error']); self.assertIn('계획 탭', result['error'])


if __name__ == '__main__':
    unittest.main()
