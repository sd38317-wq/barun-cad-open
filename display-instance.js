const registry = new WeakMap();
// History retains canonical objects for up to 100 edits. A weak value avoids
// retaining expanded geometry for every snapshot; collected displays fall back
// to normal expansion. Live displays still reuse their prepared child indexes.
const retainedArtifacts = new WeakMap();
const allowed = new Set(['id','type','layer','name','sharedBlock','scale','rotation','color','colorMode','linetype','lineweight','linetypeScale','hidden','sourceHandle','sourceFingerprint','aci','position','entities']);
const finitePoint = point => point && Number.isFinite(point.x) && Number.isFinite(point.y);
const finiteBounds = bounds => bounds && ['minX','minY','maxX','maxY'].every(key => Number.isFinite(bounds[key]));
const signature = entity => JSON.stringify(Object.fromEntries(Object.keys(entity || {}).filter(key => !['id','position','entities'].includes(key)).sort().map(key => [key, entity[key]])));
// A retained display is the tree computed for this very reference, so any
// scale, rotation, clip or mirror may be kept: the signature covers every key
// but id/position/entities, and the anchor covers position. Only translated
// instances (createDisplayInstance) need the plain, untransformed form below.
const retainableCanonical = (entity, definitions) => entity?.type === 'block' && typeof entity.sharedBlock === 'string' && definitions && Object.prototype.hasOwnProperty.call(definitions, entity.sharedBlock) && finitePoint(entity.position) && !entity.parameters && !entity.xref && Array.isArray(entity.entities) && entity.entities.length === 0;
const validCanonical = (entity, definitions) => retainableCanonical(entity, definitions) && entity.scale === 1 && entity.rotation === 0 && !entity.clip && Object.keys(entity).every(key => allowed.has(key));
export function hasDisplayArtifact(display) { return !!display && registry.has(display); }
export function getDisplayInstance(root) { const artifact = root && registry.get(root); return artifact?.instance ? artifact : null; }
export function getRetainedDisplayArtifact(canonical, context) {
  if (!retainableCanonical(canonical, context?.definitions)) return null;
  const display = retainedArtifacts.get(canonical)?.deref(), artifact = display && registry.get(display);
  // Lazy roots (moved or restyled references) materialize their children once
  // and never change afterwards; expanded trees are frozen.
  const at = artifact?.position || artifact?.anchor;
  return artifact && (Object.isFrozen(display) || artifact.lazy) && artifact.definitions === context.definitions &&
    artifact.styleKey === context.styleKey && artifact.signature === signature(canonical) &&
    display.id === canonical.id && at.x === canonical.position.x && at.y === canonical.position.y
    ? display : null;
}
// Keys that change how a reference's children are drawn but not where: its
// colour, linetype, lineweight and layer (children on layer 0 follow it).
const STYLE_KEYS = new Set(['color', 'colorMode', 'aci', 'linetype', 'lineweight', 'linetypeScale', 'layer']);
const shapeSignature = entity => JSON.stringify(Object.fromEntries(Object.keys(entity || {}).filter(key => !['id', 'position', 'entities'].includes(key) && !STYLE_KEYS.has(key)).sort().map(key => [key, entity[key]])));
// CHPROP of a placed reference (colour, layer, linetype): the displayed tree of
// the same reference at the same place is restyled lazily instead of expanding
// its definition again (a floor block holds 100k primitives).
// restyle(display) returns the display's children under the new style.
// One edit resolves every copied reference against the same candidates (COPY of
// 12,205 shared references): index them once instead of scanning all per reference.
// Built per call of visibleEntities(), so registrations made later are never missed.
export function indexDisplayCandidates(candidates) {
  const bySignature = new Map(), byId = new Map(), add = (map, key, value) => { const list = map.get(key); if (list) list.push(value); else map.set(key, [value]); };
  for (const candidate of candidates) {
    const entry = candidate && registry.get(candidate);
    if (!entry) continue;
    add(bySignature, entry.signature, entry);
    add(byId, candidate.id, candidate);
  }
  return { bySignature, byId };
}
const indexOf = candidates => Array.isArray(candidates) ? indexDisplayCandidates(candidates) : candidates;
export function restyleDisplayInstance(canonical, context, candidates, { restyle, style } = {}) {
  if (typeof restyle !== 'function' || !style || !retainableCanonical(canonical, context?.definitions) || typeof context.styleKey !== 'string' || !candidates?.byId && !Array.isArray(candidates)) return null;
  const shape = shapeSignature(canonical);
  const display = (indexOf(candidates).byId.get(canonical.id) || []).find(candidate => {
    const entry = candidate && registry.get(candidate);
    return entry && entry.definitions === context.definitions && candidate.id === canonical.id && candidate.type === 'block' && finiteBounds(candidate._renderBounds) &&
      candidate.position?.x === canonical.position.x && candidate.position?.y === canonical.position.y && (entry.shape ?? shapeSignature(entry.canonical)) === shape;
  });
  if (!display) return null;
  let children;
  const root = { ...canonical, _displayColor: style.color, _displayLinetype: style.linetype, _displayLineweight: style.lineweight, _displayLinetypeScale: style.linetypeScale, _renderBounds: { ...display._renderBounds } };
  Object.defineProperty(root, 'entities', { configurable: true, enumerable: true, get() { if (children === undefined) { children = restyle(display); Object.defineProperty(root, 'entities', { value: children, writable: true, configurable: true, enumerable: true }); } return children; } });
  registerLazyArtifact(root, canonical, context);
  return root;
}
function registerLazyArtifact(root, canonical, context) {
  const anchor = Object.freeze({ x: canonical.position.x, y: canonical.position.y });
  registry.set(root, { source: root, lazy: true, canonical: Object.freeze(structuredClone(canonical)), definitions: context.definitions, styleKey: context.styleKey, signature: signature(canonical), shape: shapeSignature(canonical), anchor, bounds: Object.freeze({ ...root._renderBounds }) });
  retainedArtifacts.set(canonical, new WeakRef(root));
}
export function registerDisplayArtifact(display, canonical, context = {}) {
  if (!display || !retainableCanonical(canonical, context.definitions) || typeof context.styleKey !== 'string' || !finitePoint(display.position) || !finiteBounds(display._renderBounds)) return false;
  const anchor = Object.freeze({ x: display.position.x, y: display.position.y });
  const bounds = Object.freeze({ ...display._renderBounds });
  registry.set(display, { source: display, canonical: Object.freeze(structuredClone(canonical)), definitions: context.definitions, styleKey: context.styleKey, signature: signature(canonical), shape: shapeSignature(canonical), anchor, bounds });
  retainedArtifacts.set(canonical, new WeakRef(display));
  return true;
}
export function createDisplayInstance(canonical, context, candidates, { materialize } = {}) {
  if (typeof materialize !== 'function' || !retainableCanonical(canonical, context?.definitions) || typeof context.styleKey !== 'string' || !candidates?.bySignature && !Array.isArray(candidates)) return null;
  // The signature covers every key but id/position/entities: a moved reference
  // or a copy (COPY, ARRAY) with the same scale, rotation, mirror and clip has
  // the same tree up to a translation. The plain shape is required only of
  // copies whose signature carries keys outside the known INSERT keys.
  const plain = validCanonical(canonical, context.definitions) || Object.keys(canonical).every(key => allowed.has(key) || key === 'mirror');
  const artifact = (indexOf(candidates).bySignature.get(signature(canonical)) || []).find(entry => entry.definitions === context.definitions && entry.styleKey === context.styleKey && (plain || entry.canonical.id === canonical.id));
  if (!artifact) return null;
  const dx = canonical.position.x - artifact.anchor.x, dy = canonical.position.y - artifact.anchor.y, source = artifact.source;
  let children;
  const root = { ...canonical, _displayColor: source._displayColor, _displayLinetype: source._displayLinetype, _displayLineweight: source._displayLineweight, _displayLinetypeScale: source._displayLinetypeScale, _renderBounds: { minX: artifact.bounds.minX + dx, minY: artifact.bounds.minY + dy, maxX: artifact.bounds.maxX + dx, maxY: artifact.bounds.maxY + dy } };
  Object.defineProperty(root, 'entities', { configurable: true, enumerable: true, get() { if (children === undefined) { children = materialize(source, dx, dy, canonical.id); Object.defineProperty(root, 'entities', { value: children, writable: true, configurable: true, enumerable: true }); } return children; } });
  registry.set(root, { instance: true, source, canonical: artifact.canonical, definitions: artifact.definitions, styleKey: artifact.styleKey, signature: artifact.signature, shape: artifact.shape, anchor: artifact.anchor, dx, dy, bounds: artifact.bounds, primitiveCache: new WeakMap() });
  // The moved reference itself finds this root again in a later full pass.
  if (canonical.id === artifact.canonical.id) { registry.get(root).lazy = true; registry.get(root).position = Object.freeze({ x: canonical.position.x, y: canonical.position.y }); retainedArtifacts.set(canonical, new WeakRef(root)); }
  return root;
}
