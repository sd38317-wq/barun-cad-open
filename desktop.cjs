// 설치판은 크롬 원격 디버깅(CDP) 스위치를 받지 않는다: 바깥 프로그램이 도면 화면에 붙어 cadDesktop 통로를 쓰지 못하게.
// 준비(ready) 전에 지우면 크롬이 디버깅 포트를 열지 않는다. 개발 실행(녹화·MCP 시험)은 그대로 쓴다.
{const {app}=require('electron');if(app.isPackaged)for(const name of ['remote-debugging-port','remote-debugging-pipe','remote-debugging-address','remote-allow-origins'])app.commandLine.removeSwitch(name);}
// Verification must bypass normal startup, live profiles, shortcuts and instance lock.
if (process.argv.includes('--barun-verify') || process.argv.includes('--barun-quality-commit')) {
  require('./quality-install.cjs').main();
} else {
const {app,BrowserWindow,dialog,shell,ipcMain,nativeTheme,crashReporter,Menu,clipboard}=require('electron');
nativeTheme.themeSource='dark';
const {spawn,spawnSync}=require('node:child_process');
const path=require('node:path');
const net=require('node:net');
const fs=require('node:fs/promises');
const fsSync=require('node:fs');
const {randomUUID,randomBytes}=require('node:crypto');
const {CloseController,RotatingLog,EngineSupervisor,closeDocumentView}=require('./desktop-lifecycle.cjs');
const {createStartupWindow}=require('./desktop-startup.cjs');
const {externalDrawingArgs,externalKey,localDataRoot,backendEnvironment,localSavePathProblem,staleOpenCommand,claimDrawing,savePreflight,replaceWithRetry,assertAIFileWrite,documentStateActions,crashNote,whoHasMessage}=require('./desktop-files.cjs');
// ACAD200-823: 비정상 종료 때 로컬 미니덤프만 남긴다(밖으로 보내지 않음). 끄기: BARUN_CAD_CRASH_DUMPS=0
if(process.env.BARUN_CAD_CRASH_DUMPS!=='0'){try{crashReporter.start({uploadToServer:false,compress:true,extra:{product:'Barun CAD'}});}catch{}}
const isWindows=process.platform==='win32',isMac=process.platform==='darwin';
// N1: 엔진에 저장 경로를 등록할 수 있는 것은 이 셸뿐이다(화면 코드는 이 값을 모른다).
const shellSecret=randomUUID()+randomUUID();
// 엔진 API 토큰도 셸이 만들어 환경으로 넘긴다. 데스크톱 엔진은 토큰을 /api/status 로 알리지 않으므로 같은 PC 의 다른 프로그램이 받아 갈 수 없다.
const engineToken=randomBytes(32).toString('base64url');
const {requestJson,probeEngine,selectEnginePort}=require('./desktop-http.cjs');
let worker=null,window=null,supervisor=null,adoptedPid=null,enginePort=null,engineUrl='',backendLog=null,desktopLog=null;
// 도면 창마다 따로 화면 프로세스(desktop-docs.cjs)가 기본이다(2026-10-09 사용자 결정: 기본으로 켜서 오류를 찾는다).
// 문제를 가를 때만 예전 한 창 방식으로: --barun-single-window 또는 BARUN_CAD_MULTI_PROCESS=0.
// (크롬 자체 스위치 --single-process 와 이름이 겹치면 크롬이 그걸 받아 앱이 바로 꺼진다 — 이름을 바꾸지 말 것.)
const multiProcess=!process.argv.includes('--barun-single-window')&&process.env.BARUN_CAD_MULTI_PROCESS!=='0';
let docs=null,docPagePath='',openDrawingPaths=null;
// 207: 화면이 죽었을 때 보여 줄 문구는 미리 만들어 둔다(죽는 순간 새로 짓지 않는다 — AutoCAD getOutOfMemoryMessage 와 같은 생각).
// 이유별로 무엇이 일어났고 무엇을 하면 되는지 한국어로 알린다. 메모리 부족이면 다시 연 뒤 할 일까지 적는다.
const CRASH_NOTICES=Object.freeze({
 oom:{message:'메모리가 부족해 도면 화면이 닫혔습니다.',detail:'다시 열면 마지막 자동 복구본에서 이어갈 수 있습니다(대용량 도면은 메모리가 차기 시작하면 30초마다 복구본을 남깁니다). 이어서 작업하기 전에 저장하고, 쓰지 않는 도면 탭을 닫아 주세요.'},
 crashed:{message:'도면 화면이 예기치 않게 종료되었습니다.',detail:'화면을 다시 열면 마지막 자동 복구본에서 이어갈 수 있습니다.'},
 killed:{message:'도면 화면이 강제로 종료되었습니다.',detail:'화면을 다시 열면 마지막 자동 복구본에서 이어갈 수 있습니다.'},
 other:{message:'도면 화면이 예기치 않게 종료되었습니다.',detail:'화면을 다시 열면 마지막 자동 복구본에서 이어갈 수 있습니다.'},
});
function crashNotice(details){const reason=String(details?.reason||'unknown'),notice=CRASH_NOTICES[reason]||CRASH_NOTICES.other;return {message:notice===CRASH_NOTICES.other?notice.message.replace(/\.$/,' ('+reason+').'):notice.message,detail:notice.detail};}
// 숨은 도면 칸의 타이머가 5분 뒤 1분 간격으로 몰아 깨는 크롬 기능(IntensiveWakeUpThrottling)을 끈다 — 엔진 연결이 끊긴 것처럼 보이지 않게.
if(multiProcess){const current=app.commandLine.getSwitchValue('disable-features');app.commandLine.appendSwitch('disable-features',[current,'IntensiveWakeUpThrottling'].filter(Boolean).join(','));}
const cadContents=()=>docs?docs.contents():window&&!window.isDestroyed()?[window.webContents]:[];
const activeCadContents=()=>docs?docs.active()?.view.webContents||null:window&&!window.isDestroyed()?window.webContents:null;
const sendToCad=(channel,payload)=>{for(const contents of cadContents())contents.send(channel,payload);};
const pendingExternal=externalDrawingArgs(process.argv),allowedExternal=new Set(pendingExternal.map(externalKey));
let externalReceiverReady=false;
// 제자리 저장(Ctrl+S): 사용자가 열거나(열기 창·탐색기·끌어 놓기) 저장 창에서 고른 도면 경로만 대화상자 없이 덮어쓴다.
const approvedSavePaths=new Set();
const approveSavePath=target=>{if(typeof target==='string'&&path.isAbsolute(target)&&/\.(dxf|dwg|bcad)$/i.test(target))approvedSavePaths.add(externalKey(target));};
// 사용자가 화면에서 실제로 고르거나 끌어 놓은 파일 경로(preload 가 File 객체에서 얻어 알린다). 화면 코드가 글자로 지어낸 경로는
// File 객체가 아니어서 여기에 들어오지 못한다 — 경로를 글자로 받는 통로(가져오기 준비·.json 열기)는 이 목록·연 파일만 받는다.
const selectedPaths=new Set();
const rememberSelectedPath=target=>{if(typeof target!=='string'||!path.isAbsolute(target))return;const key=externalKey(target);selectedPaths.delete(key);selectedPaths.add(key);if(selectedPaths.size>1000)selectedPaths.delete(selectedPaths.values().next().value);};
const userChosenPath=key=>allowedExternal.has(key)||selectedPaths.has(key)||approvedSavePaths.has(key);
// 열기 통로로 읽어 주는 파일은 도면 형식만(다른 프로그램의 .json 설정 파일 등은 내주지 않는다).
const OPENABLE_DRAWING=/\.(dwg|dxf|bcad|json)$/i;
// 맥에서 폴더처럼 보이지만 열면 실행·설치되는 묶음.
const BUNDLE_FOLDER=/\.(app|appex|bundle|framework|plugin|kext|prefpane|xpc|qlgenerator|mdimporter|saver|pkg|mpkg|workflow|action|service)$/i;
// ACAD200-802: 연 도면마다 .dwl 잠금(AutoCAD 와 같은 3줄). 같은 도면을 연 화면이 모두 닫히면 지운다.
const drawingLocks=new Map();
function holdDrawingLock(contents,target){
 const key=externalKey(target);let lock=drawingLocks.get(key);
 if(!lock){const claim=claimDrawing(target);lock={claim,holders:new Set()};if(claim.claimed)drawingLocks.set(key,lock);}
 if(contents&&lock.claim.claimed&&!lock.holders.has(contents.id)){const id=contents.id;lock.holders.add(id);contents.once('destroyed',()=>releaseDrawingLock(key,id));}
 for(const [name,value] of documentStateActions({path:target,event:'open'}))if(name==='addRecentDocument')try{app.addRecentDocument(value);}catch{}
 return lock.claim.readOnly?{readOnly:true,message:whoHasMessage(lock.claim.who)+'. 저장하면 상대의 작업을 덮을 수 있으니 다른 이름으로 저장하세요.'}:{readOnly:false};
}
function releaseDrawingLock(key,id){const lock=drawingLocks.get(key);if(!lock)return;lock.holders.delete(id);if(!lock.holders.size){drawingLocks.delete(key);lock.claim.release();}}
const releaseAllDrawingLocks=()=>{for(const lock of drawingLocks.values())lock.claim.release();drawingLocks.clear();};
const inPlaceTarget=(payload,format)=>{const target=payload?.targetPath;if(typeof target!=='string'||!approvedSavePaths.has(externalKey(target)))return null;return path.extname(target).toLowerCase()==='.'+format?target:null;};
// productName does not reliably replace package.json name in app.getName().
// The installed executable name is the stable side-by-side runtime marker.
const packagedExecutableName=()=>path.basename(process.execPath,'.exe');
const betaRuntime=()=>app.isPackaged&&/beta/i.test(packagedExecutableName());
const official5Runtime=()=>app.isPackaged&&/barun cad 5/i.test(packagedExecutableName());
const official6Runtime=()=>app.isPackaged&&/barun cad 6/i.test(packagedExecutableName());
const portForRuntime=()=>betaRuntime()?18766:official5Runtime()?18767:official6Runtime()?18768:18765;
/* S4: 기본 포트를 다른 프로그램이 쓰면 같은 채널의 예비 포트를 차례로 시도한다(다른 채널 포트와 겹치지 않게 100 단위). */
const portCandidates=()=>{const base=portForRuntime();return [base,base+100,base+200];};
const urlForPort=port=>`http://127.0.0.1:${port}`;
// 새 설치 직후에는 Windows가 큰 백엔드와 DLL을 처음 검사하므로 준비에 15초 이상 걸릴 수 있다.
// 엔진이 살아 있는 동안은 충분히 기다리고, 실제 종료했을 때만 즉시 실패한다.
const backendStartupTimeoutMs=()=>app.isPackaged?90000:30000;
if(betaRuntime())app.setPath('userData',path.join(app.getPath('appData'),'arun CAD Beta 5'));
else if(official5Runtime())app.setPath('userData',path.join(app.getPath('appData'),'Barun CAD 5'));
else if(official6Runtime())app.setPath('userData',path.join(app.getPath('appData'),'Barun CAD 6'));
const delay=ms=>new Promise(r=>setTimeout(r,ms));
function logLine(message){try{if(!desktopLog)desktopLog=new RotatingLog({path:path.join(app.getPath('userData'),'logs','desktop.log'),maxBytes:2*1024*1024,keep:3});desktopLog.line(message);}catch{}}
function desktopErrorMessage(error,fallback='작업을 완료하지 못했습니다. 다시 시도하세요.'){
 const raw=String(error?.message||error||'');
 if(/EACCES|EPERM|permission denied|access is denied/i.test(raw))return '파일 또는 폴더에 접근할 권한이 없습니다. 저장 위치와 권한을 확인하세요.';
 if(/ENOSPC|disk (?:is )?full|no space left/i.test(raw))return '저장 공간이 부족합니다. 디스크 여유 공간을 확보하세요.';
 if(/ECONNREFUSED|ENOTFOUND|ETIMEDOUT|Failed to fetch/i.test(raw))return '로컬 처리 엔진에 연결하지 못했습니다. 잠시 후 다시 시도하세요.';
 return /[가-힣]/.test(raw)?raw:fallback;
}
function downloadsFolder(){try{return app.getPath('downloads')||preferredSaveFolder();}catch{return preferredSaveFolder();}}
function preferredSaveFolder(){
 for(const name of ['documents','downloads','desktop','userData']){
  try{const folder=app.getPath(name);if(folder)return folder;}catch{}
 }
 return process.env.USERPROFILE||process.cwd();
}
let backendStopped=false;
/* 업데이트 제거 프로그램보다 먼저 엔진을 완전히 끝낸다. 비동기 taskkill은 NSIS와
   경주해 설치 폴더가 잠긴 채 "Failed to uninstall ...: 2"로 끝날 수 있다.
   S13: 이미지 이름(/IM)으로 같은 이름 프로세스를 모두 죽이지 않고, 우리가 띄웠거나 넘겨받은 PID 만 끝낸다. */
function stopBackendNow(){
 if(backendStopped)return;backendStopped=true;
 const pid=supervisor?.pid||worker?.pid||adoptedPid;
 if(supervisor)supervisor.stop();
 try{if(pid&&isWindows)spawnSync('taskkill',['/PID',String(pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});}catch{}
 // macOS: 엔진은 자기 프로세스 그룹으로 띄운다(spawnBackend). 그룹째 끝내 변환기 자식까지 남기지 않는다.
 if(pid&&!isWindows){try{process.kill(-pid,'SIGKILL');}catch{try{process.kill(pid,'SIGKILL');}catch{}}}
 logLine('backend stop pid='+(pid||'none'));
 worker=null;
}
/* S15: 강제 종료 전에 엔진이 남은 복구 내용을 내려쓰고 스스로 닫도록 먼저 부탁한다(최대 3초). */
let backendFlushed=false;
async function flushBackendThenQuit(){
 if(backendFlushed)return;backendFlushed=true;
 try{
  const token=await currentEngineToken();
  await requestJson(engineUrl+'/api/shutdown',{method:'POST',headers:{'Content-Type':'application/json','X-CAD-Token':token,'Origin':engineUrl},body:'{}',timeoutMs:3000,maxBytes:1_000_000});
  logLine('backend flushed and asked to shut down');
 }catch(error){logLine('backend flush skipped: '+(error?.message||error));}
}
/* 업데이트/강제 종료가 겹쳐 NSIS가 바로가기를 지운 뒤 중단돼도 다음 실행에서 복구한다. */
function repairShortcut(){
 if(!app.isPackaged||!isWindows)return;   // macOS 는 Dock·응용 프로그램 폴더를 쓴다
 try{
   const beta=betaRuntime(),official5=official5Runtime(),official6=official6Runtime(),shortcut=beta?'arun CAD Beta.lnk':official5?'바른 CAD 5.lnk':official6?'바른 CAD 6.lnk':'바른 CAD.lnk',target=process.execPath,link=path.join(app.getPath('desktop'),shortcut);
   const publicLink=process.env.PUBLIC?path.join(process.env.PUBLIC,'Desktop',shortcut):null;
  // 컴퓨터 전체 설치가 만든 공용 아이콘이 있으면 개인 아이콘을 또 만들지 않는다.
  if(fsSync.existsSync(link)||(publicLink&&fsSync.existsSync(publicLink)))return;
   shell.writeShortcutLink(link,'create',{target,cwd:path.dirname(target),icon:target,iconIndex:0,description:beta?'arun CAD Beta':official5?'바른 CAD 5':official6?'바른 CAD 6':'바른 CAD'});
 }catch{}
}
/* DXF/DWG는 AI나 미리보다 계정과 무관한 로컬 도면이다. 이전 프로그램의
   파일 연결이 남아 있거나 업데이트 중 연결이 빠져도 현재 사용자 연결을 복구한다. */
function repairDrawingAssociations(){
 if(!isWindows)return;   // macOS 연결은 앱 Info.plist 가 맡는다
 if(official6Runtime())return void repairStaleDrawingAssociations();
 if(!app.isPackaged||betaRuntime()||official5Runtime())return;
 const executable=process.execPath;
 for(const [ext,progId,label] of [['.dxf','BarunCAD.DXF','바른 CAD DXF 도면'],['.dwg','BarunCAD.DWG','바른 CAD DWG 도면'],['.bcad','BarunCAD.BCAD','바른 CAD 도면']]){
  const entries=[
   [`HKCU\\Software\\Classes\\${ext}`,'',progId],
   [`HKCU\\Software\\Classes\\${progId}`,'',label],
   [`HKCU\\Software\\Classes\\${progId}\\DefaultIcon`,'',`${executable},0`],
   [`HKCU\\Software\\Classes\\${progId}\\shell\\open\\command`,'',`"${executable}" "%1"`],
  ];
  for(const [key,name,value] of entries){
   try{spawnSync('reg.exe',['add',key,'/ve','/d',value,'/f'],{windowsHide:true,stdio:'ignore'});}catch{}
  }
 }
}
/* 바른 CAD 6: 기본 앱을 빼앗지 않는다. 옛 바른 CAD 가 남긴 현재 사용자 연결(BarunCAD.DXF 등)의 실행 파일이
   지워져 빈 아이콘이 된 경우에만 그 연결을 6 의 파일 아이콘·실행 파일로 바꾼다. 시작을 늦추지 않게 뒤에서 돈다. */
function repairStaleDrawingAssociations(){
 const {execFile}=require('node:child_process');
 const reg=args=>new Promise(resolve=>execFile('reg.exe',args,{windowsHide:true},(error,stdout)=>resolve(error?'':String(stdout))));
 const icons=path.join(process.resourcesPath,'file-icons'),executable=process.execPath;
 setTimeout(async()=>{
  let repaired=0;
  for(const [progId,icon] of [['BarunCAD.DXF','file-dxf.ico'],['BarunCAD.DWG','file-dwg.ico'],['BarunCAD.BCAD','file-bcad.ico']]){
   const base=`HKCU\\Software\\Classes\\${progId}`;
   if(!staleOpenCommand(await reg(['query',base+'\\shell\\open\\command','/ve'])))continue;
   const iconPath=path.join(icons,icon);
   await reg(['add',base+'\\DefaultIcon','/ve','/d',fsSync.existsSync(iconPath)?iconPath:`${executable},0`,'/f']);
   await reg(['add',base+'\\shell\\open\\command','/ve','/d',`"${executable}" "%1"`,'/f']);
   logLine('repaired stale file association '+progId);repaired++;
  }
  // 탐색기가 옛 빈 아이콘을 기억하고 있으므로 아이콘 캐시를 새로 읽게 한다.
  if(repaired)execFile('ie4uinit.exe',['-show'],{windowsHide:true},()=>{});
 },3000).unref?.();
}
/* 지금 엔진의 API 토큰. 이 셸이 띄운 엔진은 engineToken 이고, 넘겨받은(이전 실행이 띄운) 엔진은 그 엔진이
   사용자 폴더에 쓴 연결 파일에서 읽되 파일의 pid 가 지금 응답하는 엔진과 같을 때만 믿는다. */
async function currentEngineToken(){
 const found=await verifiedProbe(enginePort,{timeoutMs:3000});
 if(found.state!=='engine')throw Error('로컬 도면 엔진에 연결하지 못했습니다. 잠시 뒤 다시 시도하세요.');
 return found.token||found.key;
}
/* 가짜 엔진 막기: 포트에서 X-Barun-CAD 머리말과 응답 모양만 흉내 내는 다른 프로그램을 넘겨받지 않는다.
   엔진에게 시험(X-CAD-Challenge)을 내고, 이 셸이 띄운 엔진의 토큰이나 그 포트 연결 파일(엔진이 0600 으로 씀)의
   토큰을 아는 엔진만 받아들인다. 개발 실행은 브라우저용 엔진(토큰을 알림)도 넘겨받는다. */
async function engineKeys(port){
 const keys=[engineToken];
 try{const state=JSON.parse(await fs.readFile(path.join(localDataRoot(),'BarunCAD','connection-'+port+'.json'),'utf8'));if(typeof state?.token==='string')keys.push(state.token);}catch{}
 return keys;
}
async function verifiedProbe(port,options={}){
 const keys=await engineKeys(port);
 return probeEngine(urlForPort(port),{...options,keys:value=>!app.isPackaged&&typeof value?.token==='string'?[...keys,value.token]:keys});
}
/* 화면이 엔진에서 받는 모든 요청(모듈 import·Worker·<img> 포함)에 셸이 화면 열쇠를 붙인다. 엔진은 풀린 핵심 자산을
   이 열쇠가 있을 때만 내준다(server.py screen_key_ok). 이 셸이 띄운 엔진은 engineToken, 넘겨받은 엔진은 맞힌 열쇠. */
let screenKey=engineToken;
const screenSessions=new WeakSet();
function attachScreenKey(target){
 if(screenSessions.has(target))return;screenSessions.add(target);
 target.webRequest.onBeforeSendHeaders((details,callback)=>{
  if(engineUrl&&(details.url===engineUrl||details.url.startsWith(engineUrl+'/')))callback({requestHeaders:{...details.requestHeaders,'X-CAD-Screen':screenKey}});
  else callback({});
 });
}
function publishEngineStatus(status){
 logLine('engine '+JSON.stringify(status));
 sendToCad('cad:engine-status',{...status,port:enginePort});
}
/* S10: 백엔드 출력은 사용자 폴더의 회전 로그(logs/backend.log, 5 MB × 3)에 남긴다. */
function spawnBackend(){
 const exe=isWindows?'.exe':'';
 const executable=app.isPackaged?path.join(process.resourcesPath,(betaRuntime()?'backend-beta/arun-cad-beta-server':official5Runtime()?'backend/barun-cad-5-server':official6Runtime()?'backend/barun-cad-6-server':'backend/barun-cad-server')+exe):(isWindows?'python':'python3');
 const args=app.isPackaged?['--port',String(enginePort),'--no-browser']:[path.join(__dirname,'server.py'),'--port',String(enginePort),'--no-browser'];
 if(!backendLog)backendLog=new RotatingLog({path:path.join(app.getPath('userData'),'logs','backend.log'),maxBytes:5*1024*1024,keep:3});
 backendLog.line('spawn '+executable+' '+args.join(' '));
 // BARUN_CAD_CHANNEL_PORT: 예비 포트로 떠도 채널 기본 포트의 복구본을 읽을 수 있게 한다.
 screenKey=engineToken;
 const child=spawn(executable,args,{windowsHide:true,detached:!isWindows,stdio:['ignore','pipe','pipe'],cwd:app.isPackaged?process.resourcesPath:__dirname,env:{...backendEnvironment(),BARUN_CAD_CHANNEL_PORT:String(portForRuntime()),BARUN_CAD_SHELL_SECRET:shellSecret,BARUN_CAD_TOKEN:engineToken}});
 child.stdout?.on('data',chunk=>backendLog.write(chunk.toString('utf8')));
 child.stderr?.on('data',chunk=>backendLog.write(chunk.toString('utf8')));
 child.on('error',e=>{backendLog.line('spawn error '+(e?.message||e));dialog.showErrorBox('CAD 엔진 실행 오류',desktopErrorMessage(e,'로컬 도면 엔진을 실행하지 못했습니다.'));});
 worker=child;
 return {pid:child.pid,get exitCode(){return child.exitCode;},onExit:handler=>child.on('exit',code=>{backendLog.line('exit code='+code);handler(code);}),kill:()=>{try{child.kill();}catch{}}};
}
async function waitForEngine(worker){
 const deadline=Date.now()+backendStartupTimeoutMs();
 while(Date.now()<deadline){
  await delay(250);
  if(worker.exitCode!==null)return false;
  // S4: 200 응답만으로 믿지 않고 X-Barun-CAD 헤더와 토큰이 있는 우리 엔진인지 확인한다.
  const found=await verifiedProbe(enginePort,{timeoutMs:1000});
  if(found.state==='engine')return true;
  if(found.state==='foreign')return false;
 }
 return false;
}
function portConflictMessage(ports){return '포트 '+ports.join(', ')+'를 다른 프로그램이 사용 중이라 로컬 도면 엔진을 시작하지 못했습니다. 그 프로그램을 종료하거나 컴퓨터를 다시 시작한 뒤 바른 CAD를 다시 실행하세요.';}
/* macOS: 창 메뉴를 지워도(removeMenu) 앱 메뉴가 남아 Cmd+R 새로고침·개발자 도구가 열린다.
   필요한 것만 둔다: 앱(가리기·종료), 편집(입력란 잘라내기·복사·붙여넣기·모두 선택), 윈도우. 실행 취소는 CAD 가 직접 처리하므로 넣지 않는다. */
function macMenu(){
 return Menu.buildFromTemplate([
  {label:app.name,submenu:[{role:'about',label:'바른 CAD 정보'},{type:'separator'},{role:'hide',label:'바른 CAD 가리기'},{role:'hideOthers',label:'기타 가리기'},{role:'unhide',label:'모두 보기'},{type:'separator'},{role:'quit',label:'바른 CAD 종료'}]},
  {label:'편집',submenu:[{role:'cut',label:'잘라내기'},{role:'copy',label:'복사'},{role:'paste',label:'붙여넣기'},{role:'selectAll',label:'모두 선택'}]},
  {label:'윈도우',submenu:[{role:'minimize',label:'최소화'},{role:'zoom',label:'확대/축소'},{role:'togglefullscreen',label:'전체 화면'},{type:'separator'},{role:'close',label:'닫기'}]},
 ]);
}
async function start(){
 const startup=createStartupWindow({BrowserWindow,baseDir:__dirname,onCancel:()=>app.quit()});
 startup.status({phase:'실행 환경을 확인하고 있습니다.'});
 repairShortcut();
 repairDrawingAssociations();
 let selection;
 try{selection=await selectEnginePort(portCandidates(),{probe:port=>verifiedProbe(port,{timeoutMs:2000})});}
 catch(error){logLine('port conflict '+(error?.message||error));startup.error(error.code==='PORT_CONFLICT'?error.message:'포트 충돌');dialog.showErrorBox('바른 CAD · 포트 충돌',error.code==='PORT_CONFLICT'?error.message:portConflictMessage(portCandidates()));startup.close();app.quit();return;}
 if(startup.cancelled)return;
 enginePort=selection.port;engineUrl=urlForPort(enginePort);const url=engineUrl;
 if(selection.conflicts.length)logLine('skipped ports '+JSON.stringify(selection.conflicts));
 let ready=false;
 // S3: 감시자가 엔진 종료를 감지하면 제한 횟수 안에서 다시 띄우고 화면에 알린다. 넘겨받은 엔진은 5초마다 확인한다.
 supervisor=new EngineSupervisor({spawn:spawnBackend,waitReady:waitForEngine,notify:status=>{publishEngineStatus(status);startup.status({phase:status.message||'엔진 준비 중'});},log:logLine});
 if(selection.state==='engine'){adoptedPid=selection.pid;ready=true;logLine('adopted engine port='+enginePort+' pid='+(adoptedPid||'?'));screenKey=selection.key||screenKey;supervisor.adopt({pid:adoptedPid,probe:()=>verifiedProbe(enginePort,{timeoutMs:1500})});}
 else{
  startup.status({phase:'로컬 도면 엔진을 시작하고 있습니다.'});
  ready=await supervisor.start();
  if(startup.cancelled)return;
  if(!ready){
   const code=worker?.exitCode;
   const message=code===3?portConflictMessage([enginePort]):'로컬 도면 엔진을 시작하지 못했습니다. 로그: '+path.join(app.getPath('userData'),'logs','backend.log');
   startup.error(message);dialog.showErrorBox('바른 CAD',message);startup.close();app.quit();return;
  }
 }
 startup.status({phase:'도면 화면을 준비하고 있습니다.'});
 window=new BrowserWindow({show:false,width:1500,height:950,minWidth:1080,minHeight:720,title:betaRuntime()?'바른 CAD Beta 5':official5Runtime()?'바른 CAD 5':official6Runtime()?'바른 CAD 6':'바른 CAD',icon:path.join(__dirname,'barun-cad-brand.png'),backgroundColor:'#25292f',
  // Windows 기본 제목줄을 숨기고 앱 머리줄(40px)이 제목줄 역할을 한다. 최소화·최대화·닫기만 머리줄 오른쪽에 겹쳐 그린다.
  // macOS 는 창 단추가 왼쪽 위에 있다: 40px 머리줄 가운데에 맞춘다(머리줄 왼쪽 여백은 barun-air.css data-platform=darwin).
  titleBarStyle:'hidden',titleBarOverlay:{color:'#17191e',symbolColor:'#d8dce1',height:40},...(isMac?{trafficLightPosition:{x:14,y:14}}:{}),webPreferences:{preload:path.join(__dirname,multiProcess?'desktop-shell-preload.cjs':'desktop-preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
 window.once('ready-to-show',()=>{window.show();startup.close();});
 window.removeMenu();if(isMac)Menu.setApplicationMenu(macMenu());
 const downloadSessions=new WeakSet();
 const handleDownloads=target=>{if(downloadSessions.has(target))return;downloadSessions.add(target);target.on('will-download',(event,item)=>{
  const result=dialog.showSaveDialogSync(window,{defaultPath:path.join(preferredSaveFolder(),item.getFilename())});
  if(!result)item.cancel();else item.setSavePath(result);
 });};
 // 검토 B9: 화면마다 최근 명령 10개(이름만) — 죽었을 때 crash note 의 lastCommands 로 남긴다.
 const recentCommands=new WeakMap();
 ipcMain.on('cad:command-ran',(event,name)=>{if(typeof name!=='string'||name.length>40)return;const list=recentCommands.get(event.sender)||[];list.push(name);if(list.length>10)list.shift();recentCommands.set(event.sender,list);});
 // 검토 B9: GPU·유틸리티 프로세스가 죽어도 기록한다(10/22 세 창 동시 종료처럼 화면 프로세스 기록만으로는 원인을 못 찾음).
 app.on('child-process-gone',(_event,details)=>{if(details?.reason==='clean-exit')return;try{const folder=app.getPath('crashDumps');fsSync.mkdirSync(folder,{recursive:true});const file=path.join(folder,'note-'+Date.now()+'-'+(details?.type||'child')+'.json');fsSync.writeFileSync(file,JSON.stringify({...crashNote(details,{metrics:app.getAppMetrics(),version:app.getVersion()}),process:details?.type||'',name:details?.name||'',serviceName:details?.serviceName||''},null,1));logLine('child process gone '+(details?.type||'')+' '+(details?.reason||'')+' '+file);}catch(error){logLine('child note failed '+(error?.message||error));}});
 // 도면 화면 하나(한 창 방식이면 창 자체, 기본이면 도면 칸마다)에 거는 공통 설정.
 const configureCadContents=contents=>{
  contents.setWindowOpenHandler(({url:target})=>{if(/^https:\/\//.test(target))shell.openExternal(target);return {action:'deny'};});
  contents.on('will-navigate',(event,target)=>{if(!target.startsWith(url+'/'))event.preventDefault();});
  contents.on('unresponsive',()=>logLine('renderer unresponsive'));
  // ACAD200-823: 화면이 죽으면 이유·프로세스별 메모리를 덤프 폴더에 JSON 으로 남긴다(원인 추적용, 외부 전송 없음).
  contents.on('render-process-gone',(_event,details)=>{if(details?.reason==='clean-exit')return;try{const folder=app.getPath('crashDumps');fsSync.mkdirSync(folder,{recursive:true});const file=path.join(folder,'note-'+Date.now()+'.json');fsSync.writeFileSync(file,JSON.stringify(crashNote(details,{metrics:app.getAppMetrics(),version:app.getVersion(),lastCommands:recentCommands.get(contents)||[]}),null,1));logLine('crash note '+file);}catch(error){logLine('crash note failed '+(error?.message||error));}});
  handleDownloads(contents.session);attachScreenKey(contents.session);
 };
 if(!multiProcess){
  configureCadContents(window.webContents);
  /* S12: 화면 프로세스가 죽으면 조용히 빈 창으로 남지 않게 알리고 다시 연다. */
  window.webContents.on('render-process-gone',(_event,details)=>{
   logLine('render-process-gone '+JSON.stringify(details));
   if(details?.reason==='clean-exit'||window.isDestroyed())return;
   const notice=crashNotice(details);
   const choice=dialog.showMessageBoxSync(window,{type:'error',title:'바른 CAD',message:notice.message,detail:notice.detail,buttons:['화면 다시 열기','종료'],defaultId:0,cancelId:1});
   if(choice===0)window.webContents.reload();else app.quit();
  });
 }
 let closeRequested=false;const pendingSaves=new Map(),pendingCloseChoices=new Map();
 const isCadContents=contents=>docs?docs.has(contents):contents===window.webContents;
 const trusted=event=>isCadContents(event.sender)&&new URL(event.senderFrame.url).origin===url;
  ipcMain.handle('cad:set-fullscreen',(event,value)=>{if(!trusted(event)||typeof value!=='boolean')throw Error('허용되지 않은 전체화면 요청');window.setFullScreen(value);return value;});
  const printerService=require('./desktop-print.cjs').createPrinterService({BrowserWindow,getPrinters:()=>(activeCadContents()||window.webContents).getPrintersAsync()});
 ipcMain.handle('cad:list-printers',event=>{if(!trusted(event))throw Error('허용되지 않은 프린터 요청');return printerService.list();});
 ipcMain.handle('cad:print-drawing',(event,payload)=>{if(!trusted(event))throw Error('허용되지 않은 인쇄 요청');return printerService.print(payload);});
 const preferencesPath=path.join(app.getPath('userData'),'barun-cad-desktop.json');
 let lastDrawingDirectory='';
 try{const saved=JSON.parse(await fs.readFile(preferencesPath,'utf8'));if(typeof saved.lastDrawingDirectory==='string'&&fsSync.existsSync(saved.lastDrawingDirectory))lastDrawingDirectory=saved.lastDrawingDirectory;}catch{}
 ipcMain.handle('cad:external-ready',event=>{
  if(!trusted(event))throw Error('허용되지 않은 파일 열기 요청');
  externalReceiverReady=true;
  // 도면 칸마다 프로세스: 칸마다 맡은 파일이 있으면 그것만 준다(여러 파일을 한 칸이 다 가져가지 않게).
  const entry=docs?.entryFor(event.sender);if(entry){entry.externalReady=true;const files=entry.files||[];entry.files=null;return files;}
  return pendingExternal.splice(0);
 });
 ipcMain.handle('cad:engine-status',event=>{
  if(!trusted(event))throw Error('허용되지 않은 요청');
  return {port:enginePort,url:engineUrl,pid:supervisor?.pid||adoptedPid||null,supervised:!!supervisor,ready:supervisor?supervisor.ready:true};
 });
 ipcMain.handle('cad:engine-token',event=>{
  if(!trusted(event))throw Error('허용되지 않은 요청');
  return currentEngineToken();
 });
 ipcMain.handle('cad:pick-drawings',async event=>{
  if(!trusted(event))throw Error('허용되지 않은 파일 선택 요청');
  const result=await dialog.showOpenDialog(window,{...(lastDrawingDirectory?{defaultPath:lastDrawingDirectory}:{}),properties:['openFile','multiSelections'],filters:[{name:'CAD 도면',extensions:['dwg','dxf','bcad']}]});
  if(result.canceled)return [];
  lastDrawingDirectory=path.dirname(result.filePaths[0]);
  await fs.writeFile(preferencesPath,JSON.stringify({lastDrawingDirectory}),'utf8').catch(()=>{});
  for(const file of result.filePaths){allowedExternal.add(externalKey(file));approveSavePath(file);}
  return result.filePaths;
 });
 ipcMain.on('cad:file-selected',(event,target)=>{if(trusted(event))rememberSelectedPath(target);});
 ipcMain.handle('cad:read-external-file',async(event,target)=>{
  if(!trusted(event)||typeof target!=='string'||!path.isAbsolute(target)||!OPENABLE_DRAWING.test(target)||!allowedExternal.has(externalKey(target)))throw Error('허용되지 않은 도면 파일입니다.');
  const stat=await fs.stat(target);
  if(!stat.isFile()||stat.size>250_000_000)throw Error('250 MB 이하의 도면 파일만 열 수 있습니다.');
  const data=await fs.readFile(target);allowedExternal.delete(externalKey(target));
  return {name:path.basename(target),size:data.length,data:data.toString('base64')};
 });
 const importDrawingPath=async(event,target,external=false)=>{
  if(!trusted(event)||typeof target!=='string'||!path.isAbsolute(target))throw Error('허용되지 않은 도면 파일입니다.');
  const key=externalKey(target);
  if(external?!allowedExternal.has(key):!userChosenPath(key))throw Error('허용되지 않은 도면 파일입니다.');
  const extension=path.extname(target).toLowerCase(),stat=await fs.stat(target);
  if(!['.dwg','.dxf'].includes(extension)||!stat.isFile())throw Error('DXF 또는 DWG 파일을 선택하세요.');
  if(stat.size<=0||stat.size>1_000_000_000)throw Error('1 GB 이하의 도면 파일만 열 수 있습니다.');
  event.sender.send('cad:import-progress',{stage:extension==='.dwg'?'DWG 변환 엔진을 시작하고 있습니다.':'DXF 분석 엔진을 시작하고 있습니다.',received:0,total:0});
  const token=await currentEngineToken();
  const response=await requestJson(url+'/api/import-path',{method:'POST',headers:{'Content-Type':'application/json','X-CAD-Token':token,'Origin':url},body:JSON.stringify({path:target,extension}),timeoutMs:1_250_000,maxBytes:2_000_000_000,onProgress:progress=>{if(!event.sender.isDestroyed())event.sender.send('cad:import-progress',progress);}});
  const result=response.value;if(!response.ok)throw Error(result.error||'파일 변환 실패');
  approveSavePath(target);
  if(external)allowedExternal.delete(key);return result;
 };
 const prepareDrawingImport=async(event,target,external=false)=>{
  if(!trusted(event)||typeof target!=='string'||!path.isAbsolute(target))throw Error('허용되지 않은 도면 파일입니다.');
  const key=externalKey(target);
  if(external?!allowedExternal.has(key):!userChosenPath(key))throw Error('허용되지 않은 도면 파일입니다.');
  const extension=path.extname(target).toLowerCase(),stat=await fs.stat(target);
  if(!['.dwg','.dxf'].includes(extension)||!stat.isFile())throw Error('DXF 또는 DWG 파일을 선택하세요.');
  if(stat.size<=0||stat.size>1_000_000_000)throw Error('1 GB 이하의 도면 파일만 열 수 있습니다.');
  const token=await currentEngineToken();
  approveSavePath(target);
  if(external)allowedExternal.delete(key);
  const lock=holdDrawingLock(event.sender,target);
  return {endpoint:url+'/api/import-path',token,path:target,extension,size:stat.size,lock};
 };
 ipcMain.handle('cad:import-drawing-path',(event,target)=>importDrawingPath(event,target,false));
 ipcMain.handle('cad:import-external-drawing-path',(event,target)=>importDrawingPath(event,target,true));
 ipcMain.handle('cad:prepare-drawing-import',(event,target)=>prepareDrawingImport(event,target,false));
 ipcMain.handle('cad:prepare-external-drawing-import',(event,target)=>prepareDrawingImport(event,target,true));
 const aiRequestStates=new Map();
 ipcMain.on('cad:ai-request-state',(event,state)=>{if(trusted(event)&&Number.isSafeInteger(state?.epoch)){if(!aiRequestStates.has(event.sender.id))event.sender.once('destroyed',()=>aiRequestStates.delete(event.sender.id));aiRequestStates.set(event.sender.id,{epoch:state.epoch,cancelled:state.cancelled===true});}});
 const aiSaveIdentity=payload=>({...(payload?.aiRequestId?{aiRequestId:payload.aiRequestId,aiRecipient:payload.aiRecipient,aiExpiresAt:payload.aiExpiresAt}:{}),...(payload?.aiRequestEpoch===undefined?{}:{aiRequestEpoch:payload.aiRequestEpoch})});
 const saveTargetCall=async body=>{
  const response=await requestJson(url+'/api/save-target',{method:'POST',headers:{'Content-Type':'application/json','X-CAD-Token':await currentEngineToken(),'Origin':url,'X-CAD-Shell':shellSecret},body:JSON.stringify(body),timeoutMs:10000,maxBytes:1_000_000});
  if(!response.ok)throw Error(response.value?.error||'저장 위치를 확인하지 못했습니다.');
  return response.value;
 };
 ipcMain.handle('cad:save-file',async(event,payload)=>{
  if(!trusted(event))throw Error('허용되지 않은 저장 요청');
  const assertCurrent=async()=>{
   assertAIFileWrite(payload,aiRequestStates.get(event.sender.id));
   if(payload?.aiRequestId){
    if(!Number.isSafeInteger(payload.aiExpiresAt)||payload.aiExpiresAt<=Date.now())throw Error('만료된 AI 파일 저장 요청입니다.');
    const checked=await requestJson(url+'/api/chat',{method:'POST',headers:{'Content-Type':'application/json','X-CAD-Token':await currentEngineToken(),'Origin':url},body:JSON.stringify({action:'validateTool',requestId:payload.aiRequestId,recipient:payload.aiRecipient}),timeoutMs:5000,maxBytes:100000});
    if(!checked.ok||checked.value?.authorized!==true)throw Error('종료되거나 중지된 AI 파일 저장 요청입니다.');
   }
  };await assertCurrent();
  // S1: 큰 결과는 base64 문자열 대신 바이트(Uint8Array/ArrayBuffer)로 온다.
  const bytesPayload=payload?.bytes instanceof Uint8Array?Buffer.from(payload.bytes.buffer,payload.bytes.byteOffset,payload.bytes.byteLength):payload?.bytes instanceof ArrayBuffer?Buffer.from(payload.bytes):null;
  if(!payload||typeof payload.name!=='string'||!/^.+\.(dxf|dwg|bcad|pdf|xlsx|svg|lsp|ifc|png|jpg)$/i.test(payload.name))throw Error('저장 형식 또는 크기 오류'); // ifc: 3D 화면 IFC 저장 (A9, 10-20 K24) · png: 미리 대화 그림 저장(2026-10-30)
  if(bytesPayload?(bytesPayload.length<=0||bytesPayload.length>1_500_000_000):(typeof payload.data!=='string'||payload.data.length>100000000))throw Error('저장 형식 또는 크기 오류');
  // 제자리 저장: 연 파일·전에 저장한 파일과 같은 형식이면 묻지 않고 그 파일에 쓴다. 아니면 저장 창.
  const saveNow=()=>globalThis.performance?.now?.()??Date.now(),timingStart=saveNow(),timings_ms={dialog_wait:0,confirm_wait:0};
  const format=path.extname(payload.name).slice(1).toLowerCase(),inPlace=inPlaceTarget(payload,format);
  // ACAD200-814: 제자리 저장 대상이 읽기 전용·사용 중이면 다 쓰기 전에 알리고 다른 이름으로 저장 창을 띄운다.
  const blocked=inPlace?savePreflight(inPlace):{ok:true};
  let target=blocked.ok?inPlace:null,osConfirmed=false;
  if(!target){
   const dialogStart=saveNow();
   const result=await dialog.showSaveDialog(window,{properties:[],...(blocked.ok?{}:{title:'저장할 수 없음: '+blocked.reason+' — 다른 이름으로 저장'}),defaultPath:path.join(payload.targetPath&&path.isAbsolute(payload.targetPath)?path.dirname(payload.targetPath):['png','jpg'].includes(format)?downloadsFolder():preferredSaveFolder(),path.basename(payload.name))});   // 미리 그림: 도면 옆, 저장 안 한 도면이면 다운로드 폴더(2026-10-30)
   timings_ms.dialog_wait=Math.round(saveNow()-dialogStart);
   if(result.canceled||!result.filePath)return {saved:false};
   // A22(10-20): 맥·윈도 저장 창은 같은 이름 파일이 있으면 스스로 '바꿀까요?'를 묻는다 → 사람이 고른 경로는 앱이 다시 묻지 않는다.
   // AI 가 부른 저장(aiRequestId)은 10-16 보안 검토대로 앱이 한 번 더 묻는다. 리눅스 저장 창은 묻지 않으므로 앱이 묻는다.
   target=result.filePath;osConfirmed=(typeof process!=='undefined'&&process.platform!=='linux'&&!payload?.aiRequestId);
   const check=savePreflight(target);if(!check.ok)return {saved:false,error:'저장할 수 없습니다: '+check.reason+'. 다른 이름으로 저장하세요.'};
  }
  await assertCurrent();approveSavePath(target);
  timings_ms.preflight=Math.max(0,Math.round(saveNow()-timingStart)-timings_ms.dialog_wait); const targetStart=saveNow();
  const registered=await saveTargetCall({path:target,format,...aiSaveIdentity(payload)});
  timings_ms.save_target=Math.round(saveNow()-targetStart);
  const token=registered.saveToken,temp=registered.tempPath;
  try{
   if(registered.existed&&(!inPlace||!blocked.ok)&&!osConfirmed){
    const confirmStart=saveNow(); const answer=await dialog.showMessageBox(window,{type:'question',buttons:['취소','덮어쓰기'],defaultId:0,cancelId:0,message:'기존 파일을 덮어쓸까요?',detail:target});
    timings_ms.confirm_wait=Math.round(saveNow()-confirmStart);
    if(answer.response!==1)return {saved:false};
   }
   await assertCurrent();
   const writeStart=saveNow(); const handle=await fs.open(temp,'wx');
   try{await handle.writeFile(bytesPayload||Buffer.from(payload.data,'base64'));}finally{await handle.close();}
   timings_ms.temp_write=Math.round(saveNow()-writeStart);
   await assertCurrent();
   const commitStart=saveNow(); const result=await saveTargetCall({action:'commit',saveToken:token,tempPath:temp});
   timings_ms.replace_commit=Math.round(saveNow()-commitStart);
   if(!['lsp','png','jpg'].includes(format))holdDrawingLock(event.sender,target);
   return {...result,saved:true,path:result.path,timings_ms:{...(result.timings_ms||{}),...timings_ms}};
  }finally{
   await fs.rm(temp,{force:true}).catch(()=>{});
   await saveTargetCall({action:'cancel',saveToken:token}).catch(()=>{});
  }
 });
 /* N1/1: 대용량 저장 — 저장 대화상자에서 고른 경로를 셸이 검사해 엔진에 일회용 토큰으로 등록한다.
    화면은 토큰만 받아 /api/export 에 넘기고, 엔진이 그 경로에 직접 쓴다(base64 응답 없음). */
 ipcMain.handle('cad:pick-save-target',async(event,payload)=>{
  if(!trusted(event))throw Error('허용되지 않은 저장 요청');
  const format=['bcad','dwg'].includes(payload?.format)?payload.format:'dxf';
  const name=typeof payload?.name==='string'&&payload.name?path.basename(payload.name):'도면.'+format;
  if(!supervisor||!supervisor.worker)return {error:'이 엔진은 바른 CAD가 직접 시작한 것이 아니라 저장 위치를 확인할 수 없습니다. 바른 CAD를 다시 실행한 뒤 저장하세요.'};
  const saveNow=()=>globalThis.performance?.now?.()??Date.now(),timingStart=saveNow(),timings_ms={dialog_wait:0,confirm_wait:0};
  const inPlace=inPlaceTarget(payload,format),blocked=inPlace?savePreflight(inPlace):{ok:true};
  let target=blocked.ok?inPlace:null,osConfirmed=false;
  if(!target){
   const dialogStart=saveNow();
   const result=await dialog.showSaveDialog(window,{properties:[],...(blocked.ok?{}:{title:'저장할 수 없음: '+blocked.reason+' — 다른 이름으로 저장'}),defaultPath:path.join(payload?.targetPath&&path.isAbsolute(payload.targetPath)?path.dirname(payload.targetPath):preferredSaveFolder(),name),filters:[{name:{bcad:'바른 CAD 도면',dwg:'DWG 도면',dxf:'DXF 도면'}[format],extensions:[format]}]});
   timings_ms.dialog_wait=Math.round(saveNow()-dialogStart);
   if(result.canceled||!result.filePath)return {canceled:true};
   target=result.filePath;if(!target.toLowerCase().endsWith('.'+format))target+='.'+format;osConfirmed=(typeof process!=='undefined'&&process.platform!=='linux'&&!payload?.aiRequestId)&&target===result.filePath;   // A22: 확장자를 붙여 경로가 바뀌면 OS 가 확인한 파일이 아니다
   const check=savePreflight(target);if(!check.ok)return {error:'저장할 수 없습니다: '+check.reason+'. 다른 이름으로 저장하세요.'};
  }
  approveSavePath(target);holdDrawingLock(event.sender,target);
  const problem=localSavePathProblem(target,format);if(problem)return {error:problem};
  assertAIFileWrite(payload,aiRequestStates.get(event.sender.id));
  timings_ms.preflight=Math.max(0,Math.round(saveNow()-timingStart)-timings_ms.dialog_wait);
  const targetStart=saveNow();
  const registered=await saveTargetCall({path:target,format,...aiSaveIdentity(payload)});
  timings_ms.save_target=Math.round(saveNow()-targetStart);
  if(registered.existed&&(!inPlace||!blocked.ok)&&!osConfirmed){
   const confirmStart=saveNow();
   const answer=await dialog.showMessageBox(window,{type:'question',buttons:['취소','덮어쓰기'],defaultId:0,cancelId:0,message:'기존 파일을 덮어쓸까요?',detail:target});
   timings_ms.confirm_wait=Math.round(saveNow()-confirmStart);
   if(answer.response!==1){await saveTargetCall({action:'cancel',saveToken:registered.saveToken});return {canceled:true};}
  }
  return {saveToken:registered.saveToken,path:registered.path,timings_ms:{...(registered.timings_ms||{}),...timings_ms}};
 });
 ipcMain.handle('cad:open-folder',async(event,folder,options)=>{
  if(!trusted(event)||typeof folder!=='string'||!path.isAbsolute(folder)||folder.split(/[\\/]/).some(part=>BUNDLE_FOLDER.test(part)))throw Error('폴더 경로 오류');
  // 감사 2: 바깥 주소 공유 폴더(\\evil.com\s)는 여는 순간 로그인 정보(NTLM)가 나간다 — project.py network_path 와 같은 규칙.
  // 검토 B6: 링크를 따라간 실제 경로(real)도 같은 규칙으로 다시 본다.
  const officeOnly=p=>{if(!/^[\\/]{2}/.test(p))return;const host=p.slice(2).split(/[\\/]/)[0],v4=host.split('.').map(Number);
   const office=net.isIPv4(host)?(v4[0]===10||v4[0]===127||(v4[0]===172&&v4[1]>=16&&v4[1]<=31)||(v4[0]===192&&v4[1]===168)||(v4[0]===100&&v4[1]>=64&&v4[1]<=127)):/^[A-Za-z0-9][A-Za-z0-9_-]{0,62}$/.test(host);
   if(!office)throw Error('바깥 네트워크 주소의 공유 폴더는 열 수 없습니다: '+folder);};
  officeOnly(folder);
  // EXP(작업폴더 열기)는 mustExist: 오타 경로를 새 빈 폴더로 만들지 않는다. 일괄 변환 결과 폴더 열기는 예전처럼 만든 뒤 연다.
  if(options&&options.mustExist){const stat=await fs.stat(folder).catch(()=>null);if(!stat||!stat.isDirectory())throw Error('폴더가 없습니다: '+folder);}
  else await fs.mkdir(folder,{recursive:true});
  // 맥의 .app 등 묶음은 폴더지만 openPath 가 그 프로그램을 실행한다. 실제 경로(링크를 따라간 끝)가 폴더이고 묶음 안이 아닐 때만 연다.
  const real=await fs.realpath(folder);officeOnly(real);const stat=await fs.stat(real);
  if(!stat.isDirectory()||real.split(/[\\/]/).some(part=>BUNDLE_FOLDER.test(part)))throw Error('폴더만 열 수 있습니다: '+folder);
  const error=await shell.openPath(real);
  if(error)throw Error(error);
  return {opened:true};
 });
 ipcMain.on('cad:save-result',(event,result)=>{if(trusted(event)&&pendingSaves.has(result?.id)){pendingSaves.get(result.id)(result.ok===true);pendingSaves.delete(result.id);}});
 ipcMain.on('cad:close-choice-result',(event,result)=>{if(trusted(event)&&pendingCloseChoices.has(result?.id)){pendingCloseChoices.get(result.id)(['save','discard','cancel'].includes(result.choice)?result.choice:'cancel');pendingCloseChoices.delete(result.id);}});
 const requestSave=(contents=window.webContents)=>new Promise((resolve,reject)=>{const id=randomUUID();const timer=setTimeout(()=>{pendingSaves.delete(id);reject(Error('저장 응답이 없어 창을 유지합니다.'));},120000);pendingSaves.set(id,ok=>{clearTimeout(timer);resolve(ok);});contents.send('cad:save-request',id);});
 const requestCloseChoice=(closing,contents=window.webContents,scope=null)=>new Promise(resolve=>{const id=randomUUID();const timer=setTimeout(()=>{pendingCloseChoices.delete(id);resolve('cancel');},120000);pendingCloseChoices.set(id,choice=>{clearTimeout(timer);resolve(choice);});contents.send('cad:close-choice-request',{id,closing,...(scope?{scope}:{})});});
 // 개발 실행도 설치판과 같은 GPU 화면으로 잴 때만 BARUN_CAD_RENDERER=gpu.
 const devGpu=!app.isPackaged&&process.env.BARUN_CAD_RENDERER==='gpu';
 const pageUrl=betaRuntime()?url+'/?beta=5':official6Runtime()?url+'/?renderer=gpu':devGpu?url+'/?renderer=gpu':url,pagePath=pageUrl.slice(url.length);
 const portNotice=()=>publishEngineStatus({state:'ready',portChanged:true,basePort:portForRuntime(),message:`기본 포트 ${portForRuntime()}를 다른 프로그램이 써서 예비 포트 ${enginePort}로 실행 중입니다. 이 실행에서는 이전 설정·대화 기록·자동 복구본이 보이지 않을 수 있습니다(RECOVER 는 기본 포트 복구본도 찾습니다).`});
 if(multiProcess){await startDocumentViews({url,pagePath,configureCadContents,requestSave,requestCloseChoice,portNotice});return;}
 const controller=new CloseController({
  choose:()=>requestCloseChoice(closeRequested),
  save:requestSave,retry:()=>{if(closeRequested)window.close();else window.webContents.reload();},report:error=>dialog.showErrorBox('종료하지 않았습니다',desktopErrorMessage(error,'저장을 완료하지 못해 창을 유지합니다.'))
 });
 window.on('close',()=>{closeRequested=true;});
 window.webContents.on('did-finish-load',()=>{controller.allowed=false;closeRequested=false;});
 window.webContents.on('will-prevent-unload',event=>{if(controller.pending&&!controller.allowed)return;controller.blocked(event).finally(()=>{if(!controller.allowed)closeRequested=false;});});
 await window.loadURL(pageUrl);
 showWhatsNew();
 // S4: 예비 포트로 떴으면 화면에 알린다(출처가 달라져 이전 설정·대화 기록·자동 복구본이 보이지 않을 수 있다).
 if(enginePort!==portForRuntime())window.webContents.once('did-finish-load',portNotice);
}
/* 도면 칸마다 프로세스: 창은 위쪽 탭 줄(desktop-shell.html)만 그리고, 도면 화면은 칸마다 따로 프로세스.
   창을 닫으면 칸을 하나씩 닫으며 칸마다 원래의 "저장할까요?" 절차를 그대로 밟는다. 취소하면 거기서 멈춘다. */
async function startDocumentViews({url,pagePath,configureCadContents,requestSave,requestCloseChoice,portNotice}){
 const {DocumentViews,readOpenWindows,openWindowsSnapshot,closedWindowForRestore}=require('./desktop-docs.cjs');
 docPagePath=pagePath;
 // 파일 경로·dirty가 있는 칸만 복원한다. 구판 숫자 목록은 각 칸의 복구본을 확인한 뒤 정리한다.
 const openWindowsFile=path.join(app.getPath('userData'),'barun-cad-open-windows.json');
 let restoreWindows=[];try{restoreWindows=readOpenWindows(JSON.parse(fsSync.readFileSync(openWindowsFile,'utf8')));}catch{}
  for(const row of restoreWindows)for(const d of row.drawings||[]){
  if(typeof d.filePath==='string'&&path.isAbsolute(d.filePath)&&/\.(dwg|dxf|bcad|json)$/i.test(d.filePath)){allowedExternal.add(externalKey(d.filePath));approveSavePath(d.filePath);}
 }
 const pendingRestores=new Map(restoreWindows.map(row=>[row.slot,{...row,restorePending:true}]));
 const closedForExit=new Map();
 const saveOpenWindows=()=>{try{fsSync.writeFileSync(openWindowsFile,JSON.stringify(openWindowsSnapshot(new Map([...pendingRestores,...(closingAll||preservingExit?closedForExit:[]),...[...(docs?.views.values()||[])].map(entry=>[entry.slot,entry])]).values())));}catch(error){logLine('open windows save failed '+(error?.message||error));}};
 let closingAll=false,preservingExit=false;
 // 죽은 칸은 물어볼 화면이 없으니 바로 닫는다. 닫힌 뒤 처리는 'destroyed' 한 곳에서만(두 번 다음 칸을 닫지 않게).
 const closeView=(entry,emptyOnly=false,savedOnly=false,reservation)=>emptyOnly&&(closingAll||preservingExit)?Promise.resolve(false):closeDocumentView(entry,{
   choose:async()=>{if(savedOnly){const state=await docs.requestTool(entry,'confirm-close',{lease:reservation?.lease,ids:reservation?.ids},reservation?.allowAI===true);return state?.safe&&!state.dirty&&(!reservation?.expiresAt||reservation.expiresAt>Date.now())?'discard':'cancel';}if(!emptyOnly)docs.select(entry.id);const choice=await requestCloseChoice(true,entry.view.webContents,emptyOnly?'empty':closingAll?null:'window');if(closingAll&&choice==='discard'){const state=await readState(entry);if(state)entry.drawings=state.drawings;}return choice;},
   save:async()=>{const ok=await requestSave(entry.view.webContents);if(ok&&closingAll){const state=await readState(entry);if(state)entry.drawings=state.drawings;}return ok;},remove:id=>{if(closingAll)closedForExit.set(entry.slot,closedWindowForRestore(entry));docs.remove(id);},
   report:error=>dialog.showErrorBox('닫지 않았습니다',desktopErrorMessage(error,'저장을 완료하지 못해 도면 창을 유지합니다.')),aborted:()=>{if(emptyOnly){if(closingAll)afterClose();return;}closingAll=false;preservingExit=false;closedForExit.clear();saveOpenWindows();}
  });
 const afterClose=()=>{if(preservingExit)return;if(!closingAll){if(!docs.views.size)docs.create({query:pagePath});return;}const next=docs.active()||[...docs.views.values()][0];if(next)closeView(next);else{preservingExit=true;closingAll=false;window.close();}};
 docs=new DocumentViews({window,url,preload:path.join(__dirname,'desktop-preload.cjs'),log:logLine,
  // 칸 목록이 바뀌면 탭 줄 화면과 모든 칸에 알린다(각 칸의 CAD 탭 줄이 다른 칸 도면을 함께 그린다).
  onChange:tabs=>{saveOpenWindows();if(window.isDestroyed())return;window.webContents.send('shell:tabs',tabs);for(const entry of docs.views.values()){const c=entry.view.webContents;if(c&&!c.isDestroyed())c.send('cad:windows',{self:entry.id,windows:tabs});}},
  configure:(contents,entry)=>{
   entry.restoreDrawings=pendingRestores.get(entry.slot)?.drawings||[];
   configureCadContents(contents);
   contents.on('did-finish-load',()=>{if(lastClipboard)contents.send('cad:clipboard',lastClipboard);});
   const controller=new CloseController({
    // 닫기(closeView)가 아니면 새로고침이다. 예전엔 새로고침에서 [저장 안 함]을 골라도 칸을 닫아 빈 창이 남았다.
    choose:async()=>{docs.select(entry.id);const closing=closingAll||!!entry.closing;return requestCloseChoice(closing,contents,closingAll?null:closing?'window':null);},
    save:()=>requestSave(contents),retry:()=>{if(closingAll||entry.closing)contents.close({waitForBeforeUnload:true});else contents.reload();},
    report:error=>dialog.showErrorBox('닫지 않았습니다',desktopErrorMessage(error,'저장을 완료하지 못해 도면 창을 유지합니다.')),
    // 취소뿐 아니라 [저장 후 종료]에서 저장 창을 닫은 경우도 여기로 온다. 예전엔 취소만 풀어서 이후 X 가 전부 무시됐다.
    aborted:()=>{closingAll=false;preservingExit=false;entry.closing=false;closedForExit.clear();saveOpenWindows();}
   });
   contents.on('did-finish-load',()=>{controller.allowed=false;entry.closing=false;});
   contents.on('will-prevent-unload',event=>{if(controller.pending&&!controller.allowed)return;controller.blocked(event);});
   contents.on('destroyed',()=>{pendingRestores.delete(entry.slot);if(docs.views.has(entry.id))docs.remove(entry.id);saveOpenWindows();afterClose();});
  }});
 // 메타데이터만 요청한다. 객체·블록은 복사하지 않고 파일 열기/정리 때만 실행한다.
 const pendingStates=new Map();
 const readState=entry=>new Promise(resolve=>{
  const contents=entry.view.webContents;if(!contents||contents.isDestroyed()){resolve(null);return;}
  const id=randomUUID(),timer=setTimeout(()=>{pendingStates.delete(id);resolve(null);},15000);
  pendingStates.set(id,{contents,finish:state=>{clearTimeout(timer);resolve(state);}});contents.send('cad:drawing-state-request',id);
 });
 ipcMain.on('cad:drawing-state-result',(event,result)=>{const pending=pendingStates.get(result?.id);if(pending?.contents!==event.sender||!Array.isArray(result?.state?.drawings))return;pendingStates.delete(result.id);pending.finish(result.state);});
 let openQueue=Promise.resolve();
 const enqueue=task=>{const result=openQueue.then(task);openQueue=result.catch(error=>logLine('drawing open failed '+(error?.message||error)));return result;};
 openDrawingPaths=(paths,preferred)=>enqueue(async()=>{
  if(closingAll||preservingExit)return;
  const files=[...new Set(paths.map(file=>path.resolve(file)))];
  for(const file of files){allowedExternal.add(externalKey(file));approveSavePath(file);}
  await docs.openFiles(files,{query:pagePath,readState,key:externalKey,preferred,canOpen:()=>!closingAll&&!preservingExit});
  await docs.pruneEmpty({readState,close:entry=>closeView(entry,true)});
 });
 ipcMain.on('cad:file-open-finished',(event,status)=>{
  const entry=docs.entryFor(event.sender);if(!entry||typeof status?.path!=='string')return;
  entry.openingFiles=entry.openingFiles.filter(file=>externalKey(file)!==externalKey(status.path));
  if(status.ok)enqueue(()=>{if(!closingAll&&!preservingExit)return docs.pruneEmpty({readState,close:target=>closeView(target,true)});});
 });
 // 공용 설정: 칸마다 갈라지는 localStorage 를 앱 본체 한 파일로 맞춘다(desktop-shared-settings.cjs, desktop-preload.cjs).
 const shared=require('./desktop-shared-settings.cjs').createSharedSettings({file:path.join(app.getPath('userData'),'barun-cad-shared-settings.json'),log:logLine});
 ipcMain.on('cad:shared-settings-snapshot',event=>{const entry=docs.entryFor(event.sender);event.returnValue=entry?shared.snapshot({seeding:entry.slot===1}):{};});
 ipcMain.on('cad:shared-settings-seed',(event,values)=>{if(docs.entryFor(event.sender)?.slot===1)shared.seed(values);});
 ipcMain.on('cad:shared-setting',(event,change)=>{if(!docs.has(event.sender)||!shared.set(change?.key,change?.value??null))return;for(const contents of docs.contents())if(contents!==event.sender)contents.send('cad:shared-setting',{key:change.key,value:change.value??null});});
 app.on('will-quit',()=>shared.flush());
 // 칸 안에서 연 도면을 새 칸으로(app.js openDrawingFiles). 열기 창·끌어 놓기로 고른 실제 파일 경로만 온다.
 ipcMain.handle('cad:open-in-new-windows',(event,paths)=>{
  if(!docs.has(event.sender)||!Array.isArray(paths)||paths.length>20)throw Error('허용되지 않은 도면 열기 요청');
  for(const file of paths){if(typeof file!=='string'||!path.isAbsolute(file)||!OPENABLE_DRAWING.test(file))throw Error('도면 파일 경로가 아닙니다.');
   // .json 은 도면 말고도 다른 프로그램의 설정·비밀 파일일 수 있다: 사용자가 고르거나 끌어 놓은 것만(AI 열기는 dwg·dxf·bcad).
   if(/\.json$/i.test(file)&&!selectedPaths.has(externalKey(file)))throw Error('JSON 도면은 열기 창이나 끌어 놓기로 여세요.');}
  return openDrawingPaths(paths,docs.entryFor(event.sender).id);
 });
 // 칸이 자기 도면 탭 목록을 알린다 → 다른 칸 CAD 탭 줄에 보인다. 다른 칸 탭을 누르거나 닫으면 그 칸으로.
 ipcMain.on('cad:report-drawings',(event,drawings)=>{const entry=docs.entryFor(event.sender);if(!entry||!Array.isArray(drawings))return;entry.drawings=drawings.slice(0,50).map(d=>({id:typeof d?.id==='string'?d.id.slice(0,128):'',name:String(d?.name||'').slice(0,120),dirty:!!d?.dirty,large:!!d?.large,active:!!d?.active,filePath:typeof d?.filePath==='string'?d.filePath.slice(0,32768):''}));entry.title=(entry.drawings.find(d=>d.active)||entry.drawings[0])?.name||entry.title;docs.changed();});
 ipcMain.on('cad:restore-drawings',event=>{const entry=docs.entryFor(event.sender);event.returnValue=entry?pendingRestores.get(entry.slot)?.drawings||[]:[];});
 ipcMain.on('cad:next-drawing-name',(event,names)=>{event.returnValue=docs.has(event.sender)?docs.allocateDrawingName(docs.entryFor(event.sender),Array.isArray(names)?names.slice(0,200).map(String):null):null;});
 ipcMain.on('cad:workspace-ready',(event,status)=>{
  const entry=docs.entryFor(event.sender);if(!entry)return;
  const restoring=entry.restorePending;entry.restorePending=false;pendingRestores.delete(entry.slot);
  entry.startupEmpty=restoring&&status?.empty===true;
  // 실패한 복구본은 다음 실행에 다시 확인한다. 이번 실행에서는 그 파일을 '되살리는 칸'으로 치지 않아야 같은 파일 열기가 빈 칸만 고르고 멈추지 않는다(2026-11-02).
  if(status?.failed){entry.restorePending=true;entry.restoreFailed=true;entry.startupEmpty=false;docs.changed();return;}
  if(entry.startupEmpty&&!entry.openingFiles.length&&docs.views.size>1)docs.remove(entry.id);
  if(![...docs.views.values()].some(e=>e.restorePending))for(const blank of [...docs.views.values()]){
   if(docs.views.size>1&&blank.startupEmpty&&!blank.openingFiles.length)docs.remove(blank.id);
  }
  docs.changed();
 });
 ipcMain.on('cad:window-select',(event,id)=>{if(docs.has(event.sender)&&docs.views.has(id))docs.select(id);});
 ipcMain.on('cad:window-close',(event,id)=>{const entry=docs.views.get(id);if(docs.has(event.sender)&&entry)closeView(entry);});
 // 탭 오른쪽 클릭 메뉴: 다른 칸 도면의 저장·다른 이름으로 저장 — 그 칸을 앞으로 꺼내고 그 칸에 명령을 보낸다.
 ipcMain.on('cad:window-command',(event,id,name)=>{const entry=docs.views.get(id);if(!docs.has(event.sender)||!entry||entry.state==='crashed'||entry.view.webContents.isDestroyed()||!['SAVE','SAVEAS'].includes(name))return;docs.select(id);entry.view.webContents.send('cad:run-command',name);});
 // 기존 CAD 탭 목록의 이름·저장 상태를 재사용한다.
 const outputGuard=(event,ids)=>{const requester=docs.entryFor(event.sender);if(!requester||closingAll||preservingExit)throw Error('도면 창 요청을 처리할 수 없습니다.');if(ids&&(!Array.isArray(ids)||ids.length>100||ids.some(id=>!Number.isSafeInteger(id))))throw Error('도면 칸 목록이 올바르지 않습니다.');return requester;};
 ipcMain.handle('cad:output-windows',event=>{const self=outputGuard(event);return {self:self.id,windows:docs.list()};});
 ipcMain.on('cad:output-result',(event,result)=>docs.answerTool(event.sender,result));
 ipcMain.handle('cad:output-clean',(event,payload)=>{const requester=outputGuard(event,payload?.ids);if(!Array.isArray(payload?.ids))throw Error('도면 칸 목록이 없습니다.');const source=payload.options||{},options={};for(const key of ['points','emptyText','zeroLayer','moveToOrigin','purgeLayers'])options[key]=source[key]===true;options.deleteLayerName=String(source.deleteLayerName||'').slice(0,120);return docs.cleanWindows(payload.ids,options,requester);});
 // 지연 자기닫기는 본체가 원 대상과 결과를 보관한다. 화면이 돌려준 성공 개수는 믿지 않는다.
 const deferredOutputCloses=new Map();let nextOutputClose=1;
 const closeTargetKey=t=>JSON.stringify([t.windowId,t.id,t.name,!!t.dirty]);
 const closeTargetsEqual=(a,b)=>a?.length===b?.length&&a.every(t=>b.some(other=>closeTargetKey(t)===closeTargetKey(other)));
 ipcMain.handle('cad:output-close',async(event,payload)=>{
  const requester=outputGuard(event,payload?.ids);if(!Array.isArray(payload?.ids))throw Error('도면 칸 목록이 없습니다.');
  const options=payload.options||{};let ids=[...new Set(payload.ids)],targets,names,requested,previous;
  if(options.targets!==undefined){
   if(!Array.isArray(options.targets)||options.targets.length>5000||options.targets.some(t=>!Number.isSafeInteger(t?.windowId)||typeof t?.id!=='string'||!t.id||t.id.length>128))throw Error('도면 대상 목록이 올바르지 않습니다.');
   targets=options.targets.map(t=>({windowId:t.windowId,id:t.id,name:String(t.name||'').slice(0,120),dirty:!!t.dirty}));
   if(new Set(targets.map(t=>t.id)).size!==targets.length)throw Error('도면 대상이 중복됩니다.');
  }
  if(options.previous){
   const token=options.previous.token,record=deferredOutputCloses.get(token);
   if(!record||record.sender!==event.sender)throw Error('지연 닫기 요청이 없거나 요청한 창이 다릅니다.');
   deferredOutputCloses.delete(token);previous=record.result;names=record.names;requested=record.requested;
   const expected=record.targets?.filter(t=>previous.deferred.includes(t.windowId));
   const sameTargets=record.targets?closeTargetsEqual(targets,record.targets)||closeTargetsEqual(targets,expected):targets===undefined;
   const sameWindows=ids.length===previous.deferred.length&&ids.every(id=>previous.deferred.includes(id));
   const unchanged=record.snapshots.every(([id,snapshot])=>JSON.stringify((docs.views.get(id)?.drawings||[]).map(d=>[d.id,d.name,!!d.dirty,d.filePath||'']))===snapshot);
   if(options.cancel===true||record.expiresAt<=Date.now()||!sameTargets||!sameWindows||!unchanged){
    return {...previous,deferred:[],failed:[...previous.failed,...(expected?expected.map(t=>t.id):previous.deferred)],requested,names:[...previous.failed,...(expected?expected.map(t=>t.id):previous.deferred)].map(id=>names.get(id)||String(id))};
   }
   ids=[...previous.deferred];targets=expected;
  }else{
   if(targets&&targets.some(t=>!ids.includes(t.windowId)))throw Error('선택한 칸에 없는 도면입니다.');
   names=new Map(targets?targets.map(t=>[t.id,t.name]):docs.list().map(w=>[w.id,w.title]));requested=targets?targets.length:ids.length;
  }
  const current=await docs.closeSavedWindows(ids,{targets,requester,deferSelf:!previous&&payload.deferSelf===true,close:(entry,reservation)=>closingAll||preservingExit?false:closeView(entry,false,true,reservation)});
  const result=previous?{closed:[...previous.closed,...current.closed],dirty:[...previous.dirty,...current.dirty],failed:[...previous.failed,...current.failed],deferred:current.deferred}:current;
  result.requested=requested;result.names=result.failed.map(id=>names.get(id)||String(id));
  if(result.deferred.length){
   for(const [key,record] of deferredOutputCloses)if(record.expiresAt<Date.now()-300000||record.sender.isDestroyed())deferredOutputCloses.delete(key);
   if(deferredOutputCloses.size>=100)deferredOutputCloses.delete(deferredOutputCloses.keys().next().value);
   result.token=nextOutputClose++;result.expiresAt=Date.now()+30000;
   deferredOutputCloses.set(result.token,{sender:event.sender,expiresAt:result.expiresAt,targets,names,requested,result:{...result,closed:[...result.closed],dirty:[...result.dirty],failed:[...result.failed],deferred:[...result.deferred]},snapshots:result.deferred.map(id=>[id,JSON.stringify((docs.views.get(id)?.drawings||[]).map(d=>[d.id,d.name,!!d.dirty,d.filePath||'']))])});
  }
  // 요청한 칸까지 닫혔으면 남은 칸(마지막이면 새 빈 칸)에 원 요청 전체 결과를 보여 준다.
  if(!docs.has(event.sender))docs.queueNotice('cad:output-closed',result);
  return result;
 });
 // 칸 안에 도면이 하나뿐일 때의 Ctrl+Tab·Ctrl+W·Ctrl+Shift+S(app.js).
 const saveAll=async()=>{for(const contents of docs.contents()){try{if(!(await requestSave(contents)))return;}catch(error){dialog.showErrorBox('모두 저장',desktopErrorMessage(error,'저장하지 못한 도면이 있습니다.'));return;}}};
 // 돌려주는 값: 다른 칸으로 넘어갔으면 true(ON 명령이 쓴다).
 ipcMain.handle('cad:window-shortcut',(event,name)=>{const entry=docs.entryFor(event.sender);if(!entry)return false;
  if(name==='next'||name==='prev'){if(docs.views.size<2)return false;docs.cycle(name==='next'?1:-1);return true;}
  if(name==='close')closeView(entry);else if(name==='saveAll')saveAll();return false;});
 // CAD 클립보드: 한 칸에서 복사하면 다른 칸에도 건넨다. 나중에 연 칸에도 마지막 것을 준다.
 let lastClipboard=null;
 ipcMain.on('cad:clipboard',(event,data)=>{if(!docs.has(event.sender)||!data||!Array.isArray(data.entities))return;lastClipboard=data;for(const contents of docs.contents())if(contents!==event.sender)contents.send('cad:clipboard',data);});
 // OS 클립보드 글(C2E·E2C): 창이 앞에 없어도(AI 가 부를 때) 본체가 읽고 쓴다. 도면 칸만, 글만.
 ipcMain.handle('cad:clipboard-text',(event,text)=>{if(!docs.has(event.sender))throw Error('허용되지 않은 요청');if(text===undefined)return clipboard.readText();if(typeof text!=='string'||text.length>5_000_000)throw Error('클립보드 글이 올바르지 않습니다.');clipboard.writeText(text);return true;});
 const fromShell=event=>event.sender===window.webContents;
 const guard=handler=>(event,...args)=>{if(!fromShell(event))throw Error('허용되지 않은 요청');return handler(...args);};
 ipcMain.handle('shell:tabs',guard(()=>docs.list()));
 ipcMain.handle('shell:new',guard(()=>{docs.create({query:pagePath});}));
 ipcMain.handle('shell:select',guard(id=>docs.select(id)));
 ipcMain.handle('shell:reload',guard(id=>docs.reload(id)));
 ipcMain.handle('shell:close',guard(id=>{const entry=docs.views.get(id);if(entry)closeView(entry);}));
 ipcMain.handle('shell:open-files',guard(async()=>{
  const result=await dialog.showOpenDialog(window,{properties:['openFile','multiSelections'],filters:[{name:'CAD 도면',extensions:['dwg','dxf','bcad']}]});
  if(result.canceled||!result.filePaths.length)return;
  for(const file of result.filePaths){allowedExternal.add(externalKey(file));approveSavePath(file);}
  await openDrawingPaths(result.filePaths);
 }));
 window.on('close',event=>{if(!docs.views.size)return;event.preventDefault();if(closingAll)return;closingAll=true;afterClose();});
 // 첫 도면 칸을 먼저 만들고 탭 줄은 그 뒤에 함께 띄운다 — 느린 PC 에서 탭 줄을 다 띄운 다음 칸을 만들면 첫 도면이 그만큼 늦었다.
 // 탭 줄은 뜨면서 shell:tabs 로 지금 목록을 받아 가므로 그 전에 보낸 알림을 놓쳐도 된다.
 for(const row of restoreWindows)docs.create({query:pagePath,slot:row.slot,restore:true});
 if(!restoreWindows.length&&!pendingExternal.length)docs.create({query:pagePath});
 const shellLoaded=window.loadFile(path.join(__dirname,'desktop-shell.html'));
 if(restoreWindows.length)logLine('checking restored windows '+JSON.stringify(restoreWindows.map(row=>row.slot)));
 if(pendingExternal.length)await openDrawingPaths(pendingExternal.splice(0));
 const first=docs.active();
 await shellLoaded;
 showWhatsNew();
 if(first&&enginePort!==portForRuntime())first.view.webContents.once('did-finish-load',portNotice);
}
/* 온라인 업데이트 — 바른 CAD 전용 공개 배포 저장소를 본다. 받는 쪽은 로그인이 필요 없다.
   바뀐 덩어리만 받는 차등 업데이트라(.blockmap) 화면 코드만 고친 판은 몇 MB 만 내려받는다.
   받아 두었다가 앱을 닫을 때 설치한다. 쓰는 도중에 끊지 않는다.
   BC-04: electron-updater 는 latest.yml 의 sha512 와 내려받은 설치 파일을 대조한다(기본 동작, 끄지 않는다).
   설치 파일 코드 서명(BC-01)은 인증서가 있어야 하며 여기서는 해결할 수 없다. */
let updater=null,updateReady=null,updateStatus={state:'idle',current:null,version:null,percent:0,transferred:0,total:0};
function publishUpdateStatus(changes){
 updateStatus={...updateStatus,...changes,current:app.getVersion()};
 sendToCad('cad:update-status',updateStatus);
}
/* 업데이트로 판이 바뀐 뒤 처음 켤 때 "무엇이 바뀌었나" 창을 한 번 띄운다(새로 설치했을 때는 띄우지 않는다).
   내용은 build/release-notes.md — 업데이트 서버의 latest.yml 과 같은 글이다. */
const SHOW_WHATS_NEW=false;
function showWhatsNew(){
 if(!app.isPackaged)return;
 const marker=path.join(app.getPath('userData'),'last-run-version.txt'),current=app.getVersion();
 let previous='';try{previous=fsSync.readFileSync(marker,'utf8').trim();}catch{}
 try{fsSync.writeFileSync(marker,current);}catch{}
 // 당분간 끔(사용자 2026-10-16 "변경된거 업데이트시에 알려주는거 당분간은 하지말자"). 판 기록은 계속 남겨 다시 켤 때 옛 판 안내가 뜨지 않게.
 if(!SHOW_WHATS_NEW)return;
 if(!previous||previous===current)return;
 let notes='';try{notes=fsSync.readFileSync(path.join(__dirname,'build','release-notes.md'),'utf8').replace(/^#.*\n+/,'').trim();}catch{}
 setTimeout(()=>{if(window&&!window.isDestroyed())dialog.showMessageBox(window,{type:'info',title:'바른 CAD 업데이트',message:`${previous} → ${current} 로 업데이트되었습니다.`,detail:notes||'새 판으로 바뀌었습니다.',buttons:['확인']}).catch(()=>{});},1500);
}
function releaseNotes(info){
 const notes=info?.releaseNotes;
 if(Array.isArray(notes))return notes.map(item=>item?.note||item).filter(Boolean).join('\n');
 return typeof notes==='string'?notes.trim():'';
}
function getUpdater(){
 if(updater)return updater;
 // 설치본은 빌드 때 한 파일로 묶은 사본을 쓴다(electron-builder 가 electron-updater 의 의존 모듈을 빠뜨려 업데이트가 조용히 꺼졌었다).
 try{updater=require('./vendor/electron-updater.cjs').autoUpdater;}catch(error){
  try{updater=require('electron-updater').autoUpdater;}catch{logLine('updater unavailable '+(error?.message||error));return null;}
 }
 updater.autoDownload=true;
 updater.autoInstallOnAppQuit=true;
 updater.on('checking-for-update',()=>publishUpdateStatus({state:'checking',percent:0,transferred:0,total:0}));
 updater.on('update-available',info=>publishUpdateStatus({state:'downloading',version:info.version,notes:releaseNotes(info),percent:0,transferred:0,total:0}));
 updater.on('download-progress',progress=>publishUpdateStatus({state:'downloading',percent:Math.max(0,Math.min(100,progress.percent||0)),transferred:progress.transferred||0,total:progress.total||0}));
 updater.on('update-not-available',info=>publishUpdateStatus({state:'current',version:info?.version||app.getVersion(),notes:releaseNotes(info),percent:100}));
 updater.on('update-downloaded',info=>{updateReady=info;publishUpdateStatus({state:'ready',version:info.version,notes:releaseNotes(info)||updateStatus.notes,percent:100,transferred:updateStatus.total||updateStatus.transferred,total:updateStatus.total||updateStatus.transferred});});
 updater.on('error',error=>{logLine('updater error '+(error?.message||error));publishUpdateStatus({state:'error'});});
 return updater;
}
/* 뒤에서 조용히 확인해 두고, 받아 놓았다가 닫을 때 설치한다. 쓰는 도중에 끊지 않는다. */
function watchUpdates(){
  if(isMac)return; // macOS 는 서명·공증 전까지 자동 업데이트 없음
  // 바른 CAD 6 은 자동 업데이트(downloads/barun-cad-6/, 바뀐 조각만 받기). 베타·5 는 외부 배포 없이 분리.
  if(!app.isPackaged||betaRuntime()||official5Runtime())return;
 const up=getUpdater();
 if(!up)return;
 setTimeout(()=>up.checkForUpdates().catch(()=>{}),8000);   // 켜자마자 말고 조금 뒤에
 setInterval(()=>up.checkForUpdates().catch(()=>{}),6*60*60*1000);
}
/* '업데이트' 단추는 새 판을 뒤에서 받아 두기만 한다. 작업은 계속하고,
   사용자가 평소처럼 앱을 닫을 때 자동으로 교체한다. */
const fromWindow=event=>!!window&&!window.isDestroyed()&&!!event?.sender&&(docs?docs.has(event.sender):event.sender===window.webContents);
ipcMain.handle('cad:check-update',async event=>{
 if(!fromWindow(event))throw Error('허용되지 않은 업데이트 요청');
  if(isMac&&app.isPackaged)return {state:'skip',message:'Mac 판은 아직 자동 업데이트를 지원하지 않습니다. 새 판은 설치 파일로 받아 주세요.'};
  if(!app.isPackaged||betaRuntime()||official5Runtime())return {state:'skip',message:'이 분리 설치판은 자동업데이트를 사용하지 않습니다.'};
 const up=getUpdater();
 if(!up)return {state:'error',message:'업데이트 기능을 불러오지 못했습니다.'};
 if(updateReady)return {...updateStatus,state:'ready',message:'업데이트를 받아 두었습니다. 작업을 계속하세요. CAD를 닫으면 자동으로 적용됩니다.'};
 try{
  const found=await up.checkForUpdates();
  const version=found?.updateInfo?.version;
  if(!version||version===app.getVersion())return {...updateStatus,state:'current',message:'최신 판을 쓰고 계십니다 ('+app.getVersion()+').'};
  publishUpdateStatus({state:'downloading',version});
  return {...updateStatus,state:'downloading',message:'새 버전을 다운로드하고 있습니다. 도면 작업은 계속할 수 있습니다.'};
 }catch(error){
  const status=error?.statusCode||error?.status;
  const message=status===404
   ? '온라인 업데이트 파일이 아직 게시되지 않았습니다. 현재 설치 버전은 '+app.getVersion()+'입니다.'
   : '온라인 업데이트 서버에 연결하지 못했습니다. 잠시 뒤 다시 확인하세요.';
  return {state:'error',message};
 }
});
ipcMain.handle('cad:apply-update',event=>{
 if(!fromWindow(event))throw Error('허용되지 않은 업데이트 요청');
 if(!updateReady||!window||window.isDestroyed())return {ok:false};
 window.close();
 return {ok:true};
});
/* S12: 메인 프로세스 예외를 조용히 삼키지 않는다. 기록하고, 치명적이면 사용자에게 알린다. */
process.on('unhandledRejection',reason=>logLine('unhandledRejection '+(reason?.stack||reason?.message||reason)));
process.on('uncaughtException',error=>{logLine('uncaughtException '+(error?.stack||error?.message||error));try{dialog.showErrorBox('바른 CAD 오류',desktopErrorMessage(error,'예기치 않은 오류가 났습니다. 도면을 저장한 뒤 CAD를 다시 실행하세요.'));}catch{}});
function receiveExternalDrawings(files){for(const file of files)allowedExternal.add(externalKey(file));if(openDrawingPaths&&files.length){openDrawingPaths(files).catch(error=>logLine('external open failed '+(error?.message||error)));}else if(externalReceiverReady&&window&&!window.isDestroyed()&&files.length)window.webContents.send('cad:external-open',files);else pendingExternal.push(...files);if(window){if(window.isMinimized())window.restore();window.show();window.focus();}}
if(!app.requestSingleInstanceLock())app.quit();else{
 app.on('second-instance',(_event,argv)=>receiveExternalDrawings(externalDrawingArgs(argv)));
 // macOS: Finder 에서 도면을 열면 명령줄 인자 대신 open-file 이 온다(켜지기 전에도 오므로 ready 전에 건다).
 app.on('open-file',(event,file)=>{event.preventDefault();receiveExternalDrawings(externalDrawingArgs([file]));});
 app.whenReady().then(start).then(watchUpdates).catch(error=>{logLine('start failed '+(error?.stack||error?.message||error));try{dialog.showErrorBox('바른 CAD',desktopErrorMessage(error,'바른 CAD를 시작하지 못했습니다. 다시 실행해 보세요.'));}catch{}app.quit();});
 app.on('window-all-closed',()=>app.quit());
 app.on('before-quit',event=>{if(backendFlushed||backendStopped||!engineUrl)return;event.preventDefault();if(supervisor)supervisor.stop();flushBackendThenQuit().finally(()=>{stopBackendNow();app.quit();});});
 app.on('will-quit',stopBackendNow);app.on('will-quit',releaseAllDrawingLocks);
}

}
