import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

test('unchanged selection operations do not invalidate the cached drawing',()=>{
 const source=fs.readFileSync(new URL('./app.js',import.meta.url),'utf8');
 const start=source.indexOf('class SelectionSet extends Set');
 const end=source.indexOf('\n}',start)+2;
 const context=vm.createContext({});
 vm.runInContext('let selectionRevision=0;'+source.slice(start,end)+';globalThis.selection=new SelectionSet();globalThis.revision=()=>selectionRevision;',context);
 const before=context.revision();
 context.selection.clear();context.selection.delete('absent');assert.equal(context.revision(),before);
 context.selection.add('a');const selected=context.revision();context.selection.add('a');assert.equal(context.revision(),selected);
 assert.equal(context.selection.delete('a'),true);assert.equal(context.revision(),selected+1);
});
