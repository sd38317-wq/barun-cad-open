// 해치·표 11개: BPT GDD HC HP HPM HR HT RDS SHO TAJ DTT.
// 근거: docs/izzarder-reference-20260921/references/04-hatch-table.md(BPT/HC/HP/HPM/HR/HT/RDS/TAJ),
//       10-area-calc.md(GDD), 13-dim.md(SHO/DTT) — 각 함수 주석에 원문 번호(/NNN)를 적었다.
// 바른 CAD 의 hatch 객체는 {points,loops?,pattern:'lines'|'cross'|undefined,spacing,angle,solid,color?,layer}뿐이고
// (view.js:129-159 렌더러 확인) .pat 패턴 파일·해치 원점(origin)·무명 그룹·point 객체 타입이 없다.
// 그 경계 안에서 실제로 화면이 바뀌는 것만 만들고, 구조상 불가능한 것은 실행 시 토스트로 정직하게 알린다.
import * as G from './geometry.js';
import {boundedInteger, downloadText, safeFileName} from './card-input.js';
import {tileToPatDefinition, patFileText, patternName} from './pattern-files.js';

/* ══════════ 순수 함수(시험용, DOM 없이 동작) ══════════ */

// BPT(/292) 벽돌 패턴 만들기: .pat 파일 등록 대신, 선택한 경계의 사각 경계상자 안에
// 벽돌 줄눈(가로 켜 구분선 + 세로 줄눈선)을 LINE 으로 직접 그린다.
// bond:'running'(막힌줄눈, 한 켜씩 반 장 엇갈림) | 'stack'(통줄눈, 세로줄 일직선).
export function brickCourseLines(box, {length, height1, height2, joint, bond = 'running'} = {}) {
  if (!box) throw Error('경계 상자를 확인할 수 없습니다.');
  const {minX, minY, maxX, maxY} = box;
  if (!(maxX - minX > 1e-6) || !(maxY - minY > 1e-6)) throw Error('경계의 폭/높이가 0보다 커야 합니다.');
  if (!(length >= 50)) throw Error('벽돌 길이는 50mm 이상이어야 합니다.');
  if (!(height1 > 0) || !(height2 > 0)) throw Error('벽돌 높이는 0보다 커야 합니다.');
  if (!(joint >= 0)) throw Error('줄눈 두께는 0 이상이어야 합니다.');
  const segs = [], rows = [];
  let y = minY, idx = 0;
  while (y < maxY - 1e-6 && idx < 5000) {
    const y1 = Math.min(y + (idx % 2 === 0 ? height1 : height2), maxY);
    rows.push({y0: y, y1});
    if (y1 < maxY - 1e-6) segs.push([{x: minX, y: y1}, {x: maxX, y: y1}]);
    y = y1; idx++;
  }
  const step = length + joint;
  rows.forEach((row, r) => {
    const start = bond === 'running' && r % 2 === 1 ? length / 2 : length;
    let x = minX + start, guard = 0;
    while (x < maxX - 1e-6 && guard < 5000) {
      segs.push([{x, y: row.y0}, {x, y: row.y1}]);
      x += step; guard++;
    }
  });
  return segs;
}

// GDD(/137) 입면 줄눈 나누기: 간격을 기준 폭에 가장 가까운 등분수로 나눈다.
export function divideGap(length, moduleWidth) {
  if (!(length > 0)) throw Error('간격은 0보다 커야 합니다.');
  if (!(moduleWidth > 0)) throw Error('기준 폭은 0보다 커야 합니다.');
  const n = Math.max(1, Math.round(length / moduleWidth));
  return {n, width: length / n};
}
// 정렬된(혹은 정렬 전) 중심선 x 좌표 목록을 받아, 인접한 두 중심선 사이마다 등분 내부 줄눈을 만든다.
export function gddJoints(xs, moduleWidth, yMin, yMax) {
  if (!Array.isArray(xs) || xs.length < 2) throw Error('중심선이 2개 이상 필요합니다.');
  const sorted = [...xs].sort((a, b) => a - b), segs = [];
  for (let i = 0; i < sorted.length - 1; i++) {
    const x0 = sorted[i], x1 = sorted[i + 1], gap = x1 - x0;
    if (gap <= 1e-6) continue;
    const {n, width} = divideGap(gap, moduleWidth);
    for (let k = 1; k < n; k++) {
      const x = x0 + width * k;
      segs.push([{x, y: yMin}, {x, y: yMax}]);
    }
  }
  return segs;
}

// HT(/266) 두께 입력 해치: 두 점을 지정하면(순서 무관) 그 사이 기준 두께만큼의 사각 영역을 만든다.
export function thicknessRectangle(p1, p2, thickness) {
  if (!(thickness > 0)) throw Error('두께는 0보다 커야 합니다.');
  const u = G.unit(G.sub(p2, p1)), n = G.normal(u), half = thickness / 2;
  return [G.add(p1, G.mul(n, half)), G.add(p2, G.mul(n, half)), G.add(p2, G.mul(n, -half)), G.add(p1, G.mul(n, -half))];
}

// HC(/267) 해치 복제에 쓰는, 원본 해치에서 옮길 속성만 뽑는다.
export function cloneHatchStyle(source) {
  if (!source || source.type !== 'hatch') throw Error('해치 객체가 아닙니다.');
  const {pattern, solid, spacing, hatchScale, angle, color, linetype, layer} = source;
  return {pattern, solid, spacing, hatchScale, angle, color, linetype, layer};
}

// SHO(/599) 해치 내부 객체로 해치 선택: 점(이 앱은 point 타입이 없어 문자 위치로 대신한다)이
// 포함된 해치를 모두 찾는다. 해치 루프(구멍) 안이면 제외한다.
export function hatchContainsPoint(hatch, point) {
  if (!hatch?.points || !point) return false;
  // 여러 영역 해치(한 HATCH 에서 찍은 칸들)도 짝홀 규칙으로: 어느 영역 안이고 구멍 밖이면 포함.
  return G.hatchContains(hatch, point);
}
export function selectHatchesByObjects(hatches, markers) {
  const ids = new Set();
  for (const m of markers || []) {
    if (!m?.position) continue;
    for (const h of hatches || []) if (hatchContainsPoint(h, m.position)) ids.add(h.id);
  }
  return [...ids];
}
export function filterMarkersByText(markers, text) {
  return (markers || []).filter((m) => typeof m.text === 'string' && m.text.includes(text));
}

// RDS(/478) 무작위 솔리드 해치: 화면에 있는 서로 다른 솔리드 색을 모아 무작위로 고르고,
// 같은 대상(id)에는 같은 색을 "기억"한다(엔티티 id → 색 매핑, XDATA 대용).
export function pickRandomColor(existingColors, usedMap, targetId, fallbackPalette, rand = Math.random) {
  const map = usedMap || {};
  if (map[targetId]) return {color: map[targetId], map, usedFallback: false, remembered: true};
  const usedFallback = (existingColors || []).length < 3;
  const palette = usedFallback ? fallbackPalette : existingColors;
  if (!palette?.length) throw Error('고를 색이 없습니다.');
  const color = palette[Math.min(palette.length - 1, Math.floor(rand() * palette.length))];
  return {color, map: {...map, [targetId]: color}, usedFallback, remembered: false};
}

// HR(/326) 해치 꺼내쓰기: 1~9번 슬롯에 해치 값을 저장/불러온다(9행 그리드 대화상자 대신 폼 하나).
export function savePresetSlot(presets, slot, value) {
  if (!Number.isInteger(slot) || slot < 1 || slot > 9) throw Error('슬롯 번호는 1~9 사이여야 합니다.');
  return {...(presets || {}), [slot]: {...value}};
}
export function applyPresetSlot(presets, slot) {
  if (!Number.isInteger(slot) || slot < 1 || slot > 9) throw Error('슬롯 번호는 1~9 사이여야 합니다.');
  const p = presets?.[slot];
  if (!p) throw Error(`${slot}번 슬롯에 저장된 해치가 없습니다. 먼저 저장하세요.`);
  return p;
}

// HP(/294) 해치 기준점 변경: 2026-09-24 실제 동작. 해치에 origin(무늬 기준점)을 넣으면 화면(view.js)·출력(plot.js·
// pdf_service.py)·DXF(exchange.py)가 모두 이 점을 지나도록 무늬 선을 맞춘다. 원래 값이 없던 해치는 예전 그대로 그린다.
export function hatchOriginChanges(hatch, point) {
  if (!hatch || hatch.type !== 'hatch') throw Error('HP · 해치를 선택하세요.');
  if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) throw Error('HP · 기준점이 올바르지 않습니다.');
  if (hatch.solid) return null; // 단색 채움은 무늬 선이 없어 기준점이 의미 없다
  return {origin: {x: point.x, y: point.y}};
}

// HPM(/459) 해치문양 만들기: 2026-09-24 실제 동작. 원문처럼 100×100 상자를 그려 주고(1단계), 그 안에 그린 선·점을
// 반복 무늬(.pat)로 저장한다(2단계). 원문도 결과를 .pat 파일로 저장해 캐드 무늬 파일에 붙여 넣는 방식이다.
export const HPM_BOX_SIZE = 100;
export function hpmTileContents(entities, tile, tolerance = 1e-6) {
  const inside = (p) => p.x >= tile.minX - tolerance && p.x <= tile.maxX + tolerance && p.y >= tile.minY - tolerance && p.y <= tile.maxY + tolerance;
  const segments = [], points = [];
  let ignored = 0;
  for (const e of entities || []) {
    if (e.type === 'line' && e.points?.length >= 2) {
      if (inside(e.points[0]) && inside(e.points[1])) segments.push([e.points[0], e.points[1]]);
    } else if (e.type === 'point' && e.position) {
      if (inside(e.position)) points.push(e.position);
    } else {
      const b = G.bounds([e]);
      if (b && inside({x: b.minX, y: b.minY}) && inside({x: b.maxX, y: b.maxY}) && !(Math.abs(b.minX - tile.minX) < tolerance && Math.abs(b.maxX - tile.maxX) < tolerance && Math.abs(b.minY - tile.minY) < tolerance && Math.abs(b.maxY - tile.maxY) < tolerance)) ignored++;
    }
  }
  return {segments, points, ignored};
}

// DTT(/601) 치수목록을 표로: 재정의 문자 없이 계산한 실측 표시문자를 얻는다.
export function dimMeasuredValue(dim) {
  if (!dim || dim.type !== 'dimension') throw Error('치수 객체가 아닙니다.');
  const clone = {...dim};
  delete clone.text; delete clone.textTemplate;
  const label = G.dimensionParts(clone).find((p) => p.dimensionLabel);
  return label ? label.text : '';
}
// 선택한 치수들에 번호(접두어 포함)를 매기고 표 행으로 만든다. order:'selection'|'position'.
export function numberedRows(dims, {prefix = '', order = 'selection'} = {}) {
  const items = dims.map((d, i) => ({d, i}));
  if (order === 'position') items.sort((a, b) => {
    const ka = a.d.textPosition || a.d.points?.[0] || {x: 0, y: 0}, kb = b.d.textPosition || b.d.points?.[0] || {x: 0, y: 0};
    return ka.x - kb.x || ka.y - kb.y;
  });
  return items.map((it, idx) => ({no: `${prefix}(${idx + 1})`, text: dimMeasuredValue(it.d)}));
}

// DTT/TAJ 공용: 왼쪽 위 origin 기준으로 선+문자 그리드 표를 만든다(+y 위 좌표계).
export function buildTableGeometry({origin, colWidths, rowHeight, rows, textHeight = 150}) {
  if (!origin || !Array.isArray(colWidths) || !colWidths.length) throw Error('표 위치/열 폭이 올바르지 않습니다.');
  if (!Array.isArray(rows) || !rows.length) throw Error('표에 넣을 행이 없습니다.');
  const totalW = colWidths.reduce((a, b) => a + b, 0), totalH = rows.length * rowHeight, lines = [];
  for (let r = 0; r <= rows.length; r++) {
    const y = origin.y - r * rowHeight;
    lines.push([{x: origin.x, y}, {x: origin.x + totalW, y}]);
  }
  let x = origin.x;
  const xs = [x];
  for (const w of colWidths) {x += w; xs.push(x);}
  for (const cx of xs) lines.push([{x: cx, y: origin.y}, {x: cx, y: origin.y - totalH}]);
  const texts = [];
  rows.forEach((row, r) => {
    let cx = origin.x;
    for (let c = 0; c < colWidths.length; c++) {
      const w = colWidths[c];
      texts.push({position: {x: cx + w / 2, y: origin.y - r * rowHeight - rowHeight / 2 - textHeight * 0.35}, text: String(row[c] ?? ''), height: textHeight});
      cx += w;
    }
  });
  return {lines, texts, totalW, totalH};
}
// TAJ(/305) 문자에 맞춰 표 폭 자동정리: 각 열에서 가장 긴 문자열 길이로 폭을 계산한다.
/** 고른 선(또는 칸 안 글자)이 속한 표 격자를 도면에서 읽는다: 같은 레이어의 가로·세로 선 묶음과 칸 안 글자.
    { origin(왼쪽 위), rows(글자 표), textHeight, layer, lineIds, textIds } 또는 표가 아니면 null. */
export function tableFromGrid(entities, picked) {
  const tol = 1, horiz = (e) => Math.abs(e.points[0].y - e.points[1].y) < tol, vert = (e) => Math.abs(e.points[0].x - e.points[1].x) < tol;
  const lines = entities.filter((e) => e.type === 'line' && e.layer === picked.layer && e.points?.length === 2 && (horiz(e) || vert(e)));
  const box = (e) => ({minX: Math.min(e.points[0].x, e.points[1].x) - tol, maxX: Math.max(e.points[0].x, e.points[1].x) + tol, minY: Math.min(e.points[0].y, e.points[1].y) - tol, maxY: Math.max(e.points[0].y, e.points[1].y) + tol});
  const touch = (a, b) => { const p = box(a), q = box(b); return p.minX <= q.maxX && q.minX <= p.maxX && p.minY <= q.maxY && q.minY <= p.maxY; };
  let seed = picked.type === 'line' ? lines.find((l) => l.id === picked.id) : null;
  if (!seed && picked.type === 'text') seed = lines.find((l) => horiz(l) && Math.min(l.points[0].x, l.points[1].x) <= picked.position.x && Math.max(l.points[0].x, l.points[1].x) >= picked.position.x);
  if (!seed) return null;
  const group = [seed], left = lines.filter((l) => l !== seed);
  for (let i = 0; i < group.length; i++) for (let j = left.length - 1; j >= 0; j--) if (touch(group[i], left[j])) group.push(...left.splice(j, 1));
  const uniq = (v) => [...new Set(v.map((n) => Math.round(n)))].sort((a, b) => a - b);
  const xs = uniq(group.filter(vert).map((l) => l.points[0].x)), ys = uniq(group.filter(horiz).map((l) => l.points[0].y)).reverse();
  if (xs.length < 2 || ys.length < 2) return null;
  const texts = entities.filter((e) => e.type === 'text' && e.layer === picked.layer && e.position && e.position.x > xs[0] && e.position.x < xs.at(-1) && e.position.y < ys[0] && e.position.y > ys.at(-1));
  const rows = ys.slice(1).map(() => xs.slice(1).map(() => ''));
  for (const t of texts) { const r = ys.findIndex((y, k) => k > 0 && t.position.y >= y) - 1, c = xs.findIndex((x, k) => k > 0 && t.position.x <= x) - 1; if (r >= 0 && c >= 0) rows[r][c] = rows[r][c] ? rows[r][c] + ' ' + t.text : t.text; }
  const heights = texts.map((t) => t.height).filter((h) => h > 0).sort((a, b) => a - b);
  return {origin: {x: xs[0], y: ys[0]}, rows, textHeight: heights[Math.floor(heights.length / 2)] || 150, layer: picked.layer, lineIds: group.map((l) => l.id), textIds: texts.map((t) => t.id)};
}

export function autoColumnWidths(rows, {textHeight = 150, charWidth = 0.62, margin = 1, min} = {}) {
  if (!Array.isArray(rows) || !rows.length) throw Error('표 내용이 없습니다.');
  const nCols = Math.max(...rows.map((r) => r.length)), minW = min ?? textHeight * 1.6, widths = [];
  for (let c = 0; c < nCols; c++) {
    const maxLen = Math.max(...rows.map((r) => String(r[c] ?? '').length), 1);
    widths.push(Math.max(minW, maxLen * textHeight * charWidth + textHeight * margin * 2));
  }
  return widths;
}

/* ══════════ 화면 명령(install 안에서만 pick/dialog 를 쓴다) ══════════ */

export function installHatchTableTools(ctx) {
  const guard = (fn) => (...args) => {
    try {
      const r = fn(...args);
      if (r && typeof r.catch === 'function') r.catch((e) => {console.error('[card]', e); ctx.toast(ctx.userErrorMessage(e), true);});
    } catch (e) {console.error('[card]', e); ctx.toast(ctx.userErrorMessage(e), true);}
  };
  const afterClose = (job) => setTimeout(() => {(async () => {
    try {await job();} catch (e) {console.error('[card]', e); ctx.toast(ctx.userErrorMessage(e), true);}
  })();}, 0);
  const store = (key, fallback = {}) => {try {return JSON.parse(ctx.storage.getItem('hatch-table-tools:' + key) || 'null') ?? fallback;} catch {return fallback;}};
  const save = (key, value) => {try {ctx.storage.setItem('hatch-table-tools:' + key, JSON.stringify(value));} catch {}};

  // BPT — 벽돌 패턴 만들기(/292): .pat 등록은 못 하므로, 경계상자 안에 벽돌 줄눈 선을 직접 그린다.
  function bpt() {
    ctx.form('BPT · 벽돌 패턴 만들기(줄눈 선을 바로 그립니다 · .pat 등록은 지원하지 않음)', [
      {name: 'length', label: '벽돌 길이(mm, 최소 50)', type: 'number', value: 190},
      {name: 'height1', label: '첫번째 벽돌 높이(mm)', type: 'number', value: 60},
      {name: 'height2', label: '두번째 벽돌 높이(mm, 다르면 엇갈림)', type: 'number', value: 60},
      {name: 'joint', label: '줄눈 두께(mm, 0=무줄눈)', type: 'number', value: 10},
      {name: 'bond', label: '줄눈 형태', value: 'running', options: [['running', '막힌줄눈(엇갈림)'], ['stack', '통줄눈(일직선)']]},
    ], (values) => {
      const length = Number(values.length), height1 = Number(values.height1), height2 = Number(values.height2), joint = Number(values.joint);
      afterClose(async () => {
        const target = await ctx.pickEntity({prompt: 'BPT · 벽돌 패턴을 채울 폐곡선(사각형/닫힌 폴리선)을 선택하세요 · Esc 취소', types: ['polyline', 'rectangle']});
        if (!target) return;
        if (target.type === 'polyline' && !target.closed) throw Error('BPT · 닫힌 폴리선을 선택하세요.');
        const segs = brickCourseLines(G.bounds([target]), {length, height1, height2, joint, bond: values.bond});
        if (!segs.length) throw Error('BPT · 선택한 영역이 벽돌 한 켜보다 작습니다.');
        const layer = ctx.ensureLayer('A-WALL-MASN', '#c97b4a');
        ctx.commit({entities: segs.map((pts) => ({type: 'line', points: pts, layer}))});
        ctx.toast(`BPT · 벽돌 줄눈 선 ${segs.length}개를 그렸습니다(사각 경계상자 기준).`);
      });
    });
  }

  // GDD — 입면 줄눈 나누기(/137): 대화상자 없음(원문) → 이 앱은 폼으로 폭 하나만 받는다.
  async function gdd() {
    const lines = [];
    for (;;) {
      const e = await ctx.pickEntity({prompt: `GDD · 중심선을 선택하세요(선택 ${lines.length}개) · Esc 로 마침`, types: ['line', 'polyline']});
      if (!e) break;
      lines.push(e);
    }
    if (lines.length < 2) throw Error('GDD · 중심선을 2개 이상 선택하세요.');
    ctx.form('GDD · 입면 줄눈 나누기', [{name: 'width', label: '한 판의 기준 폭(mm)', type: 'number', value: 1200}], (values) => {
      const width = Number(values.width);
      if (!(width > 0)) throw Error('GDD · 기준 폭은 0보다 커야 합니다.');
      const xs = lines.map((l) => (l.points[0].x + l.points[l.points.length - 1].x) / 2);
      const ys = lines.flatMap((l) => l.points.map((p) => p.y));
      const segs = gddJoints(xs, width, Math.min(...ys), Math.max(...ys));
      if (!segs.length) throw Error('GDD · 이미 기준 폭과 같거나, 나눌 간격이 없습니다.');
      const layer = ctx.ensureLayer('A-ELEV-VIEW', '#9ad0ff'); // 입면 줄눈. A-ELEV 는 승강기(바른 레이어 세트)
      ctx.commit({entities: segs.map((pts) => ({type: 'line', points: pts, layer}))});
      ctx.toast(`GDD · 중심선 ${lines.length}개 사이에 줄눈 ${segs.length}개를 그렸습니다(기준 폭 ${width}).`);
    });
  }

  // HC — 해치 복제(/267): 대화상자 없음. 원본 해치 하나 → 새 경계 여러 개(같은 무늬로 반복 적용).
  async function hc() {
    const source = await ctx.pickEntity({prompt: 'HC · 복제할 원본 해치를 선택하세요 · Esc 취소', types: ['hatch']});
    if (!source) return;
    const style = cloneHatchStyle(source);
    let count = 0;
    for (;;) {
      const target = await ctx.pickEntity({prompt: `HC · 새 경계(닫힌 폴리선/사각형)를 선택하세요(복제 ${count}개) · Esc 로 마침`, types: ['polyline', 'rectangle']});
      if (!target) break;
      if (target.type === 'polyline' && !target.closed) {ctx.toast('HC · 닫힌 폴리선만 대상입니다.', true); continue;}
      ctx.commit({entities: [{type: 'hatch', points: target.points, ...style}]});
      count++;
    }
    ctx.toast(count ? `HC · 해치를 ${count}개 복제했습니다(같은 무늬·축척·각도·색).` : 'HC · 복제한 대상이 없습니다.');
  }

  // HP — 해치 기준점 변경(/294): 해치를 고르고(선택돼 있으면 그대로) 기준점을 찍으면 무늬 선이 그 점을 지나게 옮긴다.
  async function hp() {
    let hatches = ctx.selected().filter((e) => e.type === 'hatch');
    if (!hatches.length) {
      const picked = await ctx.pickEntity({prompt: 'HP · 기준점을 바꿀 해치를 선택하세요 · Esc 취소', types: ['hatch']});
      if (!picked) return;
      hatches = [picked];
    }
    const point = await ctx.pickPoint('HP · 무늬 기준점(좌하귀 등)을 지정하세요 · Esc 취소');
    if (!point) return;
    const locked = new Set(ctx.layers().filter((l) => l.locked).map((l) => l.id));
    const commands = [];
    let solid = 0, lockedCount = 0;
    for (const h of hatches) {
      if (locked.has(h.layer)) {lockedCount++; continue;}
      const changes = hatchOriginChanges(h, point);
      if (!changes) {solid++; continue;}
      commands.push({type: 'update', ids: [h.id], changes});
    }
    if (!commands.length) throw Error(solid ? 'HP · 단색 채움 해치는 무늬 선이 없어 기준점을 바꿀 대상이 없습니다.' : 'HP · 잠긴 켜의 해치는 바꿀 수 없습니다.');
    ctx.execute({type: 'batch', commands});
    ctx.refresh();
    ctx.toast(`HP · 해치 ${commands.length}개의 무늬 기준점을 (${Math.round(point.x)}, ${Math.round(point.y)}) 로 바꿨습니다${solid ? ` · 단색 ${solid}개 제외` : ''}${lockedCount ? ` · 잠긴 켜 ${lockedCount}개 제외` : ''} · Ctrl+Z 로 되돌리기`);
  }

  // HPM — 해치문양 만들기(/459): 1) 100×100 상자 그리기 2) 상자 안 선·점을 .pat 무늬로 저장.
  function hpm() {
    ctx.form('HPM · 해치문양 만들기', [
      {name: 'step', label: '단계', value: 'save', options: [['box', '1) 100×100 문양 상자 그리기'], ['save', '2) 상자 안 선·점을 무늬(.pat)로 저장']]},
      {name: 'name', label: '무늬 이름(영문·숫자)', type: 'text', value: 'USER_PAT'},
      {name: 'file', label: '파일 이름(.pat 은 자동)', type: 'text', value: 'user_pattern'},
    ], (values) => {
      afterClose(async () => {
        if (values.step === 'box') {
          const p = await ctx.pickPoint('HPM · 문양 상자(100×100)의 왼쪽 아래 점을 지정하세요 · Esc 취소');
          if (!p) return;
          const layer = ctx.ensureLayer('A-NOTE', '#ffad66'); // 문양 작업 상자(출력 박스 아님 — A-PLOT 이면 PPP 가 용지로 잡는다)
          ctx.commit({entities: [{type: 'rectangle', points: G.rectangle(p, {x: p.x + HPM_BOX_SIZE, y: p.y + HPM_BOX_SIZE}), layer, hpmBox: true}]});
          ctx.toast('HPM · 100×100 문양 상자를 그렸습니다. 상자 안에 선(LINE)·점으로 문양을 그린 뒤 HPM 을 다시 실행해 "2) 저장"을 고르세요.');
          return;
        }
        const pre = ctx.selected().find((e) => (e.type === 'rectangle' || (e.type === 'polyline' && e.closed)) && e.points?.length >= 4);
        const box = pre || await ctx.pickEntity({prompt: 'HPM · 문양 상자(사각형)를 선택하세요 · Esc 취소', types: ['rectangle', 'polyline']});
        if (!box) return;
        const tile = G.bounds([box]);
        if (!tile || tile.maxX - tile.minX < G.EPS || tile.maxY - tile.minY < G.EPS) throw Error('HPM · 폭과 높이가 있는 사각형 상자를 선택하세요.');
        const contents = hpmTileContents(ctx.entities().filter((e) => e.id !== box.id), tile);
        if (!contents.segments.length && !contents.points.length) throw Error('HPM · 상자 안에 선(LINE)이나 점이 없습니다. 폴리선은 무늬로 저장되지 않습니다(원문과 같음).');
        const name = patternName(values.name, 'USER_PAT');
        const result = tileToPatDefinition(contents, tile, name, `바른 CAD 해치 문양 ${Math.round(tile.maxX - tile.minX)}×${Math.round(tile.maxY - tile.minY)}`);
        const fileName = safeFileName(String(values.file || name).replace(/\.pat$/i, ''), 'user_pattern') + '.pat';
        downloadText(fileName, patFileText([result.text], {title: '바른 CAD 해치 문양 만들기(HPM)'}));
        const notes = [result.skipped ? `상자 격자에 맞지 않는 기운 선 ${result.skipped}개 제외` : '', contents.ignored ? `선·점이 아닌 객체 ${contents.ignored}개 제외` : ''].filter(Boolean).join(' · ');
        ctx.toast(`HPM · 무늬 "${name}"(선 ${result.lines}줄)을 "${fileName}" 로 저장했습니다${notes ? ' · ' + notes : ''}. 캐드 무늬 파일(acadiso.pat 등)에 붙여 넣어 쓰세요.`);
      });
    });
  }

  // HR — 해치 꺼내쓰기(/326): 1~9번 슬롯 저장/불러오기(localStorage). "S 버튼으로 화면에서 읽기"·
  // 연관·고립탐지는 없음.
  function hr() {
    const presets = store('hr-presets');
    ctx.form('HR · 해치 꺼내쓰기(1~9번 슬롯)', [
      {name: 'mode', label: '동작', value: 'apply', options: [['apply', '슬롯 불러와 적용'], ['save', '현재 값을 슬롯에 저장']]},
      {name: 'slot', label: '슬롯 번호(1~9)', type: 'number', value: 1},
      {name: 'pattern', label: '무늬(저장 시)', value: 'lines', options: [['lines', '사선'], ['cross', '교차선'], ['solid', '단색 채움']]},
      {name: 'spacing', label: '간격(저장 시)', type: 'number', value: 100},
      {name: 'angle', label: '각도(저장 시)', type: 'number', value: 0},
      {name: 'layerName', label: '켜 이름(저장 시)', type: 'text', value: 'HATCH'},
      {name: 'color', label: '켜 색(저장 시)', type: 'color', value: '#79d4ff'},
    ], (values) => {
      const slot = boundedInteger(values.slot, {min: 1, max: 9, label: 'HR · 슬롯 번호'});
      if (values.mode === 'save') {
        const next = savePresetSlot(presets, slot, {pattern: values.pattern, spacing: Number(values.spacing) || 100, angle: Number(values.angle) || 0, layerName: values.layerName || 'HATCH', color: values.color || '#79d4ff'});
        save('hr-presets', next);
        ctx.toast(`HR · ${slot}번 슬롯에 해치 값을 저장했습니다.`);
        return;
      }
      const preset = applyPresetSlot(presets, slot);
      afterClose(async () => {
        const target = await ctx.pickEntity({prompt: `HR · ${slot}번 해치를 넣을 폐곡선을 선택하세요 · Esc 취소`, types: ['polyline', 'rectangle']});
        if (!target) return;
        if (target.type === 'polyline' && !target.closed) throw Error('HR · 닫힌 폴리선을 선택하세요.');
        const layer = ctx.ensureLayer(preset.layerName, preset.color);
        ctx.commit({entities: [{type: 'hatch', points: target.points, pattern: preset.pattern, solid: preset.pattern === 'solid', spacing: preset.spacing, angle: preset.angle, color: preset.color, layer}]});
        ctx.toast(`HR · ${slot}번 슬롯 해치를 넣었습니다(${preset.pattern}).`);
      });
    });
  }

  // HT — 두께 입력 해치(/266): 두 점 → 기준 두께 사각 영역 + 해치. 기본 무늬 EARTH 는 없어 사선으로 대체.
  function ht() {
    ctx.form('HT · 두께 입력 해치', [
      {name: 'thickness', label: '기준 두께(mm)', type: 'number', value: 500},
      {name: 'pattern', label: '무늬(EARTH 전용 무늬가 없어 대체)', value: 'lines', options: [['lines', '사선'], ['cross', '교차선']]},
      {name: 'spacing', label: '해치 간격', type: 'number', value: 100},
      {name: 'angle', label: '해치 각도', type: 'number', value: 0},
      {name: 'layerName', label: '켜 이름', type: 'text', value: 'A-SITE'},
    ], (values) => {
      const thickness = Number(values.thickness);
      if (!(thickness > 0)) throw Error('HT · 두께는 0보다 커야 합니다.');
      afterClose(async () => {
        const p1 = await ctx.pickPoint('HT · 첫 번째 점을 지정하세요');
        if (!p1) return;
        const p2 = await ctx.pickPoint('HT · 두 번째 점을 지정하세요');
        if (!p2) return;
        const points = thicknessRectangle(p1, p2, thickness);
        const layer = ctx.ensureLayer(values.layerName || 'A-SITE', '#c9a26b');
        ctx.commit({entities: [{type: 'hatch', points, pattern: values.pattern, solid: false, spacing: Number(values.spacing) || 100, angle: Number(values.angle) || 0, layer}]});
        ctx.toast(`HT · 두께 ${thickness}mm 해치를 넣었습니다.`);
      });
    });
  }

  // RDS — 무작위 솔리드 해치(/478): 대화상자 없음. 화면의 솔리드 해치 색을 모아 무작위로 고르고 기억한다.
  async function rds() {
    const target = await ctx.pickEntity({prompt: 'RDS · 무작위 솔리드 해치를 넣을 폐곡선을 선택하세요 · Esc 취소', types: ['polyline', 'rectangle']});
    if (!target) return;
    if (target.type === 'polyline' && !target.closed) throw Error('RDS · 닫힌 폴리선을 선택하세요.');
    const existing = [...new Set(ctx.entities().filter((e) => e.type === 'hatch' && e.solid && e.color).map((e) => e.color))];
    const FALLBACK = ['#8a6d3b', '#b5651d', '#6b8e23', '#c2b280'];
    const {color, map, usedFallback} = pickRandomColor(existing, store('rds-memory'), target.id, FALLBACK);
    save('rds-memory', map);
    ctx.commit({entities: [{type: 'hatch', points: target.points, solid: true, color, layer: target.layer}]});
    ctx.toast(`RDS · 무작위 솔리드 해치(${color})를 넣었습니다.${usedFallback ? ' (화면에 서로 다른 솔리드 색이 3개 미만이라 기본 팔레트를 썼습니다)' : ''}`);
  }

  // SHO — 해치 내부 객체로 해치 선택(/599): point 객체가 없어 문자(TEXT) 객체 위치로 대신한다.
  function sho() {
    ctx.form('SHO · 내부 객체로 해치 선택', [{name: 'filterText', label: '문자 내용 필터(비워두면 문자 객체를 직접 클릭)', type: 'text', value: ''}], (values) => {
      afterClose(async () => {
        const hatches = ctx.entities().filter((e) => e.type === 'hatch');
        if (!hatches.length) throw Error('SHO · 도면에 해치가 없습니다.');
        let markers;
        const filterText = String(values.filterText || '').trim();
        if (filterText) {
          const texts = ctx.entities().filter((e) => e.type === 'text').map((e) => ({position: e.position, text: e.text || ''}));
          markers = filterMarkersByText(texts, filterText);
          if (!markers.length) throw Error(`SHO · "${filterText}" 을(를) 포함한 문자를 찾지 못했습니다.`);
        } else {
          markers = [];
          for (;;) {
            const picked = await ctx.pickEntity({prompt: `SHO · 해치 안의 문자 객체를 선택하세요(선택 ${markers.length}개) · Esc 로 마침`, types: ['text']});
            if (!picked) break;
            markers.push({position: picked.position, text: picked.text || ''});
          }
          if (!markers.length) return;
        }
        const ids = selectHatchesByObjects(hatches, markers);
        if (!ids.length) throw Error('SHO · 그 위치를 포함하는 해치를 찾지 못했습니다.');
        ctx.setSelected(ids);
        ctx.toast(`SHO · 해치 ${ids.length}개를 선택했습니다(기준 객체 ${markers.length}개).`);
      });
    });
  }

  // DTT — 치수목록을 표로(/601): 선택한 치수의 실측값을 번호와 함께 선+문자 표로 만든다.
  // TAJ 가 나중에 폭을 다시 정리할 수 있도록 dtTableId 를 붙이고 레이아웃을 storage 에 남긴다.
  async function dtt() {
    const dims = ctx.selected().filter((e) => e.type === 'dimension');
    if (!dims.length) throw Error('DTT · 표로 만들 치수를 먼저 선택하세요.');
    ctx.form('DTT · 치수목록을 표로', [
      {name: 'prefix', label: '번호 접두어(예: M → M(1))', type: 'text', value: ''},
      {name: 'order', label: '정렬 순서', value: 'selection', options: [['selection', '선택한 순서'], ['position', '좌표순(왼쪽→오른쪽)']]},
    ], (values) => {
      afterClose(async () => {
        const origin = await ctx.pickPoint('DTT · 표를 넣을 왼쪽 위 모서리를 지정하세요');
        if (!origin) return;
        const rowsData = numberedRows(dims, {prefix: values.prefix || '', order: values.order});
        const rows = [['번호', '치수'], ...rowsData.map((r) => [r.no, r.text])];
        const textHeight = ctx.num('text-height', 150);
        const colWidths = autoColumnWidths(rows, {textHeight});
        const rowHeight = textHeight * 2.2;
        const geo = buildTableGeometry({origin, colWidths, rowHeight, rows, textHeight});
        const layer = ctx.ensureLayer('A-TITLE', '#ffffff');
        const tableId = 'dt-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
        const lineEntities = geo.lines.map((pts) => ({type: 'line', points: pts, layer, dtTableId: tableId}));
        const textEntities = geo.texts.map((t) => ({type: 'text', position: t.position, text: t.text, height: t.height, rotation: 0, align: 'center', layer, dtTableId: tableId}));
        const ids = ctx.commit({entities: [...lineEntities, ...textEntities]});
        const all = store('dtt-tables');
        all[tableId] = {origin, rows, textHeight, layer, lineIds: ids.slice(0, lineEntities.length), textIds: ids.slice(lineEntities.length)};
        save('dtt-tables', all);
        ctx.toast(`DTT · 치수 ${dims.length}개를 표(${rows.length - 1}행)로 만들었습니다. TAJ 로 폭을 다시 정리할 수 있습니다.`);
      });
    });
  }

  // TAJ — 문자에 맞춰 표 폭 자동정리(/305): DTT 로 만든 표만 지원한다(TableStyle·ACAD_TABLE 이 없어
  // 이 카드가 아는 레이아웃에만 적용할 수 있다).
  async function taj() {
    const picked = await ctx.pickEntity({prompt: 'TAJ · 폭을 자동정리할 표(DTT로 만든 표)의 선이나 문자를 선택하세요 · Esc 취소'});
    if (!picked) return;
    // 표 정보는 이 컴퓨터 저장소에만 있고 표 표시(dtTableId)도 DXF 저장에서 사라진다. 저장 정보가 없으면
    // 고른 선·글자에서 표 격자와 칸 글자를 도면에서 읽어 낸다(다시 연 도면·다른 PC, 2026-10-27 설명서 시험).
    const all = store('dtt-tables');
    const tableId = picked.dtTableId || ('dt-' + Date.now().toString(36));
    const meta = (picked.dtTableId && all[picked.dtTableId]) || tableFromGrid(ctx.entities(), picked);
    if (!meta) throw Error('TAJ · 고른 선·글자에서 표(가로·세로 선으로 된 격자)를 찾지 못했습니다. 표의 선이나 칸 안 글자를 선택하세요.');
    const colWidths = autoColumnWidths(meta.rows, {textHeight: meta.textHeight});
    const rowHeight = meta.textHeight * 2.2;
    const geo = buildTableGeometry({origin: meta.origin, colWidths, rowHeight, rows: meta.rows, textHeight: meta.textHeight});
    const removeIds = [...(meta.lineIds || []), ...(meta.textIds || [])];
    const lineEntities = geo.lines.map((pts) => ({type: 'line', points: pts, layer: meta.layer, dtTableId: tableId}));
    const textEntities = geo.texts.map((t) => ({type: 'text', position: t.position, text: t.text, height: t.height, rotation: 0, align: 'center', layer: meta.layer, dtTableId: tableId}));
    const ids = ctx.commit({removeIds, entities: [...lineEntities, ...textEntities]});
    meta.lineIds = ids.slice(0, lineEntities.length); meta.textIds = ids.slice(lineEntities.length);
    all[tableId] = meta;
    save('dtt-tables', all);
    ctx.toast(`TAJ · 표 폭을 문자 길이에 맞춰 다시 정리했습니다(${colWidths.length}열).`);
  }

  return {
    BPT: guard(bpt), GDD: guard(gdd), HC: guard(hc), HP: guard(hp), HPM: guard(hpm),
    HR: guard(hr), HT: guard(ht), RDS: guard(rds), SHO: guard(sho), TAJ: guard(taj), DTT: guard(dtt),
  };
}
