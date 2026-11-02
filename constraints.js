/* 기하 구속 1단계(ACAD200-420): 수평·수직·일치(끝점 붙음)와 AUTOCONSTRAIN.

   AutoCAD 는 D-Cubed 2D 풀이기(AcDbAssoc2dConstraintGroup)에 도면 전체 구속 그룹을 넘긴다.
   바른 CAD 는 건축 도면에 실제로 많이 쓰는 세 가지만 둔다:
     · 구속은 문서의 `constraints` 목록에 [{kind:'horizontal'|'vertical', ids:[id]}, {kind:'coincident', refs:[[id,점번호],[id,점번호]]}].
     · 편집이 끝나면 "이번에 바뀐 객체"에 걸린 구속만 따라가며(너비 우선) 다른 객체를 맞춘다 — 구속이 없는 큰 도면은 비용 0.
     · 풀 수 없는 경우(서로 다투는 구속)는 정해진 횟수 뒤 멈추고 지금 모양을 그대로 둔다(데이터 손실 없음).
   AUTOCONSTRAIN 은 공차 안의 끝점 일치와 거의 수평/수직인 선을 찾아 구속을 만든다(격자 색인으로 O(n)). */
import * as G from './geometry.js';

const KINDS = new Set(['horizontal', 'vertical', 'coincident']);
const pathOK = (e) => (e?.type === 'line' || e?.type === 'polyline') && Array.isArray(e.points) && e.points.length >= 2;
const idsOf = (c) => (c.kind === 'coincident' ? c.refs.map((r) => r[0]) : c.ids);

/**
 * 고른 선·폴리선에서 구속을 추론한다.
 * @param {Array} entities 선·폴리선
 * @param {{tol?:number, angTol?:number, existing?:Array}} options tol=끝점 공차(mm), angTol=각도 공차(도)
 * @returns {{constraints:Array, snapped:Array<{id,points}>}} snapped 는 공차 안에서 맞춰 줄 새 점(AutoCAD 도 추론 뒤 바로 맞춘다)
 */
export function autoConstrain(entities, {tol = 1, angTol = 1, existing = []} = {}) {
 if (!(tol >= 0) || !(angTol >= 0)) throw Error('공차는 0 이상이어야 합니다.');
 const lines = entities.filter(pathOK), out = [], have = new Set(existing.map(keyOf));
 const add = (c) => { const k = keyOf(c); if (!have.has(k)) { have.add(k); out.push(c); } };
 // 공차가 객체보다 크면(AutoCAD ToleranceTooLarge) 짧은 선이 점으로 무너진다 — 그런 선은 건너뛴다.
 const longEnough = (e) => e.points.slice(1).every((p, i) => G.dist(e.points[i], p) > tol * 2);
 for (const e of lines) {
  if (e.type !== 'line' || !longEnough(e)) continue;
  const [a, b] = e.points, ang = ((G.angle(G.sub(b, a)) % 180) + 180) % 180;
  if (Math.min(ang, 180 - ang) <= angTol) add({kind: 'horizontal', ids: [e.id]});
  else if (Math.abs(ang - 90) <= angTol) add({kind: 'vertical', ids: [e.id]});
 }
 const cell = Math.max(tol, 1e-6), grid = new Map(), key = (p) => `${Math.floor(p.x / cell)}|${Math.floor(p.y / cell)}`;
 const ends = [];
 for (const e of lines) if (longEnough(e)) for (const i of [0, e.points.length - 1]) ends.push({id: e.id, i, p: e.points[i]});
 for (const x of ends) { const k = key(x.p); (grid.get(k) || grid.set(k, []).get(k)).push(x); }
 for (const x of ends) {
  const cx = Math.floor(x.p.x / cell), cy = Math.floor(x.p.y / cell);
  for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (const y of grid.get(`${cx + dx}|${cy + dy}`) || []) {
   if (y.id <= x.id || G.dist(x.p, y.p) > tol) continue;
   add({kind: 'coincident', refs: [[x.id, x.i], [y.id, y.i]]});
  }
 }
 return {constraints: out};
}
function keyOf(c) { return c.kind === 'coincident' ? `c|${[...c.refs].map((r) => r.join(':')).sort().join('|')}` : `${c.kind}|${c.ids[0]}`; }

/** 이번 명령이 구속 걸린 객체를 건드렸는가(구속이 없거나 관계없으면 풀이를 건너뛴다). */
export function constraintsTouching(constraints, command, result) {
 if (!constraints?.length) return false;
 const touched = new Set(result || []);
 for (const id of command?.ids || []) touched.add(id);
 if (command?.id) touched.add(command.id);
 for (const t of command?.targets || []) if (t?.id) touched.add(t.id);
 for (const u of command?.updates || []) if (u?.id) touched.add(u.id);
 return constraints.some((c) => idsOf(c).some((id) => touched.has(id)));
}

/**
 * 바뀐 객체에서 시작해 구속을 따라가며 다른 객체를 맞춘다. doc.entities 를 고친 사본으로 갈아 끼우고 맞춘 id 를 돌려준다.
 * 지워진 객체를 가리키는 구속은 목록에서 뺀다.
 */
export function solveConstraints(doc, command, changedIds, {maxPasses = 20} = {}) {
 const cs = doc.constraints || [];
 const want = new Set(cs.flatMap(idsOf)), byId = new Map();
 for (const e of doc.entities) if (want.has(e.id)) byId.set(e.id, e);
 const alive = cs.filter((c) => KINDS.has(c.kind) && idsOf(c).every((id) => pathOK(byId.get(id))));
 if (alive.length !== cs.length) doc.constraints = alive;
 const moved = new Set((changedIds || []).filter((id) => byId.has(id))), pinned = new Map(), copies = new Map();
 for (const id of command?.ids || []) if (byId.has(id)) moved.add(id);
 if (!moved.size) return [];
 const get = (id) => copies.get(id) || byId.get(id);
 const edit = (id) => { if (!copies.has(id)) { const e = byId.get(id); copies.set(id, {...e, points: e.points.map((p) => ({...p}))}); } return copies.get(id); };
 const near = (a, b) => G.dist(a, b) <= 1e-9;
 for (let pass = 0; pass < maxPasses; pass++) {
  let changed = false;
  for (const c of alive) {
   if (c.kind === 'coincident') {
    const [[ia, pa], [ib, pb]] = c.refs, A = get(ia), B = get(ib);
    if (!A.points[pa] || !B.points[pb] || near(A.points[pa], B.points[pb])) continue;
    // 움직인 쪽이 기준. 둘 다(또는 둘 다 아니)면 먼저 적힌 쪽을 기준으로 둘째를 맞춘다.
    const [src, si, dst, di] = moved.has(ib) && !moved.has(ia) ? [B, pb, ia, pa] : [A, pa, ib, pb];
    const target = edit(dst); target.points[di] = {...target.points[di], x: src.points[si].x, y: src.points[si].y};
    pinned.set(dst, di); moved.add(dst); changed = true;
   } else {
    const id = c.ids[0], e = get(id); if (e.type !== 'line') continue;
    const anchor = pinned.get(id) ?? 0, other = 1 - anchor, axis = c.kind === 'horizontal' ? 'y' : 'x';
    if (Math.abs(e.points[other][axis] - e.points[anchor][axis]) <= 1e-9) continue;
    if (!moved.has(id)) continue; // 움직이지 않은 선은 이미 맞아 있던 것으로 보고 건드리지 않는다
    const target = edit(id); target.points[other] = {...target.points[other], [axis]: target.points[anchor][axis]};
    changed = true;
   }
  }
  if (!changed) break;
 }
 if (!copies.size) return [];
 for (const e of copies.values()) for (const key of ['_renderBounds', '_visibleEntities', '_lodCollapsed']) delete e[key];
 doc.entities = doc.entities.map((e) => copies.get(e.id) || e);
 return [...copies.keys()];
}
