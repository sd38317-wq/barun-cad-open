import unittest,json
from unittest.mock import patch
import realtime_voice as v
class RealtimeTest(unittest.TestCase):
 def test_login_required(self):
  with patch.object(v,'cookie',return_value=''),self.assertRaisesRegex(ValueError,'로그인'):v.create({'sdp':'v=0'})
 def test_model_allowlist(self):
  with patch.object(v,'cookie',return_value='session=test'),self.assertRaisesRegex(ValueError,'모델'):v.create({'sdp':'v=0','model':'unapproved'})
 def test_proxy_ignores_client_key_and_filters_response(self):
  class Response:
   def __enter__(self):return self
   def __exit__(self,*a):pass
   def read(self,*a):return json.dumps({'sdp':'v=0','model':'gpt-realtime-2.1-mini','key':'must-not-return'}).encode()
  seen=[]
  def fake(req,timeout):seen.append(req);return Response()
  with patch.object(v,'cookie',return_value='session=test'),patch.object(v,'urlopen',fake):result=v.create({'key':'must-not-send','sdp':'v=0'})
  self.assertNotIn('key',json.loads(seen[0].data));self.assertNotIn('key',result)
  self.assertEqual(seen[0].get_header('Cookie'),'session=test')
  self.assertTrue(seen[0].full_url.endswith('/api/cad/voice'))
 def test_invalid_sdp(self):
  with patch.object(v,'cookie',return_value='session=test'),self.assertRaisesRegex(ValueError,'연결 정보'):v.create({'sdp':'no'})
if __name__=='__main__':unittest.main()
