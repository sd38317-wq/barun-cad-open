// 주석 축척(훈민캐드 대조 기반 4: H03·H76·H45). AutoCAD 의 주석 축척(ANNOTATIVE)처럼 "용지에서 보이는 크기"를 기준으로
// 문자·치수·기호 크기를 도곽 축척에 맞춘다.
//  ANNOSCALE  도곽(또는 선택)의 문자·치수·주석 기호 블록·(선택)해치 무늬를 목표 축척에 맞춘다.
//             객체마다 마지막으로 맞춘 축척(annoScale)을 기억해, 다시 적용하거나 선택·도곽을 섞어 써도 두 번 커지지 않는다.
//  SCALETEXT  문자 높이를 "용지 높이(mm) × 축척" 으로 맞춘다.
// 도곽·기둥·계단처럼 문자가 들어 있어도 실제 크기인 블록은 건드리지 않는다: 지시선·태그·제목·그리드 기호처럼 주석으로 표시된 블록만 키운다.
//
// 510 한 객체에 여러 축척 표현(여러 축척 주석). 문자·치수·주석 기호 블록(지시선 mleader 등)에 둔다.
//  annotative: true, scales: {'1:50': {offset?:{x,y}, rotation?}, '1:100': {}}  — 가진 축척 표현. offset·rotation 은 그 축척에서만 더하는
//              위치·회전(도). 기준 위치는 "지금 위치 − 지금 표현의 offset" 이라 MOVE 로 옮기면 모든 표현이 같이 움직인다.
//  paperHeight (문자) 용지 높이 mm · paperSizes (치수) {textHeight, arrowSize, …} 용지 mm
//  annoScale   지금 도면에 실제로 적용돼 있는 표현의 분모(기존 ANNOSCALE 의 "마지막으로 맞춘 축척" 과 같은 뜻)
//  annoMissing 현재 축척 표현이 없어 마지막 표현 크기로 보이는 중(ANNOALLVISIBLE 켜짐 · 그리기에서 흐리게 할 표시)
//  annoHidden  현재 축척 표현이 없어 숨긴 것(ANNOALLVISIBLE 꺼짐, hidden 과 같이 둔다 — 우리가 숨긴 것만 다시 보이게)
// 축척을 바꾸면(CANNOSCALE·ANNOSCALE) 표현대로 높이·위치를 실제 객체에 적용한다: 여러 축척 주석만 updateMany 로 바꾸므로
// 그리기·선택·스냅·내보내기 경로는 손대지 않는다(주석이 아닌 객체 비용 0). 바뀐 객체만 고친다.
// 문서 필드: doc.currentAnnoScale(모형 현재 주석 축척 분모), doc.annoAutoScale(기본 false = AutoCAD ANNOAUTOSCALE -4),
//           doc.annoAllVisible(기본 true = ANNOALLVISIBLE 1), doc.scaleList(511, scale-list.js).
import * as G from './geometry.js';
import {isChecked} from './card-input.js';
import {hatchEditChanges} from './hatch-patterns.js';
import {scaleKey, parseScale, normalizeScaleList, scaleRatio, addScaleToList, purgeUnusedScales, removeScalesFromList, resetScaleList, usedScaleKeys} from './scale-list.js';
import {registerManualLabels} from './commands.js';

export {scaleKey};

const DIM_SIZE_KEYS = ['textHeight', 'arrowSize', 'extensionOffset', 'extensionOvershoot', 'textGap'];
// 건축 작도 모음(ARCHLIB) 중 주석 기호: 창호 기호, 도면 타이틀.
const ANNOTATION_LIBRARY = new Set(['WST', 'TIT']);

/** 주석으로 다룰 블록인가. 공유 블록·외부참조·표·구조 블록은 제외. */
export function isAnnotationBlock(e) {
 if (e?.type !== 'block' || e.table || e.xref || e.sharedBlock) return false;
 return e.annotative === true || e.mleader === true || e.name === '지시선' || ANNOTATION_LIBRARY.has(e.libraryCommand);
}

/** 블록을 키울 때 제자리로 둘 기준점: 삽입점 → 지시선 화살표 끝(첫 선의 첫 점) → 경계 중심. */
export function annotationAnchor(e) {
 if (e.position && Number.isFinite(e.position.x)) return e.position;
 const first = (e.entities || []).find(c => (c.type === 'line' || c.type === 'polyline') && c.points?.length);
 if (first) return first.points[0];
 const b = G.bounds([e]);
 return b ? {x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2} : {x: 0, y: 0};
}

/** 도곽에 속한 객체: sheetId 로 묶인 것 + 묶이지 않고 중심이 도곽 안인 것. */
export function entitiesInSheet(entities, sheet) {
 const {bounds} = sheet;
 return entities.filter(e => {
  if (e.sheetId) return e.sheetId === sheet.id;
  const b = G.bounds([e]); if (!b) return false;
  const cx = (b.minX + b.maxX) / 2, cy = (b.minY + b.maxY) / 2;
  return cx >= bounds.minX && cx <= bounds.maxX && cy >= bounds.minY && cy <= bounds.maxY;
 });
}
/** 경계만으로 고르기(예전 이름). */
export const entitiesInBounds = (entities, bounds) => entitiesInSheet(entities, {id: null, bounds});

// ── 510 여러 축척 주석 ────────────────────────────────────────────────────────────

/** 여러 축척 표현을 가진 주석인가(속성 두 개만 본다). 예전부터 annotative:true 였던 그리드·제목 블록은 scales 가 없어 아니다. */
export const isMultiScale = (e) => e?.annotative === true && !!e.scales && typeof e.scales === 'object' && (e.type === 'text' || e.type === 'dimension' || e.type === 'block');
/** 여러 축척 주석으로 만들 수 있는 객체: 문자·치수·주석 기호 블록. */
export const canBeAnnotative = (e) => e?.type === 'text' || e?.type === 'dimension' || isAnnotationBlock(e);

/** 지금 도면에 적용돼 있는 표현의 분모. */
export function currentRatio(e) {
 if (Number(e?.annoScale) > 0) return Number(e.annoScale);
 if (e?.type === 'text' && e.paperHeight > 0 && e.height > 0) return e.height / e.paperHeight;
 if (e?.type === 'dimension' && e.paperSizes?.textHeight > 0) return (Number(e.textHeight) || 150) / e.paperSizes.textHeight;
 return null;
}

/** 일반 문자·치수·주석 블록을 여러 축척 주석으로 바꾸는 값. 지금 크기를 ratio(또는 기억한 annoScale) 축척 표현으로 삼는다. */
export function makeAnnotative(e, ratio) {
 const k = Number(e.annoScale) > 0 ? Number(e.annoScale) : Number(ratio);
 if (!(k > 0) || !Number.isFinite(k)) throw Error('축척은 0보다 큰 수입니다.');
 const changes = {annotative: true, annoScale: k, scales: {[scaleKey(k)]: {}}};
 if (e.type === 'text') { if (!(e.height > 0)) throw Error('높이가 없는 문자는 주석으로 만들 수 없습니다.'); changes.paperHeight = e.height / k; }
 if (e.type === 'dimension') changes.paperSizes = dimensionPaperSizes(e, k);
 return changes;
}
function dimensionPaperSizes(e, k) {
 const sizes = {};
 for (const key of DIM_SIZE_KEYS) if (Number.isFinite(e[key])) sizes[key] = e[key] / k;
 if (!Number.isFinite(e.textHeight)) sizes.textHeight = 150 / k;
 return sizes;
}
const offsetOf = (rep) => ({x: Number(rep?.offset?.x) || 0, y: Number(rep?.offset?.y) || 0});
const rotationOf = (rep) => Number(rep?.rotation) || 0;

/** 위치만 옮기기(치수는 치수선 위치·문자 위치만 — 잰 점은 그대로). */
function shiftAnnotation(e, dx, dy) {
 if (!dx && !dy) return e;
 if (e.type !== 'dimension') return G.translate(e, dx, dy);
 const out = {...e}, move = (p) => ({...p, x: p.x + dx, y: p.y + dy});
 if (Array.isArray(e.points) && e.points.length >= 3) out.points = e.points.map((p, i) => i === 2 ? move(p) : p);
 if (e.textPosition) out.textPosition = move(e.textPosition);
 return out;
}

/**
 * 축척 ratio 로 볼 때의 모습. 주석이 아니면 그대로(같은 객체), 표현이 없으면 allVisible 이면 지금 모습 + _annoMissing, 아니면 null.
 * autoAdd 면 표현이 없을 때 새로 더한다(ANNOAUTOSCALE). 지금 표현에서 사용자가 바꾼 높이·치수 크기는 용지 크기로 거꾸로 기억한다.
 */
export function resolveAnnotative(e, ratio, {allVisible = true, autoAdd = false} = {}) {
 if (!isMultiScale(e)) return e;
 const k = Number(ratio), key = scaleKey(k);
 if (!key) return e;
 let rep = e.scales[key], scales = e.scales;
 if (!rep && autoAdd) { rep = {}; scales = {...e.scales, [key]: rep}; }
 if (!rep) return allVisible ? {...e, _annoMissing: true} : null;
 const fromK = currentRatio(e) ?? k, fromRep = e.scales[scaleKey(fromK)], live = !!fromRep && !e.annoMissing;
 const from = offsetOf(fromRep), to = offsetOf(rep), dx = to.x - from.x, dy = to.y - from.y;
 const turn = rotationOf(rep) - rotationOf(fromRep), factor = k / fromK;
 let out;
 if (e.type === 'text') {
  const paperHeight = live && e.height > 0 ? e.height / fromK : e.paperHeight;
  out = {...shiftAnnotation(e, dx, dy), height: paperHeight * k, paperHeight};
  if (turn) out.rotation = (Number(e.rotation) || 0) + turn;
  if (Number.isFinite(e.maskPadding) && factor !== 1) out.maskPadding = e.maskPadding * factor;
 } else if (e.type === 'dimension') {
  const paperSizes = live ? dimensionPaperSizes(e, fromK) : (e.paperSizes || dimensionPaperSizes(e, fromK));
  out = {...shiftAnnotation(e, dx, dy), paperSizes};
  for (const name of DIM_SIZE_KEYS) if (Number.isFinite(paperSizes[name])) out[name] = paperSizes[name] * k;
 } else {
  out = Math.abs(factor - 1) > 1e-12 ? G.resize(e, annotationAnchor(e), factor) : {...e};
  if (turn) out = G.rotate(out, annotationAnchor(out), turn);
  out = shiftAnnotation(out, dx, dy);
 }
 out.annoScale = k;out.scales = scales;
 delete out.annoMissing;delete out._annoMissing;
 if (e.annoHidden) { delete out.hidden;delete out.annoHidden; }
 return out;
}

const same = (a, b) => a === b || (a && b && typeof a === 'object' && typeof b === 'object' && JSON.stringify(a) === JSON.stringify(b));
/** resolveAnnotative 결과를 객체에 적용할 바꿀 값(바뀐 것만). 바뀐 게 없으면 null. 지울 값은 undefined(저장 때 빠진다). */
export function annotativeChanges(e, ratio, options = {}) {
 if (!isMultiScale(e)) return null;
 const out = resolveAnnotative(e, ratio, options);
 if (out === null) return e.hidden ? (e.annoMissing ? null : {annoMissing: true}) : {hidden: true, annoHidden: true, annoMissing: true};
 if (out._annoMissing) {
  const changes = {};
  if (!e.annoMissing) changes.annoMissing = true;
  if (e.annoHidden) { changes.hidden = undefined;changes.annoHidden = undefined; }
  return Object.keys(changes).length ? changes : null;
 }
 const changes = {};
 for (const key of new Set([...Object.keys(e), ...Object.keys(out)])) {
  if (key === 'id' || key === 'type' || key.startsWith('_')) continue;
  if (!(key in out)) { if (e[key] !== undefined) changes[key] = undefined; continue; }
  if (!same(e[key], out[key])) changes[key] = out[key];
 }
 return Object.keys(changes).length ? changes : null;
}

/** 이 객체가 따를 주석 축척: 도곽에 주석 축척이 있으면 그 축척, 아니면 문서 현재 주석 축척, 없으면 fallback. */
export function annotationTargetScale(e, doc, fallback) {
 const sheets = doc?.sheets;
 if (sheets?.length) {
  let sheet = e.sheetId ? sheets.find(s => s.id === e.sheetId) : null;
  if (!sheet && !e.sheetId) { const b = G.bounds([e]); if (b) { const cx = (b.minX + b.maxX) / 2, cy = (b.minY + b.maxY) / 2; sheet = sheets.find(s => s.bounds && cx >= s.bounds.minX && cx <= s.bounds.maxX && cy >= s.bounds.minY && cy <= s.bounds.maxY); } }
  if (Number(sheet?.annotationScale) > 0) return Number(sheet.annotationScale);
 }
 return Number(doc?.currentAnnoScale) > 0 ? Number(doc.currentAnnoScale) : fallback;
}

// 여러 축척 주석 목록. 엔진은 고칠 때마다 새 객체 배열을 만들므로 배열 단위로 기억하면 명령 사이에 한 번만 훑는다.
const multiScaleCache = new WeakMap();
export function multiScaleEntities(entities) {
 if (!Array.isArray(entities)) return [];
 let found = multiScaleCache.get(entities);
 if (!found) { found = [];for (const e of entities) if (e && e.scales && isMultiScale(e)) found.push(e);multiScaleCache.set(entities, found); }
 return found;
}

/**
 * 현재 주석 축척을 ratio 로 바꿀 때 고칠 객체(updateMany 의 updates). 도곽 주석 축척을 따르는 객체는 그 축척으로 둔다.
 * {previous, autoAdd, allVisible, fallback, locked(Set 레이어 id)}. autoAdd 는 이전 현재 축척을 가진 객체에만 더한다(AutoCAD ANNOAUTOSCALE 4 와 같은 범위).
 */
export function currentScaleUpdates(doc, ratio, {previous = null, autoAdd = false, allVisible = true, fallback = 100, locked = new Set()} = {}) {
 const updates = [], counts = {changed: 0, added: 0, missing: 0, hidden: 0, locked: 0};
 const view = {...doc, currentAnnoScale: ratio}, prevKey = scaleKey(previous);
 for (const e of multiScaleEntities(doc.entities)) {
  const target = annotationTargetScale(e, view, fallback), key = scaleKey(target);
  const add = autoAdd && target === ratio && !e.scales[key] && (!prevKey || !!e.scales[prevKey]);
  const changes = annotativeChanges(e, target, {allVisible, autoAdd: add});
  if (!changes) continue;
  if (locked.has(e.layer)) { counts.locked++;continue; }
  updates.push({id: e.id, changes});
  if (changes.hidden === true) counts.hidden++;
  else if (changes.annoMissing === true) counts.missing++;
  else { counts.changed++;if (add) counts.added++; }
 }
 return {updates, counts};
}

/**
 * 주석 크기를 바꾸는 엔진 명령 목록.
 *  target = {from, to}: 객체마다 비율 = to / (그 객체가 마지막으로 맞춰진 축척 annoScale ?? from), 바꾼 객체에 annoScale=to.
 *  target = 숫자(비율): 모든 객체에 같은 비율(도곽 복사의 축척 보정). 기억한 annoScale 도 같은 비율로 옮긴다.
 * kinds: {text, dimension, symbol, hatch}.
 */
export function annotationScaleCommands(entities, target, kinds = {text: true, dimension: true, symbol: true, hatch: false}) {
 const byRatio = typeof target === 'number';
 if (byRatio ? !(target > 0 && Number.isFinite(target)) : !(target?.from > 0 && target?.to > 0 && Number.isFinite(target.from) && Number.isFinite(target.to))) throw Error(byRatio ? '축척 비율이 올바르지 않습니다.' : '축척은 0보다 큰 수입니다.');
 const commands = [], updates = [], counts = {text: 0, dimension: 0, symbol: 0, hatch: 0};
 for (const e of entities) {
  // 510 여러 축척 주석: 한 번 곱하지 않고 목표 축척 표현으로 푼다(없으면 더한다 — ANNOSCALE·도곽 복사는 "이 축척에 맞춰라" 는 뜻).
  if (e.scales && isMultiScale(e)) {
   const kind = e.type === 'block' ? 'symbol' : e.type;
   if (!kinds[kind]) continue;
   const from = currentRatio(e), to = byRatio ? (from ? from * target : null) : target.to;
   const changes = to ? annotativeChanges(e, to, {autoAdd: true}) : null;
   if (changes) { updates.push({id: e.id, changes});counts[kind]++; }
   continue;
  }
  const remembered = Number(e.annoScale) > 0 ? Number(e.annoScale) : null;
  const ratio = byRatio ? target : target.to / (remembered ?? target.from);
  if (!Number.isFinite(ratio) || Math.abs(ratio - 1) < 1e-12) continue;
  const stamp = byRatio ? (remembered ? {annoScale: remembered * ratio} : {}) : {annoScale: target.to};
  if (e.type === 'text' && kinds.text) {
   if (!(e.height > 0)) continue;
   updates.push({id: e.id, changes: {height: e.height * ratio, ...stamp, ...(Number.isFinite(e.maskPadding) ? {maskPadding: e.maskPadding * ratio} : {})}});counts.text++;
  } else if (e.type === 'dimension' && kinds.dimension) {
   // 치수 스타일 배율(scale)은 그대로 두고 크기 값만 바꾼다 — geometry.dimensionParts 는 크기 × scale 로 그린다.
   const changes = {...stamp};
   for (const key of DIM_SIZE_KEYS) if (Number.isFinite(e[key])) changes[key] = e[key] * ratio;
   if (!Number.isFinite(e.textHeight)) changes.textHeight = 150 * ratio;
   updates.push({id: e.id, changes});counts.dimension++;
  } else if (kinds.symbol && isAnnotationBlock(e)) {
   commands.push({type: 'scale', ids: [e.id], base: annotationAnchor(e), factor: ratio});
   if (stamp.annoScale) updates.push({id: e.id, changes: stamp});
   counts.symbol++;
  } else if (e.type === 'hatch' && kinds.hatch && !e.solid) {
   const scale = Number(e.patternScale ?? e.hatchScale ?? ((e.spacing ?? 100) / 100)) || 1;
   updates.push({id: e.id, changes: {...hatchEditChanges(e, {scale: scale * ratio}), ...stamp}});counts.hatch++;
  }
 }
 // 객체마다 다른 크기 값은 updateMany 한 번으로(큰 도면에서 update 수만 개를 batch 하면 매번 전체를 훑는다).
 if (updates.length) commands.push({type: 'updateMany', updates});
 return {commands, counts};
}

export function installAnnotationScale(ctx) {
 const sheets = () => ctx.doc().sheets || [];
 const defaultScale = () => Number(ctx.getSettings?.()?.denominator) || 100;
 const editableOnly = (list) => { const layers = new Map(ctx.layers().map(l => [l.id, l])); return list.filter(e => { const l = layers.get(e.layer); return !l?.locked && !l?.frozen && l?.visible !== false; }); };
 const optionalScale = (value, label) => {
  const text = String(value ?? '').trim();
  if (!text) return null;
  const n = Number(text);
  if (!(n > 0) || !Number.isFinite(n)) throw Error(`${label} 축척은 0보다 큰 수입니다.`);
  return n;
 };
 return {
  ANNOSCALE() {
   const list = sheets(), sel = ctx.selected();
   const scopes = [...list.map(s => [s.id, `도곽 ${s.number || ''} ${s.title || ''} · 1:${s.denominator}${s.annotationScale ? ` (주석 1:${s.annotationScale})` : ''}`]), ...(sel.length ? [['__selection__', `선택한 객체 ${sel.length}개`]] : [])];
   if (!scopes.length) throw Error('도곽(SHEET)을 먼저 지정하거나 맞출 객체를 선택하세요.');
   return ctx.form('주석 축척 맞추기 · 문자·치수·주석 기호 크기를 축척에 맞춤', [
    {name: 'scope', label: '대상', options: scopes, value: sel.length ? '__selection__' : scopes[0][0]},
    {name: 'from', label: `지금 주석 축척 1: (비우면 도곽이 기억한 값, 없으면 기본 1:${defaultScale()})`, type: 'number', value: ''},
    {name: 'to', label: '목표 축척 1: (비우면 도곽 축척)', type: 'number', value: ''},
    {name: 'text', label: '문자', type: 'checkbox', value: true},
    {name: 'dimension', label: '치수 (문자 높이·화살표)', type: 'checkbox', value: true},
    {name: 'symbol', label: '주석 기호 블록 (지시선·창호 기호·제목·그리드 기호)', type: 'checkbox', value: true},
    {name: 'hatch', label: '해치 무늬 밀도', type: 'checkbox', value: false},
   ], (values) => {
    const sheet = list.find(s => s.id === values.scope);
    if (!sheet && values.scope !== '__selection__') throw Error('대상 도곽을 찾지 못했습니다.');
    const from = optionalScale(values.from, '지금') ?? (sheet?.annotationScale || defaultScale());
    const to = optionalScale(values.to, '목표') ?? sheet?.denominator ?? null;
    if (!(to > 0)) throw Error('선택한 객체는 목표 축척을 입력하세요.');
    const pool = sheet ? entitiesInSheet(ctx.entities(), sheet) : sel;
    const {commands, counts} = annotationScaleCommands(editableOnly(pool), {from, to}, {text: isChecked(values.text), dimension: isChecked(values.dimension), symbol: isChecked(values.symbol), hatch: isChecked(values.hatch)});
    if (!commands.length) return ctx.toast('바꿀 주석이 없습니다(이미 같은 축척이거나 대상이 없음).');
    if (sheet && sheet.annotationScale !== to) commands.push({type: 'document.update', changes: {sheets: sheets().map(s => s.id === sheet.id ? {...s, annotationScale: to} : s)}});
    ctx.execute({type: 'batch', commands});
    ctx.toast(`주석 축척 → 1:${to} · 문자 ${counts.text} · 치수 ${counts.dimension} · 기호 ${counts.symbol}${counts.hatch ? ` · 해치 ${counts.hatch}` : ''}. Ctrl+Z 로 되돌립니다.`);
   });
  },

  SCALETEXT() {
   const texts = editableOnly(ctx.selected().filter(e => e.type === 'text'));
   if (!texts.length) throw Error('SCALETEXT: 높이를 바꿀 문자를 선택하세요.');
   return ctx.form(`문자 높이 · ${texts.length}개`, [
    {name: 'mode', label: '방법', options: [['paper', '용지 높이 × 축척 (도면에 찍혀 나올 크기로)'], ['model', '도면 단위 높이 그대로'], ['factor', '지금 높이에 배수']], value: 'paper'},
    {name: 'paper', label: '용지 높이 mm', type: 'number', value: 2.5},
    {name: 'scale', label: '축척 1:', type: 'number', value: defaultScale()},
    {name: 'model', label: '도면 단위 높이 mm', type: 'number', value: 250},
    {name: 'factor', label: '배수', type: 'number', value: 1},
   ], (values) => {
    const paperScale = Number(values.scale);
    if (values.mode === 'paper' && !(paperScale > 0)) throw Error('축척은 0보다 커야 합니다.');
    const height = values.mode === 'paper' ? Number(values.paper) * paperScale : values.mode === 'model' ? Number(values.model) : null;
    const factor = Number(values.factor);
    if (height !== null && !(height > 0)) throw Error('높이는 0보다 커야 합니다.');
    if (height === null && !(factor > 0)) throw Error('배수는 0보다 커야 합니다.');
    // 용지 높이 × 축척으로 맞추면 그 축척을 주석 축척으로 기억한다(이어서 ANNOSCALE 이 올바른 비율을 쓴다).
    const remember = values.mode === 'paper' ? {annoScale: paperScale} : {};
    ctx.execute({type: 'updateMany', updates: texts.map(e => ({id: e.id, changes: {height: height ?? e.height * factor, ...remember}}))});
    ctx.toast(`문자 ${texts.length}개 높이를 ${height ? height.toLocaleString('ko-KR') + ' mm' : factor + '배'}(으)로 바꿨습니다.`);
   });
  },

  // 510 객체의 축척 표현 더하기·빼기(AutoCAD OBJECTSCALE). 일반 문자·치수·주석 블록은 지금 크기를 지금 축척 표현으로 삼아 주석으로 바꾼다.
  OBJECTSCALE() {
   const doc = ctx.doc(), picked = editableOnly(ctx.selected()).filter(canBeAnnotative);
   if (!picked.length) throw Error('OBJECTSCALE: 문자·치수·지시선(주석 기호 블록)을 먼저 선택하세요.');
   const current = currentAnnoScale(), have = new Map();
   for (const e of picked) if (isMultiScale(e)) for (const key of Object.keys(e.scales)) have.set(key, (have.get(key) || 0) + 1);
   const plain = picked.filter(e => !isMultiScale(e)).length;
   const summary = [...have].sort((a, b) => parseScale(a[0]) - parseScale(b[0])).map(([key, n]) => `${key}${n < picked.length ? ` (${n}개)` : ''}`).join(', ') || '없음';
   return ctx.form(`주석 축척 표현 · ${picked.length}개 · 현재 ${scaleKey(current)}`, [
    {name: 'have', label: '가진 축척', value: summary + (plain ? ` · 주석 아닌 객체 ${plain}개` : ''), readonly: true},
    {name: 'action', label: '할 일', options: [['add', '축척 더하기 (없으면 주석으로 바꿈)'], ['remove', '축척 빼기'], ['offset', '현재 축척에서만 위치 옮기기'], ['sync', '모든 축척 위치를 지금 위치로 맞추기'], ['off', '주석 끄기 (지금 크기로 고정)']], value: 'add'},
    {name: 'scales', label: '축척 (쉼표로 여러 개 · 예: 1:50, 1:100)', value: scaleKey(current)},
    {name: 'dx', label: '옮길 거리 X mm (위치 옮기기)', type: 'number', value: 0},
    {name: 'dy', label: '옮길 거리 Y mm (위치 옮기기)', type: 'number', value: 0},
   ], (values) => {
    const live = ctx.doc(), opts = {allVisible: live.annoAllVisible !== false};
    const targetOf = (e) => annotationTargetScale(e, live, currentAnnoScale());
    const updates = [], commands = [];let skipped = 0;
    if (values.action === 'add' || values.action === 'remove') {
     const ratios = parseScaleList(values.scales);
     if (values.action === 'add') {
      let list = live.scaleList;
      for (const r of ratios) if (!normalizeScaleList(list).some(s => scaleKey(scaleRatio(s)) === scaleKey(r))) list = addScaleToList(list || live, r);
      if (list !== live.scaleList) commands.push({type: 'document.update', changes: {scaleList: list}});
      for (const e of picked) {
       const base = isMultiScale(e) ? {} : makeAnnotative(e, targetOf(e));
       const scales = {...(e.scales && isMultiScale(e) ? e.scales : base.scales)};
       for (const r of ratios) scales[scaleKey(r)] ??= {};
       const next = {...e, ...base, scales}, resolved = annotativeChanges(next, targetOf(e), opts);
       updates.push({id: e.id, changes: {...base, scales, ...(resolved || {})}});
      }
     } else {
      const drop = new Set(ratios.map(scaleKey));
      for (const e of picked.filter(isMultiScale)) {
       const scales = Object.fromEntries(Object.entries(e.scales).filter(([key]) => !drop.has(key)));
       if (!Object.keys(scales).length) { skipped++;continue; }
       if (Object.keys(scales).length === Object.keys(e.scales).length) continue;
       // 지금 적용된 표현을 빼면 남은 표현 중 현재 축척(없으면 첫 표현) 모습으로 바꾼 뒤 목록을 줄인다(옮긴 위치 계산은 빼기 전 목록으로).
       const target = targetOf(e), dest = scales[scaleKey(target)] ? target : parseScale(Object.keys(scales)[0]);
       const moved = annotativeChanges(e, dest, opts) || {};
       const missing = dest !== target ? (opts.allVisible ? {annoMissing: true} : {hidden: true, annoHidden: true, annoMissing: true}) : {};
       updates.push({id: e.id, changes: {...moved, scales, ...missing}});
      }
     }
    } else if (values.action === 'offset') {
     const dx = Number(values.dx) || 0, dy = Number(values.dy) || 0;
     if (!dx && !dy) throw Error('옮길 거리를 입력하세요.');
     for (const e of picked.filter(isMultiScale)) {
      const key = scaleKey(currentRatio(e));
      if (!e.scales[key] || e.annoMissing) { skipped++;continue; }
      const off = offsetOf(e.scales[key]), moved = shiftAnnotation(e, dx, dy);
      const changes = {scales: {...e.scales, [key]: {...e.scales[key], offset: {x: off.x + dx, y: off.y + dy}}}};
      for (const k of ['position', 'points', 'textPosition', 'alignPoint', 'fitTo', 'entities']) if (moved[k] !== e[k] && moved[k] !== undefined) changes[k] = moved[k];
      updates.push({id: e.id, changes});
     }
    } else if (values.action === 'sync') {
     for (const e of picked.filter(isMultiScale)) {
      const scales = Object.fromEntries(Object.entries(e.scales).map(([key, rep]) => { const {offset, rotation, ...rest} = rep || {};return [key, rest]; }));
      if (!same(scales, e.scales)) updates.push({id: e.id, changes: {scales}});
     }
    } else if (values.action === 'off') {
     for (const e of picked.filter(isMultiScale)) {
      const changes = {scales: undefined, paperHeight: undefined, paperSizes: undefined, annoMissing: undefined};
      // 그리드·제목처럼 원래 주석 표시가 있던 블록은 표시를 남긴다(ANNOSCALE 이 계속 키운다).
      if (e.type !== 'block') changes.annotative = undefined;
      if (e.annoHidden) Object.assign(changes, {hidden: undefined, annoHidden: undefined});
      updates.push({id: e.id, changes});
     }
    }
    if (updates.length) commands.push({type: 'updateMany', updates});
    if (!commands.length) return ctx.toast(skipped ? `바꿀 수 있는 객체가 없습니다(마지막 축척은 뺄 수 없고, 현재 축척 표현이 있어야 위치를 옮깁니다 · ${skipped}개).` : '바뀐 것이 없습니다.');
    ctx.execute(commands.length === 1 ? commands[0] : {type: 'batch', commands});
    ctx.toast(`주석 축척 표현: ${updates.length}개 객체 바꿈${skipped ? ` · ${skipped}개는 그대로(마지막 축척이거나 현재 축척 표현 없음)` : ''}. Ctrl+Z 로 되돌립니다.`);
   });
  },

  // 510 현재 주석 축척(AutoCAD CANNOSCALE). 여러 축척 주석만 표현대로 크기·위치를 바꾼다.
  CANNOSCALE() {
   const doc = ctx.doc(), list = normalizeScaleList(doc), current = currentAnnoScale(), currentKey = scaleKey(current);
   const options = list.map(s => { const key = scaleKey(scaleRatio(s));return [key, s.name === key ? key : `${s.name} (${key})`]; });
   if (!options.some(([key]) => key === currentKey)) options.unshift([currentKey, currentKey]);
   return ctx.form('현재 주석 축척', [
    {name: 'scale', label: '주석 축척', options, value: currentKey},
    {name: 'custom', label: '목록에 없는 축척 (예: 1:250 · 비우면 위에서 고른 것)', value: ''},
    {name: 'auto', label: '바꿀 때 주석 객체에 이 축척 표현 자동 더하기 (ANNOAUTOSCALE)', type: 'checkbox', value: doc.annoAutoScale === true},
    {name: 'allVisible', label: '이 축척 표현이 없는 주석도 보이기 (ANNOALLVISIBLE)', type: 'checkbox', value: doc.annoAllVisible !== false},
   ], (values) => {
    const custom = String(values.custom ?? '').trim(), ratio = parseScale(custom || values.scale);
    if (!ratio) throw Error('축척을 읽지 못했습니다. 예: 1:100 또는 100');
    applyCurrentScale(ratio, {autoAdd: isChecked(values.auto), allVisible: isChecked(values.allVisible)});
   });
  },
  // 510 자동 더하기 켜기·끄기(AutoCAD ANNOAUTOSCALE, 기본 꺼짐).
  ANNOAUTOSCALE() {
   const on = ctx.doc().annoAutoScale !== true;
   ctx.execute({type: 'document.update', changes: {annoAutoScale: on}});
   ctx.toast(on ? '주석 축척 자동 더하기 켬: 현재 축척을 바꾸면 이전 축척을 가진 주석에 새 축척 표현을 더합니다.' : '주석 축척 자동 더하기 끔(기본).');
  },
  // 510 현재 축척 표현이 없는 주석 보이기·숨기기(AutoCAD ANNOALLVISIBLE, 기본 보임).
  ANNOALLVISIBLE() {
   const allVisible = ctx.doc().annoAllVisible === false;
   applyCurrentScale(currentAnnoScale(), {autoAdd: false, allVisible, keepAuto: true});
  },

  // 511 축척 목록 편집(AutoCAD SCALELISTEDIT). 쓰고 있는 축척(현재·도곽·객체 표현)은 지우지 않는다.
  SCALELISTEDIT() {
   const doc = ctx.doc(), list = normalizeScaleList(doc), used = usedScaleKeys(doc);
   const lines = list.map(s => { const key = scaleKey(scaleRatio(s));return `${s.name}${s.name === key ? '' : ` (${key})`} · 용지 ${s.paper} = 도면 ${s.drawing}${used.has(key) ? ' · 쓰는 중' : ''}`; });
   return ctx.form(`축척 목록 · ${list.length}개${Array.isArray(doc.scaleList) && doc.scaleList.length ? '' : ' (기본 목록)'}`, [
    {name: 'list', label: '지금 목록', type: 'textarea', value: lines.join('\n'), readonly: true},
    {name: 'action', label: '할 일', options: [['add', '축척 더하기'], ['remove', '축척 지우기'], ['purge', '안 쓰는 축척 모두 지우기'], ['reset', '기본 목록으로 되돌리기 (쓰는 축척은 남김)']], value: 'add'},
    {name: 'scale', label: '축척 (예: 1:250 · 2:1 · 250 · 지우기는 쉼표로 여러 개)', value: ''},
    {name: 'name', label: '이름 (더하기 · 비우면 1:250 처럼)', value: ''},
   ], (values) => {
    const live = ctx.doc();let next, message;
    if (values.action === 'add') {
     const ratio = parseScale(values.scale);
     if (!ratio) throw Error('더할 축척을 입력하세요. 예: 1:250');
     next = addScaleToList(live, ratio, values.name);message = `${scaleKey(ratio)} 을(를) 목록에 더했습니다.`;
    } else if (values.action === 'remove') {
     const result = removeScalesFromList(live, parseScaleList(values.scale));
     if (!result.removed.length) throw Error(result.blocked.length ? `${result.blocked.map(s => s.name).join(', ')} 은(는) 쓰고 있어 지울 수 없습니다.` : '목록에 없는 축척입니다.');
     next = result.list;message = `${result.removed.map(s => s.name).join(', ')} 을(를) 지웠습니다${result.blocked.length ? ` · 쓰는 중이라 남김: ${result.blocked.map(s => s.name).join(', ')}` : ''}.`;
    } else if (values.action === 'purge') {
     const result = purgeUnusedScales(live);
     if (!result.removed.length) return ctx.toast('지울 축척이 없습니다(모두 쓰는 중).');
     next = result.list;message = `안 쓰는 축척 ${result.removed.length}개를 지웠습니다.`;
    } else {
     next = resetScaleList(live);message = `기본 목록 ${next.length}개로 되돌렸습니다.`;
    }
    if (same(next, live.scaleList)) return ctx.toast('바뀐 것이 없습니다.');
    ctx.execute({type: 'document.update', changes: {scaleList: next}});
    ctx.toast(message + ' Ctrl+Z 로 되돌립니다.');
   });
  },
 };

 function currentAnnoScale() { const n = Number(ctx.doc().currentAnnoScale);return n > 0 ? n : defaultScale(); }
 function applyCurrentScale(ratio, {autoAdd, allVisible, keepAuto = false}) {
  const doc = ctx.doc(), previous = currentAnnoScale(), locked = new Set(ctx.layers().filter(l => l.locked).map(l => l.id));
  const {updates, counts} = currentScaleUpdates(doc, ratio, {previous, autoAdd, allVisible, fallback: defaultScale(), locked});
  let list = doc.scaleList;
  if (!normalizeScaleList(list || doc).some(s => scaleKey(scaleRatio(s)) === scaleKey(ratio))) list = addScaleToList(list || doc, ratio);
  const settings = {currentAnnoScale: ratio, annoAllVisible: allVisible, ...(keepAuto ? {} : {annoAutoScale: autoAdd}), ...(list !== doc.scaleList ? {scaleList: list} : {})};
  const commands = [{type: 'document.update', changes: settings}];
  if (updates.length) commands.push({type: 'updateMany', updates});
  ctx.execute({type: 'batch', commands});
  const parts = [`주석 ${counts.changed}개 크기 맞춤`];
  if (counts.added) parts.push(`새 표현 ${counts.added}개`);
  if (counts.missing) parts.push(`표현 없음 ${counts.missing}개(마지막 크기로 보임)`);
  if (counts.hidden) parts.push(`표현 없음 ${counts.hidden}개 숨김`);
  if (counts.locked) parts.push(`잠긴 레이어 ${counts.locked}개 그대로`);
  ctx.toast(`현재 주석 축척 ${scaleKey(ratio)}${allVisible ? '' : ' · 표현 없는 주석 숨김'} · ${parts.join(' · ')}. Ctrl+Z 로 되돌립니다.`);
 }
}

/** '1:50, 1:100 200' → [50, 100, 200]. 읽지 못한 값이 있으면 알린다. */
export function parseScaleList(text) {
 const items = String(text ?? '').split(/[,\s;]+/).map(s => s.trim()).filter(Boolean);
 const ratios = items.map(parseScale);
 const bad = items.filter((_, i) => !ratios[i]);
 if (bad.length) throw Error(`축척을 읽지 못했습니다: ${bad.join(', ')} (예: 1:100)`);
 if (!ratios.length) throw Error('축척을 입력하세요. 예: 1:50, 1:100');
 return [...new Map(ratios.map(r => [scaleKey(r), r])).values()];
}

// 명령 목록(commands.js COMMANDS)에 넣기 전에도 명령창에 이름을 치면 실행되게 한다.
registerManualLabels([
 ['OBJECTSCALE', 'OBJECTSCALE'], ['주석축척표현', 'OBJECTSCALE'], ['객체축척', 'OBJECTSCALE'],
 ['CANNOSCALE', 'CANNOSCALE'], ['현재주석축척', 'CANNOSCALE'],
 ['ANNOAUTOSCALE', 'ANNOAUTOSCALE'], ['ANNOALLVISIBLE', 'ANNOALLVISIBLE'],
 ['SCALELISTEDIT', 'SCALELISTEDIT'], ['축척목록', 'SCALELISTEDIT'],
]);
