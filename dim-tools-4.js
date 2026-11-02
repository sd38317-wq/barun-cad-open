// 4차 병렬 작업(2026-09-21): "부분" 판정 치수 명령 10개(LX CC DG DLL DPL DQ DSC DSM ED SD)를
// 원문(izzarder.com, docs/izzarder-reference-20260921/references/13-dim.md) 대화상자·조작 순서대로 다시 만든다.
// 근거: reports/2차_매핑검증_B_보고_20260921.md 5절(각 행), 원문 WebFetch(/218 /378 /432 /401 /468 /541 /178 /449 /176 /460).
// 대체하는 기존 명령(그대로 둔다, 통합 담당이 바른 CAD 리습 이름을 이 카드로 잇는다):
//   LX←LEADER, CC←DIMCONTINUE, DG←DIMCLEAN, DLL←DIMEXTENSION, DPL·DQ←QUICKDIM,
//   DSC·ED←DIMSCALE, DSM←DIMSTYLEMERGE, SD←DIMEDIT.
// 바른 CAD dimension 객체 모양(geometry.js dimensionParts 근거, engine.js·dim-symbol-tools.js 주석과 동일):
//   선형/정렬: {type:'dimension',mode:'horizontal'|'vertical'|'aligned',points:[a,b,p],text,textTemplate,
//   textPosition,textHeight,arrowSize,extensionOffset,extensionOvershoot,textGap,precision,measurementScale,
//   scale,axisAngle,dimStyle?,layer}. p 는 치수선 위치(옵셋 기준점). scale 필드가 바른 CAD 리습 DIMSCALE 과 같은
//   전체 배율이다(geometry.js:365-370, 문자·화살표·보조선 모두에 곱해짐) — 기존 DIMSCALE 명령(workflows.js:149)은
//   textHeight 만 바꿔 "부분"이었다. dimStyle 이름 문자열은 dimStyleDialog(app.js:2845)가 붙이는 필드로,
//   카드 문맥(ctx)은 문서 수준 dimStyles 테이블에 접근할 수 없어 DSM 은 이 이름 문자열을 "스타일"로 대신 쓴다.
//   LEADER 명령(workflows.js:159)은 전용 엔티티가 없어 {type:'block',name:'지시선',entities:[line,polyline(화살표),text]}
//   로 만든다 — LX 도 같은 얼개(선+머리+문자)를 쓰되 블록으로 묶지 않고 개별 객체 3개로 커밋한다(장식 편집 용이).
// 새로 그리는 객체는 A-DIM 켜(색 #8fd3ff, block-edit-tools.js:210 과 통일)에 놓는다.
// 2차 dim-hatch-tools.js·3차 dim-symbol-tools.js(LSE TL DLA DTM DTO)와 이름이 겹치지 않는다.
// 12절 중복 확인(만들기 전 grep "'LX'".."'SD'" *.js + reports/1차~3차 표 전수 확인, 결과는 이 파일의 보고서 1절에 적음):
//   기존 카드 중복 없음(2차 매핑검증 보고서의 행만 걸림, 실제 카드는 없었다). 자기 목록 내부에서는
//   CC 의 "빠른치수" 모드와 DQ 가 "대표점 정렬 후 체인 생성" 로직이 같아 quickDimPoints/quickDimChain 하나로
//   합쳐 재사용했고(중복 함수 chainDimensions 제거), DSC·ED 는 원문에서 서로 다른 명령이라 카드는 따로 두되
//   축척 반영 코드(applyDimScale)만 하나로 합쳤다.
import * as G from './geometry.js';
import {dimensionPreview} from './dimension-preview.js';
import {isChecked} from './card-input.js';

/* ══════════════════ 순수 함수(시험용, DOM 없이 동작) ══════════════════ */

const DIM_STYLE_KEYS = ['textHeight', 'precision', 'arrowSize', 'extensionOffset', 'extensionOvershoot', 'textGap', 'measurementScale', 'scale', 'textTemplate'];
function copyDimStyle(dim) {
  const out = {};
  for (const k of DIM_STYLE_KEYS) if (dim[k] !== undefined) out[k] = dim[k];
  return out;
}
function dimAxisUnit(dim) {
  const [a, b] = dim.points;
  return ['horizontal', 'vertical'].includes(dim.mode) ? G.polar(1, dim.axisAngle ?? (dim.mode === 'horizontal' ? 0 : 90)) : G.unit(G.sub(b, a));
}
function assertLinearDim(dim, cmd) {
  if (!dim || !['horizontal', 'vertical', 'aligned'].includes(dim.mode)) throw Error(cmd + ' · 선형(수평·수직) 또는 정렬 치수만 지원합니다.');
}
function dedupeSorted(values, tol = 1e-3) {
  const sorted = [...values].sort((a, b) => a - b), out = [];
  for (const v of sorted) if (!out.length || v - out.at(-1) > tol) out.push(v);
  return out;
}

/* ── LX(/218) 자동 지시선 넣기 ── LEADER(workflows.js:159)와 같은 선+머리+문자 얼개에 끝단 형태
   4종(원형/화살표/파형/폴리선 채운 머리)·문자위치(옆/위)·각도고정 스냅을 더한다. */
export function snapAngleStep(deg, step = 15) { return Math.round(deg / step) * step; }
export function snappedLeaderEnd(a, b, step = 15) {
  const dist = G.dist(a, b);
  if (dist < G.EPS) throw Error('LX · 시작점과 끝점이 같습니다.');
  return G.add(a, G.polar(dist, snapAngleStep(G.angle(G.sub(b, a)), step)));
}
export function buildAutoLeaderEntities(a, b, text, { endShape = 'dot', textPos = 'side', textHeight = 150, headHeight = 180, headWidth = 45 } = {}) {
  if (!text || !String(text).trim()) throw Error('LX · 지시선 문자를 입력하세요.');
  if (G.dist(a, b) < G.EPS) throw Error('LX · 시작점과 끝점이 같습니다.');
  const u = G.unit(G.sub(b, a)), n = G.normal(u), size = textHeight * 0.5;
  let head;
  if (endShape === 'dot') head = { type: 'circle', center: { ...a }, radius: Math.max(size * 0.3, G.EPS * 10) };
  else if (endShape === 'arrow') head = { type: 'polyline', closed: false, points: [G.add(a, G.add(G.mul(u, size), G.mul(n, size * 0.3))), a, G.add(a, G.sub(G.mul(u, size), G.mul(n, size * 0.3)))] };
  else if (endShape === 'wave') head = { type: 'polyline', closed: false, points: [a, G.add(a, G.add(G.mul(u, size * 0.33), G.mul(n, size * 0.3))), G.add(a, G.add(G.mul(u, size * 0.66), G.mul(n, -size * 0.3))), G.add(a, G.mul(u, size))] };
  else if (endShape === 'poly') { const hh = headHeight, hw = headWidth; head = { type: 'polyline', closed: true, points: [G.add(a, G.mul(n, hw / 2)), G.add(a, G.add(G.mul(u, hh), G.mul(n, hw / 2))), G.add(a, G.add(G.mul(u, hh), G.mul(n, -hw / 2))), G.add(a, G.mul(n, -hw / 2))] }; }
  else throw Error('LX · 알 수 없는 끝단 형태입니다: ' + endShape);
  const textPosition = textPos === 'above' ? G.add(b, { x: 0, y: textHeight * 0.6 }) : { ...b };
  const align = textPos === 'above' ? 'center' : (u.x >= 0 ? 'left' : 'right');
  return { line: { type: 'line', points: [a, b] }, head, text: { type: 'text', position: textPosition, text: String(text), height: textHeight, rotation: 0, align } };
}

/* ── CC(/378) 치수연장 및 만들기 ── 6모드: 합계치수(같은 오프셋으로 이어그리기, 기존 DIMCONTINUE 와 같은 발상이나
   points·스타일 전부 복제)·새치수(반복 입력)·계단치수(호출마다 오프셋이 gap 만큼 밀림)·빠른치수(여러 객체 한번에 체인)·
   하나씩(참조 치수의 오프셋 거리를 자동 적용)·위아래(클릭한 쪽에 같은 모양 추가). */
export function continueDimension(sourceDim, endPoint, { offsetMode = 'same', offsetPoint = null, offsetValue = 0 } = {}) {
  assertLinearDim(sourceDim, 'CC');
  const [a, b, p] = sourceDim.points;
  let newP;
  if (offsetMode === 'screen') { if (!offsetPoint) throw Error('CC · 치수선 위치를 지정하세요.'); newP = { ...offsetPoint }; }
  else if (offsetMode === 'value') {
    const u = dimAxisUnit(sourceDim), n = G.normal(u), baseOffset = G.dot(p, n), side = baseOffset >= G.dot(a, n) ? 1 : -1;
    newP = G.add(p, G.mul(n, side * offsetValue));
  } else newP = { ...p };
  return { type: 'dimension', mode: sourceDim.mode, points: [b, endPoint, newP], ...copyDimStyle(sourceDim) };
}
// 빠른치수(CC 의 "체인" 모드)는 DQ(여러 객체 신속치수)와 "대표점 정렬 후 체인 생성"이 완전히 같은 로직이라
// 중복해서 만들지 않고 quickDimPoints/quickDimChain(아래 DQ 절)을 그대로 재사용한다(12절 중복 금지).
export function oneByOneDimension(refDim, p1, p2) {
  assertLinearDim(refDim, 'CC');
  const [ra, rb, rp] = refDim.points, ru = dimAxisUnit(refDim), rn = G.normal(ru), offset = G.dot(rp, rn) - G.dot(ra, rn);
  const u = refDim.mode === 'aligned' ? G.unit(G.sub(p2, p1)) : ru, n = G.normal(u);
  const newP = G.add(G.mul(G.add(p1, p2), 0.5), G.mul(n, offset));
  return { type: 'dimension', mode: refDim.mode, points: [p1, p2, newP], ...copyDimStyle(refDim) };
}
export function aboveBelowDimension(refDim, clickPoint, gap) {
  if (!(gap > 0)) throw Error('CC · 위아래 이동거리는 양수여야 합니다.');
  assertLinearDim(refDim, 'CC');
  const [a, b, p] = refDim.points, u = dimAxisUnit(refDim), n = G.normal(u), side = G.dot(G.sub(clickPoint, p), n) >= 0 ? 1 : -1;
  return { type: 'dimension', mode: refDim.mode, points: [a, b, G.add(p, G.mul(n, side * gap))], ...copyDimStyle(refDim) };
}

/* ── DG(/432) 치수 간격 조정 ── 기존 DIMCLEAN(architectural-library.js)은 기준점 없이 자동 충돌회피만 한다.
   여기는 원문대로 정렬 기준점 + 간격(x 축척)으로 평행한 치수들을 순서대로 재배치하고, "한줄로" 도 지원한다. */
/* ── 간격 0 = 자동 고르게(ACAD200 517) ──
   AutoCAD 분배(doDistributeDimensions)는 치수를 방향 순서로 줄 세우고, 칸 번호를 매긴 뒤(calcDistributeSteps),
   간격이 0 이면 첫·끝 치수 거리를 칸 수로 나눈다. 두 치수선이 1e-5 보다 길게 겹칠 때만 다른 칸으로 올린다.
   우리도 같은 순서로 하되, 겹치지 않는 치수는 한 칸(한 줄)에 모아 줄 수를 줄인다(줄 순서는 바꾸지 않는다).
   모두 한 칸에 들어가면(서로 안 겹침) 첫 치수의 줄로 가지런히 맞춘다. */
export const DIM_OVERLAP_TOLERANCE = 1e-5;
export function dimensionLanes(dims, tolerance = DIM_OVERLAP_TOLERANCE) {
  const u = dimAxisUnit(dims[0]), n = G.normal(u);
  const items = dims.map((d, i) => {
    const s = G.dot(d.points[0], u), t = G.dot(d.points[1], u);
    return { i, offset: G.dot(d.points[2], n), anchor: G.dot(d.points[0], n), lo: Math.min(s, t), hi: Math.max(s, t) };
  }).sort((a, b) => a.offset - b.offset || a.i - b.i);
  const lanes = [];
  for (const it of items) {
    const last = lanes.at(-1);
    if (last && last.every(o => Math.min(o.hi, it.hi) - Math.max(o.lo, it.lo) <= tolerance)) last.push(it);
    else lanes.push([it]);
  }
  return { u, n, lanes };
}
export function distributeDimensions(dims, { tolerance = DIM_OVERLAP_TOLERANCE } = {}) {
  const { n, lanes } = dimensionLanes(dims, tolerance);
  // 한 줄이면 재는 점에 가장 가까운 치수의 줄로 맞춘다(안쪽 줄). 여러 줄이면 양 끝 줄을 지키고 사이를 나눈다.
  const nearest = lanes[0].reduce((a, b) => Math.abs(b.offset - b.anchor) < Math.abs(a.offset - a.anchor) ? b : a);
  const first = lanes.length > 1 ? lanes[0][0].offset : nearest.offset, lastLane = lanes.at(-1), end = lastLane[lastLane.length - 1].offset;
  const space = lanes.length > 1 ? (end - first) / (lanes.length - 1) : 0;
  const results = new Array(dims.length);
  lanes.forEach((lane, k) => {
    for (const it of lane) {
      const d = dims[it.i], delta = first + k * space - it.offset;
      results[it.i] = { ...d, points: [d.points[0], d.points[1], G.add(d.points[2], G.mul(n, delta))] };
    }
  });
  return results;
}
export function arrangeDimensionGaps(dims, refPoint, gap, { oneLine = false } = {}) {
  if (!dims?.length) throw Error('DG · 치수를 선택하세요.');
  if (gap === 0 && !oneLine) {
    for (const d of dims) assertLinearDim(d, 'DG');
    const u = dimAxisUnit(dims[0]);
    for (const d of dims) if (Math.abs(G.cross(dimAxisUnit(d), u)) > 1e-3) throw Error('DG · 평행한 치수만 선택하세요.');
    return distributeDimensions(dims);
  }
  if (!(gap > 0) && !oneLine) throw Error('DG · 간격은 양수여야 합니다(0 = 자동 고르게).');
  for (const d of dims) assertLinearDim(d, 'DG');
  const u = dimAxisUnit(dims[0]), n = G.normal(u);
  for (const d of dims) if (Math.abs(G.cross(dimAxisUnit(d), u)) > 1e-3) throw Error('DG · 평행한 치수만 선택하세요.');
  const refOffset = G.dot(refPoint, n);
  const order = dims.map((d, i) => ({ i, offset: G.dot(d.points[2], n) })).sort((a, b) => a.offset - b.offset);
  const results = new Array(dims.length);
  order.forEach((o, k) => {
    const newOffset = oneLine ? refOffset : refOffset + k * gap, delta = newOffset - o.offset, d = dims[o.i];
    results[o.i] = { ...d, points: [d.points[0], d.points[1], G.add(d.points[2], G.mul(n, delta))] };
  });
  return results;
}

/* ── DLL(/401) 치수보조선 길이 통일 ── 숫자 입력 또는 두 점 거리로, 보조선(연장선) 돌출 길이(extensionOvershoot)를
   선택한 치수 전체에 같은 값으로 맞춘다. */
export function unifyExtensionLength(dim, length) {
  assertLinearDim(dim, 'DLL');
  if (!(length >= 0)) throw Error('DLL · 통일할 길이는 0 이상이어야 합니다.');
  return { extensionOvershoot: length };
}

/* ── DPL(/468) 폴리선 자동 치수넣기 ── 4방식: 수직/수평 투영 체인, 블럭 바운딩박스, 정점간 거리(치수),
   곡선 전체 치수(원문의 "정점간 거리(선)"은 bulge 를 무시하는 geometry.js segments() 한계로 (치수)와 합쳤다,
   보고서에 기록). */
/* 2026-09-24: 세 빌더(수직/수평·바운딩박스·정점간)가 textHeight 없이 치수를 만들어 engine.js 검증
   ("치수점/문자 높이 오류")에 항상 걸렸다(검토 P4). "곡선 전체"처럼 문자 높이를 받아 넣는다. */
export function orthoProjectionDims(points, { offsetX = 300, offsetY = 300, textHeight = 150 } = {}) {
  if (!Array.isArray(points) || points.length < 2) throw Error('DPL · 점이 2개 이상 필요합니다.');
  const xs = dedupeSorted(points.map((p) => p.x)), ys = dedupeSorted(points.map((p) => p.y));
  const minY = Math.min(...points.map((p) => p.y)), maxY = Math.max(...points.map((p) => p.y));
  const minX = Math.min(...points.map((p) => p.x)), maxX = Math.max(...points.map((p) => p.x));
  const top = maxY + Math.abs(offsetY), side = maxX + Math.abs(offsetX);
  const horiz = xs.length > 1 ? xs.slice(1).map((x, i) => ({ type: 'dimension', mode: 'horizontal', textHeight, points: [{ x: xs[i], y: minY }, { x, y: minY }, { x: 0, y: top }] })) : [];
  const vert = ys.length > 1 ? ys.slice(1).map((y, i) => ({ type: 'dimension', mode: 'vertical', textHeight, points: [{ x: minX, y: ys[i] }, { x: minX, y }, { x: side, y: 0 }] })) : [];
  if (!horiz.length && !vert.length) throw Error('DPL · 서로 다른 좌표가 2개 이상 필요합니다.');
  return [...horiz, ...vert];
}
export function boundingBoxDims(b, { offset = 300, textHeight = 150 } = {}) {
  if (!b) throw Error('DPL · 도형 경계를 계산할 수 없습니다.');
  if (b.maxX - b.minX < G.EPS || b.maxY - b.minY < G.EPS) throw Error('DPL · 폭과 높이가 있는 도형을 선택하세요.');
  return [
    { type: 'dimension', mode: 'horizontal', textHeight, points: [{ x: b.minX, y: b.minY }, { x: b.maxX, y: b.minY }, { x: 0, y: b.minY - Math.abs(offset) }] },
    { type: 'dimension', mode: 'vertical', textHeight, points: [{ x: b.minX, y: b.minY }, { x: b.minX, y: b.maxY }, { x: b.minX - Math.abs(offset), y: 0 }] },
  ];
}
export function vertexDistanceDims(points, closed, { offset = 300, textHeight = 150 } = {}) {
  if (!Array.isArray(points) || points.length < 2) throw Error('DPL · 점이 2개 이상 필요합니다.');
  const segs = []; for (let i = 1; i < points.length; i++) segs.push([points[i - 1], points[i]]);
  if (closed && points.length > 2) segs.push([points.at(-1), points[0]]);
  return segs.map(([a, b]) => {
    if (G.dist(a, b) < G.EPS) throw Error('DPL · 길이가 0인 구간이 있습니다.');
    const u = G.unit(G.sub(b, a)), n = G.normal(u);
    return { type: 'dimension', mode: 'aligned', textHeight, points: [a, b, G.add(G.mul(G.add(a, b), 0.5), G.mul(n, offset))] };
  });
}
export function totalLengthPath(points, closed, { textHeight = 150 } = {}) {
  if (!Array.isArray(points) || points.length < 2) throw Error('DPL · 점이 2개 이상 필요합니다.');
  let total = 0; for (let i = 1; i < points.length; i++) total += G.dist(points[i - 1], points[i]);
  if (closed && points.length > 2) total += G.dist(points.at(-1), points[0]);
  const mid = points[Math.floor((points.length - 1) / 2)], size = textHeight * 0.5;
  const u0 = G.unit(G.sub(points[1], points[0])), n0 = G.normal(u0);
  const headA = { type: 'polyline', closed: false, points: [G.add(points[0], G.add(G.mul(u0, size), G.mul(n0, size * 0.3))), points[0], G.add(points[0], G.sub(G.mul(u0, size), G.mul(n0, size * 0.3)))] };
  const endIdx = points.length - 1, uEnd = G.unit(G.sub(points[endIdx - 1], points[endIdx])), nEnd = G.normal(uEnd);
  const headB = { type: 'polyline', closed: false, points: [G.add(points[endIdx], G.add(G.mul(uEnd, size), G.mul(nEnd, size * 0.3))), points[endIdx], G.add(points[endIdx], G.sub(G.mul(uEnd, size), G.mul(nEnd, size * 0.3)))] };
  return { path: { type: 'polyline', closed: !!closed, points: points.map((p) => ({ ...p })) }, headA, headB, label: { type: 'text', position: { ...mid }, text: Number(total.toFixed(0)).toString(), height: textHeight, rotation: 0, align: 'center' }, total };
}

/* ── DQ(/541) 여러 객체 신속치수 ── 기존 QUICKDIM→DIMCHAIN 과 같은 "대표점 정렬 후 체인" 발상을 넓혀
   선·폴리선·호·원·블록에서 대표점을 뽑고, 합계 치수(전체 구간 하나 더)를 별도로 만든다. */
export function representativePoint(entity) {
  if (entity.type === 'line') return entity.points.slice(0, 2);
  if (entity.type === 'polyline' || entity.type === 'rectangle') return entity.points.slice();
  if (entity.type === 'circle') return [G.add(entity.center, { x: entity.radius, y: 0 }), G.add(entity.center, { x: -entity.radius, y: 0 }), G.add(entity.center, { x: 0, y: entity.radius }), G.add(entity.center, { x: 0, y: -entity.radius })];
  if (entity.type === 'arc') return [G.add(entity.center, G.polar(entity.radius, entity.startAngle)), G.add(entity.center, G.polar(entity.radius, entity.endAngle))];
  if (entity.type === 'block') return [entity.position];
  return [];
}
export function quickDimPoints(entities, mode) {
  const key = mode === 'vertical' ? 'y' : 'x';
  const pts = entities.flatMap((e) => representativePoint(e));
  const sorted = pts.sort((a, b) => a[key] - b[key]).filter((p, i, arr) => !i || Math.abs(p[key] - arr[i - 1][key]) > 1e-3);
  if (sorted.length < 2) throw Error('DQ · 서로 다른 기준점이 2개 이상 필요합니다.');
  return sorted;
}
export function quickDimChain(points, mode, offsetPoint, style = {}) {
  return points.slice(1).map((b, i) => ({ type: 'dimension', mode, points: [points[i], b, { ...offsetPoint }], ...style }));
}
export function quickDimTotal(points, mode, totalOffsetPoint, style = {}) {
  return { type: 'dimension', mode, points: [points[0], points.at(-1), { ...totalOffsetPoint }], ...style };
}

/* ── DSC(/178) 치수 축척(DimScale) 입력 ── 숫자 직접 입력 또는 도곽(블록 삽입축척/닫힌 폴리선 크기)에서 역산.
   geometry.js dimensionParts 의 e.scale 필드에 직접 적용(문자·화살표·보조선 전부에 곱해짐 — 기존 DIMSCALE 은
   textHeight 만 바꿔 "부분"이었던 부분을 채운다). */
export function dimScaleFromSize(objectSize, paperSize) {
  if (!(objectSize > 0) || !(paperSize > 0)) throw Error('DSC · 크기는 양수여야 합니다.');
  return objectSize / paperSize;
}
export function dimScaleFromBlock(block) {
  if (!block || block.type !== 'block') throw Error('DSC · 블록을 선택하세요.');
  const s = Number(block.scale);
  return Number.isFinite(s) && s > 0 ? s : 1;
}

/* ── DSM(/449) 치수 모양 합치기 ── 바른 CAD 에는 문서 수준 DIMSTYLE 테이블이 카드 문맥(ctx)에 노출되지 않아,
   치수 엔티티의 dimStyle 이름 문자열(dimStyleDialog 가 붙임, app.js:2845)을 "스타일"로 취급한다. 대상 이름을
   쓰는 치수 하나를 찾아 그 속성값을 대표값으로 삼고, 원본 이름을 쓰는 치수 전체(선택 여부와 무관, 문서 전체 +
   블록 내부 1단계)의 dimStyle 과 속성값을 대상으로 바꾼다. 이름있는 스타일 테이블 자체의 삭제(purge)는
   ctx 에 테이블 읽기/쓰기 접근이 없어 만들지 않았다(정직한 한계, 보고서에 기록). */
export function dimStylesInUse(entities) {
  const names = new Set();
  const walk = (es) => { for (const e of es) { if (e.type === 'dimension' && e.dimStyle) names.add(e.dimStyle); if (e.type === 'block' && Array.isArray(e.entities)) walk(e.entities); } };
  walk(entities || []);
  return [...names].sort();
}
export function mergeDimStylePlan(topEntities, sourceNames, targetName, { includeBlocks = true } = {}) {
  if (!targetName) throw Error('DSM · 대상 치수모양을 선택하세요.');
  if (!sourceNames?.length) throw Error('DSM · 합쳐질 치수모양을 하나 이상 선택하세요.');
  const sources = new Set(sourceNames.filter((n) => n !== targetName));
  if (!sources.size) throw Error('DSM · 대상과 다른 치수모양을 선택하세요.');
  const findRep = (es) => { for (const e of es) { if (e.type === 'dimension' && e.dimStyle === targetName) return e; if (includeBlocks && e.type === 'block' && Array.isArray(e.entities)) { const r = findRep(e.entities); if (r) return r; } } return null; };
  const rep = findRep(topEntities);
  if (!rep) throw Error('DSM · 대상 치수모양을 쓰는 치수를 찾을 수 없습니다.');
  const styleValues = copyDimStyle(rep);
  const updates = []; let count = 0;
  for (const e of topEntities) if (e.type === 'dimension' && sources.has(e.dimStyle)) { updates.push({ id: e.id, changes: { dimStyle: targetName, ...styleValues } }); count++; }
  const blockUpdates = [];
  if (includeBlocks) {
    for (const e of topEntities) {
      if (e.type === 'block' && Array.isArray(e.entities)) {
        let changed = false;
        const nextEntities = e.entities.map((inner) => {
          if (inner.type === 'dimension' && sources.has(inner.dimStyle)) { changed = true; count++; return { ...inner, dimStyle: targetName, ...styleValues }; }
          return inner;
        });
        if (changed) blockUpdates.push({ id: e.id, entities: nextEntities });
      }
    }
  }
  if (!count) throw Error('DSM · 합칠 치수를 찾지 못했습니다.');
  return { updates, blockUpdates, count };
}

/* ── ED(/176) 치수 축척 일괄 변경 ── 4모드(절대축척/배수/선택 객체와 맞춤/DSC 값 따르기). "DSC 값"은 DSC 카드가
   ctx.storage 에 남긴 마지막 값을 읽어(문서 수준 시스템변수가 없어 이렇게 대신함) 따른다. */
export function absoluteDimScale(denominator) {
  if (!(denominator > 0)) throw Error('ED · 축척값은 양수여야 합니다.');
  return denominator;
}
export function multipleDimScale(currentScale, factor) {
  if (!(currentScale > 0)) throw Error('ED · 현재 축척을 알 수 없습니다.');
  if (!(factor > 0)) throw Error('ED · 배수는 양수여야 합니다.');
  return currentScale * factor;
}

/* ── SD(/460) 치수선 나누기/합치기 ── 기존 DIMEDIT 은 비율 2등분만 지원(부분). 여기는 원문대로 점 지정(반복)/
   등분(Q)/근접길이(C, 사사오입)/합치기를 만든다. */
export function splitDimensionAtParams(dim, ts) {
  assertLinearDim(dim, 'SD');
  const sorted = [...new Set(ts)].filter((t) => t > 0 && t < 1).sort((a, b) => a - b);
  if (!sorted.length) throw Error('SD · 0과 1 사이의 분할 위치가 필요합니다.');
  const [a, b, p] = dim.points, params = [0, ...sorted, 1], pointAt = (t) => G.add(a, G.mul(G.sub(b, a), t)), style = copyDimStyle(dim);
  const parts = [];
  for (let i = 0; i < params.length - 1; i++) parts.push({ type: 'dimension', mode: dim.mode, points: [pointAt(params[i]), pointAt(params[i + 1]), p], ...style });
  return parts;
}
export const SD_MAX_PARTS = 500;
export function splitDimensionEqual(dim, count) {
  const n = Math.round(count);
  if (!(n >= 2)) throw Error('SD · 등분 개수는 2 이상이어야 합니다.');
  /* 2026-09-24: 상한이 없으면 1e15 등분이 그대로 반복문에 들어가 멈춘다(검토 P2 계열). */
  if (n > SD_MAX_PARTS) throw Error(`SD · 등분 개수는 2~${SD_MAX_PARTS} 사이로 입력하세요(근접길이는 더 길게).`);
  const ts = []; for (let i = 1; i < n; i++) ts.push(i / n);
  return splitDimensionAtParams(dim, ts);
}
export function nearestEqualCount(length, interval) {
  if (!(length > 0) || !(interval > 0)) throw Error('SD · 길이·근접길이는 양수여야 합니다.');
  return Math.max(1, Math.round(length / interval));
}
export function splitDimensionByNearestLength(dim, interval) {
  const [a, b] = dim.points, length = G.dist(a, b), n = nearestEqualCount(length, interval);
  return n < 2 ? [{ ...dim }] : splitDimensionEqual(dim, n);
}
export function mergeDimensions(dims) {
  if (!dims || dims.length < 2) throw Error('SD · 합칠 치수를 2개 이상 선택하세요.');
  const first = dims[0];
  assertLinearDim(first, 'SD');
  const u = dimAxisUnit(first);
  for (const d of dims) { assertLinearDim(d, 'SD'); if (d.mode !== first.mode) throw Error('SD · 같은 방향(모드)의 치수만 합칠 수 있습니다.'); if (Math.abs(G.cross(dimAxisUnit(d), u)) > 1e-3) throw Error('SD · 평행한 치수만 합칠 수 있습니다.'); }
  const pts = dims.flatMap((d) => d.points.slice(0, 2)).sort((x, y) => G.dot(x, u) - G.dot(y, u));
  return { type: 'dimension', mode: first.mode, points: [pts[0], pts.at(-1), first.points[2]], ...copyDimStyle(first) };
}

/* ══════════════════ 화면(dialog·pick) — install…(ctx) 안에서만 ══════════════════ */
export function installDimTools4(ctx) {
  const previewLayer = () => ctx.layers?.().find(l=>l.name==='A-DIM')?.id || ctx.activeLayer?.() || 'default';

  const guard = (fn) => (...args) => {
    try {
      const r = fn(...args);
      if (r && typeof r.catch === 'function') r.catch((e) => { console.error('[card]', e); ctx.toast(ctx.userErrorMessage(e), true); });
    } catch (e) { console.error('[card]', e); ctx.toast(ctx.userErrorMessage(e), true); }
  };
  const dimsLayer = () => ctx.ensureLayer('A-DIM', '#8fd3ff');
  const selectedDims = (cmd) => { const dims = ctx.selected().filter((e) => e.type === 'dimension'); if (!dims.length) throw Error(cmd + ' · 치수를 먼저 선택하세요.'); return dims; };
  // DSC·ED 는 원문에서 단축키·대화상자가 다른 별개 명령(DSC=초기 축척 설정·도곽 자동 인식, ED=이미 놓인
  // 치수의 축척을 4가지 상대 방식으로 일괄 변경, 그 중 하나가 DSC 결과를 따름)이라 카드는 따로 두되(12절),
  // "선택한 치수들의 scale 필드를 일괄 반영 + 이전→새값 토스트 + 마지막 값 저장" 로직은 하나로 합친다.
  const applyDimScale = (cmdLabel, dims, next) => {
    if (!(next > 0)) throw Error(cmdLabel + ' · 축척값은 양수여야 합니다.');
    const before = dims[0].scale || 1;
    ctx.execute({ type: 'batch', commands: dims.map((d) => ({ type: 'update', ids: [d.id], changes: { scale: next } })) });
    try { ctx.storage.setItem('dim-tools-4:last-dsc', String(next)); } catch {}
    ctx.toast(`${cmdLabel} · 치수 ${dims.length}개 축척 변경: ${before} -> ${Number(next.toFixed(3))}`);
  };

  /* ── LX ── */
  function lx() {
    ctx.form('LX · 자동 지시선 넣기', [
      { name: 'text', label: '지시 내용', value: '' },
      { name: 'endShape', label: '끝단 형태', value: 'dot', options: [['dot', '원형'], ['arrow', '화살표'], ['wave', '파형'], ['poly', '폴리선(채운 머리)']] },
      { name: 'textPos', label: '문자위치', value: 'side', options: [['side', '지시선 옆'], ['above', '지시선 위']] },
      { name: 'angleSnap', label: '각도고정(15도 스냅)', type: 'checkbox', value: '' },
    ], (values) => {
      setTimeout(() => { (async () => {
        try {
          const a = await ctx.pickPoint('LX · 지시선 시작점을 지정하세요');
          if (!a) return;
          const layer = previewLayer();
          let b = await ctx.pickPoint({prompt: 'LX · 문자 위치(끝점)를 지정하세요', preview: dimensionPreview((cursor) => { const q = isChecked(values.angleSnap) ? snappedLeaderEnd(a, cursor, 15) : cursor; const built = buildAutoLeaderEntities(a, q, values.text, { endShape: values.endShape, textPos: values.textPos, textHeight: ctx.num('text-height', 150) }); return [built.line, built.head, built.text].map(e => ({...e, layer})); })});
          if (!b) return;
          if (isChecked(values.angleSnap)) b = snappedLeaderEnd(a, b, 15);
          const built = buildAutoLeaderEntities(a, b, values.text, { endShape: values.endShape, textPos: values.textPos, textHeight: ctx.num('text-height', 150) });
          ctx.commit({ entities: [built.line,built.head,built.text].map(e=>({...e,layer:dimsLayer()})) });
          ctx.toast('LX · 지시선을 넣었습니다.');
        } catch (e) { console.error('[card]', e); ctx.toast(ctx.userErrorMessage(e), true); }
      })(); }, 0);
    });
  }

  /* ── CC ── */
  async function ccSum() {
    const ref = await ctx.pickEntity({ prompt: 'CC · 합계치수: 이어 그릴 기존 치수를 선택하세요 · Esc 취소', types: ['dimension'] });
    if (!ref) return;
    assertLinearDim(ref, 'CC');
    let base = ref;
    while (true) {
      const endPoint = await ctx.pickPoint({prompt: 'CC · 합계치수: 다음 끝점을 지정하세요 · Esc 로 종료', preview: dimensionPreview((cursor) => { const d = continueDimension(base, cursor, {offsetMode: 'same'}); return [{...d, layer: base.layer}]; })});
      if (!endPoint) break;
      const dim = continueDimension(base, endPoint, { offsetMode: 'same' });
      const ids = ctx.commit({ entities: [{ ...dim, layer: base.layer }] });
      base = { ...dim, id: ids[0] };
    }
  }
  async function ccNew() {
    const refSel = ctx.selected().find((e) => e.type === 'dimension' && ['horizontal', 'vertical', 'aligned'].includes(e.mode));
    const style = refSel ? copyDimStyle(refSel) : { textHeight: ctx.num('text-height', 150) };
    const mode = refSel ? refSel.mode : 'horizontal';
    while (true) {
      const a = await ctx.pickPoint('CC · 새치수: 첫 점을 지정하세요 · Esc 로 종료');
      if (!a) break;
      const b = await ctx.pickPoint('CC · 새치수: 둘째 점을 지정하세요');
      if (!b) break;
      const p = await ctx.pickPoint({prompt: 'CC · 새치수: 치수선 위치를 지정하세요', preview: dimensionPreview((cursor) => [{type: 'dimension', mode, points: [a, b, cursor], ...style, layer: previewLayer()}])});
      if (!p) break;
      ctx.commit({ entities: [{ type: 'dimension', mode, points: [a, b, p], ...style, layer: dimsLayer() }] });
    }
  }
  async function ccStep(gap) {
    if (!(gap > 0)) throw Error('CC · 계단치수 간격은 양수여야 합니다.');
    const ref = await ctx.pickEntity({ prompt: 'CC · 계단치수: 기존 치수를 선택하세요 · Esc 취소', types: ['dimension'] });
    if (!ref) return;
    assertLinearDim(ref, 'CC');
    let base = ref;
    while (true) {
      const endPoint = await ctx.pickPoint({prompt: 'CC · 계단치수: 다음 끝점을 지정하세요 · Esc 로 종료', preview: dimensionPreview((cursor) => { const d = continueDimension(base, cursor, {offsetMode: 'value', offsetValue: gap}); return [{...d, layer: base.layer}]; })});
      if (!endPoint) break;
      const dim = continueDimension(base, endPoint, { offsetMode: 'value', offsetValue: gap });
      const ids = ctx.commit({ entities: [{ ...dim, layer: base.layer }] });
      base = { ...dim, id: ids[0] };
    }
  }
  async function ccChain() {
    const es = ctx.selected();
    if (es.length < 2) throw Error('CC · 빠른치수: 두 개 이상의 객체(중심선 포함)를 선택하세요.');
    const b = G.bounds(es);
    const mode = b && (b.maxX - b.minX) >= (b.maxY - b.minY) ? 'horizontal' : 'vertical';
    const points = quickDimPoints(es, mode); // DQ 와 같은 "대표점 정렬" 로직(12절 중복 금지 · 재사용)
    const offset = await ctx.pickPoint({prompt: 'CC · 빠른치수: 치수선 위치를 지정하세요', preview: dimensionPreview((cursor) => quickDimChain(points, mode, cursor, {textHeight: ctx.num('text-height', 150)}).map(d => ({...d, layer: previewLayer()})))});
    if (!offset) return;
    const dims = quickDimChain(points, mode, offset, { textHeight: ctx.num('text-height', 150) });
    ctx.commit({ entities: dims.map((d) => ({ ...d, layer: dimsLayer() })) });
  }
  async function ccEach() {
    const ref = await ctx.pickEntity({ prompt: 'CC · 하나씩: 참조할 치수를 선택하세요 · Esc 취소', types: ['dimension'] });
    if (!ref) return;
    assertLinearDim(ref, 'CC');
    while (true) {
      const a = await ctx.pickPoint('CC · 하나씩: 첫 점을 지정하세요 · Esc 로 종료');
      if (!a) break;
      const b = await ctx.pickPoint({prompt: 'CC · 하나씩: 둘째 점을 지정하세요', preview: dimensionPreview((cursor) => [{...oneByOneDimension(ref, a, cursor), layer: ref.layer}])});
      if (!b) break;
      const dim = oneByOneDimension(ref, a, b);
      ctx.commit({ entities: [{ ...dim, layer: ref.layer }] });
    }
  }
  async function ccSide(distance) {
    if (!(distance > 0)) throw Error('CC · 위아래 이동거리는 양수여야 합니다.');
    const ref = await ctx.pickEntity({ prompt: 'CC · 위아래: 기존 치수를 선택하세요 · Esc 취소', types: ['dimension'] });
    if (!ref) return;
    assertLinearDim(ref, 'CC');
    const click = await ctx.pickPoint({prompt: 'CC · 위아래: 위/아래 넣을 쪽을 클릭하세요', preview: dimensionPreview((cursor) => [{...aboveBelowDimension(ref, cursor, distance), layer: ref.layer}])});
    if (!click) return;
    const dim = aboveBelowDimension(ref, click, distance);
    ctx.commit({ entities: [{ ...dim, layer: ref.layer }] });
  }
  function cc() {
    ctx.form('CC · 치수연장 및 만들기', [
      { name: 'mode', label: '모드', value: 'sum', options: [['sum', '합계치수: 기존 치수 이어그리기'], ['new', '새치수: 새로 그리기(반복)'], ['step', '계단치수: 단씩 밀어 이어그리기'], ['chain', '빠른치수: 여러 객체 한번에'], ['each', '하나씩: 참조 치수 모양으로 개별입력(반복)'], ['side', '위아래: 클릭한 쪽에 같은 모양 추가']] },
      { name: 'gap', label: '간격 mm(계단치수용)', type: 'number', value: 450 },
      { name: 'distance', label: '이동거리 mm(위아래용)', type: 'number', value: 300 },
    ], (values) => {
      const run = { sum: ccSum, new: ccNew, step: () => ccStep(Number(values.gap)), chain: ccChain, each: ccEach, side: () => ccSide(Number(values.distance)) }[values.mode];
      setTimeout(() => { Promise.resolve().then(run).catch((e) => { console.error('[card]', e); ctx.toast(ctx.userErrorMessage(e), true); }); }, 0);
    });
  }

  /* ── DG ── */
  function dg() {
    const dims = selectedDims('DG');
    if (dims.length < 2) throw Error('DG · 정리할 치수를 2개 이상 선택하세요.');
    ctx.form('DG · 치수 간격 조정', [
      { name: 'scaleBasis', label: '기준 축척', value: 'dim', options: [['line', '선축척(=1)'], ['dim', '치수축척(기본)'], ['object', '객체축척(평균)']] },
      { name: 'gap', label: '간격(x축척, 기본 8.0 · 0 = 첫·끝 고정 자동 고르게)', type: 'number', value: 8 },
      { name: 'oneLine', label: '한줄로 합치기', type: 'checkbox', value: '' },
    ], (values) => {
      setTimeout(() => { (async () => {
        try {
          const factor = values.scaleBasis === 'line' ? 1 : values.scaleBasis === 'dim' ? (dims[0].scale || 1) : (dims.reduce((s, d) => s + (d.scale || 1), 0) / dims.length);
          const gap = Number(values.gap) * factor;
          const oneLine = isChecked(values.oneLine); // 빈 글·false 는 꺼짐(예전엔 값이 있기만 하면 켜짐)
          const ref = await ctx.pickPoint({prompt: gap === 0 && !oneLine ? 'DG · 자동 고르게: 결과 확인 · 클릭하여 적용 · Esc 취소' : 'DG · 정렬 기준점을 지정하세요', preview: dimensionPreview(cursor => arrangeDimensionGaps(dims,cursor,gap,{oneLine}))});
          if (!ref) return;
          const results = arrangeDimensionGaps(dims, ref, gap, { oneLine });
          ctx.execute({ type: 'batch', commands: results.map((d, i) => ({ type: 'update', ids: [dims[i].id], changes: { points: d.points } })) });
          ctx.toast(`DG · 치수 ${dims.length}개의 간격을 정리했습니다.`);
        } catch (e) { console.error('[card]', e); ctx.toast(ctx.userErrorMessage(e), true); }
      })(); }, 0);
    });
  }

  /* ── DLL ── */
  function dll() {
    const dims = ctx.selected().filter((e) => e.type === 'dimension' && ['horizontal', 'vertical', 'aligned'].includes(e.mode));
    if (!dims.length) throw Error('DLL · 선형·정렬 치수를 먼저 선택하세요.');
    ctx.form('DLL · 치수보조선 길이 통일', [
      { name: 'mode', label: '길이 지정 방법', value: 'value', options: [['value', '숫자로 입력'], ['points', '화면에서 두 점으로 지정']] },
      { name: 'length', label: '통일할 길이 mm(숫자 입력용)', type: 'number', value: 300 },
    ], (values) => {
      if (values.mode === 'value') {
        const length = Number(values.length);
        ctx.execute({ type: 'batch', commands: dims.map((d) => ({ type: 'update', ids: [d.id], changes: unifyExtensionLength(d, length) })) });
        ctx.toast(`DLL · 치수 ${dims.length}개의 보조선 길이를 ${length}mm로 통일했습니다.`);
        return;
      }
      setTimeout(() => { (async () => {
        try {
          const p1 = await ctx.pickPoint('DLL · 길이를 잴 첫 점을 지정하세요');
          if (!p1) return;
          const p2 = await ctx.pickPoint({prompt: 'DLL · 길이를 잴 둘째 점을 지정하세요', preview: dimensionPreview(cursor => dims.map(d=>({...d,...unifyExtensionLength(d,G.dist(p1,cursor))})))});
          if (!p2) return;
          const length = G.dist(p1, p2);
          ctx.execute({ type: 'batch', commands: dims.map((d) => ({ type: 'update', ids: [d.id], changes: unifyExtensionLength(d, length) })) });
          ctx.toast(`DLL · 치수 ${dims.length}개의 보조선 길이를 ${Math.round(length)}mm로 통일했습니다.`);
        } catch (e) { console.error('[card]', e); ctx.toast(ctx.userErrorMessage(e), true); }
      })(); }, 0);
    });
  }

  /* ── DPL ── */
  function dpl() {
    const target = ctx.selected().find((e) => ['polyline', 'rectangle', 'block'].includes(e.type));
    if (!target) throw Error('DPL · 폴리선(또는 블록)을 하나 선택하세요.');
    ctx.form('DPL · 폴리선 자동 치수넣기', [
      { name: 'method', label: '방식', value: 'ortho', options: [['ortho', '폴리선 수직/수평'], ['bbox', '블럭 수직/수평(바운딩박스)'], ['vertex', '정점간 거리(치수)'], ['total', '곡선 전체 치수']] },
      { name: 'offset', label: '이격거리 mm', type: 'number', value: 300 },
    ], (values) => {
      const offset = Number(values.offset), textHeight = ctx.num('text-height', 150);
      if (!Number.isFinite(offset) || Math.abs(offset) > 1e6) throw Error('DPL · 이격거리는 -1,000,000~1,000,000mm 사이의 숫자로 입력하세요.');
      const layer = dimsLayer();
      let entities;
      if (values.method === 'bbox') {
        entities = boundingBoxDims(G.bounds([target]), { offset, textHeight }).map((d) => ({ ...d, layer }));
      } else {
        if (target.type === 'block') throw Error('DPL · 이 방식은 폴리선을 선택하세요(블록은 "블럭 수직/수평" 방식을 쓰세요).');
        const points = target.points;
        if (values.method === 'ortho') entities = orthoProjectionDims(points, { offsetX: offset, offsetY: offset, textHeight }).map((d) => ({ ...d, layer }));
        else if (values.method === 'vertex') entities = vertexDistanceDims(points, !!target.closed, { offset, textHeight }).map((d) => ({ ...d, layer }));
        else { const r = totalLengthPath(points, !!target.closed, { textHeight }); entities = [{ ...r.path, layer }, { ...r.headA, layer }, { ...r.headB, layer }, { ...r.label, layer }]; }
      }
      ctx.commit({ entities });
      ctx.toast(`DPL · 치수를 ${entities.length}개 넣었습니다.`);
    });
  }

  /* ── DQ ── */
  function dq() {
    const es = ctx.selected();
    if (es.length < 2) throw Error('DQ · 두 개 이상의 객체를 선택하세요.');
    ctx.form('DQ · 여러 객체 신속치수', [
      { name: 'mode', label: '치수 방향', value: 'horizontal', options: [['horizontal', '수평'], ['vertical', '수직']] },
      { name: 'totalMode', label: '합계 치수', value: 'skip-default', options: [['always', '항상 입력'], ['ask-default', '입력을 기본값으로'], ['never', '항상 생략'], ['skip-default', '생략을 기본값으로(기본)'], ['only-total', '합계 치수만 입력']] },
    ], (values) => {
      setTimeout(() => { (async () => {
        try {
          const points = quickDimPoints(es, values.mode);
          const style = { textHeight: ctx.num('text-height', 150) }, layer = previewLayer();
          const wantsTotal = ['always', 'ask-default', 'only-total'].includes(values.totalMode);
          const wantsChain = values.totalMode !== 'only-total';
          const entities = [];
          if (wantsChain) {
            const offset = await ctx.pickPoint({prompt: 'DQ · 치수선 위치를 지정하세요', preview: dimensionPreview((cursor) => quickDimChain(points, values.mode, cursor, style).map(d => ({...d, layer}))) });
            if (!offset) return;
            entities.push(...quickDimChain(points, values.mode, offset, style));
          }
          if (wantsTotal) {
            const totalOffset = await ctx.pickPoint({prompt: 'DQ · 합계 치수선 위치를 지정하세요', preview: dimensionPreview((cursor) => [...entities.map(d=>({...d,layer})),{...quickDimTotal(points, values.mode, cursor, style), layer}]) });
            if (!totalOffset) return;
            entities.push(quickDimTotal(points, values.mode, totalOffset, style));
          }
          if (!entities.length) throw Error('DQ · 만들 치수가 없습니다.');
          ctx.commit({ entities: entities.map((d) => ({ ...d, layer: dimsLayer() })) });
          ctx.toast(`DQ · 치수 ${entities.length}개를 넣었습니다.`);
        } catch (e) { console.error('[card]', e); ctx.toast(ctx.userErrorMessage(e), true); }
      })(); }, 0);
    });
  }

  /* ── DSC ── */
  function dsc() {
    const dims = selectedDims('DSC');
    ctx.form('DSC · 치수 축척(DimScale) 입력', [
      { name: 'mode', label: '입력 방법', value: 'number', options: [['number', '숫자 직접 입력'], ['frame', '도곽 블록/폴리선 선택']] },
      { name: 'value', label: '치수 축척(숫자 입력용)', type: 'number', value: dims[0].scale || 1 },
      { name: 'paperSize', label: '실제 도곽 크기 mm(도곽 선택용)', type: 'number', value: 420 },
    ], (values) => {
      const finish = (next) => applyDimScale('DSC', dims, next);
      if (values.mode === 'number') { finish(Number(values.value)); return; }
      setTimeout(() => { (async () => {
        try {
          const frame = await ctx.pickEntity({ prompt: 'DSC · 도곽 블록 또는 닫힌 폴리선을 선택하세요 · Esc 취소', types: ['block', 'polyline', 'rectangle'] });
          if (!frame) return;
          let next;
          if (frame.type === 'block') next = dimScaleFromBlock(frame);
          else { const b = G.bounds([frame]); if (!b) throw Error('DSC · 도곽 경계를 계산할 수 없습니다.'); next = dimScaleFromSize(Math.max(b.maxX - b.minX, b.maxY - b.minY), Number(values.paperSize)); }
          finish(next);
        } catch (e) { console.error('[card]', e); ctx.toast(ctx.userErrorMessage(e), true); }
      })(); }, 0);
    });
  }

  /* ── DSM ── */
  function dsm() {
    const names = dimStylesInUse(ctx.entities());
    ctx.form('DSM · 치수 모양 합치기', [
      { name: 'sources', label: `합쳐질 치수모양(쉼표로 여러 개 · 있음: ${names.join(', ') || '없음'})`, value: '' },
      { name: 'target', label: '대상 치수모양 이름(하나)', value: names[0] || '', ...(names.length ? { options: names.map((n) => [n, n]) } : {}) },
      { name: 'includeBlocks', label: '블럭 속 객체 치수도 적용', type: 'checkbox', value: '' },
    ], (values) => {
      const sourceNames = String(values.sources || '').split(',').map((s) => s.trim()).filter(Boolean);
      const plan = mergeDimStylePlan(ctx.entities(), sourceNames, String(values.target || '').trim(), { includeBlocks: isChecked(values.includeBlocks) });
      const commands = [...plan.updates.map((u) => ({ type: 'update', ids: [u.id], changes: u.changes })), ...plan.blockUpdates.map((b) => ({ type: 'update', ids: [b.id], changes: { entities: b.entities } }))];
      ctx.execute({ type: 'batch', commands });
      ctx.toast(`DSM · 치수 ${plan.count}개를 "${values.target}" 모양으로 합쳤습니다.`);
    });
  }

  /* ── ED ── */
  function ed() {
    const dims = selectedDims('ED');
    ctx.form('ED · 치수 축척 일괄 변경', [
      { name: 'mode', label: '축척 변경 방식', value: 'scale', options: [['scale', '절대축척'], ['multiple', '배수'], ['match', '선택 객체와 맞춤'], ['dsc', 'DSC 값 따르기']] },
      { name: 'value', label: '값(절대축척 또는 배수)', type: 'number', value: 100 },
    ], (values) => {
      const apply = (next) => applyDimScale('ED', dims, next);
      if (values.mode === 'scale') { apply(absoluteDimScale(Number(values.value))); return; }
      if (values.mode === 'multiple') { apply(multipleDimScale(dims[0].scale || 1, Number(values.value))); return; }
      if (values.mode === 'dsc') { let stored = 1; try { stored = Number(ctx.storage.getItem('dim-tools-4:last-dsc')) || 1; } catch {} apply(stored); return; }
      setTimeout(() => { (async () => {
        try {
          const ref = await ctx.pickEntity({ prompt: 'ED · 맞출 치수를 선택하세요 · Esc 취소', types: ['dimension'] });
          if (!ref) return;
          apply(ref.scale || 1);
        } catch (e) { console.error('[card]', e); ctx.toast(ctx.userErrorMessage(e), true); }
      })(); }, 0);
    });
  }

  /* ── SD ── */
  function sd() {
    const dims = ctx.selected().filter((e) => e.type === 'dimension');
    if (!dims.length) throw Error('SD · 치수를 먼저 선택하세요.');
    ctx.form('SD · 치수선 나누기/합치기', [
      { name: 'mode', label: '방식', value: 'point', options: [['point', '기본: 점 지정 분할(반복)'], ['equal', '등분(Q)'], ['nearest', '근접길이(C)'], ['merge', '합치기']] },
      { name: 'value', label: '등분 개수 또는 근접길이 mm', type: 'number', value: 2 },
    ], (values) => {
      if (values.mode === 'merge') {
        if (dims.length < 2) throw Error('SD · 합칠 치수를 2개 이상 선택하세요.');
        const merged = mergeDimensions(dims);
        ctx.execute({ type: 'batch', commands: [{ type: 'delete', ids: dims.map((d) => d.id) }, { type: 'add', entity: { ...merged, layer: dims[0].layer } }] });
        ctx.toast('SD · 치수를 합쳤습니다.');
        return;
      }
      if (dims.length !== 1) throw Error('SD · 나눌 치수를 1개만 선택하세요.');
      const dim = dims[0];
      if (values.mode === 'equal') {
        const parts = splitDimensionEqual(dim, Number(values.value));
        ctx.execute({ type: 'batch', commands: [{ type: 'delete', ids: [dim.id] }, { type: 'addMany', entities: parts.map((p) => ({ ...p, layer: dim.layer })) }] });
        ctx.toast(`SD · ${parts.length}등분했습니다.`);
        return;
      }
      if (values.mode === 'nearest') {
        const parts = splitDimensionByNearestLength(dim, Number(values.value));
        if (parts.length < 2) throw Error('SD · 근접길이가 전체 길이보다 커서 나눌 수 없습니다.');
        ctx.execute({ type: 'batch', commands: [{ type: 'delete', ids: [dim.id] }, { type: 'addMany', entities: parts.map((p) => ({ ...p, layer: dim.layer })) }] });
        ctx.toast(`SD · 근접길이 기준 ${parts.length}등분했습니다.`);
        return;
      }
      setTimeout(() => { (async () => {
        try {
          const [a, b] = dim.points, u = dimAxisUnit(dim), ts = [];
          while (true) {
            const pt = await ctx.pickPoint({prompt: 'SD · 나눌 점을 지정하세요 · Esc 로 종료', preview: dimensionPreview(cursor => {
             const t=G.dot(G.sub(cursor,a),u)/G.dot(G.sub(b,a),u);
             return splitDimensionAtParams(dim,[...ts,...(t>0&&t<1?[t]:[])]).map(d=>({...d,layer:dim.layer}));
            })});
            if (!pt) break;
            const t = G.dot(G.sub(pt, a), u) / G.dot(G.sub(b, a), u);
            if (t > 0 && t < 1) ts.push(t);
          }
          if (!ts.length) throw Error('SD · 나눌 점이 없습니다.');
          const parts = splitDimensionAtParams(dim, ts);
          ctx.execute({ type: 'batch', commands: [{ type: 'delete', ids: [dim.id] }, { type: 'addMany', entities: parts.map((p) => ({ ...p, layer: dim.layer })) }] });
          ctx.toast(`SD · ${parts.length}개로 나눴습니다.`);
        } catch (e) { console.error('[card]', e); ctx.toast(ctx.userErrorMessage(e), true); }
      })(); }, 0);
    });
  }

  return { LX: guard(lx), CC: guard(cc), DG: guard(dg), DLL: guard(dll), DPL: guard(dpl), DQ: guard(dq), DSC: guard(dsc), DSM: guard(dsm), ED: guard(ed), SD: guard(sd) };
}
