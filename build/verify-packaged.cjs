'use strict';
const fs=require('node:fs'),path=require('node:path'),{spawn}=require('node:child_process');
// 설치본 안의 실행 파일: Windows 는 '<제품명>.exe', macOS 는 '<제품명>.app/Contents/MacOS/<제품명>'.
function packagedExecutable(context){
 const name=context.packager.appInfo.productFilename;
 if(context.electronPlatformName==='darwin')return path.join(context.appOutDir,name+'.app','Contents','MacOS',name);
 return path.join(context.appOutDir,name+'.exe');
}
// 설치본 자원 폴더: Windows 는 '<출력>/resources', macOS 는 '<제품명>.app/Contents/Resources'.
function packagedResources(context){
 const name=context.packager.appInfo.productFilename;
 if(context.electronPlatformName==='darwin')return path.join(context.appOutDir,name+'.app','Contents','Resources');
 return path.join(context.appOutDir,'resources');
}
module.exports=async context=>{
 require('./packaged-data-policy.cjs').assertPackagedDataExcluded(packagedResources(context));
 // 보안 마무리(release-hardening.cjs): 기본 화면 묶음 빼기, 맥 암호 없는 연결 허용 끄기. 서명 전에 해야 서명에 들어간다.
 const resources=packagedResources(context);
 require('./release-hardening.cjs').prepare({resources,infoPlist:context.electronPlatformName==='darwin'?path.join(resources,'..','Info.plist'):null});
 const root=context.packager.projectDir,version=context.packager.appInfo.version;
 const report=path.join(root,'tmp','release-'+version+(context.electronPlatformName==='darwin'?'-mac':''),'packaged-quality.json');
 fs.mkdirSync(path.dirname(report),{recursive:true});
 await new Promise((resolve,reject)=>{
  const child=spawn(packagedExecutable(context),['--barun-verify','--report',report],{windowsHide:true,stdio:'inherit'});
  const timer=setTimeout(()=>{child.kill();reject(Error('Packaged verification timed out; installer blocked'));},180000);
  child.once('error',error=>{clearTimeout(timer);reject(error);});
  child.once('exit',code=>{clearTimeout(timer);if(code!==0)return reject(Error('Packaged verification failed; installer blocked. '+report));
   try{const result=JSON.parse(fs.readFileSync(report,'utf8'));if(result.report?.status!=='passed')throw Error('Missing passing verification result');resolve();}catch(error){reject(error);}
  });
 });
};
module.exports.packagedExecutable=packagedExecutable;
module.exports.packagedResources=packagedResources;
