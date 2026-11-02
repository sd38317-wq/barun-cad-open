// 4차 병렬 작업(2026-09-21): "부분" 매핑 12개를 원문대로 다시 만든다.
// 기호 3개(CM SSL SCB) + 출력·저장 5개(WSL BAK PB PUA SVS) + 도형 및 기호 1개(SOL) + 기타 3개(LSC COM CT).
// 근거: 2차 검증 reports/2차_매핑검증_B_보고_20260921.md 의 "3.기호"(CM·SSL·SCB·WSL 행) ·
// "4.출력 및 저장"(BAK·PB·PUA·SVS·SOL 행) · "8.도형 및 기호"·"9.기타"(LSC·COM·CT 행)를 먼저 읽고,
// 정리본 docs/izzarder-reference-20260921/references/03-symbol.md(CM/251 SSL/433 SCB/270 WSL/87) ·
// 17-plot-save.md(BAK/502 PB/545 PUA/379 SVS/111) · 04-hatch-table.md(SOL/507) ·
// 14-shape-line.md(LSC/584) · 01-setup.md(COM/206) · 18-etc.md(CT/177) 를 WebFetch 로 원문까지 직접 읽었다.
// 기존 바른 CAD 명령(architectural-library.js CDT·SECLINE·SCB, app.js backup()·editProperties()·
// showSettings()·MATCHPROP, studio.js PLOTBOX·SHEETDXF, workflows.js BLOCKCLEAN·hatchTools)은 읽기만
// 하고 고치지 않았다 — 그 코드는 옮겨 적지 않고 내 방식대로 새로 짰다(순수 계산만 공유 알고리즘을 참고).
// 12절 중복 확인: symbol-tools.js·output-tools.js·dim-symbol-tools.js·sheet-plot-tools.js 와
// door-card.js 등 기존 카드 전부를 grep 했다 — CM·SSL·SCB·WSL·BAK·PB·PUA·SVS·SOL·LSC·COM·CT 이름의
// 카드는 어디에도 없다(2차_symbol-tools_보고: "CM 자체는 이번 작업 범위가 아니라 아직 없다"로 명시 확인).
// 이미 있는 것은 새로 만들지 않고 ctx.run 으로 그대로 불렀다 — BAK→BACKUP, PUA 의 블록 정리→BLOCKCLEAN,
// SOL 의 "하나로 묶기"→HATCHMERGE(dim-hatch-tools.js, 2차 검증에서 "동등"으로 판정된 카드).
// 이 앱 공용 form() 은 checkbox 를 미리 체크된 상태로 그리지 않는 알려진 제약이 있어(3차 sheet-plot-tools.js
// SER 항목과 같은 사유), on/off 가 중요한 항목은 checkbox 대신 예/아니오 select 로 만들어 기본값이 실제로
// 반영되게 했다. 순수 계산은 export 된 함수로 두어 node --test 가 DOM 없이 돈다.
import * as G from './geometry.js';
import {boundedInteger, boundedNumber, assertGeneratedCount, downloadText, safeFileName} from './card-input.js';
import {plotBoxSheetSpec} from './sheet-plot-tools.js';
import {STD_LAYERS, isPlotBoxLayerName} from './card-kit.js';

/* ════════════════════════════ 공용 헬퍼 ════════════════════════════ */
/** ESS(3차)와 같은 아이디어를 내 모듈 안에서 다시 짠 것 — 접두/접미 사이 값이 숫자면 +1, 알파벳 한 글자면 다음 글자. */
export function nextIncrementValue(value) {
  const s = String(value);
  if (/^-?\d+$/.test(s)) return String(Number(s) + 1);
  if (/^[A-Za-z]$/.test(s)) return String.fromCharCode(s.charCodeAt(0) + 1);
  throw Error('자동증가 값은 숫자 또는 알파벳 한 글자여야 합니다: ' + value);
}
export function cornersToBox(p0, p1) {
  return { minX: Math.min(p0.x, p1.x), minY: Math.min(p0.y, p1.y), maxX: Math.max(p0.x, p1.x), maxY: Math.max(p0.y, p1.y) };
}
export function circlePolygon(center, radius, sides = 24) {
  if (!(radius > 0)) throw Error('반지름은 양수여야 합니다.');
  return Array.from({ length: sides }, (_, i) => { const a = (i / sides) * 2 * Math.PI; return { x: center.x + radius * Math.cos(a), y: center.y + radius * Math.sin(a) }; });
}

/* ══════════════════════════ CM · 구름 수정기호 그리기 (izzarder.com/251) ══════════════════════════
   대체: architectural-library.js CDT(사각형 폭·깊이·pitch·mark 고정 필드 하나뿐). 2차 검증에서 "부분" —
   RevCloud/폴리선 방식 선택, 수정번호 자동증가+접두/접미, 위치자동 이 빠졌다고 했다. 여기서는 폴리선 방식만
   만든다(RevCloud 는 AutoCAD 전용 기능이라 바른 CAD 에 대응 개념이 없다) 대신 수정번호 자동증가·접두/접미·
   위치자동은 전부 채웠다. 2차 symbol-tools.js 의 CMW(구름형 수정기호 입체화)가 이미 있어 "입체화" 옵션은
   만들지 않고 보고서에 CMW 를 안내한다(중복 방지, 12절). */
export function cloudArcs(p0, p1, pitch) {
  if (!(pitch > 0)) throw Error('호 간격은 양수여야 합니다.');
  const minX = Math.min(p0.x, p1.x), minY = Math.min(p0.y, p1.y), maxX = Math.max(p0.x, p1.x), maxY = Math.max(p0.y, p1.y);
  if (maxX - minX < G.EPS || maxY - minY < G.EPS) throw Error('영역의 폭·높이는 0보다 커야 합니다.');
  assertGeneratedCount(Math.ceil(2 * ((maxX - minX) + (maxY - minY)) / pitch), 'CM · 구름 호 개수', 2000);
  const ring = G.rectangle({ x: minX, y: minY }, { x: maxX, y: maxY }), arcs = [];
  for (const [a, b] of G.segments({ points: ring, closed: true })) {
    const segLen = G.dist(a, b), count = Math.max(1, Math.round(segLen / pitch));
    for (let i = 0; i < count; i++) {
      const s = G.add(a, G.mul(G.sub(b, a), i / count)), e = G.add(a, G.mul(G.sub(b, a), (i + 1) / count));
      const center = G.mul(G.add(s, e), 0.5), ang = G.angle(G.sub(e, s));
      arcs.push({ center, radius: G.dist(s, e) / 2, startAngle: ang + 180, endAngle: ang + 360 });
    }
  }
  return { arcs, bounds: { minX, minY, maxX, maxY } };
}
export function cloudMarkAnchor(bounds, refPoint, auto) {
  const corners = [{ x: bounds.minX, y: bounds.minY }, { x: bounds.maxX, y: bounds.minY }, { x: bounds.maxX, y: bounds.maxY }, { x: bounds.minX, y: bounds.maxY }];
  if (!auto) return corners[3];
  let best = corners[0], bd = Infinity;
  for (const c of corners) { const d = G.dist(c, refPoint); if (d < bd) { bd = d; best = c; } }
  return best;
}

/* ══════════════════════════ SSL · 단면기호 그리기 (izzarder.com/433) ══════════════════════════
   대체: architectural-library.js SECLINE(폭·선길이·mark·reference 고정 필드). 2차 검증 "부분" — 핵심(원+
   해치+번호/도면번호 2단 문자)은 겹치나 리더선+반지름 기반 원, 기호/해치/문자 레이어 분리가 빠졌다.
   2차 symbol-tools.js 의 buildPPB(참조도면 기호, 사각형+리더+2단 문자 원)와 같은 짜임을 참고해 리더+원+
   해치+2단 문자로 다시 짰다 (import 는 하지 않고 직접 다시 썼다 — 3절). */
export function sectionSymbolEntities(leaderFrom, center, { radius, textHeight, mark, reference } = {}) {
  if (!(radius > 0) || !(textHeight > 0)) throw Error('반지름·문자크기는 양수여야 합니다.');
  if (G.dist(leaderFrom, center) < G.EPS) throw Error('리더 시작점과 기호 중심은 서로 달라야 합니다.');
  const divider = { type: 'line', points: [{ x: center.x - radius * 0.6, y: center.y }, { x: center.x + radius * 0.6, y: center.y }] };
  return [
    { type: 'line', points: [leaderFrom, center] },
    { type: 'circle', center, radius },
    { type: 'hatch', points: circlePolygon(center, radius, 16), solid: false, spacing: Math.max(1, radius * 0.25), angle: 45 },
    divider,
    { type: 'text', position: { x: center.x, y: center.y + radius * 0.18 }, text: String(mark), height: textHeight, align: 'center' },
    { type: 'text', position: { x: center.x, y: center.y - radius * 0.55 }, text: String(reference), height: textHeight * 0.8, align: 'center' },
  ];
}

/* ══════════════════════════ SCB · 축척막대 그리기 (izzarder.com/270) ══════════════════════════
   대체: architectural-library.js SCB(체스판형 하나만, 스타일 선택 없음). 2차 검증 "부분" — 4가지 스타일
   선택, LTSCALE 자동연동, 선/숫자 켜 개별 지정이 빠졌다고 했다. 스타일 4종(체스판형 + 계단형 3굵기)을
   추가했고, LTSCALE 자동연동은 ctx 에 선축척 읽기 경로가 없어 만들지 못했다(11절 — note 에만 남긴다).
   선/숫자 켜 개별 지정 드롭다운은 11절(항목 줄이기)에 따라 빼고 §6 표준 켜(A-SYM/A-TEXT)로
   고정했다. */
export function scaleBarLabel(denominator) {
  const n = Number(denominator);
  if (!(n > 0)) throw Error('축척 분모는 양수여야 합니다.');
  return 'Scale : 1/' + n;
}
export const SCB_MAX_DIVISIONS = 50;
export function scaleBarDivisions(length, divisions) {
  if (!(length > 0)) throw Error('길이는 양수여야 합니다.');
  if (!Number.isInteger(divisions) || divisions < 1 || divisions > SCB_MAX_DIVISIONS) throw Error('분할 수는 1~50 정수입니다.');
  const step = length / divisions, marks = [];
  for (let i = 0; i <= divisions; i++) {
    const m = i * step / 1000;
    marks.push({ x: i * step, label: (Math.round(m * 100) / 100).toString() });
  }
  return marks;
}
export function scaleBarBars(style, length, divisions) {
  /* 2026-09-24: 상한 없이 1e15 가 들어오면 막대 배열이 힙을 다 써서 멈췄다(검토 P2) — 표시 눈금과 같은 1~50 으로 막는다. */
  if (!Number.isInteger(divisions) || divisions < 1 || divisions > SCB_MAX_DIVISIONS) throw Error('분할 수는 1~50 정수입니다.');
  if (!(length > 0)) throw Error('길이는 양수여야 합니다.');
  const step = length / divisions, bars = [];
  for (let i = 0; i < divisions; i++) bars.push({ x: i * step, width: step, filled: style === 'chess' && i % 2 === 0 });
  return bars;
}
export const SCB_LINEWEIGHT = Object.freeze({ chess: 0.25, 'step-thin': 0.25, 'step-med': 0.45, 'step-thick': 0.7 });

/* ══════════════════════════ WSL · 창호기호 리스트 만들기 (izzarder.com/87) ══════════════════════════
   대체: app.js WLIST → architecturalCounts('WLIST')(집계 하나뿐). 2차 검증 "부분" — 넣기/위치/기호변경
   3가지 실행방식이 통째로 빠졌다. 여기서 4방식(넣기·목록·위치·기호변경)을 모두 만든다. 사용자 속성블럭
   등록([블럭등록화면])은 바른 CAD 에 ATTDEF 개념이 없어 만들지 않았다 — 기본원형/기본육각 2종만 제공한다. */
/* 2026-09-24: 블록 자식은 바른 CAD 에서 "도면 좌표"로 저장된다(geometry.js primitives 가 변환 없이 그린다).
   예전에는 자식을 (0,0) 기준으로 만들고 켜도 주지 않아 엔진 검증("객체의 레이어가 없습니다")에 걸렸고,
   통과했더라도 원점에 그려졌을 것이다. 자식을 삽입점 기준 도면 좌표로 옮기고 블록과 같은 켜를 준다. */
export function windowSymbolBlock(position, mark, { shape = 'circle', size = 600, layer } = {}) {
  if (!(size > 0)) throw Error('기호 크기는 양수여야 합니다.');
  if (!position || !Number.isFinite(position.x) || !Number.isFinite(position.y)) throw Error('기호를 놓을 점이 올바르지 않습니다.');
  const r = size / 2, at = (x, y) => ({ x: position.x + x, y: position.y + y });
  const withLayer = (e) => (layer ? { ...e, layer } : e);
  const outline = shape === 'hex'
    ? { type: 'polyline', closed: true, points: Array.from({ length: 6 }, (_, i) => at(r * Math.cos(i * 60 * Math.PI / 180), r * Math.sin(i * 60 * Math.PI / 180))) }
    : { type: 'circle', center: at(0, 0), radius: r };
  const text = { type: 'text', position: at(0, 0), text: String(mark), height: r * 0.7, rotation: 0, align: 'center' };
  return withLayer({ type: 'block', name: '창호기호', category: 'XI_WSL', position: { ...position }, rotation: 0, scale: 1, attributes: { mark: String(mark), count: 1 }, entities: [withLayer(outline), withLayer(text)] });
}
export function openingSymbolCountsFromSelection(entities, selected) {
  const all = entities || [];
  const picked = Array.isArray(selected) ? selected : [...(selected || [])];
  const rows = openingSymbolCounts(picked.length ? picked : all);
  return rows.length || !picked.length ? rows : openingSymbolCounts(all);
}

export function openingSymbolCounts(entities) {
  const groups = new Map();
  for (const e of entities || []) {
    if (e.type !== 'block' || e.category !== 'XI_WSL') continue;
    const mark = String(e.attributes?.mark || '').trim(); if (!mark) continue;
    const qty = Number(e.attributes?.count) || 1;
    groups.set(mark, (groups.get(mark) || 0) + qty);
  }
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b, 'ko', { numeric: true }));
}
export function parseMarkNumber(mark) {
  const m = /^(.*?)(\d+)$/.exec(String(mark || ''));
  return m ? { prefix: m[1], number: Number(m[2]) } : null;
}
export function renameMarkPlan(entities, from, to) {
  return (entities || []).filter(e => e.type === 'block' && e.category === 'XI_WSL' && String(e.attributes?.mark || '') === String(from))
    .map(e => ({ id: e.id, attributes: { ...e.attributes, mark: to } }));
}
export function countChangePlan(entities, mark, newCount) {
  if (!(newCount > 0)) throw Error('갯수는 양수여야 합니다.');
  return (entities || []).filter(e => e.type === 'block' && e.category === 'XI_WSL' && String(e.attributes?.mark || '') === String(mark))
    .map(e => ({ id: e.id, attributes: { ...e.attributes, count: newCount } }));
}
/** 원문: "3→4 로 밀기"는 번호 3 이상 전부 +1, "4→3 으로 당기기"는 번호 4 이상 전부 -1 — 두 경우 모두
 *  threshold=fromNumber, delta=toNumber-fromNumber 하나의 식으로 계산된다. 계산을 한 번에 끝내고
 *  한 batch 로 적용하므로(호출 쪽) 원문이 걱정하는 "적용 순서" 문제(중복 번호 충돌)가 애초에 없다. */
export function shiftMarkPlan(entities, fromNumber, delta) {
  const plan = [];
  for (const e of entities || []) {
    if (e.type !== 'block' || e.category !== 'XI_WSL') continue;
    const parsed = parseMarkNumber(e.attributes?.mark);
    if (parsed && parsed.number >= fromNumber) plan.push({ id: e.id, attributes: { ...e.attributes, mark: parsed.prefix + (parsed.number + delta) } });
  }
  return plan;
}

/* ══════════════════════════ BAK · 도면 백업 저장 (izzarder.com/502) ══════════════════════════
   대체: app.js backup()(고정 이름 fileName+'.bcad'). 2차 검증 "부분" — 파일명에 시각 타임스탬프가 자동으로
   붙지 않아 반복 실행 시 이전 백업을 덮어쓴다고 했다. cardContext 에는 현재 파일명·저장 폴더·파일쓰기 권한이
   전혀 없어(§5 목록에 없음) 카드 쪽에서 새 파일명으로 저장할 방법이 없다 — 정직하게 "없음"으로 보고서에
   적고, 대신 기존 BACKUP 명령을 그대로 실행한다(ctx.run, 12절). timestampLabel 은 원문 파일명 형식을
   화면에 보여주기 위한 계산만 한다(실제 파일명에는 쓰이지 않는다). */
export function timestampLabel(date = new Date()) {
  const p = n => String(n).padStart(2, '0');
  return `${date.getFullYear()}.${p(date.getMonth() + 1)}${p(date.getDate())}.${p(date.getHours())}${p(date.getMinutes())}`;
}
/** 원문 예: Drawing1_2020.1106.0959 → 바른 CAD 백업 파일 이름 "도면이름_년.월일.시분.bcad". */
export function backupFileName(baseName, date = new Date()) {
  return `${safeFileName(baseName, '도면')}_${timestampLabel(date)}.bcad`;
}

/* ══════════════════════════ PB · 출력박스 하나씩 그리기 (izzarder.com/545) ══════════════════════════
   대체: studio.js PLOTBOX(도면번호·제목·용지·축척까지 입력해야 하는 시트 메타데이터 폼). 2차 검증 "부분" —
   원문은 대화상자 없이 두 점만 찍으면 끝나는 가벼운 모드인데 그 모드가 없다고 했다. 여기서는 정확히 원문
   그대로 대화상자 없이 두 점 → 출력 박스(A-PLOT) 켜 사각형(3차 sheet-plot-tools.js PBS 와 같은 켜 이름 — 그 파일이
   이미 쓰고 있는 이름을 그대로 따른 것이지 그 파일을 고치거나 가져오지 않았다). */

/* ══════════════════════════ PUA · 모든 것 퍼지 (izzarder.com/379) ══════════════════════════
   대체: workflows.js BLOCKCLEAN(미사용 블록 정의만). 2차 검증 "부분" — PUA는 블록뿐 아니라 레이어·문자
   모양·치수모양·DGN 선종류·포인트도 대상인데 BLOCKCLEAN 은 블록만 처리한다고 했다. 포인트 객체 삭제·
   내용없는 문자 삭제·사용하지 않는 켜 삭제를 추가하고, 블록 정리는 새로 만들지 않고 ctx.run('BLOCKCLEAN')
   으로 그대로 불렀다(12절). 주석축척 초기화·DGN 선종류·Audit·문자모양/치수모양 기본화·설정 슬롯 저장은
   바른 CAD 에 해당 개념(스타일 테이블·DGN·Audit)이 없어 만들지 않았다. */
export function emptyTextIds(entities) {
  return (entities || []).filter(e => e.type === 'text' && !String(e.text || '').trim()).map(e => e.id);
}
export function pointEntityIds(entities) {
  return (entities || []).filter(e => e.type === 'point').map(e => e.id);
}
export function unusedLayerIds(entities, layers, blocks = [], keepLayerIds = []) {
  const used = new Set(keepLayerIds.filter(Boolean));
  const visit = e => { if (e?.layer) used.add(e.layer); for (const c of e?.entities || []) visit(c); };
  for (const e of entities || []) visit(e);
  for (const b of blocks || []) visit(b); // 2026-09-24: 블록 정의만 쓰는 켜는 엔진이 삭제를 거부한다(MSL 과 같은 사유)
  return (layers || []).filter(l => !used.has(l.id) && l.name !== '0' && !l.locked).map(l => l.id);
}

/* ══════════════════════════ SVS · 개별 파일로 도면 분리하기 (izzarder.com/111) ══════════════════════════
   대체: studio.js SHEETDXF(exportSheetDxfs(requireSheets()) — engine.doc.sheets 에 사전 등록된 도곽만
   가능). 2차 검증 "부분" — 원문의 핵심은 "도면 안에서 도곽을 스캔·크로싱선택으로 자동 등록"하는 워크플로인데
   SHEETDXF 는 사용자가 도곽을 하나씩 수동 지정해야 한다고 했다. cardContext 에는 engine.doc.sheets 를
   읽거나 쓰는 통로가 없어(§5 목록에 document.update 도, sheets() 도 없음) 실제 시트 등록·파일 저장은
   카드에서 만들 수 없다 — 정직하게 그 부분은 "없음"으로 보고서에 적는다. 대신 원문이 요구하는 핵심 갭
   ("자동 인식")을 채운다: 지정켜(같은 켜의 사각형 자동탐지, PBM 과 같은 발상을 내 모듈 안에서 다시 짬) ·
   속성블럭(태그로 자동 인식) · 일반블럭(크로싱으로 도면명·번호 추출) 세 방식으로 도곽 후보를 찾아 출력 박스(A-PLOT)
   켜 사각형 + 번호 문자로 화면에 등록해 보여주고, 실제 파일 분리는 기존 PLOTBOX/SHEETDXF 를 쓰라고
   안내한다. */
export function isAxisAlignedQuad(entity) {
  if (!entity) return false;
  if (!(entity.type === 'rectangle' || (entity.type === 'polyline' && entity.closed))) return false;
  let pts = entity.points;
  if (!Array.isArray(pts)) return false;
  if (pts.length === 5 && Math.abs(pts[0].x - pts[4].x) < 1e-6 && Math.abs(pts[0].y - pts[4].y) < 1e-6) pts = pts.slice(0, 4);
  if (pts.length !== 4) return false;
  const xs = pts.map(p => p.x), ys = pts.map(p => p.y), minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  if (maxX - minX < 1e-6 || maxY - minY < 1e-6) return false;
  return pts.every(p => (Math.abs(p.x - minX) < 1e-6 || Math.abs(p.x - maxX) < 1e-6) && (Math.abs(p.y - minY) < 1e-6 || Math.abs(p.y - maxY) < 1e-6));
}
export function quadCandidates(entities, layerId) {
  return (entities || []).filter(e => e.layer === layerId && isAxisAlignedQuad(e)).map(e => G.bounds([e]));
}
/** 지정켜 방식 후보: 그 켜의 사각형 + PB/PBM/PBS/PLOTBOX 로 만든 출력 박스(plotBox 표식, 켜와 무관)를 겹침 없이 모은다. */
export function plotBoxCandidates(entities, layerId) {
  const out = [], seen = new Set();
  for (const e of entities || []) {
    if (!isAxisAlignedQuad(e)) continue;
    if (!(e.plotBox || (layerId && e.layer === layerId))) continue;
    const b = G.bounds([e]); if (!b) continue;
    const key = [b.minX, b.minY, b.maxX, b.maxY].map(v => Math.round(v * 1000) / 1000).join(',');
    if (seen.has(key)) continue;
    seen.add(key); out.push(b);
  }
  return out;
}
/* 2026-09-24: 블록 자식은 이미 도면 좌표다(geometry.js primitives·bounds 가 변환 없이 쓴다). 예전 구현은 삽입점을
   한 번 더 더해 도곽 경계가 삽입점만큼 밀렸다. 공유 블록(sharedBlock)까지 G.bounds 가 계산한다. */
export function blockWorldBounds(block) {
  if (!block) return null;
  if (block.sharedBlock) return G.bounds([{ ...block, type: 'block' }]) || null;
  if (!(block.entities || []).length) return null;
  return G.bounds(block.entities) || null;
}
/** SVS 분리 저장: 도곽 후보 → 도면 도곽(sheet). 번호는 파일 이름이 되므로 파일 이름에 못 쓰는 글자를 바꾸고, 이미 있는 번호와
 *  겹치면 -2, -3 을 붙인다. 용지·축척은 PPP 와 같은 plotBoxSheetSpec 으로 고른다. */
export function svsSheetPlan(candidates, existingSheets, makeId = () => globalThis.crypto?.randomUUID?.() || ('svs-' + Math.random().toString(36).slice(2))) {
  const used = new Set((existingSheets || []).map(s => String(s.number)));
  return (candidates || []).map((c, i) => {
    const base = safeFileName(String(c.number || '').trim(), 'S-' + String(i + 1).padStart(3, '0'));
    let number = base, n = 2;
    while (used.has(number)) number = `${base}-${n++}`;
    used.add(number);
    return { id: makeId(), number, title: c.title || 'SVS 도곽', ...plotBoxSheetSpec(c.bounds), bounds: { ...c.bounds }, plotBox: true };
  });
}
export function attributeCandidates(entities, nameTag, numberTag) {
  const out = [];
  for (const e of entities || []) {
    if (e.type !== 'block') continue;
    const num = e.attributes?.[numberTag];
    if (num === undefined || num === null || String(num).trim() === '') continue;
    const bounds = blockWorldBounds(e); if (!bounds) continue;
    out.push({ bounds, number: String(num).trim(), title: String(e.attributes?.[nameTag] || '').trim() });
  }
  return out;
}
export function textsInsideBox(entities, box) {
  return (entities || []).filter(e => e.type === 'text' && e.position && e.position.x >= box.minX && e.position.x <= box.maxX && e.position.y >= box.minY && e.position.y <= box.maxY)
    .sort((a, b) => b.position.y - a.position.y || a.position.x - b.position.x)
    .map(e => String(e.text || '').trim()).filter(Boolean);
}
export function autoSheetNumbers(count, prefix = 'A-', start = 1, digits = 3) {
  return Array.from({ length: count }, (_, i) => prefix + String(start + i).padStart(digits, '0'));
}

/* ══════════════════════════ SOL · 솔리드 해치 (izzarder.com/507) ══════════════════════════
   대체: app.js HATCH(hatch-style 드롭다운에서 매번 손으로 "solid" 를 골라야 하는 범용 폼). 2차 검증
   "부분" — 원문은 "표준 HATCH 명령과 동일한 결과"라고 명시하지만 명령행 옵션(단일/여러/점지정)과
   HPSEPARATE(합침/개별)를 갖춘 전용 원-키 명령이라고 했다. 세 선택 방식을 모두 만들었고, "하나로 묶기"는
   새로 만들지 않고 이미 있는 HATCHMERGE(dim-hatch-tools.js, 2차 검증 "동등")를 ctx.run 으로 그대로
   불렀다(12절). */
export function entityContainingPoint(entities, point) {
  let best = null, bestArea = Infinity;
  for (const e of entities || []) {
    if (e.type === 'circle') {
      if (G.dist(e.center, point) > e.radius) continue;
      const area = Math.PI * e.radius * e.radius;
      if (area < bestArea) { bestArea = area; best = e; }
    } else if ((e.type === 'polyline' && e.closed) || e.type === 'rectangle') {
      const pts = e.points || []; if (pts.length < 3) continue;
      if (!G.inside(point, pts)) continue;
      const area = Math.abs(G.polygonArea(pts));
      if (area < bestArea) { bestArea = area; best = e; }
    }
  }
  return best;
}
export function solidHatchBoundaryPoints(entity) {
  if (entity.type === 'circle') return circlePolygon(entity.center, entity.radius, 24);
  if (!entity.points || entity.points.length < 3) throw Error('경계는 점 3개 이상이어야 합니다.');
  return entity.points;
}

/* ══════════════════════════ LSC · 선종류축척 변경 (izzarder.com/584) ══════════════════════════
   대체: app.js editProperties()의 linetypeScale 필드(다른 무관한 속성과 뒤섞인 범용 폼, 항상 절대값 하나를
   전체에 동일 적용). 2차 검증 "부분" — "기존 값의 배수"(각 객체가 서로 다른 기존값을 유지한 채 곱하기)
   모드가 없다고 했다. 절대값/배수 두 모드를 갖춘 전용 카드로 다시 만든다. */
export function computeLinetypeScales(entities, mode, value) {
  if (!(value > 0)) throw Error('값은 양수여야 합니다.');
  return (entities || []).map(e => ({ id: e.id, linetypeScale: mode === 'multiply' ? (Number(e.linetypeScale) || 1) * value : value }));
}

/* ══════════════════════════ COM · 명령어 단축키 수정 (izzarder.com/206) ══════════════════════════
   대체: app.js showSettings()(별칭/단축키 프로필 콤보 + 검색 + 중복 하이라이트, 전체 명령 체계와 실제로
   연결됨). 2차 검증 "부분" — 핵심 개념(단축키/별칭 표 편집+중복 검사+저장)은 겹치나 pgp 기록·프로필
   다중 저장/불러오기·카테고리 트리·설정값 초기화는 없다고 했다. 여기서는 그 빠진 부분을 채우려 시도하되,
   진짜 명령 파싱(app.js/commands.js, 공유 파일)을 고칠 수 없으므로 실제로 단축키 인식을 바꾸지는 못한다 —
   독자적인 참고 표(카드 전용 localStorage)로 등록·조회·삭제·중복검사만 제공하고, 정직하게 한계를
   토스트/보고서에 적는다. */
export function findDuplicateShortcut(map, command, excludeKey) {
  for (const [k, v] of Object.entries(map || {})) if (k !== excludeKey && v?.command === command) return k;
  return null;
}

/* ══════════════════════════ CT · 객체 내용 복사 (izzarder.com/177) ══════════════════════════
   대체: app.js MATCHPROP(레이어·색·선종류·선굵기만 복사, 문자내용·길이·두께·반지름·블럭종류는 전혀 다루지
   않음). 2차 검증 "부분" — CT 의 핵심(문자 내용·선 길이·폴리선 두께·원/호 반지름·블럭 종류 복사)이 전혀
   없다고 했다. 타입별 내용 복사를 새로 만든다(레이어·색은 옵션으로 함께 복사할 수 있게 곁들였다 — 굳이
   MATCHPROP 을 다시 부르지 않고 한 카드 안에서 끝낸다, 원문도 "원본 선택→대상 선택" 흐름이 하나다). */
export function copyContentChanges(source, target, { layer = false, style = false } = {}) {
  if (!source || !target) throw Error('원본·대상 객체가 필요합니다.');
  const changes = {};
  if (source.type === target.type) {
    if (source.type === 'text') changes.text = source.text;
    else if (source.type === 'line' && target.points?.length >= 2 && source.points?.length >= 2) {
      const a = target.points[0], dir = G.unit(G.sub(target.points[1], target.points[0])), len = G.dist(source.points[0], source.points[1]);
      changes.points = [a, G.add(a, G.mul(dir, len))];
    } else if ((source.type === 'polyline' || source.type === 'rectangle') && source.lineweight !== undefined) changes.lineweight = source.lineweight;
    else if ((source.type === 'circle' || source.type === 'arc') && source.radius !== undefined) changes.radius = source.radius;
    else if (source.type === 'block') { changes.name = source.name; if (source.entities) changes.entities = structuredClone(source.entities); }
  }
  if (layer) changes.layer = source.layer;
  if (style) { changes.color = source.color; changes.linetype = source.linetype; }
  return changes;
}

/* ══════════════════════════ 화면 문맥이 필요한 명령들 ══════════════════════════ */
export function installSymbolOutputTools4(ctx) {
  const yes = v => v === 'yes' || v === true || v === 'on';
  const askForm = (title, fields) => new Promise((resolve, reject) => { ctx.form(title, fields, values => { try { resolve(values); } catch (e) { reject(e); } }); });
  const runAsync = (title, fields, handler) => ctx.form(title, fields, values => { setTimeout(() => { (async () => {
    try { await handler(values); } catch (e) { console.error('[card]', e); ctx.toast(ctx.userErrorMessage(e), true); }
  })(); }, 0); });
  /** LSC 등 "선택된 게 있으면 그걸 쓰고, 없으면 Esc 까지 눌러 모으는" 공통 흐름(3차 edit-calc-tools.js collect 와 같은 발상, 직접 다시 짬). */
  async function collectEntities(prompt, { types = null } = {}) {
    const ok = e => !types || types.includes(e.type);
    const pre = ctx.selected().filter(ok);
    if (pre.length) return pre;
    const list = [];
    for (;;) {
      const e = await ctx.pickEntity({ prompt: `${prompt} · Esc 종료${list.length ? ` · 지금까지 ${list.length}개` : ''}`, ...(types ? { types } : {}) });
      if (!e) break;
      if (!ok(e)) { ctx.toast('이 명령이 다룰 수 있는 종류가 아닙니다.', true); continue; }
      if (!list.some(x => x.id === e.id)) list.push(e);
    }
    if (!list.length) throw Error('선택한 객체가 없습니다.');
    return list;
  }

  /* ── CM ── */
  function CM() {
    runAsync('CM · 구름 수정기호 그리기', [
      { name: 'pitch', label: '호 간격 mm', type: 'number', value: 1600 },
      { name: 'markSize', label: '수정번호 문자 크기 mm', type: 'number', value: 400 },
      { name: 'showMark', label: '수정번호 표현', value: 'yes', options: [['yes', '표시'], ['no', '표시 안 함']] },
      { name: 'autoIncrement', label: '번호 자동증가', value: 'no', options: [['yes', '켬'], ['no', '끔']] },
      { name: 'autoPosition', label: '번호 위치자동', value: 'yes', options: [['yes', '자동(가까운 꼭짓점)'], ['no', '항상 좌상귀']] },
      { name: 'prefix', label: '접두어', value: '' },
      { name: 'suffix', label: '접미어', value: '' },
    ], async values => {
      const pitch = Number(values.pitch), markSize = Number(values.markSize);
      const showMark = yes(values.showMark), auto = yes(values.autoIncrement), autoPos = yes(values.autoPosition);
      let mark = ctx.storage.getItem('barun-cm-mark') || '1';
      const layerId = ctx.ensureLayer('A-SYM', '#ff9f68');
      let count = 0;
      for (;;) {
        const path = await ctx.pickPath({ prompt: `CM · 수정 영역의 대각 두 점을 지정하세요 · Esc 종료${count ? ` · 지금까지 ${count}개` : ''}`, minPoints: 2, maxPoints: 2 });
        if (!path) break;
        const [p0, p1] = path.points;
        const { arcs, bounds } = cloudArcs(p0, p1, pitch);
        const entities = arcs.map(a => ({ type: 'arc', layer: layerId, center: a.center, radius: a.radius, startAngle: a.startAngle, endAngle: a.endAngle }));
        if (showMark) {
          const anchor = cloudMarkAnchor(bounds, p0, autoPos);
          entities.push({ type: 'text', layer: layerId, position: anchor, text: values.prefix + mark + values.suffix, height: markSize, align: 'center' });
        }
        ctx.commit({ entities });
        count++;
        if (auto) { mark = nextIncrementValue(mark); ctx.storage.setItem('barun-cm-mark', mark); }
      }
      if (count) ctx.toast(`CM · 구름 수정기호 ${count}개를 그렸습니다(폴리선 방식만 제공 · RevCloud·구름특성그립·입체화(→ CMW 명령 이용)·입력시 오스냅풀기는 바른 CAD 구조상 없음) · Ctrl+Z 로 되돌리기`);
    });
  }

  /* ── SSL ── */
  function SSL() {
    runAsync('SSL · 단면기호 그리기', [
      { name: 'radius', label: '반지름 mm', type: 'number', value: 700 },
      { name: 'textHeight', label: '문자크기 mm', type: 'number', value: 250 },
      { name: 'mark', label: '단면 번호', value: 'A' },
      { name: 'reference', label: '참조 도면', value: 'A-101' },
    ], async values => {
      const radius = Number(values.radius), textHeight = Number(values.textHeight);
      let count = 0;
      for (;;) {
        const leaderFrom = await ctx.pickPoint(`SSL · 절단 위치(리더 시작점)를 지정하세요 · Esc 종료${count ? ` · 지금까지 ${count}개` : ''}`);
        if (!leaderFrom) break;
        const center = await ctx.pickPoint('SSL · 기호(원)를 놓을 점을 지정하세요 · Esc 취소');
        if (!center) break;
        const entities = sectionSymbolEntities(leaderFrom, center, { radius, textHeight, mark: values.mark, reference: values.reference });
        const layerId = ctx.ensureLayer('A-SYM', '#ff9f68');
        ctx.commit({ entities: entities.map(e => ({ ...e, layer: layerId })) });
        count++;
      }
      if (count) ctx.toast(`SSL · 단면기호 ${count}개를 그렸습니다(기호·해치·문자 개별 켜 지정은 없이 한 켜로 통일) · Ctrl+Z 로 되돌리기`);
    });
  }

  /* ── SCB ── */
  async function SCB() {
    const p = await ctx.pickPoint('SCB · 축척막대를 놓을 왼쪽 아래 점을 지정하세요');
    if (!p) return;
    ctx.form('SCB · 축척막대 그리기', [
      { name: 'style', label: '모양', value: 'chess', options: [['chess', '체스판형'], ['step-thin', '계단형(가는선)'], ['step-med', '계단형(중간)'], ['step-thick', '계단형(굵은선)']] },
      { name: 'length', label: '실제 표시 길이 mm', type: 'number', value: 10000 },
      { name: 'divisions', label: '분할 수', type: 'number', value: 5 },
      { name: 'height', label: '막대 높이 mm', type: 'number', value: 300 },
      { name: 'denominator', label: '축척 분모(1:__)', type: 'number', value: 100 },
    ], values => {
      const style = values.style;
      const divisions = boundedInteger(values.divisions, { min: 1, max: SCB_MAX_DIVISIONS, label: 'SCB · 분할 수' });
      const length = boundedNumber(values.length, { min: 0, max: 1e7, exclusiveMin: true, label: 'SCB · 실제 표시 길이(mm)' });
      const height = boundedNumber(values.height, { min: 0, max: 1e6, exclusiveMin: true, label: 'SCB · 막대 높이(mm)' });
      const denominator = boundedNumber(values.denominator, { min: 0, max: 1e6, exclusiveMin: true, label: 'SCB · 축척 분모' });
      const marks = scaleBarDivisions(length, divisions), bars = scaleBarBars(style, length, divisions), label = scaleBarLabel(denominator);
      const barLayer = ctx.ensureLayer('A-SYM', '#ff9f68'), textLayer = ctx.ensureLayer('A-TEXT', '#ffffff');
      const th = Math.max(80, height * 0.6), entities = [];
      for (const b of bars) {
        const rect = { type: 'rectangle', layer: barLayer, points: G.rectangle({ x: p.x + b.x, y: p.y }, { x: p.x + b.x + b.width, y: p.y + height }), lineweight: SCB_LINEWEIGHT[style] };
        entities.push(rect);
        if (b.filled) entities.push({ type: 'hatch', layer: barLayer, points: rect.points, solid: true });
      }
      for (const m of marks) entities.push({ type: 'text', layer: textLayer, position: { x: p.x + m.x, y: p.y - th * 1.4 }, text: m.label, height: th, align: 'center' });
      entities.push({ type: 'text', layer: textLayer, position: { x: p.x, y: p.y + height + th * 0.4 }, text: label, height: th, align: 'left' });
      ctx.commit({ entities });
      ctx.toast(`SCB · 축척막대를 그렸습니다(${style}) · LTSCALE 자동연동은 카드 문맥에 선축척 값이 없어 축척 분모를 직접 입력받는 것으로 대신했습니다 · Ctrl+Z 로 되돌리기`);
    });
  }

  /* ── WSL ── */
  function WSL() {
    ctx.form('WSL · 창호기호 리스트 만들기', [
      { name: 'mode', label: '실행방식', value: 'insert', options: [['insert', '넣기'], ['list', '목록'], ['locate', '위치'], ['renumber', '기호변경']] },
      { name: 'shape', label: '기호정의(넣기)', value: 'circle', options: [['circle', '기본원형'], ['hex', '기본육각']] },
    ], values => { setTimeout(() => { (async () => {
      try {
        const layerId = ctx.ensureLayer('A-SYM', '#ff9f68');
        if (values.mode === 'insert') {
          // 찍은 자리 가까이(기호 크기 3배 안)에 문(A-DOOR·DOOR 레이어)이 있으면 D 번호, 아니면 W 번호를 따로 늘린다.
          // 예전엔 문에도 W 번호가 이어 붙었다(2026-10-27 설명서 시험).
          const marks = { W: ctx.storage.getItem('barun-wsl-mark') || 'W1', D: ctx.storage.getItem('barun-wsl-door-mark') || 'D1' };
          const storeKey = { W: 'barun-wsl-mark', D: 'barun-wsl-door-mark' };
          const size = ctx.num('wsl-symbol-size', 600), layerNames = new Map(ctx.layers().map(l => [l.id, String(l.name || '')]));
          const kindAt = p => { let best = null, bestD = size * 3; for (const e of ctx.entities()) { const name = layerNames.get(e.layer) || ''; const k = /DOOR|문/i.test(name) ? 'D' : /GLAZ|WIN|창/i.test(name) ? 'W' : null; if (!k) continue; const b = G.bounds([e]); if (!b) continue; const d = Math.hypot(Math.max(b.minX - p.x, 0, p.x - b.maxX), Math.max(b.minY - p.y, 0, p.y - b.maxY)); if (d < bestD) { bestD = d; best = k; } } return best || 'W'; };
          let count = 0;
          for (;;) {
            if (count > 0 && ctx.scripted?.remainingPoints?.() === 0) break;
            const p = await ctx.pickPoint(`WSL · 창호기호를 놓을 점을 지정하세요 · Esc 종료${count ? ` · 지금까지 ${count}개` : ''}`);
            if (!p) break;
            const kind = kindAt(p), mark = marks[kind];
            const block = windowSymbolBlock(p, mark, { shape: values.shape, size, layer: layerId });
            ctx.commit({ entities: [block] });
            count++;
            marks[kind] = /\d+$/.test(mark) ? nextIncrementValue(mark.match(/\d+$/)[0]).replace(/^/, mark.replace(/\d+$/, '')) : mark;
            ctx.storage.setItem(storeKey[kind], marks[kind]);
          }
          if (count) ctx.toast(`WSL · 창호기호 ${count}개를 넣었습니다(경사창 자동 직각 정렬·사용자 속성블럭 등록은 없음) · Ctrl+Z 로 되돌리기`);
        } else if (values.mode === 'list') {
          const rows = openingSymbolCountsFromSelection(ctx.entities(), ctx.selected());
          if (!rows.length) return ctx.toast('WSL · 집계할 창호기호가 없습니다(넣기로 먼저 등록하세요).', true);
          const p = await ctx.pickPoint('WSL · 목록을 놓을 점을 지정하세요'); if (!p) return;
          const entities = rows.map(([mark, qty], i) => ({ type: 'text', layer: layerId, position: { x: p.x, y: p.y - i * 220 }, text: `${mark} : ${qty}개`, height: 150, align: 'left' }));
          ctx.commit({ entities });
          ctx.toast(`WSL · 창호기호 ${rows.length}종을 집계했습니다(갯수태그 합산 포함) · Ctrl+Z 로 되돌리기`);
        } else if (values.mode === 'locate') {
          const rv = await askForm('WSL · 위치파악', [{ name: 'mark', label: '찾을 기호 번호', value: '' }]);
          const mark = String(rv.mark || '').trim(); if (!mark) throw Error('기호 번호를 입력하세요.');
          const ids = ctx.entities().filter(e => e.type === 'block' && e.category === 'XI_WSL' && String(e.attributes?.mark) === mark).map(e => e.id);
          if (!ids.length) return ctx.toast('WSL · 그 번호의 기호가 없습니다.', true);
          ctx.setSelected(ids);
          ctx.toast(`WSL · "${mark}" 기호 ${ids.length}개를 화면에서 선택 표시했습니다.`);
        } else {
          const rv = await askForm('WSL · 기호변경', [
            { name: 'action', label: '변경방식', value: 'rename', options: [['rename', '이름'], ['number', '번호'], ['count', '갯수'], ['shift', '번호 밀기/당기기']] },
            { name: 'from', label: '변경 전 값', value: '' },
            { name: 'to', label: '변경 후 값', value: '' },
          ]);
          const from = String(rv.from || '').trim(), to = String(rv.to || '').trim();
          if (!from || !to) throw Error('변경 전/후 값을 입력하세요.');
          let plan = [];
          if (rv.action === 'rename' || rv.action === 'number') plan = renameMarkPlan(ctx.entities(), from, to);
          else if (rv.action === 'count') plan = countChangePlan(ctx.entities(), from, Number(to));
          else { const fromN = Number(from), toN = Number(to); if (!Number.isFinite(fromN) || !Number.isFinite(toN)) throw Error('번호 밀기/당기기는 숫자로 입력하세요.'); plan = shiftMarkPlan(ctx.entities(), fromN, toN - fromN); }
          if (!plan.length) return ctx.toast('WSL · 조건에 맞는 기호가 없습니다.', true);
          ctx.execute({ type: 'batch', commands: plan.map(c => ({ type: 'update', ids: [c.id], changes: { attributes: c.attributes } })) });
          ctx.refresh();
          ctx.toast(`WSL · 기호 ${plan.length}개를 변경했습니다 · Ctrl+Z 로 되돌리기`);
        }
      } catch (e) { console.error('[card]', e); ctx.toast(ctx.userErrorMessage(e), true); }
    })(); }, 0); });
  }

  /* ── BAK ── 2026-09-24: 안내만 하던 것을 실제 동작으로 바꿨다. 원문처럼 "현재 도면이름_년.월일.시분.bcad"
     새 파일로 내려받고, 작업 중인 도면의 저장 상태(dirty)나 이름은 건드리지 않는다(원문: 현재 파일은 그대로).
     도면 전체(시트·블록 정의 포함)는 app.js 가 공개하는 window.cad.getDocument() 로 읽는다. */
  /* 비평 10: Electron 에서는 설치본 저장 통로(cadDesktop.saveFile, 저장 위치를 묻는 창)로 저장하고, 실제로 저장됐을 때만
     "저장했습니다"라고 알린다(취소하면 취소 안내). 브라우저에서는 내려받기를 시작했다고만 알린다. */
  async function BAK() {
    // AI 연결 실행기(화면 없는 일꾼)에는 window.cad 가 없다 → 실행기가 주는 도면 사본으로 만들고, 파일은 화면이 이어서 내려받는다(2026-10-27 설명서 시험).
    const cad = globalThis.window?.cad;
    const doc = typeof cad?.getDocument === 'function' ? cad.getDocument() : ctx.documentSnapshot?.();
    if (!doc) throw Error('BAK · 도면 전체를 읽을 수 없는 화면입니다. 바른 CAD 본 화면에서 실행하세요.');
    let name = '도면';
    try { const tabs = cad.drawings?.list?.() || [], active = cad.drawings?.active?.(); name = tabs.find(t => t.id === active)?.name || name; } catch {}
    const base = safeFileName(String(name).replace(/\.(bcad|dxf|dwg)$/i, ''), '도면');
    const fileName = backupFileName(base);
    const json = JSON.stringify(doc, null, 2), desktop = globalThis.window?.cadDesktop;
    if (typeof desktop?.saveFile === 'function') {
      const result = await desktop.saveFile({ name: fileName, bytes: new TextEncoder().encode(json) });
      if (!result?.saved) return ctx.toast(`BAK · 백업 저장을 취소했습니다. 작업 중인 도면은 그대로입니다.`);
      return ctx.toast(`BAK · 백업본을 저장했습니다: ${result.path || fileName} (작업 중인 도면은 그대로입니다).`);
    }
    downloadText(fileName, json, 'application/json');
    ctx.toast(`BAK · 백업본 "${fileName}" 내려받기를 시작했습니다(작업 중인 도면은 그대로입니다).`);
  }

  /* ── PB ── */
  async function PB() {
    const path = await ctx.pickPath({ prompt: 'PB · 출력 박스의 대각 두 점을 지정하세요 · Esc 취소', minPoints: 2, maxPoints: 2 });
    if (!path) return;
    const box = cornersToBox(path.points[0], path.points[1]);
    if (box.maxX - box.minX < G.EPS || box.maxY - box.minY < G.EPS) throw Error('PB · 두 점이 만드는 박스의 폭과 높이가 0보다 커야 합니다.');
    const layerId = ctx.ensureLayer(STD_LAYERS.plot, '#ff9f68');
    /* plotBox 표식: PPP·SVS 가 켜 이름과 상관없이 PB 로 그린 출력 박스를 알아보게 한다(검토 P10). */
    ctx.commit({ entities: [{ type: 'rectangle', points: G.rectangle({ x: box.minX, y: box.minY }, { x: box.maxX, y: box.maxY }), layer: layerId, plotBox: true }] });
    ctx.toast('PB · 출력 박스를 그렸습니다(대화상자 없음, A-PLOT 켜 · PPP 자동출력·SVS 가 인식) · Ctrl+Z 로 되돌리기');
  }

  /* ── PUA ── */
  function PUA() {
    ctx.form('PUA · 모든 것 퍼지', [
      { name: 'emptyText', label: '내용없는 문자 삭제', value: 'yes', options: [['yes', '켬'], ['no', '끔']] },
      { name: 'points', label: '포인트 객체 삭제', value: 'yes', options: [['yes', '켬'], ['no', '끔']] },
      { name: 'blocks', label: '내용없는 블록 정의 삭제(BLOCKCLEAN)', value: 'yes', options: [['yes', '켬'], ['no', '끔']] },
      { name: 'layers', label: '사용하지 않는 켜 삭제', value: 'no', options: [['yes', '켬'], ['no', '끔']] },
    ], values => {
      const entities = ctx.entities();
      const removeIds = [...(yes(values.emptyText) ? emptyTextIds(entities) : []), ...(yes(values.points) ? pointEntityIds(entities) : [])];
      const commands = [];
      if (removeIds.length) commands.push({ type: 'delete', ids: removeIds });
      let layerCount = 0;
      if (yes(values.layers)) { const ids = unusedLayerIds(ctx.entities(), ctx.layers(), ctx.blocks?.() || [], [ctx.activeLayer?.()]); layerCount = ids.length; for (const id of ids) commands.push({ type: 'layer.delete', id }); }
      if (commands.length) ctx.execute({ type: 'batch', commands });
      if (yes(values.blocks)) ctx.run('BLOCKCLEAN');
      ctx.refresh();
      ctx.toast(`PUA · 문자·포인트 ${removeIds.length}개${layerCount ? `, 미사용 켜 ${layerCount}개` : ''} 정리${yes(values.blocks) ? ' · 블록 정리는 BLOCKCLEAN 실행' : ''} · 주석축척 초기화·DGN 선종류·Audit·문자/치수모양 기본화·설정 슬롯 저장은 바른 CAD에 해당 개념이 없어 만들지 않았습니다 · Ctrl+Z 로 되돌리기`);
    });
  }

  /* ── SVS ── */
  function SVS() {
    runAsync('SVS · 개별 파일로 도면 분리하기(도곽 자동 인식)', [
      { name: 'mode', label: '등록도곽사용 방식', value: 'layer', options: [['layer', '지정켜'], ['attr', '속성블럭'], ['cross', '일반블럭(크로싱)']] },
      { name: 'layerName', label: '켜 이름(지정켜)', value: STD_LAYERS.plot },
      { name: 'numberTag', label: '번호 태그(속성블럭)', value: 'NUMBER' },
      { name: 'nameTag', label: '이름 태그(속성블럭)', value: 'NAME' },
      { name: 'save', label: '분리 저장', value: 'mark', options: [['mark', '도곽 표시만(기본값)'], ['dxf', '도곽으로 등록하고 도곽마다 DXF 파일로 저장(SHEETDXF)']] },
    ], async values => {
      let candidates = [];
      if (values.mode === 'layer') {
        const wanted = String(values.layerName || '').trim();
        // 출력 박스 이름(A-PLOT · 옛 PLOT_BOX)이면 둘 중 도면에 있는 쪽을 쓴다.
        const layer = ctx.layers().find(l => l.name === wanted) || (isPlotBoxLayerName(wanted) ? ctx.layers().find(l => isPlotBoxLayerName(l.name)) : null);
        const boxes = plotBoxCandidates(ctx.entities(), layer?.id);
        if (!layer && !boxes.length) throw Error('그 이름의 켜가 없고 PB 로 그린 출력 박스도 없습니다: ' + values.layerName);
        const numbers = autoSheetNumbers(boxes.length);
        candidates = boxes.map((bounds, i) => ({ bounds, number: numbers[i], title: '' }));
      } else if (values.mode === 'attr') {
        candidates = attributeCandidates(ctx.entities(), values.nameTag, values.numberTag);
      } else {
        for (;;) {
          const anchor = await ctx.pickEntity({ prompt: `SVS · 도곽으로 쓸 블록(또는 사각형)을 선택하세요 · Esc 종료${candidates.length ? ` · 지금까지 ${candidates.length}개` : ''}` });
          if (!anchor) break;
          const cross = await ctx.pickPath({ prompt: 'SVS · 도면명·번호가 적힌 부분을 크로싱으로 감싸세요 · Esc 취소', minPoints: 2, maxPoints: 2 });
          if (!cross) continue;
          const box = cornersToBox(cross.points[0], cross.points[1]);
          const texts = textsInsideBox(ctx.entities(), box);
          const bounds = blockWorldBounds(anchor) || G.bounds([anchor]) || box;
          candidates.push({ bounds, number: autoSheetNumbers(1, 'A-', candidates.length + 1)[0], title: texts.join(' ') || '(이름 없음)' });
        }
      }
      if (!candidates.length) throw Error('인식된 도곽이 없습니다.');
      const cad = globalThis.window?.cad;
      if (values.save === 'dxf' && typeof cad?.getDocument !== 'function') throw Error('SVS · 도곽을 등록해 파일로 나누려면 바른 CAD 본 화면에서 실행하세요.');
      const boxLayer = ctx.ensureLayer(STD_LAYERS.plot, '#ff9f68'), labelLayer = ctx.ensureLayer('A-TITLE', '#7fd1e0');
      if (values.save === 'dxf') {
        /* 2026-10-06(봇 점검 "파일 분리 저장 불가"): PPP 와 같은 방식으로 찾은 도곽을 도면의 도곽(sheet)으로 등록하고(박스선은
           출력에서 빠지는 sheetDecoration) 기존 SHEETDXF(studio.js exportSheetDxfs · 도곽마다 잘라 DXF 저장)를 실행한다.
           등록과 박스·번호 표시는 한 번의 batch 라 Ctrl+Z 한 번에 취소된다. */
        const existing = cad.getDocument().sheets || [];
        const plan = svsSheetPlan(candidates, existing);
        const entities = candidates.flatMap((c, i) => [
          { type: 'rectangle', points: G.rectangle({ x: c.bounds.minX, y: c.bounds.minY }, { x: c.bounds.maxX, y: c.bounds.maxY }), layer: boxLayer, plotBox: true, sheetDecoration: true, sheetId: plan[i].id },
          { type: 'text', position: { x: c.bounds.minX, y: c.bounds.maxY + 150 }, text: plan[i].number + (c.title ? ' ' + c.title : ''), height: 150, align: 'left', layer: labelLayer },
        ]);
        ctx.execute({ type: 'batch', commands: [{ type: 'addMany', entities }, { type: 'document.update', changes: { sheets: [...existing, ...plan] } }] });
        ctx.refresh();
        ctx.toast(`SVS · 도곽 ${plan.length}개를 등록했습니다(${plan.slice(0, 3).map(s => s.number).join(', ')}${plan.length > 3 ? ' 외' : ''}) · 등록된 도곽 ${existing.length + plan.length}장을 번호별 DXF 파일로 저장합니다(파일 이름 = 도곽 번호) · Ctrl+Z 로 등록 취소`);
        ctx.run('SHEETDXF');
        return;
      }
      const entities = candidates.flatMap(c => [
        { type: 'rectangle', points: G.rectangle({ x: c.bounds.minX, y: c.bounds.minY }, { x: c.bounds.maxX, y: c.bounds.maxY }), layer: boxLayer },
        { type: 'text', position: { x: c.bounds.minX, y: c.bounds.maxY + 150 }, text: c.number + (c.title ? ' ' + c.title : ''), height: 150, align: 'left', layer: labelLayer },
      ]);
      ctx.commit({ entities });
      ctx.toast(`SVS · 도곽 후보 ${candidates.length}개를 찾아 출력 박스(A-PLOT) 사각형과 번호를 표시했습니다 · 도곽마다 DXF 파일로 나누려면 SVS 를 다시 실행해 "분리 저장"에서 DXF 저장을 고르세요 · Ctrl+Z 로 되돌리기`);
    });
  }

  /* ── SOL ── */
  function SOL() {
    runAsync('SOL · 솔리드 해치', [
      { name: 'mode', label: '경계 지정 방식', value: 'single', options: [['single', '단일 객체'], ['multi', '여러 객체'], ['point', '점 지정(포함 영역 찾기)']] },
      { name: 'separate', label: '개별 해치로 작성(HPSEPARATE)', value: 'yes', options: [['yes', '개별'], ['no', '하나로 묶기']] },
    ], async values => {
      const boundaries = [];
      if (values.mode === 'single') {
        const e = await ctx.pickEntity({ prompt: 'SOL · 해치할 닫힌 경계를 선택하세요', types: ['circle', 'polyline', 'rectangle'] });
        if (!e) return;
        if (e.type === 'polyline' && !e.closed) throw Error('닫힌 폴리선만 해치할 수 있습니다.');
        boundaries.push(e);
      } else if (values.mode === 'multi') {
        for (;;) {
          const e = await ctx.pickEntity({ prompt: `SOL · 해치할 경계를 선택하세요 · Esc 종료${boundaries.length ? ` · 지금까지 ${boundaries.length}개` : ''}`, types: ['circle', 'polyline', 'rectangle'] });
          if (!e) break;
          if (e.type === 'polyline' && !e.closed) { ctx.toast('열린 폴리선은 건너뜁니다.', true); continue; }
          boundaries.push(e);
        }
      } else {
        for (;;) {
          const p = await ctx.pickPoint(`SOL · 해치할 영역 안의 점을 지정하세요 · Esc 종료${boundaries.length ? ` · 지금까지 ${boundaries.length}개` : ''}`);
          if (!p) break;
          const found = entityContainingPoint(ctx.entities(), p);
          if (!found) { ctx.toast('그 점을 둘러싼 닫힌 경계를 찾지 못했습니다.', true); continue; }
          boundaries.push(found);
        }
      }
      if (!boundaries.length) return;
      // 0 레이어(현재 레이어)가 아니라 해치 레이어에(2026-10-27 설명서 시험).
      const layerId = ctx.ensureLayer('A-HATCH', '#6ec6ff');
      const hatches = boundaries.map(b => ({ type: 'hatch', layer: layerId, points: solidHatchBoundaryPoints(b), solid: true }));
      ctx.commit({ entities: hatches });
      if (!yes(values.separate) && hatches.length > 1) {
        ctx.toast(`SOL · 솔리드 해치 ${hatches.length}개를 만들었습니다 · "개별 해치로 작성"을 껐으므로 이어서 HATCHMERGE(HM)로 하나로 묶습니다.`);
        ctx.run('HATCHMERGE');
      } else {
        ctx.toast(`SOL · 솔리드 해치 ${hatches.length}개를 만들었습니다(표준 HATCH 명령의 솔리드 옵션과 같은 결과) · Ctrl+Z 로 되돌리기`);
      }
    });
  }

  /* ── LSC ── */
  async function LSC() {
    const targets = await collectEntities('LSC · 선종류축척을 바꿀 객체를 선택하세요');
    ctx.form('LSC · 선종류축척 변경', [
      { name: 'mode', label: '방식', value: 'absolute', options: [['absolute', '절대값'], ['multiply', '기존 값의 배수']] },
      { name: 'value', label: '값', type: 'number', value: 1 },
    ], values => {
      const changes = computeLinetypeScales(targets, values.mode, Number(values.value));
      ctx.execute({ type: 'batch', commands: changes.map(c => ({ type: 'update', ids: [c.id], changes: { linetypeScale: c.linetypeScale } })) });
      ctx.refresh();
      ctx.toast(`LSC · 객체 ${changes.length}개의 선종류축척을 바꿨습니다(도면 전체는 LTSCALE 로 조정하는 것이 좋다는 원문 권고 그대로) · Ctrl+Z 로 되돌리기`);
    });
  }

  /* ── COM ── */
  const COM_KEY = 'barun-com-shortcuts';
  function loadShortcuts() { try { return JSON.parse(ctx.storage.getItem(COM_KEY) || '{}'); } catch { return {}; } }
  function saveShortcuts(map) { try { ctx.storage.setItem(COM_KEY, JSON.stringify(map)); } catch {} }
  function COM() {
    ctx.form('COM · 명령어 단축키 수정(참고용 표)', [
      { name: 'action', label: '동작', value: 'set', options: [['set', '등록·수정'], ['find', '조회'], ['remove', '삭제']] },
      { name: 'shortcut', label: '단축키', value: '' },
      { name: 'command', label: '명령어(등록·수정일 때만)', value: '' },
    ], values => {
      const key = String(values.shortcut || '').trim().toUpperCase();
      if (!key) throw Error('단축키를 입력하세요.');
      const map = loadShortcuts();
      if (values.action === 'find') { const row = map[key]; ctx.toast(row ? `COM · ${key} → ${row.command}` : `COM · "${key}" 단축키가 없습니다.`); return; }
      if (values.action === 'remove') { if (!map[key]) throw Error('그 단축키가 없습니다.'); delete map[key]; saveShortcuts(map); ctx.toast(`COM · "${key}" 단축키를 삭제했습니다(참고표에서만, 실제 명령 실행에는 영향이 없습니다).`); return; }
      const command = String(values.command || '').trim().toUpperCase();
      if (!command) throw Error('명령어를 입력하세요.');
      const dup = findDuplicateShortcut(map, command, key);
      map[key] = { command }; saveShortcuts(map);
      ctx.toast(`COM · "${key}" → "${command}" 로 저장했습니다${dup ? ` · 주의: "${dup}" 단축키도 같은 명령을 씁니다(중복)` : ''} · 참고용 표일 뿐이며 pgp 파일 기록·다중 프로필 저장/불러오기·카테고리 트리·복구 기능은 바른 CAD 명령 파싱을 고쳐야 해서(공유 파일) 만들지 못했습니다.`);
    });
  }

  /* ── CT ── */
  async function CT() {
    const source = await ctx.pickEntity({ prompt: 'CT · 원본 객체를 선택하세요' });
    if (!source) return;
    ctx.form('CT · 객체 내용 복사', [
      { name: 'oneToOne', label: '적용 범위', value: 'one', options: [['one', '1:1(대상 하나)'], ['many', '1:다수(여러 대상에 반복)']] },
      { name: 'withLayer', label: '켜도 함께 복사', value: 'no', options: [['yes', '켬'], ['no', '끔']] },
      { name: 'withStyle', label: '색·선종류도 함께 복사', value: 'no', options: [['yes', '켬'], ['no', '끔']] },
    ], values => { setTimeout(() => { (async () => {
      try {
        const opt = { layer: yes(values.withLayer), style: yes(values.withStyle) };
        const oneToOne = values.oneToOne === 'one';
        let count = 0;
        for (;;) {
          const target = await ctx.pickEntity({ prompt: `CT · 적용할 대상 객체를 선택하세요 · Esc 종료${count ? ` · 지금까지 ${count}개` : ''}` });
          if (!target) break;
          if (target.id === source.id) continue;
          const changes = copyContentChanges(source, target, opt);
          if (Object.keys(changes).length) { ctx.execute({ type: 'update', ids: [target.id], changes }); count++; }
          else ctx.toast('원본과 종류가 달라 복사할 특성이 없습니다.', true);
          if (oneToOne && count) break;
        }
        ctx.refresh();
        ctx.toast(count ? `CT · 객체 ${count}개에 내용을 복사했습니다(문자내용·선길이·폴리선두께·반지름·블록종류) · Ctrl+Z 로 되돌리기` : 'CT · 복사한 객체가 없습니다.');
      } catch (e) { console.error('[card]', e); ctx.toast(ctx.userErrorMessage(e), true); }
    })(); }, 0); });
  }

  /* 비평 11: 오류 처리는 app.js runCardCommand(보고·되돌리기 묶음) 한 곳에서 한다 — 모듈 안의 두 번째 감싸기는 뺐다. */
  const guard = fn => fn;
  const commands = { CM, SSL, SCB, WSL, BAK, PB, PUA, SVS, SOL, LSC, COM, CT };
  return Object.fromEntries(Object.entries(commands).map(([name, fn]) => [name, guard(fn)]));
}
