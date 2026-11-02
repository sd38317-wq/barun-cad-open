"""ACAD200 영역 6: 블록·속성·그룹 DXF 쓰기/읽기 (605·807·611·621·624)."""
import tempfile
import unittest
from pathlib import Path

import ezdxf

import exchange


def layer():
    return [{'id': 'L0', 'name': '0', 'color': '#ffffff', 'visible': True, 'locked': False}]


def model(entities, shared=None):
    doc = {'version': 3 if shared else 2, 'units': 'mm', 'layers': layer(), 'blocks': [], 'entities': entities}
    if shared:
        doc['sharedBlocks'] = shared
    return doc


def read(raw):
    # 파일로 읽는다(인코딩·바이너리 처리를 ezdxf 가 정한다).
    with tempfile.TemporaryDirectory() as folder:
        path = Path(folder) / 'a.dxf'
        path.write_bytes(raw)
        return ezdxf.readfile(path)


def chair(i, x, y):
    return {'id': f'b{i}', 'type': 'block', 'name': '의자', 'layer': 'L0', 'entities': [
        {'type': 'line', 'layer': 'L0', 'points': [{'x': x, 'y': y}, {'x': x + 400, 'y': y}]},
        {'type': 'circle', 'layer': 'L0', 'center': {'x': x + 200, 'y': y + 200}, 'radius': 150}]}


class BlockExchangeTest(unittest.TestCase):
    def test_identical_plain_blocks_share_one_definition(self):
        # 605·807: 삽입본마다 정의를 만들던 것 → 같은 모양은 정의 하나. 300개 → 정의 1개, INSERT 300개.
        raw, _ = exchange.export_dxf(model([chair(i, i * 1000.0, (i % 7) * 900.0) for i in range(300)]))
        doc = read(raw)
        user = [b for b in doc.blocks if not b.name.startswith(('*', '_'))]
        self.assertEqual(len(user), 1)
        inserts = list(doc.modelspace().query('INSERT'))
        self.assertEqual(len(inserts), 300)
        # 위치가 그대로인지: 다시 읽은 원 중심 = 원래 중심.
        centers = sorted((round(v.dxf.center.x, 6), round(v.dxf.center.y, 6)) for ins in inserts for v in ins.virtual_entities() if v.dxftype() == 'CIRCLE')
        self.assertEqual(centers, sorted((i * 1000.0 + 200, (i % 7) * 900.0 + 200) for i in range(300)))

    def test_different_shapes_keep_separate_definitions(self):
        a, b = chair(1, 0, 0), chair(2, 5000, 0)
        b['entities'][1]['radius'] = 99
        doc = read(exchange.export_dxf(model([a, b]))[0])
        self.assertEqual(len([x for x in doc.blocks if not x.name.startswith(('*', '_'))]), 2)

    def test_attdef_and_attribute_values_round_trip_through_dxf(self):
        # 611: 정의의 속성 정의(attdef 표시 문자) → ATTDEF, 참조 값 → 그 자리의 ATTRIB.
        shared = {'방번호': {'name': '방번호', 'origin': {'x': 0, 'y': 0}, 'entities': [
            {'type': 'circle', 'layer': 'L0', 'center': {'x': 0, 'y': 0}, 'radius': 300},
            {'type': 'text', 'layer': 'L0', 'position': {'x': -100, 'y': -50}, 'height': 100, 'text': 'NO', 'attdef': {'tag': 'NO', 'prompt': '방 번호', 'default': '101'}}]}}
        ref = {'id': 'r1', 'type': 'block', 'name': '방번호', 'sharedBlock': '방번호', 'layer': 'L0', 'position': {'x': 5000, 'y': 1000}, 'scale': 1, 'rotation': 0, 'entities': [], 'attributes': {'NO': '203'}}
        doc = read(exchange.export_dxf(model([ref], shared))[0])
        block = [b for b in doc.blocks if not b.name.startswith(('*', '_'))][0]
        attdefs = list(block.attdefs())
        self.assertEqual([(a.dxf.tag, a.dxf.text, a.dxf.prompt) for a in attdefs], [('NO', '101', '방 번호')])
        insert = doc.modelspace().query('INSERT')[0]
        attrib = insert.get_attrib('NO')
        self.assertEqual(attrib.dxf.text, '203')
        self.assertFalse(attrib.is_invisible)
        self.assertAlmostEqual(attrib.dxf.insert.x, 4900, places=6)

    def test_groups_round_trip_as_dxf_groups(self):
        # 621: 객체의 group 이름 → ACAD_GROUP → 다시 열면 group 이름.
        entities = [{'id': f'l{i}', 'type': 'line', 'layer': 'L0', 'group': '창틀' if i < 2 else None, 'points': [{'x': i, 'y': 0}, {'x': i, 'y': 100}]} for i in range(3)]
        for e in entities:
            if e['group'] is None:
                del e['group']
        raw, _ = exchange.export_dxf(model(entities))
        doc = read(raw)
        self.assertIn('창틀', doc.groups)
        self.assertEqual(len(list(doc.groups.get('창틀'))), 2)
        back = exchange.import_file(raw, '.dxf')['document']['entities']
        self.assertEqual(sorted(e.get('group', '') for e in back), ['', '창틀', '창틀'])

    def test_byblock_lineweight_round_trip(self):
        # 624: 선가중치 BYBLOCK(-2) 을 잃지 않는다.
        line = {'id': 'a', 'type': 'line', 'layer': 'L0', 'lineweightMode': 'byblock', 'points': [{'x': 0, 'y': 0}, {'x': 1, 'y': 0}]}
        raw, _ = exchange.export_dxf(model([line]))
        self.assertEqual(read(raw).modelspace().query('LINE')[0].dxf.lineweight, -2)
        back = exchange.import_file(raw, '.dxf')['document']['entities'][0]
        self.assertEqual(back.get('lineweightMode'), 'byblock')

    def test_nonuniform_shared_reference_writes_both_scales(self):
        shared = {'U': {'name': 'U', 'origin': {'x': 0, 'y': 0}, 'entities': [{'type': 'line', 'layer': 'L0', 'points': [{'x': 0, 'y': 0}, {'x': 10, 'y': 10}]}]}}
        ref = {'id': 'r', 'type': 'block', 'name': 'U', 'sharedBlock': 'U', 'layer': 'L0', 'position': {'x': 0, 'y': 0}, 'scale': 2, 'scaleX': 2, 'scaleY': 3, 'rotation': 0, 'entities': []}
        insert = read(exchange.export_dxf(model([ref], shared))[0]).modelspace().query('INSERT')[0]
        self.assertEqual((insert.dxf.xscale, insert.dxf.yscale), (2, 3))


if __name__ == '__main__':
    unittest.main()
