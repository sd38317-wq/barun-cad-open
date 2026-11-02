// Isolated source-app input check; never opens or saves a user's drawing.
const {app,BrowserWindow}=require('electron');
const fs=require('fs'),path=require('path'),{spawn}=require('child_process');
const root=path.resolve(__dirname,'../..'),out=path.join(root,'tmp/release-6.0.4/output-preview');fs.mkdirSync(out,{recursive:true});
app.setPath('userData',path.join(out,'profile-'+process.pid));
app.whenReady().then(async()=>{let server,win;try{
 server=spawn('python',['server.py','--port','18989','--no-browser'],{cwd:root,windowsHide:true,stdio:'ignore',env:{...process.env,APPDATA:out,LOCALAPPDATA:out}});
 for(let i=0;;i++){try{if((await fetch('http://127.0.0.1:18989/api/status')).ok)break;}catch{}if(i>100)throw Error('server timeout');await new Promise(r=>setTimeout(r,100));}
 win=new BrowserWindow({show:false,width:1280,height:900,webPreferences:{backgroundThrottling:false,offscreen:true}});
 await win.loadURL('http://127.0.0.1:18989/?gpu-test=1');
 for(let i=0;!await win.webContents.executeJavaScript('!!window.__cadGpuTest');i++){if(i>100)throw Error('app failed');await new Promise(r=>setTimeout(r,100));}
 await win.webContents.executeJavaScript(`(()=>{const t=__cadGpuTest;globalThis.cadDesktop={listPrinters:async()=>[{name:'검증용 프린터',isDefault:true}],printDrawing:async()=>{throw Error('Visual test cannot print')}};const walls=[];for(const [i,x] of [0,2500,5000,7500].entries())walls.push({id:'v'+i,type:'line',layer:'0',points:[{x,y:0},{x,y:5000}]});for(const [i,y] of [0,2500,5000].entries())walls.push({id:'h'+i,type:'line',layer:'0',points:[{x:0,y},{x:7500,y}]});t.load({version:2,units:'mm',layers:[{id:'0',name:'0',color:'#ffffff',visible:true}],entities:walls});t.runCommand('PLOT');})()`);
 await new Promise(r=>setTimeout(r,250));
 fs.writeFileSync(path.join(out,'preview.png'),(await win.webContents.capturePage()).toPNG());
 fs.writeFileSync(path.join(out,'result.json'),JSON.stringify(await win.webContents.executeJavaScript(`(()=>{const d=document.querySelector('#form-dialog');return {open:d.open,error:document.querySelector('#form-error').textContent,width:d.getBoundingClientRect().width,viewport:innerWidth}})()`),null,2));
 }catch(e){fs.writeFileSync(path.join(out,'failure.txt'),String(e.stack));}finally{win?.destroy();server?.kill();app.exit();}});
