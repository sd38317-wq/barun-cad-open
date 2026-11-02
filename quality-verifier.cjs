'use strict';
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const net=require('node:net');
const {randomUUID,createHash,randomBytes}=require('node:crypto');
const {supersedeCheck}=require('./quality-policy.cjs');
const {spawn}=require('node:child_process');
const {probeEngine}=require('./desktop-http.cjs');
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));

function argumentValue(name,args=process.argv){const index=args.indexOf(name);return index<0?null:args[index+1];}
async function freePort(){
  const server=net.createServer();
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const port=server.address().port;
  await new Promise(resolve=>server.close(resolve));return port;
}
function writeReport(target,report){
  if(!target)return;
  const absolute=path.resolve(target);fs.mkdirSync(path.dirname(absolute),{recursive:true});
  const temporary=absolute+'.'+randomUUID()+'.tmp';
  fs.writeFileSync(temporary,JSON.stringify(report,null,2),'utf8');fs.renameSync(temporary,absolute);
}

/** Must be called before the normal desktop startup or single-instance lock. */
async function runVerification({additionalProbes=[],finalizeReport,reportPath=argumentValue('--report'),timeoutMs=120000}={}){
  const {app,BrowserWindow}=require('electron');
  // The hidden window is destroyed before report finalization; do not let Electron
  // auto-quit between cleanup and the installer's verdict being written.
  const keepAlive=()=>{};
  app.on('window-all-closed',keepAlive);
  const startedAt=new Date().toISOString();
  const report={schemaVersion:1,suiteId:'barun-required-ui-v1',runId:randomUUID(),appVersion:app.isPackaged?app.getVersion():require('./package.json').version,startedAt,status:'failed',checks:[],errors:[]};
  const profile=fs.mkdtempSync(path.join(os.tmpdir(),'barun-quality-'));
  app.setPath('userData',path.join(profile,'electron'));
  app.setPath('sessionData',path.join(profile,'electron'));
  let backend=null,window=null,watchdog=null;
  const started=Date.now();
  const hardWatchdog=setTimeout(()=>{
    report.status='failed';report.errors.push('Verification startup or execution exceeded its deadline');
    report.finishedAt=new Date().toISOString();
    if(backend&&backend.exitCode===null)backend.kill();
    if(window&&!window.isDestroyed())window.destroy();
    const forcedExit=setTimeout(()=>app.exit(2),2000);
    Promise.resolve().then(()=>finalizeReport?finalizeReport(report):writeReport(reportPath,report)).catch(()=>{}).finally(()=>{clearTimeout(forcedExit);app.exit(2);});
  },timeoutMs);
  try{
    await app.whenReady();
    // 화면 열쇠: 검증 엔진도 데스크톱 엔진처럼 지식·자산 GET 에 열쇠를 본다(server.py screen_key_ok) — 검증 창 요청에 붙인다.
    const port=await freePort(),url='http://127.0.0.1:'+port,screenKey=randomBytes(32).toString('base64url');
    const executable=app.isPackaged?path.join(process.resourcesPath,'backend','barun-cad-6-server'+(process.platform==='win32'?'.exe':'')):(process.platform==='win32'?'python':'python3');
    const args=app.isPackaged?['--port',String(port),'--no-browser']:[path.join(__dirname,'server.py'),'--port',String(port),'--no-browser'];
    let launchError=null;
    backend=spawn(executable,args,{cwd:app.isPackaged?process.resourcesPath:__dirname,windowsHide:true,stdio:'ignore',env:{...process.env,APPDATA:profile,LOCALAPPDATA:profile,BARUN_CAD_RECOVERY_DIR:path.join(profile,'recovery'),BARUN_CAD_CHANNEL_PORT:String(port),BARUN_CAD_SHELL_SECRET:randomUUID(),BARUN_CAD_TOKEN:screenKey}});
    backend.once('error',error=>{launchError=error;});
    let ready=false;
    while(Date.now()-started<Math.min(timeoutMs,90000)){
      if(launchError)throw launchError;
      if(backend.exitCode!==null)throw Error('Isolated backend exited before verification');
      const found=await probeEngine(url,{timeoutMs:600,keys:[screenKey]});
      if(found.state==='engine'){
        // A port race must never adopt an existing user's backend.
        if(found.pid!==backend.pid)throw Error('Verification backend process identity mismatch');
        ready=true;break;
      }
      await delay(100);
    }
    if(!ready)throw Error('Isolated backend startup timed out');
    window=new BrowserWindow({show:false,width:1280,height:900,webPreferences:{partition:'quality-'+randomUUID(),sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});
    window.webContents.on('render-process-gone',(_event,details)=>{report.errors.push('Renderer process ended: '+details.reason);});
    window.webContents.setWindowOpenHandler(()=>({action:'deny'}));
    // The verifier has no external services or user-file bridge.
    window.webContents.session.webRequest.onBeforeRequest((details,callback)=>{
      callback({cancel:!details.url.startsWith(url+'/')&&!details.url.startsWith('blob:'+url+'/')&&!details.url.startsWith('data:')});
    });
    window.webContents.session.webRequest.onBeforeSendHeaders((details,callback)=>{
      callback(details.url.startsWith(url+'/')?{requestHeaders:{...details.requestHeaders,'X-CAD-Screen':screenKey}}:{});
    });
    const perform=async()=>{
      const probes=[{id:'current',source:fs.readFileSync(path.join(__dirname,'quality-probe.js'),'utf8')},...additionalProbes];
      for(const probe of probes){
        // Each cumulative suite starts with defaults, not the preceding suite's radius/settings.
        await window.webContents.session.clearStorageData();
        await window.loadURL(url+'/index.html?gpu-test=1&quality-verify=1&renderer=gpu');
        await window.webContents.executeJavaScript(`globalThis.__barunQualityErrors=[];addEventListener('error',event=>{if(event.message)__barunQualityErrors.push(String(event.message));});addEventListener('unhandledrejection',event=>__barunQualityErrors.push(String(event.reason?.message||event.reason)));`);
        while(!await window.webContents.executeJavaScript('!!globalThis.__barunQuality && !!globalThis.__cadGpuTest')){
          if(Date.now()-started>timeoutMs-1000)throw Error('Quality bridge startup timed out');await delay(100);
        }
        const gpuStart=Date.now();
        while(!await window.webContents.executeJavaScript('globalThis.__cadGpuTest.state().stats.active')){
          if(Date.now()-gpuStart>15000)throw Error('GPU renderer did not become active');await delay(100);
        }
        if(typeof probe.source!=='string'||!probe.source.trim())throw Error('Mandatory probe is missing: '+probe.id);
        const result=await window.webContents.executeJavaScript(probe.source);
        if(!Array.isArray(result?.checks)||!result.checks.length)throw Error('Mandatory probe returned no checks: '+probe.id);
        if(result.status==='failed'||(Array.isArray(result.errors)&&result.errors.length))throw Error('Mandatory probe reported failure: '+probe.id);
        const probeHash=createHash('sha256').update(probe.source).digest('hex');
        for(const rawCheck of result.checks){
          if(typeof rawCheck.id!=='string'||!['passed','failed'].includes(rawCheck.status))throw Error('Malformed probe result: '+probe.id);
          const check=supersedeCheck(rawCheck,{version:report.appVersion,probeHash});
          const previous=report.checks.find(item=>item.id===check.id);
          if(previous){
            // 같은 승인 변경으로 대체된 결과끼리는 '대체됨'을 유지하고, 원래 결과는 나쁜 쪽(failed)을 남긴다.
            const sameChange=previous.status==='superseded'&&check.status==='superseded'&&previous.approvedChangeId===check.approvedChangeId;
            if(sameChange&&check.originalStatus==='failed')previous.originalStatus='failed';
            previous.status=previous.status==='passed'&&check.status==='passed'?'passed':sameChange?'superseded':'failed';
            previous.durationMs=Math.max(previous.durationMs||0,Number(check.durationMs)||0);
            previous.probeIds.push(probe.id);
            if(check.detail)previous.detail=[previous.detail,check.detail].filter(Boolean).join('; ');
          }else report.checks.push({...check,probeIds:[probe.id]});
        }
        const renderer=await window.webContents.executeJavaScript('({errors:globalThis.__barunQualityErrors,stats:globalThis.__cadGpuTest.state().stats})');
        if(!renderer.stats.active||renderer.stats.reason)throw Error('GPU renderer fell back during verification');
        for(const error of renderer.errors||[])report.errors.push('Renderer exception: '+error);
      }
      report.status=!report.errors.length&&report.checks.every(check=>['passed','superseded'].includes(check.status))?'passed':'failed';
    };
    await Promise.race([perform(),new Promise((_,reject)=>{watchdog=setTimeout(()=>reject(Error('Quality verification timed out')),Math.max(1,timeoutMs-(Date.now()-started)));})]);
  }catch(error){report.errors.push(String(error.message||error));report.status='failed';}
  finally{
    clearTimeout(watchdog);
    if(window&&!window.isDestroyed())window.destroy();
    if(backend&&backend.exitCode===null){
      backend.kill();
      await Promise.race([new Promise(resolve=>backend.once('exit',resolve)),delay(3000)]);
      if(backend.exitCode===null&&backend.signalCode===null){report.status='failed';report.errors.push('Isolated backend did not stop');}
    }
    report.finishedAt=new Date().toISOString();
    report.durationMs=Date.now()-started;
  }
  try{if(finalizeReport){const finalized=await finalizeReport(report);if(finalized)Object.assign(report,finalized);}}
  catch(error){report.status='failed';report.errors.push('Final verification gate: '+String(error.message||error));}
  if(!finalizeReport)writeReport(reportPath,report);
  clearTimeout(hardWatchdog);
  app.removeListener('window-all-closed',keepAlive);
  return report;
}
module.exports={runVerification,writeReport,argumentValue};
if(require.main===module || (process.versions.electron && process.argv[1] && path.resolve(process.argv[1])===__filename)){
  const {app}=require('electron');
  runVerification().then(report=>{console.log(JSON.stringify(report));app.exit(report.status==='passed'?0:2);},error=>{console.error(error);app.exit(2);});
}
