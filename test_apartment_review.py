"""아파트 패널 [빠른 검토]·[정밀 검토] (사장님 2026-10-18) — 로컬 엔진이면 이 PC 작업, 없으면 배치 엔진 서버 작업.

서버 접수 본문은 배치 엔진 app.py `_apt_validate` 가 받는 모양이어야 한다(opts 허용 목록 APT_OPTS — 밖의 키는 422).
결과는 어느 쪽이든 _render 로 같은 카드·도면 글자('아파트-배치' 레이어)가 된다.
"""
import time
import unittest
from pathlib import Path
from unittest.mock import Mock, patch
from types import SimpleNamespace

import apartment_service as a
from test_apartment_service import enclosure

# 배치 엔진 services/site-plan/app.py APT_OPTS 키(2026-10-18 main e8f820d) — 서버가 늘리면 같이
SERVER_OPTS = {'zone', 'roads', 'floors_max', 'floor_h', 'max_units', 'redevelopment', 'redevelopment_law', 'north_exempt', 'sun_gate',
               'time_s', 'target_steps_max', 'target_steps_start', 'program', 'incentive_site', 'incentive_exclude', 'incentive_choices'}
B = {'id': 'B1', 'block': 'J-001', 'floors': 20, 'unit_floors': 20, 'units_per_floor': 4, 'labels': ['84A'] * 4, 'gfa_m2': 8520, 'height_m': 58,
     'poly': [[10, 10], [68, 10], [68, 23], [10, 23]]}


def fake_plan(mode, review='quick'):
    return {'title': f'{review} {mode}', 'mode': mode, 'review': review, 'status': 'ok', 'buildings': [dict(B)], 'totals': {'units': 80}, 'checks_ok': True,
            'checks_failed': [], 'target_plan': {'target_far_pct': 320.0, 'confirmed_far_pct': 200.0, 'reached_pct': 81.9, 'gap_pct': 238.1,
                                                 'assumptions': ['리모델링 대비 구조 — 90점 이상 받는다고 가정 (등급별 비율 원문 미확인)']}}


def submit(review, **extra):
    ents, pl = enclosure()
    return a.process({'action': 'review', 'review': review, 'entities': ents, 'layers': [], 'pl': pl, 'fetchMissing': False, 'lookupZones': False, **extra})


class ServerZonesTests(unittest.TestCase):
    """로컬 엔진 없이 가두리 묶기 — 조례 건폐·용적은 서버 규칙표, 대지면적 구간도 엔진과 같게."""
    RULES = {'zoning': {'제3종일반주거지역': {'bcr': 50, 'far': 250}, '일반상업지역': {'bcr': 80, 'far': 1000},
                        '제2종일반주거지역': {'bcr': 60, 'far': 200, 'far_by_site_area': [{'site_area_max': 1000, 'far': 220}]}}}

    def zones(self):
        with patch('parcel_service.request', return_value=(self.RULES, {})):
            return a._ServerZones()

    def test_split_and_far_by_site_area(self):
        sz = self.zones()
        sq = lambda x0, x1: [[x0, 0], [x1, 0], [x1, 30], [x0, 30]]
        small = sz.split_zones([{'pnu': '1', 'coords': sq(0, 30), 'zones': ['제2종일반주거지역']}])
        self.assertEqual((small['mode'], small['parts'][0]['far']), ('single', 220))      # 900㎡ ≤ 1,000㎡
        two = sz.split_zones([{'pnu': '1', 'coords': sq(0, 100), 'zones': ['제3종일반주거지역']}, {'pnu': '2', 'coords': sq(100, 130), 'zones': ['일반상업지역']}])
        self.assertEqual([p['zone'] for p in two['parts']], ['제3종일반주거지역', '일반상업지역'])
        self.assertEqual(two['mode'], 'separate')
        self.assertIn('84조', two['basis'][0])
        self.assertIn('서버 규칙표', sz.table(two))
        with self.assertRaisesRegex(ValueError, '용도지역 2개'):
            sz.split_zones([{'pnu': '1', 'coords': sq(0, 30), 'zones': ['제3종일반주거지역', '일반상업지역']}])
        with self.assertRaisesRegex(ValueError, '규칙표'):
            sz.split_zones([{'pnu': '1', 'coords': sq(0, 30), 'zones': ['없는지역']}])

    def test_enclose_without_local_engine(self):
        ents, pl = enclosure()
        with patch.object(a, 'ENGINE_DIR', Path(__file__).parent / '없는-엔진-폴더'), patch('parcel_service.request', return_value=(self.RULES, {})):
            r = a.process({'action': 'enclose', 'entities': ents, 'layers': [], 'pl': pl, 'fetchMissing': False, 'lookupZones': False})
        self.assertEqual([(p['zone'], p['far']) for p in r['engine']['parts']], [('제3종일반주거지역', 250), ('일반상업지역', 1000)])
        self.assertEqual(r['engine']['site_area_m2'], 10400)


class ServerReviewTests(unittest.TestCase):
    def test_submit_sends_only_server_opts_and_renders_plans(self):
        sent = []

        def server(path, body=None):
            sent.append((path, body))
            if body is not None:
                return {'job_id': 'a' * 32, 'status': 'queued'}
            return {'job_id': 'a' * 32, 'status': 'running', 'review': 'quick', 'modes': ['84', 'max'], 'done': ['84'], 'current': 'max', 'elapsed_s': 31.0,
                    'plans': [fake_plan('84')]}
        with patch.object(a, 'engine_local', return_value=False), patch.object(a, '_server', side_effect=server):
            r = submit('quick', heightLimit=60, siteExtra={'open_space_m2': 300}, redevelopment=True)
            self.assertEqual((r['where'], r['job_id'], r['modes']), ('server', 'a' * 32, ['84', 'max']))
            path, body = sent[0]
            self.assertEqual(path, '/site-plan/apartment/jobs')
            self.assertEqual((body['crs'], body['review'], body['modes']), ('EPSG:5179', 'quick', ['84', 'max']))
            self.assertLessEqual(set(body['opts']), SERVER_OPTS)                      # incentive_selections 같은 키는 422
            self.assertEqual(body['opts']['floors_max'], 20)                          # 높이제한 60m ÷ 층고 2.9m
            self.assertEqual(body['opts']['incentive_site'], {'open_space_m2': 300})
            self.assertTrue(body['opts']['redevelopment'] and body['opts']['roads'])   # 86조⑥ 도로
            self.assertTrue(all(set(p) == {'zone', 'area_m2', 'far', 'bcr', 'poly', 'height_m'} for p in body['parts']))
            q = {'action': 'review_job', 'jobId': r['job_id'], 'where': 'server', 'engine': r['enclose']['engine'], 'textH': r['enclose']['text_h'], 'northVec': r['north_vec']}
            st = a.process({**q, 'have': 0})
            self.assertEqual(sent[-1], (f"/site-plan/apartment/jobs/{'a' * 32}", None))
        self.assertEqual((st['status'], st['done'], st['current'], st['plans_n']), ('running', ['84'], 'max', 1))
        card = st['place']['plans'][0]
        self.assertEqual((card['mode'], card['review'], card['units']), ('84', 'quick', 80))
        self.assertEqual(card['target_plan']['target_far_pct'], 320.0)
        self.assertTrue(any(e['type'] == 'text' and e['apartmentLayer'] == a.PLAN_LAYER and '101동' in e['text'] for e in card['draw']))   # 도면 글자·외곽은 '아파트-배치' 레이어
        self.assertIn('목표 320.0%', st['place']['note'])
        with patch.object(a, 'engine_local', return_value=False), patch.object(a, '_server', side_effect=server):
            self.assertNotIn('place', a.process({**q, 'have': 1}))                   # 새 안이 없으면 다시 그리지 않는다

    def test_bad_input(self):
        with self.assertRaisesRegex(ValueError, 'review'):
            submit('slow')
        with self.assertRaisesRegex(ValueError, '작업 번호'):
            a.process({'action': 'review_job', 'jobId': '../x', 'where': 'server'})


class LocalReviewTests(unittest.TestCase):
    def test_local_job_runs_both_modes_in_background(self):
        calls = []

        def local(review, parts, opts, mode):
            calls.append((review, mode, set(opts)))
            return fake_plan(mode, review)
        with patch.object(a, 'engine_local', return_value=True), patch.object(a, '_local_plan', side_effect=local), patch.object(a, '_server') as server:
            r = submit('precise')
            self.assertEqual(r['where'], 'local')
            for _ in range(100):
                st = a.process({'action': 'review_job', 'jobId': r['job_id'], 'where': 'local', 'have': 0, 'engine': r['enclose']['engine'], 'drawings': False})
                if st['status'] == 'done':
                    break
                time.sleep(0.05)
        server.assert_not_called()
        self.assertEqual([c[:2] for c in calls], [('precise', '84'), ('precise', 'max')])
        self.assertEqual((st['status'], st['done'], st['plans_n']), ('done', ['84', 'max'], 2))
        self.assertEqual([p['mode'] for p in st['place']['plans']], ['84', 'max'])
        with self.assertRaisesRegex(ValueError, '계산 기록이 없습니다'):
            a.process({'action': 'review_job', 'jobId': 'b' * 32, 'where': 'local'})

    def test_one_local_job_per_review(self):
        with patch.object(a, 'engine_local', return_value=True), patch.object(a, '_run_local'):   # 접수만 하고 돌지 않음 → queued 로 남는다
            submit('quick')
            with self.assertRaisesRegex(ValueError, '계산 중'):
                submit('quick')
        a._JOBS.clear()



class EngineLocation(unittest.TestCase):
    """[2026-10-18] 기본은 서버 — 설계엔진 폴더가 있어도 BARUN_APARTMENT_LOCAL=1 이 아니면 이 PC 에서 계산하지 않는다."""
    def test_default_is_server(self):
        import os
        from unittest.mock import patch
        import apartment_service as a
        with patch.dict(os.environ, {}, clear=False):
            os.environ.pop('BARUN_APARTMENT_LOCAL', None)
            self.assertFalse(a.engine_local())
        with patch.dict(os.environ, {'BARUN_APARTMENT_LOCAL': '1'}):
            self.assertEqual(a.engine_local(), all((a.ENGINE_DIR / f).is_file() for f in ('site_zones.py', 'target_plan.py', 'maxfar.py')))


class IncentiveFlowTests(unittest.TestCase):
    """v2 선택값 경계와 대지 재사용: 실제 엔진·서버 없이 검증한다."""

    def enc(self):
        return {'table': '대지', 'engine': {
            'parts': [{'zone': '제2종일반주거지역', 'area_m2': 8000, 'far': 200, 'bcr': 60,
                       'poly': [[0, 0], [80, 0], [80, 100], [0, 100]], 'internal': '제외'}],
            'zoning': {'zone': '제2종일반주거지역'}}}

    def test_picks_converts_filters_and_truncates(self):
        self.assertEqual(a._picks({}), {})
        self.assertEqual(a._picks({'incentiveExclude': [], 'incentiveChoices': {}}), {})
        choices = {'tier': {'tier': '우수'}, 'text': '미적용', 'flag': False,
                   'number': 3, 'list': ['우수'], 'none': None}
        self.assertEqual(a._picks({'incentiveExclude': ['', None, False, 123, 'x' * 70], 'incentiveChoices': choices}),
                         {'incentive_exclude': ['123', 'x' * 60],
                          'incentive_choices': {'tier': {'tier': '우수'}, 'text': '미적용', 'flag': False}})
        exclude = [f'{i:02d}' + 'x' * 70 for i in range(35)]
        choices = {f'{i:02d}' + 'y' * 70: {'tier': str(i)} for i in range(35)}
        got = a._picks({'incentiveExclude': exclude, 'incentiveChoices': choices})
        self.assertEqual(got['incentive_exclude'], [x[:60] for x in exclude[:30]])
        self.assertEqual(got['incentive_choices'], {k[:60]: v for k, v in list(choices.items())[:30]})

    def test_review_opts_carries_picks_and_numeric_site_values(self):
        data = {'incentiveExclude': ['green'], 'incentiveChoices': {'longlife': {'tier': '우수'}},
                'siteExtra': {'open_space_m2': 100, 'ratio': 1.5, 'flag': True, 'text': '100', 'empty': None}}
        opts = a._review_opts(self.enc()['engine'], data, [], a._frame_from(None))
        self.assertLessEqual(set(opts), SERVER_OPTS)
        self.assertEqual(opts['incentive_exclude'], ['green'])
        self.assertEqual(opts['incentive_choices'], {'longlife': {'tier': '우수'}})
        self.assertEqual(opts['incentive_site'], {'open_space_m2': 100, 'ratio': 1.5})

    def test_incentive_table_server_body_and_enclose_reuse(self):
        enc = self.enc()
        data = {'action': 'incentive_table', 'heightLimit': 60, 'floorsMax': 50, 'redevelopment': True,
                'sunGate': True, 'siteExtra': {'open_space_m2': 300, 'ignored': 'text'},
                'incentiveExclude': ['green'], 'incentiveChoices': {'longlife': {'tier': '우수'}}}
        table = {'far_pct': 260}
        with patch.object(a, 'engine_local', return_value=False), patch.object(a, 'enclose', return_value=enc) as enclose, \
                patch.object(a, '_server', return_value=table) as server, patch.object(a, '_inc_table_local') as local:
            first = a.process(data)
            enclose.assert_called_once_with(data)
            expected = {'crs': 'EPSG:5179', 'parts': [{k: v for k, v in enc['engine']['parts'][0].items() if k != 'internal'}],
                        'opts': {'zone': '제2종일반주거지역', 'incentive_site': {'open_space_m2': 300},
                                 'incentive_exclude': ['green'], 'incentive_choices': {'longlife': {'tier': '우수'}}}}
            expected['parts'][0]['height_m'] = 60.0
            server.assert_called_once_with('/site-plan/apartment/incentive', expected)
            self.assertIs(first['enclose'], enc)
            self.assertEqual((first['where'], first['table']), ('server', table))
            enclose.reset_mock()
            enclose.side_effect = AssertionError('이미 묶은 대지를 다시 묶음')
            second = a.process({**data, 'enclose': enc})
            enclose.assert_not_called()
            self.assertEqual(server.call_count, 2)
            self.assertEqual(server.call_args.args, ('/site-plan/apartment/incentive', expected))
            self.assertIsNone(second['enclose'])
            self.assertEqual(second['table'], table)
            local.assert_not_called()

    def test_user_selections_exclude_unapplied_and_override_tier(self):
        base = {'far': 2.0, 'bcr': 0.6, 'height': None}
        site = {'area_m2': 8000, 'zone': '제2종일반주거지역'}
        defaults = {'excluded': True, 'unapplied': True, 'false': True, 'none': True, 'grade': {'tier': '최우수'}, 'keep': True}

        def maximum(base_arg, site_arg, exclude=()):
            self.assertIs(base_arg, base)
            self.assertIs(site_arg, site)
            return {'selections': {k: v for k, v in defaults.items() if k not in exclude}, 'far_base': 2.0}

        def apply(base_arg, site_arg, selections):
            self.assertIs(base_arg, base)
            self.assertIs(site_arg, site)
            gains = [0.2 if v == {'tier': '우수'} else 0.4 for v in selections.values()]
            return {'legal': {'far': 2.0 + sum(gains)}, 'daylight_factor': 1.1}

        incentive = SimpleNamespace(max_selections=Mock(side_effect=maximum), apply=Mock(side_effect=apply),
                                    RULES={'items': [{'id': k, 'name': k, '_confirmed': k != 'grade'} for k in defaults]})
        choices = {'excluded': {'tier': '우수'}, 'unapplied': '미적용', 'false': False, 'none': None, 'grade': {'tier': '우수'}}
        got = a._user_selections(incentive, base, site, ['excluded'], choices)
        self.assertEqual(set(incentive.max_selections.call_args.kwargs['exclude']), {'excluded', 'unapplied', 'false', 'none'})
        self.assertEqual(got['selections'], {'grade': {'tier': '우수'}, 'keep': True})
        self.assertEqual(defaults['grade'], {'tier': '최우수'}, '원래 최대 선택은 보존')
        self.assertEqual(got['far_base'], 2.0)
        self.assertAlmostEqual(got['far_max'], 2.6)
        self.assertEqual(got['result']['legal']['far'], got['far_max'])
        self.assertEqual(got['daylight_factor'], 1.1)
        picked = {p['id']: p for p in got['picked']}
        self.assertEqual(picked['grade'], {'id': 'grade', 'name': 'grade', 'choice': {'tier': '우수'}, 'far_gain': 0.2, 'confirmed': False})
        self.assertEqual(picked['keep']['far_gain'], 0.4)
        self.assertTrue(any('우수' in s and '원문 미확인' in s for s in got['assumptions']))
        self.assertEqual(incentive.apply.call_count, 3, '현재 조건과 항목별 제외 이득')

    def test_review_reuses_enclose_and_sends_picks(self):
        enc = self.enc()
        with patch.object(a, 'engine_local', return_value=False), \
                patch.object(a, 'enclose', side_effect=AssertionError('대지 다시 묶음')) as enclose, \
                patch.object(a, '_server', return_value={'job_id': 'c' * 32}) as server:
            got = a.process({'action': 'review', 'review': 'quick', 'enclose': enc,
                             'incentiveExclude': ['green'], 'incentiveChoices': {'longlife': {'tier': '우수'}}})
        enclose.assert_not_called()
        self.assertIs(got['enclose'], enc)
        self.assertEqual((got['where'], got['job_id']), ('server', 'c' * 32))
        path, body = server.call_args.args
        self.assertEqual(path, '/site-plan/apartment/jobs')
        self.assertEqual(body['opts']['incentive_exclude'], ['green'])
        self.assertEqual(body['opts']['incentive_choices'], {'longlife': {'tier': '우수'}})
        self.assertNotIn('internal', body['parts'][0])

if __name__ == '__main__':
    unittest.main()
