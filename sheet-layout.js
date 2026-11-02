// 도면 세트를 도곽(시트)에 담는다: 바른 CAD 기본 도곽 양식 + 시트 채우기 + 번호·목록.
// 양식은 데이터라서 사용자 사무소 도곽으로 바꿔 끼울 수 있다(request.sheetTemplate 또는 doc.sheetTemplate).
// 단위: 양식은 용지 mm, 도면에 그릴 때 축척 분모를 곱한다(1/100 이면 용지 1mm = 도면 100mm).

import {sheetFrameBlock} from './sheet-frame-block.js';

export const PAPERS = {A3: [420, 297], A2: [594, 420], A1: [841, 594], A0: [1189, 841]};

export const DEFAULT_SHEET_TEMPLATE = {
  name: '바른 CAD 기본 도곽',
  style: 'air',   // 2026-10-13 사용자 "애플스타일로": 상자 대신 가는 구분선 · 회색 작은 이름표 · 강조색 하나 · 도면번호를 가장 크게(아래 drawAirFrame). rows 는 다른 양식용
  paper: 'A3',
  margins: {left: 20, right: 10, top: 10, bottom: 10},   // 왼쪽은 철하는 여백
  titleWidth: 50,                                         // 오른쪽 표제란 폭(2026-10-13 사용자: 75 의 2/3)
  pad: 6,                                                 // 그림과 테두리 사이 여백
  planDetails: {width: 50, gap: 6, titleSpace: 22, radius: 3},   // 평면 시트 오른쪽 상세 칸(용지 mm): 폭·평면과 띄움·제목 자리·둥근 모서리(생성기는 drawing-standard paperSizes.detailSlotCornerRadius 3 을 쓴다)
  // 그림 제목(번호 원+제목+축척) 고정 자리(사장님 시안 확정 2026-10-25): 평면 칸(상세 칸을 뺀 그림 칸) 오른쪽 아래 —
  // 제목 묶음 오른쪽 끝 = 평면 칸 오른쪽 선, 번호 원 중심 = 도곽 안쪽 선에서 종이 12 mm 위
  titleAnchor: {corner: 'right', fromFrameBottom: 12, inset: 6},   // inset: 평면 칸 오른쪽 선에서 안쪽으로(시안 6 mm)
  frameLayer: 'A-TITLE',
  textLayer: 'A-TEXT',
  // 표제란 칸(위에서 아래로). height 는 용지 mm, size 는 글자 높이 mm. rest 는 남는 높이를 모두 쓴다. fill 은 칸 바탕 솔리드 색.
  // 2026-10-13 사용자 "도각 자체를 이쁘게 · 솔리드 · 이름(사업명)은 위에 · 도면 넘버링": 맨 위 진한 띠 + 사업명, 아래로 도면명 · 큰 도면번호(장 순번)
  rows: [
    {key: 'band', height: 4, fill: '#1f2a30'},
    {key: 'project', label: '사업명 PROJECT', height: 30, size: 4.5},
    {key: 'office', height: 14, size: 3.5, value: '바른 CAD'},
    {key: 'notes', label: '상세 노트', rest: true, size: 2.5},   // 이 장에 나온 상세 번호 · 이름 · 실린 시트
    {key: 'revision', label: '개정', height: 30, size: 2.5, columns: ['번호', '내용', '일자']},
    {key: 'signs', height: 16, cells: ['설계', '작성', '검토']},
    {key: 'scale', label: '축척', height: 12, size: 3, pair: {key: 'paper', label: '용지'}},
    {key: 'date', label: '일자', height: 12, size: 3, pair: {key: 'purpose', label: '발행 목적'}},   // 발행 목적: 검토용·허가용·시공용(체크리스트 077)
    {key: 'title', label: '도면명 DRAWING TITLE', height: 24, size: 4.2},
    {key: 'number', label: '도면번호 DWG NO.', height: 28, size: 8, fill: '#dde8ee', count: true},   // 큰 번호 + 장 순번(03 / 15)
  ],
};

// 양식 한 장의 용지 크기와 그림이 들어갈 칸(용지 mm, 용지 왼쪽 아래가 0,0)
export function sheetGeometry(template = DEFAULT_SHEET_TEMPLATE, paper = template.paper) {
  const [W, H] = PAPERS[paper] || PAPERS.A3, m = template.margins;
  const frame = {minX: m.left, minY: m.bottom, maxX: W - m.right, maxY: H - m.top};
  const title = {minX: frame.maxX - template.titleWidth, minY: frame.minY, maxX: frame.maxX, maxY: frame.maxY};
  const draw = {minX: frame.minX + template.pad, minY: frame.minY + template.pad, maxX: title.minX - template.pad, maxY: frame.maxY - template.pad};
  // 평면 시트(2026-10-23 사용자 "평면구성기준"): 왼쪽 큰 칸 = 평면, 오른쪽 좁은 칸 = 해당층 상세도 2개 위아래
  const d = template.planDetails, A = template.titleAnchor || DEFAULT_SHEET_TEMPLATE.titleAnchor;
  const anchorAt = (box) => ({corner: A.corner || 'right', x: A.corner === 'left' ? box.minX + (A.inset || 0) : box.maxX - (A.inset || 0), y: frame.minY + A.fromFrameBottom});
  // planCenter: 평면 칸 전체(그림 칸 왼쪽 선 ~ 상세 칸 앞, 위 선 ~ 아래 선, 제목 줄 포함) — 대각선 교점 = 평면 중심(사장님 2026-10-25)
  if (!d) return {paper, W, H, frame, title, draw, plan: draw, planCenter: draw, planTitle: null, detailSlots: [], titleAnchor: anchorAt(draw)};
  const x0 = draw.maxX - d.width, half = (draw.maxY - draw.minY) / 2;
  const plan = {...draw, minY: draw.minY + d.titleSpace, maxX: x0 - d.gap}, planTitle = {...plan, minY: draw.minY, maxY: plan.minY}, planCenter = {...draw, maxX: x0 - d.gap}, titleAnchor = anchorAt(planCenter);
  const detailSlots = [1, 0].map(i => ({minX: x0, maxX: draw.maxX, minY: draw.minY + i * half + d.titleSpace, maxY: draw.minY + (i + 1) * half - (i ? 0 : d.gap / 2)}));
  return {paper, W, H, frame, title, draw, plan, planCenter, planTitle, detailSlots, titleAnchor};
}

// 한 벌 템플릿(rules/knowledge/sheet-templates.json, 사장님 2026-10-25 확정) → 도곽 양식. 평면만·한 벌 모두 이 양식 하나로 그린다.
// 표제란 칸 모양(rows·style)은 기본 양식 그대로, 자리 숫자(여백·표제란 폭·상세 칸·제목 자리)는 템플릿에서.
export function sheetTemplateFrom(templates, base = DEFAULT_SHEET_TEMPLATE) {
  if (!templates?.sheets?.plan) throw Object.assign(Error('도면 템플릿(sheet-templates.json)이 없습니다. 서버 기준을 다시 받으세요.'), {code: 'sheet_template_missing'});
  const {sheet, frame, titleBlock: tb, drawZone: dz, titleMark} = templates, Z = templates.sheets.plan.zones, [lower, upper] = [...Z.detailSlots].sort((a, b) => a.minY - b.minY);
  return {...base, paper: templates.paper,
    margins: {left: frame.minX, right: sheet.W - frame.maxX, top: sheet.H - frame.maxY, bottom: frame.minY},
    titleWidth: tb.maxX - tb.minX, pad: dz.minX - frame.minX,
    planDetails: {width: upper.maxX - upper.minX, gap: upper.minX - Z.plan.maxX, titleSpace: lower.minY - dz.minY, radius: upper.radius},
    titleAnchor: {corner: 'right', fromFrameBottom: titleMark.anchor.centerY - frame.minY, inset: titleMark.anchor.insetX},
    templates};
}

// 그림이 들어가는 가장 작은 용지(세트 전체를 한 판형으로 맞출 때 쓴다). items: [{w, h, k}] (도면 mm, 축척 분모)
export function paperFor(items, template = DEFAULT_SHEET_TEMPLATE) {
  const papers = Object.keys(PAPERS), start = Math.max(0, papers.indexOf(template.paper));
  const fits = (paper) => {const g = sheetGeometry(template, paper);return items.every(it => it.w <= (g.draw.maxX - g.draw.minX) * it.k && it.h <= (g.draw.maxY - g.draw.minY) * it.k);};
  return papers.slice(start).find(fits) || papers.at(-1);
}

// 같은 축척 그림들을 시트에 채운다(MaxRects): 큰 그림부터, 이미 연 시트의 빈 사각형 중 가장 꼭 맞는 곳에 넣고
// 남은 빈 곳을 다시 쪼갠다. 키 큰 그림 옆·아래 빈 곳도 쓰므로 줄 단위로 쌓을 때보다 장 수가 줄어든다.
// items: [{w, h}] (도면 mm). 반환: [{paper, places: [{index, x, y}]}] — x,y 는 그림 칸 왼쪽 위 기준 도면 mm 오프셋(아래로 +).
export function packSheets(items, {denominator, template = DEFAULT_SHEET_TEMPLATE, gap = 1500, paper = paperFor(items.map(it => ({...it, k: denominator})), template)}) {
  const g = sheetGeometry(template, paper), W = (g.draw.maxX - g.draw.minX) * denominator, H = (g.draw.maxY - g.draw.minY) * denominator;
  const order = items.map((it, index) => ({...it, index})).sort((a, b) => b.w * b.h - a.w * a.h || a.index - b.index);
  const sheets = [], occupy = (sheet, x, y, w, h) => occupyFree(sheet, x, y, w, h, gap);
  for (const it of order) {
    let sheet = sheets.find(s => fitIn(s, it.w, it.h));
    if (!sheet) {sheet = {paper, places: [], free: [{x: 0, y: 0, w: Math.max(W, it.w), h: Math.max(H, it.h)}]};sheets.push(sheet);}
    const r = fitIn(sheet, it.w, it.h);
    sheet.places.push({index: it.index, x: r.x, y: r.y});
    occupy(sheet, r.x, r.y, it.w, it.h);
  }
  // 장 순서는 그 장에 든 첫 그림 순서대로(평면 1층이 앞장)
  return sheets.map(({paper, places, free}) => ({paper, places: places.sort((a, b) => a.index - b.index), free})).sort((a, b) => a.places[0].index - b.places[0].index);
}
function fitIn(sheet, w, h) {   // 짧은 쪽 남는 길이가 가장 작은 빈 사각형
  let best = null;
  for (const r of sheet.free) if (w <= r.w && h <= r.h) {const score = Math.min(r.w - w, r.h - h);if (!best || score < best.score || (score === best.score && (r.y < best.r.y || (r.y === best.r.y && r.x < best.r.x)))) best = {r, score};}
  return best?.r;
}
function occupyFree(sheet, x, y, w, h, gap) {   // 차지한 칸(+간격)과 겹치는 빈 사각형을 쪼개고, 다른 것에 들어 있는 빈 사각형은 지운다
  const ox = x + w + gap, oy = y + h + gap, next = [];
  for (const r of sheet.free) {
    if (x >= r.x + r.w || ox <= r.x || y >= r.y + r.h || oy <= r.y) {next.push(r);continue;}
    if (x > r.x) next.push({x: r.x, y: r.y, w: x - r.x, h: r.h});
    if (ox < r.x + r.w) next.push({x: ox, y: r.y, w: r.x + r.w - ox, h: r.h});
    if (y > r.y) next.push({x: r.x, y: r.y, w: r.w, h: y - r.y});
    if (oy < r.y + r.h) next.push({x: r.x, y: oy, w: r.w, h: r.y + r.h - oy});
  }
  sheet.free = next.filter((a, i) => !next.some((b, j) => j !== i && a.x >= b.x && a.y >= b.y && a.x + a.w <= b.x + b.w && a.y + a.h <= b.y + b.h && (j < i || a.x !== b.x || a.y !== b.y || a.w !== b.w || a.h !== b.h)));
}
// 이미 채운 장의 빈 곳에 그림 하나를 더 넣는다(빈칸 채우기, 2026-10-13 사용자 "도곽에는 빈칸이 최대한 없어야"). 들어가면 {x, y}, 아니면 null
export function fillFree(page, w, h, gap = 1500) {
  const r = page.free && fitIn(page, w, h);if (!r) return null;
  const at = {x: r.x, y: r.y};occupyFree(page, r.x, r.y, w, h, gap);return at;
}

// 도곽 한 장을 그린다. g = 그리기 도구(line(a,b,layer), text(p,t,h,layer,extra)), at = 용지 왼쪽 아래의 도면 좌표, k = 축척 분모.
export function drawSheetFrame(g, {at, k, fields = {}, template = DEFAULT_SHEET_TEMPLATE, paper = template.paper}) {
  if (g.block) {return sheetFrameBlock(g, drawFrameContents, sheetGeometry, {at, k, fields, template, paper});}
  return drawFrameContents(g, {at, k, fields, template, paper});
}
function drawFrameContents(g, {at, k, fields, template, paper}) {
  // Legacy primitive collectors (structural preview) can still consume the form.
  g = {...g, attribute: g.attribute || ((tag, ...args) => g.text(...args))};
  if (template.style === 'air') return drawAirFrame(g, {at, k, fields, template, paper});
  const geo = sheetGeometry(template, paper), P = (x, y) => [at.x + x * k, at.y + y * k];
  const L = template.frameLayer, T = template.textLayer;
  const box = (b) => {g.line(P(b.minX, b.minY), P(b.maxX, b.minY), L);g.line(P(b.maxX, b.minY), P(b.maxX, b.maxY), L);g.line(P(b.maxX, b.maxY), P(b.minX, b.maxY), L);g.line(P(b.minX, b.maxY), P(b.minX, b.minY), L);};
  box({minX: 0, minY: 0, maxX: geo.W, maxY: geo.H});   // 용지 경계(자를 선)
  box(geo.frame);g.line(P(geo.title.minX, geo.frame.minY), P(geo.title.minX, geo.frame.maxY), L);
  const tx = geo.title.minX, tw = template.titleWidth, labelSize = 2.5;   // 종이 위 최소 글자 2.5 mm(체크리스트 012)
  let top = geo.frame.maxY;
  const fixed = template.rows.filter(r => !r.rest).reduce((s, r) => s + r.height, 0);
  for (const row of template.rows) {
    const h = row.rest ? geo.frame.maxY - geo.frame.minY - fixed : row.height, bottom = top - h;
    if (row.fill) g.fill?.([P(tx, bottom), P(tx + tw, bottom), P(tx + tw, top), P(tx, top)], L, row.fill);   // 칸 바탕 솔리드
    if (bottom > geo.frame.minY + 0.01) g.line(P(tx, bottom), P(tx + tw, bottom), L);
    const value = fields[row.key] ?? row.value ?? '';
    if (!row.label && !row.value && !fields[row.key] && row.fill) {top = bottom;continue;}   // 띠(글 없음)
    if (row.count) {   // 도면번호: 가운데 크게 + 오른쪽 아래 장 순번
      g.text(P(tx + 1.5, top - 1.5 - labelSize), row.label, labelSize * k, T);
      g.attribute(row.key, P(tx + tw / 2, bottom + (h - labelSize - 2) / 2 - row.size / 2 + 1), String(value), row.size * k, T, {align: 'center'});
      g.attribute('SHEET_COUNT', P(tx + tw - 2, bottom + 1.5), fields.sheetIndex && fields.sheetCount ? `${String(fields.sheetIndex).padStart(2, '0')} / ${String(fields.sheetCount).padStart(2, '0')}` : '', labelSize * k, T, {align: 'right'});
      top = bottom;continue;
    }
    if (row.cells) {
      const cw = tw / row.cells.length;
      row.cells.forEach((name, i) => {
        if (i) g.line(P(tx + cw * i, top), P(tx + cw * i, bottom), L);
        g.text(P(tx + cw * i + 1.5, top - 1.5 - labelSize), name, labelSize * k, T);
        const v = fields[row.key]?.[i];g.attribute(`${row.key}_${i + 1}`, P(tx + cw * i + 1.5, bottom + 3), String(v ?? ''), 3 * k, T);
      });
    } else if (row.columns) {
      g.text(P(tx + 1.5, top - 1.5 - labelSize), row.label, labelSize * k, T);
      const head = top - 1.5 - labelSize * 2 - 2, cw = [12, tw - 34, 22];   // 칸 이름(개정) 아래에 머리글
      g.line(P(tx, head - 1.5), P(tx + tw, head - 1.5), L);
      let cx = tx;row.columns.forEach((c, i) => {g.text(P(cx + 1.5, head), c, labelSize * k, T);cx += cw[i];if (i < row.columns.length - 1) g.line(P(cx, head + labelSize + 1), P(cx, bottom), L);});
      Array.from({length: 3}, (_, r) => fields.revisions?.slice(-3)[r] || []).forEach((rev, r) => {let px = tx;row.columns.forEach((_, i) => {const cell = rev[i] ?? '';g.attribute(`REVISION_${r + 1}_${i + 1}`, P(px + 1.5, head - 1.5 - (r + 1) * (row.size + 2)), String(cell), row.size * k, T);px += cw[i];});});
    } else if (row.key === 'notes') {
      g.text(P(tx + 1.5, top - 1.5 - labelSize), row.label, labelSize * k, T);
      const step = row.size * 1.6, capacity = Math.max(1, Math.floor((h - labelSize - 5) / step)), per = Math.floor((tw - 4) / (row.size * 0.9));
      let lines = (fields.notes || []).flatMap((note) => wrap(String(note), per).map((l, i) => (i ? '   ' : '') + l));
      if (lines.length > capacity) lines = [...lines.slice(0, capacity - 1), `… 외 ${lines.length - capacity + 1}줄`];
      Array.from({length: capacity}, (_, i) => lines[i] || '').forEach((line, i) => g.attribute(`NOTES_${i + 1}`, P(tx + 2, top - labelSize - 4 - (i + 1) * step + row.size * 0.6), line, row.size * k, T));
    } else if (row.pair) {
      const half = tw / 2;g.line(P(tx + half, top), P(tx + half, bottom), L);
      g.text(P(tx + 1.5, top - 1.5 - labelSize), row.label, labelSize * k, T);
      g.text(P(tx + half + 1.5, top - 1.5 - labelSize), row.pair.label, labelSize * k, T);
      g.attribute(row.key, P(tx + half - 2, bottom + 2), String(value), row.size * k, T, {align: 'right'});
      g.attribute(row.pair.key, P(tx + tw - 2, bottom + 2), String(fields[row.pair.key] ?? ''), row.size * k, T, {align: 'right'});
    } else {
      if (row.label) g.text(P(tx + 1.5, top - 1.5 - labelSize), row.label, labelSize * k, T);
      // 긴 글(사업명·도면명)은 칸 폭에 맞춰 두 줄까지
      const lines = wrap(String(value), Math.floor((tw - 4) / (row.size * 0.95))).slice(0, 2);
      Array.from({length: 2}, (_, i) => lines[i] || '').forEach((line, i) => g.attribute(i ? `${row.key}_2` : row.key, P(tx + tw / 2, bottom + (h - (row.label ? labelSize + 2 : 0)) / 2 - row.size / 2 + (1 - i * 2) * row.size * 0.7), line, row.size * k, T, {align: 'center'}));
    }
    top = bottom;
  }
  g.attribute('ASSUMED_NOTE',P(geo.title.minX+2,geo.title.minY+2),fields.assumedNote || '',2.5*k,T,{widthFactor:0.5});
  return {bounds: {minX: at.x, minY: at.y, maxX: at.x + geo.W * k, maxY: at.y + geo.H * k},
    draw: {minX: at.x + geo.draw.minX * k, minY: at.y + geo.draw.minY * k, maxX: at.x + geo.draw.maxX * k, maxY: at.y + geo.draw.maxY * k}};
}

/* 바른 에어 도곽(애플 스타일): 오른쪽 띠 안에 위→아래 [진한 띠 · 로고 · 사업명] [상세 노트] … 아래→위 [도면번호(가장 크게) · 도면명 · 축척·용지·일자·발행 목적 · 서명 · 개정].
   상자 없이 안쪽으로 들인 가는 구분선만, 이름표는 회색 2.5 mm, 값은 검정. 솔리드는 맨 위 띠와 로고 칸 둘. */
const AIR = {ink: '#1d1d1f', gray: '#86868b', accent: '#9dcbe0', hair: 0.13, frame: 0.35};
function drawAirFrame(g, {at, k, fields, template, paper}) {
  const geo = sheetGeometry(template, paper), P = (x, y) => [at.x + x * k, at.y + y * k];
  const L = template.frameLayer, T = template.textLayer, tx = geo.title.minX, tw = template.titleWidth, x0 = tx + 4, x1 = tx + tw - 4, lab = 2.5;
  const line = (a, b, w = AIR.hair) => g.line(P(...a), P(...b), L, {lineweight: w});
  const text = (x, y, t, size, extra = {}) => g.text(P(x, y), String(t), size * k, T, extra);
  const attr = (tag, x, y, value, size, extra = {}) => g.attribute(tag, P(x, y), value ?? '', size * k, T, extra);
  const label = (x, y, t, extra = {}) => text(x, y, t, lab, {color: AIR.gray, ...extra});
  const rect = (a, b, color) => g.fill?.([P(a[0], a[1]), P(b[0], a[1]), P(b[0], b[1]), P(a[0], b[1])], L, color);
  const F = geo.frame, W = geo.W, H = geo.H;
  // 용지 경계(자를 선, 가는 선) · 테두리(굵은 선) · 띠 경계
  for (const [a, b] of [[[0, 0], [W, 0]], [[W, 0], [W, H]], [[W, H], [0, H]], [[0, H], [0, 0]]]) line(a, b);
  for (const [a, b] of [[[F.minX, F.minY], [F.maxX, F.minY]], [[F.maxX, F.minY], [F.maxX, F.maxY]], [[F.maxX, F.maxY], [F.minX, F.maxY]], [[F.minX, F.maxY], [F.minX, F.minY]]]) line(a, b, AIR.frame);
  line([tx, F.minY], [tx, F.maxY], AIR.frame);
  const hr = (y) => line([x0, y], [x1, y]);
  const lines = (t, size, per = Math.floor((x1 - x0) / (size * 0.95))) => wrap(String(t || ''), per).slice(0, 2);
  // ── 위: 진한 띠 · 로고 · 사업명
  let y = F.maxY;
  rect([tx, y - 2.5], [tx + tw, y], AIR.ink);
  y -= 10;rect([x0, y], [x0 + 3.5, y + 3.5], AIR.accent);attr('OFFICE', x0 + 5.5, y + 0.3, fields.office || template.office || '바른 CAD', 3);
  y -= 8;label(x0, y, '사업명 PROJECT');
  const projectLines = lines(fields.project, 5);
  for (let i = 0; i < 2; i++) {y -= 7;attr(i ? 'PROJECT_2' : 'PROJECT', x0, y, projectLines[i], 5);}
  y -= 5;hr(y);const notesTop = y;
  // ── 아래: 도면번호 · 도면명 · 정보 · 서명 · 개정 (아래에서 위로)
  let b0 = F.minY + 5;
  attr('NUMBER', x0, b0, fields.number || '', 10);
  attr('SHEET_COUNT', x1, b0, fields.sheetIndex && fields.sheetCount ? `${String(fields.sheetIndex).padStart(2, '0')} / ${String(fields.sheetCount).padStart(2, '0')}` : '', lab, {align: 'right', color: AIR.gray});
  label(x0, b0 + 13, '도면번호 DWG NO.');
  b0 += 19;hr(b0);
  // 도면명은 두 줄 안에 다 들어가게 — 넘치면 자르지 않고 글자를 이름표 크기(2.5 mm)까지 줄인다(2026-10-30 '(창대·창 인방 외' 처럼 ')' 가 잘렸다)
  const ts = [4.2, 3, lab].find((s) => s === lab || wrap(String(fields.title || ''), Math.floor((x1 - x0) / (s * 0.95))).length <= 2);   // 줄일 때도 도곽에 이미 쓰는 크기(3·2.5)로 — 새 크기를 만들면 문자 크기 단계(품질 13)가 늘어난다
  const tl = lines(fitTitle(String(fields.title || ''), Math.floor((x1 - x0) / (ts * 0.95))), ts);b0 += 4;
  for (let i = 1; i >= 0; i--) {attr(i ? 'TITLE_2' : 'TITLE', x0, b0, tl[i], ts);b0 += 6;}
  label(x0, b0 + 1, '도면명 TITLE');b0 += 7;hr(b0);
  const mid = (x0 + x1) / 2 + 2, cell = (tag, x, yy, name, v) => {label(x, yy + 5, name);attr(tag, x, yy, v, 3);};
  b0 += 4;cell('DATE', x0, b0, '일자', fields.date);cell('PURPOSE', mid, b0, '발행 목적', fields.purpose);
  b0 += 12;cell('SCALE', x0, b0, '축척', fields.scale);cell('PAPER', mid, b0, '용지', fields.paper);
  b0 += 10;hr(b0);
  // 서명: 이름표 아래 빈 줄(서명 자리)
  const sw = (x1 - x0) / 3;b0 += 3;
  ['설계', '작성', '검토'].forEach((s, i) => {line([x0 + sw * i, b0], [x0 + sw * (i + 1) - 2, b0]);label(x0 + sw * i, b0 + 6, s);attr(`SIGNS_${i + 1}`, x0 + sw * i, b0 + 1, fields.signs?.[i], 3);});
  b0 += 11;hr(b0);
  // 개정: 머리글 한 줄 + 기록
  const cw = [8, x1 - x0 - 26, 18], cols = ['번호', '내용', '일자'];
  const revs = (fields.revisions || []).slice(-3);b0 += 3;
  for (let r = 2; r >= 0; r--) {let px = x0;cols.forEach((_, i) => {attr(`REVISION_${r + 1}_${i + 1}`, px, b0, revs[r]?.[i], 2.5);px += cw[i];});b0 += 4.5;}
  let px = x0;cols.forEach((c, i) => {label(px, b0, c);px += cw[i];});
  label(x0, b0 + 6, '개정 REVISION');b0 += 11;hr(b0);
  // ── 가운데: 상세 노트(남는 높이)
  const step = 4.2, per = Math.floor((x1 - x0) / (2.5 * 0.9));
  let ny = notesTop - 7;label(x0, ny, '상세 노트');
  attr('ASSUMED_NOTE',x0,b0+3,fields.assumedNote,2.5,{widthFactor:0.5});
  const room = Math.max(1, Math.floor((ny - b0 - 10) / step));
  let notes = (fields.notes || []).flatMap((n) => wrap(String(n), per).map((l, i) => (i ? '   ' : '') + l));
  if (notes.length > room) notes = [...notes.slice(0, room - 1), `… 외 ${notes.length - room + 1}줄`];
  for (let i = 0; i < room; i++) {ny -= step;attr(`NOTES_${i + 1}`, x0, ny, notes[i], 2.5);}
  return {bounds: {minX: at.x, minY: at.y, maxX: at.x + W * k, maxY: at.y + H * k},
    draw: {minX: at.x + geo.draw.minX * k, minY: at.y + geo.draw.minY * k, maxX: at.x + geo.draw.maxX * k, maxY: at.y + geo.draw.maxY * k}};
}

export const sheetTitleAttributes = (title, per) => {const lines = wrap(String(title ?? ''), per).slice(0, 2);return {TITLE: lines[0] || '', TITLE_2: lines[1] || ''};};

// 가장 작은 글자로도 두 줄을 넘는 도면명은 끝('외 2)'·')')을 지키고 가운데를 '…'로 줄인다 — 잘라서 ')' 나 '외 N' 이 빠지면 안 된다(2026-10-30 괴정 상세 장)
export function fitTitle(title, per) {
  if (wrap(title, per).length <= 2) return title;
  const tail = title.match(/( 외 \d+\)| 외\)|\))$/)?.[0] || '';let body = [...title.slice(0, title.length - tail.length)];
  while (body.length > 4 && wrap(body.join('') + '…' + tail, per).length > 2) body.pop();
  return body.join('').replace(/[\s·(]+$/, '') + '…' + tail;
}
function wrap(text, per) {
  if (per < 2 || [...text].length <= per) return [text];
  const out = [];let line = '';
  for (const word of text.split(' ')) {if (line && [...(line + ' ' + word)].length > per) {out.push(line);line = word;} else line = line ? line + ' ' + word : word;}
  if (line) out.push(line);
  return out.flatMap(l => [...l].length > per ? [l.slice(0, per), l.slice(per)] : [l]);
}

// 시트 번호 체계(사용자 2026-10-25 한 벌 순서): 001 목록 · 002~ 개요 · 다음 번호 구적도 · 100 배치도 · 1xx 평면 · 2xx 입면 · 3xx 단면 · 4xx 창호도 · 5xx 상세(계단 먼저)
export const SHEET_SERIES = {index: 0, overview: 0, area: 0, site: 100, plan: 100, elevation: 200, section: 300, schedule: 400, stair: 500, detail: 500};
export const sheetNumber = (prefix, series, i) => `${prefix}-${String(series + i).padStart(3, '0')}`;
