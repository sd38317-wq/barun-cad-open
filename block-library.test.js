import test from 'node:test';
import assert from 'node:assert/strict';
import {DrawingEngine} from './engine.js';
import * as G from './geometry.js';
import {installWorkflows} from './workflows.js';
import {defaults as studioDefaults} from './studio.js';
import {
 BLOCK_ITEMS, BLOCK_CATEGORIES, blockItem, itemsOf, itemDefaults, normalizeParams, buildItem, itemFootprint, libraryBlock, placeEntities,
 readLibraryStore, collectExportBlocks, buildLibraryFile, parseLibraryFile, mergeLibrary, importLibraryText, installBlockLibrary, cleanBlockName,
 LIBRARY_STORAGE_KEY, LIBRARY_META_KEY, BLOCKLIB_LAST_KEY, LIBRARY_FORMAT, LIBRARY_VERSION, LIBRARY_LIMITS,
} from './block-library.js';

const P = (x, y) => ({x, y});
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} ≠ ${b}`);
const assertBox = (actual, expected, msg, tol = 0.5) => { assert.ok(actual, `${msg}: 경계 없음`); for (const k of ['minX', 'minY', 'maxX', 'maxY']) near(actual[k], expected[k], tol, `${msg} ${k}`); };
const memoryStorage = (init = {}) => { const map = new Map(Object.entries(init)); return {map, getItem: k => map.has(k) ? map.get(k) : null, setItem: (k, v) => map.set(k, String(v)), removeItem: k => map.delete(k)}; };
const midValues = (item) => Object.fromEntries(item.params.filter(p => p.type === 'number').map(p => [p.name, Math.round((p.min + p.max) / 2)]));
const allPrimitives = (entities) => entities.flatMap(G.primitives);

function harness({storage = memoryStorage(), picks = [], downloadText, openTextFile, denominator = 100} = {}) {
 const engine = new DrawingEngine(), toasts = [], previews = [], queue = [...picks], selectedIds = new Set(), downloads = [];
 let pending = null;
 const ctx = {
  storage, doc: () => engine.doc, entities: () => engine.doc.entities, blocks: () => engine.doc.blocks, layers: () => engine.doc.layers,
  selected: () => engine.doc.entities.filter(e => selectedIds.has(e.id)), activeLayer: () => 'default',
  ensureLayer: (name, color) => { const f = engine.doc.layers.find(l => l.name === name); if (f) return f.id; engine.execute({type: 'layer.add', name, color}); return engine.doc.layers.find(l => l.name === name).id; },
  commit: ({entities}) => engine.execute({type: 'batch', commands: [{type: 'addMany', entities: entities.map(e => ({...e, layer: e.layer || 'default'}))}]}),
  execute: (c) => engine.execute(c),
  form: (title, fields, onApply) => { pending = {title, fields, onApply}; return fields; },
  pickPoint: async (options) => { const next = queue.length ? queue.shift() : null; if (next && typeof options?.preview === 'function') previews.push(options.preview([], next)); return next; },
  toast: (m) => toasts.push(String(m)), getSettings: () => ({denominator}),
  ...(downloadText === undefined ? {downloadText: (name, text, type) => { downloads.push({name, text, type}); }} : downloadText ? {downloadText} : {}),
  ...(openTextFile ? {openTextFile} : {}),
 };
 const commands = installBlockLibrary(ctx);
 return {
  engine, ctx, commands, toasts, previews, queue, selectedIds, downloads,
  get form() { return pending; },
  field: (name) => pending.fields.find(f => f.name === name),
  apply: async (values = {}) => { const f = pending; return await f.onApply({...Object.fromEntries(f.fields.map(x => [x.name, x.value])), ...values}); },
 };
}

test('카탈로그: 7개 분류 41종, 이름은 "<분류>-<이름>", 기존 명령과 겹치지 않는 품목 id', () => {
 assert.deepEqual(BLOCK_CATEGORIES.map(c => c.label), ['가구', '위생', '주방', '차량', '조경', '기호', '사무']);
 assert.deepEqual(BLOCK_CATEGORIES.map(c => itemsOf(c.id).length), [11, 9, 5, 4, 4, 4, 4]);
 assert.equal(BLOCK_ITEMS.length, 41);
 assert.equal(new Set(BLOCK_ITEMS.map(i => i.id)).size, 41);
 assert.equal(new Set(BLOCK_ITEMS.map(i => i.blockName)).size, 41);
 for (const item of BLOCK_ITEMS) assert.match(item.blockName, /^(가구|위생|주방|차량|조경|기호|사무)-\S/);
 for (const name of ['가구-퀸 침대', '위생-장애인 화장실 변기+손잡이', '주방-싱크대 ㄱ자', '차량-승용차 (4.7m)', '조경-교목', '기호-방위표', '사무-파티션'])
  assert.ok(BLOCK_ITEMS.some(i => i.blockName === name), name);
});

test('모든 품목: 기본값·중간값·회전·대칭 블록이 실제 엔진 addMany 검증을 통과한다', () => {
 const engine = new DrawingEngine();
 for (const item of BLOCK_ITEMS) {
  for (const [values, rotation, mirror] of [[{}, 0, false], [midValues(item), 90, false], [{}, 37.5, true], [midValues(item), 270, true]]) {
   const block = libraryBlock(item.id, values, {position: P(1000, -2000), rotation, mirror, layer: 'default'});
   assert.equal(block.type, 'block');
   assert.equal(block.name, item.blockName);
   assert.equal(block.category, 'LIBRARY');
   assert.equal(block.attributes.libraryId, item.id);
   for (const p of item.params) assert.ok(p.name in block.attributes, `${item.id} 속성 ${p.name}`);
   assert.ok(block.entities.length >= 1);
   const [id] = engine.execute({type: 'addMany', entities: [block]});
   assert.equal(typeof id, 'string', item.id);
  }
  // 블록으로 싸지 않은 낱개 객체도 그대로 넣을 수 있어야 한다.
  engine.execute({type: 'addMany', entities: buildItem(item.id).map(e => ({...e, layer: 'default'}))});
 }
 engine.validate(engine.doc);
 assert.equal(engine.doc.entities.filter(e => e.type === 'block').length, 41 * 4);
});

test('크기: 경계(G.bounds)가 매개변수와 맞는다 · 기본값과 중간값 모두', () => {
 for (const item of BLOCK_ITEMS) for (const values of [{}, midValues(item)]) {
  assertBox(G.bounds(buildItem(item.id, values)), itemFootprint(item.id, values), `${item.id} ${JSON.stringify(values)}`);
 }
 const size = (id, values) => { const b = G.bounds(buildItem(id, values)); return [+(b.maxX - b.minX).toFixed(3), +(b.maxY - b.minY).toFixed(3)]; };
 assert.deepEqual(size('bed-single'), [1000, 2000]);
 assert.deepEqual(size('bed-queen'), [1500, 2000]);
 assert.deepEqual(size('bed-double', {width: 1600, length: 2100}), [1600, 2100]);
 assert.deepEqual(size('sofa-3'), [2100, 850]);
 assert.deepEqual(size('wardrobe-1200'), [1200, 600]);
 assert.deepEqual(size('closet', {length: 3600}), [3600, 600]);
 assert.deepEqual(size('bathtub-1700'), [1700, 750]);
 assert.deepEqual(size('shower-900'), [900, 900]);
 assert.deepEqual(size('sink-straight', {length: 3000}), [3000, 600]);
 assert.deepEqual(size('sink-l', {length: 2700, side: 2100}), [2700, 2100]);
 assert.deepEqual(size('fridge'), [910, 920]);
 assert.deepEqual(size('tree'), [3000, 3000]);
 assert.deepEqual(size('tree', {diameter: 5000}), [5000, 5000]);
 assert.deepEqual(size('shrub', {diameter: 1200}), [1200, 1200]);
 assert.deepEqual(size('parking-accessible'), [1500, 1500]);
 assert.deepEqual(size('bench', {width: 2000}), [2000, 450]);
 assert.deepEqual(size('partition', {length: 1800}), [1800, 50]);
 // 차: 길이 4.7 m, 폭은 차체 + 양쪽 미러
 const car = size('car');
 assert.equal(car[1], 4700);
 assert.equal(car[0], 1860 + 2 * 120);
 assert.equal(size('car-light')[1], 3600);
 // 식탁·회의 테이블: 식탁 자체 크기는 매개변수 그대로, 의자는 양쪽 500 mm
 const table = G.bounds([buildItem('dining-6', {width: 2000, depth: 1000})[0]]);
 assertBox(table, {minX: -1000, minY: -500, maxX: 1000, maxY: 500}, '6인 식탁 상판');
 assert.equal(buildItem('dining-6').filter(e => e.type === 'polyline').length, 1 + 6 * 2);
 assert.deepEqual(size('meeting', {length: 3000, depth: 1200, ends: true}), [3000 + 1000, 1200 + 1000]);
 // 기호는 도면 축척에 비례한 기본값
 assert.equal(itemDefaults(blockItem('north'), 200).diameter, 3000);
 assert.equal(itemDefaults(blockItem('level'), 50).textHeight, 125);
 assert.equal(itemDefaults(blockItem('bed-single'), 200).width, 1000, '가구는 축척과 무관한 실제 크기');
});

test('매개변수 검사: 범위 밖·빈 값·ㄱ자 다리 길이는 한국어 오류', () => {
 assert.throws(() => normalizeParams(blockItem('bed-single'), {width: 5000}), /700~2000/);
 assert.throws(() => normalizeParams(blockItem('bed-single'), {width: ''}), /숫자/);
 assert.throws(() => normalizeParams(blockItem('sink-l'), {length: 1400, depth: 700}), /가로 길이 A/);
 assert.throws(() => normalizeParams(blockItem('section'), {label: ''}), /단면 기호/);
 assert.throws(() => normalizeParams(blockItem('entrance'), {length: 300, width: 600}), /화살표 길이/);
 assert.equal(normalizeParams(blockItem('range'), {kind: 'bogus'}).kind, 'gas');
 assert.equal(normalizeParams(blockItem('sink-straight'), {}).upper, true, '직접 부를 때 빠진 값 = 기본값');
 assert.equal(normalizeParams(blockItem('sink-straight'), {upper: false}).upper, false);
 assert.equal(normalizeParams(blockItem('sink-straight'), {upper: 'on'}).upper, true);
 assert.ok(buildItem('sink-straight', {upper: true}).some(e => e.linetype === 'HIDDEN'));
 assert.ok(!buildItem('sink-straight', {upper: false}).some(e => e.linetype === 'HIDDEN'));
 assert.equal(buildItem('range', {kind: 'induction'}).filter(e => e.type === 'circle').length, 3);
});

test('회전: 0/90/180/270·임의 각도, 기준점 기준 · 블록 회전 속성 기록', () => {
 const at = P(1000, 2000);
 const boundsOf = (rotation, mirror = false) => G.bounds(libraryBlock('bed-single', {}, {position: at, rotation, mirror}).entities);
 assertBox(boundsOf(0), {minX: 1000, minY: 2000, maxX: 2000, maxY: 4000}, '0°');
 assertBox(boundsOf(90), {minX: -1000, minY: 2000, maxX: 1000, maxY: 3000}, '90°');
 assertBox(boundsOf(180), {minX: 0, minY: 0, maxX: 1000, maxY: 2000}, '180°');
 assertBox(boundsOf(270), {minX: 1000, minY: 1000, maxX: 3000, maxY: 2000}, '270°');
 const b30 = libraryBlock('bed-single', {}, {position: at, rotation: 30});
 assert.equal(b30.rotation, 30);
 assert.deepEqual(b30.position, at);
 const frame = b30.entities[0].points;   // 첫 객체 = 침대 외곽 (0,0)(W,0)(W,L)(0,L)
 near(frame[1].x, 1000 + 1000 * Math.cos(Math.PI / 6), 1e-6, '30° 모서리 x');
 near(frame[1].y, 2000 + 1000 * Math.sin(Math.PI / 6), 1e-6, '30° 모서리 y');
 assert.equal(libraryBlock('bed-single', {}, {rotation: -90}).rotation, 270);
 // 가운데 기준 품목은 회전해도 중심이 기준점
 const car = G.bounds(libraryBlock('car', {}, {position: at, rotation: 90}).entities);
 near((car.minX + car.maxX) / 2, 1000, 1e-6, '차 중심 x');near((car.minY + car.maxY) / 2, 2000, 1e-6, '차 중심 y');
 near(car.maxX - car.minX, 4700, 1e-6, '90° 차 길이는 X 방향');
});

test('대칭: 세로축 기준으로 뒤집고 문자는 읽히는 방향 그대로(MIRRTEXT=0)', () => {
 const at = P(1000, 2000);
 const bed = libraryBlock('bed-single', {}, {position: at, mirror: true});
 assertBox(G.bounds(bed.entities), {minX: 0, minY: 2000, maxX: 1000, maxY: 4000}, '대칭 침대');
 assert.equal(bed.attributes.mirrored, true);
 const fold = bed.entities.find(e => e.type === 'line' && Math.abs(e.points[0].y - e.points[1].y) > 1);   // 접힌 이불 모서리
 assert.ok(Math.max(fold.points[0].x, fold.points[1].x) <= 0 + 420 + 1e-6, '접힌 모서리가 반대쪽(왼쪽)으로');
 const fridge = libraryBlock('fridge', {}, {mirror: true});
 const ref = fridge.entities.find(e => e.type === 'text');
 assert.equal(ref.rotation, 0);assert.equal(ref.align, 'center');assert.equal(ref.text, 'REF');
 // ㄱ자 싱크대 대칭 → 오른쪽 벽 모서리용
 const sink = G.bounds(libraryBlock('sink-l', {}, {mirror: true}).entities);
 assertBox(sink, {minX: -2400, minY: 0, maxX: 0, maxY: 1800}, '대칭 ㄱ자');
 // 호(관목)는 대칭 뒤에도 같은 원 경계
 assertBox(G.bounds(libraryBlock('shrub', {}, {mirror: true, rotation: 45}).entities), {minX: -500, minY: -500, maxX: 500, maxY: 500}, '관목 대칭', 1);
});

test('문자는 180° 돌려도 거꾸로 서지 않고 같은 자리를 덮는다', () => {
 const local = buildItem('level');
 const text = local.find(e => e.type === 'text');
 const raw = G.rotate(text, P(0, 0), 180);   // 그냥 돌리면 거꾸로 선 문자
 const [readable] = placeEntities([text], {rotation: 180});
 assert.equal(((readable.rotation % 360) + 360) % 360, 0);
 assertBox(G.bounds([readable]), G.bounds([raw]), '읽히는 문자 자리');
 const [upright] = placeEntities([text], {rotation: 90});
 assert.equal(upright.rotation, 90, '90°는 그대로(아래→위로 읽힘)');
 const left = {type: 'text', position: P(0, 0), text: 'AB', height: 100};
 const [flipped] = placeEntities([left], {rotation: 180});
 assertBox(G.bounds([flipped]), G.bounds([G.rotate(left, P(0, 0), 180)]), '왼쪽 정렬 문자도 같은 자리');
 assert.equal(flipped.align, 'right');
});

test('BLOCKLIB: 분류 → 품목 → 크기·회전 → 미리보기 따라 삽입, Esc 까지 반복, 분류 표준 레이어, 마지막 선택 기억', async () => {
 const storage = memoryStorage();
 const h = harness({storage, picks: [P(0, 0), P(5000, 0)]});
 h.commands.BLOCKLIB();
 assert.equal(h.field('category').value, 'furniture');
 assert.ok(h.field('category').options.some(([v]) => v === '__import__'));
 await h.apply({category: 'furniture'});
 assert.match(h.form.title, /가구 11종/);
 assert.ok(h.field('item').options.some(([v, text]) => v === 'bed-queen' && /1500×2000/.test(text)));
 await h.apply({item: 'bed-queen'});
 assert.match(h.form.title, /가구-퀸 침대 · 기준점/);
 assert.equal(h.field('width').value, 1500);
 assert.equal(h.field('repeat').value, true);
 const count = await h.apply({width: '1600', rotation: '90'});
 assert.equal(count, 2, '점 두 번 뒤 Esc(null) 로 끝');
 const blocks = h.engine.doc.entities;
 assert.equal(blocks.length, 2);
 const furn = h.engine.doc.layers.find(l => l.name === 'A-FURN');
 assert.ok(furn, '가구 표준 레이어');
 for (const b of blocks) {
  assert.equal(b.name, '가구-퀸 침대');assert.equal(b.layer, furn.id);assert.equal(b.attributes.width, 1600);assert.equal(b.rotation, 90);
  assert.ok(G.primitives(b).every(e => e.layer === furn.id), '안쪽 객체도 같은 레이어');
 }
 assertBox(G.bounds(blocks[1].entities), {minX: 3000, minY: 0, maxX: 5000, maxY: 1600}, '두 번째 삽입');
 assert.equal(h.previews.length, 2);
 assert.equal(h.previews[0][0].type, 'block');
 assertBox(G.bounds(h.previews[0][0].entities), G.bounds(blocks[0].entities), '미리보기 = 실제 삽입 모양');
 assert.match(h.toasts.at(-1), /2개/);
 h.engine.execute({type: 'undo'});
 assert.equal(h.engine.doc.entities.length, 1, '한 번 삽입마다 한 단계(시험 ctx 기준)');
 // 다시 열면 "최근" 이 맨 위, 적용하면 바로 크기 단계 + 기억한 값
 const again = harness({storage, picks: [P(0, 0), P(0, 1000)]});
 again.commands.BLOCKLIB();
 assert.equal(again.field('category').value, '__recent__');
 await again.apply({});
 assert.equal(again.field('width').value, 1600);
 assert.equal(again.field('rotation').value, '90');
 // 방향 클릭 모드 · 반복 끔
 await again.apply({rotation: 'pick', repeat: false});
 assert.equal(again.engine.doc.entities.length, 1);
 assert.equal(again.engine.doc.entities[0].rotation, 90, '(0,0)→(0,1000) 방향 = 90°');
 assert.equal(JSON.parse(storage.getItem(BLOCKLIB_LAST_KEY)).rotation, 'pick');
});

test('BLOCKLIB: 삽입 없이 Esc 면 레이어도 만들지 않고, 잠긴 표준 레이어는 점 찍기 전에 막는다', async () => {
 const h = harness({picks: []});
 h.commands.BLOCKLIB();await h.apply({category: 'sanitary'});await h.apply({item: 'toilet-floor'});
 assert.equal(await h.apply({}), 0);
 assert.ok(!h.engine.doc.layers.some(l => l.name === 'A-SANI'));
 h.engine.execute({type: 'layer.add', name: 'A-SANI', color: '#808080'});
 const id = h.engine.doc.layers.find(l => l.name === 'A-SANI').id;
 h.engine.execute({type: 'layer.update', id, changes: {locked: true}});
 h.commands.BLOCKLIB();await h.apply({category: 'sanitary'});await h.apply({item: 'urinal'});
 await assert.rejects(h.apply({}), /잠김/);
 // 현재 레이어로 넣기는 된다
 h.queue.push(P(100, 100));
 h.commands.BLOCKLIB();await h.apply({category: 'sanitary'});await h.apply({item: 'urinal'});
 assert.equal(await h.apply({layer: 'current', repeat: false}), 1);
 assert.equal(h.engine.doc.entities[0].layer, 'default');
});

test('BLOCKLIB: 기호는 도면 축척에 맞춘 기본 크기, 범위 밖 입력은 폼 오류', async () => {
 const h = harness({denominator: 50, picks: [P(0, 0)]});
 h.commands.BLOCKLIB();await h.apply({category: 'symbol'});await h.apply({item: 'north'});
 assert.equal(h.field('diameter').value, 750);
 await assert.rejects(h.apply({diameter: 'abc'}), /숫자/);
 assert.equal(await h.apply({repeat: false}), 1);
 assert.equal(h.engine.doc.entities[0].name, '기호-방위표');
 assert.ok(h.engine.doc.layers.some(l => l.name === 'A-SYM'));
});

function sourceDrawing() {
 const storage = memoryStorage({[LIBRARY_STORAGE_KEY]: JSON.stringify({'door-sym': [{id: 'x1', type: 'line', layer: 'old-layer', points: [P(0, 0), P(900, 0)]}, {id: 'x2', type: 'arc', layer: 'old-layer', center: P(0, 0), radius: 900, startAngle: 0, endAngle: 90}]})});
 const h = harness({storage});
 const [id] = h.engine.execute({type: 'addMany', entities: [libraryBlock('bed-queen', {width: 1600}, {position: P(3000, 1000), rotation: 90, layer: 'default'})]});
 h.selectedIds.add(id);
 return h;
}

test('LIBEXPORT → LIBIMPORT 왕복: 형식·버전 기록, id·레이어 제거, 기존 항목 보존, 이름 겹침은 새 이름', async () => {
 const src = sourceDrawing();
 src.commands.LIBEXPORT();
 assert.equal(src.field('library').value, true);assert.equal(src.field('selection').value, true);assert.equal(src.field('definitions').value, false);
 assert.match(src.field('fileName').value, /^블록라이브러리_\d{8}\.json$/);
 const result = await src.apply({title: '우리 사무실'});
 assert.equal(result.count, 2);
 const [download] = src.downloads;
 assert.equal(download.type, 'application/json');
 const file = JSON.parse(download.text);
 assert.equal(file.format, LIBRARY_FORMAT);assert.equal(file.version, LIBRARY_VERSION);assert.equal(file.title, '우리 사무실');
 assert.deepEqual(file.blocks.map(b => b.name).sort(), ['door-sym', '가구-퀸 침대']);
 const bed = file.blocks.find(b => b.name === '가구-퀸 침대');
 assert.equal(bed.category, '가구');assert.deepEqual(bed.basePoint, {x: 0, y: 0});
 assert.ok(!download.text.includes('"layer"') && !download.text.includes('"x1"'), '레이어 id·객체 id 는 파일에 없다');
 // 기준점(삽입점) 기준 좌표: 90° 돌린 1600×2000 침대 → x -2000..0, y 0..1600
 assertBox(G.bounds(bed.entities), {minX: -2000, minY: 0, maxX: 0, maxY: 1600}, '내보낸 침대');

 const existing = {keep: [{id: 'k', type: 'circle', layer: 'L', center: P(0, 0), radius: 5}], 'door-sym': [{type: 'line', layer: 'L', points: [P(0, 0), P(1, 1)]}]};
 const existingMeta = {keep: {category: '내 것'}};
 const storage = memoryStorage({[LIBRARY_STORAGE_KEY]: JSON.stringify(existing), [LIBRARY_META_KEY]: JSON.stringify(existingMeta)});
 const opened = [];
 const dst = harness({storage, openTextFile: async (accept) => { opened.push(accept); return {name: download.name, size: download.text.length, text: async () => download.text}; }});
 dst.commands.LIBIMPORT();
 assert.equal(dst.field('conflict').value, 'rename');
 const report = await dst.apply({});
 assert.match(opened[0], /\.json/);
 assert.deepEqual(report.added.sort(), ['door-sym (2)', '가구-퀸 침대']);
 assert.deepEqual(report.renamed, [{from: 'door-sym', to: 'door-sym (2)'}]);
 const library = JSON.parse(storage.getItem(LIBRARY_STORAGE_KEY));
 assert.deepEqual(library.keep, existing.keep, '기존 항목 그대로');
 assert.deepEqual(library['door-sym'], existing['door-sym'], '같은 이름의 기존 항목도 덮지 않음');
 assert.deepEqual(G.bounds(library['가구-퀸 침대']), G.bounds(bed.entities));
 const ids = [];const walk = (list) => { for (const e of list) { ids.push(e.id); if (e.entities) walk(e.entities); } };walk(library['가구-퀸 침대']);
 assert.ok(ids.every(id => typeof id === 'string' && id.length > 8));
 assert.equal(new Set(ids).size, ids.length, '새로 만든 id');
 const meta = JSON.parse(storage.getItem(LIBRARY_META_KEY));
 assert.deepEqual(meta.keep, existingMeta.keep);
 assert.equal(meta['가구-퀸 침대'].category, '가구');assert.equal(meta['가구-퀸 침대'].source, 'import');assert.equal(meta['가구-퀸 침대'].from, '우리 사무실');
 assert.match(dst.toasts.at(-1), /2개/);

 // 같은 파일을 다시: 건너뛰기면 아무것도 바뀌지 않는다
 const before = storage.getItem(LIBRARY_STORAGE_KEY);
 dst.commands.LIBIMPORT();
 assert.equal((await dst.apply({conflict: 'skip'})).added.length, 0);
 assert.equal(storage.getItem(LIBRARY_STORAGE_KEY), before);
 dst.commands.LIBIMPORT();
 assert.equal(dst.field('conflict').value, 'skip', '마지막 선택 기억');

 // 가져온 블록은 BLOCKLIB "내 라이브러리" 로 미리보기와 함께 넣는다
 dst.queue.push(P(10000, 0));
 dst.commands.BLOCKLIB();
 assert.ok(dst.field('category').options.some(([v, text]) => v === 'user' && /4개/.test(text)));
 await dst.apply({category: 'user'});
 assert.ok(dst.field('item').options.some(([v]) => v === 'user:가구-퀸 침대'));
 await dst.apply({item: 'user:가구-퀸 침대'});
 assert.deepEqual(dst.field('layer').options.map(([v]) => v), ['current']);
 assert.equal(await dst.apply({repeat: false, mirror: true}), 1);
 const inserted = dst.engine.doc.entities.at(-1);
 assert.equal(inserted.name, '가구-퀸 침대');assert.equal(inserted.attributes.libraryId, 'user:가구-퀸 침대');
 assertBox(G.bounds(inserted.entities), {minX: 10000, minY: 0, maxX: 12000, maxY: 1600}, '대칭 삽입');
 dst.engine.validate(dst.engine.doc);
});

test('가져온 블록은 기존 LIBRARY(이름으로 삽입)에서도 보인다', async () => {
 const src = sourceDrawing();
 src.commands.LIBEXPORT();await src.apply({});
 const storage = memoryStorage();
 const dst = harness({storage, openTextFile: async () => src.downloads[0].text});
 dst.commands.LIBIMPORT();await dst.apply({});
 const saved = globalThis.localStorage;
 globalThis.localStorage = storage;
 try {
  const engine = new DrawingEngine();let fields, apply;
  const context = {engine, execute: c => engine.execute(c), chosen: () => [], selected: () => new Set(), activeLayer: () => 'default', refresh() {}, toast() {}, getSettings: () => studioDefaults,
   field: (name, label, value, type, options) => ({name, label, value, type, options}), pointFields: () => [{name: 'x', value: 0}, {name: 'y', value: 0}], form: (t, f, a) => { fields = f; apply = a; },
   add: entities => engine.execute({type: 'addMany', entities: entities.map(e => ({layer: 'default', ...e}))}), change: changes => engine.execute({type: 'document.update', changes})};
  const studio = installWorkflows({context, handlers: {}});
  studio.handlers.LIBRARY();
  await apply({...Object.fromEntries(fields.map(f => [f.name, String(f.value ?? '')])), action: 'insert', name: '가구-퀸 침대', x: 500, y: 500});
  const block = engine.doc.entities[0];
  assert.equal(block.name, '가구-퀸 침대');
  assertBox(G.bounds(block.entities), {minX: -1500, minY: 500, maxX: 500, maxY: 2100}, 'LIBRARY 삽입');
  engine.validate(engine.doc);
 } finally { if (saved === undefined) delete globalThis.localStorage; else globalThis.localStorage = saved; }
});

test('가져오기 거부: JSON 아님·형식 다름·새 버전·크기 초과·블록/객체 수 초과 → 저장소 그대로', async () => {
 const good = JSON.stringify(buildLibraryFile([{name: 'a', entities: [{type: 'line', points: [P(0, 0), P(10, 0)]}]}]));
 assert.equal(parseLibraryFile(good).blocks.length, 1);
 assert.throws(() => parseLibraryFile('{not json'), /JSON/);
 assert.throws(() => parseLibraryFile(JSON.stringify({format: 'other', version: 1, blocks: []})), /블록 라이브러리 파일이 아닙니다/);
 assert.throws(() => parseLibraryFile(JSON.stringify([1, 2])), /블록 라이브러리 파일이 아닙니다/);
 assert.throws(() => parseLibraryFile(good.replace('"version":1', '"version":2')), /새로운 형식\(v2\)/);
 assert.throws(() => parseLibraryFile(good.replace('"version":1', '"version":"1"')), /버전/);
 assert.throws(() => parseLibraryFile(JSON.stringify({format: LIBRARY_FORMAT, version: 1, blocks: []})), /블록이 없습니다/);
 assert.throws(() => parseLibraryFile(good + ' '.repeat(LIBRARY_LIMITS.maxBytes)), /너무 큽니다/);
 assert.throws(() => parseLibraryFile(good, {limits: {...LIBRARY_LIMITS, maxBytes: 50}}), /너무 큽니다/);
 const many = JSON.stringify({format: LIBRARY_FORMAT, version: 1, blocks: Array.from({length: 3}, (_, i) => ({name: 'b' + i, entities: [{type: 'point', position: P(i, 0)}]}))});
 assert.throws(() => parseLibraryFile(many, {limits: {...LIBRARY_LIMITS, maxBlocks: 2}}), /블록이 너무 많습니다/);
 assert.throws(() => parseLibraryFile(many, {limits: {...LIBRARY_LIMITS, maxTotalEntities: 2}}), /전체 객체/);

 const storage = memoryStorage({[LIBRARY_STORAGE_KEY]: JSON.stringify({keep: [{type: 'point', layer: 'x', position: P(0, 0)}]})});
 const before = storage.getItem(LIBRARY_STORAGE_KEY);
 for (const text of ['{not json', JSON.stringify({format: 'x'}), good.replace('"version":1', '"version":9')]) {
  const h = harness({storage, openTextFile: async () => ({name: 'f.json', size: text.length, text: async () => text})});
  h.commands.LIBIMPORT();
  await assert.rejects(h.apply({}));
  assert.equal(storage.getItem(LIBRARY_STORAGE_KEY), before);
 }
 // 파일 크기는 읽기 전에 막는다
 let read = false;
 const big = harness({storage, openTextFile: async () => ({name: 'big.json', size: LIBRARY_LIMITS.maxBytes + 1, text: async () => { read = true; return good; }})});
 big.commands.LIBIMPORT();
 await assert.rejects(big.apply({}), /너무 큽니다/);
 assert.equal(read, false);
 assert.equal(storage.getItem(LIBRARY_STORAGE_KEY), before);
 // 취소는 조용히
 const cancel = harness({storage, openTextFile: async () => null});
 cancel.commands.LIBIMPORT();
 assert.equal(await cancel.apply({}), null);
 assert.match(cancel.toasts.at(-1), /취소/);
});

test('가져오기 검사: 벽·잘못된 도형 블록은 이유와 함께 건너뛰고, 연결 정보·위험한 키는 지운다', () => {
 const file = {format: LIBRARY_FORMAT, version: 1, blocks: [
  {name: 'ok', entities: [{type: 'line', hostWall: 'w1', xref: {path: 'C:/secret.dwg'}, parameters: {kind: 'DOOR'}, layer: 'zz', id: 'dup', points: [P(0, 0), P(100, 0)]},
   {type: 'block', name: 'inner', sharedBlock: 'S1', category: 'DOOR', entities: [{type: 'circle', center: P(0, 0), radius: 10}]}]},
  {name: 'wall', entities: [{type: 'wall', points: [P(0, 0), P(100, 0)], thickness: 200}]},
  {name: 'bad-circle', entities: [{type: 'circle', center: P(0, 0), radius: -5}]},
  {name: 'empty', entities: []},
  {name: '__proto__', entities: [{type: 'point', position: P(0, 0)}]},
  {name: 'deep', entities: [Array.from({length: 12}).reduce((inner) => ({type: 'block', name: 'n', entities: [inner]}), {type: 'point', position: P(0, 0)})]},
 ]};
 const text = JSON.stringify(file).replace('"id":"dup"', '"id":"dup","__proto__":{"polluted":true},"constructor":{"prototype":{"hacked":1}}');
 assert.ok(text.includes('"__proto__":{"polluted":true}'), '악성 키가 실제로 파일 안에 있다');
 const result = parseLibraryFile(text);
 assert.deepEqual(result.blocks.map(b => b.name), ['ok']);
 assert.deepEqual(result.skipped.map(s => s.name), ['wall', 'bad-circle', 'empty', '__proto__', 'deep']);
 assert.match(result.skipped[0].reason, /가져올 수 없는 객체 종류/);
 assert.match(result.skipped[1].reason, /반지름/);
 assert.match(result.skipped[4].reason, /중첩/);
 const [line, inner] = result.blocks[0].entities;
 for (const key of ['hostWall', 'xref', 'parameters', 'layer']) assert.ok(!(key in line), key);
 assert.notEqual(line.id, 'dup');
 assert.ok(!('sharedBlock' in inner) && !('category' in inner));
 assert.equal({}.polluted, undefined);assert.equal({}.hacked, undefined);
 assert.equal(Object.getPrototypeOf(line), Object.prototype);
 assert.ok(!Object.prototype.hasOwnProperty.call(line, '__proto__') && !Object.prototype.hasOwnProperty.call(line, 'constructor'));
 assert.equal(line.polluted, undefined);
 assert.throws(() => parseLibraryFile(JSON.stringify({format: LIBRARY_FORMAT, version: 1, blocks: [file.blocks[1]]})), /가져올 수 있는 블록이 없습니다.*wall/);
});

test('기존 LIBRARY 보호: 손상된 저장값은 덮지 않고, 저장 공간 부족이면 그대로 둔다', () => {
 const good = JSON.stringify(buildLibraryFile([{name: 'a', entities: [{type: 'line', points: [P(0, 0), P(10, 0)]}]}]));
 const broken = memoryStorage({[LIBRARY_STORAGE_KEY]: '{broken'});
 assert.throws(() => importLibraryText(broken, good), /기존 내 라이브러리/);
 assert.equal(broken.getItem(LIBRARY_STORAGE_KEY), '{broken');
 assert.equal(readLibraryStore(broken).ok, false);
 const full = memoryStorage({[LIBRARY_STORAGE_KEY]: JSON.stringify({keep: []})});
 full.setItem = () => { throw Object.assign(Error('QuotaExceededError'), {name: 'QuotaExceededError'}); };
 assert.throws(() => importLibraryText(full, good), /저장 공간/);
 assert.equal(full.getItem(LIBRARY_STORAGE_KEY), JSON.stringify({keep: []}));
 const fresh = memoryStorage();
 const report = importLibraryText(fresh, good, {reserved: ['a']});
 assert.deepEqual(report.added, ['a (2)'], '도면에만 있는 LIBRARY 이름도 피한다');
});

test('mergeLibrary: 이름 겹침 rename/skip, 파일 안 중복도 처리, 원본 객체는 바꾸지 않음', () => {
 const library = Object.freeze({문: [1], '문 (2)': [2]}), meta = Object.freeze({});
 const blocks = [{name: '문', entities: [3]}, {name: '문', entities: [4]}, {name: '창', entities: [5]}];
 const renamed = mergeLibrary(library, meta, blocks, {conflict: 'rename'});
 assert.deepEqual(renamed.added, ['문 (3)', '문 (4)', '창']);
 assert.deepEqual(renamed.library['문'], [1]);
 const skipped = mergeLibrary(library, meta, blocks, {conflict: 'skip'});
 assert.deepEqual(skipped.added, ['창']);
 assert.equal(skipped.skipped.length, 2);
 assert.deepEqual(Object.keys(library), ['문', '문 (2)']);
 assert.equal(cleanBlockName('  a\n\tb  '), 'a b');
 assert.equal(cleanBlockName('constructor'), '');
});

test('collectExportBlocks: 이름 거르기, 같은 이름·다른 모양은 번호, 같은 모양은 한 번, 도면 블록 정의', () => {
 const line = (len) => [{type: 'line', layer: 'L', points: [P(0, 0), P(len, 0)]}];
 const selection = [
  {type: 'block', name: '의자', layer: 'L', position: P(100, 0), entities: line(200).map(e => G.translate(e, 100, 0))},
  {type: 'block', name: '의자', layer: 'L', position: P(500, 0), entities: line(200).map(e => G.translate(e, 500, 0))},
  {type: 'block', name: '의자', layer: 'L', position: P(900, 0), entities: line(300).map(e => G.translate(e, 900, 0))},
  {type: 'block', name: '표', table: {rows: [['a']], height: 1}, layer: 'L', entities: line(10)},
 ];
 const out = collectExportBlocks({selection, definitions: [{name: '정의', entities: line(50)}], include: {selection: true, definitions: true}});
 assert.deepEqual(out.map(b => b.name), ['의자', '의자 (2)', '정의']);
 assertBox(G.bounds(out[1].entities), {minX: 0, minY: 0, maxX: 300, maxY: 0}, '삽입점 기준');
 assert.deepEqual(collectExportBlocks({selection, definitions: [{name: '정의', entities: line(50)}], include: {selection: true, definitions: true}, filter: '정, 없음'}).map(b => b.name), ['정의']);
});

test('파일 저장·열기 연결이 없으면 알기 쉬운 오류', async () => {
 const src = sourceDrawing();
 const noSave = harness({storage: src.ctx.storage, downloadText: null});
 noSave.commands.LIBEXPORT();
 await assert.rejects(noSave.apply({}), /파일 저장 기능/);
 const noOpen = harness();
 noOpen.commands.LIBIMPORT();
 await assert.rejects(noOpen.apply({}), /파일을 고를 수 있는 화면이 없습니다/);
 const empty = harness();
 assert.throws(() => empty.commands.LIBEXPORT(), /내보낼 블록이 없습니다/);
 empty.commands.BLOCKLIB();
 await assert.rejects(empty.apply({category: 'user'}), /내 라이브러리가 비어 있습니다/);
});

test('폼에서 꺼진 체크박스(키 없음)는 꺼짐으로 읽는다', async () => {
 const h = harness({picks: [P(0, 0)]});
 h.commands.BLOCKLIB();await h.apply({category: 'kitchen'});await h.apply({item: 'sink-straight'});
 assert.equal(h.field('upper').value, true);
 const f = h.form, values = Object.fromEntries(f.fields.map(x => [x.name, x.value]));
 delete values.upper;delete values.mirror;delete values.repeat;   // FormData 처럼
 assert.equal(await f.onApply(values), 1);
 assert.ok(!G.primitives(h.engine.doc.entities[0]).some(e => e.linetype === 'HIDDEN'), '상부장 점선 없음');
 assert.equal(h.engine.doc.entities[0].attributes.upper, false);
});
