"""현장 기록 보고서(펀치리스트) PDF — 현장 패드에서 받은 핀·실측·사진을 A4 로 묶는다.

첫 장: 공사 정보 · 요약 숫자 · 핀 위치도(핀 둘레 실제 도면 선) · 핀 표 · 서명란.
둘째 장부터: 핀마다 설명 · 사무실 답 · 사진(한 핀에 4장까지). 마지막에 실측 목록.
CAD 화면(pad-share.js)이 자료를 모아 보내고, 여기서는 그리기만 한다. 글꼴은 pdf_service 의 내장 한글 글꼴.
"""
import base64
import io
from datetime import date

from reportlab.lib.colors import HexColor
from reportlab.lib.utils import ImageReader
from reportlab.pdfgen import canvas

from pdf_service import FONT, MM, font

PAGE_W, PAGE_H = 210 * MM, 297 * MM
MARGIN = 16 * MM
INK, MUTED, LINE, ACCENT = HexColor('#1b2228'), HexColor('#5b6670'), HexColor('#c9d1d7'), HexColor('#1f5a73')
STATE_COLOR = {'미해결': '#d4661c', '진행 중': '#1f5a73', '확인 요청': '#9a7400', '해결': '#3f8a52'}
WARN, DANGER, OK = HexColor('#8a3a07'), HexColor('#a3261b'), HexColor('#1d5a2c')
MAX_PINS, MAX_PHOTOS, MAX_SEGMENTS = 500, 4, 60000


def _text(c, x, y, s, size=10, color=INK, align='left', bold=False):
    c.setFillColor(color)
    c.setFont(FONT, size)
    s = str(s or '')
    if align == 'center':
        c.drawCentredString(x, y, s)
    elif align == 'right':
        c.drawRightString(x, y, s)
    else:
        c.drawString(x, y, s)


def _fit(c, s, width, size):
    """글이 칸을 넘으면 … 로 줄인다."""
    s = str(s or '')
    while s and c.stringWidth(s, FONT, size) > width:
        s = s[:-2] + '…' if len(s) > 2 else ''
    return s


def _wrap(c, s, width, size, lines=4):
    out, line = [], ''
    for ch in str(s or ''):
        if ch == '\n' or c.stringWidth(line + ch, FONT, size) > width:
            out.append(line)
            line = '' if ch == '\n' else ch
            if len(out) >= lines:
                break
        else:
            line += ch
    if line and len(out) < lines:
        out.append(line)
    return out


def _overdue(pin, today):
    return bool(pin.get('due')) and pin.get('status') != '해결' and str(pin['due']) < today


def _footer(c, page, total, note):
    _text(c, MARGIN, 10 * MM, note, 8, MUTED)
    _text(c, PAGE_W - MARGIN, 10 * MM, f'{page} / {total}', 8, MUTED, 'right')


def _plan(c, x, y, w, h, plan, pins):
    """핀 위치도: 받은 도면 선(세계 좌표)을 칸에 맞춰 그리고 핀 번호를 얹는다."""
    c.setStrokeColor(LINE)
    c.rect(x, y, w, h)
    box = plan.get('box') if isinstance(plan, dict) else None
    if not box or not pins:
        _text(c, x + w / 2, y + h / 2, '위치도 없음', 9, MUTED, 'center')
        return
    minx, miny, maxx, maxy = box
    k = min((w - 8 * MM) / max(maxx - minx, 1e-6), (h - 8 * MM) / max(maxy - miny, 1e-6))
    ox, oy = x + (w - (maxx - minx) * k) / 2, y + (h - (maxy - miny) * k) / 2
    tx = lambda px: ox + (px - minx) * k
    ty = lambda py: oy + (py - miny) * k
    c.saveState()
    p = c.beginPath()
    p.rect(x, y, w, h)
    c.clipPath(p, stroke=0, fill=0)
    c.setStrokeColor(HexColor('#3b414a'))
    c.setLineWidth(0.25)
    seg = plan.get('segments') or []
    for i in range(0, min(len(seg), MAX_SEGMENTS * 4) - 3, 4):
        c.line(tx(seg[i]), ty(seg[i + 1]), tx(seg[i + 2]), ty(seg[i + 3]))
    for pin in pins:
        at = pin.get('at') or {}
        if 'x' not in at:
            continue
        px, py = tx(at['x']), ty(at['y'])
        c.setFillColor(HexColor(STATE_COLOR.get(pin.get('status'), '#d4661c')))
        c.circle(px, py + 3.2 * MM, 2.6 * MM, stroke=0, fill=1)
        _text(c, px, py + 2.4 * MM, pin.get('no') or '', 7.5, HexColor('#ffffff'), 'center')
    c.restoreState()


def render(data):
    font()
    pins = [p for p in (data.get('pins') or []) if isinstance(p, dict)][:MAX_PINS]
    measures = [m for m in (data.get('measures') or []) if isinstance(m, dict)][:MAX_PINS]
    today = str(data.get('date') or date.today().isoformat())
    detail_pages = (len(pins) + 2) // 3
    total = 1 + detail_pages + (1 if measures else 0)
    out = io.BytesIO()
    c = canvas.Canvas(out, pagesize=(PAGE_W, PAGE_H))
    c.setTitle(str(data.get('title') or '펀치리스트'))
    c.setAuthor('바른 CAD · 현장 패드')
    note = f"{data.get('drawing') or ''} · 바른 CAD 현장 패드"

    # ── 첫 장 ──
    top = PAGE_H - MARGIN
    _text(c, MARGIN, top - 4 * MM, '현장 기록 보고서', 9, ACCENT)
    _text(c, MARGIN, top - 13 * MM, str(data.get('title') or '펀치리스트'), 22)
    _text(c, PAGE_W - MARGIN, top - 13 * MM, '바른 CAD · 현장 패드', 8.5, MUTED, 'right')
    c.setStrokeColor(INK)
    c.setLineWidth(1.4)
    c.line(MARGIN, top - 16 * MM, PAGE_W - MARGIN, top - 16 * MM)
    # 공사 정보
    y = top - 24 * MM
    cw = (PAGE_W - 2 * MARGIN) / 2
    c.setLineWidth(0.4)
    c.setStrokeColor(LINE)
    for row, (a, b) in enumerate([(('공사명', data.get('project') or ''), ('작성일', today)), (('위치', data.get('drawing') or ''), ('작성자', data.get('author') or ''))]):
        for col, (label, value) in enumerate((a, b)):
            x0, y0 = MARGIN + col * cw, y - row * 8 * MM
            c.setFillColor(HexColor('#eef1f3'))
            c.rect(x0, y0 - 6 * MM, 20 * MM, 8 * MM, stroke=1, fill=1)
            c.rect(x0 + 20 * MM, y0 - 6 * MM, cw - 20 * MM, 8 * MM, stroke=1, fill=0)
            _text(c, x0 + 2.5 * MM, y0 - 3.3 * MM, label, 9)
            _text(c, x0 + 22.5 * MM, y0 - 3.3 * MM, _fit(c, value, cw - 25 * MM, 9.5), 9.5)
    # 요약
    counts = [('전체', len(pins), INK, LINE), ('미해결', sum(p.get('status') == '미해결' for p in pins), WARN, HexColor('#d4661c')),
              ('진행·확인', sum(p.get('status') in ('진행 중', '확인 요청') for p in pins), INK, LINE), ('해결', sum(p.get('status') == '해결' for p in pins), OK, LINE),
              ('기한 지남', sum(_overdue(p, today) for p in pins), DANGER, DANGER)]
    y = top - 48 * MM
    bw = (PAGE_W - 2 * MARGIN - 4 * 3 * MM) / 5
    for i, (label, n, color, edge) in enumerate(counts):
        x0 = MARGIN + i * (bw + 3 * MM)
        c.setStrokeColor(edge)
        c.roundRect(x0, y - 14 * MM, bw, 14 * MM, 2 * MM)
        _text(c, x0 + 3 * MM, y - 5 * MM, label, 8.5, color)
        _text(c, x0 + 3 * MM, y - 12 * MM, n, 16, color)
    # 위치도
    _plan(c, MARGIN, top - 132 * MM, PAGE_W - 2 * MARGIN, 76 * MM, data.get('plan') or {}, pins)
    _text(c, PAGE_W / 2, top - 136 * MM, '핀 위치도 — 번호는 아래 표와 같음', 8, MUTED, 'center')
    # 핀 표
    y = top - 142 * MM
    cols = [('번호', 12 * MM), ('내용', 86 * MM), ('상태', 22 * MM), ('기한', 26 * MM), ('담당', PAGE_W - 2 * MARGIN - 146 * MM)]
    c.setFillColor(INK)
    c.rect(MARGIN, y - 7 * MM, PAGE_W - 2 * MARGIN, 7 * MM, stroke=0, fill=1)
    x0 = MARGIN
    for label, width in cols:
        _text(c, x0 + 2 * MM, y - 4.8 * MM, label, 9, HexColor('#ffffff'))
        x0 += width
    y -= 7 * MM
    shown = pins[:9]
    for pin in shown:
        c.setStrokeColor(LINE)
        c.line(MARGIN, y - 10 * MM, PAGE_W - MARGIN, y - 10 * MM)
        over = _overdue(pin, today)
        x0 = MARGIN
        _text(c, x0 + 6 * MM, y - 5.5 * MM, pin.get('no') or '', 9.5, INK, 'center')
        x0 += cols[0][1]
        _text(c, x0 + 2 * MM, y - 4.3 * MM, _fit(c, pin.get('title') or '(제목 없음)', cols[1][1] - 4 * MM, 9.5), 9.5)
        _text(c, x0 + 2 * MM, y - 8.3 * MM, _fit(c, ' · '.join(filter(None, [pin.get('kind'), pin.get('prio')])), cols[1][1] - 4 * MM, 7.5), 7.5, MUTED)
        x0 += cols[1][1]
        _text(c, x0 + 2 * MM, y - 5.5 * MM, pin.get('status') or '', 9, HexColor(STATE_COLOR.get(pin.get('status'), '#1b2228')))
        x0 += cols[2][1]
        _text(c, x0 + 2 * MM, y - 5.5 * MM, (pin.get('due') or '—') + (' 지남' if over else ''), 8.5, DANGER if over else INK)
        x0 += cols[3][1]
        _text(c, x0 + 2 * MM, y - 5.5 * MM, _fit(c, pin.get('assignee') or '—', cols[4][1] - 3 * MM, 8.5), 8.5)
        y -= 10 * MM
    if len(pins) > len(shown):
        _text(c, MARGIN, y - 5 * MM, f'외 {len(pins) - len(shown)}건 — 다음 장부터 모두 있습니다.', 8.5, MUTED)
    # 서명란
    sw = (PAGE_W - 2 * MARGIN) / 3
    for i, label in enumerate(['작성', '현장 대리인', '감리']):
        x0 = MARGIN + i * sw
        c.setStrokeColor(LINE)
        c.rect(x0, 18 * MM, sw, 16 * MM)
        _text(c, x0 + 2.5 * MM, 29 * MM, label, 8.5, MUTED)
        _text(c, x0 + sw - 2.5 * MM, 20.5 * MM, '(서명)', 8.5, MUTED, 'right')
    _footer(c, 1, total, '상세(사진·설명·사무실 답)는 2쪽부터')
    c.showPage()

    # ── 핀 상세(한 장에 3개) ──
    page = 1
    for start in range(0, len(pins), 3):
        page += 1
        y = PAGE_H - MARGIN
        _text(c, MARGIN, y - 6 * MM, '핀 상세', 14)
        y -= 12 * MM
        for pin in pins[start:start + 3]:
            card_h = 78 * MM
            c.setStrokeColor(LINE)
            c.roundRect(MARGIN, y - card_h, PAGE_W - 2 * MARGIN, card_h, 2.5 * MM)
            c.setFillColor(HexColor(STATE_COLOR.get(pin.get('status'), '#d4661c')))
            c.circle(MARGIN + 7 * MM, y - 7 * MM, 3.5 * MM, stroke=0, fill=1)
            _text(c, MARGIN + 7 * MM, y - 8.2 * MM, pin.get('no') or '', 9, HexColor('#ffffff'), 'center')
            _text(c, MARGIN + 13 * MM, y - 8.5 * MM, _fit(c, pin.get('title') or '(제목 없음)', 120 * MM, 12), 12)
            meta = ' · '.join(filter(None, [pin.get('kind'), pin.get('status'), pin.get('prio'), pin.get('assignee') and f"담당 {pin['assignee']}", pin.get('due') and f"기한 {pin['due']}"]))
            _text(c, MARGIN + 13 * MM, y - 14 * MM, _fit(c, meta, 160 * MM, 8.5), 8.5, MUTED)
            ty = y - 21 * MM
            for line in _wrap(c, pin.get('note'), 82 * MM, 9, 5):
                _text(c, MARGIN + 6 * MM, ty, line, 9)
                ty -= 4.6 * MM
            if pin.get('reply'):
                ty -= 1.5 * MM
                _text(c, MARGIN + 6 * MM, ty, '사무실 답', 8, ACCENT)
                ty -= 4.6 * MM
                for line in _wrap(c, pin['reply'], 82 * MM, 9, 4):
                    _text(c, MARGIN + 6 * MM, ty, line, 9)
                    ty -= 4.6 * MM
            # 사진 2×2(오른쪽)
            photos = [p for p in (pin.get('photos') or []) if isinstance(p, str)][:MAX_PHOTOS]
            px0, pw, ph = MARGIN + 92 * MM, 40 * MM, 28 * MM
            for i, b64 in enumerate(photos):
                gx, gy = px0 + (i % 2) * (pw + 2 * MM), y - 20 * MM - (i // 2 + 1) * (ph + 2 * MM) + 2 * MM
                try:
                    img = ImageReader(io.BytesIO(base64.b64decode(b64)))
                    iw, ih = img.getSize()
                    k = min(pw / iw, ph / ih)
                    c.drawImage(img, gx + (pw - iw * k) / 2, gy + (ph - ih * k) / 2, iw * k, ih * k)
                except Exception:
                    c.setStrokeColor(LINE)
                    c.rect(gx, gy, pw, ph)
                    _text(c, gx + pw / 2, gy + ph / 2, '사진을 읽지 못함', 7.5, MUTED, 'center')
            if not photos:
                _text(c, px0 + 41 * MM, y - 45 * MM, '사진 없음', 8.5, MUTED, 'center')
            y -= card_h + 5 * MM
        _footer(c, page, total, note)
        c.showPage()

    # ── 실측 목록 ──
    if measures:
        page += 1
        y = PAGE_H - MARGIN
        _text(c, MARGIN, y - 6 * MM, '실측 목록', 14)
        y -= 14 * MM
        for i, m in enumerate(measures[:40]):
            _text(c, MARGIN, y, f'{i + 1}.', 9.5, MUTED)
            _text(c, MARGIN + 8 * MM, y, _fit(c, m.get('text') or '', 150 * MM, 9.5), 9.5, WARN if m.get('over') else INK)
            if m.get('over'):
                _text(c, PAGE_W - MARGIN, y, '허용 넘음', 8.5, WARN, 'right')
            c.setStrokeColor(LINE)
            c.line(MARGIN, y - 2.5 * MM, PAGE_W - MARGIN, y - 2.5 * MM)
            y -= 6.5 * MM
        _footer(c, page, total, note)
        c.showPage()
    c.save()
    return out.getvalue()


def process(data):
    if not isinstance(data, dict) or data.get('action') != 'punch':
        raise ValueError('보고서 요청 형식이 올바르지 않습니다.')
    return {'data': base64.b64encode(render(data)).decode()}
