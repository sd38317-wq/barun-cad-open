// 객체 속성 편집 창의 색 선택기: 값 매핑, 여러 값 처리, 창 연결, 드롭다운 글자색 규칙.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {parseColor, colorChanges} from './cad-properties.js';
import {aciColor} from './lisp-host.js';
import {colorInputText, describeColorText, hasMixedColor, colorFieldChanged, STANDARD_ACI} from './color-picker.js';

const read = (name) => fs.readFileSync(new URL(name, import.meta.url), 'utf8');

test('견본이 색 칸에 적는 글자는 parseColor 를 거쳐 같은 색으로 돌아온다', () => {
 assert.equal(colorInputText({mode: 'bylayer'}), 'BYLAYER');
 assert.equal(colorInputText({mode: 'byblock'}), 'BYBLOCK');
 for (let aci = 1; aci <= 255; aci++) {
  const spec = parseColor(colorInputText({mode: 'aci', aci}));
  assert.deepEqual(spec, {mode: 'aci', aci, color: aciColor(aci)});
  assert.deepEqual(colorChanges(spec), {color: aciColor(aci), aci, colorMode: 'aci'});
 }
 const tc = parseColor(colorInputText({mode: 'truecolor', color: '#12ab34'}));
 assert.deepEqual(colorChanges(tc), {color: '#12ab34', aci: null, colorMode: 'truecolor'});
 assert.deepEqual(colorChanges(parseColor('BYLAYER')), {color: null, aci: null, colorMode: null});
 assert.deepEqual(colorChanges(parseColor('BYBLOCK')), {color: null, aci: null, colorMode: 'byblock'});
});

test('표준 색은 1~9번이고 현재 색 견본은 값에 맞는 색과 이름을 준다', () => {
 assert.deepEqual([...STANDARD_ACI], [1, 2, 3, 4, 5, 6, 7, 8, 9]);
 assert.equal(describeColorText('1').css, '#ff0000');
 assert.match(describeColorText('1').label, /빨강/);
 assert.equal(describeColorText('BYLAYER', '#00ff00').css, '#00ff00');
 assert.match(describeColorText('BYBLOCK').label, /ByBlock/);
 assert.equal(describeColorText('#ABCDEF').css, '#abcdef');
 assert.equal(describeColorText('없는색'), null);
});

test('여러 객체의 색이 다르면 칸을 비우고, 고르지 않으면 바꾸지 않는다', () => {
 const text = (e) => e.c;
 assert.equal(hasMixedColor([{c: '1'}, {c: '1'}], text), false);
 assert.equal(hasMixedColor([{c: '1'}, {c: 'BYLAYER'}], text), true);
 assert.equal(colorFieldChanged('', '', true), false);
 assert.equal(colorFieldChanged('  ', '', true), false);
 assert.equal(colorFieldChanged('3', '', true), true);
 assert.equal(colorFieldChanged('BYLAYER', '', true), true);
 assert.equal(colorFieldChanged('1', '1', false), false);
 assert.equal(colorFieldChanged('', '1', false), true); // 하나만 고르고 칸을 비우면 ByLayer
});

test('객체 속성 편집 창은 색 선택기와 종류별 속성 팔레트를 쓴다', () => {
 const app = read('./app.js');
 assert.match(app, /from '\.\/color-picker\.js'/);
 assert.match(app, /from '\.\/properties-palette\.js'/);
 assert.match(app, /installColorPicker\(\$\("form-fields"\)\.querySelector\('\[name="color"\]'\)/);
 assert.match(app, /buildPropertyPalette\(es,/);
 assert.match(app, /palette\.commands\(values\)/);
 const picker = read('./color-picker.js');
 for (const word of ['ByLayer', 'ByBlock', "type = 'color'", '표준 색 1~9번', '전체 색 1~255번', 'aria-label']) assert.ok(picker.includes(word), word);
});

test('드롭다운 목록은 어두운 바탕·밝은 글자 규칙을 어느 화면에서나 가진다', () => {
 const style = read('./style.css');
 assert.match(style, /select\{color-scheme:dark;\}/);
 assert.match(style, /select :is\(option,optgroup\)\{background-color:#22262d;color:#eef0f3;\}/);
 const air = read('./barun-air.css');
 assert.match(air, /select option,select optgroup\)\{background:#22262d!important;color:#eef0f3!important;\}/);
 assert.match(style, /\.color-picker\{/);
});
