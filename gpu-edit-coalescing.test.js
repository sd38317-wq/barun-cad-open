import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('./app.js',import.meta.url),'utf8');
const start=source.indexOf('function mergePendingGpuEdit('),end=source.indexOf('\nfunction execute(',start);
const merge=vm.runInNewContext(source.slice(start,end)+';mergePendingGpuEdit');
const delta=(doc,rev,removed,added)=>({previousDoc:doc,previousRevision:rev,lightweight:true,removed,added});
test('rapid MOVE and UNDO cancel without losing the last painted revision',()=>{
 const original={id:'line'},moved={id:'line'},before={},after={};
 const result=merge(delta(before,4,[original],[moved]),delta(after,5,[moved],[original]));
 assert.equal(result.previousDoc,before);assert.equal(result.previousRevision,4);
 assert.equal(result.removed.length,0);assert.equal(result.added.length,0);
});
test('rapid repeated edits preserve the original and final entity references',()=>{
 const a={id:'a'},b={id:'a'},c={id:'a'},added={id:'new'},before={};
 const first=merge(delta(before,1,[a],[b]),delta({},2,[b],[c,added]));
 assert.equal(first.removed[0],a);assert.equal(first.added[0],c);assert.equal(first.added[1],added);
 const final=merge(first,delta({},3,[added],[]));
 assert.equal(final.removed.length,1);assert.equal(final.added.length,1);assert.equal(final.added[0],c);
});
test('painted GPU frames consume the pending edit and unknown changes invalidate it',()=>{
 assert.match(source,/if\(gpuDrawn&&!gpuView\.stats\.workerPending\)gpuEdit=null/);
 assert.match(source,/engine\.onChange\(\(\) => \{\s*gpuEdit=null/);
});
