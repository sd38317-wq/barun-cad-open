// 현장 패드 온스냅 — 정의는 한 번 색인하고, 가까운 블록만 세계 좌표로 본다.
import {flattenInstances, INHERIT, FLAG_CLOSED, FLAG_POINT, FLAG_PAIRS, FLAG_CURVE} from './pad-pack.js';

const KINDS = ['끝점', '교차점', '중간점', '중심점', '사분점', '수직점', '근처점'];
const TAU = Math.PI * 2, ANGLE_EPS = 1e-6;
const IDENTITY = [1, 0, 0, 1, 0, 0];
const shown = () => true;
const mod = a => ((a % TAU) + TAU) % TAU;
const overlaps = (a, b, c, d, box) => a <= box[2] && c >= box[0] && b <= box[3] && d >= box[1];

function onArc(angle, start, end) {
  if (Math.abs(end - start) >= TAU - ANGLE_EPS) return true;
  const t = mod(angle - start), sweep = mod(end - start);
  return t <= sweep + ANGLE_EPS || TAU - t <= ANGLE_EPS;
}

/** 긴 선·큰 블록은 굵은 격자로 보낸다. 상자당 최대 4셀만 등록한다. */
class BoxGrid {
  constructor(count, bounds, boxOf) {
    this.count = count; this.bounds = bounds; this.boxOf = boxOf;
    this.levels = []; this.seen = new Uint32Array(count); this.serial = 0;
    if (!count) return;
    const sizes = [], step = Math.max(1, Math.floor(count / 256)), box = [0, 0, 0, 0];
    for (let i = 0; i < count; i += step) {
      boxOf(i, box);
      const size = Math.max(box[2] - box[0], box[3] - box[1]);
      if (size > 0) sizes.push(size);
    }
    sizes.sort((a, b) => a - b);
    const span = Math.max(bounds[2] - bounds[0], bounds[3] - bounds[1]);
    this.cell = Math.max(sizes.length ? sizes[sizes.length >> 1] * 2 : span / Math.max(1, Math.sqrt(count / 8)), 1e-9);
    for (let i = 0; i < count; i++) {
      boxOf(i, box);
      const size = Math.max(box[2] - box[0], box[3] - box[1]);
      const level = Math.max(0, Math.ceil(Math.log2(size / this.cell)));
      let grid = this.levels[level];
      if (!grid) {
        const cell = this.cell * 2 ** level;
        const nx = Math.floor((bounds[2] - bounds[0]) / cell) + 1, ny = Math.floor((bounds[3] - bounds[1]) / cell) + 1;
        grid = this.levels[level] = {cell, nx, ny, numeric: nx * ny <= Number.MAX_SAFE_INTEGER, buckets: new Map()};
      }
      const x0 = Math.floor((box[0] - bounds[0]) / grid.cell), x1 = Math.floor((box[2] - bounds[0]) / grid.cell);
      const y0 = Math.floor((box[1] - bounds[1]) / grid.cell), y1 = Math.floor((box[3] - bounds[1]) / grid.cell);
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        const key = grid.numeric ? y * grid.nx + x : x + ',' + y;
        let list = grid.buckets.get(key);
        if (!list) grid.buckets.set(key, list = []);
        list.push(i);
      }
    }
  }
  query(box, visit) {
    if (!this.count || !overlaps(...this.bounds, box)) return;
    if (++this.serial > 0xffffffff) { this.seen.fill(0); this.serial = 1; }
    const serial = this.serial, scratch = [0, 0, 0, 0], bounds = this.bounds;
    const take = i => {
      if (this.seen[i] === serial) return;
      this.seen[i] = serial; this.boxOf(i, scratch);
      if (overlaps(...scratch, box)) visit(i);
    };
    for (const grid of this.levels) {
      if (!grid) continue;
      const x0 = Math.max(0, Math.floor((box[0] - bounds[0]) / grid.cell)), x1 = Math.min(grid.nx - 1, Math.floor((box[2] - bounds[0]) / grid.cell));
      const y0 = Math.max(0, Math.floor((box[1] - bounds[1]) / grid.cell)), y1 = Math.min(grid.ny - 1, Math.floor((box[3] - bounds[1]) / grid.cell));
      // 아주 넓은 조회도 빈 셀을 끝없이 돌지 않는다.
      if ((x1 - x0 + 1) * (y1 - y0 + 1) > grid.buckets.size) {
        for (const list of grid.buckets.values()) for (const i of list) take(i);
      } else {
        for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
          const list = grid.buckets.get(grid.numeric ? y * grid.nx + x : x + ',' + y);
          if (list) for (const i of list) take(i);
        }
      }
    }
  }
}

function setBounds(pack, set) {
  const box = [Infinity, Infinity, -Infinity, -Infinity], {poly, xy, curve} = pack;
  const add = (x, y) => { box[0] = Math.min(box[0], x); box[1] = Math.min(box[1], y); box[2] = Math.max(box[2], x); box[3] = Math.max(box[3], y); };
  for (let i = set.poly[0], end = i + set.poly[1]; i < end; i++) {
    for (let k = poly.start[i] * 2, endXY = k + poly.len[i] * 2; k < endXY; k += 2) add(xy[k], xy[k + 1]);
  }
  for (let i = set.curve[0], end = i + set.curve[1]; i < end; i++) {
    const x = curve.xy[i * 2], y = curve.xy[i * 2 + 1], r = Math.abs(curve.r[i]);
    add(x - r, y - r); add(x + r, y + r);
  }
  return box;
}

function setIndex(pack, set, bounds) {
  const {poly, xy, curve} = pack;
  let count = 0;
  for (let i = set.poly[0], end = i + set.poly[1]; i < end; i++) {
    const n = poly.len[i], flags = poly.flags[i];
    count += flags & FLAG_POINT ? n : n < 2 ? n : flags & FLAG_PAIRS ? n >> 1 : n - 1 + (flags & FLAG_CLOSED ? 1 : 0);
  }
  const u = new Uint32Array(count), v = new Uint32Array(count), source = new Uint32Array(count);
  let next = 0;
  const edge = (a, b, p) => { u[next] = a * 2; v[next] = b * 2; source[next++] = p; };
  for (let i = set.poly[0], end = i + set.poly[1]; i < end; i++) {
    const n = poly.len[i], start = poly.start[i], flags = poly.flags[i];
    if (flags & FLAG_POINT || n === 1) { for (let k = 0; k < n; k++) edge(start + k, start + k, i); }
    else if (flags & FLAG_PAIRS) { for (let k = 0; k + 1 < n; k += 2) edge(start + k, start + k + 1, i); }
    else if (n > 1) {
      for (let k = 0; k + 1 < n; k++) edge(start + k, start + k + 1, i);
      if (flags & FLAG_CLOSED) edge(start + n - 1, start, i);
    }
  }
  const fx = [], fy = [], fk = [], fl = [];
  const feature = (x, y, kind, layer) => { fx.push(x); fy.push(y); fk.push(kind); fl.push(layer); };
  for (let i = set.curve[0], end = i + set.curve[1]; i < end; i++) {
    const kind = curve.kind[i];
    if (kind !== 1 && kind !== 2) continue;
    const x = curve.xy[i * 2], y = curve.xy[i * 2 + 1], r = curve.r[i], layer = curve.layer[i], a0 = curve.a0[i], a1 = curve.a1[i];
    feature(x, y, 3, layer);
    for (let k = 0; k < 4; k++) {
      const angle = k * Math.PI / 2;
      if (kind === 1 || onArc(angle, a0, a1)) feature(x + r * Math.cos(angle), y + r * Math.sin(angle), 4, layer);
    }
    if (kind === 2) for (const angle of [a0, a1]) feature(x + r * Math.cos(angle), y + r * Math.sin(angle), 0, layer);
  }
  const features = {x: Float64Array.from(fx), y: Float64Array.from(fy), kind: Uint8Array.from(fk), layer: Uint16Array.from(fl)};
  const boxOf = (i, box) => {
    if (i < count) {
      const a = u[i], b = v[i];
      box[0] = Math.min(xy[a], xy[b]); box[1] = Math.min(xy[a + 1], xy[b + 1]);
      box[2] = Math.max(xy[a], xy[b]); box[3] = Math.max(xy[a + 1], xy[b + 1]);
    } else {
      i -= count; box[0] = box[2] = features.x[i]; box[1] = box[3] = features.y[i];
    }
  };
  return {count, u, v, source, features, grid: new BoxGrid(count + fx.length, bounds, boxOf)};
}

// 교차점용 선분은 조준 상자에 잘라 수치 오차와 불필요한 비교를 줄인다.
function clippedSegment(x0, y0, x1, y1, box) {
  const dx = x1 - x0, dy = y1 - y0;
  let lo = 0, hi = 1;
  for (let axis = 0; axis < 2; axis++) {
    const p = axis ? y0 : x0, d = axis ? dy : dx;
    if (d === 0) { if (p < box[axis] || p > box[axis + 2]) return null; }
    else {
      const a = (box[axis] - p) / d, b = (box[axis + 2] - p) / d;
      lo = Math.max(lo, Math.min(a, b)); hi = Math.min(hi, Math.max(a, b));
      if (lo > hi) return null;
    }
  }
  const ax = x0 + lo * dx, ay = y0 + lo * dy, bx = x0 + hi * dx, by = y0 + hi * dy;
  const ends = ax === bx && ay === by ? {ax: x0, ay: y0, bx: x1, by: y1} : {ax, ay, bx, by};
  return {...ends, minX: Math.min(ax, bx), minY: Math.min(ay, by), maxX: Math.max(ax, bx), maxY: Math.max(ay, by)};
}

/** 좌표는 모형 원점 기준. placed 는 flattenInstances(pack)의 결과다. */
export function createPadSnapper(pack, placed = flattenInstances(pack)) {
  const bounds = new Array(pack.sets.length), indexes = new Array(pack.sets.length);
  const zero = pack.header.layers.findIndex(layer => layer.name === '0'), modelLayer = zero < 0 ? INHERIT : zero;
  const boundsOf = i => bounds[i] || (bounds[i] = setBounds(pack, pack.sets[i]));
  const instances = [], boxes = [];
  for (const p of placed) {
    if (!p.set || !pack.sets[p.set]) continue;
    const box = boundsOf(p.set), m = p.m, det = m[0] * m[3] - m[1] * m[2];
    if (!Number.isFinite(det) || det === 0 || box[0] > box[2]) continue;
    const cx = (box[0] + box[2]) / 2, cy = (box[1] + box[3]) / 2, hx = (box[2] - box[0]) / 2, hy = (box[3] - box[1]) / 2;
    const x = m[0] * cx + m[2] * cy + m[4], y = m[1] * cx + m[3] * cy + m[5];
    const dx = Math.abs(m[0]) * hx + Math.abs(m[2]) * hy, dy = Math.abs(m[1]) * hx + Math.abs(m[3]) * hy;
    const a = m[3] / det, b = -m[1] / det, c = -m[2] / det, d = m[0] / det;
    instances.push({set: p.set, layer: p.layer === INHERIT ? modelLayer : p.layer, m, inverse: [a, b, c, d], rx: Math.hypot(a, c), ry: Math.hypot(b, d)});
    boxes.push(x - dx, y - dy, x + dx, y + dy);
  }
  const instanceBoxes = Float64Array.from(boxes), worldBounds = [Infinity, Infinity, -Infinity, -Infinity];
  for (let i = 0; i < instances.length; i++) {
    const j = i * 4;
    worldBounds[0] = Math.min(worldBounds[0], instanceBoxes[j]); worldBounds[1] = Math.min(worldBounds[1], instanceBoxes[j + 1]);
    worldBounds[2] = Math.max(worldBounds[2], instanceBoxes[j + 2]); worldBounds[3] = Math.max(worldBounds[3], instanceBoxes[j + 3]);
  }
  const instanceGrid = new BoxGrid(instances.length, worldBounds, (i, box) => {
    for (let k = 0; k < 4; k++) box[k] = instanceBoxes[i * 4 + k];
  });

  return {
    snap(world, {scale, aperturePx = 14, modes, from = null, layerShown = shown} = {}) {
      if (!Number.isFinite(world?.x) || !Number.isFinite(world?.y) || !Number.isFinite(scale) || scale <= 0 ||
          !Number.isFinite(aperturePx) || aperturePx < 0 || !modes?.size) return null;
      const radius = aperturePx / scale;
      if (!Number.isFinite(radius)) return null;
      const radius2 = radius * radius, wx = world.x, wy = world.y;
      const box = [wx - radius, wy - radius, wx + radius, wy + radius];
      const enabled = KINDS.map(kind => modes.has(kind)), best = new Array(KINDS.length), segments = [];
      const perpendicular = enabled[5] && Number.isFinite(from?.x) && Number.isFinite(from?.y);
      const consider = (x, y, kind) => {
        const d2 = (x - wx) ** 2 + (y - wy) ** 2;
        if (d2 <= radius2 && (!best[kind] || d2 < best[kind].d2)) best[kind] = {x, y, d2};
      };
      const visitSet = (set, layer, m, localBox) => {
        if (!overlaps(...boundsOf(set), localBox)) return;
        const index = indexes[set] || (indexes[set] = setIndex(pack, pack.sets[set], boundsOf(set)));
        const {xy, poly} = pack;
        index.grid.query(localBox, i => {
          if (i >= index.count) {
            const f = index.features, j = i - index.count, kind = f.kind[j];
            if (!enabled[kind] || layerShown(f.layer[j] === INHERIT ? layer : f.layer[j]) === false) return;
            const x = f.x[j], y = f.y[j];
            consider(m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5], kind);
            return;
          }
          const p = index.source[i], flags = poly.flags[p];
          if (layerShown(poly.layer[p] === INHERIT ? layer : poly.layer[p]) === false) return;
          const a = index.u[i], b = index.v[i], lx = xy[a], ly = xy[a + 1], ex = xy[b], ey = xy[b + 1];
          const x0 = m[0] * lx + m[2] * ly + m[4], y0 = m[1] * lx + m[3] * ly + m[5];
          const x1 = m[0] * ex + m[2] * ey + m[4], y1 = m[1] * ex + m[3] * ey + m[5];
          if (enabled[0] && (!(flags & FLAG_CURVE) || flags & FLAG_POINT)) { consider(x0, y0, 0); if (a !== b) consider(x1, y1, 0); }
          if (a === b) return;
          if (enabled[2] && !(flags & FLAG_CURVE)) consider((x0 + x1) / 2, (y0 + y1) / 2, 2);
          if (!enabled[1] && !perpendicular && !enabled[6]) return;
          const dx = x1 - x0, dy = y1 - y0, len2 = dx * dx + dy * dy;
          const t = len2 ? Math.max(0, Math.min(1, ((wx - x0) * dx + (wy - y0) * dy) / len2)) : 0;
          const nx = x0 + t * dx, ny = y0 + t * dy;
          if ((nx - wx) ** 2 + (ny - wy) ** 2 > radius2) return;
          if (enabled[6]) consider(nx, ny, 6);
          if (perpendicular && len2) {
            const foot = ((from.x - x0) * dx + (from.y - y0) * dy) / len2;
            if (foot >= 0 && foot <= 1) consider(x0 + foot * dx, y0 + foot * dy, 5);
          }
          if (enabled[1] && len2) {
            const segment = clippedSegment(x0, y0, x1, y1, box);
            if (segment) segments.push(segment);
          }
        });
      };
      visitSet(0, modelLayer, IDENTITY, box);
      instanceGrid.query(box, i => {
        const p = instances[i], m = p.m, inv = p.inverse, x = wx - m[4], y = wy - m[5];
        const lx = inv[0] * x + inv[2] * y, ly = inv[1] * x + inv[3] * y;
        visitSet(p.set, p.layer, m, [lx - radius * p.rx, ly - radius * p.ry, lx + radius * p.rx, ly + radius * p.ry]);
      });
      if (best[0] && Math.sqrt(best[0].d2) <= 1 / scale) return {x: best[0].x, y: best[0].y, kind: KINDS[0]};
      if (enabled[1]) {
        segments.sort((a, b) => a.minX - b.minX);
        crossings: for (let i = 0; i < segments.length; i++) {
          const a = segments[i], dx = a.bx - a.ax, dy = a.by - a.ay;
          for (let j = i + 1; j < segments.length && segments[j].minX <= a.maxX; j++) {
            const b = segments[j];
            if (b.minY > a.maxY || b.maxY < a.minY) continue;
            const ex = b.bx - b.ax, ey = b.by - b.ay, den = dx * ey - dy * ex;
            if (Math.abs(den) <= Number.EPSILON * Math.hypot(dx, dy) * Math.hypot(ex, ey) * 8) continue;
            const qx = b.ax - a.ax, qy = b.ay - a.ay;
            const t = (qx * ey - qy * ex) / den, u = (qx * dy - qy * dx) / den;
            if (t >= 0 && t <= 1 && u >= 0 && u <= 1) {
              consider(a.ax + t * dx, a.ay + t * dy, 1);
              if (best[1]?.d2 === 0) break crossings;
            }
          }
        }
      }
      // 가장 가까운 후보와 1px 이내인 종류만 우선순위로 고른다. 근처점은 마지막 수단.
      let nearest = Infinity;
      for (let i = 0; i < 6; i++) if (best[i]) nearest = Math.min(nearest, Math.sqrt(best[i].d2));
      for (let i = 0; i < 6; i++) if (best[i] && Math.sqrt(best[i].d2) <= nearest + 1 / scale) return {x: best[i].x, y: best[i].y, kind: KINDS[i]};
      return best[6] ? {x: best[6].x, y: best[6].y, kind: KINDS[6]} : null;
    },
  };
}
