"""Read-only single-source CAD inspection. Results and temporary copies stay local."""
import argparse, hashlib, json, os, shutil, subprocess, sys, time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

def bounded(command, env, log, timeout):
    child=subprocess.Popen(command,cwd=ROOT,env=env,stdout=log,stderr=log)
    try:
        child.wait(timeout=timeout)
        return child.returncode
    except subprocess.TimeoutExpired:
        # Only the process tree created for this case; never by executable name.
        if os.name=='nt': subprocess.run(['taskkill','/PID',str(child.pid),'/T','/F'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,timeout=15)
        else: child.kill()
        child.wait(timeout=15)
        raise

def digest(path):
    h=hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda:stream.read(4*1024*1024),b''): h.update(chunk)
    return h.hexdigest()

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--file',required=True)
    parser.add_argument('--out',required=True)
    parser.add_argument('--prepared-json',action='store_true')
    parser.add_argument('--import-child',action='store_true')
    parser.add_argument('--compact',action='store_true',help='Remove only this run\'s generated drawing copy and app caches after reporting')
    parser.add_argument('--profile-open',action='store_true',help='Capture a local CPU profile with a 60 second diagnostic renderer budget')
    args=parser.parse_args()
    source=Path(args.file).resolve();out=Path(args.out).resolve()
    if not out.is_relative_to(ROOT/'tools'/'quality'): raise ValueError('Output must be inside tools/quality')
    if args.import_child:
        sys.path.insert(0,str(ROOT))
        if args.prepared_json or source.suffix.lower()=='.bcad':
            doc=json.loads(source.read_text(encoding='utf-8-sig'))
            if 'document' in doc: doc=doc['document']
        else:
            import exchange
            doc=exchange.import_file_path(source,source.suffix.lower())['document']
        if not isinstance(doc,dict) or not isinstance(doc.get('entities'),list): raise ValueError('Invalid document')
        # Escape isolated UTF-16 surrogates without deleting/replacing source text.
        with (out/'prepared.json').open('w',encoding='utf-8') as stream: json.dump(doc,stream,ensure_ascii=True,separators=(',',':'))
        return
    out.mkdir(parents=True,exist_ok=False)
    # Private mapping stays local. Never supply this file to the model.
    (out/'source-map.private.json').write_text(json.dumps({'path':str(source)},ensure_ascii=False),encoding='utf-8')
    result={'schemaVersion':1,'caseId':out.name,'format':source.suffix.lower(),'status':'started','originalUnchanged':None}
    if args.profile_open:result.update(diagnosticOnly=True,rendererBudgetSeconds=60)
    start=time.monotonic();before=None
    env={**os.environ,'LOCALAPPDATA':str(out/'local-app-data')}
    if args.profile_open:env['CAD_INSPECTION_PROFILE']='1'
    try:
        before=digest(source)
        command=[sys.executable,str(Path(__file__).resolve()),'--import-child','--file',str(source),'--out',str(out)]
        if args.prepared_json: command.append('--prepared-json')
        with (out/'import.private.log').open('w',encoding='utf-8') as log:
            imported=bounded(command,env,log,180)
        result['importMs']=round((time.monotonic()-start)*1000,2)
        if imported: result.update(status='failed',code='IMPORT_FAILED')
        elif (out/'prepared.json').stat().st_size>200_000_000: result.update(status='blocked',code='PREPARED_JSON_OVER_200MB')
        else:
            with (out/'renderer.private.log').open('w',encoding='utf-8') as log:
                bounded([str(ROOT/'node_modules/electron/dist/electron.exe'),str(ROOT/'tools/quality/inspect-renderer.cjs'),str(out/'prepared.json'),str(out/'renderer.json')],env,log,135)
            if (out/'renderer.json').exists(): result['renderer']=json.loads((out/'renderer.json').read_text(encoding='utf-8'));result['status']=result['renderer']['status']
            else: result.update(status='failed',code='RENDERER_NO_RESULT')
    except subprocess.TimeoutExpired:
        result.update(status='timeout',code='PROCESS_TIMEOUT')
        try:
            partial=json.loads((out/'renderer.json').read_text(encoding='utf-8'))
            if isinstance(partial,dict):result['renderer']=partial
        except (OSError,ValueError):pass
    except Exception as error: result.update(status='failed',code='HARNESS_OR_ACCESS_ERROR',errorType=type(error).__name__)
    finally:
        if before:
            try: result['originalUnchanged']=before==digest(source)
            except OSError: result['originalUnchanged']=None
            if result['originalUnchanged'] is False: result.update(status='failed',code='ORIGINAL_CHANGED')
        result['totalMs']=round((time.monotonic()-start)*1000,2)
        (out/'result.json').write_text(json.dumps(result,indent=2),encoding='utf-8')
        if args.compact:
            # Explicitly verify every resolved cleanup target stays within this new case.
            for candidate in [out/'prepared.json',out/'local-app-data',*out.glob('profile-*')]:
                target=candidate.resolve()
                if not target.is_relative_to(out) or target==out or target==source:
                    continue
                try:
                    if target.is_dir(): shutil.rmtree(target)
                    elif target.is_file(): target.unlink()
                except OSError:
                    pass  # Keep the result even when an app cache is still locked.
    print(json.dumps({'caseId':result['caseId'],'status':result['status'],'originalUnchanged':result['originalUnchanged']}))

if __name__=='__main__':main()
