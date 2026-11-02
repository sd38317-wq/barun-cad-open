// text-create-tools.js 시험. node --test 로 돈다. DOM 없이 export 된 순수 함수만 부른다(규칙서 8절).
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {
 splitAffixNumber, decimalPlaces, incrementNumberString, incrementText,
 incrementAlphaChar, incrementAlphaToken, nextTagValue, buildIncrementSeries, lerpPoints,
 findRun, replaceRunAtPosition, computeTieSequence,
 labelOf,
 charIndexFromLocalX, numberGroupAt, incrementAtGroup, buildArrayPoints,
 layoutLtxLines,
 loadSentenceLibrary, saveSentenceLibrary, addCategoryToLibrary, addSentenceToLibrary, applyUppercase, buildLeaderEntities,
 QW_CATEGORY_DEFS, loadQwLibrary, saveQwLibrary, addCharToCategory,
 korCompare, sortTextsForTable, buildTtTable,
 nearestPointOnPolyline, angleAtSegment, layoutCurveText,
} from './text-create-tools.js';

/* ── splitAffixNumber / incrementNumberString / incrementText (TIN·TIC 공통 패턴 4) ── */
test('splitAffixNumber: 접두어/숫자/접미어 분해', () => {
 assert.deepEqual(splitAffixNumber('A-001b'), {prefix:'A-', number:'001', suffix:'b'});
 assert.deepEqual(splitAffixNumber('X1'), {prefix:'X', number:'1', suffix:''});
 assert.deepEqual(splitAffixNumber('12.5m'), {prefix:'', number:'12.5', suffix:'m'});
 assert.deepEqual(splitAffixNumber('실명'), {prefix:'실명', number:'', suffix:''});
});

test('decimalPlaces', () => {
 assert.equal(decimalPlaces('005'), 0);
 assert.equal(decimalPlaces('1.00'), 2);
});

test('incrementNumberString: 선행 0 자릿수 유지(원문 TIN 주의사항)', () => {
 assert.equal(incrementNumberString('005', 3), '008');
 assert.equal(incrementNumberString('1', 1), '2');
 assert.equal(incrementNumberString('1.0', 1), '2.0');
 assert.equal(incrementNumberString('9', 1), '10');
});

test('incrementText: 접두/접미 유지하고 숫자만 증가', () => {
 assert.equal(incrementText('W-01', 1), 'W-02');
 assert.throws(() => incrementText('창호', 1));
});

/* ── 영문자 증가(원문 "여러 자리 영문 AAA-001 -> AAB-001") ── */
test('incrementAlphaChar: Z/z 감싸기', () => {
 assert.equal(incrementAlphaChar('A'), 'B');
 assert.equal(incrementAlphaChar('Z'), 'A');
 assert.equal(incrementAlphaChar('z'), 'a');
});
test('incrementAlphaToken: 자리올림', () => {
 assert.equal(incrementAlphaToken('A'), 'B');
 assert.equal(incrementAlphaToken('AAA'), 'AAB');
 assert.equal(incrementAlphaToken('AAZ'), 'ABA');
 assert.equal(incrementAlphaToken('Z'), 'AA');
});

test('nextTagValue: 숫자면 숫자 증가, 영문이면 영문 증가(TII·NUMC 원문)', () => {
 assert.equal(nextTagValue('1'), '2');
 assert.equal(nextTagValue('A'), 'B');
 assert.equal(nextTagValue('W-01'), 'W-02');
});

test('buildIncrementSeries: TII 하나씩/NUMC 값 목록', () => {
 assert.deepEqual(buildIncrementSeries('1', 4), ['1', '2', '3', '4']);
 assert.deepEqual(buildIncrementSeries('A', 3), ['A', 'B', 'C']);
});

test('lerpPoints: TII 등간격 연속 배치점', () => {
 const pts = lerpPoints({x:0,y:0}, {x:10,y:0}, 3);
 assert.deepEqual(pts, [{x:0,y:0}, {x:5,y:0}, {x:10,y:0}]);
 assert.deepEqual(lerpPoints({x:1,y:1},{x:5,y:5},1), [{x:1,y:1}]);
});

/* ── TIE findRun/replaceRunAtPosition/computeTieSequence ── */
test('findRun: 앞/뒤 숫자 묶음 찾기', () => {
 assert.deepEqual(findRun('AX-49-23F-001', 'front'), {text:'49', index:3});
 assert.deepEqual(findRun('AX-49-23F-001', 'back'), {text:'001', index:10});
 assert.equal(findRun('실명', 'back'), null);
});
test('replaceRunAtPosition: 찾은 자리 바꾸기, 없으면 이어붙임', () => {
 assert.equal(replaceRunAtPosition('W-01', 'back', '02'), 'W-02');
 assert.equal(replaceRunAtPosition('실명', 'back', '1'), '실명1');
 assert.equal(replaceRunAtPosition('실명', 'front', '1'), '1실명');
});
test('computeTieSequence: 원본 숫자를 이어 증가시키고, 대상의 앞쪽(position=front) 숫자 묶음만 바꾼다', () => {
 // 원문 사용법 문단의 예시("TR-RFF-001"→"50TR-RFF-001")는 뒤쪽 숫자 자리를 그대로 둔 채 항상 맨 앞에 덧붙이는
 // 것처럼 읽히나, 같은 문단이 "뒤가 기본값"이라고도 해 서로 모순된다(보고서에 기재). 이 카드는 "position 쪽에서
 // 찾은 기존 숫자 묶음을 바꾸고, 없으면 그 쪽 끝에 붙인다"는 일관된 규칙으로 구현했다 — "TR-RFF-001"은 이미
 // 숫자 묶음이 있어(001) 그 자리가 바뀐다.
 const result = computeTieSequence('49-23F-001', ['TR-RFF-001', '34-WER-001'], {position:'front', step:1});
 assert.deepEqual(result, ['TR-RFF-50', '51-WER-001']);
});
test('computeTieSequence: 영문 증가 모드', () => {
 const result = computeTieSequence('AAA', ['XXX', 'YYY'], {kind:'alpha', position:'back'});
 assert.deepEqual(result, ['AAB', 'AAC']);
});

/* ── TIN labelOf ── */
test('labelOf: text 엔티티는 자신, 블럭류는 내부 첫 text', () => {
 const t = {id:'t1', type:'text', text:'X1'};
 assert.equal(labelOf(t).text, 'X1');
 assert.deepEqual(labelOf(t).buildUpdate('X2'), {type:'update', ids:['t1'], changes:{text:'X2'}});
 const block = {id:'b1', type:'block', entities:[{type:'line'}, {type:'text', text:'C1'}]};
 const l = labelOf(block);
 assert.equal(l.text, 'C1');
 const upd = l.buildUpdate('C2');
 assert.equal(upd.changes.entities[1].text, 'C2');
 assert.equal(upd.changes.entities[0].type, 'line');
 assert.equal(labelOf({type:'circle'}), null);
});

/* ── TIP charIndexFromLocalX/numberGroupAt/incrementAtGroup/buildArrayPoints ── */
test('charIndexFromLocalX: 왼쪽 정렬 기준 대략적 글자 인덱스', () => {
 const idx = charIndexFromLocalX(100, 150, 'left', 10);
 assert.ok(idx >= 0 && idx <= 10);
});
test('numberGroupAt: index 를 포함하거나 가장 가까운 숫자 묶음', () => {
 // "A-001-E23-012" 에서 "23"은 인덱스 7-8("2"=7,"3"=8), "012"는 인덱스 10-12.
 const g = numberGroupAt('A-001-E23-012', 8);
 assert.deepEqual(g, {text:'23', start:7, end:9});
});
test('incrementAtGroup: 그 자리 숫자만 증가', () => {
 const group = numberGroupAt('A-001-E23-012', 8);
 assert.equal(incrementAtGroup('A-001-E23-012', group, 1), 'A-001-E24-012');
});
test('buildArrayPoints: 배열(A) 옵션', () => {
 const pts = buildArrayPoints({x:0,y:0}, 3, 100, 0);
 assert.deepEqual(pts, [{x:0,y:0}, {x:100,y:0}, {x:200,y:0}]);
});

/* ── LTX ── */
test('layoutLtxLines: 줄마다 아래로 배치, 빈 줄 제외', () => {
 const rows = layoutLtxLines({x:0,y:0}, 'A\nB\n\nC', 150, 1.35);
 assert.equal(rows.length, 3);
 assert.equal(rows[0].position.y, 0);
 assert.equal(rows[1].position.y, -150*1.35);
 assert.equal(rows[2].text, 'C');
});

/* ── QT 문장 저장소 ── */
function fakeStorage(){
 const m = new Map();
 return {getItem:k=>m.has(k)?m.get(k):null, setItem:(k,v)=>m.set(k,v)};
}
test('loadSentenceLibrary: 저장 없으면 기본값(빈 목록, 규칙서 "없으면 빈 칸")', () => {
 const lib = loadSentenceLibrary(fakeStorage());
 assert.deepEqual(lib, {categories:['기본'], sentences:{'기본':[]}});
});
test('addCategoryToLibrary / addSentenceToLibrary / applyUppercase', () => {
 let lib = loadSentenceLibrary(fakeStorage());
 lib = addCategoryToLibrary(lib, '마감');
 lib = addSentenceToLibrary(lib, '마감', 'THK12 방수몰탈');
 assert.deepEqual(lib.sentences['마감'], ['THK12 방수몰탈']);
 assert.throws(() => addSentenceToLibrary(lib, '없는분류', 'x'));
 assert.equal(applyUppercase('abc', true), 'ABC');
 assert.equal(applyUppercase('abc', false), 'abc');
});
test('QT 저장소 round-trip', () => {
 const storage = fakeStorage();
 let lib = loadSentenceLibrary(storage);
 lib = addSentenceToLibrary(addCategoryToLibrary(lib, '기본'), '기본', '안내문');
 saveSentenceLibrary(storage, lib);
 const reloaded = loadSentenceLibrary(storage);
 assert.deepEqual(reloaded.sentences['기본'], ['안내문']);
});
test('buildLeaderEntities: 지시선+문자, 문자 시작점은 지시선 끝점', () => {
 const es = buildLeaderEntities([{x:0,y:0},{x:100,y:0},{x:200,y:0}], '안내', 150, 'A-TEXT');
 assert.equal(es.length, 2);
 assert.equal(es[0].type, 'polyline');
 assert.equal(es[1].type, 'text');
 assert.deepEqual(es[1].position, {x:200,y:0});
 assert.throws(() => buildLeaderEntities([{x:0,y:0}], '안내', 150, 'L'));
});

/* ── QW ── */
test('loadQwLibrary: 확인된 6개 탭만 씨앗 글자, 나머지 4개는 빈 배열(규칙서 "없으면 빈 칸")', () => {
 const lib = loadQwLibrary(fakeStorage());
 assert.ok(lib.unit.includes('㎡'));
 assert.ok(lib.math.includes('√'));
 assert.deepEqual(lib.japanese, []);
 assert.equal(QW_CATEGORY_DEFS.length, 10);
});
test('addCharToCategory / saveQwLibrary round-trip', () => {
 const storage = fakeStorage();
 let lib = loadQwLibrary(storage);
 lib = addCharToCategory(lib, 'unit', '℃');
 saveQwLibrary(storage, lib);
 assert.ok(loadQwLibrary(storage).unit.includes('℃'));
});

/* ── TTT 정렬/표 ── */
test('korCompare: 특수문자-숫자-영문-한글 순(원문 [문자 정렬] "가나다순")', () => {
 assert.ok(korCompare('#', '1') < 0);
 assert.ok(korCompare('1', 'A') < 0);
 assert.ok(korCompare('A', '가') < 0);
 assert.equal(korCompare('A', 'A'), 0);
});
test('sortTextsForTable: 상하/좌우/가나다/선택순', () => {
 const es = [
  {position:{x:0,y:0}, text:'B'},
  {position:{x:10,y:10}, text:'A'},
 ];
 const topdown = sortTextsForTable(es, 'topdown');
 assert.equal(topdown[0].text, 'A');
 const leftright = sortTextsForTable(es, 'leftright');
 assert.equal(leftright[0].text, 'B');
 const kor = sortTextsForTable(es, 'kor');
 assert.equal(kor[0].text, 'A');
 const pick = sortTextsForTable(es, 'pick');
 assert.equal(pick[0].text, 'B');
});
test('buildTtTable: 문자 목록을 1열 표로', () => {
 const table = buildTtTable(['가', '나'], {height:150, layer:'A-TEXT', name:'표'}, {x:0,y:0});
 assert.equal(table.type, 'block');
 assert.equal(table.table.rows.length, 2);
 assert.deepEqual(table.table.rows[0], ['가']);
 assert.throws(() => buildTtTable([], {}, {x:0,y:0}));
});

/* ── TOO ── */
test('nearestPointOnPolyline / angleAtSegment: 직선문장쓰기 각도', () => {
 const pts = [{x:0,y:0},{x:100,y:0},{x:100,y:100}];
 const info = nearestPointOnPolyline(pts, {x:50,y:5});
 assert.equal(info.segIndex, 0);
 assert.ok(Math.abs(info.point.y) < 1e-6);
 assert.equal(angleAtSegment(pts, 0), 0);
 assert.equal(angleAtSegment(pts, 1), 90);
});
test('layoutCurveText: 글자마다 spacing 만큼 곡선을 따라 배치, 접선각 회전', () => {
 const pts = [{x:0,y:0},{x:100,y:0}];
 const chars = layoutCurveText(pts, {x:0,y:0}, 'AB', 50);
 assert.equal(chars.length, 2);
 assert.deepEqual(chars[0].position, {x:0,y:0});
 assert.deepEqual(chars[1].position, {x:50,y:0});
 assert.equal(chars[0].rotation, 0);
 assert.equal(layoutCurveText(pts, {x:0,y:0}, '', 50).length, 0);
});
