import unittest
from pathlib import Path
ROOT = Path(__file__).resolve().parent
class AcadrustBuildTests(unittest.TestCase):
    def setUp(self):
        self.desktop=(ROOT / "build_desktop.py").read_text(encoding="utf-8")
        self.mac=(ROOT / "build_mac_runtimes.py").read_text(encoding="utf-8")
    def test_windows_build_is_locked_and_fails_without_cargo(self):
        self.assertIn("cargo",self.desktop); self.assertIn("build','--release','--locked",self.desktop); self.assertIn("cargo가 없습니다",self.desktop); self.assertIn("barun-dwg2dx",self.desktop)
    def test_mac_arch_targets_and_staging(self):
        self.assertIn("aarch64-apple-darwin",self.mac); self.assertIn("x86_64-apple-darwin",self.mac); self.assertIn("acadrust-runtime-mac-",self.mac); self.assertIn("--target",self.mac)
    def test_runtime_notices_are_copied_and_packaged(self):
        for name in ("LICENSE","NOTICE","THIRD_PARTY_LICENSES.txt"): self.assertIn(name,self.desktop); self.assertIn(name,self.mac)
        self.assertIn("acadrust-runtime",self.desktop)
if __name__ == "__main__": unittest.main()
