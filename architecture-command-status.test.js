// 건축 설계도구(보조명령) "완료" 집계 검증(2026-09-24, 5.0.4 검토 P11).
// 카드 모듈을 app.js 와 같은 순서로 설치하고, 본체 명령에 연결된 보조명령을 모두 실제로 실행해
// "폼·선택·도면 변경 없이 '제공하지 않습니다/할 일이 없습니다' 안내만 하는" 명령을 찾는다.
// 그 결과가 architecture-command-pack.js 의 GUIDANCE_ONLY_ALIASES 와 같아야 한다 — 명령을 구현하면 목록에서 빼야 통과한다.
import test from 'node:test';
import assert from 'node:assert/strict';
import {DrawingEngine} from './engine.js';
import {architectureReferenceCommands,GUIDANCE_ONLY_ALIASES,architectureCommandSummary} from './architecture-command-pack.js';
import {COMMANDS} from './commands.js';

/* 최소 DOM: 어떤 속성·메서드를 불러도 멈추지 않는 요소. 대화상자(card-kit)가 열리면 "상호작용"으로 기록한다. */
const interactions = [], runs = [];
function makeElement(tag) {
  const el = {
    tagName: String(tag).toUpperCase(), children: [], style: {}, dataset: {}, classList: {add() {}, remove() {}, toggle() {}, contains: () => false},
    append(...n) { el.children.push(...n); }, appendChild(n) { el.children.push(n); return n; }, prepend() {}, remove() {}, replaceChildren() {}, after() {},
    setAttribute() {}, getAttribute: () => null, removeAttribute() {}, addEventListener() {}, removeEventListener() {},
    querySelector: () => null, querySelectorAll: () => [], focus() {}, click() { interactions.push('click:' + el.tagName); },
    showModal() { interactions.push('dialog'); }, close() {}, getBoundingClientRect: () => ({left: 0, top: 0, width: 100, height: 100}),
  };
  return el;
}
const fakeDocument = {createElement: makeElement, body: makeElement('body'), documentElement: Object.assign(makeElement('html'), {dataset: {}}), querySelector: () => null, querySelectorAll: () => [], getElementById: () => null};
globalThis.document = fakeDocument;
globalThis.window = globalThis;
const store = new Map();
globalThis.localStorage = {getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k), key: (i) => [...store.keys()][i] ?? null, get length() { return store.size; }};

const MODULES = [
  ['door-card.js', 'installDoorCards'], ['window-card.js', 'installWindowCards'], ['opening-card.js', 'installOpeningCard'], ['stair-card.js', 'installStairCards'], ['parking-card.js', 'installParkingCard'], ['wall-fillet-card.js', 'installWallFilletCards'],
  ['layer-tools.js', 'installLayerTools'], ['area-tools.js', 'installAreaTools'], ['shape-tools.js', 'installShapeTools'], ['multi-tools.js', 'installMultiTools'], ['curtainwall-card.js', 'installCurtainWallCard'], ['handrail-card.js', 'installHandrailCard'], ['column-card.js', 'installColumnCard'], ['insulation-card.js', 'installInsulationCard'],
  ['block-xref-tools.js', 'installBlockXrefTools'], ['symbol-tools.js', 'installSymbolTools'], ['dim-hatch-tools.js', 'installDimHatchTools'], ['output-tools.js', 'installOutputTools'], ['escalator-card.js', 'installEscalatorCards'], ['structure-card.js', 'installStructureCards'], ['site-draw-card.js', 'installSiteDrawCards'], ['unfold-card.js', 'installUnfoldCards'], ['graphic-card.js', 'installGraphicCards'],
  ['hatch-table-tools.js', 'installHatchTableTools'], ['dim-symbol-tools.js', 'installDimSymbolTools'], ['block-edit-tools.js', 'installBlockEditTools'], ['text-edit-tools.js', 'installTextEditTools'], ['sheet-plot-tools.js', 'installSheetPlotTools'], ['edit-calc-tools.js', 'installEditCalcTools'], ['text-create-tools.js', 'installTextCreateTools'], ['trim-tools.js', 'installTrimTools'], ['draw-cards-3.js', 'installDrawCards3'],
  ['layer-tools-4.js', 'installLayerTools4'], ['multi-tools-4.js', 'installMultiTools4'], ['trim-shape-tools-4.js', 'installTrimShapeTools4'], ['structure-cards-4.js', 'installStructureCards4'], ['block-text-tools-4.js', 'installBlockTextTools4'], ['dim-tools-4.js', 'installDimTools4'], ['table-sheet-tools-4.js', 'installTableSheetTools4'], ['text-edit-tools-4.js', 'installTextEditTools4'], ['area-select-tools-4.js', 'installAreaSelectTools4'], ['symbol-output-tools-4.js', 'installSymbolOutputTools4'],
];
const RENAMES = {'symbol-tools.js': [['V', 'VSYM'], ['X', 'XSYM']], 'output-tools.js': [['xiUnintall', 'BRUNINSTALL'], ['xiBackup', 'BRBACKUP'], ['xiRestore', 'BRRESTORE']], 'trim-shape-tools-4.js': [['B', 'BRK']]};
const GUIDANCE_TEXT = /제공하지 않|할 일이 없|바꿀 대상이 없|줄일 대상이 없|변환할 대상이 없|스위치가 없/;

function fixture() {
  const engine = new DrawingEngine();
  const P = (x, y) => ({x, y});
  const ids = engine.execute({type: 'addMany', entities: [
    {type: 'line', layer: 'default', points: [P(0, 0), P(4000, 0)]},
    {type: 'polyline', closed: true, layer: 'default', points: [P(0, 0), P(2000, 0), P(2000, 1000), P(0, 1000)]},
    {type: 'text', layer: 'default', position: P(100, 100), height: 150, text: 'A-101', align: 'left', rotation: 0},
    {type: 'dimension', layer: 'default', mode: 'horizontal', points: [P(0, 0), P(4000, 0), P(0, -600)], textHeight: 150, textPosition: P(2000, -500)},
    {type: 'hatch', layer: 'default', points: [P(0, 0), P(1000, 0), P(1000, 1000), P(0, 1000)], loops: [], pattern: 'ANSI31', spacing: 100, angle: 45},
    {type: 'circle', layer: 'default', center: P(5000, 0), radius: 300},
  ]});
  engine.undoStack.length = 0;
  return {engine, ids};
}

async function runCommand(fn, engine, selection) {
  interactions.length = 0; runs.length = 0;
  const toasts = [];
  const record = (kind) => () => { interactions.push(kind); return Promise.resolve(null); };
  const ctx = {
    storage: localStorage, entities: () => engine.doc.entities, blocks: () => engine.doc.blocks, layers: () => engine.doc.layers,
    ensureLayer: (name) => engine.doc.layers.find((l) => l.name === name)?.id || 'default',
    commit: () => { interactions.push('commit'); return []; }, setSelected() {},
    pickEntity: record('pick'), pickPoint: record('pick'), pickPath: record('pick'), tolerance: () => 10,
    askNumber: () => { interactions.push('askNumber'); }, toast: (m) => toasts.push(String(m)), userErrorMessage: (e) => String(e?.message || e),
    run: (name) => { interactions.push('run'); runs.push(name); }, selected: () => engine.doc.entities.filter((e) => selection.includes(e.id)), selectedIds: () => [...selection],
    execute: () => { interactions.push('execute'); return []; },
    // 비평 6: 폼을 연 뒤 기본값으로 [적용]까지 눌러, 적용 단계에서야 안내만 하는 명령도 잡는다.
    form: (title, fields, onApply) => {
      interactions.push('form');
      const values = {};
      for (const f of fields || []) if (f.type !== 'checkbox' || f.value === true || f.value === 'on') values[f.name] = f.type === 'checkbox' ? 'on' : String(f.value ?? f.options?.[0]?.[0] ?? '');
      Promise.resolve().then(() => onApply?.(values)).catch((e) => toasts.push(String(e?.message || e)));
    },
    activeLayer: () => 'default', setActiveLayer() {}, log() {}, refresh() {}, num: (k, d) => d, scale: () => 1,
  };
  return {ctx, toasts, go: async (commandFn) => {
    try { await Promise.race([Promise.resolve(commandFn()), new Promise((r) => setTimeout(r, 200))]); } catch (e) { toasts.push(String(e?.message || e)); }
    await new Promise((r) => setTimeout(r, 20));
  }};
}

test('GUIDANCE_ONLY_ALIASES 는 실제로 실행했을 때 안내만 하는 명령과 같다', async () => {
  const origError = console.error; console.error = () => {};
  try {
    const {engine, ids} = fixture();
    const detected = new Set(), checked = [], delegated = [];
    let detectorWorks = false;
    for (const spec of architectureReferenceCommands) {
      if (!spec.nativeCommand) continue;
      // 명령마다 새 ctx 로 모듈을 설치해 서로 영향을 주지 않게 한다.
      const probe = await runCommand(null, engine, ids);
      let found = null;
      for (const [file, installer] of MODULES) {
        const mod = await import('./' + file);
        const commands = mod[installer](probe.ctx) || {};
        for (const [from, to] of RENAMES[file] || []) if (commands[from]) { commands[to] = commands[from]; delete commands[from]; }
        if (commands[spec.nativeCommand]) found = commands[spec.nativeCommand];
      }
      if (typeof found !== 'function') continue; // app.js·studio.js 본체 명령(LAYISO 등)은 카드가 아니라 제외
      interactions.length = 0;
      await probe.go(found);
      const acted = interactions.filter((k) => k !== 'form');
      const onlyToast = acted.length === 0 && probe.toasts.length > 0;
      const guidance = onlyToast && probe.toasts.every((t) => GUIDANCE_TEXT.test(t));
      if (acted.length && acted.every((k) => k === 'run')) delegated.push({alias: spec.alias, runs: [...runs]});
      // DEE: area-tools 의 카드 함수는 안내만 하지만 app.js 가 건축 상세(에너지 입면 전개) 창으로 바꿔 연결한다.
      // 검출기가 실제로 동작하는지 확인하는 기준으로만 쓴다.
      if (spec.nativeCommand === 'DEE') { detectorWorks = guidance; continue; }
      checked.push(spec.alias);
      if (guidance) detected.add(spec.alias);
    }
    assert.ok(checked.length > 250, `카드 명령 ${checked.length}개만 검사됨`);
    assert.ok(detectorWorks, '안내만 하는 카드 함수(area-tools DEE)를 검출하지 못했다 — 검출기 점검 필요');
    assert.deepEqual([...detected].sort(), [...GUIDANCE_ONLY_ALIASES].sort(), '안내만 하는 명령 목록이 GUIDANCE_ONLY_ALIASES 와 다릅니다');
    // ctx.run 으로 다른 본체 명령에 넘기는 카드(PUA→BLOCKCLEAN, DSE→DIMSTYLE 등)는 따로 모아, 넘기는 대상이 실제 명령이고
    // 그 대상이 다시 안내만 하는 카드가 아닌지 확인한다(비평 6).
    const names = new Set(COMMANDS.map((c) => c.name));
    if (process.env.SHOW_DELEGATED) console.log(JSON.stringify({checked: checked.length, delegated}));
    for (const d of delegated) for (const name of d.runs) {
      assert.ok(names.has(name), `${d.alias} 가 넘기는 ${name} 은 바른 CAD 명령이 아니다`);
      const target = architectureReferenceCommands.find((c) => c.nativeCommand === name);
      assert.ok(!target || !GUIDANCE_ONLY_ALIASES.has(target.alias), `${d.alias} → ${name} 은 안내만 하는 명령`);
    }
    const summary = architectureCommandSummary();
    assert.equal(summary.guidanceOnly, detected.size);
  } finally { console.error = origError; }
});
