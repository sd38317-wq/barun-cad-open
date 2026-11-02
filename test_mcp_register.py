"""처음 사용자용 AI 연결: Claude·Codex 설정에 바른 CAD MCP 만 넣고 나머지는 그대로 두는지."""
import json,os,tempfile,tomllib,unittest
from pathlib import Path
from unittest.mock import patch
import mcp_register as reg

EXE=r'C:\Program Files\Barun\Barun CAD 6\resources\backend\barun-cad-6-server.exe'


class CodexTomlTest(unittest.TestCase):
    def test_replaces_only_our_table_and_keeps_user_settings(self):
        before=("model = 'gpt-6'\n\n[mcp_servers.other]\ncommand = 'x'\n\n"
                "[mcp_servers.barun-cad]\ncommand = 'C:\\Python\\python.exe'\nargs = ['D:\\어플\\캐드\\mcp_server.py']\n\n"
                "[mcp_servers.barun-cad.env]\nPYTHONDONTWRITEBYTECODE = \"1\"\n\n"
                "[mcp_servers.barun-cad.tools.cad_get_document]\napproval_mode = \"approve\"\n\n[projects.'d:\\']\ntrust_level = \"trusted\"\n")
        after=tomllib.loads(reg.replace_codex_entry(before,EXE,['--mcp']))
        self.assertEqual(after['model'],'gpt-6')
        self.assertEqual(after['mcp_servers']['other'],{'command':'x'})
        ours=after['mcp_servers']['barun-cad']
        self.assertEqual((ours['command'],ours['args']),(EXE,['--mcp']))
        self.assertNotIn('env',ours)   # 개발판 python 용 env 는 지운다
        self.assertEqual(ours['tools']['cad_get_document'],{'approval_mode':'approve'})   # 사용자가 준 승인은 남긴다
        self.assertEqual(after['projects']['d:\\']['trust_level'],'trusted')

    def test_empty_file_and_quote_in_path(self):
        self.assertEqual(tomllib.loads(reg.replace_codex_entry('',EXE,['--mcp']))['mcp_servers']['barun-cad']['command'],EXE)
        odd="C:\\Users\\O'Neil\\server.exe"
        self.assertEqual(tomllib.loads(reg.replace_codex_entry('',odd,['--mcp']))['mcp_servers']['barun-cad']['command'],odd)


class RegisterTest(unittest.TestCase):
    def setUp(self):
        self.folder=tempfile.TemporaryDirectory();home=Path(self.folder.name)
        self.home=home
        patches=[patch.object(reg,'_home',lambda:home),patch.object(reg,'server_command',lambda:(EXE,['--mcp'])),
                 patch.object(reg,'_claude_cli',lambda:None),patch.dict(os.environ,{'APPDATA':str(home/'Roaming'),'CODEX_HOME':str(home/'.codex')})]
        for p in patches:p.start();self.addCleanup(p.stop)
        self.addCleanup(self.folder.cleanup)

    def test_nothing_installed_is_a_plain_error(self):
        for client in ('claude','codex'):
            with self.assertRaises(ValueError):reg.register(client)

    def test_codex_written_backed_up_and_idempotent(self):
        config=self.home/'.codex'/'config.toml';config.parent.mkdir()
        config.write_text("model = 'gpt-6'\n",encoding='utf-8')
        result=reg.register('codex')
        self.assertTrue(result['ok']);self.assertEqual(result['results'],[{'app':'Codex','state':'registered'}])
        self.assertEqual(tomllib.loads(config.read_text(encoding='utf-8'))['mcp_servers']['barun-cad']['args'],['--mcp'])
        self.assertEqual(len(list(config.parent.glob('config.toml.barun-backup-*'))),1)
        self.assertEqual(reg.register('codex')['results'][0]['state'],'already')
        self.assertEqual(reg.status()['apps'],[{'app':'Codex','state':'ok'}])

    def test_claude_desktop_and_code_keep_other_servers(self):
        desktop=self.home/'Roaming'/'Claude'/'claude_desktop_config.json';desktop.parent.mkdir(parents=True)
        desktop.write_text(json.dumps({'mcpServers':{'other':{'command':'x'}},'theme':'dark'}),encoding='utf-8')
        code=self.home/'.claude.json';code.write_text(json.dumps({'numStartups':3,'mcpServers':{'barun-cad':{'command':'old'}}}),encoding='utf-8')
        # 설정 파일에 직접 쓰는 윈도우 길. 맥 데스크톱은 확장(.mcpb)으로 간다 → ClaudeExtensionTest
        with patch.object(reg.sys,'platform','win32'),patch.object(reg,'claude_desktop_config',lambda:desktop):result=reg.register('claude')
        self.assertEqual({r['app']:r['state'] for r in result['results']},{'Claude 데스크톱':'registered','Claude Code':'registered'})
        d=json.loads(desktop.read_text(encoding='utf-8'))
        self.assertEqual(d['theme'],'dark');self.assertEqual(d['mcpServers']['other'],{'command':'x'})
        self.assertEqual(d['mcpServers']['barun-cad'],{'command':EXE,'args':['--mcp'],'env':{}})
        c=json.loads(code.read_text(encoding='utf-8'))
        self.assertEqual(c['numStartups'],3);self.assertEqual(c['mcpServers']['barun-cad']['type'],'stdio')
        self.assertIn('다시 켜야',result['message'])

    def test_broken_json_is_left_alone(self):
        code=self.home/'.claude.json';code.write_text('{not json',encoding='utf-8')
        result=reg.register('claude')
        self.assertFalse(result['ok']);self.assertEqual(code.read_text(encoding='utf-8'),'{not json')


if __name__=='__main__':unittest.main()


class RelayCopyTest(unittest.TestCase):
    """업데이트 설치가 barun-cad-6-server.exe 를 모두 꺼도 Codex·Claude 의 중계는 살아 있어야 한다(10/21 Transport closed)."""
    def setUp(self):
        self.folder=tempfile.TemporaryDirectory();self.addCleanup(self.folder.cleanup)
        base=Path(self.folder.name)
        self.backend=base/'Program Files'/'backend';(self.backend/'_internal').mkdir(parents=True)
        self.exe=self.backend/'barun-cad-6-server.exe';self.exe.write_bytes(b'engine-v1')
        (self.backend/'_internal'/'mod.py').write_text('x',encoding='utf-8')
        self.root=base/'.barun-cad'/'mcp-relay'
        p=patch.object(reg,'RELAY_ROOT',self.root);p.start();self.addCleanup(p.stop)

    def test_copy_outside_install_folder_with_other_name_and_reused(self):
        relay=reg.ensure_relay(self.exe)
        self.assertEqual(relay.name,reg.RELAY_EXE);self.assertEqual(relay.read_bytes(),b'engine-v1')   # 맥은 .exe 없이
        self.assertTrue((relay.parent/'_internal'/'mod.py').is_file())
        self.assertTrue(reg.is_relay_path(relay));self.assertFalse(reg.is_relay_path(self.exe))
        self.assertEqual(reg.ensure_relay(self.exe),relay)   # 같은 판은 다시 복사하지 않는다

    def test_new_version_gets_new_copy_and_old_copy_is_removed_unless_running(self):
        old=reg.ensure_relay(self.exe)
        self.exe.write_bytes(b'engine-v2')
        real_unlink=Path.unlink
        def locked(path,*a,**k):
            if path==old:raise PermissionError('running')
            return real_unlink(path,*a,**k)
        with patch.object(Path,'unlink',locked):new=reg.ensure_relay(self.exe)
        self.assertNotEqual(new.parent,old.parent);self.assertTrue(old.is_file())   # 도는 옛 중계는 그대로
        self.exe.write_bytes(b'engine-v3');reg.ensure_relay(self.exe)
        self.assertFalse(old.parent.exists())   # 꺼진 옛 중계는 지운다

    @unittest.skipIf(os.name=='nt','마용: PosixPath·sh 실행은 마에서 돈다')
    def test_mac_keeps_running_old_relay_and_recognizes_mac_engine(self):
        # 2026-10-26 맥: 도는 실행 파일도 지워져서 정리가 돌던 중계를 깨뜨릴 수 있었다 → 프로세스 목록으로 거른다
        old=reg.ensure_relay(self.exe);self.exe.write_bytes(b'engine-v2')
        with patch.object(reg.os,'name','posix'),patch.object(reg,'_running',lambda exe:exe==old):new=reg.ensure_relay(self.exe)
        self.assertNotEqual(new.parent,old.parent);self.assertTrue(old.is_file())
        self.assertTrue(reg._ours('/Applications/Barun CAD 6.app/Contents/Resources/backend/barun-cad-6-server'))   # 맥 엔진(.exe 없음)
        self.assertFalse(reg._ours('/usr/local/bin/my-server'))

    def test_codex_entry_approves_only_read_tools_and_waits_longer(self):
        # 사용자 결정(10/22): 읽기 도구만 자동 승인, 도면을 바꾸는 도구는 Codex 승인 그대로
        import bridge
        entry=tomllib.loads(reg.replace_codex_entry('',str(self.exe),['--mcp']))['mcp_servers']['barun-cad']
        self.assertNotIn('default_tools_approval_mode',entry)
        tools=entry['tools']
        for name in ('cad_get_document','cad_get_job','cad_view_drawing','cad_search_units','cad_describe_command','cad_preview','cad_check_daylight'):
            self.assertEqual(tools[name],{'approval_mode':'approve'},name)
        self.assertFalse(set(tools)&set(bridge.MUTATING_TOOLS))
        for name in ('cad_execute','cad_save','cad_run_command','cad_open_file','cad_close_document','cad_lisp_run','cad_plot_pdf'):self.assertNotIn(name,tools)
        self.assertGreaterEqual(entry['startup_timeout_sec'],60);self.assertGreaterEqual(entry['tool_timeout_sec'],180)


class RefreshTest(unittest.TestCase):
    def setUp(self):
        self.folder=tempfile.TemporaryDirectory();self.addCleanup(self.folder.cleanup);home=Path(self.folder.name);self.home=home
        self.new=str(home/'.barun-cad'/'mcp-relay'/'abc'/'barun-cad-mcp.exe')
        for p in [patch.object(reg,'_home',lambda:home),patch.object(reg,'server_command',lambda:(self.new,['--mcp'])),
                  patch.object(reg,'_claude_cli',lambda:None),patch.dict(os.environ,{'APPDATA':str(home/'Roaming'),'CODEX_HOME':str(home/'.codex')})]:
            p.start();self.addCleanup(p.stop)

    def test_only_our_old_entries_move_to_the_new_relay(self):
        codex=self.home/'.codex'/'config.toml';codex.parent.mkdir()
        codex.write_text(f"[mcp_servers.barun-cad]\ncommand = '{EXE}'\nargs = ['--mcp']\n",encoding='utf-8')
        code=self.home/'.claude.json';code.write_text(json.dumps({'mcpServers':{'barun-cad':{'command':'C:/mine/custom.exe','args':[]}}}),encoding='utf-8')
        self.assertEqual(reg.refresh_existing(),['Codex'])
        self.assertEqual(tomllib.loads(codex.read_text(encoding='utf-8'))['mcp_servers']['barun-cad']['command'],self.new)
        self.assertEqual(json.loads(code.read_text(encoding='utf-8'))['mcpServers']['barun-cad']['command'],'C:/mine/custom.exe')   # 사용자가 바꾼 것은 그대로
        self.assertEqual(reg.refresh_existing(),[])   # 이미 맞으면 다시 쓰지 않는다


@unittest.skipIf(os.name=='nt','마용: PosixPath·sh 실행은 마에서 돈다')
class ClaudeExtensionTest(unittest.TestCase):
    """맥 Claude 데스크톱: 켜진 Claude 가 설정 파일을 덮어써 연결이 사라졌다(10/26) → 확장(.mcpb)을 Claude 앱으로 연다."""
    def setUp(self):
        self.folder=tempfile.TemporaryDirectory();self.addCleanup(self.folder.cleanup);home=Path(self.folder.name);self.home=home
        self.root=home/'.barun-cad'/'mcp-relay';self.root.mkdir(parents=True)
        for p in [patch.object(reg,'_home',lambda:home),patch.object(reg,'RELAY_ROOT',self.root),patch.object(reg.sys,'platform','darwin'),
                  patch.object(reg.os,'name','posix'),patch.object(reg,'_claude_cli',lambda:None)]:
            p.start();self.addCleanup(p.stop)

    def test_bundle_has_manifest_and_launcher_runs_current_relay(self):
        import subprocess,zipfile
        bundle=reg.build_claude_extension(['/bin/echo','fallback'])
        with zipfile.ZipFile(bundle) as z:
            manifest=json.loads(z.read('manifest.json'));script=z.getinfo('server/launch.sh')
            (self.home/'x').mkdir();z.extractall(self.home/'x')
        self.assertEqual(manifest['server']['type'],'binary');self.assertEqual(manifest['name'],'barun-cad')
        self.assertEqual(manifest['server']['mcp_config']['args'],['${__dirname}/server/launch.sh'])
        self.assertEqual(script.external_attr>>16&0o777,0o755)
        launch=str(self.home/'x'/'server'/'launch.sh');env={'HOME':str(self.home),'PATH':'/usr/bin:/bin'}
        self.assertEqual(subprocess.run(['/bin/sh',launch],capture_output=True,text=True,env=env).stdout.strip(),'fallback --mcp')
        relay=self.root/'abc'/'barun-cad-mcp';relay.parent.mkdir();relay.write_text('#!/bin/sh\necho relay "$@"\n');relay.chmod(0o755)
        reg._write_pointer(relay)
        self.assertEqual(subprocess.run(['/bin/sh',launch],capture_output=True,text=True,env=env).stdout.strip(),'relay --mcp')

    def test_desktop_gets_extension_not_config_edit(self):
        desktop=self.home/'Library'/'Application Support'/'Claude'/'claude_desktop_config.json';desktop.parent.mkdir(parents=True)
        desktop.write_text('{"mcpServers":{}}',encoding='utf-8')
        calls=[]
        def fake_run(cmd,**k):
            calls.append(cmd);return type('R',(),{'returncode':0,'stderr':''})()
        with patch.object(reg.subprocess,'run',fake_run):result=reg.register('claude')
        self.assertEqual(result['results'],[{'app':'Claude 데스크톱','state':'opened'}])
        self.assertEqual(calls[0][:3],['open','-a','Claude']);self.assertTrue(calls[0][3].endswith('barun-cad.mcpb'))
        self.assertEqual(desktop.read_text(encoding='utf-8'),'{"mcpServers":{}}')   # 설정 파일은 건드리지 않는다
        self.assertIn('[설치]',result['message'])
        ext=desktop.parent/'Claude Extensions'/'local.mcpb.barun.barun-cad';ext.mkdir(parents=True);(ext/'manifest.json').write_text('{}')
        with patch.object(reg,'server_command',lambda:('x',['--mcp'])):
            self.assertEqual(reg.status()['apps'],[{'app':'Claude 데스크톱','state':'ok'}])
