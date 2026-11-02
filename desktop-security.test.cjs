'use strict';
// 2026-10-20 보안 점검 후속: 가짜 엔진 막기(엔진 시험), 화면 열쇠, 화면→본체 통로 구멍 3개, 안전 스위치(퓨즈).
const test=require('node:test');
const assert=require('node:assert/strict');
const http=require('node:http');
const fs=require('node:fs');
const {probeEngine,engineProof,selectEnginePort}=require('./desktop-http.cjs');

async function fixture(handler,run){
 const server=http.createServer(handler);
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 try{return await run(`http://127.0.0.1:${server.address().port}`,server.address().port);}
 finally{await new Promise(resolve=>server.close(resolve));}
}
// 진짜 엔진처럼 답하는 시험용 서버: proofKeys 로 답을 만든다(proofPort 를 주면 다른 포트용 답을 빌려 온 것처럼).
const engine=(proofKeys,{proofPort=null,body={tokenPolicy:'desktop',pid:7,version:3}}={})=>(request,response)=>{
 const challenge=request.headers['x-cad-challenge'],port=proofPort??request.socket.localPort,headers={'Content-Type':'application/json','X-Barun-CAD':'2'};
 if(challenge&&proofKeys.length)headers['X-CAD-Proof']=proofKeys.map(key=>engineProof(key,port,challenge)).join(',');
 response.writeHead(200,headers);response.end(JSON.stringify(body));
};

test('a challenged probe accepts only an engine that proves a key we hold',async()=>{
 await fixture(engine(['shell-token','file-token']),async url=>{
  const found=await probeEngine(url,{keys:['nope','file-token']});
  assert.equal(found.state,'engine');assert.equal(found.key,'file-token');assert.equal(found.pid,7);
 });
 // 머리말·응답 모양만 흉내 내는 다른 프로그램(답 없음, 틀린 열쇠의 답)은 넘겨받지 않는다.
 await fixture(engine([]),async url=>assert.deepEqual(await probeEngine(url,{keys:['shell-token']}),{state:'foreign',status:200,unverified:true}));
 await fixture(engine(['attacker-token']),async url=>assert.equal((await probeEngine(url,{keys:['shell-token']})).state,'foreign'));
 // 다른 포트의 진짜 엔진 답을 빌려 와도 포트가 묶여 있어 맞지 않는다.
 await fixture(engine(['shell-token'],{proofPort:1}),async url=>assert.equal((await probeEngine(url,{keys:['shell-token']})).state,'foreign'));
 // 열쇠 목록 함수는 /api/status 응답을 받는다(개발 실행은 알린 토큰도 열쇠로 쓴다).
 await fixture(engine(['announced'],{body:{token:'announced',pid:9}}),async url=>{
  const found=await probeEngine(url,{keys:value=>[value.token]});
  assert.equal(found.state,'engine');assert.equal(found.key,'announced');
 });
});

test('port selection hands back the proven key and skips an unverified squatter',async()=>{
 const states={18768:{state:'foreign',status:200,unverified:true},18868:{state:'engine',pid:5,token:null,key:'k'}};
 assert.deepEqual(await selectEnginePort([18768,18868],{probe:async port=>states[port],isFree:async()=>true}),
  {port:18868,state:'engine',pid:5,token:null,key:'k',conflicts:[{port:18768,state:'foreign',status:200}]});
});

test('the shell verifies every engine it adopts or talks to and sends the screen key only to it',()=>{
 const desktop=fs.readFileSync('desktop.cjs','utf8');
 // 시험 없이 묻는 곳이 남지 않게: probeEngine 을 직접 부르는 곳은 verifiedProbe 안 한 곳뿐.
 const calls=desktop.match(/probeEngine\(/g)||[];
 assert.equal(calls.length,1,'probeEngine 직접 호출 '+calls.length+'곳');
 assert.ok(desktop.includes("return probeEngine(urlForPort(port),{...options,keys:"),'verifiedProbe 가 시험 열쇠를 넘긴다');
 assert.match(desktop,/selectEnginePort\(portCandidates\(\),\{probe:port=>verifiedProbe\(port/);
 assert.match(desktop,/supervisor\.adopt\(\{pid:adoptedPid,probe:\(\)=>verifiedProbe\(enginePort/);
 assert.match(desktop,/return found\.token\|\|found\.key;/);
 assert.match(desktop,/handleDownloads\(contents\.session\);attachScreenKey\(contents\.session\);/);
 assert.match(desktop,/details\.url===engineUrl\|\|details\.url\.startsWith\(engineUrl\+'\/'\)/);
 assert.match(desktop,/screenKey=engineToken;\r?\n const child=spawn\(executable,args,/);
 const verifier=fs.readFileSync('quality-verifier.cjs','utf8');
 assert.match(verifier,/BARUN_CAD_TOKEN:screenKey/);assert.match(verifier,/'X-CAD-Screen':screenKey/);assert.match(verifier,/keys:\[screenKey\]/);
});

test('renderer-supplied paths cannot widen file access',()=>{
 const desktop=fs.readFileSync('desktop.cjs','utf8'),preload=fs.readFileSync('desktop-preload.cjs','utf8');
 // 1) 가져오기·가져오기 준비: 글자 경로는 사용자가 고른 파일·연 파일만(전에는 아무 .dwg/.dxf 를 받아 제자리 저장까지 허용).
 assert.equal(desktop.match(/if\(external\?!allowedExternal\.has\(key\):!userChosenPath\(key\)\)throw/g)?.length,2);
 assert.match(preload,/filePath:file=>selectedFilePath\(file\)/);
 assert.match(preload,/importDrawingFile:file=>ipcRenderer\.invoke\('cad:import-drawing-path',selectedFilePath\(file\)\)/);
 assert.match(desktop,/ipcMain\.on\('cad:file-selected',\(event,target\)=>\{if\(trusted\(event\)\)rememberSelectedPath\(target\);\}\);/);
 // 2) .json: 읽기는 도면 형식만, 새 칸 열기는 사용자가 고른 .json 만.
 assert.match(desktop,/!OPENABLE_DRAWING\.test\(target\)\|\|!allowedExternal\.has\(externalKey\(target\)\)/);
 assert.match(desktop,/if\(\/\\\.json\$\/i\.test\(file\)&&!selectedPaths\.has\(externalKey\(file\)\)\)throw/);
 // 3) 폴더 열기: .app 같은 묶음은 열지(실행하지) 않는다.
 const BUNDLE=new RegExp(desktop.match(/const BUNDLE_FOLDER=\/(.+)\/i;/)[1],'i');
 for(const name of ['Calculator.app','Foo.bundle','x.framework','Installer.pkg'])assert.ok(BUNDLE.test(name),name);
 for(const name of ['현장기록','Drawings','2026.10.20','app'])assert.ok(!BUNDLE.test(name),name);
 const openFolder=desktop.slice(desktop.indexOf("ipcMain.handle('cad:open-folder'"),desktop.indexOf('return {opened:true};'));
 assert.match(openFolder,/BUNDLE_FOLDER\.test\(part\)\)\)throw Error\('폴더 경로 오류'\)/);
 assert.match(openFolder,/const real=await fs\.realpath\(folder\);officeOnly\(real\);const stat=await fs\.stat\(real\);/);
 assert.ok(openFolder.indexOf('officeOnly(real)')<openFolder.indexOf('shell.openPath(real)'),'검토 B6: 링크를 따라간 실제 경로도 열기 전에 검사');
 assert.match(openFolder,/shell\.openPath\(real\)/);
 // 감사 2: 바깥 주소 공유 폴더는 만들거나 열기 전에 거절한다.
 const refuse=openFolder.indexOf('바깥 네트워크 주소의 공유 폴더');
 assert.ok(refuse>0&&refuse<openFolder.indexOf('fs.mkdir(folder')&&refuse<openFolder.indexOf('fs.stat(folder)'));
});

test('both official builds set the same safety switches and check them before shipping',()=>{
 const {FUSES}=require('./build/release-hardening.cjs');
 assert.deepEqual(FUSES,{runAsNode:false,enableCookieEncryption:true,enableNodeOptionsEnvironmentVariable:false,enableNodeCliInspectArguments:false,enableEmbeddedAsarIntegrityValidation:true,onlyLoadAppFromAsar:true});
 for(const file of ['electron-builder.official6.json','electron-builder.official6.mac.json'])assert.deepEqual(JSON.parse(fs.readFileSync(file,'utf8')).electronFuses,{...FUSES},file);
 assert.match(fs.readFileSync('build/verify-packaged.cjs','utf8'),/require\('\.\/release-hardening\.cjs'\)\.prepare\(\{resources,infoPlist:/);
 assert.match(fs.readFileSync('build/verify-signed.cjs','utf8'),/require\('\.\/release-hardening\.cjs'\)\.check\(\{electron:app,/);
 const build=fs.readFileSync('build_desktop.py','utf8');
 assert.ok(build.indexOf("'build/release-hardening.cjs','check'")>build.indexOf("print('암호화 검사 통과')"),'빌드 끝 보안 검사');
 assert.match(build,/item\.replace\(item\.with_name\(item\.name\+'\.보안검사실패'\)\)/);
});

test('packaged app refuses the Chrome remote debugging switches before ready',()=>{
 const desktop=fs.readFileSync('desktop.cjs','utf8'),head=desktop.slice(0,desktop.indexOf("if (process.argv.includes('--barun-verify')"));
 assert.match(head,/if\(app\.isPackaged\)for\(const name of \['remote-debugging-port','remote-debugging-pipe','remote-debugging-address','remote-allow-origins'\]\)app\.commandLine\.removeSwitch\(name\);/);
});

test('prepare removes the default app and turns off arbitrary loads but keeps local networking',{skip:process.platform!=='darwin'&&'PlistBuddy 는 맥에만 있다'},()=>{
 const os=require('node:os'),path=require('node:path'),{execFileSync}=require('node:child_process');
 const {prepare}=require('./build/release-hardening.cjs');
 const folder=fs.mkdtempSync(path.join(os.tmpdir(),'barun-hardening-')),resources=path.join(folder,'Resources'),info=path.join(folder,'Info.plist');
 fs.mkdirSync(resources);fs.writeFileSync(path.join(resources,'default_app.asar'),'x');fs.writeFileSync(path.join(resources,'app.asar'),'y');
 fs.writeFileSync(info,`<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict>
<key>ElectronAsarIntegrity</key><dict><key>Resources/app.asar</key><dict><key>algorithm</key><string>SHA256</string><key>hash</key><string>a</string></dict><key>Resources/default_app.asar</key><dict><key>algorithm</key><string>SHA256</string><key>hash</key><string>b</string></dict></dict>
<key>NSAppTransportSecurity</key><dict><key>NSAllowsArbitraryLoads</key><true/><key>NSAllowsLocalNetworking</key><true/></dict></dict></plist>`);
 try{
  prepare({resources,infoPlist:info});
  const read=key=>{try{return execFileSync('/usr/libexec/PlistBuddy',['-c','Print '+key,info],{encoding:'utf8'}).trim();}catch{return null;}};
  assert.ok(!fs.existsSync(path.join(resources,'default_app.asar')));assert.ok(fs.existsSync(path.join(resources,'app.asar')));
  assert.equal(read(':NSAppTransportSecurity:NSAllowsArbitraryLoads'),'false');
  assert.equal(read(':NSAppTransportSecurity:NSAllowsLocalNetworking'),'true');
  assert.equal(read(':ElectronAsarIntegrity:Resources/default_app.asar'),null);
  assert.equal(read(':ElectronAsarIntegrity:Resources/app.asar:hash'),'a');
 }finally{fs.rmSync(folder,{recursive:true,force:true});}
});

// 2026-10-27 C2E·E2C: 창이 뒤에 있어도 OS 클립보드 글을 본체가 읽고 쓴다 — 도면 칸만, 글만, 크기 제한.
test('OS 클립보드 글 통로는 도면 칸에서만, 문자열·5MB 이하만 쓴다',()=>{
 const desktop=fs.readFileSync(require.resolve('./desktop.cjs'),'utf8'),preload=fs.readFileSync(require.resolve('./desktop-preload.cjs'),'utf8');
 const h=desktop.slice(desktop.indexOf("ipcMain.handle('cad:clipboard-text'"));const body=h.slice(0,h.indexOf('});')+3);
 assert.match(body,/if\(!docs\.has\(event\.sender\)\)throw/);assert.match(body,/typeof text!=='string'\|\|text\.length>5_000_000/);
 assert.ok(body.indexOf('docs.has')<body.indexOf('clipboard.readText')&&body.indexOf('docs.has')<body.indexOf('clipboard.writeText'),'검사가 먼저');
 assert.match(preload,/clipboardText:docView\?/);
});
