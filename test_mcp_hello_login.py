"""MCP 연결(허락 요청)은 로그인 뒤에만(사용자 2026-10-25 "로그인이 안 돼 있으면 연결 못 하게, 카카오든 뭐든 로그인되면 연결").
server.py 의 /api/mcp-hello 가 허락 창보다 먼저 로그인 확인 함수를 부르는지, 그 함수가 실제로 있는지 본다."""
import re
import unittest
from pathlib import Path

import miri_account_service


class McpHelloLoginTest(unittest.TestCase):
    def test_hello_checks_login_before_consent(self):
        source = Path(__file__).with_name('server.py').read_text(encoding='utf-8')
        block = source[source.index("elif self.path=='/api/mcp-hello':"):]
        block = block[:block.index('elif self.path==', 10)]
        self.assertRegex(block, r'miri_account_service\.require_ai_login\(\)')
        self.assertLess(block.index('require_ai_login'), block.index('ai_consent.hello'))
        self.assertTrue(callable(miri_account_service.require_ai_login))


if __name__ == '__main__':
    unittest.main()
