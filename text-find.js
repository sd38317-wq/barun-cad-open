// 찾기·바꾸기 공급자(522). 문자만 보던 FINDREPLACE·FAR·CTX 를 치수 문자·블록 속성·표 칸·블록 안 문자까지 넓힌다.
// AutoCAD FIND 는 객체 종류마다 따로 찾고(블록 안은 변환한 사본에서 찾은 뒤 되쓴다) 결과를 목록으로 보여 준다.
// 우리는 "찾을 곳(슬롯)" 하나의 모양 {id, path, kind, key, value} 로 모두 같게 다루고, 바꾸기는 경로를 따라
// 그 객체 하나만 새로 만들어(바뀐 칸만) update 명령 하나로 되쓴다 — 사본을 만들었다 되쓰는 단계가 없어 빠르고,
// 치수 템플릿의 '<>'(측정값 자리)가 사라지는 바꾸기는 막아 데이터를 잃지 않는다. 잠긴 레이어는 건너뛰고 개수를 알린다.
// 이 모듈은 명령을 실행할 때만 쓰인다(매 프레임·매 명령 훑기 없음).
import * as G from './geometry.js';
import {rebuildTableEntity} from './table-sheet-tools-4.js';

export const SLOT_KIND_LABELS = Object.freeze({text: '문자', dimension: '치수 문자', attribute: '블록 속성', cell: '표 칸', blockText: '블록 안 문자'});
export const MATCH_MODES = Object.freeze([
 ['case', '정확히 (대소문자 구분)'],
 ['nocase', '대소문자 무시'],
 ['word', '단어 단위 (대소문자 구분)'],
 ['wild', '와일드카드 * ? (대소문자 무시)'],
]);
export const SCOPE_MODES = Object.freeze([
 ['all', '문자·치수·블록 속성·표 칸·블록 안 문자 모두'],
 ['text', '문자 객체만 (예전 방식)'],
]);

/** 찾을 글 → 정규식(g). wildcard: * = 아무 글자 여럿, ? = 한 글자. wholeWord: 앞뒤가 글자·숫자가 아닐 때만. */
export function findMatcher(find, {matchCase = false, wholeWord = false, wildcard = false} = {}) {
 const raw = String(find ?? '');
 if (!raw) throw Error('찾을 문자열을 입력하세요.');
 let src = '';
 for (const ch of raw) {
  if (wildcard && ch === '*') src += '.*?';
  else if (wildcard && ch === '?') src += '.';
  else src += ch.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
 }
 // 끝의 * 는 줄 끝까지(게으른 .*? 는 끝에서 아무것도 못 잡는다).
 if (wildcard && src.endsWith('.*?')) src = src.slice(0, -3) + '.*';
 if (wholeWord) src = `(?<![\\p{L}\\p{N}_])(?:${src})(?![\\p{L}\\p{N}_])`;
 const re = new RegExp(src, 'gu' + (matchCase ? '' : 'i'));
 re.lastIndex = 0;
 if (re.test('')) throw Error('빈 문자열과도 맞는 찾기 조건입니다(예: * 하나만). 글자를 하나 이상 넣으세요.');
 re.lastIndex = 0;
 return re;
}

/** 폼의 선택값(MATCH_MODES) → findMatcher 옵션. */
export function matchOptions(mode) {
 return mode === 'nocase' ? {matchCase: false} : mode === 'word' ? {matchCase: true, wholeWord: true} : mode === 'wild' ? {matchCase: false, wildcard: true} : {matchCase: true};
}

/**
 * 객체 하나에서 찾을 곳. path 는 최상위 객체(id)에서 블록 entities 색인을 따라간 길이다.
 * 표 블록 안의 문자는 칸을 그린 것이라 칸(table.rows)으로만 찾고, 속성을 보여 주는 블록 안 문자(attributeTag)는
 * 속성으로만 찾는다(같은 글을 두 번 세지 않는다). 공유(DWG) 블록 안은 다른 삽입본과 같이 쓰는 정의라 들어가지 않는다.
 */
export function* textSlots(e, path = [], top = e) {
 if (!e || typeof e !== 'object') return;
 const base = {id: top.id, path, layer: top.layer};
 if (e.type === 'text' && typeof e.text === 'string') yield {...base, kind: path.length ? 'blockText' : 'text', key: 'text', value: e.text};
 else if (e.type === 'dimension') {
  for (const key of ['text', 'textTemplate']) if (typeof e[key] === 'string' && e[key] !== '') yield {...base, kind: 'dimension', key, value: e[key]};
 } else if (e.type === 'block') {
  const attributes = e.attributes && typeof e.attributes === 'object' ? e.attributes : {};
  for (const [tag, v] of Object.entries(attributes)) if (v != null && typeof v !== 'object') yield {...base, kind: 'attribute', key: `attributes.${tag}`, tag, value: String(v)};
  if (e.table && Array.isArray(e.table.rows)) {
   const rows = e.table.rows;
   for (let r = 0; r < rows.length; r++) for (let c = 0; c < (rows[r]?.length || 0); c++) {
    const v = rows[r][c];
    if (v != null && typeof v !== 'object') yield {...base, kind: 'cell', key: `table.rows.${r}.${c}`, row: r, column: c, value: String(v)};
   }
   return;
  }
  if (e.sharedBlock) return;
  const kids = Array.isArray(e.entities) ? e.entities : [];
  for (let i = 0; i < kids.length; i++) {
   const child = kids[i];
   if (child?.type === 'text' && child.attributeTag != null && Object.hasOwn(attributes, child.attributeTag)) continue;
   yield* textSlots(child, [...path, i], top);
  }
 }
}

/** 이 객체들에서 정규식과 맞는 곳. 각 결과에 맞은 개수(count). 빈 값은 보지 않는다. */
export function findAll(entities, re, {scope = 'all'} = {}) {
 const hits = [];
 for (const e of entities || []) for (const s of textSlots(e)) {
  if (!s.value || (scope === 'text' && (s.kind !== 'text' || s.path.length))) continue;
  re.lastIndex = 0;
  const n = (s.value.match(re) || []).length;
  if (n) hits.push({...s, count: n});
 }
 re.lastIndex = 0;
 return hits;
}

/** 바꿀 글을 그대로(문자 그대로) 넣는 바꾸기 함수. $& 같은 정규식 치환 기호를 해석하지 않는다. */
export const literalReplacer = (re, replacement) => value => { re.lastIndex = 0; const out = String(value).replace(re, () => String(replacement ?? '')); re.lastIndex = 0; return out; };

const childAt = (e, path) => { let cur = e; for (const i of path) cur = cur?.entities?.[i]; return cur; };
const tsvNumber = (s) => { const t = String(s).trim(); return t !== '' && Number.isFinite(Number(t)) && String(Number(t)) === t ? Number(t) : s; };

/** 한 객체에 여러 칸의 새 값을 적용한 변경(changes). 경로를 따라 바뀐 가지만 새로 만든다. 표 칸이 바뀌면 rebuildTableEntity 로 다시 그린다. */
export function slotChanges(entity, edits) {
 const root = {...entity};
 const cloned = new WeakSet([root]);
 const reach = (path) => {
  let cur = root;
  for (const i of path) {
   if (!cloned.has(cur.entities)) { cur.entities = cur.entities.slice(); cloned.add(cur.entities); }
   let child = cur.entities[i];
   if (!cloned.has(child)) { child = {...child}; cur.entities[i] = child; cloned.add(child); }
   cur = child;
  }
  return cur;
 };
 const tables = new Map();
 for (const {slot, value} of edits) {
  const target = reach(slot.path);
  if (slot.kind === 'cell') {
   if (!cloned.has(target.table)) { target.table = {...target.table, rows: target.table.rows.map(r => r.slice())}; cloned.add(target.table); }
   const before = target.table.rows[slot.row][slot.column];
   target.table.rows[slot.row][slot.column] = typeof before === 'number' ? tsvNumber(value) : value;
   tables.set(slot.path.join('/'), slot.path);
  } else if (slot.kind === 'attribute') {
   const old = target.attributes?.[slot.tag];
   target.attributes = {...target.attributes, [slot.tag]: typeof old === 'number' ? tsvNumber(value) : value};
   if (Array.isArray(target.entities) && target.entities.some(c => c?.type === 'text' && c.attributeTag === slot.tag)) {
    if (!cloned.has(target.entities)) { target.entities = target.entities.slice(); cloned.add(target.entities); }
    target.entities = target.entities.map(c => c?.type === 'text' && c.attributeTag === slot.tag ? {...c, text: String(value)} : c);
   }
  } else target[slot.key] = value;
 }
 // 깊은 표부터 다시 그린다(표 안 표는 없지만 경로 순서를 지킨다).
 for (const path of [...tables.values()].sort((a, b) => b.length - a.length)) {
  const target = reach(path), rebuilt = rebuildTableEntity(target, target.table);
  target.entities = rebuilt.entities;
  target.table = rebuilt.table;
 }
 const changes = {};
 for (const key of Object.keys(root)) if (root[key] !== entity[key]) changes[key] = root[key];
 return changes;
}

/**
 * 여러 객체의 바꾸기 계획. edit(slot) → 새 값(그대로면 같은 값이나 null). 잠긴 레이어(locked(e))는 건너뛰고 센다.
 * 치수 템플릿에서 '<>'(측정값 자리)를 없애는 바꾸기는 막는다(guarded). 결과 updates 는 engine updateMany 형식.
 */
export function planSlotEdits(entities, edit, {locked = () => false, scope = 'all'} = {}) {
 const updates = [], edits = [];
 let skippedLocked = 0, guarded = 0;
 for (const e of entities || []) {
  const mine = [];
  for (const slot of textSlots(e)) {
   if (scope === 'text' && (slot.kind !== 'text' || slot.path.length)) continue;
   const next = edit(slot);
   if (next == null || next === slot.value) continue;
   if (slot.key === 'textTemplate' && slot.value.includes('<>') && !String(next).includes('<>')) { guarded++; continue; }
   mine.push({slot, value: String(next)});
  }
  if (!mine.length) continue;
  if (locked(e)) { skippedLocked += mine.length; continue; }
  const changes = slotChanges(e, mine);
  if (Object.keys(changes).length) { updates.push({id: e.id, changes}); for (const m of mine) edits.push({...m.slot, before: m.slot.value, after: m.value}); }
 }
 return {updates, edits, skippedLocked, guarded};
}

/** 레이어 목록 → 잠김 판단 함수. */
export function lockedBy(layers) {
 const locked = new Set((layers || []).filter(l => l?.locked).map(l => l.id));
 return e => locked.has(e?.layer);
}

/** 결과 한 곳을 화면에 보여 줄 범위(조금 넉넉하게). 표 칸·속성은 그 글자, 블록 안은 그 자식, 그 밖은 객체 전체. */
export function slotBounds(entity, slot) {
 if (!entity) return null;
 let target = entity;
 if (slot) {
  const holder = slot.path?.length ? childAt(entity, slot.path) : entity;
  if (slot.kind === 'cell') target = holder?.entities?.find(c => c?.tableCell?.row === slot.row && c?.tableCell?.column === slot.column) || holder;
  else if (slot.kind === 'attribute') target = holder?.entities?.find(c => c?.type === 'text' && c.attributeTag === slot.tag) || holder;
  else target = holder || entity;
 }
 let b = null;
 try { b = G.bounds([target]); } catch { b = null; }
 if (!b) return null;
 const size = Math.max(b.maxX - b.minX, b.maxY - b.minY, Number(target.height) || 0, 1);
 const pad = size * 1.5;
 return {minX: b.minX - pad, minY: b.minY - pad, maxX: b.maxX + pad, maxY: b.maxY + pad};
}

/** 결과 목록 한 줄. */
export function slotLabel(slot, index) {
 const kind = SLOT_KIND_LABELS[slot.kind] || slot.kind;
 const where = slot.kind === 'cell' ? ` ${slot.row + 1}행 ${slot.column + 1}열` : slot.kind === 'attribute' ? ` ${slot.tag}` : slot.kind === 'dimension' && slot.key === 'textTemplate' ? ' 앞뒤 글' : '';
 const value = slot.value.length > 40 ? slot.value.slice(0, 39) + '…' : slot.value;
 return `${index + 1}. ${kind}${where} · "${value.replace(/\n/g, ' ⏎ ')}"`;
}
