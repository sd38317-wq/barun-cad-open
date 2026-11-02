"""묶음 보관과 로그인 잠금."""
import unittest
from pathlib import Path
from unittest.mock import patch

import vault
import parcel_service

PACK = Path(__file__).parent / 'examples' / 'architecture-lisp'


class VaultTests(unittest.TestCase):
    def test_roundtrip_keeps_every_byte(self):
        files = {p.name: p.read_bytes() for p in sorted(PACK.glob('*.lsp'))}
        self.assertEqual(len(files), 23)
        self.assertEqual(vault.unpack(vault.pack(files)), files)

    def test_packed_bytes_are_not_readable(self):
        files = {p.name: p.read_bytes() for p in sorted(PACK.glob('*.lsp'))}
        blob = vault.pack(files)
        # 메모장으로 열었을 때 내용이 그대로 보이면 안 된다.
        self.assertNotIn(b'defun', blob)
        self.assertNotIn('레이어'.encode('utf8'), blob)
        self.assertNotIn(b'.lsp', blob)
        self.assertLess(len(blob), sum(len(v) for v in files.values()))

    def test_each_pack_differs_even_for_same_content(self):
        files = {'a.lsp': b'(defun c:TEST () (princ))'}
        self.assertNotEqual(vault.pack(files), vault.pack(files))
        self.assertEqual(vault.unpack(vault.pack(files)), files)

    def test_damaged_pack_is_rejected(self):
        with self.assertRaises(ValueError):
            vault.unpack(b'plain text, not a pack')

    def test_new_packs_use_authenticated_encryption(self):
        blob = vault.pack({'a.lsp': b'(defun c:TEST () (princ))'})
        self.assertEqual(blob[:4], b'BCV2')

    def test_any_changed_byte_is_rejected(self):
        blob = vault.pack({'a.lsp': b'(defun c:TEST () (princ))' * 20})
        for at in (4, 10, 16, len(blob) // 2, len(blob) - 1):
            tampered = bytearray(blob); tampered[at] ^= 1
            with self.assertRaises(ValueError):
                vault.unpack(bytes(tampered))
        with self.assertRaises(ValueError):
            vault.unpack(blob[:-1])
        with self.assertRaises(ValueError):
            vault.unpack(b'BCV2' + blob[4:20])

    def test_old_bcv1_packs_still_open(self):
        import zlib
        files = {'a.lsp': b'(defun c:OLD () (princ))', 'b.json': '{"레이어": 1}'.encode('utf8')}
        body = b''.join(len(n.encode()).to_bytes(2, 'big') + n.encode() + len(files[n]).to_bytes(4, 'big') + files[n] for n in sorted(files))
        salt = b'12345678'
        legacy = b'BCV1' + salt + vault._mask(zlib.compress(body, 9), salt)
        self.assertEqual(vault.unpack(legacy), files)

    def test_names_cannot_escape_the_folder(self):
        import zlib, secrets
        for name in (b'../evil.lsp', b'..\\evil.lsp', b'..', b''):
            body = len(name).to_bytes(2, 'big') + name + (1).to_bytes(4, 'big') + b'x'
            nonce = secrets.token_bytes(12)
            blob = b'BCV2' + nonce + vault._AEAD.encrypt(nonce, zlib.compress(body), b'BCV2')
            with self.assertRaises(ValueError):
                vault.unpack(blob)


class DetailPathVaultTests(unittest.TestCase):
    def test_nested_detail_path_round_trip(self):
        files = {'details/wall.json': b'{\"group\":\"wall\"}', 'details/_schema.json': b'{}'}
        self.assertEqual(vault.unpack(vault.pack(files)), files)

    def test_unsafe_paths_are_rejected(self):
        slash = chr(92)
        for name in ('/details/wall.json', slash + 'details' + slash + 'wall.json', './details/wall.json', 'details//wall.json', 'details/../wall.json', 'C:details/wall.json', ''):
            with self.assertRaises(ValueError):
                vault.pack({name: b'x'})


class LoginGateTests(unittest.TestCase):
    def setUp(self):
        # 이 PC 의 실제 [계정 연결] 로그인(account-token.bin)이 시험에 새지 않게 비운다 — 로그인 여부는 시험마다 cookie 로 정한다.
        patcher=patch.object(parcel_service, 'account_token', return_value='')
        patcher.start();self.addCleanup(patcher.stop)
        import miri_account_service
        token=patch.object(miri_account_service, '_load_token', return_value=None)
        token.start();self.addCleanup(token.stop)

    def test_locked_without_login(self):
        with patch.object(parcel_service, 'cookie', return_value=None):
            self.assertFalse(parcel_service.signed_in())
            with self.assertRaises(ValueError) as caught:
                parcel_service.require_login('건축 리습 묶음')
        self.assertIn('건축 리습 묶음', str(caught.exception))
        self.assertIn('로그인', str(caught.exception))

    def test_open_after_login(self):
        with patch.object(parcel_service, 'cookie', return_value='session=abc'):
            self.assertTrue(parcel_service.signed_in())
            parcel_service.require_login('건축 리습 묶음')

    def test_expired_token_file_does_not_open(self):
        # 토큰 파일만 남은(서버가 만료·해지한) PC 는 이 PC 자료(설계 사례·동봉 리습)도 못 연다
        import miri_account_service
        with patch.object(parcel_service, 'account_token', return_value='t' * 64), patch.object(parcel_service, 'cookie', return_value=None),              patch.object(miri_account_service, 'require_ai_login', side_effect=miri_account_service.AILoginRequired('만료')):
            with self.assertRaises(ValueError) as caught:
                parcel_service.require_verified_login('설계 사례')
        self.assertIn('로그인', str(caught.exception))
        with patch.object(parcel_service, 'account_token', return_value='t' * 64), patch.object(miri_account_service, 'require_ai_login', return_value=None):
            parcel_service.require_verified_login('설계 사례')

    def test_lisp_pack_install_is_locked(self):
        import lisp_service
        with patch.object(parcel_service, 'cookie', return_value=None):
            with self.assertRaises(ValueError) as caught:
                lisp_service.process({'action': 'install_architecture'})
        self.assertIn('로그인', str(caught.exception))

    def test_design_cases_are_locked(self):
        import design_case_service
        with patch.object(parcel_service, 'cookie', return_value=None):
            with self.assertRaises(ValueError) as caught:
                design_case_service.process({'action': 'search'})
        self.assertIn('로그인', str(caught.exception))

    def test_ai_design_is_locked(self):
        import codex_chat
        with patch.object(parcel_service, 'cookie', return_value=None):
            with self.assertRaises(ValueError) as caught:
                codex_chat.CLIENT.chat({'message': '설계해줘'})
        self.assertIn('로그인', str(caught.exception))


if __name__ == '__main__':
    unittest.main()
