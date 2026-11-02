import tempfile,unittest
from pathlib import Path
from unittest.mock import patch
import chat_router

class Fake:
 def __init__(self,name):self.name=name;self.calls=[]
 def process(self,data):
  self.calls.append(dict(data))
  if data.get('action')=='send':return {'threadId':self.name+'-1','cursor':0}
  return {'authenticated':True,'from':self.name}

class ChatRouterTests(unittest.TestCase):
 def setUp(self):
  self.root=tempfile.TemporaryDirectory();data=Path(self.root.name)
  self.fakes={'miri':Fake('miri'),'codex':Fake('codex'),'claude':Fake('claude')}
  self.patches=[patch.object(chat_router,'DATA',data),patch.object(chat_router,'MODE_FILE',data/'ai-mode.json'),
   patch.object(chat_router,'backend',lambda name:self.fakes[name]),patch.object(chat_router,'_threads',{}),patch.object(chat_router,'_authorizations',{}),patch('miri_account_service.capture_ai_epoch',return_value=42),patch('bridge.pending_requests',{})]
  for p in self.patches:p.start()
 def tearDown(self):
  for p in self.patches:p.stop()
  self.root.cleanup()

 def test_default_is_miri_and_mode_is_saved(self):
  self.assertEqual(chat_router.process({'action':'mode'}),{'mode':'managed','personal':'codex'})
  self.assertEqual(chat_router.process({'action':'status'})['provider'],'miri')
  with self.assertRaises(ValueError):chat_router.process({'action':'setMode','mode':'other'})
  chat_router.process({'action':'setMode','mode':'personal'})
  self.assertEqual(chat_router.process({'action':'mode'}),{'mode':'personal','personal':'codex'})
  self.assertEqual(chat_router.process({'action':'status'})['provider'],'codex')

 def test_personal_sends_to_codex_with_default_model_and_threads_stay_with_their_provider(self):
  chat_router.process({'action':'setMode','mode':'personal'})
  sent=chat_router.process({'action':'send','message':'벽 1m 물려줘','model':'miri'})
  self.assertEqual(self.fakes['codex'].calls[-1]['model'],None)
  chat_router.process({'action':'setMode','mode':'managed'})
  chat_router.process({'action':'poll','threadId':sent['threadId'],'cursor':0})
  self.assertEqual(self.fakes['codex'].calls[-1]['action'],'poll')
  self.assertEqual(self.fakes['miri'].calls,[])

 def test_codex_account_actions_ignore_the_chosen_mode(self):
  for action,inner in (('codexStatus','status'),('codexLogin','login'),('codexLogout','logout')):
   chat_router.process({'action':action})
   self.assertEqual(self.fakes['codex'].calls[-1],{'action':inner})


 def test_personal_claude_routes_chat_and_key_actions_to_claude(self):
  # 2026-10-26 내 모델 > Claude(API 키): 고른 모델이 남고, 채팅·키 작업은 claude_chat 으로 간다. 키는 그대로 넘기되 다른 필드는 넘기지 않는다.
  with self.assertRaises(ValueError):chat_router.process({'action':'setPersonal','personal':'gemini'})
  chat_router.process({'action':'setMode','mode':'personal'});chat_router.process({'action':'setPersonal','personal':'claude'})
  self.assertEqual(chat_router.process({'action':'mode'}),{'mode':'personal','personal':'claude'})
  self.assertEqual(chat_router.process({'action':'status'})['provider'],'claude')
  chat_router.process({'action':'send','message':'벽 그려줘','model':'miri'})
  self.assertEqual(self.fakes['claude'].calls[-1]['model'],None)
  chat_router.process({'action':'claudeSaveKey','key':'sk-ant-x','model':'claude-opus-5-5','editorSession':'e'})
  self.assertEqual(self.fakes['claude'].calls[-1],{'action':'saveKey','key':'sk-ant-x','model':'claude-opus-5-5'})
  for action,expected in (('claudeStatus','status'),('claudeForgetKey','forgetKey'),('claudeSetModel','setModel')):
   chat_router.process({'action':action});self.assertEqual(self.fakes['claude'].calls[-1]['action'],expected)
  self.assertEqual(self.fakes['codex'].calls,[])

if __name__=='__main__':unittest.main()
