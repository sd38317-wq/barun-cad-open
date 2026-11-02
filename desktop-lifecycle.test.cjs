const test=require('node:test');const assert=require('node:assert/strict');const {CloseController}=require('./desktop-lifecycle.cjs');
const {externalDrawingArgs,backendEnvironment}=require('./desktop-files.cjs');
const fs=require('node:fs');
const os=require('node:os');const path=require('node:path');
function fixture(choice,save=async()=>true){const calls=[];const c=new CloseController({choose:async()=>choice,save:async()=>{calls.push('save');return save();},retry:()=>calls.push('retry'),report:e=>calls.push(e.message)});return {c,calls,event:{preventDefault:()=>calls.push('allow')}};}
test('cancel keeps window and skips saving',async()=>{const f=fixture('cancel');await f.c.blocked(f.event);assert.deepEqual(f.calls,[]);assert.equal(f.c.pending,false);});
test('discard permits one retry only',async()=>{const f=fixture('discard');await f.c.blocked(f.event);await f.c.blocked(f.event);assert.deepEqual(f.calls,['retry','allow']);assert.equal(f.c.allowed,false);});
test('successful save precedes retry',async()=>{const f=fixture('save');await f.c.blocked(f.event);assert.deepEqual(f.calls,['save','retry']);});
test('cancelled save leaves drawing open',async()=>{const f=fixture('save',async()=>false);await f.c.blocked(f.event);assert.deepEqual(f.calls,['save']);assert.equal(f.c.allowed,false);});
test('disk or export failure never closes window',async()=>{const f=fixture('save',async()=>{throw Error('disk full');});await f.c.blocked(f.event);assert.deepEqual(f.calls,['save','disk full']);assert.equal(f.c.allowed,false);});
test('every close that does not happen reports aborted so the next X works',async()=>{
 for(const [choice,save] of [['cancel'],['save',async()=>false],['save',async()=>{throw Error('x');}]]){
  let aborted=0;const c=new CloseController({choose:async()=>choice,save:save||(async()=>true),retry:()=>{},report:()=>{},aborted:()=>aborted++});
  await c.blocked({});assert.equal(aborted,1,choice);
 }
 let aborted=0;const c=new CloseController({choose:async()=>'discard',save:async()=>true,retry:()=>{},report:()=>{},aborted:()=>aborted++});
 await c.blocked({});await c.blocked({preventDefault(){}});assert.equal(aborted,0);
});
test('duplicate X presses do not prompt or save twice',async()=>{let resolve;let prompts=0;const calls=[];const c=new CloseController({choose:()=>{prompts++;return new Promise(r=>resolve=r);},save:async()=>true,retry:()=>calls.push('retry'),report:()=>{}});const first=c.blocked({});await c.blocked({});assert.equal(prompts,1);resolve('discard');await first;assert.deepEqual(calls,['retry']);});
test('Windows association arguments accept only supported absolute drawings',{skip:process.platform!=='win32'&&'Windows 경로는 Windows 에서만 절대 경로다'},()=>{assert.deepEqual(externalDrawingArgs(['Barun CAD.exe','C:\\Work\\plan.DWG','C:\\Work\\plan.DWG','C:\\Work\\note.txt','relative.dxf']),['C:\\Work\\plan.DWG']);});
test('macOS open-file paths accept only supported absolute drawings',{skip:process.platform==='win32'&&'POSIX 경로는 macOS 에서 확인한다'},()=>{assert.deepEqual(externalDrawingArgs(['/Users/me/plan.DWG','/Users/me/plan.DWG','/Users/me/note.txt','relative.dxf']),['/Users/me/plan.DWG']);});
test('macOS engine and shell share ~/Library/Application Support for user data',()=>{
  const {localDataRoot,backendEnvironment}=require('./desktop-files.cjs');
  assert.equal(localDataRoot({HOME:'/Users/me'},'darwin'),path.join('/Users/me','Library','Application Support'));
  assert.equal(localDataRoot({LOCALAPPDATA:'C:\\Users\\me\\AppData\\Local'},'win32'),'C:\\Users\\me\\AppData\\Local');
  assert.equal(backendEnvironment({HOME:'/Users/me'},undefined,'darwin').LOCALAPPDATA,path.join('/Users/me','Library','Application Support'));
  assert.equal(backendEnvironment({HOME:'/Users/me'},undefined,'win32').LOCALAPPDATA,undefined);
});
test('packaged backend receives the verified design catalogue explicitly',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'barun-catalog-')),local=path.join(root,'Local'),catalog=path.join(root,'cases');
 try{fs.mkdirSync(path.join(local,'BarunCAD'),{recursive:true});fs.mkdirSync(catalog);fs.writeFileSync(path.join(catalog,'catalog.sqlite'),'fixture');fs.writeFileSync(path.join(local,'BarunCAD','design-cases.json'),JSON.stringify({catalogPath:catalog}));
  const environment=backendEnvironment({LOCALAPPDATA:local,USERPROFILE:root});assert.equal(environment.BARUN_DESIGN_CATALOG,path.resolve(catalog));
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('BCAD opened from the desktop picker bypasses the DWG/DXF converter',()=>{const renderer=fs.readFileSync('app.js','utf8');assert.match(renderer,/importDrawingPath&&\/\\\.\(dxf\|dwg\)\$\/i\.test\(name\)/);assert.match(renderer,/readExternalFile\(target\)/);});
test('uninstaller closes CAD and its backend before removing installed files',()=>{const script=fs.readFileSync('build/installer.nsh','utf8');assert.match(script,/taskkill \/IM "Barun CAD\.exe" \/T \/F/);assert.match(script,/taskkill \/IM "barun-cad-server\.exe" \/T \/F/);});
test('installer recreates public desktop and start menu shortcuts after an update',()=>{const script=fs.readFileSync('build/installer.nsh','utf8');assert.match(script,/SetShellVarContext all[\s\S]*CreateShortCut "\$DESKTOP\\바른 CAD\.lnk" "\$INSTDIR\\Barun CAD\.exe"/);assert.match(script,/CreateShortCut "\$SMPROGRAMS\\바른 CAD\.lnk"/);});
test('updater reports progress without blocking drawing work',()=>{const desktop=fs.readFileSync('desktop.cjs','utf8'),preload=fs.readFileSync('desktop-preload.cjs','utf8');assert.match(desktop,/download-progress/);assert.match(desktop,/cad:update-status/);assert.match(preload,/onUpdateStatus/);assert.doesNotMatch(desktop,/await \(found\.downloadPromise/);});
test('first packaged launch waits for Windows to finish scanning the local engine',()=>{const desktop=fs.readFileSync('desktop.cjs','utf8');assert.match(desktop,/app\.isPackaged\?90000:30000/);assert.match(desktop,/Date\.now\(\)<deadline/);assert.match(desktop,/worker\.exitCode!==null/);assert.doesNotMatch(desktop,/for\(let i=0;i<100;i\+\+\)/);});
test('downloaded update can be applied from the common account dialog and includes release notes',()=>{const desktop=fs.readFileSync('desktop.cjs','utf8'),preload=fs.readFileSync('desktop-preload.cjs','utf8'),renderer=fs.readFileSync('app.js','utf8'),adapter=fs.readFileSync('shared-account-adapter.js','utf8'),shared=fs.readFileSync('shared/account-window/renderer.mjs','utf8'),contract=fs.readFileSync('shared/account-window/contract/account-window.json','utf8');assert.match(desktop,/cad:apply-update/);assert.match(desktop,/releaseNotes/);assert.match(preload,/applyUpdate/);assert.match(renderer,/installCadAccountWindow/);assert.match(adapter,/업데이트 적용/);assert.match(adapter,/applyUpdate/);assert.match(shared,/이번 업데이트/);assert.match(contract,/카카오 로그인/);assert.match(contract,/로그아웃/);});
