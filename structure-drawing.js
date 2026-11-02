// 소규모 자동 구조: 서버가 계산한 구조 모델(부재 목록) → 구조평면도·기초평면도 객체. 계산은 하지 않는다(엔진은 서버에만).
// 모델 좌표는 m(건물 왼쪽 아래 = 0,0, 위 = 북), 부재 크기는 mm. 도면은 mm 로 origin 에서부터 그린다.
// 레이어는 구조 S- 계열 8개(S-GRID·S-COLS·S-BEAM·S-SLAB·S-WALL·S-BRCE·S-FNDN·S-ANNO). 넣은 객체마다 structureSet {id, member} 꼬리표.
// 시트는 왼쪽에서 오른쪽으로: 기초평면도 → 1층 위 구조평면도(2층 바닥) → … → 지붕 구조평면도.
import {standardLayerForName} from './layer-standards.js';
import {structureScheduleEntities, structureScheduleLayout, structureNotesEntities, structureNotesLayout, structureSchedulePageCount} from './structure-schedule.js';

import {drawSheetFrame, sheetGeometry,DEFAULT_SHEET_TEMPLATE,sheetTemplateFrom} from './sheet-layout.js';
import {translate} from './geometry.js';
import {isPreliminaryStructure, preliminaryFloors, preliminaryLevels, preliminaryMembers, PRELIMINARY_PROPOSAL_NOTICE} from './structure-preliminary.js';

export const STRUCTURE_LAYERS =['S-GRID', 'S-COLS', 'S-BEAM', 'S-SLAB', 'S-WALL', 'S-BRCE', 'S-FNDN', 'S-ANNO'];
const TEXT = 250, SMALL = 180, BUBBLE = 400, OVER = 1500, GAP = 8000;

export function structureLevels(model) {
  if (isPreliminaryStructure(model)) return preliminaryLevels(model);
  return [...new Set(model.members.map((m) => m.level).filter((v) => Number.isInteger(v)))].sort((a, b) => a - b);
}
const stories = (model) => model.floors?.length || model.p?.floors?.length || Number(model.p?.stories) || Math.max(1, ...structureLevels(model));
export function sheetTitle(model, level) {
  if (level === 'foundation') return '기초평면도';
  if (level === 'schedule') return '배근도 · 부재 일람표';
  if (level === 'notes') return '구조일반주기';
  return `${level}층 구조평면도(${level >= stories(model) ? '지붕' : `${level + 1}층 바닥`})`;
}
const label = (m) => m.sec || (m.kind === 'column' ? `${m.b}×${m.h}` : m.kind === 'beam' ? `${m.b}×${m.h}` : m.kind === 'footing' ? `${Math.round(m.B * 1000)}×${Math.round(m.B * 1000)}×${m.D}`
  : m.kind === 'woodWall' ? `38×${m.stud}@${m.sp}` : ['joists', 'ceilJoists', 'rafters'].includes(m.kind) ? `38×${m.h}@${m.sp}` : m.t ? `t${m.t}` : '');

/** 한 시트(층 또는 기초)의 객체. ox,oy = 그 시트의 원점(mm). 표현은 시안 화면(prototype.html drawPlan)을 따른다:
 *  축선 X1·X2… / Y1·Y2…, 축선 간격 치수(쉼표 없이 mm), 벽·줄기초는 기둥 면까지, 가새는 X자, 목조 전단벽 구간은 굵게(나머지 벽선 점선),
 *  작은보 B 는 점선, 장선·서까래는 간격(sp)마다, 계단은 1층 계단실 테두리·디딤단·오름 화살표, 맨 위 박공은 용마루 선. */
function sheetEntities(model, level, ox, oy, setId, {prefix = '', framed = false} = {}) {
  const out = [], mm = (v) => Math.round(v * 1000 * 1000) / 1000;
  const P = (x, y) => ({x: ox + mm(x), y: oy + mm(y)});
  const tag = (m) => ({structureSet: {id: setId, member: m?.id ?? null}});
  const line = (a, b, layer, m, extra = {}) => out.push({type: 'line', layer, points: [a, b], ...tag(m), ...extra});
  const seg = (x0, y0, x1, y1, layer, m, extra) => line(P(x0, y0), P(x1, y1), layer, m, extra);
  const rect = (x0, y0, x1, y1, layer, m, extra = {}) => out.push({type: 'polyline', layer, closed: true, points: [P(x0, y0), P(x1, y0), P(x1, y1), P(x0, y1)], ...tag(m), ...extra});
  const rectMm = (cx, cy, w, h, layer, m) => { const c = P(cx, cy); out.push({type: 'polyline', layer, closed: true, points: [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sy]) => ({x: c.x + sx * w / 2, y: c.y + sy * h / 2})), ...tag(m)}); };
  const text = (p, t, h, layer, m, extra = {}) => out.push({type: 'text', layer, position: p, height: h, text: t, align: 'center', ...tag(m), ...extra});
  const gx = model.gx || [0], gy = model.gy || [0], X1 = gx[gx.length - 1], Y1 = gy[gy.length - 1];
  const col0 = model.members.find((q) => q.kind === 'column'), c0 = col0 ? col0.b / 1000 : 0.15;
  // 축선 방향 띠(벽·줄기초): 양 끝 기둥 반폭을 뺀다(시안 wallLine)
  const endpoints = w => w.dir === 'x' ? {x0: w.a, y0: w.fixed, x1: w.b, y1: w.fixed}
    : w.dir === 'y' ? {x0: w.fixed, y0: w.a, x1: w.fixed, y1: w.b} : {x0: w.x0, y0: w.y0, x1: w.x1, y1: w.y1};
  const band = (w, width, layer) => {
    const e = endpoints(w), dx = e.x1 - e.x0, dy = e.y1 - e.y0, L = Math.hypot(dx, dy);
    if (!(L > 0) || !Number.isFinite(width) || width <= 0) throw Error('벽·줄기초 끝점과 폭을 확인하세요: ' + w.id);
    const inset = Math.min(c0 / 2, L / 2), ux = dx / L, uy = dy / L;
    along({...w, x0: e.x0 + ux * inset, y0: e.y0 + uy * inset, x1: e.x1 - ux * inset, y1: e.y1 - uy * inset}, width, layer);
  };
  const along = (w, width, layer) => {   // 두 점 사이 띠(목조 벽·줄기초): 방향 벡터로
    const dx = w.x1 - w.x0, dy = w.y1 - w.y0, L = Math.hypot(dx, dy) || 1, nx = -dy / L * width / 2, ny = dx / L * width / 2;
    out.push({type: 'polyline', layer, closed: true, points: [P(w.x0 + nx, w.y0 + ny), P(w.x1 + nx, w.y1 + ny), P(w.x1 - nx, w.y1 - ny), P(w.x0 - nx, w.y0 - ny)], ...tag(w)});
  };
  const code = (m, x, y, vertical = false) => text(P(x, y), m.code, SMALL, 'S-ANNO', m, vertical ? {rotation: 90} : {});

  // 축선·기호·간격 치수
  gx.forEach((x, i) => {
    seg(x, -1.4, x, Y1 + 0.9, 'S-GRID', null);
    const c = P(x, Y1 + 1.15 + BUBBLE / 1000);
    out.push({type: 'circle', layer: 'S-GRID', center: c, radius: BUBBLE, linetype: 'CONTINUOUS', ...tag(null)});
    text({x: c.x, y: c.y - TEXT * .45}, prefix + 'X' + (i + 1), TEXT, 'S-ANNO', null);
  });
  gy.forEach((y, i) => {
    seg(-0.9, y, X1 + 1.4, y, 'S-GRID', null);
    const c = P(-1.15 - BUBBLE / 1000, y);
    out.push({type: 'circle', layer: 'S-GRID', center: c, radius: BUBBLE, linetype: 'CONTINUOUS', ...tag(null)});
    text({x: c.x, y: c.y - TEXT * .45}, prefix + 'Y' + (i + 1), TEXT, 'S-ANNO', null);
  });
  const DY = -1.2, DX = X1 + 1.2, tick = 0.08;   // 치수는 바깥 벽 부호보다 밖에
  gx.slice(1).forEach((x, i) => { const a = gx[i]; seg(a, DY, x, DY, 'S-ANNO', null); seg(a, DY - tick, a, DY + tick, 'S-ANNO', null); seg(x, DY - tick, x, DY + tick, 'S-ANNO', null); text({...P((a + x) / 2, DY), y: P(0, DY).y + SMALL * .4}, String(Math.round((x - a) * 1000)), SMALL, 'S-ANNO', null); });
  gy.slice(1).forEach((y, i) => { const a = gy[i]; seg(DX, a, DX, y, 'S-ANNO', null); seg(DX - tick, a, DX + tick, a, 'S-ANNO', null); seg(DX - tick, y, DX + tick, y, 'S-ANNO', null); text({x: P(DX, 0).x + SMALL * 1.4, y: P(0, (a + y) / 2).y}, String(Math.round((y - a) * 1000)), SMALL, 'S-ANNO', null, {rotation: 90}); });

  if (level === 'foundation') {
    for (const m of model.members) {
      if (m.kind === 'mat') { rect(m.x0, m.y0, m.x1, m.y1, 'S-FNDN', m); code(m, (m.x0 + m.x1) / 2, (m.y0 + m.y1) / 2); }
      else if (m.kind === 'strip') band(m, m.w / 1000, 'S-FNDN');
      else if (m.kind === 'stripW') { along(m, m.footW / 1000, 'S-FNDN'); along(m, m.stem / 1000, 'S-FNDN'); }
      else if (m.kind === 'footing') { rectMm(m.x, m.y, m.B * 1000, m.B * 1000, 'S-FNDN', m); code(m, m.x, m.y - m.B / 2 - SMALL * 1.6 / 1000); }
      else if (m.kind === 'groundSlab') { rect(m.x0, m.y0, m.x1, m.y1, 'S-SLAB', m); code(m, (m.x0 + m.x1) / 2, (m.y0 + m.y1) / 2); }
    }
    for (const m of model.members.filter((q) => q.kind === 'column' && q.level === 1)) rectMm(m.x, m.y, m.b, m.h, 'S-COLS', m);
  } else {
    const here = model.members.filter((m) => m.level === level), hasRafters = here.some((m) => m.kind === 'rafters'), labelled = new Set();
    const once = (m, ...at) => { const k = m.code + '@' + at.map((v) => Math.round(v * 10)).join(','); if (labelled.has(k)) return; labelled.add(k); code(m, ...at); };
    for (const m of here) {
      if (m.kind === 'slab') once(m, (m.x0 + m.x1) / 2, (m.y0 + m.y1) / 2);
      else if (m.kind === 'joists' || m.kind === 'ceilJoists' || m.kind === 'rafters') {
        if (m.kind === 'ceilJoists' && hasRafters) continue;   // 시안: 서까래가 있으면 천장장선은 겹쳐 그리지 않는다
        const ys = m.spanDir === 'y', lo = ys ? m.x0 : m.y0, hi = ys ? m.x1 : m.y1, step = m.sp / 1000;
        if (!(step > 0) || !Number.isFinite(step) || (hi - lo) / step > 10000) throw Error('장선·서까래 간격을 확인하세요.');
        for (let u = lo; u <= hi + 1e-9; u += step) ys ? seg(u, m.y0, u, m.y1, 'S-BEAM', m) : seg(m.x0, u, m.x1, u, 'S-BEAM', m);
        text(P((m.x0 + m.x1) / 2, (m.y0 + m.y1) / 2), `${m.code} ${label(m)}`, SMALL, 'S-ANNO', m);
      } else if (m.kind === 'purlin') {
        for (let k = 0; k < m.n; k++) { const f = k / Math.max(1, m.n - 1); m.run === 'y' ? seg(m.x0, m.y0 + (m.y1 - m.y0) * f, m.x1, m.y0 + (m.y1 - m.y0) * f, 'S-BEAM', m) : seg(m.x0 + (m.x1 - m.x0) * f, m.y0, m.x0 + (m.x1 - m.x0) * f, m.y1, 'S-BEAM', m); }
      } else if (m.kind === 'beam') {
        const a = P(m.x0, m.y0), b = P(m.x1, m.y1), dx = b.x - a.x, dy = b.y - a.y, L = Math.hypot(dx, dy) || 1, nx = -dy / L * m.b / 2, ny = dx / L * m.b / 2;
        const style = m.type === 'B' ? {linetype: 'DASHED'} : {};
        line({x: a.x + nx, y: a.y + ny}, {x: b.x + nx, y: b.y + ny}, 'S-BEAM', m, style);
        line({x: a.x - nx, y: a.y - ny}, {x: b.x - nx, y: b.y - ny}, 'S-BEAM', m, style);
        const vertical = Math.abs(dx) < Math.abs(dy), mx = (m.x0 + m.x1) / 2, my = (m.y0 + m.y1) / 2;
        once(m, mx + (vertical ? -(m.b / 2 + SMALL) / 1000 : 0), my + (vertical ? 0 : (m.b / 2 + SMALL * .4) / 1000), vertical);
      } else if (m.kind === 'wall' || m.kind === 'stairWall') {   // 벽 부호는 보 부호(안쪽)와 겹치지 않게 바깥쪽에
        band(m, m.t / 1000, 'S-WALL');
        if (m.dir === 'd') {
          const dx = m.x1 - m.x0, dy = m.y1 - m.y0, L = Math.hypot(dx, dy), offset = (m.t / 2 + SMALL * 1.4) / 1000;
          once(m, (m.x0 + m.x1) / 2 - dy / L * offset, (m.y0 + m.y1) / 2 + dx / L * offset, Math.abs(dy) > Math.abs(dx));
          continue;
        }
        const out = (m.fixed <= (m.dir === 'x' ? Y1 : X1) / 2 ? -1 : 1) * (m.t / 2 + SMALL * 1.4) / 1000;
        once(m, m.dir === 'x' ? (m.a + m.b) / 2 : m.fixed + out, m.dir === 'x' ? m.fixed + out - (out < 0 ? SMALL / 1000 : 0) : (m.a + m.b) / 2, m.dir !== 'x');
      }
      else if (m.kind === 'woodWall') {
        // 시안: 벽선 전체는 점선(개구부 가능), 전단벽 구간(segs)은 굵게 — 벽 방향 벡터로 잰다
        const dx = m.x1 - m.x0, dy = m.y1 - m.y0, L = Math.hypot(dx, dy) || 1, ux = dx / L, uy = dy / L;
        seg(m.x0, m.y0, m.x1, m.y1, 'S-WALL', m, {linetype: 'DASHED'});
        for (const [s0, s1] of m.segs || []) along({...m, x0: m.x0 + ux * s0, y0: m.y0 + uy * s0, x1: m.x0 + ux * s1, y1: m.y0 + uy * s1}, m.stud / 1000, 'S-BRCE');
        const vertical = Math.abs(dx) < Math.abs(dy);
        once(m, (m.x0 + m.x1) / 2 + (vertical ? -0.18 : 0), (m.y0 + m.y1) / 2 + (vertical ? 0 : 0.16), vertical);
      } else if (m.kind === 'brace') {
        if (m.dir === 'd') {
          const dx = m.x1 - m.x0, dy = m.y1 - m.y0, L = Math.hypot(dx, dy);
          if (!(L > 0)) throw Error('가새 끝점을 확인하세요: ' + m.id);
          const ux = dx / L, uy = dy / L, nx = -uy, ny = ux, inset = Math.min(0.2, L / 2), off = 0.45, d = 0.25;
          const a = {x: m.x0 + ux * inset + nx * off, y: m.y0 + uy * inset + ny * off};
          const b = {x: m.x1 - ux * inset + nx * off, y: m.y1 - uy * inset + ny * off};
          seg(a.x - nx * d, a.y - ny * d, b.x + nx * d, b.y + ny * d, 'S-BRCE', m);
          seg(a.x + nx * d, a.y + ny * d, b.x - nx * d, b.y - ny * d, 'S-BRCE', m);
          once(m, (a.x + b.x) / 2 + nx * (d + 0.15), (a.y + b.y) / 2 + ny * (d + 0.15), Math.abs(dy) > Math.abs(dx));
          continue;
        }
        const off = 0.45 * (m.side === '남' || m.side === '서' ? -1 : 1), a = m.a + 0.2, b = m.b - 0.2, d = 0.25, f = m.fixed + off;
        if (m.dir === 'x') { seg(a, f - d, b, f + d, 'S-BRCE', m); seg(a, f + d, b, f - d, 'S-BRCE', m); once(m, (a + b) / 2, f + d + 0.15); }
        else { seg(f - d, a, f + d, b, 'S-BRCE', m); seg(f + d, a, f - d, b, 'S-BRCE', m); once(m, f + d + 0.15, (a + b) / 2, true); }
      } else if (m.kind === 'woodStair') { rect(m.x0, m.y0, m.x1, m.y1, 'S-SLAB', m); text(P((m.x0 + m.x1) / 2, (m.y0 + m.y1) / 2), `UP ${m.n * 2}R`, SMALL, 'S-ANNO', m); }
    }
    // 계단(RC·철골): 1층 계단실 테두리 점선 + 계단판(디딤단·오름 화살표) + 계단참
    if (level === 1 && model.stair && model.system !== 'wood') {
      const st = model.stair; rect(st.x0, st.y0, st.x1, st.y1, 'S-SLAB', null, {linetype: 'DASHED'});
      for (const m of here.filter((q) => q.kind === 'flight')) {
        const [x0, x1, y0, y1] = m.alongX ? [m.s0, m.s1, m.c0, m.c1] : [m.c0, m.c1, m.s0, m.s1];
        rect(x0, y0, x1, y1, 'S-SLAB', m);
        for (let k = 1; k < m.n; k++) { const u = m.s0 + (m.s1 - m.s0) * k / (m.n - 1); m.alongX ? seg(u, m.c0, u, m.c1, 'S-SLAB', m) : seg(m.c0, u, m.c1, u, 'S-SLAB', m); }
        const mid = (m.c0 + m.c1) / 2, a0 = m.upFromStart ? m.s0 : m.s1, a1 = m.upFromStart ? m.s1 : m.s0, dir = Math.sign(a1 - a0) || 1, h = 0.15;
        if (m.alongX) { seg(a0, mid, a1, mid, 'S-SLAB', m); seg(a1, mid, a1 - dir * h, mid + h / 2, 'S-SLAB', m); seg(a1, mid, a1 - dir * h, mid - h / 2, 'S-SLAB', m); }
        else { seg(mid, a0, mid, a1, 'S-SLAB', m); seg(mid, a1, mid + h / 2, a1 - dir * h, 'S-SLAB', m); seg(mid, a1, mid - h / 2, a1 - dir * h, 'S-SLAB', m); }
        once(m, (x0 + x1) / 2, (y0 + y1) / 2 + 0.2);
      }
      for (const m of here.filter((q) => q.kind === 'landing')) { const [x0, x1, y0, y1] = m.alongX ? [m.s0, m.s1, m.cMin, m.cMax] : [m.cMin, m.cMax, m.s0, m.s1]; rect(x0, y0, x1, y1, 'S-SLAB', m); once(m, (x0 + x1) / 2, (y0 + y1) / 2); }
    }
    if (model.gable && level >= stories(model)) {   // 박공 지붕: 용마루 선
      const r = model.ridgeX ? [[-0.6, Y1 / 2], [X1 + 0.6, Y1 / 2]] : [[X1 / 2, -0.6], [X1 / 2, Y1 + 0.6]];
      seg(r[0][0], r[0][1], r[1][0], r[1][1], 'S-BEAM', null, {linetype: 'DASHED'});
      text({...P(r[1][0], r[1][1]), y: P(r[1][0], r[1][1]).y + SMALL * .6}, `용마루 +${model.rise} m`, SMALL, 'S-ANNO', null);
    }
    for (const m of here.filter((q) => q.kind === 'column')) rectMm(m.x, m.y, m.b, m.h, 'S-COLS', m);
  }
  if (!framed) text({x: P(X1 / 2, 0).x, y: P(0, -1.4).y - TEXT * 4}, sheetTitle(model, level), TEXT * 1.4, 'S-ANNO', null);   // 도곽에 담으면 표제 기호가 제목
  return out;
}


// 기존 KDS 42 출력은 건드리지 않고 개략 엔진의 위치·단면만 A3 도곽에 담는다.
function preliminaryPlan(model, level, origin, setId) {
  const foundation = level === 'foundation', floor = preliminaryFloors(model)[foundation ? 0 : level-1] || {};
  const all = preliminaryMembers(model), members = all.filter(m => foundation ? m.kind === 'footing' || m.kind === 'column' && m.level === 1 : m.kind !== 'footing' && m.level === level);
  const gx = floor.gx || model.gx || [], gy = floor.gy || model.gy || [], outline = floor.outline || floor.plan?.poly || [];
  // 기초 B는 휨 방향 길이: x축 모멘트는 전역 y방향(KDS 41 엔진 입력 매핑과 동일).
  const planSize = m => m.kind === 'footing' ? m.momentAxis === 'x' ? [m.L,m.B] : [m.B,m.L] : [m.b,m.h];
  const endPoints = m => m.dir === 'x' ? [m.a,m.fixed,m.b,m.fixed] : m.dir === 'y' ? [m.fixed,m.a,m.fixed,m.b] : [m.x0,m.y0,m.x1,m.y1];
  const finite = values => values.every(v => typeof v === 'number' && Number.isFinite(v));
  const points = [...outline.map(([x,y]) => [x*1000,y*1000]), ...gx.flatMap(x => gy.map(y => [x*1000,y*1000]))];
  for (const m of members) {
    if (finite([m.x,m.y])) {
      const [b,h] = planSize(m);
      points.push([m.x*1000-(b>0?b/2:0),m.y*1000-(h>0?h/2:0)],[m.x*1000+(b>0?b/2:0),m.y*1000+(h>0?h/2:0)]);
    } else if (finite(endPoints(m))) {
      const [x0,y0,x1,y1] = endPoints(m), half = (m.kind === 'wall' ? m.t : m.bw ?? m.b) / 2 || 0;
      points.push([x0*1000-half,y0*1000-half],[x1*1000+half,y1*1000+half]);
    }
  }
  if (!points.length || points.some(p => !finite(p))) throw Error('구조 평면 위치·윤곽을 확인하세요.');
  const minX=Math.min(...points.map(p=>p[0])),maxX=Math.max(...points.map(p=>p[0])),minY=Math.min(...points.map(p=>p[1])),maxY=Math.max(...points.map(p=>p[1]));
  const geo=sheetGeometry(), d=geo.draw, title=sheetTitle(model,level), proposal=all.some(m=>m.proposal);
  const k=Math.max(1,Math.ceil(Math.max((maxX-minX)/(d.maxX-d.minX-36),(maxY-minY)/(d.maxY-d.minY-56))));
  const out=[], tag=m=>({structureSet:{id:setId,member:m?.id??null}}), at=(x,y)=>({x:origin.x+x*k,y:origin.y+y*k});
  const line=(a,b,layer='S-ANNO',m=null,extra={})=>out.push({type:'line',layer,points:[a,b],...tag(m),...extra});
  const text=(p,value,m=null,extra={})=>out.push({type:'text',layer:'S-ANNO',position:p,text:String(value),height:2.5*k,align:'left',...tag(m),...extra});
  const poly=(points,layer,m=null,extra={})=>out.push({type:'polyline',layer,points,closed:true,...tag(m),...extra});
  const frame = drawSheetFrame({line:(a,b,layer,extra)=>line({x:a[0],y:a[1]},{x:b[0],y:b[1]},layer,null,extra),
    text:(p,t,h,layer,extra)=>text({x:p[0],y:p[1]},t,null,{height:h,layer,...extra}),
    fill:(ps,layer,color)=>poly(ps.map(([x,y])=>({x,y})),layer,null,{fill:color,color})},
    {at:origin,k,paper:'A3',template:{...DEFAULT_SHEET_TEMPLATE,frameLayer:'S-ANNO',textLayer:'S-ANNO'},
      fields:{title,number:foundation?'S-001':'S-'+String(100+level),paper:'A3',scale:'1/'+k,purpose:'검토 초안',notes:['개략 검토 초안','책임구조기술자 확인 필요']}});
  const cx=(d.minX+d.maxX)/2,cy=(d.minY+d.maxY-16)/2;
  const P=(x,y)=>at(cx+(x*1000-(minX+maxX)/2)/k,cy+(y*1000-(minY+maxY)/2)/k);
  text(at(d.minX,d.maxY-3),title,null,{height:4*k});
  text(at(d.minX,d.maxY-9),proposal?PRELIMINARY_PROPOSAL_NOTICE:'개략 검토 초안 · 책임구조기술자 확인 필요');
  if (!foundation && floor.pilotis === true) text(at(d.minX,d.maxY-15),level+'층 필로티 층',null,{height:3*k});
  text(at(d.minX,d.minY+1),'위치기호·중심선: 단면 미제공 · 단위 mm');
  const marker=(p,layer,m)=>{line({x:p.x-1.5*k,y:p.y},{x:p.x+1.5*k,y:p.y},layer,m);line({x:p.x,y:p.y-1.5*k},{x:p.x,y:p.y+1.5*k},layer,m);};
  const xlo=gx.length?Math.min(...gx):minX/1000,xhi=gx.length?Math.max(...gx):maxX/1000,ylo=gy.length?Math.min(...gy):minY/1000,yhi=gy.length?Math.max(...gy):maxY/1000;
  const bubble=(p,value)=>{out.push({type:'circle',layer:'S-GRID',center:p,radius:2.5*k,...tag(null)});text({x:p.x,y:p.y-1*k},value,null,{align:'center'});};
  gx.forEach((x,i)=>{const a=P(x,ylo),b=P(x,yhi);line({x:a.x,y:a.y-8*k},{x:b.x,y:b.y+5*k},'S-GRID');bubble({x:b.x,y:b.y+9*k},'X'+(i+1));});
  gy.forEach((y,i)=>{const a=P(xlo,y),b=P(xhi,y);line({x:a.x-5*k,y:a.y},{x:b.x+8*k,y:b.y},'S-GRID');bubble({x:a.x-9*k,y:a.y},'Y'+(i+1));});
  const dim=(a,b,value,vertical)=>{line(a,b);for(const p of [a,b])line({x:p.x-k,y:p.y-k},{x:p.x+k,y:p.y+k});
    text({x:(a.x+b.x)/2+(vertical?1:0)*k,y:(a.y+b.y)/2+(vertical?0:1)*k},Math.round(value*1000),null,{align:'center',...(vertical?{rotation:90}:{})});};
  gx.slice(1).forEach((x,i)=>{const a=P(gx[i],ylo),b=P(x,ylo);dim({...a,y:a.y-6*k},{...b,y:b.y-6*k},x-gx[i],false);});
  gy.slice(1).forEach((y,i)=>{const a=P(xhi,gy[i]),b=P(xhi,y);dim({...a,x:a.x+6*k},{...b,x:b.x+6*k},y-gy[i],true);});
  if (outline.length) poly(outline.map(([x,y])=>P(x,y)),foundation?'S-GRID':'S-SLAB',null,{linetype:'DASHED'});
  const missing=[];
  for (const m of members) {
    const layer={column:'S-COLS',wall:'S-WALL',beam:'S-BEAM',footing:'S-FNDN'}[m.kind],suffix=m.proposal?' (제안)':'';
    if (m.kind==='column'||m.kind==='footing') {
      if (!finite([m.x,m.y])) {missing.push(m.code);continue;}
      const p=P(m.x,m.y),[b,h]=planSize(m);
      if (b>0&&h>0) poly([[-1,-1],[1,-1],[1,1],[-1,1]].map(([sx,sy])=>({x:p.x+sx*b/2,y:p.y+sy*h/2})),layer,m);
      else marker(p,layer,m);
      text({x:p.x+(b>0?b/2:0)+2*k,y:p.y+2*k},m.code+suffix,m);
    } else {
      const coords=endPoints(m);if (!finite(coords)) {missing.push(m.code);continue;}
      const [x0,y0,x1,y1]=coords,a=P(x0,y0),b=P(x1,y1),L=Math.hypot(b.x-a.x,b.y-a.y),width=m.kind==='wall'?m.t:m.bw??m.b;
      if (!(L>0)) throw Error('벽·보 끝점을 확인하세요: '+m.code);
      if (width>0) {const nx=-(b.y-a.y)/L*width/2,ny=(b.x-a.x)/L*width/2;
        poly([{x:a.x+nx,y:a.y+ny},{x:b.x+nx,y:b.y+ny},{x:b.x-nx,y:b.y-ny},{x:a.x-nx,y:a.y-ny}],layer,m);
      } else line(a,b,layer,m,{linetype:'DASHED'});
      text({x:(a.x+b.x)/2,y:(a.y+b.y)/2+2*k+(width>0?width/2:0)},m.code+suffix,m,{align:'center'});
    }
  }
  if (missing.length) text(at(d.minX,d.minY+6),'위치 미제공 부재 '+missing.length+'개 · 일람표 참조');
  return {entities:out,sheet:{sheet:foundation?'foundation':'plan',level:foundation?null:level,title,origin:{...origin},paper:'A3',scale:k,
    paperSize:{width:geo.W,height:geo.H},bounds:frame.bounds,draw:frame.draw,proposal,pilotis:!foundation&&floor.pilotis===true}};
}

/** 시트 목록: 기초 → 층 번호(바닥 구조) → 일람표. sheets = plan·foundation·schedule·notes 중 고른 것. */
export function structureSheets(model, sheets = ['plan', 'foundation']) {
  const out = [];
  if (sheets.includes('foundation')) out.push('foundation');
  if (sheets.includes('plan')) out.push(...structureLevels(model));
  for (const kind of ['schedule', 'notes']) if (sheets.includes(kind)) {
    for (let page = 0; page < structureSchedulePageCount(model, kind); page++) out.push(page ? kind + ':' + (page + 1) : kind);
  }
  return out;
}

// 구조 장 템플릿(sheet-templates.json structure-*, 2026-10-27 사장님 확정). 서버 템플릿에 아직 없으면 평면도 틀(plan)과 같은 이름·번호로.
const STRUCTURE_SHEET_KEYS = {notes: 'structure-notes', foundation: 'structure-foundation', plan: 'structure-plan', schedule: 'structure-schedule'};
const STRUCTURE_SHEET_DEFAULTS = {notes: ['구조일반주기', 'S-001'], foundation: ['기초평면도', 'S-101'], plan: ['구조평면도', 'S-102'], schedule: ['부재 일람표', 'S-201']};
// 상세 칸 이름은 구조 형식마다(라이브러리 표준 상세는 철골만 — RC·목조 칸은 손으로 넣는 자리).
const SLOT_DEFAULTS = {foundation: {steel: ['주각 상세', '기초 단면'], rc: ['기초 단면', '기둥 배근 상세'], wood: ['기초 단면', '토대 앵커 상세']},
  plan: {steel: ['작은보-큰보 접합', '기둥-보 접합'], rc: ['보 단면', '슬래브 배근 상세'], wood: ['장선 걸이 상세', '서까래-벽 접합']}};
const sheetNumber = (series, offset) => series.replace(/\d+$/, d => String(Number(d) + offset).padStart(d.length, '0'));
/** 한 장을 평면도와 같은 도곽에: 도곽·표제란 + (평면·기초) 그림 칸 가운데 맞춤·표제 기호·상세 칸 2개. content 는 1:1 mm 객체. */
function frameStructureSheet(content, {kind, level, ox, oy, setId, templates, title, number, k, paper = true, system = 'rc'}) {
  const template = {...sheetTemplateFrom(templates), frameLayer: 'S-ANNO', textLayer: 'S-ANNO'}, geo = sheetGeometry(template);
  const out = [], tag = {structureSet: {id: setId, member: null}};
  const line = (a, b, layer = 'S-ANNO', extra = {}) => out.push({type: 'line', layer, points: [a, b], ...tag, ...extra});
  const text = (p, t, h, extra = {}) => out.push({type: 'text', layer: 'S-ANNO', position: p, text: String(t), height: h, align: 'left', ...tag, ...extra});
  const frame = drawSheetFrame({line: (a, b, layer, extra) => line({x: a[0], y: a[1]}, {x: b[0], y: b[1]}, layer, extra),
    text: (p, t, h, layer, extra) => text({x: p[0], y: p[1]}, t, h, {layer, ...extra}),
    fill: (ps, layer, color) => out.push({type: 'polyline', layer, closed: true, points: ps.map(([x, y]) => ({x, y})), fill: color, color, ...tag})},
    {at: {x: ox, y: oy}, k, template, fields: {title, number, paper: template.paper, scale: paper ? '1/' + k : '—', purpose: '검토 초안', notes: ['예비 검토 · 초안', '책임구조기술자 확인 필요']}});
  let placed = content;
  const at = (x, y) => ({x: ox + x * k, y: oy + y * k});
  if (paper) {   // 평면·기초: 그림 칸(planCenter) 가운데에, 표제 기호, 상세 칸 2개(평면도와 같은 자리)
    const xs = [], ys = [];
    for (const e of content) for (const p of [...(e.points || []), e.position, e.center].filter(Boolean)) {xs.push(p.x); ys.push(p.y);}
    const c = geo.planCenter, cx = ox + (c.minX + c.maxX) / 2 * k, cy = oy + (c.minY + c.maxY) / 2 * k;
    const dx = cx - (Math.min(...xs) + Math.max(...xs)) / 2, dy = cy - (Math.min(...ys) + Math.max(...ys)) / 2;
    placed = content.map(e => translate(e, dx, dy));
    const A = geo.titleAnchor, r = 4;
    out.push({type: 'circle', layer: 'S-ANNO', center: at(A.x - 70, A.y), radius: r * k, ...tag});
    text(at(A.x - 70, A.y - 1.5), '1', 3.5 * k, {align: 'center'});
    text(at(A.x - 64, A.y - 1), title, 5 * k);
    text(at(A.x - 64, A.y - 5.5), '축척 1/' + k, 2.5 * k);
    const pick = u => Array.isArray(u) ? u : u?.[system], use = pick(templates?.sheets?.[STRUCTURE_SHEET_KEYS[kind]]?.detailSlotsUse) || pick(SLOT_DEFAULTS[kind]) || [];
    const note = templates?.structureDetails?.note || '치수는 구조계산서 확인';
    geo.detailSlots.forEach((b, i) => {
      const box = [at(b.minX, b.minY), at(b.maxX, b.minY), at(b.maxX, b.maxY), at(b.minX, b.maxY)];
      out.push({type: 'polyline', layer: 'S-ANNO', closed: true, points: box, ...tag, detailSlot: {sheet: number, index: i, name: use[i] || ''}});
      text(at(b.minX + 2, b.minY - 6), `${i + 2}  ${use[i] || '상세'}`, 3 * k);
      // 라이브러리 상세가 실제로 들어가는 칸은 철골의 기초 단면 밖 칸뿐(structure-review.js SLOT_QUERIES) — 나머지는 빈 자리라고 쓴다.
      text(at(b.minX + 2, b.minY - 10), system === 'steel' && use[i] && use[i] !== '기초 단면' ? '바른 표준 상세 · ' + note : '상세 넣는 자리 · ' + note, 2.2 * k);
    });
  }
  return {entities: [...placed, ...out], sheet: {sheet: kind === 'plan' ? 'plan' : kind, level, title, number, origin: {x: ox, y: oy}, paper: template.paper, scale: k,
    paperSize: {width: geo.W, height: geo.H}, bounds: frame.bounds, draw: frame.draw}};
}
/** 평면·기초를 담을 축척: 평면도와 같은 목록(plan.scales)에서 그림 칸에 드는 가장 큰 축척. */
function structureScale(content, templates) {
  const geo = sheetGeometry(sheetTemplateFrom(templates)), c = geo.planCenter, xs = [], ys = [];
  for (const e of content) for (const p of [...(e.points || []), e.position, e.center].filter(Boolean)) {xs.push(p.x); ys.push(p.y);}
  const w = Math.max(...xs) - Math.min(...xs), h = Math.max(...ys) - Math.min(...ys), scales = templates.sheets.plan.scales;
  return scales.find(s => w / s <= c.maxX - c.minX - 10 && h / s <= c.maxY - c.minY - 30) || scales.at(-1);
}

/** 구조 모델 → 객체(layer 는 이름). origin = 첫 시트 원점(mm). 시트마다 건물 폭 + GAP 씩 오른쪽으로. */
export function structureDrawingEntities(model, {origin = {x: 0, y: 0}, setId, sheets = ['plan', 'foundation'], templates = null, gridPrefix = '', planScale = null} = {}) {
  if (!model || !Array.isArray(model.members)) throw Error('구조 모델이 없습니다.');
  if (!setId) throw Error('구조 묶음 id(setId)가 필요합니다.');
  if (!origin || !Number.isFinite(origin.x) || !Number.isFinite(origin.y)) throw Error('origin 은 유한한 {x,y} mm 입니다.');
  const width = ((model.gx || [0]).at(-1) || 0) * 1000 + OVER * 2 + BUBBLE * 4, entities = [], placed = [], entitySheets = [];
  let cursor = origin.x;
  if (templates?.sheets?.plan && !isPreliminaryStructure(model)) {   // 2026-10-27 구조 장 템플릿: 장마다 평면도와 같은 도곽
    const scaled = new Map(), named = {};
    for (const level of structureSheets(model, sheets)) {
      const kind = level === 'foundation' ? 'foundation' : level === 'schedule' || level === 'notes' ? level : 'plan';
      const def = templates.sheets[STRUCTURE_SHEET_KEYS[kind]] || {}, [name, series] = STRUCTURE_SHEET_DEFAULTS[kind];
      named[kind] = (named[kind] ?? -1) + 1;
      const number = sheetNumber(def.numberSeries || series, named[kind]);
      if (kind === 'schedule' || kind === 'notes') {
        const at = {x: cursor, y: origin.y}, gen = (kind === 'notes' ? structureNotesEntities : structureScheduleEntities)(model, {origin: at, setId, framed: true});
        const r = frameStructureSheet(gen, {kind, level, ox: cursor, oy: origin.y, setId, templates, title: def.name || name, number, k: 50, paper: false});
        entities.push(...r.entities); placed.push(r.sheet); entitySheets.push(...Array(r.entities.length).fill(level)); cursor = r.sheet.bounds.maxX + GAP; continue;
      }
      const content = sheetEntities(model, level, 0, 0, setId, {prefix: gridPrefix, framed: true});
      if (!scaled.has('k')) {const fit = structureScale(content, templates); scaled.set('k', planScale >= fit ? planScale : fit);}   // 구조 평면 전부 같은 축척 — 건축 평면 축척이 들어가면 그것
      const r = frameStructureSheet(content, {kind, level, ox: cursor, oy: origin.y, setId, templates, title: kind === 'foundation' ? def.name || name : sheetTitle(model, level), number, k: scaled.get('k'), system: model.system});
      entities.push(...r.entities); placed.push(r.sheet); entitySheets.push(...Array(r.entities.length).fill(level)); cursor = r.sheet.bounds.maxX + GAP;
    }
    assertFiniteStructureEntities(entities);
    return {entities, sheets: placed, entitySheets};
  }
  structureSheets(model, sheets).forEach((level) => {
    const ox = cursor, start = entities.length;
    if (isPreliminaryStructure(model)) {
      const [kind, number] = String(level).split(':'), page = number ? Number(number)-1 : 0, at = {x:ox,y:origin.y};
      let placedSheet, generated;
      if (kind === 'schedule' || kind === 'notes') {
        generated = (kind === 'notes' ? structureNotesEntities : structureScheduleEntities)(model,{origin:at,setId,page});
        placedSheet = (kind === 'notes' ? structureNotesLayout : structureScheduleLayout)(model,{origin:at,page});
      } else {const plan = preliminaryPlan(model,level,at,setId);generated=plan.entities;placedSheet=plan.sheet;}
      entities.push(...generated);placed.push(placedSheet);entitySheets.push(...Array(generated.length).fill(level));
      cursor=placedSheet.bounds.maxX+GAP;return;
    }
    cursor += (level === 'schedule' || level === 'notes' ? 420 * 50 : width) + GAP;
    if (level === 'schedule' || level === 'notes') {
      const at = {x: ox, y: origin.y};
      entities.push(...(level === 'notes' ? structureNotesEntities : structureScheduleEntities)(model, {origin: at, setId}));
      placed.push((level === 'notes' ? structureNotesLayout : structureScheduleLayout)(model, {origin: at}));
      entitySheets.push(...Array(entities.length - start).fill(level));
      return;
    }
    entities.push(...sheetEntities(model, level, ox, origin.y, setId));
    entitySheets.push(...Array(entities.length - start).fill(level));
    placed.push({sheet: level === 'foundation' ? 'foundation' : 'plan', level: level === 'foundation' ? null : level, title: sheetTitle(model, level), origin: {x: ox, y: origin.y}});
  });
  assertFiniteStructureEntities(entities);
  return {entities, sheets: placed, entitySheets};
}

/** 모든 출력 숫자를 저장 전에 검사한다. NaN/Infinity가 문서에 들어가지 않는다. */
export function assertFiniteStructureEntities(entities) {
  const walk = (value, at) => {
    if (typeof value === 'number' && !Number.isFinite(value)) throw Error('구조 도면 좌표는 유한수여야 합니다: ' + at);
    if (value && typeof value === 'object') for (const [key, v] of Object.entries(value)) walk(v, at + '.' + key);
  };
  entities.forEach((e, i) => walk(e, 'entities[' + i + ']'));
}
function generatedContent(entity) {
  const stable = value => Array.isArray(value) ? value.map(stable) : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map(k => [k, stable(value[k])])) : value;
  const {id, structureSet, ...content} = entity;
  return JSON.stringify(stable(content));
}

/** 생성 당시 내용을 비교해 수정 객체·사용자 주석은 남긴다. 구버전처럼 비교 기록이 없으면 보존한다. */
export function applyStructureSet(doc, record, {newId = () => crypto.randomUUID()} = {}) {
  if (!record?.id || !record.model) throw Error('구조 묶음 기록이 올바르지 않습니다.');
  const layers = doc.layers.map(l => ({...l})), byName = new Map(layers.map(l => [l.name, l]));
  const byId = new Map(layers.map(l => [l.id, l])), preserved = [], protectedKeys = new Set();
  const replaceable = new Set();
  for (const e of doc.entities) if (e.structureSet?.id === record.id) {
    const tag = e.structureSet;
    if (tag.generated && !tag.user && !tag.modified && generatedContent(e) === tag.generated) {
      const l = byId.get(e.layer);
      if (l?.locked || l?.frozen) throw Error(l.name + ' 레이어가 잠겨 있거나 얼어 있습니다. 풀고 다시 하세요.');
      replaceable.add(e.id);
    } else {
      preserved.push(e.id);
      if (tag.key) protectedKeys.add(tag.key);
    }
  }
  const entities = doc.entities.filter(e => !replaceable.has(e.id)), removed = replaceable.size, added = [];
  const warnings = preserved.length ? ['사용자가 수정한 객체·주석 또는 생성 비교 기록이 없는 객체 ' + preserved.length + '개를 보존했습니다. 새 모델과 위치·내용을 확인하세요.'] : [];
  let sheets = null;
  const sheetRecords = [];
  if (record.drawn) {
    const r = structureDrawingEntities(record.model, {origin: record.drawn.origin, setId: record.id, sheets: record.drawn.sheets, templates: record.drawn.templates, gridPrefix: record.drawn.gridPrefix,
      planScale: (doc.sheets || []).find(s => /^A-1\d\d$/.test(s.number || ''))?.denominator});
    sheets = r.sheets;
    // 검토 초안 도장(대표 2026-10-30 '로그인이면 초안으로 그림'): 자료 부족(가정값 포함) 구조 묶음은 장마다 크게 적는다 — 시공용 구조도로 오인하지 않게
    if (record.drawn.draft) sheets.forEach((s) => {
      const k = s.scale > 0 ? s.scale : 50, at = s.bounds ? {x: s.bounds.minX + 12 * k, y: s.bounds.maxY - 16 * k} : s.origin && {x: s.origin.x, y: s.origin.y - 12 * k};   // 도곽 없는 장은 원점 아래
      if (!at) return;
      r.entities.push({type: 'text', layer: 'S-ANNO', text: record.drawn.draft, position: at, height: 6 * k, structureSet: {id: record.id, member: 'draft'}});
      r.entitySheets.push(s.sheet + ':' + (s.level ?? ''));
    });
    sheetRecords.push(...sheets.filter(s => s.bounds && s.scale > 0).map(s => ({...s, id: `structure-${record.id}-${s.sheet}`, denominator: s.scale, structureSet: record.id})));
    const ordinals = new Map(), candidates = [];
    for (const [i, e] of r.entities.entries()) {
      const base = JSON.stringify([r.entitySheets[i], e.structureSet.member, e.type, e.layer]), n = ordinals.get(base) || 0;
      ordinals.set(base, n + 1);
      const key = base + ':' + n;
      if (!protectedKeys.has(key)) candidates.push({e, key});
    }
    for (const name of STRUCTURE_LAYERS) {
      if (!candidates.some(({e}) => e.layer === name)) continue;
      if (!byName.has(name)) {
        const s = standardLayerForName(name) || {}, l = {id: newId(), ...s, name, color: s.color || '#ffffff', visible: true, locked: false, lineweight: s.lineweight ?? .25, linetype: s.linetype || 'CONTINUOUS'};
        layers.push(l); byName.set(name, l);
      }
      const l = byName.get(name);
      if (l.locked || l.frozen) throw Error(name + ' 레이어가 잠겨 있거나 얼어 있습니다. 풀고 다시 하세요.');
    }
    for (const {e, key} of candidates) {
      const id = newId(), next = {...e, id, layer: byName.get(e.layer).id};
      next.structureSet = {...e.structureSet, key, generated: generatedContent(next)};
      added.push(id); entities.push(next);
    }
  }
  const {model, ...rest} = record;delete rest.sheetRecords;
  return {document: {...doc, layers, entities, structureSets: {...(doc.structureSets || {}), [record.id]: {...rest, model, ...(sheetRecords.length ? {sheetRecords} : {})}}}, added, removed, sheets, preserved, warnings};
}
