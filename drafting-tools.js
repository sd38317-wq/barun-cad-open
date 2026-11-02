// 훈민캐드 대조 P1·P2 작도 보조(2026-09-26). AutoCAD 이름을 쓴다.
//  QSELECT     조건(종류·레이어·색·선종류·문자 스타일·블록 이름·문자 높이)이 같은 객체 골라내기 · 참조 객체 방식 (H69)
//  ALIGN       원본·대상 두 쌍으로 이동·회전(·축척·복사) 한 번에 (H61)
//  LAYMCUR     객체의 레이어를 현재로 / 새 레이어(이름·색·선종류)를 만들어 현재로 (H10·H11)
//  ADDSELECTED 고른 객체와 같은 종류·레이어·색·선종류로 바로 그리기 (H20)
//  LAYRENAME   도면의 객체를 집어 그 레이어 이름 바꾸기 (H16)
//  ENDMATCH    허용 거리 안의 선·폴리선 끝점을 한 점으로 맞추기 (H66)
//  DENSITY     선종류 축척·해치 무늬 밀도를 함께 배수로 조절 · 참조 객체 방식 (H35·H57)
import * as G from './geometry.js';
import {alignMatrix} from './curve-edit.js';
import {isChecked} from './card-input.js';
import {linetypeChoices, parseLinetype, parseColor, colorOfEntity, colorChanges} from './cad-properties.js';
import {hatchEditChanges} from './hatch-patterns.js';

const upper = (v) => String(v ?? '').toUpperCase();
const colorKey = (e) => { const c = colorOfEntity(e); return c.mode === 'bylayer' ? 'BYLAYER' : c.mode === 'byblock' ? 'BYBLOCK' : String(c.color || '').toLowerCase(); };
const blockName = (e) => e.type === 'block' ? String(e.sharedBlock || e.name || '') : '';
/** QSELECT 조건: 같은지 볼 속성. */
export const QSELECT_KEYS = Object.freeze([
 ['type', '종류', e => e.type],
 ['layer', '레이어', e => e.layer],
 ['color', '색', colorKey],
 ['linetype', '선종류', e => upper(e.linetype || 'BYLAYER')],
 ['textStyle', '문자 스타일', e => e.type === 'text' ? upper(e.textStyle || 'STANDARD') : null],
 ['height', '문자 높이', e => e.type === 'text' ? Math.round((Number(e.height) || 0) * 1000) / 1000 : null],
 ['block', '블록 이름', e => blockName(e) || null],
]);

/** 참조 객체와 고른 조건이 모두 같은 객체들. 숨긴·얼린 레이어는 뺀다(잠긴 레이어는 고를 수 있다, 고치는 명령이 따로 막는다). */
export function quickSelect(entities, layers, reference, keys, scope = null) {
 const visible = new Set(layers.filter(l => l.visible !== false && !l.frozen).map(l => l.id));
 const tests = QSELECT_KEYS.filter(([key]) => keys.includes(key)).map(([, , read]) => [read, read(reference)]);
 if (!tests.length) throw Error('같은지 볼 조건을 하나 이상 고르세요.');
 const pool = scope ? entities.filter(e => scope.has(e.id)) : entities;
 return pool.filter(e => visible.has(e.layer) && tests.every(([read, want]) => { const got = read(e); return got !== null && got === want; }));
}

// 325. 비슷한 객체 선택(AutoCAD SELECTSIMILAR · SELECTSIMILARMODE). 비트: 1 색 · 2 레이어 · 4 선종류 · 64 문자 스타일 · 128 이름(블록).
// 종류는 늘 같아야 한다. 기본 130 = 종류 + 레이어 + 이름. 고른 객체 "모두" 가 기준이다(벽 선과 치수를 함께 고르면 둘 다의 비슷한 것).
// 기준 서명 집합을 만든 뒤 도면을 한 번만 훑는다(O(객체 수), 기준 수와 무관).
export const SELECT_SIMILAR_BITS = Object.freeze([[1, 'color'], [2, 'layer'], [4, 'linetype'], [64, 'textStyle'], [128, 'block']]);
export function similarKeys(mode = 130) {
 const m = Number(mode) | 0;
 return ['type', ...SELECT_SIMILAR_BITS.filter(([bit]) => m & bit).map(([, key]) => key)];
}
export function describeSimilarMode(mode = 130) {
 const names = {type: '종류', color: '색', layer: '레이어', linetype: '선종류', textStyle: '문자 스타일', block: '이름'};
 return similarKeys(mode).map(k => names[k]).join('+');
}
export function selectSimilar(entities, layers, references, mode = 130) {
 if (!references?.length) throw Error('기준이 될 객체를 먼저 고르세요.');
 const read = new Map(QSELECT_KEYS.map(([key, , fn]) => [key, fn]));
 const keys = similarKeys(mode);
 const sig = e => keys.map(k => String(read.get(k)(e))).join('\u0001');
 const wanted = new Set(references.map(sig));
 const visible = new Set(layers.filter(l => l.visible !== false && !l.frozen).map(l => l.id));
 return entities.filter(e => !e.hidden && visible.has(e.layer) && wanted.has(sig(e)));
}

/**
 * 조건식 선택(AutoCAD QSELECT 대화상자): 속성 · 연산자(= ≠ > < ≥ ≤ 와일드카드) · 값.
 * 레이어·스타일·블록은 이름(대소문자 무시), 색은 번호·#RRGGBB·BYLAYER, 문자 높이는 숫자. 크기 비교는 문자 높이에만.
 * mode: new(새 선택) · append(지금 선택에 더하기) · exclude(조건에 맞지 않는 것).
 */
export const QSELECT_OPERATORS = Object.freeze([['=', '= 같음'], ['!=', '≠ 다름'], ['>', '> 보다 큼'], ['<', '< 보다 작음'], ['>=', '≥ 크거나 같음'], ['<=', '≤ 작거나 같음'], ['like', '와일드카드 (* ?)']]);
export function quickSelectWhere(entities, layers, {key, operator = '=', value = ''}, {scope = null, mode = 'new', current = []} = {}) {
 const visible = new Set(layers.filter(l => l.visible !== false && !l.frozen).map(l => l.id));
 const layerName = new Map(layers.map(l => [l.id, String(l.name || '')]));
 const text = String(value ?? '').trim();
 if (!QSELECT_KEYS.some(([k]) => k === key)) throw Error('조건식 속성을 고르세요.');
 if (!QSELECT_OPERATORS.some(([o]) => o === operator)) throw Error('연산자를 고르세요.');
 if (!text && operator !== '=' && operator !== '!=') throw Error('조건식 값을 적으세요.');
 const numeric = key === 'height';
 if (['>', '<', '>=', '<='].includes(operator) && !numeric) throw Error('크기 비교(> < ≥ ≤)는 문자 높이에만 쓸 수 있습니다.');
 const read = {
  type: e => e.type, layer: e => layerName.get(e.layer) ?? e.layer, color: colorKey, linetype: e => upper(e.linetype || 'BYLAYER'),
  textStyle: e => e.type === 'text' ? upper(e.textStyle || 'STANDARD') : null, height: e => e.type === 'text' ? Number(e.height) : null, block: e => blockName(e) || null,
 }[key];
 let want = text;
 if (key === 'color' && operator !== 'like') { const spec = parseColor(text); want = spec.mode === 'bylayer' ? 'BYLAYER' : spec.mode === 'byblock' ? 'BYBLOCK' : String(spec.color || '').toLowerCase(); }
 if (numeric && operator !== 'like') { want = Number(text); if (!Number.isFinite(want)) throw Error('문자 높이는 숫자로 적으세요.'); }
 const pattern = operator === 'like' ? new RegExp('^' + text.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$', 'i') : null;
 const same = (got) => numeric ? Math.abs(got - want) < 1e-6 : String(got).toLowerCase() === String(want).toLowerCase();
 const test = (e) => {
  const got = read(e);
  if (got === null || got === undefined) return operator === '!=';
  switch (operator) {
   case '=': return same(got); case '!=': return !same(got);
   case '>': return got > want; case '<': return got < want; case '>=': return got >= want - 1e-9; case '<=': return got <= want + 1e-9;
   default: return pattern.test(String(got));
  }
 };
 const pool = (scope ? entities.filter(e => scope.has(e.id)) : entities).filter(e => visible.has(e.layer));
 const hits = pool.filter(e => mode === 'exclude' ? !test(e) : test(e));
 if (mode !== 'append') return hits;
 const ids = new Set(current), out = entities.filter(e => ids.has(e.id));
 for (const e of hits) if (!ids.has(e.id)) out.push(e);
 return out;
}

/** 두 쌍 정렬 변환: s1→d1 이동, s1s2 방향을 d1d2 로 회전, (scale 이면) 길이 비율로 축척. */
export function alignTransform(s1, d1, s2, d2, scale = false) {
 const from = G.sub(s2, s1), to = G.sub(d2, d1);
 const fromLength = Math.hypot(from.x, from.y), toLength = Math.hypot(to.x, to.y);
 if (fromLength < 1e-9 || toLength < 1e-9) throw Error('원본 두 점과 대상 두 점은 서로 떨어져 있어야 합니다.');
 return {dx: d1.x - s1.x, dy: d1.y - s1.y, angle: G.angle(to) - G.angle(from), factor: scale ? toLength / fromLength : 1, base: d1};
}

/**
 * 끝점 모으기: 허용 거리 안의 끝점끼리 무리를 짓고 평균점으로 옮긴다. 바뀌는 객체만 돌려준다.
 *  · 가까운 짝부터 묶되, 무리 안 모든 끝점이 서로 허용 거리 안일 때만 합친다(0·4·8·12 가 줄줄이 한 점으로 끌려가지 않게).
 *  · 한 객체의 두 끝은 같은 무리에 넣지 않는다(짧은 선이 점으로 줄지 않게). 길이가 0이 되는 변경은 버린다.
 *  · 격자로 가까운 끝점만 견줘 수만 개를 골라도 느려지지 않는다.
 */
export function matchEndpoints(entities, tolerance) {
 if (!(tolerance > 0)) throw Error('허용 거리는 0보다 커야 합니다.');
 const ends = [];
 for (const e of entities) {
  if (e.type === 'line' && e.points?.length === 2) { ends.push({e, i: 0}); ends.push({e, i: 1}); }
  else if (e.type === 'polyline' && !e.closed && e.points?.length >= 2) { ends.push({e, i: 0}); ends.push({e, i: e.points.length - 1}); }
 }
 const at = (k) => ends[k].e.points[ends[k].i];
 const cellKey = (p) => `${Math.floor(p.x / tolerance)},${Math.floor(p.y / tolerance)}`, grid = new Map();
 ends.forEach((_, k) => { const key = cellKey(at(k)); if (!grid.has(key)) grid.set(key, []); grid.get(key).push(k); });
 const pairs = [];
 ends.forEach((end, a) => {
  const p = at(a), cx = Math.floor(p.x / tolerance), cy = Math.floor(p.y / tolerance);
  for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (const b of grid.get(`${cx + dx},${cy + dy}`) || []) {
   if (b <= a || ends[b].e === end.e) continue;
   const d = G.dist(p, at(b));
   if (d <= tolerance) pairs.push([d, a, b]);
  }
 });
 pairs.sort((x, y) => x[0] - y[0]);
 const cluster = ends.map((_, k) => [k]), owner = ends.map((_, k) => k);
 for (const [, a, b] of pairs) {
  const ra = owner[a], rb = owner[b];
  if (ra === rb) continue;
  const A = cluster[ra], B = cluster[rb];
  const entitiesOfA = new Set(A.map(k => ends[k].e));
  if (B.some(k => entitiesOfA.has(ends[k].e))) continue;
  if (A.some(i => B.some(j => G.dist(at(i), at(j)) > tolerance))) continue;
  for (const k of B) { owner[k] = ra;A.push(k); }
  cluster[rb] = [];
 }
 const changed = new Map();let joined = 0;
 for (const group of cluster) {
  if (group.length < 2) continue;
  const mean = {x: group.reduce((s, k) => s + at(k).x, 0) / group.length, y: group.reduce((s, k) => s + at(k).y, 0) / group.length};
  if (group.every(k => G.dist(at(k), mean) < 1e-9)) continue;
  joined++;
  for (const k of group) {
   const {e, i} = ends[k], points = changed.get(e.id)?.points || e.points.map(p => ({...p}));
   points[i] = {...mean};changed.set(e.id, {e, points});
  }
 }
 const degenerate = ({e, points}) => e.type === 'line' ? G.dist(points[0], points[1]) < G.EPS : points.every(p => G.dist(p, points[0]) < G.EPS);
 return {changes: [...changed.values()].filter(c => !degenerate(c)).map(({e, points}) => ({id: e.id, points})), joined};
}

export function installDraftingTools(ctx) {
 const selection = (what) => { const sel = ctx.selected(); if (!sel.length) throw Error(`${what}: 먼저 객체를 선택하세요.`); return sel; };
 const unlocked = (list) => { const layers = new Map(ctx.layers().map(l => [l.id, l])); return list.filter(e => !layers.get(e.layer)?.locked); };
 const pickOrSelected = async (prompt) => {
  const sel = ctx.selected();
  if (sel.length === 1) return sel[0];
  const picked = await ctx.pickEntity({prompt});
  if (!picked) throw Error('객체를 고르지 않아 멈췄습니다.');
  return picked;
 };
 const point = async (prompt) => { const p = await ctx.pickPoint({prompt}); if (!p) throw Error('점을 찍지 않아 멈췄습니다.'); return p; };

 return {
  async QSELECT() {
   const chosen = ctx.selected(), scope = chosen.length > 1 ? new Set(ctx.selectedIds()) : null, single = chosen.length === 1 ? chosen[0] : null;
   return ctx.form(`조건 선택 (QSELECT)${single ? ` · 기준: ${single.type}` : ''}`, [
    {name: 'how', label: '방법', options: [['same', single ? '기준 객체와 같은 조건' : '기준 객체를 집어 같은 조건'], ['where', '조건식 (속성 · 연산자 · 값)']], value: 'same'},
    {name: 'scope', label: '찾을 범위', options: [['all', '도면 전체'], ...(scope ? [['selection', `지금 선택한 ${scope.size}개 안에서`]] : [])], value: scope ? 'selection' : 'all'},
    ...QSELECT_KEYS.map(([key, label], i) => ({name: key, label: `같은 ${label}`, type: 'checkbox', value: i < 2})),
    {name: 'whereKey', label: '조건식 · 속성', options: QSELECT_KEYS.map(([key, label]) => [key, label]), value: 'height'},
    {name: 'whereOp', label: '조건식 · 연산자', options: QSELECT_OPERATORS, value: '>'},
    {name: 'whereValue', label: '조건식 · 값 (레이어·스타일·블록은 이름, 색은 번호·#RRGGBB, 높이는 mm)', value: ''},
    {name: 'mode', label: '결과', options: [['new', '새로 선택'], ['append', '지금 선택에 더하기'], ['exclude', '조건에 맞지 않는 것 고르기']], value: 'new'},
   ], async (values) => {
    const range = values.scope === 'selection' ? scope : null;
    let found;
    if (values.how === 'where') {
     found = quickSelectWhere(ctx.entities(), ctx.layers(), {key: values.whereKey, operator: values.whereOp, value: values.whereValue}, {scope: range, mode: values.mode, current: ctx.selectedIds()});
    } else {
     const reference = single || await (async () => { const p = await ctx.pickEntity({prompt: scope ? '기준이 될 객체를 클릭하세요 (선택한 객체들 안에서 고릅니다) · Esc 취소' : '기준이 될 객체를 클릭하세요 · Esc 취소'}); if (!p) throw Error('기준 객체를 고르지 않아 멈췄습니다.'); return p; })();
     const keys = QSELECT_KEYS.map(([key]) => key).filter(key => isChecked(values[key]));
     const same = quickSelect(ctx.entities(), ctx.layers(), reference, keys, range);
     if (values.mode === 'exclude') { const hit = new Set(same.map(e => e.id)), layers = new Set(ctx.layers().filter(l => l.visible !== false && !l.frozen).map(l => l.id)); found = (range ? ctx.entities().filter(e => range.has(e.id)) : ctx.entities()).filter(e => layers.has(e.layer) && !hit.has(e.id)); }
     else if (values.mode === 'append') { const ids = new Set(ctx.selectedIds()); found = [...ctx.entities().filter(e => ids.has(e.id)), ...same.filter(e => !ids.has(e.id))]; }
     else found = same;
    }
    ctx.setSelected(found.map(e => e.id));
    ctx.toast(`조건 선택 · ${found.length.toLocaleString('ko-KR')}개를 골랐습니다.`);
   });
  },

  async ALIGN() {
   const targets = unlocked(selection('ALIGN'));
   if (!targets.length) throw Error('선택한 객체가 모두 잠긴 레이어에 있습니다.');
   const s1 = await point('첫째 원본점을 찍으세요 · Esc 취소'), d1 = await point('첫째 대상점을 찍으세요');
   const s2 = await point('둘째 원본점을 찍으세요'), d2 = await point('둘째 대상점을 찍으세요');
   return ctx.form('정렬 (ALIGN)', [
    {name: 'scale', label: '정렬점 기준으로 축척 맞추기', type: 'checkbox', value: false},
    {name: 'copy', label: '원본은 두고 복사본을 정렬', type: 'checkbox', value: false},
   ], (values) => {
    const t = alignTransform(s1, d1, s2, d2, isChecked(values.scale));
    let ids = targets.map(e => e.id);
    // ACAD200-416: 이동·회전·축척을 행렬 하나로 합쳐 엔진 명령 한 번(사본·화면 갱신·되돌리기도 한 번). 벽은 벽 연동이 있는 예전 길로.
    if (targets.some(e => e.type === 'wall' || e.hostWall)) {
     if (isChecked(values.copy)) ids = ctx.execute({type: 'copy', ids, dx: t.dx, dy: t.dy});
     else ctx.execute({type: 'move', ids, dx: t.dx, dy: t.dy});
     if (Math.abs(t.angle) > 1e-9) ctx.execute({type: 'rotate', ids, base: t.base, angle: t.angle});
     if (Math.abs(t.factor - 1) > 1e-12) ctx.execute({type: 'scale', ids, base: t.base, factor: t.factor});
    } else {
     const matrix = alignMatrix(s1, d1, s2, d2, isChecked(values.scale));
     const made = ctx.execute({type: isChecked(values.copy) ? 'transform.copy' : 'transform', ids, matrix});
     if (isChecked(values.copy)) ids = made;
    }
    ctx.setSelected(ids);
    ctx.toast(`정렬 · ${ids.length}개 · 회전 ${t.angle.toFixed(2)}°${t.factor !== 1 ? ` · 축척 ${t.factor.toFixed(4)}` : ''} · Ctrl+Z 한 번으로 되돌립니다.`);
   });
  },

  LAYMCUR() {
   const layers = ctx.layers();
   const one = ctx.selected().length === 1 ? ctx.selected()[0] : null;
   return ctx.form('현재 레이어 · 객체에서 가져오기 또는 새로 만들기', [
    {name: 'mode', label: '방법', options: [['object', '객체를 집어 그 레이어를 현재로'], ['name', '목록에서 고르기'], ['new', '새 레이어 만들어 현재로']], value: one ? 'object' : 'object'},
    {name: 'layer', label: '목록에서 고를 레이어', options: layers.map(l => [l.id, l.name]), value: ctx.activeLayer()},
    {name: 'name', label: '새 레이어 이름', value: ''},
    {name: 'color', label: '새 레이어 색 (1~255 · #RRGGBB)', value: '7'},
    {name: 'linetype', label: '새 레이어 선종류', options: linetypeChoices(ctx.doc()).filter(([v]) => v !== 'BYLAYER'), value: 'CONTINUOUS'},
    {name: 'lineweight', label: '새 레이어 선굵기 mm', type: 'number', value: 0.25},
   ], async (values) => {
    let id;
    if (values.mode === 'object') {
     const picked = one || await ctx.pickEntity({prompt: '현재로 삼을 레이어의 객체를 클릭하세요 · Esc 취소'});
     if (!picked) return;
     id = picked.layer;
    } else if (values.mode === 'name') id = values.layer;
    else {
     const name = String(values.name || '').trim();
     if (!name) throw Error('새 레이어 이름을 적으세요.');
     if (/[<>/\\":;?*|=]/.test(name)) throw Error('레이어 이름에 < > / \\ " : ; ? * | = 는 쓸 수 없습니다.');
     if (ctx.layers().some(l => l.name.toLowerCase() === name.toLowerCase())) throw Error(`"${name}" 레이어가 이미 있습니다. 목록에서 고르세요.`);
     const spec = parseColor(values.color);
     if (spec.mode !== 'aci' && spec.mode !== 'truecolor') throw Error('새 레이어 색은 번호(1~255)나 #RRGGBB 로 적으세요.');
     const lineweight = Number(values.lineweight);
     if (!(lineweight >= 0 && lineweight <= 2.11)) throw Error('선굵기는 0~2.11 mm 입니다.');
     ctx.execute({type: 'layer.add', name, color: spec.color, lineweight, linetype: parseLinetype(values.linetype, ctx.doc()) || 'CONTINUOUS'});
     id = ctx.layers().find(l => l.name === name).id;
     if (spec.mode === 'aci') ctx.execute({type: 'layer.update', id, changes: {aci: spec.aci, colorMode: 'aci'}});
    }
    const layer = ctx.layers().find(l => l.id === id);
    if (!layer) throw Error('레이어를 찾지 못했습니다.');
    // AutoCAD 처럼 동결 레이어만 막는다. 꺼짐·잠김은 현재로 둘 수 있지만 그 위에는 그리지 못하니 알려 준다.
    if (layer.frozen) throw Error(`"${layer.name}" 레이어가 동결되어 현재 레이어로 삼을 수 없습니다.`);
    ctx.setActiveLayer(id);
    const warn = layer.locked || layer.visible === false;
    ctx.toast(`현재 레이어: ${layer.name}${warn ? ` · ${layer.locked ? '잠김' : '꺼짐'} 상태라 풀기 전에는 이 레이어에 그릴 수 없습니다.` : ''}`, warn);
   });
  },

  async ADDSELECTED() {
   const source = await pickOrSelected('같은 형식으로 그릴 기준 객체를 클릭하세요 · Esc 취소');
   const command = {line: 'LINE', polyline: 'PLINE', rectangle: 'RECTANGLE', circle: 'CIRCLE', arc: 'ARC', ellipse: 'ELLIPSE', text: 'TEXT', hatch: 'HATCH', dimension: 'DIMLINEAR', point: 'POINT'}[source.type];
   if (!command) throw Error(`${source.type} 객체는 같은 형식으로 바로 그릴 수 없습니다. 복사(COPY)를 쓰세요.`);
   const layer = ctx.layers().find(l => l.id === source.layer);
   // AutoCAD ADDSELECTED 처럼 새 객체에만 기준 객체의 특성을 쓰고, 명령이 끝나면 원래 현재 레이어·특성·문자 높이로 되돌린다.
   const previous = {layer: ctx.activeLayer?.(), properties: ctx.getCurrentProperties(), textHeight: ctx.getTextHeight?.() ?? null};
   if (layer && layer.visible !== false && !layer.frozen && !layer.locked) ctx.setActiveLayer(layer.id);
   const current = ctx.getCurrentProperties();
   ctx.setCurrentProperties({...current, color: source.color || source.colorMode === 'byblock' ? colorOfEntity(source) : null, linetype: source.linetype ? upper(source.linetype) : null, linetypeScale: source.linetypeScale ?? null, lineweight: source.lineweight ?? null});
   if (source.type === 'text' && Number(source.height) > 0) ctx.setTextHeight?.(source.height);
   const restore = () => {
    if (previous.layer && ctx.layers().some(l => l.id === previous.layer)) ctx.setActiveLayer(previous.layer);
    ctx.setCurrentProperties(previous.properties);
    if (previous.textHeight != null) ctx.setTextHeight?.(previous.textHeight);
   };
   ctx.toast(`${command} · 레이어 ${layer?.name || ''} · 기준 객체와 같은 색·선종류로 그립니다. 명령이 끝나면 원래 현재 레이어·특성으로 돌아갑니다.`);
   ctx.run(command);
   if (ctx.afterCommand) ctx.afterCommand(restore);
  },

  async LAYRENAME() {
   const picked = await pickOrSelected('이름을 바꿀 레이어의 객체를 클릭하세요 · Esc 취소');
   const layer = ctx.layers().find(l => l.id === picked.layer);
   if (!layer) throw Error('레이어를 찾지 못했습니다.');
   return ctx.form(`레이어 이름 바꾸기 · ${layer.name}`, [{name: 'name', label: '새 이름', value: layer.name}], (values) => {
    const name = String(values.name || '').trim();
    if (!name || name === layer.name) return ctx.toast('이름이 그대로입니다.');
    if (/[<>/\\":;?*|=]/.test(name)) throw Error('레이어 이름에 < > / \\ " : ; ? * | = 는 쓸 수 없습니다.');
    if (ctx.layers().some(l => l.id !== layer.id && l.name.toLowerCase() === name.toLowerCase())) throw Error(`"${name}" 레이어가 이미 있습니다. 합치려면 LAYMERGE 를 쓰세요.`);
    ctx.execute({type: 'layer.update', id: layer.id, changes: {name}});
    ctx.toast(`레이어 이름: ${layer.name} → ${name}`);
   });
  },

  ENDMATCH() {
   const sel = unlocked(selection('ENDMATCH')).filter(e => e.type === 'line' || e.type === 'polyline');
   if (sel.length < 2) throw Error('끝점을 맞출 선·폴리선을 두 개 이상 선택하세요.');
   return ctx.form(`끝점 맞춤 · ${sel.length}개`, [{name: 'tolerance', label: '허용 거리 (mm) · 이 거리 안의 끝점을 한 점으로', type: 'number', value: 5}], (values) => {
    const {changes, joined} = matchEndpoints(sel, Number(values.tolerance));
    if (!changes.length) return ctx.toast('허용 거리 안에서 맞출 끝점이 없습니다.');
    ctx.execute({type: 'updateMany', updates: changes.map(c => ({id: c.id, changes: {points: c.points}}))});
    ctx.toast(`끝점 맞춤 · ${joined}곳을 맞췄습니다(객체 ${changes.length}개). Ctrl+Z 로 되돌립니다.`);
   });
  },

  async DENSITY() {
   const sel = unlocked(selection('DENSITY')).filter(e => e.type === 'hatch' ? !e.solid : ['line', 'polyline', 'rectangle', 'arc', 'circle', 'ellipse'].includes(e.type));
   if (!sel.length) throw Error('밀도를 바꿀 선·해치를 선택하세요.');
   return ctx.form(`밀도 · 선 ${sel.filter(e => e.type !== 'hatch').length}개 · 해치 ${sel.filter(e => e.type === 'hatch').length}개`, [
    {name: 'mode', label: '방법', options: [['multiply', '지금 값에 배수 곱하기'], ['reference', '참조 객체와 같게']], value: 'multiply'},
    {name: 'factor', label: '배수 (0.5 = 두 배 촘촘, 2 = 두 배 성김)', type: 'number', value: 1},
   ], async (values) => {
    let reference = null;
    if (values.mode === 'reference') {
     reference = await ctx.pickEntity({prompt: '밀도를 따를 선 또는 해치를 클릭하세요 · Esc 취소'});
     if (!reference) return;
    }
    const factor = Number(values.factor);
    if (!reference && !(factor > 0 && factor <= 10000)) throw Error('배수는 0보다 크고 10,000 이하입니다.');
    const hatchScale = h => Number(h.patternScale ?? h.hatchScale ?? ((h.spacing ?? 100) / 100)) || 1;
    const commands = sel.map(e => {
     if (e.type === 'hatch') {
      const scale = reference ? (reference.type === 'hatch' ? hatchScale(reference) : hatchScale(e)) : hatchScale(e) * factor;
      return {id: e.id, changes: hatchEditChanges(e, {scale})};
     }
     const next = reference ? (reference.type === 'hatch' ? (e.linetypeScale ?? 1) : (reference.linetypeScale ?? 1)) : (e.linetypeScale ?? 1) * factor;
     return {id: e.id, changes: {linetypeScale: next}};
    });
    ctx.execute({type: 'updateMany', updates: commands});
    ctx.toast(`밀도 · ${sel.length}개를 바꿨습니다. Ctrl+Z 로 되돌립니다.`);
   });
  },
 };
}

export {colorChanges};
