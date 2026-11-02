import * as G from './geometry.js';
import {partialEntity} from './ai-draw-reveal.js';

// Presentation only: never mutates a drawing, history or GPU scene.
export function revealDisplayEntities(doc, added, limit = 4000) {
  const blocks = added.filter(entity => ['block', 'insert'].includes(entity.type));
  if (blocks.length > 12 || (blocks.length === 12 && added.length > blocks.length)) return null;
  const layers = new Map(doc.layers.map(layer => [layer.id, layer]));
  let count = 0;
  // Bound expansion before the normal display resolver materializes an INSERT.
  const countLeaves = (entity, parentLayer, stack = new Set()) => {
    const own = layers.get(entity.layer), layer = own?.name === '0' && parentLayer ? parentLayer : own;
    if (entity.hidden || !layer?.visible || layer.frozen) return;
    if (entity.type !== 'block') { count++; return; }
    if (entity.sharedBlock && stack.has(entity.sharedBlock)) { count = limit + 1; return; }
    const definition = doc.sharedBlocks?.[entity.sharedBlock], next = new Set(stack);
    if (entity.sharedBlock) next.add(entity.sharedBlock);
    for (const list of [definition?.entities || [], entity.entities || []]) for (const child of list) {
      countLeaves(child, layer, next);
      if (count > limit) return;
    }
  };
  for (const entity of added) { countLeaves(entity); if (count > limit) return null; }
  const result = [];
  const flatten = (entity, source, masks = [], parentLayer = null) => {
    const own=layers.get(entity.layer), layer=own?.name==='0'&&parentLayer?parentLayer:own;
    if (entity.type === 'block') {
      const clips = entity.clip?.enabled ? [...masks, entity.clip] : masks;
      for (const child of entity._visibleEntities || entity.entities || []) flatten(child, source, clips, layer);
    } else {
      result.push({...entity, _displayColor:entity._displayColor, _displayLinetype:entity._displayLinetype,
        _displayLineweight:entity._displayLineweight, _displayLinetypeScale:entity._displayLinetypeScale, sourceId: source.id, sourceType: source.type,
        layerName: layer?.name || entity.layer,
        clipMasks: masks.length ? [...(entity.clipMasks || []), ...masks] : entity.clipMasks});
    }
  };
  const byId = new Map(added.map(entity => [entity.id, entity]));
  for (const entity of G.visibleEntities(doc, {inPlace: true, lodScale: 0, viewBox: null, entities: added})) {
    flatten(entity, byId.get(entity.id) || entity);
    if (result.length > limit) return null;
  }
  return result;
}

export function revealTimeline(plan) {
  if (!plan.clusters.length || !plan.durationMs) return [];
  const timeline = [], clusterMs = plan.durationMs / plan.clusters.length;
  for (let clusterIndex = 0; clusterIndex < plan.clusters.length; clusterIndex++) {
    const cluster = plan.clusters[clusterIndex];
    const stages = cluster.stages.map(stage => ({...stage, cluster, clusterIndex, slots: 1}));
    if (!stages.length) continue;
    const count = stages.reduce((sum, stage) => sum + stage.items.length, 0);
    const capacity = Math.max(stages.length, Math.floor(clusterMs / 40));
    let remaining = Math.min(capacity, count) - stages.length;
    // Preserve the cluster's budget; a dense cluster groups items within its phases.
    while (remaining-- > 0) {
      let best = null;
      for (const stage of stages) if (stage.slots < stage.items.length &&
        (!best || stage.items.length / stage.slots > best.items.length / best.slots)) best = stage;
      if (!best) break;
      best.slots++;
    }
    const totalSlots = stages.reduce((sum, stage) => sum + stage.slots, 0), tickMs = clusterMs / totalSlots;
    let slot = 0;
    for (const stage of stages) {
      for (let i = 0; i < stage.slots; i++, slot++) {
        const start = Math.floor(i * stage.items.length / stage.slots), end = Math.floor((i + 1) * stage.items.length / stage.slots);
        timeline.push({...stage, items: stage.items.slice(start, end),
          startMs: clusterIndex * clusterMs + slot * tickMs,
          endMs: clusterIndex * clusterMs + (slot + 1) * tickMs});
      }
    }
  }
  return timeline;
}

export function createRevealPlayer({plan, stage, getView, setView, createCanvas,
  draw, render, onFinish, requestFrame = callback => requestAnimationFrame(callback),
  cancelFrame = id => cancelAnimationFrame(id)}) {
  const cache = createCanvas(), cacheCtx = cache.getContext('2d');
  const boxes = plan.clusters.map(cluster => cluster.bounds).filter(box => box &&
    ['minX','minY','maxX','maxY'].every(key => Number.isFinite(box[key])) && box.minX <= box.maxX && box.minY <= box.maxY);
  const allBounds = boxes.reduce((all, box) => all ? ({minX:Math.min(all.minX,box.minX), minY:Math.min(all.minY,box.minY),
    maxX:Math.max(all.maxX,box.maxX), maxY:Math.max(all.maxY,box.maxY)}) : {...box}, null);
  const safeRect = view => ({left: view.width * .08, right: view.width * .92,
    top: view.revealTop ?? 60, bottom: view.fitHeight - view.height * .08});
  const contains = (box, view) => {
    const rect = safeRect(view);
    return box && box.minX * view.scale + view.origin.x >= rect.left &&
      box.maxX * view.scale + view.origin.x <= rect.right &&
      view.origin.y - box.maxY * view.scale >= rect.top && view.origin.y - box.minY * view.scale <= rect.bottom;
  };
  const needsApproach = (box, view) => box && (!contains(box, view) ||
    (box.maxX - box.minX) * (box.maxY - box.minY) * view.scale ** 2 < view.width * view.fitHeight * .15);
  // Reserve the flights inside the presentation budget; drawing time pauses during each flight.
  const reserveMs = plan.clusters.length === 1 && !needsApproach(allBounds, getView()) ? 0 : 1000 + (plan.clusters.length - 1) * 700;
  const minimumMs = Math.max(0, ...plan.clusters.map(cluster => cluster.stages.length * 40)) * plan.clusters.length;
  const timeline = revealTimeline({...plan, durationMs: Math.max(minimumMs, plan.durationMs - reserveMs)});
  // Non-path details have no partial ink. Show their first whole slot on arrival,
  // while retaining normal whole-object timing for later annotation phases.
  const pathTypes = new Set(['line', 'lwpolyline', 'polyline', 'rectangle', 'arc', 'circle']);
  const arrivalSlots = new Set(timeline.filter((slot, i) =>
    (!i || timeline[i - 1].clusterIndex !== slot.clusterIndex) &&
    slot.items.every(item => !pathTypes.has(String(item.type || '').toLowerCase()))));
  const drawMasked = (target, entity, view) => {
    const masks=entity.clipMasks;
    if(!masks?.length){draw(target,entity);return;}
    target.save();
    for(const mask of masks){
      target.beginPath();if(mask.inverted)target.rect(-1e9,-1e9,2e9,2e9);
      mask.points.forEach((point,i)=>{const x=point.x*view.scale+view.origin.x,y=view.origin.y-point.y*view.scale;
        if(i)target.lineTo(x,y);else target.moveTo(x,y);});
      target.closePath();target.clip('evenodd');
    }
    draw(target,entity);target.restore();
  };
  let start = null, lastRender = -Infinity, frame = null, closed = false, completed = 0,
    index = 0, activeCluster = -1, activePhase = '', cacheKey = '', cached = 0, camera = null, retreating = false, pausedMs = 0;
  const completedItems = [];
  const player = {followCamera: true, progress: 0, plan,
    stopCamera() {
      player.followCamera = false;
      if (camera) { if (!retreating) pausedMs += Math.max(0, lastRender - camera.stamp); camera = null; setView({...getView(), moving: false}); }
    },
    destroy() {
      if (closed) return;
      closed = true;
      if (frame !== null) cancelFrame(frame);
      frame = null;
      if (camera) setView({...getView(), moving: false});
      camera = null; cache.width = cache.height = 0;
    },
    paint(ctx) {
      if (closed) return;
      const view = getView(), ratio = view.pixelRatio;
      const key = [view.width, view.height, ratio, view.scale, view.origin.x, view.origin.y].join();
      if (key !== cacheKey) {
        cacheKey = key; cached = 0;
        cache.width = Math.round(view.width * ratio); cache.height = Math.round(view.height * ratio);
        cacheCtx.setTransform(ratio, 0, 0, ratio, 0, 0);
      }
      while (cached < completedItems.length) drawMasked(cacheCtx, completedItems[cached++], view);
      ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.drawImage(cache, 0, 0); ctx.restore();
      const current = timeline[index];
      if (!current || activeCluster !== current.clusterIndex || retreating || (camera && !camera.ink) || player.progress < current.startMs) return;
      const fraction = arrivalSlots.has(current) ? 1 : Math.max(0, Math.min(1, (player.progress - current.startMs) / (current.endMs - current.startMs)));
      let pen = null;
      for (const item of current.items) {
        const partial = partialEntity(item, fraction);
        if (partial.entity) drawMasked(ctx, partial.entity, view);
        if (partial.pen) pen = partial.pen;
      }
      if (pen) {
        const x = pen.x * view.scale + view.origin.x, y = view.origin.y - pen.y * view.scale;
        ctx.save(); ctx.strokeStyle = ctx.fillStyle = '#9dcbe0'; ctx.lineWidth = 1; ctx.setLineDash([]);
        ctx.beginPath(); ctx.moveTo(x - 5, y); ctx.lineTo(x + 5, y); ctx.moveTo(x, y - 5); ctx.lineTo(x, y + 5); ctx.stroke();
        ctx.beginPath(); ctx.arc(x, y, 1.5, 0, Math.PI * 2); ctx.fill(); ctx.restore();
      }
    }
  };
  const moveTo = (box, stamp, final = false) => {
    if (!box || !player.followCamera) return false;
    const view = getView();
    if ((!final || plan.clusters.length === 1) && !needsApproach(box, view)) return false;
    const fit = bounds => {
      const box = bounds, rect = safeRect(view);
      const scale = Math.max(1e-8, Math.min(500, Math.min(Math.max(1, rect.right - rect.left) / Math.max(1, box.maxX - box.minX),
        Math.max(1, rect.bottom - rect.top) / Math.max(1, box.maxY - box.minY))));
      const origin = {x: (rect.left + rect.right) / 2 - (box.minX + box.maxX) / 2 * scale,
        y: (rect.top + rect.bottom) / 2 + (box.minY + box.maxY) / 2 * scale};
      return {scale, origin};
    };
    const {scale, origin} = fit(box);
    if (Math.abs(scale - view.scale) < 1e-9 && Math.abs(origin.x - view.origin.x) < 1e-7 && Math.abs(origin.y - view.origin.y) < 1e-7) return false;
    const previous = plan.clusters[activeCluster - 1]?.bounds, rect = safeRect(view);
    const outside = box.maxX * view.scale + view.origin.x < rect.left || box.minX * view.scale + view.origin.x > rect.right ||
      view.origin.y - box.minY * view.scale < rect.top || view.origin.y - box.maxY * view.scale > rect.bottom;
    const via = !final && previous && outside ? fit({minX:Math.min(previous.minX,box.minX),minY:Math.min(previous.minY,box.minY),
      maxX:Math.max(previous.maxX,box.maxX),maxY:Math.max(previous.maxY,box.maxY)}) : null;
    camera = {stamp, from: view, scale, origin, via, duration: via ? 700 : 500, ink: !final && !!previous && !via};
    // A nearby tiny detail can zoom past the previous ink before arrival.
    if(camera.ink)arrivalSlots.add(timeline[index]);
    return true;
  };
  const complete = () => { try { onFinish(); } finally { player.destroy(); } };
  const tick = stamp => {
    if (closed) return;
    frame = requestFrame(tick);
    if (stamp - lastRender < 1000 / 30) return;
    lastRender = stamp;
    if (start === null) start = stamp;
    if (!camera && !retreating) {
      const target = Math.max(0, stamp - start - pausedMs);
      while (index < timeline.length && timeline[index].endMs <= target &&
          timeline[index].clusterIndex === activeCluster) {
        completedItems.push(...timeline[index].items); completed += timeline[index].items.length; index++;
      }
      const current = timeline[index];
      if (current) {
        if (activeCluster !== current.clusterIndex) {
          activeCluster = current.clusterIndex; activePhase = '';
          player.progress = current.startMs;
          moveTo(current.cluster.bounds, start + pausedMs + current.startMs);
        }
        if (!camera) player.progress = target;
        if (activePhase !== current.key) {
          activePhase = current.key;
          stage.push({phase: current.key, label: current.label,
            detail: (current.clusterIndex + 1) + '/' + plan.clusters.length + ' 도면 · ' + current.label, source: 'presentation'});
        }
      } else {
        retreating = true;
        player.progress = timeline.at(-1)?.endMs || 0;
        if (!moveTo(allBounds, start + pausedMs + player.progress, true)) { complete(); return; }
      }
    }
    if (camera) {
      const fraction = Math.max(0, Math.min(1, (stamp - camera.stamp) / camera.duration));
      const approaching = camera.via && fraction >= .4;
      const from = approaching ? camera.via : camera.from, to = camera.via && !approaching ? camera.via : camera;
      const leg = camera.via ? (approaching ? (fraction - .4) / .6 : fraction / .4) : fraction;
      const ease = 1 - (1 - leg) ** 3;
      // The first stroke is visible from the shared overview onward. It remains
      // whole on arrival, so approaching never leaves an empty gap or retracts ink.
      if (approaching) { camera.ink = true; arrivalSlots.add(timeline[index]); }
      setView({scale: from.scale + (to.scale - from.scale) * ease,
        origin: {x: from.origin.x + (to.origin.x - from.origin.x) * ease,
          y: from.origin.y + (to.origin.y - from.origin.y) * ease}, moving: fraction < 1});
      if (fraction === 1) {
        if (!retreating) pausedMs += camera.duration;
        camera = null;
      }
    }
    stage.setProgress(completed, plan.total); render();
    if (retreating && !camera) complete();
  };
  const order = ['base','structure','layers','hatch','dims','leaders','text','title'];
  stage.setPhases(plan.clusters.flatMap(cluster => cluster.stages)
    .filter((phase, i, all) => all.findIndex(p => p.key === phase.key) === i)
    .sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key)));
  frame = requestFrame(tick);
  return player;
}
