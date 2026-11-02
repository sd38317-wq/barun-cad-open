"""코드 서명 설정·확인(code_signing.py)과 build_desktop.py 의 서명·퓨즈 단계 — 빌드 없이 돈다."""
from pathlib import Path
import json,tempfile,types,unittest
import code_signing as cs

ROOT=Path(__file__).parent
FULL={'BARUN_SIGN_ENDPOINT':'https://krc.codesigning.azure.net/','BARUN_SIGN_ACCOUNT':'barun-sign','BARUN_SIGN_PROFILE':'barun-public','BARUN_SIGN_PUBLISHER':'Barun Co., Ltd.'}

class Load(unittest.TestCase):
    def setUp(self):
        self.dir=tempfile.TemporaryDirectory();self.addCleanup(self.dir.cleanup)
        self.settings=Path(self.dir.name)/'code-signing.json'
        self.policy=Path(self.dir.name)/'policy.json';self.policy.write_text('{"required": false}',encoding='utf8')
    def env(self,**values):return {'BARUN_SIGN_SETTINGS':str(self.settings),**values}

    def test_nothing_set_builds_unsigned(self):
        self.assertEqual(cs.load(self.env(),self.policy),(None,{}))

    def test_policy_required_refuses_unsigned(self):
        self.policy.write_text('{"required": true}',encoding='utf8')
        with self.assertRaises(cs.SigningConfigError) as caught:cs.load(self.env(),self.policy)
        self.assertIn('BARUN_SIGN_ENDPOINT',str(caught.exception))

    def test_partial_settings_stop_the_build(self):
        with self.assertRaises(cs.SigningConfigError) as caught:cs.load(self.env(BARUN_SIGN_ENDPOINT=FULL['BARUN_SIGN_ENDPOINT']),self.policy)
        for name in ('BARUN_SIGN_ACCOUNT','BARUN_SIGN_PROFILE','BARUN_SIGN_PUBLISHER'):self.assertIn(name,str(caught.exception))

    def test_environment_values(self):
        options,env=cs.load(self.env(**FULL),self.policy)
        self.assertEqual(options,{'endpoint':FULL['BARUN_SIGN_ENDPOINT'],'codeSigningAccountName':'barun-sign','certificateProfileName':'barun-public','publisherName':'Barun Co., Ltd.'})
        self.assertEqual(env,{})

    def test_settings_file_with_environment_override_and_credentials(self):
        self.settings.write_text(json.dumps({'endpoint':FULL['BARUN_SIGN_ENDPOINT'],'codeSigningAccountName':'file-account','certificateProfileName':'barun-public','publisherName':'Barun Co., Ltd.',
            'AZURE_TENANT_ID':'tenant','AZURE_CLIENT_ID':'client','AZURE_CLIENT_SECRET':'secret'}),encoding='utf8')
        options,env=cs.load(self.env(BARUN_SIGN_ACCOUNT='env-account',AZURE_CLIENT_SECRET='from-env'),self.policy)
        self.assertEqual(options['codeSigningAccountName'],'env-account')
        # 환경변수에 이미 있는 비밀은 파일 값으로 덮지 않는다.
        self.assertEqual(env,{'AZURE_TENANT_ID':'tenant','AZURE_CLIENT_ID':'client'})

    def test_bad_endpoint(self):
        with self.assertRaises(cs.SigningConfigError):cs.load(self.env(**{**FULL,'BARUN_SIGN_ENDPOINT':'http://example.com'}),self.policy)

    def test_broken_settings_file(self):
        self.settings.write_text('{',encoding='utf8')
        with self.assertRaises(cs.SigningConfigError):cs.load(self.env(),self.policy)

class BuilderConfig(unittest.TestCase):
    def test_repository_config_has_no_signing_values(self):
        config=json.loads((ROOT/'electron-builder.official6.json').read_text(encoding='utf8'))
        self.assertIs(config['win']['signExecutable'],False)
        self.assertNotIn('azureSignOptions',config['win'])
        self.assertIsNot(config['win'].get('verifyUpdateCodeSignature'),False)
        self.assertIn('electronFuses',config,'퓨즈는 electron-builder 설정 electronFuses 한 곳에서 끊는다(release-hardening.cjs 가 검사)')
        policy=json.loads((ROOT/'build'/'code-signing.json').read_text(encoding='utf8'))
        self.assertIsInstance(policy['required'],bool)

    def test_signed_copy(self):
        base=json.loads((ROOT/'electron-builder.official6.json').read_text(encoding='utf8'))
        options,_=cs.load({'BARUN_SIGN_SETTINGS':str(ROOT/'없는-파일.json'),**FULL},ROOT/'build'/'code-signing.json')
        signed=cs.builder_config(base,options)
        self.assertIs(base['win']['signExecutable'],False,'원본은 그대로')
        self.assertIs(signed['win']['signExecutable'],True)
        self.assertEqual(signed['win']['azureSignOptions'],options)
        self.assertIs(signed['win']['verifyUpdateCodeSignature'],True)
        self.assertEqual({k:v for k,v in signed.items() if k!='win'},{k:v for k,v in base.items() if k!='win'})

class Publisher(unittest.TestCase):
    def test_parse_dn_quotes(self):
        self.assertEqual(cs.parse_dn('CN="Barun Co., Ltd.", O="Barun ""B"" Co.", L=Busan, C=KR'),{'CN':'Barun Co., Ltd.','O':'Barun "B" Co.','L':'Busan','C':'KR'})

    def test_match_rules(self):
        subject='CN="Barun Co., Ltd.", O="Barun Co., Ltd.", L=Busan, S=Busan, C=KR'
        self.assertTrue(cs.publisher_matches(subject,['Barun Co., Ltd.']))
        self.assertTrue(cs.publisher_matches(subject,['CN="Barun Co., Ltd.", C=KR']))
        self.assertFalse(cs.publisher_matches(subject,['Barun']))
        self.assertFalse(cs.publisher_matches(subject,['CN="Barun Co., Ltd.", C=US']))

    def run_with(self,info):
        return lambda *a,**k:types.SimpleNamespace(returncode=0,stdout=json.dumps(info).encode('utf8'),stderr=b'')

    def test_verify_signed(self):
        with tempfile.TemporaryDirectory() as folder:
            file=Path(folder)/'setup.exe';file.write_bytes(b'MZ')
            good={'Status':'Valid','Subject':'CN="Barun Co., Ltd.", C=KR','Timestamp':True}
            self.assertEqual(cs.verify_signed([file],'Barun Co., Ltd.',run=self.run_with(good)),[])
            self.assertIn('서명 상태 NotSigned',cs.verify_signed([file],'Barun Co., Ltd.',run=self.run_with({'Status':'NotSigned','Subject':'','Timestamp':False}))[0])
            self.assertIn('게시자',cs.verify_signed([file],'Other',run=self.run_with(good))[0])
            self.assertIn('시간 도장',cs.verify_signed([file],'Barun Co., Ltd.',run=self.run_with({**good,'Timestamp':False}))[0])
            self.assertIn('파일이 없습니다',cs.verify_signed([Path(folder)/'none.exe'],'Barun Co., Ltd.',run=self.run_with(good))[0])

    def test_update_config_mixing(self):
        options={'publisherName':'Barun Co., Ltd.'}
        signed='provider: generic\nurl: https://barunarc.co.kr/downloads/barun-cad-6/\npublisherName:\n  - Barun Co., Ltd.\nupdaterCacheDirName: barun-cad-6-updater\n'
        unsigned='provider: generic\nurl: https://barunarc.co.kr/downloads/barun-cad-6/\nupdaterCacheDirName: barun-cad-6-updater\n'
        self.assertIsNone(cs.update_config_problem(signed,options))
        self.assertIsNone(cs.update_config_problem(unsigned,None))
        self.assertIn('없습니다',cs.update_config_problem(unsigned,options))
        self.assertIn('서명 안 된 판',cs.update_config_problem(signed,None))
        self.assertIn('다릅니다',cs.update_config_problem(signed,{'publisherName':'Other'}))
        self.assertIsNone(cs.update_config_problem('publisherName: Barun Co., Ltd.\n',options))

    def test_update_config_reads_js_yaml_quoting(self):
        # electron-builder 는 js-yaml 로 app-update.yml 을 쓴다. 따옴표·콜론이 든 이름도 같은 값으로 읽어야 한다.
        import shutil,subprocess
        node=shutil.which('node')
        if not node or not (ROOT/'node_modules'/'js-yaml').is_dir():self.skipTest('node_modules 없음')
        for name in ("O'Brien: CAD",'Barun "B" Co.','바른건축 주식회사','Barun Co., Ltd.'):
            text=subprocess.run([node,'-e',"process.stdout.write(require('js-yaml').dump({provider:'generic',publisherName:[process.argv[1]],updaterCacheDirName:'x'}))",name],cwd=ROOT,capture_output=True,check=True).stdout.decode('utf8')
            self.assertIsNone(cs.update_config_problem(text,{'publisherName':name}),text)

class BuildScript(unittest.TestCase):
    def test_steps_in_order(self):
        build=(ROOT/'build_desktop.py').read_text(encoding='utf8')
        order=[build.index(s) for s in ("sign_options,sign_env=code_signing.load()","subprocess.run([npm,'test']","code_signing.builder_config(","env={**os.environ,**sign_env}",
            "release_encryption_check.check(resources)","'build/release-hardening.cjs','check'","code_signing.verify_signed(","code_signing.update_config_problem(","'서명 안 됨.txt'")]
        self.assertEqual(order,sorted(order),'서명 설정은 긴 빌드 전에, 암호화 검사 뒤에 퓨즈·서명·업데이트 설정 검사')
        self.assertIn("item.name+'.보안검사실패'",build)
        self.assertIn("installer.name+'.서명검사실패'",build)

if __name__=='__main__':unittest.main()
