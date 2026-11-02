import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

test('202 · 엔진 머리에 "객체 페이징을 만들지 않는다" 결정이 남아 있고, 그 대신 쓰는 모듈이 실제로 있다',()=>{
  const engine=readFileSync(new URL('./engine.js',import.meta.url),'utf8');
  assert.match(engine,/AutoCAD 도 객체 페이징을 하지 않는다/);
  assert.match(engine,/closeAndPage 는 close 로 바로 넘어가는/);
  assert.match(engine,/다시 만들지 말 것/);
  for(const file of ['entity-stubs.js','undo-log.js','history-delta.js'])assert.ok(readFileSync(new URL('./'+file,import.meta.url),'utf8').length>500,file);
  const server=readFileSync(new URL('./server.py',import.meta.url),'utf8');
  for(const file of ['entity-stubs.js','handle-table.js','undo-log.js','history-delta.js','low-memory.js','entity-refs.js','bcad-store.js'])assert.ok(server.includes("'/"+file+"'"),'server.py 허용 목록: '+file);
});
