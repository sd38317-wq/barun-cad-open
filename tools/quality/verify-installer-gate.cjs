'use strict';
// Exercise the real packaged executable without installing or touching live CAD.
const fs=require('node:fs'),path=require('node:path'),{spawn}=require('node:child_process');
const {createRegistry}=require('../../quality-gate.cjs'),{sha}=require('../../quality-install.cjs');
const root=path.resolve(__dirname,'../..'),version=require('../../package.json').version;
const executable=path.join(root,'installer-'+version,'win-unpacked','Barun CAD 6.exe');
const out=path.join(root,'tmp','release-'+version,'gate-'+Date.now());fs.mkdirSync(out,{recursive:true});
function run(args){return new Promise((resolve,reject)=>{const child=spawn(executable,args,{windowsHide:true,stdio:'inherit'});const timer=setTimeout(()=>{child.kill();reject(Error('Packaged verifier deadline'));},180000);child.once('error',reject);child.once('exit',code=>{clearTimeout(timer);resolve(code);});});}
(async()=>{
 const report=path.join(out,'passed.json'),registry=path.join(out,'approved','registry.json');
 if(await run(['--barun-verify','--report',report,'--registry',registry])!==0)throw Error('Actual packaged checks failed');
 if(await run(['--barun-quality-commit','--report',report,'--registry',registry])!==0)throw Error('Actual packaged approval failed');
 const approved=JSON.parse(fs.readFileSync(registry,'utf8'));if(approved.activeVersion!==version)throw Error('Wrong approved version');
 const old=fs.readFileSync(registry,'utf8'),same=path.join(out,'same-version-blocked.json');
 if(await run(['--barun-verify','--report',same,'--registry',registry])===0)throw Error('Same version incorrectly accepted');
 if(fs.readFileSync(registry,'utf8')!==old)throw Error('Rejected candidate changed registry');
 const negative=path.join(out,'negative','registry.json'),failed=path.join(out,'retained-failure-blocked.json');
 const source="Promise.resolve({checks:[{id:'RETAINED_NEGATIVE_CONTROL',status:'failed',detail:'Deliberate retained-probe regression'}]})",hash=sha(source);
 const fixture=createRegistry();fixture.criteria.push({id:'RETAINED_NEGATIVE_CONTROL',description:'Deliberate test-only regression'});fixture.probeHashes=[hash];
 fs.mkdirSync(path.join(path.dirname(negative),'probes'),{recursive:true});fs.writeFileSync(path.join(path.dirname(negative),'probes',hash+'.js'),source);fs.writeFileSync(negative,JSON.stringify(fixture));
 const before=fs.readFileSync(negative,'utf8');
 if(await run(['--barun-verify','--report',failed,'--registry',negative])===0)throw Error('Retained regression incorrectly accepted');
 const failure=JSON.parse(fs.readFileSync(failed,'utf8'));if(!failure.report?.checks.some(c=>c.id==='RETAINED_NEGATIVE_CONTROL'&&c.status==='failed'))throw Error('Old probe was not actually executed');
 if(fs.readFileSync(negative,'utf8')!==before)throw Error('Failure advanced registry');
 const summary={version,actualPackagedChecks:true,actualPackagedCommit:true,sameVersionBlocked:true,retainedFailureBlocked:true,rejectedDatabaseUnchanged:true,noLiveInstallation:true,out};
 if(['6.0.3','6.0.4','6.0.5','6.0.6'].includes(version)){
  const prior=path.join(process.env.ProgramData||'C:/ProgramData','Barun','CAD6Quality');
  const priorState=JSON.parse(fs.readFileSync(path.join(prior,'registry.json'),'utf8'));
  const expectedPrior={'6.0.3':'6.0.2','6.0.4':'6.0.3','6.0.5':'6.0.4','6.0.6':'6.0.5'}[version];
  if(priorState.activeVersion!==expectedPrior)throw Error('Expected approved '+expectedPrior+' fixture');
  const upgrade=path.join(out,'upgrade-from-'+expectedPrior);fs.mkdirSync(upgrade,{recursive:true});
  fs.copyFileSync(path.join(prior,'registry.json'),path.join(upgrade,'registry.json'));
  fs.mkdirSync(path.join(upgrade,'probes'),{recursive:true});
  for(const name of fs.readdirSync(path.join(prior,'probes'))){
   if(!/^[a-f0-9]{64}\.js$/.test(name))throw Error('Unexpected stored probe name');
   fs.copyFileSync(path.join(prior,'probes',name),path.join(upgrade,'probes',name));
  }
  const upgradeRegistry=path.join(upgrade,'registry.json'),upgradeReport=path.join(out,'approved-popup-change.json');
  if(await run(['--barun-verify','--report',upgradeReport,'--registry',upgradeRegistry])!==0)throw Error('Approved popup change did not pass old and new tests');
  const details=JSON.parse(fs.readFileSync(upgradeReport,'utf8')).report;
  if(!details.checks.some(c=>c.id==='DIALOG_HALF_SCALE'&&c.status==='superseded'&&c.originalStatus==='failed'))throw Error('Old size failure was not transparently recorded');
  if(!details.checks.some(c=>c.id==='DIALOG_THREE_QUARTER_SCALE'&&c.status==='passed'))throw Error('New size was not verified');
  if(await run(['--barun-quality-commit','--report',upgradeReport,'--registry',upgradeRegistry])!==0)throw Error('Approved popup change did not commit');
  const changed=JSON.parse(fs.readFileSync(upgradeRegistry,'utf8'));
  const expectedProbeHashes=new Set([...priorState.probeHashes,sha(fs.readFileSync(path.join(root,'quality-probe.js'),'utf8'))]);
  if(changed.activeVersion!==version||changed.history.length!==priorState.history.length+1||changed.probeHashes.length!==expectedProbeHashes.size||!changed.probeHashes.every(hash=>expectedProbeHashes.has(hash)))throw Error('Prior approval history was lost');
  summary.actualPriorRegistryUpgrade=true;summary.oldFailureRecordedAsSuperseded=true;summary.oldTestsAndHistoryRetained=true;
 }
 fs.writeFileSync(path.join(out,'summary.json'),JSON.stringify(summary,null,2));fs.writeFileSync(path.join(root,'tmp','release-'+version,'gate-verification.json'),JSON.stringify(summary,null,2));console.log(JSON.stringify(summary));
})().catch(error=>{fs.writeFileSync(path.join(out,'failure.txt'),String(error.stack||error));console.error(error);process.exitCode=1;});
