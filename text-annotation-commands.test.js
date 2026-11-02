// text-annotation-commands.js 시험 — FONTMAP(506)·FIELD(512)·ATTSYNC(521)·TEXTALIGN(523) 명령 흐름(가벼운 ctx 흉내).
import test from 'node:test';
import assert from 'node:assert/strict';
import {installTextAnnotation, fontNoticeOnOpen, FONTMAP_STORAGE, FONT_NOTICE_STORAGE} from './text-annotation-commands.js';
import {loadFontMap, fontFamilyFor} from './text-fonts.js';

const memoryStorage = () => { const m = new Map(); return {getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k), m}; };
const stub = (over = {}) => {
 const log = {toasts: [], executed: [], committed: []};
 const ctx = {storage: memoryStorage(), toast: (m, err) => log.toasts.push([m, !!err]), execute: c => log.executed.push(c), commit: r => { log.committed.push(r); return ['new']; },
  entities: () => [], layers: () => [{id: 'L', name: '0'}], selected: () => [], doc: () => ({entities: []}), refresh() {}, ...over};
 return {ctx, log};
};

test('FONTMAP: 대체표를 저장하면 그리기 글꼴이 바뀌고, 열 때 알림을 끌 수 있다', async () => {
 const {ctx, log} = stub({form: (title, fields, apply) => apply({map: 'hygtre;malgun.ttf\n; 주석\n잘못된줄', action: 'save', notice: 'off'})});
 const tools = installTextAnnotation(ctx);
 await tools.FONTMAP();
 assert.equal(ctx.storage.getItem(FONTMAP_STORAGE), 'hygtre;malgun.ttf');
 assert.equal(ctx.storage.getItem(FONT_NOTICE_STORAGE), '1');
 assert.match(fontFamilyFor({sourceFont: 'HYGTRE.TTF'}), /Malgun Gothic/);
 assert.match(log.toasts.at(-1)[0], /1줄/);
 const doc = {entities: [{type: 'text', sourceFont: 'whgtxt.shx'}]};
 assert.equal(fontNoticeOnOpen(doc, {storage: ctx.storage, toast: () => assert.fail('끈 알림')}), null);
 const shown = [];
 const report = fontNoticeOnOpen(doc, {storage: memoryStorage(), toast: m => shown.push(m)});
 assert.equal(report[0].reason, 'shx'); assert.match(shown[0], /whgtxt\.shx/);
 loadFontMap('');
});

test('FIELD: 고른 객체 면적 필드 문자를 넣는다(틀·값·코드)', async () => {
 const rect = {id: 'r1', type: 'rectangle', points: [{x: 0, y: 0}, {x: 2000, y: 0}, {x: 2000, y: 3000}, {x: 0, y: 3000}]};
 const {ctx, log} = stub({entities: () => [rect], form: (t, f, apply) => apply({kind: 'area', prefix: '면적 ', height: '200'}),
  pickEntity: async () => rect, pickPoint: async () => ({x: 5, y: 6})});
 await installTextAnnotation(ctx).FIELD();
 const e = log.committed[0].entities[0];
 assert.equal(e.text, '면적 6.00㎡'); assert.equal(e.fieldTemplate, '면적 {{0}}'); assert.match(e.fields[0].code, /_ObjId r1/);
});

test('ATTSYNC·TEXTALIGN 은 한 번의 updateMany 로 실행한다', async () => {
 const tag = (t, x, y, text) => ({type: 'text', attributeTag: t, position: {x, y}, height: 10, rotation: 0, text});
 const a = {id: 'a', type: 'block', name: 'B', layer: 'L', position: {x: 0, y: 0}, rotation: 0, scale: 1, attributes: {N: '1'}, entities: [tag('N', 0, -5, '1')]};
 const b = {id: 'b', type: 'block', name: 'B', layer: 'L', position: {x: 100, y: 0}, rotation: 0, scale: 1, attributes: {N: '2'}, entities: [tag('N', 130, 0, '2')]};
 const {ctx, log} = stub({entities: () => [a, b], selected: () => [a]});
 await installTextAnnotation(ctx).ATTSYNC();
 assert.equal(log.executed[0].updates[0].id, 'b');
 assert.deepEqual(log.executed[0].updates[0].changes.entities[0].position, {x: 100, y: -5});
 const t1 = {id: 't1', type: 'text', text: 'AB', height: 10, position: {x: 0, y: 0}}, t2 = {id: 't2', type: 'text', text: 'C', height: 10, position: {x: 50, y: 1}};
 const points = [{x: 0, y: 0}, {x: 100, y: 0.5}];
 const run = stub({selected: () => [t1, t2], form: (t, f, apply) => apply({spacing: '5'}), pickPoint: async () => points.shift()});
 await installTextAnnotation(run.ctx).TEXTALIGN();
 const [u1, u2] = run.log.executed[0].updates;
 assert.deepEqual(u1.changes.position, {x: 0, y: 0});
 assert.ok(Math.abs(u2.changes.position.x - (5 + 2 * 0.65 * 10)) < 1e-9 && u2.changes.position.y === 0);   // 0.3° → 수평에 붙음
 assert.rejects(installTextAnnotation(stub({selected: () => [t1]}).ctx).TEXTALIGN(), /두 개 이상/);
});
