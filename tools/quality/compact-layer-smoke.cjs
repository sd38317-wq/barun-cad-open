const {app,BrowserWindow}=require('electron');
const fs=require('fs'),path=require('path'),{spawn}=require('child_process');
const root=path.resolve(__dirname,'../..'),out=path.join(root,'tmp/compact-layer-check');fs.mkdirSync(out,{recursive:true});
app.setPath('userData',path.join(out,'profile-'+process.pid));
app.whenReady().then(async()=>{let server,win;try{
 server=spawn('python',['server.py','--port','18983','--no-browser'],{cwd:root,windowsHide:true,stdio:'ignore',env:{...process.env,APPDATA:out,LOCALAPPDATA:out}});
 for(let i=0;;i++){try{if((await fetch('http://127.0.0.1:18983/api/status')).ok)break;}catch{}if(i>100)throw Error('server timeout');await new Promise(r=>setTimeout(r,100));}
 win=new BrowserWindow({show:false,width:1280,height:900,webPreferences:{backgroundThrottling:false,offscreen:true}});
 await win.loadURL('http://127.0.0.1:18983/?gpu-test=1');
 for(let i=0;!await win.webContents.executeJavaScript('!!window.__cadGpuTest');i++){if(i>100)throw Error('app initialization failed');await new Promise(r=>setTimeout(r,100));}
 const result=await win.webContents.executeJavaScript(`(async()=>{
 const check=(ok,message)=>{if(!ok)throw Error(message)};
 document.getElementById('current-layer-trigger').click();
 const pop=document.getElementById('current-layer-popover');
 check(!pop.hidden,'popover closed');check(!document.getElementById('layer-side-panel')&&!document.getElementById('layers'),'old list remains');
 check(pop.contains(document.getElementById('add-layer')),'add lost');
 let row=document.querySelector('.current-layer-option');check(row,'no rows');
 const height=row.getBoundingClientRect().height;check(height<=40,'row not compact: '+height);
 let eye=row.querySelector('.current-layer-visibility');const old=eye.checked;eye.click();
 await new Promise(r=>setTimeout(r,200));row=document.querySelector('.current-layer-option');check(row.querySelector('.current-layer-visibility').checked!==old,'visibility unchanged');
 row.querySelector('.current-layer-visibility').click();await new Promise(r=>setTimeout(r,200));
 row=document.querySelector('.current-layer-option');const locked=row.querySelector('.current-layer-lock').getAttribute('aria-pressed');row.querySelector('.current-layer-lock').click();await new Promise(r=>setTimeout(r,200));
 row=document.querySelector('.current-layer-option');check(row.querySelector('.current-layer-lock').getAttribute('aria-pressed')!==locked,'lock unchanged');
 row.querySelector('.current-layer-lock').click();await new Promise(r=>setTimeout(r,200));
 return {oldListRemoved:true,controlsWork:true,rowHeight:height,addRetained:true};
 })()`);
 fs.writeFileSync(path.join(out,'result.json'),JSON.stringify(result,null,2));fs.writeFileSync(path.join(out,'screen.png'),(await win.webContents.capturePage()).toPNG());
 console.log(JSON.stringify(result));
}catch(e){fs.writeFileSync(path.join(out,'failure.txt'),String(e.stack));process.exitCode=1;}finally{win?.destroy();server?.kill();app.exit(process.exitCode||0);}});
