import tempfile, unittest, time
from pathlib import Path
from unittest.mock import patch
import bridge, miri_account_service as account
import test_ai_login

class SecurityEpochTest(unittest.TestCase):
    setUp=test_ai_login.AILoginTests.setUp
    linked=test_ai_login.AILoginTests.linked
    def test_logout_and_relogin_invalidates_pending_external_mcp(self):
        self.linked()
        epoch=account.capture_ai_epoch()
        identifier='epoch-repro'
        bridge.pending_requests[identifier]={'recipient':'recipient','deadline':time.monotonic()+30,'login_epoch':epoch}
        self.addCleanup(bridge.pending_requests.pop,identifier,None)
        self.assertTrue(bridge.validate_app_request(identifier,'recipient')['authorized'])
        account._clear_token();self.linked()
        with self.assertRaises(ValueError):bridge.validate_app_request(identifier,'recipient')

    def test_status_poll_does_not_change_login_generation(self):
        self.linked();epoch=account.capture_ai_epoch()
        with patch.object(account,'_request',return_value={'state':'linked'}):account.process({'action':'status'})
        account.validate_ai_epoch(epoch)

    def test_direct_lisp_without_ai_flag_is_still_login_gated(self):
        import lisp_service
        with patch.object(lisp_service,'read_library') as read:
            with self.assertRaises(account.AILoginRequired):lisp_service.process({'action':'read','id':'x'})
        read.assert_not_called()

if __name__=='__main__':unittest.main()
