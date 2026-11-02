const path = require('node:path');
const fs = require('node:fs');

const DRAWING_EXTENSIONS = new Set(['.dwg', '.dxf', '.bcad']);

function externalDrawingArgs(argv) {
  const found = [];
  const seen = new Set();
  for (const value of argv || []) {
    if (typeof value !== 'string' || !path.isAbsolute(value) || !DRAWING_EXTENSIONS.has(path.extname(value).toLowerCase())) continue;
    const resolved = path.resolve(value);
    const key = externalKey(resolved);
    if (seen.has(key)) continue;
    seen.add(key);
    found.push(resolved);
  }
  return found;
}

function externalKey(value) {
  return path.resolve(value).toLowerCase();
}

/* 사용자별 데이터 폴더(BarunCAD/ 의 부모). 엔진(runtime_paths.local_data_root)과 같은 규칙:
   Windows 는 LOCALAPPDATA, macOS 는 ~/Library/Application Support. */
function localDataRoot(source=process.env, platform=process.platform) {
  if (source.LOCALAPPDATA) return source.LOCALAPPDATA;
  const home=source.HOME||source.USERPROFILE||require('node:os').homedir();
  return platform==='darwin'?path.join(home,'Library','Application Support'):home;
}

function backendEnvironment(source=process.env, home=source.USERPROFILE, platform=process.platform) {
  const environment={...source};
  // macOS 엔진도 LOCALAPPDATA 하나로 사용자 데이터 폴더를 찾게 한다(복구본·연결 파일·로그 위치가 셸과 같아진다).
  if (platform==='darwin' && !environment.LOCALAPPDATA) environment.LOCALAPPDATA=localDataRoot(environment, platform);
  if (environment.BARUN_DESIGN_CATALOG) return environment;
  const localRoots=[];
  if(environment.LOCALAPPDATA)localRoots.push(environment.LOCALAPPDATA);
  if(home)localRoots.push(path.join(home,'AppData','Local'));
  for(const base of [...new Set(localRoots.map(value=>path.resolve(value)))]){
    try{
      const config=JSON.parse(fs.readFileSync(path.join(base,'BarunCAD','design-cases.json'),'utf8').replace(/^\uFEFF/,''));
      const catalog=typeof config.catalogPath==='string'?path.resolve(config.catalogPath):'';
      if(catalog&&fs.statSync(path.join(catalog,'catalog.sqlite')).isFile()){
        environment.LOCALAPPDATA=environment.LOCALAPPDATA||base;
        environment.BARUN_DESIGN_CATALOG=catalog;
        break;
      }
    }catch{}
  }
  return environment;
}

/* N1: 저장 대화상자가 돌려준 경로라도 셸에서 한 번 더 거른다(서버 validate_save_path 와 같은 규칙).
   Windows 는 로컬 드라이브 절대 경로만, UNC·장치 이름·상대 조각·대체 스트림·형식 불일치 거부.
   macOS 는 '/' 로 시작하는 절대 경로만 받고, 파일 이름에는 Windows 이름 규칙(장치 이름·금지 문자)을 그대로 적용한다. 문제 없으면 '' 를 돌려준다. */
const DEVICE_NAMES=new Set(['CON','PRN','AUX','NUL','CLOCK$',...Array.from({length:9},(_,i)=>'COM'+(i+1)),...Array.from({length:9},(_,i)=>'LPT'+(i+1))]);
function localSavePathProblem(target,format,platform=process.platform){
  const windows=platform==='win32';
  const text=String(target||'');
  if(!text||text.includes('\0')||text.length>1024)return '저장 경로가 올바르지 않습니다.';
  if(text.startsWith('\\\\')||text.startsWith('//'))return '네트워크(UNC) 경로에는 저장할 수 없습니다. 로컬 드라이브를 선택하세요.';
  if(windows){
    if(!/^[A-Za-z]:[\\/]/.test(text))return '저장 경로는 로컬 드라이브의 전체 경로여야 합니다.';
    if(text.slice(2).includes(':'))return '저장 경로에 쓸 수 없는 문자(:)가 있습니다.';
    const parts=text.slice(2).split(/[\\/]+/).filter(Boolean);
    if(parts.some(part=>part==='.'||part==='..'||part!==part.trim()))return '저장 경로에 상대 경로 조각(..)이 있습니다.';
    if(parts.some(part=>/[<>"|?*]/.test(part)))return '저장 경로에 쓸 수 없는 문자가 있습니다.';
  }else{
    if(!text.startsWith('/'))return '저장 경로는 전체 경로여야 합니다.';
    const parts=text.split('/').filter(Boolean);
    if(parts.some(part=>part==='.'||part==='..'))return '저장 경로에 상대 경로 조각(..)이 있습니다.';
    if(/[<>"|?*:\\]/.test(parts.at(-1)||''))return '저장 파일 이름에 쓸 수 없는 문자가 있습니다.';
  }
  if(!['dxf','dwg','bcad'].includes(format)||!text.toLowerCase().endsWith('.'+format))return '저장 형식과 확장자가 맞지 않습니다 (.'+format+').';
  const stem=deviceStem((windows?path.win32:path.posix).basename(text));
  if(DEVICE_NAMES.has(stem))return '예약된 장치 이름은 파일 이름으로 쓸 수 없습니다: '+stem;
  return '';
}
/* 장치 이름 판정용 줄기: 첫 점 앞, 끝의 공백·점 제거, 위첨자 숫자(¹²³) 정규화, 대문자 — 서버 device_stem 과 같다. */
const SUPERSCRIPTS={'¹':'1','²':'2','³':'3','⁴':'4','⁵':'5','⁶':'6','⁷':'7','⁸':'8','⁹':'9'};
function deviceStem(name){
  return String(name).split('.')[0].replace(/[ .]+$/,'').replace(/[¹²³⁴⁵⁶⁷⁸⁹]/g,ch=>SUPERSCRIPTS[ch]).toUpperCase();
}

/* 'reg query <키> /ve' 출력의 열기 명령이 가리키는 실행 파일이 지워졌는지 본다.
   옛 바른 CAD 를 지운 뒤 남은 BarunCAD.DXF 같은 연결이 빈 아이콘으로 보이는 경우만 참이다(명령이 없거나 파일이 있으면 거짓). */
function staleOpenCommand(regOutput, exists=fs.existsSync) {
  const value=/REG_(?:EXPAND_)?SZ\s+(.+?)\s*$/m.exec(String(regOutput||''))?.[1]||'';
  const exe=/^"([^"]+\.exe)"/i.exec(value)?.[1]||/^(\S+\.exe)\b/i.exec(value)?.[1]||'';
  // 레지스트리 값은 늘 Windows 경로다. 맥에서 시험이 돌 때도 Windows 규칙으로 절대 경로를 가린다.
  return Boolean(exe)&&path.win32.isAbsolute(exe)&&!exists(exe);
}

module.exports = { DRAWING_EXTENSIONS, externalDrawingArgs, externalKey, localDataRoot, backendEnvironment, localSavePathProblem, deviceStem, staleOpenCommand };

/* ── ACAD200 영역 8: 도면 파일 안전(.dwl 잠금·저장 전 검사·교체 재시도·최근 문서·충돌 기록) ──
   AutoCAD 와 같은 .dwl 3줄(사용자·컴퓨터·시각)을 써서 서로 알아보고, 4번째 줄에 바른 CAD 표시(pid)를 둬
   우리가 남긴 오래된 잠금(강제 종료)은 스스로 걷어 낸다. AutoCAD 가 남긴 잠금은 보고만 하고 건드리지 않는다. */
const os=require('node:os');
const DWL_MARK='BarunCAD pid=';
const dwlPath=file=>file.slice(0,file.length-path.extname(file).length)+'.dwl';
function readWhoHas(file,fsImpl=fs){
  try{
    const text=fsImpl.readFileSync(dwlPath(file),'utf8').replace(/^\uFEFF/,'');
    const [user='',host='',when='',mark='']=text.split(/\r?\n/);
    const pid=mark.startsWith(DWL_MARK)?Number(mark.slice(DWL_MARK.length))||null:null;
    return {user:user.trim(),host:host.trim(),when:when.trim(),barunPid:pid,raw:text};
  }catch{return null;}
}
function processAlive(pid){
  if(!Number.isSafeInteger(pid)||pid<=0)return false;
  try{process.kill(pid,0);return true;}catch(error){return error?.code==='EPERM';}
}
const sameHost=(a,b)=>String(a||'').toLowerCase()===String(b||'').toLowerCase();
/** 이 잠금이 지금 이 프로세스(또는 같은 PC 에서 이미 꺼진 바른 CAD)의 것인지. */
function ownDwl(who,{host=os.hostname(),pid=process.pid,alive=processAlive}={}){
  if(!who||!who.barunPid||!sameHost(who.host,host))return false;
  return who.barunPid===pid||!alive(who.barunPid);
}
function whoHasMessage(who){
  if(!who)return '';
  const name=who.user||'다른 사용자',host=who.host?`(${who.host})`:'';
  return `${name}${host} 님이 ${who.when||'얼마 전'}부터 이 도면을 열고 있습니다`;
}
/** 도면을 열 때 .dwl 을 만든다. 남이 연 도면이면 만들지 않고 {readOnly:true,who} 를 돌려준다. 쓰기 실패(읽기 전용 폴더)는 조용히 넘어간다. */
function claimDrawing(file,{fs:fsImpl=fs,user,host=os.hostname(),pid=process.pid,now=new Date(),alive=processAlive,enabled=process.env.BARUN_CAD_DWL!=='0'}={}){
  const none={claimed:false,readOnly:false,who:null,release(){}};
  if(!enabled||typeof file!=='string'||!path.isAbsolute(file))return none;
  const who=readWhoHas(file,fsImpl);
  if(who&&!ownDwl(who,{host,pid,alive}))return {...none,readOnly:true,who};
  let name=user;if(!name){try{name=os.userInfo().username;}catch{name='user';}}
  const stamp=now.toLocaleString('ko-KR',{hour12:false});
  const content=[name,host,stamp,DWL_MARK+pid].join('\r\n')+'\r\n';
  try{fsImpl.writeFileSync(dwlPath(file),content,'utf8');}catch(error){return {...none,error:error?.code||String(error)};}
  return {claimed:true,readOnly:false,who:null,release(){
    try{if(fsImpl.readFileSync(dwlPath(file),'utf8')===content)fsImpl.unlinkSync(dwlPath(file));}catch{}   // 남이 덮어쓴 잠금은 지우지 않는다
  }};
}
/** 저장 전 검사(814): 읽기 전용·쓰기 열기 실패(다른 프로그램이 잡음)·남의 .dwl 을 큰 파일을 다 쓰기 전에 알린다. 문제 없으면 {ok:true}. */
function savePreflight(target,{fs:fsImpl=fs,host=os.hostname(),pid=process.pid,alive=processAlive}={}){
  try{
    if(fsImpl.existsSync(target)){
      fsImpl.accessSync(target,fsImpl.constants.W_OK);
      const fd=fsImpl.openSync(target,'r+');fsImpl.closeSync(fd);
    }
  }catch(error){
    const code=error?.code||'';
    if(code==='EACCES'||code==='EPERM')return {ok:false,code:'readonly',reason:'읽기 전용이거나 쓸 권한이 없는 파일입니다'};
    if(code==='EBUSY')return {ok:false,code:'busy',reason:'다른 프로그램이 이 파일을 쓰고 있습니다'};
    return {ok:false,code:code||'error',reason:'파일을 쓸 수 없습니다 ('+(code||error?.message||error)+')'};
  }
  const who=readWhoHas(target,fsImpl);
  if(who&&!ownDwl(who,{host,pid,alive}))return {ok:false,code:'in-use',reason:whoHasMessage(who),who};
  return {ok:true};
}
const RETRY_CODES=new Set(['EBUSY','EPERM','EACCES']);
/** 교체 저장(813): 이전 본은 하드 링크로 남겨(복사 없음, 대상이 사라지는 순간 없음) 백신·동기화 프로그램이 잠깐 잡으면 200·400·800 ms 쉬며 다시 한다. */
async function replaceWithRetry(temp,target,{backup='.previous',delays=[200,400,800],fs:fsp=require('node:fs/promises'),sleep=ms=>new Promise(r=>setTimeout(r,ms)),assertCurrent=()=>{},overwriteBackup=true}={}){
  await assertCurrent();
  if(backup){
    let keep=target+backup;
    for(;;){
      try{await fsp.link(target,keep);break;}
      catch(error){
        if(error?.code==='ENOENT')break;
        if(error?.code==='EEXIST'){keep=target+backup+'.'+require('node:crypto').randomUUID();continue;}
        try{await fsp.copyFile(target,keep,require('node:fs').constants.COPYFILE_EXCL);break;}
        catch(copyError){
          if(copyError?.code==='ENOENT')break;
          if(copyError?.code==='EEXIST'){keep=target+backup+'.'+require('node:crypto').randomUUID();continue;}
          throw copyError;
        }
      }
    }
  }
  for(let attempt=0;;attempt++){
    try{await assertCurrent();await fsp.rename(temp,target);return {attempts:attempt+1};}
    catch(error){
      if(attempt>=delays.length||!RETRY_CODES.has(error?.code))throw error;
      await sleep(delays[attempt]);
    }
  }
}
/** 열기·저장·수정 상태를 창에 반영할 일(825 윈도우 대응: 점프 목록 최근 문서, 맥: 대표 파일·수정 점). */
function documentStateActions({platform=process.platform,path:file='',dirty=false,event='open'}={}){
  const actions=[],p=platform==='win32'?path.win32:path.posix;   // 경로 규칙은 그 운영체제 것(맥에서 Windows 경로를 시험할 때도)
  if(typeof file==='string'&&p.isAbsolute(file)&&DRAWING_EXTENSIONS.has(p.extname(file).toLowerCase())){
    if(event==='open'||event==='save')actions.push(['addRecentDocument',file]);
    if(platform==='darwin')actions.push(['setRepresentedFilename',file]);
  }
  if(platform==='darwin')actions.push(['setDocumentEdited',!!dirty]);
  return actions;
}
/** 화면 프로세스가 죽었을 때 남길 기록(823). 덤프(crashpad)는 같은 폴더에 Electron 이 쓴다. 밖으로 보내지 않는다. */
function crashNote(details,{now=new Date(),metrics=[],lastCommands=[],version=''}={}){
  const memory=metrics.map(item=>({type:item.type,pid:item.pid,workingSetMB:Math.round((item.memory?.workingSetSize||0)/1024),privateMB:Math.round((item.memory?.privateBytes||0)/1024)}));
  return {at:now.toISOString(),version,reason:details?.reason||'unknown',exitCode:details?.exitCode??null,lastCommands:lastCommands.slice(-10),memory};
}
Object.assign(module.exports,{dwlPath,readWhoHas,claimDrawing,ownDwl,whoHasMessage,savePreflight,replaceWithRetry,documentStateActions,crashNote,processAlive});

/** AI 저장은 대화 시작 시 받은 epoch가 현재 요청과 같을 때만 마지막 파일 교체를 허용한다. */
function assertAIFileWrite(payload,state,now=Date.now()){
 if(payload?.aiRequestEpoch===undefined)return;
 if(!Number.isSafeInteger(payload.aiRequestEpoch)||!Number.isSafeInteger(payload.aiExpiresAt)||payload.aiExpiresAt<=now||!state||state.cancelled||state.epoch!==payload.aiRequestEpoch)throw Error('중지되거나 만료된 AI 파일 저장 요청입니다.');
}
module.exports.assertAIFileWrite=assertAIFileWrite;
