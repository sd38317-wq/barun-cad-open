"""해치 무늬 줄 → 선분(hatch-patterns.js 와 같은 규칙). PDF 출력(pdf_service.py)이 쓴다.

무늬 줄 = {'angle': 도, 'base': {'x','y'}, 'offset': {'x','y'}(다음 평행선까지의 도면 좌표 벡터), 'dashes': [+선, -빈칸, 0점]}.
e['patternLines'] 가 있으면 그대로, 없으면 예전 바른 CAD 해치(pattern 'lines'|'cross', spacing, angle, origin)를 같은 줄로 바꾼다.
"""
import math


def _finite(v):
    return isinstance(v, (int, float)) and math.isfinite(v)


def hatch_families(e):
    if not e or e.get('type') != 'hatch' or e.get('solid'):
        return []
    lines = e.get('patternLines')
    if isinstance(lines, list) and lines:
        return lines
    spacing = float(e.get('spacing', 100) or 0)
    if spacing <= 0:
        return []
    a = float(e.get('angle', 0) or 0)
    r = math.radians(a)
    o = e.get('origin')
    base = {'x': o['x'], 'y': o['y']} if isinstance(o, dict) and _finite(o.get('x')) and _finite(o.get('y')) else {'x': 0.0, 'y': 0.0}
    families = [{'angle': a, 'base': base, 'offset': {'x': -spacing * math.sin(r), 'y': spacing * math.cos(r)}, 'dashes': []}]
    if str(e.get('pattern', '')).lower() == 'cross':
        families.append({'angle': a + 90, 'base': base, 'offset': {'x': spacing * math.cos(r), 'y': spacing * math.sin(r)}, 'dashes': []})
    return families


def hatch_segments(families, box, max_segments=200000):
    """(segments[(x1,y1,x2,y2)], dots[(x,y)], dense). dense 면 선이 너무 많아 부르는 쪽이 옅은 채움으로 대신한다."""
    segments, dots = [], []
    min_x, min_y, max_x, max_y = box
    if not (max_x > min_x and max_y > min_y):
        return segments, dots, False
    corners = ((min_x, min_y), (max_x, min_y), (max_x, max_y), (min_x, max_y))
    for line in families or []:
        a = math.radians(float(line['angle']))
        dx, dy = math.cos(a), math.sin(a)
        nx, ny = -dy, dx
        bx, by = float(line['base']['x']), float(line['base']['y'])
        ox, oy = float(line['offset']['x']), float(line['offset']['y'])
        perp = ox * nx + oy * ny
        if abs(perp) <= 1e-9:
            continue
        proj = [(x - bx) * nx + (y - by) * ny for x, y in corners]
        q0, q1 = min(proj) / perp, max(proj) / perp
        k0, k1 = math.ceil(min(q0, q1) - 1e-9), math.floor(max(q0, q1) + 1e-9)
        if k1 - k0 + 1 > max_segments:
            return segments, dots, True
        dashes = [float(d) for d in line.get('dashes') or [] if _finite(d)]
        cycle = sum(abs(d) for d in dashes)
        for k in range(k0, k1 + 1):
            px, py = bx + k * ox, by + k * oy
            along = [(x - px) * dx + (y - py) * dy for x, y in corners]
            t_min, t_max = min(along), max(along)
            if not dashes or cycle <= 1e-12:
                segments.append((px + t_min * dx, py + t_min * dy, px + t_max * dx, py + t_max * dy))
            else:
                if (t_max - t_min) / cycle * len(dashes) + len(segments) > max_segments:
                    return segments, dots, True
                t = math.floor(t_min / cycle) * cycle
                while t < t_max:
                    for d in dashes:
                        length = abs(d)
                        if d > 0:
                            s0, s1 = max(t, t_min), min(t + length, t_max)
                            if s1 > s0:
                                segments.append((px + s0 * dx, py + s0 * dy, px + s1 * dx, py + s1 * dy))
                        elif d == 0 and t_min <= t <= t_max:
                            dots.append((px + t * dx, py + t * dy))
                        t += length
                        if t >= t_max:
                            break
            if len(segments) + len(dots) > max_segments:
                return segments, dots, True
    return segments, dots, False
