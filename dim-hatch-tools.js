// 치수 5개(LDA CDE DCV DDT DSE) + 해치·표 3개(CON HEX RND) + 도곽 1개(DFS) + 기타 4개(DTS FLT GEE STL) = 13개.
// 근거: docs/izzarder-reference-20260921/references/13-dim.md, 04-hatch-table.md, 09-titleblock.md, 18-etc.md
// (각 원문 번호는 아래 함수 주석과 reports/2차_dim-hatch-tools_보고_20260921.md 대응표 참조).
// 바른 CAD 의 dimension 객체는 {points,mode,text,precision,extensionOffset,extensionOvershoot,...}(dimension-style.js·geometry.js dimensionParts 근거)이고
// 전용 LEADER 객체·무명 그룹·.pat 파일·다른 도면 열기·3D Z값이 없다. 그 경계 안에서 실제 동작하는 것만 만든다.
import * as G from './geometry.js';
import {STD_LAYERS} from './card-kit.js';
import {boundedInteger, isChecked, downloadText, safeFileName} from './card-input.js';
import {hatchToPatDefinition, patFileText, patternName} from './pattern-files.js';
import {installGroupFileTools} from './group-file-tools.js';

export const RND_MAX_COUNT = 500;

/* ── 순수 함수(시험용, DOM 없이 동작) ── */

// LDA(/525) 지시선 끝점 정렬: 바른 CAD 에는 LEADER 객체가 없어 선/폴리선의 마지막 점(끝점)을
// 기준선(refA-refB, 무한 직선)에 투영/연장/절단한다.
export function alignLeaderEndpoint(points, refA, refB) {
  if (!Array.isArray(points) || points.length < 2) throw Error('선/폴리선에는 점이 2개 이상 있어야 합니다.');
  const last = points[points.length - 1], prev = points[points.length - 2];
  if (G.dist(prev, last) < G.EPS) throw Error('지시선의 마지막 구간 길이가 0이라 방향을 알 수 없습니다.');
  const hit = G.lineIntersection(prev, last, refA, refB);
  if (!hit) throw Error('지시선과 기준선이 평행해 정렬할 수 없습니다.');
  const next = [...points];
  next[next.length - 1] = hit.point;
  return next;
}

// dimensionParts(geometry.js)로 재정의 문자(text) 없이 계산한 "실측 표시 문자"를 구한다.
// CDE(/516)·DCV 등에서 원본 실측값을 알아야 할 때 쓴다.
export function baselineDimensionText(dim) {
  const clone = {...dim};
  delete clone.text;
  delete clone.textTemplate;
  const parts = G.dimensionParts(clone);
  const label = parts.find((p) => p.dimensionLabel);
  return label ? label.text : '';
}

// CDE(/516) 치수문자 수정/복원: 절대값 입력·+N/-N 가감·빈칸(복원) 세 가지.
// engine 의 dimension.text 필드(원문 그룹코드 1과 동일한 "재정의 문자, 빈칸=자동")로 구현한다.
export function overrideDimensionText(dim, input) {
  const raw = String(input ?? '').trim();
  if (raw === '' || raw.toUpperCase() === 'R') return {text: ''};
  const m = /^([+-])\s*([0-9]+(?:\.[0-9]+)?)$/.exec(raw);
  if (m) {
    const base = baselineDimensionText(dim);
    const numMatch = /-?[0-9]+(?:\.[0-9]+)?/.exec(base);
    if (!numMatch) throw Error('이 치수의 실측값을 찾을 수 없습니다.');
    const delta = (m[1] === '+' ? 1 : -1) * Number(m[2]);
    const precision = Number.isInteger(dim.precision) ? dim.precision : 2;
    const formatted = Number((Number(numMatch[0]) + delta).toFixed(precision)).toString();
    return {text: base.slice(0, numMatch.index) + formatted + base.slice(numMatch.index + numMatch[0].length)};
  }
  return {text: raw};
}

// DCV(/536) 경사치수를 선형치수로 변환: mode:'aligned' 인 치수의 두 측정점 각도가
// 수직/수평에 가까우면 mode 를 'horizontal'/'vertical' 로 바꾼다(대상 아니면 null).
export function convertDimensionMode(dim, tolerance = 3) {
  if (dim?.mode !== 'aligned') return null;
  const [a, b] = dim.points || [];
  if (!a || !b) return null;
  const ang = ((G.angle(G.sub(b, a)) % 180) + 180) % 180; // 0~180 도
  if (Math.min(ang, 180 - ang) <= tolerance) return 'horizontal';
  if (Math.abs(ang - 90) <= tolerance) return 'vertical';
  return null;
}

// DDT 치수보조선 감추기: 원문 게시글 번호를 정리본·WebSearch(site:izzarder.com DDT) 모두에서 찾지 못했다
// (13-dim.md 명령어 요약표에도 없음) — "치수보조선 감추기"라는 이름 그대로, dimensionParts 의 보조선 계산에
// 쓰이는 extensionOffset/extensionOvershoot 를 0 길이로 접어 시각적으로 감추고(끔) 원래 값으로 되돌리는(켬) 토글로 구현한다.
// radius/diameter/angular/ordinateX/ordinateY 는 이 두 필드를 쓰지 않으므로(geometry.js dimensionParts) 대상에서 뺀다.
export function toggleExtensionLines(dim) {
  if (!['horizontal', 'vertical', 'aligned'].includes(dim?.mode)) return null;
  if (dim.extLineHidden) {
    const saved = dim._dimExtSaved || {};
    return {
      extensionOffset: saved.extensionOffset ?? 50,
      extensionOvershoot: saved.extensionOvershoot ?? 50,
      extLineHidden: false,
      _dimExtSaved: null,
    };
  }
  return {
    _dimExtSaved: {extensionOffset: dim.extensionOffset ?? null, extensionOvershoot: dim.extensionOvershoot ?? null},
    extensionOffset: 1e9,
    extensionOvershoot: 0,
    extLineHidden: true,
  };
}

// RND(/163) 둥근 표면 표현: 두 선 사이를 count 개의 반원(호)으로 잇는다.
// style:'one' 은 한쪽(같은 방향)으로만, 'both' 는 번갈아 양쪽으로 부풀린다.
export function buildRoundSurface(p1, p2, count, style = 'both') {
  /* 2026-09-24: 상한이 없어 200만 개에서 힙이 고갈돼 앱이 죽었다(검토 P2). */
  const n = boundedInteger(Math.round(Number(count)), {min: 1, max: RND_MAX_COUNT, label: 'RND · 갯수'});
  const [a1, b1] = p1, [a2, b2] = p2;
  const lerp = (a, b, t) => ({x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t});
  const arcs = [];
  for (let i = 0; i < n; i++) {
    const tm = (i + 0.5) / n;
    const q1 = lerp(a1, b1, tm), q2 = lerp(a2, b2, tm);
    const radius = G.dist(q1, q2) / 2;
    if (radius < G.EPS) continue;
    const center = {x: (q1.x + q2.x) / 2, y: (q1.y + q2.y) / 2};
    const dirAngle = G.angle(G.sub(q2, q1));
    const bulge = style === 'one' ? true : i % 2 === 0;
    arcs.push({
      type: 'arc',
      center,
      radius,
      startAngle: bulge ? dirAngle : dirAngle + 180,
      endAngle: bulge ? dirAngle + 180 : dirAngle + 360,
    });
  }
  return arcs;
}

// DFS(/321) 도곽 축척 확인: 실측 크기와 표준 용지 크기를 비교해 축척을 역산한다(13-dim.md·09-titleblock.md 공통 패턴).
export const PAPER_SIZES = Object.freeze({
  A0: {w: 841, h: 1189}, A1: {w: 594, h: 841}, A2: {w: 420, h: 594}, A3: {w: 297, h: 420}, A4: {w: 210, h: 297},
});
export function computeDboxScale(p1, p2, paperKey = 'A3') {
  const std = PAPER_SIZES[paperKey];
  if (!std) throw Error('알 수 없는 도면크기입니다: ' + paperKey);
  const w = Math.abs(p2.x - p1.x), h = Math.abs(p2.y - p1.y);
  if (w < G.EPS || h < G.EPS) throw Error('두 점이 만드는 사각형의 폭과 높이가 0보다 커야 합니다.');
  const long = Math.max(w, h), short = Math.min(w, h);
  const stdLong = Math.max(std.w, std.h), stdShort = Math.min(std.w, std.h);
  return {scale: long / stdLong, scaleFromShort: short / stdShort, width: w, height: h, paper: paperKey};
}

// DTS(/422) 도면 생성날짜 기록: 캐드 FIELD 객체가 없어 실행 시점의 날짜/시간을 고정 문자로 남긴다(자동 갱신 아님, 보고서에 기록).
export function formatDateStamp(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `생성: ${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/* ── 화면 명령(install 안에서만 pick/dialog 를 쓴다) ── */

export function installDimHatchTools(ctx) {
  const guard = (fn) => (...args) => {
    try {
      const r = fn(...args);
      if (r && typeof r.catch === 'function') r.catch((e) => {console.error('[card]', e); ctx.toast(ctx.userErrorMessage(e), true);});
    } catch (e) {
      console.error('[card]', e);
      ctx.toast(ctx.userErrorMessage(e), true);
    }
  };
  const none = (cmd, name, reason) => () => ctx.toast(`바른 CAD 에는 ${reason} 이(가) 없어 ${cmd}(${name}) 기능은 아직 제공하지 않습니다.`, true);

  async function lda() {
    const ref = await ctx.pickEntity({prompt: 'LDA · 정렬 기준선을 선택하세요 · Esc 취소', types: ['line', 'polyline']});
    if (!ref) return;
    if (!ref.points || ref.points.length < 2) throw Error('기준선에 점이 2개 이상 필요합니다.');
    const refA = ref.points[0], refB = ref.points[ref.points.length - 1];
    let done = 0, skipped = 0;
    for (;;) {
      const target = await ctx.pickEntity({prompt: `LDA · 정렬할 지시선(선/폴리선) 선택 · 지금까지 ${done}개 · Esc 로 끝내기`, types: ['line', 'polyline']});
      if (!target) break;
      if (target.id === ref.id) {ctx.toast('기준선은 정렬 대상이 될 수 없습니다.', true); continue;}
      try {
        const nextPoints = alignLeaderEndpoint(target.points, refA, refB);
        ctx.execute({type: 'update', ids: [target.id], changes: {points: nextPoints}});
        done++;
      } catch (e) {skipped++; ctx.toast(ctx.userErrorMessage(e), true);}
    }
    ctx.toast(done ? `LDA · 지시선 끝점 ${done}개를 정렬했습니다.${skipped ? ` (${skipped}개 실패)` : ''}` : 'LDA · 정렬한 지시선이 없습니다.');
  }

  function cde() {
    const dims = ctx.selected().filter((e) => e.type === 'dimension');
    if (!dims.length) throw Error('CDE · 치수문자를 바꿀 치수를 먼저 선택하세요.');
    ctx.form('CDE · 치수문자 수정/복원', [
      {name: 'value', label: '새 값 / +50,-50=가감 / 빈칸,R=복원', type: 'text', value: ''},
    ], (values) => {
      const commands = dims.map((dim) => ({type: 'update', ids: [dim.id], changes: overrideDimensionText(dim, values.value)}));
      ctx.execute({type: 'batch', commands});
      ctx.toast(`CDE · 치수문자 ${dims.length}개를 수정했습니다.`);
    });
  }

  function dcv() {
    const dims = ctx.selected().filter((e) => e.type === 'dimension');
    if (!dims.length) throw Error('DCV · 변환할 경사치수를 먼저 선택하세요.');
    const commands = [];
    let skipped = 0;
    for (const dim of dims) {
      const mode = convertDimensionMode(dim);
      if (mode) commands.push({type: 'update', ids: [dim.id], changes: {mode}});
      else skipped++;
    }
    if (!commands.length) throw Error('DCV · 선택한 치수 중 수직/수평에 가까운 경사치수가 없습니다.');
    ctx.execute({type: 'batch', commands});
    ctx.toast(`DCV · 경사치수 ${commands.length}개를 선형치수로 변환했습니다.${skipped ? ` (${skipped}개는 대상 아님)` : ''}`);
  }

  function ddt() {
    const dims = ctx.selected().filter((e) => e.type === 'dimension');
    if (!dims.length) throw Error('DDT · 치수보조선을 감추거나 다시 보일 치수를 먼저 선택하세요.');
    const commands = [];
    let skipped = 0;
    for (const dim of dims) {
      const changes = toggleExtensionLines(dim);
      if (changes) commands.push({type: 'update', ids: [dim.id], changes});
      else skipped++;
    }
    if (!commands.length) throw Error('DDT · 선택한 치수에는 치수보조선이 없습니다(반지름·지름·각도 치수는 대상 아님).');
    ctx.execute({type: 'batch', commands});
    ctx.toast(`DDT · 치수 ${commands.length}개의 치수보조선을 전환했습니다.${skipped ? ` (${skipped}개는 대상 아님)` : ''}`);
  }

  function dse() {
    ctx.toast('DSE · 치수 스타일 관리자(DIMSTYLE)를 엽니다.');
    ctx.run('DIMSTYLE');
  }

  // 콘크리트 = 회색 솔리드, 고른 경계 전부를 해치 하나로(사무소 기준, rules/drawing-standard.json materials.concrete).
  // 미리 고른 폐곡선이 있으면 전부, 없으면 Esc 까지 골라 한 번에. 경계들은 짝홀 규칙이라 떨어진 덩어리는 모두 채워진다.
  const CONCRETE_GRAY = '#808080';
  const closedBoundary = (e) => e && (e.type === 'rectangle' || (e.type === 'polyline' && e.closed));
  async function con() {
    let targets = ctx.selected().filter(closedBoundary);
    if (!targets.length) {
      for (;;) {
        const target = await ctx.pickEntity({prompt: `CON · 콘크리트 해치를 넣을 폐곡선(사각형/닫힌 폴리선)을 선택하세요${targets.length ? ` · ${targets.length}개 선택 · Enter/Esc 로 넣기` : ' · Esc 취소'}`, types: ['polyline', 'rectangle']});
        if (!target) break;
        if (!closedBoundary(target)) throw Error('CON · 닫힌 폴리선을 선택하세요.');
        if (!targets.some((t) => t.id === target.id)) targets.push(target);
      }
    }
    if (!targets.length) return;
    const layer = ctx.ensureLayer('A-WALL-CONC', CONCRETE_GRAY);
    const [first, ...rest] = targets;
    ctx.commit({entities: [{type: 'hatch', points: first.points, loops: rest.map((t) => t.points), pattern: 'solid', solid: true, spacing: 100, angle: 0, color: CONCRETE_GRAY, layer}]});
    ctx.toast(`CON · 콘크리트 해치(회색 솔리드) 하나에 경계 ${targets.length}개를 넣었습니다.`);
  }

  /* HEX(/515) 해치패턴 내보내기 — 2026-09-24 안내만 하던 것을 실제 동작으로: 선택(또는 클릭)한 해치의 무늬를
     AutoCAD 호환 .pat 정의로 만들어 파일로 내려받는다(원문의 [해치 패턴 저장] 대화상자: 패턴 이름·파일 이름). */
  async function hex() {
    let hatches = ctx.selected().filter((e) => e.type === 'hatch');
    if (!hatches.length) {
      const picked = await ctx.pickEntity({prompt: 'HEX · 내보낼 해치를 선택하세요 · Esc 취소', types: ['hatch']});
      if (!picked) return;
      hatches = [picked];
    }
    const exportable = hatches.filter((h) => !h.solid && String(h.pattern || '').toLowerCase() !== 'solid');
    if (!exportable.length) throw Error('HEX · 단색 채움(SOLID) 해치는 선 무늬가 없어 .pat 으로 내보낼 수 없습니다.');
    const first = exportable[0];
    const suggested = /^[A-Za-z0-9_\-]+$/.test(String(first.pattern || '')) && !['lines', 'cross'].includes(first.pattern) ? first.pattern : `BARUN_${first.pattern === 'cross' ? 'CROSS' : 'LINES'}_${Math.round(first.angle || 0)}_${Math.round(first.spacing || 100)}`;
    ctx.form(`HEX · 해치패턴 내보내기(.pat) · 해치 ${exportable.length}개`, [
      {name: 'name', label: '패턴 이름(영문·숫자)', type: 'text', value: patternName(suggested)},
      {name: 'file', label: '파일 이름(.pat 은 자동)', type: 'text', value: 'acadiso'},
    ], (values) => {
      const base = patternName(values.name, 'BARUN_PATTERN');
      const seen = new Set(), definitions = [];
      exportable.forEach((h, i) => {
        const def = hatchToPatDefinition(h, exportable.length > 1 ? `${base}_${i + 1}` : base, `바른 CAD 해치 · 각도 ${h.angle || 0} · 간격 ${h.spacing || 100}`);
        const body = def.slice(def.indexOf(String.fromCharCode(10)) + 1); // 같은 무늬(이름 줄 제외)는 한 번만
        if (!seen.has(body)) {seen.add(body); definitions.push(def);}
      });
      const fileName = safeFileName(String(values.file || 'acadiso').replace(/\.pat$/i, ''), 'acadiso') + '.pat';
      downloadText(fileName, patFileText(definitions, {title: '바른 CAD 해치 내보내기(HEX)'}));
      const skipped = hatches.length - exportable.length;
      ctx.toast(`HEX · 해치 무늬 ${definitions.length}개를 "${fileName}" 로 내보냈습니다${skipped ? ` · 단색 채움 ${skipped}개 제외` : ''}.`);
    });
  }

  function rnd() {
    ctx.form('RND · 둥근 표면 표현', [
      {name: 'style', label: '형식', value: 'both', options: [['both', '양쪽'], ['one', '한쪽']]},
      {name: 'count', label: '갯수', type: 'number', value: 12},
    ], (values) => {
      const n = boundedInteger(values.count, {min: 1, max: RND_MAX_COUNT, label: 'RND · 갯수'});
      setTimeout(() => {(async () => {
        try {
          const line1 = await ctx.pickEntity({prompt: 'RND · 첫 번째 선을 선택하세요 · Esc 취소', types: ['line']});
          if (!line1) return;
          const line2 = await ctx.pickEntity({prompt: 'RND · 두 번째 선을 선택하세요 · Esc 취소', types: ['line']});
          if (!line2) return;
          const arcs = buildRoundSurface(line1.points, line2.points, n, values.style);
          if (!arcs.length) throw Error('두 선 사이 거리가 0이라 그릴 수 없습니다.');
          const layer = ctx.ensureLayer(STD_LAYERS.symb, '#ff9f68');
          ctx.commit({entities: arcs.map((a) => ({...a, layer}))});
          ctx.toast(`RND · 둥근 표면 표현 ${arcs.length}개를 그렸습니다.`);
        } catch (e) {console.error('[card]', e); ctx.toast(ctx.userErrorMessage(e), true);}
      })();}, 0);
    });
  }

  function dfs() {
    ctx.form('DFS · 도곽 축척 확인', [
      {name: 'paper', label: '도면크기', value: 'A3', options: Object.keys(PAPER_SIZES).map((k) => [k, k])},
      {name: 'writeText', label: '축척을 문자로 기록', type: 'checkbox'},
    ], (values) => {
      setTimeout(() => {(async () => {
        try {
          const p1 = await ctx.pickPoint('DFS · 도곽 모서리 한 점을 지정하세요');
          if (!p1) return;
          const p2 = await ctx.pickPoint('DFS · 대각선 반대쪽 모서리를 지정하세요');
          if (!p2) return;
          const result = computeDboxScale(p1, p2, values.paper);
          const scaleText = `1/${Math.round(result.scale)}`;
          ctx.toast(`DFS · 도곽 축척 ${scaleText} (${values.paper} 기준 · 실측 ${Math.round(result.width)}×${Math.round(result.height)}mm)`);
          if (isChecked(values.writeText)) {
            const p3 = await ctx.pickPoint('DFS · 축척 문자를 기록할 위치를 지정하세요');
            if (!p3) return;
            const layer = ctx.ensureLayer('A-TITLE', '#ffffff');
            ctx.commit({entities: [{type: 'text', position: p3, text: `축척 ${scaleText} (${values.paper})`, height: ctx.num('text-height', 150), rotation: 0, align: 'left', layer}]});
          }
        } catch (e) {console.error('[card]', e); ctx.toast(ctx.userErrorMessage(e), true);}
      })();}, 0);
    });
  }

  async function dts() {
    const p = await ctx.pickPoint('DTS · 날짜를 기록할 위치를 지정하세요');
    if (!p) return;
    const layer = ctx.ensureLayer(STD_LAYERS.text, '#ffffff');
    ctx.commit({entities: [{type: 'text', position: p, text: formatDateStamp(), height: ctx.num('text-height', 150), rotation: 0, align: 'left', layer}]});
    ctx.toast('DTS · 생성 날짜를 문자로 기록했습니다.');
  }

  /* FLT·GEE·STL 은 2026-09-24 검토(F13) 뒤 group-file-tools.js 에서 실제 동작으로 구현한다(안내 전용이던 자리를 위임). */
  const groupFile = installGroupFileTools(ctx);
  const flt = groupFile.FLT, gee = groupFile.GEE, stl = groupFile.STL;

  return {
    LDA: guard(lda), CDE: guard(cde), DCV: guard(dcv), DDT: guard(ddt), DSE: guard(dse),
    CON: guard(con), HEX: guard(hex), RND: guard(rnd),
    DFS: guard(dfs),
    DTS: guard(dts), FLT: guard(flt), GEE: guard(gee), STL: guard(stl),
  };
}
