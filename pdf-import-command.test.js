import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {COMMANDS,resolveCommand} from './commands.js';
import {MENU_CATALOG} from './menu-catalog.js';
import {ROUTE_TIMEOUT_MS} from './studio.js';

const app=readFileSync(new URL('./app.js',import.meta.url),'utf8').replace(/\r\n/g,'\n');

test('PDFIMPORT: 명령·메뉴(변환 → 자료 입출력)·엔진 시간 제한이 있다',()=>{
  assert.ok(COMMANDS.some(c=>c.name==='PDFIMPORT'&&c.label==='PDF 가져오기'));
  assert.equal(resolveCommand('PDFIMPORT',{aliases:{}}),'PDFIMPORT');
  const items=MENU_CATALOG.convert.sections.flatMap(s=>s.items||s.commands||[]).map(i=>typeof i==='string'?i:i.name||i.command);
  assert.ok(items.includes('PDFIMPORT'),'변환 탭에 PDF 가져오기');
  assert.ok(ROUTE_TIMEOUT_MS['pdf-import']>=ROUTE_TIMEOUT_MS.default);
});

test('PDFIMPORT: 한 번의 되돌리기로 PDF-IMPORT 레이어에 addMany',()=>{
  const start=app.indexOf("if(mode==='PDFIMPORT'){\n    if(phase!=='point'");
  assert.ok(start>0);
  const block=app.slice(start,app.indexOf('reset();return;',start));
  const begin=block.indexOf('beginTransaction'),end=block.indexOf('endTransaction');
  assert.ok(begin>=0&&end>begin);
  assert.match(block.slice(begin,end),/type:'layer\.add',name:'PDF-IMPORT'/);
  assert.match(block.slice(begin,end),/type:'addMany'/);
  assert.match(app,/studio\.api\('pdf-import'/);
});
