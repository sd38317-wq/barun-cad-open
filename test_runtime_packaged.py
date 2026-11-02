"""설치판 판별: PyInstaller(sys.frozen)와 Nuitka(__compiled__) 둘 다 설치판으로 보고, 실행 파일 경로를 맞게 준다."""
import sys,unittest
from unittest.mock import patch
import runtime_paths

class PackagedTest(unittest.TestCase):
    def test_pyinstaller_uses_sys_executable(self):
        with patch.object(sys,'frozen',True,create=True),patch.object(sys,'executable',r'C:\app\barun-cad-6-server.exe'):
            self.assertTrue(runtime_paths.packaged())
            self.assertEqual(runtime_paths.packaged_executable(),r'C:\app\barun-cad-6-server.exe')

    def test_nuitka_uses_argv0_not_virtual_python(self):
        with patch.dict(runtime_paths.__dict__,{'__compiled__':object()}),patch.object(sys,'argv',[r'C:\app\barun-cad-6-server.exe','--mcp']):
            self.assertTrue(runtime_paths.packaged())
            self.assertTrue(runtime_paths.packaged_executable().endswith('barun-cad-6-server.exe'))

    def test_source_run_is_not_packaged(self):
        self.assertFalse(runtime_paths.packaged())

if __name__=='__main__':unittest.main()
