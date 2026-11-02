// H05 · AutoCAD 단축키 파일(acad.pgp) 가져오기·내보내기와 명령 하나에 별칭 여러 개.
import test from 'node:test';
import assert from 'node:assert/strict';
import { COMMANDS, defaultAliases, defaultHotkeys, validateSettings, resolveCommand } from './commands.js';
import { MENU_COMPAT_ALIASES } from './menu-catalog.js';
import {
  ALIAS_PATTERN, AUTOCAD_COMMAND_MAP, AUTOCAD_FALSE_FRIENDS, PGP_MARKER,
  parsePgp, planPgpImport, applyPgpPlan, serializePgp, aliasMapFromSettings, pgpImportSummary,
  validateExtraAliases, migrateAliasSettings, hasExtraAlias, aliasesOf, aliasFieldText, putAliasField,
  fieldTokens, withoutAliasToken, splitAliasText,
} from './pgp-aliases.js';

const NAMES = new Set(COMMANDS.map((c) => c.name));
const VISIBLE = COMMANDS.filter((c) => !Object.hasOwn(MENU_COMPAT_ALIASES, c.name)).map((c) => c.name);
const fresh = () => validateSettings({ version: 1, aliases: defaultAliases(), hotkeys: defaultHotkeys() });
// commands.js 통합 뒤의 validateSettings 와 같은 조합(대표 별칭 검사 → 추가 별칭 검사).
const validatePatched = (s) => validateExtraAliases(validateSettings(s), NAMES);
// commands.js 통합 뒤의 resolveCommand 와 같은 순서(정식 이름 → 추가 별칭 → 기존 해석).
const resolvePatched = (text, settings) => {
  const key = String(text).trim().toUpperCase();
  return COMMANDS.find((c) => c.name === key)?.name
    || COMMANDS.find((c) => hasExtraAlias(settings, c.name, key))?.name
    || resolveCommand(text, settings);
};
// app.js repairSettings 에 제안한 변경(종류 목록에 extraAliases 추가)과 같은 코드.
function repairPatched(raw, validate = validatePatched) {
  try {
    return { settings: validate(structuredClone(raw)), dropped: [] };
  } catch {}
  const draft = { version: 1, aliases: {}, hotkeys: {}, extraAliases: {} };
  const dropped = [];
  for (const kind of ['aliases', 'hotkeys', 'extraAliases'])
    for (const [name, value] of Object.entries(raw?.[kind] || {})) {
      const trial = structuredClone(draft);
      trial[kind][name] = value;
      try {
        validate(structuredClone(trial));
        draft[kind][name] = value;
      } catch {
        dropped.push(`${name}=${value}`);
      }
    }
  return { settings: validate(draft), dropped };
}

/* 실제 acad.pgp 모양의 발췌(주석·외부 명령·BOM·CRLF·탭·소문자·중복·빈 줄·틀린 줄). 47줄. */
const ACAD_PGP = '﻿' + [
  ';  acad.pgp - AutoCAD program parameters (test excerpt written for Barun CAD)',
  ';  Format:  <alias>,*<command>',
  ';  External commands:  <name>,<OS request>,<flags>,[*]<prompt>,',
  '',
  ';  -- External commands --',
  'EXPLORER,  START EXPLORER, 1,,',
  'NOTEPAD,   START NOTEPAD,  1,*File to edit: ,',
  'PBRUSH,    START PBRUSH,   1,,',
  '',
  ';  -- Command aliases --',
  '3A,        *3DARRAY',
  'A,         *ARC',
  'AA,        *AREA',
  'AL,        *ALIGN',
  'AR,        *ARRAY',
  '-AR,       *-ARRAY',
  'B,         *BLOCK',
  'BH,        *HATCH',
  'BO,        *BOUNDARY',
  'C,         *CIRCLE',
  'CO,        *COPY',
  'CP,        *COPY',
  'DCO,       *DIMCONTINUE',
  'DT,        *TEXT',
  'E,         *ERASE',
  'ED,        *DDEDIT',
  'F,         *FILLET',
  'HI,        *HIDE',
  'L,         *LINE        ; 선 긋기',
  'LEN,       *LENGTHEN',
  'M,         *MOVE',
  'o,\t*offset',
  'P,         *PAN',
  'PE,        *PEDIT',
  'PL,        *PLINE',
  'REC,       *RECTANG',
  'RE,        *REGEN',
  'S,         *STRETCH',
  'T,         *MTEXT',
  'TR,\t\t*TRIM',
  'X,         *EXPLODE',
  'Z,         *ZOOM',
  '',
  'DT,        *DTEXT',
  'FOO        *LINE',
  'RG,        REGEN',
  '',
].join('\r\n');

/* 명령 목록이 다른 작업으로 바뀌어도 흔들리지 않도록, 정확한 기대값은 고정된 작은 명령표로 본다(바른 CAD 실제 기본값에서 가져옴). */
const FIXTURE = {
  ARC: 'A', AREA: 'AA', ALIGN: 'AL', ARRAY: 'AR', BLOCK: 'B', HATCH: 'H', COPY: 'C', CIRCLE: 'CI', DIMCONTINUE: 'DIMCONTINUE',
  TEXT: 'T', TEXTEDIT: 'TEXTEDIT', ERASE: 'E', ED: 'ED', FIT: 'F', FILLET: 'FIL', HIDE: 'HIDE', LINE: 'L', LEN: 'LEN',
  LENGTHADJUST: 'LAD', LENGTHEN: 'LENGTHEN', MOVE: 'M', OFFSET: 'O', PAN: 'PAN', PLINE: 'P', PLINEEDIT: 'PED', RECTANGLE: 'REC', REGEN: 'REGEN',
  REDO: 'RE', SAVE: 'S', STRETCH: 'STRT', TRIM: 'TR', EXPLODE: 'X', ZOOM: 'Z',
};
const fixtureSettings = () => ({ version: 1, aliases: { ...FIXTURE }, hotkeys: {} });
// 실제 명령표로 하는 시험에서 비어 있는 별칭으로 쓰는 이름. 다른 작업이 같은 이름의 명령·기본 별칭을 만들면 여기서 먼저 알린다.
const FREE_ALIASES = ['CPX', 'DUP', 'CR2', 'CR3', 'LNX', 'OPN', 'QZ1'];
const pick = (items) => items.map((item) => `${item.alias}>${item.command}`).sort();

test('test aliases used against the real command table are still free', () => {
  const taken = new Set(Object.values(defaultAliases()).map((alias) => alias.toUpperCase()));
  for (const alias of FREE_ALIASES) assert.ok(!NAMES.has(alias) && !taken.has(alias), `${alias} is now a real command or default alias; pick another test alias`);
});

test('parsePgp reads a realistic acad.pgp: BOM, CRLF, tabs, lowercase, comments, external commands, duplicates, bad lines', () => {
  assert.equal(ACAD_PGP.split('\r\n').length, 47);
  const parsed = parsePgp(ACAD_PGP);
  assert.equal(parsed.origin, 'autocad');
  assert.equal(parsed.entries.length, 32);
  assert.deepEqual(parsed.entries[0], { alias: '3A', command: '3DARRAY', line: 11 });
  assert.deepEqual(parsed.entries.find((e) => e.alias === 'O'), { alias: 'O', command: 'OFFSET', line: 32 }, 'lowercase + tab');
  assert.deepEqual(parsed.entries.find((e) => e.alias === 'TR'), { alias: 'TR', command: 'TRIM', line: 40 }, 'two tabs');
  assert.deepEqual(parsed.entries.find((e) => e.alias === 'L'), { alias: 'L', command: 'LINE', line: 29 }, 'inline comment');
  assert.deepEqual(parsed.entries.find((e) => e.alias === '-AR'), { alias: '-AR', command: '-ARRAY', line: 16 });
  // 같은 별칭은 뒤의 줄이 이긴다. 앞 줄은 skipped 로 알린다.
  assert.deepEqual(parsed.entries.filter((e) => e.alias === 'DT'), [{ alias: 'DT', command: 'DTEXT', line: 44 }]);
  const external = parsed.skipped.filter((s) => s.reason === 'external');
  assert.deepEqual(external.map((s) => [s.line, s.alias]), [[6, 'EXPLORER'], [7, 'NOTEPAD'], [8, 'PBRUSH']]);
  const duplicate = parsed.skipped.filter((s) => s.reason === 'duplicate');
  assert.deepEqual(duplicate.map((s) => ({ line: s.line, alias: s.alias, command: s.command, by: s.by })), [{ line: 24, alias: 'DT', command: 'TEXT', by: 44 }]);
  assert.equal(parsed.skipped.length, 4);
  assert.deepEqual(parsed.errors.map((e) => [e.line, e.reason]), [[45, 'no-comma'], [46, 'no-star']]);
  assert.match(parsed.errors[0].message, /^45번째 줄/);
  // 빈 글·주석뿐인 글·null 도 받는다.
  assert.deepEqual(parsePgp(''), { entries: [], skipped: [], errors: [], origin: 'autocad' });
  assert.deepEqual(parsePgp('; only a comment\r\n\r\n').entries, []);
  assert.deepEqual(parsePgp(null).entries, []);
  // 오래된 편집기가 저장한 UTF-16(널 문자 끼임)과 CR 만 쓴 줄바꿈.
  assert.deepEqual(parsePgp('L,\u0000 *LINE\rC, *COPY').entries.map((e) => e.alias), ['L', 'C']);
  // 별칭·명령 칸 오류.
  assert.deepEqual(parsePgp('A B, *LINE\n, *LINE\nZ, *\nQ, *Q SAVE').errors.map((e) => e.reason), ['bad-alias', 'bad-alias', 'bad-command', 'bad-command']);
});

test('planPgpImport sorts every line into apply / unchanged / unmatched / conflicts (fixed command table)', () => {
  const parsed = parsePgp(ACAD_PGP);
  const plan = planPgpImport(parsed.entries, { commands: Object.keys(FIXTURE), current: fixtureSettings() });
  assert.deepEqual(pick(plan.unchanged), ['A>ARC', 'AA>AREA', 'AL>ALIGN', 'AR>ARRAY', 'B>BLOCK', 'E>ERASE', 'L>LINE', 'M>MOVE', 'O>OFFSET', 'REC>RECTANGLE', 'TR>TRIM', 'X>EXPLODE', 'Z>ZOOM']);
  assert.deepEqual(pick(plan.apply), ['BH>HATCH', 'CO>COPY', 'CP>COPY', 'DCO>DIMCONTINUE', 'DT>TEXT', 'PE>PLINEEDIT', 'PL>PLINE']);
  assert.deepEqual(plan.unmatched.map((u) => `${u.alias}>${u.command}:${u.reason}`).sort(), ['3A>3DARRAY:unknown', 'BO>BOUNDARY:unknown', 'HI>HIDE:different', 'T>MTEXT:unknown']);
  assert.deepEqual(plan.conflicts.map((c) => `${c.alias}>${c.command}:${c.reason}:${c.holder ?? ''}:${c.takeable}`).sort(), [
    '-AR>ARRAY:format::false', 'C>CIRCLE:alias-taken:COPY:true', 'ED>TEXTEDIT:command-name:ED:false', 'F>FILLET:alias-taken:FIT:true',
    'LEN>LENGTHEN:command-name:LEN:false', 'P>PAN:alias-taken:PLINE:true', 'RE>REGEN:alias-taken:REDO:true', 'S>STRETCH:alias-taken:SAVE:true',
  ]);
  const total = plan.apply.length + plan.unchanged.length + plan.unmatched.length + plan.conflicts.length;
  assert.equal(total, parsed.entries.length, 'every entry lands in exactly one bucket');
  // AutoCAD 이름을 바꾼 것은 표시한다.
  assert.equal(plan.apply.find((a) => a.alias === 'PE').mapped, true);
  assert.equal(plan.apply.find((a) => a.alias === 'PE').source, 'PEDIT');
  assert.equal(plan.unchanged.find((a) => a.alias === 'REC').mapped, true);
  assert.equal(plan.apply.find((a) => a.alias === 'CO').mapped, undefined);
  assert.equal(plan.unchanged.find((a) => a.alias === 'A').why, 'primary');
});

test('applyPgpPlan keeps current owners by default and moves them only with takeOver', () => {
  const plan = planPgpImport(parsePgp(ACAD_PGP).entries, { commands: Object.keys(FIXTURE), current: fixtureSettings() });
  const before = fixtureSettings();
  const kept = applyPgpPlan(before, plan);
  assert.deepEqual(before, fixtureSettings(), 'input is not mutated');
  assert.equal(kept.aliases.COPY, 'C');
  assert.deepEqual(kept.extraAliases, { HATCH: ['BH'], COPY: ['CO', 'CP'], DIMCONTINUE: ['DCO'], PLINEEDIT: ['PE'], PLINE: ['PL'], TEXT: ['DT'] });
  const moved = applyPgpPlan(before, plan, { takeOver: true });
  // 별칭을 잃은 명령: 추가 별칭이 있으면 대표로 올라가고, 없으면 빈 칸(정식 이름은 늘 된다).
  assert.equal(moved.aliases.COPY, 'CO');
  assert.equal(moved.aliases.PLINE, 'PL');
  assert.equal(moved.aliases.FIT, '');
  assert.equal(moved.aliases.SAVE, '');
  assert.equal(moved.aliases.REDO, '');
  assert.deepEqual(moved.extraAliases, {
    HATCH: ['BH'], CIRCLE: ['C'], COPY: ['CP'], DIMCONTINUE: ['DCO'], FILLET: ['F'], PAN: ['P'], PLINEEDIT: ['PE'], REGEN: ['RE'], STRETCH: ['S'], TEXT: ['DT'],
  });
  // 모든 별칭이 여전히 하나의 명령에만 속한다.
  const owners = new Map();
  for (const name of Object.keys(FIXTURE)) for (const alias of aliasesOf(moved, name)) {
    assert.ok(!owners.has(alias), `${alias} owned by ${owners.get(alias)} and ${name}`);
    owners.set(alias, name);
  }
  // 기본 해석으로 이미 되는 별칭(CO·CP→COPY)은 unchanged 지만, COPY 가 C 를 잃어 빈 칸이 되면 그 별칭을 칸에 적는다.
  const builtin = planPgpImport(parsePgp('C, *CIRCLE\nCO, *COPY\nCP, *COPY\nS, *STRETCH').entries, {
    commands: Object.keys(FIXTURE), current: fixtureSettings(), resolve: (alias) => ({ CO: 'COPY', CP: 'COPY' })[alias] ?? null,
  });
  assert.deepEqual(builtin.unchanged.map((item) => `${item.alias}:${item.why}`), ['CO:builtin', 'CP:builtin']);
  const keptBuiltin = applyPgpPlan(fixtureSettings(), builtin);
  assert.equal(keptBuiltin.aliases.COPY, 'C');
  assert.equal(keptBuiltin.extraAliases, undefined, 'nothing written when COPY keeps its alias');
  const movedBuiltin = applyPgpPlan(fixtureSettings(), builtin, { takeOver: true });
  assert.equal(movedBuiltin.aliases.COPY, 'CO');
  assert.equal(movedBuiltin.aliases.SAVE, '', 'SAVE had no builtin alias in the file');
  assert.deepEqual(movedBuiltin.extraAliases, { COPY: ['CP'], CIRCLE: ['C'], STRETCH: ['S'] });
  // 두 명령이 서로 별칭을 바꾸는 경우도 순서대로 풀린다.
  const swap = planPgpImport(parsePgp('C, *CIRCLE\nCI, *COPY').entries, { commands: Object.keys(FIXTURE), current: fixtureSettings() });
  const swapped = applyPgpPlan(fixtureSettings(), swap, { takeOver: true });
  assert.equal(swapped.aliases.CIRCLE, 'C');
  assert.equal(swapped.aliases.COPY, 'CI');
  assert.equal(swapped.extraAliases, undefined);
});

test('the same acad.pgp against the real 바른 CAD commands: every result passes validateSettings and resolves as planned', () => {
  const base = fresh();
  const parsed = parsePgp(ACAD_PGP);
  const plan = planPgpImport(parsed.entries, { commands: NAMES, current: base, redirect: MENU_COMPAT_ALIASES });
  // 오래 고정된 사실: C 는 COPY 의 별칭(advanced.test.js), LEN 은 바른 CAD 명령 이름.
  const c = plan.conflicts.find((item) => item.alias === 'C');
  assert.deepEqual([c.command, c.reason, c.holder, c.takeable], ['CIRCLE', 'alias-taken', 'COPY', true]);
  const len = plan.conflicts.find((item) => item.alias === 'LEN');
  assert.equal(len.reason, 'command-name');
  assert.ok(plan.unmatched.some((item) => item.alias === '3A'));
  for (const item of plan.conflicts.filter((x) => x.reason === 'command-name')) assert.ok(NAMES.has(item.alias), item.alias);
  // 넣지 못한다고 한 것은 validateSettings 도 받지 않는다.
  for (const item of plan.conflicts) {
    const trial = fresh();
    trial.aliases[item.command] = item.alias;
    assert.throws(() => validateSettings(trial), undefined, `${item.alias} → ${item.command}`);
  }
  for (const takeOver of [false, true]) {
    const merged = applyPgpPlan(base, plan, { takeOver });
    const checked = validatePatched(structuredClone(merged));
    assert.deepEqual(checked, merged, 'apply result is already normalized');
    const moved = [...plan.apply, ...(takeOver ? plan.conflicts.filter((x) => x.takeable) : [])];
    assert.ok(moved.length > 0);
    for (const item of moved) assert.equal(resolvePatched(item.alias, checked), item.command, item.alias);
    for (const item of plan.unchanged) assert.equal(resolvePatched(item.alias, checked), item.command, item.alias);
    for (const name of NAMES) assert.equal(resolvePatched(name, checked), name);
  }
});

test('mirror: planPgpImport accepts an alias exactly when validateSettings would (primary) and when validateExtraAliases would (extra)', () => {
  const base = fresh();
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const candidates = new Set(['?', '3A', '-AR', '_L', 'A_1', 'Z9', 'A'.repeat(20), 'B'.repeat(21), '가', 'É']);
  for (const a of letters) { candidates.add(a); for (const b of letters) candidates.add(a + b); }
  for (const name of [...NAMES].filter((_, index) => index % 5 === 0)) candidates.add(name);
  let checked = 0;
  for (const target of ['LINE', 'COPY', 'OPEN', 'HELP']) {
    const entries = [...candidates].map((alias, line) => ({ alias, command: target, line }));
    const plan = planPgpImport(entries, { commands: NAMES, current: base });
    const verdict = new Map();
    for (const item of [...plan.apply, ...plan.unchanged]) verdict.set(item.alias, true);
    for (const item of plan.conflicts) verdict.set(item.alias, false);
    for (const alias of candidates) {
      const key = alias.trim().toUpperCase();
      assert.ok(verdict.has(key), `${key} planned`);
      const primary = fresh();
      primary.aliases[target] = alias;
      let primaryOk = true;
      try { validateSettings(primary); } catch { primaryOk = false; }
      const extra = { ...fresh(), extraAliases: { [target]: [alias] } };
      let extraOk = true;
      try { validatePatched(extra); } catch { extraOk = false; }
      assert.equal(verdict.get(key), primaryOk, `primary ${key} → ${target}`);
      assert.equal(verdict.get(key), extraOk, `extra ${key} → ${target}`);
      checked++;
    }
  }
  assert.ok(checked > 2500);
  assert.equal(ALIAS_PATTERN.source, /^[A-Z][A-Z0-9_]{0,19}$|^\?$/.source);
});

test('protected names, redirects, false friends and built-in resolution', () => {
  const current = fixtureSettings();
  const commands = [...Object.keys(FIXTURE), 'PL2', 'GRIDLINE'];
  const entries = parsePgp('GT, *LINE\nNB, *LINE\nNEWBUILD, *LINE\nX2, *PL2\nCP, *COPY\nHI, *HIDE\nCV, *CONVERT').entries;
  const plan = planPgpImport(entries, {
    commands, current, protectedNames: ['newbuild'], redirect: { PL2: 'PLINE' },
    resolve: (alias) => ({ CP: 'COPY', GT: 'GRIDLINE' })[alias] ?? null,
  });
  assert.deepEqual(plan.conflicts.map((c) => `${c.alias}:${c.reason}`), ['NEWBUILD:protected']);
  assert.deepEqual(plan.apply.map((a) => `${a.alias}>${a.command}${a.overrides ? '!' + a.overrides : ''}`), ['GT>LINE!GRIDLINE', 'NB>LINE', 'X2>PLINE']);
  assert.deepEqual(plan.unchanged.map((a) => `${a.alias}:${a.why}`), ['CP:builtin']);
  assert.deepEqual(plan.unmatched.map((a) => `${a.alias}:${a.reason}`), ['HI:different', 'CV:unknown']);
  // 바른 CAD 가 내보낸 pgp 에서는 같은 이름을 그대로 받는다.
  const own = planPgpImport(parsePgp('HD, *HIDE').entries, { commands, current, origin: 'barun' });
  assert.deepEqual(pick(own.apply), ['HD>HIDE']);
  // AutoCAD 이름표는 바른 CAD 에 같은 이름이 있으면 쓰지 않는다(바른 CAD 명령이 먼저).
  const native = planPgpImport([{ alias: 'QQ', command: 'RECTANG', line: 1 }], { commands: ['RECTANG', 'RECTANGLE'], current: { aliases: {} } });
  assert.equal(native.apply[0].command, 'RECTANG');
  assert.throws(() => planPgpImport([], {}), TypeError);
  assert.ok(Object.keys(AUTOCAD_FALSE_FRIENDS).every((name) => typeof AUTOCAD_FALSE_FRIENDS[name] === 'string'));
});

test('AUTOCAD_COMMAND_MAP only points at real 바른 CAD commands', () => {
  for (const [autocad, barun] of Object.entries(AUTOCAD_COMMAND_MAP)) {
    assert.ok(NAMES.has(barun), `${autocad} → ${barun}`);
    assert.notEqual(autocad, barun);
  }
  const s = fresh();
  const plan = planPgpImport(Object.keys(AUTOCAD_COMMAND_MAP).map((command, line) => ({ alias: 'ZZ' + line, command, line })), { commands: NAMES, current: s });
  // 바른 CAD 에 이미 같은 이름이 생긴 항목은 그 명령으로 간다. 나머지는 표대로.
  for (const item of plan.apply) assert.equal(item.command, NAMES.has(item.source) ? item.source : AUTOCAD_COMMAND_MAP[item.source]);
  assert.equal(plan.unmatched.length, 0);
});

test('serializePgp writes a Korean/English header and round-trips through parsePgp', () => {
  const map = { c: 'circle', CO: 'COPY', CP: 'COPY', '?': 'HELP', L: '*LINE', Z9: 'ZOOM' };
  const text = serializePgp(map);
  assert.ok(text.includes('\r\n') && !text.replace(/\r\n/g, '').includes('\n'), 'CRLF only');
  assert.ok(!text.startsWith('﻿'), 'no BOM');
  const lines = text.split('\r\n');
  assert.match(lines[0], /^; 바른 CAD 명령 별칭/);
  assert.ok(lines[1].includes(PGP_MARKER) && /command aliases/.test(lines[1]));
  assert.ok(lines.includes('C,        *CIRCLE'));
  const parsed = parsePgp(text);
  assert.equal(parsed.origin, 'barun');
  assert.deepEqual(parsed.errors, []);
  assert.deepEqual(parsed.skipped, []);
  assert.deepEqual(Object.fromEntries(parsed.entries.map((e) => [e.alias, e.command])), { '?': 'HELP', C: 'CIRCLE', CO: 'COPY', CP: 'COPY', L: 'LINE', Z9: 'ZOOM' });
  assert.deepEqual(parsed.entries.map((e) => e.alias), ['?', 'C', 'CO', 'CP', 'L', 'Z9'], 'sorted by alias');
  // 같은 결과를 다시 쓰면 글자까지 같다.
  assert.equal(serializePgp(Object.fromEntries(parsed.entries.map((e) => [e.alias, e.command]))), text);
  // Map · 배열도 받는다. 머리말 없이 / 머리말 추가.
  assert.equal(serializePgp(new Map([['L', 'LINE']]), { header: false }), 'L,        *LINE\r\n');
  assert.equal(serializePgp([{ alias: 'L', command: 'LINE' }], { header: false }), serializePgp([['L', 'LINE']], { header: false }));
  const custom = serializePgp({ L: 'LINE' }, { header: '사무실 표준\n; already comment' });
  assert.ok(custom.includes('\r\n; 사무실 표준\r\n; already comment\r\n'));
  assert.equal(parsePgp(custom).entries.length, 1);
  assert.equal(parsePgp(serializePgp({}, { header: true })).entries.length, 0);
  assert.equal(parsePgp(serializePgp({ L: 'LINE' }, { header: false })).origin, 'autocad');
  // 쉼표·세미콜론·공백·*가 든 값, 한 별칭에 두 명령은 쓰지 않는다.
  for (const bad of [{ 'A,B': 'LINE' }, { A: 'LI NE' }, { 'A;': 'LINE' }, { '*A': 'LINE' }, { '': 'LINE' }, { A: '' }])
    assert.throws(() => serializePgp(bad), /acad\.pgp/);
  assert.throws(() => serializePgp([['A', 'LINE'], ['a', 'COPY']]), /겹칩니다/);
});

test('exporting real settings (with extra aliases) to acad.pgp and importing it back changes nothing', () => {
  const settings = validatePatched({ ...fresh(), extraAliases: { COPY: ['CP', 'DUP'], LINE: ['LNX'] } });
  const map = aliasMapFromSettings(settings, NAMES);
  assert.equal(map.CP, 'COPY');
  assert.equal(map.LNX, 'LINE');
  assert.ok(!Object.hasOwn(map, 'PLOT'), 'self aliases (PLOT=PLOT) are not written');
  const text = serializePgp(map);
  const parsed = parsePgp(text);
  assert.deepEqual(parsed.errors, []);
  assert.equal(parsed.entries.length, Object.keys(map).length);
  const plan = planPgpImport(parsed.entries, { commands: NAMES, current: settings, origin: parsed.origin, redirect: MENU_COMPAT_ALIASES });
  assert.deepEqual([plan.apply.length, plan.conflicts.length, plan.unmatched.length], [0, 0, 0]);
  assert.equal(plan.unchanged.length, parsed.entries.length);
  assert.deepEqual(applyPgpPlan(settings, plan, { takeOver: true }), settings);
  // 기본 설정인 다른 PC 에 가져가도(겹치면 옮김) 모든 별칭이 같은 명령을 부른다.
  const custom = validatePatched({ ...fresh(), aliases: { ...fresh().aliases, COPY: 'CO', CIRCLE: 'C' }, extraAliases: { COPY: ['CP'] } });
  const exported = aliasMapFromSettings(custom, NAMES);
  const other = fresh();
  const again = parsePgp(serializePgp(exported));
  const moved = applyPgpPlan(other, planPgpImport(again.entries, { commands: NAMES, current: other, origin: again.origin }), { takeOver: true });
  const loaded = validatePatched(structuredClone(moved));
  for (const [alias, command] of Object.entries(exported)) assert.equal(resolvePatched(alias, loaded), command, alias);
});

test('old settings load unchanged; new settings with extra aliases save, load and stay readable by older builds', () => {
  // 5.0.6 이하가 저장한 모양(대표 별칭 하나씩 + 단축키). 사용자가 COPY 를 CP 로 바꿔 둔 상태.
  const old = fresh();
  old.aliases.COPY = 'CP';
  old.hotkeys.COPY = 'CTRL+SHIFT+C';
  const stored = JSON.stringify(validateSettings(old));
  const migrated = migrateAliasSettings(JSON.parse(stored));
  assert.deepEqual(migrated, JSON.parse(stored), 'migration leaves old settings identical');
  assert.ok(!Object.hasOwn(migrated, 'extraAliases'));
  // 새 경로(이전 → 검사)로 읽어도 지금 경로(검사)와 글자 하나 다르지 않다.
  assert.equal(JSON.stringify(validatePatched(migrateAliasSettings(JSON.parse(stored)))), JSON.stringify(validateSettings(JSON.parse(stored))));
  assert.deepEqual(repairPatched(JSON.parse(stored)), { settings: validateSettings(JSON.parse(stored)), dropped: [] });
  assert.equal(resolvePatched('CP', validatePatched(JSON.parse(stored))), 'COPY');
  // 새 모양: 저장 → 다시 읽기.
  const next = validatePatched({ ...JSON.parse(stored), extraAliases: { COPY: ['cpx', ' DUP '], CIRCLE: 'CR2 CR3' } });
  assert.deepEqual(next.extraAliases, { COPY: ['CPX', 'DUP'], CIRCLE: ['CR2', 'CR3'] });
  const reloaded = validatePatched(migrateAliasSettings(JSON.parse(JSON.stringify(next))));
  assert.deepEqual(reloaded, next);
  for (const [alias, command] of [['CP', 'COPY'], ['CPX', 'COPY'], ['dup', 'COPY'], ['CR3', 'CIRCLE'], ['CI', 'CIRCLE']])
    assert.equal(resolvePatched(alias, reloaded), command, alias);
  // 이전 판(추가 별칭을 모르는 validateSettings)도 새 설정을 거부하지 않고 대표 별칭을 그대로 쓴다.
  // commands.js 에 통합한 뒤에는 validateSettings·resolveCommand 가 곧 새 판이므로 추가 별칭도 풀린다.
  const integrated = (() => { try { validateSettings({ ...fresh(), extraAliases: { LINE: ['CI'] } }); return false; } catch { return true; } })();
  const olderBuild = validateSettings(JSON.parse(JSON.stringify(next)));
  assert.equal(olderBuild.aliases.COPY, 'CP');
  assert.equal(resolveCommand('CP', olderBuild), 'COPY');
  assert.equal(resolveCommand('CPX', olderBuild), integrated ? 'COPY' : null, integrated ? 'integrated build resolves extras' : 'older build simply ignores extras');
});

test('migrateAliasSettings splits hand-written comma lists; validateExtraAliases normalizes and rejects like validateSettings', () => {
  const hand = { version: 1, aliases: { ...defaultAliases(), COPY: 'C, CP;cpx', LINE: ' L ' }, hotkeys: {}, extraAliases: { COPY: ['DUP'], CIRCLE: 'CR2,CR3' } };
  const before = structuredClone(hand);
  const migrated = migrateAliasSettings(hand);
  assert.deepEqual(hand, before, 'input untouched');
  assert.equal(migrated.aliases.COPY, 'C');
  assert.equal(migrated.aliases.LINE, ' L ', 'single alias left for validateSettings to trim');
  assert.deepEqual(migrated.extraAliases, { COPY: ['CP', 'CPX', 'DUP'], CIRCLE: ['CR2', 'CR3'] });
  assert.deepEqual(validatePatched(migrated).extraAliases, { COPY: ['CP', 'CPX', 'DUP'], CIRCLE: ['CR2', 'CR3'] });
  assert.equal(migrateAliasSettings(null), null);
  assert.equal(migrateAliasSettings('x'), 'x');
  // 조용히 정리하는 것: 없어진 명령, 자기 이름, 이미 자기 대표 별칭, 중복, 빈 값. 모두 비면 칸을 지운다.
  const tidy = validatePatched({ ...fresh(), extraAliases: { NO_SUCH_COMMAND: ['QZ1'], COPY: ['COPY', 'C', 'c', '', 'CP', 'cp'], LINE: [] } });
  assert.deepEqual(tidy.extraAliases, { COPY: ['CP'] });
  assert.equal(validatePatched({ ...fresh(), extraAliases: { LINE: [] } }).extraAliases, undefined);
  assert.equal(validatePatched({ ...fresh(), extraAliases: null }).extraAliases, undefined);
  // 던지는 것: validateSettings 와 같은 문구.
  const clash = (() => { try { validatePatched({ ...fresh(), extraAliases: { LINE: ['CI'] } }); } catch (error) { return error; } })();
  assert.equal(clash.message, 'CI: CIRCLE와 LINE의 별칭이 겹칩니다.');
  assert.deepEqual(clash.conflict, { kind: 'alias', value: 'CI', holder: 'CIRCLE', wanted: 'LINE' });
  const twice = (() => { try { validatePatched({ ...fresh(), extraAliases: { LINE: ['QZ1'], COPY: ['QZ1'] } }); } catch (error) { return error; } })();
  assert.deepEqual(twice.conflict, { kind: 'alias', value: 'QZ1', holder: 'LINE', wanted: 'COPY' });
  assert.throws(() => validatePatched({ ...fresh(), extraAliases: { LINE: ['LEN'] } }), /LEN는 다른 정식 명령 이름입니다/);
  assert.throws(() => validatePatched({ ...fresh(), extraAliases: { LINE: ['3A'] } }), /LINE: 별칭은 영문으로 시작하는 1~20자입니다/);
  assert.throws(() => validatePatched({ ...fresh(), extraAliases: { LINE: [1] } }), /별칭은 문자열이어야 합니다/);
  assert.throws(() => validatePatched({ ...fresh(), extraAliases: ['LINE'] }), /설정 파일 형식/);
  assert.throws(() => validatePatched({ ...fresh(), extraAliases: 'LINE' }), /설정 파일 형식/);
});

test('repairSettings with extraAliases keeps everything usable and drops only the broken extra', () => {
  const raw = JSON.parse(JSON.stringify({ ...fresh(), extraAliases: { COPY: ['CP'], LINE: ['CI'], CIRCLE: ['CR2'] } }));
  raw.hotkeys.COPY = 'Ctrl+Shift+C';
  const { settings, dropped } = repairPatched(raw);
  assert.deepEqual(dropped, ['LINE=CI']);
  assert.deepEqual(settings.extraAliases, { COPY: ['CP'], CIRCLE: ['CR2'] });
  assert.equal(settings.hotkeys.COPY, 'CTRL+SHIFT+C');
  assert.equal(settings.aliases.CIRCLE, 'CI');
});

test('settings dialog helpers: field text ↔ draft is lossless, tokens and clash-button helpers', () => {
  const saved = validatePatched({ ...fresh(), extraAliases: { COPY: ['CP', 'DUP'], OPEN: ['OPN'] } });
  assert.equal(aliasFieldText(saved, 'COPY'), 'C, CP, DUP');
  // OPEN 은 대표 별칭이 빈 명령: 추가 별칭만 주면 그 첫 것이 대표가 된다.
  assert.equal(saved.aliases.OPEN, 'OPN');
  assert.deepEqual(saved.extraAliases, { COPY: ['CP', 'DUP'] });
  assert.equal(aliasFieldText(saved, 'OPEN'), 'OPN');
  assert.equal(aliasFieldText({ aliases: defaultAliases(), hotkeys: {} }, 'COPY'), 'C', 'profiles/default rows have no extras');
  assert.equal(aliasFieldText(saved, 'NO_SUCH'), '');
  // 설정 창을 열고 아무것도 고치지 않고 저장하면(보이는 명령 칸만) 같은 설정이 된다.
  const draft = { version: 1, aliases: {}, hotkeys: {} };
  for (const name of VISIBLE) putAliasField(draft, name, aliasFieldText(saved, name));
  Object.assign(draft.hotkeys, saved.hotkeys);
  const resaved = validatePatched(draft);
  assert.deepEqual(resaved.aliases, saved.aliases);
  assert.deepEqual(resaved, saved);
  // 칸 하나 고치기.
  putAliasField(draft, 'COPY', 'co  cp');
  assert.equal(draft.aliases.COPY, 'CO');
  assert.deepEqual(draft.extraAliases.COPY, ['CP']);
  putAliasField(draft, 'COPY', '');
  assert.equal(draft.aliases.COPY, '');
  assert.ok(!Object.hasOwn(draft.extraAliases, 'COPY'));
  // 예전처럼 한 칸에 공백 섞인 값은 여전히 저장되지 않는다(이제는 두 별칭으로 보고 겹침으로 막힌다).
  const spaced = structuredClone(fresh());
  const spacedDraft = putAliasField({ ...spaced, extraAliases: undefined }, 'COPY', 'C P');
  assert.throws(() => validatePatched(spacedDraft), /P: PLINE와 COPY의 별칭이 겹칩니다/);
  assert.deepEqual(splitAliasText(' c, cp ;; CP  dup\t'), ['C', 'CP', 'DUP']);
  assert.deepEqual(fieldTokens('alias', 'c, cp'), ['C', 'CP']);
  assert.deepEqual(fieldTokens('hotkey', ' Ctrl+, '), ['CTRL+,'], 'comma inside a hotkey is not a separator');
  assert.deepEqual(fieldTokens('hotkey', ''), []);
  assert.equal(withoutAliasToken('C, CP, DUP', 'cp'), 'C, DUP');
  assert.equal(hasExtraAlias(saved, 'COPY', 'CP'), true);
  assert.equal(hasExtraAlias(saved, 'COPY', ''), false);
  assert.equal(hasExtraAlias({ extraAliases: { COPY: 'CP, DUP' } }, 'COPY', 'C'), false, 'unvalidated string is ignored, never substring-matched');
});

test('pgpImportSummary names what happened in one Korean line', () => {
  const parsed = parsePgp(ACAD_PGP);
  const plan = planPgpImport(parsed.entries, { commands: Object.keys(FIXTURE), current: fixtureSettings() });
  const kept = pgpImportSummary(parsed, plan);
  assert.match(kept, /^acad\.pgp: 새로 넣음 7개 · 이미 같음 13개 · 다른 명령이 쓰던 별칭 5개 그대로 둠\(C: COPY→CIRCLE/);
  assert.match(kept, /바른 CAD 에 없는 명령 4개/);
  assert.match(kept, /넣지 못함 3개\(-AR, ED, LEN\)/);
  assert.match(kept, /외부 프로그램 줄 3개 건너뜀/);
  assert.match(kept, /같은 별칭 1줄은 뒤의 줄 사용/);
  assert.match(kept, /읽지 못한 줄 2개\(45번째, 46번째\)/);
  assert.match(pgpImportSummary(parsed, plan, { takeOver: true }), /새로 넣음 12개 .*5개 옮김/);
});

// 리드가 commands.js 에 C1~C3 을 붙인 뒤에만 돈다(그 전에는 건너뛴다). 통합이 제대로 됐는지 바로 알 수 있다.
test('after integration: commands.js validateSettings and resolveCommand handle extraAliases themselves', (t) => {
  const integrated = (() => { try { validateSettings({ ...fresh(), extraAliases: { LINE: ['CI'] } }); return false; } catch { return true; } })();
  if (!integrated) return t.skip('commands.js 통합 전');
  const saved = validateSettings({ ...fresh(), extraAliases: { COPY: ['cpx'], OPEN: ['OPN'] } });
  assert.deepEqual(saved.extraAliases, { COPY: ['CPX'] });
  assert.equal(saved.aliases.OPEN, 'OPN');
  assert.equal(resolveCommand('cpx', saved), 'COPY');
  assert.equal(resolveCommand('C', saved), 'COPY');
  assert.equal(validateSettings(fresh()).extraAliases, undefined, 'old settings get no new key');
  const clash = (() => { try { validateSettings({ ...fresh(), extraAliases: { LINE: ['CI'] } }); } catch (error) { return error; } })();
  assert.deepEqual(clash.conflict, { kind: 'alias', value: 'CI', holder: 'CIRCLE', wanted: 'LINE' });
});
