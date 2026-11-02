import * as G from './geometry.js';

// Presentation-only planning. Coordinates are CAD world coordinates (positive Y is up),
// and arc angles use the same degrees/CCW convention as geometry.js.
export const REVEAL_STAGES = Object.freeze([
  ['base', '기준선'], ['structure', '구조체'], ['layers', '마감층'],
  ['hatch', '해치'], ['dims', '치수'], ['leaders', '지시선'],
  ['text', '문자'], ['title', '제목'],
].map(Object.freeze));

const GEOMETRY_KEYS = new Set(['base', 'structure', 'layers', 'hatch']);
const EPS = 1e-9;
const radians = degrees => degrees * Math.PI / 180;
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const validPoint = p => Number.isFinite(p?.x) && Number.isFinite(p?.y);
const copyPoint = p => ({x: p.x, y: p.y});
const normalized = angle => ((angle % 360) + 360) % 360;
const polarPoint = (center, radius, degrees) => ({
  x: center.x + radius * Math.cos(radians(degrees)),
  y: center.y + radius * Math.sin(radians(degrees)),
});
const arcSweep = e => normalized((e.endAngle || 0) - (e.startAngle || 0)) || 360;

function classify(entity) {
  const layer = String(entity.layerName || entity.layer || '').toUpperCase();
  const type = String(entity.type || '').toLowerCase();
  const role = String(entity.detailRole || '').toLowerCase();
  const material = entity.detailMaterial;
  const materialName = String(typeof material === 'object'
    ? material?.name || material?.label || '' : material || '').toLowerCase();
  const linetype = String(entity._displayLinetype || entity.linetype || entity.lineType || '').toUpperCase();
  // Semantic roles override the primitive used to draw them (dots are hatches).
  if (role === 'title' || layer === 'A-SYM' || /-TTLB/.test(layer) ||
      /도곽/.test(layer) || ['titleblock', 'drawingframe'].includes(type)) return 'title';
  if (role === 'note' || role === 'label') return 'text';
  if (role === 'leader' || role === 'dot') return 'leaders';
  if (['layer', 'total', 'extra'].includes(role)) return 'dims';
  if (type === 'dimension') return 'dims';
  if (type === 'leader' || type === 'mleader') return 'leaders';
  if (type === 'text' || type === 'mtext') return 'text';
  if (type === 'hatch') return 'hatch';
  if (/-GRID|-CNTR|-WALL-C$/.test(layer) ||
      (!/^A-(?:ANNO-|TEXT|DIM|SYM|TITLE|NOTE|PLOT|GUIDE|ACCS|ASSUMED)/.test(layer) && /CENTER|CENTRE|DASHED|DASHDOT/.test(linetype))) return 'base';
  if (layer === 'A-WALL-CONC' || /^S-|^A-COL/.test(layer) ||
      /콘크리트|철근|rc|벽돌|블록|철골/.test(materialName) ||
      /^(concrete|lean|brick|block|steel|rebar)$/.test(materialName)) return 'structure';
  return 'layers';
}

// A bulge is tan(signed sweep / 4); positive sweeps are CCW.
function segment(a, b, bulge = 0) {
  const chord = distance(a, b);
  if (!Number.isFinite(bulge) || Math.abs(bulge) < EPS || chord < EPS) {
    return {a, b, length: chord, at: t => ({x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t})};
  }
  const center = {
    x: (a.x + b.x) / 2 - (b.y - a.y) * (1 - bulge * bulge) / (4 * bulge),
    y: (a.y + b.y) / 2 + (b.x - a.x) * (1 - bulge * bulge) / (4 * bulge),
  };
  const sweep = 4 * Math.atan(bulge), radius = distance(center, a);
  const start = Math.atan2(a.y - center.y, a.x - center.x);
  return {a, b, center, sweep, start, radius, length: Math.abs(sweep) * radius,
    at: t => ({x: center.x + radius * Math.cos(start + sweep * t), y: center.y + radius * Math.sin(start + sweep * t)})};
}

function pathSegments(entity) {
  const points = entity.points || (validPoint(entity.start) && validPoint(entity.end) ? [entity.start, entity.end] : []);
  if (!points.every(validPoint)) return [];
  const count = points.length - 1 + ((entity.closed || entity.type === 'rectangle') && points.length > 1 ? 1 : 0);
  const parts = [];
  for (let i = 0; i < count; i++) {
    parts.push(segment(points[i], points[(i + 1) % points.length], entity.bulges?.[i] ?? points[i].bulge ?? 0));
  }
  return parts;
}

function endpoints(entity) {
  const type = String(entity.type || '').toLowerCase();
  if ((type === 'arc' || type === 'circle') && validPoint(entity.center)) {
    const start = type === 'circle' ? 0 : entity.startAngle || 0;
    return [polarPoint(entity.center, entity.radius || 0, start),
      polarPoint(entity.center, entity.radius || 0, type === 'circle' ? 0 : start + arcSweep(entity))];
  }
  const points = entity.points;
  if (points?.length && validPoint(points[0])) {
    return [points[0], (entity.closed || type === 'rectangle') ? points[0] : points.findLast(validPoint)];
  }
  if (validPoint(entity.start)) return [entity.start, validPoint(entity.end) ? entity.end : entity.start];
  const position = [entity.position, entity.center].find(validPoint) || {x: 0, y: 0};
  return [position, position];
}

const validBounds = box => box && ['minX', 'minY', 'maxX', 'maxY'].every(key => Number.isFinite(box[key])) &&
  box.minX <= box.maxX && box.minY <= box.maxY;
function entityBounds(entity) {
  // The shared geometry path includes ellipses, dimension text and leader vertices.
  try { const box = G.bounds([entity]); return validBounds(box) ? box : null; }
  catch { return null; }
}
function mergeBounds(items) {
  let box = null;
  for (const item of items) if (validBounds(item.bounds)) {
    const next = item.bounds;
    box = box ? {minX: Math.min(box.minX, next.minX), minY: Math.min(box.minY, next.minY),
      maxX: Math.max(box.maxX, next.maxX), maxY: Math.max(box.maxY, next.maxY)} : {...next};
  }
  return box;
}
const centerOf = box => box ? ({x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2}) : null;

// Neighboring grid cells are checked too, so objects close across a cell border stay together.
function spatialGroups(items, cellSize, limit) {
  if (!items.length) return [];
  const invalid = items.filter(item => !item.center);
  items = items.filter(item => item.center);
  if (!items.length) return [invalid];
  const parent = items.map((_, i) => i), grid = new Map();
  const root = i => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  const size = Math.max(cellSize, EPS);
  items.forEach((item, i) => {
    const x = Math.floor(item.center.x / size), y = Math.floor(item.center.y / size);
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      for (const j of grid.get((x + dx) + ',' + (y + dy)) || []) {
        if (distance(item.center, items[j].center) <= size) parent[root(i)] = root(j);
      }
    }
    const key = x + ',' + y;
    if (!grid.has(key)) grid.set(key, []);
    grid.get(key).push(i);
  });
  const grouped = new Map();
  items.forEach((item, i) => { const key = root(i); if (!grouped.has(key)) grouped.set(key, []); grouped.get(key).push(item); });
  const groups = [...grouped.values()];
  // A lone title or note strip belongs to the drawing beside it; the camera never flies to it alone.
  const minor = group => group.length < 6 || group.every(item => !GEOMETRY_KEYS.has(item.key));
  const major = groups.filter(group => !minor(group));
  if (major.length) for (const group of groups.filter(minor)) {
    const center = centerOf(mergeBounds(group));
    let target = major[0], best = Infinity;
    for (const candidate of major) {
      const gap = distance(center, centerOf(mergeBounds(candidate)));
      if (gap < best) { best = gap; target = candidate; }
    }
    target.push(...group); groups.splice(groups.indexOf(group), 1);
  }
  while (groups.length > limit) {
    const centers = groups.map(group => centerOf(mergeBounds(group)));
    let best = Infinity, a = 0, b = 1;
    for (let i = 0; i < groups.length; i++) for (let j = i + 1; j < groups.length; j++) {
      const gap = distance(centers[i], centers[j]);
      if (gap < best) { best = gap; a = i; b = j; }
    }
    groups[a].push(...groups[b]); groups.splice(b, 1);
  }
  groups[0].push(...invalid);
  return groups;
}

function ordered(items) {
  const pending = items.slice().sort((a, b) => a.start.x - b.start.x || a.start.y - b.start.y || a.index - b.index);
  if (pending.length > 600) return pending.map(item => item.entity);
  const result = [];
  let pen = pending[0]?.start;
  while (pending.length) {
    let nearest = 0, best = Infinity;
    for (let i = 0; i < pending.length; i++) {
      const gap = distance(pen, pending[i].start);
      if (gap < best) { nearest = i; best = gap; }
    }
    const item = pending.splice(nearest, 1)[0];
    result.push(item.entity); pen = item.end;
  }
  return result;
}

export function planReveal(entities, options = {}) {
  const list = Array.from(entities || []).filter(entity => entity && typeof entity === 'object');
  const immediate = reason => ({clusters: [], total: list.length, durationMs: 0, immediate: true, reason});
  if (list.length > 4000) return immediate('entity-limit');
  if (options.totalEntities > 200000) return immediate('document-limit');
  if (!list.length) return {clusters: [], total: 0, durationMs: 0, immediate: false};
  const blocks = new Map(), rest = [];
  const items = list.map((entity, index) => {
    const bounds = entityBounds(entity), [start, end] = endpoints(entity);
    return {entity, index, bounds, center: centerOf(bounds), start, end, key: classify(entity)};
  });
  for (const item of items) {
    const entity = item.entity;
    if (['block', 'insert'].includes(String(entity.sourceType || '').toLowerCase()) && entity.sourceId != null) {
      if (!blocks.has(entity.sourceId)) blocks.set(entity.sourceId, []);
      blocks.get(entity.sourceId).push(item);
    } else rest.push(item);
  }
  // Keep INSERTs intact. Too many independent blocks cannot meet both the 12-cluster
  // ceiling and the minimum presentation tick, so display them immediately.
  if (blocks.size > 12 || (blocks.size === 12 && rest.length)) return immediate('cluster-limit');
  const all = mergeBounds(items), cellSize = all ? Math.hypot(all.maxX - all.minX, all.maxY - all.minY) / 6 : 1;
  const groups = [...blocks.values(), ...spatialGroups(rest, cellSize, 12 - blocks.size)];
  const clusters = groups.map(group => ({bounds: mergeBounds(group),
    stages: REVEAL_STAGES.map(([key, label]) => ({key, label, items: ordered(group.filter(item => item.key === key))})).filter(stage => stage.items.length)}));
  clusters.sort((a, b) => !a.bounds ? 1 : !b.bounds ? -1 : b.bounds.maxY - a.bounds.maxY || a.bounds.minX - b.bounds.minX);
  const clusterMs = Number.isFinite(options.clusterMs) && options.clusterMs > 0 ? options.clusterMs : 3200;
  return {clusters, total: list.length,
    durationMs: Math.min(18000, Math.max(1200, clusters.length * clusterMs, list.length * 40)), immediate: false};
}

/** Returns a display copy and its pen point; the source entity is never edited. */
export function partialEntity(entity, fraction) {
  if (!entity) return {entity: null, pen: null};
  const t = Number.isFinite(fraction) ? Math.max(0, Math.min(1, fraction)) : 0;
  const type = String(entity.type || '').toLowerCase();
  if (t >= 1) return {entity, pen: copyPoint(endpoints(entity)[1])};
  if (!['line', 'lwpolyline', 'polyline', 'rectangle', 'arc', 'circle'].includes(type)) return {entity: null, pen: null};
  if (type === 'arc' || type === 'circle') {
    if (!validPoint(entity.center) || !Number.isFinite(entity.radius)) return {entity: null, pen: null};
    const startAngle = type === 'circle' ? 0 : entity.startAngle || 0;
    const endAngle = startAngle + (type === 'circle' ? 360 : arcSweep(entity)) * t;
    const pen = polarPoint(entity.center, entity.radius, endAngle);
    // A zero-sweep arc means a full circle to some renderers.
    return {entity: t === 0 ? null : {...entity, type: 'arc', center: copyPoint(entity.center), startAngle, endAngle}, pen};
  }
  const parts = pathSegments(entity);
  if (!parts.length) return {entity: null, pen: validPoint(entity.points?.[0]) ? copyPoint(entity.points[0]) : null};
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  let remaining = total * t, pen = copyPoint(parts[0].a);
  const points = [pen];
  for (const part of parts) {
    const fraction = part.length > EPS ? Math.min(1, remaining / part.length) : 1;
    // Canvas2D consumes points, not bulges. Sample the visible arc only; length and
    // the pen endpoint are still computed analytically from the original bulge.
    const steps = part.center ? Math.max(1, Math.ceil(Math.abs(part.sweep) * fraction / radians(5))) : 1;
    for (let i = 1; i <= steps; i++) points.push(part.at(fraction * i / steps));
    pen = points.at(-1);
    if (fraction < 1 || remaining <= part.length) break;
    remaining -= part.length;
  }
  const copy = {...entity, type: type === 'rectangle' ? 'polyline' : entity.type, closed: false, points};
  if (entity.start) copy.start = copyPoint(points[0]);
  if (entity.end) copy.end = copyPoint(pen);
  // Sampling has already consumed these curve descriptors.
  delete copy.bulges; delete copy.arcRuns;
  return {entity: copy, pen};
}
