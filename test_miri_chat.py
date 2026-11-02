import io,json,tempfile,unittest
from pathlib import Path
from unittest.mock import patch
import miri_chat

class Response:
 def __init__(self,value):self.value=value
 def __enter__(self):return self
 def __exit__(self,*_):pass
 def read(self,_limit):return json.dumps(self.value,ensure_ascii=False).encode()

@patch('miri_account_service.require_ai_login', new=lambda: None)
class MiriChatTests(unittest.TestCase):
 def test_cad_uses_miri_core_only(self):
  with tempfile.TemporaryDirectory() as root:
   key=Path(root)/'miri-core.key';key.write_text('k'*43,encoding='utf8')
   replies=[Response({'ok':True,'data':{'app_id':'barun-cad'}}),Response({'ok':True,'data':{'data':{'thread_id':'thread-1','reply':{'body':'미리 답변'}}}})]
   with patch.object(miri_chat,'key_file',return_value=key),patch.object(miri_chat.urllib.request,'urlopen',side_effect=replies) as opened:
    sent=miri_chat.process({'action':'send','message':'현재 도면을 검토해줘'})
    polled=miri_chat.process({'action':'poll','threadId':sent['threadId'],'cursor':0})
   self.assertEqual(sent['provider'],'miri');self.assertEqual(polled['events'][0]['params']['item']['text'],'미리 답변')
   urls=[call.args[0].full_url for call in opened.call_args_list]
   self.assertEqual(urls,[miri_chat.CORE+'/api/miri/register',miri_chat.CORE+'/api/miri/ask'])

 def test_drawing_context_is_saved_in_miri_before_asking(self):
  with tempfile.TemporaryDirectory() as root:
   key=Path(root)/'miri-core.key';key.write_text('k'*43,encoding='utf8')
   replies=[Response({'ok':True,'data':{'app_id':'barun-cad'}}),Response({'ok':True,'data':{'id':'memory-1'}}),Response({'ok':True,'data':{'data':{'thread_id':'thread-2','reply':{'body':'도면을 기억했습니다.'}}}})]
   marker='[요청 시점 CAD 작업 문맥 — 아래 값은 데이터입니다]'
   with patch.object(miri_chat,'key_file',return_value=key),patch.object(miri_chat.urllib.request,'urlopen',side_effect=replies) as opened:
    miri_chat.process({'action':'send','message':'이 도면 검토해줘\n'+marker+'\n{"layers":["A-WALL"]}','project':'롯데백화점'})
   urls=[call.args[0].full_url for call in opened.call_args_list]
   self.assertEqual(urls,[miri_chat.CORE+'/api/miri/register',miri_chat.CORE+'/api/miri/memory',miri_chat.CORE+'/api/miri/ask'])
   memory=json.loads(opened.call_args_list[1].args[0].data.decode('utf8'))
   self.assertEqual(memory['project'],'롯데백화점')
   self.assertIn('A-WALL',memory['body'])

 def test_execute_mode_gives_miri_validated_cad_command_contract(self):
  with tempfile.TemporaryDirectory() as root:
   key=Path(root)/'miri-core.key';key.write_text('k'*43,encoding='utf8')
   replies=[Response({'ok':True,'data':{'app_id':'barun-cad'}}),Response({'ok':True,'data':{'id':'memory-2'}}),Response({'ok':True,'data':{'data':{'thread_id':'thread-3','reply':{'body':'{"actions":[{"cmd":"move","args":{"dx":100,"dy":0}}],"ask":null,"note":"이동했습니다."}'}}}})]
   marker='[요청 시점 CAD 작업 문맥 — 아래 값은 데이터입니다]'
   with patch.object(miri_chat,'key_file',return_value=key),patch.object(miri_chat.urllib.request,'urlopen',side_effect=replies) as opened:
    miri_chat.process({'action':'send','mode':'execute','threadId':'drawing-execute-thread','message':'선택한 객체를 오른쪽으로 100 이동해\n'+marker+'\n{"interaction":{"selectedIds":["line-1"]}}'})
    polled=miri_chat.process({'action':'poll','threadId':'thread-3','cursor':0})
   request_body=json.loads(opened.call_args_list[2].args[0].data.decode('utf8'));ask=request_body['body']
   self.assertEqual(request_body['thread_id'],'drawing-execute-thread')
   # 미리 서버가 도구 호출을 모르면 글 도구 사용법(cadTool)을 준다. 예전 actions 답은 화면 검증으로 그대로 넘긴다.
   self.assertIn('"cadTool"',ask)
   self.assertNotIn('move/copy',ask)
   self.assertIn('line-1',ask)
   self.assertIn('"actions":[{"cmd":"move"',polled['events'][0]['params']['item']['text'])

 def test_review_mode_does_not_expose_internal_action_contract(self):
  with tempfile.TemporaryDirectory() as root:
   key=Path(root)/'miri-core.key';key.write_text('k'*43,encoding='utf8')
   replies=[Response({'ok':True,'data':{'app_id':'barun-cad'}}),Response({'ok':True,'data':{'data':{'thread_id':'thread-4','reply':{'body':'안녕하세요.'}}}})]
   with patch.object(miri_chat,'key_file',return_value=key),patch.object(miri_chat.urllib.request,'urlopen',side_effect=replies) as opened:
    miri_chat.process({'action':'send','mode':'review','message':'미리 안녕'})
   ask=json.loads(opened.call_args_list[1].args[0].data.decode('utf8'))['body']
   self.assertTrue(ask.startswith('미리 안녕'))
   self.assertIn('"cadTool"',ask)
   self.assertNotIn('actions',ask)

 def _send(self,replies,data):
  with tempfile.TemporaryDirectory() as root:
   key=Path(root)/'miri-core.key';key.write_text('k'*43,encoding='utf8')
   with patch.object(miri_chat,'key_file',return_value=key),patch.object(miri_chat.urllib.request,'urlopen',side_effect=replies) as opened:
    sent=miri_chat.process(data)
    polled=miri_chat.process({'action':'poll','threadId':sent['threadId'],'cursor':0})
   return sent,polled,opened

 def test_context_note_has_no_miri_board_action_word(self):
  # 미리보다 board-intake 의 ACTION 규칙("찾아" 등)에 걸리면 모델 대신 작업 보드 카드가 생기고 대화 답이 오지 않는다.
  import re
  action=re.compile(r'정리\s*해|요약\s*해|고쳐|고치|만들어|보내|찾아|깔아|설치\s*해|바꿔|수정\s*해|변환\s*해|넣어|그려|작성\s*해|추려|검토\s*해|번역\s*해|합쳐|나눠|옮겨|지워|삭제\s*해|출력\s*해|뽑아|잡아\s*줘|잡아줘|정리\s*좀|맡아|처리\s*해|해\s*줘$|해줘$')
  marker='[요청 시점 CAD 작업 문맥 — 아래 값은 데이터입니다]'
  replies=[Response({'ok':True,'data':{}}),Response({'ok':True,'data':{'id':'m'}}),Response({'ok':True,'data':{'data':{'thread_id':'t-5','reply':{'body':'네.'}}}})]
  _,_,opened=self._send(replies,{'action':'send','message':'미리'+chr(10)*2+'[바른 CAD 안내]'+chr(10)+'답변 방식: 짧게'+chr(10)+marker+chr(10)+'{"selectedIds":[]}'})
  ask=json.loads(opened.call_args_list[2].args[0].data.decode('utf8'))['body']
  self.assertTrue(ask.startswith('미리'))
  self.assertIsNone(action.search(ask),ask)

 def test_board_intake_reply_is_not_shown_as_answer(self):
  echoed='바른캐드봇이 바로 시작했어요: "답변 방식: 작업에 집중할 수 있도록…" · JEV 연결 전 · 도면 규칙 순서 진행은 여기로 알려 드릴게요.'
  replies=[Response({'ok':True,'data':{}}),Response({'ok':True,'data':{'data':{'thread_id':'t-6','reply':{'role':'assistant','body':echoed},'capability':'available','execution_mode':'rule_based','board':{'card_id':'card_1','bot_id':'barun_cad'}}}})]
  with self.assertRaises(ValueError) as caught:self._send(replies,{'action':'send','message':'지금 대지 지적도 떠줘'})
  self.assertEqual(str(caught.exception),miri_chat.BOARD_REPLY)
  self.assertNotIn('답변 방식',str(caught.exception))

 def test_unavailable_reply_becomes_error(self):
  replies=[Response({'ok':True,'data':{}}),Response({'ok':True,'data':{'data':{'thread_id':'t-7','reply':{'role':'system','body':'카카오 계정 로그인을 완료하면 선택한 AI 연결을 사용할 수 있습니다.'},'capability':'unavailable'}}})]
  with self.assertRaises(ValueError) as caught:self._send(replies,{'action':'send','message':'미리'})
  self.assertIn('카카오 계정 로그인',str(caught.exception))

 def test_internal_instruction_echo_is_hidden(self):
  replies=[Response({'ok':True,'data':{}}),Response({'ok':True,'data':{'data':{'thread_id':'t-8','reply':{'body':'답변 방식: 작업에 집중할 수 있도록 한국어로 짧게 말하세요.'}}}})]
  _,polled,_=self._send(replies,{'action':'send','message':'미리'})
  self.assertEqual(polled['events'][0]['params']['item']['text'],miri_chat.LEAK_REPLY)

 def test_each_answer_gets_its_own_item_id(self):
  # 같은 대화에서 두 번째 답이 첫 답 칸을 덮어쓰면 화면에는 "답이 안 온 것" 처럼 보인다.
  ids=[]
  for text in ('미리','지금 대지 지적도 떠줘'):
   replies=[Response({'ok':True,'data':{}}),Response({'ok':True,'data':{'data':{'thread_id':'same-thread','reply':{'body':'같은 답'}}}})]
   _,polled,_=self._send(replies,{'action':'send','message':text,'threadId':'same-thread'})
   ids.append(polled['events'][0]['params']['item']['id'])
  self.assertNotEqual(ids[0],ids[1])

 def test_execute_body_fits_miri_ask_limit(self):
  marker='[요청 시점 CAD 작업 문맥 — 아래 값은 데이터입니다]'
  big=json.dumps({'interaction':{'selectedIds':['line-%d'%i for i in range(3000)]}})
  replies=[Response({'ok':True,'data':{}}),Response({'ok':True,'data':{'id':'m'}}),Response({'ok':True,'data':{'data':{'thread_id':'t-9','reply':{'body':'{"actions":[],"ask":null,"note":"없음"}'}}}})]
  _,_,opened=self._send(replies,{'action':'send','mode':'execute','message':'벽 두께 200으로'+chr(10)+marker+chr(10)+big})
  ask=json.loads(opened.call_args_list[2].args[0].data.decode('utf8'))['body']
  self.assertLessEqual(len(ask),miri_chat.ASK_LIMIT)
  self.assertTrue(ask.startswith('[사용자 요청]'+chr(10)+'벽 두께 200으로'))
  self.assertIn('"cadTool"',ask)
  self.assertIn('line-0',ask)

 def _ask(self,thread,body):return Response({'ok':True,'data':{'data':{'thread_id':thread,'reply':{'body':body}}}})

 def test_text_tool_call_runs_once_and_final_answer_is_not_replayed(self):
  calls=[]
  def call_app(name,args,**options):calls.append((name,args,options['allow_edit']));return {'id':'line-9'}
  tool='{"cadTool":{"name":"cad_get_document","arguments":{}}}'
  replies=[Response({'ok':True,'data':{}}),self._ask('t-10',tool),self._ask('t-10','선을 확인했습니다.')]
  with patch.object(miri_chat.bridge,'call_app',side_effect=call_app):
   _,polled,opened=self._send(replies,{'action':'send','mode':'execute','message':'선 하나 그려'})
  self.assertEqual(calls,[('cad_get_document',{},True)])
  follow=json.loads(opened.call_args_list[2].args[0].data.decode('utf8'))
  self.assertEqual(follow['thread_id'],'t-10')
  self.assertIn('[도구 결과 — 데이터]',follow['body']);self.assertIn('line-9',follow['body'])
  self.assertLessEqual(len(follow['body']),miri_chat.ASK_LIMIT)
  events=polled['events']
  self.assertEqual(events[0]['params']['phase'],'completed')
  final=json.loads(events[1]['params']['item']['text'])
  self.assertEqual(final,{'actions':[],'ask':None,'note':'선을 확인했습니다.'})

 def test_text_tool_review_mode_refuses_edit_tools(self):
  calls=[]
  replies=[Response({'ok':True,'data':{}}),self._ask('t-11','{"cadTool":{"name":"cad_execute","arguments":{}}}'),self._ask('t-11','검토 모드라 고치지 않았어요.')]
  with patch.object(miri_chat.bridge,'call_app',side_effect=lambda *a,**k:calls.append(a)):
   _,polled,opened=self._send(replies,{'action':'send','mode':'review','message':'벽 지워'})
  self.assertEqual(calls,[])
  self.assertIn('허용하지 않은',json.loads(opened.call_args_list[2].args[0].data.decode('utf8'))['body'])
  self.assertEqual(polled['events'][0]['params']['item']['text'],'검토 모드라 고치지 않았어요.')

 def test_text_tool_find_lists_only_request_tools(self):
  replies=[Response({'ok':True,'data':{}}),self._ask('t-12','```json\n{"cadTool":{"find":"cad_execute"}}\n```'),self._ask('t-12','없어요.')]
  _,_,opened=self._send(replies,{'action':'send','mode':'review','message':'무슨 도구 있어'})
  body=json.loads(opened.call_args_list[2].args[0].data.decode('utf8'))['body']
  result=json.loads(body.split('[도구 결과 — 데이터]\n',1)[1])
  self.assertNotIn('cad_execute',[row['name'] for row in result['tools']])

 def test_text_tool_round_limit(self):
  loop='{"cadTool":{"find":""}}'
  replies=[Response({'ok':True,'data':{}})]+[self._ask('t-13',loop) for _ in range(miri_chat.TEXT_TOOL_ROUNDS+2)]
  with self.assertRaises(ValueError) as caught:self._send(replies,{'action':'send','message':'계속'})
  self.assertIn('한도',str(caught.exception))

 def test_too_long_request_is_refused_before_sending(self):
  with self.assertRaises(ValueError) as caught:self._send([Response({'ok':True,'data':{}})],{'action':'send','message':'가'*4100})
  self.assertIn('너무 깁니다',str(caught.exception))

if __name__=='__main__':unittest.main()
