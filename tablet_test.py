import unittest,json,urllib.request,urllib.error,time,os
os.environ['BARUN_TABLET_PORT']='0'
import tablet
class TabletTest(unittest.TestCase):
 def setUp(self):
  self.owner='test-owner-123456789';self.info=tablet.local({'action':'start','owner':self.owner,'address':'127.0.0.1'});self.base='http://127.0.0.1:'+str(tablet.SERVER.server_port)
 def tearDown(self):tablet.stop()
 def post(self,path,data):
  req=urllib.request.Request(self.base+path,json.dumps(data).encode(),{'Content-Type':'application/json','Origin':self.base})
  try:
   with urllib.request.urlopen(req) as r:return r.status,json.load(r)
  except urllib.error.HTTPError as e:return e.code,json.load(e)
 def test_pair_queue_replay_and_stop(self):
  self.assertNotEqual(self.post('/pair',{'code':'bad'})[0],200)
  status,r=self.post('/pair',{'code':self.info['code']});self.assertEqual(status,200);token=r['token']
  self.assertNotEqual(self.post('/pair',{'code':self.info['code']})[0],200)
  data={'token':token,'seq':1,'events':[{'kind':'point','phase':'down','x':.5,'y':.5}]}
  self.assertEqual(self.post('/input',data)[0],200);self.post('/input',data)
  result=tablet.local({'action':'poll','owner':self.owner});self.assertEqual(len(result['events']),1)
  tablet.local({'action':'stop','owner':self.owner});self.assertIsNone(tablet.SERVER)   # BC-03: 종료하면 LAN 소켓도 닫힌다
  try:self.assertNotEqual(self.post('/input',data)[0],200)
  except urllib.error.URLError:pass
 def test_no_commands_or_files_and_timeout(self):
  _,r=self.post('/pair',{'code':self.info['code']});self.assertNotEqual(self.post('/input',{'token':r['token'],'seq':0,'events':[{'kind':'execute','command':'delete'}]})[0],200)
  tablet.STATE['seen']=time.monotonic()-4
  self.assertFalse(tablet.local({'action':'poll','owner':self.owner})['connected'])
  with self.assertRaises(urllib.error.HTTPError):urllib.request.urlopen(self.base+'/app.js')
 def test_frame_requires_pair_and_owner(self):
  tablet.local({'action':'frame','owner':self.owner,'image':'data:image/jpeg;base64,AAAA','width':1200,'height':800})
  self.assertEqual(self.post('/frame',{'token':'bad'})[0],403)
  _,paired=self.post('/pair',{'code':self.info['code']})
  status,r=self.post('/frame',{'token':paired['token']});self.assertEqual(status,200);self.assertEqual(r['frame']['width'],1200)
  self.assertIsNone(self.post('/frame',{'token':paired['token'],'after':r['frame']['id']})[1]['frame'])
 def test_owner_and_expiration(self):
  with self.assertRaises(ValueError):tablet.local({'action':'poll','owner':'other-owner-123456'})
  tablet.STATE['expires']=0;self.assertNotEqual(self.post('/pair',{'code':self.info['code']})[0],200)
 def test_binds_single_selected_address_not_all_interfaces(self):
  self.assertEqual(tablet.SERVER.server_address[0],'127.0.0.1');self.assertEqual(self.info['bound'],'127.0.0.1')
  self.assertEqual(self.info['urls'],['http://127.0.0.1:'+str(tablet.SERVER.server_port)])
  with self.assertRaises(ValueError):tablet.local({'action':'start','owner':self.owner,'address':'8.8.8.8'})
  self.assertEqual(tablet.choose_address(None,['169.254.1.1','192.168.0.7','8.8.4.4']),'192.168.0.7')
 def test_global_attempt_cap_closes_pairing(self):
  tablet.STATE['attempts']={}
  for index in range(tablet.ATTEMPTS_TOTAL):
   with tablet.LOCK:tablet.STATE['attempts']={}  # 같은 IP 제한을 우회해도 전체 횟수 제한에 걸린다
   status,_=self.post('/pair',{'code':'000000' if self.info['code']!='000000' else '111111'})
   self.assertNotEqual(status,200)
   if tablet.SERVER is None:break
  self.assertIsNone(tablet.SERVER);self.assertGreaterEqual(index+1,tablet.ATTEMPTS_TOTAL)
  with self.assertRaises(ValueError) as caught:tablet.local({'action':'poll','owner':self.owner})
  self.assertIn('너무 많아',str(caught.exception))
 def test_idle_and_pair_window_auto_shutdown(self):
  tablet.STATE['expires']=time.monotonic()-1
  tablet._watchdog();self.assertIsNone(tablet.SERVER)
  self.info=tablet.local({'action':'start','owner':self.owner,'address':'127.0.0.1'});self.base='http://127.0.0.1:'+str(tablet.SERVER.server_port)
  _,r=self.post('/pair',{'code':self.info['code']});self.assertIn('token',r)
  tablet.STATE['seen']=time.monotonic()-tablet.IDLE_LIMIT_SECONDS-1
  tablet._watchdog();self.assertIsNone(tablet.SERVER)
  self.assertTrue(self.info['expiresIn']<=180)
 def test_claim_moves_pad_to_active_window_without_repairing(self):
  _,r=self.post('/pair',{'code':self.info['code']});token=r['token']
  other='other-window-owner-1234'
  self.assertEqual(tablet.local({'action':'claim','owner':self.owner})['active'],True)
  self.post('/input',{'token':token,'seq':0,'events':[{'kind':'point','phase':'down','mode':'mark','x':.5,'y':.5}]})
  claimed=tablet.local({'action':'claim','owner':other});self.assertTrue(claimed['active']);self.assertTrue(claimed['paired'])
  self.assertTrue(tablet.local({'action':'poll','owner':self.owner})['moved'])
  self.post('/input',{'token':token,'seq':1,'events':[{'kind':'clear'}]})
  self.assertEqual(tablet.local({'action':'poll','owner':other})['events'],[{'kind':'clear'}])
  tablet.stop();self.assertFalse(tablet.local({'action':'claim','owner':other})['active'])
 def test_info_text_and_queue_keeps_stroke_ends(self):
  _,r=self.post('/pair',{'code':self.info['code']});token=r['token']
  tablet.local({'action':'frame','owner':self.owner,'image':'data:image/jpeg;base64,AAAA','width':10,'height':10,'info':{'drawing':'A-101','unitsPerPixel':12.5,'evil':'x'}})
  self.assertEqual(self.post('/frame',{'token':token})[1]['info'],{'drawing':'A-101','unitsPerPixel':12.5})
  self.assertEqual(self.post('/input',{'token':token,'seq':0,'events':[{'kind':'ask','text':'문 300 아래로'},{'kind':'text','x':.2,'y':.3,'text':'거실','as':'text'}]})[0],200)
  self.assertNotEqual(self.post('/input',{'token':token,'seq':1,'events':[{'kind':'text','text':'x'*501}]})[0],200)
  tablet.local({'action':'poll','owner':self.owner})
  events=[{'kind':'point','phase':'down','mode':'mark','x':0,'y':0}]+[{'kind':'point','phase':'move','mode':'mark','x':i/5000,'y':0} for i in range(255)]
  for seq in range(2,20):self.post('/input',{'token':token,'seq':seq,'events':events if seq==2 else [{'kind':'point','phase':'move','mode':'mark','x':.1,'y':.1}]*255+([{'kind':'point','phase':'up','mode':'mark','x':.2,'y':.2}] if seq==19 else [])})
  queue=tablet.local({'action':'poll','owner':self.owner})['events']
  self.assertLessEqual(len(queue),tablet.QUEUE_LIMIT);self.assertEqual(queue[0]['phase'],'down');self.assertEqual(queue[-1]['phase'],'up')
 def test_pad_page_sends_csp_header(self):
  with urllib.request.urlopen(self.base+'/') as r:self.assertIn("script-src 'self'",r.headers.get('Content-Security-Policy',''))
if __name__=='__main__':unittest.main()
