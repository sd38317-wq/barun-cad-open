const {app,BrowserWindow}=require('electron');
const fs=require('fs'),path=require('path'),{spawn}=require('child_process');
const root=path.resolve(__dirname,'../..'),out=path.join(root,'tmp/favorites-check');fs.mkdirSync(out,{recursive:true});
app.setPath('userData',path.join(out,'profile-'+process.pid));
app.whenReady().then(async()=>{let server,win;try{
 server=spawn('python',['server.py','--port','18985','--no-browser'],{cwd:root,windowsHide:true,stdio:'ignore',env:{...process.env,APPDATA:out,LOCALAPPDATA:out}});
 for(let i=0;;i++){try{if((await fetch('http://127.0.0.1:18985/api/status')).ok)break;}catch{}if(i>100)throw Error('server timeout');await new Promise(r=>setTimeout(r,100));}
 win=new BrowserWindow({show:false,width:1280,height:900,webPreferences:{backgroundThrottling:false,offscreen:true}});
 win.webContents.on('console-message',(_e,_l,message)=>fs.appendFileSync(path.join(out,'console.log'),message+'\n'));
 await win.loadURL('http://127.0.0.1:18985/?gpu-test=1');
 for(let i=0;!await win.webContents.executeJavaScript('!!window.__cadGpuTest');i++){if(i>100)throw Error('app initialization failed');await new Promise(r=>setTimeout(r,100));}
 const checkFavorites=async action=>win.webContents.executeJavaScript(action);
 const result=await checkFavorites(`(async()=>{
 const q=document.getElementById('global-command-search');q.value='출력';q.dispatchEvent(new Event('input'));
 const row=[...document.querySelectorAll('.command-search-row')].find(r=>r.querySelector('[data-command="PLOT"]'));
 if(!row)throw Error('PLOT missing');const before=__cadGpuTest.state().mode;row.querySelector('.command-search-favorite').click();
 if(__cadGpuTest.state().mode!==before||document.querySelector('dialog[open]'))throw Error('star executed command');
 if(row.querySelector('.command-search-favorite').getAttribute('aria-pressed')!=='true')throw Error('star not saved');
 q.value='';q.dispatchEvent(new Event('input'));
 if(!document.querySelector('.command-search-result[data-command="PLOT"]'))throw Error('favorite missing in empty search');
 return {savedWithoutExecution:true};})()`);
 await win.webContents.reload();await new Promise(r=>setTimeout(r,1000));
 await checkFavorites(`(()=>{const q=document.getElementById('global-command-search');q.blur();q.focus();q.dispatchEvent(new Event('input'));if(!document.querySelector('.command-search-result[data-command="PLOT"]'))throw Error('favorite lost after reload');})()`);
 await new Promise(r=>setTimeout(r,200));fs.writeFileSync(path.join(out,'screen.png'),(await win.webContents.capturePage()).resize({width:1600}).toPNG());
 await checkFavorites(`(()=>{document.querySelector('.command-search-favorite').click();if(JSON.parse(localStorage.getItem('barun-command-favorites-v1')).includes('PLOT'))throw Error('remove failed');})()`);
 fs.writeFileSync(path.join(out,'result.json'),JSON.stringify({...result,persistedAfterReload:true,removed:true}));
}catch(e){fs.writeFileSync(path.join(out,'failure.txt'),String(e.stack));process.exitCode=1;}finally{win?.destroy();server?.kill();app.exit(process.exitCode||0);}});
