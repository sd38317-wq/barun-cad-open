const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
test('desktop close confirmation is rendered inside the CAD theme',()=>{
 const desktop=fs.readFileSync(path.join(root,'desktop.cjs'),'utf8');
 const preload=fs.readFileSync(path.join(root,'desktop-preload.cjs'),'utf8');
 const app=fs.readFileSync(path.join(root,'app.js'),'utf8');
 assert.doesNotMatch(desktop,/choose:async\(\)=>\{const r=await dialog\.showMessageBox/);
 assert.match(preload,/onCloseChoiceRequested/);
 assert.match(app,/className='close-confirm'/);
 for(const label of ['저장 후 종료','저장 안 함','취소'])assert.match(app,new RegExp(label));
});
