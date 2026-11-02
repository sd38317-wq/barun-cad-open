// text-fields.js 시험 — 512 필드.
import test from 'node:test';
import assert from 'node:assert/strict';
import {DrawingEngine} from './engine.js';
import {evaluateField, formatFieldDate, formatFieldNumber, fieldText, isLiveField, buildFieldIndex, syncFieldsForChanges, createFieldController, FIELD_KINDS, FIELDEVAL, fieldSourceId} from './text-fields.js';

const areaCode = FIELD_KINDS.find(k => k[0] === 'area')[2];

test('날짜·숫자 서식과 파일 이름', () => {
 const d = new Date(2026, 9, 14, 15, 5, 9);
 assert.equal(formatFieldDate(d, 'yyyy.MM.dd'), '2026.10.14');
 assert.equal(formatFieldDate(d, 'yyyy년 M월 d일 tt h:mm'), '2026년 10월 14일 오후 3:05');
 assert.equal(formatFieldNumber(12_345_678, '%lu2%pr2%ct8[1e-006]%ps[,㎡]'), '12.35㎡');
 assert.equal(formatFieldNumber(NaN), '####');
 assert.equal(evaluateField('%<\\AcVar SaveDate \\f "yy-MM-dd">%', {saveDate: d}), '26-10-14');
 assert.equal(evaluateField('%<\\AcVar SaveDate>%', {}), '----');
 assert.equal(evaluateField('%<\\AcVar Filename \\f "%fn2">%', {filePath: 'D:\\도면\\A동.dwg'}), 'A동.dwg');
 assert.equal(evaluateField('%<\\AcVar Filename \\f "%fn6">%', {filePath: 'D:/도면/A동.dwg'}), 'A동');
 assert.equal(evaluateField('%<\\AcVar Filename>%', {}), '(저장 전)');
 assert.equal(evaluateField('%<\\AcDiesel $(getvar,dwgname)>%', {}), null);
});

test('객체 면적·길이 필드: 원본이 없으면 ####', () => {
 const rect = {id: 'r', type: 'polyline', closed: true, points: [{x: 0, y: 0}, {x: 3000, y: 0}, {x: 3000, y: 2000}, {x: 0, y: 2000}]};
 const byId = id => (id === 'r' ? rect : null);
 assert.equal(fieldSourceId(areaCode('r')), 'r');
 assert.equal(evaluateField(areaCode('r'), {byId}), '6.00㎡');
 assert.equal(evaluateField(FIELD_KINDS.find(k => k[0] === 'length')[2]('r'), {byId}), '10000');
 assert.equal(evaluateField(areaCode('gone'), {byId}), '####');
});

test('틀 문자와 살아 있는 필드, 색인으로 바뀐 원본의 필드만 다시 계산', () => {
 const t = {id: 't', type: 'text', fieldTemplate: '거실 {{0}}', fields: [{code: areaCode('r'), cache: '6.00㎡'}], text: '거실 6.00㎡'};
 assert.ok(isLiveField(t)); assert.ok(!isLiveField({...t, text: '고친 글'}));
 assert.equal(fieldText('{{0}}/{{1}}', [{cache: 'a'}]), 'a/{{1}}');
 const index = buildFieldIndex([t, {id: 'x', type: 'text', text: '보통'}]);
 assert.deepEqual([...index.texts], ['t']); assert.deepEqual([...index.bySource.get('r')], ['t']);
 const bigger = {id: 'r', type: 'rectangle', points: [{x: 0, y: 0}, {x: 4000, y: 0}, {x: 4000, y: 2000}, {x: 0, y: 2000}]};
 const lookup = ids => [t, bigger].filter(e => ids.includes(e.id));
 assert.deepEqual(syncFieldsForChanges(index, ['other'], {byId: () => bigger}, lookup), []);
 const [u] = syncFieldsForChanges(index, ['r'], {byId: id => (id === 'r' ? bigger : null)}, lookup);
 assert.equal(u.changes.text, '거실 8.00㎡');
 assert.equal(FIELDEVAL.save, 2);
});

test('명령 끝 갱신은 원본을 고친 명령과 되돌리기 한 번으로 묶이고, 직접 고친 필드 문자는 보통 문자가 된다', () => {
 const engine = new DrawingEngine();
 const layer = engine.doc.layers[0].id;
 engine.execute({type: 'addMany', entities: [
  {id: 'r', type: 'polyline', layer, closed: true, points: [{x: 0, y: 0}, {x: 3000, y: 0}, {x: 3000, y: 2000}, {x: 0, y: 2000}]},
  {id: 't', type: 'text', layer, position: {x: 0, y: 0}, height: 100, rotation: 0, fieldTemplate: '면적 {{0}}', fields: [{code: areaCode('r'), cache: '6.00㎡'}], text: '면적 6.00㎡'},
 ]});
 const ids = engine.doc.entities.map(e => e.id);
 const rId = ids[0], tId = ids[1];
 // addMany 가 id 를 새로 줄 수 있으니 실제 id 로 코드를 다시 맞춘다.
 engine.execute({type: 'update', ids: [tId], changes: {fields: [{code: areaCode(rId), cache: '6.00㎡'}]}});
 const host = {doc: () => engine.doc, lookup: list => engine.doc.entities.filter(e => list.includes(e.id)), execute: c => engine.execute(c),
  undoTop: () => engine.undoStack.at(-1), mergeLastUndo: p => engine.mergeLastUndo(p), context: () => ({}), key: () => 'tab1'};
 const fields = createFieldController(host);
 const depth = engine.undoStack.length;
 const command = {type: 'update', ids: [rId], changes: {points: [{x: 0, y: 0}, {x: 5000, y: 0}, {x: 5000, y: 2000}, {x: 0, y: 2000}]}};
 const changed = engine.execute(command);
 assert.equal(fields.afterCommand(command, changed), 1);
 const text = () => engine.doc.entities.find(e => e.id === tId);
 assert.equal(text().text, '면적 10.00㎡');
 assert.equal(engine.undoStack.length, depth + 1);            // 한 단계
 engine.execute({type: 'undo'});
 assert.equal(text().text, '면적 6.00㎡');
 // 사용자가 직접 고치면 보통 문자(필드 해제), 내용은 그대로.
 const edit = {type: 'update', ids: [tId], changes: {text: '면적 미정'}};
 fields.afterCommand(edit, engine.execute(edit));
 assert.equal(text().text, '면적 미정'); assert.equal(text().fields, null);
});
