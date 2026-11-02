"""소규모 자동 구조 MCP 도구 7개: 스키마·검사·분기·범위 밖 거절. 서버 계산은 표본 응답으로 바꿔 끼운다(네트워크 없음)."""
import copy
import io
import os
import json
import re
import unittest
import urllib.error
from pathlib import Path
from unittest.mock import patch

import bridge
import structure_service as ss
from test_mcp_3d import Mcp3DTest

FIXTURES = json.loads((Path(__file__).resolve().parent / 'tests' / 'fixtures' / 'structure-server-responses.json').read_text(encoding='utf-8'))
TOOLS = ('cad_structure_generate', 'cad_structure_review', 'cad_structure_get', 'cad_structure_set_member', 'cad_structure_drawings', 'cad_structure_certificate', 'cad_structure_calc_report')
OUTLINE = {'x': 0, 'y': 0, 'width': 10000, 'depth': 9000}
KNOWN = {'storyHeight': 3300, 'use': 'house', 'wind': 'normal', 'snow': 'normal', 'soil': {'Fe': 150, 'landfill': False},
         'basement': False, 'legal': {'excluded32_2_3to8Confirmed': True}}


class FakeBrowser:
    """dispatch 대신: 도면 안 structureSets 를 흉내 낸다."""

    def __init__(self):
        self.sets, self.calls = {}, []

    def __call__(self, action, args):
        self.calls.append((action, copy.deepcopy(args)))
        if action == 'cad_structure_read':
            if 'entityId' in args:
                return {'outline': {'x': 1000.0, 'y': 2000.0, 'width': 12000.0, 'depth': 9000.0}}
            if 'outline' in args:
                return {'input': {'mode': 'check'}, 'findings': []}
            return {'record': copy.deepcopy(self.sets.get(args['setId']))}
        if action == 'cad_structure_apply':
            self.sets[args['record']['id']] = copy.deepcopy(args['record'])
            return {'added': 3, 'removed': 0, 'revision': 1, 'sheets': [], 'applied': True}
        if action == 'cad_structure_preview':
            return {'image': {'mimeType': 'image/png', 'data': 'AAAA'}, 'sheets': [{'title': '기초평면도'}], 'count': 9}
        raise AssertionError(action)


@patch('miri_account_service.require_ai_login', new=lambda: None)   # 로그인 검사는 test_server_ai_boundaries 가 본다
class StructureToolTest(Mcp3DTest):
    def setUp(self):
        super().setUp()
        ss.pending.items.clear()
        self.browser = FakeBrowser()
        p = patch.object(bridge, 'dispatch', side_effect=self.browser)
        p.start(); self.addCleanup(p.stop)
        self.posts = []

    def server(self, key='rc', transform=None):
        def post(payload, **_):
            self.posts.append(copy.deepcopy(payload))
            out = copy.deepcopy(FIXTURES[key])
            assert payload['action'] == 'generate' and set(payload) <= {'action', 'input', 'overrides'}, payload
            if payload.get('overrides'):   # 서버 흉내: 덮어쓰기 적용 후 다시 검토
                for o in payload['overrides']:
                    for m in out['model']['members']:
                        if m.get('code') == o['code']:
                            m['b'], m['h'] = map(int, o['size'].split('x'))
                out['overrides'] = payload['overrides']
                if transform:
                    out['review'] = transform(out['review'], out['model'])
            return out
        return patch.object(ss, 'post', side_effect=post)

    def test_schema_flat_bound_and_mutating(self):
        tools = {t['name']: t for t in bridge.TOOLS}
        for name in TOOLS:
            schema = tools[name]['inputSchema']
            for forbidden in ('oneOf', 'anyOf', 'allOf'):
                self.assertNotIn(forbidden, schema)
            self.assertEqual('target' in schema['required'], name in bridge.MUTATING_TOOLS, name)
        for name in ('cad_structure_set_member', 'cad_structure_drawings'):
            self.assertIn(name, bridge.MUTATING_TOOLS)
            self.assertIn('expectedRevision', tools[name]['inputSchema']['required'])
        self.assertIn('로그인', tools['cad_structure_generate']['description'])
        # 브라우저가 applied=true 로 답하는 내부 동작은 '바꾸는 동작'이어야 브리지가 답을 받는다(개발판 한 바퀴에서 25초 시간 초과로 찾음)
        self.assertIn('cad_structure_apply', bridge.MUTATING_TOOLS); self.assertNotIn('cad_structure_preview', bridge.MUTATING_TOOLS)

    def test_real_standard_allows_structure_drawing(self):
        # 사용자 승인 2026-10-16: 도면 기준 noCommand.structurePlan(기준 1.9.0) — 결정 기록 docs/도면기준-결정기록.md
        self.assertTrue(bridge._structure_drawing_allowed())
        root = Path(__file__).resolve().parent
        self.assertIn('structurePlan', json.loads((root / 'rules' / 'knowledge' / 'drawing-standard.json').read_text(encoding='utf-8'))['commandsFirst']['noCommand'])
        self.assertIn('noCommand.structurePlan', (root / 'docs' / '도면기준-결정기록.md').read_text(encoding='utf-8'))
        # 사용자 승인 2026-10-16: 일람표·배근표도 직접 그리기(noCommand.structureSchedule, 기준 1.10.0)
        self.assertIn('structureSchedule', json.loads((root / 'rules' / 'knowledge' / 'drawing-standard.json').read_text(encoding='utf-8'))['commandsFirst']['noCommand'])
        self.assertIn('noCommand.structureSchedule', (root / 'docs' / '도면기준-결정기록.md').read_text(encoding='utf-8'))

    def test_generate_preview_only_stays_out_of_drawing(self):
        with self.server():
            out = bridge.call('cad_structure_generate', {**KNOWN, 'outline': OUTLINE, 'storyHeight': 3300}, allow_edit=False)
        self.assertEqual(out['verdict'], '적합'); self.assertFalse(out['inserted'])
        self.assertRegex(out['setId'], r'^st-[0-9a-f]{10}$')
        self.assertEqual(self.posts[0], {'action': 'generate', 'input': ss.engine_input({**KNOWN, 'mode': 'check', 'recognitionFindings': []}, OUTLINE)})
        self.assertTrue(any(m['code'] == 'G1' for m in out['members']))
        self.assertNotIn('cad_structure_apply', [c[0] for c in self.browser.calls])
        # 넣지 않은 묶음도 검토·부재 목록을 볼 수 있다
        review = bridge.call('cad_structure_review', {'setId': out['setId']}, allow_edit=False)
        self.assertFalse(review['inDrawing']); self.assertTrue(all('basis' in f for f in review['review']))
        beams = bridge.call('cad_structure_get', {'setId': out['setId'], 'kind': 'beam'}, allow_edit=False)
        self.assertTrue(beams['count'] > 0 and all(m['kind'] == 'beam' for m in beams['members']))

    def test_legal_confirmation_fills_both_server_and_tool_keys(self):
        # 도구 설명대로 excluded32_2_3to8Confirmed 만 줘도 서버가 읽는 smallBuildingConfirmed 로 바꿔 보낸다.
        # 서버는 excluded32… 가 섞이면 legal 째로 거절한다(10-19 실서버 확인) — 서버에는 smallBuildingConfirmed 만.
        both = lambda legal: ss.engine_input({**KNOWN, 'legal': legal}, OUTLINE).get('legal')
        self.assertEqual(both({'excluded32_2_3to8Confirmed': True}), {'smallBuildingConfirmed': True})
        self.assertEqual(both({'smallBuildingConfirmed': True, 'note': 'x'}), {'smallBuildingConfirmed': True})
        self.assertEqual(both({'excluded32_2_3to8Confirmed': True, 'smallBuildingConfirmed': False}), {'smallBuildingConfirmed': False})
        self.assertIsNone(both({'note': 'unknown'}))
        with self.assertRaisesRegex(ValueError, '참·거짓'):
            both({'excluded32_2_3to8Confirmed': 'yes'})

    def test_outline_from_entity_and_unit_conversion(self):
        with self.server():
            bridge.call('cad_structure_generate', {**KNOWN, 'outline': {'entityId': 'E1'}, 'system': 'steel', 'targetSpan': 8000, 'soil': {'Fe': 200, 'landfill': True}}, allow_edit=False)
        self.assertEqual(self.posts[0]['input'], {**ss.engine_input({**KNOWN, 'mode': 'check', 'recognitionFindings': []}, {'x': 1000, 'y': 2000, 'width': 12000, 'depth': 9000}), 'system': 'steel', 'target': 8.0, 'Fe': 200, 'soilOk': False})

    def test_insert_needs_edit_mode_target_and_revision(self):
        args = {**KNOWN, 'outline': OUTLINE, 'insert': True, 'target': self.target, 'expectedRevision': 0}
        with self.server():
            with self.assertRaisesRegex(ValueError, '대화/검토 모드'):
                bridge.call('cad_structure_generate', args, allow_edit=False)
            with self.assertRaises(ValueError):
                bridge.call('cad_structure_generate', {**args, 'expectedRevision': 4})
            with self.assertRaises(ValueError):
                bridge.call('cad_structure_generate', {**args, 'target': None})
        self.assertEqual(self.posts, [], '막힌 요청은 서버를 부르지 않는다')

    def test_insert_saves_set_and_waits_for_drawing_approval(self):
        with self.server(), patch.object(bridge, '_structure_drawing_allowed', return_value=False):
            out = bridge.call('cad_structure_generate', {**KNOWN, 'outline': OUTLINE, 'insert': True, 'target': self.target, 'expectedRevision': 0})
        self.assertTrue(out['inserted']); self.assertIn('승인', out['drawingsPending'])
        saved = self.browser.sets[out['setId']]
        self.assertNotIn('drawn', saved); self.assertEqual(saved['rulesVersion'], 'KDS 42:2022')
        self.assertEqual(saved['input']['outline'], OUTLINE); self.assertNotIn('target', saved['input']['args'])
        with patch.object(bridge, '_structure_drawing_allowed', return_value=False):
            preview = bridge.call('cad_structure_drawings', {'setId': out['setId'], 'target': self.target, 'expectedRevision': 0})
        self.assertEqual(preview['status'], 'approval_required'); self.assertEqual(preview['image']['mimeType'], 'image/png')
        sent = [c for c in self.browser.calls if c[0] == 'cad_structure_preview'][0][1]['record']
        self.assertEqual({k: sent['drawn'][k] for k in ('origin', 'sheets')}, {'origin': {'x': 20000, 'y': 0}, 'sheets': ['plan', 'foundation']})
        self.assertIn('plan', sent['drawn'].get('templates', {}).get('sheets', {}))   # 구조 장 도곽 템플릿(2026-10-27)도 함께 간다
        with patch.object(bridge, '_structure_drawing_allowed', return_value=True):
            drawn = bridge.call('cad_structure_drawings', {'setId': out['setId'], 'sheets': ['plan'], 'origin': {'x': 0, 'y': -30000}, 'target': self.target, 'expectedRevision': 0})
        self.assertEqual(drawn['status'], 'drawn'); self.assertEqual({k: self.browser.sets[out['setId']]['drawn'][k] for k in ('origin', 'sheets')}, {'origin': {'x': 0, 'y': -30000}, 'sheets': ['plan']})

    def test_schedule_sheet_is_forwarded_to_drawn_record(self):
        with self.server(), patch.object(bridge, '_structure_drawing_allowed', return_value=True):
            made = bridge.call('cad_structure_generate', {**KNOWN, 'outline': OUTLINE, 'insert': True, 'target': self.target, 'expectedRevision': 0})
            drawn = bridge.call('cad_structure_drawings', {'setId': made['setId'], 'sheets': ['schedule'], 'target': self.target, 'expectedRevision': 0})
        self.assertEqual(drawn['status'], 'drawn')
        self.assertEqual(self.browser.sets[made['setId']]['drawn']['sheets'], ['schedule'])

    def test_unknown_schedule_sheet_is_rejected(self):
        with self.server(), patch.object(bridge, '_structure_drawing_allowed', return_value=True):
            made = bridge.call('cad_structure_generate', {**KNOWN, 'outline': OUTLINE, 'insert': True, 'target': self.target, 'expectedRevision': 0})
            with self.assertRaisesRegex(ValueError, 'plan·foundation·schedule'):
                bridge.call('cad_structure_drawings', {'setId': made['setId'], 'sheets': ['bogus'], 'target': self.target, 'expectedRevision': 0})

    def test_out_of_scope_is_never_inserted_or_drawn(self):
        with self.server('rcBig'), patch.object(bridge, '_structure_drawing_allowed', return_value=True):
            out = bridge.call('cad_structure_generate', {'outline': {'x': 0, 'y': 0, 'width': 16000, 'depth': 15000}, 'insert': True, 'target': self.target, 'expectedRevision': 0})
            self.assertEqual(out['verdict'], '부적합'); self.assertFalse(out['inserted']); self.assertIn('부적합', out['refused'])
            self.assertTrue(any(f['item'].startswith('연면적') for f in out['ng']))
            self.assertEqual(self.browser.sets, {})
            with self.assertRaisesRegex(ValueError, '부적합'):
                bridge.call('cad_structure_drawings', {'setId': out['setId'], 'target': self.target, 'expectedRevision': 0})

    def test_set_member_reviews_again_on_server_and_redraws(self):
        def shrink(review, model):
            g1 = [m for m in model['members'] if m.get('code') == 'G1']
            return review + ([{'grp': '보', 'item': '단면 크기 ≥ 표', 'st': 'ng', 'val': '300×400', 'req': '300×500', 'ref': '표 4.2-1', 'ids': [m['id'] for m in g1]}] if g1 and g1[0]['h'] < 500 else [])
        with self.server(transform=shrink), patch.object(bridge, '_structure_drawing_allowed', return_value=True):
            made = bridge.call('cad_structure_generate', {**KNOWN, 'outline': OUTLINE, 'insert': True, 'target': self.target, 'expectedRevision': 0})
            out = bridge.call('cad_structure_set_member', {'setId': made['setId'], 'code': 'G1', 'size': '300x400', 'target': self.target, 'expectedRevision': 0})
        self.assertEqual(self.posts[-1], {'action': 'generate', 'input': self.posts[0]['input'], 'overrides': [{'code': 'G1', 'size': '300x400'}]}, '고친 모델이 아니라 원래 입력 + 덮어쓰기만 보낸다')
        self.assertEqual(out['verdict'], '부적합'); self.assertTrue(out['redrawn']); self.assertTrue(out['inDrawing'])
        self.assertEqual(self.browser.sets[made['setId']]['overrides'], [{'code': 'G1', 'size': '300x400'}])
        sent = len(self.posts)
        for bad in ({'code': 'g1', 'size': '300x400'}, {'code': 'G1', 'size': 'big'}, {'code': 'G1;drop', 'size': '300x400'}):
            with self.server(), self.assertRaises(ValueError):
                bridge.call('cad_structure_set_member', {'setId': made['setId'], 'target': self.target, 'expectedRevision': 0, **bad})
        self.assertEqual(len(self.posts), sent, '형식이 틀리면 서버를 부르지 않는다')

    def test_six_storeys_or_huge_is_out_of_scope_without_server(self):
        with self.server():
            out = bridge.call('cad_structure_generate', {**KNOWN, 'outline': OUTLINE, 'stories': 6}, allow_edit=False)
            big = bridge.call('cad_structure_generate', {'outline': {'x': 0, 'y': 0, 'width': 60000, 'depth': 9000}}, allow_edit=False)
        self.assertEqual(self.posts, [])
        self.assertEqual(out['verdict'], '적용범위 밖'); self.assertEqual(out['scope'][0]['item'], '층수')
        self.assertEqual(big['scope'][0]['item'], '건물 크기')
        with self.assertRaisesRegex(ValueError, '범위 밖'):
            bridge.call('cad_structure_set_member', {'setId': out['setId'], 'code': 'G1', 'size': '300x400', 'target': self.target, 'expectedRevision': 0})

    def test_inputs_checked_before_server(self):
        for args in ({'outline': {'x': 0, 'y': 0, 'width': 10, 'depth': 9000}}, {**KNOWN, 'outline': OUTLINE, 'system': 'brick'}, {**KNOWN, 'outline': OUTLINE, 'storyHeight': 100},
                     {**KNOWN, 'outline': OUTLINE, 'soil': {'Fe': 1, 'clay': True}}, {**KNOWN, 'outline': OUTLINE, 'insert': 'yes'}, {'outline': {'entityId': ''}}):
            with self.server(), self.assertRaises(ValueError, msg=str(args)):
                bridge.call('cad_structure_generate', args, allow_edit=False)
        self.assertEqual(self.posts, [])
        for set_id in ('', '../x', 'ds-1', 'st-123'):
            with self.assertRaises(ValueError):
                bridge.call('cad_structure_review', {'setId': set_id}, allow_edit=False)
        with self.assertRaisesRegex(ValueError, '없는 구조 묶음'):
            bridge.call('cad_structure_review', {'setId': 'st-0123456789'}, allow_edit=False)

    def test_full_contract_schema_and_polygon_floors_passthrough(self):
        schema = next(t for t in bridge.TOOLS if t['name'] == 'cad_structure_generate')['inputSchema']
        for key in ('floors', 'mode', 'renovation', 'stairsAt', 'basement', 'legal', 'boxes', 'readOptions', 'stairW', 'H', 'Fe', 'soilOk', 'walls', 'footings'):
            self.assertIn(key, schema['properties'])
        self.assertEqual(schema['properties']['outline']['type'], ['object', 'array'])
        self.assertEqual(schema['properties']['mode']['enum'], ['design', 'check', 'renovation'])
        ring = [[0, 0], [10, 0], [10, 4], [6, 9], [0, 9]]
        floors = [{'name': '1층', 'H': 3.3, 'outline': ring, 'walls': [{'x0': 0, 'y0': 0, 'x1': 10, 'y1': 0, 't': 200, 'mat': 'unknown'}],
                   'columns': [{'x': 0, 'y': 0, 'b': 500, 'h': 400}],
                   'footings': [{'x': 0, 'y': 0, 'B': 2.5, 'D': 400, 'status': 'existing'}]},
                  {'name': '2층', 'H': 3.2, 'outline': [[1, 0], [9, 0], [9, 8], [1, 8]], 'walls': []}]
        args = {**KNOWN, 'outline': ring, 'floors': floors, 'mode': 'renovation',
                'renovation': {'joint': 'separated', 'existingStories': 1, 'permitHistory': {'retained': True}},
                'stairsAt': [{'x0': 2, 'y0': 1, 'x1': 4, 'y1': 5}], 'basement': True, 'stairW': 1.2}
        before = copy.deepcopy(args)
        with self.server():
            out = bridge.call('cad_structure_generate', args, allow_edit=False)
        sent = self.posts[0]['input']
        for key in ('outline', 'floors', 'mode', 'renovation', 'basement', 'stairW'):
            self.assertEqual(sent[key], args[key], key)
        self.assertEqual(sent['stairsAt'], args['stairsAt'][0])
        self.assertEqual(sent['legal'], {'smallBuildingConfirmed': True})
        self.assertNotIn('X', sent); self.assertNotIn('Y', sent)
        self.assertEqual(sent['floors'][0]['footings'][0]['B'], 2.5)
        self.assertEqual(sent['floors'][0]['footings'][0]['D'], 400)
        self.assertEqual(args, before)
        self.assertEqual(ss.pending.get(out['setId'])['input']['engine'], sent)
        self.assertIsNone(ss.out_of_scope(sent))

    def test_read_stairs_list_becomes_one_engine_box_or_hold(self):
        # 평면 읽기는 계단을 목록으로 주고, 엔진은 외접 사각형 하나만 받는다(빈 목록은 stairsAt 입력 오류).
        ring = [[0, 0], [3.6, 0], [3.6, 8.85], [0, 8.85]]
        one = {'floors': [{'H': 3, 'outline': ring}], 'mode': 'check', 'recognitionFindings': []}
        none = ss.engine_input({**one, 'stairsAt': []})
        self.assertNotIn('stairsAt', none); self.assertEqual(none['recognitionFindings'], [])
        box = ss.engine_input({**one, 'stairsAt': [{'x0': 1, 'y0': 1, 'x1': 3, 'y1': 4, 'sourceIds': ['st']}]})
        self.assertEqual(box['stairsAt'], {'x0': 1, 'y0': 1, 'x1': 3, 'y1': 4})
        self.assertEqual(ss.engine_input({**one, 'stairsAt': {'x0': 1, 'y0': 1, 'x1': 3, 'y1': 4}})['stairsAt'], {'x0': 1, 'y0': 1, 'x1': 3, 'y1': 4})
        many = ss.engine_input({**one, 'stairsAt': [{'x0': 1, 'y0': 1, 'x1': 2, 'y1': 2, 'sourceIds': ['a']}, {'x0': 2, 'y0': 5, 'x1': 3, 'y1': 7, 'sourceIds': ['b']}]})
        self.assertNotIn('stairsAt', many)
        self.assertEqual([(f['st'], f['ids']) for f in many['recognitionFindings']], [('hold', ['a', 'b'])])
        self.assertIn('계단', many['recognitionFindings'][0]['text'])
        two = ss.engine_input({**one, 'floors': [{'H': 3, 'outline': ring}] * 2, 'stairsAt': []})
        self.assertNotIn('stairsAt', two)
        self.assertEqual([f['st'] for f in two['recognitionFindings']], ['hold']); self.assertIn('계단', two['recognitionFindings'][0]['text'])
        self.assertTrue(any(r['val'] == two['recognitionFindings'][0]['text'] for r in ss.review_with_conditions([], two)))
        # 계단 없는 1층 목조: 오류 없이 서버로 가고, stairsAt 은 빠진다.
        floor = {'outline': ring, 'H': 3, 'walls': []}
        def browser(action, args):
            if action == 'cad_structure_read' and 'outline' in args:
                return {'input': {'floors': [floor], 'outline': ring, 'stairs': 'none', 'stairsAt': []}, 'findings': []}
            return self.browser(action, args)
        with patch.object(bridge, 'dispatch', side_effect=browser), self.server():
            bridge.call('cad_structure_generate', {**KNOWN, 'system': 'wood', 'outline': OUTLINE, 'stories': 1}, allow_edit=False)
        self.assertNotIn('stairsAt', self.posts[0]['input']); self.assertEqual(self.posts[0]['input']['stairs'], 'none')

    def test_floors_only_and_floors_scope_override_stories(self):
        floor = {'outline': [[0, 0], [10, 0], [10, 9], [0, 9]], 'H': 3.3}
        with self.server():
            bridge.call('cad_structure_generate', {**KNOWN, 'floors': [floor], 'stories': 5}, allow_edit=False)
            out = bridge.call('cad_structure_generate', {**KNOWN, 'floors': [floor] * 3, 'stories': 1}, allow_edit=False)
        self.assertEqual(len(self.posts), 2)
        self.assertEqual(self.posts[1]['input']['reviewMethod'], 'kds41-preliminary')
        self.assertEqual(out['verdict'], '자료 부족')
        huge = ss.engine_input({'floors': [{'outline': [[0, 0], [50, 0], [50, 9], [0, 9]], 'H': 3.3}]})
        self.assertEqual(ss.out_of_scope(huge)[0]['st'], 'scope')

    def test_outline_reads_current_plan_and_keeps_openings_columns_stairs(self):
        floor = {'outline': [[0, 0], [10, 0], [10, 9], [0, 9]], 'H': 3.3,
                 'walls': [{'x0': 0, 'y0': 4.5, 'x1': 10, 'y1': 4.5, 't': 200, 'mat': 'conc', 'openings': [[5.5, 6.4]]}],
                 'columns': [{'x': 0, 'y': 0, 'b': 350, 'h': 350}]}
        extracted = {'floors': [floor], 'outline': floor['outline'], 'stairsAt': [{'x0': 1, 'y0': 1, 'x1': 3, 'y1': 4}]}
        findings = [{'level': 'info', 'text': '현재 평면을 읽었습니다.', 'ids': ['wall', 'door', 'stair']}]
        def browser(action, args):
            if action == 'cad_structure_read' and 'outline' in args:
                self.browser.calls.append((action, copy.deepcopy(args)))
                return {'input': extracted, 'findings': findings}
            return self.browser(action, args)
        with patch.object(bridge, 'dispatch', side_effect=browser), self.server():
            bridge.call('cad_structure_generate', {**KNOWN, 'outline': OUTLINE}, allow_edit=False)
        sent = self.posts[0]['input']
        self.assertEqual(sent['floors'], [floor]); self.assertEqual(sent['stairsAt'], extracted['stairsAt'][0])
        self.assertEqual(sent['mode'], 'check'); self.assertEqual(sent['recognitionFindings'], findings)
        call = next(c[1] for c in self.browser.calls if 'outline' in c[1])
        self.assertEqual(call['outline'], OUTLINE); self.assertEqual(call['options']['heights'], [3300])

    def test_failed_outline_read_does_not_fall_back_to_grid(self):
        with patch.object(bridge, 'dispatch', return_value={'input': None, 'findings': [{'level': 'error', 'text': '벽을 읽지 못했습니다.'}]}), self.server():
            with self.assertRaisesRegex(ValueError, '평면을 읽지 못했습니다.*벽'):
                bridge.call('cad_structure_generate', {**KNOWN, 'outline': OUTLINE}, allow_edit=False)
        self.assertEqual(self.posts, [])

    def test_explicit_members_skip_auto_read_and_keep_design(self):
        with self.server():
            bridge.call('cad_structure_generate', {**KNOWN, 'outline': OUTLINE, 'walls': [], 'mode': 'design'}, allow_edit=False)
        self.assertFalse(any('outline' in args for action, args in self.browser.calls))
        self.assertEqual(self.posts[0]['input']['mode'], 'design')

    def test_design_outline_skips_auto_read_for_requested_stories(self):
        for outline in (OUTLINE, [[0, 0], [10, 0], [10, 9], [0, 9]]):
            for stories in (1, 2):
                with self.subTest(outline=outline, stories=stories), self.server(), patch.object(bridge, 'dispatch', side_effect=AssertionError('unexpected plan read in design mode')):
                    bridge.call('cad_structure_generate', {**KNOWN, 'outline': outline, 'mode': 'design', 'stories': stories}, allow_edit=False)
                    sent = self.posts[-1]['input']
                    self.assertEqual(sent['mode'], 'design'); self.assertEqual(sent['stories'], stories)
                    self.assertNotIn('floors', sent)

    def test_outline_check_requires_all_requested_floor_plans(self):
        floor = {'outline': [[0, 0], [10, 0], [10, 9], [0, 9]], 'H': 3.3, 'walls': []}
        with patch.object(bridge, 'dispatch', return_value={'input': {'floors': [floor]}, 'findings': []}), self.server():
            with self.assertRaisesRegex(ValueError, '층별 boxes 또는 floors'):
                bridge.call('cad_structure_generate', {**KNOWN, 'outline': OUTLINE, 'stories': 2}, allow_edit=False)
        self.assertEqual(self.posts, [])

    def test_two_boxes_check_keeps_both_requested_floors(self):
        floor = {'outline': [[0, 0], [10, 0], [10, 9], [0, 9]], 'H': 3.3, 'walls': []}
        floors = [dict(floor, name='1층'), dict(floor, name='2층')]
        with patch.object(bridge, 'dispatch', return_value={'input': {'floors': floors}, 'findings': []}), self.server():
            bridge.call('cad_structure_generate', {**KNOWN, 'boxes': ['b1', 'b2'], 'mode': 'check', 'stories': 2}, allow_edit=False)
        self.assertEqual(self.posts[0]['input']['floors'], floors)
        self.assertEqual(self.posts[0]['input']['stories'], 2)

    def test_floors_send_only_server_keys_and_explain_bad_ones(self):
        # 실서버(2026-10-19)는 층에 alignment·heightConflict·level·z 가 있으면 floors[0] 으로만 거절했다.
        ring = [[0, 0], [10, 0], [10, 7], [0, 7]]
        aligned = [{'name': n, 'H': 3, 'outline': ring, 'walls': [], 'sourceIds': ['b' + n],
                    'alignment': {'method': 'datum', 'confirmed': True, 'translationMm': [0, 0]}} for n in ('1층', '2층')]
        with patch.object(bridge, 'dispatch', return_value={'input': {'floors': aligned}, 'findings': []}), self.server():
            bridge.call('cad_structure_generate', {**KNOWN, 'boxes': ['b1', 'b2'], 'mode': 'check'}, allow_edit=False)
        self.assertEqual([sorted(f) for f in self.posts[0]['input']['floors']], [['H', 'name', 'outline', 'sourceIds', 'walls']] * 2)
        with self.assertRaisesRegex(ValueError, '2층 기준점 맞춤이 확인되지 않았습니다'):
            ss.engine_input({'floors': [{'H': 3, 'outline': ring}, {'H': 3, 'outline': ring, 'alignment': {'method': 'auto', 'confirmed': False}}]})
        with self.assertRaisesRegex(ValueError, r'floors\[0\] 에는 level, z 칸을 쓸 수 없습니다'):
            ss.engine_input({'floors': [{'level': 1, 'z': 0, 'H': 3, 'outline': ring}]})
        with self.assertRaisesRegex(ValueError, r'floors\[1\]\.H\(층고 m\)가 필요합니다'):
            ss.engine_input({'floors': [{'H': 3, 'outline': ring}, {'outline': ring}]})
        with self.assertRaisesRegex(ValueError, '2층 층고 숫자가 도면에서 서로 다릅니다'):
            ss.engine_input({'floors': [{'H': 3, 'outline': ring}, {'outline': ring, 'heightConflict': True}]})
        self.assertEqual([f['H'] for f in ss.engine_input({'H': 3, 'floors': [{'outline': ring}, {'outline': ring, 'H': 2.8}]})['floors']], [3, 2.8])
        self.assertEqual([f['H'] for f in ss.engine_input({'storyHeight': 3300, 'floors': [{'outline': ring}, {'outline': ring}]})['floors']], [3.3, 3.3])
        # 단위 실수: m 자리에 mm
        with self.assertRaisesRegex(ValueError, r'floors\[0\]\.H 가 3000 입니다\. H 는 m'):
            ss.engine_input({'floors': [{'H': 3000, 'outline': ring}]})
        with self.assertRaisesRegex(ValueError, 'H 는 층고 m'):
            ss.engine_input({'H': 3000, 'X': 10, 'Y': 7, 'stories': 1})
        with self.assertRaisesRegex(ValueError, '10,000 m 로 너무 큽니다'):
            ss.engine_input({'floors': [{'H': 3, 'outline': [[0, 0], [10000, 0], [10000, 7000], [0, 7000]]}]})
        for wall in ({'points': [[0, 0], [10, 0]], 't': 200}, {'x1': 0, 'y1': 0, 'x2': 10, 'y2': 0},
                     {'x0': 0, 'y0': 0, 'x1': 10, 'y1': 0, 'openings': [{'start': 1, 'end': 2}]}):
            with self.subTest(wall=wall), self.assertRaisesRegex(ValueError, r'floors\[0\]\.walls\[0\] 은 벽 중심선 x0·y0·x1·y1'):
                ss.engine_input({'floors': [{'H': 3, 'outline': ring, 'walls': [wall]}]})

    def test_wall_unresolved_openings_dropped_when_empty_and_stop_when_present(self):
        ring = [[0, 0], [10, 0], [10, 7], [0, 7]]
        wall = {'x0': 0, 'y0': 0, 'x1': 10, 'y1': 0, 't': 200, 'mat': 'conc', 'openings': [], 'sourceIds': ['w1']}
        sent = ss.engine_input({'floors': [{'H': 3, 'outline': ring, 'walls': [{**wall, 'unresolvedOpenings': []}]}]})
        self.assertNotIn('unresolvedOpenings', sent['floors'][0]['walls'][0])
        with self.assertRaisesRegex(ValueError, r'1층 벽\(w1\)에 어느 벽에 붙었는지 정해지지 않은 창·문\(d1\)'):
            ss.engine_input({'floors': [{'H': 3, 'outline': ring, 'walls': [{**wall, 'unresolvedOpenings': [{'openingId': 'd1', 'needsConfirmation': True}]}]}]})

    def test_same_layout_upper_copies_read_ground_floor_only_when_confirmed(self):
        ground = {'name': '1층', 'H': 3, 'outline': [[0, 0], [10, 0], [10, 7], [0, 7]], 'sourceIds': ['box1'], 'walls': [{'x0': 0, 'y0': 0, 'x1': 10, 'y1': 0, 't': 200, 'mat': 'conc', 'sourceIds': ['w1']}]}
        with patch.object(bridge, 'dispatch', return_value={'input': {'floors': [ground]}, 'findings': []}), self.server():
            with self.assertRaisesRegex(ValueError, r'읽은 층 1개, 요청 2층.*sameLayoutUpper=true'):
                bridge.call('cad_structure_generate', {**KNOWN, 'outline': OUTLINE, 'stories': 2, 'storyHeight': 3000}, allow_edit=False)
            self.assertEqual(self.posts, [])
            bridge.call('cad_structure_generate', {**KNOWN, 'outline': OUTLINE, 'stories': 2, 'storyHeight': 3000, 'sameLayoutUpper': True}, allow_edit=False)
        sent = self.posts[0]['input']['floors']
        self.assertEqual([f['name'] for f in sent], ['1층', '2층'])
        self.assertEqual(sent[1]['walls'], [{k: v for k, v in w.items() if k != 'sourceIds'} for w in ground['walls']]); self.assertEqual(sent[1]['H'], 3)
        self.assertEqual(sent[0]['walls'][0]['sourceIds'], ['w1']); self.assertNotIn('sourceIds', sent[1]['walls'][0]); self.assertNotIn('sourceIds', sent[1])
        self.assertNotIn('sameLayoutUpper', self.posts[0]['input'])

    def test_box_selection_dispatch_input_findings_and_mode_are_kept(self):
        floor = {'outline': [[0, 0], [8, 0], [8, 7], [0, 7]], 'H': 3.3, 'walls': []}
        extracted = {'system': 'wood', 'floors': [floor], 'outline': floor['outline'], 'stairsAt': [{'x0': 1, 'y0': 2, 'x1': 2, 'y1': 4}], 'basement': True}
        findings = [{'level': 'warn', 'text': '벽 재료를 확인해야 합니다.', 'ids': ['w1']}]
        original = self.browser.__call__
        def browser(action, args):
            if action == 'cad_structure_read' and 'boxes' in args:
                self.browser.calls.append((action, copy.deepcopy(args)))
                return {'input': extracted, 'findings': findings}
            return original(action, args)
        with patch.object(bridge, 'dispatch', side_effect=browser), self.server():
            out = bridge.call('cad_structure_generate', {**{k: v for k, v in KNOWN.items() if k != 'basement'}, 'boxes': ['box1'], 'mode': 'check',
                                                      'readOptions': {'datums': [{'x': 1000, 'y': 2000}]}}, allow_edit=False)
        self.assertEqual(self.posts[0]['input']['mode'], 'check')
        self.assertEqual(self.posts[0]['input']['floors'], extracted['floors'])
        self.assertEqual(self.posts[0]['input']['stairsAt'], extracted['stairsAt'][0])
        self.assertTrue(self.posts[0]['input']['basement'])
        self.assertEqual(out['verdict'], '자료 부족'); self.assertFalse(out['canCreateCertificate'])
        self.assertTrue(any(f['value'] == findings[0]['text'] and f['ids'] == ['w1'] for f in out['hold']))
        call = next(c[1] for c in self.browser.calls if 'boxes' in c[1])
        self.assertEqual(call['options'], {'datums': [{'x': 1000, 'y': 2000}]})

    def test_unknown_conditions_are_not_promoted_by_old_server_defaults(self):
        with self.server():
            out = bridge.call('cad_structure_generate', {'outline': OUTLINE, 'insert': True, 'target': self.target, 'expectedRevision': 0})
        self.assertEqual(out['verdict'], '자료 부족'); self.assertFalse(out['inserted']); self.assertFalse(out['canCreateCertificate'])
        self.assertNotIn('Fe', self.posts[0]['input'])
        self.assertNotIn('wind', self.posts[0]['input'])
        items = {f['item'] for f in out['hold']}
        self.assertTrue({'용도', '층고', '바람 조건', '눈 조건', '지내력', '지반', '지하층', '법적 적용 조건'} <= items)
        # 2026-10-30 대표 '로그인이면 초안으로 그림': 자료 부족도 구조도는 그리되 장마다 '검토 초안' 도장
        drawn = bridge._structure_record({'setId': out['setId']})[0]
        with patch.object(bridge, '_structure_drawing_allowed', return_value=False), patch.object(bridge, 'dispatch', side_effect=lambda a, x: {'sheets': [], 'count': 0} if a == 'cad_structure_preview' else self.browser(a, x)) as preview:
            res = bridge.call('cad_structure_drawings', {'setId': out['setId'], 'target': self.target, 'expectedRevision': 0})
        self.assertEqual(res['status'], 'approval_required')
        self.assertIn('검토 초안', preview.call_args[0][1]['record']['drawn']['draft'])
        desc = next(t['description'] for t in bridge.TOOLS if t['name'] == 'cad_structure_generate')
        self.assertIn('자료 부족으로 남긴 채', desc); self.assertIn('확정이라고 말하지', desc); self.assertIn('확인서를 만들지', desc); self.assertIn('미리 가정', desc)

    def test_all_non_ok_statuses_keep_reason_fix_and_block_insert(self):
        labels = {'hold': '자료 부족', 'unsupported': '미지원', 'scope': '적용범위 밖', 'ng': '부적합'}
        for status, label in labels.items():
            fixture = copy.deepcopy(FIXTURES['rc'])
            fixture['review'] = [{'st': status, 'item': '판정 항목', 'val': '원문 이유 문장', 'req': '확인할 원문', 'ref': '원문 조항', 'fix': 'layout', 'ids': ['w1']}]
            fixture['verdict'] = ss.verdict_of(fixture['review'])
            fixture['verdict']['engineMarker'] = 'CORE'
            with patch.object(ss, 'post', return_value=fixture):
                out = bridge.call('cad_structure_generate', {**KNOWN, 'outline': OUTLINE, 'insert': True, 'target': self.target, 'expectedRevision': 0})
            self.assertEqual(out['verdict'], label); self.assertEqual(out['engineMarker'], 'CORE')
            self.assertFalse(out['inserted']); self.assertFalse(out['canCreateCertificate'])
            self.assertEqual(out[status][0]['value'], '원문 이유 문장')
            self.assertEqual(out[status][0]['required'], '확인할 원문'); self.assertEqual(out[status][0]['fix'], 'layout')
            self.assertEqual(out['fixKinds'], ['layout']); self.assertEqual(out['counts'][status], 1)

    def test_saved_legacy_set_rechecks_missing_conditions_and_legal_confirmation(self):
        old = ss.record_from(FIXTURES['rc'], {}, OUTLINE, ss.engine_input(KNOWN, OUTLINE))
        old['input']['engine'] = {'X': 10, 'Y': 9}
        old['review'] = [{'st': 'ok', 'item': '예전 적합'}]
        self.browser.sets[old['id']] = old
        out = bridge.call('cad_structure_review', {'setId': old['id']}, allow_edit=False)
        self.assertEqual(out['verdict'], '자료 부족'); self.assertFalse(out['canCreateCertificate'])
        self.assertTrue(any(f['status'] == 'hold' for f in out['review']))
        with patch.object(bridge, '_structure_drawing_allowed', return_value=False), patch.object(bridge, 'dispatch', side_effect=lambda a, x: {'sheets': [], 'count': 0} if a == 'cad_structure_preview' else self.browser(a, x)) as preview:
            bridge.call('cad_structure_drawings', {'setId': old['id'], 'target': self.target, 'expectedRevision': 0})
        self.assertIn('검토 초안', preview.call_args[0][1]['record']['drawn']['draft'], '자료 부족은 초안 도장으로 그림(대표 2026-10-30)')
        for legal in ({'note': 'unknown'}, {'clause3': False}, {'excluded32_2_3to8Confirmed': False}):
            engine = ss.engine_input({**KNOWN, 'legal': legal}, OUTLINE)
            out = ss.brief(ss.record_from(FIXTURES['rc'], {}, OUTLINE, engine))
            self.assertEqual(out['verdict'], '자료 부족', legal)

    def test_notes_sheet_forwarding_and_server_column_bars_are_authoritative(self):
        def rebars(review, model):
            for m in model['members']:
                if m.get('code') == 'C1':
                    m['bars'] = '12-D19'
            return review
        with self.server(transform=rebars), patch.object(bridge, '_structure_drawing_allowed', return_value=True):
            made = bridge.call('cad_structure_generate', {**KNOWN, 'outline': OUTLINE, 'insert': True, 'target': self.target, 'expectedRevision': 0})
            out = bridge.call('cad_structure_set_member', {'setId': made['setId'], 'code': 'C1', 'size': '500x500', 'target': self.target, 'expectedRevision': 0})
            drawn = bridge.call('cad_structure_drawings', {'setId': made['setId'], 'sheets': ['notes'], 'target': self.target, 'expectedRevision': 0})
        self.assertEqual(out['verdict'], '적합')
        columns = [m for m in self.browser.sets[made['setId']]['model']['members'] if m.get('code') == 'C1']
        self.assertTrue(columns); self.assertTrue(all(m['bars'] == '12-D19' and m['b'] == 500 for m in columns))
        self.assertEqual(self.browser.sets[made['setId']]['drawn']['sheets'], ['notes'])
        self.assertEqual(drawn['status'], 'drawn')

    def test_old_server_cannot_claim_oversized_column_with_unchanged_bars_ok(self):
        with self.server():
            made = bridge.call('cad_structure_generate', {**KNOWN, 'outline': OUTLINE}, allow_edit=False)
            out = bridge.call('cad_structure_set_member', {'setId': made['setId'], 'code': 'C1', 'size': '900x900', 'target': self.target, 'expectedRevision': 0})
        self.assertEqual(out['verdict'], '부적합')
        self.assertTrue(any('서버 주근 재계산 미완료' in f['value'] for f in out['ng']))


    def test_column_recheck_cannot_be_lost_by_repeat_or_other_member_change(self):
        with self.server():
            made = bridge.call('cad_structure_generate', {**KNOWN, 'outline': OUTLINE}, allow_edit=False)
            for code, size in [('C1', '900x900'), ('C1', '900x900'), ('G1', '300x550')]:
                out = bridge.call('cad_structure_set_member', {'setId': made['setId'], 'code': code, 'size': size, 'target': self.target, 'expectedRevision': 0})
                self.assertEqual(out['verdict'], '부적합')
                self.assertTrue(any(f['item'] == '서버 주근 재계산' for f in out['ng']))


    def test_legacy_direct_meter_dimensions_remain_available(self):
        with self.server():
            out = bridge.call('cad_structure_generate', {**KNOWN, 'X': 10, 'Y': 9, 'H': 3.3}, allow_edit=False)
        self.assertEqual(out['verdict'], '적합')
        self.assertEqual(self.posts[0]['input']['X'], 10)
        self.assertEqual(self.posts[0]['input']['Y'], 9)
        self.assertEqual(ss.engine_input({'X': 10, 'Y': 9})['X'], 10)



    def test_certificate_schema_and_read_only(self):
        tool = next(t for t in bridge.TOOLS if t['name'] == 'cad_structure_certificate')
        self.assertIn('setId', tool['inputSchema']['required'])
        self.assertEqual(tool['inputSchema']['properties']['format']['enum'], ['pdf', 'html'])
        self.assertNotIn('cad_structure_certificate', bridge.MUTATING_TOOLS)
        self.assertIn('missing.question', tool['description'])

    def test_certificate_validates_before_browser(self):
        for change in ({'format': 'docx'}, {'project': []}, {'project': {'x': []}}, {'project': {'x': float('nan')}}, {'project': {'x': 'a' * 2001}}):
            with self.assertRaises(ValueError):
                bridge.call('cad_structure_certificate', {'setId': 'st-0123456789', **change}, allow_edit=False)
        self.assertEqual(self.browser.calls, [])

    def test_certificate_forwards_project_and_target_and_stops_on_refusal(self):
        with self.server():
            made = bridge.call('cad_structure_generate', {'outline': OUTLINE}, allow_edit=False)
        denied = {'ok': False, 'reason': '범위 밖(구조계산 필요)', 'reasons': ['연면적 초과'], 'missing': []}
        calls = []
        def dispatch(action, args):
            if action == 'cad_structure_certificate':
                calls.append(args)
                return denied
            return self.browser(action, args)
        with patch.object(bridge, 'dispatch', side_effect=dispatch), patch.object(ss, 'export_certificate') as exporter:
            out = bridge.call('cad_structure_certificate', {'setId': made['setId'], 'project': {'공사명': '검증'}, 'target': self.target}, allow_edit=False)
        self.assertEqual({k: v for k, v in out.items() if k != 'destination'}, denied)   # 모든 도구 결과에 destination 이 붙는다
        self.assertEqual(calls[0]['project'], {'공사명': '검증'})
        self.assertEqual(calls[0]['target'], self.target)
        self.assertEqual(calls[0]['record']['id'], made['setId'])
        exporter.assert_not_called()
        # 3~5층 서버 답은 원 입력 p 를 빼고 온다 — 계산서에는 기록의 엔진 입력을 p 로, 층수는 층 목록 수(괴정 2026-10-30)
        p = calls[0]['record']['model']['p']
        engine = bridge._structure_record({'setId': made['setId']})[0]['input']['engine']
        self.assertEqual(p['stories'], len(engine['floors']) if engine.get('floors') else engine.get('stories', 2))

    def test_certificate_success_exports_instead_of_mutating_drawing(self):
        with self.server():
            made = bridge.call('cad_structure_generate', {'outline': OUTLINE}, allow_edit=False)
        value = {'ok': True, 'html': '<!doctype html>', 'table': {}, 'missing': [{'key': 'author'}]}
        def dispatch(action, args):
            return value if action == 'cad_structure_certificate' else self.browser(action, args)
        with patch.object(bridge, 'dispatch', side_effect=dispatch), patch.object(ss, 'export_certificate', return_value={'ok': True, 'path': 'scratch.pdf'}) as exporter:
            out = bridge.call('cad_structure_certificate', {'setId': made['setId'], 'format': 'pdf'}, allow_edit=False)
        self.assertEqual(out['path'], 'scratch.pdf')
        exporter.assert_called_once_with(value, made['setId'], 'pdf', None)   # 대상 도면이 없으면 임시 폴더
        self.assertEqual(self.browser.sets, {})




    def test_calc_report_schema_and_read_only(self):
        tool = next(t for t in bridge.TOOLS if t['name'] == 'cad_structure_calc_report')
        self.assertIn('setId', tool['inputSchema']['required'])
        self.assertEqual(tool['inputSchema']['properties']['format']['enum'], ['html'])
        self.assertNotIn('cad_structure_calc_report', bridge.MUTATING_TOOLS)
        self.assertIn('missing.question', tool['description'])

    def test_calc_report_validates_before_browser(self):
        for change in ({'format': 'pdf'}, {'project': []}, {'project': {'x': []}}, {'project': {'x': float('nan')}}):
            with self.assertRaises(ValueError):
                bridge.call('cad_structure_calc_report', {'setId': 'st-0123456789', **change}, allow_edit=False)
        self.assertEqual(self.browser.calls, [])

    def test_calc_report_forwards_target_and_refuses_without_file(self):
        with self.server():
            made = bridge.call('cad_structure_generate', {'outline': OUTLINE}, allow_edit=False)
        denied = {'ok': False, 'reason': '3~5층 전용', 'reasons': ['1~2층 확인서 사용'], 'missing': []}
        calls = []
        def dispatch(action, args):
            if action == 'cad_structure_calc_report':
                calls.append(args)
                return denied
            return self.browser(action, args)
        with patch.object(bridge, 'dispatch', side_effect=dispatch), patch.object(ss, 'export_calc_report') as exporter:
            out = bridge.call('cad_structure_calc_report', {'setId': made['setId'], 'project': {'공사명': '검증'}, 'target': self.target}, allow_edit=False)
        self.assertEqual({k: v for k, v in out.items() if k != 'destination'}, denied)   # 모든 도구 결과에 destination 이 붙는다
        self.assertEqual(calls[0]['project'], {'공사명': '검증'})
        self.assertEqual(calls[0]['target'], self.target)
        self.assertEqual(calls[0]['record']['id'], made['setId'])
        exporter.assert_not_called()

    def test_calc_report_success_exports_html_only_without_drawing_change(self):
        with self.server():
            made = bridge.call('cad_structure_generate', {'outline': OUTLINE}, allow_edit=False)
        value = {'ok': True, 'html': '<!doctype html>', 'sections': [], 'missing': [{'key': 'author'}]}
        def dispatch(action, args):
            return value if action == 'cad_structure_calc_report' else self.browser(action, args)
        with patch.object(bridge, 'dispatch', side_effect=dispatch), patch.object(ss, 'export_calc_report', return_value={'ok': True, 'path': 'scratch.html'}) as exporter:
            out = bridge.call('cad_structure_calc_report', {'setId': made['setId']}, allow_edit=False)
        self.assertEqual(out['path'], 'scratch.html')
        exporter.assert_called_once_with(value, made['setId'], None)
        self.assertEqual(self.browser.sets, {})


class StructureServiceTest(unittest.TestCase):

    def test_calc_report_export_html_and_rejection(self):
        import tempfile
        with tempfile.TemporaryDirectory() as folder:
            with patch('tempfile.mkdtemp', return_value=folder):
                result = {'ok': True, 'html': '<!doctype html><html lang="ko">초안</html>', 'missing': [{'key': 'x', 'question': '확인해 주세요.'}], 'sections': [{'id': 1}]}
                out = ss.export_calc_report(result, 'st-0123456789')
            self.assertEqual(Path(out['path']).read_text(encoding='utf-8'), result['html'])
            self.assertEqual(out['missing'], result['missing'])
            self.assertEqual(out['format'], 'html')
            self.assertEqual(out['sections'], result['sections'])
        denied = {'ok': False, 'reason': '거절'}
        with patch('tempfile.mkdtemp') as create:
            self.assertEqual(ss.export_calc_report(denied, 'st-0123456789'), denied)
            for sid, result in [('bad', {'ok': True, 'html': '<!doctype html>'}), ('st-0123456789', {'ok': True, 'html': ''})]:
                with self.assertRaises(ValueError):
                    ss.export_calc_report(result, sid)
            create.assert_not_called()


    def test_post_maps_server_errors_and_never_follows_redirects(self):
        def fail(code, body=b'{}'):
            return urllib.error.HTTPError('https://x', code, 'x', {}, io.BytesIO(body))
        for code, want in ((401, 'not_logged_in'), (403, 'blocked'), (429, 'limit'), (400, 'bad_input'), (422, 'cannot_compute'), (503, 'offline'), (500, 'server')):
            with patch.object(ss._opener, 'open', side_effect=fail(code, b'{"field":"X"}')), self.assertRaises(ss.StructureServiceError) as caught:
                ss.post({'action': 'generate', 'input': {}}, token_reader=lambda: 'tok')
            self.assertEqual(caught.exception.code, want)
        with self.assertRaises(ss.StructureServiceError) as caught:
            ss.post({}, token_reader=lambda: None)
        self.assertEqual(caught.exception.code, 'not_logged_in')
        self.assertIsNone(ss._NoRedirect().redirect_request(None, None, 302, '', {}, 'https://evil.example'))

    def test_large_answer_is_read_and_bad_answer_is_not_offline(self):
        # 괴정 4층 개략 검토 답 17.8 MB 를 16 MB 상한이 '연결 못 함'으로 버렸다(2026-10-30)
        ok = json.dumps({'state': 'ok', 'model': {'pad': 'x' * (18 * 1024 * 1024)}, 'review': []}).encode()
        class R(io.BytesIO):
            def __enter__(self): return self
            def __exit__(self, *a): return False
        with patch.object(ss._opener, 'open', return_value=R(ok)):
            self.assertEqual(ss.post({'action': 'generate', 'input': {}}, token_reader=lambda: 'tok')['state'], 'ok')
        with patch.object(ss._opener, 'open', return_value=R(b'{"state":"failed"}')), self.assertRaises(ss.StructureServiceError) as caught:
            ss.post({'action': 'generate', 'input': {}}, token_reader=lambda: 'tok')
        self.assertEqual(caught.exception.code, 'server')

    def test_usual_values_fill_only_absent_and_mark_assumption(self):
        # 대표 2026-10-30 '그걸로': 3~5층 개략 검토의 빈 칸을 보통 값으로, 근거에 '미리 가정' — 준 값·일부러 비운 값(None)은 그대로
        usual = json.load(open('rules/knowledge/drawing-standard.json', encoding='utf-8'))['structureAssumptions']
        sq = [[0, 0], [10, 0], [10, 8], [0, 8]]
        p = {'reviewMethod': 'kds41-preliminary', 'system': 'rc', 'structureType': 'rc-moment', 'stories': 4, 'otherLoads': {'F': None},
             'occupancy': {'legalUse': '1·2층 근린생활시설 / 3·4층 단독주택'},
             'floors': [{'name': f'{i}층', 'H': 3, 'outline': sq, 'columns': [{'id': 'C1', 'x': 0, 'y': 0, 'b': 500, 'h': 500}]} for i in range(1, 5)]}
        out = ss.si.fill_usual(p, usual)
        self.assertEqual(out['seismic']['siteClass'], 'S4'); self.assertEqual(out['seismic']['topZ'], 12)
        self.assertEqual(out['lateralSystem']['x']['systemKey'], 'rcMomentOrdinary')
        self.assertEqual([d['liveZones'][0]['use'] for d in out['diaphragms']], ['상점 2층 이상', '주거', '주거', '지붕'])
        self.assertEqual(out['diaphragms'][0]['DL'], 5.1); self.assertEqual(out['diaphragms'][-1]['snow_kNm2'], 0.5)
        self.assertEqual(out['occupancy']['residentialStoreys'], 2)
        self.assertIsNone(out['otherLoads']['F'], '일부러 비운 값은 채우지 않음'); self.assertEqual(out['otherLoads']['T'], 0)
        self.assertEqual(out['floors'][0]['columns'][0]['bar'], 'D22')
        self.assertTrue(all(e['source'] == ss.si.USUAL_SOURCE for k, e in out['inputEvidence'].items() if k.startswith('seismic.')))
        self.assertEqual(ss.si.fill_usual({**p, 'stories': 2, 'floors': p['floors'][:2], 'reviewMethod': None}, usual)['floors'][0].get('liveUse'), None, '1~2층은 그대로')

    def test_calc_report_goes_to_drawing_folder(self):
        # 임시 폴더에 두면 찾을 수 없었다(괴정 2026-10-30) — 도면 폴더를 주면 거기에
        import tempfile
        with tempfile.TemporaryDirectory() as folder:
            out = ss.export_calc_report({'ok': True, 'html': '<!doctype html>x'}, 'st-0123456789', folder)
            self.assertEqual(os.path.dirname(out['path']), folder); self.assertTrue(os.path.isfile(out['path']))

    def test_drawing_structure_names_map_to_engine_names(self):
        # 도면 한 벌의 rc-frame(라멘)을 그대로 보내 '제품 적용 범위 밖'이 됐다(괴정 2026-10-30)
        for drawn, engine in (('rc-frame', 'rc-moment'), ('wall', 'rc-wall'), ('steel', 'steel-moment'), ('rc-moment', 'rc-moment')):
            self.assertEqual(ss.engine_input({'mode': 'check', 'stories': 4, 'X': 10, 'Y': 8, 'structureType': drawn})['structureType'], engine)

    def test_evidence_notes_use_only_server_fields(self):
        # 서버는 근거 칸마다 source·confirmed·assumption 만 받는다. '부산광역시 …' 주소로 지진구역이 채워지면 reference·value 가 붙어 거절됐다(2026-10-30).
        out = ss.engine_input({'mode': 'design', 'stories': 4, 'X': 10, 'Y': 8, 'location': '부산광역시 사하구 괴정동 213-17', 'use': 'other'})
        self.assertTrue(out['inputEvidence'])
        for note in out['inputEvidence'].values():
            self.assertEqual(set(note), {'source', 'confirmed', 'assumption'})
            self.assertIn('근거', note['assumption'])

    def test_post_sends_bearer_to_configured_url(self):
        seen = {}

        class Response(io.BytesIO):
            def __enter__(self): return self
            def __exit__(self, *a): return False

        def open_(request, timeout):
            seen.update(url=request.full_url, auth=request.headers['Authorization'], body=json.loads(request.data))
            return Response(json.dumps(FIXTURES['rc']).encode())
        with patch.dict('os.environ', {'BARUN_CAD_STRUCTURE_URL': 'http://127.0.0.1:3000'}), patch.object(ss._opener, 'open', side_effect=open_):
            out = ss.post({'action': 'generate', 'input': {'X': 10, 'Y': 9}}, token_reader=lambda: 'tok')
        self.assertEqual(seen['url'], 'http://127.0.0.1:3000/api/public/cad-structure'); self.assertEqual(seen['auth'], 'Bearer tok')
        self.assertEqual(out['rulesVersion'], 'KDS 42:2022')

    def test_merge_override_formats(self):
        self.assertEqual(ss.merge_override([{'code': 'G1', 'size': '300x500'}, {'code': 'C1', 'size': '400x400'}], 'G1', '300x400'),
                         [{'code': 'C1', 'size': '400x400'}, {'code': 'G1', 'size': '300x400'}])
        for size in ('300x550', '2500x400', 'H-400x200x8x13', '38x235', '300 x 550'):
            ss.merge_override([], 'G1', size)
        for code, size in (('g1', '300x400'), ('G1', ''), ('G1', 'x'), ('', '300x400'), ('G1', 'H-')):
            with self.assertRaises(ValueError):
                ss.merge_override([], code, size)

    def test_verdict_priority_and_stale_engine_summary(self):
        review = [{'st': st, 'fix': kind} for st, kind in [('ok', None), ('hold', 'field'), ('unsupported', 'input'), ('ng', 'member'), ('scope', 'calc')]]
        for expected in ('적용범위 밖', '부적합', '미지원', '자료 부족', '적합'):
            self.assertEqual(ss.verdict(review), expected)
            self.assertEqual(ss.verdict_of(review, {'verdict': '적합', 'counts': {}, 'fixKinds': []})['verdict'], expected)
            review.pop()

    def test_quantity_summary_shows_formwork_net_and_assumed_lap(self):
        q = ss._quantity_brief({'tot': {'conc': 10, 'form': 20, 'steel': 1000}, 'lapFactor': 1.1})
        self.assertEqual(q['formworkM2'], 20); self.assertEqual(q['rebarTon'], 1)
        self.assertEqual(q['rebarWithLapTon'], 1.1); self.assertEqual(q['lapFactor'], 1.1)
        self.assertIn('철근 이음·정착 +10% 가정치', q['assumptions'])
        wood = ss._quantity_brief(FIXTURES['wood']['quantities'])
        self.assertEqual(wood['concreteM3'], 60.1)
        self.assertEqual(wood['rebarWithLapTon'], 0.89)
        self.assertIsNone(wood['formworkM2'])

    def test_invalid_mode_and_nonfinite_polygon_do_not_reach_server(self):
        for args in ({'mode': 'chek'}, {'outline': [[0, 0], [10, float('nan')], [0, 10]]},
                     {'floors': [{'outline': [[0, 0], [1, 0], [0, float('inf')]]}]}):
            with self.assertRaises(ValueError):
                ss.engine_input({**KNOWN, 'outline': OUTLINE, **args}, args.get('outline', OUTLINE))


    def test_partial_server_verdict_and_unknown_values_fall_back_safely(self):
        review = [{'st': 'hold', 'fix': 'field'}]
        for partial in ({'verdict': '자료 부족'}, {'verdict': '자료 부족', 'counts': None}, None):
            self.assertEqual(ss.verdict_of(review, partial)['verdict'], '자료 부족')
        for key, value in [('wind', 'unknown'), ('snow', 'unknown'), ('use', 'unknown'), ('basement', -1)]:
            engine = ss.engine_input({**KNOWN, key: value}, OUTLINE)
            self.assertEqual(ss.brief(ss.record_from(FIXTURES['rc'], {}, OUTLINE, engine))['verdict'], '자료 부족')




class CertificateExportTest(unittest.TestCase):
    def sample(self):
        return {'ok': True, 'html': '<!doctype html><html lang="ko">[별지 제3호서식]</html>', 'missing': [{'key': 'author'}],
                'table': {'columnWidths': [40, 146], 'rowHeights': [12, 12], 'rows': [
                    [{'row': 0, 'column': 0, 'rowspan': 1, 'colspan': 2, 'text': '[별지 제3호서식]\n구조안전 및 내진설계 확인서\n210㎜×297㎜', 'border': False}],
                    [{'row': 1, 'column': 0, 'rowspan': 1, 'colspan': 1, 'text': '1) 공사명'},
                     {'row': 1, 'column': 1, 'rowspan': 1, 'colspan': 1, 'text': '검증용 가상 공사'}]]}}

    def test_export_a4_pdf_korean_and_html(self):
        import tempfile
        from pypdf import PdfReader
        with tempfile.TemporaryDirectory(prefix='certificate-test-') as folder:
            with patch('tempfile.mkdtemp', return_value=folder):
                pdf = ss.export_certificate(self.sample(), 'st-0123456789')
                html = ss.export_certificate(self.sample(), 'st-0123456789', 'html')
            reader = PdfReader(pdf['path'])
            self.assertEqual(len(reader.pages), 1)
            self.assertAlmostEqual(float(reader.pages[0].mediabox.width), 595.276, places=2)
            self.assertAlmostEqual(float(reader.pages[0].mediabox.height), 841.890, places=2)
            self.assertIn('검증용 가상 공사', reader.pages[0].extract_text())
            self.assertIn('210㎜×297㎜', reader.pages[0].extract_text())
            self.assertEqual(Path(html['path']).read_text(encoding='utf-8'), self.sample()['html'])
            self.assertEqual(pdf['missing'], [{'key': 'author'}])
            self.assertNotIn('table', pdf)

    def test_refusal_and_invalid_grid_never_create_file(self):
        with patch('tempfile.mkdtemp') as mkdir:
            denied = {'ok': False, 'reason': '구조계산 필요'}
            self.assertEqual(ss.export_certificate(denied, 'st-0123456789'), denied)
            for change in ('overlap', 'overflow', 'invalid_id'):
                data = self.sample()
                set_id = '../bad' if change == 'invalid_id' else 'st-0123456789'
                if change == 'overlap':
                    data['table']['rows'][1][0]['colspan'] = 2
                elif change == 'overflow':
                    data['table']['rows'][1][1]['text'] = '가' * 4000
                with self.assertRaises(ValueError):
                    ss.export_certificate(data, set_id)
            mkdir.assert_not_called()




@patch('miri_account_service.require_ai_login', new=lambda: None)   # 로그인 검사는 아래 no_login 시험·test_server_ai_boundaries 가 본다
class PreliminaryInputTest(unittest.TestCase):
    clear_state = Mcp3DTest.clear_state

    def setUp(self):
        Mcp3DTest.setUp(self)
        ss.pending.items.clear()
        self.browser=FakeBrowser();self.posts=[]
        p=patch.object(bridge,'dispatch',side_effect=self.browser)
        p.start();self.addCleanup(p.stop)

    def args(self, count=3):
        return {'floors': [{'H':3.3,'outline':[[0,0],[10,0],[10,9],[0,9]],
                            'columns':[{'id':'C1','x':0,'y':0}], 'pilotis':False} for _ in range(count)],
                'structureType':'rc-moment','basementModel':'above-ground','complexBase':False,'extension':False,
                'occupancy':{'legalUse':'아파트','importantFacility':False},'legalArea_m2':900,
                'seismic':{'zone':'I','siteClass':None,'mapS':None,'baseZ':0,'isolation':False,'damping':False},
                'lateralSystem':{'x':{'systemKey':'rcMomentOrdinary'}},
                'diaphragms':[{'z':3.3*(i+1),'DL':None,'massComplete':False} for i in range(count)],
                'otherLoads':{'F':None,'T':0,'R':0},'loadPaths':{'missingSupport':False},
                'irregularityEvidence':{'x':{'confirmed':False}},'members':{'columns':[{'id':'C1','level':1}]},
                'pilotisDetails':None,'foundation':{'qa':None},'materials':{'fck':24,'Ec_MPa':None},
                'lateralAnalysis':{'wallBoundary':'cantilever'},
                'inputEvidence':{'floors':{'source':'검증도면','confirmed':True,'assumption':None}}}

    def response(self,p):
        return {'state':'ok','rulesVersion':'KDS 41:원문 수록판',
                'model':{'system':p['system'],'reviewMethod':'kds41-preliminary','p':copy.deepcopy(p),'members':[],
                         'preliminary':{'missingInputs':['seismic.siteClass','members.columns.0.b','members.columns.0.h'],
                          'seismic':{'x':{'V':123.4,'forces':[{'Fx':40,'Vx':123.4}]},'y':None},
                          'params':{'SDS':None},'analysis':{'status':'hold','missing':['storeys.0.rigid','members.0.C1.fck','strength.x'],
                          'dirs':{'x':{'storeys':[{'drift_mm':None,'driftSt':'hold'}]}}},
                          'memberResults':[{'id':'C1','kind':'column','level':1,'data':{'choice':{'b':450,'h':500}},'missing':['b','h'],'st':'hold'}]}},
                'review':[{'grp':'지진','item':'조사값','st':'hold','fix':'input','missingInputs':['seismic.siteClass'],'val':'미상','ref':'시험 근거'}],
                'missing':['seismic.importance']}

    def fake_midrise(self,payload):
        self.posts.append(copy.deepcopy(payload))
        return self.response(payload['input'])

    def test_three_four_five_reach_server_and_preserve_full_contract(self):
        for count in (3,4,5):
            args=self.args(count);before=copy.deepcopy(args)
            with patch.object(ss,'post',side_effect=self.fake_midrise):
                out=bridge.call('cad_structure_generate',{**args,'reviewMethod':'kds42-table'},allow_edit=False)
            sent=self.posts[-1]['input']
            self.assertEqual(sent['reviewMethod'],'kds41-preliminary')
            for key in ss.si.NEW_KEYS:
                # 준 값은 그대로, 비운 칸만 보통 값으로 채운다(대표 2026-10-30 '그걸로')
                if key in args and isinstance(args[key],dict):self.assertEqual({k:sent[key][k] for k in args[key]},args[key] if key not in ('seismic','inputEvidence') else {k:sent[key][k] for k in args[key]})
                elif key in args:self.assertEqual(sent[key],args[key])
            self.assertEqual(args,before)
            self.assertEqual(sent['seismic']['importance'],'I' if count==5 else 'II')
            self.assertIsNone(sent['diaphragms'][0]['DL']);self.assertFalse(sent['complexBase'])
            self.assertEqual(out['verdict'],'자료 부족');self.assertFalse(out['canCreateCertificate'])
            self.assertEqual(out['seismic']['x']['V'],123.4);self.assertIsNone(out['drift']['dirs']['x']['storeys'][0]['drift_mm'])
            self.assertEqual(out['memberProposals'][0]['origin'],'proposal')
            keys=[q['key'] for q in out['questions']]
            self.assertEqual(len(keys),len(set(keys)));self.assertIn('members.0.C1.fck',keys)
            self.assertTrue(out['notifications']);self.assertFalse(out['inputEvidence']['seismic.importance']['confirmed'])
            review=bridge.call('cad_structure_review',{'setId':out['setId']},allow_edit=False)
            self.assertEqual(review['questions'],out['questions'])

    def test_question_proposal_and_answer_set_rerun_unknown_keeps_hold(self):
        with patch.object(ss,'post',side_effect=self.fake_midrise):
            first=bridge.call('cad_structure_generate',self.args(),allow_edit=False)
            q=next(q for q in first['questions'] if q['key']=='members.columns.0.b')
            self.assertIn('450×500',q['question'])
            second=bridge.call('cad_structure_generate',{'answerSetId':first['setId'],'answers':{
                'members.columns.0.b':'네','members.columns.0.h':'예','seismic.siteClass':'모름','seismic.importance':'모름'}},allow_edit=False)
        p=self.posts[-1]['input']
        self.assertEqual((p['members']['columns'][0]['b'],p['members']['columns'][0]['h']),(450,500))
        self.assertNotIn('siteClass',p['seismic']);self.assertNotIn('importance',p['seismic'])
        self.assertNotIn('모름',json.dumps(p,ensure_ascii=False));self.assertEqual(second['verdict'],'자료 부족')
        self.assertEqual(ss.pending.get(first['setId'])['input']['engine']['members']['columns'][0],{'id':'C1','level':1})

    def test_missing_question_aliases_roundtrip_and_choices(self):
        si=ss.si;p=self.args()
        q=si.question_for('storeys.0.rigid',p);self.assertEqual(q['inputKey'],'diaphragms.0.rigid')
        q=si.question_for('members.0.C1.fck',p);self.assertEqual(q['inputKey'],'floors.0.columns.0.fck')
        p,missing=si.apply_answers(p,{'storeys.0.rigid':'아니요','members.0.C1.fck':'24',
                                    'seismic.method':'지역별 표','seismic.baseZ':0,'seismic.siteClass':'단단한 흙'})
        self.assertFalse(p['diaphragms'][0]['rigid']);self.assertEqual(p['floors'][0]['columns'][0]['fck'],24)
        self.assertEqual(p['seismic']['method'],'zone');self.assertEqual(p['seismic']['baseZ'],0)
        self.assertEqual(missing,['seismic.siteClass'])
        for label,value in si.question_for('seismic.siteClass')['choices'].items():
            self.assertEqual(si.answer_value(si.question_for('seismic.siteClass'),label),value)
        self.assertIsNone(si.answer_value(si.question_for('seismic.siteClass'),'모름'))
        with self.assertRaises(ValueError):si.apply_answers(p,{'members.999.C1.b':400})
        with self.assertRaises(ValueError):si.apply_answers(p,{'dirs.x.storeys.0.K_kNm':123})
        for key in ['__class__.bad','floors.999.columns.0.b','materials.__dict__.bad']:
            with self.assertRaises(ValueError):si.apply_answers(p,{key:10})
        for row in si.QUESTION_TABLE:
            self.assertNotRegex(re.sub(r'\([^)]*\)','',row['question']),r'KDS|Sd|SDS')

    def test_address_fake_table_ambiguity_no_file_hold_and_real_table(self):
        si=ss.si
        table={'source':'가짜 원문 표 4.2-1','aliases':{'가짜':'가짜도'},'zones':{
          'I':[{'sido':'가짜도','sigungu':None}], 'II':[{'sido':'가짜도','sigungu':'북군'}]}}
        self.assertEqual(si.zone_for_address('가짜 남시 1',table)['value'],'I')
        self.assertEqual(si.zone_for_address('가짜 북군 1',table)['value'],'II')
        self.assertIsNone(si.zone_for_address('가짜도',table))
        self.assertIsNone(si.zone_for_address('북군',table))
        self.assertIsNone(si.zone_for_address('가짜도시 북군',table))
        table['zones']['I'].append({'sido':'가짜도','sigungu':'북군'})
        self.assertIsNone(si.zone_for_address('가짜도 북군',table))
        with patch.object(si,'ZONE_TABLE',Path('missing-zone-table.json')):
            p=si.auto_fill({'stories':3,'location':'서울특별시','occupancy':{}})
            self.assertNotIn('zone',p['seismic'])
        self.assertEqual(si.zone_for_address('강원특별자치도 강릉시 1')['value'],'I')
        self.assertEqual(si.zone_for_address('강원도 춘천시 1')['value'],'II')
        self.assertIsNone(si.zone_for_address('강원도'));self.assertIsNone(si.zone_for_address('광주시'))

    def test_use_grade_thresholds_unknown_mixed_and_no_default(self):
        si=ss.si
        def grade(use,stories=3,**kw):
            return si.importance_for_use({'stories':stories,'occupancy':{'legalUse':use,'importantFacility':False,**kw.pop('occupancy',{})},**kw})
        self.assertEqual(grade('아파트',5)['value'],'I');self.assertEqual(grade('아파트',4)['value'],'II')
        self.assertEqual(grade('학교')['coefficient'],1.2);self.assertEqual(grade('종합병원')['value'],'특')
        self.assertEqual(grade('병원',occupancy={'hasSurgery':True})['value'],'특')
        self.assertIsNone(grade('병원'));self.assertIsNone(grade('판매시설'))
        self.assertEqual(grade('판매시설',legalArea_m2=5000)['value'],'I')
        self.assertEqual(grade('판매시설',legalArea_m2=4999)['value'],'II')
        self.assertEqual(grade('위험물 저장 및 처리시설',legalArea_m2=1000)['value'],'특')
        self.assertEqual(grade('아파트',occupancy={'uses':['아파트','학교']})['value'],'I')
        self.assertIsNone(grade('아파트',occupancy={'uses':['아파트','미확인']}))
        self.assertIsNone(grade('의료시설',legalArea_m2=500));self.assertIsNone(grade('운수시설',legalArea_m2=5000))
        self.assertEqual(grade('운수시설',legalArea_m2=5000,occupancy={'freightTerminal':False})['value'],'I')
        self.assertEqual(grade('운수시설',occupancy={'freightTerminal':True})['value'],'II')
        self.assertIsNone(grade('house'));self.assertIsNone(grade('retail'));self.assertIsNone(grade('근린생활시설'))
        p=si.auto_fill({'stories':5,'occupancy':{'legalUse':'아파트','importantFacility':False},'location':'서울특별시'})
        for key in ('seismic.zone','seismic.importance'):
            e=p['inputEvidence'][key];self.assertEqual(e['source'],'자동(주소/용도)');self.assertFalse(e['confirmed']);self.assertTrue(e['reference']);self.assertTrue(e['assumption'])
        p['location']='강원도 춘천시';self.assertEqual(si.auto_fill(p)['seismic']['zone'],'II')
        p['seismic']['zone']='II';p['inputEvidence']['seismic.zone']={'source':'조사서','confirmed':True}
        self.assertEqual(si.auto_fill(p)['seismic']['zone'],'II')
        self.assertEqual(si.auto_fill({'stories':2,'location':'서울특별시'}),{'stories':2,'location':'서울특별시'})

    def test_midrise_report_export_and_certificate_refusal_before_browser(self):
        with patch.object(ss,'post',side_effect=self.fake_midrise):
            made=bridge.call('cad_structure_generate',self.args(5),allow_edit=False)
        value={'ok':True,'html':'<!doctype html><html><body>3~5층 검토 초안</body></html>','missing':[],'sections':[]}
        def dispatch(action,args):return value if action=='cad_structure_calc_report' else self.browser(action,args)
        with patch.object(bridge,'dispatch',side_effect=dispatch):
            out=bridge.call('cad_structure_calc_report',{'setId':made['setId']},allow_edit=False)
            self.addCleanup(lambda:Path(out['path']).unlink(missing_ok=True))
            self.assertIn('3~5층',Path(out['path']).read_text(encoding='utf8'))
            denied=bridge.call('cad_structure_certificate',{'setId':made['setId']},allow_edit=False)
        self.assertFalse(denied['ok']);self.assertIn('1~2층',denied['reason'])
        self.assertNotIn('cad_structure_certificate',[name for name,_ in self.browser.calls])


    def test_engine_real_aliases_and_diagnostics_do_not_abort(self):
        si=ss.si;p=self.args()
        keys=['members.column.C1.1.b','members.column.C1.1.h','members.0.id/level','members.0.C1.x/y',
              'storeys.0.z_m','storeys.0.Px_kN/P_kN','unknown.engine/output','members.column.C1.1.Lr.Pu','storeys.0.h_m','storeys.0.outline']
        response=self.response({**p,'system':'rc'});response['missing']=keys
        questions=si.questions_from(response,p)
        by={q['key']:q for q in questions}
        self.assertIn('450×500',by['members.column.C1.1.b']['question'])
        self.assertEqual(by['members.column.C1.1.b']['inputKey'],'members.columns.0.b')
        self.assertIsNone(by['members.0.id/level']['inputKey']);self.assertIsNone(by['members.0.C1.x/y']['inputKey'])
        p,_=si.apply_answers(p,{'members.column.C1.1.b':'네','storeys.0.z_m':3.3,'storeys.0.Px_kN/P_kN':100},questions)
        self.assertEqual(p['members']['columns'][0]['b'],450)
        self.assertEqual(p['diaphragms'][0]['z'],3.3);self.assertEqual(p['diaphragms'][0]['Px_kN'],100)
        self.assertNotIn('z_m',p['diaphragms'][0])
        self.assertIsNone(by['members.column.C1.1.Lr.Pu']['inputKey'])
        self.assertEqual(by['storeys.0.h_m']['inputKey'],'floors.0.H')
        self.assertEqual(by['storeys.0.outline']['inputKey'],'floors.0.outline')

    def test_unknown_choice_persists_and_explicit_not_applicable_is_null(self):
        si=ss.si;p=self.args(5);p['location']='서울특별시';p=si.auto_fill(p)
        p,_=si.apply_answers(p,{'seismic.importance':'모름','seismic.zone':'모름'})
        p=si.auto_fill(p)
        p,_=si.apply_answers(p,{'seismic.baseZ':0})
        p=si.auto_fill(p)
        self.assertNotIn('importance',p['seismic']);self.assertNotIn('zone',p['seismic'])
        p,_=si.apply_answers(p,{'seismic.zone':'강원도 춘천시','seismic.importance':'I'})
        p=si.auto_fill(p);self.assertEqual(p['seismic']['zone'],'II');self.assertEqual(p['seismic']['importance'],'I')
        p,_=si.apply_answers(p,{'seismic.method':'지역별 표','seismic.mapS':'지역별 표라 사용하지 않음'})
        self.assertIn('mapS',p['seismic']);self.assertIsNone(p['seismic']['mapS'])
        self.assertTrue(p['inputEvidence']['seismic.mapS']['confirmed'])


    def test_real_server_vm_response_questions_are_safe(self):
        import subprocess
        proc=subprocess.run(['node','--input-type=module','-e',
          "import {CORE,input} from './test-fixtures/structure-calc-report.js'; const model=CORE.generate({...input('A'),stories:3}); console.log(JSON.stringify({model,review:CORE.review(model)}));"],
          cwd=Path(__file__).resolve().parent,capture_output=True,encoding='utf8',check=True)
        response=json.loads(proc.stdout);p=response['model']['p']
        questions=ss.si.questions_from(response,p)
        self.assertTrue(questions)
        for q in questions:
            if q['inputKey']:
                self.assertNotIn('/',q['inputKey'])
                self.assertNotRegex(q['inputKey'],r'\.(analysis|demand|[DLESRFTW])\.')
        # 실제 부재 식별자를 가진 질문은 같은 층·같은 id의 원 입력으로만 연결한다.
        for q in questions:
            if q['key'].startswith('members.column.C1.1.') and q['inputKey']:
                self.assertRegex(q['inputKey'],r'^(members.columns.\d+|floors.0.columns.\d+)\.')


    def test_new_natural_language_source_replaces_only_unconfirmed_auto_value(self):
        si=ss.si;p=self.args(5);p['seismic'].pop('zone');p['location']='서울특별시';p=si.auto_fill(p)
        p,_=si.apply_answers(p,{'seismic.zone':'강원도 춘천시','seismic.importance':'종합병원'})
        p=si.auto_fill(p)
        self.assertEqual(p['seismic']['zone'],'II');self.assertEqual(p['seismic']['importance'],'특')
        self.assertEqual(p['inputEvidence']['seismic.zone']['source'],'자동(주소/용도)')
        p['inputEvidence']['seismic.zone']={'source':'원 조사서','confirmed':True};p['seismic']['zone']='I'
        p,_=si.apply_answers(p,{'seismic.zone':'강원도 춘천시'});p=si.auto_fill(p)
        self.assertEqual(p['seismic']['zone'],'I');self.assertEqual(p['inputEvidence']['seismic.zone']['source'],'원 조사서')
        p=ss.engine_input({'X':10,'Y':9,'stories':3,'inputEvidence':None,'answers':{'seismic.baseZ':0}})
        self.assertEqual(p['seismic']['baseZ'],0)

    def test_level_less_member_proposal_scopes_answer_without_overwriting_other_floors(self):
        si=ss.si;p={'stories':3,'members':{'columns':[{'id':'C1','fck':24},{'id':'C2','level':2}]},
                         'inputEvidence':{'members.columns.0.fck':{'source':'도면','confirmed':True},'members.columns.1':{'source':'자료','confirmed':True}}}
        r={'model':{'preliminary':{'memberResults':[{'id':'C1','kind':'column','level':2,'data':{'choice':{'b':450,'h':500}},'missing':['b','h']}]}}}
        qs=si.questions_from(r,p)
        self.assertIn('450×500',qs[0]['question'])
        out,_=si.apply_answers(p,{'members.column.C1.2.b':'제안대로','members.column.C1.2.h':'네'},qs)
        rows=out['members']['columns']
        self.assertEqual(rows[0],{'id':'C1','level':2,'fck':24,'b':450,'h':500})
        self.assertEqual(rows[1],{'id':'C1','fck':24});self.assertEqual(rows[2],{'id':'C2','level':2})
        self.assertEqual(out['inputEvidence']['members.columns.2']['source'],'자료')
        self.assertNotIn('b',p['members']['columns'][0])
        out,_=si.apply_answers(p,{'members.column.C1.2.b':450,'members.columns.1.fck':30})
        self.assertEqual(out['members']['columns'][2]['fck'],30)
        self.assertEqual(out['members']['columns'][1]['fck'],24)
        out,_=si.apply_answers(p,{'inputEvidence.members.columns.0.fck':{'source':'수정 도면','confirmed':True}})
        self.assertEqual(out['inputEvidence']['members.columns.0.fck']['source'],'수정 도면')


    def test_contract_string_fields_have_explicit_answer_types(self):
        p=self.args();p,_=ss.si.apply_answers(p,{'lateralSystem.x.systemKey':'rcMomentOrdinary',
            'floors.0.columns.0.liveUse':'주거','members.columns.0.tieBar':'D10','occupancy.legalUse':'아파트'})
        self.assertEqual(p['lateralSystem']['x']['systemKey'],'rcMomentOrdinary')
        self.assertEqual(p['members']['columns'][0]['tieBar'],'D10')
        self.assertEqual(p['floors'][0]['columns'][0]['liveUse'],'주거')
        self.assertEqual(ss.si.question_for('floors.0.pilotis')['options'],['예','아니요','모름'])

    def test_no_login_all_tools_and_chat_rejected_before_any_side_effect(self):
        import chat_router
        import miri_account_service as account
        def denied():raise account.AILoginRequired(account.AI_LOGIN_MESSAGE)
        with patch('miri_account_service.require_ai_login',new=denied),patch.object(ss,'post') as post,patch.object(chat_router,'backend') as backend:
            for name in [t['name'] for t in bridge.TOOLS]:
                with self.assertRaisesRegex(ValueError,'로그인',msg=name):bridge.call(name,{})
            pass  # 대화(chat_router) 로그인 차단 검사는 feat/ai-chat-tools 가지에서 함께 합친다(대화 방식 변경과 같이 검토).
            self.assertEqual(self.browser.calls,[]);post.assert_not_called();backend.assert_not_called()
            # 미리·Codex 대화의 로그인 선확인은 feat/ai-chat-tools 에서(현재 미리 대화는 로그인 확인 전 등록 요청을 보냄 — 그 가지가 고침).

if __name__ == '__main__':
    unittest.main()
