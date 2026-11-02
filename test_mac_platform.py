"""macOS 대응 1단계 검사: 저장 경로 규칙(운영체제별)과 계정 토큰 보관(macOS 키체인).

실제 키체인은 건드리지 않는다. security 명령은 가짜로 바꿔 열쇠 생성·재사용·손상 처리만 확인한다.
"""
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import miri_account_service as account
import server


class SavePathTest(unittest.TestCase):
    def test_windows_rules_reject_posix_and_unsafe_paths(self):
        for path in ('/Users/me/plan.dxf', 'relative.dxf', '\\\\host\\share\\x.dxf', 'C:\\work\\..\\x.dxf', 'C:\\work\\a.dxf:stream', 'C:\\work\\bad?.dxf'):
            with self.assertRaises(ValueError, msg=path): server.validate_save_path(path, 'dxf', windows=True)

    def test_posix_rules_reject_unsafe_paths(self):
        with tempfile.TemporaryDirectory() as folder:
            for name in ('con.dxf', 'LPT1.tmp.dxf', 'a.dxf:stream', 'bad?.dxf', 'a\\b.dxf', 'x.exe', 'x.bcad'):
                with self.assertRaises(ValueError, msg=name): server.validate_save_path(folder + '/' + name, 'dxf', windows=False)
            for path in ('C:\\work\\plan.dxf', 'relative.dxf', '//host/share/x.dxf', folder + '/../x.dxf', folder + '/./x.dxf', folder + '/missing/x.dxf'):
                with self.assertRaises(ValueError, msg=path): server.validate_save_path(path, 'dxf', windows=False)

    @unittest.skipIf(os.name == 'nt', 'POSIX 경로는 macOS 에서만 실제 폴더로 확인한다')
    def test_posix_rules_accept_absolute_paths_with_mac_folder_names(self):
        with tempfile.TemporaryDirectory() as folder:
            nested = Path(folder) / '작업 폴더 ' / 'a:b'   # 끝 공백·콜론이 있는 폴더 이름은 macOS 에서 정상
            nested.mkdir(parents=True)
            self.assertEqual(server.validate_save_path(str(nested / '평면도.dxf'), 'dxf'), nested / '평면도.dxf')
            self.assertEqual(server.validate_save_path(str(nested / 'console.bcad'), 'bcad'), nested / 'console.bcad')


class FakeSecurity:
    """/usr/bin/security 흉내: find-generic-password -w 와 -i(표준 입력의 add-generic-password)만."""
    def __init__(self, stored=None, fail=False):
        self.stored, self.fail, self.calls = stored, fail, []

    def __call__(self, args, input=None, **_kwargs):
        self.calls.append((args, input))
        if self.fail: return subprocess.CompletedProcess(args, 51, '', 'User interaction is not allowed.')
        if args[1] == 'find-generic-password':
            if self.stored is None: return subprocess.CompletedProcess(args, 44, '', 'not found')
            return subprocess.CompletedProcess(args, 0, self.stored + '\n', '')
        if args[1] == '-i':
            words = input.split()
            self.stored = words[words.index('-w') + 1]
            return subprocess.CompletedProcess(args, 0, '', '')
        raise AssertionError(args)


@unittest.skipUnless(sys.platform == 'darwin', 'macOS 키체인 경로')
class KeychainTokenTest(unittest.TestCase):
    def test_token_round_trip_creates_key_once_and_never_puts_it_in_arguments(self):
        fake = FakeSecurity()
        with tempfile.TemporaryDirectory() as folder, patch.object(account, 'TOKEN_FILE', Path(folder) / 'account-token.bin'), patch('subprocess.run', fake):
            account._save_token('a' * 64)
            self.assertEqual(account._load_token(), 'a' * 64)
            account._save_token('b' * 64)
            self.assertEqual(account._load_token(), 'b' * 64)
            self.assertNotIn(b'a' * 64, account.TOKEN_FILE.read_bytes())
        adds = [call for call in fake.calls if call[0][1] == '-i']
        self.assertEqual(len(adds), 1)
        self.assertTrue(all(fake.stored not in ' '.join(args) for args, _ in fake.calls))

    def test_missing_or_replaced_key_drops_the_saved_token(self):
        fake = FakeSecurity()
        with tempfile.TemporaryDirectory() as folder, patch.object(account, 'TOKEN_FILE', Path(folder) / 'account-token.bin'), patch('subprocess.run', fake):
            account._save_token('a' * 64)
            fake.stored = '00' * 32
            self.assertIsNone(account._load_token(refresh=True))
            self.assertFalse(account.TOKEN_FILE.exists())

    def test_locked_or_slow_keychain_keeps_the_saved_login(self):
        fake = FakeSecurity()
        with tempfile.TemporaryDirectory() as folder, patch.object(account, 'TOKEN_FILE', Path(folder) / 'account-token.bin'), patch('subprocess.run', fake):
            account._save_token('a' * 64)
            fake.fail = True   # 잠김·허용 거부
            self.assertIsNone(account._load_token(refresh=True))
            self.assertTrue(account.TOKEN_FILE.exists(), '일시적으로 못 읽었다고 로그인을 지우지 않는다')
            def slow(*args, **kwargs): raise subprocess.TimeoutExpired(args[0], 15)
            with patch('subprocess.run', slow):
                self.assertIsNone(account._load_token(refresh=True))
            self.assertTrue(account.TOKEN_FILE.exists())
            fake.fail = False   # 키체인이 다시 열리면 같은 로그인 그대로
            self.assertEqual(account._load_token(refresh=True), 'a' * 64)

    def test_locked_keychain_is_reported_and_no_new_key_is_written(self):
        fake = FakeSecurity(fail=True)
        with tempfile.TemporaryDirectory() as folder, patch.object(account, 'TOKEN_FILE', Path(folder) / 'account-token.bin'), patch('subprocess.run', fake):
            with self.assertRaisesRegex(ValueError, '키체인'): account._save_token('a' * 64)
        self.assertFalse(any(args[1] == '-i' for args, _ in fake.calls))

    def test_mac_data_folder_is_application_support(self):
        with patch.dict(os.environ, {}, clear=False):
            os.environ.pop('LOCALAPPDATA', None)
            self.assertEqual(account._local_data_dir(), Path.home() / 'Library' / 'Application Support')


if __name__ == '__main__':
    unittest.main()
