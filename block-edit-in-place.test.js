import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const source=readFileSync(new URL('./app.js',import.meta.url),'utf8');

test('블록 더블클릭은 숫자 칸 창이 아니라 도면 위 제자리 편집으로 들어간다',()=>{
 assert.match(source,/else if\(hit\.type==='block'&&!\(typeof blockEdit!=='undefined'&&blockEdit\)\)safe\(\(\)=>startBlockEdit\(\)\);/);
 assert.match(source,/if\(name==='REFEDIT'\)\{startBlockEdit\(\);return;\}/);
 assert.doesNotMatch(source,/function openBlockEditor\(/);
});

test('편집 중 블록 밖 객체는 선택 집합에 들어가지 않는다',()=>{
 const start=source.indexOf('class SelectionSet extends Set'),end=source.indexOf('\n}',start)+2;
 const context=vm.createContext({});
 vm.runInContext('let selectionRevision=0;let blockEditOutside=new Set(["out"]);'+source.slice(start,end)+';globalThis.s=new SelectionSet(["out","in"]);s.add("out");s.add("in2");globalThis.ids=JSON.stringify([...s]);',context);
 assert.equal(context.ids,'["in","in2"]');
});

test('저장은 같은 블록 머리(id·이름·레이어)로 다시 묶고 되돌리기 한 번으로 줄이며, 파일 저장·열기 전에는 먼저 묶는다',()=>{
 assert.match(source,/\{type:'add',entity:\{\.\.\.session\.header,entities:edited\}\}/);assert.match(source,/\{type:'shared\.define',key,entities:/);
 assert.match(source,/const at=engine\.undoStack\.indexOf\(session\.startDoc\);\s*if\(at>=0\)\{engine\.undoStack\.length=at\+1;engine\.redoStack=\[\];\}/);
 assert.match(source,/blockEdit&&\['SAVE','SAVEAS','QSAVE','DXFOUT','DWGOUT','PLOT','PDF','OPEN','NEW','CLOSE'\]\.includes\(name\)/);
 assert.match(source,/paintBlockEditFocus\(palette,drawingBox\)/);
});
