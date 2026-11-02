import re,unittest
from pathlib import Path

ROOT=Path(__file__).resolve().parent

class PostRoutesAllowed(unittest.TestCase):
    def test_every_post_route_is_in_the_api_allowlist(self):
        # do_POST 앞단 허용 목록에 없는 API 는 처리 함수가 있어도 404 다(2026-10-21: /api/compute 가 빠져 서버 계산이 전부 막혔다).
        text=(ROOT/'server.py').read_text(encoding='utf-8')
        body=text[text.index('    def do_POST(self):'):]
        body=body[:re.search(r'\n(    def |def |class )',body[10:]).start()+10]
        allow=re.search(r"self\.path not in \((.*?)\):",body,re.S)[1]
        allowed=set(re.findall(r"'(/api/[^']+)'",allow))
        routes=set(re.findall(r"self\.path==\s*'(/api/[^']+)'",body))-{'/api/mcp'}
        self.assertIn('/api/compute',routes)
        self.assertEqual(sorted(routes-allowed),[])

if __name__=='__main__':unittest.main()
