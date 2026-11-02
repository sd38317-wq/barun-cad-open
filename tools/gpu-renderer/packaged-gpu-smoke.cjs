const {app,BrowserWindow}=require('electron');
const fs=require('node:fs'),path=require('node:path'),{spawn}=require('node:child_process');
const root=path.resolve(__dirname,'../..'),out=path.join(root,'tmp/release-6.0.1');
const profile=path.join(out,'gpu-profile-'+process.pid);fs.mkdirSync(profile,{recursive:true});
app.setPath('userData',profile);
app.whenReady().then(async()=>{
 const base='http://127.0.0.1:18879';
 const engine=spawn(path.join(root,'desktop-backend-6.0.1/barun-cad-6-server/barun-cad-6-server.exe'),['--port','18879','--no-browser'],{cwd:profile,windowsHide:true,stdio:'ignore',env:{...process.env,APPDATA:profile,LOCALAPPDATA:profile}});
 let win;
 try{
  for(let i=0;;i++){try{if((await fetch(base+'/api/status')).ok)break;}catch{}if(i>100)throw Error('packaged engine startup timeout');await new Promise(r=>setTimeout(r,200));}
  win=new BrowserWindow({show:false,width:1280,height:900,webPreferences:{backgroundThrottling:false}});
  await win.loadURL(base+'/?renderer=gpu&gpu-test=1');
  for(let i=0;!await win.webContents.executeJavaScript('!!window.__cadGpuTest&&__cadGpuTest.state().stats.active');i++){if(i>100)throw Error('GPU bundle startup timeout');await new Promise(r=>setTimeout(r,100));}
  const document=fs.readFileSync(path.join(root,'tools/gpu-renderer/close-backups/drawing-1790474279430.json'),'utf8');
  await win.webContents.executeJavaScript(`__cadGpuTest.load(${document});`);
  const result=await win.webContents.executeJavaScript(`(async()=>{await document.fonts.ready;__cadGpuTest.draw();const initial=__cadGpuTest.state();__cadGpuTest.setView(1.47,initial.origin);const zoom=__cadGpuTest.state();return {version:await(await fetch('/package.json')).json().then(x=>x.version),initial,zoom};})()`);
  if(result.version!=='6.0.1'||!result.initial.stats.active||!result.zoom.stats.active||result.initial.count<17000)throw Error('packaged GPU regression');
  if(result.zoom.stats.builds!==result.initial.stats.builds)throw Error('packaged zoom rebuilt scene');
  fs.writeFileSync(path.join(out,'packaged-gpu-smoke.json'),JSON.stringify(result,null,2));console.log(JSON.stringify({version:result.version,entities:result.initial.count,gpu:true,atlasPages:result.initial.stats.textAtlasPages,zoomRetained:true}));
 }catch(error){console.error(error.stack);process.exitCode=1;}finally{win?.destroy();engine.kill();app.exit(process.exitCode||0);}
});
