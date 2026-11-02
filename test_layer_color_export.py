"""레이어 색이 DXF 저장에서 살아남는지(2026-10-27 설명서 시험에서 찾음).

R2000 처럼 옛 형식으로 저장하면 레이어의 트루컬러는 지워진다. 그때 남는 색 번호가
기본값 7(흰색)이면 모든 레이어가 흰색이 된다. 옛 DXF(R12)를 열어 저장하면 R2000 으로
올려 저장되므로 실제로 이렇게 됐다.
"""
import io
import json
import unittest

import ezdxf
import exchange


def model():
    return {'units': 'mm', 'layers': [
        {'id': 'L0', 'name': '0', 'color': '#ffffff', 'visible': True, 'locked': False},
        {'id': 'L1', 'name': 'A-WALL', 'color': '#ffff00', 'visible': True, 'locked': False},
        {'id': 'L2', 'name': 'A-DOOR', 'color': '#00ff00', 'visible': True, 'locked': False},
        {'id': 'L3', 'name': 'A-FURN', 'color': '#ff00ff', 'visible': True, 'locked': False},
    ], 'entities': [{'id': 'e', 'type': 'line', 'layer': 'L1', 'points': [{'x': 0, 'y': 0}, {'x': 100, 'y': 0}]}]}


def layer_colors(version):
    content, _ = exchange.export_dxf(json.loads(json.dumps(model())), version)
    text = content.decode('cp949', 'ignore') if isinstance(content, bytes) else content
    # 윈도우는 DXF 를 CRLF 로 쓴다. StringIO 는 줄 끝을 바꾸지 않아 ezdxf 가 레이어를 못 읽는다.
    doc = ezdxf.read(io.StringIO(text.replace('\r\n', '\n')))
    return {l.dxf.name: (l.dxf.color, l.dxf.get('true_color')) for l in doc.layers}


class LayerColorExportTest(unittest.TestCase):
    def test_r2000_keeps_nearest_color_numbers(self):
        colors = layer_colors('R2000')
        self.assertEqual(colors['A-WALL'][0], 2)   # 노랑
        self.assertEqual(colors['A-DOOR'][0], 3)   # 초록
        self.assertEqual(colors['A-FURN'][0], 6)   # 자홍

    def test_r2018_keeps_true_color_and_a_matching_color_number(self):
        colors = layer_colors('R2018')
        self.assertEqual(colors['A-WALL'], (2, 0xffff00))
        self.assertEqual(colors['A-FURN'], (6, 0xff00ff))


if __name__ == '__main__':
    unittest.main()
