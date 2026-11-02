"""맥 Codex 찾기(2026-10-26): Finder 에서 켠 앱은 PATH 가 짧다 — nvm 에 깐 codex 도 찾고, node 가 같은 폴더에서 보이게 한다."""
import os,stat,sys,tempfile,unittest
from pathlib import Path
from unittest.mock import patch
import codex_chat

@unittest.skipIf(os.name=='nt','맥·리눅스 경로 시험')
class CodexDiscoveryTests(unittest.TestCase):
    def test_newest_nvm_codex_is_found_and_its_node_folder_leads_path(self):
        with tempfile.TemporaryDirectory() as home:
            for version in ('v18.20.1','v24.21.0','v9.0.0'):
                exe=Path(home)/'.nvm/versions/node'/version/'bin'/'codex';exe.parent.mkdir(parents=True);exe.write_text('#!/usr/bin/env node\n')
                exe.chmod(exe.stat().st_mode|stat.S_IXUSR)
            with patch.object(Path,'home',lambda:Path(home)),patch.object(codex_chat.shutil,'which',lambda name:None),patch.object(codex_chat,'_login_shell_codex',lambda:None),\
                 patch.object(Path,'is_file',lambda self:str(self).startswith(home) and os.path.isfile(self)):
                exe=codex_chat._posix_executable()
            self.assertIn('v24.21.0',exe)
            self.assertTrue(codex_chat.child_env(exe)['PATH'].startswith(str(Path(exe).parent)+os.pathsep))

if __name__=='__main__':unittest.main()
