// 검토자(Opus) 최종 잔여 지적 · 장치 이름 빈틈(끝 공백·점, 위첨자 숫자)은 셸 필터도 잡는다
import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {localSavePathProblem,deviceStem}=require('./desktop-files.cjs');
const BS=String.fromCharCode(92);
test('device names with trailing space/dot and superscript digits are rejected by the shell filter',()=>{
 assert.equal(deviceStem('COM'+String.fromCharCode(0xB9)+'.dxf'),'COM1');assert.equal(deviceStem('con .dxf'),'CON');assert.equal(deviceStem('CON..dxf'),'CON');assert.equal(deviceStem('console.dxf'),'CONSOLE');
 for(const name of ['con .dxf','CON..dxf','COM'+String.fromCharCode(0xB9)+'.dxf','lpt'+String.fromCharCode(0xB3)+'.tmp.dxf','Nul .dxf'])assert.notEqual(localSavePathProblem(['C:','work',name].join(BS),'dxf','win32'),'',name);
 assert.equal(localSavePathProblem(['C:','work','console.dxf'].join(BS),'dxf','win32'),'');
});
