import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as G from './geometry.js';
import {DrawingEngine, newDrawingDocument} from './engine.js';
import {standardLayerForName} from './layer-standards.js';
import {structureScheduleEntities, structureScheduleLayout} from './structure-schedule.js';
import {structureDrawingEntities, structureSheets, applyStructureSet, STRUCTURE_LAYERS} from './structure-drawing.js';

// expect.cjs와 같은 시안 CORE만 평가한다. 서버·계정·설치본 계산 엔진 없이 표본을 만든다.
const prototype = readFileSync(new URL('./docs/structure/prototype.html', import.meta.url), 'utf8');
const core = prototype.split('/*CORE-START*/')[1].split('/*CORE-END*/')[0];
const generate = eval('(function(){' + core + ';return generate;})()');
const expected = readFileSync(new URL('./docs/structure/expected.jsonl', import.meta.url), 'utf8').trim().split('\n').map(JSON.parse);
const base = {system: 'rc', X: 10, Y: 9, stories: 2, H: 3.3, target: 6, roof: 'gable', pitch: 25, stairs: 'auto', stairW: 1,
  use: 'house', snow: 'normal', wind: 'normal', slope: 0, Fe: 150, soilOk: true, species: '다', grade: 2, openH: 2.1};
const cases = [
  ['rc', 'RC-10x9-2F-gable25', {}], ['steel', 'ST-10x9-flat', {system: 'steel', roof: 'flat'}], ['wood', 'WD-10x9-2F-H3.0', {system: 'wood', H: 3.0}],
];
const model = (changes = {}) => generate({...base, ...changes});
const options = {origin: {x: 23000, y: -7000}, setId: 'structure-schedule-1'};
const inside = (a, b) => a.minX >= b.minX - 1e-6 && a.minY >= b.minY - 1e-6 && a.maxX <= b.maxX + 1e-6 && a.maxY <= b.maxY + 1e-6;
const rowsOf = (sheet) => sheet.tables.flatMap((t) => t.rows);
const memberEntities = (entities, id) => entities.filter((e) => e.structureSet.member === id);
const textOf = (entities) => entities.filter((e) => e.type === 'text').map((e) => e.text).join('\n');

for (const [system, name, changes] of cases) test(system + ': 기대 부호·표 행·레이어·꼬리표·A3 범위', () => {
  const m = model(changes), before = structuredClone(m), sample = expected.find((e) => e.name === name);
  assert.equal(m.members.length, sample.members);
  const entities = structureScheduleEntities(m, options), sheet = structureScheduleLayout(m, options), rows = rowsOf(sheet);
  assert.ok(Array.isArray(entities)); assert.ok(entities.length > 0); assert.deepEqual(m, before);
  assert.deepEqual(rows.map((r) => r.code).sort(), Object.keys(sample.codes).sort());
  assert.equal(new Set(rows.map((r) => r.code)).size, rows.length);
  assert.deepEqual(rows.flatMap((r) => r.members).sort(), m.members.map((q) => q.id).sort());
  assert.equal(sheet.paper, 'A3'); assert.equal(sheet.scale, 50); assert.deepEqual(sheet.origin, options.origin);
  assert.equal((sheet.bounds.maxX - sheet.bounds.minX) / sheet.scale, 420);
  assert.equal((sheet.bounds.maxY - sheet.bounds.minY) / sheet.scale, 297);
  const ids = new Set(m.members.map((q) => q.id));
  for (const e of entities) {
    assert.equal(e.structureSet.id, options.setId); assert.ok(e.structureSet.member === null || ids.has(e.structureSet.member));
    assert.ok(STRUCTURE_LAYERS.includes(e.layer)); assert.equal(e.color, undefined);
    assert.ok(inside(G.bounds([e]), sheet.bounds), JSON.stringify(e));
    if (['text', 'line', 'circle'].includes(e.type)) assert.equal(e.layer, 'S-ANNO');
    if (e.type === 'text') assert.ok(e.height / sheet.scale >= 2.5);
  }
  for (const row of rows) {
    const actual = memberEntities(entities, row.members[0]);
    assert.equal(actual.filter((e) => e.type === 'text' && e.text === row.code).length, 1);
    assert.ok(actual.every((e) => inside(G.bounds([e]), row.bounds)), row.code + '의 객체가 행 안에 듦');
  }
  for (let i = 0; i < sheet.tables.length; i++) for (let j = i + 1; j < sheet.tables.length; j++) {
    const a = sheet.tables[i].bounds, b = sheet.tables[j].bounds;
    assert.ok(a.maxX <= b.minX || b.maxX <= a.minX || a.maxY <= b.minY || b.maxY <= a.minY, '표끼리 겹치지 않음');
  }
  if (system === 'rc') assert.deepEqual(Object.fromEntries(sheet.tables.map((t) => [t.kind, t.rows.length])), {beam: 6, column: 2, foundation: 2, slab: 2, wall: 3, strip: 1, stair: 2});
  else assert.ok(entities.every((e) => !['circle', 'polyline'].includes(e.type)), '단면 그림은 RC만');
});

test('보: 부호마다 단부·중앙 두 단면, 상·하 주열/부열 점 개수와 배근 문자', () => {
  const m = model(), entities = structureScheduleEntities(m, options), sheet = structureScheduleLayout(m, options);
  for (const row of sheet.tables.find((t) => t.kind === 'beam').rows) {
    const beam = m.members.find((q) => q.id === row.members[0]), es = memberEntities(entities, beam.id);
    const sections = es.filter((e) => e.layer === 'S-BEAM').sort((a, b) => G.bounds([a]).minX - G.bounds([b]).minX);
    assert.equal(sections.length, 2);
    sections.forEach((section, part) => {
      const b = G.bounds([section]), cy = (b.minY + b.maxY) / 2;
      assert.equal(b.maxX - b.minX, beam.b); assert.equal(b.maxY - b.minY, beam.h);
      const dots = es.filter((e) => e.type === 'circle' && inside(G.bounds([e]), b));
      const top = beam.bars.top1[part] + beam.bars.top2[part], bot = beam.bars.bot1[part] + beam.bars.bot2[part];
      assert.equal(dots.filter((e) => e.center.y > cy).length, top, beam.code + ' 상부');
      assert.equal(dots.filter((e) => e.center.y < cy).length, bot, beam.code + ' 하부');
      assert.equal(dots.filter((e) => Math.abs(e.center.y - (b.maxY - 40)) < 1e-6).length, beam.bars.top1[part]);
      assert.equal(dots.filter((e) => Math.abs(e.center.y - (b.maxY - 78)) < 1e-6).length, beam.bars.top2[part]);
      assert.ok(dots.every((e) => e.radius === 9.5));
      const labels = es.filter((e) => e.type === 'text' && e.position.x > b.maxX && (part === 1 || e.position.x < G.bounds([sections[1]]).minX));
      assert.ok(labels.some((e) => e.text === `상 ${top}-D19`));
      assert.ok(labels.some((e) => e.text === `하 ${bot}-D19`));
      assert.ok(labels.some((e) => e.text === `늑 D10@${beam.bars.st[part]}`));
      const ties = es.filter((e) => e.layer === 'S-ANNO' && e.type === 'polyline' && inside(G.bounds([e]), b));
      assert.equal(ties.length, 1);
    });
  }
});

test('기둥: 층별 부호·주근 점 수·띠철근·실제 단면 크기', () => {
  const m = model(), es = structureScheduleEntities(m, options), table = structureScheduleLayout(m, options).tables.find((t) => t.kind === 'column');
  for (const row of table.rows) {
    const col = m.members.find((q) => q.id === row.members[0]), out = memberEntities(es, col.id), [n, dia] = col.bars.match(/\d+/g).map(Number);
    const dots = out.filter((e) => e.type === 'circle'); assert.equal(dots.length, n); assert.ok(dots.every((e) => e.radius === dia / 2));
    assert.equal(new Set(dots.map((e) => `${e.center.x},${e.center.y}`)).size, n);
    const b = G.bounds(out.filter((e) => e.layer === 'S-COLS'));
    assert.equal(b.maxX - b.minX, col.b); assert.equal(b.maxY - b.minY, col.h);
    assert.match(textOf(out), new RegExp(col.level + '층')); assert.match(textOf(out), /띠 D10 단부@150\n중앙@300/);
    assert.equal(out.filter((e) => e.layer === 'S-ANNO' && e.type === 'polyline').length, 1);
  }
});

test('기초·벽·줄기초·계단: 치수와 모델 배근, 없는 슬래브·계단 값은 시안 가정 표시', () => {
  const m = model(), es = structureScheduleEntities(m, options);
  const first = (kind) => m.members.find((q) => q.kind === kind), text = (kind) => textOf(memberEntities(es, first(kind).id));
  const f = first('footing'); assert.ok(text('footing').includes(`${f.B * 1000}×${f.B * 1000}`)); assert.ok(text('footing').includes(f.bars));
  assert.ok(text('mat').includes('상 ' + first('mat').top)); assert.ok(text('mat').includes('하 ' + first('mat').bot));
  for (const kind of ['wall', 'stairWall']) {assert.ok(text(kind).includes(first(kind).vBar)); assert.ok(text(kind).includes(first(kind).hBar));}
  assert.ok(text('strip').includes(`${first('strip').w}×${first('strip').D}`)); assert.ok(text('strip').includes(first('strip').bars));
  assert.ok(text('slab').includes('D10@200 상·하 (가정)')); assert.ok(text('flight').includes('D13@150 (가정)'));
  assert.ok(text('landing').includes(first('landing').bars)); assert.ok(!text('landing').includes('가정'));
});

test('슬래브 형식 1~4와 모델에 제공된 배근을 그대로 표시하고 단변·장변 가정을 구별', () => {
  const m = {system: 'rc', members: [1, 2, 3, 4].map((form) => ({id: 'slab-' + form, code: 'S' + form, kind: 'slab', form, t: 150, bars: {short: 'D13@100', long: 'D10@150'}}))};
  const es = structureScheduleEntities(m, options), rows = rowsOf(structureScheduleLayout(m)); assert.equal(rows.length, 4);
  for (const q of m.members) {const s = textOf(memberEntities(es, q.id)); assert.ok(s.includes('D13@100')); assert.ok(s.includes('D10@150')); assert.ok(!s.includes('가정'));}
  delete m.members[0].bars.long;
  const out = textOf(memberEntities(structureScheduleEntities(m, options), 'slab-1'));
  assert.ok(out.includes('D13@100')); assert.ok(out.includes('D10@200 상·하 (가정)'));
});

test('철골: 같은 부호 한 행에서 주각·앵커의 일반/가새 변형을 빠뜨리지 않음', () => {
  const m = model({system: 'steel', roof: 'flat'}), es = structureScheduleEntities(m, options);
  const cols = m.members.filter((q) => q.kind === 'column');
  for (const code of new Set(cols.map((q) => q.code))) {
    const same = cols.filter((q) => q.code === code), text = textOf(memberEntities(es, same[0].id));
    for (const col of same) {assert.ok(text.includes(col.sec)); assert.ok(text.includes(col.base[0])); assert.ok(text.includes(col.base[1]));}
  }
});

test('목조: 스터드·장선·서까래·홀드다운 철물을 모델에서 표시', () => {
  const m = model({system: 'wood', H: 3.0}), es = structureScheduleEntities(m, options);
  for (const kind of ['woodWall', 'joists', 'rafters']) {
    const q = m.members.find((v) => v.kind === kind), text = textOf(memberEntities(es, q.id));
    assert.ok(text.includes(`${q.b}×${kind === 'woodWall' ? q.stud : q.h}@${q.sp}`));
  }
  const hw = m.members.find((q) => q.kind === 'hardware'); assert.ok(textOf(memberEntities(es, hw.id)).includes(`홀드다운 ${hw.holdDown}개`));
});

test('schedule 추가: 기존 시트와 기본값을 보존하고 맨 오른쪽에 한 장만 배치', () => {
  const m = model(), original = structureDrawingEntities(m, options), next = structureDrawingEntities(m, {...options, sheets: ['schedule', 'plan', 'foundation', 'schedule']});
  assert.deepEqual(structureSheets(m), ['foundation', 1, 2]); assert.deepEqual(structureSheets(m, ['schedule']), ['schedule']);
  assert.deepEqual(next.sheets.slice(0, 3), original.sheets); assert.deepEqual(next.entities.slice(0, original.entities.length), original.entities);
  const added = next.sheets.at(-1); assert.equal(added.sheet, 'schedule'); assert.ok(G.bounds(original.entities).maxX < added.bounds.minX);
  assert.deepEqual(next.entities.slice(original.entities.length), structureScheduleEntities(m, {origin: added.origin, setId: options.setId}));
  const only = structureDrawingEntities(m, {...options, sheets: ['schedule']}); assert.equal(only.sheets.length, 1); assert.deepEqual(only.sheets[0].origin, options.origin);
});

test('일람표 적용·재적용·잠금 거절·실행 취소: 표준 S-레이어와 다른 객체 보존', () => {
  const doc = newDrawingDocument(); doc.layers = doc.layers.filter((l) => !l.name.startsWith('S-'));
  doc.entities = [{id: 'keep', type: 'line', layer: doc.layers[0].id, points: [{x: -1000, y: 0}, {x: -900, y: 0}]}];
  const input = {id: options.setId, model: model(), drawn: {origin: options.origin, sheets: ['schedule']}};
  const r = applyStructureSet(doc, input); assert.equal(r.sheets[0].sheet, 'schedule'); assert.deepEqual(r.document.entities[0], doc.entities[0]);
  for (const layer of r.document.layers.filter((l) => l.name.startsWith('S-'))) {assert.ok(STRUCTURE_LAYERS.includes(layer.name)); assert.equal(layer.color, standardLayerForName(layer.name).color);}
  assert.ok(r.document.entities.every((e) => r.document.layers.some((l) => l.id === e.layer)));
  const next = applyStructureSet(r.document, input); assert.equal(next.removed, r.added.length); assert.equal(next.added.length, r.added.length);
  const engine = new DrawingEngine(); engine.execute({type: 'load', document: doc}); const before = structuredClone(engine.doc);
  engine.execute({type: 'lisp.apply', document: r.document}); engine.execute({type: 'undo'}); assert.deepEqual(engine.doc, before);
  r.document.layers.find((l) => l.name === 'S-ANNO').locked = true;
  assert.throws(() => applyStructureSet(r.document, input), /잠겨 있거나 얼어/);
});

test('입력 누락·배근 미제공·A3 초과를 조용히 잘못 그리지 않음', () => {
  assert.throws(() => structureScheduleEntities(null, options), /구조 모델/);
  assert.throws(() => structureScheduleEntities(model()), /setId/);
  assert.throws(() => structureScheduleLayout(model(), {origin: {x: NaN, y: 0}}), /origin/);
  assert.throws(() => structureScheduleEntities({members: [{kind: 'beam'}]}, options), /부호/);
  const beam = structuredClone(model().members.find((m) => m.kind === 'beam')); beam.bars = null;
  const es = structureScheduleEntities({system: 'rc', members: [beam]}, options); assert.equal(es.filter((e) => e.type === 'circle').length, 0); assert.match(textOf(es), /배근 미제공/);
  const many = {system: 'rc', members: Array.from({length: 40}, (_, i) => ({...beam, id: 'b' + i, code: 'G' + i}))};
  assert.throws(() => structureScheduleEntities(many, options), /A3 한 장/);
});

test('notes: KDS 원문 피복·정착·이음·갈고리의 값과 조건을 표로 출력',()=>{
 const source=readFileSync(new URL('./docs/structure/kds41/KDS_42_20_00_소규모건축_콘크리트구조.txt',import.meta.url),'utf8');
 const m=model(),r=structureDrawingEntities(m,{...options,sheets:['notes']}),sheet=r.sheets[0],text=textOf(r.entities).replace(/\n/g,'');
 assert.equal(sheet.sheet,'notes'); assert.equal(sheet.title,'구조일반주기'); assert.equal(sheet.paper,'A3');
 assert.deepEqual(sheet.tables.map(t=>t.kind),['cover','development','hooks']);
 for(const value of ['100 mm','80 mm','50 mm','40 mm','20 mm','45d_b','50d_b','35d_b','× 1.3','40d_b','25d_b','20d_b','150 mm','12d_b','2d_b','6d_b'])assert.ok(text.includes(value),value);
 for(const ref of ['4.1.1(1)','4.1.4.1(1)','4.1.4.1(2)','4.1.4.1(3)','4.1.4.1(4)','4.1.4.2(1)','4.1.4.3(1)'])assert.ok(text.includes(ref),ref);
 assert.ok(source.includes('D19 이하의 경우 철근 직경의 45배, D22의 경우 철근직경의 50배'));
 assert.ok(source.includes('슬래브, 벽체 및 계단의 철근은 철근 직경의 35배'));
 assert.ok(source.includes('기둥단면 최소치수의 1/2 이하이고 띠철근의 정착으로 90° 갈고리'));
 assert.ok(source.includes('용접이음은 사용할 수 없다'));
 for(const condition of ['D16 초과 D25 이하','기둥 최소치수/2','90° 갈고리','횡구속','용접이음 사용 불가','KS B 0802','KS D 0249'])assert.ok(text.includes(condition),condition);
 for(const e of r.entities){
  assert.ok(inside(G.bounds([e]),sheet.bounds),JSON.stringify(e));
  assert.equal(e.structureSet.id,options.setId); assert.equal(e.structureSet.member,null);
  for(const p of e.points||[e.position||e.center])if(p){assert.ok(Number.isFinite(p.x));assert.ok(Number.isFinite(p.y));}
 }
 for(let i=0;i<sheet.tables.length;i++)for(let j=i+1;j<sheet.tables.length;j++){
  const a=sheet.tables[i].bounds,b=sheet.tables[j].bounds;
  assert.ok(a.maxX<=b.minX||b.maxX<=a.minX||a.maxY<=b.minY||b.maxY<=a.minY);
 }
});

test('notes: schedule과 나란히 둘 때 용지 사이 겹침 없이 한 번 생성·적용·실행 취소',()=>{
 const m=model(),r=structureDrawingEntities(m,{...options,sheets:['schedule','notes','notes']});
 assert.deepEqual(r.sheets.map(s=>s.sheet),['schedule','notes']);
 assert.ok(r.sheets[0].bounds.maxX<r.sheets[1].bounds.minX);
 const doc=newDrawingDocument(),input={id:options.setId,model:m,drawn:{origin:options.origin,sheets:['notes']}};
 const applied=applyStructureSet(doc,input); assert.equal(applied.sheets[0].sheet,'notes');
 const engine=new DrawingEngine();engine.execute({type:'load',document:doc});const before=structuredClone(engine.doc);
 engine.execute({type:'lisp.apply',document:applied.document});engine.execute({type:'undo'});assert.deepEqual(engine.doc,before);
});


test('납품점검: 배근표·구조주기 1:50 도곽과 소속을 도면에 저장·재생성', async()=>{
 const {planDeliveryCheck}=await import('./delivery-check.js');
 const doc=newDrawingDocument(),other={id:'other-sheet',denominator:100,bounds:{minX:-50000,minY:-50000,maxX:-40000,maxY:-40000}};
 doc.sheets=[other];
 const input={id:options.setId,model:model(),drawn:{origin:options.origin,sheets:['schedule','notes']}};
 const r=applyStructureSet(doc,input),sheets=r.document.structureSets[input.id].sheetRecords;
 assert.equal(sheets.length,2);assert.ok(sheets.every(s=>s.denominator===50&&s.bounds));
 assert.deepEqual(r.document.sheets,[other]);
 assert.ok(r.document.entities.every(e=>!e.sheetId),'일반 도곽의 공간 소속 판정 유지');
 assert.equal(planDeliveryCheck(r.document,{denominator:100}).items.find(i=>i.key==='text').count,0);
 const {entitiesForSheet}=await import('./sheet-tools.js');
 assert.ok(entitiesForSheet(r.document,sheets[0]).length>0,'수동 도곽의 공간 소속 도구로 구조 객체도 찾음');
 const legacy=structuredClone(r.document);delete legacy.structureSets[input.id].sheetRecords;
 assert.equal(planDeliveryCheck(legacy,{denominator:100}).items.find(i=>i.key==='text').count,0,'이전 생성 도면의 배근표도 판정');
 const next=applyStructureSet(r.document,input);assert.equal(next.document.structureSets[input.id].sheetRecords.length,2);
 assert.deepEqual(next.document.structureSets[input.id].sheetRecords.map(s=>s.id),sheets.map(s=>s.id));
 const changed=applyStructureSet(next.document,{...input,drawn:{...input.drawn,sheets:['notes']}});
 assert.deepEqual(changed.document.sheets,[other]);assert.equal(changed.document.structureSets[input.id].sheetRecords.length,1);assert.equal(changed.document.structureSets[input.id].sheetRecords[0].sheet,'notes');
});


test('구조 시트를 제거하면 이전 기록의 도곽 축척도 제거',()=>{
 const input={id:options.setId,model:model(),drawn:{origin:options.origin,sheets:['schedule']}};
 const first=applyStructureSet(newDrawingDocument(),input);
 for(const drawn of [undefined,{origin:options.origin,sheets:['plan']}]){
  const saved={...first.document.structureSets[input.id],drawn},next=applyStructureSet(first.document,saved);
  assert.deepEqual(next.document.structureSets[input.id].sheetRecords||[],[]);
 }
});
import {createHash} from 'node:crypto';
import {CORE as scheduleCORE,input as midriseInput,columnMember as midriseColumn} from './test-fixtures/structure-calc-report.js';
import {midriseDrawingModel} from './test-fixtures/structure-drawing.js';
const legacyTables=JSON.parse(readFileSync(new URL('./tests/fixtures/structure-server-responses.json',import.meta.url),'utf8'));
test('기존 KDS 42 일람표·일반사항 JSON 바이트 회귀',()=>{
 const hashes={rc:'de5d079427ede244b07b42c519abf9de6d964f8c3b0d68a203112d5f73ca4dae',steel:'5686f06f2bdd92d3d3e6abe72260b1c92ba6ffee25e81d54618dc047113b2230',wood:'7ce3204fc6c08e6c34533507ef22ae05fc24175b3b4860789f1aa647a9d331ad'};
 for(const [system,hash] of Object.entries(hashes))assert.equal(createHash('sha256').update(JSON.stringify(structureDrawingEntities(legacyTables[system].model,{setId:'baseline',sheets:['schedule','notes']}))).digest('hex'),hash,system);
});
for(const [kind,n] of [['C',3],['A',5],['B',4]])test(n+'층 실제 부재: 층별 단면·주근·띠·벽·보·기초, 출처·A3·S 레이어',()=>{
 const m=midriseDrawingModel(kind),before=JSON.stringify(m),r=structureDrawingEntities(m,{...options,sheets:['schedule']}),sheets=r.sheets,rows=sheets.flatMap(rowsOf);
 assert.equal(JSON.stringify(m),before);
 const columns=sheets.flatMap(s=>s.tables.filter(t=>t.kind==='column').flatMap(t=>t.rows));assert.equal(columns.length,n);
 columns.forEach((row,i)=>{assert.equal(row.level,i+1);assert.equal(row.source,'사용자 지정');assert.equal(row.cells[3],(400+i*50)+'×'+(450+i*50));assert.equal(row.cells[4],'8-D22');assert.ok(row.cells[5].includes('D10@150'));});
 for(const s of sheets){
  assert.equal(s.paper,'A3');assert.deepEqual(s.paperSize,{width:420,height:297});assert.ok(s.tables.every(t=>inside(t.bounds,s.bounds)));
  for(const t of s.tables)for(const row of t.rows)assert.ok(inside(row.bounds,t.bounds));
 }
 const byKind=kind=>sheets.flatMap(s=>s.tables.filter(t=>t.kind===kind).flatMap(t=>t.rows));
 assert.equal(byKind('wall').length,n);assert.equal(byKind('beam').length,n);
 assert.deepEqual(byKind('wall')[0].cells.slice(3),['200','D13@200 (2면)','D13@200 (2면)']);
 assert.deepEqual(byKind('beam')[0].cells.slice(3),['300×600','4-D22','4-D22','D10@200']);
 assert.deepEqual(byKind('foundation')[0].cells,['F1','C1','사용자 지정','2400×2600×550','D16@150','D16@150']);
 for(const e of r.entities){assert.ok(STRUCTURE_LAYERS.includes(e.layer));assert.equal(e.structureSet.id,options.setId);
  assert.ok(sheets.some(s=>inside(G.bounds([e]),s.bounds)),e.text||e.type);if(e.type==='text')assert.equal(e.height/50,e.text==='배근도 · 부재 일람표'||['기둥 일람표','벽 배근표','보 일람표','기초 일람표'].includes(e.text)?4:2.5);}
 if(kind==='B')assert.ok(columns[0].cells[5].includes('필로티 · 9.8.4(6)~(9)'));
 assert.ok(rows.every(row=>row.cells.every(c=>!String(c).includes('undefined')&&!String(c).includes('NaN'))));
});
test('실제 설계 choice 4종은 제안·머리 경고, 사용자 입력을 변경하지 않음',()=>{
 const m=midriseDrawingModel('C',{proposal:true}),before=JSON.stringify(m),r=structureDrawingEntities(m,{...options,sheets:['schedule','notes']}),text=textOf(r.entities);
 assert.equal(JSON.stringify(m),before);
 for(const kind of ['column','wall','beam','foundation']){
  const rows=r.sheets.flatMap(s=>s.tables.filter(t=>t.kind===kind).flatMap(t=>t.rows));assert.ok(rows.length);
  assert.ok(rows.every(row=>row.source==='제안'),kind);
 }
 assert.ok(text.includes('제안 단면 포함 — 확인 전 시공 금지'));
 assert.ok(!text.includes('가정)'));assert.ok(!text.includes('KDS 42'));
 for(const s of r.sheets)assert.ok(r.entities.some(e=>e.text==='제안 단면 포함 — 확인 전 시공 금지'&&inside(G.bounds([e]),s.bounds)));
 const rows=r.sheets.flatMap(rowsOf),col=rows.find(row=>row.code==='C1');assert.equal(col.cells[3],'400×400');
 assert.equal(rows.find(row=>row.code==='F1').cells[3],'2400×2400×550');
});
test('누락 단면·배근·choice=null은 빈칸, 입력 후보·상태·다른 층 값으로 보충하지 않음',()=>{
 const m=midriseDrawingModel('A',{sections:false});
 m.p.members={beams:[{id:'B9',level:2,design:{bwCandidates:[777],hCandidates:[888]}}],walls:[{id:'W9',level:3,t:220}]};
 m.preliminary.memberResults.push({id:'B9',kind:'beam',level:2,proposal:true,data:{choice:null}});
 const r=structureDrawingEntities(m,{...options,sheets:['schedule']}),rows=r.sheets.flatMap(rowsOf),c=rows.filter(row=>row.code==='C1');
 assert.equal(c.length,5);assert.ok(c.every(row=>row.cells.slice(2).every(cell=>cell==='')));
 assert.deepEqual(rows.find(row=>row.code==='B9').cells,['B9','2','','','','','']);
 assert.deepEqual(rows.find(row=>row.code==='W9').cells,['W9','3','사용자 지정','220','','']);
 const text=textOf(r.entities);for(const value of ['undefined','NaN','D10@200','D19','777','888'])assert.ok(!text.includes(value),value);
});
test('필로티 9.8.4 간격은 부재 checks.capacity 그대로, 누락 시 숫자 빈칸',()=>{
 const p=midriseInput('C');p.structureType='pilotis-wall';p.floors[0].pilotis=true;
 p.members={columns:[midriseColumn({b:800,h:800,nx:7,ny:7,tieSpacing:75,firstTieTop:35,firstTieBottom:35,Ln:3000,hoops135:true,crossTies:{x:5,y:5},fullHeightConfinement:true,tieLegs:{x:7,y:7}})]};
 p.otherLoads.W=0;p.materials={Ec_MPa:30000,G_MPa:12500};
 p.pilotisDetails={coreCount:1,wallCountX:0,wallCountY:0,continuous:true,transferExists:true};
 p.lateralSystem={x:{systemKey:'rcWallBearingOrdinary'},y:{systemKey:'rcWallBearingOrdinary'}};
 p.floors.forEach(f=>f.columns=[[0,0],[10,0],[0,20],[10,20]].map(([x,y],i)=>({id:'C'+(i+1),x,y,liveUse:'상점 2층 이상'})));
 p.diaphragms.forEach(d=>Object.assign(d,{rigid:true,CM:{x:5,y:10}}));
 for(const dir of ['x','y'])p.irregularityEvidence[dir].strength=[10000,10000,10000];
 const column=p.members.columns[0];p.members.columns=[1,2,3,4].map(i=>{const c={...column,id:'C'+i};for(const k of ['Pu','Mux','Muy','Vu'])delete c[k];return c;});
 const reaction=()=>({D:100,L:20,Lr:0,S:0,R:0,F:0,T:0,W:0});
 p.loadPaths={reactions:Object.fromEntries([1,2,3,4].map(i=>['C'+i,{...reaction(),levels:[1,2,3].map(reaction)}]))};
 p.foundation={B:2,L:2};p.inputEvidence.members={source:'시험 부재',confirmed:true};p.inputEvidence.foundation={source:'시험 기초 입력',confirmed:true};
 const m=scheduleCORE.generate(p),result=m.preliminary.memberResults.find(r=>r.kind==='column'&&r.level===1),check=result.checks.find(c=>c.item==='필로티 횡보강 수직간격');
 assert.ok(check);assert.equal(check.capacity,200);
 const row=rowsOf(structureScheduleLayout(m)).find(r=>r.code==='C1'&&r.level===1);assert.ok(row.cells[5].includes('전 길이 간격 ≤ 200 mm'));
 result.checks=result.checks.filter(c=>c.item!=='필로티 횡보강 수직간격');
 const missing=rowsOf(structureScheduleLayout(m)).find(r=>r.code==='C1'&&r.level===1);assert.ok(missing.cells[5].includes('9.8.4'));assert.ok(!missing.cells[5].includes('≤'));
});
test('3~5층 일반사항: 저장소 KDS 41 판·개략 초안·책임구조기술자, KDS 42 수치 혼용 없음',()=>{
 const m=midriseDrawingModel('A'),r=structureDrawingEntities(m,{...options,sheets:['notes']}),text=textOf(r.entities).replaceAll('\n','');
 for(const value of ['KDS 41 10 05:2024','KDS 41 12 00:2022','KDS 41 17 00:2022','KDS 41 20 00:2024','개략 검토 초안','책임구조기술자 확인 필요','시공용 구조도면 아님'])assert.ok(text.includes(value),value);
 assert.ok(!text.includes('KDS 42'));assert.ok(!text.includes('45d_b'));
 assert.ok(r.entities.every(e=>inside(G.bounds([e]),r.sheets[0].bounds)));
});
test('많은 부재는 A3 여러 장에 머리글을 반복하고 행·시트를 누락하지 않음',()=>{
 const m=midriseDrawingModel('C');
 m.p.members={beams:Array.from({length:70},(_,i)=>({id:'EX'+i,kind:'beam',level:i%3+1,bw:300,h:600,top:{bar:'D22',count:4}}))};
 const r=structureDrawingEntities(m,{...options,sheets:['schedule','notes']}),schedules=r.sheets.filter(s=>s.sheet==='schedule');
 assert.ok(schedules.length>1);assert.equal(schedules[0].pageCount,schedules.length);
 assert.equal(schedules.flatMap(rowsOf).filter(row=>row.code.startsWith('EX')).length,70);
 schedules.forEach((s,i)=>{assert.equal(s.page,i+1);assert.equal(s.paper,'A3');if(i)assert.ok(schedules[i-1].bounds.maxX<s.bounds.minX);
  for(const t of s.tables)assert.ok(inside(t.bounds,s.bounds));});
 assert.equal(r.sheets.at(-1).sheet,'notes');
 for(const e of r.entities)assert.ok(r.sheets.some(s=>inside(G.bounds([e]),s.bounds)),e.text||e.type);
});

test('면별 기둥 주근 개수도 엔진 입력과 같은 모서리 중복을 제외해 표시',()=>{
 const m=midriseDrawingModel('C');for(const c of m.members){delete c.nx;delete c.ny;c.faces={top:3,bottom:4,left:3,right:4};}
 const rows=rowsOf(structureScheduleLayout(m)).filter(r=>r.code==='C1');assert.equal(rows.length,3);assert.ok(rows.every(r=>r.cells[4]==='10-D22'));
});

test('보는 CORE의 beams→flexure→층별 beams 첫 ID+층 입력과 미지정=1층 규칙을 따른다',()=>{
 const m=midriseDrawingModel('C');
 m.p.members={beams:[{...m.floors[0].beams[0],bw:500,h:700,y0:10,y1:10}],flexure:[{...m.floors[0].beams[0],bw:800,h:900}]};
 const actual=scheduleCORE.generate(m.p),r=structureDrawingEntities(actual,{...options,sheets:['schedule','plan']}),rows=r.sheets.filter(s=>s.sheet==='schedule').flatMap(rowsOf).filter(row=>row.code==='B1');
 assert.deepEqual(rows.map(row=>row.cells[3]),['500×700','300×600','300×600']);
 const es=r.entities.filter((e,i)=>r.entitySheets[i]===1),beam=es.find(e=>e.layer==='S-BEAM'&&e.type==='polyline'),b=G.bounds([beam]);
 assert.equal(b.maxY-b.minY,500);const column=es.find(e=>e.layer==='S-COLS'&&e.type==='polyline'),c=G.bounds([column]);
 assert.ok(Math.abs((b.minY+b.maxY-c.minY-c.maxY)/2-5000)<1e-6,'CORE가 선택한 y=10 보와 y=5 기둥 간격');
});
