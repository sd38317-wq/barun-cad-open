"""Review every unique source image through the real editable conversion path."""
import json,math,time
from pathlib import Path
import design_case_service as cases

def main():
    start=time.time();db=cases.connection()
    keys=[r[0] for r in db.execute('SELECT MIN(id) FROM case_images GROUP BY sha256')];db.close()
    failures=[];objects=0;done=0
    for key in keys:
        try:
            result=cases.process({'action':'editable','id':key});doc=result['document']
            layers={l['id'] for l in doc['layers']}
            if not doc['entities']:raise ValueError('empty conversion')
            for e in doc['entities']:
                assert e['layer'] in layers
                assert e['referenceOnly'] is False
                for p in e.get('points',[e.get('position',{})]):
                    assert all(math.isfinite(p[k]) for k in ('x','y'))
            objects+=len(doc['entities'])
        except Exception as e:failures.append({'id':key,'error':str(e),'type':type(e).__name__})
        done+=1
        if done%1000==0:print(json.dumps({'checked':done,'total':len(keys),'failed':len(failures)}),flush=True)
    report={'checkedUniqueImages':done,'objects':objects,'failures':failures,'seconds':time.time()-start,'scope':'Conversion, finite coordinates, editable flags, layer references. Not raster completeness or design validity.'}
    (cases.ROOT/'conversion-audit.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf8')
    print(json.dumps(report if len(failures)<5 else {**report,'failures':len(failures)}),flush=True)
if __name__=='__main__':main()
