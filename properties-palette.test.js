// 속성 팔레트: 종류별 항목, 여러 값, 고친 항목만 적용, 한 번의 batch.
import test from 'node:test';
import assert from 'node:assert/strict';
import {DrawingEngine} from './engine.js';
import {buildPropertyPalette} from './properties-palette.js';

const ctx = {layers: [['L0', '0']], layerName: (id) => id, linetypes: [['BYLAYER', 'ByLayer'], ['DASHED', 'DASHED']], colorText: (e) => (e.colorMode === 'aci' ? String(e.aci) : e.color || 'BYLAYER')};
const names = (p) => p.fields.filter((f) => f.name).map((f) => f.name);
const valuesOf = (p) => Object.fromEntries(p.fields.filter((f) => f.name).map((f) => [f.name, f.value]));
const engineWith = (entities) => { const engine = new DrawingEngine(); engine.doc.entities.push(...entities); return engine; };
const hatch = (o = {}) => ({id: 'h', type: 'hatch', layer: 'default', points: [{x: 0, y: 0}, {x: 1000, y: 0}, {x: 1000, y: 1000}, {x: 0, y: 1000}], pattern: 'lines', spacing: 100, angle: 45, ...o});
const text = (o = {}) => ({id: 't', type: 'text', layer: 'default', position: {x: 5, y: 5}, text: '안녕', height: 200, rotation: 0, ...o});
const line = (o = {}) => ({id: 'l', type: 'line', layer: 'default', points: [{x: 0, y: 0}, {x: 300, y: 400}], ...o});

test('종류별로 필요한 항목이 나오고 좌표는 고급에 둥글게 나온다', () => {
 const h = buildPropertyPalette([hatch()], ctx);
 for (const n of ['color', 'layer', 'linetype', 'linetypeScale', 'lineweight', 'hatchPattern', 'hatchScale', 'hatchAngle', 'hatchArea']) assert.ok(names(h).includes(n), n);
 assert.equal(h.fields.find((f) => f.name === 'hatchArea').value, '1');
 assert.ok(h.fields.find((f) => f.name === 'hatchArea').readonly);
 assert.ok(h.fields.find((f) => f.name === 'x').advanced);
 assert.ok(!names(h).includes('spacing'));
 const t = buildPropertyPalette([text()], ctx);
 for (const n of ['text', 'height', 'rotation', 'align', 'widthFactor']) assert.ok(names(t).includes(n), n);
 const l = buildPropertyPalette([line()], ctx);
 assert.equal(l.fields.find((f) => f.name === 'lineLength').value, '500');
 assert.ok(l.fields.find((f) => f.name === 'pt1x').advanced);
 assert.equal(buildPropertyPalette([line({points: [{x: 0.123456789, y: 1}, {x: 5, y: 1}]})], ctx).fields.find((f) => f.name === 'pt0x').value, '0.12');
});

test('여러 종류를 고르면 공통 항목만, 값이 다르면 비워 두고 고치지 않으면 바꾸지 않는다', () => {
 const p = buildPropertyPalette([hatch(), text(), line({color: '#ff0000', aci: 1, colorMode: 'aci'})], ctx);
 assert.deepEqual(names(p), ['color', 'layer', 'linetype', 'linetypeScale', 'lineweight']);
 assert.equal(p.fields.find((f) => f.name === 'color').value, '');
 assert.ok(p.fields.find((f) => f.name === 'color').mixed);
 const values = valuesOf(p);
 assert.deepEqual(p.commands(values), []);
 const cmds = p.commands({...values, color: '3'});
 assert.equal(cmds.length, 1);
 assert.equal(cmds[0].type, 'updateMany');
 assert.equal(cmds[0].updates.length, 3);
 assert.ok(cmds[0].updates.every((u) => u.changes.aci === 3 && u.changes.colorMode === 'aci'));
});

test('해치 무늬·축척·각도를 바꾸면 실제 무늬 줄이 다시 만들어지고 한 번의 batch 로 되돌려진다', () => {
 const engine = engineWith([hatch()]);
 const p = buildPropertyPalette([engine.doc.entities[0]], ctx);
 const cmds = p.commands({...valuesOf(p), hatchPattern: 'ANSI31', hatchScale: '2', hatchAngle: '30', color: '#12ab34'});
 engine.execute({type: 'batch', commands: cmds});
 const after = engine.doc.entities[0];
 assert.equal(after.patternName, 'ANSI31');
 assert.equal(after.patternScale, 2);
 assert.equal(after.angle, 30);
 assert.ok(after.patternLines.length > 0);
 assert.equal(after.color, '#12ab34');
 assert.equal(after.colorMode, 'truecolor');
 assert.equal(engine.undoStack.length, 1); engine.execute({type: 'undo'});
 assert.equal(engine.doc.entities[0].pattern, 'lines');
 assert.equal(engine.doc.entities[0].color, undefined);
});

test('문자·선 값 변경이 모델에 그대로 들어간다', () => {
 const engine = engineWith([text(), line()]);
 const [t, l] = engine.doc.entities;
 let p = buildPropertyPalette([t], ctx);
 engine.execute({type: 'batch', commands: p.commands({...valuesOf(p), text: '새 글', height: '350', align: 'center', widthFactor: '0.8'})});
 const t2 = engine.doc.entities[0]; assert.deepEqual([t2.text, t2.height, t2.align, t2.widthFactor], ['새 글', 350, 'center', 0.8]);
 p = buildPropertyPalette([l], ctx);
 engine.execute({type: 'batch', commands: p.commands({...valuesOf(p), lineLength: '1000', lineAngle: '0'})});
 assert.deepEqual(engine.doc.entities[1].points[1], {x: 1000, y: 0});
 assert.throws(() => p.commands({...valuesOf(p), lineLength: '-3'}), /0보다/);
});
