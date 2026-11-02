import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {resolveCommand} from './commands.js';
const source=fs.readFileSync(new URL('./app.js',import.meta.url),'utf8');
const start=source.indexOf('  const hintPoint=cursor||lastDrawingPointer;'),end=source.indexOf('  $("zoom")',start);
test('typed alias shows full command at the current or last canvas pointer before execution',()=>{
 for(const cursor of [{x:100,y:100},null]){
  const drawn=[];const ctx={save(){},restore(){},measureText:t=>({width:t.length*6}),fillRect(){},strokeRect(){},fillText:t=>drawn.push(t)};
  const c={ctx,cursor,lastDrawingPointer:{x:100,y:100},mode:'SELECT',resolveCommand,settings:{aliases:{LINE:'L'}},$:()=>({value:'l'}),screen:p=>p,width:500,height:500,palette:{}};
  vm.runInNewContext(source.slice(start,end),c);assert.deepEqual(drawn,['LINE']);
 }
});
