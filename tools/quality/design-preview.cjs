const {app,BrowserWindow}=require('electron');
const fs=require('fs'),path=require('path'),{spawn}=require('child_process');
const root=path.resolve(__dirname,'../..'),out=path.join(root,'tmp/design-preview');fs.mkdirSync(out,{recursive:true});
app.setPath('userData',path.join(out,'profile-'+process.pid));
app.whenReady().then(async()=>{let server,win;try{
 server=spawn('python',['server.py','--port','18984','--no-browser'],{cwd:root,windowsHide:true,stdio:'ignore',env:{...process.env,APPDATA:out,LOCALAPPDATA:out}});
 for(let i=0;;i++){try{if((await fetch('http://127.0.0.1:18984/api/status')).ok)break;}catch{}if(i>100)throw Error('server timeout');await new Promise(r=>setTimeout(r,100));}
 win=new BrowserWindow({show:false,width:1280,height:900,webPreferences:{backgroundThrottling:false,offscreen:true}});
 await win.loadURL('http://127.0.0.1:18984/?gpu-test=1');
 for(let i=0;!await win.webContents.executeJavaScript('!!window.__cadGpuTest');i++){if(i>100)throw Error('app initialization failed');await new Promise(r=>setTimeout(r,100));}
 const capture=async name=>{await new Promise(r=>setTimeout(r,250));fs.writeFileSync(path.join(out,name+'.png'),(await win.webContents.capturePage()).resize({width:1600}).toPNG());};
 await capture('01-main');
 const menu=await win.webContents.executeJavaScript(`(async()=>{document.querySelector('[data-tab="file"]').click();await new Promise(r=>setTimeout(r,100));const p=document.querySelector('.file-dropdown .ribbon-catalog-panel');const names=[...p.querySelectorAll('[data-command]')].map(b=>b.dataset.command);if(names.join(',')!=='NEW,OPEN,SAVE,SAVEAS,BACKUP,RECOVER')throw Error('wrong file menu');return names;})()`);
 await capture('02-file');
 await win.webContents.executeJavaScript(`document.querySelector('[data-tab="file"]').click();document.getElementById('current-layer-trigger').click();`);
 await capture('03-layers');
 await win.webContents.executeJavaScript(`document.getElementById('current-layer-trigger').click();document.getElementById('quick-osnap').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true}));`);
 await capture('04-snap');
 fs.writeFileSync(path.join(out,'result.json'),JSON.stringify({captured:4,fileCommands:menu},null,2));
}catch(e){fs.writeFileSync(path.join(out,'failure.txt'),String(e.stack));process.exitCode=1;}finally{win?.destroy();server?.kill();app.exit(process.exitCode||0);}});
