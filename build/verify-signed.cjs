'use strict';
// macOS afterSign: Developer ID 서명·공증이 끝난 .app 을 그대로 검사한다(서명 전 afterPack 검사로는 hardened runtime 문제를 못 잡는다).
// 1) 묶음 전체와 안쪽 실행 파일(앱·엔진·DWG 변환기 둘)의 서명·hardened runtime·권한  2) 공증 표(staple)·Gatekeeper
// 3) 서명된 앱의 --barun-verify  4) 서명된 엔진의 단독 시험(standalone_smoke.py: DXF·DWG 왕복 포함)  5) 두 변환기 실행
// 모두 통과하면 tmp/release-<판>-mac/signed-check.json 에 passed 를 남긴다. build_desktop.py 가 이 기록이 없으면 빌드를 실패시킨다.
const fs=require('node:fs'),path=require('node:path'),{spawnSync,spawn}=require('node:child_process');
const verify=require('./verify-packaged.cjs');

function run(command,args,options={}){
 const result=spawnSync(command,args,{encoding:'utf8',timeout:600000,...options});
 if(result.error)throw result.error;
 return {code:result.status,out:(result.stdout||'')+(result.stderr||'')};
}
function must(condition,message){if(!condition)throw Error(message);}

// 안쪽에서 꼭 서명돼야 하는 실행 파일(묶음 기준 상대 경로).
function innerExecutables(name){
 const backend=path.join('Contents','Resources','backend');
 return [
  {file:path.join('Contents','MacOS',name),jit:true},
  {file:path.join(backend,'barun-cad-6-server'),jit:false},
  {file:path.join(backend,'_internal','dwg-runtime','BarunConverter'),jit:true},
  {file:path.join(backend,'_internal','acadrust-runtime','barun-dwg2dxf'),jit:false},
 ];
}

function checkSignature(app,{file,jit}){
 const target=path.join(app,file);
 must(fs.existsSync(target),'서명 검사할 실행 파일이 없습니다: '+file);
 const info=run('codesign',['-dvvv',target]).out;
 must(/Authority=Developer ID Application: /.test(info),'Developer ID 서명이 아닙니다: '+file);
 must(/flags=0x[0-9a-f]*\(.*runtime.*\)/.test(info),'hardened runtime 이 꺼져 있습니다: '+file);
 must(/Timestamp=/.test(info),'보안 시각(timestamp)이 없습니다: '+file);
 if(jit){
  const entitlements=run('codesign',['-d','--entitlements','-','--xml',target]).out;
  must(entitlements.includes('com.apple.security.cs.allow-jit'),'JIT 권한이 없습니다: '+file);
 }
}

function runPackagedVerify(executable,report){
 return new Promise((resolve,reject)=>{
  const child=spawn(executable,['--barun-verify','--report',report],{stdio:'inherit'});
  const timer=setTimeout(()=>{child.kill();reject(Error('서명된 앱 검사 시간 초과'));},180000);
  child.once('error',error=>{clearTimeout(timer);reject(error);});
  child.once('exit',code=>{clearTimeout(timer);
   try{must(code===0,'서명된 앱 검사 실패(종료 코드 '+code+'): '+report);
    must(JSON.parse(fs.readFileSync(report,'utf8')).report?.status==='passed','서명된 앱 검사 통과 기록이 없습니다');resolve();}
   catch(error){reject(error);}
  });
 });
}

module.exports=async context=>{
 if(context.electronPlatformName!=='darwin')return;
 const name=context.packager.appInfo.productFilename,version=context.packager.appInfo.version,root=context.packager.projectDir;
 const app=path.join(context.appOutDir,name+'.app');
 const folder=path.join(root,'tmp','release-'+version+'-mac'),record=path.join(folder,'signed-check.json');
 fs.mkdirSync(folder,{recursive:true});fs.rmSync(record,{force:true});
 const checks=[];
 const strict=run('codesign',['--verify','--deep','--strict','--verbose=2',app]);
 must(strict.code===0,'묶음 서명 검사 실패: '+strict.out.slice(-800));checks.push('codesign --verify --deep --strict');
 for(const item of innerExecutables(name)){checkSignature(app,item);checks.push('서명·runtime: '+item.file);}
 const staple=run('xcrun',['stapler','validate',app]);
 must(staple.code===0,'공증 표(staple)가 없습니다: '+staple.out.slice(-400));checks.push('공증 표(staple)');
 const gatekeeper=run('spctl',['-a','-vv','--type','exec',app]);
 must(gatekeeper.code===0&&/source=Notarized Developer ID/.test(gatekeeper.out),'Gatekeeper 가 받아들이지 않습니다: '+gatekeeper.out.slice(-400));checks.push('Gatekeeper(공증된 Developer ID)');
 // 보안 마무리(release-hardening.cjs): 안전 스위치(퓨즈)·기본 화면 묶음 없음·암호 없는 연결 허용 꺼짐이 서명된 앱에 실제로 들어갔는지.
 const hardening=await require('./release-hardening.cjs').check({electron:app,resources:path.join(app,'Contents','Resources'),infoPlist:path.join(app,'Contents','Info.plist')});
 must(!hardening.length,hardening.join(' / '));checks.push('보안 마무리(안전 스위치·기본 화면 묶음·연결 설정)');
 await runPackagedVerify(verify.packagedExecutable(context),path.join(folder,'signed-quality.json'));checks.push('서명된 앱 --barun-verify');
 const python=process.env.BARUN_BUILD_PYTHON||'python3';
 const backend=path.join(app,'Contents','Resources','backend','barun-cad-6-server');
 const smoke=run(python,[path.join(root,'standalone_smoke.py'),backend,'--output',path.join(folder,'signed-standalone-smoke.json')],{cwd:root});
 must(smoke.code===0,'서명된 엔진 단독 시험 실패: '+smoke.out.slice(-1200));checks.push('서명된 엔진 단독 시험(DXF·DWG 왕복)');
 const backendDir=path.join(app,'Contents','Resources','backend','_internal');
 const dotnet=run(path.join(backendDir,'dwg-runtime','BarunConverter'),[],{timeout:60000});
 must(dotnet.code===2&&dotnet.out.includes('required'),'서명된 BarunConverter 가 실행되지 않습니다: '+dotnet.out.slice(-300));checks.push('서명된 BarunConverter 실행');
 const rust=run(path.join(backendDir,'acadrust-runtime','barun-dwg2dxf'),[],{timeout:60000});
 must(rust.code===1&&rust.out.includes('사용법: barun-dwg2dxf'),'서명된 barun-dwg2dxf 가 실행되지 않습니다: '+rust.out.slice(-300));checks.push('서명된 barun-dwg2dxf 실행');
 fs.writeFileSync(record,JSON.stringify({status:'passed',version,app,checks,createdAt:new Date().toISOString()},null,2)+'\n');
 console.log('서명·공증 뒤 검사 통과:',checks.length+'건');
};
module.exports.innerExecutables=innerExecutables;
