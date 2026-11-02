"""Native DIMARC/DIMJOGGED/DIMORDINATE and visible DIMBREAK DXF round trips."""
import copy
import io
import json
import math
import tempfile
from pathlib import Path
import subprocess
import unittest

import ezdxf
import exchange
from batch_converter import dxf_to_dwg, CONVERTER

ROOT = Path(__file__).resolve().parent


def point(x, y):
    return {'x': x, 'y': y}


def drawing(mode, **options):
    points = {
        'arcLength': [point(0, 0), point(100, 0), point(0, 100), point(120, 120)],
        'jogged': [point(0, 0), point(100, 0), point(110, 0), point(20, 0), point(50, 0)],
        'ordinateX': [point(10, 20), point(45, 70), point(60, 110)],
        'ordinateY': [point(10, 20), point(45, 70), point(100, 90)],
        'horizontal': [point(0, 0), point(100, 0), point(0, 20)],
    }
    entity = {'id': 'dim', 'layer': 'dims', 'type': 'dimension', 'mode': mode,
              'points': points[mode], 'textHeight': 3, 'arrowSize': 1.2,
              'arrowType': 'tick', 'precision': 3, 'measurementScale': 2,
              'extensionOffset': 0.6, 'extensionOvershoot': 1.3, 'textGap': 0.8,
              **options}
    return {'version': 2, 'units': 'mm', 'layers': [
        {'id': 'dims', 'name': 'A-DIM', 'color': '#9dcbe0',
         'visible': True, 'locked': False, 'linetype': 'CONTINUOUS', 'lineweight': .25}],
        'blocks': [], 'entities': [entity]}


def prepared(model):
    script = ("import fs from 'node:fs'; import {dimensionParts} from './geometry.js';"
              "const m=JSON.parse(fs.readFileSync(0,'utf8'));"
              "for(const e of m.entities)e.dimensionDisplayParts=dimensionParts(e);"
              "process.stdout.write(JSON.stringify(m));")
    result = subprocess.run(['node', '--input-type=module', '-e', script],
                            cwd=ROOT, input=json.dumps(model), capture_output=True,
                            text=True, encoding='utf8', check=True, timeout=15)
    return json.loads(result.stdout)


def dxf_document(content):
    return ezdxf.read(io.StringIO(content.decode('utf8').replace('\r\n', '\n')))


def standard_bytes(doc):
    if 'BARUN_CAD_V2' in doc.rootdict:
        del doc.rootdict['BARUN_CAD_V2']
    stream = io.StringIO()
    doc.write(stream)
    return stream.getvalue().encode('utf8')


class DimensionExtraExchangeTests(unittest.TestCase):
    def export(self, model, version='R2018'):
        model = prepared(model)
        content, warnings = exchange.export_dxf(model, version)
        doc = dxf_document(content)
        self.assertFalse(doc.audit().errors)
        return model, doc, content

    def test_native_types_without_document_metadata(self):
        for mode, kind in [('arcLength', 'ARC_DIMENSION'), ('jogged', 'LARGE_RADIAL_DIMENSION'),
                           ('ordinateX', 'DIMENSION'), ('ordinateY', 'DIMENSION')]:
            with self.subTest(mode=mode):
                model, doc, _ = self.export(drawing(mode))
                native = list(doc.modelspace())[0]
                self.assertEqual(native.dxftype(), kind)
                self.assertEqual(native.dxf.layer, 'A-DIM')
                if mode.startswith('ordinate'):
                    self.assertEqual(native.dxf.dimtype & 7, 6)
                    self.assertEqual(bool(native.dxf.dimtype & 64), mode == 'ordinateX')
                opened = exchange.import_file(standard_bytes(doc), '.dxf')
                self.assertFalse(opened['report']['nativeMetadata'])
                self.assertFalse(opened['report']['skipped'])
                imported = opened['document']['entities'][0]
                self.assertEqual(imported['mode'], mode)
                for actual, expected in zip(imported['points'], model['entities'][0]['points']):
                    self.assertAlmostEqual(actual['x'], expected['x'])
                    self.assertAlmostEqual(actual['y'], expected['y'])

    def test_native_points_styles_and_annotation_effective_scale(self):
        for mode in ['arcLength', 'jogged', 'ordinateX', 'ordinateY']:
            with self.subTest(mode=mode):
                model, doc, _ = self.export(drawing(mode, scale=4, textRotation=25))
                native = list(doc.modelspace())[0]
                self.assertEqual(native.override().get('dimtxt'), 12)
                self.assertEqual(native.override().get('dimasz'), 4.8)
                self.assertEqual(native.override().get('dimlfac'), 2)
                self.assertEqual(native.dxf.text_rotation, 25)
                imported = exchange.import_file(standard_bytes(doc), '.dxf')['document']['entities'][0]
                self.assertEqual(imported['textHeight'], 12)
                self.assertEqual(imported['textRotation'], 25)
                self.assertAlmostEqual(imported['arrowSize'], 4.8)
                self.assertAlmostEqual(imported['extensionOffset'], 2.4)
                self.assertAlmostEqual(imported['extensionOvershoot'], 5.2)
                self.assertAlmostEqual(imported['textGap'], 3.2)
                self.assertEqual(imported['arrowType'], 'tick')

    def test_partial_arc_leader_and_symbol_are_native(self):
        model, doc, _ = self.export(drawing('arcLength', arcPartial=True, arcLeader=True,
                                           leaderPoint=point(60, 60), arcSymbol='⌒'))
        native = list(doc.modelspace())[0]
        self.assertEqual(native.dxf.is_partial, 1)
        self.assertEqual(native.dxf.has_leader, 1)
        self.assertEqual(tuple(native.dxf.leader_point1)[:2], (60, 60))
        self.assertEqual(native.override().get('dimarcsym'), 0)
        imported = exchange.import_file(standard_bytes(doc), '.dxf')['document']['entities'][0]
        self.assertTrue(imported['arcPartial'])
        self.assertTrue(imported['arcLeader'])
        self.assertEqual(imported['leaderPoint'], point(60, 60))
        self.assertEqual(imported['arcSymbol'], '⌒')

    def test_arc_versions_keep_native_kind(self):
        for version in ['R2000', 'R2004', 'R2013', 'R2018']:
            with self.subTest(version=version):
                content, _ = exchange.export_dxf(drawing('arcLength'), version)
                # Legacy encodings are read via the normal file reader.
                opened = exchange.import_file(content, '.dxf')
                self.assertEqual(opened['document']['entities'][0]['mode'], 'arcLength')
                with tempfile.TemporaryDirectory() as folder:
                    path = Path(folder) / 'drawing.dxf'
                    path.write_bytes(content)
                    native = ezdxf.readfile(path)
                    self.assertEqual(list(native.modelspace())[0].dxftype(), 'ARC_DIMENSION')

    def test_jogged_unsupported_r2000_refuses_data_loss(self):
        with self.assertRaisesRegex(ValueError, '2004'):
            exchange.export_dxf(drawing('jogged'), 'R2000')

    def test_display_cache_not_stored_in_document_metadata(self):
        model, doc, content = self.export(drawing('jogged'))
        self.assertIn('dimensionDisplayParts', model['entities'][0])
        opened = exchange.import_file(content, '.dxf')['document']
        self.assertNotIn('dimensionDisplayParts', opened['entities'][0])

    def test_breaks_roundtrip_independent_of_document_payload(self):
        gaps = [{'partIndex': 0, 'start': .4, 'end': .6}, {'partIndex': 1, 'start': .2, 'end': .3}]
        for mode in ['horizontal', 'arcLength', 'jogged', 'ordinateX', 'ordinateY']:
            with self.subTest(mode=mode):
                model, doc, _ = self.export(drawing(mode, breaks=gaps))
                native = list(doc.modelspace())[0]
                self.assertEqual(exchange._dimension_breaks(native), gaps)
                imported = exchange.import_file(standard_bytes(doc), '.dxf')['document']['entities'][0]
                self.assertEqual(imported['breaks'], gaps)

    def test_anonymous_block_matches_actual_broken_screen_parts(self):
        gaps = [{'partIndex': 0, 'start': .4, 'end': .6}]
        for mode in ['horizontal', 'arcLength', 'jogged', 'ordinateX', 'ordinateY']:
            with self.subTest(mode=mode):
                model, doc, _ = self.export(drawing(mode, breaks=gaps))
                native = list(doc.modelspace())[0]
                block = list(doc.blocks.get(native.dxf.geometry))
                parts = model['entities'][0]['dimensionDisplayParts']
                self.assertEqual(len(block), len(parts))
                for raw, part in zip(block, parts):
                    self.assertEqual(raw.dxftype(), {'line': 'LINE', 'arc': 'ARC', 'text': 'TEXT'}[part['type']])
                    if part['type'] == 'line':
                        self.assertAlmostEqual(raw.dxf.start.x, part['points'][0]['x'])
                        self.assertAlmostEqual(raw.dxf.start.y, part['points'][0]['y'])
                        self.assertAlmostEqual(raw.dxf.end.x, part['points'][1]['x'])
                        self.assertAlmostEqual(raw.dxf.end.y, part['points'][1]['y'])
                    elif part['type'] == 'arc':
                        self.assertAlmostEqual(raw.dxf.start_angle, part['startAngle'] % 360)
                        self.assertAlmostEqual(raw.dxf.end_angle, part['endAngle'] % 360)
                    else:
                        self.assertEqual(raw.dxf.text, part['text'])

    def test_jogged_python_export_has_visible_geometry(self):
        content, _ = exchange.export_dxf(drawing('jogged'))
        doc = dxf_document(content)
        native = list(doc.modelspace())[0]
        self.assertEqual(native.dxftype(), 'LARGE_RADIAL_DIMENSION')
        self.assertGreaterEqual(len(doc.blocks.get(native.dxf.geometry)), 4)


    def check_native_dwg(self, mode):
        gaps = [{'partIndex': 0, 'start': .4, 'end': .6}]
        model, doc, _ = self.export(drawing(mode, breaks=gaps))
        # Remove the whole-document metadata so a dropped native entity cannot hide.
        dwg, info = dxf_to_dwg(standard_bytes(doc), '2018')
        self.assertEqual(info['lost'], 0, info)
        opened = exchange.import_file(dwg, '.dwg')
        self.assertFalse(opened['report']['nativeMetadata'])
        self.assertEqual(len(opened['document']['entities']), 1)
        entity = opened['document']['entities'][0]
        self.assertEqual(entity['mode'], mode)
        self.assertEqual(entity['breaks'], gaps)

    def test_arc_length_native_dwg_roundtrip(self):
        self.check_native_dwg('arcLength')

    def test_ordinate_x_native_dwg_roundtrip(self):
        self.check_native_dwg('ordinateX')

    def test_ordinate_y_native_dwg_roundtrip(self):
        self.check_native_dwg('ordinateY')

    def test_jogged_dwg_fallback_roundtrip(self):
        self.check_native_dwg('jogged')


    def check_rotated_ordinate_origin(self, mode):
        for axis in (37, 127, -20):
            with self.subTest(mode=mode, axisAngle=axis):
                model, native_doc, _ = self.export(drawing(mode, axisAngle=axis))
                expected = model['entities'][0]
                native = list(native_doc.modelspace())[0]
                endpoint = expected['points'][2]
                self.assertAlmostEqual(native.dxf.defpoint3.x, endpoint['x'])
                self.assertAlmostEqual(native.dxf.defpoint3.y, endpoint['y'])
                opened = exchange.import_file(standard_bytes(native_doc), '.dxf')['document']
                imported = opened['entities'][0]
                self.assertEqual(imported['mode'], mode)
                self.assertAlmostEqual(imported['axisAngle'], axis)
                for actual, wanted in zip(imported['points'], expected['points']):
                    self.assertAlmostEqual(actual['x'], wanted['x'])
                    self.assertAlmostEqual(actual['y'], wanted['y'])
                # A second native write must not accumulate another origin shift.
                again, _ = exchange.export_dxf(prepared(opened))
                reopened = exchange.import_file(standard_bytes(dxf_document(again)), '.dxf')['document']['entities'][0]
                for actual, wanted in zip(reopened['points'], expected['points']):
                    self.assertAlmostEqual(actual['x'], wanted['x'])
                    self.assertAlmostEqual(actual['y'], wanted['y'])

    def test_rotated_ordinate_x_keeps_nonzero_origin_and_leader(self):
        self.check_rotated_ordinate_origin('ordinateX')

    def test_rotated_ordinate_y_keeps_nonzero_origin_and_leader(self):
        self.check_rotated_ordinate_origin('ordinateY')

    def test_display_cache_does_not_change_preserved_entity_fingerprints(self):
        original = drawing('arcLength')['entities'][0]
        cached = prepared(drawing('arcLength'))['entities'][0]
        self.assertEqual(exchange.editable_fingerprint(original), exchange.editable_fingerprint(cached))
        direct = {'type': 'block', 'entities': [original]}
        nested = {'type': 'block', 'entities': [cached]}
        self.assertEqual(exchange.editable_fingerprint(direct), exchange.editable_fingerprint(nested))
        edited = copy.deepcopy(cached)
        edited['points'][3]['x'] += 1
        self.assertNotEqual(exchange.editable_fingerprint(original), exchange.editable_fingerprint(edited))


    def test_imported_bulged_polyline_command_exports_native_arc_dimension(self):
        source = ezdxf.new('R2018')
        source.modelspace().add_lwpolyline([(0, 0, 1), (100, 0, 0)], format='xyb')
        imported = exchange.import_file(standard_bytes(source), '.dxf')['document']
        self.assertEqual(imported['entities'][0]['name'], 'DXF 곡선 폴리선')
        script = ("import fs from 'node:fs';import {DrawingEngine} from './engine.js';"
                  "import {runScripted} from './command-runner.js';import {prepareDimensionExport} from './dimension-export.js';"
                  "const engine=new DrawingEngine();engine.execute({type:'load',document:JSON.parse(fs.readFileSync(0,'utf8'))});"
                  "await runScripted(engine,'DIMARC',{entities:[{id:engine.doc.entities[0].id,point:[50,-50]}],points:[[50,-80]]});"
                  "process.stdout.write(JSON.stringify(prepareDimensionExport(engine.doc)));")
        result = subprocess.run(['node', '--input-type=module', '-e', script], cwd=ROOT,
                                input=json.dumps(imported), capture_output=True, text=True,
                                encoding='utf8', check=True, timeout=15)
        generated = json.loads(result.stdout)
        dimension = next(e for e in generated['entities'] if e['type'] == 'dimension')
        self.assertEqual(dimension['mode'], 'arcLength')
        content, warnings = exchange.export_dxf(generated)
        native_doc = dxf_document(content)
        self.assertEqual(len(list(native_doc.modelspace().query('ARC_DIMENSION'))), 1)
        opened = exchange.import_file(standard_bytes(native_doc), '.dxf')['document']
        recovered = next(e for e in opened['entities'] if e['type'] == 'dimension')
        self.assertEqual(recovered['mode'], 'arcLength')
        for actual, expected in zip(recovered['points'], dimension['points']):
            self.assertAlmostEqual(actual['x'], expected['x'])
            self.assertAlmostEqual(actual['y'], expected['y'])


    def test_rotated_ordinates_dwg_native_group_51_without_metadata(self):
        from batch_converter import RUNTIME
        from ezdxf.lldxf.tagwriter import TagCollector
        for mode in ('ordinateX', 'ordinateY'):
            for axis in (37, 127, -20):
                with self.subTest(mode=mode, axis=axis):
                    model, doc, _ = self.export(drawing(mode, axisAngle=axis, textRotation=25))
                    dwg, info = dxf_to_dwg(standard_bytes(doc), '2018')
                    with tempfile.TemporaryDirectory() as folder:
                        source, target = Path(folder) / 'in.dwg', Path(folder) / 'out.dxf'
                        source.write_bytes(dwg)
                        result = subprocess.run([str(RUNTIME / CONVERTER), str(source), str(target), '2018'],
                                                capture_output=True, text=True, encoding='utf8', check=True)
                        output = ezdxf.readfile(target)
                    entity = list(output.modelspace())[0]
                    self.assertEqual(entity.dxftype(), 'DIMENSION')
                    expected_direction = -axis + (90 if mode == 'ordinateY' else 0)
                    self.assertAlmostEqual(entity.dxf.horizontal_direction, expected_direction)
                    self.assertEqual(sum(tag.code == 51 for tag in TagCollector.dxftags(entity)), 1)
                    self.assertAlmostEqual(entity.dxf.text_rotation, 25)
                    imported = exchange.import_file(standard_bytes(output), '.dxf')['document']['entities'][0]
                    self.assertAlmostEqual(imported['axisAngle'], axis)
                    for actual, expected in zip(imported['points'], model['entities'][0]['points']):
                        self.assertAlmostEqual(actual['x'], expected['x'])
                        self.assertAlmostEqual(actual['y'], expected['y'])

    def test_ordinate_direction_in_blocks_paper_space_and_legacy_dxf(self):
        from batch_converter import RUNTIME
        doc = ezdxf.new('R2018')
        for index, layout in enumerate((doc.modelspace(), doc.blocks.new('nested'), doc.layouts.new('sheet'))):
            dimension = layout.add_ordinate_dim((45, 70), (15, 40), dtype=1, origin=(10, 20), rotation=37 + index * 10, dimstyle='Standard')
            dimension.render()
        doc.modelspace().add_blockref('nested', (100, 200))
        doc.header['$DIMSTYLE'] = 'Standard'
        with tempfile.TemporaryDirectory() as folder:
            source, dwg, target = [Path(folder) / name for name in ('in.dxf', 'in.dwg', 'out.dxf')]
            source.write_bytes(standard_bytes(doc))
            for version in ('2000', '2004', '2010', '2013', '2018'):
                with self.subTest(version=version):
                    for a, b in ((source, dwg), (dwg, target)):
                        subprocess.run([str(RUNTIME / CONVERTER), str(a), str(b), version],
                                       capture_output=True, check=True)
                    output = ezdxf.readfile(target)
                    directions = sorted(entity.dxf.horizontal_direction for block in output.blocks
                                        for entity in block if entity.dxftype() == 'DIMENSION')
                    self.assertEqual(len(directions), 3)
                    for actual, expected in zip(directions, (-57, -47, -37)):
                        self.assertAlmostEqual(actual, expected)
                    self.assertFalse(output.audit().errors)

    def test_jogged_fallback_keeps_native_radius_style_picture_and_original(self):
        from batch_converter import process, RUNTIME
        from dimension_compat import JOGGED_APPID
        import hashlib
        gaps = [{'partIndex': 0, 'start': .4, 'end': .6}]
        model, doc, _ = self.export(drawing('jogged', breaks=gaps, textRotation=25))
        expected = list(doc.modelspace())[0]
        original = standard_bytes(doc)
        with tempfile.TemporaryDirectory() as folder:
            source, target = Path(folder) / 'in.dxf', Path(folder) / 'back.dxf'
            source.write_bytes(original)
            result = process({'action': 'convert', 'name': source.name, 'direction': 'dxf-dwg',
                              'folder': folder, 'version': '2018', '_source_path': str(source)})
            self.assertFalse(result.get('failed'), result)
            self.assertEqual(result['joggedFallbacks'], 1)
            self.assertTrue(any('꺾인 반지름' in warning for warning in result['warnings']))
            self.assertEqual(hashlib.sha256(source.read_bytes()).digest(), hashlib.sha256(original).digest())
            subprocess.run([str(RUNTIME / CONVERTER), result['path'], str(target), '2018'],
                           capture_output=True, check=True)
            output = ezdxf.readfile(target)
        radial = list(output.modelspace())[0]
        self.assertEqual(radial.dxftype(), 'DIMENSION')
        self.assertEqual(radial.dxf.dimtype & 7, 4)
        self.assertEqual(radial.dxf.handle, expected.dxf.handle)
        self.assertTrue(radial.has_xdata(JOGGED_APPID))
        self.assertEqual(tuple(radial.dxf.defpoint), tuple(expected.dxf.defpoint))
        self.assertEqual(tuple(radial.dxf.defpoint4), tuple(expected.dxf.chord_point))
        self.assertEqual(radial.override().get('dimlfac'), 2)
        picture = list(output.blocks[radial.dxf.geometry])
        self.assertEqual(len(picture), len(model['entities'][0]['dimensionDisplayParts']))
        imported = exchange.import_file(standard_bytes(output), '.dxf')['document']['entities'][0]
        self.assertEqual(imported['mode'], 'jogged')
        self.assertEqual(imported['breaks'], gaps)
        self.assertEqual(imported['points'], model['entities'][0]['points'])
        self.assertAlmostEqual(imported['textRotation'], 25)
        _, info = dxf_to_dwg(original)
        self.assertEqual(info['joggedFallbacks'], 1)
        self.assertTrue(any('꺾인 반지름' in warning for warning in info['warnings']))

    def test_jogged_fallback_inside_nested_and_paper_space_preserves_order(self):
        from dimension_compat import lower_jogged_dimensions, jogged_points
        _, source, _ = self.export(drawing('jogged'))
        doc = source
        original = list(doc.modelspace())[0]
        block = doc.blocks.new('group')
        before = block.add_line((0, 0), (1, 1))
        clone = original.copy()
        block.add_entity(clone)
        after = block.add_line((2, 2), (3, 3))
        # Binding a copied dimension can materialize its cached block on export.
        if not clone.dxf.get('geometry'):
            clone.dxf.geometry = original.dxf.geometry
        paper = doc.layouts.new('sheet')
        paper_clone = original.copy()
        paper.add_entity(paper_clone)
        if not paper_clone.dxf.get('geometry'):
            paper_clone.dxf.geometry = original.dxf.geometry
        count = lower_jogged_dimensions(doc)
        self.assertEqual(count, 3)
        self.assertEqual([e.dxf.handle for e in block], [before.dxf.handle, clone.dxf.handle, after.dxf.handle])
        self.assertIsNotNone(jogged_points(list(block)[1]))
        self.assertIsNotNone(jogged_points(list(paper)[0]))
        self.assertFalse(doc.audit().errors)

    def test_break_xdata_survives_without_extension_dictionary_and_document_payload(self):
        from dimension_compat import BREAK_APPID
        gaps = [{'partIndex': 0, 'start': .4, 'end': .6}]
        for mode in ('horizontal', 'jogged', 'arcLength', 'ordinateX', 'ordinateY'):
            with self.subTest(mode=mode):
                _, doc, _ = self.export(drawing(mode, breaks=gaps))
                entity = list(doc.modelspace())[0]
                self.assertTrue(entity.has_xdata(BREAK_APPID))
                entity.discard_extension_dict()
                self.assertEqual(exchange._dimension_breaks(entity), gaps)
                dwg, _ = dxf_to_dwg(standard_bytes(doc))
                opened = exchange.import_file(dwg, '.dwg')
                self.assertFalse(opened['report']['nativeMetadata'])
                self.assertEqual(opened['document']['entities'][0]['breaks'], gaps)

    def test_large_break_payload_uses_owned_xrecord_instead_of_oversized_xdata(self):
        from dimension_compat import BREAK_APPID
        gaps = [{'partIndex': index, 'start': .4, 'end': .6} for index in range(500)]
        _, doc, _ = self.export(drawing('horizontal', breaks=gaps))
        entity = list(doc.modelspace())[0]
        self.assertEqual(entity.get_xdata(BREAK_APPID)[0].value, 'BREAKS_XRECORD_V1')
        self.assertEqual(exchange._dimension_breaks(entity), gaps)
        dwg, _ = dxf_to_dwg(standard_bytes(doc))
        imported = exchange.import_file(dwg, '.dwg')['document']['entities'][0]
        self.assertEqual(imported['breaks'], gaps)

    def test_unverified_autocad_break_objects_are_not_fabricated(self):
        gaps = [{'partIndex': 0, 'start': .4, 'end': .6}]
        model = prepared(drawing('horizontal', breaks=gaps))
        content, warnings = exchange.export_dxf(model)
        doc = dxf_document(content)
        entity = list(doc.modelspace())[0]
        self.assertNotIn('ACAD_DIMBREAK', entity.get_extension_dict())
        self.assertTrue(any('재생성' in warning for warning in warnings))


    def test_dimension_dxf_stream_arbitrary_chunks_and_encodings(self):
        import os
        sdk = Path(os.environ.get('BARUN_DOTNET_SDK', r'C:\Users\me\AppData\Local\Microsoft\dotnet\dotnet.exe'))
        if not sdk.is_file():
            self.skipTest('NET 8 SDK is needed for the streaming writer stress test')
        program = r'''
using System.Reflection;
using System.Text;
using System.Globalization;
Encoding.RegisterProvider(CodePagesEncodingProvider.Instance);
var assembly=Assembly.LoadFrom(args[0]);
var type=assembly.GetType("DimensionDxfWriter")!.GetNestedType("DirectionStream",BindingFlags.NonPublic)!;
var constructor=type.GetConstructors(BindingFlags.Public|BindingFlags.NonPublic|BindingFlags.Instance).Single();
int cases=0;
foreach(var encoding in new[]{new UTF8Encoding(false),Encoding.GetEncoding(949),Encoding.GetEncoding(1252)})
foreach(int chunk in new[]{1,2,3,7,64,255,256,4096,8192,65536}) {
    string longText=new string('x',600)+"한글";
    string content="  0\r\nSECTION\r\n  2\r\nENTITIES\r\n  0\r\nDIMENSION\r\n  5\r\nAB\r\n100\r\nAcDbDimension\r\n  1\r\n"+longText+
        "\r\n100\r\nAcDbOrdinateDimension\r\n  0\r\nDIMENSION\r\n  5\r\nAC\r\n100\r\nAcDbDimension\r\n  1\r\nAcDbDimension\r\n  0\r\nENDSEC\r\n  0\r\nEOF";
    string expected=content.Replace("AB\r\n100\r\nAcDbDimension\r\n","AB\r\n100\r\nAcDbDimension\r\n 51\r\n-37\r\n");
    byte[] input=encoding.GetBytes(content),wanted=encoding.GetBytes(expected);
    using var output=new MemoryStream();
    using var stream=(Stream)constructor.Invoke(new object[]{output,new Dictionary<ulong,double>{{0xAB,-37}}});
    for(int i=0;i<input.Length;i+=chunk)stream.Write(input,i,Math.Min(chunk,input.Length-i));
    stream.Flush();
    if(!output.ToArray().SequenceEqual(wanted))throw new Exception($"stream mismatch: {encoding.CodePage}, chunk {chunk}");
    cases++;
}
Console.Write(cases);
'''
        (ROOT / 'tmp').mkdir(exist_ok=True)
        with tempfile.TemporaryDirectory(dir=ROOT / 'tmp') as folder:
            folder = Path(folder)
            (folder / 'Program.cs').write_text(program, encoding='utf8')
            project = folder / 'Stress.csproj'
            project.write_text('<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><OutputType>Exe</OutputType>'
                               '<TargetFramework>net8.0</TargetFramework><ImplicitUsings>enable</ImplicitUsings>'
                               '</PropertyGroup></Project>', encoding='utf8')
            config = folder / 'NuGet.Config'
            config.write_text('<configuration><packageSources><clear/></packageSources></configuration>', encoding='utf8')
            env = dict(os.environ, DOTNET_CLI_HOME=str(folder), DOTNET_CLI_TELEMETRY_OPTOUT='1',
                       DOTNET_GENERATE_ASPNET_CERTIFICATE='false', DOTNET_ADD_GLOBAL_TOOLS_TO_PATH='false')
            for key, value in {'APPDATA': r'C:\Users\me\AppData\Roaming', 'ProgramData': r'C:\ProgramData',
                               'ProgramFiles': r'C:\Program Files', 'ProgramFiles(x86)': r'C:\Program Files (x86)'}.items():
                if not env.get(key):env[key] = value
            result = subprocess.run([str(sdk), 'build', str(project), '--configfile', str(config),
                                     '-p:NuGetAudit=false', '-o', str(folder / 'out')],
                                    env=env, capture_output=True, timeout=60)
            self.assertEqual(result.returncode, 0, result.stdout.decode('utf8', errors='replace'))
            result = subprocess.run([str(sdk), str(folder / 'out' / 'Stress.dll'),
                                     str(ROOT / 'dwg-runtime' / 'BarunConverter.dll')],
                                    env=env, capture_output=True, timeout=30)
            self.assertEqual(result.returncode, 0, result.stderr.decode('utf8', errors='replace'))
            self.assertEqual(result.stdout, b'30')

    def test_jogged_fallback_wcs_xdata_follows_external_rotation_and_move(self):
        from dimension_compat import lower_jogged_dimensions, jogged_points
        from ezdxf.math import Matrix44, Vec3
        model, doc, _ = self.export(drawing('jogged'))
        lower_jogged_dimensions(doc)
        entity = list(doc.modelspace())[0]
        transform = Matrix44.chain(Matrix44.z_rotate(math.pi / 2), Matrix44.translate(20, 30, 0))
        expected = [transform.transform(Vec3(point['x'], point['y'], 0)) for point in model['entities'][0]['points']]
        entity.transform(transform)
        override, jog = jogged_points(entity)
        for actual, wanted in zip((entity.dxf.defpoint, entity.dxf.defpoint4, override, jog),
                                  (expected[0], expected[1], expected[3], expected[4])):
            self.assertAlmostEqual(actual[0], wanted.x)
            self.assertAlmostEqual(actual[1], wanted.y)
        self.assertFalse(doc.audit().errors)

    def test_raw_converter_refuses_to_silently_drop_unstaged_jogged(self):
        from batch_converter import RUNTIME
        _, doc, _ = self.export(drawing('jogged'))
        with tempfile.TemporaryDirectory() as folder:
            source, target = Path(folder) / 'native.dxf', Path(folder) / 'out.dwg'
            source.write_bytes(standard_bytes(doc))
            result = subprocess.run([str(RUNTIME / CONVERTER), str(source), str(target), '2018'],
                                    capture_output=True, text=True, encoding='utf8')
            self.assertNotEqual(result.returncode, 0)
            self.assertIn('LARGE_RADIAL_DIMENSION', json.loads(result.stdout)['message'])
            self.assertFalse(target.exists())


if __name__ == '__main__':
    unittest.main()
