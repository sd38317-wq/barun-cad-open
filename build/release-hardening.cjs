'use strict';
// 설치본 보안 마무리(2026-10-20 보안 점검 후속). 기준은 이 파일 한 곳이고 세 군데서 쓴다.
// 1) electron-builder 설정 electronFuses = FUSES (official6·official6.mac, 시험이 같은지 본다)
// 2) afterPack(verify-packaged.cjs) → prepare: 서명 전에 기본 화면 묶음(default_app.asar)을 빼고, 맥은 암호 없는 연결 허용을 끈다
// 3) 맥 afterSign(verify-signed.cjs)·빌드 끝(build_desktop.py) → check: 서명된 결과에 실제로 들어갔는지 읽어 본다
const fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process');

// 안전 스위치(Electron 퓨즈): Node 실행기·NODE_OPTIONS·--inspect 로 서명된 앱을 쓰지 못하게 하고,
// 바꿔치기한 app.asar·app 폴더를 읽지 않으며, 쿠키는 운영체제 보안 저장소 열쇠로 암호화한다.
const FUSES=Object.freeze({
 runAsNode:false,
 enableCookieEncryption:true,
 enableNodeOptionsEnvironmentVariable:false,
 enableNodeCliInspectArguments:false,
 enableEmbeddedAsarIntegrityValidation:true,
 onlyLoadAppFromAsar:true,
});
const FUSE_OPTION={runAsNode:'RunAsNode',enableCookieEncryption:'EnableCookieEncryption',enableNodeOptionsEnvironmentVariable:'EnableNodeOptionsEnvironmentVariable',
 enableNodeCliInspectArguments:'EnableNodeCliInspectArguments',enableEmbeddedAsarIntegrityValidation:'EnableEmbeddedAsarIntegrityValidation',onlyLoadAppFromAsar:'OnlyLoadAppFromAsar'};
const PLIST_BUDDY='/usr/libexec/PlistBuddy';
const DEFAULT_APP='default_app.asar';

function plist(file,command){
 const result=spawnSync(PLIST_BUDDY,['-c',command,file],{encoding:'utf8'});
 return {ok:result.status===0,out:(result.stdout||'').trim(),err:(result.stderr||result.stdout||'').trim()};
}

/* 서명 전(afterPack): resources = 앱 자원 폴더, infoPlist = 맥 Info.plist(Windows 는 null). */
function prepare({resources,infoPlist=null}){
 // Electron 기본 화면 묶음: 우리 앱은 쓰지 않는다(app.asar 만 읽는다).
 fs.rmSync(path.join(resources,DEFAULT_APP),{force:true});
 if(!infoPlist)return;
 // 무결성 표의 기본 화면 항목도 지운다(없는 파일을 가리키지 않게).
 plist(infoPlist,'Delete :ElectronAsarIntegrity:Resources/'+DEFAULT_APP);
 // electron-builder 가 늘 켜 두는 '아무 주소나 암호 없이 연결 허용'을 끈다. 화면·엔진 사이(127.0.0.1·localhost)는
 // NSAllowsLocalNetworking·예외 주소로 그대로 열려 있다. 앱의 바깥 연결은 크롬망(https)이라 이 설정을 쓰지 않는다.
 const set=plist(infoPlist,'Set :NSAppTransportSecurity:NSAllowsArbitraryLoads false');
 if(!set.ok)throw Error('암호 없는 연결 허용을 끄지 못했습니다: '+set.err);
}

/* 서명 뒤·빌드 끝: 문제 목록(빈 목록이면 통과). electron = 맥 .app 묶음 또는 Windows 실행 파일. */
async function check({electron,resources,infoPlist=null}){
 const problems=[];
 const {getCurrentFuseWire,FuseV1Options}=require('@electron/fuses');
 const wire=await getCurrentFuseWire(electron),on='1'.charCodeAt(0),off='0'.charCodeAt(0);
 for(const [name,enabled] of Object.entries(FUSES)){
  if(wire[FuseV1Options[FUSE_OPTION[name]]]!==(enabled?on:off))problems.push('안전 스위치가 잘못되었습니다: '+FUSE_OPTION[name]+(enabled?' 가 켜져 있어야 합니다':' 가 꺼져 있어야 합니다'));
 }
 if(fs.existsSync(path.join(resources,DEFAULT_APP)))problems.push('기본 화면 묶음('+DEFAULT_APP+')이 남아 있습니다.');
 if(infoPlist){
  const arbitrary=plist(infoPlist,'Print :NSAppTransportSecurity:NSAllowsArbitraryLoads');
  if(!arbitrary.ok||arbitrary.out!=='false')problems.push('맥 암호 없는 연결 허용(NSAllowsArbitraryLoads)이 꺼져 있지 않습니다.');
  const local=plist(infoPlist,'Print :NSAppTransportSecurity:NSAllowsLocalNetworking');
  if(!local.ok||local.out!=='true')problems.push('화면·엔진 연결(NSAllowsLocalNetworking)이 꺼졌습니다.');
  if(plist(infoPlist,'Print :ElectronAsarIntegrity:Resources/'+DEFAULT_APP).ok)problems.push('무결성 표에 기본 화면 묶음 항목이 남아 있습니다.');
 }
 return problems;
}

module.exports={FUSES,prepare,check};

// 빌드 끝 검사(build_desktop.py): node build/release-hardening.cjs check <electron(.app|.exe)> <resources> [Info.plist]
if(require.main===module){
 const [command,electron,resources,infoPlist]=process.argv.slice(2);
 if(command!=='check'||!electron||!resources){console.error('사용법: node build/release-hardening.cjs check <앱 묶음 또는 실행 파일> <자원 폴더> [Info.plist]');process.exit(2);}
 check({electron,resources,infoPlist:infoPlist||null}).then(problems=>{
  for(const problem of problems)console.log('보안 검사 실패:',problem);
  if(!problems.length)console.log('보안 검사 통과: 안전 스위치·기본 화면 묶음'+(infoPlist?'·맥 연결 설정':''));
  process.exit(problems.length?1:0);
 }).catch(error=>{console.error('보안 검사 실패:',error.message);process.exit(1);});
}
