import json, tempfile
from pathlib import Path
import ezdxf
import batch_converter
p=Path(r'D:\어플\캐드\reports\dxf-dwg-roundtrip-20260914-141211\results.json')
data=json.loads(p.read_text(encoding='utf-8'))
out=p.parent/'repaired-dwg'; out.mkdir(exist_ok=True)
results=[]
for row in [r for r in data['rows'] if r.get('status')=='실패' and "key 'S'" in r.get('error','')]:
    src=Path(row['source_dxf'])
    try:
        doc=ezdxf.readfile(src)
        with tempfile.TemporaryDirectory(prefix='barun_repair_') as td:
            clean=Path(td)/src.name
            doc.saveas(clean)
            result=batch_converter.process({'action':'convert','name':clean.name,'direction':'dxf-dwg','folder':str(out),'version':'2018','_raw':clean.read_bytes()})
        results.append({'index':row['index'],'source':str(src),'result':result})
        print(row['index'], '성공' if not result.get('failed') else '실패', result.get('message',''))
    except Exception as e:
        results.append({'index':row['index'],'source':str(src),'error':str(e)})
        print(row['index'],'예외',e)
(p.parent/'repair-retry.json').write_text(json.dumps(results,ensure_ascii=False,indent=2),encoding='utf-8')
