// 특성 팔레트(Ctrl+1): 종류별 개수·거르기, 여러 값 *다양함*, 칸 하나 고치면 고른 객체 모두에 되돌리기 한 번, 많이 고르면 공통 항목만.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DrawingEngine} from './engine.js';
import {buildDockModel, countTypes, summaryText, filterOptions, filterByType, commonValue, currentFields, MIXED_LABEL, NO_SELECTION_LABEL} from './properties-dock.js';

const ctx = {layers: [['default', 'default'], ['L1', 'L1']], layerName: (id) => id, linetypes: [['BYLAYER', 'ByLayer'], ['DASHED', 'DASHED']], colorText: (e) => (e.colorMode === 'aci' ? String(e.aci) : e.color || 'BYLAYER')};
const line = (id, o = {}) => ({id, type: 'line', layer: 'default', points: [{x: 0, y: 0}, {x: 300, y: 400}], ...o});
const circle = (id, o = {}) => ({id, type: 'circle', layer: 'default', center: {x: 10, y: 20}, radius: 50, ...o});
const field = (m, name) => m.fields.find((f) => f.name === name);
const engineWith = (entities) => { const engine = new DrawingEngine(); engine.doc.entities.push(...entities); return engine; };
const run = (engine, commands) => engine.execute(commands.length === 1 ? commands[0] : {type: 'batch', commands});

test('종류별 개수와 거르기 목록', () => {
 const es = [line('a'), line('b'), line('c'), circle('d')];
 const counts = countTypes(es);
 assert.deepEqual(counts, [{type: 'line', count: 3}, {type: 'circle', count: 1}]);
 assert.equal(summaryText(counts), '선 3, 원 1');
 assert.deepEqual(filterOptions(counts).map(([v]) => v), ['all', 'line', 'circle']);
 assert.equal(filterOptions(counts)[0][1], '전체 (4)');
 assert.equal(filterByType(es, 'circle').length, 1);
 assert.equal(filterByType(es, 'all').length, 4);
 assert.equal(summaryText([]), NO_SELECTION_LABEL);
});

test('한 종류면 모양 항목, 여러 종류면 공통 항목만. 값이 다르면 *다양함*', () => {
 const one = buildDockModel([circle('c')], ctx);
 assert.equal(one.mode, 'full');
 for (const n of ['layer', 'color', 'linetype', 'linetypeScale', 'lineweight', 'radius', 'diameter', 'circleArea', 'x', 'y']) assert.ok(field(one, n), n);
 assert.equal(field(one, 'x').value, '10');
 const mixed = buildDockModel([line('a'), circle('c', {layer: 'L1', lineweight: 0.3})], ctx);
 assert.ok(!field(mixed, 'radius') && !field(mixed, 'lineLength'));
 assert.equal(field(mixed, 'layer').mixed, true);
 assert.equal(field(mixed, 'layer').placeholder, MIXED_LABEL);
 assert.equal(field(mixed, 'lineweight').mixed, true);
 assert.ok(field(mixed, 'lineweight').options.some(([v]) => v === ''), '여러 값에서도 ByLayer 를 고를 수 있다');
 assert.ok(!field(mixed, 'layer').options.some(([v]) => v === ''), "창의 '여러 값' 줄은 쓰지 않는다");
 const lines = buildDockModel([line('a'), line('b', {points: [{x: 0, y: 0}, {x: 100, y: 0}]})], ctx);
 assert.equal(field(lines, 'lineLength').mixed, true);
 const poly = buildDockModel([{id: 'p', type: 'polyline', layer: 'default', closed: true, points: [{x: 0, y: 0}, {x: 1000, y: 0}, {x: 1000, y: 1000}]}], ctx);
 assert.equal(field(poly, 'vertexCount').value, '3');
 assert.equal(field(poly, 'polyArea').value, '0.5');
 const dim = buildDockModel([{id: 'd', type: 'dimension', layer: 'default', points: [{x: 0, y: 0}, {x: 1000, y: 0}], textHeight: 150}], ctx);
 for (const n of ['measure', 'dimText', 'textHeight', 'arrowSize']) assert.ok(field(dim, n), n);
 const block = buildDockModel([{id: 'b', type: 'block', layer: 'default', name: 'DOOR', position: {x: 0, y: 0}, entities: [], scale: 2}], ctx);
 assert.ok(field(block, 'blockScale').readonly, '풀어 넣은 블록의 배율은 보기만');
 assert.ok(!field(buildDockModel([line('a')], ctx), 'transparency'), '투명도는 값이 있을 때만');
 assert.equal(field(buildDockModel([line('a', {transparency: 40})], ctx), 'transparency').value, '40');
});

test('칸 하나를 고치면 고른 객체 모두에 한 번에 적용되고 되돌리기 한 번', () => {
 const engine = engineWith([line('a'), line('b', {layer: 'L1'}), circle('c')]);
 engine.doc.layers.push({id: 'L1', name: 'L1', color: '#ffffff', visible: true});
 const es = () => engine.doc.entities.filter((e) => ['a', 'b', 'c'].includes(e.id));
 const color = buildDockModel(es(), ctx).commands('color', '1');
 assert.deepEqual(color.map((c) => c.type), ['update'], '스타일은 한 줄 update');
 run(engine, color);
 assert.ok(es().every((e) => e.aci === 1 && e.colorMode === 'aci'));
 // '여러 값'의 선굵기를 ByLayer(빈칸)로 고를 수 있다.
 run(engine, buildDockModel(es(), ctx).commands('lineweight', '0.3'));
 run(engine, buildDockModel(es(), ctx).commands('layer', 'L1'));
 assert.ok(es().every((e) => e.layer === 'L1' && e.lineweight === 0.3));
 const undoBefore = engine.undoStack.length;
 run(engine, buildDockModel(es(), ctx).commands('lineweight', ''));
 assert.ok(es().every((e) => e.lineweight == null));
 assert.equal(engine.undoStack.length, undoBefore + 1);
 engine.execute({type: 'undo'});
 assert.ok(es().every((e) => e.lineweight === 0.3), '되돌리기 한 번에 모두 돌아온다');
 // 걸러서 원만 고친다.
 const circles = filterByType(es(), 'circle');
 run(engine, buildDockModel(circles, ctx).commands('radius', '75'));
 assert.equal(engine.doc.entities.find((e) => e.id === 'c').radius, 75);
 // 한 객체의 위치는 이동으로.
 run(engine, buildDockModel([engine.doc.entities.find((e) => e.id === 'c')], ctx).commands('x', '110'));
 assert.equal(engine.doc.entities.find((e) => e.id === 'c').center.x, 110);
 // 보기만 하는 칸은 아무것도 만들지 않는다.
 assert.deepEqual(buildDockModel(circles, ctx).commands('diameter', '1'), []);
 assert.throws(() => buildDockModel(circles, ctx).commands('radius', '-1'));
});

test('많이 고르면(상한 초과) 공통 항목만, 첫 차이에서 멈춘다', () => {
 const es = Array.from({length: 30}, (_, i) => line('l' + i, i === 1 ? {layer: 'L1'} : {}));
 const fast = buildDockModel(es, ctx, {cap: 10});
 assert.equal(fast.mode, 'fast');
 assert.deepEqual(fast.fields.filter((f) => f.name).map((f) => f.name), ['layer', 'color', 'linetype', 'linetypeScale', 'lineweight']);
 assert.equal(field(fast, 'layer').mixed, true);
 assert.equal(field(fast, 'color').value, 'BYLAYER');
 assert.equal(commonValue(es, (e) => e.layer).scanned, 2, '두 번째에서 멈춘다');
 const [cmd] = fast.commands('linetype', 'DASHED');
 assert.equal(cmd.type, 'update'); assert.equal(cmd.ids.length, 30); assert.deepEqual(cmd.changes, {linetype: 'DASHED'});
 assert.deepEqual(fast.commands('linetype', 'BYLAYER')[0].changes, {linetype: null});
 assert.throws(() => fast.commands('linetypeScale', '0'));
});

test('아무것도 고르지 않으면 현재 레이어·현재 특성', () => {
 const fields = currentFields({color: {mode: 'aci', aci: 3, color: '#00ff00'}, linetype: 'DASHED', linetypeScale: null, lineweight: 0.25}, {...ctx, activeLayer: 'L1'});
 const v = Object.fromEntries(fields.filter((f) => f.name).map((f) => [f.name, f.value]));
 assert.deepEqual(v, {layer: 'L1', color: '3', linetype: 'DASHED', linetypeScale: '1', lineweight: '0.25'});
 assert.equal(currentFields({}, {...ctx, activeLayer: 'default'}).find((f) => f.name === 'color').value, 'BYLAYER');
});

test('앱 연결: PROPERTIES 토글 · Ctrl+1 · Esc 되돌림 · 선택 바뀔 때만 다시 계산 · 개발 서버 허용', () => {
 const app = readFileSync(new URL('./app.js', import.meta.url), 'utf8');
 assert.match(app, /import \{installPropertiesDock\} from '\.\/properties-dock\.js'/);
 assert.match(app, /if\(name==='PROPERTIES'&&typeof propertiesDock!=='undefined'&&propertiesDock\)\{[^}]*propertiesDock\.toggle\(\)/);
 assert.match(app, /propertiesDock\?\.escape\(e\.target\)/);
 assert.match(app, /function render\(\) \{\r?\n\s*if\(typeof propertiesDock!=='undefined'&&propertiesDock\)propertiesDock\.notify\(\);/);
 // 더블클릭(글자 제자리 편집·예전 편집 창)은 그대로.
 assert.match(app, /if\(hit\.type==='text'\)editTextInline\(hit\);/);
 assert.match(readFileSync(new URL('./server.py', import.meta.url), 'utf8'), /'\/properties-dock\.js'/);
});

// 2026-10-27 시안 '특성 창 주변 건물 높이': 주변 건물을 고르면 맨 위에 높이·층수·출처(보기만).
test('주변 건물을 고르면 맨 위에 높이·층수·출처, 실제/추정을 가르고 고칠 수 없다',()=>{
 const sq=[{x:0,y:0},{x:1000,y:0},{x:1000,y:1000},{x:0,y:1000}];
 const real={id:'r',type:'polyline',layer:'default',closed:true,points:sq,parcelRole:'building',model3d:{height:10900},attributes:{floors:3,heightM:10.9,heightSource:'건물 높이(GIS건물통합정보)',groundM:9.9,useCode:'04000',approvalYear:2008,totalAreaM2:333.4}};
 const est={id:'e',type:'polyline',layer:'default',closed:true,points:sq,parcelRole:'building',model3d:{height:23100},attributes:{floors:7,heightM:23.1,heightSource:'지상 7층 × 3.3m',name:'케이하우스',groundM:10}};
 const one=buildDockModel([real],ctx);assert.equal(one.fields[0].heading,'주변 건물 · 실제 높이');
 assert.equal(field(one,'siteBuildingHeight').value,'10.9 m');assert.equal(field(one,'siteBuildingSource').value,'GIS 건물통합정보');assert.equal(field(one,'siteBuildingFloors').value,'지상 3층');assert.equal(field(one,'siteBuildingUse').value,'제2종근린생활시설');
 assert.ok(one.fields.filter(f=>f.name?.startsWith('siteBuilding')).every(f=>f.readonly));assert.deepEqual(one.commands('siteBuildingHeight','99'),[]);
 const e1=buildDockModel([est],ctx);assert.equal(e1.fields[0].heading,'주변 건물 · 층수로 추정');assert.equal(field(e1,'siteBuildingSource').value,'지상 7층 × 3.3m');assert.equal(field(e1,'siteBuildingName').value,'케이하우스');
 const both=buildDockModel([real,est],ctx);assert.equal(field(both,'siteBuildingHeight').value,'10.9 m ~ 23.1 m · 2동');assert.equal(field(both,'siteBuildingSource').value,'실제 높이 1동 · 층수로 추정 1동');
 assert.equal(buildDockModel([real,line('a')],ctx).fields.some(f=>f.name?.startsWith('siteBuilding')),false,'다른 객체가 섞이면 안 보임');
 assert.equal(buildDockModel([line('a')],ctx).fields.some(f=>f.name?.startsWith('siteBuilding')),false);
});
