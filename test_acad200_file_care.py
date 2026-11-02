"""ACAD200 영역 8 (엔진 쪽): 색인 줄(801)·압축 겹치기(803)·캐시 데우기(804)·구버전 미리 보기(806)·복구 읽기(809)·
대용량 복구 파일 이름(812)·교체 재시도와 이전 본(813)·DXF 미리보기 그림(815)·PDF 레이어(820)."""
import base64
import gzip
import io
import json
import os
import struct
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch

import ezdxf

import bridge
import file_care
import import_stream


def _doc(count=10):
    return {'units': 'mm', 'layers': [{'id': 'L0', 'name': '0'}, {'id': 'L1', 'name': 'A-WALL'}],
            'entities': [{'id': str(i), 'layer': 'L1' if i % 2 else 'L0', 'type': 'line' if i % 3 else 'circle',
                          **({'points': [{'x': i * 100.0, 'y': i * 50.0}, {'x': 0, 'y': 0}]} if i % 3 else {'center': {'x': i * 100.0, 'y': i * 50.0}, 'radius': 5})}
                         for i in range(count)]}


class IndexLineTest(unittest.TestCase):
    def test_801_index_comes_right_after_header_and_counts_everything(self):
        lines = list(import_stream.iter_lines({'document': _doc(10), 'report': {}}))
        index = json.loads(lines[1])
        self.assertEqual(index['kind'], 'index')
        self.assertEqual(index['entities'], 10)
        self.assertEqual(index['layers'], {'0': 5, 'A-WALL': 5})
        self.assertEqual(index['types'], {'circle': 4, 'line': 6})
        self.assertEqual(index['bounds'], [0.0, 0.0, 900.0, 450.0])
        self.assertEqual(sum(index['grid']['cells']), 10)
        end = json.loads(lines[-1])
        self.assertEqual(end['lines'], len(lines) - 1, '색인 줄도 무결성 줄 수에 들어간다')
        result = import_stream.assemble(json.loads(line) for line in lines)
        self.assertEqual(len(result['document']['entities']), 10)

    def test_801_large_drawing_samples_bounds_but_counts_all(self):
        index = import_stream.drawing_index(_doc(45000), sample=20000)
        self.assertEqual(index['entities'], 45000)
        self.assertTrue(index['grid']['sampled'])
        self.assertAlmostEqual(sum(index['grid']['cells']), 45000, delta=45000 * 0.01)
        self.assertEqual(sum(index['layers'].values()), 45000)

    def test_801_empty_drawing_has_no_index_line(self):
        lines = list(import_stream.iter_lines({'document': {'entities': []}, 'report': {}}))
        self.assertFalse(any(line.startswith(b'{"kind":"index"') for line in lines))


class PipelinedGzipTest(unittest.TestCase):
    def test_803_same_content_as_plain_gzip_and_complete(self):
        result = {'document': _doc(30000), 'report': {'x': 1}}
        with tempfile.TemporaryDirectory() as folder:
            target = Path(folder) / 'a.ndjson.gz'
            stats = import_stream.write_stream(result, target)
            self.assertTrue(import_stream.stream_is_complete(target))
            plain = b''.join(import_stream.iter_lines(result))
            self.assertEqual(gzip.decompress(target.read_bytes()), plain)
            self.assertEqual(stats['lines'], plain.count(b'\n'))

    def test_803_writer_error_is_raised_not_swallowed(self):
        class Broken(io.BytesIO):
            writes = 0

            def write(self, data):   # 머리(몇 바이트)는 쓰고, 압축 스레드가 쓰는 본문에서 디스크가 찬다
                Broken.writes += 1
                if Broken.writes > 9:
                    raise OSError(28, 'No space left on device')
                return super().write(data)
        writer = import_stream.PipelinedGzip(Broken())
        with self.assertRaises(OSError):
            for _ in range(8):
                writer.write(os.urandom(import_stream.PipelinedGzip.CHUNK + 1))   # 압축이 안 되는 본문이라 실제로 쓴다
            writer.close()


class ReplaceTest(unittest.TestCase):
    def test_813_previous_copy_is_a_link_and_keeps_old_bytes(self):
        with tempfile.TemporaryDirectory() as folder:
            target = Path(folder) / 'a.dxf'
            target.write_bytes(b'old')
            temp = Path(folder) / 'a.tmp'
            temp.write_bytes(b'new')
            how = file_care.keep_previous(target)
            self.assertIn(how, ('link', 'copy'))
            file_care.replace_with_retry(temp, target)
            self.assertEqual(target.read_bytes(), b'new')
            self.assertEqual((Path(folder) / 'a.dxf.previous').read_bytes(), b'old')
            self.assertIsNone(file_care.keep_previous(Path(folder) / '없음.dxf'))

    def test_813_retries_sharing_violation_200_400_800(self):
        waits = []
        calls = {'n': 0}

        def replace(a, b):
            calls['n'] += 1
            if calls['n'] < 3:
                raise PermissionError(13, 'locked by antivirus')
        self.assertEqual(file_care.replace_with_retry('t', 'x', sleep=waits.append, replace=replace), 3)
        self.assertEqual(waits, [0.2, 0.4])
        waits.clear()

        def always(a, b):
            raise PermissionError(13, 'locked')
        with self.assertRaises(PermissionError):
            file_care.replace_with_retry('t', 'x', sleep=waits.append, replace=always)
        self.assertEqual(waits, [0.2, 0.4, 0.8])

        def full(a, b):
            raise OSError(28, 'disk full')
        waits.clear()
        with self.assertRaises(OSError):
            file_care.replace_with_retry('t', 'x', sleep=waits.append, replace=full)
        self.assertEqual(waits, [], '디스크 가득은 기다려도 안 풀리므로 바로 알린다')

    def test_813_server_export_to_path_keeps_previous_and_warms_cache(self):
        import server
        with tempfile.TemporaryDirectory() as folder:
            target = Path(folder) / '평면.dxf'
            target.write_bytes(b'old')
            warmed = []
            with patch.object(file_care, 'warm_in_background', lambda path, fmt, warm, **k: warmed.append((Path(path).name, fmt))):
                result = server.export_to_path(b'new-content', str(target), 'dxf')
            self.assertEqual(result['bytes'], 11)
            self.assertEqual(target.read_bytes(), b'new-content')
            self.assertEqual((Path(folder) / '평면.dxf.previous').read_bytes(), b'old')
            self.assertEqual(warmed, [('평면.dxf', 'dxf')])


class WarmTest(unittest.TestCase):
    def test_804_only_small_dxf_dwg_and_once_per_file(self):
        with tempfile.TemporaryDirectory() as folder:
            small = Path(folder) / 'a.dxf'
            small.write_bytes(b'0' * 100)
            calls = []
            thread = file_care.warm_in_background(small, 'dxf', lambda p, ext: calls.append((p.name, ext)), max_bytes=1000)
            thread.join(5)
            self.assertEqual(calls, [('a.dxf', '.dxf')])
            self.assertIsNone(file_care.warm_in_background(small, 'bcad', lambda *a: None, max_bytes=1000))
            self.assertIsNone(file_care.warm_in_background(small, 'dxf', lambda *a: None, max_bytes=10), '크기 한도를 넘으면 데우지 않는다')
            self.assertIsNone(file_care.warm_in_background(small, 'dxf', lambda *a: None, max_bytes=0), '0 이면 끔')
            gate = []
            slow = file_care.warm_in_background(small, 'dxf', lambda *a: (gate.append(1), time.sleep(0.3)), max_bytes=1000)
            self.assertIsNone(file_care.warm_in_background(small, 'dxf', lambda *a: None, max_bytes=1000), '같은 파일을 겹쳐 데우지 않는다')
            slow.join(5)

    def test_804_cache_limits_come_from_environment(self):
        import importlib
        import server
        with patch.dict(os.environ, {'BARUN_IMPORT_CACHE_KEEP': '3', 'BARUN_IMPORT_CACHE_MAX_MB': '50'}):
            reloaded = importlib.reload(server)
            self.assertEqual(reloaded.IMPORT_CACHE_KEEP, 3)
            self.assertEqual(reloaded.IMPORT_CACHE_MAX_BYTES, 50_000_000)
        importlib.reload(server)


class VersionPreviewTest(unittest.TestCase):
    def test_806_lists_only_losses(self):
        preview = file_care.version_loss_preview(lambda: (b'', ['선종류 대체', '구버전(2004) 저장: MULTILEADER 2개를 기본 객체로 바꿨습니다.', '구버전(2004) 저장: 기본 객체와 배치·블록을 유지했습니다.']))
        self.assertEqual(preview, {'dryRun': True, 'ok': True, 'lost': ['구버전(2004) 저장: MULTILEADER 2개를 기본 객체로 바꿨습니다.']})

        def blocked():
            raise ValueError('구버전 DXF로 바꿀 수 없는 객체(3DSOLID)')
        self.assertEqual(file_care.version_loss_preview(blocked)['ok'], False)

    def test_806_real_export_dry_run_on_simple_drawing(self):
        import exchange
        model = {'units': 'mm', 'layers': [{'id': 'L0', 'name': '0', 'color': '#ffffff'}], 'entities': [{'id': 'a', 'layer': 'L0', 'type': 'line', 'points': [{'x': 0, 'y': 0}, {'x': 10, 'y': 0}]}]}
        preview = file_care.version_loss_preview(lambda: exchange.export_dxf(model, 'R2004'))
        self.assertTrue(preview['ok'])
        self.assertEqual(preview['lost'], [])


def _dib(width=16, height=8):
    row = ((width + 31) // 32) * 4
    header = struct.pack('<IiiHHIIiiII', 40, width, height, 1, 1, 0, row * height, 2835, 2835, 2, 2)
    return header + bytes([255, 255, 255, 0, 0, 0, 0, 0]) + b'\x80' * (row * height)


class ThumbnailTest(unittest.TestCase):
    def test_815_section_before_eof_and_ezdxf_reads_it(self):
        doc = ezdxf.new('R2018')
        doc.modelspace().add_line((0, 0), (100, 0))
        stream = io.StringIO()
        doc.write(stream)
        content = stream.getvalue().encode('utf-8')
        out = file_care.add_dxf_thumbnail(content, base64.b64encode(_dib()).decode())
        self.assertIn(b'THUMBNAILIMAGE', out)
        self.assertTrue(out.rstrip().endswith(b'EOF'))
        self.assertLess(out.index(b'THUMBNAILIMAGE'), out.rindex(b'EOF'))
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 't.dxf'
            path.write_bytes(out)
            again = ezdxf.readfile(path)
            self.assertEqual(len(again.modelspace()), 1)
        self.assertEqual(file_care.add_dxf_thumbnail(out, base64.b64encode(_dib()).decode()), out, '이미 있으면 그대로')
        self.assertEqual(file_care.add_dxf_thumbnail(content, base64.b64encode(b'not a bmp' * 10).decode()), content)
        bm = b'BM' + b'\x00' * 12 + _dib()
        self.assertIsNotNone(file_care.thumbnail_dib(base64.b64encode(bm).decode()), 'BM 파일 머리가 있어도 받는다')


class RecoverImportTest(unittest.TestCase):
    def test_809_recover_mode_reports_salvage(self):
        import exchange
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'r.dxf'
            doc = ezdxf.new('R2018')
            doc.header['$INSUNITS'] = 4
            doc.modelspace().add_line((0, 0), (100, 0))
            doc.modelspace().add_circle((0, 0), 5)
            doc.saveas(path)
            result = exchange.import_file_path(path, '.dxf', recover=True)
            recovery = result['report']['recovery']
            self.assertEqual(recovery['mode'], 'salvage')
            self.assertIn('auditErrors', recovery)
            self.assertGreaterEqual(recovery['imported'], 2)
            normal = exchange.import_file_path(path, '.dxf')
            self.assertNotIn('recovery', normal['report'])


class LargeRecoveryNameTest(unittest.TestCase):
    def test_812_drawing_name_in_file_and_newest_kept_per_drawing(self):
        self.assertEqual(bridge.large_drawing_label('a/b:c 평면.'), 'a_b_c 평면')
        self.assertEqual(bridge.large_drawing_of(Path('recovery-1-large-20261014T000000Z-abcd-1층-평면.ndjson.gz')), '1층-평면')
        self.assertEqual(bridge.large_drawing_of(Path('recovery-1-large-20261014T000000Z-abcd.ndjson.gz')), '')
        self.assertEqual(bridge.large_session_of(Path('recovery-1-large-20261014T000000Z-abcd-1층-평면.ndjson.gz')), 'abcd', '세션 읽기는 예전 그대로')
        with tempfile.TemporaryDirectory() as folder, patch.object(bridge, 'RECOVERY', Path(folder) / 'recovery-1.json'):
            def store(name, client='abcd1234'):
                body = b''.join(import_stream.iter_lines({'document': _doc(3), 'report': {'client': client, 'drawingName': name, 'dirty': True}}))
                return bridge.store_large_recovery(io.BytesIO(body), len(body))
            first = store('A동.dwg')
            time.sleep(1.1)
            store('B동.dwg')
            time.sleep(1.1)
            store('B동.dwg')
            names = sorted(p.name for p in bridge.large_recovery_files())
            self.assertTrue(any('A동.dwg' in n for n in names), names)
            self.assertIn('A동.dwg', Path(first['path']).name)
            sources = bridge.recovery_sources()
            self.assertEqual({s['drawingName'] for s in sources if s['kind'] == 'large'}, {'A동.dwg', 'B동.dwg'})

    def test_saved_drawing_large_recovery_is_not_offered_as_unsaved(self):
        # 감사 5: 대용량 복구본은 늘 dirty 로 적히므로, 그 뒤에 도면 파일이 저장됐으면 미저장 작업으로 내놓지 않는다.
        with tempfile.TemporaryDirectory() as folder, patch.object(bridge, 'RECOVERY', Path(folder) / 'recovery-1.json'):
            drawing = Path(folder) / '단지.dxf'
            drawing.write_bytes(b'old')
            body = b''.join(import_stream.iter_lines({'document': _doc(3), 'report': {'client': 'abcd1234', 'drawingName': '단지.dxf', 'drawingPath': str(drawing), 'dirty': True}}))
            stored = Path(bridge.store_large_recovery(io.BytesIO(body), len(body))['path'])
            os.utime(drawing, (stored.stat().st_mtime - 60,) * 2)
            large = lambda: [(s['dirty'], s['fileNewer']) for s in bridge.recovery_sources() if s['kind'] == 'large']
            self.assertEqual(large(), [(True, False)], '저장 전: 미저장, 자동으로 권함')
            os.utime(drawing, (stored.stat().st_mtime + 60,) * 2)
            self.assertEqual(large(), [(True, True)], '파일이 더 새로움: 목록에는 남고(검토 A8) 자동으로 권하지만 않음')


class PdfLayerTest(unittest.TestCase):
    def test_820_optional_content_groups_become_layer_names(self):
        from pypdf import PdfWriter
        from pypdf.generic import ArrayObject, DecodedStreamObject, DictionaryObject, NameObject, TextStringObject
        import pdf_import
        writer = PdfWriter()
        page = writer.add_blank_page(width=200, height=200)
        ocg = writer._add_object(DictionaryObject({NameObject('/Type'): NameObject('/OCG'), NameObject('/Name'): TextStringObject('벽체')}))
        resources = DictionaryObject({NameObject('/Properties'): DictionaryObject({NameObject('/MC0'): ocg})})
        page[NameObject('/Resources')] = resources
        content = DecodedStreamObject()
        content.set_data(b'/OC /MC0 BDC 0 0 m 100 0 l S EMC 0 50 m 100 50 l S')
        page[NameObject('/Contents')] = writer._add_object(content)
        writer._root_object[NameObject('/OCProperties')] = DictionaryObject({NameObject('/OCGs'): ArrayObject([ocg])})
        data = io.BytesIO()
        writer.write(data)
        result = pdf_import.import_pdf_page(data.getvalue(), 0, 1.0, text=False)
        layers = [e.get('pdfLayer') for e in result['entities']]
        self.assertEqual(layers, ['벽체', None])
        self.assertEqual(result['report']['pdfLayers'], {'벽체': 1})


if __name__ == '__main__':
    unittest.main()
