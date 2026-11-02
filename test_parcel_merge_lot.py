"""건축물대장 대지면적에 맞춰 맞닿은 필지를 한 대지로 합친다(2026-10-30 괴정동 213-17 + 213-18 = 222㎡)."""
import unittest
import parcel_service as ps


def ring(pnu, role, x0, y0, x1, y1, jibun):
    return {'type': 'polyline', 'closed': True, 'parcelRole': role,
            'points': [{'x': x0, 'y': y0}, {'x': x1, 'y': y0}, {'x': x1, 'y': y1}, {'x': x0, 'y': y1}],
            'attributes': {'pnu': pnu, 'jibun': jibun, 'ring': 'outer', 'polygon': 0, 'originMetres': [0, 0], 'insertionMm': [0, 0]}}


def result():
    return {'entities': [ring('1' * 19, 'site', 0, 0, 10000, 10000, '1-1'), ring('2' * 19, 'neighbor', 10000, 0, 18000, 10000, '1-2'),
                         ring('3' * 19, 'neighbor', 0, 10000, 10000, 15000, '1-3'), ring('4' * 19, 'neighbor', 30000, 0, 40000, 10000, '9')],
            'warnings': [], 'counts': {'site': 1}, 'pnus': ['1' * 19]}


class MergeLotTest(unittest.TestCase):
    def test_touching_parcel_that_matches_the_ledger_is_merged(self):
        r = result()
        info = ps.merge_lot(r, ledger_reader=lambda pnu: {'lotAreaM2': 179})
        self.assertEqual(info['pnus'], ['1' * 19, '2' * 19]); self.assertAlmostEqual(info['areaM2'], 180)
        sites = [e for e in r['entities'] if e['parcelRole'] == 'site']
        self.assertEqual(len(sites), 1); self.assertEqual(sites[0]['attributes']['jibun'], '1-1 외 1필지')
        self.assertEqual({e['attributes']['pnu'] for e in r['entities'] if e['parcelRole'] == 'site-original'}, {'1' * 19, '2' * 19})

    def test_same_area_or_no_matching_neighbor_keeps_the_parcel(self):
        r = result(); self.assertIsNone(ps.merge_lot(r, ledger_reader=lambda pnu: {'lotAreaM2': 100}))
        r = result(); self.assertIsNone(ps.merge_lot(r, ledger_reader=lambda pnu: {'lotAreaM2': 300}))
        self.assertIn('조합이 없습니다', r['warnings'][-1])
        self.assertEqual([e['parcelRole'] for e in r['entities']].count('site'), 1)


if __name__ == '__main__':
    unittest.main()
