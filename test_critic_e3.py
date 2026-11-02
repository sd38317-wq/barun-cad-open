"""검토자(Opus) 최종 잔여 지적 · 장치 이름 빈틈 / 셸 비밀 환경 제거 / 실패 시 토큰 유지 / 세션별 대용량 세대."""
import json,os,subprocess,sys,tempfile,time,unittest
from pathlib import Path
from unittest.mock import patch
import import_stream,server,bridge
from test_critic_e import doc,LiveServer,reset_bridge
from test_critic_e2 import register,SECRET

class LeftoversTest(unittest.TestCase):
    def test_device_names_with_trailing_space_dot_and_superscripts_are_rejected(self):
        with tempfile.TemporaryDirectory() as folder:
            for name in ('con .dxf','CON..dxf','COM¹.dxf','lpt³.tmp.dxf','Nul .dxf','aux.bcad'):
                with self.assertRaises(ValueError,msg=name):server.validate_save_path(str(Path(folder)/name),'bcad' if name.endswith('.bcad') else 'dxf')
            self.assertEqual(server.device_stem('COM¹.dxf'),'COM1');self.assertEqual(server.device_stem('con .dxf'),'CON')
            self.assertEqual(server.validate_save_path(str(Path(folder)/'console.dxf'),'dxf'),Path(folder)/'console.dxf')   # 장치 이름과 비슷한 정상 이름은 통과
    def test_shell_secret_is_removed_from_engine_environment_after_read(self):
        code="import os;os.environ['BARUN_CAD_SHELL_SECRET']='s3cret';import server;print(json.dumps({'env':'BARUN_CAD_SHELL_SECRET' in os.environ,'secret':server.SHELL_SECRET}))"
        result=subprocess.run([sys.executable,'-c','import json;'+code],cwd=str(Path(__file__).parent),capture_output=True,text=True,timeout=120)
        self.assertEqual(result.returncode,0,result.stderr[-500:]);state=json.loads(result.stdout.strip().splitlines()[-1])
        self.assertEqual(state['secret'],'s3cret');self.assertFalse(state['env'])
    def test_save_token_survives_a_failed_export_and_is_consumed_only_on_success(self):
        with tempfile.TemporaryDirectory() as folder, patch.object(server,'SHELL_SECRET',SECRET), LiveServer() as live:
            target=Path(folder)/'plan.dxf'
            status,registered=register(live,str(target),'dxf');self.assertEqual(status,200);token=registered['saveToken']
            broken=doc('B');broken['units']='inch'   # export_dxf 가 거부한다
            status,headers,result=live.post('export',{'document':broken,'saveToken':token});self.assertEqual(status,400);self.assertFalse(target.exists())
            status,headers,result=live.post('export',{'document':doc('B'),'saveToken':token});self.assertEqual(status,200,result);self.assertTrue(target.exists())
            status,headers,result=live.post('export',{'document':doc('B'),'saveToken':token});self.assertEqual(status,400);self.assertIn('만료',result['error'])

class SessionGenerationsTest(unittest.TestCase):
    def setUp(self):reset_bridge()
    def tearDown(self):reset_bridge()
    def test_each_session_keeps_its_newest_large_generation(self):
        with tempfile.TemporaryDirectory() as folder, patch.object(bridge,'RECOVERY',Path(folder)/'recovery-5.json'), LiveServer() as live:
            def store(client,tag):
                body=b''.join(import_stream.iter_lines({'document':doc(tag,bridge.MAX_BRIDGE_ENTITIES+1),'report':{'client':client,'dirty':True}}))
                status,headers,result=live.post('recovery',body=body,content_type=import_stream.CONTENT_TYPE,timeout=120);self.assertEqual(status,200,result);time.sleep(1.05)
            store('aaaa-1111','A1')                       # 세션 A 의 첫 세대
            for tag in ('B1','B2','B3','B4'):store('bbbb-2222',tag)   # 세션 B 가 4분 동안 여러 번 저장
            files=bridge.large_recovery_files();sessions=[bridge.large_session_of(f) for f in files]
            self.assertIn('aaaa1111',sessions);self.assertEqual(sessions.count('bbbb2222'),1);self.assertEqual(len(files),2)   # A 최신 + B 최신
            self.assertEqual(files[0].name.endswith('-bbbb2222.ndjson.gz'),True)
            status,headers,result=live.post('restore',{'probe':True});self.assertEqual(len(result['sources']),2)
            # 용량 상한을 넘으면 세션별 최신이라도 오래된 것부터 지운다
            with patch.object(bridge,'LARGE_MAX_BYTES',files[0].stat().st_size+1):bridge.prune_recovery_files()
            self.assertEqual(len(bridge.large_recovery_files()),1);self.assertEqual(bridge.large_session_of(bridge.large_recovery_files()[0]),'bbbb2222')
            self.assertFalse(list(Path(folder).glob('*.new.*')))

if __name__=='__main__':unittest.main()
