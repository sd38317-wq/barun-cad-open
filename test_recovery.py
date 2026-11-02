import json,tempfile,unittest,time,os
from pathlib import Path
from unittest.mock import patch
import bridge

def reset_bridge():
    bridge.flush_recovery()
    bridge.clients.clear();bridge.queue.clear();bridge.results.clear();bridge.active=None
    bridge._written=None;bridge._has_content=None
    with bridge._write_lock:bridge._pending=None;bridge._last_error=None;bridge._last_write=0.0

class RecoveryTests(unittest.TestCase):
    def setUp(self):reset_bridge()
    def tearDown(self):reset_bridge()
    def test_rotation_noop_and_corrupt_fallback(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(bridge,'RECOVERY',Path(directory)/'recovery.json'):
            for value in (1,2,2,3):bridge.write_recovery({'document':{'entities':[value]}})
            self.assertEqual(bridge.restore()['document']['entities'],[3])
            self.assertEqual(json.loads(bridge.RECOVERY.with_suffix('.bak2').read_text())['document']['entities'],[1])
            bridge.RECOVERY.write_text('{broken',encoding='utf8')
            restored=bridge.restore();self.assertEqual(restored['document']['entities'],[2]);self.assertIn('recoveryWarning',restored)
            bridge.write_recovery({'document':{'entities':[4]}})
            self.assertEqual(json.loads(bridge.RECOVERY.with_suffix('.bak').read_text())['document']['entities'],[2])
    def test_empty_recovery_returns_empty(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(bridge,'RECOVERY',Path(directory)/'recovery.json'):
            self.assertEqual(bridge.restore(),{})

    # S5: 채널(포트)마다 다른 파일. 이전 판의 공용 파일은 읽기만 한다.
    def test_recovery_file_is_namespaced_by_instance_and_reads_legacy(self):
        with tempfile.TemporaryDirectory() as directory, patch.dict(os.environ,{'BARUN_CAD_RECOVERY_DIR':directory}):
            self.assertEqual(bridge.recovery_file('18767').name,'recovery-18767.json')
            self.assertEqual(bridge.recovery_file('').name,'recovery.json')
            self.assertEqual(bridge.recovery_file('../x').name,'recovery-x.json')
            with patch.object(bridge,'RECOVERY',Path(directory)/'recovery-18767.json'):
                (Path(directory)/'recovery.json').write_text(json.dumps({'document':{'entities':['legacy']}}),encoding='utf8')
                restored=bridge.restore();self.assertEqual(restored['document']['entities'],['legacy']);self.assertIn('이전 판',restored['recoveryWarning'])
                bridge.write_recovery({'document':{'entities':['new']}})
                self.assertEqual(bridge.restore()['document']['entities'],['new'])
                self.assertEqual(json.loads((Path(directory)/'recovery.json').read_text())['document']['entities'],['legacy'])

    # S2: 새 실행의 빈 문서가 내용 있는 복구본을 덮지 않고, 직전 세션은 별도 세대로 남는다.
    def test_fresh_launch_preserves_previous_session_and_empty_document_does_not_overwrite(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(bridge,'RECOVERY',Path(directory)/'recovery-1.json'), patch.object(bridge,'RECOVERY_DEBOUNCE_SECONDS',0.0):
            bridge.write_recovery({'document':{'entities':['previous']},'dirty':True})
            previous_stat=bridge.RECOVERY.stat()
            empty={'entities':[]}
            r=bridge.pulse({'client':'new','revision':0,'active':True,'freshLaunch':True,'document':empty,'results':[]})
            bridge.flush_recovery()
            self.assertFalse(r['needDocument'])
            self.assertEqual(json.loads(bridge.RECOVERY.read_text(encoding='utf8'))['document']['entities'],['previous'])
            self.assertEqual(bridge.RECOVERY.stat().st_mtime_ns,previous_stat.st_mtime_ns)
            last=bridge.last_session_file();self.assertTrue(last.is_file())
            self.assertEqual(json.loads(last.read_text(encoding='utf8'))['document']['entities'],['previous'])
            # 편집이 생기면(dirty 또는 객체) 그때부터 쓴다
            bridge.pulse({'client':'new','revision':1,'active':True,'document':{'entities':['edited']},'results':[]});bridge.flush_recovery()
            self.assertEqual(bridge.restore()['document']['entities'],['edited'])
            self.assertEqual(json.loads(bridge.RECOVERY.with_suffix('.bak').read_text(encoding='utf8'))['document']['entities'],['previous'])
            # 사용자가 일부러 비운(dirty) 문서는 저장한다
            bridge.pulse({'client':'new','revision':2,'active':True,'dirty':True,'document':empty,'results':[]});bridge.flush_recovery()
            self.assertEqual(bridge.restore()['document']['entities'],[])

    # S6: 디스크 쓰기는 lock 밖에서 모아 쓴다. 5만 객체를 넘는 문서는 오지 않으며 조회 시 안내한다.
    def test_debounced_background_write_and_omitted_document(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(bridge,'RECOVERY',Path(directory)/'recovery-2.json'), patch.object(bridge,'RECOVERY_DEBOUNCE_SECONDS',0.3):
            for revision in range(1,6):
                bridge.pulse({'client':'c','revision':revision,'active':True,'document':{'entities':[revision]},'results':[]})
            self.assertFalse(bridge.RECOVERY.exists())   # 아직 배경 스레드가 쓰기 전
            time.sleep(0.6)
            self.assertEqual(json.loads(bridge.RECOVERY.read_text(encoding='utf8'))['document']['entities'],[5])
            self.assertFalse(bridge.RECOVERY.with_suffix('.bak').exists())   # 다섯 번 편집이 한 번의 쓰기로 모였다
            r=bridge.pulse({'client':'c','revision':6,'active':True,'documentOmitted':True,'entityCount':120000,'results':[]})
            self.assertFalse(r['needDocument'])
            with self.assertRaises(ValueError) as caught:bridge.snapshot()
            self.assertIn('120,000',str(caught.exception))
            bridge.pulse({'client':'c','revision':7,'active':True,'document':{'entities':[7]},'results':[]});bridge.flush_recovery()
            self.assertEqual(bridge.snapshot()['document']['entities'],[7])

    def test_large_document_message_names_block_weight_when_top_level_is_under_limit(self):
        # 최상위 46,525개인데 "50,000개 이하에서 쓰라"고 하던 모순 메시지.
        message=bridge.large_document_message(46525)
        self.assertIn('블록 정의 안 객체까지 합치면 50,000개를 넘어',message);self.assertIn('최상위 객체 46,525개',message)
        self.assertNotIn('블록 정의 안',bridge.large_document_message(120000).split('지원하지')[0])

    def test_write_failure_is_reported_once_per_pulse_not_raised(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(bridge,'RECOVERY',Path(directory)/'missing'/'x'/'recovery.json'), patch.object(bridge,'RECOVERY_DEBOUNCE_SECONDS',0.0):
            with patch.object(bridge.Path,'mkdir',side_effect=OSError('denied')):
                bridge.pulse({'client':'c','revision':1,'active':True,'document':{'entities':[1]},'results':[]});bridge.flush_recovery()
                r=bridge.pulse({'client':'c','revision':2,'active':True,'results':[]})
            self.assertIn('recoveryError',r)

if __name__=='__main__':unittest.main()
