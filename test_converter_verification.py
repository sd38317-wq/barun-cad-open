"""Regression for verified fallback conversion; no customer drawings needed."""
import json
import tempfile
import unittest
from collections import Counter
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import ezdxf
import batch_converter


class FallbackMockTests(unittest.TestCase):
    """프로세스를 대역으로 쓰는 시험은 설치된 보조 실행 파일에 의존하지 않는다."""
    def setUp(self):
        super().setUp()
        folder = self.enterContext(tempfile.TemporaryDirectory())
        runtime = Path(folder) / 'acadrust-runtime'
        runtime.mkdir()
        (runtime / ('barun-dwg2dxf' + batch_converter.runtime_paths.EXE)).write_bytes(b'test executable marker')
        original = batch_converter.runtime_paths.bundled_runtime
        self.enterContext(patch('batch_converter.runtime_paths.bundled_runtime',
            side_effect=lambda name: runtime if name == 'acadrust-runtime' else original(name)))
        self.enterContext(patch('batch_converter._attach_to_job', return_value=True))
        self.enterContext(patch('batch_converter._resume_fallback'))
        self.enterContext(patch('batch_converter._run_fallback',
            side_effect=lambda *a, **kw: batch_converter.subprocess.run(*a, **kw)))


class FallbackVerificationTests(FallbackMockTests):
    def convert(self, folder, expected, entities, reader=None):
        calls = []

        def run(args, **kwargs):
            calls.append(args)
            if len(calls) == 1:
                return SimpleNamespace(returncode=1, stdout=json.dumps({
                    'failed': True, 'inputTypes': expected, 'warnings': [],
                }).encode())
            doc = ezdxf.new('R2018')
            entities(doc.modelspace())
            doc.saveas(Path(args[args.index('-o') + 1]))
            return SimpleNamespace(returncode=0, stdout=b'')

        request = {'action': 'convert', 'name': 'test.dwg', 'direction': 'dwg-dxf',
                   'folder': folder, '_raw': b'AC10-test', '_no_parallel_fallback': True}
        if reader:
            request['_reader'] = reader
        with patch('batch_converter.subprocess.run', side_effect=run), \
             patch.dict('os.environ', {'LOCALAPPDATA': folder}):
            return batch_converter.process(request)

    def test_attribute_definition_maps_to_attdef_without_losing_entities(self):
        with tempfile.TemporaryDirectory() as folder:
            result = self.convert(folder, {'AttributeDefinition': 1, 'Line': 1},
                                  lambda m: (m.add_attdef('TAG', (0, 0)), m.add_line((0, 0), (1, 0))))
            self.assertFalse(result.get('failed'), result)
            self.assertEqual(len(ezdxf.readfile(result['path']).modelspace()), 2)

    def test_real_missing_entity_is_still_rejected_and_counted(self):
        with tempfile.TemporaryDirectory() as folder:
            result = self.convert(folder, {'AttributeDefinition': 2},
                                  lambda m: m.add_attdef('TAG', (0, 0)))
            self.assertTrue(result['failed'])
            self.assertEqual(result['verification'], {
                'code': 'FALLBACK_ENTITY_COUNT_MISMATCH', 'missingTypes': {'ATTDEF': 1}, 'extraTypes': {}})
            self.assertFalse((Path(folder) / 'test.dxf').exists())

    def test_reader_failure_has_safe_type_without_private_message(self):
        def reader(path):
            raise ValueError('private customer text and filename')
        with tempfile.TemporaryDirectory() as folder:
            result = self.convert(folder, {'Line': 1},
                                  lambda m: m.add_line((0, 0), (1, 0)), reader)
            self.assertEqual(result['verification'], {
                'code': 'FALLBACK_DXF_READ_FAILED', 'exceptionType': 'ValueError'})
            self.assertNotIn('private customer', json.dumps(result))
            self.assertFalse((Path(folder) / 'test.dxf').exists())



class PrimaryDeferredVerificationTests(FallbackMockTests):
    """The importer verifies the primary engine's output from the document it reads anyway."""
    def request(self, folder):
        return {'action': 'convert', 'name': 'test.dwg', 'direction': 'dwg-dxf', 'folder': folder, '_raw': b'AC10-test',
                '_no_parallel_fallback': True, '_defer_dxf_validation': True, '_keep_document': True, '_reader': ezdxf.readfile}

    def primary(self, args, types, draw):
        doc = ezdxf.new('R2018'); draw(doc.modelspace()); doc.saveas(Path(args[2]))
        return SimpleNamespace(returncode=0, stdout=json.dumps({'before': sum(types.values()), 'after': None,
                               'verificationDeferred': True, 'inputTypes': types, 'warnings': []}).encode())

    def fallback(self, args, draw):
        doc = ezdxf.new('R2018'); draw(doc.modelspace()); doc.saveas(Path(args[args.index('-o') + 1]))
        return SimpleNamespace(returncode=0, stdout=b'')

    def test_primary_success_is_read_once_and_the_document_is_handed_on(self):
        calls = []
        def run(args, **kwargs):
            calls.append(args)
            return self.primary(args, {'Line': 2}, lambda m: (m.add_line((0, 0), (1, 0)), m.add_line((0, 1), (1, 1))))
        with tempfile.TemporaryDirectory() as folder, patch('batch_converter.subprocess.run', side_effect=run),              patch.dict('os.environ', {'LOCALAPPDATA': folder}):
            result = batch_converter.process(self.request(folder))
        self.assertFalse(result.get('failed'), result)
        self.assertEqual(len(calls), 1); self.assertEqual(calls[0][-1], '--defer-verify')
        self.assertEqual(len(result['_document'].modelspace()), 2)
        self.assertEqual(result['after'], 2)
        self.assertIn('dxf_verify_read', result['timings_ms'])

    def test_primary_output_missing_an_entity_goes_to_the_verified_fallback(self):
        calls = []
        def run(args, **kwargs):
            calls.append(args)
            if len(calls) == 1:  # primary claims two lines but writes one
                return self.primary(args, {'Line': 2}, lambda m: m.add_line((0, 0), (1, 0)))
            return self.fallback(args, lambda m: (m.add_line((0, 0), (1, 0)), m.add_line((0, 1), (1, 1))))
        with tempfile.TemporaryDirectory() as folder, patch('batch_converter.subprocess.run', side_effect=run),              patch.dict('os.environ', {'LOCALAPPDATA': folder}):
            result = batch_converter.process(self.request(folder))
        self.assertFalse(result.get('failed'), result)
        self.assertEqual(len(calls), 2); self.assertIn('-o', calls[1])
        self.assertEqual(result['engine'], 'acadrust 0.6.4')
        self.assertEqual(len(result['_document'].modelspace()), 2)

    def run_both(self, folder, types, primary_draw, fallback_draw=None):
        calls = []
        def run(args, **kwargs):
            calls.append(args)
            if len(calls) == 1:
                return self.primary(args, types, primary_draw)
            if fallback_draw is None:
                return SimpleNamespace(returncode=1, stdout=b'')
            return self.fallback(args, fallback_draw)
        with patch('batch_converter.subprocess.run', side_effect=run), patch.dict('os.environ', {'LOCALAPPDATA': folder}):
            return batch_converter.process(self.request(folder))

    def test_partial_primary_keeps_auxiliary_memory_warning(self):
        with tempfile.TemporaryDirectory() as folder:
            memory_error = SimpleNamespace(returncode=-6, stdout=b'memory allocation of 4294967296 bytes failed')
            with patch('batch_converter._run_fallback', return_value=memory_error):
                result = self.run_both(folder, {'Line': 1, 'Wipeout': 1},
                                       lambda m: m.add_line((0, 0), (1, 0)))
            self.assertFalse(result.get('failed'), result)
            self.assertEqual(result['incomplete']['missingTypes'], {'WIPEOUT': 1})
            self.assertTrue(any(batch_converter.FALLBACK_MEMORY_WARNING in str(warning) for warning in result['warnings']))

    def test_import_opens_the_primary_reading_when_both_engines_lose_an_object_and_names_it(self):
        # ACadSharp reads WIPEOUT but cannot write it; acadrust fails. The drawing used to refuse to open.
        with tempfile.TemporaryDirectory() as folder:
            result = self.run_both(folder, {'Line': 2, 'Wipeout': 2},
                                   lambda m: (m.add_line((0, 0), (1, 0)), m.add_line((0, 1), (1, 1))))
            self.assertFalse(result.get('failed'), result)
            self.assertEqual(len(result['_document'].modelspace()), 2)
            self.assertEqual(result['incomplete'], {'engine': 'primary', 'missingTypes': {'WIPEOUT': 2}, 'extraTypes': {}})
            self.assertIn('가림막(WIPEOUT) 2개', result['warnings'][0])
            self.assertEqual(result['engine'], batch_converter.ENGINE_VERSION)

    def test_import_takes_the_reading_that_lost_fewer_objects(self):
        with tempfile.TemporaryDirectory() as folder:
            result = self.run_both(folder, {'Line': 3, 'Circle': 1},
                                   lambda m: m.add_line((0, 0), (1, 0)),
                                   lambda m: (m.add_line((0, 0), (1, 0)), m.add_line((0, 1), (1, 1)), m.add_line((0, 2), (1, 2))))
            self.assertFalse(result.get('failed'), result)
            self.assertEqual(result['engine'], 'acadrust 0.6.4')
            self.assertEqual(result['incomplete'], {'engine': 'fallback', 'missingTypes': {'CIRCLE': 1}, 'extraTypes': {}})
            self.assertEqual(len(result['_document'].modelspace()), 3)
            self.assertIn('원 1개', result['warnings'][0])

    def test_file_conversion_still_refuses_an_incomplete_result(self):
        with tempfile.TemporaryDirectory() as folder:
            request = {'action': 'convert', 'name': 'test.dwg', 'direction': 'dwg-dxf', 'folder': folder, '_raw': b'AC10-test', '_no_parallel_fallback': True}
            calls = []
            def run(args, **kwargs):
                calls.append(args)
                if len(calls) == 1:
                    return SimpleNamespace(returncode=1, stdout=json.dumps({'failed': True, 'inputTypes': {'Line': 1, 'Wipeout': 1}, 'warnings': []}).encode())
                return self.fallback(args, lambda m: m.add_line((0, 0), (1, 0)))
            with patch('batch_converter.subprocess.run', side_effect=run), patch.dict('os.environ', {'LOCALAPPDATA': folder}):
                result = batch_converter.process(request)
            self.assertTrue(result['failed'])
            self.assertEqual(result['verification']['missingTypes'], {'WIPEOUT': 1})
            self.assertFalse((Path(folder) / 'test.dxf').exists())

    def test_unwritable_types_check_the_secondary_first_and_skip_reading_the_primary(self):
        reads = []
        def reader(path):
            # ezdxf drops a REGION without ACIS data on reading; stand in for a real one.
            reads.append(Path(path).name)
            kinds = ['LINE', 'REGION'] if Path(path).name == 'verified-fallback.dxf' else ['LINE']
            entities = [SimpleNamespace(dxftype=lambda k=k: k) for k in kinds]
            return SimpleNamespace(modelspace=lambda: entities, blocks=[])
        with tempfile.TemporaryDirectory() as folder:
            request = {**self.request(folder), '_reader': reader}
            calls = []
            def run(args, **kwargs):
                calls.append(args)
                if len(calls) == 1:
                    return self.primary(args, {'Line': 1, 'Region': 1}, lambda m: m.add_line((0, 0), (1, 0)))
                return self.fallback(args, lambda m: m.add_line((0, 0), (1, 0)))
            # 빨리 세는 쪽도 같은 REGION 을 본다(실제 보조 결과에는 ACIS 가 있다).
            with patch('batch_converter.subprocess.run', side_effect=run), patch.dict('os.environ', {'LOCALAPPDATA': folder}), \
                 patch('batch_converter.fast_modelspace_types', return_value=Counter({'LINE': 1, 'REGION': 1})):
                result = batch_converter.process(request)
            self.assertFalse(result.get('failed'), result)
            self.assertEqual(result['engine'], 'acadrust 0.6.4'); self.assertIsNone(result['incomplete'])
            self.assertEqual(reads, ['verified-fallback.dxf'])

    def run_parallel(self, folder, types, primary_draw, fallback_draw, limit):
        """Primary via subprocess.run, the secondary engine started in parallel via Popen."""
        reads = []
        def reader(path):
            reads.append(Path(path).name); return ezdxf.readfile(path)
        class Early:
            def __init__(self, args, **kwargs):
                self.args = args; self.returncode = 0
                doc = ezdxf.new('R2018'); fallback_draw(doc.modelspace()); doc.saveas(Path(args[args.index('-o') + 1]))
            def communicate(self, timeout=None): return b'', None
            def poll(self): return 0
            def kill(self): pass
        request = {**self.request(folder), '_reader': reader, '_preservation_limit': limit}
        request.pop('_no_parallel_fallback')
        with patch('batch_converter.subprocess.run', side_effect=lambda args, **kw: self.primary(args, types, primary_draw)), \
             patch('batch_converter.subprocess.Popen', Early), patch.dict('os.environ', {'LOCALAPPDATA': folder}):
            return batch_converter.process(request), reads

    def test_a_large_drawing_missing_only_undrawn_regions_is_drawn_from_the_primary_reading(self):
        # REGIONs are never drawn, and a secondary DXF over the preservation limit is not kept
        # either: reading it would only cost time (90 s on a real 846k-object plan).
        with tempfile.TemporaryDirectory() as folder:
            result, reads = self.run_parallel(folder, {'Line': 1, 'Region': 2}, lambda m: m.add_line((0, 0), (1, 0)),
                                              lambda m: m.add_line((0, 0), (1, 0)), limit=10)
            self.assertFalse(result.get('failed'), result)
            self.assertEqual(result['engine'], batch_converter.ENGINE_VERSION)
            self.assertEqual(result['notDrawn'], {'REGION': 2}); self.assertIsNone(result['incomplete'])
            self.assertEqual(reads, ['output.dxf'])
            self.assertIn('영역(REGION) 2개', result['warnings'][0])

    def test_a_small_drawing_with_regions_still_keeps_the_complete_secondary_reading(self):
        with tempfile.TemporaryDirectory() as folder:
            result, reads = self.run_parallel(folder, {'Line': 1, 'Region': 1}, lambda m: m.add_line((0, 0), (1, 0)),
                                              lambda m: m.add_line((0, 0), (1, 0)), limit=10**9)
            self.assertIsNone(result.get('notDrawn'))
            # 보조 결과도 REGION 을 잃어 개수만 빨리 세어 보고(fallback_verify) 통째로 읽지 않는다(2026-10-30).
            self.assertIn('fallback_verify', result['timings_ms']); self.assertEqual(reads, ['output.dxf'])

    def test_unwritable_types_still_open_the_primary_reading_when_the_secondary_fails(self):
        with tempfile.TemporaryDirectory() as folder:
            result = self.run_both(folder, {'Line': 2, 'Region': 1},
                                   lambda m: (m.add_line((0, 0), (1, 0)), m.add_line((0, 1), (1, 1))))
            self.assertFalse(result.get('failed'), result)
            self.assertEqual(result['incomplete'], {'engine': 'primary', 'missingTypes': {'REGION': 1}, 'extraTypes': {}})
            self.assertEqual(len(result['_document'].modelspace()), 2)

    def test_inserts_of_missing_blocks_are_neither_missing_nor_extra(self):
        # The engine drops an INSERT whose block does not exist in the source; acadrust may keep it.
        with tempfile.TemporaryDirectory() as folder:
            calls = []
            def run(args, **kwargs):
                calls.append(args)
                doc = ezdxf.new('R2018'); doc.modelspace().add_line((0, 0), (1, 0)); doc.saveas(Path(args[2]))
                return SimpleNamespace(returncode=0, stdout=json.dumps({'before': 2, 'after': None, 'verificationDeferred': True,
                    'inputTypes': {'Line': 1}, 'invalidTypes': {'Insert': 1}, 'warnings': []}).encode())
            with patch('batch_converter.subprocess.run', side_effect=run), patch.dict('os.environ', {'LOCALAPPDATA': folder}):
                result = batch_converter.process(self.request(folder))
            self.assertFalse(result.get('failed'), result)
            self.assertIsNone(result['incomplete']); self.assertEqual(len(calls), 1)
            self.assertTrue(any('블록 정의가 없는 블록 참조 1개' in w for w in result['warnings']))
        self.assertEqual(batch_converter.count_difference(Counter({'LINE': 1}), Counter({'LINE': 1, 'INSERT': 1}), {'Insert': 1}), ({}, {}))
        self.assertEqual(batch_converter.count_difference(Counter({'LINE': 1}), Counter({'LINE': 1, 'INSERT': 2}), {'Insert': 1}), ({}, {'INSERT': 1}))

    def test_an_empty_secondary_result_for_an_unreadable_large_drawing_is_not_opened_as_a_blank_sheet(self):
        with tempfile.TemporaryDirectory() as folder:
            source = Path(folder) / 'big.dwg'; source.write_bytes(b'AC1015' + bytes(300_000))
            request = {**self.request(folder), '_source_path': str(source), 'name': 'big.dwg'}; request.pop('_raw')
            calls = []
            def run(args, **kwargs):
                calls.append(args)
                if len(calls) == 1:  # the primary engine cannot parse it: no counts
                    return SimpleNamespace(returncode=1, stdout=json.dumps({'failed': True, 'message': 'Attempted to read past the end of the stream.'}).encode())
                return self.fallback(args, lambda m: None)
            with patch('batch_converter.subprocess.run', side_effect=run), patch.dict('os.environ', {'LOCALAPPDATA': folder}):
                result = batch_converter.process(request)
            self.assertTrue(result['failed'], result)
            self.assertEqual(result['verification'], {'code': 'FALLBACK_EMPTY_RESULT'})

    def test_engine_names_map_to_the_dxf_types_ezdxf_reports(self):
        # A missing mapping made every drawing with an arc-length dimension fail verification.
        self.assertEqual(batch_converter.expected_dxf_types({'DimensionArc': 2, 'TableEntity': 1, 'Wipeout': 3, 'MultiLeader': 1}),
                         {'ARC_DIMENSION': 2, 'ACAD_TABLE': 1, 'WIPEOUT': 3, 'MULTILEADER': 1})

    def test_an_engine_without_the_option_is_rerun_with_its_own_verification(self):
        calls = []
        def run(args, **kwargs):
            calls.append(args)
            if '--defer-verify' in args:
                return SimpleNamespace(returncode=2, stdout=b'input output version required')
            doc = ezdxf.new('R2018'); doc.modelspace().add_line((0, 0), (1, 0)); doc.saveas(Path(args[2]))
            return SimpleNamespace(returncode=0, stdout=json.dumps({'before': 1, 'after': 1, 'warnings': []}).encode())
        with tempfile.TemporaryDirectory() as folder, patch('batch_converter.subprocess.run', side_effect=run),              patch.dict('os.environ', {'LOCALAPPDATA': folder}):
            result = batch_converter.process(self.request(folder))
        self.assertFalse(result.get('failed'), result)
        self.assertEqual(len(calls), 2); self.assertNotIn('--defer-verify', calls[1])
        self.assertNotIn('_document', result)


class FastFallbackCountTests(FallbackMockTests):
    """2026-10-30 주통(19만 객체): 보조 결과를 고르기 전에는 통째로 읽지 않고 개수만 센다(15초 → 1초)."""
    def fixture(self, path, crlf=False):
        doc = ezdxf.new('R2018'); msp = doc.modelspace()
        block = doc.blocks.new('B'); block.add_line((0, 0), (1, 0)); block.add_circle((0, 0), 1); block.add_attdef('T', (0, 0))
        for i in range(50): msp.add_line((i, 0), (i, 1))
        msp.add_blockref('B', (0, 0)).add_attrib('T', 'v', (0, 0))   # INSERT 뒤 ATTRIB·SEQEND
        msp.add_blockref('B', (5, 0))
        msp.add_polyline2d([(0, 0), (1, 1), (2, 0)]); msp.add_polyline3d([(0, 0, 0), (1, 1, 1)])   # VERTEX·SEQEND
        msp.add_lwpolyline([(0, 0), (1, 1)]); msp.add_text('0'); msp.add_text('  0'); msp.add_mtext('LINE')
        doc.layout('Layout1').add_line((0, 0), (1, 1)); doc.layout('Layout1').add_circle((0, 0), 2)   # 종이 공간은 세지 않는다
        doc.saveas(path)
        if crlf: path.write_bytes(path.read_bytes().replace(b'\r\n', b'\n').replace(b'\n', b'\r\n'))
        return Counter(e.dxftype() for e in ezdxf.readfile(path).modelspace())

    def test_fast_count_equals_ezdxf_modelspace_count(self):
        with tempfile.TemporaryDirectory() as folder:
            for crlf in (False, True):
                path = Path(folder) / f'f{crlf}.dxf'
                expected = self.fixture(path, crlf)
                self.assertEqual(batch_converter.fast_modelspace_types(path), expected)
                self.assertEqual(sum(expected.values()), 58)
            binary = Path(folder) / 'b.dxf'; binary.write_bytes(b'AutoCAD Binary DXF\r\n\x1a\x00')
            self.assertIsNone(batch_converter.fast_modelspace_types(binary))

    def test_fast_count_is_much_faster_than_a_full_read(self):
        import time
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'big.dxf'
            doc = ezdxf.new('R2018'); msp = doc.modelspace()
            for i in range(20000): msp.add_line((i, 0), (i, 1), dxfattribs={'layer': 'A-WALL'})
            doc.saveas(path)
            started = time.perf_counter(); fast = batch_converter.fast_modelspace_types(path); fast_s = time.perf_counter() - started
            started = time.perf_counter(); full = ezdxf.readfile(path); full_s = time.perf_counter() - started
            self.assertEqual(fast, Counter(e.dxftype() for e in full.modelspace()))
            self.assertLess(fast_s, full_s / 3, (fast_s, full_s))

    def test_a_fallback_that_lost_more_is_counted_but_never_read(self):
        reads = []
        def reader(path):
            reads.append(Path(path).name); return ezdxf.readfile(path)
        calls = []
        def run(args, **kwargs):
            calls.append(args)
            doc = ezdxf.new('R2018'); msp = doc.modelspace()
            if len(calls) == 1:   # 기본: 원 하나를 잃음
                for i in range(3): msp.add_line((i, 0), (i, 1))
                doc.saveas(Path(args[2]))
                return SimpleNamespace(returncode=0, stdout=json.dumps({'before': 4, 'after': None, 'verificationDeferred': True,
                                       'inputTypes': {'Line': 3, 'Circle': 1}, 'warnings': []}).encode())
            msp.add_line((0, 0), (1, 0)); doc.saveas(Path(args[args.index('-o') + 1]))   # 보조: 선 둘·원 하나를 잃음
            return SimpleNamespace(returncode=0, stdout=b'')
        with tempfile.TemporaryDirectory() as folder, patch('batch_converter.subprocess.run', side_effect=run), \
             patch.dict('os.environ', {'LOCALAPPDATA': folder}):
            result = batch_converter.process({'action': 'convert', 'name': 'test.dwg', 'direction': 'dwg-dxf', 'folder': folder, '_raw': b'AC10-test',
                                              '_no_parallel_fallback': True, '_defer_dxf_validation': True, '_keep_document': True, '_reader': reader})
        self.assertFalse(result.get('failed'), result)
        self.assertEqual(result['incomplete'], {'engine': 'primary', 'missingTypes': {'CIRCLE': 1}, 'extraTypes': {}})
        self.assertEqual(reads, ['output.dxf']); self.assertEqual(len(result['_document'].modelspace()), 3)


if __name__ == '__main__':
    unittest.main()
