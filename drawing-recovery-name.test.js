import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {COMMANDS} from './commands.js';
import {recoveryOffer,recoveryRowLabel,showRecoveryDialog} from './drawing-tabs.js';

test('218 · DRAWINGRECOVERY 이름을 두고, 예전 RECOVER 도 같은 일을 한다',()=>{
  const names=COMMANDS.map(c=>c.name);
  assert.ok(names.includes('DRAWINGRECOVERY'));assert.ok(names.includes('RECOVER'),'옛 사용 습관 유지');
  const app=readFileSync(new URL('./app.js',import.meta.url),'utf8');
  assert.match(app,/studio\.handlers\.DRAWINGRECOVERY=\(\)=>studio\.handlers\.RECOVER\(\);/);
});

test('218 · 복구 목록 한 줄에 원본 경로·복구본 시각·객체 수를 함께 보여 준다',()=>{
  const savedAt=Date.UTC(2026,9,14,3,0,0);
  const row=recoveryRowLabel({name:'평면',filePath:'D:/도면/평면.dxf',dirty:true,doc:{entities:[{},{},{}]}},savedAt);
  assert.match(row,/^평면 \(저장 안 한 편집\) · 원본 D:\/도면\/평면\.dxf · 복구본 .+ · 객체 3개$/);
  assert.match(recoveryRowLabel({name:'새 도면 1'},0),/원본 저장한 적 없음 · 복구본 시각 모름/);
  const offer=recoveryOffer({saved:{savedAt,tabs:[{name:'A',dirty:true,filePath:'x.dxf'},{name:'A',dirty:false}]},startFresh:true,closedCleanly:false});
  assert.deepEqual(offer.names,['A','A'],'이름 목록은 예전 그대로');
  assert.equal(offer.rows.length,2);assert.match(offer.rows[0],/원본 x\.dxf/);assert.match(offer.rows[1],/저장한 적 없음/);
});

test('218 · 되살리기 창은 rows 가 있으면 그것을, 없으면 이름을 보여 준다',()=>{
  const made=[];const node=()=>({children:[],append(...xs){this.children.push(...xs);},setAttribute(){},addEventListener(){},remove(){}});
  const doc={createElement:tag=>{const n=node();n.tag=tag;made.push(n);return n;},body:node()};
  showRecoveryDialog({count:1,names:['평면'],rows:['평면 · 원본 a.dxf · 복구본 t'],onRecover(){},onFresh(){}},doc);
  assert.deepEqual(made.filter(n=>n.tag==='li').map(n=>n.textContent),['평면 · 원본 a.dxf · 복구본 t']);
  made.length=0;showRecoveryDialog({count:1,names:['평면'],onRecover(){},onFresh(){}},doc);
  assert.deepEqual(made.filter(n=>n.tag==='li').map(n=>n.textContent),['평면']);
  assert.match(made.find(n=>n.tag==='p').textContent,/DRAWINGRECOVERY\(또는 RECOVER\)/);
});
