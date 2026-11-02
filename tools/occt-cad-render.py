"""Render actual command geometry/patterns and verify the product's DXF exporter."""
import json, math, sys
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import exchange, ezdxf
source=Path(sys.argv[1]);data=json.loads(source.read_text(encoding='utf8'));doc=data['doc']
stem=source.name.replace('-render.json','');out=source.parent
raw,warnings=exchange.export_dxf(doc)
if warnings:raise RuntimeError('DXF warnings: '+str(warnings))
(out/(stem+'.dxf')).write_bytes(raw)
dxf=ezdxf.readfile(out/(stem+'.dxf'));space=dxf.modelspace()
assert len(space)==len(doc['entities'])
hatches=list(space.query('HATCH'))
assert len(hatches)==sum(e['type']=='hatch' for e in doc['entities'])
assert all(h.dxf.layer=='A-HATCH' and h.dxf.pattern_name=='AR-CONC' for h in hatches)
assert all(len(h.paths)==1+len(e.get('loops',[])) for h,e in zip(hatches,[e for e in doc['entities'] if e['type']=='hatch']))
points=[p for e in doc['entities'] for p in e.get('points',[])]
minx=min(p['x'] for p in points);maxx=max(p['x'] for p in points);miny=min(p['y'] for p in points);maxy=max(p['y'] for p in points)
w,h=1600,950;s=min((w-120)/max(1,maxx-minx),(h-160)/max(1,maxy-miny))
dx=(w-(maxx-minx)*s)/2;dy=(h-(maxy-miny)*s)/2+20
xy=lambda p:(dx+(p['x']-minx)*s,h-dy-(p['y']-miny)*s)
image=Image.new('RGB',(w,h),'white');draw=ImageDraw.Draw(image)
for e in doc['entities']:
 if e['type']!='hatch':continue
 mask=Image.new('L',(w,h),0);md=ImageDraw.Draw(mask);md.polygon([xy(p) for p in e['points']],fill=255)
 for loop in e.get('loops',[]):md.polygon([xy(p) for p in loop],fill=0)
 pattern=Image.new('RGB',(w,h),'white');pd=ImageDraw.Draw(pattern);r=next(v for v in data['renderHatches'] if v['id']==e['id'])
 if r.get('dense'):pd.rectangle((0,0,w,h),fill='#e4e4e4')
 else:
  for x1,y1,x2,y2 in r['segments']:pd.line([xy({'x':x1,'y':y1}),xy({'x':x2,'y':y2})],fill='#777777',width=1)
  for x,y in r['dots']:
   px,py=xy({'x':x,'y':y});pd.ellipse((px-1,py-1,px+1,py+1),fill='#777777')
 image.paste(pattern,(0,0),mask)
draw=ImageDraw.Draw(image)
for e in doc['entities']:
 if e['type'] not in ('line','polyline'):continue
 ps=[xy(p) for p in e['points']]
 if e.get('closed'):ps.append(ps[0])
 draw.line(ps,fill='#171717' if e.get('occtRole')=='cut' else '#707070',width=3 if e.get('occtRole')=='cut' else 1)
draw.text((35,20),data['title'],fill='#333333',font=ImageFont.load_default(size=20))
draw.text((35,h-30),'Node verification render · Browser file permission was declined · A-HATCH / AR-CONC',fill='#666666',font=ImageFont.load_default(size=16))
image.save(out/(stem+'.png'))
print(json.dumps({'dxfEntities':len(space),'dxfHatches':len(hatches),'png':str(out/(stem+'.png'))}))
