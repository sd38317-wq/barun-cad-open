// 512 필드(동적 문자): 날짜·파일 이름·객체 면적/길이를 문자 안에 두고 저절로 갱신한다.
// AutoCAD: FIELDEVAL 비트(열기 1·저장 2·출력 4·전송 8·다시생성 16)마다 도면의 모든 필드를 다시 계산한다.
// 바른 CAD: 객체 필드는 "그 객체가 바뀐 명령 끝"에 그 필드만 다시 계산한다(원본 id → 필드 문자 역색인, O(바뀐 객체)).
// 원본 객체를 고친 명령과 같은 되돌리기 한 단계로 묶는다. 날짜·파일 이름은 열기·저장·출력 때.
// 문자 모양: {text, fieldTemplate:'면적 {{0}}', fields:[{code, cache}]}. text = 틀에 cache 를 넣은 것.
// 사용자가 문자를 직접 고쳐 틀과 달라지면 그 문자는 보통 문자로 바뀐다(고친 내용을 덮어쓰지 않는다 — 데이터 손실 없음).
import {measure} from './architecture.js';

export const FIELDEVAL = Object.freeze({open: 1, save: 2, plot: 4, transmit: 8, regen: 16, command: 32});
const DEFAULT_EVAL = 31 | FIELDEVAL.command;

/** 틀 + 값 → 문자. */
export const fieldText = (template, fields) => String(template ?? '').replace(/\{\{(\d+)\}\}/g, (m, i) => fields?.[Number(i)]?.cache ?? m);
/** 필드가 살아 있는 문자인지(틀로 만든 문자와 지금 문자가 같다). */
export const isLiveField = e => e?.type === 'text' && Array.isArray(e.fields) && e.fields.length > 0 && typeof e.fieldTemplate === 'string' && fieldText(e.fieldTemplate, e.fields) === e.text;

const pad = (n, w = 2) => String(n).padStart(w, '0');
/** AutoCAD 날짜 형식 일부(yyyy yy MM M dd d HH H hh h mm ss tt). 따옴표 없는 한글은 글자 그대로. */
export function formatFieldDate(date, format = 'yyyy.MM.dd') {
 const d = date instanceof Date ? date : new Date(date);
 if (Number.isNaN(d.getTime())) return '####';
 const h12 = d.getHours() % 12 || 12;
 const map = {yyyy: d.getFullYear(), yy: pad(d.getFullYear() % 100), MM: pad(d.getMonth() + 1), M: d.getMonth() + 1, dd: pad(d.getDate()), d: d.getDate(),
  HH: pad(d.getHours()), H: d.getHours(), hh: pad(h12), h: h12, mm: pad(d.getMinutes()), ss: pad(d.getSeconds()), tt: d.getHours() < 12 ? '오전' : '오후'};
 return String(format).replace(/yyyy|yy|MM|M|dd|d|HH|H|hh|h|mm|ss|tt/g, k => String(map[k]));
}

const formatArg = code => /\\f\s+"([^"]*)"/i.exec(code)?.[1] ?? '';
/** %pr2(자리수) %ct8[1e-006](곱할 값)·%ps[앞,뒤](앞뒤 글) 서식 → 숫자 문자. */
export function formatFieldNumber(value, format = '') {
 if (!Number.isFinite(value)) return '####';
 const factor = Number(/%ct8\[([^\]]+)\]/.exec(format)?.[1] ?? 1);
 const precision = Number(/%pr(\d)/.exec(format)?.[1] ?? 2);
 const [prefix = '', suffix = ''] = (/%ps\[([^,\]]*),([^\]]*)\]/.exec(format) || []).slice(1);
 return prefix + (value * (Number.isFinite(factor) ? factor : 1)).toFixed(precision) + suffix;
}

/** 필드가 가리키는 객체 id(없으면 null). */
export const fieldSourceId = code => /\\AcObjProp\s+Object\(%<\\_ObjId\s+([^>]+?)>%\)/i.exec(String(code))?.[1]?.trim() ?? null;

/**
 * 필드 하나 계산. ctx = {now, saveDate, plotDate, filePath, byId(id)}. 모르는 필드는 null(이전 값 유지).
 */
export function evaluateField(code, ctx = {}) {
 const s = String(code ?? ''), fmt = formatArg(s);
 let m;
 if ((m = /\\AcVar\s+(Date|SaveDate|PlotDate|CreateDate)\b/i.exec(s))) {
  const when = {date: ctx.now, savedate: ctx.saveDate, plotdate: ctx.plotDate, createdate: ctx.createDate}[m[1].toLowerCase()];
  if (!when) return m[1].toLowerCase() === 'date' ? formatFieldDate(new Date(), fmt || 'yyyy.MM.dd') : '----';
  return formatFieldDate(when, fmt || 'yyyy.MM.dd');
 }
 if (/\\AcVar\s+Filename\b/i.test(s)) {
  const path = String(ctx.filePath || ''); if (!path) return '(저장 전)';
  const name = path.split(/[\\/]/).pop();
  if (/%fn2/.test(fmt)) return name;
  if (/%fn6/.test(fmt)) return name.replace(/\.[^.]+$/, '');
  return path;
 }
 if ((m = /\.(Area|Length|Perimeter|Radius|Diameter)\b/i.exec(s)) && fieldSourceId(s)) {
  const target = ctx.byId?.(fieldSourceId(s));
  if (!target) return '####';                                     // 원본이 지워졌다(AutoCAD 와 같은 표시)
  const kind = m[1].toLowerCase();
  let v;
  if (kind === 'radius' || kind === 'diameter') v = Number.isFinite(target.radius) ? target.radius * (kind === 'diameter' ? 2 : 1) : NaN;
  else { const r = measure(target); v = kind === 'area' ? r.area : r.length; }
  return formatFieldNumber(v, fmt);
 }
 return null;
}

/**
 * 필드 문자 하나 다시 계산 → 바꿀 값(없으면 null). 살아 있지 않은(사용자가 고친) 문자는 보통 문자로 바꾸는 값을 준다.
 */
export function refreshFieldText(e, when, ctx) {
 if (e?.type !== 'text' || !Array.isArray(e.fields) || !e.fields.length) return null;
 if (!isLiveField(e)) return {fields: null, fieldTemplate: null};
 if (!((e.fieldEval ?? DEFAULT_EVAL) & when)) return null;
 let changed = false;
 const fields = e.fields.map(f => { const v = evaluateField(f.code, ctx); if (v !== null && v !== f.cache) { changed = true; return {...f, cache: v}; } return f; });
 return changed ? {fields, text: fieldText(e.fieldTemplate, fields)} : null;
}

/**
 * 필드 색인: 필드 문자 id 목록과 원본 id → 필드 문자 id. 도면을 한 번 훑어 만든다(열 때·필드를 넣을 때만).
 */
export function buildFieldIndex(entities) {
 const texts = new Set(), bySource = new Map();
 for (const e of entities || []) {
  if (e?.type !== 'text' || !Array.isArray(e.fields) || !e.fields.length) continue;
  texts.add(e.id);
  for (const f of e.fields) { const id = fieldSourceId(f.code); if (id) (bySource.get(id) || bySource.set(id, new Set()).get(id)).add(e.id); }
 }
 return {texts, bySource};
}

/** 열기·저장·출력 등: 색인의 필드 문자 모두(O(필드 문자 수)). lookup(ids) → 객체 배열. */
export function syncAllFields(index, when, ctx, lookup) {
 if (!index?.texts.size) return [];
 const out = [];
 for (const e of lookup([...index.texts])) { const changes = refreshFieldText(e, when, ctx); if (changes) out.push({id: e.id, changes}); }
 return out;
}

/** 명령 끝: 바뀐 객체 id 중 필드 원본인 것만 → 그 필드 문자만 다시 계산. 바뀐 id 수만큼만 본다. */
export function syncFieldsForChanges(index, changedIds, ctx, lookup) {
 if (!index?.bySource.size || !changedIds?.length) return [];
 const targets = new Set();
 for (const id of changedIds) for (const t of index.bySource.get(id) || []) targets.add(t);
 if (!targets.size) return [];
 const out = [];
 for (const e of lookup([...targets])) { const changes = refreshFieldText(e, FIELDEVAL.command, ctx); if (changes) out.push({id: e.id, changes}); }
 return out;
}

/** FIELD 명령이 넣을 필드 코드. */
export const FIELD_KINDS = Object.freeze([
 ['date', '오늘 날짜', () => '%<\\AcVar Date \\f "yyyy.MM.dd">%'],
 ['savedate', '저장한 날짜', () => '%<\\AcVar SaveDate \\f "yyyy.MM.dd">%'],
 ['plotdate', '출력한 날짜', () => '%<\\AcVar PlotDate \\f "yyyy.MM.dd">%'],
 ['filename', '파일 이름', () => '%<\\AcVar Filename \\f "%fn2">%'],
 ['area', '객체 면적(㎡)', id => `%<\\AcObjProp Object(%<\\_ObjId ${id}>%).Area \\f "%lu2%pr2%ct8[1e-006]%ps[,㎡]">%`],
 ['length', '객체 길이(mm)', id => `%<\\AcObjProp Object(%<\\_ObjId ${id}>%).Length \\f "%lu2%pr0">%`],
]);

const NEW_FIELD_COMMANDS = new Set(['add', 'batch', 'addMany', 'copy', 'paste', 'array', 'mirror', 'lisp.apply', 'block.insert', 'explode']);
/**
 * 화면 쪽 연결(app.js 는 몇 줄만). host = {doc(), lookup(ids), execute(command), mergeLastUndo(prev), context(), key()}.
 * - afterCommand(c, ids): 명령 끝에 바뀐 원본의 필드만 갱신하고 그 명령과 되돌리기 한 번으로 묶는다.
 * - refresh(when): 열기·저장·출력 때 필드 문자 전부(필드 문자 수만큼만).
 */
export function createFieldController(host) {
 let key = null, index = {texts: new Set(), bySource: new Map()}, busy = false;
 const rebuild = () => { key = host.key(); index = buildFieldIndex(host.doc()?.entities); return index; };
 const current = () => (host.key() === key ? index : rebuild());
 const apply = (updates, merge) => {
  if (!updates.length) return 0;
  const prev = merge ? host.doc() : null;   // 합칠 때 기준: 이 갱신 직전 문서(= 원본을 고친 명령이 끝난 문서)
  busy = true;
  try { host.execute({type: 'updateMany', updates}); } finally { busy = false; }
  if (merge && prev) host.mergeLastUndo(prev);
  for (const u of updates) if (u.changes.fields === null) index.texts.delete(u.id);
  return updates.length;
 };
 return {
  rebuild,
  get index() { return current(); },
  afterCommand(c, ids) {
   if (busy || !c || c.type === 'undo' || c.type === 'redo') return 0;
   const idx = current();
   if (NEW_FIELD_COMMANDS.has(c.type) && ids?.length && ids.length <= 5000) {
    for (const e of host.lookup(ids)) if (e?.type === 'text' && e.fields?.length && !idx.texts.has(e.id)) { rebuild(); break; }
   }
   const ctx = {...host.context(), byId: id => host.lookup([id])[0] || null};
   const changed = [...(ids || []), ...(c.ids || []), ...(c.id ? [c.id] : []), ...(c.updates || []).map(u => u?.id)].filter(Boolean);
   const updates = syncFieldsForChanges(index, changed, ctx, host.lookup);
   // 직접 고친 필드 문자(살아 있지 않음)는 보통 문자로 — 그 명령과 함께.
   const edited = changed.filter(id => index.texts.has(id));
   if (edited.length) for (const e of host.lookup(edited)) if (!isLiveField(e) && e.fields?.length && !updates.some(u => u.id === e.id)) updates.push({id: e.id, changes: {fields: null, fieldTemplate: null}});
   return apply(updates, true);
  },
  refresh(when, extra = {}) {
   const ctx = {...host.context(), ...extra, byId: id => host.lookup([id])[0] || null};
   return apply(syncAllFields(current(), when, ctx, host.lookup), false);
  },
 };
}

let activeController = null;
/** 화면이 만든 필드 연결(명령 모듈이 UPDATEFIELD 에서 쓴다). */
export const setActiveFieldController = c => { activeController = c; };
export const activeFieldController = () => activeController;
