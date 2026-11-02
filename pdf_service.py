"""Vector CAD PDF production. Model geometry is supplied as flattened primitives in mm."""
import io,json,sys,math,base64,os
import hatch_patterns
from pathlib import Path
from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.lib.colors import HexColor
from pypdf import PdfReader,PdfWriter

MM=72/25.4
PAPERS={'A1':(841,594),'A3':(420,297),'A4':(297,210)}
FONT='CADKorean'
def font():
    if FONT not in pdfmetrics.getRegisteredFontNames():
        p=Path(__file__).resolve().parent/'fonts'/'NanumGothic-Regular.ttf'
        if not p.exists():p=Path(os.environ.get('WINDIR','C:/Windows'))/'Fonts'/'malgun.ttf'
        if not p.exists(): raise ValueError('내장 한글 글꼴이 누락되었습니다. 설치 파일로 복구하세요.')
        pdfmetrics.registerFont(TTFont(FONT,str(p)))

# 문자 원래 글꼴(sourceFont) → Windows 글꼴 파일(text-fonts.js 와 같은 대응). 없으면 내장 나눔고딕(FONT).
_PDF_FONT_FILES={'malgun':('malgun.ttf',0),'gulim':('gulim.ttc',0),'gulimche':('gulim.ttc',1),'batang':('batang.ttc',0),'batangche':('batang.ttc',1),
 'dotum':('gulim.ttc',2),'gungsuh':('batang.ttc',2),'arial':('arial.ttf',0),'arialn':('ARIALN.TTF',0),'times':('times.ttf',0),'h2gtrm':('H2GTRM.TTF',0),'hmkmrhd':('HMKMRHD.TTF',0)}
_LATIN_ONLY={'arial','arialn','times'}
# 맥에는 Windows 글꼴이 없다. 한글 글꼴만 맥 기본 TrueType 으로 대신한다(애플SD산돌고딕 .ttc 는 reportlab 이 못 읽음).
_MAC_FONT_FILES={'malgun':'AppleGothic.ttf','gulim':'AppleGothic.ttf','gulimche':'AppleGothic.ttf','dotum':'AppleGothic.ttf',
 'batang':'AppleMyungjo.ttf','batangche':'AppleMyungjo.ttf','gungsuh':'AppleMyungjo.ttf'}
def _font_key(font):
    name=str(font or '').strip().lower().rsplit('.',1)[0] if str(font or '').lower().endswith(('.ttf','.ttc','.otf','.shx')) else str(font or '').strip().lower()
    if name in _PDF_FONT_FILES:return name
    if name.startswith(('whtmtxt','whsmtxt','hmtxt','myungjo')):return 'batang'
    if name.startswith(('whgtxt','whgdtxt','hgtxt','hgdtxt','whtgtxt','gothic')):return 'malgun'
    if name.startswith(('romans','romand','romant','simplex','txt','isocp','iso','monotxt','complex','italic')):return 'arialn'
    return None
def _registered_font(key):
    """Windows 글꼴을 한 번만 등록하고 이름을 돌려준다. 없으면 None."""
    file,index=_PDF_FONT_FILES[key];name='CAD_'+key
    if name in pdfmetrics.getRegisteredFontNames():return name
    path_=Path(os.environ.get('WINDIR','C:/Windows'))/'Fonts'/file
    if not path_.exists() and sys.platform=='darwin' and key in _MAC_FONT_FILES:
        path_,index=Path('/System/Library/Fonts/Supplemental')/_MAC_FONT_FILES[key],0
    if not path_.exists():return None
    try:pdfmetrics.registerFont(TTFont(name,str(path_),subfontIndex=index));return name
    except Exception:return None

def _covers(name,text):
    """글꼴에 문자열의 모든 글자 모양이 있는가(※ ① Ⅰ ≒ 처럼 라틴 글꼴에 없는 기호가 빈 네모로 찍히지 않게)."""
    try:glyphs=pdfmetrics.getFont(name).face.charToGlyph
    except Exception:return True
    return all(ord(ch) in glyphs for ch in text if not ch.isspace())

def text_font(e,text):
    """문자 하나에 쓸 PDF 글꼴 이름. 고른 글꼴에 없는 글자가 있으면 한글 글꼴(맑은 고딕), 그것도 없으면 기본 글꼴."""
    key=_font_key(e.get('sourceFont'))
    if key in _LATIN_ONLY and any(ord(ch)>0x2e80 for ch in text):key='malgun'
    if not key:return FONT
    name=_registered_font(key)
    if not name:return FONT
    if key!='malgun' and not _covers(name,text):
        fallback=_registered_font('malgun')
        return fallback if fallback and _covers(fallback,text) else FONT
    return name

def path(c,points,closed=False):
    p=c.beginPath(); p.moveTo(points[0]['x'],points[0]['y'])
    for pt in points[1:]:p.lineTo(pt['x'],pt['y'])
    if closed:p.close()
    return p

# 한 번의 출력에서 해치 무늬로 그릴 선분 총량. 넘으면 남은 해치는 옅은 채움으로 대신한다(PDF 가 수백 MB 가 되거나 멈추지 않게).
HATCH_SEGMENT_BUDGET=400_000
def draw(c,e,scale,mode,view=None,budget=None):
    c.saveState()
    if 'opacity' in e:
        c.setStrokeAlpha(max(0,min(1,float(e['opacity']))));c.setFillAlpha(max(0,min(1,float(e['opacity']))))
    color=HexColor(e.get('color','#000000')) if mode=='color' else HexColor('#000000')
    c.setStrokeColor(color);c.setFillColor(color)
    c.setLineWidth(max(.05,float(e.get('lineweight') or .25))*scale)
    lt=e.get('linetype','CONTINUOUS').upper()
    if 'DASH' in lt:c.setDash([3*scale,1.5*scale])
    elif 'CENTER' in lt:c.setDash([6*scale,1.5*scale,scale,1.5*scale])
    t=e['type']
    if t=='block':
        if e.get('clip',{}).get('enabled'):
            clip_path=path(c,e['clip']['points'],True)
            if e['clip'].get('inverted'):clip_path.rect(-1e9,-1e9,2e9,2e9)
            c.clipPath(clip_path,stroke=0,fill=0,fillMode=0)
        for child in e["entities"]:
            # 블록 안 조각이 제 레이어에 있으면 그 PDF 레이어로 따로 묶는다(블록 레이어로 몰면 창 블록의 유리·틀이 WD 로 바뀌어 평면 인식이 창을 엉뚱한 자리에 잡았다).
            own=child.get('pdfLayer') if getattr(c,'_barun_mark',False) and isinstance(child.get('pdfLayer'),str) and child.get('pdfLayer')!=e.get('pdfLayer') else None
            if own:c._code.append('/OC /%s BDC'%_pdf_layer_tag(c,own))
            draw(c,child,scale,mode,view=view,budget=budget)
            if own:c._code.append('EMC')
    elif t=='image':
        from reportlab.lib.utils import ImageReader
        from PIL import Image
        if e.get('data'):
            header,encoded=e['data'].split(',',1)
            if header.lower() not in ('data:image/png;base64','data:image/jpeg;base64','data:image/bmp;base64') or len(encoded)>70_000_000:
                raise ValueError('Invalid raster data URL')
            raw=base64.b64decode(encoded,validate=True)
        else:
            from image_service import image_bytes
            raw,_=image_bytes(e.get('path'))
        with Image.open(io.BytesIO(raw)) as image:
            if image.width*image.height>25_000_000:raise ValueError('Image is too large')
            image.load()
            c.setFillAlpha(max(0,min(1,float(e.get('opacity',1))))*(1-max(0,min(100,float(e.get('fade',50))))/100))
            c.translate(e['position']['x'],e['position']['y']);c.rotate(e.get('rotation',0))
            c.drawImage(ImageReader(image),0,0,width=e['width'],height=e['height'],mask='auto')
    elif t in ('line','polyline','rectangle'):
        c.drawPath(path(c,e['points'],e.get('closed',False) or t=='rectangle'))
    elif t=='circle':c.circle(e['center']['x'],e['center']['y'],e['radius'],stroke=1,fill=0)
    elif t=='arc':
        x,y,r=e['center']['x'],e['center']['y'],e['radius']
        c.arc(x-r,y-r,x+r,y+r,startAng=e['startAngle'],extent=(e['endAngle']-e['startAngle'])%360 or 360)
    elif t=='ellipse':
        x,y=e['center']['x'],e['center']['y'];a=e['majorAxis'];r=math.hypot(a['x'],a['y']);q=e['ratio']
        c.translate(x,y);c.rotate(math.degrees(math.atan2(a['y'],a['x'])))
        start=e.get('startParam',0);end=e.get('endParam',math.tau);sweep=(end-start)%math.tau or math.tau
        c.arc(-r,-r*q,r,r*q,startAng=math.degrees(start),extent=math.degrees(sweep))
    elif t=='text':
        c.translate(e['position']['x'],e['position']['y']);c.rotate(e.get('rotation',0));c.setFont(text_font(e,e.get('text','')),e['height'])
        for i,line in enumerate(e['text'].split('\n')):
            (c.drawCentredString if e.get('align')=='center' else c.drawString)(0,-i*e['height']*1.35,line)
    elif t=='hatch':
        loops=[e['points'],*e.get('loops',[])];p=c.beginPath()
        for loop in loops:
            p.moveTo(loop[0]['x'],loop[0]['y'])
            for pt in loop[1:]:p.lineTo(pt['x'],pt['y'])
            p.close()
        if e.get('wipeout'):c.setFillColor(HexColor('#ffffff'));c.drawPath(p,stroke=1 if e.get('frame')==1 else 0,fill=1,fillMode=0)   # 가리기: 종이색으로 덮기(ACAD200-411)
        elif e.get('solid'):c.setFillColor(HexColor('#d9d9d9') if mode=='mono' else color);c.drawPath(p,stroke=0,fill=1,fillMode=0)
        else:
            c.clipPath(p,stroke=0,fill=0,fillMode=0)
            # 무늬는 화면·SVG 출력·DXF 와 같은 무늬 줄(hatch_patterns.py = hatch-patterns.js)로 푼다. 예전에는 교차선도 한 방향만 그렸다.
            xs=[v['x'] for loop in loops for v in loop];ys=[v['y'] for loop in loops for v in loop]
            box=[min(xs),min(ys),max(xs),max(ys)]
            if view:   # 용지·출력 창 밖은 풀지 않는다
                box=[max(box[0],view['minX']),max(box[1],view['minY']),min(box[2],view['maxX']),min(box[3],view['maxY'])]
            if box[2]<=box[0] or box[3]<=box[1]:c.restoreState();return
            remaining=budget['segments'] if budget is not None else 200000
            segments,dots,dense=hatch_patterns.hatch_segments(hatch_patterns.hatch_families(e),tuple(box),max_segments=max(1,min(200000,remaining)))
            c.setFillColor(color)
            if budget is not None and len(segments)+len(dots)>budget['segments']:dense=True   # 점 무늬(AR-SAND 등)도 총량에 넣는다
            if dense:
                # 선이 너무 촘촘하면 화면·SVG 출력처럼 옅게 채운다(예전: 출력 전체가 오류로 멈췄다).
                c.setFillAlpha(.18);c.drawPath(p,stroke=0,fill=1,fillMode=0)
            else:
                if budget is not None:budget['segments']-=len(segments)+len(dots)
                c.setLineWidth(.13*scale);lines=c.beginPath()
                for x1,y1,x2,y2 in segments:lines.moveTo(x1,y1);lines.lineTo(x2,y2)
                c.drawPath(lines,stroke=1,fill=0)
                if dots:   # 점은 원 대신 둥근 끝 짧은 선 하나로(원 하나가 곡선 4개라 PDF 가 몇 배로 커졌다)
                    c.setLineCap(1);c.setLineWidth(.2*scale);marks=c.beginPath()
                    for x,y in dots:marks.moveTo(x,y);marks.lineTo(x+.001*scale,y)
                    c.drawPath(marks,stroke=1,fill=0)
    elif t=='point':c.circle(e['position']['x'],e['position']['y'],.25*scale,stroke=1,fill=0)
    else:raise ValueError('PDF 미지원 도형: '+t)
    c.restoreState()

# ACAD200 723 플롯 스탬프: 종이 네 모서리 중 하나에 한 줄. 도면 객체가 아니라 출력할 때만 찍는다.
STAMP_CORNERS=('bottom-left','bottom-right','top-left','top-right')
def draw_stamp(c,stamp,pw,ph):
    if not isinstance(stamp,dict):return False
    text=str(stamp.get('text') or '')[:400]
    if not text:return False
    corner=stamp.get('corner') if stamp.get('corner') in STAMP_CORNERS else 'bottom-left'
    h=min(10.0,max(1.0,float(stamp.get('height') or 2.5)));off=stamp.get('offset') or {}
    ox=min(50.0,max(0.0,float(off.get('x') or 0)));oy=min(50.0,max(0.0,float(off.get('y') or 0)))
    font();c.saveState();c.setFillColor(HexColor('#000000'));c.setFont(FONT,h)
    y=ph-oy-h if corner.startswith('top') else oy
    if corner.endswith('right'):c.drawRightString(pw-ox,y,text)
    else:c.drawString(ox,y,text)
    c.restoreState();return True

def _progress(callback, event):
    if callable(callback):
        try: callback(dict(event))
        except Exception: pass

def render(job, progress=None):
    font();out=io.BytesIO();c=canvas.Canvas(out,pageCompression=1)
    sheets=job['sheets']
    if not sheets or len(sheets)>200:raise ValueError('출력 시트는 1~200개입니다.')
    for index,s in enumerate(sheets, 1):
        if progress:_progress(progress, {'phase':'render', 'current':index, 'total':len(sheets), 'name':f"{s.get('number','')} {s.get('title','')}".strip(), 'completed':False})
        pw,ph=PAPERS[s.get('paper','A3')];scale=float(s.get('denominator',100));b=s['bounds'];margin=0
        if scale<=0:raise ValueError('축척은 양수입니다.')
        w,h=b['maxX']-b['minX'],b['maxY']-b['minY']
        if w/scale>pw+.001 or h/scale>ph+.001:raise ValueError(s.get('number','')+' 도면이 용지/축척 영역을 초과합니다.')
        c.setPageSize((pw*MM,ph*MM));c.saveState();c.scale(MM,MM)
        c.saveState();c.translate((pw-w/scale)/2,(ph-h/scale)/2);c.scale(1/scale,1/scale);c.translate(-b['minX'],-b['minY'])
        clip=c.beginPath();clip.rect(b['minX'],b['minY'],w,h);c.clipPath(clip,stroke=0,fill=0)
        budget={'segments':HATCH_SEGMENT_BUDGET}
        for e in s['entities']:draw(c,e,scale,s.get('colorMode','mono'),view=b,budget=budget)
        c.restoreState()
        # 예전 고정 줄은 설정이 없을 때만(기존 출력 그대로). stamp:false 면 찍지 않고, 사전이면 그 설정으로 찍는다.
        if isinstance(s.get('stamp'),dict):draw_stamp(c,s['stamp'],pw,ph)
        elif s.get('stamp') is not False:c.setFont(FONT,3);c.drawString(0,1,f"{s.get('number','')}  {s.get('title','')}  |  1:{scale:g}  |  {s.get('projectName','')}  {s.get('author','')}")
        # ACAD200 722 책갈피: 시트 번호·제목
        if s.get('number') or s.get('title'):key='sheet%d'%id(s);c.bookmarkPage(key);c.addOutlineEntry(f"{s.get('number','')} {s.get('title','')}".strip()[:120],key,level=0)
        c.restoreState();c.showPage()
        if progress:_progress(progress, {'phase':'render', 'current':index, 'total':len(sheets), 'name':f"{s.get('number','')} {s.get('title','')}".strip(), 'completed':True})
    if progress:_progress(progress, {'phase':'record'})
    c.save();return out.getvalue()

def plot_paper(data):
    """한 장 출력의 용지(mm)를 검사해 돌려준다."""
    pw,ph=map(float,data['size']);margin=float(data['margin']);den=float(data['denominator']);b=data['bounds']
    if not all(math.isfinite(v) for v in [pw,ph,margin,den]) or min(pw,ph,den)<=0 or max(pw,ph)>2000 or margin<0 or 2*margin>=min(pw,ph):raise ValueError('용지·여백·축척을 확인하세요.')
    w,h=b['maxX']-b['minX'],b['maxY']-b['minY']
    # 2026-10-23: nearest standard fit may overflow; preserve the chosen scale just like SVG/printing.
    if data.get('standardFit') is not True and (w/den>pw-2*margin+.001 or h/den>ph-2*margin+.001):raise ValueError('도면이 용지 영역을 초과합니다.')
    return pw,ph

def render_plot(data):
    font();pw,ph=plot_paper(data)
    out=io.BytesIO();c=canvas.Canvas(out,pagesize=(pw*MM,ph*MM),pageCompression=1);c.scale(MM,MM)
    if data.get('bookmark'):c.bookmarkPage('plot');c.addOutlineEntry(str(data['bookmark'])[:120],'plot',level=0)
    _draw_plot_body(c,data,pw,ph,layers=True)   # shortcut: 나눠 찍기(묶음 양식)는 레이어 없이 — 필요하면 양식 자원에도 Properties 를 단다
    c.showPage();c.save();return add_pdf_layers(out.getvalue(),c.__dict__.get('_barun_pdf_layers'))

def plot_origin(data,pw,ph):
    """창의 왼쪽 아래 자리: 플롯의 중심이면 인쇄 영역 가운데, 아니면 인쇄 영역 왼쪽 아래 + 간격띄우기(plot.js plotPlacement 와 같다)."""
    margin=float(data['margin']);den=float(data['denominator']);b=data['bounds'];w,h=b['maxX']-b['minX'],b['maxY']-b['minY']
    if data.get('center',True):return margin+(pw-2*margin-w/den)/2,margin+(ph-2*margin-h/den)/2
    ax,ay=margin+float(data.get('offsetX') or 0),margin+float(data.get('offsetY') or 0)
    if not (math.isfinite(ax) and math.isfinite(ay)):raise ValueError('플롯 간격띄우기를 확인하세요.')
    return ax,ay

def _draw_plot_body(c,data,pw,ph,layers=False):
    """용지 한 장의 내용(스탬프·도면). 단위는 mm(부르는 쪽이 c.scale(MM,MM) 한 뒤)."""
    margin=float(data['margin']);den=float(data['denominator']);b=data['bounds'];w,h=b['maxX']-b['minX'],b['maxY']-b['minY']
    c.saveState();draw_stamp(c,data.get('stamp'),pw,ph);ax,ay=plot_origin(data,pw,ph)
    if data.get('mirror'):c.translate(pw,ph);c.rotate(180)   # 대칭으로 플롯: 용지에서 180° 돌린다
    c.saveState();c.translate(ax-b['minX']/den,ay-b['minY']/den);c.scale(1/den,1/den)
    budget={'segments':HATCH_SEGMENT_BUDGET};open_layer=None;c._barun_mark=layers
    for e in data['entities']:
        # 도면 레이어를 PDF 레이어(OCG)로 묶는다: /OC /Ln BDC … EMC. 이름표는 add_pdf_layers 가 붙인다(블록 안 객체는 블록의 레이어로).
        name=e.get('pdfLayer') if layers and isinstance(e.get('pdfLayer'),str) else None
        if name!=open_layer:
            if open_layer is not None:c._code.append('EMC')
            if name is not None:c._code.append('/OC /%s BDC'%_pdf_layer_tag(c,name))
            open_layer=name
        draw(c,e,den,'color',view=b,budget=budget)
    if open_layer is not None:c._code.append('EMC')
    c.restoreState();c.restoreState()

def _pdf_layer_tag(c,name):
    tags=c.__dict__.setdefault('_barun_pdf_layers',{})
    return tags.setdefault(name,'L%d'%(len(tags)+1))

def add_pdf_layers(raw,layers):
    """render_plot 이 적은 /OC /Ln 표시에 OCG 사전을 달아 PDF 레이어로 만든다(오토캐드 PDF 처럼 레이어 창에 보이고, PDFIMPORT 가 PDF-<이름> 으로 나눠 읽는다)."""
    if not layers:return raw
    from pypdf.generic import ArrayObject,DictionaryObject,NameObject,TextStringObject
    writer=PdfWriter(clone_from=PdfReader(io.BytesIO(raw)))
    refs={tag:writer._add_object(DictionaryObject({NameObject('/Type'):NameObject('/OCG'),NameObject('/Name'):TextStringObject(name)})) for name,tag in layers.items()}
    for page in writer.pages:
        page['/Resources'][NameObject('/Properties')]=DictionaryObject({NameObject('/'+tag):ref for tag,ref in refs.items()})
    order=ArrayObject(refs.values())
    writer._root_object[NameObject('/OCProperties')]=DictionaryObject({NameObject('/OCGs'):order,NameObject('/D'):DictionaryObject({NameObject('/Order'):order,NameObject('/ON'):order})})
    out=io.BytesIO();writer.write(out);return out.getvalue()

# 나눠 찍기: 큰 용지(A1·A0)를 A4·A3 프린터로 여러 장 찍어 이어 붙인다.
# 도면은 한 번만 그려 묶음(Form XObject)으로 두고 장마다 창만 옮겨 다시 쓴다(장 수만큼 PDF 가 커지지 않게).
# 첫 장은 붙이는 순서 안내도(행 가·나·다, 열 1·2·3), 각 장에는 자르는 선(겹침 띠 경계)과 이웃 장 이름을 찍는다.
TILE_SHEETS={'A4':(210,297),'A3':(297,420)}
TILE_EDGE=7      # 프린터가 못 찍는 가장자리(mm). 안내 글자는 이 띠에 찍는다.
TILE_MAX=64
ROW_NAMES='가나다라마바사아자차카타파하'

def tile_grid(pw,ph,sheet,overlap):
    """큰 용지 pw×ph 를 덮는 장 배치. 세로·가로 놓기 중 장 수가 적은 쪽."""
    best=None
    for sw,sh in (sheet,sheet[::-1]):
        cw,ch=sw-2*TILE_EDGE,sh-2*TILE_EDGE
        if cw<=overlap or ch<=overlap:continue
        cols=1 if pw<=cw else math.ceil((pw-cw)/(cw-overlap))+1
        rows=1 if ph<=ch else math.ceil((ph-ch)/(ch-overlap))+1
        if best is None or cols*rows<best['cols']*best['rows']:best={'sw':sw,'sh':sh,'cw':cw,'ch':ch,'cols':cols,'rows':rows}
    if best is None:raise ValueError('겹침 폭이 너무 큽니다.')
    return best

def tile_name(row,col):return f"{ROW_NAMES[row] if row<len(ROW_NAMES) else row+1}{col+1}"

def render_tiled(data, progress=None):
    font();pw,ph=plot_paper(data);tile=data['tile'] if isinstance(data['tile'],dict) else {}   # 검사는 한 장 출력과 같다
    sheet=TILE_SHEETS.get(tile.get('paper'),TILE_SHEETS['A4']);sheet_name='A3' if sheet==TILE_SHEETS['A3'] else 'A4'
    overlap=float(tile.get('overlap',10))
    if not math.isfinite(overlap) or not 0<=overlap<=50:raise ValueError('겹침 폭은 0~50 mm 입니다.')
    # 빈 여백은 찍지 않는다: 도면이 실제로 놓이는 영역(용지 안)만 나눈다.
    den=float(data['denominator']);b=data['bounds'];ax,ay=plot_origin(data,pw,ph);dw,dh=(b['maxX']-b['minX'])/den,(b['maxY']-b['minY'])/den
    if data.get('mirror'):ax,ay=pw-ax-dw,ph-ay-dh
    rx,ry=max(0.0,ax),max(0.0,ay);rw,rh=min(pw,ax+dw)-rx,min(ph,ay+dh)-ry
    if rw<0 or rh<0 or (rw<=0 and rh<=0):raise ValueError('나눠 찍을 도면이 없습니다.')
    if rw<1:rx,rw=max(0.0,min(rx,pw-1)),1.0   # 수평선·수직선 하나뿐이어도(폭 0) 나눠 찍는다
    if rh<1:ry,rh=max(0.0,min(ry,ph-1)),1.0
    if isinstance(data.get('stamp'),dict) and data['stamp'].get('text'):rx,ry,rw,rh=0.0,0.0,pw,ph   # 스탬프는 용지 모서리에 찍히므로 용지 전체를 나눈다
    g=tile_grid(rw,rh,sheet,overlap);count=g['cols']*g['rows']
    if count>TILE_MAX:raise ValueError(f'나눠 찍기 장 수가 너무 많습니다({count}장). 용지를 줄이거나 A3 프린터를 고르세요.')
    if count==1:raise ValueError('도면이 프린터 용지 한 장에 들어갑니다. 나눠 찍기를 끄고 출력하세요.')
    if progress:_progress(progress, {'phase':'render', 'current':1, 'total':count+1, 'name':'붙임 안내', 'completed':False})
    out=io.BytesIO();c=canvas.Canvas(out,pageCompression=1)
    sw,sh,cw,ch=g['sw'],g['sh'],g['cw'],g['ch'];pitch_x,pitch_y=cw-overlap,ch-overlap
    # 큰 용지 한 장을 묶음으로: 한 장 출력과 같은 함수로 이 묶음 안에 한 번만 그린다.
    c.setPageSize((sw*MM,sh*MM));c.beginForm('whole',0,0,pw*MM,ph*MM);c.saveState();c.scale(MM,MM);_draw_plot_body(c,data,pw,ph);c.restoreState();c.endForm()
    origin=lambda r,col:(rx+col*pitch_x,ry+rh-ch-r*pitch_y)   # 장의 왼쪽 아래가 큰 용지의 어디인가(가 행 = 맨 위)
    blue=HexColor('#2f7fa6')
    # 1) 안내도: 큰 용지 전체를 줄여 보이고 장 이름을 겹쳐 찍는다
    c.saveState();c.scale(MM,MM);k=min((sw-2*TILE_EDGE-10)/pw,(sh-2*TILE_EDGE-40)/ph);ox,oy=(sw-pw*k)/2,TILE_EDGE+8
    paper_name={(594,841):'A1',(841,1189):'A0',(420,594):'A2',(297,420):'A3'}.get(tuple(sorted((round(pw),round(ph)))),f'{pw:g}×{ph:g} mm')
    c.setFont(FONT,5);c.drawString(TILE_EDGE+2,sh-TILE_EDGE-7,'나눠 찍기 붙임 안내')
    lines=[f"{paper_name} · 1:{den:g} 도면을 {sheet_name} {count}장으로 ({g['rows']}행 × {g['cols']}열, 겹침 {overlap:g} mm)",
           '1. 프린터 설정은 "실제 크기(100%)"로 찍으세요. 용지에 맞춤으로 찍으면 축척이 틀어집니다.',
           '2. 오른쪽·아래 장의 점선(자르는 선)을 따라 자르고, 왼쪽·위 장에 그림이 맞게 겹쳐 붙이세요.',
           '3. 장 이름: 가·나·다 = 위에서부터 행, 1·2·3 = 왼쪽부터 열.']
    c.setFont(FONT,3)
    for i,t in enumerate(lines):c.drawString(TILE_EDGE+2,sh-TILE_EDGE-13-i*4.5,t)
    c.saveState();c.translate(ox,oy);c.scale(k/MM,k/MM);c.doForm('whole');c.restoreState()
    c.setStrokeColor(HexColor('#9aa7ad'));c.setLineWidth(.2);c.rect(ox,oy,pw*k,ph*k)
    c.setStrokeColor(blue);c.setFillColor(blue)
    for r in range(g['rows']):
        for col in range(g['cols']):
            x,y=origin(r,col);x0,y0=ox+max(rx,x)*k,oy+max(ry,y)*k;x1,y1=ox+min(rx+rw,x+cw)*k,oy+min(ry+rh,y+ch)*k
            c.setDash([1,1]);c.rect(x0,y0,x1-x0,y1-y0);c.setDash([]);c.setFont(FONT,max(2.5,min(6,(x1-x0)/4,(y1-y0)/2)));c.drawCentredString((x0+x1)/2,(y0+y1)/2-1,tile_name(r,col))
    c.restoreState();c.showPage()
    if progress:_progress(progress, {'phase':'render', 'current':1, 'total':count+1, 'name':'붙임 안내', 'completed':True})
    # 2) 장마다: 창 안만 보이게 잘라 묶음을 옮겨 찍고, 자르는 선·이웃 장 이름을 가장자리에 찍는다
    for r in range(g['rows']):
        for col in range(g['cols']):
            if progress:_progress(progress, {'phase':'render', 'current':r*g['cols']+col+2, 'total':count+1, 'name':tile_name(r,col), 'completed':False})
            c.setPageSize((sw*MM,sh*MM));x,y=origin(r,col)
            c.saveState();c.scale(MM,MM)
            clip=c.beginPath();clip.rect(TILE_EDGE,TILE_EDGE,cw,ch);c.clipPath(clip,stroke=0,fill=0)
            c.saveState();c.translate(TILE_EDGE-x,TILE_EDGE-y);c.scale(1/MM,1/MM);c.doForm('whole');c.restoreState()
            c.restoreState();c.saveState();c.scale(MM,MM)
            c.setStrokeColor(blue);c.setFillColor(blue);c.setLineWidth(.15);c.setDash([2,1.2]);c.setFont(FONT,2.6)
            if col>0:c.line(TILE_EDGE+overlap,TILE_EDGE,TILE_EDGE+overlap,TILE_EDGE+ch);c.drawString(TILE_EDGE+overlap+1,TILE_EDGE-3.5,'왼쪽 자르는 선(점선)')
            if r>0:c.line(TILE_EDGE,TILE_EDGE+ch-overlap,TILE_EDGE+cw,TILE_EDGE+ch-overlap);c.drawRightString(sw-TILE_EDGE,sh-TILE_EDGE+1.5,'위쪽 자르는 선(점선)')
            c.setDash([]);c.setFont(FONT,3.2);c.drawString(TILE_EDGE,sh-TILE_EDGE+1.5,f'{tile_name(r,col)}  ({r*g["cols"]+col+1}/{count})')
            c.setFont(FONT,2.6)
            if col+1<g['cols']:c.drawRightString(sw-TILE_EDGE,TILE_EDGE-3.5,f'오른쪽 장 {tile_name(r,col+1)}')
            if r+1<g['rows']:c.drawCentredString(sw/2,TILE_EDGE-3.5,f'아래 장 {tile_name(r+1,col)}')
            c.restoreState();c.showPage()
            if progress:_progress(progress, {'phase':'render', 'current':r*g['cols']+col+2, 'total':count+1, 'name':tile_name(r,col), 'completed':True})
    if progress:_progress(progress, {'phase':'record'})
    c.save();return out.getvalue()

def process(data, progress=None):
    if data['action']=='plot' and data.get('tile'):
        return {'data':base64.b64encode(render_tiled(data, progress) if progress else render_tiled(data)).decode()}
    if data['action']=='plots':
        pages=data.get('pages')
        if not isinstance(pages,list) or not 1<=len(pages)<=200:raise ValueError('출력할 도면은 1~200장이어야 합니다.')
        writer=PdfWriter()
        for index,page in enumerate(pages, 1):
            if not isinstance(page,dict) or page.get('action')!='plot':raise ValueError('다중 플롯 페이지 형식 오류')
            if progress:_progress(progress, {'phase':'render', 'current':index, 'total':len(pages), 'name':page.get('bookmark') or '', 'completed':False})
            writer.append(PdfReader(io.BytesIO(render_plot({k:v for k,v in page.items() if k!='bookmark'}))))
            # ACAD200 722 책갈피: 다중 플롯·PUBLISH 의 쪽마다 시트 번호·제목
            if page.get('bookmark'):writer.add_outline_item(str(page['bookmark'])[:120],index-1)
            if progress:_progress(progress, {'phase':'render', 'current':index, 'total':len(pages), 'name':page.get('bookmark') or '', 'completed':True})
        out=io.BytesIO();writer.write(out);return {'data':base64.b64encode(out.getvalue()).decode()}
    if data['action']=='plot':
        _progress(progress, {'phase':'render', 'current':1, 'total':1, 'name':data.get('bookmark') or '', 'completed':False})
        result=render_plot(data); _progress(progress, {'phase':'render', 'current':1, 'total':1, 'name':data.get('bookmark') or '', 'completed':True}); return {'data':base64.b64encode(result).decode()}
    if data['action']=='render':return {'data':base64.b64encode(render(data, progress)).decode()}
    if data['action']=='merge':
        writer=PdfWriter()
        for encoded in data['files']:writer.append(PdfReader(io.BytesIO(base64.b64decode(encoded))))
        out=io.BytesIO();writer.write(out);return {'data':base64.b64encode(out.getvalue()).decode()}
    if data['action']=='split':
        reader=PdfReader(io.BytesIO(base64.b64decode(data['data'])));files=[]
        groups=data.get('groups') or [[i+1] for i in range(len(reader.pages))]
        for group in groups:
            writer=PdfWriter()
            for page in group:
                if not isinstance(page,int) or not 1<=page<=len(reader.pages):raise ValueError('PDF 페이지 번호 범위 오류')
                writer.add_page(reader.pages[page-1])
            out=io.BytesIO();writer.write(out);files.append(base64.b64encode(out.getvalue()).decode())
        return {'files':files,'pages':len(reader.pages)}
    raise ValueError('지원하지 않는 PDF 작업')

if __name__=='__main__':
    try:print(json.dumps(process(json.load(sys.stdin)),ensure_ascii=True))
    except Exception as e:print(json.dumps({'error':str(e)},ensure_ascii=True));sys.exit(1)
