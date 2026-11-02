import test from 'node:test';
import assert from 'node:assert/strict';
import {sequenceDimensions, directionFrom, installDimSequence} from './dim-sequence.js';
import {DIM_PRESETS, dimPresetValues} from './dimension-style.js';
import * as G from './geometry.js';

test('방향: 가장 가까운 축', () => {
 assert.equal(directionFrom({x: 0, y: 0}, {x: 10, y: 3}), 'right');
 assert.equal(directionFrom({x: 0, y: 0}, {x: -10, y: 3}), 'left');
 assert.equal(directionFrom({x: 0, y: 0}, {x: 1, y: -30}), 'down');
 assert.throws(() => directionFrom({x: 1, y: 1}, {x: 1, y: 1}));
});

test('연속치수: 칸마다 한 개 + 전체, 측정값이 간격과 같음', () => {
 const {dims, end, length} = sequenceDimensions({start: {x: 100, y: 200}, direction: 'right', spacings: [3000, 3600, 2700], offset: 1000, rowGap: 700});
 assert.equal(dims.length, 4);
 assert.deepEqual(end, {x: 9400, y: 200});
 assert.equal(length, 9300);
 const measure = (d) => Math.abs(d.points[1].x - d.points[0].x) || Math.abs(d.points[1].y - d.points[0].y);
 assert.deepEqual(dims.map(measure), [3000, 3600, 2700, 9300]);
 assert.equal(dims[0].points[2].y, 1200, '위쪽 1000');
 assert.equal(dims[3].points[2].y, 1900, '전체 치수는 한 줄 더 바깥');
 // 실제 치수 기하에서 읽히는 숫자
 const parts = G.dimensionParts ? G.dimensionParts(dims[1]) : null;
 if (parts) assert.ok(parts.some(p => p.type === 'text' && /3600/.test(p.text)));
});

test('연속치수: 세로·아래(오른쪽)·전체 없음', () => {
 const {dims} = sequenceDimensions({start: {x: 0, y: 0}, direction: 'down', spacings: [6000, 2100], side: 'below', offset: 500, total: false, style: {textHeight: 200}});
 assert.equal(dims.length, 2);
 assert.equal(dims[0].mode, 'vertical');
 assert.deepEqual(dims[1].points[1], {x: 0, y: -8100});
 assert.equal(dims[0].points[2].x, 500, '세로 below = 오른쪽');
 assert.equal(dims[0].textHeight, 200);
 assert.throws(() => sequenceDimensions({start: {x: 0, y: 0}, spacings: []}));
});

test('치수 프리셋 × 축척', () => {
 const v = dimPresetValues('general', 100);
 assert.equal(v.textHeight, 250);
 assert.equal(v.arrowSize, 125);
 assert.equal(v.precision, 0);
 assert.equal(dimPresetValues('structure', 50).textHeight, 100);
 assert.ok(DIM_PRESETS.detail);
 assert.throws(() => dimPresetValues('none', 100));
 assert.throws(() => dimPresetValues('general', 0));
});

test('DIMSEQ 명령: 방향 클릭, 크게 프리셋, 간격 기억', async () => {
 const clicks = [{x: 0, y: 0}, {x: 0, y: 5000}];const committed = [];let pending;const store = new Map();
 const cmds = installDimSequence({ensureLayer:name=>{assert.equal(name,'A-DIM');return 'dimensions';},getSettings: () => ({denominator: 100}), pickPoint: async () => clicks.shift(), toast: () => {},
  storage: {getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v)},
  styledDimension: (d) => ({...d, textHeight: 200, arrowSize: 100, textGap: 50, dimStyle: 'STANDARD'}),
  commit: (r) => committed.push(...r.entities),
  form: (t, fields, apply) => { pending = (v) => apply({...Object.fromEntries(fields.map(f => [f.name, f.value])), ...v}); }});
 cmds.DIMSEQ();
 await pending({spacings: '3000*2', size: 'large'});
 assert.equal(committed.length, 3);
 assert.equal(committed[0].mode, 'vertical');
 assert.equal(committed[0].textHeight, 250);
 assert.equal(committed[0].dimStyle, 'STANDARD');
 assert.equal(committed[0].points[2].x, -1000, '위(세로=왼쪽) 10mm × 1:100');
 assert.equal(store.get('barun-dimseq-spacing'), '3000*2');
});

test('치수 기하: 크기 값이 없고 scale 이 있으면 기본 크기를 두 번 곱하지 않음 (검토 인접 결함)', () => {
 const parts = G.dimensionParts({type: 'dimension', mode: 'horizontal', points: [{x: 0, y: 0}, {x: 10000, y: 0}, {x: 0, y: 1000}], textHeight: 2.5, scale: 100});
 const ticks = parts.filter(p => p.type === 'line' && Math.abs(Math.hypot(p.points[1].x - p.points[0].x, p.points[1].y - p.points[0].y)) < 1000);
 for (const t of ticks) assert.ok(Math.hypot(t.points[1].x - t.points[0].x, t.points[1].y - t.points[0].y) < 300, '눈금 길이는 문자 높이(250) 수준');
 const text = parts.find(p => p.type === 'text');
 assert.equal(text.height, 250);
 assert.ok(Math.abs(text.position.y - 1000) < 250, `문자는 치수선 가까이 (${text.position.y})`);
});


test('DIMSEQ 방향 선택 중 전체 치수 미리보기는 클릭 결과와 동일한 기하를 만든다', async () => {
 const clicks=[{x:0,y:0},{x:0,y:5000}]; let opts; let pending; const committed=[];
 const ctx={ensureLayer:name=>{assert.equal(name,'A-DIM');return 'dimensions';},getSettings:()=>({denominator:100}), storage:{getItem:()=>null,setItem:()=>{}}, styledDimension:d=>({...d,textHeight:200,arrowSize:100,textGap:50}), commit:r=>committed.push(...r.entities), toast:()=>{}, form:(t,fs,apply)=>{pending=apply}, pickPoint:async arg=>{ if(typeof arg==='object') {opts=arg; return clicks.shift();} return clicks.shift(); }};
 const cmd=installDimSequence(ctx); cmd.DIMSEQ(); await pending({spacings:'3000*2', scale:100, offsetPaper:10, rowPaper:7, total:true, direction:'pick', side:'above', size:'normal'});
 const preview=opts.preview({x:0,y:5000}); assert.equal(preview.length,3); assert.deepEqual(preview.map(d=>d.points),committed.map(d=>d.points));
});
