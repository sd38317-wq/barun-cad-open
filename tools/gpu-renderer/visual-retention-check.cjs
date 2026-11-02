const {app,BrowserWindow}=require('electron');
const fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const root=path.resolve(__dirname,'../..');
app.setPath('userData',path.join(__dirname,'visual-check-profile-'+process.pid));
app.whenReady().then(async()=>{
 const server=http.createServer((req,res)=>{const p=path.resolve(root,'.'+decodeURIComponent(req.url.split('?')[0]));if(!p.startsWith(root+path.sep)){res.writeHead(403).end();return;}try{res.setHeader('Content-Type',p.endsWith('.js')?'text/javascript':p.endsWith('.ttf')?'font/ttf':p.endsWith('.json')?'application/json':'text/html');res.end(fs.readFileSync(p));}catch{res.writeHead(404).end();}}).listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 const win=new BrowserWindow({show:false,width:1620,height:700,webPreferences:{backgroundThrottling:false}});
 try{for(const view of ['long','rotated']){
  await win.loadURL(`http://127.0.0.1:${server.address().port}/tools/gpu-renderer/visual-retention-check.html?view=${view}`);
  const start=Date.now();while(!await win.webContents.executeJavaScript('!!window.ready')){const error=await win.webContents.executeJavaScript('window.failure');if(error)throw Error(error);if(Date.now()-start>45000)throw Error('visual timeout');await new Promise(r=>setTimeout(r,100));}
  await new Promise(r=>setTimeout(r,500));fs.writeFileSync(path.join(root,'tmp',`gpu-visual-${view}.png`),(await win.webContents.capturePage()).toPNG());console.log(view,await win.webContents.executeJavaScript('window.result'));
 }}catch(error){console.error(error.stack);process.exitCode=1;}finally{win.destroy();server.close();app.exit(process.exitCode||0);}
});
