"""Exercise the packaged engine with a fresh profile and no developer PATH."""
import argparse,base64,json,os,re,socket,subprocess,tempfile,time,urllib.request
from urllib.parse import urljoin
from pathlib import Path

def check(executable,output):
    root=Path(__file__).resolve().parent
    results=[]
    with tempfile.TemporaryDirectory(prefix='barun-clean-') as clean:
        folder=Path(clean);profile=folder/'profile';profile.mkdir()
        if os.name=='nt':
            env={k:v for k,v in os.environ.items() if k.upper() in ('SYSTEMROOT','WINDIR','TEMP','TMP','COMSPEC','PATHEXT')}
            env.update(PATH=str(Path(env.get('WINDIR','C:/Windows'))/'System32'))
        else:   # macOS: 개발자 PATH 없이 시스템 기본 경로만, 임시 폴더·언어 설정은 그대로
            env={k:v for k,v in os.environ.items() if k in ('TMPDIR','LANG','LC_ALL','LC_CTYPE')}
            env.update(PATH='/usr/bin:/bin:/usr/sbin:/sbin')
        env.update(USERPROFILE=str(profile),HOME=str(profile),LOCALAPPDATA=str(profile/'Local'),APPDATA=str(profile/'Roaming'),PYTHONPATH='',PYTHONHOME='',DOTNET_ROOT=str(folder/'absent-dotnet'))
        # A fixed port could reach an engine that is already running and pass without testing this build.
        with socket.socket() as probe:probe.bind(('127.0.0.1',0));port=str(probe.getsockname()[1])
        base='http://127.0.0.1:'+port
        log=open(folder/'engine.log','w',encoding='utf8')
        proc=subprocess.Popen([str(Path(executable).resolve()),'--port',port,'--no-browser'],cwd=clean,env=env,stdout=log,stderr=log,creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
        try:
            for attempt in range(100):
                try:
                    status=json.load(urllib.request.urlopen(base+'/api/status',timeout=2));break
                except OSError:
                    if proc.poll() is not None:raise RuntimeError('Packaged engine exited')
                    time.sleep(.2)
            else:raise RuntimeError('Packaged engine did not start')
            assert status['dxf'] and status['offlineCore'];results.append('fresh-profile engine startup')
            def api(route,data):
                request=urllib.request.Request(base+'/api/'+route,json.dumps(data).encode(),{'Origin':base,'X-CAD-Token':status['token'],'Content-Type':'application/json'})
                return json.load(urllib.request.urlopen(request,timeout=100))
            doc={'version':2,'units':'mm','layers':[{'id':'l','name':'기본','color':'#bedb71','visible':True,'locked':False}], 'entities':[{'id':'e','type':'line','layer':'l','points':[{'x':0,'y':0},{'x':1000,'y':1000}]}]}
            exported=api('export',{'document':doc});imported=api('import',{'extension':'.dxf','data':exported['data']})
            assert len(imported['document']['entities'])==1;results.append('DXF roundtrip')
            xlsx=api('excel',json.loads((root/'test-fixtures/exchange/workflows-table.json').read_text(encoding='utf8')))
            rows=api('excel',{'action':'import','data':xlsx['data']})['rows'];assert rows[9][1]==42;results.append('XLSX formulas without Codex/Node/Office')
            job=json.loads((root/'test-fixtures/exchange/workflows-job.json').read_text(encoding='utf8'));job['action']='render'
            pdf=api('pdf',job);assert base64.b64decode(pdf['data']).startswith(b'%PDF');results.append('Korean PDF without Office')
            converted=api('convert',{'action':'convert','direction':'dxf-dwg','version':'2018','name':'clean.dxf','folder':clean,'data':exported['data']})
            raw=Path(converted['path']).read_bytes();assert raw.startswith(b'AC1032')
            back=api('import',{'extension':'.dwg','data':base64.b64encode(raw).decode()});assert len(back['document']['entities'])==1;results.append('DWG roundtrip with bundled .NET engine')
            for asset in ('/','/style.css','/barun-cad-brand.png'):
                assert urllib.request.urlopen(base+asset).status==200
            results.append('HTML/CSS/brand assets')
            pending=[base+'/app.js'];seen=set()
            while pending:
                module=pending.pop()
                if module in seen:continue
                seen.add(module)
                try:
                    with urllib.request.urlopen(module,timeout=10) as response:
                        assert 'javascript' in response.headers.get('Content-Type',''),module
                        source=response.read().decode('utf8')
                except OSError as error:
                    raise RuntimeError(f'Packaged browser module unavailable: {module}') from error
                for dep in re.findall(r'''(?:from\s*|import\s*|import\s*\()\s*['"](\./[^'"]+\.js)['"]''',source):
                    pending.append(urljoin(module,dep))
            assert any('/gpu-renderer-' in module for module in seen),'GPU bundle absent'
            results.append('bundled browser module graph including GPU renderer')
        finally:
            proc.terminate()
            try:proc.wait(10)
            except subprocess.TimeoutExpired:proc.kill();proc.wait()
            log.close()
            if proc.returncode not in (0,1):pass
    Path(output).write_text(json.dumps({'passed':results,'limitations':['Runs on current Windows with isolated profile/PATH, not a clean VM or NSIS installation test.']},ensure_ascii=False,indent=2),encoding='utf8')
    print(json.dumps({'passed':results},ensure_ascii=True))

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('executable');p.add_argument('--output',default='tmp/standalone-smoke.json');a=p.parse_args();check(a.executable,a.output)
