'use strict';
// Installer-only orchestration. Nothing here runs during ordinary drawing work.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
// Electron's patched fs treats .asar as a directory. Hash physical package bytes.
const physicalFs=process.versions.electron?require('original-fs'):fs;
const gate=require('./quality-gate.cjs');
const baseline=require('./quality-gate-baseline.json');
const sha=value=>crypto.createHash('sha256').update(value).digest('hex');
function option(name,argv=process.argv){const i=argv.indexOf(name);return i<0?null:argv[i+1];}
function absolute(value,label){if(!value||!path.isAbsolute(value))throw Error(label+' must be an absolute path');return path.resolve(value);}
// Windows: 실행 파일 폴더 전체(자원은 그 아래 resources). macOS: '<제품명>.app' 묶음 전체(자원은 Contents/Resources).
// 맥 묶음 안의 프레임워크는 심볼릭 링크(Versions/Current 등)로 되어 있어, 묶음 안을 가리키는 상대 링크만 링크 글자 그대로 넣는다.
function artifactDigest(resourcesPath,executable,platform=process.platform){
 // 맥 방식은 실행 파일이 실제로 '.app/Contents/MacOS' 안에 있을 때만(맥에서 Windows 폴더 모양을 시험할 때는 Windows 규칙).
 const exe=absolute(executable,'executable'),mac=platform==='darwin'&&path.basename(path.dirname(exe))==='MacOS'&&path.basename(path.dirname(path.dirname(exe)))==='Contents';
 const root=mac?path.resolve(path.dirname(exe),'..','..'):path.dirname(exe),files=[],links=[];
 const expected=mac?path.join(root,'Contents','Resources'):path.join(root,'resources');
 if((mac&&!root.endsWith('.app'))||path.resolve(resourcesPath)!==expected)throw Error('Unexpected packaged resources location');
 const walk=dir=>{for(const entry of physicalFs.readdirSync(dir,{withFileTypes:true})){const file=path.join(dir,entry.name);
  if(entry.isSymbolicLink()){
   const target=mac?physicalFs.readlinkSync(file):null;
   if(!mac||path.isAbsolute(target)||path.relative(root,path.resolve(dir,target)).split(path.sep)[0]==='..')throw Error('Symbolic links are not supported in a verified artifact');
   links.push([file,target]);continue;
  }
  if(entry.isDirectory())walk(file);else if(!(dir===root&&(/^(?:Uninstall Barun CAD 6\.exe|uninstallerIcon\.ico)$/i.test(entry.name))))files.push(file);}};
 walk(root);
 const hash=crypto.createHash('sha256');
 const buffer=Buffer.allocUnsafe(1024*1024);
 for(const file of files.sort()){hash.update(path.relative(root,file).replaceAll('\\','/'));hash.update('\0');const content=crypto.createHash('sha256'),fd=physicalFs.openSync(file,'r');try{let n;while((n=physicalFs.readSync(fd,buffer,0,buffer.length,null))>0)content.update(buffer.subarray(0,n));}finally{physicalFs.closeSync(fd);}hash.update(content.digest('hex'));hash.update('\n');}
 for(const [file,target] of links.sort((a,b)=>a[0]<b[0]?-1:a[0]>b[0]?1:0)){hash.update(path.relative(root,file).replaceAll('\\','/'));hash.update('\0link\0');hash.update(target);hash.update('\n');}
 return hash.digest('hex');
}
function writeJson(target,value){fs.mkdirSync(path.dirname(target),{recursive:true});const tmp=target+'.'+crypto.randomUUID()+'.tmp';fs.writeFileSync(tmp,JSON.stringify(value,null,2)+'\n',{flag:'wx'});fs.renameSync(tmp,target);}
function loadProbes(registry,registryPath){
 return (registry.probeHashes||[]).map(hash=>{
  if(!/^[a-f0-9]{64}$/.test(hash))throw Error('Invalid retained probe hash');
  const source=fs.readFileSync(path.join(path.dirname(registryPath),'probes',hash+'.js'),'utf8');
  if(sha(source)!==hash)throw Error('Retained regression probe was changed: '+hash);
  return {id:hash,source};
 });
}
function prepare({registryPath,reportPath,resourcesPath,executable,version}){
 absolute(reportPath,'report');
 if(registryPath)absolute(registryPath,'registry');
 if(registryPath){
  if(fs.existsSync(registryPath+'.lock'))throw Error('검증 DB가 잠겨 있어 설치를 차단했습니다.');
  for(const folder of [path.dirname(registryPath),path.join(path.dirname(registryPath),'reports'),path.join(path.dirname(registryPath),'probes')]){
   fs.mkdirSync(folder,{recursive:true});
   const permissionProbe=path.join(folder,crypto.randomUUID()+'.write-check');
   fs.writeFileSync(permissionProbe,'',{flag:'wx'});fs.unlinkSync(permissionProbe);
  }
 }
 const registry=registryPath?gate.loadRegistry({registryPath,baseline}):gate.createRegistry(baseline);
 const probeSource=fs.readFileSync(path.join(__dirname,'quality-probe.js'),'utf8'),probeHash=sha(probeSource);
 const candidate={version,artifactSha256:artifactDigest(resourcesPath,executable),runId:crypto.randomUUID()};
 return {registryPath,reportPath,registry,candidate,probeHash,probeSource,additionalProbes:registryPath?loadProbes(registry,registryPath).filter(p=>p.id!==probeHash):[]};
}
function finish(context,result){
 const report={...result,schemaVersion:1,runnerId:gate.RUNNER_ID,...context.candidate,
  executedProbeHashes:[...new Set([context.probeHash,...context.additionalProbes.map(p=>p.id)])]};
 try{
  if(result.status!=='passed'||result.errors?.length)throw Error('Isolated runtime verification failed');
  gate.validateCandidate({registry:context.registry,candidate:context.candidate,report,proposedCriteria:baseline.criteria,proposedProbeHashes:[context.probeHash]});
  report.status='passed';
 }catch(error){report.status='failed';report.gateError={code:error.code||'RUNTIME_FAILED',message:error.message,details:error.details||[]};}
 const envelope={schemaVersion:1,createdAt:new Date().toISOString(),registry:context.registry,candidate:context.candidate,probeHash:context.probeHash,report};
 writeJson(context.reportPath,envelope);
 return report;
}
function commit({registryPath,reportPath,resourcesPath,executable,version}){
 absolute(registryPath,'registry');absolute(reportPath,'report');
 const envelope=JSON.parse(fs.readFileSync(reportPath,'utf8'));
 if(envelope.schemaVersion!==1||envelope.report?.status!=='passed')throw Error('No successful installer verification');
 // An assisted installer may stay open for hours. Identity+DB revision bind the
 // result; an elapsed-time limit here would reject only AFTER uninstalling.
 if(!Number.isFinite(Date.parse(envelope.createdAt)))throw Error('Invalid verification timestamp');
 const current={...envelope.candidate,version,artifactSha256:artifactDigest(resourcesPath,executable)};
 const source=fs.readFileSync(path.join(__dirname,'quality-probe.js'),'utf8'),hash=sha(source);
 if(hash!==envelope.probeHash)throw Error('Installed verifier differs from staged verifier');
 const args={registryPath,registry:envelope.registry,candidate:current,report:envelope.report,baseline,proposedCriteria:baseline.criteria,proposedProbeHashes:[hash]};
 gate.validateCandidate(args);
 // Preserve the old executable tests as well as their IDs. Future candidates must rerun them.
 loadProbes(envelope.registry,registryPath);
 const folder=path.join(path.dirname(registryPath),'probes');fs.mkdirSync(folder,{recursive:true});const target=path.join(folder,hash+'.js');
 if(fs.existsSync(target)){if(sha(fs.readFileSync(target))!==hash)throw Error('Stored probe hash mismatch');}
 else fs.writeFileSync(target,source,{flag:'wx'});
 writeJson(path.join(path.dirname(registryPath),'reports',current.runId+'.json'),envelope.report);
 return gate.commitRegistry(args);
}
async function main(){
 const {app}=require('electron');
 const reportPath=option('--report'),registryPath=option('--registry');
 try{
  if(!app.isPackaged)throw Error('Installer verification requires the packaged application');
  const args={registryPath,reportPath,resourcesPath:process.resourcesPath,executable:process.execPath,version:app.getVersion()};
  if(process.argv.includes('--barun-quality-commit')){commit(args);app.exit(0);return;}
  const context=prepare(args);
  const report=await require('./quality-verifier.cjs').runVerification({additionalProbes:context.additionalProbes,finalizeReport:result=>finish(context,result)});
  app.exit(report.status==='passed'?0:2);
 }catch(error){
  try{if(reportPath&&path.isAbsolute(reportPath))writeJson(reportPath,{schemaVersion:1,status:'failed',error:{code:error.code||'VERIFIER_FAILED',message:error.message}});}catch{}
  console.error('CAD quality verification blocked:',error.message);app.exit(2);
 }
}
module.exports={artifactDigest,loadProbes,prepare,finish,commit,main,sha};
