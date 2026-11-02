"""Read local CTB files into a portable output-only style table."""
import base64,tempfile
from pathlib import Path
from ezdxf.addons import acadctb
from ezdxf import colors

def style_row(s):
    return {'color':('#%02x%02x%02x'%s.color) if s.color else None,'lineweight':float(s.get_lineweight()),'screen':s.screen,'grayscale':s.grayscale}

def parse(data):
    raw=base64.b64decode(data.get('data',''),validate=True)
    if not raw or len(raw)>2_000_000:raise ValueError('CTB/STB 파일은 2MB 이하만 지원합니다.')
    name=Path(data.get('name','style.ctb')).name
    # ACAD200 717: 이름 기준 플롯 스타일(STB)도 같은 모양 {styles:{이름:{color,lineweight,screen,grayscale}}} 으로 돌려준다(kind:'stb').
    stb=name.lower().endswith('.stb')
    with tempfile.TemporaryDirectory() as folder:
        path=Path(folder)/('style.stb' if stb else 'style.ctb');path.write_bytes(raw);table=acadctb.load(path)
    if stb or isinstance(table,acadctb.NamedPlotStyles):
        styles={}
        for key,s in table.items():
            s.parent=table   # ezdxf 가 읽은 STB 스타일은 부모 표가 비어 굵기를 못 읽는다
            styles[str(key)]=style_row(s)
        return {'name':name,'kind':'stb','styles':styles}
    styles={}
    for i in range(1,256):
        s=table[i]
        styles[str(i)]={'color':('#%02x%02x%02x'%s.color) if s.color else None,'lineweight':float(s.get_lineweight()),'screen':s.screen,'grayscale':s.grayscale}
    return {'name':Path(data.get('name','style.ctb')).name,'styles':styles,'palette':{str(i):'#%02x%02x%02x'%tuple(colors.aci2rgb(i)) for i in range(1,256)}}
