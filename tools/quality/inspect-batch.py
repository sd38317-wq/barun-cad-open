"""Explicit-root, sequential local drawing inventory/inspection; no implicit drive scan."""
import argparse, json, os, subprocess, sys, time
from pathlib import Path

ROOT=Path(__file__).resolve().parents[2]
EXTENSIONS={'.dwg','.dxf','.bcad'}
EXCLUDED={'$recycle.bin','system volume information','node_modules','.git','__pycache__'}

def main():
    p=argparse.ArgumentParser()
    p.add_argument('--root',action='append',required=True)
    p.add_argument('--out',required=True)
    p.add_argument('--inventory-only',action='store_true')
    a=p.parse_args();out=Path(a.out).resolve()
    if not out.is_relative_to(ROOT/'tools'/'quality'): raise ValueError('Output must stay inside tools/quality')
    out.mkdir(parents=True,exist_ok=False)
    files=[];seen=set();scan_errors=[];scanned=0;last_progress=time.monotonic()
    excluded_output=os.path.normcase(os.path.abspath(ROOT/'tools'/'quality'))
    for value in a.root:
        folder=Path(value).resolve()
        if not folder.is_dir(): scan_errors.append({'code':'ROOT_NOT_ACCESSIBLE'});continue
        def scan_error(error):scan_errors.append({'code':'DIRECTORY_NOT_ACCESSIBLE'})
        for parent,dirs,names in os.walk(folder,followlinks=False,onerror=scan_error):
            dirs[:]=[d for d in dirs if d.casefold() not in EXCLUDED and not os.path.islink(os.path.join(parent,d)) and not os.path.isjunction(os.path.join(parent,d)) and os.path.normcase(os.path.abspath(os.path.join(parent,d)))!=excluded_output]
            scanned+=1
            if time.monotonic()-last_progress>5:
                progress={'status':'scanning','directories':scanned,'found':len(files),'scanErrors':len(scan_errors)}
                (out/'progress.json').write_text(json.dumps(progress),encoding='utf-8')
                print(json.dumps(progress),flush=True);last_progress=time.monotonic()
            for name in names:
                path=Path(parent)/name
                if path.suffix.lower() not in EXTENSIONS or path.is_symlink():continue
                key=os.path.normcase(os.path.abspath(path))
                if key not in seen:seen.add(key);files.append(path)
    manifest=[{'caseId':f'case-{i:06d}','path':str(path),'format':path.suffix.lower()} for i,path in enumerate(sorted(files,key=lambda x:str(x).casefold()),1)]
    (out/'manifest.private.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding='utf-8')
    report={'schemaVersion':1,'status':'inventory','found':len(manifest),'scanErrors':scan_errors,'completed':0,'results':[],'coverage':'only explicitly supplied roots; symlinks/junctions/system and dependency directories excluded'}
    def save():(out/'summary.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
    save();print(json.dumps({'found':len(manifest),'scanErrors':len(scan_errors)}),flush=True)
    if a.inventory_only:return
    report['status']='running';save()
    for entry in manifest:
        case=out/entry['caseId']
        subprocess.run([sys.executable,str(ROOT/'tools/quality/inspect-drawing.py'),'--file',entry['path'],'--out',str(case)],cwd=ROOT,check=False)
        if (case/'result.json').exists(): result=json.loads((case/'result.json').read_text(encoding='utf-8'))
        else: result={'caseId':entry['caseId'],'status':'failed','code':'NO_CASE_RESULT'}
        report['results'].append(result);report['completed']+=1;save()
    report['status']='finished';save()

if __name__=='__main__':main()
