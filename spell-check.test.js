// 524 맞춤법 검사(spell-check.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import {DrawingEngine} from './engine.js';
import {buildTableBlock} from './table-sheet-tools-4.js';
import {KOREAN_FIXES, ENGLISH_FIXES, USER_DICT_KEY, spellTrim, checkWord, spellScan, buildSpellDictionary, loadUserWords, addUserWord, replaceWord, locateWord, installSpellCheck} from './spell-check.js';

const P = (x, y) => ({x, y});
const memory = (init = {}) => { const m = new Map(Object.entries(init)); return {map: m, getItem: k => m.has(k) ? m.get(k) : null, setItem: (k, v) => m.set(k, String(v))}; };

test('대응표: 20개 이상, 중복 없음, 바른 표기 속에 틀린 표기가 없고 서로 고쳐도 다시 틀리지 않음', () => {
 assert.ok(KOREAN_FIXES.length >= 20);
 assert.equal(new Set(KOREAN_FIXES.map(f => f.wrong)).size, KOREAN_FIXES.length);
 for (const f of KOREAN_FIXES) for (const g of KOREAN_FIXES) assert.ok(g.whole ? f.right !== g.wrong : !f.right.includes(g.wrong), `${f.right} 안에 ${g.wrong}`);
 for (const [w, r] of Object.entries(ENGLISH_FIXES)) assert.notEqual(w, r);
 const pairs = Object.fromEntries(KOREAN_FIXES.map(f => [f.wrong, f.right]));
 assert.equal(pairs['몰타르'], '모르타르');
 assert.equal(pairs['콘크리이트'], '콘크리트');
 assert.equal(pairs['판넬'], '패널');
});

test('spellTrim: 앞뒤 기호만 떼고 가운데는 그대로', () => {
 assert.deepEqual(spellTrim('(판넬),'), {lead: '(', core: '판넬', trail: '),'});
 assert.deepEqual(spellTrim('THK24'), {lead: '', core: 'THK24', trail: ''});
 assert.deepEqual(spellTrim('---'), {lead: '---', core: '', trail: ''});
});

test('checkWord: 한글은 대응표(낱말 속도), 사전·숫자는 통과, 영문 오타는 대소문자 모양 유지, 모르는 영문은 옵션', () => {
 const {dict, english} = buildSpellDictionary([]);
 assert.deepEqual(checkWord('몰타르', dict).suggestions, ['모르타르']);
 assert.deepEqual(checkWord('"방수판넬"', dict).suggestions, ['"방수패널"'], '앞뒤 기호를 다시 붙임');
 assert.deepEqual(checkWord('알미늄샷시', dict).suggestions, ['알루미늄새시'], '한 낱말 속 여러 군데');
 assert.equal(checkWord('스텐실', dict), null, '짧은 스텐은 단어 전체일 때만');
 assert.deepEqual(checkWord('스텐', dict).suggestions, ['스테인리스']);
 assert.equal(checkWord('모르타르', dict), null);
 assert.equal(checkWord('몰탈', dict), null, '우리 재료 목록에 있는 표기는 알리지 않음');
 assert.equal(checkWord('콘크리트', dict), null);
 assert.equal(checkWord('2층', dict), null);
 assert.deepEqual(checkWord('MORTER', dict).suggestions, ['MORTAR']);
 assert.deepEqual(checkWord('Gypsom', dict).suggestions, ['Gypsum']);
 assert.equal(checkWord('Wallz', dict), null, '영문 알림 기본 끔');
 assert.deepEqual(checkWord('Wallz', dict, {english: true, englishDict: english}), {word: 'Wallz', core: 'Wallz', suggestions: [], reason: 'unknown'});
 assert.equal(checkWord('WALL', dict, {english: true, englishDict: english}), null);
 assert.equal(checkWord('THKX', dict, {english: true, englishDict: english}), null, '짧은 대문자는 약어');
 assert.equal(checkWord('concrete', dict, {english: true, englishDict: english}), null);
});

test('사전: 레이어 표준·상세 재료·지시선 재료에서 뽑고, 틀린 표기는 넣지 않으며, 사용자 단어를 더함', () => {
 const {dict, english} = buildSpellDictionary(['바른공법']);
 for (const w of ['벽체', '단열재', '석고보드', '복층유리', '바른공법']) assert.ok(dict.has(w), w);
 assert.ok(english.has('wall') && english.has('conc'));
 for (const f of KOREAN_FIXES) assert.ok(!dict.has(f.wrong), f.wrong);
 assert.equal(checkWord('바른공법', dict), null);
});

test('사용자 사전: 저장·중복 없음·깨짐/막힘에 안전', () => {
 const s = memory();
 assert.deepEqual(loadUserWords(s), []);
 addUserWord(s, '스텐');
 addUserWord(s, '스텐');
 assert.deepEqual(JSON.parse(s.map.get(USER_DICT_KEY)), ['스텐']);
 assert.deepEqual(loadUserWords(memory({[USER_DICT_KEY]: '{깨짐'})), []);
 assert.deepEqual(loadUserWords({getItem: () => { throw Error('x'); }}), []);
 assert.throws(() => addUserWord({getItem: () => null, setItem: () => { throw Error('q'); }}, 'a'), /저장하지 못했습니다/);
 assert.throws(() => addUserWord(s, '  '), /비어/);
 const {dict} = buildSpellDictionary(loadUserWords(s));
 assert.equal(checkWord('스텐', dict), null, '사전에 넣은 말은 알리지 않음');
});

test('spellScan: 522 textSlots 로 치수·속성·표 칸까지, 단어 위치(index) 포함', () => {
 const {dict} = buildSpellDictionary([]);
 const table = {id: 'T', layer: 'L', ...buildTableBlock([['마감', '판넬 THK50']], {height: 100})};
 const es = [{id: 'A', type: 'text', layer: 'L', text: 'THK20 몰타르 위 몰타르'}, {id: 'D', type: 'dimension', layer: 'L', textTemplate: '<> 샷시'},
  {id: 'B', type: 'block', name: 'x', layer: 'L', attributes: {MAT: '콘크리이트'}, entities: []}, table];
 const hits = spellScan(es, dict);
 assert.deepEqual(hits.map(h => [h.id, h.kind, h.word, h.index, h.suggestions[0]]), [
  ['A', 'text', '몰타르', 6, '모르타르'], ['A', 'text', '몰타르', 12, '모르타르'], ['D', 'dimension', '샷시', 3, '새시'],
  ['B', 'attribute', '콘크리이트', 0, '콘크리트'], ['T', 'cell', '판넬', 0, '패널']]);
 assert.deepEqual(spellScan(es, dict, {scope: 'text'}).map(h => h.id), ['A', 'A']);
});

test('replaceWord·locateWord: 그 덩어리만, 자리가 밀려도 찾음', () => {
 assert.equal(replaceWord('판넬 방수판넬 판넬', '판넬', '패널'), '패널 방수판넬 패널');
 assert.equal(replaceWord('판넬 판넬', '판넬', '패널', 3), '판넬 패널');
 assert.equal(replaceWord('판넬', '판넬', '패널', 2), null);
 assert.equal(replaceWord('없음', '판넬', '패널'), null);
 assert.equal(locateWord('모르타르 위 몰타르', '몰타르', 6), 7);
 assert.equal(locateWord('방수판넬', '판넬', 2), null, '낱말 속 일부는 덩어리가 아님');
});

function harness(responses) {
 const engine = new DrawingEngine(), toasts = [], forms = [], zooms = [], storage = memory();
 const ctx = {storage, entities: () => engine.doc.entities, selected: () => [], layers: () => engine.doc.layers, execute: c => engine.execute(c), toast: m => toasts.push(m),
  setSelected: ids => { ctx.sel = ids; }, zoomToBounds: b => zooms.push(b),
  form: (title, fields, onApply) => { forms.push({title, fields}); const r = responses.shift(); if (!r) return; return onApply({...Object.fromEntries(fields.map(f => [f.name, f.value])), ...r}); }};
 return {engine, ctx, toasts, forms, zooms, storage};
}

test('SPELL: 하나 바꾸기 → 모두 바꾸기 → 사전 추가 → 끝, 되돌리기는 바꾼 만큼, 잠긴 레이어는 건너뜀', () => {
 const h = harness([{}, {action: 'replace'}, {action: 'all'}, {action: 'add'}]);
 h.engine.execute({type: 'layer.add', name: '잠김', color: '#ffffff'});
 const lk = h.engine.doc.layers.find(l => l.name === '잠김').id;
 h.engine.execute({type: 'addMany', entities: [
  {type: 'text', layer: 'default', position: P(0, 0), height: 100, text: '몰타르 판넬'},
  {type: 'text', layer: 'default', position: P(0, 500), height: 100, text: '판넬 스텐'},
  {type: 'text', layer: lk, position: P(0, 900), height: 100, text: '판넬'},
  {type: 'block', name: '도곽', layer: 'default', attributes: {MAT: '판넬'}, entities: [{type: 'line', layer: 'default', points: [P(0, 0), P(1, 1)]}]},
 ]});
 h.engine.execute({type: 'layer.update', id: lk, changes: {locked: true}});
 const result = installSpellCheck(h.ctx).SPELL();
 const es = h.engine.doc.entities;
 assert.equal(es[0].text, '모르타르 패널');
 assert.equal(es[1].text, '패널 스텐', '스텐은 사전에 추가해 그대로');
 assert.equal(es[2].text, '판넬', '잠긴 레이어는 그대로');
 assert.equal(es[3].attributes.MAT, '패널', '모두 바꾸기는 속성까지');
 assert.deepEqual(loadUserWords(h.storage), ['스텐']);
 assert.match(h.forms[1].title, /1\/5 · 문자 · "몰타르" · 바른 표기: 모르타르/);
 assert.ok(h.zooms.length >= 3);
 assert.match(h.toasts.at(-1), /바꿈 4곳/);
 assert.match(h.toasts.at(-1), /잠긴 레이어 1곳/);
 h.engine.validate(h.engine.doc);
 for (let i = 0; i < 2; i++) h.engine.execute({type: 'undo'});
 assert.equal(h.engine.doc.entities[0].text, '몰타르 판넬');
});

test('SPELL: 찾을 것이 없으면 알리고, 바꿀 말이 비면 막음', () => {
 const h = harness([{}]);
 h.engine.execute({type: 'addMany', entities: [{type: 'text', layer: 'default', position: P(0, 0), height: 100, text: '모르타르 THK20'}]});
 installSpellCheck(h.ctx).SPELL();
 assert.match(h.toasts.at(-1), /찾지 못했습니다/);
 const g = harness([{}, {action: 'replace', to: ' '}]);
 g.engine.execute({type: 'addMany', entities: [{type: 'text', layer: 'default', position: P(0, 0), height: 100, text: '판넬'}]});
 assert.throws(() => installSpellCheck(g.ctx).SPELL(), /바꿀 말/);
 assert.equal(g.engine.doc.entities[0].text, '판넬');
});
