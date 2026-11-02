"""Concurrent-save security regression, isolated temporary files only."""
import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import patch

import safe_writes


class SaveReservationIntegrationTests(unittest.TestCase):
    def test_duplicate_token_transaction_commits_only_once(self):
        with tempfile.TemporaryDirectory() as folder:
            target = Path(folder) / 'new.dxf'
            first = Path(folder) / 'first.tmp'
            second = Path(folder) / 'second.tmp'
            first.write_bytes(b'first approved save')
            second.write_bytes(b'duplicate request')
            entered = threading.Event()
            release = threading.Event()
            second_started = threading.Event()
            second_done = threading.Event()
            results = []
            original_replace = safe_writes.os.replace
            replacements = []

            def replace(source, destination):
                replacements.append(str(source))
                if Path(source).resolve() == first.resolve():  # 맥 /var → /private/var
                    entered.set()
                    if not release.wait(5):
                        raise AssertionError('first replacement not released')
                original_replace(source, destination)

            def commit(transaction, temporary, duplicate=False):
                if duplicate:
                    second_started.set()
                try:
                    results.append(('saved', transaction.commit_temp(temporary)))
                except Exception as error:
                    results.append(('error', error))
                finally:
                    if duplicate:
                        second_done.set()

            with safe_writes.reserve(target) as reservation, patch.object(safe_writes.os, 'replace', replace):
                threads = [threading.Thread(target=commit, args=(reservation, first)),
                           threading.Thread(target=commit, args=(reservation, second, True))]
                threads[0].start()
                try:
                    self.assertTrue(entered.wait(3))
                    threads[1].start()
                    self.assertTrue(second_started.wait(3))
                    # Old code writes the duplicate while the first replace is held.
                    self.assertFalse(second_done.wait(.2), 'the same reservation was concurrently reusable')
                    self.assertTrue(safe_writes.lock_path(target).exists())
                finally:
                    release.set()
                    for thread in threads:
                        if thread.ident is not None:
                            thread.join(5)
                self.assertTrue(all(not thread.is_alive() for thread in threads))
                self.assertEqual(sum(kind == 'saved' for kind, _ in results), 1)
                self.assertEqual(sum(kind == 'error' for kind, _ in results), 1)
                self.assertEqual(len(replacements), 1)
                self.assertEqual(target.read_bytes(), b'first approved save')
                self.assertFalse(first.exists())
                self.assertFalse(second.exists())
            self.assertFalse(safe_writes.lock_path(target).exists())

    def test_cancel_close_waits_until_active_commit_finishes(self):
        with tempfile.TemporaryDirectory() as folder:
            target = Path(folder) / 'new.dxf'
            temporary = Path(folder) / 'save.tmp'
            temporary.write_bytes(b'approved')
            entered, release, closed = threading.Event(), threading.Event(), threading.Event()
            original_replace = safe_writes.os.replace
            errors = []
            reservation = safe_writes.reserve(target)
            reservation.__enter__()

            def replace(source, destination):
                entered.set()
                if not release.wait(5):
                    raise AssertionError('replacement not released')
                original_replace(source, destination)

            def commit():
                try:
                    reservation.commit_temp(temporary)
                except Exception as error:
                    errors.append(error)

            def close():
                reservation.close()
                closed.set()

            with patch.object(safe_writes.os, 'replace', replace):
                writer, closer = threading.Thread(target=commit), threading.Thread(target=close)
                writer.start()
                try:
                    self.assertTrue(entered.wait(3))
                    closer.start()
                    self.assertFalse(closed.wait(.2), 'cancellation released the file lock before replacement')
                    with self.assertRaises(safe_writes.SaveBusy):
                        with safe_writes.reserve(target):
                            pass
                finally:
                    release.set()
                    writer.join(5)
                    if closer.ident is not None:
                        closer.join(5)
                    reservation.close()
            self.assertEqual(errors, [])
            self.assertTrue(closed.is_set())
            self.assertEqual(target.read_bytes(), b'approved')


if __name__ == '__main__':
    unittest.main()
