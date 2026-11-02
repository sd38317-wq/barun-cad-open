// text-inline-editor.js 시험 — 503 제자리 문자 편집기.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {inlineEditorSize, inlineEditorKeyAction, inlineEditorBackground, MIN_EDIT_PX} from './text-inline-editor.js';

test('한글 조합 중 Enter·Esc 는 저장·취소로 이어지지 않는다', () => {
 assert.equal(inlineEditorKeyAction({key: 'Enter', isComposing: true}), 'compose');
 assert.equal(inlineEditorKeyAction({key: 'Process', keyCode: 229}), 'compose');
 assert.equal(inlineEditorKeyAction({key: 'Escape', isComposing: true}), 'compose');
 assert.equal(inlineEditorKeyAction({key: 'Enter'}), 'commit');
 assert.equal(inlineEditorKeyAction({key: 'Enter', shiftKey: true}), null);
 assert.equal(inlineEditorKeyAction({key: 'Escape'}), 'cancel');
 assert.equal(inlineEditorKeyAction({key: 'a'}), null);
});

test('작은 글자는 읽을 수 있는 크기로 키우고 배율을 알려 준다', () => {
 const small = inlineEditorSize(3);
 assert.equal(small.fontSize, MIN_EDIT_PX); assert.ok(small.magnified); assert.match(small.title, /×4\.7/);
 const big = inlineEditorSize(40);
 assert.equal(big.fontSize, 40); assert.equal(big.magnified, false); assert.equal(big.title, '');
 assert.equal(inlineEditorSize(NaN).fontSize, MIN_EDIT_PX);
});

test('배경은 캔버스 색의 76% 불투명', () => {
 assert.equal(inlineEditorBackground('rgb(0, 0, 0)'), 'rgba(0,0,0,0.76)');
 assert.equal(inlineEditorBackground('#ffffff'), 'rgba(255,255,255,0.76)');
 assert.equal(inlineEditorBackground('rgba(0, 0, 0, 0)'), 'rgba(16,24,32,0.76)');
 assert.equal(inlineEditorBackground('nonsense'), 'rgba(16,24,32,0.76)');
});

test('app.js 제자리 편집기가 조합 상태 판정을 쓴다(연결 확인)', () => {
 const app = readFileSync(new URL('./app.js', import.meta.url), 'utf8');
 const body = app.slice(app.indexOf('function editTextInline'), app.indexOf("canvas.addEventListener('dblclick'"));
 assert.match(body, /inlineEditorKeyAction\(event\)/);
 assert.match(body, /inlineEditorSize\(/);
 assert.doesNotMatch(body, /event\.key==='Enter'&&!event\.shiftKey/);
});
