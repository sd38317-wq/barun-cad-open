// text-codes.js 시험 — 501 MTEXT 서식 run, 502 MTEXT 이스케이프, 505 %% 제어 코드.
import test from 'node:test';
import assert from 'node:assert/strict';
import {decodePercentCodes, percentToPlain, encodePercentCodes, parseMtextRuns, runsToPlain, mtextToPlain, plainToMtext,
 textForMtextExport, textForTextExport, codeTextStale, normalizeTypedText} from './text-codes.js';

test('505: %%c %%d %%p %%% %%nnn 은 글자로, %%u %%o %%k 는 꾸밈 토글로 푼다', () => {
 assert.equal(percentToPlain('%%c100'), 'Ø100');
 assert.equal(percentToPlain('90%%d'), '90°');
 assert.equal(percentToPlain('%%p5'), '±5');
 assert.equal(percentToPlain('50%%%'), '50%');
 assert.equal(percentToPlain('%%065BC'), 'ABC');
 assert.equal(percentToPlain('%%C %%D %%P'), 'Ø ° ±');
 assert.equal(percentToPlain('%%x 그대로'), '%%x 그대로');
 assert.equal(percentToPlain('끝%%'), '끝%%');
 const runs = decodePercentCodes('가%%u밑줄%%u나%%o윗%%k취소');
 assert.deepEqual(runs.map(r => [r.text, r.underline, r.overline, r.strike]),
  [['가', false, false, false], ['밑줄', true, false, false], ['나', false, false, false], ['윗', false, true, false], ['취소', false, true, true]]);
});

test('505: 화면 문자 → %% 원문은 다시 풀면 같은 글자(왕복)이고 혼자 있는 % 는 그대로', () => {
 for (const s of ['Ø100', '90°', '±5', '50%', '50%%', '%Ø', 'a%%b', '%%%', '100% 완료 ±3', '⌀25']) {
  const encoded = encodePercentCodes(s);
  assert.equal(percentToPlain(encoded), s.replace('⌀', 'Ø'), `${s} → ${encoded}`);
 }
 assert.equal(encodePercentCodes('50%'), '50%');
 assert.equal(encodePercentCodes('Ø100'), '%%c100');
});

test('501: MTEXT 서식 코드를 run 으로 푼다(높이 배수·글꼴·색·쌓기·줄바꿈·중괄호 범위)', () => {
 const runs = parseMtextRuns('첫줄 한글\\P{\\H2x;큰글}\\S1/2;끝 {\\fArial|b1|i0;굵게}{\\C1;빨강}', {height: 10, font: 'malgun.ttf'});
 const text = runs.filter(r => r.text).map(r => [r.text, r.height, r.font, !!r.bold, r.aci]);
 assert.deepEqual(text, [['첫줄 한글', 10, 'malgun.ttf', false, undefined], ['큰글', 20, 'malgun.ttf', false, undefined], ['끝 ', 10, 'malgun.ttf', false, undefined], ['굵게', 10, 'Arial', true, undefined], ['빨강', 10, 'malgun.ttf', false, 1]]);
 assert.equal(runs.filter(r => r.br).length, 1);
 const stack = runs.find(r => r.stack);
 assert.deepEqual(stack.stack, {top: '1', bottom: '2', kind: '/'});
 assert.equal(runsToPlain(runs), '첫줄 한글\n큰글1/2끝 굵게빨강');
});

test('501: 이스케이프 글자·\\U+·\\~·밑줄 토글·모르는 코드는 글자를 먹지 않는다', () => {
 assert.equal(mtextToPlain('C:\\\\temp \\{ab\\}'), 'C:\\temp {ab}');
 assert.equal(mtextToPlain('\\U+00B1 5'), '± 5');
 assert.equal(mtextToPlain('a\\~b'), 'a\u00a0b');
 const runs = parseMtextRuns('\\L밑줄\\l 보통');
 assert.deepEqual(runs.map(r => [r.text, !!r.underline]), [['밑줄', true], [' 보통', false]]);
 assert.equal(mtextToPlain('\\Z값'), 'Z값');
 assert.equal(mtextToPlain('\\pxqc;가운데'), '가운데');
 assert.equal(mtextToPlain('%%c50'), 'Ø50');
 assert.deepEqual(parseMtextRuns('\\S1#4;').find(r => r.stack).stack, {top: '1', bottom: '4', kind: '#'});
});

test('502: 평문 → MTEXT 원문은 \\ { } 를 이스케이프하고 다시 풀면 같은 문자', () => {
 for (const s of ['C:\\도면\\A동', '{가}', '첫 줄\n둘째 \\P 글자', 'a}b{c', '']) {
  const raw = plainToMtext(s);
  assert.equal(mtextToPlain(raw), s, raw);
 }
 assert.equal(plainToMtext('C:\\temp {ab}'), 'C:\\\\temp \\{ab\\}');
 assert.equal(plainToMtext('a\r\nb'), 'a\\Pb');
});

test('501·502·505: 고치지 않은 문자는 원문 그대로, 고친 문자는 새로 이스케이프해서 내보낸다', () => {
 const m = {text: '큰글1/2', codeKind: 'mtext', codeText: '{\\H2x;큰글}\\S1/2;', codePlain: '큰글1/2'};
 assert.equal(textForMtextExport(m), m.codeText);
 assert.equal(codeTextStale(m), false);
 const edited = {...m, text: '작은{글}'};
 assert.equal(textForMtextExport(edited), '작은\\{글\\}');
 assert.equal(codeTextStale(edited), true);
 const t = {text: '밑줄', codeKind: 'text', codeText: '%%u밑줄%%u', codePlain: '밑줄'};
 assert.equal(textForTextExport(t), '%%u밑줄%%u');
 assert.equal(textForTextExport({...t, text: 'Ø20'}), '%%c20');
 // 종류가 다른 원문은 쓰지 않는다(TEXT 원문을 MTEXT 로 내보내는 경우).
 assert.equal(textForMtextExport(t), '밑줄');
});

test('505: 명령창 입력의 %% 코드를 받는다(코드 없으면 그대로)', () => {
 assert.equal(normalizeTypedText('%%c100'), 'Ø100');
 assert.equal(normalizeTypedText('평범한 글'), '평범한 글');
 assert.equal(normalizeTypedText('%%u밑줄%%u'), '밑줄');
});
