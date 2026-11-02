from pathlib import Path
import tempfile, shutil, subprocess, json, unittest
root=Path(tempfile.mkdtemp(prefix='barun_core_probe_'))
source=root/'input.dwg'
sample=Path(r'C:\Program Files\Autodesk\AutoCAD 2022\Sample\ActiveX\SheetSetVBA\Label Block.dwg')
if not sample.is_file():raise unittest.SkipTest('AutoCAD 2022 sample drawing is not installed')
shutil.copyfile(sample,source)
script=root/'convert.scr'; target=root/'output.dxf'
script.write_text('(setvar "FILEDIA" 0)\n(command "_.DXFOUT" "'+target.as_posix()+'" "16")\n(command "_.QUIT" "_Y")\n',encoding='ascii')
try:
    p=subprocess.run([r'C:\Program Files\Autodesk\AutoCAD 2022\accoreconsole.exe','/i',str(source),'/s',str(script),'/l','en-US'],cwd=root,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,timeout=50,creationflags=subprocess.CREATE_NO_WINDOW)
    (root/'console.log').write_bytes(p.stdout)
    print(json.dumps({'root':str(root),'exit':p.returncode,'dxf':target.exists(),'log':p.stdout.decode('utf-16-le',errors='replace')[-4000:]},ensure_ascii=False))
except subprocess.TimeoutExpired as e:
    print(json.dumps({'root':str(root),'timeout':True,'log':(e.stdout or b'').decode('utf-16-le',errors='replace')[-2000:]},ensure_ascii=False))
