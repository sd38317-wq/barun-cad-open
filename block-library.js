// 블록 모음 + 사무실 공유(훈민캐드 대조 기반 H96 · 훈민 건축 라이브러리 / AutoCAD DesignCenter·도구 팔레트).
//  BLOCKLIB   분류 → 품목 → 크기·회전·대칭 → 커서를 따라오는 미리보기로 삽입(Esc 까지 계속). 마지막 선택을 기억한다.
//             가구·위생·주방·차량·조경·기호·사무 41종을 실제 mm 크기의 매개변수 평면 블록으로 그린다.
//             "내 라이브러리"(LIBRARY 로 저장했거나 LIBIMPORT 로 가져온 블록)도 같은 방식으로 넣는다.
//  LIBEXPORT  내 라이브러리·선택한 블록·도면 블록 정의를 사무실 공유용 JSON 한 파일로 내보낸다.
//  LIBIMPORT  공유 JSON 을 검사(형식·버전·크기·객체 검증)해 내 라이브러리에 더한다. 기존 항목은 지우거나 덮지 않는다.
// 내 라이브러리 저장 형식은 workflows.js 의 LIBRARY 와 같다:
//   localStorage['barun-cad-symbols'] = {이름: 객체[]}  (객체 좌표의 원점 = 삽입 기준점, 레이어는 넣을 때 다시 정한다)
// 그래서 가져온 블록은 LIBRARY(이름으로 삽입)와 BLOCKLIB(내 라이브러리) 양쪽에 바로 보인다.
import * as G from './geometry.js';
import {parametricReference} from './shared-blocks.js';
import {blockStorageShared} from './side-docs.js';
import {DrawingEngine} from './engine.js';
import {isChecked, downloadText as cardDownloadText, safeFileName} from './card-input.js';

export const LIBRARY_STORAGE_KEY = 'barun-cad-symbols';          // workflows.js LIBRARY 와 같은 키
export const LIBRARY_META_KEY = 'barun-cad-symbols-meta';        // 분류·설명·출처(없어도 LIBRARY 는 동작)
export const BLOCKLIB_LAST_KEY = 'barun-blocklib-last';
export const LIBRARY_FORMAT = 'barun-block-library';
export const LIBRARY_VERSION = 1;
export const LIBRARY_LIMITS = Object.freeze({
 maxBytes: 4 * 1024 * 1024,     // 파일 크기(브라우저 저장 공간 5 MB 안에서 기존 항목과 함께 들어가도록)
 maxBlocks: 500,                // 한 파일의 블록 수
 maxEntitiesPerBlock: 20000,    // 블록 하나의 객체 수(중첩 포함)
 maxTotalEntities: 100000,      // 파일 전체 객체 수(중첩 포함)
 maxDepth: 8,                   // 블록 안 블록 중첩 단계
 maxNameLength: 80,
});

/* ───────────── 작은 도형 도우미 (모두 원점 기준, mm) ───────────── */
const O = Object.freeze({x: 0, y: 0});
const P = (x, y) => ({x, y});
const toPoint = (p) => Array.isArray(p) ? P(p[0], p[1]) : P(p.x, p.y);
function poly(pts, closed = false, extra = {}) {
 const points = [];
 for (const raw of pts) { const q = toPoint(raw), last = points.at(-1); if (!last || Math.hypot(q.x - last.x, q.y - last.y) > 1e-9) points.push(q); }
 if (closed && points.length > 2 && Math.hypot(points[0].x - points.at(-1).x, points[0].y - points.at(-1).y) < 1e-9) points.pop();
 return {type: 'polyline', points, closed, ...extra};
}
const line = (ax, ay, bx, by, extra = {}) => ({type: 'line', points: [P(ax, ay), P(bx, by)], ...extra});
const rect = (x, y, w, h, extra) => poly([[x, y], [x + w, y], [x + w, y + h], [x, y + h]], true, extra);
function arcPts(cx, cy, rx, ry, a0, a1, steps) {
 const out = [];
 for (let i = 0; i <= steps; i++) { const t = (a0 + (a1 - a0) * i / steps) * Math.PI / 180; out.push([cx + rx * Math.cos(t), cy + ry * Math.sin(t)]); }
 return out;
}
function roundRect(x, y, w, h, r, extra) {
 r = Math.max(0, Math.min(r, w / 2, h / 2));
 if (r < 1e-6) return rect(x, y, w, h, extra);
 const s = 6;
 return poly([...arcPts(x + w - r, y + r, r, r, -90, 0, s), ...arcPts(x + w - r, y + h - r, r, r, 0, 90, s), ...arcPts(x + r, y + h - r, r, r, 90, 180, s), ...arcPts(x + r, y + r, r, r, 180, 270, s)], true, extra);
}
const circle = (x, y, r) => ({type: 'circle', center: P(x, y), radius: r});
const ellipse = (x, y, rx, ry) => rx >= ry ? {type: 'ellipse', center: P(x, y), majorAxis: P(rx, 0), ratio: ry / rx} : {type: 'ellipse', center: P(x, y), majorAxis: P(0, ry), ratio: rx / ry};
const label = (value, x, y, h) => ({type: 'text', position: P(x, y), text: String(value), height: h, align: 'center'});
const solid = (pts) => ({type: 'hatch', points: pts.map(toPoint), solid: true, spacing: 100, angle: 0});
const place = (list, angle, dx, dy) => list.map(e => G.translate(angle ? G.rotate(e, O, angle) : e, dx, dy));
/** 한 줄 가운데 정렬 문자의 폭: geometry.js vertices() 와 같은 어림(한글·전각 1.0, 나머지 0.65 × 높이). */
const textWidth = (value, h) => G.textLineUnits(value ?? '') * h;
const box = (minX, minY, maxX, maxY) => ({minX, minY, maxX, maxY});
const union = (...list) => list.filter(Boolean).reduce((a, b) => box(Math.min(a.minX, b.minX), Math.min(a.minY, b.minY), Math.max(a.maxX, b.maxX), Math.max(a.maxY, b.maxY)));
const textBox = (value, cx, y, h) => value ? box(cx - textWidth(value, h) / 2, y, cx + textWidth(value, h) / 2, y + h) : null;

/* 의자: 앞(앉는 쪽)이 facing 방향(도). 식탁 의자 450×450, 사무 의자(팔걸이) 540×480. 기준 = 의자 중심. */
function chairAt(cx, cy, facing) {
 return place([roundRect(-210, -160, 420, 385, 45), roundRect(-225, -225, 450, 65, 28)], facing - 90, cx, cy);
}
function officeChairAt(cx, cy, facing) {
 return place([roundRect(-220, -150, 440, 380, 90), roundRect(-230, -250, 460, 85, 42), roundRect(-270, -110, 42, 260, 20), roundRect(228, -110, 42, 260, 20)], facing - 90, cx, cy);
}

/* ───────────── 품목별 그리기 (벽·등 쪽 = 아래 y=0, 앞 = +y) ───────────── */
function bed({width: W, length: L}) {
 const out = [rect(0, 0, W, L), line(0, 60, W, 60)];
 const two = W >= 1300, pw = two ? (W - 240) / 2 : Math.min(700, W - 200);
 for (let i = 0; i < (two ? 2 : 1); i++) out.push(roundRect(two ? 80 + i * (pw + 80) : (W - pw) / 2, 120, pw, 300, 60));
 const yb = Math.max(480, L * 0.33), f = Math.min(420, W * 0.35);
 out.push(line(0, yb, W, yb), line(W - f, yb, W, yb + f));   // 이불 끝선과 접힌 모서리
 return out;
}
function sofa({width: W, depth: D}, seats) {
 const arm = Math.min(220, Math.max(120, W * 0.09)), back = Math.min(220, D * 0.25), cw = (W - 2 * arm) / seats;
 const out = [roundRect(0, 0, W, D, 70), line(arm, 0, arm, D), line(W - arm, 0, W - arm, D), line(arm, back, W - arm, back)];
 for (let i = 0; i < seats; i++) { const x = arm + i * cw; out.push(roundRect(x + 15, back + 15, cw - 30, D - back - 45, 45), roundRect(x + 15, 15, cw - 30, back - 30, 35)); }
 return out;
}
function dining({width: W, depth: D}, seats) {
 const per = seats / 2, out = [roundRect(-W / 2, -D / 2, W, D, 25)];
 for (let i = 0; i < per; i++) { const x = -W / 2 + W * (i + 0.5) / per; out.push(...chairAt(x, D / 2 + 275, 270), ...chairAt(x, -D / 2 - 275, 90)); }
 return out;
}
const homeDesk = ({width: W, depth: D}) => [rect(0, 0, W, D), ...chairAt(W / 2, D + 255, 270)];
function closet({width: W, depth: D}, sectionWidth = Infinity) {
 const door = 20, rodY = (D - door) / 2, half = Math.min(190, rodY - 30), out = [rect(0, 0, W, D), line(0, D - door, W, D - door)];
 const sections = Number.isFinite(sectionWidth) ? Math.max(1, Math.round(W / sectionWidth)) : 1, sw = W / sections;
 for (let s = 0; s < sections; s++) {
  const x0 = s * sw;
  if (s) out.push(line(x0, 0, x0, D - door));                        // 칸막이
  out.push(line(x0 + 40, rodY, x0 + sw - 40, rodY));                 // 옷걸이 봉
  const n = Math.max(2, Math.floor((sw - 160) / 110) + 1);
  for (let i = 0; i < n; i++) { const x = x0 + 80 + (sw - 160) * i / (n - 1); out.push(line(x - 30, rodY - half, x + 30, rodY + half)); }
 }
 const doors = Math.max(1, Math.round(W / 600));
 for (let i = 1; i < doors; i++) out.push(line(W * i / doors, D - door, W * i / doors, D));
 return out;
}
function toiletFloor() {
 const ex = (y) => 190 * Math.sqrt(1 - ((y - 470) / 270) ** 2);
 return [roundRect(-250, 0, 500, 200, 30), ellipse(0, 470, 190, 270), ellipse(0, 495, 125, 180), line(-150, 200, -ex(330), 330), line(150, 200, ex(330), 330)];
}
function toiletWall() {
 const ex = (y) => 180 * Math.sqrt(1 - ((y - 300) / 240) ** 2);
 return [rect(-180, 0, 360, 60), ellipse(0, 300, 180, 240), ellipse(0, 320, 120, 165), line(-140, 60, -ex(160), 160), line(140, 60, ex(160), 160)];
}
const toiletAccessible = () => [...toiletFloor(), roundRect(-370, 150, 40, 650, 20), roundRect(330, 60, 40, 740, 20), rect(315, 0, 70, 60)];
function basinCounter({width: W, depth: D}) {
 const cy = D * 0.54, rx = Math.min(230, W * 0.3), ry = Math.min(170, D * 0.3);
 return [rect(0, 0, W, D), ellipse(W / 2, cy, rx, ry), circle(W / 2, cy, 16), circle(W / 2, 70, 22), line(W / 2, 92, W / 2, cy - ry + 40)];
}
const basinWall = () => [poly([[-275, 0], [275, 0], ...arcPts(0, 200, 275, 250, 0, 180, 20)], true), ellipse(0, 245, 195, 140), circle(0, 245, 16), circle(0, 55, 20), line(0, 75, 0, 130)];
function bathtub({width: W, depth: D}) {
 const rim = 70;
 return [rect(0, 0, W, D), roundRect(rim, rim, W - 2 * rim, D - 2 * rim, Math.min(200, (D - 2 * rim) / 2)), circle(W - rim - 150, D / 2, 30), roundRect(W - 55, D / 2 - 60, 30, 120, 10)];
}
function shower({width: W, depth: D}) {
 const i = 40, c = P(W / 2, D / 2), r = Math.min(40, Math.min(W, D) * 0.05);
 const out = [rect(0, 0, W, D), rect(i, i, W - 2 * i, D - 2 * i), circle(c.x, c.y, r), line(i, D - 15, W - i, D - 15), circle(W / 2, i + 70, 35)];
 for (const q of [P(i, i), P(W - i, i), P(W - i, D - i), P(i, D - i)]) { const p = G.add(c, G.mul(G.unit(G.sub(q, c)), r)); out.push(line(p.x, p.y, q.x, q.y)); }   // 배수 구배선
 return out;
}
const urinal = () => [poly([[-200, 0], [200, 0], ...arcPts(0, 150, 200, 200, 0, 180, 16)], true), ellipse(0, 185, 130, 115), circle(0, 35, 18)];
function sinkBowl(cx, D) {
 const rh = D - 130;
 return [roundRect(cx - 400, 70, 800, rh, 40), roundRect(cx - 360, 110, 720, rh - 80, 70), circle(cx, 70 + rh / 2, 35), circle(cx, 38, 22), line(cx, 60, cx, 150)];
}
function sinkStraight({length: L, depth: D, upper}) {
 const out = [rect(0, 0, L, D), ...sinkBowl(Math.min(L - 420, Math.max(420, L * 0.3)), D)];
 if (upper) out.push(line(0, 350, L, 350, {linetype: 'HIDDEN'}));   // 상부장
 return out;
}
function sinkL({length: A, side: B, depth: D, upper}) {
 const out = [poly([[0, 0], [A, 0], [A, D], [D, D], [D, B], [0, B]], true), ...sinkBowl(Math.min(A - 420, Math.max(D + 420, A * 0.62)), D)];
 if (upper) out.push(poly([[A, 350], [350, 350], [350, B]], false, {linetype: 'HIDDEN'}));
 return out;
}
function range({kind, width: W, depth: D}) {
 const m = Math.min(W, D);
 if (kind === 'induction') return [roundRect(0, 0, W, D, 30), circle(W * 0.3, D * 0.42, m * 0.19), circle(W * 0.72, D * 0.3, m * 0.13), circle(W * 0.72, D * 0.64, m * 0.13), line(20, D - 70, W - 20, D - 70), rect(W / 2 - 60, D - 50, 120, 30)];
 const out = [roundRect(0, 0, W, D, 20), line(0, D - 80, W, D - 80)], r = m * 0.15;
 for (const [fx, fy] of [[0.28, 0.3], [0.72, 0.3], [0.28, 0.62], [0.72, 0.62]]) out.push(circle(W * fx, D * fy, r), circle(W * fx, D * fy, r * 0.5));
 for (let i = 1; i <= 4; i++) out.push(circle(W * i / 5, D - 40, Math.min(18, m * 0.035)));
 return out;
}
function fridge({width: W, depth: D}) {
 const b = D - 60, th = Math.min(150, W * 0.16);
 return [rect(0, 0, W, D), line(0, b, W, b), line(W * 0.45, b, W * 0.45, D), label('REF', W / 2, D * 0.45 - th / 2, th)];
}
function dishwasher({width: W, depth: D}) {
 const th = Math.min(150, W * 0.25);
 return [rect(0, 0, W, D), line(0, D - 50, W, D - 50), label('DW', W / 2, D * 0.45 - th / 2, th)];
}
const mirrorSize = (W) => Math.min(120, W * 0.065);
function car({length: L, width: W}, hood = 0.26) {
 const x = W / 2, m = mirrorSize(W), y1 = L / 2 - hood * L, y2 = y1 - 0.11 * L, y3 = -L / 2 + 0.27 * L, y4 = y3 - 0.075 * L, i1 = 0.07 * W, i2 = 0.14 * W, i3 = 0.08 * W;
 return [
  roundRect(-x, -L / 2, W, L, W * 0.18),                                   // 차체 (앞 = +y)
  poly([[-x + i1, y1], [x - i1, y1], [x - i2, y2], [-x + i2, y2]], true),  // 앞유리
  rect(-x + i2, y3, W - 2 * i2, y2 - y3),                                   // 지붕
  poly([[-x + i2, y3], [x - i2, y3], [x - i3, y4], [-x + i3, y4]], true),  // 뒷유리
  line(-x + i1, y1, -x + i3, y4), line(x - i1, y1, x - i3, y4),            // 옆유리
  poly([[-x, y1 - 0.01 * L], [-x - m, y1 - 0.015 * L], [-x - m, y1 - 0.045 * L], [-x, y1 - 0.05 * L]]),   // 사이드미러
  poly([[x, y1 - 0.01 * L], [x + m, y1 - 0.015 * L], [x + m, y1 - 0.045 * L], [x, y1 - 0.05 * L]]),
 ];
}
function accessibleParking({size: S}) {
 const u = S / 100, w = 4.2 * u, s = (x, y) => [x * u, y * u], head = arcPts(-4 * u, 31 * u, 6.5 * u, 6.5 * u, 0, 360, 24).slice(0, -1);
 return [
  rect(-S / 2, -S / 2, S, S),
  circle(-4 * u, 31 * u, 6.5 * u), solid(head),                                        // 머리
  poly([s(-7, 21), s(-9, -2), s(14, -2), s(21, -24), s(29, -24)], false, {constantWidth: w}),   // 몸·다리
  poly([s(-8, 13), s(8, 13)], false, {constantWidth: w}),                              // 팔
  poly(arcPts(-5 * u, -13 * u, 23 * u, 23 * u, 110, 380, 30), false, {constantWidth: w}),   // 바퀴
 ];
}
function bicycle({length: L, width: W}) {
 const wh = Math.min(700, L * 0.38), t = Math.max(30, W * 0.07), hy = L / 2 - wh * 0.62, sy = -L / 2 + wh * 0.72, crank = Math.min(170, W * 0.28);
 return [
  poly([[0, -L / 2], [0, -L / 2 + wh]], false, {constantWidth: t}), poly([[0, L / 2 - wh], [0, L / 2]], false, {constantWidth: t}),   // 바퀴
  line(0, -L / 2 + wh, 0, L / 2 - wh),                                                  // 몸체
  poly([[-W / 2, hy - 40], [-W / 4, hy], [W / 4, hy], [W / 2, hy - 40]]),               // 핸들
  roundRect(-70, sy - 120, 140, 240, 60),                                               // 안장
  line(-crank, 0, crank, 0), rect(-crank - 60, -25, 60, 50), rect(crank, -25, 60, 50),  // 페달
 ];
}
function tree({diameter: D}) {
 const R = D / 2, t = Math.max(40, D * 0.035), out = [circle(0, 0, R), circle(0, 0, t)];
 const jitter = [0, 11, -7, 5, -12, 8, -4], reach = [0.56, 0.62, 0.52, 0.6, 0.55, 0.58, 0.5];
 for (let i = 0; i < 7; i++) {
  const a = 90 + i * 360 / 7 + jitter[i], p0 = G.polar(t, a), p1 = G.polar(R * reach[i], a);
  out.push(line(p0.x, p0.y, p1.x, p1.y));
  for (const side of [-1, 1]) { const p2 = G.add(p1, G.polar(R * 0.27, a + side * (22 + (i % 3) * 5))); out.push(line(p1.x, p1.y, p2.x, p2.y)); }
  const mid = G.polar(R * reach[i] * 0.55, a), p3 = G.add(mid, G.polar(R * 0.2, a + (i % 2 ? 38 : -38)));
  out.push(line(mid.x, mid.y, p3.x, p3.y));
 }
 return out;
}
function shrub({diameter: D}) {
 // 잎 원(k 개, 4의 배수라 상하좌우 끝이 정확히 반지름)을 겹쳐 바깥 호만 잇는다.
 const R = D / 2, k = Math.min(24, Math.max(8, 4 * Math.round(D / 500))), th = 360 / k, s = Math.sin(th * Math.PI / 360);
 const rho = R / (1 + 1.25 * s), a = 1.25 * rho * s, reach = rho * Math.cos(th * Math.PI / 360) + Math.sqrt(a * a - (rho * s) ** 2), out = [];
 for (let i = 0; i < k; i++) {
  const ang = i * th, c = G.polar(rho, ang), prev = G.polar(reach, ang - th / 2), next = G.polar(reach, ang + th / 2);
  out.push({type: 'arc', center: c, radius: a, startAngle: G.angle(G.sub(prev, c)), endAngle: G.angle(G.sub(next, c))});
 }
 out.push(circle(0, 0, Math.max(15, D * 0.03)));
 return out;
}
function lawn({width: W}) {
 const out = [line(-W / 2, 0, W / 2, 0)];
 for (const [fx, fh] of [[-0.32, 0.34], [0, 0.45], [0.32, 0.3]]) {
  const x = fx * W, h = fh * W;
  for (const [da, k] of [[-34, 0.62], [-17, 0.85], [0, 1], [17, 0.82], [34, 0.6]]) { const p = G.add(P(x, 0), G.polar(h * k, 90 + da)); out.push(line(x, 0, p.x, p.y)); }
 }
 return out;
}
function bench({width: W, depth: D}) {
 const e = Math.min(80, W * 0.05), out = [rect(0, 0, W, D), line(e, 0, e, D), line(W - e, 0, W - e, D)], n = Math.max(3, Math.round(D / 90));
 for (let i = 1; i < n; i++) out.push(line(e, D * i / n, W - e, D * i / n));
 return out;
}
function northArrow({diameter: D}) {
 const R = D / 2, tip = P(0, R), l = P(-0.36 * R, -0.62 * R), notch = P(0, -0.3 * R), r = P(0.36 * R, -0.62 * R);
 return [circle(0, 0, R), poly([tip, l, notch, r], true), solid([tip, l, notch]), label('N', 0, R + 0.12 * D, 0.22 * D)];
}
const levelLayout = ({text, size: s, textHeight: th}) => { const ht = s * Math.sqrt(3) / 2, pad = th * 0.3, tw = textWidth(text, th); return {ht, pad, tw}; };
function levelMark(o) {
 const {size: s, textHeight: th, text} = o, {ht, pad, tw} = levelLayout(o);
 const out = [poly([[0, 0], [-s / 2, ht], [s / 2, ht]], true), line(-s / 2, ht, s / 2 + 2 * pad + tw, ht)];
 if (text) out.push(label(text, s / 2 + pad + tw / 2, ht + pad, th));
 return out;
}
const sectionTexts = ({label: mark, sheet, diameter: D}) => { const R = D / 2; return sheet ? [[mark, 0.16 * R, 0.55 * R], [sheet, -0.74 * R, 0.38 * R]] : [[mark, -0.3 * R, 0.6 * R]]; };
function sectionMark(o) {
 const R = o.diameter / 2, tri = [P(-0.6 * R, 0.8 * R), P(0.6 * R, 0.8 * R), P(0, 1.6 * R)], out = [circle(0, 0, R), solid(tri), poly(tri, true)];
 if (o.sheet) out.push(line(-R, 0, R, 0));
 for (const [value, y, h] of sectionTexts(o)) out.push(label(value, 0, y, h));
 if (o.cut > 0) out.push(poly([[R, 0], [R + o.cut, 0]], false, {constantWidth: Math.max(1, o.diameter * 0.06)}));   // 절단선
 return out;
}
function entranceArrow({length: L, width: w, text, textHeight: th}) {
 const hl = 0.9 * w, sw = 0.3 * w, head = [P(0, 0), P(-w / 2, -hl), P(w / 2, -hl)], out = [solid(head), poly(head, true), rect(-sw / 2, -L, sw, L - hl)];
 if (text) out.push(label(text, 0, -L - 1.4 * th, th));
 return out;
}
const officeDesk = ({width: W, depth: D}) => [rect(0, 0, W, D), roundRect(W / 2 - 275, 90, 550, 45, 15), rect(W / 2 - 230, Math.min(260, D - 190), 460, 150), ...officeChairAt(W / 2, D + 260, 270)];
const meetingSeats = (L) => Math.max(1, Math.floor((L - 200) / 700));
function meetingTable({length: L, depth: D, ends}) {
 const out = [roundRect(-L / 2, -D / 2, L, D, Math.min(150, D / 4))], n = meetingSeats(L), sp = L / n;
 for (let i = 0; i < n; i++) { const x = -L / 2 + sp * (i + 0.5); out.push(...chairAt(x, D / 2 + 275, 270), ...chairAt(x, -D / 2 - 275, 90)); }
 if (ends) out.push(...chairAt(-L / 2 - 275, 0, 0), ...chairAt(L / 2 + 275, 0, 180));
 return out;
}
const partition = ({length: L, thickness: T}) => [rect(0, 0, L, T), line(40, 0, 40, T), line(L - 40, 0, L - 40, T)];

/* ───────────── 품목 목록 ───────────── */
const num = (name, labelText, value, min, max, extra = {}) => ({name, label: labelText, type: 'number', value, min, max, ...extra});
const txt = (name, labelText, value, extra = {}) => ({name, label: labelText, type: 'text', value, maxLength: 24, ...extra});
const choice = (name, labelText, value, options) => ({name, label: labelText, type: 'select', value, options});
const flag = (name, labelText, value) => ({name, label: labelText, type: 'checkbox', value});
const W_ = (v, min, max) => num('width', '폭 W (mm)', v, min, max);
const D_ = (v, min, max) => num('depth', '깊이 D (mm)', v, min, max);
const L_ = (v, min, max, text = '길이 L (mm)') => num('length', text, v, min, max);
const DIA = (v, min, max) => num('diameter', '지름 (mm)', v, min, max);
const UPPER = flag('upper', '상부장 점선 표시', true);
const rectFp = (w = 'width', d = 'depth') => (o) => box(0, 0, o[w], o[d]);
const size2 = (a = 'width', b = 'depth') => (o) => `${o[a]}×${o[b]}`;

export const BLOCK_CATEGORIES = Object.freeze([
 {id: 'furniture', label: '가구', layer: 'A-FURN', color: '#ff00ff'},
 {id: 'sanitary', label: '위생', layer: 'A-SANI', color: '#808080'},
 {id: 'kitchen', label: '주방', layer: 'A-KTCH', color: '#ff00ff'},
 {id: 'vehicle', label: '차량', layer: 'A-PARK', color: '#808080'},
 {id: 'landscape', label: '조경', layer: 'A-LAND', color: '#55dd77'},
 {id: 'symbol', label: '기호', layer: 'A-SYM', color: '#ffffff'},
 {id: 'office', label: '사무', layer: 'A-FURN', color: '#ff00ff'},
]);
const CATEGORY_MAP = new Map(BLOCK_CATEGORIES.map(c => [c.id, c]));

// 각 품목: build(o) → 원점 기준 객체[], footprint(o) → 그 객체들의 경계(시험·안내용), base → 기준점 설명.
const ITEM_LIST = [
 // 가구
 {category: 'furniture', id: 'bed-single', name: '싱글 침대', base: '머리판 쪽 왼쪽 모서리', params: [W_(1000, 700, 2000), L_(2000, 1600, 2600)], build: bed, footprint: rectFp('width', 'length'), summary: size2('width', 'length')},
 {category: 'furniture', id: 'bed-double', name: '더블 침대', base: '머리판 쪽 왼쪽 모서리', params: [W_(1400, 700, 2000), L_(2000, 1600, 2600)], build: bed, footprint: rectFp('width', 'length'), summary: size2('width', 'length')},
 {category: 'furniture', id: 'bed-queen', name: '퀸 침대', base: '머리판 쪽 왼쪽 모서리', params: [W_(1500, 700, 2000), L_(2000, 1600, 2600)], build: bed, footprint: rectFp('width', 'length'), summary: size2('width', 'length')},
 {category: 'furniture', id: 'sofa-2', name: '2인 소파', base: '등받이 쪽 왼쪽 모서리', params: [W_(1600, 1000, 2600), D_(850, 600, 1200)], build: o => sofa(o, 2), footprint: rectFp(), summary: size2()},
 {category: 'furniture', id: 'sofa-3', name: '3인 소파', base: '등받이 쪽 왼쪽 모서리', params: [W_(2100, 1500, 3200), D_(850, 600, 1200)], build: o => sofa(o, 3), footprint: rectFp(), summary: size2()},
 {category: 'furniture', id: 'dining-4', name: '4인 식탁+의자', base: '식탁 중심', params: [num('width', '식탁 길이 (mm)', 1200, 960, 2400), num('depth', '식탁 폭 (mm)', 800, 600, 1400)], build: o => dining(o, 4), footprint: o => box(-o.width / 2, -o.depth / 2 - 500, o.width / 2, o.depth / 2 + 500), summary: size2()},
 {category: 'furniture', id: 'dining-6', name: '6인 식탁+의자', base: '식탁 중심', params: [num('width', '식탁 길이 (mm)', 1800, 1440, 3000), num('depth', '식탁 폭 (mm)', 900, 600, 1400)], build: o => dining(o, 6), footprint: o => box(-o.width / 2, -o.depth / 2 - 500, o.width / 2, o.depth / 2 + 500), summary: size2()},
 {category: 'furniture', id: 'desk', name: '책상+의자', base: '벽 쪽 왼쪽 모서리', params: [W_(1200, 600, 2400), D_(600, 400, 1000)], build: homeDesk, footprint: o => box(0, 0, o.width, o.depth + 480), summary: size2()},
 {category: 'furniture', id: 'wardrobe-900', name: '옷장 900', base: '벽 쪽 왼쪽 모서리', params: [W_(900, 600, 1500), D_(600, 450, 800)], build: o => closet(o), footprint: rectFp(), summary: size2()},
 {category: 'furniture', id: 'wardrobe-1200', name: '옷장 1200', base: '벽 쪽 왼쪽 모서리', params: [W_(1200, 600, 1800), D_(600, 450, 800)], build: o => closet(o), footprint: rectFp(), summary: size2()},
 {category: 'furniture', id: 'closet', name: '붙박이장', base: '벽 쪽 왼쪽 모서리', params: [L_(2400, 900, 8000, '길이 L (벽을 따라, mm)'), D_(600, 450, 800)], build: o => closet({width: o.length, depth: o.depth}, 1200), footprint: rectFp('length', 'depth'), summary: size2('length', 'depth')},
 // 위생
 {category: 'sanitary', id: 'toilet-floor', name: '양변기(바닥)', base: '벽 쪽 가운데', params: [], build: toiletFloor, footprint: () => box(-250, 0, 250, 740), summary: () => '500×740'},
 {category: 'sanitary', id: 'toilet-wall', name: '양변기(벽걸이)', base: '벽 쪽 가운데', params: [], build: toiletWall, footprint: () => box(-180, 0, 180, 540), summary: () => '360×540'},
 {category: 'sanitary', id: 'basin-counter', name: '세면기(카운터)', base: '벽 쪽 왼쪽 모서리', params: [num('width', '카운터 길이 (mm)', 900, 600, 2400), D_(550, 450, 700)], build: basinCounter, footprint: rectFp(), summary: size2()},
 {category: 'sanitary', id: 'basin-wall', name: '세면기(벽걸이)', base: '벽 쪽 가운데', params: [], build: basinWall, footprint: () => box(-275, 0, 275, 450), summary: () => '550×450'},
 {category: 'sanitary', id: 'bathtub-1500', name: '욕조 1500', base: '벽 쪽 왼쪽 모서리', params: [W_(1500, 1100, 2000), D_(750, 650, 900)], build: bathtub, footprint: rectFp(), summary: size2()},
 {category: 'sanitary', id: 'bathtub-1700', name: '욕조 1700', base: '벽 쪽 왼쪽 모서리', params: [W_(1700, 1100, 2000), D_(750, 650, 900)], build: bathtub, footprint: rectFp(), summary: size2()},
 {category: 'sanitary', id: 'shower-900', name: '샤워부스 900', base: '벽 쪽 왼쪽 모서리', params: [W_(900, 700, 1600), D_(900, 700, 1600)], build: shower, footprint: rectFp(), summary: size2()},
 {category: 'sanitary', id: 'urinal', name: '소변기', base: '벽 쪽 가운데', params: [], build: urinal, footprint: () => box(-200, 0, 200, 350), summary: () => '400×350'},
 {category: 'sanitary', id: 'toilet-accessible', name: '장애인 화장실 변기+손잡이', base: '벽 쪽 변기 중심 (고정 손잡이 = 왼쪽 벽)', params: [], build: toiletAccessible, footprint: () => box(-370, 0, 385, 800), summary: () => '손잡이 간격 700'},
 // 주방
 {category: 'kitchen', id: 'sink-straight', name: '싱크대 ㅡ자', base: '벽 쪽 왼쪽 모서리', params: [L_(2400, 1000, 6000), D_(600, 500, 800), UPPER], build: sinkStraight, footprint: rectFp('length', 'depth'), summary: size2('length', 'depth')},
 {category: 'kitchen', id: 'sink-l', name: '싱크대 ㄱ자', base: '두 벽이 만나는 안쪽 모서리', params: [L_(2400, 1400, 6000, '가로 길이 A (mm)'), num('side', '세로 길이 B (mm)', 1800, 1100, 5000), D_(600, 500, 800), UPPER], build: sinkL, footprint: rectFp('length', 'side'), summary: size2('length', 'side'),
  check: (o) => { if (o.length < o.depth + 900) throw Error(`가로 길이 A 는 깊이 + 900 = ${o.depth + 900} mm 이상이어야 개수대가 들어갑니다.`); if (o.side < o.depth + 600) throw Error(`세로 길이 B 는 깊이 + 600 = ${o.depth + 600} mm 이상이어야 합니다.`); }},
 {category: 'kitchen', id: 'range', name: '가스레인지/인덕션', base: '벽 쪽 왼쪽 모서리', params: [choice('kind', '종류', 'gas', [['gas', '가스레인지 (화구 4)'], ['induction', '인덕션 (3구)']]), W_(600, 450, 900), D_(520, 400, 700)], build: range, footprint: rectFp(), summary: size2()},
 {category: 'kitchen', id: 'fridge', name: '냉장고 양문형', base: '벽 쪽 왼쪽 모서리', params: [W_(910, 700, 1200), D_(920, 600, 1000)], build: fridge, footprint: rectFp(), summary: size2()},
 {category: 'kitchen', id: 'dishwasher', name: '식기세척기', base: '벽 쪽 왼쪽 모서리', params: [W_(600, 450, 650), D_(600, 500, 650)], build: dishwasher, footprint: rectFp(), summary: size2()},
 // 차량 (길이 방향 = Y, 앞 = +Y)
 {category: 'vehicle', id: 'car', name: '승용차 (4.7m)', base: '차 중심', params: [L_(4700, 3000, 6500, '차 길이 (mm)'), num('width', '차 폭, 미러 제외 (mm)', 1860, 1400, 2200)], build: o => car(o), footprint: o => box(-o.width / 2 - mirrorSize(o.width), -o.length / 2, o.width / 2 + mirrorSize(o.width), o.length / 2), summary: size2('width', 'length')},
 {category: 'vehicle', id: 'car-light', name: '경차', base: '차 중심', params: [L_(3600, 3000, 4000, '차 길이 (mm)'), num('width', '차 폭, 미러 제외 (mm)', 1600, 1400, 1800)], build: o => car(o, 0.2), footprint: o => box(-o.width / 2 - mirrorSize(o.width), -o.length / 2, o.width / 2 + mirrorSize(o.width), o.length / 2), summary: size2('width', 'length')},
 {category: 'vehicle', id: 'parking-accessible', name: '장애인 주차 표시', base: '표시 중심', params: [num('size', '표시 크기 (정사각형 한 변, mm)', 1500, 800, 3000)], build: accessibleParking, footprint: o => box(-o.size / 2, -o.size / 2, o.size / 2, o.size / 2), summary: o => `${o.size}×${o.size}`},
 {category: 'vehicle', id: 'bicycle', name: '자전거', base: '자전거 중심', params: [L_(1750, 1400, 2000), num('width', '핸들 폭 (mm)', 600, 400, 800)], build: bicycle, footprint: o => box(-o.width / 2, -o.length / 2, o.width / 2, o.length / 2), summary: size2('width', 'length')},
 // 조경
 {category: 'landscape', id: 'tree', name: '교목', base: '줄기 중심', params: [DIA(3000, 1000, 12000)], build: tree, footprint: o => box(-o.diameter / 2, -o.diameter / 2, o.diameter / 2, o.diameter / 2), summary: o => `Ø${o.diameter}`},
 {category: 'landscape', id: 'shrub', name: '관목', base: '중심', params: [DIA(1000, 300, 3000)], build: shrub, footprint: o => box(-o.diameter / 2, -o.diameter / 2, o.diameter / 2, o.diameter / 2), summary: o => `Ø${o.diameter}`},
 {category: 'landscape', id: 'lawn', name: '잔디 표시 기호', base: '바닥선 가운데', params: [W_(600, 200, 3000)], build: lawn, footprint: o => box(-o.width / 2, 0, o.width / 2, o.width * 0.45), summary: o => `폭 ${o.width}`},
 {category: 'landscape', id: 'bench', name: '벤치', base: '등 쪽 왼쪽 모서리', params: [W_(1800, 900, 4000), D_(450, 300, 800)], build: bench, footprint: rectFp(), summary: size2()},
 // 기호 (scaled: 기본값은 1:100 기준이고 현재 도면 축척에 비례해 커진다)
 {category: 'symbol', id: 'north', name: '방위표', base: '원 중심', params: [num('diameter', '원 지름 (mm)', 1500, 50, 50000, {scaled: true})], build: northArrow, footprint: o => box(-o.diameter / 2, -o.diameter / 2, o.diameter / 2, o.diameter * 0.84), summary: o => `Ø${o.diameter}`},
 {category: 'symbol', id: 'level', name: '레벨 표시', base: '삼각형 아래 꼭짓점 (그 높이)', params: [txt('text', '표시 문자', 'FL ±0'), num('size', '삼각형 크기 (mm)', 300, 10, 20000, {scaled: true}), num('textHeight', '문자 높이 (mm)', 250, 10, 20000, {scaled: true})], build: levelMark,
  footprint: o => { const {ht, pad, tw} = levelLayout(o); return box(-o.size / 2, 0, o.size / 2 + 2 * pad + tw, o.text ? ht + pad + o.textHeight : ht); }, summary: o => o.text || '레벨'},
 {category: 'symbol', id: 'section', name: '단면 표시', base: '원 중심 (절단선은 +X, 보는 방향은 +Y)', params: [txt('label', '단면 기호', 'A', {maxLength: 6, required: true}), txt('sheet', '도면 번호 (비우면 없음)', '', {maxLength: 10}), num('diameter', '원 지름 (mm)', 1000, 50, 50000, {scaled: true}), num('cut', '절단선 길이 (0 = 없음, mm)', 1500, 0, 100000, {scaled: true})], build: sectionMark,
  footprint: o => union(box(-o.diameter / 2, -o.diameter / 2, o.diameter / 2 + o.cut, o.diameter * 0.8), ...sectionTexts(o).map(([v, y, h]) => textBox(v, 0, y, h))), summary: o => o.sheet ? `${o.label}/${o.sheet}` : o.label},
 {category: 'symbol', id: 'entrance', name: '출입 방향 화살표', base: '화살표 끝 (들어가는 방향 = +Y)', params: [L_(1500, 100, 50000, '화살표 길이 (mm)'), num('width', '머리 폭 (mm)', 600, 20, 20000, {scaled: true}), txt('text', '문자 (비우면 없음)', '주출입구'), num('textHeight', '문자 높이 (mm)', 250, 10, 20000, {scaled: true})], build: entranceArrow,
  footprint: o => union(box(-o.width / 2, -o.length, o.width / 2, 0), textBox(o.text, 0, -o.length - 1.4 * o.textHeight, o.textHeight)), summary: o => o.text || '화살표',
  check: (o) => { if (o.length < o.width) throw Error('화살표 길이는 머리 폭 이상이어야 합니다.'); }},
 // 사무
 {category: 'office', id: 'office-desk-1400', name: '사무용 책상 1400', base: '벽 쪽 왼쪽 모서리', params: [W_(1400, 1000, 2000), D_(700, 600, 900)], build: officeDesk, footprint: o => box(0, 0, o.width, o.depth + 510), summary: size2()},
 {category: 'office', id: 'office-desk-1600', name: '사무용 책상 1600', base: '벽 쪽 왼쪽 모서리', params: [W_(1600, 1000, 2000), D_(800, 600, 900)], build: officeDesk, footprint: o => box(0, 0, o.width, o.depth + 510), summary: size2()},
 {category: 'office', id: 'meeting', name: '회의 테이블', base: '테이블 중심', params: [L_(2400, 1200, 8000, '테이블 길이 (mm)'), num('depth', '테이블 폭 (mm)', 1200, 800, 2000), flag('ends', '양 끝에도 의자', false)], build: meetingTable,
  footprint: o => box(-o.length / 2 - (o.ends ? 500 : 0), -o.depth / 2 - 500, o.length / 2 + (o.ends ? 500 : 0), o.depth / 2 + 500), summary: o => `${o.length}×${o.depth} · ${meetingSeats(o.length) * 2 + (o.ends ? 2 : 0)}인`},
 {category: 'office', id: 'partition', name: '파티션', base: '한쪽 끝 아래 모서리', params: [L_(1200, 300, 6000), num('thickness', '두께 (mm)', 50, 20, 150)], build: partition, footprint: rectFp('length', 'thickness'), summary: size2('length', 'thickness')},
];
// 기호의 숫자 매개변수(크기·문자 높이·길이)는 모두 도면 축척을 따른다.
for (const item of ITEM_LIST) for (const p of item.params) if (item.category === 'symbol' && p.type === 'number') p.scaled = true;
export const BLOCK_ITEMS = Object.freeze(ITEM_LIST.map(item => Object.freeze({...item, blockName: `${CATEGORY_MAP.get(item.category).label}-${item.name}`})));
const ITEM_MAP = new Map(BLOCK_ITEMS.map(item => [item.id, item]));
export const blockItem = (id) => ITEM_MAP.get(id) || null;
export const itemsOf = (category) => BLOCK_ITEMS.filter(item => item.category === category);

/** 품목 기본값. scaled 매개변수(기호 크기·문자 높이)는 1:100 기준값을 도면 축척에 비례시킨다. */
export function itemDefaults(item, denominator = 100) {
 const k = (Number(denominator) > 0 ? Number(denominator) : 100) / 100;
 return Object.fromEntries(item.params.map(p => [p.name, p.scaled ? Math.round(p.value * k * 100) / 100 : p.value]));
}
/** 폼 값(문자열 포함) → 검사된 매개변수. 범위를 벗어나면 한국어 오류. */
export function normalizeParams(item, values = {}, denominator = 100) {
 const defaults = itemDefaults(item, denominator), o = {};
 for (const p of item.params) {
  const raw = values[p.name] === undefined ? defaults[p.name] : values[p.name];
  if (p.type === 'number') {
   const n = typeof raw === 'number' ? raw : Number(String(raw ?? '').trim());
   if (String(raw ?? '').trim() === '' || !Number.isFinite(n)) throw Error(`${p.label}에는 숫자를 입력하세요.`);
   if (n < p.min || n > p.max) throw Error(`${p.label}은(는) ${p.min}~${p.max} 사이로 입력하세요.`);
   o[p.name] = n;
  } else if (p.type === 'checkbox') o[p.name] = isChecked(raw);
  else if (p.type === 'select') o[p.name] = p.options.some(([v]) => v === raw) ? raw : p.value;
  else {
   const value = String(raw ?? '').replace(/[\r\n\t]+/g, ' ').trim();
   if (value.length > (p.maxLength || 24)) throw Error(`${p.label}은(는) ${p.maxLength || 24}자 이하로 입력하세요.`);
   if (p.required && !value) throw Error(`${p.label}을(를) 입력하세요.`);
   o[p.name] = value;
  }
 }
 item.check?.(o);
 return o;
}
/** 원점 기준 객체 목록(레이어 없음). */
export function buildItem(id, values = {}, denominator = 100) {
 const item = typeof id === 'string' ? blockItem(id) : id;
 if (!item) throw Error(`블록 모음에 없는 품목입니다: ${id}`);
 return item.build(normalizeParams(item, values, denominator));
}
export function itemFootprint(id, values = {}, denominator = 100) {
 const item = typeof id === 'string' ? blockItem(id) : id;
 return item.footprint(normalizeParams(item, values, denominator));
}

/* ───────────── 배치: 대칭(문자는 읽히게) → 회전 → 이동 ───────────── */
const swapAlign = (align) => align === 'center' ? 'center' : (align || 'left') === 'left' ? 'right' : 'left';
function fixMirroredText(e) {
 // G.mirror(세로축) 는 문자 회전을 -r+180 으로 뒤집는다. AutoCAD MIRRTEXT=0 처럼 -r 로 두고 정렬만 좌우를 바꾼다.
 if (e.type === 'text') return {...e, rotation: (e.rotation || 0) - 180, align: swapAlign(e.align)};
 return Array.isArray(e.entities) ? {...e, entities: e.entities.map(fixMirroredText)} : e;
}
function readableText(e) {
 if (e.type !== 'text') return Array.isArray(e.entities) ? {...e, entities: e.entities.map(readableText)} : e;
 const r = e.rotation || 0, a = ((r % 360) + 360) % 360;
 if (!(a > 90 + 1e-7 && a <= 270 + 1e-7)) return e;
 // 180° 돌려도 같은 자리를 덮도록 위쪽으로 (높이 + 여러 줄 아래 여백) 만큼 옮긴다.
 const lines = String(e.text).split('\n').length, shift = e.height - e.height * (lines - 1) * 1.35;
 return {...e, rotation: r - 180, position: G.add(e.position, G.polar(shift, r + 90)), align: swapAlign(e.align)};
}
/** 원점 기준 객체를 배율 → 대칭(세로축) → 회전 → 이동. readable: 뒤집힌 문자를 바로 세운다. */
export function placeEntities(entities, {position = O, rotation = 0, mirror = false, scale = 1, readable = true} = {}) {
 return entities.map(src => {
  let e = scale !== 1 ? G.resize(src, O, scale) : src;
  if (mirror) e = fixMirroredText(G.mirror(e, O, P(0, 1)));
  if (rotation) e = G.rotate(e, O, rotation);
  if (readable) e = readableText(e);
  return G.translate(e, position.x, position.y);
 });
}
const withLayer = (e, layer) => ({...e, layer, ...(Array.isArray(e.entities) ? {entities: e.entities.map(child => withLayer(child, layer))} : {})});
const normAngle = (a) => { const v = ((Number(a) || 0) % 360 + 360) % 360; return Math.abs(v - 360) < 1e-9 ? 0 : v; };

/** 삽입할 블록 하나. name = '<분류>-<이름>', category = 'LIBRARY', attributes = {libraryId, ...매개변수}. */
export function libraryBlock(id, values = {}, {position = O, rotation = 0, mirror = false, layer = 'default', denominator = 100} = {}) {
 const item = typeof id === 'string' ? blockItem(id) : id;
 if (!item) throw Error(`블록 모음에 없는 품목입니다: ${id}`);
 const params = normalizeParams(item, values, denominator);
 return blockFrom({id: item.id, name: item.blockName, attributes: params}, item.build(params), {position, rotation, mirror, layer, readable: true});
}
/* 609 매개변수 블록을 공유 정의로: 같은 품목·같은 값이면 정의 하나를 같이 쓰고, 삽입본은 위치·회전·대칭만 갖는다(문 500개 = 정의 1개).
   읽기 방향: 거꾸로 보일 회전(90° 초과 270° 이하)은 문자를 미리 바로 세운 정의를 따로 둔다. 일람표가 읽는 category·attributes 는 그대로. */
export function libraryReference(definitions, item, attributes, local, {position = O, rotation = 0, mirror = false, layer, readable = true} = {}) {
 const r = normAngle(rotation), flip = readable && !mirror && r > 90 + 1e-9 && r <= 270 + 1e-9;
 const build = () => flip ? placeEntities(local, {rotation: 180, readable: true}).map(e => G.rotate(e, O, -180)) : local;
 const {key, definition, ref} = parametricReference(definitions, 'LIB:' + item.id, {...attributes, ...(flip ? {readable: 'flip'} : {})}, build, {position, rotation: r, mirror, layer, name: item.blockName});
 ref.category = 'LIBRARY';
 ref.attributes = {libraryId: item.id, ...attributes, ...(mirror ? {mirrored: true} : {})};
 delete ref.blockParameters;
 return {key, definition, ref};
}
function blockFrom({id, name, attributes}, local, {position, rotation = 0, mirror = false, layer, scale = 1, readable = true}) {
 const entities = placeEntities(local, {position, rotation, mirror, scale, readable}).map(e => withLayer(e, layer));
 return {type: 'block', name, category: 'LIBRARY', layer, position: P(position.x, position.y), rotation: normAngle(rotation), attributes: {libraryId: id, ...attributes, ...(mirror ? {mirrored: true} : {})}, entities};
}

/* ───────────── 내 라이브러리(LIBRARY) 읽기·내보내기·가져오기 ───────────── */
const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
// 도면끼리 옮기면 안 되는 연결 정보(벽 연동·표 연동·공유 정의·외부 파일 참조·건축 매개변수 재생성).
const LINK_KEYS = new Set(['id', 'layer', 'hostWall', 'roomBoundary', 'scheduleKind', 'scheduleIds', 'sharedBlock', 'xref', 'lineWallHost', 'parameters', 'libraryCommand', 'wallName', 'designGroup', 'designAlternative', 'parcelRole', 'sheetDecoration', 'clipMasks']);
const ARCH_CATEGORIES = new Set(['DOOR', 'WINDOW', 'OPENINGTAG', 'STAIR', 'CURVESTAIR', 'COLUMN', 'ELEVATOR', 'RAMP', 'INSULATION', 'TITLE', 'ARROW']);
const ALLOWED_TYPES = new Set(['line', 'polyline', 'rectangle', 'circle', 'arc', 'ellipse', 'point', 'text', 'hatch', 'dimension', 'block']);
const isPlainObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const jsonClone = (v) => v === undefined ? undefined : JSON.parse(JSON.stringify(v));
const defaultId = () => globalThis.crypto?.randomUUID?.() ?? `lib-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
const safeGet = (storage, key) => { try { return storage?.getItem?.(key) ?? null; } catch { return null; } };

export function cleanBlockName(value, max = LIBRARY_LIMITS.maxNameLength) {
 const name = String(value ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max).trim();
 return name && !UNSAFE_KEYS.has(name) ? name : '';
}
const cleanText = (value, max) => String(value ?? '').replace(/[\u0000-\u0008\u000b-\u001f\u007f]+/g, ' ').trim().slice(0, max);

/** localStorage 의 내 라이브러리. ok=false 는 저장값이 손상돼 읽지 못했다는 뜻(이때는 덮어쓰지 않는다). */
export function readLibraryStore(storage) {
 const parse = (key) => {
  const raw = safeGet(storage, key);
  if (raw == null || raw === '') return {value: {}, ok: true};
  try { const value = JSON.parse(raw); return isPlainObject(value) ? {value, ok: true} : {value: {}, ok: false}; } catch { return {value: {}, ok: false}; }
 };
 const library = parse(LIBRARY_STORAGE_KEY), meta = parse(LIBRARY_META_KEY);
 return {library: library.value, meta: meta.ok ? meta.value : {}, ok: library.ok};
}

/** 내보내기용 객체: id·레이어·연결 정보를 뺀 순수 도형(레이어는 넣는 도면에서 다시 정한다). */
function portable(e) {
 const out = {};
 for (const [key, value] of Object.entries(e)) {
  if (LINK_KEYS.has(key) || UNSAFE_KEYS.has(key) || key.startsWith('_')) continue;
  if (key === 'category' && ARCH_CATEGORIES.has(value)) continue;
  out[key] = key === 'entities' && Array.isArray(value) ? value.map(portable) : jsonClone(value);
 }
 return out;
}
const deepCount = (list) => { let n = 0; const stack = [...list]; while (stack.length) { const e = stack.pop(); n++; if (Array.isArray(e?.entities)) stack.push(...e.entities); } return n; };

/**
 * 내보낼 블록 모으기.
 * library/docLibrary: {이름: 객체[]} · selection: 도면에서 고른 block 객체 · definitions: doc.blocks({name, entities})
 * include: {library, selection, definitions} · filter: "문,창" 처럼 쉼표로 여러 글자(하나라도 들어 있으면 포함).
 */
export function collectExportBlocks({library = {}, meta = {}, docLibrary = {}, selection = [], definitions = [], doc = null, include = {library: true, selection: true, definitions: false}, filter = ''} = {}) {
 const words = String(filter || '').split(',').map(w => w.trim().toLowerCase()).filter(Boolean);
 const wanted = (name) => !words.length || words.some(w => name.toLowerCase().includes(w));
 const out = [], seen = new Map();
 const push = (rawName, entities, category, source, description = '') => {
  const name = cleanBlockName(rawName) || '블록';
  if (!wanted(name) || !Array.isArray(entities) || !entities.length) return;
  const clean = entities.map(portable), key = JSON.stringify(clean);
  let final = name, k = 2;
  while (seen.has(final)) { if (seen.get(final) === key) return; final = `${name} (${k++})`; }   // 같은 이름·같은 모양은 한 번만
  seen.set(final, key);
  out.push({name: final, category, description, source, entities: clean});
 };
 const materialize = (e) => { if (e?.sharedBlock && doc?.sharedBlocks) { try { return G.materializeSharedDrawingReference(doc, e); } catch { return e; } } return e; };
 if (include.library) {
  const names = new Set([...Object.keys(library), ...Object.keys(docLibrary || {})]);
  for (const name of [...names].sort((a, b) => a.localeCompare(b, 'ko', {numeric: true}))) {
   const entities = hasOwn(library, name) ? library[name] : docLibrary[name];
   push(name, Array.isArray(entities) ? entities.map(materialize) : null, cleanText(meta?.[name]?.category, 40) || '내 라이브러리', 'library', cleanText(meta?.[name]?.description, 500));
  }
 }
 if (include.selection) for (const raw of selection) {
  if (raw?.type !== 'block' || raw.xref || raw.table) continue;
  const e = materialize(raw), children = e.entities || [];
  const b = G.bounds(children), base = e.position && Number.isFinite(e.position.x) && Number.isFinite(e.position.y) ? e.position : b ? P(b.minX, b.minY) : O;
  const libraryItem = e.category === 'LIBRARY' && blockItem(e.attributes?.libraryId);
  push(e.name, children.map(child => G.translate(child, -base.x, -base.y)), libraryItem ? CATEGORY_MAP.get(libraryItem.category).label : '선택 블록', 'selection');
 }
 if (include.definitions) for (const def of definitions) push(def?.name, def?.entities, '도면 블록', 'definition');
 return out;
}

/** 공유 파일 내용(버전 1). */
export function buildLibraryFile(blocks, {title = '', description = '', now = new Date(), makeId = defaultId} = {}) {
 return {
  format: LIBRARY_FORMAT, version: LIBRARY_VERSION, title: cleanText(title, 120), description: cleanText(description, 1000), units: 'mm',
  exportedAt: now.toISOString(), blockCount: blocks.length,
  blocks: blocks.map(b => { const bb = G.bounds(b.entities); return {id: makeId(), name: b.name, category: b.category || '', description: b.description || '', source: b.source || '', basePoint: {x: 0, y: 0}, size: bb ? {width: +(bb.maxX - bb.minX).toFixed(3), height: +(bb.maxY - bb.minY).toFixed(3)} : null, entityCount: deepCount(b.entities), entities: b.entities}; }),
 };
}

function countWithin(list, limit, depthLimit, depth = 1) {
 let n = 0;
 for (const e of list) {
  n++;
  if (n > limit) return n;
  if (Array.isArray(e?.entities)) {
   if (depth >= depthLimit) throw Error(`블록 중첩이 ${depthLimit}단계를 넘습니다.`);
   n += countWithin(e.entities, limit - n, depthLimit, depth + 1);
   if (n > limit) return n;
  }
 }
 return n;
}
function sanitizeEntity(raw, makeId) {
 if (!isPlainObject(raw) || typeof raw.type !== 'string') throw Error('객체 형식이 아닙니다.');
 if (!ALLOWED_TYPES.has(raw.type)) throw Error(`가져올 수 없는 객체 종류입니다: ${cleanText(raw.type, 20)}`);
 const out = {};
 for (const [key, value] of Object.entries(raw)) {
  if (LINK_KEYS.has(key) || UNSAFE_KEYS.has(key) || key.startsWith('_')) continue;
  if (key === 'category' && ARCH_CATEGORIES.has(value)) continue;
  if (key === 'entities') continue;
  out[key] = jsonClone(value);
 }
 if (raw.type === 'block') {
  if (!Array.isArray(raw.entities) || !raw.entities.length) throw Error('비어 있는 안쪽 블록이 있습니다.');
  out.name = typeof raw.name === 'string' ? cleanText(raw.name, 200) : '블록';
  out.entities = raw.entities.map(child => sanitizeEntity(child, makeId));
 }
 out.id = makeId();   // id 는 파일 것을 믿지 않고 새로 만든다
 return out;
}
let probe = null;
/** 엔진과 같은 규칙으로 검사(좌표·반지름·문자·해치·치수…). 실패하면 엔진의 한국어 오류를 던진다. */
function validateWithEngine(entities) {
 probe ??= new DrawingEngine();
 probe.validate({version: 2, units: 'mm', layers: [{id: 'default', name: '0', color: '#ffffff', visible: true, locked: false}], blocks: [], entities: [{id: 'probe', type: 'block', name: 'probe', layer: 'default', entities: entities.map(e => withLayer(e, 'default'))}]});
 if (!G.bounds(entities)) throw Error('크기를 계산할 수 없는 블록입니다.');
}

/**
 * 공유 파일 읽기·검사. 파일 전체 문제(JSON 아님·형식/버전 불일치·크기 초과)는 거부하고,
 * 블록 하나의 문제는 그 블록만 건너뛰어 skipped 에 이유를 남긴다.
 */
export function parseLibraryFile(text, {limits = LIBRARY_LIMITS, makeId = defaultId} = {}) {
 if (typeof text !== 'string') throw Error('가져올 파일 내용을 읽지 못했습니다.');
 if (text.length > limits.maxBytes) throw Error(`파일이 너무 큽니다(${(text.length / 1048576).toFixed(1)} MB). 블록 라이브러리 파일은 ${(limits.maxBytes / 1048576).toFixed(0)} MB 까지 가져옵니다.`);
 let data;
 try { data = JSON.parse(text.replace(/^﻿/, '')); } catch { throw Error('JSON 파일이 아니거나 손상되었습니다. LIBEXPORT 로 만든 바른 CAD 블록 라이브러리(.json)를 고르세요.'); }
 if (!isPlainObject(data) || data.format !== LIBRARY_FORMAT) throw Error(`바른 CAD 블록 라이브러리 파일이 아닙니다(format 이 "${LIBRARY_FORMAT}" 가 아님).`);
 if (!Number.isInteger(data.version) || data.version < 1) throw Error('블록 라이브러리 파일의 버전 정보가 올바르지 않습니다.');
 if (data.version > LIBRARY_VERSION) throw Error(`더 새로운 형식(v${data.version})의 파일입니다. 바른 CAD 를 업데이트한 뒤 가져오세요.`);
 if (!Array.isArray(data.blocks) || !data.blocks.length) throw Error('파일에 블록이 없습니다.');
 if (data.blocks.length > limits.maxBlocks) throw Error(`블록이 너무 많습니다(${data.blocks.length}개). 한 파일에 ${limits.maxBlocks}개까지 가져옵니다.`);
 let total = 0;
 for (const raw of data.blocks) {
  if (!Array.isArray(raw?.entities)) continue;
  let n;
  try { n = countWithin(raw.entities, limits.maxTotalEntities - total + 1, limits.maxDepth); } catch { n = 0; }   // 중첩 초과는 아래에서 그 블록만 건너뛴다
  total += n;
  if (total > limits.maxTotalEntities) throw Error(`파일 전체 객체가 ${limits.maxTotalEntities.toLocaleString('ko-KR')}개를 넘습니다. 나눠서 내보내 주세요.`);
 }
 const blocks = [], skipped = [];
 data.blocks.forEach((raw, index) => {
  const shown = cleanText(raw?.name, 80) || `#${index + 1}`;
  try {
   if (!isPlainObject(raw)) throw Error('블록 형식이 아닙니다.');
   const name = cleanBlockName(raw.name);
   if (!name) throw Error('이름이 없거나 쓸 수 없는 이름입니다.');
   if (!Array.isArray(raw.entities) || !raw.entities.length) throw Error('객체가 없습니다.');
   const count = countWithin(raw.entities, limits.maxEntitiesPerBlock, limits.maxDepth);
   if (count > limits.maxEntitiesPerBlock) throw Error(`객체가 ${limits.maxEntitiesPerBlock.toLocaleString('ko-KR')}개를 넘습니다.`);
   const entities = raw.entities.map(e => sanitizeEntity(e, makeId));
   validateWithEngine(entities);
   blocks.push({name, category: cleanText(raw.category, 40), description: cleanText(raw.description, 500), entities});
  } catch (error) {
   skipped.push({index, name: shown, reason: error?.message || String(error)});
  }
 });
 if (!blocks.length) throw Error(`가져올 수 있는 블록이 없습니다. ${skipped[0] ? `「${skipped[0].name}」: ${skipped[0].reason}` : ''}`.trim());
 return {title: cleanText(data.title, 120), description: cleanText(data.description, 1000), version: data.version, blocks, skipped};
}

/**
 * 가져온 블록을 기존 라이브러리에 더한다. 기존 항목은 그대로 두고(새 객체), 같은 이름은
 * conflict='rename' 이면 "이름 (2)" 로, 'skip' 이면 건너뛴다. reserved: 도면에만 있는 LIBRARY 이름 등.
 */
export function mergeLibrary(library, meta, blocks, {conflict = 'rename', reserved = [], makeId = defaultId, now = new Date(), from = ''} = {}) {
 const next = {...library}, nextMeta = {...meta}, taken = new Set([...Object.keys(next), ...reserved]);
 const added = [], renamed = [], skipped = [];
 for (const block of blocks) {
  let name = block.name;
  if (taken.has(name)) {
   if (conflict === 'skip') { skipped.push({name, reason: '같은 이름이 이미 있음'}); continue; }
   let k = 2, candidate;
   do { candidate = `${block.name.slice(0, LIBRARY_LIMITS.maxNameLength - 6)} (${k++})`; } while (taken.has(candidate) && k < 10000);
   if (taken.has(candidate)) { skipped.push({name, reason: '새 이름을 만들 수 없음'}); continue; }
   renamed.push({from: name, to: candidate});
   name = candidate;
  }
  taken.add(name);
  next[name] = block.entities;
  nextMeta[name] = {libraryId: makeId(), category: block.category || '', description: block.description || '', source: 'import', from: cleanText(from, 120), importedAt: now.toISOString()};
  added.push(name);
 }
 return {library: next, meta: nextMeta, added, renamed, skipped};
}

/** 파일 내용 → 검사 → 내 라이브러리(localStorage)에 더하기. 실패하면 저장소를 바꾸지 않는다. */
export function importLibraryText(storage, text, {conflict = 'rename', reserved = [], limits = LIBRARY_LIMITS, makeId = defaultId, now = new Date()} = {}) {
 if (!storage?.getItem || !storage?.setItem) throw Error('블록을 보관할 저장소를 쓸 수 없습니다.');
 const parsed = parseLibraryFile(text, {limits, makeId});
 const store = readLibraryStore(storage);
 if (!store.ok) throw Error('기존 내 라이브러리 저장값을 읽을 수 없어 가져오기를 멈췄습니다. 기존 항목을 지키려고 아무것도 바꾸지 않았습니다.');
 const merged = mergeLibrary(store.library, store.meta, parsed.blocks, {conflict, reserved, makeId, now, from: parsed.title});
 if (merged.added.length) {
  try { storage.setItem(LIBRARY_STORAGE_KEY, JSON.stringify(merged.library)); }
  catch { throw Error('저장 공간이 부족해 가져오지 못했습니다. 기존 항목은 그대로입니다. 필요한 블록만 골라 다시 내보내 보세요.'); }
  try { storage.setItem(LIBRARY_META_KEY, JSON.stringify(merged.meta)); } catch { /* 분류 정보는 없어도 된다 */ }
 }
 return {title: parsed.title, added: merged.added, renamed: merged.renamed, skipped: merged.skipped, invalid: parsed.skipped};
}

/* ───────────── 파일 저장·열기 (ctx 로 받거나 기본 도우미) ───────────── */
async function saveTextFile(ctx, name, text) {
 if (typeof ctx.downloadText === 'function') return ctx.downloadText(name, text, 'application/json');
 try { return cardDownloadText(name, text, 'application/json'); }
 catch (error) { throw Error(`파일 저장 기능을 쓸 수 없는 화면입니다. ${error?.message || ''}`.trim()); }
}
function openTextFile(ctx, accept) {
 if (typeof ctx.openTextFile === 'function') return ctx.openTextFile(accept);
 const doc = globalThis.document;
 if (!doc?.createElement) throw Error('파일을 고를 수 있는 화면이 없습니다(파일 열기 기능 없음).');
 return new Promise((resolve) => {
  const input = doc.createElement('input');let done = false;
  const finish = (value) => { if (done) return; done = true; input.remove?.(); resolve(value); };
  input.type = 'file'; input.accept = accept; input.hidden = true;
  input.onchange = () => finish(input.files?.[0] || null);
  input.oncancel = () => finish(null);
  doc.body?.append?.(input); input.click();
 });
}
async function readPickedText(file, maxBytes) {
 if (file == null) return null;
 if (typeof file === 'string') return file;
 if (Number.isFinite(file.size) && file.size > maxBytes) throw Error(`파일이 너무 큽니다(${(file.size / 1048576).toFixed(1)} MB). 블록 라이브러리 파일은 ${(maxBytes / 1048576).toFixed(0)} MB 까지 가져옵니다.`);
 if (typeof file.text === 'function') return await file.text();
 if (typeof file.text === 'string') return file.text;
 throw Error('고른 파일을 읽지 못했습니다.');
}
const dateStamp = (d) => `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;

/* ───────────── 명령 ───────────── */
const ROTATIONS = [['0', '0°'], ['90', '90° (반시계)'], ['180', '180°'], ['270', '270°'], ['custom', '직접 입력한 각도'], ['pick', '삽입점 다음에 방향(+X)을 클릭']];
const PREVIEW_LIMIT = 1500;

export function installBlockLibrary(ctx) {
 const storage = () => ctx.storage ?? globalThis.localStorage;
 const denominator = () => Number(ctx.getSettings?.()?.denominator) || 100;
 const loadLast = () => { try { const v = JSON.parse(storage()?.getItem(BLOCKLIB_LAST_KEY) || '{}'); return isPlainObject(v) ? v : {}; } catch { return {}; } };
 const saveLast = (patch) => { try { storage()?.setItem(BLOCKLIB_LAST_KEY, JSON.stringify({...loadLast(), ...patch})); } catch { /* 기억 실패는 무시 */ } };
 const docLibrary = () => { const lib = ctx.doc?.()?.library; return isPlainObject(lib) ? lib : {}; };
 const userLibrary = () => {
  const store = readLibraryStore(storage()), lib = docLibrary(), out = new Map();
  for (const [name, entities] of Object.entries(lib)) if (Array.isArray(entities) && entities.length) out.set(name, entities);
  for (const [name, entities] of Object.entries(store.library)) if (Array.isArray(entities) && entities.length) out.set(name, entities);   // LIBRARY 와 같이 저장소가 우선
  return {entries: out, meta: store.meta};
 };
 const userItem = (name) => {
  const {entries, meta} = userLibrary(), entities = entries.get(name);
  if (!entities) return null;
  return {id: `user:${name}`, user: true, name, blockName: name, category: null, base: '저장할 때의 기준점', meta: meta?.[name],
   params: [num('scale', '배율', 1, 0.001, 1000)], build: (o) => o.scale === 1 ? entities : entities.map(e => G.resize(e, O, o.scale))};
 };
 const resolveItem = (id) => typeof id === 'string' && id.startsWith('user:') ? userItem(id.slice(5)) : blockItem(id);
 const writable = (id) => {
  const layer = ctx.layers?.().find(l => l.id === id);
  if (layer && (layer.locked || layer.visible === false || layer.frozen)) throw Error(`"${layer.name}" 레이어가 잠김/숨김이라 넣을 수 없습니다.`);
  return id;
 };
 const currentLayer = () => ctx.activeLayer?.() ?? ctx.layers?.()[0]?.id ?? 'default';
 const categoryLayer = (item, mode) => { const category = item.category && CATEGORY_MAP.get(item.category); return mode !== 'current' && category && typeof ctx.ensureLayer === 'function' ? category : null; };
 /** 넣기 전에 잠김/숨김만 확인한다(없는 표준 레이어는 첫 삽입 때 만든다 → Esc 로 끝내면 레이어도 생기지 않음). */
 const checkLayer = (item, mode) => { const category = categoryLayer(item, mode); if (!category) return writable(currentLayer()); const found = ctx.layers?.().find(l => l.name === category.layer); if (found) writable(found.id); return null; };
 const targetLayer = (item, mode) => {
  const category = categoryLayer(item, mode);
  if (category) return {id: writable(ctx.ensureLayer(category.layer, category.color)), label: category.layer};
  return {id: writable(currentLayer()), label: '현재 레이어'};
 };
 const initialParams = (item, last) => {
  const den = denominator(), values = item.user ? {scale: 1} : itemDefaults(item, den), remembered = last.params?.[item.id];
  if (remembered && isPlainObject(remembered.values)) for (const p of item.params) if (hasOwn(remembered.values, p.name) && (!p.scaled || remembered.denominator === den)) values[p.name] = remembered.values[p.name];
  return values;
 };
 const cursorOf = (a, b) => { const ok = (p) => p && Number.isFinite(p.x) && Number.isFinite(p.y); return ok(b) ? b : ok(a) ? a : Array.isArray(a) && ok(a.at(-1)) ? a.at(-1) : null; };
 const angleTo = (from, to) => Math.hypot(to.x - from.x, to.y - from.y) < 1e-9 ? 0 : G.angle(G.sub(to, from));

 async function placeLoop(item, params, placement) {
  const local = item.build(params);
  checkLayer(item, placement.layerMode);
  let layer = null;
  const attributes = item.user ? (params.scale !== 1 ? {scale: params.scale} : {}) : params;
  const make = (position, rotation, layerId) => blockFrom({id: item.id, name: item.blockName, attributes}, local, {position, rotation, mirror: placement.mirror, layer: layerId, readable: !item.user});
  const big = deepCount(local) > PREVIEW_LIMIT, bb = big ? G.bounds(local) : null;
  const preview = (position, rotation) => {
   if (!big) return [make(position, rotation, layer?.id ?? currentLayer())];
   return bb ? placeEntities([rect(bb.minX, bb.minY, bb.maxX - bb.minX, bb.maxY - bb.minY)], {position, rotation, mirror: placement.mirror}) : [];
  };
  let count = 0;
  for (;;) {
   const fixed = placement.rotation === 'pick' ? 0 : placement.angle;
   const base = await ctx.pickPoint({prompt: `${item.blockName} · 삽입점을 지정하세요${count ? ` · ${count}개 넣음` : ''} · Esc 끝`, preview: (a, b) => { const c = cursorOf(a, b); return c ? preview(c, fixed) : []; }});
   if (!base) break;
   let angle = fixed;
   if (placement.rotation === 'pick') {
    const toward = await ctx.pickPoint({prompt: `${item.blockName} · 방향(블록의 +X 축)을 클릭하세요 · Esc 취소`, preview: (a, b) => { const c = cursorOf(a, b); return preview(base, c ? angleTo(base, c) : 0); }});
    if (!toward) break;
    angle = angleTo(base, toward);
   }
   layer ??= targetLayer(item, placement.layerMode);
   const doc = ctx.doc?.();
   // 공유 정의를 받는 commit(앱의 카드 문맥, sharedDefinitions 표시)일 때만. 설정 BLOCKSTORAGE 로 예전 사본 방식으로 되돌릴 수 있다.
   if (ctx.sharedDefinitions === true && typeof ctx.commit === 'function' && doc && blockStorageShared() && !big) {
    const {key, definition, ref} = libraryReference(doc.sharedBlocks, item, attributes, local, {position: base, rotation: angle, mirror: placement.mirror, layer: layer.id, readable: !item.user});
    ctx.commit({entities: [ref], definitions: definition ? {[key]: definition} : null});
    count++;
    if (!placement.repeat) break;
    continue;
   }
   const block = make(base, angle, layer.id);
   if (typeof ctx.commit === 'function') ctx.commit({entities: [block]});
   else ctx.execute({type: 'addMany', entities: [block]});
   count++;
   if (!placement.repeat) break;
  }
  if (count) ctx.toast?.(`${item.blockName} ${count}개를 넣었습니다(${layer.label}). Ctrl+Z 로 되돌립니다.`);
  return count;
 }

 function readPlacement(v) {
  const rotation = ROTATIONS.some(([key]) => key === String(v.rotation)) ? String(v.rotation) : '0';
  let angle = 0;
  if (rotation === 'custom') { angle = Number(String(v.angle ?? '').trim()); if (String(v.angle ?? '').trim() === '' || !Number.isFinite(angle)) throw Error('회전 각도에는 숫자를 입력하세요.'); }
  else if (rotation !== 'pick') angle = Number(rotation);
  return {rotation, angle, mirror: isChecked(v.mirror), repeat: isChecked(v.repeat), layerMode: v.layer === 'current' ? 'current' : 'category'};
 }

 function openParams(itemId) {
  const item = resolveItem(itemId);
  if (!item) throw Error('고른 블록을 찾을 수 없습니다. 내 라이브러리에서 지워졌을 수 있습니다.');
  const last = loadLast(), values = initialParams(item, last), category = item.category && CATEGORY_MAP.get(item.category);
  const fields = [
   ...item.params.map(p => ({name: p.name, label: p.label, value: values[p.name], ...(p.type === 'select' ? {options: p.options} : p.type === 'text' ? {} : {type: p.type})})),
   {name: 'rotation', label: '회전', options: ROTATIONS, value: last.rotation ?? '0'},
   {name: 'angle', label: '직접 입력 각도 (도, 반시계 +)', type: 'number', value: last.angle ?? 0},
   {name: 'mirror', label: '좌우 대칭 (미러)', type: 'checkbox', value: !!last.mirror},
   {name: 'layer', label: '레이어', options: category ? [['category', `분류 표준 레이어 ${category.layer}`], ['current', '현재 레이어']] : [['current', '현재 레이어']], value: category ? (last.layerMode ?? 'category') : 'current'},
   {name: 'repeat', label: '같은 블록 계속 넣기 (Esc 로 끝)', type: 'checkbox', value: last.repeat ?? true},
  ];
  return ctx.form(`${item.blockName} · 기준점: ${item.base}`, fields, (v) => {
   // 폼(FormData)은 꺼진 체크박스를 아예 보내지 않는다 → 빠진 체크박스 = 꺼짐(기본값으로 되돌리지 않는다).
   const values = {...v};for (const p of item.params) if (p.type === 'checkbox') values[p.name] = isChecked(v[p.name]);
   const params = item.user ? normalizeUserParams(values) : normalizeParams(item, values, denominator());
   const placement = readPlacement(v), latest = loadLast();
   const remembered = {...(latest.params || {}), [item.id]: {values: params, denominator: denominator()}};
   const keys = Object.keys(remembered); if (keys.length > 80) for (const key of keys.slice(0, keys.length - 80)) delete remembered[key];
   saveLast({item: item.id, category: item.user ? 'user' : item.category, byCategory: {...(latest.byCategory || {}), [item.user ? 'user' : item.category]: item.id}, params: remembered, rotation: placement.rotation, angle: placement.rotation === 'custom' ? placement.angle : (latest.angle ?? 0), mirror: placement.mirror, repeat: placement.repeat, ...(category ? {layerMode: placement.layerMode} : {})});
   return placeLoop(item, params, placement);
  });
 }
 function normalizeUserParams(v) {
  const scale = Number(String(v.scale ?? 1).trim());
  if (!Number.isFinite(scale) || scale < 0.001 || scale > 1000) throw Error('배율은 0.001~1000 사이로 입력하세요.');
  return {scale};
 }

 function chooseItem(category) {
  const last = loadLast();
  if (category === 'user') {
   const {entries} = userLibrary();
   if (!entries.size) throw Error('내 라이브러리가 비어 있습니다. LIBRARY 로 선택 객체를 저장하거나 LIBIMPORT 로 사무실 공유 파일을 가져오세요.');
   const names = [...entries.keys()].sort((a, b) => a.localeCompare(b, 'ko', {numeric: true}));
   const options = names.map(name => [`user:${name}`, `${name} · 객체 ${deepCount(entries.get(name))}개`]);
   const remembered = last.byCategory?.user;
   return ctx.form(`블록 모음 · 내 라이브러리 ${names.length}개`, [{name: 'item', label: '블록', options, value: options.some(([v]) => v === remembered) ? remembered : options[0][0]}], (v) => openParams(v.item));
  }
  const info = CATEGORY_MAP.get(category);
  if (!info) throw Error('분류를 고르세요.');
  const items = itemsOf(category);
  const options = items.map(item => [item.id, `${item.name} · ${item.summary(initialParams(item, last))}`]);
  const remembered = last.byCategory?.[category];
  return ctx.form(`블록 모음 · ${info.label} ${items.length}종`, [{name: 'item', label: '품목', options, value: items.some(i => i.id === remembered) ? remembered : items[0].id}], (v) => {
   if (blockItem(v.item)?.category !== category) throw Error('품목을 고르세요.');
   return openParams(v.item);
  });
 }

 const commands = {
  BLOCKLIB() {
   const last = loadLast(), recent = last.item && resolveItem(last.item);
   const userCount = userLibrary().entries.size;
   const options = [
    ...(recent ? [['__recent__', `최근: ${recent.blockName}`]] : []),
    ...BLOCK_CATEGORIES.map(c => [c.id, `${c.label} · ${itemsOf(c.id).map(i => i.name).slice(0, 4).join(', ')}${itemsOf(c.id).length > 4 ? ' …' : ''}`]),
    ['user', `내 라이브러리 · ${userCount}개 (LIBRARY 저장·가져온 블록)`],
    ['__import__', '사무실 공유 파일 가져오기… (LIBIMPORT)'],
    ['__export__', '사무실 공유 파일로 내보내기… (LIBEXPORT)'],
   ];
   const value = recent ? '__recent__' : (options.some(([v]) => v === last.category) ? last.category : 'furniture');
   return ctx.form('블록 모음 · 분류', [{name: 'category', label: '분류', options, value}], (v) => {
    if (v.category === '__recent__') { if (!recent) throw Error('최근 블록이 없습니다. 분류를 고르세요.'); return openParams(recent.id); }
    if (v.category === '__import__') return commands.LIBIMPORT();
    if (v.category === '__export__') return commands.LIBEXPORT();
    return chooseItem(v.category);
   });
  },

  LIBEXPORT() {
   const store = readLibraryStore(storage()), docLib = docLibrary();
   const libraryCount = new Set([...Object.keys(store.library).filter(k => Array.isArray(store.library[k])), ...Object.keys(docLib)]).size;
   const selection = (ctx.selected?.() || []).filter(e => e.type === 'block' && !e.xref && !e.table);
   const definitions = (ctx.blocks?.() || []).filter(b => Array.isArray(b?.entities) && b.entities.length);
   if (!libraryCount && !selection.length && !definitions.length) throw Error('내보낼 블록이 없습니다. LIBRARY 로 저장하거나 BLOCKLIB 로 넣은 블록을 선택하세요.');
   const last = loadLast(), today = dateStamp(new Date());
   return ctx.form('블록 라이브러리 내보내기 · 사무실 공유 파일(.json)', [
    {name: 'title', label: '라이브러리 이름 (파일 안에 기록)', value: last.exportTitle || '사무실 블록 모음'},
    {name: 'library', label: `내 라이브러리(LIBRARY) ${libraryCount}개`, type: 'checkbox', value: libraryCount > 0},
    {name: 'selection', label: `선택한 블록 ${selection.length}개`, type: 'checkbox', value: selection.length > 0},
    {name: 'definitions', label: `도면 블록 정의 ${definitions.length}개`, type: 'checkbox', value: false},
    {name: 'filter', label: '이름에 이 글자가 든 것만 (쉼표로 여러 개, 비우면 전부)', value: ''},
    {name: 'fileName', label: '파일 이름', value: `블록라이브러리_${today}.json`},
   ], async (v) => {
    const blocks = collectExportBlocks({library: store.library, meta: store.meta, docLibrary: docLib, selection, definitions, doc: ctx.doc?.() || null,
     include: {library: isChecked(v.library), selection: isChecked(v.selection), definitions: isChecked(v.definitions)}, filter: v.filter});
    if (!blocks.length) throw Error('고른 조건에 맞는 블록이 없습니다.');
    if (blocks.length > LIBRARY_LIMITS.maxBlocks) throw Error(`블록이 ${blocks.length}개입니다. 한 파일에 ${LIBRARY_LIMITS.maxBlocks}개까지 내보냅니다. 이름 거르기로 나눠 주세요.`);
    const title = cleanText(v.title, 120) || '사무실 블록 모음';
    const text = JSON.stringify(buildLibraryFile(blocks, {title}));
    if (text.length > LIBRARY_LIMITS.maxBytes) throw Error(`파일이 ${(text.length / 1048576).toFixed(1)} MB 로 가져오기 한도(${LIBRARY_LIMITS.maxBytes / 1048576} MB)를 넘습니다. 이름 거르기로 나눠 내보내세요.`);
    const check = parseLibraryFile(text);   // 받는 쪽에서 그대로 가져와지는지 미리 확인
    const fileName = (safeFileName(String(v.fileName || '').replace(/\.json$/i, ''), `블록라이브러리_${today}`)) + '.json';
    saveLast({exportTitle: title});
    await saveTextFile(ctx, fileName, text);
    ctx.toast?.(`블록 ${blocks.length}개를 "${fileName}" 로 내보냈습니다. 다른 PC 에서 LIBIMPORT 로 가져오세요.${check.skipped.length ? ` · 가져올 수 없는 ${check.skipped.length}개: ${check.skipped.map(s => s.name).slice(0, 3).join(', ')}` : ''}`, check.skipped.length > 0);
    return {fileName, count: blocks.length, skipped: check.skipped};
   });
  },

  LIBIMPORT() {
   const last = loadLast();
   return ctx.form('블록 라이브러리 가져오기 · 사무실 공유 파일(.json)', [
    {name: 'conflict', label: '내 라이브러리에 같은 이름이 있으면', options: [['rename', '새 이름으로 추가 · 예: 문 (2)'], ['skip', '건너뛰기 · 기존 항목 유지']], value: last.conflict === 'skip' ? 'skip' : 'rename'},
   ], async (v) => {
    const conflict = v.conflict === 'skip' ? 'skip' : 'rename';
    saveLast({conflict});
    const file = await openTextFile(ctx, '.json,application/json');
    if (!file) { ctx.toast?.('가져오기를 취소했습니다.'); return null; }
    const text = await readPickedText(file, LIBRARY_LIMITS.maxBytes);
    const report = importLibraryText(storage(), text, {conflict, reserved: Object.keys(docLibrary())});
    const parts = [`블록 ${report.added.length}개를 내 라이브러리에 더했습니다`];
    if (report.renamed.length) parts.push(`이름 바꿈 ${report.renamed.length}개(${report.renamed.slice(0, 2).map(r => r.to).join(', ')}${report.renamed.length > 2 ? ' …' : ''})`);
    if (report.skipped.length) parts.push(`같은 이름 건너뜀 ${report.skipped.length}개`);
    if (report.invalid.length) parts.push(`검사 실패 ${report.invalid.length}개(${report.invalid.slice(0, 2).map(s => `${s.name}: ${s.reason}`).join(' / ')})`);
    ctx.toast?.(`${parts.join(' · ')}. BLOCKLIB 의 "내 라이브러리" 또는 LIBRARY(이름으로 삽입)로 넣으세요.`, report.invalid.length > 0 && !report.added.length);
    return report;
   });
  },
 };
 return commands;
}
