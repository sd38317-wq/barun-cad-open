"""AI 가 쓰는 3D·검토 도구(재료·일조·내부 투시도·납품 점검·PDF) — 도구 목록·검사·PDF 저장 경로."""
import unittest
from pathlib import Path
from unittest.mock import patch
import bridge
from test_mcp_3d import Mcp3DTest

NEW_TOOLS = ('cad_get_materials', 'cad_set_materials', 'cad_sun_study', 'cad_view_interior', 'cad_delivery_check', 'cad_delivery_fix', 'cad_plot_pdf', 'cad_wind_check')


@patch('miri_account_service.require_ai_login', new=lambda: None)
class AiReviewToolTest(Mcp3DTest):
    def test_tools_listed_bound_and_flat(self):
        tools = {t['name']: t for t in bridge.TOOLS}
        for name in NEW_TOOLS:
            schema = tools[name]['inputSchema']
            self.assertEqual(schema['type'], 'object')
            for forbidden in ('oneOf', 'anyOf', 'allOf'):
                self.assertNotIn(forbidden, schema)
            self.assertIn('target', schema['properties'], name)
            self.assertEqual('target' in schema['required'], name in bridge.MUTATING_TOOLS, name)
        for name in ('cad_set_materials', 'cad_delivery_fix'):
            self.assertIn(name, bridge.MUTATING_TOOLS)
            self.assertIn('expectedRevision', tools[name]['inputSchema']['required'])
        self.assertIn('적벽돌', tools['cad_get_materials']['description'])

    def test_mutating_tools_need_matching_revision(self):
        for name, args in [('cad_set_materials', {'materials': {'wall': 'brick-red'}}), ('cad_delivery_fix', {'keys': ['overkill']})]:
            with patch.object(bridge, 'dispatch') as dispatch, self.assertRaises(ValueError):
                bridge.call(name, {**args, 'target': self.target, 'expectedRevision': 5})
            dispatch.assert_not_called()
            with patch.object(bridge, 'dispatch', return_value={'applied': True}) as dispatch:
                self.assertTrue(bridge.call(name, {**args, 'target': self.target, 'expectedRevision': 0})['applied'])

    def job(self):
        ents = [{'type': 'line', 'points': [{'x': 0, 'y': 0}, {'x': 80000, 'y': 50000}], 'color': '#000000', 'lineweight': .25}]
        return {'action': 'plot', 'size': [841, 594], 'margin': 10, 'denominator': 100, 'bounds': {'minX': 0, 'minY': 0, 'maxX': 80000, 'maxY': 50000}, 'entities': ents}

    def test_plot_pdf_saved_by_server_never_overwrites(self):
        folder = Path(self.folder.name)
        with patch.object(bridge, 'dispatch', return_value={'job': self.job(), 'target': self.target, 'applied': False}):
            out = bridge.call('cad_plot_pdf', {'paper': 'A1'}, allow_edit=False)
        path = Path(out['path'])
        self.assertEqual(path.parent, folder)
        self.assertTrue(path.read_bytes().startswith(b'%PDF'))
        self.assertEqual(out['pages'], 1)
        self.assertNotIn('job', out)
        tiled = {**self.job(), 'tile': {'paper': 'A4', 'overlap': 10}}
        with patch.object(bridge, 'dispatch', return_value={'job': tiled, 'target': self.target}):
            out2 = bridge.call('cad_plot_pdf', {'paper': 'A1', 'tile': {'paper': 'A4'}}, allow_edit=False)
        self.assertIn('A4나눠찍기', Path(out2['path']).name)
        self.assertGreater(out2['pages'], 2)
        with patch.object(bridge, 'dispatch') as dispatch, self.assertRaisesRegex(ValueError, '이미 있습니다'):
            bridge.call('cad_plot_pdf', {'path': str(path)}, allow_edit=False)
        dispatch.assert_not_called()
        with self.assertRaisesRegex(ValueError, 'absolute .pdf'):
            bridge.call('cad_plot_pdf', {'path': 'relative.pdf'}, allow_edit=False)


    def test_inputs_checked_before_dispatch(self):
        for name, args in [('cad_sun_study', {'size': 0}), ('cad_sun_study', {'time': '99:99'}), ('cad_view_interior', {'x': 0, 'y': 0, 'fov': 5}),
                           ('cad_delivery_fix', {'keys': 'overkill', 'expectedRevision': 0}), ('cad_set_materials', {'expectedRevision': 0})]:
            with patch.object(bridge, 'dispatch') as dispatch, self.assertRaises(ValueError, msg=name):
                bridge.call(name, {**args, 'target': self.target}, allow_edit=True)
            dispatch.assert_not_called()

    def test_short_requests_ask_instead_of_failing(self):
        # "안에서 보여줘"·"풍동검토 해줘": 자리·지역을 몰라도 도구는 부를 수 있고(앱이 needs 로 되묻는다), AI 에게 묻는 법을 알린다
        tools = {t['name']: t for t in bridge.TOOLS}
        self.assertNotIn('x', tools['cad_view_interior']['inputSchema'].get('required', []))
        self.assertIn('needs', tools['cad_wind_check']['description'])
        with patch.object(bridge, 'dispatch', return_value={'needs': [{'key': 'spot'}]}) as dispatch:
            self.assertEqual(bridge.call('cad_view_interior', {'target': self.target}, allow_edit=False)['needs'][0]['key'], 'spot')
        dispatch.assert_called_once()
        self.assertIn('needs[0]', bridge.ASK_INSTRUCTIONS)
        import codex_chat
        self.assertIn('numbered choices', codex_chat.ACTION_INSTRUCTIONS)

    def test_pdf_name_collision_keeps_drawing_name(self):
        folder = Path(self.folder.name)
        with bridge.lock:
            bridge.clients[self.session]['drawingPath'] = str(folder / 'A-101.dxf')
        (folder / 'A-101_plot.pdf').write_bytes(b'old')
        with patch.object(bridge, 'dispatch', return_value={'job': self.job(), 'target': self.target}):
            out = bridge.call('cad_plot_pdf', {'paper': 'A1'}, allow_edit=False)
        self.assertEqual(Path(out['path']).name, 'A-101_plot-1.pdf')


if __name__ == '__main__':
    unittest.main()
