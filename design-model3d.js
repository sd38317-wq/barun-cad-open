import * as THREE from './three.module.js';
import {drainModelWork,runModelWork} from './model-work.js';

// Common building model 0.1.x, millimetres. Only called when 3D is requested.
const EPS = 0.001;
const numeric = (value, fallback = 0) => value == null ? fallback : Number(value);
const point = p => ({x: Number(p?.x ?? p?.[0]), y: Number(p?.y ?? p?.[1])});
const validPoint = p => Number.isFinite(p.x) && Number.isFinite(p.y);
const ring = points => (points || []).map(point);
const storiesOf = model => model?.stories || model?.floors || model?.levels || [];
const storyId = (story, i) => String(story.id ?? story.key ?? 'story-' + (i + 1));
const elementsOf = model => model?.elements || [];
const wallsOf = model => model?.walls || elementsOf(model).filter(e => e.kind === 'wall');
const elementStory = element => String(element.story ?? element.storyId ?? element.floorId ?? element.levelId ?? '');
const wallId = (wall, i) => String(wall.id ?? wall.key ?? 'wall-' + (i + 1));
const wallPoints = wall => [point(wall.path?.[0] ?? wall.points?.[0] ?? wall.start ?? wall.a ?? wall.p1), point(wall.path?.[1] ?? wall.points?.[1] ?? wall.end ?? wall.b ?? wall.p2)];
const length = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);
const samePoint = (a, b) => length(a, b) <= EPS;
const inside = (p, polygon) => {
 let hit = false;
 for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
  const a = polygon[i], b = polygon[j];
  if ((a.y > p.y) !== (b.y > p.y) && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) hit = !hit;
 }
 return hit;
};
function storyTable(model) {
 let top = 0;
 return storiesOf(model).map((source, i) => {
  const elevation = numeric(source.elevation ?? source.z, top), height = numeric(source.height ?? source.floorHeight, 3000);
  if (!Number.isFinite(elevation) || !Number.isFinite(height) || height <= 0) throw Error('층 표고와 높이는 유효한 mm 값이어야 합니다.');
  const item = {source, id: storyId(source, i), name: String(source.name ?? storyId(source, i)), elevation, height};
  top = elevation + height;return item;
 });
}
function frame(wall) {
 const [a, b] = wallPoints(wall), len = length(a, b), thickness = numeric(wall.thickness, 200);
 if (!validPoint(a) || !validPoint(b) || len <= EPS || !Number.isFinite(thickness) || thickness <= 0) throw Error('벽 기준선과 두께가 잘못되었습니다: ' + (wall.id || ''));
 const u = {x: (b.x - a.x) / len, y: (b.y - a.y) / len}, n = {x: -u.y, y: u.x};
 const offset = wall.reference === 'left-face' ? -thickness / 2 : wall.reference === 'right-face' ? thickness / 2 : 0;
 return {a, b, len, thickness, u, n, center: {x: a.x + n.x * offset, y: a.y + n.y * offset}};
}
function exteriorNormal(model, wall, f = frame(wall)) {
 if (wall.exterior === false) return null;
 const supplied = wall.outwardNormal ?? wall.props?.outwardNormal;
 if (supplied) {
  const p = point(supplied), size = Math.hypot(p.x, p.y);
  if (!validPoint(p) || size <= EPS || Math.abs((p.x * f.u.x + p.y * f.u.y) / size) > 0.001) throw Error('외벽 바깥 방향은 벽에 수직이어야 합니다.');
  return {x: p.x / size, y: p.y / size};
 }
 const mid = {x: f.center.x + f.u.x * f.len / 2, y: f.center.y + f.u.y * f.len / 2};
 const probe = f.thickness / 2 + 1;
 const outlines = elementsOf(model).filter(e => elementStory(e) === elementStory(wall) && ['slab', 'mass'].includes(e.kind) && e.outline?.length >= 3).map(e => ring(e.outline));
 for (const outline of outlines) {
  const left = inside({x: mid.x + f.n.x * probe, y: mid.y + f.n.y * probe}, outline);
  const right = inside({x: mid.x - f.n.x * probe, y: mid.y - f.n.y * probe}, outline);
  if (left !== right) return left ? {x: -f.n.x, y: -f.n.y} : {...f.n};
 }
 // Legacy models may omit exterior. Infer only boundary walls, or honor an explicit exterior flag.
 const points = wallsOf(model).filter(w => elementStory(w) === elementStory(wall)).flatMap(wallPoints).filter(validPoint);
 const center = points.length ? {x: points.reduce((sum, p) => sum + p.x, 0) / points.length, y: points.reduce((sum, p) => sum + p.y, 0) / points.length} : mid;
 const projections = points.map(p => (p.x - mid.x) * f.n.x + (p.y - mid.y) * f.n.y);
 if (wall.exterior !== true && projections.some(v => v > EPS) && projections.some(v => v < -EPS)) return null;
 const sign = (mid.x - center.x) * f.n.x + (mid.y - center.y) * f.n.y >= 0 ? 1 : -1;
 return {x: f.n.x * sign, y: f.n.y * sign};
}
const openingsFor = (model, wall) => [...elementsOf(model).filter(e => ['window', 'door'].includes(e.kind) && e.host === wall.id), ...(wall.openings || wall.holes || [])];
function openingRects(model, wall, f, height) {
 return openingsFor(model, wall).map(o => {
  const x0 = Math.max(0, numeric(o.offset)), x1 = Math.min(f.len, numeric(o.offset) + numeric(o.width));
  const z0 = Math.max(0, numeric(o.sill, o.kind === 'window' ? 900 : 0) - numeric(wall.baseOffset));
  const z1 = Math.min(height, numeric(o.sill, o.kind === 'window' ? 900 : 0) + numeric(o.height, o.kind === 'window' ? 1200 : 2100) - numeric(wall.baseOffset));
  return {x0, x1, z0, z1};
 }).filter(o => o.x1 > o.x0 && o.z1 > o.z0);
}
function wallSpans(len, height, openings) {
 const xs = [...new Set([0, len, ...openings.flatMap(o => [o.x0, o.x1])])].sort((a, b) => a - b), spans = [];
 for (let i = 1; i < xs.length; i++) {
  const x0 = xs[i - 1], x1 = xs[i], cuts = openings.filter(o => o.x0 < x1 && o.x1 > x0).sort((a, b) => a.z0 - b.z0);
  let z = 0;
  for (const cut of cuts) {if (cut.z0 > z) spans.push({x0, x1, z0: z, z1: cut.z0});z = Math.max(z, cut.z1);}
  if (height > z) spans.push({x0, x1, z0: z, z1: height});
 }
 return spans;
}
function rectangle(f, x0 = 0, x1 = f.len) {
 const at = (x, n) => ({x: f.center.x + f.u.x * x + f.n.x * n, y: f.center.y + f.u.y * x + f.n.y * n});
 return [at(x0, -f.thickness / 2), at(x1, -f.thickness / 2), at(x1, f.thickness / 2), at(x0, f.thickness / 2)];
}
function parapetOf(element, assemblies) {
 const value = element.parapet ?? element.props?.parapet;
 if (!value && !element.parapetHeight && !element.props?.parapetHeight) return null;
 const entry = typeof value === 'object' ? value : assemblies?.parapets?.[value];
 // Existing drawing assembly IDs encode both dimensions (for example rc200-h1000).
 const named = typeof value === 'string' ? value.match(/^rc([0-9.]+)-h([0-9.]+)$/) : null;
 const height = numeric(entry?.height ?? element.parapetHeight ?? element.props?.parapetHeight, named ? Number(named[2]) : 0);
 const thickness = numeric(entry?.thickness ?? element.parapetThickness ?? element.props?.parapetThickness, named ? Number(named[1]) : 200);
 return height > 0 && thickness > 0 ? {height, thickness} : null;
}
// A slab at an upper storey's base closes the storey below. Its edit must move that surface.
function slabTarget(slab, story, table) {
 if (Math.abs(numeric(slab.topOffset) - story.height) <= EPS) return story.id;
 if (Math.abs(numeric(slab.topOffset)) > EPS) return null;
 const below = table.filter(s => s.elevation < story.elevation - EPS).sort((a, b) => b.elevation - a.elevation)[0];
 return below?.id || null;
}

export function buildDesignModel3D(model,options={}) {return drainModelWork(buildDesignModel3DSteps(model,options));}
export function buildDesignModel3DAsync(model,options={},work={}) {return runModelWork(buildDesignModel3DSteps(model,options,!!work.onProgress),work);}
export function* buildDesignModel3DSteps(model, {setId = null, floors, assemblies} = {},progress=false) {
 const table = storyTable(model), byStory = new Map(table.map(s => [s.id, s]));
 const wanted = floors === undefined ? null : new Set(floors), accepted = s => s && (!wanted || wanted.has(s.name) || wanted.has(s.id));
 const group = new THREE.Group(), solids = [];
 group.name = 'Design JSON geometry (metres)';group.userData.setId = setId;
 const materials = new Map();
 const material = color => {
  if (!materials.has(color)) materials.set(color, new THREE.MeshStandardMaterial({color, roughness: 0.85}));
  return materials.get(color);
 };
 const add = ({id, kind, outline, holes = [], z, height, story, color = '#d7d9da', pushPull}) => {
  if (outline?.length < 3 || !outline?.every(validPoint) || !Number.isFinite(z) || !Number.isFinite(height) || height <= 0) return;
  const shape = new THREE.Shape(outline.map(p => new THREE.Vector2(p.x / 1000, p.y / 1000)));
  for (const hole of holes.map(ring)) if (hole.length >= 3 && hole.every(validPoint)) shape.holes.push(new THREE.Path(hole.map(p => new THREE.Vector2(p.x / 1000, p.y / 1000))));
  const geometry = new THREE.ExtrudeGeometry(shape, {depth: height / 1000, bevelEnabled: false, steps: 1});
  geometry.rotateX(-Math.PI / 2);geometry.translate(0, z / 1000, 0);
  const mesh = new THREE.Mesh(geometry, material(color));mesh.name = id;
  mesh.userData = {objectId: id, kind, storyId: story.id, ...(pushPull ? {pushPull} : {})};
  mesh.castShadow = kind !== 'space';mesh.receiveShadow = true;group.add(mesh);
  solids.push({id, kind, outline, z, height, storyId: story.id, ...(pushPull ? {pushPull} : {})});
 };
 const storyEdit = id => id ? {setId, target: {type: 'story', id}, normal: {x: 0, y: 0, z: 1}} : undefined;
 let complete=false;try {
 const walls=wallsOf(model),elements=elementsOf(model),cores=elements.filter(e=>e.kind==='core'),otherElements=elements.filter(e=>e.kind!=='wall'&&e.kind!=='core');
 const total=walls.length+cores.length+otherElements.length;let done=0;
 const tick=()=>progress?{phase:'objects',label:'3D 객체 만들기',done:++done,total,unit:'개'}:undefined;
 let wallCount = 0;
 for (const [i, wall] of walls.entries()) {
  try {
  const story = byStory.get(elementStory(wall)) || (!elementStory(wall) ? table[0] : null);if (!accepted(story)) continue;
  const f = frame(wall), height = numeric(wall.height, story.height), z = story.elevation + numeric(wall.baseOffset);
  if (!Number.isFinite(height) || height <= 0) throw Error('벽 높이가 잘못되었습니다: ' + wall.id);
  const normal = exteriorNormal(model, wall, f), id = wallId(wall, i), pushPull = normal ? {setId, target: {type: 'wall', id}, normal} : undefined;
  for (const part of wallSpans(f.len, height, openingRects(model, wall, f, height))) add({id, kind: 'wall', outline: rectangle(f, part.x0, part.x1), z: z + part.z0, height: part.z1 - part.z0, story, pushPull});
  wallCount++;
  } finally {yield tick();}
 }
 const coreMembers = new Set();
 for (const core of cores) {
  const members = (core.members || []).map(id => elements.find(e => e.id === id)).filter(Boolean);
  const stories = core.story != null ? [byStory.get(String(core.story))] : [...new Set(members.map(e => byStory.get(elementStory(e))).filter(Boolean))];
  for (const story of stories) {
   if (!accepted(story)) continue;
   const onStory = members.filter(e => elementStory(e) === story.id), points = onStory.flatMap(e => ring(e.outline));
   let outline = ring(core.outline);
   if (outline.length < 3 && points.length) {const xs = points.map(p => p.x), ys = points.map(p => p.y);outline = [{x: Math.min(...xs), y: Math.min(...ys)}, {x: Math.max(...xs), y: Math.min(...ys)}, {x: Math.max(...xs), y: Math.max(...ys)}, {x: Math.min(...xs), y: Math.max(...ys)}];}
   if (outline.length < 3) continue;
   add({id: core.id, kind: 'core', outline, holes: core.holes, z: story.elevation, height: numeric(core.height, story.height), story, color: '#a8b1b6'});
   for (const e of onStory) if (['stair', 'elevator'].includes(e.kind)) coreMembers.add(e.id);
  }
  yield tick();
 }
 for (const element of otherElements) {
  try {
  const story = byStory.get(elementStory(element));if (!accepted(story)) continue;
  const outline = ring(element.outline), common = {id: element.id, outline, holes: element.holes, story};
  if (element.kind === 'slab' || element.kind === 'roof') {
   const top = story.elevation + numeric(element.topOffset), thickness = numeric(element.thickness, 200), kind = element.role === 'roof' || element.kind === 'roof' ? 'roof' : 'slab';
   add({...common, kind, z: top - thickness, height: thickness, color: kind === 'roof' ? '#9ca9b1' : '#bdc7cd', pushPull: storyEdit(slabTarget(element, story, table))});
   const parapet = kind === 'roof' ? parapetOf(element, assemblies) : null;
   if (parapet) for (let i = 0; i < outline.length; i++) {
    const a = outline[i], b = outline[(i + 1) % outline.length];if (samePoint(a, b)) continue;
    const edge = frame({id: element.id, path: [a, b], thickness: parapet.thickness});
    add({id: element.id + ':parapet:' + i, kind: 'parapet', outline: rectangle(edge), z: top, height: parapet.height, story, color: '#b2bbc0'});
   }
  } else if (element.kind === 'mass') {
   add({...common, kind: 'mass', z: story.elevation, height: numeric(element.height, story.height), color: '#cbd5da', pushPull: storyEdit(element.height == null || Math.abs(element.height - story.height) <= EPS ? story.id : null)});
  } else if (element.kind === 'space') {
   const floor = elements.find(e => e.kind === 'slab' && e.role !== 'roof' && elementStory(e) === story.id && Math.abs(numeric(e.topOffset)) <= EPS);
   add({...common, kind: 'space', z: story.elevation + 1, height: 1, color: element.props?.color || element.color || (element.unit ? '#9dcbe0' : '#d6e3d7'), pushPull: storyEdit(floor ? slabTarget(floor, story, table) : null)});
  } else if (['stair', 'elevator'].includes(element.kind) && !coreMembers.has(element.id)) {
   add({...common, kind: element.kind, z: story.elevation, height: numeric(element.height, story.height), color: '#a8b1b6'});
  } else if (element.kind === 'column') {
   const p = point(element.position), angle = numeric(element.rotation) * Math.PI / 180, w = numeric(element.width) / 2, d = numeric(element.depth) / 2;
   const corners = [[-w, -d], [w, -d], [w, d], [-w, d]].map(([x, y]) => ({x: p.x + x * Math.cos(angle) - y * Math.sin(angle), y: p.y + x * Math.sin(angle) + y * Math.cos(angle)}));
   add({...common, outline: corners, kind: 'column', z: story.elevation, height: numeric(element.height, story.height), color: '#c5c9cc'});
  }
  } finally {yield tick();}
 }
 // Optional storey outlines are useful for early models without explicit slabs.
 const acceptedStories=table.filter(accepted);let storyDone=0;
 for (const story of acceptedStories) {
  const outline = ring(story.source.outline || story.source.footprint || story.source.polygon);
  if (outline.length >= 3 && !elements.some(e => elementStory(e) === story.id && ['slab', 'mass'].includes(e.kind))) add({id: story.id + ':mass', kind: 'mass', outline, z: story.elevation, height: story.height, story, pushPull: storyEdit(story.id)});
  yield progress?{phase:'mesh',label:'층 외곽 확인',done:++storyDone,total:acceptedStories.length,unit:'층'}:undefined;
 }
 complete=true;return {setId, group, box: new THREE.Box3().setFromObject(group), siteEdges: [], wallCount, floors: table.filter(accepted).sort((a, b) => a.elevation - b.elevation).map(s => s.name), levels: table.filter(accepted).map(s => s.elevation / 1000).sort((a, b) => a - b), floorLevels: Object.fromEntries(table.filter(accepted).map(s => [s.name, s.elevation / 1000])), solids};
 } finally {if(!complete){group.traverse(o=>o.geometry?.dispose());for(const material of materials.values())material.dispose();}}
}
function setWallPoint(wall, index, p) {
 const replace = old => Array.isArray(old) ? [p.x, p.y] : {...old, x: p.x, y: p.y};
 if (wall.path) wall.path[index] = replace(wall.path[index]);
 else if (wall.points) wall.points[index] = replace(wall.points[index]);
 else {const key = index === 0 ? (wall.start ? 'start' : wall.a ? 'a' : 'p1') : (wall.end ? 'end' : wall.b ? 'b' : 'p2');wall[key] = replace(wall[key]);}
}
export function pushPullDesignModel(model, target, distance, {snap = 10} = {}) {
 if (typeof distance !== 'number' || !Number.isFinite(distance)) throw Error('밀고 당길 거리는 유한한 mm 숫자여야 합니다.');
 if (typeof snap !== 'number' || !Number.isFinite(snap) || snap < 0) throw Error('스냅 간격이 잘못되었습니다.');
 if (!target || !['story', 'wall'].includes(target.type) || typeof target.id !== 'string' || !target.id) throw Error('대상 층 또는 벽 id가 필요합니다.');
 const d = snap > 0 ? Math.round(distance / snap) * snap : distance, out = structuredClone(model), table = storyTable(out);
 if (target.type === 'story') {
  const story = table.find(s => s.id === target.id);if (!story) throw Error('대상 층을 찾을 수 없습니다: ' + target.id);
  const next = story.height + d;if (!Number.isFinite(next) || next <= 0) throw Error('층 높이는 0mm보다 커야 합니다.');
  story.source.height = next;
  for (const above of table.filter(s => s.elevation > story.elevation + EPS)) above.source.elevation = above.elevation + d;
  for (const element of elementsOf(out).filter(e => elementStory(e) === story.id)) {
   const followsHeight = element.height == null || Math.abs(element.height - story.height) <= EPS;
   if (element.height != null && followsHeight && ['wall', 'mass', 'stair', 'elevator', 'column', 'core'].includes(element.kind)) element.height = next;
   if (element.kind === 'stair' && followsHeight) {
    if (Number.isFinite(element.rise)) element.rise *= next / story.height;
    for (const surface of [...(element.treads || []), ...(element.landings || [])]) if (Number.isFinite(surface.top)) surface.top *= next / story.height;
   }
   if (['slab', 'roof'].includes(element.kind) && Math.abs(numeric(element.topOffset) - story.height) <= EPS) element.topOffset = next;
  }
  return out;
 }
 const walls = wallsOf(out), index = walls.findIndex((w, i) => wallId(w, i) === target.id);
 if (index < 0) throw Error('대상 벽을 찾을 수 없습니다: ' + target.id);
 const wall = walls[index], f = frame(wall), normal = exteriorNormal(out, wall, f);
 if (!normal) throw Error('외벽 바깥면만 밀고 당길 수 있습니다.');
 const old = walls.map(wallPoints), shift = p => ({x: p.x + normal.x * d, y: p.y + normal.y * d});
 setWallPoint(wall, 0, shift(f.a));setWallPoint(wall, 1, shift(f.b));
 for (const [i, neighbor] of walls.entries()) {
  if (i === index || elementStory(neighbor) !== elementStory(wall)) continue;
  for (let j = 0; j < 2; j++) {
   const p = old[i][j], along = (p.x - f.a.x) * f.u.x + (p.y - f.a.y) * f.u.y;
   const cross = (p.x - f.a.x) * f.n.x + (p.y - f.a.y) * f.n.y;
   if (Math.abs(cross) <= EPS && along >= -EPS && along <= f.len + EPS) setWallPoint(neighbor, j, shift(p));
  }
  const current = wallPoints(neighbor);
  if ((!samePoint(current[0], old[i][0]) || !samePoint(current[1], old[i][1])) && (neighbor.outwardNormal || neighbor.props?.outwardNormal)) {
   const source = neighbor.outwardNormal || neighbor.props.outwardNormal, prior = point(source);
   const oldDirection = {x: old[i][1].x - old[i][0].x, y: old[i][1].y - old[i][0].y};
   const sign = prior.x * -oldDirection.y + prior.y * oldDirection.x >= 0 ? 1 : -1;
   const nextFrame = frame(neighbor), rotated = {x: nextFrame.n.x * sign, y: nextFrame.n.y * sign};
   const value = Array.isArray(source) ? [rotated.x, rotated.y] : {...source, ...rotated};
   if (neighbor.outwardNormal) neighbor.outwardNormal = value;else neighbor.props.outwardNormal = value;
  }
  const beforeLength = length(...old[i]), afterLength = length(...current);
  if (afterLength <= EPS) throw Error('연결된 벽 길이가 0이 되는 이동은 할 수 없습니다.');
  for (const opening of openingsFor(out, neighbor)) {
   const end = numeric(opening.offset) + numeric(opening.width);
   if (end <= beforeLength + EPS && end > afterLength + EPS) throw Error('연결된 벽의 창·문이 벽 밖으로 나가는 이동은 할 수 없습니다.');
  }
 }
 return out;
}
