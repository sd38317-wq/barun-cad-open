"""기계어 엔진(우리 모듈만 .pyd): 목록 뽑기·PyInstaller 인자가 맞는지(컴파일 없이)."""
import os,tempfile,unittest
from pathlib import Path
from unittest.mock import patch
import native_build

class NativeBuildTest(unittest.TestCase):
    def test_scan_finds_engine_modules_and_dotted_dependencies(self):
        ours,others=native_build.scan(excludes=('matplotlib','tkinter','fitz','pymupdf','lxml','pyproj'))
        for name in ('server','bridge','mcp_server','vault_gate','cad_asset_client','runtime_paths'):self.assertIn(name,ours)
        self.assertFalse(any(n.startswith(('test_','build_')) for n in ours))
        # .pyd 속 하위 모듈 import 는 PyInstaller 가 못 보므로 점 이름 그대로 넘긴다(빠지면 설치판이 켜지자마자 죽었다).
        self.assertIn('cryptography.hazmat.primitives.ciphers.aead',others)
        self.assertNotIn('pyproj',{n.split('.')[0] for n in others})

    def test_pyinstaller_args_drop_source_and_ship_binary(self):
        with tempfile.TemporaryDirectory() as folder:
            pyd=Path(folder)/('bridge-'+'a'*20+'.cp313-win_amd64.pyd');pyd.write_bytes(b'MZ')
            with patch.object(native_build,'ROOT',Path(folder)):
                args=native_build.pyinstaller_args({'bridge':pyd},['json'])
            i=args.index('--exclude-module');self.assertEqual(args[i+1],'bridge')
            binary=args[args.index('--add-binary')+1]
            self.assertTrue(binary.split(os.pathsep)[0].endswith('bridge.cp313-win_amd64.pyd'),binary)
            self.assertEqual(args[-2:],['--hidden-import','json'])

    def test_entry_serializes_first_imports_before_server(self):
        # 기계어 모듈을 두 스레드가 동시에 처음 불러오면 엔진이 죽는다 — 진입점이 server 를 부르기 전에 import 를 한 줄로 세워야 한다.
        text=(native_build.ROOT/native_build.ENTRY).read_text(encoding='utf-8')
        self.assertLess(text.index('builtins.__import__ = _serial_import'),text.index('from server import main'))
        self.assertLess(text.index('importlib.import_module = _serial_import_module'),text.index('from server import main'))
        self.assertNotIn('import server',text.split('from server import main')[0])

    def test_entry_lock_never_hands_out_a_half_initialized_module(self):
        # 다른 스레드가 초기화 중인 모듈을 받아 가면 안 되고, sys.modules 의 None 은 ImportError 여야 한다(아스트라 검토 10-21).
        import subprocess,sys
        code=r"""
import sys,threading,time,importlib,importlib.abc,importlib.util
exec(open(sys.argv[1],encoding='utf-8').read().split('from server import main')[0])
started=threading.Event()
class Slow(importlib.abc.Loader,importlib.abc.MetaPathFinder):
    def find_spec(self,n,p,t=None): return importlib.util.spec_from_loader(n,self) if n=='slowmod' else None
    def create_module(self,spec): return None
    def exec_module(self,m): started.set(); time.sleep(0.3); m.READY=True
sys.meta_path.insert(0,Slow())
got={}
a=threading.Thread(target=lambda:got.setdefault('a',__import__('slowmod')));a.start();started.wait()
b=threading.Thread(target=lambda:got.setdefault('b',getattr(__import__('slowmod'),'READY',None)))
c=threading.Thread(target=lambda:got.setdefault('c',getattr(importlib.import_module('slowmod'),'READY',None)))
b.start();c.start();a.join();b.join();c.join()
sys.modules['blocked_mod']=None
try:importlib.import_module('blocked_mod');none='returned'
except ImportError:none='ImportError'
print(got['b'],got['c'],none)
"""
        out=subprocess.run([sys.executable,'-I','-c',code,str(native_build.ROOT/native_build.ENTRY)],capture_output=True,text=True,timeout=60)
        self.assertEqual(out.stdout.split(),['True','True','ImportError'],out.stderr)

if __name__=='__main__':unittest.main()
