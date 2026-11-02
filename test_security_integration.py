"""Independent regressions for login/stop boundaries; all disk writes use temp roots."""
import base64
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import bridge
import chat_router
import file_care
import lisp_service
import miri_chat


class SecurityIntegrationTests(unittest.TestCase):
    def setUp(self):
        self.directory=tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root=Path(self.directory.name)
        self.logged_in=True;self.cancelled=False
        for item in [patch.object(lisp_service,'ROOT',self.root),
                     patch('miri_account_service.capture_ai_epoch',return_value=7),
                     patch('miri_account_service.require_ai_login'),
                     patch('miri_account_service.validate_ai_epoch',side_effect=self.validate)]:
            item.start();self.addCleanup(item.stop)

    def validate(self,epoch):
        if not self.logged_in or epoch!=7:raise ValueError('로그인 세대 만료')

    def authorized(self):
        if self.cancelled:raise ValueError('요청 중지')

    def upload_after(self,invalidate):
        def inspect(_raw):
            invalidate()
            return {'commands':[]}
        with patch.object(lisp_service,'read_library',return_value=[]),              patch.object(lisp_service,'save_library') as save_library,              patch.object(lisp_service,'inspect_source',side_effect=inspect):
            with self.assertRaises(ValueError):
                lisp_service.process({'action':'upload','ai':True,'_login_epoch':7,'name':'repro.lsp',
                    'data':base64.b64encode(b'(defun c:TEST () nil)').decode()},assert_current=self.authorized)
        save_library.assert_not_called()
        self.assertFalse(list(self.root.glob('*.bin')))
        self.assertFalse(list(self.root.glob('*.barun-save.lock')))

    def test_lisp_upload_logout_during_source_inspection_cannot_write(self):
        self.upload_after(lambda:setattr(self,'logged_in',False))

    def test_lisp_upload_stop_during_source_inspection_cannot_write(self):
        self.upload_after(lambda:setattr(self,'cancelled',True))

    def update_after(self,invalidate):
        target=self.root/'user-lisp.bin';target.write_bytes(b'(princ "old")')
        previous=self.root/'user-lisp.bin.previous';previous.write_bytes(b'older backup')
        preserve=file_care.keep_previous
        def backup(path):
            result=preserve(path)
            invalidate()
            return result
        with patch.object(lisp_service,'read_library',return_value=[{'id':'user-lisp','name':'repro.lsp'}]),              patch.object(lisp_service,'save_library') as save_library,              patch.object(file_care,'keep_previous',side_effect=backup):
            with self.assertRaises(ValueError):
                lisp_service.process({'action':'update','ai':True,'_login_epoch':7,'id':'user-lisp',
                    'source':'(princ "new")','expectedSource':'(princ "old")'},assert_current=self.authorized)
        self.assertEqual(target.read_bytes(),b'(princ "old")')
        self.assertEqual(previous.read_bytes(),b'older backup')
        self.assertFalse(list(self.root.glob('.cad-*')))
        self.assertFalse(list(self.root.glob('*.barun-save.lock')))
        save_library.assert_not_called()

    def test_lisp_update_logout_during_backup_cannot_replace(self):
        self.update_after(lambda:setattr(self,'logged_in',False))

    def test_lisp_update_stop_during_backup_cannot_replace(self):
        self.update_after(lambda:setattr(self,'cancelled',True))

    def test_router_managed_request_keeps_original_login_generation(self):
        # The router admitted epoch 6, but a new login is epoch 7 before managed
        # transport begins. It must not recapture 7 and execute the old request.
        auth={'requestId':'original-request','recipient':'editor-A','expiresAt':9999999999999}
        with patch.object(chat_router,'provider',return_value='miri'),              patch.object(bridge,'register_chat_request',return_value=(auth,6)),              patch.object(miri_chat,'request') as remote,patch.object(bridge,'call_app') as call:
            with self.assertRaisesRegex(ValueError,'세대'):
                chat_router.process({'action':'send','message':'그려줘','mode':'execute',
                                     'editorSession':'editor-A','aiRequestEpoch':21})
        remote.assert_not_called();call.assert_not_called()


if __name__=='__main__':unittest.main()
