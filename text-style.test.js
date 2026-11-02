// text-style.js 시험 — 509 문자 스타일 표.
import test from 'node:test';
import assert from 'node:assert/strict';
import {DrawingEngine} from './engine.js';
import {normalizeTextStyles, resolveTextStyle, planTextStyleUpdate, planApplyTextStyle, cleanStyle, STANDARD_STYLE} from './text-style.js';

const doc = () => ({layers: [{id: 'L0', name: '0', color: '#ffffff', visible: true, locked: false}, {id: 'LK', name: '잠김', color: '#ffffff', visible: true, locked: true}], blocks: [],
 entities: [
  {id: 't1', type: 'text', layer: 'L0', position: {x: 0, y: 0}, text: '가', height: 250, textStyle: 'KOR', sourceFont: 'romans.shx', sourceBigFont: 'whgtxt.shx', widthFactor: 0.8},
  {id: 't2', type: 'text', layer: 'L0', position: {x: 0, y: 500}, text: '나', height: 250, textStyle: 'KOR', sourceFont: 'romans.shx', sourceBigFont: 'whgtxt.shx', widthFactor: 0.6},
  {id: 't3', type: 'text', layer: 'LK', position: {x: 0, y: 900}, text: '다', height: 250, textStyle: 'KOR', sourceFont: 'romans.shx', sourceBigFont: 'whgtxt.shx', widthFactor: 0.8},
  {id: 'b1', type: 'block', name: 'TAG', layer: 'L0', entities: [{id: 'n1', type: 'text', layer: 'L0', position: {x: 0, y: 0}, text: '안', height: 100, textStyle: 'KOR', sourceFont: 'romans.shx', widthFactor: 0.8}]},
  {id: 't4', type: 'text', layer: 'L0', position: {x: 0, y: 1300}, text: 'ROOM', height: 250},
 ]});

test('예전 도면은 그 스타일 문자들이 가장 많이 쓴 값으로 표를 만든다(Standard 는 늘 있다)', () => {
 const styles = normalizeTextStyles(doc());
 assert.deepEqual(styles.KOR, {font: 'romans.shx', bigFont: 'whgtxt.shx', height: 0, widthFactor: 0.8, oblique: 0});
 assert.ok(styles.Standard);
 const kept = normalizeTextStyles({...doc(), textStyles: {KOR: {font: 'gulim.ttc', widthFactor: 2}}});
 assert.equal(kept.KOR.font, 'gulim.ttc');
 assert.equal(resolveTextStyle(styles, {textStyle: 'KOR', height: 0}).height, 2.5);
 assert.equal(resolveTextStyle(styles, {textStyle: 'KOR', widthFactor: 0.6}).widthFactor, 0.6);
 assert.deepEqual(cleanStyle({widthFactor: -1, oblique: 200}), {...STANDARD_STYLE, widthFactor: 1, oblique: 0});
});

test('폭 비율을 바꾸면 스타일 값을 따르던 문자만(블록 안 포함), 따로 바꾼 문자·잠긴 레이어는 그대로 — 표와 함께 한 번에 되돌린다', () => {
 const engine = new DrawingEngine(); engine.doc = {...engine.doc, ...doc()};
 const writable = e => e.layer !== 'LK';
 const plan = planTextStyleUpdate(engine.doc, 'KOR', {widthFactor: 0.9}, {writable});
 assert.equal(plan.count, 2); assert.equal(plan.skipped, 1);
 engine.execute(plan.command);
 const by = id => engine.doc.entities.find(e => e.id === id);
 assert.equal(by('t1').widthFactor, 0.9); assert.equal(by('t2').widthFactor, 0.6); assert.equal(by('t3').widthFactor, 0.8);
 assert.equal(by('b1').entities[0].widthFactor, 0.9);
 assert.equal(engine.doc.textStyles.KOR.widthFactor, 0.9);
 engine.execute({type: 'undo'});
 assert.equal(by('t1').widthFactor, 0.8); assert.equal(engine.doc.textStyles, undefined);
});

test('글꼴은 그 스타일 문자 전부(AutoCAD 처럼), 바뀐 값이 없으면 문자를 건드리지 않는다', () => {
 const d = doc();
 const plan = planTextStyleUpdate(d, 'KOR', {font: 'batang.ttc', bigFont: ''});
 const ids = plan.command.commands[1].updates.map(u => u.id).sort();
 assert.deepEqual(ids, ['b1', 't1', 't2', 't3']);
 const none = planTextStyleUpdate(d, 'KOR', {widthFactor: 0.8});
 assert.equal(none.changedKeys.length, 0); assert.equal(none.command.type, 'document.update');
 assert.throws(() => planTextStyleUpdate(d, 'A/B', {}), /쓸 수 없습니다/);
});

test('고른 문자에 스타일을 입히면 스타일 값을 복사한다', () => {
 const d = doc();
 const plan = planApplyTextStyle({...d, textStyles: {TITLE: {font: 'malgun.ttf', widthFactor: 1.2, oblique: 15}}}, 'TITLE', [d.entities[4]]);
 assert.deepEqual(plan.command.commands[1].updates[0].changes, {textStyle: 'TITLE', sourceFont: 'malgun.ttf', sourceBigFont: '', widthFactor: 1.2, oblique: 15});
});
