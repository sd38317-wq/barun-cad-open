// block-attributes.js 시험 — 521 블록 속성.
import test from 'node:test';
import assert from 'node:assert/strict';
import {attributeTexts, setAttributeValue, syncAttributeTexts, attsyncPlan} from './block-attributes.js';

const tag = (attributeTag, x, y, text, extra = {}) => ({type: 'text', layer: 'L', attributeTag, position: {x, y}, height: 100, rotation: 0, text, ...extra});
const ref = {id: 'a', type: 'block', name: 'DOOR', position: {x: 0, y: 0}, rotation: 0, scale: 1, attributes: {NO: 'D1', W: '900'},
 entities: [{type: 'circle', center: {x: 0, y: 0}, radius: 10}, tag('NO', 0, -50, 'D1'), tag('W', 0, -200, '900', {hidden: true})]};

test('값을 바꾸면 보이는 속성 글자도 같이, 어긋난 글자는 값으로 맞춘다', () => {
 const c = setAttributeValue(ref, 'NO', 'D7');
 assert.equal(c.attributes.NO, 'D7'); assert.equal(attributeTexts({entities: c.entities})[0].text, 'D7');
 assert.equal(setAttributeValue(ref, 'NEW', 'x').entities, undefined);
 assert.equal(syncAttributeTexts(ref), null);
 const drift = {...ref, attributes: {NO: 'D9', W: '900'}};
 assert.equal(syncAttributeTexts(drift).entities.find(e => e.attributeTag === 'NO').text, 'D9');
});

test('ATTSYNC: 배치는 기준대로(회전·위치 차이 반영), 값은 그대로, 기준에 없는 태그는 지우지 않는다', () => {
 const other = {id: 'b', type: 'block', name: 'DOOR', position: {x: 1000, y: 0}, rotation: 90, scale: 1, attributes: {NO: 'D2', OLD: 'x'},
  entities: [tag('NO', 1300, 0, 'D2'), tag('OLD', 1000, 500, 'x')]};
 const plan = attsyncPlan(ref, [ref, other, {id: 'c', type: 'block', name: 'WIN', position: {x: 0, y: 0}}]);
 assert.equal(plan.synced, 1); assert.deepEqual(plan.extraTags, ['OLD']);
 const {attributes, entities} = plan.updates[0].changes;
 assert.deepEqual(attributes, {NO: 'D2', OLD: 'x', W: '900'});
 const no = entities.find(e => e.attributeTag === 'NO');
 assert.ok(Math.abs(no.position.x - 1050) < 1e-9 && Math.abs(no.position.y - 0) < 1e-9);   // (0,-50) 을 90° 돌려 (50,0) + 삽입점
 assert.equal(no.rotation, 90); assert.equal(no.text, 'D2');
 assert.equal(entities.find(e => e.attributeTag === 'W').hidden, true);
 assert.ok(entities.some(e => e.attributeTag === 'OLD'));
 assert.throws(() => attsyncPlan({type: 'block', name: 'X', entities: []}, []), /기준 블록/);
});
