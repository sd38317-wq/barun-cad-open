const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=__dirname;
const read=name=>fs.readFileSync(path.join(root,name),'utf8');

test('official 6 has an isolated installer and backend',()=>{
 const config=JSON.parse(read('electron-builder.official6.json'));
 assert.equal(config.appId,'kr.barun.cad.v6');
 assert.equal(config.productName,'Barun CAD 6');
 const version=JSON.parse(read('package.json')).version;
 assert.equal(config.extraMetadata.version,version);
 assert.equal(config.directories.output,'installer-'+version);
 assert.equal(config.artifactName,'Barun CAD 6 Setup '+version+'.exe');
 assert.deepEqual(config.extraResources,[{from:'desktop-backend-'+version+'/barun-cad-6-server',to:'backend',filter:['**/*']},{from:'build',to:'file-icons',filter:['file-dwg.ico','file-dxf.ico','file-bcad.ico']}]);
 assert.ok(config.files.includes('desktop-print.cjs'));
 for(const file of ['desktop-print-windows.cjs','desktop-print-windows.ps1'])assert.ok(config.files.includes(file),file);
 assert.deepEqual(config.publish,[{provider:'generic',url:'https://barunarc.co.kr/downloads/barun-cad-6/'}]); // 5·옛 채널(barun-cad/)과 섞이지 않는 6 전용 업데이트 자리
 // 자동 업데이트: electron-builder 가 electron-updater 의 의존 모듈을 빠뜨리므로 빌드 때 한 파일로 묶은 사본을 넣고, 셸은 그것부터 읽는다.
 assert.ok(config.files.includes('vendor/electron-updater.cjs'));
 assert.match(read('build_desktop.py'),/electron-updater\/out\/main\.js','--bundle'/);
 assert.match(read('desktop.cjs'),/require\('\.\/vendor\/electron-updater\.cjs'\)\.autoUpdater/);
 const installer=read('build/installer-official6.nsh');
 assert.match(installer,/Barun\\Barun CAD 6/);
 assert.match(installer,/바른 CAD 6\.lnk/);
});

test('official 6 registers drawing file icons without taking over the default app',()=>{
 for(const name of ['file-dwg.ico','file-dxf.ico','file-bcad.ico']){
  const icon=fs.readFileSync(path.join(root,'build',name));
  assert.equal(icon.readUInt16LE(2),1,name+' is an .ico');
  const sizes=Array.from({length:icon.readUInt16LE(4)},(_,i)=>icon[6+i*16]||256);
  assert.deepEqual(sizes,[16,20,24,32,40,48,64,256],name);
 }
 const installer=read('build/installer-official6.nsh');
 for(const [ext,progId,icon] of [['.dwg','BarunCAD6.DWG','file-dwg.ico'],['.dxf','BarunCAD6.DXF','file-dxf.ico'],['.bcad','BarunCAD6.BCAD','file-bcad.ico']]){
  assert.match(installer,new RegExp(`BarunCad6RegisterType "${progId.replace('.','\\.')}" "[^"]+" "${icon.replace('.','\\.')}"`));
  assert.match(installer,new RegExp(`BarunCad6RegisterExtension "\\${ext}" "${progId.replace('.','\\.')}"`));
  assert.match(installer,new RegExp(`BarunCad6RemoveExtension "\\${ext}" "${progId.replace('.','\\.')}"`));
 }
 assert.match(installer,/resources\\file-icons\\\$\{icon\}/);
 assert.doesNotMatch(installer,/^\s*(WriteReg|DeleteReg)\w*\s.*UserChoice/m);
 assert.doesNotMatch(installer,/WriteRegStr HK(LM|CU) "Software\\Classes\\\.(dwg|dxf|bcad)" ""/,'extension defaults only change through the claim macro');
 assert.match(installer,/\$\{ifNot\} \$\{isUpdated\}/,'updates keep the association');
});

test('official 6 takes over only empty or old Barun CAD associations at install',()=>{
 const installer=read('build/installer-official6.nsh');
 const claim=/!macro BarunCad6ClaimExtension[\s\S]*?!macroend/.exec(installer)?.[0]||'';
 // Old Barun names: BarunCAD.* (old app, per user) and the old installer's 'DWG 도면'·'DXF 도면'·'바른CAD 도면'.
 assert.match(claim,/StrCpy \$R1 \$R0 8[\s\S]*\$R1 == "BarunCAD"/);
 for(const legacy of ['DWG 도면','DXF 도면','바른CAD 도면'])assert.ok(claim.includes(`$R0 == "${legacy}"`),legacy);
 // An empty per-user default is left alone: writing it would hide another CAD registered machine-wide.
 assert.match(claim,/!if "\$\{root\}" == "HKLM"\s*\$\{ElseIf\} \$R0 == ""/);
 for(const root of ['HKLM','HKCU'])for(const [ext,progId] of [['.dwg','BarunCAD6.DWG'],['.dxf','BarunCAD6.DXF'],['.bcad','BarunCAD6.BCAD']])
  assert.ok(installer.includes(`!insertmacro BarunCad6ClaimExtension ${root} "${ext}" "${progId}"`),root+ext);
 for(const [progId,icon] of [['BarunCAD.DWG','file-dwg.ico'],['BarunCAD.DXF','file-dxf.ico'],['BarunCAD.BCAD','file-bcad.ico']])
  assert.ok(installer.includes(`!insertmacro BarunCad6RefreshLegacyType HKCU "${progId}" "${icon}"`),progId);
 const remove=/!macro BarunCad6RemoveExtension[\s\S]*?!macroend/.exec(installer)?.[0]||'';
 assert.match(remove,/ReadRegStr \$R0 HKCU "Software\\Classes\\\$\{extension\}" ""\s*\$\{If\} \$R0 == "\$\{progid\}"/,'uninstall releases only its own per-user default');
 assert.match(installer,/ie4uinit\.exe" -show/,'icon cache refresh after install');
});

test('official 6 only repairs stale legacy associations',()=>{
 const {staleOpenCommand}=require('./desktop-files.cjs');
 const out=exe=>`\r\nHKEY_CURRENT_USER\\Software\\Classes\\BarunCAD.DXF\\shell\\open\\command\r\n    (기본값)    REG_SZ    "${exe}" "%1"\r\n`;
 const gone='C:\\Program Files\\Barun\\Barun CAD\\Barun CAD.exe';
 assert.equal(staleOpenCommand(out(gone),()=>false),true);
 assert.equal(staleOpenCommand(out(gone),()=>true),false);
 assert.equal(staleOpenCommand('',()=>false),false);
 assert.equal(staleOpenCommand(out('relative.exe'),()=>false),false);
 const desktop=read('desktop.cjs');
 assert.match(desktop,/if\(official6Runtime\(\)\)return void repairStaleDrawingAssociations\(\);/);
 assert.match(desktop,/if\(!staleOpenCommand\(/);
});

test('official 6 uses separate runtime state and starts the GPU comparison renderer',()=>{
 const desktop=read('desktop.cjs'),build=read('build_desktop.py');
 assert.match(desktop,/official6Runtime=\(\)=>app\.isPackaged/);
 assert.match(desktop,/official6Runtime\(\)\?18768/);
 assert.match(desktop,/path\.join\(app\.getPath\('appData'\),'Barun CAD 6'\)/);
 assert.match(desktop,/backend\/barun-cad-6-server'(?:[^;]*\)\+exe)/);assert.match(desktop,/const exe=isWindows\?'\.exe':''/);
 assert.match(desktop,/official6Runtime\(\)\?url\+'\/\?renderer=gpu'/);
 assert.match(build,/official6='--official6' in sys\.argv/);
 assert.match(build,/electron-builder\.official6\.json/);
 assert.match(build,/vendor\/mlightcad\.js/);
});

test('every local module the desktop shell loads is packaged (multi-process files included)',()=>{
 const config=JSON.parse(read('electron-builder.official6.json'));
 const local=[...read('desktop.cjs').matchAll(/require\('\.\/([^']+\.cjs)'\)/g)].map(m=>m[1]);
 for(const file of new Set(local))assert.ok(config.files.includes(file),file+' must be in electron-builder.official6.json files');
 for(const file of ['desktop-shell.html','desktop-shell.js','desktop-shell-preload.cjs'])assert.ok(config.files.includes(file),file);
});

test('official 6 Mac build mirrors the Windows package and keeps the release encryption check',()=>{
 const win=JSON.parse(read('electron-builder.official6.json')),mac=JSON.parse(read('electron-builder.official6.mac.json'));
 const version=JSON.parse(read('package.json')).version;
 for(const key of ['appId','productName','files','afterPack','publish'])assert.deepEqual(mac[key],win[key],key);
 assert.deepEqual(mac.extraMetadata,win.extraMetadata);
 assert.equal(mac.directories.output,'installer-'+version+'-mac');
 // AI-CONNECT.md: 윈도우는 설치 폴더 맨 위(extraFiles), 맥은 Contents/ 바로 아래에 두면 서명이 거부되므로 Resources 안(extraResources).
 assert.deepEqual(mac.extraResources,[{from:'desktop-backend-'+version+'-mac/barun-cad-6-server',to:'backend',filter:['**/*']},{from:'AI-CONNECT.md',to:'AI-CONNECT.md'}]);
 assert.deepEqual(win.extraFiles,[{from:'AI-CONNECT.md',to:'AI-CONNECT.md'}]);assert.equal(mac.extraFiles,undefined);
 // 맥: dmg(처음 설치)와 zip(자동 업데이트), Developer ID 서명·hardened runtime·공증, 서명 뒤 검사
 assert.deepEqual(mac.mac.target,['dmg','zip']);
 assert.equal(mac.mac.identity,undefined,'임시 서명(identity "-")이나 서명 끔(null)을 두지 않는다');
 assert.equal(mac.mac.hardenedRuntime,true);assert.equal(mac.mac.notarize,true);
 for(const key of ['entitlements','entitlementsInherit']){const plist=read(mac.mac[key]);for(const right of ['allow-jit','allow-unsigned-executable-memory','disable-library-validation'])assert.ok(plist.includes('com.apple.security.cs.'+right),key+' '+right);}
 assert.equal(mac.afterSign,'build/verify-signed.cjs');
 assert.deepEqual(require('./build/verify-signed.cjs').innerExecutables('Barun CAD 6').map(item=>item.file.split(path.sep).at(-1)),['Barun CAD 6','barun-cad-6-server','BarunConverter','barun-dwg2dxf']);
 assert.ok(fs.statSync(path.join(root,mac.mac.icon)).size>0);
 assert.deepEqual(mac.fileAssociations.map(item=>item.ext),['dwg','dxf','bcad']);
 const build=read('build_desktop.py');
 assert.match(build,/electron-builder\.official6\.mac\.json/);
 assert.match(build,/Mac 빌드는 --official6 채널만 지원합니다/);
 assert.match(build,/release_encryption_check\.check\(resources\)/);
 assert.match(build,/'Barun CAD 6\.app'\/'Contents'\/'Resources'/);
 assert.match(build,/dwg-runtime'\+runtime_suffix/);
 const verify=require('./build/verify-packaged.cjs');
 const context=platform=>({electronPlatformName:platform,appOutDir:'/out',packager:{appInfo:{productFilename:'Barun CAD 6'}}});
 assert.equal(verify.packagedExecutable(context('win32')),path.join('/out','Barun CAD 6.exe'));
 assert.equal(verify.packagedExecutable(context('darwin')),path.join('/out','Barun CAD 6.app','Contents','MacOS','Barun CAD 6'));
 assert.equal(verify.packagedResources(context('win32')),path.join('/out','resources'));
 assert.equal(verify.packagedResources(context('darwin')),path.join('/out','Barun CAD 6.app','Contents','Resources'));
 assert.match(build,/latest-mac\.yml/);assert.match(build,/'--mac','dmg','zip'/);assert.match(build,/signed-check\.json/);
});

// Windows without Developer Mode cannot create symlinks (EPERM); the Mac build runs this check.
const canSymlink=(()=>{const d=fs.mkdtempSync(path.join(require('node:os').tmpdir(),'barun-sl-'));try{fs.symlinkSync('A',path.join(d,'x'));return true;}catch{return false;}finally{fs.rmSync(d,{recursive:true,force:true});}})();
test('official 6 Mac artifact digest covers the whole .app bundle and only in-bundle symlinks',{skip:!canSymlink&&'symlinks not permitted on this machine'},()=>{
 const {artifactDigest}=require('./quality-install.cjs');
 const work=fs.mkdtempSync(path.join(require('node:os').tmpdir(),'barun-digest-'));
 try{
  const app=path.join(work,'Barun CAD 6.app'),macos=path.join(app,'Contents','MacOS'),resources=path.join(app,'Contents','Resources'),fw=path.join(app,'Contents','Frameworks','E.framework');
  for(const dir of [macos,resources,path.join(fw,'Versions','A')])fs.mkdirSync(dir,{recursive:true});
  fs.writeFileSync(path.join(macos,'Barun CAD 6'),'exe');fs.writeFileSync(path.join(resources,'app.asar'),'asar');fs.writeFileSync(path.join(fw,'Versions','A','E'),'lib');
  fs.symlinkSync('A',path.join(fw,'Versions','Current'));fs.symlinkSync('Versions/Current/E',path.join(fw,'E'));
  const exe=path.join(macos,'Barun CAD 6'),first=artifactDigest(resources,exe,'darwin');
  assert.match(first,/^[a-f0-9]{64}$/);
  fs.writeFileSync(path.join(fw,'Versions','A','E'),'changed');
  assert.notEqual(artifactDigest(resources,exe,'darwin'),first,'framework contents are covered');
  assert.throws(()=>artifactDigest(path.join(macos,'resources'),exe,'darwin'),/Unexpected packaged resources location/);
  fs.symlinkSync('../../../../outside',path.join(resources,'escape'));
  assert.throws(()=>artifactDigest(resources,exe,'darwin'),/Symbolic links/);
 }finally{fs.rmSync(work,{recursive:true,force:true});}
});
