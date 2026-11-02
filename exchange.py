"""Local DXF exchange using ezdxf (MIT); bundled ACadSharp for DWG."""
from pathlib import Path
from collections import Counter
import array, base64, hashlib, io, json, math, os, re, struct, sys, tempfile, time, uuid, zlib
import ezdxf
from ezdxf import recover
from ezdxf import colors, units
from ezdxf import path as dxfpath
from ezdxf.render.trace import TraceBuilder
from ezdxf.entities import Solid
from ezdxf.math import bulge_to_arc
from ezdxf.lldxf.tagwriter import TagCollector
from dimension_compat import jogged_points, BREAK_APPID, BREAK_SCHEMA

MAX_ENTITIES=2000000
# Extrusions within this XY tilt of ±Z are read as planar (see entity()).
NEAR_AXIS_TILT=1e-4
# Entities in other planes that are imported as their projection onto XY.
# Converted DXF sources up to this size are kept in the document for lossless saving.
PRESERVATION_LIMIT=250_000_000
PROJECTED_TYPES={'CIRCLE','ARC','ELLIPSE','LWPOLYLINE','SOLID','TRACE','INSERT','TEXT','ATTRIB','MTEXT','DIMENSION','ARC_DIMENSION','LARGE_RADIAL_DIMENSION'}


def can_share_block_reference(entity):
    """Only reuse INSERT transforms represented by our planar shared schema."""
    if entity.mcount != 1:return False
    sx=float(entity.dxf.xscale);sy=float(entity.dxf.yscale)
    if not math.isfinite(sx) or not math.isfinite(sy):return False
    # The shared schema holds a uniform scale, a rotation and an optional mirror
    # (see shared_block_transform), so (-s,-s) turns and one-axis mirrors share
    # their definition. Only a non-uniform scale is still expanded. Clipping is
    # carried on the reference in world coordinates, exactly as when expanded
    # (101/102동 대칭·잘린 층 평면 36만 개가 사본마다 펼쳐져 화면 메모리가 터졌다).
    # 604: 비균일 축척(x≠y)도 참조의 scaleX/scaleY 로 공유한다(AutoCAD 도 정의는 하나, 변환에 AcGeScale3d).
    # 단, 정의가 비균일 변환을 그대로 견디는 도형(선·꺾임 없는 폴리선 등)일 때만. 글자·원·호·영역·표·중첩 블록은
    # 비균일 축척에서 모양이 바뀌므로(타원·늘어난 글자·기울어짐) 예전처럼 펼쳐 굽는다.
    if sx==0 or sy==0:return False
    if abs(abs(sx)-abs(sy))>=1e-10 and not nonuniform_safe_block(entity):return False
    return tuple(entity.dxf.get('extrusion',(0,0,1)))==(0,0,1)

_NONUNIFORM_SAFE_TYPES={'LINE','POINT','SOLID','TRACE','3DFACE','LWPOLYLINE','POLYLINE','SPLINE'}
def nonuniform_safe_block(entity):
    """INSERT 의 정의가 비균일 축척을 참조 변환만으로 정확히 나타낼 수 있으면 True. 정의마다 한 번만 센다."""
    try:layout=entity.block()
    except Exception:return False
    if layout is None:return False
    cached=getattr(layout,'_barun_nonuniform_safe',None)
    if cached is not None:return cached
    safe=True
    for child in layout:
        kind=child.dxftype()
        if kind not in _NONUNIFORM_SAFE_TYPES:safe=False;break
        # get_points('b') 는 점마다 (bulge,) 한 칸 묶음을 준다. 예전에는 묶음째 float() 해 TypeError → 이 INSERT 가 통째로 빠졌다
        # (magnicad 화이트보드 벽체 상세의 도곽 글자 13개, 10-25 글자 전수 검사).
        if kind=='LWPOLYLINE' and any(abs(float(b[0] if isinstance(b,(tuple,list)) else b))>1e-12 for b in child.get_points('b')):safe=False;break
        if kind=='POLYLINE' and any(abs(float(v.dxf.get('bulge',0) or 0))>1e-12 for v in child.vertices):safe=False;break
    try:layout._barun_nonuniform_safe=safe
    except Exception:pass
    return safe

def can_share_array_reference(entity):
    """604 MINSERT(행·열 배열 삽입): 각 칸을 같은 정의의 참조로 둔다(정의를 펼치지 않는다)."""
    if entity.mcount<=1 or entity.mcount>100000:return False
    sx=float(entity.dxf.xscale);sy=float(entity.dxf.yscale)
    if not math.isfinite(sx) or not math.isfinite(sy) or sx==0 or sy==0:return False
    if abs(abs(sx)-abs(sy))>=1e-10 and not nonuniform_safe_block(entity):return False
    return tuple(entity.dxf.get('extrusion',(0,0,1)))==(0,0,1)

def shared_block_scales(entity):
    """(scaleX, scaleY) 크기. 같으면 None (예전 균일 참조 그대로)."""
    sx=abs(float(entity.dxf.xscale));sy=abs(float(entity.dxf.yscale))
    return None if abs(sx-sy)<1e-10 else (sx,sy)


_PLAIN_POINT_KEYS=('center','position','textPosition','origin','leaderPoint','quadrantPoint')
_PLAIN_TYPES={'line','polyline','rectangle','circle','arc','ellipse','text','point','hatch','block'}
_PLAIN_SKIP={'id','sourceHandle','sourceFingerprint'}
def _plain_points(node,out):
    for key in ('points',):
        for v in node.get(key) or []:out.append(v)
    for key in _PLAIN_POINT_KEYS:
        if isinstance(node.get(key),dict):out.append(node[key])
    for loop in node.get('loops') or []:out.extend(loop)
    for child in node.get('entities') or []:_plain_points(child,out)
def _plain_local(node,dx,dy):
    """일반 블록 자식을 기준점 기준으로 옮긴 사본. 모르는 좌표 필드가 있으면 None(그 블록은 예전처럼 따로 쓴다)."""
    if node.get('type') not in _PLAIN_TYPES or node.get('clip') or node.get('xref') or node.get('parameters') or node.get('sharedBlock') and node.get('entities'):return None
    out={}
    move=lambda v:{**v,'x':float(v['x'])+dx,'y':float(v['y'])+dy}
    for key,value in node.items():
        if key in _PLAIN_SKIP:continue
        if key=='points':out[key]=[move(v) for v in value]
        elif key in _PLAIN_POINT_KEYS and isinstance(value,dict):out[key]=move(value)
        elif key=='loops':out[key]=[[move(v) for v in loop] for loop in value]
        elif key=='patternLines':out[key]=[{**line,'base':move(line['base'])} for line in value]
        elif key=='entities':
            children=[_plain_local(child,dx,dy) for child in value]
            if any(child is None for child in children):return None
            out[key]=children
        elif key in ('majorAxis','attributes','attdef','table','model3d','tableCell','states'):out[key]=value
        elif isinstance(value,(dict,list)):
            if isinstance(value,list) and all(not isinstance(v,(dict,list)) for v in value):out[key]=value
            else:return None
        else:out[key]=value
    return out
def _rounded(value):
    if isinstance(value,float):return round(value,6)
    if isinstance(value,list):return [_rounded(v) for v in value]
    if isinstance(value,dict):return {k:_rounded(v) for k,v in sorted(value.items())}
    return value
def plain_block_signature(e):
    """605: (모양 해시, 기준점, 로컬 자식) 또는 None. 기준점은 position, 없으면 범위 왼쪽 아래."""
    children=e.get('entities') or []
    if not children or e.get('table') or e.get('xref'):return None
    base=e.get('position')
    if not isinstance(base,dict):
        pts=[];
        for child in children:_plain_points(child,pts)
        if not pts:return None
        base={'x':min(float(v['x']) for v in pts),'y':min(float(v['y']) for v in pts)}
    local=[_plain_local(child,-float(base['x']),-float(base['y'])) for child in children]
    if any(child is None for child in local):return None
    try:key=str(e.get('name',''))+'|'+json.dumps(_rounded(local),sort_keys=True,ensure_ascii=False)
    except (TypeError,ValueError):return None
    return key,base,local

def shared_block_transform(entity):
    """(scale, rotation, mirror) of a shareable INSERT. mirror flips local X before the rotation:
    (-s,-s) is s turned +180 degrees; (-s,s) is a mirror; (s,-s) is a mirror turned +180 degrees."""
    sx=float(entity.dxf.xscale);sy=float(entity.dxf.yscale);rotation=float(entity.dxf.rotation)
    mirror=(sx<0)!=(sy<0)
    if sy<0:rotation+=180.0
    return abs(sx),rotation%360.0,mirror


def insert_clip(entity,point):
    """World-coordinate XCLIP boundary of an INSERT (same form for shared and expanded blocks)."""
    from ezdxf.xclip import XClip
    clip=XClip(entity)
    if not clip.has_clipping_path:return None
    boundary=clip.get_wcs_clipping_path()
    result={'points':[point(v) for v in (boundary.inverted_clip if clip.is_inverted_clip else boundary.vertices)],'enabled':clip.is_clipping_enabled}
    if clip.is_inverted_clip:result['inverted']=True
    return result


def block_reference_scale_bounds(doc):
    """Conservative world-space stretch for every modelspace-reachable block.

    Products of max absolute x/y/z scales bound even rotated, nonuniform
    nested INSERTs. Multiple uses take the largest bound. Anything still
    growing past the supported nesting depth is conservatively unbounded.
    """
    def references(entities):
        values=[]
        for e in entities:
            if e.dxftype()!='INSERT':continue
            scales=[abs(float(e.dxf.get(axis+'scale',1))) for axis in ('x','y','z')]
            gain=max(scales) if all(math.isfinite(s) for s in scales) else math.inf
            values.append((e.dxf.name.casefold(),gain))
        return values
    edges={block.name.casefold():references(block) for block in doc.blocks}
    bounds={}
    for name,gain in references(doc.modelspace()):bounds[name]=max(bounds.get(name,0),gain)
    frontier=dict(bounds)
    for _ in range(13):
        next_frontier={}
        for name,gain in frontier.items():
            for child,scale in edges.get(name,[]):
                value=gain*scale
                if not math.isfinite(value):value=math.inf
                if value>bounds.get(child,-1):
                    bounds[child]=value;next_frontier[child]=value
        frontier=next_frontier
        if not frontier:break
    if frontier:
        pending=list(frontier);seen=set()
        while pending:
            name=pending.pop()
            if name in seen:continue
            seen.add(name);bounds[name]=math.inf
            pending.extend(child for child,_ in edges.get(name,[]))
    return bounds


def polyline_width_pairs(entity):
    """Effective vertex widths, with the same precedence as TraceBuilder."""
    if entity.dxftype()=='LWPOLYLINE':
        width=float(entity.dxf.get('const_width',0) or 0)
        pairs=[(width,width) if width else (s,e) for s,e in entity.get_points('se')]
    else:
        ds,de=entity.dxf.get('default_start_width',0),entity.dxf.get('default_end_width',0)
        pairs=[(v.dxf.get('start_width',ds),v.dxf.get('end_width',de)) for v in entity.vertices]
    return [(max(0.0,float(s or 0)),max(0.0,float(e or 0))) for s,e in pairs]


def polyline_widths(entity):
    """Return (none/uniform/varying, width) for the segments that are drawn.

    A nonzero LWPOLYLINE constant width overrides vertex widths. For an old
    2D POLYLINE, defaults apply only to missing vertex width attributes.
    The last vertex of an open polyline starts no segment.
    """
    pairs=polyline_width_pairs(entity)
    closed=bool(entity.closed if entity.dxftype()=='LWPOLYLINE' else entity.is_closed)
    used=pairs if closed else pairs[:-1]
    values={x for pair in used for x in pair}
    if not values or values=={0.0}:return ('none',0.0)
    if len(values)==1:return ('uniform',used[0][0])
    return ('varying',0.0)


def planar_polyline_segments(entity):
    """Yield OCS (start, end, bulge) segments, including the closing segment."""
    lightweight=entity.dxftype()=='LWPOLYLINE'
    vertices=list(entity.get_points('xyb')) if lightweight else [(v.dxf.location.x,v.dxf.location.y,v.dxf.bulge) for v in entity.vertices]
    closed=bool(entity.closed if lightweight else entity.is_closed)
    for i in range(len(vertices) if closed else len(vertices)-1):
        x,y,bulge=vertices[i];other=vertices[(i+1)%len(vertices)]
        yield (x,y),other[:2],bulge


def arc_sagitta_step(radius,tolerance):
    # asin avoids cancellation for a small tolerance / large radius.
    return 4*math.asin(min(1.0,math.sqrt(tolerance/radius/2)))


def flatten_width_polyline(entity,tolerance,limit=20000):
    """Flatten exact bulge arcs in OCS, or return None above the point limit."""
    closed=bool(entity.closed if entity.dxftype()=='LWPOLYLINE' else entity.is_closed)
    segments=list(planar_polyline_segments(entity));points=[]
    for i,(start,end,bulge) in enumerate(segments):
        if not points:points.append(start)
        count=1
        if bulge and start!=end:
            center,a,b,radius=bulge_to_arc(start,end,bulge)
            sweep=(b-a)%math.tau
            count=max(1,math.ceil(sweep/arc_sagitta_step(radius,tolerance)))
        closing=closed and i==len(segments)-1
        if len(points)+count-int(closing)>limit:return None
        if count>1:
            angle=a if bulge>0 else b
            sweep=math.copysign(sweep,bulge)
            points.extend((center.x+radius*math.cos(angle+sweep*j/count),center.y+radius*math.sin(angle+sweep*j/count)) for j in range(1,count))
        if not closing:points.append(end)
    if closed and len(points)>2 and points[0]==points[-1]:points.pop()
    return points


def width_trace_segments(entity,tolerance):
    """Segments per full circle, sized for the largest used bulge radius."""
    radius=max((bulge_to_arc(start,end,bulge)[3] for start,end,bulge in planar_polyline_segments(entity) if bulge and start!=end),default=0)
    return max(32,min(4096,math.ceil(math.tau/arc_sagitta_step(radius,tolerance)))) if radius else 32


def stable_bulge_polyline(entity, factor, outer_scale=1.0):
    """Avoid huge virtual arcs for effectively straight segments, on a copy.

    A tiny bulge can produce an arc beyond the editor's 1e12 mm radius
    limit even though the actual segment stays close to its endpoints.
    Only those out-of-range arcs with at most 1e-6 mm sagitta are replaced
    by their chord. Original DXF entities and meaningful curves stay intact.
    """
    lightweight=entity.dxftype()=='LWPOLYLINE'
    if not lightweight and not entity.is_2d_polyline:return entity,0
    vertices=list(entity.get_points('xyb')) if lightweight else [(v.dxf.location.x,v.dxf.location.y,v.dxf.bulge) for v in entity.vertices]
    closed=bool(entity.closed if lightweight else entity.is_closed)
    changes=[]
    for i,(x,y,bulge) in enumerate(vertices):
        if not bulge or not math.isfinite(bulge) or i==len(vertices)-1 and not closed:continue
        other=vertices[(i+1)%len(vertices)]
        chord=math.hypot(other[0]-x,other[1]-y)*factor
        sagitta=abs(bulge)*chord/2
        radius=chord*(1+bulge*bulge)/(4*abs(bulge))
        if math.isfinite(sagitta) and 0<sagitta and sagitta*outer_scale<=1e-6 and radius>1e12:changes.append(i)
    if not changes:return entity,0
    stable=entity.copy()
    if lightweight:
        points=list(stable.get_points('xyseb'))
        for i in changes:points[i]=(*points[i][:4],0)
        stable.set_points(points,format='xyseb')
    else:
        for i in changes:stable.vertices[i].dxf.bulge=0
    return stable,len(changes)

def dxf_unicode(value):
    text=re.sub(r'\\U\+([0-9A-Fa-f]{4})',lambda m:chr(int(m.group(1),16)),str(value))
    # BMP 밖 글자(이모지·한자 확장 B)는 읽을 때 서로게이트 쌍 두 개로 적어 두었다 — 다시 한 글자로 합친다.
    if any('\ud800'<=ch<='\udbff' for ch in text):
        text=text.encode('utf-16-le','surrogatepass').decode('utf-16-le','replace')
    return text

# 문자 원문 코드(text-codes.js 와 같은 규칙). 505: TEXT 의 %% 제어 코드, 502: MTEXT 의 \ { } 이스케이프.
_PERCENT_SYMBOLS={'c':'\u00d8','d':'\u00b0','p':'\u00b1'}
_PERCENT_ENCODE={'\u00d8':'%%c','\u2300':'%%c','\u00b0':'%%d','\u00b1':'%%p'}
def percent_to_plain(raw):
    """TEXT 원문 → 화면 문자: %%c Ø, %%d °, %%p ±, %%% %, %%nnn 문자 코드. %%u·%%o·%%k(꾸밈)는 글자가 없어 빠진다."""
    s=str(raw)
    if '%%' not in s:return s
    out=[];i=0;n=len(s)
    while i<n:
        if s[i]!='%' or i+2>=n or s[i+1]!='%':out.append(s[i]);i+=1;continue
        nxt=s[i+2];digits=s[i+2:i+5]
        if len(digits)==3 and digits.isdigit() and digits.isascii():out.append(chr(int(digits)));i+=5
        elif nxt.lower() in _PERCENT_SYMBOLS:out.append(_PERCENT_SYMBOLS[nxt.lower()]);i+=3
        elif nxt=='%':out.append('%');i+=3
        elif nxt.lower() in 'uok':i+=3
        else:out.append(s[i]);i+=1
    return ''.join(out)
def encode_percent(text):
    """화면 문자 → TEXT 원문. 기호는 SHX 글꼴에서도 보이게 %% 코드로, 코드로 읽힐 % 만 %%% 로."""
    s=str(text);out=''
    for i,ch in enumerate(s):
        if ch in _PERCENT_ENCODE:out+=_PERCENT_ENCODE[ch];continue
        if ch!='%':out+=ch;continue
        touches=(i>0 and s[i-1]=='%') or (i+1<len(s) and (s[i+1]=='%' or s[i+1] in _PERCENT_ENCODE)) or out.endswith('%')
        out+='%%%' if touches else '%'
    return out
def mtext_character_widths(raw,style_width):
    """Count visible non-space characters at each scoped MTEXT width."""
    widths=Counter();values={};stack=[];width=style_width;i=0
    while i<len(raw):
        ch=raw[i];i+=1
        if ch=='{':stack.append(width);continue
        if ch=='}':
            if stack:width=stack.pop()
            continue
        if ch=='%' and i+1<len(raw) and raw[i]=='%' and raw[i+1].lower() in _PERCENT_SYMBOLS:
            ch=_PERCENT_SYMBOLS[raw[i+1].lower()];i+=2
        if ch=='\\' and i<len(raw):
            code=raw[i];i+=1
            if code in '\\{}':ch=code
            elif code=='W' or code in 'ACcFfHQTpS':
                end=raw.find(';',i)
                if end<0:continue
                if code=='W':
                    value=raw[i:end];relative=value.endswith('x')
                    try:value=float(value[:-1] if relative else value)
                    except ValueError:value=0
                    if math.isfinite(value) and value>0:width=max(.01,min(100,value*width if relative else value))
                i=end+1;continue
            elif code in 'PLlOoKkN~':continue
            else:ch=code
        if not ch.isspace():widths[values.setdefault(round(width,12),width)]+=1
    return widths


def plain_to_mtext(text):
    """평문 → MTEXT 원문. \\ { } 를 글자로 남게 이스케이프한 뒤 줄바꿈을 \\P 로(순서가 중요하다)."""
    return str(text).replace('\\','\\\\').replace('{','\\{').replace('}','\\}').replace('\r\n','\n').replace('\n','\\P')
# 504 자리맞추기(text-justify.js 의 TEXT_JUSTIFY 와 같은 표): (DXF 72, 73) ↔ 이름, 맞춤점에서 기준선까지 내림(높이 배수).
TEXT_JUSTIFY_KEYS={(0,0):'L',(1,0):'C',(2,0):'R',(3,0):'A',(4,0):'M',(5,0):'F',(0,1):'BL',(1,1):'BC',(2,1):'BR',(0,2):'ML',(1,2):'MC',(2,2):'MR',(0,3):'TL',(1,3):'TC',(2,3):'TR'}
TEXT_JUSTIFY_CODES={key:code for code,key in TEXT_JUSTIFY_KEYS.items()}
TEXT_JUSTIFY_DROP={'L':0,'C':0,'R':0,'A':0,'F':0,'M':.5,'BL':-.25,'BC':-.25,'BR':-.25,'ML':.5,'MC':.5,'MR':.5,'TL':1,'TC':1,'TR':1}
_WIDE_TEXT=re.compile('[ᄀ-ᇿ⺀-鿿가-힣豈-﫿︰-﹏＀-｠￠-￦]')
def text_units(text):
    """문자 폭 어림(높이 1 기준, geometry.js textLineUnits 와 같은 규칙): 넓은 글자 1.0, 나머지 0.65."""
    return max([sum(1 if _WIDE_TEXT.match(ch) else .65 for ch in line) for line in str(text).split('\n')]+[.65])
# 509 문자 스타일 표(doc.textStyles = {이름: {font, bigFont, height, widthFactor, oblique}}) — text-style.js 와 같은 모양.
def read_text_styles(doc):
    styles={}
    for s in doc.styles:
        name=dxf_unicode(s.dxf.get('name','') or '')
        if not name or s.dxf.get('flags',0)&1:continue   # 이름 없는 것·셰이프 파일 항목은 문자 스타일이 아니다
        font=dxf_unicode(s.dxf.get('font','') or '')
        if not font and name.lower()!='standard':continue
        styles[name]={'font':font,'bigFont':dxf_unicode(s.dxf.get('bigfont','') or ''),'height':float(s.dxf.get('height',0) or 0),'widthFactor':float(s.dxf.get('width',1) or 1),'oblique':float(s.dxf.get('oblique',0) or 0)}
    return styles
def apply_text_styles(doc,styles):
    """표의 스타일을 DXF STYLE 로 쓴다(글꼴·빅폰트·고정 높이·폭 비율·기울기). 이름이 잘못된 스타일은 건너뛴다."""
    done={}
    for name,s in (styles or {}).items():
        name=str(name or '').strip()
        if not name or any(c in name for c in '<>/\\":;?*|=') or not isinstance(s,dict):continue
        font=str(s.get('font') or '').strip();big=str(s.get('bigFont') or '').strip()
        if not font:continue
        style=doc.styles.get(name) if name in doc.styles else doc.styles.new(name)
        style.dxf.font=font
        if big:style.dxf.bigfont=big
        else:style.dxf.discard('bigfont')
        for key,attr,low in (('height','height',0),('widthFactor','width',.01),('oblique','oblique',-85)):
            v=s.get(key)
            if isinstance(v,(int,float)) and math.isfinite(v) and v>=low:setattr(style.dxf,attr,float(min(v,85) if key=='oblique' else v))
        done[name.lower()]=(font.lower(),big.lower())
    return done

# 511 축척 목록(doc.scaleList = [{name, paper, drawing, unit?}]) — scale-list.js 와 같은 모양.
_ACAD_DEFAULT_SCALES={'1:1','1:2','1:4','1:5','1:8','1:10','1:16','1:20','1:30','1:40','1:50','1:100','2:1','4:1','8:1','10:1','100:1'}
def read_scale_list(doc):
    """ACAD_SCALELIST → 목록. AutoCAD 기본 목록을 그대로 둔 도면은 [](바른 CAD 기본 = 한국 건축 축척을 쓴다)."""
    try:sl=doc.rootdict.get('ACAD_SCALELIST')
    except Exception:return []
    out=[];seen=set()
    for _key,obj in (sl.items() if sl is not None and hasattr(sl,'items') else []):
        try:tags={t.code:t.value for t in obj.xtags.get_subclass('AcDbScale')}
        except Exception:continue
        name=dxf_unicode(tags.get(300,'')).strip();paper=float(tags.get(140,0) or 0);drawing=float(tags.get(141,0) or 0)
        if not name or name in seen or not (paper>0 and drawing>0):continue
        seen.add(name);item={'name':name,'paper':paper,'drawing':drawing}
        if int(tags.get(290,0) or 0):item['unit']=True
        out.append(item)
    plain=[s['name'] for s in out if '"' not in s['name'] and "'" not in s['name']]
    if all(n in _ACAD_DEFAULT_SCALES for n in plain):return []
    return sorted(out,key=lambda s:s['drawing']/s['paper'])
def write_scale_list(doc,scales):
    """목록의 축척 중 DXF 에 없는 이름만 더한다(있는 축척은 주석 표현이 가리키고 있을 수 있어 지우거나 바꾸지 않는다)."""
    from ezdxf.entities import factory
    from ezdxf.lldxf.extendedtags import ExtendedTags
    sl=doc.rootdict.get('ACAD_SCALELIST')
    if sl is None:sl=doc.rootdict.add_new_dict('ACAD_SCALELIST')
    have=set()
    for _key,obj in sl.items():
        try:have.add(str({t.code:t.value for t in obj.xtags.get_subclass('AcDbScale')}.get(300,'')))
        except Exception:pass
    keys=set(sl.keys());index=0;added=0
    for s in scales or []:
        try:name=str(s['name']).strip();paper=float(s['paper']);drawing=float(s['drawing'])
        except Exception:continue
        if not name or name in have or not (paper>0 and drawing>0) or any(c in name for c in '\r\n'):continue
        while True:
            key=('A' if index<10 else chr(ord('B')+(index-10)//10))+str(index%10);index+=1
            if key not in keys:break
        handle=doc.entitydb.next_handle()
        raw=f'0\nSCALE\n5\n{handle}\n330\n{sl.dxf.handle}\n100\nAcDbScale\n70\n0\n300\n{name}\n140\n{paper!r}\n141\n{drawing!r}\n290\n{1 if s.get("unit") else 0}\n'
        obj=factory.load(ExtendedTags.from_text(raw),doc=doc);doc.entitydb.add(obj);doc.objects.add_object(obj)
        sl[key]=obj;keys.add(key);have.add(name);added+=1
    return added

# 521 블록 속성: 속성 글자(ATTRIB)는 블록 안 문자로 두되 attributeTag(태그)를 붙인다 — 속성 값을 고치면 그 글자가 같이 바뀌고,
# 다시 쓸 때 위치·높이·각도·보임 그대로 ATTRIB 가 된다. 보이지 않는 속성도 숨긴 문자로 남겨 왕복해도 잃지 않는다.
def attribute_children(attribs,convert):
    out=[]
    for v in attribs:
        child=convert(v)
        if not child or child.get('type')!='text':continue
        child['attributeTag']=dxf_unicode(v.dxf.tag)
        if v.is_invisible:child['hidden']=True
        if v.is_const:child['attributeConstant']=True
        out.append(child)
    return out

def source_code_text(e,kind,style_width=1):
    """Reuse imported codes only while both the text and its MTEXT width match."""
    raw=e.get('codeText');width=float(e.get('widthFactor',1) or 1)
    if isinstance(raw,str) and e.get('codeKind')==kind and e.get('codePlain')==e.get('text') and (kind!='mtext' or e.get('codeWidth',width)==width):return raw
    if kind!='mtext':return encode_percent(e['text'])
    content=plain_to_mtext(e['text'])
    return (f'\\W{width:.15g};' if width!=1 or style_width!=1 else '')+content


def _repair_truncated_ascii_dxf(source):
    """Create a conservative repaired copy for an otherwise parseable DXF.

    Only missing section terminators/EOF are repaired.  The source is never
    modified; the returned path is inside a private temporary directory.
    """
    raw=source.read_bytes()
    if raw.startswith(b'AutoCAD Binary DXF') or b'\n0\nSECTION' not in raw:
        return None
    text=raw.decode('ascii','surrogateescape')
    upper=text.upper()
    sections=len(re.findall(r'(?:^|\n)0\nSECTION(?:\r?\n|$)',upper))
    endsecs=len(re.findall(r'(?:^|\n)0\nENDSEC(?:\r?\n|$)',upper))
    has_eof=bool(re.search(r'(?:^|\n)0\nEOF\s*$',upper))
    if endsecs>=sections and has_eof:
        return None
    if endsecs>sections or sections==0:
        return None
    repaired=text.rstrip('\r\n')
    if endsecs<sections:
        repaired+='\n0\nENDSEC'*(sections-endsecs)
    if not has_eof:
        repaired+='\n0\nEOF'
    return repaired.encode('ascii','surrogateescape')

_NON_ASCII=re.compile('[^\x00-\x7f\udc80-\udcff]')
def _dxf_unicode_escape(match):
    ch=match.group();code=ord(ch)
    if code<=0xffff:return '\\U+%04X'%code
    # BMP 밖 글자는 \U+XXXX 네 자리로 못 적으므로 서로게이트 쌍으로 적는다(예전: 그대로 두어 ASCII 저장에서 오류 → 손상 복구 모드).
    code-=0x10000;return '\\U+%04X\\U+%04X'%(0xd800+(code>>10),0xdc00+(code&0x3ff))

def _dgn_filtered_bytes(raw):
    """Remove DGN helper records using aligned code/value pairs only.

    Keep byte offsets so all surviving content, including custom object names
    and line endings, stays exact. Uncertain structure leaves the source intact.
    """
    if raw.startswith(b'AutoCAD Binary DXF') or b'LS' not in raw and b'ls' not in raw:
        return raw
    # 후보 검사는 빠르게 하고, 실제 삭제는 아래 코드/값 짝 읽기로만 한다.
    objects=raw.find(b'OBJECTS')
    if objects<0:objects=raw.find(b'objects')
    if objects<0:
        marker=re.search(rb'(?mi)^[ \t]*OBJECTS[ \t]*\r?$',raw)
        if marker is None:return raw
        objects=marker.start()
    if objects<0 or re.compile(rb'(?mi)^[ \t]*LS[^\r\n]*\r?$').search(raw,objects) is None:return raw
    stream=io.BytesIO(raw);section=None;expect_section=False;eof=False
    record=[];removed=set();spans=[];dictionaries=[]

    def finish_record(stop):
        if not record:return True
        kind=record[0][1].upper()
        if kind.startswith(b'LS'):
            handles=[value.upper() for code,value,a,b in record if code==5]
            if len(handles)!=1 or not re.fullmatch(rb'[0-9A-F]+',handles[0]):return False
            removed.add(handles[0]);spans.append((record[0][2],stop))
        elif kind in (b'DICTIONARY',b'ACDBDICTIONARYWDFLT'):
            entries=[]
            for index,(code,value,a,b) in enumerate(record):
                if code!=3:continue
                if index+1==len(record) or record[index+1][0] not in (350,360):return False
                pointer=record[index+1]
                if not re.fullmatch(rb'[0-9A-Fa-f]+',pointer[1]):return False
                entries.append((value.upper(),pointer[1].upper(),a,pointer[3]))
            dictionaries.extend(entries)
        return True

    while stream.tell()<len(raw):
        start=stream.tell();code_line=stream.readline();value_line=stream.readline()
        if not value_line or not re.fullmatch(rb'[0-9]{1,4}',code_line.strip()):return raw
        code=int(code_line);value=value_line.strip();stop=stream.tell()
        if code>1071 or eof:return raw
        if expect_section:
            if code!=2 or not value:return raw
            section=value.upper();expect_section=False;continue
        if code==0:
            if section==b'OBJECTS':
                if not finish_record(start):return raw
                record=[]
            kind=value.upper()
            if kind==b'SECTION':
                if section is not None:return raw
                expect_section=True
            elif kind==b'ENDSEC':
                if section is None:return raw
                section=None
            elif kind==b'EOF':
                if section is not None:return raw
                eof=True
            elif section==b'OBJECTS':
                if not value:return raw
                record=[(code,value,start,stop)]
            elif section is None:return raw
        elif section==b'OBJECTS':
            if not record:return raw
            record.append((code,value,start,stop))
        elif section is None:return raw
    if section is not None or expect_section or not eof:return raw
    for name,handle,start,stop in dictionaries:
        if name.startswith(b'ACAD_DGNLINESTYLE') or handle in removed:spans.append((start,stop))
    if not spans:return raw
    parts=[];cursor=0
    for start,stop in sorted(spans):
        if start<cursor:return raw
        parts.append(raw[cursor:start]);cursor=stop
    parts.append(raw[cursor:])
    return b''.join(parts)


def _own_seqends(drawing):
    """INSERT·POLYLINE 의 SEQEND 주인(330)을 그 부모 객체로 맞춘다. ezdxf 는 부모의 주인(모형 공간)을 적는데,
    내장 DWG 엔진(ACadSharp)은 그 SEQEND 를 모형 공간의 단독 객체로 읽어 'Entity not implemented: Seqend' 로
    DWG 저장 전체가 실패했다 — 속성 있는 문·창 블록 하나만 있어도 (A21, 10-20 K46)."""
    fixed=0
    for entity in list(drawing.entitydb.values()):
        seqend=getattr(entity,'seqend',None)
        if seqend is not None and seqend.is_alive and entity.dxf.get('handle') and seqend.dxf.get('owner')!=entity.dxf.handle:
            seqend.dxf.owner=entity.dxf.handle;fixed+=1
    return fixed

_CODEPAGE=re.compile(rb'\$DWGCODEPAGE[ \t]*\r?\n[ \t]*3[ \t]*\r?\n[ \t]*(\S+)')
def _legacy_utf8_encoding(raw):
    """R2004 이하 DXF 인데 코드페이지가 없거나 기본값(ANSI_1252)이고 내용이 올바른 UTF-8 이면 'utf-8'.
    다른 프로그램이 UTF-8 로 내보낸 R12 DXF 의 한글 레이어 이름이 'ê¸€ì”¨' 처럼 깨졌다 (A11, 10-20 K19).
    CP949 한글 바이트는 UTF-8 로 올바르게 읽히는 일이 거의 없어 진짜 CP949 파일은 그대로 CP949 로 읽는다."""
    match=_CODEPAGE.search(raw[:131072])
    if match and match.group(1).upper()!=b'ANSI_1252':return None
    if raw.isascii():return None
    try:raw.decode('utf-8')
    except UnicodeDecodeError:return None
    return 'utf-8'

def _compiled_dxf_tags(stream,chunk=1<<24):
    """2026-10-30 ezdxf 1.4.4 의 tag_compiler(ascii_tags_loader(stream)) 와 같은 태그 열(같은 형식·코드·값)을 만든다.
    주통(19만 객체, 기본 엔진 DXF 166 MB·태그 1,066만 개) 태그 읽기 CPU 10초 → 5초: 줄마다 readline·태그 두 번 만들기를 빼고,
    16M 글자씩 읽어 줄로 나누고, 코드 줄은 같은 글자끼리 한 번만 int() 하고, 되풀이되는 글자·정수 태그(레이어·주인·하위 클래스·색)는
    한 객체를 같이 쓴다(DXFTag 는 바뀌지 않는 객체 — ezdxf 도 clone() 이 자기 자신). 점(DXFVertex)·이진·실수·핸들(5)은 따로 만든다.
    readline 이 보는 줄 = 글 전체.split('\\n')(마지막 줄바꿈 뒤 빈 조각 제외), 999 주석 건너뜀, EOF 태그 뒤는 읽지 않음, 2D 점 뒤 태그 되돌림,
    값 없는 코드·z 를 기다리다 끝나면 조용히 끝냄 — 모두 ezdxf 와 같다. 틀린 코드·숫자는 DXFStructureError(EOF 뒤 줄까지 보아 더 엄격):
    부르는 쪽이 ezdxf.readfile 로 다시 읽어 ezdxf 와 같은 결과·같은 오류가 된다. test_fast_dxf_tags.py 가 실제 도면·시험 DXF 에서 태그 열을 맞춰 본다."""
    from ezdxf.lldxf.types import DXFTag,DXFVertex,DXFBinaryTag,POINT_CODES,BINARY_DATA,TYPE_TABLE
    number={};kinds={};shared={}
    def pairs():
        rest='';done=False
        while not done:
            block=stream.read(chunk)
            if block:
                text=rest+block;cut=text.rfind('\n')
                if cut<0:rest=text;continue
                lines=text[:cut].split('\n');rest=text[cut+1:]
                if len(lines)%2:rest=lines.pop()+'\n'+rest
            else:
                lines=rest.split('\n');done=True
                if lines[-1]=='':lines.pop()   # 끝 줄바꿈 뒤 빈 조각은 줄이 아니다
            code_lines=lines[0::2]
            for s in set(code_lines).difference(number):
                try:c=number[s]=int(s)
                except ValueError:raise ezdxf.DXFStructureError('invalid group code') from None
                kinds[c]=kind=TYPE_TABLE.get(c,str)
                if kind is not float and c not in POINT_CODES and c not in BINARY_DATA and c!=5:shared.setdefault(c,{})
            got=zip(map(number.__getitem__,code_lines),lines[1::2])   # 값 줄 없는 마지막 코드는 zip 이 버린다
            yield from ((c,v) for c,v in got if c!=999) if 999 in kinds else got
    it=pairs();undo=None
    for code,value in it:
        while True:
            eof=code==0 and value=='EOF'
            if code in POINT_CODES:
                try:
                    yc,yv=next(it)
                    if yc!=code+10:raise ezdxf.DXFStructureError('missing y coordinate')
                    zc,zv=next(it)
                except StopIteration:return
                try:
                    if zc==code+20:p=(float(value),float(yv),float(zv))
                    else:p=(float(value),float(yv));undo=(zc,zv)
                except ValueError:raise ezdxf.DXFStructureError('invalid coordinate') from None
                yield DXFVertex(code,p)
            elif code in BINARY_DATA:
                try:yield DXFBinaryTag.from_string(code,value)
                except ValueError:raise ezdxf.DXFStructureError('invalid binary data') from None
            else:
                kind=kinds[code]
                if code==0:value=value.strip()
                cache=shared.get(code);tag=cache.get(value) if cache is not None else None
                if tag is None:
                    try:tag=DXFTag(code,kind(value))
                    except ValueError:
                        if kind is not int:raise ezdxf.DXFStructureError('invalid value') from None
                        try:tag=DXFTag(code,int(float(value)))   # ezdxf 처럼: 정수 자리에 실수로 적은 값
                        except ValueError:raise ezdxf.DXFStructureError('invalid value') from None
                    else:
                        if cache is not None:cache[value]=tag
                yield tag
            if eof:return
            if undo is None:break
            code,value=undo;undo=None

def _readfile(filename,encoding=None):
    """ezdxf.readfile 과 같은 문서를 _compiled_dxf_tags 로 읽는다(이진 DXF·DXF 가 아닌 파일·구조 오류는 ezdxf.readfile 그대로)."""
    from ezdxf.lldxf.validator import is_dxf_file,is_binary_dxf_file
    from ezdxf.tools.codepage import is_supported_encoding
    from ezdxf.document import Drawing
    from ezdxf.filemanagement import dxf_file_info
    filename=str(filename)
    if is_binary_dxf_file(filename) or not is_dxf_file(filename):return ezdxf.readfile(filename,encoding=encoding)
    info=dxf_file_info(filename)
    if encoding is not None:info.encoding=encoding
    try:
        with open(filename,mode='rt',encoding=info.encoding,errors='surrogateescape') as fp:doc=Drawing.from_tags(_compiled_dxf_tags(fp))
    except ezdxf.DXFStructureError:return ezdxf.readfile(filename,encoding=encoding)
    doc.filename=filename
    if encoding is not None and is_supported_encoding(encoding):doc.encoding=encoding
    return doc

def read_dxf_preserving_unicode(source, temp_root=None):
    """Read one temporary parsing copy, preserving the original source bytes."""
    raw=source.read_bytes();filtered=_dgn_filtered_bytes(raw);normalized=filtered;encoding=None
    if not filtered.startswith(b'AutoCAD Binary DXF'):
        try:
            head=filtered[:512].decode('ascii','ignore')
            version=next((v for v in ('AC1032','AC1027','AC1024','AC1021') if v in head),None)
            if version:
                decoded=filtered.decode('utf-8',errors='surrogateescape')
                if _NON_ASCII.search(decoded):
                    normalized=_NON_ASCII.sub(_dxf_unicode_escape,decoded).encode('ascii',errors='surrogateescape')
            else:encoding=_legacy_utf8_encoding(filtered)
        except UnicodeError:pass
    read=(lambda path:_readfile(path,encoding=encoding)) if encoding else _readfile
    if normalized is raw:return read(source)
    owned=None;copy_path=None
    try:
        if temp_root is None:
            owned=tempfile.TemporaryDirectory(prefix='barun_dxf_read_');root=Path(owned.name)
        else:
            root=Path(temp_root);root.mkdir(parents=True,exist_ok=True)
        with tempfile.NamedTemporaryFile(prefix='parsing-',suffix='.dxf',dir=root,delete=False) as copy:
            copy_path=Path(copy.name);copy.write(normalized)
        try:return read(copy_path)
        except ezdxf.DXFError:
            if normalized is filtered:raise
            # Preserve the legacy retry on the unescaped parsing content.
            copy_path.write_bytes(filtered)
            return read(copy_path)
    finally:
        if copy_path is not None:copy_path.unlink(missing_ok=True)
        if owned is not None:owned.cleanup()

# acadiso.lin 표준 선종류(cad-properties.js 와 같은 표). ezdxf 기본 도면에는 HIDDEN·BORDER 계열이 없어
# 예전에는 HIDDEN 레이어·객체를 DXF 로 저장하면 선종류가 조용히 실선으로 빠졌다.
STANDARD_LINETYPES={
 'HIDDEN':('Hidden __ __ __',[6.35,-3.175]),'HIDDEN2':('Hidden (.5x) _ _ _',[3.175,-1.5875]),'HIDDENX2':('Hidden (2x) ____ ____',[12.7,-6.35]),
 'DASHED':('Dashed __ __ __',[12.7,-6.35]),'DASHED2':('Dashed (.5x) _ _ _',[6.35,-3.175]),'DASHEDX2':('Dashed (2x) ____ ____',[25.4,-12.7]),
 'CENTER':('Center ____ _ ____',[31.75,-6.35,6.35,-6.35]),'CENTER2':('Center (.5x) ___ _ ___',[19.05,-3.175,3.175,-3.175]),'CENTERX2':('Center (2x) ________ __',[63.5,-12.7,12.7,-12.7]),
 'PHANTOM':('Phantom ____ _ _ ____',[31.75,-6.35,6.35,-6.35,6.35,-6.35]),'PHANTOM2':('Phantom (.5x) ___ _ _ ___',[15.875,-3.175,3.175,-3.175,3.175,-3.175]),'PHANTOMX2':('Phantom (2x) ____  _  _  ____',[63.5,-12.7,12.7,-12.7,12.7,-12.7]),
 'DOT':('Dot . . . .',[0,-6.35]),'DOT2':('Dot (.5x) ........',[0,-3.175]),'DOTX2':('Dot (2x) .  .  .',[0,-12.7]),
 'DASHDOT':('Dash dot __ . __ .',[12.7,-6.35,0,-6.35]),'DASHDOT2':('Dash dot (.5x) _._._',[6.35,-3.175,0,-3.175]),'DASHDOTX2':('Dash dot (2x) ____  .  ____',[25.4,-12.7,0,-12.7]),
 'DIVIDE':('Divide __ . . __',[12.7,-6.35,0,-6.35,0,-6.35]),'DIVIDE2':('Divide (.5x) _.._.._',[6.35,-3.175,0,-3.175,0,-3.175]),'DIVIDEX2':('Divide (2x) ____  . .  ____',[25.4,-12.7,0,-12.7,0,-12.7]),
 'BORDER':('Border __ __ . __ __ .',[12.7,-6.35,12.7,-6.35,0,-6.35]),'BORDER2':('Border (.5x) __.__.__.',[6.35,-3.175,6.35,-3.175,0,-3.175]),'BORDERX2':('Border (2x) ____  ____  .',[25.4,-12.7,25.4,-12.7,0,-12.7]),
}
def ensure_linetype(doc,name,warnings=None,allow_byblock=False):
    """DXF 에 선종류 정의가 있게 한다. 표준 이름이면 없을 때 채우고, 모르는 이름은 경고를 남기고 False(→ 레이어 따름).
    객체의 BYBLOCK 은 그대로 쓴다(블록 안 객체가 삽입 선종류를 따르는 규칙 — 레이어 따름으로 바꾸면 AutoCAD 에서 달라진다)."""
    name=str(name or '').strip()
    if allow_byblock and name.upper()=='BYBLOCK':return True
    if not name or name.upper() in ('BYLAYER','BYBLOCK'):return False
    if name in doc.linetypes:return True
    spec=STANDARD_LINETYPES.get(name.upper())
    if spec:
        description,pattern=spec
        doc.linetypes.add(name.upper(),pattern=[sum(abs(v) for v in pattern)]+list(pattern),description=description)
        return True
    if warnings is not None:
        message='DXF 선종류 정의 없음: '+name+' → 레이어 선종류로 저장'
        if message not in warnings:warnings.append(message)
    return False

def _canonical_numbers(value):
    """JS 를 거치면 1.0 이 1 로 돌아온다. 지문이 표기에 흔들리지 않도록 정수값 실수는 정수로 맞춘다."""
    if isinstance(value,float):return int(value) if value.is_integer() and abs(value)<1e15 else value
    if isinstance(value,list):return [_canonical_numbers(item) for item in value]
    if isinstance(value,dict):return {key:_canonical_numbers(item) for key,item in value.items() if key!='dimensionDisplayParts'}
    return value
def editable_fingerprint(entity):
    """Stable identity for deciding whether an imported entity was edited (JSON/JS 왕복 뒤에도 같다)."""
    clean={k:_canonical_numbers(v) for k,v in entity.items() if k not in ('sourceHandle','sourceHandles','sourceFingerprint','dimensionDisplayParts')}
    return hashlib.sha256(json.dumps(clean,ensure_ascii=True,sort_keys=True,separators=(',',':')).encode()).hexdigest()
class SplitLinesError(ValueError):
    """The engine's split-line file does not line up with its DXF; import again without it."""

SPLIT_HEADER='iiihhd'
SPLIT_RECORDS={'LINE':struct.Struct('<'+SPLIT_HEADER+'6d'),'CIRCLE':struct.Struct('<'+SPLIT_HEADER+'4d'),
               'ARC':struct.Struct('<'+SPLIT_HEADER+'6d'),'LWPOLYLINE':struct.Struct('<'+SPLIT_HEADER+'iidd'),
               'SPLINE':struct.Struct('<'+SPLIT_HEADER+'iiiiddd')}
SPLIT_KINDS=(None,'LINE','CIRCLE','ARC','LWPOLYLINE','SPLINE')
def read_split_lines(data):
    """converter/LineSplit.cs output: names, model-space handles in writer order, kinds,
    record iterators per kind, the polyline vertex pool (x, y pairs) and the spline
    value pool (control points x, y, z, then knots, per spline)."""
    view=memoryview(data)
    if bytes(view[:4])!=b'BLN3':raise SplitLinesError('split lines: header')
    total,names,lines,circles,arcs,polylines,vertices,splines,spline_values=struct.unpack_from('<9i',view,4);offset=40
    strings=[]
    for _ in range(names):
        (length,)=struct.unpack_from('<i',view,offset);offset+=4
        strings.append(bytes(view[offset:offset+length]).decode('utf-8'));offset+=length
    if offset+9*total>len(view):raise SplitLinesError('split lines: size')
    handles=array.array('Q');handles.frombytes(view[offset:offset+8*total]);offset+=8*total
    if sys.byteorder!='little':handles.byteswap()
    kinds=bytes(view[offset:offset+total]);offset+=total
    counts={'LINE':lines,'CIRCLE':circles,'ARC':arcs,'LWPOLYLINE':polylines,'SPLINE':splines}
    if len(handles)!=total or len(kinds)!=total or any(kinds.count(i)!=counts[k] for i,k in enumerate(SPLIT_KINDS) if k):
        raise SplitLinesError('split lines: counts')
    # Section order as LineSplit.cs writes it: line, circle, arc and polyline records,
    # the polyline vertices, spline records, spline values.
    records={}
    def section(size):
        nonlocal offset
        if offset+size>len(view):raise SplitLinesError('split lines: size')
        part=view[offset:offset+size];offset+=size;return part
    for kind in ('LINE','CIRCLE','ARC','LWPOLYLINE'):records[kind]=SPLIT_RECORDS[kind].iter_unpack(section(SPLIT_RECORDS[kind].size*counts[kind]))
    pool=array.array('d');pool.frombytes(section(16*vertices))
    records['SPLINE']=SPLIT_RECORDS['SPLINE'].iter_unpack(section(SPLIT_RECORDS['SPLINE'].size*splines))
    spline_pool=array.array('d');spline_pool.frombytes(section(8*spline_values))
    if offset!=len(view):raise SplitLinesError('split lines: size')
    if sys.byteorder!='little':pool.byteswap();spline_pool.byteswap()
    return strings,handles,kinds,records,pool,spline_pool

def simplify_polyline(points,tolerance):
    """Douglas-Peucker (distance to the chord SEGMENT, so a spike that doubles back is kept) on the XY of already flattened curve vertices.

    Endpoints are kept exactly (so a closed curve stays closed) and at least two points
    remain. `points` are Vec3 or (x, y) tuples; the result holds the surviving originals.
    """
    count=len(points)
    if count<3 or tolerance<=0:return list(points)
    xs=[float(p[0]) for p in points];ys=[float(p[1]) for p in points]
    keep=bytearray(count);keep[0]=keep[-1]=1
    limit=tolerance*tolerance
    stack=[(0,count-1)]
    while stack:
        a,b=stack.pop()
        if b-a<2:continue
        ax=xs[a];ay=ys[a];dx=xs[b]-ax;dy=ys[b]-ay;length2=dx*dx+dy*dy
        far=-1;best=limit
        if length2>1e-30:
            for i in range(a+1,b):
                ex=xs[i]-ax;ey=ys[i]-ay;along=ex*dx+ey*dy
                if along<=0:d2=ex*ex+ey*ey
                elif along>=length2:
                    fx=xs[i]-xs[b];fy=ys[i]-ys[b];d2=fx*fx+fy*fy
                else:
                    cross=ex*dy-ey*dx;d2=cross*cross/length2
                if d2>best:best=d2;far=i
        else:
            for i in range(a+1,b):
                ex=xs[i]-ax;ey=ys[i]-ay;d2=ex*ex+ey*ey
                if d2>best:best=d2;far=i
        if far>=0:
            keep[far]=1;stack.append((a,far));stack.append((far,b))
    return [p for p,k in zip(points,keep) if k]


def flatten_curve_path(curve_path,distance):
    """Flatten an ezdxf Path to the stated tolerance, then drop the points it does not need.

    ezdxf forces `segments` (default 4) subdivisions per Bezier piece and a B-spline is one
    piece per knot span, so a dense spline comes out far finer than `distance` asks (199,591
    points for 637 tiny splines). Fewer initial segments are not an option: a piece that
    overshoots and doubles back on itself passes the mid-point test with 1 or 2 segments and
    loses up to 0.7 mm. So the default sampling stays and a Douglas-Peucker pass at half the
    distance follows: the result is within distance/2 of that sampling.
    Raises ValueError past 20000 raw points.
    """
    raw=[]
    for v in curve_path.flattening(distance=distance):
        raw.append(v)
        if len(raw)>20000:raise ValueError('곡선 분할 한도 초과')
    return simplify_polyline(raw,distance/2)


def imported_document_version(shared_blocks):
    """Shared block references are a v3 document feature."""
    return 3 if shared_blocks else 2
def converters():
    from batch_converter import process
    return {'bundled':process({'action':'status'})['available']}


def autocad_console():
    """AutoLISP 실행용 accoreconsole 경로. 없으면 None.

    DWG 변환은 내장 ACadSharp 엔진을 쓰지만, 실제 AutoLISP 실행만은
    설치된 AutoCAD Core Console이 필요하다.
    """
    import os
    root=Path(os.environ.get('ProgramFiles','C:/Program Files'))/'Autodesk'
    found=sorted(root.glob('AutoCAD */accoreconsole.exe'),reverse=True)
    return str(found[0]) if found else None


def dwg_to_dxf(source,folder,split_lines=True):
    from batch_converter import process
    route=os.environ.get('BARUN_DWG_IMPORT_ROUTE','deferred').strip().lower()
    if route not in ('legacy','deferred'):raise ValueError('지원하지 않는 DWG 가져오기 경로입니다.')
    request={'action':'convert','name':'input.dwg','direction':'dwg-dxf',
             'folder':str(folder),'version':'2018','_source_path':str(source)}
    if route=='deferred':request['_defer_dxf_validation']=True
    # 큰 도면의 단순 선은 DXF 를 거치지 않고 엔진이 쓴 이진 파일에서 바로 만든다(read_split_lines).
    if split_lines and route=='deferred' and os.environ.get('BARUN_DWG_SPLIT_LINES','1')!='0':
        request['_split_lines']=True;request['_split_min']=int(os.environ.get('BARUN_DWG_SPLIT_MIN','20000') or 20000)
    # 보조 엔진으로 넘어가면 변환기가 결과를 검증하며 한 번 읽는다. 같은 방식(한글 보존)으로 읽게 하고 그 도면을 이어 쓴다.
    request['_keep_document']=True;request['_reader']=lambda path:read_dxf_preserving_unicode(Path(path),folder)
    request['_preservation_limit']=PRESERVATION_LIMIT
    request['_dyn_blocks']=True   # AutoCAD 동적 블록 정의·참조 값(converter/DynBlocks.cs)
    started=time.perf_counter();result=process(request)
    if result.get('failed'):raise ValueError(result['message'])
    timings=dict(result.get('timings_ms') or {})
    timings['converter_total']=round((time.perf_counter()-started)*1000,3)
    details={'engine':result.get('engine'),'engineVersion':result.get('engine_version'),'primaryEngineVersion':result.get('primary_engine_version'),
             'route':str(result.get('route') or 'acadsharp')+'-dwg-dxf-'+route,'deferredValidation':bool(result.get('deferred_validation')),
             'timings_ms':timings,'warningCount':result.get('warningCount',0)}
    if result.get('_document') is not None:details['_document']=result['_document']   # _import_source 가 꺼내 쓴다(보고서에는 넣지 않는다)
    if result.get('_split_lines') is not None:details['_split_lines']=result['_split_lines']
    if result.get('_dyn_blocks') is not None:details['_dyn_blocks']=result['_dyn_blocks']
    if result.get('decomposedTypes'):details['decomposedTypes']=result['decomposedTypes']
    if result.get('unresolvedDecompositions'):details['unresolvedDecompositions']=result['unresolvedDecompositions']
    return Path(result['path']),'내장 DWG 엔진',result['warnings'],details


def geometry_fingerprint(doc,include_plot=True,decoded_order=True):
    chunks=[]
    def tags(e):
        collector=TagCollector(dxfversion=doc.dxfversion);e.export_dxf(collector)
        return [(t.code,dxf_unicode(t.value)) for t in collector.tags if t.code not in (5,105,330,360) and t.code<1000]
    chunks.append([(e.dxftype(),tags(e)) for e in doc.modelspace()])
    # 정렬은 풀어 쓴 이름으로: 한글 블록 이름은 읽을 때 \U+XXXX 로 바뀌어 정렬 순서가 달라지고,
    # 지문이 어긋나 바른 CAD 기록(3D 속성·매개변수 벽 등) 전체를 버렸다(2026-10-21).
    for block in sorted(doc.blocks,key=(lambda b:dxf_unicode(b.name)) if decoded_order else (lambda b:b.name)):
        if not block.name.startswith('*Model_Space') and not block.name.startswith('*Paper_Space'):
            chunks.append((dxf_unicode(block.name),[tags(e) for e in block]))
    chunks.append([(dxf_unicode(l.dxf.name),l.dxf.color,l.dxf.get('true_color'),l.dxf.flags,l.dxf.linetype,l.dxf.lineweight) for l in doc.layers])
    chunks.append(doc.header.get('$INSUNITS',0))
    if include_plot:chunks.append([(dxf_unicode(l.dxf.name),l.dxf.get('plot',1)) for l in doc.layers])
    return hashlib.sha256(json.dumps(chunks,ensure_ascii=True,separators=(',',':')).encode()).hexdigest()

NATIVE_EXTENSION_RECORD='BARUN_CAD_EXTENSIONS_V1'
NATIVE_EXTENSION_LIMIT=64_000_000
NATIVE_FULL_LIMIT=19_000_000


def _native_extension_filter(model):
    """Only parametric objects need a second representation in large DXFs."""
    sets=model.get('drawingSets') or {}
    owned={identifier for record in sets.values() if isinstance(record,dict) for identifier in (record.get('baseline') or {})}
    shared=model.get('sharedBlocks') or {};memo={};visiting=set()
    def parametric(entity):
        if entity.get('reviewObjectId') or entity.get('reviewInput') or entity.get('type')=='wall' or entity.get('drawingSet') or entity.get('id') in owned or entity.get('hostWall') or entity.get('openingLinks'):return True
        if entity.get('type')!='block' and not entity.get('entities'):return False
        key=id(entity)
        if key in memo:return memo[key]
        if key in visiting:return False
        visiting.add(key)
        result=any(parametric(child) for child in entity.get('entities',[]))
        definition=shared.get(entity.get('sharedBlock'))
        if not result and definition is not None:result=parametric(definition)
        visiting.remove(key);memo[key]=result
        return result
    return parametric


def _native_extension_fingerprint(entity,cache=None,visiting=None):
    """Hash only an owned object and its referenced blocks, never the whole drawing."""
    cache={} if cache is None else cache;visiting=set() if visiting is None else visiting
    def canonical(value):
        if isinstance(value,(int,float)):return float(value)
        if isinstance(value,(tuple,list)):return [canonical(v) for v in value]
        return dxf_unicode(value) if isinstance(value,str) else value
    collector=TagCollector(dxfversion=entity.doc.dxfversion,optional=False);entity.export_dxf(collector)
    values=[(tag.code,canonical(tag.value)) for tag in collector.tags if tag.code not in (5,105,330,360) and tag.code<1000]
    name=entity.dxf.name if entity.dxftype()=='INSERT' else entity.dxf.get('geometry') if entity.dxftype()=='DIMENSION' else None
    if entity.dxftype()=='INSERT' and entity.attribs:values.append(('attributes',[_native_extension_fingerprint(child,cache,visiting) for child in entity.attribs]))
    if name:
        if name in visiting:raise ValueError('순환 블록 확장 정보')
        if name not in cache:
            visiting.add(name);block=entity.doc.blocks.get(name)
            block_values=[canonical(tuple(block.block.dxf.base_point)),[_native_extension_fingerprint(child,cache,visiting) for child in block]]
            cache[name]=hashlib.sha256(json.dumps(block_values,ensure_ascii=True,separators=(',',':')).encode()).hexdigest()
            visiting.remove(name)
        values.append(('block',cache[name]))
    return hashlib.sha256(json.dumps(values,ensure_ascii=True,separators=(',',':')).encode()).hexdigest()


def _write_native_extensions(doc,model,entities,handles,layer_map):
    if not entities and not model.get('drawingSets') and not any(k in model for k in ('reviewObjectSeq','reviewHistory','reviewInput')):return
    cache={};records=[]
    for entity in entities:
        handle=handles.get(entity['id']);written=doc.entitydb.get(handle) if handle else None
        if written is None:raise ValueError('벽·도면 묶음의 DXF 확장 정보를 저장하지 못했습니다: '+entity['id'])
        records.append({'handle':handle,'fingerprint':_native_extension_fingerprint(written,cache),'entity':_strip_dimension_display_cache(entity)})
    shared={}
    def collect(entity):
        name=entity.get('sharedBlock')
        if name and name not in shared and name in model.get('sharedBlocks',{}):
            shared[name]=model['sharedBlocks'][name];collect(shared[name])
        for child in entity.get('entities',[]):collect(child)
    for entity in entities:collect(entity)
    payload={'entities':records,'drawingSets':model.get('drawingSets',{}),'layers':layer_map,'sharedBlocks':shared,'units':doc.header.get('$INSUNITS',0)}
    payload.update({k:model[k] for k in ('reviewObjectSeq','reviewHistory','reviewInput') if k in model})
    raw=json.dumps(payload,ensure_ascii=False,separators=(',',':')).encode()
    if len(raw)>NATIVE_EXTENSION_LIMIT:raise ValueError('벽·도면 묶음 확장 정보가 너무 큽니다. BCAD로 저장하세요.')
    packed=base64.b64encode(zlib.compress(raw)).decode('ascii')
    record=doc.rootdict.add_xrecord(NATIVE_EXTENSION_RECORD);record.reset([(1,packed[i:i+240]) for i in range(0,len(packed),240)])


def _read_native_extensions(doc):
    if NATIVE_EXTENSION_RECORD not in doc.rootdict:return None
    try:
        record=doc.rootdict[NATIVE_EXTENSION_RECORD];packed=''.join(str(tag.value) for tag in record.tags if tag.code==1)
        inflater=zlib.decompressobj();raw=inflater.decompress(base64.b64decode(packed),NATIVE_EXTENSION_LIMIT+1)
        if len(raw)>NATIVE_EXTENSION_LIMIT or inflater.unconsumed_tail or not inflater.eof:return None
        payload=json.loads(raw)
        if not isinstance(payload,dict) or not isinstance(payload.get('layers'),dict):return None
        if any(not isinstance(identifier,str) or not isinstance(name,str) for identifier,name in payload['layers'].items()):return None
        return payload
    except (KeyError,ValueError,TypeError,zlib.error,AttributeError,RecursionError):return None


def _restore_native_extensions(doc,document,info,payload):
    if NATIVE_EXTENSION_RECORD not in doc.rootdict:return
    try:
        if payload is None or payload.get('units')!=doc.header.get('$INSUNITS',0):raise ValueError('확장 정보 형식·단위')
        records=payload['entities'];cache={};by_handle={e.get('sourceHandle'):i for i,e in enumerate(document['entities'])}
        if not isinstance(records,list) or not isinstance(payload.get('drawingSets'),dict) or not isinstance(payload.get('sharedBlocks',{}),dict):raise ValueError('확장 정보 형식')
        layer_ids={layer['id'] for layer in document['layers']}
        if any(not isinstance(saved,dict) or not isinstance(saved.get('entity'),dict) or saved['entity'].get('layer') not in layer_ids for saved in records):raise ValueError('확장 객체 형식')
        # An externally edited owned object invalidates the set; never resurrect stale geometry.
        for saved in records:
            handle=saved['handle'];source=doc.entitydb.get(handle)
            if handle not in by_handle or source is None or saved['fingerprint']!=_native_extension_fingerprint(source,cache):raise ValueError('외부에서 벽·도면 묶음 객체가 바뀌었습니다')
        for saved in records:
            # Keep IDs, layer IDs and field order: drawingSets baseline hashes use these exact objects.
            document['entities'][by_handle[saved['handle']]]=saved['entity']
        document['drawingSets']=payload['drawingSets']
        document.update({k:payload[k] for k in ('reviewObjectSeq','reviewHistory','reviewInput') if k in payload})
        if payload.get('sharedBlocks'):document.setdefault('sharedBlocks',{}).update(payload['sharedBlocks']);document['version']=3
        info['nativeExtensions']=True
    except (KeyError,ValueError,TypeError,zlib.error,AttributeError,RecursionError):
        info['warnings'].append('벽·도면 묶음 확장 정보가 외부 수정되었거나 손상되어 DXF의 현재 도형으로 열었습니다.')


def read_native_metadata(doc):
    try:
        record=doc.rootdict['BARUN_CAD_V2'];data=''.join(str(t.value) for t in record.tags if t.code==1)
        raw=zlib.decompressobj().decompress(base64.b64decode(data),20_000_001)
        if len(raw)>20_000_000:return None
        payload=json.loads(raw)
        plot=payload.get('fingerprintVersion',1)>=2
        # 옛 판이 쓴 파일(블록 이름 그대로 정렬)도 그대로 연다
        if payload['fingerprint']==geometry_fingerprint(doc,include_plot=plot):return payload['document']
        if any(b.name!=dxf_unicode(b.name) for b in doc.blocks) and payload['fingerprint']==geometry_fingerprint(doc,include_plot=plot,decoded_order=False):return payload['document']
    except (KeyError,ValueError,TypeError,zlib.error,AttributeError):pass
    return None

def import_file(data,extension,include_handles=False):
    if len(data)>250_000_000:raise ValueError('파일은 250 MB 이하로 열어 주세요.')
    ext=extension.lower()
    if ext not in ('.dxf','.dwg'):raise ValueError('DXF 또는 DWG 파일을 선택하세요. BCAD는 백업 파일 열기를 사용합니다.')
    with tempfile.TemporaryDirectory(prefix='barun_exchange_') as tmp:
        folder=Path(tmp);source=folder/('input'+ext);source.write_bytes(data)
        return _import_with_split_fallback(source,ext,folder,include_handles)


def _acis_chain(first,next_attr):
    """Bound linked ACIS traversal, including malformed/cyclic source data."""
    seen=set();current=first
    while not current.is_none:
        if id(current) in seen or len(seen)>=MAX_ENTITIES:raise ValueError('ACIS 연결 오류')
        seen.add(id(current));yield current;current=getattr(current,next_attr)


def region_boundary_loops(bodies):
    """Extract complete planar straight-edge ACIS rings, including inner holes.

    Unsupported curves are rejected, never replaced by endpoint chords.
    Called only for REGION during import; no drawing/edit/render work is added.
    """
    loops=[]
    for body in bodies:
        matrix=None if body.transform.is_none else body.transform.matrix
        for lump in _acis_chain(body.lump,'next_lump'):
            for shell in _acis_chain(lump.shell,'next_shell'):
                for face in _acis_chain(shell.face,'next_face'):
                    if face.surface.type!='plane-surface':raise ValueError('비평면 REGION')
                    for loop in _acis_chain(face.loop,'next_loop'):
                        first=loop.coedge;current=first;seen=set();pairs=[]
                        while not current.is_none and id(current) not in seen:
                            if len(seen)>=MAX_ENTITIES:raise ValueError('REGION 경계 한도')
                            seen.add(id(current));edge=current.edge
                            if edge.curve.type!='straight-curve':raise ValueError('미지원 REGION 곡선')
                            a=edge.start_vertex.point.location;b=edge.end_vertex.point.location
                            if current.sense:a,b=b,a
                            if matrix is not None:a,b=matrix.transform(a),matrix.transform(b)
                            if not all(math.isfinite(v) for p in (a,b) for v in p):raise ValueError('REGION 좌표 오류')
                            pairs.append((a,b));current=current.next_coedge
                        if current is not first or len(pairs)<3:raise ValueError('열린 REGION 경계')
                        if any(not b.isclose(pairs[(i+1)%len(pairs)][0],rel_tol=0,abs_tol=1e-7) for i,(_,b) in enumerate(pairs)):
                            raise ValueError('끊어진 REGION 경계')
                        loops.append([a for a,_ in pairs])
    if not loops:raise ValueError('REGION 경계 없음')
    return loops


def prepare_acis_regions(records):
    """Inspect only REGION payloads before choosing which large DXF to read."""
    from ezdxf.acis.api import load
    ready=[];unresolved=Counter()
    for record in records:
        try:
            raw=base64.b64decode(record['data'],validate=True)
            bodies=load(raw if record['binary'] else raw.decode('utf-8-sig').splitlines())
            ready.append((record,region_boundary_loops(bodies)))
        except Exception:unresolved[record.get('ownerBlock','*Model_Space')]+=1
    return ready,unresolved


def restore_acis_regions(doc,records,prepared=None):
    """Restore only drawable REGIONs omitted by ACadSharp's DXF writer.

    The source DXF lacks these handles: derived outlines must be emitted on save.
    Cache the rings so count verification and normalization parse ACIS just once.
    """
    ready,unresolved=prepared if prepared is not None else prepare_acis_regions(records)
    unresolved=unresolved.copy();restored=Counter();derived=[]
    for record,loops in ready:
        try:
            owner=record['ownerBlock'];layout=doc.blocks.get(owner)
            attrs={'handle':record['handle'],'layer':record['layer'],'color':record['color'],'lineweight':record['lineweight'],'linetype':record['linetype']}
            if record.get('trueColor') is not None:attrs['true_color']=record['trueColor']
            if record['handle'] in doc.entitydb:raise ValueError('REGION 핸들 충돌')
            region=layout.add_region(dxfattribs=attrs)
            region._barun_region_loops=loops
            region._barun_generated_region=True
            if owner.casefold()=='*model_space':restored['REGION']+=1
            else:derived.append({'block':owner,'attributes':{k:v for k,v in attrs.items() if k!='handle'},
                'loops':[[[v.x,v.y] for v in loop] for loop in loops]})
        except Exception:
            # The existing per-type comparison chooses acadrust or names the loss.
            unresolved[record.get('ownerBlock','*Model_Space')]+=1
            continue
    doc._barun_unrestored_regions=unresolved
    doc._barun_derived_block_regions=derived
    return restored


def table_insert(table):
    """Use TABLE's display primitives with a full INSERT transform.

    ezdxf's TABLE virtual entities currently only translate, losing rotation/scale.
    A legacy table without a display block can supply a simple cell grid instead.
    """
    from ezdxf.entities import factory
    from ezdxf.entities.acad_table import read_acad_table_content
    from ezdxf.math import Vec3, OCS
    doc=table.doc;tags=table.xtags.get_subclass('AcDbBlockReference')
    normal=Vec3(tags.get_first_value(210,(0,0,1)))
    direction=Vec3(table.dxf.get('horizontal_direction',(1,0,0)))
    ocs=OCS(normal);axis=ocs.from_wcs(direction)
    if axis.magnitude<1e-12:raise ValueError('TABLE 방향 없음')
    block=doc.blocks.new_anonymous_block('T')
    def copy_primitives(parts,depth=0):
        if depth>12:raise ValueError('TABLE 블록 깊이')
        for part in parts:
            kind=part.dxftype()
            if kind in ('LINE','TEXT','MTEXT'):block.add_entity(part.copy())
            elif kind in ('INSERT','LWPOLYLINE','POLYLINE'):
                copy_primitives(part.virtual_entities(),depth+1)
    name=table.get_block_name()
    if name and name in doc.blocks:
        source_block=doc.blocks.get(name);block.block.dxf.base_point=source_block.block.dxf.base_point
        copy_primitives(source_block)
    if not len(block):
        block.block.dxf.base_point=(0,0,0)
        data=table.xtags.get_subclass('AcDbTable')
        rows=int(data.get_first_value(91,0));cols=int(data.get_first_value(92,0))
        heights=[float(t.value) for t in data if t.code==141];widths=[float(t.value) for t in data if t.code==142]
        # Merged/block cells need their real display geometry; never guess it.
        if any(t.code==173 and t.value or t.code==171 and t.value!=1 for t in data):raise ValueError('TABLE 표시 블록 필요')
        if not rows or not cols or rows*cols>MAX_ENTITIES or len(heights)!=rows or len(widths)!=cols or not all(math.isfinite(v) and v>0 for v in heights+widths):
            raise ValueError('TABLE 셀 크기 없음')
        xs=[0];ys=[0]
        for v in widths:xs.append(xs[-1]+v)
        for v in heights:ys.append(ys[-1]-v)
        for x in xs:block.add_line((x,0),(x,ys[-1]))
        for y in ys:block.add_line((0,y),(xs[-1],y))
        values=read_acad_table_content(table)
        for r in range(rows):
            for c in range(cols):
                text=values[r][c] if r<len(values) and c<len(values[r]) else ''
                if text:block.add_mtext(text,dxfattribs={'insert':((xs[c]+xs[c+1])/2,(ys[r]+ys[r+1])/2),
                    'char_height':min(heights[r]*.35,widths[c]*.15),'width':widths[c]*.9,'attachment_point':5})
    attrs=table.graphic_properties()
    attrs.update(name=block.name,insert=ocs.from_wcs(table.get_insert_location()),extrusion=normal,
        rotation=math.degrees(math.atan2(axis.y,axis.x)),xscale=float(tags.get_first_value(41,1)),
        yscale=float(tags.get_first_value(42,1)),zscale=float(tags.get_first_value(43,1)))
    return factory.new('INSERT',dxfattribs=attrs,doc=doc)

def import_file_path(path,extension,include_handles=False,recover=False):
    """Import a desktop drawing without copying the whole source through the renderer.
    ACAD200-809 recover=True: 구조를 살리는 읽기(ezdxf recover)로 열고 살린 것·고친 것을 보고서 recovery 에 적는다."""
    source=Path(path).resolve();ext=extension.lower()
    if ext not in ('.dxf','.dwg') or source.suffix.lower()!=ext:raise ValueError('DXF 또는 DWG 파일을 선택하세요.')
    if not source.is_file():raise ValueError('도면 파일을 찾을 수 없습니다.')
    size=source.stat().st_size
    if size<=0 or size>1_000_000_000:raise ValueError('파일은 1 GB 이하로 열어 주세요.')
    with tempfile.TemporaryDirectory(prefix='barun_exchange_') as tmp:
        if recover:return _import_recovered(source,ext,Path(tmp),include_handles)
        return _import_with_split_fallback(source,ext,Path(tmp),include_handles)

def _import_recovered(source,ext,folder,include_handles):
    """DWGRECOVER: 보통 읽기 대신 처음부터 복구 읽기. 선 분리 빠른 길은 쓰지 않는다(검증이 엄격한 길이라)."""
    result=_import_source(source,ext,folder,include_handles,split_lines=False,salvage=True)
    report=result['report'];recovery=report.setdefault('recovery',{})
    recovery.update({'mode':'salvage','engine':report.get('converter') or 'ezdxf recover','imported':report.get('imported',0),
                     'skipped':dict(report.get('skipped') or {})})
    return result

def _import_with_split_fallback(source,ext,folder,include_handles):
    try:return _import_source(source,ext,folder,include_handles)
    except SplitLinesError:
        # The engine's line file and its DXF did not line up (order, handles or
        # counts). Import the whole drawing through the DXF instead.
        result=_import_source(source,ext,folder,include_handles,split_lines=False)
        result['report'].setdefault('converterDetails',{})['splitLinesRetried']=True
        return result

# 225: DWG 형식은 AutoCAD 2027 도 2018(AC1032)이다. 바른 CAD 도 R2018 을 최신·기본 쓰기 형식으로 둔다.
# AutoCAD 의 DWGCHECK 는 "Autodesk 가 저장하지 않은 파일"인지만 알린다. 바른 CAD 는 누가 저장했는지 짐작할 수 있으면
# 이름을 대고, 원본 보존·미지원 객체 수와 저장 형식을 한 줄로 함께 알린다(가져오기 경고 목록에 싣는다).
DXF_RELEASES={'AC1009':'R12','AC1012':'R13','AC1014':'R14','AC1015':'R2000','AC1018':'R2004','AC1021':'R2007','AC1024':'R2010','AC1027':'R2013','AC1032':'R2018'}
_FOREIGN_PRODUCERS=(('BRICS','BricsCAD'),('ZWCAD','ZWCAD'),('ZWSOFT','ZWCAD'),('GSTAR','GstarCAD'),('DRAFTSIGHT','DraftSight'),('LIBRECAD','LibreCAD'),('QCAD','QCAD'),('SKETCHUP','SketchUp'),('REVIT','Revit'),('GRAPHISOFT','ARCHICAD'),('ARCHICAD','ARCHICAD'),('RHINO','Rhino'))
def saved_by_info(dxfversion,header=None,appids=(),markers=()):
    # 바른 CAD 가 쓴 DXF 는 ezdxf 로 저장되어 $LASTSAVEDBY 가 'ezdxf' 다 — ezdxf 는 다른 프로그램으로 보지 않는다.
    header=header or {}
    last=str(header.get('$LASTSAVEDBY','') or '').strip()
    names=[str(a or '').upper() for a in appids]
    producer=''
    for key,label in _FOREIGN_PRODUCERS:
        if any(key in name for name in names) or key in last.upper():producer=label;break
    if any('BARUN' in str(m).upper() for m in markers) or any(name.startswith('BARUN') for name in names):producer='바른 CAD'
    return {'format':str(dxfversion or ''),'release':DXF_RELEASES.get(str(dxfversion or ''),''),'maintenance':header.get('$ACADMAINTVER'),'lastSavedBy':last,'producer':producer}
def saved_by_notice(info,kept=0,skipped=0):
    producer=(info or {}).get('producer') or ''
    if not producer or producer=='바른 CAD':return None
    release=(info or {}).get('release') or (info or {}).get('format') or '알 수 없는 형식'
    return f'다른 프로그램({producer})에서 저장한 {release} 도면입니다 · 원본 보존 {kept:,}개 · 미지원 {skipped:,}개 · 저장은 DXF R2018(AutoCAD 2018~2027 공통 형식)로 합니다.'

_PAPER_TEXT_TYPES=('TEXT','MTEXT','DIMENSION','LEADER','MULTILEADER')
def paper_space_notice(doc):
    """배치 탭(종이 공간)에만 있는 글자를 알린다. 바른 CAD 는 모형 공간만 그려 이 글자가 화면에 안 보인다
    (10-25 글자 전수 검사: magnicad '석재+루바 건식시공 벽체' 는 글자 41·치수 40·지시선 24 가 모두 배치 탭에 있었다).
    모형 공간으로 복사해 오면 저장 때 보존된 배치와 겹쳐 AutoCAD 에서 글자가 두 번 나오므로 알리기만 한다."""
    rows=[]
    for layout in doc.layouts:
        if layout.name.lower()=='model':continue
        n=Counter(e.dxftype() for e in layout if e.dxftype() in _PAPER_TEXT_TYPES)
        if sum(n.values()):rows.append((layout.name,n))
    if not rows:return None
    model_text=any(e.dxftype() in ('TEXT','MTEXT') for e in doc.modelspace())
    parts=' · '.join(f"'{name}' 글자 {n['TEXT']+n['MTEXT']:,}개·치수 {n['DIMENSION']:,}개·지시선 {n['LEADER']+n['MULTILEADER']:,}개" for name,n in rows)
    lead='모형 공간에는 글자가 없고 ' if not model_text else ''
    return {'layouts':[{'name':name,'text':n['TEXT']+n['MTEXT'],'dimension':n['DIMENSION'],'leader':n['LEADER']+n['MULTILEADER']} for name,n in rows],'modelHasText':model_text,
            'message':f'{lead}배치 탭에만 있는 글자가 있습니다({parts}). 바른 CAD 는 모형 공간만 그려 이 글자는 화면에 보이지 않습니다 · 배치는 원본 그대로 보존되어 DXF·DWG 로 저장하면 남습니다.'}

def _dynamic_block_value(kind,value,factor):
    if kind=='linear' and isinstance(value,(int,float)) and not isinstance(value,bool):return value*factor
    if kind=='xy' and isinstance(value,dict) and all(isinstance(value.get(axis),(int,float)) and not isinstance(value[axis],bool) for axis in ('x','y')):
        return {axis:float(value[axis])*factor for axis in ('x','y')}
    return value

def _import_source(source,ext,folder,include_handles=False,split_lines=True,salvage=False):
        import_started=time.perf_counter();converter=None;converter_warnings=[];converter_details=None;timings={};split=None;dyn_blocks=None
        if ext=='.dwg':
            source,converter,converter_warnings,converter_details=dwg_to_dxf(source,folder,split_lines)
            preloaded=converter_details.pop('_document',None);split=converter_details.pop('_split_lines',None);dyn_blocks=converter_details.pop('_dyn_blocks',None)
            timings.update(converter_details['timings_ms'])
        else:preloaded=None
        audit=None
        dxf_read_started=time.perf_counter()
        if salvage:
            try:doc,audit=recover.readfile(source)
            except (ezdxf.DXFError,UnicodeError,OSError) as e:raise ValueError('도면 구조를 복구하지 못했습니다. '+str(e)[:160]) from e
        try:doc=doc if salvage else preloaded if preloaded is not None else read_dxf_preserving_unicode(source,folder)
        except (ezdxf.DXFError,UnicodeError,OSError):
            repaired=_repair_truncated_ascii_dxf(source)
            if repaired is not None:
                repaired_path=folder/'recovered-truncated.dxf';repaired_path.write_bytes(repaired)
                try:
                    doc=read_dxf_preserving_unicode(repaired_path,folder)
                    audit=type('Audit',(),{'errors':['truncated DXF terminator repaired'],'fixes':['appended missing ENDSEC/EOF']})()
                except (ezdxf.DXFError,UnicodeError,OSError):
                    doc=None
            else: doc=None
            if doc is None:
                try:doc,audit=recover.readfile(source)
                except (ezdxf.DXFError,UnicodeError,OSError) as e:raise ValueError('DXF 구조를 읽거나 복구할 수 없습니다. '+str(e)[:160]) from e
        timings['dxf_read']=round((time.perf_counter()-dxf_read_started)*1000,3)
        # A base64 copy of a very large DXF can add hundreds of MB to both the
        # Python result and Electron renderer. Keep it only while it is safe.
        preservation_read_started=time.perf_counter()
        original_bytes=source.read_bytes() if source.stat().st_size<=PRESERVATION_LIMIT else None
        timings['preservation_source_read']=round((time.perf_counter()-preservation_read_started)*1000,3)
        normalize_started=time.perf_counter()
        native=read_native_metadata(doc)
        extensions=_read_native_extensions(doc) if not native and not include_handles else None
        extension_layers={name:identifier for identifier,name in (extensions or {}).get('layers',{}).items()}
        unit_code=int(doc.header.get('$INSUNITS',0));factor=1.0
        if unit_code:
            try:factor={1:25.4,2:304.8,4:1,5:10,6:1000,7:1_000_000}.get(unit_code) or units.conversion_factor(unit_code,units.MM)
            except Exception:raise ValueError('지원하지 않는 DXF 단위입니다. 원본에서 mm로 변환해 주세요.')
        codepage=str(doc.header.get('$DWGCODEPAGE','') or '')
        style_fonts=sorted({str(s.dxf.get('font','')) for s in doc.styles if s.dxf.get('font','')})
        big_fonts=sorted({str(s.dxf.get('bigfont','')) for s in doc.styles if s.dxf.get('bigfont','')})
        info={'sourceFormat':ext[1:].upper(),'dxfVersion':doc.dxfversion,'sourceUnits':unit_code,'unitScaleToMM':factor,'unitless':unit_code==0,'converter':converter,'converterDetails':converter_details,'skipped':{},'converted':{},'warnings':list(converter_warnings),'layoutsPreserved':max(0,len(doc.layouts)-1),'encoding':{'codepage':codepage,'fonts':style_fonts,'bigFonts':big_fonts}}
        if audit is not None:info['warnings'].append(f'손상 DXF 복구 읽기 적용 · 감사 오류 {len(audit.errors)}건 · 수정 {len(audit.fixes)}건')
        paper=None if native else paper_space_notice(doc)
        if paper:info['warnings'].append(paper['message']);info['paperSpaceText']={k:v for k,v in paper.items() if k!='message'}
        if salvage:info['recovery']={'auditErrors':len(audit.errors) if audit is not None else 0,'auditFixes':len(audit.fixes) if audit is not None else 0}
        if native and not include_handles:
            safety = _layer_migration_safety(doc)
            if safety:native['legacyLayerSafety']=safety
            timings['normalize']=round((time.perf_counter()-normalize_started)*1000,3);timings['import_total']=round((time.perf_counter()-import_started)*1000,3)
            info['timings_ms']=timings;info['nativeMetadata']=True;info['imported']=len(native['entities']);return {'document':native,'report':info}
        # 2026-10-30 원본 보존 압축(주통 166 MB 1.4초)을 객체 변환과 함께 돌린다: zlib 은 압축하는 동안 GIL 을 놓는다.
        packing=None
        if original_bytes is not None and factor==1:
            from concurrent.futures import ThreadPoolExecutor
            packer=ThreadPoolExecutor(1,thread_name_prefix='barun-preserve');packing=packer.submit(zlib.compress,original_bytes,6);packer.shutdown(wait=False)
        skipped=Counter();unpreserved=Counter();converted=Counter();decomposed=Counter((converter_details or {}).get('decomposedTypes') or {});layers=[];mapping={};counter=0;import_prefix=uuid.uuid4().hex[:12]
        # Both DXF and converted DWG use shared definitions. Repeated furniture
        # or symbols are normalized/transferred once, then resolved on demand.
        shared_blocks={};building_blocks=set()
        dyn_defs=(dyn_blocks or {}).get('defs') or {};dyn_inserts=(dyn_blocks or {}).get('inserts') or {};dynamic_value_kinds={}
        def dynamic_definition(d):
            # 길이와 점만 도면 단위에서 mm 로 바꾼다. 상태 번호와 각도는 그대로 둔다.
            def scaled(p):
                p=dict(p);kind=p.get('kind')
                for key in ('p1','p2','point','center'):
                    if isinstance(p.get(key),dict):p[key]=point((p[key]['x'],p[key]['y']))
                if 'value' in p:p['value']=_dynamic_block_value(kind,p['value'],factor)
                for key in (('valueSet',) if kind=='linear' else ('valueSetX','valueSetY') if kind=='xy' else ()):
                    vs=p.get(key)
                    if isinstance(vs,dict):
                        p[key]={k:_dynamic_block_value('linear',v,factor) if k in ('min','max','increment') else v for k,v in vs.items()}
                        if 'list' in vs:p[key]['list']=[_dynamic_block_value('linear',v,factor) for v in vs.get('list') or []]
                return p
            actions=[]
            for action in d.get('actions') or []:
                action=dict(action)
                if action.get('frame'):action['frame']=[point((q['x'],q['y'])) for q in action['frame']]
                for key in ('center','p1','p2'):
                    if isinstance(action.get(key),dict):action[key]=point((action[key]['x'],action[key]['y']))
                actions.append(action)
            return {'parameters':[scaled(p) for p in d.get('parameters') or []],'actions':actions,**({'unsupported':d['unsupported']} if d.get('unsupported') else {})}
        def attach_dynamic(e,result):
            info=dyn_inserts.get(str(e.dxf.get('handle','')).upper())
            source=info and info.get('source')
            if not source or source not in dyn_defs or doc.blocks.get(source) is None:return
            definition=shared_blocks[shared_definition(source)]
            if 'dynamic' not in definition:
                # Dynamic blocks carry attribute definitions in the sidecar;
                # keep them out of the regular definition to avoid drawing
                # the ATTDEF once in addition to the attached ATTRIB.
                definition['entities']=[child for child in definition.get('entities',[]) if not child.get('attdef')]
                definition['dynamic']=dynamic_definition(dyn_defs[source])
                # Tags/handles connect attached ATTRIBs to actions without drawing ATTDEF twice.
                attributes=[{'tag':dxf_unicode(a.dxf.tag),'sourceHandle':a.dxf.handle} for a in doc.blocks.get(source).attdefs()]
                if attributes:definition['dynamic']['attributeDefinitions']=attributes
            if source not in dynamic_value_kinds:
                params=dyn_defs[source].get('parameters') or [];kinds={}
                for p in params:
                    for alias in ('name','label'):
                        if p.get(alias) is not None:
                            key=str(p[alias]);kind=p.get('kind')
                            kinds[key]=kind if key not in kinds or kinds[key]==kind else None
                # 명시한 ID가 이름보다 우선한다. 누락된 ID와 모호한 이름은 추측하지 않는다.
                kinds.update({str(p['id']):p.get('kind') for p in params if p.get('id') is not None})
                single=params[0].get('kind') if len(params)==1 else None
                dynamic_value_kinds[source]=(kinds,single,sum(p.get('kind')=='xy' for p in params)==1)
            kinds,single,has_xy=dynamic_value_kinds[source];stored=info.get('values') or {}
            known={kinds[str(k)] for k in stored if str(k) in kinds}
            if single in known:single=None
            if 'xy' in known:has_xy=False
            unknown=[v for k,v in stored.items() if str(k) not in kinds]
            numbers=sum(isinstance(v,(int,float)) and not isinstance(v,bool) for v in unknown)
            points=sum(isinstance(v,dict) and all(axis in v for axis in ('x','y')) for v in unknown)
            # 종류를 모르는 옛 캐시 값은 환산하지 않고 그대로 둔다(길이·각도·상태를 잘못 바꾸지 않게). 화면은 이런 키를 쓰지 않는다.
            # 다만 XY 매개변수가 하나뿐이고 값이 x·y 좌표면 그 XY 의 옛 키로 보고 환산한다.
            def unknown_value(v):
                if has_xy and points==1 and isinstance(v,dict) and all(isinstance(v.get(a),(int,float)) and not isinstance(v.get(a),bool) for a in ('x','y')):return _dynamic_block_value('xy',v,factor)
                return v
            values={k:(_dynamic_block_value(kinds[str(k)],v,factor) if str(k) in kinds else unknown_value(v)) for k,v in stored.items()}
            result['dynamic']={'source':source,'values':values}
            converted['동적 블록 참조 → 매개변수 유지']+=1
        missing_blocks={};reported_missing_blocks=set()
        for name,count in getattr(doc,'_barun_unrestored_regions',{}).items():
            missing_blocks.setdefault(name.casefold(),Counter())['REGION']+=count
        for missing in (converter_details or {}).get('unresolvedDecompositions',[]):
            missing_blocks.setdefault(missing['ownerBlock'].casefold(),Counter())[missing['type']]+=missing['count']
        def report_missing_block(name):
            key=name.casefold()
            if key in reported_missing_blocks:return
            reported_missing_blocks.add(key)
            for kind,count in missing_blocks.get(key,{}).items():
                skipped[kind+(' ACIS 경계 읽기 불가' if kind=='REGION' else ' 분해 불가')]+=count
                unpreserved[kind]+=count
        block_scale_bounds=block_reference_scale_bounds(doc)
        for layer in doc.layers:
            identifier=extension_layers.get(dxf_unicode(layer.dxf.name)) or uuid.uuid4().hex;mapping[layer.dxf.name]=identifier
            rgb=layer.rgb or colors.aci2rgb(max(1,min(255,abs(layer.dxf.color))))
            layers.append({'aci':abs(layer.dxf.color),'colorMode':'truecolor' if layer.rgb else 'aci','id':identifier,'name':dxf_unicode(layer.dxf.name),'color':'#%02x%02x%02x'%tuple(rgb),'visible':not layer.is_off(),'frozen':layer.is_frozen(),'locked':layer.is_locked(),'plot':bool(layer.dxf.get('plot',1)) and layer.dxf.name.lower()!='defpoints','lineweight':max(0,layer.dxf.lineweight)/100 if layer.dxf.lineweight>=0 else .25,'linetype':dxf_unicode(layer.dxf.linetype)})
        if not layers:layers=[{'id':'default','name':'기본','color':'#79d4ff','visible':True,'locked':False}]
        default=layers[0]['id']
        def point(p):return {'x':float(p[0])*factor,'y':float(p[1])*factor}
        def text_point_valid(p):
            # Check text anchors only: the fast binary geometry path needs no
            # extra pass or allocations. Coordinates are limited in mm, like
            # DrawingEngine.validate, before OCS/attachment arithmetic.
            return p is not None and all(math.isfinite(v*factor) and abs(v*factor)<=1e12 for v in p)
        def degenerate_dimension(e):
            # 길이 0 치수(원본 CAD 는 '0' 으로 그린다)를 기준점 치수로 옮기면 열기 검사가 도면 전체를 거부한다.
            # 이런 치수는 화면 모양 그대로(선·문자 묶음) 가져온다.
            kind=e.dxf.dimtype & 7
            if kind in (0,1):a,b=e.dxf.defpoint2,e.dxf.defpoint3
            elif kind in (3,4):a,b=e.dxf.defpoint,e.dxf.defpoint4
            else:return False
            return math.hypot((a[0]-b[0])*factor,(a[1]-b[1])*factor)<1e-8
        def shared_definition(name):
            # 조회(doc.blocks·block_scale_bounds)는 읽은 그대로의 이름(R2007+ 한글은 \U+XXXX)으로, 문서 열쇠만 한글로 푼다.
            key=dxf_unicode(name)
            if key in shared_blocks:return key
            if name in building_blocks:raise ValueError('순환 블록 정의')
            building_blocks.add(name)
            block=doc.blocks.get(name)
            outer_scale=block_scale_bounds.get(name.casefold(),math.inf)
            values=[child for raw in block if (child:=entity(raw,1,outer_scale))]
            shared_blocks[key]={'origin':point(block.block.dxf.base_point),'entities':values}
            building_blocks.remove(name)
            return key
        def entity(e,depth=0,outer_scale=1.0):
            nonlocal counter
            counter+=1
            if counter>MAX_ENTITIES:raise ValueError('가져오기 객체가 2,000,000개를 초과합니다. 대용량 도면 모드로 나눠 열어 주세요.')
            typ=e.dxftype()
            if missing_blocks and typ=='INSERT':report_missing_block(e.dxf.name)
            if depth>12:skipped['BLOCK_DEPTH']+=1;return None
            result={'id':import_prefix+format(counter,'x'),'layer':mapping.get(e.dxf.get('layer','0'),default)}
            # 420(true color)은 아래 24비트가 RGB. netDxf 등은 위 8비트에 투명도를 실어 음수로 쓴다 → '#-3e000000' 같은 깨진 색이 되던 것.
            if e.dxf.get('true_color') is not None:result.update(color='#%06x'%(e.dxf.true_color&0xffffff),colorMode='truecolor')
            elif 1<=e.dxf.get('color',256)<=255:result.update(color='#%02x%02x%02x'%tuple(colors.aci2rgb(e.dxf.color)),aci=e.dxf.color,colorMode='aci')
            elif e.dxf.get('color',256)==0:result['colorMode']='byblock'
            lt=e.dxf.get('linetype','BYLAYER')
            # 엔진은 ByLayer·ByBlock 을 섞인 대소문자로 적는다. ByLayer 는 적지 않고(없으면 레이어 따름),
            # ByBlock 은 편집기 표기(BYBLOCK)로 둔다. 예전에는 'ByLayer'가 선종류 이름으로 남아 점선 레이어가 실선으로 그려졌다.
            if lt.upper()=='BYBLOCK':result['linetype']='BYBLOCK'
            elif lt.upper()!='BYLAYER':result['linetype']=dxf_unicode(lt)   # 한글 선종류 이름(\U+XXXX)도 풀어 둬야 저장 때 같은 이름을 찾는다
            entity_ltscale=float(e.dxf.get('ltscale',1.0) or 1.0)
            if abs(entity_ltscale-1.0)>1e-9:result['linetypeScale']=entity_ltscale
            if e.dxf.get('lineweight',-1)>=0:result['lineweight']=e.dxf.lineweight/100
            elif e.dxf.get('lineweight',-1)==-2:result['lineweightMode']='byblock'
            extrusion=e.dxf.get('extrusion',(0,0,1)) if e.dxf.is_supported('extrusion') else (0,0,1)
            planar=abs(extrusion[0])<=1e-9 and abs(extrusion[1])<=1e-9 and extrusion[2]>0
            tilt=math.hypot(extrusion[0],extrusion[1])
            if typ in ('LINE','POINT') and not planar:
                # LINE and POINT coordinates are WCS; the extrusion only orients a
                # thickness, which is not imported. 78k lines with (0,0,-1) or tilted
                # extrusions in 27 of 64 real drawings used to be dropped as non-planar.
                converted[typ+' 법선 무관 WCS 좌표 → XY 평면']+=1;extrusion=(0,0,1)
            elif not planar and tilt<=NEAR_AXIS_TILT and extrusion[2]>0:
                # Axis noise such as (0, 2e-6, 1): the OCS is the WCS to within
                # |elevation|·tilt, so read the OCS coordinates as XY.
                converted[typ+' 미세 기운 법선 → XY 평면']+=1;extrusion=(0,0,1)
            elif not planar and tilt<=NEAR_AXIS_TILT and extrusion[2]<0 and tilt>1e-10:
                # Nearly (0,0,-1): snap it so upright() below flips it like an exact one.
                e.dxf.extrusion=(0,0,-1);extrusion=(0,0,-1);converted[typ+' 미세 기운 반전 법선 → 반전 OCS']+=1
            mirrored_text=False
            if abs(extrusion[0])<1e-10 and abs(extrusion[1])<1e-10 and extrusion[2]<0 and typ in ('TEXT','ATTRIB'):
                # AutoCAD draws such text mirrored, which the editor cannot. Keep it
                # readable over the same extent: see the TEXT branch below.
                mirrored_text=True;extrusion=(0,0,1);converted[typ+' 반전 OCS → 읽기 방향 문자 · 위치 보존']+=1
            elif abs(extrusion[0])<1e-10 and abs(extrusion[1])<1e-10 and extrusion[2]<0:
                from ezdxf.upright import upright
                upright(e)
                extrusion=e.dxf.get('extrusion',(0,0,1))
                if tuple(extrusion)==(0,0,1):converted[typ+' 반전 OCS → WCS']+=1
            # 99행과 같은 허용오차를 써서 (1e-16,0,1) 같은 정규화 잡음을 평면으로 본다.
            projected=abs(extrusion[0])>1e-9 or abs(extrusion[1])>1e-9 or extrusion[2]<=0
            if projected and typ not in PROJECTED_TYPES:skipped[typ+' (비평면 OCS)']+=1;return None
            try:
                if projected and typ not in ('INSERT','TEXT','ATTRIB','MTEXT','DIMENSION','ARC_DIMENSION','LARGE_RADIAL_DIMENSION'):
                    # Drawn in a tilted or vertical plane (elevations, 3D details): show
                    # what a plan view shows, the geometry projected onto XY. An INSERT
                    # is expanded below; its children come here with their own planes.
                    if typ in ('CIRCLE','ARC','ELLIPSE'):
                        if typ!='ELLIPSE' and e.dxf.radius<=0:skipped['ZERO_RADIUS']+=1;return None
                        ps=[]
                        for v in e.flattening(.1/factor/outer_scale):
                            ps.append(point(v))
                            if len(ps)>20000:raise ValueError('곡선 분할 한도 초과')
                        closed=typ=='CIRCLE' or typ=='ELLIPSE' and abs(e.dxf.end_param-e.dxf.start_param-math.tau)<1e-9
                        if closed and len(ps)>2 and ps[0]==ps[-1]:ps.pop()
                        if len(ps)<2:skipped[typ+' 투영 없음']+=1;return None
                        result.update(type='polyline',points=ps,closed=closed,curveApprox=True)
                    elif typ=='LWPOLYLINE' and e.has_arc:
                        children=[child for v in e.virtual_entities() if (child:=entity(v,depth+1,outer_scale))]
                        if not children:return None
                        result.update(type='block',name='DXF 곡선 폴리선',entities=children)
                    elif typ=='LWPOLYLINE':
                        ocs=e.ocs();elevation=float(e.dxf.elevation)
                        ps=[point(ocs.to_wcs((x,y,elevation))) for x,y in e.get_points('xy')]
                        if len(ps)<2:skipped['SHORT_POLYLINE']+=1;return None
                        result.update(type='polyline',points=ps,closed=bool(e.closed))
                    else:   # SOLID, TRACE
                        ocs=e.ocs()
                        result.update(type='hatch',points=[point(ocs.to_wcs(e.dxf.get('vtx'+str(i)))) for i in [0,1,3,2]],solid=True,spacing=100,angle=0,solidFace=True)
                    converted[typ+' 3D 평면 → XY 투영']+=1
                elif typ=='POINT':
                    result.update(type='point',position=point(e.dxf.location))
                elif typ=='LINE':
                    if abs(e.dxf.start.z)>1e-8 or abs(e.dxf.end.z)>1e-8:converted['3D LINE → XY 평면']+=1
                    result.update(type='line',points=[point(e.dxf.start),point(e.dxf.end)])
                elif typ=='ELLIPSE':
                    result.update(type='ellipse',center=point(e.dxf.center),majorAxis=point(e.dxf.major_axis),ratio=e.dxf.ratio,startParam=e.dxf.start_param,endParam=e.dxf.end_param)
                elif typ=='SPLINE':
                    ps=[point(v) for v in flatten_curve_path(dxfpath.make_path(e),.1/factor/outer_scale)]
                    if len(ps)<2:skipped['SPLINE 경로 없음']+=1;return None
                    result.update(type='polyline',points=ps,closed=bool(e.closed),curveApprox=True);converted['SPLINE → 곡선 근사 폴리선 (분할 기준 0.1 mm)']+=1
                elif typ in ('CIRCLE','ARC'):
                    if e.dxf.radius<=0:skipped['ZERO_RADIUS']+=1;return None
                    if abs(e.dxf.center.z)>1e-8:converted[typ+' 높이 → XY 평면']+=1
                    result.update(type=typ.lower(),center=point(e.dxf.center),radius=e.dxf.radius*factor)
                    if typ=='ARC':result.update(startAngle=e.dxf.start_angle,endAngle=e.dxf.end_angle)
                elif typ=='LWPOLYLINE' or typ=='POLYLINE' and (e.is_2d_polyline or e.is_3d_polyline):
                    stable,straightened=stable_bulge_polyline(e,factor,outer_scale) if e.has_arc else (e,0)
                    if straightened:converted['미세 Bulge → 직선 (최대 편차 0.000001 mm)']+=straightened
                    kind,width=polyline_widths(stable) if not (typ=='POLYLINE' and e.is_3d_polyline) else ('none',0.0)
                    closed=bool(stable.closed if typ=='LWPOLYLINE' else stable.is_closed)
                    if kind=='uniform' and stable.has_arc:
                        ps=flatten_width_polyline(stable,max(.1/factor/outer_scale,width/50))
                        if ps is not None and len(ps)>=2:
                            result.update(type='polyline',points=[point(p) for p in ps],closed=closed,constantWidth=width*factor)
                            converted['곡선 폴리선 폭 → 실폭 폴리선(호 나눔)']+=1
                    elif kind=='varying':
                        pairs=polyline_width_pairs(stable)
                        used=pairs if closed else pairs[:-1]
                        tolerance=max(.1/factor/outer_scale,min(w for pair in used for w in pair if w>0)/20)
                        # TraceBuilder must see clamped widths without changing the source DXF.
                        stable=stable.copy()
                        if typ=='LWPOLYLINE':
                            stable.dxf.const_width=0
                            stable.set_points([(x,y,s,e,b) for (x,y,_,_,b),(s,e) in zip(stable.get_points('xyseb'),pairs)],format='xyseb')
                        else:
                            for vertex,(s,e_) in zip(stable.vertices,pairs):vertex.dxf.start_width=s;vertex.dxf.end_width=e_
                        faces=[];attrs=stable.graphic_properties();attrs.pop('extrusion',None)
                        for f in TraceBuilder.from_polyline(stable,segments=width_trace_segments(stable,tolerance)).faces():
                            vs=[(v[0],v[1],0) for v in f]
                            solid=Solid.new(dxfattribs={**attrs,'vtx0':vs[0],'vtx1':vs[1],'vtx3':vs[2],'vtx2':vs[3]})
                            if (child:=entity(solid,depth+1,outer_scale)):faces.append(child)
                        if faces:
                            result.update(type='block',name='DXF 폭 폴리선',entities=faces)
                            converted['가변 폭 폴리선 → 채운 면']+=1
                    # Thin polylines retain the original virtual-entity path. Width curves
                    # reach it only when flattening exceeds the point limit (or has no faces).
                    if 'type' not in result:
                        if stable.has_arc:
                            children=[child for v in stable.virtual_entities() if (child:=entity(v,depth+1,outer_scale))]
                            if not children:return None
                            result.update(type='block',name='DXF 곡선 폴리선',entities=children);converted['Bulge 폴리선 → 선/호 블록']+=1
                        else:
                            ps=[point(p) for p in stable.get_points('xy')] if typ=='LWPOLYLINE' else [point(v.dxf.location) for v in stable.vertices]
                            if len(ps)<2:skipped['SHORT_POLYLINE']+=1;return None
                            result.update(type='polyline',points=ps,closed=closed)
                            if kind=='uniform':result['constantWidth']=width*factor
                            if typ=='POLYLINE' and e.is_3d_polyline:converted['3D POLYLINE → XY 화면 표시 · 원본 보존']+=1
                    if typ=='LWPOLYLINE' and abs(e.dxf.elevation)>1e-8:converted['폴리선 높이 → XY 평면']+=1
                elif typ in ('TEXT','MTEXT','ATTRIB','ATTDEF'):
                    raw_code=dxf_unicode(e.text if typ=='MTEXT' else e.dxf.text)
                    text=dxf_unicode(e.plain_text()) if typ=='MTEXT' else percent_to_plain(raw_code)
                    pos=e.dxf.insert;alignment='left';justify=None;fit_start=fit_end=None
                    if typ in ('TEXT','ATTRIB','ATTDEF') and (e.dxf.get('halign',0) or e.dxf.get('valign',0)):
                        # DXF 규격상 코드 72/73 중 하나라도 0이 아니면 정렬점(코드 11)이 실제 위치다.
                        halign=int(e.dxf.get('halign',0) or 0);valign=int(e.dxf.get('valign',0) or 0)
                        pos=e.dxf.get('align_point',pos)
                        # 대체 글꼴에서도 정렬점을 그대로 기준으로 삼아 문자가 좌우로 밀리지 않게 한다.
                        alignment='center' if halign in (1,3,4,5) else 'right' if halign==2 else 'left'
                        # 504: 자리맞추기(72/73)와 맞춤점(11)을 그대로 기억해 다시 쓸 때 돌려준다(text-justify.js 와 같은 이름).
                        justify=TEXT_JUSTIFY_KEYS.get((halign,0 if halign>=3 else valign))
                        start=e.dxf.insert
                        if halign in (3,5) and text_point_valid(start) and text_point_valid(pos) and math.hypot(pos[0]-start[0],pos[1]-start[1])>1e-9:
                            # 맞춤(A)·채움(F): 문자는 두 끝점(10→11) 사이에 놓인다. 가운데를 기준으로 그린다.
                            fit_start,fit_end=start,pos;pos=((start[0]+pos[0])/2,(start[1]+pos[1])/2)
                        elif halign in (3,5):justify=None
                        converted['문자 정렬/폰트 → 위치·크기 보존 표시']+=1
                    if not text_point_valid(pos):
                        # Empty strings have no visible geometry. Some DWG readers
                        # supply garbage doubles for their unused insertion point.
                        if not text.strip():skipped[typ+' 빈 문자 비정상 좌표']+=1;return None
                        alternate=next((p for p in (e.dxf.insert,e.dxf.get('align_point') if typ!='MTEXT' else None) if text_point_valid(p)),None)
                        if not text_point_valid(alternate):skipped[typ+' 비정상 좌표']+=1;return None
                        pos=alternate;converted[typ+' 비정상 좌표 → 대체 기준점 복구']+=1
                    if typ=='MTEXT':
                        # MTEXT의 insert는 부착점 모서리라 BCAD 기준(첫 줄 베이스라인 왼쪽)으로 옮겨 준다.
                        anchor=int(e.dxf.get('attachment_point',1) or 1);ch=float(e.dxf.char_height or 0);rows=text.count('\n')+1
                        if anchor in (2,5,8):alignment='center'
                        elif anchor in (3,6,9):alignment='right'
                        dy=-ch if anchor<=3 else ((rows-1)*1.35*ch-ch)/2 if anchor<=6 else (rows-1)*1.35*ch
                        if not projected:rot=math.radians(e.get_rotation());pos=(pos[0]-dy*math.sin(rot),pos[1]+dy*math.cos(rot))
                    style=doc.styles.get(e.dxf.get('style','Standard'))
                    raw_height=(e.dxf.char_height if typ=='MTEXT' else e.dxf.height) or style.dxf.get('height',0) or 1
                    width_factor=float(e.dxf.get('width',1) if typ!='MTEXT' else style.dxf.get('width',1) or 1)
                    if typ=='MTEXT':
                        widths=mtext_character_widths(e.text,width_factor)
                        if len(widths)>1:converted['MTEXT 글자 폭 섞임 → 가장 많은 폭']+=1
                        elif widths and next(iter(widths))!=width_factor:converted['MTEXT 글자 폭 코드 → 글자 폭']+=1
                        if widths:width_factor=widths.most_common(1)[0][0]
                    rotation=e.get_rotation() if typ=='MTEXT' else e.dxf.get('rotation',0)
                    align_anchor=None
                    if justify and justify!='L' and not projected:
                        if fit_end is not None:
                            align_anchor=fit_start
                            # 우리 글꼴로 그려도 두 끝점 사이를 채우게 폭 비율을 맞춘다(높이는 AutoCAD 가 계산해 둔 값).
                            span=math.hypot(fit_end[0]-fit_start[0],fit_end[1]-fit_start[1])
                            width_factor=max(.01,min(100,span/(text_units(text)*float(raw_height))))
                        else:
                            align_anchor=pos
                            r=math.radians(float(rotation));up=(-math.sin(r),math.cos(r))
                            drop=TEXT_JUSTIFY_DROP[justify]*float(raw_height);off=-drop
                            start=e.dxf.insert
                            if drop and text_point_valid(start) and math.hypot(start[0]-pos[0],start[1]-pos[1])>1e-9:
                                # AutoCAD 는 시작점(10)을 실제 글꼴로 다시 계산해 둔다: 그 기준선 높이가 가장 정확하다.
                                # 다른 프로그램이 엉뚱한 값을 둔 경우(방향이 반대·높이의 1.5배 넘게 떨어짐)는 비율로 계산한다.
                                measured=(start[0]-pos[0])*up[0]+(start[1]-pos[1])*up[1]
                                if measured*off>0 and abs(measured)<=1.5*float(raw_height):off=measured
                            pos=(pos[0]+up[0]*off,pos[1]+up[1]*off)
                    if mirrored_text:
                        # OCS (0,0,-1) → WCS mirrors X. Mirrored text running from the point
                        # to the left reads, unmirrored, as right-aligned text ending there.
                        pos=(-pos[0],pos[1]);rotation=(-float(rotation))%360
                        alignment={'left':'right','right':'left'}.get(alignment,alignment)
                        if fit_end is not None:justify=align_anchor=None
                        elif align_anchor is not None:align_anchor=(-align_anchor[0],align_anchor[1]);justify=justify.translate(str.maketrans('LR','RL'))
                    elif projected:
                        # Text in a tilted plane (isometric riser diagrams): its plan view.
                        # Baseline and up directions projected onto XY give the rotation and
                        # the foreshortening; text seen nearly edge-on stays with the source.
                        from ezdxf.math import Vec3
                        ocs=e.ocs()
                        if typ=='MTEXT':
                            # MTEXT keeps its insert and direction in WCS; its first baseline is
                            # dy along the in-plane up vector (see the anchor shift above).
                            r=math.radians(float(e.dxf.get('rotation',0)))
                            along=Vec3(e.dxf.text_direction).normalize() if e.dxf.hasattr('text_direction') else ocs.to_wcs(Vec3(math.cos(r),math.sin(r),0))
                            up=Vec3(e.dxf.extrusion).normalize().cross(along).normalize()
                            at=Vec3(e.dxf.insert)+up*dy
                        else:
                            r=math.radians(float(rotation))
                            along=ocs.to_wcs(Vec3(math.cos(r),math.sin(r),0));up=ocs.to_wcs(Vec3(-math.sin(r),math.cos(r),0))
                            at=ocs.to_wcs(Vec3(pos))
                        length=math.hypot(along.x,along.y)
                        across=(along.x*up.y-along.y*up.x)/length if length>1e-12 else 0.0
                        if length<.2 or abs(across)<.2:skipped[typ+' (비평면 OCS)']+=1;return None
                        pos=(at.x,at.y)
                        rotation=math.degrees(math.atan2(along.y,along.x))%360
                        raw_height*=abs(across);width_factor*=length/abs(across)
                        if across<0:
                            # Seen from below it reads mirrored: keep it readable over the same extent.
                            rotation=(rotation+180)%360;alignment={'left':'right','right':'left'}.get(alignment,alignment)
                        converted[typ+' 3D 평면 → XY 투영']+=1
                    if not text_point_valid(pos):skipped[typ+(' 빈 문자 비정상 좌표' if not text.strip() else ' 비정상 좌표')]+=1;return None
                    result.update(type='text',position=point(pos),text=text,height=raw_height*factor,rotation=rotation,align=alignment,widthFactor=width_factor,textStyle=dxf_unicode(e.dxf.get('style','Standard')),sourceFont=dxf_unicode(style.dxf.get('font','')),sourceBigFont=dxf_unicode(style.dxf.get('bigfont','')))
                    if typ=='ATTDEF':
                        flags=int(e.dxf.get('flags',0) or 0)
                        result['attdef']={'tag':dxf_unicode(e.dxf.get('tag','')),'default':text,
                                          'constant':bool(flags&2),'invisible':bool(flags&1),
                                          'verify':bool(flags&4),'preset':bool(flags&8),
                                          'prompt':dxf_unicode(e.dxf.get('prompt',''))}
                    if align_anchor is not None and text_point_valid(align_anchor):
                        result.update(justify=justify,alignPoint=point(align_anchor))
                        if fit_end is not None:result['fitTo']=point(fit_end)
                    # 501·505: 서식·%% 코드가 있던 원문을 함께 둔다(없으면 안 둔다 — 메모리). 문자를 고치지 않으면 내보낼 때 원문 그대로 쓴다.
                    if raw_code!=(text.replace(chr(10),'\\P') if typ=='MTEXT' else text):result.update(codeKind='mtext' if typ=='MTEXT' else 'text',codeText=raw_code,codePlain=text)
                    if typ=='MTEXT' and result.get('codeKind')=='mtext':result['codeWidth']=width_factor
                    # 523: MTEXT 줄 간격(AutoCAD 1.0 = 높이의 5/3배)을 높이 배수로 기억해 다시 쓸 때 돌려준다.
                    if typ=='MTEXT' and abs(float(e.dxf.get('line_spacing_factor',1) or 1)-1)>1e-6:result['lineSpacing']=float(e.dxf.line_spacing_factor)*5/3
                    if typ=='MTEXT' and int(e.dxf.get('bg_fill',0) or 0):result.update(backgroundMask=True,maskPadding=max(0,(float(e.dxf.get('box_fill_scale',1.5) or 1.5)-1)*raw_height*factor/2))
                    if typ=='MTEXT':converted['MTEXT 서식 → 일반 여러줄 문자']+=1
                elif (typ in ('ARC_DIMENSION','LARGE_RADIAL_DIMENSION') or typ=='DIMENSION' and (e.dxf.dimtype & 7) in (0,1,2,3,4,5,6)) and not projected and (typ!='DIMENSION' or not degenerate_dimension(e)):
                    # Keep defining points so STRETCH can update the measurement.
                    style=e.get_dim_style();override=e.override()
                    def dimvar(name,default):return override.get(name,style.dxf.get(name,default))
                    height=float(dimvar('dimtxt',150) or 150)*abs(float(dimvar('dimscale',1) or 1))*factor
                    dtype=e.dxf.dimtype & 7;angle=float(e.dxf.get('angle',0)) if e.dxf.is_supported('angle') else 0;aligned=dtype==1
                    if typ=='ARC_DIMENSION':points=[point(e.dxf.defpoint4),point(e.dxf.defpoint2),point(e.dxf.defpoint3),point(e.dxf.defpoint)];mode='arcLength'
                    elif typ=='LARGE_RADIAL_DIMENSION':points=[point(e.dxf.defpoint),point(e.dxf.chord_point),point(e.dxf.get('text_midpoint',e.dxf.chord_point)),point(e.dxf.override_center),point(e.dxf.jog_point)];mode='jogged'
                    elif dtype==4 and (jogged:=jogged_points(e)):
                        points=[point(e.dxf.defpoint),point(e.dxf.defpoint4),point(e.dxf.get('text_midpoint',e.dxf.defpoint4)),point(jogged[0]),point(jogged[1])];mode='jogged'
                    elif dtype in (0,1):points=[point(e.dxf.defpoint2),point(e.dxf.defpoint3),point(e.dxf.defpoint)];mode='aligned' if aligned else 'horizontal'
                    elif dtype in (3,4):
                        a=e.dxf.defpoint;b=e.dxf.defpoint4;center=(a+b)/2 if dtype==3 else a
                        points=[point(center),point(a if dtype==3 else b),point(e.dxf.get('text_midpoint',b))];mode='diameter' if dtype==3 else 'radius'
                    elif dtype==5:points=[point(e.dxf.defpoint4),point(e.dxf.defpoint2),point(e.dxf.defpoint3),point(e.dxf.defpoint)];mode='angular'
                    elif dtype==6:points=[point(e.dxf.defpoint),point(e.dxf.defpoint2),point(e.dxf.defpoint3)];mode='ordinateX' if e.dxf.dimtype & 64 else 'ordinateY'
                    else:
                        from ezdxf.math import intersection_line_line_2d,Vec2
                        a,b,c,d=e.dxf.defpoint2,e.dxf.defpoint3,e.dxf.defpoint4,e.dxf.defpoint
                        center=intersection_line_line_2d((Vec2(a),Vec2(b)),(Vec2(c),Vec2(d)))
                        if center is None:raise ValueError('평행한 두 선의 각도 치수는 가져올 수 없습니다.')
                        # 호 위치(defpoint5)가 들어가는 쐐기를 골라야 교차(X자) 선에서 보각으로 뒤집히지 않는다.
                        arc=Vec2(e.dxf.defpoint5)-center;u1=Vec2(b)-Vec2(a);u2=Vec2(d)-Vec2(c);best=None
                        for s1 in (1,-1):
                            for s2 in (1,-1):
                                d1=u1*s1;d2=u2*s2;sweep=(d2.angle-d1.angle)%math.tau
                                span=sweep if (arc.angle-d1.angle)%math.tau<=sweep else math.tau-sweep
                                if best is None or span<best[0]-1e-9:best=(span,center+d1,center+d2)
                        aa,bb=(best[1],best[2]) if best and arc.magnitude>1e-9 else (a if (Vec2(a)-center).magnitude>1e-9 else b,c if (Vec2(c)-center).magnitude>1e-9 else d)
                        points=[point(center),point(aa),point(bb),point(e.dxf.defpoint5)];mode='angular'
                    result.update(type='dimension',points=points,mode=mode,textHeight=height,
                                  measurementScale=abs(float(dimvar('dimlfac',1) or 1)),precision=max(0,min(8,int(dimvar('dimdec',2)))))
                    if typ=='ARC_DIMENSION':
                        result['arcSymbol']='⌒'
                        if e.dxf.get('is_partial',0):result['arcPartial']=True
                        if e.dxf.get('has_leader',0):result.update(arcLeader=True,leaderPoint=point(e.dxf.leader_point1))
                    # DXF 53 은 '기본 방향(치수선 방향)에서 돌린 각' 이라 0 은 기본 방향이다(10/23: 세로 치수 글자가 가로로 눕던 것).
                    # 글자를 수평으로 쓰는 스타일(DIMTIH·DIMTOH=1)만 가로 0° 로 고정한다.
                    if e.dxf.hasattr('text_rotation') and abs(float(e.dxf.text_rotation))>1e-9:result['textRotation']=float(e.dxf.text_rotation)
                    elif typ=='DIMENSION' and dtype in (0,1) and int(dimvar('dimtih',0) or 0)==1 and int(dimvar('dimtoh',0) or 0)==1:result['textRotation']=0.0
                    gaps=_dimension_breaks(e)
                    if gaps:result['breaks']=gaps
                    if typ in ('ARC_DIMENSION','LARGE_RADIAL_DIMENSION') or mode in ('jogged','ordinateX','ordinateY') or gaps:
                        effective=abs(float(dimvar('dimscale',1) or 1))*factor
                        for key,var,default_value in [('arrowSize','dimasz',height*.4/effective),('extensionOffset','dimexo',0),
                                                       ('extensionOvershoot','dimexe',height*.4/effective),('textGap','dimgap',height*.3/effective)]:
                            result[key]=float(dimvar(var,default_value))*effective
                        arrow=str(dimvar('dimblk','') or '').lstrip('_').upper()
                        result['arrowType']={'ARCHTICK':'tick','OBLIQUE':'oblique','OPEN':'open','CLOSEDBLANK':'closed','DOT':'dot','':'closed-filled'}.get(arrow,'tick')
                        if typ=='ARC_DIMENSION' and int(dimvar('dimarcsym',0))==2:result['arcSymbol']=False
                    if typ=='DIMENSION' and dtype==0:result['axisAngle']=angle
                    if typ=='DIMENSION' and dtype==6:result['axisAngle']=-float(e.dxf.get('horizontal_direction',0))+(90 if mode=='ordinateY' else 0)
                    if mode=='angular':
                        prec=int(dimvar('dimadec',2));result['precision']=max(0,min(8,prec if prec>=0 else int(dimvar('dimdec',2))))
                    # 읽을 때 \U+XXXX 로 바꿔 둔 한글·Ø 를 TEXT 처럼 되돌린다(예전: 화면에 \U+C124… 로 보임).
                    literal=dxf_unicode(e.dxf.get('text','<>'))
                    if literal not in ('','<>'):result['text']=literal
                    template=dxf_unicode(dimvar('dimpost','<>') or '')
                    if template and template!='<>':result['textTemplate']=template
                    converted['DIMENSION → 기준점이 유지되는 치수']+=1
                elif typ=='ACAD_TABLE':
                    reference=table_insert(e)
                    value=entity(reference,depth+1,outer_scale)
                    if value is None:skipped['ACAD_TABLE 표시 없음']+=1;return None
                    result.update({k:v for k,v in value.items() if k not in ('id','sourceHandle','sourceFingerprint')})
                    decomposed['ACAD_TABLE']+=1;converted['표 → 선·글자로 바꿈']+=1
                elif typ=='REGION':
                    from ezdxf.acis.api import load_dxf
                    try:
                        origin=e.origin_of_copy or e
                        loops=getattr(origin,'_barun_region_loops',None) or region_boundary_loops(load_dxf(e))
                        matrix=e.temporary_transformation().get_matrix()
                        if matrix is not None:loops=[list(matrix.transform_vertices(loop)) for loop in loops]
                    except Exception:skipped['REGION ACIS 경계 읽기 불가']+=1;return None
                    children=[]
                    for loop in loops:
                        # Allocate through entity() to honor the existing import limit.
                        from ezdxf.entities import factory
                        poly=factory.new('LWPOLYLINE',dxfattribs=e.graphic_properties(),doc=doc)
                        poly.set_points([(v.x,v.y) for v in loop]);poly.closed=True
                        child=entity(poly,depth+1,outer_scale)
                        if child:children.append(child)
                    if not children:skipped['REGION 경계 없음']+=1;return None
                    if len(children)==1:result.update(type='polyline',points=children[0]['points'],closed=True)
                    else:result.update(type='block',name='REGION 경계',entities=children)
                    decomposed['REGION']+=1;converted['영역(REGION) → 닫힌 폴리선으로 바꿈']+=1
                elif typ=='INSERT' and e.mcount>1 and can_share_array_reference(e):
                    # 604 MINSERT: 칸마다 같은 정의를 쓰는 참조. 펼친 사본 rows×cols 벌 대신 정의 1개.
                    key=shared_definition(e.dxf.name)
                    if not shared_blocks[key]['entities']:skipped['INSERT EMPTY']+=1;return None
                    cells=[]
                    for ins in e.multi_insert():
                        cell_scale,cell_rotation,cell_mirror=shared_block_transform(ins)
                        cell={'id':import_prefix+format(counter,'x')+'-'+str(len(cells)),'layer':result['layer'],'type':'block','name':key,'sharedBlock':key,'position':point(ins.dxf.insert),'scale':cell_scale,'rotation':cell_rotation,'entities':[]}
                        if (scales:=shared_block_scales(ins)):cell['scaleX'],cell['scaleY']=scales
                        if cell_mirror:cell['mirror']=True
                        cells.append(cell)
                    result.update(type='block',name=key,entities=cells,minsert={'rows':int(e.dxf.row_count),'cols':int(e.dxf.column_count)})
                    converted['MINSERT → 공유 정의 참조 배열']+=1
                elif typ=='INSERT' and can_share_block_reference(e):
                    key=shared_definition(e.dxf.name)
                    if not shared_blocks[key]['entities'] and not e.attribs:skipped['INSERT EMPTY']+=1;return None
                    shared_scale,shared_rotation,shared_mirror=shared_block_transform(e)
                    result.update(type='block',name=key,sharedBlock=key,position=point(e.dxf.insert),scale=shared_scale,rotation=shared_rotation,entities=[])
                    if (scales:=shared_block_scales(e)):result['scaleX'],result['scaleY']=scales;converted['비균일 축척 블록 → 공유 정의(scaleX·scaleY)']+=1
                    if shared_mirror:result['mirror']=True
                    if (shared_clip:=insert_clip(e,point)):result['clip']=shared_clip
                    if e.attribs:
                        result['entities']=attribute_children(e.attribs,lambda v:entity(v,depth+1,outer_scale))
                        result['attributes']={dxf_unicode(v.dxf.tag):percent_to_plain(dxf_unicode(v.dxf.text)) for v in e.attribs}
                    converted['반복 블록 → 공유 정의 빠른 열기']+=1
                elif typ in ('INSERT','DIMENSION','ARC_DIMENSION','LARGE_RADIAL_DIMENSION'):
                    if typ=='INSERT' and e.mcount>1:vs=[v for ins in e.multi_insert() for v in ins.virtual_entities()]
                    else:vs=e.virtual_entities()
                    children=[child for v in vs if (child:=entity(v,depth+1,outer_scale))]
                    if typ=='INSERT':
                        children.extend(attribute_children(e.attribs,lambda v:entity(v,depth+1,outer_scale)))
                        result['attributes']={dxf_unicode(v.dxf.tag):percent_to_plain(dxf_unicode(v.dxf.text)) for v in e.attribs}
                        for child in children:
                            if child['layer']==mapping.get('0'):child['layer']=result['layer'];child['inheritLayer']=True
                            if 'color' not in child and 'color' in result:child['color']=result['color']
                    if not children:skipped[typ+' EMPTY']+=1;return None
                    result.update(type='block',name=dxf_unicode(e.dxf.name) if typ=='INSERT' else 'DXF 치수(분해형)',entities=children)
                    if typ!='INSERT':converted[typ+' → 편집 가능한 선/문자 블록']+=1
                    if typ=='INSERT' and (expanded_clip:=insert_clip(e,point)):result['clip']=expanded_clip
                elif typ in ('LEADER','MULTILEADER','MLINE','MPOLYGON'):
                    children=[child for v in e.virtual_entities() if (child:=entity(v,depth+1,outer_scale))]
                    if not children:skipped[typ+' 화면 표시 없음']+=1;return None
                    result.update(type='block',name='DXF '+typ,entities=children)
                    converted[typ+' → 화면용 기본 도형 · 원본 보존']+=1
                elif typ in ('XLINE','RAY'):
                    start=e.dxf.start;direction=e.dxf.unit_vector.normalize();span=1_000_000/factor
                    a=start-direction*span if typ=='XLINE' else start;b=start+direction*span
                    result.update(type='line',points=[point(a),point(b)])
                    converted[typ+' → 화면용 연장선 · 원본 보존']+=1
                elif typ=='3DFACE':
                    ps=[point(v) for v in e.wcs_vertices(close=False)]
                    result.update(type='polyline',points=ps,closed=True)
                    converted['3DFACE → XY 화면 표시 · 원본 보존']+=1
                elif typ=='WIPEOUT':
                    # 가리기(ACAD200-411): 경계선만 담은 블록 대신 바른 CAD 가리기(바탕색 채움 해치)로 — 실제로 뒤를 가린다.
                    boundary=[point(v) for v in e.boundary_path_wcs()]
                    if len(boundary)>1 and boundary[0]==boundary[-1]:boundary.pop()
                    if len(boundary)<3:skipped[typ+' 경계 없음']+=1;return None
                    result.update(type='hatch',solid=True,wipeout=True,frame=1,points=boundary,spacing=100,angle=0)
                    converted['WIPEOUT → 가리기(바탕색 채움)']+=1
                elif typ=='IMAGE':
                    boundary=list(e.boundary_path_wcs())
                    if len(boundary)<3:skipped[typ+' 경계 없음']+=1;return None
                    outline={'id':uuid.uuid4().hex,'layer':result['layer'],'type':'polyline','points':[point(v) for v in boundary],'closed':True}
                    result.update(type='block',name='DXF '+typ,entities=[outline])
                    converted[typ+' → 경계 화면 표시 · 원본 참조 보존']+=1
                elif typ=='MESH':
                    children=[]
                    vertices=list(e.vertices)
                    for face in e.faces:
                        ps=[point(vertices[index]) for index in face]
                        if len(ps)>=2:children.append({'id':uuid.uuid4().hex,'layer':result['layer'],'type':'polyline','points':ps,'closed':True})
                    if not children:skipped['MESH 화면 표시 없음']+=1;return None
                    result.update(type='block',name='DXF MESH',entities=children)
                    converted['MESH → XY 면 경계 · 원본 보존']+=1
                elif typ=='HATCH':
                    loops=[]
                    for path in e.paths:
                        if not hasattr(path,'vertices') or any(len(v)>2 and abs(v[2])>1e-10 for v in path.vertices):
                            ps=[point(v) for v in flatten_curve_path(dxfpath.from_hatch_boundary_path(path),.1/factor/outer_scale)]
                            loops.append(ps);converted['HATCH 곡선 경계 → 폴리선 (분할 기준 0.1 mm)']+=1
                        else:loops.append([point(v) for v in path.vertices])
                    # 퇴화한 내부 구멍 경계 하나 때문에 해치 전체가 사라지지 않도록 그 루프만 걸러낸다.
                    loops=[p for p in loops if len(p)>=3]
                    if not loops:skipped['HATCH 경계 없음']+=1;return None
                    result.update(type='hatch',points=loops[0],loops=loops[1:],solid=bool(e.dxf.solid_fill),spacing=100*factor,angle=e.dxf.pattern_angle)
                    if not e.dxf.solid_fill:
                        if e.dxf.pattern_name in ('BARUN_LINES','BARUN_CROSS') and e.pattern and e.pattern.lines:
                            spacing=e.pattern.lines[0].offset.magnitude*factor
                            result.update(pattern='cross' if e.dxf.pattern_name=='BARUN_CROSS' else 'lines',spacing=spacing,hatchScale=spacing/100)
                        elif e.pattern and e.pattern.lines and (len(e.pattern.lines)>1024 or any(len(l.dash_length_items)>256 for l in e.pattern.lines)):
                            # 엔진 한도(줄 1024·대시 256, engine.js HATCH_PATTERN_LIMITS)를 넘는 무늬는 해치 하나 때문에 도면이 안 열리지 않게 단선으로 바꾼다.
                            converted['HATCH 무늬 줄 한도 초과 → 단선']+=1
                        elif e.pattern and e.pattern.lines:
                            # 표준·사용자 무늬(AR-CONC·ANSI31 …)를 단선으로 바꾸지 않고 무늬 줄 그대로 가져온다(도면 좌표, mm 로 환산).
                            lines=[{'angle':float(l.angle),'base':point(l.base_point),'offset':{'x':float(l.offset[0])*factor,'y':float(l.offset[1])*factor},'dashes':[float(d)*factor for d in l.dash_length_items]} for l in e.pattern.lines]
                            gaps=[abs(l['offset']['x']*-math.sin(math.radians(l['angle']))+l['offset']['y']*math.cos(math.radians(l['angle']))) for l in lines]
                            result.update(patternType=int(e.dxf.get('pattern_type',1)),patternDouble=bool(e.dxf.get('pattern_double',0)),hatchStyle=int(e.dxf.get('hatch_style',1)))
                            result.update(pattern='pattern',patternName=dxf_unicode(str(e.dxf.pattern_name or 'USER'))[:31],patternScale=float(e.dxf.get('pattern_scale',1) or 1),patternLines=lines,spacing=min([g for g in gaps if g>1e-9] or [100*factor]))
                            converted['HATCH 무늬 보존']+=1
                        else:converted['HATCH 패턴 → 단선 100단위 간격']+=1
                        # HP 해치 기준점: 무늬 첫 선의 기준점(바른 CAD 가 내보낸 해치·AutoCAD 해치 모두 도면 좌표)을 origin 으로 되살린다(비평 4).
                        if e.pattern and e.pattern.lines:
                            base=e.pattern.lines[0].base_point
                            if abs(base[0])>1e-9 or abs(base[1])>1e-9:result['origin']=point(base)
                elif typ in ('SOLID','TRACE'):
                    ps=[point(e.dxf.get('vtx'+str(i))) for i in [0,1,3,2]]
                    # 채운 면(SOLID·TRACE)은 해치가 아니다: OSOPTIONS 해치 무시와 상관없이 모서리를 잡는다(AutoCAD 같음).
                    result.update(type='hatch',points=ps,solid=True,spacing=100,angle=0,solidFace=True)
                else:skipped[typ]+=1;return None
            except (AttributeError,ezdxf.DXFError,ValueError,ZeroDivisionError,TypeError):skipped[typ+' 읽기 실패']+=1;return None
            result['sourceHandle']=None if typ=='REGION' and getattr(e.origin_of_copy or e,'_barun_generated_region',False) else e.dxf.get('handle')
            if typ=='INSERT' and dyn_inserts and result.get('type')=='block':attach_dynamic(e,result)
            # 지문은 저장 때 모델 공간 최상위 객체가 고쳐졌는지만 본다. 블록 안 하위 객체(이 도면에서 66만 개)는 계산하지 않는다.
            if depth==0:result['sourceFingerprint']=editable_fingerprint(result)
            return result
        if split is None:entities=[value for e in doc.modelspace() if (value:=entity(e))]
        else:
            # Same result, field by field, as entity() gives the entity the DXF would
            # have held (keys in the same order), without sourceFingerprint: export_dxf
            # uses it only for entities still in the preserved DXF, and split entities
            # are not in it. On 1.9M lines the unused 64-character strings held ~150 MB.
            strings,split_handles,split_kinds,records,pool,spline_pool=read_split_lines(split)
            def split_layer(name):
                if name in mapping:return mapping[name]
                return mapping.get(_NON_ASCII.sub(_dxf_unicode_escape,name),default)
            layer_ids=[split_layer(name) for name in strings]
            linetypes=[None if (raw:=_NON_ASCII.sub(_dxf_unicode_escape,name)).upper()=='BYLAYER' else 'BYBLOCK' if raw.upper()=='BYBLOCK' else dxf_unicode(raw) for name in strings]
            aci_colors=[None]+['#%02x%02x%02x'%tuple(colors.aci2rgb(i)) for i in range(1,256)]
            def split_header(layer,linetype,colour,lineweight,ltscale):
                nonlocal counter
                counter+=1
                if counter>MAX_ENTITIES:raise ValueError('가져오기 객체가 2,000,000개를 초과합니다. 대용량 도면 모드로 나눠 열어 주세요.')
                result={'id':import_prefix+format(counter,'x'),'layer':layer_ids[layer]}
                if colour>=0x1000000:result.update(color='#%06x'%(colour&0xffffff),colorMode='truecolor')
                elif 1<=colour<=255:result.update(color=aci_colors[colour],aci=colour,colorMode='aci')
                elif colour==0:result['colorMode']='byblock'
                if linetypes[linetype] is not None:result['linetype']=linetypes[linetype]
                ltscale=float(ltscale or 1.0)
                if abs(ltscale-1.0)>1e-9:result['linetypeScale']=ltscale
                if lineweight>=0:result['lineweight']=lineweight/100
                elif lineweight==-2:result['lineweightMode']='byblock'
                return result
            # ezdxf.upright flips an extrusion of exactly (0,0,-1) with these operations.
            flip_angle=lambda angle:(180.0 if angle>=0.0 else -180.0)-angle
            def split_line(handle,record):
                layer,linetype,colour,lineweight,flags,ltscale,x1,y1,z1,x2,y2,z2=record
                result=split_header(layer,linetype,colour,lineweight,ltscale)
                if flags&2:converted['LINE 법선 무관 WCS 좌표 → XY 평면']+=1
                if abs(z1)>1e-8 or abs(z2)>1e-8:converted['3D LINE → XY 평면']+=1
                result.update(type='line',points=[{'x':x1*factor,'y':y1*factor},{'x':x2*factor,'y':y2*factor}])
                result['sourceHandle']=format(handle,'X')
                return result
            def split_circle(handle,record,typ):
                layer,linetype,colour,lineweight,flags,ltscale,cx,cy,cz,radius,*angles=record
                result=split_header(layer,linetype,colour,lineweight,ltscale)
                if flags&1:
                    converted[typ+' 반전 OCS → WCS']+=1;cx=-cx;cz=-cz
                    if angles:angles=[flip_angle(angles[1]),flip_angle(angles[0])]
                if radius<=0:skipped['ZERO_RADIUS']+=1;return None
                if abs(cz)>1e-8:converted[typ+' 높이 → XY 평면']+=1
                result.update(type=typ.lower(),center={'x':cx*factor,'y':cy*factor},radius=radius*factor)
                if typ=='ARC':result.update(startAngle=angles[0],endAngle=angles[1])
                result['sourceHandle']=format(handle,'X')
                return result
            vertex=0
            def split_polyline(handle,record):
                nonlocal vertex
                layer,linetype,colour,lineweight,flags,ltscale,count,closed,width,elevation=record
                result=split_header(layer,linetype,colour,lineweight,ltscale)
                if flags&1:
                    converted['LWPOLYLINE 반전 OCS → WCS']+=1;elevation=-elevation
                    ps=[{'x':-pool[i]*factor,'y':pool[i+1]*factor} for i in range(2*vertex,2*(vertex+count),2)]
                else:ps=[{'x':pool[i]*factor,'y':pool[i+1]*factor} for i in range(2*vertex,2*(vertex+count),2)]
                vertex+=count
                if len(ps)<2:skipped['SHORT_POLYLINE']+=1;return None
                result.update(type='polyline',points=ps,closed=bool(closed&1))
                if width:result['constantWidth']=float(width)*factor
                if abs(elevation)>1e-8:converted['폴리선 높이 → XY 평면']+=1
                result['sourceHandle']=format(handle,'X')
                return result
            spline_at=0
            def split_spline(handle,record):
                # The SPLINE the DXF would hold (flags, degree, control points, knots; no
                # weights, fit points or tangents), flattened by the same ezdxf call.
                nonlocal spline_at
                layer,linetype,colour,lineweight,flags,ltscale,degree,spline_flags,count,knot_count,knot_tol,control_tol,fit_tol=record
                result=split_header(layer,linetype,colour,lineweight,ltscale)
                at=spline_at;spline_at+=3*count+knot_count
                from ezdxf.entities import Spline
                # The tolerances (DXF 42-44) steer ezdxf's Bezier decomposition: without them the
                # flattened points differ in the last bits from the DXF route.
                spline=Spline.new(dxfattribs={'degree':degree,'flags':spline_flags,'knot_tolerance':knot_tol,'control_point_tolerance':control_tol,'fit_tolerance':fit_tol})
                spline.control_points=[(spline_pool[i],spline_pool[i+1],spline_pool[i+2]) for i in range(at,at+3*count,3)]
                spline.knots=spline_pool[at+3*count:at+3*count+knot_count]
                try:
                    ps=[point(v) for v in flatten_curve_path(dxfpath.make_path(spline),.1/factor)]
                except (AttributeError,ezdxf.DXFError,ValueError,ZeroDivisionError,TypeError):skipped['SPLINE 읽기 실패']+=1;return None
                if len(ps)<2:skipped['SPLINE 경로 없음']+=1;return None
                result.update(type='polyline',points=ps,closed=bool(spline.closed),curveApprox=True);converted['SPLINE → 곡선 근사 폴리선 (분할 기준 0.1 mm)']+=1
                result['sourceHandle']=format(handle,'X')
                return result
            lines,circles,arcs,polylines,splines=records['LINE'],records['CIRCLE'],records['ARC'],records['LWPOLYLINE'],records['SPLINE']
            residual={}
            for e in doc.modelspace():
                handle=e.dxf.get('handle')
                if not handle or handle in residual:raise SplitLinesError('split lines: DXF handles')
                residual[handle]=e
            entities=[]
            for handle,kind in zip(split_handles,split_kinds):
                if kind==1:value=split_line(handle,next(lines))
                elif kind==2:value=split_circle(handle,next(circles),'CIRCLE')
                elif kind==3:value=split_circle(handle,next(arcs),'ARC')
                elif kind==4:value=split_polyline(handle,next(polylines))
                elif kind==5:value=split_spline(handle,next(splines))
                else:
                    e=residual.pop(format(handle,'X'),None)   # absent: the writer dropped it (verified per type)
                    value=entity(e) if e is not None else None
                if value:entities.append(value)
            if residual:raise SplitLinesError('split lines: DXF entities outside the engine order')
            converter_details['splitLines']=len(split_kinds)-split_kinds.count(0)
        blocks=[];seen=set()
        for e in entities:
            if e['type']=='block' and e['name'] not in seen and not e.get('minsert'):
                seen.add(e['name']);definition={'name':e['name'],'entities':e['entities']}
                if e.get('sharedBlock'):
                    # Keep the same first-instance template used by expanded
                    # imports, without expanding every catalog block eagerly.
                    for key in ('sharedBlock','position','scale','rotation','mirror','attributes'):
                        if key in e:definition[key]=e[key]
                blocks.append(definition)
        # 621: DXF 그룹(ACAD_GROUP) → 객체의 group 이름(최상위 객체만).
        try:
            group_of={}
            for group_name,group in doc.groups:
                for member in group:group_of[member.dxf.handle]=group_name
            if group_of:
                for e in entities:
                    if e.get('sourceHandle') in group_of:e['group']=group_of[e['sourceHandle']]
        except Exception:pass
        handles=[e['sourceHandle'] for e in entities if e.get('sourceHandle')]
        timings['normalize']=round((time.perf_counter()-normalize_started)*1000,3)
        preservation_started=time.perf_counter()
        # 감사 1: 원본 복사는 원래 단위 숫자인데 저장 머리는 mm 라, mm 가 아닌 도면은 보존하지 않고 전부 mm 로 다시 쓴다.
        preservation=None if packing is None else {'format':'dxf-zlib-v1','data':base64.b64encode(packing.result()).decode('ascii'),'handles':handles,'version':doc.dxfversion}
        if preservation is not None and getattr(doc,'_barun_derived_block_regions',None):
            preservation['derivedBlockRegions']=doc._barun_derived_block_regions
        timings['preservation_compress']=round((time.perf_counter()-preservation_started)*1000,3)
        info.update(skipped=dict(skipped),converted=dict(converted),nativeMetadata=False,imported=len(entities))
        info['decomposed']=dict(decomposed)
        for kind,label,action in (('ACAD_TABLE','표','선·글자로 바꿈'),('REGION','영역(REGION)','닫힌 폴리선으로 바꿈')):
            if decomposed[kind]:info['warnings'].append(f'{label} {decomposed[kind]:,}개 → {action}')
        if info['layoutsPreserved'] and preservation is not None:info['warnings'].append(f"배치·뷰포트 {info['layoutsPreserved']}개를 원본 보존 계층에 유지합니다.")
        empty_inserts=skipped['INSERT EMPTY']
        invalid_texts=sum(count for kind,count in skipped.items() if '비정상 좌표' in kind)
        recovered_texts=sum(count for kind,count in converted.items() if '대체 기준점 복구' in kind)
        if empty_inserts:info['warnings'].append(f'화면에 표시할 객체가 없는 빈 블록 참조(INSERT EMPTY) {empty_inserts:,}개를 건너뜁니다.')
        if invalid_texts:info['warnings'].append(f'비정상 좌표의 문자 {invalid_texts:,}개를 건너뜁니다. 나머지 도면은 계속 엽니다.')
        if recovered_texts:info['warnings'].append(f'문자 {recovered_texts:,}개의 비정상 좌표를 다른 기준점으로 복구했습니다.')
        kept_skipped=sum(skipped.values())-sum(unpreserved.values())-empty_inserts-invalid_texts
        if kept_skipped and preservation is not None:info['warnings'].append(f'미지원 객체 {kept_skipped}개를 원본 보존 계층에 유지합니다.')
        if unpreserved:
            info['unpreserved']=dict(unpreserved)
            from batch_converter import type_counts_text
            info['warnings'].append('변환 중 빠진 객체: '+type_counts_text(unpreserved)+'. 원본 보존 계층에도 없으며 원본 DWG 파일에서 확인해야 합니다.')
        if preservation is None:info['warnings'].append('대용량 도면은 메모리 보호를 위해 원본 DXF 복사본을 문서 안에 넣지 않았습니다. 원본 파일은 그대로 유지됩니다.')
        if preservation is None and skipped:info['warnings'].append('미지원 객체가 있어 이 문서는 무손실 저장할 수 없습니다. 다른 이름 저장 전에 원본과 비교하세요.')
        info['warnings'].append('외부 도면의 SHX/폰트·복잡한 선종류는 동일하게 표시되지 않을 수 있습니다.')
        try:
            info['savedBy']=saved_by_info(doc.dxfversion,{k:doc.header.get(k) for k in ('$LASTSAVEDBY','$ACADMAINTVER')},[a.dxf.name for a in doc.appids],[k for k in ('BARUN_CAD_V2','BARUN_CAD_DXF_DOWNGRADE') if k in doc.rootdict])
            notice=saved_by_notice(info['savedBy'],kept=max(0,kept_skipped) if preservation is not None else 0,skipped=sum(skipped.values()))
            if notice:info['warnings'].append(notice)
        except Exception:
            pass
        document={'version':imported_document_version(shared_blocks),'units':'mm','layers':layers,'blocks':blocks,'entities':entities,'linetypeScale':float(doc.header.get('$LTSCALE',1.0) or 1.0),'sourceCoverage':{'preservationAvailable':preservation is not None,'skipped':dict(skipped),'layoutsPreserved':info['layoutsPreserved'],'layoutsWithContent':sum(1 for layout in doc.layouts if layout.name!='Model' and any(e.dxftype()!='VIEWPORT' or e.dxf.get('id',0)!=1 for e in layout)),'unitScaleToMM':factor,'extraData':0 if factor==1 else sum(1 for owner in (*doc.layouts,*doc.blocks) for e in owner if e.xdata and any(app.upper()!='ACAD' for app in e.xdata.data))}}
        if preservation is not None:document['dxfPreservation']=preservation
        if preservation is not None and 'BARUN_CAD_DXF_DOWNGRADE' in doc.rootdict:preservation['downgraded']=True
        safety = _layer_migration_safety(doc)
        if safety:document['legacyLayerSafety']=safety
        if shared_blocks:document['sharedBlocks']=shared_blocks
        # 509 문자 스타일 표·511 축척 목록(AutoCAD 기본 목록 그대로면 두지 않는다 — 한국 건축 축척 기본을 쓴다).
        if (text_styles:=read_text_styles(doc)):document['textStyles']=text_styles
        if (scale_list:=read_scale_list(doc)):document['scaleList']=scale_list
        lt_defs=_linetype_definitions(doc,factor)
        if lt_defs:document['linetypeDefs']=lt_defs
        if not include_handles:_restore_native_extensions(doc,document,info,extensions)
        timings['import_total']=round((time.perf_counter()-import_started)*1000,3);info['timings_ms']=timings
        return {'document':document,'report':info}

def _point_in_ring(x,y,ring):
    yes=False;j=len(ring)-1
    for i in range(len(ring)):
        a=ring[i];b=ring[j]
        if (a['y']>y)!=(b['y']>y) and x<(b['x']-a['x'])*(y-a['y'])/(b['y']-a['y'])+a['x']:yes=not yes
        j=i
    return yes

def _ring_sample(ring):
    """루프 안쪽의 점: 긴 변 가운데에서 안쪽으로 조금 들어간 점(붙은 칸의 공유 변 위에 놓이지 않게). geometry.js ringSample 과 같다."""
    n=len(ring);s=sum(ring[i]['x']*ring[(i+1)%n]['y']-ring[(i+1)%n]['x']*ring[i]['y'] for i in range(n))/2
    if abs(s)<=1e-8:return None
    edges=sorted(((math.hypot(ring[(i+1)%n]['x']-ring[i]['x'],ring[(i+1)%n]['y']-ring[i]['y']),i) for i in range(n)),reverse=True)[:4]
    for l,i in edges:
        if l<=1e-8:continue
        a=ring[i];b=ring[(i+1)%n];dx=(b['x']-a['x'])/l;dy=(b['y']-a['y'])/l;nx,ny=(-dy,dx) if s>0 else (dy,-dx);mx=(a['x']+b['x'])/2;my=(a['y']+b['y'])/2
        for k in (1e-4,1e-6,1e-3,1e-2,.1):
            q=(mx+nx*l*k,my+ny*l*k)
            if _point_in_ring(q[0],q[1],ring):return q
    return None

def hatch_loop_flags(rings):
    """해치 경계 루프마다 DXF 경계 종류 플래그(1 = 바깥 경계, 0 = 구멍·섬 안쪽).
    한 HATCH 에 여러 영역(표 칸 여러 개 등)이 있으면 영역마다 바깥 경계(1)로 적는다(AutoCAD 가 한 번에 찍은 영역을 적는 방식).
    바깥/구멍은 다른 루프 몇 개 안에 들어 있는지의 짝홀로 정한다(화면·GPU·PDF 의 짝홀 채움과 같은 규칙)."""
    if len(rings)<=1:return [1]*len(rings)
    boxes=[(min(p['x'] for p in r),min(p['y'] for p in r),max(p['x'] for p in r),max(p['y'] for p in r)) if r else (0,0,-1,-1) for r in rings]
    flags=[]
    for i,ring in enumerate(rings):
        q=_ring_sample(ring);depth=0
        if q is not None:
            for j,other in enumerate(rings):
                if j==i:continue
                b=boxes[j]
                if b[0]<=q[0]<=b[2] and b[1]<=q[1]<=b[3] and _point_in_ring(q[0],q[1],other):depth+=1
        elif i:depth=1
        flags.append(0 if depth%2 else 1)
    return flags

# ezdxf 최소 버전이 느슨하거나 원시 태그로 보존되는 객체는 별도로 제한한다.
_DXF_VERSIONS={'R2000':'AC1015','R2004':'AC1018','R2007':'AC1021','R2010':'AC1024','R2013':'AC1027','R2018':'AC1032'}
_DOWNGRADE_MIN={**dict.fromkeys(('MULTILEADER','MLEADER','MLEADERSTYLE','ACAD_TABLE','TABLESTYLE','CELLSTYLEMAP','MATERIAL','VISUALSTYLE','LIGHT','SUN','PDFUNDERLAY','PDFDEFINITION','DWFUNDERLAY','DWFDEFINITION','DGNUNDERLAY','DGNDEFINITION','HELIX','SCALE','FIELD','FIELDLIST','MENTALRAYRENDERSETTINGS','RENDERENVIRONMENT','RENDERGLOBAL'), 'AC1021'),**dict.fromkeys(('MESH','GEODATA'), 'AC1024'),**dict.fromkeys(('ACDBDETAILVIEWSTYLE','ACDBSECTIONVIEWSTYLE'), 'AC1027')}
_DOWNGRADE_UNSAFE={'3DSOLID','BODY','REGION','SURFACE','PLANESURFACE','EXTRUDEDSURFACE','LOFTEDSURFACE','REVOLVEDSURFACE','SWEPTSURFACE','NURBSSURFACE','ACAD_PROXY_ENTITY','ACAD_PROXY_OBJECT'}
_DOWNGRADE_DROP={'MLEADERSTYLE','TABLESTYLE','CELLSTYLEMAP','MATERIAL','VISUALSTYLE','SUN','SCALE','GEODATA','MENTALRAYRENDERSETTINGS','RENDERENVIRONMENT','RENDERGLOBAL','ACDBDETAILVIEWSTYLE','ACDBSECTIONVIEWSTYLE'}
_DXF_RECORD=re.compile(rb'(?m)^ *0\r?\n([A-Za-z0-9_]*[A-Za-z_][A-Za-z0-9_]*)\r?\n')

def _downgrade_error(names):
    return ValueError('구버전 DXF로 바꿀 수 없는 객체('+', '.join(sorted(set(names)))+')가 있어 저장하지 않았습니다. 2007 이상으로 저장하세요. 원본은 변경되지 않았습니다.')

_DOWNGRADE_CACHE={};_DOWNGRADE_ACI={}

def _nearest_downgrade_aci(rgb):
    if rgb not in _DOWNGRADE_ACI:
        channels=colors.int2rgb(rgb);_DOWNGRADE_ACI[rgb]=min(range(1,256),key=lambda n:sum((a-b)**2 for a,b in zip(channels,colors.aci2rgb(n))))
    return _DOWNGRADE_ACI[rgb]


def _downgrade_min(name):
    if name in _DOWNGRADE_CACHE:return _DOWNGRADE_CACHE[name]
    from ezdxf.entities.factory import ENTITY_CLASSES
    cls=ENTITY_CLASSES.get(name)
    version=max(_DOWNGRADE_MIN.get(name,'AC1015'),getattr(cls,'MIN_DXF_VERSION_FOR_EXPORT','AC1015'));_DOWNGRADE_CACHE[name]=version;return version

def _downgrade_unsafe(name):
    return name in _DOWNGRADE_UNSAFE or name.startswith(('ACDBASSOC','ACDBBLOCK','ACDBDYNAMIC','ACDBEVALUATION','ACDB_MTEXTATTRIBUTE','ACDB_ANNOTATION','ACDBOBJECTCONTEXT','ACDBCONTEXTDATA')) or name.endswith('CONTEXTDATA')

def check_downgrade_bytes(data,target):
    # 최종 바이트만 검사한다. 재읽기·audit가 만든 기본 객체와 CLASS도 예외 없이 확인한다.
    from ezdxf.entities.factory import ENTITY_CLASSES
    from ezdxf.sections.classes import CLASS_DEFINITIONS
    bad=set();section='';previous=None
    for match in _DXF_RECORD.finditer(data):
        if previous is not None and previous[0]=='CLASS' and section=='CLASSES':
            record=data[previous[1]:match.start()];name_match=re.search(rb'(?m)^ *1\r?\n([^\r\n]+)',record)
            if name_match:
                name=name_match[1].strip().decode('ascii','replace').upper()
                if _downgrade_unsafe(name) or _downgrade_min(name)>target or name not in ENTITY_CLASSES and name not in CLASS_DEFINITIONS:bad.add(name)
        name=match[1].strip().decode('ascii','replace').upper()
        if name=='SECTION':
            section_match=re.match(rb' *2\r?\n([^\r\n]+)',data[match.end():match.end()+80])
            section=section_match[1].strip().decode('ascii','replace') if section_match else ''
            if section=='ACDSDATA':bad.add('ACDSDATA')
        elif name=='ENDSEC':section=''
        elif section in ('ENTITIES','BLOCKS','OBJECTS'):
            if _downgrade_unsafe(name) or _downgrade_min(name)>target or name not in ENTITY_CLASSES:bad.add(name)
        previous=(name,match.end())
    if bad:raise _downgrade_error(bad)

def _check_downgrade_source(doc,target):
    from ezdxf.entities.dxfentity import DXFTagStorage
    bad=set()
    for block in doc.blocks:
        if block.block.dxf.get('flags',0)&(4|8|16|32|64) or block.block.dxf.get('xref_path'):bad.add('외부 참조 INSERT')
        record=block.block_record
        if record.has_xdata('AcDbBlockRepBTag') or record.has_xdata('AcDbDynamicBlockGUID'):bad.add('동적 블록 INSERT')
    for entity in doc.entitydb.values():
        name=entity.dxftype()
        if _downgrade_unsafe(name) or isinstance(entity,DXFTagStorage) and name not in _DOWNGRADE_DROP|{'ACAD_TABLE'}:bad.add(name)
        elif _downgrade_min(name)>target and name not in _DOWNGRADE_DROP and name not in ('MULTILEADER','MLEADER','ACAD_TABLE','MESH','HELIX'):bad.add(name)
        if entity.has_xdata('AcDbBlockRepBTag') or entity.has_xdata('AcDbDynamicBlockGUID'):bad.add('동적 블록 INSERT')
    for cls in doc.classes:
        if _downgrade_unsafe(cls.dxf.name.upper()):bad.add(cls.dxf.name)
    if bad:raise _downgrade_error(bad)

def _clean_downgrade_objects(doc,target):
    doomed={e.dxf.handle:e for e in doc.objects if e.dxftype() in _DOWNGRADE_DROP and _downgrade_min(e.dxftype())>target}
    if not doomed:return
    # 사전·기본 항목·재액터에 삭제한 핸들이 남으면 audit가 되살리거나 잘못된 참조가 된다.
    for obj in list(doc.objects):
        if obj.dxftype() in ('DICTIONARY','ACDBDICTIONARYWDFLT'):
            for key,value in list(obj.items()):
                if (value if isinstance(value,str) else value.dxf.handle) in doomed:obj.discard(key)
            if obj.dxf.is_supported('default') and obj.dxf.get('default') in doomed:obj.dxf.default='0'
        if obj.reactors:
            for handle in list(obj.reactors):
                if handle in doomed:obj.reactors.discard(handle)
    for obj in doomed.values():doc.objects.delete_entity(obj)

def _downgrade_document(doc,target,warnings):
    converted=Counter();rgb_count=0;replacements={}
    for block in list(doc.blocks):
        for entity in list(block):
            name=entity.dxftype()
            if _downgrade_min(name)<=target:continue
            try:
                old_handle=entity.dxf.handle;new_entities=[];attrs=entity.graphic_properties()
                if name=='ACAD_TABLE':
                    geometry=entity.get_block_name()
                    if not geometry or geometry not in doc.blocks or not len(doc.blocks.get(geometry)) or tuple(entity.xtags.get_subclass('AcDbBlockReference').get_first_value(210,(0,0,1)))!=(0,0,1):raise _downgrade_error([name])
                    direction=entity.dxf.get('horizontal_direction',(1,0,0))
                    if len(direction)>2 and direction[2] or not math.hypot(direction[0],direction[1]):raise _downgrade_error([name])
                    new_entities.append(block.add_blockref(geometry,entity.get_insert_location(),dxfattribs={**attrs,'rotation':math.degrees(math.atan2(direction[1],direction[0]))}))
                elif name=='MESH':
                    from ezdxf.render import MeshBuilder
                    if entity.dxf.get('subdivision_levels',0) or not len(entity.faces):raise _downgrade_error([name])
                    new_entities.append(MeshBuilder.from_mesh(entity).render_polyface(block,dxfattribs=attrs))
                elif name=='HELIX':
                    if not len(entity.control_points):raise _downgrade_error([name])
                    spline=block.add_spline(dxfattribs=attrs)
                    for key in ('degree','flags'):setattr(spline.dxf,key,getattr(entity.dxf,key))
                    spline.control_points=entity.control_points;spline.knots=entity.knots;spline.weights=entity.weights;new_entities.append(spline)
                else:
                    parts=list(entity.virtual_entities())
                    if not parts or any(_downgrade_min(p.dxftype())>target or _downgrade_unsafe(p.dxftype()) for p in parts):raise _downgrade_error([name])
                    for part in parts:block.add_entity(part)
                    new_entities=parts
                replacements[old_handle]=[e.dxf.handle for e in new_entities];block.delete_entity(entity);converted[name]+=1
            except Exception as error:raise _downgrade_error([name]) from error
    if target<'AC1018':
        # 레이어·객체에 명시된 ACI가 있으면 유지한다. RGB 전용일 때만 최근접 색 번호를 찾는다.
        for entity in doc.entitydb.values():
            rgb=entity.dxf.get('true_color') if entity.dxf.is_supported('true_color') else None
            if rgb is None:continue
            aci=entity.dxf.get('color') if entity.dxf.is_supported('color') else None
            if aci is None or abs(aci) not in range(1,256):
                entity.dxf.color=_nearest_downgrade_aci(rgb)
            entity.dxf.discard('true_color');rgb_count+=1
    _clean_downgrade_objects(doc,target);doc.dxfversion=target
    if target in ('AC1015','AC1018'):doc.encoding='cp949';doc.header['$DWGCODEPAGE']='ANSI_949'
    year=next(year[1:] for year,code in _DXF_VERSIONS.items() if code==target)
    detail=' · '.join(f'{name} {count}개' for name,count in sorted(converted.items()))
    warnings.append(f'구버전({year}) 저장: '+(detail+'를 기본 객체로 바꿨습니다.' if detail else '기본 객체와 배치·블록을 유지했습니다.'))
    if rgb_count:warnings.append(f'구버전({year}) 저장: RGB {rgb_count}개의 색을 ACI로 저장했습니다(기존 ACI 우선).')
    return replacements

def _refresh_downgrade_model(model_json,fresh,saved_handles,saved_outputs,replacements,layer_map):
    # 벽체·치수 매개변수와 사용자 ID는 유지하고, 분해된 객체·색·핸들·보존 바이트만 실제 결과로 맞춘다.
    model=json.loads(model_json);layer_ids={};layers_by_name={layer['name']:layer for layer in fresh['layers']}
    for layer in model['layers']:
        current=layers_by_name.get(layer_map[layer['id']])
        if current:layer_ids[current['id']]=layer['id'];layer.update({key:value for key,value in current.items() if key!='id'})
    for layer in fresh['layers']:
        if layer['id'] not in layer_ids:layer_ids[layer['id']]=layer['id'];model['layers'].append(layer)
    def remap(value):
        if isinstance(value,dict):
            if 'layer' in value:value['layer']=layer_ids[value['layer']]
            for child in value.values():remap(child)
        elif isinstance(value,list):
            for child in value:remap(child)
    remap(fresh['entities']);remap(fresh.get('sharedBlocks',{}))
    by_handle={}
    def index(value):
        if isinstance(value,dict):
            if value.get('sourceHandle'):by_handle[value['sourceHandle']]=value
            for child in value.values():index(child)
        elif isinstance(value,list):
            for child in value:index(child)
    index(fresh['entities']);index(fresh.get('sharedBlocks',{}))
    def sync(value):
        if isinstance(value,dict):
            handle=value.get('sourceHandle');current=by_handle.get(handle)
            if handle in replacements:value.pop('sourceHandle',None);value.pop('sourceFingerprint',None)
            if current:
                for key in ('color','colorMode','aci'):
                    if key in current:value[key]=current[key]
                    else:value.pop(key,None)
                if value.get('type')==current.get('type')=='text':value['text']=current['text']
            if fresh['dxfPreservation']['version']=='AC1015' and value.get('type') and value.get('color') and value.get('colorMode') not in ('aci','byblock'):
                aci=_nearest_downgrade_aci(int(value['color'][1:],16));value.update(colorMode='aci',aci=aci,color='#%02x%02x%02x'%tuple(colors.aci2rgb(aci)))
            for child in value.values():sync(child)
        elif isinstance(value,list):
            for child in value:sync(child)
    entities=[];used=set()
    for entity in model['entities']:
        handle=saved_handles.get(entity['id'],entity.get('sourceHandle'))
        if handle in replacements:
            parts=[by_handle[h] for h in replacements[handle] if h in by_handle]
            if parts:parts[0]['id']=entity['id']
            entities.extend(parts);used.update(part['sourceHandle'] for part in parts)
        else:
            if handle:entity['sourceHandle']=handle;used.add(handle)
            outputs=saved_outputs.get(entity['id'],[handle] if entity['id'] in saved_handles else entity.get('sourceHandles',[]))
            if len(outputs)>1:entity['sourceHandles']=outputs;used.update(outputs)
            else:entity.pop('sourceHandles',None)
            sync(entity);entities.append(entity)
    converted_handles={h for handles in replacements.values() for h in handles}
    entities.extend(e for e in fresh['entities'] if e.get('sourceHandle') in converted_handles-used)
    model['entities']=entities;sync(model['blocks']);sync(model.get('sharedBlocks',{}))
    if fresh.get('sharedBlocks'):model.setdefault('sharedBlocks',{}).update({key:value for key,value in fresh['sharedBlocks'].items() if key not in model.get('sharedBlocks',{})});model['version']=3
    for entity in entities:
        if entity.get('sourceHandle'):entity['sourceFingerprint']=editable_fingerprint(entity)
    model['dxfPreservation']=fresh['dxfPreservation'];model['dxfPreservation']['downgraded']=True;model['dxfPreservation']['handles']=[handle for e in entities for handle in e.get('sourceHandles',[]) or [e.get('sourceHandle')] if handle]
    model['sourceCoverage']=fresh['sourceCoverage'];return model


def _jogged_dimension_display(e):
    """Python-only callers can save native jogged dimensions without a browser cache."""
    center,chord,label,override,jog=e['points'][:5]
    scale=e.get('scale',1) or 1;height=(e.get('textHeight',150) or 150)*scale
    dx=chord['x']-override['x'];dy=chord['y']-override['y'];length=math.hypot(dx,dy) or 1
    ux,uy=dx/length,dy/length;size=(e.get('arrowSize') or e.get('textHeight',150))*scale
    before={'x':jog['x']-ux*size/2+uy*size/2,'y':jog['y']-uy*size/2-ux*size/2}
    after={'x':jog['x']+ux*size/2-uy*size/2,'y':jog['y']+uy*size/2+ux*size/2}
    vertices=[override,before,after,chord,label]
    parts=[{'type':'line','points':[a,b]} for a,b in zip(vertices,vertices[1:])]
    distance=math.hypot(chord['x']-center['x'],chord['y']-center['y'])*(e.get('measurementScale',1) or 1)
    measured='R '+format(round(distance,e.get('precision',2)),'.12g')
    template=e.get('text') or e.get('textTemplate') or '<>'
    parts.append({'type':'text','position':e.get('textPosition') or label,'height':height,'text':template.replace('<>',measured),'rotation':e.get('textRotation',0),'align':'center'})
    return parts

def _dimension_breaks(entity):
    """Read our gaps, not AutoCAD's unverified AcDbBreakData object schema."""
    text=None
    if entity.has_xdata(BREAK_APPID):
        tags=entity.get_xdata(BREAK_APPID)
        if tags and tags[0].code==1000 and tags[0].value==BREAK_SCHEMA:
            text=''.join(str(tag.value) for tag in tags[1:] if tag.code==1000)
    if text is None and entity.has_extension_dict:
        record=entity.get_extension_dict().get('BARUN_DIMENSION_BREAKS')
        if record is not None and record.dxftype()=='XRECORD':
            text=''.join(str(tag.value) for tag in record.tags if tag.code==1)
    if text is None:return []
    try:
        value=json.loads(text)
        if not isinstance(value,list):return []
        return [gap for gap in value if isinstance(gap,dict) and type(gap.get('partIndex')) is int
                and gap['partIndex']>=0 and all(type(gap.get(k)) in (int,float) and math.isfinite(gap[k]) for k in ('start','end'))
                and 0<=gap['start']<gap['end']<=1]
    except (ValueError,TypeError):return []


def _set_dimension_breaks(entity,gaps):
    if not gaps:return
    text=json.dumps(gaps,separators=(',',':'),ensure_ascii=True,allow_nan=False)
    dictionary=entity.get_extension_dict() if entity.has_extension_dict else entity.new_extension_dict()
    record=dictionary.add_xrecord('BARUN_DIMENSION_BREAKS')
    record.reset([(1,text[i:i+240]) for i in range(0,len(text),240)])
    if BREAK_APPID not in entity.doc.appids:entity.doc.appids.new(BREAK_APPID)
    # XData has a 16 KiB per-entity limit shared with other registered apps.
    # Large gap sets stay in the owned XRECORD, with a resolvable XData pointer.
    from ezdxf.lldxf.types import dxftag
    tags=[dxftag(1000,BREAK_SCHEMA),*[dxftag(1000,text[i:i+240]) for i in range(0,len(text),240)]]
    # Conservative serialized-size bound, including every other app's data.
    size=lambda values:sum(len(tag.dxfstr().encode('utf8'))+32 for tag in values)
    existing=sum(size(values) for name,values in entity.xdata.data.items() if name!=BREAK_APPID) if entity.xdata else 0
    if existing+size(tags)+len(BREAK_APPID)+36>16000:
        tags=[(1000,'BREAKS_XRECORD_V1'),(1005,record.dxf.handle)]
    entity.set_xdata(BREAK_APPID,tags)

def _strip_dimension_display_cache(model):
    """Remove transient display caches with copies only along changed entity paths."""
    def strip(value):
        if isinstance(value,list):
            children=[strip(child) for child in value]
            return value if all(a is b for a,b in zip(value,children)) else children
        if not isinstance(value,dict):return value
        changed={}
        if 'dimensionDisplayParts' in value:changed['dimensionDisplayParts']=None
        for key in ('entities','blocks'):
            if key in value:
                child=strip(value[key])
                if child is not value[key]:changed[key]=child
        if 'sharedBlocks' in value:
            blocks=value['sharedBlocks'];children={name:strip(child) for name,child in blocks.items()}
            if any(children[name] is not child for name,child in blocks.items()):changed['sharedBlocks']=children
        if not changed:return value
        result={**value,**changed};result.pop('dimensionDisplayParts',None);return result
    return strip(model)


def _linetype_definitions(drawing, factor=1.0):
    # ACAD200 720: 도면 LTYPE 표의 단순 무늬(대시·빈칸·점만)를 mm 로 옮긴다. 화면은 표준에 없는 이름에만 쓴다(view.js linDashPattern).
    out = {}
    try:
        for lt in drawing.linetypes:
            name = str(lt.dxf.name or '').upper()
            if not name or name in ('BYBLOCK', 'BYLAYER', 'CONTINUOUS') or len(out) >= 200:
                continue
            try:
                if lt.pattern_tags.is_complex_type():
                    continue
                pattern = [float(v) for v in lt.simplified_line_pattern()]
            except Exception:
                continue
            if not pattern or len(pattern) % 2 or len(pattern) > 24 or not all(math.isfinite(v) and v >= 0 for v in pattern):
                continue
            out[name] = {'pattern': [round(v * factor, 6) if i % 2 == 0 else -round(v * factor, 6) for i, v in enumerate(pattern)]}
    except Exception:
        return {}
    return out

def _layer_migration_safety(drawing, candidates=None, copies=None):
    """Read preservation-only hazards once, before changing any layer or block."""
    layers = {dxf_unicode(l.dxf.name).casefold(): l for l in drawing.layers}
    if candidates is None:
        aliases = {'a-wall-c', 'a-col', 'a-stair', 'a-sani', 'a-anno', 'a-dim',
                   'a-hatch', 'a-title', 'a-text', 'a-wall-brck', 'a-area-patt', 's-cols', 's-beam'}
        legacy_prefix = '_'.join(('바른', ''))
        candidates = {key for key in layers if key.startswith((legacy_prefix, 'b_')) or key in aliases}
        if not candidates:return {}
    candidates = set(candidates)
    viewports = [e for e in drawing.entitydb.values() if e.is_alive and e.dxftype() == 'VIEWPORT']
    styles = {}
    if viewports:
        for key, layer in layers.items():
            overrides = layer.get_vp_overrides()
            styles[key] = {
                'base': [layer.dxf.get(g) for g in ('color', 'true_color', 'linetype', 'lineweight')],
                'defaults': [getattr(overrides, g)('') for g in
                             ('get_color', 'get_rgb', 'get_linetype', 'get_lineweight', 'get_transparency')],
                'views': {vp.dxf.handle: {
                    'override': overrides.has_overrides(vp.dxf.handle),
                    'values': [getattr(overrides, g)(vp.dxf.handle) for g in
                               ('get_color', 'get_rgb', 'get_linetype', 'get_lineweight', 'get_transparency')]
                } for vp in viewports if overrides.has_overrides(vp.dxf.handle)} if overrides.has_overrides() else {}
            }
    cache, active, copyable, blocked = {}, set(), {}, set()
    def inspect(name, parent=None):
        key = (name.casefold(), parent if parent in candidates else None)
        if key in cache:
            return cache[key]
        if name not in drawing.blocks:
            return set(), False
        if key in active:
            return ({parent} if parent in candidates else set()), True
        active.add(key)
        affected, unsafe = set(), False
        block = drawing.blocks.get(name)
        for entity in block:
            layer = dxf_unicode(entity.dxf.get('layer', '0')).casefold()
            source = parent if layer == '0' else layer
            if source in candidates:
                affected.add(source)
            if entity.dxftype() == 'INSERT':
                nested, bad = inspect(entity.dxf.name, source)
                affected.update(nested); unsafe |= bad
        if affected:
            if copies is not None or key[0] not in copyable:
                try:
                    checked = [entity.copy() for entity in block]
                    if copies is not None:copies[key] = checked
                    copyable[key[0]] = True
                except Exception:
                    copyable[key[0]] = False
            unsafe |= not copyable[key[0]]
        active.remove(key)
        cache[key] = affected, unsafe
        if unsafe:
            blocked.update(affected)
        return cache[key]
    for layout in drawing.layouts:
        for entity in layout.query('INSERT'):
            inspect(entity.dxf.name, dxf_unicode(entity.dxf.get('layer', '0')).casefold())
    for block in drawing.blocks:
        if not block.name.upper().startswith(('*MODEL_SPACE', '*PAPER_SPACE')):
            inspect(block.name)
    return {'viewportStyles': styles, 'uncopyableLayers': sorted(blocked)}


def _layer_migration_conflicts(safety, changes):
    """Plan merges in source order without reserving a destination for a skipped source."""
    styles = dict(safety.get('viewportStyles', {}))
    blocked = {key: '블록을 복제할 수 없어' for key in safety.get('uncopyableLayers', []) if key in changes}
    for key, name in changes.items():
        if key in blocked:
            continue
        source, target = styles.get(key), styles.get(name.casefold())
        if source and target:
            for handle in source['views'].keys() | target['views'].keys():
                view = source['views'].get(handle, {'override': False, 'values': source['defaults']})
                other = target['views'].get(handle, {'override': False, 'values': target['defaults']})
                if other and (view['override'] or other['override']) and (
                        source['base'] != target['base'] or view['values'] != other['values']):
                    blocked[key] = '뷰포트 속성이 달라'
                    break
        if key not in blocked and source and name.casefold() not in styles:
            styles[name.casefold()] = source
    return blocked


def _restore_skipped_layer_migrations(model, original, blocked):
    """Repair older already-migrated records without undoing subsequent user edits."""
    model = json.loads(json.dumps(model))
    migrations = {r['from'].casefold(): r['to'] for r in model.get('layerNameMigrations', [])}
    current_layers = {l['name'].casefold(): l for l in model['layers']}
    original_layers = {l['id']: l for l in original['layers']}
    # Remove only state restrictions still equal to the old migration baseline.
    original_names = {l['name'].casefold(): l for l in original['layers']}
    def state(layer):
        return {'visible': layer.get('visible', True), 'frozen': bool(layer.get('frozen')),
                'locked': bool(layer.get('locked')), 'plot': layer.get('plot', True)}
    def merge(a, b):
        return {'visible': a['visible'] and b['visible'], 'frozen': a['frozen'] or b['frozen'],
                'locked': a['locked'] or b['locked'], 'plot': a['plot'] and b['plot']}
    for target in model['layers']:
        base = original_names.get(target['name'].casefold())
        sources = [original_names[key] for key, name in migrations.items()
                   if name.casefold() == target['name'].casefold() and key in original_names]
        if not base and not sources:continue
        expected = state(base or sources[0])
        safe_sources = [l for l in sources if l['name'].casefold() not in blocked]
        wanted = state(base or (safe_sources[0] if safe_sources else sources[0]))
        for source in target.get('mergedLayerSources', []):
            expected = merge(expected, state(source))
            if source['name'].casefold() not in blocked:wanted = merge(wanted, state(source))
        for field, value in expected.items():
            if target.get(field, field in ('visible', 'plot')) == value:target[field] = wanted[field]
    restored, prior_ids = {}, {}
    for source in original['layers']:
        key = source['name'].casefold()
        if key not in blocked:
            continue
        target = current_layers.get(migrations[key].casefold())
        archived = next((l for l in (target or {}).get('mergedLayerSources', []) if l['name'].casefold() == key), None)
        retained = dict(archived or source)
        # A unique rename shares the canonical id; reserve a separate retained id.
        if any(l['id'] == retained['id'] for l in model['layers']):
            retained['id'] = 'legacy-retained-' + retained['id']
        model['layers'].append(retained); restored[key] = retained
        prior_ids[retained['id']] = archived['id'] if archived else (target or retained)['id']
        if target:
            target['mergedLayerSources'] = [l for l in target.get('mergedLayerSources', []) if l['name'].casefold() != key]
            if not target['mergedLayerSources']:target.pop('mergedLayerSources')
    originals = {}
    def index(value):
        if isinstance(value, dict):
            if value.get('sourceHandle'):originals[value['sourceHandle']] = value
            for child in value.values():index(child)
        elif isinstance(value, list):
            for child in value:index(child)
    index(original['entities']); index(original.get('sharedBlocks', {})); index(original.get('blocks', []))
    def restore(entity, parent=None):
        prior = originals.get(entity.get('sourceHandle'))
        own = original_layers.get((prior or {}).get('layer'))
        source = parent if own and own['name'] == '0' and parent else own
        if prior and source and source['name'].casefold() in blocked:
            key = source['name'].casefold(); target = current_layers.get(migrations[key].casefold())
            if own['name'] != '0' and target and entity.get('layer') == target['id']:
                entity['layer'] = restored[key]['id']
            expected = {}
            if target:
                if (prior.get('colorMode') == 'byblock' and parent is None or prior.get('colorMode') != 'byblock' and
                        (not prior.get('color') or prior.get('colorMode') == 'bylayer' or prior.get('aci') == 256)) and source['color'] != target['color']:
                    expected.update(color=source['color'], colorMode='aci' if source.get('colorMode') == 'aci' else 'truecolor')
                    if source.get('colorMode') == 'aci':expected['aci'] = source.get('aci')
                    else:expected['aci'] = None
                lt = prior.get('linetype', 'BYLAYER').upper()
                if (lt == 'BYLAYER' or lt == 'BYBLOCK' and parent is None) and source.get('linetype') != target.get('linetype'):
                    expected['linetype'] = source.get('linetype') or 'CONTINUOUS'
                if prior.get('lineweight') is None and source.get('lineweight') != target.get('lineweight'):
                    expected['lineweight'] = source.get('lineweight', .25)
            for field, migrated in expected.items():
                if entity.get(field) == migrated:
                    if field in prior:entity[field] = prior[field]
                    else:entity.pop(field, None)
            if prior.get('sharedBlock') and entity.get('sharedBlock', '').startswith(prior['sharedBlock'] + '-layer-'):
                variant = model.get('sharedBlocks', {}).get(entity['sharedBlock'])
                original_block = original.get('sharedBlocks', {}).get(prior['sharedBlock'])
                if variant and original_block:
                    for child in variant.get('entities', []):restore(child, source)
                    current_ids = {l['id']: l for l in model['layers']}
                    def comparable(value, layers):
                        if isinstance(value, list):return [comparable(v, layers) for v in value]
                        if not isinstance(value, dict):return value
                        return {k: layers[v]['name'] if k == 'layer' and v in layers else comparable(v, layers)
                                for k, v in value.items() if k not in ('id', 'sourceFingerprint')}
                    if comparable(variant, current_ids) == comparable(original_block, original_layers):
                        entity['sharedBlock'] = prior['sharedBlock']
        for child in entity.get('entities', []):restore(child, source)
        host = entity.get('lineWallHost', {})
        for child in host.get('parts', []) + host.get('sources', []):restore(child)
    for entity in model['entities']:restore(entity)
    for block in model.get('blocks', []):
        for entity in block.get('entities', []):restore(entity)
    for block in model.get('sharedBlocks', {}).values():
        for entity in block.get('entities', []):restore(entity)
    def original_ids(value):
        if isinstance(value, list):return [original_ids(v) for v in value]
        if not isinstance(value, dict):return value
        return {k: prior_ids.get(v, v) if k == 'layer' else original_ids(v) for k, v in value.items()}
    for entity in model['entities']:
        if entity.get('sourceFingerprint') == editable_fingerprint(original_ids(entity)):
            entity['sourceFingerprint'] = editable_fingerprint(entity)
    used = set()
    def used_layers(value):
        if isinstance(value, dict):
            if 'layer' in value:used.add(value['layer'])
            for child in value.values():used_layers(child)
        elif isinstance(value, list):
            for child in value:used_layers(child)
    used_layers(model['entities']); used_layers(model.get('sharedBlocks', {})); used_layers(model.get('blocks', []))
    safe_targets = {name.casefold() for key, name in migrations.items() if key not in blocked}
    skipped_targets = {migrations[key].casefold() for key in blocked}
    model['layers'] = [l for l in model['layers'] if l['name'].casefold() not in skipped_targets or
                       l['name'].casefold() in original_names or l['name'].casefold() in safe_targets or l['id'] in used]
    model['layerNameMigrations'] = [r for r in model.get('layerNameMigrations', []) if r['from'].casefold() not in blocked]
    model['legacyLayerSafety'] = original.get('legacyLayerSafety', {})
    return model


def _apply_layer_name_migrations(drawing, model, warnings=None, safety=None, copies=None):
    """Apply browser renames to preserved DXF layouts/definitions only at save.

    Zero-layer BYLAYER children need a context-specific definition when layers
    merge. Original preservation bytes remain in model for undo/recovery.
    Conflicts are planned before mutation and their source layers stay intact.
    """
    changes = {r['from'].casefold(): r['to'] for r in model.get('layerNameMigrations', [])
               if isinstance(r, dict) and isinstance(r.get('from'), str) and isinstance(r.get('to'), str)
               and r['from'] in drawing.layers and r['from'].casefold() != r['to'].casefold()}
    if not changes:
        return
    copies = {} if copies is None else copies
    safety = safety if safety is not None else _layer_migration_safety(drawing, changes, copies)
    blocked = _layer_migration_conflicts(safety, changes)
    if warnings is not None:
        warnings.extend(f'{drawing.layers.get(key).dxf.name} 레이어는 {reason} 그대로 두었습니다' for key, reason in blocked.items())
    changes = {key: name for key, name in changes.items() if key not in blocked}
    old_layers = {l.dxf.name.casefold(): l for l in drawing.layers}
    merged = {}
    reserved = {l.dxf.name.casefold() for l in drawing.layers}
    for key, name in changes.items():
        if name.casefold() in reserved:
            merged[key] = name
        else:
            reserved.add(name.casefold())
            old_layers[key].rename(name)
            old_layers[name.casefold()] = old_layers[key]
    if not merged:
        return
    viewports = [e for e in drawing.entitydb.values() if e.dxftype() == 'VIEWPORT']
    cache, active = {}, set()
    def effective_source(entity, parent):
        key = entity.dxf.get('layer', '0').casefold()
        return parent if key == '0' and parent is not None else old_layers.get(key)
    def restyle(entity, source, parent):
        if source is None:
            return False
        key = source.dxf.name.casefold()
        if key not in merged:
            return False
        target = drawing.layers.get(merged[key])
        changed = False
        if (entity.dxf.get('color', 256) == 256 or entity.dxf.get('color', 256) == 0 and parent is None) and not entity.dxf.hasattr('true_color'):
            if source.dxf.get('true_color') != target.dxf.get('true_color') or abs(source.dxf.color) != abs(target.dxf.color):
                entity.dxf.color = abs(source.dxf.color)
                if source.dxf.hasattr('true_color'):
                    entity.dxf.true_color = source.dxf.true_color
                changed = True
        if (entity.dxf.get('linetype', 'BYLAYER').upper() == 'BYLAYER' or entity.dxf.get('linetype', 'BYLAYER').upper() == 'BYBLOCK' and parent is None) and source.dxf.linetype != target.dxf.linetype:
            entity.dxf.linetype = source.dxf.linetype
            changed = True
        if (entity.dxf.get('lineweight', -1) == -1 or entity.dxf.get('lineweight', -1) == -2 and parent is None) and source.dxf.lineweight != target.dxf.lineweight:
            entity.dxf.lineweight = source.dxf.lineweight
            changed = True
        return changed
    def definition_needed(name, parent, seen=None):
        if name not in drawing.blocks:
            return False
        key = (name.casefold(), parent.dxf.name.casefold() if parent and parent.dxf.name.casefold() in merged else '')
        seen = set() if seen is None else seen
        if key in seen:
            return False
        seen = seen | {key}
        for entity in drawing.blocks.get(name):
            layer = entity.dxf.get('layer', '0').casefold()
            source = effective_source(entity, parent)
            if layer in merged:
                return True
            if layer == '0' and source is not None and source.dxf.name.casefold() in merged:
                target = drawing.layers.get(merged[source.dxf.name.casefold()])
                if any(source.dxf.get(g) != target.dxf.get(g) for g in ('color', 'true_color', 'linetype', 'lineweight')):
                    return True
            if entity.dxftype() == 'INSERT' and definition_needed(entity.dxf.name, source, seen):
                return True
        return False
    def definition(name, parent):
        key = (name.casefold(), parent.dxf.name.casefold() if parent and parent.dxf.name.casefold() in merged else '')
        if key in cache:
            return cache[key]
        if key in active:
            return name
        if not definition_needed(name, parent):
            cache[key] = name
            return name
        active.add(key)
        source = drawing.blocks.get(name)
        prepared = copies[(key[0], key[1] or None)]
        changed = False
        for copy in prepared:
            changed = visit(copy, parent) or changed
        active.remove(key)
        if changed:
            index = len(cache) + 1
            new_name = name + '_A_LAYER_' + str(index)
            while new_name in drawing.blocks:
                index += 1; new_name = name + '_A_LAYER_' + str(index)
            block = drawing.blocks.new(new_name, base_point=source.block.dxf.base_point)
            for copy in prepared:
                block.add_entity(copy)
            cache[key] = new_name
        else:
            cache[key] = name
        return cache[key]
    def visit(entity, parent=None):
        source = effective_source(entity, parent)
        changed = restyle(entity, source, parent)
        layer = entity.dxf.get('layer', '0')
        target = changes.get(layer.casefold())
        if target and layer != target:
            entity.dxf.layer = target
            changed = True
        if entity.dxftype() == 'INSERT':
            name = definition(entity.dxf.name, source)
            if name != entity.dxf.name:
                entity.dxf.name = name
                changed = True
            for attrib in entity.attribs:
                changed = visit(attrib, source) or changed
        return changed
    # Visit layouts before original definitions so contexts see original styles.
    for layout in drawing.layouts:
        for entity in layout:
            visit(entity)
    for block in list(drawing.blocks):
        if block.name.upper().startswith(('*MODEL_SPACE', '*PAPER_SPACE')) or '_A_LAYER_' in block.name:
            continue
        for entity in block:
            visit(entity)
    for viewport in viewports:
        for key, name in merged.items():
            viewport.rename_frozen_layer(old_layers[key].dxf.name, name)
        viewport.frozen_layers = list(dict.fromkeys(viewport.frozen_layers))
    for key in merged:
        drawing.layers.remove(old_layers[key].dxf.name)


def _arc_through(a,m,c):
    """세 점을 지나는 원(중심, 반지름). 일직선이면 None."""
    ax,ay=a;bx,by=m;cx,cy=c;d=2*(ax*(by-cy)+bx*(cy-ay)+cx*(ay-by))
    if abs(d)<1e-12:return None
    ux=((ax*ax+ay*ay)*(by-cy)+(bx*bx+by*by)*(cy-ay)+(cx*cx+cy*cy)*(ay-by))/d
    uy=((ax*ax+ay*ay)*(cx-bx)+(bx*bx+by*by)*(ax-cx)+(cx*cx+cy*cy)*(bx-ax))/d
    return (ux,uy),math.hypot(ax-ux,ay-uy)

def polyline_bulge_vertices(e):
    """ACAD200-408: 폴리선 arcRuns(점 i~j 가 한 호를 나눈 점) → [(x,y,bulge)]. curve-edit.js verifyRun 과 같은 확인을 해서
    점이 하나라도 원에서 벗어나면 그 구간은 직선 정점 그대로 둔다(모양은 화면과 같고 호만 잃지 않는다). 표시가 없으면 None."""
    runs=e.get('arcRuns');ps=e.get('points') or []
    if not isinstance(runs,list) or len(ps)<3:return None
    closed=bool(e.get('closed')) or e.get('type')=='rectangle';n=len(ps)
    at=lambda k:(float(ps[k%n]['x']),float(ps[k%n]['y']))
    good={};last=-1
    for run in sorted((r for r in runs if isinstance(r,(list,tuple)) and len(r)==2),key=lambda r:r[0]):
        i,j=run
        if not (isinstance(i,int) and isinstance(j,int)) or i<last or i<0 or j<=i+1 or j>(n if closed else n-1):continue
        found=_arc_through(at(i),at((i+j)//2),at(j))
        if not found:continue
        (cx,cy),r=found;tol=1e-7*max(1,r);sweep=0;sign=0;ok=r>1e-9
        for k in range(i,j):
            (px,py),(qx,qy)=at(k),at(k+1)
            if abs(math.hypot(qx-cx,qy-cy)-r)>tol:ok=False;break
            d=math.atan2(qy-cy,qx-cx)-math.atan2(py-cy,px-cx);d=(d+math.pi)%(2*math.pi)-math.pi
            s=1 if d>0 else -1 if d<0 else 0
            if s==0 or (sign and s!=sign):ok=False;break
            sign=s;sweep+=d
        if ok and abs(sweep)<2*math.pi-1e-9:good[i]=(j,math.tan(sweep/4));last=j
    if not good:return None
    out=[];k=0
    while k<n:
        x,y=at(k)
        if k in good:
            j,bulge=good[k];out.append((x,y,bulge));k=j
            if closed and k==n:break
            continue
        out.append((x,y,0.0));k+=1
    return out

def spline_fit_points(e):
    """ACAD200-409: SPLINE 명령이 남긴 맞춤점이 아직 점 목록과 맞으면(geometry.js splineMatches) 맞춤점 목록."""
    s=e.get('spline');ps=e.get('points') or []
    if not isinstance(s,dict) or s.get('closed') or not isinstance(s.get('fitPoints'),list) or len(s['fitPoints'])<3:return None
    fit=s['fitPoints']
    if len(ps)!=(len(fit)-1)*16+1:return None
    tol=1e-6*max(1,abs(float(fit[0]['x']))+abs(float(fit[0]['y'])))
    if math.hypot(ps[0]['x']-fit[0]['x'],ps[0]['y']-fit[0]['y'])>tol or math.hypot(ps[-1]['x']-fit[-1]['x'],ps[-1]['y']-fit[-1]['y'])>tol:return None
    return [(float(p['x']),float(p['y'])) for p in fit]

def export_dxf(model,version='R2018',entity_handles=None,timings_ms=None):
    timings={} if timings_ms is None else timings_ms
    started=time.perf_counter()
    try:return _export_dxf(model,version,entity_handles,timings)
    finally:timings['dxf_total']=round((time.perf_counter()-started)*1000,3)

def _export_dxf(model,version,entity_handles,timings):
    build_started=time.perf_counter()
    timings.update(dxf_source_read=0.0,dxf_temp_write=0.0,dxf_verify_read=0.0)
    if model.get('units')!='mm' or not isinstance(model.get('entities'),list):raise ValueError('도면 데이터가 올바르지 않습니다.')
    if version not in ('R2000','R2004','R2007','R2010','R2013','R2018'):raise ValueError('지원 DXF 버전: R2000~R2018')
    warnings=[];special_count=0;unchanged_handles=set();downgrade=None;compatibility=None;saved_handles={};saved_outputs={};replacements={};preservation=model.get('dxfPreservation')
    if isinstance(preservation,dict) and preservation.get('format')=='dxf-zlib-v1':
        try:
            inflater=zlib.decompressobj();raw=inflater.decompress(base64.b64decode(preservation['data']),300_000_001)
            if len(raw)>300_000_000 or inflater.unconsumed_tail:raise ValueError('원본 보존 데이터 한도 초과')
            with tempfile.TemporaryDirectory(prefix='barun_preserve_') as preserve_tmp:
                started=time.perf_counter()
                preserve_path=Path(preserve_tmp)/'source.dxf';preserve_path.write_bytes(raw);doc=ezdxf.readfile(preserve_path)
                timings['dxf_source_read']=round((time.perf_counter()-started)*1000,3)
            # DXF R12 원본에는 LWPOLYLINE·HATCH·MTEXT 를 쓸 수 없다(벽·ROOM2 저장 실패). ezdxf 가 R13/R14 를 읽을 때처럼
            # 가장 가까운 R2000 으로 올려 저장하고, 형식이 바뀐 것을 경고로 알린다.
            upgraded_from=None
            if doc.dxfversion<'AC1015':upgraded_from=doc.dxfversion;doc.dxfversion='AC1015';doc.create_all_arrow_blocks()
            # ACadSharp omitted these REGIONs from its DXF. Add their recovered
            # boundaries to the original owner blocks before preserving INSERTs.
            # Coordinates here are in source units, not normalized millimeters.
            for region in preservation.get('derivedBlockRegions',[]):
                block=doc.blocks.get(region['block'])
                for loop in region['loops']:block.add_lwpolyline(loop,close=True,dxfattribs=region['attributes'])
            if preservation.get('downgraded'):compatibility=doc.dxfversion
            if _DXF_VERSIONS[version]<doc.dxfversion:
                downgrade=compatibility=_DXF_VERSIONS[version];_check_downgrade_source(doc,downgrade)
            changes = {r['from'].casefold(): r['to'] for r in model.get('layerNameMigrations', []) if r['from'] in doc.layers}
            copies = {}
            safety = _layer_migration_safety(doc, changes, copies) if changes else {}
            blocked = _layer_migration_conflicts(safety, changes)
            if blocked:
                warnings.extend(f'{doc.layers.get(key).dxf.name} 레이어는 {reason} 그대로 두었습니다' for key, reason in blocked.items())
                model = _restore_skipped_layer_migrations(model, import_file(raw, '.dxf')['document'], blocked)
            _apply_layer_name_migrations(doc, model, warnings, safety, copies)
            original=set(str(h) for h in preservation.get('handles',[]));by_handle={str(handle):e for e in model['entities'] for handle in e.get('sourceHandles',[]) or [e.get('sourceHandle')] if handle}
            for old in list(doc.modelspace()):
                handle=str(old.dxf.get('handle',''))
                if handle not in original:continue
                current=by_handle.get(handle)
                # Inverse XCLIP written by ezdxf is rejected by AutoCAD. Even when
                # untouched, rewrite it as ordinary clipped references below.
                inverse_clip=bool(current and current.get('clip',{}).get('inverted') and current.get('clip',{}).get('enabled',True))
                if current and not inverse_clip and current.get('sourceFingerprint')==editable_fingerprint(current):unchanged_handles.add(handle)
                else:doc.modelspace().delete_entity(old)
            if upgraded_from:warnings.append(f'원본이 DXF {DXF_RELEASES.get(upgraded_from,upgraded_from)} 형식이라 새 객체를 담을 수 있게 DXF R2000 형식으로 올려 저장했습니다. R12 만 읽는 프로그램에서는 열리지 않을 수 있습니다.')
            elif _DXF_VERSIONS[version]>doc.dxfversion:
                kept_version={code:year[1:] for year,code in _DXF_VERSIONS.items()}.get(doc.dxfversion,doc.dxfversion)
                warnings.append(f'원본 보존을 위해 처음 DXF 버전({kept_version})을 유지했습니다.')
            if not downgrade:warnings.append(f'원본 보존: 수정하지 않은 객체 {len(unchanged_handles)}개와 배치·미지원 객체를 그대로 유지했습니다.')
        except Exception as error:
            if isinstance(error,ValueError) and str(error).startswith('구버전 DXF로 바꿀 수 없는 객체('):raise
            raise ValueError('원본 보존 계층을 확인하지 못해 저장을 중단했습니다. 원본은 변경되지 않았습니다: '+str(error)[:120]) from error
    else:
        coverage=model.get('sourceCoverage') or {}
        # 감사 1: 아무것도 없는 기본 배치(Layout1)로는 막지 않는다 — mm 가 아닌 도면은 보존 없이 mm 로 다시 쓴다.
        # 검토 A7: mm 가 아닌 도면은 원본 보존 없이 다시 쓰므로, 다른 프로그램이 붙인 확장 자료(XDATA·확장 사전)가 있으면 조용히 버리지 않고 멈춘다.
        if coverage.get('extraData'):
            raise ValueError(f"mm 가 아닌 단위의 도면이라 객체 {coverage['extraData']}개에 붙은 확장 자료(XDATA 등)를 지키며 저장할 수 없습니다. 원본은 변경되지 않았습니다. 원본 CAD 에서 mm 로 바꾸거나 BCAD 로 저장하세요.")
        if coverage.get('skipped') or coverage.get('layoutsWithContent',coverage.get('layoutsPreserved')):
            raise ValueError('원본 보존 계층이 없어 미지원 객체 또는 배치를 안전하게 저장할 수 없습니다. 원본은 변경되지 않았습니다.'+(' mm 가 아닌 단위의 도면은 원본 그대로 보존할 수 없으니 원본 CAD 에서 mm 로 바꾸거나 BCAD 로 저장하세요.' if coverage.get('unitScaleToMM',1)!=1 else ''))
        doc=ezdxf.new(version,setup=True)
        # 새 R2000·R2004만 CP949로 저장한다. 원본 보존 경로는 처음 코드페이지를 유지한다.
        if doc.dxfversion in ('AC1015','AC1018'):doc.encoding='cp949'
        # ezdxf 기본 선종류(CENTER 주기 5.08 mm 등)는 acadiso.lin 과 10배쯤 달라, 표준 표(STANDARD_LINETYPES)로 모두 맞춘다.
        for lt_name,(description,pattern) in STANDARD_LINETYPES.items():
            if lt_name in doc.linetypes:
                try:doc.linetypes.remove(lt_name)
                except Exception:continue
            doc.linetypes.add(lt_name,pattern=[sum(abs(v) for v in pattern)]+list(pattern),description=description)
    doc.units=units.MM;doc.header['$MEASUREMENT']=1;doc.header['$LTSCALE']=float(model.get('linetypeScale',1) or 1)
    layer_map={};used_layer_names={l['name'].casefold() for l in model['layers']}|{l.dxf.name.casefold() for l in doc.layers}
    for i,l in enumerate(model['layers']):
        name=l['name'];invalid='<>/\\":;?*|='
        special_chars=sum(ord(c)>0xffff for c in name) if doc.dxfversion in ('AC1015','AC1018') else 0;special_count+=special_chars
        if special_chars or any(c in name for c in invalid):
            name='LAYER_'+str(i)
            if special_chars:
                while name.casefold() in used_layer_names:name+='_'
            used_layer_names.add(name.casefold());warnings.append('DXF 레이어 이름 정리: '+l['name']+' → '+name)
        created=name not in doc.layers
        if created:doc.layers.new(name)
        target=doc.layers.get(name)
        # 색 번호별 CTB가 상대 CAD에서 살아나도록 ACI 레이어는 true_color 대신 색 번호로 내보낸다.
        if l.get('colorMode')=='aci' and 1<=int(l.get('aci') or 0)<=255:target.dxf.color=int(l['aci'])
        else:
            rgb=tuple(bytes.fromhex(l['color'][1:]));same_color=not created and target.rgb==rgb
            target.rgb=rgb
            # 트루컬러와 함께 가장 가까운 색 번호도 적는다. 기본값 7 이 남으면 옛 형식(R2000) 저장에서
            # 트루컬러가 지워질 때 모든 레이어가 흰색이 된다(2026-10-27 설명서 시험).
            # 원본 레이어의 색이 그대로면 원본 색 번호를 지킨다(색 번호 3 + 트루컬러 → 3).
            if not same_color:target.dxf.color=_nearest_downgrade_aci(target.dxf.true_color)
        if compatibility=='AC1015' and not downgrade and target.dxf.hasattr('true_color'):
            if l.get('colorMode')!='aci':target.dxf.color=_nearest_downgrade_aci(target.dxf.true_color)
            target.dxf.discard('true_color')
        target.dxf.lineweight=min([0,5,9,13,15,18,20,25,30,35,40,50,53,60,70,80,90,100,106,120,140,158,200,211],key=lambda n:abs(n-l.get('lineweight',.25)*100))
        if ensure_linetype(doc,l.get('linetype','CONTINUOUS'),warnings):target.dxf.linetype=l.get('linetype','CONTINUOUS')
        if not l.get('visible',True):target.off()
        if l.get('frozen'):target.freeze()
        if l.get('locked'):target.lock()
        target.dxf.plot=int(l.get('plot',True) and name.lower()!='defpoints')
        layer_map[l['id']]=name
    if 'BARUN_TEXT' not in doc.styles:doc.styles.new('BARUN_TEXT',dxfattribs={'font':'malgun.ttf'})
    # 509: 문자 스타일 표가 있으면 STYLE 기록을 표대로 먼저 쓴다(폭 비율·기울기·고정 높이 포함). 그 글꼴과 다른 문자만 _2 변형이 된다.
    style_fonts=apply_text_styles(doc,model.get('textStyles'));style_variants={}
    if isinstance(model.get('scaleList'),list):write_scale_list(doc,model['scaleList'])
    def write_attrib(ref,tag,value,child):
        a={'layer':layer_map.get(child.get('layer'),ref.dxf.layer),'height':float(child.get('height') or 2.5),'rotation':float(child.get('rotation',0) or 0),
           'style':text_style(child),'width':max(.01,float(child.get('widthFactor',1) or 1)),'flags':(1 if child.get('hidden') else 0)|(2 if child.get('attributeConstant') else 0)}
        pos=child.get('position') or {'x':0,'y':0}
        attrib=ref.add_attrib(tag,encode_percent(value),(float(pos['x']),float(pos['y'])),dxfattribs=a)
        from ezdxf.enums import TextEntityAlignment
        align={'center':TextEntityAlignment.CENTER,'right':TextEntityAlignment.RIGHT}.get(child.get('align'))
        if align:attrib.set_placement((float(pos['x']),float(pos['y'])),align=align)
        return attrib
    def text_style(e):
        # 문자 스타일·글꼴을 그대로 돌려 쓴다(예전에는 모든 문자가 BARUN_TEXT·맑은 고딕으로 바뀌었다). 글꼴을 모르면 BARUN_TEXT.
        # 스타일 이름에 처음 나온 글꼴이 그 스타일의 글꼴이 된다(기본 STANDARD 의 txt 글꼴도 바꾼다 — 그대로 두면 한글이 ?로 보인다).
        # 같은 이름인데 글꼴이 다른 문자는 이름_2 같은 변형 스타일로 나눠 글꼴을 잃지 않는다.
        name=str(e.get('textStyle') or '').strip();font=str(e.get('sourceFont') or '').strip();big=str(e.get('sourceBigFont') or '').strip()
        if not name or any(c in name for c in '<>/\\":;?*|='):return 'BARUN_TEXT'
        if not font:return name if name in doc.styles else 'BARUN_TEXT'
        key=name.lower();combo=(font.lower(),big.lower())
        def attrs():
            a={'font':font}
            if big:a['bigfont']=big
            return a
        if key not in style_fonts:
            style_fonts[key]=combo
            if name in doc.styles:
                style=doc.styles.get(name);style.dxf.font=font
                if big:style.dxf.bigfont=big
                else:style.dxf.discard('bigfont')
                return style.dxf.name
            doc.styles.new(name,dxfattribs=attrs());return name
        if style_fonts[key]==combo:return doc.styles.get(name).dxf.name
        variant_key=(key,)+combo
        if variant_key not in style_variants:
            index=2
            while f'{name[:24]}_{index}' in doc.styles:index+=1
            variant=f'{name[:24]}_{index}';doc.styles.new(variant,dxfattribs=attrs());style_variants[variant_key]=variant
        return style_variants[variant_key]
    count=0;image_defs={}
    shared_defs=model.get('sharedBlocks') or {};shared_names={};shared_building=set();used_block_names=set(b.name for b in doc.blocks)
    plain_defs={};group_members={}
    def legacy_block_name(raw):
        nonlocal special_count
        if doc.dxfversion in ('AC1015','AC1018'):
            raw,n=re.subn('[\U00010000-\U0010ffff]','_',str(raw));special_count+=n
        return raw
    def shared_name(key,definition):
        raw=legacy_block_name(definition.get('name') or key or 'BCAD_SHARED');base=''.join(c if c.isalnum() or c in '_-' else '_' for c in str(raw))[:70] or 'BCAD_SHARED';name=base;index=1
        while name in used_block_names:name=f'{base}_{index}';index+=1
        used_block_names.add(name);return name
    def ensure_shared(key,depth=0):
        if key in shared_names:return shared_names[key]
        if key in shared_building or depth>12:raise ValueError('공유 블록 참조가 순환합니다.')
        definition=shared_defs.get(key)
        if not isinstance(definition,dict) or not isinstance(definition.get('entities'),list):raise ValueError('공유 블록 정의가 누락되었습니다: '+str(key))
        shared_building.add(key);name=shared_name(key,definition);shared_names[key]=name
        origin=definition.get('origin') or {'x':0,'y':0};block=doc.blocks.new(name=name,base_point=(float(origin.get('x',0)),float(origin.get('y',0))))
        try:
            for child in definition['entities']:write(child,block,depth+1)
        except Exception:
            shared_names.pop(key,None);raise
        finally:shared_building.discard(key)
        return name
    def write(e,layout,depth=0):
        nonlocal count
        count+=1
        if count>1000000 or depth>12:raise ValueError('도면 객체 수/중첩 한도 초과')
        attrs={'layer':layer_map[e['layer']]};typ=e['type'];p=lambda pt:(float(pt['x']),float(pt['y']))
        # 510: 현재 축척 표현이 없어 바른 CAD 가 잠시 숨긴 주석(annoHidden)은 AutoCAD 에서 영구히 숨지 않게 보이게 쓴다.
        if e.get('hidden') and not e.get('annoHidden'):attrs['invisible']=1
        if e.get('colorMode')=='byblock':attrs['color']=0
        if e.get('colorMode')=='aci' and 1<=int(e.get('aci') or 0)<=255:attrs['color']=int(e['aci'])
        elif e.get('color'):attrs['true_color']=int(e['color'][1:],16)
        if compatibility=='AC1015' and not downgrade and 'true_color' in attrs:attrs['color']=_nearest_downgrade_aci(attrs.pop('true_color'))
        if e.get('linetype') and ensure_linetype(doc,e['linetype'],warnings,allow_byblock=True):attrs['linetype']='BYBLOCK' if str(e['linetype']).upper()=='BYBLOCK' else e['linetype']
        if float(e.get('linetypeScale',1) or 1)>0:attrs['ltscale']=float(e.get('linetypeScale',1) or 1)
        if e.get('lineweightMode')=='byblock':attrs['lineweight']=-2
        elif e.get('lineweight') is not None:attrs['lineweight']=min([0,5,9,13,15,18,20,25,30,35,40,50,53,60,70,80,90,100,106,120,140,158,200,211],key=lambda n:abs(n-e['lineweight']*100))
        # 출력 농도(H24)는 AutoCAD 에서 객체 투명도로 보이게 내보낸다(바른 CAD 로 다시 열면 BARUN_CAD_V2 원본으로 농도가 돌아온다).
        # 가져올 때는 투명도를 농도로 바꾸지 않는다: AutoCAD 는 기본으로 투명도를 출력하지 않아 색 평면도 해치가 흐려질 수 있다.
        density=e.get('plotDensity')
        if isinstance(density,(int,float)) and 0<=density<100:attrs['transparency']=colors.float2transparency(1-float(density)/100)
        if typ=='image':
            # DXF IMAGE references are external file links.  Embedded data URLs
            # remain in BCAD, but cannot be represented by the DXF IMAGEDEF form.
            image_path=e.get('path')
            if not isinstance(image_path,str) or image_path.startswith('data:'):
                warnings.append('IMAGE 개체는 내장 데이터라 DXF IMAGEDEF로 내보낼 수 없습니다. BCAD에는 유지됩니다.')
                return None
            pixel_width=e.get('pixelWidth')
            pixel_height=e.get('pixelHeight')
            try:pixel_width=int(pixel_width);pixel_height=int(pixel_height)
            except (TypeError,ValueError):pixel_width=pixel_height=0
            if pixel_width<=0 or pixel_height<=0:
                warnings.append('IMAGE 개체의 픽셀 크기가 없어 DXF IMAGEDEF를 건너뜁니다. BCAD에는 유지됩니다.')
                return None
            position=e.get('position') or {'x':0,'y':0}
            width=float(e.get('width') or 0);height=float(e.get('height') or 0)
            if width<=0 or height<=0:
                warnings.append('IMAGE 개체의 도면 크기가 없어 DXF IMAGE을 건너뜁니다. BCAD에는 유지됩니다.')
                return None
            if image_path not in image_defs:image_defs[image_path]=doc.add_image_def(image_path,(pixel_width,pixel_height),name=image_path)
            image_def=image_defs[image_path]
            image=layout.add_image(image_def,p(position),(width,height),rotation=float(e.get('rotation',0) or 0),dxfattribs=attrs)
            image.dxf.fade=max(0,min(90,int(e.get('fade',50))))
            return image
        if typ=='point':return layout.add_point(p(e['position']),dxfattribs=attrs)
        if typ=='line':return layout.add_line(p(e['points'][0]),p(e['points'][1]),dxfattribs=attrs)
        if typ in ('polyline','rectangle'):
            fit=spline_fit_points(e) if typ=='polyline' and not e.get('constantWidth') else None
            if fit:return layout.add_spline(fit_points=fit,degree=int((e.get('spline') or {}).get('degree') or 3),dxfattribs=attrs)   # SPLINE 맞춤점 그대로
            if e.get('constantWidth',0)>0:attrs['const_width']=float(e['constantWidth'])
            bulged=polyline_bulge_vertices(e)   # 호 구간은 bulge 정점 하나로(AutoCAD LWPOLYLINE 과 같음)
            if bulged:return layout.add_lwpolyline([(x,y,0,0,k) for x,y,k in bulged],format='xyseb',close=e.get('closed') or typ=='rectangle',dxfattribs=attrs)
            return layout.add_lwpolyline([p(v) for v in e['points']],close=e.get('closed') or typ=='rectangle',dxfattribs=attrs)
        if typ=='circle':return layout.add_circle(p(e['center']),e['radius'],dxfattribs=attrs)
        if typ=='ellipse':return layout.add_ellipse(center=p(e['center']),major_axis=p(e['majorAxis']),ratio=e['ratio'],start_param=e.get('startParam',0),end_param=e.get('endParam',math.tau),dxfattribs=attrs)
        if typ=='arc':return layout.add_arc(p(e['center']),e['radius'],e['startAngle'],e['endAngle'],dxfattribs=attrs)
        if typ=='text' and isinstance(e.get('attdef'),dict) and str(e['attdef'].get('tag','')).strip():
            d_=e['attdef'];flags=(1 if d_.get('invisible') else 0)|(2 if d_.get('constant') else 0)|(4 if d_.get('verify') else 0)|(8 if d_.get('preset') else 0)
            tag=''.join(c if c.isalnum() or c=='_' else '_' for c in str(d_['tag']))
            attdef=layout.add_attdef(tag,p(e['position']),str(d_.get('default','') or ''),dxfattribs={**attrs,'height':e['height'],'rotation':e.get('rotation',0),'style':text_style(e),'flags':flags,'prompt':str(d_.get('prompt') or tag)})
            attdef.dxf.width=max(.01,float(e.get('widthFactor',1) or 1))
            from ezdxf.enums import TextEntityAlignment
            alignment={'center':TextEntityAlignment.CENTER,'right':TextEntityAlignment.RIGHT}.get(e.get('align'),TextEntityAlignment.LEFT)
            attdef.set_placement(p(e['position']),align=alignment)
            return attdef
        if typ=='text':
            a={**attrs,'height':e['height'],'rotation':e.get('rotation',0),'style':text_style(e),'width':max(.01,float(e.get('widthFactor',1) or 1))}
            # 501: 가져온 MTEXT 서식 원문이 있고 문자를 고치지 않았으면 서식째 MTEXT 로 돌려준다.
            mtext_source=e.get('codeKind')=='mtext' and isinstance(e.get('codeText'),str) and e.get('codePlain')==e.get('text') and e.get('codeWidth',1)==a['width']
            mtext_width_changed=e.get('codeKind')=='mtext' and e.get('codeWidth',1)!=a['width']
            if '\n' in e['text'] or e.get('backgroundMask') or mtext_source or mtext_width_changed:
                attachment={'left':1,'center':2,'right':3}.get(e.get('align'),1)
                # 위쪽 부착점(1~3)의 insert 는 첫 줄 글자 윗선이다: 가져올 때 내린 높이만큼 올려 써야 왕복해도 제자리다.
                r=math.radians(float(e.get('rotation',0) or 0));h=float(e['height'])
                top=p({'x':e['position']['x']-math.sin(r)*h,'y':e['position']['y']+math.cos(r)*h})
                # 502: 평문은 \ { } 를 이스케이프해야 AutoCAD 에서 글자로 보인다(C:\도면\A동, {가}).
                mtext=layout.add_mtext(source_code_text(e,'mtext',float(doc.styles.get(a['style']).dxf.get('width',1) or 1)),dxfattribs={**attrs,'char_height':e['height'],'rotation':e.get('rotation',0),'insert':top,'style':a['style'],'attachment_point':attachment})
                if isinstance(e.get('lineSpacing'),(int,float)) and e['lineSpacing']>0:mtext.dxf.line_spacing_factor=max(.25,min(4.0,float(e['lineSpacing'])*3/5))
                if e.get('backgroundMask'):mtext.set_bg_color('canvas',scale=max(1,min(5,1+2*float(e.get('maskPadding',e['height']*.25))/e['height'])))
                return mtext
            # 505: Ø·°·± 는 %%c·%%d·%%p 로(SHX 글꼴에서도 보이게), 가져온 %%u 밑줄 원문은 고치지 않았으면 그대로.
            text=layout.add_text(source_code_text(e,'text'),dxfattribs=a)
            justify=e.get('justify')
            if justify in TEXT_JUSTIFY_CODES and justify!='L' and isinstance(e.get('alignPoint'),dict):
                # 504: 자리맞추기(72/73)와 맞춤점(11)을 그대로 쓴다. 시작점(10)은 AutoCAD 가 글꼴로 다시 계산한다(어림값을 넣어 둔다).
                halign,valign=TEXT_JUSTIFY_CODES[justify]
                if justify in ('A','F'):
                    if not isinstance(e.get('fitTo'),dict):justify=None
                    else:text.dxf.insert=p(e['alignPoint']);text.dxf.align_point=p(e['fitTo'])
                else:
                    width=text_units(e['text'])*float(e['height'])*float(e.get('widthFactor',1) or 1)
                    shift={'center':width/2,'right':width}.get(e.get('align'),0);r=math.radians(float(e.get('rotation',0) or 0))
                    text.dxf.insert=p({'x':e['position']['x']-math.cos(r)*shift,'y':e['position']['y']-math.sin(r)*shift})
                    text.dxf.align_point=p(e['alignPoint'])
                if justify:text.dxf.halign=halign;text.dxf.valign=valign;return text
            from ezdxf.enums import TextEntityAlignment
            alignment={'center':TextEntityAlignment.CENTER,'right':TextEntityAlignment.RIGHT}.get(e.get('align'),TextEntityAlignment.LEFT)
            text.set_placement(p(e['position']),align=alignment);return text
        if typ=='hatch' and e.get('wipeout'):
            # 가리기(ACAD200-411): AutoCAD WIPEOUT 으로. 테두리 표시(WIPEOUTFRAME)는 도면 전체 값이라 frame 0 이면 숨김으로 둔다.
            wipe=layout.add_wipeout([p(v) for v in e['points']],dxfattribs=attrs)
            if e.get('frame')==0:doc.set_wipeout_variables(frame=0)
            return wipe
        if typ=='hatch':
            hatch=layout.add_hatch(color=int(attrs.get('color',256)),dxfattribs=attrs)   # ezdxf 기본 color=7 이 dxfattribs 를 덮으므로 BYLAYER(256)·ACI 를 명시한다
            lines=e.get('patternLines')
            if not e.get('solid') and isinstance(lines,list) and lines:
                # 표준 무늬(AR-CONC 등): 무늬 줄은 이미 축척·각도·기준점이 적용된 도면 좌표다. 이름·축척·각도는 정보로 남기고 줄을 그대로 쓴다.
                name=str(e.get('patternName') or 'BARUN_PATTERN')[:31]
                # 무늬 종류(0 사용자 정의 _USER · 1 표준 · 2 사용자 무늬 파일)·이중선·해치 스타일을 가져온 값 그대로 돌려준다(AutoCAD HATCHEDIT 가 무늬를 찾게).
                ptype=int(e.get('patternType',1)) if str(e.get('patternType','1')).lstrip('-').isdigit() and int(e.get('patternType',1)) in (0,1,2) else 1
                hstyle=int(e.get('hatchStyle',1)) if str(e.get('hatchStyle','1')).isdigit() and int(e.get('hatchStyle',1)) in (0,1,2) else 1
                hatch.set_pattern_fill(name,color=int(attrs.get('color',256)),angle=float(e.get('angle',0) or 0),scale=float(e.get('patternScale',1) or 1),double=1 if e.get('patternDouble') else 0,style=hstyle,pattern_type=ptype,definition=[[0,(0,0),(0,1),[]]])
                hatch.set_pattern_definition([[float(l['angle']),(float(l['base']['x']),float(l['base']['y'])),(float(l['offset']['x']),float(l['offset']['y'])),[float(d) for d in l.get('dashes') or []]] for l in lines],factor=1,angle=0)
            elif not e.get('solid'):
                spacing=e.get('spacing',100)
                o=e.get('origin');base=(0,0)
                if isinstance(o,dict) and all(isinstance(o.get(k),(int,float)) for k in ('x','y')):
                    r=-math.radians(e.get('angle',0) or 0);base=(o['x']*math.cos(r)-o['y']*math.sin(r),o['x']*math.sin(r)+o['y']*math.cos(r))  # HP 해치 기준점(무늬 회전 전 좌표)
                definition=[[0,base,(0,spacing),[]]]
                if e.get('pattern')=='cross':definition.append([90,base,(spacing,0),[]])
                hatch.set_pattern_fill('BARUN_CROSS' if e.get('pattern')=='cross' else 'BARUN_LINES',color=int(attrs.get('color',256)),angle=e.get('angle',0) or 0,scale=1,definition=definition)
            rings=[e['points'],*e.get('loops',[])]
            # 한 해치 = HATCH 하나 + 경계 루프 여럿(영역마다 바깥 경계 1, 구멍 0). 한 번의 HATCH 로 찍은 칸들이 AutoCAD 에서도 객체 하나로 열린다.
            for loop,flag in zip(rings,hatch_loop_flags(rings)):hatch.paths.add_polyline_path([p(v) for v in loop],is_closed=True,flags=flag)
            return hatch
        if typ=='dimension':
            a,b,base=map(p,e['points'][:3]);style_scale=e.get('scale',1);h=e.get('textHeight',150)*style_scale;override={'dimtxt':h,'dimasz':e.get('arrowSize',e.get('textHeight',150)*.4)*style_scale,'dimexo':e.get('extensionOffset',e.get('textHeight',150)*.15)*style_scale,'dimexe':e.get('extensionOvershoot',e.get('textHeight',150)*.4)*style_scale,'dimgap':e.get('textGap',e.get('textHeight',150)*.2)*style_scale,'dimtad':1,'dimdec':e.get('precision',2),'dimadec':e.get('precision',2),'dimlfac':e.get('measurementScale',1),'dimpost':e.get('textTemplate','<>'),'dimtxsty':'BARUN_TEXT'}
            mode=e.get('mode','aligned')
            # 치수 끝 모양을 화면과 같게(설정 없는 치수는 건축용 사선). 채운 화살표는 AutoCAD 기본 블록('')이라 넣지 않는다.
            arrow_block={'tick':'ARCHTICK','architectural-tick':'ARCHTICK','oblique':'OBLIQUE','open':'OPEN','closed':'CLOSEDBLANK','dot':'DOT','closed-filled':''}.get(e.get('arrowType') or 'tick')
            if arrow_block is not None:override['dimblk']=arrow_block  # 채운 화살표('')도 명시: 바른 치수 스타일 기본이 사선

            if mode=='arcLength':
                if len(e['points'])<4:raise ValueError('호 길이 치수에는 중심·시작·끝·위치점이 필요합니다.')
                override['dimarcsym']=0
                dim=layout.add_arc_dim_3p(base=p(e['points'][3]),center=a,p1=b,p2=base,override=override,dxfattribs=attrs)
                native=dim.dimension
                native.dxf.is_partial=int(bool(e.get('arcPartial')))
                native.dxf.start_angle=math.atan2(b[1]-a[1],b[0]-a[0])
                native.dxf.end_angle=math.atan2(base[1]-a[1],base[0]-a[0])
                native.dxf.has_leader=int(bool(e.get('arcLeader')))
                if e.get('leaderPoint'):native.dxf.leader_point1=p(e['leaderPoint'])
                native.dxf.leader_point2=p(e['points'][3])
            elif mode=='jogged':
                if len(e['points'])<5:raise ValueError('꺾인 반지름 치수에는 중심·원호점·위치·대체 중심·꺾기점이 필요합니다.')
                if doc.dxfversion<'AC1018':raise ValueError('꺾인 반지름 치수는 DXF 2004 이상으로 저장하세요.')
                native=layout.new_entity('LARGE_RADIAL_DIMENSION',dxfattribs={**attrs,'dimtype':36,'dimstyle':'Standard',
                    'defpoint':a,'chord_point':b,'text_midpoint':p(e.get('textPosition') or e['points'][2]),
                    'override_center':p(e['points'][3]),'jog_point':p(e['points'][4]),'unknown2':math.pi/4})
                from ezdxf.entities import DimStyleOverride
                dim=DimStyleOverride(native,override=override)
            elif mode=='angular':dim=layout.add_angular_dim_3p(base=p(e['points'][3]),center=a,p1=b,p2=base,override=override,dxfattribs=attrs)
            elif mode in ('ordinateX','ordinateY'):
                rotation=e.get('axisAngle',0 if mode=='ordinateX' else 90)-(90 if mode=='ordinateY' else 0);r=-math.radians(rotation);ca,sa=math.cos(r),math.sin(r)
                local=lambda v:(v[0]*ca-v[1]*sa,v[0]*sa+v[1]*ca)
                feature=local((b[0]-a[0],b[1]-a[1]));offset=local((base[0]-b[0],base[1]-b[1]))
                dim=layout.add_ordinate_dim(feature_location=(feature[0]+a[0],feature[1]+a[1]),offset=offset,dtype=1 if mode=='ordinateX' else 0,origin=a,rotation=rotation,override=override,dxfattribs=attrs)
                # ezdxf rotates its endpoint around WCS (0,0), including origin.
                # Definition point 3 is the original WCS leader endpoint.
                dim.dimension.dxf.defpoint3=base
            elif mode in ('horizontal','vertical'):dim=layout.add_linear_dim(base=base,p1=a,p2=b,angle=e.get('axisAngle',0 if mode=='horizontal' else 90),override=override,dxfattribs=attrs)
            elif mode in ('radius','diameter'):
                if mode=='radius':dim=layout.add_radius_dim(center=a,mpoint=b,override=override,dxfattribs=attrs)
                else:dim=layout.add_diameter_dim(center=a,mpoint=b,override=override,dxfattribs=attrs)
            else:
                dx,dy=b[0]-a[0],b[1]-a[1];length=math.hypot(dx,dy);distance=((base[0]-a[0])*(-dy)+(base[1]-a[1])*dx)/length
                dim=layout.add_aligned_dim(p1=a,p2=b,distance=distance,override=override,dxfattribs=attrs)
            if e.get('text'):dim.dimension.dxf.text=e['text']

            if e.get('textRotation') is not None:dim.dimension.dxf.text_rotation=float(e['textRotation'])
            if mode=='jogged':
                # ezdxf has the native entity but no jogged-radius renderer.
                dim.commit();block=doc.blocks.new_anonymous_block(type_char='D');dim.dimension.dxf.geometry=block.name
            else:
                dim.render();block=doc.blocks.get(dim.dimension.dxf.geometry)
            parts=e.get('dimensionDisplayParts')
            if parts is None and mode=='jogged':parts=_jogged_dimension_display(e)
            if parts is not None:
                for child in list(block):block.delete_entity(child)
                for part in parts:
                    display={**part,'layer':e['layer']}
                    write(display,block)
            elif mode=='arcLength' and e.get('arcLeader') and e.get('leaderPoint'):
                block.add_line(p(e['leaderPoint']),p(e['points'][3]),dxfattribs={'layer':'0','color':0})
            _set_dimension_breaks(dim.dimension,e.get('breaks'))
            if e.get('breaks'):
                notice='치수 끊기는 끊긴 표시 블록과 바른 CAD XData로 보존합니다. AutoCAD의 재생성·치수 편집 뒤 끊김 유지는 아직 지원하지 않습니다.'
                if notice not in warnings:warnings.append(notice)
            return dim.dimension
        if typ=='wall':
            a,b=e['points'];dx=b['x']-a['x'];dy=b['y']-a['y'];length=math.hypot(dx,dy);nx=-dy/length*e['thickness']/2;ny=dx/length*e['thickness']/2
            gaps=sorted(e.get('openings',[])+list(e.get('openingLinks',{}).values()));ranges=[];start=0
            for lo,hi in gaps:
                if lo>start:ranges.append((start,lo))
                start=max(start,hi)
            if start<1:ranges.append((start,1))
            children=[]
            for s,t in ranges:
                x1=a['x']+dx*s;y1=a['y']+dy*s;x2=a['x']+dx*t;y2=a['y']+dy*t
                joins=e.get('joins',{});js=joins.get('start') if s==0 else None;je=joins.get('end') if t==1 else None
                pts=[js[0] if js else {'x':x1+nx,'y':y1+ny},je[0] if je else {'x':x2+nx,'y':y2+ny},je[1] if je else {'x':x2-nx,'y':y2-ny},js[1] if js else {'x':x1-nx,'y':y1-ny}]
                for i in range(4):
                    if (i==1 and je) or (i==3 and js):continue
                    children.append({'type':'line','layer':e['layer'],'points':[pts[i],pts[(i+1)%4]]})
            e={**e,'entities':children};typ='block'
        if typ=='block':
            if e.get('sharedBlock'):
                name=ensure_shared(e['sharedBlock'],depth+1);block=doc.blocks.get(name);position=e.get('position') or {'x':0,'y':0};scale=float(e.get('scale',1) or 1)
                xscale=float(e.get('scaleX') or scale);yscale=float(e.get('scaleY') or scale)
                # mirror flips local X before the rotation — exactly a negative X scale on the INSERT.
                ref=layout.add_blockref(name,p(position),dxfattribs={**attrs,'xscale':-xscale if e.get('mirror') else xscale,'yscale':yscale,'rotation':float(e.get('rotation',0) or 0)})
                for child in e.get('entities',[]):
                    if not (isinstance(child,dict) and child.get('attributeTag') is not None and child.get('type')=='text'):write(child,layout,depth+1)
            else:
                # 605·807: 같은 이름·같은 모양(기준점 기준)의 일반 블록은 정의 하나를 같이 쓴다.
                # 예전에는 삽입본마다 정의를 새로 만들어 블록 정의가 3만 2,767개를 넘으면 DXF 쓰기가 실패했다.
                # 521: 속성 글자(attributeTag 문자)는 정의에 넣지 않고 삽입마다 ATTRIB 로 쓴다 — 값만 다른 삽입도 정의 하나를 같이 쓴다.
                plain={**e,'entities':[child for child in e.get('entities') or [] if not (isinstance(child,dict) and child.get('attributeTag') is not None and child.get('type')=='text')]}
                signature=plain_block_signature(plain)
                if signature and signature[0] in plain_defs:
                    name=plain_defs[signature[0]];block=doc.blocks.get(name)
                    ref=layout.add_blockref(name,p(signature[1]),dxfattribs=attrs)
                else:
                    raw_name=legacy_block_name(e.get('name') or 'BCAD');base=''.join(c if c.isalnum() or c in '_-' else '_' for c in raw_name)[:80]+'_'+str(count);name=base;index=1
                    while name in used_block_names:name=f'{base}_{index}';index+=1
                    used_block_names.add(name);block=doc.blocks.new(name=name)
                    if signature:
                        plain_defs[signature[0]]=name
                        for child in signature[2]:write(child,block,depth+1)
                        ref=layout.add_blockref(name,p(signature[1]),dxfattribs=attrs)
                    else:
                        for child in plain['entities']:write(child,block,depth+1)
                        ref=layout.add_blockref(name,(0,0),dxfattribs=attrs)
            if e.get('clip'):
                from ezdxf.xclip import XClip
                if e['clip'].get('inverted') and e['clip'].get('enabled',True):
                    # ezdxf's experimental inverse writer creates DXF AutoCAD cannot open.
                    # Partition the visible region into ordinary clipped references instead.
                    from ezdxf import bbox
                    from shapely.geometry import Polygon,box
                    from shapely.ops import triangulate
                    # Measure the unclipped definition. Measuring `ref` after attaching
                    # the inverse boundary only returns the mask area in ezdxf, so the
                    # outside pieces disappear and a one-reference DXF is produced.
                    bounds=bbox.extents(block);mask=Polygon([p(v) for v in e['clip']['points']])
                    if not mask.is_valid:raise ValueError('반전 클립 경계가 교차합니다.')
                    if bounds.has_data:
                        margin=max(bounds.size.x,bounds.size.y,1)*.1
                        outer=box(min(bounds.extmin.x,mask.bounds[0])-margin,min(bounds.extmin.y,mask.bounds[1])-margin,max(bounds.extmax.x,mask.bounds[2])+margin,max(bounds.extmax.y,mask.bounds[3])+margin)
                        visible=outer.difference(mask);layout.delete_entity(ref)
                        for triangle in triangulate(visible):
                            intersection=triangle.intersection(visible)
                            pieces=list(intersection.geoms) if hasattr(intersection,'geoms') else [intersection]
                            for piece in pieces:
                                if piece.geom_type!='Polygon' or piece.area<1e-10:continue
                                if piece.interiors:raise ValueError('반전 클립 DXF 변환에 실패했습니다. BCAD로 저장하세요.')
                                part=layout.add_blockref(name,(0,0),dxfattribs=attrs)
                                XClip(part).set_wcs_clipping_path(list(piece.exterior.coords)[:-1])
                        warnings.append('반전 XCLIP은 외부 CAD 호환을 위해 여러 일반 클립 블록으로 내보냈습니다. BCAD 원본에는 반전 편집 상태가 유지됩니다.')
                        return
                clip=XClip(ref);clip.set_wcs_clipping_path([p(v) for v in e['clip']['points']])
                if not e['clip'].get('enabled',True):clip.disable_clipping()
            # 521: 속성 글자(attributeTag 문자)가 있으면 그 위치·높이·각도·정렬·보임 그대로 ATTRIB 로 쓴다(예전: 모두 숨김·높이 100·삽입점).
            # 611: 표시 글자가 없고 블록 정의에 그 태그의 ATTDEF 가 있으면 정의의 자리·모양으로 붙인다(add_auto_attribs).
            shown={c.get('attributeTag'):c for c in e.get('entities',[]) if isinstance(c,dict) and c.get('type')=='text' and c.get('attributeTag') is not None}
            defined={a.dxf.tag.upper() for a in block.attdefs()} if block is not None else set()
            auto={}
            for key,value in e.get('attributes',{}).items():
                if isinstance(value,(str,int,float,bool)):
                    tag=''.join(c if c.isalnum() or c=='_' else '_' for c in key)
                    if not tag:continue
                    child=shown.pop(key,None)
                    if child is not None:write_attrib(ref,tag,str(value),child)
                    elif tag.upper() in defined:auto[tag]=encode_percent(str(value))
                    else:ref.add_attrib(tag,encode_percent(str(value)),p(e.get('position') or {'x':0,'y':0}),dxfattribs={'height':100,'flags':1,'layer':attrs['layer']})
            if auto:ref.add_auto_attribs(auto)
            for key,child in shown.items():   # 값 지도에 없는 속성 글자도 잃지 않는다
                tag=''.join(c if c.isalnum() or c=='_' else '_' for c in str(key))
                if tag:write_attrib(ref,tag,str(child.get('text','')),child)
            return ref
        raise ValueError('DXF로 내보낼 수 없는 형식: '+typ)
    native_extension=_native_extension_filter(model);extension_entities=[];extension_handles={}
    for e in model['entities']:
        is_extension=native_extension(e)
        if is_extension:extension_entities.append(e)
        if str(e.get('sourceHandle','')) in unchanged_handles:
            if is_extension:extension_handles[e['id']]=str(e['sourceHandle'])
            continue
        if compatibility:previous_length=len(doc.modelspace())
        written=write(e,doc.modelspace())
        if is_extension and written is not None:extension_handles[e['id']]=written.dxf.handle
        if written is not None and isinstance(e.get('group'),str) and e['group'].strip():group_members.setdefault(e['group'].strip(),[]).append(written)
        if compatibility:
            if written is not None:saved_handles[e['id']]=written.dxf.handle
            if written is None or e.get('sharedBlock') and e.get('entities'):
                handles=[part.dxf.handle for part in list(doc.modelspace())[previous_length:]]
                if handles:saved_outputs[e['id']]=handles;saved_handles[e['id']]=handles[0]
        if entity_handles is not None:
            if written is None:raise ValueError('리습 실행 전 반전 클립을 일반 클립으로 변경하세요.')
            entity_handles[e['id']]=written.dxf.handle
    # 621: 그룹(객체의 group 이름)을 DXF 그룹(ACAD_GROUP)으로 남긴다. 다시 열면 같은 이름으로 되살아난다.
    for group_name,members in group_members.items():
        try:
            safe=''.join(c if c.isalnum() or c in '_-' else '_' for c in group_name)[:64] or 'GROUP'
            if safe in doc.groups:doc.groups.delete(safe)
            doc.groups.new(safe).extend(members)
        except Exception as error:warnings.append(f'그룹 {group_name} 을 DXF 그룹으로 쓰지 못했습니다: {error}')
    if downgrade:
        replacements.update(_downgrade_document(doc,downgrade,warnings))
        marker=doc.rootdict.get('BARUN_CAD_DXF_DOWNGRADE') or doc.rootdict.add_xrecord('BARUN_CAD_DXF_DOWNGRADE');marker.reset([(1,downgrade)])
    # 원본에서 넘어온 옛 바른 CAD 기록(BARUN_CAD_V2)은 지운다. 남겨 두면 저장할 때마다 파일 안에 겹겹이 쌓인다.
    for record_name in ('BARUN_CAD_V2',NATIVE_EXTENSION_RECORD):
        try:del doc.rootdict[record_name]
        except KeyError:pass
    def read_result(path):
        started=time.perf_counter()
        content=path.read_bytes()
        timings['dxf_read_bytes']=round((time.perf_counter()-started)*1000,3)
        return content,warnings
    def save(drawing,path):
        started=time.perf_counter()
        try:write_drawing(drawing,path)
        finally:timings['dxf_temp_write']+=round((time.perf_counter()-started)*1000,3)
    def write_drawing(drawing,path):
        if compatibility:
            _clean_downgrade_objects(drawing,compatibility)
            export_classes=drawing.classes.export_dxf
            def compatible_classes(writer):
                for key,cls in list(drawing.classes.classes.items()):
                    if cls.dxf.name.upper() in _DOWNGRADE_DROP and _downgrade_min(cls.dxf.name.upper())>compatibility:del drawing.classes.classes[key]
                    elif cls.dxf.name.upper() in ('MULTILEADER','MLEADER','ACAD_TABLE','MESH','HELIX') and _downgrade_min(cls.dxf.name.upper())>compatibility:del drawing.classes.classes[key]
                export_classes(writer)
            drawing.classes.export_dxf=compatible_classes
            try:save_raw(drawing,path)
            finally:drawing.classes.export_dxf=export_classes
            check_downgrade_bytes(path.read_bytes(),compatibility)
        else:save_raw(drawing,path)
    def save_raw(drawing,path):
        nonlocal special_count
        _own_seqends(drawing)
        if drawing.dxfversion not in ('AC1015','AC1018'):drawing.saveas(path);return
        def replace_char(match):
            nonlocal special_count
            ch=match.group()
            if ord(ch)>0xffff:special_count+=1;return '?'
            try:ch.encode(drawing.encoding);return ch
            except UnicodeEncodeError:return '\\U+%04X'%ord(ch)
        # 쓰는 단계에서만 바꾼다. 내장 원본 기록은 유지하고 BMP 문자는 네 자리 이스케이프로 보존한다.
        with path.open('w',encoding=drawing.encoding,errors='dxfreplace') as stream:
            class LegacyWriter:
                def write(self,text):return stream.write(text if text.isascii() else _NON_ASCII.sub(replace_char,text))
            drawing.write(LegacyWriter())
        if special_count:warnings.append(f'2000·2004 DXF 에는 일부 특수 문자({special_count}자)를 담을 수 없습니다. 2007 이상으로 저장하세요.');special_count=0
    model_json=json.dumps(_strip_dimension_display_cache(model),ensure_ascii=False,separators=(',',':'))
    timings['dxf_build']=round((time.perf_counter()-build_started)*1000,3)
    with tempfile.TemporaryDirectory(prefix='barun_dxf_') as tmp:
        path=Path(tmp)/'drawing.dxf'
        # 전체 원본 기록은 읽기 한도 20MB 이내에서만 쓴다. 큰 도면은 벽·도면 묶음만 별도 기록한다.
        # 전체 DXF 재읽기·전체 지문·두 번째 쓰기는 건너뛰고 기존 한 번 저장 경로를 유지한다.
        if len(model_json.encode())>NATIVE_FULL_LIMIT:
            _write_native_extensions(doc,model,extension_entities,extension_handles,layer_map)
            save(doc,path)
            return read_result(path)
        save(doc,path)
        if compatibility:
            # 원본 AC1032 복사본·옛 핸들·지문을 넣으면 다음 저장에서 다시 살아난다. 강등 바이트로 기록을 새로 만든다.
            started=time.perf_counter()
            fresh=import_file_path(path,'.dxf')['document']
            timings['dxf_verify_read']+=round((time.perf_counter()-started)*1000,3)
            model=_refresh_downgrade_model(model_json,fresh,saved_handles,saved_outputs,replacements,layer_map)
            del fresh
            model_json=json.dumps(model,ensure_ascii=False,separators=(',',':'))
            if len(model_json.encode())>19_000_000:return read_result(path)
        started=time.perf_counter()
        normalized=ezdxf.readfile(path)
        timings['dxf_verify_read']+=round((time.perf_counter()-started)*1000,3)
        # Preserve local parametric wall/dimension and unused block definitions only
        # while the external DXF geometry still matches the written document.
        started=time.perf_counter()
        payload_json='{"fingerprint":'+json.dumps(geometry_fingerprint(normalized))+',"fingerprintVersion":2,"document":'+model_json+'}'
        packed=base64.b64encode(zlib.compress(payload_json.encode())).decode('ascii')
        try:del normalized.rootdict['BARUN_CAD_V2']
        except KeyError:pass
        record=normalized.rootdict.add_xrecord('BARUN_CAD_V2');record.reset([(1,packed[i:i+240]) for i in range(0,len(packed),240)])
        timings['dxf_metadata']=round((time.perf_counter()-started)*1000,3)
        save(normalized,path)
        return read_result(path)
