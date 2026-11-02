from pathlib import Path
import sys, json, subprocess, hashlib, collections, traceback
root=Path.cwd();sys.path.insert(0,str(root));import exchange
base=root/'tools/quality/runs/recent-300-20260927-02';out=root/'tools/quality/runs/import-diagnosis-20260927';out.mkdir(exist_ok=True)
for n in [129,144,145,151,198,200,205,230,266]:
 case=f'case-{n:04}'; folder=out/case;folder.mkdir(exist_ok=True);src=Path(json.loads((base/case/'source-map.private.json').read_text('utf-8'))['path']);before=hashlib.sha256(src.read_bytes()).hexdigest()
 rec={'caseId':case}; print(case,'start',flush=True)
 a=subprocess.run([str(root/'dwg-runtime/BarunConverter.exe'),str(src),str(folder/'primary.private.dxf'),'2018'],stdout=subprocess.PIPE,stderr=subprocess.STDOUT,timeout=120,creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
 t=a.stdout.decode('utf-8','replace'); p=json.loads(t[t.index('{'):]); (folder/'primary.private.json').write_text(json.dumps(p,ensure_ascii=True),encoding='utf8');rec.update(primaryCode=a.returncode,expectedTypes=p.get('inputTypes'),primaryTypes=p.get('outputTypes'))
 b=subprocess.run([str(root/'acadrust-runtime/barun-dwg2dxf.exe'),'-v0','--as','r2018','-o',str(folder/'fallback.private.dxf'),str(src)],stdout=subprocess.PIPE,stderr=subprocess.STDOUT,timeout=120,creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0));rec['fallbackCode']=b.returncode
 try:
  d=exchange.read_dxf_preserving_unicode(folder/'fallback.private.dxf',folder);rec['actualTypes']=dict(collections.Counter(e.dxftype() for e in d.modelspace()))
 except Exception as e:
  rec.update(readerException=type(e).__name__,readerMessage=str(e));(folder/'reader.private.log').write_text(traceback.format_exc(),encoding='utf8')
 rec['originalUnchanged']=before==hashlib.sha256(src.read_bytes()).hexdigest();(folder/'diagnosis.json').write_text(json.dumps(rec,indent=2),encoding='utf8');print(json.dumps(rec),flush=True)
