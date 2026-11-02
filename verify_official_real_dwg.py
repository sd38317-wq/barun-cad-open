"""Packaged Barun CAD 5 engine verification against a real project drawing."""
import argparse
import base64
import json
import os
import subprocess
import time
import urllib.request
from pathlib import Path


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('engine')
    parser.add_argument('drawing')
    parser.add_argument('--output',default='tmp/official5-real-dwg')
    args=parser.parse_args()
    root=Path(__file__).resolve().parent
    engine=Path(args.engine).resolve()
    drawing=Path(args.drawing).resolve()
    output=(root/args.output).resolve() if not Path(args.output).is_absolute() else Path(args.output).resolve()
    output.mkdir(parents=True,exist_ok=True)
    port=18870
    base=f'http://127.0.0.1:{port}'
    log_path=output/'engine.log'
    started=time.monotonic()
    log=log_path.open('w',encoding='utf8')
    profile=output/'profile'
    profile.mkdir(exist_ok=True)
    environment=os.environ.copy()
    environment.update(USERPROFILE=str(profile),HOME=str(profile),LOCALAPPDATA=str(profile/'Local'),APPDATA=str(profile/'Roaming'))
    process=subprocess.Popen([str(engine),'--port',str(port),'--no-browser'],cwd=root,env=environment,stdout=log,stderr=log,creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
    results={
        'source':str(drawing),
        'sourceBytes':drawing.stat().st_size,
        'engine':str(engine),
        'checks':{},
    }
    try:
        for _ in range(300):
            try:
                status=json.load(urllib.request.urlopen(base+'/api/status',timeout=2))
                break
            except OSError:
                if process.poll() is not None:raise RuntimeError('패키지 엔진이 시작 도중 종료되었습니다.')
                time.sleep(.2)
        else:raise RuntimeError('패키지 엔진 시작 시간이 초과되었습니다.')
        token=status['token']
        results['checks']['engineStartup']=True

        def api(route,payload,timeout=1200):
            request=urllib.request.Request(
                base+'/api/'+route,
                json.dumps(payload,ensure_ascii=False,separators=(',',':')).encode('utf8'),
                {'Origin':base,'X-CAD-Token':token,'Content-Type':'application/json'},
            )
            with urllib.request.urlopen(request,timeout=timeout) as response:
                return json.load(response)

        convert=api('convert',{
            'action':'convert','direction':'dxf-dwg','version':'2018',
            'name':drawing.name,'folder':str(output),
            'data':base64.b64encode(drawing.read_bytes()).decode('ascii'),
        })
        if convert.get('failed'):raise RuntimeError(convert)
        dwg=Path(convert['path'])
        if not dwg.read_bytes().startswith(b'AC1032'):raise RuntimeError('생성 DWG가 2018 형식이 아닙니다.')
        results['checks']['saveDwg']=True
        results['dwg']={'path':str(dwg),'bytes':dwg.stat().st_size,'engine':convert.get('engine'),'warnings':convert.get('warnings',[]),'engineWarnings':convert.get('engineWarnings',[])}

        imported=api('import',{'extension':'.dwg','data':base64.b64encode(dwg.read_bytes()).decode('ascii')})
        document=imported['document']
        document_path=output/'opened-dwg-document.json'
        document_path.write_text(json.dumps(document,ensure_ascii=False,separators=(',',':')),encoding='utf8')
        results['checks']['openDwg']=True

        node=subprocess.run(
            ['node',str(root/'verify_real_dwg.mjs'),str(document_path),str(output)],
            cwd=root,capture_output=True,text=True,encoding='utf8',timeout=600,check=True,
        )
        node_result=json.loads(node.stdout)
        results['checks']['undo']=node_result['undo']
        results['checks']['backup']=node_result['backup']
        results['drawing']=node_result

        exported=api('export',{'document':document,'version':'R2018'})
        saved_dxf=output/'actual-drawing-saved.dxf'
        saved_dxf.write_bytes(base64.b64decode(exported['data']))
        reopened=api('import',{'extension':'.dxf','data':exported['data']})
        if not reopened['document'].get('entities'):raise RuntimeError('저장한 DXF를 다시 열었지만 객체가 없습니다.')
        results['checks']['saveAndReopenDxf']=True
        results['savedDxf']={'path':str(saved_dxf),'bytes':saved_dxf.stat().st_size,'warnings':exported.get('warnings',[])}

        plot_job=json.loads((output/'plot-job.json').read_text(encoding='utf8'))
        pdf=api('pdf',plot_job)
        pdf_path=output/'actual-drawing-output.pdf'
        pdf_path.write_bytes(base64.b64decode(pdf['data']))
        if not pdf_path.read_bytes().startswith(b'%PDF'):raise RuntimeError('출력 결과가 PDF 형식이 아닙니다.')
        results['checks']['outputPdf']=True
        results['pdf']={'path':str(pdf_path),'bytes':pdf_path.stat().st_size}
    finally:
        process.terminate()
        try:process.wait(15)
        except subprocess.TimeoutExpired:
            process.kill();process.wait()
        log.close()
    results['seconds']=round(time.monotonic()-started,3)
    report=output/'verification.json'
    report.write_text(json.dumps(results,ensure_ascii=False,indent=2),encoding='utf8')
    print(json.dumps(results,ensure_ascii=False,indent=2))


if __name__=='__main__':main()
