"""Save timing regressions use actual transactions; no timing thresholds or live app."""
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import batch_converter
import exchange
import file_care
import project
import safe_writes
import server
from test_critic_e import LiveServer
from test_critic_e2 import SECRET, register


def drawing(count=3):
    return {'version': 2, 'units': 'mm', 'layers': [{'id': 'A-WALL', 'name': 'A-WALL', 'color': '#ffffff'}],
            'blocks': [], 'entities': [{'id': str(i), 'type': 'line', 'layer': 'A-WALL',
            'points': [{'x': i, 'y': 0}, {'x': i, 'y': 10}]} for i in range(count)]}


class SaveTimingsTest(unittest.TestCase):
    def assert_times(self, timings, keys):
        for key in keys:
            self.assertIn(key, timings)
            self.assertIsInstance(timings[key], (int, float))
            self.assertGreaterEqual(timings[key], 0)

    def test_first_and_second_overwrite_report_backup_method_and_each_disk_stage(self):
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / 'drawing.dxf'
            target.write_bytes(b'original')
            for data in (b'first', b'second'):
                result = project.save(directory, target.name, data)
                self.assert_times(result['timings_ms'], ('reserve', 'temp_write', 'temp_sync', 'backup', 'replace', 'save_total'))
                self.assertIn(result['backup_method'], ('link', 'copy'))
                self.assertEqual(result['replace_attempts'], 1)
            self.assertEqual(target.with_name(target.name + '.previous').read_bytes(), b'original')

    def test_copy_fallback_is_reported_and_new_file_does_not_back_up(self):
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / 'drawing.dxf'
            result = project.save(directory, target.name, b'original')
            self.assertEqual(result['backup_method'], 'none')
            with patch.object(file_care.os, 'link', side_effect=OSError('links unsupported')):
                result = project.save(directory, target.name, b'new')
            self.assertEqual(result['backup_method'], 'copy')
            self.assert_times(result['timings_ms'], ('backup',))

    def test_dxf_reports_serialization_and_verification_without_mutating_the_model(self):
        import copy
        model = drawing(); before = copy.deepcopy(model); timings = {}
        raw, warnings = exchange.export_dxf(model, timings_ms=timings)
        self.assert_times(timings, ('dxf_build', 'dxf_temp_write', 'dxf_verify_read', 'dxf_metadata', 'dxf_read_bytes', 'dxf_total'))
        self.assertEqual(model, before)
        self.assertTrue(raw.startswith(b'  0'))
        self.assertEqual(len(exchange.import_file(raw, '.dxf')['document']['entities']), 3)

    def test_dwg_save_keeps_existing_engine_timings(self):
        def convert(data):
            out = Path(data['folder']) / 'save.dwg'; out.write_bytes(b'AC1032test')
            return {'path': str(out), 'timings_ms': {'process_start': 91, 'dxf_verify_read': 7}, 'after': 3}
        with patch.object(batch_converter, 'process', side_effect=convert):
            _, info = batch_converter.dxf_to_dwg(b'0\nEOF\n')
        self.assertEqual(info['timings_ms']['process_start'], 91)
        self.assertEqual(info['timings_ms']['dxf_verify_read'], 7)
        self.assert_times(info['timings_ms'], ('dwg_save_total', 'dwg_temp_write', 'dwg_read_bytes'))

    def test_dwg_response_keeps_both_dxf_and_converter_verification_times(self):
        def serialize(model, version, timings_ms=None):
            timings_ms['dxf_verify_read'] = 3
            return b'dxf', []
        info = {'warnings': [], 'timings_ms': {'dxf_verify_read': 7, 'process_start': 91}}
        with patch.object(exchange, 'export_dxf', side_effect=serialize), \
                patch.object(batch_converter, 'dxf_to_dwg', return_value=(b'AC1032test', info)), LiveServer() as live:
            status, _, result = live.post('export', {'document': drawing(), 'format': 'dwg'})
        self.assertEqual(status, 200, result)
        self.assertEqual(result['timings_ms']['dxf_verify_read'], 3)
        self.assertEqual(result['timings_ms']['converter_dxf_verify_read'], 7)
        self.assertEqual(result['dwg']['timings_ms']['dxf_verify_read'], 7)

    def test_real_dwg_reports_input_preparation_and_process_overhead(self):
        raw, _ = exchange.export_dxf(drawing())
        _, info = batch_converter.dxf_to_dwg(raw)
        self.assert_times(info['timings_ms'], ('engine_dxf_prepare', 'process_start', 'csharp_total',
                                              'engine_process_overhead', 'dxf_verify_read'))
        self.assertLessEqual(info['timings_ms']['engine_process_overhead'], info['timings_ms']['process_start'])

    def test_export_response_merges_serialization_and_transaction_timings(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(server, 'SHELL_SECRET', SECRET), \
                patch.object(file_care, 'warm_in_background'), LiveServer() as live:
            target = Path(directory) / 'drawing.dxf'; target.write_bytes(b'original')
            status, registration = register(live, str(target), 'dxf')
            self.assertEqual(status, 200)
            status, _, result = live.post('export', {'document': drawing(), 'saveToken': registration['saveToken']})
            self.assertEqual(status, 200, result)
            self.assert_times(result['timings_ms'], ('serialize', 'dxf_verify_read', 'temp_write', 'backup', 'replace', 'export_total'))
            self.assertEqual(target.with_name(target.name + '.previous').read_bytes(), b'original')

    def test_temporary_is_synced_once_before_backup_and_atomic_replace(self):
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / 'drawing.dxf'; target.write_bytes(b'original')
            events = []
            real_sync, real_backup, real_replace = os.fsync, file_care.keep_previous, os.replace
            def sync(fd):
                events.append('sync'); return real_sync(fd)
            def backup(*args):
                events.append('backup'); return real_backup(*args)
            def replace(*args):
                events.append('replace'); return real_replace(*args)
            with safe_writes.reserve(target) as transaction:
                with patch.object(os, 'fsync', side_effect=sync), \
                        patch.object(file_care, 'keep_previous', side_effect=backup), \
                        patch.object(os, 'replace', side_effect=replace):
                    transaction.save(b'new')
            # The lock's sync happened before this patch. POSIX also syncs the directory.
            self.assertEqual(events[:3], ['sync', 'backup', 'replace'])
            self.assertEqual(events.count('sync'), 1 if os.name == 'nt' else 2)
            self.assertEqual(target.read_bytes(), b'new')
            self.assertEqual(target.with_name(target.name + '.previous').read_bytes(), b'original')

    def test_temp_sync_failure_preserves_original_and_existing_previous(self):
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / 'drawing.dxf'; target.write_bytes(b'original')
            previous = target.with_name(target.name + '.previous'); previous.write_bytes(b'older')
            with safe_writes.reserve(target) as transaction:
                with patch.object(os, 'fsync', side_effect=OSError('injected sync failure')), \
                        patch.object(os, 'replace') as replace:
                    with self.assertRaisesRegex(OSError, 'sync failure'): transaction.save(b'new')
                    replace.assert_not_called()
            self.assertEqual(target.read_bytes(), b'original')
            self.assertEqual(previous.read_bytes(), b'older')
            self.assertFalse(list(Path(directory).glob('.cad-*')))

    def test_partial_temp_write_failure_preserves_original_and_existing_previous(self):
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / 'drawing.dxf'; target.write_bytes(b'original')
            previous = target.with_name(target.name + '.previous'); previous.write_bytes(b'older')
            real_fdopen = os.fdopen
            class BrokenWrite:
                def __init__(self, stream): self.stream = stream
                def __enter__(self): return self
                def __exit__(self, *args): self.stream.close()
                def write(self, data):
                    self.stream.write(data[:2]); self.stream.flush()
                    raise OSError('injected disk full')
            def fdopen(fd, mode, *args, **kwargs):
                stream = real_fdopen(fd, mode, *args, **kwargs)
                return BrokenWrite(stream) if mode == 'wb' else stream
            with safe_writes.reserve(target) as transaction:
                with patch.object(safe_writes.os, 'fdopen', side_effect=fdopen):
                    with self.assertRaisesRegex(OSError, 'disk full'): transaction.save(b'new drawing')
            self.assertEqual(target.read_bytes(), b'original')
            self.assertEqual(previous.read_bytes(), b'older')
            self.assertFalse(list(Path(directory).glob('.cad-*')))
            self.assertFalse(safe_writes.lock_path(target).exists())


if __name__ == '__main__':
    unittest.main()
