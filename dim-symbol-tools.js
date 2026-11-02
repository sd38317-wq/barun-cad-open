// 3차 병렬 작업: 치수 5개(LSE TL DLA DTM DTO) + 기호 4개(CSL DDM ESS WU) + 도형 및 기호 3개(ATC R3 OTC)
// + 원문 게시글을 찾지 못한 4개(DH DU IL RS, 카탈로그 라벨만으로 추정 구현) = 16개.
// 근거: docs/izzarder-reference-20260921/references/13-dim.md(LSE/457 TL/456 DLA/400 DTM/458 DTO/598),
// 03-symbol.md(CSL/247 DDM/169 ESS/434 WU/374), 14-shape-line.md(ATC/509 R3/297 OTC/582).
// DH·DU·IL·RS 는 정리본·WebSearch(site:izzarder.com) 모두에서 원문 글을 찾지 못해(2차 검증 보고서와 동일 결론)
// reference-command-catalog.js 의 한 줄 설명만으로 추정 구현했다. 각 함수 위 주석에 "(추정)"으로 표시했다.
// 바른 CAD 의 dimension 객체는 {points:[a,b,p],mode,text,textTemplate,textPosition,extensionOffset,
// extensionOvershoot,textGap,arrowSize,precision,measurementScale,scale,textHeight}(engine.js·geometry.js
// dimensionParts 근거)이고 전용 LEADER 엔티티가 없다 — LEADER 명령(workflows.js:159)은 지시선을
// {type:'block',name:'지시선',entities:[line,polyline(화살표),text]} 로 만든다. 이 경계 안에서 실제
// 동작하는 것만 만들고, DimStyle 테이블처럼 없는 개념은 선택한 객체 자체를 직접 고치는 것으로 대신했다.
import * as G from './geometry.js';
import {dimensionPreview} from './dimension-preview.js';
import {STD_LAYERS} from './card-kit.js';
import {boundedInteger, boundedNumber, assertGeneratedCount} from './card-input.js';

// 반복 횟수 상한(검토 5.0.4 P2): 1e15 같은 값이 그대로 반복문에 들어가 렌더러가 멈추지 않게 한다.
export const CSL_MAX_COUNT = 100;
export const WU_MAX_ARROWS = 2000;

/* ══════════════════ 순수 함수(시험용, DOM 없이 동작) ══════════════════ */

/* ── LSE(/457) (다중)지시선 모양 변경 ──
   원문은 이름있는 DimStyle 자체를 고치지만, 바른 CAD 에는 DimStyle 이 없다. 선택한 지시선 블록
   (LEADER 명령이 만든 {line,head,text} 구성)을 직접 다시 그려 화살표모양·문자위치·크기를 바꾼다. */
export function restyleLeaderBlock(block, {shape = 'circle', textPos = 'side', arrowScale = 1} = {}) {
  const entities = block?.entities;
  if (!Array.isArray(entities)) throw Error('LSE · 지시선 블록이 아닙니다.');
  if (block.mleader) return restyleMultiLeader(block, {shape, arrowScale});
  const line = entities.find((e) => e.type === 'line');
  const text = entities.find((e) => e.type === 'text');
  const head = entities.find((e) => e !== line && e.type !== 'text');
  if (!line || !line.points || line.points.length < 2 || !text) throw Error('LSE · 지시선 블록 구조(선·문자)를 찾을 수 없습니다.');
  if (!(arrowScale > 0)) throw Error('LSE · 크기 배율은 양수여야 합니다.');
  const [a, b] = line.points, u = G.unit(G.sub(b, a)), n = G.normal(u);
  const th = text.height || 150, size = th * 0.8 * arrowScale, layer = head?.layer ?? line.layer;
  let headEntity;
  if (shape === 'circle') headEntity = {type: 'circle', center: {...a}, radius: Math.max(size * 0.35, G.EPS * 10), layer};
  else if (shape === 'arrow') headEntity = {type: 'polyline', closed: false, layer, points: [
    G.add(a, G.add(G.mul(u, size), G.mul(n, size * 0.3))), a, G.add(a, G.sub(G.mul(u, size), G.mul(n, size * 0.3))),
  ]};
  else if (shape === 'wave') headEntity = {type: 'polyline', closed: false, layer, points: [
    a, G.add(a, G.add(G.mul(u, size * 0.33), G.mul(n, size * 0.3))),
    G.add(a, G.add(G.mul(u, size * 0.66), G.mul(n, -size * 0.3))), G.add(a, G.mul(u, size)),
  ]};
  else throw Error('LSE · 알 수 없는 화살표모양입니다: ' + shape);
  const textPosition = textPos === 'above' ? G.add(b, {x: 0, y: th * 0.9}) : {...b};
  return {entities: [line, headEntity, {...text, position: textPosition}]};
}

/* 다중 지시선(MLEADER): 꺾임 경로(첫 폴리선)와 여러 줄 문자는 그대로 두고 화살표만 바꾼다. */
function restyleMultiLeader(block, {shape, arrowScale}) {
  const entities = block.entities;
  const path = entities.find((e) => e.type === 'polyline' && !e.closed && e.points?.length >= 2);
  const texts = entities.filter((e) => e.type === 'text');
  if (!path || !texts.length) throw Error('LSE · 다중 지시선 구조(경로·문자)를 찾을 수 없습니다.');
  if (!(arrowScale > 0)) throw Error('LSE · 크기 배율은 양수여야 합니다.');
  const [a, b] = path.points, u = G.unit(G.sub(b, a)), n = G.normal(u);
  const th = texts[0].height || 150, size = th * 0.8 * arrowScale, layer = path.layer;
  let head;
  if (shape === 'circle') head = {type: 'circle', center: {...a}, radius: Math.max(size * 0.35, G.EPS * 10), layer};
  else if (shape === 'arrow') head = {type: 'polyline', closed: false, layer, points: [G.add(a, G.add(G.mul(u, size), G.mul(n, size * 0.3))), a, G.add(a, G.sub(G.mul(u, size), G.mul(n, size * 0.3)))]};
  else if (shape === 'wave') head = {type: 'polyline', closed: false, layer, points: [a, G.add(a, G.add(G.mul(u, size * 0.33), G.mul(n, size * 0.3))), G.add(a, G.add(G.mul(u, size * 0.66), G.mul(n, -size * 0.3))), G.add(a, G.mul(u, size))]};
  else throw Error('LSE · 알 수 없는 화살표모양입니다: ' + shape);
  return {entities: [path, head, ...texts]};
}

/* ── TL(/456) 문자열에 지시선 넣기 ── 이미 배치된 문자(box)에서 지정한 점(target)으로 향하는
   지시선(선+화살표)만 새로 만든다(원문처럼 새 문자를 타이핑하지 않고 기존 문자에 "연결"한다). */
export function nearestPointOnBox(box, target) {
  if (!box || !Number.isFinite(box.minX)) throw Error('TL · 문자 경계를 알 수 없습니다.');
  return {x: Math.max(box.minX, Math.min(box.maxX, target.x)), y: Math.max(box.minY, Math.min(box.maxY, target.y))};
}
export function buildTextLeaderEntities(textBox, target, size) {
  if (!(size > 0)) throw Error('TL · 화살표 크기는 양수여야 합니다.');
  const tail = nearestPointOnBox(textBox, target);
  if (G.dist(tail, target) < G.EPS) throw Error('TL · 문자와 가리킬 지점이 같은 위치입니다.');
  const a = target, b = tail, u = G.unit(G.sub(b, a)), n = G.normal(u);
  return [
    {type: 'line', points: [a, b]},
    {type: 'polyline', closed: false, points: [
      G.add(a, G.add(G.mul(u, size), G.mul(n, size * 0.3))), a, G.add(a, G.sub(G.mul(u, size), G.mul(n, size * 0.3))),
    ]},
  ];
}

/* ── DLA(/400) 치수보조선 정렬 ── 그룹코드 13/14(연장선 시작점=dim.points[0,1])를 정렬 기준선
   위의 투영점으로 치환한다(치수선 위치 dim.points[2]는 그대로 둔다). DimLinear·DimAligned에만 적용. */
export function projectDimensionExtensionStarts(dim, refA, refB) {
  if (!dim || !['horizontal', 'vertical', 'aligned'].includes(dim.mode)) throw Error('DLA · 선형·정렬 치수만 지원합니다.');
  if (!Array.isArray(dim.points) || dim.points.length < 3) throw Error('DLA · 치수 정의점 오류입니다.');
  const dir = G.sub(refB, refA);
  if (G.len(dir) < G.EPS) throw Error('DLA · 기준선의 두 점이 같습니다.');
  const project = (p) => {const t = G.dot(G.sub(p, refA), dir) / G.dot(dir, dir); return G.add(refA, G.mul(dir, t));};
  return [project(dim.points[0]), project(dim.points[1]), dim.points[2]];
}

/* ── DTM(/458) 겹친 치수문자 이동 ── (1)단일: 클릭 위치를 치수 문자 폭의 4등분선으로 좌/우/아래로
   분류해 그 방향으로 옮긴다. (2)다중(M): 여러 치수 문자를 같은 축 위 좌표로 투영해 최소 간격을
   두고 밀어내는 1차원 겹침 해소(resolveLabelOverlaps)를 적용한다. 각도·좌표(ordinate) 치수는 제외. */
const DTM_UNSUPPORTED_MODES = ['angular', 'ordinateX', 'ordinateY'];
function dimAxis(dim) {
  const [a, b] = dim.points;
  return ['horizontal', 'vertical'].includes(dim.mode) ? G.polar(1, dim.axisAngle ?? (dim.mode === 'horizontal' ? 0 : 90)) : G.unit(G.sub(b, a));
}
function dimLabelPosition(dim) {
  const label = G.dimensionParts(dim).find((p) => p.dimensionLabel);
  if (!label) throw Error('치수 문자 위치를 계산할 수 없습니다.');
  return label.position;
}
export function classifyDimTextClick(dim, clickPoint) {
  if (DTM_UNSUPPORTED_MODES.includes(dim?.mode)) throw Error('DTM · 각도·좌표 치수는 지원하지 않습니다.');
  const u = dimAxis(dim), n = G.normal(u), rel = G.sub(clickPoint, dimLabelPosition(dim));
  const alongU = G.dot(rel, u), alongN = G.dot(rel, n);
  if (Math.abs(alongN) > Math.abs(alongU)) return 'down';
  return alongU < 0 ? 'left' : 'right';
}
export function moveDimensionTextDirection(dim, direction, distance) {
  if (DTM_UNSUPPORTED_MODES.includes(dim?.mode)) throw Error('DTM · 각도·좌표 치수는 지원하지 않습니다.');
  if (!(distance > 0)) throw Error('DTM · 이동 거리는 양수여야 합니다.');
  const u = dimAxis(dim), n = G.normal(u), pos = dimLabelPosition(dim);
  if (direction === 'left') return G.add(pos, G.mul(u, -distance));
  if (direction === 'right') return G.add(pos, G.mul(u, distance));
  if (direction === 'down') return G.add(pos, G.mul(n, -distance));
  throw Error('DTM · 알 수 없는 방향입니다: ' + direction);
}
export function resolveLabelOverlaps(positions, gap) {
  if (!(gap >= 0)) throw Error('DTM · 간격은 0 이상이어야 합니다.');
  const order = positions.map((value, index) => ({value, index})).sort((a, b) => a.value - b.value);
  for (let i = 1; i < order.length; i++) {
    const minAllowed = order[i - 1].value + gap;
    if (order[i].value < minAllowed) order[i].value = minAllowed;
  }
  const out = new Array(positions.length);
  for (const o of order) out[o.index] = o.value;
  return out;
}

/* ── DTO(/598) 치수 보조 설명글 넣기 ── 치수 측정값과 별개인 독립 문자(dimAux:치수id 로 연결)를
   치수 문자 아래에 추가한다. 기본(직접입력)/기존문자(E)/거리(D)/제거(R)/분리(S) 5모드. */
export function auxTextPosition(dim, offset) {
  const label = G.dimensionParts(dim).find((p) => p.dimensionLabel);
  if (!label) throw Error('DTO · 치수 문자 위치를 계산할 수 없습니다.');
  return G.add(label.position, {x: 0, y: -Math.abs(offset)});
}
export function formatAuxDistance(p1, p2, {precision = 0, suffix = ''} = {}) {
  const value = G.dist(p1, p2);
  return Number(value.toFixed(precision)).toString() + suffix;
}

/* ── CSL(/247) 절단면 기호 그리기 ── 두 점 사이 지그재그 절단선. count(여러개)만큼 내부에 균등
   간격으로 "Z" 꺾임을 넣고, extend 만큼 양끝을 더 그린다(복선·해치 옵션은 만들지 않음, 아래 한계 참고). */
export function buildCutSymbolPolyline(a, b, {symbolSize = 200, extend = 300, count = 1} = {}) {
  if (!(symbolSize > 0)) throw Error('CSL · 기호크기는 양수여야 합니다.');
  if (!(extend >= 0)) throw Error('CSL · 길이연장은 0 이상이어야 합니다.');
  const n = boundedInteger(Math.round(Number(count)), {min: 1, max: CSL_MAX_COUNT, label: 'CSL · 기호 개수'});
  const length = G.dist(a, b);
  if (length < G.EPS) throw Error('CSL · 두 점이 같습니다.');
  const u = G.unit(G.sub(b, a)), nrm = G.normal(u);
  const points = [G.sub(a, G.mul(u, extend))];
  for (let i = 1; i <= n; i++) {
    const c = G.add(a, G.mul(u, length * i / (n + 1)));
    const half = Math.min(symbolSize * 0.4, (length / (n + 1)) * 0.4);
    points.push(G.add(c, G.mul(u, -half)));
    points.push(G.add(G.add(c, G.mul(u, -half * 0.3)), G.mul(nrm, symbolSize * 0.5)));
    points.push(G.add(G.add(c, G.mul(u, half * 0.3)), G.mul(nrm, -symbolSize * 0.5)));
    points.push(G.add(c, G.mul(u, half)));
  }
  points.push(G.add(b, G.mul(u, extend)));
  return points;
}

/* ── DDM(/169) 다운표시 ── 클릭점이 경계선(a→b) 기준 어느 쪽인지 외적 부호로 판정한다(원문: 수평선
   위쪽/수직선 왼쪽=UP, 그 반대=DOWN — 외적 부호 하나로 두 경우 모두 맞는 것을 좌표로 확인했다). */
export function downMarkSide(lineA, lineB, clickPoint) {
  const dir = G.sub(lineB, lineA);
  if (G.len(dir) < G.EPS) throw Error('DDM · 기준선의 두 점이 같습니다.');
  return G.cross(dir, G.sub(clickPoint, lineA)) > 0 ? 'up' : 'down';
}
export function buildDownMarkEntities(lineA, lineB, side, {length = 500, label = 'FL ±0', textHeight = 150} = {}) {
  if (!(length > 0)) throw Error('DDM · 길이는 양수여야 합니다.');
  if (!(textHeight > 0)) throw Error('DDM · 문자높이는 양수여야 합니다.');
  const mid = G.mul(G.add(lineA, lineB), 0.5), u = G.unit(G.sub(lineB, lineA)), n = G.normal(u), sign = side === 'up' ? 1 : -1;
  const tip = G.add(mid, G.mul(n, sign * length));
  const baseL = G.add(mid, G.mul(u, -length * 0.3)), baseR = G.add(mid, G.mul(u, length * 0.3));
  return {
    triangle: {type: 'polyline', closed: true, points: [baseL, baseR, tip]},
    text: {type: 'text', position: G.add(tip, G.mul(n, sign * textHeight * 0.5)), text: label, height: textHeight, rotation: 0, align: 'center'},
  };
}

/* ── ESS(/434) 전개도 방향표시 ── 삽입점→방향점 두 클릭으로 원+화살표+문자를 그리고, 접두어+증가어
   +접미어 문자를 매번 자동 증가시킨다(숫자면 +1, 알파벳 한 글자면 다음 글자). */
export function nextIncrementValue(value) {
  const s = String(value);
  if (/^-?\d+$/.test(s)) return String(Number(s) + 1);
  if (/^[A-Za-z]$/.test(s)) return String.fromCharCode(s.charCodeAt(0) + 1);
  throw Error('ESS · 증가어는 숫자 또는 알파벳 한 글자여야 합니다: ' + value);
}
export function buildDirectionSymbolEntities(center, dirPoint, label, {radius = 300, textHeight = 200} = {}) {
  if (!(radius > 0)) throw Error('ESS · 반지름은 양수여야 합니다.');
  const dir = G.sub(dirPoint, center);
  if (G.len(dir) < G.EPS) throw Error('ESS · 중심과 방향점이 같습니다.');
  const u = G.unit(dir), n = G.normal(u), edge = G.add(center, G.mul(u, radius)), tip = G.add(center, G.mul(u, radius * 1.6));
  return {
    circle: {type: 'circle', center: {...center}, radius},
    arrow: {type: 'polyline', closed: true, points: [tip, G.add(edge, G.mul(n, radius * 0.35)), G.add(edge, G.mul(n, -radius * 0.35))]},
    text: {type: 'text', position: {...center}, text: label, height: textHeight, rotation: 0, align: 'center'},
  };
}

/* ── WU(/374) 우오수라인 그리기 ── 바른 CAD 는 전용 .lin 이 없다(CONTINUOUS/CENTER/PHANTOM/DOT/DASHED/
   HIDDEN 5종 고정, symbol-tools.js 확인). "화살표+간격 반복"을 DASHED 선 + 경로 위 등간격 화살표
   폴리선으로 근사한다(우수/오수 구분은 원문 제작방법 그대로 레이어·색상으로 나눈다). */
export function flowArrowPlacements(points, {spacing = 1000, size = 150} = {}) {
  if (!(spacing > 0)) throw Error('WU · 화살표 간격은 양수여야 합니다.');
  if (!(size > 0)) throw Error('WU · 화살표 크기는 양수여야 합니다.');
  if (!Array.isArray(points) || points.length < 2) throw Error('WU · 점이 2개 이상 필요합니다.');
  const segs = points.slice(1).map((p, i) => ({a: points[i], b: p, len: G.dist(points[i], p)}));
  const total = segs.reduce((s, seg) => s + seg.len, 0);
  if (total < G.EPS) throw Error('WU · 경로 길이가 0입니다.');
  assertGeneratedCount(Math.ceil(total / spacing), 'WU · 화살표 수', WU_MAX_ARROWS);
  const marks = [];
  for (let d = spacing / 2; d < total; d += spacing) {
    let rem = d, seg = segs[segs.length - 1];
    for (const s of segs) {if (rem <= s.len || s === segs[segs.length - 1]) {seg = s; break;} rem -= s.len;}
    const t = seg.len < G.EPS ? 0 : Math.min(1, Math.max(0, rem / seg.len));
    const point = G.add(seg.a, G.mul(G.sub(seg.b, seg.a), t));
    const u = G.unit(G.sub(seg.b, seg.a)), n = G.normal(u);
    const tip = G.add(point, G.mul(u, size * 0.5)), back = G.sub(point, G.mul(u, size * 0.5));
    marks.push({type: 'polyline', closed: true, points: [tip, G.add(back, G.mul(n, size * 0.3)), G.sub(back, G.mul(n, size * 0.3))]});
  }
  return marks;
}

/* ── ATC(/509) 호를 선택해서 원그리기 ── 같은 중심·반지름의 원으로 치환(호는 삭제). ── */
export function arcToCircleEntity(arc) {
  if (!arc || arc.type !== 'arc') throw Error('ATC · 호를 선택하세요.');
  if (!arc.center || !(arc.radius > 0)) throw Error('ATC · 호의 중심 또는 반지름이 올바르지 않습니다.');
  return {type: 'circle', center: {...arc.center}, radius: arc.radius};
}

/* ── R3(/297) 3점으로 사각형 그리기 ── 첫 두 점이 한 변(방향·길이), 세 번째 점까지의 수직거리가
   반대 변 폭. 결과는 회전된(임의 방향) 4점 사각형(engine 은 rectangle 타입에 임의 4점을 허용한다 —
   geometry.js stretchEntities 가 편집 시에만 polyline 으로 바꾼다, 그리기 자체는 제약 없음). */
export function rectangleFrom3Points(p1, p2, p3) {
  if (G.dist(p1, p2) < G.EPS) throw Error('R3 · 첫째·둘째 점이 같아 변의 방향을 알 수 없습니다.');
  const u = G.unit(G.sub(p2, p1)), n = G.normal(u);
  const width = G.dot(G.sub(p3, p1), n);
  if (Math.abs(width) < G.EPS) throw Error('R3 · 셋째 점이 첫 변 위에 있어 폭이 0입니다.');
  return [p1, p2, G.add(p2, G.mul(n, width)), G.add(p1, G.mul(n, width))];
}

/* ── OTC(/582) 객체 접원 그리기 ── 원문은 2개 선·원 포함 등 넓게 지원하나, 접선 조건 방정식이
   유일해로 풀리는 것은 "선분 3개가 이루는 삼각형" 경우뿐이라 이 경우만 구현한다(내접원 공식:
   세 변의 길이를 가중치로 한 꼭짓점의 가중평균 = 내심, 넓이/반둘레 = 반지름). */
export function incircleOfThreeLines(l1, l2, l3) {
  const A = G.lineIntersection(l1.a, l1.b, l2.a, l2.b);
  const B = G.lineIntersection(l2.a, l2.b, l3.a, l3.b);
  const C = G.lineIntersection(l3.a, l3.b, l1.a, l1.b);
  if (!A || !B || !C) throw Error('OTC · 세 선이 삼각형을 이루지 않습니다(평행선 포함).');
  const a = G.dist(B.point, C.point), b = G.dist(A.point, C.point), c = G.dist(A.point, B.point);
  const perimeter = a + b + c;
  if (perimeter < G.EPS) throw Error('OTC · 세 선이 한 점에서 만납니다.');
  const center = {x: (a * A.point.x + b * B.point.x + c * C.point.x) / perimeter, y: (a * A.point.y + b * B.point.y + c * C.point.y) / perimeter};
  const area = Math.abs(G.cross(G.sub(B.point, A.point), G.sub(C.point, A.point))) / 2;
  if (area < G.EPS) throw Error('OTC · 세 선이 한 직선 위에 있습니다.');
  return {center, radius: area / (perimeter / 2)};
}

/* ── DH(추정, 카탈로그 라벨만·원문 미발견) 치수문자 원위치시키기 ── textPosition(그룹코드 11 상당)
   을 지워 dimensionParts 가 다시 기본 위치를 계산하게 한다("원위치"의 가장 직접적인 해석).
   2026-09-24: null 을 넣으면 engine.js 검증(textPosition!==undefined && !point)에 걸려 항상 실패했다.
   update 는 Object.assign 이라 undefined 를 넣으면 "지정 안 함"이 되고 저장 시에도 키가 빠진다. */
export function restoreDimensionTextPosition(dim) {
  if (!dim || dim.type !== 'dimension') throw Error('DH · 치수를 선택하세요.');
  if (dim.textPosition == null) throw Error('DH · 이미 기본 위치인 치수입니다.');
  return {textPosition: undefined};
}

/* ── DU(추정, 카탈로그 라벨만·원문 미발견) 치수 업데이트 ── 바른 CAD 엔 DIMSTYLE 테이블이 없어
   "현재 설정값"을 대화상자에서 입력받아 선택한 치수들에 일괄 적용/재정의 문자를 지우는 것으로
   "최신 스타일로 갱신"을 대신한다. */
export function refreshDimensionStyle(dim, defaults = {}) {
  if (!dim || dim.type !== 'dimension') throw Error('DU · 치수를 선택하세요.');
  const changes = {text: '', textTemplate: '', textPosition: undefined};
  for (const key of ['textHeight', 'extensionOffset', 'extensionOvershoot', 'textGap', 'arrowSize', 'precision', 'scale'])
    if (defaults[key] !== undefined) changes[key] = defaults[key];
  return changes;
}

/* ── IL(추정, 카탈로그 라벨만·원문 미발견) 교차점을 찾아 길이 넣어 주기 ── 기준선(cutA-cutB)과
   대상 선 둘의 교차점을 각각 구해 그 사이 거리를 정렬(aligned) 치수로 넣는다("교차점을 찾아"
   "길이(치수)를 넣어준다"는 라벨을 가장 직접적으로 만족하는 해석). */
export function intersectionDimensionPoints(cutA, cutB, lineA, lineB) {
  const h1 = G.lineIntersection(cutA, cutB, lineA.a, lineA.b);
  const h2 = G.lineIntersection(cutA, cutB, lineB.a, lineB.b);
  if (!h1 || !h2) throw Error('IL · 기준선이 대상 선과 평행해 교차점을 찾을 수 없습니다.');
  if (G.dist(h1.point, h2.point) < G.EPS) throw Error('IL · 두 교차점이 같은 위치입니다.');
  return {p1: h1.point, p2: h2.point, length: G.dist(h1.point, h2.point)};
}

/* ── RS(추정, 카탈로그 라벨만·원문 미발견) 사각형 솔리드 박스 그리기 ── "솔리드 박스"를 사각형
   외곽선 + 같은 4점의 solid:true 해치(채움)로 해석한다. ── */
export function buildSolidBoxEntities(a, b) {
  const points = G.rectangle(a, b);
  if (Math.abs(points[0].x - points[2].x) < G.EPS || Math.abs(points[0].y - points[2].y) < G.EPS) throw Error('RS · 폭과 높이가 0보다 커야 합니다.');
  return {
    outline: {type: 'polyline', closed: true, points},
    fill: {type: 'hatch', points, solid: true},
  };
}

/* ══════════════════ 화면 명령(install 안에서만 pick/dialog 를 쓴다) ══════════════════ */

export function installDimSymbolTools(ctx) {
  const guard = (fn) => (...args) => {
    try {
      const r = fn(...args);
      // 약속을 돌려준다: AI 연결 실행기가 끝날 때까지 기다려야 뒤 입력(IL 치수선 위치 등)을 쓴다(2026-10-27 설명서 시험).
      if (r && typeof r.catch === 'function') return r.catch((e) => {console.error('[card]', e); ctx.toast(ctx.userErrorMessage(e), true);});
      return r;
    } catch (e) {
      console.error('[card]', e);
      ctx.toast(ctx.userErrorMessage(e), true);
    }
  };
  const th = () => ctx.num('text-height', 150);
  const symbLayer = () => ctx.ensureLayer(STD_LAYERS.symb, '#ff9f68');
  const textLayer = () => ctx.ensureLayer(STD_LAYERS.text, '#ffffff');
  const selectedDims = (cmd) => {
    const dims = ctx.selected().filter((e) => e.type === 'dimension');
    if (!dims.length) throw Error(cmd + ' · 치수를 먼저 선택하세요.');
    return dims;
  };

  function lse() {
    const blocks = ctx.selected().filter((e) => e.type === 'block' && e.name === '지시선');
    if (!blocks.length) throw Error('LSE · 지시선(LEADER 로 만든 블록)을 먼저 선택하세요.');
    ctx.form('LSE · (다중)지시선 모양 변경', [
      {name: 'shape', label: '화살표모양', value: 'circle', options: [['circle', '원형'], ['arrow', '화살표'], ['wave', '파형']]},
      {name: 'textPos', label: '문자위치', value: 'side', options: [['side', '옆'], ['above', '위']]},
      {name: 'scale', label: '크기 배율', type: 'number', value: 1},
    ], (values) => {
      const scale = Number(values.scale);
      const commands = blocks.map((block) => ({type: 'update', ids: [block.id], changes: restyleLeaderBlock(block, {shape: values.shape, textPos: values.textPos, arrowScale: scale})}));
      ctx.execute({type: 'batch', commands});
      ctx.toast(`LSE · 지시선 ${blocks.length}개의 모양을 바꿨습니다(DimStyle 이 없어 블록 자체를 직접 고칩니다).`);
    });
  }

  async function tl() {
    const target = await ctx.pickEntity({prompt: 'TL · 지시선을 연결할 문자(TEXT)를 선택하세요 · Esc 취소', types: ['text']});
    if (!target) return;
    const point = await ctx.pickPoint({prompt: 'TL · 가리킬 지점을 지정하세요', preview: dimensionPreview((cursor) => buildTextLeaderEntities(G.bounds([target]), cursor, th() * 0.8).map(e => ({...e, layer: target.layer})))});
    if (!point) return;
    const box = G.bounds([target]);
    const entities = buildTextLeaderEntities(box, point, th() * 0.8).map((e) => ({...e, layer: symbLayer()}));
    ctx.commit({entities});
    ctx.toast('TL · 문자에 지시선을 연결했습니다.');
  }

  function dla() {
    const dims = selectedDims('DLA').filter((d) => ['horizontal', 'vertical', 'aligned'].includes(d.mode));
    if (!dims.length) throw Error('DLA · 선형·정렬 치수를 먼저 선택하세요.');
    setTimeout(() => {(async () => {
      try {
        const refA = await ctx.pickPoint('DLA · 정렬 기준선의 첫 점을 지정하세요');
        if (!refA) return;
        const refB = await ctx.pickPoint({prompt: 'DLA · 정렬 기준선의 둘째 점을 지정하세요', preview: dimensionPreview((cursor) => dims.map(dim => ({...dim, points: projectDimensionExtensionStarts(dim, refA, cursor)})))});
        if (!refB) return;
        const commands = dims.map((dim) => ({type: 'update', ids: [dim.id], changes: {points: projectDimensionExtensionStarts(dim, refA, refB)}}));
        ctx.execute({type: 'batch', commands});
        ctx.toast(`DLA · 치수 ${commands.length}개의 보조선을 기준선에 정렬했습니다.`);
      } catch (e) {console.error('[card]', e); ctx.toast(ctx.userErrorMessage(e), true);}
    })();}, 0);
  }

  function dtm() {
    const dims = selectedDims('DTM').filter((d) => !DTM_UNSUPPORTED_MODES.includes(d.mode));
    if (!dims.length) throw Error('DTM · 각도·좌표 치수가 아닌 치수를 먼저 선택하세요.');
    ctx.form('DTM · 겹친 치수문자 이동', [
      {name: 'mode', label: '모드', value: dims.length > 1 ? 'multi' : 'single', options: [['single', '단일: 방향 클릭'], ['multi', '다중(M): 자동 겹침 해소']]},
      {name: 'distance', label: '단일 이동거리 mm', type: 'number', value: 300},
      {name: 'gap', label: '다중 최소 간격 mm', type: 'number', value: 400},
    ], (values) => {
      if (values.mode === 'single') {
        if (dims.length !== 1) throw Error('DTM · 단일 모드는 치수를 1개만 선택하세요.');
        setTimeout(() => {(async () => {
          try {
            const click = await ctx.pickPoint({prompt: 'DTM · 옮길 방향(왼쪽/오른쪽/아래) 쪽을 클릭하세요', preview: dimensionPreview((cursor) => { const dim = dims[0], direction = classifyDimTextClick(dim, cursor); return [{...dim, textPosition: moveDimensionTextDirection(dim, direction, Number(values.distance))}]; })});
            if (!click) return;
            const dim = dims[0], direction = classifyDimTextClick(dim, click);
            ctx.execute({type: 'update', ids: [dim.id], changes: {textPosition: moveDimensionTextDirection(dim, direction, Number(values.distance))}});
            ctx.toast(`DTM · 치수 문자를 ${{left: '왼쪽', right: '오른쪽', down: '아래'}[direction]}으로 옮겼습니다.`);
          } catch (e) {console.error('[card]', e); ctx.toast(ctx.userErrorMessage(e), true);}
        })();}, 0);
        return;
      }
      if (dims.length < 2) throw Error('DTM · 다중 모드는 치수를 2개 이상 선택하세요.');
      const first = dims[0], u = dimAxis(first);
      for (const dim of dims) if (dim.mode !== first.mode) throw Error('DTM · 다중 모드는 같은 방향(모드)의 치수만 선택하세요.');
      const positions = dims.map((dim) => dimLabelPosition(dim));
      const scalars = positions.map((p) => G.dot(p, u));
      const resolved = resolveLabelOverlaps(scalars, Number(values.gap));
      const commands = dims.map((dim, i) => ({type: 'update', ids: [dim.id], changes: {textPosition: G.add(positions[i], G.mul(u, resolved[i] - scalars[i]))}}));
      ctx.execute({type: 'batch', commands});
      ctx.toast(`DTM · 치수 ${dims.length}개를 겹치지 않게 재배치했습니다.`);
    });
  }

  function dto() {
    const dims = selectedDims('DTO');
    ctx.form('DTO · 치수 보조 설명글 넣기', [
      {name: 'mode', label: '모드', value: 'text', options: [['text', '기본: 직접 입력'], ['existing', '기존 문자(E) 사용'], ['distance', '거리(D) 자동 측정'], ['remove', '제거(R)'], ['detach', '분리(S): 독립 문자로']]},
      {name: 'value', label: '문자 내용(기본 모드)', value: ''},
      {name: 'offset', label: '치수 아래 간격 mm', type: 'number', value: 200},
    ], (values) => {
      if (values.mode === 'remove') {
        const ids = ctx.entities().filter((e) => dims.some((d) => d.id === e.dimAux)).map((e) => e.id);
        if (!ids.length) throw Error('DTO · 제거할 보조글이 없습니다.');
        ctx.execute({type: 'delete', ids});
        ctx.toast(`DTO · 보조글 ${ids.length}개를 지웠습니다.`);
        return;
      }
      if (values.mode === 'detach') {
        const commands = ctx.entities().filter((e) => dims.some((d) => d.id === e.dimAux)).map((e) => ({type: 'update', ids: [e.id], changes: {dimAux: null}}));
        if (!commands.length) throw Error('DTO · 분리할 보조글이 없습니다.');
        ctx.execute({type: 'batch', commands});
        ctx.toast(`DTO · 보조글 ${commands.length}개를 독립 문자로 분리했습니다.`);
        return;
      }
      setTimeout(() => {(async () => {
        try {
          let content = values.value;
          if (values.mode === 'existing') {
            const src = await ctx.pickEntity({prompt: 'DTO · 내용을 가져올 문자를 선택하세요 · Esc 취소', types: ['text']});
            if (!src) return;
            content = src.text;
          } else if (values.mode === 'distance') {
            const p1 = await ctx.pickPoint('DTO · 거리를 잴 첫 점을 지정하세요');
            if (!p1) return;
            const p2 = await ctx.pickPoint({prompt:'DTO · 거리를 잴 둘째 점을 지정하세요',preview:dimensionPreview(cursor=>dims.map(dim=>({type:'text',position:auxTextPosition(dim,Number(values.offset)),text:formatAuxDistance(p1,cursor),height:th(),rotation:0,align:'center',dimAux:dim.id,layer:dim.layer})))});
            if (!p2) return;
            content = formatAuxDistance(p1, p2);
          }
          if (!content) throw Error('DTO · 넣을 문자 내용이 없습니다.');
          const layer = textLayer();
          const entities = dims.map((dim) => ({type: 'text', position: auxTextPosition(dim, Number(values.offset)), text: content, height: th(), rotation: 0, align: 'center', dimAux: dim.id, layer}));
          ctx.commit({entities});
          ctx.toast(`DTO · 치수 ${dims.length}개에 보조글을 넣었습니다.`);
        } catch (e) {console.error('[card]', e); ctx.toast(ctx.userErrorMessage(e), true);}
      })();}, 0);
    });
  }

  function csl() {
    ctx.form('CSL · 절단면 기호', [
      {name: 'symbolSize', label: '기호크기 mm', type: 'number', value: 200},
      {name: 'extend', label: '길이연장 mm', type: 'number', value: 300},
      {name: 'count', label: '기호 개수(여러개)', type: 'number', value: 1},
    ], (values) => {
      const options = {
        symbolSize: boundedNumber(values.symbolSize, {min: 0, max: 1e6, exclusiveMin: true, label: 'CSL · 기호크기(mm)'}),
        extend: boundedNumber(values.extend, {min: 0, max: 1e6, label: 'CSL · 길이연장(mm)'}),
        count: boundedInteger(values.count, {min: 1, max: CSL_MAX_COUNT, label: 'CSL · 기호 개수'}),
      };
      setTimeout(() => {(async () => {
        try {
          const a = await ctx.pickPoint('CSL · 절단선 시작점을 지정하세요');
          if (!a) return;
          const b = await ctx.pickPoint('CSL · 절단선 끝점을 지정하세요');
          if (!b) return;
          const points = buildCutSymbolPolyline(a, b, options);
          ctx.commit({entities: [{type: 'polyline', closed: false, points, layer: symbLayer()}]});
          ctx.toast('CSL · 절단면 기호를 그렸습니다.');
        } catch (e) {console.error('[card]', e); ctx.toast(ctx.userErrorMessage(e), true);}
      })();}, 0);
    });
  }

  function ddm() {
    ctx.form('DDM · 다운표시', [
      {name: 'length', label: '길이 mm', type: 'number', value: 500},
      {name: 'text', label: '문자(±앞은 접두어로 자동인식)', value: 'FL ±0'},
      {name: 'textHeight', label: '문자높이 mm', type: 'number', value: 150},
    ], (values) => {
      setTimeout(() => {(async () => {
        try {
          const line = await ctx.pickEntity({prompt: 'DDM · 경계선을 선택하세요 · Esc 취소', types: ['line']});
          if (!line) return;
          const click = await ctx.pickPoint('DDM · UP/DOWN 방향 쪽을 클릭하세요');
          if (!click) return;
          const [a, b] = line.points, side = downMarkSide(a, b, click);
          const {triangle, text} = buildDownMarkEntities(a, b, side, {length: Number(values.length), label: values.text, textHeight: Number(values.textHeight)});
          ctx.commit({entities: [{...triangle, layer: symbLayer()}, {...text, layer: textLayer()}]});
          ctx.toast(`DDM · ${side === 'up' ? 'UP' : 'DOWN'} 표시를 그렸습니다.`);
        } catch (e) {console.error('[card]', e); ctx.toast(ctx.userErrorMessage(e), true);}
      })();}, 0);
    });
  }

  function ess() {
    ctx.form('ESS · 전개도 방향표시', [
      {name: 'prefix', label: '접두어', value: ''},
      {name: 'start', label: '시작 증가값(숫자 또는 알파벳 1글자)', value: '1'},
      {name: 'suffix', label: '접미어', value: ''},
      {name: 'radius', label: '반지름 mm', type: 'number', value: 300},
      {name: 'textHeight', label: '문자크기 mm', type: 'number', value: 200},
    ], (values) => {
      setTimeout(() => {(async () => {
        try {
          let current = values.start, count = 0;
          const layer = symbLayer();
          for (;;) {
            const center = await ctx.pickPoint(`ESS · 삽입점을 지정하세요(지금까지 ${count}개) · Esc 종료`);
            if (!center) break;
            const dirPoint = await ctx.pickPoint('ESS · 화살표 방향 쪽 점을 지정하세요 · Esc 종료');
            if (!dirPoint) break;
            const label = values.prefix + current + values.suffix;
            const {circle, arrow, text} = buildDirectionSymbolEntities(center, dirPoint, label, {radius: Number(values.radius), textHeight: Number(values.textHeight)});
            ctx.commit({entities: [{...circle, layer}, {...arrow, layer}, {...text, layer}]});
            count++;
            current = nextIncrementValue(current);
          }
          ctx.toast(count ? `ESS · 방향표시 ${count}개를 그렸습니다.` : 'ESS · 그린 기호가 없습니다.');
        } catch (e) {console.error('[card]', e); ctx.toast(ctx.userErrorMessage(e), true);}
      })();}, 0);
    });
  }

  function wu() {
    ctx.form('WU · 우오수라인 그리기', [
      {name: 'kind', label: '종류', value: 'rain', options: [['rain', '우수'], ['sewage', '오수']]},
      {name: 'spacing', label: '화살표 간격 mm', type: 'number', value: 1000},
      {name: 'size', label: '화살표 크기 mm', type: 'number', value: 150},
    ], (values) => {
      boundedNumber(values.spacing, {min: 0, max: 1e6, exclusiveMin: true, label: 'WU · 화살표 간격(mm)'});
      boundedNumber(values.size, {min: 0, max: 1e5, exclusiveMin: true, label: 'WU · 화살표 크기(mm)'});
      setTimeout(() => {(async () => {
        try {
          const path = await ctx.pickPath({prompt: 'WU · 배관 경로를 순서대로 지정 · Enter 완료 · Esc 취소', minPoints: 2, maxPoints: 0});
          if (!path) return;
          const marks = flowArrowPlacements(path.points, {spacing: Number(values.spacing), size: Number(values.size)});
          const rain = values.kind === 'rain';
          const layer = ctx.ensureLayer(rain ? 'A-SITE-ROAD' : 'A-SITE', rain ? '#6ec6ff' : '#c88b4a');
          ctx.commit({entities: [
            {type: 'polyline', closed: false, points: path.points, linetype: 'DASHED', layer},
            ...marks.map((m) => ({...m, layer})),
          ]});
          ctx.toast(`WU · ${rain ? '우수' : '오수'}라인을 그렸습니다(전용 선모양 대신 DASHED+화살표로 근사).`);
        } catch (e) {console.error('[card]', e); ctx.toast(ctx.userErrorMessage(e), true);}
      })();}, 0);
    });
  }

  async function atc() {
    const arc = await ctx.pickEntity({prompt: 'ATC · 원으로 바꿀 호를 선택하세요 · Esc 취소', types: ['arc']});
    if (!arc) return;
    ctx.commit({removeIds: [arc.id], entities: [{...arcToCircleEntity(arc), layer: arc.layer, color: arc.color}]});
    ctx.toast('ATC · 호를 같은 중심·반지름의 원으로 바꿨습니다.');
  }

  async function r3() {
    const p1 = await ctx.pickPoint('R3 · 첫 번째 점을 지정하세요');
    if (!p1) return;
    const p2 = await ctx.pickPoint('R3 · 둘째 점(첫 변의 길이·방향)을 지정하세요');
    if (!p2) return;
    const p3 = await ctx.pickPoint('R3 · 셋째 점(반대쪽 변까지 거리)을 지정하세요');
    if (!p3) return;
    ctx.commit({entities: [{type: 'rectangle', points: rectangleFrom3Points(p1, p2, p3)}]}); // 일반 도형: 현재 레이어(벽 레이어 강제하지 않음)
    ctx.toast('R3 · 3점으로 사각형을 그렸습니다.');
  }

  async function otc() {
    const lines = [];
    for (;;) {
      const e = await ctx.pickEntity({prompt: `OTC · 접하게 할 선을 선택하세요(${lines.length}/3, 선분 3개로 이루는 삼각형만 지원) · Esc 종료`, types: ['line']});
      if (!e) break;
      lines.push(e);
      if (lines.length === 3) break;
    }
    if (lines.length < 3) {ctx.toast('OTC · 취소했습니다(선분 3개가 필요합니다).'); return;}
    const {center, radius} = incircleOfThreeLines(
      {a: lines[0].points[0], b: lines[0].points[1]},
      {a: lines[1].points[0], b: lines[1].points[1]},
      {a: lines[2].points[0], b: lines[2].points[1]},
    );
    ctx.commit({entities: [{type: 'circle', center, radius, layer: symbLayer()}]});
    ctx.toast('OTC · 세 선분에 접하는 원을 그렸습니다(원문의 2선·원 포함 케이스는 지원하지 않습니다).');
  }

  function dh() {
    const dims = selectedDims('DH');
    const commands = [];
    let skipped = 0;
    for (const dim of dims) {
      try {commands.push({type: 'update', ids: [dim.id], changes: restoreDimensionTextPosition(dim)});}
      catch {skipped++;}
    }
    if (!commands.length) throw Error('DH · 선택한 치수가 모두 이미 기본 위치입니다.');
    ctx.execute({type: 'batch', commands});
    ctx.toast(`DH(추정: 원문 미발견) · 치수 문자 ${commands.length}개를 기본 위치로 되돌렸습니다.${skipped ? ` (${skipped}개 제외)` : ''}`);
  }

  function du() {
    const dims = selectedDims('DU');
    ctx.form('DU(추정: 원문 미발견) · 치수 업데이트', [
      {name: 'textHeight', label: '문자높이 mm', type: 'number', value: th()},
      {name: 'extensionOffset', label: '보조선 시작 간격 mm', type: 'number', value: 0},
      {name: 'extensionOvershoot', label: '치수선 밖 돌출 mm', type: 'number', value: 100},
      {name: 'textGap', label: '치수선과 문자 간격 mm', type: 'number', value: 75},
      {name: 'arrowSize', label: '화살표 크기 mm', type: 'number', value: 100},
    ], (values) => {
      // 2026-09-24: 거대값·문자를 엔진 일반 오류("치수점/문자 높이 오류") 대신 한국어로 막는다(검토 P12).
      const size = (key, label, min = 0, exclusiveMin = false) => boundedNumber(values[key], {min, max: 1e5, exclusiveMin, label: `DU · ${label}(mm)`});
      const defaults = {
        textHeight: size('textHeight', '문자높이', 0, true), extensionOffset: size('extensionOffset', '보조선 시작 간격'), extensionOvershoot: size('extensionOvershoot', '치수선 밖 돌출'),
        textGap: size('textGap', '치수선과 문자 간격'), arrowSize: size('arrowSize', '화살표 크기', 0, true),
      };
      const commands = dims.map((dim) => ({type: 'update', ids: [dim.id], changes: refreshDimensionStyle(dim, defaults)}));
      ctx.execute({type: 'batch', commands});
      ctx.toast(`DU(추정) · 치수 ${dims.length}개를 입력한 설정값으로 갱신했습니다.`);
    });
  }

  async function il() {
    const cutA = await ctx.pickPoint('IL · 기준선(교차 검사용) 첫 점을 지정하세요');
    if (!cutA) return;
    const cutB = await ctx.pickPoint('IL · 기준선 둘째 점을 지정하세요');
    if (!cutB) return;
    const line1 = await ctx.pickEntity({prompt: 'IL · 교차점을 찾을 첫 번째 선을 선택하세요 · Esc 취소', types: ['line']});
    if (!line1) return;
    const line2 = await ctx.pickEntity({prompt: 'IL · 교차점을 찾을 두 번째 선을 선택하세요 · Esc 취소', types: ['line']});
    if (!line2) return;
    const {p1, p2, length} = intersectionDimensionPoints(cutA, cutB, {a: line1.points[0], b: line1.points[1]}, {a: line2.points[0], b: line2.points[1]});
    const offset = await ctx.pickPoint({prompt: 'IL · 치수선 위치를 지정하세요', preview: dimensionPreview((cursor) => [{type: 'dimension', mode: 'aligned', points: [p1, p2, cursor], textHeight: th(), layer: ctx.activeLayer?.() || 'default'}])});
    if (!offset) return;
    ctx.commit({entities: [{type: 'dimension', mode: 'aligned', points: [p1, p2, offset], textHeight: th(), layer: ctx.ensureLayer('A-DIM', '#7bdc7b')}]}); // 치수는 치수 레이어에
    ctx.toast(`IL(추정: 원문 미발견) · 교차점 사이 길이 ${Math.round(length)}mm 치수를 넣었습니다.`);
  }

  async function rs() {
    const a = await ctx.pickPoint('RS · 사각형 솔리드 박스 첫 모서리를 지정하세요');
    if (!a) return;
    const b = await ctx.pickPoint('RS · 대각선 반대쪽 모서리를 지정하세요');
    if (!b) return;
    const {outline, fill} = buildSolidBoxEntities(a, b);
    ctx.commit({entities: [outline, fill]}); // 일반 도형: 현재 레이어
    ctx.toast('RS(추정: 원문 미발견) · 솔리드로 채운 사각형 박스를 그렸습니다.');
  }

  return {
    LSE: guard(lse), TL: guard(tl), DLA: guard(dla), DTM: guard(dtm), DTO: guard(dto),
    CSL: guard(csl), DDM: guard(ddm), ESS: guard(ess), WU: guard(wu),
    ATC: guard(atc), R3: guard(r3), OTC: guard(otc),
    DH: guard(dh), DU: guard(du), IL: guard(il), RS: guard(rs),
  };
}
