"""Exercise the actual local CAD bridge; restore the original drawing with undo."""
import json,time,urllib.request,sys
from pathlib import Path
BASE=sys.argv[1] if len(sys.argv)>1 else 'http://127.0.0.1:8774'
token=json.load(urllib.request.urlopen(BASE+'/api/status'))['token']
def api(route,data):
    req=urllib.request.Request(BASE+'/api/'+route,data=json.dumps(data).encode(),headers={'Origin':BASE,'X-CAD-Token':token,'Content-Type':'application/json'})
    return json.load(urllib.request.urlopen(req,timeout=40))
def call(name,arguments={}):return api('mcp',{'name':name,'arguments':arguments})
def edit(command):
    p=call('cad_preview',{'command':command})
    return call('cad_execute',{'command':command,'expectedRevision':p['revision']})
before=call('cad_get_document')['document'];completed=0
try:
    converted=api('design-cases',{'action':'editable','id':'Training/DEH_FP_SPA_001310864'})
    added=edit({'type':'design.import','reference':True,'documents':[converted['document']]});completed+=1
    first=added['added'][0]
    edit({'type':'move','ids':[first],'dx':500,'dy':200});completed+=1
    edit({'type':'update','ids':[first],'changes':{'color':'#ff0000'}});completed+=1
    validation=call('cad_validate')
    assert validation['valid']
finally:
    for _ in range(completed):call('cad_undo')
after=call('cad_get_document')['document']
assert before==after,'Undo did not restore original document'
report={'liveImportMoveUpdateUndo':'pass','originalPreserved':True,'objects':converted['objectCount'],'layers':len(converted['document']['layers']),'scaleVerified':converted['scaleVerified']}
Path('data/aihub-71465/full-catalog/live-edit-audit.json').write_text(json.dumps(report,indent=2),encoding='utf8')
print(json.dumps(report))
