// 해치 무늬(훈민캐드 대조 기반 3: H55·H56·H57). 화면(view.js)·출력 미리보기(plot.js)·DXF(exchange.py)·PDF(pdf_service.py)가
// 같은 "무늬 줄" 규칙을 쓴다.
//  무늬 줄 = {angle(도), base{x,y}, offset{x,y}(다음 평행선까지의 도면 좌표 벡터), dashes[+선 -빈칸 0점]} — DXF HATCH 와 같은 형식.
//  e.patternLines 가 있으면 그것(크기·각도·기준점이 이미 적용된 도면 좌표)을 쓴다.
//  없으면 예전 바른 CAD 해치(pattern 'lines'|'cross', spacing, angle, origin)를 같은 규칙의 줄로 바꿔 읽는다(예전 도면 그대로).
import {HATCH_PATTERN_LIBRARY} from './hatch-pattern-library.js';

export {HATCH_PATTERN_LIBRARY};
// Native GPU hatch shader: screen-space half width and zero-length dash tail.
export const GPU_HATCH_RASTER = Object.freeze({halfWidth:.7, minSpacing:0, dotScale:.05, mixedDotScale:.005});
/** 건축에서 자주 쓰는 무늬와 한글 이름(해치 창 목록 위쪽). */
export const COMMON_HATCH_PATTERNS = Object.freeze([
 ['ANSI31', '사선 (일반 단면)'], ['ANSI37', '교차 사선'], ['AR-CONC', '콘크리트'], ['AR-SAND', '모래·미장'],
 ['AR-BRSTD', '벽돌 (표준)'], ['AR-B816', '블록 8×16'], ['AR-B88', '블록 8×8'], ['EARTH', '흙'], ['GRAVEL', '자갈'],
 ['INSUL', '단열재'], ['HONEY', '벌집'], ['NET', '격자'], ['LINE', '평행선'], ['DOTS', '점'], ['CROSS', '십자'],
 ['AR-HBONE', '헤링본'], ['AR-PARQ1', '마루'], ['AR-RROOF', '지붕 (선)'], ['AR-RSHKE', '지붕 (싱글)'], ['ANGLE', '앵글'],
 ['BRICK', '벽돌 (단순)'], ['SQUARE', '사각 격자'], ['ZIGZAG', '지그재그'], ['GRASS', '잔디'], ['SWAMP', '습지'],
].filter(([name]) => HATCH_PATTERN_LIBRARY[name]));

const rad = (deg) => (Number(deg) || 0) * Math.PI / 180;
const rotate = (x, y, a) => ({x: x * Math.cos(a) - y * Math.sin(a), y: x * Math.sin(a) + y * Math.cos(a)});
const finite = (v) => Number.isFinite(v);

// 라이브러리 이름은 대소문자가 섞여 있다(V_MASONRY200x100 …). 대소문자 없이 찾고 원래 이름으로 돌려준다.
const LIBRARY_INDEX = new Map(Object.keys(HATCH_PATTERN_LIBRARY).map(name => [name.toUpperCase(), name]));
/** 무늬 이름 → 라이브러리의 원래 이름. 없으면 null. */
export const canonicalPatternName = (name) => LIBRARY_INDEX.get(String(name || '').trim().toUpperCase()) || null;
/** 무늬 이름의 기본 정의(크기 1·각도 0). 없으면 null. */
export const patternDefinition = (name) => { const key = canonicalPatternName(name); return key ? HATCH_PATTERN_LIBRARY[key] : null; };

/** 기본 정의 → 도면 좌표 무늬 줄. ezdxf scale_pattern 과 같은 순서(기준점·간격을 회전한 뒤 크기를 곱함) + 기준점 이동. */
export function transformPattern(definition, scale = 1, angle = 0, origin = null) {
 const s = Number(scale) || 1, a = rad(angle), o = origin && finite(origin.x) && finite(origin.y) ? origin : {x: 0, y: 0};
 return (definition || []).map(([lineAngle, base, offset, dashes]) => {
  const b = rotate(base[0], base[1], a), off = rotate(offset[0], offset[1], a);
  return {angle: ((Number(lineAngle) || 0) + (Number(angle) || 0)) % 360, base: {x: b.x * s + o.x, y: b.y * s + o.y}, offset: {x: off.x * s, y: off.y * s}, dashes: (dashes || []).map(d => d * s)};
 });
}

/** 해치 객체의 무늬 줄(도면 좌표). 단색이면 []. */
export function hatchFamilies(e) {
 if (!e || e.type !== 'hatch' || e.solid) return [];
 if (Array.isArray(e.patternLines) && e.patternLines.length) return e.patternLines;
 const spacing = Number(e.spacing ?? 100);
 if (!(spacing > 0)) return [];
 const a = Number(e.angle ?? 0), o = e.origin && finite(e.origin.x) && finite(e.origin.y) ? {x: e.origin.x, y: e.origin.y} : {x: 0, y: 0};
 const families = [{angle: a, base: o, offset: rotate(0, spacing, rad(a)), dashes: []}];
 if (String(e.pattern || '').toLowerCase() === 'cross') families.push({angle: a + 90, base: o, offset: rotate(spacing, 0, rad(a)), dashes: []});
 return families;
}

/** 새 해치(또는 무늬 바꾸기)에 넣을 무늬 필드. name 이 기본 바른 무늬(lines·cross·solid)면 예전 형식을 그대로 쓴다. */
export function hatchPatternFields(name, {scale = 1, angle = 0, origin = null} = {}) {
 const key = String(name || '').trim();
 const s = Number(scale), a = Number(angle);
 if (!(s > 0) || s > 100000 || !finite(a)) throw Error('해치 축척은 0보다 크고 100,000 이하, 각도는 숫자로 입력하세요.');
 if (['lines', 'cross', 'solid'].includes(key.toLowerCase())) {
  const lower = key.toLowerCase();
  return {pattern: lower, solid: lower === 'solid', spacing: 100 * s, hatchScale: s, angle: a, patternName: null, patternScale: null, patternLines: null};
 }
 const definition = patternDefinition(key);
 if (!definition) throw Error(`해치 무늬 "${name}" 이(가) 없습니다. 목록에서 고르세요.`);
 if (key.toUpperCase() === 'SOLID') return {pattern: 'solid', solid: true, spacing: 100, angle: 0, patternName: 'SOLID', patternScale: null, patternLines: null};
 const lines = transformPattern(definition, s, a, origin);
 const spacing = Math.min(...lines.map(l => perpendicular(l)).filter(v => v > 0)) || 100 * s;
 return {pattern: 'pattern', solid: false, patternName: canonicalPatternName(key), patternScale: s, angle: a, patternLines: lines, spacing, hatchScale: s};
}

/** 무늬 줄의 평행선 간격(도면 단위). */
export function perpendicular(line) {
 const a = rad(line.angle);
 return Math.abs(line.offset.x * -Math.sin(a) + line.offset.y * Math.cos(a));
}

// Normalize dots before either renderer consumes them. MLightCAD replaces zero
// dashes by a fraction of the original cycle, then recomputes the repeat period.
export function gpuHatchFamilies(entity) {
 return hatchFamilies(entity).map(line => {
  const dashes=(line.dashes||[]).map(Number).filter(Number.isFinite);
  const cycle=dashes.reduce((sum,d)=>sum+Math.abs(d),0);
  const fraction=dashes.some(d=>d>0)?GPU_HATCH_RASTER.mixedDotScale:GPU_HATCH_RASTER.dotScale;
  return {...line,dashes:dashes.map(d=>d===0?cycle*fraction:d)};
 });
}

/**
 * 무늬를 상자 안의 선분·점으로 푼다(도면 좌표). 경계 모양으로 자르는 일은 부르는 쪽(캔버스·SVG·PDF 클립)이 한다.
 * minSpacing(도면 단위)보다 촘촘하거나 선분이 maxSegments 를 넘으면 dense=true 만 돌려준다 — 부르는 쪽이 옅은 채움으로 대신한다.
 */
export function hatchSegments(families, box, {maxSegments = 60000, minSpacing = 0, gapTail = 0} = {}) {
 const segments = [], dots = [];
 if (!box || !(box.maxX > box.minX) || !(box.maxY > box.minY)) return {segments, dots, dense: false};
 const corners = [[box.minX, box.minY], [box.maxX, box.minY], [box.maxX, box.maxY], [box.minX, box.maxY]];
 for (const line of families || []) {
  const a = rad(line.angle), dx = Math.cos(a), dy = Math.sin(a), nx = -dy, ny = dx;
  const perp = line.offset.x * nx + line.offset.y * ny;
  if (!(Math.abs(perp) > 1e-9)) continue;
  if (Math.abs(perp) < minSpacing) return {segments, dots, dense: true};
  const proj = corners.map(([x, y]) => (x - line.base.x) * nx + (y - line.base.y) * ny);
  // 부동소수(cos 90° ≈ 6e-17) 때문에 상자 바로 밖의 줄이 끼지 않도록 아주 작은 허용오차를 둔다.
  const q0 = Math.min(...proj) / perp, q1 = Math.max(...proj) / perp;
  const k0 = Math.ceil(Math.min(q0, q1) - 1e-9), k1 = Math.floor(Math.max(q0, q1) + 1e-9);
  if (k1 - k0 + 1 > maxSegments) return {segments, dots, dense: true};
  const dashes = (line.dashes || []).filter(finite), cycle = dashes.reduce((sum, d) => sum + Math.abs(d), 0);
  for (let k = k0; k <= k1; k++) {
   const px = line.base.x + k * line.offset.x, py = line.base.y + k * line.offset.y;
   const along = corners.map(([x, y]) => (x - px) * dx + (y - py) * dy);
   const tMin = Math.min(...along), tMax = Math.max(...along);
   if (!dashes.length || !(cycle > 1e-12)) {
    segments.push([px + tMin * dx, py + tMin * dy, px + tMax * dx, py + tMax * dy]);
   } else {
    if ((tMax - tMin) / cycle * dashes.length + segments.length > maxSegments) return {segments, dots, dense: true};
    let t = Math.floor(tMin / cycle) * cycle;
    while (t < tMax) {
     for (const d of dashes) {
      const len = Math.abs(d);
      if (d > 0 || (d < 0 && gapTail > 0)) {
       const s0 = Math.max(t, tMin), s1 = Math.min(t + (d > 0 ? len : Math.min(len, gapTail)), tMax);
       if (s1 > s0) segments.push([px + s0 * dx, py + s0 * dy, px + s1 * dx, py + s1 * dy]);
      } else if (d === 0 && t >= tMin && t <= tMax) dots.push([px + t * dx, py + t * dy]);
      t += len;
      if (t >= tMax) break;
     }
    }
   }
   if (segments.length + dots.length > maxSegments) return {segments, dots, dense: true};
  }
 }
 return {segments, dots, dense: false};
}

/** 무늬 목록(해치 창): 자주 쓰는 것 먼저, 나머지는 이름순. */
export function hatchPatternChoices() {
 const common = COMMON_HATCH_PATTERNS.map(([name, label]) => [name, `${label} · ${name}`]);
 const rest = Object.keys(HATCH_PATTERN_LIBRARY).filter(name => name !== 'SOLID' && !COMMON_HATCH_PATTERNS.some(([n]) => n === name)).sort().map(name => [name, name]);
 return [['lines', '바른 사선 (1 = 간격 100mm)'], ['cross', '바른 교차선'], ['solid', '단색 채움'], ...common, ...rest];
}

/** 목록에 없는(사용자 정의로 가져온) 무늬의 축척·각도를 바꾼다: 기준점 pivot 을 중심으로 ratio 배, delta 도 회전. */
export function rescalePatternLines(lines, ratio = 1, delta = 0, pivot = {x: 0, y: 0}) {
 const a = rad(delta), r = Number(ratio) || 1;
 return (lines || []).map(line => {
  const b = rotate(line.base.x - pivot.x, line.base.y - pivot.y, a), o = rotate(line.offset.x, line.offset.y, a);
  return {angle: ((Number(line.angle) || 0) + (Number(delta) || 0)) % 360, base: {x: pivot.x + b.x * r, y: pivot.y + b.y * r}, offset: {x: o.x * r, y: o.y * r}, dashes: (line.dashes || []).map(d => d * r)};
 });
}

/** 해치 하나의 무늬·축척·각도 바꾸기(HATCHEDIT). name 이 비면 지금 무늬 그대로 축척·각도만. 변경분을 돌려준다. */
export function hatchEditChanges(hatch, {name = '', scale = null, angle = null} = {}) {
 const keepName = !String(name || '').trim();
 const currentName = hatch.patternName || (hatch.solid ? 'solid' : String(hatch.pattern || 'lines').toLowerCase() === 'cross' ? 'cross' : 'lines');
 const currentScale = Number(hatch.patternScale ?? hatch.hatchScale ?? (Number(hatch.spacing ?? 100) / 100)) || 1;
 const nextScale = scale == null || scale === '' ? currentScale : Number(scale);
 const nextAngle = angle == null || angle === '' ? Number(hatch.angle ?? 0) : Number(angle);
 const target = keepName ? currentName : String(name).trim();
 const origin = hatch.origin && finite(hatch.origin.x) && finite(hatch.origin.y) ? hatch.origin : null;
 const sameName = target.toUpperCase() === String(currentName).toUpperCase();
 const hasLines = Array.isArray(hatch.patternLines) && hatch.patternLines.length > 0;
 // 같은 무늬를 고치면 지금 무늬 줄을 비율로 바꾼다: 가져온 도면의 무늬는 라이브러리(ISO)와 단위가 다를 수 있다(acad.pat 인치 무늬 → 25.4배 차이).
 // 라이브러리에서 새로 만드는 것은 무늬 이름을 바꿀 때만.
 if (!(sameName && hasLines)) {
  if (['lines', 'cross', 'solid'].includes(target.toLowerCase()) || patternDefinition(target)) return hatchPatternFields(target, {scale: nextScale, angle: nextAngle, origin});
  throw Error(`해치 무늬 "${target}" 이(가) 없습니다. 목록에서 고르세요.`);
 }
 // 가져온 도면의 무늬(사용자 정의 포함): 지금 줄을 비율로 바꾼다.
 if (!(nextScale > 0) || !finite(nextAngle)) throw Error('해치 축척은 0보다 크고, 각도는 숫자로 입력하세요.');
 const lines = rescalePatternLines(hatch.patternLines || [], nextScale / currentScale, nextAngle - Number(hatch.angle ?? 0), origin || hatch.patternLines?.[0]?.base || {x: 0, y: 0});
 const gaps = lines.map(perpendicular).filter(v => v > 0 && finite(v)), spacing = gaps.length ? Math.min(...gaps) : Number(hatch.spacing ?? 100);
 return {patternLines: lines, patternScale: nextScale, angle: nextAngle, spacing: finite(spacing) && spacing > 0 ? spacing : 100};
}
