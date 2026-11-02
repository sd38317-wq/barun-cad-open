// layer-tools-4.js 시험. node --test 로 돈다. DOM 없이 export 된 순수 함수 + 모의 ctx 로 명령 함수를 부른다(규칙서 8절).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveLayerNamesToIds, layerChangeSet, planLayerMerge,
  LP_AUTO_PALETTE, assignDistinctColors, computeLayerStateChanges, computeByLayerEntityChanges,
  renameAdd, renameStrip, renamePartial, renameSerial, renameSpecialChars, parseLrnValue,
  wildcardToRegExp, parseRenamePairs, applyRenameList,
  installLayerTools4,
} from './layer-tools-4.js';

function makeCtx(overrides = {}) {
  const toasts = [];
  return {
    toasts,
    storage: { getItem: () => null, setItem: () => {} },
    entities: () => [],
    layers: () => [],
    ensureLayer: (name) => name,
    selected: () => [],
    selectedIds: () => [],
    setSelected: () => {},
    execute: () => [],
    pickEntity: async () => null,
    pickPoint: async () => null,
    form: () => {},
    activeLayer: () => null,
    toast: (msg, isError) => toasts.push({ msg, isError }),
    log: () => {},
    refresh: () => {},
    userErrorMessage: (e) => e.message,
    num: (key, def) => def,
    ...overrides,
  };
}

const LAYERS = [
  { id: 'L0', name: '0', color: '#ffffff', visible: true, locked: false, frozen: false, linetype: 'CONTINUOUS' },
  { id: 'L1', name: 'A-WALL', color: '#ffd479', visible: true, locked: true, frozen: false, linetype: 'CONTINUOUS' },
  { id: 'L2', name: 'A-DOOR', color: '#ff0000', visible: false, locked: false, frozen: true, linetype: 'CENTER' },
  { id: 'L3', name: 'A-GLAZ', color: '#00ff00', visible: true, locked: true, frozen: true, linetype: 'CONTINUOUS' },
];

/* ── resolveLayerNamesToIds ── */
test('resolveLayerNamesToIds: 콤마/줄바꿈, 대소문자 무시, 못 찾은 이름은 건너뜀, 중복 제거', () => {
  assert.deepEqual(resolveLayerNamesToIds(LAYERS, 'a-wall, a-door\nNOPE, a-wall'), ['L1', 'L2']);
  assert.deepEqual(resolveLayerNamesToIds(LAYERS, ''), []);
});

/* ── layerChangeSet(LC/LCO) ── */
test('layerChangeSet: LC는 색·선종류까지 초기화, LCO는 켜만 바꾼다', () => {
  assert.deepEqual(layerChangeSet('L1', true), { layer: 'L1', color: null, linetype: null });
  assert.deepEqual(layerChangeSet('L1', false), { layer: 'L1' });
});

/* ── planLayerMerge(LAM) ── */
test('planLayerMerge: 소스 없음/대상이 소스에 포함/대상 없음/0번 켜는 에러', () => {
  assert.throws(() => planLayerMerge(LAYERS, [], [], 'L1'), /합쳐질 켜/);
  assert.throws(() => planLayerMerge(LAYERS, [], ['L1'], 'L1'), /대상 켜는/);
  assert.throws(() => planLayerMerge(LAYERS, [], ['L1'], 'NOPE'), /대상 켜를 확인/);
  assert.throws(() => planLayerMerge(LAYERS, [], ['L0'], 'L1'), /"0" 켜는/);
});

test('planLayerMerge: 기본(퍼지 켜짐, 유지 옵션 없음) → 강제색/선종류 리셋 + layer.merge', () => {
  const entities = [{ id: 'e1', layer: 'L2', color: '#ff0000' }, { id: 'e2', layer: 'L3', linetype: 'DASHED' }, { id: 'e3', layer: 'L1' }];
  const { commands, targetName, count } = planLayerMerge(LAYERS, entities, ['L2', 'L3'], 'L1');
  assert.equal(targetName, 'A-WALL');
  assert.equal(count, 2);
  assert.equal(commands.length, 2);
  assert.deepEqual(commands[0], { type: 'update', ids: ['e1', 'e2'], changes: { color: null, linetype: null } });
  assert.deepEqual(commands[1], { type: 'layer.merge', sources: ['L2', 'L3'], target: 'L1' });
});

test('planLayerMerge: 강제색·선종류 유지 + 퍼지 끄면 update(layer)만, 원본 켜는 지우지 않음', () => {
  const entities = [{ id: 'e1', layer: 'L2', color: '#ff0000' }];
  const { commands } = planLayerMerge(LAYERS, entities, ['L2'], 'L1', { keepColor: true, keepLinetype: true, purge: false });
  assert.deepEqual(commands, [{ type: 'update', ids: ['e1'], changes: { layer: 'L1' } }]);
});

/* ── LP 보조 함수 ── */
test('assignDistinctColors: 시작번호부터 팔레트를 순환 배정', () => {
  const map = assignDistinctColors(['a', 'b', 'c'], 0);
  assert.equal(map.get('a'), LP_AUTO_PALETTE[0]);
  assert.equal(map.get('b'), LP_AUTO_PALETTE[1]);
  assert.equal(map.get('c'), LP_AUTO_PALETTE[2]);
  const map2 = assignDistinctColors(['a', 'b'], LP_AUTO_PALETTE.length - 1);
  assert.equal(map2.get('a'), LP_AUTO_PALETTE[LP_AUTO_PALETTE.length - 1]);
  assert.equal(map2.get('b'), LP_AUTO_PALETTE[0]);
});

test('computeLayerStateChanges: off/frozen/locked/noplot을 절대값으로 적용, 색·선종류는 있을 때만', () => {
  const rows = computeLayerStateChanges(['L1', 'L2'], { off: true, frozen: false, locked: true, noplot: true, color: '#123456' });
  assert.deepEqual(rows[0].changes, { visible: false, frozen: false, locked: true, plot: false, color: '#123456' });
  assert.deepEqual(rows[1].changes, { visible: false, frozen: false, locked: true, plot: false, color: '#123456' });
});

test('computeByLayerEntityChanges: toByLayer는 강제 속성을 지우고, fromByLayer는 ByLayer인 것만 켜 값으로 강제한다', () => {
  const entities = [
    { id: 'e1', layer: 'L1', color: '#111111' },
    { id: 'e2', layer: 'L1' },
    { id: 'e3', layer: 'L2', color: '#222222' },
  ];
  const byId = new Map(LAYERS.map((l) => [l.id, l]));
  const to = computeByLayerEntityChanges(entities, ['L1'], byId, { mode: 'toByLayer', color: true, linetype: true });
  assert.deepEqual(to, [{ id: 'e1', changes: { color: null } }]);
  const from = computeByLayerEntityChanges(entities, ['L1'], byId, { mode: 'fromByLayer', color: true });
  assert.deepEqual(from, [{ id: 'e2', changes: { color: '#ffd479' } }]);
});

/* ── LRN 순수 함수 ── */
test('renameAdd/renameStrip/renamePartial/renameSerial/renameSpecialChars', () => {
  assert.equal(renameAdd('WALL', 'A-', ''), 'A-WALL');
  assert.equal(renameStrip('A-WALL', 'A-', ''), 'WALL');
  assert.equal(renameStrip('WALL-X', '', '-X'), 'WALL');
  assert.equal(renamePartial('ST_WALL', 'ST_', 'A-'), 'A-WALL');
  assert.equal(renameSerial('실', 1, 0), '실1');
  assert.equal(renameSerial('실', 1, 2), '실3');
  assert.equal(renameSpecialChars('A B!C@D#E^F'), 'A_B_C_D_E_F');
});

test('parseLrnValue: "값1,값2" 분리, 빈 문자열 안전', () => {
  assert.deepEqual(parseLrnValue('A-,-2'), { a: 'A-', b: '-2' });
  assert.deepEqual(parseLrnValue(''), { a: '', b: '' });
  assert.deepEqual(parseLrnValue('실'), { a: '실', b: '' });
});

/* ── LRL 순수 함수 ── */
test('wildcardToRegExp: * ? # 지원, 대소문자 무시, 콤마 OR', () => {
  assert.ok(wildcardToRegExp('FINI*').test('FINISH'));
  assert.ok(wildcardToRegExp('fini*').test('FINISH'));
  assert.ok(wildcardToRegExp('CEN*').test('CENTER'));
  assert.ok(!wildcardToRegExp('CEN*').test('XCENTER'));
  assert.ok(wildcardToRegExp('L#').test('L1'));
  assert.ok(!wildcardToRegExp('L#').test('L12'));
  assert.ok(wildcardToRegExp('A?C').test('ABC'));
  assert.ok(wildcardToRegExp('A-WALL,A-DOOR').test('A-DOOR'));
});

test('parseRenamePairs: "->"·":"·탭 구분자, 잘못된 줄 무시', () => {
  assert.deepEqual(parseRenamePairs('FINI* -> AA-FINISH\nCEN*:CRR\nnotapair\n\tX\tY'), [
    { find: 'FINI*', replace: 'AA-FINISH' },
    { find: 'CEN*', replace: 'CRR' },
    { find: 'X', replace: 'Y' },
  ]);
});

test('applyRenameList: 첫 매칭 쌍만 적용, 0/Defpoints는 대상 제외', () => {
  const map = applyRenameList(['0', 'Defpoints', 'FINISH', 'CENTER', 'ETC'], [
    { find: 'FINI*', replace: 'AA-FINISH' },
    { find: 'CEN*', replace: 'CRR' },
  ]);
  assert.deepEqual([...map.entries()], [['FINISH', 'AA-FINISH'], ['CENTER', 'CRR']]);
});

/* ── installLayerTools4: 명령 10개 존재 ── */
const TARGET_COMMANDS = ['LLL', 'LO', 'LOO', 'LU', 'LAM', 'LC', 'LCO', 'LP', 'LRN', 'LRL'];
test('installLayerTools4: 맡은 10개 명령 이름이 모두 키로 존재', () => {
  const cmds = installLayerTools4(makeCtx());
  for (const name of TARGET_COMMANDS) assert.ok(typeof cmds[name] === 'function', `${name} 이 없습니다`);
  assert.equal(Object.keys(cmds).length, TARGET_COMMANDS.length);
});

/* ── LLL/LO/LOO/LU: 화면선택 vs 전체, 얼림/켜짐/잠금을 서로 건드리지 않는다 ── */
test('LLL: 선택 없이 부르면 에러, 선택 있으면 그 객체의 켜만 얼린다', () => {
  const ctx1 = makeCtx();
  assert.throws(() => installLayerTools4(ctx1).LLL(), /선택/);
  const calls = [];
  const ctx2 = makeCtx({ layers: () => LAYERS, selected: () => [{ id: 'e1', layer: 'L1' }], execute: (c) => { calls.push(c); return []; } });
  installLayerTools4(ctx2).LLL();
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].commands, [{ type: 'layer.update', id: 'L1', changes: { frozen: true } }]);
});

test('LO: 꺼진 켜만 켠다(얼림은 그대로)', () => {
  const calls = [];
  const ctx = makeCtx({ layers: () => LAYERS, execute: (c) => { calls.push(c); return []; } });
  installLayerTools4(ctx).LO();
  assert.deepEqual(calls[0].commands, [{ type: 'layer.update', id: 'L2', changes: { visible: true } }]);
});

test('LO: 꺼진 켜가 없으면 실행 없이 안내만', () => {
  const ctx = makeCtx({ layers: () => LAYERS.map((l) => ({ ...l, visible: true })) });
  installLayerTools4(ctx).LO();
  assert.equal(ctx.toasts.length, 1);
});

test('LOO: 얼린 켜만 녹인다(켜짐/꺼짐은 그대로)', () => {
  const calls = [];
  const ctx = makeCtx({ layers: () => LAYERS, execute: (c) => { calls.push(c); return []; } });
  installLayerTools4(ctx).LOO();
  const byId = Object.fromEntries(calls[0].commands.map((c) => [c.id, c.changes.frozen]));
  assert.deepEqual(byId, { L2: false, L3: false });
});

test('LU: 선택 없이 부르면 에러, 선택된 객체의 켜 중 잠긴 것만 푼다', () => {
  const ctx1 = makeCtx();
  assert.throws(() => installLayerTools4(ctx1).LU(), /선택/);
  const calls = [];
  const ctx2 = makeCtx({
    layers: () => LAYERS,
    selected: () => [{ id: 'e1', layer: 'L1' }, { id: 'e2', layer: 'L2' }],
    execute: (c) => { calls.push(c); return []; },
  });
  installLayerTools4(ctx2).LU();
  assert.deepEqual(calls[0].commands, [{ type: 'layer.update', id: 'L1', changes: { locked: false } }]);
});

test('LU: 선택 객체의 켜가 모두 안 잠겨 있으면 실행 없이 안내만', () => {
  const ctx = makeCtx({ layers: () => LAYERS, selected: () => [{ id: 'e1', layer: 'L2' }] });
  installLayerTools4(ctx).LU();
  assert.equal(ctx.toasts.length, 1);
});

/* ── LAM: 폼을 직접 호출해 결과 확인 ── */
test('LAM: 이름 목록으로 소스를 찾아 planLayerMerge 결과를 execute 한다', () => {
  const calls = [];
  const ctx = makeCtx({
    layers: () => LAYERS,
    entities: () => [{ id: 'e1', layer: 'L2', color: '#ff0000' }],
    execute: (c) => { calls.push(c); return []; },
    form: (title, fields, onApply) => onApply({ sources: 'A-DOOR', target: 'L1', keepColor: '', keepLinetype: '', purge: 'on' }),
  });
  installLayerTools4(ctx).LAM();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].type, 'batch');
  assert.equal(calls[0].commands.length, 2);
  assert.equal(ctx.toasts.length, 1);
});

/* ── LC/LCO: 화면선택 루프. Esc 로 끝난다 ── */
test('LC: 참조 객체 선택 후 대상 객체 반복 선택, 색·선종류까지 초기화', () => {
  const calls = [];
  let refPicked = false;
  const ctx = makeCtx({
    layers: () => LAYERS,
    pickEntity: async () => {
      if (!refPicked) { refPicked = true; return { id: 'ref', layer: 'L1' }; }
      if (calls.filter((c) => c.type === 'update').length === 0) return { id: 't1' };
      return null;
    },
    execute: (c) => { calls.push(c); return []; },
  });
  return installLayerTools4(ctx).LC().then(() => {
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0], { type: 'update', ids: ['t1'], changes: { layer: 'L1', color: null, linetype: null } });
    assert.equal(ctx.toasts.length, 1);
  });
});

test('LCO: 켜만 바꾸고 색·선종류는 그대로', () => {
  const calls = [];
  let step = 0;
  const ctx = makeCtx({
    layers: () => LAYERS,
    pickEntity: async () => {
      step++;
      if (step === 1) return { id: 'ref', layer: 'L3' };
      if (step === 2) return { id: 't1' };
      return null;
    },
    execute: (c) => { calls.push(c); return []; },
  });
  return installLayerTools4(ctx).LCO().then(() => {
    assert.deepEqual(calls[0], { type: 'update', ids: ['t1'], changes: { layer: 'L3' } });
  });
});

test('LC: Esc로 참조를 안 고르면 목록 폼을 띄운다', () => {
  let formShown = false;
  const ctx = makeCtx({
    layers: () => LAYERS,
    pickEntity: async () => null,
    form: (title, fields, onApply) => { formShown = true; assert.match(title, /목록/); },
  });
  return installLayerTools4(ctx).LC().then(() => { assert.equal(formShown, true); });
});

/* ── LP: 폼을 직접 호출 ── */
test('LP: 목록켜 이름 + 켜 특성 적용으로 layer.update batch 를 만든다', () => {
  const calls = [];
  const ctx = makeCtx({
    layers: () => LAYERS,
    entities: () => [],
    execute: (c) => { calls.push(c); return []; },
    form: (title, fields, onApply) => onApply({
      scope: 'list', listNames: 'A-DOOR,A-GLAZ', applyProps: 'on', off: 'on', frozen: '', locked: '', noplot: '',
      color: '', linetype: '', mode: 'toByLayer', fixColor: '', fixLinetype: '', autoColorStart: '', mergeTarget: '', mergePurge: 'on',
    }),
  });
  installLayerTools4(ctx).LP();
  assert.equal(calls.length, 1);
  const ids = calls[0].commands.map((c) => c.id).sort();
  assert.deepEqual(ids, ['L2', 'L3']);
  for (const c of calls[0].commands) assert.equal(c.changes.visible, false);
});

test('LP: 적용할 켜가 없으면 에러', () => {
  const ctx = makeCtx({
    layers: () => LAYERS,
    form: (title, fields, onApply) => assert.throws(() => onApply({ scope: 'list', listNames: '', applyProps: 'on' }), /적용할 켜/),
  });
  installLayerTools4(ctx).LP();
});

/* ── LRN/LRL: 폼을 직접 호출 ── */
test('LRN: 추가 기능으로 목록켜 이름 앞에 접두사를 붙인다', () => {
  const calls = [];
  const ctx = makeCtx({
    layers: () => LAYERS,
    execute: (c) => { calls.push(c); return []; },
    form: (title, fields, onApply) => onApply({ scope: 'list', listNames: 'A-WALL', func: 'add', value: 'X-,' }),
  });
  installLayerTools4(ctx).LRN();
  assert.deepEqual(calls[0].commands, [{ type: 'layer.update', id: 'L1', changes: { name: 'X-A-WALL' } }]);
});

test('LRN: 0번 켜는 모든켜에서도 빠진다', () => {
  const layersWithSpace = [...LAYERS, { id: 'L4', name: 'A DOOR!', color: '#000000', visible: true, locked: false, frozen: false, linetype: 'CONTINUOUS' }];
  const calls = [];
  const ctx = makeCtx({
    layers: () => layersWithSpace,
    execute: (c) => { calls.push(c); return []; },
    form: (title, fields, onApply) => onApply({ scope: 'all', listNames: '', func: 'special', value: '' }),
  });
  installLayerTools4(ctx).LRN();
  assert.ok(!calls[0].commands.some((c) => c.id === 'L0'));
  assert.deepEqual(calls[0].commands, [{ type: 'layer.update', id: 'L4', changes: { name: 'A_DOOR_' } }]);
});

test('LRL: 찾을이름->바꿀이름 목록으로 일괄 변경', () => {
  const calls = [];
  const ctx = makeCtx({
    layers: () => LAYERS,
    execute: (c) => { calls.push(c); return []; },
    form: (title, fields, onApply) => onApply({ pairs: 'A-* -> STD-A' }),
  });
  installLayerTools4(ctx).LRL();
  assert.equal(calls.length, 1);
  const names = calls[0].commands.map((c) => c.changes.name);
  assert.ok(names.every((n) => n === 'STD-A'));
});
