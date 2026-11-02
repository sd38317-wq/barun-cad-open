"""Pillow-only raster previews; original geometry never enters the preview pack."""
import io
import math
from functools import lru_cache
from pathlib import Path


def pillow():
    try:
        from PIL import Image, ImageDraw, ImageFont
    except ImportError as error:
        raise ValueError('Pillow가 없습니다. 미리보기 묶음을 만들려면 Pillow가 필요합니다.') from error
    return Image, ImageDraw, ImageFont


@lru_cache(maxsize=128)
def font(size):
    _, _, ImageFont = pillow()
    # Windows 글꼴이 먼저(윈도우 미리보기 그대로), 맥은 기본 한글 TrueType 으로 대신한다.
    for name in ('C:/Windows/Fonts/malgun.ttf', 'C:/Windows/Fonts/gulim.ttc',
                 '/System/Library/Fonts/Supplemental/AppleGothic.ttf', '/System/Library/Fonts/AppleSDGothicNeo.ttc'):
        if Path(name).is_file():
            return ImageFont.truetype(name, max(6, int(size)))
    raise ValueError("'바른' 표식을 그릴 한글 글꼴이 없습니다.")


def preview_ink(color):
    """cad-asset-preview.js previewInk 와 같은 규칙: 검은 바탕에 묻히는 색(ACI 7·검정)은 흰색."""
    color = str(color or '').lower()[:7]
    if len(color) != 7 or not color.startswith('#'):
        return '#ffffff'
    try:
        r, g, b = (int(color[i:i + 2], 16) for i in (1, 3, 5))
    except ValueError:
        return '#ffffff'
    return '#ffffff' if max(r, g, b) < 48 else color


def dim(color, amount=.4):
    """해치·채움은 같은 색을 검은 바탕 쪽으로 낮춰 선이 보이게 한다."""
    return '#' + ''.join(f'{round(int(color[i:i + 2], 16) * amount):02x}' for i in (1, 3, 5))


def thumbnail(image, dark=False):
    Image, ImageDraw, _ = pillow()
    image = image.convert('RGB')
    factor = 320 / max(image.size)
    image = image.resize(tuple(max(1, round(v * factor)) for v in image.size), Image.Resampling.LANCZOS)
    draw = ImageDraw.Draw(image)
    mark = font(12)
    box = draw.textbbox((0, 0), '바른', font=mark)
    width, height = box[2] - box[0], box[3] - box[1]
    x, y = max(2, image.width-width-6), max(2, image.height-height-5)
    draw.rectangle((x-3, y-2, min(image.width-1,x+width+3), min(image.height-1,y+height+2)), fill='black' if dark else 'white')
    draw.text((x, y-box[1]), '바른', font=mark, fill='#9dcbe0' if dark else '#425466')
    for quality in (70, 60, 50, 40, 30):
        buffer = io.BytesIO()
        image.save(buffer, format='WEBP', quality=quality, method=6)
        if len(buffer.getvalue()) <= 20 * 1024:
            return buffer.getvalue()
    raise ValueError('미리보기 그림이 20KB 목표를 초과했습니다.')


def png_thumbnail(source):
    Image, _, _ = pillow()
    with Image.open(source) as image:
        return thumbnail(image)


def geometry_thumbnail(asset):
    Image, ImageDraw, _ = pillow()
    # Supersampling gives thin CAD strokes a readable antialiased thumbnail.
    # CAD 화면처럼 검은 바탕에 객체 색(레이어 색이 객체에 실려 있다)으로 그린다.
    boxes = [s['bounds'] for s in asset['scenes']]
    x0, y0 = min(b[0] for b in boxes), min(b[1] for b in boxes)
    x1, y1 = max(b[2] for b in boxes), max(b[3] for b in boxes)
    dx, dy = max(x1-x0, 1), max(y1-y0, 1)
    # 그림 칸을 자료 비율로 잡고 가운데 놓는다(넓은 상세 묶음이 아래 띠로 작게 붙지 않게).
    width = 640 if dx >= dy else max(160, round(592*dx/dy)+48)
    height = 640 if dy > dx else max(160, round(592*dy/dx)+48)
    factor = min((width-48)/dx, (height-48)/dy)
    ox, oy = (width-dx*factor)/2, (height-dy*factor)/2
    image = Image.new('RGB', (width, height), 'black')
    draw = ImageDraw.Draw(image)
    def xy(p):
        x, y = (p['x'], p['y']) if isinstance(p, dict) else p[:2]
        return (ox+(x-x0)*factor, height-oy-(y-y0)*factor)
    ink = '#ffffff'
    def stroke(points, closed=False, fill=None, outline=True):
        if len(points) < 2:
            return
        coords = [xy(p) for p in points]
        if fill and len(coords) >= 3:
            draw.polygon(coords, fill=fill)
        if outline:
            draw.line(coords + (coords[:1] if closed else []), fill=ink, width=2)
    def entity(e):
        nonlocal ink
        kind = e.get('type')
        if kind != 'block':
            ink = preview_ink(e.get('color'))
        if kind == 'block':
            for child in e.get('entities', []):
                entity(child)
        elif kind in ('line', 'polyline', 'lwpolyline', 'spline', 'hatch', 'solid'):
            points = [e['start'], e['end']] if 'start' in e else e.get('points', e.get('fitPoints', []))
            # 본 도면처럼: 가리개는 바탕색(검정)으로 덮고 테두리는 frame 이 있을 때만, 꽉 찬 해치만 옅게 칠하고 무늬 해치는 칠하지 않는다.
            if e.get('wipeout'):
                stroke(points, True, 'black', outline=bool(e.get('frame')))
            elif kind == 'solid' or kind == 'hatch' and e.get('solid'):
                stroke(points, True, dim(ink))
            else:
                stroke(points, e.get('closed', kind == 'hatch'))
        elif kind == 'ellipse':
            center, axis = e['center'], e['majorAxis']
            cx, cy = (center['x'], center['y']) if isinstance(center, dict) else center[:2]
            ax, ay = (axis['x'], axis['y']) if isinstance(axis, dict) else axis[:2]
            ratio = e.get('ratio', 1)
            start, end = e.get('startParam', 0), e.get('endParam', math.tau)
            sweep = (end-start) % math.tau or math.tau
            points = [{'x':cx+ax*math.cos(start+sweep*i/96)-ay*ratio*math.sin(start+sweep*i/96),
                       'y':cy+ay*math.cos(start+sweep*i/96)+ax*ratio*math.sin(start+sweep*i/96)} for i in range(97)]
            stroke(points)
        elif kind in ('circle', 'arc'):
            center = e['center']
            cx, cy = (center['x'], center['y']) if isinstance(center, dict) else center[:2]
            radius = e.get('radius', e.get('majorRadius', 1))
            start, end = e.get('startAngle', 0), e.get('endAngle', 360)
            sweep = (end-start) % 360 or 360
            points = [{'x':cx+radius*math.cos(math.radians(start+sweep*i/64)),
                       'y':cy+radius*math.sin(math.radians(start+sweep*i/64))} for i in range(65)]
            stroke(points)
        elif kind in ('text', 'mtext'):
            at = e.get('position', e.get('insert'))
            if at:
                size = max(7, min(28, e.get('height', 10)*factor))
                x, y = xy(at)
                draw.text((x,y-size), str(e.get('text', '')), font=font(int(size)), fill=ink)
        elif kind == 'dimension':
            stroke(e.get('points', [])[:2])
    for scene in asset['scenes']:
        for e in scene['entities']:
            entity(e)
    return thumbnail(image, dark=True)
