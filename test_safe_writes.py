"""Save transaction regression tests; no Electron or live application access."""
import json
import os
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch

import file_care
import project


class PreviousVersionTests(unittest.TestCase):
    def test_project_does_not_replace_existing_previous(self):
        with tempfile.TemporaryDirectory() as directory:
            p = Path(directory) / 'drawing.dxf'
            old = p.with_name(p.name + '.previous')
            old.write_bytes(b'first')
            p.write_bytes(b'second')
            project.save(directory, p.name, b'third')
            self.assertEqual(old.read_bytes(), b'first')
            self.assertIn(b'second', [x.read_bytes() for x in p.parent.glob('drawing.dxf.previous*')])

    def test_file_care_does_not_replace_existing_previous(self):
        with tempfile.TemporaryDirectory() as directory:
            p = Path(directory) / 'drawing.dxf'
            old = p.with_name(p.name + '.previous')
            old.write_bytes(b'first')
            p.write_bytes(b'second')
            self.assertIn(file_care.keep_previous(p), ('link', 'copy'))
            self.assertEqual(old.read_bytes(), b'first')
            self.assertIn(b'second', [x.read_bytes() for x in p.parent.glob('drawing.dxf.previous*')])


class SafeWritesTests(unittest.TestCase):
    def setUp(self):
        import safe_writes
        self.api = safe_writes
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.target = Path(self.directory.name) / 'drawing.dxf'

    def test_existing_file_change_during_confirmation_is_rejected(self):
        self.target.write_bytes(b'approved')
        with self.api.reserve(self.target) as tx:
            self.assertTrue(tx.existed)
            self.target.write_bytes(b'changed by another program')
            with self.assertRaises(self.api.SaveConflict):
                tx.save(b'new')
        self.assertEqual(self.target.read_bytes(), b'changed by another program')
        self.assertFalse(list(self.target.parent.glob('.cad-*')))

    def test_absent_file_appearing_during_conversion_is_rejected(self):
        with self.api.reserve(self.target) as tx:
            self.assertFalse(tx.existed)
            self.target.write_bytes(b'created externally')
            with self.assertRaises(self.api.SaveConflict):
                tx.save(b'new')
        self.assertEqual(self.target.read_bytes(), b'created externally')

    def test_deleted_approved_file_is_rejected(self):
        self.target.write_bytes(b'approved')
        with self.api.reserve(self.target) as tx:
            self.target.unlink()
            with self.assertRaises(self.api.SaveConflict):
                tx.save(b'new')
        self.assertFalse(self.target.exists())

    def test_login_or_cancel_callback_is_rechecked_before_replace(self):
        self.target.write_bytes(b'old')
        calls = []
        def authorized():
            calls.append(1)
            if len(calls) > 1:
                raise PermissionError('logged out')
        with self.api.reserve(self.target, assert_current=authorized) as tx:
            with self.assertRaises(PermissionError):
                tx.save(b'new')
        self.assertEqual(self.target.read_bytes(), b'old')
        self.assertFalse(tx.lock_path.exists())
        self.assertFalse(list(self.target.parent.glob('.cad-*')))

    def test_two_processes_cannot_reserve_same_target(self):
        with self.api.reserve(self.target) as tx:
            code = "import safe_writes,sys; tx=safe_writes.reserve(sys.argv[1]); tx.__enter__()"
            result = subprocess.run([sys.executable, '-X', 'utf8', '-c', code, str(self.target)],
                                    cwd=Path(__file__).parent, capture_output=True, text=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn('SaveBusy', result.stderr)
        with self.api.reserve(self.target) as tx:
            tx.save(b'ok')
        self.assertEqual(self.target.read_bytes(), b'ok')

    def test_stale_lock_is_reported_without_stealing_it(self):
        lock = self.api.lock_path(self.target)
        lock.write_text(json.dumps({'pid': -1, 'created': time.time() - 999999}), encoding='utf-8')
        before = lock.read_bytes()
        with self.assertRaises(self.api.SaveBusy) as caught:
            with self.api.reserve(self.target):
                pass
        self.assertIn('stale', str(caught.exception).lower())
        self.assertEqual(lock.read_bytes(), before)
        lock.unlink()

    def test_context_abort_releases_reservation(self):
        with self.assertRaises(RuntimeError):
            with self.api.reserve(self.target) as tx:
                raise RuntimeError('cancelled')
        self.assertFalse(tx.lock_path.exists())
        with self.api.reserve(self.target):
            pass

    def test_project_uses_reserved_version_and_authorization(self):
        calls = []
        with self.api.reserve(self.target) as tx:
            result = project.save(self.directory.name, self.target.name, b'new',
                                  transaction=tx, assert_current=lambda: calls.append(1))
        self.assertEqual(result['bytes'], 3)
        self.assertTrue(calls)
        self.assertEqual(self.target.read_bytes(), b'new')

    def test_project_rejects_wrong_reservation(self):
        with self.api.reserve(self.target) as tx:
            with self.assertRaises(ValueError):
                project.save(self.directory.name, 'other.dxf', b'bad', transaction=tx)
        self.assertFalse((self.target.parent / 'other.dxf').exists())

    def test_backup_failure_blocks_replace(self):
        self.target.write_bytes(b'old')
        with self.api.reserve(self.target) as tx:
            with patch.object(file_care, 'keep_previous', return_value=None):
                with self.assertRaises(OSError):
                    tx.save(b'new')
        self.assertEqual(self.target.read_bytes(), b'old')

    def test_change_during_backup_is_rechecked(self):
        self.target.write_bytes(b'old')
        def race(*args, **kwargs):
            self.target.write_bytes(b'external edit')
            return 'copy'
        with self.api.reserve(self.target) as tx:
            with patch.object(file_care, 'keep_previous', side_effect=race):
                with self.assertRaises(self.api.SaveConflict):
                    tx.save(b'new')
        self.assertEqual(self.target.read_bytes(), b'external edit')

    def test_retries_recheck_authorization(self):
        self.target.write_bytes(b'old')
        allowed = [True]
        def authorized():
            if not allowed[0]:
                raise PermissionError('cancelled')
        calls = []
        def busy(source, destination):
            calls.append(1)
            allowed[0] = False
            raise PermissionError('busy')
        with self.api.reserve(self.target, assert_current=authorized) as tx:
            with patch.object(self.api.os, 'replace', side_effect=busy), patch.object(self.api.time, 'sleep'):
                with self.assertRaises(PermissionError):
                    tx.save(b'new')
        self.assertEqual(len(calls), 1)
        self.assertEqual(self.target.read_bytes(), b'old')

    def test_converter_temporary_is_removed_on_cancel(self):
        temporary = self.target.parent / '.cad-converted'
        temporary.write_bytes(b'converted')
        with self.api.reserve(self.target) as tx:
            def cancelled():
                raise PermissionError('cancelled')
            with self.assertRaises(PermissionError):
                tx.commit_temp(temporary, assert_current=cancelled)
        self.assertFalse(temporary.exists())
        self.assertFalse(self.target.exists())

    def test_converter_temporary_is_committed(self):
        temporary = self.target.parent / '.cad-converted'
        temporary.write_bytes(b'converted')
        with self.api.reserve(self.target) as tx:
            result = tx.commit_temp(temporary)
        self.assertEqual(result['bytes'], 9)
        self.assertEqual(self.target.read_bytes(), b'converted')
        self.assertFalse(temporary.exists())

    def test_copy_fallback_preserves_existing_backups(self):
        self.target.write_bytes(b'second')
        old = self.target.with_name(self.target.name + '.previous')
        old.write_bytes(b'first')
        with patch.object(file_care.os, 'link', side_effect=OSError('no links')):
            with self.api.reserve(self.target) as tx:
                tx.save(b'third')
        self.assertEqual(old.read_bytes(), b'first')
        self.assertIn(b'second', [p.read_bytes() for p in self.target.parent.glob('*.previous*')])

    def test_committed_transaction_cannot_be_reused(self):
        with self.api.reserve(self.target) as tx:
            tx.save(b'one')
            with self.assertRaises(RuntimeError):
                tx.save(b'two')
        self.assertEqual(self.target.read_bytes(), b'one')


if __name__ == '__main__':
    unittest.main()
