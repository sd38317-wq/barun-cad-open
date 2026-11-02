import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {inlineEditorSize, inlineEditorKeyAction, inlineEditorBackground} from './text-inline-editor.js';
import {normalizeTypedText} from './text-codes.js';

function loadEditor(settings = {inlineTextMinPx: 0}) {
  const source = fs.readFileSync('app.js', 'utf8');
  const start = source.indexOf('function editTextInline(entity){');
  const end = source.indexOf("canvas.addEventListener('dblclick'", start);
  assert.ok(start >= 0 && end > start, 'inline editor source must remain discoverable');
  const textarea = () => ({
    className: '', value: '', rows: 0, style: {setProperty(key, value) { this[key] = value; }}, listeners: new Map(), removed: false,
    addEventListener(type, fn) { this.listeners.set(type, fn); },
    remove() { this.removed = true; },
    focus() {}, select() {},
    dispatch(type, event = {}) { this.listeners.get(type)?.(event); }
  });
  const parent = { children: [], append(input) { this.children.push(input); } };
  const calls = { render: 0, execute: [] };
  const context = {
    document: { createElement: textarea },
    canvas: { parentElement: parent, focus() {} },
    scale: 1, screen: p => ({ x: p.x, y: p.y }),
    Math, safe: fn => fn(), execute: command => calls.execute.push(command),
    fontFamilyFor:()=> 'sans-serif',ctx:{save(){},restore(){},measureText(text){return {width:text.length*8};}},
    render: () => { calls.render++; },
    inlineEditorSize, inlineEditorKeyAction, inlineEditorBackground, normalizeTypedText,
    getComputedStyle: () => ({backgroundColor: 'rgb(0, 0, 0)'}),
    // 예전 시험은 실제 크기 편집(503 설정 inlineTextMinPx:0)으로 돌린다. 기본(14px 하한)은 아래 새 시험이 본다.
    localStorage: {getItem: () => JSON.stringify(settings)}
  };
  vm.runInNewContext(`let inlineTextInput=null,inlineTextEntityId=null,finishInlineText=null;
    ${source.slice(start, end)}
    globalThis.api={editTextInline, get(){return {input:inlineTextInput,id:inlineTextEntityId,finish:finishInlineText};}};`, context);
  return { context, parent, calls, api: context.api };
}

test('inline text editing hides the active source and restores it on save, cancel, and blur', () => {
  const f = loadEditor();
  const first = { id: 'text-a', text: 'old', position: { x: 1, y: 2 }, height: 10 };
  f.api.editTextInline(first);
  assert.equal(f.api.get().id, 'text-a');
  const input = f.api.get().input;
  input.value = 'new'; input.dispatch('keydown', { key: 'Enter', shiftKey: false, preventDefault() {}, stopPropagation() {} });
  assert.equal(f.api.get().id, null);
  assert.equal(input.removed, true);
  assert.equal(f.calls.execute.at(-1).changes.text, 'new');

  const second = { id: 'text-b', text: 'keep', position: { x: 3, y: 4 }, height: 10 };
  f.api.editTextInline(second);
  const secondInput = f.api.get().input;
  f.api.get().finish(false);
  assert.equal(f.api.get().id, null);
  assert.equal(f.calls.execute.length, 1, 'cancel must not persist text');

  f.api.editTextInline(first);
  f.api.get().input.dispatch('blur');
  assert.equal(f.api.get().id, null, 'blur must restore the hidden source');
  assert.ok(f.calls.render >= 3);
});

test('starting another inline editor finishes the previous source before switching', () => {
  const f = loadEditor();
  const a = { id: 'a', text: 'a', position: { x: 0, y: 0 }, height: 10 };
  const b = { id: 'b', text: 'b', position: { x: 0, y: 0 }, height: 10 };
  f.api.editTextInline(a);
  const firstInput = f.api.get().input;
  f.api.editTextInline(b);
  assert.equal(firstInput.removed, true);
  assert.equal(f.api.get().id, 'b');
  f.api.get().finish(false);
  assert.equal(f.api.get().id, null);
});

test('inline editor follows text width as text grows and shrinks, without enlarging small text',()=>{
 const f=loadEditor();f.api.editTextInline({id:'small',text:'ab',position:{x:0,y:0},height:2});
 const input=f.api.get().input;assert.equal(input.style.fontSize,'2.3px');assert.equal(input.style.width,'24px');
 input.value='abcdefgh';input.dispatch('input');assert.equal(input.style.width,'72px');
 const height=Number.parseFloat(input.style.height);input.value='a\nb';input.dispatch('input');
 assert.equal(input.style.width,'16px');assert.ok(Number.parseFloat(input.style.height)>height);
 assert.equal(input.wrap,'off');f.api.get().finish(false);
});
test('rotated multiline editing keeps its first baseline pivot as height changes',()=>{
 const f=loadEditor();f.api.editTextInline({id:'rotated',text:'a',position:{x:10,y:20},height:10,rotation:90});
 const input=f.api.get().input,pivot=input.style.transformOrigin,top=input.style.top;
 assert.equal(pivot,'0 11.5px');input.value='a\nb\nc';input.dispatch('input');
 assert.equal(input.style.transformOrigin,pivot);assert.equal(input.style.top,top);
 f.api.get().finish(false);
});

test('inline editor follows zoom and pan while it is open', () => {
 const f = loadEditor();
 f.api.editTextInline({ id: 'text-z', text: '151.25', position: { x: 100, y: 200 }, height: 10 });
 const input = f.api.get().input;
 assert.equal(input.style.fontSize, '11.5px'); assert.equal(input.style.left, '100px');
 // Zoom out to half and pan: the editor must take the text's new screen place and size, not stay where it opened.
 f.context.scale = .5; f.context.screen = p => ({ x: p.x * .5 + 40, y: p.y * .5 + 10 });
 f.context.placeInlineText();
 assert.equal(input.style.fontSize, '5.75px'); assert.equal(input.style.left, '90px');
 assert.equal(input.style.top, (110 - 5.75) + 'px'); assert.equal(input.style.transformOrigin, '0 5.75px');
 f.api.get().finish(false);
 assert.equal(f.context.placeInlineText, null, 'closing the editor stops following the view');
});

test('503: 기본은 작은 글자를 14px 로 키워 보여 주고(배율 안내), 한글 조합 중 Enter 는 저장하지 않는다', () => {
 const f = loadEditor({});
 f.api.editTextInline({id: 'tiny', text: '가', position: {x: 0, y: 0}, height: 2});
 const input = f.api.get().input;
 assert.equal(input.style.fontSize, '14px'); assert.match(input.title, /×6\.1/);
 // 배경은 기본 투명(필수 품질 기준 INLINE_TEXT_COMPACT_TRANSPARENT), 설정 inlineTextBackground:true 일 때만 반투명.
 assert.equal(input.style.background ?? '', '');
 const shaded = loadEditor({inlineTextBackground: true});
 shaded.api.editTextInline({id: 'tiny', text: '가', position: {x: 0, y: 0}, height: 2});
 assert.equal(shaded.api.get().input.style.background, 'rgba(0,0,0,0.76)');
 input.value = '가나';
 input.dispatch('keydown', {key: 'Enter', isComposing: true, preventDefault() { throw Error('조합 중에는 막지 않는다'); }, stopPropagation() {}});
 assert.equal(f.api.get().id, 'tiny'); assert.equal(f.calls.execute.length, 0);
 input.value = '%%c20';
 input.dispatch('keydown', {key: 'Enter', preventDefault() {}, stopPropagation() {}});
 assert.equal(f.calls.execute[0].changes.text, 'Ø20');
});
