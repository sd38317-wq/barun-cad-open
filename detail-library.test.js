import test from 'node:test';
import assert from 'node:assert/strict';
import {DrawingEngine} from './engine.js';
import * as G from './geometry.js';
import {DETAILS, DETAIL_CATEGORIES, DETAIL_LAYER_NAMES, detailsIn, detailParameters, buildDetail, detailBlock, detailPreview, spreadLabels, installDetailLibrary} from './detail-library.js';

const IDS = Object.keys(DETAILS);
const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-6, `${msg || ''} ${a} ≠ ${b}`);
const measure = (dim) => {
 const [a, b] = dim.points;
 if (dim.mode === 'aligned') return G.dist(a, b);
 const u = G.polar(1, dim.axisAngle ?? (dim.mode === 'horizontal' ? 0 : 90));
 return Math.abs(G.dot(G.sub(b, a), u));
};
const byRole = (built, type, role) => built.entities.filter(e => e.type === type && e.detailRole === role);

test('목록: 5분류 12종, 분류마다 1개 이상', () => {
 assert.deepEqual(DETAIL_CATEGORIES.map(([k]) => k), ['wall', 'roof', 'foundation', 'opening', 'waterproof']);
 assert.equal(IDS.length, 12);
 assert.equal(detailsIn('wall').length, 4);
 assert.equal(detailsIn('roof').length, 2);
 assert.equal(detailsIn('foundation').length, 3);
 assert.equal(detailsIn('opening').length, 1);
 assert.equal(detailsIn('waterproof').length, 2);
});

test('모든 상세: 실제 엔진 addMany 검사 통과(1:20 · 1:50), 블록 한 개로도 통과', () => {
 for (const id of IDS) for (const scale of [20, 50]) {
  const built = buildDetail(id, {}, {scale});
  const engine = new DrawingEngine();
  engine.execute({type: 'addMany', entities: built.entities});
  assert.equal(engine.doc.entities.length, built.entities.length, id);
  const block = new DrawingEngine();
  block.execute({type: 'add', entity: detailBlock(id, {}, {scale, position: {x: 5000, y: -3000}})});
  const b = G.bounds(block.doc.entities);
  near(b.minX, 5000, `${id} 삽입점 x`);near(b.minY, -3000, `${id} 삽입점 y`);
 }
});

test('모든 상세: 층 두께 치수의 합 = 전체 치수 = 재료층 두께 합', () => {
 for (const id of IDS) {
  const built = buildDetail(id);
  const layerDims = byRole(built, 'dimension', 'layer'), total = byRole(built, 'dimension', 'total');
  assert.equal(layerDims.length, built.layers.length, `${id} 층마다 치수 하나`);
  assert.equal(total.length, 1, `${id} 전체 치수`);
  const sum = layerDims.reduce((s, d) => s + measure(d), 0), thk = built.layers.reduce((s, l) => s + l.thk, 0);
  near(sum, measure(total[0]), `${id} 합=전체`);
  near(sum, thk, `${id} 합=두께`);
  near(built.total, thk, `${id} total`);
  // 각 치수가 그 층 두께와 같다(순서는 치수 방향 오름차순이라 뒤집어 비교)
  const measured = layerDims.map(measure).sort((a, b) => a - b), expected = built.layers.map(l => l.thk).sort((a, b) => a - b);
  measured.forEach((m, i) => near(m, expected[i], `${id} 층 ${i}`));
 }
});

test('모든 상세: 재료 표기가 모든 층(흙 포함)을 위→아래(외부→내부) 순서로 적는다', () => {
 for (const id of IDS) {
  const built = buildDetail(id);
  const noteTexts = byRole(built, 'text', 'note').map(t => t.text);
  assert.deepEqual([...noteTexts].sort(), [...built.notes].sort(), `${id} 문자 객체 = 표기 목록`);
  for (const l of [...built.layers, ...built.extras]) assert.ok(built.notes.some(n => n.includes(l.name)), `${id}: "${l.name}" 표기 없음`);
  let at = -1;
  for (const l of built.layers) { const i = built.notes.findIndex((n, k) => k > at && n.includes(l.name)); assert.ok(i > at, `${id}: "${l.name}" 순서`); at = i; }
  assert.ok(byRole(built, 'polyline', 'leader').length >= 1, `${id} 지시선`);
  assert.equal(byRole(built, 'hatch', 'dot').length, built.notes.length, `${id} 표기마다 점 하나`);
 }
 const ext = buildDetail('wall-rc-ext');
 assert.deepEqual(ext.notes, ['THK10 외단열 미장 마감', 'THK100 비드법 보온판 2종1호', 'THK200 철근콘크리트 벽', 'THK9.5 석고보드 위 도배']);
 const roof = buildDetail('roof-flat');
 assert.equal(roof.notes[0], 'THK40 보호 몰탈', '맨 위층부터');
 assert.equal(roof.notes.at(-1), 'THK150 철근콘크리트 슬래브');
 assert.equal(buildDetail('fdn-mat').notes.at(-1), '원지반 다짐');
 assert.equal(buildDetail('wp-basement').notes[0], '되메우기 흙 (다짐)', '외부 흙부터');
});

test('제목·축척과 주석 크기: 용지 mm × 상세 축척, 기하는 실제 크기', () => {
 const a = buildDetail('wall-rc-ext', {}, {scale: 20}), b = buildDetail('wall-rc-ext', {}, {scale: 10});
 assert.equal(a.title, '(벽체) RC 200 외단열');
 const title = a.entities.find(e => e.titleRole === 'title'), sub = a.entities.find(e => e.titleRole === 'scale');
 assert.equal(title.text, '(벽체) RC 200 외단열');
 assert.equal(title.height, 100);
 assert.equal(sub.text, 'SCALE 1:20');
 assert.equal(sub.height, 60);
 assert.equal(byRole(a, 'text', 'note')[0].height, 50);
 assert.equal(byRole(a, 'dimension', 'layer')[0].textHeight, 50);
 assert.equal(byRole(b, 'text', 'note')[0].height, 25);
 assert.equal(b.entities.find(e => e.titleRole === 'scale').text, 'SCALE 1:10');
 near(a.total, 319.5);near(b.total, 319.5, '축척이 바뀌어도 벽 두께는 그대로');
 const conc = a.entities.find(e => e.type === 'polyline' && e.detailMaterial === 'concrete');
 near(G.bounds([conc]).maxX - G.bounds([conc]).minX, 200);
 assert.ok(title.position.y < G.bounds(a.entities.filter(e => !e.titleRole)).minY, '제목은 상세 아래');
 assert.equal(buildDetail('roof-slope').title, '(지붕) 경사지붕 · 징크 (물매 4/10)');
 assert.equal(buildDetail('fdn-isolated').title, '(기초) 독립기초 2000×2000×500');
});

test('재료 해치: 콘크리트 AR-CONC · 단열 INSUL · 흙 EARTH · 잡석 GRAVEL · 몰탈 AR-SAND · 방수 채움 · 글라스울 지그재그', () => {
 const patternOf = (built, mat) => built.entities.filter(e => e.type === 'hatch' && e.detailMaterial === mat);
 const ext = buildDetail('wall-rc-ext');
 assert.equal(patternOf(ext, 'concrete')[0].patternName, 'AR-CONC');
 assert.equal(patternOf(ext, 'insulation')[0].patternName, 'INSUL');
 assert.equal(patternOf(ext, 'mortar')[0].patternName, 'AR-SAND');
 near(patternOf(ext, 'concrete')[0].patternScale, 0.8, '0.04 × 1:20');
 const mat = buildDetail('fdn-mat');
 assert.equal(patternOf(mat, 'earth')[0].patternName, 'EARTH');
 assert.equal(patternOf(mat, 'gravel')[0].patternName, 'GRAVEL');
 assert.equal(patternOf(buildDetail('roof-flat'), 'membrane')[0].solid, true);
 const light = buildDetail('wall-light');
 assert.ok(light.entities.some(e => e.type === 'polyline' && !e.closed && e.detailMaterial === 'batt'), '글라스울 지그재그');
 const studs = light.entities.filter(e => e.detailMaterial === 'stud' && !e.closed);
 assert.equal(studs.length, 2, '@450 · 1000 길이에 스터드 2개');
 assert.equal(patternOf(buildDetail('wall-cavity'), 'brick')[0].patternName, 'ANSI31');
});

test('치수 숫자: 얇은 층이 몰려도 숫자끼리 겹치지 않는다', () => {
 for (const id of ['wall-light', 'wall-rc-ext', 'roof-slope', 'wp-bath']) {
  const built = buildDetail(id), dims = byRole(built, 'dimension', 'layer');
  const labels = dims.map(d => {
   const parts = G.dimensionParts(d), t = parts.find(p => p.type === 'text');
   const u = G.polar(1, d.axisAngle ?? (d.mode === 'horizontal' ? 0 : 90)), c = G.dot(t.position, u), w = t.text.length * 0.65 * t.height;
   return {lo: c - w / 2, hi: c + w / 2};
  }).sort((a, b) => a.lo - b.lo);
  for (let i = 1; i < labels.length; i++) assert.ok(labels[i].lo >= labels[i - 1].hi - 1e-6, `${id} 숫자 ${i} 겹침`);
 }
});

test('1차원 문자 벌리기', () => {
 assert.deepEqual(spreadLabels([{c: 0, w: 10}, {c: 100, w: 10}], 2), [0, 100], '안 겹치면 그대로');
 const p = spreadLabels([{c: 0, w: 10}, {c: 1, w: 10}], 2);
 near(p[1] - p[0], 12);near((p[0] + p[1]) / 2, 0.5, '무리 평균 위치 유지');
 const q = spreadLabels([{c: 0, w: 10}, {c: 5, w: 10}, {c: 30, w: 10}], 0);
 assert.ok(q[1] - q[0] >= 10 - 1e-9 && q[2] - q[1] >= 10 - 1e-9);
});

test('치수 입력을 바꾸면 기하가 바뀐다', () => {
 const a = buildDetail('wall-rc-ext'), b = buildDetail('wall-rc-ext', {insulation: 150, concrete: 250});
 near(b.total - a.total, 100);
 assert.equal(b.title, '(벽체) RC 250 외단열');
 assert.ok(b.notes.includes('THK150 비드법 보온판 2종1호'));
 const s1 = buildDetail('fdn-strip'), s2 = buildDetail('fdn-strip', {width: 1200});
 const footing = (x) => x.entities.find(e => e.type === 'polyline' && e.detailMaterial === 'concrete');
 near(G.bounds([footing(s2)]).maxX - G.bounds([footing(s2)]).minX, 1200);
 assert.notDeepEqual(G.bounds([footing(s1)]), G.bounds([footing(s2)]));
 const r4 = buildDetail('roof-slope', {rise: 4}), r8 = buildDetail('roof-slope', {rise: 8});
 const slopeOf = (x) => { const d = byRole(x, 'dimension', 'total')[0]; return d.axisAngle - 90; };
 near(slopeOf(r4), Math.atan2(4, 10) * 180 / Math.PI);
 near(slopeOf(r8), Math.atan2(8, 10) * 180 / Math.PI);
 assert.ok(buildDetail('roof-slope', {finish: 'shingle'}).notes.some(n => n.includes('아스팔트 싱글')));
 const cav = buildDetail('wall-cavity', {air: 0, plaster: 0});
 assert.equal(cav.layers.length, 3, '0 인 층은 뺀다');
 assert.equal(buildDetail('fdn-mat', {gravel: 0}).layers.length, 2);
 const w = buildDetail('win-sill-lintel', {opening: 2100});
 near(w.total, 900 + 2100 + 300);
 const bath = buildDetail('wp-bath', {upturn: 600});
 const upturn = byRole(bath, 'dimension', 'extra')[0];
 near(measure(upturn), 600);
});

test('잘못된 입력은 거부', () => {
 assert.throws(() => buildDetail('nope'), /상세 종류/);
 assert.throws(() => buildDetail('wall-rc-ext', {insulation: -10}), /단열재/);
 assert.throws(() => buildDetail('wall-rc-ext', {insulation: 5}), /10~400/);
 assert.throws(() => buildDetail('wall-rc-ext', {concrete: 'abc'}), /숫자/);
 assert.throws(() => buildDetail('wall-rc-ext', {concrete: ''}), /숫자/);
 assert.throws(() => buildDetail('roof-flat', {membrane: 'glue'}), /목록/);
 assert.throws(() => buildDetail('fdn-strip', {wall: 900, width: 900}), /기초벽/);
 assert.throws(() => buildDetail('fdn-isolated', {column: 2500, width: 2000}), /기둥/);
 assert.throws(() => buildDetail('win-sill-lintel', {inset: 150, frame: 100, wall: 200}), /창틀/);
 assert.throws(() => buildDetail('wall-rc-ext', {}, {scale: 0}), /축척/);
 assert.throws(() => buildDetail('wall-rc-ext', {}, {scale: 1000}), /축척/);
 assert.throws(() => detailBlock('wall-rc-ext', {}, {position: {x: NaN, y: 0}}), /삽입점/);
 assert.deepEqual(detailParameters('wall-rc-ext', {insulation: '120'}).insulation, 120, '문자로 온 숫자도 읽는다');
});

test('블록은 한 덩어리로 움직인다(이동 한 번에 해치 무늬까지)', () => {
 const engine = new DrawingEngine();
 engine.execute({type: 'add', entity: detailBlock('fdn-mat', {}, {position: {x: 0, y: 0}})});
 const before = structuredClone(engine.doc.entities[0]);
 engine.execute({type: 'move', ids: [before.id], dx: 1000, dy: 500});
 const after = engine.doc.entities[0];
 assert.equal(engine.doc.entities.length, 1);
 const hb = before.entities.find(e => e.detailMaterial === 'gravel' && e.type === 'hatch'), ha = after.entities.find(e => e.detailMaterial === 'gravel' && e.type === 'hatch');
 near(ha.points[0].x - hb.points[0].x, 1000);
 near(ha.patternLines[0].base.y - hb.patternLines[0].base.y, 500);
 assert.equal(after.detail.id, 'fdn-mat');
 assert.equal(after.attributes.scale, 20);
});

function harness(engine, picks) {
 const forms = [], toasts = [], store = new Map(), h = {forms, toasts, previews: []};
 const wrap = (onApply) => (values) => {
  engine.beginTransaction();
  let result;
  try { result = onApply(values); } catch (e) { engine.endTransaction(); throw e; }
  if (!(result && typeof result.then === 'function')) { engine.endTransaction(); return result; }
  return result.then(v => { engine.endTransaction(); return v; }, e => { engine.endTransaction(); throw e; });
 };
 h.ctx = {
  storage: {getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, v)},
  layers: () => engine.doc.layers, entities: () => engine.doc.entities, toast: m => toasts.push(m),
  ensureLayer: (name, color) => { const f = engine.doc.layers.find(l => l.name === name); if (f) return f.id; engine.execute({type: 'layer.add', name, color}); return engine.doc.layers.find(l => l.name === name).id; },
  commit: ({entities}) => engine.execute({type: 'batch', commands: [{type: 'addMany', entities: entities.map(e => ({...e, layer: e.layer || 'default'}))}]}),
  pickPoint: async (opts) => { h.previews.push(opts?.preview); return picks.shift() ?? null; },
  form: (title, fields, onApply) => { const apply = wrap(onApply); forms.push({title, fields, apply: (v = {}) => apply({...Object.fromEntries(fields.map(f => [f.name, f.value])), ...v})}); return fields; },
 };
 return h;
}

test('DETAIL 명령: 분류 → 상세 → 치수·축척 → 점(경계 미리보기) → 블록 한 개, 되돌리기 한 번', async () => {
 const engine = new DrawingEngine();
 const h = harness(engine, [{x: 10000, y: 20000}]);
 installDetailLibrary(h.ctx).DETAIL();
 assert.match(h.forms[0].title, /1\/3/);
 h.forms[0].apply({category: 'wall'});
 assert.match(h.forms[1].title, /2\/3 벽체/);
 assert.deepEqual(h.forms[1].fields[0].options.map(([id]) => id), ['wall-rc-ext', 'wall-rc-int', 'wall-cavity', 'wall-light']);
 h.forms[1].apply({detail: 'wall-rc-ext'});
 assert.match(h.forms[2].title, /3\/3/);
 assert.equal(h.forms[2].fields.find(f => f.name === 'scale').value, 20);
 const undoBefore = engine.undoStack.length;
 await h.forms[2].apply({insulation: 150, scale: 25});
 assert.equal(engine.doc.entities.length, 1);
 const block = engine.doc.entities[0];
 assert.equal(block.type, 'block');
 assert.equal(block.detail.id, 'wall-rc-ext');
 assert.equal(block.detail.parameters.insulation, 150);
 assert.equal(block.detail.scale, 25);
 assert.deepEqual(block.position, {x: 10000, y: 20000});
 const layerId = (name) => engine.doc.layers.find(l => l.name === name).id;
 for (const [name] of Object.values(DETAIL_LAYER_NAMES)) assert.ok(engine.doc.layers.some(l => l.name === name), name);
 assert.equal(block.layer, layerId('A-DETL'));
 assert.ok(block.entities.some(e => e.type === 'hatch' && e.layer === layerId('A-DETL-PATT')));
 assert.ok(block.entities.some(e => e.type === 'dimension' && e.layer === layerId('A-DIM')));
 assert.ok(block.entities.some(e => e.detailRole === 'note' && e.layer === layerId('A-TEXT')));
 assert.equal(engine.undoStack.length, undoBefore + 1, '레이어 만들기와 넣기가 한 단계');
 // 미리보기: 커서에 왼쪽 아래를 맞춘 경계 상자
 const built = buildDetail('wall-rc-ext', {insulation: 150}, {scale: 25});
 const preview = h.previews[0]([], {x: 0, y: 0});
 const box = G.bounds([preview[0]]);
 near(box.minX, 0);near(box.maxX, built.bounds.maxX - built.bounds.minX);
 near(box.maxY, built.bounds.maxY - built.bounds.minY);
 assert.ok(preview.length > 4 && preview.every(e => e.type === 'polyline'));
 engine.execute({type: 'undo'});
 assert.equal(engine.doc.entities.length, 0);
 assert.ok(!engine.doc.layers.some(l => l.name === 'A-DETL'));
});

test('DETAIL 명령: 한 종뿐인 분류는 상세 고르기를 건너뛰고, 값·축척을 기억, 점 취소는 아무것도 안 함', async () => {
 const engine = new DrawingEngine();
 const h = harness(engine, [null, {x: 0, y: 0}]);
 const cmds = installDetailLibrary(h.ctx);
 cmds.DETAIL();
 h.forms[0].apply({category: 'opening'});
 assert.match(h.forms[1].title, /3\/3 \(창호\) 창대·인방/);
 await h.forms[1].apply({opening: 1800, scale: 30});
 assert.equal(engine.doc.entities.length, 0, '점 취소');
 assert.equal(engine.doc.layers.length, 1, '취소하면 레이어도 만들지 않음');
 cmds.DETAIL();
 assert.equal(h.forms[2].fields[0].value, 'opening', '마지막 분류 기억');
 h.forms[2].apply({});
 assert.equal(h.forms[3].fields.find(f => f.name === 'opening').value, 1800, '마지막 값 기억');
 assert.equal(h.forms[3].fields.find(f => f.name === 'scale').value, 30);
 await h.forms[3].apply({});
 assert.equal(engine.doc.entities.length, 1);
 assert.equal(engine.doc.entities[0].detail.parameters.opening, 1800);
 cmds.DETAIL();
 h.forms[4].apply({category: 'foundation'});
 h.forms[5].apply({detail: 'fdn-strip'});
 await assert.rejects(() => h.forms[6].apply({wall: 900, width: 900}), /기초벽 두께는 기초판 폭보다/);
 assert.equal(engine.doc.entities.length, 1, '잘못된 입력이면 점도 묻지 않고 그대로');
 assert.equal(engine.inTransaction(), false);
});
