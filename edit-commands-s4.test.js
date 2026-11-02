import test from 'node:test';
import assert from 'node:assert/strict';
import * as G from './geometry.js';
import * as C from './curve-edit.js';
import * as S from './edit-commands-s4.js';
import {DrawingEngine} from './engine.js';

const p = (x, y) => ({x, y});
const close = (a, b, tol = 1e-6) => assert.ok(Math.abs(a - b) <= tol, `${a} != ${b}`);

test('설정(시스템 변수): 기본값·바꾸기·잘못된 값 거절·저장소', () => {
 const mem = new Map(), storage = {getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v)};
 S.useEditVarStore(storage);
 assert.equal(S.editVar('TRIMEXTENDMODE'), undefined); assert.equal(S.editVar('MIRRTEXT'), 0); assert.equal(S.editVar('ARRAYASSOCIATIVITY'), 1);
 S.setEditVar('OFFSETGAPTYPE', 2); assert.equal(S.editVar('OFFSETGAPTYPE'), 2);
 assert.match(mem.get('barun-cad-edit-vars'), /OFFSETGAPTYPE/);
 assert.throws(() => S.setEditVar('OFFSETGAPTYPE', 7)); assert.throws(() => S.setEditVar('NOPE', 1));
 S.useEditVarStore(storage); assert.equal(S.editVar('OFFSETGAPTYPE'), 2, '다시 읽어도 기억');
 S.setEditVar('OFFSETGAPTYPE', 0); S.useEditVarStore(null);
 assert.equal(S.islandModeOf(1), 'outer');
});

test('401 빠른 TRIM 경계 후보: 대상 상자(연장은 화면까지)와 겹치는 것만', () => {
 const target = {id: 't', type: 'line', points: [p(0, 0), p(100, 0)]};
 assert.deepEqual(S.quickBoundaryBox(target, 'trim', {minX: -1000, minY: -1000, maxX: 1000, maxY: 1000}), {minX: 0, minY: 0, maxX: 100, maxY: 0});
 assert.deepEqual(S.quickBoundaryBox(target, 'extend', {minX: -1000, minY: -10, maxX: 1000, maxY: 10}), {minX: -1000, minY: -10, maxX: 1000, maxY: 10});
 const ids = S.quickBoundaryIds([target, {id: 'a', layer: 'L'}, {id: 'b', layer: 'off'}, {id: 'c', layer: 'L', hidden: true}], target, new Set(['off']));
 assert.deepEqual(ids, ['a']);
 // 색인으로 줄인 후보만 넘겨도 엔진 결과는 전체를 넘길 때와 같다.
 const e = new DrawingEngine();
 const [t, cut] = e.execute({type: 'addMany', entities: [{type: 'line', layer: 'default', points: [p(0, 0), p(100, 0)]}, {type: 'line', layer: 'default', points: [p(50, -10), p(50, 10)]}]});
 const index = G.spatialIndex(e.doc.entities), mine = e.doc.entities.find((x) => x.id === t);
 const boundaryIds = S.quickBoundaryIds(index.query(S.quickBoundaryBox(mine, 'trim')), mine);
 assert.deepEqual(boundaryIds, [cut]);
 e.execute({type: 'trim', id: t, boundaryIds, pick: p(80, 0)});
 assert.ok(e.doc.entities.some((x) => x.type === 'line' && x.points[1].x === 50));
});

test('409 타원 호(A)·스플라인 맞춤점: 그립으로 맞춤점을 옮기면 곡선을 다시 만든다', () => {
 const el = {type: 'ellipse', layer: 'default', center: p(0, 0), majorAxis: p(100, 0), ratio: 0.5};
 const arc = S.ellipseArc(el, 0, 90);
 close(arc.startParam, 0); close(arc.endParam, Math.PI / 2);
 close(S.ellipseAngleOfPoint(el, p(0, 50)), 90);
 const sp = S.splineEntity([p(0, 0), p(100, 50), p(200, 0)]);
 assert.equal(sp.points.length, 33); assert.ok(G.splineMatches(sp));
 const grips = G.editingGrips(sp);
 assert.equal(grips.length, 3); assert.equal(grips[1].kind, 'fit');
 const cmd = G.gripCommand({...sp, id: 's'}, grips[1], p(100, 80));
 assert.equal(cmd.type, 'update'); assert.equal(cmd.changes.spline.fitPoints[1].y, 80);
 // 이동·대칭은 맞춤점도 같이 옮긴다.
 const moved = G.translate(sp, 10, 0);
 assert.equal(moved.spline.fitPoints[0].x, 10); assert.ok(G.splineMatches(moved));
 // 다른 편집으로 점이 바뀌면 맞춤점 그립 대신 꼭짓점 그립.
 assert.equal(G.editingGrips({...sp, points: sp.points.slice(1)})[0].kind, 'vertex');
});

test('410 REVCLOUD: 현마다 바깥으로 볼록한 정확한 호(호 구간 표시), 호 길이 기본은 화면 크기에 맞춤', () => {
 assert.equal(S.defaultCloudArc({minX: 0, minY: 0, maxX: 40000, maxY: 1}), 1000);
 assert.equal(S.defaultCloudArc({minX: 0, minY: 0, maxX: 2000, maxY: 1}), 50);
 const cloud = S.cloudFromRing(G.rectangle(p(0, 0), p(1000, 500)), 250);
 assert.equal(cloud.closed, true); assert.deepEqual(cloud.revcloud, {arc: 250, style: 'normal'});
 const parts = C.pathParts(cloud);
 assert.equal(parts.length, 12); assert.ok(parts.every((s) => s.kind === 'arc'));
 for (const s of parts) { const mid = G.add(s.center, G.polar(s.radius, s.startAngle + s.sweepDeg / 2)); assert.ok(!(mid.x > 1e-6 && mid.x < 1000 - 1e-6 && mid.y > 1e-6 && mid.y < 500 - 1e-6), '호가 사각형 바깥으로 볼록'); }
 assert.throws(() => S.cloudFromRing([p(0, 0), p(1, 0), p(1, 1)], 0));
 const f = S.freehandStep([p(0, 0)], p(5, 0), 10); assert.equal(f.points.length, 1);
 assert.equal(S.freehandStep([p(0, 0)], p(15, 0), 10).points.length, 2);
});

test('411 WIPEOUT: 바탕색 채움 해치 한 종류, 엔진 검사 통과, 테두리 값', () => {
 const w = S.wipeoutEntity([p(0, 0), p(100, 0), p(100, 100), p(0, 100), p(0, 0)], 'default', 2);
 assert.equal(w.points.length, 4); assert.equal(w.wipeout, true); assert.equal(w.solid, true); assert.equal(w.frame, 2);
 const e = new DrawingEngine();
 e.execute({type: 'add', entity: {...w, id: 'w'}});
 assert.equal(G.hatchContains(e.doc.entities[0], p(50, 50)), true, '안을 클릭하면 잡힌다');
 assert.throws(() => S.wipeoutEntity([p(0, 0), p(1, 0)], 'default'), /세 점/);
});

test('412 BOUNDARY 경계 집합: 화면 후보를 꺾은선으로(꺼진 레이어·문자 제외, 원은 0.5mm 처짐), 범위에 걸치면 넓힘', () => {
 const paths = S.boundaryPaths([
  {type: 'line', layer: 'A', points: [p(0, 0), p(10, 0)]},
  {type: 'line', layer: 'OFF', points: [p(0, 0), p(0, 10)]},
  {type: 'text', layer: 'A', position: p(0, 0), text: 'x', height: 1},
  {type: 'circle', layer: 'A', center: p(0, 0), radius: 1000},
  {type: 'block', layer: 'A', entities: [{type: 'polyline', closed: true, points: G.rectangle(p(0, 0), p(5, 5))}]},
 ], {hiddenLayers: new Set(['OFF'])});
 assert.equal(paths.length, 3);
 assert.ok(paths[1].length > 50, '원은 잘게');
 assert.equal(paths[2].length, 5, '닫힌 폴리선은 첫 점으로 돌아온다');
 assert.equal(S.boundaryInside({points: G.rectangle(p(1, 1), p(2, 2))}, {minX: 0, minY: 0, maxX: 3, maxY: 3}), true);
 assert.equal(S.boundaryInside({points: G.rectangle(p(1, 1), p(5, 2))}, {minX: 0, minY: 0, maxX: 3, maxY: 3}), false);
 assert.deepEqual(S.growBox({minX: 0, minY: 0, maxX: 10, maxY: 10}, 2), {minX: -5, minY: -5, maxX: 15, maxY: 15});
 assert.throws(() => S.boundaryPaths([{type: 'line', layer: 'A', points: [p(0, 0), p(1, 0)]}], {limit: 1}), /너무 많습니다/);
});

test('417 MIRROR: 기본(MIRRTEXT 0)은 문자를 읽히는 방향으로, 1 이면 예전처럼 거울 글자', () => {
 const e = new DrawingEngine();
 e.execute({type: 'add', entity: {id: 't', type: 'text', layer: 'default', text: 'AB', height: 100, position: p(0, 0), rotation: 0}});
 const [copy] = e.execute({type: 'mirror', ids: ['t'], a: p(10, 0), b: p(10, 1)});
 const m = e.doc.entities.find((x) => x.id === copy);
 assert.equal(m.rotation, 0, '거꾸로 서지 않는다');
 close(m.position.x, 20 - G.textLineUnits('AB') * 100); close(m.position.y, 0);
 const [legacy] = e.execute({type: 'mirror', ids: ['t'], a: p(10, 0), b: p(10, 1), mirrText: 1});
 assert.equal(e.doc.entities.find((x) => x.id === legacy).rotation, 180);
 // 가로축 대칭: 기준선이 대칭 자리로, 방향은 그대로(오른쪽 정렬은 오른쪽 끝을 지킨다).
 e.execute({type: 'add', entity: {id: 'r', type: 'text', layer: 'default', text: 'AB', height: 100, position: p(500, 0), rotation: 0, align: 'right'}});
 const [down] = e.execute({type: 'mirror', ids: ['r'], a: p(0, -10), b: p(1, -10)});
 const d = e.doc.entities.find((x) => x.id === down);
 assert.deepEqual([d.position.x, d.position.y, d.rotation], [500, -20, 0]);
});

test('418 DIVIDE/MEASURE: 타원도 따라 걷고 B 옵션은 진행 방향으로 돈 블록 batch', () => {
 const el = {type: 'ellipse', center: p(0, 0), majorAxis: p(100, 0), ratio: 1};
 const plan = S.divideMeasurePlan(el, 'DIVIDE', '4');
 assert.equal(plan.length, 3); close(plan[1].point.x, -100, 1e-2);
 const cmd = S.divideBlockCommand(plan, 'B1', true, 'default');
 assert.equal(cmd.type, 'batch'); assert.equal(cmd.commands.length, 3); assert.equal(cmd.commands[0].type, 'block.insert');
 assert.ok(Math.abs(G.normalizeAngle(cmd.commands[0].angle) - 180) < 2, '원 위 90° 자리의 진행 방향은 180°');
 assert.equal(S.divideBlockCommand(plan, 'B1', false, 'default').commands[0].angle, 0);
 assert.throws(() => S.divideMeasurePlan({type: 'line', points: [p(0, 0), p(10, 0)]}, 'MEASURE', '100'), /찍을 점이 없습니다/);
 const e = new DrawingEngine();
 e.execute({type: 'add', entity: {id: 'x', type: 'point', layer: 'default', position: p(0, 0)}});
 e.execute({type: 'block.create', ids: ['x'], name: 'B1', base: p(0, 0), mode: 'retain'});
 e.execute(cmd);
 assert.equal(e.doc.entities.filter((x) => x.type === 'block').length, 3);
});

test('421 MATCHPROP 설정(S): 켠 항목만, 문자↔여러 줄 문자·폴리선 폭', () => {
 const src = {type: 'text', layer: 'L1', color: '#ff0000', height: 300, style: 'S1'};
 assert.deepEqual(S.matchChangesFor(src, {type: 'mtext'}, ['layer', 'text']), {layer: 'L1', height: 300, style: 'S1'});
 const all = S.matchChangesFor(src, {type: 'line'});
 assert.equal(all.color, '#ff0000'); assert.equal(all.height, undefined, '선에는 문자 특성을 옮기지 않는다');
 assert.equal(all.linetype, null, '원본이 ByLayer 면 대상도 ByLayer');
 assert.deepEqual(S.matchChangesFor({type: 'polyline', layer: 'A', constantWidth: 50}, {type: 'polyline'}, ['polyline']), {constantWidth: 50});
 assert.match(S.matchSettingsLine(['color', 'layer']), /현재 설정: 색 레이어/);
});

test('422 클립보드: 쓰는 레이어만, 글 요약, 붙여넣기 선택지', async () => {
 const layers = [{id: 'a', name: 'A'}, {id: 'b', name: 'B'}, {id: 'c', name: 'C'}];
 const entities = [{type: 'line', layer: 'a', points: [p(0, 0), p(10, 0)]}, {type: 'block', layer: 'b', entities: [{type: 'circle', layer: 'c', center: p(0, 0), radius: 1}]}];
 assert.deepEqual(S.usedLayers(entities, layers).map((l) => l.id), ['a', 'b', 'c']);
 assert.deepEqual(S.usedLayers([entities[0]], layers).map((l) => l.id), ['a']);
 assert.match(S.clipboardText({entities}), /바른 CAD 객체 2개/);
 assert.deepEqual(S.pasteSpecialChoices({cad: {entities: []}, text: 'x', image: null}).map(([k]) => k), ['cad', 'block', 'text']);
 assert.equal(await S.writeSystemClipboard({entities, base: p(0, 0)}), false, '클립보드가 없는 곳에서는 예전 앱 안 클립보드로');
 assert.equal(await S.selectionPng(entities), null);
});

test('425 FLATTEN: 열 때 눌러 없앤 높이를 종류별로 알려 준다', () => {
 const msg = S.flattenMessage({converted: {'폴리선 높이 → XY 평면': 3, 'CIRCLE 높이 → XY 평면': 2, 'SPLINE → 곡선 근사 폴리선 (분할 기준 0.1 mm)': 9}});
 assert.match(msg, /5개 객체의 높이/); assert.match(msg, /폴리선 높이 → XY 평면 3/);
 assert.match(S.flattenMessage(null), /누를 높이가 없습니다/);
 assert.equal(S.flattenSummary({converted: {'3D LINE → XY 평면': 4}}).total, 4);
});

test('카드 명령: 설정·FLATTEN·GEOMETRYCLEANUP·DELCONSTRAINT 가 ctx 로 동작한다', async () => {
 const e = new DrawingEngine(), toasts = [], forms = [];
 for (const x of [{id: 'a', type: 'line', layer: 'default', points: [p(0, 0), p(1000, 0)]}, {id: 'b', type: 'line', layer: 'default', points: [p(1000.5, 0), p(1000.5, 500)]}]) e.execute({type: 'add', entity: x});
 let selected = [];
 const ctx = {storage: null, entities: () => e.doc.entities, layers: () => e.doc.layers, doc: () => e.doc, selected: () => e.doc.entities.filter((x) => selected.includes(x.id)), selectedIds: () => selected,
  execute: (c) => e.execute(c), toast: (m) => toasts.push(m), log: () => {}, setSelected: (ids) => { selected = ids; }, activeLayer: () => 'default',
  form: (title, fields, apply) => { forms.push({title, fields}); apply(Object.fromEntries(fields.map((f) => [f.name, f.value]))); }};
 const cards = S.installEditCommandsS4(ctx);
 for (const name of ['LENGTHEN', 'WIPEOUT', 'CENTERMARK', 'CENTERLINE', 'ARRAYEDIT', 'AUTOCONSTRAIN', 'DELCONSTRAINT', 'GEOMETRYCLEANUP', 'PASTESPEC', 'FLATTEN', 'MIRRTEXT', 'JOINFUZZ']) assert.equal(typeof cards[name], 'function', name);
 S.rememberImportReport({converted: {'폴리선 높이 → XY 평면': 1}});
 cards.FLATTEN(); assert.match(toasts.at(-1), /1개 객체/);
 await cards.GEOMETRYCLEANUP();
 assert.deepEqual(e.doc.entities.find((x) => x.id === 'b').points[0], p(1000.25, 0), '틈을 가운데로 붙였다');
 selected = ['a', 'b'];
 await cards.AUTOCONSTRAIN(); assert.ok(e.doc.constraints.length >= 2);
 cards.DELCONSTRAINT(); assert.equal(e.doc.constraints.length, 0);
 await cards.MIRRTEXT(); assert.match(toasts.at(-1), /MIRRTEXT = 0/);
});
