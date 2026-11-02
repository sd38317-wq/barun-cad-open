const {app,BrowserWindow}=require('electron');
const fs=require('fs'),path=require('path'),{spawn}=require('child_process');
const root=path.resolve(__dirname,'../..'),out=path.join(root,'tmp/diagonal-check');
app.setPath('userData',path.join(out,'profile-'+process.pid));
app.whenReady().then(async()=>{let server,win;try{
 server=spawn('python',['server.py','--port','18987','--no-browser'],{cwd:root,windowsHide:true,stdio:'ignore',env:{...process.env,APPDATA:out,LOCALAPPDATA:out}});
 for(let i=0;;i++){try{if((await fetch('http://127.0.0.1:18987/api/status')).ok)break;}catch{}if(i>100)throw Error('server timeout');await new Promise(r=>setTimeout(r,100));}
 win=new BrowserWindow({show:false,width:1280,height:900,webPreferences:{backgroundThrottling:false,offscreen:true}});
 await win.loadURL('http://127.0.0.1:18987/?gpu-test=1');
 for(let i=0;!await win.webContents.executeJavaScript('!!window.__cadGpuTest');i++){if(i>100)throw Error('app failed');await new Promise(r=>setTimeout(r,100));}
 const input=process.argv.includes('--original')?'original':'drawing';
 const doc=JSON.parse(fs.readFileSync(path.join(out,input+'.json'),'utf8'));delete doc.dxfPreservation;
 await win.webContents.executeJavaScript(`window.__cadGpuTest.toggle(true);window.__cadGpuTest.load(${JSON.stringify(doc)})`);
 await new Promise(r=>setTimeout(r,1500));
 fs.writeFileSync(path.join(out,input+'-gpu.png'),(await win.webContents.capturePage()).toPNG());
 const gpu=await win.webContents.executeJavaScript('window.__cadGpuTest.state()');
 await win.webContents.executeJavaScript('window.__cadGpuTest.toggle(false);window.__cadGpuTest.draw()');
 await new Promise(r=>setTimeout(r,500));
 fs.writeFileSync(path.join(out,input+'-canvas.png'),(await win.webContents.capturePage()).toPNG());
 fs.writeFileSync(path.join(out,input+'-result.json'),JSON.stringify(gpu,null,2));
 }catch(e){fs.writeFileSync(path.join(out,'failure.txt'),String(e.stack));}finally{win?.destroy();server?.kill();app.exit();}});
