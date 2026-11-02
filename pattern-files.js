// 해치 무늬(.pat)·선종류(.lin) 정의 파일 만들기(2026-09-24, 5.0.4 검토 D 영역).
// HEX(해치 내보내기)·HPM(해치 문양 만들기)·LEX(선 모양 내보내기)·MTLT(문자 포함 선 만들기)가 함께 쓴다.
// 형식 근거: AutoCAD 호환 .pat("*이름, 설명" + "각도, 기준x, 기준y, 선방향 간격, 수직 간격[, 대시...]")·
// .lin("*이름,설명" + "A,대시,-공백,…" · 문자 요소 ["문자",STANDARD,S=,R=,X=,Y=]).
import * as G from './geometry.js';
import {assertGeneratedCount} from './card-input.js';

const EPS = 1e-9;
export const fmt = (value) => {
  const n = Math.abs(value) < 1e-9 ? 0 : Number(value);
  return String(Number(n.toFixed(6)));
};
export function patternName(raw, fallback = 'BARUN_PATTERN') {
  const name = String(raw ?? '').trim().toUpperCase().replace(/[^A-Z0-9_\-]+/g, '_').replace(/^_+|_+$/g, '');
  return (name || fallback).slice(0, 31);
}
const cleanDescription = (text) => String(text ?? '').replace(/[\r\n,]+/g, ' ').trim().slice(0, 80);

/* ────────── .pat : 바른 CAD 해치 → 무늬 정의 ──────────
   바른 CAD 해치 무늬는 "각도 angle 로 기운 평행선, 간격 spacing"(pattern 'cross' 는 여기에 직교선 추가)이다.
   화면(view.js)·PDF(pdf_service.py)·DXF(exchange.py) 가 모두 같은 규칙으로 선을 그리므로 그대로 옮긴다.
   origin(HP 로 바꾼 해치 기준점)이 있으면 기준점으로 쓴다. */
export function hatchPatternLines(hatch) {
  if (!hatch || hatch.type !== 'hatch') throw Error('해치를 선택하세요.');
  if (hatch.solid || String(hatch.pattern || '').toLowerCase() === 'solid')
    throw Error('단색 채움(SOLID) 해치는 선 무늬가 없어 .pat 으로 내보낼 수 없습니다(SOLID 는 캐드 기본 무늬입니다).');
  const spacing = Number(hatch.spacing ?? 100), angle = Number(hatch.angle ?? 0);
  if (!(spacing > 0) || !Number.isFinite(spacing)) throw Error('해치 간격이 올바르지 않습니다.');
  if (!Number.isFinite(angle)) throw Error('해치 각도가 올바르지 않습니다.');
  const o = hatch.origin && Number.isFinite(hatch.origin.x) && Number.isFinite(hatch.origin.y) ? hatch.origin : {x: 0, y: 0};
  const lines = [{angle, x: o.x, y: o.y, dx: 0, dy: spacing, dashes: []}];
  if (hatch.pattern === 'cross') lines.push({angle: angle + 90, x: o.x, y: o.y, dx: 0, dy: spacing, dashes: []});
  return lines;
}
export function formatPatDefinition(name, description, lines) {
  if (!lines?.length) throw Error('무늬 선이 없습니다.');
  const head = `*${patternName(name)}, ${cleanDescription(description) || patternName(name)}`;
  const body = lines.map((l) => [l.angle, l.x, l.y, l.dx, l.dy, ...(l.dashes || [])].map(fmt).join(', '));
  return [head, ...body].join('\n');
}
export function hatchToPatDefinition(hatch, name, description = '바른 CAD 해치 내보내기') {
  return formatPatDefinition(name, description, hatchPatternLines(hatch));
}
export function patFileText(definitions, {title = '바른 CAD 해치 무늬', date = new Date()} = {}) {
  const stamp = date.toISOString().slice(0, 10);
  return [`;; ${title} (${stamp}) · 캐드의 acadiso.pat 등에 붙여 넣거나 이 파일을 지원 경로에 두고 사용하세요.`, ...definitions, ''].join('\n');
}

/* ────────── .pat : 타일 안의 선·점 → 무늬 정의(HPM) ──────────
   타일(폭 W × 높이 H)을 격자로 반복한 무늬를 선 족(family)으로 바꾼다. 선분 방향이 격자 벡터 (W·a, H·b)와
   평행한 정수 (a,b) 를 찾아 한 주기 길이 Lp 를 구하고, a·y − b·x = 1 을 만족하는 격자 벡터 u=(W·x, H·y) 를
   선족 사이 이동량(선방향 성분 dx, 수직 성분 dy)으로 쓴다(이러면 모든 격자 반복이 정확히 한 번씩 덮인다). */
const gcd = (a, b) => { a = Math.abs(a); b = Math.abs(b); while (b) [a, b] = [b, a % b]; return a; };
function extendedGcd(a, b) {
  if (b === 0) return {g: a, x: 1, y: 0};
  const r = extendedGcd(b, a % b);
  return {g: r.g, x: r.y, y: r.x - Math.floor(a / b) * r.y};
}
export function latticeDirection(dir, W, H, maxIndex = 60) {
  let best = null;
  for (let b = 0; b <= maxIndex; b++) for (let a = -maxIndex; a <= maxIndex; a++) {
    if (a === 0 && b === 0) continue;
    if (b === 0 && a < 0) continue;
    if (gcd(a, b) !== 1) continue;
    const v = {x: W * a, y: H * b}, len = Math.hypot(v.x, v.y);
    const sin = Math.abs(G.cross(dir, {x: v.x / len, y: v.y / len}));
    if (sin < 1e-7 && (!best || len < best.len)) best = {a, b, len};
  }
  return best;
}
export function tileSegmentToPatLine(p, q, tile) {
  const W = tile.maxX - tile.minX, H = tile.maxY - tile.minY;
  const L = G.dist(p, q);
  if (L < EPS) throw Error('길이가 0인 선이 있습니다.');
  let d = G.unit(G.sub(q, p));
  let found = latticeDirection(d, W, H);
  if (!found) return null;
  // 격자 방향과 같은 쪽으로 선 방향을 맞춘다.
  if (G.dot(d, {x: W * found.a, y: H * found.b}) < 0) { d = G.mul(d, -1); [p, q] = [q, p]; }
  const {a, b, len: period} = found;
  // a·y − b·x = 1 인 정수 (x, y)
  const e = extendedGcd(Math.abs(a), b); // |a|·e.x + b·e.y = 1
  const y = a >= 0 ? e.x : -e.x, x = -e.y;
  const u = {x: W * x, y: H * y}, n = G.normal(d);
  const angle = G.angle(d);
  const base = G.sub(p, {x: tile.minX, y: tile.minY});
  const dashes = L >= period - 1e-6 ? [] : [L, -(period - L)];
  return {angle, x: base.x, y: base.y, dx: G.dot(u, d), dy: G.dot(u, n), dashes};
}
export function tilePointToPatLine(point, tile) {
  const W = tile.maxX - tile.minX, H = tile.maxY - tile.minY;
  const base = G.sub(point, {x: tile.minX, y: tile.minY});
  return {angle: 0, x: base.x, y: base.y, dx: 0, dy: H, dashes: [0, -W]};
}
export function tileToPatDefinition({segments = [], points = []}, tile, name, description = '바른 CAD 해치 문양') {
  const W = tile.maxX - tile.minX, H = tile.maxY - tile.minY;
  if (!(W > EPS && H > EPS)) throw Error('문양 상자의 폭과 높이가 0보다 커야 합니다.');
  assertGeneratedCount(segments.length + points.length, '문양 요소', 500);
  const lines = [], skipped = [];
  for (const [p, q] of segments) {
    const line = tileSegmentToPatLine(p, q, tile);
    if (line) lines.push(line); else skipped.push([p, q]);
  }
  for (const pt of points) lines.push(tilePointToPatLine(pt, tile));
  if (!lines.length) throw Error('상자 안의 선이 반복 무늬로 바뀌지 않습니다(선 끝을 상자 격자점에 맞춰 그리세요).');
  return {text: formatPatDefinition(name, description, lines), lines: lines.length, skipped: skipped.length};
}

/* ────────── .lin : 바른 CAD 선종류 → 선 정의(LEX·MTLT) ──────────
   바른 CAD 화면 선종류 비율(view.js linetypeDashPattern)에 2.5mm 를 곱해 캐드 기본 선종류와 비슷한 길이로 적는다. */
export const LIN_UNIT = 2.5;
export const BARUN_LINETYPES = Object.freeze({
  CENTER: {description: 'Center ____ _ ____ _', ratio: [12, 4, 2, 4]},
  PHANTOM: {description: 'Phantom ____ _ _ ____', ratio: [12, 3, 2, 3, 2, 3]},
  DOT: {description: 'Dot . . . . .', ratio: [1, 4]},
  DASHED: {description: 'Dashed __ __ __', ratio: [7, 5]},
  HIDDEN: {description: 'Hidden __ __ __', ratio: [7, 5]},
});
export function barunLinetypeKey(value) {
  const t = String(value || 'CONTINUOUS').toUpperCase();
  if (t.includes('CENTER')) return 'CENTER';
  if (t.includes('PHANTOM')) return 'PHANTOM';
  if (t.includes('DOT')) return 'DOT';
  if (t.includes('HIDDEN')) return 'HIDDEN';
  if (t.includes('DASH')) return 'DASHED';
  return null;
}
export function linDefinition(name, description, elements) {
  const head = `*${patternName(name, 'BARUN_LINE')},${cleanDescription(description)}`;
  const body = ['A', ...elements.map((e) => (typeof e === 'number' ? fmt(e) : e))].join(',');
  return `${head}\n${body}`;
}
export function barunLinetypeDefinition(key, unit = LIN_UNIT) {
  const spec = BARUN_LINETYPES[key];
  if (!spec) throw Error('내보낼 수 없는 선종류입니다: ' + key);
  return linDefinition(key, spec.description, spec.ratio.map((v, i) => (i % 2 === 0 ? 1 : -1) * v * unit));
}
/** 문자 포함 선종류(MTLT): 대시 dash, 문자 칸 gap(문자 폭 포함) 반복. */
export function textLinetypeDefinition(name, text, {dash = 12.7, height = 2.5, gap} = {}) {
  const label = String(text ?? '').replace(/["\r\n,\[\]]/g, '').trim();
  if (!label) throw Error('선에 넣을 문자를 입력하세요.');
  if (!(dash > 0) || !(height > 0)) throw Error('대시 길이와 문자 높이는 0보다 커야 합니다.');
  const textWidth = label.length * height * 0.9, space = gap ?? textWidth + height;
  // 펜은 공백의 가운데에 있다 → 문자 폭의 절반만큼 뒤로 물려 공백 가운데에 문자를 놓는다(캐드 GAS_LINE 과 같은 방식).
  const element = `["${label}",STANDARD,S=${fmt(height)},R=0.0,X=${fmt(-textWidth / 2)},Y=${fmt(-height / 2)}]`;
  return linDefinition(name, `${label} 포함 선 ----${label}----`, [dash, -space / 2, element, -space / 2]);
}
export function linFileText(definitions, {title = '바른 CAD 선종류', date = new Date()} = {}) {
  const stamp = date.toISOString().slice(0, 10);
  return [`;; ${title} (${stamp}) · 캐드의 LINETYPE 불러오기(Load)에서 이 파일을 고르세요.`, ...definitions, ''].join('\n');
}
