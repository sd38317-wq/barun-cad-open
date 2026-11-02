"""Split-entity import (converter/LineSplit.cs + exchange.read_split_lines) gives the same document as the DXF route."""
import struct
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import ezdxf
import exchange

KINDS = {'LINE': 1, 'CIRCLE': 2, 'ARC': 3, 'LWPOLYLINE': 4, 'SPLINE': 5}


def split_file(entries):
    """The LineSplit.cs (BLN3) layout for model-space entries [(handle, kind or None, fields)]."""
    strings, table = {}, []
    def sid(value):
        if value not in strings: strings[value] = len(table); table.append(value)
        return strings[value]
    sections = {kind: [] for kind in KINDS}; pool = []; spline_values = []
    for handle, kind, e in entries:
        if kind is None: continue
        head = struct.pack('<iiihhd', sid(e['layer']), sid(e['linetype']), e['colour'], e['lineweight'], e.get('flags', 0), e['ltscale'])
        if kind == 'LINE': sections[kind].append(head + struct.pack('<6d', *e['start'], *e['end']))
        elif kind == 'CIRCLE': sections[kind].append(head + struct.pack('<4d', *e['center'], e['radius']))
        elif kind == 'ARC': sections[kind].append(head + struct.pack('<6d', *e['center'], e['radius'], e['start_angle'], e['end_angle']))
        elif kind == 'SPLINE':
            sections[kind].append(head + struct.pack('<iiiiddd', e['degree'], e['spline_flags'], len(e['control']), len(e['knots']), *e['tolerances']))
            spline_values += [v for p in e['control'] for v in p] + list(e['knots'])
        else:
            sections[kind].append(head + struct.pack('<iidd', len(e['points']), 1 if e['closed'] else 0, e['width'], e['elevation']))
            pool += [struct.pack('<2d', *p) for p in e['points']]
    counts = [len(sections[k]) for k in ('LINE', 'CIRCLE', 'ARC', 'LWPOLYLINE')]
    out = b'BLN3' + struct.pack('<9i', len(entries), len(table), *counts, len(pool), len(sections['SPLINE']), len(spline_values))
    for value in table:
        raw = value.encode('utf-8'); out += struct.pack('<i', len(raw)) + raw
    out += b''.join(struct.pack('<Q', int(h, 16)) for h, _, _ in entries)
    out += bytes(KINDS.get(kind, 0) for _, kind, _ in entries)
    for kind in ('LINE', 'CIRCLE', 'ARC', 'LWPOLYLINE'): out += b''.join(sections[kind])
    out += b''.join(pool) + b''.join(sections['SPLINE'])   # LineSplit.cs order: vertices before spline records
    return out + struct.pack(f'<{len(spline_values)}d', *spline_values)


class SplitLinesTest(unittest.TestCase):
    def drawing(self, folder):
        doc = ezdxf.new('R2018'); doc.units = 4
        doc.layers.add('벽체', color=3); doc.layers.add('A-WALL', color=5)
        doc.linetypes.add('점선', pattern=[10, 5, -5])
        msp = doc.modelspace(); entries = []
        def common(layer, colour, linetype, lineweight, ltscale):
            attrs = {'layer': layer, 'lineweight': lineweight, 'ltscale': ltscale, 'linetype': linetype}
            if colour == 0: attrs['color'] = 0
            elif 1 <= colour <= 255: attrs['color'] = colour
            return attrs, {'layer': layer, 'linetype': linetype, 'colour': colour, 'lineweight': lineweight, 'ltscale': ltscale}
        def finish(e, colour, kind, fields):
            if colour >= 0x1000000: e.dxf.true_color = colour & 0xffffff
            entries.append((e.dxf.handle, kind, fields))
        def line(start, end, layer='0', colour=256, linetype='ByLayer', lineweight=-1, ltscale=1.0, extrusion=None):
            attrs, fields = common(layer, colour, linetype, lineweight, ltscale)
            if extrusion: attrs['extrusion'] = extrusion; fields['flags'] = 2
            fields.update(start=tuple(float(v) for v in (*start, 0)[:3]), end=tuple(float(v) for v in (*end, 0)[:3]))
            finish(msp.add_line(start, end, dxfattribs=attrs), colour, 'LINE', fields)
        def circle(center, radius, layer='0', colour=256, arc=None, flipped=False):
            attrs, fields = common(layer, colour, 'ByLayer', -1, 1.0)
            if flipped: attrs['extrusion'] = (0, 0, -1); fields['flags'] = 1
            fields.update(center=tuple(float(v) for v in (*center, 0)[:3]), radius=float(radius))
            if arc:
                fields.update(start_angle=arc[0], end_angle=arc[1])
                finish(msp.add_arc(center, radius, arc[0], arc[1], dxfattribs=attrs), colour, 'ARC', fields)
            else: finish(msp.add_circle(center, radius, dxfattribs=attrs), colour, 'CIRCLE', fields)
        def polyline(points, closed=False, width=0.0, elevation=0.0, layer='0', colour=256, flipped=False):
            attrs, fields = common(layer, colour, 'ByLayer', -1, 1.0)
            if flipped: attrs['extrusion'] = (0, 0, -1); fields['flags'] = 1
            attrs.update(const_width=width, elevation=elevation)
            fields.update(points=[tuple(map(float, p)) for p in points], closed=closed, width=float(width), elevation=float(elevation))
            finish(msp.add_lwpolyline(points, close=closed, dxfattribs=attrs), colour, 'LWPOLYLINE', fields)
        line((0, 0), (100, 0), '벽체')
        circle((50, 50), 20, 'A-WALL')
        line((0, 0, 5), (0, 100, 5), 'A-WALL', colour=1, lineweight=35)
        line((1, 1), (1, 1), '벽체')                       # zero length: preserved like the DXF route
        circle((3, 4, 2), 7.25, colour=0x1000000 | 0xabcdef, arc=(30.5, 359.123456789))
        line((10, 10), (20, 30), '0', colour=0, linetype='점선', ltscale=2.5)
        entries.append((msp.add_text('문자', dxfattribs={'height': 5}).dxf.handle, None, None))
        polyline([(0, 0), (10, 0), (10, 10)], closed=True, width=0.5, elevation=3, layer='벽체', colour=4)
        entries.append((msp.add_lwpolyline([(0, 0, 0, 0, 0.5), (5, 5, 0, 0, 0)], format='xyseb').dxf.handle, None, None))   # bulge: DXF route
        line((5, 5), (6, 7), '없는레이어', colour=0x1000000 | 0x12ab34, linetype='BYLAYER')
        polyline([(1.5, 2.5), (-3.25, 1e-5)])
        # Extrusion (0,0,-1): split with flags, flipped by the importer exactly as ezdxf.upright does.
        circle((5, 6, 0.5), 3, flipped=True)
        circle((7, -8, 0), 2.5, arc=(20.25, -45.5), flipped=True)
        circle((1, 1, 0), 4, arc=(0.0, 180.0), flipped=True)
        polyline([(1, 2), (3, 4), (5, -6)], elevation=2.5, flipped=True)
        line((11, 12, 0), (13, 14, 3), 'A-WALL', extrusion=(0, 0, -1))
        line((-3.25, 1e-5), (123456.78901234567, 0.30000000000000004), 'A-WALL')
        def spline(points, closed=False, layer='0', colour=256):
            attrs, fields = common(layer, colour, 'ByLayer', -1, 1.0)
            e = msp.add_open_spline(points, degree=3, dxfattribs=attrs)
            if closed: e.closed = True
            e.dxf.knot_tolerance = 1e-9   # a non-default tolerance changes ezdxf's decomposition
            fields.update(degree=e.dxf.degree, spline_flags=e.dxf.flags, control=[tuple(p) for p in e.control_points], knots=list(e.knots),
                          tolerances=(e.dxf.knot_tolerance, e.dxf.control_point_tolerance, e.dxf.fit_tolerance))
            finish(e, colour, 'SPLINE', fields)
        spline([(0, 0, 0), (10, 5, 0), (20, -3, 0), (35, 8, 0), (40, 0, 0)], layer='벽체')
        spline([(0, 0, 0), (10, 10, 0), (20, 0, 0), (10, -10, 0)], closed=True, colour=3)
        full = Path(folder) / 'full.dxf'; doc.saveas(full)
        split = {h for h, kind, _ in entries if kind}
        for e in list(msp):
            if e.dxf.handle in split: msp.delete_entity(e)
        residual = Path(folder) / 'residual.dxf'; doc.saveas(residual)
        return full, residual, split_file(entries)

    def imported(self, folder, residual, split, calls=None):
        source = Path(folder) / 'drawing.dwg'; source.write_bytes(b'AC1032')
        def convert(path, work, split_lines=True):
            if calls is not None: calls.append(split_lines)
            details = {'timings_ms': {}, 'route': 'test'}
            if split_lines: details['_split_lines'] = split
            return (residual if split_lines else Path(folder) / 'full.dxf'), 'test', [], details
        with patch('exchange.dwg_to_dxf', side_effect=convert):
            return exchange.import_file_path(source, '.dwg')

    def comparable(self, document):
        layers = {l['id']: l['name'] for l in document['layers']}
        def strip(v, top=True):
            if isinstance(v, dict): return {k: (x[12:] if top else None) if k == 'id' else layers.get(x) if k == 'layer' else strip(x, False) for k, x in v.items() if k != 'sourceFingerprint'}
            if isinstance(v, list): return [strip(x, top) for x in v]
            return v
        return [strip(e) for e in document['entities']]

    def test_split_import_equals_the_dxf_route(self):
        with tempfile.TemporaryDirectory() as folder:
            full, residual, split = self.drawing(folder)
            with patch('exchange.dwg_to_dxf', side_effect=lambda path, work, split_lines=True: (full, 'test', [], {'timings_ms': {}})):
                source = Path(folder) / 'drawing.dwg'; source.write_bytes(b'AC1032')
                reference = exchange.import_file_path(source, '.dwg')
            result = self.imported(folder, residual, split)
            self.assertEqual(self.comparable(result['document']), self.comparable(reference['document']))
            self.assertEqual(result['report']['converted'], reference['report']['converted'])
            self.assertEqual(result['report']['skipped'], {})
            self.assertEqual(result['report']['converterDetails']['splitLines'], 17)
            self.assertEqual(result['report']['converted']['SPLINE → 곡선 근사 폴리선 (분할 기준 0.1 mm)'], 2)
            for key in ('CIRCLE 반전 OCS → WCS', 'ARC 반전 OCS → WCS', 'LWPOLYLINE 반전 OCS → WCS', 'LINE 법선 무관 WCS 좌표 → XY 평면'):
                self.assertIn(key, result['report']['converted'])
            # Entities read from the DXF keep their fingerprint; split ones are not in the
            # preserved DXF, so export never consults one for them.
            for e, ref in zip(result['document']['entities'], reference['document']['entities']):
                if e['type'] in ('text', 'block'): self.assertEqual(e['sourceFingerprint'], exchange.editable_fingerprint(e))
                else: self.assertNotIn('sourceFingerprint', e); self.assertEqual(e['sourceHandle'], ref['sourceHandle'])
            lines = [e for e in result['document']['entities'] if e['type'] == 'line']
            self.assertEqual([e.get('colorMode') for e in lines], [None, 'aci', None, 'byblock', 'truecolor', None, None])
            self.assertEqual(lines[4]['color'], '#12ab34'); self.assertEqual(lines[3]['linetype'], '점선')
            # 'ByLayer' as written by the engine is not a linetype name: the line follows its layer.
            self.assertNotIn('linetype', lines[0]); self.assertNotIn('linetype', lines[4])
            arc = next(e for e in result['document']['entities'] if e['type'] == 'arc')
            self.assertEqual((arc['startAngle'], arc['endAngle'], arc['color']), (30.5, 359.123456789, '#abcdef'))
            closed = next(e for e in result['document']['entities'] if e['type'] == 'polyline' and e.get('closed'))
            self.assertEqual(closed['constantWidth'], 0.5)
            self.assertIn('폴리선 높이 → XY 평면', result['report']['converted'])

    def test_export_writes_every_split_entity_back(self):
        # Split entities are not in the preserved DXF: export writes them from the drawing.
        with tempfile.TemporaryDirectory() as folder:
            full, residual, split = self.drawing(folder)
            document = self.imported(folder, residual, split)['document']
            data, warnings = exchange.export_dxf(document)
            again = exchange.import_file(data, '.dxf')['document']
            def shapes(doc):
                out = []
                for e in doc['entities']:
                    if e['type'] == 'line': out.append(('line', tuple(round(v, 6) for p in e['points'] for v in (p['x'], p['y']))))
                    elif e['type'] in ('circle', 'arc'): out.append((e['type'], round(e['center']['x'], 6), round(e['center']['y'], 6), round(e['radius'], 6), round(e.get('startAngle', 0), 6)))
                    elif e['type'] == 'polyline': out.append(('polyline', len(e['points']), bool(e.get('closed'))))
                return sorted(out)
            self.assertEqual(shapes(again), shapes(document))
            self.assertTrue(any('원본 보존' in w for w in warnings), warnings)

    def test_bln3_preserves_zero_length_line_and_exports_its_endpoints(self):
        with tempfile.TemporaryDirectory() as folder:
            doc = ezdxf.new('R2018'); doc.units = 4
            line = doc.modelspace().add_line((7, 9), (7, 9))
            entry = (line.dxf.handle, 'LINE', {'layer': '0', 'linetype': 'ByLayer', 'colour': 256, 'lineweight': -1, 'ltscale': 1., 'start': (7., 9., 0.), 'end': (7., 9., 0.)})
            binary = split_file([entry])
            doc.modelspace().delete_entity(line)
            residual = Path(folder) / 'residual.dxf'; doc.saveas(residual)
            result = self.imported(folder, residual, binary)
            self.assertEqual(result['report']['skipped'], {})
            entity = result['document']['entities'][0]
            self.assertEqual(entity['type'], 'line')
            self.assertEqual(entity['points'], [{'x': 7., 'y': 9.}, {'x': 7., 'y': 9.}])
            raw, _ = exchange.export_dxf(result['document'])
            again = exchange.import_file(raw, '.dxf')['document']['entities']
            self.assertEqual(len(again), 1)
            self.assertEqual(again[0]['points'], entity['points'])


    def test_a_file_that_does_not_line_up_imports_through_the_dxf_instead(self):
        with tempfile.TemporaryDirectory() as folder:
            full, residual, split = self.drawing(folder)
            calls = []
            result = self.imported(folder, residual, split[:-1], calls)   # truncated vertex pool
            self.assertEqual(calls, [True, False])
            self.assertTrue(result['report']['converterDetails']['splitLinesRetried'])
            self.assertEqual(sum(e['type'] == 'line' for e in result['document']['entities']), 7)

    def test_a_dxf_entity_missing_from_the_engine_order_is_not_silently_dropped(self):
        with tempfile.TemporaryDirectory() as folder:
            full, residual, split = self.drawing(folder)
            doc = ezdxf.readfile(residual); doc.modelspace().add_point((0, 0)); doc.saveas(residual)
            calls = []
            self.imported(folder, residual, split, calls)
            self.assertEqual(calls, [True, False])


if __name__ == '__main__':
    unittest.main()
