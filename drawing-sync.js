// AI 도면의 손 편집을 설계 JSON 에 거꾸로 적는다(가벼운 순수 함수 — 화면·Worker 어디서나).
// 만들 때 객체마다 지문·중심·원본 요소(src)를 기억해 두고(baseline), 지금 도면과 비교한다.
//   창·문 옮김 → 벽을 따라 offset, 계단 옮김 → 윤곽 이동, 세대 칠 늘림 → 윤곽·면적, 요소의 객체를 모두 지움 → 요소 삭제.
//   벽 평행 이동·확실한 한쪽 면 이동은 path/thickness 로, 임의 윤곽·단면·입면·치수 손 편집은 lost 로 센다.
//   같은 평면으로 묶어 그린 층(2~3층)은 같은 자리의 요소에 똑같이 적는다.
export const ownedBy = (e, setId) => e.drawingSet?.id === setId && e.drawingSet.entity === e.id;

export function entityHash(e) {
  // 타입 팔레트는 생성기가 정하는 표현값. 색만 바뀌어도 윤곽 편집으로 읽지 않는다.
  const paletteFill = e.type === 'hatch' && (e.drawingRole === 'unitFill' || e.drawingRole === 'unitLegend');
  const json = JSON.stringify(e, (k, v) => (k === 'id' || k === 'drawingSet' || k.startsWith('_') || (paletteFill && k === 'color') ? undefined : v));
  let h = 0x811c9dc5;
  for (let i = 0; i < json.length; i++) {h ^= json.charCodeAt(i);h = Math.imul(h, 0x01000193);}
  return (h >>> 0).toString(36);
}
function entityPoints(e) {
  const out = [...(e.points || [])];
  for (const k of ['position', 'center', 'insertion']) if (e[k]) out.push(e[k]);
  return out;
}
export function entityCenter(e) {
  const ps = entityPoints(e);
  if (!ps.length) return [0, 0];
  const xs = ps.map((p) => p.x), ys = ps.map((p) => p.y);
  // 0.001 mm: 0.1 mm 로 자르면 x.x5 가운데에서 되돌린 윤곽이 0.1 mm 어긋난다
  const r3 = (v) => Math.round(v * 1000) / 1000;
  return [r3((Math.min(...xs) + Math.max(...xs)) / 2), r3((Math.min(...ys) + Math.max(...ys)) / 2)];
}
const r1 = (v) => Math.round(v * 10) / 10;

/** 만든 객체마다 [지문, 중심 x, 중심 y, 원본 요소 id?, 벽 출처·배치·원래 윤곽?] */
export function baselineOf(entities, sources = {}) {
  const out = {};
  for (const e of entities) {const [x, y] = entityCenter(e);const src = sources[e.id];out[e.id] = src?.wallIds ? [entityHash(e), x, y, null, {...src, shape: {points: e.points, loops: e.loops}, shapeHash: entityHash({...e, points: undefined, loops: undefined})}] : src ? [entityHash(e), x, y, src] : [entityHash(e), x, y];}
  return out;
}

/** 같은 평면으로 묶어 그리는 층. 새 생성기는 세대 윤곽·타입도 같을 때만 묶는다. 타입 없는 호출은 옛 baseline 호환. */
export function planGroups(model, spaceTypes) {
  const walls = (sid) => model.elements.filter((e) => e.kind === 'wall' && e.story === sid);
  const floors = [...model.stories].sort((a, b) => a.elevation - b.elevation).filter((s) => walls(s.id).length), groups = [];
  for (const s of floors) {const units = spaceTypes ? model.elements.filter((e) => e.story === s.id && spaceTypes.has(e.id)).map((e) => JSON.stringify([e.outline, spaceTypes.get(e.id).key, e.area ?? null])).sort() : null;
    const sig = JSON.stringify([walls(s.id).map((w) => w.path), units, model.elements.filter((e) => e.kind === 'column' && e.story === s.id).map((c) => [c.position, c.width, c.depth, c.material])]), last = groups.at(-1);if (last && last.sig === sig) last.stories.push(s.id);else groups.push({sig, stories: [s.id]});}   // 기둥이 다른 층은 같은 평면으로 묶지 않는다(구조 형식 2026-10-30)
  return groups.map((g) => g.stories);
}
// 다른 층의 "같은 자리" 요소: 창·문은 같은 경로의 벽 + 같은 offset·폭, 계단·세대는 같은 윤곽
function twinKey(model, e) {
  if (e.kind === 'window' || e.kind === 'door') return JSON.stringify([e.kind, model.elements.find((w) => w.id === e.host)?.path, e.offset, e.width]);
  if (e.kind === 'wall') return JSON.stringify([e.kind, e.path, e.thickness]);
  return JSON.stringify([e.kind, e.outline]);
}
// 창·문은 story 가 없고 붙은 벽의 층을 따른다
const storyOf = (model, e) => e.story ?? model.elements.find((w) => w.id === e.host)?.story;
const polygonArea = (ring) => Math.abs(ring.reduce((n, p, i) => {const q = ring[(i + 1) % ring.length];return n + p[0] * q[1] - q[0] * p[1];}, 0)) / 2;

export function pendingEdits(doc, setId) {
  const rec = doc.drawingSets?.[setId];
  if (!rec) throw Error(`도면 묶음 "${setId}" 이 이 도면에 없습니다.`);
  if (!rec.baseline) return {model: rec.model, changes: [], lost: 0};
  const now = new Map(doc.entities.filter((e) => ownedBy(e, setId)).map((e) => [e.id, e]));
  // 묶음 도형이 하나도 없으면 도면을 지운 것이지 설계를 고친 것이 아니다(2026-10-25: 화면을 전부 지운 뒤 다시 그리자 창·문·실이 설계에서 빠지고 벽만 남았다)
  if (!now.size) return {model: rec.model, changes: [], lost: 0, erased: true};
  const byElement = new Map();let lost = 0;
  for (const [id, [hash, cx, cy, src]] of Object.entries(rec.baseline)) {
    const e = now.get(id), edited = !e || entityHash(e) !== hash;
    if (rec.baseline[id][4]?.wallIds) continue;
    if (!src) {if (edited) lost++;continue;}
    const g = byElement.get(src) || {entities: [], edited: 0};byElement.set(src, g);
    g.entities.push({id, e, edited, base: [cx, cy]});if (edited) g.edited++;
  }
  let model = structuredClone(rec.model);
  const changes = [], el = (id) => model.elements.find((x) => x.id === id);
  const proposals = new Map(), invalid = new Set();
  for (const [id, base] of Object.entries(rec.baseline)) {
    const meta = base[4];if (!meta?.wallIds) continue;
    const e = now.get(id);if (e && entityHash(e) === base[0]) continue;
    const edit = interpretWallShape(rec, e, meta);
    if (!edit || (!edit.dx && !edit.dy && edit.thickness === undefined)) {lost++;meta.wallIds.forEach((w) => invalid.add(w));continue;}
    for (const wallId of meta.wallIds) {
      const list = proposals.get(wallId) || [];list.push({id, edit});proposals.set(wallId, list);
    }
  }
  const rejected = new Set(), junctions = new Map();
  // 동일 원래 접점에 서로 다른 새 위치가 제안되면 추측하지 않는다.
  for (const [wallId, list] of proposals) {
    if (invalid.has(wallId) || list.some((p) => JSON.stringify(p.edit) !== JSON.stringify(list[0].edit))) {list.forEach((p) => rejected.add(p.id));continue;}
    const w = rec.model.elements.find((w) => w.id === wallId), edit = list[0].edit;
    for (const p of w.path) {
      const key = JSON.stringify([w.story, p]), at = [r1(p[0] + edit.dx), r1(p[1] + edit.dy)], prev = junctions.get(key);
      if (prev && !closePoint(prev.at, at)) {prev.ids.forEach((id) => rejected.add(id));list.forEach((p) => rejected.add(p.id));}
      junctions.set(key, {at, ids: [...(prev?.ids || []), ...list.map((p) => p.id)]});
    }
  }
  // 한 merged 객체의 일부 벽만 반영하지 않도록 거절을 연결된 제안에 전파한다.
  let again = true;
  while (again) {again = false;for (const list of proposals.values()) if (list.some((p) => rejected.has(p.id))) for (const p of list) if (!rejected.has(p.id)) {rejected.add(p.id);again = true;}}
  const wallChanges = [], explicit = new Map();
  for (const [wallId, list] of proposals) {
    if (list.some((p) => rejected.has(p.id))) continue;
    const orig = rec.model.elements.find((w) => w.id === wallId), edit = list[0].edit;
    const spec = {path: orig.path.map((p) => [r1(p[0] + edit.dx), r1(p[1] + edit.dy)]), thickness: edit.thickness ?? orig.thickness};
    try {
      const r = editModelWall(model, wallId, spec, rec.kind === 'set', rec.model, false);model = r.model;
      const group = rec.kind === 'set' ? planGroups(rec.model).find((g) => g.includes(orig.story)) || [orig.story] : [orig.story];
      for (const w of rec.model.elements) if (w.id === wallId || w.kind === 'wall' && group.includes(w.story) && twinKey(rec.model, w) === twinKey(rec.model, orig)) explicit.set(w.id, spec);
      wallChanges.push({element: wallId, kind: 'wall', action: edit.thickness === undefined ? 'move' : 'thickness', floors: r.floors, text: '벽 ' + wallId + ' 손 편집 반영'});
    } catch {list.forEach((p) => rejected.add(p.id));}
  }
  for (const [id, spec] of explicit) {const w = el(id);w.path = structuredClone(spec.path);w.thickness = spec.thickness;}
  if (model.elements.some((w) => w.kind === 'wall' && wallLength(w) < 1) || rejected.size && explicit.size) {
    // 일괄 적용 실패는 모델을 부분 변경하지 않는다.
    model = structuredClone(rec.model);for (const list of proposals.values()) list.forEach((p) => rejected.add(p.id));
  } else changes.push(...wallChanges);
  lost += rejected.size;
  const groups = rec.kind === 'set' ? rec.planGroups || planGroups(rec.model) : [];
  const apply = (orig, fn) => {   // 원래 요소와 같은 평면 묶음의 쌍둥이 요소에 똑같이
    const story = storyOf(rec.model, orig), group = groups.find((g) => g.includes(story)) || [story], key = twinKey(rec.model, orig);
    const targets = rec.model.elements.filter((x) => x.kind === orig.kind && group.includes(storyOf(rec.model, x)) && (x.id === orig.id || twinKey(rec.model, x) === key));
    for (const t of targets) fn(el(t.id));
    return targets.length;
  };
  for (const [src, g] of byElement) {
    if (!g.edited) continue;
    const orig = rec.model.elements.find((x) => x.id === src);
    if (!orig) {lost += g.edited;continue;}
    const label = orig.unit || orig.id;
    if (g.entities.every((x) => !x.e)) {   // 다 지움 → 요소 삭제
      const n = apply(orig, (x) => {model.elements = model.elements.filter((y) => y !== x);});
      changes.push({element: src, kind: orig.kind, action: 'delete', floors: n, text: `${label} 삭제`});continue;
    }
    const deltas = g.entities.filter((x) => x.e).map((x) => {const c = entityCenter(x.e);return [c[0] - x.base[0], c[1] - x.base[1]];});
    const same = deltas.every((d) => Math.abs(d[0] - deltas[0][0]) < 1 && Math.abs(d[1] - deltas[0][1]) < 1) && g.entities.every((x) => x.e);
    const [dx, dy] = deltas[0];
    if (orig.kind === 'space') {   // 칠(해치)의 꼭짓점이 바뀌면 그 모양이 새 윤곽
      const fill = g.entities.find((x) => x.e?.type === 'hatch');
      if (!fill || !fill.edited) {lost += g.edited;continue;}   // 글자만 옮김 — 다시 만들면 가운데로
      const xs = orig.outline.map((p) => p[0]), ys = orig.outline.map((p) => p[1]);
      const ox = fill.base[0] - (Math.min(...xs) + Math.max(...xs)) / 2, oy = fill.base[1] - (Math.min(...ys) + Math.max(...ys)) / 2;
      const outline = fill.e.points.map((p) => [r1(p.x - ox), r1(p.y - oy)]), area = Math.round(polygonArea(outline) / 1e3) / 1e3;
      const n = apply(orig, (x) => {x.outline = structuredClone(outline);if (x.area !== undefined) x.area = area;});
      changes.push({element: src, kind: 'space', action: 'reshape', floors: n, area, text: `${label} 모양 바꿈(${area}㎡)`});continue;
    }
    if (!same) {lost += g.edited;continue;}   // 일부만 고침 — 설계로 읽을 수 없다
    if (orig.kind === 'window' || orig.kind === 'door') {
      const old = rec.model.elements.find((x) => x.id === orig.host), w = el(orig.host);
      if (!w) {lost += g.edited;continue;}
      const [a, b] = w.path, len = wallLength(w), u = [(b[0] - a[0]) / len, (b[1] - a[1]) / len], oldLen = wallLength(old);
      const anchor = [old.path[0][0] + (old.path[1][0] - old.path[0][0]) / oldLen * orig.offset + dx - a[0], old.path[0][1] + (old.path[1][1] - old.path[0][1]) / oldLen * orig.offset + dy - a[1]];
      const offset = r1(anchor[0] * u[0] + anchor[1] * u[1]), across = Math.abs(-anchor[0] * u[1] + anchor[1] * u[0]), along = offset - orig.offset;
      if (across > (w.thickness || 200) / 2 || offset < 0 || offset + orig.width > len) {lost += g.edited;continue;}   // 벽을 벗어남
      const n = apply(orig, (x) => {x.offset = offset;});
      changes.push({element: src, kind: orig.kind, action: 'move', floors: n, offset, text: `${orig.kind === 'window' ? '창' : '문'} ${src} ${Math.round(along)}mm 옮김`});continue;
    }
    if (orig.kind === 'stair') {
      const n = apply(orig, (x) => {x.outline = x.outline.map((p) => [r1(p[0] + dx), r1(p[1] + dy)]);});
      changes.push({element: src, kind: 'stair', action: 'move', floors: n, text: `계단 ${src} 옮김`});continue;
    }
    lost += g.edited;
  }
  return {model, changes, lost, warnings: wallOpeningWarnings(model)};
}

// 벽 손잡이는 선택된 AI 벽만 조회한다. 도면에 객체를 추가하지 않는다.
const closePoint = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]) < 0.11;
const wallLength = (w) => Math.hypot(w.path[1][0] - w.path[0][0], w.path[1][1] - w.path[0][1]);
export function wallSource(doc, entity) {
  const setId = entity.drawingSet?.id, rec = doc.drawingSets?.[setId];
  if (!rec || !ownedBy(entity, setId)) return null;
  const base = rec.baseline?.[entity.id], src = base?.[4];
  if (src?.wallIds) return {...src, setId};
  const wall = rec.model.elements.find((w) => w.id === base?.[3] && w.kind === 'wall');
  if (wall) return {setId, wallIds: [wall.id], origin: [rec.options?.origin?.x || 0, rec.options?.origin?.y || 0]};
  const layer = doc.layers.find((l) => l.id === entity.layer)?.name;
  if (rec.kind !== 'plan' || !['polyline', 'line', 'hatch'].includes(entity.type) || !['A-WALL', 'A-WALL-CONC'].includes(layer)) return null;
  return {setId, wallIds: rec.model.elements.filter((w) => w.kind === 'wall' && w.story === (rec.options?.story || rec.model.stories[0].id)).map((w) => w.id), origin: [rec.options?.origin?.x || 0, rec.options?.origin?.y || 0]};
}
export function wallEditingGrips(doc, entity) {
  const src = wallSource(doc, entity);
  if (!src) return null;
  const rec = doc.drawingSets[src.setId], [ox, oy] = src.origin;
  const shapeEdit = src.shape ? interpretWallShape(rec, entity, src) : null;
  const walls = new Map(rec.model.elements.filter((w) => w.kind === 'wall').map((w) => [w.id, w]));
  return src.wallIds.flatMap((id) => {
    let w = walls.get(id);
    if (w && shapeEdit) w = {...w, path: w.path.map((p) => [r1(p[0] + shapeEdit.dx), r1(p[1] + shapeEdit.dy)]), thickness: shapeEdit.thickness ?? w.thickness};
    if (!w || !(wallLength(w) > 0)) return [];
    const [a, b] = w.path, len = wallLength(w), n = [-(b[1] - a[1]) / len, (b[0] - a[0]) / len];
    const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], gripPath = w.path.map(([x, y]) => ({x: r1(x + ox), y: r1(y + oy)}));
    return [a, b, mid, [mid[0] + n[0] * w.thickness / 2, mid[1] + n[1] * w.thickness / 2]].map((p, i) => ({point: {x: r1(p[0] + ox), y: r1(p[1] + oy)}, aiWall: true, path: gripPath, setId: src.setId, wallId: id, origin: src.origin, role: ['start', 'end', 'move', 'thickness'][i]}));
  });
}
export function wallOpeningWarnings(model) {
  const warnings = [];
  for (const o of model.elements.filter((e) => e.kind === 'window' || e.kind === 'door')) {
    const w = model.elements.find((e) => e.id === o.host && e.kind === 'wall');
    if (w && (o.offset < 0 || o.offset + o.width > wallLength(w) + 0.1)) warnings.push({element: o.id, wall: w.id, text: '창·문 ' + o.id + '이 벽 ' + w.id + ' 밖으로 나갑니다(offset 유지).'});
  }
  return warnings;
}
export function editModelWall(model, wallId, edit, grouped = false, topology = model, validate = true) {
  const orig = topology.elements.find((e) => e.id === wallId && e.kind === 'wall');
  if (!orig || orig.path?.length !== 2) throw Error('편집할 직선 벽이 없습니다.');
  const out = structuredClone(model), group = grouped ? planGroups(topology).find((g) => g.includes(orig.story)) || [orig.story] : [orig.story];
  const targets = topology.elements.filter((w) => w.kind === 'wall' && (w.id === wallId || group.includes(w.story) && twinKey(topology, w) === twinKey(topology, orig)));
  const path = edit.path || orig.path, thickness = edit.thickness ?? orig.thickness;
  if (path.length !== 2 || !path.flat().every(Number.isFinite) || !Number.isFinite(thickness) || !(thickness > 0) || Math.hypot(path[1][0] - path[0][0], path[1][1] - path[0][1]) < 1) throw Error('벽 길이와 두께는 0보다 커야 합니다.');
  for (const t of targets) {
    const w = out.elements.find((e) => e.id === t.id);w.path = path.map((p) => p.map(r1));w.thickness = r1(thickness);
    for (let i = 0; i < 2; i++) if (!closePoint(t.path[i], w.path[i])) {
      for (const neighbor of topology.elements.filter((e) => e.kind === 'wall' && e.story === t.story && e.id !== t.id)) {
        const dest = out.elements.find((e) => e.id === neighbor.id);
        neighbor.path.forEach((p, j) => {if (closePoint(p, t.path[i])) dest.path[j] = [...w.path[i]];});
      }
    }
  }
  if (validate && out.elements.some((w) => w.kind === 'wall' && wallLength(w) < 1)) throw Error('이어진 벽의 길이가 0이 됩니다.');
  return {model: out, floors: targets.length, warnings: wallOpeningWarnings(out)};
}
export function prepareWallGrip(doc, grip, point) {
  const rec = doc.drawingSets?.[grip.setId];
  if (!rec) throw Error('AI 도면 묶음이 없습니다.');
  const pending = pendingEdits(doc, grip.setId);
  if (pending.lost) throw Error('설계로 옮길 수 없는 손 편집이 있습니다. AIREDRAW로 먼저 확인하세요.');
  const wall = pending.model.elements.find((w) => w.id === grip.wallId && w.kind === 'wall');
  if (!wall) throw Error('벽이 삭제되었습니다.');
  const p = [r1(point.x - grip.origin[0]), r1(point.y - grip.origin[1])], path = structuredClone(wall.path);
  const mid = [(path[0][0] + path[1][0]) / 2, (path[0][1] + path[1][1]) / 2];
  let thickness = wall.thickness;
  if (grip.role === 'start' || grip.role === 'end') path[grip.role === 'start' ? 0 : 1] = p;
  else if (grip.role === 'move') {const d = [p[0] - mid[0], p[1] - mid[1]];path.forEach((q) => {q[0] += d[0];q[1] += d[1];});}
  else if (grip.role === 'thickness') {const len = wallLength(wall);thickness = 2 * ((p[0] - mid[0]) * -(path[1][1] - path[0][1]) / len + (p[1] - mid[1]) * (path[1][0] - path[0][0]) / len);}
  else throw Error('알 수 없는 벽 손잡이입니다.');
  return editModelWall(pending.model, wall.id, {path, thickness}, rec.kind === 'set');
}
function interpretWallShape(rec, entity, meta) {
  if (!entity || entityHash({...entity, points: undefined, loops: undefined}) !== meta.shapeHash) return null;
  const before = [meta.shape.points, ...(meta.shape.loops || [])], after = [entity.points, ...(entity.loops || [])];
  if (before.length !== after.length || before.some((r, i) => !r || r.length !== after[i]?.length)) return null;
  const pairs = before.flatMap((r, i) => r.map((p, j) => [p, after[i][j]]));
  if (!pairs.length) return null;
  const delta = pairs.map(([a, b]) => [r1(b.x - a.x), r1(b.y - a.y)]), [dx, dy] = delta[0];
  if (delta.every((d) => closePoint(d, [dx, dy]))) return {dx, dy};
  if (meta.wallIds.length !== 1) return null;
  const w = rec.model.elements.find((e) => e.id === meta.wallIds[0]), len = wallLength(w), [a, b] = w.path;
  const u = [(b[0] - a[0]) / len, (b[1] - a[1]) / len], n = [-u[1], u[0]], sides = [[], []];
  for (const [p, q] of pairs) {
    const across = (p.x - meta.origin[0] - a[0]) * n[0] + (p.y - meta.origin[1] - a[1]) * n[1];
    if (Math.abs(Math.abs(across) - w.thickness / 2) > 0.11) return null;
    const d = [q.x - p.x, q.y - p.y];
    if (Math.abs(d[0] * u[0] + d[1] * u[1]) > 0.11) return null;
    sides[across > 0 ? 1 : 0].push(d[0] * n[0] + d[1] * n[1]);
  }
  if (sides.some((s) => !s.length || s.some((v) => Math.abs(v - s[0]) > 0.11))) return null;
  const lo = sides[0][0], hi = sides[1][0];
  if (Math.abs(lo) > 0.11 && Math.abs(hi) > 0.11 || w.thickness + hi - lo <= 0) return null;
  return {dx: n[0] * (lo + hi) / 2, dy: n[1] * (lo + hi) / 2, thickness: r1(w.thickness + hi - lo)};
}
