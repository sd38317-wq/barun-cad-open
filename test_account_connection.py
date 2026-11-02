import unittest
from unittest.mock import patch
from codex_chat import Client

class AccountConnectionTests(unittest.TestCase):
 def client(self):
  c=Client.__new__(Client);c.active_threads=set();return c
 def test_login_opens_only_official_browser_url(self):
  c=self.client()
  with patch.object(c,'start'),patch.object(c,'rpc',return_value={'authUrl':'https://auth.openai.com/authorize?state=test'}) as rpc,patch('codex_chat._open_url') as launch:
   self.assertEqual(c.login(),{'opened':True})
   rpc.assert_called_once_with('account/login/start',{'type':'chatgpt'})
   launch.assert_called_once_with('https://auth.openai.com/authorize?state=test')
 def test_rejects_untrusted_login_url(self):
  c=self.client()
  with patch.object(c,'start'),patch.object(c,'rpc',return_value={'authUrl':'https://auth.openai.com.attacker.example/'}),patch('codex_chat._open_url') as launch:
   with self.assertRaises(ValueError):c.login()
   launch.assert_not_called()
 def test_does_not_switch_account_during_turn(self):
  c=self.client();c.active_threads.add('working')
  with patch.object(c,'start'),patch.object(c,'rpc') as rpc:
   with self.assertRaises(ValueError):c.login()
   rpc.assert_not_called()

if __name__=='__main__':unittest.main()
