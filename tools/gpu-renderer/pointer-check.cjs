const {app,BrowserWindow}=require('electron');
const fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const root=path.resolve(__dirname,'../..'),out=__dirname;
app.setPath('userData',path.join(out,'test-profile-'+process.pid));
app.whenReady().then(async()=>{
 const server=http.createServer((req,res)=>{const p=path.resolve(root,'.'+decodeURIComponent(req.url.split('?')[0]));if(!p.startsWith(root+path.sep)){res.writeHead(403).end();return;}try{res.setHeader('Content-Type',/\.(m?js)$/.test(p)?'text/javascript':p.endsWith('.css')?'text/css':p.endsWith('.ttf')?'font/ttf':p.endsWith('.png')?'image/png':p.endsWith('.svg')?'image/svg+xml':p.endsWith('.json')?'application/json':'text/html');res.end(fs.readFileSync(p));}catch{res.writeHead(404).end();}}).listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 const win=new BrowserWindow({show:false,width:1000,height:760,webPreferences:{backgroundThrottling:false}});
 win.webContents.on('console-message',(_e,d)=>{console.log('PAGE',JSON.stringify(d),_e.message||'');});
 try{
 await win.loadURL(`http://127.0.0.1:${server.address().port}/index.html?renderer=gpu&gpu-test=1`);
 const start=Date.now();while(!await win.webContents.executeJavaScript('!!window.__cadGpuTest')){if(Date.now()-start>30000)throw Error('app startup timeout');await new Promise(r=>setTimeout(r,100));}
 const results=await win.webContents.executeJavaScript(fs.readFileSync(path.join(out,'pointer-check.js'),'utf8'));
 fs.writeFileSync(path.join(out,'pointer-results.json'),JSON.stringify(results,null,2));
 console.log(JSON.stringify(results));
 await new Promise(r=>setTimeout(r,250));fs.writeFileSync(path.join(out,'pointer.png'),(await win.webContents.capturePage()).toPNG());
 }catch(e){console.error(e.stack);process.exitCode=1;}finally{win.destroy();server.close();app.exit(process.exitCode||0);}
});


