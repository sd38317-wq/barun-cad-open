/* 바른 CAD · AutoCAD 단축키 파일(acad.pgp) 가져오기·내보내기와 "명령 하나에 별칭 여러 개".
 *
 * 설정 모양(하위 호환, version 1 그대로):
 *   settings.aliases      = { 명령: '대표 별칭' }       ← 예전 그대로(명령 하나에 하나). 도구 단추·도움말은 이 값만 보여 준다.
 *   settings.extraAliases = { 명령: ['별칭2', ...] }    ← 새 칸. 없으면 추가 별칭이 없다는 뜻이고, 예전 판은 이 칸을 모른 채 무시한다.
 * 별칭 규칙은 commands.js validateSettings 와 똑같다: 앞뒤 공백을 떼고 대문자로, 영문으로 시작하는 1~20자(또는 ?),
 * 다른 정식 명령 이름은 쓸 수 없고, 대표·추가를 통틀어 모든 별칭이 서로 달라야 한다.
 *
 * 이 파일은 순수 함수만 두고 아무것도 import 하지 않는다 — commands.js 가 불러도 순환 import 가 생기지 않는다.
 */

/* commands.js validateSettings 의 별칭 형식과 같은 식. 바꾸면 두 곳을 함께 바꾼다(pgp-aliases.test.js 가 대조한다). */
export const ALIAS_PATTERN = /^[A-Z][A-Z0-9_]{0,19}$|^\?$/;
export const normalizeAlias = (value) => String(value ?? '').trim().toUpperCase();

/* 바른 CAD 가 만든 pgp 인지 알아보는 표시(내보내기 머리말 둘째 줄). 주석에 "Barun CAD"라는 말만 있어서는 안 걸리게 구절 전체로 본다. */
export const PGP_MARKER = 'Barun CAD command aliases';

/* AutoCAD 명령 이름 → 바른 CAD 명령 이름. 하는 일이 같은 것만 적는다(이름이 같은 명령은 적지 않는다).
   바른 CAD 에 같은 이름의 명령이 생기면 그 명령이 먼저다(planPgpImport 는 이 표를 바른 CAD 에 없는 이름에만 쓴다). */
export const AUTOCAD_COMMAND_MAP = Object.freeze({
  RECTANG: 'RECTANGLE',        // 사각형
  BHATCH: 'HATCH',             // 옛 해치 명령
  DTEXT: 'TEXT',               // 한 줄 문자(AutoCAD 에서 TEXT 와 같은 명령)
  DDEDIT: 'TEXTEDIT',          // 문자 편집(resolveCommand 기본 해석과 같다)
  DDIM: 'DIMSTYLE',            // 옛 치수 스타일 대화상자
  DDMODIFY: 'PROPERTIES',      // 옛 특성 창
  QSAVE: 'SAVE',
  QNEW: 'NEW',
  PRINT: 'PLOT',
  EXPORTPDF: 'PDF',
  REDRAW: 'REGEN', REDRAWALL: 'REGEN', REGENALL: 'REGEN',
  MREDO: 'REDO',
  ARRAYRECT: 'ARRAY',          // 바른 ARRAY = 직사각 배열
  ARRAYPOLAR: 'POLARARRAY',
  PEDIT: 'PLINEEDIT',          // 폴리선 정점·방향·닫힘 편집
  QDIM: 'QUICKDIM',            // 빠른 연속 치수
  DIMTEDIT: 'DIMTEXTMOVE',     // 치수 문자 위치
  DIMSPACE: 'DIMCLEAN',        // 치수 간격 정리
  QLEADER: 'LEADER',
  FIND: 'FINDREPLACE',         // 문자 찾아 바꾸기
  XPLODE: 'EXPLODE',
  LAYMRG: 'LAYMERGE',          // 레이어 합치기
  LAYMCH: 'LC',                // 객체를 고른 레이어로 옮기기(ACAD200 706)
  LAYERSTATE: 'LAYSTATE',      // 레이어 상태 저장 복구
  LAYUNISO: 'LAYRESTORE',      // LAYISO 로 숨긴 레이어 되살리기
  LAYLCK: 'LAYLOCK',           // 선택 객체 레이어 잠금
  LAYULK: 'LU',                // 선택 객체의 레이어 잠금 풀기
  LAYERP: 'LUI',               // 직전 레이어 상태 복구
  HIDEOBJECTS: 'HIDE',         // 객체 숨기기
  UNISOLATEOBJECTS: 'SHOWALL', // 객체 모두 표시
  ALIASEDIT: 'SETTINGS',       // 별칭 편집(Express Tools)
});

/* 이름은 같지만 하는 일이 다른 명령. AutoCAD 에서 온 pgp 의 이 명령 줄은 "바른 CAD 에 없는 명령"으로 돌린다.
   (바른 CAD 가 내보낸 pgp 는 바른 CAD 이름이므로 그대로 받는다.) */
export const AUTOCAD_FALSE_FRIENDS = Object.freeze({
  HIDE: 'AutoCAD HIDE 는 3D 은선 제거, 바른 CAD HIDE 는 선택 객체 숨기기',
  CONVERT: 'AutoCAD CONVERT 는 옛 폴리선·해치 변환, 바른 CAD CONVERT 는 DWG·DXF 일괄 변환',
});

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const has = (object, key) => isObject(object) && Object.hasOwn(object, key);

/* 설정 창 칸에 친 "C, CP" · "C CP" · "c;cp" → ['C','CP']. 빈 칸·중복은 뺀다. */
export function splitAliasText(text) {
  const out = [];
  for (const token of String(text ?? '').split(/[\s,;]+/)) {
    const alias = token.toUpperCase();
    if (alias && !out.includes(alias)) out.push(alias);
  }
  return out;
}
const listOf = (value) => (Array.isArray(value) ? value : typeof value === 'string' ? splitAliasText(value) : []);

/* 한 명령의 별칭 전부(대표가 먼저). */
export function aliasesOf(settings, name) {
  const out = [];
  const primary = normalizeAlias(settings?.aliases?.[name]);
  if (primary) out.push(primary);
  for (const item of listOf(has(settings?.extraAliases, name) ? settings.extraAliases[name] : null)) {
    const alias = normalizeAlias(item);
    if (alias && !out.includes(alias)) out.push(alias);
  }
  return out;
}
/* 설정 창 별칭 칸에 넣을 글: "C, CP". */
export const aliasFieldText = (settings, name) => aliasesOf(settings, name).join(', ');

/* 설정 창 별칭 칸 글을 저장 초안에 넣는다: 첫 별칭은 aliases, 나머지는 extraAliases. */
export function putAliasField(draft, name, text) {
  const [primary = '', ...rest] = splitAliasText(text);
  if (!isObject(draft.aliases)) draft.aliases = {};
  draft.aliases[name] = primary;
  if (rest.length) {
    if (!isObject(draft.extraAliases)) draft.extraAliases = {};
    draft.extraAliases[name] = rest;
  } else if (has(draft.extraAliases, name)) delete draft.extraAliases[name];
  return draft;
}

/* 겹침 표시용: 별칭 칸은 낱말마다, 단축키 칸은 칸 전체가 한 값이다(Ctrl+, 처럼 쉼표가 든 단축키가 있다). */
export function fieldTokens(kind, value) {
  if (kind === 'alias') return splitAliasText(value);
  const key = String(value ?? '').trim().toUpperCase();
  return key ? [key] : [];
}
/* 별칭 칸에서 한 낱말만 뺀다(겹침 해결 단추). */
export const withoutAliasToken = (text, alias) =>
  splitAliasText(text).filter((item) => item !== normalizeAlias(alias)).join(', ');

/* resolveCommand 용: key 가 name 의 추가 별칭인가. 검사를 거치지 않은 설정(문자열 등)은 무시한다. */
export function hasExtraAlias(settings, name, key) {
  if (!key) return false;
  const list = has(settings?.extraAliases, name) ? settings.extraAliases[name] : null;
  return Array.isArray(list) && list.includes(key);
}

/* validateSettings 가 대표 별칭을 검사·정규화한 "뒤에" 부른다. 추가 별칭을 같은 규칙으로 검사하고 제자리에서 정리한다.
   - 추가 별칭이 없으면 extraAliases 칸을 만들지 않는다(예전 설정은 한 글자도 바뀌지 않는다).
   - 없어진 명령의 추가 별칭은 버린다(대표 별칭의 모르는 명령 칸을 validateSettings 가 쓰지 않는 것과 같다).
   - 자기 이름·이미 자기 것인 별칭은 조용히 뺀다. 그 밖의 위반은 validateSettings 와 같은 문구·conflict 로 던진다.
   - 대표 별칭이 빈 명령에 추가 별칭이 있으면 첫 것을 대표로 올린다. */
export function validateExtraAliases(s, names) {
  const known = names instanceof Set ? names : new Set(names);
  const raw = s.extraAliases;
  if (raw === undefined || raw === null) {
    delete s.extraAliases;
    return s;
  }
  if (!isObject(raw)) throw Error('설정 파일 형식이 올바르지 않습니다.');
  const used = new Map();
  for (const name of known) {
    const alias = normalizeAlias(s.aliases?.[name]);
    if (alias) used.set(alias, name);
  }
  const out = {};
  for (const [name, value] of Object.entries(raw)) {
    if (!known.has(name)) continue;
    if (typeof value !== 'string' && !(Array.isArray(value) && value.every((item) => typeof item === 'string')))
      throw Error('별칭은 문자열이어야 합니다.');
    const kept = [];
    for (const item of listOf(value)) {
      const alias = normalizeAlias(item);
      if (!alias || alias === name || used.get(alias) === name) continue;
      if (!ALIAS_PATTERN.test(alias)) throw Error(name + ': 별칭은 영문으로 시작하는 1~20자입니다.');
      if (known.has(alias)) throw Error(alias + '는 다른 정식 명령 이름입니다.');
      if (used.has(alias)) {
        const clash = Error(`${alias}: ${used.get(alias)}와 ${name}의 별칭이 겹칩니다.`);
        clash.conflict = { kind: 'alias', value: alias, holder: used.get(alias), wanted: name };
        throw clash;
      }
      used.set(alias, name);
      kept.push(alias);
    }
    // 대표 칸이 비었는데 추가 별칭만 있으면 첫 추가 별칭을 대표로 올린다(설정 창 칸 → 저장이 같은 모양이 되게).
    if (kept.length && !normalizeAlias(s.aliases?.[name]) && isObject(s.aliases)) s.aliases[name] = kept.shift();
    if (kept.length) out[name] = kept;
  }
  if (Object.keys(out).length) s.extraAliases = out;
  else delete s.extraAliases;
  return s;
}

/* 저장된 설정을 새 모양으로 옮긴다(순수 함수, 입력은 건드리지 않고 복사본을 돌려준다).
   - 예전 설정 {version, aliases, hotkeys}: 내용이 똑같은 복사본(extraAliases 칸도 만들지 않는다).
   - 손으로 고친 JSON 의 aliases.COPY = "C, CP": 첫 별칭은 대표, 나머지는 extraAliases 로 옮긴다.
   - extraAliases.COPY = "CP CO" 처럼 글로 적은 것은 배열로 바꾼다.
   형식 검사는 하지 않는다 — 뒤이어 validateSettings(repairSettings)가 한다. */
export function migrateAliasSettings(raw) {
  if (!isObject(raw)) return raw;
  const next = structuredClone(raw);
  if (isObject(next.aliases)) {
    for (const [name, value] of Object.entries(next.aliases)) {
      if (typeof value !== 'string') continue;
      const [primary = '', ...rest] = splitAliasText(value);
      if (!rest.length) continue;
      next.aliases[name] = primary;
      if (!isObject(next.extraAliases)) next.extraAliases = {};
      next.extraAliases[name] = [...rest, ...listOf(next.extraAliases[name])];
    }
  }
  if (isObject(next.extraAliases))
    for (const [name, value] of Object.entries(next.extraAliases))
      if (typeof value === 'string') next.extraAliases[name] = splitAliasText(value);
  return next;
}

/* ── acad.pgp 읽기 ──
   줄 형식: "별칭, *명령". ';' 뒤는 주석. BOM·CRLF·탭·소문자·빈 줄을 받는다.
   두 번째 칸이 *로 시작하지 않고 칸이 셋 이상이면 외부 프로그램 줄(예: NOTEPAD, START NOTEPAD, 1,*File to edit: ,) → skipped.
   같은 별칭이 다시 나오면 뒤의 줄을 쓰고 앞의 줄은 skipped(reason 'duplicate')로 알린다. */
export function parsePgp(text) {
  const entries = [], skipped = [], errors = [];
  const at = new Map(); // alias → entries 위치
  let origin = 'autocad';
  const source = String(text ?? '').replace(/\u0000/g, '').replace(/^[﻿￾�]+/, '');
  source.split(/\r\n|\r|\n/).forEach((raw, index) => {
    const line = index + 1;
    const semi = raw.indexOf(';');
    if (semi >= 0 && raw.slice(semi + 1).includes(PGP_MARKER)) origin = 'barun';
    const body = (semi >= 0 ? raw.slice(0, semi) : raw).replace(/ /g, ' ').trim();
    if (!body) return;
    const fail = (reason, message) => errors.push({ line, text: body, reason, message: `${line}번째 줄: ${message}` });
    const fields = body.split(',').map((field) => field.trim());
    if (fields.length < 2) return fail('no-comma', '"별칭, *명령" 형식이 아닙니다(쉼표가 없습니다).');
    const [aliasField, commandField] = fields;
    if (!commandField.startsWith('*')) {
      if (fields.length >= 3) {
        skipped.push({ line, text: body, reason: 'external', alias: aliasField.toUpperCase() });
        return;
      }
      return fail('no-star', '명령 이름 앞에 *가 없습니다.');
    }
    const alias = aliasField.toUpperCase(), command = commandField.slice(1).trim().toUpperCase();
    if (!alias || /[\s*]/.test(alias)) return fail('bad-alias', '별칭이 비었거나 공백·*가 들어 있습니다.');
    if (!command || /\s/.test(command)) return fail('bad-command', '명령 이름이 비었거나 공백이 들어 있습니다.');
    if (at.has(alias)) {
      const earlier = entries[at.get(alias)];
      skipped.push({ line: earlier.line, text: earlier.text, reason: 'duplicate', alias, command: earlier.command, by: line });
      entries[at.get(alias)] = null;
    }
    at.set(alias, entries.length);
    entries.push({ alias, command, line, text: body });
  });
  return {
    entries: entries.filter(Boolean).map(({ alias, command, line }) => ({ alias, command, line })),
    skipped: skipped.sort((a, b) => a.line - b.line),
    errors,
    origin,
  };
}

/* ── 가져오기 계획 ──
   entries: parsePgp(...).entries
   options.commands       바른 CAD 명령 이름 전체(COMMANDS 이름 — validateSettings 의 names 와 같은 목록). 대상이자 "정식 명령 이름" 검사 목록.
   options.current        검사를 마친 지금 설정 {aliases, extraAliases}  (또는 currentAliases + extraAliases 로 따로)
   options.protectedNames 별칭으로 쓰면 안 되는 이름을 더 줄 때(예: 메뉴 전용 명령, 리습 명령).
   options.commandMap     AutoCAD→바른 CAD 이름표(기본 AUTOCAD_COMMAND_MAP). 바른 CAD 에 없는 이름에만 쓴다.
   options.redirect       바른 CAD 안의 숨은 호환 이름 → 대표 명령(MENU_COMPAT_ALIASES). 설정 창에 칸이 없는 명령에 별칭을 달면
                          저장할 때 사라지므로 대표 명령으로 돌린다.
   options.origin         parsePgp(...).origin. 'barun' 이면 이름이 같은 다른 명령(AUTOCAD_FALSE_FRIENDS)도 그대로 받는다.
   options.resolve        (alias)=>명령|null. 주면 이미 그 명령으로 풀리는 별칭(기본 해석 CP→COPY 등)은 unchanged 로 본다.
   결과: apply(새로 넣을 것) · unchanged(이미 같음) · unmatched(바른 CAD 에 없는 명령) · conflicts(넣지 못함/겹침).
   conflicts 의 reason: 'format'(별칭 형식) · 'command-name'(다른 정식 명령 이름) · 'protected' · 'alias-taken'(다른 명령이 쓰는 별칭, takeable). */
export function planPgpImport(entries, options = {}) {
  const {
    commands, current, currentAliases, extraAliases, protectedNames = [],
    commandMap = AUTOCAD_COMMAND_MAP, redirect = {}, falseFriends = AUTOCAD_FALSE_FRIENDS, origin = 'autocad', resolve = null,
  } = options;
  const targets = new Set([...(commands ?? [])].map(normalizeAlias).filter(Boolean));
  if (!targets.size) throw TypeError('planPgpImport: commands(바른 CAD 명령 이름 목록)가 필요합니다.');
  const primaries = current?.aliases ?? currentAliases ?? {};
  const extras = current ? current.extraAliases : extraAliases;
  const guarded = new Set([...protectedNames].map(normalizeAlias).filter(Boolean));
  const holders = new Map();
  for (const name of targets) {
    const alias = normalizeAlias(has(primaries, name) ? primaries[name] : '');
    if (alias) holders.set(alias, { command: name, kind: 'primary' });
  }
  for (const name of targets)
    for (const item of listOf(has(extras, name) ? extras[name] : null)) {
      const alias = normalizeAlias(item);
      if (alias && !holders.has(alias)) holders.set(alias, { command: name, kind: 'extra' });
    }
  const apply = [], unmatched = [], conflicts = [], unchanged = [];
  for (const entry of entries ?? []) {
    const alias = normalizeAlias(entry.alias), source = normalizeAlias(entry.command), line = entry.line ?? null;
    const base = source.replace(/^[-_.'+]+/, ''); // -LAYER(명령창판)·_LINE(영문 이름)은 같은 명령
    if (origin !== 'barun' && targets.has(base) && has(falseFriends, base)) {
      unmatched.push({ alias, command: base, source, line, reason: 'different', message: `${alias} → ${base}: ${falseFriends[base]}` });
      continue;
    }
    let target = !targets.has(base) && has(commandMap, base) ? normalizeAlias(commandMap[base]) : base;
    if (has(redirect, target)) target = normalizeAlias(redirect[target]);
    if (!targets.has(target)) {
      unmatched.push({ alias, command: base, source, line, reason: 'unknown', message: `${alias} → ${base}: 바른 CAD 에 없는 명령입니다.` });
      continue;
    }
    const item = { alias, command: target, source, line };
    if (target !== base) item.mapped = true;
    if (alias === target) { unchanged.push({ ...item, why: 'name' }); continue; }
    const holder = holders.get(alias);
    if (holder?.command === target) { unchanged.push({ ...item, why: holder.kind }); continue; }
    // 아래 세 검사는 validateSettings 와 같은 순서·규칙이다.
    if (!ALIAS_PATTERN.test(alias)) {
      conflicts.push({ ...item, reason: 'format', takeable: false, message: `${alias} → ${target}: 별칭은 영문으로 시작하는 1~20자입니다.` });
      continue;
    }
    if (targets.has(alias)) {
      conflicts.push({ ...item, reason: 'command-name', holder: alias, takeable: false, message: `${alias} → ${target}: ${alias}는 다른 정식 명령 이름입니다.` });
      continue;
    }
    if (guarded.has(alias)) {
      conflicts.push({ ...item, reason: 'protected', holder: alias, takeable: false, message: `${alias} → ${target}: ${alias}는 바른 CAD 가 따로 쓰는 이름입니다.` });
      continue;
    }
    if (holder) {
      conflicts.push({ ...item, reason: 'alias-taken', holder: holder.command, holderKind: holder.kind, takeable: true, message: `${alias} → ${target}: 지금은 ${holder.command}의 별칭입니다.` });
      continue;
    }
    if (typeof resolve === 'function') {
      const now = resolve(alias);
      if (now === target) { unchanged.push({ ...item, why: 'builtin' }); continue; }
      if (now) item.overrides = now;
    }
    apply.push(item);
  }
  return { apply, unmatched, conflicts, unchanged };
}

function dropAlias(aliases, extras, name, alias) {
  if (normalizeAlias(aliases[name]) === alias) {
    const list = extras[name] ?? [];
    aliases[name] = list.shift() ?? '';
    if (!list.length) delete extras[name];
    return;
  }
  if (extras[name]) {
    extras[name] = extras[name].filter((item) => item !== alias);
    if (!extras[name].length) delete extras[name];
  }
}
function addAlias(aliases, extras, name, alias) {
  const primary = normalizeAlias(aliases[name]);
  if (primary === alias || extras[name]?.includes(alias)) return;
  if (!primary) aliases[name] = alias;
  else (extras[name] ??= []).push(alias);
}

/* 계획을 설정에 적용한 새 설정(입력은 그대로). takeOver 면 다른 명령이 쓰던 별칭(takeable)도 pgp 쪽으로 옮긴다.
   별칭을 잃은 명령은 첫 추가 별칭이 대표가 되고, 없으면 pgp 에 있던 그 명령의 "이미 되는" 별칭(resolve 로 unchanged·builtin,
   예: CO→COPY)을 칸에 적고, 그것도 없으면 대표 별칭이 빈 칸이 된다(정식 이름은 늘 쓸 수 있다).
   새 별칭은 대표 별칭이 비어 있을 때만 대표가 되고, 아니면 추가 별칭으로 붙는다. current 는 검사를 마친 설정이어야 한다. */
export function applyPgpPlan(current, plan, { takeOver = false } = {}) {
  const next = structuredClone(current ?? {});
  next.aliases = { ...(next.aliases ?? {}) };
  const extras = {};
  for (const [name, value] of Object.entries(isObject(next.extraAliases) ? next.extraAliases : {})) {
    const list = listOf(value).map(normalizeAlias).filter(Boolean);
    if (list.length) extras[name] = list;
  }
  const moves = [...(plan?.apply ?? []), ...(takeOver ? (plan?.conflicts ?? []).filter((item) => item.takeable) : [])]
    .sort((a, b) => (a.line ?? 0) - (b.line ?? 0));
  for (const move of moves) {
    if (move.takeable) dropAlias(next.aliases, extras, move.holder, move.alias);
    addAlias(next.aliases, extras, move.command, move.alias);
  }
  // 대표 별칭을 잃어 빈 칸이 된 명령에 pgp 가 준 "이미 되는" 별칭(기본 해석 CO→COPY 등)이 있으면 칸에 적어 보이게 한다.
  const emptied = new Set(Object.keys(next.aliases).filter((name) => normalizeAlias(current?.aliases?.[name]) && !normalizeAlias(next.aliases[name])));
  const owned = new Set([...Object.values(next.aliases).map(normalizeAlias), ...Object.values(extras).flat()]);
  for (const item of (plan?.unchanged ?? []).filter((entry) => entry.why === 'builtin').sort((a, b) => (a.line ?? 0) - (b.line ?? 0))) {
    if (!emptied.has(item.command) || owned.has(item.alias)) continue;
    addAlias(next.aliases, extras, item.command, item.alias);
    owned.add(item.alias);
  }
  if (Object.keys(extras).length) next.extraAliases = extras;
  else delete next.extraAliases;
  return next;
}

/* 설정 → {별칭: 명령}. 자기 이름과 같은 별칭(PLOT=PLOT 등)은 적지 않는다. commands 를 주면 그 명령만. */
export function aliasMapFromSettings(settings, commands) {
  const names = commands
    ? [...commands]
    : [...new Set([...Object.keys(settings?.aliases ?? {}), ...Object.keys(isObject(settings?.extraAliases) ? settings.extraAliases : {})])];
  const map = {};
  for (const name of names)
    for (const alias of aliasesOf(settings, name))
      if (alias !== name && !Object.hasOwn(map, alias)) map[alias] = name;
  return map;
}

function pairsOf(aliasMap) {
  if (aliasMap instanceof Map) return [...aliasMap];
  if (Array.isArray(aliasMap)) return aliasMap.map((item) => (Array.isArray(item) ? item : [item?.alias, item?.command]));
  return Object.entries(aliasMap ?? {});
}
const PGP_TOKEN = /^[^\s,;*]+$/;

/* ── acad.pgp 쓰기 ──
   aliasMap: {별칭: 명령} · Map · [[별칭, 명령]] · [{alias, command}].  별칭 순으로 "별칭,<공백>*명령" 줄을 CRLF 로 쓴다.
   header: true(기본) = 한/영 머리말 · false = 머리말 없음 · 문자열/배열 = 기본 머리말 뒤에 붙일 주석 줄.
   BOM 은 붙이지 않는다(옛 AutoCAD 가 첫 줄을 잘못 읽지 않도록). 머리말의 한글은 주석이라 AutoCAD 가 읽지 않는다. */
export function serializePgp(aliasMap, { header = true } = {}) {
  const pairs = new Map();
  for (const [rawAlias, rawCommand] of pairsOf(aliasMap)) {
    const alias = normalizeAlias(rawAlias), command = normalizeAlias(rawCommand).replace(/^\*/, '');
    if (!PGP_TOKEN.test(alias) || !PGP_TOKEN.test(command))
      throw Error(`acad.pgp 에 쓸 수 없는 별칭입니다: ${rawAlias} → ${rawCommand}`);
    if (pairs.has(alias) && pairs.get(alias) !== command)
      throw Error(`${alias} 별칭이 ${pairs.get(alias)}와 ${command}에 겹칩니다.`);
    pairs.set(alias, command);
  }
  const sorted = [...pairs].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const width = Math.max(10, ...sorted.map(([alias]) => alias.length + 2));
  const lines = [];
  if (header !== false) {
    lines.push(
      '; 바른 CAD 명령 별칭 - AutoCAD acad.pgp 형식',
      `; ${PGP_MARKER} - AutoCAD acad.pgp format`,
      ';',
      '; 형식 / Format:  별칭,  *명령   (ALIAS,  *COMMAND)',
      "; ';' 뒤는 주석입니다. / Text after ';' is a comment.",
      "; 바른 CAD 설정 창의 'acad.pgp 가져오기'로 다시 불러올 수 있습니다.",
      "; Load it back with 'acad.pgp 가져오기' in the Barun CAD settings dialog.",
    );
    if (typeof header === 'string' || Array.isArray(header))
      for (const text of [].concat(header).flatMap((item) => String(item).split(/\r\n|\r|\n/)))
        lines.push(text.startsWith(';') ? text : `; ${text}`.trimEnd());
    lines.push('');
  }
  for (const [alias, command] of sorted) lines.push(`${(alias + ',').padEnd(width)}*${command}`);
  return lines.join('\r\n') + '\r\n';
}

/* 가져오기 결과 한 줄 안내(설정 창 settings-error 칸). */
export function pgpImportSummary(parsed, plan, { takeOver = false } = {}) {
  const sample = (items, format) => {
    const shown = items.slice(0, 5).map(format).join(', ');
    return items.length > 5 ? `${shown} 외 ${items.length - 5}개` : shown;
  };
  const taken = plan.conflicts.filter((item) => item.takeable);
  const blocked = plan.conflicts.filter((item) => !item.takeable);
  const external = parsed?.skipped?.filter((item) => item.reason === 'external') ?? [];
  const duplicate = parsed?.skipped?.filter((item) => item.reason === 'duplicate') ?? [];
  const parts = [`새로 넣음 ${plan.apply.length + (takeOver ? taken.length : 0)}개`, `이미 같음 ${plan.unchanged.length}개`];
  if (taken.length)
    parts.push(`다른 명령이 쓰던 별칭 ${taken.length}개 ${takeOver ? '옮김' : '그대로 둠'}(${sample(taken, (item) => `${item.alias}: ${item.holder}→${item.command}`)})`);
  if (plan.unmatched.length) parts.push(`바른 CAD 에 없는 명령 ${plan.unmatched.length}개(${sample(plan.unmatched, (item) => `${item.alias}→${item.command}`)})`);
  if (blocked.length) parts.push(`넣지 못함 ${blocked.length}개(${sample(blocked, (item) => item.alias)})`);
  if (external.length) parts.push(`외부 프로그램 줄 ${external.length}개 건너뜀`);
  if (duplicate.length) parts.push(`같은 별칭 ${duplicate.length}줄은 뒤의 줄 사용`);
  if (parsed?.errors?.length) parts.push(`읽지 못한 줄 ${parsed.errors.length}개(${sample(parsed.errors, (item) => item.line + '번째')})`);
  return `acad.pgp: ${parts.join(' · ')}.`;
}
