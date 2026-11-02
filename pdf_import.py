"""PDF 가져오기(PDFIMPORT): PDF 한 쪽의 벡터 내용을 바른 CAD 객체로 바꾼다.

새 외부 라이브러리 없이 이미 들어 있는 pypdf 로 쪽 내용 흐름을 읽고, 경로 연산자
(m l c v y h re S s f F f* B B* b b* n cm q Q, Do 의 양식 XObject)를 직접 해석한다.
글자(BT/ET Tj TJ ' ")는 pypdf 의 글자 추출 방문자로 위치·높이만 받아 text 객체로 만든다.

좌표: PDF 점(1/72 인치)을 mm 로 바꾼다(1pt = 25.4/72 mm) × scale. 원점은 쪽의 왼쪽 아래.
래스터 그림은 가져오지 않고 개수만 보고한다.
"""
from __future__ import annotations

import io
import math

PT_TO_MM = 25.4 / 72
MAX_ENTITIES = 400_000
MAX_FORM_DEPTH = 12
MAX_PDF_BYTES = 150_000_000


def _mul(a, b):
    """3x3 아핀 행렬 [a b c d e f] 곱: a 다음 b (PDF 규약: 새 CTM = cm × 옛 CTM)."""
    return (
        a[0] * b[0] + a[1] * b[2], a[0] * b[1] + a[1] * b[3],
        a[2] * b[0] + a[3] * b[2], a[2] * b[1] + a[3] * b[3],
        a[4] * b[0] + a[5] * b[2] + b[4], a[4] * b[1] + a[5] * b[3] + b[5],
    )


def _apply(m, x, y):
    return (m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5])


def _num(value):
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0.0


def _bezier(p0, p1, p2, p3):
    """3차 베지어를 꺾은선으로. 휜 만큼만 나눈다(종이에서 0.05 pt ≈ 0.02 mm 안).
    예전엔 아무리 작아도 4토막 이상이라 단열재 무늬 같은 잔 곡선이 선 2만 4천 개가 되어 평면 인식이 외곽을 놓쳤다(2026-10-29).
    """
    chord = math.dist(p0, p3)
    def off(q):   # 조절점이 시작·끝을 잇는 선에서 떨어진 거리
        if chord <= 1e-12:
            return math.dist(q, p0)
        return abs((p3[0] - p0[0]) * (p0[1] - q[1]) - (p0[0] - q[0]) * (p3[1] - p0[1])) / chord
    bend = max(off(p1), off(p2))
    n = max(1, min(64, int(math.ceil(math.sqrt(bend / 0.05)))))
    out = []
    for i in range(1, n + 1):
        t = i / n
        u = 1 - t
        a, b, c, d = u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t
        out.append((a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0], a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1]))
    return out


def _is_white(color):
    return color is not None and all(c >= 0.999 for c in color)


class _Converter:
    def __init__(self, page, scale):
        box = page.mediabox
        self.llx, self.lly = float(box.left), float(box.bottom)
        self.width, self.height = float(box.width), float(box.height)
        self.rotate = int(page.get('/Rotate', 0) or 0) % 360
        self.factor = PT_TO_MM * scale
        self.entities = []
        self.report = {
            'lines': 0, 'polylines': 0, 'circles': 0, 'texts': 0, 'filled': 0,
            'images': 0, 'shadings': 0, 'skippedWhiteFills': 0, 'truncated': False,
            'forms': 0, 'unsupported': [], 'pdfLayers': {},
        }
        self.layer_stack = []   # ACAD200-820: 표시 내용(BDC /OC … EMC)으로 열린 PDF 레이어(OCG) 이름, 아니면 None

    def current_layer(self):
        for name in reversed(self.layer_stack):
            if name:
                return name
        return None

    def tag_layer(self, start):
        name = self.current_layer()
        if not name:
            return
        for entity in self.entities[start:]:
            entity['pdfLayer'] = name
        self.report['pdfLayers'][name] = self.report['pdfLayers'].get(name, 0) + len(self.entities) - start

    # 쪽 좌표(점) → 도면 좌표(mm). 쪽 회전(/Rotate)은 PDF 보기 프로그램과 같은 방향으로 맞춘다.
    def out(self, p):
        x, y = p[0] - self.llx, p[1] - self.lly
        if self.rotate == 90:
            x, y = y, self.width - x
        elif self.rotate == 180:
            x, y = self.width - x, self.height - y
        elif self.rotate == 270:
            x, y = self.height - y, x
        return {'x': round(x * self.factor, 6), 'y': round(y * self.factor, 6)}

    def full(self):
        if len(self.entities) >= MAX_ENTITIES:
            self.report['truncated'] = True
            return True
        return False

    def emit_path(self, subpaths, closed_all, filled):
        for sub in subpaths:
            if self.full():
                return
            start, segs, closed = sub['start'], sub['segs'], sub['closed'] or closed_all
            if not segs:
                continue
            circle = self._circle(start, segs) if closed or len(segs) >= 4 else None
            if circle:
                center, radius = circle
                c = self.out(center)
                self.entities.append({'type': 'circle', 'center': c, 'radius': round(radius * self.factor, 6)})
                self.report['circles'] += 1
                if filled:
                    self.report['filled'] += 1
                continue
            arc = None if closed or filled else self._arc(start, segs)
            if arc:
                # 문 열림 호 같은 원호는 원호로 둔다(꺾은선이면 평면 인식이 문을 못 알아봐 현관이 거실과 합쳐졌다, 2026-10-29).
                center, radius, ends, mid = arc
                c, a, m, b = self.out(center), self.out(ends[0]), self.out(mid), self.out(ends[1])
                ang = lambda q: math.degrees(math.atan2(q['y'] - c['y'], q['x'] - c['x'])) % 360
                s, e, k = ang(a), ang(b), ang(m)
                if (k - s) % 360 > (e - s) % 360:   # 시작→끝 반시계로 가면 중간점을 지나야 한다
                    s, e = e, s
                self.entities.append({'type': 'arc', 'center': c, 'radius': round(radius * self.factor, 6), 'startAngle': round(s, 6), 'endAngle': round(e, 6)})
                self.report['arcs'] = self.report.get('arcs', 0) + 1
                continue
            pts = [start]
            for seg in segs:
                if seg[0] == 'l':
                    pts.append(seg[1])
                else:
                    pts.extend(_bezier(pts[-1], seg[1], seg[2], seg[3]))
            # 연속 중복점 제거
            clean = [pts[0]]
            for p in pts[1:]:
                if math.dist(p, clean[-1]) > 1e-9:
                    clean.append(p)
            if closed and len(clean) > 2 and math.dist(clean[0], clean[-1]) <= 1e-9:
                clean.pop()
            if len(clean) < 2:
                continue
            points = [self.out(p) for p in clean]
            if len(points) == 2 and not closed:
                self.entities.append({'type': 'line', 'points': points})
                self.report['lines'] += 1
            else:
                self.entities.append({'type': 'polyline', 'points': points, 'closed': bool(closed and len(points) > 2)})
                self.report['polylines'] += 1
            if filled:
                self.report['filled'] += 1

    @staticmethod
    def _arc(start, segs):
        """베지어 1~4개로만 된 열린 경로가 한 원 위에 있으면 (중심, 반지름, (시작, 끝), 가운데 점). 시작·끝 접선에 수직인 두 선이 만나는 곳이 중심."""
        if not 1 <= len(segs) <= 4 or any(s[0] != 'c' for s in segs):
            return None
        p0, p1 = start, segs[0][1]
        p2, p3 = segs[-1][2], segs[-1][3]
        n0, n3 = (-(p1[1] - p0[1]), p1[0] - p0[0]), (-(p3[1] - p2[1]), p3[0] - p2[0])
        det = n0[0] * -n3[1] + n3[0] * n0[1]
        if abs(det) <= 1e-12 or math.dist(p0, p3) <= 1e-9:
            return None
        s = ((p3[0] - p0[0]) * -n3[1] + n3[0] * (p3[1] - p0[1])) / det
        center = (p0[0] + s * n0[0], p0[1] + s * n0[1])
        samples, prev = [p0], p0
        for seg in segs:
            samples.extend(_bezier(prev, seg[1], seg[2], seg[3]))
            prev = seg[3]
        r = math.dist(center, p0)
        if r < 3 or max(abs(math.dist(center, q) - r) for q in samples) > r * 0.01:   # 3 pt(≈1 mm) 미만 잔 곡선(단열재 무늬)은 꺾은선 그대로
            return None
        sweep = sum(abs(math.atan2((a[0] - center[0]) * (b[1] - center[1]) - (a[1] - center[1]) * (b[0] - center[0]), (a[0] - center[0]) * (b[0] - center[0]) + (a[1] - center[1]) * (b[1] - center[1]))) for a, b in zip(samples, samples[1:]))
        if math.degrees(sweep) < 30:
            return None
        return center, r, (p0, p3), samples[len(samples) // 2]

    @staticmethod
    def _circle(start, segs):
        """베지어 4개(+닫는 0길이 선)로 된 닫힌 경로가 원이면 (중심, 반지름)을 돌려준다."""
        curves = [s for s in segs if s[0] == 'c']
        lines = [s for s in segs if s[0] == 'l']
        if len(curves) != 4 or len(lines) > 1:
            return None
        ends = [start] + [s[-1] for s in segs]
        if math.dist(ends[0], ends[-1]) > 1e-3 * max(1.0, math.dist(ends[0], ends[2])):
            return None
        anchors = [start] + [s[3] for s in curves][:3]
        cx = sum(p[0] for p in anchors) / 4
        cy = sum(p[1] for p in anchors) / 4
        samples = []
        prev = start
        for s in segs:
            if s[0] == 'c':
                samples.extend(_bezier(prev, s[1], s[2], s[3]))
            prev = s[-1]
        radii = [math.dist((cx, cy), p) for p in samples]
        r = sum(radii) / len(radii)
        if r <= 1e-9 or max(abs(x - r) for x in radii) > r * 0.01:
            return None
        return (cx, cy), r


def _operations(stream_obj, reader):
    from pypdf.generic import ContentStream
    return ContentStream(stream_obj, reader).operations


def _ocg_name(value, properties):
    """BDC /OC 의 피연산자(속성 이름 또는 바로 적은 사전)에서 OCG 이름. OCMD 는 첫 OCG 이름. 못 찾으면 None."""
    try:
        target = value
        if not hasattr(target, 'get') and properties is not None:
            target = properties.get(value)
        target = target.get_object() if hasattr(target, 'get_object') else target
        if target is None or not hasattr(target, 'get'):
            return None
        if target.get('/Type') == '/OCMD':
            groups = target.get('/OCGs')
            groups = groups.get_object() if hasattr(groups, 'get_object') else groups
            first = groups[0] if isinstance(groups, list) and groups else groups
            target = first.get_object() if hasattr(first, 'get_object') else first
        name = target.get('/Name') if target is not None and hasattr(target, 'get') else None
        return str(name).strip() or None if name is not None else None
    except Exception:
        return None


def _run(conv, operations, resources, ctm, reader, depth):
    from pypdf.generic import IndirectObject
    stack = []
    fill = None
    subpaths = []
    current = None
    cur_pt = None
    xobjects = None
    if resources is not None:
        res = resources.get_object() if isinstance(resources, IndirectObject) else resources
        xo = res.get('/XObject') if hasattr(res, 'get') else None
        xobjects = xo.get_object() if xo is not None else None
        props = res.get('/Properties') if hasattr(res, 'get') else None
        properties = props.get_object() if props is not None else None
    else:
        properties = None

    def start(p):
        nonlocal current
        current = {'start': p, 'segs': [], 'closed': False}
        subpaths.append(current)

    for operands, op in operations:
        if conv.full():
            return
        if op == b'q':
            stack.append((ctm, fill))
        elif op == b'Q':
            if stack:
                ctm, fill = stack.pop()
        elif op == b'cm' and len(operands) == 6:
            ctm = _mul(tuple(_num(v) for v in operands), ctm)
        elif op == b'm' and len(operands) >= 2:
            cur_pt = _apply(ctm, _num(operands[0]), _num(operands[1]))
            start(cur_pt)
        elif op == b'l' and len(operands) >= 2:
            p = _apply(ctm, _num(operands[0]), _num(operands[1]))
            if current is None:
                start(cur_pt or p)
            current['segs'].append(('l', p))
            cur_pt = p
        elif op in (b'c', b'v', b'y'):
            vals = [_num(v) for v in operands]
            if current is None or cur_pt is None:
                continue
            if op == b'c' and len(vals) >= 6:
                p1, p2, p3 = _apply(ctm, vals[0], vals[1]), _apply(ctm, vals[2], vals[3]), _apply(ctm, vals[4], vals[5])
            elif op == b'v' and len(vals) >= 4:
                p1, p2, p3 = cur_pt, _apply(ctm, vals[0], vals[1]), _apply(ctm, vals[2], vals[3])
            elif op == b'y' and len(vals) >= 4:
                p1, p3 = _apply(ctm, vals[0], vals[1]), _apply(ctm, vals[2], vals[3])
                p2 = p3
            else:
                continue
            current['segs'].append(('c', p1, p2, p3))
            cur_pt = p3
        elif op == b'h':
            if current is not None:
                current['closed'] = True
                cur_pt = current['start']
                current = None
        elif op == b're' and len(operands) >= 4:
            x, y, w, h = (_num(v) for v in operands[:4])
            corners = [_apply(ctm, x, y), _apply(ctm, x + w, y), _apply(ctm, x + w, y + h), _apply(ctm, x, y + h)]
            subpaths.append({'start': corners[0], 'segs': [('l', c) for c in corners[1:]], 'closed': True})
            current = None
            cur_pt = corners[0]
        elif op in (b'S', b's', b'f', b'F', b'f*', b'B', b'B*', b'b', b'b*', b'n'):
            if op != b'n' and subpaths:
                filled = op not in (b'S', b's')
                stroked = op not in (b'f', b'F', b'f*')
                if filled and not stroked and _is_white(fill):
                    conv.report['skippedWhiteFills'] += 1   # 흰 바탕 칠(종이 배경 등)은 선으로 만들지 않는다
                else:
                    before = len(conv.entities)
                    conv.emit_path(subpaths, op in (b's', b'b', b'b*'), filled)
                    conv.tag_layer(before)
            subpaths = []
            current = None
            cur_pt = None
        elif op == b'g' and operands:
            fill = (_num(operands[0]),) * 3
        elif op == b'rg' and len(operands) >= 3:
            fill = tuple(_num(v) for v in operands[:3])
        elif op == b'k' and len(operands) >= 4:
            c, m, y, k = (_num(v) for v in operands[:4])
            fill = ((1 - c) * (1 - k), (1 - m) * (1 - k), (1 - y) * (1 - k))
        elif op in (b'sc', b'scn'):
            vals = [_num(v) for v in operands if not isinstance(v, str)]   # 패턴 이름(NameObject)은 뺀다
            fill = (vals[0],) * 3 if len(vals) == 1 else tuple(vals[:3]) if len(vals) == 3 else None
        elif op == b'BDC' and len(operands) >= 2:
            conv.layer_stack.append(_ocg_name(operands[1], properties) if str(operands[0]) == '/OC' else None)
        elif op == b'BMC':
            conv.layer_stack.append(None)
        elif op == b'EMC':
            if conv.layer_stack:
                conv.layer_stack.pop()
        elif op == b'sh':
            conv.report['shadings'] += 1
        elif op == b'INLINE IMAGE':
            conv.report['images'] += 1
        elif op == b'Do' and operands and xobjects is not None:
            try:
                xobj = xobjects.get(operands[0])
                xobj = xobj.get_object() if xobj is not None else None
            except Exception:
                xobj = None
            if xobj is None:
                continue
            subtype = xobj.get('/Subtype')
            if subtype == '/Image':
                conv.report['images'] += 1
            elif subtype == '/Form':
                if depth >= MAX_FORM_DEPTH:
                    continue
                conv.report['forms'] += 1
                matrix = xobj.get('/Matrix')
                fm = tuple(_num(v) for v in matrix) if matrix is not None and len(matrix) == 6 else (1, 0, 0, 1, 0, 0)
                try:
                    ops = _operations(xobj, reader)
                except Exception:
                    if 'form' not in conv.report['unsupported']:
                        conv.report['unsupported'].append('form')
                    continue
                _run(conv, ops, xobj.get('/Resources', resources), _mul(fm, ctm), reader, depth + 1)


def _advance(text, size):
    """글자 폭 어림값(글자 높이 배수): 한글·한자 0.9, 띄어쓰기 0.28, 나머지 0.55. 합칠지 가를 때만 쓴다."""
    return sum((0.9 if ord(ch) >= 0x1100 else 0.28 if ch == ' ' else 0.55) * size for ch in text)


def _merge_runs(runs):
    """같은 줄에 이어 놓인 글자 조각을 한 문자열로 합친다.
    크롬 등은 글자마다(글꼴 조각마다) 위치를 따로 찍어 '침실 1' 이 '침'·'실'·'1' 세 객체로 들어왔다 (A49, 10-20 K48).
    run: [text, (x, y) PDF 좌표 시작점 또는 None(위치 모름), size, angle]. 줄바꿈 표시(None)가 오면 끊는다."""
    lines, current = [], None
    for run in runs:
        if run is None:
            current = None
            continue
        text, origin, size, angle = run
        if current is not None:
            c_text, c_origin, c_size, c_angle, c_end, c_last = current
            same_style = abs(((angle - c_angle + 180) % 360) - 180) < 0.5 and abs(size - c_size) <= 0.1 * c_size
            if same_style and origin is not None and c_origin is not None:
                a = math.radians(c_angle)
                dx, dy = origin[0] - c_origin[0], origin[1] - c_origin[1]
                along, across = dx * math.cos(a) + dy * math.sin(a), -dx * math.sin(a) + dy * math.cos(a)
                # 앞 조각과 시작점이 같으면 pypdf 가 줄 시작 행렬을 그대로 넘긴 것(글꼴만 바뀐 Tj) — 이어 쓴 글자로 본다.
                repeated = abs(along - c_last) < 0.01 * c_size and abs(across) < 0.01 * c_size
                if repeated or (abs(across) < 0.3 * c_size and -0.8 * c_size <= along - c_end <= 1.0 * c_size):
                    gap = 0 if repeated else along - c_end
                    joiner = ' ' if gap > 0.25 * c_size and not c_text.endswith(' ') and not text.startswith(' ') else ''
                    current[0] = c_text + joiner + text
                    current[4] = (c_end if repeated else along) + _advance(text, size)
                    current[5] = along
                    continue
            if same_style and c_origin is None and origin is not None:
                # 줄 첫 조각이 위치 없이 왔으면(pypdf 가 새 BT 의 단위 행렬로 넘김) 다음 조각 앞에 붙인다.
                a = math.radians(angle)
                back = _advance(c_text.strip(), size)
                current[1] = (origin[0] - back * math.cos(a), origin[1] - back * math.sin(a))
                current[0] = c_text + text
                current[4] = back + _advance(text, size)
                current[5] = back
                continue
        current = [text, origin, size, angle, _advance(text, size), 0.0]
        lines.append(current)
    return [line for line in lines if line[0].strip() and line[1] is not None]


def _texts(conv, page):
    """pypdf 글자 추출 방문자로 글자 조각의 위치와 높이를 받아 같은 줄 조각을 합친다. 실패하면 글자만 건너뛴다."""
    runs = []

    def visit(text, cm, tm, font_dict, font_size):
        if '\n' in (text or '') or '\r' in (text or ''):
            runs.append(None)
        text = (text or '').replace('\r', ' ').replace('\n', ' ')
        if not text.strip():
            if text and runs and runs[-1] is not None:
                runs[-1][0] += ' '
            return
        try:
            t = tuple(float(v) for v in tm)
            m = _mul(t, tuple(float(v) for v in cm))
        except (TypeError, ValueError):
            return
        size = float(font_size or 0) * math.hypot(m[2], m[3])
        if size <= 1e-6:
            return
        angle = math.degrees(math.atan2(m[1], m[0]))
        # 글자 행렬(Tm)이 단위 행렬이어도 자리는 cm 에 있다(바른 CAD·reportlab 출력). 예전엔 버려 치수·축척 글자 26개가 빠졌다(2026-10-29).
        runs.append([text, _apply(m, 0, 0), size, angle])

    try:
        page.extract_text(visitor_text=visit)
    except Exception:
        conv.report['unsupported'].append('text')
    for text, origin, size, angle in (line[:4] for line in _merge_runs(runs)):
        if conv.full():
            return
        conv.entities.append({
            'type': 'text', 'position': conv.out(origin), 'text': ' '.join(text.split()),
            'height': round(size * conv.factor, 6), 'rotation': round((angle - conv.rotate) % 360, 4),   # 쪽 회전만큼 글자도 돌린다
        })
        conv.report['texts'] += 1


def dimension_scale(entities: list) -> float | None:
    """치수 숫자 ÷ 그 옆 치수선 길이로 PDF 의 실제 축척(1:N 의 N)을 찾는다. 3개 이상이 같은 값(0.5% 안)으로 모이고
    맞춘 것의 절반 이상일 때만. 도곽의 "1/100" 글자는 믿지 않는다 — 용지에 맞춤으로 뽑은 PDF 는 1:144·1:242 였다(2026-10-29)."""
    segments = []
    for e in entities:
        if e['type'] == 'line' or e['type'] == 'polyline' and len(e['points']) == 2:
            a, b = e['points'][0], e['points'][-1]
            length = math.hypot(b['x'] - a['x'], b['y'] - a['y'])
            if length > 0:
                segments.append((a['x'], a['y'], (b['x'] - a['x']) / length, (b['y'] - a['y']) / length, length))
    ratios = []
    for t in entities:
        if t['type'] != 'text' or not t['text'].isdigit() or not 3 <= len(t['text']) <= 6:
            continue
        h = t['height'];angle = math.radians(t.get('rotation', 0));ux, uy = math.cos(angle), math.sin(angle)
        half = 0.28 * h * len(t['text'])   # 글자 가운데(_text_width 의 숫자 폭과 같은 셈)
        cx, cy = t['position']['x'] + ux * half, t['position']['y'] + uy * half
        best = None
        for x, y, dx, dy, length in segments:
            if length < h or abs(dx * ux + dy * uy) < 0.995:
                continue
            mx, my = x + dx * length / 2, y + dy * length / 2
            if abs((cx - mx) * dx + (cy - my) * dy) > length / 2:
                continue
            across = abs(-(cx - mx) * dy + (cy - my) * dx)
            if across <= 2.5 * h and (best is None or across < best[0]):
                best = (across, length)
        if best:
            ratios.append(int(t['text']) / best[1])
    groups = {}
    for r in ratios:
        key = next((k for k in groups if abs(r / k - 1) < 0.005), r)
        groups.setdefault(key, []).append(r)
    if not groups:
        return None
    top = max(groups.values(), key=len)
    if len(top) < 3 or len(top) < 0.5 * len(ratios):
        return None
    return sum(top) / len(top)


def import_pdf_page(data: bytes, page: int = 0, scale: float = 1.0, text: bool = True) -> dict:
    """PDF 바이트에서 한 쪽(0부터)의 벡터 내용을 바른 CAD 객체 목록으로 바꾼다."""
    from pypdf import PdfReader
    if not data:
        raise ValueError('PDF 파일이 비어 있습니다.')
    if len(data) > MAX_PDF_BYTES:
        raise ValueError('PDF 파일은 150 MB 이하만 가져올 수 있습니다.')
    scale = float(scale)
    if not math.isfinite(scale) or scale <= 0:
        raise ValueError('축척은 0보다 큰 숫자여야 합니다.')
    try:
        reader = PdfReader(io.BytesIO(data), strict=False)
        if reader.is_encrypted and not reader.decrypt(''):
            raise ValueError('암호가 걸린 PDF 는 가져올 수 없습니다.')
        count = len(reader.pages)
    except ValueError:
        raise
    except Exception as error:
        raise ValueError('PDF 파일을 읽지 못했습니다: ' + str(error)) from error
    page = int(page)
    if not 0 <= page < count:
        raise ValueError(f'쪽 번호는 1~{count} 사이로 입력하세요.')
    pdf_page = reader.pages[page]
    conv = _Converter(pdf_page, scale)
    contents = pdf_page.get_contents()
    if contents is not None:
        try:
            ops = _operations(contents, reader)
        except Exception as error:
            raise ValueError('PDF 쪽 내용을 해석하지 못했습니다: ' + str(error)) from error
        _run(conv, ops, pdf_page.get('/Resources'), (1, 0, 0, 1, 0, 0), reader, 0)
    if text:
        _texts(conv, pdf_page)
    w, h = conv.width, conv.height
    if conv.rotate in (90, 270):
        w, h = h, w
    conv.report.update(
        pages=count, page=page + 1, scale=scale,
        pageSize={'width': round(w * conv.factor, 3), 'height': round(h * conv.factor, 3)},
        entities=len(conv.entities),
    )
    return {'entities': conv.entities, 'report': conv.report}


def process(data: dict) -> dict:
    """/api/pdf-import 요청: {data: base64, page: 0부터, scale, text}."""
    import base64
    raw = base64.b64decode(str(data.get('data', '')), validate=True)
    return import_pdf_page(raw, int(data.get('page', 0) or 0), float(data.get('scale', 1) or 1), bool(data.get('text', True)))
