// 해치 무늬(훈민캐드 대조 기반 3): 표준 무늬 172종, 예전 해치 호환, 이동·회전 때 무늬 따라가기, HATCHEDIT.
import test from 'node:test';
import assert from 'node:assert/strict';
import {DrawingEngine} from './engine.js';
import * as G from './geometry.js';
import {HATCH_PATTERN_LIBRARY, hatchFamilies, hatchSegments, hatchPatternFields, transformPattern, patternDefinition, hatchEditChanges, hatchPatternChoices, perpendicular} from './hatch-patterns.js';
import {plotSVG} from './plot.js';

const square = [{x: 0, y: 0}, {x: 1000, y: 0}, {x: 1000, y: 1000}, {x: 0, y: 1000}];
const near = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;

test('hatch hit testing respects interior loops while retaining outer and hole boundaries',()=>{
 const hatch={type:'hatch',points:square,loops:[[{x:250,y:250},{x:750,y:250},{x:750,y:750},{x:250,y:750}]]};
 assert.equal(G.entityDistance(hatch,{x:100,y:100}),0);
 assert.ok(G.entityDistance(hatch,{x:500,y:500})>0);
 assert.equal(G.entityDistance(hatch,{x:250,y:500}),0);
 assert.equal(G.entityDistance(hatch,{x:252,y:500}),2,'hole edges keep the normal pick aperture');
 assert.equal(G.entityDistance({type:'block',entities:[hatch]},{x:500,y:500},10),250);
 hatch.loops.push([{x:400,y:400},{x:600,y:400},{x:600,y:600},{x:400,y:600}]);
 assert.equal(G.entityDistance(hatch,{x:500,y:500}),0,'nested island is filled');
 assert.equal(G.entityDistance(hatch,{x:300,y:500}),50,'space between hole and island is empty');
});

test('표준 무늬 172종이 있고 목록은 자주 쓰는 건축 무늬를 먼저 보여 준다', () => {
 assert.equal(Object.keys(HATCH_PATTERN_LIBRARY).length, 172);
 for (const name of ['ANSI31', 'AR-CONC', 'AR-SAND', 'EARTH', 'INSUL', 'AR-BRSTD', 'GRAVEL']) assert.ok(patternDefinition(name), name);
 const values = hatchPatternChoices().map(([v]) => v);
 assert.deepEqual(values.slice(0, 5), ['lines', 'cross', 'solid', 'ANSI31', 'ANSI37']);
 assert.ok(values.includes('ACAD_ISO02W100'));
});

test('예전 바른 해치(사선·교차선)는 같은 선 위치로 읽힌다', () => {
 const lines = hatchFamilies({type: 'hatch', points: square, spacing: 100, angle: 0, pattern: 'lines'});
 assert.equal(lines.length, 1);
 assert.ok(near(lines[0].offset.x, 0) && near(lines[0].offset.y, 100));
 const cross = hatchFamilies({type: 'hatch', points: square, spacing: 100, angle: 0, pattern: 'cross'});
 assert.equal(cross.length, 2);
 const {segments} = hatchSegments(lines, {minX: 0, minY: 0, maxX: 1000, maxY: 1000});
 assert.deepEqual(segments.map(s => Math.round(s[1])), [0, 100, 200, 300, 400, 500, 600, 700, 800, 900, 1000]);
 assert.deepEqual(hatchFamilies({type: 'hatch', solid: true, points: square}), []);
});

test('표준 무늬 변환은 ezdxf 규칙(회전 후 축척)과 같고 대시·점을 만든다', () => {
 const lines = transformPattern(patternDefinition('ANSI31'), 10, 0);
 assert.ok(near(perpendicular(lines[0]), 31.75, 1e-3), '3.175 × 10');
 const rotated = transformPattern([[0, [1, 0], [0, 1], [2, -1]]], 2, 90);
 assert.ok(near(rotated[0].base.x, 0) && near(rotated[0].base.y, 2));
 assert.ok(near(rotated[0].offset.x, -2) && near(rotated[0].offset.y, 0));
 assert.deepEqual(rotated[0].dashes, [4, -2]);
 assert.equal(rotated[0].angle, 90);
 const conc = hatchPatternFields('AR-CONC', {scale: 1, angle: 0});
 const out = hatchSegments(conc.patternLines, {minX: 0, minY: 0, maxX: 1000, maxY: 1000});
 assert.ok(out.segments.length > 50 && !out.dense);
 const dots = hatchSegments(hatchPatternFields('DOTS', {scale: 5}).patternLines, {minX: 0, minY: 0, maxX: 300, maxY: 300});
 assert.ok(dots.dots.length > 10);
});

test('너무 촘촘하면 선 대신 채움(dense)으로 알려 멈추지 않는다', () => {
 const fine = hatchPatternFields('ANSI31', {scale: 0.001}).patternLines;
 assert.equal(hatchSegments(fine, {minX: 0, minY: 0, maxX: 100000, maxY: 100000}, {maxSegments: 1000}).dense, true);
 assert.equal(hatchSegments(fine, {minX: 0, minY: 0, maxX: 100, maxY: 100}, {minSpacing: 1}).dense, true);
});

test('해치를 옮기거나 돌리면 무늬 줄도 따라간다(예전 사선 해치의 기준점 포함)', () => {
 const hatch = {id: 'h', type: 'hatch', layer: 'L0', points: square, ...hatchPatternFields('ANSI31', {scale: 10, angle: 0})};
 const moved = G.translate(hatch, 500, 250);
 assert.ok(near(moved.patternLines[0].base.x, hatch.patternLines[0].base.x + 500));
 assert.ok(near(moved.patternLines[0].base.y, hatch.patternLines[0].base.y + 250));
 const turned = G.rotate(hatch, {x: 0, y: 0}, 90);
 assert.ok(near(turned.patternLines[0].angle, 135));
 assert.ok(near(perpendicular(turned.patternLines[0]), perpendicular(hatch.patternLines[0])));
 const scaled = G.resize(hatch, {x: 0, y: 0}, 2);
 assert.ok(near(perpendicular(scaled.patternLines[0]), perpendicular(hatch.patternLines[0]) * 2));
 const legacy = G.translate({id: 'l', type: 'hatch', layer: 'L0', points: square, spacing: 100, angle: 45, origin: {x: 10, y: 20}}, 5, 5);
 assert.deepEqual(legacy.origin, {x: 15, y: 25});
});

test('엔진: 표준 무늬 해치를 만들고 HATCHEDIT 로 무늬·축척을 바꾸고 되돌린다. 잘못된 무늬 줄은 막는다', () => {
 const engine = new DrawingEngine();
 engine.doc = {version: 2, units: 'mm', layers: [{id: 'L0', name: '0', color: '#ffffff', visible: true, locked: false}], blocks: [], entities: []};
 const [id] = engine.execute({type: 'add', entity: {type: 'hatch', layer: 'L0', points: square, ...hatchPatternFields('AR-CONC', {scale: 1})}});
 const hatch = engine.doc.entities.find(e => e.id === id);
 assert.equal(hatch.patternName, 'AR-CONC');
 engine.execute({type: 'update', ids: [id], changes: hatchEditChanges(hatch, {name: 'EARTH', scale: 20})});
 const edited = engine.doc.entities.find(e => e.id === id);
 assert.equal(edited.patternName, 'EARTH');assert.equal(edited.patternScale, 20);
 engine.execute({type: 'update', ids: [id], changes: hatchEditChanges(edited, {name: 'cross', scale: 2})});
 const legacy = engine.doc.entities.find(e => e.id === id);
 assert.equal(legacy.pattern, 'cross');assert.equal(legacy.spacing, 200);assert.equal(legacy.patternLines, null);
 engine.execute({type: 'undo'});engine.execute({type: 'undo'});
 assert.equal(engine.doc.entities.find(e => e.id === id).patternName, 'AR-CONC');
 assert.throws(() => engine.execute({type: 'add', entity: {type: 'hatch', layer: 'L0', points: square, patternLines: [{angle: NaN, base: {x: 0, y: 0}, offset: {x: 0, y: 1}, dashes: []}]}}), /무늬 정의 오류/);
 // 목록에 없는 사용자 무늬도 축척을 바꿀 수 있다.
 const custom = {type: 'hatch', patternName: 'MYPAT', patternScale: 1, angle: 0, patternLines: [{angle: 0, base: {x: 0, y: 0}, offset: {x: 0, y: 10}, dashes: [5, -5]}]};
 const bigger = hatchEditChanges(custom, {scale: 3});
 assert.ok(near(bigger.patternLines[0].offset.y, 30));assert.deepEqual(bigger.patternLines[0].dashes, [15, -15]);
});

test('출력 SVG 는 무늬를 선분으로 그리고 경계로 자른다', () => {
 const doc = {version: 2, units: 'mm', layers: [{id: 'L0', name: '0', color: '#ffffff', visible: true, locked: false}], blocks: [], entities: [
  {id: 'h', type: 'hatch', layer: 'L0', points: square, ...hatchPatternFields('ANSI37', {scale: 20})},
 ]};
 const svg = plotSVG(doc, {paper: 'A4', orientation: 'landscape', scale: 100, colorMode: 'color'});
 assert.match(svg, /<clipPath id="h\d+"><path d="M/);
 assert.match(svg, /clip-path="url\(#h\d+\)"><path d="M[-\d.]+,[-\d.]+L/);
 assert.doesNotMatch(svg, /<pattern /);
});

test('해치 무늬 검토 수정: 대소문자 섞인 이름·오타·같은 무늬 비율 유지·긴 무늬·불러오기 복구', async () => {
 const H = await import('./hatch-patterns.js');
 const {DrawingEngine, repairHatchPatterns} = await import('./engine.js');
 // V_MASONRY200x100 처럼 소문자가 섞인 이름도 쓸 수 있고 원래 이름으로 남는다
 assert.equal(H.hatchPatternFields('v_masonry200x100').patternName, 'V_MASONRY200x100');
 // 오타는 분명한 오류(예전: spacing Infinity 로 엔진 오류)
 assert.throws(() => H.hatchEditChanges({type: 'hatch', pattern: 'lines', spacing: 100, angle: 0}, {name: 'ANSI3'}), /없습니다/);
 // 가져온(인치 단위) ANSI31: 같은 무늬로 밀도 ×2 → 줄 간격 2배 (라이브러리로 다시 만들어 25.4배 되지 않음)
 const imported = {type: 'hatch', pattern: 'pattern', patternName: 'ANSI31', patternScale: 500, angle: 0,
  patternLines: [{angle: 45, base: {x: 0, y: 0}, offset: {x: -44.19, y: 44.19}, dashes: []}], spacing: 62.5};
 const doubled = H.hatchEditChanges(imported, {scale: 1000});
 assert.ok(Math.abs(doubled.spacing - 125) < 0.1, `spacing ${doubled.spacing}`);
 // 가장 긴 표준 무늬(CONCRETE3 304줄)도 만들 수 있다
 const engine = new DrawingEngine();
 const square = [{x: 0, y: 0}, {x: 1000, y: 0}, {x: 1000, y: 1000}, {x: 0, y: 1000}];
 engine.execute({type: 'add', entity: {type: 'hatch', layer: 'default', points: square, ...H.hatchPatternFields('CONCRETE3', {scale: 1})}});
 assert.ok(engine.doc.entities.at(-1).patternLines.length > 256);
 // 잘못된 무늬 해치 하나가 있어도 도면은 열리고 그 해치만 사선으로
 const bad = {id: 'h', type: 'hatch', layer: 'default', points: square, pattern: 'pattern', spacing: 100, patternLines: [{angle: 0, base: {x: 0, y: 0}, offset: {x: 0, y: 10}, dashes: new Array(300).fill(1)}]};
 const doc = structuredClone(engine.doc);doc.entities = [bad];
 engine.execute({type: 'load', document: doc});
 assert.equal(engine.doc.entities[0].patternLines, undefined);
 assert.equal(engine.doc.entities[0].patternFallback, true);
 assert.equal(engine.lastRepairedHatches, 1);
 assert.equal(repairHatchPatterns({entities: [{type: 'block', entities: [structuredClone(bad)]}]}), 1, '블록 안 해치도');
});
