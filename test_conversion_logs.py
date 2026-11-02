"""S9/S15 · 변환 로그 회전과 프로젝트 저장 fsync 검사."""
import os,tempfile,time,unittest
from pathlib import Path
from unittest.mock import patch
import batch_converter,project

class ConversionLogRotationTest(unittest.TestCase):
    def test_rotate_keeps_newest_within_count_and_size(self):
        with tempfile.TemporaryDirectory() as folder:
            for index in range(30):
                item=Path(folder)/f'{index:02}.json';item.write_text('x'*100);os.utime(item,(time.time()-index,time.time()-index))
            removed=batch_converter.rotate_logs(folder,keep=20,max_bytes=10**6)
            self.assertEqual(removed,10);self.assertTrue((Path(folder)/'00.json').exists());self.assertFalse((Path(folder)/'29.json').exists())
            batch_converter.rotate_logs(folder,keep=100,max_bytes=550)
            self.assertLessEqual(len(list(Path(folder).glob('*.json'))),6)
    def test_process_writes_log_and_rotates(self):
        with tempfile.TemporaryDirectory() as folder, patch.dict(os.environ,{'LOCALAPPDATA':folder}), patch.object(batch_converter,'LOG_KEEP',3):
            for _ in range(5):batch_converter.process({'action':'convert','name':'bad','direction':'dwg-dxf','folder':folder})
            self.assertEqual(len(list((Path(folder)/'BarunCAD'/'conversion-logs').glob('*.json'))),3)

class ProjectFsyncTest(unittest.TestCase):
    def test_atomic_calls_fsync_before_replace(self):
        with tempfile.TemporaryDirectory() as folder:
            calls=[]
            real=os.fsync
            with patch.object(project.os,'fsync',lambda fd:(calls.append(fd),real(fd))[1]):
                project.atomic(Path(folder)/'a.dxf',b'hello')
            self.assertEqual(len(calls),1);self.assertEqual((Path(folder)/'a.dxf').read_bytes(),b'hello')
            self.assertEqual([p.name for p in Path(folder).iterdir()],['a.dxf'])

if __name__=='__main__':unittest.main()
