import test from 'node:test';
import assert from 'node:assert/strict';
import {QUICK_MENU_GROUPS, quickMenuModel, readRecent, recordRecent, QUICK_MENU_RECENT_KEY} from './quick-menu.js';
import {COMMANDS} from './commands.js';

const memory = () => { const m = new Map(); return {getItem: k => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v))}; };

test('메뉴판: 있는 명령 모두, 빈 묶음은 빠짐', () => {
 const known = new Set(['LAYER', 'CHPROP', 'HATCH', 'HELP']);
 const model = quickMenuModel(known, n => n.toLowerCase());
 assert.deepEqual(model.groups.map(g => g.key), ['layer', 'property', 'hatch', 'help']);
 assert.equal(model.groups[0].items[0].label, 'layer');
 const all = quickMenuModel(new Set(QUICK_MENU_GROUPS.flatMap(g => g.commands)));
 assert.equal(all.groups.find(g => g.key === 'dimension').items.length, 15, '9개 넘는 명령도 클릭으로 쓸 수 있게 모두 보여 줌');
});

test('메뉴판: 최근 실행은 맨 위, 중복 없이 9개까지, 깨진 저장값은 무시', () => {
 const s = memory();
 for (const n of ['LAYER', 'HATCH', 'LAYER']) recordRecent(s, n);
 assert.deepEqual(readRecent(s), ['LAYER', 'HATCH']);
 const model = quickMenuModel(new Set(['LAYER', 'HATCH']), n => n, readRecent(s));
 assert.equal(model.groups[0].key, 'recent');
 for (let i = 0; i < 20; i++) recordRecent(s, 'C' + i);
 assert.equal(readRecent(s).length, 9);
 s.setItem(QUICK_MENU_RECENT_KEY, '{broken');
 assert.deepEqual(readRecent(s), []);
});

test('메뉴판: 실제 명령 목록 기준으로 대부분의 항목이 존재', () => {
 const known = new Set(COMMANDS.map(c => c.name));
 const model = quickMenuModel(known);
 assert.ok(model.groups.length >= 7);
 assert.ok(model.groups.find(g => g.key === 'dimension').items.some(i => i.name === 'DIMSEQ'));
});
