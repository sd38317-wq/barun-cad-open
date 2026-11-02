// 명령이 끝난 뒤 작업 중 고른 객체·새로 만든 문·창이 선택된 채 남지 않게(10-24 시험판 확인).
// 남으면 다음 MOVE·BLOCK·ERASE 가 그 선을 집어 간다(해치 A40 과 같은 문제).
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=name=>readFileSync(new URL('./'+name,import.meta.url),'utf8');
const app=read('app.js');

test('TRIM·EXTEND 를 Enter·Space·오른쪽 클릭으로 끝내면 경계로 고른 선을 놓는다',()=>{
 assert.match(app,/if \(\["LINE", "WALL", "TRIM", "EXTEND"\]\.includes\(mode\)\) \{(?:\s*\/\/[^\n]*)?\s*if \(\["TRIM", "EXTEND"\]\.includes\(mode\)\) setSelected\(\[\]\);\s*reset\(\);/);
});

test('카드 결과 저장은 select:false 면 새 객체를 고르지 않고 직전 선택(P)으로만 남긴다',()=>{
 assert.match(app,/function commitCardResult\(\{[^}]*select=true[^}]*\}\)/);
 assert.match(app,/if\(select\)setSelected\(ids\);else commandDone\(ids\);/);
});

test('문·창 카드는 넣은 뒤 선택을 남기지 않는다',()=>{
 for(const file of ['door-card.js','window-card.js'])assert.match(read(file),/ctx\.commit\(\{removeIds:cut\.removeIds,entities[^}]*select:false/,file);
});
