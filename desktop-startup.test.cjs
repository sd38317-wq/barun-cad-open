const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {createStartupWindow}=require('./desktop-startup.cjs');
function fixture(){
 const calls=[],listeners={},counts={show:0,close:0};let destroyed=false;
 const view={
  webContents:{once:(n,fn)=>{listeners[n]=fn;},executeJavaScript:code=>{calls.push(code);return Promise.resolve();}},
  once:(n,fn)=>{listeners[n]=fn;},isDestroyed:()=>destroyed,removeMenu(){},
  loadFile(){return Promise.resolve();},show(){counts.show++;},
  close(){counts.close++;destroyed=true;listeners.closed?.();}
 };
 return {view,calls,listeners,counts,destroy:()=>{destroyed=true;listeners.closed?.();}};
}
const mount=(f,options={})=>createStartupWindow({BrowserWindow:class{constructor(){return f.view;}},baseDir:'.',...options});
test('startup buffers the latest real status until its local page has loaded',()=>{
 const f=fixture(),s=mount(f);s.status({phase:'엔진 확인'});s.status({phase:'화면 준비'});
 assert.equal(f.calls.length,0);f.listeners['did-finish-load']();
 assert.equal(f.calls.length,1);assert.match(f.calls[0],/화면 준비/);assert.doesNotMatch(f.calls[0],/progress|percent/);
});
test('programmatic completion closes once and never triggers user cancellation or a late show',()=>{
 const f=fixture();let cancelled=0;const s=mount(f,{onCancel:()=>cancelled++});
 s.close();s.close();f.listeners['ready-to-show']();s.status({phase:'late'});
 assert.deepEqual(f.counts,{show:0,close:1});assert.equal(cancelled,0);assert.equal(f.calls.length,0);
});
test('closing startup by the user cancels startup and cannot show the closed window',()=>{
 const f=fixture();let cancelled=0;const s=mount(f,{onCancel:()=>cancelled++});
 f.destroy();f.listeners['ready-to-show']();s.close();assert.equal(s.cancelled,true);assert.equal(cancelled,1);assert.equal(f.counts.show,0);
});
test('startup HTML failure keeps a hidden window until main is ready, avoiding window-all-closed',async()=>{
 const f=fixture();f.view.loadFile=()=>Promise.reject(Error('missing optional page'));
 let cancelled=0;const s=mount(f,{onCancel:()=>cancelled++});
 await new Promise(resolve=>setImmediate(resolve));assert.equal(cancelled,0);assert.equal(s.cancelled,false);assert.equal(f.counts.close,0);f.listeners['ready-to-show']();assert.equal(f.counts.show,0);s.close();assert.equal(f.counts.close,1);
});
test('both desktop paths share a hidden main window that takes over only when ready',()=>{
 const d=fs.readFileSync('desktop.cjs','utf8');
 assert.match(d,/multiProcess=!process\.argv\.includes\('--barun-single-window'\)/);
 assert.match(d,/startup\.error\(message\)/);
 assert.match(d,/window=new BrowserWindow\(\{show:false/);
 assert.match(d,/window\.once\('ready-to-show',\(\)=>\{window\.show\(\);startup\.close\(\);\}\)/);
 assert.match(d,/if\(startup\.cancelled\)return/);
});
test('all official configurations and the default configuration carry the local startup files',()=>{
 const configs=[require('./package.json').build,...['official5','official6','official6.mac'].map(name=>JSON.parse(fs.readFileSync('electron-builder.'+name+'.json','utf8')))];
 for(const config of configs)for(const file of ['desktop-startup.cjs','desktop-startup.html'])assert.ok(config.files.includes(file),file+' missing');
 const html=fs.readFileSync('desktop-startup.html','utf8');
 assert.match(html,/receivedAt:Date\.now\(\)/);assert.match(html,/visibilitychange/);assert.doesNotMatch(html,/<(?:script|link)[^>]*(?:src|href)=/);
});
