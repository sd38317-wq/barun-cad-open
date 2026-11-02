import json,threading,time,tempfile,unittest,urllib.request,urllib.error
from pathlib import Path
from unittest.mock import patch
from http.server import ThreadingHTTPServer
import server,bridge,exchange,http.client

class ServerAIBoundaries(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
  self.enterContext(patch.object(server,'SAVE_TARGETS',{}))
  self.addCleanup(lambda:[server.consume_save_target(token) for token in list(server.SAVE_TARGETS)])
  self.httpd=ThreadingHTTPServer(('127.0.0.1',0),server.Handler)
  self.addCleanup(self.httpd.server_close);self.addCleanup(self.httpd.shutdown)
  threading.Thread(target=self.httpd.serve_forever,daemon=True).start()
  self.origin=f'http://127.0.0.1:{self.httpd.server_port}'
 def post(self,path,data,token=None,shell=False):
  headers={'Content-Type':'application/json','Origin':self.origin,'X-CAD-Token':token or server.TOKEN}
  if shell:headers['X-CAD-Shell']='test-shell'
  headers['Connection']='close'
  connection=http.client.HTTPConnection('127.0.0.1',self.httpd.server_port,timeout=10)
  try:
   connection.request('POST',path,json.dumps(data).encode(),headers)
   response=connection.getresponse();return response.status,json.loads(response.read())
  finally:connection.close()
 def test_mcp_token_cannot_reach_native_lisp_or_chat(self):
  with patch('lisp_service.process') as lisp,patch('chat_router.process') as chat:
   for path in ('/api/lisp','/api/chat'):
    status,_=self.post(path,{'action':'start','ai':False},server.MCP_TOKEN)
    self.assertEqual(status,403)
   lisp.assert_not_called();chat.assert_not_called()
  # 연결 파일 토큰만으로는 /api/mcp 도 못 쓴다(10-21). CAD 화면에서 허락받은 열쇠(ai_consent)로만.
  with patch.object(bridge,'call',return_value={'restricted':True}) as call:
   status,value=self.post('/api/mcp',{'name':'cad_lisp_run'},server.MCP_TOKEN)
   self.assertEqual((status,value.get('code')),(403,'consent_required'));call.assert_not_called()
   import ai_consent
   with patch.dict(ai_consent._grants,{'test-grant':{'key':'session:1','pid':1,'label':'test'}}):
    status,value=self.post('/api/mcp',{'name':'cad_lisp_run'},'test-grant')
   self.assertEqual(status,200);self.assertTrue(value['restricted']);call.assert_called_once()
 def test_screen_project_route_cannot_write_files(self):
  # 감사 4: 화면 토큰으로도 /api/project 로 아무 폴더에 파일·설정을 쓰지 못한다(read·stat 만).
  for action in ('save','settings','open'):
   status,_=self.post('/api/project',{'action':action,'folder':self.tmp.name,'name':'a.pdf','data':'eA==','settings':{}})
   self.assertNotEqual(status,200,action)
  self.assertEqual(list(Path(self.tmp.name).iterdir()),[])
 def test_mcp_token_cannot_impersonate_bridge_or_save_shell(self):
  for path in ('/api/bridge','/api/save-target','/api/project'):
   status,_=self.post(path,{'action':'save'},server.MCP_TOKEN)
   self.assertEqual(status,403)
 def test_conversion_cannot_overwrite_newly_created_or_changed_file(self):
  for existed in (False,True):
   target=Path(self.tmp.name)/('existing.dxf' if existed else 'new.dxf')
   if existed:target.write_bytes(b'approved')
   registered=server.register_save_target(str(target),'dxf')
   def convert(*args,**kwargs):target.write_bytes(b'other-window');return b'converted',[]
   with patch.object(exchange,'export_dxf',side_effect=convert):
    status,_=self.post('/api/export',{'document':{},'saveToken':registered['saveToken']})
   self.assertEqual(status,400);self.assertEqual(target.read_bytes(),b'other-window')
   self.assertNotIn(registered['saveToken'],server.SAVE_TARGETS)
   self.assertFalse(Path(str(target)+'.barun-save.lock').exists())
 def test_ai_identity_is_required_if_epoch_is_present(self):
  with self.assertRaises(ValueError):server.register_save_target(str(Path(self.tmp.name)/'a.dxf'),'dxf',{'aiRequestEpoch':3})
 def test_shell_commit_rechecks_original_ai_request_after_temp_write(self):
  target=Path(self.tmp.name)/'a.lsp';target.write_bytes(b'old')
  allowed=True
  def authorize(*args):
   if not allowed:raise ValueError('request stopped')
   return {'authorized':True}
  with patch.object(server,'SHELL_SECRET','test-shell'),patch.object(bridge,'validate_app_request',side_effect=authorize):
   status,reservation=self.post('/api/save-target',{'path':str(target),'format':'lsp','aiRequestId':'request','aiRecipient':'editor'},shell=True)
   self.assertEqual(status,200)
   temporary=Path(reservation['tempPath']);temporary.write_bytes(b'new');allowed=False
   status,_=self.post('/api/save-target',{'action':'commit','saveToken':reservation['saveToken'],'tempPath':str(temporary)},shell=True)
   self.assertNotEqual(status,200);self.assertEqual(target.read_bytes(),b'old')
   server.consume_save_target(reservation['saveToken']);temporary.unlink(missing_ok=True)

if __name__=='__main__':unittest.main()
