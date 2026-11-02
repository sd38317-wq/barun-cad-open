import { primitives, ellipsePoints } from './geometry.js';
import {canSimplifyGpuPolyline,simplifyGpuPolyline,gpuPolylineBounds} from './gpu-polyline-lod.js';
import {resolveTransparency} from './gpu-transparency.js';

// tessellation never exceeds this many segments per curve
export const GPU_MAX_CURVE_SEGMENTS = 16384;

// Segment count compileGpuScene uses for a curve at a given scale. It depends
// only on the curve's on-screen size, so zooming usually leaves it unchanged
// (a sub-pixel arc keeps its 2 segments at any overview zoom).
export function gpuCurveSegments(e, scale) {
  const tol = 0.25 / Math.max(Math.abs(Number(scale)) || 1, 1e-12);
  if (e.type === 'ellipse') {
    const a = Math.hypot(e.majorAxis?.x || 0, e.majorAxis?.y || 0), radius = Math.max(a, a * Math.abs(e.ratio || 0));
    return Math.min(GPU_MAX_CURVE_SEGMENTS, Math.max(16, Math.ceil(2 * Math.PI / Math.max(2 * Math.acos(Math.max(-1, Math.min(1, 1 - tol / Math.max(radius, tol)))), 1e-6))));
  }
  const r = Math.abs(e.radius || 0);
  if (!r || !Number.isFinite(r)) return 0;
  const sweep = e.type === 'arc' ? ((e.endAngle - e.startAngle + 360) % 360) * Math.PI / 180 : Math.PI * 2;
  return Math.min(GPU_MAX_CURVE_SEGMENTS, Math.max(2, Math.ceil(Math.abs(sweep) / Math.max(2 * Math.acos(Math.max(-1, Math.min(1, 1 - tol / r))), 1e-6))));
}

// Smallest scale above which gpuCurveSegments(e, scale) exceeds `segments`.
// Inverts step = 2*acos(1 - tol/r) with tol = 0.25/scale.
export function gpuCurveNextScale(e, segments) {
  let r, sweep;
  if (e.type === 'ellipse') {
    const a = Math.hypot(e.majorAxis?.x || 0, e.majorAxis?.y || 0);
    r = Math.max(a, a * Math.abs(e.ratio || 0)); sweep = Math.PI * 2;
  } else {
    r = Math.abs(e.radius || 0);
    sweep = e.type === 'arc' ? ((e.endAngle - e.startAngle + 360) % 360) * Math.PI / 180 : Math.PI * 2;
  }
  if (!r || !Number.isFinite(r) || !(segments >= 1)) return Infinity;
  if (segments >= GPU_MAX_CURVE_SEGMENTS) return Infinity;   // capped: a finer scale builds the same curve
  const theta = Math.abs(sweep) / (2 * segments);
  if (theta >= Math.PI) return 0;
  const gap = 1 - Math.cos(theta);
  return gap > 0 ? 0.25 / (r * gap) : Infinity;
}

// Compile the already-resolved visible scene into renderer-neutral primitives.
// This module deliberately has no canvas/Three dependency.
export function compileGpuScene(entities, { scale = 1, origin = { x: 0, y: 0 }, polylineLod = true } = {}) {
  const items = [], unsupported = [], maskKeys = new WeakMap();
  const tol = 0.25 / Math.max(Math.abs(Number(scale)) || 1, 1e-12);
  const point = p => ({ x: p.x - (origin.x || 0), y: p.y - (origin.y || 0) });
  const tessellate = (e, start, sweep) => {
    const r = Math.abs(e.radius || 0);
    if (!r || !Number.isFinite(r)) return [point(e.center)];
    const c = Math.max(-1, Math.min(1, 1 - tol / r));
    const step = 2 * Math.acos(c);
    // A huge arc keeps the segment cap (the sagitta grows a little) instead of failing the whole drawing.
    const n = Math.min(GPU_MAX_CURVE_SEGMENTS, Math.max(2, Math.ceil(Math.abs(sweep) / Math.max(step, 1e-6))));
    return Array.from({ length: n + 1 }, (_, i) => {
      const a = start + sweep * i / n;
      return point({ x: e.center.x + r * Math.cos(a), y: e.center.y + r * Math.sin(a) });
    });
  };
  const tessellateEllipse = e => {
    const a = Math.hypot(e.majorAxis?.x || 0, e.majorAxis?.y || 0);
    const b = a * Math.abs(e.ratio || 0);
    const radius = Math.max(a, b);
    const n = Math.min(GPU_MAX_CURVE_SEGMENTS, Math.max(16, Math.ceil(2 * Math.PI / Math.max(2 * Math.acos(Math.max(-1, Math.min(1, 1 - tol / Math.max(radius, tol)))), 1e-6))));
    return ellipsePoints(e, n).map(point);
  };
  const emit = (e, sourceId, parentStyle = {}, clipMasks = []) => {
    const base = { sourceId, clipMasks, clipKey: clipMasks.length ? (maskKeys.get(clipMasks) || (maskKeys.set(clipMasks, JSON.stringify(clipMasks)), maskKeys.get(clipMasks))) : '', color: e._displayColor ?? e.color ?? parentStyle.color, lineweight: e._displayLineweight ?? e.lineweight ?? parentStyle.lineweight, linetype: e._displayLinetype ?? e.linetype ?? parentStyle.linetype, linetypeScale: e._displayLinetypeScale ?? e.linetypeScale ?? parentStyle.linetypeScale, constantWidth: e.constantWidth };
    // ACAD200 121: 투명도(0~90%)는 값이 있는 항목에만 붙인다(대부분의 도면은 비용 0).
    if (e.transparency != null || parentStyle.transparency) { const t = resolveTransparency(e, parentStyle.transparency); if (t) base.transparency = t; }
    if (e.type === 'line' || e.type === 'polyline' || e.type === 'rectangle') {
      if (!Array.isArray(e.points)) { unsupported.push({ id: sourceId, type: e.type, reason: 'points' }); return; }
      const full=e.points.map(point),eligible=polylineLod&&canSimplifyGpuPolyline(e,base,clipMasks),closed=!!e.closed || e.type === 'rectangle';
      // WebGL line primitives do not rasterize a degenerate segment. Preserve
      // the source LINE for selection/snap, but compile its render item as a
      // screen-sized point (the GPU point path emits a tiny segment).
      if(e.type==='line'&&full.length===2&&full[0].x===full[1].x&&full[0].y===full[1].y){
        items.push({...base,type:'point',position:full[0]}); return;
      }
      if(!eligible){items.push({ ...base, type: 'polyline', points: full, closed }); return;}
      const simplified=simplifyGpuPolyline(full,scale),item={ ...base, type: 'polyline', points: simplified, closed, lodCount: full.length, lodBounds: gpuPolylineBounds(full) };
      // The full-resolution vertices are recomputed from the source polyline
      // when a refinement needs them (lodPoints reads through to it). Keeping a
      // rebased copy of every vertex doubled the heap of a 25M-vertex plan.
      // A refined or translated copy stores plain points again (the setter).
      if(simplified===full)item.lodPoints=full;
      else{const source=e,ox=origin.x||0,oy=origin.y||0;Object.defineProperty(item,'lodPoints',{configurable:true,enumerable:true,get(){return source.points.map(q=>({x:q.x-ox,y:q.y-oy}));},set(value){Object.defineProperty(item,'lodPoints',{value,writable:true,configurable:true,enumerable:true});}});}
      items.push(item); return;
    }
    if (e.type === 'circle') { items.push({ ...base, type: 'polyline', curve: e, points: tessellate(e, 0, Math.PI * 2), closed: true }); return; }
    if (e.type === 'arc') { items.push({ ...base, type: 'polyline', curve: e, points: tessellate(e, e.startAngle * Math.PI / 180, ((e.endAngle - e.startAngle + 360) % 360) * Math.PI / 180), closed: false }); return; }
    if (e.type === 'ellipse') { items.push({ ...base, type: 'polyline', curve: e, points: tessellateEllipse(e), closed: false }); return; }
    if (e.type === 'point') { items.push({ ...base, type: 'point', position: point(e.position) }); return; }
    if (e.type === 'text' || e.type === 'hatch') { items.push({ ...base, type: e.type, entity: structuredClone(e), position: e.position ? point(e.position) : undefined }); return; }
    unsupported.push({ id: sourceId, type: e.type, reason: 'unknown' });
  };
  const visit = (e, sourceId = e.id, parentStyle = {}, parentMasks = []) => {
    let clipMasks = parentMasks;
    if (e.clip?.enabled) {
      const points = e.clip.points;
      if (!Array.isArray(points) || points.length < 3 || points.some(p => !Number.isFinite(p?.x) || !Number.isFinite(p?.y))) {
        // A degenerate clip path shows nothing on the canvas either.
        unsupported.push({ id: sourceId, type: e.type, reason: 'invalid clip' }); return;
      }
      // Keep masks in the same rebased coordinate frame as GPU positions.
      // The fragment shader clips lines, fills and text identically, including
      // nested/inverted masks; no editable entity or curve is changed.
      // The mask shader holds at most 8192 vertices: a longer outline is clipped by its bounding box.
      const maskPoints = points.length > 8192 ? (() => { let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity; for (const p of points) { a = Math.min(a, p.x); b = Math.min(b, p.y); c = Math.max(c, p.x); d = Math.max(d, p.y); } return [{ x: a, y: b }, { x: c, y: b }, { x: c, y: d }, { x: a, y: d }]; })() : points;
      clipMasks = [...parentMasks, { points: maskPoints.map(point), inverted: !!e.clip.inverted }];
    }
    if (e.type === 'block') {
      const style = { color: e._displayColor ?? e.color ?? parentStyle.color, lineweight: e._displayLineweight ?? e.lineweight ?? parentStyle.lineweight, linetype: e._displayLinetype ?? e.linetype ?? parentStyle.linetype, linetypeScale: e._displayLinetypeScale ?? e.linetypeScale ?? parentStyle.linetypeScale };
      if (e.transparency != null || parentStyle.transparency) style.transparency = resolveTransparency(e, parentStyle.transparency);
      for (const child of e._visibleEntities || e.entities || []) visit(child, sourceId, style, clipMasks);
      return;
    }
    const own = { color: e._displayColor ?? e.color, lineweight: e._displayLineweight ?? e.lineweight, linetype: e._displayLinetype ?? e.linetype, linetypeScale: e._displayLinetypeScale ?? e.linetypeScale };
    const style = { ...parentStyle, ...Object.fromEntries(Object.entries(own).filter(([, value]) => value !== undefined)) };
    for (const p of (e.type === 'dimension' || e.type === 'wall' ? primitives(e) : [e])) emit(p, sourceId, style, clipMasks);
  };
  for (const e of entities || []) visit(e);
  return { items, unsupported };
}
